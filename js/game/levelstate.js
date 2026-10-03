// 后室 · 本局各层状态（BR.levelState）：每一层「和生成结果不一样」的地方都记在这里——
// 拖过的道具、挪过的物资、地上被拿走的物资、玩家丢下的东西、门 / 电梯、到达门、营地 NPC、容器、开关、限量使用、载具。
//
// 规则（交互方案 A1，2026-10-02 修订）：
//   - 本局有效：game:start、game:home 时整份清空；换层（world.clear）不清，离开一层再回来，拖过的东西还在原处、
//     捡过的物资也不复活。回主页重新开局才全部复原。不写 localStorage，也不写进工坊地图。
//   - 每层一份记录，每写一次 v + 1，并发 bus 'levelstate:set' { lv, kind, key, v: 新值（删除为 null）, ver, src }。
//   - 联机房主权威：客机收到 st 用 import(lv, data) 整层替换（发 'levelstate:import'），收到 set 用
//     set(lv, kind, key, v, { ver, src: 'net' }) 写一条；src 原样带进事件，coop 据此不回发。
//
// 每层的结构（值都是可以直接 JSON 化的普通数据）：
//   v           版本号，每写一次 +1（import 时取对方的 v）
//   props       Map<道具 key, {dx, dy, dz, ry}>       这件道具自己相对父道具的偏移 t（米 / 弧度；顶层道具就是相对生成位置，
//                                                    和 kit 的 rec.t 一致，顶点按父链累加）；A1 只用 dx、dz
//   items       Map<物品 id, [x, y, z]>               被挪过的地上物资的新位置（脚底坐标，同 items.spawn）
//   taken       Set<物品 id>                          地上被拿走的物资：world.spawnItems 跳过它们，换层回来不复活
//   drops       Map<丢弃物 id, [x, y, z, type, count]>  玩家按 Q 丢在这一层地上的东西（脚底坐标）：换层回来照原样摆回去（items.js
//                                                    听 'level:enter' 重建），被捡走就删掉。和 taken 是同一条规则：放下的留在原处，拿走的不复活。
//                                                    联机时不能丢弃（player.js），所以这张表只在单机里有内容
//   doors       Map<门 key, 任意 JSON>                门的开度等（B 阶段定格式）
//   elev        Map<电梯 key, 任意 JSON>              电梯状态（B 阶段定格式）
//   arrivals    Array<{key, …}>                      到达门（B 阶段定格式；按 key 去重）
//   npcs        Map<NPC id, 任意 JSON>                营地 NPC（C 阶段定格式）
//   containers  Map<容器 key, [open, side, takenSlots]>
//                 open：0 关 / 1 开（允许 0..1 之间表示半开）；side：开的是哪一侧 / 哪个抽屉 / 哪扇门（字符串或数字，null = 默认）；
//                 takenSlots：已被拿走的格子号（升序去重的非负整数）。
//                 例：柜子整个只放一件东西，内容由 lootRng(levelSeed, 柜子 key) 决定放在哪一格，拿走后那一格记进 takenSlots，
//                 永远不再刷；每个抽屉单独当容器也行（各自一条），「整柜只有一件」由生成规则保证，不靠这里。
//   switches    Map<开关 / 设备 key, [v, sinceClk, extra]>
//                 v：开关量或档位（数字）；sinceClk：切换时的 coop 时钟（秒，单机就是本机时钟）；extra：任意 JSON（电视频道之类）。
//                 发电机直接用 fixture key 'L3:g:<cx>,<cz>:ns|ew'。
//   uses        Map<道具 / 设备 key, {n, readyAt, left, taken, …}>
//                 n：用过几次；readyAt：下一次能用的 coop 时钟（秒），冷却中 = clock < readyAt；
//                 left：还剩几次（null = 不限 / 不按次数算）；taken：一次性东西里已被拿走的那些（槽位号或物品类型）；
//                 其余字段原样保留（如 L20 游戏门的 result）。
//                 例：售货机每台每分钟出一个 → 出货时写 {n: n+1, readyAt: clock + 60}，按台记、联机共享；
//                     冰箱一瓶杏仁水 + 一个食物、永不刷新 → {left: 2, taken: []}，拿一样记一样，left 减到 0 就空了；
//                     饮水机 3 杯 → {left: 3}；喷泉、水龙头 → {readyAt}；灭火器、气球 → {taken: [...]}。
//   vehicles    Map<载具 key, {x, z, yaw, lift, tilt, steer, carry}>   carry：叉着的东西（道具 key / null）
//
// 接口：
//   get(lv) / peek(lv) / current()                     取某层记录（get 没有就建，peek 不建）
//   set(lv, kind, key, v, meta?) → ver | false         通用写入；lv 为 null 表示当前层；v 为 null / undefined 表示删除
//   getv(lv, kind, key) / has(lv, kind, key)           通用读取（taken 返回 true / false）
//   kind：'prop' | 'item' | 'taken' | 'drop' | 'door' | 'elev' | 'arrival' | 'npc' | 'container' | 'sw' | 'use' | 'veh'
//         （也认表名 'props'、'drops'、'switches'、'vehicles' 等和 'switch'、'vehicle'；事件里一律用前面那组短名）
//   便捷写法，lv 可省（省了就是当前层）：
//     setProp([lv,] key, v) / getProp([lv,] key)       setItem / getItem       take([lv,] id) / untake / isTaken   setDrop / getDrop
//     setContainer / getContainer   setSwitch / getSwitch   setUse / getUse / patchUse([lv,] key, 部分字段)
//     setVehicle / getVehicle   setDoor / getDoor   setElev / getElev   setNpc / getNpc   addArrival([lv,] rec) / arrivals([lv])
//   export(lv) → 纯数据（JSON 安全）   import(lv, data, meta?)   clear(lv?)   levels（Map，只读）
(function () {
'use strict';
const BR = window.BR;

// ---------- kind ----------
// 事件和 coop 'set' 消息用的短名 → 每层记录里的表名
const TABLE = {
  prop: 'props', item: 'items', taken: 'taken', drop: 'drops', door: 'doors', elev: 'elev', arrival: 'arrivals',
  npc: 'npcs', container: 'containers', sw: 'switches', use: 'uses', veh: 'vehicles',
};
const ALIAS = {
  props: 'prop', items: 'item', drops: 'drop', doors: 'door', arrivals: 'arrival', npcs: 'npc', containers: 'container',
  switch: 'sw', switches: 'sw', uses: 'use', vehicle: 'veh', vehicles: 'veh',
};
const KINDS = Object.keys(TABLE);
const MAP_TABLES = ['props', 'items', 'drops', 'doors', 'elev', 'npcs', 'containers', 'switches', 'uses', 'vehicles'];

function kindOf(name) {
  const k = String(name);
  if (TABLE[k]) return k;
  return ALIAS[k] || null;
}

// ---------- 小工具 ----------
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function fin(v, d) { v = +v; return isFinite(v) ? v : d; }
// JSON 安全的深拷贝：函数、undefined 丢掉，NaN / Infinity 变 null
function clone(v) {
  if (v === undefined || v === null || typeof v === 'function') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'object') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (err) { return null; }
}
function same(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    let flat = true;
    for (let i = 0; i < a.length; i++) {
      if (typeof a[i] === 'object' && a[i] !== null) { flat = false; break; }
      if (a[i] !== b[i]) return false;
    }
    if (flat) return true;
  }
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (err) { return false; }
}
function curLv() {
  const id = BR.game && BR.game.levelId;
  return id == null ? null : String(id);
}
function lvOf(lv) { return lv == null ? curLv() : String(lv); }
function slotList(a) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const n = +a[i];
    if (isFinite(n) && n >= 0 && Math.floor(n) === n && out.indexOf(n) < 0) out.push(n);
  }
  return out.sort((x, y) => x - y);
}

