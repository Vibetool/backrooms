// 后室 · 创意工坊核心：地图数据、本机存储、运行时钩子（BR.workshop）
// 经典 <script>，只往 window.BR 上挂东西。数据格式、钩子位置、验收标准见 WORKSHOP.md 第 2、5、6、7 节。
// 未激活（active 为空）时下面每一个钩子都必须是空操作、原样返回，现有层级行为一字节不变——这是最高优先级的约束。
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

const STORAGE_KEY = 'backrooms_workshop_v1';
const MAX_BYTES = 200 * 1024;          // 单图 JSON 上限，超了拒绝保存
const MAP_VERSION = 1;

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function arr(v) { return Array.isArray(v) ? v : []; }
function has(o, fn) { return !!o && typeof o[fn] === 'function'; }
function byteLen(s) {
  // 存字符串的字节数（UTF-8）：TextEncoder 没有就退化成转义计数，两条路径结果一致
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}
function randId(prefix) {
  return (prefix || 'ws') + '_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// ---------- 运行时状态（不进存储） ----------
// walls/exits 的覆盖不缓存索引：编辑器直接改 active.walls / active.exits（同一个数组引用），
// 缓存的 Map/Set 会在编辑期间读到过期数据，所以下面 wallOverride/exitOverride 都现查现扫（数组顶多几千条，够快）
const S = {
  active: null,          // 当前激活的 WorkshopMap（引用，编辑器直接改这个对象）
  editing: false,
  spawnedIds: null,       // Set：本局已经刷过的放置实体 id，死了也不再刷
  gridByChunk: null,      // Map："cx,cz" → { cols, rows, cellW, cellD, ox, oz, v, h }（仅编辑态缓存，供 edgeAt 用）
};

// ---------- 本机存储 ----------
function loadStore() {
  try {
    const raw = window.localStorage && localStorage.getItem(STORAGE_KEY);
    if (!raw) return { maps: [] };
    const o = JSON.parse(raw);
    return o && Array.isArray(o.maps) ? o : { maps: [] };
  } catch (err) {
    console.warn('[workshop] 读取本机存储失败，当作空列表', err);
    return { maps: [] };
  }
}
function writeStore(store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); return true; }
  catch (err) { console.error('[workshop] 写入本机存储失败（隐私模式或空间不足？）', err); return false; }
}

function defaultSettings() {
  return {
    visibility: null, lightMul: 1, flicker: 'level', blackout: false,
    ambient: 'level', autoEntities: true, entityDensityMul: 1,
    autoItems: true, itemDensityMul: 1, sanityDrainMul: 1, hungerDrainMul: 1,
    triggerRadius: 20,
  };
}

// 宽进严出：外部传进来的地图（尤其联机客机收到的、或手填的测试夹具）字段可能不全，
// 缺的字段一律按 WORKSHOP.md 第 2 节默认值补齐，钩子逻辑不用到处判空
function normalize(map) {
  if (!map || typeof map !== 'object') return map;
  map.v = MAP_VERSION;
  if (!map.settings || typeof map.settings !== 'object') map.settings = {};
  const sd = defaultSettings();
  for (const k in sd) if (map.settings[k] === undefined) map.settings[k] = sd[k];
  if (!Array.isArray(map.walls)) map.walls = [];
  if (!Array.isArray(map.freeWalls)) map.freeWalls = [];
  if (!Array.isArray(map.entities)) map.entities = [];
  if (!map.exits || typeof map.exits !== 'object') map.exits = {};
  if (!Array.isArray(map.exits.removed)) map.exits.removed = [];
  if (!Array.isArray(map.exits.moved)) map.exits.moved = [];
  if (!Array.isArray(map.exits.added)) map.exits.added = [];
  if (map.spawn && typeof map.spawn !== 'object') map.spawn = null;
  return map;
}

