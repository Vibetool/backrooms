// 后室 · 设置面板自测：node tests/settings.mjs
// js/ui/settings.js、css/settings.css 还没接进 index.html（只有验收代理能改 index.html），
// 所以这里用 page.addScriptTag 把它注入到已经跑起来的页面里，跟主页两个新按钮一起测。
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），拦截 api.ovobot.ai，逐项验证后退出码 1/0。
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

// ---------- 静态服务（同 tests/smoke.mjs） ----------
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
  const f = path.join(OUT, 'settings-' + String(++shotN).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: f });
  console.log('     shot ' + path.relative(ROOT, f));
}
async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  watch(page, tag);
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  return page;
}
async function boot(page, base) {
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(500);
}
// 把 js/ui/settings.js 注入到已经跑起来的页面（还没接进 index.html）
async function injectSettings(page, base) {
  await page.addScriptTag({ url: base + 'js/ui/settings.js' });
  await page.waitForFunction(() => !!(window.BR && BR.settingsUI), null, { timeout: 5000 });
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

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
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

// =====================================================================
// 桌面 1280×720
// =====================================================================
async function desktop(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await newPage(ctx, 'desktop');
  await boot(page, base);

  // ---------- 主页两个新按钮：存在、顺序、位置在「游玩」正上方且不挡标题/人物 ----------
  const layout = await ev(page, () => {
    const play = document.querySelector('.home-play').getBoundingClientRect();
    const title = document.querySelector('.home-title').getBoundingClientRect();
    const btns = Array.from(document.querySelectorAll('.home-secondary-btn'));
    return {
      texts: btns.map(b => b.textContent.trim()),
      rects: btns.map(b => b.getBoundingClientRect()).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right })),
      play: { x: play.x, y: play.y, w: play.width, h: play.height, bottom: play.bottom, right: play.right },
      title: { bottom: title.bottom, right: title.right },
    };
  });
  check('主页：两个新按钮存在且顺序为 创意工坊/设置', JSON.stringify(layout.texts) === JSON.stringify(['创意工坊', '设置']), layout.texts);
  const allAbovePlay = layout.rects.every(r => r.bottom <= layout.play.y + 1);
  check('主页：两个按钮都在「游玩」正上方（不重叠）', allAbovePlay, { btns: layout.rects, play: layout.play });
  check('主页：不挡标题', layout.rects.every(r => r.y >= layout.title.bottom), { btns: layout.rects, title: layout.title });
  check('主页：两个按钮点击目标 ≥ 44px', layout.rects.every(r => r.h >= 44 && r.w >= 44), layout.rects);
  await shot(page, 'desktop-home');

  // ---------- 点「创意工坊」打开工坊界面、不报错；关掉回到主页再测「设置」 ----------
  await page.click('.home-secondary-btn:nth-of-type(1)');
  await page.waitForTimeout(150);
  const wsOpen = await ev(page, () => { const r = document.querySelector('.ws-root'); return !!r && !r.hidden; });
  check('点「创意工坊」打开工坊界面，不报页面错误', wsOpen && errors.length === 0, { wsOpen, errors });
  await ev(page, () => { if (BR.workshopUI && typeof BR.workshopUI.close === 'function') BR.workshopUI.close(); });
  await page.waitForTimeout(100);

  // ---------- 注入 settings.js，点「设置」打开面板 ----------
  await injectSettings(page, base);
  await page.click('.home-secondary-btn:nth-of-type(2)');
  await page.waitForTimeout(150);
  check('点「设置」打开面板', await ev(page, () => !document.querySelector('.set-root').hidden));
  await shot(page, 'desktop-panel-open');

  // ---------- 实体上限：滑到 45，检查 BR.config.world.maxActiveEntities 实时生效 ----------
  await ev(page, () => {
    const el = document.querySelectorAll('.set-range')[0];
    el.value = '45'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('实体上限滑条改动 → BR.config.world.maxActiveEntities 实时生效', await ev(page, () => BR.config.world.maxActiveEntities === 45),
    await ev(page, () => BR.config.world.maxActiveEntities));

  // ---------- 音量四项：monkeypatch 接口，确认被正确调用（含还没实现的 coop.setVoiceVolume） ----------
  await ev(page, () => {
    window.__spy = { master: [], ambient: [], sfx: [], voice: [] };
    const A = BR.audio;
    A.setMaster = v => __spy.master.push(v);
    A.setAmbientVolume = v => __spy.ambient.push(v);
    A.setSfxVolume = v => __spy.sfx.push(v);
    if (!BR.coop) BR.coop = {};
    BR.coop.setVoiceVolume = v => __spy.voice.push(v);   // 真实接口由工坊核心代理加，这里只验证"存在就调用"的契约
  });
  // 四个音量滑条紧跟在"实体上限"后面：总音量、环境音量、音效音量、语音音量
  await ev(page, () => {
    const rs = document.querySelectorAll('.set-range');
    [1, 2, 3, 4].forEach((idx, i) => {
      rs[idx].value = String(60 + i * 5);
      rs[idx].dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const spy = await ev(page, () => __spy);
  check('总音量改动 → BR.audio.setMaster 被调用', spy.master.length > 0 && Math.abs(spy.master[spy.master.length - 1] - 0.6) < 1e-6, spy.master);
  check('环境音量改动 → BR.audio.setAmbientVolume 被调用', spy.ambient.length > 0 && Math.abs(spy.ambient[spy.ambient.length - 1] - 0.65) < 1e-6, spy.ambient);
  check('音效音量改动 → BR.audio.setSfxVolume 被调用', spy.sfx.length > 0 && Math.abs(spy.sfx[spy.sfx.length - 1] - 0.7) < 1e-6, spy.sfx);
  check('语音音量改动 → BR.coop.setVoiceVolume 被调用（存在性判断后调用）', spy.voice.length > 0 && Math.abs(spy.voice[spy.voice.length - 1] - 0.75) < 1e-6, spy.voice);

  // ---------- 视角灵敏度：拖到 2.0x ----------
  await ev(page, () => {
    const rs = document.querySelectorAll('.set-range');
    rs[5].value = '20'; rs[5].dispatchEvent(new Event('input', { bubbles: true }));   // 第 6 条滑条 = 灵敏度，单位 0.1
  });
  check('视角灵敏度改动 → BR.input.sensitivity 实时生效', Math.abs(await ev(page, () => BR.input.sensitivity) - 2.0) < 1e-6,
    await ev(page, () => BR.input.sensitivity));

  // ---------- 画质：点「低」 ----------
  await page.click('.set-seg-btn:nth-of-type(1)');
  check('画质改动 → BR.game.settings.quality / BR.gfx.quality 实时生效', await ev(page, () => BR.game.settings.quality === 'low' && BR.gfx.quality === 'low'),
    await ev(page, () => ({ settings: BR.game.settings.quality, gfx: BR.gfx.quality })));

  // ---------- 默认能见度：最后一条滑条 ----------
  await ev(page, () => {
    const rs = document.querySelectorAll('.set-range');
    rs[rs.length - 1].value = '40'; rs[rs.length - 1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('默认能见度改动 → BR.game.settings.visibility 实时生效', Math.abs(await ev(page, () => BR.game.settings.visibility) - 0.4) < 1e-6,
    await ev(page, () => BR.game.settings.visibility));

  // ---------- 刷新后保持 ----------
  // settings.js 还没接进 index.html（正式接入后每次加载都会跑），刷新后要重新注入才能验证它启动时自动应用 localStorage 里的值
  await page.reload();
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await injectSettings(page, base);
  const persisted = await ev(page, () => ({
    maxActiveEntities: BR.config.world.maxActiveEntities,
    quality: BR.game.settings.quality,
    visibility: BR.game.settings.visibility,
    raw: JSON.parse(localStorage.getItem('backrooms_settings_v1')),
  }));
  check('刷新后：BR.config.world.maxActiveEntities 保持', persisted.maxActiveEntities === 45, persisted.maxActiveEntities);
  check('刷新后：BR.game.settings.quality 保持', persisted.quality === 'low', persisted.quality);
  check('刷新后：BR.game.settings.visibility 保持', Math.abs(persisted.visibility - 0.4) < 1e-6, persisted.visibility);
  check('刷新后：localStorage[backrooms_settings_v1] 里各项都存到位', persisted.raw && persisted.raw.maxActiveEntities === 45
    && Math.abs(persisted.raw.masterVolume - 0.6) < 1e-6 && Math.abs(persisted.raw.ambientVolume - 0.65) < 1e-6
    && Math.abs(persisted.raw.sfxVolume - 0.7) < 1e-6 && Math.abs(persisted.raw.voiceVolume - 0.75) < 1e-6
    && Math.abs(persisted.raw.sensitivity - 2.0) < 1e-6 && persisted.raw.quality === 'low' && Math.abs(persisted.raw.visibility - 0.4) < 1e-6,
    persisted.raw);

  // ---------- 恢复默认（settings.js 已经在本页注入过，不用重新注入） ----------
  await ev(page, () => BR.settingsUI.open());
  await page.waitForTimeout(100);
  await page.click('.set-btn');
  const reset = await ev(page, () => ({
    maxActiveEntities: BR.config.world.maxActiveEntities,
    quality: BR.game.settings.quality,
    visibility: BR.game.settings.visibility,
    sensitivity: BR.input.sensitivity,
    raw: JSON.parse(localStorage.getItem('backrooms_settings_v1')),
  }));
  check('恢复默认：全部字段回到默认值', reset.maxActiveEntities === 28 && reset.quality === 'high' && Math.abs(reset.visibility - 0.7) < 1e-6
    && Math.abs(reset.sensitivity - 1) < 1e-6 && reset.raw.maxActiveEntities === 28 && reset.raw.quality === 'high',
    reset);

  // ---------- 关闭：Esc 和点背景都能关 ----------
  await ev(page, () => BR.settingsUI.open());
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  check('Esc 关闭设置面板', await ev(page, () => document.querySelector('.set-root').hidden));

  await ctx.close();
}

// =====================================================================
// 手机竖屏 390×844 触屏
// =====================================================================
async function mobile(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await newPage(ctx, 'mobile');
  await boot(page, base);

  const layout = await ev(page, () => {
    const play = document.querySelector('.home-play').getBoundingClientRect();
    const title = document.querySelector('.home-title').getBoundingClientRect();
    const btns = Array.from(document.querySelectorAll('.home-secondary-btn')).map(b => b.getBoundingClientRect())
      .map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }));
    return { play: { y: play.y, bottom: play.bottom, right: play.right }, title: { bottom: title.bottom }, btns, vw: innerWidth, vh: innerHeight };
  });
  check('手机竖屏：两个按钮点击目标 ≥ 44px', layout.btns.every(r => r.h >= 44 && r.w >= 44), layout.btns);
  check('手机竖屏：两个按钮在「游玩」上方，不挡标题', layout.btns.every(r => r.bottom <= layout.play.y + 1 && r.y >= layout.title.bottom), layout);
  check('手机竖屏：两个按钮都在视口内', layout.btns.every(r => r.right <= layout.vw && r.bottom <= layout.vh), layout);
  await shot(page, 'mobile-home');

  await ctx.close();
}

main();
