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
const TRIS = { normal: 4000, swarmUnit: 120, drawCalls: 5 };

// ---------- 材质（BR.assets.material 缓存，全体实例共享） ----------
// matKeys 记下每份缓存材质的键：顶点色 tint 要按"原键 + /vc"派生一份开了 vertexColors 的材质。
// 用 WeakMap 而不是写进 material.userData，是为了不碰任何已有材质对象（不带 tint 的实体材质逐字节不变）
const matKeys = new WeakMap();
function cachedMat(key, make) {
  const m = has(BR.assets, 'material') ? BR.assets.material(key, make) : make();
  if (m && typeof m === 'object' && !matKeys.has(m)) matKeys.set(m, key);
  return m;
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
  // 查缓存键（调试/测试用）：不是经 A.mat 缓存出来的材质返回 null
  keyOf(m) { return (m && matKeys.get(m)) || null; },
};

// 顶点色变体：某个槽位用了 tint，这个槽位的材质就得开 vertexColors。缓存材质按"原键/vc"再缓存一份（全体实例共享）；
// o.mats 直接给的非缓存材质按对象记一份（mat.own 的 entityOwned 标记会随 clone 带过去，实体移除时照常释放）。
// 原材质本身不改：同一份共享材质可能正被不带 tint 的实体用着
const vcByMat = new WeakMap();
function vcMat(m) {
  if (!m || !m.isMaterial || m.vertexColors) return m;
  const key = matKeys.get(m);
  if (key) return cachedMat(key + '/vc', () => { const c = m.clone(); c.vertexColors = true; return c; });
  let c = vcByMat.get(m);
  if (!c) { c = m.clone(); c.vertexColors = true; vcByMat.set(m, c); }
  return c;
}

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

// 近战一步：够得着就出手/等冷却（返回 'hit' | 'wait'），够不着或隔墙没打到返回 false（调用方继续靠近）。
// 'hit' = 起手了；扣血要等胳膊抡到最前（entities.js「近战出手时机」），onLand(e, t, api) 在真的打中那一刻才调（没打中不调）。
// 骨架的 onAttack 一律经这里交给 onLand —— 悲尸的划伤感染跟着扣血走，不在起手时就感染上
function melee(e, api, t, onLand) {
  if (!t || !t.ref || !e.def.attack) return false;
  if (t.dist > reach(e, t)) return false;
  if (e.cooldown > 0) { e.state = 'attack'; api.faceToward(e, t.ref.x, t.ref.z); return 'wait'; }
  if (api.attack(e, t, typeof onLand === 'function' ? onLand : undefined)) { e.state = 'attack'; return 'hit'; }
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
// 可选参数对象 { tint: 0xRRGGBB }：接在各方法原有参数后面，中间省略的可选位置参数（rot / scale / seg / flat）可以不写。
// 只认"普通对象"——数组、类型化数组、几何体都还当原来的位置参数，已有调用的解析结果和改动前完全一样
function isOpts(a) { return !!a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a) && !a.isBufferGeometry; }
function optsIn(args, from) {
  for (let i = from; i < args.length; i++) if (isOpts(args[i])) return args[i];
  return null;
}
RB.geo = function (bone, slot, g, o) {
  const bi = this.index[bone];
  if (bi == null) throw new Error('[arch] 骨骼不存在 ' + bone);
  if (!g || !g.isBufferGeometry) throw new Error('[arch] geo 需要 BufferGeometry');
  const part = { bone: bi, slot: slot || 'body', geo: g };
  if (isOpts(o) && o.tint != null) part.tint = o.tint;   // 不带 tint 的图元记录和改动前一模一样
  // { blend: { bone, y0, y1 } }（返修 FE1R · repair-r5，坐车人形的躯干）：按顶点高度在两根骨骼之间线性蒙皮 —— y ≤ y0 全给 bone、
  // y ≥ y1 全给 blend.bone，中间 smoothstep。不传时和以前一样整块权重 1
  if (isOpts(o) && o.blend && this.index[o.blend.bone] != null) part.blend = { bi: this.index[o.blend.bone], y0: +o.blend.y0, y1: +o.blend.y1 };
  this.parts.push(part);
  return g;
};
RB.box = function (bone, slot, size, center, rot) {
  const T = THREE_();
  const o = optsIn(arguments, 4);
  if (isOpts(rot)) rot = null;
  const g = new T.BoxGeometry(size[0], size[1], size[2]);
  if (rot) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0)));
  g.translate(center[0], center[1], center[2]);
  return this.geo(bone, slot, g, o);
};
RB.sphere = function (bone, slot, r, center, scale, seg) {
  const T = THREE_();
  const o = optsIn(arguments, 4);
  if (isOpts(scale)) scale = null;
  if (isOpts(seg)) seg = null;
  const s = seg || [10, 8];
  const g = new T.SphereGeometry(r, s[0], s[1]);
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  g.translate(center[0], center[1], center[2]);
  return this.geo(bone, slot, g, o);
};
// 两点间的圆台：r0 在 from 端、r1 在 to 端；flat < 1 压扁截面（躯干）
RB.limb = function (bone, slot, from, to, r0, r1, seg, flat) {
  const T = THREE_();
  const o = optsIn(arguments, 6);
  if (isOpts(seg)) seg = undefined;
  if (isOpts(flat)) flat = undefined;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1e-3;
  // { open: true }（FE1R K8）：不要两头的圆盖 —— 两头都埋在关节球 / 躯干里的胳膊腿，盖子永远看不见，省下的面数给更圆的段数
  const g = new T.CylinderGeometry(Math.max(0.002, r1), Math.max(0.002, r0), len, seg || 7, 1, !!(o && o.open));
  if (flat != null && flat !== 1) g.scale(1, 1, flat);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / len, dy / len, dz / len)));
  g.translate(from[0], from[1], from[2]);
  return this.geo(bone, slot, g, o);
};
RB.cone = function (bone, slot, from, to, r, seg) {
  const o = optsIn(arguments, 5);
  if (isOpts(seg)) seg = undefined;
  return this.limb(bone, slot, from, to, r, 0.001, seg || 5, undefined, o);
};
// 骨骼链（触手、尾巴、长脖子）：n 节 n 根骨骼，由粗到细。名字为 name+序号，自动登记到 meta.chains 供 anim.sway 摆动。
// 给了 { tint } 时每一节都上同一个色
RB.chain = function (name, parent, from, dir, n, length, r0, r1, slot, seg) {
  const o = optsIn(arguments, 9);
  if (isOpts(seg)) seg = undefined;
  const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ux = dir[0] / L, uy = dir[1] / L, uz = dir[2] / L, sl = length / n;
  const names = [];
  let prev = parent;
  for (let k = 0; k < n; k++) {
    const a = [from[0] + ux * sl * k, from[1] + uy * sl * k, from[2] + uz * sl * k];
    const b = [a[0] + ux * sl, a[1] + uy * sl, a[2] + uz * sl];
    prev = this.bone(name + k, prev, a);
    this.limb(prev, slot, a, b, U.lerp(r0, r1, k / n), U.lerp(r0, r1, (k + 1) / n), seg || 6, undefined, o);
    names.push(prev);
  }
  this.meta.chains.push(names);
  return names;
};
RB.setBase = function (name, rx, ry, rz, px, py, pz) { this.base[name] = [rx || 0, ry || 0, rz || 0, px || 0, py || 0, pz || 0]; };

// rgb：只有骨架里用了 tint 才传（[r, g, b]，未上色图元传 [1, 1, 1]）；不传时输出和改动前逐字节一样，没有 color 属性
function prepGeo(g, bi, nonIndexed, rgb, blend) {
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
  if (blend) {
    // 权重大的那根排第一（测试、调试按 skinIndex.x 认骨骼的照旧认得出）
    const P = src.attributes.position, d = blend.y1 - blend.y0;
    for (let i = 0; i < n; i++) {
      const t = d > 0 ? U.clamp((P.getY(i) - blend.y0) / d, 0, 1) : P.getY(i) >= blend.y0 ? 1 : 0, w = t * t * (3 - 2 * t);
      if (w > 0.5) { si[i * 4] = blend.bi; sw[i * 4] = w; si[i * 4 + 1] = bi; sw[i * 4 + 1] = 1 - w; }
      else { si[i * 4] = bi; sw[i * 4] = 1 - w; si[i * 4 + 1] = blend.bi; sw[i * 4 + 1] = w; }
    }
  } else for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
  out.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
  if (rgb) {
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
    out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  }
  return out;
}

