// 后室 · 世界：层级载入、区块流式加载/卸载、物品与实体投放、出口触发、换层、光照查询
// 经典 <script>，只往 window.BR 上挂东西。接口见 ARCHITECTURE.md 第 5、12 节
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const U = BR.util;

const DEFAULT_CHUNK = 24;
const DEFAULT_RANGE = 10;       // 灯没填 range 时和 gfx 的默认值一致，lightAt 才与画面亮度对得上
const SAFE_RING = 1;            // 出生区块 Chebyshev 半径 1 内不刷有害实体：开局不能一睁眼就被围
const EXIT_DY = 2.5;            // 出口与脚底高差超过它 = 楼上/楼下的出口，不触发
const FADE_OUT = 0.5;
const FADE_IN = 0.8;
const FADE_ABORT = 0.25;
const TRANSITION_SOUND = { noclip: 'noclip', door: 'door' };
// 切出（noclip）：撕裂音效之外再闪一下白，和普通开门换层区分开
const TRANSITION_FLASH = { noclip: { color: 0xe6f3ff, seconds: 0.45, peak: 0.75 } };

// ---------- 状态 ----------
const S = {
  level: null, id: null, ctx: null,
  size: DEFAULT_CHUNK, chunkArea: DEFAULT_CHUNK * DEFAULT_CHUNK, levelSeed: 0,
  spawn: null, spawnCx: 0, spawnCz: 0,
  centerCx: 0, centerCz: 0, hasCenter: false,
  safeLevel: null,
  maxRange: 0,                  // 已载入灯的最大照射半径，决定 lightAt 要看几圈区块
  lightsDirty: false, lightsPushed: false,
  // start/clear 每次自增：goTo 淡出途中被别人抢先换层或回主页时，靠它发现自己已经过期
  token: 0,
  transition: null,             // 进行中的 goTo Promise
  sealedPrompt: null,           // world 自己挂上的"尚未开放"提示；只清自己挂的，不抢层级的 hud.prompt
};
const chunks = new Map();       // "cx,cz" → chunk
const byNum = new Map();        // 数值 key → chunk：lightAt / 出口检测是高频查询，不每次拼字符串
let queue = [];                 // 待建区块，近的在前
const inside = new Set();       // 玩家此刻站在里面的出口：只在"从外面走进来"那一刻触发
const insideNow = [];
const warned = new Set();
let tickDt = 0;

// ---------- 小工具 ----------
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function arr(v) { return Array.isArray(v) ? v : []; }
function once(key, fn) { if (!warned.has(key)) { warned.add(key); fn(); } }

function chunkKey(cx, cz) { return cx + ',' + cz; }
// 两个 16 位偏移拼成安全整数：|cx| < 32768 个区块，按 24 m 算是 780 km，走不到头
function numKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
function cheb(ax, az, bx, bz) { return Math.max(Math.abs(ax - bx), Math.abs(az - bz)); }
function loadRadius() {
  // 工坊编辑态：把可编辑范围（map.radius 圈区块）一次性全载入，不是围着玩家流式加载
  const w = BR.workshop;
  if (w && w.editing && w.active) return Math.max(0, num(w.active.radius, 3) | 0);
  return Math.max(0, num(BR.config.world && BR.config.world.loadRadius, 2) | 0);
}
function sceneOf() { return (BR.gfx && BR.gfx.scene) || null; }

function isCoopGuest() {
  const c = BR.game.coop;
  if (c && c.active) return c.role === 'guest';
  return !!(BR.coop && BR.coop.active && BR.coop.role === 'guest');
}

// 流式加载围绕的点：玩家；玩家模块缺席（自测）时退回出生点
function focus() {
  const p = BR.player;
  if (p && num(p.x, NaN) === p.x && num(p.z, NaN) === p.z) return p;
  return S.spawn || { x: 0, z: 0 };
}

function validPoint(o) { return !!o && num(o.x, NaN) === o.x && num(o.z, NaN) === o.z; }
function rangeOf(L) { return L.range > 0 ? L.range : DEFAULT_RANGE; }

// ---------- 区块：建 ----------
function buildChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const existing = chunks.get(key);
  if (existing) return existing;

  let res = null;
  try {
    // 几何只吃这一条随机流（第 5 节），联机双方逐字节一致
    res = S.level.buildChunk(S.ctx, cx, cz, U.rng(S.levelSeed, cx, cz));
  } catch (err) {
    // 出错也登记成空区块：否则每帧重试、每帧刷一屏报错
    console.error('[world] buildChunk 出错', S.id, key, err);
  }
  res = res || {};
  const c = {
    key, cx, cz, res,
    group: res.group && res.group.isObject3D ? res.group : null,
    solids: arr(res.solids),        // 全部碰撞体（含道具的），原样不动：debugInfo、tests/golden.mjs 按它统计和挂回
    lights: arr(res.lights).filter(validPoint),
    spawnPoints: arr(res.spawnPoints).filter(validPoint),
    exits: arr(res.exits).filter(e => validPoint(e) && e.to != null),
    tick: typeof res.update === 'function' ? res.update : null,
    props: [],                      // 运行时道具记录（见「道具」一节）；res.kit.props 没有就是空的
  };
  chunks.set(key, c);
  byNum.set(numKey(cx, cz), c);

  const scene = sceneOf();
  if (c.group) {
    if (!c.group.name) c.group.name = 'chunk ' + key;
    if (scene) scene.add(c.group);
  }
  // 碰撞体拆开登记：静态部分仍用区块 key；每件道具、固定设备用自己的碰撞 key（rec.skey，如 '3,-1#p2'），拖动时只换它那几块。
  // 没有道具登记的块，静态部分就是 c.solids 本身，和改动前一样
  const statics = setupProps(c);
  if (statics.length && has(BR.phys, 'addSolids')) BR.phys.addSolids(key, statics);
  placeChunkProps(c);
  for (const L of c.lights) if (rangeOf(L) > S.maxRange) S.maxRange = rangeOf(L);
  if (c.lights.length) S.lightsDirty = true;

  // 容器开合、开关、设备状态按 levelState 重建（BR.containers / BR.devices 在 D1 实现，这里先留调用点）
  applyChunkState(c);
  if (c.spawnPoints.length) {
    spawnItems(c);
    spawnEntities(c);
  }
  return c;
}

function spawnItems(c) {
  if (!has(BR.items, 'spawn')) return;
  if (BR.workshop && BR.workshop.editing) return;   // 编辑态不刷物品
  const pts = c.spawnPoints;
  const used = new Uint8Array(pts.length);
  let free = pts.length;
  // 本局这一层的记录：地上被拿走的不再刷（换层回来不复活），被挪过的刷在新位置
  const st = levelRec();
  for (const entry of arr(S.level.items)) {
    if (!entry || !entry.type || !(entry.per1000m2 > 0) || free <= 0) continue;
    const type = String(entry.type);
    if (!BR.itemTypes.has(type)) {
      once('item:' + type, () => console.warn('[world] 物品类型未注册，跳过：', type));
      continue;
    }
    // 每种物品各派生一条随机流，与几何那条完全分开：调物品密度不会改地形，调一种也不挪另一种
    const rng = U.rng(S.levelSeed, c.cx, c.cz, 'items', type);
    // 所有模式都刷食物和杏仁水，数量不乘 spawnFactor；工坊地图再乘一道 densityMul（未激活时恒为 1，字节不变）
    const wsMul = BR.workshop && typeof BR.workshop.densityMul === 'function' ? BR.workshop.densityMul('items', type) : 1;
    const n = BR.stochasticRound(entry.per1000m2 * S.chunkArea / 1000 * wsMul, rng);
    for (let k = 0; k < n && free > 0; k++) {
      let i = Math.floor(rng() * pts.length);
      while (used[i]) i = (i + 1) % pts.length;   // 被占了就顺延，两件东西不叠在同一个点
      used[i] = 1;
      free--;
      const p = pts[i];
      // id 确定性：联机两边对得上；区块卸载重载后 items.js 靠它拦住已拾取的物品
      const id = S.id + '/' + c.key + '/' + type + '/' + k;
      // 放在抽随机数、占点之后再跳过：拿走一件不会让同块其他物品换位置
      if (st && st.taken.has(id)) continue;
      const at = st ? st.items.get(id) : null;
      if (at) BR.items.spawn(type, at[0], at[1], at[2], { id, chunkKey: c.key });
      else BR.items.spawn(type, p.x, p.y, p.z, { id, chunkKey: c.key });
    }
  }
}

function spawnEntities(c) {
  if (!has(BR.entities, 'spawnForChunk')) return;
  const mode = BR.MODES && BR.MODES[BR.game.mode];
  if (mode && mode.autoSpawn === false) return;   // WAVE2 测试模式：实体只由测试面板手动放
  if (isCoopGuest()) return;                       // 实体只在房主模拟（第 9 节），客机靠快照
  const near = cheb(c.cx, c.cz, S.spawnCx, S.spawnCz) <= SAFE_RING;
  const level = near ? safeLevel() : S.level;
  try {
    BR.entities.spawnForChunk(level, c.key, c.spawnPoints, U.rng(S.levelSeed, c.cx, c.cz, 'entities'));
  } catch (err) {
    console.error('[world] spawnForChunk 出错', c.key, err);
  }
}

// 出生安全区用的派生层级：只覆盖 entities，其余字段走原型链读原层级。
// 未注册的类型也剔掉 —— 不知道阵营就当它可能有害
function safeLevel() {
  if (S.safeLevel) return S.safeLevel;
  const src = S.level;
  const lv = Object.create(src);
  Object.defineProperty(lv, 'entities', {
    value: arr(src.entities).filter(e => {
      const def = e && BR.entityTypes.get(e.type);
      return !!def && def.faction !== 'hostile';
    }),
    enumerable: true,
  });
  S.safeLevel = lv;
  return lv;
}

// ---------- 区块：拆 ----------
// bulk=true 时由 clear() 统一清 phys/items/entities，这里不再逐块清
function unloadChunk(c, bulk) {
  chunks.delete(c.key);
  byNum.delete(numKey(c.cx, c.cz));
  if (c.group) {
    if (c.group.parent) c.group.parent.remove(c.group);
    disposeGroup(c.group);
  }
  if (has(c.res, 'dispose')) {
    try { c.res.dispose(); } catch (err) { console.error('[world] 区块 dispose 出错', c.key, err); }
  }
  unloadChunkState(c);
  dropChunkProps(c, bulk);
  if (!bulk) {
    if (c.solids.length && has(BR.phys, 'removeSolids')) BR.phys.removeSolids(c.key);
    if (has(BR.items, 'removeChunk')) BR.items.removeChunk(c.key);
    if (has(BR.entities, 'removeChunk')) BR.entities.removeChunk(c.key);
    if (decals.length) dropChunkDecals(c.key);
  }
  if (c.lights.length) S.lightsDirty = true;
}

// 只释放区块独有的几何体。材质、贴图默认是全层共享的（assets.material 缓存），拆一块就释放会让其他区块变黑；
// 层级若确实给某块单独建了材质，给它标 userData.chunkOwned，或者跨区块复用的几何标 userData.shared
function disposeGroup(root) {
  const geos = new Set();
  const mats = new Set();
  root.traverse(o => {
    const g = o.geometry;
    if (g && typeof g.dispose === 'function' && !(g.userData && g.userData.shared)) geos.add(g);
    const m = o.material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mm of list) if (mm && mm.userData && mm.userData.chunkOwned) mats.add(mm);
  });
  geos.forEach(g => g.dispose());
  mats.forEach(m => m.dispose());
}

