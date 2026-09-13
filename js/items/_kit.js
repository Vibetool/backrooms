// 后室 · 物品共用工具 BR.itemKit（给 js/items/*.js 用）
//   模型：顶点色部件合并成一个 mesh（所有物品共用一个材质）+ 标签贴图 + 透明瓶身 + 自发光部件，材质全走 BR.assets.material 缓存
//   图标：64px canvas → data URL
//   数值：按物品声明的 effect 结算 hp/饥饿/san（游玩/测试模式由 player.useSelected 还原），时效效果交给 BR.effects
//   其他：分次食用、投掷落点、范围伤害、爆炸/闪电特效
// 加载顺序：核心与 game 模块之后、各物品文件之前（_effects.js 同样放在物品文件之前）。almond_water.js 不依赖本文件。
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// 设定里的时长统一换算：设定 1 小时 → 游戏 60 秒（1 分钟 → 1 秒）。
// 依据：config.stats 正常走动 14 分钟饿空，相当于设定里十几个小时不吃东西，量级一致
const LORE_HOUR = 60;
// 皇家口粮"让人对别的食物没兴趣"：成瘾期间其他食物回的饥饿打五折
const CRAVING_MUL = 0.5;
const CRAVING_KEY = 'royal_craving';

const localMats = new Map();
const texCache = new Map();

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function TH() { return window.THREE; }

// 渲染器输出 sRGB、r147 默认不做颜色管理：手写的 sRGB 色值先转线性，屏幕上才是本来的颜色
function col(hex) { return new (TH().Color)(hex).convertSRGBToLinear(); }

function mat(key, factory) {
  const k = 'item:' + key;
  if (has(BR.assets, 'material')) {
    const m = BR.assets.material(k, factory);
    if (m) { m.userData.shared = true; return m; }
  }
  if (!localMats.has(k)) { const m = factory(); m.userData.shared = true; localMats.set(k, m); }
  return localMats.get(k);
}

// 自发光乘上顶点色：暗层级里物品按自己的颜色微微发亮，而不是蒙一层灰
function emissiveByVertexColor(m) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif'
    );
  };
  m.customProgramCacheKey = () => 'item-vc-emissive';
  return m;
}

function solidMat(shiny) {
  return mat(shiny ? 'vc-shiny' : 'vc', () => {
    const T = TH();
    const m = shiny
      ? new T.MeshPhongMaterial({ vertexColors: true, specular: 0x666666, shininess: 70, emissive: 0x2e2e2e })
      : new T.MeshLambertMaterial({ vertexColors: true, emissive: 0x2e2e2e });
    return emissiveByVertexColor(m);
  });
}

function glassMat(hex, opacity) {
  const op = num(opacity, 0.3);
  return mat('glass:' + hex.toString(16) + ':' + op, () => new (TH().MeshPhongMaterial)({
    color: col(hex), specular: 0xffffff, shininess: 90, transparent: true, opacity: op, depthWrite: false,
  }));
}

// 不受光照影响的自发光部件（火盐、瓶装闪电）
function glowMat(hex, opacity) {
  const op = opacity == null ? 1 : opacity;
  return mat('glow:' + hex.toString(16) + ':' + op, () => new (TH().MeshBasicMaterial)({
    color: col(hex), transparent: op < 1, opacity: op, depthWrite: op >= 1,
  }));
}

function texture(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const T = TH();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new T.CanvasTexture(c);
  tex.encoding = T.sRGBEncoding;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

// 标签：canvas 贴图 + 同一张图做自发光贴图（暗处也看得清字）
function labelMat(key, w, h, draw) {
  return mat('label:' + key, () => {
    const tex = texture('label:' + key, w, h, draw);
    return new (TH().MeshLambertMaterial)({ map: tex, emissive: 0x333333, emissiveMap: tex });
  });
}

// ---------- 几何 ----------
function lathe(points, seg, phiStart, phiLength) {
  const T = TH();
  const geo = new T.LatheGeometry(points.map(p => new T.Vector2(p[0], p[1])), seg, phiStart || 0, phiLength || Math.PI * 2);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}
// 圆柱：y 为底面高度
function cyl(rTop, rBot, h, seg, y, open) {
  return new (TH().CylinderGeometry)(rTop, rBot, h, seg, 1, !!open).translate(0, (y || 0) + h / 2, 0);
}
// 盒子：y 为底面高度
function box(w, h, d, x, y, z) {
  return new (TH().BoxGeometry)(w, h, d).translate(x || 0, (y || 0) + h / 2, z || 0);
}
function sphere(r, ws, hs, x, y, z) {
  return new (TH().SphereGeometry)(r, ws, hs).translate(x || 0, y || 0, z || 0);
}

function paint(geo, hex) {
  const T = TH();
  const c = col(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new T.BufferAttribute(arr, 3));
  return geo;
}

// 按法线朝向分色：朝上的面一种颜色、侧面另一种（牛排的肉面和脂肪边、蛋糕的糖霜顶）
function paintByNormal(geo, topHex, sideHex, bottomHex) {
  const T = TH();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const top = col(topHex), side = col(sideHex), bot = col(bottomHex != null ? bottomHex : sideHex);
  const nrm = geo.attributes.normal;
  const n = nrm.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ny = nrm.getY(i);
    const c = ny > 0.6 ? top : ny < -0.6 ? bot : side;
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new T.BufferAttribute(arr, 3));
  return geo;
}