// tint → 顶点色分量。hex 走 THREE.Color.setHex，和材质颜色同一条换算路径（色彩管理开关变了两边也一致）；
// 也接受 [r, g, b] 浮点（可以 >1，用来把某块提亮到超过槽位材质色）。最终颜色 = 槽位材质色 × tint
const WHITE_RGB = [1, 1, 1];
function tintRGB(t) {
  if (t == null) return WHITE_RGB;
  if (Array.isArray(t)) return [num(t[0], 1), num(t[1], 1), num(t[2], 1)];
  const c = new (THREE_().Color)();
  c.setHex(num(t, 0xffffff) & 0xffffff);
  return [c.r, c.g, c.b];
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
  // 顶点色 tint：只要有一个图元带 tint，全部槽位的几何都得带 color 属性——槽位之间最后还要合并成一份几何，
  // mergeBufferGeometries 要求属性集合一致。未上色的图元写纯白（乘到材质色上等于不变）；只有真正出现 tint 的槽位才换 vc 材质
  const tinted = [];
  for (const p of b.parts) if (p.tint != null && tinted.indexOf(p.slot) < 0) tinted.push(p.slot);
  const slots = [], bySlot = new Map();
  for (const p of b.parts) {
    if (!bySlot.has(p.slot)) { bySlot.set(p.slot, []); slots.push(p.slot); }
    bySlot.get(p.slot).push(prepGeo(p.geo, p.bone, nonIndexed, tinted.length ? tintRGB(p.tint) : null, p.blend));
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
    tinted: tinted.length ? tinted : null,   // 用了 tint 的槽位名；null = 没用 tint
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
  const tinted = rec.tinted;
  const mesh = new T.SkinnedMesh(rec.geometry, rec.slots.map(s => {
    const m = slotMat(mats, s);
    return tinted && tinted.indexOf(s) >= 0 ? vcMat(m) : m;
  }));
  for (let i = 0; i < bones.length; i++) if (rec.bones[i].parent < 0) mesh.add(bones[i]);
  mesh.bind(new T.Skeleton(bones, rec.inverses), identity());
  // slots：材质数组下标 → 槽位名，给 u.slotMat 按槽位名找下标用
  const rig = { key: rec.key, mesh, skeleton: mesh.skeleton, bones: {}, list: [], meta: rec.meta, slots: rec.slots };
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
  o = Object.assign({
    width: 0.3, eyes: 2, eyeSize: null, eyeGap: null, eyeY: null, eyeShape: 'round', smile: true, teeth: 12, rows: 2, smileWidth: null, smileY: null, curve: null, toothH: null,
    gumLine: false, eyeHighlight: false, toothShape: 'block',   // 新增可选：牙龈线 / 眼睛高光 / 尖牙形，缺省关闭，外观与旧版一致
  }, o);
  const W = o.width, list = [];
  const es = o.eyeSize != null ? o.eyeSize : W * 0.12;
  const gap = o.eyeGap != null ? o.eyeGap : W * 0.42;
  const ey = o.eyeY != null ? o.eyeY : W * 0.18;
  for (let i = 0; i < o.eyes; i++) {
    const x = o.eyes === 1 ? 0 : (i / (o.eyes - 1) - 0.5) * gap;
    // 20 边（FE1R K8：2 m 近拍笑魇的眼睛，10 边能数出棱角；眼睛直径约 50 px，20 边每段 ≤6 px、弦高 <0.4 px）
    const g = new T.CircleGeometry(es, 20).rotateY(Math.PI);
    if (o.eyeShape === 'slit') g.scale(1, 0.35, 1);
    else if (o.eyeShape === 'tall') g.scale(0.6, 1.4, 1);
    list.push(g.translate(x, ey, 0));
    if (o.eyeHighlight) list.push(new T.CircleGeometry(es * 0.32, 12).rotateY(Math.PI).translate(x - es * 0.35, ey + es * 0.32, 0.002));   // 单独成形的小高光点，偏眼角一侧凸出主眼轮廓
  }
  if (o.smile && o.teeth > 0) {
    const sw = o.smileWidth != null ? o.smileWidth : W * 0.8;
    const sy = o.smileY != null ? o.smileY : -W * 0.14;
    const cv = o.curve != null ? o.curve : W * 0.14;
    const th = o.toothH != null ? o.toothH : W * 0.09;
    const n = o.teeth, tw = sw / n * 0.78;
    if (o.gumLine) list.push(new T.BoxGeometry(sw * 1.02, th * 0.22, W * 0.018).translate(0, sy + cv * -0.5 + th * 0.55, 0));   // 牙龈线：贴在牙齿上缘的一条薄脊
    for (let row = 0; row < Math.max(1, o.rows); row++) {
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : i / (n - 1) - 0.5;
        const g = o.toothShape === 'fang' ? new T.ConeGeometry(tw * 0.5, th * (1 - 0.3 * Math.abs(2 * u)), 4) : new T.BoxGeometry(tw, th * (1 - 0.45 * Math.abs(2 * u)), W * 0.02);
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
// 精细度：'high'/'low' 显式给就直接用；缺省跟 BR.game.settings.quality（'low' 时退回接近旧版本的简版，
// 保手机低画质帧率）。每个构件入口只解析一次、写回 o.detail，几何缓存键因此按解析结果区分（同参数不同画质
// 不会撞进同一份缓存几何），构建函数内部只看 o.detail 这个已解析好的字符串
function resolveDetail(v) {
  if (v === 'high' || v === 'low') return v;
  const s = BR.game && BR.game.settings;
  return s && s.quality === 'low' ? 'low' : 'high';
}
// 可选追加项统一解析：true = 全部打开；对象 = 挑着开（没列出的键当关闭）；假值 = 不加
function resolveToggle(v, all) { return v === true ? all : (v && typeof v === 'object' ? v : null); }

const HUMANOID_FEATURES_ALL = { brow: true, nose: true, ears: true, jaw: true };
const HUMANOID_CLOTHES_ALL = { collar: true, cuffs: true, belt: true, pockets: true, creases: true };

// 五官（仅 head:'round' 时可用）：眉骨、鼻、耳、下颌，全部挂在 head 骨骼、body 槽位，不新增材质槽位
function buildFace(b, feats, hr, headY) {
  const F = resolveToggle(feats, HUMANOID_FEATURES_ALL);
  if (!F) return;
  if (F.brow) for (const s of [-1, 1]) b.box('head', 'head', [hr * 0.4, hr * 0.09, hr * 0.16], [s * hr * 0.36, headY + hr * 0.24, -hr * 0.82]);
  if (F.nose) b.cone('head', 'head', [0, headY + hr * 0.02, -hr * 0.95], [0, headY - hr * 0.14, -hr * 1.16], hr * 0.13, 4);
  if (F.ears) for (const s of [-1, 1]) b.sphere('head', 'head', hr * 0.24, [s * hr * 0.98, headY, -hr * 0.05], [0.5, 1, 0.85], [6, 5]);
  if (F.jaw) b.box('head', 'head', [hr * 0.62, hr * 0.26, hr * 0.48], [0, headY - hr * 0.82, -hr * 0.48]);
}
// 手指：claws:0 且 hands 时才加（claws>0 保留原来的爪造型，不重复叠手指），四指+一根拇指，body 槽位
// slot / o（{ tint }）可选：防化服的手套（hazmat）用 gear 槽位、手套色；不给就是原来的 body 槽位，几何一点不变
function buildFingers(b, bone, x, handY, H, th, slot, o) {
  const fw = 0.011 * H * th, fl = 0.05 * H, sl = slot || 'body', op = o || undefined;
  for (let i = 0; i < 4; i++) b.box(bone, sl, [fw, fl, fw], [x, handY - 0.06 * H, (i - 1.5) * 0.017 * H - 0.02 * H], op);
  b.box(bone, sl, [fw * 1.1, fl * 0.7, fw * 1.1], [x + (x < 0 ? -1 : 1) * 0.02 * H, handY - 0.02 * H, 0.025 * H], op);
}
// 衣着细节：领口/腰带叠在躯干骨骼上，袖口/口袋/裤腿褶叠在对应手臂/腿骨骼上，全部 body 槽位、不新增材质槽位
function buildLimbClothes(b, C, L, x, hx, H, th, handY, hipY, kneeY) {
  const sg = (b.meta.seg && b.meta.seg.limb) || 6;
  if (C.cuffs) b.limb('fore' + L, 'body', [x, handY + 0.045 * H, 0], [x, handY + 0.03 * H, 0], 0.026 * H * th, 0.03 * H * th, sg);
  if (C.pockets) b.box('leg' + L, 'body', [0.014, 0.05 * H, 0.045 * H], [hx * 1.02, (hipY + kneeY) * 0.5, 0.03 * H]);
  if (C.creases) for (let i = 0; i < 2; i++) {
    const y = U.lerp(kneeY, 0.05 * H, (i + 1) / 3);
    b.limb('shin' + L, 'body', [hx, y + 0.012 * H, 0], [hx, y - 0.008 * H, 0], 0.03 * H * th, 0.035 * H * th, sg);
  }
}
function buildTorsoClothes(b, C, H, th, shY, hipY) {
  const sg = (b.meta.seg && b.meta.seg.torso) || 8;
  if (C.collar) b.limb('spine', 'body', [0, shY + 0.014 * H, 0], [0, shY - 0.008 * H, 0], 0.036 * H * th, 0.045 * H * th, sg);
  if (C.belt) b.limb('hips', 'body', [0, hipY + 0.016 * H, 0], [0, hipY - 0.012 * H, 0], 0.086 * H * th, 0.093 * H * th, sg);
}

const HUMANOID = {
  height: 1.8, thin: 0, bulk: 1, hunch: 0, pose: 'upright', armLen: 1, legLen: 1, headSize: 1, shoulders: 1, neck: 1,
  head: 'round', hands: true, feet: true, claws: 0, hair: 0, face: null,
  detail: null, features: false, clothes: false,   // 新增可选参数，见 _TEMPLATE.md 6.1/6.9
  round: null,   // FE1R K8：true = 按大小定圆的段数（实体的 build 里缺省 true，别处缺省照旧），见 humSeg
};
// 圆的段数（FE1R K8，孩子：「圆的东西看起来要圆」）：按这个圆实际多大定 —— 从驾驶座看 1.3 m 外的悲尸，头半径约 62 px（每米约 512 px，
// 1280×720、竖直视野 75°），每段边离真圆最远的那一点（弦高）≤1 px：N ≥ π / acos(1 − 1/半径像素)。悲尸头 0.12 m → 18 段（竖直 12），
// 胳膊腿 0.035 m → 10 段，关节球 → 10×6；小个子（毛绒恐龙 0.62 m）自然少几段，大个子（钝人）多几段。
// 高画质：头 [≥10, ≤24]、躯干 [8, 16]（扁的胸廓、腰臀球竖直方向只要一半）、四肢 / 脖子 [10, 14]、关节球 ≥10×6；
// 低画质（每只 4000 面以内尽量圆）：同一个公式按每米 256 px 算，头 ≤14、躯干 ≤10、四肢 ≤8、关节球（低画质本来没有）。
// 以前高低一样：头 10×8、四肢 6、关节 6×4、躯干 8。o.seg 整组或逐项覆盖（坐在叉车上的防化服用更圆的一套，见 hazmat 的 seat）。
// 结果写进 b.meta.seg，extend 回调照着用
const SEG_PX = { high: 512, low: 256 };
function segFor(r, q, lo, hi) {
  const px = Math.max(1.01, r * SEG_PX[q]);
  return Math.max(lo, Math.min(hi, Math.ceil(Math.PI / Math.acos(1 - 1 / px))));
}
const HUM_SEG_LEGACY = Object.freeze({ torso: 8, limb: 6, head: [10, 8], faceless: [12, 10], joint: [6, 4], neck: 6, small: [8, 6] });
let ROUND = 0;   // >0：正在建实体的模型（register 包的 build 里）
function humSeg(o, H, th, hr) {
  // 不是实体的模型（层级道具：L15 的尸体），也没给 o.seg：照旧的段数，几何逐字节和以前一样（世界生成金样）
  if (!o.round) return o.seg && typeof o.seg === 'object' ? Object.assign({}, HUM_SEG_LEGACY, o.seg) : HUM_SEG_LEGACY;
  const q = o.detail === 'low' ? 'low' : 'high', hi = q === 'high';
  const head = segFor(hr * 1.08, q, 10, hi ? 20 : 14);
  // 四肢、关节球、躯干按裁定的下限给（四肢 10、关节球 10×6；躯干 12），不再往上加 —— 每只 4000 面的预算主要留给头
  const base = {
    torso: hi ? 12 : 10, limb: hi ? 10 : 8, head: [head, Math.max(8, Math.ceil(head * 2 / 3))], faceless: [head, Math.max(10, Math.ceil(head * 0.75))],
    joint: hi ? [10, 6] : [6, 4], neck: hi ? 10 : 8, small: [8, 6],
  };
  return o.seg && typeof o.seg === 'object' ? Object.assign(base, o.seg) : base;
}
function buildHumanoid(b, o) {
  const hi = o.detail !== 'low';   // humanoid() 已经把 o.detail 解析成 'high'/'low'
  const H = o.height, th = (1 - 0.45 * U.clamp(o.thin, 0, 1)) * o.bulk;
  const dy = (o.legLen - 1) * 0.5 * H;
  const hipY = 0.5 * H * o.legLen, kneeY = 0.27 * H * o.legLen;
  const shY = 0.8 * H + dy, neckTop = shY + 0.045 * H * o.neck;
  const hr = 0.068 * H * o.headSize, headY = neckTop + hr * 0.9;
  const shW = 0.105 * H * o.shoulders * (0.75 + 0.25 * th), hipW = 0.055 * H * (0.7 + 0.3 * th);
  const elbowY = shY - 0.01 * H - 0.18 * H * o.armLen, handY = elbowY - 0.19 * H * o.armLen;
  b.meta.dims = { H, hipY, kneeY, shoulderY: shY, headY, headR: hr, shoulderW: shW, hipW, elbowY, handY };
  const SG = humSeg(o, H, th, hr);
  b.meta.seg = SG;
  const C = hi ? resolveToggle(o.clothes, HUMANOID_CLOTHES_ALL) : null;

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

  // o.torso === false（FE1R repair-r4，坐车的防化服）：不建躯干（胯盒、脊柱圆台、胸廓 / 腰臀球、锁骨隆起），骨骼照旧 —— 躯干由 extend 换成 hazmat.glb 的那一份
  if (o.torso !== false) b.box('hips', 'body', [0.19 * H * th, 0.09 * H, 0.11 * H * th], [0, hipY + 0.02 * H, 0]);
  if (o.torso === false) { /* 见上 */ } else if (hi) {
    // 胸廓与腰臀起伏：腰部收窄、胸腔鼓起再收回肩线，比单段直筒躯干多一层体型轮廓（低画质保留原来的单段直筒）
    const waistY = U.lerp(hipY + 0.05 * H, shY + 0.02 * H, 0.34), chestY = U.lerp(hipY + 0.05 * H, shY + 0.02 * H, 0.8);
    const waistR = 0.062 * H * th, chestR = 0.108 * H * th * o.shoulders, topR = 0.09 * H * th * o.shoulders;
    const TOPEN = o.seg || !o.round ? undefined : { open: true };   // 中间两段的盖子夹在上下两段里看不见（防化服、层级道具照旧封口）
    b.limb('spine', 'body', [0, hipY + 0.05 * H, 0], [0, waistY, 0], 0.078 * H * th, waistR, SG.torso, 0.62, TOPEN);   // 下头埋在胯里、上头接腰
    b.limb('spine', 'body', [0, waistY, 0], [0, chestY, 0], waistR, chestR, SG.torso, 0.72, TOPEN);
    b.limb('spine', 'body', [0, chestY, 0], [0, shY + 0.02 * H, 0], chestR, topR, SG.torso, 0.6);
    b.sphere('spine', 'body', chestR * 0.96, [0, chestY - 0.015 * H, 0.006 * H], [1.05, 0.7, 0.6 * th], [SG.torso, Math.max(6, SG.torso >> 1)]);
    b.sphere('hips', 'body', 0.078 * H * th * 0.92, [0, hipY + 0.06 * H, 0], [1.08, 0.5, 0.95 * th], [SG.torso, Math.max(6, SG.torso >> 1)]);
    if (C) buildTorsoClothes(b, C, H, th, shY, hipY);
  } else {
    b.limb('spine', 'body', [0, hipY + 0.05 * H, 0], [0, shY + 0.02 * H, 0], 0.075 * H * th, 0.1 * H * th * o.shoulders, SG.torso, 0.6);
  }
  if (o.head !== 'none') {
    b.limb('head', 'body', [0, shY, 0], [0, neckTop + hr * 0.3, 0], 0.028 * H * th, 0.024 * H * th, SG.neck);
    if (hi && o.torso !== false) b.sphere('spine', 'body', 0.034 * H * th, [0, shY + 0.005 * H, 0], [1, 0.6, 1], SG.joint);   // 肩颈过渡的锁骨隆起
    if (o.head === 'box') b.box('head', 'head', [hr * 1.7, hr * 2.1, hr * 1.8], [0, headY, 0]);
    else if (o.head === 'faceless') b.sphere('head', 'head', hr, [0, headY, 0], [0.86, 1.22, 0.92], SG.faceless);
    else b.sphere('head', 'head', hr, [0, headY, 0], [0.92, 1.08, 0.98], SG.head);
    if (hi && o.head === 'round' && o.features) buildFace(b, o.features, hr, headY);
    if (o.hair > 0) b.limb('head', 'hair', [0, headY + hr * 1.1, hr * 0.15], [0, headY + hr - o.hair * H, hr * 0.35], hr * 1.02, hr * 0.75, o.round ? SG.head[0] : 8);
    if (o.face) b.geo('head', 'glow', glowFaceGeo(Object.assign({ width: hr * 1.5 }, o.face)).translate(0, headY + hr * 0.1, -hr * 0.95));
  }
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R', x = s * shW, hx = s * hipW;
    // 高画质两头埋在关节球里的段不要圆盖（关节球半径 ≥ 这一段的半径、球心就在这一段的端点上，怎么转盖子都在球里）
    const OPEN = hi && o.round && !o.seg ? { open: true } : undefined;   // 防化服（坐车 / 伪装，给了 o.seg）、层级道具照旧封口
    b.limb('arm' + L, 'body', [x, shY - 0.005 * H, 0], [x, elbowY, 0], 0.03 * H * th, 0.024 * H * th, SG.limb, OPEN);
    if (hi) { b.sphere('arm' + L, 'body', 0.031 * H * th, [x, shY - 0.005 * H, 0], [1, 0.85, 1], SG.joint); b.sphere('fore' + L, 'body', 0.025 * H * th, [x, elbowY, 0], null, SG.joint); }   // 肩/肘关节球
    b.limb('fore' + L, 'body', [x, elbowY, 0], [x, handY + 0.02 * H, 0], 0.024 * H * th, 0.018 * H * th, SG.limb, OPEN && o.hands ? OPEN : undefined);
    if (o.hands) {
      b.box('fore' + L, 'body', [0.035 * H * th + 0.01, 0.06 * H, 0.05 * H * th + 0.01], [x, handY - 0.005 * H, 0]);
      if (hi && !o.claws) buildFingers(b, 'fore' + L, x, handY, H, th);
    }
    for (let c = 0; c < o.claws; c++) {
      const cz = (c - (o.claws - 1) / 2) * 0.018 * H;
      b.cone('fore' + L, 'claw', [x, handY - 0.03 * H, cz], [x, handY - 0.1 * H, cz - 0.02 * H], 0.006 * H, 4);
    }
    b.limb('leg' + L, 'body', [hx, hipY, 0], [hx, kneeY, 0], 0.042 * H * th, 0.033 * H * th, SG.limb);
    if (hi) b.sphere('shin' + L, 'body', 0.034 * H * th, [hx, kneeY, 0], [1, 0.8, 1], SG.joint);   // 膝关节球
    b.limb('shin' + L, 'body', [hx, kneeY, 0], [hx, 0.045 * H, 0], 0.032 * H * th, 0.022 * H * th, SG.limb);
    if (o.feet) {
      if (hi) {
        b.box('shin' + L, 'body', [0.05 * H * th + 0.015, 0.03 * H, 0.15 * H], [hx, 0.015 * H, -0.05 * H]);   // 脚掌：更长更扁
        b.box('shin' + L, 'body', [0.036 * H * th + 0.012, 0.038 * H, 0.05 * H], [hx, 0.019 * H, 0.03 * H]);  // 脚跟：更高更短
      } else {
        b.box('shin' + L, 'body', [0.045 * H * th + 0.015, 0.035 * H, 0.12 * H], [hx, 0.0175 * H, -0.03 * H]);
      }
    }
    if (C) buildLimbClothes(b, C, L, x, hx, H, th, handY, hipY, kneeY);
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
  o.detail = resolveDetail(o.detail);
  if (o.round == null) o.round = ROUND > 0 || !!(o.seg && typeof o.seg === 'object');   // 进几何缓存键：圆的 / 照旧的是两份几何
  const rec = rigRecord(geoKey('humanoid', o), b => buildHumanoid(b, o));
  return instRig(rec, resolveMats(o, { body: 0x6e675c, head: null, hair: 0x111111, claw: 0x2a2520, glow: 0xffffff }));
}

const QUAD = { length: 1.1, height: 0.6, girth: 0.2, thin: 0, neckLen: 0.28, headSize: 0.2, snout: 0.12, jaw: true, tail: 0.4, ears: 0, mane: 0, legThick: 1, eyes: null, face: null, detail: null };
function buildQuad(b, o) {
  const hi = o.detail !== 'low';
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
  if (hi) {
    // 分节脊背 + 肋骨起伏：胸腔和骨盆之间加两个大小交替的鼓包，比单段直筒脊背多几分肋骨轮廓
    const midZ1 = U.lerp(hipZ + G * 0.3, chestZ * 0.15, 0.32), midZ2 = U.lerp(hipZ + G * 0.3, chestZ * 0.15, 0.66);
    b.sphere('hips', 'body', G * 0.98, [0, bodyY + G * 0.05, midZ1], [1, 0.86, 1], [8, 6]);
    b.sphere('hips', 'body', G * 0.86, [0, bodyY + G * 0.02, midZ2], [0.94, 0.82, 0.9], [6, 5]);
  }
  b.limb('neck', 'body', neckBase, headC, G * 0.55, G * 0.42, 6);
  b.sphere('head', 'head', hs * 0.5, headC, [0.9, 0.85, 1.1], [10, 8]);
  if (o.snout > 0) b.box('head', 'head', [hs * 0.5, hs * 0.32, o.snout], [0, headC[1] - hs * 0.06, headC[2] - hs * 0.42 - o.snout * 0.5]);
  if (o.jaw) b.box('jaw', 'head', [hs * 0.45, hs * 0.12, o.snout + hs * 0.3], [0, headC[1] - hs * 0.28, headC[2] - hs * 0.28 - o.snout * 0.5]);
  if (o.jaw && hi) {
    // 嘴部牙列：上颚/下颚各三颗小尖牙，贴着 snout/jaw 前缘
    const frontZ = headC[2] - hs * 0.42 - o.snout, jawFrontZ = headC[2] - hs * 0.28 - o.snout * 0.5;
    for (let i = 0; i < 3; i++) {
      const tx = (i - 1) * hs * 0.16;
      b.cone('head', 'head', [tx, headC[1] - hs * 0.04, frontZ], [tx, headC[1] - hs * 0.16, frontZ - hs * 0.08], hs * 0.035, 4);
      b.cone('jaw', 'head', [tx, headC[1] - hs * 0.24, jawFrontZ], [tx, headC[1] - hs * 0.13, jawFrontZ - hs * 0.06], hs * 0.03, 4);
    }
  }
  if (o.eyes) {
    const es = o.eyes.size || hs * 0.09;
    for (const s of [-1, 1]) b.sphere('head', o.eyes.glow === false ? 'eye' : 'glow', es, [s * hs * 0.22, headC[1] + hs * 0.1, headC[2] - hs * 0.4], null, [6, 4]);
  }
  if (o.face) b.geo('head', 'glow', glowFaceGeo(Object.assign({ width: hs * 0.9 }, o.face)).translate(0, headC[1], headC[2] - hs * 0.56 - o.snout));
  if (o.ears > 0) for (const s of [-1, 1]) b.cone('head', 'head', [s * hs * 0.25, headC[1] + hs * 0.3, headC[2]], [s * hs * 0.35, headC[1] + hs * 0.3 + o.ears, headC[2] + hs * 0.1], hs * 0.1, 4);
  if (o.tail > 0) b.chain('tail', 'hips', [0, bodyY + G * 0.3, hipZ + G * 1.1], [0, 0.25, 1], hi ? 4 : 3, o.tail, G * 0.3, 0.01, 'body', 5);
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
    if (hi) b.sphere('leg' + nm, 'body', G * 0.26 * lt, [x, knee, kz], [1, 0.85, 1], [6, 4]);   // 腿部关节球
    b.limb('shin' + nm, 'body', [x, knee, kz], [x, 0.03, z], G * 0.22 * lt, G * 0.15 * lt, 6);
    const footZ = z - G * 0.08, footHalfD = (G * 0.45 * lt + 0.02) / 2;
    b.box('shin' + nm, 'body', [G * 0.3 * lt + 0.01, 0.04, G * 0.45 * lt + 0.02], [x, 0.02, footZ]);
    if (hi) {
      // 爪与趾：脚掌前缘三根小趾爪
      const toeZ = footZ - footHalfD;
      for (let c = 0; c < 3; c++) {
        const cx = x + (c - 1) * G * 0.14 * lt;
        b.cone('shin' + nm, 'body', [cx, 0.045, toeZ], [cx, 0.008, toeZ - G * 0.14 * lt], G * 0.045 * lt, 4);
      }
    }
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function quadruped(opts) {
  const o = Object.assign({}, QUAD, opts);
  o.detail = resolveDetail(o.detail);
  const rec = rigRecord(geoKey('quad', o), b => buildQuad(b, o));
  return instRig(rec, resolveMats(o, { body: 0x5a5046, head: null, fur: 0x151210, eye: 0x111111, glow: 0xffffff }));
}

const INSECT = { span: 0.5, bodyLen: 0.28, bodyR: 0.045, wings: 2, wingChord: 0.6, legs: 6, antennae: 0.12, eyes: null, detail: null };
function buildInsect(b, o) {
  const T = THREE_();
  const hi = o.detail !== 'low';
  const r = o.bodyR, Lb = o.bodyLen, y = r * 1.6 + 0.02, half = o.span / 2;
  b.meta.dims = { y, bodyR: r, bodyLen: Lb, span: o.span };
  b.bone('body', null, [0, y, 0]);
  b.bone('head', 'body', [0, y, -Lb * 0.38]);
  b.sphere('body', 'body', r, [0, y, 0], [1, 0.95, 1.3], [8, 6]);
  if (hi) b.limb('body', 'body', [0, y - r * 0.02, r * 0.06], [0, y - r * 0.08, Lb * 0.22], r * 0.56, r * 0.5, 6);   // 分节胸腹：胸/腹之间的细腰
  b.sphere('body', 'body', r * 0.95, [0, y - r * 0.1, Lb * 0.35], [0.9, 0.85, 2.2], [8, 6]);
  b.sphere('head', 'body', r * 0.7, [0, y + r * 0.1, -Lb * 0.38], null, [8, 6]);
  if (o.eyes) for (const s of [-1, 1]) b.sphere('head', o.eyes.glow === false ? 'eye' : 'glow', o.eyes.size || r * 0.3, [s * r * 0.45, y + r * 0.25, -Lb * 0.38 - r * 0.45], null, [6, 4]);
  if (o.antennae > 0) {
    if (hi) {
      // 触角分节：两节链条，自动带 anim.sway 摆动
      for (const s of [-1, 1]) b.chain('ant' + (s < 0 ? 'L' : 'R'), 'head', [s * r * 0.3, y + r * 0.5, -Lb * 0.45], [s * 0.55, 0.9, -0.55], 2, o.antennae, 0.0045, 0.0015, 'body', 4);
    } else {
      for (const s of [-1, 1]) b.limb('head', 'body', [s * r * 0.3, y + r * 0.5, -Lb * 0.45], [s * o.antennae * 0.5, y + o.antennae * 0.8, -Lb * 0.45 - o.antennae * 0.6], 0.004, 0.002, 3);
    }
  }
  const pairs = Math.floor(o.legs / 2);
  for (let i = 0; i < pairs; i++) {
    const z = (i - (pairs - 1) / 2) * r * 0.9, z2 = z + (i - (pairs - 1) / 2) * r * 0.8;
    for (const s of [-1, 1]) {
      if (hi) {
        // 腿分节：两段带一个弯折点，比一根直棍更像虫腿
        const kx = s * (r * 0.8 + Lb * 0.18), ky = y - r * 0.15, kz = z + (z2 - z) * 0.5;
        b.limb('body', 'body', [s * r * 0.8, y - r * 0.4, z], [kx, ky, kz], 0.006, 0.0045, 3);
        b.limb('body', 'body', [kx, ky, kz], [s * (r * 0.8 + Lb * 0.35), 0.005, z2], 0.0045, 0.003, 3);
      } else {
        b.limb('body', 'body', [s * r * 0.8, y - r * 0.4, z], [s * (r * 0.8 + Lb * 0.35), 0.005, z2], 0.006, 0.003, 3);
      }
    }
  }
  const wingPairs = o.wings >= 4 ? 2 : o.wings >= 2 ? 1 : 0;
  for (let wi = 0; wi < wingPairs; wi++) {
    for (const s of [-1, 1]) {
      const nm = 'wing' + (s < 0 ? 'L' : 'R') + (wi ? '2' : '');
      const z = wi ? r * 1.2 : -r * 0.2, chord = half * o.wingChord * (wi ? 0.75 : 1);
      b.bone(nm, 'body', [s * r * 0.7, y + r * 0.6, z]);
      b.geo(nm, 'wing', new T.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2).scale(half, 1, chord).translate(s * (r * 0.7 + half / 2), y + r * 0.6, z + (wi ? chord * 0.3 : 0)));
      if (hi) for (let vi = 0; vi < 3; vi++) {
        // 翅脉：三条从翅根到翅尖的细脊
        const vr = 0.22 + vi * 0.3;
        b.box(nm, 'wing', [half * 0.6, 0.001, chord * 0.02], [s * (r * 0.7 + half * vr), y + r * 0.6 + 0.001, z + (wi ? chord * 0.3 : 0)]);
      }
    }
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function insect(opts) {
  const o = Object.assign({}, INSECT, opts);
  o.detail = resolveDetail(o.detail);
  const rec = rigRecord(geoKey('insect', o), b => buildInsect(b, o));
  return instRig(rec, resolveMats(o, { body: 0x4b3f33, wing: 0x8a7a62, eye: 0x111111, glow: 0xffffff }));
}

const CLUSTER = { count: 6, segments: 4, length: 1.0, radius: 0.06, tip: 0.012, spread: 0.8, center: [0, 0.6, 0], core: 0.22, coreScale: [1, 1, 1], detail: null };
function buildCluster(b, o) {
  const hi = o.detail !== 'low';
  const c = o.center;
  b.meta.dims = { center: c };
  b.bone('core', null, c);
  if (o.core > 0) b.sphere('core', 'body', o.core, c, o.coreScale, [10, 8]);
  for (let i = 0; i < o.count; i++) {
    const az = i / o.count * TAU + 0.3;
    const el = U.lerp(1.3, 0.1, U.clamp(o.spread, 0, 1)) + ((i % 3) - 1) * 0.35 * o.spread;
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const from = [c[0] + dir[0] * o.core * 0.8, c[1] + dir[1] * o.core * 0.8, c[2] + dir[2] * o.core * 0.8];
    const names = b.chain('t' + i + '_', 'core', from, dir, o.segments, o.length, o.radius, o.tip, 'body', 5);
    if (hi) {
      const n = names.length, sl = o.length / o.segments;
      for (let k = 1; k < n; k++) {
        // 指节：每节交界处一颗略粗的小球，打破一整条光滑触手的单调感
        const px = from[0] + dir[0] * sl * k, py = from[1] + dir[1] * sl * k, pz = from[2] + dir[2] * sl * k;
        b.sphere(names[k], 'body', U.lerp(o.radius, o.tip, k / n) * 1.3, [px, py, pz], null, [5, 4]);
      }
      if (i % 3 === 0) {
        // 肢体末端变化：每三条里有一条末端不是尖细收口，而是三根小趾/爪叉开
        const ex = from[0] + dir[0] * o.length, ey = from[1] + dir[1] * o.length, ez = from[2] + dir[2] * o.length;
        const ox = -dir[2], oz = dir[0], cl = sl * 0.8, tipR = o.tip * 1.6;
        for (const s of [-1, 0, 1]) {
          b.cone(names[n - 1], 'body', [ex, ey, ez], [ex + dir[0] * cl * 0.3 + ox * s * cl * 0.4, ey + dir[1] * cl * 0.3, ez + dir[2] * cl * 0.3 + oz * s * cl * 0.4], tipR, 4);
        }
      }
    }
  }
  if (typeof o.extend === 'function') o.extend(b, b.meta.dims);
}
function limbCluster(opts) {
  const o = Object.assign({}, CLUSTER, opts);
  o.detail = resolveDetail(o.detail);
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

// 测试人/玩家外形（拟态用）：防化服 + 玩家当前皮肤色（o.color 可指定别的制服色，联机队友坐车时用）。
// 缺省用程序化仿制品（约 1k 三角面）：hazmat.glb 有一万八千面，拟态类实体一层刷十几只就压垮手机；
// { full: true } 才借 test_dummy 的 build（和测试人一模一样，只适合单只特写）
//
// 颜色（FE1P H10，孩子看图挑的「队友一上车手和鞋头就变蓝」）：手套、靴子、防毒面具和测试人的 hazmat.glb 一样
// （tools/blender_hazmat.py：手套 0x141414、靴子 0x111111、面罩 0x252525、目镜 0x0a0e11、滤罐 0x353535），换皮肤只换制服（body / head 槽位）。
// 这些都是手写的 sRGB 色；glb 导出时转成了线性值，r147 的 legacyMode 下 setHex 不转换 —— 原来 gear 槽位直接用 0x1b1b1d，
// 屏幕上亮了两倍多（像灰塑料），手套、靴子也就和站着的 glb 对不上。现在 gear 槽位的材质色和每块的 tint 都按线性值算
// （同 skin.js / coop.js 的 linHex），乘出来就是 glb 那几个颜色。
// 形状：人形的手掌方块（制服色）和手指原来把深色手套方块整个包在里面，高画质的脚掌方块从靴子前面伸出来 6 cm ——
// 现在人形不长手和脚（hands / feet: false），手套 = 和原来手掌一样大的深色方块 + 深色手指（高画质），靴子里面没有别的东西。
// 低画质（FE1Q J7，用户原话「面具和靴子不能换」）：gear 槽位材质色取手套色 0x141414，面罩框、滤罐、手套、靴子每块也按 glb 的颜色上 tint
// （乘数按低档那份材质里实际存的值算，tests/visualhooks.mjs 低档白名单放开了窃皮者伪装的 gear 槽位）。原来低档整个 gear 一个颜色，
// 面罩框比 glb 暗约 15 个色阶（线性 0.00784 ≈ sRGB 22，glb 是 37），滤罐暗约 31 个色阶。只多一个 color 属性，不加面、不加槽位、不多 draw call
const HAZMAT_GEAR = 0x1b1b1d;   // gear 槽位的设计色（sRGB）：面罩/滤罐/腰带/压胶条，不随皮肤变
const HAZ_SRGB = {
  tape: 0xd8dce2,    // 反光条：银白
  metal: 0x9aa0a6,   // 腰带扣、滤罐端盖、拉链头
  glass: 0x0a0e11,   // 面罩视窗（= hazmat.glb 的 Visor）：比面罩本体更深，看得出是块玻璃
  mask: 0x252525,    // 面罩框、呼气阀、头带、颈封、滤罐固定带（= hazmat.glb 的 Mask）
  filter: 0x353535,  // 两侧滤罐（= hazmat.glb 的 Filter）
  frame: 0x3c3c3c,   // 坐车人形的目镜边框、呼气阀根上那一圈（返修 FE1R · repair-r2：glb 上比面罩浅一档的深灰；和滤罐色错开 7 个色阶，测试按颜色认滤罐时不混进来）
  cap: 0xb9bec4,     // 坐车人形面罩上的金属件（= hazmat.glb 的 Metal：滤罐端盖、接嘴、目镜四角螺钉；repair-r3 起坐车的面罩直接用 glb 的面罩件）
  tapeG: 0x0c0c0c,   // 面罩外沿那圈黑胶带（= hazmat.glb 的 Tape）
  shine: 0xc8ced4,   // 坐车人形目镜上那一小块高光（glb 的目镜灯下有亮点，Lambert 没有）
  glove: 0x141414,   // 手套（= hazmat.glb 的 Gloves）
  boot: 0x111111,    // 靴子、鞋底、靴口翻边（= hazmat.glb 的 Boots）
  belt: 0x1a1a1a,    // 腰带、腰带扣两侧的穿带环、胸前小包的挂带（= hazmat.glb 的 Belt；FE1R repair-r4 坐车人形的躯干换成 glb 那一份）
  pouch: 0x2b2a22,   // 胸前小包、右胯小包（= hazmat.glb 的 Pouch）
};
// sRGB 手写色 → 材质里该存的值（{ r, g, b } 线性）：legacyMode 下要自己转；关了 legacyMode 时 setHex 已经转过
function hazLin(hex) {
  const T = THREE_(), c = new T.Color();
  c.setHex(hex);
  const cm = T.ColorManagement;
  if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
  return c;
}
// 给 mat.lambert 的颜色值（setHex 以后材质里存的就是 hazLin 的值，按 8 位四舍五入；Color.getHex 是截断，很深的颜色会差出一截）
function hazMatHex(hex) {
  const T = THREE_(), cm = T.ColorManagement;
  if (cm && cm.legacyMode === false) return hex;
  const c = hazLin(hex), q = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (q(c.r) << 16) | (q(c.g) << 8) | q(c.b);
}
// 顶点色 tint = 目标线性色 / 槽位材质里实际存的值（和 skin_stealer 的眼睛同一套换算）。gear 槽位很深，
// 反光条和金属件的乘数 >1 —— 正是 _TEMPLATE 6.10 写的"把这一块提亮到超过槽位材质色"：不新增材质槽位、
// 不多一次 draw call，就能在同一个槽位里分出银色反光条、金属扣、更深的目镜玻璃，以及 glb 颜色的手套和靴子
let HAZ_PAL = null;
function hazPal() {
  if (HAZ_PAL) return HAZ_PAL;
  const T = THREE_(), gearHex = hazMatHex(HAZMAT_GEAR), base = new T.Color();
  base.setHex(gearHex);
  const lowGearHex = hazMatHex(HAZ_SRGB.glove), lowBase = new T.Color();
  lowBase.setHex(lowGearHex);
  const tint = (hex, b) => { const c = hazLin(hex); return [c.r / b.r, c.g / b.g, c.b / b.b]; };
  HAZ_PAL = { gearHex, lowGearHex, low: {} };
  for (const k in HAZ_SRGB) { HAZ_PAL[k] = tint(HAZ_SRGB[k], base); HAZ_PAL.low[k] = tint(HAZ_SRGB[k], lowBase); }
  return HAZ_PAL;
}
// 手套：和人形原来的手掌方块一样大（宽 0.035H·th+0.01、高 0.06H、厚 0.05H·th+0.01，中心 handY−0.005H），
// 高画质再加四指一拇指（和 buildFingers 同样的方块），全部在 gear 槽位、手套色
function hazGlove(b, L, x, d, th, hi, glove) {
  const H = d.H, o = glove ? { tint: glove } : null;
  b.box('fore' + L, 'gear', [0.035 * H * th + 0.01, 0.06 * H, 0.05 * H * th + 0.01], [x, d.handY - 0.005 * H, 0], o);
  if (hi) buildFingers(b, 'fore' + L, x, d.handY, H, th, 'gear', o);
}
// 面罩和靴子的形状照 hazmat.glb（返修 FE1Q · repair-r1，验收员 play：「队友一坐上车，防毒面具和靴子的形状就变了」——
// 站着是 glb 的圆脸罩 + 两侧圆滤罐 + 圆头高筒靴，坐上车以前换成方块面罩、方块靴子；用户原话「面具和靴子不能换」）。
// 尺寸取 tools/blender_hazmat.py：面罩椭球半径 x 0.098 / y 0.118 / z 0.075、大视野目镜是椭球上半截一条带子、下巴一个呼气阀、
// 两侧各一个圆滤罐（半径 4.3 cm，在椭球 (±1.2, −0.3) 处顺着表面法线伸出去）；靴筒到离地 0.365 m、靴头是圆的、靴口一圈反光条。
// 程序化人形的兜帽比 glb 的头大一圈（headSize 1.3），面罩椭球中心往前挪到兜帽前脸外 2.5 cm，大小和 glb 一样
const HZ_MASK = { r: [0.098, 0.118, 0.075], y: 1.6, z: -0.135 };
// 椭球 (cx, cy, cz)、半径 R 上，方位 th（0 = 正前、+ = 往 +x）、仰角 ph 处的点和外法线
function hzOnMask(th, ph) {
  const R = HZ_MASK.r, d = [Math.sin(th) * Math.cos(ph), Math.sin(ph), -Math.cos(th) * Math.cos(ph)];
  const p = [R[0] * d[0], HZ_MASK.y + R[1] * d[1], HZ_MASK.z + R[2] * d[2]];
  const n = [d[0] / R[0], d[1] / R[1], d[2] / R[2]], l = Math.hypot(n[0], n[1], n[2]);
  return { p, n: [n[0] / l, n[1] / l, n[2] / l] };
}
function hzAlong(a, n, t) { return [a[0] + n[0] * t, a[1] + n[1] * t, a[2] + n[2] * t]; }
// 面罩：椭球脸罩（面罩色）+ 上半截一条深色目镜（同心、半径大 3%，离脸罩 2–4 mm）+ 呼气阀（高画质）+ 两侧圆滤罐（高画质带金属端盖）
function hzMask(b, hi, Q, P, Z) {
  const T = THREE_(), R = HZ_MASK.r, mask = { tint: Q.mask };
  const face = new T.SphereGeometry(1, Z ? Z.mask[0] : hi ? 12 : 8, Z ? Z.mask[1] : hi ? 8 : 6);
  face.scale(R[0], R[1], R[2]); face.translate(0, HZ_MASK.y, HZ_MASK.z);
  b.geo('head', 'gear', face, mask);
  // 目镜：椭球上 y 相对中心 +0.015…+0.08、正前方 ±60°（SphereGeometry：phi 从 3π/2 往两边是正前方 −z，theta 从顶上量）
  const k = 1.03, ry = R[1] * k, t0 = Math.acos(0.08 / ry), t1 = Math.acos(0.015 / ry);
  const visor = new T.SphereGeometry(1, Z ? Z.visor : hi ? 8 : 6, hi ? 2 : 1, 1.5 * Math.PI - Math.PI / 3, 2 * Math.PI / 3, t0, t1 - t0);
  visor.scale(R[0] * k, ry, R[2] * 1.05); visor.translate(0, HZ_MASK.y, HZ_MASK.z);
  b.geo('head', 'gear', visor, { tint: Q.glass });
  // 坐车的（Z = HZ_SEG_SEAT，返修 FE1R · repair-r1 K7，验收员 spec：站着的 glb 面罩外面一圈粗黑的面框 / 密封圈，坐着的没有）：脸罩最宽那一圈套一个黑框。
  // 返修 FE1R · repair-r2（验收员 play / spec：并排看面框和面罩连成一整块黑、目镜没有浅色边框、呼气阀几乎看不见）：
  //   面框是一圈圆管（比脸罩轮廓大 4%，往外鼓出脸罩的侧影 1 cm 多），颜色比面罩深（手套色 0x141414，glb 上面框和面罩之间那道亮边是圆管侧面受光）；
  //   目镜四周一圈边框（比目镜大一圈、贴在目镜和脸罩之间，滤罐那种深灰，比面罩浅一档）+ 两端两颗浅色卡扣；呼气阀往外凸 4 cm、根上一圈深灰环、圆顶
  if (Z && Z.rim) {
    const rim = new T.TorusGeometry(1, 0.12, 8, Z.rim);
    rim.scale(R[0] * 1.04, R[1] * 1.04, 0.09); rim.translate(0, HZ_MASK.y, HZ_MASK.z + 0.004);
    b.geo('head', 'gear', rim, { tint: Q.glove });
    const kf = 1.02, ryf = R[1] * kf, f0 = Math.acos(0.09 / ryf), f1 = Math.acos(0.006 / ryf);
    const frame = new T.SphereGeometry(1, Z.visor + 2, 2, 1.5 * Math.PI - Math.PI / 3 - 0.12, 2 * Math.PI / 3 + 0.24, f0, f1 - f0);
    frame.scale(R[0] * kf, ryf, R[2] * 1.035); frame.translate(0, HZ_MASK.y, HZ_MASK.z);
    b.geo('head', 'gear', frame, { tint: Q.frame });
    for (const s of [-1, 1]) {
      const c = hzOnMask(s * (Math.PI / 3 + 0.1), 0.38);
      b.box('head', 'gear', [0.012, 0.018, 0.012], hzAlong(c.p, c.n, 0.006), { tint: P.tape });
    }
  }
  if (hi && Z && Z.rim) {
    const v = hzOnMask(0, -0.53);
    b.limb('head', 'gear', hzAlong(v.p, v.n, -0.01), hzAlong(v.p, v.n, 0.04), 0.03, 0.028, Z.valve, mask);
    b.limb('head', 'gear', hzAlong(v.p, v.n, 0.002), hzAlong(v.p, v.n, 0.012), 0.035, 0.035, Z.valve, { tint: Q.frame });
    b.limb('head', 'gear', hzAlong(v.p, v.n, 0.04), hzAlong(v.p, v.n, 0.046), 0.027, 0.018, Z.valve, mask);
  } else if (hi) { const v = hzOnMask(0, -0.53); b.limb('head', 'gear', hzAlong(v.p, v.n, -0.01), hzAlong(v.p, v.n, 0.026), 0.03, 0.027, Z ? Z.valve : 10, mask); }
  for (const s of [-1, 1]) {
    const f = hzOnMask(s * 1.2, -0.3);
    b.limb('head', 'gear', hzAlong(f.p, f.n, -0.005), hzAlong(f.p, f.n, 0.05), 0.043, 0.043, Z ? Z.filter : hi ? 12 : 8, { tint: Q.filter });
    if (hi) b.limb('head', 'gear', hzAlong(f.p, f.n, 0.05), hzAlong(f.p, f.n, 0.056), 0.026, 0.024, Z ? Z.valve : 10, { tint: P.metal });   // 滤罐端盖
  }
}
// 坐车人形直接用站着那个 hazmat.glb 里的件（返修 FE1R · repair-r3 起面罩，repair-r4 起从头到脚，主会话 L1，用户原话「面具和靴子不能换」：
// 验收员 play 并排看，面罩一样了，靴口却是一圈白边、反光条银白、兜帽大一圈，身上也少了几道黑胶带）。
// glb 没有骨骼，按连通块挑件、整块挂到坐姿人形对应的骨骼上，位置、大小、颜色都是 glb 原样（不再手写）：
//   头骨骼：重心在 1.45 m 以上、|x| < 0.2 的全部件 —— 兜帽（制服色）、脸罩、目镜两层加侧壁、橡胶框、四颗螺钉、呼气阀、两侧滤罐、
//     绕到后脑勺的两条头带、面罩外沿那圈黑胶带、兜帽那圈反光带。原位不挪（repair-r3 以前整体往前挪到程序化兜帽前面）。
//   躯干（胯骨骼 / 脊柱骨骼，见 hzGlbTorso）：躯干、腰带和扣、右胯小包、胸前小包和挂带、拉链黑胶带和两侧压条、拉链头、胸背那圈反光带。
//   小腿骨骼：靴筒、靴脚、鞋底、靴口那圈黑胶带 —— 坐姿小腿竖直（大腿抬多少、小腿就转回多少），整只靴子和站着一模一样，
//     只按程序化人形的腿距横挪（glb 靴筒中线 x ±0.150、z 0.009 → 程序化小腿中线 x ±hipW、z 0）。
// 四肢（坐姿要弯）不拆 glb：反光条、压胶条、护膝、手套护腕在 hazmat() 里按 glb 量出来的高度、宽度、颜色程序化画。
// 颜色按 glb 的材质色上 tint（HAZ_SRGB）；制服色的件（兜帽、躯干）放进 head / body 槽位，跟着换肤变色。
// hzGlbParts() 没载入 glb（或者不是那份 glb，缺件）时返回 null，坐车人形退回程序化的那一套（hazmat_seat_v9p）
const HZ_GLB_MAT = { Mask: 'mask', Visor: 'glass', Filter: 'filter', Metal: 'cap', Tape: 'tapeG', Boots: 'boot', Belt: 'belt', Pouch: 'pouch', Gloves: 'glove', Suit: null };
const HZ_GLB_BOOT = { x: 0.150, z: 0.009 };   // 只用来认左右；实际横挪量按靴筒那一块的包围盒中心算
let HZ_GLB_ALL = null, HZ_GLB = null;
// glb 的全部连通块（模型坐标原样）：{ mat, bb: [x0, y0, z0, x1, y1, z1], pos, nor, idx }。位置按 0.1 mm 焊在一起，三角形共点的并成一块
function hzGlbComps() {
  if (HZ_GLB_ALL) return HZ_GLB_ALL;
  const A = BR.assets, root = A && has(A, 'modelSync') ? A.modelSync('hazmat') : null;
  if (!root) return null;
  const T = THREE_(), out = [];
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const m0 = Array.isArray(o.material) ? o.material[0] : o.material, name = m0 && String(m0.name || '').replace(/\.\d+$/, '');
    if (!name || !(name in HZ_GLB_MAT)) return;
    const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index, n = idx ? idx.count : pos.count;
    const M = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld), Nm = new T.Matrix3().getNormalMatrix(M);
    const ids = new Map(), par = [], tv = new Int32Array(n);
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let i = 0; i < n; i++) {
      const v = idx ? idx.getX(i) : i, k = Math.round(pos.getX(v) * 1e4) + ',' + Math.round(pos.getY(v) * 1e4) + ',' + Math.round(pos.getZ(v) * 1e4);
      let id = ids.get(k); if (id == null) { id = par.length; ids.set(k, id); par.push(id); }
      tv[i] = id;
    }
    for (let t = 0; t < n; t += 3) { const a = find(tv[t]); par[find(tv[t + 1])] = a; par[find(tv[t + 2])] = a; }
    const comps = new Map();
    for (let t = 0; t < n; t += 3) { const r = find(tv[t]); let c = comps.get(r); if (!c) comps.set(r, c = []); c.push(t); }
    const P = new T.Vector3(), N = new T.Vector3();
    comps.forEach(tris => {
      const map = new Map(), pv = [], nv = [], ix = [], bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const t of tris) for (let j = 0; j < 3; j++) {
        const v = idx ? idx.getX(t + j) : t + j;
        let w = map.get(v);
        if (w == null) {
          P.fromBufferAttribute(pos, v).applyMatrix4(M);
          pv.push(P.x, P.y, P.z);
          for (let a = 0; a < 3; a++) { const q = P.getComponent(a); if (q < bb[a]) bb[a] = q; if (q > bb[a + 3]) bb[a + 3] = q; }
          if (nor) { N.fromBufferAttribute(nor, v).applyMatrix3(Nm).normalize(); nv.push(N.x, N.y, N.z); }
          w = pv.length / 3 - 1; map.set(v, w);
        }
        ix.push(w);
      }
      out.push({ mat: name, bb, pos: new Float32Array(pv), nor: nor ? new Float32Array(nv) : null, idx: ix });
    });
  });
  HZ_GLB_ALL = out;
  return out;
}
// 一块里挑一部分三角形（keep(c, t)：t 是 c.idx 里这个三角形的起点）建 BufferGeometry；dx / dz 整体平移
function hzGlbGeo(c, keep, dx, dz) {
  const T = THREE_(), map = new Map(), pv = [], nv = [], ix = [];
  for (let t = 0; t < c.idx.length; t += 3) {
    if (keep && !keep(c, t)) continue;
    for (let j = 0; j < 3; j++) {
      const v = c.idx[t + j];
      let w = map.get(v);
      if (w == null) {
        w = pv.length / 3; map.set(v, w);
        pv.push(c.pos[v * 3] + (dx || 0), c.pos[v * 3 + 1], c.pos[v * 3 + 2] + (dz || 0));
        if (c.nor) nv.push(c.nor[v * 3], c.nor[v * 3 + 1], c.nor[v * 3 + 2]);
      }
      ix.push(w);
    }
  }
  if (!ix.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pv, 3));
  if (c.nor) g.setAttribute('normal', new T.Float32BufferAttribute(nv, 3)); else g.computeVertexNormals();
  g.setIndex(ix);
  return g;
}
// 挑件：{ head: [块], torso: [块], boot: { L: [块], R: [块] }, shaft: { L: [cx, cz], R: [cx, cz] }, glove: { L: [护腕, 胶带], R }, cuffAt: { L: [cx, cz], R } } | null
function hzGlbParts() {
  if (HZ_GLB) return HZ_GLB;
  const all = hzGlbComps();
  if (!all) return null;
  const head = [], torso = [], boot = { L: [], R: [] }, shaft = {}, glove = { L: [], R: [] }, cuffAt = {};
  for (const c of all) {
    const b = c.bb, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, h = b[4] - b[1];
    // 手套护腕（Gloves 里最高的那一块，0.83–1.00）和护腕上沿那圈黑胶带（Tape，0.94–1.01）：挂前臂（repair-r5，见 hzSeatGlove）
    if (Math.abs(cx) >= 0.2 && ((c.mat === 'Gloves' && h > 0.15) || (c.mat === 'Tape' && cy > 0.92 && cy < 1.02 && h < 0.09))) {
      const L = cx < 0 ? 'L' : 'R';
      glove[L].push(c);
      if (c.mat === 'Gloves') cuffAt[L] = [cx, (b[2] + b[5]) / 2];
      continue;
    }
    if (c.mat === 'Boots' || (c.mat === 'Tape' && cy < 0.45 && h < 0.06)) {
      const L = cx < 0 ? 'L' : 'R';
      boot[L].push(c);
      if (c.mat === 'Boots' && h > 0.25) shaft[L] = [cx, (b[2] + b[5]) / 2];   // 靴筒（最高的那一块）
      continue;
    }
    if (Math.abs(cx) >= 0.2) continue;   // 两条胳膊和胳膊上的件、手套
    if (cy >= 1.45) head.push(c);
    else if (cy >= 0.8 && c.mat !== 'Gloves') torso.push(c);
  }
  const has2 = (list, m) => list.some(c => c.mat === m);
  // 不是那份 glb（缺件）：退回程序化的
  if (!has2(head, 'Suit') || !has2(head, 'Mask') || !has2(head, 'Visor') || !has2(head, 'Filter') || !has2(torso, 'Suit') || !has2(torso, 'Belt')
    || !shaft.L || !shaft.R || boot.L.length < 3 || boot.R.length < 3 || !cuffAt.L || !cuffAt.R || glove.L.length < 2 || glove.R.length < 2) return null;
  HZ_GLB = { head, torso, boot, shaft, glove, cuffAt };
  return HZ_GLB;
}
function hzGlbTint(Q, c) { const k = HZ_GLB_MAT[c.mat]; return k ? { tint: Q[k] } : null; }
// 头上的件：原位挂头骨骼。制服色的兜帽进 head 槽位（和头骨同一份材质，跟着换肤），别的进 gear 槽位上 tint
// 目镜上一小块高光（repair-r3）：glb 的目镜是低粗糙度、带一点金属度的材质，灯下有一两个亮点；坐车的人形是 Lambert，没有高光 ——
// 在目镜前层（glb 的 mask_pt(θ, φ, 7 mm)）左上方外面 1.5 mm 贴一小块浅色椭圆（1.1 × 0.7 cm）。glb 面罩椭球：中心 (0, 1.615, −0.078)、半径 0.098 / 0.118 / 0.075
// 头上的件整体往下挪 HZ_GLB_HEAD_DY 挂（repair-r4）：glb 兜帽顶 1.80 比程序化的头顶高 1.3 cm，坐着时头顶离护顶横条只剩 0.1 cm（要 ≥1 cm）；
// 上身多前倾能让开，可胳膊为了够方向盘肘往外撇，怪打肩膀时前臂插进司机上臂 2.2 cm（K6）—— 坐姿不动，头挪下来 1.3 cm（兜帽下沿照旧埋在躯干顶里，
// 形状、大小、颜色都是 glb 原样，站着并排比只是脖子短 1.3 cm）
const HZ_GLB_MC = [0, 1.615, -0.078], HZ_GLB_MR = [0.098, 0.118, 0.075], HZ_GLB_HEAD_DY = -0.013;
function hzGlbHead(b, Q, G) {
  for (const c of G.head) {
    const g = hzGlbGeo(c);
    if (g) { g.translate(0, HZ_GLB_HEAD_DY, 0); b.geo('head', c.mat === 'Suit' ? 'head' : 'gear', g, hzGlbTint(Q, c)); }
  }
  const T = THREE_(), C = HZ_GLB_MC, R = HZ_GLB_MR, th = 0.55, ph = 0.6, o = 0.0085;
  const p = new T.Vector3((R[0] + o) * Math.cos(ph) * Math.sin(th), C[1] + HZ_GLB_HEAD_DY + (R[1] + o) * Math.sin(ph), C[2] - (R[2] + o) * Math.cos(ph) * Math.cos(th));
  const n = new T.Vector3(p.x / (R[0] * R[0]), (p.y - C[1] - HZ_GLB_HEAD_DY) / (R[1] * R[1]), (p.z - C[2]) / (R[2] * R[2])).normalize();
  const dot = new T.CircleGeometry(1, 16);
  dot.scale(0.0055, 0.0035, 1);
  dot.applyMatrix4(new T.Matrix4().lookAt(p.clone().add(n), p, new T.Vector3(0, 1, 0)).setPosition(p));
  b.geo('head', 'gear', dot, { tint: Q.shine });
}
// 躯干：坐姿时脊柱绕 (0, ys, 0) 往前倾（coop.js SEAT.lean），胯不动。
// 返修 FE1R · repair-r5（验收员 play：repair-r4 把制服躯干在 ys 处拆成上下两截、各自整块挂骨骼，叠 11 cm —— 上身前倾 0.52 以后，下截的背在腰带上方
// 那 9 cm 还留在原处，上截的背往前缩了 6 cm，站着从车右后方就看得到一个平顶的台阶；主会话 L1「弯的地方拆件会穿帮」）：
// 躯干上的件一律整块不拆，按顶点高度在胯和脊柱之间线性蒙皮（HZ_TORSO_BLEND：腰带顶 1.03 以下全跟胯 —— 腰带、扣、右胯小包不变形；
// 1.30 以上全跟脊柱 —— 肩、胸前小包、胸背反光带、领口和胳膊、头一起转；中间 smoothstep）。制服、拉链黑胶带、两侧压条、反光带、胸前小包都用同一套权重，
// 贴在制服上的件跟着制服一起弯，不分家、不插进去
const HZ_TORSO_BLEND = Object.freeze({ y0: 1.03, y1: 1.30 });
function hzGlbTorso(b, Q, G) {
  for (const c of G.torso) {
    const g = hzGlbGeo(c);
    if (g) b.geo('hips', c.mat === 'Suit' ? 'body' : 'gear', g, Object.assign({ blend: { bone: 'spine', y0: HZ_TORSO_BLEND.y0, y1: HZ_TORSO_BLEND.y1 } }, hzGlbTint(Q, c) || {}));
  }
}
// 一只靴子（L / R）：glb 的靴筒、靴脚、鞋底、靴口黑胶带，横挪到小腿中线 (x, 0) 上，挂小腿骨骼
function hzGlbBoot(b, L, x, Q, G) {
  const s = G.shaft[L], dx = x - s[0], dz = -s[1];
  for (const c of G.boot[L]) { const g = hzGlbGeo(c, null, dx, dz); if (g) b.geo('shin' + L, 'gear', g, hzGlbTint(Q, c)); }
}
// 靴子：靴筒（圆台，套住小腿，到离地 0.365）+ 靴脚（横着的扁圆柱）+ 圆靴头（前半个扁椭球）。x = 小腿中线
function hzBoot(b, L, x, hi, boot, Z) {
  const T = THREE_();
  b.limb('shin' + L, 'gear', [x, 0.05, -0.005], [x, 0.365, 0], 0.066, 0.08, Z ? Z.boot : hi ? 10 : 8, boot);
  b.limb('shin' + L, 'gear', [x, 0.038, 0.085], [x, 0.038, -0.12], 0.056, 0.056, Z ? Z.boot : hi ? 10 : 8, 0.68, boot);
  const toe = new T.SphereGeometry(1, Z ? Z.toe[0] : hi ? 8 : 6, Z ? Z.toe[1] : hi ? 4 : 3, Math.PI, Math.PI);
  toe.scale(0.056, 0.038, 0.075); toe.translate(x, 0.038, -0.12);
  b.geo('shin' + L, 'gear', toe, boot);
}
// 坐车人形（glb 已载入，FE1R repair-r4 主会话 L1：从头到脚和站着用的 hazmat.glb 一个样子）：头、躯干、靴子用 glb 的件（见 hzGlbParts），
// 四肢要弯，上面的件按 glb 量出来的高度、宽度、颜色程序化画（tools/blender_hazmat.py；repair-r4 scripts/p_glball.js 按连通块量过模型坐标）：
//   反光带（Metal #b9bec4）：上臂 1.245–1.300、前臂 1.000–1.050、小腿 0.450–0.500，比肢体粗 4 mm（以前银白 #d8dce2，上臂 1.29–1.35、前臂 0.89–0.95，
//     靴口还套一圈白边 —— glb 那里是黑胶带）；
//   压胶条（Tape #0c0c0c，半径 5 mm 的细管）：胳膊外侧 1.40→0.90、裤腿外侧 0.92→0.32（以前在胳膊、大腿背面，glb 那里没有）；
//   手套护腕（Gloves）：前臂下段 0.985→0.84 外翻一圈，上沿 0.958–0.996 缠一圈黑胶带（以前只有手掌那么高的手套方块）；
//   护膝（制服色）：0.508–0.632，宽 9 cm、厚 2.4 cm，在膝盖前面。
// 程序化人形的膝关节在 0.486（glb 的护膝中心 0.57），小腿反光带放 0.437–0.487（比 glb 低 1.3 cm）：不跨过膝关节，坐着时不跟大腿错开；
// 护膝挂大腿骨骼（站姿在 glb 的高度，坐着时在膝盖顶上朝前上方）。glb 上没有的不画：肩上的反光章和压胶条、大腿侧袋、颈封
// 坐车人形的手套（返修 FE1R · repair-r5，验收员 play：repair-r4 还是方块手掌加方块手指，站着离车 1–1.5 m 就看得出和 glb 那双圆滑的长筒手套不一样）：
//   护腕：hazmat.glb 的 Gloves 护腕那一块（0.83–1.00 外翻的长筒）和护腕上沿那圈黑胶带，原样横挪到程序化前臂中线上，挂前臂骨骼；
//   手：握拳，绕着方向盘轮缘（coop.js poseSeat 把前臂转到让骨骼本地 z 顺着轮缘切线，见 armIK 的 twist），全是圆的 ——
//     腕（圆台，接进护腕）+ 手掌（扁的椭圆柱，贴在轮缘外侧）+ 四根手指（圆管沿着绕轮缘的弧，从指根绕过轮缘底下、另一侧到顶上，指尖半球）+ 拇指（顺着轮缘压在上面）。
//   尺寸照 glb：手指粗 2.1 cm、四指中心间隔 2.3 cm、手掌宽 9 cm 厚 3.8 cm、拇指粗 2.3 cm；手指那段弧的长度 ≈ glb 手指长 8.5 cm。
//   握点 = 前臂中线上 handY − 0.04H 那一点（armIK 让它落在轮缘中心线上）；轮缘管半径 0.016（车本地，人形缩放 0.97 → 0.0165）
// 手指、拇指挂在单独一根「握拳」骨骼 grip（父骨骼前臂、原点在握点）上：轮缘在手里不一定和前臂垂直（转方向盘时斜 −32°…+15°），coop.js poseSeat
// 让 grip 绕本地 x 转，手指那一圈始终顺着轮缘绕；手掌、腕、护腕留在前臂上（手掌里面那一面和轮缘平行，斜多少都贴着）。
// 握孔半径 rim = 轮缘管 0.0165 + 5 mm（轮缘是半径 0.165 的弯，外面两根手指那里往轮心偏 3.6 mm）
const HZ_FIST = Object.freeze({ rim: 0.0215, fr: 0.0105, fz: [-0.0345, -0.0115, 0.0115, 0.0345], a0: -0.44, a1: -3.58, palm: { rx: 0.019, rz: 0.045, y0: -0.035, y1: 0.122 }, thumb: 0.0115 });
// 护腕的轴：护腕上沿那圈黑胶带是一个环，它的平面法线就是 glb 前臂的方向（协方差最小的那个特征向量，Jacobi 求）；绕环心转成竖直，环心挪到前臂中线上（高度不变）
function hzCuffXf(G, L, x) {
  const T = THREE_(), ring = G.glove[L].find(c => c.mat === 'Tape') || G.glove[L][0], P = ring.pos, n = P.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) { c[0] += P[i]; c[1] += P[i + 1]; c[2] += P[i + 2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < P.length; i += 3) { const d = [P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]]; for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) A[r][k] += d[r] * d[k]; }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(A[p][q]) < 1e-14) continue;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const ap = A[k][p], aq = A[k][q]; A[k][p] = cs * ap - sn * aq; A[k][q] = sn * ap + cs * aq; }
    for (let k = 0; k < 3; k++) { const ap = A[p][k], aq = A[q][k]; A[p][k] = cs * ap - sn * aq; A[q][k] = sn * ap + cs * aq; }
    for (let k = 0; k < 3; k++) { const vp = V[k][p], vq = V[k][q]; V[k][p] = cs * vp - sn * vq; V[k][q] = sn * vp + cs * vq; }
  }
  let m = 0; for (let k = 1; k < 3; k++) if (A[k][k] < A[m][m]) m = k;
  const ax = new T.Vector3(V[0][m], V[1][m], V[2][m]).normalize();
  if (ax.y < 0) ax.negate();
  const q = new T.Quaternion().setFromUnitVectors(ax, new T.Vector3(0, 1, 0));
  return new T.Matrix4().makeTranslation(x, c[1], 0).multiply(new T.Matrix4().makeRotationFromQuaternion(q)).multiply(new T.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
}
function hzSeatGlove(b, L, s, x, d, Q, Z, G) {
  const T = THREE_(), glove = { tint: Q.glove }, H = d.H, yr = d.handY - 0.04 * H, F = HZ_FIST;
  const gb = b.bone('grip' + L, 'fore' + L, [x, yr, 0]);
  // 护腕和上沿胶带（glb 原样）：glb 的胳膊往外撇，护腕跟着斜 —— 按上沿那圈胶带定它的轴，转成竖直再挪到前臂中线上（高度不变，见 hzCuffXf）
  const M = hzCuffXf(G, L, x);
  for (const c of G.glove[L]) { const g = hzGlbGeo(c); if (g) { g.applyMatrix4(M); b.geo('fore' + L, 'gear', g, hzGlbTint(Q, c)); } }
  const seg = Z ? Z.tape : 12;
  // 腕：从护腕里面出来，接到手掌顶上
  // 程序化前臂的袖子一直到 handY + 0.02H（0.792），比 glb 护腕下沿（0.826）低 3 cm —— 腕比袖子粗一圈，把那一截包住
  b.limb('fore' + L, 'gear', [x, 0.875, 0], [x, d.handY + 0.02 * H - 0.008, 0], 0.056, 0.052, seg, glove);
  // 手掌：扁椭圆柱，里面那一面贴着轮缘（离轮缘中心线 F.rim）
  const ph = F.palm.y1 - F.palm.y0, palm = new T.CylinderGeometry(1, 1, ph, 16, 1, false);
  palm.scale(F.palm.rx, 1, F.palm.rz);
  palm.translate(x + s * (F.rim + F.palm.rx), yr + (F.palm.y0 + F.palm.y1) / 2, 0);
  b.geo('fore' + L, 'gear', palm, glove);
  // 手指：绕轮缘中心线（前臂中线上 yr 那一点、本地 z 方向）半径 rim + fr 的圆弧
  const R = F.rim + F.fr, n = 9;
  for (const fz of F.fz) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = F.a0 + (F.a1 - F.a0) * i / (n - 1); pts.push(new T.Vector3(x + s * R * Math.cos(a), yr + R * Math.sin(a), fz)); }
    const curve = new T.CatmullRomCurve3(pts);
    b.geo(gb, 'gear', new T.TubeGeometry(curve, 12, F.fr, 10, false), glove);
    const tip = new T.SphereGeometry(F.fr, 10, 6); tip.translate(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z); b.geo(gb, 'gear', tip, glove);
    const knuckle = new T.SphereGeometry(F.fr * 1.1, 10, 6); knuckle.translate(pts[0].x, pts[0].y, pts[0].z); b.geo(gb, 'gear', knuckle, glove);
  }
  // 拇指：从手掌靠车头那一边（本地 −z）顺着轮缘压在上面
  const th = [[0.034, 0.052, -0.036], [0.018, 0.042, -0.05], [-0.002, 0.034, -0.054], [-0.016, 0.031, -0.048]].map(q => new T.Vector3(x + s * q[0], yr + q[1], q[2]));
  b.geo(gb, 'gear', new T.TubeGeometry(new T.CatmullRomCurve3(th), 8, F.thumb, 10, false), glove);
  const tt = new T.SphereGeometry(F.thumb, 10, 6); tt.translate(th[3].x, th[3].y, th[3].z); b.geo(gb, 'gear', tt, glove);
  const tb = new T.SphereGeometry(F.thumb * 1.15, 10, 6); tb.translate(th[0].x, th[0].y, th[0].z); b.geo(gb, 'gear', tb, glove);
}
const HZ_SEAT_BANDS = Object.freeze({ arm: [1.245, 1.300], fore: [1.000, 1.050], shin: [0.437, 0.487] });
const HZ_SEAT_CUFF = Object.freeze([[0.985, 0.004], [0.975, 0.011], [0.93, 0.006], [0.88, 0.004], [0.855, 0.003], [0.84, 0.002], [0.80, 0.002]]);   // [高度, 比前臂粗多少]
const HZ_SEAT_CUFFTAPE = Object.freeze([[0.996, 0.004], [0.992, 0.008], [0.962, 0.015], [0.958, 0.0115]]);
const HZ_SEAT_PAD = Object.freeze({ y: 0.57, h: 0.124, w: 0.09, t: 0.024 });
function hzSeatGlb(b, d, Q, Z, G) {
  const H = d.H, TH = 1.35, sw = d.shoulderW, hw = d.hipW, shY = d.shoulderY;
  const lerpR = (y, y0, y1, r0, r1) => r0 + (r1 - r0) * U.clamp((y - y0) / (y1 - y0), 0, 1);
  const armR = y => lerpR(y, shY - 0.005 * H, d.elbowY, 0.03 * H * TH, 0.024 * H * TH);
  const foreR = y => lerpR(y, d.elbowY, d.handY + 0.02 * H, 0.024 * H * TH, 0.018 * H * TH);
  const legR = y => lerpR(y, d.hipY, d.kneeY, 0.042 * H * TH, 0.033 * H * TH);
  const shinR = y => lerpR(y, d.kneeY, 0.045 * H, 0.032 * H * TH, 0.022 * H * TH);
  const kneeR = y => { const R = 0.034 * H * TH, ry = R * 0.8, dy = y - d.kneeY; return Math.abs(dy) >= ry ? 0 : R * Math.sqrt(1 - (dy / ry) * (dy / ry)); };   // 膝关节球 [1, 0.8, 1]
  const metal = { tint: Q.cap }, tape = { tint: Q.tapeG }, glove = { tint: Q.glove };
  hzGlbHead(b, Q, G);
  hzGlbTorso(b, Q, G);
  const seam = (bone, pts) => { for (let i = 0; i + 1 < pts.length; i++) b.limb(bone, 'gear', pts[i], pts[i + 1], 0.005, 0.005, 6, tape); };
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R', x = s * sw, xl = s * hw;
    hzSeatGlove(b, L, s, x, d, Q, Z, G);                    // 手套：glb 护腕 + 圆的握拳的手（repair-r5）
    hzGlbBoot(b, L, xl, Q, G);
    // 反光带
    const A = HZ_SEAT_BANDS.arm, F = HZ_SEAT_BANDS.fore, S = HZ_SEAT_BANDS.shin, sr = y => Math.max(shinR(y), kneeR(y)) + 0.004;
    b.limb('arm' + L, 'gear', [x, A[1], 0], [x, A[0], 0], armR(A[1]) + 0.004, armR(A[0]) + 0.004, Z.tape, metal);
    b.limb('fore' + L, 'gear', [x, F[1], 0], [x, F[0], 0], foreR(F[1]) + 0.004, foreR(F[0]) + 0.004, Z.tape, metal);
    b.limb('shin' + L, 'gear', [xl, S[1], 0], [xl, S[0], 0], sr(S[1]), sr(S[0]), Z.tape, metal);
    // 外侧压胶条：胳膊在肘、裤腿在膝断开（坐着要弯）
    const out = (cx, r) => cx + s * (r + 0.0025);
    seam('arm' + L, [[out(x, armR(1.40)), 1.40, 0], [out(x, armR(d.elbowY)), d.elbowY, 0]]);
    seam('fore' + L, [[out(x, foreR(d.elbowY)), d.elbowY, 0], [out(x, foreR(0.90)), 0.90, 0]]);
    seam('leg' + L, [[out(xl, legR(0.92)), 0.92, 0], [out(xl, legR(d.kneeY)), d.kneeY, 0]]);
    seam('shin' + L, [[out(xl, shinR(d.kneeY)), d.kneeY, 0], [out(xl, shinR(0.36)), 0.36, 0]]);
    // 护膝：贴着大腿前面，两条竖边正好落在大腿圆台上（中间埋进去 1.3 cm）
    const K = HZ_SEAT_PAD, r = legR(K.y);
    b.box('leg' + L, 'body', [K.w, K.h, K.t], [xl, K.y, -(Math.sqrt(r * r - K.w * K.w / 4) + K.t / 2)]);
  }
}
// 圆的段数。高画质（窃皮者伪装，FE1R K8：和别的人形怪一样，驾驶座看 1.3 m 外弦高 ≤1 px）：兜帽 18×12、反光条跟着四肢 10 段、胸前一圈 16；
// 面罩、滤罐、靴子照旧（smoke 的「面具和靴子不能换」按这些段数量）。
// 坐车（o.seat，FE1R K7，用户原话「面具和靴子不能换」）：不论画质都用高画质那一套细节（目镜带、呼气阀、滤罐端盖、头带、反光条、拉链、
// 腰带和扣、胸前小包、腕部胶带……），段数按 ⑯d 机位（离队友约 1 m，1280×720、竖直视野 75°，每米约 469 px）弦高 ≤1 px 算：
// 躯干 26（胸廓半径 0.26 m ≈ 123 px → ≥25）、兜帽 24×16（0.18 m ≈ 84 px → ≥21）、四肢 14（0.073 m ≈ 34 px → ≥13）、关节球 14×8、
// 面罩 18×12、滤罐 14、靴子 14、靴口反光圈 16。场上最多一个坐姿人形，不算区块预算
const HZ_SEG_HIGH = { mask: [12, 8], visor: 8, valve: 10, filter: 12, boot: 10, toe: [8, 4], ring: 10, hood: [18, 12], band: 12, tape: 10, chest: 12 };
const HZ_SEG_SEAT = { mask: [18, 12], visor: 12, valve: 14, filter: 14, boot: 14, toe: [12, 6], ring: 16, hood: [24, 16], band: 24, tape: 14, chest: 26, rim: 28 };
const HUM_SEG_SEAT = { torso: 26, limb: 14, head: [16, 10], faceless: [24, 16], joint: [14, 8], neck: 14, small: [10, 8] };
function hazmat(ctx, o) {
  o = o || {};
  if (o.full) {
    const d = BR.entityTypes.get('test_dummy');
    if (d && typeof d.build === 'function') {
      try { const m = d.build(ctx); if (m && m.isObject3D) return m; }
      catch (err) { once('hazmat', () => console.warn('[arch] 借用测试人模型失败，改用程序化防化服', err)); }
    }
  }
  // o.color（FE1：联机队友坐在叉车上时的坐姿人形）指定制服色 —— 直接当材质色用（coop.js 已经按 skin.apply 的办法转过线性）。
  // 缺省取玩家当前皮肤色，按 skin.apply 一样转线性（拟态伪装成测试人：测试人的 glb 制服也是这么上色的）。材质走 mat.lambert 的缓存，
  // 缓存键里带着颜色：给了别的颜色就是另一份材质，拟态实体（不传 o.color）共用的那份不受影响；几何缓存键不看颜色，照旧共享
  const suit = o.color != null && Number.isFinite(+o.color) ? (+o.color >>> 0) & 0xffffff
    : hazMatHex(BR.skin && has(BR.skin, 'color') ? BR.skin.color() : 0xd8b21f);
  const seat = !!o.seat;
  const hi = seat || resolveDetail(o.detail) === 'high';
  const Z = seat ? HZ_SEG_SEAT : hi ? HZ_SEG_HIGH : null;
  const P = hazPal();
  // 坐车的从头到脚用 glb 的件（repair-r3 面罩、repair-r4 全身，见 hzGlbParts / hzSeatGlb）：glb 载入了才行，缓存键分开
  // （没载入时拼的程序化那一套不会被当成 glb 那版缓存住）。glb 那版不建程序化的躯干（torso: false），头骨缩小到整个罩在 glb 的兜帽里（headSize 0.85）
  const G = seat ? hzGlbParts() : null, glbMask = !!G;
  return humanoid({
    height: 1.8, bulk: 1.35, headSize: G ? 0.85 : 1.3, neck: 0.4, key: seat ? (glbMask ? 'hazmat_seat_v9g' : 'hazmat_seat_v9p') : 'hazmat_lite_v5', detail: seat ? 'high' : o.detail,
    ...(G ? { torso: false } : {}),
    // 头骨那颗球整个罩在兜帽里（高画质），段数不用跟着兜帽加；伪装（高画质）的躯干、四肢按 12 / 10 段，整件 < 4000 面（tests/preview.mjs --arch）
    seg: seat ? HUM_SEG_SEAT : hi ? { head: [10, 8] } : undefined,
    hands: false, feet: false,   // 手和脚由下面的手套、靴子代替（不再有制服色的手掌、手指、脚掌藏在里面或者伸出来）
    // body/head 是制服，跟着皮肤变色；gear 固定深色，面罩/滤罐/手套/靴子/腰带不随皮肤变
    colors: { body: suit, head: suit, gear: hi ? P.gearHex : P.lowGearHex },
    extend(b, d) {
      const hr = d.headR, hy = d.headY, TH = 1.35;   // TH = 上面传的 bulk（thin 0）
      const HAZ_TAPE = P.tape, HAZ_METAL = P.metal, HAZ_GLASS = P.glass;
      // 每块按 glb 的颜色上 tint：高画质相对 gear 设计色，低画质相对手套色（低档那份材质）算乘数（FE1Q J7）
      const Q = hi ? P : P.low;
      const glove = Q.glove, boot = { tint: Q.boot }, mask = { tint: Q.mask };
      if (G) { hzSeatGlb(b, d, Q, Z, G); return; }
      if (hi) b.sphere('head', 'head', hr * 1.12, [0, hy + hr * 0.12, hr * 0.02], [1, 0.82, 1.05], Z.hood);              // 兜帽轮廓：罩在头骨外一层，制服色（head 槽位）
      // 面罩（圆脸罩 + 目镜 + 呼气阀 + 两侧圆滤罐，照 hazmat.glb 的形状；低画质少几段、不要呼气阀和端盖，轮廓一样）—— 见 hzMask；
      // 坐车的（glb 载入了）整个人见 hzSeatGlb；这里是伪装、以及 glb 没载入时坐车退回的程序化那一套
      hzMask(b, hi, Q, P, Z);
      if (hi && !seat) b.box('spine', 'gear', [0.02, (d.shoulderY - d.hipY) * 0.68, 0.015], [0, (d.shoulderY + d.hipY) / 2, -d.headR * 0.95]);   // 胸前拉链条（坐车的见下面「拉链」）
      if (hi) b.limb('hips', 'gear', [0, d.hipY + 0.02, 0], [0, d.hipY - 0.015, 0], d.hipW * 1.55, d.hipW * 1.62, Z.chest);    // 腰带
      if (hi && !seat) b.box('hips', 'gear', [0.05, 0.06, 0.045], [d.hipW * 0.75, d.hipY - 0.04, 0.04]);                 // 小包（坐车的没有：glb 腰上没有，K7）
      const shinR = y => U.lerp(0.032 * d.H * TH, 0.022 * d.H * TH, U.clamp((d.kneeY - y) / (d.kneeY - 0.045 * d.H), 0, 1));   // 小腿圆台在 y 处的半径
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R';
        if (hi) b.limb('fore' + L, 'gear', [s * d.shoulderW, d.handY + 0.05, 0], [s * d.shoulderW, d.handY + 0.035, 0], 0.024, 0.03, Z.tape);   // 腕部胶带环
        hazGlove(b, L, s * d.shoulderW, d, TH, hi, glove);                                                               // 手套（手掌 + 手指）
        // 靴子：圆头高筒靴（照 hazmat.glb，见 hzBoot）。原来的方块靴子、鞋底、踝部胶带环（现在在靴筒里面）不要了
        hzBoot(b, L, s * d.hipW, hi, boot, Z);
      }
      if (!hi) return;
      // ---------- M2 打磨：可指认的防化服细节（只在 high 档加形状，low 档保持上面那套简版） ----------
      // 依据：窃皮者选中版本（wikidot-en）"伪装方式：凸起吸附从人身上撕下的皮……看起来和真人一模一样" ——
      // 伪装态越贴近测试人穿的那套 hazmat.glb 越符合设定。下面每一处都照着 glb 上已经有、这个仿制品上还缺的件补，
      // 全部叠在已有的 body / gear 槽位上（不新增槽位、不多 draw call），颜色差别一律走顶点色 tint。
      // 形状一律挑便宜的：能用方块说清楚的就不用圆柱 —— 圆柱两端的盖子埋在衣服里看不见，白花一倍面数。
      // 这份构件和窃皮者真身共用 4000 面的预算（真身归另一个组），所以这里能省则省
      const H = d.H, shY = d.shoulderY, sw = d.shoulderW, hw = d.hipW;   // TH（上面传的 bulk）、shinR 在 extend 开头
      const lerpR = (y, y0, y1, r0, r1) => r0 + (r1 - r0) * U.clamp((y - y0) / (y1 - y0), 0, 1);
      const armR = y => lerpR(y, shY - 0.005 * H, d.elbowY, 0.03 * H * TH, 0.024 * H * TH);
      const foreR = y => lerpR(y, d.elbowY, d.handY + 0.02 * H, 0.024 * H * TH, 0.018 * H * TH);

      // 面罩的头带 + 颈封（脸罩、目镜、呼气阀、滤罐见 hzMask）
      if (seat) {
        // 坐车的头带（返修 FE1R · repair-r1 K7，验收员 spec：以前是一圈水平的矮圆环，比兜帽那一截粗，从正面看是一根伸出兜帽两侧的横杆）：
        // 照 glb，一道细带贴着兜帽，从面罩两侧斜着往后上方绕过后脑勺 —— 过兜帽中心、往后仰 a 的平面和兜帽椭球的交线（椭圆）往外 4 mm
        const T = THREE_(), Rx = hr * 1.12, Ry = hr * 1.12 * 0.82, Rz = hr * 1.12 * 1.05, a = 0.5;
        const rv = 1 / Math.hypot(Math.sin(a) / Ry, Math.cos(a) / Rz);
        const strap = new T.TorusGeometry(1, 0.05, 4, Z.band + 8);
        strap.scale(Rx + 0.005, rv + 0.005, 0.16);
        strap.rotateX(Math.PI / 2 - a);
        strap.translate(0, hy + hr * 0.12, hr * 0.02);
        b.geo('head', 'gear', strap, mask);
      } else b.limb('head', 'gear', [0, hy + hr * 0.5, hr * 0.02], [0, hy + hr * 0.45, hr * 0.02], hr * 1.08, hr * 1.1, Z.band, 1.06, mask);
      b.limb('head', 'gear', [0, shY + 0.028, 0], [0, shY - 0.004, 0], 0.076, 0.084, Z.band, mask);

      // 反光条：上臂、前臂、小腿各一道，胸前和兜帽各一圈 —— 隔着走廊先认出来的就是这几条
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R';
        // 和四肢同样段数（以前 5 段套在 6 段的胳膊外面，五边形的边心距比胳膊小，胳膊的棱从反光条里戳出来）
        // 坐车（glb 没载入时退回的这一套，repair-r4 L1）：反光带的高度、颜色照 glb（Metal #b9bec4），靴口是一圈黑胶带（glb 的 Tape）
        const AB = seat ? HZ_SEAT_BANDS.arm : [1.29, 1.35], FB = seat ? HZ_SEAT_BANDS.fore : [0.89, 0.95], BT = seat ? { tint: Q.cap } : { tint: HAZ_TAPE };
        b.limb('arm' + L, 'gear', [s * sw, AB[1], 0], [s * sw, AB[0], 0], armR(AB[1]) + 0.004, armR(AB[0]) + 0.004, Z.tape, BT);
        b.limb('fore' + L, 'gear', [s * sw, FB[1], 0], [s * sw, FB[0], 0], foreR(FB[1]) + 0.004, foreR(FB[0]) + 0.004, Z.tape, BT);
        // 靴口反光条（照 glb：盖住靴筒和裤腿的接缝）。半径 8.6 cm：边心距（10 段 8.18 cm、坐车 16 段 8.43 cm）比靴筒外接 8 cm 大，靴筒的棱不从反光条里戳出来
        b.limb('shin' + L, 'gear', [s * hw, 0.395, 0], [s * hw, 0.35, 0], 0.086, 0.086, Z.ring, seat ? { tint: Q.tapeG } : { tint: HAZ_TAPE });
      }
      // 胸前一圈反光带：坐车的没有（返修 FE1R · repair-r2，验收员 spec：glb 胸口没有这道带）
      if (!seat) b.limb('spine', 'gear', [0, 1.27, 0], [0, 1.21, 0], 0.199, 0.196, Z.chest, 0.82, { tint: HAZ_TAPE });
      if (seat) {
        // 坐车的兜帽反光带照 glb 在额头那么高（面罩顶上面一点）水平绕一圈（返修 FE1R · repair-r2，验收员 play / spec：以前横在兜帽顶上）：
        // 带子按兜帽椭球在这个高度的截面（往外 4 mm）
        // repair-r3（验收员 play：glb 的白带在目镜上沿那么高，坐车的高出一截在额头上）：照 glb 兜帽反光带的高度（glb 1.665–1.700，面罩椭球中心 1.615 →
        // 面罩中心往上 5–8.5 cm）
        const yc = hy + hr * 0.12, Rx = hr * 1.12, Ry = hr * 1.12 * 0.82, Rz = hr * 1.12 * 1.05, y0 = HZ_MASK.y + 0.05, y1 = y0 + 0.035;
        const rAt = y => Math.sqrt(Math.max(0, 1 - ((y - yc) / Ry) ** 2));
        // 颜色照 glb 那圈带子（Metal，浅灰；repair-r3 以前用的反光条银白，比 glb 亮一截）
        b.limb('head', 'gear', [0, y1, hr * 0.02], [0, y0, hr * 0.02], Rx * rAt(y1) + 0.004, Rx * rAt(y0) + 0.004, Z.band, Rz / Rx, { tint: Q.cap });
      } else b.limb('head', 'gear', [0, hy + hr * 0.85, hr * 0.02], [0, hy + hr * 0.79, hr * 0.02], hr * 0.75, hr * 0.8, Z.band, 1.06, { tint: HAZ_TAPE });

      // 压胶条（防化服是热合缝，每条缝上压一条胶带）、肩上的反光章、臂章
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R';
        b.box('spine', 'gear', [0.14, 0.014, 0.1], [s * 0.1, 1.478, 0]);
        b.box('spine', 'gear', [0.075, 0.016, 0.06], [s * 0.135, 1.474, -0.02], { tint: HAZ_TAPE });
        b.box('arm' + L, 'gear', [0.016, 0.3, 0.014], [s * sw, 1.26, 0.068]);
        b.box('leg' + L, 'gear', [0.016, 0.34, 0.014], [s * hw, 0.72, 0.095]);
        if (!seat) b.box('arm' + L, 'gear', [0.055, 0.07, 0.016], [s * sw, 1.36, -0.072]);   // 臂章（坐车的不要：glb 上没有，K7）
      }

      // 腿和靴：护膝（制服色，跟着换肤变色）、大腿侧袋和袋盖、靴口翻边、靴侧拉带
      for (const s of [-1, 1]) {
        const L = s < 0 ? 'L' : 'R';
        b.box('shin' + L, 'body', [0.085, 0.1, 0.022], [s * hw, 0.47, -0.082]);
        b.box('leg' + L, 'gear', [0.07, 0.095, 0.024], [s * (hw + 0.052), 0.72, -0.07]);
        b.box('leg' + L, 'gear', [0.076, 0.02, 0.028], [s * (hw + 0.052), 0.775, -0.072]);
      }

      // 腰带扣（扣片 + 扣舌）、胸前口袋和袋盖、上半段拉链和拉链头。
      // 原来那条拉链只有下半截露在外面，上半截被胸廓鼓包盖住了，这里顺着胸口曲面补一段，整条才连得起来
      b.box('hips', 'gear', [0.075, 0.05, 0.022], [0, d.hipY - 0.015, -0.185], { tint: HAZ_METAL });
      b.box('hips', 'gear', [0.022, 0.035, 0.012], [0, d.hipY - 0.015, -0.2], { tint: HAZ_METAL });
      if (seat) {
        // 坐车的（返修 FE1R · repair-r1 K7，验收员 play / spec：照 hazmat.glb 摆）：胸前口袋在拉链另一边、高到胸口（glb 的位置），大一号、上面一块袋盖；
        // 拉链从领口一直通到腰带，两道黑线（中间隔 1.2 cm），顺着胸口曲面
        b.box('spine', 'gear', [0.11, 0.13, 0.03], [-0.095, 1.33, -0.18]);
        b.box('spine', 'gear', [0.118, 0.024, 0.034], [-0.095, 1.405, -0.183]);
        b.box('spine', 'gear', [0.02, 0.016, 0.01], [-0.095, 1.425, -0.188], { tint: HAZ_METAL });
        const ZP = [[1.47, -0.168], [1.4, -0.188], [1.3, -0.186], [1.2, -0.172], [1.1, -0.162], [1.02, -0.17]];
        for (const xs of [-0.006, 0.006]) for (let i = 0; i + 1 < ZP.length; i++) b.limb('spine', 'gear', [xs, ZP[i][0], ZP[i][1]], [xs, ZP[i + 1][0], ZP[i + 1][1]], 0.0045, 0.0045, 4);
        b.box('spine', 'gear', [0.026, 0.03, 0.014], [0, 1.45, -0.176], { tint: HAZ_METAL });
      } else {
        b.box('spine', 'gear', [0.085, 0.1, 0.03], [0.085, 1.26, -0.185]);
        b.box('spine', 'gear', [0.092, 0.022, 0.034], [0.085, 1.318, -0.188]);
        b.limb('spine', 'gear', [0, 1.4, -0.186], [0, 1.22, -0.166], 0.012, 0.013, 4);
        b.box('spine', 'gear', [0.026, 0.03, 0.014], [0, 1.412, -0.19], { tint: HAZ_METAL });
      }
    },
  });
}