// ---------- 道具（交互方案 A1）：可拖家具的运行时记录、偏移套用、碰撞体切换、准心候选 ----------
// 数据来源是 kit 登记的 res.kit.props[i]：{ n, key, skey, kind, label, solids:[s0, s1)（res.solids 下标，左闭右开，含子道具的）,
//   pivot:{x, y, z, rot}（世界坐标）, obb:{min, max}（枢轴坐标系，只含自己的顶点）, volume（含子道具）, draggable, exitOverlap,
//   why, children:[子道具 key], on, t:{dx, dy, dz, ry}, parts, seats, beds, … }；res.kit.fixtures 是不能拖的固定设备。
// 变换和 kit 一致，是「自己相对父道具」的偏移 t（顶层道具就是相对生成位置）：kit.moveProp(res, rec, t) 写 rec.t，
// 顶点按父链累加（子道具跟着父道具走）。BR.levelState.props 存的就是每件道具自己的 t。A1 只有 dx、dz 生效，dy、ry 只记下。
// 运行时记录里 dx / dz 是累加后的总偏移，x / z 是枢轴现在的世界坐标。
// 父子：kit 按嵌套作用域和 on 连起来（货架和格子里的箱子）。拖父道具时，还放在它上面的子孙（外接盒和父道具的在水平面上重叠）
// 跟着走；已经被拿开、不在它上面的子道具反向补偿，留在原地。
// 碰撞 key：道具和固定设备自己的碰撞体（不含子道具的）在 phys 里用 rec.skey 登记 = key 去掉 '<层级>@'，例如
// 'L1@3,-1#p2' → '3,-1#p2'。phys 的 ignoreKey 两种写法都认，interact 直接传道具 key；raycast 返回碰撞 key，和候选的 skey 比。
// 事件 'prop:moved' { lv, key, keys, dx, dy, dz, dry（这一步的增量）, off（自己的 t）, x, y, z, final, counter? }：
// 每一步只按被拖的那件发一条，keys 是真正跟着动的（它和还放在上面的子孙）；被拿开的子道具另发一条 counter:true、增量取反，
// 按父链跟着走的东西（容器里的物品、打开的盖子）两条一加正好不动。
const PROP_EPS = 1e-6;
const PROP_ON_EPS = 0.01;                 // 子道具外接盒和父道具的水平重叠超过 1 cm 才算还放在上面
// 压着出口圈的道具（kit 标 exitOverlap，多半它自己就是出口，例如 L17 去 Level 18 的床）：和墙、出口一样不出候选
// （孩子定的「出口不能拖」；2026-10-02 返修前给的是灰字「卡住了，挪不动」，说不清原因）。kit 给了 rec.why 的照样显示它
const PROP_BUSY = Object.freeze({ verb: '拖动', ok: false, why: '队友正拿着它' });   // 联机：队友正拖着它（或它的父道具）
const propIndex = new Map();     // 道具 key → 运行时记录（只含已载入区块）
const propList = [];             // 同上，数组形式，每帧遍历不分配
const fixList = [];              // 已载入区块的固定设备（售货机、电脑桌…）：A1 只给准心候选「为什么拖不动」，D1 的 BR.devices 接管后不再出
const PS = { sourceAdded: false };
const DRAG_STALE_MS = 3000;       // 拖动中的标记超过这么久没再挪过就当已经松手（interact 漏了 commit 也不至于一直挡着联机回放和卸块）

function levelRec() {
  const L = BR.levelState;
  return L && typeof L.peek === 'function' && S.id != null ? L.peek(S.id) : null;
}
function editingNow() { return !!(BR.workshop && BR.workshop.editing); }
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function dragLive(P) {
  if (!P.dragging) return false;
  if (nowMs() - P.dragAt > DRAG_STALE_MS) { P.dragging = false; return false; }
  return true;
}
function kitMoveOk() { return !!(BR.kit && typeof BR.kit.moveProp === 'function'); }
function skeyOf(key) { const i = key.indexOf('@'); return i >= 0 ? key.slice(i + 1) : key; }
function tOf(v) {
  if (!v || typeof v !== 'object') return { dx: 0, dy: 0, dz: 0, ry: 0 };
  if (Array.isArray(v)) return v.length === 2 ? { dx: num(v[0], 0), dy: 0, dz: num(v[1], 0), ry: 0 } : { dx: num(v[0], 0), dy: num(v[1], 0), dz: num(v[2], 0), ry: num(v[3], 0) };
  return { dx: num(v.dx, 0), dy: num(v.dy, 0), dz: num(v.dz, 0), ry: num(v.ry, 0) };
}
function tZero(t) { return Math.abs(t.dx) <= PROP_EPS && Math.abs(t.dy) <= PROP_EPS && Math.abs(t.dz) <= PROP_EPS && Math.abs(t.ry) <= PROP_EPS; }
function tSame(a, b) {
  return Math.abs(a.dx - b.dx) <= PROP_EPS && Math.abs(a.dy - b.dy) <= PROP_EPS &&
    Math.abs(a.dz - b.dz) <= PROP_EPS && Math.abs(a.ry - b.ry) <= PROP_EPS;
}

// rec.solids = [s0, s1)；也认 {s0, s1}、rec.s0 / rec.s1
function solidRange(rec, n) {
  let a = null, b = null;
  const s = rec.solids;
  if (Array.isArray(s) && s.length === 2) { a = s[0]; b = s[1]; }
  else if (s && typeof s === 'object' && !Array.isArray(s)) { a = s.s0; b = s.s1; }
  else if (rec.s0 != null) { a = rec.s0; b = rec.s1; }
  a = Math.floor(num(a, NaN)); b = Math.floor(num(b, NaN));
  if (!(a === a) || !(b === b)) return null;
  a = Math.max(0, a); b = Math.min(n, b);
  return b > a ? [a, b] : null;
}
function copyBox(s) { return { minX: s.minX, minY: s.minY, minZ: s.minZ, maxX: s.maxX, maxY: s.maxY, maxZ: s.maxZ }; }
function boxVol(s) { const v = (s.maxX - s.minX) * (s.maxY - s.minY) * (s.maxZ - s.minZ); return v > 0 && isFinite(v) ? v : 0; }

// 建块时：给 kit 的道具记录建运行时记录、按「谁的」分碰撞体（道具、固定设备各用自己的 skey）、连父子；返回静态碰撞体
function setupProps(c) {
  const kit = c.res && c.res.kit;
  const recs = kit && Array.isArray(kit.props) ? kit.props : [];
  const fixes = kit && Array.isArray(kit.fixtures) ? kit.fixtures : [];
  c.fixtureKeys = [];
  c.fixtures = [];
  if (!recs.length && !fixes.length) return c.solids;
  const solids = c.solids;
  const byKey = new Map();
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec || rec.key == null) continue;
    const key = String(rec.key);
    if (byKey.has(key) || propIndex.has(key)) {
      once('dupProp:' + key, () => console.warn('[world] 道具 key 重复，后一件不登记', key));
      continue;
    }
    const P = makeProp(c, rec, key, solids.length);
    byKey.set(key, P);
    c.props.push(P);
  }
  // 认领碰撞体：区间小的（内层）先认领 —— 嵌套作用域里子道具、固定设备的碰撞体归它们自己，和 kit.splitSolids 一致
  const claim = [];
  for (const P of c.props) if (P.range) claim.push({ range: P.range, P, fx: null });
  const fxOwn = [];
  for (const rec of fixes) {
    if (!rec || rec.key == null) continue;
    const range = solidRange(rec, solids.length);
    if (!range) continue;
    const F = { skey: rec.skey != null ? String(rec.skey) : skeyOf(String(rec.key)), solids: [] };
    fxOwn.push(F);
    claim.push({ range, P: null, fx: F });
  }
  claim.sort((a, b) => (a.range[1] - a.range[0]) - (b.range[1] - b.range[0]) || a.range[0] - b.range[0]);
  const owned = new Uint8Array(solids.length);
  for (const cl of claim) {
    for (let s = cl.range[0]; s < cl.range[1]; s++) {
      if (owned[s] || !solids[s]) continue;
      owned[s] = 1;
      if (cl.P) cl.P.solids0.push(copyBox(solids[s]));
      else cl.fx.solids.push(solids[s]);
    }
  }
  const statics = [];
  for (let s = 0; s < solids.length; s++) if (!owned[s]) statics.push(solids[s]);
  // 固定设备不会动：碰撞体按自己的 skey 登记一次（准心对准售货机取货口里的东西时，ignoreKey 才认得出它）
  for (const F of fxOwn) {
    if (!F.solids.length) continue;
    if (has(BR.phys, 'addSolids')) BR.phys.addSolids(F.skey, F.solids);
    c.fixtureKeys.push(F.skey);
  }
  // 准心候选（拖不动的原因；出货的售货机还能取货，取货口里的东西按 levelState 摆出来）
  for (const rec of fixes) {
    const F = makeFixture(c, rec);
    if (!F) continue;
    c.fixtures.push(F); fixList.push(F);
    if (F.vend) { vendCfg.set(F.key, F.vend); vendHook(); vendSync(F, false); }
  }

  // 父子：kit 已经按嵌套和 on 填好 children；on 另外再认一遍（只认同一块里的）
  for (const P of c.props) {
    const rec = P.rec;
    if (!P.parent && typeof rec.on === 'string' && rec.on) {
      const par = parentFromOn(rec.on, byKey);
      if (par && par !== P) link(par, P);
    }
    const kids = Array.isArray(rec.children) ? rec.children : [];
    for (const k of kids) {
      const K = byKey.get(typeof k === 'string' ? k : k && k.key != null ? String(k.key) : '');
      if (K && K !== P) link(P, K);
    }
  }
  for (const P of c.props) {
    // 祖先链（近的在前）：interact 的遮挡判断「命中的碰撞体属于候选自己或父链」直接用它
    P.parentKeys.length = 0;
    for (let A = P.parent, guard = 0; A && guard < 16; A = A.parent, guard++) P.parentKeys.push(A.key);
    propIndex.set(P.key, P);
    propList.push(P);
  }
  return statics;
}

// on = '<父道具 key>' 或 '<父道具 key>#<格位>'：取能对上的最长前缀（同一块里的）
function parentFromOn(on, byKey) {
  if (byKey.has(on)) return byKey.get(on);
  let best = null, bl = 0;
  byKey.forEach((P, k) => {
    if (k.length > bl && on.length > k.length && on.charAt(k.length) === '#' && on.slice(0, k.length) === k) { best = P; bl = k.length; }
  });
  return best;
}

function link(parent, child) {
  if (child.parent === parent) return;
  for (let A = parent, guard = 0; A && guard < 32; A = A.parent, guard++) if (A === child) return;   // 防环
  if (child.parent) {
    const i = child.parent.children.indexOf(child);
    if (i >= 0) child.parent.children.splice(i, 1);
  }
  child.parent = parent;
  child.parentKey = parent.key;
  parent.children.push(child);
}

function makeProp(c, rec, key, nSolids) {
  const pv = rec.pivot || {};
  // kit 给的枢轴是世界坐标；标了 pivotSpace 'local' 的按区块本地坐标算
  const local = rec.pivotSpace === 'local';
  const hasPivot = num(pv.x, NaN) === pv.x && num(pv.z, NaN) === pv.z;
  const base = {
    x: hasPivot ? pv.x + (local ? c.cx * S.size : 0) : NaN,
    y: num(pv.y, 0),
    z: hasPivot ? pv.z + (local ? c.cz * S.size : 0) : NaN,
    rot: num(pv.rot, 0),
  };
  return {
    key,
    skey: rec.skey != null ? String(rec.skey) : skeyOf(key),   // phys 碰撞 key
    kind: rec.kind != null ? String(rec.kind) : 'prop',
    label: rec.label != null && rec.label !== '' ? String(rec.label) : '道具',
    volume: Math.max(0, num(rec.volume, 0)), ownVol: 0,
    draggable: rec.draggable !== false && rec.exitOverlap !== true,
    exitOverlap: rec.exitOverlap === true,
    chunkKey: c.key, chunk: c, res: c.res, rec,
    range: solidRange(rec, nSolids),
    base,
    t: { dx: 0, dy: 0, dz: 0, ry: 0 },     // 自己的偏移（相对父道具），= rec.t = levelState 里存的
    dx: 0, dy: 0, dz: 0, ry: 0,            // 沿父链累加后的总偏移
    x: base.x, y: base.y, z: base.z, rot: base.rot,
    moved: false, dragging: false, dragAt: 0,
    solids0: [], cur: [],
    box: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    obb: null, orot: 0, lc: [0, 0, 0], rad: 0,
    hx: 0, hy: 0, hz: 0,
    parent: null, parentKey: null, on: rec.on != null ? String(rec.on) : null,
    children: [], parentKeys: [],
    cand: null,
  };
}