function list() {
  return loadStore().maps.slice().sort((a, b) => num(b && b.updatedAt, 0) - num(a && a.updatedAt, 0));
}
function get(id) {
  if (id == null) return null;
  return loadStore().maps.find(m => m && m.id === String(id)) || null;
}
function create(baseLevel, name) {
  const now = Date.now();
  return normalize({
    v: MAP_VERSION,
    id: randId(),
    name: name || '我的后室',
    baseLevel: String(baseLevel != null ? baseLevel : '0'),
    seed: (Math.random() * 4294967296) >>> 0,
    radius: 3,
    createdAt: now, updatedAt: now,
    spawn: null,
    settings: defaultSettings(),
    walls: [], freeWalls: [], entities: [],
    exits: { removed: [], moved: [], added: [] },
  });
}
function save(map) {
  if (!map || typeof map !== 'object') return { ok: false, error: '地图数据无效' };
  normalize(map);
  if (!map.id) map.id = randId();
  map.updatedAt = Date.now();
  if (!map.createdAt) map.createdAt = map.updatedAt;
  let json;
  try { json = JSON.stringify(map); }
  catch (err) { return { ok: false, error: '地图数据无法序列化：' + (err && err.message) }; }
  if (byteLen(json) > MAX_BYTES) return { ok: false, error: '地图数据超过 200KB（' + (byteLen(json) / 1024).toFixed(1) + 'KB），请精简后再保存' };
  const store = loadStore();
  const i = store.maps.findIndex(m => m && m.id === map.id);
  if (i >= 0) store.maps[i] = map; else store.maps.push(map);
  if (!writeStore(store)) return { ok: false, error: '本机存储写入失败（隐私模式或空间不足？）' };
  return { ok: true };
}
function remove(id) {
  const store = loadStore();
  const i = store.maps.findIndex(m => m && m.id === String(id));
  if (i < 0) return false;
  store.maps.splice(i, 1);
  writeStore(store);
  if (S.active && S.active.id === String(id)) deactivate();
  return true;
}
function duplicate(id) {
  const src = get(id);
  if (!src) return null;
  let copy;
  try { copy = JSON.parse(JSON.stringify(src)); } catch (err) { return null; }
  copy.id = randId();
  copy.name = (src.name || '我的后室') + ' 副本';
  copy.createdAt = copy.updatedAt = Date.now();
  const r = save(copy);
  return r.ok ? copy : null;
}

// ---------- 激活 / 停用 ----------
function activate(map, opts) {
  if (!map || typeof map !== 'object') return;
  const o = opts || {};
  S.active = normalize(map);
  S.editing = !!o.editing;
  S.spawnedIds = new Set();
  S.gridByChunk = new Map();
}
function deactivate() {
  S.active = null;
  S.editing = false;
  S.spawnedIds = null;
  S.gridByChunk = null;
}
// wall/exits 覆盖现查现扫 active 上的数组：编辑器直接 push 新条目就立即生效，不用重新 activate()
function wallOverride(key) {
  const list = S.active && S.active.walls;
  if (!Array.isArray(list)) return undefined;
  for (let i = list.length - 1; i >= 0; i--) { const w = list[i]; if (w && w.k === key) return !!w.on; }
  return undefined;
}
function isRemovedExit(key) {
  const ex = S.active && S.active.exits;
  return !!(ex && arr(ex.removed).some(k => String(k) === key));
}
function movedExit(key) {
  const ex = S.active && S.active.exits;
  if (!ex) return null;
  const list = arr(ex.moved);
  for (let i = list.length - 1; i >= 0; i--) { const m = list[i]; if (m && String(m.key) === key) return m; }
  return null;
}

function isGuest() {
  const c = BR.game && BR.game.coop;
  if (c && c.active) return c.role === 'guest';
  return !!(BR.coop && BR.coop.active && BR.coop.role === 'guest');
}