// ---------- 视觉钩子：每实例材质 slotMat、淡出淡入、共享粒子池（ENGINE_PLAN M1「S」「AA」） ----------
// 为什么放一起：slotMat 和 vanish/appear 都要"需要时才给这一只单独一份材质"，共用一份登记表，实体移除时一次释放干净。
// 全部是纯表现：不改 e.x/e.z、不碰行为数值、不打玩家；联机只靠 e.state（vanish/appear 写它），协议不变
const SLOTMAT_FAR = 28;          // 与 LOD.mid 同值：再远就看不出每只的差别，不值得多一份材质、多一次材质切换
const FADE_SEC = 0.5;            // vanish / appear 缺省时长
let clonesLive = 0;              // 调试计数：还没释放的实例材质份数

function lowQuality() { const s = BR.game && BR.game.settings; return !!(s && s.quality === 'low'); }
// 和 lodStep 同一口径：只算水平距离；没有相机（自测页）当作就在眼前
function camDist(obj) {
  const cam = BR.gfx && BR.gfx.camera;
  if (!cam || !cam.matrixWorld || !obj) return 0;
  const m = cam.matrixWorld.elements;
  return Math.hypot(obj.position.x - m[12], obj.position.z - m[14]);
}

// 只读视图：远处/低画质时 slotMat 返回共享材质的这个视图。读到的都是共享材质的真实值；直接赋值静默忽略；
// 调方法（color.setHex、setValues、dispose……）落在一份暂存副本上——实体代码照常写，不会报错，也不会把全体共用的材质改坏
const roProxy = new WeakMap(), roScratch = new WeakMap();
function scratchOf(t) {
  let s = roScratch.get(t);
  if (!s) {
    s = typeof t.clone === 'function' ? t.clone() : Object.create(t);
    roScratch.set(t, s);
  } else if (typeof s.copy === 'function') {
    try { s.copy(t); } catch (err) { /* 拷不过去就沿用旧副本：写进去的反正都作废 */ }
  }
  return s;
}
function readOnly(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  let p = roProxy.get(obj);
  if (p) return p;
  const fns = new Map();
  p = new Proxy(obj, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (typeof v === 'function') {
        if (k === 'constructor') return v;
        let w = fns.get(k);
        if (!w) {
          w = function () {
            const s = scratchOf(t);
            const r = typeof s[k] === 'function' ? s[k].apply(s, arguments) : undefined;
            return r === s ? p : r;   // 链式调用（setHex(..).multiplyScalar(..)）继续留在只读视图上
          };
          fns.set(k, w);
        }
        return w;
      }
      if (v && typeof v === 'object') {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        if (d && !d.configurable && !d.writable) return v;   // Proxy 不变式：不可写且不可配置的属性必须原样返回
        return readOnly(v);
      }
      return v;
    },
    set() { return true; },
    deleteProperty() { return true; },
  });
  roProxy.set(obj, p);
  return p;
}

