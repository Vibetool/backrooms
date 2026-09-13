// 后室 · 双人联机端到端测试：node tests/coop.mjs
// 本地静态服务 + 无头 Chrome 两个独立 context（房主 A / 客机 B）。context.route 拦截 room.php，
// 在测试进程内存里模拟信令服务（照 js/net/net.js 实际发的 action / 参数 / JSON 格式），WebRTC 走本机真实连接。
// 每步打印 PASS/FAIL，截图写 tests/output/coop-*.png，两页全部 console 写 tests/output/coop-console.log。
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
for (const f of fs.readdirSync(OUT)) if (/^coop-.*\.(png|log)$/.test(f)) fs.unlinkSync(path.join(OUT, f));

const VIEW = { width: 800, height: 450 };   // SwiftShader 纯 CPU 渲染，两页同时跑，视口小一点省负载
const OVOBOT_RE = /^https?:\/\/api\.ovobot\.ai\//;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// --disable-audio-output：本机无头 Chrome 的音频输出设备不走时钟（AudioContext.currentTime 1 秒只前进 0.005），
// WebAudio 整条图不出数据，AnalyserNode 永远是 0、WebRTC 也发不出音频包；改用假输出流后正常（实测 RMS≈0.21）
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'];

// 本机无头 Chrome 的真实 getUserMedia（含假设备）若挂起，改用 WebAudio 合成的持续测试音当麦克风轨道。
// 挂起的 getUserMedia 还会把同一浏览器里之后新开的页面卡死（点击、evaluate 都不返回），所以必须事先判定。
let micStub = false;
let micProbe = null;
function fakeMicInit() {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getUserMedia = async function (cons) {
    if (!cons || !cons.audio) throw new DOMException('测试桩只提供音频', 'NotFoundError');
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 440;
    const g = ac.createGain();
    g.gain.value = 0.25;
    const dst = ac.createMediaStreamDestination();
    osc.connect(g).connect(dst);
    osc.start();
    try { await ac.resume(); } catch (err) { /* 自动播放已放开 */ }
    window.__fakeMic = ac;
    return dst.stream;
  };
}
async function realMicWorks(base) {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  try {
    const p = await (await b.newContext()).newPage();
    await p.goto(base + 'tests/home.html').catch(() => {});
    const r = await Promise.race([
      p.evaluate(() => Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'ok'; }, e => 'err ' + e.name),
        new Promise(res => setTimeout(() => res('timeout 5s'), 5000)),
      ])),
      new Promise(res => setTimeout(() => res('node timeout 9s'), 9000)),
    ]);
    return r;
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------- 静态服务（同 smoke.mjs） ----------
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
const warnings = [];
const shots = [];
const T0 = Date.now();
const LOG_FILE = path.join(OUT, 'coop-console.log');
fs.writeFileSync(LOG_FILE, '');
const secs = () => '[' + Math.round((Date.now() - T0) / 1000) + 's] ';
// 边跑边写：流程卡住时也能看到卡在哪
function logLine(line) { try { fs.appendFileSync(LOG_FILE, secs() + line + '\n'); } catch (err) { /* 忽略 */ } }
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const line = (ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '');
  console.log(secs() + line);
  logLine('==== ' + line.slice(0, 300));
}
function info(text, detail) {
  console.log(secs() + 'INFO ' + text + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function watch(page, tag) {
  page.on('console', m => {
    const line = '[' + tag + '] ' + m.type() + ': ' + m.text();
    logLine(line);
    if (m.type() === 'error') errors.push(line + ' @ ' + (m.location().url || ''));
    else if (m.type() === 'warning') warnings.push(line);
  });
  page.on('pageerror', e => {
    const line = '[' + tag + '] pageerror: ' + (e.stack || e.message);
    errors.push(line);
    logLine(line);
  });
}
let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, 'coop-' + String(++shotN).padStart(2, '0') + '-' + name + '.png');
  try {
    await page.screenshot({ path: f });
    shots.push(f);
    console.log('     shot ' + path.relative(ROOT, f));
  } catch (err) {
    console.log('     shot 失败 ' + name + ' ' + err.message);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EV_TIMEOUT = 45000;
// page.evaluate 本身没有超时：页面卡死时整个测试会无限挂住，这里超时就抛错，让该步记 FAIL 继续往下
function ev(page, fn, arg) {
  let timer = 0;
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('page.evaluate 超过 ' + EV_TIMEOUT / 1000 + ' 秒没返回（页面卡死？）')), EV_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
}
async function waitFor(page, fn, arg, timeout) {
  try {
    await page.waitForFunction(fn, arg, { timeout: timeout || 10000, polling: 100 });
    return true;
  } catch (err) {
    return false;
  }
}
async function step(title, fn) {
  console.log('\n----- ' + title + ' -----');
  try {
    await fn();
  } catch (err) {
    check(title + '：流程未中断', false, String(err && err.stack || err).split('\n').slice(0, 4).join(' | '));
  }
}

// =====================================================================
// room.php 模拟（照 net.js：create/join/signal/close 走 POST，status/poll 走 GET；
// 响应一律 { ok, ... }，失败 { ok:false, error }；poll 返回 { last, msgs:[payload...] }）
// =====================================================================
const rooms = new Map();
const sig = { calls: {}, log: [] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let s;
  do {
    s = '';
    for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(s));
  return s;
}
function cleanName(v) { return String(v == null ? '' : v).trim().slice(0, 16); }
function roomApi(q, body) {
  const room = q.code ? rooms.get(String(q.code).toUpperCase()) : null;
  switch (q.action) {
    case 'create': {
      const code = newCode();
      rooms.set(code, { state: 'waiting', host_name: cleanName(body.name), guest_name: '', q: { host: [], guest: [] }, seq: 0 });
      return { ok: true, code };
    }
    case 'join':
      if (!room) return { ok: false, error: 'room_not_found' };
      if (room.state === 'closed') return { ok: false, error: 'room_closed' };
      if (room.state === 'joined') return { ok: false, error: 'room_full' };
      room.state = 'joined';
      room.guest_name = cleanName(body.name);
      return { ok: true, host: room.host_name };
    case 'status':
      if (!room) return { ok: false, error: 'room_not_found' };
      return { ok: true, state: room.state, host_name: room.host_name, guest_name: room.guest_name };
    case 'signal':
      if (!room) return { ok: false, error: 'room_not_found' };
      if (room.state === 'closed') return { ok: false, error: 'room_closed' };
      if (q.to !== 'host' && q.to !== 'guest') return { ok: false, error: 'bad_to' };
      if (!body || body.payload == null) return { ok: false, error: 'bad_payload' };
      room.q[q.to].push({ id: ++room.seq, payload: body.payload });
      return { ok: true };
    case 'poll': {
      if (!room) return { ok: false, error: 'room_not_found' };
      if (room.state === 'closed') return { ok: false, error: 'room_closed' };
      if (q.me !== 'host' && q.me !== 'guest') return { ok: false, error: 'bad_me' };
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
const EXPECT_METHOD = { create: 'POST', join: 'POST', signal: 'POST', close: 'POST', status: 'GET', poll: 'GET' };
const methodMismatch = [];
async function onRoute(route, tag) {
  const req = route.request();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  try {
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors, body: '' }); return; }
    const u = new URL(req.url());
    if (!/\/room\.php$/.test(u.pathname)) {
      await route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' });
      return;
    }
    const q = Object.fromEntries(u.searchParams.entries());
    let body = {};
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw); } catch (err) { body = {}; } }
    if (EXPECT_METHOD[q.action] && EXPECT_METHOD[q.action] !== req.method()) methodMismatch.push(q.action + ' ' + req.method());
    const r = roomApi(q, body);
    sig.calls[q.action] = (sig.calls[q.action] || 0) + 1;
    if (q.action !== 'poll' && q.action !== 'status') {
      const t = body && body.payload && body.payload.t;
      sig.log.push(tag + ' ' + req.method() + ' ' + q.action + (q.code ? ' ' + q.code : '') + (q.to ? ' to=' + q.to : '') + (t ? ' ' + t : '') + ' → ' + JSON.stringify(r).slice(0, 60));
    }
    await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(r) });
  } catch (err) {
    // 页面关闭时（pagehide 里发的 close）fulfill 会失败，忽略
  }
}

