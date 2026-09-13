// 后室 · 创意工坊 + 设置 —— 验收自测（WORKSHOP.md 第 10 节）：node tests/workshop.mjs
// 集成之后 js/game/workshop.js、js/ui/workshop.js、js/ui/settings.js 已经在 index.html 里，
// 本文件不再需要 page.addScriptTag（区别于 workshop_core.mjs / workshop_ui.mjs / settings.mjs 三个各代理自己的自测）。
// 覆盖第 10 节里三份构建报告自测没盖到的部分：保存后刷新仍在、三种模式各自的攻击规则、
// 联机客机拿到同一张地图、实体上限影响丢弃数、设置持久化；其余（墙/交界线/出口/触发距离/密度钩子）
// 复用 workshop_core.mjs 的做法做一次精简复核，确认接入 index.html 后行为不变。
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
const OVOBOT_RE = /^https?:\/\/api\.ovobot\.ai\//;

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
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || '')); });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, 'wf-' + String(++shotN).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  console.log('     shot ' + path.relative(ROOT, f));
}
async function waitFor(page, fn, arg, timeout) {
  try { await page.waitForFunction(fn, arg, { timeout: timeout || 10000 }); return true; }
  catch (err) { return false; }
}

// stubOvobot=false：跳过页面级的兜底拦截，交给调用方在 context 级别接的信令模拟（见 checkCoopSync），
// 否则页面级 route 会盖过 context 级 route，联机测试永远拿不到房间模拟的响应
async function boot(page, base, stubOvobot) {
  if (stubOvobot !== false) {
    await page.route(OVOBOT_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }));
  }
  await page.goto(base + 'index.html');
  // BR.workshop / BR.workshopUI / BR.settingsUI 现在应该已经在 index.html 的加载列表里，不用再注入
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.kit
    && BR.workshop && BR.workshopUI && BR.settingsUI, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(500);
}

// =====================================================================
// 1) 集成检查：脚本顺序、主页两个按钮
// =====================================================================
async function checkIntegration(page) {
  const order = await ev(page, () => Array.from(document.scripts).map(s => s.getAttribute('src') || ''));
  const idx = name => order.findIndex(s => s.endsWith(name));
  const iWorkshopCore = idx('js/game/workshop.js'), iWorld = idx('js/game/world.js'), iEntities = idx('js/game/entities.js'), iMain = idx('js/main.js');
  const iWsUI = idx('js/ui/workshop.js'), iSetUI = idx('js/ui/settings.js'), iHome = idx('js/ui/home.js');
  check('index.html：js/game/workshop.js 排在 world.js/entities.js 之后、main.js 之前',
    iWorkshopCore > iWorld && iWorkshopCore > iEntities && iWorkshopCore < iMain,
    { iWorkshopCore, iWorld, iEntities, iMain });
  check('index.html：js/ui/workshop.js、js/ui/settings.js 排在 home.js 附近、main.js 之前',
    iWsUI > iHome && iSetUI > iHome && iWsUI < iMain && iSetUI < iMain,
    { iWsUI, iSetUI, iHome, iMain });
  const linked = await ev(page, () => Array.from(document.styleSheets).map(s => { try { return s.href; } catch (e) { return null; } }));
  check('index.html：css/workshop.css、css/settings.css 已 <link>（不靠模块自己再插一遍）',
    linked.some(h => h && /css\/workshop\.css$/.test(h)) && linked.some(h => h && /css\/settings\.css$/.test(h)), linked.filter(Boolean));

  const btns = await ev(page, () => Array.from(document.querySelectorAll('.home-secondary-btn')).map(b => b.textContent.trim()));
  check('主页新增「创意工坊」「设置」两个按钮', btns.includes('创意工坊') && btns.includes('设置'), btns);
  await shot(page, 'home-desktop');

  await ev(page, () => BR.workshopUI.open());
  const wsOpen = await waitFor(page, () => document.querySelector('.ws-root') && !document.querySelector('.ws-root').hidden);
  check('点击「创意工坊」按钮能打开工坊列表', wsOpen);
  await shot(page, 'workshop-list');
  await ev(page, () => BR.workshopUI.close && BR.workshopUI.close());

  await ev(page, () => BR.settingsUI.open());
  const setOpen = await waitFor(page, () => document.querySelector('.set-root') && !document.querySelector('.set-root').hidden);
  check('点击「设置」按钮能打开设置面板', setOpen);
  await shot(page, 'settings-panel');
  await ev(page, () => BR.settingsUI.close());
}