// 每实例材质登记：网格/精灵 → { base: 原材质（按下标）, clone: 这一只的副本, claim: slotMat 正在用这份副本 }
function ownRec(u, obj) {
  const book = u.own || (u.own = new Map());
  let r = book.get(obj);
  if (!r) {
    const arr = Array.isArray(obj.material);
    const base = arr ? obj.material.slice() : [obj.material];
    r = { obj, arr, base, clone: new Array(base.length).fill(null), claim: new Array(base.length).fill(false) };
    book.set(obj, r);
  }
  return r;
}
function matAt(r, i) { return r.arr ? r.obj.material[i] : r.obj.material; }
function setMatAt(r, i, m) { if (r.arr) r.obj.material[i] = m; else r.obj.material = m; }
function onCloneDispose(ev) { ev.target.removeEventListener('dispose', onCloneDispose); clonesLive--; }
function cloneAt(r, i) {
  let c = r.clone[i];
  if (c) return c;
  const b = r.base[i];
  if (!b || !b.isMaterial) return null;
  c = b.clone();
  // entityOwned：不经 arch.register、直接 entityTypes.register + A.wrap 的实体，移除时 entities.js 也会释放挂在网格上的这份
  c.userData = Object.assign({}, c.userData, { entityOwned: true });
  c.addEventListener('dispose', onCloneDispose);
  clonesLive++;
  r.clone[i] = c;
  return c;
}

// u.slotMat(slot)：当前形态骨架上该槽位的"这一只专用"材质，第一次调用时才克隆
function slotMatOf(root, u, slot) {
  const rig = u.rig, mesh = rig && rig.mesh;
  if (!mesh || !rig.slots) return null;
  const i = rig.slots.indexOf(slot);
  if (i < 0) return null;
  const r = ownRec(u, mesh);
  const base = r.base[i];
  if (!base || !base.isMaterial) return null;
  if (lowQuality() || camDist(root) > SLOTMAT_FAR) {
    r.claim[i] = false;
    // 换回共享材质；淡出淡入进行中还要靠副本调透明度，等 appear 收尾时再换
    if (!u.fade && r.clone[i] && matAt(r, i) === r.clone[i]) setMatAt(r, i, base);
    return readOnly(base);
  }
  const c = cloneAt(r, i);
  if (!c) return readOnly(base);
  r.claim[i] = true;
  if (matAt(r, i) !== c) setMatAt(r, i, c);
  return c;
}

// ----- 淡出 / 淡入：由 e.state 驱动（'vanish' → 淡出，其余状态 → 淡回），房主和客机的 animate 都跑 -----
function fadeSec(u, cfg, which) {
  const own = which === 'vanish' ? u.fxVanishSec : u.fxAppearSec;
  if (own > 0) return own;
  const c = cfg && cfg[which + 'Sec'];   // 客机拿不到房主调用时传的 sec：想两端一致就把时长也写进 def.anim.vanishSec / appearSec
  return c > 0 ? c : FADE_SEC;
}
function fadeMats(u, a) {
  u.pivot.traverse(o => {
    if (!o.material) return;
    const r = ownRec(u, o);
    for (let i = 0; i < r.base.length; i++) {
      const c = cloneAt(r, i);
      if (!c) continue;
      if (matAt(r, i) !== c) setMatAt(r, i, c);
      if (!c.transparent) { c.transparent = true; c.needsUpdate = true; }
      c.opacity = num(r.base[i].opacity, 1) * a;
    }
  });
}
function unfadeMats(u) {
  if (!u.own) return;
  u.own.forEach(r => {
    for (let i = 0; i < r.base.length; i++) {
      const c = r.clone[i], b = r.base[i];
      if (!c || !b) continue;
      if (c.transparent !== b.transparent) { c.transparent = b.transparent; c.needsUpdate = true; }
      c.opacity = b.opacity;
      // 只把为淡出淡入临时换上的副本换回共享材质；slotMat 正在用的留着，上面写的颜色不丢
      if (!r.claim[i] && matAt(r, i) === c) setMatAt(r, i, b);
    }
  });
}
function fadeTick(e, dt, u, cfg) {
  const out = e.state === 'vanish';
  let f = u.fade;
  if (!f) {
    if (!out) return;   // 从没隐身过：什么都不碰
    f = u.fade = { a: 1, low: false, hid: false, sx: 1, sy: 1, sz: 1, wx: NaN, wy: NaN, wz: NaN };
  }
  f.a = out ? Math.max(0, f.a - dt / fadeSec(u, cfg, 'vanish')) : Math.min(1, f.a + dt / fadeSec(u, cfg, 'appear'));
  const pv = u.pivot, low = lowQuality();
  if (low !== f.low) { if (low) unfadeMats(u); f.low = low; }   // 中途切到低画质：副本透明度收回，改用缩放
  if (low) {
    // 低画质不克隆材质：按进度缩小（和 anim fall:'fade' 同一种做法）。auto 每帧重写 pivot.scale；自定义 animate 不重写时
    // scale 还是上一帧写的值——认出来就沿用上次的基准，免得越乘越小
    const s = pv.scale;
    if (!(s.x === f.wx && s.y === f.wy && s.z === f.wz)) { f.sx = s.x; f.sy = s.y; f.sz = s.z; }
    const k = Math.max(0.001, f.a);
    s.set(f.sx * k, f.sy * k, f.sz * k);
    f.wx = s.x; f.wy = s.y; f.wz = s.z;
  } else {
    fadeMats(u, f.a);
  }
  const hide = f.a <= 0;
  if (hide !== f.hid) { pv.visible = !hide; f.hid = hide; }
  if (!out && f.a >= 1) {
    unfadeMats(u);
    if (f.hid) pv.visible = true;
    u.fade = null;
  }
}
// 房主调：写 e.state，快照带给客机；sec 只在本机生效（见 fadeSec）
function fxVanish(e, o) {
  if (!e) return false;
  const u = e.obj && e.obj.userData && e.obj.userData.arch;
  const sec = num(o && o.sec, 0);
  if (u && sec > 0) u.fxVanishSec = sec;
  e.state = 'vanish';
  return true;
}
function fxAppear(e, o) {
  if (!e) return false;
  const u = e.obj && e.obj.userData && e.obj.userData.arch;
  const sec = num(o && o.sec, 0);
  if (u && sec > 0) u.fxAppearSec = sec;
  e.state = 'appear';
  return true;
}
// 自己写 animate、没走 def.anim 的实体在 animate 里调它，淡出淡入才会动
function fxUpdate(e, dt) {
  const u = e && e.obj && e.obj.userData && e.obj.userData.arch;
  if (u && (u.fade || e.state === 'vanish')) fadeTick(e, num(dt, 0), u, e.def && e.def.anim);
}

