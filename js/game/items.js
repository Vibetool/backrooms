// 后室 · 场景拾取物管理：地上那一份物品的模型、浮动动画、拾取进背包，以及准心候选和拖动的那一半
// 物品类型本身由 js/items/*.js 用 BR.itemTypes.register 注册；接口见 ARCHITECTURE.md 第 7、12 节
//
// 2026-10 交互大改（A1）新增：
//   spawn(type, x, y, z, { id, chunkKey, count, dropped, still, rotY, owner, parentKeys })
//     still：静止摆放（箱里、桌上、取货口），不浮动、不旋转，y 就是它底面落的高度；owner 不为空时默认 still
//     rotY：静止物品的朝向（缺省按 id 定，一排瓶子不会朝向划一）；浮动物品是起转角度
//     owner：所在容器的 key（BR.containers 的登记，D1 实现）；有 owner 的物品拿走后不写 levelState.taken，
//            由 BR.containers 记 takenSlots 并按 levelState 重建；父道具被拖动时跟着走（moveOwned / 'prop:moved'）
//     parentKeys：调用方已知的父链（准心遮挡用），和按 owner 现查的父链合并
//   记录多了 r（包围球半径）、hh（半高）、still、rotY、owner、held
//   move(id, x, y, z)、hold(id, bool)：拖动用。被抓住时停掉浮动和旋转，松手时把新位置写进 BR.levelState
//   BR.interact.addSource('items')：准心候选，球心在模型包围盒中心（底面 + 半高）
//   地上的物资被拿走写进 BR.levelState 的 taken：换层回来不复活，回主页重开才复活。clear() 不再清这份记录
//   玩家丢下的东西（dropped）记进 BR.levelState 的 drops：换层回来照原样摆回去（'level:enter'），捡走就删（2026-10-02 返修）
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const U = BR.util;

const FLOAT_BASE = 0.12;     // 模型原点在底部，整体抬高一点，浮到最低也不插进地板
const FLOAT_AMP = 0.04;
const FLOAT_SPEED = 2.2;
const SPIN_SPEED = 0.9;
const MAX_DROPPED = 30;      // 丢弃物不属于任何区块、不随区块卸载，不设上限会无限堆积
const HIT_R_MIN = 0.1;       // 准心命中球的最小半径：一两厘米宽的小东西也对得上（辅助角另外加）
const ON_FLOOR_EPS = 0.05;   // 静止物品离地面这么近才算「放在地上」，才能长按拖；箱里桌上的拖出去会悬在半空
const CHAIN_MAX = 6;         // 父链最多追几层：容器 → 箱子 → 货架格 → 货架，留点余量防环
const MOVE_EPS = 1e-3;       // 松手时位移小于这个不算挪过，不写 levelState

const list = [];
const byId = new Map();
// 本局已拿走的 id（所有层共用：world 生成的 id 带层号前缀，不会撞）。区块卸载重载、换层回来都会用同一个确定性 id 再刷，要拦住。
// 只在开新局 / 回主页时清；clear()（换层时 world 会调）不清。权威记录在 BR.levelState 的 taken，这份是本机兜底
const picked = new Set();
const dropped = [];          // 丢弃物 id，先进先出
const templates = new Map(); // type → 模板；实例 clone 共享几何和材质，手机上省显存
const infos = new Map();     // type → { hh, r, cy, hitR, vol }：按模板包围盒算一次
const scratchKeys = [];
let group = null;
let time = 0;
const sourcedTo = new WeakSet();   // 已经 addSource 过的 BR.interact 对象（测试页换掉再换回来时不重复注册）

function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function num(v, d) { v = +v; return Number.isFinite(v) ? v : d; }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function r3(v) { return Math.round(v * 1000) / 1000; }

function ensureGroup() {
  if (!group) {
    group = new THREE.Group();
    group.name = 'items';
  }
  // gfx 可能比物品晚初始化，也可能重建 scene，用之前确认挂在当前 scene 上
  const scene = BR.gfx && BR.gfx.scene;
  if (scene && group.parent !== scene) scene.add(group);
  return group;
}