// 碰撞体分好之后补齐：枢轴兜底、命中用的 OBB、包围半径、自己的体积、候选对象
function finishProp(P) {
  const rec = P.rec;
  let aabb = null, vol = 0;
  for (const s of P.solids0) {
    vol += boxVol(s);
    if (!aabb) aabb = copyBox(s);
    else {
      aabb.minX = Math.min(aabb.minX, s.minX); aabb.minY = Math.min(aabb.minY, s.minY); aabb.minZ = Math.min(aabb.minZ, s.minZ);
      aabb.maxX = Math.max(aabb.maxX, s.maxX); aabb.maxY = Math.max(aabb.maxY, s.maxY); aabb.maxZ = Math.max(aabb.maxZ, s.maxZ);
    }
  }
  if (!(P.base.x === P.base.x) || !(P.base.z === P.base.z)) {
    if (!aabb) return false;   // 没枢轴、没碰撞体：无从定位，不登记
    P.base.x = (aabb.minX + aabb.maxX) / 2;
    P.base.z = (aabb.minZ + aabb.maxZ) / 2;
    P.base.y = aabb.minY;
    P.base.rot = 0;
  }
  const o = rec.obb;
  const okVec = v => Array.isArray(v) && v.length >= 3 && num(v[0], NaN) === v[0] && num(v[1], NaN) === v[1] && num(v[2], NaN) === v[2];
  if (o && okVec(o.min) && okVec(o.max)) {
    P.obb = { min: [o.min[0], o.min[1], o.min[2]], max: [o.max[0], o.max[1], o.max[2]] };
    P.orot = P.base.rot;
  } else if (aabb) {
    // kit 没给 OBB：用碰撞体外接盒当一个不转的 OBB
    P.obb = {
      min: [aabb.minX - P.base.x, aabb.minY - P.base.y, aabb.minZ - P.base.z],
      max: [aabb.maxX - P.base.x, aabb.maxY - P.base.y, aabb.maxZ - P.base.z],
    };
    P.orot = 0;
  }
  if (P.obb) {
    const a = P.obb.min, b = P.obb.max;
    P.lc = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    P.rad = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  }
  // 自己的体积按自己的碰撞体算（kit 的 volume 含子道具）；没碰撞体又没子道具的用 kit 的
  P.ownVol = P.solids0.length ? vol : P.children.length ? 0 : P.volume;
  // 拖不动的：kit 给了原因（rec.why），短按只出这句原因；什么原因都没有的（包括压着出口圈的）不出候选
  const why = P.draggable ? null : rec.why ? String(rec.why) : null;
  P.baseShort = why ? { verb: '拖动', ok: false, why } : null;
  P.cand = {
    kind: 'prop', key: P.key, skey: P.skey, label: P.label, t: 0, small: false,
    short: P.baseShort,
    hold: null, canDrag: false, vol: P.volume, ref: P, parentKeys: P.parentKeys,
  };
  return true;
}

// ---- 固定设备（res.kit.fixtures）：A1 只出准心候选，告诉玩家为什么拖不动（售货机「三百多公斤，拖不动」）。
// 短按的用途（取货、开机…）由 D1 的 BR.devices 实现；它在的时候这里不出候选，免得同一台机器两个候选。
// 例外：kit 登记了 vend.items 的售货机（L7 入口房间那台）已经能取货，见下面「售货机出货」
// 拖不动的原因：只有层级真的画了电线和墙上的插座（kit 登记 cord: true）才说「插着电」——立在屋子中间、看不到线的机器
// 说「插着电」，孩子会问插在哪儿（2026-10-02 返修）。D1 把机器挪到墙边、画出线以后登记 cord，原话就回来了
function fixtureWhy(rec) {
  let w = String(rec.why);
  if (rec.plugged && !rec.cord && w.indexOf('插着电，') === 0) {
    w = w.slice(4);
    if (w === '拖不动') w = rec.kind === 'desk' ? '桌上摆着电脑，拖不动' : '太沉了，拖不动';
  }
  return w;
}
function makeFixture(c, rec) {
  if (!rec || rec.key == null || !rec.why) return null;
  const o = rec.obb, pv = rec.pivot || {};
  const okVec = v => Array.isArray(v) && v.length >= 3 && num(v[0], NaN) === v[0] && num(v[1], NaN) === v[1] && num(v[2], NaN) === v[2];
  if (!o || !okVec(o.min) || !okVec(o.max) || !(num(pv.x, NaN) === pv.x) || !(num(pv.z, NaN) === pv.z)) return null;
  const local = rec.pivotSpace === 'local';
  const F = {
    key: String(rec.key), skey: rec.skey != null ? String(rec.skey) : skeyOf(String(rec.key)), chunkKey: c.key,
    x: pv.x + (local ? c.cx * S.size : 0), y: num(pv.y, 0), z: pv.z + (local ? c.cz * S.size : 0), orot: num(pv.rot, 0),
    obb: { min: [o.min[0], o.min[1], o.min[2]], max: [o.max[0], o.max[1], o.max[2]] },
    hx: 0, hy: 0, hz: 0, rad: 0, cand: null,
  };
  const a = F.obb.min, b = F.obb.max;
  const lx = (a[0] + b[0]) / 2, ly = (a[1] + b[1]) / 2, lz = (a[2] + b[2]) / 2;
  const co = Math.cos(F.orot), si = Math.sin(F.orot);
  F.hx = F.x + co * lx + si * lz; F.hy = F.y + ly; F.hz = F.z - si * lx + co * lz;
  F.rad = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  // 没有短按动作（D1 前）、拖不动：HUD 灰字显示原因；短按一声轻响，长按给出原因。
  // 会出货的售货机：「空格 取货」，冷却中 / 取货口满了是灰字原因（每帧在 fixtureSource 里按 levelState 现算）
  F.vend = vendOf(rec);
  F.vshort = F.vend ? { verb: '取货', ok: true, why: null } : null;
  F.vlast = -1; F.vsig = 0;
  F.cand = {
    kind: 'fixture', key: F.key, solidKey: F.skey, label: rec.label != null ? String(rec.label) : '', t: 0, small: false,
    short: F.vshort, hold: null, canDrag: false, vol: 0, ref: F, parentKeys: [], dragWhy: fixtureWhy(rec),
    onShort: F.vend ? vendPress : null,
  };
  return F;
}
function fixtureSource(ray, reach, out) {
  if (!S.level || !fixList.length || editingNow() || !ray || BR.devices) return;
  const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const R = num(reach, 2.6);
  for (let i = 0; i < fixList.length; i++) {
    const F = fixList[i];
    const cx = F.hx - ox, cy = F.hy - oy, cz = F.hz - oz;
    const lim = R + F.rad;
    if (cx * cx + cy * cy + cz * cz > lim * lim) continue;
    const t = rayObb(F, ox, oy, oz, dx, dy, dz);
    if (t < 0 || t > R) continue;
    F.cand.t = t;
    if (F.vend) vendShortNow(F);
    out.push(F.cand);
  }
}

