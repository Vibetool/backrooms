// 后室 · L1 叉车数据与可动模型测试（FE1-L1）：node tests/forklift_l1.mjs [--tag <名> | --against <名>] [--quick] [--only snap,model,drive,obb,data,ws,polish,k12] [--root <目录>]
//
// 起本地静态服务（随机端口）+ 系统 Chrome（SwiftShader），page.route 拦截 api.ovobot.ai 回假响应、其余外站一律掐掉。
// 不进游戏：直接拿 BR.levels.get('1').buildChunk 按种子生成区块（levelSeed = U.hashInts(seed, '1')，和 world.js 一样），
// 画质靠 BR.game.settings.quality 切换。
//
//   --tag <名>      改动前拍快照到 tests/output/golden-tags/<名>/forklift_l1.json：50 个种子 × 高低画质 × L1 出生 3×3 块的
//                   几何（每个 mesh 的顶点/法线/UV/颜色/索引逐字节哈希）、碰撞体、刷新点、出口、b.data.forklifts、res.kit 的 key 列表；
//                   另加 forkliftModel part='all' 在 4 个停放档 × 2 画质 × 5 个车号下的顶点哈希。
//                   改动前的 L1.js 没有 BR.L1forklift：本测试起的静态服务在 L1.js 的 IIFE 末尾挂一行 BR.__fkProbe（只读出私有函数，不改函数体）
//   --against <名>  改动后拿快照比对（见下面 snap / model 两段）
//   --quick         只跑 10 个种子（QUICK）
//   --root <目录>   静态服务的根目录（缺省是本仓库；拍改动前的快照时可以指向 git archive 导出的那一版）
//   --only          只跑其中几段：
//     snap   出生保底 + 区块逐项比对：(0,0) 中间柱间恰好一台叉车（自然的或保底的）；出生块里所有的车（返修 FE1Q · J2）runtime:true、
//            key '1@0,0#v<i>'、没有 spans、区块几何里没有它；保底车的碎屑不落进占地外扩 0.2 m；HIGH_TRI 里的种子也有保底车；
//            出生块以外停着的车有 spans；(0,0) 以外的块逐项和快照一致；种子 12345 的 9 块全部一致（J2 以前拍的快照不比出生块）；
//            高低画质的叉车 key、固定设备 key、自动道具 key 一致；快照有 geoNoFk 时，所有块（含出生块）去掉停着的车那几段以后逐字节一致；
//            返修 FE1R · K3：停放档只剩 high / mid / lite / low，按 low 都放不下的块从最后一台起改成运行时车（K3FIX，出生 3×3 以外的 EXTRA_BLOCKS 另外建进来）
//     model  part='all' 的顶点哈希和快照逐位一致（4 档 × 2 画质 × 5 个车号）
//     drive  可动模型：每台 ≤2000 面；货叉水平段朝下的三角形；后轮 0 到 ±maxSteer 每 5° 离车身 ≥1 cm；安全带 ≥2 条、截面 ≥2 cm；
//            drvLow 不调 _bevelBox、端面斜角 0、没有 kit:decal；前大灯镜面和警示灯罩只在 kit:glow 里；拆出来的部件拼起来 = 'all'
//     obb    obbs(lift) 的 14 个盒子：和各部件实际顶点的包围盒对照、和驾驶舱空当不相交、眼点胸口点不在盒子里、24 个方向上离模型表面 ≤7 cm
//     data   overhead（每块 beam 3.55、lamp 3.14；管子和 pipeLines 一一对上；高低画质一样）、花园段 vines、营地（BR.L1room）不写这些也不放保底车；
//            sideObs（FE1 返修 r2）：字段合法、每根柱子有柱脚、高低画质逐项一样（出生 3×3 加扫到的有地牛 / 纸箱 / 路锥 / 走廊口的块）、营地不写；
//            地牛两个条目的 solid 正好对上 res.solids 里它脚下那块老碰撞体（返修 r3）
//     ws     工坊低画质：两台叉车的块加 3 个出口 ≤8000
//     polish H1–H5、J、K3–K12、M-gaps、M-fork 的模型检查，K3 / K5 停着 vs 开过逐像素（有电、断电各一遍，返修 FE1R · repair-r1）
//     k12    K12 背面探针（返修 FE1R · repair-r1）：停放 4 档 + 可动 4 档（升降、满舵）× 2400 多个机位软光栅，0 漏光
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
// 返修 FE1R · K3（主会话裁定）：停放档只剩 high / mid / lite / low，所有台按 low 都放不下时，从最后一台起改成运行时车。
// FE1Q 普查（stage-FE1Q/repair-r3/logs/tiers-after.json，101 个种子 × 5×5 块）里用过 lowb 的块，按 FE1R 普查（stage-FE1R/FE1R-model/logs/census-*.json）
// 现在这块的车：[种子, 画质, cx, cz, 车（null = 运行时车）]。出生 3×3 以外的块另外建进 snap（EXTRA_BLOCKS），快照里有它们以后也逐项比
// 返修 FE1R · repair-r1：铜阀门、中心盖、铭牌、散热缝、第 3 道百叶补回来以后（停放 high / mid 2000、lite 1968、low 1927 面）重新普查
// （stage-FE1R/repair-r1/logs/census-r1.json、tier-changes-FE1R-to-r1.txt），又有 6 块换了档：后 6 条
// 返修 FE1R · repair-r2：补回第 2 根操纵杆、助力球、左边车号、前轮轮毂盖（贴图），座椅各档倒圆（停放 high / mid 2001、lite 1995、low 1963 面，
// 按普查的口径含贴花）以后再普查（stage-FE1R/repair-r2/logs/census-r2.json、tier-changes-r1-to-r2.json）：高画质 4 块、低画质 6 块换了档 ——
// 87 高 (0,−2) lite → low、77 低 (−2,−2) low,运行时 → 运行时,运行时；新加后 9 条
const K3FIX = [[87, 'high', 0, -2, ['low', null]], [12345, 'high', 2, -2, [null, null]], [6, 'low', 1, -1, [null]], [21, 'low', 0, 2, [null]],
  [77, 'low', -2, -2, [null, null]], [78, 'low', -1, 2, [null]], [80, 'low', -2, 1, ['low', null]], [81, 'low', -1, 2, [null]], [89, 'low', -2, 1, [null]], [12345, 'low', 2, -2, [null, null]],
  [12, 'high', 1, 1, ['low']], [26, 'high', -1, -2, [null]], [56, 'high', -1, 2, [null]], [70, 'high', -2, 0, ['high', null]], [81, 'high', 2, 0, [null]], [12345, 'low', 1, 0, [null]],
  [6, 'high', -1, 1, [null]], [27, 'high', -2, -2, ['low']], [73, 'high', 0, 1, ['lite']], [13, 'low', 0, 2, [null]], [44, 'low', -2, -2, [null]], [69, 'low', -1, 1, [null]],
  [73, 'low', 0, 1, [null]], [74, 'low', -2, -1, [null]]];
const EXTRA_BLOCKS = [[80, -2, 1], [87, 0, -2], [12345, 2, -2], [21, 0, 2], [77, -2, -2], [78, -1, 2], [81, -1, 2], [89, -2, 1], [26, -1, -2], [56, -1, 2], [70, -2, 0], [81, 2, 0],
  [27, -2, -2], [73, 0, 1], [13, 0, 2], [44, -2, -2], [69, -1, 1], [74, -2, -1]];
