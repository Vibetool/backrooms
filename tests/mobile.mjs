// 后室 · 移动端回归：node tests/mobile.mjs [设备,...] [--sec 段名,...]
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），按移动端适配计划的 mobileTestPlan 逐项检查 A–E 五批修复：
//   A 游戏内触屏操作与 HUD、B 联机大厅与麦克风、C 主页与设置、D 创意工坊触屏、E 返回键 / 视野 / 上下文丢失 / 性能。
// 设备矩阵 6 台（isMobile + hasTouch，每台单独 context、串行跑），外加 1 台桌面参照（1280×800 鼠标键盘，只查 Esc 这类桌面行为）。
// 多指触摸走 CDP Input.dispatchTouchEvent。iPhone 安全区用 CDP Emulation.setSafeAreaInsetsOverride 注入：覆盖只在发出它的 CDP 会话里生效，
// 所以每个 context 只建一个会话，注入、触摸都复用它；每次进页面实测 env(safe-area-inset-*)，没取到注入值时相关检查标 SKIP。
// 联机一律用页面内的 BR.net / BR.coop 桩，不建真实 WebRTC；所有非 127.0.0.1 请求都拦截并记进 blocked，blocked 非空算失败。
// 不出图；每台设备的数值结果写 tests/output/mobile/<设备>.json。任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
// 可选参数：设备名只跑这几台；--sec game,coop 只跑这几段（调试用，all.mjs 不带参数全跑）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'mobile');
fs.mkdirSync(OUT, { recursive: true });

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const secAt = argv.indexOf('--sec');
const SEC = secAt >= 0 && argv[secAt + 1] ? new Set(argv[secAt + 1].split(',')) : null;
const DEV_ARGS = argv.filter((a, i) => !a.startsWith('--') && !(secAt >= 0 && i === secAt + 1)).flatMap(a => a.split(',')).filter(Boolean);

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};
// 返回键类检查先打开一个同源空白页：返回键要是把页面退掉了，能从 pathname 看出来
const BLANK = '<!doctype html><meta charset="utf-8"><title>blank</title>';
function startServer() {
  const srv = http.createServer((req, res) => {
    let u;
    try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (u === '/__blank.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(BLANK); return; }
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
const skipped = [];
function brief(detail) {
  if (detail === undefined) return '';
  const s = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return '  ' + (s && s.length > 900 ? s.slice(0, 900) + '…' : s);
}
function check(dev, name, ok, detail) {
  results.push({ dev, name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + dev + '] ' + name + brief(detail));
}
function skip(dev, name, why) {
  skipped.push({ dev, name, why });
  console.log('SKIP [' + dev + '] ' + name + '  ' + why);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- 设备矩阵 ----------
const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  // iPadOS 默认发桌面 Safari 的 UA，靠 maxTouchPoints 区分
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  wx: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.60(0x18003c2f) NetType/WIFI Language/zh_CN',
};
const DEVICES = {
  'iphone-p': { w: 402, h: 874, dpr: 3, ua: UA.ios, phone: true, insets: { top: 62, bottom: 34, left: 0, right: 0 } },
  'iphone-l': { w: 874, h: 402, dpr: 3, ua: UA.ios, phone: true, insets: { top: 0, bottom: 21, left: 62, right: 62 } },
  'android-p': { w: 360, h: 640, dpr: 2, ua: UA.android, phone: true, blankFirst: true },
  'android-l': { w: 640, h: 360, dpr: 2, ua: UA.android, phone: true },
  'ipadmini-p': { w: 744, h: 1133, dpr: 2, ua: UA.mac, ipad: true },
  'ipadair-l': { w: 1180, h: 820, dpr: 2, ua: UA.mac, ipad: true },
  // 桌面参照：不开触屏模拟，确认移动端改动没带坏鼠标键盘行为
  desktop: { w: 1280, h: 800, dpr: 1, desktop: true },
};

// ---------- 页面内工具（addInitScript 注入，每次导航都在页面脚本之前跑） ----------
function installHelpers() {
  const R = v => Math.round(v * 10) / 10;
  const rb = el => {
    const r = el.getBoundingClientRect();
    return { l: R(r.left), t: R(r.top), r: R(r.right), b: R(r.bottom), w: R(r.width), h: R(r.height), cx: R(r.left + r.width / 2), cy: R(r.top + r.height / 2) };
  };
  const q = s => (typeof s === 'string' ? document.querySelector(s) : s);
  const M = {
    q,
    qa: s => Array.from(document.querySelectorAll(s)),
    box(s) { const el = q(s); return el ? rb(el) : null; },
    cls(el) { if (!el) return null; const c = el.getAttribute && el.getAttribute('class'); return c || el.nodeName; },
    vis(s) {
      const el = q(s);
      if (!el || !el.isConnected) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
        if (n.hidden) return false;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    },
    // 元素中心点的最上层元素是不是它自己（或子孙）
    hit(s) {
      const el = q(s);
      if (!el) return { ok: false, by: 'missing', b: null };
      const b = rb(el);
      if (b.cx < 0 || b.cy < 0 || b.cx >= innerWidth || b.cy >= innerHeight) return { ok: false, by: 'offscreen', b };
      const h = document.elementFromPoint(b.cx, b.cy);
      const ok = !!h && (h === el || el.contains(h));
      return { ok, by: ok ? null : M.cls(h), b };
    },
    inter(a, b, eps) {
      eps = eps == null ? 0.5 : eps;
      return !!a && !!b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > eps && Math.min(a.b, b.b) - Math.max(a.t, b.t) > eps;
    },
    inView(b, ins) {
      ins = ins || { t: 0, r: 0, b: 0, l: 0 };
      return !!b && b.l >= ins.l - 0.5 && b.t >= ins.t - 0.5 && b.r <= innerWidth - ins.r + 0.5 && b.b <= innerHeight - ins.b + 0.5;
    },
    find(sel, text) {
      const want = text == null ? null : String(text).replace(/\s+/g, '');
      return M.qa(sel).find(e => M.vis(e) && (want == null || e.textContent.replace(/\s+/g, '').indexOf(want) >= 0)) || null;
    },
    findExact(sel, text) { return M.qa(sel).find(e => M.vis(e) && e.textContent.trim() === text) || null; },
    // ---- 创意工坊俯视换算 ----
    w2c(x, z) {
      const rect = document.querySelector('.ws-stage').getBoundingClientRect();
      const v = new THREE.Vector3(x, 0, z).project(BR.gfx.camera);
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (1 - (v.y * 0.5 + 0.5)) * rect.height };
    },
    s2w(px, py) {
      const cam = BR.gfx.camera;
      cam.updateMatrixWorld(true);
      const rect = document.querySelector('.ws-stage').getBoundingClientRect();
      const p = new THREE.Vector3(((px - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam);
      const d = p.sub(cam.position).normalize();
      const t = -cam.position.y / d.y;
      return { x: cam.position.x + d.x * t, z: cam.position.z + d.z * t };
    },
    // 离 (px,py) 最近、四周 26px 都落在舞台上的空白点
    free(px, py) {
      const st = document.querySelector('.ws-stage');
      const pts = [];
      for (let fy = 0.1; fy < 0.92; fy += 0.03) for (let fx = 0.06; fx < 0.94; fx += 0.03) pts.push([fx * innerWidth, fy * innerHeight]);
      const X = px != null ? px : innerWidth * 0.4, Y = py != null ? py : innerHeight * 0.42;
      pts.sort((a, b) => Math.hypot(a[0] - X, a[1] - Y) - Math.hypot(b[0] - X, b[1] - Y));
      for (const [x, y] of pts) {
        if ([[0, 0], [-26, 0], [26, 0], [0, -26], [0, 26]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === st)) return { x: Math.round(x), y: Math.round(y) };
      }
      return null;
    },
    cam() {
      const c = BR.gfx.camera;
      return { x: +c.position.x.toFixed(3), y: +c.position.y.toFixed(3), z: +c.position.z.toFixed(3), upY: c.up.y, fov: +c.fov.toFixed(2), near: +c.near.toFixed(3), qx: +c.quaternion.x.toFixed(4), qy: +c.quaternion.y.toFixed(4), qw: +c.quaternion.w.toFixed(4) };
    },
    hookRender() {
      if (window.__rendOrig) return;
      const r = BR.gfx.renderer, orig = r.render;
      window.__rendOrig = orig;
      window.__rend = [];
      r.render = function (s, c) {
        orig.call(r, s, c);
        window.__rend.push({ near: +c.near.toFixed(3), upY: c.up.y, tri: r.info.render.triangles, screen: BR.game.screen });
        if (window.__rend.length > 30) window.__rend.shift();
      };
    },
    unhookRender() { if (window.__rendOrig) { BR.gfx.renderer.render = window.__rendOrig; window.__rendOrig = null; } },
    lastRender(n) { return (window.__rend || []).slice(-(n || 1)); },
  };
  window.__m = M;
}

// 记下 coop.js 注册到 BR.net 上的监听：联机桩直接派发 connected / msg 等事件，不建真实连接
function hookNet() {
  const br = window.BR || {};
  let net;
  Object.defineProperty(br, 'net', {
    configurable: true, enumerable: true,
    get() { return net; },
    set(n) {
      net = n;
      window.__netL = window.__netL || [];
      if (n && typeof n.on === 'function') { const on = n.on; n.on = function (fn) { window.__netL.push(fn); return on.call(n, fn); }; }
    },
  });
  window.BR = br;
}
function fakeIpadTouch() {
  try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true }); } catch (e) { /* 忽略 */ }
}
// 记下经 BR.hud.toast 发出的提示（main.js 的横屏提示、上下文恢复提示都走这里）
function hookToast() {
  if (window.__toasts) return 0;
  window.__toasts = [];
  const o = BR.hud.toast;
  BR.hud.toast = function (t) { window.__toasts.push(String(t)); return o.apply(this, arguments); };
  return 0;
}
// 页面里 env(safe-area-inset-*) 的实测值：CDP 注入成功不代表 env() 取到了（换一个 CDP 会话发触摸，env() 就变回 0）
function envInsets() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  d.remove();
  return r;
}

// ---------- CDP 多指触摸 ----------
// touchStart / touchMove 带上全部按着的手指；touchEnd 只列要抬起的那根（与 A–E 批探针同一写法，已在本机 Chrome 实测）
function toucher(cdp) {
  const active = new Map();
  let nextId = 100;
  const pt = (id, p) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });
  const all = () => [...active.entries()].map(([id, p]) => pt(id, p));
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    async down(id, x, y) { active.set(id, { x, y }); await send('touchStart', all()); },
    async move(id, x, y) { active.set(id, { x, y }); await send('touchMove', all()); },
    async moveMany(list) { for (const [id, x, y] of list) active.set(id, { x, y }); await send('touchMove', all()); },
    async up(id) { const p = active.get(id); if (!p) return; active.delete(id); await send('touchEnd', [pt(id, p)]); },
    async upAll() { if (!active.size) return; active.clear(); await send('touchEnd', []); },
    async tap(x, y) { const id = nextId++; await this.down(id, x, y); await this.up(id); },
    async drag(x0, y0, x1, y1, n, gap) {
      const id = nextId++;
      await this.down(id, x0, y0);
      for (let i = 1; i <= n; i++) { await this.move(id, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); if (gap) await sleep(gap); }
      await this.up(id);
    },
  };
}

// ---------- 设备会话 ----------
async function openDevice(browser, base, key) {
  const dev = DEVICES[key];
  const ctx = await browser.newContext(dev.desktop ? { viewport: { width: dev.w, height: dev.h } }
    : { viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true, userAgent: dev.ua });
  await ctx.addInitScript(installHelpers);
  await ctx.addInitScript(hookNet);
  if (dev.ipad) await ctx.addInitScript(fakeIpadTouch);
  const blocked = [], requests = [];
  // 只放行本地静态服务；联机信令、房间服务器等外网请求一律拦下记账
  await ctx.route('**/*', route => {
    const url = route.request().url();
    let u = null;
    try { u = new URL(url); } catch (e) { /* 忽略 */ }
    if (u && (u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:')) { requests.push(url); return route.continue(); }
    blocked.push(url.slice(0, 200));
    return route.abort();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errs = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const s = '[' + key + '] console.error: ' + m.text() + ' @ ' + (m.location().url || '');
    errs.push(s); errors.push(s);
  });
  page.on('pageerror', e => { const s = '[' + key + '] pageerror: ' + (e.stack || e.message); errs.push(s); errors.push(s); });
  // 整个 context 只建这一个 CDP 会话：安全区覆盖、触摸模拟、触摸事件都走它（另开会话后页面里 env() 取不到覆盖值）
  const cdp = await ctx.newCDPSession(page);
  if (!dev.desktop) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let insetsOk = null, insetsErr = null;
  if (dev.insets) {
    const ins = {};
    for (const k of ['top', 'left', 'bottom', 'right']) { ins[k] = dev.insets[k] || 0; ins[k + 'Max'] = dev.insets[k] || 0; }
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: ins }); insetsOk = true; }
    catch (e) { insetsOk = false; insetsErr = String(e && e.message || e); }
  }
  // envOk：页面里 env(safe-area-inset-*) 真取到了注入值（boot 时实测），安全区相关检查只认它
  const D = { key, dev, base, ctx, page, cdp, blocked, requests, errs, insetsOk, insetsErr, env: null, envOk: false, envWhy: insetsOk ? '' : '安全区注入不可用：' + insetsErr, t: toucher(cdp), data: { insetsOk, insetsErr, fallbacks: [], timing: {} } };
  D.ev = (fn, arg) => page.evaluate(fn, arg);
  D.step = s => page.evaluate(x => { __br.step(x); return 0; }, s);
  D.check = (name, ok, detail) => check(key, name, ok, detail);
  D.skip = (name, why) => skip(key, name, why);
  if (dev.insets && !insetsOk) console.log('SKIP [' + key + '] 安全区注入不可用：' + insetsErr);
  return D;
}

async function boot(D, blankFirst) {
  if (blankFirst) await D.page.goto(D.base + '__blank.html');
  await D.page.goto(D.base + 'index.html');
  await D.page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown && BR.workshopUI, null, { timeout: 60000 });
  await D.ev(() => { BR.assets.init(); try { localStorage.removeItem('backrooms_workshop_v1'); } catch (e) { /* 忽略 */ } return 0; });
  await D.ev(hookToast);
  if (D.dev.insets) await measureEnv(D);
  await sleep(800);   // 等 GLB 替换兜底人形、主页镜头摆好
}

// 每次进页面实测一次安全区：只有 env() 真取到注入值时，A1 C5 D12 的安全区检查才算数，否则标 SKIP
async function measureEnv(D) {
  const want = D.dev.insets;
  const env = await D.ev(envInsets);
  const near = (a, b) => Math.abs(a - (b || 0)) < 1;
  const ok = !!D.insetsOk && env.b > 0 && near(env.t, want.top) && near(env.r, want.right) && near(env.b, want.bottom) && near(env.l, want.left);
  if (!D.data.env || ok !== D.envOk) console.log((ok ? 'INFO' : 'SKIP') + ' [' + D.key + '] 页面实测 env(safe-area-inset-*) = ' + JSON.stringify(env) + (ok ? '，与注入值一致' : '，安全区相关检查将跳过'));
  D.env = env;
  D.envOk = ok;
  D.envWhy = !D.insetsOk ? '安全区注入不可用：' + D.insetsErr : ok ? '' : '注入成功但页面里 env(safe-area-inset-*) 没取到注入值：' + JSON.stringify(env);
  D.data.env = { env, ok };
}

function waitFor(D, fn, timeout, arg) {
  return D.page.waitForFunction(fn, arg, { timeout: timeout || 10000 }).then(() => true, () => false);
}

// 按元素中心点触摸一下。中心点被别的元素挡住时退回 DOM click（只用于导航步骤，挡没挡由各检查自己判），并记进 fallbacks
async function press(D, sel, text, opts) {
  opts = opts || {};
  const arg = { sel, text: text == null ? null : text, exact: !!opts.exact };
  const p = await D.ev(a => {
    const el = a.text == null ? __m.find(a.sel, null) : (a.exact ? __m.findExact(a.sel, a.text) : __m.find(a.sel, a.text));
    if (!el) return null;
    const h = __m.hit(el);
    return { ok: h.ok, by: h.by, x: h.b ? h.b.cx : null, y: h.b ? h.b.cy : null };
  }, arg);
  if (!p) throw new Error('找不到可见的 ' + sel + (text != null ? '「' + text + '」' : ''));
  if (p.ok) await D.t.tap(p.x, p.y);
  else {
    D.data.fallbacks.push(sel + (text != null ? ' ' + text : '') + ' ← ' + p.by);
    await D.ev(a => {
      const el = a.text == null ? __m.find(a.sel, null) : (a.exact ? __m.findExact(a.sel, a.text) : __m.find(a.sel, a.text));
      if (el) el.click();
      return 0;
    }, arg);
  }
  if (opts.wait) await sleep(opts.wait);
  return p;
}

// 段失败后的恢复：抬起手指、复原视口、重新载入页面，保证下一段从干净的主页开始
async function recover(D) {
  try { await D.t.upAll(); } catch (e) { /* 忽略 */ }
  try {
    const vp = D.page.viewportSize();
    if (!vp || vp.width !== D.dev.w || vp.height !== D.dev.h) await D.page.setViewportSize({ width: D.dev.w, height: D.dev.h });
    await boot(D, false);
  } catch (e) {
    console.log('  [' + D.key + '] 恢复失败：' + String(e && e.message || e).slice(0, 200));
  }
}

async function phase(D, name, fn) {
  if (SEC && !SEC.has(name)) return;
  const t0 = Date.now();
  try { await fn(D); }
  catch (err) {
    D.check(name + ' 段流程未中断', false, String(err && err.stack || err).slice(0, 900));
    await recover(D);
  }
  D.data.timing[name] = Date.now() - t0;
  console.log('  (' + D.key + ' ' + name + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
}

// 段内小节：出错只记一条失败，抬起手指、把游戏拉回 playing，后面的小节照常跑
async function sub(D, name, fn) {
  try { await fn(); }
  catch (err) {
    D.check(name + ' 流程未中断', false, String(err && err.stack || err).slice(0, 700));
    try {
      await D.t.upAll();
      await D.ev(restoreCoopDesc);
      await D.ev(() => {
        if (BR.hud.paused) BR.hud.pause(false);
        if (BR.game.screen === 'dead') BR.bus.emit('death:continue');
        if (BR.test && BR.test.isOpen) BR.test.close();
        __br.step(0.1);
        return 0;
      });
    } catch (e) { /* 交给段级恢复 */ }
  }
}

async function goHome(D) {
  await D.t.upAll();
  const scr = await D.ev(() => BR.game.screen);
  if (scr !== 'home') {
    await D.ev(() => {
      if (BR.coop && BR.coop.active) { try { BR.coop.leave(); } catch (e) { /* 忽略 */ } }
      if (BR.hud.paused) BR.hud.pause(false);
      if (BR.test && BR.test.isOpen) BR.test.close();
      BR.bus.emit('game:home');
      return 0;
    });
    await waitFor(D, () => BR.game.screen === 'home' && BR.home.shown, 15000);
    await sleep(500);   // game:home 会 history.back() 退掉开局哨兵，等 popstate 落地
  }
  await D.ev(() => { __br.setAuto(true); return 0; });
}

async function startGame(D, opts) {
  await D.ev(o => { __br.setAuto(false); __br.start(o); return 0; }, opts);
  await D.page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 90000 });
  await D.step(0.2);
}