// ---- 售货机出货（最小实现：2026-10-02 孩子「Level 7 的开始房间得有一个售货机，不然玩家没有食物来源」，从 D1 提前）----
// 只认 kit 登记了 vend.items 的机器（kit.prop.vending 传了 opts.items：展示窗摆的就是这几样，取货口是真开口）；
// L20、L4、Ldev 那几台没传，照旧只有灰字原因，等 D1 的 BR.devices 按台定货。规则照方案「售货机」那条：
//   短按「空格 取货」→ 选货键一声「咔哒」，「咕咚」一件东西掉进取货口，静静躺着（still，owner = 机器 key，不能拖），
//   要准心对准再按一次空格才拿进背包；每台冷却 60 s（vend.cooldown），冷却中、取货口满了（vend.trayMax 件）只「嘟」一声，
//   灰字写「补货中 · 还要 N 秒」/「取货口满了，先把里面的拿走」。出什么按 (层种子, 机器 key, 第几次出货) 在 vend.items 里挑。
// 状态：levelState.uses[机器 key] = { n 出过几次, readyAt 下次能出的时钟（BR.coop.clock()，联机按房主时钟）,
//   tray: [[槽号, 物品 id, 类型], …] 取货口里还躺着的 }。换层回来冷却和取货口里的东西都还在；拿走的（item:taken）从 tray 删掉、不复活。
// 联机（只在游玩模式）：客机 BR.coop.use(key, 'vend') 交房主核对，房主写 levelState 再广播，冷却两人共用；
//   两边都听 'levelstate:set' / 'levelstate:import' 把取货口里的东西摆出来——只加不删：拿走由拾取那条路（pick / picked）收掉。
// D1 的 BR.devices 一出现，fixtures 来源整个让给它，这里也不再出货、不再摆东西
const VEND_USE = 'vend';
const vendCfg = new Map();     // 机器 key → vendOf 的结果：本层见过的出货机器（卸块后也留着，房主替离得远的客机判）
const VS = { coop: null };      // 已经 onUse('vend') 过的 BR.coop 对象
function vendOf(rec) {
  const v = rec && rec.vend;
  if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return null;
  const items = v.items.filter(t => typeof t === 'string' && BR.itemTypes && BR.itemTypes.has(t));
  const okP = q => Array.isArray(q) && q.length >= 3 && num(q[0], NaN) === q[0] && num(q[1], NaN) === q[1] && num(q[2], NaN) === q[2];
  const tray = Array.isArray(v.tray) ? v.tray.filter(okP) : [];
  if (!items.length || !tray.length) return null;
  return { items, tray, cooldown: Math.max(1, num(v.cooldown, 60)), trayMax: U.clamp(num(v.trayMax, 2) | 0, 1, tray.length) };
}
function vendOn() { return !BR.devices && !editingNow(); }
function vendHook() {
  const C = BR.coop;
  if (!C || VS.coop === C || !has(C, 'onUse')) return;
  VS.coop = C;
  try { C.onUse(VEND_USE, vendHandle); } catch (err) { console.error('[world] 售货机注册 onUse 失败', err); }
}
function vendClock() {
  const C = BR.coop;
  if (has(C, 'clock')) {
    try { const t = +C.clock(); if (Number.isFinite(t)) return t; } catch (err) { /* 退回本机时钟 */ }
  }
  return nowMs() / 1000;
}
function vendUse(lv, key) {
  const L = BR.levelState;
  if (!has(L, 'getv') || lv == null) return null;
  let v = null;
  try { v = L.getv(String(lv), 'use', key); } catch (err) { v = null; }
  return v && typeof v === 'object' ? v : null;
}
function vendTray(u) {
  const t = u && Array.isArray(u.tray) ? u.tray : [];
  return t.filter(e => Array.isArray(e) && e.length >= 3 && typeof e[1] === 'string' && typeof e[2] === 'string');
}
// 现在按一下会怎样：null = 能出货；否则是原因（取货口满了优先：等冷却也没用，得先拿走）
function vendWhy(cfg, u, now) {
  if (vendTray(u).length >= cfg.trayMax) return '取货口满了，先把里面的拿走';
  const left = u ? num(u.readyAt, 0) - now : 0;
  if (left > 0) return '补货中 · 还要 ' + Math.max(1, Math.ceil(left - 1e-6)) + ' 秒';
  return null;
}
// 每帧（准心对着它时）：只在「能取 / 满了 / 还要几秒」变了的时候才拼新的原因文字
function vendShortNow(F) {
  const u = vendUse(S.id, F.key), sh = F.vshort;
  const full = vendTray(u).length >= F.vend.trayMax;
  const left = u ? num(u.readyAt, 0) - vendClock() : 0;
  const sig = full ? -1 : left > 0 ? Math.max(1, Math.ceil(left - 1e-6)) : 0;
  if (sig === F.vsig) return;
  F.vsig = sig;
  sh.why = sig === 0 ? null : vendWhy(F.vend, u, vendClock());
  sh.ok = !sh.why;
}
// 房主（和单机）出货：fn({ k, a, p, x, by, lv }) → { ok, why?, r? }（BR.coop.onUse 的处理函数，也直接给单机用）
function vendHandle(req) {
  const key = req && req.k != null ? String(req.k) : '';
  const lv = req && req.lv != null ? String(req.lv) : String(S.id);
  if (!S.level || lv !== String(S.id) || !vendOn()) return { ok: false, why: '不在同一层' };
  const cfg = vendCfg.get(key);
  if (!cfg) return { ok: false, why: '用不了' };
  const u = vendUse(lv, key), now = vendClock();
  const why = vendWhy(cfg, u, now);
  if (why) return { ok: false, why };
  const tray = vendTray(u);
  const n = Math.max(0, num(u && u.n, 0) | 0) + 1;
  const pickR = U.rng(S.levelSeed, key, 'vend', n)();
  const type = cfg.items[Math.min(cfg.items.length - 1, Math.floor(pickR * cfg.items.length))];
  let slot = 0;
  while (slot < cfg.trayMax && tray.some(e => e[0] === slot)) slot++;
  const id = key + '#v' + n;
  const v = Object.assign({}, u || {}, { n, readyAt: now + cfg.cooldown, tray: tray.concat([[slot, id, type]]) });
  if (!has(BR.levelState, 'set') || BR.levelState.set(lv, 'use', key, v) === false) return { ok: false, why: '用不了' };
  return { ok: true, r: { id, type } };
}
function vendDeny(F, why) {
  if (has(BR.audio, 'play')) BR.audio.play('click', undefined, { volume: 0.25, rate: 0.75 });
  if (why && has(BR.hud, 'toast')) BR.hud.toast(why, 1500);
  BR.bus.emit('interact:deny', { kind: 'fixture', key: F.key, why: why || '' });
}
// 准心候选的短按：选货键「咔哒」；结果（单机当场、客机等房主回 ack）不成就「嘟」+ 原因
function vendPress(c) {
  const F = c && c.ref;
  if (!F || !F.vend || !vendOn()) return false;
  vendHook();
  if (has(BR.audio, 'play')) BR.audio.play('click', { x: F.hx, y: F.hy, z: F.hz }, { volume: 0.5, rate: 1.25 });
  const done = res => { if (!res || !res.ok) vendDeny(F, res && res.why ? String(res.why) : '用不了'); };
  const C = BR.coop;
  if (has(C, 'use') && VS.coop === C) {
    const res = C.use(F.key, VEND_USE, [F.hx, F.hy, F.hz], done);
    return res === null ? true : !!(res && res.ok);
  }
  const res = vendHandle({ k: F.key, a: VEND_USE, lv: S.id, by: 'me' });
  done(res);
  return !!res.ok;
}
// 取货口里的东西按 levelState 摆出来（只加不删）。sound = 新出了一件时在机器那儿「咕咚」一声
function vendSync(F, sound) {
  if (!F || !F.vend || !vendOn() || !has(BR.items, 'spawn')) return;
  const u = vendUse(S.id, F.key);
  const n = u ? num(u.n, 0) | 0 : 0;
  if (sound && F.vlast >= 0 && n > F.vlast && has(BR.audio, 'play')) {
    const at = { x: F.hx, y: F.y + 0.3, z: F.hz };
    setTimeout(() => { if (BR.audio) BR.audio.play('step', at, { volume: 0.9, rate: 0.42 }); }, 260);
  }
  F.vlast = n;
  const co = Math.cos(F.orot), si = Math.sin(F.orot);
  for (const e of vendTray(u)) {
    const id = e[1];
    if ((has(BR.items, 'find') && BR.items.find(id)) || (has(BR.items, 'wasTaken') && BR.items.wasTaken(id))) continue;
    if (!BR.itemTypes || !BR.itemTypes.has(e[2])) continue;
    const q = F.vend.tray[U.clamp(num(e[0], 0) | 0, 0, F.vend.tray.length - 1)];
    BR.items.spawn(e[2], F.x + co * q[0] + si * q[2], F.y + q[1], F.z - si * q[0] + co * q[2],
      { id, chunkKey: F.chunkKey, still: true, owner: F.key });
  }
}
function vendFixture(key) {
  for (let i = 0; i < fixList.length; i++) if (fixList[i].key === key && fixList[i].vend) return fixList[i];
  return null;
}
// 取货口里的东西被拿走（自己、或房主替客机拿）：从 tray 里删掉，换层回来不复活。客机不写，等房主广播
function onVendTaken(e) {
  if (!e || e.owner == null || !S.level || !vendCfg.has(String(e.owner)) || isCoopGuest() || !vendOn()) return;
  const key = String(e.owner), u = vendUse(S.id, key);
  const tray = vendTray(u), keep = tray.filter(x => x[1] !== String(e.id));
  if (keep.length === tray.length || !has(BR.levelState, 'set')) return;
  BR.levelState.set(S.id, 'use', key, Object.assign({}, u, { tray: keep }));
}

// 联机：队友正拖着这件道具或它的父道具
function peerHolds(P) {
  const C = BR.coop;
  if (!C || !C.active || typeof C.leaseOf !== 'function') return false;
  try {
    if (C.leaseOf('p:' + P.key) === 'peer') return true;
    for (let i = 0; i < P.parentKeys.length; i++) if (C.leaseOf('p:' + P.parentKeys[i]) === 'peer') return true;
  } catch (err) { return false; }
  return false;
}