const TIERS = ['high', 'mid', 'lite', 'low'];
// K3 逐像素比的几台车（按 FE1R 普查挑的：[种子, 画质, 车 key, 停放档, 开过以后的档]）
// 返修 FE1R · repair-r1：普查重做以后 12 (1,1) 变成 low、12345 低画质 (1,0) 变成运行时车 —— lite 换成 27 (−2,−2)、低画质 low 换成 2 (−1,0)
// 返修 FE1R · repair-r2：普查重做以后 27 (−2,−2) 变成 low、6 (−1,1) 变成运行时车 —— 高画质 low 换成 27 (−2,−2)；101 个种子里唯一的 lite 是 73 (0,1)，
// 可种子 73 这一层第 0 个 45 s 段就断电（L1.js update：epoch 0 抽中、持续 26.8 s，进层那一刻就灭灯），「有电」那组停着的车其实是在断电里拍的、
// 开过的车是来电以后拍的，整台暗一截是灯的事、不是车的事（pagePairs 第一次 lights() 在 t = 0.5 s 就是全灭）；lite 换成种子 102–401 里找到的 157 (2,−1)
const PAIR_CASES = [[12345, 'high', '1@-2,2#v0', 'high', 'high'], [157, 'high', '1@2,-1#v0', 'lite', 'lite'], [27, 'high', '1@-2,-2#v0', 'low', 'drvLow'], [2, 'low', '1@-1,0#v0', 'low', 'drvLow']];

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
function pageSnapChunks({ seeds, quality, extra }) {
  const T = window.__fl1;
  const q0 = BR.game.settings.quality;
  T.setQ(quality);
  const out = {};
  const r3 = T.r3;
  // 出生 3×3 每块，再加 extra 里点名的块（[种子, cx, cz]，返修 FE1Q · repair-r3）
  const list = [];
  for (const seed of seeds) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) list.push([seed, cx, cz]);
  for (const e of extra || []) list.push(e);
  try {
    {
      for (const [seed, cx, cz] of list) {
        const res = T.build(seed, cx, cz);
        const geo = [], geoNoFk = [];
        let all = [0x811c9dc5, 0x2545f491];
        res.group.updateMatrixWorld(true);
        // 去掉停着的叉车那几段（kit:prop 里的车身 spans.prop、kit:decal 里的磨损 spans.wear 和车下油渍 spans.oil）以后的几何哈希（返修 FE1P：
        // 证明改叉车只动了叉车自己那几段，这一块别的东西逐字节没变）
        const fls = ((res.data && res.data.forklifts) || []).filter(f => f.spans);
        const cutOf = name => {
          const r = [];
          for (const f of fls) {
            if (name === 'kit:prop' && f.spans.prop) r.push(f.spans.prop);
            if (name === 'kit:decal') { for (const w of f.spans.wear || []) r.push(w); if (f.spans.oil) r.push(f.spans.oil); }
            if (name === 'L1:fkChain' && f.spans.chain) r.push(f.spans.chain);   // 返修 FE1R · repair-r1：链条挪进自己的材质（L1.js FK_CHAIN_MAT），区块里多一个全是链条的网格
          }
          return r;
        };
        res.group.traverse(m => {
          const g = m.geometry;
          if (!g || !g.attributes || !g.attributes.position) return;
          const h = [0x811c9dc5, 0x2545f491];
          for (const k of ['position', 'normal', 'uv', 'color']) if (g.attributes[k]) T.hash(h, g.attributes[k].array);
          if (g.index) T.hash(h, g.index.array);
          T.hash(h, new Float64Array(m.matrixWorld.elements));
          geo.push([m.name || m.type, g.attributes.position.count, g.index ? g.index.count : 0, T.hex(h)]);
          {
            const n = g.attributes.position.count, cut = cutOf(m.name), keep = new Uint8Array(n).fill(1);
            for (const [a, b] of cut) for (let v = a; v < b && v < n; v++) keep[v] = 0;
            const shift = new Int32Array(n);
            let k = 0;
            for (let v = 0; v < n; v++) { shift[v] = k; if (keep[v]) k++; }
            const h2 = [0x811c9dc5, 0x2545f491];
            for (const nm of ['position', 'normal', 'uv', 'color']) {
              const A = g.attributes[nm];
              if (!A) continue;
              const it = A.itemSize, src = A.array, dst = new Float32Array(k * it);
              let o = 0;
              for (let v = 0; v < n; v++) if (keep[v]) for (let j = 0; j < it; j++) dst[o++] = src[v * it + j];
              T.hash(h2, dst);
            }
            let mixed = 0, ni = 0;
            if (g.index) {
              const I = g.index.array, out2 = new Uint32Array(I.length);
              for (let i = 0; i < I.length; i += 3) {
                const kk = keep[I[i]] + keep[I[i + 1]] + keep[I[i + 2]];
                if (kk === 3) { out2[ni++] = shift[I[i]]; out2[ni++] = shift[I[i + 1]]; out2[ni++] = shift[I[i + 2]]; } else if (kk) mixed++;
              }
              T.hash(h2, out2.subarray(0, ni));
            }
            T.hash(h2, new Float64Array(m.matrixWorld.elements));
            // 整个网格都是停着的车的（链条材质那个网格）：去掉以后什么都不剩，不记（以前的快照里没有这个网格，链条在 kit:prop 的车身段里）
            if (!(k === 0 && cut.length && n > 0)) geoNoFk.push([m.name || m.type, k, ni, mixed, T.hex(h2)]);
          }
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
          fk: fkl.map(f => [r3(f.x), r3(f.z), r3(f.rot), f.detail, f.tris]), geoNoFk,
          fkr: fkl.map(f => ({ runtime: f.runtime, detail: f.detail, tris: f.tris, spans: f.spans || null, wearN: f.wearN, number: f.number })),
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
        Object.assign(snap.chunks, await ev(page, pageSnapChunks, { seeds: [], quality: q, extra: EXTRA_BLOCKS }));   // repair-r3
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
        if (want('polish')) await secPolish(page);
        if (want('k12')) await secK12(page);
      }
    }
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  }
  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + String(JSON.stringify(f.detail)).slice(0, 400));
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
    Object.assign(cur, await ev(page, pageSnapChunks, { seeds: [], quality: q, extra: EXTRA_BLOCKS }));
    spawn[q] = await ev(page, pageSpawnInfo, { seeds: SEEDS, quality: q });
  }
  // ---- 出生保底 + J2（返修 FE1Q，主会话裁定：出生块里的车一律是运行时车）----
  const bad = { count: [], forced: [], natural: [], fixture: [], body: [], debris: [], rt: [] };
  let nForced = 0, nNatural = 0;
  const natDebris = [];
  const inBay = f => f.x >= 12 && f.x <= 20 && f.z >= 12 && f.z <= 20;
  for (const q of ['high', 'low']) for (const seed of SEEDS) {
    const I = spawn[q][seed], fl = I.forklifts, mid = fl.filter(inBay);
    // J2：出生块 (0,0) 里所有的车（中间柱间的保底车 / 自然车，别的柱间本来就生成的车）都是运行时车：不进区块几何、没有 spans / wearN、tris 0
    for (const f of fl) if (!(f.runtime === true && f.detail === null && !('spans' in f) && !('wearN' in f) && f.tris === 0)) bad.rt.push([seed, q, f.key, f.runtime, f.detail, f.tris]);
    if (I.body) bad.body.push([seed, q, I.body]);
    if (mid.length !== 1) { bad.count.push([seed, q, fl.map(f => [f.x, f.z])]); continue; }
    const f = mid[0];
    const fx = I.fixtures.find(x => x.key === f.key);
    const sd = I.solids[fl.indexOf(f)];
    if (f.key !== '1@0,0#v' + f.i || fl.indexOf(f) !== f.i) bad.forced.push([seed, q, 'key/i', f.key, f.i]);
    if (!fx || fx.skey !== '0,0#v' + f.i || fx.label !== '叉车' || fx.why !== '叉车太重，拖不动' || fx.solids[0] !== f.solid || fx.solids[1] !== f.solid + 1) bad.fixture.push([seed, q, f.key, fx]);
    if (!sd || Math.abs((sd[0] + sd[2]) / 2 - f.x) > 1e-6 || Math.abs((sd[1] + sd[3]) / 2 - f.z) > 1e-6 || Math.abs(sd[4] - 2.15) > 1e-9) bad.fixture.push([seed, q, 'solid', sd, f.x, f.z]);
    if (!I.spawnBay) { bad.forced.push([seed, q, 'spawnBay', null]); continue; }
    if (I.spawnBay.forced) { nForced++; if (I.debris) bad.debris.push([seed, q, I.debris]); }
    else { nNatural++; if (I.debris) natDebris.push([seed, q, I.debris]); }
  }
  check('snap：' + SEEDS.length + ' 个种子 × 高低画质，出生块 (0,0) 中间柱间恰好一台叉车（自然 ' + nNatural + ' 次、保底 ' + nForced + ' 次）', bad.count.length === 0, bad.count.slice(0, 3));
  check('snap：叉车 key = \'1@0,0#v<i>\'，kit fixture（kind vehicle、label 叉车、why「叉车太重，拖不动」、显式 key、skey \'0,0#v<i>\'）正好包住 solid 下标那一个外接 AABB', bad.fixture.length === 0, bad.fixture.slice(0, 3));
  check('snap：J2 出生块 (0,0) 里所有叉车（保底车、本来就生成的车，例如种子 12345 的 1@0,0#v0）都是运行时车：runtime:true、detail null、没有 spans / wearN、tris 0', bad.rt.length === 0 && bad.forced.length === 0, bad.rt.concat(bad.forced).slice(0, 3));
  check('snap：出生块里的车都不在区块几何里（每台占地内 0.1–2.5 m 高没有 kit:prop 顶点）', bad.body.length === 0, bad.body.slice(0, 3));
  check('snap：保底触发的柱间没有一片碎屑落进叉车占地（含货叉）外扩 0.2 m 以内（自然车那几个柱间的碎屑和改前逐字节一样，只记下来：' + natDebris.length + ' 处）', bad.debris.length === 0, { forced: bad.debris.slice(0, 3), natural: natDebris.slice(0, 4) });
  // 出生块以外停着的车（区块几何里那台）：runtime:false、有 detail / tris、spans.prop / wear / oil 落在累加器顶点数以内、wearN = 磨损片数（低画质 0、没有 oil）。
  // 返修 FE1Q · repair-r3：按 lowb 都放不下时，从最后一台起改成运行时车 —— 运行时车只能排在这块最后（后缀），runtime:true、detail null、没有 spans / wearN、tris 0
  const rtOut = [], minPark = [], overCap = [];
  for (const k of Object.keys(cur)) {
    const c = cur[k], q0 = k.split('|')[1];
    for (const f of c.fkr || []) if (f.runtime === false && !['high', 'mid', 'lite', 'low'].includes(f.detail)) minPark.push([k, f.detail]);
    let tri = 0;
    for (const g of c.geo) tri += (g[2] || g[1]) / 3;
    if (tri > (q0 === 'low' ? 8000 : 10000)) overCap.push([k, tri]);
    if (k.endsWith('|0,0')) continue;
    const fr = c.fkr || [], firstRt = fr.findIndex(f => f.runtime === true);
    if (firstRt >= 0) {
      const tail = fr.slice(firstRt);
      if (tail.every(f => f.runtime === true && f.detail === null && f.tris === 0 && !f.spans && f.wearN === undefined)) rtOut.push([k, fr.map(f => f.runtime ? 'rt' : f.detail).join(',')]);
      else bad.natural.push([k, 'runtime 不在最后 / 字段不对', tail]);
    }
  }
  for (const k of Object.keys(cur)) {
    if (k.endsWith('|0,0')) continue;
    const c = cur[k], q = k.split('|')[1], cnt = {};
    for (const g of c.geo) cnt[g[0]] = g[1];
    for (const f of c.fkr || []) {
      if (f.runtime === true) continue;   // 运行时车（上面单独查）
      const sp = f.spans || {}, nProp = cnt['kit:prop'] || 0, nDec = cnt['kit:decal'] || 0;
      const okSpan = r => Array.isArray(r) && r[0] < r[1];
      const ok = f.runtime === false && typeof f.detail === 'string' && f.tris > 0 && okSpan(sp.prop) && sp.prop[1] <= nProp &&
        (sp.wear || []).every(r => okSpan(r) && r[1] <= nDec) && (sp.oil === null || (okSpan(sp.oil) && sp.oil[1] <= nDec)) &&
        (f.wearN > 0) === ((sp.wear || []).length > 0) && f.wearN >= 0 && f.wearN <= 9 && (q === 'low' ? f.wearN === 0 && sp.oil === null : true) &&
        typeof f.number === 'number' && f.number >= 1 && f.number <= 98;
      if (!ok) bad.natural.push([k, f]); else bad.natOk = (bad.natOk || 0) + 1;
    }
  }
  check('snap：出生块以外停着的车（' + (bad.natOk || 0) + ' 台）runtime:false、有 detail / tris、spans.prop / wear / oil 落在累加器顶点数以内、wearN = 磨损片数（低画质 0、没有 oil）；' +
    '改成运行时车的（repair-r3，' + rtOut.length + ' 块）只排在这块最后、runtime:true、detail null、没有 spans / wearN、tris 0', bad.natural.length === 0 && (bad.natOk || 0) > 0, bad.natural.slice(0, 2));
  {
    const fix = K3FIX.map(([sd, q, cx, cz, want]) => {
      const c = cur[sd + '|' + q + '|' + cx + ',' + cz];
      const got = c ? (c.fkr || []).map(f => f.runtime ? null : f.detail) : 'missing';
      return { k: sd + '|' + q + '|' + cx + ',' + cz, want, got, ok: JSON.stringify(got) === JSON.stringify(want) };
    });
    check('snap：K3 停着的车只有 high / mid / lite / low 四档（' + Object.keys(cur).length + ' 块，高低画质）：按 low 都放不下时从最后一台起改成运行时车（载具网格画 mid / drvLow，停着和开过同一个网格）；' +
      'FE1Q 普查里用过 lowb 的 ' + K3FIX.length + ' 块现在是普查算出来的那几档；整块 ≤10000 / 8000',
      minPark.length === 0 && fix.every(f => f.ok) && overCap.length === 0, { minPark: minPark.slice(0, 3), fix, overCap: overCap.slice(0, 3), rtOut });
  }
  const hiTri = HIGH_TRI.filter(sd => SEEDS.includes(sd)).map(sd => {
    const I = spawn.high[sd], f = I.forklifts.find(inBay);
    return { seed: sd, tri: I.spawnBay && I.spawnBay.tri, cap: I.spawnBay && I.spawnBay.cap, forced: !!(I.spawnBay && I.spawnBay.forced), runtime: !!(f && f.runtime), lowRuntime: !!((spawn.low[sd].forklifts.find(inBay) || {}).runtime) };
  });
  check('snap：「进柱间时 triCount ≥7300」的种子（' + hiTri.length + ' 个，至少 2 个）也有保底车', hiTri.length >= 2 && hiTri.every(h => h.tri >= 7300 && h.forced && h.runtime && h.lowRuntime), hiTri);
  const nat = NATURAL.filter(sd => SEEDS.includes(sd)).map(sd => ({ seed: sd, forced: spawn.high[sd].spawnBay && spawn.high[sd].spawnBay.forced, runtime: (spawn.high[sd].forklifts.find(inBay) || {}).runtime }));
  check('snap：自然种子（12345 等）出生柱间那台是本来就生成的（不触发保底，spawnBay.forced false），J2 以后也是运行时车', nat.every(n => n.forced === false && n.runtime === true), nat);
  const s12 = spawn.high[12345] && spawn.high[12345].forklifts.find(inBay);
  if (s12) check('snap：种子 12345 出生块叉车在 (16.4, 16.91)、key 1@0,0#v0、运行时车（进层后载具网格高画质 mid、低画质 drvLow，见 polish J2）', Math.abs(s12.x - 16.4) < 0.01 && Math.abs(s12.z - 16.91) < 0.01 && s12.runtime === true && s12.key === '1@0,0#v0', [s12.x, s12.z, s12.detail, s12.key, s12.runtime]);

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
  // J2 以前拍的快照里，出生块的车（除了保底车）在区块几何里（detail 不是 null）：J2 把它挪进了载具网格，这一块的几何必然少了叉车那几段；
  // FE1 以前拍的快照（FE1-before）出生块还没有保底车。这两种快照的出生块不整块比（去掉叉车段以后逐字节一致由后面 geoNoFk 那一项证明）；
  // J2 以后拍的快照（出生块的车台数一样、detail 都是 null）整块逐字节比
  const preJ2 = (b0, c) => !(b0 && c && Array.isArray(b0.fk) && b0.fk.length === c.fk.length && b0.fk.every(f => f[3] === null));
  for (const q of ['high', 'low']) for (const seed of SEEDS) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const k = seed + '|' + q + '|' + cx + ',' + cz, b0 = before.chunks[k], c = cur[k];
    if (!b0) continue;
    const spawnChunk = cx === 0 && cz === 0;
    if (spawnChunk && preJ2(b0, c)) { skipped++; continue; }
    compared++;
    const A = strip(b0), B = strip(c);
    const fields = Object.keys(A).filter(f => JSON.stringify(A[f]) !== JSON.stringify(B[f]));
    if (fields.length) (spawnChunk ? diffs.spawnNat : diffs.other).push([k, fields, fields.includes('geo') ? (A.geo.find((g, i) => JSON.stringify(g) !== JSON.stringify(B.geo[i])) || null) : null]);
  }
  // 逐块记下哪些字段变了（只含停着叉车的块变了 = 只是叉车自己的几何；返修 FE1Q 起写文件，方便逐项说明）
  fs.writeFileSync(path.join(OUT, 'snap-diff.json'), JSON.stringify({ other: diffs.other.map(d => [d[0], d[1], (cur[d[0]] || {}).fk]), spawn: diffs.spawnNat.map(d => [d[0], d[1]]) }, null, 1));
  check('snap：出生块以外的 8 块逐项和快照一致（几何逐字节、碰撞体、刷新点、出口、叉车、道具/设备/容器 key；比了 ' + compared + ' 块）', diffs.other.length === 0, diffs.other.slice(0, 3));
  check('snap：出生块逐项和快照一致（快照在 J2 以前拍的出生块 ' + skipped + ' 块不整块比：那时区块里有停着的车或者还没有保底车，见下面去掉叉车段那一项）', diffs.spawnNat.length === 0, diffs.spawnNat.slice(0, 3));
  const k12 = [];
  for (const q of ['high', 'low']) for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const k = 12345 + '|' + q + '|' + cx + ',' + cz;
    if (cx === 0 && cz === 0 && preJ2(before.chunks[k], cur[k])) continue;
    if (before.chunks[k] && JSON.stringify(strip(before.chunks[k])) !== JSON.stringify(strip(cur[k]))) k12.push(k);
  }
  check('snap：种子 12345 的 9 块（高低画质）全部逐字节一致（快照在 J2 以前拍的话不含出生块）', k12.length === 0 && !!before.chunks['12345|high|0,0'], k12);
  // 快照里有「去掉叉车那几段」的哈希（返修 FE1P 起拍的快照）：所有块（含出生块）去掉停着的叉车以后几何逐字节一致、非几何项全部一致，
  // 叉车只许换档（detail / tris）
  const anyNo = Object.values(before.chunks).some(c => c.geoNoFk);
  if (anyNo) {
    const noFk = [], tierCh = [], mixed = [];
    let cmp = 0;
    const strip2 = c => ({ geoNoFk: (c.geoNoFk || []).map(g => [g[0], g[1], g[2], g[4]]), solids: c.solids, nSolids: c.nSolids, spawn: c.spawn, exits: c.exits, bays: c.bays, sector: c.sector,
      fkPos: c.fk.map(f => f.slice(0, 3)), props: c.props, fixtures: c.fixtures, containers: c.containers });
    for (const k of Object.keys(before.chunks)) {
      const b0 = before.chunks[k], c = cur[k];
      if (!c || !b0.geoNoFk) continue;
      cmp++;
      const A = strip2(b0), B = strip2(c);
      const fields = Object.keys(A).filter(f => JSON.stringify(A[f]) !== JSON.stringify(B[f]));
      if (fields.length) noFk.push([k, fields]);
      if ((c.geoNoFk || []).some(g => g[3])) mixed.push(k);
      const d0 = b0.fk.map(f => f[3]).join('/'), d1 = c.fk.map(f => f[3]).join('/');
      if (d0 !== d1) tierCh.push([k, d0 + ' → ' + d1]);
    }
    fs.writeFileSync(path.join(OUT, 'snap-tiers.json'), JSON.stringify(tierCh, null, 1));
    // J2：出生块（快照里还有停着的车的那些也算）去掉叉车那几段以后，块里别的段逐字节不变 —— 单独点名记一行
    const spawnK = Object.keys(before.chunks).filter(k => k.endsWith('|0,0') && before.chunks[k].geoNoFk && cur[k]);
    const spawnBad = noFk.filter(d => d[0].endsWith('|0,0'));
    check('snap：J2 出生块 ' + spawnK.length + ' 块（高低画质 × ' + SEEDS.length + ' 个种子）去掉叉车段以后，块里别的段（几何、碰撞体、刷新点、出口、道具……）逐字节不变',
      spawnK.length > 0 && spawnBad.length === 0, spawnBad.slice(0, 3));
    check('snap：去掉停着的叉车那几段以后，' + cmp + ' 块（高低画质、含出生块）几何逐字节一致，碰撞体 / 刷新点 / 出口 / 柱间 / 叉车位置 / 道具 / 设备 / 容器全部一致；没有跨在叉车段内外的三角形',
      cmp > 0 && noFk.length === 0 && mixed.length === 0, { diff: noFk.slice(0, 4), mixed: mixed.slice(0, 4) });
    check('snap：（记录）叉车换了细节档的块 ' + tierCh.length + ' 个（只因为叉车自己的面数变了；整块仍在 10000 / 8000 以内，见 ws / golden）', true, tierCh.slice(0, 20));
  }
}
async function secModel(page, before) {
  const cur = {};
  for (const q of ['high', 'low']) Object.assign(cur, await ev(page, pageModelHashes, { quality: q, numbers: MODEL_NUMBERS, tiers: TIERS }));
  // 返修 FE1R · repair-r4（主会话 L6）：叉车图集材质 L1:fkChain（警示条、百叶、车号、链板……贴片离面 1 mm）要有 polygonOffset（repair-r3 K12 S18：30–45 m 外不再 z-fighting），
  // 以后重写这个材质时漏了会在这里报出来。上面建模型时已经建过这份材质（fkChainMat 第一次用时才建）
  const po = await ev(page, () => { const m = BR.assets.material('kit|L1:fkChain'); return m ? { on: !!m.polygonOffset, factor: m.polygonOffsetFactor, units: m.polygonOffsetUnits } : null; });   // kit.mat 存在 assets 里的键是 'kit|' + 名字
  check('model：叉车图集材质 L1:fkChain 开着 polygonOffset、factor ≤ −1（贴片 30–45 m 外不撕裂）', !!po && po.on && po.factor <= -1, po);
  if (!before || !before.models) { check("model：part='all' 顶点哈希（没有快照，只记录）", true, Object.keys(cur).length); return; }
  const diff = [];
  // 返修 FE1R：快照里多出来的档（FE1Q 以前的 lowb / min）不比；当前每一份都要在快照里有、逐位一致
  for (const k of Object.keys(cur)) if (JSON.stringify(before.models[k]) !== JSON.stringify(cur[k])) diff.push({ k, before: before.models[k] || null, now: cur[k] });
  check("model：forkliftModel part='all' 在 " + TIERS.length + " 档 × 2 画质 × 5 个车号下的顶点哈希和快照逐位一致（" + Object.keys(cur).length + " 份）", diff.length === 0 && Object.keys(cur).length === TIERS.length * 2 * MODEL_NUMBERS.length, diff.slice(0, 3).map(d => d.k));
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
  // ① 每台 ≤2000 面（模型 + 最多的磨损 + 载具层画的大灯开关）。返修 FE1R · K5：前大灯镜面、警示灯罩、开关指示灯各有 kit:prop（熄着）和 kit:glow（亮着）两份；
  // 返修 FE1R · repair-r1：载具层按灯的状态只建其中一份的模板（缓冲区里不再有叠成一点的那份）—— 两份一样多，按 kit:prop 那份算 = 缓冲区面数；
  // 链条占位的零面积三角形也不算（载具层的 perVehicleBuf 同样不算链条的空余预留）
  out.tris = {};
  const swN = BR.vehicles && typeof BR.vehicles._switchGeo === 'function' ? (BR.vehicles._switchGeo(1) || []).length : 0;
  const live = b => { let n = 0, dup = 0; b._accs.forEach((a, k) => { if (!a || !a.idx || typeof k !== 'string') return; for (let i = 0; i < a.idx.length; i += 3) { const v0 = a.idx[i], v1 = a.idx[i + 1], v2 = a.idx[i + 2]; const P = j => [a.pos[j * 3], a.pos[j * 3 + 1], a.pos[j * 3 + 2]]; const A = P(v0), B = P(v1), C2 = P(v2); const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C2[0] - A[0], C2[1] - A[1], C2[2] - A[2]]; if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-12) continue; if (k === 'kit:glow') { dup++; continue; } n++; } }); return { n, dup }; };
  for (const [detail, q] of CASES) {
    for (const levers of [0, F.lod[detail].levers]) {   // 载具层给可动模型的根数 = 停放档的根数（leversFor，各档都是 1），至少 1
      const m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers }, q);
      const q0 = BR.game.settings.quality; T.setQ(q);
      const wn = F.wear(m.b, { detail, wearN: 99 });
      T.setQ(q0);
      const c = live(m.b);
      out.tris[detail + '/' + levers] = { tri: c.n + swN, glowDup: c.dup, wear: wn, levers };
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
  for (const [detail, q] of [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['low', 'low']]) out.forkDown['parked:' + detail] = forkDown(T.buildModel({ part: 'all', detail, number: 88 }, q));
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
  // 返修 FE1R · K4：停着的车和可动模型同一个车架（底盘在后轮里侧收窄、配重下半截前脸在 cwFront）—— 停着的车的 body（drive 不开）三角形和可动模型的一模一样
  {
    const sigL = list => list.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]).sort().join(';');
    out.wheelParked = {};
    for (const [detail, q] of [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['low', 'low']]) {
      const pk = T.buildModel({ part: 'body', detail, number: 88, levers: F.lod[detail].levers }, q).tris.filter(t => t[10] === 'chassis' || t[10] === 'counterweight');
      const dv = T.buildModel({ part: 'body', detail: detail === 'low' ? 'drvLow' : detail, number: 88, drive: true, levers: F.lod[detail].levers }, q).tris.filter(t => t[10] === 'chassis' || t[10] === 'counterweight');
      out.wheelParked[detail] = { same: sigL(pk) === sigL(dv), n: pk.length };
    }
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
    out.drvLow = { bevel: m.bevel, decalAcc: !!m.b._accs.get('kit:decal'), bev: L.bev, ch: L.ch, cwC: L.cwC, backC: L.backC, decals: L.decals, trim: !!L.trim, handle: L.handle,
      lowSame: JSON.stringify(Object.assign({}, F.lod.low)) === JSON.stringify(Object.assign({}, F.lod.drvLow)) };
    const mh = T.buildModel({ part: 'all', detail: 'lite', number: 88, drive: true, levers: 1 }, 'high');
    out.liteBevel = mh.bevel;
  }
  // ⑥ kit:glow：前大灯镜面 + 警示灯罩只在 glow 里；kit:prop 里没有镜面色 / 灯罩色；镜面离灯壳前脸 ≥2 mm（不共面）
  {
    const lens = T.storedColor([0.95, 0.94, 0.86]), amber = T.storedColor([1.05, 0.58, 0.1]);
    const has = (m, col) => { const a = m.accs.get('kit:prop'); let n = 0; for (let v = 0; v < a.n; v++) if (Math.abs(a.col[v * 3] - col[0]) < 1e-6 && Math.abs(a.col[v * 3 + 1] - col[1]) < 1e-6 && Math.abs(a.col[v * 3 + 2] - col[2]) < 1e-6) n++; return n; };
    out.glow = {};
    const sigL = list => list.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',')).sort().join(';');
    for (const [detail, q] of CASES) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: 2 }, q);
      const g = m.accs.get('kit:glow');
      const part = p => T.buildModel({ part: p, detail, number: 88, drive: true, levers: 2 }, q).tris;
      const lOff = part('lampOff'), lOn = part('lampOn'), bOff = part('beaconOff'), bOn = part('beaconOn'), body = part('body');
      // K5：熄着那份（kit:prop）和亮着那份（kit:glow）几何一样；'body' 里没有镜面色 / 灯罩色（不重复）
      out.glow[detail] = { glowVerts: g ? g.n : 0, lampOff: lOff.length, lampOffMat: Array.from(new Set(lOff.map(t => t[9]))), lampOnMat: Array.from(new Set(lOn.map(t => t[9]))),
        beaconOffMat: Array.from(new Set(bOff.map(t => t[9]))), beaconOnMat: Array.from(new Set(bOn.map(t => t[9]))),
        lampSame: sigL(lOff) === sigL(lOn) && lOff.length > 0, beaconSame: sigL(bOff) === sigL(bOn) && bOff.length > 0, bodyTris: body.length };
      const mb = T.buildModel({ part: 'body', detail, number: 88, drive: true, levers: 2 }, q);
      out.glow[detail].bodyLens = has(mb, lens); out.glow[detail].bodyAmber = has(mb, amber);
    }
    // 停着的车：镜面、灯罩只在 kit:prop 里，和可动模型熄着的那份逐个三角形一样（K5）
    out.glowParked = {};
    for (const [detail, q, dd] of [['high', 'high', 'high'], ['mid', 'high', 'mid'], ['lite', 'high', 'lite'], ['low', 'low', 'drvLow']]) {
      const mp = T.buildModel({ part: 'all', detail, number: 88 }, q);
      const off = T.buildModel({ part: 'lampOff', detail: dd, number: 88, drive: true }, q).tris.concat(T.buildModel({ part: 'beaconOff', detail: dd, number: 88, drive: true }, q).tris);
      const pk = new Set(mp.tris.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]));
      out.glowParked[detail] = { glow: !!mp.accs.get('kit:glow'), propLens: has(mp, lens), propAmber: has(mp, amber), offInParked: off.filter(t => pk.has(t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9])).length, off: off.length };
    }
  }
  // ⑦ 拆开的部件拼起来 = 'all'（顶点多重集合一样），drive 开关两种都查
  out.parts = {};
  for (const drive of [false, true]) for (const [detail, q] of [['high', 'high'], ['lite', 'high'], [drive ? 'drvLow' : 'low', 'low']]) {
    const sig = list => list.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]).sort().join(';');
    const all = T.buildModel({ part: 'all', detail, number: 23, drive, levers: 2, lift: 0.4, steer: 0.3 }, q).tris;
    let parts = [];
    for (const part of ['body', 'lampOff', 'lampOn', 'beaconOff', 'beaconOn', 'liftLever', 'wheelsFront', 'wheelRearL', 'wheelRearR', 'steeringWheel', 'mastOuter', 'mastInner', 'carriage', 'chains']) parts = parts.concat(T.buildModel({ part, detail, number: 23, drive, levers: 2, lift: 0.4, steer: 0.3 }, q).tris);
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
    out.wear.decalsWant = { high: F.lod.high.decals, mid: F.lod.mid.decals, lite: F.lod.lite.decals };
  }
  // ⑩ driveTier
  out.tier = {};
  for (const q of ['high', 'low']) for (const p of ['high', 'mid', 'lite', 'low', null]) out.tier[q + '/' + p] = F.driveTier(q, p);
  out.parkTiers = { ladder: JSON.parse(JSON.stringify(F.ladder)), lod: Object.keys(F.lod).sort() };
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
  check('drive：可动模型（high/mid/lite 高画质、drvLow 低画质，杆数按停放档（repair-r2 起各档 2 根），加上最多的磨损贴花和载具层画的大灯开关）每台 ≤2000 面（K5 灯的两份只算画出来的那一份）', triBad.length === 0, Object.fromEntries(Object.entries(D.tris).filter(([k]) => !k.endsWith('/0')).map(([k, v]) => [k, v.tri + '（glow ' + v.glowDup + ' 不重复计）'])));
  const fd = Object.entries(D.forkDown).filter(([, v]) => !(v.forkL >= 2 && v.forkR >= 2 && v.areaL >= 0.08 && v.areaR >= 0.08));
  check('drive：每根货叉水平段至少 2 个法线 y < −0.9 的三角形，朝下的面积盖满水平段（≥0.08 m²；可动 4 档 × 落地 / 升到顶，停放 4 档也一样 —— K3：停着、开过同一份几何）', fd.length === 0 && Object.keys(D.forkDown).length === 12, D.forkDown);
  const wb = Object.entries(D.wheel).filter(([, v]) => !(v.d >= 0.01 && v.crossings.length === 0));
  check('drive：后轮 0 到 ±maxSteer（1.13）每 5° 采样，轮胎顶点到车身三角形、车身顶点到轮胎三角形都 ≥1 cm，两组三角形没有穿插', wb.length === 0,
    Object.fromEntries(Object.entries(D.wheel).map(([k, v]) => [k, { d: +v.d.toFixed(4), deg: v.deg, part: v.part, seg: v.seg, crossings: v.crossings.slice(0, 3) }])));
  check('drive：K4 停着的车和可动模型同一个车架 —— 停放 high / mid / lite / low 的底盘、配重三角形和同档（low → drvLow）可动模型逐个一样', Object.values(D.wheelParked).every(v => v.same && v.n > 0), D.wheelParked);
  const bb = Object.entries(D.belts).filter(([, v]) => !(v.length >= 2 && v.every(x => x.section >= 0.02)));
  check('drive：安全带 ≥2 条、每条截面 ≥2 cm（4 档）', bb.length === 0, D.belts);
  check('drive：drvLow = lite 去掉倒角和贴花：建模时 _bevelBox 只调 1 次（坐垫顶棱，repair-r2 起各档都倒圆）、端面斜角 ch / cwC / backC 都是 0、没有 kit:decal 累加器、不砍面（trim 关）、有扶手；K3：停放 low 档和 drvLow 参数一模一样',
    D.drvLow.bevel === 1 && !D.drvLow.decalAcc && D.drvLow.bev === false && D.drvLow.ch === 0 && D.drvLow.cwC === 0 && D.drvLow.backC === 0 && D.drvLow.decals === 0 && !D.drvLow.trim && D.drvLow.handle >= 1 && D.drvLow.lowSame && D.liteBevel > 0, Object.assign({ liteBevel: D.liteBevel }, D.drvLow));
  const gb = Object.entries(D.glow).filter(([, v]) => !(v.lampSame && v.beaconSame && v.lampOffMat.join() === 'kit:prop' && v.lampOnMat.join() === 'kit:glow' && v.beaconOffMat.join() === 'kit:prop' && v.beaconOnMat.join() === 'kit:glow' && v.bodyLens === 0 && v.bodyAmber === 0));
  const gp = Object.entries(D.glowParked).filter(([, v]) => !(!v.glow && v.propLens > 0 && v.propAmber > 0 && v.offInParked === v.off && v.off > 0));
  check('drive：K5 前大灯镜面、警示灯罩在可动模型里各两份 —— lampOff / beaconOff 在 kit:prop、lampOn / beaconOn 在 kit:glow，几何一样（载具层按灯的状态叠掉一份）；body 里不重复；停着的车只有 kit:prop 那份、和可动模型熄着的那份逐个三角形一样',
    gb.length === 0 && gp.length === 0, { drive: D.glow, parked: D.glowParked });
  const pb = Object.entries(D.parts).filter(([, v]) => !(v.same && v.lever > 0 && v.rearL > 0 && v.rearL * 2 === v.rearBoth));
  check("drive：part 'body' + 'liftLever' + 'wheelsFront' + 'wheelRearL' + 'wheelRearR' + … 拼起来和 'all' 的三角形一模一样（drive 开关都查）；wheelsRear = L + R", pb.length === 0, D.parts);
  check('drive：levers 0/1/2/3 → 升降杆 1 根（drive 至少 1 根），其余操纵杆 0/0/1/2 根', D.levers[0].liftLever === 1 && D.levers[0].leverTris === 0 && D.levers[1].leverTris === 0 && D.levers[2].leverTris > 0 && D.levers[3].leverTris > D.levers[2].leverTris, D.levers);
  const W = D.wear;
  check('drive：wear 按 wearN 和这一档 decals−1 截断、跳过地上油渍；part oil 只画油；货叉刮痕跟着升；低画质 / drvLow 一片不画',
    W.high9.n === W.decalsWant.high - 1 && W.high99.n === W.decalsWant.high - 1 && W.mid9.n === W.decalsWant.mid - 1 && W.lite2.n === 2 && W.oil.n === 1 && W.oil.ymax < 0.05 && W.carriageLift1.n === 2 && W.carriageLift1.ymax > 2.6 && W.drvLow.n === 0 && W.lowQ.n === 0, W);
  const tierWant = { 'high/high': 'high', 'high/mid': 'mid', 'high/lite': 'lite', 'high/low': 'drvLow', 'high/null': 'mid' };
  const tierBad = Object.entries(D.tier).filter(([k, v]) => k.startsWith('low/') ? v !== 'drvLow' : v !== tierWant[k]);
  check('drive：driveTier（K3）—— high / mid / lite 停着的开过以后同一档、low → drvLow（两种画质）；低画质一律 drvLow；高画质没有停放档（null：出生块的车、运行时车）用 mid', tierBad.length === 0, D.tier);
  check('drive：K3 停放档只剩 high / mid / lite / low（ladder 高画质 high → mid → lite → low、低画质只有 low；lod 里没有 lowb / min）',
    JSON.stringify(D.parkTiers.ladder) === JSON.stringify({ high: ['high', 'mid', 'lite', 'low'], low: ['low'] }) && JSON.stringify(D.parkTiers.lod) === JSON.stringify(['drvLow', 'high', 'lite', 'low', 'mid']), D.parkTiers);
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
    // J2（返修 FE1Q）只管 L1 正常生成：工坊地图（种子 12345）出生块里本来就生成的那台照旧是区块里停着的车（runtime:false、有停放档、有 spans）
    const m2 = BR.workshop.create('1', 'fe1-ws12345'); m2.seed = 12345;
    BR.workshop.activate(m2, { editing: false });
    const r2 = T.build(12345, 0, 0);
    out.spawnWs12345 = (r2.data.forklifts || []).map(f => ({ key: f.key, runtime: f.runtime, detail: f.detail, spans: !!f.spans }));
    // 返修 FE1R · K3：放不下 low 档的车改成运行时车（不管是不是出生块）—— 记下这块去掉叉车的面数和 low 档一台车的面数，好分清是哪条规则
    { let tri = 0; r2.group.traverse(m => { const g = m.isMesh && m.geometry; if (g && g.attributes.position) tri += (g.index ? g.index.count : g.attributes.position.count) / 3; });
      const ft = (r2.data.forklifts || []).reduce((a, f) => a + (f.tris || 0), 0), t = T.builder(); BR.L1forklift.model(t, { detail: 'low', number: 88 });
      let lowT = 0; t._accs.forEach((a, k) => { if (a && a.idx && typeof k === 'string') lowT += a.idx.length / 3; });
      out.spawnWs12345Budget = { base: tri - ft, lowT, cap: BR.game.settings.quality === 'low' ? 7950 : 9950, q: BR.game.settings.quality }; }
    T.dispose(r2);
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
  {
    const B = R.spawnWs12345Budget || {}, fits = B.base + B.lowT <= B.cap;
    check('ws：J2 只管 L1 正常生成 —— 工坊地图（种子 12345）出生块里本来就生成的车按普通规则挑档：放得下 low 就停在区块里（runtime:false、有停放档和 spans），放不下才改成运行时车（K3）',
      Array.isArray(R.spawnWs12345) && R.spawnWs12345.length >= 1 && R.spawnWs12345.every(f => fits ? (f.runtime === false && typeof f.detail === 'string' && f.spans) : (f.runtime === true && f.detail === null)), { cars: R.spawnWs12345, budget: B, fits });
  }
}

