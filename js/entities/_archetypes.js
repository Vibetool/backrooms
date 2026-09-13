// 后室 · 实体共用地基 BR.arch：数值档位 + 感知/战斗小工具 + 行为骨架 + 程序化模型构件（蒙皮骨架）+ 程序化动画
// 写法说明与完整签名见 js/entities/_TEMPLATE.md（给实体代理看的文档；改这里的接口必须同步改那份文档）。
// 依赖（全部运行时再取，所以只要求排在 base.js 之后）：BR.entities.api（findTarget/attack/…）、BR.phys、BR.assets、BR.audio、BR.gfx、BR.skin
//
// 设计取舍（为什么这样做）：
// - 行为骨架只调 entities.js 的 api，阵营规则（谁打谁、游玩模式不打玩家、测试人只挨有害实体打）全部留给 entities.js 唯一实现，骨架里不重复判断
// - think 只在房主/单机跑；animate 房主和联机客机都跑，而客机上 e.data 是空的 —— 所以动画只读 e.state / 位移 / e.hitAt / e.dead / e.hp
// - 模型用"一个 SkinnedMesh + 按材质分组"：一个人形 2–3 个 draw call；刚体拼件每个关节一个 mesh 的话 28 只实体就是两三百个 draw call，中端安卓扛不住
// - 几何体按参数缓存、全体实例共享（不标 entityOwned，移除实体时不释放）；骨骼和骨骼贴图每实例一份，由 arch 的 dispose 释放
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;
const TAU = Math.PI * 2;

function has(o, fn) { return !!o && typeof o[fn] === 'function'; }
function num(v, d) { v = +v; return Number.isFinite(v) ? v : d; }
const warned = new Set();
function once(key, fn) { if (!warned.has(key)) { warned.add(key); fn(); } }
function THREE_() { return typeof THREE !== 'undefined' ? THREE : null; }
// 实体时钟：entities.js 的 api.time 单调递增、暂停时不走；取不到（自测页）才退回墙钟
function now() { const E = BR.entities; return E && E.api ? E.api.time : performance.now() / 1000; }
// 骨架在 e.data.arch 下存自己的状态，实体文件自己的状态放 e.data 其他键，互不覆盖
function A(e) { return e.data.arch || (e.data.arch = {}); }

// ---------- 数值档位 ----------
// 参照物：玩家步行 3.0 m/s、冲刺 5.2 m/s、HP 100；测试人 HP 100、步速 1.5 m/s。
// 描述里有真实数字就直接用数字（米、秒），只有定性词才查档位；注释里写出"依据哪句描述 → 哪一档"
const SPEED = {
  still: 0,
  crawl: 0.6,    // 爬、蠕动、极慢
  slow: 1.2,     // 蹒跚、跛行、飘荡
  walk: 1.8,     // 普通步行/游荡（比玩家步行慢，走路就能拉开）
  brisk: 2.6,    // 快走
  jog: 3.4,      // 小跑：玩家步行甩不掉，冲刺能甩掉
  run: 4.4,      // 奔跑：冲刺才甩得掉
  fast: 5.0,     // 很快：冲刺勉强拉开
  sprint: 6.2,   // 比人快：跑不掉，只能躲/用弱点
  dash: 8.5,     // 扑击、俯冲：只用于 1–2 秒的爆发
};
const HP = { fragile: 10, weak: 30, average: 60, sturdy: 100, tough: 180, brute: 350, titan: 800, immortal: 1e9 };
// 单次伤害（玩家满血 100）："一击致命" → lethal
const DAMAGE = { none: 0, graze: 5, light: 10, medium: 20, heavy: 35, severe: 55, lethal: 100 };
const COOLDOWN = { flurry: 0.45, fast: 0.8, normal: 1.2, slow: 2.0, heavy: 3.0 };
// sight = 看得见的最远距离；hearing = 玩家全力冲刺（噪音 1）时能听见的半径，走路噪音小，实际半径按噪音缩小
const SIGHT = { blind: 0, poor: 6, dim: 10, normal: 16, keen: 24, hawk: 40 };
const HEARING = { deaf: 0, poor: 5, normal: 12, keen: 22, acute: 40 };
// 光环 sanityPerSec（仅噩梦模式生效，player.js 结算）。基础掉 san 0.083/s、黑暗 ×2，faint 大约让掉速翻倍
const AURA = { none: 0, faint: 0.08, mild: 0.25, strong: 0.6, severe: 1.2, crushing: 2.5 };
// lightAt 阈值：entities.js 里 needsLight 低于 0.2 就看不见
const LIGHT = { dark: 0.2, dim: 0.35, lit: 0.6 };
const TRIS = { normal: 3000, swarmUnit: 300 };

// ---------- 材质（BR.assets.material 缓存，全体实例共享） ----------
function cachedMat(key, make) {
  return has(BR.assets, 'material') ? BR.assets.material(key, make) : make();
}
function hex(c) { return (num(c, 0x808080) >>> 0).toString(16); }

// 程序化灰度贴图：材质 color 去乘它，所以同一张图能给任意颜色用。自己画 CanvasTexture 而不走 assets.texture，
// 是因为 assets.texture 会先请求 assets/tex/<name>.jpg，这几张永远没有文件，每次开局白白多几个 404
const texCache = new Map();
function canvasTex(kind, size, repeat, draw) {
  const key = kind + '|' + size + '|' + repeat;
  if (texCache.has(key)) return texCache.get(key);
  const T = THREE_();
  if (!T || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, U.mulberry32(U.hashStr(kind)));
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.encoding = T.sRGBEncoding;
  texCache.set(key, t);
  return t;
}
function grey(v, a) { v = Math.max(0, Math.min(255, v | 0)); return 'rgba(' + v + ',' + v + ',' + v + ',' + (a == null ? 1 : a) + ')'; }
const TEX_DRAW = {
  // 毛绒：大量短而弯的深浅笔触，顺一个方向，远看是蓬松的毛
  fur(g, s, r) {
    g.fillStyle = grey(200); g.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 6; i++) {
      const x = r() * s, y = r() * s, L = 3 + r() * 7, ang = Math.PI / 2 + (r() - 0.5) * 0.7;
      g.strokeStyle = grey(120 + r() * 135, 0.55); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(ang) * L * 0.5 + (r() - 0.5) * 2, y + Math.sin(ang) * L * 0.5, x + Math.cos(ang) * L, y + Math.sin(ang) * L); g.stroke();
    }
  },
  // 布料：经纬交织的细格 + 少量污渍
  cloth(g, s, r) {
    g.fillStyle = grey(210); g.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      g.fillStyle = grey(180 + r() * 30, 0.6); g.fillRect(0, i, s, 1);
      g.fillStyle = grey(235, 0.35); g.fillRect(i, 0, 1, s);
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = grey(140, 0.12); g.beginPath(); g.arc(r() * s, r() * s, 4 + r() * 10, 0, TAU); g.fill(); }
  },
  // 皮肤/皮革：柔和斑驳
  skin(g, s, r) {
    g.fillStyle = grey(215); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { g.fillStyle = grey(170 + r() * 80, 0.18); g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 9, 0, TAU); g.fill(); }
  },
  // 甲壳：横向环节 + 高光条
  chitin(g, s, r) {
    g.fillStyle = grey(170); g.fillRect(0, 0, s, s);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y = i * s / n;
      g.fillStyle = grey(90, 0.5); g.fillRect(0, y, s, 2);
      g.fillStyle = grey(240, 0.25); g.fillRect(0, y + 3, s, 2 + r() * 2);
    }
  },
};

const mat = {
  lambert(color, o) {
    o = o || {};
    const key = 'arch/lambert/' + hex(color) + '/' + (o.side || 0) + '/' + hex(o.emissive || 0) + '/' + (o.opacity != null ? o.opacity : 1);
    return cachedMat(key, () => {
      const T = THREE_();
      const m = new T.MeshLambertMaterial({ color: num(color, 0x808080) });
      if (o.emissive) m.emissive.setHex(o.emissive);
      if (o.side) m.side = o.side;
      if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
      return m;
    });
  },
  basic(color, o) {
    o = o || {};
    const key = 'arch/basic/' + hex(color) + '/' + (o.fog === false ? 'nofog' : 'fog') + '/' + (o.side || 0) + '/' + (o.opacity != null ? o.opacity : 1);
    return cachedMat(key, () => {
      const T = THREE_();
      const m = new T.MeshBasicMaterial({ color: num(color, 0x808080), fog: o.fog !== false });
      if (o.side) m.side = o.side;
      if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
      return m;
    });
  },
  // 自发光部位（眼睛、牙、光点）：不受光照也不吃雾 —— 黑暗和雾里先看见的就是它
  glow(color) { return mat.basic(color == null ? 0xffffff : color, { fog: false }); },
  // 半透明黑影剪影
  shadow(opacity) {
    const op = U.clamp(num(opacity, 0.8), 0.05, 1);
    return cachedMat('arch/shadow/' + op, () => {
      const T = THREE_();
      return new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: op, depthWrite: false });
    });
  },
  // 贴图材质：kind = 'fur' | 'cloth' | 'skin' | 'chitin'
  textured(kind, color, repeat) {
    const draw = TEX_DRAW[kind];
    if (!draw) return mat.lambert(color);
    const rep = num(repeat, 2);
    return cachedMat('arch/' + kind + '/' + hex(color) + '/' + rep, () => {
      const T = THREE_();
      const m = new T.MeshLambertMaterial({ color: num(color, 0x808080) });
      const map = canvasTex(kind, kind === 'fur' ? 128 : 64, rep, draw);
      if (map) m.map = map;
      return m;
    });
  },
  fur(color, repeat) { return mat.textured('fur', color, repeat); },
  cloth(color, repeat) { return mat.textured('cloth', color, repeat); },
  skin(color, repeat) { return mat.textured('skin', color, repeat); },
  chitin(color, repeat) { return mat.textured('chitin', color, repeat); },
  // 翅膀、薄膜：双面半透明
  wing(color, opacity) {
    const T = THREE_();
    return mat.lambert(color, { side: T ? T.DoubleSide : 2, opacity: num(opacity, 0.85) });
  },
  // 光晕精灵：加法混合的径向渐变，代替真光源（实体不能占用 gfx 的真实灯光预算）
  halo(color) {
    return cachedMat('arch/halo/' + hex(color), () => {
      const T = THREE_();
      const map = canvasTex('halo', 64, 1, (g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
      });
      if (map) map.wrapS = map.wrapT = T.ClampToEdgeWrapping;
      return new T.SpriteMaterial({ map, color: num(color, 0xffffff), blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    });
  },
  // 需要每实例单独改色/闪红时才用：克隆一份并标 entityOwned，实体移除时 entities.js 会释放它
  own(m) {
    const c = m.clone();
    c.userData = Object.assign({}, c.userData, { entityOwned: true });
    return c;
  },
};

// ---------- 感知 / 战斗 / 声音 小工具 ----------
// 离实体最近的玩家（本机 + 联机对方）：{ ref, x, z, dist, peer }，都没有返回 null
function nearestPlayer(e) {
  let best = null;
  const p = BR.player;
  if (p && !p.dead && Number.isFinite(p.x)) best = { ref: p, x: p.x, z: p.z, dist: Math.hypot(p.x - e.x, p.z - e.z), peer: false };
  const c = BR.coop, q = c && c.active && c.peer;
  if (q && Number.isFinite(q.x)) {
    const d = Math.hypot(q.x - e.x, q.z - e.z);
    if (!best || d < best.dist) best = { ref: q, x: q.x, z: q.z, dist: d, peer: true };
  }
  return best;
}

// 本机玩家是否正看着实体（水平视角 ≤ maxDeg、距离 ≤ range、视线不被墙挡）。视线射线每 0.2 s 最多打一次
function playerLooking(e, maxDeg, range) {
  const p = BR.player;
  if (!p || p.dead) return false;
  const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
  if (d > num(range, 20)) return false;
  if (d > 0.5 && Math.abs(U.angleDiff(p.yaw, Math.atan2(-dx, -dz))) > num(maxDeg, 15) * Math.PI / 180) return false;
  const a = A(e), t = now();
  if (a._lookT != null && t - a._lookT < 0.2) return a._look;
  a._lookT = t;
  a._look = !has(BR.phys, 'los') || BR.phys.los(p.x, p.y, p.z, e.x, e.y + e.h * 0.7, e.z);
  return a._look;
}

// 听到玩家（不管能不能打玩家）：返回 { x, z, dist } 或 null。hearing 半径按玩家当前噪音缩放
function hearPlayer(e, api, hearing) {
  const P = nearestPlayer(e);
  if (!P || P.peer) return null;
  const R = num(hearing, num(e.def.perception && e.def.perception.hearing, 0)) * api.playerNoise();
  return R > 0 && P.dist <= R ? { x: P.x, z: P.z, dist: P.dist } : null;
}

// 气味：记录本机玩家最近 30 秒的足迹，嗅觉实体找到半径内最新的一点。只有有嗅觉的实体来问时才记录，平时零开销
const trail = [];
let trailAt = -1e9;
function recordTrail(t) {
  if (t - trailAt < 0.5) return;
  trailAt = t;
  const p = BR.player;
  if (!p || p.dead) return;
  trail.push({ x: p.x, z: p.z, t });
  if (trail.length > 60) trail.shift();
}
function smellPlayer(e, api, radius) {
  const t = api.time;
  recordTrail(t);
  const R = num(radius, num(e.def.perception && e.def.perception.smell, 0));
  if (!(R > 0)) return null;
  for (let i = trail.length - 1; i >= 0; i--) {
    const q = trail[i];
    if (t - q.t > 30) break;
    const d = Math.hypot(q.x - e.x, q.z - e.z);
    if (d <= R) return { x: q.x, z: q.z, dist: d, age: t - q.t };
  }
  return null;
}
if (BR.bus) BR.bus.on('level:enter', () => { trail.length = 0; trailAt = -1e9; });

// 找附近更亮/更暗的落脚点：两圈 16 个采样点按亮度排序，只对最好的 3 个打视线（别选到墙另一边）。结果缓存 1 秒
function lightSeek(e, api, radius, want) {
  const a = A(e), t = api.time;
  const key = (want === 'dark' ? 'd' : 'b') + num(radius, 8);
  if (a._ls && a._ls.key === key && t - a._ls.t < 1) return a._ls.res;
  const R = num(radius, 8), samples = [];
  const off = (U.hashStr(e.id) % 628) / 100;
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < 8; i++) {
      const ang = off + (i + ring * 0.5) / 8 * TAU, r = R * ring / 2;
      const x = e.x + Math.cos(ang) * r, z = e.z + Math.sin(ang) * r;
      const L = api.lightAt(x, z);
      samples.push({ x, z, light: L, score: want === 'dark' ? -L : L });
    }
  }
  samples.sort((p, q) => q.score - p.score);
  let res = null;
  const y = e.y + Math.min(e.h, 1.8) * 0.5;
  for (let i = 0; i < 3 && i < samples.length; i++) {
    const s = samples[i];
    if (!has(BR.phys, 'los') || BR.phys.los(e.x, y, e.z, s.x, y, s.z)) { res = s; break; }
  }
  a._ls = { key, t, res };
  return res;
}