async function ensureCasual(D) {
  const s = await D.ev(() => ({ screen: BR.game.screen, mode: BR.game.mode, lv: String(BR.game.levelId) }));
  if (s.screen === 'playing' && s.mode === 'casual' && s.lv === '0') { await D.ev(() => { __br.setAuto(false); return 0; }); return; }
  await goHome(D);
  await startGame(D, { mode: 'casual', levelId: '0', seed: 11 });
}

// 结算保护期靠 setTimeout 解除，SwiftShader 忙时会晚到：等 .death-armed 出现再点，不用固定延时
async function waitArmed(D) {
  await D.page.waitForFunction(() => { const r = document.querySelector('.death-root'); return !!r && r.classList.contains('death-armed'); }, null, { timeout: 15000 });
  await sleep(40);
}

function restoreCoopDesc() {
  if (!window.__coopDesc) return 0;
  const c = BR.coop;
  for (const k in window.__coopDesc) { if (window.__coopDesc[k]) Object.defineProperty(c, k, window.__coopDesc[k]); else delete c[k]; }
  if (window.__coopSetMic) c.setMic = window.__coopSetMic;
  window.__coopDesc = null;
  window.__coopSetMic = null;
  return 0;
}

// ---------- 主页弹窗 ----------
async function openMenu(D) {
  await press(D, '.home-play');
  if (!await waitFor(D, () => !!document.querySelector('.home-modal:not([hidden]) .home-dialog-menu'), 8000)) throw new Error('「游玩」菜单没打开');
  await sleep(350);
}
async function openDialog(D, kind) {
  await openMenu(D);
  await press(D, '.home-menu-btn.is-' + kind);
  if (!await waitFor(D, k => !!document.querySelector('.home-modal:not([hidden]) .home-dialog-' + k), 8000, kind)) throw new Error(kind + ' 弹窗没打开');
  await sleep(450);   // 等弹出过渡结束再量矩形
}
async function closeModals(D) {
  for (let i = 0; i < 5; i++) {
    const open = await D.ev(() => { const m = document.querySelector('.home-modal'); return !!m && !m.hidden; });
    if (!open) return;
    await D.ev(() => { const c = document.querySelector('.home-modal:not([hidden]) .home-close'); if (c) c.click(); return 0; });
    await sleep(450);
  }
}

function dlgLayout(sel) {
  const d = document.querySelector(sel);
  const R = el => { const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) }; };
  const dr = R(d);
  const within = r => r.t >= dr.t - 0.5 && r.b <= dr.b + 0.5 && r.l >= dr.l - 0.5 && r.r <= dr.r + 0.5;
  const info = el => {
    if (!el) return null;
    const r = R(el);
    const e = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2);
    return {
      r, within: within(r), inVp: r.t >= -0.5 && r.b <= innerHeight + 0.5 && r.l >= -0.5 && r.r <= innerWidth + 0.5,
      hitSelf: !!e && (e === el || el.contains(e)), visiblePx: +Math.max(0, Math.min(r.b, dr.b) - Math.max(r.t, dr.t)).toFixed(1), h: +(r.b - r.t).toFixed(1),
    };
  };
  return { dlg: dr, st: d.scrollTop, ch: d.clientHeight, sh: d.scrollHeight, sw: d.scrollWidth, cw: d.clientWidth, docSW: document.documentElement.scrollWidth, iw: innerWidth, start: info(d.querySelector('.home-btn-primary')) };
}
function selectCheck(sel) {
  const d = document.querySelector(sel), s = d.querySelector('.home-select'), a = d.querySelector('.home-actions');
  if (!s || !a) return { missing: !s ? 'home-select' : 'home-actions' };
  const sr = s.getBoundingClientRect(), ar = a.getBoundingClientRect(), dr = d.getBoundingClientRect();
  const e = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
  return { st: d.scrollTop, selBottom: +sr.bottom.toFixed(1), actTop: +ar.top.toFixed(1), notCovered: sr.bottom <= ar.top + 0.5, hitSelf: e === s, selWithin: sr.top >= dr.top - 0.5 && sr.bottom <= dr.bottom + 0.5 };
}
function scrollTo(a) { const d = document.querySelector(a.sel); d.scrollTop = a.top === 'max' ? d.scrollHeight : a.top; return d.scrollTop; }
function rangeSnap(box) {
  const b = document.querySelector(box);
  const inps = Array.from(b.querySelectorAll('input[type=range]'));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('backrooms_settings_v1') || 'null'); } catch (e) { /* 忽略 */ }
  return {
    st: Math.round(b.scrollTop), values: inps.map(i => i.value), savedMax: saved && saved.maxActiveEntities,
    game: { visibility: BR.game.settings.visibility, spawnSlider: BR.game.settings.spawnSlider, maxActiveEntities: BR.config.world.maxActiveEntities },
  };
}
function resetRanges(a) {
  const b = document.querySelector(a.box);
  b.scrollTop = 0;
  const inps = Array.from(b.querySelectorAll('input[type=range]'));
  a.values.forEach((v, i) => { if (inps[i] && inps[i].value !== v) { inps[i].value = v; inps[i].dispatchEvent(new Event('input', { bubbles: true })); } });
  return 0;
}
// 从滑条左侧 24px 处起手拖动：dy 竖向位移，fracTo 给了就横拖到滑条宽度的这个比例
async function swipeRange(D, box, idx, dy, fracTo) {
  const r = await D.ev(a => {
    const i = document.querySelectorAll(a.box + ' input[type=range]')[a.idx];
    const rc = i.getBoundingClientRect();
    const e = document.elementFromPoint(rc.left + 24, rc.top + rc.height / 2);
    return { x: rc.left, y: rc.top, w: rc.width, h: rc.height, hit: e === i };
  }, { box, idx });
  const x0 = r.x + 24, y0 = r.y + r.h / 2;
  const x1 = fracTo == null ? x0 : r.x + r.w * fracTo;
  await D.t.drag(x0, y0, x1, y0 + dy, 16, 16);
  await sleep(500);
  return { from: [Math.round(x0), Math.round(y0)], to: [Math.round(x1), Math.round(y0 + dy)], startHit: r.hit };
}

// =====================================================================
// 通用 / 主页 / 设置（G、C、部分 B、E6、E9）
// =====================================================================
async function secBasics(D) {
  const { key, dev } = D;
  const b = await D.ev(() => {
    const r = BR.gfx.renderer, gl = r.getContext();
    const sec = document.querySelector('.home-secondary-btn');
    const bg = sec ? getComputedStyle(sec).backgroundColor : '';
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map(Number) : [];
    const en = document.querySelector('.home-title-en');
    return {
      isTouch: BR.input.isTouch, tap: typeof BR.input.tap, pr: +r.getPixelRatio().toFixed(4),
      buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], mp: +(gl.drawingBufferWidth * gl.drawingBufferHeight / 1e6).toFixed(3),
      quality: BR.gfx.quality, dpr: devicePixelRatio, mtp: navigator.maxTouchPoints,
      bg, alpha: parts.length === 4 ? parts[3] : (parts.length ? 1 : null), enSize: en ? parseFloat(getComputedStyle(en).fontSize) : null,
    };
  });
  D.data.basics = b;
  D.check('G1 BR.input.isTouch === true', b.isTouch === true && b.tap === 'function', { isTouch: b.isTouch, tap: b.tap, mtp: b.mtp });
  if (dev.phone) D.check('E6 手机像素比仍为 1.5', b.pr === 1.5, b);
  if (key === 'ipadair-l') D.check('E6 ipadair-l 像素比 1.05–1.2、绘制缓冲 ≤1.25MP', b.pr >= 1.05 && b.pr <= 1.2 && b.mp <= 1.25, b);
  D.check('C3 .home-secondary-btn 底色 alpha ≥0.6', b.alpha != null && b.alpha >= 0.6, b.bg);
  if (dev.phone) D.check('C9 手机 .home-title-en 字号 ≥12px', b.enSize >= 12, b.enSize);
  // E9：首屏贴图请求（assets.init 发起，等它们到路由层）
  let tex = [];
  for (let i = 0; i < 20; i++) {
    tex = D.requests.filter(u => /assets\/tex\//.test(u)).map(u => u.replace(/^.*assets\/tex\//, '').replace(/[?#].*$/, ''));
    if (tex.length) break;
    await sleep(200);
  }
  D.data.firstTex = tex;
  D.check('E9 首屏网络请求中没有 ceiling_light.jpg', tex.length > 0 && !tex.includes('ceiling_light.jpg'), tex);
  if (key === 'iphone-p') {
    const t = await D.ev(() => BR.net.errorText('mic_denied'));
    D.check('B8 iOS UA 下 BR.net.errorText(mic_denied) 含「Safari」', /Safari/.test(t), t);
  }
}

async function secHint(D) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(400);
    samples.push(await D.ev(() => {
      const a = __m.box('.home-hint'), b = __m.box('.home-secondary-actions');
      return { hint: a && [a.l, a.t, a.r, a.b], sec: b && [b.l, b.t, b.r, b.b], hintVis: __m.vis('.home-hint'), over: __m.inter(a, b) };
    }));
  }
  D.data.c4 = samples;
  D.check('C4 360×640 每 400ms 采样 3 次，.home-hint 与 .home-secondary-actions 都不相交', samples.every(s => s.hint && s.sec && !s.over), samples);
}

async function c1(D, full) {
  const SEL = '.home-dialog-casual';
  const vp = D.dev.w + '×' + D.dev.h;
  const L = await D.ev(dlgLayout, SEL);
  D.data.c1 = { L };
  if (full) {
    D.check('C1 ' + vp + '「游玩」弹窗「开始」完整在弹窗可视区内且中心命中', !!L.start && L.start.within && L.start.inVp && L.start.hitSelf && L.start.visiblePx >= L.start.h - 0.5, { start: L.start, dlg: L.dlg, ch: L.ch, sh: L.sh });
    await D.ev(scrollTo, { sel: SEL, top: 'max' });
    await sleep(250);
    const sc = await D.ev(selectCheck, SEL);
    D.data.c1.bottom = sc;
    D.check('C1 ' + vp + ' 弹窗滚到底后 .home-select 不被 .home-actions 遮挡', sc.notCovered && sc.hitSelf && sc.selWithin, sc);
    await D.ev(scrollTo, { sel: SEL, top: 0 });
    await sleep(150);
  }
  if (D.dev.w === 360 || D.dev.w === 402) {
    D.check('C1 ' + D.dev.w + ' 宽下「游玩」弹窗 scrollWidth == clientWidth', L.sw === L.cw && L.docSW <= L.iw, { sw: L.sw, cw: L.cw, docSW: L.docSW, iw: L.iw });
  }
}

async function c2(D) {
  await openDialog(D, 'test');
  const T = await D.ev(dlgLayout, '.home-dialog-test');
  D.check('C2 测试模式弹窗「开始」完整在弹窗可视区内且中心命中', !!T.start && T.start.within && T.start.inVp && T.start.hitSelf && T.start.visiblePx >= T.start.h - 0.5, { start: T.start, ch: T.ch, sh: T.sh });
  await D.ev(scrollTo, { sel: '.home-dialog-test', top: 'max' });
  await sleep(250);
  const sc = await D.ev(selectCheck, '.home-dialog-test');
  D.check('C2 测试模式弹窗滚到底后 .home-select 不被 .home-actions 遮挡', sc.notCovered && sc.hitSelf && sc.selWithin, sc);
  await closeModals(D);
  await openDialog(D, 'nightmare');
  const N = await D.ev(sel => {
    const d = document.querySelector(sel);
    d.scrollTop = d.scrollHeight;
    const dr = d.getBoundingClientRect();
    const notes = d.querySelectorAll('.home-note');
    const n = notes.length ? notes[notes.length - 1].getBoundingClientRect() : null;
    return { ch: d.clientHeight, sh: d.scrollHeight, st: d.scrollTop, notes: notes.length, note: n && [+n.top.toFixed(1), +n.bottom.toFixed(1)], dlg: [+dr.top.toFixed(1), +dr.bottom.toFixed(1)], within: !!n && n.top >= dr.top - 0.5 && n.bottom <= dr.bottom + 0.5 };
  }, '.home-dialog-nightmare');
  D.check('C2 噩梦弹窗滚到底后最后一条 .home-note 在可视区内', N.within, N);
  await closeModals(D);
}

async function c7Home(D) {
  const BOX = '.home-dialog-casual';
  const b0 = await D.ev(rangeSnap, BOX);
  const sw = await swipeRange(D, BOX, 1, -110, null);
  const a1 = await D.ev(rangeSnap, BOX);
  D.check('C7 主页「游玩」弹窗从生成量滑条左侧起手上滑 110px：滑条值和 spawnSlider 不变', sw.startHit && a1.values[1] === b0.values[1] && a1.game.spawnSlider === b0.game.spawnSlider,
    { sw, before: b0.values, after: a1.values, spawn: [b0.game.spawnSlider, a1.game.spawnSlider], scroll: [b0.st, a1.st] });
  await D.ev(resetRanges, { box: BOX, values: b0.values });
  await sleep(150);
  const hz = await swipeRange(D, BOX, 0, 0, 0.3);
  const a2 = await D.ev(rangeSnap, BOX);
  D.check('C7 主页横向拖能见度滑条仍能改值', a2.values[0] !== b0.values[0] && Math.abs(a2.game.visibility - (+a2.values[0]) / 100) < 1e-6, { hz, before: b0.values[0], after: a2.values[0], vis: a2.game.visibility });
  await D.ev(resetRanges, { box: BOX, values: b0.values });
}

async function openSettings(D) {
  await press(D, '.home-secondary-btn', '设置', { exact: true });
  if (!await waitFor(D, () => { const r = document.querySelector('.set-root'); return !!r && !r.hidden; }, 8000)) throw new Error('设置面板没打开');
  await sleep(450);
}
async function closeSettings(D) {
  await press(D, '.set-close');
  await waitFor(D, () => { const r = document.querySelector('.set-root'); return !r || r.hidden; }, 5000);
  await sleep(700);   // × 关闭会 history.back()，等 popstate 落地再读 history.state
}
function setHist() {
  const r = document.querySelector('.set-root');
  return { open: !!r && !r.hidden, path: location.pathname, state: history.state };
}
function setLayout() {
  const p = document.querySelector('.set-panel'), b = p.querySelector('.set-body');
  const br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
  const fields = Array.from(b.querySelectorAll('.set-field'));
  const full = fields.filter(f => { const r = f.getBoundingClientRect(); return r.height > 0 && r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5; }).length;
  const cs = getComputedStyle(p);
  return {
    full, total: fields.length, iw: innerWidth, ih: innerHeight, display: getComputedStyle(b).display,
    panel: { l: +pr.left.toFixed(1), r: +pr.right.toFixed(1), t: +pr.top.toFixed(1), b: +pr.bottom.toFixed(1), w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) },
    body: { ch: b.clientHeight, sh: b.scrollHeight },
    pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
  };
}

async function secSettingsLayout(D) {
  await openSettings(D);
  const S = await D.ev(setLayout);
  D.data.c5 = S;
  if (D.key === 'android-l') D.check('C5 640×360 设置面板完整可见字段 ≥3/8', S.full >= 3, S);
  if (D.key === 'iphone-l') {
    if (D.envOk) {
      D.check('C5 874×402（注入安全区）完整可见字段 ≥5/8', S.full >= 5, Object.assign({ env: D.env }, S));
      D.check('C5 874×402 面板左右边在安全区之内', S.panel.l >= 62 - 0.5 && S.panel.r <= 874 - 62 + 0.5, S.panel);
    } else {
      D.skip('C5 874×402（注入安全区）完整可见字段 ≥5/8', D.envWhy);
      D.skip('C5 874×402 面板左右边在安全区之内', D.envWhy);
    }
  }
  if (D.key === 'iphone-p') D.check('C5 402×874 竖屏抽屉 padding-top ≤20px', parseFloat(S.pad[0]) <= 20, S.pad);
  await closeSettings(D);
}

async function secSettingsAndroidP(D) {
  // C6：返回键只关设置；× 关闭后历史里不留 brPanel
  await openSettings(D);
  const a = await D.ev(setHist);
  await D.ev(() => { setTimeout(() => history.back(), 0); return 0; });
  await sleep(900);
  const b = await D.ev(setHist);
  D.check('C6 打开设置后 history.back()：.set-root 隐藏、pathname 不变', a.open && !b.open && b.path === '/index.html', { a, b });
  await openSettings(D);
  await closeSettings(D);
  const c = await D.ev(setHist);
  D.check('C6 点 × 关闭设置后 history.state 不含 brPanel', !c.open && !(c.state && c.state.brPanel) && c.path === '/index.html', c);
  await backsToLeave(D, 'C6 设置流程结束后');

  // C7：设置面板里从滑条起手竖滑不改值
  await openSettings(D);
  const SB = '.set-body';
  await D.ev(() => { const i = document.querySelectorAll('.set-body input[type=range]')[0]; i.dispatchEvent(new Event('input', { bubbles: true })); return 0; });   // 先存一份当前值，再比存档
  await sleep(150);
  const s0 = await D.ev(rangeSnap, SB);
  const sw = await swipeRange(D, SB, 0, -110, null);
  const s1 = await D.ev(rangeSnap, SB);
  D.check('C7 设置面板从实体上限滑条左侧起手上滑 110px：maxActiveEntities 和 localStorage 都不变', sw.startHit && s1.values[0] === s0.values[0] && s1.game.maxActiveEntities === s0.game.maxActiveEntities && s1.savedMax === s0.savedMax,
    { sw, before: [s0.values[0], s0.game.maxActiveEntities, s0.savedMax], after: [s1.values[0], s1.game.maxActiveEntities, s1.savedMax], scroll: [s0.st, s1.st] });
  await D.ev(scrollTo, { sel: SB, top: 0 });
  await sleep(200);
  const hz = await swipeRange(D, SB, 0, 0, 0.7);
  const s2 = await D.ev(rangeSnap, SB);
  D.check('C7 设置面板横向拖实体上限滑条仍能改值并存档', s2.values[0] !== s0.values[0] && s2.game.maxActiveEntities === +s2.values[0] && s2.savedMax === +s2.values[0],
    { hz, before: s0.values[0], after: [s2.values[0], s2.game.maxActiveEntities, s2.savedMax] });
  await D.ev(resetRanges, { box: SB, values: s0.values });

  // C8：画质切到低出现「立即刷新」；.set-btn 仍只有「恢复默认」（竖屏抽屉矮，先把画质那一行滚进来再真点）
  await D.ev(() => { const b = __m.findExact('.set-seg-btn', '低'); if (b) b.scrollIntoView({ block: 'center' }); return 0; });
  await sleep(250);
  await press(D, '.set-seg-btn', '低', { exact: true });
  await sleep(300);
  const q = await D.ev(() => {
    const btn = document.querySelector('.set-reload');
    if (btn) btn.scrollIntoView({ block: 'nearest' });
    return { vis: __m.vis(btn), hit: btn ? __m.hit(btn).ok : false, setBtns: __m.qa('.set-btn').map(x => x.textContent.trim()), needs: BR.gfx.qualityNeedsReload, quality: BR.game.settings.quality };
  });
  D.check('C8 画质切到「低」后 .set-reload 可见；.set-btn 只有「恢复默认」一个', q.vis && JSON.stringify(q.setBtns) === '["恢复默认"]', q);
  await press(D, '.set-seg-btn', '高', { exact: true });
  await sleep(300);
  const q2 = await D.ev(() => ({ vis: __m.vis('.set-reload'), quality: BR.game.settings.quality, needs: BR.gfx.qualityNeedsReload }));
  D.check('C8 切回「高」后 .set-reload 随提示一起隐藏', !q2.vis && q2.quality === 'high' && !q2.needs, q2);

  // C8「立即刷新」：刷新那一刻栈顶是设置面板的历史记录，刷新后回到无弹层主页，返回键也得 1 次就离开页面
  await press(D, '.set-seg-btn', '低', { exact: true });
  await sleep(300);
  await D.ev(() => { const b = document.querySelector('.set-reload'); if (b) b.scrollIntoView({ block: 'nearest' }); return 0; });
  await sleep(200);
  await Promise.all([D.page.waitForEvent('load', { timeout: 60000 }), press(D, '.set-reload')]);
  await D.page.waitForFunction(() => window.BR && BR.home && BR.home.shown, null, { timeout: 60000 });
  await sleep(800);
  const rl = await D.ev(() => { const r = document.querySelector('.set-root'); return { path: location.pathname, state: history.state, len: history.length, quality: BR.game.settings.quality, gfx: BR.gfx.quality, setOpen: !!r && !r.hidden }; });
  D.check('C8 点「立即刷新」后整页重载：画质为低、设置面板收起、history.state 为 null', rl.quality === 'low' && rl.gfx === 'low' && !rl.setOpen && rl.state === null && rl.path === '/index.html', rl);
  // 画质存档先改回高再离开页面：后面的段都按默认画质跑
  await D.ev(() => { try { const k = 'backrooms_settings_v1', s = JSON.parse(localStorage.getItem(k) || '{}'); s.quality = 'high'; localStorage.setItem(k, JSON.stringify(s)); } catch (e) { /* 忽略 */ } return 0; });
  await backsToLeave(D, 'C8「立即刷新」后');
  const qh = await D.ev(() => BR.gfx.quality);
  if (qh !== 'high') throw new Error('「立即刷新」检查后画质没恢复成高：' + qh);
}