// =====================================================================
// k12（返修 FE1R · repair-r1，验收员 tests：K12 背面探针做成自动测试）：停放 high / mid / lite / low、可动 high / mid / lite / drvLow（升降 0 / 0.5 / 1、
// 满舵两边）的三角形（kit:prop + 链条材质；kit:glow 是灯亮着的那份、和熄着的同一位置，不算；贴花不算）拿到 node 里软光栅（640×360、竖直视野 75°、近裁 5 cm）：
// 每个像素最近的是背面三角形（比最近的正面近 2 mm 以上，或者根本没有正面）= 透过去看见零件里面；4 邻里至少 2 个也漏才算（棱上单像素不算）。
// 眼点（照 stage-FE1R/verify-spec/r1/scripts/bf.mjs）：站着 1.62 m 离车外接矩形 1–4 m 每 0.5 m、每 10° 一圈（各看 5 个目标）；0.3 m 低机位同样一圈（4 个目标）；
// 本车驾驶座环顾（每 30°、俯仰 6 档）；旁边车驾驶座 1.8 m、离 1 m；K4 两个低机位。全部 0 漏光
// =====================================================================
function pageK12Models() {
  const F = BR.L1forklift, out = {}, q0 = BR.game.settings.quality;
  const CFG = [];
  for (const d of ['high', 'mid', 'lite', 'low']) CFG.push(['P-' + d, { detail: d, number: 88 }, d === 'low' ? 'low' : 'high']);
  for (const d of ['high', 'mid', 'lite', 'drvLow']) {
    const q = d === 'drvLow' ? 'low' : 'high';
    for (const lift of [0, 0.5, 1]) CFG.push(['D-' + d + '-l' + lift, { detail: d, number: 88, drive: true, lift, levers: F.lod[d].levers }, q]);
    for (const steer of [-1.13, 1.13]) CFG.push(['D-' + d + '-s' + steer, { detail: d, number: 88, drive: true, lift: 0, steer, levers: F.lod[d].levers }, q]);
  }
  try {
    for (const [name, o, q] of CFG) {
      BR.game.settings.quality = q;
      const b = BR.kit.builder({}, 0, 0, () => 0, { height: 4 });
      F.model(b, o);
      const P = [];
      b._accs.forEach((a, k) => {
        if (!a || !a.idx || typeof k !== 'string' || k === 'kit:glow' || k === 'kit:decal') return;
        for (let i = 0; i < a.idx.length; i++) { const v = a.idx[i]; P.push(+a.pos[v * 3].toFixed(5), +a.pos[v * 3 + 1].toFixed(5), +a.pos[v * 3 + 2].toFixed(5)); }
      });
      out[name] = P;
    }
  } finally { BR.game.settings.quality = q0; }
  return out;
}
function k12Views() {
  const RX = 0.62, Z0 = -2.12, Z1 = 1.3, CZ = (Z0 + Z1) / 2;
  const ringPt = (th, d) => { const dx = Math.sin(th), dz = Math.cos(th); const tx = Math.abs(dx) > 1e-6 ? RX / Math.abs(dx) : Infinity, tz = Math.abs(dz) > 1e-6 ? (dz > 0 ? Z1 - CZ : CZ - Z0) / Math.abs(dz) : Infinity; const t = Math.min(tx, tz); return [dx * (t + d), CZ + dz * (t + d)]; };
  const V = [];
  const TG_STAND = [[0, 0.35, -1.6], [0, 1.0, -0.9], [0, 1.25, 0.05], [0, 0.7, 0.9], [0, 0.45, -0.5]];
  const TG_LOW = [[0, 0.45, -0.6], [0, 0.4, 0.8], [0, 0.25, -1.6], [0, 0.7, 0.2]];
  for (let a = 0; a < 36; a++) for (const d of [1, 1.5, 2, 2.5, 3, 3.5, 4]) {
    const p = ringPt(a * 10 * Math.PI / 180, d);
    for (const tg of TG_STAND) V.push({ k: 'stand', eye: [p[0], 1.62, p[1]], at: tg, tag: 'stand a' + a * 10 + ' d' + d });
    for (const tg of TG_LOW) V.push({ k: 'low', eye: [p[0], 0.3, p[1]], at: tg, tag: 'low a' + a * 10 + ' d' + d });
  }
  for (let yw = 0; yw < 12; yw++) for (const pt of [-1.25, -0.9, -0.5, 0, 0.5, 1.2]) {
    const y = yw * Math.PI / 6, e = [0, 1.8, 0.16];
    V.push({ k: 'seat', eye: e, at: [e[0] - Math.sin(y) * Math.cos(pt), e[1] + Math.sin(pt), e[2] - Math.cos(y) * Math.cos(pt)], tag: 'seat yaw' + yw * 30 + ' p' + pt });
  }
  for (const s of [-1, 1]) for (const z of [-1.8, -1.0, -0.3, 0.4, 1.0, 1.6]) for (const tg of TG_STAND) V.push({ k: 'adj', eye: [s * (RX + 1.0), 1.8, z], at: tg, tag: 'adj x' + s + ' z' + z });
  for (const s of [-1, 1]) V.push({ k: 'k4', eye: [s * 1.2, 0.3, 0.2], at: [s * 0.25, 0.3, 0.85], fov: 50, tag: 'K4 ' + s });
  return V;
}
function k12Leaks(P, V) {
  const W = 640, H = 360, NEAR = 0.05, nT = P.length / 9;
  const dF = new Float32Array(W * H), dB = new Float32Array(W * H), tB = new Int32Array(W * H), L = new Uint8Array(W * H);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const raster = (a, b, c, back, t) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (x0 > x1 || y0 > y1) return;
    const ia = 1 / area;
    for (let y = y0; y <= y1; y++) { const py = y + 0.5; for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * ia, w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * ia, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = 1 / (w0 * a[2] + w1 * b[2] + w2 * c[2]), i = y * W + x;
      if (back) { if (z < dB[i]) { dB[i] = z; tB[i] = t; } } else if (z < dF[i]) dF[i] = z;
    } }
  };
  const res = { views: 0, leakViews: 0, px: 0, worst: [] };
  for (const v of V) {
    const f = nrm(sub(v.at, v.eye)), r = nrm(cross(f, [0, 1, 0])), u = cross(r, f), ty = Math.tan((v.fov || 75) * Math.PI / 360), tx = ty * W / H;
    dF.fill(Infinity); dB.fill(Infinity); tB.fill(-1);
    for (let t = 0; t < nT; t++) {
      const A = [P[t * 9], P[t * 9 + 1], P[t * 9 + 2]], B = [P[t * 9 + 3], P[t * 9 + 4], P[t * 9 + 5]], C = [P[t * 9 + 6], P[t * 9 + 7], P[t * 9 + 8]];
      const n = cross(sub(B, A), sub(C, A));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-10) continue;
      const back = dot(n, sub(v.eye, A)) < 0;
      const poly = [A, B, C].map(p => { const d = sub(p, v.eye); return [dot(d, r), dot(d, u), dot(d, f)]; });
      const out = [];
      for (let i = 0; i < 3; i++) { const p = poly[i], q = poly[(i + 1) % 3], pin = p[2] >= NEAR, qin = q[2] >= NEAR; if (pin) out.push(p); if (pin !== qin) { const s = (NEAR - p[2]) / (q[2] - p[2]); out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, NEAR]); } }
      if (out.length < 3) continue;
      const sp = out.map(p => [W / 2 + (p[0] / p[2]) / tx * W / 2, H / 2 - (p[1] / p[2]) / ty * H / 2, 1 / p[2]]);
      for (let k = 1; k + 1 < sp.length; k++) raster(sp[0], sp[k], sp[k + 1], back, t);
    }
    L.fill(0);
    for (let i = 0; i < W * H; i++) if (dB[i] < Infinity && dB[i] < dF[i] - 0.002) L[i] = 1;
    let n2 = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (L[i] && L[i - 1] + L[i + 1] + L[i - W] + L[i + W] >= 2) n2++; }
    res.views++;
    if (n2) { res.leakViews++; res.px += n2; if (res.worst.length < 4) res.worst.push([v.tag, n2]); }
  }
  return res;
}
async function secK12(page) {
  const M = await ev(page, pageK12Models);
  const V = k12Views(), out = {};
  for (const [name, P] of Object.entries(M)) out[name] = k12Leaks(P, V);
  fs.writeFileSync(path.join(OUT, 'k12.json'), JSON.stringify(out, null, 1));
  const bad = Object.entries(out).filter(([, r]) => r.leakViews > 0);
  check('k12：背面探针 —— 停放 high / mid / lite / low、可动 high / mid / lite / drvLow（升降 0 / 0.5 / 1、满舵两边）共 ' + Object.keys(out).length + ' 份模型 × ' + V.length +
    ' 个机位（站着 1.62 m 离车 1–4 m 每 10° 一圈、0.3 m 低机位一圈、本车驾驶座环顾、旁边车驾驶座、K4 低机位），没有一个像素透过去看到零件里面（成片的背面）',
    Object.keys(out).length === 24 && bad.length === 0, bad.length ? Object.fromEntries(bad.slice(0, 4)) : { views: V.length, models: Object.keys(out).length });
}