// 按父链重算总偏移，摆位置、碰撞体、外接盒（不动顶点，顶点由 kitMove 刷）
function placeProp(P) {
  const par = P.parent;
  P.dx = P.t.dx + (par ? par.dx : 0); P.dy = P.t.dy + (par ? par.dy : 0);
  P.dz = P.t.dz + (par ? par.dz : 0); P.ry = P.t.ry + (par ? par.ry : 0);
  // A1 只有水平平移生效（kit 也一样）：dy、ry 记着，不进位置
  P.x = P.base.x + P.dx; P.y = P.base.y; P.z = P.base.z + P.dz; P.rot = P.base.rot;
  P.moved = Math.abs(P.dx) > PROP_EPS || Math.abs(P.dz) > PROP_EPS;
  const b = P.box, dx = P.dx, dz = P.dz;
  if (P.solids0.length) {
    P.cur.length = P.solids0.length;
    b.minX = b.minY = b.minZ = Infinity; b.maxX = b.maxY = b.maxZ = -Infinity;
    for (let i = 0; i < P.solids0.length; i++) {
      const s = P.solids0[i];
      const t = P.cur[i] || (P.cur[i] = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
      t.minX = s.minX + dx; t.minY = s.minY; t.minZ = s.minZ + dz;
      t.maxX = s.maxX + dx; t.maxY = s.maxY; t.maxZ = s.maxZ + dz;
      if (t.minX < b.minX) b.minX = t.minX; if (t.minY < b.minY) b.minY = t.minY; if (t.minZ < b.minZ) b.minZ = t.minZ;
      if (t.maxX > b.maxX) b.maxX = t.maxX; if (t.maxY > b.maxY) b.maxY = t.maxY; if (t.maxZ > b.maxZ) b.maxZ = t.maxZ;
    }
    // 同一个 key 再登记会先摘掉旧的：碰撞体整组换到新位置
    if (has(BR.phys, 'addSolids')) BR.phys.addSolids(P.skey, P.cur);
  } else if (P.obb) {
    obbBounds(P, b);
  } else {
    b.minX = b.maxX = P.x; b.minY = b.maxY = P.y; b.minZ = b.maxZ = P.z;
  }
  if (P.obb) {
    const co = Math.cos(P.orot), si = Math.sin(P.orot), lx = P.lc[0], lz = P.lc[2];
    P.hx = P.x + co * lx + si * lz;
    P.hy = P.y + P.lc[1];
    P.hz = P.z - si * lx + co * lz;
  }
}
// 子树（先父后子）全部重摆
function placeTree(P, depth) {
  placeProp(P);
  if ((depth | 0) > 16) return;
  for (let i = 0; i < P.children.length; i++) placeTree(P.children[i], (depth | 0) + 1);
}

// OBB 转到世界后的外接盒（没有碰撞体的道具用它当占地）
function obbBounds(P, b) {
  const co = Math.cos(P.orot), si = Math.sin(P.orot);
  const a = P.obb.min, m = P.obb.max;
  b.minX = b.minZ = Infinity; b.maxX = b.maxZ = -Infinity;
  for (let k = 0; k < 4; k++) {
    const lx = k & 1 ? m[0] : a[0], lz = k & 2 ? m[2] : a[2];
    const wx = P.x + co * lx + si * lz, wz = P.z - si * lx + co * lz;
    if (wx < b.minX) b.minX = wx; if (wx > b.maxX) b.maxX = wx;
    if (wz < b.minZ) b.minZ = wz; if (wz > b.maxZ) b.maxZ = wz;
  }
  b.minY = P.y + a[1]; b.maxY = P.y + m[1];
}

// 顶点：kit.moveProp 写 rec.t 并按父链重写这件和它子树的顶点
function kitMove(P) {
  if (!kitMoveOk()) return;
  try { BR.kit.moveProp(P.res, P.rec, { dx: P.t.dx, dy: P.t.dy, dz: P.t.dz, ry: P.t.ry }); }
  catch (err) { once('moveProp:' + P.key, () => console.error('[world] kit.moveProp 出错', P.key, err)); }
  // 道具作用域里带灯的（kit 自带的可拖构件都不带，层级自己包的可能带）：kit 已经改了灯描述的 x/z，重排动态灯
  if (P.lit === undefined) P.lit = !!(BR.kit && typeof BR.kit.propHasLights === 'function' && BR.kit.propHasLights(P.rec));
  if (P.lit) S.lightsDirty = true;
}
// 松手 / 套用完：kit 重算包围球、恢复视锥裁剪（settleProp 自己会带上子树）
function kitSettle(P) {
  if (!BR.kit || typeof BR.kit.settleProp !== 'function') return;
  try { BR.kit.settleProp(P.rec); }
  catch (err) { once('settleProp:' + P.key, () => console.error('[world] kit.settleProp 出错', P.key, err)); }
}

// 子道具还放在父道具上没有：两者外接盒在水平面上重叠超过 1 cm（没有大小的子道具：枢轴落在父道具外接盒里）
function restsOn(C, P) {
  const a = C.box, b = P.box;
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (a.maxX - a.minX <= PROP_EPS || a.maxZ - a.minZ <= PROP_EPS) return ox >= 0 && oz >= 0;
  return ox > PROP_ON_EPS && oz > PROP_ON_EPS;
}
// 拖 P 时的分组（按挪之前的位置）：moving = P 和还放在它上面的子孙；stay = 已经拿开的子道具（它们的子树跟着它们不动）
function groupOf(P, moving, stay) {
  moving.push(P);
  const walk = (N, depth) => {
    if (depth > 16) return;
    for (let i = 0; i < N.children.length; i++) {
      const C = N.children[i];
      if (restsOn(C, N)) { moving.push(C); walk(C, depth + 1); }
      else if (stay) stay.push(C);
    }
  };
  walk(P, 0);
}

// 建块：所有道具登记碰撞体；levelState 里记过偏移的，套上偏移、刷顶点（不播动画）
function placeChunkProps(c) {
  if (!c.props.length) return;
  const st = editingNow() ? null : levelRec();
  const canMove = kitMoveOk();
  const live = [];
  for (const P of c.props) {
    if (!finishProp(P)) { dropProp(P, false); continue; }
    live.push(P);
    const v = canMove && st ? st.props.get(P.key) : null;
    if (v) { const t = tOf(v); P.t.dx = t.dx; P.t.dy = t.dy; P.t.dz = t.dz; P.t.ry = t.ry; }
  }
  c.props = live;
  const roots = live.filter(P => !P.parent);
  for (const R of roots) placeTree(R, 0);
  // 顶点：先父后子把每件记过偏移的写一遍（kit 按父链累加）；最后从根 settle
  for (const R of roots) {
    let any = false;
    const walk = (N, depth) => {
      if (!tZero(N.t)) { kitMove(N); any = true; }
      if (depth < 16) for (const C of N.children) walk(C, depth + 1);
    };
    walk(R, 0);
    if (any) kitSettle(R);
  }
}

function dropProp(P, bulk) {
  if (propIndex.get(P.key) === P) propIndex.delete(P.key);
  const i = propList.indexOf(P);
  if (i >= 0) { propList[i] = propList[propList.length - 1]; propList.pop(); }
  if (!bulk && P.solids0.length && has(BR.phys, 'removeSolids')) BR.phys.removeSolids(P.skey);
  P.dragging = false;
}
function dropChunkProps(c, bulk) {
  if (c.props && c.props.length) for (const P of c.props) dropProp(P, bulk);
  c.props = [];
  if (c.fixtures && c.fixtures.length) {
    for (const F of c.fixtures) { const i = fixList.indexOf(F); if (i >= 0) { fixList[i] = fixList[fixList.length - 1]; fixList.pop(); } }
  }
  c.fixtures = [];
  if (!bulk && c.fixtureKeys && has(BR.phys, 'removeSolids')) for (const k of c.fixtureKeys) BR.phys.removeSolids(k);
  c.fixtureKeys = [];
}

// 保活：有正被拖的道具，或被挪过、现在位置离中心 ≤ lim 块的道具
function keepChunk(c, cx, cz, lim) {
  const ps = c.props;
  if (!ps || !ps.length) return false;
  for (let i = 0; i < ps.length; i++) {
    const P = ps[i];
    if (dragLive(P)) return true;
    if (P.moved && cheb(Math.floor(P.x / S.size), Math.floor(P.z / S.size), cx, cz) <= lim) return true;
  }
  return false;
}

// 把 P 的枢轴挪到总偏移 (effDx, effDz)：放在它上面的子孙一起走，拿开的子道具原地不动。
// final = 松手 / 定格：settle、把这棵子树里变了的 t 写进 levelState（回原位的删掉）
function shiftProp(P, effDx, effDz, final, src) {
  const ddx = effDx - P.dx, ddz = effDz - P.dz;
  const changed = Math.abs(ddx) > PROP_EPS || Math.abs(ddz) > PROP_EPS;
  if (!changed && !final) return false;
  const moving = [], stay = [];
  groupOf(P, moving, stay);
  if (changed) {
    P.t.dx += ddx; P.t.dz += ddz;
    for (const C of stay) { C.t.dx -= ddx; C.t.dz -= ddz; }
    for (const N of moving) placeProp(N);       // 先父后子：总偏移按父链重算；stay 的总偏移不变，不用重摆
    kitMove(P);
    for (const C of stay) kitMove(C);
  }
  if (final) {
    for (const N of moving) N.dragging = false;
    kitSettle(P);
    writeTreeState(P, src);
  }
  BR.bus.emit('prop:moved', {
    lv: S.id, key: P.key, keys: moving.map(N => N.key),
    dx: ddx, dy: 0, dz: ddz, dry: 0,
    off: { dx: P.t.dx, dy: P.t.dy, dz: P.t.dz, ry: P.t.ry },
    x: P.x, y: P.y, z: P.z, final: !!final,
  });
  if (changed) {
    for (const C of stay) {
      BR.bus.emit('prop:moved', {
        lv: S.id, key: C.key, keys: [], dx: -ddx, dy: 0, dz: -ddz, dry: 0,
        off: { dx: C.t.dx, dy: C.t.dy, dz: C.t.dz, ry: C.t.ry },
        x: C.x, y: C.y, z: C.z, final: !!final, counter: true,
      });
    }
  }
  return changed;
}
// 子树里每件的 t 和 levelState 里记的不一样就写（0 偏移删条目）
function writeTreeState(P, src) {
  const L = BR.levelState;
  if (!L || typeof L.set !== 'function' || S.id == null) return;
  const meta = src ? { src } : undefined;
  const walk = (N, depth) => {
    const old = typeof L.getv === 'function' ? L.getv(S.id, 'prop', N.key) : undefined;
    const zero = tZero(N.t);
    if (zero ? old !== undefined : !(old && tSame(tOf(old), N.t))) {
      L.set(S.id, 'prop', N.key, zero ? null : { dx: N.t.dx, dy: N.t.dy, dz: N.t.dz, ry: N.t.ry }, meta);
    }
    if (depth < 16) for (const C of N.children) walk(C, depth + 1);
  };
  walk(P, 0);
}

// ---- 公开：查询 ----
function propByKey(key) { return key == null ? null : propIndex.get(String(key)) || null; }
// 当前位置（外接盒）离 (x, z) 水平距离 ≤ r 的道具，写进 out（先清空）
function propsNear(x, z, r, out) {
  out = Array.isArray(out) ? out : [];
  out.length = 0;
  const r2 = r === Infinity ? Infinity : num(r, 0) * num(r, 0);
  for (let i = 0; i < propList.length; i++) {
    const P = propList[i], b = P.box;
    const ex = Math.max(b.minX - x, 0, x - b.maxX), ez = Math.max(b.minZ - z, 0, z - b.maxZ);
    if (ex * ex + ez * ez <= r2) out.push(P);
  }
  return out;
}
// 拖这件道具时 phys.moveBox 要忽略的碰撞 key：它自己和还放在它上面的子孙（道具 key；phys 两种写法都认）
function dragKeys(key) {
  const P = propByKey(key);
  if (!P) return [];
  const moving = [];
  groupOf(P, moving, null);
  return moving.map(N => N.key);
}
// 这件道具连同放在上面的子孙，当前的世界外接盒（拖动时的占地）
function propBox(key, out) {
  const P = propByKey(key);
  if (!P) return null;
  const b = out || {};
  b.minX = b.minY = b.minZ = Infinity; b.maxX = b.maxY = b.maxZ = -Infinity;
  const moving = [];
  groupOf(P, moving, null);
  for (const K of moving) {
    const k = K.box;
    if (!(k.minX <= k.maxX)) continue;
    if (k.minX < b.minX) b.minX = k.minX; if (k.minY < b.minY) b.minY = k.minY; if (k.minZ < b.minZ) b.minZ = k.minZ;
    if (k.maxX > b.maxX) b.maxX = k.maxX; if (k.maxY > b.maxY) b.maxY = k.maxY; if (k.maxZ > b.maxZ) b.maxZ = k.maxZ;
  }
  return b.minX <= b.maxX ? b : null;
}

// ---- 公开：拖动 ----
// movePropTo(key, x, z)：拖动中每帧调，(x, z) 是枢轴的新世界坐标；也认 (key, {x, z}) 或 (key, {dx, dz})（总偏移）
function movePropTo(key, x, z) {
  const P = propByKey(key);
  if (!P || !S.level || !kitMoveOk()) return false;
  let ex, ez;
  if (x && typeof x === 'object') {
    if (num(x.dx, NaN) === x.dx || num(x.dz, NaN) === x.dz) { ex = num(x.dx, P.dx); ez = num(x.dz, P.dz); }
    else { ex = num(x.x, P.x) - P.base.x; ez = num(x.z, P.z) - P.base.z; }
  } else {
    if (!(num(x, NaN) === x && num(z, NaN) === z)) return false;
    ex = x - P.base.x; ez = z - P.base.z;
  }
  const moving = [];
  groupOf(P, moving, null);
  const t = nowMs();
  // 这一次拖动从哪儿开始：松手时压着的地上物资优先挪到前进方向那一侧（和单机边拖边推的结果一致）
  if (!dragLive(P) || !P.dragFrom) P.dragFrom = [P.dx, P.dz];
  for (const N of moving) { N.dragging = true; N.dragAt = t; }
  shiftProp(P, ex, ez, false, null);
  return true;
}
// commitProp(key)：松手（或被取消、原地放下）时调：settle，写 levelState（回到原位就删掉那条）；
// 再把压在它（连同上面的子孙）占地里的地上物资挪到旁边最近的空地——客机拖的由房主在这里裁决，挪动经 levelState 广播
function commitProp(key, src) {
  const P = propByKey(key);
  if (!P) return false;
  const from = P.dragFrom;
  P.dragFrom = null;
  shiftProp(P, P.dx, P.dz, true, src || null);
  clearItemsUnder(P, from ? P.dx - from[0] : 0, from ? P.dz - from[1] : 0);
  return true;
}

// ---- 道具压住的地上物资（木箱被推到一瓶杏仁水上面）：挪到最近的空地，不让东西被「吞掉」 ----
function groundAtXZ(x, z) {
  if (!has(BR.phys, 'groundY')) return 0;
  const g = +BR.phys.groundY(x, z);
  return Number.isFinite(g) ? g : 0;
}
function inBox(b, x, z, r) {
  const qx = U.clamp(x, b.minX, b.maxX), qz = U.clamp(z, b.minZ, b.maxZ);
  return U.dist2(qx, qz, x, z) < r * r;
}
function nearExit(x, z, r) {
  let hit = false;
  chunks.forEach(c => {
    for (let i = 0; !hit && i < c.exits.length; i++) {
      const e = c.exits[i];
      if (e.active === false) continue;
      const R = num(e.radius, 1) + r;
      if (U.dist2(e.x, e.z, x, z) < R * R) hit = true;
    }
  });
  return hit;
}
// (fx, fz)：道具这次拖动的总位移。拖得够远（> 5 cm）时先试前进方向那一侧——联机客机拖木箱压过瓶子，房主在松手时才挪，
// 以前挑「挪得最少」的一侧，瓶子常从箱子来的方向冒出来；单机是边拖边往前推（2026-10-02 返修）
function freeSpot(p, b, r, g, h, fx, fz) {
  const ok = (x, z) => !inBox(b, x, z, r) && Math.abs(groundAtXZ(x, z) - g) <= 0.2 && !nearExit(x, z, r) &&
    !(has(BR.phys, 'overlapCircle') && BR.phys.overlapCircle(x, z, r, g + 0.02, h));
  // 先试四条边正外侧（挪得最少），再一圈圈往外找
  const sides = [[b.minX - r - 0.02, p.z, -1, 0], [b.maxX + r + 0.02, p.z, 1, 0], [p.x, b.minZ - r - 0.02, 0, -1], [p.x, b.maxZ + r + 0.02, 0, 1]];
  sides.sort((u, v) => U.dist2(u[0], u[1], p.x, p.z) - U.dist2(v[0], v[1], p.x, p.z));
  const fl = Math.hypot(num(fx, 0), num(fz, 0));
  if (fl > 0.05) {
    let best = null, bd = 0.5;
    for (const q of sides) { const d = (q[2] * fx + q[3] * fz) / fl; if (d > bd) { bd = d; best = q; } }
    if (best && ok(best[0], best[1])) return [best[0], best[1]];
  }
  for (const q of sides) if (ok(q[0], q[1])) return [q[0], q[1]];
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const R0 = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + r + 0.02;
  for (let d = R0; d <= R0 + 1.5; d += 0.15) {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (ok(x, z)) return [x, z];
    }
  }
  return null;
}
function clearItemsUnder(P, fx, fz) {
  const I = BR.items;
  if (!I || !Array.isArray(I.list) || !I.list.length || !has(I, 'move')) return 0;
  const b = propBox(P.key);
  if (!b) return 0;
  let n = 0;
  const list = I.list.slice();
  for (const p of list) {
    if (!p || p.owner || p.held) continue;
    const g = groundAtXZ(p.x, p.z);
    if (Math.abs(num(p.y, g) - g) > 0.05) continue;                 // 只管放在地上的
    const h = Math.max(0.1, num(p.hh, 0.1) * 2);
    if (p.y > b.maxY || p.y + h < b.minY) continue;
    const r = Math.max(0.04, num(p.r, 0.1) * 0.8);
    if (!inBox(b, p.x, p.z, r * 0.75)) continue;                    // 只是擦边的不动
    const q = freeSpot(p, b, r, g, h, fx, fz);
    if (!q) continue;
    I.move(p.id, q[0], undefined, q[1]);
    n++;
  }
  return n;
}
// applyProp(key, v)：把一条 levelState 值（这件自己的 t：{dx, dy, dz, ry}，null = 回原位）直接摆到已载入的道具上，
// 当作已经放稳（联机回放用；不看本机是不是正拖着）。没载入返回 false，等建块时按 levelState 自己套用
function applyProp(key, v, src) {
  const P = propByKey(key);
  if (!P || !S.level || !kitMoveOk()) return false;
  const t = tOf(v);
  P.t.dy = t.dy; P.t.ry = t.ry;
  const par = P.parent;
  shiftProp(P, t.dx + (par ? par.dx : 0), t.dz + (par ? par.dz : 0), true, src || 'net');
  return true;
}