// ---------- 值规整：返回 undefined = 非法、拒收；null = 删除 ----------
const NORM = {
  // {dx, dy, dz, ry}；也认旧格式 [dx, dz] 和 [dx, dy, dz, ry]
  prop(v) {
    let dx = 0, dy = 0, dz = 0, ry = 0;
    if (Array.isArray(v)) {
      if (v.length === 2) { dx = v[0]; dz = v[1]; }
      else { dx = v[0]; dy = v[1]; dz = v[2]; ry = v[3] == null ? 0 : v[3]; }
    } else if (v && typeof v === 'object') {
      dx = v.dx == null ? 0 : v.dx; dy = v.dy == null ? 0 : v.dy;
      dz = v.dz == null ? 0 : v.dz; ry = v.ry == null ? 0 : v.ry;
    } else return undefined;
    if (!isNum(dx) || !isNum(dy) || !isNum(dz) || !isNum(ry)) return undefined;
    return { dx, dy, dz, ry };
  },
  // [x, y, z]；也认 {x, y, z}
  item(v) {
    const a = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : null;
    if (!a || !isNum(a[0]) || !isNum(a[1]) || !isNum(a[2])) return undefined;
    return [a[0], a[1], a[2]];
  },
  taken(v) { return v ? 1 : null; },
  // [x, y, z, type, count]；也认 {x, y, z, type, count}
  drop(v) {
    const a = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z, v.type, v.count] : null;
    if (!a || !isNum(a[0]) || !isNum(a[1]) || !isNum(a[2]) || typeof a[3] !== 'string' || !a[3]) return undefined;
    const n = a[4] == null ? 1 : Math.floor(+a[4]);
    return [a[0], a[1], a[2], a[3], isFinite(n) && n >= 1 ? n : 1];
  },
  // [open, side, takenSlots]；也认 {open, side, takenSlots | taken}
  container(v) {
    let open, side, slots;
    if (Array.isArray(v)) { open = v[0]; side = v[1]; slots = v[2]; }
    else if (v && typeof v === 'object') { open = v.open; side = v.side; slots = v.takenSlots != null ? v.takenSlots : v.taken; }
    else if (typeof v === 'boolean' || typeof v === 'number') { open = v; }
    else return undefined;
    const o = open === true ? 1 : open === false || open == null ? 0 : Math.max(0, Math.min(1, fin(open, 0)));
    const s = typeof side === 'string' || isNum(side) ? side : null;
    return [o, s, slotList(slots)];
  },
  // [v, sinceClk, extra]；也认单个数字 / 布尔和 {v, since | sinceClk, extra}
  sw(v) {
    let val, since, extra;
    if (Array.isArray(v)) { val = v[0]; since = v[1]; extra = v[2]; }
    else if (v && typeof v === 'object') { val = v.v; since = v.sinceClk != null ? v.sinceClk : v.since; extra = v.extra; }
    else { val = v; }
    val = val === true ? 1 : val === false ? 0 : val;
    if (!isNum(val)) return undefined;
    return [val, fin(since, 0), extra === undefined ? null : clone(extra)];
  },
  // {n, readyAt, left, taken, …其余字段原样}
  use(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const o = clone(v) || {};
    o.n = Math.max(0, Math.floor(fin(o.n, 0)));
    o.readyAt = fin(o.readyAt, 0);
    o.left = o.left == null || !isFinite(+o.left) ? null : Math.max(0, Math.floor(+o.left));
    const t = Array.isArray(o.taken) ? o.taken : [];
    const seen = [];
    for (let i = 0; i < t.length; i++) if ((typeof t[i] === 'string' || isNum(t[i])) && seen.indexOf(t[i]) < 0) seen.push(t[i]);
    o.taken = seen;
    return o;
  },
  // {x, z, yaw, lift, tilt, steer, carry, …}
  veh(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const o = clone(v) || {};
    if (!isNum(o.x) || !isNum(o.z)) return undefined;
    o.yaw = fin(o.yaw, 0); o.lift = fin(o.lift, 0); o.tilt = fin(o.tilt, 0); o.steer = fin(o.steer, 0);
    o.carry = o.carry === undefined ? null : o.carry;
    return o;
  },
  door(v) { return clone(v); },
  elev(v) { return clone(v); },
  npc(v) { return clone(v); },
  arrival(v) { return v && typeof v === 'object' ? clone(v) : undefined; },
};

