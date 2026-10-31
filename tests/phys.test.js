// 物理模块自测：node tests/phys.test.js [--print-baseline] [--perf-only]
// 不依赖测试框架和 THREE：伪造 window，把 base.js、phys.js 的源码按浏览器经典脚本的方式 eval 进全局。
//   PHYS_SRC=<路径> 换一份 phys.js 来跑（录"改前对照"时指向改前的 phys.js）；--print-baseline 只打印对照摘要不跑别的；
//   --perf-only 只跑名字以「性能」开头的用例
// 内容：AABB（原有）；改前对照（没有 OBB 时 1000+ 个随机用例逐位不变）；FE1 的 OBB（推出、贴边、起点重叠、薄货叉、射线、
// ignoreKey 前缀、removeSolids 子 key、overlapBox / overlapOBB 分离轴、moveBox、随机模糊）、sweepOBBs（薄墙、转动撞角、
// 圆 / 禁区 / 头顶管子、起点重叠）、叉车驾驶舱 los（测试常数 + 能载入时 L1 的 BR.L1forklift.geo.obbs）、纯函数、84 个 OBB 的耗时
global.window = { BR: {} };
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
function load(rel) {
  const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  (0, eval)(src + '\n//# sourceURL=' + rel);   // 间接 eval = 全局作用域，和 <script> 一致
}
load('js/core/base.js');
load(process.env.PHYS_SRC || 'js/core/phys.js');
const ARGS = process.argv.slice(2);

const BR = window.BR;
const P = BR.phys;

// ---------- 小工具 ----------
let passed = 0, failed = 0;
let all = [];   // 测试侧自己记一份盒子，用暴力法核对穿透，不依赖模块内部网格
let allObb = [];   // 同上，OBB
const PERF_ONLY = process.argv.includes('--perf-only');
function test(name, fn) {
  if (PERF_ONLY && !name.startsWith('性能')) return;
  P.clear();
  all = [];
  allObb = [];
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}  (${Date.now() - t0} ms)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.stack.split('\n').slice(0, 3).join('\n        ')}`);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg}：期望 ${b} ± ${eps}，实际 ${a}`);
}
function box(minX, minZ, maxX, maxZ, minY = 0, maxY = 3) { return { minX, minY, minZ, maxX, maxY, maxZ }; }
function add(key, solids) { P.addSolids(key, solids); all.push(...solids); }

// 暴力算最大穿透深度（XZ 圆 vs 矩形，只算 Y 重叠的）
function depth(x, z, r, yFeet = 0, h = 1.8) {
  let worst = 0;
  for (const s of all) {
    if (s.maxY <= yFeet + 0.01 || s.minY >= yFeet + h - 0.01) continue;
    const cx = Math.max(s.minX, Math.min(x, s.maxX));
    const cz = Math.max(s.minZ, Math.min(z, s.maxZ));
    const inside = x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ;
    const d = Math.hypot(x - cx, z - cz);
    const pen = inside ? r + Math.min(x - s.minX, s.maxX - x, z - s.minZ, s.maxZ - z) : r - d;
    if (pen > worst) worst = pen;
  }
  return worst;
}
function noPen(x, z, r, msg, yFeet, h) {
  const d = depth(x, z, r, yFeet, h);
  if (d > 1e-6) throw new Error(`${msg}：穿透 ${d.toFixed(6)} m @ (${x.toFixed(4)}, ${z.toFixed(4)})`);
}
// 连续走 frames 帧，每帧检查穿透，返回最后一帧结果
function walk(st, r, dx, dz, frames, label) {
  let res = null;
  for (let i = 0; i < frames; i++) {
    res = P.moveCircle(st.x, st.z, r, dx, dz, 0, 1.8);
    st.x = res.x; st.z = res.z;
    noPen(st.x, st.z, r, `${label} 第 ${i} 帧`);
  }
  return res;
}
// 可复现随机
const rng = BR.util.mulberry32(20260912);

const R = 0.3;

// ======================= 改前对照：1000 个随机 AABB 用例 =======================
// FE1 给 phys 加了 OBB（叉车）。硬要求：场景里没有任何 OBB 时，所有函数的结果和改前逐位一致（golden 的实体落点、
// 拾取射线、拖动都靠它）。下面用固定种子生成 4 个随机场景 × 250 次查询（moveCircle / moveBox / overlapCircle /
// overlapBox / raycast / los / removeSolids / 同 key 覆盖），把每个返回值逐位写成文本（-0、NaN、Infinity 都区分）再取 sha256。
// BASELINE_SHA 是用改前的 phys.js（props-dev 33f8544）录的：
//   PHYS_SRC=<改前的 phys.js> node tests/phys.test.js --print-baseline
// 对不上时把这次的逐条文本写到 tests/output/phys-baseline-now.txt，和改前的那份逐行 diff 就知道是哪一条变了。
const BASELINE_SHA = '22e4c58302e0c322a03ae6280aeaa25321cff0bf5af829f0c615e19cafd68b09';
const BASELINE_N = 1000;
function canonNum(v) {
  if (typeof v !== 'number') return JSON.stringify(v);
  if (Object.is(v, -0)) return '-0';
  return String(v);   // JS 的 Number→String 是能逐位还原的最短表示；NaN / Infinity 原样
}
function canon(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return canonNum(v);
  if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).map(k => k + ':' + canon(v[k])).join(',') + '}';
}
// farObbs：每个场景再登记 84 个离得极远（1e6 m 外、高 5e5 m）的 OBB——照样必须逐位一致（有 OBB 但不挨着时走原路径）
function baselineRun(farObbs) {
  const warn = console.warn;
  console.warn = () => {};   // 场景里故意放了非法 AABB，不刷屏
  try { return baselineRun0(farObbs); } finally { console.warn = warn; }
}
function baselineRun0(farObbs) {
  const g = BR.util.mulberry32(0xFE1B05E);
  const lines = [];
  const U = (a, b) => a + (b - a) * g();
  const pick = arr => arr[Math.floor(g() * arr.length)];
  const KEYS = ['0,0', '0,0#p1', '0,0#p2', '0,0#p2.1', '1,0', '1,0#f1', '0,1', '0,1#c3', 'big'];
  const IGN = [null, '0,0', '0,0#p1', 'L1@0,0#p2', ['0,0#p2', 'L1@0,0#p2.1'], ['a', 'b', '1,0', 'L3@0,1#c3'], '', [], 'zz'];
  const sb = () => {
    const t = g();
    if (t < 0.55) { const x = U(-14, 14), z = U(-14, 14), w = U(0.04, 4), d = U(0.04, 0.5); return g() < 0.5 ? box(x, z, x + w, z + d) : box(x, z, x + d, z + w); }
    if (t < 0.7) { const x = U(-14, 14), z = U(-14, 14); return box(x, z, x + U(0.2, 1.2), z + U(0.2, 1.2), 0, U(0.2, 1.1)); }   // 矮家具
    if (t < 0.8) { const x = U(-14, 14), z = U(-14, 14); return box(x, z, x + U(1, 6), z + U(0.1, 0.4), U(1.6, 2.4), U(2.5, 3.2)); }   // 横梁
    if (t < 0.88) { const x = U(-14, 14), z = U(-14, 14); return box(x, z, x + U(0.3, 2), z + U(0.3, 2), -Infinity, Infinity); }
    if (t < 0.94) { const x = U(-14, 14), z = U(-14, 14); return box(x, z, x + U(2, 8), z + U(2, 8), U(-0.4, -0.1), U(-0.05, 0.05)); }   // 地板片
    const x = U(-14, 14), z = U(-14, 14); return box(x + 0.5, z, x, z + 0.3, 3, 0);   // min/max 写反的
  };
  const farList = [];
  for (let i = 0; i < 84; i++) farList.push({ cx: 1e6 + (i % 7) * 3, cz: 1e6 + Math.floor(i / 7) * 3, hx: U(0.05, 1), hz: U(0.05, 1), rot: U(-3, 3), minY: 5e5, maxY: 5e5 + 2 });
  const sceneKeys = new Map();
  let cases = 0;
  const out = (tag, v) => { lines.push(tag + ' ' + canon(v)); cases++; };
  const rayMax = () => pick([undefined, 5, 30, 100, Infinity, -1, 0.5]);
  for (let scene = 0; scene < 4; scene++) {
    P.clear();
    sceneKeys.clear();
    if (farObbs && typeof P.addOBBs === 'function') { P.addOBBs('far', farList.slice(0, 40)); P.addOBBs('far#veh', farList.slice(40)); }
    if (scene === 2) P.setGroundFn((x, z) => (x > 6 ? 0.25 : 0) + (z < -10 ? NaN : 0));
    for (const k of KEYS) {
      const n = k === 'big' ? 2 : 6 + Math.floor(g() * 30);
      const list = [];
      for (let i = 0; i < n; i++) list.push(k === 'big' ? box(U(-200, -100), U(-200, -100), U(100, 200), U(-30, -20), U(-1, 0.5), U(0.5, 4)) : sb());
      if (scene === 3 && k === '0,1') list.push(null, box(NaN, 0, 1, 1));
      P.addSolids(k, list);
      sceneKeys.set(k, list);
    }
    const before = P.stats().slabTests;
    for (let q = 0; q < 250; q++) {
      const t = g();
      if (q === 125) {
        const k = pick(KEYS);
        out('rm', [k, P.removeSolids(k)]);
        const k2 = pick(KEYS);
        P.addSolids(k2, [sb(), sb(), sb()]);
        continue;
      }
      if (t < 0.36) {
        const r = g() < 0.6 ? 0.3 : U(0.03, 0.7);
        const a = U(0, Math.PI * 2), u = g();
        const len = u < 0.7 ? U(0, 0.35) : u < 0.9 ? U(0, 2.5) : U(0, 35);
        const yF = pick([0, 0, 0, undefined, U(0, 1.2), 0.3]);
        const h = pick([1.8, 1.8, undefined, U(0.1, 2.5)]);
        let x = U(-15, 15), z = U(-15, 15);
        const chain = g() < 0.3 ? 4 : 1;
        for (let c = 0; c < chain; c++) {
          const res = P.moveCircle(x, z, r, Math.cos(a) * len, Math.sin(a) * len, yF, h);
          out('mc', res);
          x = res.x; z = res.z;
        }
      } else if (t < 0.5) {
        const x = U(-14, 14), z = U(-14, 14), w = U(0.15, 1.6), d = U(0.15, 1.6);
        const a = U(0, Math.PI * 2), len = g() < 0.8 ? U(0, 0.4) : U(0, 20);
        const yF = pick([0, undefined, U(0, 1)]), h = pick([1, U(0.2, 2.6)]);
        const tt = g();
        const opts = tt < 0.35 ? null : tt < 0.7 ? { ignoreKey: pick(IGN) } :
          { ignoreKey: pick(IGN), circles: [[U(-14, 14), U(-14, 14), U(0.1, 0.5)], [x + U(-2, 2), z + U(-2, 2), 0.3], null, [NaN, 0, 1]] };
        out('mb', P.moveBox(x, z, x + w, z + d, yF, h, Math.cos(a) * len, Math.sin(a) * len, opts));
      } else if (t < 0.6) {
        out('oc', P.overlapCircle(U(-15, 15), U(-15, 15), pick([0.3, U(0.02, 0.8)]), pick([0, undefined, U(0, 2)]), pick([1.8, undefined, U(0.1, 2)])));
      } else if (t < 0.7) {
        const x = U(-14, 14), z = U(-14, 14);
        const o = { out: g() < 0.7 ? [] : undefined };
        if (g() < 0.5) o.ignoreKey = pick(IGN);
        if (g() < 0.3) o.tol = pick([0.001, 0.05, -1]);
        const n = P.overlapBox(x, z, x + U(0.1, 3), z + U(0.1, 3), pick([0, undefined, U(-0.2, 2)]), pick([1, U(0.02, 3)]), g() < 0.15 ? null : o);
        out('ob', [n, o.out ? o.out.map(s => [s.key, s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ]) : null]);
      } else if (t < 0.86) {
        const ox = U(-16, 16), oy = U(-0.5, 3.5), oz = U(-16, 16);
        let dx = U(-1, 1), dy = U(-0.4, 0.4), dz = U(-1, 1);
        const ax = g();
        if (ax < 0.1) { dy = 0; dz = 0; } else if (ax < 0.2) { dx = 0; dy = 0; } else if (ax < 0.27) { dx = 0; dz = 0; } else if (ax < 0.32) { dy = 0; }
        else if (ax < 0.34) { dx = dy = dz = 0; }
        const opts = g() < 0.3 ? { ignoreKey: pick(IGN) } : undefined;
        out('rc', P.raycast(ox, oy, oz, dx * U(0.2, 3), dy, dz * U(0.2, 3), rayMax(), opts));
      } else {
        const ax = U(-16, 16), ay = U(-0.2, 3), az = U(-16, 16);
        const far = g() < 0.2;
        const bx = far ? U(-60, 60) : ax + U(-8, 8), by = g() < 0.3 ? ay : U(-0.2, 3), bz = far ? U(-60, 60) : az + U(-8, 8);
        out('los', P.los(ax, ay, az, bx, by, bz));
      }
    }
    const s = P.stats();
    out('stats', [s.keys, s.solids, s.cells, s.big, s.slabTests - before]);
    P.setGroundFn(null);
  }
  P.clear();
  return { lines, cases, sha: crypto.createHash('sha256').update(lines.join('\n')).digest('hex') };
}

if (ARGS.includes('--print-baseline')) {
  const b = baselineRun(false);
  console.log(`baseline cases=${b.cases} sha=${b.sha}`);
  const dumpTo = process.env.BASELINE_DUMP;
  if (dumpTo) fs.writeFileSync(dumpTo, b.lines.join('\n') + '\n');
  process.exit(0);
}

console.log('phys 自测');

test('改前对照：没有 OBB 时 1000+ 个随机 AABB 用例逐位一致（另一遍登记 84 个远处 OBB 也一致）', () => {
  const b = baselineRun(false);
  ok(b.cases >= BASELINE_N, `用例数 ${b.cases} < ${BASELINE_N}`);
  const dump = () => {
    try { fs.mkdirSync(path.join(ROOT, 'tests/output'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'tests/output/phys-baseline-now.txt'), b.lines.join('\n') + '\n'); } catch (e) { /* 只是排查用 */ }
  };
  if (b.sha !== BASELINE_SHA) { dump(); throw new Error(`没有 OBB 时结果和改前不一致：sha ${b.sha} ≠ ${BASELINE_SHA}（逐条结果见 tests/output/phys-baseline-now.txt）`); }
  const f = baselineRun(true);
  ok(f.sha === b.sha, `登记了远处的 OBB 后 AABB 结果变了：${f.sha}`);
  console.log(`        ${b.cases} 个用例，sha ${b.sha.slice(0, 16)}…`);
});