// =====================================================================
// polish（返修 FE1P：主会话裁定 H1 前大灯灯盒、H2 安全带、H3 仪表台大灯开关 + 卷收器、H4 可动模型配重缝、H5 门架链条、H12 断电时新载入区块的灯）
// =====================================================================
// 「看不穿」的判断（H1 灯盒、H4 配重）：从眼点往一个实心零件里面的点连线，线段到达那个点之前必须碰到至少一个正面三角形
// （三角形绕向 = 渲染时的正反面，背面被剔掉，画面上显示的是视线碰到的第一个正面）。一个正面都没碰到，
// 就是从那个眼点能看进这个零件里面、透过它看到后面的东西
function pagePolish() {
  const T = window.__fl1, F = BR.L1forklift, G = F.geo, out = {};
  const FK_COL = { belt: [0.95, 0.42, 0.08], steel: [0.48, 0.5, 0.53], black: [0.07, 0.07, 0.075], link: [0.36, 0.35, 0.33] };   // L1.js 的 FK 色表
  const PARK = [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['low', 'low']];   // 返修 FE1R · K3：停放档只剩这四档
  const DRV = [['high', 'high'], ['mid', 'high'], ['lite', 'high'], ['drvLow', 'low']];
  // 线段 p → p + d（参数 0..1）和三角形：返回 [参数, 正面?] 或 null
  const segHit = (p, d, t) => {
    const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2], e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
    const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(a) < 1e-14) return null;
    const f = 1 / a, sx = p[0] - t[0], sy = p[1] - t[1], sz = p[2] - t[2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    const w = f * (e2x * qx + e2y * qy + e2z * qz);
    if (!(w > 1e-9 && w < 1)) return null;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    return [w, nx * d[0] + ny * d[1] + nz * d[2] < 0];
  };
  const leaks = (tris, eyes, targets, max) => {
    const bad = [];
    let n = 0;
    for (const e of eyes) for (const q of targets) {
      const d = [q[0] - e[0], q[1] - e[1], q[2] - e[2]];
      let front = false, back = 0;
      for (const t of tris) { const h = segHit(e, d, t); if (h) { if (h[1]) { front = true; break; } back++; } }
      n++;
      if (!front) { if (bad.length < (max || 6)) bad.push({ eye: e.map(v => +v.toFixed(3)), at: q.map(v => +v.toFixed(3)), why: back ? '只碰到背面' : '一个面都没碰到' }); else bad.push(null); }
    }
    return { rays: n, leaks: bad.length, ex: bad.filter(Boolean) };
  };
  const grid = (b, k) => { const o = []; for (const fx of k) for (const fy of k) for (const fz of k) o.push([b[0] + (b[3] - b[0]) * fx, b[1] + (b[4] - b[1]) * fy, b[2] + (b[5] - b[2]) * fz]); return o; };
  const colKey = c => c.map(v => Math.round(v * 1e5)).join(',');
  const triCol = (m, t) => { const a = m.accs.get(t[9]); const v = t[11]; return colKey([a.col[v * 3], a.col[v * 3 + 1], a.col[v * 3 + 2]]); };
  const sig = list => list.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]).sort().join(';');

  // ---------- H1 前大灯灯盒：驾驶座、车外站着能到的地方都看不穿 ----------
  {
    const eyes = [[G.eye.x, G.eye.y, G.eye.z], [G.eye.x - 0.06, G.eye.y, G.eye.z], [G.eye.x + 0.06, G.eye.y, G.eye.z]];
    for (const x of [-3.2, -2.2, -1.2, 1.2, 2.2, 3.2]) for (const z of [-3.6, -2.6, -1.6, -0.6, 0.24, 1.0, 2.0, 3.0]) {
      if (Math.abs(x) < 0.9 && z > -2.5 && z < 1.7) continue;
      eyes.push([x, 1.62, z]);
    }
    for (const z of [-3.6, -2.8, 2.2, 3.2]) eyes.push([0, 1.62, z]);
    out.lamp = {};
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q);
      const L = F.lod[detail];
      const targets = [];
      for (const s of [-1, 1]) targets.push(...grid([s * 0.43 - 0.04, 1.86, -0.685, s * 0.43 + 0.04, 1.94, -0.597], [0.15, 0.5, 0.85]));
      // 灯盒五个方向的面都有（按法线数；顶面 1.94 m 比站着、坐着的眼睛都高，谁都看不到，不画）
      const dirs = new Set();
      for (const t of m.tris) {
        if (t[10] !== 'postFL' && t[10] !== 'postFR') continue;
        const bb = T.bbox([t]);
        if (Math.abs(Math.abs((bb[0] + bb[3]) / 2) - 0.43) > 0.045 || bb[1] < 1.859 || bb[4] > 1.941 || bb[2] < -0.686 || bb[5] > -0.596) continue;
        const n = T.normal(t);
        dirs.add(n.map(v => Math.round(v)).join(','));
      }
      out.lamp[detail + (drive ? '/drive' : '')] = Object.assign(leaks(m.tris, eyes, targets), { lampF: L.lampF, dirs: dirs.size, eyes: eyes.length });
    }
  }

  // ---------- H1c（返修 r2，验收员 spec）可动模型坐着、站着看得见的几处空口都封上 ----------
  // 外门架顶梁两头（车侧站着）、护顶两侧纵梁 / 前后横梁 / 格栅横条、起升油缸缸口、杆头底面、挡货架立柱顶、扶手顶端（驾驶座）：
  // 往这些零件里面的点连线，到达之前都先碰到正面（可动模型 4 档；停着的车 FE1 时就有这些口子，golden 锁着没动）
  {
    const seat = [[G.eye.x, G.eye.y, G.eye.z], [G.eye.x - 0.06, G.eye.y, G.eye.z], [G.eye.x + 0.06, G.eye.y, G.eye.z]];
    const side = [];
    for (const sx of [-1, 1]) for (const z of [-1.6, -1.25, -0.925, -0.6, -0.3]) for (const x of [1.2, 2.0, 3.0]) side.push([sx * x, 1.62, z]);
    const gridIn = (x0, y0, z0, x1, y1, z1, fy) => { const o = []; for (const fx of [0.1, 0.5, 0.9]) for (const f2 of fy || [0.5, 0.9, 0.97]) for (const fz of [0.1, 0.5, 0.9]) o.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * f2, z0 + (z1 - z0) * fz]); return o; };
    const zb = y => -0.69 + (y - 0.99) / 1.08 * 0.17;
    out.drvShut = {};
    for (const [detail, q] of DRV) {
      const L = F.lod[detail], m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: 2 }, q);
      const parts = {};
      const beam = [], rail = [], cross = [], slat = [], cyl = [], head = [], post = [], handle = [];
      for (const s of [-1, 1]) {
        beam.push(...gridIn(s * 0.34, 1.9, -0.94, s * 0.3649, 1.98, -0.91, [0.1, 0.5, 0.9]));
        rail.push(...gridIn(s * 0.4, 2.04, -0.6, s * 0.46, 2.1, 0.54, [0.03, 0.5, 0.97]));
        if (L.cyl) cyl.push([s * 0.2, 1.7495, -0.895], [s * 0.2, 1.7495, -0.893]);
        head.push(...gridIn(s * 0.2 - 0.025, 2.06, -0.96, s * 0.2 + 0.025, 2.115, -0.835, [0.03, 0.1, 0.5]));
        post.push(...gridIn(s * 0.42, 0.54, -1.1, s * 0.46, 1.24, -1.07, [0.98, 0.995]));
      }
      for (const z of [-0.59, 0.53]) cross.push(...gridIn(-0.35, 2.04, z - 0.03, 0.35, 2.1, z + 0.03, [0.03, 0.5, 0.97]));
      for (const z of F.slatZ(L.slats)) slat.push(...gridIn(-0.35, 2.07, z - 0.025, 0.35, 2.085, z + 0.025, [0.5]));
      if (L.handle === 1) for (const y of [1.6, 1.612, 1.617]) for (const dx of [-0.008, 0, 0.008]) handle.push([-0.43 + dx, y, zb(y) + 0.012]);
      if (L.handle === 2) for (const y of [1.59, 1.605, 1.617]) for (const dx of [-0.008, 0, 0.008]) handle.push([-0.43 + dx, y, zb(y) + 0.05]);   // repair-r1：high 档扶手顶端
      parts.beam = leaks(m.tris, side, beam);
      for (const [k, tg] of [['rail', rail], ['cross', cross], ['slat', slat], ['cyl', cyl], ['head', head], ['post', post], ['handle', handle]]) if (tg.length) parts[k] = leaks(m.tris, seat, tg);
      out.drvShut[detail] = parts;
    }
  }

  // ---------- J11（返修 FE1Q，主会话裁定）停着的车和开过的车一样实心：站着（1.62）、坐在旁边另一台车上（1.8）能到的地方看过去 ----------
  // 停放 6 档（high / mid / lite / low / lowb / min）和可动模型 4 档：往下面这些零件里面连线，到达之前都先碰到正面 ——
  // r2 只给可动模型补的那几处（外门架顶梁两头、护顶纵梁 / 横梁 / 横条、缸口、杆头底、挡货架立柱顶、扶手顶端），
  // 加上背面探针在停着的车上找到的（trim 档的挡货架顶横梁 / 立柱、内门架顶梁、不倒角档的挡货架竖条、配重下半截前脸、轮胎贴车架那面、min 的链条背面）
  {
    const eyes = [];
    for (const h of [1.62, 1.8]) {
      for (const x of [-3.2, -2.2, -1.2, 1.2, 2.2, 3.2]) for (const z of [-3.6, -2.6, -1.6, -0.6, 0.24, 1.0, 2.0, 3.0]) {
        if (Math.abs(x) < 0.9 && z > -2.5 && z < 1.7) continue;
        eyes.push([x, h, z]);
      }
      for (const x of [-0.8, 0, 0.8]) for (const z of [-3.6, -2.8, 2.2, 3.2]) eyes.push([x, h, z]);
      for (const sx of [-1, 1]) for (const z of [-1.4, -1.0, -0.4, 0.3, 0.9]) eyes.push([sx * 0.92, h, z]);   // 贴着车侧站（人的半径 0.3，离车身侧面 x 0.6 再留 2 cm）
    }
    const gIn = (x0, y0, z0, x1, y1, z1, fs) => { const f = fs || [0.15, 0.5, 0.85], o = []; for (const a of f) for (const c of f) for (const d of f) o.push([x0 + (x1 - x0) * a, y0 + (y1 - y0) * c, z0 + (z1 - z0) * d]); return o; };
    const zb = y => -0.69 + (y - 0.99) / 1.08 * 0.17;
    out.parkShut = { eyes: eyes.length, tiers: {} };
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const L = F.lod[detail], m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q), tg = {};
      tg.beam = []; tg.rail = []; tg.post = []; tg.tire = []; tg.chain = [];
      for (const s of [-1, 1]) {
        tg.beam.push(...gIn(s * 0.34, 1.9, -0.94, s * 0.3649, 1.98, -0.91));
        tg.rail.push(...gIn(s * 0.4, 2.04, -0.6, s * 0.46, 2.1, 0.54, [0.03, 0.5, 0.97]));
        tg.post.push(...gIn(s * 0.42, 0.54, -1.1, s * 0.46, 1.24, -1.07, [0.2, 0.6, 0.98]));
        if (L.cyl) (tg.cyl || (tg.cyl = [])).push([s * 0.2, 1.7495, -0.895], [s * 0.2, 1.7495, -0.893], [s * 0.2, 1.2, -0.865]);
        (tg.head || (tg.head = [])).push(...gIn(s * 0.2 - 0.025, 2.06, -0.96, s * 0.2 + 0.025, 2.115, -0.835, [0.03, 0.1, 0.5]));
        tg.tire.push([s * 0.48, 0.29, -0.62 - 0.23], [s * 0.48, 0.29 + 0.16, -0.62 - 0.16], [s * 0.44, 0.23, 0.8 + 0.19], [s * 0.44, 0.23, 0.8 - 0.19]);
        tg.chain.push([s * 0.12, 1.0, -1.045], [s * 0.12, 1.6, -1.045]);
      }
      tg.cross = []; for (const z of [-0.59, 0.53]) tg.cross.push(...gIn(-0.35, 2.04, z - 0.03, 0.35, 2.1, z + 0.03, [0.03, 0.5, 0.97]));
      if (L.slats) { tg.slat = []; for (const z of F.slatZ(L.slats)) tg.slat.push(...gIn(-0.35, 2.07, z - 0.025, 0.35, 2.085, z + 0.025, [0.5])); }
      if (L.handle === 1) { tg.handle = []; for (const y of [1.3, 1.6, 1.612, 1.617]) for (const dx of [-0.008, 0, 0.008]) tg.handle.push([-0.43 + dx, y, zb(y) + 0.012]); }
      if (L.handle === 2) { tg.handle = []; for (const y of [1.3, 1.59, 1.605, 1.617]) for (const dx of [-0.008, 0, 0.008]) tg.handle.push([-0.43 + dx, y, zb(y) + 0.05]); }   // repair-r1：high 档扶手顶端
      // repair-r1（验收员 spec）：警示灯罩里面（灯罩底圈以前悬出后横梁 1.5 cm、又不画底，从车后站着往上看透得过去）
      if (L.beacon) { tg.beacon = []; for (const y of [2.1005, 2.11, 2.14]) for (const dx of [-0.02, 0, 0.02]) for (const dz of [-0.02, 0, 0.02]) tg.beacon.push([dx, y, 0.53 + dz]); }
      tg.topbar = gIn(-0.4, 1.2, -1.1, 0.4, 1.24, -1.07);
      tg.innerTop = gIn(-0.2, 2.04, -0.965, 0.2, 2.12, -0.93);
      if (L.back.length) { tg.bars = []; for (const x of L.back) tg.bars.push(...gIn(x - 0.0125, 0.6, -1.095, x + 0.0125, 1.15, -1.075)); }
      tg.cwLow = []; for (const x of [-0.45, -0.2, 0.2, 0.45]) for (const y of [0.2, 0.4]) tg.cwLow.push([x, y, 1.12]);
      const row = {};
      for (const [k, t] of Object.entries(tg)) if (t.length) row[k] = leaks(m.tris, eyes, t, 3);
      out.parkShut.tiers[detail + (drive ? '/drive' : '')] = row;
    }
    // 后视镜（返修 FE1Q · J11）：镜片以前离镜壳 3 mm，车左前方站着斜看，视线从缝里穿过去打到镜片背面（r3 验收员 spec：
    // 眼点 (−1.22, 1.62, −0.74) 看左大灯里 (−0.4, 1.865, −0.615)）。左前方一片密一点的眼点往大灯、镜壳、左前立柱里面连线
    const me = [];
    for (const h of [1.62, 1.8]) for (let x = -1.9; x <= -0.9 + 1e-9; x += 0.1) for (let z = -1.4; z <= -0.2 + 1e-9; z += 0.1) me.push([+x.toFixed(2), h, +z.toFixed(2)]);   // 人的半径 0.3：离车身侧面（x −0.6）≥0.3
    // 返修 FE1R：后视镜（以前只有 high 档有）为了可动模型 ≤2000 面去掉了 —— 只查左大灯、左前立柱这一片；哪一档还有后视镜就连镜壳一起查
    out.mirror = {};
    for (const [detail, q, drive] of [['high', 'high', false], ['high', 'high', true], ['mid', 'high', false], ['mid', 'high', true]]) {
      const mt = gIn(-0.47, 1.86, -0.685, -0.39, 1.94, -0.597).concat(F.lod[detail].mirror ? gIn(-0.585, 1.745, -0.66, -0.505, 1.835, -0.648) : [], [[-0.4, 1.865, -0.615]]);
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q);
      out.mirror[detail + (drive ? '/drive' : '')] = leaks(m.tris, me, mt, 4);
    }
  }

  // ---------- H2 安全带 ----------
  if (F.belt) {
    const B = F.belt, beltC = colKey(T.storedColor(FK_COL.belt)), steelC = colKey(T.storedColor(FK_COL.steel)), blackC = colKey(T.storedColor(FK_COL.black));
    const inBeltZone = t => { const bb = T.bbox([t]); const ax = Math.abs((bb[0] + bb[3]) / 2); return ax > 0.233 && ax < 0.29 && bb[1] >= 0.99 && bb[4] <= 1.5 && bb[2] >= 0.19 && bb[5] <= 0.47; };
    const redC = colKey(T.storedColor([0.78, 0.07, 0.05])), slotC = colKey(T.storedColor([0.03, 0.03, 0.03]));
    const beltPart = m => m.tris.filter(t => t[10] === 'seat' && inBeltZone(t) && [beltC, steelC, blackC, redC, slotC].includes(triCol(m, t)));
    out.belt = { parts: {}, seatSame: {}, strap: {}, gap: {}, body: {} };
    let ref = null;
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q);
      const bp = beltPart(m), sg = sig(bp);
      if (!ref) ref = sg;
      out.belt.parts[detail + (drive ? '/drive' : '')] = { tris: bp.length, same: sg === ref };
      // 带子 / 锁舌 / 短带 / 扣头的顶点离坐垫、靠背的三角形多远（不穿进去、不共面），锁舌离坐垫右侧面多远（贴着）
      const seatT = m.tris.filter(t => t[10] === 'seat' && !bp.includes(t) && triCol(m, t) !== blackC);
      const near = (pts) => { let d = Infinity; for (const p of pts) for (const t of seatT) d = Math.min(d, T.ptTri(p[0], p[1], p[2], t)); return d; };
      const boxPts = b => { const o = []; for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) o.push([x, y, z]); return o; };
      const inSeat = p => Math.abs(p[0]) < 0.25 && p[1] < 1.16 && p[1] > 1.0 && p[2] > 0.02 && p[2] < 0.46;
      const pen = ['strap', 'tongue', 'stub', 'buckle'].map(k => boxPts(B[k]).filter(inSeat).length).reduce((a, b2) => a + b2, 0);
      // 扣头（返修 FE1R · K9 抬高到坐垫顶面以上）：坐垫顶上一圈倒圆，扣头旁边的坐垫侧面往里收了 —— 量到坐垫左侧面那个平面（x −0.25）
      out.belt.gap[detail + (drive ? '/drive' : '')] = { strap: +near(boxPts(B.strap)).toFixed(4), tongue: +near(boxPts(B.tongue)).toFixed(4), stub: +near(boxPts(B.stub)).toFixed(4), buckle: +(-0.25 - B.buckle.x1).toFixed(4), pen };
      if (!drive) {
        const md = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: 2 }, q);
        out.belt.seatSame[detail] = sig(m.tris.filter(t => t[10] === 'seat')) === sig(md.tris.filter(t => t[10] === 'seat'));
      }
    }
    // 右边那条带子是竖直的（所有顶点 x、z 都在带子的盒子里）、上头伸进卷收器、下头伸进锁舌；锁舌在坐垫右侧面外 0.5–2 mm、高度在坐垫侧面的平面段里
    const m = T.buildModel({ part: 'body', detail: 'mid', number: 88, drive: true, levers: 2 }, 'high');
    const st = m.tris.filter(t => triCol(m, t) === beltC && T.bbox([t])[0] > 0);
    const bb = T.bbox(st), R = B.retractor;
    out.belt.strap = { bbox: bb.map(v => +v.toFixed(4)), vertical: bb[3] - bb[0] <= 0.0041 && bb[5] - bb[2] <= 0.0441 + 1e-9,
      intoRetractor: bb[4] > R.y && bb[4] < R.y + R.h && bb[0] > R.x - R.w / 2 && bb[3] < R.x + R.w / 2 && bb[2] > R.z - R.d / 2 && bb[5] < R.z + R.d / 2,
      intoTongue: bb[1] > B.tongue.y0 && bb[1] < B.tongue.y1, tongueGap: +(B.tongue.x0 - 0.25).toFixed(4), tongueY: [B.tongue.y0, B.tongue.y1], stubFoot: B.stub.y0 };
    // 坐着的人（联机队友 / 本机坐姿人形，coop.seatBody）的胯和大腿离带子各件 ≥1 cm
    if (BR.coop && typeof BR.coop.seatBody === 'function') {
      const bpT = beltPart(T.buildModel({ part: 'all', detail: 'mid', number: 88, drive: true, levers: 2 }, 'high'));
      const bv = []; for (const t of bpT) for (let j = 0; j < 9; j += 3) bv.push([t[j], t[j + 1], t[j + 2]]);
      for (const det of ['high', 'low']) {
        const sb = BR.coop.seatBody({ detail: det });
        if (!sb) { out.belt.body[det] = null; continue; }
        const V = sb.verts;
        let d1 = Infinity, d2 = Infinity, at = null;
        for (let i = 0; i < V.length; i += 3) {
          const x = V[i], y = V[i + 1], z = V[i + 2];
          if (Math.abs(x) < 0.15) continue;   // 正中间（脊柱、胸口）离两边的带子远，省点时间
          for (const t of bpT) { const d = T.ptTri(x, y, z, t); if (d < d1) { d1 = d; at = [x, y, z].map(v => +v.toFixed(3)); } }
          for (const p of bv) d2 = Math.min(d2, Math.hypot(p[0] - x, p[1] - y, p[2] - z));
        }
        out.belt.body[det] = { bodyToBelt: +d1.toFixed(4), beltToBody: +d2.toFixed(4), at, box: sb.box };
      }
    }
  }

  // ---------- 返修 FE1Q · repair-r2（验收员 play / spec：坐在叉车上的人靴底悬在地台上方 3.65 cm、靴跟插进发动机盖前脸 2.95 cm）----------
  // coop.seatBody（联机队友坐车、测试人形同一套摆法）的全部顶点，车本地坐标：最低点离驾驶位地台顶面（0.615）0–5 mm、不低于防滑棱顶（0.618）；
  // 没有顶点在发动机盖里（x ±0.53、y 0.4–1.0，前脸 z −0.1、0.93 以上斜切到 (−0.03, 1.0)，留 5 mm）、仪表台里（x ±0.47、y 0.58–0.86、z < −0.56）
  out.seatFeet = {};
  if (BR.coop && typeof BR.coop.seatBody === 'function') for (const det of ['high', 'low']) {
    const sb = BR.coop.seatBody({ detail: det });
    if (!sb) { out.seatFeet[det] = null; continue; }
    const V = sb.verts;
    let minY = Infinity, hood = 0, hoodDeep = 0, dash = 0, heel = -Infinity, ex = null;
    for (let i = 0; i < V.length; i += 3) {
      const x = V[i], y = V[i + 1], z = V[i + 2];
      minY = Math.min(minY, y);
      if (y < 0.75) heel = Math.max(heel, z);
      const zf = y < 0.93 ? -0.1 : -0.1 + (y - 0.93);
      if (Math.abs(x) < 0.53 && y > 0.4 && y < 1.0 && z > zf - 0.005) { hood++; hoodDeep = Math.max(hoodDeep, z - zf); if (!ex) ex = [x, y, z].map(v => +v.toFixed(4)); }
      if (Math.abs(x) < 0.47 && y > 0.58 && y < 0.86 && z < -0.56) dash++;
    }
    out.seatFeet[det] = { minY: +minY.toFixed(4), aboveMat: +(minY - 0.615).toFixed(4), heelZ: +heel.toFixed(4), hood, hoodDeep: +hoodDeep.toFixed(4), dash, ex };
  }

  // ---------- H3 仪表台大灯开关：停着的车 high / mid / lite 有，和 dashSwitch 那一份逐个三角形一样；low 及以下没有；可动模型不在 L1 里画 ----------
  if (!F.dashSwitch) out.sw = { tris: 0, mats: [], parked: {}, missing: true };
  else {
    const b = T.builder(); F.dashSwitch(b);
    const sw = []; b._accs.forEach((a, k) => { for (let i = 0; i < a.idx.length; i += 3) { const t = []; for (let j = 0; j < 3; j++) { const v = a.idx[i + j]; t.push(a.pos[v * 3], a.pos[v * 3 + 1], a.pos[v * 3 + 2]); } t.push(k); sw.push(t); } });
    const swSig = new Set(sw.map(t => t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9]));
    out.sw = { tris: sw.length, mats: Array.from(new Set(sw.map(t => t[9]))), parked: {} };
    // 和载具层（vehicles.js buildSwitch，上车以后画的那个，拨杆扳在「开」）逐个三角形比对：几何一样（≤1 µm），颜色、材质也一样 ——
    // 返修 FE1R · K5：载具层的指示灯也有熄着的那一份（kit:prop、暗绿，_switchGeo(1) 缺省取它），和停着的车一模一样；亮着那份（_switchGeo(1, true)）在 kit:glow
    const vg = BR.vehicles && typeof BR.vehicles._switchGeo === 'function' ? BR.vehicles._switchGeo(1) : null;
    const vgOn = BR.vehicles && typeof BR.vehicles._switchGeo === 'function' ? BR.vehicles._switchGeo(1, true) : null;
    out.sw.vehOn = vgOn ? { tris: vgOn.length, glow: vgOn.filter(t => t[9] === 'kit:glow').length } : null;
    if (!vg) out.sw.veh = { missing: true };
    else {
      const parkedCol = [];
      b._accs.forEach((a, k) => { for (let i = 0; i < a.idx.length; i += 3) { const v = a.idx[i]; parkedCol.push(a.col && a.col.length >= v * 3 + 3 ? [a.col[v * 3], a.col[v * 3 + 1], a.col[v * 3 + 2]] : null); } });
      const used = new Array(vg.length).fill(false), bad = [];
      let lamp = 0, sameCol = 0;
      sw.forEach((t, i) => {
        let j = -1;
        for (let q = 0; q < vg.length && j < 0; q++) {
          if (used[q]) continue;
          let ok = true;
          for (let c = 0; c < 9 && ok; c++) if (Math.abs(vg[q][c] - t[c]) > 1e-6) ok = false;
          if (ok) j = q;
        }
        if (j < 0) { bad.push('noMatch:' + i); return; }
        used[j] = true;
        const u = vg[j], pc = parkedCol[i], vc = u.length >= 13 ? [u[10], u[11], u[12]] : null;
        const colEq = pc && vc && pc.every((x, c) => Math.abs(x - vc[c]) < 1e-6);
        if (u[9] === 'kit:glow') { lamp++; if (t[9] !== 'kit:prop') bad.push('lampMat:' + i); }
        else if (u[9] !== t[9] || !colEq) bad.push('mat/col:' + i + ':' + u[9] + '/' + t[9]);
        else sameCol++;
      });
      out.sw.veh = { tris: vg.length, matched: used.filter(Boolean).length, lamp, sameCol, bad: bad.slice(0, 8) };
    }
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q);
      const got = m.tris.filter(t => swSig.has(t.slice(0, 9).map(x => Math.round(x * 1e6)).join(',') + '|' + t[9])).length;
      out.sw.parked[detail + (drive ? '/drive' : '')] = got;
    }
  }

  // ---------- H4 可动模型配重缝：轮罩外侧下方的低机位往上看，不透过车身 ----------
  {
    const eyes = [[-1.2, 0.3, 0.2], [1.5, 0.4, 0]];
    for (const sx of [-1, 1]) for (const x of [0.75, 1.0, 1.5]) for (const y of [0.15, 0.3, 0.45, 0.6]) for (const z of [0.2, 0.55, 0.8, 1.1, 1.45]) eyes.push([sx * x, y, z]);
    const targets = [];
    for (const x of [-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45]) for (const y of [0.55, 0.75, 0.95]) for (const z of [0.62, 0.8, 0.95, 1.1]) targets.push([x, y, z]);
    for (const x of [-0.45, -0.3, 0.3, 0.45]) for (const y of [0.45, 0.6]) for (const z of [0.3, 0.5]) targets.push([x, y, z]);   // 发动机盖里面
    out.cw = {};
    const parts = ['body', 'liftLever', 'wheelsFront', 'steeringWheel', 'mastOuter', 'mastInner', 'carriage', 'chains'];
    for (const [list, drive] of [[DRV, true], [PARK, false]]) for (const [detail, q] of list) for (const steer of drive ? [0, G.maxSteer, -G.maxSteer] : [0]) {
      let tris = [];
      for (const part of parts) tris = tris.concat(T.buildModel({ part, detail, number: 88, drive, levers: 2 }, q).tris);
      for (const part of ['wheelRearL', 'wheelRearR']) tris = tris.concat(T.buildModel({ part, detail, number: 88, drive, levers: 2, steer }, q).tris);
      out.cw[detail + (drive ? '/drive' : '') + '/steer' + steer.toFixed(2)] = leaks(tris, eyes, targets);
    }
    // 返修 r1（验收员 spec）：站着、坐着的眼高（1.0–1.8 m）从车四周往配重下半截里面、驾驶位地台下面连线 —— 以前配重上下两截在后角
    // 差 3–5 mm（y 0.5 一条楔形缝）、mid / lite / drvLow 的地台没有侧面，站在车后侧角、车侧都看得到车底地面
    const eyesS = [[1.58, 1.8, 0.48], [-1.58, 1.8, 0.48], [1.39, 1.3, 1.0], [-1.39, 1.3, 1.0], [1.58, 1.62, 0.48], [-1.58, 1.62, 0.48], [1.39, 1.0, 1.0]];
    for (const sx of [-1, 1]) for (const x of [0.9, 1.2, 1.6]) for (const y of [1.0, 1.3, 1.62, 1.8]) for (const z of [-0.6, -0.2, 0.2, 0.5, 0.9, 1.3, 1.7]) eyesS.push([sx * x, y, z]);
    const targetsS = [];
    for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) for (const y of [0.2, 0.35]) for (const z of [1.12, 1.18]) targetsS.push([x, y, z]);   // 配重下半截里面
    for (const x of [-0.3, 0, 0.3]) for (const z of [-0.4, -0.2]) targetsS.push([x, 0.55, z]);   // 驾驶位地台下面（车架里）
    out.cwS = {};
    for (const [list, drive] of [[DRV, true], [PARK, false]]) for (const [detail, q] of list) {
      let tris = [];
      for (const part of parts.concat(['wheelRearL', 'wheelRearR'])) tris = tris.concat(T.buildModel({ part, detail, number: 88, drive, levers: 2, steer: 0 }, q).tris);
      out.cwS[detail + (drive ? '/drive' : '')] = leaks(tris, eyesS, targetsS);
    }
  }

  // ---------- H5 链条 ----------
  {
    const sp = G.sprocket, linkC = colKey(T.storedColor(FK_COL.link)), steelC = colKey(T.storedColor(FK_COL.steel));
    out.chain = {};
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const L = F.lod[detail], row = { links: L.links, arcSeg: L.arc, sprocket: L.sprocket };
      for (const lift of [0, 0.5, 1]) {
        const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2, lift }, q);
        const cy = sp.y + G.pose(lift).inner, ch = m.tris.filter(t => t[10] === 'chains');
        const r = { top: -Infinity, arcPts: 0, arcIn: Infinity, arcLight: 0 };
        // 返修 FE1R · repair-r1：链条整根在链条材质里，链板一深一浅画在贴图里 —— 查材质、每个顶点的 v × 周期（两节）= 这一点在链条上的弧长 s
        //（s 从货叉架挂点算：前段 y − y0、链轮上 hf + R·θ、后段 hf + πR + (cy − y)），升降时链节跟着链条走
        r.mats = Array.from(new Set(ch.map(t => t[9])));
        {
          const a = m.accs.get(F.chainMat), per = 2 * L.links, y0 = G.chain.carriageY + G.pose(lift).carriage, R = sp.z - G.chain.z, hf = cy - y0;
          let worst = 0, n = 0;
          if (a && per > 0) for (let v = 0; v < a.n; v++) {
            if (a.uv[v * 2] * F.atlas.size > 130) continue;   // repair-r2：这个材质里还有图集别的块（车号、表盘、轮辋……），只看链条那一列
            const x = a.pos[v * 3], y = a.pos[v * 3 + 1], z = a.pos[v * 3 + 2];
            let sx;
            if (y <= cy + 1e-9) sx = z < sp.z ? y - y0 : hf + Math.PI * R + (cy - y);
            else { const th = Math.atan2(y - cy, sp.z - z); sx = hf + R * (th < 0 ? th + 2 * Math.PI : th); }
            worst = Math.max(worst, Math.abs(a.uv[v * 2 + 1] * per - sx)); n++;
          }
          r.uvErr = +worst.toFixed(5); r.uvN = n;
        }
        for (const t of ch) {
          const area = T.bbox([t]);
          if (area[4] - area[1] < 1e-9 && area[5] - area[2] < 1e-9 && area[3] - area[0] < 1e-9) continue;   // 缩成一点的占位
          for (let j = 0; j < 9; j += 3) {
            const y = t[j + 1], z = t[j + 2];
            r.top = Math.max(r.top, y);
            if (y > cy + 1e-6) { r.arcPts++; }
          }
          // 绕在链轮上那段外表面（法线朝外、高于链轮中心）：弦的中点离链轮轴 > 链轮半径
          const n = T.normal(t);
          if (Math.abs(n[0]) < 0.1 && Math.min(t[1], t[4], t[7]) >= cy - 1e-6) {
            const my = (t[1] + t[4] + t[7]) / 3 - cy, mz = (t[2] + t[5] + t[8]) / 3 - sp.z;
            r.arcIn = Math.min(r.arcIn, Math.hypot(my, mz));
            if (triCol(m, t) === linkC) r.arcLight++;
          }
        }
        // 链轮：侧面有几个不同方向的顶点（棱数）、两个端面
        const spr = m.tris.filter(t => t[10] === 'mastInner' && triCol(m, t) === steelC && Math.abs(Math.abs((t[0] + t[3] + t[6]) / 3) - sp.x) < 0.016 && Math.abs((t[1] + t[4] + t[7]) / 3 - cy) < sp.r && Math.abs((t[2] + t[5] + t[8]) / 3 - sp.z) < sp.r);
        const ang = new Set(), caps = new Set();
        for (const t of spr) {
          const n = T.normal(t);
          if (Math.abs(n[0]) > 0.99) { caps.add(Math.sign((t[0] + t[3] + t[6]) / 3) + '/' + Math.sign(n[0])); continue; }
          for (let j = 0; j < 9; j += 3) if (Math.abs(Math.hypot(t[j + 1] - cy, t[j + 2] - sp.z) - sp.r) < 1e-4) ang.add(Math.round(Math.atan2(t[j + 1] - cy, t[j + 2] - sp.z) * 1e4));
        }
        // 返修 FE1R：链轮上半圈包在链条里、只画下半圈 —— 按轮缘相邻顶点的角度差折算一圈多少棱
        const as = Array.from(ang).sort((a, b2) => a - b2), dd = []; for (let i = 1; i < as.length; i++) dd.push((as[i] - as[i - 1]) / 1e4);
        const step = dd.length ? Math.min(...dd.filter(x => x > 0.05)) : 0;
        r.sprocketSides = step ? Math.round(2 * Math.PI / step) : 0; r.caps = caps.size; r.rimVerts = as.length;
        r.wantTop = +(cy + (sp.z - G.chain.z) + 0.006).toFixed(4);
        r.obbTop = +(G.obbs(lift).find(o => o.name === 'mastInner').cy + G.obbs(lift).find(o => o.name === 'mastInner').hy).toFixed(4);
        r.top = +r.top.toFixed(4); r.arcIn = +r.arcIn.toFixed(4);
        row['lift' + lift] = r;
      }
      if (drive) {   // 可动模型：链条部件的顶点数、索引数和 lift 无关（载具层按 lift 重建时不超出预留）
        const cnt = new Set();
        for (let i = 0; i <= 40; i++) {
          const b = T.builder(); const q0 = BR.game.settings.quality; T.setQ(q);
          F.model(b, { part: 'chains', detail, number: 88, drive: true, levers: 2, lift: i / 40 + (i % 3 === 1 ? 0.0037 : 0) });
          T.setQ(q0);
          const a = b._accs.get(F.chainMat); cnt.add(a.n + '/' + a.idx.length);
        }
        row.counts = Array.from(cnt);
      }
      out.chain[detail + (drive ? '/drive' : '')] = row;
    }
  }
  // ---------- 返修 FE1Q · repair-r1（验收员 play：方向盘、车轮、表盘一眼看出是多边形）：圆的零件按顶点量棱数 ----------
  // 方向盘轮圈：外侧那圈顶点绕方向盘轴有几个不同的角度；轮胎 / 轮辋 / 轮毂盖：绕轮轴；表盘：每块白色圆盘几个顶点、有没有指针（深红细条）
  {
    const SW = G.steerWheel, ca = Math.cos(SW.tilt), sa = Math.sin(SW.tilt), ax = [0, ca, sa], e2 = [0, -sa, ca];   // e2 = ax × x̂ 的反向，只用来量角度
    const C = { tire: colKey(T.storedColor([0.1, 0.1, 0.1])), lug: colKey(T.storedColor([0.055, 0.055, 0.055])), rim: colKey(T.storedColor([0.66, 0.66, 0.63])),
      hub: colKey(T.storedColor([0.3, 0.3, 0.31])), black: colKey(T.storedColor([0.07, 0.07, 0.075])), gauge: colKey(T.storedColor([0.62, 0.62, 0.6])), needle: colKey(T.storedColor([0.55, 0.08, 0.05])) };
    const angN = (pts, f) => { const s2 = new Set(); for (const p of pts) { const [u, v] = f(p); s2.add(((Math.round(Math.atan2(v, u) * 360 / Math.PI) % 720) + 720) % 720); } return s2.size; };
    out.round = {};
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, q), row = {}, LL = F.lod[detail];
      const ring = [], wheel = { tire: [], rim: [], hub: [], rear: [] }, gauge = [];
      let needle = 0;
      for (const t of m.tris) {
        const col = triCol(m, t);
        for (let j = 0; j < 9; j += 3) {
          const p = [t[j], t[j + 1], t[j + 2]];
          if (t[10] === 'steeringWheel' && col === C.black) {
            const d = [p[0] - SW.x, p[1] - SW.y, p[2] - SW.z], h = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
            const r = Math.hypot(d[0] - ax[0] * h, d[1] - ax[1] * h, d[2] - ax[2] * h);
            // 轮圈管截面外侧那两排顶点（离轴 R + 8 mm、轴向 ±1.4 cm）；助力球的底圈（轴向 0）、顶上（轴向 5.5 cm）不算
            if (r >= SW.r + 0.004 && Math.abs(h) > 0.005 && Math.abs(h) < 0.02) ring.push([d[0], d[1] * e2[1] + d[2] * e2[2]]);
            // 截面 2 边的轮圈（lowb / min：一圈 3.2 cm 高的扁带，顶点在半径 R、轴向 ±1.6 cm）
            else if (LL.ring[1] === 2 && Math.abs(r - SW.r) < 0.001 && Math.abs(Math.abs(h) - 0.016) < 0.001) ring.push([d[0], d[1] * e2[1] + d[2] * e2[2]]);
          }
          if (t[10] === 'wheelsFront' && p[0] > 0) {
            const W = G.wheelFront, dy = p[1] - W.y, dz = p[2] - W.z, r = Math.hypot(dy, dz);
            if ((col === C.tire || col === C.lug) && Math.abs(r - W.r) < 1e-4) wheel.tire.push([dy, dz]);
            // 返修 FE1R · repair-r2：前轮轮辋画在叉车图集（链条材质）里，正中的轮毂盖是贴图里的圆
            if ((col === C.rim || t[9] === F.chainMat) && Math.abs(r - W.r * 0.6) < 1e-4) wheel.rim.push([dy, dz]);
            if (col === C.hub && Math.abs(r - W.r * 0.2) < 1e-4) wheel.hub.push([dy, dz]);
          }
          if (t[10] === 'wheelRearR') {
            const W = G.wheelRear, dy = p[1] - W.y, dz = p[2] - W.z, r = Math.hypot(dy, dz);
            if ((col === C.tire || col === C.lug) && Math.abs(r - W.r) < 1e-4) wheel.rear.push([dy, dz]);
          }
          if (t[10] === 'dash' && col === C.gauge && j === 0) gauge.push(p);
        }
        if (t[10] === 'dash' && col === C.needle) needle++;
      }
      row.ring = angN(ring, q2 => q2);
      row.tire = angN(wheel.tire, q2 => q2); row.rim = angN(wheel.rim, q2 => q2); row.hub = wheel.hub.length ? angN(wheel.hub, q2 => q2) : 0; row.rear = angN(wheel.rear, q2 => q2);
      // 返修 FE1R · K8：后轮轮辋、气瓶端面、转向柱顶封口 / 柱身、警示灯罩、阀门的段数（按顶点绕各自轴的不同角度数）
      const rr = [], tk = [], col = [], bc = [], vl = [], hb = [];
      const tankC = colKey(T.storedColor([0.62, 0.64, 0.66])), amberC = colKey(T.storedColor([1.05, 0.58, 0.1])), brassC = colKey(T.storedColor([0.75, 0.58, 0.27]));
      for (const t of m.tris) {
        const cc = triCol(m, t);
        for (let j = 0; j < 9; j += 3) {
          const p = [t[j], t[j + 1], t[j + 2]];
          if (t[10] === 'wheelRearR' && cc === C.rim) { const W = G.wheelRear, dy = p[1] - W.y, dz = p[2] - W.z; if (Math.abs(Math.hypot(dy, dz) - W.r * 0.6) < 1e-4) rr.push([dy, dz]); }
          if (cc === tankC && Math.abs(p[0] - 0.36) < 1e-6) { const dy = p[1] - 1.32, dz = p[2] - 0.86; if (Math.abs(Math.hypot(dy, dz) - 0.15) < 1e-4) tk.push([dy, dz]); }
          if (t[10] === 'steer' && cc === C.black) { const d = [p[0] - SW.x, p[1] - SW.y, p[2] - SW.z], h = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; if (Math.abs(Math.hypot(d[0] - ax[0] * h, d[1] - ax[1] * h, d[2] - ax[2] * h) - 0.03) < 1e-4) col.push([d[0], d[1] * e2[1] + d[2] * e2[2]]); }
          if (cc === amberC && Math.abs(p[1] - 2.1) < 1e-6) bc.push([p[0], p[2] - 0.53]);
          // 返修 FE1R · repair-r1：铜阀门（绕 x 轴、半径 2.2 cm）、方向盘中心盖底圈（绕方向盘轴、半径 4 cm）
          if (cc === brassC) { const dy = p[1] - 1.32, dz = p[2] - 0.86; if (Math.abs(Math.hypot(dy, dz) - 0.022) < 1e-4) vl.push([dy, dz]); }
          if (t[10] === 'steeringWheel' && cc === C.black) { const d = [p[0] - SW.x, p[1] - SW.y, p[2] - SW.z], h = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; if (Math.abs(Math.hypot(d[0] - ax[0] * h, d[1] - ax[1] * h, d[2] - ax[2] * h) - 0.04) < 1e-4 && h < -0.01) hb.push([d[0], d[1] * e2[1] + d[2] * e2[2]]); }
        }
      }
      row.rimR = angN(rr, q2 => q2); row.tank = angN(tk, q2 => q2); row.column = angN(col, q2 => q2); row.beacon = angN(bc, q2 => q2);
      row.valve = angN(vl, q2 => q2); row.swHub = angN(hb, q2 => q2);
      // 返修 FE1R · repair-r2：表盘（圆盘 + 指针）、前轮轮毂盖画在叉车图集里（真圆）。表盘 = 仪表台上链条材质的贴图块，四个角的 uv 都在图集的表盘格子里；
      // 轮毂盖 = 前轮轮辋（链条材质的矮圆锥）的尖顶 uv 在轮辋格子正中
      const AT = F.atlas;
      const cellUV = (c, u, v) => u * AT.size >= c[0] - 1e-3 && u * AT.size <= c[0] + c[2] + 1e-3 && (1 - v) * AT.size >= c[1] - 1e-3 && (1 - v) * AT.size <= c[1] + c[3] + 1e-3;
      let gq = 0, gqOk = 0, hubTex = 0;
      const rc = AT.cells.rim, hubUV = [(rc[0] + rc[2] / 2) / AT.size, 1 - (rc[1] + rc[3] / 2) / AT.size];
      for (const t of m.tris) {
        if (t[9] !== F.chainMat) continue;
        const a = m.accs.get(t[9]), v0 = t[11];
        if (t[10] === 'dash' && cellUV(AT.cells.gauge, a.uv[v0 * 2], a.uv[v0 * 2 + 1])) { gq++; let ok = true;
          const P3 = [0, 3, 6].map(j => [t[j], t[j + 1], t[j + 2]]);
          for (const q of P3) { let best = -1, bd = 1e9; for (let i = 0; i < a.n; i++) { const d = Math.hypot(a.pos[i * 3] - q[0], a.pos[i * 3 + 1] - q[1], a.pos[i * 3 + 2] - q[2]); if (d < bd) { bd = d; best = i; } } if (!(bd < 1e-7 && cellUV(AT.cells.gauge, a.uv[best * 2], a.uv[best * 2 + 1]))) ok = false; }
          if (ok) gqOk++; }
        if (t[10] === 'wheelsFront' && Math.abs(a.uv[v0 * 2] - hubUV[0]) < 1e-6 && Math.abs(a.uv[v0 * 2 + 1] - hubUV[1]) < 1e-6) hubTex++;
      }
      row.gaugeQuads = gq / 2; row.gaugeUVok = gqOk === gq; row.hubTex = hubTex;
      row.gaugesWant = F.lod[detail].gauges;
      // 助力球（repair-r2 补回来）：绕它自己的轴（方向盘轴方向、过轮圈 0.8π 处往里 4.5 mm）的不同角度数
      { const kd = [Math.cos(0.8 * Math.PI), Math.sin(SW.tilt) * Math.sin(0.8 * Math.PI), -Math.cos(SW.tilt) * Math.sin(0.8 * Math.PI)], KR = SW.r - AT.knob.in;
        const KC = [SW.x + kd[0] * KR, SW.y + kd[1] * KR, SW.z + kd[2] * KR], ks = [];
        for (const t of m.tris) if (t[10] === 'steeringWheel' && triCol(m, t) === C.black) for (let j = 0; j < 9; j += 3) {
          const d = [t[j] - KC[0], t[j + 1] - KC[1], t[j + 2] - KC[2]], h = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2], rr2 = [d[0] - ax[0] * h, d[1] - ax[1] * h, d[2] - ax[2] * h];
          if (Math.abs(Math.hypot(...rr2) - AT.knob.r) < 1e-5 && h > -1e-6 && h < AT.knob.h + 1e-6) ks.push([rr2[0], rr2[1] * e2[1] + rr2[2] * e2[2]]);
        }
        row.knob = angN(ks, q2 => q2); }
      // 车号两边都喷（每位一块贴图）、操纵杆根数（杆头圆锥顶的个数）
      { let L0 = 0, R0 = 0; for (const t of m.tris) if (t[10] === 'hood' && t[9] === F.chainMat) { if (t[0] < 0) L0++; else R0++; } row.hoodTex = [L0, R0]; }
      out.round[detail + (drive ? '/drive' : '')] = row;
    }
  }
  // ---------- 返修 FE1Q · repair-r2（验收员 play：驾驶座上看不到表盘指针 —— 以前两块表在 x ±0.13，方向盘轮圈正好斜着压过表心）----------
  // 从司机眼点（左中右 ±6 cm）往每根指针上的点（指针面底下 0.5 mm，指针和表面之间）连线：先碰到的正面必须是指针自己，
  // 不能被方向盘轮圈、辐条、中心盖、助力球、转向柱挡住（方向盘摆正；停着的 high / mid、可动模型 high / mid —— 只有这两档有表）
  {
    const needleCol = colKey(T.storedColor([0.55, 0.08, 0.05]));
    const eyes = [[G.eye.x, G.eye.y, G.eye.z], [G.eye.x - 0.06, G.eye.y, G.eye.z], [G.eye.x + 0.06, G.eye.y, G.eye.z]];
    const BARY = [[1 / 3, 1 / 3, 1 / 3], [0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45]];
    const GP = (F.gauge && F.gauge.pos) || [];
    out.needle = {};
    // 返修 FE1R · repair-r2：指针画在图集的表盘里（表盘一块贴图离板面 1 mm）—— 沿指针取点（盘面坐标，FK_GAUGE.needle[g] 方向从圆心后 6 mm 到前 36 mm，
    // 指针宽 ±1.2 mm 三排），从眼点连到表盘贴图面下 0.5 mm：先碰到的必须是这块表盘贴图
    const slantN = [0, 0.53, 0.848], slantPt = (x, f, off) => [x, 0.86 + 0.16 * f + 0.53 * off, -0.56 - 0.1 * f + 0.848 * off];
    for (const drive of [false, true]) for (const detail of ['high', 'mid']) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 2 }, 'high');
      const AT2 = F.atlas, gc = AT2.cells.gauge, inG = t => { const a = m.accs.get(t[9]), v0 = t[11], u = a.uv[v0 * 2] * AT2.size, w = (1 - a.uv[v0 * 2 + 1]) * AT2.size; return u >= gc[0] - 1e-3 && u <= gc[0] + gc[2] + 1e-3 && w >= gc[1] - 1e-3 && w <= gc[1] + gc[3] + 1e-3; };
      const gq = m.tris.filter(t => t[10] === 'dash' && t[9] === F.chainMat && inG(t));
      const row = { gaugesWant: F.lod[detail].gauges, gaugeQuads: gq.length / 2, perGauge: {}, rays: 0, blocked: 0, ex: [] };
      for (let gi = 0; gi < F.lod[detail].gauges; gi++) {
        const pg = row.perGauge[gi] = { rays: 0, blocked: 0, by: {} }, na = F.gauge.needle[gi], gx = GP[gi][0], gf = GP[gi][1];
        for (let k = 0; k <= 8; k++) for (const w of [-0.0012, 0, 0.0012]) {
          const l = -0.006 + 0.042 * k / 8, u = Math.cos(na) * l - Math.sin(na) * w, v = Math.sin(na) * l + Math.cos(na) * w;
          const q = slantPt(gx + u, gf + v / 0.189, 0.003 + 0.001 - 0.0005);
          for (const e of eyes) {
            const d = [q[0] - e[0], q[1] - e[1], q[2] - e[2]];
            let best = null;
            for (const t of m.tris) { if (t[9] === 'kit:glow') continue; const h = segHit(e, d, t); if (h && h[1] && (!best || h[0] < best[0])) best = [h[0], t]; }
            row.rays++; pg.rays++;
            const ok = best && best[1][10] === 'dash' && best[1][9] === F.chainMat;
            if (!ok) {
              row.blocked++; pg.blocked++;
              const who = best ? best[1][10] + ':' + best[1][9] : '没碰到表盘';
              pg.by[who] = (pg.by[who] || 0) + 1;
              if (row.ex.length < 4) row.ex.push({ eye: e, at: q.map(x => +x.toFixed(4)), by: who });
            }
          }
        }
      }
      out.needle[detail + (drive ? '/drive' : '')] = row;
    }
  }
  // ---------- 返修 FE1R（主会话裁定 K8–K11、M-gaps、M-fork）----------
  // K8 圆的零件：1280×720、竖直视野 75°，最近的正常机位（站着眼高 1.62 离车外接矩形 1.0 m 一圈每 10°、本车驾驶座、旁边车驾驶座 1.8 m 离 1 m 一圈、
  // showOwner ②a 气瓶近拍 (1.35, 1.62, 0.7)、⑤c 链轮近拍 (−0.75, 1.62, −1.75)）上，每段直边的弦高 ≤1 px。相机对准零件中心；面朝眼睛
  // （cos ≥ 0.25）的圆量弦高、柱身侧看量侧影离真圆最远处 R(1 − cos(π/n))。被别的零件挡住的机位不算（零件一圈 12 个点、往眼睛挪 5 mm，
  // 看得见 ≥4 个才算这个机位看得见它）。stage-FE1R/sweep-round/scripts/fk-round.mjs 的算法
  {
    const FPX = 360 / Math.tan(37.5 * Math.PI / 180);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => mul(a, 1 / (len(a) || 1));
    const cam = (E, Tg) => { const f = nrm(sub(Tg, E)); let r = cross(f, [0, 1, 0]); if (len(r) < 1e-6) r = [1, 0, 0]; r = nrm(r); return { E, f, r, u: cross(r, f) }; };
    const proj = (c, P) => { const d = sub(P, c.E), z = dot(d, c.f); if (z < 0.05) return null; return [640 + dot(d, c.r) / z * FPX, 360 - dot(d, c.u) / z * FPX]; };
    const ringP = (C, ax, R, n) => { ax = nrm(ax); const e1 = nrm(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(ax, e1); return k => { const a = k / n * 2 * Math.PI; return add(C, add(mul(e1, R * Math.cos(a)), mul(e2, R * Math.sin(a)))); }; };
    const SWt = G.steerWheel.tilt, SWax = [0, Math.cos(SWt), Math.sin(SWt)], SWC = [G.steerWheel.x, G.steerWheel.y, G.steerWheel.z];
    const tB = [G.tiltBase.x, G.tiltBase.y, G.tiltBase.z], tE = [G.tiltEye.x, G.tiltEye.y, G.tiltEye.z], tM = add(tB, mul(sub(tE, tB), 0.62));
    const slantP = (x, f, off) => [x, 0.86 + 0.16 * f + 0.53 * off, -0.56 - 0.1 * f + 0.848 * off];
    const RX = 0.6, RZ0 = -2.1, RZ1 = 1.28, CZ = (RZ0 + RZ1) / 2;
    const rd = (x, z) => Math.hypot(Math.max(0, Math.abs(x) - RX), Math.max(0, RZ0 - z, z - RZ1));
    const ringAt = (a, off) => { const dx = Math.cos(a), dz = Math.sin(a); let lo = 0, hi = 20; for (let i = 0; i < 50; i++) { const t = (lo + hi) / 2; if (rd(dx * t, CZ + dz * t) < off) lo = t; else hi = t; } return [dx * lo, CZ + dz * lo]; };
    const VIEWS = [{ E: [G.eye.x, G.eye.y, G.eye.z], tag: 'driver' }, { E: [1.35, 1.62, 0.7], tag: 'show2a' }, { E: [-0.75, 1.62, -1.75], tag: 'show5c' }];
    for (let d = 0; d < 360; d += 10) { const [x, z] = ringAt(d * Math.PI / 180, 1.0); VIEWS.push({ E: [x, 1.62, z], tag: 'stand@' + d }, { E: [x, 1.8, z], tag: 'nbr@' + d }); }
    out.k8 = {};
    for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
      const L = F.lod[detail], m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: L.levers }, q);
      const tris = m.tris.filter(t => t[9] !== 'kit:glow' && t[9] !== 'kit:decal');
      const P = [
        { id: 'tireF', C: [G.wheelFront.x + G.wheelFront.w / 2, G.wheelFront.y, G.wheelFront.z], ax: [1, 0, 0], R: G.wheelFront.r, n: L.wf[0] },
        { id: 'rimF', C: [G.wheelFront.x + G.wheelFront.w / 2, G.wheelFront.y, G.wheelFront.z], ax: [1, 0, 0], R: G.wheelFront.r * 0.6, n: L.rim[0] },
        { id: 'tireR', C: [G.wheelRear.x + G.wheelRear.w / 2, G.wheelRear.y, G.wheelRear.z], ax: [1, 0, 0], R: G.wheelRear.r, n: L.wr[0] },
        { id: 'rimR', C: [G.wheelRear.x + G.wheelRear.w / 2, G.wheelRear.y, G.wheelRear.z], ax: [1, 0, 0], R: G.wheelRear.r * 0.6, n: L.rim[1] },
        { id: 'steerRim', C: SWC, ax: SWax, R: G.steerWheel.r + 0.016, n: L.ring[0] },
        { id: 'tankEnd', C: [0.36, 1.32, 0.86], ax: [1, 0, 0], R: 0.15, n: L.tank },
        { id: 'sprocket', C: [G.sprocket.x + 0.013, G.sprocket.y, G.sprocket.z], ax: [1, 0, 0], R: G.sprocket.r, n: L.sprocket },
        { id: 'chainArc', C: [G.sprocket.x + 0.013, G.sprocket.y, G.sprocket.z], ax: [1, 0, 0], R: G.sprocket.r + 0.006, n: L.arc * 2 },
        { id: 'beaconTop', C: [0, 2.175, 0.53], ax: [0, 1, 0], R: 0.03, n: L.beacon },
        { id: 'tiltCylCap', C: tM, ax: sub(tE, tB), R: 0.034, n: L.tiltCyl },
        { id: 'liftCyl', C: [0.2, 1.0, -0.865], ax: [0, 1, 0], R: 0.04, n: L.cyl, side: true },
        { id: 'liftRod', C: [0.2, 1.9, -0.865], ax: [0, 1, 0], R: 0.022, n: L.rod, side: true },
        { id: 'tiltRod', C: add(tM, mul(sub(tE, tM), 0.5)), ax: sub(tE, tB), R: 0.017, n: L.tiltRod, side: true },
        { id: 'column', C: add(SWC, mul(SWax, -0.2)), ax: SWax, R: 0.03, n: L.column, side: true },
        { id: 'valve', C: [0.41, 1.32, 0.86], ax: [1, 0, 0], R: 0.022, n: L.valve },   // repair-r1：铜阀门、中心盖补回来
        L.swHub ? { id: 'steerHub', C: add(SWC, mul(SWax, -0.02)), ax: SWax, R: 0.04, n: L.swHub } : { id: 'columnTop', C: add(SWC, mul(SWax, -0.004)), ax: SWax, R: 0.03, n: L.column },
        { id: 'handle', C: [-0.43, 1.41, -0.58], ax: [0, 1, 0.157], R: 0.014, n: 8, side: true },
        { id: 'leverKnob', C: [0.19, 1.246, -0.645], ax: [0, 1, 0], R: 0.015, n: 6 },
        { id: 'hitchPin', C: [0, 0.4, 1.261], ax: [0, 1, 0], R: 0.014, n: 5 },
      ];
      // 表盘（repair-r2）画在图集里：真圆，不按段数量（图集 FK_GAUGE.r ↔ gaugePx 像素，驾驶座上一个纹素 < 1 px，见 gaugeTexel）
      // 助力球（repair-r2 补回来）：顶面圆、柱身侧影
      { const kd = [Math.cos(0.8 * Math.PI), Math.sin(SWt) * Math.sin(0.8 * Math.PI), -Math.cos(SWt) * Math.sin(0.8 * Math.PI)], KR = G.steerWheel.r - F.atlas.knob.in, KC = add(SWC, mul(kd, KR));
        P.push({ id: 'knobTop', C: add(KC, mul(SWax, F.atlas.knob.h)), ax: SWax, R: F.atlas.knob.r, n: L.knob }, { id: 'knobSide', C: add(KC, mul(SWax, F.atlas.knob.h / 2)), ax: SWax, R: F.atlas.knob.r, n: L.knob, side: true }); }
      const occl = (E, Q) => { const d = sub(Q, E); for (const t of tris) { const h = segHit(E, d, t); if (h && h[0] < 0.995) return true; } return false; };
      const row = {};
      for (const p of P) {
        let worst = null, seen = 0;
        for (const v of VIEWS) {
          const R12 = ringP(p.C, p.ax, p.side ? 0 : p.R, 12), toE = nrm(sub(v.E, p.C));
          let vis = 0;
          for (let k = 0; k < 12; k++) { const Q = p.side ? add(p.C, mul(toE, p.R + 0.005)) : add(R12(k), mul(toE, 0.005)); if (!occl(v.E, Q)) vis++; if (p.side) { vis = vis ? 12 : 0; break; } }
          if (vis < 4) continue;
          const c = cam(v.E, p.C), dist = len(sub(p.C, v.E));
          let val;
          if (p.side) val = p.R * (1 - Math.cos(Math.PI / p.n)) * FPX / dist;
          else {
            if (Math.abs(dot(nrm(p.ax), toE)) < 0.25) continue;
            const RP = ringP(p.C, p.ax, p.R, p.n); let mx = 0, ok = true;
            for (let k = 0; k < p.n; k++) { const a = proj(c, RP(k)), b = proj(c, RP(k + 1)), mm = proj(c, RP(k + 0.5)); if (!a || !b || !mm) { ok = false; break; } mx = Math.max(mx, Math.hypot(mm[0] - (a[0] + b[0]) / 2, mm[1] - (a[1] + b[1]) / 2)); }
            if (!ok) continue;
            val = mx;
          }
          seen++;
          if (!worst || val > worst.sag) worst = { sag: +val.toFixed(3), view: v.tag, dist: +dist.toFixed(2) };
        }
        row[p.id] = { n: p.n, seen, worst };
      }
      out.k8[detail + (drive ? '/drive' : '')] = row;
    }
    // repair-r2：表盘、前轮轮毂盖是图集里的圆 —— 最近机位上一个纹素投影多少像素（<1：比屏幕像素还细，看不出棱）
    { const g = F.gauge.pos[0], C0 = slantP(g[0], g[1], 0.004), d = len(sub(C0, VIEWS[0].E));
      const WF = G.wheelFront, hubC = [WF.x + WF.w / 2 + 0.01, WF.y, WF.z]; let dh = 1e9; for (const v of VIEWS) dh = Math.min(dh, len(sub(hubC, v.E)));
      out.texel = { gauge: +((F.gauge.r / F.atlas.gaugePx) * FPX / d).toFixed(3), hub: +((WF.r * 0.6 / F.atlas.rimPx) * FPX / dh).toFixed(3) }; }
  }
  // K9 安全带扣头：驾驶座往左下看（③d：头往左约 1.6 rad、往下约 1.15 rad），扣头顶面的黑色插口、红色按钮各自露出多少像素（1280×720、视野 75°，
  // 逐像素射线、先碰到的是它们自己才算）；橙色短带露出多少像素
  {
    const B = F.belt, E = [G.eye.x, G.eye.y, G.eye.z], yaw = 1.6, pit = -1.15;
    const fwd = [-Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit)];
    let rgt = [fwd[1] * 0 - fwd[2] * 1, fwd[2] * 0 - fwd[0] * 0, fwd[0] * 1 - fwd[1] * 0]; { const l = Math.hypot(...rgt); rgt = rgt.map(v => v / l); }
    const up = [rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0]];
    const th = Math.tan(37.5 * Math.PI / 180), A = 1280 / 720;
    out.k9 = {};
    const cols = { slot: colKey(T.storedColor([0.03, 0.03, 0.03])), button: colKey(T.storedColor([0.78, 0.07, 0.05])), belt: colKey(T.storedColor(FK_COL.belt)), steel: colKey(T.storedColor(FK_COL.steel)) };
    for (const [detail, q, drive] of [['mid', 'high', false], ['mid', 'high', true], ['low', 'low', false], ['drvLow', 'low', true]]) {
      const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: F.lod[detail].levers }, q);
      // 只留眼睛和扣头之间那一块里的三角形（别处的挡不住这几条视线）
      const tris = m.tris.filter(t => { if (t[9] === 'kit:glow' || t[9] === 'kit:decal') return false; const bb = T.bbox([t]); return bb[3] > -0.45 && bb[0] < 0.15 && bb[4] > 0.95 && bb[1] < 1.85 && bb[5] > -0.1 && bb[2] < 0.6; });
      const cnt = { slot: 0, button: 0, stub: 0, buckle: 0 };
      // 只扫扣头附近那一块屏幕：扣头 8 个角投影的外接框外扩 10 px
      const pr = p => { const d = [p[0] - E[0], p[1] - E[1], p[2] - E[2]], z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]; return [640 + (d[0] * rgt[0] + d[1] * rgt[1] + d[2] * rgt[2]) / z / (th * A) * 640, 360 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z / th * 360]; };
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const x of [B.buckle.x0, B.buckle.x1]) for (const y of [B.stub.y0 + 0.08, B.buckle.y1 + 0.002]) for (const z of [B.buckle.z0, B.buckle.z1]) { const s2 = pr([x, y, z]); x0 = Math.min(x0, s2[0]); x1 = Math.max(x1, s2[0]); y0 = Math.min(y0, s2[1]); y1 = Math.max(y1, s2[1]); }
      for (let py = Math.max(0, Math.floor(y0 - 10)); py <= Math.min(719, Math.ceil(y1 + 10)); py++) for (let px = Math.max(0, Math.floor(x0 - 10)); px <= Math.min(1279, Math.ceil(x1 + 10)); px++) {
        const nx = (px + 0.5) / 1280 * 2 - 1, ny = 1 - (py + 0.5) / 720 * 2;
        const d = [0, 1, 2].map(k => fwd[k] + rgt[k] * nx * th * A + up[k] * ny * th);
        let best = null;
        for (const t of tris) { const h = segHit(E, d.map(v => v * 3), t); if (h && (!best || h[0] < best[0])) best = [h[0], t]; }
        if (!best || !best[1]) continue;
        const cc = triCol(m, best[1]), bb = T.bbox([best[1]]);
        if (cc === cols.slot && bb[1] > B.buckle.y1) cnt.slot++;
        else if (cc === cols.button) cnt.button++;
        else if (cc === cols.belt && bb[3] < 0) cnt.stub++;
        else if (cc === cols.steel && bb[3] < 0 && bb[3] > -0.3) cnt.buckle++;
      }
      out.k9[detail + (drive ? '/drive' : '')] = cnt;
    }
    out.k9geo = { slotAbove: +(B.buckle.y1 + 0.001 - B.buckle.y1).toFixed(4), stubToSeat: +(-0.25 - B.stub.x1).toFixed(4), buckleToSeat: +(-0.25 - B.buckle.x1).toFixed(4), strapToSeat: +(B.strap.x0 - 0.25).toFixed(4) };
  }
  // K10 护顶横条：每档横条 z（BR.L1forklift.slatZ）、前横梁后脸 z −0.56、后横梁前脸 z 0.48，相邻两根之间的净空
  out.k10 = {};
  for (const d of ['high', 'mid', 'lite', 'low', 'drvLow']) {
    const z = F.slatZ(F.lod[d].slats), edges = [-0.56].concat(...z.map(v => [v - 0.025, v + 0.025]), [0.48]);
    let gap = 0; for (let i = 0; i + 1 < edges.length; i += 2) gap = Math.max(gap, edges[i + 1] - edges[i]);
    out.k10[d] = { slats: z.length, z, maxGap: +gap.toFixed(4) };
  }
  // K11 牵引销：各档都有、最靠前的顶点插进配重后脸（z 1.25）1–5 mm，没有和凹口贴片（z 1.252）共面的面
  out.k11 = {};
  for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
    const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 1 }, q), steelC = colKey(T.storedColor(FK_COL.steel));
    const pin = m.tris.filter(t => t[10] === 'counterweight' && triCol(m, t) === steelC && Math.abs((t[0] + t[3] + t[6]) / 3) < 0.03 && (t[1] + t[4] + t[7]) / 3 > 0.2 && (t[1] + t[4] + t[7]) / 3 < 0.42);
    let zmin = Infinity, cop = 0;
    for (const t of pin) { for (let j = 2; j < 9; j += 3) zmin = Math.min(zmin, t[j]); if ([t[2], t[5], t[8]].every(z => Math.abs(z - 1.252) < 1e-6)) cop++; }
    out.k11[detail + (drive ? '/drive' : '')] = { tris: pin.length, into: +(1.25 - zmin).toFixed(4), coplanar: cop };
  }
  // M-gaps：几对该贴着的零件（顶点级）—— 灯盒后脸插进前立柱（上下沿）、镜面就是灯盒前脸；坐垫底插进发动机盖顶；货叉竖直段后脸插进上下横梁；
  // 翼子板后下端落在踏板 / 侧裙上（插进踏板前沿）；转向柱顶封口（没有中心盖的档）
  {
    const zPost = y => -0.75 + 0.17 * (y - 0.99) / 1.08;
    const m = T.buildModel({ part: 'all', detail: 'mid', number: 88 }, 'high');
    const lamp = m.tris.filter(t => (t[10] === 'postFR') && T.bbox([t])[1] >= 1.859 && T.bbox([t])[4] <= 1.941 && Math.abs((t[0] + t[3] + t[6]) / 3 - 0.43) < 0.05);
    const lb = T.bbox(lamp);
    const seatBot = m.tris.filter(t => t[10] === 'seat' && T.bbox([t])[1] < 1.0 && T.bbox([t])[4] < 1.17);
    const fork = m.tris.filter(t => t[10] === 'carriage' && Math.abs(Math.abs((t[0] + t[3] + t[6]) / 3) - 0.28) < 0.06 && T.bbox([t])[5] > -1.12 && T.bbox([t])[2] < -1.11);
    out.mgaps = { lampBackZ: +lb[5].toFixed(4), postFrontTop: +zPost(1.94).toFixed(4), postFrontBot: +zPost(1.86).toFixed(4), lampIntoPostTop: +(lb[5] - zPost(1.94)).toFixed(4), lampIntoPostBot: +(lb[5] - zPost(1.86)).toFixed(4),
      seatBottom: seatBot.length ? +Math.min(...seatBot.map(t => T.bbox([t])[1])).toFixed(4) : null, forkBackZ: fork.length ? +Math.max(...fork.map(t => T.bbox([t])[5])).toFixed(4) : null };
  }
  // M-fork：货叉顶面从叉根一直平到叉尖（所有朝上的面都在 forkY + forkT），叉尖收薄在底面
  out.mfork = {};
  for (const [list, drive] of [[PARK, false], [DRV, true]]) for (const [detail, q] of list) {
    const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: 1 }, q);
    let topY = new Set(), tipTopZ = 0, upNotFlat = 0;
    for (const t of m.tris) if (t[10] === 'forkL' || t[10] === 'forkR') { const n = T.normal(t); if (n[1] > 0.3) { if (n[1] < 0.999) upNotFlat++; for (let j = 1; j < 9; j += 3) topY.add(+t[j].toFixed(5)); tipTopZ = Math.min(tipTopZ, t[2], t[5], t[8]); } }
    out.mfork[detail + (drive ? '/drive' : '')] = { topY: Array.from(topY), tipTopZ: +tipTopZ.toFixed(4), upNotFlat };
  }
  // 可动模型面数（含载具层画的大灯开关，按 dashSwitch 那一份的面数算，加最多的磨损；K5 灯的 glow 那份和 kit:prop 那份同一时刻只画一份，不重复计）。
  // 杆数按这一档停着时的根数（载具层 leversFor 也是这么取的）
  out.driveTotal = {};
  for (const [detail, q] of DRV) {
    const m = T.buildModel({ part: 'all', detail, number: 88, drive: true, levers: F.lod[detail].levers }, q);
    const q0 = BR.game.settings.quality; T.setQ(q); F.wear(m.b, { detail, wearN: 99 }); T.setQ(q0);
    let tri = 0; m.b._accs.forEach((a, k) => { if (a && a.idx && k !== 'kit:glow') tri += a.idx.length / 3; });
    out.driveTotal[detail] = tri + out.sw.tris;
  }
  return out;
}