// build 抛错时的兜底：黄色小方块，至少能捡，一个坏物品不至于卡住整个区块
function fallbackModel() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16).translate(0, 0.08, 0),
    new THREE.MeshLambertMaterial({ color: 0xffcc33, emissive: 0x332200 })
  );
}

function template(type) {
  let tpl = templates.get(type);
  if (tpl) return tpl;
  const def = BR.itemTypes.get(type);
  const ctx = {
    THREE, BR, assets: BR.assets, game: BR.game,
    scene: BR.gfx ? BR.gfx.scene : null,
    level: BR.world ? BR.world.current : null,
  };
  try { tpl = def.build(ctx); } catch (err) { console.error('[items] build 失败', type, err); }
  if (!tpl || !tpl.isObject3D) tpl = fallbackModel();
  templates.set(type, tpl);
  return tpl;
}

// 按模板的包围盒算一次：半高 hh、包围球半径 r、包围盒中心离原点的高度 cy、准心命中半径 hitR、体积 vol。
// 在模板自己的坐标系里算（位置和朝向清零，只保留缩放）：实例 clone 后位置和朝向都由 place 重写
function infoOf(type) {
  let inf = infos.get(type);
  if (inf) return inf;
  const tpl = template(type);
  inf = { hh: 0.08, r: 0.12, cy: 0.08, hitR: 0.12, vol: 0.004 };
  try {
    const px = tpl.position.x, py = tpl.position.y, pz = tpl.position.z;
    const rx = tpl.rotation.x, ry = tpl.rotation.y, rz = tpl.rotation.z;
    tpl.position.set(0, 0, 0);
    tpl.rotation.set(0, 0, 0);
    tpl.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tpl);
    tpl.position.set(px, py, pz);
    tpl.rotation.set(rx, ry, rz);
    tpl.updateMatrixWorld(true);
    if (!box.isEmpty()) {
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
      const ox = (box.max.x + box.min.x) / 2, oz = (box.max.z + box.min.z) / 2;
      inf.hh = sy / 2;
      inf.cy = (box.max.y + box.min.y) / 2;
      inf.r = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;
      // 球心取在原点正上方（模型会绕原点转），包围盒中心偏出原点的那一截加进半径
      inf.hitR = Math.max(HIT_R_MIN, inf.r + Math.hypot(ox, oz));
      inf.vol = Math.max(1e-4, sx * sy * sz);
    }
  } catch (err) {
    console.warn('[items] 包围盒计算失败，用默认尺寸', type, err);
  }
  infos.set(type, inf);
  return inf;
}

function place(p) {
  if (p.still) {
    p.obj.position.set(p.x, p.y, p.z);
    p.obj.rotation.y = p.rotY;
    return;
  }
  // 浮动物品被抓住时停在抓住那一刻的姿态；松手后从同一姿态接着转，不跳
  const t = (p.held ? p.heldAt : time) - p.tOff;
  p.obj.position.set(p.x, p.y + FLOAT_BASE + Math.sin(t * FLOAT_SPEED + p.phase) * FLOAT_AMP, p.z);
  p.obj.rotation.y = p.rotY + t * SPIN_SPEED;
}

function detach(p) {
  if (p.obj.parent) p.obj.parent.remove(p.obj);
  const i = list.indexOf(p);
  if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
  byId.delete(p.id);
  if (p.dropped) {
    const k = dropped.indexOf(p.id);
    if (k >= 0) dropped.splice(k, 1);
  }
}

function toast(text) {
  if (BR.hud && typeof BR.hud.toast === 'function') BR.hud.toast(text, 1500);
}

function groundAt(x, z, fallback) {
  if (has(BR.phys, 'groundY')) {
    const g = +BR.phys.groundY(x, z);
    if (Number.isFinite(g)) return g;
  }
  return fallback;
}

