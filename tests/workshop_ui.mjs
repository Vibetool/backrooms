// 后室 · 创意工坊界面自测：node tests/workshop_ui.mjs
// js/game/workshop.js 和 js/ui/workshop.js 还没进 index.html（只有验收代理能改），用 page.addScriptTag 注入。
// 走一遍：新建 → 删/加墙 → 放实体 → 移动出口 → 改设置 → 保存 → 信息卡「游玩」。
// 桌面与 390×844 手机视口各截关键画面到 tests/output/。
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
let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, 'ui-' + String(++shotN).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  console.log('     shot ' + path.relative(ROOT, f));
}

async function boot(page, base) {
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.kit, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
  await page.addScriptTag({ url: base + 'js/game/workshop.js' });
  await page.waitForFunction(() => window.BR && BR.workshop, null, { timeout: 10000 });
  await page.addScriptTag({ url: base + 'js/ui/workshop.js' });
  await page.waitForFunction(() => window.BR && BR.workshopUI, null, { timeout: 10000 });
  // 清掉之前测试留下的本机存储，保证列表从空开始
  await page.evaluate(() => { try { localStorage.removeItem('backrooms_workshop_v1'); } catch (e) {} });
}

// 页面内：把世界坐标换算成当前舞台上的屏幕坐标（跟 js/ui/workshop.js 自己的仿射校准同一套算法，
// 专门给测试算点击坐标用，不依赖模块内部私有状态）
async function worldToClient(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const rect = document.querySelector('.ws-stage').getBoundingClientRect();
    const v = new THREE.Vector3(x, 0, z).project(BR.gfx.camera);
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height };
  }, { x, z });
}

