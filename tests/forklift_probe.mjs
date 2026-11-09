// 后室 · 叉车只读探针（方案 2026-10-06「叉车驾驶提前版」FE1 tests 最后一条，openQuestions 4）：node tests/forklift_probe.mjs [--seeds 12345,1,2,…]
// 只读：不改任何游戏状态以外的东西、不判过不过，两张表交主会话和家长定 FE2 的取舍。tests/all.mjs 把它列在 SPECIAL 里（不自动跑）。
// 起本地静态服务（随机端口）+ 系统 Chrome（SwiftShader），page.route 拦截 api.ovobot.ai 回假响应、其余外站一律掐掉。
// 每个种子单机（测试模式、高画质）进 L1，出生点周围 5×5 块都载入后量：
//   (a) shelf：出生 3×3 块里每排货架的每个货架面（长边，两面），第三层（梁顶 2.32 m）放货时货叉、门架要升到的地方
//       （货架面往外 0–0.13 m 是挡货架 / 货叉架，顶 2.32 + 1.225 = 3.55 m；0.13–0.36 m 是内门架，顶 2.125 + 1.3 × 0.887 = 3.28 m）
//       正上方有没有 b.data.overhead 里底面更低的东西。按货架面长度每 0.25 m 采一点，记被挡住的比例和挡住它的东西（管子 / 吊灯 / 横梁 …）
//   (b) reach：出生柱间那台叉车 40 m 内能叉的货 —— 落地托盘货（1.44 × 1.44 的货堆，四面都算叉口面）和货架货（每个货架面三格），
//       ① 叉口面正前方有没有 ≥3.6 m（进深）× 1.4 m（宽）的空地（phys.overlapBox，0.02–2.0 m 高；b.data.sideObs 的外接框压进来也不算空）；
//       ② 从出生车开过去：车的 14 个 OBB（BR.L1forklift.geo.obbs(0)）在 phys 里（连同 sideObs，圆柱按圆、其余按 OBB）做粗略路径搜索（1 m 网格 × 8 个朝向，直走 / 斜 45° 走、
//          前进倒车都算），到「车头正对叉口面、叉尖离面 0.3 m」那个位姿附近能不能到；再用两侧各加宽 5 cm 的车（1.3 m 宽）搜一遍，
//          窄车到得了、宽车到不了 = 路上有 <1.3 m 的缝。
// 表写到 tests/output/forklift/probe/：shelf.txt / shelf.json、reach.txt / reach.json。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'forklift', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const SEEDS = argOf('seeds') ? argOf('seeds').split(',').map(x => +x).filter(x => x > 0) : [12345, 1, 2, 3, 4, 5, 6, 7, 8, 85];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};
function startServer() {
  const srv = http.createServer((req, res) => {
    let u;
    try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const errors = [];
const EV_TIMEOUT = 110000;
function ev(page, fn, arg) {
  let timer = 0;
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('page.evaluate 超过 ' + EV_TIMEOUT / 1000 + ' 秒没返回')), EV_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
}

// ---------- 页面里：探针工具 ----------
function installProbe() {
  const P = window.__fp = {};
  const RACK_H = 3.1, RACK_D = 2.32;
  // 第三层放货（货叉底 = 梁顶 2.32）：lift = (2.32 − 0.015) / 2.6；挡货架顶 = 1.24 + 2.6·lift，内门架顶 = 2.125 + 1.3·lift
  const L3 = (2.32 - 0.015) / 2.6, BACK_TOP = 1.24 + 2.6 * L3, INNER_TOP = 2.125 + 1.3 * L3;
  P.racks = () => {
    const out = [];
    for (const c of BR.world.chunks()) for (const s of BR.phys.records(c.key).solids) {
      if (s.key !== c.key) continue;
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ, h = s.maxY - s.minY;
      if (Math.abs(h - RACK_H) > 0.05 || Math.abs(Math.min(w, d) - RACK_D) > 0.1 || Math.max(w, d) < 3) continue;
      out.push({ ck: c.key, minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, alongX: w > d });
    }
    return out;
  };
  P.overhead = () => {
    const out = [];
    for (const c of BR.world.chunks()) for (const o of ((c.res && c.res.data && c.res.data.overhead) || [])) out.push(o);
    return out;
  };
  // 货架的两个长边面：{ face 线上的起止、法线方向（往外）}
  P.faces = r => {
    if (r.alongX) return [{ x0: r.minX + 0.25, x1: r.maxX - 0.25, z: r.minZ, nz: -1, nx: 0 }, { x0: r.minX + 0.25, x1: r.maxX - 0.25, z: r.maxZ, nz: 1, nx: 0 }];
    return [{ z0: r.minZ + 0.25, z1: r.maxZ - 0.25, x: r.minX, nx: -1, nz: 0 }, { z0: r.minZ + 0.25, z1: r.maxZ - 0.25, x: r.maxX, nx: 1, nz: 0 }];
  };
  // (a) 一个面：每 0.25 m 采一点，挡货架带（0–0.13 m）要 BACK_TOP，内门架带（0.13–0.36 m）要 INNER_TOP，头顶东西底面更低就算挡住
  P.shelfFace = (f, oh) => {
    const pts = [];
    const along = f.x0 != null ? [f.x0, f.x1] : [f.z0, f.z1];
    for (let t = along[0] + 0.125; t < along[1]; t += 0.25) {
      const bands = [[0, 0.13, BACK_TOP], [0.13, 0.36, INNER_TOP]];
      let by = null;
      for (const [a, b, need] of bands) {
        // 这一小块（沿面 ±0.125、往外 a..b）
        let x0, x1, z0, z1;
        if (f.x0 != null) { x0 = t - 0.125; x1 = t + 0.125; z0 = f.z + f.nz * a; z1 = f.z + f.nz * b; } else { z0 = t - 0.125; z1 = t + 0.125; x0 = f.x + f.nx * a; x1 = f.x + f.nx * b; }
        const X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Z0 = Math.min(z0, z1), Z1 = Math.max(z0, z1);
        for (const o of oh) {
          if (o.maxX <= X0 || o.minX >= X1 || o.maxZ <= Z0 || o.minZ >= Z1) continue;
          if (+o.y < need + 0.02) { by = o.kind; break; }
        }
        if (by) break;
      }
      pts.push(by);
    }
    return pts;
  };
  // ---------- (b) ----------
  P.spawnCar = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    const f = ((c && c.res.data && c.res.data.forklifts) || []).find(q => q.x > 12 && q.x < 20 && q.z > 12 && q.z < 20);
    return f ? { key: f.key, x: f.x, z: f.z, yaw: f.rot, runtime: !!f.runtime } : null;
  };
  P.fwd = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
  P.loc = lift => BR.L1forklift.geo.obbs(lift || 0);
  // 车在 (x, z, yaw) 碰不碰东西（pad：两侧各加宽多少米）
  P.hit = (x, z, yaw, pad, ignore) => {
    const loc = P.loc(0).map(o => Object.assign({}, o, { hx: o.hx + (pad || 0) }));
    const W = BR.phys.toWorldOBBs(loc, x, z, yaw, BR.phys.groundY(x, z));
    // 斜放地牛脚下那块轴对齐的老碰撞体车不理（按地牛两个 sideObs 条目的真实形状挡，和 forklift.js 一样，FE1 返修 r3）
    const skip = P.skips();
    for (const o of W) if (BR.phys.overlapOBB(o, { tol: 0.005, ignoreKey: ignore, skipBoxes: skip.length ? skip : undefined })) return true;
    // 车身高度上伸出来、没有碰撞体的东西（b.data.sideObs：柱脚、消火栓箱、地牛、纸箱、路锥……）车开不过去：圆柱按圆、其余按 OBB
    for (const e of P.sideAll()) {
      if (Math.abs(e.cx - x) > 3.6 || Math.abs(e.cz - z) > 3.6) continue;
      for (const o of W) {
        if (e.minY >= o.maxY || e.maxY <= o.minY) continue;
        const d = e.round ? BR.phys.circleVsObb(e.cx, e.cz, e.r, o, e.minY, e.maxY - e.minY) : null;
        if (e.round ? !!d && d.depth > 0.005 : BR.phys.obbVsObb(o, e) > 0.005) return true;
      }
    }
    return false;
  };
  P.skips = () => { if (P._skip) return P._skip; const out = []; for (const e of P.sideAll()) if (Array.isArray(e.solid) && out.indexOf(e.solid) < 0) out.push(e.solid); return (P._skip = out); };
  // 已载入区块的 sideObs（每个种子进层、区块载完以后清一次缓存）
  P.sideAll = () => {
    if (P._side) return P._side;
    const out = [];
    for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.sideObs) || [])) out.push(e);
    return (P._side = out);
  };
  // 能叉的货：落地托盘货堆（1.44 × 1.44，高 ≤2.4）四个面；货架每个面三格
  P.goods = (cx, cz, R) => {
    const out = [];
    for (const c of BR.world.chunks()) for (const s of BR.phys.records(c.key).solids) {
      if (s.key !== c.key) continue;
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ, h = s.maxY - s.minY;
      const mx = (s.minX + s.maxX) / 2, mz = (s.minZ + s.maxZ) / 2;
      if (Math.hypot(mx - cx, mz - cz) > R) continue;
      if (Math.abs(w - 1.44) < 0.05 && Math.abs(d - 1.44) < 0.05 && h <= 2.4) {
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ kind: 'floor', ck: c.key, x: mx + nx * 0.72, z: mz + nz * 0.72, nx, nz, w: 1.44 });
      } else if (Math.abs(h - RACK_H) < 0.05 && Math.abs(Math.min(w, d) - RACK_D) < 0.1 && Math.max(w, d) > 3) {
        const alongX = w > d, len = Math.max(w, d) - 0.5;
        for (const sgn of [-1, 1]) for (const k of [-1, 0, 1]) {
          const t = k * len / 3;
          if (alongX) out.push({ kind: 'rack', ck: c.key, x: mx + t, z: sgn < 0 ? s.minZ : s.maxZ, nx: 0, nz: sgn, w: len / 3 });
          else out.push({ kind: 'rack', ck: c.key, x: sgn < 0 ? s.minX : s.maxX, z: mz + t, nx: sgn, nz: 0, w: len / 3 });
        }
      }
    }
    return out;
  };
  // 叉口面正前方 ≥3.6 m × 1.4 m 空地
  P.apron = g => {
    const a = 0.02, d = 3.6, hw = 0.7;
    let x0, x1, z0, z1;
    if (g.nx) { x0 = g.x + g.nx * a; x1 = g.x + g.nx * (a + d); z0 = g.z - hw; z1 = g.z + hw; } else { z0 = g.z + g.nz * a; z1 = g.z + g.nz * (a + d); x0 = g.x - hw; x1 = g.x + hw; }
    const X0 = Math.min(x0, x1), Z0 = Math.min(z0, z1), X1 = Math.max(x0, x1), Z1 = Math.max(z0, z1), y0 = BR.phys.groundY(g.x, g.z) + 0.02;
    if (BR.phys.overlapBox(X0, Z0, X1, Z1, y0, 1.98) !== 0) return false;
    // 空地里有 sideObs 条目（0.02–2.0 m 高、外接框压进来）也不算空
    for (const e of P.sideAll()) {
      if (e.maxY <= y0 || e.minY >= y0 + 1.98) continue;
      if (e.maxX <= X0 || e.minX >= X1 || e.maxZ <= Z0 || e.minZ >= Z1) continue;
      return false;
    }
    return true;
  };
  // 叉口面前的停车位姿：车头对着面（车头方向 = −法线），叉尖离面 0.3 m
  P.approach = g => {
    const yaw = Math.atan2(g.nx, g.nz);   // 车头方向 (−sin, −cos) = (−nx, −nz)
    const D = 0.3 + 2.1;
    return { x: g.x + g.nx * D, z: g.z + g.nz * D, yaw };
  };
  // 洪水搜索：1 m 网格 × 8 个朝向；一步 = 沿当前朝向前进 / 后退 1 m（朝向不变，或者走 45° 斜步同时转 45°）；终点和半路都不能碰
  P.floodStart = (start, R, pad, ignore) => {
    const hIdx = Math.round(((start.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 4)) % 8;
    const i0 = Math.round(start.x), j0 = Math.round(start.z);
    const F = P._fl = { start, R, pad, ignore, seen: new Map(), q: [[i0, j0, hIdx]], head: 0, n: 0, checks: 0 };
    F.seen.set(i0 + ',' + j0 + ',' + hIdx, 1);
    P._seen = P._seen || {};
    P._seen[pad] = F.seen;
    return 0;
  };
  // 跑 budget 毫秒；返回 { done, states }
  P.floodRun = budget => {
    const F = P._fl, t0 = performance.now();
    const ok = (x, z, yaw) => { F.checks++; return !P.hit(x, z, yaw, F.pad, F.ignore); };
    while (F.head < F.q.length && performance.now() - t0 < budget) {
      const [i, j, h] = F.q[F.head++];
      F.n++;
      for (const dir of [1, -1]) for (const dh of [0, 1, -1]) {
        const h2 = (h + dh + 8) % 8;
        const yawMid = (h + dh * 0.5) * Math.PI / 4;
        const f = P.fwd(yawMid);
        const di = Math.round(f.x * dir * (dh ? 1.4142 : 1)), dj = Math.round(f.z * dir * (dh ? 1.4142 : 1));
        const i2 = i + di, j2 = j + dj;
        if (Math.hypot(i2 - F.start.x, j2 - F.start.z) > F.R) continue;
        const k2 = i2 + ',' + j2 + ',' + h2;
        if (F.seen.has(k2)) continue;
        if (!ok(i2, j2, h2 * Math.PI / 4) || !ok((i + i2) / 2, (j + j2) / 2, yawMid)) { F.seen.set(k2, 0); continue; }
        F.seen.set(k2, 1);
        F.q.push([i2, j2, h2]);
      }
    }
    return { done: F.head >= F.q.length, states: F.n, checks: F.checks };
  };
  // 停车位姿附近（1 m 内、朝向差 ≤45°）有没有搜到的格
  P.reached = (a, pad) => {
    const seen = P._seen[pad];
    const hA = ((a.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 4);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = Math.round(a.x) + di, j = Math.round(a.z) + dj;
      if (Math.hypot(i - a.x, j - a.z) > 1.01) continue;
      for (const h of [Math.floor(hA) % 8, Math.ceil(hA) % 8]) if (seen.get(i + ',' + j + ',' + h) === 1) return true;
    }
    return false;
  };
}