// H12：断电途中往没载入过的方向走，新载入的区块灯也灭、不占灯池；来电一起亮（真进游戏：种子 12345、高画质）
async function pageBlackoutWalk(page) {
  await ev(page, () => { __br.setAuto(true); __br.start({ mode: 'test', levelId: '1', seed: 12345, settings: { quality: 'high' } }); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); return 0; });
  const plan = await ev(page, () => {
    const U = BR.util, ls = BR.world.levelSeed;
    for (let e = 0; e < 80; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 14) return { e, dur, at: e * 45 }; } }
    return null;
  });
  if (!plan) return { plan };
  const lit = () => ev(page, () => { let n = 0, on = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > 0) on++; } return { n, on }; });
  let t = 0, st = null;
  for (let i = 0; i < 500 && t < plan.at + 30; i++) {
    const dt = t < plan.at - 6 ? 5 : 0.5;
    st = await ev(page, dt => { __br.step(dt); let n = 0, on = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > 0) on++; } return { n, on }; }, dt);
    t += dt;
    if (st.n && st.on === 0) break;
  }
  const start = await ev(page, () => ({ keys: BR.world.chunks().map(c => c.key), p: [BR.player.x, BR.player.z] }));
  // 往西走 96 m（每 0.27 s 挪 6 m，区块一帧建一块，边走边载入）
  for (let k = 1; k <= 16; k++) await ev(page, a => { const x = a.p[0] - 6 * a.k; BR.player.reset({ x, y: BR.phys.groundY(x, a.p[1]), z: a.p[1], yaw: Math.PI / 2 }, { full: false }); for (let i = 0; i < 8; i++) __br.step(1 / 30); return 0; }, { p: start.p, k });
  const during = await ev(page, a => {
    const old = new Set(a.keys), out = { newChunks: 0, newLights: 0, newLit: 0, oldLit: 0, poolNew: 0 };
    const own = new Map();
    for (const c of BR.world.chunks()) {
      const nw = !old.has(c.key);
      if (nw) out.newChunks++;
      for (const l of (c.lights || [])) { own.set(l, nw); if (nw) { out.newLights++; if (l.intensity > 0) out.newLit++; } else if (l.intensity > 0) out.oldLit++; }
    }
    out.pool = BR.gfx.debugInfo().lit.length;
    out.poolNew = BR.gfx.debugInfo().lit.filter(l => own.get(l) === true).length;
    return out;
  }, start);
  // 等来电
  let after = null;
  for (let i = 0; i < 80; i++) {
    const s2 = await lit();
    if (s2.on > 0) { await ev(page, () => { for (let i = 0; i < 10; i++) __br.step(1 / 30); return 0; }); break; }
    await ev(page, () => { __br.step(0.5); return 0; });
  }
  after = await ev(page, a => {
    const old = new Set(a.keys), out = { newLights: 0, newRestored: 0, bad: 0 };
    for (const c of BR.world.chunks()) if (!old.has(c.key)) for (const l of (c.lights || [])) { out.newLights++; if (l.intensity > 0 && l.intensity === l._l1orig) out.newRestored++; else out.bad++; }
    out.pool = BR.gfx.debugInfo().lit.length;
    return out;
  }, start);
  await ev(page, () => { BR.bus.emit('game:home'); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 30000 }).catch(() => {});
  return { plan, t, st, during, after };
}