// =====================================================================
// 页面
// =====================================================================
async function newContext(browser, tag, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: VIEW }, opts || {}));
  await ctx.route(OVOBOT_RE, route => onRoute(route, tag));
  if (micStub) await ctx.addInitScript(fakeMicInit);
  return ctx;
}
async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  watch(page, tag);
  return page;
}
async function boot(page, base) {
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);
  await page.evaluate(installHelpers);
}

// 页面内工具：toast 记录、伤害/换层计数、对方人形颜色、实体列表、碰撞采样
function installHelpers() {
  const T = window.__t = { toasts: [], dmg: 0, levelEnters: 0, lastEnter: null };
  if (BR.hud && typeof BR.hud.toast === 'function') {
    const orig = BR.hud.toast;
    BR.hud.toast = function (text) { T.toasts.push(String(text)); return orig.apply(this, arguments); };
  }
  BR.bus.on('player:damage', () => { T.dmg++; });
  BR.bus.on('level:enter', p => { T.levelEnters++; T.lastEnter = p && p.id; });
  // 统计客机（authoritative=false）时区块自己生成了多少实体：客机的实体应当全部来自房主快照
  T.guestLocalSpawns = 0;
  const sfc = BR.entities.spawnForChunk;
  BR.entities.spawnForChunk = function () {
    const r = sfc.apply(this, arguments);
    if (!BR.entities.authoritative && Array.isArray(r)) T.guestLocalSpawns += r.length;
    return r;
  };
  T.expectedHex = key => {
    const c = new THREE.Color().setHex(BR.skin.color(key));
    const cm = THREE.ColorManagement;
    if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
    return c.getHex();
  };
  T.peerSuit = () => {
    const o = BR.gfx.scene.getObjectByName('coop-peer');
    if (!o) return null;
    const suit = [];
    o.traverse(m => {
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => {
        if (mt && mt.color && (/^Suit(\.\d+)?$/.test(mt.name || '') || m.userData.suit)) suit.push(mt.color.getHex());
      });
    });
    return { visible: o.visible, x: o.position.x, y: o.position.y, z: o.position.z, suit };
  };
  T.ents = () => BR.entities.list.filter(e => !e.removed).map(e => [e.id, e.type, e.x, e.z, e.hp]);
  T.openDir = (x, z, fy, maxD) => {
    const M = maxD || 30;
    let best = { yaw: 0, d: -1 };
    for (let i = 0; i < 16; i++) {
      const yaw = -Math.PI + i * Math.PI / 8;
      const h = BR.phys.raycast(x, fy + 1, z, -Math.sin(yaw), 0, -Math.cos(yaw), M);
      const d = h ? h.dist : M;
      if (d > best.d) best = { yaw, d };
    }
    return best;
  };
  // 出生点所在区块周围 3×3 区块，每 1 m 做一次 overlapCircle，碰撞体摆放一致则哈希一致
  // 半径 0.55：Ldev 的薄墙落在整数米线上，采样点在 x.5，半径小于 0.5 永远碰不到
  T.physHash = () => {
    const di = BR.world.debugInfo();
    const size = di.chunkSize, sc = di.spawnChunk;
    let h = 2166136261, blocked = 0, n = 0;
    for (let cx = sc[0] - 1; cx <= sc[0] + 1; cx++) {
      for (let cz = sc[1] - 1; cz <= sc[1] + 1; cz++) {
        for (let i = 0; i < size; i++) {
          for (let j = 0; j < size; j++) {
            const b = BR.phys.overlapCircle(cx * size + i + 0.5, cz * size + j + 0.5, 0.55, null, 1.6) ? 1 : 0;
            blocked += b; n++;
            h = Math.imul(h ^ (b + 1), 16777619) >>> 0;
          }
        }
      }
    }
    return { hash: h, blocked, samples: n, loaded: di.loaded, solids: di.solids, center: di.center, stats: BR.phys.stats() };
  };
  T.sample = (ms, keys) => new Promise(res => {
    const out = {};
    keys.forEach(k => { out[k] = { max: 0, sum: 0, n: 0 }; });
    const badge = { me: false, peer: false };
    const iv = setInterval(() => {
      keys.forEach(k => { const v = +BR.coop[k] || 0; const o = out[k]; o.max = Math.max(o.max, v); o.sum += v; o.n++; });
      const bm = document.querySelector('.coop-badge-me'), bp = document.querySelector('.coop-badge-peer');
      if (bm && !bm.hidden) badge.me = true;
      if (bp && !bp.hidden) badge.peer = true;
    }, 50);
    setTimeout(() => {
      clearInterval(iv);
      keys.forEach(k => { const o = out[k]; o.avg = o.n ? o.sum / o.n : 0; delete o.sum; });
      out.badge = badge;
      res(out);
    }, ms);
  });
  T.watchEnts = (ids, spawnHp, ms) => new Promise(res => {
    const out = { seen: {}, minHp: {}, gone: {}, dmg0: T.dmg };
    const t0 = performance.now();
    const iv = setInterval(() => {
      ids.forEach(id => {
        const e = BR.entities.get(id);
        if (e && !e.removed) {
          if (!out.seen[id]) { out.seen[id] = true; out.minHp[id] = e.hp; }
          out.minHp[id] = Math.min(out.minHp[id], e.hp);
        } else if (out.seen[id]) {
          out.gone[id] = true;
        }
      });
      if (performance.now() - t0 > ms) {
        clearInterval(iv);
        out.hurt = ids.some(id => (out.seen[id] && out.minHp[id] < spawnHp[id]) || out.gone[id]);
        out.dmg = T.dmg - out.dmg0;
        out.playerHp = BR.player.hp;
        out.playerDead = BR.player.dead;
        res(out);
      }
    }, 100);
  });
}

