// 后室 · 层级工具库测试：node tests/kit.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），验证 BR.kit 对层级代理的硬承诺：
//   1. 格子跨区块无缝：相邻块边界线逐段一致；每条边界至少 minOpenings 个开口；块内全连通；7×7 块拼起来全局连通
//   2. 世界坐标 UV 跨区块连续；出口描述（范围外自动 sealed、event 默认不激活、层级名规整）
//   3. 纯色发光件采的纹素够白（正式 jpg 与程序化兜底各查一次）
//   4. Level Dev 实际区块：每块 mesh 数（按材质合并）、三角形数、刷新点不在碰撞体里
//   5. world 出口：未开放出口进圈 toast 一次、站着一直提示、出圈收起、不换层；目标在范围内但未注册同样提示；
//      active=false 的出口跳过；切出（noclip）换层带 'noclip' 音效与闪白
//   6. 截图：出生房间（切出墙、未开放电梯）、构件展示间、区块俯视图（碰撞体/刷新点/出口）
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。截图写 tests/output/kit-*.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const SEED = 20260913;
// --only pure,fallback,world,reg,levels：只跑其中几段（缺省全跑）；--levels 0,1,dev：道具登记一致性只查这几层（缺省 LEVEL_ORDER 全部 26 层）
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ONLY = argOf('only') ? new Set(argOf('only').split(',').map(s => s.trim())) : null;
const want = s => !ONLY || ONLY.has(s);
const LEVELS_ARG = argOf('levels');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary',
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

const results = [];
const errors = [];
const shots = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
}
function watch(page, tag) {
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
}
async function shot(page, name) {
  const f = path.join(OUT, 'kit-' + name + '.png');
  await page.screenshot({ path: f });
  shots.push(f);
  console.log('     shot ' + path.relative(ROOT, f));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function boot(page, base) {
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.kit, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
}

// 纯色发光件采样点周围 3×3 的最小通道值（贴图按 flipY 翻 v）
function sampleWhite() {
  const t = BR.assets.texture('light_panel');
  const img = t.image;
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  const u = BR.kit.WHITE_UV[0], v = BR.kit.WHITE_UV[1];
  const px = Math.floor(u * w), py = Math.floor((t.flipY ? 1 - v : v) * h);
  const d = g.getImageData(px - 1, py - 1, 3, 3).data;
  let min = 255;
  for (let i = 0; i < d.length; i += 4) min = Math.min(min, d[i], d[i + 1], d[i + 2]);
  return { src: img.tagName || (img.constructor && img.constructor.name), w, h, px, py, min };
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    if (want('pure')) await pureKit(browser, base);
    if (want('fallback')) await fallbackTexture(browser, base);
    if (want('world')) await inWorld(browser, base);
    if (want('reg')) await registry(browser, base);
    if (want('levels')) await levelRegistry(browser, base);
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT));
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

