// 后室 · L1 叉车数据与可动模型测试（FE1-L1）：node tests/forklift_l1.mjs [--tag <名> | --against <名>] [--quick] [--only snap,model,drive,obb,data,ws] [--root <目录>]
//
// 起本地静态服务（随机端口）+ 系统 Chrome（SwiftShader），page.route 拦截 api.ovobot.ai 回假响应、其余外站一律掐掉。
// 不进游戏：直接拿 BR.levels.get('1').buildChunk 按种子生成区块（levelSeed = U.hashInts(seed, '1')，和 world.js 一样），
// 画质靠 BR.game.settings.quality 切换。
//
//   --tag <名>      改动前拍快照到 tests/output/golden-tags/<名>/forklift_l1.json：50 个种子 × 高低画质 × L1 出生 3×3 块的
//                   几何（每个 mesh 的顶点/法线/UV/颜色/索引逐字节哈希）、碰撞体、刷新点、出口、b.data.forklifts、res.kit 的 key 列表；
//                   另加 forkliftModel part='all' 在 6 档 × 2 画质 × 5 个车号下的顶点哈希。
//                   改动前的 L1.js 没有 BR.L1forklift：本测试起的静态服务在 L1.js 的 IIFE 末尾挂一行 BR.__fkProbe（只读出私有函数，不改函数体）
//   --against <名>  改动后拿快照比对（见下面 snap / model 两段）
//   --quick         只跑 10 个种子（QUICK）
//   --root <目录>   静态服务的根目录（缺省是本仓库；拍改动前的快照时可以指向 git archive 导出的那一版）
//   --only          只跑其中几段：
//     snap   出生保底 + 区块逐项比对：(0,0) 中间柱间恰好一台叉车（自然的或保底的）；保底车 runtime:true、key '1@0,0#v<i>'、没有 spans、
//            区块几何里没有它、碎屑不落进占地外扩 0.2 m；HIGH_TRI 里的种子也有保底车；(0,0) 以外的块逐项和快照一致；种子 12345 的 9 块全部一致；
//            高低画质的叉车 key、固定设备 key、自动道具 key 一致，并且（保底车所在块除外）和快照一致
//     model  part='all' 的顶点哈希和快照逐位一致（6 档 × 2 画质 × 5 个车号）
//     drive  可动模型：每台 ≤2000 面；货叉水平段朝下的三角形；后轮 0 到 ±maxSteer 每 5° 离车身 ≥1 cm；安全带 ≥2 条、截面 ≥2 cm；
//            drvLow 不调 _bevelBox、端面斜角 0、没有 kit:decal；前大灯镜面和警示灯罩只在 kit:glow 里；拆出来的部件拼起来 = 'all'
//     obb    obbs(lift) 的 14 个盒子：和各部件实际顶点的包围盒对照、和驾驶舱空当不相交、眼点胸口点不在盒子里、24 个方向上离模型表面 ≤7 cm
//     data   overhead（每块 beam 3.55、lamp 3.14；管子和 pipeLines 一一对上；高低画质一样）、花园段 vines、营地（BR.L1room）不写这些也不放保底车；
//            sideObs（FE1 返修 r2）：字段合法、每根柱子有柱脚、高低画质逐项一样（出生 3×3 加扫到的有地牛 / 纸箱 / 路锥 / 走廊口的块）、营地不写；
//            地牛两个条目的 solid 正好对上 res.solids 里它脚下那块老碰撞体（返修 r3）
//     ws     工坊低画质：两台叉车的块加 3 个出口 ≤8000
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1；--against 指定的快照不存在时退出码为 3。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ROOT = path.resolve(argOf('root') || REPO);
const TAG = argOf('tag'), AGAINST = argOf('against');
const QUICK = argv.includes('--quick');
const ONLY = argOf('only') ? new Set(argOf('only').split(',').map(s => s.trim())) : null;
const want = s => !ONLY || ONLY.has(s);
const OUT = path.join(REPO, 'tests', 'output', 'forklift_l1');
fs.mkdirSync(OUT, { recursive: true });
const tagFile = n => path.join(REPO, 'tests', 'output', 'golden-tags', String(n), 'forklift_l1.json');

// 「进柱间时 triCount ≥7300」的种子（探针在 1–400 里找到的：出生块中间柱间之前的货架/堆垛已经把额度用满，cap 闸门本来不让放任何东西）
const HIGH_TRI = [85, 115, 153, 230];
// 出生块 (0,0) 中间柱间本来就是一台叉车的种子（自然的，不触发保底；12345 是孩子看过的那台）
const NATURAL = [12345, 31, 47, 70];
const SEEDS_ALL = (() => {
  const s = [...NATURAL, ...HIGH_TRI];
  for (let k = 1; s.length < 50; k++) if (!s.includes(k)) s.push(k);
  return s;
})();
const SEEDS_QUICK = [12345, 85, 115, 31, 1, 2, 3, 4, 5, 6];
const SEEDS = QUICK ? SEEDS_QUICK : SEEDS_ALL;
const MODEL_NUMBERS = [1, 7, 23, 88, 98];
const TIERS = ['high', 'mid', 'lite', 'low', 'lowb', 'min'];

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};
// 改动前的 L1.js 没有 BR.L1forklift：在 IIFE 末尾挂一个只读出口（只引用私有函数，不改任何函数体）
const PROBE_TAIL = '\nif (!BR.L1forklift) BR.__fkProbe = { model: forkliftModel, lod: FK_LOD, geo: FORKLIFT_GEO };\n})();';
let injected = false;
function startServer() {
  const srv = http.createServer((req, res) => {
    let u;
    try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    if (u === '/js/levels/L1.js') {
      let s = fs.readFileSync(f, 'utf8');
      if (s.indexOf('BR.L1forklift = ') < 0) {
        const i = s.lastIndexOf('\n})();');
        if (i > 0) { s = s.slice(0, i) + PROBE_TAIL + s.slice(i + 6); injected = true; }
      }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(s);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- 记录 ----------
const results = [];
const errors = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900) : ''));
}
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || '')); });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function boot(page, base) {
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.kit, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
  // 页面内的公用小工具：哈希、建区块、读累加器
  await page.evaluate(() => {
    const T = window.__fl1 = {};
    // 两路 32 位混合哈希（按 4 字节字吃，尾巴补 0）
    T.hash = (h, arr) => {
      const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      const n4 = u8.length >> 2, u32 = u8.byteOffset % 4 === 0 ? new Uint32Array(u8.buffer, u8.byteOffset, n4) : new Uint32Array(u8.slice(0, n4 * 4).buffer);
      let a = h[0] | 0, b = h[1] | 0;
      for (let i = 0; i < n4; i++) { const w = u32[i]; a = Math.imul(a ^ w, 0x01000193); b = Math.imul(b ^ w, 0x5bd1e995); b ^= b >>> 15; }
      for (let i = n4 * 4; i < u8.length; i++) { a = Math.imul(a ^ u8[i], 0x01000193); b = Math.imul(b ^ u8[i], 0x5bd1e995); }
      a = Math.imul(a ^ u8.length, 0x01000193);
      h[0] = a; h[1] = b;
      return h;
    };
    T.hex = h => (h[0] >>> 0).toString(16).padStart(8, '0') + (h[1] >>> 0).toString(16).padStart(8, '0');
    T.hashStr = s => { const e = new TextEncoder().encode(s); return T.hex(T.hash([0x811c9dc5, 0x2545f491], e)); };
    T.lv = () => BR.levels.get('1');
    T.ctxFor = (seed, id) => {
      const lv = BR.levels.get(id || '1');
      return { THREE, BR, level: lv, levelSeed: BR.util.hashInts(seed >>> 0, id || '1'), assets: BR.assets, game: BR.game, scene: null };
    };
    T.build = (seed, cx, cz, id) => {
      const ctx = T.ctxFor(seed, id), lv = ctx.level;
      return lv.buildChunk(ctx, cx, cz, BR.util.rng(ctx.levelSeed, cx, cz));
    };
    T.dispose = res => {
      if (!res) return;
      if (res.group) res.group.traverse(m => { if (m.geometry && !(m.geometry.userData && m.geometry.userData.shared)) m.geometry.dispose(); });
      if (typeof res.dispose === 'function') { try { res.dispose(); } catch (e) { /* 只是释放 */ } }
    };
    T.setQ = q => { BR.game.settings.quality = q; };
    T.fk = () => BR.L1forklift || BR.__fkProbe;
    T.model = (b, o) => { const F = BR.L1forklift; if (F) return F.model(b, o); return BR.__fkProbe.model(b, o); };
    // 建模用的空 builder（区块外）
    T.builder = () => BR.kit.builder({}, 0, 0, () => 0, { height: 4 });
    // 累加器（finish 之前）：{ key: { pos, nor, col, idx, n } }
    T.accs = b => { const o = {}; b._accs.forEach((a, k) => { if (!a || !a.idx || typeof k !== 'string' || k.indexOf('L1:forklift') === 0) return; o[k] = a; }); return o; };
    T.accHash = b => {
      const o = {};
      b._accs.forEach((a, k) => {
        if (!a || !a.pos || !a.n) return;
        const h = [0x811c9dc5, 0x2545f491];
        for (const f of ['pos', 'nor', 'col', 'idx']) if (a[f]) T.hash(h, new Float64Array(a[f]));
        o[String(k)] = [a.n, a.idx.length / 3, T.hex(h)];
      });
      return o;
    };
    T.r3 = v => Math.round(v * 1000) / 1000;
  });
}

// =====================================================================
// 页面内：一个种子、一种画质的出生 3×3 块 → 规范化记录
// =====================================================================
function pageSnapChunks({ seeds, quality }) {
  const T = window.__fl1;
  const q0 = BR.game.settings.quality;
  T.setQ(quality);
  const out = {};
  const r3 = T.r3;
  try {
    for (const seed of seeds) {
      for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
        const res = T.build(seed, cx, cz);
        const geo = [];
        let all = [0x811c9dc5, 0x2545f491];
        res.group.updateMatrixWorld(true);
        res.group.traverse(m => {
          const g = m.geometry;
          if (!g || !g.attributes || !g.attributes.position) return;
          const h = [0x811c9dc5, 0x2545f491];
          for (const k of ['position', 'normal', 'uv', 'color']) if (g.attributes[k]) T.hash(h, g.attributes[k].array);
          if (g.index) T.hash(h, g.index.array);
          T.hash(h, new Float64Array(m.matrixWorld.elements));
          geo.push([m.name || m.type, g.attributes.position.count, g.index ? g.index.count : 0, T.hex(h)]);
          T.hash(all, new Uint32Array([h[0], h[1]]));
        });
        const solids = (res.solids || []).map(s => [r3(s.minX), r3(s.minY), r3(s.minZ), r3(s.maxX), r3(s.maxY), r3(s.maxZ)]);
        const spawn = (res.spawnPoints || []).map(p => [r3(p.x), r3(p.y || 0), r3(p.z), p.kind || '', p.safe ? 1 : 0]);
        const exits = (res.exits || []).map(e => [r3(e.x), r3(e.z), String(e.to), e.kind || '', e.sealed ? 1 : 0, r3(e.radius || 0)]);
        const K = res.kit || {};
        const fkl = (res.data && res.data.forklifts) || [];
        out[seed + '|' + quality + '|' + cx + ',' + cz] = {
          geo, geoHash: T.hex(all),
          solids: T.hashStr(JSON.stringify(solids)), nSolids: solids.length,
          spawn: T.hashStr(JSON.stringify(spawn)), nSpawn: spawn.length,
          exits: T.hashStr(JSON.stringify(exits)),
          fk: fkl.map(f => [r3(f.x), r3(f.z), r3(f.rot), f.detail, f.tris]),
          props: (K.props || []).map(r => [r.key, r.kind]),
          fixtures: (K.fixtures || []).map(r => [r.key, r.kind]),
          containers: (K.containers || []).map(r => r.key),
          bays: res.data && res.data.bays, sector: res.data && res.data.sector,
        };
        T.dispose(res);
      }
    }
  } finally { T.setQ(q0); }
  return out;
}