async function secCredits(D) {
  await press(D, '.home-credit');
  const ok = await waitFor(D, () => document.querySelectorAll('.home-credits-list li').length > 5, 10000);
  await sleep(300);
  const c = await D.ev(() => {
    const hs = __m.qa('.home-credits-list li > a:first-child').map(a => a.getBoundingClientRect().height);
    return { n: hs.length, minH: hs.length ? +Math.min(...hs).toFixed(1) : null, maxH: hs.length ? +Math.max(...hs).toFixed(1) : null };
  });
  D.check('C9 署名列表链接最矮 ≥40px', ok && c.n > 0 && c.minH >= 40, c);
  await closeModals(D);
}

// C10 用的 BR.coop 整体替身（主页只读 active / mic / micBusy / setMic）
function installCoopStub() {
  window.__realCoop = BR.coop;
  const st = { active: true, mic: false, busy: false };
  const calls = [];
  window.__stub = { st, calls };
  BR.coop = {
    init() {}, update() {}, leave() {}, openLobby() {}, closeLobby() {},
    setMic(on) {
      calls.push(!!on);
      if (!on) { st.mic = false; st.busy = false; return Promise.resolve(false); }
      st.busy = true;
      return new Promise(() => { /* 申请中，测试里不回 */ });
    },
    get active() { return st.active; }, get role() { return 'guest'; }, get mic() { return st.mic; }, get micBusy() { return st.busy; },
    get phase() { return st.active ? 'active' : 'idle'; }, get peer() { return null; }, get code() { return null; },
  };
  BR.bus.emit('coop:mic', { on: false, busy: false, active: true });
  return 0;
}
function homeMicInfo() {
  const b = document.querySelector('.home-dialog-casual .home-btn-mic');
  const d = document.querySelector('.home-dialog-casual');
  if (!b || !d) return { exists: false };
  const r = b.getBoundingClientRect(), dr = d.getBoundingClientRect();
  const e = b.hidden ? null : document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    exists: true, hidden: b.hidden, text: b.textContent,
    within: r.top >= dr.top - 0.5 && r.bottom <= dr.bottom + 0.5 && r.left >= dr.left - 0.5 && r.right <= dr.right + 0.5,
    hitSelf: !!e && (e === b || b.contains(e)), calls: window.__stub ? window.__stub.calls.slice() : null,
  };
}

async function secHomeIphoneP(D) {
  await openDialog(D, 'casual');
  await c1(D, false);
  try {
    await D.ev(installCoopStub);
    // 主页 0.5 秒轮询会把「已联机 · …」写进 .home-actions 里的状态行，这一行出现会把开麦按钮挤开：
    // 等状态行和按钮都到位再量、再点，免得点在挪位前的旧坐标上
    await waitFor(D, () => {
      const b = document.querySelector('.home-dialog-casual .home-btn-mic'), st = document.querySelector('.home-dialog-casual .home-coop-status');
      return !!b && !b.hidden && !!st && st.textContent.trim().length > 0;
    }, 5000);
    await sleep(250);
    const m0 = await D.ev(homeMicInfo);
    D.check('C10 BR.coop 桩 active 时「游玩」弹窗出现开麦按钮（可见、完整在弹窗内、中心命中）', m0.exists && !m0.hidden && m0.within && m0.hitSelf, m0);
    // 记下这一下触摸的事件链（捕获阶段），点击没生效时能看出断在哪一步
    await D.ev(() => {
      window.__evs = [];
      window.__evOff = [];
      for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click']) {
        const fn = e => window.__evs.push(type + '@' + (e.target && e.target.className || e.target.nodeName) + (e.defaultPrevented ? '!prevented' : ''));
        const late = e => { if (e.defaultPrevented) window.__evs.push(type + ' prevented-by-listener'); };
        window.addEventListener(type, fn, true);
        window.addEventListener(type, late, false);
        window.__evOff.push(() => { window.removeEventListener(type, fn, true); window.removeEventListener(type, late, false); });
      }
      return 0;
    });
    const tapAt = m0.exists && !m0.hidden ? await press(D, '.home-dialog-casual .home-btn-mic') : null;
    await sleep(200);
    const evs = await D.ev(() => { const r = (window.__evs || []).slice(); (window.__evOff || []).forEach(f => f()); window.__evOff = []; return r; });
    const m1 = await D.ev(homeMicInfo);
    D.check('C10 点开麦按钮调用 setMic(true)', !!m1.calls && m1.calls[0] === true, Object.assign({ tapAt, events: evs }, m1));
  } finally {
    await D.ev(() => {
      if (window.__realCoop) { BR.coop = window.__realCoop; window.__realCoop = null; }
      BR.bus.emit('coop:mic', { on: false, busy: false, active: false });
      return 0;
    });
  }
  await closeModals(D);
}

// =====================================================================
// 联机大厅 / 返回键（B1 B2 B3 B7 B8、E1 E2）
// =====================================================================
function lobbyMeasure() {
  const M = __m;
  const card = M.q('.coop-card'), cb = M.box(card);
  const clip = { t: Math.max(cb.t, 0), b: Math.min(cb.b, innerHeight) };
  const within = b => !!b && b.t >= clip.t - 0.5 && b.b <= clip.b + 0.5;
  const yes = M.qa('.coop-lobby button').find(b => b.textContent.trim() === '同意加入');
  const st = M.q('.coop-status'), sub = M.q('.coop-sub');
  const yb = yes ? M.box(yes) : null, sb = M.box(st);
  return {
    vp: innerWidth + 'x' + innerHeight, card: cb, ch: card.clientHeight, sh: card.scrollHeight, scrollTop: Math.round(card.scrollTop),
    subVisible: M.vis(sub), phase: BR.coop.phase,
    yes: yes && M.vis(yes) ? { box: yb, inView: M.inView(yb), inCard: within(yb), hit: M.hit(yes) } : null,
    status: { text: st.textContent, box: sb, inView: M.inView(sb), inCard: within(sb) },
  };
}

async function openLobbyFromCasual(D) {
  await openDialog(D, 'casual');
  await press(D, '.home-dialog-casual .home-actions .home-btn', '联机', { exact: true });
  if (!await waitFor(D, () => __m.vis('.coop-lobby'), 8000)) throw new Error('联机大厅没打开');
  await sleep(350);
}

async function secLobbyConfirm(D) {
  const vp = D.dev.w + '×' + D.dev.h;
  await openLobbyFromCasual(D);
  const open = await D.ev(lobbyMeasure);
  D.data.b2 = open;
  if (D.key === 'android-l') D.check('B2 640×360 打开大厅：.coop-card scrollHeight ≤ clientHeight+10、.coop-sub 可见', open.sh <= open.ch + 10 && open.subVisible, { ch: open.ch, sh: open.sh, sub: open.subVisible });
  // 房间查询桩：6 位房号 → 确认框
  await D.ev(() => {
    BR.net.roomInfo = async () => ({ state: 'waiting', host_name: '房主X', guest_name: '' });
    const i = document.querySelector('.coop-code-input');
    i.value = 'ABC123';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.coop-card').scrollTop = 0;
    return 0;
  });
  await press(D, '.coop-lobby button', '加入', { exact: true });
  const conf = await waitFor(D, () => BR.coop.phase === 'confirm', 8000);
  await sleep(300);
  const cf = await D.ev(lobbyMeasure);
  D.data.b1 = { confirm: cf };
  D.check('B1 ' + vp + ' 输入 ABC123 点「加入」：「同意加入」完全在视口内、中心命中按钮', conf && !!cf.yes && cf.yes.inView && cf.yes.hit.ok, { phase: cf.phase, yes: cf.yes, sh: cf.sh, st: cf.scrollTop });
  // 取消后输 5 位房号：出错状态行要看得见
  await D.ev(() => {
    const cancel = Array.from(document.querySelectorAll('.coop-lobby button')).find(b => b.textContent.trim() === '取消');
    if (cancel) cancel.click();
    return 0;
  });
  await sleep(250);
  await D.ev(() => {
    const i = document.querySelector('.coop-code-input');
    i.value = 'ABC12';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.coop-card').scrollTop = 0;
    const join = Array.from(document.querySelectorAll('.coop-lobby button')).find(b => b.textContent.trim() === '加入');
    if (join) join.click();
    return 0;
  });
  await sleep(350);
  const sh = await D.ev(lobbyMeasure);
  D.data.b1.short = sh;
  D.check('B1 ' + vp + ' 输入 5 位房号：.coop-status 在视口内（且在卡片可视区内）', !!sh.status.text && sh.status.inView && sh.status.inCard, sh.status);
  await press(D, '.coop-close');
  await waitFor(D, () => !__m.vis('.coop-lobby'), 5000);
  await sleep(700);
  await closeModals(D);
}

function histInfo() {
  const m = document.querySelector('.home-modal');
  const d = m && !m.hidden ? m.querySelector('.home-dialog') : null;
  const kind = d ? (Array.from(d.classList).find(c => /^home-dialog-/.test(c)) || 'home-dialog') : null;
  const lob = document.querySelector('.coop-lobby');
  return { path: location.pathname, hasBR: !!window.BR, dialog: kind, lobby: !!lob && !lob.hidden, state: history.state, len: history.length, screen: window.BR && BR.game ? BR.game.screen : null };
}
// 用 setTimeout 发 back：万一真把页面退掉了，evaluate 本身不会卡在导航上
async function goBack(D) {
  await D.ev(() => { setTimeout(() => history.back(), 0); return 0; });
  await sleep(900);
  return D.ev(histInfo).catch(e => ({ err: String(e && e.message || e), path: null }));
}
// 流程收尾、主页没有弹层时连按返回：恰好 1 次就该离开 index.html。多按一次才走 = 历史里留了无效记录，只看单步状态发现不了。
// 离开后重新进页面（先进空白页，下次返回还有地方可退），后面的检查接着用
async function backsToLeave(D, label) {
  const before = await D.ev(histInfo);
  const steps = [];
  let count = -1;
  for (let i = 0; i < 3; i++) {
    const s = await goBack(D);
    steps.push({ path: s.path, state: s.state, dialog: s.dialog, lobby: s.lobby, screen: s.screen });
    if (s.path !== '/index.html') { count = i + 1; break; }
  }
  D.check(label + '：主页无弹层时连按返回，恰好 1 次就离开 /index.html', count === 1, { count, before: { state: before.state, len: before.len, dialog: before.dialog, lobby: before.lobby }, steps });
  await boot(D, true);
}

async function secLobbyBack(D) {
  await openLobbyFromCasual(D);
  const s0 = await D.ev(histInfo);
  const s1 = await goBack(D);
  D.check('B3 主页→游玩→游玩→联机后 history.back() 一次：lobby 隐藏、.home-dialog-casual 仍在、pathname 不变', s0.lobby && !s1.lobby && s1.dialog === 'home-dialog-casual' && s1.path === '/index.html', { s0, s1 });
  const s2 = await goBack(D);
  const s3 = await goBack(D);
  D.check('B3 再 back 两次依次关「游玩」弹窗和菜单，pathname 始终 /index.html', s2.dialog === 'home-dialog-menu' && s3.dialog === null && s2.path === '/index.html' && s3.path === '/index.html', { s2, s3 });
  if (s3.path !== '/index.html') throw new Error('返回键离开了页面');
  D.check('B3 三次返回后回到无弹层主页：history.state 为 null', s3.dialog === null && !s3.lobby && s3.state === null, s3);
  await closeModals(D);
  await backsToLeave(D, 'B3 大厅流程结束后');
}

async function secGameBack(D) {
  // E1 / E2：从主页 UI 开局（不是 __br.start），走 home.hide() 退弹层历史的真实路径
  await openDialog(D, 'casual');
  await press(D, '.home-dialog-casual .home-btn-primary');
  const started = await waitFor(D, () => BR.game.screen === 'playing', 30000);
  const samples = await D.ev(async () => {
    const out = [];
    for (let i = 0; i < 20; i++) { out.push(BR.game.screen); await new Promise(r => setTimeout(r, 100)); }
    return out;
  });
  D.check('E2 从主页 UI 开局后 2 秒内 screen 一直是 playing', started && samples.every(s => s === 'playing'), { started, seen: [...new Set(samples)] });
  const h0 = await D.ev(histInfo);
  const h1 = await goBack(D);
  D.check('E1 游戏中 history.back()：仍在 /index.html 且 screen=paused', h1.path === '/index.html' && h1.screen === 'paused', { h0, h1 });
  const h2 = await goBack(D);
  D.check('E1 暂停中再 back 仍在页内', h2.path === '/index.html' && h2.hasBR && h2.screen === 'paused', h2);
  if (h2.path !== '/index.html') throw new Error('返回键离开了页面');
  await sleep(400);   // 暂停菜单弹出后 250ms 内的点击不响应
  // 两下必须落在 2.5 秒确认窗口内：直接用 CDP 触摸，不走 Playwright 的稳定性等待
  const hb = await D.ev(() => __m.box('.hud-btn-home'));
  await D.t.tap(hb.cx, hb.cy);
  await sleep(150);
  await D.t.tap(hb.cx, hb.cy);
  const home = await waitFor(D, () => BR.game.screen === 'home' && BR.home.shown, 10000);
  await sleep(800);
  const h4 = await D.ev(histInfo);
  D.check('E1 暂停「返回主页」点两下后 screen=home、history.state 不含 brGame', home && h4.screen === 'home' && !(h4.state && h4.state.brGame) && h4.path === '/index.html', h4);
  D.check('E1 回主页后 history.state 为 null（停在开局前那条无弹层的主页记录上）', home && h4.state === null, h4.state);
  await D.ev(() => { __br.setAuto(true); return 0; });
}

// 大厅里以客机身份开局（房主发 world 开局）→ 返回键暂停 → 回主页：大厅、主页弹层、开局哨兵三方的历史记录都得退干净
async function secGuestBack(D) {
  await openLobbyFromCasual(D);
  await D.ev(() => {
    const N = BR.net;
    N.roomInfo = async () => ({ state: 'waiting', host_name: '房主X', guest_name: '' });
    N.joinRoom = async () => '房主X';
    N.send = () => true;
    N.leave = () => {};
    N.resumeAudio = () => {};
    N.setMic = on => Promise.resolve(!!on);
    const i = document.querySelector('.coop-code-input');
    i.value = 'ABC123';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.coop-card').scrollTop = 0;
    return 0;
  });
  await press(D, '.coop-lobby button', '加入', { exact: true });
  if (!await waitFor(D, () => BR.coop.phase === 'confirm', 8000)) throw new Error('点「加入」后没进入确认');
  await sleep(300);
  await press(D, '.coop-lobby button', '同意加入', { exact: true });
  if (!await waitFor(D, () => BR.coop.phase === 'connecting', 8000)) throw new Error('点「同意加入」后没进入连接中');
  const g0 = await D.ev(() => {
    const L = window.__netL || [];
    L.forEach(fn => fn('connected'));
    L.forEach(fn => fn('msg', { t: 'hello', game: 'backrooms', v: BR.config.version, name: '房主X', skin: 'pink' }));
    return { phase: BR.coop.phase, role: BR.coop.role, lobby: __m.vis('.coop-lobby'), state: history.state };
  });
  if (g0.phase !== 'active') throw new Error('客机桩没接通：' + JSON.stringify(g0));
  await D.ev(() => { (window.__netL || []).forEach(fn => fn('msg', { t: 'world', seed: 424242, levelId: '0', settings: {}, picked: [], at: null })); return 0; });
  if (!await waitFor(D, () => BR.game.screen === 'playing', 90000)) throw new Error('客机收到 world 后没开局');
  await D.ev(() => { __br.setAuto(false); __br.step(0.1); return 0; });
  await sleep(2000);   // 开局哨兵要等 home.hide() 退弹层历史的 popstate（或 1 秒兜底）之后才压
  const g1 = await D.ev(histInfo);
  D.check('客机开局：大厅关闭、screen=playing、history.state 为 {brGame:1}', !g1.lobby && g1.screen === 'playing' && !!g1.state && g1.state.brGame === 1 && g1.path === '/index.html', { g0, g1 });
  const g2 = await goBack(D);
  D.check('客机开局后 history.back()：仍在 /index.html 且 screen=paused', g2.path === '/index.html' && g2.screen === 'paused', g2);
  if (g2.path !== '/index.html') throw new Error('返回键离开了页面');
  await sleep(400);   // 暂停菜单弹出后 250ms 内的点击不响应
  const hb = await D.ev(() => __m.box('.hud-btn-home'));
  await D.t.tap(hb.cx, hb.cy);
  await sleep(150);
  await D.t.tap(hb.cx, hb.cy);
  const home = await waitFor(D, () => BR.game.screen === 'home' && BR.home.shown, 15000);
  await sleep(1200);
  const g3 = await D.ev(histInfo);
  D.check('客机暂停「返回主页」点两下后回主页：history.state 为 null', home && g3.screen === 'home' && g3.state === null && g3.path === '/index.html', g3);
  await openMenu(D);
  const g4 = await goBack(D);
  D.check('客机回主页后打开「游玩」菜单，返回一次就关掉菜单', g4.dialog === null && g4.path === '/index.html', g4);
  if (g4.path !== '/index.html') throw new Error('返回键离开了页面');
  await closeModals(D);
  await backsToLeave(D, '客机开局流程结束后');
}