// =====================================================================
// 2) 核心钩子精简复核（同 workshop_core.mjs 思路，确认接入 index.html 后不变）
// =====================================================================
async function checkCoreHooks(page, seed) {
  const regression = await ev(page, (seed) => {
    BR.bus.emit('game:home');
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null });
    const statsA = BR.phys.stats();
    BR.bus.emit('game:home');
    const mapEmpty = BR.workshop.create('0', 'empty');
    mapEmpty.seed = seed;
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: mapEmpty });
    const statsB = BR.phys.stats();
    BR.bus.emit('game:home');
    return { equal: JSON.stringify(statsA) === JSON.stringify(statsB) };
  }, seed);
  check('未激活 vs 激活空地图：BR.phys.stats 逐字节一致（非工坊地图行为不变）', regression.equal, regression);

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
    function covered(solids, x, z, y) {
      y = y == null ? 0.9 : y;
      return solids.some(s => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && y >= s.minY && y <= s.maxY);
    }
    BR.workshop.deactivate();
    const base = make(0, 0);
    const wallEdge = base.g.edges({ interior: true, wall: true })[0];
    const openEdge = base.g.edges({ interior: true, wall: false })[0];

    const m1 = BR.workshop.create('0', 't1'); m1.seed = seed;
    m1.walls = [{ k: edgeKey(wallEdge), on: false }];
    BR.workshop.activate(m1, { editing: true });
    const r1 = make(0, 0);
    const deleteOK = bitOf(r1.g, wallEdge) === 0 && covered(r1.b._solids, wallEdge.x, wallEdge.z) === false;
    BR.workshop.deactivate();

    const m2 = BR.workshop.create('0', 't2'); m2.seed = seed;
    m2.walls = [{ k: edgeKey(openEdge), on: true }];
    BR.workshop.activate(m2, { editing: true });
    const r2 = make(0, 0);
    const addOK = bitOf(r2.g, openEdge) === 1 && covered(r2.b._solids, openEdge.x, openEdge.z) === true;
    BR.workshop.deactivate();

    // 区块交界线
    const m3 = BR.workshop.create('0', 't3'); m3.seed = seed;
    BR.workshop.activate(m3, { editing: true });
    const p0 = make(0, 0), p1 = make(1, 0);
    let bj = 0;
    for (let j = 0; j < N; j++) if (p0.g.isWall('v', N, j)) { bj = j; break; }
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
    return { deleteOK, addOK, boundaryOK, found: !!wallEdge && !!openEdge };
  }, seed);
  check('墙：删一条内部边生效（模型+碰撞体都没了）', walls.found && walls.deleteOK, walls);
  check('墙：加一条内部边生效（碰撞体出现）', walls.addOK, walls);
  check('墙：区块交界线编辑后两侧一致', walls.boundaryOK, walls);

  const exits = await ev(page, (seed) => {
    const kit = BR.kit, lv = BR.levels.get('0');
    function freshBuilder() { return kit.builder({ level: lv, levelSeed: seed }, 0, 0, BR.util.rng(seed, 0, 0)); }
    BR.workshop.deactivate();
    const hNormal = kit.exit(freshBuilder(), { to: '1', kind: 'zone', x: 5, z: 5, radius: 1 });
    const key = hNormal && hNormal.desc.key;

    const m5 = BR.workshop.create('0', 't5'); m5.seed = seed;
    m5.exits.removed = [key];
    BR.workshop.activate(m5, { editing: true });
    const removedOK = kit.exit(freshBuilder(), { to: '1', kind: 'zone', x: 5, z: 5, radius: 1 }) === null;
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
    const addedOK = !!addedExit && addedExit.to === '2';
    BR.workshop.deactivate();
    return { hasKey: typeof key === 'string' && key.length > 0, removedOK, movedOK, addedOK };
  }, seed);
  check('出口：removed 生效（不建）', exits.removedOK, exits);
  check('出口：moved 生效（按新位置建）', exits.movedOK, exits);
  check('出口：added 生效（decorate 建出新出口）', exits.addedOK, exits);

  const runtime = await ev(page, (seed) => {
    BR.bus.emit('game:home');
    const map = BR.workshop.create('0', 'play');
    map.seed = seed; map.radius = 1;
    map.settings.autoEntities = false;
    map.entities = [
      { id: 'near1', type: 'hound', x: 15, z: 13.5, yaw: 0, radius: null },
      { id: 'far1', type: 'hound', x: 200, z: 13.5, yaw: 0, radius: null },
    ];
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: map });
    const before = { near: !!BR.entities.get('ws:near1'), far: !!BR.entities.get('ws:far1') };
    window.__br.step(0.2);
    const after = { near: !!BR.entities.get('ws:near1'), far: !!BR.entities.get('ws:far1') };
    const autoCount = BR.entities.list.filter(e => !e.manual).length;
    const itemsInPlay = BR.items.list.length;
    BR.bus.emit('game:home');
    return { before, after, autoCount, itemsInPlay };
  }, seed);
  check('放置实体：走近才刷，远处不刷', !runtime.before.near && !runtime.before.far && runtime.after.near === true && runtime.after.far === false, runtime);
  check('autoEntities=false：没有层级自带实体，只剩放置的', runtime.autoCount === 0, runtime);
  check('所有模式都刷食物/杏仁水：游玩态物品不为空', runtime.itemsInPlay > 0, runtime);
}