// ======================= 直冲墙不穿透 =======================
test('直冲墙：每帧 0.1 m 冲 100 帧，停在墙前一个半径', () => {
  add('c', [box(5, -10, 5.2, 10)]);
  const st = { x: 0, z: 0 };
  const res = walk(st, R, 0.1, 0, 100, '+X');
  near(st.x, 5 - R, 1e-3, '停止位置');
  near(st.z, 0, 1e-9, 'z 不应被改动');
  ok(res.hitX && !res.hitZ && res.hit, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('直冲墙：四个方向各一次性位移 50 m', () => {
  add('c', [box(5, -10, 5.2, 10), box(-5.2, -10, -5, 10), box(-10, 5, 10, 5.2), box(-10, -5.2, 10, -5)]);
  let r = P.moveCircle(0, 0, R, 50, 0, 0, 1.8); near(r.x, 5 - R, 1e-3, '+X'); ok(r.hitX, '+X hitX');
  r = P.moveCircle(0, 0, R, -50, 0, 0, 1.8); near(r.x, -5 + R, 1e-3, '-X'); ok(r.hitX, '-X hitX');
  r = P.moveCircle(0, 0, R, 0, 50, 0, 1.8); near(r.z, 5 - R, 1e-3, '+Z'); ok(r.hitZ && !r.hitX, '+Z hitZ');
  r = P.moveCircle(0, 0, R, 0, -50, 0, 1.8); near(r.z, -5 + R, 1e-3, '-Z'); ok(r.hitZ, '-Z hitZ');
});

test('无障碍时原样位移，不报撞', () => {
  add('c', [box(50, 50, 51, 51)]);
  const r = P.moveCircle(1, 2, R, 0.7, -0.4, 0, 1.8);
  near(r.x, 1.7, 1e-12, 'x'); near(r.z, 1.6, 1e-12, 'z');
  ok(!r.hitX && !r.hitZ && !r.hit, '不该撞');
});

// ======================= 贴墙滑动 =======================
test('贴墙滑动：斜推沿 X 的墙，X 走满、Z 被夹住', () => {
  add('c', [box(-50, 0.5, 50, 0.7)]);
  const st = { x: 0, z: 0 };
  const res = walk(st, R, 0.1, 0.1, 100, '斜推');
  near(st.x, 10, 1e-6, 'X 应走满 10 m');
  near(st.z, 0.5 - R, 1e-3, 'Z 贴墙');
  ok(res.hitZ && !res.hitX, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('贴墙滑动：墙由 40 段 AABB 拼成，接缝处不卡', () => {
  const segs = [];
  for (let i = 0; i < 40; i++) segs.push(box(-2 + i * 1.3, 0.5, -2 + (i + 1) * 1.3, 0.62));
  add('c', segs);
  const st = { x: 0, z: 0 };
  walk(st, R, 0.12, 0.05, 400, '接缝');
  near(st.x, 48, 1e-6, 'X 应走满 48 m（被接缝卡住会不足）');
  near(st.z, 0.5 - R, 1e-3, 'Z 贴墙');
});

test('贴墙滑动：沿 -X、-Z 方向推另一侧的墙', () => {
  add('c', [box(-0.7, -50, -0.5, 50)]);
  const st = { x: 0, z: 0 };
  const res = walk(st, R, -0.08, -0.1, 80, '反向');
  near(st.z, -8, 1e-6, 'Z 应走满');
  near(st.x, -0.5 + R, 1e-3, 'X 贴墙');
  ok(res.hitX && !res.hitZ, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('紧贴墙面平行行走不报撞', () => {
  add('c', [box(-50, 0.5, 50, 0.7)]);
  const st = { x: 0, z: 0 };
  walk(st, R, 0, 0.2, 10, '贴上');
  const res = P.moveCircle(st.x, st.z, R, 0.15, 0, 0, 1.8);
  ok(!res.hit, '平行走不该报撞');
  near(res.x, st.x + 0.15, 1e-12, '平行走位移');
});

// ======================= 墙角 =======================
test('凹墙角：斜冲进 L 形角落，两轴都停在一个半径外', () => {
  add('c', [box(1, -5, 1.2, 5), box(-5, 1, 5, 1.2)]);
  const st = { x: 0, z: 0 };
  const res = walk(st, R, 0.1, 0.1, 60, '凹角');
  near(st.x, 1 - R, 1e-3, 'x'); near(st.z, 1 - R, 1e-3, 'z');
  ok(res.hitX && res.hitZ, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('凹墙角：两墙由分离的 AABB 在角上重叠拼成，一次性冲 20 m', () => {
  add('c', [box(1, -5, 1.2, 1.2), box(-5, 1, 1.2, 1.2)]);
  const r = P.moveCircle(0, 0, R, 14, 14, 0, 1.8);
  noPen(r.x, r.z, R, '一次冲角');
  near(r.x, 1 - R, 1e-3, 'x'); near(r.z, 1 - R, 1e-3, 'z');
});

test('凸墙角：擦着柱子角走，被圆角推开并绕过去', () => {
  add('c', [box(2, 0, 3, 1)]);
  const st = { x: 0, z: -0.25 };   // 圆心离柱子 Z 面只有 0.25 < r，会蹭到角
  walk(st, R, 0.1, 0, 60, '凸角');
  ok(st.x > 3 + R, `应绕过柱子，实际 x=${st.x}`);
  ok(st.z <= -R + 1e-3, `应被推到 z ≤ -r，实际 z=${st.z}`);
});

test('凸墙角：正对柱子面中心直冲，停住不乱滑', () => {
  add('c', [box(2, -0.5, 3, 0.5)]);
  const st = { x: 0, z: 0 };
  walk(st, R, 0.1, 0, 60, '正撞');
  near(st.x, 2 - R, 1e-3, 'x'); near(st.z, 0, 1e-9, 'z 不该偏');
});

test('门洞：宽 2r+0.1 偏心 8 cm 能进；宽 2r-0.05 进不去', () => {
  const W = 2 * R + 0.1;
  add('a', [box(-5, 3, -W / 2, 3.2), box(W / 2, 3, 5, 3.2)]);
  const st = { x: 0.08, z: 0 };
  walk(st, R, 0, 0.1, 80, '门洞');
  ok(st.z > 3.2 + R, `应穿过门洞，实际 z=${st.z}`);

  P.clear(); all = [];
  const W2 = 2 * R - 0.05;
  add('b', [box(-5, 3, -W2 / 2, 3.2), box(W2 / 2, 3, 5, 3.2)]);
  const s2 = { x: 0.02, z: 0 };
  walk(s2, R, 0, 0.1, 80, '窄门');
  ok(s2.z < 3, `不应穿过窄门，实际 z=${s2.z}`);
});

// ======================= 视线 =======================
test('视线：中间有墙被挡，绕开墙的线通畅', () => {
  add('c', [box(4, -1, 4.2, 1)]);
  ok(!P.los(0, 1.6, 0, 8, 1.6, 0), '穿墙应被挡');
  ok(P.los(0, 1.6, 2, 8, 1.6, 2), '墙外侧应通畅');
  ok(!P.los(8, 1.6, 0.5, 0, 1.6, -0.5), '反向斜穿应被挡');
  ok(P.los(0, 1.6, 0, 3.9, 1.6, 0), '没到墙应通畅');
});

test('视线：矮墙挡不住高处，挡得住低处；头顶横梁不挡平视', () => {
  add('c', [box(4, -5, 4.2, 5, 0, 1), box(-5, 6, 5, 6.3, 2.2, 2.6)]);
  ok(P.los(0, 1.6, 0, 8, 1.6, 0), '眼高 1.6 越过 1 m 矮墙');
  ok(!P.los(0, 0.5, 0, 8, 0.5, 0), '眼高 0.5 被矮墙挡');
  ok(P.los(0, 1.6, 4, 0, 1.6, 10), '横梁在 2.2 m 以上，不挡平视');
  ok(!P.los(0, 1.6, 4, 0, 3.0, 8), '斜向上看被横梁挡');
});

test('视线：端点贴在表面上不算挡（物品放在地板顶面）', () => {
  add('c', [box(-10, -10, 10, 10, -0.2, 0)]);
  ok(P.los(0, 1.6, 0, 3, 0, 2), '看地板上的物品');
  ok(!P.los(0, 1.6, 0, 3, -0.1, 2), '目标点埋进地板里应被挡');
});

test('视线：跨 50 个格子的长线段（DDA）', () => {
  add('c', [box(197, -1, 198, 1)]);
  ok(!P.los(0, 1, 0, 199, 1, 0), '远端墙应挡住');
  ok(P.los(0, 1, 3, 199, 1, 3), '偏开的线通畅');
  ok(!P.los(199, 1, 0.3, -1, 1, -0.3), '反向长线也挡');
  ok(!P.los(97.5, 1, -100, 297.5, 1, 100), '斜向长线（z=0 处 x=197.5）穿墙应挡');
  ok(P.los(97.5, 1, -90, 297.5, 1, 110), '同斜率平移 10 m 绕开墙应通畅');
});

test('raycast：最近命中距离、坐标、法线；反向/超距返回 null', () => {
  add('c', [box(5, -1, 6, 1), box(9, -1, 10, 1)]);
  const h = P.raycast(0, 1, 0, 2, 0, 0, 100);   // 方向不归一化也行
  ok(h, '应命中');
  near(h.dist, 5, 1e-9, 'dist'); near(h.x, 5, 1e-9, 'x'); near(h.y, 1, 1e-9, 'y'); near(h.z, 0, 1e-9, 'z');
  ok(h.nx === -1 && h.ny === 0 && h.nz === 0, `法线应为 -X，实际 ${h.nx},${h.ny},${h.nz}`);
  ok(P.raycast(0, 1, 0, -1, 0, 0, 100) === null, '反方向应 null');
  ok(P.raycast(0, 1, 0, 1, 0, 0, 4.9) === null, 'max 不够应 null');
  const d = P.raycast(7.5, 1, 0, 1, 0, 0);
  near(d.dist, 1.5, 1e-9, '缺省 max 也能打到下一堵墙');
  const down = P.raycast(5.5, 5, 0, 0, -1, 0, 10);
  near(down.dist, 2, 1e-9, '向下打墙顶'); ok(down.ny === 1, '顶面法线 +Y');
});

test('raycast：跨格子的盒子只测一次，且远处格子先登记的盒子不影响最近命中', () => {
  add('c', [box(30, -1, 31, 1), box(12.5, -30, 13, 30)]);   // 第二块跨很多格
  const before = P.stats().slabTests;
  const h = P.raycast(0, 1, 0.1, 1, 0, 0, 100);
  near(h.dist, 12.5, 1e-9, '应先打到跨格长墙');
  ok(P.stats().slabTests - before <= 2, `slab 测试次数 ${P.stats().slabTests - before} 过多`);
});

test('removeSolids / 同 key 覆盖 / clear', () => {
  P.addSolids('k1', [box(4, -1, 4.2, 1)]);
  ok(!P.los(0, 1, 0, 8, 1, 0), '添加后应被挡');
  P.addSolids('k1', [box(4, -1, 4.2, 1)]);
  ok(P.stats().solids === 1, `同 key 重复添加应覆盖，solids=${P.stats().solids}`);
  P.removeSolids('k1');
  ok(P.los(0, 1, 0, 8, 1, 0), '移除后应通畅');
  ok(P.stats().cells === 0 && P.stats().solids === 0, '空格子应被回收');
  P.addSolids('a', [box(4, -1, 4.2, 1)]);
  P.addSolids('b', [box(-4.2, -1, -4, 1)]);
  P.removeSolids('a');
  ok(P.los(0, 1, 0, 8, 1, 0) && !P.los(0, 1, 0, -8, 1, 0), '只移除对应 key');
  P.clear();
  ok(P.los(0, 1, 0, -8, 1, 0) && P.stats().keys === 0, 'clear 后全空');
  const r = P.moveCircle(0, 0, R, -8, 0, 0, 1.8);
  near(r.x, -8, 1e-12, 'clear 后移动无阻挡');
});

// ======================= 高速小步长 =======================
test('高速：5 cm 薄墙，一帧 100 m 不穿透', () => {
  add('c', [box(10, -5, 10.05, 5)]);
  const r = P.moveCircle(0, 0, R, 100, 0, 0, 1.8);
  noPen(r.x, r.z, R, '高速');
  near(r.x, 10 - R, 1e-3, '停在薄墙前');
  const back = P.moveCircle(20, 0.1, R, -100, 0, 0, 1.8);
  near(back.x, 10.05 + R, 1e-3, '反向也停住');
});

test('高速：小半径 r=0.05 撞 2 cm 薄墙，一帧 30 m', () => {
  add('c', [box(5, -5, 5.02, 5)]);
  const r = P.moveCircle(0, 0, 0.05, 30, 0.3, 0, 1.8);
  noPen(r.x, r.z, 0.05, '小半径');
  ok(r.x < 5, `不应穿过，x=${r.x}`);
});

test('高速：斜向冲过柱阵，每帧 3 m，全程无穿透', () => {
  const pillars = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    pillars.push(box(i * 2 + 1, j * 2 + 1, i * 2 + 1.5, j * 2 + 1.5));
  }
  add('c', pillars);
  const st = { x: 0, z: 0.2 };
  walk(st, R, 2.4, 1.8, 40, '柱阵');
});

test('小步长：每帧 0.5 mm 挤墙 2000 帧，始终在墙外并贴住', () => {
  add('c', [box(1, -5, 1.2, 5)]);
  const st = { x: 0, z: 0 };
  walk(st, R, 0.0005, 0.0001, 2000, '慢挤');
  near(st.x, 1 - R, 1e-3, '贴墙');
});

// ======================= 其他 =======================
test('Y 过滤：头顶横梁、脚下地板不挡；及腰矮墙挡', () => {
  add('c', [
    box(2, -5, 2.5, 5, 1.8, 3),        // 横梁底恰好 = 头顶 1.8，刚好碰到不算挡
    box(-50, -50, 50, 50, -0.3, 0),    // 地板顶面恰好 = 脚底
    box(6, -5, 6.5, 5, 0, 0.3),        // 30 cm 台阶
  ]);
  const r = P.moveCircle(0, 0, R, 10, 0, 0, 1.8);
  near(r.x, 6 - R, 1e-3, '只被台阶挡');
  // 站到 30 cm 高处（身高 1.5，头顶仍恰好 1.8）：台阶顶面 = 脚底，也不挡
  const up = P.moveCircle(0, 0, R, 10, 0, 0.3, 1.5);
  near(up.x, 10, 1e-9, '脚底抬高后台阶不挡');
  const tall = P.moveCircle(0, 0, R, 10, 0, 0.3, 1.8);  // 头顶 2.1 撞横梁
  near(tall.x, 2 - R, 1e-3, '抬高后个子高的会撞横梁');
  ok(P.stats().big === 1, '100×100 m 地板应进巨型表');
});

test('巨型 AABB（不进网格）也参与碰撞和视线', () => {
  add('c', [box(20, -200, 100, 200)]);
  ok(P.stats().big === 1 && P.stats().cells === 0, '应走巨型表');
  const r = P.moveCircle(0, 0, R, 50, 0, 0, 1.8);
  near(r.x, 20 - R, 1e-3, '被巨型墙挡');
  ok(!P.los(0, 1, 0, 30, 1, 0), '视线被挡');
  near(P.raycast(0, 1, 0, 1, 0, 0, 50).dist, 20, 1e-9, 'raycast');
});

test('出发点卡在墙里：先被挤出再移动', () => {
  add('c', [box(0, -5, 2, 5)]);
  let r = P.moveCircle(-0.1, 0, R, 0, 0.1, 0, 1.8);   // 圆心在墙外但离墙 0.1 < r
  noPen(r.x, r.z, R, '贴墙出生');
  near(r.x, -R, 1e-3, '沿法线挤出');
  r = P.moveCircle(0.4, 1, R, 0, 0, 0, 1.8);           // 圆心在墙里，最近面是 minX
  noPen(r.x, r.z, R, '墙内出生');
  near(r.x, -R, 1e-3, '推向最近面');
  ok(P.overlapCircle(0.4, 1, R, 0, 1.8) && !P.overlapCircle(-1, 0, R, 0, 1.8), 'overlapCircle');
});

test('groundY：默认 0，setGroundFn 覆盖，非数返回 0，clear 复位', () => {
  ok(P.groundY(3, 4) === 0, '默认 0');
  P.setGroundFn((x, z) => x * 0.5 + (z > 100 ? NaN : 0));
  ok(P.groundY(4, 0) === 2, '自定义地面');
  ok(P.groundY(4, 200) === 0, 'NaN 退回 0');
  P.clear();
  ok(P.groundY(4, 0) === 0, 'clear 后复位');
  P.setGroundFn(() => 1);
  P.setGroundFn(null);
  ok(P.groundY(0, 0) === 0, 'setGroundFn(null) 复位');
});

test('随机模糊：随机墙体 + 3000 次随机移动，始终无穿透', () => {
  const solids = [];
  for (let i = 0; i < 150; i++) {
    const x = rng() * 60 - 30, z = rng() * 60 - 30;
    const w = 0.05 + rng() * 4, d = 0.05 + rng() * 4;
    solids.push(rng() < 0.5 ? box(x, z, x + w, z + 0.1 + rng() * 0.3) : box(x, z, x + 0.1 + rng() * 0.3, z + d));
    if (rng() < 0.2) solids.push(box(x, z, x + w, z + d));
  }
  // 分成几个 key，顺便测多区块共存
  for (let k = 0; k < 4; k++) add('fuzz' + k, solids.filter((_, i) => i % 4 === k));
  let checked = 0;
  for (let agent = 0; agent < 30; agent++) {
    const r = 0.15 + rng() * 0.35;
    let x, z, tries = 0;
    do { x = rng() * 60 - 30; z = rng() * 60 - 30; } while (depth(x, z, r) > 0 && ++tries < 500);
    if (depth(x, z, r) > 0) continue;
    for (let step = 0; step < 100; step++) {
      const a = rng() * Math.PI * 2, len = rng() < 0.1 ? rng() * 20 : rng() * 0.6;
      const res = P.moveCircle(x, z, r, Math.cos(a) * len, Math.sin(a) * len, 0, 1.8);
      x = res.x; z = res.z;
      noPen(x, z, r, `agent ${agent} step ${step}`);
      checked++;
    }
  }
  ok(checked >= 2000, `有效样本太少：${checked}`);
});

test('性能：5000 块墙上 20000 次视线，候选收集不是全量遍历', () => {
  const solids = [];
  for (let i = 0; i < 5000; i++) {
    const x = rng() * 400 - 200, z = rng() * 400 - 200;
    solids.push(rng() < 0.5 ? box(x, z, x + 1 + rng() * 4, z + 0.2) : box(x, z, x + 0.2, z + 1 + rng() * 4));
  }
  add('perf', solids);
  const before = P.stats().slabTests;
  const t0 = process.hrtime.bigint();
  let blockedCount = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const ax = rng() * 360 - 180, az = rng() * 360 - 180;
    const a = rng() * Math.PI * 2, L = rng() * 30;
    if (!P.los(ax, 1.6, az, ax + Math.cos(a) * L, 1.6, az + Math.sin(a) * L)) blockedCount++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const avg = (P.stats().slabTests - before) / N;
  // 结果顺便核对一次暴力法，确认 DDA 没漏
  let mismatch = 0;
  for (let i = 0; i < 300; i++) {
    const ax = rng() * 360 - 180, az = rng() * 360 - 180, a = rng() * Math.PI * 2, L = rng() * 30;
    const bx = ax + Math.cos(a) * L, bz = az + Math.sin(a) * L;
    let brute = true;
    for (const s of solids) {
      // 2D 线段 vs 矩形（y=1.6 在墙高内）
      let t0b = 0, t1b = 1;
      const dx = bx - ax, dz = bz - az;
      const axes = [[ax, dx, s.minX, s.maxX], [az, dz, s.minZ, s.maxZ]];
      let hit = true;
      for (const [o, d, mn, mx] of axes) {
        if (Math.abs(d) < 1e-12) { if (o < mn || o > mx) { hit = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0b = Math.max(t0b, ta); t1b = Math.min(t1b, tb);
        if (t0b > t1b) { hit = false; break; }
      }
      if (hit) { brute = false; break; }
    }
    if (brute !== P.los(ax, 1.6, az, bx, 1.6, bz)) mismatch++;
  }
  console.log(`        ${N} 次 los 用时 ${ms.toFixed(1)} ms，平均每次 slab 测试 ${avg.toFixed(2)} 块（总 ${solids.length} 块），被挡 ${blockedCount}，暴力核对不一致 ${mismatch}/300`);
  ok(avg < solids.length * 0.01, `平均候选 ${avg} 过多，疑似全量遍历`);
  ok(mismatch === 0, `DDA 与暴力结果不一致 ${mismatch} 次`);
  ok(ms < 3000, `太慢：${ms} ms`);
});

// ======================= raycast 返回 key / ignoreKey =======================
test('raycast：返回命中盒子的登记 key；ignoreKey 跳过（字符串、数组、道具 key 去掉层级前缀）', () => {
  add('0,0', [box(5, -1, 6, 1)]);                 // 区块静态碰撞体
  add('0,0#p2', [box(3, -1, 3.5, 1, 0, 1.2)]);     // 可拖道具（矮）
  add('0,0#p2.1', [box(2, -0.2, 2.3, 0.2, 1.2, 1.5)]);   // 道具上摞的子道具
  let h = P.raycast(0, 1, 0, 1, 0, 0, 20);
  ok(h && h.key === '0,0#p2', `应先打到道具，实际 ${h && h.key}`); near(h.dist, 3, 1e-9, 'dist');
  h = P.raycast(0, 1.3, 0, 1, 0, 0, 20);
  ok(h && h.key === '0,0#p2.1', `高处先打到子道具，实际 ${h && h.key}`);
  h = P.raycast(0, 1, 0, 1, 0, 0, 20, { ignoreKey: '0,0#p2' });
  ok(h && h.key === '0,0' && Math.abs(h.dist - 5) < 1e-9, `ignoreKey 字符串：应打到墙，实际 ${JSON.stringify(h)}`);
  h = P.raycast(0, 1.3, 0, 1, 0, 0, 20, { ignoreKey: ['L1@0,0#p2.1', 'L1@0,0#p2'] });
  ok(h && h.key === '0,0', `ignoreKey 数组 + 道具 key：应打到墙，实际 ${JSON.stringify(h)}`);
  h = P.raycast(0, 1.3, 0, 1, 0, 0, 20, { ignoreKey: ['a', 'b', 'c', 'L1@0,0#p2.1'] });
  ok(h && h.key === '0,0', `ignoreKey 长数组：应打到墙，实际 ${JSON.stringify(h)}`);
  ok(P.raycast(0, 1, 0, 1, 0, 0, 20, { ignoreKey: ['0,0', '0,0#p2'] }) === null, '全部忽略 → null');
  // 不带 ignoreKey 的调用不受前一次影响（模块级状态复位）
  h = P.raycast(0, 1, 0, 1, 0, 0, 20);
  ok(h && h.key === '0,0#p2', '下一次不带 ignoreKey 恢复正常');
  ok(!P.los(0, 1, 0, 8, 1, 0), 'los 不受 ignoreKey 影响');
});

test('raycast：巨型盒子也返回 key、也能被忽略', () => {
  add('big', [box(20, -200, 100, 200)]);
  add('wall', [box(30, -1, 31, 1)]);
  let h = P.raycast(0, 1, 0, 1, 0, 0, 200);
  ok(h && h.key === 'big', `应命中巨型盒子，实际 ${h && h.key}`);
  h = P.raycast(0, 1, 0, 1, 0, 0, 200, { ignoreKey: 'big' });
  ok(h && h.key === 'wall' && Math.abs(h.dist - 30) < 1e-9, `忽略巨型盒子后打到墙，实际 ${JSON.stringify(h)}`);
});

// ======================= moveBox（拖动道具） =======================
// 暴力核对：盒子与任何（非忽略、Y 重叠的）盒子是否有正面积重叠
function boxPen(x0, z0, x1, z1, skip, yFeet = 0, h = 1) {
  let worst = 0;
  for (const s of all) {
    if (skip && skip.includes(s)) continue;
    if (s.maxY <= yFeet + 0.01 || s.minY >= yFeet + h - 0.01) continue;
    const ox = Math.min(x1, s.maxX) - Math.max(x0, s.minX), oz = Math.min(z1, s.maxZ) - Math.max(z0, s.minZ);
    if (ox > 0 && oz > 0) worst = Math.max(worst, Math.min(ox, oz));
  }
  return worst;
}
function drag(st, w, d, dx, dz, frames, opts, label, skip) {
  let res = null;
  for (let i = 0; i < frames; i++) {
    res = P.moveBox(st.x - w / 2, st.z - d / 2, st.x + w / 2, st.z + d / 2, 0, 1, dx, dz, opts);
    st.x += res.dx; st.z += res.dz;
    const p = boxPen(st.x - w / 2, st.z - d / 2, st.x + w / 2, st.z + d / 2, skip);
    if (p > 1e-6) throw new Error(`${label} 第 ${i} 帧穿透 ${p.toFixed(6)} m @ (${st.x.toFixed(4)}, ${st.z.toFixed(4)})`);
  }
  return res;
}

test('moveBox：直推撞墙停在墙前；无障碍原样位移', () => {
  add('c', [box(5, -10, 5.2, 10)]);
  const st = { x: 0, z: 0 };
  const res = drag(st, 0.8, 0.6, 0.1, 0, 80, null, '+X');
  near(st.x + 0.4, 5, 1e-3, '箱子右沿贴墙');
  ok(res.hitX && !res.hitZ && res.hit, `hitX=${res.hitX} hitZ=${res.hitZ}`);
  const free = P.moveBox(-1, -1, 0, 0, 0, 1, -0.3, 0.2);
  near(free.dx, -0.3, 1e-12, 'dx'); near(free.dz, 0.2, 1e-12, 'dz'); ok(!free.hit, '不该撞');
  const big = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 50, 0);
  near(big.dx, 5 - 0.4, 1e-3, '一次推 50 m 也停在墙前');
});

test('moveBox：贴墙滑动（斜推沿 X 的墙，X 走满、Z 被夹住；墙由多段拼成不卡接缝）', () => {
  const segs = [];
  for (let i = 0; i < 30; i++) segs.push(box(-2 + i * 1.1, 1, -2 + (i + 1) * 1.1, 1.2));
  add('c', segs);
  const st = { x: 0, z: 0 };
  const res = drag(st, 0.6, 0.6, 0.1, 0.1, 100, null, '斜推');
  near(st.x, 10, 1e-6, 'X 应走满 10 m');
  near(st.z + 0.3, 1, 1e-3, 'Z 贴墙');
  ok(res.hitZ && !res.hitX, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('moveBox：角落停住（L 形墙角，斜推两轴都贴住）', () => {
  add('c', [box(1, -5, 1.2, 5), box(-5, 1, 5, 1.2)]);
  const st = { x: 0, z: 0 };
  const res = drag(st, 0.5, 0.5, 0.07, 0.05, 80, null, '凹角');
  near(st.x + 0.25, 1, 1e-3, 'x'); near(st.z + 0.25, 1, 1e-3, 'z');
  ok(res.hitX && res.hitZ, `hitX=${res.hitX} hitZ=${res.hitZ}`);
});

test('moveBox：ignoreKey 跳过自己的碰撞体（字符串/数组/道具 key）', () => {
  const self = box(-0.4, -0.3, 0.4, 0.3, 0, 0.8);
  add('0,0#p1', [self]);
  add('0,0', [box(3, -5, 3.2, 5)]);
  // 不忽略：出发就和自己重叠 → 自己不挡（重叠的不挡），照样能推，墙挡住
  let st = { x: 0, z: 0 };
  drag(st, 0.8, 0.6, 0.2, 0, 30, null, '不忽略', [self]);
  near(st.x + 0.4, 3, 1e-3, '停在墙前');
  // 回到原处、反向推：没忽略时，自己原来的碰撞体挡在路上（已经离开它了）
  const back = P.moveBox(st.x - 0.4, -0.3, st.x + 0.4, 0.3, 0, 1, -5, 0);
  near(st.x + back.dx - 0.4, 0.4, 1e-3, '没忽略时被自己留在原处的碰撞体挡住');
  const back2 = P.moveBox(st.x - 0.4, -0.3, st.x + 0.4, 0.3, 0, 1, -5, 0, { ignoreKey: '0,0#p1' });
  near(back2.dx, -5, 1e-12, '忽略字符串 key 后畅通');
  const back3 = P.moveBox(st.x - 0.4, -0.3, st.x + 0.4, 0.3, 0, 1, -5, 0, { ignoreKey: ['x', 'L9@0,0#p1'] });
  near(back3.dx, -5, 1e-12, '忽略道具 key（带层级前缀）后畅通');
});

test('moveBox：circles（玩家）挡路，侧面擦过不挡', () => {
  add('c', [box(50, 50, 51, 51)]);
  const r = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 3, 0, { circles: [[2, 0, 0.3]] });
  near(0.4 + r.dx, 2 - 0.3, 1e-3, '正前方的人：停在圆前');
  ok(r.hitX, 'hitX');
  const r2 = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 3, 0, { circles: [[2, 0.65, 0.3]] });
  near(r2.dx, 3, 1e-12, '人站在侧面 0.35 m 外：擦过不挡');
  // 圆角：圆心在盒子 Z 范围外 0.2 m（< r），只挡住 sqrt(r²-0.2²) 的宽度
  const r3 = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 3, 0, { circles: [[2, 0.5, 0.3]] });
  near(0.4 + r3.dx, 2 - Math.sqrt(0.09 - 0.04), 1e-3, '圆角接触');
  const r4 = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 0, 3, { circles: [[0, 2, 0.3]] });
  near(0.3 + r4.dz, 2 - 0.3, 1e-3, '+Z 方向同样被挡');
});

test('moveBox：Y 过滤（头顶横梁、脚下地板不挡，及腰台面挡）', () => {
  add('c', [
    box(-50, -50, 50, 50, -0.3, 0),   // 地板
    box(2, -5, 2.5, 5, 1.0, 2.5),     // 横梁底 1.0 = 箱顶（高 1）
    box(6, -5, 6.5, 5, 0, 0.75),      // 桌面高的台子
  ]);
  const r = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 10, 0);
  near(0.4 + r.dx, 6, 1e-3, '只被台子挡');
  const tall = P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1.5, 10, 0);
  near(0.4 + tall.dx, 2, 1e-3, '高 1.5 的柜子撞横梁');
});

test('moveBox：随机模糊——随机墙体里拖 1500 步无穿透', () => {
  const solids = [];
  for (let i = 0; i < 120; i++) {
    const x = rng() * 40 - 20, z = rng() * 40 - 20;
    const w = 0.05 + rng() * 3, d = 0.05 + rng() * 3;
    solids.push(rng() < 0.5 ? box(x, z, x + w, z + 0.1 + rng() * 0.3) : box(x, z, x + 0.1 + rng() * 0.3, z + d));
  }
  add('fz', solids);
  let checked = 0;
  for (let agent = 0; agent < 20; agent++) {
    const w = 0.3 + rng() * 1.2, d = 0.3 + rng() * 1.2;
    let x, z, tries = 0;
    do { x = rng() * 40 - 20; z = rng() * 40 - 20; } while (boxPen(x - w / 2, z - d / 2, x + w / 2, z + d / 2) > 0 && ++tries < 500);
    if (boxPen(x - w / 2, z - d / 2, x + w / 2, z + d / 2) > 0) continue;
    const st = { x, z };
    for (let step = 0; step < 75; step++) {
      const a = rng() * Math.PI * 2, len = rng() < 0.1 ? rng() * 10 : rng() * 0.2;
      drag(st, w, d, Math.cos(a) * len, Math.sin(a) * len, 1, null, `agent ${agent} step ${step}`);
      checked++;
    }
  }
  ok(checked >= 1000, `有效样本太少：${checked}`);
});

test('moveBox：非法输入不抛异常、不动', () => {
  add('c', [box(5, -1, 6, 1)]);
  const r = P.moveBox(NaN, 0, 1, 1, 0, 1, 1, 1);
  ok(r.dx === 0 && r.dz === 0 && !r.hit, '非法盒子不动');
  const r2 = P.moveBox(0, 0, 1, 1, 0, 1, Infinity, 0);
  ok(r2.dx === 0 && r2.dz === 0, '非法位移不动');
});

test('removeSolids(区块 key) 连同道具子 key（"<key>#p1"）一起摘；同 key 覆盖不碰子 key；相近前缀不误伤', () => {
  P.clear();
  P.addSolids('3,4', [box(4, -1, 4.2, 1)]);
  P.addSolids('3,4#p1', [box(-4.2, -1, -4, 1)]);
  P.addSolids('3,4#f2', [box(-1, 4, 1, 4.2)]);
  P.addSolids('3,40', [box(-1, -4.2, 1, -4)]);
  P.addSolids('3,4', [box(4, -1, 4.2, 1)]);                    // 同 key 覆盖：子 key 留着
  ok(!P.los(0, 1, 0, -8, 1, 0), '覆盖区块 key 后道具碰撞体还在');
  const n = P.removeSolids('3,4');
  ok(n === 3, `应摘掉区块和两个子 key 共 3 块，实际 ${n}`);
  ok(P.los(0, 1, 0, 8, 1, 0) && P.los(0, 1, 0, -8, 1, 0) && P.los(0, 1, 0, 0, 1, 8), '区块和子 key 的都摘掉了');
  ok(!P.los(0, 1, 0, 0, 1, -8), '"3,40" 不是 "3,4" 的子 key，不该被摘');
  ok(P.removeSolids('3,4#p1') === 0, '已摘过的再摘返回 0');
  P.clear();
});

test('overlapBox：压进去才算重叠（贴着不算），ignoreKey 跳过自己，out 拿到重叠的碰撞体，Y 不重叠不算', () => {
  P.addSolids('w', [box(2, -1, 2.2, 1)]);
  P.addSolids('3,4#p1', [box(-0.4, -0.3, 0.4, 0.3, 0, 0.8)]);
  P.addSolids('beam', [box(-5, 5, 5, 5.2, 2.0, 2.5)]);
  ok(P.overlapBox(1.0, -0.5, 2.0, 0.5, 0, 1) === 0, '右边正好贴着墙面：不算重叠');
  ok(P.overlapBox(1.0, -0.5, 2.05, 0.5, 0, 1) === 1, '压进墙 5 cm：重叠');
  ok(P.overlapBox(-0.4, -0.3, 0.4, 0.3, 0, 1) === 1, '和自己的碰撞体重叠');
  ok(P.overlapBox(-0.4, -0.3, 0.4, 0.3, 0, 1, { ignoreKey: 'L1@3,4#p1' }) === 0, 'ignoreKey 用道具 key 也能跳过自己');
  const out = [];
  const n = P.overlapBox(-0.4, -0.3, 2.1, 0.3, 0, 1, { ignoreKey: ['3,4#p1'], out });
  ok(n === 1 && out.length === 1 && out[0].key === 'w', `out 里应只有那面墙，实际 ${n} / ${out.map(s => s.key)}`);
  ok(P.overlapBox(-1, 4.9, 1, 5.3, 0, 1) === 0, '横梁在头顶上（Y 不重叠）不算');
  ok(P.overlapBox(-1, 4.9, 1, 5.3, 0, 2.2) === 1, '高 2.2 的柜子顶到横梁');
  ok(P.overlapBox(NaN, 0, 1, 1, 0, 1) === 0, '非法输入返回 0');
  ok(P.overlapBox(-0.4, -0.3, 0.4, 0.3, 0, 1, { ignoreKey: '3,4#p1' }) === 0 && P.moveBox(-0.4, -0.3, 0.4, 0.3, 0, 1, 1, 0).dx > 0, 'ignore 状态不残留到下一次查询');
});

// ======================= OBB（FE1 叉车） =======================
// 约定（和 kit 道具 / interact hit.obb 一样）：世界 → 局部 lx = c·dx − s·dz，lz = s·dx + c·dz；局部 x 轴在世界里 = (c, −s)，z 轴 = (s, c)
function obb(cx, cz, hx, hz, rot, minY = 0, maxY = 3, name) { return { cx, cz, hx, hz, rot, minY, maxY, name }; }
function addO(key, list) { P.addOBBs(key, list); allObb.push(...list); }
function toLocal(o, x, z) { const c = Math.cos(o.rot), s = Math.sin(o.rot), dx = x - o.cx, dz = z - o.cz; return [c * dx - s * dz, s * dx + c * dz]; }
function toWorld(o, lx, lz) { const c = Math.cos(o.rot), s = Math.sin(o.rot); return [o.cx + c * lx + s * lz, o.cz - s * lx + c * lz]; }
function axU(o) { return [Math.cos(o.rot), -Math.sin(o.rot)]; }   // 局部 +x 在世界里的方向
function axV(o) { return [Math.sin(o.rot), Math.cos(o.rot)]; }    // 局部 +z
// 暴力：圆柱压进测试侧登记的所有 OBB 的最大深度
function obbPen(x, z, r, yFeet = 0, h = 1.8) {
  let worst = 0;
  for (const o of allObb) { const c = P.circleVsObb(x, z, r, o, yFeet, h); if (c && c.depth > worst) worst = c.depth; }
  return worst;
}
function noPenAll(x, z, r, msg, yFeet = 0, h = 1.8) {
  noPen(x, z, r, msg, yFeet, h);
  const d = obbPen(x, z, r, yFeet, h);
  if (d > 2e-5) throw new Error(`${msg}：压进 OBB ${d.toFixed(6)} m @ (${x.toFixed(4)}, ${z.toFixed(4)})`);
}
function walkO(st, r, dx, dz, frames, label, yFeet = 0, h = 1.8) {
  let res = null;
  for (let i = 0; i < frames; i++) {
    res = P.moveCircle(st.x, st.z, r, dx, dz, yFeet, h);
    st.x = res.x; st.z = res.z;
    noPenAll(st.x, st.z, r, `${label} 第 ${i} 帧`, yFeet, h);
  }
  return res;
}

// 叉车的 14 个部件盒子（本地坐标，lift = 0）。FORKLIFT_GEO：原点 = 车底投影中心的地面，−z = 车头（门架、货叉），+x = 司机右手。
// 尺寸按接口里的常数摆：驾驶舱留空 |x| ≤ 0.4、z −0.5…0.55，地台 0.62 以上、座椅 1.16 以上到 2.05；货叉 x ±0.28、宽 0.1、厚 0.04、
// z −2.1…−1.16；司机眼点 (0, 1.8, 0.16)，座椅胸口点 (0, 1.66, 0.24)。真正的常数由 L1（BR.L1forklift.geo.obbs）给，能载入时下面另跑一遍
const FK_CAB = { x: 0.4, z0: -0.5, z1: 0.55, yFloor: 0.62, ySeat: 1.16, yTop: 2.05 };
const FK_EYE = [0, 1.8, 0.16], FK_CHEST = [0, 1.66, 0.24];
const FK_OBBS = [
  { name: 'chassis', cx: 0, cy: 0.335, cz: 0.1, hx: 0.6, hy: 0.285, hz: 1.2 },          // 底盘与地台 y 0.05–0.62，z −1.1…1.3
  { name: 'hood', cx: 0, cy: 0.87, cz: 0.3, hx: 0.55, hy: 0.25, hz: 0.28 },             // 座椅下的发动机盖 y 0.62–1.12，z 0.02…0.58
  { name: 'counterweight', cx: 0, cy: 0.65, cz: 0.95, hx: 0.6, hy: 0.6, hz: 0.35 },     // 配重与气瓶 y 0.05–1.25，z 0.6…1.3
  { name: 'dash', cx: 0, cy: 0.91, cz: -0.68, hx: 0.45, hy: 0.29, hz: 0.17 },           // 仪表台 z −0.85…−0.51
  { name: 'postFL', cx: -0.5, cy: 1.38, cz: -0.6, hx: 0.04, hy: 0.72, hz: 0.04 },
  { name: 'postFR', cx: 0.5, cy: 1.38, cz: -0.6, hx: 0.04, hy: 0.72, hz: 0.04 },
  { name: 'postRL', cx: -0.5, cy: 1.38, cz: 0.62, hx: 0.04, hy: 0.72, hz: 0.04 },
  { name: 'postRR', cx: 0.5, cy: 1.38, cz: 0.62, hx: 0.04, hy: 0.72, hz: 0.04 },
  { name: 'roof', cx: 0, cy: 2.075, cz: 0.01, hx: 0.55, hy: 0.025, hz: 0.67 },          // 护顶 y 2.05–2.1
  { name: 'mastOuter', cx: 0, cy: 1.08, cz: -1.0, hx: 0.42, hy: 0.98, hz: 0.1 },        // y 0.1–2.06
  { name: 'mastInner', cx: 0, cy: 1.12, cz: -1.04, hx: 0.36, hy: 1.0, hz: 0.06 },       // y 0.12–2.12（升 d）
  { name: 'carriage', cx: 0, cy: 0.66, cz: -1.12, hx: 0.5, hy: 0.58, hz: 0.04 },        // 货叉架 + 挡货架 y 0.08–1.24（升 2d）
  { name: 'forkL', cx: -0.28, cy: 0.035, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },     // y 0.015–0.055（升 2d）
  { name: 'forkR', cx: 0.28, cy: 0.035, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },
];
function carObbs(x, z, yaw, lift = 0, src = FK_OBBS) {
  const c = Math.cos(yaw), s = Math.sin(yaw), d = Math.max(0, Math.min(1, lift)) * 1.3;
  return src.map(o => {
    const dy = o.name === 'mastInner' ? d : (o.name === 'carriage' || o.name === 'forkL' || o.name === 'forkR') ? 2 * d : 0;
    return { name: o.name, cx: x + c * o.cx + s * o.cz, cz: z - s * o.cx + c * o.cz, hx: o.hx, hz: o.hz, rot: yaw, minY: o.cy - o.hy + dy, maxY: o.cy + o.hy + dy };
  });
}
function carPoint(x, z, yaw, p) { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + c * p[0] + s * p[2], p[1], z - s * p[0] + c * p[2]]; }
// 每个部件单独一个 key（veh-core 的写法 '<车>#<部件>'）
function addCar(prefix, list) { for (const o of list) addO(prefix + '#' + o.name, [o]); }

test('OBB：正撞斜放的面停在一个半径外（沿面法线），擦着角按角的径向推开', () => {
  const o = obb(5, 0, 0.6, 1.2, 0.5);
  addO('0,0#v0#chassis', [o]);
  const u = axU(o);
  const st = { x: o.cx + u[0] * (o.hx + 3), z: o.cz + u[1] * (o.hx + 3) };
  const res = walkO(st, R, -u[0] * 0.1, -u[1] * 0.1, 60, '正撞');
  const [lx, lz] = toLocal(o, st.x, st.z);
  near(lx, o.hx + R, 2e-4, '停在面外一个半径（局部 x）'); near(lz, 0, 1e-9, '不该沿面乱滑');
  ok(res.hit, '应报撞');
  // 朝角走（沿对角线方向正对着角）：停在离角 r 的地方，还在那条线上
  P.clear(); allObb = []; addO('k', [o]);
  const corner = toWorld(o, o.hx, o.hz);
  const dir = [Math.cos(0.9), Math.sin(0.9)];   // 从角的外侧象限里来：先确认这个方向确实在角的外侧
  const [dlx, dlz] = (() => { const c = Math.cos(o.rot), s = Math.sin(o.rot); return [c * dir[0] - s * dir[1], s * dir[0] + c * dir[1]]; })();
  ok(dlx > 0 && dlz > 0, '测试设置：方向应指向角外侧');
  const s2 = { x: corner[0] + dir[0] * 3, z: corner[1] + dir[1] * 3 };
  walkO(s2, R, -dir[0] * 0.05, -dir[1] * 0.05, 120, '撞角');
  near(Math.hypot(s2.x - corner[0], s2.z - corner[1]), R, 2e-4, '离角一个半径');
  const along = ((s2.x - corner[0]) * dir[0] + (s2.z - corner[1]) * dir[1]) / Math.hypot(s2.x - corner[0], s2.z - corner[1]);
  ok(along > 0.9999, `应沿来的方向停在角外，cos=${along}`);
});

test('OBB：贴边滑动（斜着推转过的长墙，切向走满、法向贴住）；贴着面平行走不报撞', () => {
  const o = obb(0, 0, 10, 0.1, 0.4);
  addO('w', [o]);
  const p0 = toWorld(o, -5, -(0.1 + R + 0.5));
  const st = { x: p0[0], z: p0[1] };
  const u = axU(o), v = axV(o);
  const d = [(u[0] + v[0]) / Math.SQRT2 * 0.05, (u[1] + v[1]) / Math.SQRT2 * 0.05];   // 局部 (1, 1) 方向，斜着压向 −z 面
  walkO(st, R, d[0], d[1], 200, '斜推');
  const [lx, lz] = toLocal(o, st.x, st.z);
  near(lx, -5 + 200 * 0.05 / Math.SQRT2, 1e-6, '切向应走满');
  near(lz, -(0.1 + R), 2e-4, '法向贴着面');
  const res = P.moveCircle(st.x, st.z, R, u[0] * 0.15, u[1] * 0.15, 0, 1.8);
  ok(!res.hit, '贴着面平行走不该报撞');
  near(Math.hypot(res.x - st.x, res.z - st.z), 0.15, 1e-9, '平行走位移');
});

test('OBB：起点已经压着——浅的一次推干净；深的每次最多推 r、几次就出来；往里走那一步不算；夹在墙和车中间不穿墙', () => {
  const o = obb(0, 0, 0.6, 1.2, 0.3);
  addO('c#v0#chassis', [o]);
  const u = axU(o);
  // 浅：圆心在盒外 0.2 m（压进 0.1）
  let p = toWorld(o, o.hx + 0.2, 0.3);
  let r = P.moveCircle(p[0], p[1], R, 0, 0, 0, 1.8);
  let l = toLocal(o, r.x, r.z);
  near(l[0], o.hx + R, 2e-4, '浅压一次推到面外一个半径'); near(l[1], 0.3, 1e-9, '沿法线推');
  ok(!P.overlapCircle(r.x, r.z, R, 0, 1.8), '推完不再重叠');
  // 深：圆心在盒内，离最近的面（+x）0.5，压进 0.8
  p = toWorld(o, 0.1, 0.2);
  ok(P.overlapCircle(p[0], p[1], R, 0, 1.8), 'overlapCircle 认 OBB');
  let x = p[0], z = p[1], calls = 0;
  while (obbPen(x, z, R) > 1e-6 && calls < 10) {
    // 每次还故意往盒子里走 0.1：不能更深
    const before = obbPen(x, z, R);
    r = P.moveCircle(x, z, R, -u[0] * 0.1, -u[1] * 0.1, 0, 1.8);
    const step = Math.hypot(r.x - x, r.z - z);
    ok(step <= R + 1e-9, `一次最多推 r，实际 ${step}`);
    const after = obbPen(r.x, r.z, R);
    ok(after < before - 0.29 || after <= 1e-6, `应该越推越浅：${before} → ${after}`);
    const dir = ((r.x - x) * u[0] + (r.z - z) * u[1]) / step;
    ok(dir > 0.9999, `应沿最小穿透方向（局部 +x）推，cos=${dir}`);
    x = r.x; z = r.z; calls++;
  }
  ok(calls === 3, `0.8 m 深应 3 次推出来，实际 ${calls}`);
  // 夹缝：OBB 右面 x=0.5，墙 x 0.8–1.0，缝 0.3 < 2r。人刷在 OBB 里（x=0.4）：往 +x 推被墙挡住，推不完也不能穿墙；
  // 往缝里（±z）走可以（没变深），往 OBB 里（−x）走不行
  P.clear(); all = []; allObb = [];
  add('wall', [box(0.8, -5, 1.0, 5)]);
  const o2 = obb(0, 0, 0.5, 2, 0);
  addO('x#v1#chassis', [o2]);
  let s = { x: 0.4, z: 0 };
  let pen0 = obbPen(s.x, s.z, R);
  for (let i = 0; i < 20; i++) {
    const res = P.moveCircle(s.x, s.z, R, i % 2 ? -0.08 : 0, i % 2 ? 0 : 0.05, 0, 1.8);
    s.x = res.x; s.z = res.z;
    noPen(s.x, s.z, R, `夹缝第 ${i} 次（不许穿墙）`);
    const pen = obbPen(s.x, s.z, R);
    ok(pen <= pen0 + 1e-6, `夹缝第 ${i} 次压得更深了：${pen0} → ${pen}`);
    pen0 = pen;
  }
  ok(s.z > 0.4, `沿缝能走（不卡死），z=${s.z}`);
});

test('OBB：10 cm 宽的货叉，人（r 0.3）一帧冲 20 m、瓶子（r 0.03）一帧冲 25 m 都穿不过；矮货叉也挡脚（Y 规则）', () => {
  const fk = obb(0, 0, 0.05, 0.47, 1.2, 0.015, 0.055);
  addO('0,0#v0#forkL', [fk]);
  const u = axU(fk);
  for (const [r, len, h] of [[R, 20, 1.8], [0.03, 25, 0.2]]) {
    const p = toWorld(fk, -(0.05 + r + 2), 0.1);
    const res = P.moveCircle(p[0], p[1], r, u[0] * len, u[1] * len, 0, h);
    const l = toLocal(fk, res.x, res.z);
    near(l[0], -(0.05 + r), 2e-4, `r=${r} 停在货叉这一侧`);
    ok(res.hit, '应报撞');
  }
  // 脚底 0.06（高过叉面 0.055）不挡；脚底 0 挡
  const p = toWorld(fk, -1, 0);
  ok(P.moveCircle(p[0], p[1], R, u[0] * 3, u[1] * 3, 0.06, 1.8).hit === false, '脚底高过叉面不挡');
  ok(P.moveCircle(p[0], p[1], R, u[0] * 3, u[1] * 3, 0, 1.8).hit === true, '站在地上被货叉挡');
  // 沿货叉长边从叉尖正前方走过去：被叉尖挡住（"人走到货叉前面会被货叉挡住"）
  const v = axV(fk);
  const q = toWorld(fk, 0, -(0.47 + R + 1));
  const res = P.moveCircle(q[0], q[1], R, v[0] * 2, v[1] * 2, 0, 1.8);
  near(toLocal(fk, res.x, res.z)[1], -(0.47 + R), 2e-4, '停在叉尖前');
});

test('OBB：raycast 命中距离误差 < 1 mm、法线和 key；los 被挡 / 越过顶 / 起点在盒内算挡 / 贴着面往外看不挡', () => {
  const g = BR.util.mulberry32(77);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    P.clear(); allObb = [];
    const o = obb(g() * 20 - 10, g() * 20 - 10, 0.05 + g() * 2, 0.05 + g() * 2, g() * 8 - 4, g() * 0.5, 1 + g() * 2, 'part' + i);
    P.addOBBs('veh|1@0,0#v0#p' + i, [o]);
    const face = Math.floor(g() * 5);   // 0..3 侧面，4 顶面
    const u = axU(o), v = axV(o);
    let tl, n;
    const a = (g() * 1.8 - 0.9), b = g();
    const y = o.minY + (o.maxY - o.minY) * (0.05 + 0.9 * b);
    if (face === 0) { tl = [o.hx, a * o.hz]; n = [u[0], 0, u[1]]; }
    else if (face === 1) { tl = [-o.hx, a * o.hz]; n = [-u[0], 0, -u[1]]; }
    else if (face === 2) { tl = [a * o.hx, o.hz]; n = [v[0], 0, v[1]]; }
    else if (face === 3) { tl = [a * o.hx, -o.hz]; n = [-v[0], 0, -v[1]]; }
    else { tl = [a * o.hx, (g() * 1.8 - 0.9) * o.hz]; n = [0, 1, 0]; }
    const tw = toWorld(o, tl[0], tl[1]);
    const ty = face === 4 ? o.maxY : y;
    // 起点：沿外法线退 0.5–5 m，再加一点切向偏移（仍在这个面的外侧半空间里）
    const back = 0.5 + g() * 4.5, side = (g() - 0.5) * back;
    const tdir = face === 4 ? [u[0], 0, u[1]] : [0, 1, 0];
    const ox = tw[0] + n[0] * back + tdir[0] * side, oy = ty + n[1] * back + tdir[1] * side * 0.3, oz = tw[1] + n[2] * back + tdir[2] * side;
    const dx = tw[0] - ox, dy = ty - oy, dz = tw[1] - oz, L = Math.hypot(dx, dy, dz);
    const h = P.raycast(ox, oy, oz, dx, dy, dz, 50);
    ok(h, `第 ${i} 条应命中`);
    worst = Math.max(worst, Math.abs(h.dist - L));
    ok(Math.abs(h.dist - L) < 1e-3, `第 ${i} 条距离误差 ${Math.abs(h.dist - L)}`);
    ok(h.nx * n[0] + h.ny * n[1] + h.nz * n[2] > 0.9999, `第 ${i} 条法线 (${h.nx},${h.ny},${h.nz}) 应为 (${n})`);
    ok(h.key === 'veh|1@0,0#v0#p' + i && h.obb === true && h.name === 'part' + i, `key/name：${h.key} ${h.name}`);
    ok(!P.los(ox, oy, oz, tw[0] - n[0] * 0.01, ty - n[1] * 0.01, tw[1] - n[2] * 0.01), `第 ${i} 条视线穿进盒子应被挡`);
    ok(P.los(ox, oy, oz, tw[0] + n[0] * 0.01, ty + n[1] * 0.01, tw[1] + n[2] * 0.01), `第 ${i} 条视线没碰到面应通畅`);
  }
  console.log(`        300 条射线最大距离误差 ${worst.toExponential(2)} m`);
  P.clear();
  const o = obb(0, 0, 1, 1, 0.7, 0, 1.2);
  P.addOBBs('k', [o]);
  ok(!P.los(-3, 0.6, 0.1, 3, 0.6, -0.1), '穿过盒子被挡');
  ok(P.los(-3, 1.5, 0, 3, 1.5, 0), '高过盒顶不挡');
  ok(!P.los(0.1, 0.6, 0.1, 5, 0.6, 5), '起点在盒内算挡（和 AABB 一样）');
  const f = toWorld(o, 1, 0), uu = axU(o);
  ok(P.los(f[0], 0.6, f[1], f[0] + uu[0] * 4, 0.6, f[1] + uu[1] * 4), '眼睛贴着面往外看不挡');
  ok(P.raycast(0, 0.6, 0, 1, 0, 0, 10).dist === 0, '起点在盒内 raycast dist = 0');
  // AABB 和 OBB 都在路上：最近的赢
  P.addSolids('wall', [box(4, -1, 4.2, 1)]);
  let h = P.raycast(-5, 0.6, 0, 1, 0, 0, 20);
  ok(h.key === 'k' && h.obb, '先打到 OBB');
  h = P.raycast(2, 0.6, 0, 1, 0, 0, 20);
  ok(h.key === 'wall' && !h.obb && Math.abs(h.dist - 2) < 1e-9, '起点在 OBB 外、前面只有墙');
  h = P.raycast(9, 0.6, 0, -1, 0, 0, 20);
  ok(h.key === 'wall' && Math.abs(h.dist - 4.8) < 1e-9, '反向先打到墙');
});

test('OBB：ignoreKey 前缀只对 OBB 生效（同前缀的 AABB 不被忽略）；raycast / moveBox / overlapBox / sweepOBBs 一样', () => {
  P.addSolids('0,0', [box(9, -1, 9.5, 1)]);
  P.addSolids('0,0#p2', [box(6, -1, 6.5, 1)]);                  // 道具 AABB：key 以 '0,0#' 开头
  P.addOBBs('0,0#v0#chassis', [obb(3, 0, 0.5, 0.5, 0.3, 0, 2)]);   // 停着的车的部件
  P.addOBBs('veh|1@1,0#v2#forkL', [obb(1.5, 0, 0.1, 0.4, 0.2, 0, 2)]);
  P.addOBBs('0,0#v', [obb(-3, 0, 0.3, 0.3, 0, 0, 2)]);          // 名字是 '0,0#v' 本身
  const hit = opts => { const h = P.raycast(0, 1, 0, 1, 0, 0, 20, opts); return h && h.key; };
  ok(hit() === 'veh|1@1,0#v2#forkL', '不忽略：最近的是货叉');
  ok(hit({ ignoreKey: 'veh|1@1,0#v2' }) === '0,0#v0#chassis', '忽略车 key（前缀）跳过它的部件');
  ok(hit({ ignoreKey: ['veh|1@1,0#v2', '0,0#v0'] }) === '0,0#p2', '两台车都忽略');
  ok(hit({ ignoreKey: ['veh|1@1,0#v2', '0,0'] }) === '0,0#p2', '对照：忽略区块 key "0,0"：OBB "0,0#v0#chassis" 按前缀跳过，同前缀的 AABB "0,0#p2" 照样挡');
  ok(hit({ ignoreKey: ['a', 'b', 'veh|1@1,0#v2', 'L1@0,0#v0'] }) === '0,0#p2', '长数组 + 带层级前缀的道具 key');
  ok(hit({ ignoreKey: ['veh|1@1,0#v2', '0,0#v0#chassis'] }) === '0,0#p2', '精确 key 也行');
  ok(hit({ ignoreKey: ['veh|1@1,0#v', '0,0#v'] }) === 'veh|1@1,0#v2#forkL', '前缀必须到 "#" 为止："…#v" 不算 "…#v2#…" 的前缀');
  ok(P.raycast(0, 1, 0, -1, 0, 0, 20, { ignoreKey: '0,0#v' }) === null, '"0,0#v" 本身被精确忽略');
  ok(P.raycast(0, 1, 0, -1, 0, 0, 20, { ignoreKey: '0,0' }) === null, '"0,0#v" 是 "0,0" 名下的 OBB 子 key');
  // moveBox：忽略车以后能推过去，同前缀的 AABB 还挡
  let r = P.moveBox(0.6, -0.2, 0.9, 0.2, 0, 1, 10, 0, { ignoreKey: 'veh|1@1,0#v2' });
  near(0.9 + r.dx, 3 - Math.hypot(0.5, 0.5) * Math.cos(Math.PI / 4 - 0.3) - 0.0, 0.2, '忽略货叉后被车身挡（粗查）');
  ok(r.hitX && 0.9 + r.dx < 3, `被车身挡住：右沿 ${0.9 + r.dx}`);
  r = P.moveBox(0.6, -0.2, 0.9, 0.2, 0, 1, 10, 0, { ignoreKey: ['veh|1@1,0#v2', '0,0'] });
  near(0.9 + r.dx, 6, 1e-3, '车都忽略后停在道具 AABB 前');
  // overlapBox
  ok(P.overlapBox(2.5, -0.2, 3.5, 0.2, 0, 1) === 1, 'overlapBox 认 OBB');
  ok(P.overlapBox(2.5, -0.2, 3.5, 0.2, 0, 1, { ignoreKey: 'L1@0,0#v0' }) === 0, 'overlapBox 前缀忽略 OBB');
  ok(P.overlapBox(5.5, -0.2, 6.2, 0.2, 0, 1, { ignoreKey: '0,0' }) === 1, 'overlapBox：同前缀的 AABB 不被忽略');
  // sweepOBBs：一块盒子往 +x 扫
  const mv = [obb(0, 0, 0.2, 0.2, 0, 0, 1)];
  let s = P.sweepOBBs(mv, { dx: 10, dz: 0 });
  ok(s && s.key === 'veh|1@1,0#v2#forkL' && s.kind === 'obb', `sweep 先撞货叉：${JSON.stringify(s)}`);
  s = P.sweepOBBs(mv, { dx: 10, dz: 0 }, { ignoreKey: ['veh|1@1,0#v2', '0,0'] });
  ok(s && s.key === '0,0#p2' && s.kind === 'solid', `sweep：同前缀的 AABB 照样撞：${JSON.stringify(s)}`);
});

test('OBB：removeSolids 连同 "<key>#*" 名下的 OBB 一起摘；同 key 再 addOBBs 是替换；clear；stats / records', () => {
  P.addSolids('3,4', [box(10, -1, 10.2, 1)]);
  P.addSolids('3,4#v0', [box(-1, -1, 1, 1)]);                    // 停着的车原来那个外接 AABB
  P.addOBBs('3,4#v0#chassis', [obb(0, 0, 0.6, 1.2, 0.2), obb(0, 0, 0.3, 0.3, 0)]);
  P.addOBBs('3,4#v0#roof', [obb(0, 0, 0.5, 0.6, 0.2, 2, 2.1)]);
  P.addOBBs('3,40#v0#chassis', [obb(20, 0, 0.6, 1.2, 0)]);
  P.addOBBs('veh|1@3,4#v0#chassis', [obb(30, 0, 0.6, 1.2, 0)]);
  let st = P.stats();
  ok(st.obbs === 5 && st.obbKeys === 4, `stats：${JSON.stringify(st)}`);
  P.addOBBs('3,4#v0#chassis', [obb(0, 0, 0.6, 1.2, 0.2)]);       // 替换：2 → 1
  ok(P.stats().obbs === 4, '同 key 再登记是替换');
  const rec = P.records('3,4#v0');
  ok(rec.solids.length === 1 && rec.obbs.length === 2 && rec.obbs.every(o => o.key.startsWith('3,4#v0#')), `records：${JSON.stringify(rec)}`);
  // veh-core 的写法：先摘停着的 AABB（连带它名下已有的 OBB），再登记 OBB
  let n = P.removeSolids('3,4#v0');
  ok(n === 3, `应摘掉 1 个 AABB + 2 个 OBB，实际 ${n}`);
  ok(P.records('3,4').obbs.length === 0 && P.records('3,4').solids.length === 1, '区块自己的 AABB 留着');
  P.addOBBs('3,4#v0#chassis', [obb(0, 0, 0.6, 1.2, 0.2)]);
  n = P.removeSolids('3,4');                                        // 区块卸载
  ok(n === 2, `区块卸载摘 1 AABB + 1 OBB，实际 ${n}`);
  ok(P.records('3,40').obbs.length === 1, '"3,40" 不是 "3,4" 的子 key');
  ok(P.records('veh|1@3,4#v0').obbs.length === 1, "'veh|' 的 OBB 不跟区块走");
  ok(P.removeSolids('veh|1@3,4#v0') === 1, '按车 key 摘开过的车');
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try { P.addOBBs('bad', [null, { cx: NaN, cz: 0, hx: 1, hz: 1 }, { cx: 0, cz: 0, hx: 1, hz: 1, minY: NaN }]); } finally { console.warn = warn; }
  ok(warned === 2, `两块非法 OBB 各警告一次，实际 ${warned}`);
  ok(P.records('bad').obbs.length === 0, '非法 OBB 忽略');
  P.addOBBs('cy', [{ cx: 0, cz: 0, hx: 1, hz: 1, cy: 1, hy: 0.5 }]);
  const cy = P.records('cy').obbs[0];
  ok(cy.minY === 0.5 && cy.maxY === 1.5 && cy.rot === 0, '也认 cy/hy');
  P.clear();
  st = P.stats();
  ok(st.obbs === 0 && st.obbKeys === 0 && st.obbCells === 0, 'clear 清空 OBB');
  ok(P.los(-5, 1, 0, 5, 1, 0) && !P.moveCircle(-1, 0, R, 2, 0, 0, 1.8).hit, 'clear 后不再挡');
});

test('OBB：overlapBox 按分离轴判（外接盒相交但分离轴分开不算；贴着不算；Y 不重叠不算）；out 交出 OBB 记录', () => {
  P.addOBBs('d', [obb(0, 0, 1, 1, Math.PI / 4, 0, 1)]);   // 菱形，外接盒 ±1.414
  ok(P.overlapBox(1.0, 1.0, 1.5, 1.5, 0, 1) === 0, '外接盒相交、分离轴分开：不算');
  const out = [];
  ok(P.overlapBox(0.5, 0.5, 1.0, 1.0, 0, 1, { out }) === 1, '真的压着');
  ok(out.length === 1 && out[0].obb === true && out[0].key === 'd' && Math.abs(out[0].rot - Math.PI / 4) < 1e-12, 'out 里是 OBB 记录');
  ok(P.obbVsAabb(out[0], { minX: 0.5, maxX: 1, minZ: 0.5, maxZ: 1, minY: 0, maxY: 1 }) > 0, 'out 记录可以直接交给纯函数');
  ok(P.overlapBox(0.5, 0.5, 1.0, 1.0, 1.2, 1) === 0, 'Y 不重叠');
  P.clear();
  P.addOBBs('a', [obb(0, 0, 1, 1, 0, 0, 1)]);
  ok(P.overlapBox(1.0, -0.5, 2, 0.5, 0, 1) === 0, '贴着不算');
  ok(P.overlapBox(0.997, -0.5, 2, 0.5, 0, 1) === 0, '压进 3 mm < tol 5 mm 不算');
  ok(P.overlapBox(0.99, -0.5, 2, 0.5, 0, 1) === 1, '压进 1 cm 算');
  ok(P.overlapBox(0.997, -0.5, 2, 0.5, 0, 1, { tol: 0.001 }) === 1, 'tol 可调');
  ok(P.overlapCircle(1.25, 0, R, 0, 1.8) && !P.overlapCircle(1.31, 0, R, 0, 1.8) && !P.overlapCircle(1.25, 0, R, 1.0, 1.8), 'overlapCircle：压着 / 离开 / 站在盒顶上');
});

test('OBB：overlapOBB 认静态 AABB 和别的 OBB（分离轴 + 竖直），ignoreKey 前缀，out 能直接算深度', () => {
  P.addSolids('w', [box(1, -5, 1.2, 5, 0, 3)]);
  P.addSolids('beam', [box(-5, -5, 5, 5, 3.55, 4)]);
  P.addOBBs('veh|1@0,0#v0#chassis', [obb(0, 0, 0.6, 1.2, 0, 0.05, 0.62)]);
  P.addOBBs('0,0#v1#forkL', [obb(-1, 0, 0.05, 0.47, 0.3, 0.015, 0.055)]);
  const car = obb(0.5, 0, 0.6, 1.2, 0.1, 0.05, 2.1);
  const out = [];
  let n = P.overlapOBB(car, { out, ignoreKey: 'veh|1@0,0#v0' });
  ok(n === 1 && out[0].key === 'w', `只压着墙（自己的部件被忽略、横梁在头顶上）：${n} ${out.map(s => s.key)}`);
  near(P.obbVsAabb(car, out[0]), 0.5 + Math.cos(0.1) * 0.6 + Math.sin(0.1) * 1.2 - 1, 1e-9, 'out 记录直接算深度');
  n = P.overlapOBB(car, { out });
  ok(n === 2 && out.some(s => s.obb && s.key === 'veh|1@0,0#v0#chassis'), '不忽略时也压着自己那块 OBB');
  ok(P.overlapOBB(obb(-1, 0.3, 0.3, 0.3, 0, 0, 1)) === 1, '压着别人的货叉');
  ok(P.overlapOBB(obb(-1, 0.3, 0.3, 0.3, 0, 0.06, 1)) === 0, '高过叉面（竖直不重叠）不算');
  ok(P.overlapOBB(obb(-0.5, 0, 0.6, 1.2, 0, 0, 2.1), { tol: 0, ignoreKey: 'veh|1@0,0#v0' }) === 1, 'tol 0：压着 "0,0" 名下的货叉');
  ok(P.overlapOBB(obb(-0.5, 0, 0.6, 1.2, 0, 0, 2.1), { tol: 0, ignoreKey: ['0,0', 'veh|1@0,0#v0'] }) === 0, '忽略区块 key "0,0"：它名下的货叉 OBB 按前缀跳过');
  ok(P.overlapOBB(obb(0.5, 0, 0.6, 1.2, 0, 0.05, 2.1), { tol: 0, ignoreKey: ['0,0', 'veh|1@0,0#v0'] }) === 1, 'tol 0：压进墙 0.1 算');
  ok(P.overlapOBB(obb(0.4, 0, 0.6, 1.2, 0, 0.05, 2.1), { tol: 0, ignoreKey: ['0,0', 'veh|1@0,0#v0'] }) === 0, '刚好贴着墙面：不算');
  ok(P.overlapOBB(null) === 0 && P.overlapOBB({ cx: NaN }) === 0, '非法输入 0');
});

test('OBB：moveBox 拖家具撞到转过的叉车停住（不压进去）、贴着滑；出发时已压着的不挡；随机拖 1000 步不穿', () => {
  const o = obb(3, 0.2, 0.6, 1.2, 0.6, 0, 2.1);
  P.addOBBs('veh|car#chassis', [o]);
  const S = { x: -2, z: 0 }, w = 0.8, d = 0.6;
  let res = null;
  for (let i = 0; i < 80; i++) {
    res = P.moveBox(S.x - w / 2, S.z - d / 2, S.x + w / 2, S.z + d / 2, 0, 1, 0.1, 0);
    S.x += res.dx; S.z += res.dz;
    const pen = P.obbVsAabb(o, { minX: S.x - w / 2, maxX: S.x + w / 2, minZ: S.z - d / 2, maxZ: S.z + d / 2 });
    ok(pen <= 1e-6, `第 ${i} 帧压进车 ${pen}`);
  }
  ok(res.hitX, '应报 hitX');
  const more = P.obbVsAabb(o, { minX: S.x - w / 2 + 0.002, maxX: S.x + w / 2 + 0.002, minZ: S.z - d / 2, maxZ: S.z + d / 2 });
  ok(more > 0, '停在接触前 2 mm 以内');
  // 出发就压着：不挡（拖开就好）
  const r2 = P.moveBox(2.6, -0.2, 3.2, 0.4, 0, 1, -3, 0);
  near(r2.dx, -3, 1e-12, '出发时已压着的不挡');
  // 随机：几台车 + 墙里拖 1000 步，每步都不压进任何 OBB（2D）
  P.clear(); all = []; allObb = [];
  const g = BR.util.mulberry32(5150);
  for (let i = 0; i < 12; i++) addO('veh|c' + i + '#chassis', [obb(g() * 30 - 15, g() * 30 - 15, 0.3 + g() * 0.8, 0.3 + g() * 1.5, g() * 6, 0, 2)]);
  const walls = [];
  for (let i = 0; i < 40; i++) { const x = g() * 30 - 15, z = g() * 30 - 15; walls.push(g() < 0.5 ? box(x, z, x + g() * 4, z + 0.2) : box(x, z, x + 0.2, z + g() * 4)); }
  add('fz', walls);
  const free = (x0, z0, x1, z1) => boxPen(x0, z0, x1, z1) <= 0 && allObb.every(q => P.obbVsAabb(q, { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }) <= 0);
  let checked = 0;
  for (let a = 0; a < 20; a++) {
    const bw = 0.3 + g(), bd = 0.3 + g();
    let x, z, tries = 0;
    do { x = g() * 30 - 15; z = g() * 30 - 15; } while (!free(x - bw / 2, z - bd / 2, x + bw / 2, z + bd / 2) && ++tries < 500);
    if (!free(x - bw / 2, z - bd / 2, x + bw / 2, z + bd / 2)) continue;
    for (let s = 0; s < 60; s++) {
      const ang = g() * Math.PI * 2, len = g() < 0.1 ? g() * 8 : g() * 0.3;
      const rr = P.moveBox(x - bw / 2, z - bd / 2, x + bw / 2, z + bd / 2, 0, 1, Math.cos(ang) * len, Math.sin(ang) * len);
      x += rr.dx; z += rr.dz;
      const bp = boxPen(x - bw / 2, z - bd / 2, x + bw / 2, z + bd / 2);
      ok(bp <= 1e-6, `agent ${a} step ${s} 穿墙 ${bp}`);
      for (const q of allObb) {
        const pen = P.obbVsAabb(q, { minX: x - bw / 2, maxX: x + bw / 2, minZ: z - bd / 2, maxZ: z + bd / 2 });
        ok(pen <= 1e-6, `agent ${a} step ${s} 压进车 ${pen}`);
      }
      checked++;
    }
  }
  ok(checked >= 800, `有效样本太少：${checked}`);
});

test('OBB：随机模糊——随机墙 + 30 个转过的盒子，30 个人各走 120 步，始终不穿墙、不压进盒子', () => {
  const g = BR.util.mulberry32(4242);
  const walls = [];
  for (let i = 0; i < 90; i++) {
    const x = g() * 40 - 20, z = g() * 40 - 20, w = 0.05 + g() * 4;
    walls.push(g() < 0.5 ? box(x, z, x + w, z + 0.1 + g() * 0.3) : box(x, z, x + 0.1 + g() * 0.3, z + w));
  }
  add('fz', walls);
  for (let i = 0; i < 30; i++) addO('veh|k' + i + '#p', [obb(g() * 40 - 20, g() * 40 - 20, 0.04 + g() * 1.2, 0.04 + g() * 1.5, g() * 7, 0, 2)]);
  let checked = 0;
  for (let a = 0; a < 30; a++) {
    const r = 0.1 + g() * 0.4;
    let x, z, tries = 0;
    do { x = g() * 40 - 20; z = g() * 40 - 20; } while ((depth(x, z, r) > 0 || obbPen(x, z, r) > 0) && ++tries < 500);
    if (depth(x, z, r) > 0 || obbPen(x, z, r) > 0) continue;
    for (let s = 0; s < 120; s++) {
      const ang = g() * Math.PI * 2, len = g() < 0.08 ? g() * 15 : g() * 0.5;
      const res = P.moveCircle(x, z, r, Math.cos(ang) * len, Math.sin(ang) * len, 0, 1.8);
      x = res.x; z = res.z;
      noPenAll(x, z, r, `agent ${a} step ${s}`);
      checked++;
    }
  }
  ok(checked >= 2500, `有效样本太少：${checked}`);
});

// sweepOBBs 撞上以后核对：在 t 处不压（≤ 0.1 mm），再往前 1 mm 就压上（贴着停）
function poseList(list, m, t) {
  const th = (m.dyaw || 0) * t, c = Math.cos(th), s = Math.sin(th);
  return list.map(o => {
    const ox = o.cx - m.px, oz = o.cz - m.pz;
    return Object.assign({}, o, { cx: m.px + (m.dx || 0) * t + c * ox + s * oz, cz: m.pz + (m.dz || 0) * t - s * ox + c * oz, rot: o.rot + th });
  });
}
function maxDepthVs(list, shapes) {
  let w = 0;
  for (const o of list) for (const b of shapes) {
    const d = b.r != null ? (P.circleVsObb(b.x, b.z, b.r, o) || { depth: 0 }).depth : (b.hx != null ? P.obbVsObb(o, b) : P.obbVsAabb(o, b));
    if (d > w) w = d;
  }
  return w;
}

test('sweepOBBs：平移撞 5 cm 薄墙不穿（一次扫 10 m，或者 4.5 m/s 每帧扫）；停在墙前 < 1 mm', () => {
  const wall = box(-5, -5.05, 5, -5.0, 0, 3);
  P.addSolids('wall', [wall]);
  const car = carObbs(0, 0, 0);
  const m = { dx: 0, dz: -10, dyaw: 0, px: 0, pz: 0 };
  const h = P.sweepOBBs(car, m);
  ok(h && h.kind === 'solid' && h.key === 'wall', `应撞墙：${JSON.stringify(h)}`);
  ok(h.name === 'forkL' || h.name === 'forkR', `货叉尖先到：${h.name}`);
  near(h.t * 10, 5.0 - 2.1, 1e-3, '叉尖走到墙面');
  ok(maxDepthVs(poseList(car, m, h.t), [wall]) <= 0, '停下的地方不压墙（留着缝）');
  ok(maxDepthVs(poseList(car, m, h.t + 1e-4), [wall]) > 0, '再往前 1 mm 就压上');
  ok(h.depth > -1.1e-4 && h.depth <= -0.9e-4 + 1e-6, `碰上时离墙约 0.1 mm：depth ${h.depth}`);
  // 每帧 7.5 cm（4.5 m/s、60 fps）开过去，再顶着墙按 600 帧：始终不压墙（下一帧从不重叠出发、不会一帧帧挤进去），最后贴住
  let z = 0;
  for (let f = 0; f < 720; f++) {
    const mm = { dx: 0, dz: -0.075, px: 0, pz: z };
    const list = carObbs(0, z, 0);
    const hh = P.sweepOBBs(list, mm);
    z += -0.075 * (hh ? hh.t : 1);
    const now = carObbs(0, z, 0);
    ok(maxDepthVs(now, [wall]) <= 0, `第 ${f} 帧压墙 ${maxDepthVs(now, [wall])}`);
    if (f % 60 === 59) ok(now.every(o => P.overlapOBB(o, { tol: 0 }) === 0), `第 ${f} 帧：overlapOBB(tol 0) 不该认为起点压着墙`);
  }
  near(z, -(5.0 - 2.1), 1e-3, '最后贴着墙');
  ok(-(5.0 - 2.1) - z < 2e-4, `顶 600 帧也没往墙里挤：离墙 ${(z + 2.9) * 1000} mm`);
  // 贴着墙往后倒：能走
  const back = P.sweepOBBs(carObbs(0, z, 0), { dx: 0, dz: 0.5, px: 0, pz: z });
  ok(back === null, '贴着墙往后倒：不撞');
  // 斜着撞一面转过的 5 cm 薄墙（OBB），边开边转
  P.clear();
  const tw = obb(0, -6, 4, 0.025, 0.5, 0, 3);
  P.addOBBs('thin', [tw]);
  const m2 = { dx: 0, dz: -12, dyaw: 0.4, px: 0, pz: 0 };
  const h2 = P.sweepOBBs(car, m2);
  ok(h2 && h2.kind === 'obb' && h2.key === 'thin', `应撞转过的薄墙：${JSON.stringify(h2)}`);
  ok(maxDepthVs(poseList(car, m2, h2.t), [tw]) <= 1e-4 && maxDepthVs(poseList(car, m2, Math.min(1, h2.t + 2e-4)), [tw]) > 0, '停在接触前');
  ok(P.sweepOBBs(car, { dx: 0, dz: 3, dyaw: 0, px: 0, pz: 0 }) === null, '往后倒没东西：null');
  ok(P.sweepOBBs(car, { dx: 0, dz: 0, dyaw: 0 }) === null && P.sweepOBBs([], { dx: 1 }) === null, '不动 / 空列表：null');
});

test('sweepOBBs：转动扫掠撞角——起点和终点都不碰、只有转到半路才扫到的细柱也能查出来；配重甩尾撞柱', () => {
  const car = carObbs(0, 0, 0);
  const pv = { px: 0, pz: -0.62 };
  // 细柱放在车尾外角绕前轴转 0.7 rad 的位置上
  const R0 = Math.hypot(0.6, 1.3 + 0.62), a0 = Math.atan2(0.6, 1.3 + 0.62);
  const cx = Math.sin(0.7 + a0) * R0, cz = -0.62 + Math.cos(0.7 + a0) * R0;
  const pillar = box(cx - 0.05, cz - 0.05, cx + 0.05, cz + 0.05, 0, 3);
  P.addSolids('pillar', [pillar]);
  const m = Object.assign({ dx: 0, dz: 0, dyaw: 1.5 }, pv);
  ok(maxDepthVs(poseList(car, m, 0), [pillar]) <= 0 && maxDepthVs(poseList(car, m, 1), [pillar]) <= 0, '测试设置：起点、终点都不碰');
  const h = P.sweepOBBs(car, m);
  ok(h && h.key === 'pillar' && h.t > 0.2 && h.t < 0.5, `应在半路撞柱：${JSON.stringify(h)}`);
  ok(maxDepthVs(poseList(car, m, h.t), [pillar]) <= 1e-4, '撞前停住');
  ok(maxDepthVs(poseList(car, m, h.t + 1e-3), [pillar]) > 0, '再转一点就压上');
  ok(['counterweight', 'chassis'].includes(h.name), `撞上的是车尾：${h.name}`);
  // 反方向转（车尾往 −x 甩）不碰这根柱
  ok(P.sweepOBBs(car, Object.assign({ dx: 0, dz: 0, dyaw: -1.5 }, pv)) === null, '反方向转不碰');
  // 边开边转：配重甩到右后方的方柱
  P.clear();
  const post = box(0.75, 0.4, 1.35, 1.0, 0, 3);
  P.addSolids('post', [post]);
  const m3 = { dx: 0, dz: -0.4, dyaw: 0.9, px: 0, pz: -0.62 };
  const h3 = P.sweepOBBs(car, m3);
  ok(h3 && h3.key === 'post' && h3.t < 1, `甩尾撞柱：${JSON.stringify(h3)}`);
  ok(maxDepthVs(poseList(car, m3, h3.t), [post]) <= 1e-4, '停在接触前');
});

test('sweepOBBs：人和怪（circles）、出口禁区和 keepClear（boxes）、头顶的管子；ignoreKey 跳过车自己；出发时已压着的墙只许越压越浅', () => {
  const car = carObbs(0, 0, 0);
  addCar('veh|1@0,0#v0', car);                     // 车自己的 OBB 也登记在 phys 里
  const fwd = { dx: 0, dz: -2, dyaw: 0, px: 0, pz: 0 };
  ok(P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0' }) === null, '忽略自己以后前面没东西');
  let h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', circles: [{ x: 0.28, z: -3, r: 0.3, minY: 0, maxY: 1.8, id: 'peer' }, [5, 5, 0.3, 'far']] });
  ok(h && h.kind === 'circle' && h.circleId === 'peer' && h.key === null, `撞人：${JSON.stringify(h)}`);
  near(h.t * 2, 3 - 0.3 - 2.1, 1e-3, '叉尖停在人前');
  h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', circles: [{ x: 0, z: -3, r: 0.3, minY: 0.3, maxY: 1.8, id: 'x' }] });
  ok(h && h.circleId === 'x' && h.name !== 'forkL' && h.name !== 'forkR', `两根货叉中间、离地 0.3 的腿：货叉从下面过去，撞的是货叉架：${JSON.stringify(h)}`);
  h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', circles: [{ x: 0, z: -3, r: 0.3, minY: 2.2, maxY: 3, id: 'up' }] });
  ok(h === null, '在门架顶上方的圆不算');
  const exit = { kind: 'exit', x: 0, z: -4, r: 1.4 };
  h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [{ kind: 'keep', x0: 5, z0: 5, x1: 6, z1: 6 }, exit] });
  ok(h && h.kind === 'box' && h.box === exit && h.boxIndex === 1 && h.key === null, `撞出口圈：${JSON.stringify(h)}`);
  near(h.t * 2, 4 - Math.sqrt(1.4 * 1.4 - 0.23 * 0.23) - 2.1, 1e-3, '叉尖内角停在出口圈外');
  ok(P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [Object.assign({}, exit, { y: 8 })] }) === null, '别的楼层的出口（高差 > 2.5）不算');
  const keep = { kind: 'keep', x0: -1, z0: -3.5, x1: 1, z1: -3.2 };
  h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [keep] });
  ok(h && h.box === keep, 'keepClear 矩形');
  // 头顶的管子（底面 2.0）：门架顶 2.12 碰得到；底面 2.2 碰不到
  const pipe = { kind: 'pipe', minX: -2, maxX: 2, minZ: -1.6, maxZ: -1.4, y: 2.0 };
  h = P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [pipe] });
  ok(h && h.box === pipe && (h.name === 'mastInner' || h.name === 'mastOuter'), `门架顶撞管子（货叉、货叉架从下面过去）：${JSON.stringify(h)}`);
  near(h.t * 2, 1.4 - 1.1, 1e-3, '门架前脸停在管子前');
  ok(P.sweepOBBs(car, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [Object.assign({}, pipe, { y: 2.2 })] }) === null, '管子更高就过得去');
  // 货叉升到 2.0 m（lift 0.77 → 内门架顶 3.12）：底面 3.0 的管子也撞
  const up = carObbs(0, 0, 0, 0.77);
  h = P.sweepOBBs(up, fwd, { ignoreKey: 'veh|1@0,0#v0', boxes: [Object.assign({}, pipe, { y: 3.0 })] });
  ok(h && h.box && (h.name === 'mastInner' || h.name === 'carriage'), `升起来以后撞更高的管子：${JSON.stringify(h)}`);
  // 不传 ignoreKey：车自己登记在 phys 里的部件会被当成障碍（底盘往前开就更深地压进自己的门架），调用方必须传自己的 key
  h = P.sweepOBBs(car, fwd);
  ok(h && h.kind === 'obb' && h.key.startsWith('veh|1@0,0#v0#') && h.t === 0, `不传 ignoreKey 会撞到自己：${JSON.stringify(h)}`);
  // 起点已经压着墙（右侧压进 2 cm）：往外、沿墙都能走，往里走算撞
  P.clear();
  const wall = box(0.58, -5, 1.0, 5, 0, 3);
  P.addSolids('w', [wall]);
  ok(P.sweepOBBs(car, { dx: -0.5, dz: 0, px: 0, pz: 0 }) === null, '往离墙方向能走');
  ok(P.sweepOBBs(car, { dx: 0, dz: -1, px: 0, pz: 0 }) === null, '沿着墙能走');
  h = P.sweepOBBs(car, { dx: 0.3, dz: 0, px: 0, pz: 0 });
  ok(h && h.key === 'w' && h.t < 1e-3, `往墙里走立刻算撞：${JSON.stringify(h)}`);
  h = P.sweepOBBs(car, { dx: 0, dz: -1, dyaw: -0.3, px: 0, pz: -0.62 });
  ok(h && h.key === 'w', '打方向让车尾甩进墙：算撞');
});