// 桌面：按元素中心点真实鼠标点击
async function mouseClick(D, sel, text) {
  const p = await D.ev(a => {
    const el = a.text == null ? __m.find(a.sel, null) : __m.findExact(a.sel, a.text);
    if (!el) return null;
    const h = __m.hit(el);
    return { ok: h.ok, by: h.by, x: h.b.cx, y: h.b.cy };
  }, { sel, text: text == null ? null : text });
  if (!p) throw new Error('找不到可见的 ' + sel + (text != null ? '「' + text + '」' : ''));
  await D.page.mouse.click(p.x, p.y);
  return p;
}

// 桌面 Esc：大厅盖在「游玩」弹窗上时，Esc 只关大厅（焦点在不在大厅输入框里都一样），之后返回键一步退一层
async function secDesktopEsc(D) {
  for (const inInput of [false, true]) {
    const tag = inInput ? '焦点在大厅输入框' : '焦点不在大厅内';
    await mouseClick(D, '.home-play');
    if (!await waitFor(D, () => !!document.querySelector('.home-modal:not([hidden]) .home-dialog-menu'), 8000)) throw new Error('「游玩」菜单没打开');
    await sleep(350);
    await mouseClick(D, '.home-menu-btn.is-casual');
    if (!await waitFor(D, () => !!document.querySelector('.home-modal:not([hidden]) .home-dialog-casual'), 8000)) throw new Error('「游玩」弹窗没打开');
    await sleep(450);
    await mouseClick(D, '.home-dialog-casual .home-actions .home-btn', '联机');
    if (!await waitFor(D, () => __m.vis('.coop-lobby'), 8000)) throw new Error('联机大厅没打开');
    await sleep(350);
    const focus = await D.ev(f => {
      const a = document.activeElement;
      if (f) { const i = __m.qa('.coop-lobby input').find(x => __m.vis(x)); if (i) i.focus(); }
      else if (a && a !== document.body && a.blur) a.blur();
      const n = document.activeElement;
      return String(n && (n.className || n.nodeName));
    }, inInput);
    const s0 = await D.ev(histInfo);
    await D.page.keyboard.press('Escape');
    await sleep(1100);
    const s1 = await D.ev(histInfo);
    D.check('桌面 大厅开着时按 Esc（' + tag + '）：只关大厅，「游玩」弹窗仍在、history.state 不含 brPanel', s0.lobby && !s1.lobby && s1.dialog === 'home-dialog-casual' && !(s1.state && s1.state.brPanel) && s1.path === '/index.html', { focus, s0, s1 });
    const s2 = await goBack(D);
    D.check('桌面 Esc 关大厅后（' + tag + '）返回一次：「游玩」弹窗退回菜单', s2.dialog === 'home-dialog-menu' && s2.path === '/index.html', s2);
    if (s2.path !== '/index.html') { await boot(D, true); continue; }
    await D.ev(() => { if (__m.vis('.coop-lobby')) BR.coop.closeLobby(); return 0; });
    await sleep(500);
    await closeModals(D);
  }
}

async function secNet(D) {
  // B7：页面里临时删掉 RTCPeerConnection（大厅 renderLobby / createRoom 都是调用时现查）
  const blocked0 = D.blocked.length;
  const r = await D.ev(async () => {
    const saved = { R: window.RTCPeerConnection, W: window.webkitRTCPeerConnection };
    try { delete window.RTCPeerConnection; } catch (e) { /* 忽略 */ }
    try { delete window.webkitRTCPeerConnection; } catch (e) { /* 忽略 */ }
    const out = { type: typeof window.RTCPeerConnection };
    try {
      BR.coop.openLobby();
      await new Promise(res => setTimeout(res, 300));
      const btn = t => Array.from(document.querySelectorAll('.coop-lobby button')).find(b => b.textContent.trim() === t);
      const note = document.querySelector('.coop-note');
      out.noteVis = __m.vis(note);
      out.note = note ? note.textContent : null;
      out.create = btn('创建房间') ? btn('创建房间').disabled : null;
      out.join = btn('加入') ? btn('加入').disabled : null;
      out.cr = await BR.net.createRoom('测试').then(c => ({ ok: true, c }), e => ({ ok: false, code: e && e.code }));
    } finally {
      if (saved.R) window.RTCPeerConnection = saved.R;
      if (saved.W) window.webkitRTCPeerConnection = saved.W;
    }
    return out;
  });
  await sleep(300);
  D.data.b7 = r;
  D.check('B7 删除 RTCPeerConnection 后打开大厅：.coop-note 可见且含「WebRTC」', r.type === 'undefined' && r.noteVis && /WebRTC/.test(r.note || ''), r);
  D.check('B7 「创建房间」「加入」都 disabled', r.create === true && r.join === true, { create: r.create, join: r.join });
  D.check('B7 BR.net.createRoom() 以 no_webrtc reject，没有发出任何外网请求', !!r.cr && !r.cr.ok && r.cr.code === 'no_webrtc' && D.blocked.length === blocked0, { cr: r.cr, blocked: D.blocked.slice(blocked0) });
  await D.ev(() => { BR.coop.closeLobby(); return 0; });
  await sleep(700);
  // B8：errorText 调用时现读 UA；iPadOS（Mac UA + 多点触控）按 iOS 处理
  const t = await D.ev(wx => {
    const out = { ios: BR.net.errorText('mic_denied') };
    Object.defineProperty(navigator, 'userAgent', { value: wx, configurable: true });
    try { out.wx = BR.net.errorText('mic_denied'); } finally { delete navigator.userAgent; }
    out.uaRestored = !/MicroMessenger/.test(navigator.userAgent);
    return out;
  }, UA.wx);
  D.data.b8 = t;
  D.check('B8 iPadOS（Mac UA + maxTouchPoints 5）下 errorText(mic_denied) 含「Safari」', /Safari/.test(t.ios), t.ios);
  D.check('B8 微信 UA 下 errorText(mic_denied) 含「在浏览器打开」', /在浏览器打开/.test(t.wx) && t.uaRestored, t);
}

// =====================================================================
// 游戏内触屏操作与 HUD（A1–A8、A12–A14、E3 E4）
// =====================================================================
function camFov() {
  __br.step(0.05);
  const c = BR.gfx.camera;
  const hf = 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect) * 180 / Math.PI;
  return { fov: +c.fov.toFixed(3), aspect: +c.aspect.toFixed(3), hfov: +hf.toFixed(2), expect: BR.gfx.gameFov ? +BR.gfx.gameFov(c.aspect).toFixed(3) : null };
}