// part='all' 的顶点哈希：6 档 × 5 个车号（当前画质）
function pageModelHashes({ quality, numbers, tiers }) {
  const T = window.__fl1;
  const q0 = BR.game.settings.quality;
  T.setQ(quality);
  const out = {};
  try {
    for (const detail of tiers) for (const number of numbers) {
      const b = T.builder();
      T.model(b, { part: 'all', lift: 0, steer: 0, detail, number });
      out[quality + '|' + detail + '|' + number] = T.accHash(b);
    }
  } finally { T.setQ(q0); }
  return out;
}

// =====================================================================
// 主流程
// =====================================================================
async function main() {
  if (TAG && AGAINST) { console.log('--tag 和 --against 不能同时给'); process.exit(2); }
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base + '（根目录 ' + ROOT + '）  种子 ' + SEEDS.length + ' 个' + (TAG ? '，拍快照 ' + TAG : AGAINST ? '，比对快照 ' + AGAINST : ''));
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let code = 0;
  const t0 = Date.now();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    watch(page, 'fl1');
    await boot(page, base);
    if (injected) console.log('     （L1.js 没有 BR.L1forklift：已挂只读出口 BR.__fkProbe）');

    if (TAG) {
      const snap = { schema: 1, seeds: SEEDS, quick: QUICK, chunks: {}, models: {} };
      for (const q of ['high', 'low']) {
        for (let i = 0; i < SEEDS.length; i += 10) Object.assign(snap.chunks, await ev(page, pageSnapChunks, { seeds: SEEDS.slice(i, i + 10), quality: q }));
        Object.assign(snap.models, await ev(page, pageModelHashes, { quality: q, numbers: MODEL_NUMBERS, tiers: TIERS }));
      }
      const f = tagFile(TAG);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(snap));
      check('快照写入 ' + path.relative(REPO, f), true, { chunks: Object.keys(snap.chunks).length, models: Object.keys(snap.models).length });
    } else {
      let before = null;
      if (AGAINST) {
        const f = tagFile(AGAINST);
        if (!fs.existsSync(f)) { console.log('没有快照 ' + f); code = 3; }
        else before = JSON.parse(fs.readFileSync(f, 'utf8'));
      }
      if (code !== 3) {
        if (want('snap')) await secSnap(page, before);
        if (want('model')) await secModel(page, before);
        if (want('drive')) await secDrive(page);
        if (want('obb')) await secObb(page);
        if (want('data')) await secData(page);
        if (want('ws')) await secWs(page);
      }
    }
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  }
  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail).slice(0, 400));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors.slice(0, 20)) console.log('  ' + e.slice(0, 400));
  console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (code !== 3) code = failed.length || errors.length ? 1 : 0;
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 15000))]);
  srv.close();
  process.exit(code);
}

// ---------- 各段（后面补全） ----------
// 出生块 (0,0)：叉车记录、fixture、保底车的几何 / 碎屑检查
function pageSpawnInfo({ seeds, quality }) {
  const T = window.__fl1, G = BR.L1forklift.geo;
  const q0 = BR.game.settings.quality;
  T.setQ(quality);
  const out = {};
  try {
    for (const seed of seeds) {
      const res = T.build(seed, 0, 0);
      const fl = (res.data.forklifts || []).map(f => JSON.parse(JSON.stringify(f)));
      const fixtures = ((res.kit && res.kit.fixtures) || []).filter(f => f.kind === 'vehicle').map(f => ({ key: f.key, skey: f.skey, label: f.label, why: f.why, solids: f.solids, n: f.n }));
      const count = {};
      res.group.traverse(m => { if (m.geometry && m.geometry.attributes.position) count[m.name] = m.geometry.attributes.position.count; });
      const prop = []; res.group.traverse(m => { if (m.name === 'kit:prop') prop.push(m.geometry.attributes.position.array); });
      const P = prop[0];
      const info = { forklifts: fl, fixtures, spawnBay: res.data.spawnBay || null, count, solids: [], body: 0, debris: 0, debrisNear: 0 };
      for (const f of fl) {
        const sd = res.solids[f.solid];
        info.solids.push(sd ? [sd.minX, sd.minZ, sd.maxX, sd.maxZ, sd.maxY] : null);
      }
      // 保底车：占地里（不外扩）0.1–2.5 m 高没有 kit:prop 顶点（区块几何里没有它）；外扩 0.2 m 以内 1.2–10 cm 高没有顶点（碎屑都躲开了）
      for (const f of fl) {
        if (!f.runtime || !P) continue;
        const c = Math.cos(f.rot), sn = Math.sin(f.rot);
        const rects = [[-G.half.x, G.half.x, -G.half.z, G.half.z], [-(G.tineX[1] + G.forkW / 2), G.tineX[1] + G.forkW / 2, G.forkZ[0], -G.half.z]];
        const dist = (x, z) => {
          const dx = x - f.lx, dz = z - f.lz, lx = c * dx - sn * dz, lz = sn * dx + c * dz;
          let best = Infinity;
          for (const [x0, x1, z0, z1] of rects) { const qx = Math.max(x0 - lx, 0, lx - x1), qz = Math.max(z0 - lz, 0, lz - z1); best = Math.min(best, Math.hypot(qx, qz)); }
          return best;
        };
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          if (y > 0.1 && y < 2.5 && dist(x, z) <= 0) info.body++;
          if (y > 0.012 && y <= 0.1) { const d = dist(x, z); if (d <= 0.2) info.debris++; else if (d <= 0.5) info.debrisNear++; }
        }
      }
      out[seed] = info;
      T.dispose(res);
    }
  } finally { T.setQ(q0); }
  return out;
}