// 攻击够得着的距离：attack.range + 目标半径（entities.js 的 attack 用同样的算法判断）
function reach(e, t) {
  const r = num(e.def.attack && e.def.attack.range, 1.2);
  if (!t || !t.ref) return r;
  return r + (t.kind === 'player' ? BR.config.player.radius : num(t.ref.r, 0.4));
}

// 近战一步：够得着就出手/等冷却（返回 'hit' | 'wait'），够不着或隔墙没打到返回 false（调用方继续靠近）
function melee(e, api, t) {
  if (!t || !t.ref || !e.def.attack) return false;
  if (t.dist > reach(e, t)) return false;
  if (e.cooldown > 0) { e.state = 'attack'; api.faceToward(e, t.ref.x, t.ref.z); return 'wait'; }
  if (api.attack(e, t)) { e.state = 'attack'; return 'hit'; }
  return false;
}

// 索敌：api.findTarget + 可选过滤（opts.canTarget、lightBound 设置的"不追亮处目标"）
function acquire(e, api, o) {
  // 只在给了正数时才传 range：entities.js 的 num(null) 会得到 0，传 null 等于"什么都看不见"
  const R = o && typeof o.sight === 'number' && o.sight > 0 ? o.sight : undefined;
  const t = api.findTarget(e, R);
  if (!t) return null;
  const a = A(e);
  if (a.avoidLitAbove != null && api.lightAt(t.x, t.z) >= a.avoidLitAbove) return null;
  if (o && typeof o.canTarget === 'function' && !o.canTarget(e, t, api)) return null;
  return t;
}

// 速度：数字直接用；档位名查 SPEED；缺省取 def.speed.walk / run
function speedOf(e, which, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && SPEED[v] != null) return SPEED[v];
  const s = e.def.speed || {};
  const walk = num(s.walk, 1.2);
  return which === 'run' ? num(s.run, walk * 2) : walk;
}

// 叫声：每实例每种声音独立冷却；离最近玩家太远不播（省 WebAudio 节点）。think 里调只有房主听得见，
// 想让联机客机也听见，用 anim.stateSounds（按状态切换触发，两端都跑）
function cry(e, name, o) {
  if (!name || !has(BR.audio, 'play')) return false;
  o = o || {};
  const a = A(e), t = now();
  const book = a._cry || (a._cry = {});
  if (t < (book[name] || -1e9)) return false;
  const cd = num(o.cooldown, 3);
  if (o.chance != null && Math.random() >= o.chance) { book[name] = t + cd * 0.5; return false; }
  const P = nearestPlayer(e);
  if (!P || P.dist > num(o.hear, 35)) { book[name] = t + Math.min(cd, 1); return false; }
  book[name] = t + cd;
  const opts = {};
  if (o.volume != null) opts.volume = o.volume;
  if (o.rate != null) opts.rate = o.rate;
  try { BR.audio.play(name, { x: e.x, y: e.y + Math.min(e.h, 2) * 0.6, z: e.z }, opts); }
  catch (err) { once('cry:' + name, () => console.warn('[arch] 音效播放失败', name, err)); }
  return true;
}

// 遍历附近活着的实体：filter 可以是 type 字符串、faction 数组（如 ['hostile']）或函数
function nearby(api, e, radius, filter, fn) {
  const R2 = num(radius, 10) * num(radius, 10), list = api.list, out = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === e || o.dead || o.removed) continue;
    if (typeof filter === 'string' && o.type !== filter) continue;
    if (Array.isArray(filter) && filter.indexOf(o.def.faction) < 0) continue;
    if (typeof filter === 'function' && !filter(o)) continue;
    if (U.dist2(e.x, e.z, o.x, o.z) > R2) continue;
    if (fn) fn(o); else out.push(o);
  }
  return out;
}

// 动态 san 效果（只在某些状态才掉 san 时用；常驻光环请直接写 def.aura）。每 interval 秒结算一次，
// 走 player.damage：游玩/测试模式自动无效，噩梦模式才掉
function sanityPulse(e, api, radius, perSec, interval) {
  const a = A(e), t = api.time, iv = num(interval, 1);
  if (t < (a._sanT || 0)) return false;
  a._sanT = t + iv;
  const p = BR.player;
  if (!p || p.dead || !has(p, 'damage')) return false;
  if (Math.hypot(p.x - e.x, p.z - e.z) > num(radius, 6)) return false;
  return p.damage({ hp: 0, sanity: num(perSec, 0.5) * iv, source: e }) !== false;
}

// ---------- 蒙皮骨架构件 ----------
// 几何按"直立/展开"的绑定姿势在模型空间里建（原点脚底、面朝 -Z），每个部件整块绑到一根骨骼（权重 1）。
// 骨骼绑定姿势不带旋转，所以动画直接写 bone.rotation = 基础姿势 + 摆动，不会越积越歪
let IDENT = null;
function identity() { return IDENT || (IDENT = new (THREE_().Matrix4)()); }

function RigBuilder(key) {
  this.key = key;
  this.bones = [];      // { name, parent: index, pos: [x,y,z] 模型空间 }
  this.index = {};
  this.parts = [];      // { bone: index, slot, geo }
  this.base = {};       // name → [rx, ry, rz, px, py, pz] 基础姿势（相对绑定姿势）
  this.meta = { chains: [] };
}
const RB = RigBuilder.prototype;
RB.bone = function (name, parent, pos) {
  if (this.index[name] != null) throw new Error('[arch] 骨骼重名 ' + name);
  const pi = parent == null ? -1 : this.index[parent];
  if (parent != null && pi == null) throw new Error('[arch] 父骨骼不存在 ' + parent);
  this.index[name] = this.bones.length;
  this.bones.push({ name, parent: pi, pos: [num(pos && pos[0], 0), num(pos && pos[1], 0), num(pos && pos[2], 0)] });
  return name;
};
RB.pos = function (name) { const b = this.bones[this.index[name]]; return b ? b.pos.slice() : [0, 0, 0]; };
RB.geo = function (bone, slot, g) {
  const bi = this.index[bone];
  if (bi == null) throw new Error('[arch] 骨骼不存在 ' + bone);
  if (!g || !g.isBufferGeometry) throw new Error('[arch] geo 需要 BufferGeometry');
  this.parts.push({ bone: bi, slot: slot || 'body', geo: g });
  return g;
};
RB.box = function (bone, slot, size, center, rot) {
  const T = THREE_();
  const g = new T.BoxGeometry(size[0], size[1], size[2]);
  if (rot) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0)));
  g.translate(center[0], center[1], center[2]);
  return this.geo(bone, slot, g);
};
RB.sphere = function (bone, slot, r, center, scale, seg) {
  const T = THREE_();
  const s = seg || [10, 8];
  const g = new T.SphereGeometry(r, s[0], s[1]);
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  g.translate(center[0], center[1], center[2]);
  return this.geo(bone, slot, g);
};
// 两点间的圆台：r0 在 from 端、r1 在 to 端；flat < 1 压扁截面（躯干）
RB.limb = function (bone, slot, from, to, r0, r1, seg, flat) {
  const T = THREE_();
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1e-3;
  const g = new T.CylinderGeometry(Math.max(0.002, r1), Math.max(0.002, r0), len, seg || 7, 1);
  if (flat != null && flat !== 1) g.scale(1, 1, flat);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / len, dy / len, dz / len)));
  g.translate(from[0], from[1], from[2]);
  return this.geo(bone, slot, g);
};
RB.cone = function (bone, slot, from, to, r, seg) { return this.limb(bone, slot, from, to, r, 0.001, seg || 5); };
// 骨骼链（触手、尾巴、长脖子）：n 节 n 根骨骼，由粗到细。名字为 name+序号，自动登记到 meta.chains 供 anim.sway 摆动
RB.chain = function (name, parent, from, dir, n, length, r0, r1, slot, seg) {
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ux = dir[0] / L, uy = dir[1] / L, uz = dir[2] / L, sl = length / n;
  const names = [];
  let prev = parent;
  for (let k = 0; k < n; k++) {
    const a = [from[0] + ux * sl * k, from[1] + uy * sl * k, from[2] + uz * sl * k];
    const b = [a[0] + ux * sl, a[1] + uy * sl, a[2] + uz * sl];
    prev = this.bone(name + k, prev, a);
    this.limb(prev, slot, a, b, U.lerp(r0, r1, k / n), U.lerp(r0, r1, (k + 1) / n), seg || 6);
    names.push(prev);
  }
  this.meta.chains.push(names);
  return names;
};
RB.setBase = function (name, rx, ry, rz, px, py, pz) { this.base[name] = [rx || 0, ry || 0, rz || 0, px || 0, py || 0, pz || 0]; };

function prepGeo(g, bi, nonIndexed) {
  const T = THREE_();
  let src = nonIndexed && g.index ? g.toNonIndexed() : g;
  if (!src.attributes.normal) src.computeVertexNormals();
  const out = new T.BufferGeometry();
  const n = src.attributes.position.count;
  out.setAttribute('position', src.attributes.position);
  out.setAttribute('normal', src.attributes.normal);
  out.setAttribute('uv', src.attributes.uv && src.attributes.uv.itemSize === 2 ? src.attributes.uv : new T.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!nonIndexed && src.index) out.setIndex(src.index);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
  out.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
  return out;
}

function trisOfGeo(g) {
  if (!g) return 0;
  return (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
}
function trisOf(obj) {
  let n = 0;
  obj.traverse(x => { if (x.isMesh && x.geometry) n += trisOfGeo(x.geometry) * (x.isInstancedMesh ? x.count : 1); });
  return Math.round(n);
}

function finishRig(b) {
  const T = THREE_();
  const merge = T.BufferGeometryUtils && T.BufferGeometryUtils.mergeBufferGeometries;
  if (!merge) throw new Error('[arch] 缺 BufferGeometryUtils');
  if (!b.parts.length) throw new Error('[arch] 骨架 ' + b.key + ' 没有几何');
  const nonIndexed = b.parts.some(p => !p.geo.index);   // Icosahedron 这类不带索引，混用时全转成无索引才能合并
  const slots = [], bySlot = new Map();
  for (const p of b.parts) {
    if (!bySlot.has(p.slot)) { bySlot.set(p.slot, []); slots.push(p.slot); }
    bySlot.get(p.slot).push(prepGeo(p.geo, p.bone, nonIndexed));
  }
  const perSlot = slots.map(s => { const l = bySlot.get(s); return l.length === 1 ? l[0] : merge(l, false); });
  if (perSlot.some(g => !g)) throw new Error('[arch] 合并几何失败（属性不一致）：' + b.key);
  let geometry;
  if (perSlot.length === 1) {
    geometry = perSlot[0];
    geometry.clearGroups();
    geometry.addGroup(0, geometry.index ? geometry.index.count : geometry.attributes.position.count, 0);
  } else {
    geometry = merge(perSlot, true);
  }
  // 包围球按绑定姿势算，佝偻/扑击/倒地会伸出去；放大一点免得边缘被视锥裁掉闪没
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius *= 1.5;
  geometry.name = 'arch ' + b.key;
  const tris = trisOfGeo(geometry);
  if (tris > TRIS.normal) once('tris:' + b.key, () => console.warn('[arch] 骨架 ' + b.key + ' 三角面 ' + tris + ' 超过 ' + TRIS.normal));
  return {
    key: b.key, geometry, slots, bones: b.bones, base: b.base, meta: b.meta, tris,
    inverses: b.bones.map(bd => new T.Matrix4().makeTranslation(-bd.pos[0], -bd.pos[1], -bd.pos[2])),
  };
}

const rigCache = new Map();
function rigRecord(key, fn) {
  if (rigCache.has(key)) return rigCache.get(key);
  const b = new RigBuilder(key);
  fn(b);
  const rec = finishRig(b);
  rigCache.set(key, rec);
  return rec;
}

function slotMat(mats, slot) {
  const m = mats && mats[slot];
  if (m && (m.isMaterial)) return m;
  if (slot === 'glow' || slot === 'eye') return mat.glow(0xffffff);
  if (slot === 'shadow') return mat.shadow(0.8);
  return mats && mats.body && mats.body.isMaterial ? mats.body : mat.lambert(0x777777);
}

// 每实例一套骨骼 + Skeleton（boneInverses 全体共享）；几何共享
function instRig(rec, mats) {
  const T = THREE_();
  const bones = rec.bones.map(bd => { const bn = new T.Bone(); bn.name = bd.name; return bn; });
  rec.bones.forEach((bd, i) => {
    const pp = bd.parent >= 0 ? rec.bones[bd.parent].pos : [0, 0, 0];
    bones[i].position.set(bd.pos[0] - pp[0], bd.pos[1] - pp[1], bd.pos[2] - pp[2]);
    if (bd.parent >= 0) bones[bd.parent].add(bones[i]);
  });
  const mesh = new T.SkinnedMesh(rec.geometry, rec.slots.map(s => slotMat(mats, s)));
  for (let i = 0; i < bones.length; i++) if (rec.bones[i].parent < 0) mesh.add(bones[i]);
  mesh.bind(new T.Skeleton(bones, rec.inverses), identity());
  const rig = { key: rec.key, mesh, skeleton: mesh.skeleton, bones: {}, list: [], meta: rec.meta };
  rec.bones.forEach((bd, i) => {
    rig.bones[bd.name] = bones[i];
    rig.list.push({ bone: bones[i], name: bd.name, rest: bones[i].position.clone(), base: rec.base[bd.name] || null });
  });
  mesh.name = 'arch rig ' + rec.key;
  mesh.userData.rig = rig;
  return mesh;
}

// 材质：o.mats 直接给 Material；o.colors 给颜色；o.look 指定每个槽位的质感
function makeMat(kind, color, o) {
  switch (kind) {
    case 'glow': return mat.glow(color);
    case 'shadow': return mat.shadow(o.opacity);
    case 'basic': return mat.basic(color);
    case 'wing': return mat.wing(color, o.wingOpacity);
    case 'fur': case 'cloth': case 'skin': case 'chitin': return mat.textured(kind, color);
    default: return mat.lambert(color);
  }
}
function resolveMats(o, defaults) {
  const colors = Object.assign({}, defaults, o.colors || {});
  const look = o.look || {};
  const out = {};
  for (const slot in colors) {
    const c = colors[slot] != null ? colors[slot] : colors.body;
    const kind = look[slot] || (slot === 'glow' ? 'glow' : slot === 'wing' ? 'wing' : slot === 'shadow' ? 'shadow' : 'lambert');
    out[slot] = makeMat(kind, c, o);
  }
  if (o.mats) for (const s in o.mats) out[s] = o.mats[s];
  return out;
}

// 几何缓存键：只看影响形状的参数；extend 回调按 o.key（没给就按函数源码）区分
function geoKey(kind, o) {
  const skip = { mats: 1, colors: 1, look: 1, extend: 1, key: 1, opacity: 1, wingOpacity: 1 };
  const parts = [];
  Object.keys(o).sort().forEach(k => { if (!skip[k] && typeof o[k] !== 'function') parts.push(k + '=' + JSON.stringify(o[k])); });
  let key = kind + '{' + parts.join(',') + '}';
  if (typeof o.extend === 'function') key += '+' + (o.key || 'fn' + U.hashStr(String(o.extend)));
  return key;
}

const geoCache = new Map();
function cachedGeo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- 几何小件 ----------
// 发光的脸：眼睛 + 弧形两排牙（笑魇那种黑暗里只剩牙和眼）。面朝 -Z，中心在原点，尺寸都按 width 缩放
function glowFaceGeo(o) {
  const T = THREE_();
  o = Object.assign({ width: 0.3, eyes: 2, eyeSize: null, eyeGap: null, eyeY: null, eyeShape: 'round', smile: true, teeth: 12, rows: 2, smileWidth: null, smileY: null, curve: null, toothH: null }, o);
  const W = o.width, list = [];
  const es = o.eyeSize != null ? o.eyeSize : W * 0.12;
  const gap = o.eyeGap != null ? o.eyeGap : W * 0.42;
  const ey = o.eyeY != null ? o.eyeY : W * 0.18;
  for (let i = 0; i < o.eyes; i++) {
    const x = o.eyes === 1 ? 0 : (i / (o.eyes - 1) - 0.5) * gap;
    const g = new T.CircleGeometry(es, 10).rotateY(Math.PI);
    if (o.eyeShape === 'slit') g.scale(1, 0.35, 1);
    else if (o.eyeShape === 'tall') g.scale(0.6, 1.4, 1);
    list.push(g.translate(x, ey, 0));
  }
  if (o.smile && o.teeth > 0) {
    const sw = o.smileWidth != null ? o.smileWidth : W * 0.8;
    const sy = o.smileY != null ? o.smileY : -W * 0.14;
    const cv = o.curve != null ? o.curve : W * 0.14;
    const th = o.toothH != null ? o.toothH : W * 0.09;
    const n = o.teeth, tw = sw / n * 0.78;
    for (let row = 0; row < Math.max(1, o.rows); row++) {
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : i / (n - 1) - 0.5;
        const g = new T.BoxGeometry(tw, th * (1 - 0.45 * Math.abs(2 * u)), W * 0.02);
        g.rotateZ(Math.atan(8 * cv * u / sw));   // 顺着嘴角的弧度倾斜
        list.push(g.translate(u * sw, sy + cv * (4 * u * u - 0.5) - row * th * 1.1, 0));
      }
    }
  }
  if (!list.length) return new T.BufferGeometry();
  return list.length === 1 ? list[0] : T.BufferGeometryUtils.mergeBufferGeometries(list, false);
}

