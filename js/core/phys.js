// 后室 · 物理：AABB 碰撞、贴墙滑动、视线检测（BR.phys，接口见 ARCHITECTURE.md 第 12 节）
// 纯逻辑，不依赖 THREE，node 里也能直接跑（tests/phys.test.js）。
// 世界里的实心物体全是轴对齐盒子（ChunkResult.solids），玩家/实体是竖直圆柱，
// 所以碰撞只在 XZ 平面做"圆 vs 矩形"，Y 只用来筛掉头顶横梁、脚下地板这类不重叠的盒子。
//
// FE1（叉车）新增 OBB：绕竖直轴转过的盒子 {cx, cz, hx, hz, rot, minY, maxY}，只在运行时用（叉车的 14 个部件、叉着 / 放下的货），
// 生成期的 res.solids 一个字节不变。rot 的约定和 kit 道具记录 / interact 的 hit.obb 一样（= THREE 的 rotation.y）：
//   世界 → 局部：dx = x − cx, dz = z − cz；lx = cos(rot)·dx − sin(rot)·dz，lz = sin(rot)·dx + cos(rot)·dz
//   局部 → 世界：x = cx + cos·lx + sin·lz，z = cz − sin·lx + cos·lz（局部 x 轴在世界里是 (cos, −sin)，局部 z 轴是 (sin, cos)）
// OBB 单独存一张表（宽相用它的外接 AABB 落进同样的 4 m 格子），所以场景里没有 OBB 时，所有函数走的还是原来那几行，结果逐位不变
// （tests/phys.test.js 的"改前对照"守着这一条）。
(function () {
'use strict';
const BR = window.BR;

// ---------- 常量 ----------
const CELL = 4;              // 空间哈希格子边长（米）：区块 24 m、墙厚几十厘米，4 m 一格每格只挂几块
const INV_CELL = 1 / CELL;
const BIG_CELLS = 256;       // 占格超过这个数（约 64×64 m）的巨型盒子单独放一张表，否则一块大地板要写几万个格子
const SKIN = 1e-4;           // 解析后离墙留一层皮：下一步从"严格不重叠"出发，浮点误差挤不进墙
const PEN_TOL = 1e-5;        // 判定"出发点已经卡进墙里"的容差，要比 SKIN 引起的浮点抖动大
const Y_EPS = 0.01;          // 脚底刚好踩在地板顶面、头顶刚好碰到横梁底面，都不算 Y 重叠
const MAX_SUBSTEPS = 256;    // 瞬移级位移不值得切上千步；每轴是一维扫掠，本身不会穿墙，步子大只是转角更"方"
const OBB_MAX_SUBSTEPS = 1024;   // 附近有 OBB 时 OBB 推出靠子步 ≤ r/2 才不穿薄货叉，上限放宽（只有附近有 OBB 时才用）
const RAY_MAX = 1e4;         // raycast 的 max 缺省或为无穷时的上限，防止 DDA 走不完
const KEY_OFF = 1 << 20, KEY_SPAN = 1 << 21;   // 数字格子 key 比拼字符串快；±2^20 格 ≈ ±4000 km，够用
// sweepOBBs：子步里任何一点的位移 ≤ 5 cm、转角 ≤ 2°；撞上后在最后一个没撞的子步和第一个撞上的子步之间二分
const SW_STEP = 0.05, SW_ANG = 2 * Math.PI / 180, SW_MAX_N = 4000, SW_BISECT = 18;
const SW_GAP = 1e-4;         // 扫掠判撞：离障碍不到 0.1 mm 就算碰上，所以停下的地方总留着 ≥ 0.1 mm 的缝（下一帧从「不重叠」出发）
const EXIT_DY = 2.5;         // 出口禁区带 y 时：和车的高度差超过这个数（别的楼层的出口）不算，和 interact 拖道具一样

function cellKey(ix, iz) { return (ix + KEY_OFF) * KEY_SPAN + (iz + KEY_OFF); }
function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i < 0) return;
  const last = arr.pop();
  if (i < arr.length) arr[i] = last;   // 顺序无所谓，交换删除省掉 splice 的整体搬移
}
function fin(v) { return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity; }

// ---------- 存储 ----------
// 记录是内部拷贝：不往层级传进来的对象上挂查询戳，也不怕层级之后改动原数组
let byKey = new Map();   // 区块 key → rec[]
let grid = new Map();    // cellKey → rec[]
let big = [];            // 巨型盒子，每次查询线性过一遍
let solidCount = 0;
let stamp = 0;           // 查询戳：一个盒子跨多格时同一次查询只处理一次
let groundFn = null;
let slabTests = 0;       // 累计 slab 测试次数，自测用来确认候选收集没有退化成全量遍历
// OBB（运行时）：和 AABB 分开存，没有 OBB 时一切照旧
let obbByKey = new Map();   // key → obbRec[]
// OBB 按外接 AABB 落进同样的 4 m 格子，但格子不进 Map：散列到一张定长的桶表（数组下标比 Map 查双精度 key 快得多，
// moveCircle 每次都要问一句"附近有没有 OBB"，没有 OBB 的地方这一句得几乎不花时间）。不同格子撞进同一桶没关系，取出来还要比外接盒
const OBB_BUCKETS = 4096;          // 2 的幂
const OBB_SCAN_CELLS = 64;         // 查询跨的格子比这还多时，直接把全部 OBB 过一遍
let obbBk = new Array(OBB_BUCKETS).fill(null);   // 桶 → obbRec[] | null
let obbBkUsed = 0;
let obbBig = [];
let obbCount = 0;
let obbBX0 = Infinity, obbBX1 = -Infinity, obbBZ0 = Infinity, obbBZ1 = -Infinity, obbBY0 = Infinity, obbBY1 = -Infinity;   // 全部 OBB 的外接盒
function obbBucket(ix, iz) { return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (OBB_BUCKETS - 1); }
// "附近有没有 OBB"的快速表：2 m 一格，每块 OBB 的外接盒外扩 NEAR_PAD 落格计数。查询半径 ≤ NEAR_PAD 时只看圆心那一格
// （圆心那一格没有计数 = 半径之内肯定没有 OBB），一次散列、一次类型化数组读，moveCircle 平常走路几乎不多花时间
const NEAR_CELL = 2, INV_NEAR = 1 / NEAR_CELL, NEAR_PAD = 1.0, NEAR_BUCKETS = 16384, NEAR_MAX_CELLS = 4096;
let obbNear = new Uint32Array(NEAR_BUCKETS);
let obbNearAll = 0;   // 大到不值得落格的 OBB 个数：有就一律当"附近可能有"
function nearBucket(ix, iz) { return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (NEAR_BUCKETS - 1); }
function nearMark(rec, d) {
  const ix0 = Math.floor((rec.minX - NEAR_PAD) * INV_NEAR), ix1 = Math.floor((rec.maxX + NEAR_PAD) * INV_NEAR);
  const iz0 = Math.floor((rec.minZ - NEAR_PAD) * INV_NEAR), iz1 = Math.floor((rec.maxZ + NEAR_PAD) * INV_NEAR);
  if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > NEAR_MAX_CELLS) { obbNearAll += d; return; }
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) obbNear[nearBucket(ix, iz)] += d;
}
// 以 (x, z) 为心、半径 reach 的方块里可能有 OBB 吗（false = 肯定没有）
function obbNearby(x, z, reach) {
  if (reach <= NEAR_PAD) return obbNearAll !== 0 || obbNear[nearBucket(Math.floor(x * INV_NEAR), Math.floor(z * INV_NEAR))] !== 0;
  return obbMaybe(x - reach, z - reach, x + reach, z + reach);
}

function addSolids(key, solids) {
  key = String(key);
  // 区块卸了又载会用同一个 key，直接覆盖，避免重复登记导致碰撞体翻倍
  if (byKey.has(key)) removeExact(key);   // 只换这一个 key 的：同名前缀的道具碰撞体（'<key>#p2'）不受影响
  const recs = [];
  if (solids) {
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s) continue;
      const minX = Math.min(s.minX, s.maxX), maxX = Math.max(s.minX, s.maxX);
      const minZ = Math.min(s.minZ, s.maxZ), maxZ = Math.max(s.minZ, s.maxZ);
      const minY = Math.min(s.minY, s.maxY), maxY = Math.max(s.minY, s.maxY);
      // Y 允许 ±Infinity（"无限高的墙"），X/Z 必须有限，否则没法落格
      if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ) ||
          Number.isNaN(minY) || Number.isNaN(maxY)) {
        console.warn('[phys] 忽略非法 AABB', key, s);
        continue;
      }
      // key：登记时的区块/道具 key（可拖道具是 `${chunkKey}#p${n}`），raycast 返回它，ignoreKey 按它跳过
      const rec = {
        minX, minY, minZ, maxX, maxY, maxZ,
        ix0: Math.floor(minX * INV_CELL), ix1: Math.floor(maxX * INV_CELL),
        iz0: Math.floor(minZ * INV_CELL), iz1: Math.floor(maxZ * INV_CELL),
        big: false, q: 0, key,
      };
      if ((rec.ix1 - rec.ix0 + 1) * (rec.iz1 - rec.iz0 + 1) > BIG_CELLS) {
        rec.big = true;
        big.push(rec);
      } else {
        for (let ix = rec.ix0; ix <= rec.ix1; ix++) {
          for (let iz = rec.iz0; iz <= rec.iz1; iz++) {
            const k = cellKey(ix, iz);
            let list = grid.get(k);
            if (!list) grid.set(k, list = []);
            list.push(rec);
          }
        }
      }
      recs.push(rec);
    }
  }
  byKey.set(key, recs);
  solidCount += recs.length;
  return recs.length;
}

// removeSolids(key)：摘掉 key 登记的碰撞体，连同挂在它名下的子 key（'<key>#…'，即这块区块里道具 / 固定设备各自登记的
// '3,-1#p2'、'3,-1#f1'）。区块卸载、tests/golden.mjs 只按区块 key 摘时，道具的碰撞体也一起摘干净。
// OBB 一样：key 本身和 '<key>#…' 名下的 OBB（停着的叉车 '3,-1#v0#chassis'…）一起摘。返回摘掉的个数（AABB + OBB）
function removeSolids(key) {
  key = String(key);
  let n = removeExact(key);
  const pre = key + '#';
  let kids = null;
  byKey.forEach((_, k) => { if (k.length > pre.length && k.startsWith(pre)) (kids || (kids = [])).push(k); });
  if (kids) for (const k of kids) n += removeExact(k);
  if (obbByKey.size) {
    n += removeObbExact(key);
    let ok = null;
    obbByKey.forEach((_, k) => { if (k.length > pre.length && k.startsWith(pre)) (ok || (ok = [])).push(k); });
    if (ok) for (const k of ok) n += removeObbExact(k);
  }
  return n;
}
function removeExact(key) {
  const recs = byKey.get(key);
  if (!recs) return 0;
  byKey.delete(key);
  for (const rec of recs) {
    if (rec.big) { removeFrom(big, rec); continue; }
    for (let ix = rec.ix0; ix <= rec.ix1; ix++) {
      for (let iz = rec.iz0; iz <= rec.iz1; iz++) {
        const k = cellKey(ix, iz);
        const list = grid.get(k);
        if (!list) continue;
        removeFrom(list, rec);
        if (list.length === 0) grid.delete(k);   // 空格子不删的话长时间漫游 Map 会一直涨
      }
    }
  }
  solidCount -= recs.length;
  return recs.length;
}