// =====================================================================
// 1–3：不进游戏，直接调 BR.kit
// =====================================================================
async function pureKit(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  watch(page, 'kit');
  await boot(page, base);

  const seam = await ev(page, () => {
    const kit = BR.kit, lv = BR.levels.get('dev');
    const seed = 987654321, N = 8, R = 3;
    const params = [
      { name: 'Ldev', wallDensity: 0.37, straightness: 0.7, roomChance: 0.55, roomSize: [2, 4], maxRooms: 2, loopChance: 0.5, pillarChance: 0.05 },
      { name: '密墙无回路', wallDensity: 0.8, straightness: 0.5, roomChance: 0, loopChance: 0, pillarChance: 0 },
      { name: '开阔柱厅', wallDensity: 0.15, straightness: 0.9, roomChance: 0.9, roomSize: [3, 6], loopChance: 1, pillarChance: 0.5 },
      { name: '边界全开口', wallDensity: 0.5, boundaryDensity: 0.95, minOpenings: 3, straightness: 0.6 },
    ];
    const report = [];
    for (const P of params) {
      const G = new Map();
      for (let cz = -R; cz <= R; cz++) {
        for (let cx = -R; cx <= R; cx++) {
          const b = kit.builder({ level: lv, levelSeed: seed }, cx, cz, BR.util.rng(seed, cx, cz));
          G.set(cx + ',' + cz, kit.grid(b, N, N, P));
        }
      }
      const want = P.minOpenings != null ? P.minOpenings : Math.max(1, Math.floor(N / 4));
      let seamErr = 0, minOpen = Infinity, localDisc = 0, rooms = 0, pillars = 0, walls = 0, edges = 0;
      for (const [k, g] of G) {
        const cx = +k.split(',')[0], cz = +k.split(',')[1];
        const e = G.get((cx + 1) + ',' + cz), s = G.get(cx + ',' + (cz + 1));
        for (let j = 0; j < N; j++) if (e && g.isWall('v', N, j) !== e.isWall('v', 0, j)) seamErr++;
        for (let i = 0; i < N; i++) if (s && g.isWall('h', i, N) !== s.isWall('h', i, 0)) seamErr++;
        let ow = 0, on = 0;
        for (let j = 0; j < N; j++) if (!g.isWall('v', 0, j)) ow++;
        for (let i = 0; i < N; i++) if (!g.isWall('h', i, 0)) on++;
        minOpen = Math.min(minOpen, ow, on);
        rooms += g.rooms.length; pillars += g.pillars.length;
        for (const ed of g.edges({ interior: true })) { edges++; if (ed.wall) walls++; }
        const seen = new Uint8Array(N * N), st = [0];
        seen[0] = 1;
        let cnt = 1;
        while (st.length) {
          const id = st.pop(), i = id % N, j = (id / N) | 0, w = g.walls(i, j);
          const nb = [];
          if (!w.n && j > 0) nb.push(id - N);
          if (!w.s && j < N - 1) nb.push(id + N);
          if (!w.w && i > 0) nb.push(id - 1);
          if (!w.e && i < N - 1) nb.push(id + 1);
          for (const q of nb) if (!seen[q]) { seen[q] = 1; cnt++; st.push(q); }
        }
        if (cnt !== N * N) localDisc++;
      }
      // 全局：把 (2R+1)² 块拼成一张大格子图，从左上角出发 BFS
      const W = (2 * R + 1) * N, total = W * W;
      const seen = new Uint8Array(total), st = [0];
      seen[0] = 1;
      let reached = 1;
      while (st.length) {
        const id = st.pop(), gx = id % W, gz = (id / W) | 0;
        const cx = Math.floor(gx / N) - R, cz = Math.floor(gz / N) - R, i = gx % N, j = gz % N;
        const g = G.get(cx + ',' + cz);
        const moves = [];
        if (gx + 1 < W && !g.isWall('v', i + 1, j)) moves.push(id + 1);
        if (gx > 0 && !g.isWall('v', i, j)) moves.push(id - 1);
        if (gz + 1 < W && !g.isWall('h', i, j + 1)) moves.push(id + W);
        if (gz > 0 && !g.isWall('h', i, j)) moves.push(id - W);
        for (const q of moves) if (!seen[q]) { seen[q] = 1; reached++; st.push(q); }
      }
      report.push({ name: P.name, seamErr, minOpen, want, localDisc, reached, total, rooms, pillars, interiorWallRatio: +(walls / edges).toFixed(2) });
    }
    return report;
  });
  for (const r of seam) {
    check('格子[' + r.name + ']：相邻区块边界线逐段一致', r.seamErr === 0, r);
    check('格子[' + r.name + ']：每条边界至少 ' + r.want + ' 个开口', r.minOpen >= r.want, { minOpen: r.minOpen });
    check('格子[' + r.name + ']：块内全连通、7×7 块全局连通', r.localDisc === 0 && r.reached === r.total, { localDisc: r.localDisc, reached: r.reached, total: r.total });
  }

  // setWall 加墙把一格围成死格 → gridWalls 自动 reconnect：用独立随机流（层级 rng 后续取值不变）、结果确定、全连通
  const rc = await ev(page, () => {
    const kit = BR.kit, lv = BR.levels.get('dev'), N = 8, seed = 4242;
    const conn = g => {
      const seen = new Uint8Array(N * N), st = [0];
      seen[0] = 1;
      let cnt = 1;
      while (st.length) {
        const id = st.pop(), i = id % N, j = (id / N) | 0, w = g.walls(i, j);
        const nb = [];
        if (!w.n && j > 0) nb.push(id - N);
        if (!w.s && j < N - 1) nb.push(id + N);
        if (!w.w && i > 0) nb.push(id - 1);
        if (!w.e && i < N - 1) nb.push(id + 1);
        for (const q of nb) if (!seen[q]) { seen[q] = 1; cnt++; st.push(q); }
      }
      return cnt === N * N;
    };
    const build = edit => {
      const b = kit.builder({ level: lv, levelSeed: seed }, 2, -3, BR.util.rng(seed, 2, -3));
      const g = kit.grid(b, N, N, { wallDensity: 0.3, roomChance: 0, loopChance: 0 });
      let isolated = null;
      if (edit) {
        g.h[5 * N + 4] = 1;                  // 南墙：生成出来的（未锁定）
        g.setWall('h', 4, 4, true);          // 北、西、东：层级手动加的（锁定）
        g.setWall('v', 4, 4, true);
        g.setWall('v', 5, 4, true);
        isolated = !conn(g);
      }
      kit.gridWalls(b, g, { matKey: 'kit:prop' });
      const next = b.rng();
      b.finish().group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      return { isolated, connected: conn(g), dirty: g._dirty, south: g.h[5 * N + 4], sig: Array.from(g.v).join('') + Array.from(g.h).join(''), next };
    };
    const a = build(true), a2 = build(true), plain = build(false);
    return { isolatedBefore: a.isolated, connected: a.connected, dirty: a.dirty, southOpened: a.south === 0, same: a.sig === a2.sig, rngUntouched: a.next === plain.next };
  });
  check('setWall 围死一格 → gridWalls 自动 reconnect 打通、结果确定、不动层级 rng', rc.isolatedBefore && rc.connected && !rc.dirty && rc.southOpened && rc.same && rc.rngUntouched, rc);

  const misc = await ev(page, () => {
    const kit = BR.kit, lv = BR.levels.get('dev');
    const ctx = { level: lv, levelSeed: 1 };
    const out = {};
    // 世界 UV：块 3 的 x=24 边与块 4 的 x=0 边（世界 x=96）小数部分一致
    kit.mat('kittest:w', { color: 0xffffff, repeatMeters: 1.3 });
    const a = kit.builder(ctx, 3, 0), b = kit.builder(ctx, 4, 0);
    a.plane(22, 0, 5, 4, 2.8, 'kittest:w', { facing: '+z' });
    b.plane(2, 0, 5, 4, 2.8, 'kittest:w', { facing: '+z' });
    a.box(12, 0, 23.9, 3, 2.8, 0.2, 'kittest:w', { faces: 'sides' });
    const ra = a.finish(), rb = b.finish();
    const edgeU = (res, wantX) => {
      const g = res.group.children[0].geometry, P = g.attributes.position, T = g.attributes.uv;
      for (let i = 0; i < P.count; i++) if (Math.abs(P.getX(i) - wantX) < 1e-4 && Math.abs(P.getY(i)) < 1e-4 && Math.abs(P.getZ(i) - 5) < 1e-4) return T.getX(i);
      return NaN;
    };
    const ua = edgeU(ra, 24), ub = edgeU(rb, 0);
    const fr = x => x - Math.floor(x);
    out.uv = { ua, ub, diff: Math.abs(fr(ua) - fr(ub)) };
    out.solids = ra.solids.length;
    out.solidOk = ra.solids.some(s => Math.abs(s.minX - (72 + 10.5)) < 1e-4 && Math.abs(s.maxZ - 24) < 1e-4 && Math.abs(s.maxY - 2.8) < 1e-4);
    out.meshesA = ra.group.children.length;
    // 出口描述
    const c = kit.builder(ctx, 50, 50);
    const hv = kit.exit(c, { to: 'The Void', kind: 'hole', x: 5, z: 5 });
    const h27 = kit.exit(c, { to: 'Level 27', kind: 'door', x: 10, z: 5 });
    const h7 = kit.exit(c, { to: 'Level 7', kind: 'stairs', x: 15, z: 5 });
    const hr = kit.exit(c, { to: 'Level !', kind: 'zone', x: 20, z: 5 });
    const he = kit.exit(c, { to: 'fun', kind: 'event', x: 5, z: 15, tag: 'party-door' });
    const hn = kit.exit(c, { to: '1', kind: 'noclip', x: 12, z: 15, w: 2.4 });
    const rc = c.finish();
    out.exits = {
      void: [hv.sealed, hv.desc.sealedText, hv.desc.radius >= 1.4],
      l27: [h27.sealed, h27.to, h27.desc.sealedText],
      l7: [h7.sealed, h7.to, h7.desc.label],
      run: [hr.to, hr.sealed],
      event: [he.active, he.desc.tag],
      noclipMesh: !!(hn.parts && hn.parts.mesh && hn.parts.mesh.parent === rc.group),
      count: rc.exits.length,
    };
    he.setActive(true);
    out.exits.eventAfter = rc.exits.find(e => e.tag === 'party-door').active;
    out.names = [kit.levelId('Level !'), kit.levelId('Level Fun'), kit.levelId(' level 12 '), kit.inRange('27'), kit.inRange('run'), kit.levelName('27'), kit.levelName('run'), kit.loreKey('run')];
    // 高度场
    const hf = kit.heightField(kit.heightField.stack(kit.heightField.ramp({ minX: 0, maxX: 10, minZ: 0, maxZ: 2, axis: 'x', y0: 0, y1: 2 }), kit.heightField.flat({ minX: 10, maxX: 20, minZ: 0, maxZ: 2, y: 2 })));
    out.height = [hf.at(5, 1), hf.at(15, 1), hf.at(30, 1)];
    for (const r of [ra, rb, rc]) r.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    return out;
  });
  check('世界 UV：跨区块边界贴图连续', misc.uv.diff < 1e-3 || Math.abs(misc.uv.diff - 1) < 1e-3, misc.uv);
  check('box 自动出 AABB（世界坐标）', misc.solidOk, { solids: misc.solids });
  check('finish 按材质合并：同材质 3 件 = 1 个 mesh', misc.meshesA === 1, { meshes: misc.meshesA });
  const E = misc.exits;
  check('出口：The Void 范围外 → sealed，提示文案与放大的提示圈', E.void[0] === true && E.void[1] === 'The Void 尚未开放' && E.void[2], E.void);
  check('出口：Level 27 → to "27"、sealed、"Level 27 尚未开放"', E.l27[0] === true && E.l27[1] === '27' && E.l27[2] === 'Level 27 尚未开放', E.l27);
  check('出口：Level 7 在首期范围 → 普通出口', E.l7[0] === false && E.l7[1] === '7', E.l7);
  check('出口：Level ! → run', E.run[0] === 'run' && E.run[1] === false, E.run);
  check('出口：event 默认不激活，setActive(true) 改的就是描述', E.event[0] === false && E.eventAfter === true && E.event[1] === 'party-door', E);
  check('出口：noclip 墙是独立 mesh、进了区块 group', E.noclipMesh === true && E.count === 6, E);
  check('层级名规整', JSON.stringify(misc.names) === JSON.stringify(['run', 'fun', '12', false, true, 'Level 27', 'Level !', '!']), misc.names);
  check('高度场：坡道/平台/外面退回 0', Math.abs(misc.height[0] - 1) < 1e-6 && misc.height[1] === 2 && misc.height[2] === 0, misc.height);

  const white = await ev(page, sampleWhite);
  check('纯色发光纹素够白（正式 jpg）', white.min >= 235, white);
  await ctx.close();
}

// 程序化兜底贴图（file:// 双击打开时走这条）：拦掉 jpg 让 assets 画兜底
async function fallbackTexture(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('[fallback] pageerror: ' + (e.stack || e.message)));   // 404 的资源报错是故意的，不计
  await page.route(/assets\/tex\/light_panel\.jpg/, r => r.fulfill({ status: 404, body: 'nope' }));
  await boot(page, base);
  const white = await ev(page, sampleWhite);
  check('纯色发光纹素够白（程序化兜底）', white.min >= 235 && white.src !== 'IMG', white);
  await ctx.close();
}