function coopGuest() {
  const c = BR.game.coop;
  if (c && c.active) return c.role === 'guest';
  return !!(BR.coop && BR.coop.active && BR.coop.role === 'guest');
}

// 联机租约：'i:'+id 被队友拿着（拖着）时，本机不能捡也不能拖。
// BR.coop.leaseOf(k) 返回 null | 持有者（'host' / 'guest' 字符串，或带 by 字段的对象）；和自己的角色不同就是队友
function heldByOther(k) {
  const C = BR.coop;
  if (!C || !C.active || !has(C, 'leaseOf')) return false;
  let L;
  try { L = C.leaseOf(k); } catch (err) { return false; }
  if (L == null || L === false) return false;
  const by = typeof L === 'object' ? L.by : L;
  if (by == null || by === true) return false;
  return !(by === 'me' || by === C.role);
}

// ---------- BR.levelState 适配 ----------
// levelState 由 js/game/levelstate.js 提供（A1-world-state）；没有它时（独立测试页）只靠本机 picked 兜底
function LS() { const L = BR.levelState; return L && typeof L === 'object' ? L : null; }
function lvKey() { return String(BR.game.levelId); }
function lvState(L) {
  if (!has(L, 'get')) return null;
  try { return L.get(lvKey()) || null; } catch (err) { return null; }
}
function lsIsTaken(id) {
  const L = LS();
  if (!L) return false;
  try {
    if (has(L, 'isTaken')) return !!L.isTaken(lvKey(), id);
    if (has(L, 'hasTaken')) return !!L.hasTaken(lvKey(), id);
  } catch (err) { return false; }
  const st = lvState(L), s = st && st.taken;
  if (!s) return false;
  return has(s, 'has') ? s.has(id) : Array.isArray(s) && s.indexOf(id) >= 0;
}
function lsTake(id) {
  const L = LS();
  if (!L) return false;
  try {
    if (has(L, 'setTaken')) { L.setTaken(lvKey(), id, true); return true; }
    if (has(L, 'take')) { L.take(lvKey(), id); return true; }
    if (has(L, 'addTaken')) { L.addTaken(lvKey(), id); return true; }
  } catch (err) { console.error('[items] levelState 记拿走失败', id, err); return false; }
  const st = lvState(L), s = st && st.taken;
  if (s && has(s, 'add')) { s.add(id); return true; }
  return false;
}
function validXYZ(v) { return Array.isArray(v) && v.length >= 3 && isNum(+v[0]) && isNum(+v[1]) && isNum(+v[2]); }
function lsGetItem(id) {
  const L = LS();
  if (!L) return null;
  let v = null;
  try {
    if (has(L, 'getItem')) v = L.getItem(lvKey(), id);
    else { const st = lvState(L); v = st && st.items && has(st.items, 'get') ? st.items.get(id) : null; }
  } catch (err) { return null; }
  return validXYZ(v) ? v : null;
}
function lsSetItem(id, v) {
  const L = LS();
  if (!L) return false;
  try {
    if (has(L, 'setItem')) { L.setItem(lvKey(), id, v); return true; }
    const st = lvState(L);
    if (st && st.items && has(st.items, 'set')) { st.items.set(id, v); return true; }
  } catch (err) { console.error('[items] levelState 记位置失败', id, err); }
  return false;
}