async function secSnap(page, before) {
  const cur = {}, spawn = {};
  for (const q of ['high', 'low']) {
    for (let i = 0; i < SEEDS.length; i += 10) Object.assign(cur, await ev(page, pageSnapChunks, { seeds: SEEDS.slice(i, i + 10), quality: q }));
    spawn[q] = await ev(page, pageSpawnInfo, { seeds: SEEDS, quality: q });
  }
  // ---- 出生保底 ----
  const bad = { count: [], forced: [], natural: [], fixture: [], body: [], debris: [] };
  let nForced = 0, nNatural = 0;
  const inBay = f => f.x >= 12 && f.x <= 20 && f.z >= 12 && f.z <= 20;
  for (const q of ['high', 'low']) for (const seed of SEEDS) {
    const I = spawn[q][seed], fl = I.forklifts, mid = fl.filter(inBay);
    if (mid.length !== 1) { bad.count.push([seed, q, fl.map(f => [f.x, f.z])]); continue; }
    const f = mid[0];
    const fx = I.fixtures.find(x => x.key === f.key);
    const sd = I.solids[fl.indexOf(f)];
    if (f.key !== '1@0,0#v' + f.i || fl.indexOf(f) !== f.i) bad.forced.push([seed, q, 'key/i', f.key, f.i]);
    if (!fx || fx.skey !== '0,0#v' + f.i || fx.label !== '叉车' || fx.why !== '叉车太重，拖不动' || fx.solids[0] !== f.solid || fx.solids[1] !== f.solid + 1) bad.fixture.push([seed, q, f.key, fx]);
    if (!sd || Math.abs((sd[0] + sd[2]) / 2 - f.x) > 1e-6 || Math.abs((sd[1] + sd[3]) / 2 - f.z) > 1e-6 || Math.abs(sd[4] - 2.15) > 1e-9) bad.fixture.push([seed, q, 'solid', sd, f.x, f.z]);
    if (f.runtime) {
      nForced++;
      if (f.detail !== null || 'spans' in f || 'wearN' in f || f.tris !== 0) bad.forced.push([seed, q, 'fields', f]);
      if (I.body) bad.body.push([seed, q, I.body]);
      if (I.debris) bad.debris.push([seed, q, I.debris]);
      if (!I.spawnBay || !I.spawnBay.forced) bad.forced.push([seed, q, 'spawnBay', I.spawnBay]);
    } else {
      nNatural++;
      const sp = f.spans || {}, nProp = I.count['kit:prop'] || 0, nDec = I.count['kit:decal'] || 0;
      const okSpan = r => Array.isArray(r) && r[0] < r[1];
      const ok = f.runtime === false && typeof f.detail === 'string' && f.tris > 0 && okSpan(sp.prop) && sp.prop[1] <= nProp &&
        (sp.wear || []).every(r => okSpan(r) && r[1] <= nDec) && (sp.oil === null || (okSpan(sp.oil) && sp.oil[1] <= nDec)) &&
        (f.wearN > 0) === ((sp.wear || []).length > 0) && f.wearN >= 0 && f.wearN <= 9 && (q === 'low' ? f.wearN === 0 && sp.oil === null : true) &&
        typeof f.number === 'number' && f.number >= 1 && f.number <= 98 && Number.isFinite(f.lx) && Number.isFinite(f.lz);
      if (!ok) bad.natural.push([seed, q, f]);
    }
  }
  check('snap：' + SEEDS.length + ' 个种子 × 高低画质，出生块 (0,0) 中间柱间恰好一台叉车（自然 ' + nNatural + ' 次、保底 ' + nForced + ' 次）', bad.count.length === 0, bad.count.slice(0, 3));
  check('snap：叉车 key = \'1@0,0#v<i>\'，kit fixture（kind vehicle、label 叉车、why「叉车太重，拖不动」、显式 key、skey \'0,0#v<i>\'）正好包住 solid 下标那一个外接 AABB', bad.fixture.length === 0, bad.fixture.slice(0, 3));
  check('snap：保底车 runtime:true、detail null、没有 spans / wearN、tris 0、spawnBay.forced', bad.forced.length === 0, bad.forced.slice(0, 3));
  check('snap：保底车不在区块几何里（占地内 0.1–2.5 m 高没有 kit:prop 顶点）', bad.body.length === 0, bad.body.slice(0, 3));
  check('snap：保底触发的柱间没有一片碎屑落进叉车占地（含货叉）外扩 0.2 m 以内', bad.debris.length === 0, bad.debris.slice(0, 3));
  check('snap：自然叉车 runtime:false、有 detail / tris、spans.prop / wear / oil 落在累加器顶点数以内、wearN = 磨损片数（低画质 0、没有 oil）', bad.natural.length === 0, bad.natural.slice(0, 2));
  const hiTri = HIGH_TRI.filter(sd => SEEDS.includes(sd)).map(sd => {
    const I = spawn.high[sd], f = I.forklifts.find(inBay);
    return { seed: sd, tri: I.spawnBay && I.spawnBay.tri, cap: I.spawnBay && I.spawnBay.cap, runtime: !!(f && f.runtime), lowRuntime: !!((spawn.low[sd].forklifts.find(inBay) || {}).runtime) };
  });
  check('snap：「进柱间时 triCount ≥7300」的种子（' + hiTri.length + ' 个，至少 2 个）也有保底车', hiTri.length >= 2 && hiTri.every(h => h.tri >= 7300 && h.runtime && h.lowRuntime), hiTri);
  const nat = NATURAL.filter(sd => SEEDS.includes(sd)).map(sd => ({ seed: sd, runtime: (spawn.high[sd].forklifts.find(inBay) || {}).runtime }));
  check('snap：自然种子（12345 等）出生柱间照旧是区块里那台（不触发保底）', nat.every(n => n.runtime === false), nat);
  const s12 = spawn.high[12345] && spawn.high[12345].forklifts.find(inBay);
  if (s12) check('snap：种子 12345 出生块叉车在 (16.4, 16.91)、mid 档', Math.abs(s12.x - 16.4) < 0.01 && Math.abs(s12.z - 16.91) < 0.01 && s12.detail === 'mid', [s12.x, s12.z, s12.detail, s12.key]);

  // ---- 高低画质的 key 列表一致 ----
  const keyDiff = [];
  for (const seed of SEEDS) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const h = cur[seed + '|high|' + cx + ',' + cz], l = cur[seed + '|low|' + cx + ',' + cz];
    for (const k of ['props', 'fixtures', 'containers']) if (JSON.stringify(h[k]) !== JSON.stringify(l[k])) keyDiff.push([seed, cx, cz, k]);
    if (cx === 0 && cz === 0) {
      const hk = spawn.high[seed].forklifts.map(f => f.key), lk = spawn.low[seed].forklifts.map(f => f.key);
      if (JSON.stringify(hk) !== JSON.stringify(lk)) keyDiff.push([seed, 'forklift keys', hk, lk]);
    }
  }
  check('snap：高低画质的叉车 key、固定设备 key、自动道具 key、容器 key 列表逐项一致', keyDiff.length === 0, keyDiff.slice(0, 3));

  // ---- 和快照比 ----
  if (!before) { check('snap：没有快照，跳过和改动前的逐项比对', true); return; }
  const diffs = { other: [], spawnNat: [], keys: [] };
  let skipped = 0, compared = 0;
  const strip = c => ({ geo: c.geo, geoHash: c.geoHash, solids: c.solids, nSolids: c.nSolids, spawn: c.spawn, exits: c.exits, bays: c.bays, sector: c.sector,
    fk: c.fk, props: c.props, fixtures: c.fixtures.filter(f => f[1] !== 'vehicle'), containers: c.containers });
  for (const q of ['high', 'low']) for (const seed of SEEDS) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const k = seed + '|' + q + '|' + cx + ',' + cz, b0 = before.chunks[k], c = cur[k];
    if (!b0) continue;
    const spawnChunk = cx === 0 && cz === 0;
    const forced = spawnChunk && spawn[q][seed].forklifts.some(f => f.runtime);
    if (forced) { skipped++; continue; }
    compared++;
    const A = strip(b0), B = strip(c);
    const fields = Object.keys(A).filter(f => JSON.stringify(A[f]) !== JSON.stringify(B[f]));
    if (fields.length) (spawnChunk ? diffs.spawnNat : diffs.other).push([k, fields, fields.includes('geo') ? (A.geo.find((g, i) => JSON.stringify(g) !== JSON.stringify(B.geo[i])) || null) : null]);
  }
  check('snap：出生块以外的 8 块逐项和快照一致（几何逐字节、碰撞体、刷新点、出口、叉车、道具/设备/容器 key；比了 ' + compared + ' 块）', diffs.other.length === 0, diffs.other.slice(0, 3));
  check('snap：没触发保底的出生块（自然叉车 / 种子 12345）逐项和快照一致（跳过保底块 ' + skipped + ' 块）', diffs.spawnNat.length === 0, diffs.spawnNat.slice(0, 3));
  const k12 = [];
  for (const q of ['high', 'low']) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const k = 12345 + '|' + q + '|' + cx + ',' + cz;
    if (before.chunks[k] && JSON.stringify(strip(before.chunks[k])) !== JSON.stringify(strip(cur[k]))) k12.push(k);
  }
  check('snap：种子 12345 的 9 块（高低画质）全部逐字节一致', k12.length === 0 && !!before.chunks['12345|high|0,0'], k12);
}
async function secModel(page, before) {
  const cur = {};
  for (const q of ['high', 'low']) Object.assign(cur, await ev(page, pageModelHashes, { quality: q, numbers: MODEL_NUMBERS, tiers: TIERS }));
  if (!before || !before.models) { check("model：part='all' 顶点哈希（没有快照，只记录）", true, Object.keys(cur).length); return; }
  const diff = [];
  for (const k of Object.keys(before.models)) if (JSON.stringify(before.models[k]) !== JSON.stringify(cur[k])) diff.push({ k, before: before.models[k], now: cur[k] });
  check("model：forkliftModel part='all' 在 6 档 × 2 画质 × 5 个车号下的顶点哈希和快照逐位一致（" + Object.keys(before.models).length + " 份）", diff.length === 0 && Object.keys(before.models).length === TIERS.length * 2 * MODEL_NUMBERS.length, diff.slice(0, 3));
}
// ---------- 页面内：几何小工具（三角形、点到三角形距离）----------
function pageGeoTools() {
  const T = window.__fl1;
  // 建一份模型，返回 { tris: [[ax,ay,az,bx,by,bz,cx,cy,cz, matKey, segName]...], verts: {matKey: n}, segs: [[name, matKey, v0, v1]] }
  T.buildModel = (o, quality) => {
    const q0 = BR.game.settings.quality;
    if (quality) T.setQ(quality);
    try {
      const b = T.builder();
      const marks = [];
      const snap = () => { const m = {}; b._accs.forEach((a, k) => { if (a && a.pos) m[k] = a.n; }); return m; };
      let bevel = 0;
      const ob = b._bevelBox;
      b._bevelBox = function () { bevel++; return ob.apply(this, arguments); };
      BR.L1forklift.model(b, Object.assign({}, o, { seg: name => marks.push([name, snap()]) }));
      marks.push(['__end', snap()]);
      const segs = [];
      for (let i = 0; i + 1 < marks.length; i++) {
        const s0 = marks[i][1], s1 = marks[i + 1][1];
        for (const k of Object.keys(s1)) if ((s1[k] || 0) > (s0[k] || 0)) segs.push([marks[i][0], k, s0[k] || 0, s1[k]]);
      }
      const segOf = (k, v) => { for (const s of segs) if (s[1] === k && v >= s[2] && v < s[3]) return s[0]; return '?'; };
      const tris = [], verts = {};
      b._accs.forEach((a, k) => {
        if (!a || !a.pos || !a.idx) return;
        verts[k] = a.n;
        for (let i = 0; i < a.idx.length; i += 3) {
          const t = [];
          for (let j = 0; j < 3; j++) { const v = a.idx[i + j]; t.push(a.pos[v * 3], a.pos[v * 3 + 1], a.pos[v * 3 + 2]); }
          t.push(k, segOf(k, a.idx[i]), a.idx[i]);
          tris.push(t);
        }
      });
      return { b, tris, verts, segs, bevel, accs: b._accs };
    } finally { if (quality) T.setQ(q0); }
  };
  T.normal = t => {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  // 点 p 到三角形 (a, b, c) 的距离（Ericson, Real-Time Collision Detection 5.1.5）
  T.ptTri = (px, py, pz, t) => {
    const ax = t[0], ay = t[1], az = t[2], bx = t[3], by = t[4], bz = t[5], cx = t[6], cy = t[7], cz = t[8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const D = (x, y, z) => Math.hypot(px - x, py - y, pz - z);
    if (d1 <= 0 && d2 <= 0) return D(ax, ay, az);
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return D(bx, by, bz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return D(ax + v * abx, ay + v * aby, az + v * abz); }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return D(cx, cy, cz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return D(ax + w * acx, ay + w * acy, az + w * acz); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return D(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return D(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
  };
  // 线段 p→q 和三角形 t 相交（Möller–Trumbore，端点贴面 1e-7 以内不算）
  T.segTri = (p, q, t) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2], e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(a) < 1e-12) return false;
    const f = 1 / a, sx = p[0] - t[0], sy = p[1] - t[1], sz = p[2] - t[2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) return false;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) return false;
    const w = f * (e2x * qx + e2y * qy + e2z * qz);
    return w > 1e-7 && w < 1 - 1e-7;
  };
  // 两组三角形穿插（任一组的边穿过另一组的三角形）的次数
  T.crossings = (A, B) => {
    let n = 0;
    const edges = L => { const E = []; for (const t of L) for (const [i, j] of [[0, 3], [3, 6], [6, 0]]) E.push([[t[i], t[i + 1], t[i + 2]], [t[j], t[j + 1], t[j + 2]]]); return E; };
    for (const [p, q] of edges(A)) for (const t of B) if (T.segTri(p, q, t)) n++;
    for (const [p, q] of edges(B)) for (const t of A) if (T.segTri(p, q, t)) n++;
    return n;
  };
  T.bbox = list => { const m = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const t of list) for (let j = 0; j < 9; j += 3) for (let a = 0; a < 3; a++) { m[a] = Math.min(m[a], t[j + a]); m[a + 3] = Math.max(m[a + 3], t[j + a]); } return m; };
  // 一个颜色在累加器里存成什么（kit 可能做颜色空间换算）：建一个同色小盒子量
  T.storedColor = (col, key) => { const b = T.builder(); b.box(0, 0, 0, 0.1, 0.1, 0.1, key || 'kit:prop', { color: col, solid: false, uv: key === 'kit:glow' ? 'solid' : 'stretch' }); const a = b._accs.get(key || 'kit:prop'); return [a.col[0], a.col[1], a.col[2]]; };
}