// 换层时 world 会调 clear()：连地面函数一起复位，免得上一层的地形高度带到下一层
function clear() {
  byKey = new Map();
  grid = new Map();
  big = [];
  solidCount = 0;
  groundFn = null;
  obbByKey = new Map();
  obbBk = new Array(OBB_BUCKETS).fill(null);
  obbBkUsed = 0;
  obbNear = new Uint32Array(NEAR_BUCKETS);
  obbNearAll = 0;
  obbBig = [];
  obbCount = 0;
  obbRefreshBounds();
}

// 收集 XZ 包围盒内、Y 与 (y0, y1) 重叠的盒子
function queryBox(minX, minZ, maxX, maxZ, y0, y1, out) {
  out.length = 0;
  const q = ++stamp;
  for (let i = 0; i < big.length; i++) {
    const s = big[i];
    if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
    if (s.maxY <= y0 || s.minY >= y1) continue;
    out.push(s);
  }
  if (grid.size === 0) return out;
  const ix0 = Math.floor(minX * INV_CELL), ix1 = Math.floor(maxX * INV_CELL);
  const iz0 = Math.floor(minZ * INV_CELL), iz1 = Math.floor(maxZ * INV_CELL);
  const visit = (list) => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.q === q) continue;
      s.q = q;
      if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
      if (s.maxY <= y0 || s.minY >= y1) continue;
      out.push(s);
    }
  };
  // 查询框比已有格子还多（比如一次瞬移几百米），直接扫已有格子更快
  if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > grid.size) {
    for (const list of grid.values()) visit(list);
  } else {
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = grid.get(cellKey(ix, iz));
        if (list) visit(list);
      }
    }
  }
  return out;
}

// ---------- OBB 存储 ----------
// 输入 {cx, cz, hx, hz, rot, minY, maxY, name?}；竖直范围也可以给 cy / hy（叉车 geo.obbs 的写法），都没给就是无限高
function makeObb(o, key) {
  if (!o || typeof o !== 'object') return null;
  const cx = +o.cx, cz = +o.cz, hx = Math.abs(+o.hx), hz = Math.abs(+o.hz), rot = o.rot == null ? 0 : +o.rot;
  let minY, maxY;
  if (o.minY != null || o.maxY != null) {
    const a = o.minY == null ? -Infinity : +o.minY, b = o.maxY == null ? Infinity : +o.maxY;
    minY = Math.min(a, b); maxY = Math.max(a, b);
  } else if (o.cy != null && o.hy != null) {
    const cy = +o.cy, hy = Math.abs(+o.hy);
    minY = cy - hy; maxY = cy + hy;
  } else { minY = -Infinity; maxY = Infinity; }
  if (!fin(cx) || !fin(cz) || !fin(hx) || !fin(hz) || !fin(rot) || minY !== minY || maxY !== maxY) return null;
  const c = Math.cos(rot), s = Math.sin(rot);
  const ac = Math.abs(c), as = Math.abs(s);
  const ex = ac * hx + as * hz, ez = as * hx + ac * hz;
  const minX = cx - ex, maxX = cx + ex, minZ = cz - ez, maxZ = cz + ez;
  return {
    obb: true, key, name: o.name == null ? null : String(o.name),
    cx, cz, hx, hz, rot, c, s, minY, maxY,
    minX, maxX, minZ, maxZ,   // 外接 AABB（宽相）
    lb: { minX: -hx, maxX: hx, minY, maxY, minZ: -hz, maxZ: hz },   // 局部坐标里的盒子（射线 slab 用）
    ix0: Math.floor(minX * INV_CELL), ix1: Math.floor(maxX * INV_CELL),
    iz0: Math.floor(minZ * INV_CELL), iz1: Math.floor(maxZ * INV_CELL),
    big: false, q: 0, sk: 0, skPen: 0,
  };
}

// addOBBs(key, list)：登记一组 OBB（同 key 再登记是整组替换，和 addSolids 一样）。返回登记成功的个数。
// key 的约定：停着的车挂在区块名下 'cx,cz#v<i>#<部件>'（区块卸载、golden 按区块摘时一起摘），开过的车 'veh|<车 key>#<部件>'
function addOBBs(key, list) {
  key = String(key);
  if (obbByKey.has(key)) removeObbExact(key);
  const recs = [];
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      const rec = makeObb(o, key);
      if (!rec) { console.warn('[phys] 忽略非法 OBB', key, o); continue; }
      if ((rec.ix1 - rec.ix0 + 1) * (rec.iz1 - rec.iz0 + 1) > BIG_CELLS) {
        rec.big = true;
        obbBig.push(rec);
      } else {
        for (let ix = rec.ix0; ix <= rec.ix1; ix++) {
          for (let iz = rec.iz0; iz <= rec.iz1; iz++) {
            const b = obbBucket(ix, iz);
            let l = obbBk[b];
            if (!l) { obbBk[b] = l = []; obbBkUsed++; }
            if (l.indexOf(rec) < 0) l.push(rec);   // 两格散列到同一桶时只放一次
          }
        }
      }
      nearMark(rec, 1);
      recs.push(rec);
    }
  }
  if (recs.length) {
    obbByKey.set(key, recs);
    obbCount += recs.length;
    obbRefreshBounds();
  }
  return recs.length;
}
function removeObbExact(key) {
  const recs = obbByKey.get(key);
  if (!recs) return 0;
  obbByKey.delete(key);
  for (const rec of recs) {
    nearMark(rec, -1);
    if (rec.big) { removeFrom(obbBig, rec); continue; }
    for (let ix = rec.ix0; ix <= rec.ix1; ix++) {
      for (let iz = rec.iz0; iz <= rec.iz1; iz++) {
        const b = obbBucket(ix, iz);
        const l = obbBk[b];
        if (!l) continue;
        removeFrom(l, rec);
        if (l.length === 0) { obbBk[b] = null; obbBkUsed--; }
      }
    }
  }
  obbCount -= recs.length;
  obbRefreshBounds();
  return recs.length;
}
// 全部 OBB 的外接盒：远处的查询、射线一步就跳过
function obbRefreshBounds() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  obbByKey.forEach(recs => {
    for (let i = 0; i < recs.length; i++) {
      const o = recs[i];
      if (o.minX < x0) x0 = o.minX; if (o.maxX > x1) x1 = o.maxX;
      if (o.minZ < z0) z0 = o.minZ; if (o.maxZ > z1) z1 = o.maxZ;
      if (o.minY < y0) y0 = o.minY; if (o.maxY > y1) y1 = o.maxY;
    }
  });
  obbBX0 = x0; obbBX1 = x1; obbBZ0 = z0; obbBZ1 = z1; obbBY0 = y0; obbBY1 = y1;
}
// 收集外接 AABB 和 XZ 包围盒相交、Y 与 (y0, y1) 重叠的 OBB（Y 的规则和 queryBox 一样）。
// 远处没有 OBB 的查询只花一次总外接盒比较和一两次数组下标（moveCircle 每次都要问一句，得便宜）
function queryObb(minX, minZ, maxX, maxZ, y0, y1, out) {
  out.length = 0;
  if (obbBX1 < minX || obbBX0 > maxX || obbBZ1 < minZ || obbBZ0 > maxZ || obbBY1 <= y0 || obbBY0 >= y1) return out;
  const q = ++stamp;
  for (let i = 0; i < obbBig.length; i++) {
    const s = obbBig[i];
    if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
    if (s.maxY <= y0 || s.minY >= y1) continue;
    out.push(s);
  }
  if (obbBkUsed === 0) return out;
  // 只扫和 OBB 总外接盒相交的那几格；格子太多（瞬移级的大查询）时直接把全部 OBB 过一遍
  const ix0 = Math.floor((minX > obbBX0 ? minX : obbBX0) * INV_CELL), ix1 = Math.floor((maxX < obbBX1 ? maxX : obbBX1) * INV_CELL);
  const iz0 = Math.floor((minZ > obbBZ0 ? minZ : obbBZ0) * INV_CELL), iz1 = Math.floor((maxZ < obbBZ1 ? maxZ : obbBZ1) * INV_CELL);
  if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > OBB_SCAN_CELLS) {
    obbByKey.forEach(recs => visitObb(recs, q, minX, minZ, maxX, maxZ, y0, y1, out));
  } else {
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = obbBk[obbBucket(ix, iz)];
        if (list !== null) visitObb(list, q, minX, minZ, maxX, maxZ, y0, y1, out);
      }
    }
  }
  return out;
}
// 这块地方可能有 OBB 吗（只看总外接盒和桶是不是空的，不碰记录）：moveCircle 每次先问这一句，绝大多数时候到这里就结束了
function obbMaybe(minX, minZ, maxX, maxZ) {
  if (obbBX1 < minX || obbBX0 > maxX || obbBZ1 < minZ || obbBZ0 > maxZ) return false;
  if (obbBig.length !== 0) return true;
  const ix0 = Math.floor(minX * INV_CELL), ix1 = Math.floor(maxX * INV_CELL);
  const iz0 = Math.floor(minZ * INV_CELL), iz1 = Math.floor(maxZ * INV_CELL);
  if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > OBB_SCAN_CELLS) return true;
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) if (obbBk[obbBucket(ix, iz)] !== null) return true;
  return false;
}
function visitObb(list, q, minX, minZ, maxX, maxZ, y0, y1, out) {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.q === q || s.big) continue;
    s.q = q;
    if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
    if (s.maxY <= y0 || s.minY >= y1) continue;
    out.push(s);
  }
}

// ---------- OBB 几何（内部：o 带 cx, cz, hx, hz, c, s） ----------
// 圆心 (px, pz)、半径 r 的圆压进 OBB 多深：r − 圆心到盒子的距离（圆心在盒内时 = r + 到最近面的距离）。
// 同时写 obNX / obNZ：把圆推出去的方向（世界坐标、单位向量）—— 圆心在盒外沿"最近点 → 圆心"，在盒内沿最近的面
let obNX = 0, obNZ = 0;
function circlePen(o, px, pz, r) {
  const dx = px - o.cx, dz = pz - o.cz;
  const lx = o.c * dx - o.s * dz, lz = o.s * dx + o.c * dz;
  const hx = o.hx, hz = o.hz;
  const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
  const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
  const ex = lx - qx, ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  let nlx, nlz, pen;
  if (d2 > 1e-24) {
    const d = Math.sqrt(d2);
    nlx = ex / d; nlz = ez / d; pen = r - d;
  } else {
    const fx = hx - Math.abs(lx), fz = hz - Math.abs(lz);
    if (fx <= fz) { nlx = lx < 0 ? -1 : 1; nlz = 0; pen = r + fx; }
    else { nlx = 0; nlz = lz < 0 ? -1 : 1; pen = r + fz; }
  }
  obNX = o.c * nlx + o.s * nlz;
  obNZ = -o.s * nlx + o.c * nlz;
  return pen;
}
// 2D 分离轴：两只 OBB 在 4 根轴上的投影重叠量取最小（> 0 = 相交，≤ 0 = 分开 / 贴着）
function satOO(a, b) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  const uu = Math.abs(a.c * b.c + a.s * b.s), uv = Math.abs(a.c * b.s - a.s * b.c);   // |a.u·b.u|、|a.u·b.v|（= |a.v·b.u|）
  // a.v·b.v = a.u·b.u，a.v·b.u = −a.u·b.v：两个绝对值只有两种
  let m = a.hx + b.hx * uu + b.hz * uv - Math.abs(dx * a.c - dz * a.s);
  let v = a.hz + b.hx * uv + b.hz * uu - Math.abs(dx * a.s + dz * a.c); if (v < m) m = v;
  v = b.hx + a.hx * uu + a.hz * uv - Math.abs(dx * b.c - dz * b.s); if (v < m) m = v;
  v = b.hz + a.hx * uv + a.hz * uu - Math.abs(dx * b.s + dz * b.c); if (v < m) m = v;
  return m;
}
// 轴对齐盒（中心 bcx/bcz、半宽 bhx/bhz）和 OBB 的 2D 分离轴最小重叠量
function satBO(bcx, bcz, bhx, bhz, o) {
  const dx = o.cx - bcx, dz = o.cz - bcz;
  const ac = Math.abs(o.c), as = Math.abs(o.s);
  let m = bhx + o.hx * ac + o.hz * as - Math.abs(dx);
  let v = bhz + o.hx * as + o.hz * ac - Math.abs(dz); if (v < m) m = v;
  v = o.hx + bhx * ac + bhz * as - Math.abs(dx * o.c - dz * o.s); if (v < m) m = v;
  v = o.hz + bhx * as + bhz * ac - Math.abs(dx * o.s + dz * o.c); if (v < m) m = v;
  return m;
}