// 丢弃物（玩家按 Q 丢的）记在 levelState 的 drops 表：[x, y, z, type, count]。换层回来由 restoreDrops 照原样摆回去，
// 被捡走、或丢的太多被挤掉时删掉。联机时不能丢弃（player.js），客机不写
function lsDropSet(p) {
  const L = LS();
  if (!L || !has(L, 'set') || coopGuest()) return false;
  try { return L.set(lvKey(), 'drop', p.id, [r3(p.x), r3(p.y), r3(p.z), p.type, p.count]) !== false; }
  catch (err) { console.error('[items] levelState 记丢弃物失败', p.id, err); return false; }
}
function lsDropDel(id) {
  const L = LS();
  if (!L || !has(L, 'set') || coopGuest()) return false;
  try { return L.set(lvKey(), 'drop', id, null) !== false; }
  catch (err) { console.error('[items] levelState 删丢弃物失败', id, err); return false; }
}
// 进层（换层回来）：把这一层记着的丢弃物照原样摆回去。工坊编辑态不刷物品
function restoreDrops(e) {
  const L = LS();
  if (!L || !has(L, 'peek') || (BR.workshop && BR.workshop.editing)) return;
  const lv = e && e.id != null ? String(e.id) : lvKey();
  if (lv !== lvKey()) return;
  let st = null;
  try { st = L.peek(lv); } catch (err) { st = null; }
  const ds = st && st.drops;
  if (!ds || !ds.size) return;
  Array.from(ds.entries()).forEach(([id, v]) => {
    if (byId.has(id) || !Array.isArray(v) || !BR.itemTypes.has(v[3])) return;
    BR.items.spawn(v[3], v[0], v[1], v[2], { id, dropped: true, count: v[4], restore: true });
  });
}

// 地上的物资（不是丢弃物、不在容器里）挪过之后写进 levelState；客机不写，等房主核对后广播（coop 负责）。丢弃物改它自己那条
function commit(p) {
  if (p.dropped) return lsDropSet(p);
  if (p.owner || coopGuest()) return false;
  const v = [r3(p.x), r3(p.y), r3(p.z)];
  const old = lsGetItem(p.id);
  if (old && Math.abs(old[0] - v[0]) < MOVE_EPS && Math.abs(old[1] - v[1]) < MOVE_EPS && Math.abs(old[2] - v[2]) < MOVE_EPS) return false;
  return lsSetItem(p.id, v);
}

// 整件拿走（进了自己背包，或被队友拿走）
function take(p, by) {
  picked.add(p.id);
  detach(p);
  // 地上的物资记进 levelState.taken；容器里的交给 BR.containers 记 takenSlots（听 item:taken）；客机等房主广播。
  // 丢弃物删掉它在 drops 表里那条（拿走了就不再摆回来）
  if (p.dropped) lsDropDel(p.id);
  else if (!p.owner && !coopGuest()) lsTake(p.id);
  BR.bus.emit('item:taken', { id: p.id, type: p.type, owner: p.owner, chunkKey: p.chunkKey, by });
}

// ---------- 父链（准心遮挡、跟着父道具走） ----------
const KEY_RE = /@(-?\d+),(-?\d+)#/;
function findKey(arr, k) {
  if (!Array.isArray(arr)) return null;
  for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].key === k) return arr[i];
  return null;
}
// 按 key 找登记记录：BR.containers（D1）→ BR.world.propByKey → 已载入区块的 res.kit 里直接找
function recOf(k) {
  const C = BR.containers, W = BR.world;
  let r = null;
  try {
    if (has(C, 'byKey')) r = C.byKey(k);
    if (!r && has(W, 'propByKey')) r = W.propByKey(k);
    if (!r && has(W, 'containerByKey')) r = W.containerByKey(k);
  } catch (err) { r = null; }
  if (r || !has(W, 'chunks')) return r || null;
  const m = KEY_RE.exec(k);
  const cs = W.chunks();
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (m && (c.cx !== +m[1] || c.cz !== +m[2])) continue;
    const kit = c.res && c.res.kit;
    if (!kit) continue;
    r = findKey(kit.containers, k) || findKey(kit.fixtures, k) || findKey(kit.props, k);
    if (!r && Array.isArray(kit.props)) {
      for (let j = 0; j < kit.props.length && !r; j++) r = kit.props[j] && findKey(kit.props[j].parts, k);
    }
    if (r) return r;
  }
  return null;
}
function parentOf(k) {
  const rec = recOf(k);
  if (rec) {
    const pk = rec.parentKey != null ? rec.parentKey
      : (rec.parent != null && typeof rec.parent !== 'object') ? rec.parent
      : (typeof rec.on === 'string' ? rec.on : null);
    if (pk != null && pk !== '') return String(pk);
  }
  // 找不到记录时按 key 的写法推：货架格子 'rackKey#slot'、部件 'propKey#…' 的父亲是去掉最后一段的那个 key
  const a = k.indexOf('#'), b = k.lastIndexOf('#');
  return a >= 0 && b > a ? k.slice(0, b) : null;
}
function chainOf(p, out) {
  out.length = 0;
  let k = p.owner;
  for (let d = 0; k && d < CHAIN_MAX; d++) {
    if (out.indexOf(k) >= 0) break;
    out.push(k);
    k = parentOf(k);
  }
  if (p.parentKeys) for (let i = 0; i < p.parentKeys.length; i++) if (out.indexOf(p.parentKeys[i]) < 0) out.push(p.parentKeys[i]);
  return out;
}