// 可动模型：面数、货叉底面、后轮间隙、安全带、drvLow、kit:glow、拆部件 = all、levers、wear、driveTier
function pageDrive({ angles }) {
  const T = window.__fl1, F = BR.L1forklift, G = F.geo, out = {};
  const CASES = [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['drvLow', 'low']];
  // ① 每台 ≤2000 面（模型 + 最多的磨损）
  out.tris = {};
  for (const [detail, q] of CASES) {
    for (const levers of [0, 1, 2, 3]) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers }, q);
      const q0 = BR.game.settings.quality; T.setQ(q);
      const wn = F.wear(m.b, { detail, wearN: 99 });
      T.setQ(q0);
      let tri = 0; m.b._accs.forEach(a => { if (a && a.idx) tri += a.idx.length / 3; });
      out.tris[detail + '/' + levers] = { tri, wear: wn };
    }
  }
  // ② 货叉水平段底面：每根至少 2 个法线 y < −0.9 的三角形（升到顶也一样）；停着的车（drive 不开）没有
  // 另外量朝下那些三角形的总面积（水平段底面 0.1 × 0.92 ≈ 0.09 m²；叉尖下面那道 2.5 cm 的倒角也朝下，但面积只有 0.003）
  const area = t => { const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; };
  const forkDown = m => {
    const cnt = { forkL: 0, forkR: 0, areaL: 0, areaR: 0 };
    for (const t of m.tris) if ((t[10] === 'forkL' || t[10] === 'forkR') && T.normal(t)[1] < -0.9) {
      const zs = [t[2], t[5], t[8]];
      if (Math.min(...zs) >= G.forkZ[0] - 1e-6 && Math.max(...zs) <= G.forkZ[1] + 1e-6) { cnt[t[10]]++; cnt[t[10] === 'forkL' ? 'areaL' : 'areaR'] += area(t); }
    }
    cnt.areaL = +cnt.areaL.toFixed(4); cnt.areaR = +cnt.areaR.toFixed(4);
    return cnt;
  };
  out.forkDown = {};
  for (const [detail, q] of CASES) for (const lift of [0, 1]) out.forkDown[detail + '/lift' + lift] = forkDown(T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: 2, lift }, q));
  out.forkDownParked = forkDown(T.buildModel({ part: 'all', detail: 'mid', number: 88 }, 'high'));
  // ③ 后轮：0 到 ±maxSteer 每 5°（再加 ±maxSteer），轮胎顶点到车身三角形、车身顶点到轮胎三角形的最小距离
  out.wheel = {};
  for (const [detail, q] of CASES) {
    const parts = ['body', 'liftLever', 'wheelsFront', 'steeringWheel', 'mastOuter', 'mastInner', 'carriage', 'chains'];
    const body = [];
    for (const part of parts) for (const t of T.buildModel({ part, detail, number: 88, drive: true, levers: 2 }, q).tris) body.push(t);
    let worst = { d: Infinity };
    const crossings = [];
    for (const deg of angles) {
      const steer = deg === 'max' ? G.maxSteer : deg === '-max' ? -G.maxSteer : deg * Math.PI / 180;
      for (const part of ['wheelRearL', 'wheelRearR']) {
        const wt = T.buildModel({ part, detail, number: 88, drive: true, levers: 2, steer }, q).tris;
        const bb = T.bbox(wt), pad = 0.05;
        const near = body.filter(t => { const b2 = T.bbox([t]); return b2[3] > bb[0] - pad && b2[0] < bb[3] + pad && b2[4] > bb[1] - pad && b2[1] < bb[4] + pad && b2[5] > bb[2] - pad && b2[2] < bb[5] + pad; });
        const wv = []; for (const t of wt) for (let j = 0; j < 9; j += 3) wv.push([t[j], t[j + 1], t[j + 2]]);
        for (const p of wv) for (const t of near) { const d = T.ptTri(p[0], p[1], p[2], t); if (d < worst.d) worst = { d, deg, part, p, seg: t[10] }; }
        for (const t of near) for (let j = 0; j < 9; j += 3) for (const w of wt) { const d = T.ptTri(t[j], t[j + 1], t[j + 2], w); if (d < worst.d) worst = { d, deg, part, p: [t[j], t[j + 1], t[j + 2]], seg: t[10], dir: 'body→wheel' }; }
        // 光量距离不够：轮胎整个插进底盘箱子里时，顶点离箱子的面可能很远 —— 再查两组三角形有没有互相穿插
        const x = T.crossings(wt, near);
        if (x) crossings.push([deg, part, x]);
      }
    }
    worst.crossings = crossings;
    out.wheel[detail] = worst;
  }
  // 对照：停着的车的模型（drive 不开）后轮打 0.6 rad 就和车身穿插（说明可动模型的让开确实必要）
  {
    const body = T.buildModel({ part: 'body', detail: 'mid', number: 88 }, 'high').tris;
    const wt = T.buildModel({ part: 'wheelRearR', detail: 'mid', number: 88, steer: 0.6 }, 'high').tris;
    out.wheelParked = T.crossings(wt, body);
  }
  // ④ 安全带：橙色带子按连通分量数条数，截面（垂直于带子长度方向的最大尺寸）≥2 cm
  out.belts = {};
  const beltCol = T.storedColor([0.95, 0.42, 0.08]);
  for (const [detail, q] of CASES) {
    const m = T.buildModel({ part: 'body', detail, number: 88, drive: true, levers: 2 }, q);
    const a = m.accs.get('kit:prop'), tri = [];
    for (let i = 0; i < a.idx.length; i += 3) {
      const v = a.idx[i];
      if (Math.abs(a.col[v * 3] - beltCol[0]) < 1e-6 && Math.abs(a.col[v * 3 + 1] - beltCol[1]) < 1e-6 && Math.abs(a.col[v * 3 + 2] - beltCol[2]) < 1e-6) tri.push([a.idx[i], a.idx[i + 1], a.idx[i + 2]]);
    }
    // 按共用顶点位置做连通分量
    const key = v => [a.pos[v * 3], a.pos[v * 3 + 1], a.pos[v * 3 + 2]].map(x => Math.round(x * 1e5)).join(',');
    const par = tri.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
    const byPos = new Map();
    tri.forEach((t, i) => t.forEach(v => { const k = key(v); if (byPos.has(k)) par[find(i)] = find(byPos.get(k)); else byPos.set(k, i); }));
    const comps = new Map();
    tri.forEach((t, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); for (const v of t) comps.get(r).push([a.pos[v * 3], a.pos[v * 3 + 1], a.pos[v * 3 + 2]]); });
    const sizes = [];
    comps.forEach(pts => {
      let best = [0, null, null];
      for (const p of pts) for (const q2 of pts) { const d = Math.hypot(p[0] - q2[0], p[1] - q2[1], p[2] - q2[2]); if (d > best[0]) best = [d, p, q2]; }
      const L = best[0], dir = best[1] ? [(best[2][0] - best[1][0]) / L, (best[2][1] - best[1][1]) / L, (best[2][2] - best[1][2]) / L] : [1, 0, 0];
      const pr = pts.map(p => { const d = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; return [p[0] - dir[0] * d, p[1] - dir[1] * d, p[2] - dir[2] * d]; });
      let w = 0; for (const p of pr) for (const q2 of pr) w = Math.max(w, Math.hypot(p[0] - q2[0], p[1] - q2[1], p[2] - q2[2]));
      sizes.push({ len: +L.toFixed(3), section: +w.toFixed(4) });
    });
    out.belts[detail] = sizes;
  }
  // ⑤ drvLow：不调 _bevelBox、端面斜角 0、没有 kit:decal
  {
    const m = T.buildModel({ part: 'all', detail: 'drvLow', number: 88, drive: true, levers: 1 }, 'low');
    const q0 = BR.game.settings.quality; T.setQ('low'); F.wear(m.b, { detail: 'drvLow', wearN: 9 }); T.setQ(q0);
    const L = F.lod.drvLow;
    out.drvLow = { bevel: m.bevel, decalAcc: !!m.b._accs.get('kit:decal'), bev: L.bev, ch: L.ch, cwC: L.cwC, backC: L.backC, decals: L.decals, trim: !!L.trim, belt: L.belt, handle: L.handle, ears: L.ears };
    const mh = T.buildModel({ part: 'all', detail: 'lite', number: 88, drive: true, levers: 1 }, 'high');
    out.liteBevel = mh.bevel;
  }
  // ⑥ kit:glow：前大灯镜面 + 警示灯罩只在 glow 里；kit:prop 里没有镜面色 / 灯罩色；镜面离灯壳前脸 ≥2 mm（不共面）
  {
    const lens = T.storedColor([0.95, 0.94, 0.86]), amber = T.storedColor([1.05, 0.58, 0.1]);
    const has = (m, col) => { const a = m.accs.get('kit:prop'); let n = 0; for (let v = 0; v < a.n; v++) if (Math.abs(a.col[v * 3] - col[0]) < 1e-6 && Math.abs(a.col[v * 3 + 1] - col[1]) < 1e-6 && Math.abs(a.col[v * 3 + 2] - col[2]) < 1e-6) n++; return n; };
    out.glow = {};
    for (const [detail, q] of CASES) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: 2 }, q);
      const g = m.accs.get('kit:glow');
      const gl = m.tris.filter(t => t[9] === 'kit:glow');
      let gap = Infinity;
      for (const t of gl) {
        const n = T.normal(t);
        for (const u of m.tris) {
          if (u[9] === 'kit:glow') continue;
          const nu = T.normal(u);
          if (Math.abs(n[0] * nu[0] + n[1] * nu[1] + n[2] * nu[2]) < 0.999) continue;
          const d = Math.abs((u[0] - t[0]) * n[0] + (u[1] - t[1]) * n[1] + (u[2] - t[2]) * n[2]);
          // 只看投影重叠的
          const bt = T.bbox([t]), bu = T.bbox([u]);
          const ov = [0, 1, 2].every(a2 => Math.abs(n[a2]) > 0.9 || (bt[a2 + 3] > bu[a2] + 1e-4 && bu[a2 + 3] > bt[a2] + 1e-4));
          if (ov) gap = Math.min(gap, d);
        }
      }
      out.glow[detail] = { glowVerts: g ? g.n : 0, glowTris: gl.length, propLens: has(m, lens), propAmber: has(m, amber), minParallelGap: gap };
    }
    const mp = T.buildModel({ part: 'all', detail: 'mid', number: 88 }, 'high');
    out.glowParked = { glow: !!mp.accs.get('kit:glow'), propLens: has(mp, lens), propAmber: has(mp, amber) };
  }
  // ⑦ 拆开的部件拼起来 = 'all'（顶点多重集合一样），drive 开关两种都查
  out.parts = {};
  for (const drive of [false, true]) for (const [detail, q] of [['high', 'high'], ['lite', 'high'], [drive ? 'drvLow' : 'low', 'low']]) {
    const sig = list => list.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]).sort().join(';');
    const all = T.buildModel({ part: 'all', detail, number: 23, drive, levers: 2, lift: 0.4, steer: 0.3 }, q).tris;
    let parts = [];
    for (const part of ['body', 'liftLever', 'wheelsFront', 'wheelRearL', 'wheelRearR', 'steeringWheel', 'mastOuter', 'mastInner', 'carriage', 'chains']) parts = parts.concat(T.buildModel({ part, detail, number: 23, drive, levers: 2, lift: 0.4, steer: 0.3 }, q).tris);
    const lev = T.buildModel({ part: 'liftLever', detail, number: 23, drive, levers: 2 }, q).tris.length;
    const wr = T.buildModel({ part: 'wheelsRear', detail, number: 23, drive, steer: 0.3 }, q).tris.length;
    const wl = T.buildModel({ part: 'wheelRearL', detail, number: 23, drive, steer: 0.3 }, q).tris.length;
    out.parts[detail + (drive ? '/drive' : '')] = { same: sig(all) === sig(parts), all: all.length, parts: parts.length, lever: lev, rearBoth: wr, rearL: wl };
  }
  // ⑧ levers：drive 至少 1 根，按 levers 给的根数
  out.levers = {};
  for (const n of [0, 1, 2, 3]) {
    const m = T.buildModel({ part: 'all', detail: 'mid', number: 88, drive: true, levers: n }, 'high');
    const segs = m.segs.filter(sg => sg[0] === 'liftLever').length, other = m.tris.filter(t => t[10] === 'levers').length;
    out.levers[n] = { liftLever: segs, leverTris: other };
  }
  // ⑨ wear：截断到 wearN 和这一档的 decals − 1，跳过地上那滩油；part 'oil' 只画油；货叉刮痕跟着升
  {
    const q0 = BR.game.settings.quality; T.setQ('high');
    const W = (o) => { const b = T.builder(); const n = F.wear(b, o); const a = b._accs.get('kit:decal'); let ymax = -1; if (a) for (let v = 0; v < a.n; v++) ymax = Math.max(ymax, a.pos[v * 3 + 1]); return { n, ymax: +ymax.toFixed(3) }; };
    out.wear = { high9: W({ detail: 'high', wearN: 9 }), high99: W({ detail: 'high', wearN: 99 }), mid9: W({ detail: 'mid', wearN: 9 }), lite2: W({ detail: 'lite', wearN: 2 }),
      oil: W({ part: 'oil' }), carriageLift1: W({ detail: 'high', wearN: 9, part: 'carriage', lift: 1 }), drvLow: W({ detail: 'drvLow', wearN: 9 }) };
    T.setQ('low'); out.wear.lowQ = W({ detail: 'high', wearN: 9 }); T.setQ(q0);
  }
  // ⑩ driveTier
  out.tier = {};
  for (const q of ['high', 'low']) for (const p of ['high', 'mid', 'lite', 'low', 'lowb', 'min', null]) out.tier[q + '/' + p] = F.driveTier(q, p);
  out.frozen = Object.isFrozen(F) && Object.isFrozen(G) && Object.isFrozen(G.cab) && Object.isFrozen(F.lod) && Object.isFrozen(F.lod.drvLow) && Object.isFrozen(F.ladder);
  return out;
}