// =====================================================================
// 4–6：进 Level Dev（测试模式：不自动刷实体，画面干净）
// =====================================================================
async function inWorld(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  watch(page, 'world');
  await boot(page, base);
  await ev(page, seed => {
    __br.start({ mode: 'test', seed, levelId: 'dev', settings: { visibility: 1 } });
    __br.setAuto(false);
    // 层级名大字会挡住截图中间
    const css = document.createElement('style');
    css.textContent = '.hud-title{display:none!important}';
    document.head.appendChild(css);
    window.__kitSpy = { toast: [], play: [], flash: 0, enter: 0 };
    const H = BR.hud, A = BR.audio, G = BR.gfx;
    const ot = H.toast; H.toast = function (t) { __kitSpy.toast.push(String(t)); return ot.apply(this, arguments); };
    const op = A.play; A.play = function (n) { __kitSpy.play.push(String(n)); return op.apply(this, arguments); };
    const of = G.flash; G.flash = function () { __kitSpy.flash++; return of.apply(this, arguments); };
    BR.bus.on('level:enter', () => { __kitSpy.enter++; });
    __br.step(0.5);
  }, SEED);
  const tp = (x, z, yaw, pitch, dt) => ev(page, a => {
    const p = BR.player;
    p.x = a.x; p.z = a.z; p.vx = 0; p.vz = 0;
    if (a.yaw != null) p.yaw = a.yaw;
    p.pitch = a.pitch != null ? a.pitch : 0;
    __br.step(a.dt != null ? a.dt : 0.1);
    return { x: p.x, z: p.z, level: BR.game.levelId, tr: BR.world.transitioning };
  }, { x, z, yaw, pitch, dt });
  const promptText = () => ev(page, () => {
    const el = document.querySelector('.hud-prompt');
    return el && !el.hidden ? (el.querySelector('.hud-prompt-text') || el).textContent : null;
  });

  // ---------- 4. 区块统计 ----------
  const st = await ev(page, () => {
    const out = { chunks: 0, maxMeshes: 0, maxMeshesKey: '', maxTris: 0, sumTris: 0, maxLights: 0, spawnPts: 0, dropped: 0, bad: [], names: {} };
    for (const c of BR.world.chunks()) {
      const s = c.res.kit && c.res.kit.stats;
      if (!s) continue;
      out.chunks++;
      if (s.meshes > out.maxMeshes) { out.maxMeshes = s.meshes; out.maxMeshesKey = c.key; }
      out.maxTris = Math.max(out.maxTris, s.triangles);
      out.sumTris += s.triangles;
      out.maxLights = Math.max(out.maxLights, s.lights);
      out.dropped += s.spawnDropped;
      for (const m of c.group.children) out.names[m.name] = (out.names[m.name] || 0) + 1;
      for (const p of c.spawnPoints) {
        out.spawnPts++;
        if (BR.phys.overlapCircle(p.x, p.z, 0.3, p.y, 1.7)) out.bad.push([c.key, +p.x.toFixed(2), +p.z.toFixed(2)]);
      }
    }
    out.world = BR.world.debugInfo();
    // 预算按画质分：高 10000 / 低 8000（BR.kit.budget，_TEMPLATE.md 第 16 节）
    const lowQ = BR.game && BR.game.settings && BR.game.settings.quality === 'low';
    out.triCap = lowQ ? BR.kit.budget.trisLow : BR.kit.budget.trisHigh;
    out.quality = lowQ ? 'low' : 'high';
    return out;
  });
  check('Level Dev：出生点周围 5×5 区块全部由 kit 建成', st.chunks === 25, { chunks: st.chunks });
  check('Level Dev：每块 mesh ≤ 8（按材质合并）', st.maxMeshes <= 8, { maxMeshes: st.maxMeshes, at: st.maxMeshesKey, names: st.names });
  check('Level Dev：每块三角形 ≤ ' + st.triCap + '（' + st.quality + ' 画质）', st.maxTris <= st.triCap, { maxTris: st.maxTris, avg: Math.round(st.sumTris / Math.max(1, st.chunks)) });
  check('Level Dev：刷新点都不在碰撞体里、数量够', st.bad.length === 0 && st.spawnPts >= st.chunks * 20, { spawnPts: st.spawnPts, dropped: st.dropped, bad: st.bad.slice(0, 5) });

  const ex = await ev(page, () => {
    const list = BR.world.exits();
    const pick = f => { const e = list.find(f); return e ? { x: e.x, z: e.z, r: e.radius, to: e.to, kind: e.kind, sealed: !!e.sealed, text: e.sealedText || null } : null; };
    return {
      sealed: pick(e => e.to === '999'),
      noclip: pick(e => e.kind === 'noclip'),
      spawn: { x: BR.player.x, z: BR.player.z },
      handles999: BR.kit.handles({ to: '999' }).map(h => h.sealed),
    };
  });
  check('Level Dev：出生房间有未开放电梯（to 999, sealed）与切出墙', !!ex.sealed && ex.sealed.sealed && ex.sealed.kind === 'elevator' && !!ex.noclip && ex.noclip.to === 'dev', ex);
  check('BR.kit.handles 能从已载入区块找回出口句柄', ex.handles999.length === 1 && ex.handles999[0] === true, ex.handles999);

  // ---------- 5a. 未开放出口 ----------
  const S0 = ex.spawn;
  const t0 = await ev(page, () => __kitSpy.toast.length);
  const in1 = await tp(ex.sealed.x, ex.sealed.z, -Math.PI / 2);
  const p1 = await promptText();
  const t1 = await ev(page, () => __kitSpy.toast.slice());
  check('未开放：进圈 toast "Level 999 尚未开放" 一次、prompt 同文案、不换层', t1.length === t0 + 1 && t1[t1.length - 1] === 'Level 999 尚未开放' && p1 === 'Level 999 尚未开放' && in1.level === 'dev' && !in1.tr, { toasts: t1, prompt: p1, in1 });
  await shot(page, 'sealed-elevator');
  await tp(ex.sealed.x, ex.sealed.z, -Math.PI / 2, 0, 2.0);
  const t2 = await ev(page, () => __kitSpy.toast.length);
  const p2 = await promptText();
  check('未开放：站在圈里 2 秒不重复 toast，提示一直在', t2 === t0 + 1 && p2 === 'Level 999 尚未开放', { toasts: t2 - t0, prompt: p2 });
  await tp(S0.x, S0.z, 0, 0, 0.2);
  const p3 = await promptText();
  check('未开放：走出圈提示收起', p3 === null, { prompt: p3 });
  await tp(ex.sealed.x, ex.sealed.z, -Math.PI / 2);
  const t4 = await ev(page, () => __kitSpy.toast.length);
  check('未开放：出去再进来才再 toast 一次', t4 === t0 + 2, { toasts: t4 - t0 });
  await tp(S0.x, S0.z, 0, 0, 0.2);

  // 范围内但层级文件还没注册（第二波开发期间常见）：同样只提示。
  // 目标层按 BR.LEVEL_ORDER 里第一个还没注册的挑 —— 写死某一层的话，那一层做完注册后这条用例就会真的换层
  const unreg = await ev(page, s => {
    const to = (BR.LEVEL_ORDER || []).find(id => !BR.levels.has(id));
    if (to === undefined) return { skipped: true };
    const c = BR.world.chunkAt(s.x, s.z);
    const e = { x: s.x + 2.2, y: 0, z: s.z - 2.2, radius: 0.8, to, kind: 'door', label: '前往 Level ' + to, sealed: false, active: true };
    c.exits.push(e);
    const n0 = __kitSpy.toast.length;
    BR.player.x = e.x; BR.player.z = e.z; __br.step(0.1);
    const el = document.querySelector('.hud-prompt');
    const r = { to, toasts: __kitSpy.toast.slice(n0), prompt: el && !el.hidden ? el.textContent : null, level: BR.game.levelId, tr: BR.world.transitioning };
    c.exits.splice(c.exits.indexOf(e), 1);
    BR.player.x = s.x; BR.player.z = s.z; __br.step(0.1);
    return r;
  }, S0);
  check('范围内未注册（Level ' + (unreg.to || '全部已注册') + '）：提示"尚未开放"、不换层', unreg.skipped ||
    (unreg.toasts.length === 1 && unreg.toasts[0] === 'Level ' + unreg.to + ' 尚未开放' && unreg.level === 'dev' && !unreg.tr), unreg);

  // ---------- 5b. active=false 跳过，setActive(true) 后生效；切出换层 ----------
  const off = await ev(page, n => {
    const h = BR.kit.handles({ kind: 'noclip' })[0];
    h.setActive(false);
    const e0 = __kitSpy.enter, p0 = __kitSpy.play.length;
    BR.player.x = n.x; BR.player.z = n.z;
    __br.step(0.6);
    return { enter: __kitSpy.enter - e0, plays: __kitSpy.play.slice(p0), tr: BR.world.transitioning };
  }, ex.noclip);
  check('active=false 的出口 world 跳过', off.enter === 0 && !off.tr && off.plays.indexOf('noclip') < 0, off);
  await shot(page, 'noclip-wall-inactive');
  await tp(ex.noclip.x + 3.2, ex.noclip.z, Math.PI / 2, 0, 0.2);
  await ev(page, () => __br.step(0.3));
  await shot(page, 'noclip-wall');
  await tp(ex.noclip.x, ex.noclip.z, Math.PI / 2, 0, 0.05);
  const on = await ev(page, () => {
    const e0 = __kitSpy.enter, p0 = __kitSpy.play.length, f0 = __kitSpy.flash;
    BR.kit.handles({ kind: 'noclip' })[0].setActive(true);
    __br.step(0.05);
    return { e0, plays: __kitSpy.play.slice(p0), flash: __kitSpy.flash - f0, tr: BR.world.transitioning };
  });
  check('切出：setActive(true) 后站在圈里立刻触发，播 noclip 音效并闪白', on.tr && on.plays.indexOf('noclip') >= 0 && on.flash === 1, on);
  let entered = false;
  for (let k = 0; k < 80 && !entered; k++) {
    const s = await ev(page, () => { __br.step(0.1); return { enter: __kitSpy.enter, tr: BR.world.transitioning }; });
    entered = s.enter > on.e0 && !s.tr;
    if (!entered) await page.waitForTimeout(100);
  }
  const after = await ev(page, () => ({ level: BR.game.levelId, x: BR.player.x, z: BR.player.z }));
  check('切出：换层完成（回到 Level Dev 出生点）', entered && after.level === 'dev' && Math.hypot(after.x - S0.x, after.z - S0.z) < 0.5, after);

  // ---------- 6. 截图 ----------
  await tp(S0.x, S0.z, 0, 0, 0.3);
  await shot(page, 'spawn-north');
  await tp(S0.x - 1, S0.z + 3, -Math.PI / 2, 0, 0.3);
  await shot(page, 'spawn-east-elevator');
  // 构件展示间：区块 (-1, 0)，世界 x ∈ [-24, 0]
  const views = [
    ['show-row1-a', -19, 8.3, 0, -0.08], ['show-row1-b', -10, 8.3, 0, -0.08], ['show-row1-c', -3.5, 8.3, 0.25, -0.08],
    ['show-row2-a', -19.5, 15.3, 0, 0], ['show-row2-b', -9, 15.8, 0, -0.05],
    ['show-row3-a', -19, 20.6, 0, 0], ['show-row3-b', -9, 20.6, 0, 0],
    ['show-row4-floor', -18.5, 18.6, Math.PI, -0.55], ['show-row4-b', -7.5, 18.6, Math.PI, 0.1],
  ];
  for (const v of views) {
    await tp(v[1], v[2], v[3], v[4], 0.3);
    await shot(page, v[0]);
  }

  // 俯视图：碰撞体（灰）、区块边界（红虚线）、刷新点（绿，safe 为青）、出口（未开放红圈、切出青圈、其他黄圈）
  const png = await ev(page, () => {
    const cs = BR.world.chunks(), S = BR.world.chunkSize, k = 6;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of cs) { x0 = Math.min(x0, c.cx * S); z0 = Math.min(z0, c.cz * S); x1 = Math.max(x1, (c.cx + 1) * S); z1 = Math.max(z1, (c.cz + 1) * S); }
    const cv = document.createElement('canvas');
    cv.width = (x1 - x0) * k; cv.height = (z1 - z0) * k;
    const g = cv.getContext('2d');
    g.fillStyle = '#2b2512'; g.fillRect(0, 0, cv.width, cv.height);
    const X = x => (x - x0) * k, Z = z => (z - z0) * k;
    g.fillStyle = '#9a9384';
    for (const c of cs) for (const s of c.solids) if (s.maxY > 0.3) g.fillRect(X(s.minX), Z(s.minZ), Math.max(1, (s.maxX - s.minX) * k), Math.max(1, (s.maxZ - s.minZ) * k));
    g.strokeStyle = 'rgba(255,60,60,0.7)'; g.setLineDash([6, 6]); g.lineWidth = 1;
    for (const c of cs) g.strokeRect(X(c.cx * S), Z(c.cz * S), S * k, S * k);
    g.setLineDash([]);
    for (const c of cs) for (const p of c.spawnPoints) { g.fillStyle = p.safe ? '#3ee' : '#4c4'; g.fillRect(X(p.x) - 2, Z(p.z) - 2, 4, 4); }
    for (const e of BR.world.exits()) {
      g.strokeStyle = e.sealed ? '#f33' : e.kind === 'noclip' ? '#3ff' : '#fd3'; g.lineWidth = 2;
      g.beginPath(); g.arc(X(e.x), Z(e.z), e.radius * k, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(BR.player.x), Z(BR.player.z), 4, 0, Math.PI * 2); g.fill();
    return cv.toDataURL('image/png');
  });
  const mapFile = path.join(OUT, 'kit-map.png');
  fs.writeFileSync(mapFile, Buffer.from(png.split(',')[1], 'base64'));
  shots.push(mapFile);
  console.log('     shot ' + path.relative(ROOT, mapFile));

  const gi = await ev(page, () => { __br.step(0.1); const i = BR.gfx.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : null }; });
  console.log('     出生点北望一帧：' + JSON.stringify(gi));
  check('出生点一帧 draw call ≤ 120（25 块载入、雾内可见约 1/3）', gi.calls <= 120, gi);
  await ctx.close();
}