// ---------- 存储 ----------
const levels = new Map();

function blank() {
  return {
    v: 0,
    props: new Map(), items: new Map(), taken: new Set(), drops: new Map(),
    doors: new Map(), elev: new Map(), arrivals: [], npcs: new Map(),
    containers: new Map(), switches: new Map(), uses: new Map(), vehicles: new Map(),
  };
}
function get(lv) {
  const id = lvOf(lv);
  if (id == null) return null;
  let r = levels.get(id);
  if (!r) { r = blank(); levels.set(id, r); }
  return r;
}
function peek(lv) {
  const id = lvOf(lv);
  return id == null ? null : levels.get(id) || null;
}

function emit(name, payload) { if (BR.bus) BR.bus.emit(name, payload); }

// ---------- 通用读写 ----------
function set(lv, kind, key, value, meta) {
  const k = kindOf(kind);
  const id = lvOf(lv);
  if (!k || id == null || key == null) return false;
  key = String(key);
  const del = value === null || value === undefined;
  const v = del ? null : NORM[k](value);
  if (v === undefined) {
    console.warn('[levelState] 忽略非法的值', id, k, key, value);
    return false;
  }
  const r = get(id);
  const tab = r[TABLE[k]];
  let changed;
  if (k === 'taken') {
    changed = v ? !tab.has(key) : tab.has(key);
    if (changed) { if (v) tab.add(key); else tab.delete(key); }
  } else if (k === 'arrival') {
    let i = -1;
    for (let j = 0; j < tab.length; j++) if (tab[j] && String(tab[j].key) === key) { i = j; break; }
    if (v === null) {
      changed = i >= 0;
      if (changed) tab.splice(i, 1);
    } else {
      v.key = key;
      changed = i < 0 || !same(tab[i], v);
      if (changed) { if (i < 0) tab.push(v); else tab[i] = v; }
    }
  } else {
    if (v === null) {
      changed = tab.has(key);
      if (changed) tab.delete(key);
    } else {
      changed = !tab.has(key) || !same(tab.get(key), v);
      if (changed) tab.set(key, v);
    }
  }
  const ver = meta && isNum(meta.ver) ? meta.ver : null;
  if (!changed) {
    if (ver !== null && ver > r.v) r.v = ver;
    return r.v;
  }
  // 联机镜像：带了对方的版本号就跟上它（只增不减）；本机写一次 +1
  r.v = ver !== null ? Math.max(r.v + 1, ver) : r.v + 1;
  emit('levelstate:set', { lv: id, kind: k, key, v: k === 'taken' ? (v ? 1 : null) : v, ver: r.v, src: (meta && meta.src) || 'local' });
  return r.v;
}