// env：页面实测的安全区（只在 env() 真取到注入值时传入）；不传就按 .touch-root 的 padding 算
function a1Layout(env) {
  const P = BR.player, M = __m;
  // 最长的物品名放进第 1 格并选中：物品名标签最宽的情形
  const types = BR.itemTypes.all().map(x => x.type);
  let longest = types[0], L = 0;
  for (const ty of types) { const n = String((BR.itemTypes.get(ty) || {}).zh || ty).length; if (n > L) { L = n; longest = ty; } }
  for (let i = 0; i < P.inventory.length; i++) P.inventory[i] = null;
  P.inventory[0] = { type: longest, count: 1 };
  P.inventory[1] = { type: 'almond_water', count: 2 };
  P.inventory[4] = { type: 'almond_water', count: 1 };
  P.select(0);
  __br.step(0.05);
  const cs = getComputedStyle(document.querySelector('.touch-root'));
  // 有实测安全区就按它量：不看 .touch-root 自己的 padding，免得 CSS 没用 env() 时检查跟着放水
  const ins = env ? { t: env.t, r: env.r, b: env.b, l: env.l } : { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  const dataTouch = M.qa('.touch-root [data-touch]').map(e => e.dataset.touch);
  const items = [];
  M.qa('.touch-root .touch-btn').forEach(e => items.push(Object.assign({ n: e.dataset.touch }, M.box(e))));
  M.qa('.hud-slot').forEach((e, i) => items.push(Object.assign({ n: 'slot' + i }, M.box(e))));
  items.push(Object.assign({ n: 'stickIdle' }, M.box('.touch-stick')));
  const shown = items.filter(it => it.w > 0 && it.h > 0);
  const hits = [];
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (M.inter(shown[i], shown[j])) hits.push(shown[i].n + '×' + shown[j].n);
  const out = shown.filter(it => !M.inView(it, ins)).map(it => it.n);
  const name = Object.assign(M.box('.hud-inv-name'), { text: M.q('.hud-inv-name').textContent });
  const stick = shown.find(it => it.n === 'stickIdle');
  return {
    ins, dataTouch, hits, out, name, stick, longest,
    stickName: !!stick && M.inter(stick, name), stickSlots: stick ? shown.filter(it => /^slot/.test(it.n) && M.inter(it, stick)).map(it => it.n) : null,
    btns: shown.map(it => it.n + ' ' + [it.l, it.t, it.r, it.b].map(Math.round).join(',')),
  };
}

async function a1(D) {
  const safe = !!D.dev.insets;
  const lay = await D.ev(a1Layout, safe && D.envOk ? D.env : null);
  D.data.a1 = lay;
  D.check('A1 [data-touch] 包含 drop', lay.dataTouch.includes('drop'), lay.dataTouch);
  D.check('A1 .touch-btn、.hud-slot、待机摇杆两两不相交', lay.hits.length === 0, { hits: lay.hits, btns: lay.btns });
  if (safe && !D.envOk) {
    D.skip('A1 .touch-btn、.hud-slot、待机摇杆都在视口安全区内', D.envWhy);
    D.check('A1 .touch-btn、.hud-slot、待机摇杆都在视口内（安全区没生效，只按视口查）', lay.out.length === 0, { out: lay.out, ins: lay.ins });
  } else D.check('A1 .touch-btn、.hud-slot、待机摇杆都在视口' + (safe ? '安全区' : '') + '内', lay.out.length === 0, { out: lay.out, ins: lay.ins });
  if (D.key === 'android-p') {
    D.check('A3 360×640 待机摇杆与 .hud-inv-name、各 .hud-slot 的矩形不相交', !!lay.stick && !lay.stickName && lay.stickSlots.length === 0, { stick: lay.stick, name: lay.name, stickSlots: lay.stickSlots });
  }
}

async function a2(D) {
  const d0 = await D.ev(() => {
    const P = BR.player;
    for (let i = 0; i < P.inventory.length; i++) P.inventory[i] = null;
    P.inventory[2] = { type: 'almond_water', count: 2 };
    P.select(2);
    __br.step(0.05);
    return { cnt: P.inventory[2] ? P.inventory[2].count : 0, items: BR.items.list.length, drop: __m.box('.touch-btn-drop') };
  });
  if (!d0.drop) throw new Error('没有 .touch-btn-drop');
  await D.t.down(1, d0.drop.cx, d0.drop.cy);
  await D.step(0.05);
  await D.t.up(1);
  await D.step(0.05);
  const d1 = await D.ev(() => ({ cnt: BR.player.inventory[2] ? BR.player.inventory[2].count : 0, items: BR.items.list.length }));
  D.check('A2 选中物品后触摸 .touch-btn-drop：该格数量 -1、BR.items.list +1', d1.cnt === d0.cnt - 1 && d1.items === d0.items + 1, { d0: { cnt: d0.cnt, items: d0.items }, d1 });
  await D.ev(() => { window.__oldGameCoop = BR.game.coop; BR.game.coop = { active: true, role: 'host' }; return 0; });
  let d2;
  try {
    await D.t.down(1, d0.drop.cx, d0.drop.cy);
    await D.step(0.05);
    await D.t.up(1);
    d2 = await D.ev(() => ({ cnt: BR.player.inventory[2] ? BR.player.inventory[2].count : 0, items: BR.items.list.length }));
  } finally {
    await D.ev(() => { BR.game.coop = window.__oldGameCoop; __br.step(0.02); return 0; });
  }
  D.check('A2 BR.game.coop 桩 active 时再点丢弃，背包不变', d2.cnt === d1.cnt && d2.items === d1.items, { d1, d2 });
}

async function a12(D) {
  const nm = await D.ev(() => {
    const P = BR.player, out = [];
    const R = BR.gfx.renderer, orig = R.render;
    R.render = function () {};   // 只量 DOM，跳过 SwiftShader 光栅
    try {
      for (const def of BR.itemTypes.all()) {
        for (let i = 0; i < P.inventory.length; i++) P.inventory[i] = null;
        P.inventory[0] = { type: def.type, count: 1 };
        P.select(0);
        __br.step(0.02);
        const el = document.querySelector('.hud-inv-name');
        out.push({ type: def.type, sw: el.scrollWidth, cw: el.clientWidth });
      }
    } finally { R.render = orig; }
    for (let i = 0; i < P.inventory.length; i++) P.inventory[i] = null;
    __br.step(0.02);
    return out;
  });
  const trunc = nm.filter(x => x.sw > x.cw + 1);
  D.check('A12 ' + D.dev.w + '×' + D.dev.h + ' 逐一放入全部物品：.hud-inv-name scrollWidth ≤ clientWidth+1', nm.length > 0 && trunc.length === 0, { n: nm.length, trunc: trunc.map(x => x.type + ' ' + x.sw + '/' + x.cw) });
}

const yawNow = D => D.ev(() => { __br.step(0.02); return BR.player.yaw; });

async function a6full(D) {
  const W = D.dev.w, H = D.dev.h;
  const yy = H * 0.4, x0 = W / 2 + 2, x1 = W - 2;
  const y0 = await yawNow(D);
  await D.t.down(1, x0, yy);
  for (let k = 1; k <= 20; k++) await D.t.move(1, x0 + (x1 - x0) * k / 20, yy);
  const y1 = await yawNow(D);
  await D.t.up(1);
  const deg = Math.abs(norm(y1 - y0)) * 180 / Math.PI;
  D.data.a6 = { deg };
  D.check('A6 ' + W + '×' + H + ' 单次划满右半屏视角区转角在 100°–140°', deg >= 100 && deg <= 140, { deg: +deg.toFixed(1) });
}

async function a6small(D) {
  const H = D.dev.h, yy = H * 0.4;
  const a = await yawNow(D);
  await D.t.down(1, 600, yy);
  for (let k = 1; k <= 3; k++) await D.t.move(1, 600 + 20 * k, yy);
  const b = await yawNow(D);
  await D.t.up(1);
  const r = Math.abs(norm(b - a));
  D.data.a6 = { rad60: r };
  D.check('A6 874×402 下 60px 转角为 0.3rad±15%', r > 0.255 && r < 0.345, { rad: +r.toFixed(4) });
}

async function a5(D) {
  const W = D.dev.w, H = D.dev.h, S0 = { x: W * 0.25, y: H * 0.45 };
  await D.t.down(1, S0.x, S0.y);
  await D.t.move(1, S0.x, S0.y - 50);
  const sp = await D.ev(() => __m.box('.touch-btn-sprint'));
  await D.t.down(2, sp.cx, sp.cy);
  const y0 = await D.ev(() => { __br.step(0.1); return BR.player.yaw; });
  for (let k = 1; k <= 8; k++) await D.t.move(2, sp.cx - 10 * k, sp.cy);
  const r = await D.ev(() => { __br.step(0.1); return { yaw: BR.player.yaw, sprinting: BR.player.sprinting }; });
  await D.t.upAll();
  await D.step(0.05);
  const dy = norm(r.yaw - y0);
  D.check('A5 摇杆和冲刺同时按住、冲刺手指横移 80px：player.sprinting=true 且 |Δyaw|>0.1', r.sprinting === true && Math.abs(dy) > 0.1, { dyaw: +dy.toFixed(3), sprinting: r.sprinting });
}

async function a7(D) {
  const W = D.dev.w, H = D.dev.h;
  await D.t.down(1, W * 0.65, H * 0.35);
  await D.t.down(2, W * 0.85, H * 0.35);
  await D.t.move(1, W * 0.65 + 5, H * 0.35);
  await D.step(0.02);
  await D.t.up(1);
  const y0 = await yawNow(D);
  await D.t.move(2, W * 0.85 - 50, H * 0.35);
  await D.t.move(2, W * 0.85 - 100, H * 0.35);
  const y1 = await yawNow(D);
  await D.t.up(2);
  D.check('A7 视角区先按一指再按第二指，抬起第一指后第二指横移 100px：yaw 变化 ≠0', Math.abs(norm(y1 - y0)) > 0.05, { dyaw: +norm(y1 - y0).toFixed(3) });
}

async function a8(D) {
  const W = D.dev.w, H = D.dev.h;
  await D.t.down(1, W * 0.75, H * 0.35);
  await D.t.move(1, W * 0.75 + 4, H * 0.35);
  const y0 = await yawNow(D);
  try {
    await D.page.setViewportSize({ width: H, height: W });
    await sleep(400);
    // 旧坐标在新视口里可能出界：首次移动落到新视口内的点，再横移 20px
    const W2 = H, H2 = W;
    await D.t.move(1, W2 * 0.75, H2 * 0.35);
    const y1 = await yawNow(D);
    await D.t.move(1, W2 * 0.75 + 20, H2 * 0.35);
    const y2 = await yawNow(D);
    await D.t.up(1);
    D.check('A8 按住视角区时交换视口宽高，之后首次移动 yaw 变化 <0.2rad（再移 20px 照常转）', Math.abs(norm(y1 - y0)) < 0.2 && Math.abs(norm(y2 - y1)) > 0.02, { first: +norm(y1 - y0).toFixed(3), next20px: +norm(y2 - y1).toFixed(3) });
  } finally {
    await D.t.upAll();
    await D.page.setViewportSize({ width: W, height: H });
    await sleep(500);
    await D.step(0.05);
  }
}

async function a4pause(D) {
  const W = D.dev.w, H = D.dev.h, S0 = { x: W * 0.25, y: H * 0.45 };
  await D.t.down(1, S0.x, S0.y);
  await D.t.move(1, S0.x, S0.y - 30);
  await D.step(0.05);
  const pz = await D.ev(() => __m.box('.touch-btn-pause'));
  await D.t.down(2, pz.cx, pz.cy);
  await D.step(0.05);
  await D.t.up(2);
  const s1 = await D.ev(() => BR.game.screen);
  await sleep(400);   // 暂停菜单 250ms 内不响应点击
  const rs = await D.ev(() => __m.hit('.hud-btn-primary'));
  await D.t.tap(rs.b.cx, rs.b.cy);
  const s2 = await D.ev(() => ({ screen: BR.game.screen, inputOn: BR.input.enabled }));
  await D.t.upAll();
  await D.step(0.05);
  D.check('A4 手指 1 按住摇杆、手指 2 点暂停键、手指 3 点「继续」后 screen=playing', s1 === 'paused' && s2.screen === 'playing', { s1, s2, hit: rs.ok });
}

async function a4death(D) {
  const W = D.dev.w, H = D.dev.h, S0 = { x: W * 0.25, y: H * 0.45 };
  await D.t.down(1, S0.x, S0.y);
  await D.t.move(1, S0.x, S0.y - 30);
  const d0 = await D.ev(() => { __br.step(0.05); BR.player.hp = 0; __br.step(0.05); return { dead: BR.player.dead, screen: BR.game.screen }; });
  await waitArmed(D);
  const cb = await D.ev(() => __m.box('.death-btn-continue'));
  await D.t.tap(cb.cx, cb.cy);
  await D.step(0.1);
  const r = await D.ev(() => ({ hp: BR.player.hp, dead: BR.player.dead, screen: BR.game.screen }));
  await D.t.upAll();
  await D.step(0.05);
  D.check('A4 按住摇杆时 hp 置 0，结算解除保护后另一指点「继续」：hp>0', d0.dead && d0.screen === 'dead' && r.hp > 0 && !r.dead && r.screen === 'playing', { d0, r });
}

async function a14(D) {
  const H = D.dev.h;
  const v0 = await D.ev(() => { BR.hud.pause(true); __br.step(0.05); return document.querySelector('.hud-range').value; });
  await sleep(400);
  try {
    const rr = await D.ev(() => __m.box('.hud-range'));
    await D.t.down(5, 6, H - 8);   // 另一根手指搭在暂停遮罩上
    await D.t.down(6, rr.l + rr.w * 0.2, rr.cy);
    const v1 = await D.ev(() => +document.querySelector('.hud-range').value);
    await D.t.upAll();
    D.check('A14 暂停能见度滑条在 20% 处 touchstart，dom 值在 17–23', v1 >= 17 && v1 <= 23, { v1, w: rr.w });
  } finally {
    await D.t.upAll();
    await D.ev(v => { const r = document.querySelector('.hud-range'); r.value = v; r.dispatchEvent(new Event('input')); BR.hud.pause(false); __br.step(0.05); return 0; }, v0);
  }
}

// 真实 BR.coop 上临时改 active / mic / micBusy / setMic（暂停、结算的开关麦只读这几项），用完 restoreCoopDesc 还原
function micStub() {
  const c = BR.coop;
  window.__coopDesc = {};
  for (const k of ['active', 'mic', 'micBusy']) window.__coopDesc[k] = Object.getOwnPropertyDescriptor(c, k);
  window.__coopSetMic = c.setMic;
  window.__stub = { on: false, calls: [] };
  Object.defineProperty(c, 'active', { get: () => true, configurable: true, enumerable: true });
  Object.defineProperty(c, 'mic', { get: () => window.__stub.on, configurable: true, enumerable: true });
  Object.defineProperty(c, 'micBusy', { get: () => false, configurable: true, enumerable: true });
  c.setMic = on => { window.__stub.calls.push(!!on); window.__stub.on = !!on; return Promise.resolve(!!on); };
  return 0;
}

async function a13(D) {
  await D.ev(micStub);
  try {
    const pz = await D.ev(() => __m.box('.touch-btn-pause'));
    await D.t.tap(pz.cx, pz.cy);
    await D.step(0.05);
    await sleep(400);
    const pm = await D.ev(() => { __br.step(0.02); const b = document.querySelector('.hud-pause-mic'); return { screen: BR.game.screen, vis: __m.vis(b), hit: __m.hit(b), txt: b ? b.textContent : null }; });
    D.check('A13 BR.coop 桩 active 时暂停：.hud-pause-mic 可见、中心命中', pm.screen === 'paused' && pm.vis && pm.hit.ok, pm);
    if (pm.vis && pm.hit.b) { await D.t.tap(pm.hit.b.cx, pm.hit.b.cy); await sleep(150); }
    const calls1 = await D.ev(() => window.__stub.calls.slice());
    D.check('A13 触摸 .hud-pause-mic 后 setMic 桩被调用', calls1.length === 1 && calls1[0] === true, calls1);
    await D.ev(() => { BR.hud.pause(false); __br.step(0.05); BR.player.hp = 0; __br.step(0.05); return 0; });
    await waitArmed(D);
    const dm = await D.ev(() => {
      const b = document.querySelector('.death-mic');
      return { screen: BR.game.screen, vis: __m.vis(b), hit: b ? __m.hit(b) : null, txt: b ? b.textContent : null, texts: __m.qa('.death-btn .death-btn-main').map(e => e.textContent.trim()) };
    });
    D.check('A13 死亡结算时 .death-mic 可见、中心命中', dm.screen === 'dead' && dm.vis && !!dm.hit && dm.hit.ok, dm);
    if (dm.vis && dm.hit && dm.hit.b) { await D.t.tap(dm.hit.b.cx, dm.hit.b.cy); await sleep(150); }
    const calls2 = await D.ev(() => window.__stub.calls.slice());
    D.check('A13 触摸 .death-mic 后 setMic 桩被调用', calls2.length === 2 && calls2[1] === false, calls2);
    D.check('A13 「.death-btn .death-btn-main」文本仍只有 继续 / 返回主页', JSON.stringify(dm.texts) === '["继续","返回主页"]', dm.texts);
    const cb = await D.ev(() => __m.box('.death-btn-continue'));
    await D.t.tap(cb.cx, cb.cy);
    await D.step(0.1);
  } finally {
    await D.ev(restoreCoopDesc);
    await D.ev(() => { if (BR.game.screen === 'dead') BR.bus.emit('death:continue'); if (BR.hud.paused) BR.hud.pause(false); __br.step(0.05); return 0; });
  }
}

// ---------- A4 菜单按钮轻点（BR.input.tap）的次数与反例 ----------
// 只看最终 screen 的话，tap 不吞合成 click、800ms 去重失效（点一下触发两次）时照样能过：
// 这里数 game:pause / death:continue 事件，并看「返回主页」点一下是不是只进确认态
function busLog() {
  if (!window.__busLog) {
    const L = window.__busLog = { pause: [], cont: 0 };
    BR.bus.on('game:pause', e => L.pause.push(!!(e && e.paused)));
    BR.bus.on('death:continue', () => { L.cont++; });
  }
  window.__busLog.pause.length = 0;
  window.__busLog.cont = 0;
  return 0;
}
function pauseState() {
  const home = document.querySelector('.hud-btn-home');
  return { screen: BR.game.screen, pause: window.__busLog.pause.slice(), confirm: !!home && home.classList.contains('hud-btn-confirm'), homeText: home ? home.textContent : null };
}
async function tapPauseKey(D) {
  const pz = await D.ev(() => __m.box('.touch-btn-pause'));
  await D.t.tap(pz.cx, pz.cy);
  await D.step(0.05);
  await sleep(400);   // 暂停菜单弹出后 250ms 内不响应点击
}
async function tapBtn(D, sel) {
  const b = await D.ev(s => __m.box(s), sel);
  await D.t.tap(b.cx, b.cy);
  await sleep(350);   // 合成 click 要是没被吞、去重又失效，会在这段时间里再触发一次
  await D.step(0.05);
  return b;
}

async function a4tap(D) {
  await D.ev(busLog);
  // ① 单指轻点「继续」：暂停、继续各一次
  await tapPauseKey(D);
  await tapBtn(D, '.hud-btn-primary');
  const p1 = await D.ev(pauseState);
  D.check('A4 单指轻点暂停键、再单指轻点「继续」：game:pause 恰好 [true,false]、screen=playing', p1.screen === 'playing' && JSON.stringify(p1.pause) === '[true,false]', p1);
  if (p1.screen !== 'playing') await D.ev(() => { if (BR.hud.paused) BR.hud.pause(false); __br.step(0.05); return 0; });

  // ① 单指轻点一次「返回主页」：只进确认态
  await D.ev(busLog);
  await tapPauseKey(D);
  await tapBtn(D, '.hud-btn-home');
  const p2 = await D.ev(pauseState);
  D.check('A4 单指轻点一次「返回主页」：仍 paused 且出现 .hud-btn-confirm（不会直接回主页）', p2.screen === 'paused' && p2.confirm && JSON.stringify(p2.pause) === '[true]', p2);
  if (p2.screen !== 'paused') { await ensureCasual(D); return; }

  // ② 按住「继续」横拖 30px（超过轻点位移阈值）再抬起：不算轻点
  const b = await D.ev(() => __m.box('.hud-btn-primary'));
  await D.t.down(31, b.cx, b.cy);
  for (let k = 1; k <= 3; k++) { await D.t.move(31, b.cx + 10 * k, b.cy); await sleep(16); }
  await D.t.up(31);
  await sleep(350);
  await D.step(0.05);
  const p3 = await D.ev(pauseState);
  D.check('A4 按住「继续」横拖 30px 再抬起：仍 paused、不触发', p3.screen === 'paused' && JSON.stringify(p3.pause) === '[true]', Object.assign({ from: [b.cx, b.cy], to: [b.cx + 30, b.cy], btn: b }, p3));
  if (p3.screen !== 'paused') { await D.ev(busLog); await tapPauseKey(D); }

  // ② 从「继续」外面按下、滑进按钮中心再抬起：按下时不在按钮上，不算轻点
  const st = await D.ev(() => {
    const btn = document.querySelector('.hud-btn-primary'), bb = __m.box(btn);
    for (const [x, y] of [[bb.cx, bb.t - 24], [bb.l - 24, bb.cy], [bb.r + 24, bb.cy], [bb.cx, bb.b + 24]]) {
      if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
      const e = document.elementFromPoint(x, y);
      if (e && !btn.contains(e) && !e.closest('button, input, label, a')) return { x, y, by: __m.cls(e), b: bb };
    }
    return null;
  });
  if (!st) throw new Error('「继续」四周找不到不在按钮上的起手点');
  await D.t.down(32, st.x, st.y);
  for (let k = 1; k <= 4; k++) { await D.t.move(32, st.x + (st.b.cx - st.x) * k / 4, st.y + (st.b.cy - st.y) * k / 4); await sleep(16); }
  await D.t.up(32);
  await sleep(350);
  await D.step(0.05);
  const p4 = await D.ev(pauseState);
  D.check('A4 从「继续」外面按下、滑进按钮中心再抬起：仍 paused、不触发', p4.screen === 'paused' && JSON.stringify(p4.pause) === '[true]', Object.assign({ start: st }, p4));

  // 收尾：正常轻点「继续」回到游戏
  if (p4.screen === 'paused') await tapBtn(D, '.hud-btn-primary');
  await D.ev(() => { if (BR.hud.paused) BR.hud.pause(false); __br.step(0.05); return 0; });
}

// 结算保护期（死亡后 ARM_MS 内按钮不收点击）里按下、解锁后才抬起：这一下是冲着死前的操作去的，不能算成点了「继续」或开关麦
function deathTouchLog() {
  if (!window.__deathTT) {
    window.__deathTT = [];
    document.addEventListener('touchstart', e => {
      const r = document.querySelector('.death-root');
      window.__deathTT.push({ armed: !!r && r.classList.contains('death-armed'), tgt: __m.cls(e.target) });
    }, { capture: true, passive: true });
  }
  window.__deathTT.length = 0;
  return 0;
}

async function a4straddle(D) {
  await D.ev(busLog);
  await D.ev(micStub);
  await D.ev(deathTouchLog);
  let positive = false;
  try {
    for (const [sel, name] of [['.death-btn-continue', '「继续」'], ['.death-mic', '开关麦']]) {
      const label = 'A4 结算保护期内按下' + name + '、解锁后才抬起：' + (sel === '.death-mic' ? 'setMic 桩不被调用' : 'death:continue 不触发、仍在结算');
      let done = false, last = null;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const r0 = await D.ev(s => {
          window.__deathTT.length = 0;
          window.__busLog.cont = 0;
          window.__stub.calls.length = 0;
          __br.step(0.05);
          BR.player.hp = 0;
          __br.step(0.05);
          const r = document.querySelector('.death-root'), el = document.querySelector(s);
          return { screen: BR.game.screen, armed: !!r && r.classList.contains('death-armed'), box: el && __m.vis(el) ? __m.box(el) : null };
        }, sel);
        if (r0.screen !== 'dead' || !r0.box) throw new Error(name + ' 没出现：' + JSON.stringify(r0));
        const id = 40 + attempt;
        await D.t.down(id, r0.box.cx, r0.box.cy);
        await waitArmed(D);
        await sleep(60);
        const fin = await D.ev(s => __m.box(s), sel);
        await D.t.up(id);
        await sleep(400);
        await D.step(0.05);
        const r1 = await D.ev(() => ({ screen: BR.game.screen, cont: window.__busLog.cont, calls: window.__stub.calls.slice(), tt: window.__deathTT.slice() }));
        // 入场动画会轻微缩放面板：按下时结算确实还没解锁、抬起点仍在按钮最终矩形里，这次才算数
        const inside = !!fin && r0.box.cx >= fin.l && r0.box.cx <= fin.r && r0.box.cy >= fin.t && r0.box.cy <= fin.b;
        last = { at: [r0.box.cx, r0.box.cy], fin, inside, r1 };
        if (r1.tt.length > 0 && r1.tt[0].armed === false && inside) {
          done = true;
          const fired = sel === '.death-mic' ? r1.calls.length > 0 : r1.cont > 0 || r1.screen !== 'dead';
          D.check(label, !fired, last);
        }
        // 收尾：解锁后单指轻点「继续」回到游戏（第一次顺带核对恰好触发一次）
        if (await D.ev(() => BR.game.screen) === 'dead') {
          await waitArmed(D);
          const c0 = await D.ev(() => window.__busLog.cont);
          const cb = await D.ev(() => __m.box('.death-btn-continue'));
          await D.t.tap(cb.cx, cb.cy);
          await sleep(350);
          await D.step(0.05);
          const c1 = await D.ev(() => ({ cont: window.__busLog.cont, screen: BR.game.screen, hp: BR.player.hp, dead: BR.player.dead }));
          if (!positive) {
            positive = true;
            D.check('A4 结算解锁后单指轻点「继续」：death:continue 恰好 +1、回到 playing', c1.cont === c0 + 1 && c1.screen === 'playing' && c1.hp > 0 && !c1.dead, { c0, c1 });
          }
          if (c1.screen === 'dead') await D.ev(() => { BR.bus.emit('death:continue'); __br.step(0.05); return 0; });
        }
      }
      if (!done) D.skip(label, '机器太忙：连续 3 次按下时结算已解锁（或按钮挪出了按下点），这项测不了：' + JSON.stringify(last).slice(0, 300));
    }
  } finally {
    await D.t.upAll();
    await D.ev(restoreCoopDesc);
    await D.ev(() => { if (BR.game.screen === 'dead') BR.bus.emit('death:continue'); if (BR.hud.paused) BR.hud.pause(false); __br.step(0.05); return 0; });
  }
}

// 640×304 ≈ 640×360 横屏减去地址栏：联机结算多了开关麦，矮屏上不能要往下滚才看得到、点得到
async function a13short(D) {
  const W = D.dev.w, H = D.dev.h;
  await D.ev(micStub);
  try {
    await D.page.setViewportSize({ width: 640, height: 304 });
    await sleep(400);
    await D.ev(() => { __br.step(0.05); BR.player.hp = 0; __br.step(0.05); return 0; });
    await waitArmed(D);
    await sleep(500);   // 入场动画 0.5s 走完再量
    const dm = await D.ev(() => {
      const r = document.querySelector('.death-root'), b = document.querySelector('.death-mic');
      return {
        vp: innerWidth + 'x' + innerHeight, screen: BR.game.screen, sh: r.scrollHeight, ch: r.clientHeight, st: r.scrollTop,
        vis: __m.vis(b), mic: b ? __m.hit(b) : null, btns: __m.qa('.death-btn').map(x => { const h = __m.hit(x); return { ok: h.ok, by: h.by, b: h.b }; }),
      };
    });
    D.check('A13 640×304 联机结算：.death-root scrollHeight ≤ clientHeight+1，.death-mic 和两个主按钮不用滚动就可见、中心命中',
      dm.screen === 'dead' && dm.sh <= dm.ch + 1 && dm.vis && !!dm.mic && dm.mic.ok && dm.btns.length === 2 && dm.btns.every(x => x.ok), dm);
    if (dm.mic && dm.mic.ok) {
      await D.t.tap(dm.mic.b.cx, dm.mic.b.cy);
      await sleep(200);
      const calls = await D.ev(() => window.__stub.calls.slice());
      D.check('A13 640×304 触摸 .death-mic 后 setMic 桩被调用', calls.length === 1 && calls[0] === true, calls);
    }
    const cb = await D.ev(() => __m.box('.death-btn-continue'));
    await D.t.tap(cb.cx, cb.cy);
    await D.step(0.1);
  } finally {
    await D.t.upAll();
    await D.page.setViewportSize({ width: W, height: H });
    await sleep(500);
    await D.ev(restoreCoopDesc);
    await D.ev(() => { if (BR.game.screen === 'dead') BR.bus.emit('death:continue'); if (BR.hud.paused) BR.hud.pause(false); __br.step(0.05); return 0; });
  }
}

async function secGame(D) {
  const { key, dev } = D;
  const portrait = dev.h > dev.w;
  await goHome(D);
  // 竖屏「横屏」提示本次会话只弹一次（sessionStorage 记着，重进页面也不清）：前面的段开过局就轮不到这里，E4 只看这次开局
  await D.ev(() => { try { sessionStorage.removeItem('backrooms_landscape_hint'); } catch (e) { /* 忽略 */ } if (window.__toasts) window.__toasts.length = 0; return 0; });
  await startGame(D, { mode: 'casual', levelId: '0', seed: 11 });
  const cam = await D.ev(camFov);
  D.data.gameFov = cam;
  if (portrait) D.check('E3 ' + dev.w + '×' + dev.h + ' 竖屏开局 camera.fov >75 且水平视野 ≥57°', cam.fov > 75 && cam.hfov >= 57, cam);
  else D.check('E3 ' + dev.w + '×' + dev.h + ' 横屏开局 camera.fov 为 75', Math.abs(cam.fov - 75) < 1e-3, cam);
  const toasts = await D.ev(() => (window.__toasts || []).slice());
  if (portrait) D.check('E4 竖屏开局出现含「横屏」的 toast', toasts.some(t => /横屏/.test(t)), toasts);
  else D.check('E4 横屏开局不出现含「横屏」的 toast', !toasts.some(t => /横屏/.test(t)), toasts);

  await sub(D, 'A1', () => a1(D));
  if (key === 'android-p' || key === 'iphone-p') {
    await sub(D, 'A2', () => a2(D));
    await sub(D, 'A12', () => a12(D));
  }
  if (key === 'iphone-p' || key === 'android-l') await sub(D, 'A6', () => a6full(D));
  if (key === 'iphone-l') {
    await sub(D, 'A6', () => a6small(D));
    await sub(D, 'A8', () => a8(D));
  }
  if (key === 'android-l') {
    await sub(D, 'A5', () => a5(D));
    await sub(D, 'A7', () => a7(D));
    await sub(D, 'A4 暂停', () => a4pause(D));
    await sub(D, 'A4 结算', () => a4death(D));
    await sub(D, 'A4 轻点', () => a4tap(D));
    await sub(D, 'A4 结算保护期', () => a4straddle(D));
    await sub(D, 'A13 640×304', () => a13short(D));
  }
  if (key === 'iphone-p') {
    await sub(D, 'A14', () => a14(D));
    await sub(D, 'A13', () => a13(D));
  }
}