// 在测试里补一个 dev 的复制层，用来验证"真正换到另一层"（首期只注册了 dev）
function registerDevB() {
  if (!BR.levels.has('dev_b')) BR.levels.register(Object.assign({}, BR.levels.get('dev'), { id: 'dev_b', name: 'Level Dev B' }));
}

// ---------- 大厅操作 ----------
const btnText = (page, text) => page.locator('.coop-lobby button', { hasText: new RegExp('^' + text + '$') }).first();
async function openCasualLobby(page, name) {
  await page.click('.home-play');
  await sleep(200);
  await page.click('.home-menu-btn.is-casual');
  await sleep(200);
  await page.locator('.home-dialog-casual .home-actions .home-btn', { hasText: /^联机$/ }).first().click();
  await page.waitForSelector('.coop-lobby', { state: 'visible', timeout: 5000 });
  await page.fill('.coop-lobby .coop-field .coop-input', name);
}
async function hostRoom(page) {
  await btnText(page, '创建房间').click();
  const ok = await waitFor(page, () => BR.coop.phase === 'hosting' && /^[A-Z0-9]{6}$/.test(document.querySelector('.coop-code').textContent), null, 15000);
  const code = ok ? (await page.textContent('.coop-code')).trim() : null;
  return code;
}
async function joinRoom(page, code, shotName, touch) {
  const press = loc => (touch ? loc.tap() : loc.click());
  await page.fill('.coop-code-input', code);
  await press(btnText(page, '加入'));
  const confirmShown = await waitFor(page, () => {
    const c = document.querySelector('.coop-confirm');
    return c && !c.hidden && c.getBoundingClientRect().height > 0;
  }, null, 15000);
  const text = confirmShown ? await page.textContent('.coop-confirm') : '';
  if (shotName) await shot(page, shotName);
  if (confirmShown) await press(btnText(page, '同意加入'));
  return { confirmShown, text };
}
async function waitActive(pages, timeout) {
  const r = await Promise.all(pages.map(p => waitFor(p, () => BR.coop.active && BR.coop.phase === 'active', null, timeout || 45000)));
  return r.every(Boolean);
}

// =====================================================================
async function main() {
  process.on('unhandledRejection', err => console.log('unhandledRejection', err && err.message));
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  // 默认不探测：实测本机无头 Chrome 的 getUserMedia（假设备、音频视频都一样）会挂起，挂起之后再开的页面会卡死；
  // 设 COOP_REAL_MIC=1 才先探测，能用就走 Chrome 假麦克风
  if (process.env.COOP_REAL_MIC === '1') {
    micProbe = await realMicWorks(base);
    micStub = micProbe !== 'ok';
  } else {
    micProbe = '未探测（设 COOP_REAL_MIC=1 才探测；本机实测挂起）';
    micStub = true;
  }
  info('真实 getUserMedia 探测：' + micProbe + (micStub ? ' → 本环境不可用，麦克风改用 WebAudio 合成的持续测试音（440Hz 方波）' : ' → 使用 Chrome 假麦克风'));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  try {
    await run(browser, base);
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }

  fs.appendFileSync(LOG_FILE, '\n===== 信令 =====\n' + JSON.stringify(sig.calls) + '\n' + sig.log.join('\n') + '\n');

  console.log('\n----- 11 console 报错 -----');
  const stunRe = /stun|turn|ice|webrtc|rtcpeer|getaddrinfo|mdns/i;
  const stunWarn = warnings.filter(w => stunRe.test(w));
  const otherWarn = warnings.filter(w => !stunRe.test(w));
  check('11 两边 console 零报错（console.error / pageerror）', errors.length === 0, errors.slice(0, 10));
  info('WebRTC/STUN 相关警告（离线环境 STUN 超时，可忽略）' + stunWarn.length + ' 条', stunWarn.slice(0, 5));
  info('其他警告 ' + otherWarn.length + ' 条', otherWarn.slice(0, 12));
  check('信令请求方法与 net.js 约定一致（create/join/signal/close=POST，status/poll=GET）', methodMismatch.length === 0, methodMismatch);
  info('信令调用次数', sig.calls);

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT) + '/coop-*.png；console 全量：tests/output/coop-console.log');
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