// ---------- 圆柱移动 ----------
const candMove = [];
const candOverlap = [];
const candObbMove = [];
const candObbOverlap = [];

// 一维扫掠的附带输出：挡住的是不是矩形的"圆角"区域，以及那个角的坐标（算切向偏转用）
let blocked = false, blockedCorner = false, cornerX = 0, cornerZ = 0;

// 固定 z，沿 X 走 sx。圆 vs 矩形在固定 z 时，禁区是 X 上的一个区间：
// 圆心 z 落在矩形 Z 范围内 → 半宽 r；落在角外 → 半宽 sqrt(r² - dz²)（圆角）。
// 出发点合法时，只要不越过区间边界就绝不会穿墙，和步长无关。
function sweepX(px, pz, sx, r, list) {
  blocked = false;
  if (sx === 0) return px;
  let nx = px + sx;
  const r2 = r * r;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let dzc, cz;
    if (pz < s.minZ) { dzc = s.minZ - pz; cz = s.minZ; }
    else if (pz > s.maxZ) { dzc = pz - s.maxZ; cz = s.maxZ; }
    else { dzc = 0; cz = pz; }
    if (dzc >= r) continue;
    const w = dzc === 0 ? r : Math.sqrt(r2 - dzc * dzc);
    if (sx > 0) {
      const a = s.minX - w;
      // 已在区间右侧（身后）或区间内部（卡墙，交给 depenetrate），不挡
      if (px > a + 1e-7) continue;
      const lim = a - SKIN;
      if (nx > lim) {
        nx = lim < px ? px : lim;
        blocked = true; blockedCorner = dzc > 0; cornerX = s.minX; cornerZ = cz;
      }
    } else {
      const b = s.maxX + w;
      if (px < b - 1e-7) continue;
      const lim = b + SKIN;
      if (nx < lim) {
        nx = lim > px ? px : lim;
        blocked = true; blockedCorner = dzc > 0; cornerX = s.maxX; cornerZ = cz;
      }
    }
  }
  return nx;
}

// sweepX 的 Z 轴镜像
function sweepZ(px, pz, sz, r, list) {
  blocked = false;
  if (sz === 0) return pz;
  let nz = pz + sz;
  const r2 = r * r;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let dxc, cx;
    if (px < s.minX) { dxc = s.minX - px; cx = s.minX; }
    else if (px > s.maxX) { dxc = px - s.maxX; cx = s.maxX; }
    else { dxc = 0; cx = px; }
    if (dxc >= r) continue;
    const w = dxc === 0 ? r : Math.sqrt(r2 - dxc * dxc);
    if (sz > 0) {
      const a = s.minZ - w;
      if (pz > a + 1e-7) continue;
      const lim = a - SKIN;
      if (nz > lim) {
        nz = lim < pz ? pz : lim;
        blocked = true; blockedCorner = dxc > 0; cornerX = cx; cornerZ = s.minZ;
      }
    } else {
      const b = s.maxZ + w;
      if (pz < b - 1e-7) continue;
      const lim = b + SKIN;
      if (nz < lim) {
        nz = lim > pz ? pz : lim;
        blocked = true; blockedCorner = dxc > 0; cornerX = cx; cornerZ = s.maxZ;
      }
    }
  }
  return nz;
}

// 被圆角挡住时，把没走完的那段投影到接触点切线上，换成另一轴的位移。
// 纯分轴解析在门框边、柱子角上会"蹭住不动"，有了这一步擦着角就能滑过去；
// 正对着面撞（法线与运动同向）时切向分量为 0，不会乱滑。
// 投影公式：d=(rem,0)，t=(-nz,nx)，另一轴分量 = -rem·nx·nz / |n|²（X、Z 对称）
function deflect(rem, px, pz) {
  const nx = px - cornerX, nz = pz - cornerZ;
  const l2 = nx * nx + nz * nz;
  if (l2 < 1e-18) return 0;
  return -rem * nx * nz / l2;
}

let outX = 0, outZ = 0;
// 出发点已经和盒子重叠（出生点离墙不足一个半径、区块刚载入压在身上）：沿最小平移推出去。
// 一维扫掠会跳过"已经在里面"的盒子，不先推出来就会一直卡着或者穿过去。
function depenetrate(px, pz, r, list) {
  const lim2 = (r - PEN_TOL) * (r - PEN_TOL);
  let movedAny = false;
  for (let iter = 0; iter < 4; iter++) {   // 夹在两块中间时一次推不干净，多轮迭代
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const cx = px < s.minX ? s.minX : px > s.maxX ? s.maxX : px;
      const cz = pz < s.minZ ? s.minZ : pz > s.maxZ ? s.maxZ : pz;
      const ddx = px - cx, ddz = pz - cz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= lim2) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2), push = r - d + SKIN;
        px += ddx / d * push;
        pz += ddz / d * push;
      } else {
        // 圆心在盒内：推向最近的面
        const l = px - s.minX, rt = s.maxX - px, bk = pz - s.minZ, fr = s.maxZ - pz;
        const m = Math.min(l, rt, bk, fr);
        if (m === l) px = s.minX - r - SKIN;
        else if (m === rt) px = s.maxX + r + SKIN;
        else if (m === bk) pz = s.minZ - r - SKIN;
        else pz = s.maxZ + r + SKIN;
      }
      moved = true;
    }
    if (!moved) break;
    movedAny = true;
  }
  outX = px; outZ = pz;
  return movedAny;
}

function defaultHeight() {
  return BR.config && BR.config.player ? BR.config.player.height : 1.8;
}

// 竖直圆柱（半径 r、脚底 yFeet、高 height）在 XZ 上移动 (dx, dz)，贴墙滑动。
// 返回 { x, z, hitX, hitZ, hit }：hitX/hitZ 表示该轴被挡过（玩家用来清速度，实体 AI 用来判断卡住）
// 附近有 OBB 时走 moveCircleObb（同一套轴对齐扫掠，每个子步之后再做圆-OBB 推出）；没有时一行不差走原来的路径
function moveCircle(x, z, r, dx, dz, yFeet, height) {
  x = +x; z = +z;
  dx = +dx || 0; dz = +dz || 0;
  if (!(r > 0)) r = 0.01;
  if (yFeet == null) yFeet = groundY(x, z);
  if (!(height > 0)) height = defaultHeight();
  const y0 = yFeet + Y_EPS, y1 = yFeet + Math.max(height, 3 * Y_EPS) - Y_EPS;

  const len = Math.sqrt(dx * dx + dz * dz);
  // 候选范围：位移长度 + 半径。圆角偏转是把被挡掉的位移转向，总路程不会超过 len
  const reach = len + r + 0.05;
  let list = queryBox(x - reach, z - reach, x + reach, z + reach, y0, y1, candMove);
  if (obbCount !== 0 && obbNearby(x, z, reach) && queryObb(x - reach, z - reach, x + reach, z + reach, y0, y1, candObbMove).length) {
    return moveCircleObb(x, z, r, dx, dz, y0, y1, len, reach, list, candObbMove);
  }
  if (list.length === 0) return { x: x + dx, z: z + dz, hitX: false, hitZ: false, hit: false };

  let px = x, pz = z, hitX = false, hitZ = false;
  if (depenetrate(px, pz, r, list)) {
    px = outX; pz = outZ;
    // 可能被推出去好几米，原来的候选不一定覆盖新位置
    list = queryBox(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candMove);
    // 被推到了 OBB 跟前：从推出后的位置改走带 OBB 的路径（depenetrate 再跑一遍是空操作）
    if (obbCount !== 0 && obbNearby(px, pz, reach) && queryObb(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candObbMove).length) {
      return moveCircleObb(px, pz, r, dx, dz, y0, y1, len, reach, list, candObbMove);
    }
  }

  // 分步：每步 ≤ r/2。每轴扫掠本身不穿墙，分步是为了让"先 X 后 Z"的折线贴近真实斜线，
  // 否则一大步斜走会绕过本该挡住的墙角
  let n = Math.ceil(len / (r * 0.5));
  if (n < 1) n = 1; else if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
  const sx = dx / n, sz = dz / n;

  for (let i = 0; i < n; i++) {
    // X 轴
    let nx = sweepX(px, pz, sx, r, list);
    let extraZ = 0;
    if (blocked) {
      hitX = true;
      if (blockedCorner) extraZ = deflect(sx - (nx - px), nx, pz);
    }
    px = nx;
    // Z 轴（带上 X 被圆角挡掉后转过来的切向分量）
    const nz = sweepZ(px, pz, sz + extraZ, r, list);
    let extraX = 0;
    if (blocked) {
      hitZ = true;
      if (blockedCorner) extraX = deflect(sz + extraZ - (nz - pz), px, nz);
    }
    pz = nz;
    // Z 被圆角挡掉转回 X 的部分再扫一次；这次不再偏转，免得在角上来回弹
    if (extraX !== 0) px = sweepX(px, pz, extraX, r, list);
  }
  return { x: px, z: pz, hitX, hitZ, hit: hitX || hitZ };
}

