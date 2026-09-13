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
    solids: arr(res.solids),
    lights: arr(res.lights).filter(validPoint),
    spawnPoints: arr(res.spawnPoints).filter(validPoint),
    exits: arr(res.exits).filter(e => validPoint(e) && e.to != null),
    tick: typeof res.update === 'function' ? res.update : null,
  };
  chunks.set(key, c);
  byNum.set(numKey(cx, cz), c);

  const scene = sceneOf();
  if (c.group) {
    if (!c.group.name) c.group.name = 'chunk ' + key;
    if (scene) scene.add(c.group);
  }
  if (c.solids.length && has(BR.phys, 'addSolids')) BR.phys.addSolids(key, c.solids);
  for (const L of c.lights) if (rangeOf(L) > S.maxRange) S.maxRange = rangeOf(L);
  if (c.lights.length) S.lightsDirty = true;

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
      BR.items.spawn(type, p.x, p.y, p.z, { id: S.id + '/' + c.key + '/' + type + '/' + k, chunkKey: c.key });
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
  if (!bulk) {
    if (c.solids.length && has(BR.phys, 'removeSolids')) BR.phys.removeSolids(c.key);
    if (has(BR.items, 'removeChunk')) BR.items.removeChunk(c.key);
    if (has(BR.entities, 'removeChunk')) BR.entities.removeChunk(c.key);
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

// ---------- 流式加载 ----------
function recenter(cx, cz) {
  S.centerCx = cx;
  S.centerCz = cz;
  S.hasCenter = true;
  const R = loadRadius();
  // 滞回：进 R 就载入，出了 R+1 才卸载 —— 贴着区块边界来回走不会反复建拆
  for (const c of Array.from(chunks.values())) {
    if (cheb(c.cx, c.cz, cx, cz) > R + 1) unloadChunk(c, false);
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
  queue = [];
  inside.clear();
  insideNow.length = 0;
  setSealedPrompt(null);
  if (has(BR.phys, 'clear')) BR.phys.clear();
  if (has(BR.items, 'clear')) BR.items.clear();
  if (has(BR.entities, 'clear')) BR.entities.clear();
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
  return {
    level: S.id, levelSeed: S.levelSeed, chunkSize: S.size,
    loaded: chunks.size, queued: queue.length,
    center: [S.centerCx, S.centerCz], spawnChunk: [S.spawnCx, S.spawnCz],
    lights, solids, exits, spawnPoints,
    transitioning: !!S.transition,
  };
}

// 回主页时世界必须清干净：不依赖 main 记得调 clear
BR.bus.on('game:home', () => { if (S.level || chunks.size) clear(); });

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
};
})();