// =====================================================================
// 3) 基本设置对整张地图生效（灯光/能见度）
// =====================================================================
async function checkMapSettings(page, seed) {
  const r = await ev(page, (seed) => {
    const map = BR.workshop.create('0', 'env');
    map.seed = seed;
    map.settings.visibility = 0.33;
    map.settings.lightMul = 0.2;
    map.settings.blackout = false;
    BR.workshop.activate(map, { editing: false });
    const fv = BR.workshop.fixedVisibility();
    const lights = BR.workshop.lightTransform([{ intensity: 1, flicker: 0 }, { intensity: 2, flicker: 0 }]);
    const env = BR.workshop.envOverride({ ambient: { intensity: 0.5 } });
    map.settings.blackout = true;
    const lightsBlackout = BR.workshop.lightTransform([{ intensity: 1, flicker: 0 }]);
    BR.workshop.deactivate();
    const fvInactive = BR.workshop.fixedVisibility();
    return { fv, lights, env, lightsBlackout, fvInactive };
  }, seed);
  check('设置：settings.visibility 固定值 → fixedVisibility() 返回该值', Math.abs(r.fv - 0.33) < 1e-6, r);
  check('设置：lightMul 按倍率缩放灯光强度', Math.abs(r.lights[0].intensity - 0.2) < 1e-6 && Math.abs(r.lights[1].intensity - 0.4) < 1e-6, r);
  check('设置：envOverride 按 lightMul 缩放环境光强度', Math.abs(r.env.ambient.intensity - 0.1) < 1e-6, r);
  check('设置：blackout=true → 灯光强度压到 0', r.lightsBlackout[0].intensity === 0, r);
  check('设置：未激活时 fixedVisibility() 返回 null（跟随玩家滑条）', r.fvInactive === null, r);
}