// 带 OBB 的圆柱移动：
//   ① 轴对齐盒照旧先 depenetrate；② 起点已经压进 OBB 的，沿最小穿透方向推出，这一次调用最多推 r（实体刷在货叉范围里、
//   车停到人身上），推完还压着的那几块这一次不再管（下一次再推 r，所以不会卡死，也不会一帧瞬移好几米）；
//   ③ 每个子步（≤ r/2）先照旧扫轴对齐盒，再对 OBB 做圆-OBB 推出（推出位移也按轴对齐盒扫，不会被推进墙里）。
//   子步 ≤ r/2 保证圆心永远到不了 OBB 里面，推出方向不会翻到另一侧，10 cm 宽的货叉也穿不过去。
//   被 OBB 推过的子步按推出方向的主轴记 hitX / hitZ（玩家拿它清那一轴的速度）。
//   ④ 夹在 OBB 和墙（或两块 OBB）中间、推几轮还推不干净的子步，整步退回去、不再往前走（人钻不进车和墙之间比人窄的缝）；
//   ②里推不完还压着的 OBB 只许越压越浅（往外、往旁边走都行，往里走那一步退回去），所以也穿不过车。
const OBB_PUSH_TOL = 1e-9;
let obHitX = false, obHitZ = false, skStamp = 0;
function moveCircleObb(x, z, r, dx, dz, y0, y1, len, reach, list, ol) {
  let px = x, pz = z, hitX = false, hitZ = false;
  if (list.length && depenetrate(px, pz, r, list)) {
    px = outX; pz = outZ;
    list = queryBox(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candMove);
    ol = queryObb(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candObbMove);
  }
  const sk = ++skStamp;
  if (ol.length && obbStartPush(px, pz, r, ol, list)) {
    px = outX; pz = outZ;
    list = queryBox(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candMove);
    ol = queryObb(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candObbMove);
  }
  // 推了 r 还压着的：这一次调用里只记下压多深，之后只许越压越浅（AABB 的扫掠对"已经在里面"的盒子是直接不管）
  for (let i = 0; i < ol.length; i++) {
    const o = ol[i];
    if (px + r <= o.minX || px - r >= o.maxX || pz + r <= o.minZ || pz - r >= o.maxZ) continue;
    const pen = circlePen(o, px, pz, r);
    if (pen > PEN_TOL) { o.sk = sk; o.skPen = pen; }
  }

  let n = Math.ceil(len / (r * 0.5));
  if (n < 1) n = 1; else if (n > OBB_MAX_SUBSTEPS) n = OBB_MAX_SUBSTEPS;
  const sx = dx / n, sz = dz / n;

  for (let i = 0; i < n; i++) {
    const bx = px, bz = pz;
    let nx = sweepX(px, pz, sx, r, list);
    let extraZ = 0;
    if (blocked) {
      hitX = true;
      if (blockedCorner) extraZ = deflect(sx - (nx - px), nx, pz);
    }
    px = nx;
    const nz = sweepZ(px, pz, sz + extraZ, r, list);
    let extraX = 0;
    if (blocked) {
      hitZ = true;
      if (blockedCorner) extraX = deflect(sz + extraZ - (nz - pz), px, nz);
    }
    pz = nz;
    if (extraX !== 0) px = sweepX(px, pz, extraX, r, list);
    // OBB 推出
    if (obbResolve(px, pz, r, ol, list, sk)) {
      px = outX; pz = outZ;
      if (obHitX) hitX = true;
      if (obHitZ) hitZ = true;
    }
    if (obbBad(px, pz, r, ol, sk)) {
      // 推不干净（夹缝）或者往起点就压着的 OBB 里又走深了：这一步退回去。后面的子步同样的位移、同样的起点，只会一样，直接停
      px = bx; pz = bz;
      if (sx !== 0) hitX = true;
      if (sz !== 0) hitZ = true;
      break;
    }
  }
  return { x: px, z: pz, hitX, hitZ, hit: hitX || hitZ };
}
// 子步走完以后这个位置合不合法：没被豁免的 OBB 都压不进 PEN_TOL；起点就压着（豁免）的不能比记下的更深（合法时把记录收紧）
function obbBad(px, pz, r, ol, sk) {
  for (let i = 0; i < ol.length; i++) {
    const o = ol[i];
    if (px + r <= o.minX || px - r >= o.maxX || pz + r <= o.minZ || pz - r >= o.maxZ) continue;
    const pen = circlePen(o, px, pz, r);
    if (o.sk === sk) { if (pen > o.skPen + 1e-7) return true; }
    else if (pen > PEN_TOL) return true;
  }
  for (let i = 0; i < ol.length; i++) {
    const o = ol[i];
    if (o.sk !== sk) continue;
    const pen = circlePen(o, px, pz, r);
    if (pen < o.skPen) o.skPen = pen;
  }
  return false;
}
// 子步之后：和哪块 OBB 压着就沿推出方向推到 r + SKIN 外（多块夹着时迭代几轮）
function obbResolve(px, pz, r, ol, list, sk) {
  let any = false;
  obHitX = obHitZ = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (let i = 0; i < ol.length; i++) {
      const o = ol[i];
      if (o.sk === sk) continue;
      if (px + r <= o.minX || px - r >= o.maxX || pz + r <= o.minZ || pz - r >= o.maxZ) continue;
      const pen = circlePen(o, px, pz, r);
      if (pen <= OBB_PUSH_TOL) continue;
      const push = pen + SKIN, nX = obNX, nZ = obNZ;
      const nx = list.length ? sweepX(px, pz, nX * push, r, list) : px + nX * push;
      const nz = list.length ? sweepZ(nx, pz, nZ * push, r, list) : pz + nZ * push;
      if (Math.abs(nX) >= Math.abs(nZ)) obHitX = true; else obHitZ = true;
      px = nx; pz = nz;
      moved = true;
    }
    if (!moved) break;
    any = true;
  }
  outX = px; outZ = pz;
  return any;
}
// 起点压进 OBB：沿最小穿透方向推，这一次合计最多推 r
function obbStartPush(px, pz, r, ol, list) {
  let budget = r, movedAny = false;
  for (let iter = 0; iter < 4 && budget > 0; iter++) {
    let moved = false;
    for (let i = 0; i < ol.length && budget > 0; i++) {
      const o = ol[i];
      if (px + r <= o.minX || px - r >= o.maxX || pz + r <= o.minZ || pz - r >= o.maxZ) continue;
      const pen = circlePen(o, px, pz, r);
      if (pen <= PEN_TOL) continue;
      let push = pen + SKIN;
      if (push > budget) push = budget;
      budget -= push;
      const nX = obNX, nZ = obNZ;
      const nx = list.length ? sweepX(px, pz, nX * push, r, list) : px + nX * push;
      const nz = list.length ? sweepZ(nx, pz, nZ * push, r, list) : pz + nZ * push;
      if (nx !== px || nz !== pz) moved = true;
      px = nx; pz = nz;
    }
    if (!moved) break;
    movedAny = true;
  }
  outX = px; outZ = pz;
  return movedAny;
}

// ---------- 忽略 key ----------
// ignoreKey 可以是一个字符串或字符串数组；碰撞 key（'3,-1#p2'）和道具 key（'L1@3,-1#p2'）都认：
// 道具 key 去掉 '<层级>@' 前缀就是它的碰撞 key（kit 的约定，见 _kit.js 的 skeyOf），interact 直接把父道具链的道具 key 传进来就行
// AABB 只认完全相同的 key；OBB 另外认前缀：ignoreKey 'veh|1@0,0#v0' 会跳过 'veh|1@0,0#v0#chassis' 这类部件 key
// （同前缀的 AABB，例如 ignoreKey '0,0' 时的 '0,0#p2'，照旧不跳过）
let ignA = null, ignB = null, ignList = null;
function setIgnore(opts) {
  ignA = ignB = ignList = null;
  const k = opts && opts.ignoreKey;
  if (k == null || k === '') return false;
  const one = s => { s = String(s); const i = s.indexOf('@'); return i >= 0 ? s.slice(i + 1) : s; };
  if (Array.isArray(k)) {
    const out = [];
    for (let i = 0; i < k.length; i++) {
      if (k[i] == null || k[i] === '') continue;
      const s = String(k[i]);
      out.push(s);
      const t = one(s);
      if (t !== s) out.push(t);
    }
    if (!out.length) return false;
    if (out.length <= 2) { ignA = out[0]; ignB = out.length > 1 ? out[1] : null; } else ignList = out;
    return true;
  }
  ignA = String(k);
  const t = one(ignA);
  ignB = t !== ignA ? t : null;
  return true;
}
function ignored(s) {
  const k = s.key;
  if (ignList) return ignList.indexOf(k) >= 0;
  return k === ignA || (ignB !== null && k === ignB);
}
// k 是 p 本身，或者是 p 名下的子 key（'p#…'）
function keyUnder(k, p) {
  return k === p || (p.length > 0 && k.length > p.length && k.charCodeAt(p.length) === 35 && k.startsWith(p));
}
function ignoredObb(s) {
  const k = s.key;
  if (ignList) {
    for (let i = 0; i < ignList.length; i++) if (keyUnder(k, ignList[i])) return true;
    return false;
  }
  return (ignA !== null && keyUnder(k, ignA)) || (ignB !== null && keyUnder(k, ignB));
}
// opts.skipBoxes（FE1 返修 r3）：[[minX, minY, minZ, maxX, maxY, maxZ], …] —— 跳过和其中某一条六个数都差 1 mm 以内的静态 AABB。
// 区块里一整块共用一个 key，ignoreKey 跳不了其中一块：叉车把斜放地牛那块轴对齐的老碰撞体（人照旧被它挡）换成地牛的真实形状
// （sideObs）时用。只认 AABB，OBB 不看；不给就和原来一模一样
function skipList(opts) {
  const a = opts && opts.skipBoxes;
  return Array.isArray(a) && a.length ? a : null;
}
function skipped(s, list) {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || b.length < 6) continue;
    if (Math.abs(s.minX - b[0]) < 1e-3 && Math.abs(s.maxX - b[3]) < 1e-3 && Math.abs(s.minZ - b[2]) < 1e-3 && Math.abs(s.maxZ - b[5]) < 1e-3 &&
        Math.abs(s.minY - b[1]) < 1e-3 && Math.abs(s.maxY - b[4]) < 1e-3) return true;
  }
  return false;
}