// =====================================================================
// 第 3 节：墙钩子——grid 加/删墙、区块交界线两侧一致
// =====================================================================
// key 格式：竖边 'v@<x>,<zMid>'、横边 'h@<xMid>,<z>'，世界坐标保留两位小数（见 WORKSHOP.md 第 3 节）
function applyGrid(b, g) {
  if (!S.active || !g) return;
  // 记录这块网格的几何信息（列行数、格距、原点）+ 生成后的原始墙位图：edgeAt 之后要用它算"当前是不是墙"
  if (S.editing) {
    S.gridByChunk.set(b.cx + ',' + b.cz, {
      cols: g.cols, rows: g.rows, cellW: g.cellW, cellD: g.cellD, ox: b.ox, oz: b.oz,
      v: g.v.slice(), h: g.h.slice(),
    });
  }
  const list = arr(S.active.walls);
  if (!list.length) return;
  const eps = 0.02;
  let touched = false;
  for (const w of list) {
    if (!w || typeof w.k !== 'string') continue;
    const m = /^([vh])@(-?[0-9.]+),(-?[0-9.]+)$/.exec(w.k);
    if (!m) continue;
    const axis = m[1], wx = parseFloat(m[2]), wz = parseFloat(m[3]);
    const on = !!w.on;
    if (axis === 'v') {
      const li = (wx - b.ox) / g.cellW;
      const i = Math.round(li);
      if (Math.abs(li - i) > eps || i < 0 || i > g.cols) continue;
      const lj = (wz - b.oz) / g.cellD - 0.5;
      const j = Math.round(lj);
      if (Math.abs(lj - j) > eps || j < 0 || j >= g.rows) continue;
      if (g._wsSetWall('v', i, j, on)) touched = true;
    } else {
      const li = (wx - b.ox) / g.cellW - 0.5;
      const i = Math.round(li);
      if (Math.abs(li - i) > eps || i < 0 || i >= g.cols) continue;
      const lj = (wz - b.oz) / g.cellD;
      const j = Math.round(lj);
      if (Math.abs(lj - j) > eps || j < 0 || j > g.rows) continue;
      if (g._wsSetWall('h', i, j, on)) touched = true;
    }
  }
  if (touched) g._wsEdited = true;
}

// ---------- 编辑辅助：edgeAt / exitsNear / inRadius ----------
function natWall(info, axis, i, j) {
  if (axis === 'v') return i >= 0 && i <= info.cols && j >= 0 && j < info.rows && !!info.v[i * info.rows + j];
  return j >= 0 && j <= info.rows && i >= 0 && i < info.cols && !!info.h[j * info.cols + i];
}
function centerChunk() {
  const info = has(BR.world, 'debugInfo') ? BR.world.debugInfo() : null;
  const sc = info && info.spawnChunk;
  return { cx: sc ? sc[0] : 0, cz: sc ? sc[1] : 0 };
}
function inRadius(x, z) {
  if (!S.active || !has(BR.world, 'chunkCoordsAt')) return false;
  const c = BR.world.chunkCoordsAt(x, z);
  const center = centerChunk();
  const r = Math.max(0, num(S.active.radius, 3) | 0);
  return Math.max(Math.abs(c.cx - center.cx), Math.abs(c.cz - center.cz)) <= r;
}
function edgeAt(x, z) {
  if (!S.active || !S.gridByChunk || !has(BR.world, 'chunkCoordsAt')) return null;
  const cc = BR.world.chunkCoordsAt(x, z);
  const info = S.gridByChunk.get(cc.cx + ',' + cc.cz);
  if (!info) return null;
  const lx = x - info.ox, lz = z - info.oz;
  const vi = U.clamp(Math.round(lx / info.cellW), 0, info.cols);
  const vj = U.clamp(Math.floor(lz / info.cellD), 0, info.rows - 1);
  const vcx = vi * info.cellW, vcz = (vj + 0.5) * info.cellD;
  const vDist = Math.hypot(lx - vcx, lz - vcz);

  const hj = U.clamp(Math.round(lz / info.cellD), 0, info.rows);
  const hi = U.clamp(Math.floor(lx / info.cellW), 0, info.cols - 1);
  const hcx = (hi + 0.5) * info.cellW, hcz = hj * info.cellD;
  const hDist = Math.hypot(lx - hcx, lz - hcz);

  const axis = vDist <= hDist ? 'v' : 'h';
  const i = axis === 'v' ? vi : hi, j = axis === 'v' ? vj : hj;
  const wx = info.ox + (axis === 'v' ? vcx : hcx);
  const wz = info.oz + (axis === 'v' ? vcz : hcz);
  const key = axis + '@' + wx.toFixed(2) + ',' + wz.toFixed(2);
  const ov = wallOverride(key);
  const on = ov !== undefined ? ov : natWall(info, axis, i, j);
  const half = axis === 'v' ? info.cellD / 2 : info.cellW / 2;
  return {
    key, axis, on,
    x0: axis === 'v' ? wx : wx - half, z0: axis === 'v' ? wz - half : wz,
    x1: axis === 'v' ? wx : wx + half, z1: axis === 'v' ? wz + half : wz,
  };
}
function exitsNear(x, z, r) {
  if (!S.active || !has(BR.world, 'exits')) return [];
  const r2 = num(r, 0) * num(r, 0);
  const out = [];
  for (const ex of BR.world.exits()) {
    if (!ex || ex.key == null) continue;
    if (U.dist2(x, z, ex.x, ex.z) > r2) continue;
    const moved = movedExit(String(ex.key));
    out.push({
      key: ex.key, to: ex.to, kind: ex.kind, x: ex.x, z: ex.z,
      rot: moved && moved.rot != null ? moved.rot : 0,
      label: ex.label, sealed: !!ex.sealed,
      source: String(ex.key).indexOf('ws:') === 0 ? 'added' : 'base',
    });
  }
  return out;
}