// 驾驶舱 los：眼点和胸口点不在任何盒子里，往两侧看、从车侧 6 m 看胸口都不被车身挡
function cabLosCheck(src, label) {
  for (const [x, z, yaw] of [[16.4, 16.91, 0], [16.4, 16.91, 1.1], [-3, 2, -2.3]]) {
    P.clear(); allObb = [];
    const car = carObbs(x, z, yaw, 0, src);
    addCar('veh|1@0,0#v0', car);
    const eye = carPoint(x, z, yaw, FK_EYE), chest = carPoint(x, z, yaw, FK_CHEST);
    for (const o of car) {
      ok(!P.pointInObb(o, eye[0], eye[1], eye[2]), `${label}：眼点在 ${o.name} 里`);
      ok(!P.pointInObb(o, chest[0], chest[1], chest[2]), `${label}：胸口点在 ${o.name} 里`);
    }
    // 司机往外看：左右两侧 ±25° 的扇面、平视和往下 10°
    for (const side of [-1, 1]) {
      for (let a = -25; a <= 25; a += 5) {
        for (const pitch of [0, -0.175]) {
          const ang = a * Math.PI / 180;
          const lx = side * Math.cos(ang) * 6, lz = Math.sin(ang) * 6;
          const tgt = carPoint(x, z, yaw, [lx, FK_EYE[1] + Math.tan(pitch) * 6, FK_EYE[2] + lz]);
          ok(P.los(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2]), `${label}：眼点往 ${side > 0 ? '右' : '左'} ${a}° 俯 ${pitch} 被挡`);
        }
      }
    }
    // 车侧 6 m（沿驾驶舱 z −0.5…0.55，高 1.0–1.9）看座椅胸口点
    for (const side of [-1, 1]) {
      for (let lz = -0.5; lz <= 0.55; lz += 0.15) {
        for (const hy of [1.0, 1.3, 1.6, 1.9]) {
          const p = carPoint(x, z, yaw, [side * 6, hy, lz]);
          ok(P.los(p[0], p[1], p[2], chest[0], chest[1], chest[2]), `${label}：车${side > 0 ? '右' : '左'}侧 6 m（z ${lz.toFixed(2)}，高 ${hy}）看胸口被挡`);
        }
      }
    }
    // 对照：OBB 确实在起作用——从车头前方低处穿过门架和仪表台看胸口是被挡的
    const front = carPoint(x, z, yaw, [0, 0.9, -6]);
    ok(!P.los(front[0], front[1], front[2], chest[0], chest[1], chest[2]), `${label}：对照——从车头前方低处穿过门架看胸口应被挡`);
  }
}
test('叉车 OBB 常数：眼点 / 胸口点不在任何盒子里；驾驶舱往两侧看不被挡；车侧 6 m 看座椅胸口不被挡', () => {
  // 测试用的常数本身先核一遍驾驶舱空当
  for (const o of FK_OBBS) {
    const x0 = o.cx - o.hx, x1 = o.cx + o.hx, z0 = o.cz - o.hz, z1 = o.cz + o.hz, y0 = o.cy - o.hy, y1 = o.cy + o.hy;
    const inCab = x1 > -FK_CAB.x && x0 < FK_CAB.x && z1 > FK_CAB.z0 && z0 < FK_CAB.z1 && y1 > FK_CAB.yFloor + 1e-9 && y0 < FK_CAB.yTop - 1e-9;
    const underSeat = y1 <= FK_CAB.ySeat && z0 >= 0;   // 座椅下面（发动机盖）
    ok(!inCab || underSeat, `测试常数：${o.name} 伸进了驾驶舱空当`);
  }
  cabLosCheck(FK_OBBS, '测试常数');
});
test('叉车 OBB 常数（L1 的 BR.L1forklift.geo.obbs，能在 node 里载入 L1.js 时）：同样的驾驶舱 los', () => {
  let geo = null, why = '';
  try {
    const stubKit = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : stubKit), apply: () => stubKit, construct: () => stubKit });
    const keep = { kit: BR.kit, levels: BR.levels };
    BR.kit = BR.kit || stubKit;
    BR.levels = BR.levels || { register() {}, get() { return null; } };
    const warn = console.warn, log = console.log;
    console.warn = () => {}; console.log = () => {};
    try { load('js/levels/L1.js'); } finally { console.warn = warn; console.log = log; BR.kit = keep.kit; BR.levels = keep.levels; }
    geo = BR.L1forklift && BR.L1forklift.geo;
    if (!geo || typeof geo.obbs !== 'function') { why = 'L1.js 里还没有 BR.L1forklift.geo.obbs'; geo = null; }
  } catch (e) { why = 'node 里载不了 L1.js：' + String(e && e.message || e).slice(0, 80); geo = null; }
  if (!geo) { console.log(`        跳过：${why}`); return; }
  const list = geo.obbs(0);
  ok(Array.isArray(list) && list.length === 14, `obbs(0) 应是 14 个，实际 ${list && list.length}`);
  const src = list.map(o => ({ name: o.name, cx: o.cx, cy: o.cy, cz: o.cz, hx: o.hx, hy: o.hy, hz: o.hz }));
  if (geo.eye) { FK_EYE[0] = geo.eye.x; FK_EYE[1] = geo.eye.y; FK_EYE[2] = geo.eye.z; }
  if (geo.seatChest) { const c = geo.seatChest; if (Array.isArray(c)) { FK_CHEST[0] = c[0]; FK_CHEST[1] = c[1]; FK_CHEST[2] = c[2]; } else { FK_CHEST[0] = c.x; FK_CHEST[1] = c.y; FK_CHEST[2] = c.z; } }
  cabLosCheck(src, 'L1 常数');   // carObbs 的 lift 固定 0，不再额外抬高
  console.log(`        用 L1 的常数核对：${src.map(o => o.name).join(' ')}；眼点 (${FK_EYE.join(', ')})，胸口 (${FK_CHEST.join(', ')})`);
});