// ---------- 盒子移动（拖动道具） ----------
// 轴对齐盒子 [minX,maxX]×[minZ,maxZ]（脚底 yFeet、高 h）在 XZ 上移动 (dx, dz)，分轴扫掠、贴墙滑动。
// 和 moveCircle 同一套思路：每轴是一维区间扫掠，不穿墙；分步只是让"先 X 后 Z"的折线贴近斜线。
// opts.ignoreKey：跳过这些 key 的碰撞体（被拖的道具自己、它的子道具）；opts.circles：[[x, z, r], ...] 额外的圆形障碍（玩家）。
// 出发时已经和某块重叠的不挡（生成时就挨着的家具，拖开就好）。返回 { dx, dz, hit, hitX, hitZ }（实际走成的位移）
// OBB（叉车）也挡：每一轴按分离轴做连续扫掠（拖家具撞到叉车会停），出发时已经压着的同样不挡
const candBox = [];
const candBoxObb = [];
const BOX_TOL = 1e-7;
function sweepBoxX(x0, z0, x1, z1, sx, list, circles) {
  blocked = false;
  if (sx === 0) return 0;
  let best = sx;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.maxZ <= z0 + BOX_TOL || s.minZ >= z1 - BOX_TOL) continue;   // Z 不重叠（贴着面滑动不算）
    if (sx > 0) {
      const gap = s.minX - x1;
      if (gap < -BOX_TOL) continue;                                    // 在身后或已重叠
      const lim = Math.max(0, gap - SKIN);
      if (lim < best) { best = lim; blocked = true; }
    } else {
      const gap = x0 - s.maxX;
      if (gap < -BOX_TOL) continue;
      const lim = -Math.max(0, gap - SKIN);
      if (lim > best) { best = lim; blocked = true; }
    }
  }
  if (circles) {
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (!c) continue;
      const cx = +c[0], cz = +c[1], r = +c[2];
      if (!(r > 0) || !Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const dzc = cz < z0 ? z0 - cz : cz > z1 ? cz - z1 : 0;
      if (dzc >= r) continue;
      const w = dzc === 0 ? r : Math.sqrt(r * r - dzc * dzc);         // 圆 ⊕ 盒 = 圆角盒：这一行上圆占 [cx-w, cx+w]
      if (sx > 0) {
        const gap = (cx - w) - x1;
        if (gap < -BOX_TOL) continue;
        const lim = Math.max(0, gap - SKIN);
        if (lim < best) { best = lim; blocked = true; }
      } else {
        const gap = x0 - (cx + w);
        if (gap < -BOX_TOL) continue;
        const lim = -Math.max(0, gap - SKIN);
        if (lim > best) { best = lim; blocked = true; }
      }
    }
  }
  return best;
}
// sweepBoxX 的 Z 轴镜像（交换 X/Z）
function sweepBoxZ(x0, z0, x1, z1, sz, list, circles) {
  blocked = false;
  if (sz === 0) return 0;
  let best = sz;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.maxX <= x0 + BOX_TOL || s.minX >= x1 - BOX_TOL) continue;
    if (sz > 0) {
      const gap = s.minZ - z1;
      if (gap < -BOX_TOL) continue;
      const lim = Math.max(0, gap - SKIN);
      if (lim < best) { best = lim; blocked = true; }
    } else {
      const gap = z0 - s.maxZ;
      if (gap < -BOX_TOL) continue;
      const lim = -Math.max(0, gap - SKIN);
      if (lim > best) { best = lim; blocked = true; }
    }
  }
  if (circles) {
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (!c) continue;
      const cx = +c[0], cz = +c[1], r = +c[2];
      if (!(r > 0) || !Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const dxc = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      if (dxc >= r) continue;
      const w = dxc === 0 ? r : Math.sqrt(r * r - dxc * dxc);
      if (sz > 0) {
        const gap = (cz - w) - z1;
        if (gap < -BOX_TOL) continue;
        const lim = Math.max(0, gap - SKIN);
        if (lim < best) { best = lim; blocked = true; }
      } else {
        const gap = z0 - (cz + w);
        if (gap < -BOX_TOL) continue;
        const lim = -Math.max(0, gap - SKIN);
        if (lim > best) { best = lim; blocked = true; }
      }
    }
  }
  return best;
}
// 轴对齐盒沿 (mx, mz) 平移，碰到 OBB 之前最多能走多远（返回实际位移的比例 0..1；不挡返回 1）。
// 4 根分离轴上各求"压进去超过 BOX_TOL"的时间区间，取交集的起点；出发时就压着的不挡；停在接触前 SKIN
function boxObbFrac(x0, z0, x1, z1, mx, mz, ol) {
  const len = Math.sqrt(mx * mx + mz * mz);
  if (!(len > 0)) return 1;
  const bcx = (x0 + x1) * 0.5, bcz = (z0 + z1) * 0.5, bhx = (x1 - x0) * 0.5, bhz = (z1 - z0) * 0.5;
  const sx0 = mx < 0 ? x0 + mx : x0, sx1 = mx > 0 ? x1 + mx : x1, sz0 = mz < 0 ? z0 + mz : z0, sz1 = mz > 0 ? z1 + mz : z1;
  let f = 1;
  for (let i = 0; i < ol.length; i++) {
    const o = ol[i];
    if (o.maxX <= sx0 || o.minX >= sx1 || o.maxZ <= sz0 || o.minZ >= sz1) continue;
    const dx = o.cx - bcx, dz = o.cz - bcz, ac = Math.abs(o.c), as = Math.abs(o.s);
    let tIn = -Infinity, tOut = Infinity, sep = false;
    for (let a = 0; a < 4 && !sep; a++) {
      let d, R, v;
      if (a === 0) { d = dx; R = bhx + o.hx * ac + o.hz * as; v = mx; }
      else if (a === 1) { d = dz; R = bhz + o.hx * as + o.hz * ac; v = mz; }
      else if (a === 2) { d = dx * o.c - dz * o.s; R = o.hx + bhx * ac + bhz * as; v = mx * o.c - mz * o.s; }
      else { d = dx * o.s + dz * o.c; R = o.hz + bhx * as + bhz * ac; v = mx * o.s + mz * o.c; }
      // 盒心沿轴走 t·v，距 OBB 心 d − t·v；|d − t·v| < R − BOX_TOL 时这根轴上压着
      const Rt = R - BOX_TOL;
      if (v > -1e-12 && v < 1e-12) { if (Math.abs(d) >= Rt) sep = true; continue; }
      let ta = (d - Rt) / v, tb = (d + Rt) / v;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > tIn) tIn = ta;
      if (tb < tOut) tOut = tb;
      if (tIn >= tOut) sep = true;
    }
    if (sep || tOut <= 0 || tIn >= f) continue;
    if (tIn < 0 && tOut > 0 && satBO(bcx, bcz, bhx, bhz, o) > BOX_TOL) continue;   // 出发时就压着：不挡
    const lim = Math.max(0, tIn * len - SKIN) / len;
    if (lim < f) f = lim;
  }
  return f;
}

function moveBox(minX, minZ, maxX, maxZ, yFeet, h, dx, dz, opts) {
  let x0 = Math.min(+minX, +maxX), x1 = Math.max(+minX, +maxX);
  let z0 = Math.min(+minZ, +maxZ), z1 = Math.max(+minZ, +maxZ);
  dx = +dx || 0; dz = +dz || 0;
  const none = { dx: 0, dz: 0, hit: false, hitX: false, hitZ: false };
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(z0) || !Number.isFinite(z1)) return none;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return none;
  if (yFeet == null || !Number.isFinite(+yFeet)) yFeet = groundY((x0 + x1) / 2, (z0 + z1) / 2);
  yFeet = +yFeet;
  if (!(h > 0)) h = 1;
  const y0 = yFeet + Y_EPS, y1 = yFeet + Math.max(h, 3 * Y_EPS) - Y_EPS;
  const circles = opts && Array.isArray(opts.circles) && opts.circles.length ? opts.circles : null;
  const ign = setIgnore(opts);
  // 候选：起点盒子按整段位移外扩
  const ax = Math.abs(dx) + 0.05, az = Math.abs(dz) + 0.05;
  queryBox(x0 - ax, z0 - az, x1 + ax, z1 + az, y0, y1, candBox);
  let list = candBox;
  if (ign) {
    let w = 0;
    for (let i = 0; i < list.length; i++) if (!ignored(list[i])) list[w++] = list[i];
    list.length = w;
  }
  let ol = null;
  if (obbCount) {
    ol = queryObb(x0 - ax, z0 - az, x1 + ax, z1 + az, y0, y1, candBoxObb);
    if (ign) {
      let w = 0;
      for (let i = 0; i < ol.length; i++) if (!ignoredObb(ol[i])) ol[w++] = ol[i];
      ol.length = w;
    }
    if (!ol.length) ol = null;
  }
  ignA = ignB = ignList = null;
  if (!list.length && !circles && !ol) return { dx, dz, hit: false, hitX: false, hitZ: false };

  const len = Math.sqrt(dx * dx + dz * dz);
  const half = Math.max(0.05, Math.min(x1 - x0, z1 - z0) * 0.5);
  let n = Math.ceil(len / half);
  if (n < 1) n = 1; else if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
  const sx = dx / n, sz = dz / n;
  let mx = 0, mz = 0, hitX = false, hitZ = false;
  for (let i = 0; i < n; i++) {
    let ex = sweepBoxX(x0 + mx, z0 + mz, x1 + mx, z1 + mz, sx, list, circles);
    let bx = blocked;
    if (ol && ex !== 0) {
      const f = boxObbFrac(x0 + mx, z0 + mz, x1 + mx, z1 + mz, ex, 0, ol);
      if (f < 1) { ex *= f; bx = true; }
    }
    if (bx) hitX = true;
    mx += ex;
    let ez = sweepBoxZ(x0 + mx, z0 + mz, x1 + mx, z1 + mz, sz, list, circles);
    let bz = blocked;
    if (ol && ez !== 0) {
      const f = boxObbFrac(x0 + mx, z0 + mz, x1 + mx, z1 + mz, 0, ez, ol);
      if (f < 1) { ez *= f; bz = true; }
    }
    if (bz) hitZ = true;
    mz += ez;
  }
  return { dx: mx, dz: mz, hit: hitX || hitZ, hitX, hitZ };
}

// 轴对齐盒子（脚底 yFeet、高 h）和哪些碰撞体重叠（每个方向都压进去超过 tol 才算，贴着不算）。
// opts.ignoreKey 同 moveBox；opts.out 给了就把重叠的碰撞体（phys 里的原对象）写进去。返回重叠的个数。
// 联机房主核对客机放下的道具用（客机自己拖的时候 moveBox 已经挡过；这里防两边不同步）
// OBB 按 2D 分离轴（4 根轴上都压进去超过 tol）加竖直区间判；out 里的 OBB 记录带 obb:true 和 cx/cz/hx/hz/rot
const candOverlapBox = [];
const candOverlapBoxObb = [];
function overlapBox(minX, minZ, maxX, maxZ, yFeet, h, opts) {
  const x0 = Math.min(+minX, +maxX), x1 = Math.max(+minX, +maxX);
  const z0 = Math.min(+minZ, +maxZ), z1 = Math.max(+minZ, +maxZ);
  const out = opts && Array.isArray(opts.out) ? opts.out : null;
  if (out) out.length = 0;
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(z0) || !Number.isFinite(z1)) return 0;
  if (yFeet == null || !Number.isFinite(+yFeet)) yFeet = groundY((x0 + x1) / 2, (z0 + z1) / 2);
  yFeet = +yFeet;
  if (!(h > 0)) h = 1;
  const tol = opts && opts.tol > 0 ? +opts.tol : 0.005;
  const y0 = yFeet + Y_EPS, y1 = yFeet + Math.max(h, 3 * Y_EPS) - Y_EPS;
  const ign = setIgnore(opts);
  const list = queryBox(x0, z0, x1, z1, y0, y1, candOverlapBox);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (ign && ignored(s)) continue;
    if (s.maxX <= x0 + tol || s.minX >= x1 - tol || s.maxZ <= z0 + tol || s.minZ >= z1 - tol) continue;
    n++;
    if (out) out.push(s);
  }
  if (obbCount) {
    const ol = queryObb(x0, z0, x1, z1, y0, y1, candOverlapBoxObb);
    const bcx = (x0 + x1) * 0.5, bcz = (z0 + z1) * 0.5, bhx = (x1 - x0) * 0.5, bhz = (z1 - z0) * 0.5;
    for (let i = 0; i < ol.length; i++) {
      const o = ol[i];
      if (ign && ignoredObb(o)) continue;
      if (!(satBO(bcx, bcz, bhx, bhz, o) > tol)) continue;
      n++;
      if (out) out.push(o);
    }
    ol.length = 0;
  }
  ignA = ignB = ignList = null;
  list.length = 0;
  return n;
}

// overlapOBB(o, opts)：一块 OBB（{cx, cz, hx, hz, rot, minY, maxY}）和哪些碰撞体（静态 AABB、别的 OBB）重叠——
// 2D 分离轴 4 根轴上都压进去超过 tol（缺省 5 mm，和 overlapBox 一样；给 0 就是"压着就算"）、竖直按 AABB 的规则（重叠 > 1 cm）。
// opts.skipBoxes 同 sweepOBBs（跳过这几块静态 AABB）。
// opts.ignoreKey 同 raycast（OBB 前缀、AABB 精确）；opts.out 给了就写进重叠的记录（AABB 记录 / OBB 记录，可以直接交给
// obbVsAabb / obbVsObb 算深度）。返回重叠的个数。叉车停稳后核对"没压进墙"、放货前看落点空不空用
const candOvObbA = [], candOvObbO = [];
function overlapOBB(o, opts) {
  const out = opts && Array.isArray(opts.out) ? opts.out : null;
  if (out) out.length = 0;
  const S = makeObb(o, null);
  if (!S) return 0;
  const tol = opts && typeof opts.tol === 'number' && opts.tol >= 0 ? opts.tol : 0.005;
  const y0 = S.minY + Y_EPS, y1 = S.maxY - Y_EPS;
  const ign = setIgnore(opts), skip = skipList(opts);
  let n = 0;
  try {
    const list = queryBox(S.minX, S.minZ, S.maxX, S.maxZ, y0, y1, candOvObbA);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (ign && ignored(s)) continue;
      if (skip && skipped(s, skip)) continue;
      if (!(satBO((s.minX + s.maxX) * 0.5, (s.minZ + s.maxZ) * 0.5, (s.maxX - s.minX) * 0.5, (s.maxZ - s.minZ) * 0.5, S) > tol)) continue;
      n++;
      if (out) out.push(s);
    }
    list.length = 0;
    if (obbCount) {
      const ol = queryObb(S.minX, S.minZ, S.maxX, S.maxZ, y0, y1, candOvObbO);
      for (let i = 0; i < ol.length; i++) {
        const b = ol[i];
        if (ign && ignoredObb(b)) continue;
        if (!(satOO(S, b) > tol)) continue;
        n++;
        if (out) out.push(b);
      }
      ol.length = 0;
    }
  } finally { ignA = ignB = ignList = null; }
  return n;
}

