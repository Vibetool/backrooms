// 后室 · 物理：AABB 碰撞、贴墙滑动、视线检测（BR.phys，接口见 ARCHITECTURE.md 第 12 节）
// 纯逻辑，不依赖 THREE，node 里也能直接跑（tests/phys.test.js）。
// 世界里的实心物体全是轴对齐盒子（ChunkResult.solids），玩家/实体是竖直圆柱，
// 所以碰撞只在 XZ 平面做"圆 vs 矩形"，Y 只用来筛掉头顶横梁、脚下地板这类不重叠的盒子。
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
const RAY_MAX = 1e4;         // raycast 的 max 缺省或为无穷时的上限，防止 DDA 走不完
const KEY_OFF = 1 << 20, KEY_SPAN = 1 << 21;   // 数字格子 key 比拼字符串快；±2^20 格 ≈ ±4000 km，够用

function cellKey(ix, iz) { return (ix + KEY_OFF) * KEY_SPAN + (iz + KEY_OFF); }
function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i < 0) return;
  const last = arr.pop();
  if (i < arr.length) arr[i] = last;   // 顺序无所谓，交换删除省掉 splice 的整体搬移
}

// ---------- 存储 ----------
// 记录是内部拷贝：不往层级传进来的对象上挂查询戳，也不怕层级之后改动原数组
let byKey = new Map();   // 区块 key → rec[]
let grid = new Map();    // cellKey → rec[]
let big = [];            // 巨型盒子，每次查询线性过一遍
let solidCount = 0;
let stamp = 0;           // 查询戳：一个盒子跨多格时同一次查询只处理一次
let groundFn = null;
let slabTests = 0;       // 累计 slab 测试次数，自测用来确认候选收集没有退化成全量遍历

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
// '3,-1#p2'、'3,-1#f1'）。区块卸载、tests/golden.mjs 只按区块 key 摘时，道具的碰撞体也一起摘干净。返回摘掉的个数
function removeSolids(key) {
  key = String(key);
  let n = removeExact(key);
  const pre = key + '#';
  let kids = null;
  byKey.forEach((_, k) => { if (k.length > pre.length && k.startsWith(pre)) (kids || (kids = [])).push(k); });
  if (kids) for (const k of kids) n += removeExact(k);
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

// ---------- 圆柱移动 ----------
const candMove = [];
const candOverlap = [];

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
  if (list.length === 0) return { x: x + dx, z: z + dz, hitX: false, hitZ: false, hit: false };

  let px = x, pz = z, hitX = false, hitZ = false;
  if (depenetrate(px, pz, r, list)) {
    px = outX; pz = outZ;
    // 可能被推出去好几米，原来的候选不一定覆盖新位置
    list = queryBox(px - reach, pz - reach, px + reach, pz + reach, y0, y1, candMove);
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

// ---------- 忽略 key ----------
// ignoreKey 可以是一个字符串或字符串数组；碰撞 key（'3,-1#p2'）和道具 key（'L1@3,-1#p2'）都认：
// 道具 key 去掉 '<层级>@' 前缀就是它的碰撞 key（kit 的约定，见 _kit.js 的 skeyOf），interact 直接把父道具链的道具 key 传进来就行
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

// ---------- 盒子移动（拖动道具） ----------
// 轴对齐盒子 [minX,maxX]×[minZ,maxZ]（脚底 yFeet、高 h）在 XZ 上移动 (dx, dz)，分轴扫掠、贴墙滑动。
// 和 moveCircle 同一套思路：每轴是一维区间扫掠，不穿墙；分步只是让"先 X 后 Z"的折线贴近斜线。
// opts.ignoreKey：跳过这些 key 的碰撞体（被拖的道具自己、它的子道具）；opts.circles：[[x, z, r], ...] 额外的圆形障碍（玩家）。
// 出发时已经和某块重叠的不挡（生成时就挨着的家具，拖开就好）。返回 { dx, dz, hit, hitX, hitZ }（实际走成的位移）
const candBox = [];
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
  ignA = ignB = ignList = null;
  if (!list.length && !circles) return { dx, dz, hit: false, hitX: false, hitZ: false };

  const len = Math.sqrt(dx * dx + dz * dz);
  const half = Math.max(0.05, Math.min(x1 - x0, z1 - z0) * 0.5);
  let n = Math.ceil(len / half);
  if (n < 1) n = 1; else if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
  const sx = dx / n, sz = dz / n;
  let mx = 0, mz = 0, hitX = false, hitZ = false;
  for (let i = 0; i < n; i++) {
    const ex = sweepBoxX(x0 + mx, z0 + mz, x1 + mx, z1 + mz, sx, list, circles);
    if (blocked) hitX = true;
    mx += ex;
    const ez = sweepBoxZ(x0 + mx, z0 + mz, x1 + mx, z1 + mz, sz, list, circles);
    if (blocked) hitZ = true;
    mz += ez;
  }
  return { dx: mx, dz: mz, hit: hitX || hitZ, hitX, hitZ };
}

// 轴对齐盒子（脚底 yFeet、高 h）和哪些碰撞体重叠（每个方向都压进去超过 tol 才算，贴着不算）。
// opts.ignoreKey 同 moveBox；opts.out 给了就把重叠的碰撞体（phys 里的原对象）写进去。返回重叠的个数。
// 联机房主核对客机放下的道具用（客机自己拖的时候 moveBox 已经挡过；这里防两边不同步）
const candOverlapBox = [];
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
  ignA = ignB = ignList = null;
  list.length = 0;
  return n;
}