// J2（返修 FE1Q，主会话裁定）：真进游戏（种子 12345），出生块 (0,0) 里的车都是运行时车，一载入就在载具网格里（高画质 mid、低画质 drvLow）；
// 站到出生柱间那台 1@0,0#v0 右侧上车、开 1.5 s：还是同一档、同一个模板（停着和开过是同一个网格；开着时 sig 的灯位 vis 是 3），下车以后整个 sig 一样
async function pageSpawnRT(page, quality) {
  await ev(page, q => { __br.setAuto(true); __br.start({ mode: 'test', levelId: '1', seed: 12345, settings: { quality: q } }); return 0; }, quality);
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); return 0; });
  const snapCars = () => ev(page, () => {
    const c = BR.world.chunks().find(q => q.key === '0,0'), di = BR.vehicles.debugInfo();
    return ((c && c.res && c.res.data && c.res.data.forklifts) || []).map(f => {
      const v = BR.vehicles.byKey(f.key);
      return { key: f.key, x: f.x, z: f.z, runtime: f.runtime, spans: !!f.spans, meshed: di.promoted.includes(f.key), tier: di.tiers[f.key] || null, sig: v && v.ent ? v.ent.sig : null, seat: BR.vehicles.seated };
    });
  });
  const before = await snapCars();
  const mid = before.find(f => f.x > 12 && f.x < 20 && f.z > 12 && f.z < 20);
  let mount = null, driving = null, after = null;
  if (mid) {
    mount = await ev(page, k => {
      const v = BR.vehicles.byKey(k), p = v.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const x = p.x + c * 1.2 + s * 0.24, z = p.z - s * 1.2 + c * 0.24;
      BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: Math.atan2(x - p.x, z - p.z) }, { full: false });
      __br.step(0.1);
      const ok = BR.vehicles.mount(k);
      for (let i = 0; i < 50; i++) __br.step(1 / 30);
      return { ok, seated: BR.vehicles.seated, phase: BR.vehicles.debugInfo().phase };
    }, mid.key);
    driving = await ev(page, k => {
      const v = BR.vehicles.byKey(k), p0 = Object.assign({}, v.pose);
      for (let i = 0; i < 45; i++) BR.vehicles._step(1 / 30, { throttle: 1, steer: 0, lift: 0 }, k);   // 测试口直接给油门（不走 BR.input），1.5 s
      __br.step(1 / 30);
      const di = BR.vehicles.debugInfo();
      return { moved: Math.hypot(v.pose.x - p0.x, v.pose.z - p0.z), tier: di.tiers[k] || null, sig: v.ent ? v.ent.sig : null, meshed: di.promoted.includes(k), seat: BR.vehicles.seated };
    }, mid.key);
    await ev(page, () => { BR.vehicles.dismount(); for (let i = 0; i < 45; i++) __br.step(1 / 30); return 0; });
    after = await snapCars();
  }
  await ev(page, () => { BR.bus.emit('game:home'); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 30000 }).catch(() => {});
  return { before, mid: mid || null, mount, driving, after };
}
// 返修 FE1R · K3 / K4 / K5：同一机位、同一位姿，区块里停着的车 vs 摆回原位的开过的车（载具网格，熄火、开关开着 —— 下车以后的样子）逐像素比。
// 真进游戏（1280×720 的游戏画面，FOV 按机位表），人站到车后 7 m 外不挡镜头，灯不闪；渲染完立刻 readPixels，页面里比（每个通道差 >10 算一个像素）。
// cases：[种子, 画质, 车 key, 停放档, 可动档]；dark：等到这一局第一次断电再比一遍（K5：断电时镜面、灯罩、指示灯也一样）
const PAIR_CAMS = (() => {
  const c = [];
  for (let a = 0; a < 360; a += 30) { const r = a * Math.PI / 180; c.push(['ring' + a, [2.7 * Math.sin(r), 1.62, 0.15 + 2.7 * Math.cos(r)], [0, 0.85, -0.1], 50]); }   // 返修 FE1R · repair-r1：每 30°（K3(4)）
  c.push(['seatF', [0, 1.8, 0.16], [0, 1.2, -1.2], 70], ['seatDL', [0, 1.8, 0.16], [-0.45, 0.9, 0.05], 70], ['seatDR', [0, 1.8, 0.16], [0.45, 0.9, 0.05], 70],
    ['seatUp', [0, 1.8, 0.16], [0, 2.4, -0.15], 70], ['lowArchL', [-1.2, 0.3, 0.2], [-0.25, 0.3, 0.85], 50], ['lowArchR', [1.2, 0.3, 0.2], [0.25, 0.3, 0.85], 50],
    ['lowB', [0.2, 0.3, 2.6], [0, 0.5, 0.6], 55], ['tankR', [1.35, 1.55, 0.95], [0.15, 1.2, 0.95], 35], ['beaconB', [0.3, 2.3, 2.4], [0, 2.15, 0.53], 28],
    ['lampF', [0.9, 1.9, -2.5], [0.3, 1.85, -0.66], 28], ['dash', [0, 1.8, 0.16], [0, 1.0, -0.62], 45], ['hitch', [0.6, 0.75, 2.5], [0, 0.6, 1.25], 30],
    ['wheelRR', [1.6, 1.4, 1.6], [0.5, 0.25, 0.8], 28], ['top', [0.01, 4.2, 0.0], [0, 0, -0.05], 50]);
  return c;
})();
// 逐像素比的机位工具（page 里装一次）：
//   shot(E, T, fov)：灯池只由机位决定 —— 相机先跳到 ±1 km 外再跳回来，各 gfx.render(0) 一次（位移 > 8 m 走「跳变」分支：选中的灯直接到位、
//     不淡化；dt = 0 钟不走），然后按这个视野画一帧读像素。以前每个机位 render(0.02) 三次，灯池跟着上一个机位、淡入淡出走，
//     同一辆车同一状态连拍两遍都能差上万像素（FE1R-model 诊断：同状态差 16280 px）
//   mask()：只画载具网格（名字 'vehicles …'，白色、黑底、不要雾）读像素 —— 车所在的像素
//   cmp(A, B, M)：差 > 10/255 的像素；车所在像素（M 外扩 2 px）里「成片」的（8 邻全都也差 = 至少 3×3 一块）才算不一样。
//     棱边上的浮点舍入翻转只有一像素宽的细线 / 零星小簇（停着的车在区块本地坐标 + 区块矩阵，开过的车在世界坐标，最后一位舍入不同，
//     见 FE1R-model risks；640×360 下斜条纹边上会挤出 2×2、6 像素的小簇），不算；少了 / 多了一个零件、换了颜色、光照不同都是成片的
function pagePixTools() {
  const T = window.__pix = {};
  const cam = () => BR.gfx.camera, R = () => BR.gfx.renderer;
  T.read = () => { const gl = R().getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return { w, h, buf }; };
  T.shot = (E, T2, fov) => {
    const c = cam();
    for (const dx of [1000, -1000, 0]) { c.position.set(E.x + dx, E.y, E.z); c.lookAt(T2.x + dx, T2.y, T2.z); c.updateMatrixWorld(true); BR.gfx.render(0); }
    c.fov = fov; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    R().render(BR.gfx.scene, c);
    return T.read();
  };
  T.mask = () => {
    const sc = BR.gfx.scene, hid = [], bg0 = sc.background, fog0 = sc.fog, ov0 = sc.overrideMaterial;
    sc.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !/^vehicles /.test(o.name || '')) { o.visible = false; hid.push(o); } });
    sc.background = new THREE.Color(0); sc.fog = null; sc.overrideMaterial = T.white || (T.white = new THREE.MeshBasicMaterial({ color: 0xffffff }));
    try { R().render(sc, cam()); return T.read(); } finally { for (const o of hid) o.visible = true; sc.background = bg0; sc.fog = fog0; sc.overrideMaterial = ov0; }
  };
  T.cmp = (A, B, M) => {
    const W = A.w, H = A.h, D = new Uint8Array(W * H), K = new Uint8Array(W * H);
    if (M) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M.buf[(y * W + x) * 4] > 128) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) K[yy * W + xx] = 1; }
    let raw = 0, out = 0, car = 0, carPx = 0;
    for (let p = 0; p < W * H; p++) {
      if (K[p] || !M) carPx++;
      const i = p * 4;
      if (Math.abs(A.buf[i] - B.buf[i]) > 10 || Math.abs(A.buf[i + 1] - B.buf[i + 1]) > 10 || Math.abs(A.buf[i + 2] - B.buf[i + 2]) > 10) { D[p] = 1; raw++; if (K[p] || !M) car++; else out++; }
    }
    let blob = 0, at = null;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x; if (!D[p] || (M && !K[p])) continue;
      let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && D[p + dy * W + dx]) nb++;
      if (nb === 8) { blob++; if (!at) at = [x, H - 1 - y]; }
    }
    return { carPx, car, blob, at, out };
  };
}
async function pagePairs(page, cases, saveDir) {
  const out = {};
  await ev(page, pagePixTools);
  for (const [seed, q, key, tierP, tierD] of cases) {
    const tag = seed + '-' + q + '-' + key.replace(/[@,#]/g, '_');
    await ev(page, a => { __br.setAuto(true); __br.start({ mode: 'test', levelId: '1', seed: a.seed, settings: { quality: a.q } }); return 0; }, { seed, q });
    await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 120000 });
    const info = await ev(page, a => {
      __br.setAuto(false); __br.step(0.5);
      const pk = /@(-?\d+),(-?\d+)#/.exec(a.key), cx = +pk[1], cz = +pk[2], size = BR.world.chunkSize || 32;
      const goto = (x, z) => { BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: 0 }, { full: false }); for (let i = 0; i < 40; i++) __br.step(1 / 20); };
      goto(cx * size + size / 2, cz * size + size / 2);
      let f = null;
      for (const c of BR.world.chunks()) for (const r of ((c.res && c.res.data && c.res.data.forklifts) || [])) if (r.key === a.key) f = r;
      if (!f) return { missing: true };
      const P = { x: f.x, y: f.y || 0, z: f.z, yaw: f.rot };
      // 人站到车后 7 m（不挡镜头）、怪清掉、灯不闪
      const c0 = Math.cos(P.yaw), s0 = Math.sin(P.yaw);
      goto(P.x + s0 * 7, P.z + c0 * 7);
      if (BR.entities && typeof BR.entities.clear === 'function') try { BR.entities.clear(); } catch (e) { /* 忽略 */ }
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) if (l && l.flicker) l.flicker = 0;
      // 返修 FE1R · repair-r2：区块动画（地上出口圈的脉动、切出墙）也停掉 —— 停着 / 开过两张不是同一刻拍的，出口圈一明一暗，
      // 从门架、链条之间的缝里透出来的那几个像素会被当成车上的差别（种子 157 那台 lite 车后面正好有个出口圈）
      for (const c of BR.world.chunks()) c.tick = null;
      const W = (v) => ({ x: P.x + c0 * v[0] + s0 * v[2], y: P.y + v[1], z: P.z - s0 * v[0] + c0 * v[2] });
      window.__pp = { P, W, shots: {} };
      return { P, detail: f.detail, runtime: !!f.runtime, wearN: f.wearN };
    }, { key });
    if (info.missing) { out[tag] = { missing: true }; continue; }
    const shoot = async (state) => ev(page, a => {
      const PP = window.__pp, X = window.__pix, cam = BR.gfx.camera, R = BR.gfx.renderer, fov0 = cam.fov, pos0 = cam.position.clone(), q0 = cam.quaternion.clone();
      const res = {};
      try {
        for (const [n, e, t, fov] of a.cams) {
          PP.shots[a.state + '/' + n] = X.shot(PP.W(e), PP.W(t), fov);
          if (a.save.includes(n)) res[n] = R.domElement.toDataURL('image/png');
          if (a.state === 'drv' || a.state === 'drvD') PP.shots['mask/' + n] = X.mask();
        }
      } finally { cam.fov = fov0; cam.updateProjectionMatrix(); cam.position.copy(pos0); cam.quaternion.copy(q0); cam.updateMatrixWorld(true); }
      return res;
    }, { state, cams: PAIR_CAMS, save: ['ring30', 'seatF', 'lowArchL', 'tankR', 'top', 'switch'] });
    // 返修 FE1R · repair-r1（K3(4)：有电、断电各比一遍）：有电拍停着的 → 快进到这一层第一次断电（≥14 s 的那次）拍停着的 → 推一下升格、
    // 断电里拍开过的 → 等来电再拍开过的；有电比有电、断电比断电。每组拍之前人站回车后 7 m、怪清掉、灯不闪
    const reset = () => ev(page, () => { const P = window.__pp.P, c0 = Math.cos(P.yaw), s0 = Math.sin(P.yaw), x = P.x + s0 * 7, z = P.z + c0 * 7; BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: 0 }, { full: false }); __br.step(0.05); if (BR.entities && typeof BR.entities.clear === 'function') try { BR.entities.clear(); } catch (e) { /* 忽略 */ } for (const c of BR.world.chunks()) { for (const l of (c.lights || [])) if (l && l.flicker) l.flicker = 0; c.tick = null; } return 0; });
    const lights = () => ev(page, () => { let n = 0, on = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > 0) on++; } return { n, on }; });
    const st0 = await ev(page, k => { const v = BR.vehicles.byKey(k), di = BR.vehicles.debugInfo(); return { driven: v.driven, meshed: di.promoted.includes(k), tier: di.tiers[k] || null }; }, key);
    const imgP = await shoot('park');
    const plan = await ev(page, () => { const U = BR.util, ls = BR.world.levelSeed; for (let e = 0; e < 80; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 14) return { e, dur, at: e * 45 }; } } return null; });
    let t = 0, dark = null;
    for (let i = 0; i < 600 && plan && t < plan.at + 30; i++) {
      const dt = t < plan.at - 6 ? 5 : 0.5;
      await ev(page, dt => { __br.step(dt); return 0; }, dt);
      t += dt;
      const L = await lights();
      if (L.n && L.on === 0) { dark = L; break; }
    }
    await reset();
    if (dark) await shoot('parkD');
    await ev(page, k => { const P = window.__pp.P; BR.vehicles.setPose(k, { x: P.x, z: P.z, yaw: P.yaw, steer: 0, lift: 0, spd: 0, lever: 0, on: 0 }); for (let i = 0; i < 6; i++) __br.step(1 / 30); return 0; }, key);
    const st1 = await ev(page, k => { const v = BR.vehicles.byKey(k), di = BR.vehicles.debugInfo(); return { driven: v.driven, meshed: di.promoted.includes(k), tier: di.tiers[k] || null, on: v.pose.on, hl: v.pose.hl }; }, key);
    await reset();
    if (dark) await shoot('drvD');
    let lit = null;
    for (let i = 0; i < 120 && dark; i++) { await ev(page, () => { __br.step(0.5); return 0; }); const L = await lights(); if (L.on === L.n && L.n > 0) { lit = L; break; } }
    await ev(page, () => { __br.step(2); return 0; });
    await reset();
    const imgD = await shoot('drv');
    const diff = await ev(page, () => {
      const PP = window.__pp, X = window.__pix, o = {};
      for (const k of Object.keys(PP.shots)) {
        const m = /^(park|parkD)\/(.*)$/.exec(k);
        if (!m) continue;
        const n = m[2], A = PP.shots[k], B = PP.shots[(m[1] === 'park' ? 'drv/' : 'drvD/') + n];
        if (!B) continue;
        o[(m[1] === 'park' ? '' : 'dark:') + n] = X.cmp(A, B, PP.shots['mask/' + n]);
      }
      return o;
    });
    // 返修 FE1R · repair-r1：有电那组某个机位有成片的差异时，过 1.3 s 再拍一遍开过的车、和停着那张重比，按两次里少的算（结果里记 retry）——
    // 少了 / 多了零件、换了颜色是几何差异，再拍一遍照样成片；车外的场景在动（车外差异每个机位都有几十个像素），偶尔在车边上那 2 px 里凑出一片 3×3，
    // 再拍一遍就没了（all.mjs 跑过一次：种子 27 lite 车 beaconB 机位一片 3×3，同一版代码单独跑时没有）
    const retry = Object.keys(diff).filter(n => !n.startsWith('dark:') && diff[n].blob > 0);
    if (retry.length) {
      await ev(page, () => { __br.step(1.3); return 0; });
      await reset();
      const re = await ev(page, a => {
        const PP = window.__pp, X = window.__pix, cam = BR.gfx.camera, fov0 = cam.fov, pos0 = cam.position.clone(), q0 = cam.quaternion.clone(), o = {};
        try {
          for (const [n, e, t, fov] of a.cams) if (a.names.includes(n)) o[n] = X.cmp(PP.shots['park/' + n], X.shot(PP.W(e), PP.W(t), fov), PP.shots['mask/' + n]);
        } finally { cam.fov = fov0; cam.updateProjectionMatrix(); cam.position.copy(pos0); cam.quaternion.copy(q0); cam.updateMatrixWorld(true); }
        return o;
      }, { cams: PAIR_CAMS, names: retry });
      for (const n of retry) if (re[n]) { const first = diff[n]; diff[n] = Object.assign({}, re[n].blob <= first.blob ? re[n] : first, { retry: { first: { blob: first.blob, at: first.at, car: first.car }, again: { blob: re[n].blob, at: re[n].at, car: re[n].car } } }); }
    }
    await ev(page, () => { window.__pp.shots = {}; return 0; });
    if (saveDir) for (const [st, imgs] of [['park', imgP], ['drv', imgD]]) for (const [n, url] of Object.entries(imgs)) fs.writeFileSync(path.join(saveDir, tag + '-' + st + '-' + n + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    out[tag] = { info, st0, st1, diff, tierP, tierD, dark: { plan, t, dark, lit } };
  }
  await ev(page, () => { BR.bus.emit('game:home'); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 30000 }).catch(() => {});
  return out;
}
// K5：没开灯时停着的车、开过熄了火的车、出生车（运行时车，从没开过）三台在同一位姿、同一机位，警示灯 / 大灯镜面 / 开关指示灯一模一样；有电、断电各一遍。
// 开关机位在方向盘左边（以前从正上方看被方向盘轮圈挡掉 2/3）
// 种子 2 低画质（返修 FE1R · repair-r1：种子 12345 低画质 (1,0) 那台普查重做以后变成运行时车了）：区块里停着的 1@-1,0#v0（low）、
// 摆回原位的它（drvLow，熄火）、出生车（出生块里的运行时车，drvLow）挪到同一位姿（车号不在这几个机位里）
const DARK_CAMS = [['lampF', [0.9, 1.9, -2.5], [0.3, 1.85, -0.66], 28], ['lampFL', [-0.9, 1.9, -2.5], [-0.3, 1.85, -0.66], 28], ['beaconB', [0.3, 2.3, 2.4], [0, 2.15, 0.53], 28],
  ['beaconS', [1.6, 2.0, 0.53], [0, 2.14, 0.53], 24], ['dash', [0, 1.8, 0.16], [-0.1, 1.0, -0.62], 45], ['switch', [-0.35, 1.35, -0.25], [-0.22, 0.944, -0.603], 30]];