const geo = {
  glowFace: glowFaceGeo,
  // 群体个体（InstancedMesh 用，非蒙皮，全体共享）
  bug() {
    return cachedGeo('unit/bug', () => {
      const T = THREE_();
      return T.BufferGeometryUtils.mergeBufferGeometries([
        new T.SphereGeometry(0.03, 6, 4).scale(1, 0.7, 1.6).translate(0, 0.03, 0.01),
        new T.SphereGeometry(0.018, 6, 4).translate(0, 0.03, -0.045),
      ], false);
    });
  },
  moth() {
    return cachedGeo('unit/moth', () => {
      const T = THREE_();
      const wing = s => new T.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2).scale(0.1, 1, 0.07).translate(s * 0.05, 0, 0);
      return T.BufferGeometryUtils.mergeBufferGeometries([
        new T.SphereGeometry(0.018, 6, 4).scale(1, 1, 2.4), wing(-1), wing(1),
      ], false);
    });
  },
  rat() {
    return cachedGeo('unit/rat', () => {
      const T = THREE_();
      return T.BufferGeometryUtils.mergeBufferGeometries([
        new T.SphereGeometry(0.06, 8, 6).scale(0.8, 0.7, 1.6).translate(0, 0.05, 0),
        new T.SphereGeometry(0.035, 6, 5).scale(0.9, 0.9, 1.3).translate(0, 0.06, -0.11),
        new T.CylinderGeometry(0.004, 0.012, 0.16, 4).rotateX(Math.PI / 2 + 0.2).translate(0, 0.035, 0.16),
      ], false);
    });
  },
  mote() { return cachedGeo('unit/mote', () => new (THREE_().IcosahedronGeometry)(0.03, 0)); },
};