async function secDrive(page) {
  await ev(page, pageGeoTools);
  const angles = [];
  for (let d = 0; d <= 60; d += 5) { angles.push(d); if (d) angles.push(-d); }
  angles.push('max', '-max');
  const D = await ev(page, pageDrive, { angles });
  fs.writeFileSync(path.join(OUT, 'drive.json'), JSON.stringify(D, null, 1));
  const triBad = Object.entries(D.tris).filter(([, v]) => !(v.tri <= 2000));
  check('drive：可动模型（high/mid/lite 高画质、drvLow 低画质，杆数 0–3，加上最多的磨损贴花）每台 ≤2000 面', triBad.length === 0, Object.fromEntries(Object.entries(D.tris).filter(([k]) => k.endsWith('/2')).map(([k, v]) => [k, v.tri])));
  const fd = Object.entries(D.forkDown).filter(([, v]) => !(v.forkL >= 2 && v.forkR >= 2 && v.areaL >= 0.08 && v.areaR >= 0.08));
  check('drive：每根货叉水平段至少 2 个法线 y < −0.9 的三角形，朝下的面积盖满水平段（≥0.08 m²；4 档 × 落地 / 升到顶）', fd.length === 0, D.forkDown);
  check('drive：对照 —— 停着的车（drive 不开，part=all 不变）货叉水平段没有底面（朝下的只有叉尖倒角，面积 <0.01 m²）', D.forkDownParked.areaL < 0.01 && D.forkDownParked.areaR < 0.01, D.forkDownParked);
  const wb = Object.entries(D.wheel).filter(([, v]) => !(v.d >= 0.01 && v.crossings.length === 0));
  check('drive：后轮 0 到 ±maxSteer（1.13）每 5° 采样，轮胎顶点到车身三角形、车身顶点到轮胎三角形都 ≥1 cm，两组三角形没有穿插', wb.length === 0,
    Object.fromEntries(Object.entries(D.wheel).map(([k, v]) => [k, { d: +v.d.toFixed(4), deg: v.deg, part: v.part, seg: v.seg, crossings: v.crossings.slice(0, 3) }])));
  check('drive：对照 —— 停着的车的模型（drive 不开）后轮打 0.6 rad 和车身穿插', D.wheelParked > 0, D.wheelParked);
  const bb = Object.entries(D.belts).filter(([, v]) => !(v.length >= 2 && v.every(x => x.section >= 0.02)));
  check('drive：安全带 ≥2 条、每条截面 ≥2 cm（4 档）', bb.length === 0, D.belts);
  check('drive：drvLow = lite 去掉倒角和贴花：建模时 _bevelBox 调用 0 次、端面斜角 ch / cwC / backC 都是 0、没有 kit:decal 累加器、不砍面（trim 关）、有扶手 / 安全带 / 耳座',
    D.drvLow.bevel === 0 && !D.drvLow.decalAcc && D.drvLow.bev === false && D.drvLow.ch === 0 && D.drvLow.cwC === 0 && D.drvLow.backC === 0 && D.drvLow.decals === 0 && !D.drvLow.trim && D.drvLow.belt >= 1 && D.drvLow.handle >= 1 && D.drvLow.ears && D.liteBevel > 0, Object.assign({ liteBevel: D.liteBevel }, D.drvLow));
  const gb = Object.entries(D.glow).filter(([, v]) => !(v.glowTris > 0 && v.propLens === 0 && v.propAmber === 0 && v.minParallelGap >= 0.002));
  check('drive：前大灯镜面、警示灯罩只在 kit:glow 里（kit:prop 里没有它们的颜色），和别的面平行重叠时相距 ≥2 mm（不共面）；停着的车照旧在 kit:prop', gb.length === 0 && !D.glowParked.glow && D.glowParked.propLens > 0 && D.glowParked.propAmber > 0, { drive: D.glow, parked: D.glowParked });
  const pb = Object.entries(D.parts).filter(([, v]) => !(v.same && v.lever > 0 && v.rearL > 0 && v.rearL * 2 === v.rearBoth));
  check("drive：part 'body' + 'liftLever' + 'wheelsFront' + 'wheelRearL' + 'wheelRearR' + … 拼起来和 'all' 的三角形一模一样（drive 开关都查）；wheelsRear = L + R", pb.length === 0, D.parts);
  check('drive：levers 0/1/2/3 → 升降杆 1 根（drive 至少 1 根），其余操纵杆 0/0/1/2 根', D.levers[0].liftLever === 1 && D.levers[0].leverTris === 0 && D.levers[1].leverTris === 0 && D.levers[2].leverTris > 0 && D.levers[3].leverTris > D.levers[2].leverTris, D.levers);
  const W = D.wear;
  check('drive：wear 按 wearN 和这一档 decals−1 截断、跳过地上油渍；part oil 只画油；货叉刮痕跟着升；低画质 / drvLow 一片不画',
    W.high9.n === 9 && W.high99.n === 9 && W.mid9.n === 5 && W.lite2.n === 2 && W.oil.n === 1 && W.oil.ymax < 0.05 && W.carriageLift1.n === 2 && W.carriageLift1.ymax > 2.6 && W.drvLow.n === 0 && W.lowQ.n === 0, W);
  const tierWant = { 'high/high': 'high', 'high/mid': 'mid', 'high/lite': 'lite', 'high/low': 'lite', 'high/lowb': 'lite', 'high/min': 'lite', 'high/null': 'mid' };
  const tierBad = Object.entries(D.tier).filter(([k, v]) => k.startsWith('low/') ? v !== 'drvLow' : v !== tierWant[k]);
  check('drive：driveTier —— 低画质一律 drvLow；高画质 = 停放档（high/mid/lite），比 lite 粗用 lite，没建过原区块（null）用 mid', tierBad.length === 0, D.tier);
  check('drive：BR.L1forklift、geo（含 cab）、lod、ladder 都是冻结的', D.frozen === true, D.frozen);
}
// 14 个部件碰撞盒：覆盖（被盒子管的部件顶点都在盒子里）、贴合（每个盒子 6 个面离它管的顶点 ≤7 cm）、驾驶舱留空、眼点胸口点、24 个方向
function pageObb() {
  const T = window.__fl1, F = BR.L1forklift, G = F.geo, out = {};
  const NAMES = ['chassis', 'hood', 'counterweight', 'dash', 'postFL', 'postFR', 'postRL', 'postRR', 'roof', 'mastOuter', 'mastInner', 'carriage', 'forkL', 'forkR'];
  // 盒子管哪些部件的顶点（seg 名）；座椅、安全带、方向盘、转向柱、操纵杆在驾驶舱留空里，后视镜（只有 high 档的一块 9×10 cm 小镜子）不算
  const BOXED = new Set(['chassis', 'wheelsFront', 'hood', 'hose', 'counterweight', 'wheelRearL', 'wheelRearR', 'dash', 'postFL', 'postFR', 'postRL', 'postRR', 'roof', 'mastOuter', 'mastInner', 'chains', 'carriage', 'forkL', 'forkR', 'tilt']);
  const CASES = [['high', false, 'high'], ['mid', false, 'high'], ['lite', false, 'high'], ['low', false, 'low'], ['lowb', false, 'low'], ['min', false, 'low'],
    ['high', true, 'high'], ['mid', true, 'high'], ['lite', true, 'high'], ['drvLow', true, 'low']];
  const C = G.cab;
  const inCab = (x, y, z, e) => Math.abs(x) < C.x - e && ((z > C.z0 + e && z < C.zHood - e && y > C.yFloor + e && y < C.yTop - e) || (z > C.zHood + e && z < C.z1 - e && y > C.ySeat + e && y < C.yTop - e));
  const boxOf = o => [o.cx - o.hx, o.cy - o.hy, o.cz - o.hz, o.cx + o.hx, o.cy + o.hy, o.cz + o.hz];
  out.names = {};
  out.cover = { worst: 0, at: null, n: 0 };
  out.claim = {};
  out.cab = [];
  out.points = [];
  for (const lift of [0, 0.5, 1]) {
    const boxes = G.obbs(lift);
    out.names[lift] = boxes.map(o => o.name);
    const B = boxes.map(boxOf);
    // 驾驶舱留空：盒子和两段留空（脚下、座椅上方）都不相交
    const cabs = [[-C.x, C.yFloor, C.z0, C.x, C.yTop, C.zHood], [-C.x, C.ySeat, C.zHood, C.x, C.yTop, C.z1]];
    boxes.forEach((o, i) => { for (const c of cabs) { const b2 = B[i]; if ([0, 1, 2].every(a => b2[a + 3] > c[a] + 1e-9 && c[a + 3] > b2[a] + 1e-9)) out.cab.push([lift, o.name, c]); } });
    for (const [nm, p] of [['eye', G.eye], ['chest', G.seatChest]]) boxes.forEach((o, i) => { const b2 = B[i]; if (p.x > b2[0] && p.x < b2[3] && p.y > b2[1] && p.y < b2[4] && p.z > b2[2] && p.z < b2[5]) out.points.push([lift, nm, o.name]); });
    for (const [detail, drive, q] of CASES) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2, lift }, q);
      for (const t of m.tris) {
        if (!BOXED.has(t[10])) continue;
        for (let j = 0; j < 9; j += 3) {
          const x = t[j], y = t[j + 1], z = t[j + 2];
          if (inCab(x, y, z, 0)) continue;   // 伸进驾驶舱留空的那一点点（翼子板顶 0.62–0.665 的里沿、护顶后横梁底 2.04–2.05）：留空优先
          let best = Infinity, owner = -1;
          B.forEach((b2, i) => {
            const dx = Math.max(b2[0] - x, 0, x - b2[3]), dy = Math.max(b2[1] - y, 0, y - b2[4]), dz = Math.max(b2[2] - z, 0, z - b2[5]);
            const d = Math.hypot(dx, dy, dz);
            if (d < best) { best = d; owner = i; }
          });
          // 前翼子板顶面（0.62–0.665）：底盘盒的顶要让开驾驶舱脚下（地台 0.62），一个轴对齐的盒子没法只在两边抬高 —— 单独记
          if (t[10] === 'chassis' && y > C.yFloor + 1e-9) { out.fender = Math.max(out.fender || 0, best); continue; }
          // 配重后脸中间那块（|x| ≤ 0.3）：盒子后脸压在 1.276，让人从圆角斜着走过来时离模型 ≤7 cm（forklift.mjs D3）—— 中间凸出来的那点单独记
          if (t[10] === 'counterweight' && z > 1.276 + 1e-9 && Math.abs(x) <= 0.3 + 1e-9) { out.cwTail = Math.max(out.cwTail || 0, best); continue; }
          out.cover.n++;
          if (best > out.cover.worst) out.cover = { worst: best, at: [detail, drive, lift, t[10], +x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], n: out.cover.n };
          // 记到最近的那个盒子名下（在盒子里的算距离 0 的那个；几个盒子都含它就都记）
          B.forEach((b2, i) => {
            const e = 0.012;
            if (x < b2[0] - e || x > b2[3] + e || y < b2[1] - e || y > b2[4] + e || z < b2[2] - e || z > b2[5] + e) return;
            const k = boxes[i].name + '@' + lift, c2 = out.claim[k] || (out.claim[k] = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]);
            c2[0] = Math.min(c2[0], x); c2[1] = Math.min(c2[1], y); c2[2] = Math.min(c2[2], z); c2[3] = Math.max(c2[3], x); c2[4] = Math.max(c2[4], y); c2[5] = Math.max(c2[5], z);
          });
        }
      }
    }
    out['boxes' + lift] = boxes.map(o => [o.name].concat(boxOf(o).map(v => +v.toFixed(4))));
  }
  // 24 个水平方向：从 6 m 外朝车中心走（人高 0–1.8 m），先碰到盒子的距离 vs 先碰到模型三角形（投影到地面）的距离
  out.rays = {};
  for (const [detail, q] of [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['drvLow', 'low']]) {
    const drive = detail === 'drvLow';
    const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q);
    const boxes = G.obbs(0).map(boxOf).filter(b2 => b2[1] < 1.8 && b2[4] > 0);
    const tris = m.tris.filter(t => t[10] !== 'mirror' && Math.min(t[1], t[4], t[7]) < 1.8 && Math.max(t[1], t[4], t[7]) > 0.01);
    const rows = [];
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, ox = Math.sin(a) * 6, oz = Math.cos(a) * 6, dx = -Math.sin(a), dz = -Math.cos(a);
      let tb = Infinity;
      for (const b2 of boxes) {
        let t0 = -Infinity, t1 = Infinity;
        for (const [o, d, lo, hi] of [[ox, dx, b2[0], b2[3]], [oz, dz, b2[2], b2[5]]]) {
          if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
          let ta = (lo - o) / d, tc = (hi - o) / d;
          if (ta > tc) [ta, tc] = [tc, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tc);
        }
        if (t0 <= t1 && t0 < tb) tb = t0;
      }
      let tm = Infinity;
      for (const t of tris) for (const [i, j] of [[0, 3], [3, 6], [6, 0]]) {
        const ax = t[i], az = t[i + 2], bx = t[j], bz = t[j + 2], ex = bx - ax, ez = bz - az;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const tt = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
        if (u >= 0 && u <= 1 && tt > 0 && tt < tm) tm = tt;
      }
      rows.push([k * 15, +(tm - tb).toFixed(4)]);
    }
    out.rays[detail] = rows;
  }
  return out;
}