// ----- 共享粒子池：全场 1 个 THREE.Points（1 个 draw call），高画质 ≤200 粒、低画质 ≤100 粒 -----
// 为什么在 onBeforeRender 里步进：粒子只是画面，不用进逻辑循环；没在画的时候不耗 CPU。three 在调 onBeforeRender 之前
// 已经把缓冲传完了，所以这一帧的绘制范围用步进前的数量，步进结果下一帧上屏（晚一帧看不出来，也不会画到挪过位的旧数据）
const POOL_MAX = 200;
const POOL = { points: null, n: 0, t: 0, rnd: null, pos: null, col: null, vel: null, rgb: null, age: null, life: null, floor: null, grav: null, drag: null };
function poolCap() { return lowQuality() ? POOL_MAX / 2 : POOL_MAX; }
function poolInit() {
  if (POOL.points) return POOL.points;
  const T = THREE_();
  if (!T) return null;
  POOL.pos = new Float32Array(POOL_MAX * 3);
  POOL.col = new Float32Array(POOL_MAX * 4);
  POOL.vel = new Float32Array(POOL_MAX * 3);
  POOL.rgb = new Float32Array(POOL_MAX * 3);
  POOL.age = new Float32Array(POOL_MAX);
  POOL.life = new Float32Array(POOL_MAX);
  POOL.floor = new Float32Array(POOL_MAX);
  POOL.grav = new Float32Array(POOL_MAX);
  POOL.drag = new Float32Array(POOL_MAX);
  POOL.rnd = U.mulberry32(U.hashStr('arch-fx-particles'));   // 不用 Math.random：同样的调用顺序出同样的画面，截图可对照
  const g = new T.BufferGeometry();
  const pa = new T.BufferAttribute(POOL.pos, 3), ca = new T.BufferAttribute(POOL.col, 4);   // 4 分量颜色 = 每粒自带透明度
  pa.setUsage(T.DynamicDrawUsage);
  ca.setUsage(T.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('color', ca);
  g.setDrawRange(0, 0);
  g.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);   // 不裁剪；射线/包围球计算也别去扫一遍零散的粒子
  const dot = canvasTex('fxdot', 32, 1, (c, s) => {
    const grd = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd; c.fillRect(0, 0, s, s);
  });
  if (dot) dot.wrapS = dot.wrapT = T.ClampToEdgeWrapping;
  const m = new T.PointsMaterial({ size: 0.09, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, map: dot || null });
  const pts = new T.Points(g, m);
  pts.name = 'arch fx particles';
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 2;
  pts.onBeforeRender = poolRender;
  POOL.points = pts;
  return pts;
}
function poolKill(i) {
  const j = --POOL.n;
  if (i === j) return;
  const P = POOL, i3 = i * 3, j3 = j * 3;
  for (let k = 0; k < 3; k++) { P.pos[i3 + k] = P.pos[j3 + k]; P.vel[i3 + k] = P.vel[j3 + k]; P.rgb[i3 + k] = P.rgb[j3 + k]; }
  for (let k = 0; k < 4; k++) P.col[i * 4 + k] = P.col[j * 4 + k];
  P.age[i] = P.age[j]; P.life[i] = P.life[j]; P.floor[i] = P.floor[j]; P.grav[i] = P.grav[j]; P.drag[i] = P.drag[j];
}
function poolWriteColors() {
  const P = POOL;
  for (let i = 0; i < P.n; i++) {
    const k = P.age[i] / P.life[i], i3 = i * 3, i4 = i * 4;
    P.col[i4] = P.rgb[i3]; P.col[i4 + 1] = P.rgb[i3 + 1]; P.col[i4 + 2] = P.rgb[i3 + 2];
    P.col[i4 + 3] = k < 0.6 ? 1 : Math.max(0, (1 - k) / 0.4);   // 寿命最后 40% 渐隐
  }
  const g = P.points.geometry;
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
}
function poolStep(dt) {
  const P = POOL;
  const steps = Math.max(1, Math.min(150, Math.ceil(dt * 30)));
  const h = dt / steps;
  for (let s = 0; s < steps && P.n; s++) {
    // 倒着扫：poolKill 把末尾那粒挪进空位，末尾那粒这一步已经算过
    for (let i = P.n - 1; i >= 0; i--) {
      P.age[i] += h;
      if (P.age[i] >= P.life[i]) { poolKill(i); continue; }
      const i3 = i * 3, d = Math.max(0, 1 - P.drag[i] * h);
      P.vel[i3] *= d;
      P.vel[i3 + 1] = P.vel[i3 + 1] * d - P.grav[i] * h;
      P.vel[i3 + 2] *= d;
      P.pos[i3] += P.vel[i3] * h;
      P.pos[i3 + 1] += P.vel[i3 + 1] * h;
      P.pos[i3 + 2] += P.vel[i3 + 2] * h;
      if (P.pos[i3 + 1] < P.floor[i]) { P.pos[i3 + 1] = P.floor[i]; P.vel[i3 + 1] = 0; P.vel[i3] *= 0.5; P.vel[i3 + 2] *= 0.5; }
    }
  }
  poolWriteColors();
}
function poolRender() {
  const P = POOL, drawn = P.n, t = now(), dt = t - P.t;
  P.t = t;
  if (dt > 0 && P.n) poolStep(Math.min(dt, 5));
  P.points.geometry.setDrawRange(0, drawn);
  if (!P.n) P.points.visible = false;
}
function poolOldest() {
  const P = POOL;
  let bi = 0, bk = -1;
  for (let i = 0; i < P.n; i++) { const k = P.age[i] / P.life[i]; if (k > bk) { bk = k; bi = i; } }
  return bi;
}
function poolEmit(x, y, z, o) {
  const pts = poolInit(), scene = BR.gfx && BR.gfx.scene;
  if (!pts || !scene) return 0;
  if (pts.parent !== scene) scene.add(pts);
  const P = POOL, cap = poolCap();
  if (P.n > cap) P.n = cap;   // 刚切到低画质：超出的直接丢
  const want = Math.max(0, Math.min(cap, num(o.count, 24) | 0));
  if (!want) return 0;
  if (!P.n) P.t = now();      // 池子空着的这段时间不算进下一次步进
  const T = THREE_(), C = new T.Color(), r = P.rnd;
  const colors = Array.isArray(o.color) && o.color.length ? o.color : [num(o.color, 0xffffff)];
  const speed = num(o.speed, 2.2), life = Math.max(0.05, num(o.life, 0.9)), grav = num(o.gravity, 4), drag = Math.max(0, num(o.drag, 1.2));
  const up = num(o.up, 0.35), spread = Math.max(0, num(o.spread, 0.12));
  // 落地高度：缺省取地面和发射点里低的那个（发射点在楼上时别把粒子顶上去）；多层层级自己传 floor
  const gy = has(BR.phys, 'groundY') ? num(+BR.phys.groundY(x, z), -1e9) : -1e9;
  const floor = num(o.floor, Math.min(gy, y)) + 0.02;
  for (let k = 0; k < want; k++) {
    const i = P.n < cap ? P.n++ : poolOldest();   // 满了挤掉最老的
    const i3 = i * 3;
    const cy = r() * 2 - 1, th = r() * TAU, sr = Math.sqrt(1 - cy * cy), sp = speed * (0.35 + 0.65 * r());
    P.vel[i3] = sr * Math.cos(th) * sp;
    P.vel[i3 + 1] = (cy + up) * sp;
    P.vel[i3 + 2] = sr * Math.sin(th) * sp;
    P.pos[i3] = x + (r() - 0.5) * 2 * spread;
    P.pos[i3 + 1] = y + (r() - 0.5) * 2 * spread;
    P.pos[i3 + 2] = z + (r() - 0.5) * 2 * spread;
    C.setHex(num(colors[(r() * colors.length) | 0], 0xffffff) & 0xffffff);
    const lum = 0.85 + 0.3 * r();
    P.rgb[i3] = C.r * lum; P.rgb[i3 + 1] = C.g * lum; P.rgb[i3 + 2] = C.b * lum;
    P.age[i] = 0;
    P.life[i] = life * (0.7 + 0.6 * r());
    P.floor[i] = floor;
    P.grav[i] = grav;
    P.drag[i] = drag;
  }
  poolWriteColors();
  pts.geometry.setDrawRange(0, P.n);
  pts.visible = true;
  return want;
}
function poolClear() {
  POOL.n = 0;
  if (POOL.points) { POOL.points.visible = false; POOL.points.geometry.setDrawRange(0, 0); }
}
// A.fx.burst：粒子 + 中心一闪的光球。光球直接用物品的 itemKit.burstFx（爆炸、闪电落点同一种画法），不另造一份
function fxBurst(x, y, z, o) {
  o = o || {};
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return 0;
  const n = poolEmit(x, y, z, o);
  const K = BR.itemKit;
  if (o.flash !== false && K && has(K, 'burstFx')) {
    const c = Array.isArray(o.color) ? o.color[0] : o.color;
    K.burstFx(x, y - 0.5, z, num(c, 0xffffff), num(o.radius, 0.5), num(o.flashSec, 0.3));   // burstFx 的 y 是脚底，球心画在 y+0.5
  }
  return n;
}
function fxDebug() {
  return { particles: POOL.n, particleCap: poolCap(), poolMax: POOL_MAX, points: POOL.points ? 1 : 0, clones: clonesLive };
}
// 换层 / 回主页：粒子是上一层的画面，不带过去
if (BR.bus && has(BR.bus, 'on')) {
  BR.bus.on('level:leave', poolClear);
  BR.bus.on('game:home', poolClear);
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
    lx: NaN, lz: NaN, sp: 0, phase: 0, seed: 0, seedFor: null, acc: 0,   // seed：摆动相位，第一次 animate 时按实体 id 定（见 animate）
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
  // 普通实体 4k 预算不算 parts.swarm 的实例化个体：个体另有 TRIS.swarmUnit 预算（swarmPart 里查），几十个小个体共用一个 draw call
  let tris = 0;
  root.traverse(x => { if (x.isMesh && x.geometry && !x.isInstancedMesh) tris += trisOfGeo(x.geometry); });
  tris = Math.round(tris);
  const limit = num(o.budget, TRIS.normal);
  if (tris > limit) once('budget:' + (o.label || '') + tris, () => console.warn('[arch] 模型三角面 ' + tris + ' 超预算 ' + limit, o.label || ''));
  // draw call：按材质槽位分组算（geometry.groups.length），只数当前可见的形态；InstancedMesh（parts.swarm）本身就是 1 个
  let draws = 0;
  root.traverse(x => {
    if (x.isInstancedMesh) { draws++; return; }
    if (!(x.isMesh || x.isSkinnedMesh) || !x.geometry) return;
    for (let p = x; p; p = p.parent) { if (p.visible === false) return; if (p === root) break; }
    const g = x.geometry;
    draws += g.groups && g.groups.length ? g.groups.length : 1;
  });
  if (draws > TRIS.drawCalls) once('draws:' + (o.label || '') + draws, () => console.warn('[arch] 模型 draw call ' + draws + ' 超过 ' + TRIS.drawCalls, o.label || ''));
  // 每实例材质入口（S）：在 onFrame / animate 里拿到的 u 上调。不调就不克隆，材质和改动前一样全体共享
  u.slotMat = slot => slotMatOf(root, u, slot);
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
  // slotMat / 淡出淡入给这一只克隆的材质：不管此刻挂没挂在网格上都释放（远处换回共享材质的那份不在网格上，entities.js 找不到它）
  const u = o.userData && o.userData.arch;
  if (u && u.own) {
    u.own.forEach(r => {
      for (let i = 0; i < r.clone.length; i++) if (r.clone[i]) { r.clone[i].dispose(); r.clone[i] = null; }
    });
    u.own.clear();
  }
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
// 攻击一个冷却周期 k∈[0,1)：蓄力 → 出手 → 收回。STRIKE_PEAK 处到峰值（swipe 胳膊抡到最前、bite 嘴合上），
// entities.js 就在这一刻扣血（STRIKE_HIT_K，同一个数，改一个要两个一起改；tests/infection.mjs 核对）
const STRIKE_PEAK = 0.38;
function strikeCurve(k) { return k < 0.22 ? -0.4 * (k / 0.22) : k < STRIKE_PEAK ? U.lerp(-0.4, 1, (k - 0.22) / (STRIKE_PEAK - 0.22)) : Math.max(0, 1 - (k - STRIKE_PEAK) / 0.4); }
// 这一帧在攻击周期的哪里：房主 / 单机从这一下起手（entities 记的 attackStart）算，扣血那一刻正好是 STRIKE_PEAK；
// 抡完一轮还没起下一手（隔墙够不着之类）就停在收回的姿势，不空抡。客机没有起手时刻，照旧按进入 attack 状态的时刻一轮轮循环
function strikePhase(e, api, t, u, cd) {
  const s0 = has(api, 'attackStart') ? api.attackStart(e) : null;
  if (s0 != null && t >= s0 && t - s0 < 3 * cd) return Math.min(0.999, (t - s0) / cd);
  return ((t - u.stateAt) % cd) / cd;
}
// 这一下还没抡完（房主：起手以后 0.78 个冷却周期以内）—— 扣血那一帧实体照常想事，可能已经把 e.state 改成 search / chase 了，
// 胳膊不能在扣血那一帧就收回去（FE1R K6：窃皮者扣血那一帧手垂在身边，离司机 55 cm）
function striking(e, api, t) {
  const s0 = has(api, 'attackStart') ? api.attackStart(e) : null;
  if (s0 == null || e.dead) return false;
  const cd = Math.max(0.2, num(e.def.attack && e.def.attack.cooldown, 1));
  return t >= s0 && t - s0 < (STRIKE_PEAK + 0.4) * cd;
}
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

// ---------- 打坐在叉车上的人（FE1R K6） ----------
// 孩子挑的：「它没打着人，怎么掉血了」（悲尸扣血那一帧手离司机还有 12 cm，打在靠背上）、「胳膊插进车里了」（收手时整条前臂从上往下
// 扫进发动机盖 20–30 cm）。站着打人那条胳膊从后往前、从下往上的弧，对着车侧面抡一定会扫过发动机盖和坐垫，所以打坐在车上的人换一种摆法：
//   有 armR / foreR 骨骼的人形怪（悲尸、钝人、窃皮者……strike 是 swipe / grab 的）站在驾驶舱侧面（车身外面，站哪里、够不够得着由
//   entities.js「打坐在车上的人」定），蓄力时手抬到肩膀外侧上方 → 出手时从上面越过车身侧板（手离地 1.6 m 以上，发动机盖顶 1.0、
//   护顶底 2.04，前后立柱之间的开口里）→ 手指尖 / 爪尖正好落在司机近侧肩膀外侧（grab 另一只手落在近侧肋下）→ 收手原路退回 → 放下。
//   手的位置用两段 IK（肩、肘，肘往外、往下、往后），落点是 entities.js 给的世界坐标（api.seatTarget），已经往外让出 4 mm：
//   扣血那一刻（STRIKE_PEAK）手正好贴着人，不插进去。时机、冷却、伤害都不变，只是胳膊走的路不一样。
//   客机没有起手时刻：相位照旧按进入 attack 的时刻循环，落点 seatTarget 自己按「离这只怪最近、有人坐着的车」算，摆法一样
const SEAT_HAND = 0.006;               // 两只手抓的（grab）：手离坐着的人身最外一层留多少（repair-r4，见 strikeSeat）
const SEAT_RISE = [0.2, 0.30, 0.18];    // 蓄力点：肩膀往外 20 cm、往后 18 cm（模型空间，脸朝 −z）；高度见 strikeSeat
const SEAT_POLE = [0.5, -1, 0.4];        // IK 肘的朝向：往外、往下、往后
const RIGINFO = new Map();
let SK = null;
function seatScratch() {
  if (SK) return SK;
  const T = THREE_(), V = () => new T.Vector3(), M = () => new T.Matrix4(), Q = () => new T.Quaternion();
  SK = { root: M(), m: M(), inv: M(), sp: M(), arm: M(), fore: M(), qsp: Q(), qa: Q(), qai: Q(), q: Q(), S: V(), P: V(), E: V(), d: V(), pole: V(), u: V(), f: V(), l: V(), t: V(), R0: V(), P1: V(), Tg: V(), tmp: V(), wm: M() };
  return SK;
}
// 骨骼（或任何节点）到 stop 之间一路的本地矩阵乘起来（按此刻的 position / quaternion）
function chainMat(node, stop, out) {
  out.identity();
  for (let o = node; o && o !== stop; o = o.parent) { o.updateMatrix(); out.premultiply(o.matrix); }
  return out;
}
// 人形骨架的胳膊尺寸（按绑定姿势，每个骨架 key 算一次）：肩 / 肘的绑定位置、上臂长 a、肘到指尖（爪尖）b、两段的绑定方向；
// 再按基础姿势（佝偻、四肢着地……）把整个模型摆一遍，量脚 / 腿往前伸多远（站在车边时脚不进底盘）
function rigInfo(rig) {
  if (!rig || !rig.key) return null;
  if (RIGINFO.has(rig.key)) return RIGINFO.get(rig.key);
  const T = THREE_(), B = rig.bones;
  let info = null;
  if (B.armR && B.foreR && B.armL && B.foreL && B.spine && rig.mesh && rig.mesh.geometry) {
    const idx = {}, rest = new Map();
    rig.list.forEach((it, i) => { idx[it.name] = i; rest.set(it.bone, it.rest); });
    const abs = name => { const v = new T.Vector3(); for (let b = B[name]; b && b !== rig.mesh; b = b.parent) v.add(rest.get(b) || b.position); return v; };
    const geo = rig.mesh.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, v = new T.Vector3();
    const arm = side => {
      const fi = idx['fore' + side], S = abs('arm' + side), E = abs('fore' + side);
      let tip = null, best = -1;
      for (let i = 0; i < pos.count; i++) {
        if (si.getX(i) !== fi) continue;
        v.fromBufferAttribute(pos, i);
        const d = v.distanceTo(E);
        if (d > best) { best = d; tip = v.clone(); }
      }
      if (!tip) return null;
      return { S, E, tip, a: S.distanceTo(E), b: best, dA: E.clone().sub(S).normalize(), dB: tip.clone().sub(E).normalize() };
    };
    const R = arm('R'), L = arm('L');
    if (R && L) {
      // 基础姿势下每个顶点的位置（模型空间）：脚 / 腿离地 0.66 m 以下、0.66–1.04 m 这两段往前（−z）伸出去最远多少，往两边最宽多少
      const saved = rig.list.map(it => [it.bone.position.clone(), it.bone.quaternion.clone()]);
      pose(rig);
      const mats = rig.list.map(it => chainMat(it.bone, rig.mesh, new T.Matrix4()));
      const binds = rig.list.map(it => abs(it.name));
      let low = 0, mid = 0, side = 0, top = 0;
      for (let i = 0; i < pos.count; i++) {
        const b = si.getX(i);
        v.fromBufferAttribute(pos, i).sub(binds[b]).applyMatrix4(mats[b]);
        if (v.y < 0.66) low = Math.max(low, -v.z);
        else if (v.y < 1.04) mid = Math.max(mid, -v.z);
        if (v.y < 1.04) side = Math.max(side, Math.abs(v.x));
        top = Math.max(top, v.y);
      }
      const shR = chainMat(B.armR, rig.mesh, new T.Matrix4()), shL = chainMat(B.armL, rig.mesh, new T.Matrix4());
      info = { R, L, low, mid, side, top, shR: new T.Vector3().setFromMatrixPosition(shR), shL: new T.Vector3().setFromMatrixPosition(shL) };
      rig.list.forEach((it, i) => { it.bone.position.copy(saved[i][0]); it.bone.quaternion.copy(saved[i][1]); });
    }
  }
  RIGINFO.set(rig.key, info);
  return info;
}
// 给 entities.js 用：这只怪能不能用胳膊打坐在车上的人、胳膊多长、基础姿势下肩膀在哪（模型空间，脸朝 −z）。不能（没胳膊、
// 咬 / 扑 / 蜇的）返回 null
function seatReach(e) {
  const u = e && e.obj && e.obj.userData && e.obj.userData.arch;
  const cfg = e && e.def && e.def.anim;
  // 没有胳膊、用别的东西「碰」人的（笑魇：整张脸扑过去），def.seatStrike = { kind: 'face', reach, y } 自己给
  const ss = e && e.def && e.def.seatStrike;
  if (ss && ss.kind === 'face' && u) { const y = num(ss.y, 1.7), R0 = num(ss.reach, 0.9); return { kind: 'face', a: 0, b: R0, reach: R0, shR: [0, y, 0], shL: [0, y, 0], low: 0, mid: 0, side: 0, top: y }; }
  // 没有胳膊的近战怪（返修 FE1R · repair-r1，验收员 play / tests：猎犬、啼物、肢团、牧蛇、悲尸肉块、Nguithr'xurh 以前打不到坐车的人，叉车成了安全屋）：
  // 'leap' 整只扑上去（嘴 / 身体最前面那一点碰到人）、'chain' 一条肢体 / 蛇身伸过去（梢碰到人），见 seatLeap / seatChain。
  // 给 entities.js 的口径和笑魇一样（kind 'face'：落点是司机这一侧最靠外的那一点 tf）：shR = 碰人的那一点在基础姿势下的位置（模型空间），
  // reach = 从那一点最远扑 / 伸多远；low / mid = 身体（不含肢体）离地 0.66 m 以下 / 0.66–1.04 m 往前伸出去多远（站点离车身外侧要让出来）
  if (ss && (ss.kind === 'leap' || ss.kind === 'chain') && u && u.rig) {
    const g = seatGeom(e, u, ss);
    if (!g) return null;
    return { kind: 'face', mode: ss.kind, fixed: !!ss.fixed, a: 0, b: g.reach, reach: g.reach, shR: g.C, shL: g.C, low: g.low, mid: g.mid, side: 0, top: g.top };
  }
  if (!u || !u.rig || !cfg) return null;
  const gait = cfg.gait || (u.rig.bones.wingL ? 'flyer' : u.rig.bones.legFL ? 'quad' : u.rig.bones.legL ? 'biped' : 'none');
  const kind = cfg.strike || (gait === 'quad' ? 'bite' : 'swipe');
  if (kind !== 'swipe' && kind !== 'grab') return null;
  const info = rigInfo(u.rig);
  if (!info) return null;
  return { kind, a: info.R.a, b: info.R.b, reach: info.R.a + info.R.b, shR: info.shR.toArray(), shL: info.shL.toArray(), low: info.low, mid: info.mid, side: info.side, top: info.top };
}
// 两段 IK：把 side 这只手的指尖放到模型空间的 P（肘按 SEAT_POLE），改 arm / fore 两根骨骼的 quaternion
function armTo(rig, info, side, P, Msp, poleW) {
  const K = seatScratch(), A2 = info[side], B = rig.bones, armB = B['arm' + side], foreB = B['fore' + side];
  const sx = side === 'R' ? 1 : -1;
  K.qsp.setFromRotationMatrix(Msp);
  K.S.copy(armB.position).applyMatrix4(Msp);
  const d = K.d.subVectors(P, K.S), dist = d.length();
  if (dist < 1e-4) return;
  const a = A2.a, b = A2.b;
  const dn = Math.min(Math.max(dist, Math.abs(a - b) + 1e-3), (a + b) * 0.9995);
  d.multiplyScalar(1 / dist);
  const cosA = Math.min(1, Math.max(-1, (a * a + dn * dn - b * b) / (2 * a * dn))), sinA = Math.sqrt(1 - cosA * cosA);
  const pole = K.pole.set(sx * SEAT_POLE[0], SEAT_POLE[1], SEAT_POLE[2]).normalize();
  // 落到人身上那一段：肘尽量摆到「落点正后方（往外）一个前臂长」那边，前臂水平地顶到人身上（手指不从斜上方压进肩膀的斜面）
  if (poleW > 0) { K.l.set(P.x, P.y, P.z + b).sub(K.S).normalize(); pole.lerp(K.l, poleW).normalize(); }
  pole.addScaledVector(d, -pole.dot(d));
  if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0);
  pole.normalize();
  const u = K.u.copy(d).multiplyScalar(cosA).addScaledVector(pole, sinA).normalize();
  K.E.copy(K.S).addScaledVector(u, a);
  const f = K.f.copy(K.S).addScaledVector(d, dn).sub(K.E).normalize();
  K.qai.copy(K.qsp).invert();
  armB.quaternion.setFromUnitVectors(A2.dA, K.l.copy(u).applyQuaternion(K.qai));
  K.qa.multiplyQuaternions(K.qsp, armB.quaternion).invert();
  foreB.quaternion.setFromUnitVectors(A2.dB, K.l.copy(f).applyQuaternion(K.qa));
}
// 此刻（FK）这只手的指尖在模型空间哪里
function tipNow(rig, info, side, out) {
  const K = seatScratch();
  chainMat(rig.bones['fore' + side], rig.mesh, K.fore);
  return out.copy(info[side].tip).sub(info[side].E).applyMatrix4(K.fore);
}
function ease(x) { x = U.clamp(x, 0, 1); return x * x * (3 - 2 * x); }
// k：这一下攻击周期的相位（strikePhase）；tg：api.seatTarget(e) 给的 { t1, t2（世界坐标）}。摆上了返回 true
function strikeSeat(e, rig, k, kind, tg, u) {
  const info = rigInfo(rig);
  if (!info || !tg || !tg.t1) return false;
  const K = seatScratch(), B = rig.bones;
  // 世界 → 模型空间：根节点按 e 的位置 / 朝向（syncObj 在 animate 之后才写 obj），往下乘 pivot、模型自己的矩阵
  K.root.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
  chainMat(rig.mesh, e.obj, K.m).premultiply(K.root);
  K.inv.copy(K.m).invert();
  // 上身往目标那边略倾（出手时），算 IK 之前先摆上
  const PK = STRIKE_PEAK, w = k < 0.22 ? 0 : k < PK ? ease((k - 0.22) / (PK - 0.22)) : k < PK + 0.36 ? 1 - ease((k - PK) / 0.36) : 0;
  addRot(rig, 'spine', -0.12 * w);
  chainMat(B.spine, rig.mesh, K.sp);
  const sides = kind === 'grab' ? ['R', 'L'] : ['R'];
  // 两个落点分给两只手：离谁的肩膀近给谁（grab）；swipe 只有右手，打 t1（肩膀）
  const t1 = K.t.set(tg.t1.x, tg.t1.y, tg.t1.z).applyMatrix4(K.inv).clone();
  const t2 = tg.t2 ? new (THREE_().Vector3)(tg.t2.x, tg.t2.y, tg.t2.z).applyMatrix4(K.inv) : t1.clone();
  const shR = K.tmp.copy(B.armR.position).applyMatrix4(K.sp).clone(), shL = new (THREE_().Vector3)().copy(B.armL.position).applyMatrix4(K.sp);
  let tR = t1, tL = t2;
  if (kind === 'grab' && shR.distanceTo(t2) + shL.distanceTo(t1) < shR.distanceTo(t1) + shL.distanceTo(t2)) { tR = t2; tL = t1; }
  for (const side of sides) {
    const sh = side === 'R' ? shR : shL, sx = side === 'R' ? 1 : -1, tgt = side === 'R' ? tR : tL;
    const R0 = tipNow(rig, info, side, K.R0);
    // 蓄力点：肩膀外侧、后面，高度在落点上方 8 cm —— 手最后一段差不多水平地伸到人肩膀外侧，
    // 不从人头顶上方压下来（坐着的人转头看怪时，面罩两侧的滤罐正好在肩膀上方，个子高的钝人从上往下抓会抓进滤罐里）
    const P1 = K.P1.set(sh.x + sx * SEAT_RISE[0], tgt.y + 0.08, sh.z + SEAT_RISE[2]);
    let P, pw = 0;
    if (k < 0.22) P = R0.clone().lerp(P1, ease(k / 0.22));
    else if (k < PK) { pw = ease((k - 0.22) / (PK - 0.22)); P = P1.clone().lerp(tgt, pw); }
    else if (k < PK + 0.18) { pw = 1 - ease((k - PK) / 0.18); P = tgt.clone().lerp(P1, 1 - pw); }
    else if (k < PK + 0.38) P = P1.clone().lerp(R0, ease((k - PK - 0.18) / 0.2));
    else continue;
    armTo(rig, info, side, P, K.sp, pw);
    // 贴到人身上那一段：整只手（前臂骨骼上的顶点）不越过落点所在的那个竖直面（脸朝 −z，往外是 +z；落点是人这一侧最靠外的点，
    // 这个面挡在人前面）—— 手指、手掌从斜上方压下来会越过去插进肩膀的斜面，越过多少就把落点往外挪多少，再解一次 IK（两轮）
    // 两只手抓的（grab，返修 FE1R · repair-r4）不用这个竖直面，改按坐着的人身最外一层（driverSurf：坐姿人形三角形按 y 切片、沿 z 光栅化，1 cm 一格）
    // 贴：手（前臂骨骼上离肘最远的那 40%：手掌、手指）离那一层最近的那一点留 SEAT_HAND —— 插进去了往外挪，离得远了（随出手的进度 pw）往里贴。
    // 坐车的人换成 hazmat.glb 的躯干以后，竖直面挡着时钝人第二只手去抓肋下会插进垂在身侧的上臂 1–2 cm，挪出来以后两只手又都离人 3.5–4 cm
    // （竖直面在落点那一格的最外面，手按上去的地方人身往里收）
    const rv = pw > 0 ? rigVerts(rig) : null, fi = rv && rv.byName['fore' + side], a = fi != null ? rv.per[fi] : null;
    const V = BR.vehicles, car = kind === 'grab' && V && has(V, 'byKey') && tg.key != null ? V.byKey(tg.key) : null, cp = car && car.pose;
    if (a && cp) {
      const cc = Math.cos(cp.yaw), sc = Math.sin(cp.yaw), y0 = num(cp.y, 0), sd = tg.side > 0 ? 1 : -1, W = K.tmp;
      let fl = 0;
      for (let q = 0; q < a.length; q += 3) fl = Math.max(fl, a[q] * a[q] + a[q + 1] * a[q + 1] + a[q + 2] * a[q + 2]);
      const hand2 = fl * 0.36;
      for (let it = 0; it < 3; it++) {
        chainMat(B['fore' + side], rig.mesh, K.fore);
        K.wm.multiplyMatrices(K.m, K.fore);
        let clr = Infinity;
        for (let q = 0; q < a.length; q += 3) {
          if (a[q] * a[q] + a[q + 1] * a[q + 1] + a[q + 2] * a[q + 2] < hand2) continue;
          W.set(a[q], a[q + 1], a[q + 2]).applyMatrix4(K.wm);
          const dx = W.x - cp.x, dz = W.z - cp.z, lx = cc * dx - sc * dz, lz = sc * dx + cc * dz, ly = W.y - y0;
          if (ly < 1.0 || ly > 2.0 || lz < -0.8 || lz > 0.7) continue;
          const sx = surfAt1(sd, ly, lz);
          if (sx > 0) clr = Math.min(clr, sd * lx - sx);
        }
        if (!Number.isFinite(clr)) break;
        const dz = SEAT_HAND - clr, mv = dz > 0 ? dz : dz * pw;
        if (Math.abs(mv) < 0.001) break;
        P.z += mv;
        armTo(rig, info, side, P, K.sp, pw);
      }
    } else if (a) {
      for (let it = 0; it < 2; it++) {
        chainMat(B['fore' + side], rig.mesh, K.fore);
        const el = K.fore.elements;
        let mz = Infinity;
        for (let q = 0; q < a.length; q += 3) mz = Math.min(mz, el[2] * a[q] + el[6] * a[q + 1] + el[10] * a[q + 2] + el[14]);
        const lim = tgt.z - 0.003 * pw;
        if (!(mz < lim)) break;
        P.z += (lim - mz) + 0.001;
        armTo(rig, info, side, P, K.sp, pw);
      }
    }
  }
  // 不出手的那只胳膊（swipe 只用右手，左手照走路 / 待机的摆法）：出手这一段（w > 0）它的上臂、前臂（连手）也不越过落点那个竖直面 ——
  // 越过多少就把那条胳膊往后摆多少（按越过的深度除以胳膊长换成角度，深度是连续变化的，摆的角度也连续，不一跳）；离那个面留 1 cm
  // （返修 FE1R · repair-r4：坐车的人从头到脚换成 hazmat.glb 的件以后落点挪了 1–2 mm，钝人停的位置前后差了 1.4 cm（到点容差 3 cm 里），
  // 另一只手的手背正好插进司机上臂 2.3 cm —— 以前也只是碰巧没插进去）
  if (kind !== 'grab' && w > 0) {
    const os = 'L', rv = rigVerts(rig), lim = t1.z + 0.01;
    const minZ = () => {
      let mz = Infinity;
      for (const bn of ['arm' + os, 'fore' + os]) {
        const bi = rv && rv.byName[bn], a = bi != null ? rv.per[bi] : null;
        if (!a || !B[bn]) continue;
        chainMat(B[bn], rig.mesh, K.fore);
        const el = K.fore.elements;
        for (let q = 0; q < a.length; q += 3) mz = Math.min(mz, el[2] * a[q] + el[6] * a[q + 1] + el[10] * a[q + 2] + el[14]);
      }
      return mz;
    };
    const ln = info.L ? Math.max(0.2, info.L.a + info.L.b) : 0.6;   // 肩到指尖
    for (let it = 0; B['arm' + os] && it < 4; it++) {
      const mz = minZ();
      if (!(mz < lim)) break;
      addRot(rig, 'arm' + os, -Math.min(0.6, (lim - mz) / ln + 0.02));   // 绕 x 负转 = 下垂的胳膊往后摆（离开面前的人）
    }
  }
  return true;
}