// =====================================================================
// 4) 保存 → 刷新页面 → 地图仍在
// =====================================================================
async function checkPersistAcrossReload(page, base, seed) {
  await ev(page, () => { try { localStorage.removeItem('backrooms_workshop_v1'); } catch (e) {} });
  const before = await ev(page, (seed) => {
    const map = BR.workshop.create('0', '刷新测试地图');
    map.seed = seed;
    map.walls = [{ k: 'v@1.00,2.00', on: false }];
    map.entities = [{ id: 'e1', type: 'hound', x: 5, z: 5, yaw: 0, radius: null }];
    const r = BR.workshop.save(map);
    return { ok: r.ok, id: map.id, count: BR.workshop.list().length };
  }, seed);
  check('保存工坊地图成功', before.ok === true, before);

  await page.reload();
  await boot(page, base);
  const after = await ev(page, id => {
    const list = BR.workshop.list();
    const m = BR.workshop.get(id);
    return { count: list.length, found: !!m, wallsOK: !!m && m.walls.length === 1 && m.walls[0].k === 'v@1.00,2.00', entOK: !!m && m.entities.length === 1 };
  }, before.id);
  check('刷新页面后地图仍在 localStorage 里、字段完整', after.found && after.wallsOK && after.entOK, after);
}

// =====================================================================
// 5) 三种模式各自的攻击规则（信息卡「游玩」路径的落地效果）+ 测试模式放置实体也刷
// =====================================================================
async function checkModeRules(page, seed) {
  const r = await ev(page, (seed) => {
    function mapWithHostile(name) {
      const m = BR.workshop.create('0', name);
      m.seed = seed; m.radius = 1;
      m.settings.autoEntities = false;
      m.entities = [{ id: 'h1', type: 'hound', x: 15, z: 13.5, yaw: 0, radius: 3 }];
      return m;
    }
    const out = {};
    // 游玩模式：不攻击玩家
    BR.bus.emit('game:home');
    BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: mapWithHostile('casual-map') });
    out.casualAttack = BR.game.attackPlayers;
    out.casualAutoSpawn = BR.game.autoSpawn;
    BR.bus.emit('game:home');

    // 噩梦生存：攻击玩家
    BR.bus.emit('game:start', { mode: 'nightmare', difficulty: 'easy', settings: {}, seed, levelId: '0', coop: null, workshop: mapWithHostile('nightmare-map') });
    out.nightmareAttack = BR.game.attackPlayers;
    out.nightmareStats = BR.game.statsEnabled;
    BR.bus.emit('game:home');

    // 测试模式：不自动生成实体（autoSpawn=false），但放置实体仍会刷
    const testMap = mapWithHostile('test-map');
    BR.bus.emit('game:start', { mode: 'test', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: testMap });
    out.testAutoSpawn = BR.game.autoSpawn;
    out.testAttack = BR.game.attackPlayers;
    window.__br.step(0.2);
    out.testPlacedSpawned = !!BR.entities.get('ws:h1');
    BR.bus.emit('game:home');
    return out;
  }, seed);
  check('游玩模式：BR.game.attackPlayers=false（实体不攻击玩家）', r.casualAttack === false, r);
  check('噩梦生存：BR.game.attackPlayers=true（实体攻击玩家）', r.nightmareAttack === true && r.nightmareStats === true, r);
  check('测试模式：autoSpawn=false（不自动生成层级实体）', r.testAutoSpawn === false && r.testAttack === false, r);
  check('测试模式：放置实体走近后仍会刷出', r.testPlacedSpawned === true, r);
}