async function secObb(page) {
  await ev(page, pageGeoTools);
  const O = await ev(page, pageObb);
  fs.writeFileSync(path.join(OUT, 'obb.json'), JSON.stringify(O, null, 1));
  const want = ['chassis', 'hood', 'counterweight', 'dash', 'postFL', 'postFR', 'postRL', 'postRR', 'roof', 'mastOuter', 'mastInner', 'carriage', 'forkL', 'forkR'];
  check('obb：obbs(lift) 给出 14 个盒子，名字和顺序对', [0, 0.5, 1].every(l => JSON.stringify(O.names[l]) === JSON.stringify(want)), O.names[0]);
  check('obb：盒子管的部件（6 档 + 4 个可动档，lift 0 / 0.5 / 1）每个顶点都在某个盒子里（误差 ≤1.2 cm；伸进驾驶舱留空的那几点除外）', O.cover.worst <= 0.012, O.cover);
  check('obb：前翼子板顶面高出底盘盒（顶压在驾驶舱地台 0.62）不超过 4.6 cm', (O.fender || 0) <= 0.046, +(O.fender || 0).toFixed(4));
  check('obb：配重后脸中间凸出来的那块（|x| ≤ 0.3，后脸盒压在 1.276 让圆角处 ≤7 cm）伸出盒子不超过 2 cm', (O.cwTail || 0) <= 0.02, +(O.cwTail || 0).toFixed(4));
  // 贴合：每个盒子 6 个面离它管到的顶点包围盒 ≤7 cm
  const loose = [];
  for (const lift of [0, 0.5, 1]) for (const row of O['boxes' + lift]) {
    const [name, ...bx] = row, c = O.claim[name + '@' + lift];
    if (!c) { loose.push([name, lift, '没有顶点']); continue; }
    const gap = [c[0] - bx[0], c[1] - bx[1], c[2] - bx[2], bx[3] - c[3], bx[4] - c[4], bx[5] - c[5]].map(v => +v.toFixed(3));
    if (gap.some(v => v > 0.07)) loose.push([name, lift, gap]);
  }
  check('obb：每个盒子 6 个面离它管到的实际顶点包围盒都 ≤7 cm（尺寸是量出来的）', loose.length === 0, loose.slice(0, 4));
  check('obb：14 个盒子和驾驶舱留空（脚下 / 座椅上方）都不相交（lift 0 / 0.5 / 1）', O.cab.length === 0, O.cab.slice(0, 3));
  check('obb：司机眼点、座椅胸口点不在任何盒子里', O.points.length === 0, O.points);
  const rb = [];
  for (const [d, rows] of Object.entries(O.rays)) for (const [deg, g] of rows) if (!(g >= -0.02 && g <= 0.07)) rb.push([d, deg, g]);
  check('obb：车四周 24 个方向朝车走，先碰到盒子的地方离模型表面 ≤7 cm（也不会插进模型 >2 cm）', rb.length === 0, rb.length ? rb.slice(0, 6) : Object.fromEntries(Object.entries(O.rays).map(([k, v]) => [k, Math.max(...v.map(r => r[1]))])));
}
// overhead / vines / 营地
function pageData({ seeds, scan }) {
  const T = window.__fl1, U = BR.util, out = { chunks: [], hl: [], vines: [], sectors: {}, camp: [], side: { n: 0, kinds: {}, bad: [], hl: [], pillars: [], scanHl: [], scanLow: 0, jack: 0, jackBad: [] } };
  // 地牛（FE1 返修 r3）：两个条目带同一个 solid（地牛脚下那块 1 m 见方老碰撞体的世界坐标，叉车跳过它），要正好对上 res.solids 里的一块
  const jackCheck = (seed, cx, cz, res) => {
    const so = res.data.sideObs || [], js = so.filter(e => e.kind === 'jack');
    for (let i = 0; i < js.length; i += 2) {
      const a = js[i], b = js[i + 1], sd = a && a.solid;
      out.side.jack++;
      let why = null;
      if (!b || !Array.isArray(sd) || sd.length !== 6 || !Array.isArray(b.solid) || JSON.stringify(b.solid) !== JSON.stringify(sd)) why = 'solid 字段';
      else {
        const hit = (res.solids || []).filter(q => Math.abs(q.minX - sd[0]) < 1e-3 && Math.abs(q.minY - sd[1]) < 1e-3 && Math.abs(q.minZ - sd[2]) < 1e-3 && Math.abs(q.maxX - sd[3]) < 1e-3 && Math.abs(q.maxY - sd[4]) < 1e-3 && Math.abs(q.maxZ - sd[5]) < 1e-3);
        const leg = a.maxY < b.maxY ? a : b;
        if (hit.length !== 1) why = '对上 ' + hit.length + ' 块碰撞体';
        else if (Math.abs(sd[3] - sd[0] - 1) > 1e-3 || Math.abs(sd[5] - sd[2] - 1) > 1e-3 || Math.abs(sd[4] - sd[1] - 0.3) > 1e-3) why = '尺寸';
        else if (leg.cx < sd[0] || leg.cx > sd[3] || leg.cz < sd[2] || leg.cz > sd[5]) why = '叉腿不在它上面';
      }
      if (why && out.side.jackBad.length < 6) out.side.jackBad.push([seed, cx, cz, why]);
    }
  };
  // b.data.sideObs（车身高度上伸出来、没有碰撞体的东西，叉车当障碍）：字段合法
  const SIDE_KINDS = new Set(['plinth', 'guard', 'cabinet', 'extinguisher', 'switch', 'door', 'carton', 'jack', 'cone', 'sand', 'shrub', 'pipe', 'valve', 'gauge', 'lamp']);
  const sideBad = e => {
    const nums = ['cx', 'cz', 'hx', 'hz', 'rot', 'minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY'];
    if (!SIDE_KINDS.has(e.kind)) return 'kind ' + e.kind;
    if (!nums.every(k => Number.isFinite(e[k]))) return 'nan';
    if (!(e.minX < e.maxX && e.minZ < e.maxZ && e.minY < e.maxY && e.hx > 0 && e.hz > 0)) return 'size';
    if (e.cx < e.minX - 1e-6 || e.cx > e.maxX + 1e-6 || e.cz < e.minZ - 1e-6 || e.cz > e.maxZ + 1e-6) return 'center';
    if (e.round && !(e.r > 0 && e.r <= Math.max(e.maxX - e.minX, e.maxZ - e.minZ) / 2 + 1e-6)) return 'round r';
    // 外接框要包住它的真实形状（转过角度的 OBB、竖圆柱）
    const ex = e.round ? e.r : Math.abs(e.hx * Math.cos(e.rot)) + Math.abs(e.hz * Math.sin(e.rot)), ez = e.round ? e.r : Math.abs(e.hx * Math.sin(e.rot)) + Math.abs(e.hz * Math.cos(e.rot));
    if (e.cx - ex < e.minX - 2e-3 || e.cx + ex > e.maxX + 2e-3 || e.cz - ez < e.minZ - 2e-3 || e.cz + ez > e.maxZ + 2e-3) return 'aabb';
    if (e.minY < -0.01 || e.maxY > 2.6) return 'y';
    return null;
  };
  const SLOTS = [6.4, 9.6, 14.4, 17.6, 22.4, 25.6], KINDS = new Set(['beam', 'lamp', 'pipe', 'valve', 'gauge', 'tray', 'cable', 'drip', 'arch']);
  // 照 L1.js 的 pipeLines 再算一遍（同一条派生流、同样的取数顺序）
  const pipeLines = (seed, axis, idx) => {
    const r = U.rng(seed, 'L1-pipes-' + axis, idx), n = r() < 0.55 ? 2 : 1, res = [];
    let s0 = -1;
    for (let k = 0; k < n; k++) {
      let sl = Math.floor(r() * SLOTS.length);
      if (sl === s0) sl = (sl + 3) % SLOTS.length;
      s0 = sl;
      const rr = [0.05, 0.065, 0.085][Math.floor(r() * 3)];
      r();   // 颜色
      res.push({ pos: SLOTS[sl], r: rr, twin: r() < 0.5, valve: Math.floor(r() * 4) });
    }
    return res;
  };
  const q0 = BR.game.settings.quality;
  const near = (a, b2) => Math.abs(a - b2) < 1e-3;
  try {
    // ① 出生 3×3：每块 beam / lamp，管子和 pipeLines 一一对上，高低画质一样
    for (const seed of seeds) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
      const per = {};
      for (const q of ['high', 'low']) {
        T.setQ(q);
        const res = T.build(seed, cx, cz);
        per[q] = JSON.stringify(res.data.overhead || null);
        per[q + 'Side'] = JSON.stringify(res.data.sideObs || null);
        if (q === 'high') {
          const so = res.data.sideObs;
          if (!Array.isArray(so)) out.side.bad.push([seed, cx, cz, 'no sideObs']);
          else for (const e of so) { out.side.n++; out.side.kinds[e.kind] = (out.side.kinds[e.kind] || 0) + 1; const b = sideBad(e); if (b && out.side.bad.length < 8) out.side.bad.push([seed, cx, cz, e.kind, b]); }
          jackCheck(seed, cx, cz, res);
          // 每根柱子（0.9 × 0.9 × 4 的方柱碰撞体）都记了柱脚：柱脚条目数 = 柱子数
          const pil = (res.solids || []).filter(b => Math.abs((b.maxX - b.minX) - (b.maxZ - b.minZ)) < 0.05 && b.maxX - b.minX > 0.6 && b.maxX - b.minX < 1.0 && b.maxY - b.minY > 3.4).length;
          const pl = (so || []).filter(e => e.kind === 'plinth').length;
          if (pil !== pl) out.side.pillars.push([seed, cx, cz, pil, pl]);
          const oh = res.data.overhead || [], ox = cx * 32, oz = cz * 32, levelSeed = U.hashInts(seed >>> 0, '1');
          const beams = oh.filter(o => o.kind === 'beam' && !o.sub), lamps = oh.filter(o => o.kind === 'lamp');   // sub 'portal' 是 Level 2 走廊口的顶板
          const bad = [];
          if (beams.length !== 8 || !beams.every(o => near(o.y, 3.55))) bad.push('beam');
          if (lamps.length !== 16 || !lamps.every(o => Math.abs(o.y - 3.14) < 0.005)) bad.push('lamp');
          if (!oh.every(o => KINDS.has(o.kind) && [o.minX, o.maxX, o.minZ, o.maxZ, o.y].every(Number.isFinite) && o.minX < o.maxX && o.minZ < o.maxZ && o.y > 2 && o.y < 4)) bad.push('fields');
          const mains = oh.filter(o => o.kind === 'pipe' && o.sub === 'main');
          let want = 0;
          for (const axis of ['x', 'z']) for (const P of pipeLines(levelSeed, axis, axis === 'x' ? cz : cx)) {
            want++;
            const y = (axis === 'x' ? 3.42 : 3.2) - P.r;
            const hit = mains.filter(o => o.axis === axis && near(o.pos, P.pos) && near(o.r, P.r) && near(o.y, y) &&
              (axis === 'x' ? near(o.minX, ox) && near(o.maxX, ox + 32) && near(o.minZ, oz + P.pos - P.r) && near(o.maxZ, oz + P.pos + P.r)
                : near(o.minZ, oz) && near(o.maxZ, oz + 32) && near(o.minX, ox + P.pos - P.r) && near(o.maxX, ox + P.pos + P.r)));
            if (hit.length !== 1) bad.push('pipe ' + axis + ' ' + P.pos);
            const twins = oh.filter(o => o.kind === 'pipe' && o.sub === 'twin' && o.axis === axis && near(o.pos, P.pos));
            if (twins.length !== (P.twin ? 1 : 0)) bad.push('twin ' + axis + ' ' + P.pos);
            const valves = oh.filter(o => o.kind === 'valve' && o.axis === axis && near(o.pos, P.pos));
            const vx = (axis === 'x' ? ox : oz) + 4 + P.valve * 8;
            if (valves.length !== 1 || !near(valves[0].y, y - 0.19) || !(axis === 'x' ? near((valves[0].minX + valves[0].maxX) / 2, vx) : near((valves[0].minZ + valves[0].maxZ) / 2, vx))) bad.push('valve ' + axis + ' ' + P.pos);
            const clamps = oh.filter(o => o.kind === 'pipe' && o.sub === 'clamp' && o.axis === axis && near(o.pos, P.pos));
            if (clamps.length !== 4 || !clamps.every(o => near(o.y, y - 0.02))) bad.push('clamp ' + axis + ' ' + P.pos);
          }
          if (mains.length !== want) bad.push('mains ' + mains.length + '/' + want);
          if (!oh.some(o => o.kind === 'tray' && near(o.y, 3.35))) bad.push('tray');
          out.chunks.push({ seed, cx, cz, n: oh.length, bad, sector: res.data.sector });
        }
        T.dispose(res);
      }
      if (per.high !== per.low) out.hl.push([seed, cx, cz]);
      if (per.highSide !== per.lowSide) out.side.hl.push([seed, cx, cz]);
    }
    // ② 各区段（扫一圈找）：花园段藤蔓、传说段电缆、哥特段拱、天鹰段漏水管
    T.setQ('high');
    // kit:prop 里梁底 3.55 附近、颜色是藤叶色（C.leaf 乘 0.8–1.2：存进去的颜色 g/r、g/b 比例不变）的顶点数（每根藤蔓顶上一圈 8 个）。
    // 绿漆的管子法兰顶也会碰到 3.52 以上，按比例分得开
    const leaf = T.storedColor([0.24, 0.42, 0.2]), LGR = leaf[1] / leaf[0], LGB = leaf[1] / leaf[2];
    const greenTop = res => {
      let n = 0;
      res.group.traverse(m => {
        if (m.name !== 'kit:prop') return;
        const P = m.geometry.attributes.position.array, Cc = m.geometry.attributes.color, Ca = Cc.array, k = Cc.itemSize;
        for (let v = 0; v < P.length / 3; v++) {
          const y = P[v * 3 + 1], r = Ca[v * k], g = Ca[v * k + 1], bl = Ca[v * k + 2];
          if (y > 3.52 && y < 3.58 && Math.abs(g / r - LGR) < 0.03 * LGR && Math.abs(g / bl - LGB) < 0.03 * LGB) n++;
        }
      });
      return n;
    };
    const lowCheck = [];
    for (const [seed, cx, cz] of scan) {
      const res = T.build(seed, cx, cz), sec = res.data.sector, oh = res.data.overhead || [];
      // 有柱脚、护角、消火栓箱以外条目的块（地牛、纸箱、路锥、砂堆、灌木、走廊口管排……）：后面再用低画质建一遍比 sideObs
      const so = res.data.sideObs || [];
      for (const e of so) { const b = sideBad(e); if (b && out.side.bad.length < 8) out.side.bad.push([seed, cx, cz, e.kind, b]); }
      jackCheck(seed, cx, cz, res);
      if (so.some(e => !['plinth', 'guard', 'cabinet'].includes(e.kind)) && lowCheck.length < 48) lowCheck.push([seed, cx, cz, JSON.stringify(so)]);
      const S2 = out.sectors[sec] || (out.sectors[sec] = { n: 0, cable: 0, cableMin: 9, arch: 0, archMin: 9, drip: 0, vines: 0 });
      S2.n++;
      out.extra = out.extra || { portal: [], duct: [] };
      for (const o of oh) if (o.sub === 'portal' || o.sub === 'duct') out.extra[o.sub].push(o.y);
      for (const o of oh) {
        if (o.kind === 'cable') { S2.cable++; S2.cableMin = Math.min(S2.cableMin, o.y); }
        if (o.kind === 'arch') { S2.arch++; S2.archMin = Math.min(S2.archMin, o.y); }
        if (o.kind === 'drip') S2.drip++;
      }
      if (sec === 'garden') {
        const vs = res.data.vines || [];
        let pc = 0; res.group.traverse(m => { if (m.name === 'kit:prop') pc = m.geometry.attributes.position.count; });
        const P = []; res.group.traverse(m => { if (m.name === 'kit:prop') P.push(m.geometry.attributes.position.array); });
        let okV = Array.isArray(res.data.vines);
        let prevEnd = -1;
        for (const v of vs) {
          if (!(v.v[0] < v.v[1] && v.v[1] <= pc && v.v[0] >= prevEnd && v.mat === 'kit:prop' && v.r === 0.018 && v.top[1] === 3.55 && v.bot[1] < 3.0)) okV = false;
          prevEnd = v.v[1];
          // 这一段的顶点都在 top→bot 这根细杆旁边（离中线 ≤ r·√2 + 1 mm）
          const A = v.top, B2 = v.bot, d = [B2[0] - A[0], B2[1] - A[1], B2[2] - A[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          for (let i = v.v[0]; i < v.v[1]; i++) {
            const x = P[0][i * 3] + cx * 32, y = P[0][i * 3 + 1], z = P[0][i * 3 + 2] + cz * 32;
            const t = Math.max(0, Math.min(1, ((x - A[0]) * d[0] + (y - A[1]) * d[1] + (z - A[2]) * d[2]) / L2));
            const dist = Math.hypot(x - A[0] - d[0] * t, y - A[1] - d[1] * t, z - A[2] - d[2] * t);
            if (dist > v.r * Math.SQRT2 + 0.001) okV = false;
          }
        }
        const gt = greenTop(res);
        S2.vines += vs.length;
        out.vines.push({ seed, cx, cz, n: vs.length, greenTop: gt, ok: okV && gt === 8 * vs.length });
      }
      T.dispose(res);
    }
    T.setQ('low');
    for (const [seed, cx, cz, hi] of lowCheck) {
      const res = T.build(seed, cx, cz);
      out.side.scanLow++;
      if (JSON.stringify(res.data.sideObs || []) !== hi) out.side.scanHl.push([seed, cx, cz]);
      for (const e of (res.data.sideObs || [])) out.side.kinds[e.kind + '@scan'] = (out.side.kinds[e.kind + '@scan'] || 0) + 1;
      T.dispose(res);
    }
    // ③ 营地（BR.L1room）：没有 overhead、vines、叉车、保底
    for (const q of ['high', 'low']) {
      T.setQ(q);
      for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
        let res = null;
        try { res = T.build(12345, cx, cz, 'coopcamp'); } catch (e) { out.camp.push([q, cx, cz, 'error ' + e.message]); continue; }
        const d = res.data || {};
        if (d.overhead || d.vines || (d.forklifts && d.forklifts.length) || d.spawnBay || (d.sideObs && d.sideObs.length)) out.camp.push([q, cx, cz, Object.keys(d)]);
        T.dispose(res);
      }
    }
  } finally { T.setQ(q0); }
  return out;
}

