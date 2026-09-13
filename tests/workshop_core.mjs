// 后室 · 创意工坊核心自测：node tests/workshop_core.mjs
// js/game/workshop.js 还没进 index.html（只有验收代理能改 index.html），用 page.addScriptTag 注入。
// 覆盖 WORKSHOP.md 第 10 节里归"工坊核心"的验收点：
//   1. 不激活时行为逐字节不变（同种子 BR.phys.stats 对比，见任务里的替代方案）
//   2. 删/加内部墙、区块交界线两侧一致（直接摆两个相邻 builder，对 grid 位图逐位核对）
//   3. 出口 removed/moved/added 生效（BR.kit.exit + BR.workshop.decorate 单元级调用）
//   4. 放置实体：远处不刷、走近才刷；autoEntities=false 时没有自动实体
//   5. 编辑态：不刷物品、载入 map.radius 圈全部区块
//   6. spawnOverride / densityMul 的边界情况（almond_water 恒 ≥1、编辑态实体密度恒 0）
// 任一检查失败或页面报错时退出码为 1。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
}
function watch(page) {
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text() + ' @ ' + (m.location().url || '')); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function boot(page, base) {
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.kit, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
  // js/game/workshop.js 还不在 index.html 的加载列表里，测试里手动注入（任务约定的做法）
  await page.addScriptTag({ url: base + 'js/game/workshop.js' });
  await page.waitForFunction(() => window.BR && BR.workshop, null, { timeout: 10000 });
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
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    watch(page);
    await boot(page, base);
    await run(page);
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
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

async function run(page, seed) {
  seed = seed || SEED;

  // ---------- 1. 不激活/激活空地图：Level 0 出生点区块的碰撞体统计逐字节一致 ----------
  const regression = await ev(page, (seed) => {
    BR.bus.emit('game:home');
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null });
    const statsA = BR.phys.stats();
    BR.bus.emit('game:home');

    const mapEmpty = BR.workshop.create('0', 'empty');
    mapEmpty.seed = seed;
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: mapEmpty });
    const statsB = BR.phys.stats();
    const activeIsMap = BR.workshop.active === mapEmpty;
    BR.bus.emit('game:home');
    const deactivatedOK = BR.workshop.active === null;
    return { statsA, statsB, equal: JSON.stringify(statsA) === JSON.stringify(statsB), activeIsMap, deactivatedOK };
  }, seed);
  check('未激活 vs 激活空地图：BR.phys.stats 逐字节一致', regression.equal, regression);
  check('game:start 的 workshop 字段（对象）→ BR.workshop.active 生效', regression.activeIsMap);
  check('game:home → BR.workshop.deactivate()', regression.deactivatedOK);

  // ---------- 2. 墙：删/加内部边、区块交界线两侧一致 ----------
  const walls = await ev(page, (seed) => {
    const kit = BR.kit, lv = BR.levels.get('0'), N = 8;
    function make(cx, cz) {
      const b = kit.builder({ level: lv, levelSeed: seed }, cx, cz, BR.util.rng(seed, cx, cz));
      const g = kit.grid(b, N, N, { wallDensity: 0.4, straightness: 0.7, roomChance: 0.3, loopChance: 0.5 });
      kit.gridWalls(b, g, {});
      return { b, g };
    }
    function edgeKey(e) { return e.axis + '@' + e.x.toFixed(2) + ',' + e.z.toFixed(2); }
    function bitOf(g, e) { return e.axis === 'v' ? g.v[e.i * g.rows + e.j] : g.h[e.j * g.cols + e.i]; }
    // 连续的墙段会合并成一个盒子：判断"这条边有没有墙"不能比总数，得看这条边中点有没有被某个碰撞体盒子罩住
    function covered(solids, x, z, y) {
      y = y == null ? 0.9 : y;
      return solids.some(s => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && y >= s.minY && y <= s.maxY);
    }

    BR.workshop.deactivate();
    const base = make(0, 0);
    const wallEdge = base.g.edges({ interior: true, wall: true })[0];
    const openEdge = base.g.edges({ interior: true, wall: false })[0];
    const coveredBeforeDel = covered(base.b._solids, wallEdge.x, wallEdge.z);
    const coveredBeforeAdd = covered(base.b._solids, openEdge.x, openEdge.z);

    // 删一条已存在的内部墙：模型和碰撞体都没了
    const m1 = BR.workshop.create('0', 't1'); m1.seed = seed;
    m1.walls = [{ k: edgeKey(wallEdge), on: false }];
    BR.workshop.activate(m1, { editing: true });
    const r1 = make(0, 0);
    const deleteOK = bitOf(r1.g, wallEdge) === 0 && r1.g._wsEdited === true
      && coveredBeforeDel === true && covered(r1.b._solids, wallEdge.x, wallEdge.z) === false;
    BR.workshop.deactivate();

    // 给一条开口加墙：碰撞体生效
    const m2 = BR.workshop.create('0', 't2'); m2.seed = seed;
    m2.walls = [{ k: edgeKey(openEdge), on: true }];
    BR.workshop.activate(m2, { editing: true });
    const r2 = make(0, 0);
    const addOK = bitOf(r2.g, openEdge) === 1
      && coveredBeforeAdd === false && covered(r2.b._solids, openEdge.x, openEdge.z) === true;
    BR.workshop.deactivate();

    // 区块交界线：chunk(0,0) 东边界 == chunk(1,0) 西边界
    const m3 = BR.workshop.create('0', 't3'); m3.seed = seed;
    BR.workshop.activate(m3, { editing: true });
    const p0 = make(0, 0), p1 = make(1, 0);
    let bj = 0;
    for (let j = 0; j < N; j++) if (p0.g.isWall('v', N, j)) { bj = j; break; }
    const naturalSame = p0.g.isWall('v', N, bj) === p1.g.isWall('v', 0, bj);
    const bx = p0.b.ox + N * p0.g.cellW, bz = p0.b.oz + (bj + 0.5) * p0.g.cellD;
    const boundaryKey = 'v@' + bx.toFixed(2) + ',' + bz.toFixed(2);
    const want = !p0.g.isWall('v', N, bj);
    BR.workshop.deactivate();

    const m4 = BR.workshop.create('0', 't4'); m4.seed = seed;
    m4.walls = [{ k: boundaryKey, on: want }];
    BR.workshop.activate(m4, { editing: true });
    const e0 = make(0, 0), e1 = make(1, 0);
    const boundaryOK = e0.g.isWall('v', N, bj) === want && e1.g.isWall('v', 0, bj) === want;
    BR.workshop.deactivate();

    return { deleteOK, addOK, naturalSame, boundaryOK, wallEdge: !!wallEdge, openEdge: !!openEdge };
  }, seed);
  check('墙：找到内部墙边和内部开口边做样本', walls.wallEdge && walls.openEdge, walls);
  check('墙：删一条内部边 → 位图清零 + 跳过 reconnect + 碰撞体变少', walls.deleteOK, walls);
  check('墙：加一条内部边 → 位图置一 + 碰撞体变多', walls.addOK, walls);
  check('墙：区块交界线天然两侧一致（同一份哈希）', walls.naturalSame, walls);
  check('墙：编辑交界线后两侧仍然一致', walls.boundaryOK, walls);

  // ---------- 3. 出口：removed / moved / added ----------
  const exits = await ev(page, (seed) => {
    const kit = BR.kit, lv = BR.levels.get('0');
    function freshBuilder() { return kit.builder({ level: lv, levelSeed: seed }, 0, 0, BR.util.rng(seed, 0, 0)); }

    BR.workshop.deactivate();
    const hNormal = kit.exit(freshBuilder(), { to: '1', kind: 'zone', x: 5, z: 5, radius: 1 });
    const key = hNormal && hNormal.desc.key;

    const m5 = BR.workshop.create('0', 't5'); m5.seed = seed;
    m5.exits.removed = [key];
    BR.workshop.activate(m5, { editing: true });
    const hRemoved = kit.exit(freshBuilder(), { to: '1', kind: 'zone', x: 5, z: 5, radius: 1 });
    const removedOK = hRemoved === null;
    BR.workshop.deactivate();

    const m6 = BR.workshop.create('0', 't6'); m6.seed = seed;
    m6.exits.moved = [{ key, x: 40, z: 7, rot: 1.2 }];
    BR.workshop.activate(m6, { editing: true });
    const hMoved = kit.exit(freshBuilder(), { to: '1', kind: 'zone', x: 5, z: 5, radius: 1 });
    const movedOK = !!hMoved && Math.abs(hMoved.desc.x - 40) < 0.01 && Math.abs(hMoved.desc.z - 7) < 0.01;
    BR.workshop.deactivate();

    const m7 = BR.workshop.create('0', 't7'); m7.seed = seed;
    m7.exits.added = [{ id: 'add1', to: '2', kind: 'zone', x: 10, z: 10, rot: 0 }];
    BR.workshop.activate(m7, { editing: true });
    const r3 = freshBuilder().finish();
    const addedExit = r3.exits.find(e => e.key === 'ws:add1');
    const addedOK = !!addedExit && addedExit.to === '2' && Math.abs(addedExit.x - 10) < 0.01 && Math.abs(addedExit.z - 10) < 0.01;
    BR.workshop.deactivate();

    return { key, removedOK, movedOK, addedOK };
  }, seed);
  check('出口：BR.kit.exit 带上稳定 key', typeof exits.key === 'string' && exits.key.length > 0, exits);
  check('出口：exits.removed → 整个出口不建', exits.removedOK, exits);
  check('出口：exits.moved → 按新位置建', exits.movedOK, exits);
  check('出口：exits.added → decorate() 建出新出口，key 前缀 ws:', exits.addedOK, exits);

  // ---------- 4. densityMul / spawnOverride 边界情况 ----------
  const hooks = await ev(page, (seed) => {
    BR.workshop.deactivate();
    const inactiveEntities = BR.workshop.densityMul('entities', 'hound');
    const inactiveItems = BR.workshop.densityMul('items', 'almond_water');
    const spInactive = BR.workshop.spawnOverride({ x: 1, z: 2, yaw: 3 });

    const m = BR.workshop.create('0', 't8'); m.seed = seed;
    m.settings.autoEntities = false;
    m.settings.autoItems = false;
    m.spawn = { x: 9, z: 8, yaw: 0.5 };
    BR.workshop.activate(m, { editing: false });
    const offEntities = BR.workshop.densityMul('entities', 'hound');
    const offFood = BR.workshop.densityMul('items', 'almond_water');   // 食物规则：autoItems=false 也至少 1
    const offOther = BR.workshop.densityMul('items', 'painkillers');   // 非食物：autoItems=false 时 0
    const sp = BR.workshop.spawnOverride({ x: 1, z: 2, yaw: 3, extra: 'e' });

    BR.workshop.activate(m, { editing: true });
    const editingEntities = BR.workshop.densityMul('entities', 'hound');   // 编辑态恒 0，不管 autoEntities

    m.settings.autoEntities = true;
    BR.workshop.activate(m, { editing: false });
    const onEntities = BR.workshop.densityMul('entities', 'hound');
    BR.workshop.deactivate();

    return {
      inactiveEntities, inactiveItems, spInactiveSame: spInactive.x === 1 && spInactive.z === 2 && spInactive.yaw === 3,
      offEntities, offFood, offOther, sp, editingEntities, onEntities,
    };
  }, seed);
  check('densityMul：未激活恒为 1（空操作）', hooks.inactiveEntities === 1 && hooks.inactiveItems === 1, hooks);
  check('spawnOverride：未激活原样返回', hooks.spInactiveSame, hooks);
  check('densityMul：autoEntities=false → 0', hooks.offEntities === 0, hooks);
  check('densityMul：almond_water 即使 autoItems=false 也 ≥1', hooks.offFood >= 1, hooks);
  check('densityMul：非食物 autoItems=false → 0', hooks.offOther === 0, hooks);
  check('densityMul：编辑态实体密度恒为 0', hooks.editingEntities === 0, hooks);
  check('densityMul：autoEntities=true → 1', hooks.onEntities === 1, hooks);
  check('spawnOverride：出生点覆盖生效，其余字段保留', hooks.sp.x === 9 && hooks.sp.z === 8 && hooks.sp.yaw === 0.5 && hooks.sp.extra === 'e', hooks);

  // ---------- 5. 放置实体触发 + 编辑态载入范围/不刷物品（端到端，走 game:start） ----------
  const runtime = await ev(page, (seed) => {
    BR.bus.emit('game:home');
    const map = BR.workshop.create('0', 'play');
    map.seed = seed;
    map.radius = 1;
    map.settings.autoEntities = false;   // 只看放置实体，别被层级自带的实体干扰计数
    // 出生点在 (13.5, 13.5)：一个放近处（5m 内），一个放远处（150m 外，远超默认触发半径 20）
    map.entities = [
      { id: 'near1', type: 'hound', x: 15, z: 13.5, yaw: 0, radius: null },
      { id: 'far1', type: 'hound', x: 200, z: 13.5, yaw: 0, radius: null },
    ];
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: map });
    const beforeStep = { near: !!BR.entities.get('ws:near1'), far: !!BR.entities.get('ws:far1') };
    window.__br.step(0.2);
    const afterStep = { near: !!BR.entities.get('ws:near1'), far: !!BR.entities.get('ws:far1') };
    const autoCount = BR.entities.list.filter(e => !e.manual).length;
    const itemsInPlay = BR.items.list.length;
    BR.bus.emit('game:home');

    // 编辑态：载入 map.radius 圈全部区块、不刷物品
    BR.workshop.activate(map, { editing: true });
    BR.world.start(map.baseLevel, map.seed);
    const info = BR.world.debugInfo();
    const editingLoaded = info.loaded;
    const editingItems = BR.items.list.length;
    BR.bus.emit('game:home');

    return { beforeStep, afterStep, autoCount, itemsInPlay, editingLoaded, editingItems, expectChunks: (2 * map.radius + 1) * (2 * map.radius + 1) };
  }, seed);
  check('放置实体：game:start 后、workshop.update 跑之前都还没刷', !runtime.beforeStep.near && !runtime.beforeStep.far, runtime);
  check('放置实体：走近后刷出，远处的不刷', runtime.afterStep.near === true && runtime.afterStep.far === false, runtime);
  check('autoEntities=false：没有层级自带的自动实体', runtime.autoCount === 0, runtime);
  check('所有模式都刷食物/杏仁水：游玩态物品不为空', runtime.itemsInPlay > 0, runtime);
  check('编辑态：一次性载入 map.radius 圈全部区块', runtime.editingLoaded === runtime.expectChunks, runtime);
  check('编辑态：不刷物品', runtime.editingItems === 0, runtime);
}

main();