async function run(browser, base) {
  const ctxA = await newContext(browser, 'A');
  const ctxB = await newContext(browser, 'B');
  let A = await newPage(ctxA, 'A');
  let B = await newPage(ctxB, 'B');
  await Promise.all([boot(A, base), boot(B, base)]);
  await ev(A, () => BR.skin.set('pink'));
  await ev(B, () => BR.skin.set('blue'));
  await Promise.all([ev(A, registerDevB), ev(B, registerDevB)]);
  const skins = await Promise.all([ev(A, () => BR.skin.current), ev(B, () => BR.skin.current)]);
  check('0 准备：A 皮肤粉色、B 皮肤蓝色（BR.skin.set）', skins[0] === 'pink' && skins[1] === 'blue', skins);

  let code = null;
  let connected = false;

  // ------------------------------------------------------------------
  await step('1 建房与加入', async () => {
    await openCasualLobby(A, '房主A');
    code = await hostRoom(A);
    check('1 A 打开联机弹窗创建房间，拿到 6 位房号', !!code && /^[A-Z0-9]{6}$/.test(code), code);
    await shot(A, 'lobby-host');
    await openCasualLobby(B, '客机B');
    const j = await joinRoom(B, code, 'confirm-join');
    check('1 B 输入房号后出现「同意加入」确认（含房主昵称和房号）', j.confirmShown && /同意加入/.test(j.text) && j.text.includes('房主A') && j.text.includes(code), j.text.slice(0, 80));
  });

  // ------------------------------------------------------------------
  await step('2 DataChannel 连通与 hello 握手', async () => {
    const t0 = Date.now();
    connected = await waitActive([A, B]);
    const st = await Promise.all([A, B].map(p => ev(p, () => ({
      active: BR.coop.active, role: BR.coop.role, phase: BR.coop.phase, peer: BR.coop.peerName, net: BR.net.connected,
      lobby: (document.querySelector('.coop-peer-line') || {}).textContent,
    }))));
    check('2 双方 DataChannel 连通，hello 握手完成', connected && st[0].net && st[1].net, { ms: Date.now() - t0, A: st[0], B: st[1] });
    check('2 BR.coop.active、role 分别为 host / guest，昵称互通', st[0].active && st[1].active && st[0].role === 'host' && st[1].role === 'guest' &&
      st[0].peer === '客机B' && st[1].peer === '房主A', { A: st[0], B: st[1] });
    await shot(A, 'connected-host-lobby');
  });

  // ------------------------------------------------------------------
  await step('3 别的游戏的 hello', async () => {
    await ev(A, () => BR.coop.leave());
    const bIdle = await waitFor(B, () => BR.coop.phase === 'idle' && !BR.net.active, null, 15000);
    check('3 预备：A 退出联机后 B 回到 idle', bIdle);
    // 通过 A 的 DataChannel 发 game:'rocket' 的 hello（把 A 发出的 hello 改写）
    await ev(A, () => {
      window.__origSend = BR.net.send;
      BR.net.send = function (obj, opt) {
        if (obj && obj.t === 'hello') obj = Object.assign({}, obj, { game: 'rocket' });
        return window.__origSend.call(this, obj, opt);
      };
    });
    const code2 = await hostRoom(A);
    await joinRoom(B, code2);
    const kicked = await waitFor(B, () => /别的游戏的房间/.test(document.querySelector('.coop-status').textContent) && BR.coop.phase === 'idle' && !BR.net.active, null, 45000);
    const bs = await ev(B, () => ({ status: document.querySelector('.coop-status').textContent, phase: BR.coop.phase, active: BR.coop.active, net: BR.net.active }));
    check('3 B 收到 game:rocket 的 hello → 提示「别的游戏的房间」并断开', kicked, bs);
    await shot(B, 'other-game-kicked');
    const aIdle = await waitFor(A, () => BR.coop.phase === 'idle' && !BR.net.active, null, 15000);
    check('3 A 随之回到 idle（收到 B 的 bye）', aIdle, await ev(A, () => ({ phase: BR.coop.phase, toasts: __t.toasts.slice(-2) })));
    await ev(A, () => { BR.net.send = window.__origSend; delete window.__origSend; });
    // 重新建立正常连接
    code = await hostRoom(A);
    await joinRoom(B, code);
    connected = await waitActive([A, B]);
    const roles = await Promise.all([ev(A, () => BR.coop.role), ev(B, () => BR.coop.role)]);
    check('3 恢复 hello 后重新建立 A/B 正常连接', connected && roles[0] === 'host' && roles[1] === 'guest', { code, roles });
  });

  // ------------------------------------------------------------------
  let seed = null;
  await step('4 开局同步', async () => {
    await A.click('.coop-lobby .coop-close');
    await sleep(150);
    await A.click('.home-dialog-casual .home-btn-primary');
    const aPlay = await waitFor(A, () => BR.game.screen === 'playing', null, 20000);
    seed = await ev(A, () => BR.game.seed >>> 0);
    const bPlay = await waitFor(B, s => BR.game.screen === 'playing' && (BR.game.seed >>> 0) === s, seed, 30000);
    check('4 A 从主页「游玩」开局，B 自动进入', aPlay && bPlay, { aPlay, bPlay });
    await sleep(1500);   // 等客机传送到房主身边、周围区块建完
    const [sa, sb] = await Promise.all([A, B].map(p => ev(p, () => ({
      seed: BR.game.seed >>> 0, levelSeed: BR.world.levelSeed, lv: BR.game.levelId, mode: BR.game.mode, coop: BR.game.coop,
      x: BR.player.x, z: BR.player.z, phys: __t.physHash(), home: BR.home.shown, lobby: !document.querySelector('.coop-lobby').hidden,
    }))));
    check('4 同一层（dev）、mode casual', sa.lv === 'dev' && sb.lv === 'dev' && sb.mode === 'casual', { A: sa.lv, B: sb.lv, mode: sb.mode });
    check('4 BR.game.seed 一致', sa.seed === sb.seed, { A: sa.seed, B: sb.seed });
    check('4 BR.world.levelSeed 一致', sa.levelSeed === sb.levelSeed && sa.levelSeed !== 0, { A: sa.levelSeed, B: sb.levelSeed });
    check('4 出生点周围 3×3 区块碰撞体采样一致', sa.phys.hash === sb.phys.hash && sa.phys.blocked > 0 && sa.phys.blocked === sb.phys.blocked,
      { A: { hash: sa.phys.hash, blocked: sa.phys.blocked }, B: { hash: sb.phys.hash, blocked: sb.phys.blocked }, samples: sa.phys.samples });
    info('phys.stats / world.debugInfo（载入区块集合相同则总数相同）', { A: [sa.phys.stats, sa.phys.loaded, sa.phys.solids, sa.phys.center], B: [sb.phys.stats, sb.phys.loaded, sb.phys.solids, sb.phys.center] });
    check('4 B 的 BR.game.coop = guest、主页和大厅已收起、被传送到房主身边', sb.coop && sb.coop.active && sb.coop.role === 'guest' && !sb.home && !sb.lobby &&
      Math.hypot(sa.x - sb.x, sa.z - sb.z) < 2, { coop: sb.coop, home: sb.home, lobby: sb.lobby, dist: +Math.hypot(sa.x - sb.x, sa.z - sb.z).toFixed(2) });
  });

  // ------------------------------------------------------------------
  await step('5 对方人形与位置同步', async () => {
    const place = await ev(A, () => {
      const P = BR.player;
      const d = __t.openDir(P.x, P.z, P.feetY, 10);
      const k = Math.max(1.5, Math.min(3.5, d.d - 1));
      return { yaw: d.yaw, free: d.d, k, bx: P.x - Math.sin(d.yaw) * k, bz: P.z - Math.cos(d.yaw) * k };
    });
    await ev(A, p => { BR.player.yaw = p.yaw; BR.player.pitch = -0.1; }, place);
    await ev(B, p => { const P = BR.player; P.x = p.bx; P.z = p.bz; P.vx = 0; P.vz = 0; P.yaw = p.yaw + Math.PI; P.pitch = -0.1; }, place);
    await sleep(1500);
    const [pa, pb, hexBlue, hexPink] = await Promise.all([ev(A, () => __t.peerSuit()), ev(B, () => __t.peerSuit()), ev(A, () => __t.expectedHex('blue')), ev(A, () => __t.expectedHex('pink'))]);
    const hex = a => (a || []).map(h => h.toString(16));
    check('5 A 看到对方人形，Suit 材质是蓝色', !!pa && pa.visible && pa.suit.length > 0 && pa.suit.every(h => h === hexBlue), { pa: pa && { visible: pa.visible, suit: hex(pa.suit) }, want: hexBlue.toString(16) });
    check('5 B 看到对方人形，Suit 材质是粉色', !!pb && pb.visible && pb.suit.length > 0 && pb.suit.every(h => h === hexPink), { pb: pb && { visible: pb.visible, suit: hex(pb.suit) }, want: hexPink.toString(16) });
    await shot(A, 'A-sees-B-blue');
    await shot(B, 'B-sees-A-pink');

    const a0 = await ev(A, () => ({ x: BR.player.x, z: BR.player.z }));
    await A.keyboard.down('KeyW');
    await sleep(1000);
    await A.keyboard.up('KeyW');
    const tUp = Date.now();
    let follow = null, last = null;
    while (Date.now() - tUp < 1000) {
      const [a1, ps] = await Promise.all([ev(A, () => ({ x: BR.player.x, z: BR.player.z, fy: BR.player.feetY })), ev(B, () => __t.peerSuit())]);
      const d = ps ? Math.hypot(ps.x - a1.x, ps.z - a1.z) : 99;
      last = { ms: Date.now() - tUp, d: +d.toFixed(3), dy: ps ? +(ps.y - a1.fy).toFixed(3) : null, moved: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(2) };
      if (d < 0.5 && Date.now() - tUp >= 150) { follow = last; break; }
      await sleep(60);
    }
    check('5 A 按 W 走 1 秒后，B 看到的 A 位置 1 秒内跟上（误差 < 0.5 m）', !!follow && follow.moved > 0.5, follow || last);
  });

  // ------------------------------------------------------------------
  await step('6 实体快照与互打', async () => {
    const auth = await Promise.all([ev(A, () => BR.entities.authoritative), ev(B, () => BR.entities.authoritative)]);
    check('6 A authoritative === true，B authoritative === false', auth[0] === true && auth[1] === false, auth);
    const gls = await ev(B, () => __t.guestLocalSpawns);
    check('6 客机不按区块自己生成实体（实体全部来自房主快照）', gls === 0, { guestLocalSpawns: gls });
    let cmp = null;
    for (let k = 0; k < 8; k++) {
      const [ea, eb] = await Promise.all([ev(A, () => __t.ents()), ev(B, () => __t.ents())]);
      const mb = new Map(eb.map(r => [r[0], r]));
      const missing = [], typeDiff = [];
      let maxErr = 0;
      for (const r of ea) {
        const q = mb.get(r[0]);
        if (!q) { missing.push(r[0]); continue; }
        if (q[1] !== r[1]) typeDiff.push(r[0]);
        maxErr = Math.max(maxErr, Math.hypot(q[2] - r[2], q[3] - r[3]));
      }
      const ida = new Set(ea.map(r => r[0]));
      const extra = eb.filter(r => !ida.has(r[0])).map(r => r[0] + ':' + r[1]);
      cmp = { nA: ea.length, nB: eb.length, missing, extra, typeDiff, maxErr: +maxErr.toFixed(3), tries: k + 1 };
      if (ea.length > 0 && ea.length === eb.length && !missing.length && !typeDiff.length && maxErr < 1) break;
      await sleep(400);
    }
    check('6 A 的实体快照到达 B：数量一致、同 id 位置误差 < 1 m', cmp.nA > 0 && cmp.nA === cmp.nB && !cmp.missing.length && !cmp.typeDiff.length && cmp.maxErr < 1, cmp);

    const sp = await ev(A, () => {
      const P = BR.player, from = { x: P.x, y: P.y, z: P.z };
      const d = __t.openDir(P.x, P.z, P.feetY, 12);
      const k = Math.max(1.5, Math.min(4, d.d - 1.5));
      const hx = P.x - Math.sin(d.yaw) * k, hz = P.z - Math.cos(d.yaw) * k;
      const h = BR.entities.spawn('_dev_hostile', hx, P.feetY, hz, { from });
      const f = BR.entities.spawn('_dev_friendly', hx + Math.cos(d.yaw) * 1.2, P.feetY, hz - Math.sin(d.yaw) * 1.2, { from });
      return h && f ? { h: h.id, f: f.id, hp: { [h.id]: h.hp, [f.id]: f.hp }, hx, hz, ok: true } : { ok: false, h: !!h, f: !!f };
    });
    check('6 A 上放出 _dev_hostile 与 _dev_friendly（贴近彼此）', sp.ok, sp);
    if (!sp.ok) return;
    await ev(B, s => { const P = BR.player; P.yaw = Math.atan2(-(s.hx - P.x), -(s.hz - P.z)); P.pitch = -0.15; }, sp);
    const ids = [sp.h, sp.f];
    const pA = ev(A, a => __t.watchEnts(a.ids, a.hp, 12000), { ids, hp: sp.hp });
    const pB = ev(B, a => __t.watchEnts(a.ids, a.hp, 12000), { ids, hp: sp.hp });
    await sleep(2500);
    await shot(B, 'B-sees-fight');
    const [wa, wb] = await Promise.all([pA, pB]);
    check('6 B 上能看到它们打起来（hp 下降或实体消失）', wb.seen[sp.h] && wb.seen[sp.f] && wb.hurt, { B: wb, spawnHp: sp.hp });
    info('房主 A 上的同一场战斗', { seen: wa.seen, minHp: wa.minHp, gone: wa.gone });
    check('6 双方玩家都不掉血', wa.dmg === 0 && wb.dmg === 0 && wa.playerHp === 100 && wb.playerHp === 100 && !wa.playerDead && !wb.playerDead,
      { A: { dmg: wa.dmg, hp: wa.playerHp }, B: { dmg: wb.dmg, hp: wb.playerHp } });
  });

  // ------------------------------------------------------------------
  await step('7 拾取同步', async () => {
    const [ia, ib, pa] = await Promise.all([
      ev(A, () => BR.items.list.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z }))),
      ev(B, () => BR.items.list.map(p => p.id)),
      ev(A, () => ({ x: BR.player.x, z: BR.player.z })),
    ]);
    const inB = new Set(ib);
    const lonely = ia.filter(p => inB.has(p.id) && ia.every(q => q === p || Math.hypot(q.x - p.x, q.z - p.z) > 2.5));
    lonely.sort((p, q) => Math.hypot(p.x - pa.x, p.z - pa.z) - Math.hypot(q.x - pa.x, q.z - pa.z));
    info('物品：A ' + ia.length + ' 件、B ' + ib.length + ' 件，两边都有且周围 2.5 m 无其他物品的 ' + lonely.length + ' 件');
    if (lonely.length < 2) { check('7 找到两件可拾取的物品', false, lonely.length); return; }
    const [it1, it2] = lonely;
    // 站到物品 0.3 m 处（互动距离内）并面朝它，按 E
    const approach = (page, it) => ev(page, t => {
      const P = BR.player;
      P.x = t.x + 0.3; P.z = t.z; P.vx = 0; P.vz = 0;
      P.yaw = Math.atan2(-(t.x - P.x), -(t.z - P.z)); P.pitch = -0.6;
    }, it);
    const count = (page, type) => ev(page, t => BR.player.countOf(t), type);

    const before1 = { A: await count(A, it1.type), B: await count(B, it1.type) };
    await approach(A, it1);
    await sleep(400);
    await A.keyboard.press('KeyE');
    const goneA = await waitFor(A, id => !BR.items.find(id), it1.id, 3000);
    const goneB = await waitFor(B, id => !BR.items.find(id), it1.id, 4000);
    const after1 = { A: await count(A, it1.type), B: await count(B, it1.type) };
    check('7 A 按 E 拾取 → A 背包 +1、B 上该物品消失', goneA && goneB && after1.A === before1.A + 1 && after1.B === before1.B, { it: it1.id + ':' + it1.type, goneA, goneB, before1, after1 });

    const before2 = { A: await count(A, it2.type), B: await count(B, it2.type) };
    await approach(B, it2);
    await sleep(400);
    await B.keyboard.press('KeyE');
    const goneB2 = await waitFor(B, id => !BR.items.find(id), it2.id, 5000);
    const goneA2 = await waitFor(A, id => !BR.items.find(id), it2.id, 3000);
    await sleep(300);
    const after2 = { A: await count(A, it2.type), B: await count(B, it2.type) };
    check('7 B 按 E 拾取 → A 上消失，且只进 B 的背包', goneA2 && goneB2 && after2.B === before2.B + 1 && after2.A === before2.A, { it: it2.id + ':' + it2.type, goneA2, goneB2, before2, after2 });
  });

  // ------------------------------------------------------------------
  await step('8 换层', async () => {
    const snap = () => Promise.all([A, B].map(p => ev(p, () => ({ lv: BR.game.levelId, levelSeed: BR.world.levelSeed, seed: BR.game.seed >>> 0, enters: __t.levelEnters, tr: BR.world.transitioning }))));
    const settle = async (lv) => {
      const ok = await Promise.all([A, B].map(p => waitFor(p, l => BR.game.levelId === l && !BR.world.transitioning, lv, 15000)));
      await sleep(600);
      return ok.every(Boolean);
    };
    // 8a：房主直接 BR.world.goTo 到另一层（不经出口）→ 客机靠 world 消息跟过去
    await ev(A, () => BR.world.goTo('dev_b'));
    let ok = await settle('dev_b');
    let s = await snap();
    check('8a A 调 BR.world.goTo(\'dev_b\') → B 跟着换层，levelSeed 一致', ok && s[1].lv === 'dev_b' && s[0].levelSeed === s[1].levelSeed, s);

    // 8b：房主走进出口（照 world.reachExit：先 emit exit:reach，再 goTo）回 dev
    await ev(A, () => { BR.bus.emit('exit:reach', { to: 'dev', kind: 'zone' }); BR.world.goTo('dev', { kind: 'zone' }); });
    ok = await settle('dev');
    s = await snap();
    check('8b A 走进出口 dev_b → dev，B 跟着换层，levelSeed 一致', ok && s[1].lv === 'dev' && s[0].levelSeed === s[1].levelSeed, s);

    // 8c：房主走进同层出口（dev → dev，Ldev 的"回到 Level Dev"圈），两人应一起重进
    let e0 = await snap();
    await ev(A, () => { BR.bus.emit('exit:reach', { to: 'dev', kind: 'zone' }); BR.world.goTo('dev', { kind: 'zone' }); });
    const reB = await waitFor(B, n => __t.levelEnters > n && !BR.world.transitioning, e0[1].enters, 8000);
    await settle('dev');
    s = await snap();
    check('8c A 走进同层出口（dev → dev）→ B 一起重进，levelSeed 一致', reB && s[0].enters > e0[0].enters && s[0].levelSeed === s[1].levelSeed, { before: e0, after: s });

    // 8d：客机走进出口（world 看到客机不自己换层，只 emit exit:reach）→ 房主决定，两人一起去 dev_b
    await ev(B, () => BR.bus.emit('exit:reach', { to: 'dev_b', kind: 'zone' }));
    ok = await settle('dev_b');
    s = await snap();
    check('8d B 走进出口 dev → dev_b → 房主换层并广播，两人都到 dev_b', ok && s[0].lv === 'dev_b' && s[1].lv === 'dev_b' && s[0].levelSeed === s[1].levelSeed, s);

    // 8e：客机走进同层出口（dev_b → dev_b）
    e0 = await snap();
    await ev(B, () => BR.bus.emit('exit:reach', { to: 'dev_b', kind: 'zone' }));
    const reA = await waitFor(A, n => __t.levelEnters > n && !BR.world.transitioning, e0[0].enters, 8000);
    const reB2 = await waitFor(B, n => __t.levelEnters > n && !BR.world.transitioning, e0[1].enters, 8000);
    await sleep(600);
    s = await snap();
    check('8e B 走进同层出口（dev_b → dev_b）→ 两人一起重进', reA && reB2 && s[0].levelSeed === s[1].levelSeed, { before: e0, after: s });

    // 回到 dev，后面的步骤在 dev 上跑
    await ev(A, () => BR.world.goTo('dev'));
    ok = await settle('dev');
    s = await snap();
    check('8f A 回 dev，B 跟随，seed / levelSeed 仍一致', ok && s[0].seed === s[1].seed && s[0].levelSeed === s[1].levelSeed, s);
  });

  // ------------------------------------------------------------------
  await step('9 开麦', async () => {
    info('麦克风来源：' + (micStub ? 'WebAudio 合成测试音（真实 getUserMedia 在本环境挂起：' + micProbe + '）' : 'Chrome 假麦克风'));
    await B.keyboard.press('KeyV');
    const on = await waitFor(B, () => BR.coop.mic === true, null, 10000);
    const btn = await ev(B, () => {
      const b = document.querySelector('.coop-mic');
      return { hidden: b.hidden, on: b.classList.contains('coop-on'), txt: b.textContent, pressed: b.getAttribute('aria-pressed') };
    });
    check('9 B 按 V → BR.coop.mic = true，按钮显示开麦状态', on && btn.on && /开麦中/.test(btn.txt) && btn.pressed === 'true' && !btn.hidden, btn);
    await sleep(1500);
    const [lb, pa] = await Promise.all([ev(B, () => __t.sample(5000, ['localSpeaking'])), ev(A, () => __t.sample(5000, ['peerSpeaking']))]);
    check('9 几秒后 B 的 localSpeaking > 0', lb.localSpeaking.max > 0.01, lb);
    check('9 A 的 peerSpeaking > 0（收到 B 的语音）', pa.peerSpeaking.max > 0.01, pa);
    check('9 说话角标：B「我在说话」、A「对方在说话」出现过', lb.badge.me && pa.badge.peer, { B: lb.badge, A: pa.badge });
    await shot(B, 'mic-on-B');
    await shot(A, 'mic-peer-speaking-A');
    await B.keyboard.press('KeyV');
    const off = await waitFor(B, () => BR.coop.mic === false, null, 5000);
    const btn2 = await ev(B, () => { const b = document.querySelector('.coop-mic'); return { on: b.classList.contains('coop-on'), txt: b.textContent }; });
    check('9 再按 V 关麦，按钮回到已闭麦', off && !btn2.on && /已闭麦/.test(btn2.txt), btn2);
    await sleep(2000);
    const [lb2, pa2] = await Promise.all([ev(B, () => __t.sample(1500, ['localSpeaking'])), ev(A, () => __t.sample(1500, ['peerSpeaking']))]);
    check('9 关麦后电平回落到接近 0（< 0.02）', lb2.localSpeaking.max < 0.02 && pa2.peerSpeaking.max < 0.02, { B: lb2.localSpeaking, A: pa2.peerSpeaking });
  });

  // ------------------------------------------------------------------
  await step('10 离开与回单机', async () => {
    const t0 = Date.now();
    await B.close();
    const aLeft = await waitFor(A, () => !BR.coop.active && BR.coop.phase === 'idle', null, 45000);
    const aSt = await ev(A, () => ({ toasts: __t.toasts.slice(-3), status: document.querySelector('.coop-status').textContent, active: BR.coop.active, coop: BR.game.coop, auth: BR.entities.authoritative, screen: BR.game.screen }));
    check('10 B 关闭页面 → A 收到「对方已离开」提示', aLeft && aSt.toasts.some(t => /离开了联机/.test(t)), { ms: Date.now() - t0, ...aSt });
    const t1 = await ev(A, () => ({ time: BR.game.time, ent: BR.entities.debugInfo().time, pos: __t.ents().map(r => [r[0], r[2], r[3]]) }));
    await sleep(2500);
    const t2 = await ev(A, () => ({ time: BR.game.time, ent: BR.entities.debugInfo().time, pos: __t.ents().map(r => [r[0], r[2], r[3]]) }));
    const moved = t2.pos.filter(p => { const q = t1.pos.find(o => o[0] === p[0]); return q && Math.hypot(q[1] - p[1], q[2] - p[2]) > 0.05; }).length;
    check('10 A 继续单机：playing、authoritative、世界和实体在跑', aSt.screen === 'playing' && aSt.auth === true && !aSt.coop.active && t2.time > t1.time && moved > 0,
      { time: [t1.time, t2.time], moved, ents: t2.pos.length });
    await shot(A, 'A-alone-after-B-left');

    // 触屏客机 T 加入 A 的新房间：检查触屏麦克风按钮；然后 A 断开，T 回单机
    const ctxT = await newContext(browser, 'T', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const T = await newPage(ctxT, 'T');
    await boot(T, base);
    await ev(T, () => BR.skin.set('blue'));
    await ev(T, registerDevB);
    await ev(A, () => BR.coop.openLobby());
    const code3 = await hostRoom(A);
    await ev(T, () => BR.coop.openLobby());
    await T.fill('.coop-lobby .coop-field .coop-input', '触屏T');
    const j = await joinRoom(T, code3, null, true);
    const both = await waitActive([A, T]);
    await A.click('.coop-lobby .coop-close').catch(() => {});
    const tPlay = await waitFor(T, () => BR.game.screen === 'playing' && BR.game.coop && BR.game.coop.role === 'guest', null, 30000);
    check('10 触屏客机 T 加入 A 的新房间并进入同一世界', j.confirmShown && both && tPlay, { code3, both, tPlay });
    await sleep(1500);
    const lay = await ev(T, () => {
      const mic = document.querySelector('.coop-mic');
      const r = mic.getBoundingClientRect();
      const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const others = Array.from(document.querySelectorAll('button, [role="button"], .touch-btn'))
        .filter(e => e !== mic && !mic.contains(e) && !e.closest('.coop-lobby'))
        .filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; })
        .map(e => ({ cls: e.className, ...box(e) }));
      const hit = others.filter(o => !(o.r <= r.left || o.l >= r.right || o.b <= r.top || o.t >= r.bottom));
      return { touch: BR.input.isTouch, hudTouch: document.querySelector('.coop-hud').classList.contains('coop-touch'), mic: { hidden: mic.hidden, ...box(mic) }, hit, n: others.length, touchBtns: others.filter(o => /touch-btn/.test(o.cls)).map(o => o.cls + ' ' + Math.round(o.l) + ',' + Math.round(o.t)) };
    });
    check('10 触屏视口：麦克风按钮存在且 ≥ 44px', lay.touch && lay.hudTouch && !lay.mic.hidden && lay.mic.w >= 44 && lay.mic.h >= 44, lay.mic);
    check('10 触屏视口：麦克风按钮不与动作按钮重叠', lay.n > 0 && lay.hit.length === 0, { hit: lay.hit, touchBtns: lay.touchBtns });
    await shot(T, 'touch-guest-mic');
    await T.tap('.coop-mic');
    const tapOn = await waitFor(T, () => BR.coop.mic === true, null, 10000);
    await T.tap('.coop-mic');
    const tapOff = await waitFor(T, () => BR.coop.mic === false, null, 5000);
    check('10 触屏点麦克风按钮开麦 / 再点闭麦', tapOn && tapOff, { tapOn, tapOff });

    const t3 = Date.now();
    await A.close();
    const tLeft = await waitFor(T, () => !BR.coop.active && BR.coop.phase === 'idle', null, 45000);
    const p1 = await ev(T, () => __t.ents().map(r => [r[0], r[2], r[3]]));
    await sleep(3000);
    const tSt = await ev(T, () => ({ toasts: __t.toasts.slice(-3), auth: BR.entities.authoritative, coop: BR.game.coop, screen: BR.game.screen, pos: __t.ents().map(r => [r[0], r[2], r[3]]), dbg: BR.entities.debugInfo().authoritative }));
    const moved2 = tSt.pos.filter(p => { const q = p1.find(o => o[0] === p[0]); return q && Math.hypot(q[1] - p[1], q[2] - p[2]) > 0.05; }).length;
    check('10 A 断开 → 客机回到 authoritative=true 单机，提示已切回单机', tLeft && tSt.auth === true && !tSt.coop.active && tSt.screen === 'playing' && tSt.toasts.some(t => /单机/.test(t)),
      { ms: Date.now() - t3, toasts: tSt.toasts, auth: tSt.auth, coop: tSt.coop, screen: tSt.screen });
    check('10 客机回单机后原有实体继续跑本机 AI', tSt.pos.length > 0 && moved2 > 0, { ents: tSt.pos.length, moved: moved2 });
    await shot(T, 'touch-guest-alone');
    await ctxT.close();
  });
  await ctxA.close().catch(() => {});
  await ctxB.close().catch(() => {});
}

main();