async function secData(page) {
  await ev(page, pageGeoTools);
  const seeds = SEEDS.slice(0, 10);
  // 找各区段的块：几个种子 × 一圈区块（只为覆盖到花园 / 传说 / 哥特 / 天鹰）
  const scan = [];
  for (const seed of [12345, 1, 2, 3]) for (let cz = -6; cz <= 6; cz += 2) for (let cx = -6; cx <= 6; cx += 2) scan.push([seed, cx, cz]);
  const D = await ev(page, pageData, { seeds, scan });
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(D, null, 1));
  const bad = D.chunks.filter(c => c.bad.length);
  check('data：L1 出生 3×3 × ' + seeds.length + ' 个种子，每块都有 8 条主梁（底 3.55）、16 盏吊灯（约 3.14）、桥架 3.35 的头顶条目；管子（管身 / 并排细管 / 托码 / 阀门手轮）和 pipeLines 一一对上', bad.length === 0 && D.chunks.length === seeds.length * 9, bad.slice(0, 3));
  check('data：高低画质的 overhead 逐项一样', D.hl.length === 0, D.hl.slice(0, 3));
  const S = D.sectors;
  check('data：传说段电缆分段记进 overhead（最低约 2.3）、哥特段拱按 0.25 m 一段切成台阶盒（最低 2.5）、天鹰段漏水管', !!S.legend && S.legend.cable > 0 && S.legend.cableMin > 2.2 && S.legend.cableMin < 2.4 &&
    !!S.gothic && S.gothic.arch >= 6 * 20 && S.gothic.archMin >= 2.49 && !!S.tianying && S.tianying.drip > 0, S);
  const vb = D.vines.filter(v => !v.ok);
  check('data：花园段 vines 条数 = 实际画出来的藤蔓数（梁底绿色顶点 8 个一根），v 段落在 kit:prop 顶点数以内、段里的顶点都在那根藤上（' + D.vines.length + ' 块、' + D.vines.reduce((a, v) => a + v.n, 0) + ' 根）',
    D.vines.length >= 2 && vb.length === 0 && D.vines.some(v => v.n > 0), vb.length ? vb.slice(0, 3) : D.vines.slice(0, 4));
  check('data：营地（BR.L1room，高低画质 3×3 块）没有 overhead、vines、sideObs、叉车、保底车', D.camp.length === 0, D.camp.slice(0, 3));
  const SD = D.side;
  check('data：sideObs 每块都有、条目字段合法（种类认得、数值有限、外接框包住真实形状 / 圆、离地 0–2.6 m；出生 3×3 共 ' + SD.n + ' 条）', SD.bad.length === 0 && SD.n > 0, { bad: SD.bad, kinds: SD.kinds });
  check('data：每根柱子都记了柱脚（出生 3×3 × ' + seeds.length + ' 个种子，柱脚条目数 = 方柱碰撞体数）', SD.pillars.length === 0, SD.pillars.slice(0, 4));
  check('data：高低画质的 sideObs 逐项一样（出生 3×3 × ' + seeds.length + ' 个种子，加扫到的 ' + SD.scanLow + ' 块有地牛 / 纸箱 / 路锥 / 灌木 / 走廊口的块）——两边联机看到的车撞上的东西一样',
    SD.hl.length === 0 && SD.scanHl.length === 0 && SD.scanLow >= 10, { hl: SD.hl.slice(0, 3), scanHl: SD.scanHl.slice(0, 3), kinds: SD.kinds });
  check('data：每台地牛的两个 sideObs 条目带同一个 solid，正好对上 res.solids 里地牛脚下那块 1 m × 0.3 m × 1 m 的老碰撞体（' + SD.jack + ' 台）—— 叉车按它跳过老碰撞体、按地牛真实形状挡',
    SD.jack > 0 && SD.jackBad.length === 0, { n: SD.jack, bad: SD.jackBad });
  const X = D.extra || { portal: [], duct: [] };
  check('data：扫到的 Level 2 走廊口顶板（底 2.8）、风管出口顶上的横风管（底 3.55）也记进 overhead', X.portal.every(y => Math.abs(y - 2.8) < 1e-6) && X.duct.every(y => Math.abs(y - 3.55) < 1e-6), { portal: X.portal.length, duct: X.duct.length });
}