async function pageDark(page, dark) {
  await ev(page, pagePixTools);
  await ev(page, () => { __br.setAuto(true); __br.start({ mode: 'test', levelId: '1', seed: 2, settings: { quality: 'low' } }); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 120000 });
  const K1 = '1@-1,0#v0';
  const K0 = await ev(page, () => { for (const c of BR.world.chunks()) if (c.key === '0,0') for (const r of ((c.res && c.res.data && c.res.data.forklifts) || [])) if (r.runtime) return r.key; return '1@0,0#v0'; });
  const r0 = await ev(page, a => {
    __br.setAuto(false); __br.step(0.5);
    let f = null; for (const c of BR.world.chunks()) for (const r of ((c.res && c.res.data && c.res.data.forklifts) || [])) if (r.key === a.K1) f = r;
    if (!f) return null;
    const P = { x: f.x, y: f.y || 0, z: f.z, yaw: f.rot }, c0 = Math.cos(P.yaw), s0 = Math.sin(P.yaw);
    const W = v => ({ x: P.x + c0 * v[0] + s0 * v[2], y: P.y + v[1], z: P.z - s0 * v[0] + c0 * v[2] });
    window.__pd = { P, W, shots: {} };
    return { P, detail: f.detail };
  }, { K1 });
  if (!r0) return { missing: true };
  let plan = null, t = 0;
  if (dark) {
    plan = await ev(page, () => { const U = BR.util, ls = BR.world.levelSeed; for (let e = 0; e < 80; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 14) return { e, dur, at: e * 45 }; } } return null; });
    for (let i = 0; i < 500 && plan && t < plan.at + 30; i++) {
      const dt = t < plan.at - 6 ? 5 : 0.5;
      const st = await ev(page, dt => { __br.step(dt); let n = 0, on = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > 0) on++; } return { n, on }; }, dt);
      t += dt;
      if (st.n && st.on === 0) break;
    }
  }
  const stand = () => ev(page, () => { const P = window.__pd.P, c0 = Math.cos(P.yaw), s0 = Math.sin(P.yaw), x = P.x + s0 * 7, z = P.z + c0 * 7; BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: 0 }, { full: false }); __br.step(0.05); if (BR.entities && typeof BR.entities.clear === 'function') try { BR.entities.clear(); } catch (e) { /* 忽略 */ } for (const c of BR.world.chunks()) { for (const l of (c.lights || [])) if (l && l.flicker) l.flicker = 0; c.tick = null; } return 0; });
  const shoot = st => ev(page, a => {
    const PP = window.__pd, X = window.__pix, cam = BR.gfx.camera, fov0 = cam.fov, pos0 = cam.position.clone(), q0 = cam.quaternion.clone();
    try {
      for (const [n, e, t2, fov] of a.cams) {
        PP.shots[a.st + '/' + n] = X.shot(PP.W(e), PP.W(t2), fov);
        if (a.st === 'drv') PP.shots['mask/' + n] = X.mask();
      }
    } finally { cam.fov = fov0; cam.updateProjectionMatrix(); cam.position.copy(pos0); cam.quaternion.copy(q0); cam.updateMatrixWorld(true); }
    return 0;
  }, { st, cams: DARK_CAMS });
  await stand();
  const lit0 = await ev(page, () => { let n = 0, on = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > 0) on++; } return { n, on }; });
  await shoot('park');
  await ev(page, k => { const P = window.__pd.P; BR.vehicles.setPose(k, { x: P.x, z: P.z, yaw: P.yaw, steer: 0, lift: 0, on: 0 }); __br.step(1 / 30); return 0; }, K1);
  await stand();
  await shoot('drv');
  await ev(page, a => { const P = window.__pd.P; BR.vehicles.setPose(a.K1, { x: P.x + 30, z: P.z + 30, yaw: P.yaw, steer: 0, lift: 0, on: 0 }); BR.vehicles.setPose(a.K0, { x: P.x, z: P.z, yaw: P.yaw, steer: 0, lift: 0, on: 0 }); __br.step(1 / 30); return 0; }, { K1, K0 });
  await stand();
  await shoot('rt');
  const tiers = await ev(page, a => { const di = BR.vehicles.debugInfo(); return { k1: di.tiers[a.K1] || null, k0: di.tiers[a.K0] || null }; }, { K1, K0 });
  const diff = await ev(page, () => {
    const PP = window.__pd, X = window.__pix, o = {};
    for (const k of Object.keys(PP.shots)) if (k.startsWith('park/')) { const n = k.slice(5), M = PP.shots['mask/' + n]; o[n] = { drv: X.cmp(PP.shots[k], PP.shots['drv/' + n], M), rt: X.cmp(PP.shots[k], PP.shots['rt/' + n], M) }; }
    PP.shots = {};
    return o;
  });
  await ev(page, () => { BR.bus.emit('game:home'); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 30000 }).catch(() => {});
  return { r0, plan, t, lit0, tiers, diff };
}
// 返修 FE1R · repair-r2（验收员 spec critical：安全带短带和扣头朝坐垫那面同在 x −0.2505、不倒角的档坐垫和靠背侧面同在 x ±0.25 —— 同向共面会 z-fighting）：
// 停放 4 档 + 可动 4 档，kit:prop / 链条材质的三角形两两比：法线同向（cos > 0.99999）、平面距离 <0.1 mm、投影重叠 >1 mm² 的对数 = 0
// （可动模型的灯熄着 / 亮着两份不同时进缓冲区，kit:glow 不比）
function pageCoplanar() {
  const T = window.__fl1, F = BR.L1forklift, out = {};
  const cases = [['high', 'high', false], ['mid', 'high', false], ['lite', 'high', false], ['low', 'low', false], ['high', 'high', true], ['mid', 'high', true], ['lite', 'high', true], ['drvLow', 'low', true]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const clip = (poly, a, b) => { const o = [], sd = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], sp = sd(p), sq = sd(q); if (sp >= 0) o.push(p); if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return o; };
  const area2 = P => { let s2 = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s2 += p[0] * q[1] - q[0] * p[1]; } return s2 / 2; };
  for (const [detail, q, drive] of cases) {
    const m = T.buildModel({ part: 'all', detail, number: 88, drive, levers: F.lod[detail].levers }, q);
    const tr = [];
    for (const t of m.tris) {
      if (t[9] === 'kit:glow' || t[9] === 'kit:decal') continue;
      const A = [t[0], t[1], t[2]], B = [t[3], t[4], t[5]], C = [t[6], t[7], t[8]], N = cross(sub(B, A), sub(C, A)), L = Math.hypot(N[0], N[1], N[2]);
      if (L < 1e-9) continue;
      const n = [N[0] / L, N[1] / L, N[2] / L];
      tr.push({ A, B, C, n, d: dot(n, A), seg: t[10], mn: [Math.min(A[0], B[0], C[0]), Math.min(A[1], B[1], C[1]), Math.min(A[2], B[2], C[2])], mx: [Math.max(A[0], B[0], C[0]), Math.max(A[1], B[1], C[1]), Math.max(A[2], B[2], C[2])] });
    }
    let pairs = 0, mm2 = 0; const ex = [];
    for (let i = 0; i < tr.length; i++) {
      const a = tr[i];
      for (let j = i + 1; j < tr.length; j++) {
        const b = tr[j];
        if (b.mn[0] > a.mx[0] + 1e-4 || b.mx[0] < a.mn[0] - 1e-4 || b.mn[1] > a.mx[1] + 1e-4 || b.mx[1] < a.mn[1] - 1e-4 || b.mn[2] > a.mx[2] + 1e-4 || b.mx[2] < a.mn[2] - 1e-4) continue;
        if (dot(a.n, b.n) < 0.99999 || Math.abs(a.d - b.d) > 1e-4) continue;
        const t0 = Math.abs(a.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], e1 = (() => { const x = cross(a.n, t0), l = Math.hypot(x[0], x[1], x[2]); return [x[0] / l, x[1] / l, x[2] / l]; })(), e2 = cross(a.n, e1);
        const pr = p => [dot(p, e1), dot(p, e2)];
        let pa = [a.A, a.B, a.C].map(pr), pb = [b.A, b.B, b.C].map(pr);
        if (area2(pa) < 0) pa.reverse(); if (area2(pb) < 0) pb.reverse();
        let poly = pb; for (let k = 0; k < 3 && poly.length; k++) poly = clip(poly, pa[k], pa[(k + 1) % 3]);
        const ov = poly.length >= 3 ? Math.abs(area2(poly)) : 0;
        if (ov > 1e-6) { pairs++; mm2 += ov * 1e6; if (ex.length < 4) ex.push([a.seg, b.seg, +(ov * 1e6).toFixed(1), a.A.map(v => +v.toFixed(4))]); }
      }
    }
    out[(drive ? 'drive:' : 'park:') + detail] = { tris: tr.length, pairs, mm2: +mm2.toFixed(1), ex };
  }
  return out;
}
async function secPolish(page) {
  await ev(page, pageGeoTools);
  const P = await ev(page, pagePolish);
  fs.writeFileSync(path.join(OUT, 'polish.json'), JSON.stringify(P, null, 1));
  {
    const C = await ev(page, pageCoplanar);
    const bad = Object.entries(C).filter(([, v]) => v.pairs !== 0);
    check('polish repair-r2：停放 high / mid / lite / low、可动 high / mid / lite / drvLow 没有同向共面的三角形（法线同向、平面距离 <0.1 mm、重叠 >1 mm² 的对数 0；安全带短带和扣头、坐垫和靠背侧面不再共面）',
      Object.keys(C).length === 8 && bad.length === 0, bad.length ? Object.fromEntries(bad) : Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.tris])));
  }
  // H1
  const lb = Object.entries(P.lamp).filter(([, v]) => !(v.leaks === 0 && v.dirs === 5 && v.rays > 0));
  check('polish H1：前大灯灯盒从驾驶座（眼点左右 ±6 cm）、车外站着的 ' + (Object.values(P.lamp)[0] || {}).eyes + ' 个眼点看都是实心的：往灯盒里面连线，到达之前都先碰到正面；底面、两侧、朝前、朝司机五个方向的面都有（停放 5 档 + 可动 4 档）',
    lb.length === 0, lb.length ? Object.fromEntries(lb.slice(0, 3)) : Object.fromEntries(Object.entries(P.lamp).map(([k, v]) => [k, v.rays])));
  // H1c（返修 r2）
  {
    const bad = [], n = {};
    for (const [det, parts] of Object.entries(P.drvShut || {})) for (const [k, v] of Object.entries(parts)) { n[det + '/' + k] = v.rays; if (!(v.leaks === 0 && v.rays > 0)) bad.push([det + '/' + k, v]); }
    check('polish H1c：可动模型（4 档）外门架顶梁两头（车侧站着）、护顶纵梁 / 横梁 / 横条、起升油缸缸口、杆头底面、挡货架立柱顶、扶手顶端（驾驶座左中右）都是实心的：往里面连线，到达之前都先碰到正面',
      !!P.drvShut && Object.keys(P.drvShut).length === 4 && bad.length === 0, bad.length ? Object.fromEntries(bad.slice(0, 4)) : n);
  }
  // J11（返修 FE1Q）
  {
    const bad = [], n = {};
    for (const [det, parts] of Object.entries((P.parkShut || {}).tiers || {})) for (const [k, v] of Object.entries(parts)) { n[det] = (n[det] || 0) + v.rays; if (!(v.leaks === 0 && v.rays > 0)) bad.push([det + '/' + k, v]); }
    check('polish J11：停放 4 档 + 可动模型 4 档，站着（1.62）、坐在旁边的车上（1.8）' + ((P.parkShut || {}).eyes || 0) + ' 个眼点往外门架顶梁两头、护顶纵梁 / 横梁 / 横条、缸口、杆头、挡货架立柱 / 顶横梁 / 竖条、扶手、警示灯罩、内门架顶梁、配重下半截、轮胎、链条里面连线，到达之前都先碰到正面（停着的车和开过的车一样实心）',
      !!P.parkShut && Object.keys(P.parkShut.tiers).length === 8 && bad.length === 0, bad.length ? Object.fromEntries(bad.slice(0, 4)) : n);
    const mb = Object.entries(P.mirror || {}).filter(([, v]) => !(v.leaks === 0 && v.rays > 0));
    check('polish J11：车左前方 ' + (Object.values(P.mirror || {})[0] || {}).rays + ' 条视线（含 r3 验收员那条）往左大灯、左前立柱（有后视镜的档连镜壳）里面连线，先碰到的都是正面（停着的、开过的 high / mid）',
      Object.keys(P.mirror || {}).length === 4 && mb.length === 0, mb.length ? Object.fromEntries(mb) : P.mirror);
  }
  // H2
  if (!P.belt) { check('polish H2：BR.L1forklift.belt（安全带几何）存在', false); P.belt = { parts: {}, seatSame: {}, strap: {}, gap: {}, body: {} }; }
  const pb = Object.entries(P.belt.parts).filter(([k, v]) => !(v.same && v.tris > 0));
  check('polish H2：安全带（卷收器、垂下来的带子、锁舌、短带、扣头 + 插口、红按钮）在停着的 high / mid / lite / low 和可动模型 high / mid / lite / drvLow 里逐个三角形一样（K3：low 停放档也有）',
    pb.length === 0 && Object.keys(P.belt.parts).length === 8, P.belt.parts);
  const ss = Object.entries(P.belt.seatSame).filter(([, v]) => !v);
  check('polish H2：停着的车和同档可动模型的整个座椅（座椅 + 安全带）逐个三角形一样（high / mid / lite）', ss.length === 0, P.belt.seatSame);
  const S2 = P.belt.strap;
  check('polish H2：右边的带子竖直垂下（x 只占 4 mm、z 只占 4.4 cm），上头伸进卷收器、下头伸进锁舌；锁舌在坐垫右侧面外 1 mm、坐垫侧面平面段的高度里；左边短带脚落在发动机盖顶面（y 1.0）',
    S2.vertical && S2.intoRetractor && S2.intoTongue && S2.tongueGap >= 0.0005 && S2.tongueGap <= 0.002 && S2.tongueY[0] >= 1.06 && S2.tongueY[1] <= 1.125 + 1e-9 && Math.abs(S2.stubFoot - 1.0) < 1e-9, S2);
  const gb = Object.entries(P.belt.gap).filter(([, v]) => !(v.pen === 0 && v.strap >= 0.00049 && v.strap <= 0.0006 && v.tongue >= 0.00049 && v.tongue <= 0.002 && v.stub >= 0.00049 && v.stub <= 0.0006 && v.buckle >= 0.00049 && v.buckle <= 0.0006));
  check('polish H2 / K9 / S14 / S21：带子、锁舌、短带、扣头不穿进坐垫 / 靠背、离它们的面 0.5 mm（贴着、不共面；以前带子离靠背 11.5 mm）', gb.length === 0, gb.length ? Object.fromEntries(gb) : P.belt.gap);
  const bd = Object.entries(P.belt.body).filter(([, v]) => !(v && v.bodyToBelt >= 0.01 && v.beltToBody >= 0.01));
  check('polish H2：坐着的人（coop.seatBody，高 / 低画质）离安全带各件 ≥1 cm（不扣、不穿进身体）', Object.keys(P.belt.body).length === 2 && bd.length === 0, P.belt.body);
  {
    // 返修 FE1Q · repair-r3 把这一项加进仓库（repair-r2 写的 apply-seatfeet.py）。js/net/coop.js 套上 tests/output/stage-FE1Q/repair-r2/patches/coop-seat.diff
    // （SEAT_THIGH 1.32 → 1.236、SEAT_FWD −0.05）以前这一项是 FAIL：靴底悬在地台上方 3.65 cm、靴跟插进发动机盖前脸 2.95 cm —— 这是真毛病，不是测试问题
    const sf = Object.entries(P.seatFeet || {}), bad = sf.filter(([, r]) => !(r && r.aboveMat >= 0 && r.aboveMat <= 0.005 && r.minY >= 0.618 && r.hood === 0 && r.dash === 0));
    check('polish repair-r2：坐着的人（coop.seatBody，高 / 低画质）脚踩在驾驶位地台上 —— 靴底离地台顶面 0–5 mm、不低于防滑棱；没有顶点进发动机盖前脸（留 5 mm）和仪表台',
      sf.length === 2 && bad.length === 0, P.seatFeet);
  }
  // H3
  const sw = P.sw.parked, swBad = Object.entries(sw).filter(([k, v]) => k.endsWith('/drive') ? v !== 0 : v !== P.sw.tris);
  check('polish H3：仪表台大灯开关（' + P.sw.tris + ' 个三角形、只在 kit:prop）在停着的 high / mid / lite / low 里逐个三角形都有（K3），可动模型里 L1 不画（载具层画）',
    swBad.length === 0 && P.sw.tris > 0 && P.sw.mats.length === 1 && P.sw.mats[0] === 'kit:prop', sw);
  const sv = P.sw.veh || { missing: true };
  check('polish H3 / K5：停着的车的开关和载具层（vehicles.js buildSwitch，拨杆扳在「开」、指示灯熄着那一份）逐个三角形一样（位置 ≤1 µm、材质、颜色都一样）；亮着那一份指示灯在 kit:glow',
    !sv.missing && sv.tris === P.sw.tris && sv.matched === P.sw.tris && sv.bad.length === 0 && sv.lamp === 0 && sv.sameCol === P.sw.tris && P.sw.vehOn && P.sw.vehOn.glow === 2 && P.sw.vehOn.tris === P.sw.tris, Object.assign({ vehOn: P.sw.vehOn }, sv));
  // H4
  // 返修 FE1R · K4：停着的车也用可动模型的车架和配重底面、挡板 —— 停放 4 档一样要看不穿
  const cb = Object.entries(P.cw).filter(([k, v]) => !(v.leaks === 0 && v.rays > 0));
  check('polish H4 / K4：轮罩外侧下方 0.15–0.6 m 的低机位（含验收员那两个）往配重上半截、发动机盖里面连线，到达之前都先碰到正面（可动模型 4 档 × 后轮摆正 / 打满两边，停放 high / mid / lite / low）',
    cb.length === 0 && Object.keys(P.cw).length === 16, cb.length ? Object.fromEntries(cb.slice(0, 3)) : Object.fromEntries(Object.entries(P.cw).map(([k, v]) => [k, v.leaks + '/' + v.rays])));
  // H4（返修 r1）：站着 / 坐着的眼高
  const cbS = Object.entries(P.cwS || {}).filter(([k, v]) => !(v.leaks === 0 && v.rays > 0));
  check('polish H4b：站着、坐着的眼高（1.0–1.8 m）从车四周往配重下半截里面、驾驶位地台下面连线，到达之前都先碰到正面（可动模型 4 档、停放 4 档）',
    cbS.length === 0 && Object.keys(P.cwS || {}).filter(k => k.includes('/drive')).length === 4 && Object.keys(P.cwS || {}).length === 8, cbS.length ? Object.fromEntries(cbS.slice(0, 3)) : Object.fromEntries(Object.entries(P.cwS || {}).map(([k, v]) => [k, v.leaks + '/' + v.rays])));
  // H5
  const chBad = [];
  for (const [k, v] of Object.entries(P.chain)) {
    for (const lift of [0, 0.5, 1]) {
      const r = v['lift' + lift];
      if (!(r.arcPts > 0 && Math.abs(r.top - r.wantTop) < 1e-3 && r.top <= r.obbTop + 1e-6 && r.arcIn > G_SPR_R)) chBad.push([k, lift, 'arc', r]);
      // 返修 FE1R · K8 R3：各档链轮 ≥20 棱（上半圈包在链条里、只画下半圈；按相邻顶点的角度差折算）、链条搭在链轮上那半圈 ≥10 段
      if (!(r.sprocketSides >= 20 && r.caps === 4 && v.arcSeg >= 10)) chBad.push([k, lift, 'sprocket', r.sprocketSides, r.caps, v.arcSeg]);
      // 返修 FE1R · repair-r1（H5）：各档都有链板（节距 3–5 cm，画在链条贴图里）—— 链条全在链条材质里，每个顶点 v × 两节 = 弧长（误差 ≤0.1 mm）
      if (!(v.links >= 0.03 && v.links <= 0.05)) chBad.push([k, lift, 'pitch', v.links]);
      if (!(r.mats && r.mats.length === 1 && r.mats[0] === 'L1:fkChain')) chBad.push([k, lift, 'mat', r.mats]);
      if (!(r.uvN > 0 && r.uvErr <= 1e-4)) chBad.push([k, lift, 'uv', r.uvErr, r.uvN]);
    }
    if (k.endsWith('/drive') && !(v.counts && v.counts.length === 1)) chBad.push([k, 'counts', v.counts]);
  }
  // 返修 FE1R · repair-r1：一深一浅的链板（H5）补回来了 —— 画在链条贴图里（L1.js fkChains），各档都有、不加面
  check('polish H5 / K8：链条绕过链轮顶上连成一根（外表面最高 = 链轮中心 + r + 6 mm，在内门架碰撞盒里；弦离链轮轴 > r），各档链轮 ≥20 棱、搭在链轮上那半圈 ≥10 段，链轮两个端面都画；各档链条全在链条材质里、节距 3–5 cm、贴图 v 跟着弧长走（升降时链节跟着链条在链轮上滑）；可动模型链条顶点数和 lift 无关',
    chBad.length === 0 && Object.keys(P.chain).length === 8, chBad.length ? chBad.slice(0, 4) : Object.fromEntries(Object.entries(P.chain).map(([k, v]) => [k, [v.links, v.sprocket, v.arcSeg, v.lift0.sprocketSides]])));
  // 返修 FE1R · K8：圆的零件各档一样的段数（停放 4 档、可动 4 档）：方向盘轮圈 ≥23 段、前轮胎面 ≥22 / 轮辋 ≥16、后轮胎面 ≥20 / 轮辋 ≥15、
  // 气瓶 ≥19 棱、铜阀门 ≥8 棱、方向盘中心盖 ≥16 棱（repair-r1 补回来；转向柱 ≥10 棱插进中心盖）、警示灯罩 ≥12 棱、表盘 ≥20 边、每块一根指针；
  // 再按真几何量最近机位上的弦高（下一项）
  {
    const bad = [];
    for (const [k, r] of Object.entries(P.round || {})) {
      if (!(r.ring >= 23)) bad.push([k, 'ring', r.ring]);
      if (!(r.tire >= 22 && r.rim >= 16 && r.rear >= 20 && r.rimR >= 15)) bad.push([k, 'wheel', r.tire, r.rim, r.rear, r.rimR]);
      if (!(r.tank >= 19 && r.column >= 10 && r.beacon >= 12)) bad.push([k, 'tank/column/beacon', r.tank, r.column, r.beacon]);
      if (!(r.valve >= 8 && r.swHub >= 16)) bad.push([k, 'valve/swHub', r.valve, r.swHub]);   // 返修 FE1R · repair-r1：K8 点名的铜阀门、中心盖不许降
      if (r.gaugeQuads !== r.gaugesWant || !r.gaugeUVok) bad.push([k, 'gauge', r.gaugeQuads, r.gaugeUVok]);   // repair-r2：表盘是图集里的真圆
      // 返修 FE1R · repair-r2（验收员 tests / spec：K8 点名的助力球、mid 原有的前轮轮毂盖不许删）：助力球 ≥10 棱、两个前轮都有轮毂盖（图集里的圆，16 个三角形的尖顶在轮毂盖正中）、
      // 车号两边都喷（每边两位 + 一块百叶 = 3 块贴图 6 个三角形）
      if (!(r.knob >= 10)) bad.push([k, 'knob', r.knob]);
      if (r.hubTex !== 2 * 16) bad.push([k, 'hub', r.hubTex]);
      if (!(r.hoodTex && r.hoodTex[0] === 6 && r.hoodTex[1] === 6)) bad.push([k, 'number', r.hoodTex]);
    }
    check('polish K8：圆的零件段数 —— 方向盘轮圈 ≥23、前轮胎面 ≥22 / 轮辋 ≥16、后轮 ≥20 / ≥15、气瓶 ≥19、铜阀门 ≥8、方向盘中心盖 ≥16、助力球 ≥10、转向柱 ≥10、警示灯罩 ≥12；表盘、前轮轮毂盖是图集里的真圆；车号两边都喷（停放 4 档、可动 4 档一样）',
      !!P.round && Object.keys(P.round).length === 8 && bad.length === 0, bad.length ? bad.slice(0, 6) : P.round);
    const sb = [], seenAll = {};
    for (const [k, row] of Object.entries(P.k8 || {})) for (const [id, v] of Object.entries(row)) { if (v.worst && v.worst.sag > 1.0) sb.push([k, id, v.n, v.worst]); seenAll[id] = (seenAll[id] || 0) + v.seen; }
    check('polish K8 / repair-r2：图集里的表盘、前轮轮毂盖在最近机位上一个纹素 <1 px（真圆，比屏幕像素细）', !!P.texel && P.texel.gauge < 1 && P.texel.hub < 1, P.texel);
    check('polish K8：最近的正常机位上（站着离车 1 m 一圈、驾驶座、旁边车驾驶座、showOwner ②a / ⑤c，被挡住的机位不算）每个圆零件每段直边的弦高 ≤1 px（停放 4 档、可动 4 档）',
      Object.keys(P.k8 || {}).length === 8 && sb.length === 0, sb.length ? sb.slice(0, 6) : Object.fromEntries(Object.entries((P.k8 || {})['mid/drive'] || {}).map(([id, v]) => [id, [v.n, v.worst && v.worst.sag, v.worst && v.worst.view]])));
  }
  // K9 安全带扣头（③d 机位）
  {
    const kb = Object.entries(P.k9 || {}).filter(([, c]) => !(c.slot >= 12 && c.button >= 12 && c.stub >= 20));
    check('polish K9：驾驶座往左下看（头往左 1.6、往下 1.15 rad，1280×720）扣头顶面的黑色插口、红色按钮各 ≥12 像素，下面的橙色短带 ≥20 像素（看得出连进坐垫缝里）；停放 / 可动 mid、low / drvLow',
      Object.keys(P.k9 || {}).length === 4 && kb.length === 0, P.k9);
  }
  // K10 护顶横条
  {
    const kb = Object.entries(P.k10 || {}).filter(([, v]) => !(v.slats >= 2 && v.maxGap <= 0.35));
    check('polish K10：各档护顶横条均匀排开，相邻两根（含前后横梁）净空 ≤0.35 m（high / mid / lite / low / drvLow）', kb.length === 0, P.k10);
  }
  // K11 牵引销
  {
    const kb = Object.entries(P.k11 || {}).filter(([, v]) => !(v.tris > 0 && v.into >= 0.001 && v.into <= 0.005 && v.coplanar === 0));
    check('polish K11：牵引销各档都有（停放 4 档、可动 4 档），最靠前的棱插进配重后脸 1–5 mm，没有和凹口贴片共面的面', Object.keys(P.k11 || {}).length === 8 && kb.length === 0, P.k11);
  }
  // M-gaps
  {
    const g = P.mgaps || {};
    check('polish M-gaps：灯盒后脸插进前立柱（上沿 ≥1 mm、下沿更深）；坐垫底插进发动机盖顶（≤0.999）；货叉竖直段后脸插进上下横梁 2 mm（z > −1.115）',
      g.lampIntoPostTop >= 0.001 && g.lampIntoPostBot > g.lampIntoPostTop && g.seatBottom != null && g.seatBottom <= 0.999 && g.seatBottom >= 0.99 && g.forkBackZ > -1.115 && g.forkBackZ <= -1.11, g);
  }
  // M-fork
  {
    const kb = Object.entries(P.mfork || {}).filter(([, v]) => !(v.topY.length === 1 && Math.abs(v.topY[0] - 0.055) < 1e-6 && v.upNotFlat === 0 && v.tipTopZ <= -2.0999));
    check('polish M-fork：货叉顶面从叉根一直平到叉尖（朝上的面全在 0.055、没有斜面；叉尖收薄在底面），停放 4 档、可动 4 档', Object.keys(P.mfork || {}).length === 8 && kb.length === 0, P.mfork);
  }
  const dt = Object.entries(P.driveTotal).filter(([, v]) => !(v <= 2000));
  check('polish：可动模型 + 最多的磨损 + 载具层画的大灯开关，每台 ≤2000 面', dt.length === 0, P.driveTotal);
  // 返修 FE1Q · repair-r2：表盘指针从驾驶座看得见（high 两块表、mid 一块表，停着的和开过的车）
  {
    const nb = Object.entries(P.needle || {}).filter(([, r]) => !(r.gaugesWant > 0 && Object.keys(r.perGauge).length === r.gaugesWant && r.gaugeQuads === r.gaugesWant && r.rays > 0 && r.blocked === 0));
    check('polish repair-r2：表盘指针从驾驶座看整根都看得见 —— 司机眼点（左中右 ±6 cm）往每根指针上 27 个点（repair-r2：指针画在图集的表盘贴图里）连线，先碰到的都是表盘贴图，不被方向盘轮圈 / 辐条 / 中心盖 / 转向柱挡住（停着的 high / mid、可动模型 high / mid）',
      Object.keys(P.needle || {}).length === 4 && nb.length === 0, nb.length ? Object.fromEntries(nb) : Object.fromEntries(Object.entries(P.needle || {}).map(([k, r]) => [k, [r.rays, r.blocked]])));
  }
  // J2：出生块的车一律是运行时车（真进游戏）
  for (const q of ['high', 'low']) {
    const R = await pageSpawnRT(page, q), want = q === 'high' ? 'mid' : 'drvLow';
    fs.writeFileSync(path.join(OUT, 'polish-j2-' + q + '.json'), JSON.stringify(R, null, 1));
    const allRt = R.before.length > 0 && R.before.every(f => f.runtime === true && !f.spans && f.meshed && f.tier === want);
    const m = R.mid, d = R.driving || {}, a2 = (R.after || []).find(f => m && f.key === m.key) || {};
    check('polish J2（' + (q === 'high' ? '高' : '低') + '画质）：种子 12345 出生块 (0,0) 的 ' + R.before.length + ' 台车都是运行时车（不在区块几何里），一载入就在载具网格里、细节档 ' + want,
      allRt, R.before);
    // 返修 FE1R · repair-r1：sig 最后一位是 vis（K5 灯的状态，这一份模板只放用得上的那份灯：熄着的镜面 / 灯罩 / 指示灯或亮着的那份）。
    // 开着车时发动机、大灯都开着 vis = 3，只换灯那几块；前五位（档、杆数、编号、磨损、画质）= 同一个网格。停着、下车以后 vis = 0，整个 sig 一样
    const sigBase = s => (s || '').split('|').slice(0, 5).join('|'), sigVis = s => (s || '').split('|')[5];
    check('polish J2（' + (q === 'high' ? '高' : '低') + '画质）：出生柱间那台 ' + (m ? m.key : '?') + ' 停着、上车开 1.5 s、下车以后都是同一档 ' + want + '、同一个模板（停着和开过是同一个网格；开着时 sig 只有灯那一位 vis 0 → 3，下车回到 0、整个 sig 一样）',
      !!m && !!R.mount && R.mount.ok && R.mount.seated === m.key && d.moved > 0.3 && d.tier === want && sigBase(d.sig) === sigBase(m.sig) && sigVis(m.sig) === '0' && sigVis(d.sig) === '3' && d.meshed && a2.tier === want && a2.sig === m.sig,
      { mid: m && { key: m.key, tier: m.tier, sig: m.sig }, mount: R.mount, driving: d, after: { tier: a2.tier, sig: a2.sig } });
  }
  // K3 / K4 / K5：停着 vs 开过，同机位逐像素（停放 high / lite / low@高画质 / low@低画质；mid 停放档实际生成不出来 —— 和 high 一样贵，放得下 mid 就放得下 high）
  {
    const dir = path.join(OUT, 'pairs');
    fs.mkdirSync(dir, { recursive: true });
    const R = await pagePairs(page, PAIR_CASES, dir);
    fs.writeFileSync(path.join(OUT, 'polish-pairs.json'), JSON.stringify(R, null, 1));
    for (const [tag, r] of Object.entries(R)) {
      const bad = r.missing ? ['missing'] : Object.entries(r.diff).filter(([, v]) => v.blob !== 0);
      const seen = r.missing ? 0 : Object.values(r.diff).filter(v => v.carPx > 0).length;
      const sum = r.missing ? null : Object.fromEntries(Object.entries(r.diff).map(([n, v]) => [n, v.car + '/' + v.carPx + (v.out ? ' 外' + v.out : '') + (v.retry ? ' 重拍（第一遍 ' + v.retry.first.blob + ' 片@' + v.retry.first.at + '，再拍 ' + v.retry.again.blob + ' 片）' : '')]));
      const nDark = r.missing ? 0 : Object.keys(r.diff).filter(n => n.startsWith('dark:')).length;
      check('polish K3：' + tag + '（停放 ' + (r.info && r.info.detail) + ' → 开过 ' + (r.st1 && r.st1.tier) + '）停着和摆回原位的开过的车，有电、断电各 ' + PAIR_CAMS.length + ' 个机位（一圈每 30°、驾驶座往前 / 左下 / 右下 / 上、轮罩低机位两边、车后低机位、气瓶、警示灯、大灯、仪表台、牵引销、后轮、正上方）逐像素一样：' +
        '灯池按机位定死，车所在的像素里差 >10/255 的只有棱边上一像素宽的浮点舍入翻转，没有成片（≥3×3）的',
        !r.missing && r.info.detail === r.tierP && !r.st0.meshed && r.st1.meshed && r.st1.tier === r.tierD && bad.length === 0 && seen >= 2 * PAIR_CAMS.length - 4 && nDark === PAIR_CAMS.length,
        r.missing ? r : { info: r.info, st1: r.st1, dark: r.dark, bad: bad.slice(0, 6), seen, diff: sum });
    }
  }
  // K5：熄着的灯停着、开过、出生车一模一样（有电 / 断电）
  for (const dark of [false, true]) {
    const R = await pageDark(page, dark);
    fs.writeFileSync(path.join(OUT, 'polish-k5-' + (dark ? 'dark' : 'lit') + '.json'), JSON.stringify(R, null, 1));
    const bad = R.missing ? ['missing'] : Object.entries(R.diff).filter(([, v]) => v.drv.blob !== 0 || v.rt.blob !== 0 || !(v.drv.carPx > 0));
    const sum = R.missing ? null : Object.fromEntries(Object.entries(R.diff).map(([n, v]) => [n, { drv: v.drv.car + '/' + v.drv.carPx + (v.drv.blob ? ' 片' + v.drv.blob + '@' + v.drv.at : ''), rt: v.rt.car + '/' + v.rt.carPx + (v.rt.blob ? ' 片' + v.rt.blob + '@' + v.rt.at : '') }]));
    check('polish K5（' + (dark ? '断电' : '有电') + '）：种子 2 低画质，区块里停着的 1@-1,0#v0、摆回原位熄了火的它、出生车挪到同一位姿，' + DARK_CAMS.length + ' 个机位（两盏大灯、警示灯后 / 侧、仪表台、开关）逐像素一样' + (dark ? '（等到第一次断电，灯全灭）' : '') +
      '：灯池按机位定死，车所在的像素里没有成片（≥3×3）的差异（棱边上一像素宽的是浮点舍入）',
      !R.missing && R.tiers.k1 === 'drvLow' && R.tiers.k0 === 'drvLow' && (!dark || (R.lit0.n > 0 && R.lit0.on === 0)) && bad.length === 0, R.missing ? R : { tiers: R.tiers, lit0: R.lit0, t: R.t, diff: sum, bad: bad.slice(0, 3) });
  }
  // H12
  const B = await pageBlackoutWalk(page);
  fs.writeFileSync(path.join(OUT, 'polish-blackout.json'), JSON.stringify(B, null, 1));
  const d = B.during || {}, a = B.after || {};
  check('polish H12：断电途中往西走 96 m，新载入的 ' + d.newChunks + ' 块（' + d.newLights + ' 盏灯）一盏都不亮、不占灯池（灯池里亮着的 ' + d.pool + ' 盏）；来电以后它们按原亮度亮回来',
    !!B.plan && d.newChunks >= 5 && d.newLights > 0 && d.newLit === 0 && d.oldLit === 0 && d.poolNew === 0 && a.newLights > 0 && a.bad === 0 && a.newRestored === a.newLights, B);
}
const G_SPR_R = 0.035;

main();