// 托着这件物品的那件道具：父链里第一个 world 认得的道具 key（容器 key 本身不是道具时往上找一层）
function holderOf(chain) {
  const W = BR.world;
  if (has(W, 'propByKey')) {
    for (let i = 0; i < chain.length; i++) {
      let r = null;
      try { r = W.propByKey(chain[i]); } catch (err) { r = null; }
      if (r) return chain[i];
    }
  }
  return chain[0];
}

// 父道具被挪动 / 叉起时，放在它里面的物品跟着走。返回挪了几件。
//   key：被挪的道具 key（world 'prop:moved' 的根 key）；dx/dy/dz：这一步的增量。
//   opts.keys：这一步一起挪的整组道具 key（根 + 还放在上面的子孙）。给了就只挪「托着它的那件道具」在组里的物品——
//     被单独拖开过的子道具不在组里，它里面的东西不跟着父道具走；没给就按「父链里有 key」判断。
//   opts.dry + opts.x / opts.z：再绕 (x, z) 转 dry 弧度（和 three.js rotation.y 同向），静止物品的朝向一起转（D2 / F1 才用到）
function moveOwned(key, dx, dy, dz, opts) {
  if (key == null) return 0;
  key = String(key);
  const o = opts && typeof opts === 'object' ? opts : {};
  dx = num(dx, 0); dy = num(dy, 0); dz = num(dz, 0);
  const dry = num(o.dry, 0), px = num(o.x, NaN), pz = num(o.z, NaN);
  const rot = dry !== 0 && isNum(px) && isNum(pz);
  if (!dx && !dy && !dz && !rot) return 0;
  const keys = Array.isArray(o.keys) && o.keys.length ? o.keys.map(String) : null;
  const c = Math.cos(dry), s = Math.sin(dry);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.owner && !p.parentKeys) continue;
    chainOf(p, scratchKeys);
    if (!scratchKeys.length) continue;
    if (keys ? keys.indexOf(holderOf(scratchKeys)) < 0 : scratchKeys.indexOf(key) < 0) continue;
    p.x += dx; p.y += dy; p.z += dz;
    if (rot) {
      const lx = p.x - px, lz = p.z - pz;
      p.x = px + lx * c + lz * s;
      p.z = pz - lx * s + lz * c;
      p.rotY += dry;
    }
    place(p);
    n++;
  }
  scratchKeys.length = 0;
  return n;
}