// ---------- 模型构件 ----------
const HUMANOID = { height: 1.8, thin: 0, bulk: 1, hunch: 0, pose: 'upright', armLen: 1, legLen: 1, headSize: 1, shoulders: 1, neck: 1, head: 'round', hands: true, feet: true, claws: 0, hair: 0, face: null };
function buildHumanoid(b, o) {
  const H = o.height, th = (1 - 0.45 * U.clamp(o.thin, 0, 1)) * o.bulk;
  const dy = (o.legLen - 1) * 0.5 * H;
  const hipY = 0.5 * H * o.legLen, kneeY = 0.27 * H * o.legLen;
  const shY = 0.8 * H + dy, neckTop = shY + 0.045 * H * o.neck;
  const hr = 0.068 * H * o.headSize, headY = neckTop + hr * 0.9;
  const shW = 0.105 * H * o.shoulders * (0.75 + 0.25 * th), hipW = 0.055 * H * (0.7 + 0.3 * th);
  const elbowY = shY - 0.01 * H - 0.18 * H * o.armLen, handY = elbowY - 0.19 * H * o.armLen;
  b.meta.dims = { H, hipY, kneeY, shoulderY: shY, headY, headR: hr, shoulderW: shW, hipW, elbowY, handY };

  b.bone('hips', null, [0, hipY, 0]);
  b.bone('spine', 'hips', [0, hipY + 0.08 * H, 0]);
  b.bone('head', 'spine', [0, shY + 0.01 * H, 0]);
  b.bone('armL', 'spine', [-shW, shY - 0.01 * H, 0]);
  b.bone('foreL', 'armL', [-shW, elbowY, 0]);
  b.bone('armR', 'spine', [shW, shY - 0.01 * H, 0]);
  b.bone('foreR', 'armR', [shW, elbowY, 0]);
  b.bone('legL', 'hips', [-hipW, hipY, 0]);
  b.bone('shinL', 'legL', [-hipW, kneeY, 0]);
  b.bone('legR', 'hips', [hipW, hipY, 0]);
  b.bone('shinR', 'legR', [hipW, kneeY, 0]);

  b.box('hips', 'body', [0.19 * H * th, 0.09 * H, 0.11 * H * th], [0, hipY + 0.02 * H, 0]);
  b.limb('spine', 'body', [0, hipY + 0.05 * H, 0], [0, shY + 0.02 * H, 0], 0.075 * H * th, 0.1 * H * th * o.shoulders, 8, 0.6);
  if (o.head !== 'none') {
    b.limb('head', 'body', [0, shY, 0], [0, neckTop + hr * 0.3, 0], 0.028 * H * th, 0.024 * H * th, 6);
    if (o.head === 'box') b.box('head', 'head', [hr * 1.7, hr * 2.1, hr * 1.8], [0, headY, 0]);
    else if (o.head === 'faceless') b.sphere('head', 'head', hr, [0, headY, 0], [0.86, 1.22, 0.92], [12, 10]);
    else b.sphere('head', 'head', hr, [0, headY, 0], [0.92, 1.08, 0.98], [10, 8]);
    if (o.hair > 0) b.limb('head', 'hair', [0, headY + hr * 1.1, hr * 0.15], [0, headY + hr - o.hair * H, hr * 0.35], hr * 1.02, hr * 0.75, 8);
    if (o.face) b.geo('head', 'glow', glowFaceGeo(Object.assign({ width: hr * 1.5 }, o.face)).translate(0, headY + hr * 0.1, -hr * 0.95));
  }
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R', x = s * shW, hx = s * hipW;
    b.limb('arm' + L, 'body', [x, shY - 0.005 * H, 0], [x, elbowY, 0], 0.03 * H * th, 0.024 * H * th, 6);
    b.limb('fore' + L, 'body', [x, elbowY, 0], [x, handY + 0.02 * H, 0], 0.024 * H * th, 0.018 * H * th, 6);
    if (o.hands) b.box('fore' + L, 'body', [0.035 * H * th + 0.01, 0.06 * H, 0.05 * H * th + 0.01], [x, handY - 0.005 * H, 0]);
    for (let c = 0; c < o.claws; c++) {
      const cz = (c - (o.claws - 1) / 2) * 0.018 * H;
      b.cone('fore' + L, 'claw', [x, handY - 0.03 * H, cz], [x, handY - 0.1 * H, cz - 0.02 * H], 0.006 * H, 4);
    }
    b.limb('leg' + L, 'body', [hx, hipY, 0], [hx, kneeY, 0], 0.042 * H * th, 0.033 * H * th, 6);
    b.limb('shin' + L, 'body', [hx, kneeY, 0], [hx, 0.045 * H, 0], 0.032 * H * th, 0.022 * H * th, 6);
    if (o.feet) b.box('shin' + L, 'body', [0.045 * H * th + 0.015, 0.035 * H, 0.12 * H], [hx, 0.0175 * H, -0.03 * H]);
  }
  // 姿势靠基础姿势实现：几何按直立建，佝偻/四肢着地只是骨骼的常驻旋转
  if (o.pose === 'crawl') {
    const drop = hipY - 0.36 * H;
    b.setBase('hips', 0, 0, 0, 0, -drop, 0);
    b.setBase('spine', -1.25);
    b.setBase('head', 1.05);
    b.setBase('armL', 1.25); b.setBase('armR', 1.25);
    b.setBase('legL', 1.3); b.setBase('legR', 1.3);
    b.setBase('shinL', -1.9); b.setBase('shinR', -1.9);
  } else if (o.hunch > 0) {
    const h = U.clamp(o.hunch, 0, 1);
    b.setBase('hips', 0, 0, 0, 0, -0.03 * H * h, 0);
    b.setBase('spine', -0.8 * h);
    b.setBase('head', 0.6 * h);
    b.setBase('armL', 0.55 * h); b.setBase('armR', 0.55 * h);
    b.setBase('legL', 0.15 * h); b.setBase('legR', 0.15 * h);
    b.setBase('shinL', -0.3 * h); b.setBase('shinR', -0.3 * h);
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function humanoid(opts) {
  const o = Object.assign({}, HUMANOID, opts);
  const rec = rigRecord(geoKey('humanoid', o), b => buildHumanoid(b, o));
  return instRig(rec, resolveMats(o, { body: 0x6e675c, head: null, hair: 0x111111, claw: 0x2a2520, glow: 0xffffff }));
}

const QUAD = { length: 1.1, height: 0.6, girth: 0.2, thin: 0, neckLen: 0.28, headSize: 0.2, snout: 0.12, jaw: true, tail: 0.4, ears: 0, mane: 0, legThick: 1, eyes: null, face: null };
function buildQuad(b, o) {
  const th = 1 - 0.45 * U.clamp(o.thin, 0, 1);
  const G = o.girth * th, legH = o.height, L = o.length, hs = o.headSize;
  const hipZ = L * 0.42, chestZ = -L * 0.42, bodyY = legH + G * 0.35;
  const neckBase = [0, bodyY + G * 0.3, chestZ - G * 0.4];
  const headC = [0, neckBase[1] + o.neckLen * 0.55, neckBase[2] - o.neckLen * 0.85];
  b.meta.dims = { bodyY, hipZ, chestZ, headC, girth: G, legH };

  b.bone('hips', null, [0, bodyY, hipZ]);
  b.bone('chest', 'hips', [0, bodyY, chestZ * 0.15]);
  b.bone('neck', 'chest', neckBase);
  b.bone('head', 'neck', headC);
  b.bone('jaw', 'head', [0, headC[1] - hs * 0.2, headC[2] - hs * 0.2]);

  b.limb('hips', 'body', [0, bodyY, hipZ + G * 0.3], [0, bodyY, chestZ * 0.15], G * 0.92, G, 8, 0.9);
  b.sphere('hips', 'body', G * 0.92, [0, bodyY, hipZ + G * 0.3], [1, 0.9, 1], [8, 6]);
  b.limb('chest', 'body', [0, bodyY, chestZ * 0.15], [0, bodyY + G * 0.1, chestZ - G * 0.1], G, G * 1.1, 8, 0.9);
  b.sphere('chest', 'body', G * 1.1, [0, bodyY + G * 0.1, chestZ - G * 0.1], [1, 0.95, 1], [8, 6]);
  b.limb('neck', 'body', neckBase, headC, G * 0.55, G * 0.42, 6);
  b.sphere('head', 'head', hs * 0.5, headC, [0.9, 0.85, 1.1], [10, 8]);
  if (o.snout > 0) b.box('head', 'head', [hs * 0.5, hs * 0.32, o.snout], [0, headC[1] - hs * 0.06, headC[2] - hs * 0.42 - o.snout * 0.5]);
  if (o.jaw) b.box('jaw', 'head', [hs * 0.45, hs * 0.12, o.snout + hs * 0.3], [0, headC[1] - hs * 0.28, headC[2] - hs * 0.28 - o.snout * 0.5]);
  if (o.eyes) {
    const es = o.eyes.size || hs * 0.09;
    for (const s of [-1, 1]) b.sphere('head', o.eyes.glow === false ? 'eye' : 'glow', es, [s * hs * 0.22, headC[1] + hs * 0.1, headC[2] - hs * 0.4], null, [6, 4]);
  }
  if (o.face) b.geo('head', 'glow', glowFaceGeo(Object.assign({ width: hs * 0.9 }, o.face)).translate(0, headC[1], headC[2] - hs * 0.56 - o.snout));
  if (o.ears > 0) for (const s of [-1, 1]) b.cone('head', 'head', [s * hs * 0.25, headC[1] + hs * 0.3, headC[2]], [s * hs * 0.35, headC[1] + hs * 0.3 + o.ears, headC[2] + hs * 0.1], hs * 0.1, 4);
  if (o.tail > 0) b.chain('tail', 'hips', [0, bodyY + G * 0.3, hipZ + G * 1.1], [0, 0.25, 1], 3, o.tail, G * 0.3, 0.01, 'body', 5);
  if (o.mane > 0) {
    for (let i = 0; i < 8; i++) {
      const z = U.lerp(chestZ - G * 0.2, hipZ, i / 7), bone = z < chestZ * 0.15 ? 'chest' : 'hips';
      b.cone(bone, 'fur', [0, bodyY + G * 0.8, z], [0, bodyY + G * 0.8 + o.mane * (0.7 + 0.3 * ((i * 7) % 3) / 2), z + o.mane * 0.4], G * 0.28, 4);
    }
  }
  const lt = o.legThick * th;
  const legs = [['FL', 'chest', chestZ + G * 0.35], ['FR', 'chest', chestZ + G * 0.35], ['BL', 'hips', hipZ - G * 0.3], ['BR', 'hips', hipZ - G * 0.3]];
  for (const [nm, parent, z] of legs) {
    const x = (nm[1] === 'L' ? -1 : 1) * G * 0.72, top = bodyY - G * 0.2, knee = legH * 0.5;
    const kz = z + (nm[0] === 'B' ? 0.05 : -0.02) * legH;
    b.bone('leg' + nm, parent, [x, top, z]);
    b.bone('shin' + nm, 'leg' + nm, [x, knee, kz]);
    b.limb('leg' + nm, 'body', [x, top, z], [x, knee, kz], G * 0.38 * lt, G * 0.24 * lt, 6);
    b.limb('shin' + nm, 'body', [x, knee, kz], [x, 0.03, z], G * 0.22 * lt, G * 0.15 * lt, 6);
    b.box('shin' + nm, 'body', [G * 0.3 * lt + 0.01, 0.04, G * 0.45 * lt + 0.02], [x, 0.02, z - G * 0.08]);
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function quadruped(opts) {
  const o = Object.assign({}, QUAD, opts);
  const rec = rigRecord(geoKey('quad', o), b => buildQuad(b, o));
  return instRig(rec, resolveMats(o, { body: 0x5a5046, head: null, fur: 0x151210, eye: 0x111111, glow: 0xffffff }));
}

const INSECT = { span: 0.5, bodyLen: 0.28, bodyR: 0.045, wings: 2, wingChord: 0.6, legs: 6, antennae: 0.12, eyes: null };
function buildInsect(b, o) {
  const T = THREE_();
  const r = o.bodyR, Lb = o.bodyLen, y = r * 1.6 + 0.02, half = o.span / 2;
  b.meta.dims = { y, bodyR: r, bodyLen: Lb, span: o.span };
  b.bone('body', null, [0, y, 0]);
  b.bone('head', 'body', [0, y, -Lb * 0.38]);
  b.sphere('body', 'body', r, [0, y, 0], [1, 0.95, 1.3], [8, 6]);
  b.sphere('body', 'body', r * 0.95, [0, y - r * 0.1, Lb * 0.35], [0.9, 0.85, 2.2], [8, 6]);
  b.sphere('head', 'body', r * 0.7, [0, y + r * 0.1, -Lb * 0.38], null, [8, 6]);
  if (o.eyes) for (const s of [-1, 1]) b.sphere('head', o.eyes.glow === false ? 'eye' : 'glow', o.eyes.size || r * 0.3, [s * r * 0.45, y + r * 0.25, -Lb * 0.38 - r * 0.45], null, [6, 4]);
  if (o.antennae > 0) for (const s of [-1, 1]) b.limb('head', 'body', [s * r * 0.3, y + r * 0.5, -Lb * 0.45], [s * o.antennae * 0.5, y + o.antennae * 0.8, -Lb * 0.45 - o.antennae * 0.6], 0.004, 0.002, 3);
  const pairs = Math.floor(o.legs / 2);
  for (let i = 0; i < pairs; i++) {
    const z = (i - (pairs - 1) / 2) * r * 0.9;
    for (const s of [-1, 1]) b.limb('body', 'body', [s * r * 0.8, y - r * 0.4, z], [s * (r * 0.8 + Lb * 0.35), 0.005, z + (i - (pairs - 1) / 2) * r * 0.8], 0.006, 0.003, 3);
  }
  const wingPairs = o.wings >= 4 ? 2 : o.wings >= 2 ? 1 : 0;
  for (let wi = 0; wi < wingPairs; wi++) {
    for (const s of [-1, 1]) {
      const nm = 'wing' + (s < 0 ? 'L' : 'R') + (wi ? '2' : '');
      const z = wi ? r * 1.2 : -r * 0.2, chord = half * o.wingChord * (wi ? 0.75 : 1);
      b.bone(nm, 'body', [s * r * 0.7, y + r * 0.6, z]);
      b.geo(nm, 'wing', new T.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2).scale(half, 1, chord).translate(s * (r * 0.7 + half / 2), y + r * 0.6, z + (wi ? chord * 0.3 : 0)));
    }
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function insect(opts) {
  const o = Object.assign({}, INSECT, opts);
  const rec = rigRecord(geoKey('insect', o), b => buildInsect(b, o));
  return instRig(rec, resolveMats(o, { body: 0x4b3f33, wing: 0x8a7a62, eye: 0x111111, glow: 0xffffff }));
}

const CLUSTER = { count: 6, segments: 4, length: 1.0, radius: 0.06, tip: 0.012, spread: 0.8, center: [0, 0.6, 0], core: 0.22, coreScale: [1, 1, 1] };
function buildCluster(b, o) {
  const c = o.center;
  b.meta.dims = { center: c };
  b.bone('core', null, c);
  if (o.core > 0) b.sphere('core', 'body', o.core, c, o.coreScale, [10, 8]);
  for (let i = 0; i < o.count; i++) {
    const az = i / o.count * TAU + 0.3;
    const el = U.lerp(1.3, 0.1, U.clamp(o.spread, 0, 1)) + ((i % 3) - 1) * 0.35 * o.spread;
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const from = [c[0] + dir[0] * o.core * 0.8, c[1] + dir[1] * o.core * 0.8, c[2] + dir[2] * o.core * 0.8];
    b.chain('t' + i + '_', 'core', from, dir, o.segments, o.length, o.radius, o.tip, 'body', 5);
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function limbCluster(opts) {
  const o = Object.assign({}, CLUSTER, opts);
  const rec = rigRecord(geoKey('cluster', o), b => buildCluster(b, o));
  return instRig(rec, resolveMats(o, { body: 0x5b3a3a, glow: 0xffffff }));
}

function glowFace(o) {
  const T = THREE_();
  o = o || {};
  const g = cachedGeo('face/' + JSON.stringify(Object.assign({}, o, { color: 0 })), () => glowFaceGeo(o));
  const m = new T.Mesh(g, mat.glow(o.color == null ? 0xffffff : o.color));
  m.name = 'arch glowFace';
  return m;
}

function orb(o) {
  const T = THREE_();
  o = Object.assign({ radius: 0.08, color: 0xbff6ff, halo: 0.7, own: false, y: 0 }, o);
  const g = new T.Group();
  let cm = mat.glow(o.color), hm = mat.halo(o.color);
  if (o.own) { cm = mat.own(cm); hm = mat.own(hm); }
  const core = new T.Mesh(cachedGeo('orb/' + o.radius, () => new T.SphereGeometry(o.radius, 12, 8)), cm);
  core.position.y = o.y;
  g.add(core);
  let halo = null;
  if (o.halo > 0) { halo = new T.Sprite(hm); halo.scale.set(o.halo, o.halo, 1); halo.position.y = o.y; g.add(halo); }
  g.userData.orb = { core, halo, coreMat: cm, haloMat: hm };
  return g;
}

function halo(o) {
  const T = THREE_();
  o = Object.assign({ size: 0.8, color: 0xffffff, own: false, y: 0 }, o);
  const s = new T.Sprite(o.own ? mat.own(mat.halo(o.color)) : mat.halo(o.color));
  s.scale.set(o.size, o.size, 1);
  s.position.y = o.y;
  return s;
}

// 地面/墙面的不规则斑块（环境型实体）。地面版原点在地面，墙面版在 XY 平面、面朝 -Z
function decal(o) {
  const T = THREE_();
  o = Object.assign({ radius: 1, color: 0x3a2f24, opacity: 0.9, wall: false, lumps: 9, seed: 1, look: 'lambert' }, o);
  const key = 'decal/' + o.radius + '/' + o.lumps + '/' + o.seed + '/' + (o.wall ? 'w' : 'f');
  const g = cachedGeo(key, () => {
    const r = U.mulberry32(o.seed * 7919 + 1), n = Math.max(6, o.lumps * 2), radii = [];
    for (let i = 0; i < n; i++) radii.push(o.radius * (0.65 + 0.35 * r()));
    const shape = new T.Shape();
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU, rr = radii[i % n];
      if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const sg = new T.ShapeGeometry(shape, 2);
    if (o.wall) sg.rotateY(Math.PI); else sg.rotateX(-Math.PI / 2);
    return sg;
  });
  const m = o.look === 'glow' ? mat.glow(o.color) : mat.lambert(o.color, { opacity: o.opacity });
  const mesh = new T.Mesh(g, m);
  if (!o.wall) mesh.position.y = 0.015;
  mesh.renderOrder = 1;
  return mesh;
}

// 群体：一个逻辑实体 + 一个 InstancedMesh（count 个个体 = 1 个 draw call）
function swarmPart(o, ctx) {
  const T = THREE_();
  o = Object.assign({ unit: 'bug', count: 24, radius: 1.4, height: 1.3, flying: true, scale: 1, color: 0x3b3326, flapHz: 14 }, o);
  const unitGeo = o.geometry || (geo[o.unit] && o.unit !== 'glowFace' ? geo[o.unit]() : geo.bug());
  const m = o.material || (o.unit === 'mote' ? mat.glow(o.color) : mat.lambert(o.color, o.unit === 'moth' ? { side: T.DoubleSide } : null));
  const count = Math.max(1, Math.min(120, o.count | 0));
  const mesh = new T.InstancedMesh(unitGeo, m, count);
  mesh.frustumCulled = false;   // 包围球只按单个个体算，群体散开后会被误裁掉
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  const r = U.mulberry32(U.hashStr(String(ctx && ctx.entity ? ctx.entity.id : 'swarm')));
  const s = {
    mesh, count, radius: o.radius, height: o.height, flying: o.flying, scale: o.scale, flapHz: o.flapHz,
    flap: o.flap != null ? !!o.flap : o.unit === 'moth', spread: 1,
    ph: new Float32Array(count), rr: new Float32Array(count), w: new Float32Array(count), hh: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    s.ph[i] = r() * TAU;
    s.rr[i] = 0.25 + 0.75 * Math.sqrt(r());
    s.w[i] = (0.6 + r() * 0.9) * (r() < 0.5 ? -1 : 1);
    s.hh[i] = 0.4 + r() * 0.6;
  }
  const tri = trisOfGeo(unitGeo);
  if (tri > TRIS.swarmUnit) once('swarmtris:' + tri, () => console.warn('[arch] 群体个体三角面 ' + tri + ' 超过 ' + TRIS.swarmUnit));
  const g = new T.Group();
  g.add(mesh);
  g.userData.swarm = s;
  return g;
}

// 测试人/玩家外形（拟态用）：防化服 + 玩家当前皮肤色。
// 缺省用程序化仿制品（约 1k 三角面）：hazmat.glb 有一万八千面，拟态类实体一层刷十几只就压垮手机；
// { full: true } 才借 test_dummy 的 build（和测试人一模一样，只适合单只特写）
function hazmat(ctx, o) {
  o = o || {};
  if (o.full) {
    const d = BR.entityTypes.get('test_dummy');
    if (d && typeof d.build === 'function') {
      try { const m = d.build(ctx); if (m && m.isObject3D) return m; }
      catch (err) { once('hazmat', () => console.warn('[arch] 借用测试人模型失败，改用程序化防化服', err)); }
    }
  }
  const suit = BR.skin && has(BR.skin, 'color') ? BR.skin.color() : 0xd8b21f;
  return humanoid({
    height: 1.8, bulk: 1.35, headSize: 1.3, neck: 0.4, key: 'hazmat_lite',
    colors: { body: suit, head: suit, gear: 0x1b1b1d },
    extend(b, d) {
      const hr = d.headR, hy = d.headY;
      b.box('head', 'gear', [hr * 1.25, hr * 0.95, hr * 0.5], [0, hy - hr * 0.15, -hr * 0.8]);                           // 防毒面具
      b.limb('head', 'gear', [0, hy - hr * 0.45, -hr * 1.0], [0, hy - hr * 0.5, -hr * 1.45], hr * 0.32, hr * 0.36, 8);    // 滤罐
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R';
        b.box('shin' + L, 'gear', [0.14, 0.13, 0.27], [s * d.hipW, 0.065, -0.03]);                                       // 靴子
        b.box('fore' + L, 'gear', [0.09, 0.1, 0.1], [s * d.shoulderW, d.handY, 0]);                                      // 手套
      }
    },
  });
}

function findRig(obj) {
  let rig = null;
  obj.traverse(x => { if (!rig && x.userData && x.userData.rig) rig = x.userData.rig; });
  return rig;
}

// 实体根节点标准结构：root（entities.js 写位置/朝向）→ pivot（arch 动画写倒地、后仰、飞行高度）→ 模型
// model 可以是 Object3D，或 { 形态名: Object3D } 多形态（拟态/伏击：按 e.state 切换显示）
function wrap(model, o) {
  const T = THREE_();
  o = o || {};
  const root = new T.Group(), pivot = new T.Group();
  pivot.name = 'arch pivot';
  root.add(pivot);
  const u = {
    pivot, rig: null, rigs: null, forms: null, formKey: null, swarm: null, orb: null,
    lx: NaN, lz: NaN, sp: 0, phase: 0, seed: Math.random() * 100, acc: 0,
    state: null, stateAt: 0, alt: NaN, ceilAt: -1e9, ceil: Infinity, deadAt: null, reveal: 1,
  };
  if (model && !model.isObject3D && typeof model === 'object') {
    u.forms = {}; u.rigs = {};
    for (const k in model) {
      const m = model[k];
      if (!m || !m.isObject3D) continue;
      pivot.add(m);
      u.forms[k] = m;
      u.rigs[k] = findRig(m);
      m.visible = false;
    }
    u.formKey = o.form && u.forms[o.form] ? o.form : Object.keys(u.forms)[0] || null;
    if (u.formKey) { u.forms[u.formKey].visible = true; u.rig = u.rigs[u.formKey]; }
  } else if (model && model.isObject3D) {
    pivot.add(model);
    u.rig = findRig(model);
  }
  root.traverse(x => { if (x.userData.swarm) u.swarm = x.userData.swarm; if (x.userData.orb && !u.orb) u.orb = x.userData.orb; });
  root.userData.arch = u;
  // 普通实体 3k 预算不算 parts.swarm 的实例化个体：个体另有 TRIS.swarmUnit 预算（swarmPart 里查），几十个小个体共用一个 draw call
  let tris = 0;
  root.traverse(x => { if (x.isMesh && x.geometry && !x.isInstancedMesh) tris += trisOfGeo(x.geometry); });
  tris = Math.round(tris);
  const limit = num(o.budget, TRIS.normal);
  if (tris > limit) once('budget:' + (o.label || '') + tris, () => console.warn('[arch] 模型三角面 ' + tris + ' 超预算 ' + limit, o.label || ''));
  return root;
}

// 释放每实例的骨骼贴图和实例矩阵缓冲（几何/材质是共享的，不在这里释放）
function disposeObj(e) {
  const o = e && e.obj;
  if (!o) return;
  o.traverse(x => {
    if (x.isSkinnedMesh && x.skeleton) x.skeleton.dispose();
    if (x.isInstancedMesh && typeof x.dispose === 'function') x.dispose();
  });
}

// ---------- 程序化动画 ----------
// 只写骨骼/枢轴，不改实体坐标（animate 钩子的约定）。每帧先 pose 回基础姿势，再叠加各种摆动
function pose(rig) {
  const l = rig.list;
  for (let i = 0; i < l.length; i++) {
    const it = l[i], b = it.base;
    if (b) { it.bone.rotation.set(b[0], b[1], b[2]); it.bone.position.set(it.rest.x + b[3], it.rest.y + b[4], it.rest.z + b[5]); }
    else { it.bone.rotation.set(0, 0, 0); it.bone.position.copy(it.rest); }
  }
}
function addRot(rig, name, x, y, z) { const b = rig.bones[name]; if (b) { b.rotation.x += x || 0; b.rotation.y += y || 0; b.rotation.z += z || 0; } }
function addPos(rig, name, x, y, z) { const b = rig.bones[name]; if (b) { b.position.x += x || 0; b.position.y += y || 0; b.position.z += z || 0; } }

// 旋转方向约定（面朝 -Z）：绕 X 正转 = 下垂的肢体往前摆、躯干往后仰；负转 = 往前弯腰。翅膀绕 Z：左翼负转抬起、右翼正转抬起
function biped(rig, ph, amt, run) {
  const a = U.clamp(amt, 0, 1.5), s = Math.sin(ph), c = Math.cos(ph), sw = (run ? 0.75 : 0.5) * a;
  addRot(rig, 'legL', s * sw); addRot(rig, 'legR', -s * sw);
  // 膝盖只往后弯，而且是腿往前迈的那半拍弯得最多
  addRot(rig, 'shinL', -Math.max(0, c) * 0.9 * a - 0.06 * a); addRot(rig, 'shinR', -Math.max(0, -c) * 0.9 * a - 0.06 * a);
  addRot(rig, 'armL', -s * sw * 0.8); addRot(rig, 'armR', s * sw * 0.8);
  addRot(rig, 'foreL', (run ? 0.9 : 0.25) * a); addRot(rig, 'foreR', (run ? 0.9 : 0.25) * a);
  addPos(rig, 'hips', 0, -Math.abs(c) * 0.03 * a, 0);
  addRot(rig, 'spine', -(run ? 0.18 : 0.05) * a, s * 0.06 * a, 0);
}
function crawl(rig, ph, amt) {
  const a = U.clamp(amt, 0, 1.5), s = Math.sin(ph), c = Math.cos(ph);
  addRot(rig, 'armL', s * 0.45 * a); addRot(rig, 'armR', -s * 0.45 * a);
  addRot(rig, 'legL', -s * 0.35 * a); addRot(rig, 'legR', s * 0.35 * a);
  addRot(rig, 'foreL', Math.max(0, c) * 0.5 * a); addRot(rig, 'foreR', Math.max(0, -c) * 0.5 * a);
  addRot(rig, 'spine', 0, 0, s * 0.08 * a);
  addPos(rig, 'hips', 0, -Math.abs(s) * 0.02 * a, 0);
}
const QUAD_LEGS = ['FL', 'FR', 'BL', 'BR'];
function quad(rig, ph, amt, gallop) {
  const a = U.clamp(amt, 0, 1.5), sw = (gallop ? 0.7 : 0.45) * a;
  // 小跑对角腿同相；奔跑时前腿一对、后腿一对，前后错开半拍，脊背一弓一伸
  const off = gallop ? [0, 0.35, Math.PI * 0.9 + 0.35, Math.PI * 0.9] : [0, Math.PI, Math.PI, 0];
  for (let i = 0; i < 4; i++) {
    const p = ph + off[i];
    addRot(rig, 'leg' + QUAD_LEGS[i], Math.sin(p) * sw);
    addRot(rig, 'shin' + QUAD_LEGS[i], -Math.max(0, Math.cos(p)) * 0.8 * a);
  }
  if (gallop) addRot(rig, 'chest', Math.sin(ph) * 0.12 * a);
  addPos(rig, 'hips', 0, -Math.abs(Math.cos(ph)) * 0.025 * a * (gallop ? 2 : 1), 0);
  addRot(rig, 'head', Math.sin(ph * 2) * 0.05 * a);
}
function flap(rig, t, hz, amt) {
  const w = t * hz * TAU, s = Math.sin(w) * 0.9 * amt, s2 = Math.sin(w - 0.6) * 0.8 * amt;
  addRot(rig, 'wingL', 0, 0, -s - 0.1); addRot(rig, 'wingR', 0, 0, s + 0.1);
  addRot(rig, 'wingL2', 0, 0, -s2 - 0.1); addRot(rig, 'wingR2', 0, 0, s2 + 0.1);
  addRot(rig, 'body', Math.cos(w) * 0.04 * amt);
}
// 骨骼链（触手、尾巴）：越靠末端摆得越大，每条链、每节错开相位
function sway(rig, t, amt, speed) {
  const ch = rig.meta && rig.meta.chains;
  if (!ch || !ch.length) return;
  const sp = num(speed, 1.6);
  for (let i = 0; i < ch.length; i++) {
    const names = ch[i], n = names.length;
    for (let k = 0; k < n; k++) {
      const w = (k + 1) / n;
      addRot(rig, names[k], Math.sin(t * sp + i * 1.7 + k * 0.9) * amt * w, 0, Math.cos(t * sp * 0.8 + i * 2.3 + k * 0.7) * amt * w);
    }
  }
}
function breathe(rig, t, amt) {
  const v = Math.sin(t * 1.7) * amt;
  addRot(rig, 'spine', v); addRot(rig, 'chest', v); addRot(rig, 'core', v * 0.5);
  addRot(rig, 'head', -v * 0.6);
}
// 抽搐：按时间片哈希出随机的猛一下（纯函数，不存状态，客机和房主一样）
function twitch(rig, t, amt, seed) {
  const slot = Math.floor(t / 0.11 + seed), h = U.hashInts(slot, (seed * 1000) | 0);
  if ((h & 7) > 2) return;
  const r1 = ((h >>> 3) & 255) / 255 - 0.5, r2 = ((h >>> 11) & 255) / 255 - 0.5, r3 = ((h >>> 19) & 255) / 255 - 0.5;
  addRot(rig, 'head', r1 * amt, r2 * amt * 1.5, r3 * amt);
  addRot(rig, 'neck', r2 * amt * 0.6, r1 * amt, 0);
  addRot(rig, (h & 256) ? 'armL' : 'armR', r2 * amt * 1.2, 0, r3 * amt);
  addRot(rig, 'spine', 0, 0, r1 * amt * 0.3);
}
// 攻击一个冷却周期 k∈[0,1)：蓄力 → 出手 → 收回
function strikeCurve(k) { return k < 0.22 ? -0.4 * (k / 0.22) : k < 0.38 ? U.lerp(-0.4, 1, (k - 0.22) / 0.16) : Math.max(0, 1 - (k - 0.38) / 0.4); }
function strike(rig, k, kind) {
  const v = strikeCurve(k);
  switch (kind) {
    case 'none': return;
    case 'bite': {
      const open = k < 0.3 ? k / 0.3 : Math.max(0, 1 - (k - 0.3) / 0.08);
      addRot(rig, 'jaw', -0.6 * open);
      addRot(rig, 'neck', -0.3 * v); addRot(rig, 'head', -0.25 * v);
      addRot(rig, 'chest', -0.1 * v); addRot(rig, 'spine', -0.25 * v);
      return;
    }
    case 'lunge':
      addRot(rig, 'spine', -0.5 * v); addRot(rig, 'armL', 1.3 * v); addRot(rig, 'armR', 1.3 * v);
      addPos(rig, 'hips', 0, 0, -0.15 * v); addRot(rig, 'chest', -0.3 * v);
      return;
    case 'grab': {
      const g = Math.max(0, v);
      addRot(rig, 'armL', 1.5 * g, 0, 0.2 * g); addRot(rig, 'armR', 1.5 * g, 0, -0.2 * g);
      addRot(rig, 'foreL', 0.4 * g); addRot(rig, 'foreR', 0.4 * g); addRot(rig, 'spine', -0.2 * g);
      return;
    }
    case 'sting':
      addRot(rig, 'body', 0.5 * v); addRot(rig, 'tail0', -0.6 * v); addRot(rig, 'tail1', -0.5 * v);
      return;
    default:   // swipe：右臂从后往前抡
      addRot(rig, 'armR', 1.6 * v, 0, -0.3 * Math.max(0, v));
      addRot(rig, 'foreR', 0.4 * Math.max(0, -v));
      addRot(rig, 'spine', -0.15 * v, 0.35 * v, 0);
  }
}

let tmpObj = null;
function swarmAnim(e, t, dt, u) {
  const s = u.swarm, T = THREE_();
  if (!tmpObj) tmpObj = new T.Object3D();
  // 活着的个体数跟着 hp 比例减少：客机也有 hp，挨打掉个体两端一致
  const maxHp = Math.max(1, num(e.maxHp, num(e.def.hp, 1)));
  const alive = e.dead ? 0 : Math.max(1, Math.ceil(s.count * U.clamp(e.hp / maxHp, 0, 1)));
  s.mesh.count = alive;
  const st = e.state;
  s.spread = U.damp(s.spread, st === 'attack' || st === 'dive' ? 0.35 : st === 'idle' || st === 'hide' ? 0.75 : 1, 3, dt);
  for (let i = 0; i < alive; i++) {
    const w = s.w[i], ph = s.ph[i], ang = ph + t * w * (s.flying ? 1.6 : 0.9);
    const r = s.rr[i] * s.radius * s.spread;
    tmpObj.position.set(
      Math.cos(ang) * r + Math.sin(t * 1.3 * w + ph * 2) * 0.12 * s.radius,
      s.flying ? s.hh[i] * s.height + Math.sin(t * 2.1 * w + ph) * 0.12 : 0,
      Math.sin(ang) * r + Math.cos(t * 1.1 * w + ph) * 0.12 * s.radius);
    tmpObj.rotation.set(0, w > 0 ? Math.PI - ang : -ang, 0);   // 顺着绕圈的切线方向
    const sc = s.scale;
    tmpObj.scale.set(s.flap ? sc * (0.35 + 0.65 * Math.abs(Math.sin(t * s.flapHz * Math.PI + ph))) : sc, sc, sc);
    tmpObj.updateMatrix();
    s.mesh.setMatrixAt(i, tmpObj.matrix);
  }
  s.mesh.instanceMatrix.needsUpdate = true;
}

// 远处降频：离相机越远越久才动一次（累积的 dt 一次补上，所以动作快慢不变）；背对相机的也降
const LOD = { near: 14, mid: 28, far: 50, cull: 80 };
function lodStep(e, u, dt) {
  const cam = BR.gfx && BR.gfx.camera;
  let d = 0, behind = false;
  if (cam && cam.matrixWorld) {
    const m = cam.matrixWorld.elements, dx = e.x - m[12], dz = e.z - m[14];
    d = Math.hypot(dx, dz);
    behind = d > 5 && (-m[8] * dx - m[10] * dz) < -0.2 * d;
  }
  let every = d < LOD.near ? 0 : d < LOD.mid ? 1 / 20 : d < LOD.far ? 1 / 8 : d < LOD.cull ? 1 / 3 : Infinity;
  if (behind) every = Math.max(every, 1 / 6);
  if (e.dead && d < LOD.far) every = 0;
  u.acc += dt;
  if (u.acc < every) return 0;
  const step = Math.min(u.acc, 0.35);
  u.acc = 0;
  return step;
}

function defaultForm(state, u) {
  if (u.forms[state]) return state;
  if (u.forms.main) return 'main';
  if (u.forms.true) return 'true';
  return u.formKey;
}

// 标准动画：速度由位移算、状态由 e.state 定 —— 联机客机没有 think 也能正确摆动
function auto(e, dt, api, cfg, u) {
  const t = api.time;
  let sp = 0;
  if (Number.isFinite(u.lx)) sp = Math.hypot(e.x - u.lx, e.z - u.lz) / Math.max(dt, 1e-3);
  u.lx = e.x; u.lz = e.z;
  if (sp > 25) sp = 0;   // 生成、传送、快照跳变
  u.sp = U.damp(u.sp, sp, 10, dt);
  const s = e.def.speed || {}, walk = Math.max(0.3, num(s.walk, 1.2)), run = num(s.run, walk * 2);
  u.phase += u.sp / num(cfg.stride, Math.max(0.4, e.h * 0.8)) * TAU * dt;
  const amt = U.clamp(u.sp / walk, 0, 1.5);
  const running = u.sp > (walk + run) * 0.5 + 0.05;

  if (e.state !== u.state) {
    u.prev = u.state; u.state = e.state; u.stateAt = t;
    const snd = cfg.stateSounds && cfg.stateSounds[e.state];
    if (snd && u.prev != null) cry(e, snd, { cooldown: num(cfg.stateSoundCooldown, 2) });
  }

  if (u.forms) {
    const key = typeof cfg.formOf === 'function' ? cfg.formOf(e.state, e) : defaultForm(e.state, u);
    if (key && key !== u.formKey && u.forms[key]) {
      for (const k in u.forms) u.forms[k].visible = k === key;
      u.formKey = key; u.rig = u.rigs[key]; u.revealAt = t;
    }
    if (u.revealAt != null) {
      const k = Math.min(1, (t - u.revealAt) / 0.35);
      u.forms[u.formKey].scale.setScalar(0.75 + 0.25 * k);   // 现形时从小撑开，比瞬间换模型更像"暴露"
      if (k >= 1) u.revealAt = null;
    }
  }

  const rig = u.rig;
  const gait = cfg.gait || (rig ? (rig.bones.wingL ? 'flyer' : rig.bones.legFL ? 'quad' : rig.bones.legL ? 'biped' : 'none') : 'none');
  if (rig) {
    pose(rig);
    if (!e.dead) {
      if (gait === 'biped') biped(rig, u.phase, amt, running);
      else if (gait === 'crawl') crawl(rig, u.phase, amt);
      else if (gait === 'quad') quad(rig, u.phase, amt, running);
      else if (gait === 'flyer') flap(rig, t + u.seed, num(cfg.flapHz, 6), e.state === 'idle' || e.state === 'hide' ? 0.4 : 1);
      if (cfg.breathe !== 0) breathe(rig, t + u.seed, num(cfg.breathe, 0.03));
      if (cfg.twitch) twitch(rig, t, cfg.twitch, u.seed);
      if (rig.meta.chains && rig.meta.chains.length) sway(rig, t + u.seed, num(cfg.sway, 0.25) * (1 + amt * 0.5), cfg.swaySpeed);
      if (e.state === 'attack') {
        const cd = Math.max(0.2, num(e.def.attack && e.def.attack.cooldown, 1));
        strike(rig, ((t - u.stateAt) % cd) / cd, cfg.strike || (gait === 'quad' ? 'bite' : 'swipe'));
      }
    }
  }

  const pv = u.pivot, fly = cfg.fly;
  let y = 0, rx = 0, rz = 0;
  if (fly) {
    const low = num(fly.low, 1.0), cruise = num(fly.cruise, 2.0);
    let want = e.dead ? 0 : (e.state === 'dive' || e.state === 'attack') ? low : (e.state === 'land' || e.state === 'hide') ? num(fly.rest, 0) : cruise;
    if (fly.ceiling !== false && has(BR.phys, 'raycast') && t - u.ceilAt > 0.5) {
      u.ceilAt = t;
      const hit = BR.phys.raycast(e.x, e.y + 0.3, e.z, 0, 1, 0, 12);
      u.ceil = hit ? hit.dist + 0.3 - num(fly.clearance, 0.35) : Infinity;   // 矮天花板的层级别飞进吊顶里
    }
    want = Math.max(0, Math.min(want, u.ceil));
    u.alt = Number.isFinite(u.alt) ? U.damp(u.alt, want, e.state === 'dive' ? 5 : 2.5, dt) : want;
    y = u.alt + (e.dead ? 0 : Math.sin(t * num(fly.bobHz, 1.3) * Math.PI + u.seed) * num(fly.bob, 0.1));
    if (!e.dead) rz = Math.sin(t * 0.9 + u.seed) * num(fly.bank, 0.08);
  }
  const since = t - e.hitAt;
  if (!e.dead && since >= 0 && since < 0.3) rx += num(cfg.recoil, 0.22) * Math.sin(Math.PI * since / 0.3);
  let sy = 1, sa = 1;
  if (e.dead) {
    if (u.deadAt == null) u.deadAt = t;
    const k = Math.min(1, (t - u.deadAt) / 0.6), kk = k * k;
    const fall = cfg.fall || (gait === 'quad' || gait === 'crawl' ? 'side' : fly ? 'drop' : 'back');
    if (fall === 'side') rz = Math.PI / 2 * kk;
    else if (fall === 'crumple') sy = 1 - 0.8 * kk;
    else if (fall === 'fade') sa = Math.max(0.001, 1 - kk);
    else if (fall === 'drop') rz = 1.2 * kk;
    else if (fall !== 'none') rx = Math.PI / 2 * kk;
  } else u.deadAt = null;
  pv.position.y = y;
  pv.rotation.x = rx;
  pv.rotation.z = rz;
  pv.scale.set(sa, sy * sa, sa);

  if (u.orb && u.orb.halo && cfg.pulse !== 0) {
    if (u.haloBase == null) u.haloBase = u.orb.halo.scale.x;
    const k = u.haloBase * (1 + Math.sin(t * 3 + u.seed) * num(cfg.pulse, 0.08));
    u.orb.halo.scale.set(k, k, 1);
  }
  if (u.swarm) swarmAnim(e, t, dt, u);
}

// animate 钩子工厂：arch.register 的 anim 配置会自动走这里
function animate(cfg) {
  cfg = cfg || {};
  return function (e, dt, api) {
    const u = e.obj && e.obj.userData.arch;
    if (!u) return;
    const step = cfg.lod === false ? dt : lodStep(e, u, dt);
    if (!(step > 0)) return;
    auto(e, step, api, cfg, u);
    if (typeof cfg.onFrame === 'function') cfg.onFrame(e, step, api, u);
  };
}

// ---------- 行为骨架 ----------
// 每个骨架返回片段 { init, think, onHit, dispose }，交给 arch.register 的 brain 字段。
// 骨架写 e.state（联机同步、动画按它切换），自己的状态存 e.data.arch
function opt(o, defaults) { return Object.assign({}, defaults, o || {}); }
function seedOf(e) { const a = A(e); if (a.seed == null) a.seed = (U.hashStr(String(e.id)) % 628) / 100; return a.seed; }

// 被打：记下打人者位置（骨架没目标时去那里找）
function provokedTurn(e, amount, attacker, api) {
  const a = A(e);
  const src = attacker === 'player' ? BR.player : attacker;
  if (src && Number.isFinite(src.x)) { a.hitFromX = src.x; a.hitFromZ = src.z; a.hitFromAt = api.time; a.threat = src; }
}

function pickWaypoint(e, api, a, R) {
  const ang = api.rng() * TAU, r = R * (0.3 + 0.7 * api.rng());
  a.wpX = a.homeX + Math.cos(ang) * r; a.wpZ = a.homeZ + Math.sin(ang) * r;
  a.wpUntil = api.time + 4 + api.rng() * 4;   // 这么久没走到（被墙挡）就换点
}
// 巡逻：o.patrol = 'wander'（随机游走，超出 patrolRadius 往回走）| 'home'（出生点附近取航点，到点停一会）| 'still'
function patrol(e, api, a, o) {
  if (a.homeX === undefined) { a.homeX = e.x; a.homeZ = e.z; }
  const sp = speedOf(e, 'walk', o.patrolSpeed), R = num(o.patrolRadius, 12);
  if (o.patrol === 'still') { e.state = 'idle'; return; }
  if (o.patrol === 'home') {
    if (a.wpX === undefined) pickWaypoint(e, api, a, R);
    if (api.time < (a.wpPause || 0)) { e.state = 'idle'; return; }
    if (api.time > a.wpUntil) pickWaypoint(e, api, a, R);
    if (api.moveToward(e, a.wpX, a.wpZ, sp)) { a.wpPause = api.time + 0.8 + api.rng() * 2; a.wpUntil = a.wpPause; }
    e.state = 'patrol';
    return;
  }
  if (R > 0 && Math.hypot(e.x - a.homeX, e.z - a.homeZ) > R) { api.moveToward(e, a.homeX, a.homeZ, sp); e.state = 'patrol'; return; }
  e.state = api.wander(e, sp) ? 'patrol' : 'idle';
}
// 搜索：先走到最后位置，再原地左右张望、附近乱走（a.lastX/lastZ 由调用方写）
function search(e, api, a, o) {
  e.state = 'search';
  if (!a.reached) {
    const sp = o && o.searchSpeed != null ? speedOf(e, 'walk', o.searchSpeed) : (speedOf(e, 'walk') + speedOf(e, 'run')) / 2;
    if (api.moveToward(e, a.lastX, a.lastZ, sp)) { a.reached = true; a.lookYaw = e.yaw; }
    return;
  }
  const k = (api.time % 3) / 3;
  if (k < 0.5) {
    const ly = a.lookYaw + Math.sin(k * TAU * 2) * 1.2;
    api.faceToward(e, e.x - Math.sin(ly) * 3, e.z - Math.cos(ly) * 3);
  } else api.wander(e, speedOf(e, 'walk') * 0.7);
}
// 被玩家盯住：o.gaze = { maxDeg, range, sec, effect: 'freeze' | 'retreat', speed }
function gazed(e, api, a, o) {
  const g = o.gaze;
  if (!g) return false;
  if (playerLooking(e, num(g.maxDeg, 15), num(g.range, 12))) a.gazeUntil = api.time + num(g.sec, 1.5);
  if (!(api.time < a.gazeUntil)) return false;
  const P = nearestPlayer(e);
  if (g.effect === 'retreat' && P) { e.state = 'deterred'; api.flee(e, P.x, P.z, speedOf(e, 'walk', g.speed)); }
  else e.state = 'frozen';
  return true;
}
function lure(e, api, o) {
  if (!o.lure) return;
  const P = nearestPlayer(e);
  if (P && P.dist <= num(o.lure.range, 12)) cry(e, o.lure.sound || 'giggle', { cooldown: num(o.lure.cooldown, 8), chance: o.lure.chance });
}

// 1) 追猎者：巡逻 → 发现（短暂停顿、叫一声）→ 追击 → 近战；丢失目标后去最后位置搜索
const STALKER = {
  sight: null, patrol: 'wander', patrolRadius: 12, patrolSpeed: null, chaseSpeed: null, searchSpeed: null,
  alertSec: 0.5, searchSec: 6, investigate: true, smell: false, gaze: null,
  canTarget: null, onAlert: null, onAttack: null, alertCry: null,
};
function stalker(opts) {
  const o = opt(opts, STALKER);
  function think(e, dt, api) {
    const a = A(e), now = api.time;
    if (gazed(e, api, a, o)) return;
    const t = acquire(e, api, o);
    if (t) {
      if (a.mode !== 'chase' && a.mode !== 'alert') {
        a.mode = 'alert'; a.until = now + o.alertSec;
        if (o.alertCry) cry(e, o.alertCry, { cooldown: 4 });
        if (typeof o.onAlert === 'function') o.onAlert(e, t, api);
      }
      a.lastX = t.x; a.lastZ = t.z; a.reached = false;
      if (a.mode === 'alert') {
        if (now < a.until && t.dist > reach(e, t)) { e.state = 'alert'; api.faceToward(e, t.x, t.z); return; }
        a.mode = 'chase';
      }
      const m = melee(e, api, t);
      if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
      e.state = 'chase';
      api.moveToward(e, t.x, t.z, speedOf(e, 'run', o.chaseSpeed));
      return;
    }
    if (a.mode === 'chase' || a.mode === 'alert') { a.mode = 'search'; a.until = now + o.searchSec; a.reached = false; }
    if (a.hitFromAt != null && now - a.hitFromAt < 1) {
      a.hitFromAt = null; a.mode = 'search'; a.until = now + o.searchSec;
      a.lastX = a.hitFromX; a.lastZ = a.hitFromZ; a.reached = false;
    }
    if (a.mode === 'search') {
      if (now < a.until) { search(e, api, a, o); return; }
      a.mode = 'patrol';
    }
    // 听见/闻到玩家就去查看 —— 只在噩梦模式、只对有害实体：游玩模式里有害实体不该围着玩家转
    if (api.game.attackPlayers && e.def.faction === 'hostile') {
      const cue = (o.investigate && hearPlayer(e, api)) || (o.smell && smellPlayer(e, api));
      if (cue) { a.mode = 'search'; a.until = now + o.searchSec; a.lastX = cue.x; a.lastZ = cue.z; a.reached = false; search(e, api, a, o); return; }
    }
    patrol(e, api, a, o);
  }
  return {
    init(e) { const a = A(e); a.homeX = e.x; a.homeZ = e.z; a.mode = 'patrol'; },
    think, onHit: provokedTurn, dispose: disposeObj,
  };
}

// 2) 群猎：附近同类自动成群；头领游荡、其余排在身后；任一只发现目标就嚎叫并广播集结点，发现者分扇区包抄
const PACK = {
  sight: null, joinRadius: 14, maxPack: 6, spacing: 1.6, flank: true, flankRadius: 3.5, flankSpread: 0.9,
  rallySec: 8, howl: 'growl', howlCooldown: 8, patrolRadius: 16, patrolSpeed: null, chaseSpeed: null,
  canTarget: null, onAttack: null,
};
const packs = new Map();
let packSeq = 0;
function packOf(e, api, o) {
  const a = A(e);
  let p = a.pack != null ? packs.get(a.pack) : null;
  if (p) return p;
  const near = nearby(api, e, o.joinRadius, e.type);
  for (let i = 0; i < near.length; i++) {
    const oa = near[i].data && near[i].data.arch, op = oa && oa.pack != null ? packs.get(oa.pack) : null;
    if (op && op.members.length < o.maxPack) { p = op; break; }
  }
  if (!p) { p = { id: ++packSeq, members: [], rally: null, rallyAt: -1e9, howlAt: -1e9, pruneAt: 0 }; packs.set(p.id, p); }
  p.members.push(e);
  a.pack = p.id;
  return p;
}
function leavePack(e) {
  const a = e && e.data && e.data.arch, p = a && a.pack != null ? packs.get(a.pack) : null;
  if (!p) return;
  const i = p.members.indexOf(e);
  if (i >= 0) p.members.splice(i, 1);
  if (!p.members.length) packs.delete(p.id);
  a.pack = null;
}
if (BR.bus) { BR.bus.on('game:home', () => packs.clear()); BR.bus.on('level:enter', () => packs.clear()); }
function pack(opts) {
  const o = opt(opts, PACK);
  function think(e, dt, api) {
    const a = A(e), now = api.time, p = packOf(e, api, o);
    if (now >= p.pruneAt) {
      p.pruneAt = now + 1;
      for (let i = p.members.length - 1; i >= 0; i--) if (p.members[i].dead || p.members[i].removed) p.members.splice(i, 1);
      if (p.members.indexOf(e) < 0) p.members.push(e);
    }
    const n = p.members.length, idx = p.members.indexOf(e), leader = p.members[0] || e;
    const run = speedOf(e, 'run', o.chaseSpeed);
    const t = acquire(e, api, o);
    if (t) {
      if (now - p.rallyAt > 0.5) { p.rally = { x: t.x, z: t.z }; p.rallyAt = now; }
      if (o.howl && now - p.howlAt > o.howlCooldown) { p.howlAt = now; cry(e, o.howl, { cooldown: 1, hear: 45 }); }
      const m = melee(e, api, t);
      if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
      if (o.flank && n > 1 && t.dist > o.flankRadius * 0.8) {
        // 以"目标 → 群重心"方向为基准，每只分一个扇区角，从几个方向同时逼近，堵住退路
        let cx = 0, cz = 0;
        for (let i = 0; i < n; i++) { cx += p.members[i].x; cz += p.members[i].z; }
        const base = Math.atan2(cx / n - t.x, cz / n - t.z), ang = base + (idx - (n - 1) / 2) * o.flankSpread;
        const px = t.x + Math.sin(ang) * o.flankRadius, pz = t.z + Math.cos(ang) * o.flankRadius;
        if (Math.hypot(px - e.x, pz - e.z) > 1) { e.state = 'flank'; api.moveToward(e, px, pz, run); return; }
      }
      e.state = 'chase';
      api.moveToward(e, t.x, t.z, run);
      return;
    }
    if (p.rally && now - p.rallyAt < o.rallySec) {
      if (Math.hypot(p.rally.x - e.x, p.rally.z - e.z) > 1.5) { e.state = 'rally'; api.moveToward(e, p.rally.x, p.rally.z, run); return; }
      e.state = 'search';
      api.wander(e, speedOf(e, 'walk'));
      return;
    }
    if (leader === e || leader.dead) { patrol(e, api, a, { patrol: 'wander', patrolRadius: o.patrolRadius, patrolSpeed: o.patrolSpeed }); return; }
    const ly = leader.yaw, row = Math.ceil(idx / 2), side = idx % 2 ? -1 : 1;
    const fx = leader.x + Math.sin(ly) * o.spacing * row + Math.cos(ly) * o.spacing * 0.8 * side;
    const fz = leader.z + Math.cos(ly) * o.spacing * row - Math.sin(ly) * o.spacing * 0.8 * side;
    const d = Math.hypot(fx - e.x, fz - e.z);
    if (d > 0.6) { e.state = 'follow'; api.moveToward(e, fx, fz, d > o.spacing * 3 ? run * 0.8 : speedOf(e, 'walk', o.patrolSpeed) * 1.15); }
    else { e.state = 'idle'; api.faceToward(e, e.x - Math.sin(ly), e.z - Math.cos(ly)); }
  }
  return {
    init(e, api) { packOf(e, api, o); },
    think, onHit: provokedTurn,
    dispose(e) { leavePack(e); disposeObj(e); },
  };
}

// 3) 飞行：高度只是表现（anim.fly），水平照常碰撞；被光吸引就飞到最亮处绕圈，惧光就往暗处躲；目标进 diveRange 俯冲，打中后拉起
const FLYER = {
  sight: null, light: null, lightRadius: 10, orbitRadius: 1.8, diveRange: 5, diveSpeed: null, climbSec: 1.0,
  erratic: 0.5, patrolSpeed: null, chaseSpeed: null, canTarget: null, onAttack: null,
};
function flyer(opts) {
  const o = opt(opts, FLYER);
  function think(e, dt, api) {
    const a = A(e), now = api.time, sd = seedOf(e);
    const t = acquire(e, api, o);
    if (t) {
      a.orbit = null;
      if (a.mode === 'climb' && now < a.until) { e.state = 'climb'; api.flee(e, t.x, t.z, speedOf(e, 'run', o.chaseSpeed) * 0.7); return; }
      if (t.dist <= o.diveRange) {
        const m = melee(e, api, t);
        if (m === 'hit') { a.mode = 'climb'; a.until = now + o.climbSec; if (typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
        if (m) return;
        a.mode = 'dive'; e.state = 'dive';
        api.moveToward(e, t.x, t.z, o.diveSpeed != null ? speedOf(e, 'run', o.diveSpeed) : speedOf(e, 'run') * 1.4);
        return;
      }
      a.mode = 'hunt'; e.state = 'fly';
      const side = Math.sin(now * 2.3 + sd) * o.erratic * Math.min(t.dist, 6);   // 飘忽逼近，不走直线
      const ux = (t.x - e.x) / t.dist, uz = (t.z - e.z) / t.dist;
      api.moveToward(e, t.x - uz * side, t.z + ux * side, speedOf(e, 'run', o.chaseSpeed));
      return;
    }
    a.mode = 'idle';
    if (o.light) {
      const here = api.lightAt(e.x, e.z);
      if (o.light === 'attract') {
        const spot = lightSeek(e, api, o.lightRadius, 'bright');
        if (spot && spot.light > here + 0.08) { a.orbit = null; e.state = 'fly'; api.moveToward(e, spot.x, spot.z, speedOf(e, 'walk', o.patrolSpeed)); return; }
        if (here >= LIGHT.dim) {
          if (!a.orbit) a.orbit = { x: e.x, z: e.z };
          const ang = now * 1.2 + sd;
          e.state = 'circle';
          api.moveToward(e, a.orbit.x + Math.cos(ang) * o.orbitRadius, a.orbit.z + Math.sin(ang) * o.orbitRadius, speedOf(e, 'walk', o.patrolSpeed));
          return;
        }
      } else if (here > LIGHT.dark) {
        const spot = lightSeek(e, api, o.lightRadius, 'dark');
        if (spot && spot.light < here - 0.05) { e.state = 'fly'; api.moveToward(e, spot.x, spot.z, speedOf(e, 'run', o.chaseSpeed)); return; }
      }
    }
    e.state = api.wander(e, speedOf(e, 'walk', o.patrolSpeed)) ? 'fly' : 'hover';
  }
  return { think, onHit: provokedTurn, dispose: disposeObj };
}

// 4) 伏击 / 静态陷阱：藏着不动（可要求待在暗处），目标进 triggerRange 突袭 strikeSec 秒，结束后回窝；fixed = 完全不动的陷阱（窗户类）
const AMBUSH = {
  sight: null, triggerRange: 4, revealRange: 0, strikeSpeed: null, strikeSec: 3, fixed: false,
  lurkDark: false, darkThreshold: LIGHT.dim, relocateRadius: 10, returnHome: true, lure: null,
  canTarget: null, onStrike: null, onAttack: null,
};
function ambush(opts) {
  const o = opt(opts, AMBUSH);
  const senseR = o.sight != null ? o.sight : Math.max(o.triggerRange, o.revealRange, 1.5);
  const acq = { sight: senseR, canTarget: o.canTarget };
  function think(e, dt, api) {
    const a = A(e), now = api.time;
    if (a.homeX === undefined) { a.homeX = e.x; a.homeZ = e.z; a.mode = 'hide'; if (o.fixed) e.fixed = true; }
    const t = acquire(e, api, acq);
    if (o.fixed) {
      // e.fixed 让 entities.js 的软分离不再推它；这里的拉回只兜底被外力（传送、手动放置）挪动的情况
      if (e.x !== a.homeX || e.z !== a.homeZ) { e.x = a.homeX; e.z = a.homeZ; }
      if (t) {
        api.faceToward(e, t.x, t.z);
        const m = melee(e, api, t);
        if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
      }
      e.state = t && (o.revealRange <= 0 || t.dist <= o.revealRange) ? 'lurk' : 'hide';
      lure(e, api, o);
      return;
    }
    if (a.mode === 'strike') {
      if (t && now < a.until) {
        const m = melee(e, api, t);
        if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
        e.state = 'strike';
        api.moveToward(e, t.x, t.z, o.strikeSpeed != null ? speedOf(e, 'run', o.strikeSpeed) : speedOf(e, 'run') * 1.3);
        return;
      }
      if (o.returnHome) a.mode = 'return';
      else { a.mode = 'hide'; a.homeX = e.x; a.homeZ = e.z; }
    }
    if (t && t.dist <= o.triggerRange) {
      a.mode = 'strike'; a.until = now + o.strikeSec; e.state = 'strike';
      if (typeof o.onStrike === 'function') o.onStrike(e, t, api);
      return;
    }
    if (a.mode === 'return') {
      e.state = 'return';
      if (api.moveToward(e, a.homeX, a.homeZ, speedOf(e, 'walk'))) a.mode = 'hide';
      return;
    }
    if (o.lurkDark && now >= (a.darkCheck || 0)) {
      a.darkCheck = now + 2;
      if (api.lightAt(a.homeX, a.homeZ) >= o.darkThreshold) {
        const s = lightSeek(e, api, o.relocateRadius, 'dark');
        if (s && s.light < o.darkThreshold) { a.homeX = s.x; a.homeZ = s.z; a.mode = 'return'; e.state = 'return'; return; }
      }
    }
    if (Math.hypot(a.homeX - e.x, a.homeZ - e.z) > 0.8) { a.mode = 'return'; e.state = 'return'; return; }
    if (t && o.revealRange > 0 && t.dist <= o.revealRange) { e.state = 'lurk'; api.faceToward(e, t.x, t.z); }
    else e.state = 'hide';
    lure(e, api, o);
  }
  return { think, onHit: provokedTurn, dispose: disposeObj };
}

// 5) 拟态：伪装态（state 'disguise'）照伪装的样子游荡/靠近，不出手；靠近到 revealRange、被打或被盯着看就现形（'reveal'），
//    之后按追猎者行为追杀；丢失目标 redisguiseSec 秒后重新伪装。模型用 wrap({ disguise, true }) 两个形态
const MIMIC = {
  sight: null, revealRange: 2.5, revealOnHit: true, revealOnLook: 0, revealSec: 0.8,
  disguise: 'wander', disguiseSpeed: null, redisguiseSec: 15, talk: null, chase: null,
  canTarget: null, onReveal: null,
};
function mimic(opts) {
  const o = opt(opts, MIMIC);
  const inner = stalker(Object.assign({ alertSec: 0 }, o.chase || {}, { canTarget: o.canTarget }));
  function think(e, dt, api) {
    const a = A(e), now = api.time;
    if (!a.form) a.form = 'disguise';
    if (a.form === 'disguise') {
      const t = acquire(e, api, o);
      const hit = o.revealOnHit && now - e.hitAt < 0.5;
      const looked = o.revealOnLook > 0 && playerLooking(e, o.revealOnLook, Math.max(6, o.revealRange * 3));
      if (hit || looked || (t && t.dist <= o.revealRange)) {
        a.form = 'reveal'; a.until = now + o.revealSec; e.state = 'reveal';
        if (typeof o.onReveal === 'function') o.onReveal(e, t, api);
        return;
      }
      e.state = 'disguise';
      const sp = speedOf(e, 'walk', o.disguiseSpeed);
      if (o.disguise === 'approach' && t) api.moveToward(e, t.x, t.z, sp);
      else if (o.disguise === 'follow-player') {
        const P = nearestPlayer(e);
        if (P && P.dist > 3 && P.dist < 20) api.moveToward(e, P.x, P.z, sp); else api.wander(e, sp * 0.6);
      } else if (o.disguise !== 'idle') api.wander(e, sp);
      if (o.talk) {
        const P = nearestPlayer(e);
        if (P && P.dist <= num(o.talk.range, 10)) cry(e, o.talk.sound || 'whisper', { cooldown: num(o.talk.cooldown, 7) });
      }
      return;
    }
    if (a.form === 'reveal') {
      e.state = 'reveal';
      if (e.target) api.faceToward(e, e.target.x, e.target.z);
      if (now >= a.until) { a.form = 'true'; a.lostAt = now; a.mode = 'patrol'; }
      return;
    }
    inner.think(e, dt, api);
    if (e.target) a.lostAt = now;
    else if (o.redisguiseSec > 0 && now - a.lostAt > o.redisguiseSec) { a.form = 'disguise'; a.mode = 'patrol'; e.state = 'disguise'; }
  }
  return {
    init(e, api) { inner.init(e, api); A(e).form = 'disguise'; e.state = 'disguise'; },
    think, onHit: provokedTurn, dispose: disposeObj,
  };
}

// 6) 光敏修饰：包在任意骨架外面。avoid = 站在亮处就退缩往暗处躲（可选掉血）、不追亮处的目标；need = 暗处就休眠或去找光
const LIGHTBOUND = { mode: 'avoid', threshold: null, onLight: 'flee', painPerSec: 0, onDark: 'freeze', ignoreLitTargets: true, fleeRadius: 10, checkSec: 0.25 };
function lightBound(inner, opts) {
  const o = opt(opts, LIGHTBOUND);
  const thr = o.threshold != null ? o.threshold : (o.mode === 'need' ? LIGHT.dark : LIGHT.dim);
  function think(e, dt, api) {
    const a = A(e), now = api.time;
    a.avoidLitAbove = o.mode === 'avoid' && o.ignoreLitTargets ? thr : null;
    if (now >= (a.lbT || 0)) { a.lbT = now + o.checkSec; a.lbL = api.lightAt(e.x, e.z); }   // lightAt 要遍历附近灯，别每帧算
    const L = a.lbL;
    if (o.mode === 'avoid' && L >= thr) {
      if (o.painPerSec > 0) {
        a.pain = (a.pain || 0) + o.painPerSec * dt;
        if (a.pain >= 1) { const d = Math.floor(a.pain); a.pain -= d; api.damage(e, d, null); }
      }
      e.state = 'recoil';
      if (o.onLight === 'freeze') return;
      const s = lightSeek(e, api, o.fleeRadius, 'dark');
      if (s) api.moveToward(e, s.x, s.z, speedOf(e, 'run')); else api.wander(e, speedOf(e, 'run'));
      return;
    }
    if (o.mode === 'need' && L < thr) {
      if (o.onDark === 'seek') {
        const s = lightSeek(e, api, o.fleeRadius, 'bright');
        if (s && s.light >= thr) { e.state = 'seek'; api.moveToward(e, s.x, s.z, speedOf(e, 'walk')); return; }
      }
      e.state = 'dormant';
      return;
    }
    inner.think(e, dt, api);
  }
  return Object.assign({}, inner, { think });
}

// 7) 中立游荡：不主动攻击（阵营规则保证 neutral 只会拿到打过它的目标）；被打后反击 / 逃跑 / 血少才逃
const WANDERER = { speed: null, retaliate: 'fight', fleeHp: 0.35, fleeSec: 5, shyRadius: 0, homeRadius: 0, canTarget: null, onAttack: null };
function wanderer(opts) {
  const o = opt(opts, WANDERER);
  function wantsFlee(e) { return o.retaliate === 'flee' || (o.retaliate === 'mixed' && e.hp <= e.maxHp * o.fleeHp); }
  function think(e, dt, api) {
    const a = A(e), now = api.time;
    if (a.homeX === undefined) { a.homeX = e.x; a.homeZ = e.z; }
    if (a.threat && now < (a.fleeUntil || 0)) { e.state = 'flee'; api.flee(e, a.threat.x, a.threat.z, speedOf(e, 'run')); return; }
    const t = acquire(e, api, o);
    if (t) {
      if (wantsFlee(e)) { a.threat = { x: t.x, z: t.z }; a.fleeUntil = now + o.fleeSec; e.state = 'flee'; api.flee(e, t.x, t.z, speedOf(e, 'run')); return; }
      const m = melee(e, api, t);
      if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
      e.state = 'chase';
      api.moveToward(e, t.x, t.z, speedOf(e, 'run'));
      return;
    }
    if (o.shyRadius > 0) {
      const P = nearestPlayer(e);
      if (P && P.dist < o.shyRadius) { e.state = 'shy'; api.flee(e, P.x, P.z, speedOf(e, 'walk', o.speed)); return; }
    }
    if (o.homeRadius > 0 && Math.hypot(e.x - a.homeX, e.z - a.homeZ) > o.homeRadius) { e.state = 'wander'; api.moveToward(e, a.homeX, a.homeZ, speedOf(e, 'walk', o.speed)); return; }
    e.state = api.wander(e, speedOf(e, 'walk', o.speed)) ? 'wander' : 'idle';
  }
  return {
    think,
    onHit(e, amount, attacker, api) {
      provokedTurn(e, amount, attacker, api);
      const a = A(e);
      if (wantsFlee(e) && a.threat) a.fleeUntil = api.time + o.fleeSec;
    },
    dispose: disposeObj,
  };
}

// 8) 友善向导：在玩家附近徘徊、带路（默认带去最近的补给），附近（离玩家 leash 内）有有害实体就先去打 —— 游玩模式里就是守护者
const GUIDE = {
  sight: null, followDist: 3, leadDist: 4.5, waitDist: 9, noticeDist: 25, leash: 12, engage: true,
  leadTo: 'items', seekRadius: 35, goalSec: 2, idle: 'face', canTarget: null, onAttack: null, onLead: null,
};
function guide(opts) {
  const o = opt(opts, GUIDE);
  function goalOf(e, api, a, P) {
    if (api.time < (a.goalAt || 0)) return a.goal;
    a.goalAt = api.time + o.goalSec;
    let g = null;
    if (typeof o.leadTo === 'function') g = o.leadTo(e, api, P);
    else if (o.leadTo === 'items' && has(BR.items, 'nearest')) {
      const it = BR.items.nearest(P.x, P.z, o.seekRadius);
      if (it) g = { x: it.x, z: it.z, kind: 'item', ref: it };
    }
    a.goal = g && Number.isFinite(g.x) && Number.isFinite(g.z) ? g : null;
    return a.goal;
  }
  function playerSpeed(P) { const r = P && P.ref; return r && Number.isFinite(r.vx) ? Math.hypot(r.vx, r.vz) : 0; }
  function think(e, dt, api) {
    const a = A(e), now = api.time, P = nearestPlayer(e);
    if (a.homeX === undefined) { a.homeX = e.x; a.homeZ = e.z; }
    if (o.engage && e.def.attack) {
      const t = acquire(e, api, o);
      if (t && (!P || Math.hypot(t.x - P.x, t.z - P.z) <= o.leash)) {
        const m = melee(e, api, t);
        if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
        e.state = 'guard';
        api.moveToward(e, t.x, t.z, speedOf(e, 'run'));
        return;
      }
    }
    if (!P || P.dist > o.noticeDist) {
      if (Math.hypot(e.x - a.homeX, e.z - a.homeZ) > 6) { e.state = 'wander'; api.moveToward(e, a.homeX, a.homeZ, speedOf(e, 'walk')); }
      else e.state = api.wander(e, speedOf(e, 'walk') * 0.6) ? 'wander' : 'idle';
      return;
    }
    const goal = o.leadTo ? goalOf(e, api, a, P) : null;
    const gd = goal ? Math.hypot(goal.x - P.x, goal.z - P.z) : 0;
    if (goal && gd > 1.5) {
      if (P.dist > o.waitDist) {
        e.state = 'wait';
        if (P.dist > o.waitDist + 3) api.moveToward(e, P.x, P.z, speedOf(e, 'walk'));
        else api.faceToward(e, P.x, P.z);
        return;
      }
      const k = Math.min(o.leadDist, gd) / gd;
      e.state = 'lead';
      const sp = Math.max(speedOf(e, 'walk'), Math.min(speedOf(e, 'run'), playerSpeed(P)));
      if (api.moveToward(e, P.x + (goal.x - P.x) * k, P.z + (goal.z - P.z) * k, sp)) api.faceToward(e, goal.x, goal.z);
      if (typeof o.onLead === 'function') o.onLead(e, goal, api);
      return;
    }
    if (P.dist > o.followDist + 1.2) {
      const k = (P.dist - o.followDist) / P.dist;
      e.state = 'follow';
      api.moveToward(e, e.x + (P.x - e.x) * k, e.z + (P.z - e.z) * k, P.dist > o.waitDist ? speedOf(e, 'run') : speedOf(e, 'walk'));
      return;
    }
    e.state = 'idle';
    if (o.idle === 'orbit') {
      const ang = now * 0.6 + seedOf(e);
      api.moveToward(e, P.x + Math.cos(ang) * o.followDist, P.z + Math.sin(ang) * o.followDist, speedOf(e, 'walk') * 0.6);
    } else api.faceToward(e, P.x, P.z);
  }
  return { init(e) { const a = A(e); a.homeX = e.x; a.homeZ = e.z; }, think, onHit: provokedTurn, dispose: disposeObj };
}

// 9) 小型群体：一个逻辑实体代表一群（hp = 整群血量，个体数随 hp 减少），模型用 parts.swarm（1 个 draw call）
const SWARM = { move: 'flyer', sight: null, light: null, lightRadius: 10, diveRange: 3, erratic: 0.8, patrolRadius: 10, canTarget: null, onAttack: null };
function swarm(opts) {
  const o = opt(opts, SWARM);
  const base = o.move === 'ground'
    ? stalker({ sight: o.sight, patrol: 'wander', patrolRadius: o.patrolRadius, alertSec: 0, searchSec: 3, canTarget: o.canTarget, onAttack: o.onAttack })
    : flyer({ sight: o.sight, light: o.light, lightRadius: o.lightRadius, diveRange: o.diveRange, erratic: o.erratic, climbSec: 0.4, orbitRadius: 1.2, canTarget: o.canTarget, onAttack: o.onAttack });
  return Object.assign({}, base, { dispose: disposeObj });
}

// 10) 环境型：地面/墙面的一片东西，贴上就挨打（接触半径 = def.attack.range + 目标半径）；creep > 0 会慢慢蔓延/爬向目标；可带 san 脉冲
const HAZARD = { creep: 0, seekRange: 0, patch: 0, sanityRadius: 0, sanityPerSec: 0, canTarget: null, onAttack: null };
function hazardEntity(opts) {
  const o = opt(opts, HAZARD);
  function think(e, dt, api) {
    const t = acquire(e, api, { sight: Math.max(o.seekRange, reach(e, null) + 1), canTarget: o.canTarget });
    if (o.sanityPerSec > 0 && o.sanityRadius > 0) sanityPulse(e, api, o.sanityRadius, o.sanityPerSec, 1);
    if (t) {
      const m = melee(e, api, t);
      if (m) { if (m === 'hit' && typeof o.onAttack === 'function') o.onAttack(e, t, api); return; }
    }
    if (o.creep > 0) {
      if (t) { e.state = 'creep'; api.moveToward(e, t.x, t.z, o.creep); }
      else e.state = api.wander(e, o.creep) ? 'creep' : 'idle';
    } else e.state = 'idle';
  }
  return {
    think, dispose: disposeObj,
    // 斑块比碰撞半径大：entities.js 的软分离按 radius 把实体推开，引擎近战按 range + 目标半径判定够不够得着。
    // radius 给小（别的实体才走得到斑块上），这里把 attack.range 抬到至少 patch —— 目标踩到斑块边缘就算接触
    adjustDef(d) {
      if (o.patch > 0 && d.attack) d.attack = Object.assign({}, d.attack, { range: Math.max(num(d.attack.range, 0), o.patch) });
    },
  };
}

// ---------- 注册 ----------
// def.brain = 骨架片段；def.anim = 动画配置（走 arch.animate，自带远处降频）。
// 实体自己的 think(e, dt, api, brain) 会替代骨架 think（自己决定何时调 brain.think）；
// init/onHit/dispose 先跑骨架的再跑自己的；onDeath 默认保留尸体 corpseSec（2.5）秒给倒地动画，自己的 onDeath 返回值优先
function chain2(f, g) {
  if (typeof f !== 'function') return g;
  if (typeof g !== 'function') return f;
  return function (a, b, c, d) { const r1 = f(a, b, c, d), r2 = g(a, b, c, d); return r2 !== undefined ? r2 : r1; };
}
function register(def) {
  const d = Object.assign({}, def);
  const brain = def.brain || null;
  delete d.brain;
  if (brain) {
    if (typeof brain.think !== 'function') throw new Error('[arch] ' + def.type + ' 的 brain 没有 think');
    // 骨架按自己的需要修正数值（hazardEntity 把 attack.range 抬到斑块半径）；注册前做，引擎拿到的就是修正后的
    if (typeof brain.adjustDef === 'function') brain.adjustDef(d);
    d.think = typeof def.think === 'function' ? (e, dt, api) => def.think(e, dt, api, brain) : brain.think;
    d.init = chain2(brain.init, def.init);
    d.onHit = chain2(brain.onHit, def.onHit);
    d.dispose = chain2(brain.dispose || disposeObj, def.dispose);
  } else {
    d.dispose = chain2(disposeObj, def.dispose);
  }
  // 实体之间有软分离，贴身时两者中心相距约 radius + 目标半径；引擎近战要求距离 ≤ attack.range + 目标半径。
  // range 比 radius 小就永远够不着测试人和其他实体（只打得到玩家）—— 实体代理最容易踩的坑，注册时就喊出来
  if (d.attack && num(d.attack.range, 1.2) + 0.05 < num(d.radius, 0.4)) {
    console.warn('[arch] ' + d.type + ' 的 attack.range ' + num(d.attack.range, 1.2) + ' 小于 radius ' + num(d.radius, 0.4) +
      '：实体之间推开后够不着，打不到测试人和其他实体（地面/墙面斑块用 A.hazardEntity({ patch }) 且 radius 给小）');
  }
  const corpse = num(def.corpseSec, 2.5);
  d.onDeath = chain2(() => corpse, def.onDeath);
  if (def.anim) {
    const auto_ = animate(def.anim);
    d.animate = typeof def.animate === 'function'
      ? (e, dt, api) => { auto_(e, dt, api); def.animate(e, dt, api, e.obj && e.obj.userData.arch); }
      : auto_;
  }
  d.archBrain = brain;
  return BR.entityTypes.register(d);
}

// 调研 hostility → faction（WAVE2.md 第 4 节）。varies 必须由实体代理读选中版本原文后显式给出
function faction(hostility, variesAs) {
  const h = String(hostility || '').toLowerCase();
  if (h === 'hostile' || h === 'friendly') return h;
  if (h === 'neutral' || h === 'unknown' || h === '') return 'neutral';
  if (h === 'varies') {
    if (variesAs === 'hostile' || variesAs === 'friendly' || variesAs === 'neutral') return variesAs;
    throw new Error('[arch] hostility 为 varies，必须按选中版本原文给出 hostile/friendly/neutral');
  }
  throw new Error('[arch] 未知 hostility ' + hostility);
}

function customRig(key, fn, o) {
  o = o || {};
  const rec = rigRecord('custom:' + key, fn);
  return instRig(rec, o.mats && !o.colors ? o.mats : resolveMats(o, { body: 0x777777, glow: 0xffffff }));
}
function silhouette(o) {
  o = o || {};
  return humanoid(Object.assign({ thin: 0.5, head: 'faceless', opacity: 0.82 }, o, {
    look: Object.assign({ body: 'shadow', head: 'shadow', hair: 'shadow', claw: 'shadow' }, o.look),
  }));
}

BR.arch = {
  version: 1,
  // 数值档位
  SPEED, HP, DAMAGE, COOLDOWN, SIGHT, HEARING, AURA, LIGHT, TRIS, LOD,
  register, faction,
  // 行为骨架
  stalker, pack, flyer, ambush, mimic, lightBound, wanderer, guide, swarm, hazardEntity,
  // 行为小工具
  state: A, nearestPlayer, playerLooking, hearPlayer, smellPlayer, lightSeek, reach, melee, acquire, speedOf,
  cry, nearby, sanityPulse, patrol, search,
  // 模型
  mat, geo,
  parts: { humanoid, quadruped, insect, limbCluster, rig: customRig, silhouette, glowFace, orb, halo, decal, swarm: swarmPart, hazmat },
  RigBuilder, wrap, trisOf, disposeObj,
  // 动画
  anim: { pose, addRot, addPos, biped, crawl, quad, flap, sway, breathe, twitch, strike, swarm: swarmAnim, auto, lodStep },
  animate,
};
})();