// ---------- 胳膊腿不插进叉车（FE1R K6 / ACT-veh） ----------
// 实体的碰撞体是一根竖直圆柱（e.r），跑起来甩出去的腿、胳膊会伸出圆柱外 0.3–0.6 m：怪跑到车边、车开到怪旁边时，腿踩进底盘、胳膊扫进发动机盖
// （排查：悲尸跑到车侧面那一步小腿进底盘 30 cm）。每帧摆完姿势以后，离车近的实体（离车中心 ≤ 车长一半 + 碰撞半径 + 2 m）逐个顶点按蒙皮算一遍
// （车本地坐标），压进车的实心部件（geo.obbs(lift) 的 14 个盒子 + 坐垫、靠背）超过 4 mm 的那条胳膊 / 腿 / 头 / 骨骼链，
// 整条往基础姿势收（0.5、0.75、1 三档，取第一档不压进去的）；骨骼链（尾巴、触手、肢团的肢体）每一节按压进去的方向往外掰。
// 只改表现，不改位置、碰撞体、行为。身体（胯、脊柱）本身在碰撞圆柱里，压不进车（车身外沿到碰撞圆柱外沿之间）
const VF = { t: -1, list: null };
const RIGVERTS = new Map();
// 坐垫、靠背（车本地，和 L1.js forkliftModel 同一份尺寸：FE1R 起各档没有减震底座，坐垫一整块 y 0.998–1.16（底面插进发动机盖顶 2 mm，S13），
// 靠背 K9 加宽到 ±0.25）
const SEAT_PARTS = [['cushion', -0.25, 0.25, 0.998, 1.16, 0.02, 0.46], ['backrest', -0.25, 0.25, 1.13, 1.63, 0.4, 0.54]];
// ---------- 没有胳膊的近战怪打坐在叉车上的人（返修 FE1R · repair-r1） ----------
// 孩子玩噩梦模式：坐上叉车就不怕狗了 —— 不合理。没有胳膊的怪也打得到坐在车上的人，打法照着它自己的样子：
//   'leap'（猎犬、啼物、悲尸肉块、Nguithr'xurh）：站在驾驶舱侧面（车身外面），出手时整只先往上（Nguithr'xurh 从天花板往下）到落点那么高，
//     再横着扑进驾驶舱侧面的开口（前后立柱之间、发动机盖顶 1.0 m 以上、护顶 2.04 m 以下），最前面那一点（嘴 / 身体）在扣血那一刻（STRIKE_PEAK）
//     正好贴到司机这一侧最靠外的那一点（离 4 mm），原路退回落地。扑的时候前腿往后收（seatStrike.tuck），不往下伸进发动机盖。整只平移（不转身），
//     扑的过程是动画（碰撞体、站点不动）；
//   'chain'（肢团最长那条肢体、牧蛇的前半截身子）：链根不动，梢先抬到落点外面 45 cm、同样高，再横着伸到落点；链按一条往上拱的弧摆（弧长 = 链长），
//     弧在车身外面、发动机盖上方。
// 攻击距离、扣血量、出手时机（STRIKE_PEAK）、冷却都不变；够不够得着、站哪里和有胳膊的怪同一套（entities.js「打坐在车上的人」，kind 'face'）
const SEATG = new Map();
function pivotOf(u) { return u.pivot || null; }
// 此刻这只怪所有看得见的网格顶点（蒙皮按 CPU 算），换到 pivot 本地坐标（不含 pivot 自己的位移 / 转动）；fn(x, y, z)
function eachPivotVert(u, fn) {
  const T = THREE_(), pv = pivotOf(u);
  if (!pv) return;
  pv.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(pv.matrixWorld).invert(), v = new T.Vector3(), acc = new T.Vector3(), tmp = new T.Vector3(), M = new T.Matrix4();
  pv.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    for (let q = o.parent; q && q !== pv; q = q.parent) if (!q.visible) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && m.transparent && m.blending === T.AdditiveBlending) return;
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    const sk = o.isSkinnedMesh && o.skeleton && si && sw ? o.skeleton : null;
    const mats = sk ? sk.bones.map((b, q) => new T.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[q])) : null;
    M.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let bone = null;
      if (sk) {
        v.applyMatrix4(o.bindMatrix); acc.set(0, 0, 0);
        let bw = -1;
        for (let j = 0; j < 4; j++) { const w = j === 0 ? sw.getX(i) : j === 1 ? sw.getY(i) : j === 2 ? sw.getZ(i) : sw.getW(i); if (!(w > 0)) continue; const bi = j === 0 ? si.getX(i) : j === 1 ? si.getY(i) : j === 2 ? si.getZ(i) : si.getW(i); acc.add(tmp.copy(v).applyMatrix4(mats[bi]).multiplyScalar(w)); if (w > bw) { bw = w; bone = sk.bones[bi]; } }
        v.copy(acc).applyMatrix4(o.bindMatrixInverse).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      } else v.applyMatrix4(M);
      fn(v.x, v.y, v.z, bone);
    }
  });
}
// 链：这条链的骨骼下标、每节长度、从哪一节起动（之前的不动）
function seatChainPick(rig, rv, ss) {
  const chains = (rig.meta && rig.meta.chains) || [];
  if (!chains.length) return null;
  let names = null;
  if (ss.chain) names = chains.find(c => c[0] === ss.chain) || null;
  if (!names) {
    // 梢在基础姿势下最靠前（−z）的那条
    const K = vfScratch(), mats = boneMats(rig, K.mats), T = THREE_(), CI = chainInfo(rig, rv);
    let best = Infinity;
    for (const c of chains) {
      const last = rv.byName[c[c.length - 1]];
      if (last == null || !CI[last]) continue;
      const tip = CI[last].dir.clone().multiplyScalar(CI[last].len).applyMatrix4(mats[last]);
      if (tip.z < best) { best = tip.z; names = c; }
    }
  }
  if (!names) return null;
  const idx = names.map(n => rv.byName[n]);
  if (idx.some(i => i == null)) return null;
  const j0 = Math.max(0, Math.min(idx.length - 1, ss.from | 0));
  return { names, idx, j0 };
}
// 基础姿势下的几何（每种怪算一次）：碰人的那一点 C（模型 = pivot 本地坐标；Nguithr'xurh 这种飞的加上它的飞行高度）、往前伸出去多远、扑多远
function seatGeom(e, u, ss) {
  const key = e.type + '|' + (u.rig && u.rig.key);
  if (SEATG.has(key)) return SEATG.get(key);
  let g = null;
  const rig = u.rig, rv = rigVerts(rig);
  if (rig && rv) {
    const saved = rig.list.map(it => [it.bone.position.clone(), it.bone.quaternion.clone()]);
    const pv = pivotOf(u), pv0 = pv ? [pv.position.clone(), pv.rotation.clone(), pv.scale.clone()] : null;
    try {
      pose(rig);
      if (pv) { pv.position.set(0, 0, 0); pv.rotation.set(0, 0, 0); pv.scale.set(1, 1, 1); }
      const chainBones = new Set();
      ((rig.meta && rig.meta.chains) || []).forEach(c => c.forEach(n => { const i = rv.byName[n]; if (i != null) chainBones.add(rig.list[i].bone.name); }));
      let low = 0, mid = 0, top = 0, C = null;
      eachPivotVert(u, (x, y, z) => {
        top = Math.max(top, y);
        if (!C || z < C[2]) C = [x, y, z];
        if (y < 0.66) low = Math.max(low, -z); else if (y < 1.04) mid = Math.max(mid, -z);
      });
      const fly = e.def.anim && e.def.anim.fly, alt = fly ? num(u.alt, num(fly.cruise, 2)) : 0;
      if (ss.kind === 'chain') {
        const ch = seatChainPick(rig, rv, ss);
        if (ch) {
          const K = vfScratch(), mats = boneMats(rig, K.mats), CI = chainInfo(rig, rv);
          const Mm = chainMat(rig.mesh, pv || e.obj, new (THREE_().Matrix4)());
          const root = new (THREE_().Vector3)().setFromMatrixPosition(new (THREE_().Matrix4)().multiplyMatrices(Mm, mats[ch.idx[ch.j0]]));
          let L = 0; for (let k = ch.j0; k < ch.idx.length; k++) L += CI[ch.idx[k]] ? CI[ch.idx[k]].len : 0;
          // 身体往前伸出去多远（站点离车身外侧让出来）：不算会动的那几节（这条链第 j0 节往后）和别的链（肢体软，碰到车身由 vehFit 推开）；
          // 牧蛇的蛇身就是这条链：前面几节（j0 以前）贴地铺向车那一边算身体。再多让 ss.pad（梢要抬起来、往回拱的余地）
          {
            low = 0; mid = 0;
            const moving = new Set(), K2 = vfScratch(), m2 = boneMats(rig, K2.mats);
            for (let q = ch.j0; q < ch.idx.length; q++) moving.add(ch.idx[q]);
            // 长在会动的那几节上的（牧蛇的眼睛、笑脸）也跟着动，不算身体
            const movB = new Set(Array.from(moving).map(i => rig.list[i].bone));
            rig.list.forEach((it, i) => { for (let b = it.bone.parent; b; b = b.parent) if (movB.has(b)) { moving.add(i); break; } });
            const own = new Set(ch.idx);
            for (let i = 0; i < rig.list.length; i++) {
              if (moving.has(i) || (chainBones.has(rig.list[i].bone.name) && !own.has(i))) continue;
              const a = rv.per[i]; const M2 = new (THREE_().Matrix4)().multiplyMatrices(Mm, m2[i]), el = M2.elements;
              for (let q = 0; q < a.length; q += 3) { const y = el[1] * a[q] + el[5] * a[q + 1] + el[9] * a[q + 2] + el[13], z = el[2] * a[q] + el[6] * a[q + 1] + el[10] * a[q + 2] + el[14]; if (y < 0.66) low = Math.max(low, -z); else if (y < 1.04) mid = Math.max(mid, -z); }
            }
            low += num(ss.pad, 0); if (mid > 0) mid += num(ss.pad, 0);
          }
          // 碰人的那一点（给 entities.js 量攻击距离 / 够不够得着）：最后一节的根（头 / 肢体梢那一节）在基础姿势下的位置
          const lastJ = new (THREE_().Vector3)().setFromMatrixPosition(new (THREE_().Matrix4)().multiplyMatrices(Mm, mats[ch.idx[ch.idx.length - 1]]));
          g = { C: [lastJ.x, lastJ.y + alt, lastJ.z], low: Math.max(0, low), mid: Math.max(0, mid), top, reach: L * 0.97, chain: ch, root: [root.x, root.y + alt, root.z] };
        }
      } else if (C) {
        // 站在车边时走路、喘气、抽动的那几厘米（基础姿势量的）：站点再多让 5 cm
        g = { C: [C[0], C[1] + alt, C[2]], low: fly ? 0 : low + 0.05, mid: fly || !(mid > 0) ? 0 : mid + 0.05, top: top + alt, reach: num(ss.reach, 1.6) };
      }
    } finally {
      rig.list.forEach((it, i) => { it.bone.position.copy(saved[i][0]); it.bone.quaternion.copy(saved[i][1]); });
      if (pv && pv0) { pv.position.copy(pv0[0]); pv.rotation.copy(pv0[1]); pv.scale.copy(pv0[2]); }
    }
  }
  SEATG.set(key, g);
  return g;
}
// 出手这一下里走到哪了：0 → 1（STRIKE_PEAK 扑到最前）→ 0；v = 竖直那一段（先走）、h = 横着那一段（后走）
function seatPath(k) {
  const PK = STRIKE_PEAK;
  const s = k < 0.22 ? 0 : k < PK ? ease((k - 0.22) / (PK - 0.22)) : k < PK + 0.36 ? 1 - ease((k - PK) / 0.36) : 0;
  return { s, v: ease(Math.min(1, s * 1.6)), h: ease(Math.max(0, (s - 0.6) / 0.4)) };
}
// 'leap'（返修 FE1R · repair-r2，验收员 play：以前整只竖直浮到驾驶舱那么高、在半空悬停，后腿吊着、底下什么都没有，再原路落下 —— 「狗怎么飘起来了」）：
// 站在地上的（猎犬、啼物、悲尸肉块）真的跳上去：
//   ① 起跳：在扣血那一刻（STRIKE_PEAK）落定倒推一个腾空时间 LEAP_T，起跳以后 pivot 竖直方向按重力 LEAP_G 走一条抛物线（竖直速度连续、
//      落到最后比顶点低一点 —— 是落下来、不是从下面顶上去），水平匀速，身子同时往上仰；
//   ② 落定 = 扑到：前脚（前半截身子最低那一点）搭在发动机盖顶面上（座椅外侧、发动机盖边沿里面那 28 cm 宽的一条，离面 3 mm），
//      身子往上仰，嘴（沿扑的方向最前那一点）正好贴到司机这一侧最靠外的那一点（离 4 mm）——前脚托着它（「有支撑」）；
//   ③ 趴着不下来：还在打（下一轮出手）就前脚撑在发动机盖上，绕前脚往后一仰、再往前一探咬（STRIKE_PEAK 又贴到人），一直有前脚托着；
//   ④ 不打了（目标下车、车开走、它被打死……）：前脚往外一滑离开发动机盖边沿，按重力落回地上（抛物线），身子放平。
// 挂在天花板上的 Nguithr'xurh（fixed）：照旧先在天花板那么高横着挪到落点上方，往下那一段改成按重力落下（抛物线，起手往下一蹬），
//   贴到人以后挂在人身上（不悬在半空），打完原路收回天花板。
// 攻击距离、扣血量、出手时机（STRIKE_PEAK）、冷却不变（entities.js 照旧按站点量够不够得着）。pivot 的位移 + 绕 obj 本地 x 轴仰起来（u.leap.th）
const LEAP_G = 9.8;
const LEAP_HOOD = Object.freeze({ y: 1.0, xIn: 0.29, xOut: 0.505, z0: -0.06, z1: 0.52, lift: 0.006 });   // lift：离面 6 mm（vehFit 把车身盒子让了 4 mm）   // 发动机盖顶面上前脚能搭的那一条（车本地）
// 坐着的人身体最靠外的那一层（车本地，右侧 +x、左侧 −x 分开）：y 1.0–2.0、z −0.8…0.7 每 1 cm 一格，这一格那条水平线（沿 x）从外面打进去
// 先碰到的面离中线多远 —— 坐姿人形的三角形按 y 切片、沿 z 光栅化（量一次；头往左右转 1.2 rad 的也并进来：坐着的人转头看怪时面罩、滤罐伸出去）
const DRV_SURF = { R: null, L: null, ny: 100, nz: 150 };
function driverSurf() {
  if (DRV_SURF.R) return DRV_SURF;
  const ny = DRV_SURF.ny, nz = DRV_SURF.nz, R = new Float32Array(ny * nz).fill(-1), L = new Float32Array(ny * nz).fill(-1);
  for (const hy of [0, 1.2, -1.2]) {
    let sb = null;
    try { sb = BR.coop && has(BR.coop, 'seatBody') ? BR.coop.seatBody({ parts: true, headYaw: hy }) : null; } catch (err) { sb = null; }
    const V = sb && sb.verts, I = sb && sb.index;
    if (!V || !I) continue;
    for (let t = 0; t < I.length; t += 3) {
      const P = [I[t], I[t + 1], I[t + 2]].map(k => [V[k * 3], V[k * 3 + 1], V[k * 3 + 2]]);
      const y0 = Math.min(P[0][1], P[1][1], P[2][1]), y1 = Math.max(P[0][1], P[1][1], P[2][1]);
      for (let iy = Math.max(0, Math.ceil((y0 - 1.0) / 0.01 - 0.5)); iy < ny && 1.0 + (iy + 0.5) * 0.01 <= y1; iy++) {
        const yc = 1.0 + (iy + 0.5) * 0.01, seg = [];
        for (let k = 0; k < 3; k++) {
          const A = P[k], B = P[(k + 1) % 3];
          if ((A[1] - yc) * (B[1] - yc) > 0 || A[1] === B[1]) continue;
          const f = (yc - A[1]) / (B[1] - A[1]);
          seg.push([A[0] + (B[0] - A[0]) * f, A[2] + (B[2] - A[2]) * f]);
        }
        if (seg.length < 2) continue;
        const [p, q] = seg, za = Math.min(p[1], q[1]), zb = Math.max(p[1], q[1]);
        for (let iz = Math.max(0, Math.floor((za + 0.8) / 0.01)); iz < nz && -0.8 + iz * 0.01 <= zb + 0.01; iz++) {
          const zc = Math.min(zb, Math.max(za, -0.8 + (iz + 0.5) * 0.01)), f = zb - za > 1e-6 ? (zc - p[1]) / (q[1] - p[1]) : 0.5;
          const x = p[0] + (q[0] - p[0]) * U.clamp(f, 0, 1), k2 = iy * nz + iz;
          if (x > R[k2]) R[k2] = x;
          if (-x > L[k2]) L[k2] = -x;
        }
      }
    }
  }
  DRV_SURF.R = R; DRV_SURF.L = L;
  return DRV_SURF;
}
// (y, z) 处（车本地）坐着的人离中线最远多远（side 那一侧，正数；这一格没有人 → −1）：取周围 2×2 格里最大的（保守）
function surfAt(side, y, z) {
  const S = driverSurf(), A = side > 0 ? S.R : S.L, fy = (y - 1.0) / 0.01 - 0.5, fz = (z + 0.8) / 0.01 - 0.5;
  const iy = Math.floor(fy), iz = Math.floor(fz);
  let m = -1;
  for (let a = 0; a <= 1; a++) for (let c = 0; c <= 1; c++) { const y2 = iy + a, z2 = iz + c; if (y2 < 0 || y2 >= S.ny || z2 < 0 || z2 >= S.nz) continue; m = Math.max(m, A[y2 * S.nz + z2]); }
  return m;
}
// 同一张表、不取周围 2×2 最大，只取 (y, z) 落在的那一格（格中心那一条线上量出来的，不保守）：定落点、挡手用（repair-r4）
function surfAt1(side, y, z) {
  const S = driverSurf(), A = side > 0 ? S.R : S.L, iy = Math.round((y - 1.0) / 0.01 - 0.5), iz = Math.round((z + 0.8) / 0.01 - 0.5);
  if (iy < 0 || iy >= S.ny || iz < 0 || iz >= S.nz) return -1;
  return A[iy * S.nz + iz];
}
// 绕 x 轴转 th（往上仰为正：模型正前方 −z 那头抬起来）
function rotX(p, th) { const c = Math.cos(th), s = Math.sin(th); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
// 趴在车上的姿势（起跳前一帧算一次）：前脚 F（前 45% 里最低那一点）搭在发动机盖顶面那一条上，身子往上仰 th，整只往车里挪到
// 最先碰到坐着的人的那个顶点离人 LEAP_GAP（按 driverSurf 那张「人身最外一层」表，每个顶点往里推、取最先碰到的）—— 仰角在 0–1.2 rad 里挑：
// 前脚落在那一条上、碰到人的地方离地 ≥1.15 m（身上，不是腿）、全身顶点压进车身部件盒不超过 6 mm、仰角离 0.45 最近（看着最自然）。
// 返回 { th, F, Pc（前脚车本地）, yawC（这时模型正前方在车本地的朝向）, depth, dy（碰到人那一点的高度） } | null
const LEAP_GAP = 0.002;   // 趴上去以后离坐着的人最近的那一点空多少（表是保守的：一格取周围 2×2 里最外的，实际空 0.2–2 cm）
function solvePerch(e, u, tg, cp, side, baseY) {
  const pts = [], chainV = [];
  // 链（尾巴、触手）上的顶点不当锚点（前脚 / 后脚）：它们跟着摆，踩不住
  const chainB = new Set();
  const rg = u.rig;
  if (rg && rg.meta && rg.meta.chains) for (const names of rg.meta.chains) for (const nm of names) if (rg.bones[nm]) chainB.add(rg.bones[nm]);
  eachPivotVert(u, (x, y, z, bone) => { pts.push(x, y, z); chainV.push(!!(bone && chainB.has(bone))); });
  if (pts.length < 9) return null;
  u._perchDbg = null;
  let fMax = -Infinity, fMin = Infinity;
  for (let i = 0; i < pts.length; i += 3) { fMax = Math.max(fMax, -pts[i + 2]); fMin = Math.min(fMin, -pts[i + 2]); }
  const cut = fMax - (fMax - fMin) * 0.45;
  let F = null;
  let Fi = -1;
  for (let i = 0; i < pts.length; i += 3) if (!chainV[i / 3] && -pts[i + 2] >= cut && (!F || pts[i + 1] < F[1])) { F = [pts[i], pts[i + 1], pts[i + 2]]; Fi = i / 3; }
  if (!F) return null;
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw), cc = Math.cos(cp.yaw), sc = Math.sin(cp.yaw), y0 = num(cp.y, 0);
  // 模型的朝向：扑的时候正对车侧面（模型正前方 = 车本地 −side·x），横着（模型 x）= 车本地 z 的哪个方向
  const yawC = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const o2c = (dx, dz) => [Math.cos(yawC) * dx + Math.sin(yawC) * dz, -Math.sin(yawC) * dx + Math.cos(yawC) * dz];
  // 前脚前后（车本地 z）不动：站点已经和落点 tf 前后对齐，只往车里挪、往上抬
  const Fw = [e.x + cy * F[0] + sy * F[2], e.z - sy * F[0] + cy * F[2]];
  const zp0 = U.clamp(sc * (Fw[0] - cp.x) + cc * (Fw[1] - cp.z), LEAP_HOOD.z0, LEAP_HOOD.z1);
  const yp = LEAP_HOOD.y + LEAP_HOOD.lift;
  const boxes = BR.L1forklift.geo.obbs(num(cp.lift, 0)).map(o => [o.cx - o.hx, o.cx + o.hx, o.cy - o.hy, o.cy + o.hy, o.cz - o.hz, o.cz + o.hz]).concat(SEAT_PARTS.map(q => q.slice(1)));
  // 后脚 H（后 45% 里最低那一点）：站得起来的（啼物这种身子长的）后脚踩在地上、绕后脚把身子立起来，不用跳
  let H = null, Hi = -1;
  const cutB = fMin + (fMax - fMin) * 0.45;
  for (let i = 0; i < pts.length; i += 3) if (!chainV[i / 3] && -pts[i + 2] <= cutB && (!H || pts[i + 1] < H[1])) { H = [pts[i], pts[i + 1], pts[i + 2]]; Hi = i / 3; }
  // 一个仰角下：锚点 A（前脚 / 后脚）放在车本地高度 yA，整只往车里挪到最先碰到坐着的人的那个顶点离人 LEAP_GAP；返回锚点离车中线多远、碰到人那一点多高、
  // 全身压进车身部件盒多深（盒子往外让 2 cm；锚点自己贴着面那几毫米不算）
  const pose1 = (A, Ai, yA, th, zp) => {
    const c = Math.cos(th), sn = Math.sin(th);
    let sp = -Infinity, touchY = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const ry = (pts[i + 1] - A[1]) * c - (pts[i + 2] - A[2]) * sn, rz = (pts[i + 1] - A[1]) * sn + (pts[i + 2] - A[2]) * c;
      const d = o2c(pts[i] - A[0], rz), w = -side * d[0], yy = yA + ry;
      if (yy < 1.0 || yy > 2.0) continue;
      const sx = surfAt(side, yy, zp + d[1]);
      if (sx > 0 && sx + LEAP_GAP + w > sp) { sp = sx + LEAP_GAP + w; touchY = yy; }
    }
    if (!(sp > -1)) return null;
    let dep = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const ry = (pts[i + 1] - A[1]) * c - (pts[i + 2] - A[2]) * sn, rz = (pts[i + 1] - A[1]) * sn + (pts[i + 2] - A[2]) * c;
      const d = o2c(pts[i] - A[0], rz), lx = side * sp + d[0], ly = yA + ry, lz = zp + d[1];
      if (Math.abs(lx) > 0.75 || lz < -2.25 || lz > 1.45 || ly > 2.35 || ly < 0) continue;
      if (i / 3 === Ai && ly < yA + 0.01) continue;
      for (const B of boxes) { const q = Math.min(lx - B[0], B[1] - lx, ly - B[2], B[3] - ly, lz - B[4], B[5] - lz) + 0.02; if (q > dep) dep = q; }
    }
    return { sp, touchY, dep };
  };
  // 锚点离车中线 sp 给定、仰角 th：全身压进车身部件盒多深（同 pose1 的口径）
  const poseAt = (A, Ai, yA, th, zp, sp) => {
    const c = Math.cos(th), sn = Math.sin(th);
    let dep = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const ry = (pts[i + 1] - A[1]) * c - (pts[i + 2] - A[2]) * sn, rz = (pts[i + 1] - A[1]) * sn + (pts[i + 2] - A[2]) * c;
      const d = o2c(pts[i] - A[0], rz), lx = side * sp + d[0], ly = yA + ry, lz = zp + d[1];
      if (Math.abs(lx) > 0.75 || lz < -2.25 || lz > 1.45 || ly > 2.35 || ly < 0) continue;
      if (i / 3 === Ai && ly < yA + 0.01) continue;
      for (const B of boxes) { const q = Math.min(lx - B[0], B[1] - lx, ly - B[2], B[3] - ly, lz - B[4], B[5] - lz) + 0.02; if (q > dep) dep = q; }
    }
    return dep;
  };
  // 返修 FE1R · repair-r3（验收员 play major：猎犬前爪搭在发动机盖上、后半截身子悬在车侧外面，后腿离地 0.4 m 吊着，顶点重心在着力线外 26 cm ——
  // 真狗这样会掉下去）：平衡 —— 姿势的顶点重心（水平投影，车本地 x / z）要落在「着力点」围成的凸包里、往里 ≥3 mm（口径和物资静止姿态裁定 B 一样）。
  // 着力点：离地 ≤2 cm 的顶点；在车身部件（geo.obbs 的盒子 + 坐垫、靠背）顶面上方 0–1 cm、落在它脚印里的顶点；贴着部件侧面、在它外面 ≤1 cm 的顶点。
  // 返回往里多少 m（负数 = 在凸包外 / 着力点不够围成一块）
  const balAt = (A, yA, th, zp, sp) => {
    const c = Math.cos(th), sn = Math.sin(th), S = [];
    let cx = 0, cz = 0, n = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const ry = (pts[i + 1] - A[1]) * c - (pts[i + 2] - A[2]) * sn, rz = (pts[i + 1] - A[1]) * sn + (pts[i + 2] - A[2]) * c;
      const d = o2c(pts[i] - A[0], rz), lx = side * sp + d[0], ly = yA + ry, lz = zp + d[1];
      cx += lx; cz += lz; n++;
      if (ly <= 0.02) { S.push(lx, lz); continue; }
      for (const B of boxes) {
        if (B[3] > 0.3 && lx >= B[0] && lx <= B[1] && lz >= B[4] && lz <= B[5] && ly >= B[3] - 0.004 && ly <= B[3] + 0.01) { S.push(lx, lz); break; }
        if (ly < B[2] || ly > B[3]) continue;
        const ox = lx > B[1] ? lx - B[1] : lx < B[0] ? B[0] - lx : 0, oz = lz > B[5] ? lz - B[5] : lz < B[4] ? B[4] - lz : 0;
        if ((ox > 0 || oz > 0) && ox <= 0.01 && oz <= 0.01) { S.push(lx, lz); break; }
      }
    }
    return n ? hullMargin(S, cx / n, cz / n) : -Infinity;
  };
  let best = null;
  // 前脚 / 后脚前后（车本地 z）落在哪：先试站点正对的那里，再沿发动机盖那一条前后挪着试（离站点越远越扣分：跳的时候要斜着跳）
  const zps = [zp0];
  for (const z of [-0.04, 0.08, 0.2, 0.32, 0.44]) if (Math.abs(z - zp0) > 0.05) zps.push(z);
  for (const zp of zps) {
    const zPen = Math.abs(zp - zp0) * 0.8;
    // ① 立起来（后脚一直踩在地上，离地 6 mm）：后脚落在车身侧面外 ≥0.62（侧裙 0.595 外面）
    if (H) for (let th = 0.1; th <= 1.3001; th += 0.04) {
      const r = pose1(H, Hi, 0.006, th, zp);
      if (!r || r.sp < 0.62 || r.sp > 1.8 || r.touchY < 1.1) continue;
      // 平时（两下之间）再立直 0.14 rad 那个姿势也不许穿车
      const r2 = poseAt(H, Hi, 0.006, th + 0.14, zp, r.sp);
      r.dep = Math.max(r.dep, r2);
      const score = Math.max(0, r.dep - 0.022) * 100 + Math.abs(th - 0.7) * 0.5 + zPen;
      if (best && score >= best.score) continue;
      // 立起来一直靠后脚撑着：立着和平时再立直 0.14 rad 那个姿势都要站得稳（重心在着力点凸包里），站不稳的不许选（repair-r3）
      const bal = Math.min(balAt(H, 0.006, th, zp, r.sp), balAt(H, 0.006, th + 0.14, zp, r.sp));
      if (!(bal >= BAL_IN)) continue;
      best = { mode: 'rear', A: H, yA: 0.006, th, sp: r.sp, zp, dep: r.dep, dy: r.touchY, score, stay: true, bal };
    }
    // ② 跳上去：前脚搭在发动机盖顶面那一条上
    for (let th = 0; th <= 1.2001; th += 0.03) {
      const r = pose1(F, Fi, yp, th, zp);
      if (r) r.dep = Math.max(r.dep, poseAt(F, Fi, yp, th - 0.14, zp, r.sp));
      if (r && (u._perchDbg == null || Math.abs(r.sp - 0.4) < Math.abs(u._perchDbg.sp - 0.4))) u._perchDbg = { th: +th.toFixed(2), sp: +r.sp.toFixed(3), touchY: +r.touchY.toFixed(3), zp: +zp.toFixed(3) };
      if (!r || !(r.sp > LEAP_HOOD.xIn && r.sp < LEAP_HOOD.xOut) || r.touchY < 1.1) continue;
      // 同样不穿车的话，站着立起来的比跳上去的好（不腾空）：跳上去的多记 0.3
      let score = Math.max(0, r.dep - 0.022) * 100 + Math.abs(th - 0.45) + 0.3 + zPen;
      if (best && score >= best.score) continue;
      // 站得稳（趴着和平时往后仰 0.14 rad 那个姿势的重心都在着力点凸包里）才趴在车上接着咬；站不稳的扑咬一口就落回地上（stay 假，见 seatLeap），
      // 同样不穿车时站得稳的优先（repair-r3）
      const bal = Math.min(balAt(F, yp, th, zp, r.sp), balAt(F, yp, th - 0.14, zp, r.sp)), stay = bal >= BAL_IN;
      if (!stay) score += 0.25;
      if (!best || score < best.score) best = { mode: 'hood', A: F, yA: yp, th, sp: r.sp, zp, dep: r.dep, dy: r.touchY, score, stay, bal };
    }
  }
  if (!best) return null;
  // 现在（没仰、没挪）锚点在车本地哪里：立起来那种从这里一边起身一边往前挪到位
  const Aw = [e.x + cy * best.A[0] + sy * best.A[2], e.z - sy * best.A[0] + cy * best.A[2]];
  const A0c = [cc * (Aw[0] - cp.x) - sc * (Aw[1] - cp.z), num(e.y, 0) + baseY + best.A[1] - y0, sc * (Aw[0] - cp.x) + cc * (Aw[1] - cp.z)];
  return { mode: best.mode, th: best.th, F: best.A, Pc: [side * best.sp, best.yA, best.zp], A0c, yawC, depth: best.dep, dy: best.dy, sp: best.sp, stay: !!best.stay, bal: best.bal };
}
// 站得稳要求重心往凸包里 ≥3 mm（repair-r3，和物资静止姿态裁定 B 同一个口径）
const BAL_IN = 0.003;
// 点 (px, pz) 在点集 S（[x0, z0, x1, z1, …]）的凸包里往里多远（凸包外为负；不到 3 个点、围不成一块为 −∞）
function hullMargin(S, px, pz) {
  const n = S.length / 2;
  if (n < 3) return -Infinity;
  const P = [];
  for (let i = 0; i < n; i++) P.push([S[2 * i], S[2 * i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (H.length < 3) return -Infinity;
  let m = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 1e-9) m = Math.min(m, cr(a, b, [px, pz]) / L);
  }
  return m;
}
// 趴着的姿势 → pivot 的位移和转动（每帧按此刻实体的位置、朝向重算：怪的 AI 这时可能还在微调站点 / 朝向，模型照样钉在车上）。
// 转动 = 绕竖直轴把模型转到车本地 yawC、再绕模型 x 轴仰 th；q（四元数）给 auto 直接用
function perchPose(e, cp, sol, th, baseY, PcO) {
  const T = THREE_(), cc = Math.cos(cp.yaw), sc = Math.sin(cp.yaw), y0 = num(cp.y, 0), Pc = PcO || sol.Pc;
  const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), sol.yawC + cp.yaw - e.yaw);
  const q = qy.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), th));
  const Fr = new T.Vector3(sol.F[0], sol.F[1], sol.F[2]).applyQuaternion(q);
  const Pw = [cp.x + cc * Pc[0] + sc * Pc[2], y0 + Pc[1], cp.z - sc * Pc[0] + cc * Pc[2]];
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw), dx = Pw[0] - e.x, dz = Pw[2] - e.z;
  const Po = [cy * dx - sy * dz, Pw[1] - e.y - baseY, sy * dx + cy * dz];
  return { x: Po[0] - Fr.x, y: Po[1] - Fr.y, z: Po[2] - Fr.z, q, th };
}
function seatLeap(e, rig, k, tg, u, ss, api, cd) {
  const pv = pivotOf(u), V = BR.vehicles, car = V && has(V, 'byKey') && tg.key != null ? V.byKey(tg.key) : null, cp = car && car.pose;
  if (!pv || !cp) { leapRelease(e, u); return; }
  const t = now();
  if (ss.fixed) { seatLeapCeil(e, rig, k, tg, u, ss, cp, api, cd); return; }
  const P = seatPath(k);
  // 前腿往后收（扑起来以后爪子不往下伸进发动机盖 / 车身侧面）：起跳那一刻按收好的算趴着的姿势，腾空、趴着都收着
  const hp0 = u.perch && u.perch.phase !== 'drop' ? u.perch : null;
  // 扑咬一口落回去的那一段（snap）：前腿收着落，快着地时慢慢放开到这一刻该有的样子（不一着地就猛地伸直）
  const tuckK = hp0 ? (hp0.phase === 'snap' ? U.lerp(1, P.v, ease(U.clamp((t - hp0.t1) / hp0.T, 0, 1))) : 1) : P.v;
  if (ss.tuck) for (const nm in ss.tuck) { const r = ss.tuck[nm]; addRot(rig, nm, r[0] * tuckK, r[1] * tuckK, r[2] * tuckK); }
  const baseY = pv.position.y - (u.leap ? u.leap.y : 0);
  const side = tg.side || ((() => { const dx = e.x - cp.x, dz = e.z - cp.z; return Math.cos(cp.yaw) * dx - Math.sin(cp.yaw) * dz; })() >= 0 ? 1 : -1);
  // 一轮里扣血那一刻（STRIKE_PEAK）落定 / 咬到
  const s0 = has(api, 'attackStart') ? api.attackStart(e) : null;
  const hitAt = s0 != null ? s0 + STRIKE_PEAK * cd : t + (STRIKE_PEAK - k) * cd;
  if (!hp0) {
    if (u.perch && u.perch.phase === 'drop') { leapRelease(e, u); return; }   // 正落回地上：落完再说
    // 这一下已经扑过、落回来了（站不稳的扑咬一口就落回地上，repair-r3）：等下一下
    if (u.snapHit != null && Math.abs(hitAt - u.snapHit) < 0.05) { u.leap = null; return; }
    // 还在地上：起跳前把趴着的姿势算好 —— 按趴着时的样子量（基础姿势 + 前腿收好；趴着的时候不走不跑，步态摆不动），算完骨骼还原，到点起跳
    pv.position.set(0, baseY, 0); pv.rotation.x = 0;
    // 算过的姿势管 0.6 s（算不出来也记着）：起手时刻没定下来的那几帧 hitAt 每帧都在变，不能按它当缓存键。
    // 怪站着没挪、车没动（扑咬一口落回原地、等下一下）的，算过的照样用，最多 4 s（repair-r3：每一下都重算一遍要多花几毫秒）
    const pp = u.perchPlan, same = pp && pp.ex != null && Math.abs(e.x - pp.ex) < 0.01 && Math.abs(e.z - pp.ez) < 0.01 && Math.abs(e.yaw - pp.eyaw) < 0.01 &&
      Math.abs(cp.x - pp.cx) < 0.005 && Math.abs(cp.z - pp.cz) < 0.005 && Math.abs(cp.yaw - pp.cyaw) < 0.003 && Math.abs(num(cp.lift, 0) - pp.lift) < 0.005 && t - pp.t < 4;
    const cached = pp && (t - pp.t < 0.6 || same) && pp.side === side && String(pp.key) === String(tg.key);
    let sol = cached ? u.perchPlan.sol : null;
    if (!cached) {
      const saved = rig.list.map(it => [it.bone.position.clone(), it.bone.quaternion.clone()]);
      pose(rig);
      if (ss.tuck) for (const nm in ss.tuck) { const r = ss.tuck[nm]; addRot(rig, nm, r[0], r[1], r[2]); }
      sol = solvePerch(e, u, tg, cp, side, baseY);
      rig.list.forEach((it, i) => { it.bone.position.copy(saved[i][0]); it.bone.quaternion.copy(saved[i][1]); });
    }
    if (!cached) u.perchPlan = { t, sol, side, key: tg.key, ex: e.x, ez: e.z, eyaw: e.yaw, cx: cp.x, cz: cp.z, cyaw: cp.yaw, lift: num(cp.lift, 0) };
    u._leapWhy = sol ? 'plan ' + sol.mode + ' th ' + sol.th.toFixed(2) + ' sp ' + sol.sp.toFixed(3) + ' dep ' + sol.depth.toFixed(3) + ' dy ' + sol.dy.toFixed(3) : 'nosol ' + JSON.stringify(u._perchDbg);
    if (!sol) { u.leap = null; return; }
    const rise = perchPose(e, cp, sol, sol.th, baseY).y;
    // 跳上去：腾空时间按要升多高、重力算；立起来：0.35 s 起身（后脚一直踩着地）。
    // 站不稳的（sol.stay 假，repair-r3）：扑咬一口 —— 同样跳上去（前脚落在发动机盖上那一刻正好咬到），咬完前脚一蹬，把扑上去那一段倒着走一遍
    // （时间倒过来的抛物线还是按重力走的抛物线），落回站的地方
    const Tair = sol.mode === 'rear' ? 0.45 : U.clamp(Math.sqrt(2 * Math.max(0.05, rise) / LEAP_G) * 1.1, 0.16, 0.6);
    if (t < hitAt - Tair - 1e-6) { u.leap = null; return; }
    // 这一下的出手已经过了（刚落回来、或者半路才对上目标）：不补跳，等下一下
    if (t > hitAt + 1e-3) { u.leap = null; return; }
    u.perch = { phase: 'jump', t0: hitAt - Tair, T: Tair, hitAt, key: tg.key, side, sol, pose: [cp.x, cp.z, cp.yaw], cp: { x: cp.x, y: cp.y, z: cp.z, yaw: cp.yaw }, base: baseY };
  }
  const pc = u.perch, sol = pc.sol;
  // 车挪了（开走了）：松开
  if (Math.hypot(cp.x - pc.pose[0], cp.z - pc.pose[1]) > 0.05 || Math.abs(cp.yaw - pc.pose[2]) > 0.03 || String(tg.key) !== String(pc.key)) { leapRelease(e, u); return; }
  const T = THREE_();
  if (pc.phase === 'jump' && sol.mode === 'rear') {
    // 立起来：后脚踩着地，先在原地绕后脚把身子立起来（前 60%，身子往上、往外转，碰不到车），再立着往车边挪到位（后 40%，
    // 从外面平移到算好的那个不穿车的姿势，越挪越近、中间不会穿进去）；锚点高度一直是地面
    const tau = U.clamp((t - pc.t0) / pc.T, 0, 1), fa = ease(Math.min(1, tau / 0.6)), fb = ease(Math.max(0, (tau - 0.6) / 0.4));
    const Pc = [sol.A0c[0] + (sol.Pc[0] - sol.A0c[0]) * fb, sol.Pc[1], sol.A0c[2] + (sol.Pc[2] - sol.A0c[2]) * fb];
    const B = perchPose(e, cp, sol, sol.th * fa, baseY, Pc);
    u.leap = { x: B.x, y: B.y, z: B.z, th: 0, q: B.q };
    if (tau >= 1) pc.phase = 'on';
  } else if (pc.phase === 'jump') {
    // 腾空：pivot 从站着的地方按重力走到趴着的位置（竖直：起跳速度 vy、重力 LEAP_G；水平匀速），转动从站着的朝向球面插值到趴着的
    const tau = U.clamp((t - pc.t0) / pc.T, 0, 1);
    u.leap = jumpPose(e, cp, pc, tau);
    // 到了：站得稳的趴着接着咬（'on'）；站不稳的扣血那一刻在最高点，接着原路落回去（'snap'）
    if (tau >= 1) { if (sol.stay) pc.phase = 'on'; else { pc.phase = 'snap'; pc.t1 = pc.t0 + pc.T; } }
  } else if (pc.phase === 'snap') {
    if (!snapStep(e, u, pc, cp, t)) return;
  } else {
    // 趴着：绕前脚转（平时往后仰着 0.14 rad，起手以后慢慢往前探，STRIKE_PEAK 回到 0：贴到人，咬完再仰回去）；
    // 立起来的绕后脚转，平时再立直 0.14 rad（身子往外、离车远一点），STRIKE_PEAK 探回来
    const B = perchPose(e, cp, sol, sol.th + (sol.mode === 'rear' ? 0.14 : -0.14) * (1 - P.s), baseY);
    u.leap = { x: B.x, y: B.y, z: B.z, th: 0, q: B.q };
  }
  pv.position.set(u.leap.x, baseY + u.leap.y, u.leap.z);
  pv.quaternion.copy(u.leap.q);
}
// 扑上去那一段的第 tau（0 → 1）处 pivot 的位移和转动：竖直按重力（起跳速度 vy、重力 LEAP_G），水平方向先慢后快（τ^2.2）：先蹿高、身子仰起来，
// 过了发动机盖边沿再往里扑 —— 头、前腿不从发动机盖侧面穿过去；转动从站着的朝向球面插值到趴着的
function jumpPose(e, cp, pc, tau) {
  const sol = pc.sol, dt = tau * pc.T;
  const B = perchPose(e, cp, sol, sol.th, num(pc.base, 0));
  const vy = B.y / pc.T + LEAP_G * pc.T / 2;
  const q = new (THREE_().Quaternion)().slerp(B.q, Math.sin(Math.PI / 2 * Math.min(1, tau * 1.15)));
  const hx = Math.pow(tau, 2.2);
  return { x: B.x * hx, y: vy * dt - LEAP_G * dt * dt / 2, z: B.z * hx, th: 0, q };
}
// 站不稳的扑咬一口落回去（repair-r3）：前脚落在发动机盖上、咬到（扣血那一刻）以后一蹬，把扑上去那一段倒着走一遍 —— 时间倒过来的抛物线
// 竖直加速度照旧 −g（落上去那一下和蹬起来那一下是前脚撑在发动机盖上的一次碰撞），先往外退出发动机盖边沿再落下，前脚、头不从发动机盖里划过去；
// 落完回到站着的样子。落完返回 false（u.leap / u.perch 已清掉）
function snapStep(e, u, pc, cp, t) {
  const tau2 = U.clamp((t - pc.t1) / pc.T, 0, 1);
  if (tau2 >= 1 || e.dead) { u.snapHit = pc.hitAt; u.perch = null; u.leap = null; return false; }
  u.leap = jumpPose(e, cp, pc, 1 - tau2);
  return true;
}
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
// 不打了（没有目标 / 不在出手）：趴在车上的松开前脚、按重力落回地上；正在跳的接着落完；落完了清掉
function leapRelease(e, u) {
  const pc = u.perch;
  // 落回去的这一下前腿照旧收着、慢慢放开（不然一松开前腿就伸直、扫进发动机盖）
  const ssT = e.def && e.def.seatStrike && e.def.seatStrike.tuck, rigT = u.rig;
  if (!pc) { u.leap = null; return; }
  if (pc.phase === 'ceil') { u.perch = null; u.leap = null; return; }
  const t = now();
  // 站不稳、扑咬一口就落回去的（repair-r3）：正在往上扑的从这一点原路落回去，正在落的接着落完（同一条抛物线）
  if (pc.sol && !pc.sol.stay && pc.sol.mode !== 'rear' && (pc.phase === 'jump' || pc.phase === 'snap')) {
    if (pc.phase === 'jump') { const tau = U.clamp((t - pc.t0) / pc.T, 0, 1); pc.phase = 'snap'; pc.t1 = t - (1 - tau) * pc.T; }
    if (ssT && rigT) { const kk = 1 - ease(U.clamp((t - pc.t1) / pc.T, 0, 1)); for (const nm in ssT) { const r = ssT[nm]; addRot(rigT, nm, r[0] * kk, r[1] * kk, r[2] * kk); } }
    snapStep(e, u, pc, pc.cp, t);
    return;
  }
  if (pc.phase !== 'drop') {
    const L = u.leap || { x: 0, y: 0, z: 0, th: 0 };
    pc.phase = 'drop'; pc.t0 = t; pc.from = { x: L.x, y: L.y, z: L.z, th: L.th, q: L.q ? L.q.clone() : null };
    pc.rear = !!(pc.sol && pc.sol.mode === 'rear');
    pc.T = pc.rear ? 0.45 : Math.sqrt(2 * Math.max(0.01, L.y) / LEAP_G);
  }
  const tau = U.clamp((t - pc.t0) / Math.max(1e-3, pc.T), 0, 1), dt = tau * pc.T, F0 = pc.from;
  if (tau >= 1 || e.dead) { u.perch = null; u.leap = null; return; }
  if (ssT && rigT) { const kk = 1 - ease(tau); for (const nm in ssT) { const r = ssT[nm]; addRot(rigT, nm, r[0] * kk, r[1] * kk, r[2] * kk); } }
  if (pc.rear && pc.sol && pc.cp) {
    // 立起来的放下来：原路倒回去 —— 先立着往外退回起身的地方，再绕后脚把身子放平
    const sol = pc.sol, fb = ease(Math.min(1, tau / 0.4)), fa = ease(Math.max(0, (tau - 0.4) / 0.6));
    const Pc = [sol.Pc[0] + (sol.A0c[0] - sol.Pc[0]) * fb, sol.Pc[1], sol.Pc[2] + (sol.A0c[2] - sol.Pc[2]) * fb];
    const B = perchPose(e, pc.cp, sol, sol.th * (1 - fa), num(pc.base, 0), Pc);
    u.leap = { x: B.x, y: B.y, z: B.z, th: 0, q: B.q };
    return;
  }
  // 前脚往外一滑离开边沿：水平往回（站点那边）匀速，竖直从静止自由落体，身子放平（转回站着的朝向）
  const q = F0.q ? F0.q.clone().slerp(new (THREE_().Quaternion)(), ease(tau)) : null;
  u.leap = { x: F0.x * (1 - tau), y: F0.y - LEAP_G * dt * dt / 2, z: F0.z * (1 - tau), th: F0.th * (1 - ease(tau)), q };
}
// Nguithr'xurh（挂在天花板上，fixed，返修 FE1R · repair-r1 的路线）：贴着天花板横着挪到驾驶舱侧面外那条线上、和落点前后对齐 →
// 往下落到落点那么高（repair-r2：从静止匀加速落下，像掉下来，不是匀速飘下来）→ 横着贴到落点外 4 mm；收回时原路被触手拽回天花板
function seatLeapCeil(e, rig, k, tg, u, ss, cp0, api, cd) {
  const P = seatPath(k);
  if (!(P.s > 0)) { u.leap = null; return; }
  const pv = pivotOf(u), V = BR.vehicles, car = V && has(V, 'byKey') && tg.key != null ? V.byKey(tg.key) : null, cp = car && car.pose;
  if (!pv || !cp) { u.leap = null; return; }
  // 前腿往后收（扑起来以后爪子不往下伸进发动机盖 / 车身侧面）
  if (ss.tuck) for (const nm in ss.tuck) { const r = ss.tuck[nm]; addRot(rig, nm, r[0] * P.v, r[1] * P.v, r[2] * P.v); }
  const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw), cc = Math.cos(cp.yaw), sc = Math.sin(cp.yaw), y0 = num(cp.y, 0);
  // 世界 ↔ 车本地 ↔ obj 本地（obj：实体原点、朝向 e.yaw）
  const w2c = (x, z) => { const dx = x - cp.x, dz = z - cp.z; return [cc * dx - sc * dz, sc * dx + cc * dz]; };
  const c2w = (lx, lz) => [cp.x + cc * lx + sc * lz, cp.z - sc * lx + cc * lz];
  const tf = tg.tf || tg.t1, side = tg.side || (w2c(e.x, e.z)[0] >= 0 ? 1 : -1);
  const Tc = w2c(tf.x, tf.z);
  // 扑的方向（世界，水平）：驾驶舱侧面往里（车本地 −side·x）
  const dW = [-side * cc, side * sc];
  const dO = [cy * dW[0] - sy * dW[1], sy * dW[0] + cy * dW[1]];   // 换到 obj 本地
  // 此刻姿势下沿扑的方向最前面那一点（pivot 本地，不含 pivot 的平移）
  const baseY = pv.position.y - (u.leap ? u.leap.y : 0);
  pv.position.set(0, baseY, 0);
  let C = null, best = -Infinity;
  eachPivotVert(u, (x, y, z) => { const t = x * dO[0] + z * dO[1]; if (t > best) { best = t; C = [x, y, z]; } });
  if (!C) { u.leap = null; return; }
  // A：这一点现在在哪（世界 → 车本地）
  const Aw = [e.x + cy * C[0] + sy * C[2], e.z - sy * C[0] + cy * C[2]], Ay = e.y + baseY + C[1];
  const Ac = w2c(Aw[0], Aw[1]);
  const xo = side * Math.max(side * Ac[0], num(ss.out, 0.55));
  const Bc = [xo, Tc[1]], By = Ay, Cy = tf.y, Tgc = [Tc[0] + side * 0.004, Tc[1]];
  // s 分三段：A→B 0–0.3、B→C 0.3–0.6、C→落点 0.6–1（各段缓动）；退回原路
  const seg = (a, b) => ease(U.clamp((P.s - a) / (b - a), 0, 1));
  const f1 = seg(0, 0.3), f3 = seg(0.6, 1), q2 = U.clamp((P.s - 0.3) / 0.3, 0, 1), f2 = k <= STRIKE_PEAK ? q2 * q2 : seg(0.3, 0.6);   // 往下那一段从静止匀加速落下（重力），收回时原路拽上去
  let lx = Ac[0] + (Bc[0] - Ac[0]) * f1, lz = Ac[1] + (Bc[1] - Ac[1]) * f1, ly = By + (Cy - By) * f2;
  lx += (Tgc[0] - Bc[0]) * f3; lz += (Tgc[1] - Bc[1]) * f3;
  const Pw = c2w(lx, lz);
  // pivot 平移 = 这一点要到的位置 − 它现在的位置（世界 → obj 本地）
  const dx = Pw[0] - Aw[0], dz = Pw[1] - Aw[1];
  u.leap = { x: cy * dx - sy * dz, y: ly - Ay, z: sy * dx + cy * dz };
  pv.position.set(u.leap.x, baseY + u.leap.y, u.leap.z);
}
// 'chain'：链根（第 j0 节）不动，梢按 seatPath 先抬到落点外面 45 cm 同样高、再横着伸到落点（离 4 mm）；链摆成一条往上拱、弧长 = 链长的二次曲线
function seatChain(e, rig, k, tg, u, ss) {
  const P = seatPath(k);
  if (!(P.s > 0)) return;
  const g = seatGeom(e, u, ss), rv = rigVerts(rig);
  if (!g || !g.chain || !rv) return;
  const T = THREE_(), K = vfScratch(), CI = chainInfo(rig, rv), ch = g.chain, idx = ch.idx;
  // 这一帧在用哪条链打哪台车上的人（vehFit 让别的链躲开司机的身体，见 vehFit；返修 FE1R · repair-r2）
  u.seatHit = { t: now(), key: tg.key, idx };
  K.root.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
  chainMat(rig.mesh, e.obj, K.mesh).premultiply(K.root);
  const M = new T.Matrix4(), Qw = new T.Quaternion(), Qp = new T.Quaternion(), Q = new T.Quaternion(), cdir = new T.Vector3(), ddir = new T.Vector3();
  const listIdx = new Map(); rig.list.forEach((it, i) => listIdx.set(it.bone, i));
  let mats = boneMats(rig, K.mats);
  const J = [];
  for (let q = 0; q < idx.length; q++) J.push(new T.Vector3().setFromMatrixPosition(M.multiplyMatrices(K.mesh, mats[idx[q]])));
  { const last = idx[idx.length - 1], ci = CI[last]; M.multiplyMatrices(K.mesh, mats[last]); J.push(ci.dir.clone().multiplyScalar(ci.len).applyMatrix4(M)); }
  const j0 = ch.j0, R = J[j0].clone(), tip0 = J[J.length - 1].clone();
  // 落点：缺省是司机这一侧最靠外那一点 tf（牧蛇的头又粗又圆，正面贴上去）；ss.at 't2' 用近侧肋下那一点（肢团的细肢体梢：离头远一点 ——
  // 坐着的人转头看怪时，面罩两侧的滤罐会转到肩膀外面，细肢体从肩膀那么高横着进来会戳到滤罐）
  const tf = (ss.at === 't2' && tg.t2) || tg.tf || tg.t1, Tt = new T.Vector3(tf.x, tf.y, tf.z);
  const out = new T.Vector3(R.x - Tt.x, 0, R.z - Tt.z); if (out.lengthSq() < 1e-6) out.set(1, 0, 0); out.normalize();
  const Tg = Tt.clone().addScaledVector(out, num(ss.gap, 0.004));   // 梢（最后一节最远的那个顶点）碰到人（缺省离 4 mm；ss.gap 改：肢团 9 mm，见 clump.js）
  const P1 = Tg.clone().addScaledVector(out, 0.45);
  // 梢这一帧要到的地方
  const tipT = P.h > 0 ? P1.clone().lerp(Tg, P.h) : tip0.clone().lerp(P1, P.v);
  // 最后一节横着（沿扑进去的方向）：头 / 肢体梢正面碰到人，粗的头侧面不斜着压进人身上；前面几节按一条往上拱的二次曲线摆到最后一节的根上
  const Lall = []; for (let q = j0; q < idx.length; q++) Lall.push(CI[idx[q]] ? CI[idx[q]].len : 0.1);
  const Llast = Lall[Lall.length - 1], tip = tipT.clone().addScaledVector(out, Llast);
  const L = Lall.slice(0, -1); let Ltot = 0; for (const l of L) Ltot += l;
  const D = R.distanceTo(tip);
  const mid = R.clone().lerp(tip, 0.5), bez = (h, t) => { const c1 = mid.clone(); c1.y += h; const a = R.clone().multiplyScalar((1 - t) * (1 - t)), b = c1.multiplyScalar(2 * (1 - t) * t), cc = tip.clone().multiplyScalar(t * t); return a.add(b).add(cc); };
  const arcLen = h => { let s = 0, p = R.clone(); for (let i = 1; i <= 40; i++) { const q = bez(h, i / 40); s += q.distanceTo(p); p = q; } return s; };
  let lo = 0, hi = Math.max(0.05, Ltot);
  if (Ltot > D) { for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (arcLen(m) < Ltot) lo = m; else hi = m; } } else hi = 0;
  const H = Ltot > D ? (lo + hi) / 2 : 0;
  // 沿曲线按累计弧长取关节点
  const S = [R.clone()]; { let acc = 0, want = 0, p = R.clone(), q2 = 0; const N = 200; let qi = 0;
    for (let i = 1; i <= N && q2 < L.length; i++) { const q = bez(H, i / N), seg = q.distanceTo(p); while (q2 < L.length && acc + seg >= want + L[q2]) { const t = (want + L[q2] - acc) / (seg || 1); S.push(p.clone().lerp(q, t)); want += L[q2]; q2++; } acc += seg; p = q; qi++; }
    while (S.length < L.length + 1) S.push(tip.clone()); void qi; }
  if (!L.length) S.length = 1;
  // 弧上取的关节点之间是弦（比弧短），骨骼长度是定的 —— 再按 FABRIK 来回几遍，梢钉在 tip、根钉在 R，每节长度对上，形状还是那条拱
  for (let it = 0; it < 12; it++) {
    S[S.length - 1].copy(tip);
    for (let q = S.length - 2; q >= 0; q--) { const d = S[q].clone().sub(S[q + 1]); const l = d.length() || 1e-6; S[q].copy(S[q + 1]).addScaledVector(d, L[q] / l); }
    S[0].copy(R);
    for (let q = 1; q < S.length; q++) { const d = S[q].clone().sub(S[q - 1]); const l = d.length() || 1e-6; S[q].copy(S[q - 1]).addScaledVector(d, L[q - 1] / l); }
  }
  S.push(tipT.clone());
  const want = J.slice(0, j0).concat(S);
  // 按新的关节点转骨骼（从根往梢，每转一节重新算一次矩阵），和 chainFit 同一个办法
  for (let q = j0; q < idx.length; q++) {
    const i = idx[q], bone = rig.list[i].bone;
    mats = boneMats(rig, K.mats);
    M.multiplyMatrices(K.mesh, mats[i]);
    Qw.setFromRotationMatrix(new T.Matrix4().extractRotation(M));
    cdir.copy(CI[i].dir).applyQuaternion(Qw).normalize();
    ddir.copy(want[q + 1]).sub(new T.Vector3().setFromMatrixPosition(M)).normalize();
    if (cdir.dot(ddir) > 0.999999) continue;
    Q.setFromUnitVectors(cdir, ddir);
    const pi = bone.parent ? listIdx.get(bone.parent) : undefined;
    if (pi != null) { M.multiplyMatrices(K.mesh, mats[pi]); Qp.setFromRotationMatrix(new T.Matrix4().extractRotation(M)); }
    else Qp.setFromRotationMatrix(new T.Matrix4().extractRotation(K.mesh));
    bone.quaternion.copy(Qp.clone().invert().multiply(Q.clone().multiply(Qw)));
  }
}
function vehNear(e) {
  const V = BR.vehicles, G = BR.L1forklift && BR.L1forklift.geo;
  if (!V || !has(V, 'list') || !G || !has(G, 'obbs')) return null;
  const t = now();
  if (VF.t !== t) {
    VF.t = t;
    try { VF.list = V.list(); } catch (err) { VF.list = []; }
  }
  // 模型离脚底中心最远多远（长尾巴的牧蛇 5.8 m）：按骨架几何的包围球（建骨架时放大过 1.5 倍）算一次
  const u = e.obj && e.obj.userData && e.obj.userData.arch;
  if (u && u._ext == null) {
    let ext = num(e.r, 0.4);
    if (u.rig && u.rig.mesh && u.rig.mesh.geometry && u.rig.mesh.geometry.boundingSphere) { const bs = u.rig.mesh.geometry.boundingSphere; ext = Math.max(ext, bs.radius / 1.5 + Math.hypot(bs.center.x, bs.center.z)); }
    // 有链的（尾巴、触手、肢团的肢体）：链甩起来比绑定姿势伸得更远（返修 FE1R · repair-r2：肢团从车后走近，离车 2 m 时触手梢已经甩进配重，
    // 那几帧没算它「在车旁边」、没收）—— 多让 0.6 m
    if (u.rig && u.rig.meta && u.rig.meta.chains && u.rig.meta.chains.length) ext += 0.6;
    u._ext = ext;
  }
  const ext = u && u._ext != null ? u._ext : num(e.r, 0.4) + 2.2;
  let out = null;
  for (const v of VF.list || []) {
    if (!Number.isFinite(v.x) || Math.abs(v.x - e.x) > 2.5 + ext || Math.abs(v.z - e.z) > 2.5 + ext) continue;
    // 实体中心到车的外接矩形（车本地 x ±0.6、z −2.2…1.4）的水平距离 > 模型伸出去最远的 + 0.6 m：碰不着，不算（停着的车旁边路过的怪不用每帧蒙皮）
    const c = Math.cos(v.yaw), sn = Math.sin(v.yaw), dx = e.x - v.x, dz = e.z - v.z, lx = c * dx - sn * dz, lz = sn * dx + c * dz;
    const ox = Math.max(Math.abs(lx) - 0.6, 0), oz = Math.max(-2.2 - lz, 0, lz - 1.4);
    if (Math.hypot(ox, oz) > ext + 0.6) continue;   // 0.6：跑起来甩出去的胳膊腿比绑定姿势的包围球多伸出去的
    (out || (out = [])).push(v);
  }
  return out;
}
// 骨架的顶点按骨骼分组（绑定位置减去骨骼绑定位置），每个骨架 key 算一次
function rigVerts(rig) {
  if (RIGVERTS.has(rig.key)) return RIGVERTS.get(rig.key);
  const T = THREE_(), geo = rig.mesh && rig.mesh.geometry;
  let r = null;
  if (geo && geo.attributes.position && geo.attributes.skinIndex) {
    const rest = new Map();
    rig.list.forEach(it => rest.set(it.bone, it.rest));
    const abs = rig.list.map(it => { const v = new T.Vector3(); for (let b = it.bone; b && b !== rig.mesh; b = b.parent) v.add(rest.get(b) || b.position); return v; });
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, n = rig.list.length, cnt = new Array(n).fill(0);
    for (let i = 0; i < pos.count; i++) cnt[si.getX(i)]++;
    const per = cnt.map(c => new Float32Array(c * 3)), at = new Array(n).fill(0);
    for (let i = 0; i < pos.count; i++) {
      const b = si.getX(i), a = per[b], k = at[b]++ * 3;
      a[k] = pos.getX(i) - abs[b].x; a[k + 1] = pos.getY(i) - abs[b].y; a[k + 2] = pos.getZ(i) - abs[b].z;
    }
    // 每根骨骼属于哪条「可以往回收」的肢体：胳膊 / 腿 / 头（从肢体根骨骼往下的整条），骨骼链（meta.chains）单独
    const limbOf = new Array(n).fill(-1), byName = {};
    rig.list.forEach((it, i) => { byName[it.name] = i; });
    const roots = [];
    rig.list.forEach((it, i) => { if (/^(arm|leg|head|neck|jaw|wing)/.test(it.name) && !(it.bone.parent && /^(arm|leg|head|neck|wing)/.test(it.bone.parent.name))) roots.push(i); });
    for (const ri of roots) {
      const root = rig.list[ri].bone;
      rig.list.forEach((it, i) => { for (let b = it.bone; b && b !== rig.mesh; b = b.parent) if (b === root) { limbOf[i] = ri; break; } });
    }
    const chainOf = new Array(n).fill(-1);
    ((rig.meta && rig.meta.chains) || []).forEach((names, ci) => names.forEach(nm => { if (byName[nm] != null) { chainOf[byName[nm]] = ci; limbOf[byName[nm]] = -1; } }));
    r = { per, limbOf, chainOf, byName };
  }
  RIGVERTS.set(rig.key, r);
  return r;
}
let VFM = null;
function vfScratch() {
  if (VFM) return VFM;
  const T = THREE_();
  VFM = { root: new T.Matrix4(), mesh: new T.Matrix4(), mats: [], v: new T.Vector3(), q: new T.Quaternion(), e: new T.Euler(), m: new T.Matrix4() };
  return VFM;
}
// 这一帧所有骨骼的模型空间矩阵（父骨骼先算）
function boneMats(rig, out) {
  const T = THREE_(), l = rig.list;
  while (out.length < l.length) out.push(new T.Matrix4());
  const idx = new Map();
  for (let i = 0; i < l.length; i++) idx.set(l[i].bone, i);
  for (let i = 0; i < l.length; i++) {
    const b = l[i].bone;
    b.updateMatrix();
    const pi = b.parent && idx.has(b.parent) ? idx.get(b.parent) : -1;
    if (pi >= 0) out[i].multiplyMatrices(out[pi], b.matrix); else out[i].copy(b.matrix);
  }
  return out;
}
// 每根骨骼压进车里最深多少（米）和往哪推（车本地的外法线），写进 dep / dir
// m（可选，返修 FE1R · repair-r2）：部件盒再往外让 m 米（离车 m 以内也算「进了」）—— 链（尾巴、触手）按蒙皮混合摆出来的顶点比只按主骨骼算的
// 多伸出去 1–3 cm，主骨骼量出来贴着车身外面、实际已经插进去了；链按让过的盒子判要不要收、收到多远
function vfDepths(e, rig, rv, cars, dep, dir, m) {
  const mm = m || 0;
  const K = vfScratch(), mats = boneMats(rig, K.mats), n = rig.list.length, v = K.v;
  K.root.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
  chainMat(rig.mesh, e.obj, K.mesh).premultiply(K.root);
  for (let i = 0; i < n; i++) { dep[i] = 0; dir[i] = null; }
  const G = BR.L1forklift.geo;
  for (const car of cars) {
    const boxes = car.boxes || (car.boxes = G.obbs(car.lift || 0).map(o => [o.cx - o.hx - 0.004, o.cx + o.hx + 0.004, o.cy - o.hy - 0.004, o.cy + o.hy + 0.004, o.cz - o.hz - 0.004, o.cz + o.hz + 0.004]).concat(SEAT_PARTS.map(q => q.slice(1))));
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw), y0 = num(car.y, 0);
    for (let i = 0; i < n; i++) {
      const a = rv.per[i];
      if (!a.length) continue;
      K.m.multiplyMatrices(K.mesh, mats[i]);
      const el = K.m.elements;
      for (let k = 0; k < a.length; k += 3) {
        const x = a[k], y = a[k + 1], z = a[k + 2];
        const wx = el[0] * x + el[4] * y + el[8] * z + el[12], wy = el[1] * x + el[5] * y + el[9] * z + el[13], wz = el[2] * x + el[6] * y + el[10] * z + el[14];
        const dx = wx - car.x, dz = wz - car.z, lx = c * dx - s * dz, lz = s * dx + c * dz, ly = wy - y0;
        if (Math.abs(lx) > 0.7 + mm || lz < -2.2 - mm || lz > 1.4 + mm || ly > 2.3 + mm || ly < -0.05 - mm) continue;
        for (const B of boxes) {
          const d = Math.min(lx - B[0], B[1] - lx, ly - B[2], B[3] - ly, lz - B[4], B[5] - lz) + mm;
          if (d > dep[i]) {
            dep[i] = d;
            // 最浅那一面的外法线（车本地 → 世界）
            const f = [lx - B[0], B[1] - lx, ly - B[2], B[3] - ly, lz - B[4], B[5] - lz];
            let j = 0; for (let q = 1; q < 6; q++) if (f[q] < f[j]) j = q;
            const nl = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][j];
            dir[i] = [c * nl[0] + s * nl[2], nl[1], -s * nl[0] + c * nl[2], wx, wy, wz];
          }
        }
      }
    }
  }
}
// 链上每一节：绑定时的方向（单位，骨骼本地 = 模型空间）、长度、粗细（顶点离这一节轴线最远多远）
function chainInfo(rig, rv) {
  if (rv.chain) return rv.chain;
  const T = THREE_(), out = {};
  for (const names of rig.meta.chains) {
    for (let k = 0; k < names.length; k++) {
      const i = rv.byName[names[k]];
      if (i == null) continue;
      const nx = k + 1 < names.length ? rv.byName[names[k + 1]] : null;
      let ax;
      if (nx != null) ax = rig.list[nx].rest.clone();
      else { // 末节：离骨骼原点最远的顶点
        const a = rv.per[i]; let best = 0; ax = new T.Vector3(0, 0, 0);
        for (let q = 0; q < a.length; q += 3) { const d = Math.hypot(a[q], a[q + 1], a[q + 2]); if (d > best) { best = d; ax.set(a[q], a[q + 1], a[q + 2]); } }
      }
      const len = ax.length() || 0.01, dir = ax.clone().multiplyScalar(1 / len);
      const a = rv.per[i]; let rad = 0.01;
      for (let q = 0; q < a.length; q += 3) { const t = a[q] * dir.x + a[q + 1] * dir.y + a[q + 2] * dir.z; rad = Math.max(rad, Math.hypot(a[q] - dir.x * t, a[q + 1] - dir.y * t, a[q + 2] - dir.z * t)); }
      out[i] = { dir, len, rad };
    }
  }
  rv.chain = out;
  return out;
}
// 点 P（世界）推出所有车的部件盒（按 pad 往外让），一律往实体所在的那一边推（车本地：实体在车侧就沿 ±x、在车前 / 车后就沿 ±z）——
// 车的部件盒挨在一起，各推各的最浅面会从一个盒子推进另一个盒子里来回打转；同一个方向推出去，几轮就出来。返回推了没有
function pushOut(P, cars, pad, ex, ez) {
  let moved = false;
  for (const car of cars) {
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw), y0 = num(car.y, 0);
    let dx = P.x - car.x, dz = P.z - car.z;
    let lx = c * dx - s * dz, lz = s * dx + c * dz;
    let ly = P.y - y0;
    const edx = ex - car.x, edz = ez - car.z, elx = c * edx - s * edz, elz = s * edx + c * edz;
    // 往哪个轴推：实体在车外接矩形（x ±0.6、z −2.1…1.3）哪一边伸出去得多就沿哪个轴（返修 FE1R · repair-r2：肢团在车左后方、离车尾 1 m、
    // 离车侧只有 0.2 m 时，以前沿 x 往车侧推，触手梢在 1.1 m 宽的配重里推不出去、按节长拉回来又回去）
    const ox = Math.abs(elx) - 0.6, oz = Math.max(-2.1 - elz, elz - 1.3);
    const ax = ox > 0 && ox >= oz ? 'x' : oz > 0 ? 'z' : 'z', sg = ax === 'x' ? Math.sign(elx) : (elz < -0.4 ? -1 : 1);
    let hit = false;
    for (let it = 0; it < 8; it++) {
      let push = null, up = null;
      for (const B of car.boxes) {
        const b0 = B[0] - pad, b1 = B[1] + pad, b2 = B[2] - pad, b3 = B[3] + pad, b4 = B[4] - pad, b5 = B[5] + pad;
        if (!(lx > b0 && lx < b1 && ly > b2 && ly < b3 && lz > b4 && lz < b5)) continue;
        const to = ax === 'x' ? (sg > 0 ? b1 : b0) : (sg > 0 ? b5 : b4);
        // 薄的横板（≤8 cm 厚：货叉 4 cm）从上面出去比横着出去近就往上推（返修 FE1R · repair-r2：肢团的触手梢横着搭在货叉上，
        // 往车侧那边推一下、按节长拉回来又回到叉子里，来回打转收不出来）
        const side = Math.abs(to - (ax === 'x' ? lx : lz));
        if (B[3] - B[2] <= 0.08 && b3 - ly < side) { if (up == null || b3 > up) up = b3; continue; }
        if (push == null || (sg > 0 ? to > push : to < push)) push = to;
      }
      if (push == null && up == null) break;
      hit = true;
      if (push != null) { if (ax === 'x') lx = push + sg * 0.002; else lz = push + sg * 0.002; }
      else P.y = (ly = up + 0.002) + y0;
    }
    if (hit) { P.x = car.x + c * lx + s * lz; P.z = car.z - s * lx + c * lz; moved = true; }
  }
  return moved;
}
function chainFit(e, rig, rv, cars, extra, drv) {
  const ex = extra || 0;
  const T = THREE_(), K = vfScratch(), CI = chainInfo(rig, rv);
  const Q = new T.Quaternion(), Qp = new T.Quaternion(), Qw = new T.Quaternion(), v = new T.Vector3(), cdir = new T.Vector3(), ddir = new T.Vector3(), M = new T.Matrix4();
  const listIdx = new Map(); rig.list.forEach((it, i) => listIdx.set(it.bone, i));
  for (const names of rig.meta.chains) {
    const idx = names.map(nm => rv.byName[nm]);
    if (idx.some(i => i == null || !CI[i])) continue;
    if (!idx.some(i => VF_DEP[i] > 0.004)) continue;
    // 此刻的关节点（世界）：每节骨骼原点 + 末节梢
    const mats = boneMats(rig, K.mats);
    const J = [];
    for (let k = 0; k < idx.length; k++) J.push(new T.Vector3().setFromMatrixPosition(M.multiplyMatrices(K.mesh, mats[idx[k]])));
    { const last = idx[idx.length - 1], ci = CI[last]; M.multiplyMatrices(K.mesh, mats[last]); J.push(ci.dir.clone().multiplyScalar(ci.len).applyMatrix4(M)); }
    const L = idx.map(i => CI[i].len);
    for (let it = 0; it < 16; it++) {
      let any = false;
      for (let k = 1; k < J.length; k++) {
        const pad = CI[idx[k - 1]].rad + 0.02 + ex;
        if (pushOut(J[k], cars, pad, e.x, e.z)) any = true;
        // 司机的身体（drv：这只怪此刻在打的那台车上坐着的人，车本地一个盒子）：别的链整条躲开（打人的那条由 seatChain 摆，梢贴着人）
        if (drv && names !== drv.names && pushOut(J[k], drv.cars, pad, e.x, e.z)) any = true;
        // 节上 1/4、1/2、3/4 处：这一节穿过薄的东西（货叉 4 cm 厚）两头都在外面；推出去多少，梢那一头按比例多推
        for (const t of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
          const mid = v.copy(J[k - 1]).lerp(J[k], t), m0 = mid.clone();
          if (pushOut(mid, cars, pad, e.x, e.z)) { J[k].add(mid.sub(m0).multiplyScalar(1 / t)); any = true; }
        }
      }
      for (let k = 1; k < J.length; k++) { const d = J[k].clone().sub(J[k - 1]); const l = d.length() || 1e-4; J[k].copy(J[k - 1]).addScaledVector(d, L[k - 1] / l); }
      if (!any) break;
    }
    // 按新的关节点转骨骼（从根往梢，每转一节重新算一次矩阵）
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], bone = rig.list[i].bone;
      const ms = boneMats(rig, K.mats);
      M.multiplyMatrices(K.mesh, ms[i]);
      Qw.setFromRotationMatrix(new T.Matrix4().extractRotation(M));
      cdir.copy(CI[i].dir).applyQuaternion(Qw).normalize();
      ddir.copy(J[k + 1]).sub(J[k]).normalize();
      if (cdir.dot(ddir) > 0.99999) continue;
      Q.setFromUnitVectors(cdir, ddir);
      const pi = bone.parent ? listIdx.get(bone.parent) : undefined;
      if (pi != null) { M.multiplyMatrices(K.mesh, ms[pi]); Qp.setFromRotationMatrix(new T.Matrix4().extractRotation(M)); }
      else { Qp.setFromRotationMatrix(new T.Matrix4().extractRotation(K.mesh)); }
      // 新的本地 = Qp⁻¹ · Q · Qw
      const nw = Q.clone().multiply(Qw);
      bone.quaternion.copy(Qp.clone().invert().multiply(nw));
    }
  }
}
const VF_DEP = [], VF_DIR = [], VF_SAVE = [];
// 坐在驾驶座上的人的外接盒（车本地 [x0, x1, y0, y1, z0, z1]，坐姿人形量一次；返修 FE1R · repair-r2）
let DRV_BOX = null;
function driverBox() {
  if (DRV_BOX) return DRV_BOX;
  try { const sb = BR.coop && has(BR.coop, 'seatBody') ? BR.coop.seatBody({}) : null; if (sb && sb.box && sb.box.min) DRV_BOX = [sb.box.min[0], sb.box.max[0], sb.box.min[1], sb.box.max[1], sb.box.min[2], sb.box.max[2]]; } catch (err) { DRV_BOX = null; }
  if (!DRV_BOX) DRV_BOX = [-0.28, 0.28, 0.6, 1.95, -0.62, 0.5];
  return DRV_BOX;
}
const VF_CHAIN_M = 0.03;   // 链离车多近就收（见 vehFit）
function vehFit(e, rig, u) {
  if (!rig || !rig.mesh || e.dead) return;
  const cars = vehNear(e);
  if (!cars) return;
  const rv = rigVerts(rig);
  if (!rv) return;
  const n = rig.list.length, TOL = 0.004;
  vfDepths(e, rig, rv, cars, VF_DEP, VF_DIR);
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, VF_DEP[i]);
  u.vfDepth = worst;
  if (worst <= TOL) return;
  const T = THREE_();
  // ① 胳膊 / 腿 / 头：整条往基础姿势收
  const limbs = new Set();
  for (let i = 0; i < n; i++) if (VF_DEP[i] > TOL && rv.limbOf[i] >= 0) limbs.add(rv.limbOf[i]);
  for (const ri of limbs) {
    const root = rig.list[ri].bone, members = [];
    rig.list.forEach((it, i) => { if (rv.limbOf[i] === ri) members.push(i); });
    for (const i of members) { const it = rig.list[i]; VF_SAVE[i] = it.bone.quaternion.clone(); }
    const baseQ = members.map(i => { const b = rig.list[i].base; return new T.Quaternion().setFromEuler(new T.Euler(b ? b[0] : 0, b ? b[1] : 0, b ? b[2] : 0)); });
    for (const t of [0.5, 0.75, 1]) {
      members.forEach((i, j) => rig.list[i].bone.quaternion.copy(VF_SAVE[i]).slerp(baseQ[j], t));
      vfDepths(e, rig, rv, cars, VF_DEP, VF_DIR);
      let w = 0; for (const i of members) w = Math.max(w, VF_DEP[i]);
      if (w <= TOL) break;
    }
    void root;
  }
  // ② 骨骼链（尾巴、触手、肢团的肢体）：关节点（世界坐标）推出车的部件盒（盒子按这一节的粗细再往外让 1 cm），每节中点也推，
  //    再从根往梢把每节长度拉回来（FABRIK 正向一遍），四轮；最后按新的关节点从根往梢转每一节骨骼。链根（长在身体上那一端）不动
  // 返修 FE1R · repair-r2（验收员 tests：肢团走近时触手梢插进配重 3.6–6.7 cm，摆动相位不同时好时坏）：链离车 VF_CHAIN_M 以内就收
  // （按主骨骼量的比实际蒙皮出来的少伸出去 1–3 cm），收完再量一遍，还贴着就把让的距离加大再收，最多三遍
  // 用一条链打坐车的人的那一下（seatChain 记的 u.seatHit），别的链也不许插进司机身上（验收员 tests：肢团扣血那一帧另一条肢体插进司机 1.3 cm）：
  // 司机按坐姿人形的外接盒（车本地）当成这台车的又一个部件盒，打人的那条链只有梢贴上去（chainFit 的 drv）
  let drv = null, carsD = cars;
  if (u.seatHit && u.seatHit.t === now()) {
    const db = driverBox(), key = String(u.seatHit.key);
    carsD = cars.map(c => String(c.key) === key ? Object.assign({}, c, { boxes: c.boxes.concat([db]) }) : c);
    drv = { cars: cars.filter(c => String(c.key) === key).map(c => Object.assign({}, c, { boxes: [db] })), names: null };
    if (rig.meta && rig.meta.chains) for (const names of rig.meta.chains) { const ii = names.map(nm => rv.byName[nm]); if (ii.length === u.seatHit.idx.length && ii.every((v, q) => v === u.seatHit.idx[q])) drv.names = names; }
  }
  if (rig.meta && rig.meta.chains && rig.meta.chains.length) {
    for (let pass = 0; pass < 3; pass++) {
      vfDepths(e, rig, rv, carsD, VF_DEP, VF_DIR, VF_CHAIN_M);
      let need = false;
      for (const names of rig.meta.chains) for (const nm of names) { const i = rv.byName[nm]; if (i != null && VF_DEP[i] > TOL) need = true; }
      if (!need) break;
      chainFit(e, rig, rv, cars, VF_CHAIN_M + 0.02 * pass, drv);
    }
  }
  vfDepths(e, rig, rv, cars, VF_DEP, VF_DIR);
  let after = 0, ab = -1;
  for (let i = 0; i < n; i++) if (VF_DEP[i] > after) { after = VF_DEP[i]; ab = i; }
  u.vfAfter = after; u.vfAfterBone = ab >= 0 ? rig.list[ab].name : null;
}