// =====================================================================
// 6) 设置：实体上限影响 spawnForChunk 丢弃数 + 各项生效与持久化
// =====================================================================
async function checkSettingsEffects(page, base) {
  const capTest = await ev(page, () => {
    // 直接构造一个会尝试生成较多实体的层级片段，只改 BR.config.world.maxActiveEntities 看丢弃情况
    const level = { entities: [{ type: 'hound', officialPer1000m2: 500 }], chunkSize: 24 };
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, z: 0, safe: false }));
    const savedMax = BR.config.world.maxActiveEntities;
    const savedFactor = BR.game.spawnFactor;
    BR.entities.clear();
    BR.game.spawnFactor = 1;

    BR.config.world.maxActiveEntities = 60;
    const highCap = BR.entities.spawnForChunk(level, 'cap-test-high', pts.slice(), BR.util.rng(1, 2, 3));
    BR.entities.clear();

    BR.config.world.maxActiveEntities = 2;
    const lowCap = BR.entities.spawnForChunk(level, 'cap-test-low', pts.slice(), BR.util.rng(1, 2, 3));
    BR.entities.clear();

    BR.config.world.maxActiveEntities = savedMax;
    BR.game.spawnFactor = savedFactor;
    return { highCount: highCap.length, lowCount: lowCap.length };
  });
  check('设置：实体上限调低后 spawnForChunk 实际生成数相应减少（丢弃变多）',
    capTest.lowCount <= 2 && capTest.highCount > capTest.lowCount, capTest);

  // 打开设置面板，改几项，检查实时生效 + 持久化 + 恢复默认
  await ev(page, () => { try { localStorage.removeItem('backrooms_settings_v1'); } catch (e) {} });
  await ev(page, () => BR.settingsUI.open());
  const applied = await ev(page, () => {
    const calls = { setAmbientVolume: null, setSfxVolume: null, setMaster: null };
    const audio = BR.audio;
    ['setAmbientVolume', 'setSfxVolume', 'setMaster'].forEach(k => {
      if (typeof audio[k] === 'function') {
        const orig = audio[k];
        audio[k] = function (v) { calls[k] = v; return orig.call(this, v); };
      }
    });
    const root = document.querySelector('.set-root');
    const ranges = root.querySelectorAll('input.set-range');
    // 顺序对应 buildDom：实体上限、总音量、环境音、音效、语音、灵敏度、能见度
    const setRange = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setRange(ranges[0], 50);   // 实体上限 → 50
    setRange(ranges[1], 40);   // 总音量 40%
    setRange(ranges[2], 20);   // 环境音 20%
    setRange(ranges[3], 30);   // 音效 30%
    const qHigh = Array.from(root.querySelectorAll('.set-seg-btn')).find(b => b.textContent === '低');
    qHigh.click();
    return {
      maxEnt: BR.config.world.maxActiveEntities,
      quality: BR.game.settings && BR.game.settings.quality,
      calls,
      stored: JSON.parse(localStorage.getItem('backrooms_settings_v1') || 'null'),
    };
  });
  check('设置：实体上限滑条实时写入 BR.config.world.maxActiveEntities', applied.maxEnt === 50, applied);
  check('设置：画质切换「低」实时写入 BR.game.settings.quality', applied.quality === 'low', applied);
  check('设置：总音量/环境音/音效音量变化调用了 BR.audio 对应接口',
    applied.calls.setMaster === 0.4 && Math.abs(applied.calls.setAmbientVolume - 0.2) < 1e-6 && Math.abs(applied.calls.setSfxVolume - 0.3) < 1e-6, applied);
  check('设置：改动立刻写入 localStorage', !!applied.stored && applied.stored.maxActiveEntities === 50 && applied.stored.quality === 'low', applied);

  await page.reload();
  await boot(page, base);
  const afterReload = await ev(page, () => ({ maxEnt: BR.config.world.maxActiveEntities, quality: BR.game.settings && BR.game.settings.quality }));
  check('设置：刷新页面后设置仍生效（启动时 applyAll）', afterReload.maxEnt === 50 && afterReload.quality === 'low', afterReload);

  const resetOK = await ev(page, () => {
    BR.settingsUI.open();
    document.querySelector('.set-actions .set-btn').click();
    return { maxEnt: BR.config.world.maxActiveEntities, quality: BR.game.settings && BR.game.settings.quality };
  });
  check('设置：「恢复默认」把实体上限/画质等改回默认值', resetOK.maxEnt === 28 && resetOK.quality === 'high', resetOK);
  await ev(page, () => BR.settingsUI.close());
}