// =====================================================================
// 游戏内联机浮层（B4 B5 B6）、测试面板（A4 A10 A11）、toast（A9）、E5 E7 E8
// =====================================================================
// 联机桩：真实 coop.js + 假 BR.net（建房、发消息、开麦都是本地桩），接通事件由 hookNet 记下的监听直接派发
async function coopConnect() {
  const L = window.__netL || [], N = BR.net;
  window.__micCalls = [];
  N.createRoom = async () => 'MOBILE';
  N.send = () => true;
  N.leave = () => {};
  N.resumeAudio = () => {};
  N.setMic = on => { window.__micCalls.push(!!on); return Promise.resolve(!!on); };
  BR.coop.openLobby();
  const cb = Array.from(document.querySelectorAll('.coop-lobby button')).find(b => b.textContent.trim() === '创建房间');
  if (cb) cb.click();
  for (let i = 0; i < 80 && BR.coop.phase !== 'hosting'; i++) await new Promise(r => setTimeout(r, 25));
  L.forEach(fn => fn('peerJoined', '队友'));
  L.forEach(fn => fn('connected'));
  L.forEach(fn => fn('msg', { t: 'hello', game: 'backrooms', v: BR.config.version, name: '队友', skin: 'blue' }));
  return { active: BR.coop.active, role: BR.coop.role, phase: BR.coop.phase, listeners: L.length };
}
function coopLayout() {
  const M = __m;
  const mic = M.box('.coop-mic');
  const others = {};
  M.qa('.touch-btn').filter(b => M.vis(b)).forEach(b => { others[b.dataset.touch || M.cls(b)] = M.box(b); });
  if (M.vis('.hud-info')) others.info = M.box('.hud-info');
  const over = Object.keys(others).filter(k => M.inter(mic, others[k]));
  return { vp: innerWidth + 'x' + innerHeight, touchCls: M.q('.coop-hud').classList.contains('coop-touch'), micVis: M.vis('.coop-mic'), mic, over, others };
}
// 两枚说话角标强制显示后量矩形，量完还原
function coopBadges() {
  const M = __m;
  const st = document.createElement('style');
  st.textContent = '.coop-hud .coop-badge[data-mobile-probe]{display:block!important}';
  document.head.appendChild(st);
  const bs = M.qa('.coop-badge');
  const saved = bs.map(b => b.hidden);
  bs.forEach(b => { b.hidden = false; b.dataset.mobileProbe = '1'; });
  const boxes = bs.map(b => M.box(b));
  const sprint = M.box('.touch-btn-sprint');
  const r = { n: bs.length, boxes, sprint, over: boxes.map((b, i) => (M.inter(b, sprint) ? 'badge' + i : null)).filter(Boolean), inView: boxes.every(b => M.inView(b)) };
  bs.forEach((b, i) => { b.hidden = saved[i]; delete b.dataset.mobileProbe; });
  st.remove();
  return r;
}

async function secCoop(D) {
  const W = D.dev.w, H = D.dev.h;
  await ensureCasual(D);
  try {
    const st = await D.ev(coopConnect);
    D.data.coopStub = st;
    if (!st.active) throw new Error('联机桩没接通：' + JSON.stringify(st));
    await sleep(200);
    if (D.key === 'android-l') {
      const b6 = await D.ev(() => {
        const b = document.querySelector('.coop-lobby-mic');
        return { lobby: __m.vis('.coop-lobby'), vis: __m.vis(b), txt: b ? b.textContent.trim() : null, hit: b ? __m.hit(b) : null, tips: __m.qa('.coop-lobby .coop-hint').filter(e => __m.vis(e)).map(e => e.textContent) };
      });
      D.check('B6 联机接通（phase=active）时大厅里有开麦按钮', b6.lobby && b6.vis && b6.txt === '开麦', b6);
      D.check('B6 触屏下 .coop-hint 文案不含「V 键」', b6.tips.length > 0 && !b6.tips.some(t => /V 键/.test(t)), b6.tips);
      if (b6.vis) await press(D, '.coop-lobby-mic');
      await sleep(250);
      const c1 = await D.ev(() => ({ calls: window.__micCalls.slice(), mic: BR.coop.mic }));
      D.check('B6 点大厅开麦按钮调用 setMic', c1.calls[0] === true, c1);
      await D.ev(() => { if (BR.coop.mic) BR.coop.setMic(false); return 0; });
      await sleep(150);
    }
    await D.ev(() => { BR.coop.closeLobby(); return 0; });
    await sleep(700);
    await D.step(0.1);

    const L = await D.ev(coopLayout);
    D.data.b4 = L;
    D.check('B4 ' + W + '×' + H + ' 横屏 .coop-mic 与 .touch-btn-pause、各 .touch-btn、.hud-info 都不相交', L.touchCls && L.micVis && L.over.length === 0, { mic: L.mic, over: L.over, pause: L.others.pause });
    const bd = await D.ev(coopBadges);
    D.data.b4.badges = bd;
    D.check('B4 ' + W + '×' + H + ' 两枚说话角标强制显示时不与 .touch-btn-sprint 相交', bd.n === 2 && !!bd.sprint && bd.over.length === 0 && bd.inView, bd);

    if (D.key === 'android-l') {
      const S0 = { x: W * 0.25, y: H * 0.45 };
      const micC = await D.ev(() => __m.box('.coop-mic'));
      const c0 = await D.ev(() => window.__micCalls.length);
      await D.t.down(1, S0.x, S0.y);
      await sleep(60);
      await D.t.move(1, S0.x + 10, S0.y - 20);
      await sleep(60);
      await D.t.tap(micC.cx, micC.cy);
      await sleep(250);
      const c1 = await D.ev(() => ({ n: window.__micCalls.length, mic: BR.coop.mic }));
      await D.t.up(1);
      await sleep(900);
      const c2 = await D.ev(() => window.__micCalls.length);
      D.check('B5 手指按住摇杆时另一指触摸 .coop-mic：toggle 计数 +1', c1.n === c0 + 1 && c2 === c1.n, { c0, c1, c2 });
      await D.t.tap(micC.cx, micC.cy);
      await sleep(900);
      const c3 = await D.ev(() => window.__micCalls.length);
      D.check('B5 单指触摸 .coop-mic 只加 1，不会切两次', c3 === c2 + 1, { c2, c3 });
    }
  } finally {
    await D.t.upAll();
    await D.ev(() => { try { if (BR.coop.active) BR.coop.leave(); } catch (e) { /* 忽略 */ } __br.step(0.1); return 0; });
    await sleep(300);
  }
}

async function secTest(D) {
  const W = D.dev.w, H = D.dev.h, S0 = { x: W * 0.25, y: H * 0.45 };
  const vp = W + '×' + H;
  await goHome(D);
  await startGame(D, { mode: 'test', levelId: '0', seed: 5 });
  await D.step(0.3);
  const entry = await D.ev(() => __m.hit('.test-entry'));
  if (!entry.b) throw new Error('没有 .test-entry');
  const holdStick = D.key === 'android-l';
  if (holdStick) {
    await D.t.down(1, S0.x, S0.y);
    await D.t.move(1, S0.x, S0.y - 30);
    await D.step(0.05);
  }
  await D.t.tap(entry.b.cx, entry.b.cy);
  await sleep(550);   // 面板打开后 400ms 内的点击被忽略
  if (holdStick) {
    const L = await D.ev(() => {
      const lr = document.querySelector('.test-list').getBoundingClientRect();
      const it = Array.from(document.querySelectorAll('.test-item')).find(b => { const r = b.getBoundingClientRect(); return r.height > 0 && r.top >= lr.top + 30 && r.bottom <= lr.bottom; });
      return { item: it ? __m.box(it) : null, type: it && it.dataset.type, n: BR.entities.list.length, open: BR.test.isOpen };
    });
    if (L.item) {
      await D.t.tap(L.item.cx, L.item.cy);
      await D.step(0.05);
    }
    const L2 = await D.ev(() => ({ n: BR.entities.list.length }));
    await D.t.upAll();
    D.check('A4 测试模式按住摇杆点列表项：BR.entities.list 长度 +1', L.open && !!L.item && L2.n >= L.n + 1, { L, L2 });
  }
  if (!await D.ev(() => BR.test.isOpen)) throw new Error('测试面板没打开');
  const lr = await D.ev(() => __m.box('.test-list'));
  for (let s = 0; s < 3; s++) {
    const id = 20 + s, x = lr.cx, ya = lr.b - 20, yb = lr.t + 20;
    await D.t.down(id, x, ya);
    for (let k = 1; k <= 8; k++) { await D.t.move(id, x, ya + (yb - ya) * k / 8); await sleep(16); }
    await D.t.up(id);
    await sleep(250);
  }
  await sleep(400);
  const sc = await D.ev(() => {
    const sheet = document.querySelector('.test-sheet'), list = document.querySelector('.test-list');
    return { sheetTop: sheet.scrollTop, listTop: list.scrollTop, listH: list.clientHeight, close: __m.hit('.test-close').ok, dummy: __m.hit('.test-btn-dummy').ok, search: __m.hit('.test-search').ok };
  });
  D.data.a10 = sc;
  if (H <= 520) {
    D.check('A10 ' + vp + ' 列表区上滑 3 次：.test-sheet scrollTop=0；.test-close / .test-btn-dummy / .test-search 中心命中；.test-list clientHeight ≥150', sc.sheetTop === 0 && sc.close && sc.dummy && sc.search && sc.listH >= 150, sc);
    await D.ev(() => { BR.hud.toast('附近没有能落脚的空位，换个开阔的地方再试', 4000); return 0; });
    await sleep(120);
    const tt = await D.ev(() => {
      const ts = __m.box('.hud-toasts'), sh = __m.box('.test-sheet');
      const rs = __m.qa('.hud-toast').map(e => __m.box(e).r);
      return { tsR: ts.r, sheetL: sh.l, maxR: rs.length ? Math.max.apply(null, rs) : null, n: rs.length, htmlCls: document.documentElement.classList.contains('br-test-open') };
    });
    D.check('A11 ' + vp + ' 测试面板开着时长 toast：.hud-toasts 右缘 < .test-sheet 左缘', tt.n > 0 && tt.maxR < tt.sheetL && tt.tsR < tt.sheetL, tt);
  }
  const cx = await D.ev(() => __m.box('.test-close'));
  await D.t.tap(cx.cx, cx.cy);
  await D.step(0.05);
  await goHome(D);
}

async function secToastL16(D) {
  await goHome(D);
  await startGame(D, { mode: 'casual', levelId: '16', seed: 16 });
  await D.ev(() => { BR.hud.toast('移动端回归用的长提示', 9000); __br.step(0.05); return 0; });
  const toastState = () => D.ev(() => { const el = document.querySelector('.hud-toasts'); return { screen: BR.game.screen, n: el.children.length, vis: getComputedStyle(el).visibility }; });
  const a = await toastState();
  const pz = await D.ev(() => __m.box('.touch-btn-pause'));
  await D.t.tap(pz.cx, pz.cy);
  await D.step(0.05);
  const b = await toastState();
  D.check('A9 L16 toast 出现后暂停：.hud-toasts computed visibility 为 hidden', a.n > 0 && a.vis === 'visible' && b.screen === 'paused' && b.vis === 'hidden', { a, b });
  await sleep(400);
  const rs = await D.ev(() => __m.box('.hud-btn-primary'));
  await D.t.tap(rs.cx, rs.cy);
  await D.step(0.05);
  const c = await toastState();
  D.check('A9 L16 继续后 toast 恢复可见', c.screen === 'playing' && c.vis === 'visible' && c.n > 0, c);
  await D.ev(() => { BR.player.hp = 0; __br.step(0.05); return 0; });
  const dd = await toastState();
  D.check('A9 L16 死亡结算期间 .hud-toasts 同样为 hidden', dd.screen === 'dead' && dd.vis === 'hidden', dd);
  await waitArmed(D);
  const cb = await D.ev(() => __m.box('.death-btn-continue'));
  await D.t.tap(cb.cx, cb.cy);
  await D.step(0.1);
  await goHome(D);
}

async function secCtx(D) {
  await ensureCasual(D);
  const a = await D.ev(async () => {
    const gl = BR.gfx.renderer.getContext();
    window.__lose = gl.getExtension('WEBGL_lose_context');
    if (!window.__lose) return { ext: false };
    __br.step(0.05);
    window.__lose.loseContext();
    for (let i = 0; i < 40 && !document.querySelector('.ctx-lost'); i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 100));
    return { ext: true, lost: gl.isContextLost(), screen: BR.game.screen, vis: __m.vis('.ctx-lost'), text: (document.querySelector('.ctx-lost-text') || {}).textContent || null };
  });
  D.data.e5 = { a };
  D.check('E5 WEBGL_lose_context.loseContext() 后 screen=paused 且 .ctx-lost 可见', a.ext && a.screen === 'paused' && a.vis, a);
  await D.ev(() => { if (window.__lose) window.__lose.restoreContext(); return 0; });
  const gone = await waitFor(D, () => !document.querySelector('.ctx-lost'), 8000);
  const b = await D.ev(() => ({ box: !!document.querySelector('.ctx-lost'), lost: BR.gfx.renderer.getContext().isContextLost(), screen: BR.game.screen }));
  D.data.e5.b = b;
  D.check('E5 restoreContext() 后 .ctx-lost 被移除', gone && !b.box && !b.lost, b);
  await D.ev(() => { if (BR.hud.paused) BR.hud.pause(false); __br.step(0.1); return 0; });
}

async function secRender(D) {
  await ensureCasual(D);
  // 真实 rAF 驱动（auto=true），renderer.render 换成空函数跳过 SwiftShader 光栅，只数 BR.gfx.render 调用
  await D.ev(() => {
    __br.setAuto(true);
    BR.entities.clear();
    const R = BR.gfx.renderer;
    window.__e8 = { rr: R.render, gr: BR.gfx.render, n: 0 };
    R.render = function () {};
    BR.gfx.render = function (d) { window.__e8.n++; return window.__e8.gr.call(this, d); };
    return 0;
  });
  const count = ms => D.ev(async t => {
    window.__e8.n = 0;
    const f0 = __br.frames;
    await new Promise(r => setTimeout(r, t));
    return { renders: window.__e8.n, ticks: __br.frames - f0, screen: BR.game.screen };
  }, ms);
  try {
    const playing = await count(1000);
    await D.ev(() => { BR.hud.pause(true); return 0; });
    const paused = await count(2500);
    D.check('E8 单机暂停后真实等 2.5 秒，BR.gfx.render 调用 ≤15 次', paused.screen === 'paused' && paused.renders <= 15, { playing, paused });
    const t0 = Date.now();
    await D.page.keyboard.press('Escape');
    const resumed = await D.page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 3000, polling: 10 }).then(() => true, () => false);
    const escMs = Date.now() - t0;
    D.check('E8 暂停中按 Esc 仍能即时恢复（<500ms）', resumed && escMs < 500, { resumed, escMs });
    await D.ev(() => {
      window.__realCoop = BR.coop;
      BR.coop = new Proxy(window.__realCoop, { get: (t, k) => (k === 'active' ? true : Reflect.get(t, k)) });
      BR.hud.pause(true);
      return 0;
    });
    const coopPaused = await count(2500);
    D.check('E8 BR.coop 桩 active 时暂停不限帧（2.5 秒 >15 次）', coopPaused.screen === 'paused' && coopPaused.renders > 15, { coopPaused, playing });
    D.data.e8 = { playing, paused, escMs, coopPaused };
  } finally {
    await D.ev(() => {
      if (window.__realCoop) { BR.coop = window.__realCoop; window.__realCoop = null; }
      if (BR.hud.paused) BR.hud.pause(false);
      if (window.__e8) { BR.gfx.renderer.render = window.__e8.rr; BR.gfx.render = window.__e8.gr; window.__e8 = null; }
      __br.setAuto(false);
      __br.step(0.05);
      return 0;
    });
  }
}

async function secSanity(D) {
  await goHome(D);
  await startGame(D, { mode: 'nightmare', difficulty: 'easy', levelId: '0', seed: 2024 });
  const r = await D.ev(() => {
    __br.setAuto(false);
    BR.entities.clear();
    const R = BR.gfx.renderer, orig = R.render;
    R.render = function () {};
    try { for (let i = 0; i < 60; i++) __br.step(1 / 30); } finally { R.render = orig; }
    const root = document.querySelector('.gfx-sanity');
    const layers = Array.from(document.querySelectorAll('.gfx-sanity > div')).map(d => ({ k: d.className.replace('gfx-sanity-', ''), d: getComputedStyle(d).display, o: d.style.opacity }));
    return { root: root ? getComputedStyle(root).display : null, sanity: +BR.player.sanity.toFixed(2), layers, none: layers.filter(l => l.d === 'none').length };
  });
  D.data.e7 = r;
  D.check('E7 噩梦 L0 用 step(1/30) 逐帧推 2 秒：.gfx-sanity 子层 display:none ≥2 个', r.none >= 2, r);
  await goHome(D);
}