function merge(geos) {
  const T = TH();
  const list = geos.filter(Boolean);
  const anyNonIndexed = list.some(g => !g.index);
  const ready = list.map(g => {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) paint(g, 0xffffff);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    g.clearGroups();
    return anyNonIndexed && g.index ? g.toNonIndexed() : g;
  });
  const out = T.BufferGeometryUtils.mergeBufferGeometries(ready, false);
  ready.forEach(g => g.dispose());
  list.forEach(g => g.dispose());
  if (!out) throw new Error('物品几何合并失败');
  return out;
}

// spec: { name, scale, solid: [geo], shiny: [geo], labels: [[geo, material]], glow: [[geo, hex, opacity]], glass: [[geo, hex, opacity]] }
function assemble(spec) {
  const T = TH();
  const root = new T.Group();
  root.name = spec.name || 'item';
  if (spec.solid && spec.solid.length) root.add(new T.Mesh(merge(spec.solid), solidMat(false)));
  if (spec.shiny && spec.shiny.length) root.add(new T.Mesh(merge(spec.shiny), solidMat(true)));
  for (const l of spec.labels || []) root.add(new T.Mesh(l[0], l[1]));
  for (const gl of spec.glow || []) root.add(new T.Mesh(gl[0], glowMat(gl[1], gl[2])));
  for (const g of spec.glass || []) {
    const m = new T.Mesh(g[0], glassMat(g[1], g[2]));
    m.renderOrder = 2;   // 透明瓶身最后画，里面的液体和标签不会被它挡掉
    root.add(m);
  }
  if (spec.scale) root.scale.setScalar(spec.scale);
  return root;
}

function tris(obj) {
  let n = 0;
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(n);
}

// ---------- 图标 ----------
const H = {
  rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  },
  fillRR(g, x, y, w, h, r, fill, stroke) {
    H.rr(g, x, y, w, h, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  },
  ell(g, cx, cy, rx, ry, fill, stroke, rot) {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  },
  poly(g, pts, fill, stroke) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  },
  text(g, s, x, y, size, color, weight) {
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = (weight || 'bold') + ' ' + size + 'px "Arial Black", Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(s, x, y);
  },
  // 横向渐变：圆柱体的明暗
  cylGrad(g, x, w, c0, c1) {
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, c1);
    gr.addColorStop(0.35, c0);
    gr.addColorStop(1, c1);
    return gr;
  },
};

function icon(draw) {
  if (typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    draw(g, H);
    return c.toDataURL('image/png');
  } catch (err) {
    return undefined;
  }
}

// ---------- 数值 ----------
function effectsApi() { return BR.effects && has(BR.effects, 'add') ? BR.effects : null; }

// 按声明结算，顺序固定（测试按同样顺序算预期）：hungerSet → hunger → hp → sanity → sanityFill → timed → clearHostile / clearTags
// 直接改 player 字段；游玩/测试模式下 player.useSelected 会把 hp/饥饿/san 原样还回去
function apply(player, def, spec) {
  const s = spec || (def && def.effect);
  if (!player || !s) return;
  const fx = effectsApi();
  let hunger = num(s.hunger, 0);
  if (hunger > 0 && def && def.category === 'food' && def.type !== 'royal_rations' && fx && fx.has(CRAVING_KEY)) hunger *= CRAVING_MUL;
  if (s.hungerSet != null) player.hunger = Math.max(player.hunger, s.hungerSet);
  if (hunger) player.hunger = U.clamp(player.hunger + hunger, 0, 100);
  if (s.hp) player.hp = U.clamp(player.hp + s.hp, 0, BR.config.player.maxHp);
  if (s.sanity) player.sanity = U.clamp(player.sanity + s.sanity, 0, 100);
  if (s.sanityFill) player.sanity = U.clamp(player.sanity + (100 - player.sanity) * s.sanityFill, 0, 100);
  if (fx && Array.isArray(s.timed)) for (const t of s.timed) fx.add(Object.assign({}, t));
  if (fx && s.clearHostile) fx.clear({ hostile: true });
  if (fx && Array.isArray(s.clearTags)) for (const tag of s.clearTags) fx.clear({ tag });
}