function getv(lv, kind, key) {
  const k = kindOf(kind);
  const r = peek(lv);
  if (!k) return undefined;
  if (k === 'taken') return !!(r && r.taken.has(String(key)));
  if (!r) return undefined;
  const tab = r[TABLE[k]];
  if (k === 'arrival') {
    for (let j = 0; j < tab.length; j++) if (tab[j] && String(tab[j].key) === String(key)) return tab[j];
    return undefined;
  }
  return tab.get(String(key));
}
function has(lv, kind, key) {
  const v = getv(lv, kind, key);
  return kindOf(kind) === 'taken' ? v : v !== undefined;
}

// ---------- 便捷写法：最前面的 lv 可省 ----------
// setX(lv, key, v) 或 setX(key, v)：第三个参数给了（哪怕是 null，表示删除）就按带 lv 的写法解释
function setter(kind) {
  return function (a, b, c) { return c !== undefined ? set(a, kind, b, c) : set(null, kind, a, b); };
}
function getter(kind) {
  return function (a, b) { return b !== undefined ? getv(a, kind, b) : getv(null, kind, a); };
}

function patchUse(a, b, c) {
  const lv = c !== undefined ? a : null, key = c !== undefined ? b : a, part = c !== undefined ? c : b;
  if (!part || typeof part !== 'object') return false;
  const old = getv(lv, 'use', key);
  return set(lv, 'use', key, Object.assign({}, old || {}, clone(part)));
}
function addArrival(a, b) {
  const lv = b !== undefined ? a : null, rec = b !== undefined ? b : a;
  if (!rec || typeof rec !== 'object') return false;
  const r = get(lv);
  const key = rec.key != null ? String(rec.key) : 'a' + (r ? r.arrivals.length : 0);
  return set(lv, 'arrival', key, rec);
}
function arrivals(lv) {
  const r = peek(lv);
  return r ? r.arrivals : [];
}