// ---------- 准心候选 ----------
function nameOf(type) {
  const def = BR.itemTypes.get(type);
  return (def && def.zh) || String(type || '物品');
}
function canAdd(type) {
  const P = BR.player;
  if (!has(P, 'canAdd')) return true;
  try { return !!P.canAdd(type); } catch (err) { return true; }
}
// 能不能长按拖：浮在地上的照旧能拖；静止摆放的只有直接放在地面上的能拖（箱里、桌上的拖出去会悬在半空）；容器里的不能拖
function draggable(p) {
  if (p.owner) return false;
  if (!p.still) return true;
  return Math.abs(p.y - groundAt(p.x, p.z, p.y)) <= ON_FLOOR_EPS;
}
function assistTan() {
  const c = BR.config.interact || {};
  const touch = !!(BR.input && BR.input.isTouch);
  const deg = num(touch ? c.assistDegTouch : c.assistDeg, touch ? 5 : 2.5);
  return Math.tan(U.clamp(deg, 0, 30) * Math.PI / 180);
}
// 每件物品一个复用的候选对象，每帧原地改，不分配
function candOf(p, t, inf) {
  let c = p.cand;
  if (!c) {
    c = p.cand = {
      kind: 'item', key: p.id, label: '', t: 0, small: true,
      short: { verb: '拾取', ok: true, why: null }, hold: null,
      canDrag: false, vol: inf.vol, ref: p, parentKeys: [],
    };
  }
  c.label = nameOf(p.type);
  c.t = t;
  const other = heldByOther('i:' + p.id);
  const full = !other && !canAdd(p.type);
  c.short.ok = !other && !full;
  c.short.why = other ? '队友正拿着它' : full ? '背包已满' : null;
  c.canDrag = !other && draggable(p);
  chainOf(p, c.parentKeys);
  return c;
}
// ray = { ox, oy, oz, dx, dy, dz }（方向已归一化）；命中的物品按射线进入包围球的距离 t 推进 out
function itemSource(ray, reach, out) {
  const n = list.length;
  if (!n || !ray) return;
  const P = BR.player;
  if (P && P.dead) return;
  const ox = +ray.ox, oy = +ray.oy, oz = +ray.oz;
  let dx = +ray.dx, dy = +ray.dy, dz = +ray.dz;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-9) || !Number.isFinite(ox + oy + oz)) return;
  dx /= L; dy /= L; dz /= L;
  const R = num(reach, 2.6);
  // interact 填好的 ray.assistTan（桌面 2.5°、触屏 5°）优先，和它自己的 hit.sphere 同一个口径
  const aTan = isNum(ray.assistTan) ? ray.assistTan : assistTan();
  for (let i = 0; i < n; i++) {
    const p = list[i];
    const o = p.obj;
    if (!o || o.visible === false || !o.parent) continue;
    const inf = infoOf(p.type);
    const r = inf.hitR;
    const lx = o.position.x - ox, ly = o.position.y + inf.cy - oy, lz = o.position.z - oz;
    const l2 = lx * lx + ly * ly + lz * lz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (l2 > r * r && (tca <= 0 || tca - r > R)) continue;   // 在身后或够不着（眼睛在球里算 t = 0）
    const d2 = Math.max(0, l2 - tca * tca);
    let t;
    if (l2 <= r * r) t = 0;
    else if (d2 <= r * r) t = tca - Math.sqrt(r * r - d2);
    else {
      // 小目标瞄准辅助：射线差一点没擦到球，但在 assistDeg 的锥里也算
      const rr = r + Math.max(0, tca) * aTan;
      if (d2 > rr * rr) continue;
      t = tca - r;
    }
    if (t < 0) t = 0;
    if (t > R) continue;
    out.push(candOf(p, t, inf));
  }
}
function ensureSource() {
  const I = BR.interact;
  if (!I || typeof I !== 'object' || sourcedTo.has(I) || !has(I, 'addSource')) return;
  sourcedTo.add(I);
  try { I.addSource('items', itemSource); }
  catch (err) { console.error('[items] 注册准心候选失败', err); }
}