async function run(page) {
  // ---------- 打开工坊 / 新建地图 ----------
  await ev(page, () => BR.workshopUI.open());
  check('工坊打开、地图列表为空', await ev(page, () => !!document.querySelector('.ws-empty')));

  await page.locator('.ws-actions-row .ws-btn-primary:visible').click();   // ＋ 新建地图
  await page.waitForSelector('input.ws-input[type=text]:visible', { timeout: 5000 });
  await page.locator('input.ws-input[type=text]:visible').fill('自测的后室');
  await page.locator('.ws-panel-narrow .ws-btn-primary:visible').click();   // 创建 → 进编辑器

  await page.waitForFunction(() => BR.workshop.active && BR.workshop.editing, null, { timeout: 10000 });
  check('创建后自动进入编辑器（editing=true）', await ev(page, () => BR.workshop.editing === true));
  await shot(page, 'editor-desktop');

  // ---------- 删/加墙：找出生点附近一条已存在的边，点它切换 ----------
  await page.locator('.ws-toolbar .ws-tool-btn:has-text("删/加墙")').click();
  const before = await ev(page, () => { const p = BR.player; return BR.workshop.edgeAt(p.x, p.z); });
  check('editor 里 edgeAt 能找到出生点附近的边', !!before, before);
  if (before) {
    const pt = await worldToClient(page, (before.x0 + before.x1) / 2, (before.z0 + before.z1) / 2);
    await page.mouse.click(pt.x, pt.y);
    // edgeAt 找的是"离查询点最近的边"，直接按 key 查 map.walls 里记没记到，比再查一次 edgeAt 更不受浮点误差影响
    const flipped = await ev(page, key => {
      const w1 = BR.workshop.active.walls.find(x => x.k === key);
      return w1 ? w1.on : null;
    }, before.key);
    check('点击格子边写入了 map.walls（切换有无墙）', flipped !== null && flipped !== before.on, { key: before.key, wasOn: before.on, nowOn: flipped });
  }

  // ---------- 放实体（此时右侧实体面板会展开，放置点选在屏幕偏左区域避开面板） ----------
  await page.locator('.ws-toolbar .ws-tool-btn:has-text("放实体")').click();
  const groupBtnCount = await ev(page, () => document.querySelectorAll('.ws-ent-btn').length);
  check('实体面板按层级分组列出了类型', groupBtnCount > 0, groupBtnCount);
  if (groupBtnCount > 0) {
    await page.locator('.ws-ent-btn').first().click();
    const spawnXZ = await ev(page, () => ({ x: BR.player.x - 6, z: BR.player.z - 6 }));
    const pt = await worldToClient(page, spawnXZ.x, spawnXZ.z);
    await page.mouse.click(pt.x, pt.y);
    const entCount = await ev(page, () => BR.workshop.active.entities.length);
    check('点击地图放置了一个实体', entCount === 1, entCount);
  }
  await shot(page, 'editor-entity-desktop');

  // 切回"选择"关掉侧滑面板，腾出整个屏幕给下面的出口拖拽（出口具体在地图哪个角落不确定，先把它平移到视口中心再拖）
  await page.locator('.ws-toolbar .ws-tool-btn:has-text("选择")').click();
  const exitInfo = await ev(page, () => {
    const p = BR.player;
    const list = BR.workshop.exitsNear(p.x, p.z, 400);
    return list[0] || null;
  });
  check('editor 里 exitsNear 能找到出口', !!exitInfo, exitInfo && exitInfo.key);
  if (exitInfo) {
    const cur = await worldToClient(page, exitInfo.x, exitInfo.z);
    const vp = page.viewportSize();
    const centerX = vp.width / 2, centerY = vp.height / 2;
    const dx = centerX - cur.x, dy = centerY - cur.y;
    if (Math.hypot(dx, dy) > 8) {
      // 拖动空白背景把出口平移到视口中心：panBy 的方向就是"内容跟手"，见 js/ui/workshop.js 里的注释
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + dx, centerY + dy, { steps: 6 });
      await page.mouse.up();
    }
    const from = await worldToClient(page, exitInfo.x, exitInfo.z);
    const to = { x: from.x + 60, y: from.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const moved = await ev(page, key => {
      const m = BR.workshop.active.exits.moved;
      return m.find(x => String(x.key) === String(key)) || null;
    }, exitInfo.key);
    check('拖动出口图标写入了 exits.moved', !!moved, moved);
  }
  await shot(page, 'editor-markers-desktop');

  // ---------- 基本设置 ----------
  await page.locator('.ws-toolbar .ws-tool-btn:has-text("基本设置")').click();
  await page.waitForSelector('.ws-panelslide:not([hidden]) .ws-check-row input');
  await page.locator('.ws-panelslide .ws-check-row:has-text("保留层级自带实体生成") input').click();
  const autoEntities = await ev(page, () => BR.workshop.active.settings.autoEntities);
  check('关闭"保留层级自带实体生成"写入了 settings.autoEntities=false', autoEntities === false, autoEntities);

  // ---------- 保存 → 信息卡 ----------
  await page.locator('.ws-panelslide .ws-close').click();   // 关掉设置面板，不然会挡住底部的保存按钮
  await page.locator('.ws-bottombar .ws-btn-primary').click();   // 保存
  await page.waitForSelector('.ws-modal:not([hidden]) .ws-mode-list', { timeout: 10000 });
  const infoTitle = await ev(page, () => document.querySelector('.ws-modal:not([hidden]) .ws-title').textContent);
  check('保存成功后切到信息卡', infoTitle === '地图已保存', infoTitle);
  const stored = await ev(page, () => JSON.parse(localStorage.getItem('backrooms_workshop_v1') || '{"maps":[]}').maps.length);
  check('保存后 localStorage 里有这张地图', stored === 1, stored);
  await shot(page, 'info-card-desktop');

  // ---------- 从信息卡「游玩」（游玩模式） ----------
  const mapId = await ev(page, () => BR.workshop.list()[0].id);
  await page.locator('.ws-mode-list .ws-mode-btn:has-text("游玩")').click();
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 15000 });
  const live = await ev(page, () => ({
    mode: BR.game.mode, wsActive: BR.workshop.active && BR.workshop.active.id, wsEditing: BR.workshop.editing,
  }));
  check('点「游玩」后 game:start 生效：screen=playing、mode=casual、工坊地图已激活且非编辑态', live.mode === 'casual' && live.wsActive === mapId && live.wsEditing === false, live);

  // ---------- 手机视口：重新走一遍新建，看工具栏布局 ----------
  await page.evaluate(() => BR.bus.emit('game:home'));
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(page, () => BR.workshopUI.open());
  await page.locator('.ws-actions-row .ws-btn-primary:visible').click();
  await page.waitForSelector('input.ws-input[type=text]:visible', { timeout: 5000 });
  await page.locator('input.ws-input[type=text]:visible').fill('手机测试');
  await page.locator('.ws-panel-narrow .ws-btn-primary:visible').click();
  await page.waitForFunction(() => BR.workshop.active && BR.workshop.editing, null, { timeout: 10000 });
  const toolBtnBox = await ev(page, () => {
    const b = document.querySelector('.ws-toolbar .ws-tool-btn');
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check('手机端工具栏按钮 ≥44px', toolBtnBox.h >= 44, toolBtnBox);
  await shot(page, 'editor-mobile-390');
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
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
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
  const fail = results.filter(r => !r.ok);
  console.log('\n' + (fail.length ? fail.length + ' 项失败' : '全部通过') + '，共 ' + results.length + ' 项检查；' + errors.length + ' 条页面错误');
  if (errors.length) errors.forEach(e => console.log('  ' + e));
  process.exit(fail.length || errors.length ? 1 : 0);
}
main();
