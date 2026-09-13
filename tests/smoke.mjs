// 后室 · 冒烟测试：node tests/smoke.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），按用户定死的规则逐项验证，截图写 tests/output/。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
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

// ---------- 静态服务 ----------
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

// ---------- 记录 ----------
const results = [];
const errors = [];
const shots = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function watch(page, tag) {
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
}
let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, String(++shotN).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  shots.push(f);
  console.log('     shot ' + path.relative(ROOT, f));
}

async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  watch(page, tag);
  // 联机信令服务器绝不能打线上
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  return page;
}
async function boot(page, base) {
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);   // 等 GLB 替换兜底人形、主页镜头摆好
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function visible(page, sel) { return page.locator(sel).first().isVisible().catch(() => false); }

// ---------- 页面内工具 ----------
function suitColors() {
  const out = { suit: [], other: {} };
  BR.gfx.scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of arr) {
      if (!m || !m.color) continue;
      const n = m.name || '';
      if (/^Suit(\.\d+)?$/.test(n)) out.suit.push(m.color.getHex());
      else if (n) out.other[n] = m.color.getHex();
    }
  });
  return out;
}
function expectedHex(key) {
  const c = new THREE.Color().setHex(BR.skin.color(key));
  const cm = THREE.ColorManagement;
  if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
  return c.getHex();
}

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
    await desktop(browser, base);
    await mobile(browser, base);
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
// 桌面 1280×720
// =====================================================================
async function desktop(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await newPage(ctx, 'desktop');
  await boot(page, base);

  // ---------- 主页 ----------
  // ---------- 层级实体/物品表里的 type 都要已注册 ----------
  // 实体代理常把一个实体拆成多个形态 type（arachnid_common、neighborhood_watch_strider……），层级表里还写总名的话
  // world 会静默跳过、一只都不刷，截图和报错里都看不出来，只能在这里逐个对名字
  const tableIssues = await ev(page, () => {
    const out = [];
    for (const lv of BR.levels.all()) {
      for (const e of lv.entities || []) if (e && !BR.entityTypes.has(e.type)) out.push('L' + lv.id + ' 实体 ' + e.type);
      for (const it of lv.items || []) if (it && !BR.itemTypes.has(it.type)) out.push('L' + lv.id + ' 物品 ' + it.type);
    }
    return out;
  });
  check('每个层级 entities / items 表里的 type 都已注册', tableIssues.length === 0, tableIssues);

  const home0 = await ev(page, () => ({ screen: BR.game.screen, shown: BR.home.shown, skin: BR.skin.current, inputOn: BR.input.enabled }));
  check('主页：启动后停在主页、输入关闭', home0.screen === 'home' && home0.shown && !home0.inputOn, home0);
  check('主页：「游玩」按钮在右下角', await ev(page, () => {
    const r = document.querySelector('.home-play').getBoundingClientRect();
    return r.right > innerWidth * 0.75 && r.bottom > innerHeight * 0.75;
  }));
  await shot(page, 'home');

  // ---------- 点人物 → 色板 → 粉色 ----------
  const before = await ev(page, suitColors);
  check('主页人物有独立的 Suit 材质和其他材质', before.suit.length > 0 && Object.keys(before.other).length >= 3, { suit: before.suit.length, other: Object.keys(before.other) });
  const pt = await ev(page, () => {
    const v = new THREE.Vector3(0, 1.15, 0.1).project(BR.gfx.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  check('点人物弹出色板', await visible(page, '.home-skin'), pt);
  const swatches = await page.$$eval('.home-swatch', els => els.map(e => e.dataset.key));
  check('色板六色：粉蓝黄紫绿红', JSON.stringify(swatches) === JSON.stringify(['pink', 'blue', 'yellow', 'purple', 'green', 'red']), swatches);
  await shot(page, 'skin-panel');
  await page.click('.home-swatch[data-key="pink"]');
  await page.waitForTimeout(150);
  const after = await ev(page, suitColors);
  const pinkHex = await ev(page, expectedHex, 'pink');
  const otherSame = Object.keys(before.other).every(k => before.other[k] === after.other[k]);
  check('换粉色：Suit 材质变成粉色', after.suit.length > 0 && after.suit.every(h => h === pinkHex), { suit: after.suit.map(h => h.toString(16)), want: pinkHex.toString(16) });
  check('换粉色：面具/靴子/手套/胶带等其他材质不变', otherSame, { before: before.other, after: after.other });
  check('换粉色：BR.skin.current / BR.game.skin 同步', await ev(page, () => BR.skin.current === 'pink' && BR.game.skin === 'pink'));
  await shot(page, 'skin-pink');
  await page.click('.home-skin .home-close');
  await page.waitForTimeout(150);

  await page.reload();
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);
  const reloaded = await ev(page, suitColors);
  const pinkHex2 = await ev(page, expectedHex, 'pink');
  check('刷新后仍是粉色（localStorage + 模型颜色）',
    (await ev(page, () => BR.skin.current === 'pink' && localStorage.getItem('backrooms_skin') === 'pink')) &&
    reloaded.suit.length > 0 && reloaded.suit.every(h => h === pinkHex2), reloaded.suit.map(h => h.toString(16)));
  await shot(page, 'home-after-reload-pink');

  // ---------- 「游玩」弹窗 ----------
  await page.click('.home-play');
  await page.waitForTimeout(200);
  const menu = await page.$$eval('.home-menu-btn .home-menu-name', els => els.map(e => e.textContent.trim()));
  check('弹窗按钮自上而下：游玩 / 噩梦生存 / 测试模式', JSON.stringify(menu) === JSON.stringify(['游玩', '噩梦生存', '测试模式']), menu);
  const tops = await page.$$eval('.home-menu-btn', els => els.map(e => e.getBoundingClientRect().top));
  check('三个按钮纵向排列', tops.length === 3 && tops[0] < tops[1] && tops[1] < tops[2], tops);
  await shot(page, 'menu');

  await page.click('.home-menu-btn.is-casual');
  await page.waitForTimeout(200);
  await ev(page, () => {
    const r = document.querySelectorAll('.home-dialog-casual .home-range')[1];
    r.value = '100';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const spawnTxt = await page.locator('.home-dialog-casual .home-field-value').nth(1).textContent();
  check('游玩参数：生成量滑条满 = 正常后室的 50%', /正常后室的\s*50%/.test(spawnTxt), spawnTxt);
  await shot(page, 'casual-panel');

  // ---------- 游玩开局 ----------
  await page.click('.home-dialog-casual .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.setAuto(false));
  const cas = await ev(page, () => ({
    mode: BR.game.mode, lv: BR.game.levelId, sf: BR.game.spawnFactor, atk: BR.game.attackPlayers, stats: BR.game.statsEnabled,
    auto: BR.game.autoSpawn, skin: BR.game.skin, homeShown: BR.home.shown, inputOn: BR.input.enabled, hud: BR.hud.visible,
  }));
  check('游玩开局：默认 Level 0、spawnFactor 0.5、不打玩家、无饥饿 san', cas.mode === 'casual' && cas.lv === '0' && cas.sf === 0.5 && !cas.atk && !cas.stats && cas.auto, cas);
  check('游玩开局：主页隐藏、HUD 显示、输入打开、皮肤带进 BR.game', !cas.homeShown && cas.hud && cas.inputOn && cas.skin === 'pink', cas);
  await ev(page, () => __br.step(1));
  // Level 0 选中的是 wikidot-en「Threshold」，那一版没有确认的实体，只有用户指定必须出现的细菌（rare 档，多数开局一只都刷不出来），
  // 所以出生块周围一只实体都没有时换到实体多的 Level 1 验证自动刷怪
  const casEnts = await ev(page, async () => {
    if (BR.entities.count() === 0 && BR.levels.has('1')) await BR.world.goTo('1');
    // Level 1 平均每块约 0.23 只实体：只推进 1 秒时建好的区块不多，偶尔一只都没刷到。多推进几步（最多 6 秒）让出生点周围区块建完再数
    if (window.__br && __br.step) { __br.step(1); for (let i = 0; i < 25 && BR.entities.count() === 0; i++) __br.step(0.2); }
    return { lv: BR.game.levelId, n: BR.entities.count(), items: BR.items.list.length, statsHidden: document.querySelector('.hud-stats').hidden };
  });
  check('游玩：自动生成了实体，也刷了食物/杏仁水', casEnts.n > 0 && casEnts.items > 0, casEnts);
  check('游玩：顶部没有 san/饥饿状态条', casEnts.statsHidden, casEnts);
  await shot(page, 'casual-playing');

  const p0 = await ev(page, () => ({ x: BR.player.x, z: BR.player.z }));
  await page.keyboard.down('KeyW');
  await ev(page, () => __br.step(2));
  await page.keyboard.up('KeyW');
  const p1 = await ev(page, () => ({ x: BR.player.x, z: BR.player.z }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('按住 W 2 秒位置改变', moved > 1, { moved: +moved.toFixed(2), p0, p1 });
  await shot(page, 'casual-after-walk');

  // 暂停菜单 → 返回主页（要点两次确认）
  await page.keyboard.press('Escape');
  await ev(page, () => __br.step(0.05));
  check('Esc 打开暂停菜单', (await visible(page, '.hud-pause')) && (await ev(page, () => BR.game.screen === 'paused' && !BR.input.enabled)));
  await shot(page, 'pause');
  await page.waitForTimeout(700);
  await page.click('.hud-btn-home');
  await page.waitForTimeout(100);
  await page.click('.hud-btn-home');
  await page.waitForFunction(() => BR.game.screen === 'home' && BR.home.shown, null, { timeout: 10000 });
  const backHome = await ev(page, () => ({ lv: BR.world.current, ents: BR.entities.list.length, items: BR.items.list.length, hud: BR.hud.visible, inputOn: BR.input.enabled }));
  check('返回主页：世界/实体/物品清空、HUD 收起、输入关闭', !backHome.lv && backHome.ents === 0 && backHome.items === 0 && !backHome.hud && !backHome.inputOn, backHome);
  await page.waitForTimeout(300);
  await shot(page, 'home-again');

  // ---------- 噩梦·地狱 ----------
  await page.click('.home-play');
  await page.waitForTimeout(150);
  await page.click('.home-menu-btn.is-nightmare');
  await page.waitForTimeout(150);
  const cards = await page.$$eval('.home-card .home-card-desc', els => els.map(e => e.textContent));
  check('噩梦难度卡片 0/20/40/60%', / 0%$/.test(cards[0]) && / 20%$/.test(cards[1]) && / 40%$/.test(cards[2]) && / 60%$/.test(cards[3]), cards);
  await shot(page, 'nightmare-cards');
  await page.click('.home-card-hell');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.step(0.5));
  const nm = await ev(page, () => ({
    mode: BR.game.mode, diff: BR.game.difficulty, sf: BR.game.spawnFactor, atk: BR.game.attackPlayers, stats: BR.game.statsEnabled,
    hp: BR.player.hp, hunger: BR.player.hunger, inv: BR.player.inventory.filter(Boolean).length,
  }));
  check('噩梦地狱：spawnFactor 0.6、实体攻击玩家、有饥饿 san', nm.mode === 'nightmare' && nm.diff === 'hell' && nm.sf === 0.6 && nm.atk && nm.stats, nm);
  check('噩梦开局：新一局满血、背包清空', nm.hp === 100 && nm.inv === 0, nm);
  const statBar = await ev(page, () => {
    const el = document.querySelector('.hud-stats');
    const r = el.getBoundingClientRect();
    const names = Array.from(el.querySelectorAll('[class*="hud-stat-"]')).map(n => n.className);
    return { hidden: el.hidden, top: r.top, h: r.height, w: r.width, names };
  });
  check('噩梦：顶部状态条可见（san / 饥饿）', !statBar.hidden && statBar.h > 0 && statBar.top < 120, statBar);
  await shot(page, 'nightmare-hell');

  // 饥饿减速：找开阔方向，分别在饥饿 100 / 10 / 0 下按 W 走 1 秒
  const dir = await ev(page, () => {
    BR.entities.clear();   // 测速时别被咬
    const P = BR.player;
    let best = { yaw: P.yaw, d: -1 };
    for (let i = 0; i < 16; i++) {
      const yaw = -Math.PI + i * Math.PI / 8;
      const h = BR.phys.raycast(P.x, P.feetY + 1.0, P.z, -Math.sin(yaw), 0, -Math.cos(yaw), 30);
      const d = h ? h.dist : 30;
      if (d > best.d) best = { yaw, d };
    }
    return { x: P.x, z: P.z, yaw: best.yaw, free: best.d };
  });
  async function walk(hunger) {
    await ev(page, ({ d, hunger }) => {
      const P = BR.player;
      P.x = d.x; P.z = d.z; P.yaw = d.yaw; P.pitch = 0; P.vx = 0; P.vz = 0;
      P.hunger = hunger; P.sanity = 100; P.hp = 100;
    }, { d: dir, hunger });
    await page.keyboard.down('KeyW');
    const r = await ev(page, () => { const a = { x: BR.player.x, z: BR.player.z }; __br.step(1); return { a, b: { x: BR.player.x, z: BR.player.z }, speed: BR.player.speed() }; });
    await page.keyboard.up('KeyW');
    await ev(page, () => __br.step(0.3));
    return { dist: Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z), speed: r.speed };
  }
  const w100 = await walk(100), w10 = await walk(10), w0 = await walk(0);
  const walkCfg = await ev(page, () => BR.config.player.walk);
  check('饥饿 10：移速减半（speed()）', Math.abs(w10.speed - walkCfg * 0.5) < 1e-6, { speed: w10.speed, walk: walkCfg });
  check('饥饿 0：移速为 1/3（speed()）', Math.abs(w0.speed - walkCfg / 3) < 1e-6, { speed: w0.speed });
  check('饥饿 10：实际位移约为饱腹时的一半', Math.abs(w10.dist / w100.dist - 0.5) < 0.06, { d100: +w100.dist.toFixed(3), d10: +w10.dist.toFixed(3), ratio: +(w10.dist / w100.dist).toFixed(3), free: dir.free });
  check('饥饿 0：实际位移约为饱腹时的 1/3', Math.abs(w0.dist / w100.dist - 1 / 3) < 0.05, { d0: +w0.dist.toFixed(3), ratio: +(w0.dist / w100.dist).toFixed(3) });

  // 死亡 → 结算 → 继续（原地重生、背包保留、附近非友善实体被清）
  const setup = await ev(page, () => {
    const P = BR.player;
    P.hunger = 60; P.sanity = 80;
    P.addItem('almond_water', 2);
    P.addItem('food_ration', 1);
    const fy = P.feetY, from = { x: P.x, y: P.y, z: P.z };
    const near = [
      BR.entities.spawn('_dev_hostile', P.x + 2.5, fy, P.z, { from }),
      BR.entities.spawn('_dev_friendly', P.x - 2.5, fy, P.z, { from }),
      BR.entities.spawn('test_dummy', P.x, fy, P.z + 2.5, { from }),
    ].filter(Boolean);
    return { x: P.x, z: P.z, yaw: P.yaw, near: near.map(e => ({ id: e.id, type: e.type, d: Math.hypot(e.x - P.x, e.z - P.z) })), inv: JSON.stringify(P.inventory) };
  });
  check('死亡前布置：身边放了有害/友善/测试人', setup.near.length === 3, setup.near);
  await ev(page, () => { BR.player.hp = 0; __br.step(0.05); });
  await page.waitForTimeout(200);
  const dead = await ev(page, () => ({ dead: BR.player.dead, screen: BR.game.screen, deaths: BR.game.deaths, inputOn: BR.input.enabled, vis: BR.death.visible }));
  check('hp 设 0 触发死亡 → 结算界面', dead.dead && dead.screen === 'dead' && dead.deaths === 1 && !dead.inputOn && dead.vis && await visible(page, '.death-root'), dead);
  const deathBtns = await page.$$eval('.death-btn .death-btn-main', els => els.map(e => e.textContent.trim()));
  check('结算界面两个按钮：继续 / 返回主页', JSON.stringify(deathBtns) === JSON.stringify(['继续', '返回主页']), deathBtns);
  await page.waitForTimeout(900);   // 结算按钮 800ms 内不响应，防止死亡瞬间误点
  await shot(page, 'death');
  await page.click('.death-btn-continue');
  await ev(page, () => __br.step(0.1));
  const resp = await ev(page, (s) => {
    const P = BR.player;
    const alive = s.near.map(n => ({ type: n.type, alive: !!BR.entities.get(n.id) }));
    return {
      dead: P.dead, hp: P.hp, screen: BR.game.screen, inputOn: BR.input.enabled, vis: BR.death.visible,
      dx: Math.hypot(P.x - s.x, P.z - s.z), inv: JSON.stringify(P.inventory), hunger: P.hunger, sanity: P.sanity, alive,
    };
  }, setup);
  check('继续：原地重生（位置不变、满血、回到游玩、输入打开）', !resp.dead && resp.hp === 100 && resp.dx < 0.05 && resp.screen === 'playing' && resp.inputOn && !resp.vis, resp);
  check('继续：背包保留', resp.inv === setup.inv, { before: setup.inv, after: resp.inv });
  check('继续：饥饿/san 回到 50 以上', resp.hunger >= 50 && resp.sanity >= 50, resp);
  const aliveOf = t => (resp.alive.find(a => a.type === t) || {}).alive;
  check('继续：附近有害实体和测试人被清掉、友善实体保留', aliveOf('_dev_hostile') === false && aliveOf('test_dummy') === false && aliveOf('_dev_friendly') === true, resp.alive);
  await shot(page, 'respawned');

  // 再死一次，走「返回主页」
  await ev(page, () => { BR.player.hp = 0; __br.step(0.05); });
  await page.waitForTimeout(950);
  await page.click('.death-btn-home');
  await page.waitForFunction(() => BR.game.screen === 'home' && BR.home.shown, null, { timeout: 10000 });
  check('结算「返回主页」回到主页', await ev(page, () => !BR.death.visible && !BR.world.current && !BR.hud.visible));

  // ---------- 测试模式 ----------
  await page.click('.home-play');
  await page.waitForTimeout(150);
  await page.click('.home-menu-btn.is-test');
  await page.waitForTimeout(150);
  await shot(page, 'test-panel-home');
  await page.click('.home-dialog-test .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.step(3));
  const tm = await ev(page, () => ({ mode: BR.game.mode, auto: BR.game.autoSpawn, sf: BR.game.spawnFactor, ents: BR.entities.list.length, items: BR.items.list.length, atk: BR.game.attackPlayers }));
  check('测试模式：不自动生成实体，但照常刷物品', tm.mode === 'test' && !tm.auto && tm.ents === 0 && tm.items > 0 && !tm.atk, tm);
  await shot(page, 'test-playing');

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(150);
  const panel = await ev(page, () => ({ open: BR.test.isOpen, inputOn: BR.input.enabled }));
  check('按 T 打开实体面板，输入关闭', panel.open && !panel.inputOn && await visible(page, '.test-root'), panel);
  await shot(page, 'test-entity-list');
  await page.waitForTimeout(450);   // 面板打开后 400ms 内的点击被忽略
  await page.click('.test-btn-dummy');
  await ev(page, () => __br.step(0.05));
  const dummy0 = await ev(page, () => {
    const d = BR.entities.list.find(e => e.type === 'test_dummy');
    return d ? { id: d.id, x: d.x, z: d.z, hp: d.hp, speed: d.def.speed, faction: d.def.faction } : null;
  });
  check('召唤测试人', !!dummy0 && dummy0.faction === 'dummy', dummy0);
  await page.click('.test-close');
  await ev(page, () => __br.step(0.05));
  check('关闭面板后输入恢复', await ev(page, () => !BR.test.isOpen && BR.input.enabled));

  // 测试人移速：3 秒里每 0.1 秒采样，取移动中的速度
  const dSpeed = await ev(page, (id) => {
    const out = [];
    let e = BR.entities.get(id);
    let px = e.x, pz = e.z;
    for (let i = 0; i < 40; i++) {
      __br.step(0.1);
      e = BR.entities.get(id);
      if (!e) break;
      out.push(Math.hypot(e.x - px, e.z - pz) / 0.1);
      px = e.x; pz = e.z;
    }
    const moving = out.filter(v => v > 0.3).sort((a, b) => a - b);
    return { max: moving.length ? moving[moving.length - 1] : 0, median: moving.length ? moving[moving.length >> 1] : 0,
      p75: moving.length ? moving[Math.floor(moving.length * 0.75)] : 0, samples: out.length, moving: moving.length, walk: BR.config.player.walk };
  }, dummy0.id);
  // 巡航速度看最大值（没被挡时正好是步行的一半）；中位数会被贴墙滑行、转身拖低——每次种子随机、布局不同，按中位数判定会偶发失败。
  // 再要求 75 分位不低于 0.35 倍，防止测试人大部分时间卡住不动也算过
  const ratio = dSpeed.max / dSpeed.walk;
  check('测试人移速约为玩家步行一半', dSpeed.moving >= 5 && ratio > 0.45 && ratio < 0.56 && dSpeed.p75 / dSpeed.walk > 0.35, { ...dSpeed, ratio: +ratio.toFixed(3) });

  // 场景一：只放有害实体 + 测试人（测试人拉回原位），推进 10 秒，验证测试人掉血。
  // 以前和友善实体放在同一场，有害实体常先被友善实体打死、来不及打测试人，所以拆成两个独立场景。
  const scene1 = await ev(page, (d0) => {
    const d = BR.entities.get(d0.id);
    if (d) { d.x = d0.x; d.z = d0.z; }
    __br.step(0.05);
    const h = BR.test.spawnEntity('_dev_hostile');
    if (!h || !d) return { ok: false, h: !!h, d: !!d };
    const log = { playerDamage: 0, kills: [] };
    const off1 = BR.bus.on('player:damage', () => { log.playerDamage++; });
    const off2 = BR.bus.on('entity:kill', p => { log.kills.push({ killerType: p.killerType, victimType: p.victimType }); });
    const hp0 = { h: h.hp, d: d.hp };
    const min = { h: h.hp, d: d.hp };
    const dist = Math.hypot(h.x - d.x, h.z - d.z);
    const types = BR.entities.list.filter(e => !e.removed).map(e => e.type);
    for (let i = 0; i < 100; i++) {
      __br.step(0.1);
      const H = BR.entities.get(h.id), D = BR.entities.get(d0.id);
      if (H) min.h = Math.min(min.h, H.hp);
      if (D) min.d = Math.min(min.d, D.hp);
    }
    off1(); off2();
    return { ok: true, hp0, min, dist, types, log, playerHp: BR.player.hp, playerDead: BR.player.dead };
  }, dummy0);
  check('场景一：只放 _dev_hostile + 测试人', scene1.ok && scene1.types.length === 2 && !scene1.types.includes('_dev_friendly'), scene1.ok ? scene1.types : scene1);
  if (scene1.ok) {
    const killedDummy = scene1.log.kills.some(k => k.victimType === 'test_dummy' && k.killerType === '_dev_hostile');
    check('有害实体攻击测试人（测试人掉血）', scene1.min.d < scene1.hp0.d || killedDummy, { min: scene1.min, hp0: scene1.hp0, kills: scene1.log.kills, dist: +scene1.dist.toFixed(2) });
  }
  await shot(page, 'test-hostile-vs-dummy');

  // 场景二：清场后放 _dev_hostile + _dev_friendly，推进 10 秒，验证互打
  const scene2 = await ev(page, () => {
    BR.test.clearAll();
    __br.step(0.1);
    const left = BR.entities.list.filter(e => !e.removed).length;
    const h = BR.test.spawnEntity('_dev_hostile');
    const f = BR.test.spawnEntity('_dev_friendly');
    if (!h || !f) return { ok: false, left, h: !!h, f: !!f };
    const log = { playerDamage: 0, kills: [] };
    const off1 = BR.bus.on('player:damage', () => { log.playerDamage++; });
    const off2 = BR.bus.on('entity:kill', p => { log.kills.push({ killerType: p.killerType, victimType: p.victimType }); });
    const hp0 = { h: h.hp, f: f.hp };
    const min = { h: h.hp, f: f.hp };
    const dist = Math.hypot(h.x - f.x, h.z - f.z);
    for (let i = 0; i < 100; i++) {
      __br.step(0.1);
      const H = BR.entities.get(h.id), F = BR.entities.get(f.id);
      if (H) min.h = Math.min(min.h, H.hp);
      if (F) min.f = Math.min(min.f, F.hp);
    }
    off1(); off2();
    return { ok: true, left, hp0, min, dist, log, playerHp: BR.player.hp, playerDead: BR.player.dead };
  });
  check('场景二：清场后放出 _dev_hostile 与 _dev_friendly', scene2.ok && scene2.left === 0, scene2.ok ? { left: scene2.left, dist: +scene2.dist.toFixed(2) } : scene2);
  if (scene2.ok) {
    const killedFriendly = scene2.log.kills.some(k => k.victimType === '_dev_friendly' && k.killerType === '_dev_hostile');
    check('有害实体攻击友善实体', scene2.min.f < scene2.hp0.f || killedFriendly, { min: scene2.min, hp0: scene2.hp0, kills: scene2.log.kills });
    check('友善实体攻击有害实体', scene2.min.h < scene2.hp0.h || scene2.log.kills.some(k => k.victimType === '_dev_hostile'), { min: scene2.min, kills: scene2.log.kills });
  }
  check('测试模式实体不攻击玩家（两个场景）', scene1.ok && scene2.ok && scene1.log.playerDamage === 0 && scene2.log.playerDamage === 0 && scene2.playerHp === 100 && !scene2.playerDead,
    { s1: scene1.log && scene1.log.playerDamage, s2: scene2.log && scene2.log.playerDamage, hp: scene2.playerHp, dead: scene2.playerDead });
  await shot(page, 'test-fight');

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(500);
  await page.click('.test-btn-clear');
  await ev(page, () => __br.step(0.1));
  const cleared = await ev(page, () => BR.entities.list.length);
  check('「清除全部」后场上没有实体', cleared === 0, cleared);
  await shot(page, 'test-cleared');
  await page.click('.test-close');
  await ev(page, () => __br.setAuto(true));
  await ctx.close();
}

// =====================================================================
// 手机竖屏 390×844 触屏
// =====================================================================
async function mobile(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await newPage(ctx, 'mobile');
  await boot(page, base);
  check('手机：识别为触屏', await ev(page, () => BR.input.isTouch === true));
  const play = await ev(page, () => {
    const r = document.querySelector('.home-play').getBoundingClientRect();
    return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, inView: r.right <= innerWidth && r.bottom <= innerHeight };
  });
  check('手机：「游玩」按钮在右下且点击目标 ≥ 44px', play.inView && play.h >= 44 && play.w >= 44 && play.right < 120 && play.bottom < 160, play);
  await shot(page, 'mobile-home');
  await page.tap('.home-play');
  await page.waitForTimeout(250);
  const menu = await page.$$eval('.home-menu-btn .home-menu-name', els => els.map(e => e.textContent.trim()));
  check('手机：弹窗按钮顺序', JSON.stringify(menu) === JSON.stringify(['游玩', '噩梦生存', '测试模式']), menu);
  await shot(page, 'mobile-menu');
  await page.tap('.home-menu-btn.is-casual');
  await page.waitForTimeout(250);
  await shot(page, 'mobile-casual-panel');
  await page.tap('.home-dialog-casual .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => { __br.setAuto(false); __br.step(1); });
  const m = await ev(page, () => {
    const t = document.querySelector('.touch-root');
    return { lv: BR.game.levelId, touch: !!t && !t.hidden && getComputedStyle(t).display !== 'none', hud: BR.hud.visible, inputOn: BR.input.enabled };
  });
  check('手机：游玩开局，触屏摇杆/按钮显示', m.lv === '0' && m.touch && m.hud && m.inputOn, m);
  await ev(page, () => __br.setAuto(true));
  await page.waitForTimeout(400);
  await shot(page, 'mobile-playing');
  await ctx.close();
}

main();