// 工坊低画质：最重的两台叉车块（种子 289 区块 3,0 等，扫 400 个种子找的）加 3 个出口，整块 ≤8000（高画质 ≤10000）
const WS_CASES = [[289, 3, 0], [359, -1, 3], [70, -1, -1], [14, -3, -1], [311, 2, 3]];
function pageWs({ cases }) {
  const T = window.__fl1, U = BR.util, out = { rows: [], spawnWs: null };
  const triOf = res => { let n = 0; res.group.traverse(m => { const g = m.isMesh && m.geometry, P = g && g.attributes.position; if (P) n += (g.index ? g.index.count : P.count) / 3 * (m.isInstancedMesh ? m.count : 1); }); return n; };
  const q0 = BR.game.settings.quality;
  try {
    for (const q of ['low', 'high']) {
      T.setQ(q);
      for (const [seed, cx, cz] of cases) {
        BR.workshop.deactivate();
        const r0 = T.build(seed, cx, cz);
        const plain = { tri: triOf(r0), det: (r0.data.forklifts || []).map(f => f.detail) };
        T.dispose(r0);
        for (const kind of ['door', 'stairs', 'elevator', 'zone']) {
          const m = BR.workshop.create('1', 'fe1-ws');
          m.seed = seed;
          m.exits.added = [[2, 2], [30, 2], [2, 30]].map((p, i) => ({ id: 'wex_fe1_' + i, to: '0', kind, x: cx * 32 + p[0], z: cz * 32 + p[1], rot: 0 }));
          BR.workshop.activate(m, { editing: false });
          const res = T.build(seed, cx, cz);
          const fl = res.data.forklifts || [];
          out.rows.push({ q, seed, cx, cz, kind, tri: triOf(res), plain, det: fl.map(f => f.detail), runtime: fl.map(f => !!f.runtime),
            fixtures: ((res.kit && res.kit.fixtures) || []).filter(f => f.kind === 'vehicle').length, exits: (res.exits || []).length, spawnBay: !!res.data.spawnBay });
          T.dispose(res);
          BR.workshop.deactivate();
        }
      }
    }
    // 工坊地图里出生块不放保底车
    T.setQ('high');
    const m = BR.workshop.create('1', 'fe1-ws0'); m.seed = 85;
    BR.workshop.activate(m, { editing: false });
    const r1 = T.build(85, 0, 0);
    out.spawnWs = { forklifts: (r1.data.forklifts || []).length, spawnBay: r1.data.spawnBay || null };
    T.dispose(r1);
    BR.workshop.deactivate();
  } finally { T.setQ(q0); BR.workshop.deactivate(); }
  return out;
}

async function secWs(page) {
  const R = await ev(page, pageWs, { cases: WS_CASES });
  fs.writeFileSync(path.join(OUT, 'ws.json'), JSON.stringify(R, null, 1));
  const rows = R.rows;
  const over = rows.filter(r => r.tri > (r.q === 'low' ? 8000 : 10000));
  check('ws：工坊低画质两台叉车的块加 3 个出口（门 / 楼梯 / 电梯 / 区域）≤8000，高画质 ≤10000（' + rows.length + ' 种）', over.length === 0,
    over.length ? over.slice(0, 4) : rows.filter(r => r.q === 'low').map(r => [r.seed, r.kind, r.tri, r.det.join('/')]).slice(0, 8));
  const keep = rows.filter(r => r.fixtures !== 2 || r.runtime.length !== 2 || r.runtime.some((rt, i) => rt ? r.det[i] !== null : !r.det[i]));
  check('ws：放不下的叉车改成运行时车（runtime:true、detail null），两台车的记录和 fixture 都还在', keep.length === 0, keep.slice(0, 3));
  const zone = rows.filter(r => r.kind === 'zone' && JSON.stringify(r.det) !== JSON.stringify(r.plain.det));
  check('ws：「区域」出口不占面数，叉车的档和不在工坊时一样（不白留额度）', zone.length === 0, zone.slice(0, 3));
  check('ws：工坊地图里出生块不放保底车', R.spawnWs && R.spawnWs.spawnBay === null && R.spawnWs.forklifts === 0, R.spawnWs);
}

main();