// =====================================================================
// 创意工坊触屏（D1–D12）
// =====================================================================
async function openEditor(D) {
  await goHome(D);
  await D.ev(() => { try { localStorage.removeItem('backrooms_workshop_v1'); } catch (e) { /* 忽略 */ } __br.setAuto(true); return 0; });
  await press(D, '.home-secondary-btn', '创意工坊', { exact: true });
  if (!await waitFor(D, () => !!__m.find('.ws-btn-primary', '新建地图'), 10000)) throw new Error('创意工坊列表没打开');
  await sleep(350);
  await newMap(D);
}
async function newMap(D) {
  await press(D, '.ws-btn-primary', '新建地图');
  if (!await waitFor(D, () => !!__m.find('.ws-modal:not([hidden]) .ws-btn-primary', '创建'), 8000)) throw new Error('新建地图弹窗没打开');
  await sleep(250);
  await press(D, '.ws-modal:not([hidden]) .ws-btn-primary', '创建');
  await D.page.waitForFunction(() => BR.workshop.active && BR.workshop.editing, null, { timeout: 45000 });
  await sleep(1300);
}
// 竖屏工具栏横向超宽：先把按钮滚进视口再点（单指横滑可达已由 D 批实测，这里只为省步骤）
async function tool(D, text) {
  await D.ev(tx => {
    const b = __m.find('.ws-toolbar .ws-tool-btn', tx), tb = document.querySelector('.ws-toolbar');
    if (b && tb) { const r = b.getBoundingClientRect(); if (r.right > innerWidth || r.left < 0) tb.scrollLeft += r.left - innerWidth / 2 + r.width / 2; }
    return 0;
  }, text);
  await sleep(150);
  await press(D, '.ws-toolbar .ws-tool-btn', text);
  await sleep(450);
}
async function leaveEditor(D) {
  await D.t.upAll();
  await D.ev(() => {
    const m = document.querySelector('.ws-editor .ws-modal:not([hidden])');
    if (m) { const c = Array.from(m.querySelectorAll('.ws-btn')).find(b => b.textContent.trim() === '取消'); if (c) c.click(); }
    const x = document.querySelector('.ws-panelslide:not([hidden]) .ws-close');
    if (x) x.click();
    return 0;
  });
  await sleep(200);
  if (await D.ev(() => document.querySelector('.ws-editor') && document.querySelector('.ws-editor').classList.contains('is-preview'))) {
    await press(D, '.ws-preview-btn');
    await sleep(400);
  }
  await press(D, '.ws-bottombar .ws-tool-btn', '退出');
  await sleep(600);
  const title = await D.ev(() => (__m.find('.ws-modal:not([hidden]) .ws-title') || {}).textContent || null);
  if (title === '未保存的改动') { await press(D, '.ws-modal:not([hidden]) .ws-btn-danger', '离开'); await sleep(600); }
  await D.ev(() => { if (BR.workshopUI.isOpen) BR.workshopUI.close(); return 0; });
  await waitFor(D, () => BR.game.screen === 'home' && !BR.workshopUI.isOpen, 10000);
  await sleep(400);
}
function wsPanelHits() {
  const btns = Array.from(document.querySelectorAll('.ws-bottombar .ws-tool-btn, .ws-toolbar .ws-tool-btn')).filter(b => __m.vis(b));
  const out = btns.map(b => { const h = __m.hit(b); return { t: b.textContent, inView: __m.inView(h.b), hit: h.ok, by: h.by }; });
  const p = document.querySelector('.ws-panelslide');
  return { bad: out.filter(x => x.inView && !x.hit), checked: out.filter(x => x.inView).length, kind: p ? p.dataset.kind : null, panel: p && !p.hidden ? __m.box(p) : null };
}
async function d6(D, label) {
  const ph = await D.ev(wsPanelHits);
  D.data.d6 = D.data.d6 || {};
  D.data.d6[label] = ph;
  D.check('D6 ' + label + '面板打开时撤销/重做/保存/退出与工具栏按钮中心都命中自身', ph.kind && ph.bad.length === 0 && ph.checked >= 4, ph);
}
function hintInfo() {
  const e = document.querySelector('.ws-hint');
  return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, h: +e.getBoundingClientRect().height.toFixed(1) };
}
async function placeEntity(D) {
  await press(D, '.ws-ent-btn');
  await sleep(350);
  const fp = await D.ev(() => __m.free());
  if (!fp) throw new Error('找不到可放实体的空白点');
  await D.t.tap(fp.x, fp.y);
  await sleep(450);
  return fp;
}

async function d11d7Entity(D) {
  const labels0 = await D.ev(() => __m.qa('.ws-panelslide-body .ws-group-label').map(e => e.textContent));
  await press(D, '.ws-ent-btn');
  await sleep(350);
  const rows0 = await D.ev(() => document.querySelectorAll('.ws-panelslide-body .ws-placed-list .ws-exit-row').length);
  const fp = await D.ev(() => __m.free());
  if (!fp) throw new Error('找不到可放实体的空白点');
  await D.t.tap(fp.x, fp.y);
  await sleep(450);
  const placed = await D.ev(() => {
    const labels = __m.qa('.ws-panelslide-body .ws-group-label').map(e => e.textContent);
    return { n: BR.workshop.active.entities.length, rows: document.querySelectorAll('.ws-panelslide-body .ws-placed-list .ws-exit-row').length, placedLabel: (document.querySelector('.ws-placed-label') || {}).textContent, labels };
  });
  D.check('D11 放置实体后 .ws-placed-list 行数 +1，分组标题不被改写', placed.n === 1 && placed.rows === rows0 + 1 && placed.labels[1] === labels0[1] && /已放置（1）/.test(placed.placedLabel || ''), { rows0, placed, label1Before: labels0[1] });
  // 隐形命中圆只在要拖标记的「选择」工具下铺：墙、出生点、放实体工具要能点到实体旁边的地图（见 D8b），切到选择工具再量
  await tool(D, '选择');
  const d7 = await D.ev(() => {
    const r = __m.box('.ws-ent-dot');
    const at = (dx, dy) => __m.cls(document.elementFromPoint(r.cx + dx, r.cy + dy));
    return { at18: [at(18, 0), at(-18, 0), at(0, 18), at(0, -18)], dot: [r.w, r.h] };
  });
  D.check('D7 选择工具下离实体中心 18px 处 elementFromPoint 为 .ws-hit 或 .ws-ent-dot', d7.at18.every(c => /ws-hit|ws-ent-dot/.test(c || '')), d7);
}

async function d4(D) {
  const W = D.dev.w, H = D.dev.h;
  await press(D, '.ws-panelslide .ws-btn-primary');
  await sleep(350);
  let pt = { x: Math.round(W * 0.3), y: Math.round(H * 0.22) };
  const ptHit = await D.ev(p => __m.cls(document.elementFromPoint(p.x, p.y)), pt);
  if (!/ws-stage/.test(ptHit || '')) pt = await D.ev(p => __m.free(p.x, p.y), pt);
  if (!pt) throw new Error('找不到可点的地图空白处');
  await D.t.tap(pt.x, pt.y);
  await sleep(600);
  const open = await D.ev(() => { const m = document.querySelector('.ws-editor .ws-modal'); return !!m && !m.hidden; });
  D.check('D4 402×874 出口工具点「＋ 添加出口」再点地图：出口弹窗 hidden 为 false', open, { pt, ptHit });
  if (!open) return;
  await D.ev(() => { document.querySelector('.ws-editor .ws-modal .ws-input').scrollIntoView({ block: 'nearest' }); return 0; });
  await sleep(250);
  const inp = await D.ev(() => {
    const i = document.querySelector('.ws-editor .ws-modal .ws-input');
    const body = i.closest('.ws-body') || i.parentElement;
    const br = body.getBoundingClientRect(), r = i.getBoundingClientRect();
    const top = Math.max(r.top, br.top), bot = Math.min(r.bottom, br.bottom);
    const x = r.left + r.width * 0.3, y = (top + bot) / 2;
    return { x, y, visH: +(bot - top).toFixed(1), hitAt: __m.cls(document.elementFromPoint(x, y)) };
  });
  await D.t.tap(inp.x, inp.y);
  await sleep(400);
  const act = await D.ev(() => document.activeElement === document.querySelector('.ws-editor .ws-modal .ws-input'));
  D.check('D4 触摸出口弹窗的标签输入框后 activeElement 就是它', act, inp);
  await D.ev(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const m = document.querySelector('.ws-editor .ws-modal');
    const c = m && Array.from(m.querySelectorAll('.ws-btn')).find(b => b.textContent.trim() === '取消');
    if (c) c.click();
    return 0;
  });
  await sleep(300);
}

async function d10(D) {
  const fieldRect = () => D.ev(() => {
    const f = __m.qa('.ws-panelslide-body .ws-set-field').find(x => x.textContent.indexOf('灯光亮度倍率') >= 0);
    return f ? __m.box(f.querySelector('input[type=range]')) : null;
  });
  await D.ev(() => {
    const f = __m.qa('.ws-panelslide-body .ws-set-field').find(x => x.textContent.indexOf('灯光亮度倍率') >= 0);
    if (f) f.querySelector('input[type=range]').scrollIntoView({ block: 'center' });
    return 0;
  });
  await sleep(300);
  const r = await fieldRect();
  if (!r) throw new Error('找不到「灯光亮度倍率」滑条');
  const v0 = await D.ev(() => BR.workshop.active.settings.lightMul);
  await D.t.drag(r.l + r.w * 0.6, r.cy, r.l + r.w * 0.95, r.cy, 12, 16);
  await sleep(250);
  const v1 = await D.ev(() => BR.workshop.active.settings.lightMul);
  await press(D, '.ws-bottombar .ws-tool-btn', '撤销');
  await sleep(450);
  const v2 = await D.ev(() => BR.workshop.active.settings.lightMul);
  D.check('D10 设置滑条一次触摸拖动后，点 1 次撤销即复原', v1 !== v0 && v2 === v0, { v0, v1, v2 });
}

async function d8(D) {
  await tool(D, '删/加墙');
  const edge = await D.ev(() => {
    const p = BR.player, e = BR.workshop.edgeAt(p.x, p.z);
    if (!e) return null;
    const a = __m.w2c(e.x0, e.z0), b = __m.w2c(e.x1, e.z1);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return { key: e.key, mx, my, lenPx: +Math.hypot(b.x - a.x, b.y - a.y).toFixed(1), hit: __m.cls(document.elementFromPoint(mx, my)) };
  });
  if (!edge) throw new Error('出生点附近找不到格子边');
  const w0 = await D.ev(() => BR.workshop.active.walls.length);
  await D.t.down(1, edge.mx, edge.my);
  await sleep(150);
  const pressed = await D.ev(() => ({ hi: document.querySelectorAll('.ws-edge-hi').length, walls: BR.workshop.active.walls.length }));
  await D.t.up(1);
  await sleep(350);
  const released = await D.ev(() => { const w = BR.workshop.active.walls; return { walls: w.length, last: w[w.length - 1] || null }; });
  D.check('D8 触屏墙工具按下后 .ws-edge-hi 数量为 1 且 walls 未变', pressed.hi === 1 && pressed.walls === w0, { edge, pressed, w0 });
  D.check('D8 抬起后 walls +1', released.walls === w0 + 1 && !!released.last && released.last.k === edge.key, released);
  await sleep(300);
  const w1 = await D.ev(() => BR.workshop.active.walls.length);
  await D.t.drag(edge.mx, edge.my, edge.mx + 30, edge.my + 12, 6, 16);
  await sleep(300);
  const w2 = await D.ev(() => BR.workshop.active.walls.length);
  D.check('D8 拖动超过 slop 时 walls 不变', w2 === w1, { w1, w2 });
}

// 触屏给实体叠了 44px 的隐形命中圆：墙工具、出生点工具点在实体旁边的格子边 / 地面上时，不能被它截走
function nearEntityPoint(a) {
  const r = __m.box('.ws-ent-dot'), st = document.querySelector('.ws-stage');
  if (!r) return null;
  for (const [dx, dy] of [[a.d, 0], [-a.d, 0], [0, a.d], [0, -a.d]]) {
    const px = r.cx + dx, py = r.cy + dy, top = document.elementFromPoint(px, py);
    // 只要落在舞台或俯视标记层上的点：落到工具栏、提示条上的不算
    if (!top || !(top === st || (top.closest && top.closest('.ws-svg')))) continue;
    const w = __m.s2w(px, py), e = a.edge ? BR.workshop.edgeAt(w.x, w.z) : null;
    if (a.edge && !e) continue;
    return { dx, dy, px, py, w: { x: +w.x.toFixed(3), z: +w.z.toFixed(3) }, key: e ? e.key : null, top: __m.cls(top) };
  }
  return null;
}
async function d8near(D) {
  const ent = () => D.ev(() => { const e = BR.workshop.active.entities[0]; return e ? { x: e.x, z: e.z } : null; });
  const e0 = await ent();
  if (!e0) throw new Error('没有已放置的实体');
  await tool(D, '删/加墙');
  const pk = await D.ev(nearEntityPoint, { d: 14, edge: true });
  if (!pk) throw new Error('实体中心旁 14px 处找不到格子边');
  const w0 = await D.ev(() => BR.workshop.active.walls.length);
  await D.t.tap(pk.px, pk.py);
  await sleep(450);
  const wa = await D.ev(() => { const w = BR.workshop.active.walls; return { walls: w.length, last: w[w.length - 1] || null }; });
  const e1 = await ent();
  D.check('D8b 墙工具触摸实体中心旁 14px 的格子边：walls +1 且实体坐标不变', wa.walls === w0 + 1 && !!wa.last && wa.last.k === pk.key && e1.x === e0.x && e1.z === e0.z, { pk, w0, after: wa, e0, e1 });

  await tool(D, '出生点');
  const sp = await D.ev(nearEntityPoint, { d: 16, edge: false });
  if (!sp) throw new Error('实体中心旁 16px 处找不到可点的地面');
  const s0 = await D.ev(() => JSON.stringify(BR.workshop.active.spawn || null));
  await D.t.tap(sp.px, sp.py);
  await sleep(450);
  const s1 = await D.ev(() => BR.workshop.active.spawn || null);
  const e2 = await ent();
  const errM = s1 ? +Math.hypot(s1.x - sp.w.x, s1.z - sp.w.z).toFixed(3) : null;
  D.check('D8b 出生点工具触摸实体中心旁 16px：spawn 落到手指处（误差 <0.5m）且实体坐标不变', !!s1 && JSON.stringify(s1) !== s0 && errM < 0.5 && e2.x === e0.x && e2.z === e0.z, { sp, before: s0, spawn: s1, errM, e0, e2 });
}

// 实体面板很长、出口面板很短，共用一个滚动容器：实体面板滚到底后切「出口」，不能沿用滚动位置把「＋ 添加出口」挤出可视区
async function d11b(D) {
  const W = D.dev.w, H = D.dev.h;
  const label = 'D11b 实体面板上滑到底后切「出口」：「＋ 添加出口」中心 elementFromPoint 命中自身';
  const tries = [];
  let res = null;
  try {
    // 出口面板本身不用滚动时，沿用的滚动位置会被浏览器夹回 0，测不出问题：依次把视口压矮，直到出口面板需要滚动
    for (const h of [H, Math.round(H * 0.8), Math.round(H * 0.68)]) {
      if (h !== H) { await D.page.setViewportSize({ width: W, height: h }); await sleep(450); }
      await tool(D, '放实体');
      const body = await D.ev(() => __m.box('.ws-panelslide-body'));
      for (let s = 0; s < 2; s++) {
        await D.t.drag(body.l + 30, body.b - 12, body.l + 30, body.t + 12, 10, 16);
        await sleep(250);
      }
      // 先确认触摸真能滚，再直接滚到底：实体列表有几千像素，真拖到底要几十下
      const entity = await D.ev(() => {
        const b = document.querySelector('.ws-panelslide-body'), touched = Math.round(b.scrollTop);
        b.scrollTop = b.scrollHeight;
        return { kind: document.querySelector('.ws-panelslide').dataset.kind, touched, st: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight };
      });
      await sleep(250);
      await tool(D, '出口');
      const exit = await D.ev(() => {
        const b = document.querySelector('.ws-panelslide-body'), arm = document.querySelector('.ws-panelslide-body > .ws-btn-primary');
        return { kind: document.querySelector('.ws-panelslide').dataset.kind, st: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight, body: __m.box(b), text: arm ? arm.textContent : null, hit: arm ? __m.hit(arm) : null };
      });
      res = { vh: h, entity, exit };
      // 出口面板至少要能滚一个按钮高：只多出几像素时，沿用的滚动位置夹回去也挤不走「＋ 添加出口」，这次就测不出问题
      const need = exit.hit && exit.hit.b ? exit.hit.b.h : 44;
      tries.push({ vh: h, exitMax: exit.max, need });
      if (exit.max >= need) break;
    }
  } finally {
    const vp = D.page.viewportSize();
    if (!vp || vp.height !== H) { await D.page.setViewportSize({ width: W, height: H }); await sleep(600); }
  }
  const last = tries[tries.length - 1];
  if (!res || !last || last.exitMax < last.need) { D.skip(label, '出口面板在这几个视口高度下都滚不出一个按钮高，沿用滚动位置的问题测不出：' + JSON.stringify(tries)); return; }
  D.check(label, res.entity.kind === 'entity' && res.entity.touched > 0 && res.entity.st >= res.entity.max - 1 && res.exit.kind === 'exit' && !!res.exit.hit && res.exit.hit.ok, Object.assign({ tries }, res));
}

async function d3(D) {
  await tool(D, '选择');
  const ent = () => D.ev(() => { const e = BR.workshop.active.entities[0]; const s = __m.w2c(e.x, e.z); return { x: e.x, z: e.z, sx: +s.x.toFixed(1), sy: +s.y.toFixed(1) }; });
  await ent();
  const dot = await D.ev(() => __m.box('.ws-ent-dot'));
  const to = { x: dot.cx + 80, y: dot.cy + 40 };
  await D.t.drag(dot.cx, dot.cy, to.x, to.y, 10, 16);
  await sleep(250);
  const e1 = await ent();
  D.check('D3 触摸拖实体圆点 89px：实体投影离手指终点 <3px', Math.hypot(e1.sx - to.x, e1.sy - to.y) < 3, { distPx: +Math.hypot(e1.sx - to.x, e1.sy - to.y).toFixed(1), e1, to });
  const pan = await D.ev(() => __m.free(innerWidth * 0.3, innerHeight * 0.6));
  await D.t.drag(pan.x, pan.y, pan.x - 50, pan.y - 40, 10, 16);
  await sleep(250);
  const e2 = await ent();
  D.check('D3 随后在空白处平移，实体世界坐标不变', e2.x === e1.x && e2.z === e1.z, { e1, e2 });

  // 出口图标：触屏默认高度较低，图标常在屏外，先平移把离中心最近的一个拖进来
  const W = D.dev.w, H = D.dev.h;
  const findIcon = () => D.ev(() => {
    const icons = __m.qa('.ws-exit-icon:not(.is-added)').map(i => ({ key: i.dataset.key, c: __m.box(i) }));
    const ok = icons.find(i => {
      const c = i.c;
      if (!(c.cx > 60 && c.cy > 110 && c.cx < innerWidth - 100 && c.cy < innerHeight - 130)) return false;
      const h = document.elementFromPoint(c.cx, c.cy);
      return !!h && h.dataset && h.dataset.key === i.key;
    });
    return { ok: ok || null, all: icons };
  });
  let f = await findIcon();
  for (let k = 0; k < 12 && !f.ok && f.all.length; k++) {
    const t = f.all.sort((a, b) => Math.hypot(a.c.cx - W / 2, a.c.cy - H / 2) - Math.hypot(b.c.cx - W / 2, b.c.cy - H / 2))[0];
    const p = await D.ev(() => __m.free(innerWidth / 2, innerHeight / 2));
    const lim = Math.min(W, H) * 0.3;
    let dx = W / 2 - t.c.cx, dy = H / 2 - t.c.cy;
    const m = Math.hypot(dx, dy);
    if (m > lim) { dx *= lim / m; dy *= lim / m; }
    await D.t.drag(p.x, p.y, p.x + dx, p.y + dy, 10, 16);
    await sleep(250);
    f = await findIcon();
  }
  if (!f.ok) { D.check('D3 找到可拖的出口图标', false, { icons: f.all.length }); return; }
  const key = f.ok.key;
  const mv = () => D.ev(k => { const m = BR.workshop.active.exits.moved.find(x => String(x.key) === String(k)); if (!m) return null; const s = __m.w2c(m.x, m.z); return { x: m.x, z: m.z, sx: +s.x.toFixed(1), sy: +s.y.toFixed(1) }; }, key);
  const to2 = { x: f.ok.c.cx + 60, y: f.ok.c.cy + 30 };
  await D.t.drag(f.ok.c.cx, f.ok.c.cy, to2.x, to2.y, 10, 16);
  await sleep(500);
  const m1 = await mv();
  D.check('D3 触摸拖出口图标：出口投影离手指终点 <3px', !!m1 && Math.hypot(m1.sx - to2.x, m1.sy - to2.y) < 3, { m1, to2 });
  const p2 = await D.ev(() => __m.free(innerWidth * 0.3, innerHeight * 0.4));
  await D.t.drag(p2.x, p2.y, p2.x + 40, p2.y + 40, 10, 16);
  await sleep(500);
  const m2 = await mv();
  D.check('D3 随后在空白处平移，出口世界坐标不变', !!m1 && !!m2 && m2.x === m1.x && m2.z === m1.z, { m1, m2 });
}