// =====================================================================
// 7) 联机：客机拿到房主的工坊地图（墙/出口/放置实体一致）
// 复用 tests/coop.mjs 的信令模拟（房间状态放在本文件里，双方 context 指向同一份）
// =====================================================================
const rooms = new Map();
function newCode() {
  const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s; do { s = ''; for (let i = 0; i < 6; i++) s += CH[Math.floor(Math.random() * CH.length)]; } while (rooms.has(s));
  return s;
}
function roomApi(q, body) {
  const room = q.code ? rooms.get(String(q.code).toUpperCase()) : null;
  switch (q.action) {
    case 'create': {
      const code = newCode();
      rooms.set(code, { state: 'waiting', host_name: String(body.name || ''), guest_name: '', q: { host: [], guest: [] }, seq: 0 });
      return { ok: true, code };
    }
    case 'join':
      if (!room) return { ok: false, error: 'room_not_found' };
      if (room.state === 'joined') return { ok: false, error: 'room_full' };
      room.state = 'joined'; room.guest_name = String(body.name || '');
      return { ok: true, host: room.host_name };
    case 'status':
      if (!room) return { ok: false, error: 'room_not_found' };
      return { ok: true, state: room.state, host_name: room.host_name, guest_name: room.guest_name };
    case 'signal':
      if (!room) return { ok: false, error: 'room_not_found' };
      room.q[q.to].push({ id: ++room.seq, payload: body.payload });
      return { ok: true };
    case 'poll': {
      if (!room) return { ok: false, error: 'room_not_found' };
      const since = +q.since || 0;
      const msgs = room.q[q.me].filter(m => m.id > since);
      return { ok: true, last: msgs.length ? msgs[msgs.length - 1].id : since, msgs: msgs.map(m => m.payload) };
    }
    case 'close':
      if (room) room.state = 'closed';
      return { ok: true };
  }
  return { ok: false, error: 'bad_action' };
}
async function onRoute(route) {
  const req = route.request();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  try {
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors, body: '' }); return; }
    const u = new URL(req.url());
    if (!/\/room\.php$/.test(u.pathname)) { await route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false}' }); return; }
    const q = Object.fromEntries(u.searchParams.entries());
    let body = {}; const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw); } catch (e) { body = {}; } }
    const r = roomApi(q, body);
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(r) });
  } catch (err) { /* 页面关闭时 close 请求可能 fulfill 失败，忽略 */ }
}
const btnText = (page, text) => page.locator('.coop-lobby button', { hasText: new RegExp('^' + text + '$') }).first();