// 物品造成的即时伤害：只有噩梦生存扣血（游玩/测试模式不能在 use 里途经 damage 触发死亡）
function hurt(player, amount, cause, key) {
  if (!BR.game.statsEnabled || !player || player.dead || !has(player, 'damage')) return false;
  const a = Math.max(0, num(amount, 0));
  if (a <= 0) return false;
  return player.damage({ hp: a, source: { cause: cause || '死于物品伤害', key: key || 'item' } });
}

function toast(text, ms) { if (text && has(BR.hud, 'toast')) BR.hud.toast(text, ms || 2200); }
function sound(name) { if (name && BR.audio && has(BR.audio, 'play')) BR.audio.play(name); }

// 最常见的 use：按 effect 结算 + 音效 + 提示，消耗一个
function simpleUse(soundName, text) {
  return function (player) {
    apply(player, this);
    sound(soundName);
    toast(text);
    return true;
  };
}

// 一件物品分几次吃完（整盒浆果、整块口粮）：剩余次数记在背包格对象上。最后一次返回 true（消耗）
function portion(player, type, total) {
  const slot = player && player.inventory ? player.inventory[player.selected] : null;
  if (!slot || slot.type !== type || !(total > 1)) return true;
  if (!(slot.left > 0)) slot.left = total;
  slot.left -= 1;
  if (slot.left <= 0) { delete slot.left; return true; }
  return false;
}

// ---------- 投掷与范围效果 ----------
function throwPoint(p, maxDist) {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let d = maxDist;
  if (BR.phys && has(BR.phys, 'raycast')) {
    const hit = BR.phys.raycast(p.x, p.y - 0.5, p.z, fx, 0, fz, maxDist);
    if (hit && hit.dist < d) d = Math.max(0, hit.dist - 0.25);   // 砸在墙上：落点退回墙前一点
  }
  const x = p.x + fx * d, z = p.z + fz * d;
  const y = BR.phys && has(BR.phys, 'groundY') ? num(+BR.phys.groundY(x, z), 0) : 0;
  return { x, y, z, dist: d };
}

function livingEntities() {
  const out = [];
  const ents = BR.entities && BR.entities.list;
  if (!ents) return out;
  const arr = Array.isArray(ents) ? ents : Array.from(ents.values ? ents.values() : Object.values(ents));
  for (const e of arr) if (e && !e.dead && !e.removed && e.def && num(e.hp, 1) > 0) out.push(e);
  return out;
}

function damageEntity(e, amount) {
  if (!BR.entities || !has(BR.entities, 'damage')) return false;
  if (BR.entities.authoritative === false) return false;   // 联机客机不结算实体伤害，由房主同步
  return BR.entities.damage(e, amount, 'player');
}

function feetY(p) { return num(p.y, 1.62) - BR.config.player.eyeHeight; }

// 扩散的发光球：爆炸、闪电落点
function burstFx(x, y, z, hex, radius, seconds) {
  if (!BR.effects || !has(BR.effects, 'addFx')) return;
  const T = TH();
  const m = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.MeshBasicMaterial({ color: col(hex), transparent: true, opacity: 0.85, depthWrite: false }));
  m.position.set(x, y + 0.5, z);
  BR.effects.addFx({
    obj: m, seconds: seconds || 0.45,
    tick(o, t) { o.scale.setScalar(0.2 + radius * t); o.material.opacity = 0.85 * (1 - t); },
  });
}

// 折线闪电：从 a 到 b 抖几段
function boltFx(a, b, hex, seconds) {
  if (!BR.effects || !has(BR.effects, 'addFx')) return;
  const T = TH();
  const pts = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === 0 || i === n ? 0 : 0.35;
    pts.push(new T.Vector3(
      U.lerp(a.x, b.x, t) + (Math.random() - 0.5) * j,
      U.lerp(a.y, b.y, t) + (Math.random() - 0.5) * j,
      U.lerp(a.z, b.z, t) + (Math.random() - 0.5) * j));
  }
  const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: col(hex), transparent: true, opacity: 1 }));
  BR.effects.addFx({ obj: line, seconds: seconds || 0.3, tick(o, t) { o.material.opacity = 1 - t; } });
}

BR.itemKit = {
  LORE_HOUR, CRAVING_MUL, CRAVING_KEY,
  rand: Math.random,          // 测试里可替换成固定序列
  num, col, mat, solidMat, glassMat, glowMat, texture, labelMat,
  lathe, cyl, box, sphere, paint, paintByNormal, merge, assemble, tris,
  H, icon,
  apply, hurt, toast, sound, simpleUse, portion,
  throwPoint, livingEntities, damageEntity, feetY, burstFx, boltFx,
};
})();