// ---------- 对外 ----------
BR.items = {
  list,
  get group() { return ensureGroup(); },

  // opts: { id, chunkKey, count, dropped, still, rotY, owner, parentKeys, restore }（restore：从 levelState.drops 摆回来的丢弃物，不再回写）
  //   id 由 world.js 按区块确定性生成，联机两边才对得上；容器里的物品由 BR.containers 用 `${containerKey}#c${slot}`
  spawn(type, x, y, z, opts) {
    const o = opts || {};
    if (!BR.itemTypes.has(type)) { console.warn('[items] 未注册的物品类型', type); return null; }
    const id = o.id != null ? String(o.id) : U.uid('it');
    if (picked.has(id)) return null;
    if (byId.has(id)) return byId.get(id);
    const owner = o.owner != null && o.owner !== '' ? String(o.owner) : null;
    // 区块刷出来的地上物资：本层本局拿走过就不再刷，挪过的放在挪到的地方（world.spawnItems 也会先查，这里兜底）
    if (o.chunkKey != null && !owner && !o.dropped) {
      if (lsIsTaken(id)) return null;
      const at = lsGetItem(id);
      if (at) { x = +at[0]; y = +at[1]; z = +at[2]; }
    }
    x = +x; z = +z;
    if (!isNum(x) || !isNum(z)) { console.warn('[items] spawn 坐标无效', type, x, z); return null; }
    if (!isNum(y)) y = groundAt(x, z, 0);
    const obj = template(type).clone(true);
    obj.userData.pickupId = id;
    const inf = infoOf(type);
    // 按 id 定相位：一排物品不会整齐划一地上下，联机两边节奏也一致
    const phase = (U.hashStr(id) % 6283) / 1000;
    const p = {
      id, type, x, y, z, obj,
      chunkKey: o.chunkKey != null ? o.chunkKey : null,
      count: Math.max(1, o.count | 0),
      dropped: !!o.dropped,
      phase,
      still: o.still != null ? !!o.still : owner != null,
      rotY: isNum(o.rotY) ? o.rotY : phase,
      owner,
      parentKeys: Array.isArray(o.parentKeys) && o.parentKeys.length ? o.parentKeys.map(String) : null,
      r: inf.r, hh: inf.hh,
      held: false, heldAt: 0, tOff: 0, from: null,
      cand: null,
    };
    place(p);
    ensureGroup().add(obj);
    list.push(p);
    byId.set(id, p);
    if (p.dropped) {
      dropped.push(id);
      // 新丢的记进 levelState（换层回来还在）；从记录里摆回来的不用再写
      if (!o.restore) lsDropSet(p);
      while (dropped.length > MAX_DROPPED) {
        const old = byId.get(dropped[0]);
        if (old) { lsDropDel(old.id); detach(old); } else dropped.shift();
      }
    }
    return p;
  },

  find(id) { return byId.get(String(id)) || null; },

  remove(id) {
    const p = byId.get(String(id));
    if (!p) return false;
    detach(p);
    return true;
  },

  removeChunk(chunkKey) {
    const key = String(chunkKey);
    // 倒序遍历：detach 是交换删除，换到当前位置的元素已经检查过
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.chunkKey != null && String(p.chunkKey) === key) detach(p);
    }
  },

  // 换层、回主页时清场景。不清"拿走过"的记录：地上捡过的换层回来不复活（记录在 levelState 和本机 picked，开新局才清）；
  // 容器里的物品也一并拿掉，建块时由 BR.containers 按 levelState 重建
  clear() {
    for (let i = list.length - 1; i >= 0; i--) detach(list[i]);
    dropped.length = 0;
  },

  nearest(x, z, maxDist) {
    let best = null;
    let bd = maxDist == null ? Infinity : maxDist * maxDist;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const d = U.dist2(x, z, p.x, p.z);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  },

  // by = 'me'：进自己背包；'peer'：联机对方捡走了，只从场景移除
  pick(id, by) {
    const p = byId.get(String(id));
    if (!p) return false;
    if (by === 'peer') {
      take(p, 'peer');
      return true;
    }
    if (heldByOther('i:' + p.id)) { toast('队友正拿着它'); return false; }
    const player = BR.player;
    if (!player || typeof player.addItem !== 'function') return false;
    const added = player.addItem(p.type, p.count);
    if (added <= 0) { toast('背包已满'); return false; }
    if (added < p.count) {
      // 只装得下一部分，剩下的留在原地
      p.count -= added;
      if (p.dropped) lsDropSet(p);
      toast('背包已满');
    } else {
      take(p, 'me');
    }
    if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play('pickup');
    BR.bus.emit('item:pickup', { type: p.type, id: p.id, count: added, owner: p.owner });
    return true;
  },

  // 拖动中每帧调用（interact），或联机回放房主核对过的位置。y 不传就落到地面。
  // 不在拖动中的一次性挪动直接写 levelState；拖动中的等 hold(id, false) 松手时一次写
  move(id, x, y, z) {
    const p = byId.get(String(id));
    if (!p) return false;
    x = +x; z = +z;
    if (!isNum(x) || !isNum(z)) return false;
    p.x = x; p.z = z;
    p.y = isNum(y) ? y : groundAt(x, z, p.y);
    place(p);
    if (!p.held) commit(p);
    return true;
  },

  // 抓住 / 松开：抓住时停掉浮动和旋转；松开时挪过就把新位置写进 levelState
  hold(id, on) {
    const p = byId.get(String(id));
    if (!p) return false;
    on = !!on;
    if (on === p.held) return true;
    if (on) {
      p.held = true;
      p.heldAt = time;
      p.from = [p.x, p.y, p.z];
    } else {
      p.held = false;
      p.tOff += time - p.heldAt;
      const f = p.from;
      p.from = null;
      if (f && (Math.abs(f[0] - p.x) > MOVE_EPS || Math.abs(f[1] - p.y) > MOVE_EPS || Math.abs(f[2] - p.z) > MOVE_EPS)) commit(p);
    }
    place(p);
    return true;
  },

  // (key, dx, dy, dz, { keys, dry, x, z }?) → 挪了几件。world 的 'prop:moved' 已经接上，一般不用直接调
  moveOwned,
  // 准心遮挡用的父链：[owner, 容器的父道具, …] + spawn 时给的 parentKeys
  parentKeys(id) {
    const p = byId.get(String(id));
    return p ? chainOf(p, []) : [];
  },
  // 按类型的尺寸：{ hh 半高, r 包围球半径, cy 包围盒中心高度, hitR 准心命中半径, vol 体积 m³ }
  info(type) { return BR.itemTypes.has(type) ? Object.assign({}, infoOf(type)) : null; },
  // 本局本机记过拿走没有（测试用；权威记录在 levelState.taken）
  wasTaken(id) { return picked.has(String(id)); },

  update(dt) {
    time += dt;
    ensureGroup();
    ensureSource();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.still && !p.held) place(p);
    }
  },
};