// 圆柱是否与任何盒子重叠（出生点校验、重生点检查用；不在第 12 节 API 里，属于附加能力）。OBB 也算（压进去超过 PEN_TOL）
function overlapCircle(x, z, r, yFeet, height) {
  if (!(r > 0)) r = 0.01;
  if (yFeet == null) yFeet = groundY(x, z);
  if (!(height > 0)) height = defaultHeight();
  const list = queryBox(x - r, z - r, x + r, z + r, yFeet + Y_EPS, yFeet + Math.max(height, 3 * Y_EPS) - Y_EPS, candOverlap);
  const lim2 = (r - PEN_TOL) * (r - PEN_TOL);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const cx = x < s.minX ? s.minX : x > s.maxX ? s.maxX : x;
    const cz = z < s.minZ ? s.minZ : z > s.maxZ ? s.maxZ : z;
    const ddx = x - cx, ddz = z - cz;
    if (ddx * ddx + ddz * ddz < lim2) return true;
  }
  if (obbCount !== 0 && obbNearby(+x, +z, r)) {
    const ol = queryObb(x - r, z - r, x + r, z + r, yFeet + Y_EPS, yFeet + Math.max(height, 3 * Y_EPS) - Y_EPS, candObbOverlap);
    for (let i = 0; i < ol.length; i++) if (circlePen(ol[i], +x, +z, r) > PEN_TOL) { ol.length = 0; return true; }
    ol.length = 0;
  }
  return false;
}

// ---------- 视线 / 射线 ----------
let slabAxis = -1, slabSign = 0;

// 线段 o + d·t（t ∈ [0, tEnd]）与盒子的 slab 相交，返回进入参数 t（起点在盒内为 0），不相交返回 -1。
// epsT：端点刚好贴在表面上（物品放在地板顶面、眼睛贴着墙面往外看）不算挡
function slab(ox, oy, oz, dx, dy, dz, s, tEnd, epsT) {
  slabTests++;
  let t0 = 0, t1 = tEnd, axis = -1, sign = 0;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < s.minX || ox > s.maxX) return -1;
  } else {
    const inv = 1 / dx;
    let ta = (s.minX - ox) * inv, tb = (s.maxX - ox) * inv, sg = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
    if (ta > t0) { t0 = ta; axis = 0; sign = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < s.minY || oy > s.maxY) return -1;
  } else {
    const inv = 1 / dy;
    let ta = (s.minY - oy) * inv, tb = (s.maxY - oy) * inv, sg = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
    if (ta > t0) { t0 = ta; axis = 1; sign = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < s.minZ || oz > s.maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let ta = (s.minZ - oz) * inv, tb = (s.maxZ - oz) * inv, sg = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
    if (ta > t0) { t0 = ta; axis = 2; sign = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (t1 <= epsT || t0 >= tEnd - epsT) return -1;
  slabAxis = axis; slabSign = sign;
  return t0;
}

let castAxis = -1, castSign = 0, castKey = null;
let castIgn = false;   // raycast 带 ignoreKey 时置位（视线 los 永远不带，走原来的快路径）
let castSkip = null;   // raycast 带 skipBoxes 时的那张表

// 沿线段的 XZ 投影逐格走（Amanatides–Woo 网格 DDA），只测经过格子里的盒子。
// anyHit=true（视线）碰到第一块就返回；否则找最近命中，并在"最近命中早于当前格出口"时提前停。
function cast(ox, oy, oz, dx, dy, dz, tEnd, anyHit, epsT) {
  let best = -1;
  castAxis = -1; castSign = 0; castKey = null;
  for (let i = 0; i < big.length; i++) {
    if (castIgn && ignored(big[i])) continue;
    if (castSkip && skipped(big[i], castSkip)) continue;
    const t = slab(ox, oy, oz, dx, dy, dz, big[i], tEnd, epsT);
    if (t >= 0 && (best < 0 || t < best)) {
      best = t; castAxis = slabAxis; castSign = slabSign; castKey = big[i].key;
      if (anyHit) return best;
    }
  }
  if (grid.size === 0) return best;

  const q = ++stamp;
  let ix = Math.floor(ox * INV_CELL), iz = Math.floor(oz * INV_CELL);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDX = stepX ? CELL / Math.abs(dx) : Infinity;
  const tDZ = stepZ ? CELL / Math.abs(dz) : Infinity;
  let tMX = stepX > 0 ? ((ix + 1) * CELL - ox) / dx : stepX < 0 ? (ix * CELL - ox) / dx : Infinity;
  let tMZ = stepZ > 0 ? ((iz + 1) * CELL - oz) / dz : stepZ < 0 ? (iz * CELL - oz) / dz : Infinity;

  for (let guard = 0; guard < 100000; guard++) {
    const list = grid.get(cellKey(ix, iz));
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.q === q) continue;
        s.q = q;
        if (castIgn && ignored(s)) continue;
        if (castSkip && skipped(s, castSkip)) continue;
        const t = slab(ox, oy, oz, dx, dy, dz, s, tEnd, epsT);
        if (t >= 0 && (best < 0 || t < best)) {
          best = t; castAxis = slabAxis; castSign = slabSign; castKey = s.key;
          if (anyHit) return best;
        }
      }
    }
    const tExit = tMX < tMZ ? tMX : tMZ;
    // 盒子登记在它覆盖的每一格里，命中点必在已走过的格子中，所以 best ≤ 出口即可停
    if ((best >= 0 && best <= tExit) || tExit >= tEnd) break;
    if (tMX < tMZ) { ix += stepX; tMX += tDX; } else { iz += stepZ; tMZ += tDZ; }
  }
  return best;
}

// OBB 的射线：把线段转进 OBB 局部坐标做 slab（旋转不改参数 t，命中距离直接可用）。
// 先用全部 OBB 的外接盒把线段裁短，远处没有 OBB 时一格都不走；命中写 obbCastRec / obbCastAxis / obbCastSign（局部轴）
let obbCastRec = null, obbCastAxis = -1, obbCastSign = 0;
function slabObb(ox, oy, oz, dx, dy, dz, o, tEnd, epsT) {
  const rx = ox - o.cx, rz = oz - o.cz;
  return slab(o.c * rx - o.s * rz, oy, o.s * rx + o.c * rz, o.c * dx - o.s * dz, dy, o.s * dx + o.c * dz, o.lb, tEnd, epsT);
}
let clipA = 0, clipB = 0;
function clip1(o, d, lo, hi) {
  if (d > -1e-12 && d < 1e-12) return o >= lo && o <= hi;
  let u = (lo - o) / d, w = (hi - o) / d;
  if (u > w) { const t = u; u = w; w = t; }
  if (u > clipA) clipA = u;
  if (w < clipB) clipB = w;
  return clipA <= clipB;
}
function castObb(ox, oy, oz, dx, dy, dz, tEnd, anyHit, epsT) {
  let best = -1;
  obbCastRec = null; obbCastAxis = -1; obbCastSign = 0;
  if (!obbCount) return -1;
  // 线段和 OBB 总外接盒（3D）的参数区间 [ta, tb]
  clipA = 0; clipB = tEnd;
  if (!clip1(ox, dx, obbBX0, obbBX1) || !clip1(oy, dy, obbBY0, obbBY1) || !clip1(oz, dz, obbBZ0, obbBZ1)) return -1;
  const ta = clipA, tb = clipB;
  for (let i = 0; i < obbBig.length; i++) {
    const o = obbBig[i];
    if (castIgn && ignoredObb(o)) continue;
    const t = slabObb(ox, oy, oz, dx, dy, dz, o, tEnd, epsT);
    if (t >= 0 && (best < 0 || t < best)) {
      best = t; obbCastRec = o; obbCastAxis = slabAxis; obbCastSign = slabSign;
      if (anyHit) return best;
    }
  }
  if (obbBkUsed === 0) return best;
  const q = ++stamp;
  const sx = ox + dx * ta, sz = oz + dz * ta;
  let ix = Math.floor(sx * INV_CELL), iz = Math.floor(sz * INV_CELL);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDX = stepX ? CELL / Math.abs(dx) : Infinity;
  const tDZ = stepZ ? CELL / Math.abs(dz) : Infinity;
  let tMX = stepX > 0 ? ((ix + 1) * CELL - ox) / dx : stepX < 0 ? (ix * CELL - ox) / dx : Infinity;
  let tMZ = stepZ > 0 ? ((iz + 1) * CELL - oz) / dz : stepZ < 0 ? (iz * CELL - oz) / dz : Infinity;
  for (let guard = 0; guard < 100000; guard++) {
    const list = obbBk[obbBucket(ix, iz)];
    if (list !== null) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.q === q) continue;
        o.q = q;
        if (castIgn && ignoredObb(o)) continue;
        const t = slabObb(ox, oy, oz, dx, dy, dz, o, tEnd, epsT);
        if (t >= 0 && (best < 0 || t < best)) {
          best = t; obbCastRec = o; obbCastAxis = slabAxis; obbCastSign = slabSign;
          if (anyHit) return best;
        }
      }
    }
    const tExit = tMX < tMZ ? tMX : tMZ;
    if ((best >= 0 && best <= tExit) || tExit >= tb) break;
    if (tMX < tMZ) { ix += stepX; tMX += tDX; } else { iz += stepZ; tMZ += tDZ; }
  }
  return best;
}

// true = 视线通畅（起点在 OBB 里面也算被挡，和 AABB 一样）
function los(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-9)) return true;
  if (cast(ax, ay, az, dx, dy, dz, 1, true, 1e-4 / L) >= 0) return false;
  if (!obbCount) return true;
  return castObb(ax, ay, az, dx, dy, dz, 1, true, 1e-4 / L) < 0;
}

// 方向不要求归一化；dist 以米计。附带命中面法线 nx/ny/nz（起点在盒内时为 0 向量）和命中盒子登记时的 key。
// opts.ignoreKey：字符串或数组，跳过这些 key 的碰撞体（准心对准货架里的箱子时把父道具链传进来，货架整块碰撞盒就不挡了）
// opts.skipBoxes：同 sweepOBBs（跳过这几块静态 AABB）
// 打到 OBB 时法线转回世界坐标，另外带 obb:true 和登记时的部件名 name
function raycast(ox, oy, oz, dx, dy, dz, max, opts) {
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-12)) return null;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  if (!(max > 0) || max > RAY_MAX) max = RAY_MAX;
  castIgn = setIgnore(opts);
  castSkip = skipList(opts);
  let t, ot = -1;
  try {
    t = cast(ox, oy, oz, ux, uy, uz, max, false, 1e-6);
    if (obbCount) ot = castObb(ox, oy, oz, ux, uy, uz, t >= 0 ? t : max, false, 1e-6);
  }
  finally { castIgn = false; castSkip = null; ignA = ignB = ignList = null; }
  if (ot >= 0 && (t < 0 || ot < t)) {
    const o = obbCastRec, a = obbCastAxis, sg = obbCastSign;
    // 局部 x 轴在世界里是 (c, −s)，局部 z 轴是 (s, c)
    const nx = a === 0 ? sg * o.c : a === 2 ? sg * o.s : 0;
    const nz = a === 0 ? -sg * o.s : a === 2 ? sg * o.c : 0;
    return {
      dist: ot, x: ox + ux * ot, y: oy + uy * ot, z: oz + uz * ot,
      nx, ny: a === 1 ? sg : 0, nz,
      key: o.key, obb: true, name: o.name,
    };
  }
  if (t < 0) return null;
  return {
    dist: t, x: ox + ux * t, y: oy + uy * t, z: oz + uz * t,
    nx: castAxis === 0 ? castSign : 0, ny: castAxis === 1 ? castSign : 0, nz: castAxis === 2 ? castSign : 0,
    key: castKey,
  };
}