// =====================================================================
// 7. 道具登记（A1）：作用域、key、spans、碰撞体拆分、能不能拖、moveProp / settleProp / toWorld
// =====================================================================
async function registry(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  watch(page, 'reg');
  await boot(page, base);

  // ---------- 7a. 合成场景：嵌套道具、容器、部件、设备、出口圈、显式 on ----------
  const syn = await ev(page, () => {
    const kit = BR.kit, lv = BR.levels.get('dev'), U = BR.util;
    const b = kit.builder({ level: lv, levelSeed: 7 }, 3, 4, U.rng(7, 3, 4));
    const pcs = {};
    b.box(1, 0, 1, 4, 2.8, 0.2, 'kit:prop', { color: 0x888888 });           // 墙：不登记
    const A = b.prop({ kind: 'rack', label: '货架', pivot: [6, 6, 0.5] }, () => {
      pcs.A = [b.box(6, 0, 6, 1.2, 2, 0.6, 'kit:prop', { color: 0x777777 })];
      pcs.A.push(b.box(6, 2, 6, 1.2, 0.05, 0.6, 'kit:glow', { solid: false, uv: 'solid', color: [1, 1, 1] }));
      b.prop({ kind: 'crateOnRack', label: '木箱', draggable: false, strapped: true }, () => {
        pcs.A1 = [b.box(6, 1, 6, 0.5, 0.5, 0.5, 'kit:prop', {})];
        b.container({ kind: 'crate', dims: [0.5, 0.5, 0.5], slots: [[0, 0.05, 0]], loot: 'crate' }, () => {
          pcs.A1c = [b.box(6, 1.5, 6, 0.5, 0.01, 0.5, 'kit:prop', { solid: false })];
          pcs.A1.push(pcs.A1c[0]);
        });
      });
      pcs.A.push(b.box(6.4, 0, 6, 0.2, 0.2, 0.2, 'kit:prop', { solid: false }));
      b.part({ type: 'slide', name: 'drawer', pivot: [6, 0.3, 6.3], locked: true }, () => { pcs.Ap = [b.box(6, 0.2, 6.3, 0.4, 0.2, 0.02, 'kit:prop', { solid: false })]; pcs.A.push(pcs.Ap[0]); });
      b.part({ type: 'slide', name: 'drawer' }, () => { const p = b.box(6, 0.5, 6.3, 0.4, 0.2, 0.02, 'kit:glow', { solid: false, uv: 'solid' }); pcs.Ap.push(p); pcs.A.push(p); });   // 同名合并
    });
    const F = b.fixture({ kind: 'vend', label: '售货机', plugged: true }, () => {
      pcs.F = [b.box(10, 0, 10, 0.9, 1.8, 0.8, 'kit:prop', {})];
      b.part({ type: 'button', name: 'btn' }, () => { pcs.F.push(b.box(10.2, 1, 10.41, 0.05, 0.05, 0.01, 'kit:glow', { solid: false, uv: 'solid' })); });
    });
    const C = b.prop({ kind: 'chair', label: '椅子', pivot: [15, 15, 1.0], seats: [{ x: 0, z: 0, yaw: Math.PI, h: 0.5, swivel: true }] }, () => {
      b.push(15, 15, 1.0); pcs.C = [b.box(0, 0, 0, 0.5, 1, 0.5, 'kit:prop', {})]; b.pop();
    });
    kit.exit(b, { to: '1', kind: 'zone', x: 16.1, z: 15, radius: 0.5 });   // 出口圈 +0.4 压到椅子的碰撞体
    const E = b.prop({ kind: 'hatch' }, () => { kit.exit(b, { to: '2', kind: 'zone', x: 20, z: 3 }); pcs.E = [b.box(20, 0, 3, 0.5, 0.1, 0.5, 'kit:prop', { solid: false })]; });
    const B2 = b.prop({ kind: 'load', on: A.key + '#s1' }, () => { pcs.B2 = [b.box(7, 2.05, 6, 0.4, 0.3, 0.4, 'kit:prop', {})]; });
    const orphan = b.part({ type: 'button', name: 'x' }, () => { pcs.orphan = [b.box(22, 0, 22, 0.1, 0.1, 0.1, 'kit:prop', { solid: false })]; });
    const res = b.finish();
    const K = res.kit;
    const A1 = K.props.find(r => r.kind === 'crateOnRack');
    const cont = K.containers[0];
    const inSpans = (rec, pc) => {
      const mat = pc.mesh.name;
      return rec.spans.some(s => s.mat === mat && pc.start >= s.v0 && pc.start + pc.count <= s.v1);
    };
    const out = {};
    out.keys = { A: A.key, A1: A1 && A1.key, F: F.key, C: C.key, E: E.key, B2: B2.key, cont: cont && cont.key, part: A.parts.map(p => p.key), skeyA: A.skey, orphan };
    out.counts = { props: K.props.length, fixtures: K.fixtures.length, containers: K.containers.length, Aparts: A.parts.length, Fparts: F.parts.length };
    out.tree = { Achildren: A.children, A1on: A1.on, B2on: B2.on, contParent: cont.parentKey, contParts: cont.parts, partContainer: A.parts[0].container };
    out.cover = {
      A: pcs.A.every(p => inSpans(A, p)), Anot1: pcs.A1.every(p => !inSpans(A, p)), A1: pcs.A1.every(p => inSpans(A1, p)),
      cont: pcs.A1c.every(p => inSpans(cont, p)), part: pcs.Ap.every(p => inSpans(A.parts[0], p)),
      F: pcs.F.every(p => inSpans(F, p)), C: pcs.C.every(p => inSpans(C, p)), B2: pcs.B2.every(p => inSpans(B2, p)),
      spanAlias: cont.span === cont.spans && !Object.keys(cont).includes('span'),
    };
    // 每条记录自己的段互不重叠（道具/设备之间独占顶点）
    const segs = [];
    for (const r of K.props.concat(K.fixtures)) for (const s of r.spans) segs.push([s.mat, s.v0, s.v1, r.key]);
    let overlap = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i][0] === segs[j][0] && segs[i][1] < segs[j][2] && segs[j][1] < segs[i][2]) overlap++;
    out.segOverlap = overlap;
    const sp = kit.splitSolids(res);
    out.split = { statics: sp.statics.length, owners: sp.owners.map(o => [o.key, o.solids.length]), total: res.solids.length };
    out.drag = { A: A.draggable, A1: A1.draggable, C: [C.draggable, C.exitOverlap], E: E.draggable, B2: B2.draggable, Fwhy: F.why, Fplug: F.plugged };
    out.volume = A.volume;
    out.obbA = A.obb;
    out.seat = C.seats[0];
    out.seatWorld = kit.toWorld(C, C.seats[0]);
    out.pivotC = C.pivot;
    out.part = A.parts[0];
    out.json = JSON.stringify(K.props).length > 0;
    // ---------- moveProp / settleProp ----------
    const meshes = {};
    for (const m of res.group.children) meshes[m.name] = m;
    const P = meshes['kit:prop'].geometry.attributes.position, G = meshes['kit:glow'].geometry.attributes.position;
    const snapP = Float32Array.from(P.array), snapG = Float32Array.from(G.array);
    const deltaOf = (pc, snap) => {
      const a = pc.mesh.geometry.attributes.position.array;
      let dx = 0, dy = 0, dz = 0, n = 0, spread = 0;
      for (let i = pc.start; i < pc.start + pc.count; i++) {
        const ex = a[i * 3] - snap[i * 3], ey = a[i * 3 + 1] - snap[i * 3 + 1], ez = a[i * 3 + 2] - snap[i * 3 + 2];
        if (n) spread = Math.max(spread, Math.abs(ex - dx / n), Math.abs(ey - dy / n), Math.abs(ez - dz / n));
        dx += ex; dy += ey; dz += ez; n++;
      }
      return [+(dx / n).toFixed(4), +(dy / n).toFixed(4), +(dz / n).toFixed(4), +spread.toFixed(5)];
    };
    const snapOf = pc => (pc.mesh.name === 'kit:glow' ? snapG : snapP);
    const hiddenPc = pcs.A[2];
    hiddenPc.setVisible(false);                                      // 藏起来的件：基准要从 _saved 取
    const solidsBefore = JSON.stringify(res.solids);
    out.moveOk = kit.moveProp(res, A, { dx: 1, dz: -2 });
    out.mv1 = {
      A: pcs.A.filter(p => p !== hiddenPc).map(p => deltaOf(p, snapOf(p))), A1: pcs.A1.map(p => deltaOf(p, snapP)), B2: pcs.B2.map(p => deltaOf(p, snapP)),
      F: pcs.F.map(p => deltaOf(p, snapOf(p))), C: pcs.C.map(p => deltaOf(p, snapP)),
      culled: [meshes['kit:prop'].frustumCulled, meshes['kit:glow'].frustumCulled],
    };
    hiddenPc.setVisible(true);
    out.hiddenAfterShow = deltaOf(hiddenPc, snapP);
    kit.moveProp(res, A1, { dx: 0.5, dz: 0 });
    out.mv2 = { A: deltaOf(pcs.A[0], snapP), A1: deltaOf(pcs.A1[0], snapP), B2: deltaOf(pcs.B2[0], snapP) };
    pcs.A[0].setVisible(false);
    kit.moveProp(res, A, 0, 0);                                      // 旧写法 (res, rec, dx, dz)
    pcs.A[0].setVisible(true);
    out.mv3 = { A: deltaOf(pcs.A[0], snapP), A1: deltaOf(pcs.A1[0], snapP), B2: deltaOf(pcs.B2[0], snapP) };
    kit.moveProp(res, A, { dx: 3, dz: 1 });
    out.solidsSame = JSON.stringify(res.solids) === solidsBefore;
    out.propSolids = kit.propSolids(res, A).map(s => [s.minX, s.minZ, s.maxX, s.maxZ].map(v => +v.toFixed(4)));
    out.propSolidsT = kit.propSolids(res, A, { dx: 0, dz: 0 }).map(s => [s.minX, s.minZ].map(v => +v.toFixed(4)));
    out.rackSolid = [res.solids[A.solids[0]].minX, res.solids[A.solids[0]].minZ].map(v => +v.toFixed(4));
    out.childWorld = kit.toWorld(K.containers[0], K.containers[0].slots[0]);
    out.childPivot = K.containers[0].pivot;
    kit.settleProp(A);
    kit.settleProp(A1);
    const sph = meshes['kit:prop'].geometry.boundingSphere;
    let outside = 0;
    for (let i = 0; i < P.count; i++) {
      const d = Math.hypot(P.array[i * 3] - sph.center.x, P.array[i * 3 + 1] - sph.center.y, P.array[i * 3 + 2] - sph.center.z);
      if (d > sph.radius + 1e-4) outside++;
    }
    out.settle = { culled: [meshes['kit:prop'].frustumCulled, meshes['kit:glow'].frustumCulled], outside };
    out.dyWarn = true;
    res.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    return out;
  });
  const k = syn.keys;
  check('登记 key：顶层道具 #p、嵌套 #p1.1、设备 #f、容器 #c、部件 #k；碰撞 key 去掉层级前缀',
    k.A === 'dev@3,4#p1' && k.A1 === 'dev@3,4#p1.1' && k.F === 'dev@3,4#f1' && k.C === 'dev@3,4#p2' && k.E === 'dev@3,4#p3' && k.B2 === 'dev@3,4#p4' &&
    k.cont === 'dev@3,4#c1' && k.part.join() === 'dev@3,4#p1#k1' && k.skeyA === '3,4#p1' && k.orphan === null, k);
  check('登记条数：道具 5、设备 1、容器 1；同名 part 合并成 1 条；没有所属道具的 part 不登记', syn.counts.props === 5 && syn.counts.fixtures === 1 && syn.counts.containers === 1 && syn.counts.Aparts === 1 && syn.counts.Fparts === 1, syn.counts);
  check('父子链：嵌套道具 on = 父 key；显式 on = "父 key#格号" 也挂成子道具；容器 parentKey 是最内层道具；部件记所在容器',
    JSON.stringify(syn.tree.Achildren) === JSON.stringify([k.A1, k.B2]) && syn.tree.A1on === k.A && syn.tree.B2on === k.A + '#s1' &&
    syn.tree.contParent === k.A1 && syn.tree.contParts.length === 0 && syn.tree.partContainer === null, syn.tree);
  check('spans：作用域里画的每个 Piece 都落在本记录的段里；嵌套道具的件不算外层的；容器、部件（含合并的第二段）、span 别名不进 JSON', Object.values(syn.cover).every(Boolean), syn.cover);
  check('道具/设备之间的顶点段互不重叠', syn.segOverlap === 0, { overlap: syn.segOverlap });
  check('splitSolids：墙留在静态；每件道具/设备一个碰撞 key（嵌套子道具单独一个）',
    syn.split.statics === 1 && JSON.stringify(syn.split.owners) === JSON.stringify([['3,4#p1', 1], ['3,4#p1.1', 1], ['3,4#p2', 1], ['3,4#p4', 1], ['3,4#f1', 1]]), syn.split);
  check('能不能拖：普通道具能；meta.draggable=false 不能；压着出口圈（+0.4）不能且 exitOverlap；作用域里有出口不能；插着电的设备给原因',
    syn.drag.A === true && syn.drag.A1 === false && syn.drag.C[0] === false && syn.drag.C[1] === true && syn.drag.E === false && syn.drag.B2 === true &&
    syn.drag.Fwhy === '插着电，拖不动' && syn.drag.Fplug === true, syn.drag);
  check('体积 = 自己 + 子道具的碰撞体体积之和（1.44 + 0.125 + 0.048）', Math.abs(syn.volume - 1.613) < 1e-3, { volume: syn.volume });
  const o = syn.obbA;
  // 货架枢轴转了 0.5 rad，轴对齐的 1.2×0.6 盒子在本地坐标系里是斜的：本地 x 宽 = 1.2·cos0.5 + 0.6·sin0.5 ≈ 1.3408；y 0..2.05（顶上的发光条）
  check('OBB 在枢轴坐标系里（只算自己的顶点段）', !!o && Math.abs(o.max[0] - o.min[0] - (1.2 * Math.cos(0.5) + 0.6 * Math.sin(0.5))) < 2e-3 && Math.abs(o.min[1]) < 1e-4 && Math.abs(o.max[1] - 2.05) < 1e-3, o);
  const sw = syn.seatWorld, pc = syn.pivotC;
  check('座位锚点存在枢轴坐标系，toWorld 换回世界：位置 = 枢轴、yaw = 枢轴 rot + π',
    syn.seat.swivel === true && syn.seat.h === 0.5 && Math.abs(sw.x - pc.x) < 1e-6 && Math.abs(sw.z - pc.z) < 1e-6 && Math.abs(sw.yaw - (1 + Math.PI)) < 1e-5, { seat: syn.seat, world: sw, pivot: pc });
  check('部件：枢轴、轴向换到所属道具的枢轴坐标系，带 locked 等附加字段', syn.part.type === 'slide' && syn.part.locked === true && syn.part.axis.length === 3 && Math.abs(Math.hypot(...syn.part.axis) - 1) < 1e-5, syn.part);
  const same = (a, b) => a.length === 4 && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4 && a[3] < 1e-4;
  const m1 = syn.mv1;
  check('moveProp {dx:1,dz:-2}：道具自己、嵌套子道具、显式 on 的子道具整体平移，别的不动；拖动中关视锥裁剪',
    syn.moveOk && m1.A.every(d => same(d, [1, 0, -2])) && m1.A1.every(d => same(d, [1, 0, -2])) && m1.B2.every(d => same(d, [1, 0, -2])) &&
    m1.F.every(d => same(d, [0, 0, 0])) && m1.C.every(d => same(d, [0, 0, 0])) && m1.culled[0] === false && m1.culled[1] === false, m1);
  check('moveProp：挪之前藏起来的件，显示出来在挪过的位置', same(syn.hiddenAfterShow, [1, 0, -2]), syn.hiddenAfterShow);
  check('moveProp 是绝对量、子道具叠加父道具：子道具再挪 0.5 → 子在 (1.5,-2)，父不变', same(syn.mv2.A, [1, 0, -2]) && same(syn.mv2.A1, [1.5, 0, -2]) && same(syn.mv2.B2, [1, 0, -2]), syn.mv2);
  check('moveProp 旧写法 (res, rec, 0, 0) 归位；挪的时候藏着的件显示后也归位；子道具保留自己的 0.5', same(syn.mv3.A, [0, 0, 0]) && same(syn.mv3.A1, [0.5, 0, 0]) && same(syn.mv3.B2, [0, 0, 0]), syn.mv3);
  check('propSolids：按当前位移（或给定 t）平移副本，不改 res.solids',
    syn.solidsSame && Math.abs(syn.propSolids[0][0] - (syn.rackSolid[0] + 3)) < 1e-4 && Math.abs(syn.propSolids[0][1] - (syn.rackSolid[1] + 1)) < 1e-4 &&
    Math.abs(syn.propSolidsT[0][0] - syn.rackSolid[0]) < 1e-4, { ps: syn.propSolids, t0: syn.propSolidsT, raw: syn.rackSolid });
  check('toWorld：容器格位跟着父链位移（父 +3,+1，子 +0.5）', Math.abs(syn.childWorld.x - (syn.childPivot.x + 3.5)) < 1e-4 && Math.abs(syn.childWorld.z - (syn.childPivot.z + 1)) < 1e-4, { w: syn.childWorld, p: syn.childPivot });
  check('settleProp：恢复视锥裁剪，包围球包住挪过的全部顶点', syn.settle.culled[0] === true && syn.settle.culled[1] === true && syn.settle.outside === 0, syn.settle);

  // ---------- 7b. kit 构件：登记内容、高低画质一致、结构件不登记、晚画的磨损贴花记进道具 ----------
  const comps = await ev(page, () => {
    const kit = BR.kit, lv = BR.levels.get('dev'), U = BR.util, P = kit.prop;
    const build = q => {
      BR.game.settings.quality = q;
      const b = kit.builder({ level: lv, levelSeed: 11 }, -1, 0, U.rng(11, -1, 0));
      const out = {};
      // 家具（每样多摆几件：磨损贴花按位置哈希抽，件多才能抽到）
      for (let i = 0; i < 4; i++) {
        P.box(b, 1 + i, 2, 0.2 * i, { stack: 1 + (i % 3) });
        P.crate(b, 1 + i, 4, 0.3 * i, {});
        P.chair(b, 1 + i, 6, i, {});
        P.cabinet(b, 6 + i, 2, 0, { kind: ['file', 'wardrobe', 'locker', 'file'][i] });
      }
      P.desk(b, 8, 6, 0, {});
      P.desk(b, 8, 8, 0, { monitor: true });
      P.cubicle(b, 12, 6, 0, {});
      P.vending(b, 16, 4, 0, {});
      P.bed(b, 20, 4, 0, {});
      const r = b.finish();
      const K = r.kit;
      out.props = K.props.map(p => [p.key, p.kind, p.label, p.draggable, p.parts.map(q => q.type + ':' + q.name + (q.locked ? ':L' : '')).join(','), p.seats.length, p.beds.length, p.pivot.x, p.pivot.z, p.pivot.rot]);
      out.fixtures = K.fixtures.map(p => [p.key, p.kind, p.label, p.plugged, p.why, p.parts.map(q => q.type + ':' + q.name).join(',')]);
      out.containers = K.containers.map(c => [c.key, c.kind, c.parentKey, c.on, c.loot, c.slots.length, c.parts.length]);
      out.partText = K.props.concat(K.fixtures).filter(p => p.kind === 'desk').map(p => p.parts.map(q => q.label + '/' + (q.why || '')).join(','));
      // 晚画的磨损贴花（finish 时才画）全部记进了某件道具/设备
      const dm = r.group.children.find(m => m.name === 'kit:decal');
      const decalVerts = dm ? dm.geometry.attributes.position.count : 0;
      let decalSpan = 0;
      for (const p of K.props.concat(K.fixtures)) for (const s of p.spans) if (s.mat === 'kit:decal') decalSpan += s.v1 - s.v0;
      out.decal = { verts: decalVerts, inSpans: decalSpan };
      // 段不越界
      const cnt = {};
      for (const m of r.group.children) cnt[m.name] = m.geometry.attributes.position.count;
      let bad = 0;
      for (const p of K.props.concat(K.fixtures, K.containers)) for (const s of p.spans) if (!(s.v0 < s.v1 && s.v1 <= (cnt[s.mat] || 0))) bad++;
      out.badSpans = bad;
      r.group.traverse(o2 => { if (o2.geometry) o2.geometry.dispose(); });
      return out;
    };
    const q0 = BR.game.settings.quality;
    const hi = build('high'), low = build('low');
    // 结构件、出口：一条都不登记
    const b = kit.builder({ level: lv, levelSeed: 3 }, 2, 2, U.rng(3, 2, 2));
    P.lightPanel(b, 2, 2, 0, {}); P.ceiling(b, null, null, 0, {}); P.floor(b, null, null, 0, {}); P.baseboard(b, 3, 1, 0, { length: 2 });
    P.door(b, 5, 1, 0, { style: 'metal' }); P.stairwell(b, 8, 4, 0, {}); P.elevator(b, 12, 1, 0, {}); P.vent(b, 14, 1, 0, {});
    P.pipe(b, 16, 2, 0, { axis: 'x' }); P.puddle(b, 18, 3, 0, {}); P.window(b, 20, 1, 0, {}); P.sign(b, 2, 10, 0, {}); P.hole(b, 6, 10, 0, {});
    P.pillar(b, 10, 10, 0, {}); P.fence(b, 14, 10, 0, {}); P.streetlight(b, 18, 10, 0, {}); P.wallWithOpening(b, 2, 16, 0, {});
    P.cubicle(b, 8, 16, 0, { desk: false, chair: false });
    kit.exit(b, { to: '1', kind: 'door', x: 14, z: 16 }); kit.exit(b, { to: '2', kind: 'stairs', x: 18, z: 18 });
    kit.exit(b, { to: '3', kind: 'elevator', x: 22, z: 16 }); kit.exit(b, { to: '4', kind: 'hole', x: 4, z: 21 });
    const rs = b.finish();
    const structural = { props: rs.kit.props.length, fixtures: rs.kit.fixtures.length, containers: rs.kit.containers.length };
    rs.group.traverse(o2 => { if (o2.geometry) o2.geometry.dispose(); });
    BR.game.settings.quality = q0;
    return { hi, low, structural };
  });
  const H = comps.hi, L = comps.low;
  const kinds = H.props.map(p => p[1]).join(',');
  check('kit 构件登记：纸箱/木箱/椅子/柜子/办公桌/床是道具，带显示器的桌和售货机是插电设备，隔间隔板不登记',
    kinds === 'box,crate,chair,cabinet,box,crate,chair,cabinet,box,crate,chair,cabinet,box,crate,chair,cabinet,desk,chair,bed' &&
    H.fixtures.map(f => f[1]).join(',') === 'desk,desk,vending' && H.fixtures.every(f => f[3] === true) &&
    H.fixtures[2][4] === '插着电，三百多公斤，拖不动', { kinds, fixtures: H.fixtures });
  const byKind = k2 => H.props.filter(p => p[1] === k2);
  check('kit 构件部件：桌 3 个锁着的抽屉、文件柜 4 抽屉、衣柜两扇门、储物柜一扇门、椅子 swivel 座面和一个座位、床一个躺位、电脑桌显示器、售货机选货键+翻板',
    byKind('desk').every(p => p[4] === 'slide:drawer0:L,slide:drawer1:L,slide:drawer2:L') &&
    byKind('cabinet').map(p => p[4]).join('|') === 'slide:drawer0,slide:drawer1,slide:drawer2,slide:drawer3|hinge:doorL,hinge:doorR|hinge:door|slide:drawer0,slide:drawer1,slide:drawer2,slide:drawer3' &&
    byKind('chair').every(p => p[4] === 'swivel:seat' && p[5] === 1) && byKind('bed').every(p => p[6] === 1) &&
    H.fixtures[0][5] === 'slide:drawer0,slide:drawer1,slide:drawer2,button:monitor' && H.fixtures[2][5] === 'button:select,hinge:flap',
    { desk: byKind('desk').map(p => p[4]), cab: byKind('cabinet').map(p => p[4]), fx: H.fixtures.map(f => f[5]) });
  check('部件带中文名和原因（桌子抽屉「抽屉 / 锁着」、显示器）', H.partText.length === 3 && H.partText.every(t => t.startsWith('抽屉/锁着,抽屉/锁着,抽屉/锁着')) && H.partText.some(t => t.endsWith('显示器/')), H.partText);
  const ck = H.containers.map(c => c[1]).join(',');
  check('kit 构件容器：每只纸箱一个 carton（摞起来的 on = 下面那只）、木箱 crate、柜子 fileCab/wardrobe/locker（loot one）',
    ck === 'carton,crate,fileCab,carton,carton,crate,wardrobe,carton,carton,carton,crate,locker,carton,crate,fileCab' &&
    H.containers[4][3] === H.containers[3][0] && H.containers.filter(c => c[1] === 'fileCab').every(c => c[4] === 'one' && c[5] === 4), { ck, sample: H.containers.slice(3, 5) });
  check('kit 构件：高低画质登记内容逐项一致（key、kind、能不能拖、部件、座位、枢轴、容器）',
    JSON.stringify(H.props) === JSON.stringify(L.props) && JSON.stringify(H.fixtures) === JSON.stringify(L.fixtures) && JSON.stringify(H.containers) === JSON.stringify(L.containers),
    { hiProps: H.props.length, lowProps: L.props.length });
  check('晚画的磨损贴花全部记进所属道具/设备（高画质有贴花，低画质没有）', H.decal.verts > 0 && H.decal.verts === H.decal.inSpans && L.decal.verts === 0 && L.decal.inSpans === 0, { hi: H.decal, low: L.decal });
  check('spans 都在对应网格的顶点范围内', H.badSpans === 0 && L.badSpans === 0, { hi: H.badSpans, low: L.badSpans });
  check('墙、柱子、门、楼梯、电梯、窗、路灯、栅栏、隔板、出口这类结构件不登记', comps.structural.props === 0 && comps.structural.fixtures === 0 && comps.structural.containers === 0, comps.structural);
  await ctx.close();
}