async function checkCoopSync(browser, base, seed) {
  const ctxA = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const ctxB = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctxA.route(OVOBOT_RE, onRoute);
  await ctxB.route(OVOBOT_RE, onRoute);
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  watch(A, 'coop-host'); watch(B, 'coop-guest');
  try {
    await boot(A, base, false);
    await boot(B, base, false);

    // 房主：直接用一张带墙改动/新增出口/放置实体的工坊地图开局（casual 才支持联机），再打开联机大厅创建房间
    const hostMap = await ev(A, (seed) => {
      const m = BR.workshop.create('0', 'coop-map');
      m.seed = seed; m.radius = 1;
      m.settings.autoEntities = false;
      m.walls = [{ k: 'v@1.00,2.00', on: false }];
      m.exits.added = [{ id: 'coopExit1', to: '1', kind: 'zone', x: 10, z: 10, rot: 0 }];
      m.entities = [{ id: 'coopEnt1', type: 'hound', x: 15, z: 13.5, yaw: 0, radius: 20 }];
      BR.bus.emit('game:start', { mode: 'casual', difficulty: null, settings: {}, seed, levelId: '0', coop: null, workshop: m });
      BR.coop.openLobby();
      return { id: m.id, walls: m.walls, added: m.exits.added, entities: m.entities };
    }, seed);
    await A.waitForSelector('.coop-lobby', { state: 'visible', timeout: 5000 });
    await A.fill('.coop-lobby .coop-field .coop-input', '房主');
    await btnText(A, '创建房间').click();
    const hosted = await waitFor(A, () => BR.coop.phase === 'hosting' && /^[A-Z0-9]{6}$/.test(document.querySelector('.coop-code').textContent), null, 15000);
    check('联机：房主（工坊地图局内）创建房间成功', hosted);
    if (!hosted) return;
    const code = (await A.textContent('.coop-code')).trim();

    // 客机：正常主页 → 休闲 → 联机 → 输入房号加入
    await B.click('.home-play');
    await B.click('.home-menu-btn.is-casual');
    await B.locator('.home-dialog-casual .home-actions .home-btn', { hasText: /^联机$/ }).first().click();
    await B.waitForSelector('.coop-lobby', { state: 'visible', timeout: 5000 });
    await B.fill('.coop-lobby .coop-field .coop-input', '客机');
    await B.fill('.coop-code-input', code);
    await btnText(B, '加入').click();
    const confirmShown = await waitFor(B, () => { const c = document.querySelector('.coop-confirm'); return c && !c.hidden && c.getBoundingClientRect().height > 0; }, null, 15000);
    check('联机：客机能看到加入确认弹窗', confirmShown);
    if (confirmShown) await btnText(B, '同意加入').click();

    const active = await Promise.all([
      waitFor(A, () => BR.coop.active && BR.coop.phase === 'active', null, 45000),
      waitFor(B, () => BR.coop.active && BR.coop.phase === 'active', null, 45000),
    ]);
    check('联机：双方 BR.coop.active 都变为 true', active[0] && active[1], active);
    if (!active[1]) return;

    const guestGotMap = await waitFor(B, () => BR.workshop.active && BR.workshop.active.id, null, 15000);
    check('联机：客机收到 game:start 后 BR.workshop.active 被激活', guestGotMap);
    const guestMap = await ev(B, () => {
      const m = BR.workshop.active;
      return m ? { id: m.id, walls: m.walls, added: m.exits && m.exits.added, entities: m.entities, editing: BR.workshop.editing } : null;
    });
    check('联机：客机拿到同一张地图 id', !!guestMap && guestMap.id === hostMap.id, { host: hostMap.id, guest: guestMap && guestMap.id });
    check('联机：客机地图的墙改动一致', !!guestMap && JSON.stringify(guestMap.walls) === JSON.stringify(hostMap.walls), { host: hostMap.walls, guest: guestMap && guestMap.walls });
    check('联机：客机地图的新增出口一致', !!guestMap && JSON.stringify(guestMap.added) === JSON.stringify(hostMap.added), { host: hostMap.added, guest: guestMap && guestMap.added });
    check('联机：客机地图的放置实体一致', !!guestMap && JSON.stringify(guestMap.entities) === JSON.stringify(hostMap.entities), { host: hostMap.entities, guest: guestMap && guestMap.entities });
    check('联机：客机不是编辑态（正常游玩）', !!guestMap && guestMap.editing === false, guestMap);
    await shot(A, 'coop-host');
    await shot(B, 'coop-guest');
  } catch (err) {
    check('联机测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

// =====================================================================
async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    const page = await ctx.newPage();
    watch(page, 'main');
    await boot(page, base);
    await checkIntegration(page);
    await checkCoreHooks(page, SEED);
    await checkMapSettings(page, SEED);
    await checkPersistAcrossReload(page, base, SEED);
    await checkModeRules(page, SEED);
    await checkSettingsEffects(page, base);
    await ctx.close();

    await checkCoopSync(browser, base, SEED);
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
main();