// ---- 准心候选（BR.interact.addSource('props')） ----
// 射线和 OBB（枢轴坐标系、绕 Y 转 orot）求交，返回进入距离（起点在盒里为 0）；不相交返回 -1。每帧调用，不分配
const RS = { t0: 0, t1: 0 };
function slab(o, d, lo, hi) {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let ta = (lo - o) / d, tb = (hi - o) / d;
  if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
  if (ta > RS.t0) RS.t0 = ta;
  if (tb < RS.t1) RS.t1 = tb;
  return RS.t0 <= RS.t1;
}
function rayObb(P, ox, oy, oz, dx, dy, dz) {
  const co = Math.cos(P.orot), si = Math.sin(P.orot);
  const wx = ox - P.x, wy = oy - P.y, wz = oz - P.z;
  // 世界 → 本地：kit 的本地 → 世界是 x' = c·x + s·z、z' = −s·x + c·z，反过来是 x = c·x' − s·z'、z = s·x' + c·z'
  const a = P.obb.min, b = P.obb.max;
  RS.t0 = 0; RS.t1 = Infinity;
  if (!slab(co * wx - si * wz, co * dx - si * dz, a[0], b[0])) return -1;
  if (!slab(wy, dy, a[1], b[1])) return -1;
  if (!slab(si * wx + co * wz, si * dx + co * dz, a[2], b[2])) return -1;
  return RS.t0;
}

const candGroup = [];
function propSource(ray, reach, out) {
  if (!S.level || !propList.length || editingNow() || !ray) return;
  const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const R = num(reach, 2.6);
  const movable = kitMoveOk();
  for (let i = 0; i < propList.length; i++) {
    const P = propList[i];
    if (!P.obb || !P.cand) continue;
    const cx = P.hx - ox, cy = P.hy - oy, cz = P.hz - oz;
    const lim = R + P.rad;
    if (cx * cx + cy * cy + cz * cz > lim * lim) continue;
    const t = rayObb(P, ox, oy, oz, dx, dy, dz);
    if (t < 0 || t > R) continue;
    const cd = P.cand;
    // 队友正拖着：和物资、测试人一样，一对准就灰字「队友正拿着它」，不能拖
    const busy = P.draggable && movable && peerHolds(P);
    cd.short = busy ? PROP_BUSY : P.baseShort;
    cd.canDrag = P.draggable && movable && !busy;
    if (!cd.canDrag && !cd.short) continue;   // 什么都做不了、也没有原因可说的，不出提示
    cd.t = t;
    // 体积按真正会一起动的算：它自己 + 还放在它上面的子孙（越重越慢）
    let vol = P.ownVol;
    if (P.children.length) {
      candGroup.length = 0;
      groupOf(P, candGroup, null);
      for (let k = 1; k < candGroup.length; k++) vol += candGroup[k].ownVol;
      candGroup.length = 0;
    }
    cd.vol = vol;
    out.push(cd);
  }
}

function ensurePropSource() {
  if (PS.sourceAdded || !BR.interact || typeof BR.interact.addSource !== 'function') return;
  PS.sourceAdded = true;
  try { BR.interact.addSource('props', propSource); BR.interact.addSource('fixtures', fixtureSource); }
  catch (err) { console.error('[world] 注册道具候选来源失败', err); }
}

// ---- levelState 变化：联机房主广播、客机回放、别的模块直接写的，套到已载入的区块上 ----
function onLevelStateSet(p) {
  if (!p || !S.level || p.lv == null || String(p.lv) !== String(S.id) || editingNow()) return;
  if (p.kind === 'prop') {
    const P = propByKey(p.key);
    if (!P || dragLive(P) || !kitMoveOk()) return;   // 本机正拖着的以本机为准，松手时再由房主裁决
    const t = tOf(p.v);
    if (tSame(t, P.t)) return;   // commitProp 自己写的那条会回到这里：已经在位，不再重刷
    applyProp(P.key, t, p.src || null);
  } else if (p.kind === 'taken') {
    if (p.v && has(BR.items, 'find') && BR.items.find(p.key) && has(BR.items, 'remove')) BR.items.remove(p.key);
  } else if (p.kind === 'use') {
    vendSync(vendFixture(String(p.key)), true);   // 售货机出了一件（自己、房主、或房主替客机出的）：摆进取货口
  }
  // kind 'item'：items.js 自己听 'levelstate:set' 回放位置，这里不重复处理
}

// 整层导入（客机收到房主的 st）：已载入的道具、物资按新记录重摆；容器 / 设备由各自模块监听 'levelstate:import'
function onLevelStateImport(p) {
  if (!p || !S.level || String(p.lv) !== String(S.id) || editingNow()) return;
  const st = levelRec();
  if (kitMoveOk()) {
    const touched = [];
    for (const P of propList) {
      if (dragLive(P)) continue;
      const t = tOf(st ? st.props.get(P.key) : null);
      if (tSame(t, P.t)) continue;
      P.t.dx = t.dx; P.t.dy = t.dy; P.t.dz = t.dz; P.t.ry = t.ry;
      touched.push(P);
    }
    const roots = [];
    for (const P of touched) {
      let R = P;
      for (let g = 0; R.parent && g < 16; g++) R = R.parent;
      if (roots.indexOf(R) < 0) roots.push(R);
    }
    for (const R of roots) {
      const ox = R.x, oz = R.z;
      placeTree(R, 0);
      const walk = (N, depth) => { if (touched.indexOf(N) >= 0) kitMove(N); if (depth < 16) for (const C of N.children) walk(C, depth + 1); };
      walk(R, 0);
      kitSettle(R);
      BR.bus.emit('prop:moved', { lv: S.id, key: R.key, keys: [R.key], dx: R.x - ox, dy: 0, dz: R.z - oz, dry: 0, off: { dx: R.t.dx, dy: R.t.dy, dz: R.t.dz, ry: R.t.ry }, x: R.x, y: R.y, z: R.z, final: true, import: true });
    }
  }
  if (st && has(BR.items, 'find')) {
    st.taken.forEach(id => { if (BR.items.find(id) && has(BR.items, 'remove')) BR.items.remove(id); });
    if (has(BR.items, 'move')) st.items.forEach((v, id) => { if (BR.items.find(id)) BR.items.move(id, v[0], v[1], v[2]); });
  }
  for (let i = 0; i < fixList.length; i++) if (fixList[i].vend) vendSync(fixList[i], false);
}

// ---- 容器、开关、设备：建块后按 levelState 重建、卸块时收尾（D1 实现 BR.containers / BR.devices） ----
// 约定：applyChunk(c, st) 必须可重复调用（幂等）；st 为 null 表示本层没有记录（或工坊编辑态）
function applyChunkState(c) {
  const st = editingNow() ? null : levelRec();
  const mods = ['containers', 'devices'];
  for (const m of mods) {
    const mod = BR[m];
    if (!has(mod, 'applyChunk')) continue;
    try { mod.applyChunk(c, st); }
    catch (err) { once('apply:' + m + ':' + S.id, () => console.error('[world] ' + m + '.applyChunk 出错', c.key, err)); }
  }
}
function unloadChunkState(c) {
  const mods = ['containers', 'devices'];
  for (const m of mods) {
    const mod = BR[m];
    if (!has(mod, 'unloadChunk')) continue;
    try { mod.unloadChunk(c); }
    catch (err) { once('unload:' + m + ':' + S.id, () => console.error('[world] ' + m + '.unloadChunk 出错', c.key, err)); }
  }
}

function clearProps() {
  propIndex.clear();
  propList.length = 0;
  fixList.length = 0;
  vendCfg.clear();
}

// ---------- 贴花（ENGINE_PLAN M1 AA）：墨迹、腐蚀痕这类贴地斑块 ----------
// 纯表现、不同步：各端按实体位置本地生成。全场 1 个 InstancedMesh（1 个 draw call），高画质 ≤64、低画质 ≤32 块，
// 满了挤掉最老的（环形缓冲）；每块记所属区块，区块卸载时一起清掉，换层 / 回主页全清。
// 网格不挂进 chunk.group：区块几何（golden 哈希的内容）不变，disposeGroup 也不会把共用的贴花几何释放掉
const DECAL_CAP = { high: 64, low: 32 };
const DECAL_FADE = 0.2;          // 寿命最后 20% 缩小消失：实例化网格没有逐块透明度，用缩放代替
const decals = [];               // 按生成先后排：{ key, x, y, z, r, rot, color, born, ttl }
const DC = { mesh: null, time: 0, mat4: null, quat: null, pos: null, scl: null, col: null, up: null };

function decalCap() { const s = BR.game.settings; return s && s.quality === 'low' ? DECAL_CAP.low : DECAL_CAP.high; }

function decalMesh() {
  if (DC.mesh || !THREE) return DC.mesh;
  // 不规则圆斑，半径 1（按实例缩放）；轮廓用固定种子，不走 Math.random
  const rnd = U.mulberry32(U.hashStr('world-decal'));
  const n = 16, radii = [];
  for (let i = 0; i < n; i++) radii.push(0.72 + 0.28 * rnd());
  const shape = new THREE.Shape();
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, rr = radii[i % n];
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const geo = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2);
  // polygonOffset + 抬高 1.2 cm：贴着地板不打架；depthWrite 关掉，半透明斑块叠在一起不互相挖洞
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(geo, mat, DECAL_CAP.high);
  // 实例颜色缓冲一开始就建好：第一次渲染时没有它，编出来的着色器就不带实例颜色
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_CAP.high * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;    // 包围球只按一块算，散在几个区块里会被误裁掉
  mesh.renderOrder = 1;
  mesh.name = 'world decals';
  DC.mesh = mesh;
  DC.mat4 = new THREE.Matrix4();
  DC.quat = new THREE.Quaternion();
  DC.pos = new THREE.Vector3();
  DC.scl = new THREE.Vector3();
  DC.col = new THREE.Color();
  DC.up = new THREE.Vector3(0, 1, 0);
  return mesh;
}