// 圆柱是否与任何盒子重叠（出生点校验、重生点检查用；不在第 12 节 API 里，属于附加能力）
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

// 沿线段的 XZ 投影逐格走（Amanatides–Woo 网格 DDA），只测经过格子里的盒子。
// anyHit=true（视线）碰到第一块就返回；否则找最近命中，并在"最近命中早于当前格出口"时提前停。
function cast(ox, oy, oz, dx, dy, dz, tEnd, anyHit, epsT) {
  let best = -1;
  castAxis = -1; castSign = 0; castKey = null;
  for (let i = 0; i < big.length; i++) {
    if (castIgn && ignored(big[i])) continue;
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

// true = 视线通畅
function los(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-9)) return true;
  return cast(ax, ay, az, dx, dy, dz, 1, true, 1e-4 / L) < 0;
}

// 方向不要求归一化；dist 以米计。附带命中面法线 nx/ny/nz（起点在盒内时为 0 向量）和命中盒子登记时的 key。
// opts.ignoreKey：字符串或数组，跳过这些 key 的碰撞体（准心对准货架里的箱子时把父道具链传进来，货架整块碰撞盒就不挡了）
function raycast(ox, oy, oz, dx, dy, dz, max, opts) {
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-12)) return null;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  if (!(max > 0) || max > RAY_MAX) max = RAY_MAX;
  castIgn = setIgnore(opts);
  let t;
  try { t = cast(ox, oy, oz, ux, uy, uz, max, false, 1e-6); }
  finally { castIgn = false; ignA = ignB = ignList = null; }
  if (t < 0) return null;
  return {
    dist: t, x: ox + ux * t, y: oy + uy * t, z: oz + uz * t,
    nx: castAxis === 0 ? castSign : 0, ny: castAxis === 1 ? castSign : 0, nz: castAxis === 2 ? castSign : 0,
    key: castKey,
  };
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
  return { keys: byKey.size, solids: solidCount, cells: grid.size, big: big.length, slabTests };
}

BR.phys = {
  addSolids, removeSolids, clear,
  moveCircle, moveBox, los, raycast,
  groundY, setGroundFn,
  overlapCircle, overlapBox, stats,
  CELL,
};
})();
