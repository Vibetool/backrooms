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
    await pureKit(browser, base);
    await fallbackTexture(browser, base);
    await inWorld(browser, base);
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
    return out;
  });
  check('Level Dev：出生点周围 5×5 区块全部由 kit 建成', st.chunks === 25, { chunks: st.chunks });
  check('Level Dev：每块 mesh ≤ 8（按材质合并）', st.maxMeshes <= 8, { maxMeshes: st.maxMeshes, at: st.maxMeshesKey, names: st.names });
  check('Level Dev：每块三角形 ≤ 8000', st.maxTris <= 8000, { maxTris: st.maxTris, avg: Math.round(st.sumTris / Math.max(1, st.chunks)) });
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

  // 范围内但层级文件还没注册（第二波开发期间常见）：同样只提示
  const unreg = await ev(page, s => {
    const c = BR.world.chunkAt(s.x, s.z);
    const e = { x: s.x + 2.2, y: 0, z: s.z - 2.2, radius: 0.8, to: '7', kind: 'door', label: '前往 Level 7', sealed: false, active: true };
    c.exits.push(e);
    const n0 = __kitSpy.toast.length;
    BR.player.x = e.x; BR.player.z = e.z; __br.step(0.1);
    const el = document.querySelector('.hud-prompt');
    const r = { toasts: __kitSpy.toast.slice(n0), prompt: el && !el.hidden ? el.textContent : null, level: BR.game.levelId, tr: BR.world.transitioning };
    c.exits.splice(c.exits.indexOf(e), 1);
    BR.player.x = s.x; BR.player.z = s.z; __br.step(0.1);
    return r;
  }, S0);
  check('范围内未注册（Level 7）：提示 "Level 7 尚未开放"、不换层', unreg.toasts.length === 1 && unreg.toasts[0] === 'Level 7 尚未开放' && unreg.level === 'dev' && !unreg.tr, unreg);

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

main();