// 按 decals 重写实例矩阵和颜色；返回是否有正在缩小消失的
function writeDecals() {
  const m = DC.mesh;
  if (!m) return false;
  const cap = decalCap();
  if (decals.length > cap) decals.splice(0, decals.length - cap);   // 刚切到低画质：挤掉最老的
  let fading = false;
  for (let i = 0; i < decals.length; i++) {
    const d = decals[i], k = (DC.time - d.born) / d.ttl;
    let s = d.r;
    if (k > 1 - DECAL_FADE) { s *= Math.max(0.001, (1 - k) / DECAL_FADE); fading = true; }
    DC.quat.setFromAxisAngle(DC.up, d.rot);
    DC.pos.set(d.x, d.y, d.z);
    DC.scl.set(s, 1, s);
    m.setMatrixAt(i, DC.mat4.compose(DC.pos, DC.quat, DC.scl));
    m.setColorAt(i, DC.col.setHex(d.color));
  }
  m.count = decals.length;
  m.visible = decals.length > 0;
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor.needsUpdate = true;
  return fading;
}

function tickDecals(dt) {
  DC.time += dt;
  let changed = decals.length > decalCap();
  for (let i = decals.length - 1; i >= 0; i--) {
    const k = (DC.time - decals[i].born) / decals[i].ttl;
    if (k >= 1) { decals.splice(i, 1); changed = true; }
    else if (k > 1 - DECAL_FADE) changed = true;
  }
  if (changed) writeDecals();
}

// BR.world.decal(x, z, { color, radius, ttl, y })：贴一块；区块没载入（或没开局）返回 false
function decal(x, z, o) {
  if (!S.level || !THREE) return false;
  if (!(num(x, NaN) === x && num(z, NaN) === z)) return false;
  const c = byNum.get(numKey(Math.floor(x / S.size), Math.floor(z / S.size)));
  if (!c) return false;          // 没载入的区块不贴：它卸载时也清不到
  const scene = sceneOf();
  const m = decalMesh();
  if (!scene || !m) return false;
  if (m.parent !== scene) scene.add(m);
  o = o || {};
  const cap = decalCap();
  if (decals.length >= cap) decals.splice(0, decals.length - cap + 1);
  const y = num(o.y, has(BR.phys, 'groundY') ? num(+BR.phys.groundY(x, z), 0) : 0);
  const ttl = num(o.ttl, 60);
  decals.push({
    key: c.key, x, y: y + 0.012, z,
    r: Math.max(0.05, num(o.radius, 0.6)),
    rot: (U.hashInts(Math.round(x * 64), Math.round(z * 64)) % 6283) / 1000,   // 按位置转个角度，一串斑块不会长得一模一样
    color: num(o.color, 0x16110c) & 0xffffff,
    born: DC.time, ttl: ttl > 0 ? ttl : 60,
  });
  writeDecals();
  return true;
}

function dropChunkDecals(key) {
  let j = 0;
  for (let i = 0; i < decals.length; i++) if (decals[i].key !== key) decals[j++] = decals[i];
  if (j === decals.length) return;
  decals.length = j;
  writeDecals();
}

function clearDecals() {
  decals.length = 0;
  DC.time = 0;
  const m = DC.mesh;
  if (m) {
    m.count = 0;
    m.visible = false;
    if (m.parent) m.parent.remove(m);
  }
}

// 调试 / 测试：{ count, cap, byChunk: { "cx,cz": 块数 }, inScene, visible }
function decalInfo() {
  const byChunk = {};
  for (let i = 0; i < decals.length; i++) byChunk[decals[i].key] = (byChunk[decals[i].key] || 0) + 1;
  const m = DC.mesh;
  return { count: decals.length, cap: decalCap(), byChunk, inScene: !!(m && m.parent), visible: !!(m && m.visible), instances: m ? m.count : 0 };
}

// ---------- 流式加载 ----------
function recenter(cx, cz) {
  S.centerCx = cx;
  S.centerCz = cz;
  S.hasCenter = true;
  const R = loadRadius();
  // 滞回：进 R 就载入，出了 R+1 才卸载 —— 贴着区块边界来回走不会反复建拆。
  // 保活：块里有正被拖着的道具，或被挪过、现在位置在 R+1 以内的道具，这块先不卸，免得道具拖到隔壁块后随原区块一起消失
  for (const c of Array.from(chunks.values())) {
    if (cheb(c.cx, c.cz, cx, cz) > R + 1 && !keepChunk(c, cx, cz, R + 1)) unloadChunk(c, false);
  }
  queue = [];
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const key = chunkKey(cx + dx, cz + dz);
      if (chunks.has(key)) continue;
      // 先按圈、圈内再按欧氏距离：脚下和正前后左右的块优先
      queue.push({ key, cx: cx + dx, cz: cz + dz, d: Math.max(Math.abs(dx), Math.abs(dz)) * 100 + dx * dx + dz * dz });
    }
  }
  queue.sort((a, b) => a.d - b.d);
}

function stream(x, z) {
  const cx = Math.floor(x / S.size), cz = Math.floor(z / S.size);
  if (!S.hasCenter || cx !== S.centerCx || cz !== S.centerCz) recenter(cx, cz);
  // 每帧最多新建 1 块：建一块要合并几何、刷物品实体，挤在同一帧里手机会明显掉帧。
  // 雾远端小于载入半径，边缘那一圈晚几帧出现看不见
  while (queue.length) {
    const q = queue.shift();
    if (chunks.has(q.key)) continue;
    buildChunk(q.cx, q.cz);
    break;
  }
}

function pushLights() {
  if (!S.lightsDirty) return;
  S.lightsDirty = false;
  if (!has(BR.gfx, 'setLightSources')) return;
  const list = [];
  chunks.forEach(c => { for (let i = 0; i < c.lights.length; i++) list.push(c.lights[i]); });
  // 工坊 lightMul/flicker/blackout：未激活时原样返回同一个数组引用，不新建对象
  const out = has(BR.workshop, 'lightTransform') ? BR.workshop.lightTransform(list) : list;
  BR.gfx.setLightSources(out);
  S.lightsPushed = true;
}

// ---------- 出口 ----------
function collectInside(f) {
  insideNow.length = 0;
  const p = BR.player;
  const feet = p && num(p.y, NaN) === p.y ? p.y - BR.config.player.eyeHeight : null;
  const cx = Math.floor(f.x / S.size), cz = Math.floor(f.z / S.size);
  // 只看周围 3×3 块：出口半径默认远小于区块边长
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = byNum.get(numKey(cx + dx, cz + dz));
      if (!c) continue;
      for (let i = 0; i < c.exits.length; i++) {
        const ex = c.exits[i];
        if (ex.active === false) continue;   // 事件型出口：层级 setActive(true) 之前不存在
        const r = num(ex.radius, 1);
        if (U.dist2(f.x, f.z, ex.x, ex.z) > r * r) continue;
        if (feet !== null && typeof ex.y === 'number' && Math.abs(ex.y - feet) > EXIT_DY) continue;
        insideNow.push(ex);
      }
    }
  }
}

// 未开放：kit 标了 sealed（首期范围外），或目标在范围内但层级文件还没注册
function isSealed(ex) { return ex.sealed === true || !BR.levels.has(String(ex.to)); }
function sealedText(ex) { return ex.sealedText || ('Level ' + ex.to + ' 尚未开放'); }

function setSealedPrompt(text) {
  if (text === S.sealedPrompt) return;
  S.sealedPrompt = text;
  if (has(BR.hud, 'prompt')) BR.hud.prompt(text);
}

function checkExits(f) {
  if (S.transition || (BR.player && BR.player.dead)) { setSealedPrompt(null); return; }
  collectInside(f);
  let fired = null, sealedHere = null;
  for (let i = 0; i < insideNow.length; i++) {
    const ex = insideNow[i];
    const sealed = isSealed(ex);
    if (sealed && !sealedHere) sealedHere = ex;
    if (inside.has(ex)) continue;
    // 只在"从外面走进来"那一刻处理：未开放的 toast 一次，站在圈里不重复刷
    if (sealed) notOpen(ex);
    else if (!fired) fired = ex;
  }
  if (inside.size || insideNow.length) {
    inside.clear();
    for (let i = 0; i < insideNow.length; i++) inside.add(insideNow[i]);
  }
  // WAVE2 第 3 节：未开放出口不换层；站在圈里一直显示提示，走出去就收掉
  setSealedPrompt(sealedHere ? sealedText(sealedHere) : null);
  if (fired) reachExit(fired);
}

// 出生点可能正好在某个出口圈里：开局时把它们记成"已在里面"，走出去再进来才算
function latchExits() {
  inside.clear();
  collectInside(focus());
  for (let i = 0; i < insideNow.length; i++) inside.add(insideNow[i]);
}

function notOpen(exOrId) {
  // WAVE2 第 3 节：超出首期范围的出口照摆，但只提示，不改成通往别的层
  const text = exOrId && typeof exOrId === 'object' ? sealedText(exOrId) : 'Level ' + exOrId + ' 尚未开放';
  if (has(BR.hud, 'toast')) BR.hud.toast(text, 2000);
}

function reachExit(ex) {
  const to = String(ex.to);
  if (!BR.levels.has(to)) { notOpen(to); return; }
  BR.bus.emit('exit:reach', { to, kind: ex.kind || 'zone' });
  // 客机不自己换层：coop 转给房主，房主广播 { t:'level' } 后两人一起换（第 9 节）
  if (isCoopGuest()) return;
  goTo(to, ex).catch(err => console.error('[world] 换层失败', to, err));
}

// ---------- 层级生命周期 ----------
function callHook(name, dt) {
  const lv = S.level;
  if (!lv || typeof lv[name] !== 'function') return;
  try { lv[name](S.ctx, dt); }
  catch (err) { once(name + ':' + S.id, () => console.error('[world] level.' + name + ' 出错', S.id, err)); }
}

function readSpawn(level) {
  let s = null;
  try { s = level.spawn(S.ctx); } catch (err) { console.error('[world] level.spawn 出错', S.id, err); }
  s = s || {};
  // 保留层级额外给的字段（比如 pitch），只把坐标规整成数字
  return Object.assign({}, s, { x: num(s.x, 0), y: num(s.y, 0), z: num(s.z, 0), yaw: num(s.yaw, 0) });
}

function updateDeepest(id) {
  const order = BR.LEVEL_ORDER || [];
  const i = order.indexOf(id);
  if (i < 0) return;   // dev 这类不在顺序表里的层不计入"最深"
  if (i > order.indexOf(String(BR.game.deepest))) BR.game.deepest = id;
}

// 环境、环境音、层级名放在 start 里：首次进入和 goTo 走同一条路，main 不用再补一遍
function present(level) {
  const env = level.env || {};
  // 工坊地图固定了能见度（settings.visibility != null）时不跟玩家的滑条设置，其余情况不变
  const fixedVis = has(BR.workshop, 'fixedVisibility') ? BR.workshop.fixedVisibility() : null;
  const vis = fixedVis != null ? fixedVis : (BR.game.settings ? BR.game.settings.visibility : undefined);
  if (has(BR.gfx, 'applyEnv')) BR.gfx.applyEnv(env, vis);
  // 没写 audio 也要显式静音，否则上一层的环境音会一直带过来
  if (has(BR.audio, 'setAmbient')) BR.audio.setAmbient(env.audio || 'silence');
  if (has(BR.hud, 'levelTitle')) BR.hud.levelTitle(level);
}