test('纯函数：obbVsAabb / obbVsObb 穿透深度（含竖直）、对称；circleVsObb 两种参数顺序；pointInObb 四种写法', () => {
  const A = obb(0, 0, 1, 1, 0, 0, 1);
  near(P.obbVsAabb(A, { minX: 0.9, maxX: 2, minZ: -0.5, maxZ: 0.5, minY: 0, maxY: 1 }), 0.1, 1e-12, '轴对齐重叠 0.1');
  near(P.obbVsAabb(A, { minX: 0.5, maxX: 2, minZ: -0.5, maxZ: 0.5, minY: 0.95, maxY: 3 }), 0.05, 1e-12, '竖直只重叠 0.05：取最小');
  ok(P.obbVsAabb(A, { minX: 1, maxX: 2, minZ: -0.5, maxZ: 0.5 }) === 0, '贴着 = 0');
  ok(P.obbVsAabb(A, { minX: 0.5, maxX: 2, minZ: -0.5, maxZ: 0.5, minY: 1, maxY: 2 }) === 0, '竖直贴着 = 0');
  const D = obb(0, 0, 1, 1, Math.PI / 4);
  ok(P.obbVsAabb(D, { minX: 1, maxX: 1.5, minZ: 1, maxZ: 1.5 }) === 0, '菱形角外：0');
  near(P.obbVsAabb(D, { minX: 0.5, maxX: 1, minZ: 0.5, maxZ: 1 }), 1 - Math.SQRT1_2, 1e-9, '菱形压进去的深度（角点 (0.5, 0.5) 到菱形面）');
  const g = BR.util.mulberry32(9);
  for (let i = 0; i < 300; i++) {
    const a = obb(g() * 4 - 2, g() * 4 - 2, 0.1 + g(), 0.1 + g(), g() * 7, g(), 1 + g());
    const b = obb(g() * 4 - 2, g() * 4 - 2, 0.1 + g(), 0.1 + g(), g() * 7, g(), 1 + g());
    const d1 = P.obbVsObb(a, b), d2 = P.obbVsObb(b, a);
    ok(Math.abs(d1 - d2) < 1e-12, `不对称 ${d1} vs ${d2}`);
    // 有深度时一定有一个角点或中心在对方里面附近（粗核：中心距离不超过两个外接圆半径之和）
    if (d1 > 0) ok(Math.hypot(a.cx - b.cx, a.cz - b.cz) < Math.hypot(a.hx, a.hz) + Math.hypot(b.hx, b.hz), '相交却离得太远');
    // 零角度时和 AABB 版一致
  }
  near(P.obbVsObb(obb(0, 0, 1, 1, 0), obb(1.5, 0, 1, 1, Math.PI / 2)), 0.5, 1e-9, '转 90° 和不转一样');
  near(P.obbVsObb(obb(0, 0, 1, 1, 0), { minX: 0.8, maxX: 3, minZ: -3, maxZ: 3 }), 0.2, 1e-12, 'obbVsObb 也认 AABB');
  const c1 = P.circleVsObb(1.2, 0, 0.3, A), c2 = P.circleVsObb(A, 1.2, 0, 0.3);
  ok(c1 && c2 && Math.abs(c1.depth - 0.1) < 1e-12 && c1.nx === 1 && c1.nz === 0 && c2.depth === c1.depth, `circleVsObb：${JSON.stringify(c1)}`);
  ok(P.circleVsObb(1.31, 0, 0.3, A) === null, '分开 → null');
  ok(P.circleVsObb(1.2, 0, 0.3, A, 1.0, 1.8) === null && P.circleVsObb(1.2, 0, 0.3, A, 0, 1.8), '竖直按 AABB 规则');
  const cr = P.circleVsObb(0.2, 0.9, 0.3, D);
  ok(cr && Math.abs(cr.nx - Math.SQRT1_2) < 1e-9 && Math.abs(cr.nz - Math.SQRT1_2) < 1e-9, `菱形面法线 (√½, √½)：${JSON.stringify(cr)}`);
  ok(P.pointInObb(D, 0.6, 0.6) && !P.pointInObb(D, 0.8, 0.8), 'pointInObb(o, x, z)');
  ok(P.pointInObb(D, 0.6, 2, 0.6) && !P.pointInObb(D, 0.6, 3.5, 0.6), 'pointInObb(o, x, y, z)：竖直');
  ok(P.pointInObb(0.6, 0.6, D) && P.pointInObb(0.6, 2, 0.6, D) && !P.pointInObb(0.6, -1, 0.6, D), 'pointInObb(x, z, o) / (x, y, z, o)');
  ok(P.pointInObb(1, 0, A) && !P.pointInObb(1.0001, 0, A), '边界算在里面');
  // toWorldOBBs：和测试里的 carObbs（网格 rotation.y = yaw 的摆法）一致
  const W = P.toWorldOBBs(FK_OBBS, 16.4, 16.91, 0.7, 0.2), C = carObbs(16.4, 16.91, 0.7);
  ok(W.length === 14 && W.every((o, i) => o.name === C[i].name && Math.abs(o.cx - C[i].cx) < 1e-12 && Math.abs(o.cz - C[i].cz) < 1e-12 &&
    o.rot === 0.7 && Math.abs(o.minY - C[i].minY - 0.2) < 1e-12 && Math.abs(o.maxY - C[i].maxY - 0.2) < 1e-12), 'toWorldOBBs 和 carObbs 一致（再抬高 y）');
  const nose = carPoint(16.4, 16.91, 0.7, [0, 0, -2.1]), fl = W.find(o => o.name === 'forkL');
  ok(P.pointInObb(fl, ...carPoint(16.4, 16.91, 0.7, [-0.28, 0.25, -2.0])) && !P.pointInObb(fl, nose[0], 0.25, nose[2]), 'toWorldOBBs 的货叉在车头前面、左边');
});