// =====================================================================
// 8. 26 层出生点 3×3 块：高低画质的道具登记逐项一致（联机两边画质可以不同，只靠 key 对上）
// =====================================================================
function pageEnterLv({ id, seed, quality }) {
  const lv = BR.levels.get(id);
  if (!lv) return { ok: false, error: '没有注册层级 ' + id };
  const G = window.__kitLv || (window.__kitLv = {});
  G.ctx = null;
  G.orig = lv.buildChunk;
  lv.buildChunk = function (c) { if (!G.ctx) G.ctx = c; return G.orig.apply(this, arguments); };
  __br.setAuto(false);
  __br.start({ mode: 'test', levelId: id, seed, settings: { quality, visibility: 1 } });
  return { ok: true };
}
function pageLvRecords({ id, quality }) {
  const G = window.__kitLv, lv = BR.levels.get(id), U = BR.util;
  if (G.orig) { lv.buildChunk = G.orig; G.orig = null; }
  if (BR.game.levelId !== id || !BR.world.current) return { ok: false, error: '没能进入层级 ' + id };
  if (BR.game.settings.quality !== quality) return { ok: false, error: '画质不对 ' + BR.game.settings.quality };
  const levelSeed = BR.world.levelSeed, S = BR.world.chunkSize;
  const ctx = G.ctx || { THREE, BR, level: BR.world.current, levelSeed, assets: BR.assets, game: BR.game, scene: BR.gfx && BR.gfx.scene };
  const sp = typeof lv.spawn === 'function' ? lv.spawn(ctx) : null;
  const px = sp && Number.isFinite(sp.x) ? sp.x : BR.player.x, pz = sp && Number.isFinite(sp.z) ? sp.z : BR.player.z;
  const ccx = Math.floor(px / S), ccz = Math.floor(pz / S);
  const STRUCT = new Set(['wall', 'pillar', 'door', 'stairwell', 'elevator', 'window', 'streetlight', 'fence', 'lightPanel', 'ceiling', 'floor', 'baseboard', 'vent', 'pipe', 'puddle', 'sign', 'hole', 'cubicle', 'exit']);
  const out = { ok: true, chunk: [ccx, ccz], props: [], fixtures: [], containers: [], parts: [], issues: [], n: { props: 0, drag: 0, fixtures: 0, containers: 0, parts: 0, seats: 0, beds: 0 } };
  const r4 = v => Math.round(v * 1e4) / 1e4;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ccx + dx, cz = ccz + dz;
    let res = null;
    try { res = lv.buildChunk(ctx, cx, cz, U.rng(levelSeed, cx, cz)); } catch (err) { out.issues.push(cx + ',' + cz + ' 生成异常 ' + String(err && err.message || err)); continue; }
    const K = (res && res.kit) || {};
    const cnt = {};
    if (res && res.group) res.group.traverse(m => { if (m.geometry && m.geometry.attributes.position) cnt[m.name] = (cnt[m.name] || 0) + m.geometry.attributes.position.count; });
    const own = [];
    for (const r of K.props || []) {
      out.props.push([r.key, r.kind, r.draggable, r.exitOverlap, r.children.length, r.seats.length, r.beds.length, r4(r.pivot.x), r4(r.pivot.z), r4(r.pivot.rot)]);
      out.n.props++; if (r.draggable) out.n.drag++;
      out.n.seats += r.seats.length; out.n.beds += r.beds.length;
      if (STRUCT.has(r.kind)) out.issues.push('结构件被登记成道具 ' + r.key + ' ' + r.kind);
      if (r.exitOverlap && r.draggable) out.issues.push('压着出口圈却能拖 ' + r.key);
      for (const p of r.parts) { out.parts.push([r.key, p.key, p.type, p.name]); out.n.parts++; }
      for (const s of r.spans) own.push([s.mat, s.v0, s.v1, r.key]);
    }
    for (const r of K.fixtures || []) {
      out.fixtures.push([r.key, r.kind, r.plugged, r.inert, r.why]); out.n.fixtures++;
      for (const p of r.parts) { out.parts.push([r.key, p.key, p.type, p.name]); out.n.parts++; }
      for (const s of r.spans) own.push([s.mat, s.v0, s.v1, r.key]);
    }
    for (const c of K.containers || []) { out.containers.push([c.key, c.kind, c.parentKey, c.on, c.slots.length]); out.n.containers++; }
    for (const s of own) if (!(s[1] < s[2] && s[2] <= (cnt[s[0]] || 0))) out.issues.push('span 越界 ' + s.join(' '));
    own.sort((a, b2) => (a[0] < b2[0] ? -1 : a[0] > b2[0] ? 1 : a[1] - b2[1]));
    for (let i = 1; i < own.length; i++) if (own[i][0] === own[i - 1][0] && own[i][1] < own[i - 1][2]) out.issues.push('两件道具的顶点段重叠 ' + own[i - 1][3] + ' / ' + own[i][3]);
    if (res && res.group) res.group.traverse(m => { if (m.geometry && !(m.geometry.userData && m.geometry.userData.shared)) m.geometry.dispose(); });
    if (res && typeof res.dispose === 'function') { try { res.dispose(); } catch (e) { /* 不影响数据 */ } }
  }
  return out;
}
async function levelRegistry(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  watch(page, 'levels');
  await boot(page, base);
  const order = await ev(page, () => (BR.LEVEL_ORDER || []).map(String));
  const levels = LEVELS_ARG ? LEVELS_ARG.split(',').map(s => s.trim()).filter(Boolean) : order;
  const summary = [];
  for (const id of levels) {
    const per = {};
    for (const quality of ['high', 'low']) {
      if (await ev(page, () => BR.game.screen !== 'home')) {
        await ev(page, () => BR.bus.emit('game:home'));
        await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 15000 });
      }
      const en = await ev(page, pageEnterLv, { id, seed: SEED, quality });
      if (!en.ok) { per[quality] = { ok: false, error: en.error }; break; }
      try {
        await page.waitForFunction(lid => BR.game.screen === 'playing' && BR.game.levelId === lid && BR.world && BR.world.current, id, { timeout: 60000 });
      } catch (err) { per[quality] = { ok: false, error: String(err.message || err) }; break; }
      per[quality] = await ev(page, pageLvRecords, { id, quality });
    }
    const h = per.high, l = per.low;
    if (!h || !h.ok || !l || !l.ok) { check('L' + id + '：进层并生成出生点 3×3 块', false, { high: h && h.error, low: l && l.error }); continue; }
    const same = k2 => JSON.stringify(h[k2]) === JSON.stringify(l[k2]);
    const firstDiff = k2 => { const a = h[k2], b2 = l[k2]; for (let i = 0; i < Math.max(a.length, b2.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b2[i])) return { i, high: a[i], low: b2[i] }; return null; };
    const ok = same('props') && same('fixtures') && same('containers') && same('parts');
    check('L' + id + '：出生点 3×3 块高低画质的道具/设备/容器/部件 [key, kind, …] 逐项一致', ok,
      ok ? h.n : { props: firstDiff('props'), fixtures: firstDiff('fixtures'), containers: firstDiff('containers'), parts: firstDiff('parts') });
    const issues = h.issues.concat(l.issues);
    check('L' + id + '：登记自检（结构件不登记、压出口不能拖、span 不越界不重叠、生成无异常）', issues.length === 0, issues.slice(0, 5));
    summary.push([id, h.chunk.join(','), h.n.props, h.n.drag, h.n.fixtures, h.n.containers, h.n.parts, h.n.seats, h.n.beds]);
  }
  if (await ev(page, () => BR.game.screen !== 'home')) await ev(page, () => BR.bus.emit('game:home'));
  console.log('     层  出生块  道具 能拖 设备 容器 部件 座位 躺位');
  for (const s of summary) console.log('     ' + s.map(v => String(v).padStart(4)).join(' '));
  await ctx.close();
}

main();