// 工坊 envOverride 钩子：未激活时原样返回同一个引用，level 不用包一层，逐字节行为不变；
// 激活时包一层原型链（同 safeLevel 的写法），env 之外的字段（buildChunk、entities…）都照原型链读到原层级
function envWrappedLevel(rawLevel) {
  if (!has(BR.workshop, 'envOverride')) return rawLevel;
  const base = rawLevel.env || {};
  const ov = BR.workshop.envOverride(base);
  if (ov === base) return rawLevel;
  const lv = Object.create(rawLevel);
  lv.env = ov;
  return lv;
}

function startSync(levelId, seed) {
  const id = String(levelId);
  const rawLevel = BR.levels.get(id);
  if (!rawLevel) throw new Error('[world] 未注册的层级：' + id);
  const level = envWrappedLevel(rawLevel);

  clear();
  if (typeof seed === 'number' && isFinite(seed)) BR.game.seed = seed >>> 0;

  S.level = level;
  S.id = id;
  S.size = level.chunkSize > 0 ? +level.chunkSize : DEFAULT_CHUNK;
  S.chunkArea = S.size * S.size;
  S.levelSeed = U.hashInts(BR.game.seed >>> 0, id);
  S.ctx = { THREE, BR, level, levelSeed: S.levelSeed, assets: BR.assets, game: BR.game, scene: sceneOf() };
  // 先改 levelId：建区块时 items/entities 读到的就是新层
  BR.game.levelId = id;
  updateDeepest(id);

  // 准心候选来源：interact.js 比本文件先载入时在文件末尾就注册了，这里兜底
  ensurePropSource();

  // enter 在建区块之前：层级可以在这里设 groundFn、预算全层数据
  callHook('enter');

  let sp = readSpawn(level);
  if (has(BR.workshop, 'spawnOverride')) sp = BR.workshop.spawnOverride(sp) || sp;
  S.spawn = sp;
  S.spawnCx = Math.floor(sp.x / S.size);
  S.spawnCz = Math.floor(sp.z / S.size);

  // 出生点周围一次建完：玩家落地第一帧脚下和四周就得有墙、有碰撞、有灯
  recenter(S.spawnCx, S.spawnCz);
  while (queue.length) {
    const q = queue.shift();
    if (!chunks.has(q.key)) buildChunk(q.cx, q.cz);
  }
  pushLights();

  if (has(BR.player, 'reset')) BR.player.reset(sp);
  present(level);
  latchExits();
  BR.bus.emit('level:enter', { id });
  return level;
}

// ---------- 公开 API ----------
function start(levelId, seed) {
  // Promise 执行器同步运行：start() 返回时区块已经建好，调用方 await 与否都一样
  return new Promise(resolve => resolve(startSync(levelId, seed)));
}

function goTo(levelId, via) {
  const id = String(levelId);
  if (!BR.levels.has(id)) { notOpen(id); return Promise.resolve(false); }
  // 两个出口挨着、或房主广播和本地触发撞在一起：合并成一次，不叠两次淡出
  if (S.transition) return S.transition;

  const t0 = S.token;
  const kind = via && typeof via === 'object' ? via.kind : via;
  const run = (async () => {
    if (kind && TRANSITION_SOUND[kind] && has(BR.audio, 'play')) BR.audio.play(TRANSITION_SOUND[kind]);
    const fl = kind && TRANSITION_FLASH[kind];
    if (fl && has(BR.gfx, 'flash')) BR.gfx.flash(fl.color, fl.seconds, fl.peak);
    if (has(BR.gfx, 'fade')) await BR.gfx.fade(true, FADE_OUT);
    if (S.token !== t0) {
      // 淡出途中已被 clear/start 抢先（比如回了主页）：这次作废，但黑幕是这里拉下的，要收回去
      if (has(BR.gfx, 'fade')) BR.gfx.fade(false, FADE_ABORT);
      return false;
    }
    let fadeIn = null;
    try {
      startSync(id);
    } finally {
      // 换层失败也要把画面淡回来，否则玩家对着黑屏不知道发生了什么
      if (has(BR.gfx, 'fade')) fadeIn = BR.gfx.fade(false, FADE_IN);
    }
    if (fadeIn) await fadeIn;
    return true;
  })();
  S.transition = run;
  const done = () => { if (S.transition === run) S.transition = null; };
  run.then(done, done);
  return run;
}

function tickChunk(c) {
  if (!c.tick) return;
  try { c.tick.call(c.res, tickDt); }
  catch (err) {
    c.tick = null;   // 区块动画坏了就停掉这一块，别每帧刷报错
    console.error('[world] 区块 update 出错，已停用该块动画', c.key, err);
  }
}

function update(dt) {
  if (!S.level) return;
  dt = dt > 0 ? Math.min(dt, 0.1) : 0;
  const f = focus();
  stream(f.x, f.z);
  if (decals.length) tickDecals(dt);   // 放在 stream 之后：本帧刚卸载的区块，它的贴花已经清掉了
  pushLights();
  tickDt = dt;
  chunks.forEach(tickChunk);
  callHook('update', dt);
  // level.update 里可能换了层（事件型出口），换完 S.level 已是新层，本帧不再测旧出口
  if (S.level) checkExits(focus());
}

// 附近灯按与 gfx 相同的 (1 - d/range)² 衰减累加（只算水平距离），再加环境光基础值。
// 不含闪烁：闪烁灯按常亮算，实体的"怕光/要光"判断不会跟着灯管抽搐
function lightAt(x, z) {
  const lv = S.level;
  if (!lv) return 1;
  const amb = lv.env && lv.env.ambient;
  let v = amb ? num(amb.intensity, 0.4) : 0.4;
  if (v >= 1) return 1;
  const cx = Math.floor(x / S.size), cz = Math.floor(z / S.size);
  const reach = Math.ceil(S.maxRange / S.size);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const c = byNum.get(numKey(cx + dx, cz + dz));
      if (!c) continue;
      const ls = c.lights;
      for (let i = 0; i < ls.length; i++) {
        const L = ls[i];
        const I = L.intensity != null ? +L.intensity : 1;
        if (!(I > 0)) continue;
        const r = rangeOf(L);
        const ddx = L.x - x, ddz = L.z - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r * r) continue;
        const k = 1 - Math.sqrt(d2) / r;
        v += I * k * k;
        if (v >= 1) return 1;
      }
    }
  }
  return U.clamp(v, 0, 1);
}

function clear() {
  S.token++;
  if (S.level) {
    callHook('leave');
    BR.bus.emit('level:leave', { id: S.id });
  }
  for (const c of Array.from(chunks.values())) unloadChunk(c, true);
  chunks.clear();
  byNum.clear();
  clearProps();
  queue = [];
  inside.clear();
  insideNow.length = 0;
  setSealedPrompt(null);
  if (has(BR.phys, 'clear')) BR.phys.clear();
  if (has(BR.items, 'clear')) BR.items.clear();
  if (has(BR.entities, 'clear')) BR.entities.clear();
  clearDecals();
  // 只有自己推过灯才清：主页可能在用 gfx 的灯
  if (S.lightsPushed && has(BR.gfx, 'setLightSources')) BR.gfx.setLightSources([]);
  S.lightsPushed = false;
  S.lightsDirty = false;
  S.level = null;
  S.id = null;
  S.ctx = null;
  S.spawn = null;
  S.hasCenter = false;
  S.safeLevel = null;
  S.maxRange = 0;
}

function chunkKeyAt(x, z) { return chunkKey(Math.floor(x / S.size), Math.floor(z / S.size)); }

// ---------- 区块边界查询（层级 update、BR.kit.handles、预览测试用；返回的记录只读，别改） ----------
function chunkCoordsAt(x, z) { return { cx: Math.floor(x / S.size), cz: Math.floor(z / S.size) }; }
function chunkBounds(cx, cz) {
  const s = S.size;
  return { minX: cx * s, minZ: cz * s, maxX: (cx + 1) * s, maxZ: (cz + 1) * s };
}
// 已载入区块记录 { key, cx, cz, res, solids, lights, spawnPoints, exits }；没载入返回 null
function chunkAt(x, z) { return byNum.get(numKey(Math.floor(x / S.size), Math.floor(z / S.size))) || null; }
function loadedChunks() { return Array.from(chunks.values()); }
// 已载入区块里的全部出口描述（世界坐标，含 sealed / active）
function loadedExits() {
  const out = [];
  chunks.forEach(c => { for (let i = 0; i < c.exits.length; i++) out.push(c.exits[i]); });
  return out;
}

// 集成阶段自查：载入块数、队列、灯/碰撞体/出口总数
function debugInfo() {
  let lights = 0, solids = 0, exits = 0, spawnPoints = 0;
  chunks.forEach(c => {
    lights += c.lights.length;
    solids += c.solids.length;
    exits += c.exits.length;
    spawnPoints += c.spawnPoints.length;
  });
  let movedProps = 0;
  for (let i = 0; i < propList.length; i++) if (propList[i].moved) movedProps++;
  return {
    level: S.id, levelSeed: S.levelSeed, chunkSize: S.size,
    loaded: chunks.size, queued: queue.length,
    center: [S.centerCx, S.centerCz], spawnChunk: [S.spawnCx, S.spawnCz],
    lights, solids, exits, spawnPoints,
    props: propList.length, movedProps,
    transitioning: !!S.transition,
  };
}

// 回主页时世界必须清干净：不依赖 main 记得调 clear
BR.bus.on('game:home', () => { if (S.level || chunks.size) clear(); });
// 本局状态变了（联机回放、别的模块直接写）：套到已载入的区块上
BR.bus.on('levelstate:set', onLevelStateSet);
BR.bus.on('levelstate:import', onLevelStateImport);
BR.bus.on('item:taken', onVendTaken);

BR.world = {
  start,
  goTo,
  update,
  lightAt,
  clear,
  get current() { return S.level; },
  get levelSeed() { return S.levelSeed; },
  get chunkArea() { return S.chunkArea; },
  get chunkSize() { return S.size; },
  get transitioning() { return !!S.transition; },
  chunkKeyAt,
  chunkCoordsAt,
  chunkBounds,
  chunkAt,
  chunks: loadedChunks,
  exits: loadedExits,
  debugInfo,
  decal,        // (x, z, { color, radius, ttl, y }?) → bool：贴地斑块，纯表现、不同步（ENGINE_PLAN M1 AA）
  decalInfo,    // () → { count, cap, byChunk, inScene, visible, instances }
  // 道具（交互方案 A1）：运行时记录见「道具」一节；返回的记录只读，改位置一律走 movePropTo / commitProp
  propsNear,    // (x, z, r, out?) → out：当前外接盒离 (x, z) 水平距离 ≤ r 的道具
  propByKey,    // (key) → 记录 | null（只含已载入区块）
  movePropTo,   // (key, x, z) 或 (key, {x, z} | {dx, dz}（总偏移）) → bool：拖动中每帧调，(x, z) 是枢轴新的世界坐标；挪顶点和碰撞体，发 'prop:moved'
  commitProp,   // (key, src?) → bool：松手时调，刷包围球、写 levelState（回原位就删），发 'prop:moved' final
  applyProp,    // (key, {dx, dy, dz, ry} | null, src?) → bool：联机回放，把一条 levelState 值（这件自己相对父道具的 t）直接摆上（没载入 false）
  dragKeys,     // (key) → [key, …放在它上面的子孙 key]：拖动时 phys.moveBox 的 ignoreKey
  propBox,      // (key, out?) → 它连同放在上面的子孙当前的世界外接盒 {minX, minY, minZ, maxX, maxY, maxZ} | null
};
// interact.js 在本文件之前载入（index.html：phys → interact → levelstate → items …）：这里就能注册；没载入的话 start 时再补
ensurePropSource();
})();
