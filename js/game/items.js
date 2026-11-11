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
//   floorLift(id)（FE1 返修 r14）：放在地上时原点比地面高多少 —— 静静躺着的 = −rest(type).bot（放得稳的样子最低顶点贴地），浮着的 = 0；
//     move 不给 y 时按它落地，interact 拖地上的物资按它跟着地面走（以前直接放到地面高度，火盐陷进地里 18.5 mm）
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
const infos = new Map();     // type → { hh, r, cy, hitR, vol, bot }：按模板包围盒算一次
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

// 按模板的包围盒算一次：半高 hh、包围球半径 r、包围盒中心离原点的高度 cy、准心命中半径 hitR、体积 vol、
// 包围盒底面离原点的高度 bot（FE1 返修 r8：PTG-B 针筒的原点在底面上方 1.7 cm，bot = −0.017；叉车货叉上摆放、甩出去落地时按它让底面贴住）。
// 在模板自己的坐标系里算（位置和朝向清零，只保留缩放）：实例 clone 后位置和朝向都由 place 重写
function infoOf(type) {
  let inf = infos.get(type);
  if (inf) return inf;
  const tpl = template(type);
  inf = { hh: 0.08, r: 0.12, cy: 0.08, hitR: 0.12, vol: 0.004, bot: 0 };
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
      inf.bot = box.min.y;
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

// ---------- 放得稳的静止姿态（FE1 返修 r12，主会话裁定 B）----------
// 静止摆放（地上、货叉上、柱础 / 矮东西顶上、甩出去落地、车推开、手放下；不在容器里）时按这个姿态摆：重心（模型三角面按面积加权的质心）的竖直投影
// 落在「离支撑面 ≤2 mm 的那些顶点」围成的凸包里，往里至少 3 mm。大多数物资直立就站得稳（姿态 = 不歪）；站不稳的（PTG-B 针筒只靠指托下沿立着、
// 针管悬空，重心在支点前 7 cm；火盐、闪电瓶的底是尖的；蛾子果冻罐底往外鼓 3 mm）按真实刚体倒下去的样子算：绕「离重心最近的那条支撑边」往重心那边转，
// 转到下一个顶点碰到支撑面为止，重复到重心落进支撑范围里（PTG-B 往针头那边歪约 7°，指托下沿和针帽一起着地 —— 真针筒放在桌上就是这样斜躺着）。
// 姿态只含前后、左右的歪（rx 绕模型 x、rz 绕模型 z，Euler 顺序 'YXZ'：先歪、再绕竖直轴转 rotY），绕竖直轴的朝向照旧自由。
// 按模板量一次（模型自己的坐标、带模板的缩放）：{ rx, rz, bot（这个姿态下最低点离原点多高）, com（质心，同一坐标）, hull（支撑凸包 [[x, z]…]）, inset（重心离凸包边最近多远，米） }
const REST_TOL = 0.002, REST_IN = 0.003;
const rests = new Map();
function rotAxis(ax, ay, az, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay, t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax, t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c];
}
function mul3(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
  return o;
}
function app3(R, x, y, z) { return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z]; }
// 平面点集 [[x, z]…] 的凸包（逆时针，共线的点去掉）
function hullXZ(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
  for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// 点 (x, z) 离凸包 h 的边最近多远：在里面为正、外面为负；凸包退化（少于 3 点）按 −（到它的距离）算
function insetXZ(h, x, z) {
  if (h.length >= 3) {
    let m = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      m = Math.min(m, ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) / L);
    }
    return m;
  }
  if (!h.length) return -Infinity;
  if (h.length === 1) return -Math.hypot(x - h[0][0], z - h[0][1]);
  const a = h[0], b = h[1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return -Math.hypot(x - a[0] - u * dx, z - a[1] - u * dz);
}
// 凸包上离 (x, z) 最近的点
function nearestOnHull(h, x, z) {
  if (h.length === 1) return h[0].slice();
  let best = null, bd = Infinity;
  const n = h.length;
  for (let i = 0; i < (n === 2 ? 1 : n); i++) {
    const a = h[i], b = h[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    const qx = a[0] + u * dx, qz = a[1] + u * dz, d = Math.hypot(x - qx, z - qz);
    if (d < bd) { bd = d; best = [qx, qz]; }
  }
  return best;
}
// 不是实物的网格（FE1P H6，验收员 ⑳c：火盐外面那层半透明光晕球被当成实物算支撑和重心，晶体簇像靠着一团光歪着立）：
// 半透明光晕、发光球、瓶里的闪电这类「光」，物资文件 build 时给网格标 userData.glow = true（现在有火盐的光晕、瓶装闪电三种的闪电和瓶内光晕）。
// 放得稳的静止姿态（支撑点、重心）、vehicles.js 车推 / 摆货叉 / 甩货用的外形都只算实物网格；准心命中球、包围盒（info）照旧按整个模型（看得见的都瞄得到）
function solidMesh(n) { return !!(n && n.isMesh) && !(n.userData && n.userData.glow); }
// 模型（模板坐标，带缩放）的顶点、三角形 → 质心。只算实物网格（solidMesh）
function meshOf(tpl) {
  const V = [], T = [];
  tpl.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  tpl.traverse(n => {
    if (!solidMesh(n)) return;
    const g = n && n.isMesh && n.geometry, pos = g && g.attributes && g.attributes.position;
    if (!pos || typeof pos.getX !== 'function') return;
    const i0 = V.length / 3;
    for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(n.matrixWorld); V.push(v.x, v.y, v.z); }
    const idx = g.index, nt = Math.floor((idx ? idx.count : pos.count) / 3);
    for (let t = 0; t < nt; t++) T.push(i0 + (idx ? idx.getX(3 * t) : 3 * t), i0 + (idx ? idx.getX(3 * t + 1) : 3 * t + 1), i0 + (idx ? idx.getX(3 * t + 2) : 3 * t + 2));
  });
  let A = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
    const ar = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    A += ar; cx += ar * (V[a] + V[b] + V[c]); cy += ar * (V[a + 1] + V[b + 1] + V[c + 1]); cz += ar * (V[a + 2] + V[b + 2] + V[c + 2]);
  }
  if (!(A > 0)) { const n = V.length / 3 || 1; cx = cy = cz = 0; for (let i = 0; i < V.length; i += 3) { cx += V[i]; cy += V[i + 1]; cz += V[i + 2]; } return { V, com: [cx / n, cy / n, cz / n] }; }
  return { V, com: [cx / (3 * A), cy / (3 * A), cz / (3 * A)] };
}
// 在姿态 R（3×3，行优先）下：最低点、离它 ≤tol 的顶点的水平凸包、重心离凸包边多远
function supportOf(V, com, R, tol) {
  let y0 = Infinity;
  const W = new Array(V.length);
  for (let i = 0; i < V.length; i += 3) { const w = app3(R, V[i], V[i + 1], V[i + 2]); W[i] = w[0]; W[i + 1] = w[1]; W[i + 2] = w[2]; if (w[1] < y0) y0 = w[1]; }
  const pts = [];
  for (let i = 0; i < W.length; i += 3) if (W[i + 1] <= y0 + tol) pts.push([W[i], W[i + 2]]);
  const h = hullXZ(pts), G = app3(R, com[0], com[1], com[2]);
  return { W, y0, h, G, inset: insetXZ(h, G[0], G[2]) };
}
function computeRest(type) {
  const r = { rx: 0, rz: 0, bot: 0, com: [0, 0, 0], hull: [], inset: 0 };
  const tpl = template(type);
  const px = tpl.position.x, py = tpl.position.y, pz = tpl.position.z, ox = tpl.rotation.x, oy = tpl.rotation.y, oz = tpl.rotation.z;
  tpl.position.set(0, 0, 0); tpl.rotation.set(0, 0, 0);
  let M;
  try { M = meshOf(tpl); } finally { tpl.position.set(px, py, pz); tpl.rotation.set(ox, oy, oz); tpl.updateMatrixWorld(true); }
  const V = M.V, com = M.com;
  if (V.length < 9) return r;
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let it = 0; it < 16; it++) {
    const s = supportOf(V, com, R, REST_TOL);
    if (s.inset >= REST_IN + 0.0005) break;
    // 真正碰着的（0.1 mm 以内）：离重心投影最近的那条支撑边（或那一点）就是倒下去时绕着转的棱
    const c = supportOf(V, com, R, 1e-4), q = nearestOnHull(c.h, c.G[0], c.G[2]);
    let dx = c.G[0] - q[0], dz = c.G[2] - q[1], L = Math.hypot(dx, dz);
    const cands = [];
    if (L > 1e-6) cands.push([dx / L, dz / L]);
    else for (let k = 0; k < 16; k++) cands.push([Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);   // 重心正好在棱上：哪边转得最少往哪边倒
    let best = null;
    for (const d of cands) {
      let phi = Infinity;
      for (let i = 0; i < c.W.length; i += 3) {
        const rd = (c.W[i] - q[0]) * d[0] + (c.W[i + 2] - q[1]) * d[1], ry = c.W[i + 1] - c.y0;
        if (rd > 1e-6 && ry > 1e-7) phi = Math.min(phi, Math.atan2(ry, rd));
      }
      if (phi < Infinity && (!best || phi < best[0])) best = [phi, d];
    }
    if (!best) break;
    // 绕水平轴 (dz, 0, −dx) 转 φ：d 那一边往下
    R = mul3(rotAxis(best[1][1], 0, -best[1][0], best[0]), R);
  }
  // 只留前后、左右的歪（'YXZ' 顺序的 x、z），绕竖直轴的那部分丢掉（朝向由 rotY 定）
  const m4 = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  const e = new THREE.Euler().setFromRotationMatrix(m4, 'YXZ');
  r.rx = Math.abs(e.x) < 1e-6 ? 0 : e.x; r.rz = Math.abs(e.z) < 1e-6 ? 0 : e.z;
  const Rr = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r.rx, 0, r.rz, 'YXZ')).elements;
  const R3 = [Rr[0], Rr[4], Rr[8], Rr[1], Rr[5], Rr[9], Rr[2], Rr[6], Rr[10]];
  const s = supportOf(V, com, R3, REST_TOL);
  r.bot = s.y0; r.com = s.G; r.hull = s.h; r.inset = s.inset;
  // 歪着摆的模型绕原点转过，准心命中球（球心在原点正上方 cy）要多包一点：|cy|·2 sin(φ/2)（φ = 歪了多少）
  const tr = Math.max(-1, Math.min(1, (R3[0] + R3[4] + R3[8] - 1) / 2));
  r.hitAdd = 2 * Math.abs(infoOf(type).cy) * Math.sin(Math.acos(tr) / 2);
  return r;
}
function restOf(type) {
  let r = rests.get(type);
  if (r) return r;
  try { r = computeRest(type); } catch (err) { console.warn('[items] 静止姿态计算失败，按直立摆', type, err); r = { rx: 0, rz: 0, bot: infoOf(type).bot, com: [0, infoOf(type).cy, 0], hull: [], inset: 0, hitAdd: 0 }; }
  rests.set(type, r);
  return r;
}
// 这件按「放得稳的静止姿态」摆吗：静止、不在容器里（容器、取货口里的照原样）
function rests_(p) { return !!p.still && !p.owner; }
// 放在地上时原点比地面高多少（FE1 返修 r14，验收员 play：长按拖动甩出去落地的火盐，原点被直接放到地面高度，晶体尖陷进地里 18.5 mm）：
// 静静躺着的按放得稳的静止姿态最低顶点贴地（−rest(type).bot：火盐 13 mm、PTG-B 5.1 mm）；浮着转圈的原点就在地面上（浮起来的高度 place 里加）。
// 最低顶点比原点高的（bot > 0）原点就在地面下面一点（FE1P H13：以前夹到 ≥0，那时立着的糖果袋底封口在原点上方 2.5 mm、浮起 0.7 mm）。
// 返修 r1 起糖果袋倒平（bot −32.5 mm），现在 32 种物资没有 bot 明显大于 0 的（最大是曲奇 / 口粮的 1e-10 m 级舍入），这条分支留着防以后的模型
function floorLift(p) { return rests_(p) ? -num(restOf(p.type).bot, 0) : 0; }