// =====================================================================
// 第 4 节：出口钩子——移除 / 移动 / 新增
// =====================================================================
function exitOverride(b, key, opts) {
  if (!S.active) return undefined;
  if (isRemovedExit(key)) return null;
  const m = movedExit(key);
  if (!m) return undefined;
  // moved 存的是世界坐标，exit() 用的是当前 builder 坐标系下的本地坐标（这里没有 push 过，本地=区块本地）
  return Object.assign({}, opts, {
    x: typeof m.x === 'number' ? m.x - b.ox : opts.x,
    z: typeof m.z === 'number' ? m.z - b.oz : opts.z,
    rot: m.rot != null ? m.rot : opts.rot,
  });
}

function inChunk(b, x, z) { return x >= b.ox && x < b.ox + b.size && z >= b.oz && z < b.oz + b.size; }

// 非格子墙：只加不删。约定见 WORKSHOP.md 第 2 节——(x,z) 世界坐标中心，rot 绕 Y 轴（0 = 沿世界 X 轴延伸），
// len 为长度，厚度固定和 gridWalls 默认一致（0.2 × 4/3 m），h 缺省用层高
function buildFreeWalls(b) {
  const list = arr(S.active.freeWalls);
  if (!list.length || !BR.kit) return;
  const T = 0.2 * 4 / 3, ht = T / 2;
  for (const w of list) {
    if (!w || !(w.len > 0) || !inChunk(b, num(w.x, 0), num(w.z, 0))) continue;
    const h = num(w.h, b.height);
    b.push(w.x - b.ox, w.z - b.oz, num(w.rot, 0));
    b.aabb(-w.len / 2, 0, -ht, w.len / 2, h, ht, 'kit:prop', { faces: 'all', solid: true });
    b.pop();
  }
}
function decorate(b) {
  if (!S.active) return;
  buildFreeWalls(b);
  for (const a of arr(S.active.exits && S.active.exits.added)) {
    if (!a || a.to == null || !inChunk(b, num(a.x, 0), num(a.z, 0))) continue;
    const h = BR.kit.exit(b, {
      x: a.x - b.ox, z: a.z - b.oz, rot: num(a.rot, 0),
      to: a.to, kind: a.kind || 'door', label: a.label,
    });
    if (h) h.desc.key = 'ws:' + a.id;
  }
}