async function main() {
  const t0 = Date.now();
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base + '  种子 ' + SEEDS.join(','));
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const shelf = [], reach = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
    await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
    await page.goto(base + 'index.html');
    await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
    await ev(page, () => { BR.assets.init(); return 0; });
    await ev(page, installProbe);
    for (const seed of SEEDS) {
      await ev(page, s => { __br.setAuto(true); __br.start({ mode: 'test', levelId: '1', seed: s, settings: { quality: 'high' } }); return 0; }, seed);
      await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
      await ev(page, () => { __br.setAuto(false); __br.step(1.0); __fp._side = null; __fp._skip = null; return 0; });
      // (a) 出生 3×3 块的货架面
      const a = await ev(page, () => {
        const oh = __fp.overhead();
        const rows = [];
        for (const r of __fp.racks()) {
          const [cx, cz] = r.ck.split(',').map(Number);
          if (Math.abs(cx) > 1 || Math.abs(cz) > 1) continue;
          for (const f of __fp.faces(r)) {
            const pts = __fp.shelfFace(f, oh);
            const by = {};
            for (const p of pts) if (p) by[p] = (by[p] || 0) + 1;
            rows.push({ ck: r.ck, n: pts.length, blocked: pts.filter(Boolean).length, by });
          }
        }
        return rows;
      });
      const faces = a.length, pts = a.reduce((s, r) => s + r.n, 0), blk = a.reduce((s, r) => s + r.blocked, 0);
      const by = {};
      for (const r of a) for (const k in r.by) by[k] = (by[k] || 0) + r.by[k];
      const anyFaces = a.filter(r => r.blocked > 0).length;
      shelf.push({ seed, faces, len: pts * 0.25, blockedFrac: pts ? blk / pts : 0, facesAnyBlocked: anyFaces, by, rows: a });
      console.log('shelf  seed ' + seed + '：货架面 ' + faces + ' 个，长 ' + (pts * 0.25).toFixed(1) + ' m，第三层头顶被挡 ' + (pts ? (100 * blk / pts).toFixed(1) : '0') + '%（' + anyFaces + ' 个面有被挡的段）' + JSON.stringify(by));
      // (b) 出生车 40 m 内能叉的货
      const car = await ev(page, () => __fp.spawnCar());
      if (!car) { reach.push({ seed, error: '出生柱间没有车' }); continue; }
      const goods = await ev(page, c => {
        const ig = (BR.vehicles && BR.vehicles.list().find(v => v.key === c.key) || {}).physKey;
        window.__fpIgnore = ig;
        return __fp.goods(c.x, c.z, 40).map(g => Object.assign(g, { apron: __fp.apron(g), ap: __fp.approach(g) }));
      }, car);
      const fl = {};
      for (const pad of [0, 0.05]) {
        await ev(page, a => __fp.floodStart(a.car, 42, a.pad, window.__fpIgnore), { car, pad });
        let r = null;
        for (let k = 0; k < 400; k++) { r = await ev(page, () => __fp.floodRun(8000)); if (r.done) break; }
        fl[pad] = r;
      }
      const res = await ev(page, goods => goods.map(g => {
        const free = !__fp.hit(g.ap.x, g.ap.z, g.ap.yaw, 0, window.__fpIgnore);
        const r0 = free && __fp.reached(g.ap, 0), r1 = free && !__fp.hit(g.ap.x, g.ap.z, g.ap.yaw, 0.05, window.__fpIgnore) && __fp.reached(g.ap, 0.05);
        return { kind: g.kind, ck: g.ck, x: +g.x.toFixed(2), z: +g.z.toFixed(2), n: [g.nx, g.nz], apron: g.apron, parkFree: free, reach: r0, reachWide: r1, gap: r0 && !r1 };
      }), goods);
      const sum = k => res.filter(r => r.kind === k);
      const line = k => { const L = sum(k); return k + ' ' + L.length + ' 个叉口面：前方有 3.6×1.4 空地 ' + L.filter(r => r.apron).length + '、停车位姿不撞 ' + L.filter(r => r.parkFree).length + '、开得到 ' + L.filter(r => r.reach).length + '、路上有 <1.3 m 的缝 ' + L.filter(r => r.gap).length; };
      reach.push({ seed, car, flood: fl, floor: sum('floor').length, rack: sum('rack').length, rows: res });
      console.log('reach  seed ' + seed + '（车 ' + car.key + (car.runtime ? ' 保底' : '') + '）：' + line('floor') + '；' + line('rack'));
    }
    await ctx.close();
  } catch (err) {
    errors.push('流程中断：' + (err && err.stack || err));
  }
  // ---------- 写表 ----------
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  const A = ['# (a) 第三层货架（梁顶 2.32 m）正上方被 overhead 挡住的比例（出生 3×3 块，每 0.25 m 一个采样点）', '',
    pad('种子', 8) + pad('货架面', 8) + pad('面总长 m', 10) + pad('被挡比例', 10) + pad('有被挡段的面', 14) + '挡住的东西（采样点数）'];
  for (const r of shelf) A.push(pad(r.seed, 8) + pad(r.faces, 8) + pad(r.len.toFixed(1), 10) + pad((100 * r.blockedFrac).toFixed(1) + '%', 10) + pad(r.facesAnyBlocked + '/' + r.faces, 14) + JSON.stringify(r.by));
  const tf = shelf.reduce((s, r) => s + r.len, 0), tb = shelf.reduce((s, r) => s + r.len * r.blockedFrac, 0);
  A.push('', '合计：面总长 ' + tf.toFixed(1) + ' m，第三层头顶被挡 ' + (tf ? (100 * tb / tf).toFixed(1) : '0') + '%');
  fs.writeFileSync(path.join(OUT, 'shelf.txt'), A.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'shelf.json'), JSON.stringify(shelf, null, 1) + '\n');
  const B = ['# (b) 出生车 40 m 内能叉的货：叉口面前方 ≥3.6×1.4 m 空地、从出生车开不开得到、路上有没有 <1.3 m 的缝（1 m 网格 × 8 朝向的粗略搜索）', '',
    pad('种子', 8) + pad('类别', 7) + pad('叉口面', 8) + pad('有空地', 8) + pad('停得下', 8) + pad('开得到', 8) + pad('有窄缝', 8) + '有空地且开得到、没窄缝'];
  for (const r of reach) {
    if (r.error) { B.push(pad(r.seed, 8) + r.error); continue; }
    for (const k of ['floor', 'rack']) {
      const L = r.rows.filter(x => x.kind === k);
      B.push(pad(r.seed, 8) + pad(k === 'floor' ? '落地' : '货架', 7) + pad(L.length, 8) + pad(L.filter(x => x.apron).length, 8) + pad(L.filter(x => x.parkFree).length, 8) + pad(L.filter(x => x.reach).length, 8) + pad(L.filter(x => x.gap).length, 8) + L.filter(x => x.apron && x.reach && !x.gap).length);
    }
  }
  fs.writeFileSync(path.join(OUT, 'reach.txt'), B.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'reach.json'), JSON.stringify(reach, null, 1) + '\n');
  console.log('\n' + A.join('\n') + '\n\n' + B.join('\n'));
  for (const e of errors.slice(0, 20)) console.log('ERR ' + e.slice(0, 600));
  console.log('\n===== 汇总 =====');
  console.log('探针（只读，不判过不过）：种子 ' + SEEDS.length + ' 个，表写到 ' + path.relative(ROOT, OUT) + '/shelf.txt、reach.txt');
  console.log('页面报错 ' + errors.length + ' 条');
  console.log('耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  // 先出表和汇总再关浏览器（browser.close() 偶尔被遗留的 crashpad 拖住好几分钟）
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  srv.close();
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.log('forklift_probe 出错：' + (e && e.stack || e)); process.exitCode = 1; });