function place(p) {
  if (p.still) {
    p.obj.position.set(p.x, p.y, p.z);
    if (rests_(p)) {
      const r = restOf(p.type);
      if (r.rx || r.rz) { p.obj.rotation.set(r.rx, p.rotY, r.rz, 'YXZ'); p.restOn = true; return; }
    }
    if (p.restOn) { p.obj.rotation.set(0, p.rotY, 0, 'XYZ'); p.restOn = false; return; }
    p.obj.rotation.y = p.rotY;
    return;
  }
  if (p.restOn) { p.obj.rotation.set(0, p.obj.rotation.y, 0, 'XYZ'); p.restOn = false; }
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
// 被捡走、或丢的太多被挤掉时删掉。联机时不能丢弃（player.js），客机不写。
// 静静躺着的（still、不在容器里：货叉上的、甩出去落地的、车推开的、手放下的）多记一项朝向 rotY（弧度，4 位小数；FE1 返修 r12 裁定 D）：
// [x, y, z, type, count, rotY]，换层回来、联机另一边按记的朝向静静摆回去；浮着转圈的照旧 5 项（朝向按 id 定）
function r4(v) { return Math.round(v * 1e4) / 1e4; }
// 静静躺着的 y 记到 0.1 mm（返修 r14：按 1 mm 取整，换层回来最低顶点会离地 ±0.5 mm —— 火盐陷进地里 0.5 mm）
function dropRec(p) {
  const v = [r3(p.x), p.still && !p.owner ? r4(p.y) : r3(p.y), r3(p.z), p.type, p.count];
  if (p.still && !p.owner && isNum(p.rotY)) v.push(r4(Math.atan2(Math.sin(p.rotY), Math.cos(p.rotY))));
  return v;
}
function lsDropSet(p) {
  const L = LS();
  if (!L || !has(L, 'set') || coopGuest()) return false;
  try { return L.set(lvKey(), 'drop', p.id, dropRec(p)) !== false; }
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
    // 第 6 项是朝向（返修 r12）：静静躺着、按记的朝向摆；旧格式 5 项照旧（浮着转圈，朝向按 id 定）
    const o = { id, dropped: true, count: v[4], restore: true };
    if (v.length >= 6 && isNum(+v[5]) && v[5] !== null) { o.rotY = +v[5]; o.still = true; }
    BR.items.spawn(v[3], v[0], v[1], v[2], o);
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
    const r = inf.hitR + (p.restOn ? restOf(p.type).hitAdd || 0 : 0);
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

  // 拖动中每帧调用（interact），或联机回放房主核对过的位置。y 不传就落到地面：静静躺着的按放得稳的样子最低顶点贴地（原点在地面上方 floorLift，
  // 返修 r14：道具推开地上物资、world 把物资挪出道具占地都不传 y，以前静止的火盐、PTG-B 会陷进地里），浮着的原点在地面上。
  // 不在拖动中的一次性挪动直接写 levelState；拖动中的等 hold(id, false) 松手时一次写
  move(id, x, y, z) {
    const p = byId.get(String(id));
    if (!p) return false;
    x = +x; z = +z;
    if (!isNum(x) || !isNum(z)) return false;
    p.x = x; p.z = z;
    p.y = isNum(y) ? y : groundAt(x, z, p.y - floorLift(p)) + floorLift(p);
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
  // 放得稳的静止姿态（返修 r12）：{ rx, rz（'YXZ' 顺序：先歪再绕竖直轴转 rotY）, bot（这个姿态下最低点离原点多高，≤0 时原点在最低点上方）,
  //   com（模型质心）, hull（离支撑面 ≤2 mm 的顶点的水平凸包 [[x, z]…]）, inset（质心离凸包边最近多远，米，≥0.003） }，坐标都是「歪过、还没绕竖直轴转」的模型坐标
  rest(type) {
    if (!BR.itemTypes.has(type)) return null;
    const r = restOf(type);
    return { rx: r.rx, rz: r.rz, bot: r.bot, com: r.com.slice(), hull: r.hull.map(q => q.slice()), inset: r.inset };
  },
  // 这个网格算不算实物（FE1P H6）：光晕、发光体（build 时标了 userData.glow）不算。vehicles.js 量物资外形、测试量支撑和重心都按它
  solidMesh,
  // 这件放在地上时原点比地面高多少（返修 r14）：静静躺着的 = −rest(type).bot（按放得稳的样子最低顶点贴地），浮着的 = 0。interact 拖地上的物资按它跟着地面走
  floorLift(id) {
    const p = byId.get(String(id));
    return p ? floorLift(p) : 0;
  },
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