// ---------- 导出 / 导入（联机 st、调试） ----------
function exportLevel(lv) {
  const id = lvOf(lv);
  const r = peek(id);
  const out = { lv: id, v: r ? r.v : 0 };
  for (const t of MAP_TABLES) {
    const list = [];
    if (r) r[t].forEach((val, key) => list.push([key, clone(val)]));
    out[t] = list;
  }
  out.taken = r ? Array.from(r.taken) : [];
  out.arrivals = r ? clone(r.arrivals) : [];
  return out;
}

// 认 export 的格式（[[key, v], …]），也认 {key: v} 普通对象；整层替换，不合法的条目丢掉
function entriesOf(x) {
  if (Array.isArray(x)) return x.filter(e => Array.isArray(e) && e.length >= 2 && e[0] != null);
  if (x && typeof x === 'object') return Object.keys(x).map(k => [k, x[k]]);
  return [];
}
function importLevel(lv, data, meta) {
  const id = lvOf(lv != null ? lv : data && data.lv);
  if (id == null || !data || typeof data !== 'object') return false;
  const r = blank();
  const tableKind = { props: 'prop', items: 'item', drops: 'drop', doors: 'door', elev: 'elev', npcs: 'npc', containers: 'container', switches: 'sw', uses: 'use', vehicles: 'veh' };
  for (const t of MAP_TABLES) {
    const k = tableKind[t];
    for (const e of entriesOf(data[t])) {
      if (e[1] == null) continue;
      const v = NORM[k](e[1]);
      if (v !== undefined && v !== null) r[t].set(String(e[0]), v);
    }
  }
  if (Array.isArray(data.taken)) for (const t of data.taken) if (t != null) r.taken.add(String(t));
  if (Array.isArray(data.arrivals)) {
    for (const a of data.arrivals) {
      const v = NORM.arrival(a);
      if (v) r.arrivals.push(v);
    }
  }
  r.v = isNum(data.v) ? data.v : 0;
  levels.set(id, r);
  emit('levelstate:import', { lv: id, ver: r.v, src: (meta && meta.src) || 'local' });
  return r.v;
}

function clear(lv) {
  if (lv != null) {
    const id = String(lv);
    if (!levels.has(id)) return;
    levels.delete(id);
    emit('levelstate:clear', { lv: id });
    return;
  }
  if (!levels.size) return;
  levels.clear();
  emit('levelstate:clear', { lv: null });
}

// 调试 / 测试：每层各表的条目数
function info() {
  const out = {};
  levels.forEach((r, id) => {
    const o = { v: r.v, taken: r.taken.size, arrivals: r.arrivals.length };
    for (const t of MAP_TABLES) o[t] = r[t].size;
    out[id] = o;
  });
  return out;
}

// 新开一局、回主页：上一局记下的全部作废（本文件比 main.js 先注册，world.start 建区块时读到的已经是空表）
if (BR.bus) {
  BR.bus.on('game:start', () => clear());
  BR.bus.on('game:home', () => clear());
}

BR.levelState = {
  KINDS,
  kindOf,
  get levels() { return levels; },
  get,
  peek,
  current: () => peek(null),
  set,
  getv,
  has,
  setProp: setter('prop'), getProp: getter('prop'),
  setItem: setter('item'), getItem: getter('item'),
  setDrop: setter('drop'), getDrop: getter('drop'),
  take(a, b) { return b !== undefined ? set(a, 'taken', b, 1) : set(null, 'taken', a, 1); },
  untake(a, b) { return b !== undefined ? set(a, 'taken', b, null) : set(null, 'taken', a, null); },
  isTaken(a, b) { return b !== undefined ? getv(a, 'taken', b) : getv(null, 'taken', a); },
  setContainer: setter('container'), getContainer: getter('container'),
  setSwitch: setter('sw'), getSwitch: getter('sw'),
  setUse: setter('use'), getUse: getter('use'), patchUse,
  setVehicle: setter('veh'), getVehicle: getter('veh'),
  setDoor: setter('door'), getDoor: getter('door'),
  setElev: setter('elev'), getElev: getter('elev'),
  setNpc: setter('npc'), getNpc: getter('npc'),
  addArrival, arrivals,
  export: exportLevel,
  import: importLevel,
  clear,
  info,
};
})();