test('性能：84 个 OBB（6 台车）时 moveCircle 平均耗时增加 ≤ 15%', () => {
  const g = BR.util.mulberry32(8484);
  // L1 出生 3×3 区块（96 × 96 m）的密度：柱子、货架、墙段、小屋 ~1700 块
  const sol = [];
  for (let i = 0; i < 1700; i++) {
    const x = g() * 96 - 48, z = g() * 96 - 48, t = g();
    if (t < 0.3) sol.push(box(x, z, x + 0.6, z + 0.6, 0, 4));
    else if (t < 0.7) sol.push(g() < 0.5 ? box(x, z, x + 2 + g() * 6, z + 1.1, 0, 3.1) : box(x, z, x + 1.1, z + 2 + g() * 6, 0, 3.1));
    else sol.push(g() < 0.5 ? box(x, z, x + 1 + g() * 5, z + 0.2) : box(x, z, x + 0.2, z + 1 + g() * 5));
  }
  for (let k = 0; k < 9; k++) P.addSolids(`${k % 3 - 1},${Math.floor(k / 3) - 1}`, sol.filter((_, i) => i % 9 === k));
  const cars = [];
  for (let i = 0; i < 6; i++) cars.push(carObbs(g() * 80 - 40, g() * 80 - 40, g() * 6));
  // 64 个走路的人：起点在空地上，每帧 7 cm，方向偶尔变
  const A = [];
  for (let i = 0; i < 64; i++) {
    let x, z, tries = 0;
    do { x = g() * 90 - 45; z = g() * 90 - 45; } while (P.overlapCircle(x, z, R, 0, 1.8) && ++tries < 200);
    A.push({ x0: x, z0: z, seed: (g() * 1e9) >>> 0 });
  }
  const FR = 300;
  let nObb = 0;
  const run = (withObb) => {
    for (let i = 0; i < 6; i++) { if (withObb) addCar('veh|c' + i, cars[i]); else P.removeSolids('veh|c' + i); }
    if (withObb) nObb = P.stats().obbs;
    let sink = 0;
    const t0 = process.hrtime.bigint();
    for (const a of A) {
      const rr = BR.util.mulberry32(a.seed);
      let x = a.x0, z = a.z0, ang = rr() * 6.283;
      for (let f = 0; f < FR; f++) {
        if (rr() < 0.05) ang = rr() * 6.283;
        const res = P.moveCircle(x, z, R, Math.cos(ang) * 0.07, Math.sin(ang) * 0.07, 0, 1.8);
        x = res.x; z = res.z;
        if (res.hit) ang += 1.3;
      }
      sink += x + z;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (!Number.isFinite(sink)) throw new Error('NaN');
    return ms;
  };
  for (let w = 0; w < 4; w++) { run(false); run(true); }   // 预热 JIT
  // 机器上同时跑着别的东西时单次计时抖得很厉害：两种情况交替各跑 25 轮，各取最快的一轮相比（最快的那轮受干扰最少）。
  // 偶尔整段都被干扰时重测，最多 3 次
  const calls = A.length * FR;
  let ratio = Infinity;
  for (let attempt = 1; attempt <= 3 && ratio > 1.15; attempt++) {
    const base = [], with84 = [];
    for (let k = 0; k < 25; k++) {
      if (k % 2) { base.push(run(false)); with84.push(run(true)); } else { with84.push(run(true)); base.push(run(false)); }
    }
    const mb = Math.min(...base), mo = Math.min(...with84);
    const med = arr => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
    ratio = mo / mb;
    console.log(`        第 ${attempt} 次：${calls} 次 moveCircle，无 OBB 最快 ${mb.toFixed(2)} ms（中位 ${med(base).toFixed(2)}），84 个 OBB 最快 ${mo.toFixed(2)} ms（中位 ${med(with84).toFixed(2)}），+${((ratio - 1) * 100).toFixed(1)}%`);
  }
  ok(nObb === 84, `应有 84 个 OBB，实际 ${nObb}`);
  ok(ratio <= 1.15, `耗时增加 ${((ratio - 1) * 100).toFixed(1)}% > 15%`);
});

// FE1 返修 r3：opts.skipBoxes —— 区块里一整块共用一个 key，跳过其中一块静态 AABB（叉车按斜放地牛的真实形状挡，人照旧被老碰撞体挡）
test('skipBoxes：sweepOBBs / overlapOBB / raycast 跳过指定的那块 AABB，同 key 的别的块照旧挡；不给时和原来一样', () => {
  P.clear();
  const jack = box(4, -0.5, 5, 0.5, 0, 0.3), wall = box(8, -2, 8.2, 2, 0, 3);
  P.addSolids('9,9', [jack, wall]);
  const skip = [[jack.minX, jack.minY, jack.minZ, jack.maxX, jack.maxY, jack.maxZ]];
  const car = [{ cx: 0, cz: 0, hx: 0.5, hz: 0.5, rot: 0, minY: 0, maxY: 2 }];
  const a = P.sweepOBBs(car, { dx: 10, dz: 0, dyaw: 0 });
  ok(a && a.kind === 'solid' && Math.abs(a.t * 10 + 0.5 - 4) < 0.01, '不给 skipBoxes 先撞上地牛那块：' + JSON.stringify(a));
  const b = P.sweepOBBs(car, { dx: 10, dz: 0, dyaw: 0 }, { skipBoxes: skip });
  ok(b && Math.abs(b.t * 10 + 0.5 - 8) < 0.01, '跳过地牛那块以后撞上同 key 的墙：' + JSON.stringify(b));
  const c = P.sweepOBBs(car, { dx: 10, dz: 0, dyaw: 0 }, { skipBoxes: [[jack.minX + 0.01, jack.minY, jack.minZ, jack.maxX, jack.maxY, jack.maxZ]] });
  ok(c && Math.abs(c.t * 10 + 0.5 - 4) < 0.01, '差 1 cm 的不算同一块：' + JSON.stringify(c));
  const o = { cx: 4.5, cz: 0, hx: 0.2, hz: 0.2, rot: 0.3, minY: 0, maxY: 0.5 };
  ok(P.overlapOBB(o) === 1 && P.overlapOBB(o, { skipBoxes: skip }) === 0, 'overlapOBB 跳过那块');
  const r0 = P.raycast(4.5, 1, 0, 0, -1, 0, 2), r1 = P.raycast(4.5, 1, 0, 0, -1, 0, 2, { skipBoxes: skip });
  ok(r0 && Math.abs(r0.y - 0.3) < 1e-6 && !r1, 'raycast 往下打：不跳过打在 0.3，跳过就打不到：' + JSON.stringify([r0, r1]));
  const r2 = P.raycast(0, 1, 0, 1, 0, 0, 20, { skipBoxes: skip });
  ok(r2 && Math.abs(r2.dist - 8) < 1e-6, '跳过只影响那一块：平着打照样打到墙：' + JSON.stringify(r2));
  ok(P.overlapCircle(4.5, 0, 0.2, 0, 1), '人（overlapCircle）照旧被那块挡');
  P.clear();
});

console.log(`\nphys: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