// ---------- 一组随车转动的 OBB 的扫掠 ----------
// sweepOBBs(list, motion, opts) → { t, key, circleId, kind, index, name, box, boxIndex, depth } | null
//   list：这一刻（t = 0）的 OBB（世界坐标，{cx, cz, hx, hz, rot, minY, maxY, name?}）——叉车的 14 个部件、叉着的货
//   motion：{ dx, dz, dyaw, px, pz }：t 从 0 到 1，整组绕 (px, pz) 转 dyaw（和 rot 同向）再平移 (dx, dz)；
//     即 t 时刻中心 = (px, pz) + t·(dx, dz) + R(t·dyaw)·(中心₀ − (px, pz))，rot = rot₀ + t·dyaw。px/pz 缺省 = 各 OBB 中心的平均
//   opts.ignoreKey：跳过的碰撞 key（车自己的 'veh|<key>' 或 'cx,cz#v<i>'：OBB 按前缀、AABB 精确，规则同 raycast）
//   opts.skipBoxes：[[minX, minY, minZ, maxX, maxY, maxZ]…] 跳过这几块静态 AABB（见 skipped；叉车换成斜放地牛的真实形状时用）
//   opts.circles：[{x, z, r, minY, maxY, id}]（人、怪；也认 [x, z, r, id]），竖直范围缺省无限
//   opts.boxes：禁区 —— world.blockers() 的 {x, z, r, y?}（圆，带 y 时和车底高度差 > 2.5 m 的不算）、{x0, z0, x1, z1}（矩形，无限高）；
//     也认 {minX, maxX, minZ, maxZ, minY?, maxY?}（只给 y 时当底面高、往上无限，例如 L1 的 b.data.overhead 条目）
//   opts.y：车底高度（只给出口圈的 y 比较用，缺省取 list 里最低的 minY）
// 每个子步任何一点位移 ≤ 5 cm、转角 ≤ 2°，逐个子步查（离障碍不到 0.1 mm 就算碰上）；碰上以后在前后两个子步之间二分到 < 1 µm，
// 所以停下的位姿和障碍之间总留着 0.1 mm 左右的缝，下一帧从「不重叠」出发（不会被当成「起点就压着」）。
// 出发时（t = 0）已经贴着（0.1 mm 以内）或压着的东西：只要不更近 / 更深就不算撞（贴墙能倒出来、沿着墙开），更近 / 更深才算。
// 竖直方向按 AABB 的规则：两段 Y 区间重叠不超过 1 cm 的不算（车轮压着地板、货叉面贴着横梁底）。
// 返回最后一个不撞的时刻 t（0..1）和撞到的东西：key（静态 AABB / OBB 的登记 key）、circleId（圆的 id，缺省为下标）、
// box / boxIndex（禁区原对象和下标）、kind（'solid' | 'obb' | 'circle' | 'box'）、index / name（list 里撞上的那一块和它的 name）、
// depth（碰上那一刻的压入深度，负数 = 还差这么多）。整段都不撞返回 null。
const candSwA = [], candSwO = [];
function sweepOBBs(list, motion, opts) {
  if (!Array.isArray(list) || !list.length) return null;
  const m = motion || {};
  const mdx = fin(+m.dx) ? +m.dx : 0, mdz = fin(+m.dz) ? +m.dz : 0, dyaw = fin(+m.dyaw) ? +m.dyaw : 0;
  if (mdx === 0 && mdz === 0 && dyaw === 0) return null;
  // 车上的 OBB
  const mv = [];
  let sumX = 0, sumZ = 0;
  for (let i = 0; i < list.length; i++) {
    const r = makeObb(list[i], null);
    if (!r) continue;
    r.i = i;
    mv.push(r);
    sumX += r.cx; sumZ += r.cz;
  }
  if (!mv.length) return null;
  const px = fin(+m.px) ? +m.px : sumX / mv.length, pz = fin(+m.pz) ? +m.pz : sumZ / mv.length;
  let rMax = 0, yLo = Infinity, yHi = -Infinity;
  for (const o of mv) {
    o.ox = o.cx - px; o.oz = o.cz - pz; o.c0 = o.c; o.s0 = o.s;
    const rr = Math.sqrt(o.ox * o.ox + o.oz * o.oz) + Math.sqrt(o.hx * o.hx + o.hz * o.hz);
    if (rr > rMax) rMax = rr;
    if (o.minY < yLo) yLo = o.minY;
    if (o.maxY > yHi) yHi = o.maxY;
  }
  const disp = Math.sqrt(mdx * mdx + mdz * mdz) + Math.abs(dyaw) * rMax;
  let n = Math.ceil(Math.max(disp / SW_STEP, Math.abs(dyaw) / SW_ANG));
  if (!(n >= 1)) n = 1; else if (n > SW_MAX_N) n = SW_MAX_N;
  const stepPad = disp / n + 0.01;
  // 每块的扫掠外接盒（各子步外接 AABB 的并，再外扩一个子步的位移）
  for (const o of mv) { o.bx0 = Infinity; o.bx1 = -Infinity; o.bz0 = Infinity; o.bz1 = -Infinity; }
  for (let k = 0; k <= n; k++) {
    poseAt(mv, k / n, px, pz, mdx, mdz, dyaw);
    for (const o of mv) {
      const ac = Math.abs(o.c), as = Math.abs(o.s), ex = ac * o.hx + as * o.hz, ez = as * o.hx + ac * o.hz;
      if (o.cx - ex < o.bx0) o.bx0 = o.cx - ex; if (o.cx + ex > o.bx1) o.bx1 = o.cx + ex;
      if (o.cz - ez < o.bz0) o.bz0 = o.cz - ez; if (o.cz + ez > o.bz1) o.bz1 = o.cz + ez;
    }
  }
  let ux0 = Infinity, ux1 = -Infinity, uz0 = Infinity, uz1 = -Infinity;
  for (const o of mv) {
    o.bx0 -= stepPad; o.bx1 += stepPad; o.bz0 -= stepPad; o.bz1 += stepPad;
    if (o.bx0 < ux0) ux0 = o.bx0; if (o.bx1 > ux1) ux1 = o.bx1;
    if (o.bz0 < uz0) uz0 = o.bz0; if (o.bz1 > uz1) uz1 = o.bz1;
  }
  // 障碍：静态 AABB、别的 OBB、圆、禁区，统一成 {t: 0 盒 / 1 圆, cx, cz, hx, hz, c, s | x, z, r, minY, maxY, 包围盒}
  const obs = [];
  const ign = setIgnore(opts), skip = skipList(opts);
  try {
    const sa = queryBox(ux0, uz0, ux1, uz1, yLo + Y_EPS, yHi - Y_EPS, candSwA);
    for (let i = 0; i < sa.length; i++) {
      const s = sa[i];
      if (ign && ignored(s)) continue;
      if (skip && skipped(s, skip)) continue;
      obs.push({ t: 0, cx: (s.minX + s.maxX) * 0.5, cz: (s.minZ + s.maxZ) * 0.5, hx: (s.maxX - s.minX) * 0.5, hz: (s.maxZ - s.minZ) * 0.5,
        c: 1, s: 0, minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, minY: s.minY, maxY: s.maxY, kind: 'solid', key: s.key, src: s });
    }
    sa.length = 0;
    if (obbCount) {
      const so = queryObb(ux0, uz0, ux1, uz1, yLo + Y_EPS, yHi - Y_EPS, candSwO);
      for (let i = 0; i < so.length; i++) {
        const o = so[i];
        if (ign && ignoredObb(o)) continue;
        obs.push({ t: 0, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, c: o.c, s: o.s, minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ,
          minY: o.minY, maxY: o.maxY, kind: 'obb', key: o.key, name: o.name, src: o });
      }
      so.length = 0;
    }
  } finally { ignA = ignB = ignList = null; }
  const o2 = opts || {};
  if (Array.isArray(o2.circles)) {
    for (let i = 0; i < o2.circles.length; i++) {
      const c = o2.circles[i];
      if (!c) continue;
      const arr = Array.isArray(c);
      const x = +(arr ? c[0] : c.x), z = +(arr ? c[1] : c.z), r = +(arr ? c[2] : c.r);
      if (!fin(x) || !fin(z) || !(r > 0) || !fin(r)) continue;
      const id = arr ? (c[3] !== undefined ? c[3] : i) : (c.id !== undefined ? c.id : i);
      const minY = !arr && fin(+c.minY) ? +c.minY : -Infinity, maxY = !arr && fin(+c.maxY) ? +c.maxY : Infinity;
      if (x + r < ux0 || x - r > ux1 || z + r < uz0 || z - r > uz1) continue;
      obs.push({ t: 1, x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY, maxY, kind: 'circle', circleId: id });
    }
  }
  if (Array.isArray(o2.boxes)) {
    const baseY = fin(+o2.y) ? +o2.y : yLo;
    for (let i = 0; i < o2.boxes.length; i++) {
      const b = o2.boxes[i];
      if (!b || typeof b !== 'object') continue;
      let e = null;
      if (b.x0 != null && b.z0 != null && b.x1 != null && b.z1 != null) {
        const x0 = Math.min(+b.x0, +b.x1), x1 = Math.max(+b.x0, +b.x1), z0 = Math.min(+b.z0, +b.z1), z1 = Math.max(+b.z0, +b.z1);
        if (fin(x0) && fin(x1) && fin(z0) && fin(z1)) {
          e = { t: 0, cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, hx: (x1 - x0) * 0.5, hz: (z1 - z0) * 0.5, c: 1, s: 0,
            minX: x0, maxX: x1, minZ: z0, maxZ: z1,
            minY: fin(+b.minY) ? +b.minY : -Infinity, maxY: fin(+b.maxY) ? +b.maxY : Infinity };
        }
      } else if (b.minX != null && b.maxX != null && b.minZ != null && b.maxZ != null) {
        const x0 = Math.min(+b.minX, +b.maxX), x1 = Math.max(+b.minX, +b.maxX), z0 = Math.min(+b.minZ, +b.maxZ), z1 = Math.max(+b.minZ, +b.maxZ);
        if (fin(x0) && fin(x1) && fin(z0) && fin(z1)) {
          const y0 = fin(+b.minY) ? +b.minY : fin(+b.y) ? +b.y : -Infinity, y1 = fin(+b.maxY) ? +b.maxY : Infinity;
          e = { t: 0, cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, hx: (x1 - x0) * 0.5, hz: (z1 - z0) * 0.5, c: 1, s: 0,
            minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: Math.min(y0, y1), maxY: Math.max(y0, y1) };
        }
      } else if (fin(+b.x) && fin(+b.z) && +b.r > 0 && fin(+b.r)) {
        if (fin(+b.y) && Math.abs(+b.y - baseY) > EXIT_DY) continue;
        const x = +b.x, z = +b.z, r = +b.r;
        e = { t: 1, x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY: -Infinity, maxY: Infinity };
      }
      if (!e) continue;
      if (e.maxX < ux0 || e.minX > ux1 || e.maxZ < uz0 || e.minZ > uz1) continue;
      e.kind = 'box'; e.box = b; e.boxIndex = i;
      obs.push(e);
    }
  }
  if (!obs.length) return null;
  // 配对：每块车上 OBB × 扫掠外接盒相交、竖直重叠超过 Y_EPS 的障碍
  const pi = [], pj = [];
  for (let a = 0; a < mv.length; a++) {
    const o = mv[a];
    for (let j = 0; j < obs.length; j++) {
      const b = obs[j];
      if (b.maxX < o.bx0 || b.minX > o.bx1 || b.maxZ < o.bz0 || b.minZ > o.bz1) continue;
      if (b.maxY <= o.minY + Y_EPS || b.minY >= o.maxY - Y_EPS) continue;
      pi.push(a); pj.push(j);
    }
  }
  if (!pi.length) return null;
  const P = pi.length;
  const d0 = new Float64Array(P);
  poseAt(mv, 0, px, pz, mdx, mdz, dyaw);
  for (let p = 0; p < P; p++) d0[p] = pairDepth(mv[pi[p]], obs[pj[p]]);
  // 逐个子步
  let hitP = -1, lo = 0, hi = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    poseAt(mv, t, px, pz, mdx, mdz, dyaw);
    const h = firstHit(mv, obs, pi, pj, d0, P);
    if (h >= 0) { hitP = h; lo = (k - 1) / n; hi = t; break; }
  }
  if (hitP < 0) return null;
  for (let it = 0; it < SW_BISECT; it++) {
    const mid = (lo + hi) * 0.5;
    poseAt(mv, mid, px, pz, mdx, mdz, dyaw);
    const h = firstHit(mv, obs, pi, pj, d0, P);
    if (h >= 0) { hi = mid; hitP = h; } else lo = mid;
  }
  poseAt(mv, hi, px, pz, mdx, mdz, dyaw);
  const A = mv[pi[hitP]], B = obs[pj[hitP]];
  return {
    t: lo,
    key: B.key !== undefined ? B.key : null,
    circleId: B.kind === 'circle' ? B.circleId : null,
    kind: B.kind,
    index: A.i, name: A.name,
    box: B.kind === 'box' ? B.box : null,
    boxIndex: B.kind === 'box' ? B.boxIndex : -1,
    obstacleName: B.kind === 'obb' ? B.name : null,
    depth: pairDepth(A, B),
  };
}
// t 时刻每块车上 OBB 的中心和朝向
function poseAt(mv, t, px, pz, mdx, mdz, dyaw) {
  const th = dyaw * t, ct = Math.cos(th), st = Math.sin(th);
  const bx = px + mdx * t, bz = pz + mdz * t;
  for (let i = 0; i < mv.length; i++) {
    const o = mv[i];
    o.cx = bx + ct * o.ox + st * o.oz;
    o.cz = bz - st * o.ox + ct * o.oz;
    o.c = o.c0 * ct - o.s0 * st;
    o.s = o.s0 * ct + o.c0 * st;
  }
}
// 一对（车上的 OBB a、障碍 b）的水平穿透深度（> 0 = 压着）
function pairDepth(a, b) {
  if (b.t === 1) return circlePen(a, b.x, b.z, b.r);
  return satOO(a, b);
}
function firstHit(mv, obs, pi, pj, d0, P) {
  for (let p = 0; p < P; p++) {
    const a = mv[pi[p]], b = obs[pj[p]];
    // 快速排除：这一刻 a 的外接盒（外扩 SW_GAP）和 b 的不相交
    const ac = Math.abs(a.c), as = Math.abs(a.s), ex = ac * a.hx + as * a.hz + SW_GAP, ez = as * a.hx + ac * a.hz + SW_GAP;
    if (a.cx + ex <= b.minX || a.cx - ex >= b.maxX || a.cz + ez <= b.minZ || a.cz - ez >= b.maxZ) continue;
    // 出发时离得 ≥ SW_GAP：靠到 SW_GAP 以内就算撞（停下时留缝）；出发时已经贴着（上一帧刚撞停）或压着：只要比出发时更近 / 更深就算撞，
    // 往外、沿着面走都不算（贴墙能倒出来）。不能按「出发深度 + 容差」放宽，否则顶着墙一帧一帧开会每帧多挤进去一点
    const d = pairDepth(a, b), d0p = d0[p];
    if (d0p > -SW_GAP ? d > d0p + 1e-9 : d > -SW_GAP) return p;
  }
  return -1;
}