async function d9(D) {
  const W = D.dev.w;
  await tool(D, '选择');
  let P = null;
  for (const f of [[0.25, 0.35], [0.3, 0.45], [0.7, 0.35], [0.65, 0.5], [0.35, 0.6]]) {
    const c = await D.ev(a => __m.free(innerWidth * a[0], innerHeight * a[1]), f);
    if (c && Math.abs(c.x - W / 2) > W * 0.12) { P = c; break; }
  }
  if (!P) throw new Error('找不到偏心空白点');
  const W0 = await D.ev(p => __m.s2w(p.x, p.y), P);
  const alt0 = await D.ev(() => BR.gfx.camera.position.y);
  const spread = Math.max(80, Math.min(200, 2 * Math.min(P.x, W - P.x) - 12));
  const a = 700, b = 701, n = 10, d0 = 40;
  await D.t.down(a, P.x - d0 / 2, P.y);
  await D.t.down(b, P.x + d0 / 2, P.y);
  for (let i = 1; i <= n; i++) {
    const d = d0 + (spread - d0) * i / n;
    await D.t.moveMany([[a, P.x - d / 2, P.y], [b, P.x + d / 2, P.y]]);
    await sleep(16);
  }
  await D.t.up(a);
  await D.t.up(b);
  await sleep(300);
  const pa = await D.ev(x => { const s = __m.w2c(x.W0.x, x.W0.z); return { driftPx: +Math.hypot(s.x - x.P.x, s.y - x.P.y).toFixed(1), altAfter: +BR.gfx.camera.position.y.toFixed(1) }; }, { P, W0 });
  D.check('D9 偏心位置双指捏合：两指中点下的世界点屏幕偏移 <20px', pa.driftPx < 20 && pa.altAfter < alt0 - 1, Object.assign({ P, spread, alt0: +alt0.toFixed(1) }, pa));
}

async function d5(D) {
  const W = D.dev.w, H = D.dev.h;
  await tool(D, '出生点');
  let d;
  try {
    await D.page.setViewportSize({ width: H, height: W });
    await sleep(150);
    const P = await D.ev(() => __m.free());
    if (!P) throw new Error('转屏后找不到地图空白处');
    await D.t.tap(P.x, P.y);
    await sleep(300);
    d = await D.ev(p => {
      BR.gfx.resize();
      BR.gfx.camera.updateMatrixWorld(true);
      const s = BR.workshop.active.spawn, w = __m.s2w(p.x, p.y);
      return { errM: +Math.hypot(s.x - w.x, s.z - w.z).toFixed(3), P: p, vw: innerWidth, vh: innerHeight };
    }, P);
  } finally {
    await D.page.setViewportSize({ width: W, height: H });
    await sleep(700);
  }
  D.check('D5 交换视口宽高后立即用出生点工具点地图：spawn 与手指换算的世界坐标误差 <0.5m', d.errM < 0.5, d);
}

// 预览循环每帧步长封顶 0.05s：机器忙、帧率低时按时间等会走不出距离，按 stepFp 写相机的次数等
async function waitFpFrames(D, frames, minMs) {
  await D.ev(() => { window.__fpCalls = 0; return 0; });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const n = await D.ev(() => window.__fpCalls || 0);
    if (n >= frames && Date.now() - t0 >= (minMs || 0)) break;
    await sleep(80);
  }
}
async function holdDrag(D, x0, y0, x1, y1, holdMs) {
  const id = 900;
  await D.t.down(id, x0, y0);
  for (let i = 1; i <= 6; i++) { await D.t.move(id, x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await sleep(16); }
  if (holdMs) await waitFpFrames(D, 20, holdMs);
  await D.t.up(id);
  await sleep(150);
}

async function d1(D) {
  const W = D.dev.w, H = D.dev.h;
  await D.ev(() => {
    __m.hookRender();
    window.__fpCalls = 0;
    const E = BR.gfx.camera.rotation;
    if (!window.__rotSetOrig) {
      window.__rotSetOrig = E.set;
      const orig = E.set.bind(E);
      E.set = function () { if (String(new Error().stack).indexOf('stepFp') >= 0) window.__fpCalls++; return orig.apply(null, arguments); };
    }
    return 0;
  });
  try {
    await tool(D, '3D 预览');
    // 预览说明走 toast（3.6 秒）：点完立刻读，机器忙时等几帧再读就过期了
    const ph = await D.ev(() => {
      const t = document.querySelector('.ws-toast'), h = document.querySelector('.ws-hint');
      return { toast: t && !t.hidden ? t.textContent : null, hint: h ? h.textContent : null, hintVis: __m.vis(h) };
    });
    await waitFor(D, () => __m.lastRender(1).some(r => r.near <= 0.1), 8000);
    await sleep(200);
    const p1 = await D.ev(() => ({ btn: document.querySelector('.ws-preview-btn').textContent, near: BR.gfx.camera.near, rend: __m.lastRender(3) }));
    D.check('D1 触摸「3D 预览」：按钮文字变「返回俯视」、camera.near ≤0.1', p1.btn === '返回俯视' && p1.near <= 0.1, { btn: p1.btn, near: p1.near });
    D.check('D1b 预览中底栏 .ws-hint 不再是俯视的说明（不含「平移」「按住实体」，收起也算）', !ph.hintVis || !/平移|按住实体/.test(ph.hint || ''), ph);
    D.check('D1 预览推一帧后 renderer.info.render.triangles >0', p1.rend.some(r => r.near <= 0.1 && r.tri > 0), p1.rend);
    let moved = null;
    for (const dy of [-60, 60]) {
      const c0 = await D.ev(() => __m.cam());
      await holdDrag(D, W * 0.25, H * 0.6, W * 0.25, H * 0.6 + dy, 700);
      const c1 = await D.ev(() => __m.cam());
      const dist = Math.hypot(c1.x - c0.x, c1.z - c0.z);
      if (dist > 0.2) { moved = { dy, dist: +dist.toFixed(2) }; break; }
    }
    D.check('D1 预览中左半屏拖动后位置变化', !!moved, moved);
    const q0 = await D.ev(() => __m.cam());
    await holdDrag(D, W * 0.75, H * 0.5, W * 0.75 - 100, H * 0.45, 0);
    await sleep(200);
    const q1 = await D.ev(() => __m.cam());
    D.check('D1 预览中右半屏拖动后 rotation 变化、位置不变', (q1.qy !== q0.qy || q1.qx !== q0.qx) && Math.hypot(q1.x - q0.x, q1.z - q0.z) < 0.02, { q0, q1 });
    await press(D, '.ws-preview-btn');
    await sleep(500);
    const back = await D.ev(() => ({ upY: BR.gfx.camera.up.y, btn: document.querySelector('.ws-preview-btn').textContent, preview: document.querySelector('.ws-editor').classList.contains('is-preview') }));
    D.check('D1 触摸「返回俯视」后 camera.up.y ≠1', back.upY !== 1 && back.btn === '3D 预览' && !back.preview, back);

    // 预览中直接点「退出」：预览循环必须停掉，再进编辑器能正常平移
    await tool(D, '3D 预览');
    await press(D, '.ws-bottombar .ws-tool-btn', '退出');
    await sleep(600);
    const conf = await D.ev(() => (__m.find('.ws-modal:not([hidden]) .ws-title') || {}).textContent || null);
    if (conf === '未保存的改动') { await press(D, '.ws-modal:not([hidden]) .ws-btn-danger', '离开'); await sleep(500); }
    await D.ev(() => { window.__fpCalls = 0; return 0; });
    await sleep(600);
    const after = await D.ev(() => ({ calls: window.__fpCalls, preview: document.querySelector('.ws-editor').classList.contains('is-preview'), screen: BR.game.screen }));
    D.check('D1 预览中直接点「退出」回主页，600ms 内 stepFp 调 camera.rotation.set 0 次', after.calls === 0 && !after.preview && after.screen === 'home', Object.assign({ conf }, after));
    await newMap(D);
    const r0 = await D.ev(() => __m.cam());
    const rp = await D.ev(() => __m.free());
    await D.t.drag(rp.x, rp.y, rp.x + 60, rp.y + 50, 10, 16);
    await sleep(300);
    const r1 = await D.ev(() => __m.cam());
    D.check('D1 再进编辑器，单指平移使俯视相机中心变化', r0.upY !== 1 && (r1.x !== r0.x || r1.z !== r0.z), { r0, r1 });
  } finally {
    await D.ev(() => {
      if (window.__rotSetOrig) { BR.gfx.camera.rotation.set = window.__rotSetOrig; window.__rotSetOrig = null; }
      __m.unhookRender();
      return 0;
    });
  }
}

async function d2(D) {
  await D.ev(() => { __br.setAuto(false); __br.start({ mode: 'casual', levelId: '0', seed: 11 }); return 0; });
  await D.page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 90000 });
  const c = await D.ev(camFov);
  const portrait = D.dev.h > D.dev.w;
  const want = D.data.gameFov ? D.data.gameFov.fov : c.expect;
  if (portrait) D.check('D2 进出工坊后开局，fov 与直接开局相同', Math.abs(c.fov - want) < 0.05, { after: c, direct: want });
  else D.check('D2 进出工坊后开局，横屏 fov 为 75', Math.abs(c.fov - 75) < 1e-3, c);
  await goHome(D);
}

async function secWorkshop(D) {
  const k = D.key, W = D.dev.w, H = D.dev.h, portrait = H > W;
  await openEditor(D);
  const hints = [];
  const hint = async name => hints.push(Object.assign({ tool: name }, await D.ev(hintInfo)));
  await hint('select');
  if (portrait) {
    const lay = await D.ev(() => {
      const tb = document.querySelector('.ws-toolbar'), sec = document.querySelector('.ws-section');
      const cs = getComputedStyle(tb);
      const mask = [cs.maskImage, cs.webkitMaskImage].find(v => v && v !== 'none') || cs.maskImage || cs.webkitMaskImage || null;
      return { secH: sec ? +sec.getBoundingClientRect().height.toFixed(1) : null, mask };
    });
    D.data.d12 = lay;
    D.check('D12 竖屏 .ws-section 高 ≤60px', lay.secH != null && lay.secH <= 60, lay);
    D.check('D12 竖屏工具栏 computed mask-image 不是 none', !!lay.mask && lay.mask !== 'none', lay.mask);
  }
  if (k === 'android-l') await sub(D, 'D9', () => d9(D));

  await tool(D, '放实体');
  await hint('entity');
  await d6(D, '实体');
  if (k === 'iphone-p') await sub(D, 'D11/D7 实体', () => d11d7Entity(D));
  if (k === 'iphone-l') await sub(D, '放实体', () => placeEntity(D));
  if (k === 'android-p') await sub(D, 'D11b', () => d11b(D));

  await tool(D, '出口');
  await hint('exit');
  await d6(D, '出口');
  if (k === 'iphone-p') {
    const ex = await D.ev(() => {
      const b = document.querySelector('.ws-panelslide-body .ws-icon-btn');
      const r = b ? b.getBoundingClientRect() : null;
      return { rows: document.querySelectorAll('.ws-panelslide-body .ws-exit-row').length, icon: r ? [+r.width.toFixed(1), +r.height.toFixed(1)] : null };
    });
    D.check('D11 出口面板首次打开时行数 >0', ex.rows > 0, ex);
    D.check('D7 .ws-icon-btn ≥44×44', !!ex.icon && ex.icon[0] >= 44 && ex.icon[1] >= 44, ex.icon);
    await sub(D, 'D4', () => d4(D));
  }
  if (k === 'iphone-l') {
    if (D.envOk) {
      const sa = await D.ev(() => ({ closeR: +document.querySelector('.ws-panelslide .ws-close').getBoundingClientRect().right.toFixed(1), vw: innerWidth }));
      D.check('D12 横屏注入安全区 62 时，面板 × 右缘 ≤ 视口宽−62', sa.closeR <= sa.vw - 62 + 0.5, Object.assign({ env: D.env }, sa));
    } else D.skip('D12 横屏注入安全区 62 时，面板 × 右缘 ≤ 视口宽−62', D.envWhy);
  }

  await tool(D, '基本设置');
  await d6(D, '设置');
  if (k === 'iphone-p') await sub(D, 'D10', () => d10(D));
  await D.ev(() => { const x = document.querySelector('.ws-panelslide:not([hidden]) .ws-close'); if (x) x.click(); return 0; });
  await sleep(300);

  if (k === 'iphone-l') {
    await sub(D, 'D8', () => d8(D));
    await sub(D, 'D8b', () => d8near(D));
    await sub(D, 'D3', () => d3(D));
  }
  if (portrait) {
    await tool(D, '删/加墙');
    await hint('wall');
    await tool(D, '出生点');
    await hint('spawn');
    const bad = hints.filter(h => h.sw > h.cw + 1);
    D.data.d12hints = hints;
    D.check('D12 竖屏各工具 .ws-hint scrollWidth ≤ clientWidth+1', bad.length === 0, hints);
  }
  if (k === 'android-l') {
    await sub(D, 'D5', () => d5(D));
    await sub(D, 'D1', () => d1(D));
  }
  await leaveEditor(D);
  if (k === 'android-l' || k === 'iphone-p') await sub(D, 'D2', () => d2(D));
}

// =====================================================================
// 每台设备跑哪些段（同一项检查只在计划点名的设备上跑，控制总时长）
// =====================================================================
const PLANS = {
  'android-p': [
    ['basics', secBasics],                                                                           // G1 E6 C3 C9 E9
    ['home', async D => { await secHint(D); await openDialog(D, 'casual'); await c1(D, true); await c7Home(D); await closeModals(D); }],   // C4 C1 C7
    ['lobby', secLobbyBack],                                                                         // B3
    ['settings', secSettingsAndroidP],                                                               // C6 C7 C8
    ['credits', secCredits],                                                                         // C9
    ['history', secGameBack],                                                                        // E1 E2
    ['guest', secGuestBack],                                                                         // 大厅客机开局 → 回主页的返回键
    ['game', secGame],                                                                               // E3 E4 A1 A3 A2 A12
    ['workshop', secWorkshop],                                                                       // D6 D12
  ],
  'android-l': [
    ['basics', secBasics],
    ['home', async D => { await openDialog(D, 'casual'); await c1(D, true); await closeModals(D); await c2(D); }],   // C1 C2
    ['lobby', secLobbyConfirm],                                                                      // B2 B1
    ['settings', secSettingsLayout],                                                                 // C5
    ['game', secGame],                                                                               // E3 E4 A1 A6 A5 A7 A4
    ['coop', secCoop],                                                                               // B6 B4 B5
    ['ctx', secCtx],                                                                                 // E5
    ['render', secRender],                                                                           // E8
    ['test', secTest],                                                                               // A4 A10 A11
    ['toast', secToastL16],                                                                          // A9
    ['sanity', secSanity],                                                                           // E7
    ['workshop', secWorkshop],                                                                       // D6 D9 D5 D1 D2
  ],
  'iphone-p': [
    ['basics', secBasics],                                                                           // + B8（iOS）
    ['home', secHomeIphoneP],                                                                        // C1 C10
    ['settings', secSettingsLayout],                                                                 // C5
    ['game', secGame],                                                                               // E3 E4 A1 A2 A6 A12 A14 A13
    ['workshop', secWorkshop],                                                                       // D6 D12 D11 D7 D4 D10 D2
  ],
  'iphone-l': [
    ['basics', secBasics],
    ['home', async D => { await openDialog(D, 'casual'); await c1(D, true); await closeModals(D); }],   // C1
    ['lobby', secLobbyConfirm],                                                                      // B1
    ['settings', secSettingsLayout],                                                                 // C5
    ['game', secGame],                                                                               // E3 E4 A1 A6 A8
    ['coop', secCoop],                                                                               // B4
    ['test', secTest],                                                                               // A10 A11
    ['workshop', secWorkshop],                                                                       // D6 D12 D8 D3
  ],
  'ipadmini-p': [
    ['basics', secBasics],
    ['net', secNet],                                                                                 // B7 B8
    ['workshop', secWorkshop],                                                                       // D6
  ],
  'ipadair-l': [
    ['basics', secBasics],                                                                           // E6
    ['workshop', secWorkshop],                                                                       // D6
  ],
  desktop: [
    ['esc', secDesktopEsc],                                                                          // 桌面 Esc 只关大厅
  ],
};

async function runDevice(browser, base, key) {
  const t0 = Date.now();
  console.log('\n===== ' + key + ' ' + DEVICES[key].w + '×' + DEVICES[key].h);
  const D = await openDevice(browser, base, key);
  try {
    await boot(D, !!DEVICES[key].blankFirst);
    for (const [name, fn] of PLANS[key]) await phase(D, name, fn);
  } catch (err) {
    D.check('设备流程未中断', false, String(err && err.stack || err).slice(0, 900));
  } finally {
    D.check('G2 console.error 与 pageerror 为 0', D.errs.length === 0, D.errs.slice(0, 5));
    D.check('G3 非 127.0.0.1 的请求被拦截后 blocked 列表为空', D.blocked.length === 0, D.blocked.slice(0, 5));
    const ms = Date.now() - t0;
    try {
      fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify({
        key, device: DEVICES[key], ms, data: D.data, checks: results.filter(r => r.dev === key), skipped: skipped.filter(s => s.dev === key), errors: D.errs, blocked: D.blocked,
      }, null, 1) + '\n');
    } catch (e) { /* 写盘失败不影响判定 */ }
    await D.ctx.close().catch(() => {});
    console.log('  (' + key + ' 共 ' + (ms / 1000).toFixed(1) + 's)');
  }
}

async function main() {
  const t0 = Date.now();
  const want = DEV_ARGS.length ? DEV_ARGS : Object.keys(DEVICES);
  const bad = want.filter(k => !DEVICES[k]);
  if (bad.length) { console.log('未知设备：' + bad.join(', ') + '（可选 ' + Object.keys(DEVICES).join(' ') + '）'); process.exitCode = 1; return; }
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    for (const key of want) {
      try { await runDevice(browser, base, key); }
      catch (err) { check(key, '设备流程未中断', false, String(err && err.stack || err).slice(0, 900)); }
    }
  } catch (err) {
    check('-', '测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL [' + f.dev + '] ' + f.name + brief(f.detail));
  if (skipped.length) {
    console.log('跳过 ' + skipped.length + ' 项');
    for (const s of skipped) console.log('  SKIP [' + s.dev + '] ' + s.name + '  ' + s.why);
  }
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e.slice(0, 600));
  console.log('耗时 ' + Math.round((Date.now() - t0) / 1000) + 's；数值结果：' + path.relative(ROOT, OUT) + '/<设备>.json');
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

main();