// ---------- 实体此刻的真实外形（FE1R ACT-veh，给叉车的碰撞、雷达、降货叉用） ----------
// 实体的碰撞体是一根竖直圆柱（e.r、e.h、脚在 e.y），和网格对不上：挂在天花板上的 Nguithr'xurh 网格在 2.59–2.69 m，碰撞圆柱却在地上
// （车开过去雷达刹车）；跑起来甩出去的胳膊腿伸到圆柱外 0.3–0.6 m（车停在圆柱外面，车身还是插进胳膊里）。
// shapeOf(e) → [{ x, z, r, minY, maxY }]（世界坐标）：按网格此刻的实际顶点（骨架按蒙皮算，别的按网格包围盒），离实体脚底 0–0.6、0.6–1.2、
// 1.2 m 以上分三段，每段一个竖直圆柱（圆心 = 这一段顶点的水平包围盒中心，半径 = 离圆心最远的顶点 + 1 cm，上下各让 1 cm），
// 没有顶点的段不给。不透明度很低的精灵、加法混合的光晕不算（不是实物）。同一实体同一帧只算一次
const SHAPE_BANDS = [0.6, 1.2];
function shapeOf(e) {
  const u = e && e.obj && e.obj.userData && e.obj.userData.arch;
  if (!u) return null;
  const t = now();
  if (u._shapeT === t && u._shape) return u._shape;
  const T = THREE_(), K = vfScratch();
  const nb = SHAPE_BANDS.length + 1;
  const bx0 = new Array(nb).fill(Infinity), bx1 = new Array(nb).fill(-Infinity), bz0 = new Array(nb).fill(Infinity), bz1 = new Array(nb).fill(-Infinity);
  const by0 = new Array(nb).fill(Infinity), by1 = new Array(nb).fill(-Infinity);
  const pts = [];
  const add = (x, y, z) => {
    const h = y - e.y; let b = 0; while (b < SHAPE_BANDS.length && h >= SHAPE_BANDS[b]) b++;
    if (x < bx0[b]) bx0[b] = x; if (x > bx1[b]) bx1[b] = x; if (z < bz0[b]) bz0[b] = z; if (z > bz1[b]) bz1[b] = z;
    if (y < by0[b]) by0[b] = y; if (y > by1[b]) by1[b] = y;
    pts.push(b, x, z);
  };
  K.root.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
  const rig = u.rig, rv = rig ? rigVerts(rig) : null;
  if (rig && rv) {
    const mats = boneMats(rig, K.mats);
    chainMat(rig.mesh, e.obj, K.mesh).premultiply(K.root);
    for (let i = 0; i < rig.list.length; i++) {
      const a = rv.per[i];
      if (!a.length) continue;
      const el = K.m.multiplyMatrices(K.mesh, mats[i]).elements;
      for (let k = 0; k < a.length; k += 3) {
        const x = a[k], y = a[k + 1], z = a[k + 2];
        add(el[0] * x + el[4] * y + el[8] * z + el[12], el[1] * x + el[5] * y + el[9] * z + el[13], el[2] * x + el[6] * y + el[10] * z + el[14]);
      }
    }
  }
  // 骨架以外的网格（笑魇的脸、蜘蛛的网囊、群体……）：按网格的包围盒八个角
  const box = new T.Box3(), v = new T.Vector3();
  e.obj.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || o.isSprite) return;
    for (let q = o; q && q !== e.obj; q = q.parent) if (!q.visible) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && (m.blending === T.AdditiveBlending || (m.transparent && m.opacity < 0.3))) return;
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox);
    K.m.identity();
    for (let q = o; q && q !== e.obj; q = q.parent) { q.updateMatrix(); K.m.premultiply(q.matrix); }
    K.m.premultiply(K.root);
    for (let c = 0; c < 8; c++) { v.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).applyMatrix4(K.m); add(v.x, v.y, v.z); }
  });
  const out = [];
  for (let b = 0; b < nb; b++) {
    if (bx0[b] === Infinity) continue;
    const cx = (bx0[b] + bx1[b]) / 2, cz = (bz0[b] + bz1[b]) / 2;
    let r = 0;
    for (let i = 0; i < pts.length; i += 3) if (pts[i] === b) r = Math.max(r, Math.hypot(pts[i + 1] - cx, pts[i + 2] - cz));
    out.push({ x: cx, z: cz, r: r + 0.01, minY: by0[b] - 0.01, maxY: by1[b] + 0.01 });
  }
  u._shapeT = t; u._shape = out;
  return out;
}
// 实体脚下是不是一台车（车的外接矩形 x ±0.6、z −2.1…1.3，按碰撞半径往外让）
function carUnder(e) {
  const cars = vehNear(e);
  if (!cars) return false;
  const r = num(e.r, 0.1);
  for (const car of cars) {
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw), dx = e.x - car.x, dz = e.z - car.z, lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) <= 0.6 + r && lz >= -2.1 - r && lz <= 1.3 + r) return true;
  }
  return false;
}
// 飞的 / 挂在天花板上往下扑的（Nguithr'xurh）：正下方有叉车护顶时，最低只落到护顶顶面上方 1 cm（不整只穿过护顶、不进驾驶舱）
function roofFloor(e, u) {
  const cars = vehNear(e), G = BR.L1forklift && BR.L1forklift.geo;
  if (!cars || !G || !has(G, 'obbs')) return -Infinity;
  if (u._meshBot == null) {
    const T = THREE_(), b = new T.Box3();
    u.pivot.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(u.pivot.matrixWorld).invert(), bb = new T.Box3();
    u.pivot.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && !o.isSprite && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld)); b.union(bb); } });
    u._meshBot = b.isEmpty() ? 0 : b.min.y;
  }
  let best = -Infinity;
  const r = num(e.r, 0.1) + 0.05;
  for (const car of cars) {
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw), dx = e.x - car.x, dz = e.z - car.z, lx = c * dx - s * dz, lz = s * dx + c * dz;
    for (const o of G.obbs(car.lift || 0)) {
      if (Math.abs(lx - o.cx) > o.hx + r || Math.abs(lz - o.cz) > o.hz + r) continue;
      best = Math.max(best, num(car.y, 0) + o.cy + o.hy + 0.01 - e.y - u._meshBot);
    }
  }
  return best;
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
  // 摆动 / 呼吸 / 抽搐的相位按实体 id 定（返修 FE1R · repair-r2：以前 wrap 时 Math.random —— 同一只怪两次跑出来尾巴、触手甩的相位不一样，
  // 叉车旁边贴车的那几帧时好时坏、测试没法复现）。联机两端同一只怪 id 一样，相位也一样
  if (u.seedFor !== e.id) { u.seedFor = e.id; u.seed = (U.hashStr('arch-seed:' + e.id) % 10000) / 100; }
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
      // 扒在车上 / 立起来够人的时候不喘、不抽（返修 FE1R · repair-r2：趴着的姿势是按基础姿势算的，喘气让胸口一起一伏 1–2 cm，压进发动机盖）
      const perched = !!(u.perch && u.perch.phase !== 'drop' && u.perch.phase !== 'ceil');
      if (cfg.breathe !== 0 && !perched) breathe(rig, t + u.seed, num(cfg.breathe, 0.03));
      if (cfg.twitch && !perched) twitch(rig, t, cfg.twitch, u.seed);
      if (rig.meta.chains && rig.meta.chains.length) sway(rig, t + u.seed, num(cfg.sway, 0.25) * (1 + amt * 0.5), cfg.swaySpeed);
      if (e.state === 'attack' || striking(e, api, t)) {
        const cd = Math.max(0.2, num(e.def.attack && e.def.attack.cooldown, 1));
        const kind = cfg.strike || (gait === 'quad' ? 'bite' : 'swipe'), k = strikePhase(e, api, t, u, cd);
        // 打坐在车上的人（FE1R K6）：胳膊从上面越过车身侧板落到司机肩上，见 strikeSeat；没有胳膊的（repair-r1）整只扑上去 / 伸一条肢体过去，见 seatLeap / seatChain
        const ss = e.def.seatStrike, sm = ss && (ss.kind === 'leap' || ss.kind === 'chain');
        const tg = (sm || kind === 'swipe' || kind === 'grab') && has(api, 'seatTarget') ? api.seatTarget(e) : null;
        if (sm) {
          // 扑上去的那一下本身就是出手动作：不再叠原来的 lunge / bite（lunge 把胯往前推 15 cm，站在车边会把身子推进车身里）
          if (!(tg && ss.kind === 'leap')) strike(rig, k, kind);
          if (tg && ss.kind === 'leap') seatLeap(e, rig, k, tg, u, ss, api, cd); else { if (ss.kind === 'leap') u._leapWhy = 'notg'; leapRelease(e, u); }
          if (tg && ss.kind === 'chain') seatChain(e, rig, k, tg, u, ss);
        } else if (!(tg && strikeSeat(e, rig, k, kind, tg, u))) strike(rig, k, kind);
      } else if (u.perch || u.leap) { u._leapWhy = 'notAttacking ' + e.state; leapRelease(e, u); }
      if (cfg.vehFit !== false) vehFit(e, rig, u);   // 胳膊腿不插进叉车（FE1R K6 / ACT-veh）
    }
  }

  const pv = u.pivot, fly = cfg.fly;
  let y = 0, rx = 0, rz = 0;
  if (fly) {
    const low = num(fly.low, 1.0), cruise = num(fly.cruise, 2.0);
    let want = e.dead ? 0 : (e.state === 'dive' || e.state === 'attack') ? low : (e.state === 'land' || e.state === 'hide') ? num(fly.rest, 0) : cruise;
    // 打坐在车上的人（Nguithr'xurh，repair-r1）：不往下沉（沉下去会穿过车身），扑下来那一下由 seatLeap 摆
    if (want === low && !e.dead && e.def.seatStrike && e.def.seatStrike.kind === 'leap' && has(api, 'seatTarget') && api.seatTarget(e)) want = cruise;
    // 正下方是一台车（车开到挂在天花板上的 Nguithr'xurh 底下）：往上打的射线会先打到车，量出来的「天花板」变成车里，
    // 怪就跟着沉进车里 —— 车在脚下时不重新量天花板（FE1R ACT-veh）
    if (fly.ceiling !== false && has(BR.phys, 'raycast') && t - u.ceilAt > 0.5 && !carUnder(e)) {
      u.ceilAt = t;
      const hit = BR.phys.raycast(e.x, e.y + 0.3, e.z, 0, 1, 0, 12);
      u.ceil = hit ? hit.dist + 0.3 - num(fly.clearance, 0.35) : Infinity;   // 矮天花板的层级别飞进吊顶里
    }
    want = Math.max(0, Math.min(want, u.ceil));
    // 正下方有叉车：最低落到车顶（护顶、门架……）上方 1 cm，不整只穿过护顶（FE1R K6 / ACT-veh）
    const rf = roofFloor(e, u);
    if (want < rf) want = Math.min(rf, u.ceil);
    u.alt = Number.isFinite(u.alt) ? U.damp(u.alt, want, e.state === 'dive' ? 5 : 2.5, dt) : want;
    if (u.alt < rf) u.alt = Math.min(rf, u.ceil);
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
  // 没有胳膊的怪扑向坐车的人（repair-r1 seatLeap）：整只平移；不扑的时候 x / z 归零（别的怪 onFrame 自己摆 pivot 的在这之后）
  if (u.leap && !e.dead) { pv.position.x = u.leap.x; pv.position.y += u.leap.y; pv.position.z = u.leap.z; }
  else if (u.leapWas) { pv.position.x = 0; pv.position.z = 0; }
  u.leapWas = !!(u.leap && !e.dead);
  pv.rotation.x = rx + (u.leap && !e.dead ? num(u.leap.th, 0) : 0);
  pv.rotation.z = rz;
  if (u.leap && u.leap.q && !e.dead) pv.quaternion.copy(u.leap.q);   // 扑到车上（repair-r2 seatLeap）：转到趴着的朝向 + 仰角
  else if (u.leapQWas) pv.rotation.y = 0;
  u.leapQWas = !!(u.leap && u.leap.q && !e.dead);
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
    // 叉车旁边的实体每帧都摆（FE1R ACT-veh）：降频摆的那几帧姿势不动、人在动，胳膊腿会插进车里（vehFit 每次摆完才管得着）
    let step;
    if (cfg.lod === false) step = dt;
    else if (vehNear(e)) { step = Math.min(0.35, u.acc + dt); u.acc = 0; }
    else step = lodStep(e, u, dt);
    if (!(step > 0)) return;
    auto(e, step, api, cfg, u);
    if (typeof cfg.onFrame === 'function') {
      cfg.onFrame(e, step, api, u);
      // onFrame 自己又摆了骨骼（细菌甩胳膊之类）：再收一遍，别插进车里（FE1R ACT-veh）
      if (u.rig && cfg.vehFit !== false && !e.dead) vehFit(e, u.rig, u);
    }
    // 淡出淡入放最后：onFrame 里经 slotMat 写的透明度按淡出进度盖掉，隐身时不会闪出来。没隐身过的实体只多一次字符串比较
    if (u.fade || e.state === 'vanish') fadeTick(e, step, u, cfg);
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
      const m = melee(e, api, t, o.onAttack);
      if (m) return;
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
      const m = melee(e, api, t, o.onAttack);
      if (m) return;
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
        const m = melee(e, api, t, o.onAttack);
        if (m === 'hit') { a.mode = 'climb'; a.until = now + o.climbSec; return; }   // 抡的那一下（起手到打到）entities 不让它想事，打完才拉起
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
        const m = melee(e, api, t, o.onAttack);
        if (m) return;
      }
      e.state = t && (o.revealRange <= 0 || t.dist <= o.revealRange) ? 'lurk' : 'hide';
      lure(e, api, o);
      return;
    }
    if (a.mode === 'strike') {
      if (t && now < a.until) {
        const m = melee(e, api, t, o.onAttack);
        if (m) return;
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
      const m = melee(e, api, t, o.onAttack);
      if (m) return;
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
        const m = melee(e, api, t, o.onAttack);
        if (m) return;
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
      const m = melee(e, api, t, o.onAttack);
      if (m) return;
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
  // 实体的模型建出来是圆的（FE1R K8，见 humSeg）：只在实体自己的 build 里打开；层级里借人形骨架摆的道具（L15 的尸体）照旧，世界生成金样不变
  if (typeof def.build === 'function') {
    const b0 = def.build;
    d.build = function () { ROUND++; try { return b0.apply(this, arguments); } finally { ROUND--; } };
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
  const op = o.opacity != null ? o.opacity : 0.82;
  const rimOp = o.rimOpacity != null ? o.rimOpacity : op * 0.55;   // 发梢/爪尖比核心躯干更透一层，边缘"多层半透明"的渐隐效果
  return humanoid(Object.assign({ thin: 0.5, head: 'faceless', opacity: op }, o, {
    look: Object.assign({ body: 'shadow', head: 'shadow', hair: 'shadow', claw: 'shadow' }, o.look),
    mats: Object.assign({ hair: mat.shadow(rimOp), claw: mat.shadow(rimOp) }, o.mats),
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
  // 视觉钩子（ENGINE_PLAN M1 AA）：淡出淡入、共享粒子池；每实例材质见 wrap 返回的 u.slotMat
  fx: { vanish: fxVanish, appear: fxAppear, update: fxUpdate, burst: fxBurst, clear: poolClear, debugInfo: fxDebug, FADE_SEC, SLOTMAT_FAR, POOL_MAX },
  // 动画
  anim: { pose, addRot, addPos, biped, crawl, quad, flap, sway, breathe, twitch, strike, strikeCurve, STRIKE_PEAK, strikePhase, striking, swarm: swarmAnim, auto, lodStep, strikeSeat, rigInfo },
  animate,
  seatReach, shapeOf,
  // 测试用（FE1R repair-r4 L2）：坐车人形从 hazmat.glb 挑了多少顶点（头 / 躯干 / 两只靴子）；glb 没载入（或缺件）时 null —— 坐车人形退回程序化的那一套
  // headDy：头上的件比 glb 原位往下挪了多少（见 HZ_GLB_HEAD_DY），测试按它找面罩
  // (side, y, z)（车本地，右侧 +1）坐着的人身最外一层离中线多远（三角形光栅化，1 cm 一格，(y, z) 落在的那一格；没人 → −1）。entities.js 定落点用
  driverSurfAt: (side, y, z) => surfAt1(side, y, z),
  hzGlbInfo() { const G = hzGlbParts(); if (!G) return null; const n = l => l.reduce((a, c) => a + c.pos.length / 3, 0); return { head: n(G.head), torso: n(G.torso), boot: n(G.boot.L) + n(G.boot.R), headDy: HZ_GLB_HEAD_DY }; },
};
})();