// ---------- 纯函数（叉车算货架精细碰撞、支撑、测试核对用） ----------
// 形状可以是 OBB {cx, cz, hx, hz, rot, minY?, maxY?}（也认 cy/hy），也可以是 AABB {minX, maxX, minZ, maxZ, minY?, maxY?}
// （phys 的 out / overlapBox 交出来的记录两种都有，OBB 记录带 obb:true）。竖直范围缺省无限。
function shapeOf(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.hx != null && o.hz != null && o.cx != null && o.cz != null) return makeObb(o, null);
  if (o.minX == null || o.maxX == null || o.minZ == null || o.maxZ == null) return null;
  const x0 = Math.min(+o.minX, +o.maxX), x1 = Math.max(+o.minX, +o.maxX), z0 = Math.min(+o.minZ, +o.maxZ), z1 = Math.max(+o.minZ, +o.maxZ);
  if (!fin(x0) || !fin(x1) || !fin(z0) || !fin(z1)) return null;
  const a = o.minY == null ? -Infinity : +o.minY, b = o.maxY == null ? Infinity : +o.maxY;
  if (a !== a || b !== b) return null;
  return { cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, hx: (x1 - x0) * 0.5, hz: (z1 - z0) * 0.5, c: 1, s: 0, minY: Math.min(a, b), maxY: Math.max(a, b) };
}
function depth3(A, B) {
  if (!A || !B) return 0;
  const m = satOO(A, B);
  if (!(m > 0)) return 0;
  const vy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
  if (!(vy > 0)) return 0;
  return vy < m ? vy : m;
}
// obbVsObb(a, b) / obbVsAabb(o, a)：穿透深度（米，2D 分离轴 4 根轴加竖直区间里最小的重叠量）；分开或刚好贴着返回 0。
// 当布尔用也行（0 = 不相交）
function obbVsObb(a, b) { return depth3(shapeOf(a), shapeOf(b)); }
function obbVsAabb(o, a) { return depth3(shapeOf(o), shapeOf(a)); }
// circleVsObb(x, z, r, o, yFeet?, height?)（也认 circleVsObb(o, x, z, r)）：圆柱压进 OBB 多深。
// 不相交返回 null；相交返回 { depth, nx, nz }（把圆推出去的方向，世界坐标单位向量）。给了 yFeet / height 时竖直按 AABB 的规则判
function circleVsObb(a, b, c, d, e, f) {
  let x, z, r, o, yF, h;
  if (a && typeof a === 'object') { o = a; x = +b; z = +c; r = +d; yF = e; h = f; }
  else { x = +a; z = +b; r = +c; o = d; yF = e; h = f; }
  const S = shapeOf(o);
  if (!S || !fin(x) || !fin(z) || !(r >= 0)) return null;
  if (yF != null && fin(+yF)) {
    const y0 = +yF + Y_EPS, y1 = +yF + Math.max(fin(+h) && +h > 0 ? +h : defaultHeight(), 3 * Y_EPS) - Y_EPS;
    if (S.maxY <= y0 || S.minY >= y1) return null;
  }
  const pen = circlePen(S, x, z, r);
  if (!(pen > 0)) return null;
  return { depth: pen, nx: obNX, nz: obNZ };
}
// pointInObb(o, x, z) / pointInObb(o, x, y, z) / pointInObb(x, z, o) / pointInObb(x, y, z, o)：点在不在盒子里（含边界）；
// 给了 y 就连竖直区间一起判
function pointInObb(a, b, c, d) {
  let o, x, y = null, z;
  if (a && typeof a === 'object') { o = a; if (d !== undefined) { x = +b; y = +c; z = +d; } else { x = +b; z = +c; } }
  else if (c && typeof c === 'object') { x = +a; z = +b; o = c; }
  else { x = +a; y = +b; z = +c; o = d; }
  const S = shapeOf(o);
  if (!S || !fin(x) || !fin(z)) return false;
  if (y !== null && !(y >= S.minY && y <= S.maxY)) return false;
  const dx = x - S.cx, dz = z - S.cz;
  const lx = S.c * dx - S.s * dz, lz = S.s * dx + S.c * dz;
  return lx >= -S.hx && lx <= S.hx && lz >= -S.hz && lz <= S.hz;
}

// toWorldOBBs(list, x, z, yaw, y?)：本地坐标的部件盒子（叉车 geo.obbs(lift) 的 {name, cx, cy, cz, hx, hy, hz}，绕 y 不转）
// 摆到世界里：车的原点在 (x, y, z)、朝向 yaw（= 网格的 rotation.y）。返回 addOBBs / sweepOBBs 直接能用的
// [{name, cx, cz, hx, hz, rot: yaw, minY, maxY}]。本地盒子自己带 rot 的话叠加上去
function toWorldOBBs(list, x, z, yaw, y) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const X = +x || 0, Z = +z || 0, Y = +y || 0, a = +yaw || 0, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o) continue;
    const lx = +o.cx || 0, lz = +o.cz || 0;
    let minY, maxY;
    if (o.minY != null || o.maxY != null) { minY = o.minY == null ? -Infinity : Y + +o.minY; maxY = o.maxY == null ? Infinity : Y + +o.maxY; }
    else if (o.cy != null && o.hy != null) { minY = Y + +o.cy - Math.abs(+o.hy); maxY = Y + +o.cy + Math.abs(+o.hy); }
    else { minY = -Infinity; maxY = Infinity; }
    out.push({ name: o.name == null ? null : o.name, cx: X + c * lx + s * lz, cz: Z - s * lx + c * lz, hx: +o.hx, hz: +o.hz, rot: a + (+o.rot || 0), minY, maxY });
  }
  return out;
}

// ---------- 地面 ----------
function groundY(x, z) {
  if (groundFn) {
    const y = groundFn(x, z);
    if (Number.isFinite(y)) return y;   // 层级函数在边界外返回 undefined/NaN 时退回平地，别让玩家掉进 NaN
  }
  return 0;
}
function setGroundFn(fn) { groundFn = typeof fn === 'function' ? fn : null; }

function stats() {
  return { keys: byKey.size, solids: solidCount, cells: grid.size, big: big.length, slabTests, obbKeys: obbByKey.size, obbs: obbCount, obbCells: obbBkUsed };
}

// records(key)：key 本身和 '<key>#…' 名下登记的碰撞体（拷贝），测试和调试用：{ solids: [{key, minX…maxZ}], obbs: [{key, name, cx, cz, hx, hz, rot, minY, maxY}] }。
// key 缺省 = 全部
function records(key) {
  const all = key == null;
  const k0 = all ? '' : String(key);
  const res = { solids: [], obbs: [] };
  byKey.forEach((recs, k) => {
    if (!all && !keyUnder(k, k0)) return;
    for (const s of recs) res.solids.push({ key: k, minX: s.minX, minY: s.minY, minZ: s.minZ, maxX: s.maxX, maxY: s.maxY, maxZ: s.maxZ });
  });
  obbByKey.forEach((recs, k) => {
    if (!all && !keyUnder(k, k0)) return;
    for (const o of recs) res.obbs.push({ key: k, name: o.name, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, rot: o.rot, minY: o.minY, maxY: o.maxY });
  });
  return res;
}

BR.phys = {
  addSolids, removeSolids, clear,
  moveCircle, moveBox, los, raycast,
  groundY, setGroundFn,
  overlapCircle, overlapBox, stats,
  addOBBs, sweepOBBs, overlapOBB, records,
  obbVsAabb, obbVsObb, circleVsObb, pointInObb, toWorldOBBs,
  CELL,
};
})();