// =====================================================================
// 第 6 节：基本设置——环境 / 出生点 / 密度 / 灯光
// =====================================================================
function spawnOverride(spawn) {
  if (!S.active || !S.active.spawn) return spawn;
  const s = S.active.spawn;
  return Object.assign({}, spawn, {
    x: num(s.x, spawn && spawn.x), z: num(s.z, spawn && spawn.z), yaw: num(s.yaw, spawn && spawn.yaw),
  });
}
function envOverride(env) {
  if (!S.active) return env;
  const s = S.active.settings || {};
  const base = env || {};
  const e = Object.assign({}, base);
  const amb = Object.assign({}, base.ambient || {});
  let intensity = num(amb.intensity, 0.4) * num(s.lightMul, 1);
  if (s.blackout) intensity = Math.min(intensity, 0.03);
  amb.intensity = U.clamp(intensity, 0, 5);
  e.ambient = amb;
  if (s.ambient && s.ambient !== 'level') e.audio = s.ambient;
  e.sanityDrainMul = num(base.sanityDrainMul, 1) * num(s.sanityDrainMul, 1);
  e.hungerDrainMul = num(base.hungerDrainMul, 1) * num(s.hungerDrainMul, 1);
  return e;
}
// 固定能见度（settings.visibility != null）：world.js 的 present() 直接读这个函数，不跟玩家的滑条设置
function fixedVisibility() {
  if (!S.active || S.editing) return null;
  const v = S.active.settings && S.active.settings.visibility;
  return typeof v === 'number' && isFinite(v) ? U.clamp(v, 0, 1) : null;
}
function isStapleItem(type) {
  if (type === 'almond_water') return true;
  const def = BR.itemTypes && BR.itemTypes.get(type);
  return !!(def && def.category === 'food');
}
function densityMul(kind, type) {
  if (!S.active) return 1;
  const s = S.active.settings || {};
  if (kind === 'entities') {
    if (S.editing) return 0;   // 编辑态不刷实体
    if (s.autoEntities === false) return 0;
    return Math.max(0, num(s.entityDensityMul, 1));
  }
  if (kind === 'items') {
    const staple = isStapleItem(type);   // 食物与杏仁水：用户规则里所有模式都刷，工坊调不到 0
    if (s.autoItems === false && !staple) return 0;
    let mul = Math.max(0, num(s.itemDensityMul, 1));
    if (staple) mul = Math.max(mul, 1);
    return mul;
  }
  return 1;
}
function lightTransform(list) {
  if (!S.active || !Array.isArray(list)) return list;
  const s = S.active.settings || {};
  const mul = num(s.lightMul, 1);
  const blackout = !!s.blackout;
  const mode = s.flicker || 'level';
  return list.map(L => {
    const l = Object.assign({}, L);
    l.intensity = blackout ? 0 : U.clamp(num(L.intensity, 1) * mul, 0, 10);
    if (mode === 'off') l.flicker = 0;
    else if (mode === 'more') l.flicker = Math.max(num(L.flicker, 0), 0.6);
    return l;
  });
}

// =====================================================================
// 第 5 节：放置实体——进入触发距离才刷，本局内死了不复活
// =====================================================================
function update(dt) {
  if (!S.active || S.editing) return;
  if (isGuest()) return;   // 联机客机不刷，实体只在房主模拟、走快照
  const list = arr(S.active.entities);
  if (!list.length) return;
  if (!S.spawnedIds) S.spawnedIds = new Set();
  const p = BR.player;
  const px = p ? num(p.x, NaN) : NaN, pz = p ? num(p.z, NaN) : NaN;
  const peer = BR.coop ? BR.coop.peer : null;   // 房主也要算联机对方触发（BR.coop.peer，见 coop.js）
  const defaultR = num(S.active.settings && S.active.settings.triggerRadius, 20);
  for (const e of list) {
    if (!e || e.id == null || S.spawnedIds.has(e.id)) continue;
    const r = (typeof e.radius === 'number' && e.radius > 0) ? e.radius : defaultR;
    let near = false;
    if (isFinite(px) && isFinite(pz) && U.dist2(px, pz, e.x, e.z) <= r * r) near = true;
    if (!near && peer && isFinite(peer.x) && isFinite(peer.z) && U.dist2(peer.x, peer.z, e.x, e.z) <= r * r) near = true;
    if (!near) continue;
    S.spawnedIds.add(e.id);   // 先标记再刷：这次找不到落脚点也不重试，免得每帧重复扫描
    if (!has(BR.entities, 'spawn')) continue;
    const gy = has(BR.phys, 'groundY') ? BR.phys.groundY(e.x, e.z) : 0;
    BR.entities.spawn(e.type, e.x, gy, e.z, { manual: true, id: 'ws:' + e.id, yaw: e.yaw });
  }
}

BR.workshop = {
  list, get, create, save, remove, duplicate,
  get active() { return S.active; },
  get editing() { return S.editing; },
  activate, deactivate,
  applyGrid, exitOverride, decorate,
  envOverride, spawnOverride, densityMul, lightTransform,
  fixedVisibility,
  update,
  edgeAt, exitsNear, inRadius,
};
})();