// 开新局 / 回主页：上一局拿走过的记录作废（levelState 那份由 levelstate.js 自己清）
function resetSession() { picked.clear(); }
BR.bus.on('game:start', resetSession);
BR.bus.on('game:home', resetSession);
// 换层回来：丢在这一层的东西照原样摆回去（world 建完出生点周围的区块后发 'level:enter'）
BR.bus.on('level:enter', restoreDrops);

// 父道具被挪动（增量）：world 在 movePropTo / commitProp 里发 { lv, key, keys, dx, dy, dz, dry, x, y, z, final }
BR.bus.on('prop:moved', e => { if (e && e.key != null) moveOwned(e.key, e.dx, e.dy, e.dz, e); });

// 联机回放：房主核对过的物品位置经 levelState 写进来时，本机跟着挪（自己正拖着的不动）
BR.bus.on('levelstate:set', e => {
  if (!e || (e.kind !== 'item' && e.kind !== 'items')) return;
  if (e.lv != null && String(e.lv) !== lvKey()) return;
  const p = byId.get(String(e.key));
  if (!p || p.held || !validXYZ(e.v)) return;
  const x = +e.v[0], y = +e.v[1], z = +e.v[2];
  if (Math.abs(p.x - x) < MOVE_EPS && Math.abs(p.y - y) < MOVE_EPS && Math.abs(p.z - z) < MOVE_EPS) return;
  p.x = x; p.y = y; p.z = z;
  place(p);
});

ensureSource();
})();
