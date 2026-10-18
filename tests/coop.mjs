// 后室 · 两人联机端到端测试：node tests/coop.mjs
// 联机营地（N1，孩子 2026-10-02）：联机只从主页「联机」进 —— 开营地 / 加入朋友的营地 → 两人在营地（隐藏层 coopcamp）→
// 帐篷里选模式和层级 → 一起出发；回营地要对方同意；掉线自动重连。
// 本地静态服务 + 无头 Chrome，每个玩家一个独立 context。context.route 拦截 api.ovobot.ai，在测试进程内存里模拟 room.php
// （照 rocket-game/backend/room.php 的真实行为写：join 只拦 joined、不拦 closed；名字 trim + mb_substr(0,16)，trim 只剥
// ASCII 空白、不剥营地暗标 U+2063；signal / poll 不查房间在不在；错误带真实的 HTTP 状态码），WebRTC 走本机真实连接。
// 测试绝不连真实联机服务器：api.ovobot.ai 的请求全部在这里应答，其余外站请求一律掐掉。
// 后面各阶段的联机用例都用这几个辅助函数进局：openCoopFromHome / hostCamp / joinCamp / tentPick / readyBoth / departBoth。
// 每步打印 PASS/FAIL，截图写 tests/output/coop-*.png，所有页面的 console 写 tests/output/coop-console.log。
// 叉车联机（FE1，2026-10-06）：最后一段 V（runVeh）另开两个页面，主页「联机」→ 营地 → 帐篷选「游玩 + Level 1」→ 出发，再测两人抢车、
//   对方看到车在开（坐姿人形、司机的制服色、名牌透明度）、货叉下有人降不下来、下车后房主的 levelState、联机暂停 / 结算 / 切后台刹车、
//   客机司机断线重连、房主 4 块外的车照样挡实体；再另开一对页面让客机不报 veh2（旧版），进层提示、上车被拒。
//   FE1 返修 r2：V12 仪表台大灯开关两边同步（远端车的灯跟着灭 / 亮、关着下车 levelState 记 hl 0、换人坐上去点火也不亮）；
//   V13 / V13b 全速撞柱子时货叉上的罐头甩出去，客机开车由房主算（use 'fkthrow'）、房主开车发 net:fkthrow，两边落点一样；
//   V14 / V14b 客机开着车时出站消息被攒住（连接不断）7 s / 20 s：人还坐着、补到以后两边一致；要不回租约被放下车时房主把车挪到他下车的地方。
//   V14c 消息攒住期间房主收走租约、这台车在房主那边被挪开：客机晚到的 rel 不把车挪回去（hostRel 的 vehFin 拒绝分支），客机那边被拉过去。
//   短按一律在同一个 evaluate 里派发 keydown / keyup（N1 minor ⑤：机器忙时两次 CDP 按键之间隔得太久会被当成长按）。
//   node tests/coop.mjs --only veh 只跑这一段；--skip veh 跳过它。
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

const ARGV = process.argv.slice(2);
const argOf = n => { const i = ARGV.indexOf('--' + n); return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : null; };
const ONLY = argOf('only') ? new Set(argOf('only').split(',')) : null;   // 目前只认 veh：只跑叉车联机那一段
const SKIP = argOf('skip') ? new Set(argOf('skip').split(',')) : new Set();
const VIEW = { width: 800, height: 450 };   // SwiftShader 纯 CPU 渲染，两页同时跑，视口小一点省负载
const TOUCH_VIEW = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const OVOBOT_RE = /^https?:\/\/api\.ovobot\.ai\//;
const OTHER_HOST_RE = /^https?:\/\/(?!127\.0\.0\.1[:/])(?!api\.ovobot\.ai\/)/;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CAMP = 'coopcamp';
const CAMP_TAG = '\u2063';
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

// 每个 context 页面脚本执行前：记下画到 canvas 上的字（营地小黑板是 CanvasTexture，靠它核对房号）、
// 记下所有 RTCPeerConnection（「断网」时让本机这条连接报 failed，见 cutPeer）
function harnessInit() {
  try {
    const P = CanvasRenderingContext2D.prototype;
    const ft = P.fillText, fr = P.fillRect;
    const texts = new WeakMap();
    window.__canvasTexts = c => (texts.get(c) || []).slice();
    P.fillRect = function (x, y, w, h) {
      if (this.canvas && x <= 0 && y <= 0 && w >= this.canvas.width && h >= this.canvas.height) texts.set(this.canvas, []);
      return fr.apply(this, arguments);
    };
    P.fillText = function (t) {
      if (this.canvas) {
        let a = texts.get(this.canvas);
        if (!a) texts.set(this.canvas, a = []);
        a.push(String(t));
        if (a.length > 200) a.shift();
      }
      return ft.apply(this, arguments);
    };
  } catch (err) { /* 没有 canvas 也不影响联机 */ }
  const RPC = window.RTCPeerConnection;
  if (typeof RPC === 'function') {
    const list = window.__pcs = [];
    window.RTCPeerConnection = new Proxy(RPC, { construct(T, args, nt) { const pc = Reflect.construct(T, args, nt); list.push(pc); return pc; } });
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
  console.log(secs() + (ok && line.length > 700 ? line.slice(0, 700) + '…' : line));
  logLine('==== ' + line.slice(0, 400));
}
const skips = [];   // 前提不成立（机器太忙）记 SKIP 的检查：汇总里单独列出，不算通过
function info(text, detail) {
  console.log(secs() + 'INFO ' + text + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
// 浏览器自己打的「Failed to load resource」：信令请求照真服务器回 404 / 409，或者测试故意断网时，浏览器会记一条网络错误。
// 这不是游戏代码的 console.error，单独记账、不算页面报错（其余外站请求本来就被掐掉，不会出现在这里）
const netNoise = [];
function watch(page, tag) {
  page.on('console', m => {
    const line = '[' + tag + '] ' + m.type() + ': ' + m.text();
    logLine(line);
    const url = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && /^Failed to load resource/.test(m.text()) && OVOBOT_RE.test(url)) netNoise.push(line + ' @ ' + url);
    else if (m.type() === 'error') errors.push(line + ' @ ' + url);
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
// 短按（N1 minor ⑤）：同一个 evaluate 里先造好 keydown、keyup 两个事件（event.timeStamp 是造出来的时刻，只差零点几毫秒）再接连派发。
// 两次 CDP 按键之间、或者 setTimeout 隔开的两次派发，机器忙时会被渲染帧拖到几百毫秒以后，interact 就当成了长按
function tapKey(page, code) {
  return ev(page, c => {
    const o = { code: c, key: c === 'Space' ? ' ' : c.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true };
    const d = new KeyboardEvent('keydown', o), u = new KeyboardEvent('keyup', o);
    window.dispatchEvent(d);
    window.dispatchEvent(u);
    return 0;
  }, code);
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
  logLine('----- ' + title);
  try {
    await fn();
  } catch (err) {
    check(title + '：流程未中断', false, String(err && err.stack || err).split('\n').slice(0, 4).join(' | '));
  }
}

// =====================================================================
// room.php 模拟：照 rocket-game/backend/room.php 逐条写
//   create(POST) → {ok, code}；名字 trim（只剥 " \t\n\r\0\x0B"）、空了写「匿名工程师」、mb_substr(0, 16)（按码点）
//   其余 action 先把 code 规整成大写字母数字，不是 6 位 → 400 bad_code
//   join(POST)：没有 → 404 room_not_found；joined → 409 room_full；closed 不拦（照样改成 joined）→ {ok, host}
//   status(GET)：没有 → 404；{ok, state, host_name, guest_name}（guest_name 建房时是 null）
//   signal(POST)：to 不是 host 就当 guest；payload 为 null → 400 no_payload；JSON 超过 60000 → 413 too_large；不查房间在不在
//   poll(GET)：me 不是 host 就当 guest；id > since 的最多 40 条；不查房间在不在 → {ok, msgs, last}
//   close(POST)：改成 closed（房间不存在也回 ok）；别的 action → 400 unknown_action
//   每次请求先清掉 120 分钟前建的房间和信令（服务器时钟 = 本进程时钟）
// =====================================================================
const rooms = new Map();
const signals = [];           // { id, room, to, payload, at }：全表自增 id，和 MySQL 的 AUTO_INCREMENT 一样跨房间
let sigSeq = 0;
const ROOM_TTL_MS = 120 * 60 * 1000;
const sig = { calls: {}, log: [], joins: {} };
const netDown = new Set();    // 这些 tag 的 context 现在「断网」：信令请求直接失败
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let s;
  do {
    s = '';
    for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(s));
  return s;
}
const phpTrim = v => String(v).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
function nameOf(body) {
  let n = phpTrim(body && body.name != null ? body.name : '');
  if (n === '') n = '匿名工程师';
  return Array.from(n).slice(0, 16).join('');
}
function roomApi(q, body) {
  const now = Date.now();
  for (const [c, r] of rooms) if (now - r.createdAt > ROOM_TTL_MS) rooms.delete(c);
  for (let i = signals.length - 1; i >= 0; i--) if (now - signals[i].at > ROOM_TTL_MS) signals.splice(i, 1);
  const action = q.action || '';
  if (action === 'create') {
    const code = newCode();
    rooms.set(code, { state: 'waiting', host_name: nameOf(body), guest_name: null, createdAt: now });
    return [200, { ok: true, code }];
  }
  const code = String(q.code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (code === '' || code.length !== 6) return [400, { ok: false, error: 'bad_code' }];
  const room = rooms.get(code) || null;
  switch (action) {
    case 'join':
      sig.joins[code] = (sig.joins[code] || 0) + 1;
      if (!room) return [404, { ok: false, error: 'room_not_found' }];
      if (room.state === 'joined') return [409, { ok: false, error: 'room_full' }];
      room.guest_name = nameOf(body);
      room.state = 'joined';
      return [200, { ok: true, host: room.host_name }];
    case 'status':
      if (!room) return [404, { ok: false, error: 'room_not_found' }];
      return [200, { ok: true, state: room.state, host_name: room.host_name, guest_name: room.guest_name }];
    case 'signal': {
      const to = q.to === 'host' ? 'host' : 'guest';
      const payload = body && body.payload !== undefined ? body.payload : null;
      if (payload === null) return [400, { ok: false, error: 'no_payload' }];
      if (JSON.stringify(payload).length > 60000) return [413, { ok: false, error: 'too_large' }];
      signals.push({ id: ++sigSeq, room: code, to, payload, at: now });
      return [200, { ok: true }];
    }
    case 'poll': {
      const me = q.me === 'host' ? 'host' : 'guest';
      const since = parseInt(q.since, 10) || 0;
      const msgs = signals.filter(m => m.room === code && m.to === me && m.id > since).slice(0, 40);
      return [200, { ok: true, msgs: msgs.map(m => m.payload), last: msgs.length ? msgs[msgs.length - 1].id : since }];
    }
    case 'close':
      if (room) room.state = 'closed';
      return [200, { ok: true }];
  }
  return [400, { ok: false, error: 'unknown_action' }];
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
    if (netDown.has(tag)) { await route.abort('internetdisconnected'); return; }
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors, body: '' }); return; }
    const u = new URL(req.url());
    if (!/\/room\.php$/.test(u.pathname)) {
      await route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' });
      return;
    }
    const q = Object.fromEntries(u.searchParams.entries());
    let body = {};
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw) || {}; } catch (err) { body = {}; } }
    if (EXPECT_METHOD[q.action] && EXPECT_METHOD[q.action] !== req.method()) methodMismatch.push(q.action + ' ' + req.method());
    const [status, r] = roomApi(q, body);
    sig.calls[q.action] = (sig.calls[q.action] || 0) + 1;
    if (q.action !== 'poll' && q.action !== 'status') {
      const t = body && body.payload && body.payload.t;
      sig.log.push(secs() + tag + ' ' + req.method() + ' ' + q.action + (q.code ? ' ' + q.code : '') + (q.to ? ' to=' + q.to : '') + (t ? ' ' + t : '') + ' → ' + status + ' ' + JSON.stringify(r).slice(0, 60));
    }
    await route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(r) });
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
  await ctx.route(OTHER_HOST_RE, route => route.abort());
  await ctx.addInitScript(harnessInit);
  if (micStub) await ctx.addInitScript(fakeMicInit);
  return ctx;
}
async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  watch(page, tag);
  return page;
}
// 打开页面，等主页显示、装好页面内工具。url 不给就是 index.html?dev：地址栏带 ?dev 时帐篷的层级列表才有开发测试层
// Level Dev（BR.home.levelOptions({dev:true})），回营地时房主按上一局的选择重填，Level Dev 也认
async function boot(page, base, url) {
  // 只差 #hash 的地址 goto 不会重新载入页面：先离开，保证邀请链接是一次真正的打开
  if (url) await page.goto('about:blank');
  await page.goto(url || base + 'index.html?dev');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);
  await page.evaluate(installHelpers);
  await page.evaluate(registerDevB);
}

// 页面内工具：toast / 横幅 / 总线事件记录、黑幕与大标题的先后、伤害 / 换层计数、对方人形颜色、实体列表、碰撞采样、小黑板的字
function installHelpers() {
  const now = () => performance.now();
  const T = window.__t = { toasts: [], notices: [], bus: [], dmg: 0, levelEnters: 0, lastEnter: null, trace: [] };
  // toast 从 DOM 记（hud 自己内部的 toast 不经 BR.hud.toast）：新出的 .hud-toast，和同一句话连着来时的 hud-toast-bump
  if (BR.hud && typeof BR.hud.notice === 'function') {
    const orig = BR.hud.notice;
    BR.hud.notice = function (text, acts) {
      T.notices.push({ t: now(), text: String(text), acts: (acts || []).map(a => a && a.label) });
      return orig.apply(this, arguments);
    };
  }
  // 黑幕：调用、到全黑（resolve）的时刻；startRun：调用时刻（房主）
  if (BR.hud && typeof BR.hud.curtain === 'function') {
    const orig = BR.hud.curtain;
    BR.hud.curtain = function (text) {
      const rec = { k: 'curtain', t: now(), text: text === false ? false : String(text) };
      // 出发 / 回营地落黑幕的这一刻（灯已经灭了）：记下已载入区块所有灯描述的最大强度（营地 + 窗外带都该是 0）
      if (text !== false && BR.world && typeof BR.world.chunks === 'function') {
        let n = 0, max = 0;
        for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l.intensity > max) max = l.intensity; }
        rec.lv = BR.game.levelId; rec.lightsN = n; rec.lightsMax = max; rec.transit = BR.coopCamp ? BR.coopCamp.transit : null;
      }
      T.trace.push(rec);
      const p = orig.apply(this, arguments);
      if (p && typeof p.then === 'function') p.then(v => { T.trace.push({ k: text === false ? 'curtainClear' : 'curtainBlack', t: now(), v }); });
      return p;
    };
  }
  // 帐篷 state 里的 goAt：房主自己 emit 出去的、客机收到的（收到那一刻离出发还剩多少秒）。4d 判倒数从 3 开始、4e 比两边 goAt 用
  T.goAts = [];
  const noteGo = (who, st) => { if (st && st.goAt > 0 && !T.goAts.some(g => g.goAt === st.goAt && g.who === who)) T.goAts.push({ who, t: now(), goAt: st.goAt, left: +(st.goAt - BR.coop.clock()).toFixed(3) }); };
  if (BR.coop && typeof BR.coop.emit === 'function') {
    const oe = BR.coop.emit;
    BR.coop.emit = function (kind, p) { if (kind === 'tent') noteGo('emit', p); return oe.apply(this, arguments); };
  }
  BR.bus.on('net:tent', p => noteGo('recv', p));
  // 本页联机时钟相对墙钟的偏差（两页在同一台机器上，墙钟一样）：两边差 < 100 ms 才算倒数同步
  T.clkOff = () => BR.coop.clock() - (performance.timeOrigin + performance.now()) / 1000;
  if (BR.coop && typeof BR.coop.startRun === 'function') {
    const orig = BR.coop.startRun;
    BR.coop.startRun = function (p) { T.trace.push({ k: 'startRun', t: now(), lv: p && p.levelId, mode: p && p.mode }); return orig.apply(this, arguments); };
  }
  // 大标题真正播出、黑幕真正撤掉（DOM）
  // 同一批变动用同一个时刻：黑幕撤掉和大标题开播常在同一个回调里，先后由下面记录的顺序（先黑幕、后标题）表示
  const mo = new MutationObserver(recs => {
    const t = now();
    for (const r of recs) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList.contains('hud-toast')) T.toasts.push(n.textContent); });
      } else if (r.type === 'attributes' && r.attributeName === 'class' && r.target.classList && r.target.classList.contains('hud-toast') &&
        r.target.classList.contains('hud-toast-bump') && !(r.oldValue || '').includes('hud-toast-bump')) {
        T.toasts.push(r.target.textContent);
      }
    }
    const c = document.querySelector('.hud-curtain');
    const on = !!(c && !c.hidden);
    if (on !== T._curtainOn) { T._curtainOn = on; T.trace.push({ k: on ? 'curtainShown' : 'curtainHidden', t }); }
    const title = document.querySelector('.hud-title');
    if (title && !title.hidden && title.classList.contains('hud-title-play') && !T._titleOn) { T._titleOn = true; T.trace.push({ k: 'titleShown', t, text: title.textContent.slice(0, 40) }); }
    if (title && (title.hidden || !title.classList.contains('hud-title-play'))) T._titleOn = false;
  });
  mo.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden'], childList: true });
  ['coop:peerGone', 'coop:code', 'coop:reconnecting', 'coop:reconnected'].forEach(n => BR.bus.on(n, p => { T.bus.push({ n, t: now(), p: p ? JSON.parse(JSON.stringify(p)) : null }); }));
  BR.bus.on('player:damage', () => { T.dmg++; });
  BR.bus.on('level:enter', p => { T.levelEnters++; T.lastEnter = p && p.id; T.trace.push({ k: 'levelEnter', t: now(), id: p && p.id }); });
  // 统计客机（authoritative=false）时区块自己生成了多少实体：客机的实体应当全部来自房主快照
  T.guestLocalSpawns = 0;
  const sfc = BR.entities.spawnForChunk;
  BR.entities.spawnForChunk = function () {
    const r = sfc.apply(this, arguments);
    if (!BR.entities.authoritative && Array.isArray(r)) T.guestLocalSpawns += r.length;
    return r;
  };
  T.since = (list, t0) => list.filter(x => x.t >= t0);
  // 对方语音的 <audio>（net.js 收到对方音轨时 createElement，不挂进 DOM）：记下来，9 节查「联机语音音量」真的设到它上面
  T.audios = [];
  const oce = document.createElement;
  document.createElement = function (tag) { const el = oce.apply(this, arguments); if (String(tag).toLowerCase() === 'audio') T.audios.push(el); return el; };
  T.expectedHex = key => {
    const c = new THREE.Color().setHex(BR.skin.color(key));
    const cm = THREE.ColorManagement;
    if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
    return c.getHex();
  };
  const suitOf = o => {
    const suit = [];
    o.traverse(m => {
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => {
        if (mt && mt.color && (/^Suit(\.\d+)?$/.test(mt.name || '') || m.userData.suit)) suit.push(mt.color.getHex());
      });
    });
    return suit;
  };
  T.peerSuit = () => {
    const o = BR.gfx.scene.getObjectByName('coop-peer');
    if (!o) return null;
    return { visible: o.visible, x: o.position.x, y: o.position.y, z: o.position.z, suit: suitOf(o) };
  };
  T.entSuit = id => {
    const e = BR.entities.get(id);
    if (!e || !e.obj) return null;
    let sprites = 0;
    e.obj.traverse(o => { if (o.isSprite && o.visible !== false) sprites++; });
    return { suit: suitOf(e.obj), sprites };
  };
  T.ents = () => BR.entities.list.filter(e => !e.removed).map(e => [e.id, e.type, e.x, e.z, e.hp]);
  T.inv = () => BR.player.inventory.map(s => (s ? s.type + 'x' + s.count : null));
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
  // 营地小黑板 / 桌面纸：场景里挂着 CanvasTexture 的网格，按离 b.data.coopcamp 里 board / map 的距离认
  T.campData = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    return c && c.res && c.res.data ? c.res.data.coopcamp || null : null;
  };
  T.canvasNear = (p, r) => {
    let best = null, bd = r || 1;
    BR.gfx.scene.traverse(o => {
      const mt = o.material;
      if (!o.isMesh || !mt || !mt.map || !mt.map.isCanvasTexture) return;
      const wp = new THREE.Vector3(); o.getWorldPosition(wp);
      const d = Math.hypot(wp.x - p.x, wp.y - p.y, wp.z - p.z);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  };
  T.boardText = () => {
    const d = T.campData();
    if (!d || !d.board || !window.__canvasTexts) return null;
    const o = T.canvasNear(d.board, 0.8);
    return o ? window.__canvasTexts(o.material.map.image).join(' | ') : null;
  };
  T.hudCode = () => { const e = document.querySelector('.hud-info-code'); return e && !e.hidden && e.getClientRects().length ? e.textContent : null; };
  T.noticeTexts = () => Array.from(document.querySelectorAll('.hud-notice')).filter(n => n.getClientRects().length).map(n => n.innerText.replace(/\s+/g, ' ').trim());
  T.prop = key => { const P = BR.world.propByKey(key); return P ? { x: +P.x.toFixed(3), z: +P.z.toFixed(3), moved: !!P.moved } : null; };
  // 「断网」：P2P 这条路断了，本机的连接很快报 failed（DevTools 的离线模拟管不到 WebRTC，只能这样让它断）
  T.cutPeer = () => {
    const pcs = (window.__pcs || []).filter(pc => pc.signalingState !== 'closed');
    for (const pc of pcs) {
      Object.defineProperty(pc, 'connectionState', { get: () => 'failed', configurable: true });
      Object.defineProperty(pc, 'iceConnectionState', { get: () => 'failed', configurable: true });
      try { pc.dispatchEvent(new Event('connectionstatechange')); } catch (err) { /* 已关 */ }
      try { pc.dispatchEvent(new Event('iceconnectionstatechange')); } catch (err) { /* 已关 */ }
    }
    return pcs.length;
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

// 在测试里补一个 dev 的复制层，用来验证"真正换到另一层"
function registerDevB() {
  if (!BR.levels.has('dev_b')) BR.levels.register(Object.assign({}, BR.levels.get('dev'), { id: 'dev_b', name: 'Level Dev B' }));
}

// =====================================================================
// 进局辅助（后面各阶段的联机用例都用这几个）
// =====================================================================
const press = (page, touch, loc) => (touch ? loc.tap() : loc.click());
const btnText = (page, text) => page.locator('.coop-lobby button', { hasText: new RegExp('^' + text + '$') }).first();
const fmtCode = c => c.slice(0, 3) + ' ' + c.slice(3);

// 主页上点「联机」，等联机面板出来
async function openCoopFromHome(page, touch) {
  await press(page, touch, page.locator('.home-secondary-btn.is-coop').first());
  await page.waitForSelector('.coop-lobby', { state: 'visible', timeout: 25000 });   // 机器忙时 8 s 不够（同 workshop.mjs）
}
// 开营地：主页「联机」→ 填昵称 →「开一个营地」→ 拿到房号；opts.enter（默认 true）再点「进营地等朋友」进营地。返回房号
async function hostCamp(page, name, opts) {
  const o = opts || {};
  await openCoopFromHome(page, o.touch);
  await page.fill('.coop-lobby .coop-name-field .coop-input', name);
  await press(page, o.touch, page.locator('.coop-lobby .coop-btn-host'));
  const ok = await waitFor(page, () => BR.coop.phase === 'hosting' && /^[A-Z2-9]{3} [A-Z2-9]{3}$/.test(document.querySelector('.coop-lobby .coop-view-host .coop-code').textContent), null, 15000);
  if (!ok) return null;
  const code = (await page.textContent('.coop-lobby .coop-view-host .coop-code')).replace(/\s+/g, '');
  if (o.shot) await shot(page, o.shot);
  if (o.enter === false) return code;
  await press(page, o.touch, page.locator('.coop-lobby .coop-btn-enter'));
  const inCamp = await waitCamp(page, 30000);
  return inCamp ? code : null;
}
async function waitCamp(page, timeout) {
  return waitFor(page, id => BR.game.levelId === id && BR.game.screen === 'playing' && !BR.world.transitioning && !!(BR.coopCamp && BR.coopCamp.inCamp), CAMP, timeout || 30000);
}
// 输房号走到卡片这一步：主页「联机」→「加入朋友的营地」→ 输房号（满 6 位自动去查）。返回卡片状态
async function joinCard(page, code, opts) {
  const o = opts || {};
  await openCoopFromHome(page, o.touch);
  if (o.name) await page.fill('.coop-lobby .coop-name-field .coop-input', o.name);
  await press(page, o.touch, page.locator('.coop-lobby .coop-btn-join'));
  await page.waitForSelector('.coop-code-input', { state: 'visible', timeout: 20000 });
  await page.fill('.coop-code-input', o.typed || code);
  await waitFor(page, () => {
    const c = document.querySelector('.coop-camp-card');
    return c && !c.hidden && !/正在找营地/.test(c.textContent) && c.getClientRects().length > 0;
  }, null, 30000);
  return cardState(page);
}
function cardState(page) {
  return ev(page, () => {
    const vis = e => !!e && !e.hidden && e.getClientRects().length > 0;
    const card = document.querySelector('.coop-camp-card');
    const join = document.querySelector('.coop-btn-joincamp');
    return {
      shown: vis(card), title: vis(document.querySelector('.coop-card-title')) ? document.querySelector('.coop-card-title').textContent : '',
      why: vis(document.querySelector('.coop-card-why')) ? document.querySelector('.coop-card-why').textContent : '',
      join: vis(join), joinEnabled: vis(join) && !join.disabled, privacy: vis(document.querySelector('.coop-privacy')),
      value: (document.querySelector('.coop-code-input') || {}).value, phase: BR.coop.phase,
    };
  });
}
// 加入营地：code 是房号（走输房号）或者 null（页面已经停在邀请链接的卡片上）。opts.click=false 只走到卡片。
// opts.wait（默认 true）等两边都连上、客机进了营地
async function joinCamp(page, code, opts) {
  const o = opts || {};
  const card = code ? await joinCard(page, code, o) : await cardState(page);
  if (o.click === false || !card.join) return { card, joined: false };
  await press(page, o.touch, page.locator('.coop-lobby .coop-btn-joincamp'));
  if (o.wait === false) return { card, joined: false };
  const joined = await waitFor(page, () => BR.coop.active && BR.coop.phase === 'active', null, o.timeout || 90000) && await waitCamp(page, 45000);
  return { card, joined };
}
async function waitActive(pages, timeout) {
  const r = await Promise.all(pages.map(p => waitFor(p, () => BR.coop.active && BR.coop.phase === 'active', null, timeout || 45000)));
  return r.every(Boolean);
}
// 帐篷里改选择：走 BR.coopCamp._debugSet（房主直接写、客机走 use，和选单同一条广播路径）
function tentPick(page, sel) { return ev(page, s => BR.coopCamp._debugSet(s), sel); }
// 走进帐篷（跳过「走到门口」的路径检查），等选单打开
async function enterTent(page) {
  await ev(page, () => { if (!BR.coopCamp.panelOpen) BR.coopCamp.enter({ force: true }); });
  return waitFor(page, () => BR.coopCamp.panelOpen && !!document.querySelector('.tent-menu:not([hidden]) .tent-ready'), null, 8000);
}
// 两人都进帐篷点「准备」，等房主写下 goAt（倒数开始）。opts.wait=false：点完就返回（调用方自己在页面里卡倒数的时间点）
async function readyBoth(pages, opts) {
  const o = opts || {};
  for (const p of pages) if (!await enterTent(p)) return false;
  for (const p of pages) {
    const can = await waitFor(p, () => { const b = document.querySelector('.tent-menu .tent-ready'); return b && !b.disabled && /^准备$/.test(b.textContent.trim()); }, null, 8000);
    if (!can) return false;
  }
  // 两个「准备」紧挨着点：倒数只有 3 秒，中间别耽搁
  for (const p of pages) await ev(p, () => document.querySelector('.tent-menu .tent-ready').click());
  if (o.wait === false) return true;
  const ok = await Promise.all(pages.map(p => waitFor(p, () => { const s = BR.coopCamp.state; return !!(s && s.goAt > 0); }, null, 8000)));
  return ok.every(Boolean);
}
// 等两人都离开营地、在目标层亮起来（黑幕撤掉、过场结束）
async function waitArrived(pages, lv, mode, timeout) {
  const r = await Promise.all(pages.map(p => waitFor(p, a => BR.game.levelId === a.lv && (!a.mode || BR.game.mode === a.mode) && BR.game.screen === 'playing' &&
    !BR.world.transitioning && BR.coopCamp.transit === 'idle', { lv, mode }, timeout || 40000)));
  return r.every(Boolean);
}
async function departBoth(pages, lv, mode) {
  const ready = await readyBoth(pages);
  const arrived = ready && await waitArrived(pages, lv, mode, 45000);
  await sleep(800);
  return { ready, arrived };
}
// 横幅上的按钮（同意 / 不要 / 再开一个营地等朋友 / 回主页 / 不等了）
async function noticeBtn(page, label, touch) {
  const loc = page.locator('.hud-notice .hud-notice-btn', { hasText: new RegExp('^' + label + '$') }).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await press(page, touch, loc);
}
const snapRun = page => ev(page, () => ({
  lv: BR.game.levelId, mode: BR.game.mode, seed: BR.game.seed >>> 0, levelSeed: BR.world.levelSeed, x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2),
  inv: __t.inv(), active: BR.coop.active, phase: BR.coop.phase, role: BR.coop.role, screen: BR.game.screen,
}));

// 出发 / 回营地亮起来以后：两台电脑都要么锁着指针，要么有「点一下画面继续」横幅。再照横幅说的点在它正中：
// 横幅不接点击（hud-notice-pass），这一下落到画面上锁住指针，鼠标横移视角跟着转（2026-10-05 返修 r2）。
// 查完把指针锁放掉（关一下输入再打开：input 自己退锁，不当成意外丢失、不暂停），免得后面点 DOM 的步骤点不到按钮
let lockPages = [];
async function lockHintCheck(tag) {
  const look = p => ev(p, () => {
    const n = Array.from(document.querySelectorAll('.hud-notice')).filter(x => x.getClientRects().length && /点一下画面/.test(x.textContent));
    const r = n.length ? n[0].getBoundingClientRect() : null;
    return { locked: !!document.pointerLockElement, hint: n.length > 0, cx: r ? Math.round(r.x + r.width / 2) : 0, cy: r ? Math.round(r.y + r.height / 2) : 0, yaw: BR.player.yaw, screen: BR.game.screen, inputOn: BR.input.enabled };
  });
  const sts = [];
  for (const p of lockPages) {
    await waitFor(p, () => !!document.pointerLockElement || Array.from(document.querySelectorAll('.hud-notice')).some(x => x.getClientRects().length && /点一下画面继续/.test(x.textContent)), null, 5000);
    sts.push(await look(p));
  }
  check(tag + '：两台电脑都锁着指针，或者提示「点一下画面继续」', sts.every(s => s.locked || s.hint), sts);
  const p = lockPages[0], s0 = sts[0];
  if (s0 && s0.hint && !s0.locked) {
    await p.mouse.click(s0.cx, s0.cy);
    const locked = await waitFor(p, () => !!document.pointerLockElement, null, 3000);
    await p.mouse.move(400, 300); await p.mouse.move(600, 300);
    await sleep(400);
    const s1 = await look(p);
    check(tag + '：照横幅说的点在它正中 → 指针锁上、横幅收起，鼠标横移视角会转', locked && s1.locked && !s1.hint && Math.abs(s1.yaw - s0.yaw) > 0.01, { before: s0, after: s1 });
  }
  for (const q of lockPages) await ev(q, () => { const on = BR.input.enabled; if (document.pointerLockElement) { BR.input.enabled = false; BR.input.enabled = on; } return 0; });
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
    if (!ONLY || ONLY.has('main')) await run(browser, base);
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  }
  try {
    if ((!ONLY || ONLY.has('veh')) && !SKIP.has('veh')) await runVeh(browser, base);
  } catch (err) {
    check('V 叉车联机流程未中断', false, String(err && err.stack || err));
  } finally {
    // browser.close() 偶尔要等好几分钟（Chrome 退出后遗留的 crashpad 进程占着管道，见 tests/kit.mjs、tests/all.mjs）：最多等 10 s，汇总照常打印
    await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
    srv.close();
  }

  fs.appendFileSync(LOG_FILE, '\n===== 信令 =====\n' + JSON.stringify(sig.calls) + '\n' + sig.log.join('\n') + '\n');

  console.log('\n----- 99 console 报错 -----');
  const stunRe = /stun|turn|ice|webrtc|rtcpeer|getaddrinfo|mdns/i;
  const stunWarn = warnings.filter(w => stunRe.test(w));
  const otherWarn = warnings.filter(w => !stunRe.test(w));
  check('99 所有页面 console 零报错（console.error / pageerror）', errors.length === 0, errors.slice(0, 10));
  info('WebRTC/STUN 相关警告（离线环境 STUN 超时，可忽略）' + stunWarn.length + ' 条', stunWarn.slice(0, 5));
  info('其他警告 ' + otherWarn.length + ' 条', otherWarn.slice(0, 12));
  info('信令请求的浏览器网络错误（照真服务器回的 4xx、测试断网时的失败；不算页面报错）' + netNoise.length + ' 条', netNoise.slice(0, 6));
  check('99 信令请求方法与 room.php 一致（create/join/signal/close=POST，status/poll=GET）', methodMismatch.length === 0, methodMismatch);
  info('信令调用次数', sig.calls);

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail).slice(0, 800));
  if (skips.length) { console.log('跳过 ' + skips.length + ' 项'); for (const s of skips) console.log('  SKIP ' + s); }
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors.slice(0, 30)) console.log('  ' + e);
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT) + '/coop-*.png；console 全量：tests/output/coop-console.log');
  process.exitCode = failed.length || errors.length ? 1 : 0;
  // 关浏览器最多等了 10 s：没关干净的 Chrome 子进程会占着句柄，node 自己不退出
  setTimeout(() => process.exit(process.exitCode), 200);
}

async function run(browser, base) {
  const ctxA = await newContext(browser, 'A');
  let ctxB = await newContext(browser, 'B');
  const A = await newPage(ctxA, 'A');
  let B = await newPage(ctxB, 'B');
  await Promise.all([boot(A, base), boot(B, base)]);
  lockPages = [A, B];
  await ev(A, () => BR.skin.set('pink'));
  await ev(B, () => BR.skin.set('blue'));
  const skins = await Promise.all([ev(A, () => BR.skin.current), ev(B, () => BR.skin.current)]);
  check('0 准备：A 皮肤粉色、B 皮肤蓝色（BR.skin.set）', skins[0] === 'pink' && skins[1] === 'blue', skins);
  const caps = await ev(A, () => BR.coop.debugInfo().caps);
  check('0 BR.coop.debugInfo().caps 带 camp1（缺了就拒绝配对）', Array.isArray(caps) && caps.includes('camp1'), caps);

  let code = null;          // A 当前的房号
  let chairKey = null, chairTo = null;
  const lastSel = {};       // 出发前帐篷里的选择（回营地后要还在）

  // ------------------------------------------------------------------
  await step('1 主页「联机」入口与第一屏', async () => {
    const btn = await ev(A, () => {
      const b = document.querySelector('.home-secondary-btn.is-coop');
      return b ? { text: b.textContent.trim(), visible: b.getClientRects().length > 0, disabled: b.disabled, order: Array.from(document.querySelectorAll('.home-secondary-btn')).map(x => x.textContent.trim()) } : null;
    });
    check('1 主页有单独的「联机」按钮（.home-secondary-btn.is-coop）', !!btn && btn.visible && !btn.disabled && /联机/.test(btn.text), btn);
    await openCoopFromHome(A);
    const first = await ev(A, () => {
      const L = document.querySelector('.coop-lobby');
      const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const btns = Array.from(L.querySelectorAll('button')).filter(vis).map(b => b.textContent.trim());
      const inputs = Array.from(L.querySelectorAll('input')).filter(vis).map(i => i.className);
      return { btns, inputs, sub: (L.querySelector('.coop-sub') || {}).textContent, text: L.innerText };
    });
    const want = ['开一个营地', '加入朋友的营地'];
    check('1 第一屏只有昵称框和「开一个营地」「加入朋友的营地」，副标题「2 人 · 语音默认闭麦」', want.every(w => first.btns.includes(w)) &&
      first.btns.filter(b => !want.includes(b) && b !== '×').length === 0 && first.inputs.length === 1 && first.sub === '2 人 · 语音默认闭麦', first);
    check('1 第一屏不出现模式、层级、难度', !/游玩|噩梦|测试模式|Level|难度/.test(first.text), first.text.slice(0, 200));
    await shot(A, 'lobby-first');
    await A.click('.coop-lobby .coop-close');
    await sleep(300);
  });

  // ------------------------------------------------------------------
  await step('4a 房主一个人进营地', async () => {
    code = await hostCamp(A, '房主A', { shot: 'lobby-host-code' });
    check('4a A 从主页「联机」→「开一个营地」拿到 6 位房号（没有 0、O、1、I），再点「进营地等朋友」进了营地', !!code && /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    if (!code) return;
    const room = rooms.get(code);
    check('4a 服务器上的房主昵称末尾带营地暗标 U+2063（trim 没剥掉），总长 ≤ 16', !!room && room.host_name === '房主A' + CAMP_TAG && Array.from(room.host_name).length <= 16, room && JSON.stringify(room.host_name));
    await sleep(1500);
    const st = await ev(A, () => ({
      hosting: BR.coop.hosting, code: BR.coop.code, hud: __t.hudCode(), board: __t.boardText(), lv: BR.game.levelId, mode: BR.game.mode,
      x: BR.player.x, z: BR.player.z, ents: BR.entities.list.filter(e => !e.removed).length, items: BR.items.list.length,
    }));
    check('4a 营地里：BR.coop.hosting、出生在第 0 格、没有实体和物资', st.hosting && st.lv === CAMP && Math.hypot(st.x - 15, st.z - 21.2) < 0.5 && st.ents === 0 && st.items === 0, st);
    check('4a 左上角角标和小黑板上的房号一致（小黑板写「房号 K7M 2QX / 等朋友来」）', !!st.hud && st.hud.includes(code) && !!st.board && st.board.includes(fmtCode(code)) && /等朋友来/.test(st.board), { hud: st.hud, board: st.board });
    await ev(A, () => { const d = __t.campData(); BR.player.reset({ x: 16, y: 0, z: 22.6, yaw: 0 }, { full: false }); BR.player.pitch = 0.25; });
    await sleep(600);
    await shot(A, 'host-alone-board');
    // 一个人进帐篷：「准备」是灰的，写「等朋友来」
    const inTent = await enterTent(A);
    const tent = await ev(A, () => {
      const b = document.querySelector('.tent-menu .tent-ready'), w = document.querySelector('.tent-menu .tent-why');
      return { disabled: b && b.disabled, text: b && b.textContent.trim(), why: w && !w.hidden ? w.textContent : '', title: (document.querySelector('.tent-title') || {}).textContent };
    });
    check('4a 一个人进帐篷：选单「选下一站」，「准备」是灰的、写「等朋友来」', inTent && tent.disabled && /等朋友来/.test(tent.why) && tent.title === '选下一站', tent);
    await shot(A, 'host-alone-tent');
    await ev(A, () => BR.coopCamp.onBack());
    await waitFor(A, () => !BR.coopCamp.panelOpen && BR.input.enabled, null, 5000);
    // 电脑上按 Esc 出帐篷（这一下不是点击，锁不上指针）：走出来以后提示「点一下画面继续」（2026-10-05 返修 r1）
    const hint = await waitFor(A, () => __t.noticeTexts().some(t => /点一下画面继续/.test(t)) || !!document.pointerLockElement, null, 5000);
    const hintSt = await ev(A, () => ({ notes: __t.noticeTexts(), locked: !!document.pointerLockElement }));
    check('4a Esc 出帐篷后：电脑上提示「点一下画面继续」（或者指针本来就锁着）', hint, hintSt);
    // 一个人开着营地等朋友：暂停菜单有「复制邀请链接」（.hud-btn-invite），点了调 BR.coop.copyInvite（2026-10-05 返修 r1）
    await ev(A, () => {
      const c = BR.coop;
      window.__inviteCalls = 0;
      if (!c.__inviteSpy) { const o = c.copyInvite; c.copyInvite = function () { window.__inviteCalls++; return o.apply(this, arguments); }; c.__inviteSpy = true; }
      BR.hud.pause(true);
    });
    const inv = await waitFor(A, () => { const b = document.querySelector('.hud-pause .hud-btn-invite'); return !!b && !b.hidden && b.getClientRects().length > 0; }, null, 5000);
    await sleep(700);   // 暂停菜单刚打开有一小段防误触
    if (inv) await A.click('.hud-pause .hud-btn-invite').catch(() => {});
    await sleep(600);
    const invSt = await ev(A, () => ({ calls: window.__inviteCalls, text: (document.querySelector('.hud-pause .hud-btn-invite') || {}).textContent, camp: !!(document.querySelector('.hud-pause .hud-btn-camp') && !document.querySelector('.hud-pause .hud-btn-camp').hidden) }));
    check('4a 一个人开着营地等人：暂停菜单有「复制邀请链接」、没有「回营地」，点了调 BR.coop.copyInvite、按钮上闪结果', inv && invSt.calls === 1 && !invSt.camp && /已复制|已分享|复制失败/.test(invSt.text || ''), invSt);
    await ev(A, () => BR.hud.pause(false));
    await waitFor(A, () => BR.game.screen === 'playing', null, 5000);
  });

  // ------------------------------------------------------------------
  await step('4a+ 房号 110 分钟续期、房间被服务器清掉也续期', async () => {
    if (!code) return;
    const t0 = await ev(A, () => performance.now());
    await ev(A, () => BR.net._debugAge(110 * 60 * 1000));   // 把建房时间往前推 110 分钟（net.js 的测试口）
    const renewed = await waitFor(A, c => BR.coop.code && BR.coop.code !== c, code, 20000);
    const c2 = await ev(A, () => BR.coop.code);
    await sleep(800);
    const r = await ev(A, t0 => ({ hud: __t.hudCode(), board: __t.boardText(), toasts: __t.toasts.slice(-4), bus: __t.since(__t.bus, t0).filter(b => b.n === 'coop:code').map(b => b.p) }), t0);
    check('4a+ 第 110 分钟自动换新房号：旧房间在服务器上已关，新房间开着、带暗标', renewed && rooms.get(code) && rooms.get(code).state === 'closed' && rooms.get(c2) && rooms.get(c2).state === 'waiting' && rooms.get(c2).host_name.endsWith(CAMP_TAG), { old: code, now: c2, oldState: rooms.get(code) && rooms.get(code).state });
    check('4a+ 换号后角标、小黑板一起更新，bus coop:code、toast「房号换成了 …」', !!r.hud && r.hud.includes(c2) && !!r.board && r.board.includes(fmtCode(c2)) && r.bus.some(b => b.code === c2) && r.toasts.some(t => /房号换成了/.test(t)), r);
    // 服务器把房间清掉（TTL 或别的原因）：房主不在大厅里，按同一条续期走，不当致命错误
    rooms.delete(c2);
    const regone = await waitFor(A, c => BR.coop.code && BR.coop.code !== c && BR.coop.hosting, c2, 25000);
    const c3 = await ev(A, () => BR.coop.code);
    check('4a+ 服务器上房间没了（room_not_found）：房主自动换一个新房号接着等，还在营地里', regone && !!rooms.get(c3) && (await ev(A, () => BR.game.levelId)) === CAMP, { gone: c2, now: c3 });
    code = c3;
  });

  // ------------------------------------------------------------------
  await step('4n 不是后室营地的房间', async () => {
    const rc = newCode();
    rooms.set(rc, { state: 'waiting', host_name: '火箭工程师', guest_name: null, createdAt: Date.now() });   // 火箭游戏 / 旧版后室建的房：没有暗标
    const card = await joinCard(B, rc, { name: '客机B', typed: rc.slice(0, 3).toLowerCase() + '-' + rc.slice(3).toLowerCase() });
    check('4n 输房号：小写、横杠自动规整成 6 位大写', card.value === rc, card.value);
    check('4n 查到的不是营地：卡片写原因（不是后室的营地），没有「加入」', card.shown && /不是后室的营地/.test(card.why) && !card.join && !card.privacy, card);
    check('4n 没去占房：服务器上这个房间还是 waiting、没有 join 请求', rooms.get(rc).state === 'waiting' && !sig.joins[rc], { state: rooms.get(rc).state, joins: sig.joins[rc] || 0 });
    await shot(B, 'card-not-camp');
    // 房号框：0、O、1、I 不收，当场红字
    await B.fill('.coop-code-input', 'k7o');
    const bad = await ev(B, () => ({ v: document.querySelector('.coop-code-input').value, err: (document.querySelector('.coop-code-err') || {}).textContent }));
    check('4n 房号框敲到 0、O、1、I：这个字不收，红字「房号里没有 0、O、1、I」', bad.v === 'K7' && /房号里没有 0、O、1、I/.test(bad.err || ''), bad);
    await B.click('.coop-lobby .coop-close');
    await sleep(300);
  });

  // ------------------------------------------------------------------
  await step('4l 邀请链接', async () => {
    if (!code) return;
    // 和「复制邀请链接」一样拼：location.origin + location.pathname + '#join=' + 房号（不带 ?dev）
    const link = await ev(A, c => location.origin + location.pathname + '#join=' + c, code);
    await boot(B, base, link);
    await ev(B, () => BR.skin.set('blue'));
    const shown = await waitFor(B, () => { const b = document.querySelector('.coop-btn-joincamp'); return b && b.getClientRects().length > 0 && !b.disabled; }, null, 20000);
    const st = await cardState(B);
    const hash = await ev(B, () => location.hash);
    check('4l 打开邀请链接：联机面板直接停在「「房主A」的营地」卡片，有「加入」和隐私提示，还要点一下才加入', shown && st.title === '「房主A」的营地' && st.join && st.privacy && st.phase === 'confirm', st);
    check('4l 读完立刻把地址里的 #join= 去掉', hash === '', hash);
    await shot(B, 'invite-link-card');
    await B.click('.coop-lobby .coop-close');
    await sleep(300);
  });

  // ------------------------------------------------------------------
  // 旧版、别的游戏：O 加入 A 的营地，O 发出去的 hello 被改写（给 BR.net.send 包一层）
  await step('4o 旧版被拒、别的游戏的 hello', async () => {
    if (!code) return;
    const ctxO = await newContext(browser, 'O');
    const O = await newPage(ctxO, 'O');
    try {
      await boot(O, base);
      for (const kind of ['old', 'rocket']) {
        const codeBefore = await ev(A, () => BR.coop.code);
        const t0 = await ev(A, () => performance.now());
        await ev(O, k => {
          if (!window.__origSend) window.__origSend = BR.net.send;
          BR.net.send = function (obj, opt) {
            if (obj && obj.t === 'hello') {
              obj = Object.assign({}, obj);
              if (k === 'old') obj.caps = (obj.caps || []).filter(c => c !== 'camp1');
              else obj.game = 'rocket';
            }
            return window.__origSend.call(this, obj, opt);
          };
        }, kind);
        const j = await joinCamp(O, codeBefore, { name: '客机O', wait: false });
        const reopened = await waitFor(A, c => BR.coop.hosting && BR.coop.code && BR.coop.code !== c, codeBefore, 45000);
        const a = await ev(A, t0 => ({ toasts: __t.toasts.slice(-4), code: BR.coop.code, lv: BR.game.levelId, active: BR.coop.active, phase: BR.coop.phase }), t0);
        const oIdle = await waitFor(O, () => !BR.coop.active, null, 20000);
        const o = await ev(O, () => ({ phase: BR.coop.phase, active: BR.coop.active, net: BR.net.active, lv: BR.game.levelId, toasts: __t.toasts.slice(-3), status: (document.querySelector('.coop-status') || {}).textContent }));
        if (kind === 'old') {
          check('4o 对方 hello 里没有 camp1（旧版）：房主提示「对方的游戏版本旧，请对方刷新页面再试」，不配对', j.card.join && reopened && !a.active && a.toasts.some(t => /对方的游戏版本旧/.test(t)), a);
        } else {
          check('4o 对方发来别的游戏的 hello：房主提示「别的游戏的房间」，不配对', reopened && !a.active && a.toasts.some(t => /别的游戏/.test(t)), a);
        }
        check('4o（' + kind + '）房主还在营地里、原地换了新房号接着等；对方没连成', reopened && a.lv === CAMP && a.code !== codeBefore && oIdle, { a: { code: a.code, lv: a.lv, phase: a.phase }, o });
        await ev(O, () => { if (BR.game.screen !== 'home') { try { BR.coop.leave(); } catch (e) { /* 已断 */ } BR.bus.emit('game:home'); } });
        await sleep(1200);
        await ev(O, () => { const L = document.querySelector('.coop-lobby'); if (L && !L.hidden) L.querySelector('.coop-close').click(); });
        await sleep(400);
      }
      await shot(A, 'host-after-refused');
    } finally {
      await ctxO.close().catch(() => {});
    }
    code = await ev(A, () => BR.coop.code);
  });

  // ------------------------------------------------------------------
  await step('4b 房主冻结 45 s，客机开低画质输房号加入', async () => {
    if (!code) return;
    await boot(B, base);   // 邀请链接那一页不带 ?dev，重新打开
    await ev(B, () => BR.skin.set('blue'));
    await ev(B, () => { BR.game.settings.quality = 'low'; });
    await ev(A, () => { BR.player.reset({ x: 15, y: 0, z: 21.2, yaw: 0 }, { full: false }); BR.player.pitch = 0; });
    await sleep(400);
    // 房主切到微信去发房号：页面被冻结。CDP Page.setWebLifecycleState frozen 在无头 Chrome 里实测不停计时器
    // （tests/output/stage-N1/N1-tests-coop/freeze-probe.mjs：冻结 2 s 里 setInterval 照走 40 次），所以同时用调试器把页面的 JS 停住
    const cdpA = await ctxA.newCDPSession(A);
    await cdpA.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
    await cdpA.send('Debugger.enable');
    await cdpA.send('Debugger.pause');
    const tFreeze = Date.now();
    let card = null, waitText = null;
    try {
      const j = await joinCamp(B, code, { name: '客机B', wait: false });
      card = j.card;
      check('4b 客机输房号：卡片「「房主A」的营地」+「加入」+ 隐私提示', card.title === '「房主A」的营地' && card.join && card.privacy &&
        /昵称和制服颜色会发给对方/.test(await B.textContent('.coop-privacy')), card);
      const waited = await waitFor(B, () => { const li = document.querySelectorAll('.coop-steps li')[1]; return !!li && /回到游戏/.test(li.textContent); }, null, 20000);
      waitText = await ev(B, () => Array.from(document.querySelectorAll('.coop-steps li')).map(li => li.textContent).join(' → '));
      check('4b 房主冻结时客机显示「等「房主A」回到游戏…」（net waitHost）', waited && /等「房主A」回到游戏/.test(waitText), waitText);
      await shot(B, 'guest-wait-host');
      const left = 45000 - (Date.now() - tFreeze);
      if (left > 0) await sleep(left);
      const mid = await ev(B, () => ({ phase: BR.coop.phase, active: BR.coop.active, net: BR.net.active }));
      check('4b 冻结 45 s 里客机一直在等（没有报错放弃）', !mid.active && mid.net && mid.phase !== 'idle', mid);
    } finally {
      await cdpA.send('Debugger.resume').catch(() => {});
      await cdpA.send('Debugger.disable').catch(() => {});
      await cdpA.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
      await cdpA.detach().catch(() => {});
    }
    const t1 = Date.now();
    const both = await waitActive([A, B], 60000);
    const bCamp = both && await waitCamp(B, 30000);
    check('4b 房主解冻后两边连上，客机进了营地', both && bCamp, { ms: Date.now() - t1 });
    await sleep(2500);
    const [sa, sb] = await Promise.all([A, B].map(p => ev(p, () => ({
      seed: BR.game.seed >>> 0, levelSeed: BR.world.levelSeed, lv: BR.game.levelId, mode: BR.game.mode, x: BR.player.x, z: BR.player.z,
      phys: __t.physHash(), ents: BR.entities.list.filter(e => !e.removed).length, items: BR.items.list.length, stats: BR.game.statsEnabled,
      q: BR.game.settings.quality, tris: (BR.world.chunks().find(c => c.key === '0,0') || { res: {} }).res.kit.stats.triangles,
      role: BR.coop.role, peer: BR.coop.peerName, toasts: __t.toasts.slice(-5), board: __t.boardText(), hud: __t.hudCode(),
    }))));
    check('4b 客机落在挑出来的那一格（房主站第 0 格 → 客机第 1 格 (17, 21.2)）', Math.hypot(sb.x - 17, sb.z - 21.2) < 0.35, { A: [sa.x, sa.z], B: [sb.x, sb.z] });
    check('4b 两边 seed、levelSeed 一致', sa.seed === sb.seed && sa.levelSeed === sb.levelSeed && sa.lv === CAMP && sb.lv === CAMP, { A: [sa.seed, sa.levelSeed], B: [sb.seed, sb.levelSeed] });
    check('4b 营地碰撞体采样哈希一致（客机低画质、房主高画质，布局一样）', sa.phys.hash === sb.phys.hash && sa.phys.blocked > 0, { A: sa.phys.hash, B: sb.phys.hash, blocked: [sa.phys.blocked, sb.phys.blocked], q: [sa.q, sb.q], tris: [sa.tris, sb.tris] });
    check('4b 客机保留本机低画质（营地块面数比房主的少）', sb.q === 'low' && sa.q !== 'low' && sb.tris < sa.tris, { q: [sa.q, sb.q], tris: [sa.tris, sb.tris] });
    check('4b 营地里实体 0、物资 0，statsEnabled=false（不饿、不掉 san）', sa.ents === 0 && sb.ents === 0 && sa.items === 0 && sb.items === 0 && sa.stats === false && sb.stats === false, { A: [sa.ents, sa.items, sa.stats], B: [sb.ents, sb.items, sb.stats] });
    check('4b 角色 host / guest、昵称互通；房主收到「「客机B」来到了营地」', sa.role === 'host' && sb.role === 'guest' && sa.peer === '客机B' && sb.peer === '房主A' && sa.toasts.some(t => /客机B」来到了营地/.test(t)), { A: sa.toasts, B: sb.toasts });
    check('4b 两人都在：角标收起，小黑板换成「下一站：…」', !sa.hud && !!sa.board && /下一站/.test(sa.board), { hud: sa.hud, board: sa.board });
    await shot(A, 'camp-both-A');
    await shot(B, 'camp-both-B');
    // 房主挪一把椅子：客机那边跟着挪；回营地后还要在（营地布置按一次联机保存）
    const mv = await ev(A, () => {
      const P = BR.world.propsNear(13.5, 18.8, 0.5).find(p => p.kind === 'chair' || (p.rec && p.rec.kind === 'chair'));
      if (!P) return null;
      const to = { x: +(P.x - 0.3).toFixed(3), z: +(P.z - 0.45).toFixed(3) };
      const ok = BR.world.movePropTo(P.key, to.x, to.z) && BR.world.commitProp(P.key);
      const Q = BR.world.propByKey(P.key);
      return { key: P.key, ok, to: { x: +Q.x.toFixed(3), z: +Q.z.toFixed(3) } };
    });
    if (mv) {
      chairKey = mv.key; chairTo = mv.to;
      const synced = await waitFor(B, a => { const P = BR.world.propByKey(a.key); return !!P && Math.hypot(P.x - a.to.x, P.z - a.to.z) < 0.02; }, mv, 5000);
      check('4b 房主挪了一把折叠椅，客机那边跟着挪', mv.ok && synced, { mv, B: await ev(B, k => __t.prop(k), mv.key) });
    } else check('4b 找到营地的折叠椅', false, null);
  });

  // ------------------------------------------------------------------
  // 2026-10-05 返修：以前站位按「离队友远」挑，两人前后脚按空格时各自看到的对方位置都晚 100–300 ms，两边都挑中 stand[0]、叠在一起；
  // 一起出帐篷也都走到门外同一点。现在站位按角色固定、出帐篷各站一边
  await step('4b2 两人前后脚进帐篷：站位不同、相距 1 m、看得见对方；一起出帐篷各站一边', async () => {
    for (const [lag, tag] of [[0, '同时按'], [300, '客机晚 0.3 s 按']]) {
      // 两人并排站在门前通道里（房主偏西、客机偏东），面朝帐篷站一会儿（对方人形的插值追上、站着不动）
      await ev(A, () => { BR.player.reset({ x: 15.6, y: 0, z: 19.6, yaw: 0 }, { full: false }); BR.player.pitch = 0; });
      await ev(B, () => { BR.player.reset({ x: 16.4, y: 0, z: 19.6, yaw: 0 }, { full: false }); BR.player.pitch = 0; });
      await sleep(1500);
      const enter = p => ev(p, () => BR.coopCamp.enter());
      const r = lag ? await Promise.all([enter(A), sleep(lag).then(() => enter(B))]) : await Promise.all([enter(A), enter(B)]);
      const open = await Promise.all([A, B].map(p => waitFor(p, () => BR.coopCamp.panelOpen, null, 8000)));
      await sleep(1500);
      const snap = p => ev(p, () => ({ x: +BR.player.x.toFixed(3), z: +BR.player.z.toFixed(3), peer: __t.peerSuit() }));
      const [sa, sb] = await Promise.all([snap(A), snap(B)]);
      const d = Math.hypot(sa.x - sb.x, sa.z - sb.z);
      const sees = (s, o) => !!s.peer && s.peer.visible && Math.hypot(s.peer.x - o.x, s.peer.z - o.z) < 0.35;
      check('4b2 ' + tag + '进帐篷：两人都走进去、选单开着，站位不同、相距 1.0±0.05 m，两边都看得见对方的人形',
        r[0] !== false && r[1] !== false && open.every(Boolean) && Math.abs(d - 1) <= 0.05 && sees(sa, sb) && sees(sb, sa),
        { enter: r, open, A: [sa.x, sa.z], B: [sb.x, sb.z], d: +d.toFixed(3), peerOnA: sa.peer, peerOnB: sb.peer });
      if (!lag) {
        // 选单先藏一下、转头看旁边的队友：截图里要看得到对方的人形（站位相距 1 m，没被藏掉、没叠在一起）
        await ev(A, () => { const m = document.querySelector('.tent-menu'); if (m) m.style.visibility = 'hidden'; window.__yaw0 = BR.player.yaw; window.__pit0 = BR.player.pitch; BR.player.yaw = -Math.PI / 2 + 0.35; BR.player.pitch = -0.15; });
        await sleep(400);
        await shot(A, 'tent-two-stands-A');
        await ev(A, () => { const m = document.querySelector('.tent-menu'); if (m) m.style.visibility = ''; BR.player.yaw = window.__yaw0; BR.player.pitch = window.__pit0; });
      }
      // 一起出帐篷：各走到门外自己那一边
      await Promise.all([A, B].map(p => ev(p, () => BR.coopCamp.exit())));
      await Promise.all([A, B].map(p => waitFor(p, () => !BR.coopCamp.panelOpen && !BR.coopCamp.debugInfo().walking, null, 6000)));
      await sleep(800);
      const [oa, ob] = await Promise.all([snap(A), snap(B)]);
      const d2 = Math.hypot(oa.x - ob.x, oa.z - ob.z);
      const inCor = q => q.x >= 15.3 - 1e-3 && q.x <= 16.7 + 1e-3 && q.z > 17.2;
      check('4b2 ' + tag + '后一起出帐篷：各站门外一边，相距 ≥ 0.9 m，都在门前通道里，看得见对方',
        d2 >= 0.9 && inCor(oa) && inCor(ob) && sees(oa, ob) && sees(ob, oa), { A: [oa.x, oa.z], B: [ob.x, ob.z], d: +d2.toFixed(3) });
      if (!lag) await shot(A, 'tent-two-out-A');
    }
  });

  // ------------------------------------------------------------------
  // 2026-10-05 返修 r2：挂钩以前按 BR.SKINS 顺序换「下一种」，会换上队友正穿着、挂钩上根本没有的那件；
  // 队友站在门外正中等着时，出帐篷的人走进他身体里
  await step('4b3 挂钩：对准哪件换哪件，队友身上那件换不到；队友堵在门口时进出帐篷', async () => {
    await ev(A, () => BR.skin.set('red'));
    await ev(B, () => BR.skin.set('pink'));
    const synced = await waitFor(A, () => BR.coop.peerSkin === 'pink', null, 6000) && await waitFor(B, () => BR.coop.peerSkin === 'red', null, 6000);
    await sleep(600);
    const hk = await ev(A, () => { const d = __t.campData(); return { hooks: d.hooks, skins: d.skins }; });
    const hasAt = !!hk.hooks && Array.isArray(hk.hooks.at) && hk.hooks.at.length === hk.skins.length;
    check('4b3 营地数据带每件制服沿挂钩排列的位置（hooks.at，顺序同 skins）', synced && hasAt, { synced, hooks: hk.hooks, skins: hk.skins });
    if (!hasAt) return;
    const vis = () => ev(A, () => {
      const c = BR.world.chunks().find(x => x.res && x.res.data && x.res.data._uniforms);
      const u = c && c.res.data._uniforms, out = {};
      if (u) for (const k of Object.keys(u)) out[k] = u[k].length > 0 && u[k].every(p => p.visible);
      return out;
    });
    const rows = [];
    for (let i = 0; i < hk.skins.length; i++) {
      const key = hk.skins[i];
      // 站在挂钩那一面外 1 m，准心对准第 i 件（真按键盘空格）
      const aim = await ev(A, ([h, z]) => {
        BR.player.reset({ x: h.x - 1.0, y: 0, z, yaw: 0 }, { full: false });
        BR.interact.aimAt(h.x, 1.3, z);
        return 0;
      }, [hk.hooks, hk.hooks.at[i]]);
      await sleep(350);
      const before = await ev(A, k => {
        const c = BR.interact.current;
        const p = document.querySelector('.hud-prompt');
        return { key: c && c.key, short: c && c.short ? { verb: c.short.verb, ok: c.short.ok, why: c.short.why, name: c.short.name } : null, prompt: p ? p.textContent.replace(/\s+/g, ' ').trim() : '', skin: BR.skin.current, n: __t.toasts.length };
      }, key);
      const v0 = await vis();
      await tapKey(A, 'Space');
      await sleep(450);
      const after = await ev(A, n => ({ skin: BR.skin.current, toasts: __t.toasts.slice(n) }), before.n);
      rows.push({ i, key, aim, before, onHook: v0[key], after });
    }
    const zh = await ev(A, () => Object.fromEntries(BR.SKINS.map(s => [s.key, s.zh])));
    const peerRow = rows.find(r => r.key === 'pink');
    check('4b3 A 穿红、B 穿粉：A 对准挂钩上空着的粉色那格，灰字「「客机B」穿着这件」，按了也不换', !!peerRow && peerRow.before.key === 'coopcamp:hooks' && peerRow.before.short && peerRow.before.short.ok === false &&
      peerRow.before.short.why === '「客机B」穿着这件' && peerRow.onHook === false && peerRow.after.skin === peerRow.before.skin && peerRow.after.toasts.some(t => t === '「客机B」穿着这件'), peerRow);
    check('4b3 A 依次对准六格各按一次：永远不会换成队友身上的粉色', rows.every(r => r.after.skin !== 'pink'), rows.map(r => [r.key, r.before.skin, r.after.skin]));
    const okRows = rows.filter(r => r.key !== 'pink' && r.key !== r.before.skin);
    check('4b3 对准挂着的那件：提示「空格 换制服 X那件」，按了就换成它（换之前它确实挂在钩上）、toast「换上了X制服」',
      okRows.length >= 4 && okRows.every(r => r.before.short && r.before.short.ok !== false && r.before.short.name === zh[r.key] + '那件' && /换制服/.test(r.before.prompt) && r.before.prompt.indexOf(zh[r.key] + '那件') >= 0 &&
        r.onHook === true && r.after.skin === r.key && r.after.toasts.includes('换上了' + zh[r.key] + '制服')), okRows.map(r => ({ key: r.key, prompt: r.before.prompt, onHook: r.onHook, after: r.after.skin })));
    const meRow = rows.find(r => r.key === r.before.skin);
    if (meRow) check('4b3 对准自己正穿着的那件（钩上空着）：灰字「这件就穿在你身上」，按了不换', meRow.before.short && meRow.before.short.ok === false && meRow.before.short.why === '这件就穿在你身上' && meRow.after.skin === meRow.before.skin, meRow);
    await shot(A, 'hooks-peer-pink');
    await ev(A, () => BR.skin.set('pink'));
    await ev(B, () => BR.skin.set('blue'));
    await waitFor(A, () => BR.coop.peerSkin === 'blue', null, 6000);

    // 队友堵门：B 站着不动，A 在帐篷里按 Esc（onBack）出来
    const d = await ev(A, () => __t.campData());
    const door = d.tent.door;
    const pos = p => ev(p, () => ({ x: +BR.player.x.toFixed(3), z: +BR.player.z.toFixed(3) }));
    for (const [tag, bz, wantOut] of [['门外正中 1.2 m', door.z + 1.2, true], ['门口 0.7 m', door.z + 0.7, false]]) {
      await ev(B, ([x, z]) => { BR.player.reset({ x, y: 0, z: 22.4, yaw: 0 }, { full: false }); }, [door.x, bz]);
      await ev(A, () => { BR.player.reset({ x: 15.6, y: 0, z: 19.6, yaw: 0 }, { full: false }); });
      await sleep(600);
      const inT = await enterTent(A);
      await waitFor(A, () => !BR.coopCamp.debugInfo().walking, null, 6000);
      await ev(B, ([x, z]) => { BR.player.reset({ x, y: 0, z, yaw: 0 }, { full: false }); }, [door.x, bz]);
      // A 那边看到的 B 站稳（插值追上、速度降下来）
      await waitFor(A, ([x, z]) => BR.coop.peer && Math.hypot(BR.coop.peer.x - x, BR.coop.peer.z - z) < 0.05, [door.x, bz], 10000);
      await sleep(2500);
      const n0 = await ev(A, () => __t.toasts.length);
      await ev(A, () => BR.coopCamp.onBack());
      await waitFor(A, () => !BR.coopCamp.panelOpen && !BR.coopCamp.debugInfo().walking, null, 6000);
      await sleep(500);
      const [pa, pb] = await Promise.all([pos(A), pos(B)]);
      const tt = await ev(A, n => __t.toasts.slice(n), n0);
      const dd = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      if (wantOut) check('4b3 B 站在' + tag + '等着，A 出帐篷：走到门外、不和 B 叠在一起（相距 ≥ 0.8 m）', inT && pa.z > door.z + 0.3 && dd >= 0.8, { A: pa, B: pb, d: +dd.toFixed(2), toasts: tt });
      else check('4b3 B 站在' + tag + '堵着，A 出帐篷：停在门槛里面、不穿过 B，提示「「客机B」挡在门口」', inT && pa.z < door.z && dd >= 0.6 && tt.includes('「客机B」挡在门口'), { A: pa, B: pb, d: +dd.toFixed(2), toasts: tt });
    }
    // 进帐篷：B 站在门口不动，A 在门前通道里按「进帐篷」→ 不走，提示「「客机B」挡在门口」
    await ev(A, () => { BR.player.reset({ x: 16, y: 0, z: 19.8, yaw: 0 }, { full: false }); });
    await ev(B, ([x, z]) => { BR.player.reset({ x, y: 0, z, yaw: 0 }, { full: false }); }, [door.x, door.z + 0.5]);
    await waitFor(A, ([x, z]) => BR.coop.peer && Math.hypot(BR.coop.peer.x - x, BR.coop.peer.z - z) < 0.05, [door.x, door.z + 0.5], 10000);
    await sleep(2500);
    const n1 = await ev(A, () => __t.toasts.length);
    const er = await ev(A, () => BR.coopCamp.enter());
    await sleep(300);
    const es = await ev(A, n => ({ toasts: __t.toasts.slice(n), walking: BR.coopCamp.debugInfo().walking, panel: BR.coopCamp.panelOpen }), n1);
    check('4b3 B 站在门口不动，A 按「进帐篷」：不走、提示「「客机B」挡在门口」', er === false && !es.walking && !es.panel && es.toasts.includes('「客机B」挡在门口'), { er, ...es });
    await ev(B, () => { BR.player.reset({ x: 17, y: 0, z: 21.2, yaw: 0 }, { full: false }); });
    await ev(A, () => { BR.player.reset({ x: 15, y: 0, z: 21.2, yaw: 0 }, { full: false }); });
    await sleep(800);
  });

  // ------------------------------------------------------------------
  await step('4c 房主在帐篷里改选择，客机 1 s 内同步、准备清掉', async () => {
    await tentPick(B, { ready: true });
    const bReady = await waitFor(A, () => { const s = BR.coopCamp.state; return !!(s && s.rdy[1]); }, null, 5000);
    const t0 = Date.now();
    const st = await tentPick(A, { mode: 'casual', lv: 'dev' });
    const synced = await waitFor(B, v => { const s = BR.coopCamp.state; return !!(s && s.v >= v && s.lv === 'dev' && s.mode === 'casual'); }, st ? st.v : 1e9, 3000);
    const ms = Date.now() - t0;
    const [sa, sb] = await Promise.all([A, B].map(p => ev(p, () => ({ st: BR.coopCamp.state, toasts: __t.toasts.slice(-3), board: __t.boardText() }))));
    check('4c 房主选「游玩 + Level Dev」，客机 1 s 内收到同一份 state', !!st && synced && ms <= 1000 && sb.st.v === sa.st.v && sb.st.lv === 'dev' && sb.st.mode === 'casual', { ms, A: sa.st && { v: sa.st.v, lv: sa.st.lv, mode: sa.st.mode }, B: sb.st && { v: sb.st.v, lv: sb.st.lv } });
    check('4c 改了选择，两边的准备都清掉（客机先点过准备）', bReady && !sa.st.rdy[0] && !sa.st.rdy[1] && !sb.st.rdy[0] && !sb.st.rdy[1], { bReady, A: sa.st.rdy, B: sb.st.rdy });
    check('4c 客机 toast「「房主A」改成了 …」，小黑板写下一站', sb.toasts.some(t => /房主A」改成了/.test(t)) && /下一站/.test(sa.board || ''), { toasts: sb.toasts, board: sa.board });
  });

  // ------------------------------------------------------------------
  await step('4d 客机改选择走 use；两人准备，客机在最后半秒之前取消，倒数停下', async () => {
    const cur = await ev(A, () => BR.coopCamp.state.spawn);
    const want = Math.abs(cur - 0.9) < 0.01 ? 0.8 : 0.9;
    await tentPick(B, { spawn: want });
    const got = await waitFor(A, w => { const s = BR.coopCamp.state; return !!s && Math.abs(s.spawn - w) < 0.005 && s.by === 'g'; }, want, 4000);
    const bSync = await waitFor(B, w => { const s = BR.coopCamp.state; return !!s && Math.abs(s.spawn - w) < 0.005; }, want, 4000);
    check('4d 客机改「实体生成量」走 use：房主核对后写入（by g）并广播回客机', got && bSync, await ev(A, () => ({ spawn: BR.coopCamp.state.spawn, by: BR.coopCamp.state.by })));
    Object.assign(lastSel, { mode: 'casual', lv: 'dev', spawn: want });
    // 「倒数从 3 开始」看客机收到房主 state 的那一刻（页面里 bus 'net:tent' 记的，见 installHelpers 的 goAts），
    // 不看下面轮询第一次看到 goAt 的时刻：机器忙时 readyBoth 返回、轮询起来已经过了一秒多（以前 g4 里误报过 first 1.76）
    const t0b = await ev(B, () => performance.now());
    const ready = await readyBoth([A, B], { wait: false });
    // 客机在倒数还剩 1.0–2.6 s 时点「取消」（倒数时「准备」按钮变成「取消」）。倒数只有 3 秒，在页面里卡时间点、直接点按钮
    const cd = ready ? await ev(B, () => new Promise(res => {
      const t0 = performance.now();
      let first = null;
      const tick = () => {
        const s = BR.coopCamp.state, b = document.querySelector('.tent-menu .tent-ready');
        const left = s && s.goAt ? s.goAt - BR.coop.clock() : null;
        if (left != null && first == null) first = +left.toFixed(2);
        if (left != null && left > 1.0 && left < 2.6 && b && !b.disabled && /^取消$/.test(b.textContent.trim())) {
          const count = (document.querySelector('.tent-count') || {}).textContent;
          b.click();
          res({ first, left: +left.toFixed(2), count, rdy: s.rdy.slice() });
          return;
        }
        if (performance.now() - t0 > 8000) { res({ first, left, miss: true, btn: b && b.textContent }); return; }
        setTimeout(tick, 8);
      };
      tick();
    })) : { miss: true };
    const g0 = await ev(B, t0 => __t.goAts.find(g => g.who === 'recv' && g.t >= t0) || null, t0b);
    cd.recv = g0;
    check('4d 两人都点「准备」→ 房主写 goAt，客机收到时离出发还有 2–3 s，选单上显示倒数', ready && !!g0 && g0.left > 2 && g0.left <= 3.05 && /^[123]$/.test(cd.count || ''), cd);
    const okWin = !cd.miss;
    const stopped = await waitFor(A, () => { const s = BR.coopCamp.state; return !!s && !s.goAt && !s.rdy[0] && !s.rdy[1]; }, null, 3000);
    const bStop = await waitFor(B, () => { const s = BR.coopCamp.state; return !!s && !s.goAt; }, null, 3000);
    await shot(B, 'tent-cancelled-B');
    await sleep(3200);
    const after = await Promise.all([A, B].map(p => ev(p, () => ({ lv: BR.game.levelId, transit: BR.coopCamp.transit, count: (() => { const c = document.querySelector('.tent-count'); return c && !c.hidden ? c.textContent : ''; })(), toasts: __t.toasts.slice(-3) }))));
    check('4d 客机在最后半秒之前取消：房主的倒数停下、准备清空，两人都还在营地', okWin && stopped && bStop && after.every(a => a.lv === CAMP && a.transit === 'idle' && !a.count), after);
    check('4d 两边都提示取消（房主「「客机B」取消了出发」）', after[0].toasts.some(t => /客机B」取消了出发/.test(t)) && after[1].toasts.some(t => /取消/.test(t)), after.map(a => a.toasts));
  });

  // ------------------------------------------------------------------
  let seed = null;
  await step('4e 再次准备后出发：同层同模式同种子，黑幕和大标题的先后', async () => {
    // 两边联机时钟的偏差在营地里、出发之前量（2026-10-05 返修 r2：原来在刚进 Level Dev 时量，客机最近 10 s 的样本全是
    // 加载卡顿时收到的、延迟都很大，机器忙时测出 4 s）。量 5 次取最小
    const clkDiffs = [];
    for (let i = 0; i < 5; i++) {
      const [oa, ob] = await Promise.all([ev(A, () => __t.clkOff()), ev(B, () => __t.clkOff())]);
      clkDiffs.push(Math.abs(oa - ob));
      await sleep(200);
    }
    const clkDiff = Math.min(...clkDiffs);
    const t0s = await Promise.all([A, B].map(p => ev(p, () => performance.now())));
    const ready = await readyBoth([A, B], { wait: false });
    // 最后半秒内客机再申请取消：房主不认，照样出发。
    // 在倒数还剩 0.8–2.6 s（窗口宽，SwiftShader 一帧很慢也卡得到）时发「取消」申请，但把这条消息在本页扣住，
    // 到倒数只剩约 0.25 s 才真正发出去——房主收到时已经在最后半秒里（或者已经出发），判的是房主那边的规则
    const late = ready ? await ev(B, () => new Promise(res => {
      const t0 = performance.now();
      let seen = false;
      const tick = () => {
        const s = BR.coopCamp.state;
        const left = s && s.goAt ? s.goAt - BR.coop.clock() : null;
        if (left != null) seen = true;
        if (left != null && left > 0.8 && left < 2.6) {
          const P = BR.player, net = BR.net, orig = net.send;
          const sendAt = performance.now() + (left - 0.25) * 1000;
          const isCancel = o => !!(o && o.t === 'ev' && Array.isArray(o.list) && o.list.some(e => Array.isArray(e) && e[0] === 'use' && e[1] && e[1].a === 'tent' && e[1].x && e[1].x.op === 'cancel'));
          net.send = function (o) {
            const args = arguments, self = this;
            if (isCancel(o) && performance.now() < sendAt) { setTimeout(() => orig.apply(self, args), sendAt - performance.now()); return true; }
            return orig.apply(self, args);
          };
          const done = r => { net.send = orig; res({ left: +left.toFixed(3), heldMs: Math.round(sendAt - t0), r }); };
          BR.coop.use('coopcamp:tent', 'tent', [P.x, P.y, P.z], done, { op: 'cancel' });
          return;
        }
        // 倒数开始过又没了（已经出发、goAt 清掉）或者等太久：没卡到时间点
        if (performance.now() - t0 > 8000 || (seen && left == null)) { res({ left, r: null, miss: true, seen }); return; }
        setTimeout(tick, 8);
      };
      tick();
    })) : { miss: true };
    const arrived = await waitArrived([A, B], 'dev', 'casual', 45000);
    // 申请到房主时倒数已经到 0（房主已开始出发、goAt 清掉）会回 ok:true（没什么可取消的）——只要照样出发了也算对
    check('4e 最后半秒内取消无效：房主回「来不及取消了」，两人照样出发', ready && arrived && !!late.r && (late.r.ok === false ? /来不及/.test(late.r.why || '') : late.r.ok === true), late);
    await sleep(1500);
    const [sa, sb] = await Promise.all([A, B].map(p => snapRun(p)));
    seed = sa.seed;
    check('4e 两人一起到了 Level Dev，模式游玩、种子一致', arrived && sa.lv === 'dev' && sb.lv === 'dev' && sa.mode === 'casual' && sb.mode === 'casual' && sa.seed === sb.seed && sa.levelSeed === sb.levelSeed, { A: sa, B: sb });
    check('4e 客机在房主 3 m 内，两人背包都是空的', Math.hypot(sa.x - sb.x, sa.z - sb.z) < 3 && sa.inv.every(x => !x) && sb.inv.every(x => !x), { dist: +Math.hypot(sa.x - sb.x, sa.z - sb.z).toFixed(2), A: sa.inv, B: sb.inv });
    const [ta, tb] = await Promise.all([A, B].map((p, i) => ev(p, t0 => __t.since(__t.trace, t0), t0s[i])));
    const tr = list => {
      const black = list.find(x => x.k === 'curtainBlack' && x.v === true);
      const start = list.find(x => x.k === 'startRun');
      const hidden = list.filter(x => x.k === 'curtainHidden').pop();
      const title = list.filter(x => x.k === 'titleShown').pop();
      const first = list.find(x => x.k === 'curtain' && x.text);
      return { text: first && first.text, black: black && Math.round(black.t), start: start && Math.round(start.t), hidden: hidden && Math.round(hidden.t), title: title && Math.round(title.t), titleText: title && title.text };
    };
    const xa = tr(ta), xb = tr(tb);
    check('4e 房主：黑幕全黑（curtain resolve）之后才 startRun', xa.black != null && xa.start != null && xa.start >= xa.black, xa);
    // 数到 0 的那一帧：营地和窗外带所有灯描述的强度都是 0（两边各自灭灯，记在落黑幕那一刻）
    const lit = list => { const c = list.find(x => x.k === 'curtain' && x.text && x.lv === CAMP); return c ? { n: c.lightsN, max: c.lightsMax, transit: c.transit, text: c.text } : null; };
    const la = lit(ta), lb = lit(tb);
    check('4e 数到 0：营地和窗外所有灯的强度都是 0（两边，至少 12 盏）', !!la && !!lb && la.max === 0 && lb.max === 0 && la.n >= 12 && lb.n >= 12, { A: la, B: lb });
    // 两边的 goAt 一样（客机用的就是房主发来的那个数），出发前两边联机时钟和墙钟的偏差相差 < 250 ms
    const [ga, gb] = await Promise.all([
      ev(A, t0 => __t.goAts.filter(g => g.t >= t0 && g.who === 'emit').map(g => g.goAt), t0s[0]), ev(B, t0 => __t.goAts.filter(g => g.t >= t0 && g.who === 'recv').map(g => g.goAt), t0s[1])]);
    check('4e 倒数同步：两边的 goAt 相同，出发前（营地里）时钟差 < 250 ms', ga.length > 0 && gb.length > 0 && ga[ga.length - 1] === gb[gb.length - 1] && clkDiff < 0.25,
      { A: ga, B: gb, clockDiffMs: Math.round(clkDiff * 1000), samplesMs: clkDiffs.map(x => Math.round(x * 1000)) });
    check('4e 两边的层级大标题都在黑幕撤掉之后才播', xa.title != null && xa.hidden != null && xa.title >= xa.hidden && xb.title != null && xb.hidden != null && xb.title >= xb.hidden, { A: xa, B: xb });
    info('黑幕文字', [xa.text, xb.text]);
    await shot(A, 'arrived-dev-A');
    // 出发的过场里关输入会退出指针锁定：亮起来以后电脑上要么指针还锁着，要么提示「点一下画面继续」（2026-10-05 返修 r2：原来什么都没有，鼠标转不了）
    await lockHintCheck('4e 出发到了 Level Dev');
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
  // 拾取同步：A 按空格、B 按 E（隐藏别名）。测试模式那一段（20）再用同样的办法查「拾取不复制」
  const pickTwo = async (tag) => {
    const [ia, ib, pa, ents] = await Promise.all([
      ev(A, () => BR.items.list.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z }))),
      ev(B, () => BR.items.list.map(p => p.id)),
      ev(A, () => ({ x: BR.player.x, z: BR.player.z })),
      ev(A, () => BR.entities.list.filter(e => !e.removed).map(e => ({ x: e.x, z: e.z }))),
    ]);
    const inB = new Set(ib);
    // 周围 2.5 m 没有别的物品、也没有实体（测试绿块、测试人会挡准心：2026-10-05 返修 r2 第 14 步偶发「B 按 E 没捡到」）
    const lonely = ia.filter(p => inB.has(p.id) && ia.every(q => q === p || Math.hypot(q.x - p.x, q.z - p.z) > 2.5) && ents.every(e => Math.hypot(e.x - p.x, e.z - p.z) > 2.5));
    lonely.sort((p, q) => Math.hypot(p.x - pa.x, p.z - pa.z) - Math.hypot(q.x - pa.x, q.z - pa.z));
    info(tag + ' 物品：A ' + ia.length + ' 件、B ' + ib.length + ' 件，两边都有且周围 2.5 m 无其他物品的 ' + lonely.length + ' 件');
    if (lonely.length < 2) { check(tag + ' 找到两件可拾取的物品', false, lonely.length); return; }
    const [it1, it2] = lonely;
    // 站到物品 1 m 处（互动距离内），准心对准它（交互 A1：只认准心对准的东西）。按键之前核对 BR.interact.current 真的是这件
    // （不是就再瞄几次），返回最后一次核对的结果；没对上时把 toast、输入开关、当前目标打进日志
    const aimIs = (page, it) => ev(page, id => { const c = BR.interact.current; return !!c && c.kind === 'item' && ((c.ref && c.ref.id === id) || c.key === id); }, it.id);
    const approach = async (page, it) => {
      for (let k = 0; k < 4; k++) {
        await ev(page, t => {
          const P = BR.player;
          P.x = t.x + 1.0; P.z = t.z; P.vx = 0; P.vz = 0;
          P.yaw = Math.atan2(-(t.x - P.x), -(t.z - P.z)); P.pitch = -0.6;
          const r = BR.items.find(t.id);
          if (r && BR.interact && BR.interact.aimAt) {
            const o = r.obj ? r.obj.position : r;
            BR.interact.aimAt(o.x, o.y + (r.hh || 0.1), o.z);
          }
        }, it);
        await sleep(300);
        if (await aimIs(page, it)) return true;
      }
      return false;
    };
    const aimDump = page => ev(page, () => { const c = BR.interact.current; return { cur: c ? { kind: c.kind, key: c.key, label: c.label } : null, input: BR.input.enabled, screen: BR.game.screen, toasts: __t.toasts.slice(-4) }; });
    const count = (page, type) => ev(page, t => BR.player.countOf(t), type);

    const before1 = { A: await count(A, it1.type), B: await count(B, it1.type) };
    const aim1 = await approach(A, it1);
    await sleep(100);
    await tapKey(A, 'Space');
    const goneA = await waitFor(A, id => !BR.items.find(id), it1.id, 3000);
    const goneB = await waitFor(B, id => !BR.items.find(id), it1.id, 4000);
    await sleep(300);
    const after1 = { A: await count(A, it1.type), B: await count(B, it1.type) };
    check(tag + ' A 按空格拾取 → A 背包 +1、B 上该物品消失、B 背包不变', aim1 && goneA && goneB && after1.A === before1.A + 1 && after1.B === before1.B, { it: it1.id + ':' + it1.type, aim1, goneA, goneB, before1, after1, ...(goneA ? {} : { dump: await aimDump(A) }) });

    const before2 = { A: await count(A, it2.type), B: await count(B, it2.type) };
    const aim2 = await approach(B, it2);
    const dump2 = await aimDump(B);
    await sleep(100);
    await tapKey(B, 'KeyE');
    const goneB2 = await waitFor(B, id => !BR.items.find(id), it2.id, 5000);
    const goneA2 = await waitFor(A, id => !BR.items.find(id), it2.id, 3000);
    await sleep(300);
    const after2 = { A: await count(A, it2.type), B: await count(B, it2.type) };
    check(tag + ' B 按 E 拾取 → A 上消失，且只进 B 的背包（不复制）', aim2 && goneA2 && goneB2 && after2.B === before2.B + 1 && after2.A === before2.A, { it: it2.id + ':' + it2.type, aim2, goneA2, goneB2, before2, after2, ...(goneB2 ? {} : { beforePress: dump2, after: await aimDump(B) }) });

    // 两人同时捡同一件（2026-10-05 返修：没捡到的一方以前一点提示都没有）：A 按着空格（准心锁在它上面、还没到拖动），
    // 这时 B 的拾取请求先到了房主那边 → 东西归 B，A 手里那一下落空，toast「「客机B」先拿到了」
    const it3 = lonely[2];
    if (!it3) { info(tag + ' 只有两件孤立物品，跳过「同时捡同一件」'); return; }
    const before3 = { A: await count(A, it3.type), B: await count(B, it3.type) };
    const n3 = await ev(A, () => __t.toasts.length);
    await approach(A, it3);
    await sleep(100);
    await A.keyboard.down('Space');
    const pressed = await waitFor(A, () => BR.interact.state === 'pressed', null, 1500);
    await ev(B, t => { BR.bus.emit('item:pickRequest', { id: t.id, type: t.type }); }, it3);
    const goneA3 = await waitFor(A, id => !BR.items.find(id), it3.id, 3000);
    await sleep(250);
    await A.keyboard.up('Space');
    const goneB3 = await waitFor(B, id => !BR.items.find(id), it3.id, 3000);
    await sleep(300);
    const after3 = { A: await count(A, it3.type), B: await count(B, it3.type) };
    const t3 = await ev(A, n => __t.toasts.slice(n), n3);
    if (!pressed) info(tag + ' 同时捡：A 的空格没进 pressed（机器忙），这一项只看不复制', { t3 });
    check(tag + ' 两人同时捡同一件：东西只进 B 的背包，A 那边落空并提示「「客机B」先拿到了」', goneA3 && goneB3 && after3.B === before3.B + 1 && after3.A === before3.A &&
      (!pressed || t3.some(t => /「客机B」先拿到了/.test(t))), { it: it3.id, pressed, before3, after3, toasts: t3 });

    // 慢了半拍（2026-10-05 返修 r2）：B 准心对着它，A 先拿走了；东西在 B 屏幕上消失后 0.15 s B 才按到（准心上已经没有它了）
    // → B 也要提示「「房主A」先拿到了」（interact 记着 1 s 内对准过的那件）
    const it4 = lonely[3];
    if (!it4) { info(tag + ' 只有三件孤立物品，跳过「慢了半拍」'); return; }
    const n4 = await ev(B, () => __t.toasts.length);
    const aimB = await approach(B, it4);
    await approach(A, it4);
    const pB = ev(B, id => new Promise(res => {
      const t0 = performance.now();
      const tick = () => {
        if (!BR.items.find(id)) {
          const tg = performance.now();
          // 合成按键（input.js 在 window 捕获阶段听 keydown / keyup）：消失后 80 ms 按下、再 60 ms 松开
          setTimeout(() => {
            const o = { code: 'KeyE', key: 'e', bubbles: true, cancelable: true };
            const cur = BR.interact.current ? BR.interact.current.kind : null;
            window.dispatchEvent(new KeyboardEvent('keydown', o));
            setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keyup', o)); res({ goneAfterMs: Math.round(tg - t0), pressAfterGoneMs: Math.round(performance.now() - tg), curAtPress: cur }); }, 60);
          }, 80);
          return;
        }
        if (performance.now() - t0 > 8000) { res(null); return; }
        requestAnimationFrame(tick);
      };
      tick();
    }), it4.id);
    await tapKey(A, 'Space');
    const r4 = await pB;
    await sleep(600);
    const t4 = await ev(B, n => __t.toasts.slice(n), n4);
    check(tag + ' 慢了半拍：东西在 B 屏幕上已经没了 0.1 s B 才按到，B 也提示「「房主A」先拿到了」', aimB && !!r4 && t4.some(t => /「房主A」先拿到了/.test(t)), { it: it4.id, aimB, r4, toasts: t4 });
  };
  await step('7 拾取同步', async () => { await pickTwo('7'); });

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
    // 2026-10-05 返修：走出口换层两人按同一个种子落在同一个到达点、叠在一起；客机进层后站到房主身边的空地上
    await sleep(800);
    const pz = await Promise.all([A, B].map(p => ev(p, () => ({ x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), peer: __t.peerSuit() }))));
    const dd = Math.hypot(pz[0].x - pz[1].x, pz[0].z - pz[1].z);
    check('8d 换层后两人不叠在一起（相距 0.6–2 m），房主看得见客机的人形', dd >= 0.6 && dd <= 2 && !!pz[0].peer && pz[0].peer.visible, { A: [pz[0].x, pz[0].z], B: [pz[1].x, pz[1].z], d: +dd.toFixed(2) });

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
    // 设置里的「联机语音音量」（BR.coop.setVoiceVolume）：桌面 Chrome 直接设对方语音 <audio>.volume；
    // iOS（BR.net.volumeWorks 为 false）改走 GainNode、<audio> 静音但照播，100% 时拆掉 GainNode、取消静音
    const vol = await ev(A, () => {
      const a = __t.audios.find(x => x.srcObject) || null;
      if (!a) return { err: '没找到对方语音的 <audio>' };
      const out = {};
      out.ret = BR.coop.setVoiceVolume(0.3);
      out.desk = { volume: +a.volume.toFixed(3), muted: a.muted, remoteVolume: BR.net.remoteVolume, works: BR.net.volumeWorks };
      const d0 = Object.getOwnPropertyDescriptor(BR.net, 'volumeWorks');
      try {
        Object.defineProperty(BR.net, 'volumeWorks', { get: () => false, configurable: true, enumerable: true });
        BR.coop.setVoiceVolume(0.5);
        out.ios = { muted: a.muted, volume: +a.volume.toFixed(3), playing: !a.paused, voiceVolume: BR.coop.voiceVolume };
        BR.coop.setVoiceVolume(1);
        out.ios100 = { muted: a.muted, volume: +a.volume.toFixed(3) };
      } finally {
        if (d0) Object.defineProperty(BR.net, 'volumeWorks', d0);
      }
      BR.coop.setVoiceVolume(1);
      out.back = { volume: a.volume, muted: a.muted };
      return out;
    });
    check('9 联机语音音量：setVoiceVolume(0.3) 真的设到对方语音 <audio>.volume（不静音），BR.net.remoteVolume 记住 0.3',
      !vol.err && Math.abs(vol.ret - 0.3) < 1e-6 && Math.abs(vol.desk.volume - 0.3) < 0.01 && vol.desk.muted === false && Math.abs(vol.desk.remoteVolume - 0.3) < 1e-6, vol);
    check('9 iOS 那条路（volumeWorks=false）：调到 50% 时 <audio> 静音、照播（声音改走 GainNode）；回到 100% 取消静音',
      !vol.err && vol.ios.muted === true && vol.ios.playing && vol.ios100.muted === false && vol.back.volume === 1 && vol.back.muted === false, vol);
    await B.keyboard.press('KeyV');
    const off = await waitFor(B, () => BR.coop.mic === false, null, 5000);
    const btn2 = await ev(B, () => { const b = document.querySelector('.coop-mic'); return { on: b.classList.contains('coop-on'), txt: b.textContent }; });
    check('9 再按 V 关麦，按钮回到已闭麦', off && !btn2.on && /已闭麦/.test(btn2.txt), btn2);
    await sleep(2000);
    const [lb2, pa2] = await Promise.all([ev(B, () => __t.sample(1500, ['localSpeaking'])), ev(A, () => __t.sample(1500, ['peerSpeaking']))]);
    check('9 关麦后电平回落到接近 0（< 0.02）', lb2.localSpeaking.max < 0.02 && pa2.peerSpeaking.max < 0.02, { B: lb2.localSpeaking, A: pa2.peerSpeaking });
  });

  // ------------------------------------------------------------------
  await step('11 断网 10 s 自动重连：层级、背包、位置不变', async () => {
    const spares = await Promise.all([A, B].map(p => waitFor(p, () => !!BR.coop.debugInfo().spare, null, 15000)));
    info('备用房号（掉线重连用）两边都有', spares);
    const before = await Promise.all([A, B].map(p => snapRun(p)));
    const t0s = await Promise.all([A, B].map(p => ev(p, () => performance.now())));
    // B 断网：信令请求失败（CDP 离线 + 拦截），P2P 这条路也断（DevTools 离线管不到 WebRTC：让 B 的连接报 failed）
    await ctxB.setOffline(true);
    netDown.add('B');
    const tCut = Date.now();
    const cut = await ev(B, () => __t.cutPeer());
    const rcBoth = await Promise.all([A, B].map(p => waitFor(p, () => BR.coop.phase === 'reconnecting', null, 15000)));
    const notes = await Promise.all([A, B].map(p => ev(p, () => __t.noticeTexts())));
    check('11 断网后两边都进 reconnecting，顶上「连接断了，正在重连…（最多 90 秒）」带「不等了」', rcBoth.every(Boolean) &&
      notes.every(n => n.some(t => /连接断了，正在重连…（最多 90 秒）/.test(t) && /不等了/.test(t))), { cut, rcBoth, notes });
    await shot(A, 'reconnecting-A');
    const left = 10000 - (Date.now() - tCut);
    if (left > 0) await sleep(left);
    await ctxB.setOffline(false);
    netDown.delete('B');
    const t1 = Date.now();
    const back = await waitActive([A, B], 60000);
    await sleep(2000);
    const after = await Promise.all([A, B].map(p => snapRun(p)));
    const bus = await Promise.all([A, B].map((p, i) => ev(p, t0 => __t.since(__t.bus, t0).map(b => b.n), t0s[i])));
    check('11 恢复网络后自动连回来（coop:reconnected），没有 peerGone', back && bus.every(b => b.includes('coop:reconnected') && !b.includes('coop:peerGone')), { ms: Date.now() - t1, bus });
    check('11 重连后两边层级、种子不变', after.every((a, i) => a.lv === before[i].lv && a.seed === before[i].seed && a.levelSeed === before[i].levelSeed), { before, after });
    check('11 背包不变（客机 7 步捡的东西还在）', after.every((a, i) => JSON.stringify(a.inv) === JSON.stringify(before[i].inv)) && before[1].inv.some(Boolean), { before: before.map(b => b.inv), after: after.map(a => a.inv) });
    check('11 两人原地不动（位置误差 < 0.5 m，客机不被传送）', after.every((a, i) => Math.hypot(a.x - before[i].x, a.z - before[i].z) < 0.5), { before: before.map(b => [b.x, b.z]), after: after.map(a => [a.x, a.z]) });
    const notesAfter = await Promise.all([A, B].map(p => ev(p, () => __t.noticeTexts())));
    check('11 连回来后重连横幅收起', notesAfter.every(n => !n.some(t => /正在重连/.test(t))), notesAfter);
  });

  // ------------------------------------------------------------------
  await step('12 回营地要同意：不要 / 有输入不理 / 挂机自动', async () => {
    // 15 s 太久，测试里缩到 10 s（2026-10-05 返修 r2：缩到 5 s 时机器一忙，截完图横幅已经到时间自动同意了，点「不要」超时）
    await Promise.all([A, B].map(p => ev(p, () => { BR.config.coop.askSec = 10; })));
    // 背包里有东西的一方，横幅上提前说「背包带不回营地」（客机 7 步捡的东西还在）
    const bags = await Promise.all([A, B].map(p => ev(p, () => BR.player.inventory.filter(x => x && x.count > 0).length)));
    // 12a 不要
    let t0 = await ev(A, () => performance.now());
    const asked = await ev(A, () => BR.coopCamp.back());
    const shown = await waitFor(B, () => __t.noticeTexts().some(t => /房主A」想回营地/.test(t) && /同意/.test(t) && /不要/.test(t)), null, 5000);
    const aWait = await ev(A, () => __t.noticeTexts());
    const bAsk = await ev(B, () => __t.noticeTexts());
    await noticeBtn(B, '不要');
    await shot(B, 'camp-ask-B');
    const no = await waitFor(A, t0 => __t.toasts.some(t => /客机B」还想接着玩/.test(t)), t0, 5000);
    await sleep(1000);
    let lv = await Promise.all([A, B].map(p => ev(p, () => BR.game.levelId)));
    check('12a A 点回营地 → B 横幅「「房主A」想回营地」同意 / 不要，A 看到「等「客机B」同意…」', asked && shown && aWait.some(t => /等「客机B」同意/.test(t)), { aWait });
    check('12a B 点「不要」→ A 提示「「客机B」还想接着玩」，两人都留在 Level Dev', no && lv.every(l => l === 'dev'), lv);
    const bagMine = /等「客机B」同意…（背包里的东西带不回营地）/, bagYours = /房主A」想回营地（你背包里的东西带不回去）/;
    check('12a 背包提醒：背包里有东西的一方横幅上多一句（提出的一方「背包里的东西带不回营地」、回答的一方「你背包里的东西带不回去」），空背包不说',
      bags[1] > 0 && aWait.some(t => /等「客机B」同意/.test(t)) && (bags[0] > 0) === aWait.some(t => bagMine.test(t)) && bAsk.some(t => bagYours.test(t)), { bags, aWait, bAsk });
    // 12b B 一直在玩（有输入）但不回答：到时按「不要」
    await sleep(500);
    t0 = await ev(A, () => performance.now());
    await ev(A, () => BR.coopCamp.back());
    await waitFor(B, () => __t.noticeTexts().some(t => /想回营地/.test(t)), null, 5000);
    for (let i = 0; i < 6; i++) { await B.keyboard.down('KeyA'); await sleep(250); await B.keyboard.up('KeyA'); await sleep(500); }
    const busy = await waitFor(A, () => __t.toasts.filter(t => /客机B」还想接着玩/.test(t)).length >= 2, null, 25000);
    await sleep(800);
    lv = await Promise.all([A, B].map(p => ev(p, () => BR.game.levelId)));
    check('12b B 这段时间有输入却没回应 → 当「不要」，A 提示「还想接着玩」，不回营地', busy && lv.every(l => l === 'dev'), lv);
    // 12c B 挂机（完全没有输入）：到时自动同意，两人一起回营地
    await sleep(500);
    const t0c = await Promise.all([A, B].map(p => ev(p, () => __t.toasts.length)));
    await ev(A, () => BR.coopCamp.back());
    await waitFor(B, () => __t.noticeTexts().some(t => /想回营地/.test(t)), null, 5000);
    const home = await waitArrived([A, B], CAMP, null, 45000);
    await sleep(1500);
    const tc = await Promise.all([A, B].map((p, i) => ev(p, n => __t.toasts.slice(n), t0c[i])));
    const [sa, sb] = await Promise.all([A, B].map(p => ev(p, k => ({ lv: BR.game.levelId, st: BR.coopCamp.state, x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), chair: k ? __t.prop(k) : null, inv: __t.inv() }), chairKey)));
    check('12c B 挂机 5 s 没碰键盘和屏幕 → 自动同意，两人一起回到营地', home && sa.lv === CAMP && sb.lv === CAMP, { A: sa.lv, B: sb.lv });
    check('12c 回营地后帐篷里还是上一局的选择（游玩 + Level Dev + 改过的生成量），准备已清空',
      !!sa.st && sa.st.mode === lastSel.mode && sa.st.lv === lastSel.lv && Math.abs(sa.st.spawn - lastSel.spawn) < 0.005 && !sa.st.rdy[0] && !sa.st.rdy[1] && !!sb.st && sb.st.lv === lastSel.lv,
      { want: lastSel, A: sa.st && { mode: sa.st.mode, lv: sa.st.lv, spawn: sa.st.spawn, rdy: sa.st.rdy }, B: sb.st && { lv: sb.st.lv } });
    check('12c 挪过的椅子还在上次的位置（两边都是）', !!chairTo && [sa, sb].every(s => s.chair && Math.hypot(s.chair.x - chairTo.x, s.chair.z - chairTo.z) < 0.02), { want: chairTo, A: sa.chair, B: sb.chair });
    check('12c 两人站在两个出生格上', [sa, sb].every(s => [[15, 21.2], [17, 21.2]].some(([x, z]) => Math.hypot(s.x - x, s.z - z) < 0.5)) && Math.hypot(sa.x - sb.x, sa.z - sb.z) > 1, { A: [sa.x, sa.z], B: [sb.x, sb.z] });
    // 回营地是新开一局（返修 r1 选的方案 b）：背包清空，背包里原来有东西的一方亮起来时 toast「背包清空了：捡的东西带不回营地」（不点层名）
    const cleared = '背包清空了：捡的东西带不回营地';
    check('12c 回营地后两人背包都是空的；原来有东西的一方提示「' + cleared + '」，空背包的不提示', sa.inv.every(x => !x) && sb.inv.every(x => !x) &&
      tc[1].includes(cleared) && (bags[0] > 0) === tc[0].includes(cleared), { bags, A: sa.inv, B: sb.inv, toastsA: tc[0], toastsB: tc[1] });
    await shot(A, 'back-in-camp-A');
    await lockHintCheck('12c 回到营地');
  });

  // ------------------------------------------------------------------
  await step('13 rejoin：客机刷新页面，3 分钟内「回去？」', async () => {
    const t0 = await ev(A, () => performance.now());
    const saved = await ev(B, () => { try { return JSON.parse(sessionStorage.getItem('br_coop_rejoin') || 'null'); } catch (e) { return null; } });
    check('13 客机 sessionStorage 里有 br_coop_rejoin {code, host, at}', !!saved && /^[A-Z2-9]{6}$/.test(saved.code || '') && saved.host === '房主A' && saved.at > 0, saved);
    await B.reload();
    await B.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
    await ev(B, () => BR.assets.init());
    await ev(B, installHelpers);
    await ev(B, registerDevB);
    const aRc = await waitFor(A, () => BR.coop.phase === 'reconnecting', null, 15000);
    const card = await waitFor(B, () => { const r = document.querySelector('.coop-rejoin'); return r && !r.hidden && /「房主A」的营地还开着，回去？/.test(r.textContent); }, null, 15000);
    check('13 客机刷新：房主原地等（reconnecting），客机主页出现「「房主A」的营地还开着，回去？」', aRc && card, await ev(B, () => (document.querySelector('.coop-rejoin') || {}).textContent));
    await shot(B, 'rejoin-card');
    if (card) await B.click('.coop-rejoin .coop-rejoin-yes');
    const back = await waitActive([A, B], 60000) && await waitCamp(B, 30000);
    await sleep(1500);
    const [sa, sb] = await Promise.all([A, B].map(p => snapRun(p)));
    check('13 点「回去」→ 连回原来的营地（同一个种子），房主 toast「「客机B」连回来了」', back && sb.lv === CAMP && sa.seed === sb.seed &&
      (await ev(A, t0 => __t.toasts.some(t => /客机B」连回来了/.test(t)), t0)), { A: sa, B: sb });
    await ev(B, () => BR.skin.set('blue'));
    await Promise.all([A, B].map(p => ev(p, () => { BR.config.coop.askSec = 10; })));
  });

  // ------------------------------------------------------------------
  await step('14 测试模式两人', async () => {
    await tentPick(A, { mode: 'test', lv: 'dev' });
    await waitFor(B, () => { const s = BR.coopCamp.state; return !!s && s.mode === 'test' && s.lv === 'dev'; }, null, 4000);
    const d = await departBoth([A, B], 'dev', 'test');
    check('14 帐篷里选「测试模式 + Level Dev」，两人一起出发到测试模式', d.ready && d.arrived, d);
    if (!d.arrived) return;
    // 客机放实体：交给房主放，两边都有，5 s 后还在
    const t0 = await ev(B, () => performance.now());
    const ids0 = await ev(A, () => __t.ents().map(e => e[0]));
    const r1 = await ev(B, () => BR.test.spawnEntity('_dev_friendly'));
    const appear = await waitFor(A, ids => __t.ents().some(e => e[1] === '_dev_friendly' && !ids.includes(e[0])), ids0, 5000);
    const newId = await ev(A, ids => { const e = __t.ents().find(q => q[1] === '_dev_friendly' && !ids.includes(q[0])); return e ? e[0] : null; }, ids0);
    const bSee = newId && await waitFor(B, id => !!BR.entities.get(id) && !BR.entities.get(id).removed, newId, 5000);
    await sleep(5000);
    const still = await Promise.all([A, B].map(p => ev(p, id => !!BR.entities.get(id) && !BR.entities.get(id).removed, newId)));
    const bt = await ev(B, t0 => __t.toasts.slice(-4), t0);
    check('14 客机放出的实体由房主生成，两边都有，5 s 后还在；客机 toast「已放出 …」', r1 === null && appear && bSee && still.every(Boolean) && bt.some(t => /已放出/.test(t)), { r1, newId, still, toasts: bt });
    // 客机召唤测试人：id 前缀带召唤者颜色，两边看到的颜色一样（蓝）
    await ev(B, () => BR.test.spawnDummy());
    const dumId = await waitFor(A, () => __t.ents().some(e => /^dummy~blue~g~/.test(e[0])), null, 5000) ? await ev(A, () => __t.ents().find(e => /^dummy~blue~g~/.test(e[0]))[0]) : null;
    await sleep(1500);
    const hexBlue = await ev(A, () => __t.expectedHex('blue'));
    const [da, db] = await Promise.all([A, B].map(p => ev(p, id => __t.entSuit(id), dumId)));
    check('14 测试人 id「dummy~blue~g~…」，房主和客机看到的制服颜色一致（客机的蓝色）', !!dumId && !!da && !!db && da.suit.length > 0 && da.suit.every(h => h === hexBlue) && db.suit.every(h => h === hexBlue), { dumId, A: da, B: db, want: hexBlue.toString(16) });
    // 两人撞色：测试人头顶挂召唤者名牌
    await ev(B, () => BR.skin.set('pink'));
    await sleep(1200);
    await ev(B, () => BR.test.spawnDummy());
    const pinkId = await waitFor(A, () => __t.ents().some(e => /^dummy~pink~g~/.test(e[0])), null, 5000) ? await ev(A, () => __t.ents().find(e => /^dummy~pink~g~/.test(e[0]))[0]) : null;
    await sleep(1500);
    const [na, nb] = await Promise.all([A, B].map(p => ev(p, id => __t.entSuit(id), pinkId)));
    check('14 两人撞色（都穿粉色）：客机的测试人头顶挂召唤者名牌（两边都有）', !!pinkId && !!na && !!nb && na.sprites > 0 && nb.sprites > 0, { pinkId, A: na, B: nb });
    await shot(A, 'test-dummy-tag-A');
    await ev(B, () => BR.skin.set('blue'));
    // 清除全部：客机申请，房主清，两边都说是谁清的
    const tc = await Promise.all([A, B].map(p => ev(p, () => performance.now())));
    await ev(B, () => BR.test.clearAll());
    const cleared = await waitFor(A, () => __t.ents().length === 0, null, 5000);
    await sleep(1500);
    const cnt = await Promise.all([A, B].map(p => ev(p, () => __t.ents().length)));
    const ct = await Promise.all([A, B].map((p, i) => ev(p, t0 => __t.toasts.slice(-4), tc[i])));
    check('14 客机「清除全部」：房主清掉，两边计数一致（0），都提示「「客机B」清除了全部实体」', cleared && cnt[0] === cnt[1] && ct.every(t => t.some(x => /客机B」清除了全部实体/.test(x))), { cnt, toasts: ct });
    // 放一个再看两边计数一致
    await ev(B, () => BR.test.spawnEntity('_dev_friendly'));
    await sleep(2500);
    const cnt2 = await Promise.all([A, B].map(p => ev(p, () => __t.ents().length)));
    check('14 场上数量两边读同一份（房主实体表 = 客机快照）', cnt2[0] === cnt2[1] && cnt2[0] >= 1, cnt2);
    // 拾取之前先清场：测试绿块走来走去会挡准心
    await ev(A, () => BR.test.clearAll());
    await waitFor(A, () => __t.ents().length === 0, null, 5000);
    await waitFor(B, () => __t.ents().length === 0, null, 5000);
    await pickTwo('14 测试模式');
  });

  // ------------------------------------------------------------------
  await step('15 回营地要同意：同意（客机倒下了，在结算页提出）', async () => {
    // 2026-10-05 返修：队友倒下，房主那边以前一点动静都没有；倒下的人提出回营地，横幅也和平时一样
    const n0 = await ev(A, () => __t.toasts.length);
    const died = await ev(B, () => { BR.player.damage({ hp: 999, cause: '测试' }); return BR.player.dead; });
    const told = await waitFor(A, n => __t.toasts.slice(n).some(t => /「客机B」倒下了/.test(t)), n0, 5000);
    check('15 客机倒下了：房主 toast「「客机B」倒下了」', died && told, await ev(A, n => __t.toasts.slice(n), n0));
    const deadScr = await waitFor(B, () => { const r = document.querySelector('.death-btn-camp'); return !!(r && r.getClientRects().length); }, null, 8000);
    const t0 = await ev(B, () => performance.now());
    await ev(B, () => BR.coopCamp.back());
    const shown = await waitFor(A, () => __t.noticeTexts().some(t => /客机B」倒下了，想回营地/.test(t)), null, 5000);
    check('15 倒下的客机在结算页点「回营地」：房主横幅「「客机B」倒下了，想回营地」', deadScr && shown, await ev(A, () => __t.noticeTexts()));
    await noticeBtn(A, '同意');
    const home = await waitArrived([A, B], CAMP, null, 40000);
    const tr = await ev(B, t0 => __t.since(__t.trace, t0).filter(x => x.k === 'curtain').map(x => x.text), t0);
    const bAlive = await ev(B, () => ({ dead: BR.player.dead, hp: BR.player.hp, screen: BR.game.screen }));
    check('15 B 提出回营地，A 点「同意」→ 两人黑幕「回营地」一起回到营地，B 活着、结算页收起', shown && home && tr.some(t => /回营地/.test(String(t))) && !bAlive.dead && bAlive.screen === 'playing', { shown, home, curtain: tr, bAlive });
  });

  // ------------------------------------------------------------------
  let ctxT = null, T = null;
  await step('16 营地里对方离开：卡片；再开营地，新朋友落点不压人', async () => {
    // B 从暂停菜单「离开联机」（点两次）
    await ev(B, () => BR.hud.pause(true));
    await sleep(400);
    const pb = await ev(B, () => Array.from(document.querySelectorAll('.hud-pause button')).filter(b => b.getClientRects().length).map(b => b.textContent.trim()));
    check('16 营地里暂停只有「继续」和「离开联机」（没有「回营地」）', pb.includes('继续') && pb.includes('离开联机') && !pb.includes('回营地'), pb);
    // 两下要在 2.5 s 窗口里：B.click 每次都要等按钮「稳定」（两帧位置不变），SwiftShader 一帧很慢时光等这个就超过窗口了，
    // 所以先量一次按钮位置，按坐标点两下鼠标（和真人一样，第二下不等动画）
    const lb = await B.locator('.hud-pause .hud-btn-leave').boundingBox();
    await B.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await sleep(300);
    const armed = await ev(B, () => document.querySelector('.hud-pause .hud-btn-leave').textContent);
    await B.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2);
    const bHome = await waitFor(B, () => BR.game.screen === 'home' && BR.coop.phase === 'idle', null, 10000);
    check('16 B「离开联机」要点两次（「再点一次：会断开联机，回到主页」），然后回主页', /再点一次：会断开联机，回到主页/.test(armed) && bHome, armed);
    const card = await waitFor(A, () => __t.noticeTexts().some(t => /客机B」离开了营地/.test(t) && /再开一个营地等朋友/.test(t) && /回主页/.test(t)), null, 15000);
    check('16 A 弹出「「客机B」离开了营地」：再开一个营地等朋友 / 回主页', card, await ev(A, () => __t.noticeTexts()));
    await shot(A, 'peer-left-camp-card');
    const seed0 = await ev(A, () => BR.game.seed >>> 0);
    await noticeBtn(A, '再开一个营地等朋友');
    const reopened = await waitFor(A, () => BR.coop.hosting && /^[A-Z2-9]{6}$/.test(BR.coop.code || ''), null, 15000);
    code = await ev(A, () => BR.coop.code);
    const st = await ev(A, () => ({ lv: BR.game.levelId, seed: BR.game.seed >>> 0, hud: __t.hudCode(), role: BR.coop.role }));
    check('16「再开一个营地等朋友」：原地重新开房（同一个世界），换了新房号，角标写房号', reopened && st.lv === CAMP && st.seed === seed0 && !!st.hud && st.hud.includes(code), st);
    // 房主站到第 1 格；新朋友（触屏 T）应落在第 0 格，不压人
    await ev(A, () => { BR.player.reset({ x: 17, y: 0, z: 21.2, yaw: 0 }, { full: false }); });
    ctxT = await newContext(browser, 'T', TOUCH_VIEW);
    T = await newPage(ctxT, 'T');
    await boot(T, base);
    await ev(T, () => BR.skin.set('blue'));
    const j = await joinCamp(T, code, { name: '触屏T', touch: true });
    await sleep(2000);
    const [pa, pt] = await Promise.all([A, T].map(p => ev(p, () => ({ x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), active: BR.coop.active, lv: BR.game.levelId }))));
    check('16 触屏 T 点「联机」输房号、点「加入」进了营地', j.joined && pt.lv === CAMP, { joined: j.joined, card: j.card });
    check('16 新朋友落在没被占的那一格（房主站第 1 格 → T 在第 0 格），不压人', Math.hypot(pt.x - 15, pt.z - 21.2) < 0.35 && Math.hypot(pa.x - pt.x, pa.z - pt.z) > 1.2, { A: pa, T: pt });
    // 触屏麦克风按钮：存在、≥ 44px、不和动作按钮重叠，点了开 / 关
    const lay = await ev(T, () => {
      const mic = document.querySelector('.coop-mic');
      const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const r = mic.getBoundingClientRect();
      const others = Array.from(document.querySelectorAll('button, [role="button"], .touch-btn'))
        .filter(e => e !== mic && !mic.contains(e) && !e.closest('.coop-lobby'))
        .filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; })
        .map(e => ({ cls: e.className, ...box(e) }));
      const hit = others.filter(o => !(o.r <= r.left || o.l >= r.right || o.b <= r.top || o.t >= r.bottom));
      return { touch: BR.input.isTouch, hudTouch: document.querySelector('.coop-hud').classList.contains('coop-touch'), mic: { hidden: mic.hidden, ...box(mic) }, hit, n: others.length };
    });
    check('16 触屏视口：麦克风按钮存在且 ≥ 44px、不与别的按钮重叠', lay.touch && lay.hudTouch && !lay.mic.hidden && lay.mic.w >= 44 && lay.mic.h >= 44 && lay.n > 0 && lay.hit.length === 0, lay);
    await shot(T, 'touch-guest-camp');
    await T.tap('.coop-mic');
    const tapOn = await waitFor(T, () => BR.coop.mic === true, null, 10000);
    await T.tap('.coop-mic');
    const tapOff = await waitFor(T, () => BR.coop.mic === false, null, 5000);
    check('16 触屏点麦克风按钮开麦 / 再点闭麦', tapOn && tapOff, { tapOn, tapOff });
  });

  // ------------------------------------------------------------------
  await step('17 第 10 步（营地）：对方关掉页面 → 原地等重连，超过 reconnectSec 才算离开', async () => {
    if (!T) return;
    await ev(A, () => { BR.config.coop.reconnectSec = 12; });
    await waitFor(A, () => !!BR.coop.debugInfo().spare, null, 15000);   // 有备用房号才会原地等重连
    const t0 = await ev(A, () => performance.now());
    const tClose = Date.now();
    await T.close();
    await ctxT.close().catch(() => {});
    T = null;
    // 机器忙时发现断线要更久（2026-10-05 返修 r2：15 s 内没进 reconnecting 误报过）；12 s 从进 reconnecting 起算
    const rc = await waitFor(A, () => BR.coop.phase === 'reconnecting', null, 30000);
    const tRc = Date.now();
    await sleep(6000);
    const mid = await ev(A, t0 => ({ phase: BR.coop.phase, gone: __t.since(__t.bus, t0).filter(b => b.n === 'coop:peerGone').length }), t0);
    const gone = await waitFor(A, t0 => __t.since(__t.bus, t0).some(b => b.n === 'coop:peerGone'), t0, 30000);
    const ms = Date.now() - tRc;
    const g = await ev(A, t0 => ({ ev: __t.since(__t.bus, t0).filter(b => b.n === 'coop:peerGone').map(b => b.p), notes: __t.noticeTexts(), lv: BR.game.levelId }), t0);
    check('17 T 关掉页面：A 先原地等重连（进 reconnecting 6 s 后还在等，没有 peerGone）', rc && mid.phase === 'reconnecting' && mid.gone === 0, { ...mid, detectMs: tRc - tClose });
    check('17 超过 reconnectSec（12 s，从进 reconnecting 算）才 coop:peerGone {where:camp}，弹「「触屏T」离开了营地」', gone && ms >= 11000 && g.ev.some(p => p.where === 'camp') && g.notes.some(t => /触屏T」离开了营地/.test(t)) && g.lv === CAMP, { ms, ...g });
    await ev(A, () => { BR.config.coop.reconnectSec = 90; });
  });

  // ------------------------------------------------------------------
  await step('18 第 10 步（关卡）：对方断开 → 你接着一个人玩', async () => {
    // A 再开营地，B 从主页加入，一起去 Level Dev
    await noticeBtn(A, '再开一个营地等朋友');
    const reopened = await waitFor(A, () => BR.coop.hosting && /^[A-Z2-9]{6}$/.test(BR.coop.code || ''), null, 15000);
    code = await ev(A, () => BR.coop.code);
    await ev(A, () => { BR.player.reset({ x: 15, y: 0, z: 21.2, yaw: 0 }, { full: false }); });
    const j = reopened ? await joinCamp(B, code, { name: '客机B' }) : { joined: false };
    check('18 A 原地再开营地，B 从主页「联机」加入', reopened && j.joined, { code, card: j.card });
    if (!j.joined) return;
    await tentPick(A, { mode: 'casual', lv: 'dev' });
    await sleep(600);
    const d = await departBoth([A, B], 'dev', 'casual');
    check('18 两人一起到 Level Dev', d.arrived, d);
    if (!d.arrived) return;
    await ev(A, () => { BR.config.coop.reconnectSec = 12; });
    await waitFor(A, () => !!BR.coop.debugInfo().spare, null, 15000);
    const t0 = await ev(A, () => performance.now());
    const tClose = Date.now();
    await B.close();
    await ctxB.close().catch(() => {});
    const gone = await waitFor(A, t0 => __t.since(__t.bus, t0).some(b => b.n === 'coop:peerGone'), t0, 40000);
    const ms = Date.now() - tClose;
    const t1 = await ev(A, () => ({ time: BR.game.time, pos: __t.ents().map(r => [r[0], r[2], r[3]]) }));
    await sleep(2500);
    const aSt = await ev(A, t0 => ({
      ev: __t.since(__t.bus, t0).filter(b => b.n === 'coop:peerGone').map(b => b.p), toasts: __t.toasts.slice(-4), active: BR.coop.active, phase: BR.coop.phase,
      coop: BR.game.coop, auth: BR.entities.authoritative, screen: BR.game.screen, lv: BR.game.levelId, time: BR.game.time, pos: __t.ents().map(r => [r[0], r[2], r[3]]),
    }), t0);
    const moved = aSt.pos.filter(p => { const q = t1.pos.find(o => o[0] === p[0]); return q && Math.hypot(q[1] - p[1], q[2] - p[2]) > 0.05; }).length;
    check('18 B 关掉页面：超过 reconnectSec 后 peerGone {where:level}，A 提示「「客机B」断开了，你接着一个人玩」', gone && ms >= 11000 && aSt.ev.some(p => p.where === 'level') && aSt.toasts.some(t => /客机B」断开了，你接着一个人玩/.test(t)), { ms, ev: aSt.ev, toasts: aSt.toasts });
    check('18 A 继续单机：playing、authoritative、世界和实体在跑、还在 Level Dev', aSt.screen === 'playing' && aSt.auth === true && !aSt.active && aSt.phase === 'idle' && aSt.lv === 'dev' && aSt.time > t1.time && (moved > 0 || aSt.pos.length === 0),
      { time: [t1.time, aSt.time], moved, ents: aSt.pos.length, coop: aSt.coop });
    const pm = await ev(A, () => { BR.hud.pause(true); const r = Array.from(document.querySelectorAll('.hud-pause button')).filter(b => b.getClientRects().length).map(b => b.textContent.trim()); BR.hud.pause(false); return r; });
    check('18 暂停菜单恢复成单人的样子（没有「回营地」「离开联机」）', !pm.includes('回营地') && !pm.includes('离开联机'), pm);
    await shot(A, 'A-alone-after-B-left');
    await ev(A, () => { BR.config.coop.reconnectSec = 90; });
  });

  // ------------------------------------------------------------------
  await step('19 营地开着时，主页单人开局会关掉营地', async () => {
    await ev(A, () => BR.bus.emit('game:home'));
    await sleep(1200);
    const c = await hostCamp(A, '房主A', { enter: false });
    check('19 预备：A 开了营地、停在房号页', !!c && rooms.get(c) && rooms.get(c).state === 'waiting', c);
    if (!c) return;
    const t0 = await ev(A, () => performance.now());
    // 照主页 startGame：coop 恒为 null
    await ev(A, () => { __br.start({ mode: 'casual', levelId: 'dev', seed: 4242 }); });
    const closed = await waitFor(A, () => BR.coop.phase === 'idle' && !BR.net.active && BR.game.levelId === 'dev', null, 15000);
    await sleep(1500);
    const st = await ev(A, t0 => ({ toasts: __t.toasts.slice(-4), coop: BR.game.coop, screen: BR.game.screen, hosting: BR.coop.hosting }), t0);
    check('19 主页单人开局：营地关掉（服务器上房间 closed），toast「已关闭营地」，进的是单人局', closed && rooms.get(c).state === 'closed' && st.toasts.some(t => /已关闭营地/.test(t)) && !st.hosting && (!st.coop || !st.coop.active), { state: rooms.get(c).state, ...st });
  });

  // ------------------------------------------------------------------
  // 2026-10-05 返修 r2：A 这页已经开了很久、一直在用联机时钟（当房主、进帐篷、倒数、售货机），再去加入一个刚打开的页面开的营地时，
  // 旧的 clkLast（本页时间）比新房主的时钟大好几分钟，clock() 只增不减就卡着不走，帐篷倒数一到客机这边立刻黑幕、也取消不了
  await step('20 客机页面比房主老：联机时钟从头估，帐篷倒数照样数 3、2、1', async () => {
    await ev(A, () => { if (BR.coop.phase !== 'idle') BR.coop.leave(); BR.bus.emit('game:home'); });
    await waitFor(A, () => BR.game.screen === 'home' && BR.home.shown && BR.coop.phase === 'idle', null, 15000);
    // 第 19 步是在联机面板开着（房号页）时直接开的单人局，回到主页面板还在（写着「已关闭营地」）：先关掉，下面照常从主页点「联机」
    await ev(A, () => { const l = document.querySelector('.coop-lobby'); if (l && l.getClientRects().length && typeof BR.coop.closeLobby === 'function') BR.coop.closeLobby(); return 0; });
    await waitFor(A, () => { const l = document.querySelector('.coop-lobby'); return !l || !l.getClientRects().length; }, null, 5000);
    const ctxC = await newContext(browser, 'C');
    const C = await newPage(ctxC, 'C');
    lockPages = [C, A];
    try {
      await boot(C, base);
      const ages = await Promise.all([A, C].map(p => ev(p, () => Math.round(performance.now() / 1000))));
      const aClk = await ev(A, () => +BR.coop.clock().toFixed(3));
      // 后开的页面先拿到前台（同一个浏览器里三个页面，后台页面的 rAF 不跑，点按钮时 Playwright 一直等它「稳定」）
      await C.bringToFront();
      await sleep(800);
      const c = await hostCamp(C, '新房主C').catch(async err => { await shot(C, 'C-host-fail'); throw err; });
      await A.bringToFront();
      const j = c ? await joinCamp(A, c, { name: '老页面A' }) : { joined: false };
      check('20 预备：刚打开的页面 C 开营地，老页面 A（早开 ' + (ages[0] - ages[1]) + ' s、用过联机时钟）加入', !!c && j.joined && ages[0] - ages[1] > 60 && aClk > ages[1], { ages, aClk, code: c, joined: j.joined });
      if (!j.joined) return;
      await sleep(1500);
      const both = () => Promise.all([ev(A, () => BR.coop.clock()), ev(C, () => BR.coop.clock())]);
      const m1 = await both();
      await sleep(3000);
      const m2 = await both();
      const adv = [m2[0] - m1[0], m2[1] - m1[1]];
      check('20 A 的联机时钟跟上 C（差 < 0.3 s），3 s 里两边走得一样多（差 < 0.3 s）', Math.abs(m1[0] - m1[1]) < 0.3 && Math.abs(adv[0] - adv[1]) < 0.3 && adv[0] > 2.5,
        { m1, m2, adv: adv.map(x => +x.toFixed(3)) });
      await tentPick(C, { mode: 'casual', lv: 'dev' });
      await sleep(800);
      // A 这边：从收到 goAt 到黑幕落下（transit 离开 idle）过了多久
      const pA = ev(A, () => new Promise(res => {
        const t0 = performance.now();
        let tg = 0;
        const tick = () => {
          const s = BR.coopCamp.state;
          if (!tg && s && s.goAt > 0) tg = performance.now();
          if (tg && BR.coopCamp.transit !== 'idle') { res({ countMs: Math.round(performance.now() - tg) }); return; }
          if (performance.now() - t0 > 25000) { res({ countMs: null, sawGoAt: !!tg }); return; }
          setTimeout(tick, 20);
        };
        tick();
      }));
      const rd = await readyBoth([C, A], { wait: false });
      const cd = await pA;
      check('20 两人准备后，A 这边倒数持续约 3 s（> 2 s）才黑幕（以前 0.1 s 就黑了）', rd && cd.countMs != null && cd.countMs > 2000 && cd.countMs < 6000, { rd, ...cd });
      const arrived = await waitArrived([C, A], 'dev', 'casual', 45000);
      const [sa, sc] = await Promise.all([A, C].map(p => snapRun(p)));
      check('20 两人一起出发到 Level Dev（同一个种子）', arrived && sa.seed === sc.seed, { A: sa, C: sc });
    } finally {
      await ev(A, () => { if (BR.coop.phase !== 'idle') BR.coop.leave(); return 0; }).catch(() => {});
      await ctxC.close().catch(() => {});
    }
  });

  await ctxA.close().catch(() => {});
}


// =====================================================================
// V 叉车联机（FE1，2026-10-06 叉车驾驶提前版）：游玩模式，假 room.php
// =====================================================================
// 页面里的叉车工具：window.__v
function installVeh() {
  const V = window.__v = { notes: [], sounds: [] };
  if (BR.hud && typeof BR.hud.driveNote === 'function') { const o = BR.hud.driveNote; BR.hud.driveNote = function (t) { if (t) V.notes.push(String(t)); return o.apply(this, arguments); }; }
  if (BR.hud && typeof BR.hud.toast === 'function') { const o = BR.hud.toast; BR.hud.toast = function (t) { if (t) V.notes.push(String(t)); return o.apply(this, arguments); }; }
  if (BR.audio && typeof BR.audio.play === 'function') { const o = BR.audio.play; BR.audio.play = function (n) { V.sounds.push(String(n)); return o.apply(this, arguments); }; }
  V.key = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    const f = ((c && c.res && c.res.data && c.res.data.forklifts) || []).find(q => q.x > 12 && q.x < 20 && q.z > 12 && q.z < 20);
    return f ? f.key : null;
  };
  V.pose = k => { const v = BR.vehicles.byKey(k); return v ? { x: v.pose.x, z: v.pose.z, yaw: v.pose.yaw, lift: v.pose.lift, spd: v.pose.spd, on: v.pose.on, seat: v.seat } : null; };
  V.W = (k, lx, lz) => { const p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  V.L = (k, x, z) => { const p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return { x: c * dx - s * dz, z: s * dx + c * dz }; };
  // 站到车本地 (lx, lz)，准心对准座椅高处（车身侧面）
  V.standL = (k, lx, lz) => {
    const w = V.W(k, lx, lz), s = V.W(k, 0, 0.24);
    const P = BR.player;
    P.x = w.x; P.z = w.z; P.vx = 0; P.vz = 0;
    P.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z)); P.pitch = 0;
    if (BR.interact && BR.interact.aimAt) BR.interact.aimAt(s.x, 1.25, s.z);
    return 0;
  };
  V.cur = () => { const c = BR.interact.current; return c ? { kind: c.kind, key: c.key, ok: c.short ? c.short.ok !== false : null, why: c.short ? c.short.why : null } : null; };
  V.seat = () => ({ seated: BR.vehicles.seated, mode: BR.interact.mode, ctx: BR.input.context, phase: BR.vehicles.debugInfo().phase, coop: BR.coop.phase });
  // 短按：同一个 evaluate 里先造好 keydown、keyup 两个事件（event.timeStamp 是造出来的时刻，两者只差零点几毫秒），再接连派发。
  // 不经两次 CDP 往返，也不用 setTimeout 隔开：SwiftShader 一帧要两三百毫秒，计时器会被拖到帧后面，间隔被拉长就判成了长按
  // （N1 minor ⑤）。按下和松开落在同一帧里没关系：input 记下按下 / 松开两个边沿，interact 按两个事件的时间戳算按了多久
  V.tap = code => new Promise(res => {
    const o = { code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true };
    const d = new KeyboardEvent('keydown', o), u = new KeyboardEvent('keyup', o);
    window.dispatchEvent(d);
    window.dispatchEvent(u);
    requestAnimationFrame(() => requestAnimationFrame(() => res(0)));
  });
  // 模拟时钟：每帧 BR.vehicles.update(dt) 累加（联机暂停时世界照跑，也照样累加）。SwiftShader 一帧两三百毫秒、dt 封顶 0.1 s，
  // 模拟时间比墙钟慢好几倍：「按住 1 s」「0.6 s 内停住」这些都按模拟时间量
  V.simT = 0;
  if (BR.vehicles && typeof BR.vehicles.update === 'function') { const ou = BR.vehicles.update; BR.vehicles.update = function (dt) { V.simT += +dt || 0; return ou.apply(this, arguments); }; }
  V.down = code => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); return 0; };
  V.up = code => { window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); return 0; };
  // 按住 sec 秒（模拟时间；墙钟最多等 60 s）
  V.hold = (code, sec) => new Promise(res => {
    V.down(code);
    const t0 = V.simT, w0 = performance.now();
    const tick = () => { if (V.simT - t0 >= sec || performance.now() - w0 > 60000) { V.up(code); res(+(V.simT - t0).toFixed(3)); return; } requestAnimationFrame(tick); };
    tick();
  });
  // 每帧看车速，等它停住（spd < 0.05），返回用了多少模拟秒；模拟时间超过 max 秒返回 null
  V.untilStop = (k, max) => new Promise(res => {
    const t0 = V.simT, w0 = performance.now();
    const tick = () => {
      const v = BR.vehicles.byKey(k);
      const sp = v ? Math.abs(v.pose.spd) : 0;
      if (sp < 0.05) { res(+(V.simT - t0).toFixed(3)); return; }
      if (V.simT - t0 > max || performance.now() - w0 > 60000) { res(null); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
  // 一直按着 code，等车速到 v 以上（模拟时间最多 max 秒）；不松键
  V.accelTo = (k, code, v, max) => new Promise(res => {
    V.down(code);
    const t0 = V.simT, w0 = performance.now();
    const tick = () => {
      const p = BR.vehicles.byKey(k);
      if (p && Math.abs(p.pose.spd) >= v) { res(Math.abs(p.pose.spd)); return; }
      if (V.simT - t0 > max || performance.now() - w0 > 60000) { res(p ? Math.abs(p.pose.spd) : null); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
  // 等落座、起动走完（phase 'run'）
  V.untilRun = () => new Promise(res => {
    const w0 = performance.now();
    const tick = () => { const ph = BR.vehicles.debugInfo().phase; if (ph === 'run' || performance.now() - w0 > 30000) { res(ph); return; } requestAnimationFrame(tick); };
    tick();
  });
  // ---- FE1 返修 r2：仪表台大灯开关、撞车甩货、客机消息晚到 ----
  // 灯池：world.setExtraLights 每个 owner 现在借了几盏（本机司机 'fk:'+车，远端车 'fkr:'+车）
  V.extra = {};
  if (BR.world && typeof BR.world.setExtraLights === 'function') { const o = BR.world.setExtraLights; BR.world.setExtraLights = function (owner, list) { V.extra[String(owner)] = list ? list.length : 0; return o.apply(this, arguments); }; }
  V.hl = k => { const v = BR.vehicles.byKey(k); return v ? (v.pose.hl === 0 ? 0 : 1) : null; };
  // 准心对准仪表台的大灯开关（坐在车上时）
  V.aimSwitch = k => { const s = BR.vehicles.lightSwitch(k); if (s) BR.interact.aimAt(s.x, s.y, s.z); return s ? { x: s.x, y: s.y, z: s.z, hl: s.hl } : null; };
  V.cand = () => { const c = BR.interact.current; return c ? { kind: c.kind, key: c.key, verb: c.short ? c.short.verb : null } : null; };
  V.lookAway = () => { BR.player.pitch = 0; return 0; };
  // 客机出站消息先攒着（连接不断，像网络卡了一下）：V.holdOut(true) 开始攒，V.holdOut(false) 之后第一条消息发出前按顺序补发
  V.outQ = []; V.outHeld = false; V.outN = 0;
  if (!window.__vSendWrapped && typeof RTCDataChannel !== 'undefined') {
    window.__vSendWrapped = true;
    const os = RTCDataChannel.prototype.send;
    const flush = () => { const q = V.outQ; V.outQ = []; for (const [ch, m] of q) { try { os.call(ch, m); } catch (e) { /* 通道已关 */ } } };
    RTCDataChannel.prototype.send = function (m) {
      if (V.outHeld) { V.outQ.push([this, m]); V.outN++; return; }
      if (V.outQ.length) flush();
      return os.call(this, m);
    };
    V.flushOut = flush;
  }
  V.holdOut = on => { V.outHeld = !!on; if (!on && V.flushOut) V.flushOut(); return V.outN; };
  // 车的 14 个盒子在某个位姿（世界坐标）和静态碰撞体 / sideObs 外接框重不重叠（这台车自己不算）
  V.blockedAt = (k, x, z, yaw, lift) => {
    const G = BR.L1forklift.geo, pk = (BR.vehicles.list().find(v => v.key === k) || {}).physKey;
    const boxes = BR.phys.toWorldOBBs(G.obbs(lift || 0), x, z, yaw, BR.phys.groundY(x, z));
    for (const o of boxes) if (BR.phys.overlapOBB(o, { tol: 0.005, ignoreKey: pk })) return true;
    for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.sideObs) || [])) {
      if (e.minY > 2.2) continue;
      for (const o of boxes) {
        const r = Math.abs(o.hx * Math.cos(o.rot)) + Math.abs(o.hz * Math.sin(o.rot)), q = Math.abs(o.hx * Math.sin(o.rot)) + Math.abs(o.hz * Math.cos(o.rot));
        if (o.cx + r > e.minX && o.cx - r < e.maxX && o.cz + q > e.minZ && o.cz - q < e.maxZ && o.maxY > e.minY && o.minY < e.maxY) return true;
      }
    }
    return false;
  };
  // 一条全速撞出生块柱子的直道：叉尖离柱面 run 米、正对着它，路上空着（每 10 cm 查一次），再往前 0.15 m 就撞上
  V.pillarLane = k => {
    const G = BR.L1forklift.geo, tip = Math.min(G.forkZ[0], G.forkZ[1]);
    const ck = '0,0';
    const pillars = BR.phys.records(ck).solids.filter(b => b.key === ck && Math.abs((b.maxX - b.minX) - (b.maxZ - b.minZ)) < 0.05 && b.maxX - b.minX > 0.6 && b.maxX - b.minX < 1.0 && b.maxY - b.minY > 3.4);
    for (const run of [4, 3.5, 3]) for (const b of pillars) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, half = (b.maxX - b.minX) / 2;
      // 柱脚（地上 22 cm、往外凸 8 cm）先碰到叉尖
      const face = half + 0.08, d0 = face + run - tip;
      const x = cx - f.x * d0, z = cz - f.z * d0;
      let ok = true;
      for (let d = 0; d <= run - 0.05 && ok; d += 0.1) if (V.blockedAt(k, x + f.x * d, z + f.z * d, yaw, 0)) ok = false;
      if (!ok || !V.blockedAt(k, x + f.x * (run + 0.15), z + f.z * (run + 0.15), yaw, 0)) continue;
      return { x, z, yaw, run };
    }
    return null;
  };
  return 0;
}

async function runVeh(browser, base) {
  console.log('\n===== V 叉车联机 =====');
  const ctxA = await newContext(browser, 'VA');
  const ctxB = await newContext(browser, 'VB');
  const A = await newPage(ctxA, 'VA');
  const B = await newPage(ctxB, 'VB');
  let K = null, driver = null, watcher = null, D = null, Wp = null;
  try {
    await Promise.all([boot(A, base), boot(B, base)]);
    lockPages = [A, B];
    await ev(A, () => BR.skin.set('pink'));
    await ev(B, () => BR.skin.set('blue'));
    await Promise.all([A, B].map(p => ev(p, installVeh)));
    let arrived = false;
    await step('V0 联机进 L1：主页「联机」→ 营地 → 帐篷选「游玩 + Level 1」→ 一起出发', async () => {
      const code = await hostCamp(A, '房主A');
      const j = code ? await joinCamp(B, code, { name: '客机B' }) : { joined: false };
      if (!j.joined) { check('V0 两人进了营地', false, { code, j }); return; }
      await tentPick(A, { mode: 'casual', lv: '1' });
      await waitFor(B, () => { const s = BR.coopCamp.state; return !!s && s.mode === 'casual' && String(s.lv) === '1'; }, null, 6000);
      const d = await departBoth([A, B], '1', 'casual');
      const caps = await ev(B, () => BR.coop.debugInfo().peerCaps);
      check('V0 两人一起出发进了 L1（游玩），对方 caps 里有 veh2', d.ready && d.arrived && Array.isArray(caps) && caps.includes('veh2'), { d, caps });
      arrived = d.arrived;
    });
    if (!arrived) return;
    await step('V1 房主把出生柱间的叉车摆到南主通道（levelState 回放），两边都看到它在那里', async () => {
      K = await ev(A, () => __v.key());
      const ok = await ev(A, k => { const r = BR.levelState.set('1', 'veh', k, { x: -1, z: 32.6, yaw: -Math.PI / 2, steer: 0, lift: 0, on: 0, carry: null, n: (BR.vehicles.byKey(k) || {}).n || 0 }); return r !== false; }, K);
      await sleep(1500);
      const [pa, pb] = await Promise.all([A, B].map(p => ev(p, k => __v.pose(k), K)));
      check('V1 两边的车都在 (−1, 32.6)', !!K && ok && !!pa && !!pb && Math.hypot(pa.x + 1, pa.z - 32.6) < 0.01 && Math.hypot(pb.x + 1, pb.z - 32.6) < 0.01, { K, pa, pb });
    });
    if (!K) return;
    await step('V2 两人同一帧对同一台车按空格：恰好一人坐上去，另一人提示「队友在开叉车」', async () => {
      await ev(A, k => __v.standL(k, -1.2, 0.24), K);
      await ev(B, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(1200);
      await Promise.all([A, B].map(p => ev(p, k => __v.standL(k, BR.coop.role === 'host' ? -1.2 : 1.2, 0.24), K)));
      await sleep(400);
      const aim = await Promise.all([A, B].map(p => ev(p, () => __v.cur())));
      const n0 = await Promise.all([A, B].map(p => ev(p, () => __v.notes.length)));
      await Promise.all([A, B].map(p => ev(p, () => __v.tap('Space'))));
      await sleep(3000);
      const st = await Promise.all([A, B].map((p, i) => ev(p, n => Object.assign(__v.seat(), { notes: __v.notes.slice(n), toasts: __t.toasts.slice(-4) }), n0[i])));
      const winners = st.filter(x => x.seated === K && x.mode === 'drive');
      const loser = st.find(x => x.seated !== K);
      check('V2 两人同时按空格：恰好一人 mode drive，另一人提示「队友在开叉车」', winners.length === 1 && !!loser && (loser.notes.concat(loser.toasts)).some(t => /队友在开叉车/.test(t)), { aim, st });
      // 后面让客机当司机（客机开车时，房主那边才有「看得见车在开」「levelState 来自客机」这些事）
      if (st[0].seated === K) {
        await ev(A, () => __v.untilRun());
        await ev(A, () => __v.tap('Space'));
        await waitFor(A, () => !BR.vehicles.seated, null, 15000);
        await sleep(1500);
        await ev(B, k => __v.standL(k, 1.2, 0.24), K);
        await sleep(600);
        await ev(B, () => __v.tap('Space'));
      }
      await ev(B, () => __v.untilRun());
      const sb = await ev(B, () => __v.seat());
      check('V2b 客机坐上驾驶座（后面都由客机开）', sb.seated === K && sb.mode === 'drive' && sb.phase === 'run', sb);
      driver = B; watcher = A; D = 'B'; Wp = 'A';
    });
    if (!driver) return;
    await step('V3 司机按住 W 1 s：对方看到车移动 >1 m；停车 0.5 s 后两边位姿差 <5 cm', async () => {
      const p0 = await ev(watcher, k => __v.pose(k), K);
      await ev(driver, () => __v.hold('KeyW', 1.0));
      await sleep(300);
      const p1 = await ev(watcher, k => __v.pose(k), K);
      const stopMs = await ev(driver, k => __v.untilStop(k, 4), K);
      await sleep(500 + 200);   // 停住 0.5 s（加上 100 ms 插值缓冲）
      const [pd, pw] = await Promise.all([ev(driver, k => __v.pose(k), K), ev(watcher, k => __v.pose(k), K)]);
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z), diff = Math.hypot(pd.x - pw.x, pd.z - pw.z);
      check('V3 对方看到车移动 ' + moved.toFixed(2) + ' m（>1 m）', moved > 1, { p0, p1 });
      check('V3 停车 0.5 s 后两边位姿差 ' + (diff * 100).toFixed(1) + ' cm（<5 cm）', stopMs != null && diff < 0.05 && Math.abs(pd.yaw - pw.yaw) < 0.02, { pd, pw, stopMs });
    });
    await step('V4 对方看到坐姿人形：在座椅 10 cm 以内、穿司机自己的制服色；名牌两个方向透明度都是 0.95', async () => {
      const want = await ev(watcher, () => __t.expectedHex('blue'));
      const rows = [];
      for (const lx of [-4, 4]) {
        await ev(watcher, a => __v.standL(a.k, a.lx, 0.24), { k: K, lx });
        await sleep(1200);
        rows.push(await ev(watcher, k => {
          const av = BR.coop.debugInfo().avatar, s = BR.vehicles.seatWorld(k);
          return { av, seat: s, d: av && av.seat && s ? Math.hypot(av.seat[0] - s.x, av.seat[1] - s.y, av.seat[2] - s.z) : null };
        }, K));
      }
      const ok = rows.every(r => r.av && r.av.mode === 'drive' && r.av.key === K && r.av.visible && r.av.seatModel && r.d != null && r.d < 0.1);
      check('V4 对方看到的人形是坐姿，钉在座椅 10 cm 以内（两侧都看）', ok, rows);
      check('V4 坐着的人穿的是司机自己的制服色（蓝）', rows.every(r => r.av && r.av.skin === 'blue' && r.av.suitHex === want), { want, got: rows.map(r => r.av && [r.av.skin, r.av.suitHex]) });
      check('V4 名牌在护顶上方，从车两侧看透明度都是 0.95', rows.every(r => r.av && r.av.tag && r.av.tag.opacity === 0.95 && r.av.tag.y > r.seat.y + 1.0), rows.map(r => r.av && r.av.tag));
      // 反过来：司机看站在车旁的对方，名牌也是 0.95
      const tagD = await ev(driver, () => { const a = BR.coop.debugInfo().avatar; return a && a.tag; });
      check('V4 司机看车旁的对方：名牌透明度 0.95', !!tagD && tagD.opacity === 0.95, tagD);
      await shot(watcher, 'veh-watcher-sees-driver');
    });
    await step('V5 对方站在举起的货叉下面：司机按 C 降不下来（「货叉下面有人」）', async () => {
      // 司机先把货叉升到底面 ≈2 m（升 4.4 s）
      await ev(driver, () => __v.hold('KeyR', 4.4));
      await sleep(300);
      const lift0 = await ev(driver, k => __v.pose(k).lift, K);
      await ev(watcher, k => { const w = __v.W(k, 0, -1.63); const P = BR.player; P.x = w.x; P.z = w.z; P.vx = 0; P.vz = 0; return 0; }, K);
      await sleep(1200);
      const n0 = await ev(driver, () => __v.notes.length);
      await ev(driver, () => __v.hold('KeyC', 2.5));
      await sleep(300);
      const r = await ev(driver, a => { const v = BR.vehicles.byKey(a.k); const G = BR.L1forklift.geo; return { lift: v.pose.lift, forkBottom: v.pose.y + (G.forkY || 0.015) + 2.6 * v.pose.lift, notes: __v.notes.slice(a.n) }; }, { k: K, n: n0 });
      check('V5 对方站在货叉下面，司机按 C：货叉停在他头顶以上（底 ' + r.forkBottom.toFixed(2) + ' m），提示「货叉下面有人」', lift0 > 0.6 && r.forkBottom >= 1.8 - 0.01 && r.notes.includes('货叉下面有人'), { lift0, r });
      await ev(watcher, k => { const w = __v.W(k, -3, 0.24); const P = BR.player; P.x = w.x; P.z = w.z; return 0; }, K);
      await sleep(800);
      await ev(driver, () => __v.hold('KeyC', 4.5));
      await sleep(300);
    });
    await step('V6 联机暂停 / 结算 / 切后台：3 m/s 的车 0.6 s 内停住，货叉不动，雷达照常', async () => {
      const cases = [
        ['暂停', () => ev(driver, () => { BR.hud.pause(true); return 0; }), () => ev(driver, () => { BR.hud.pause(false); return 0; })],
        ['切后台', () => ev(driver, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); return 0; }),
          () => ev(driver, () => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); if (BR.hud.paused) BR.hud.pause(false); return 0; })],
      ];
      for (const [name, on, off] of cases) {
        // 每次先倒回起点附近再开（往东开）
        await ev(driver, () => __v.hold('KeyS', 1.5));
        await ev(driver, k => __v.untilStop(k, 3), K);
        const v = await ev(driver, k => __v.accelTo(k, 'KeyW', 3.0, 4), K);
        const lift0 = await ev(driver, k => __v.pose(k).lift, K);
        await on();
        const sec = await ev(driver, k => __v.untilStop(k, 2), K);
        await ev(driver, () => __v.up('KeyW'));
        const r = await ev(driver, k => ({ lift: __v.pose(k).lift, seated: BR.vehicles.seated, screen: BR.game.screen }), K);
        check('V6 联机' + name + '：' + (v || 0).toFixed(2) + ' m/s 的车 ' + sec + ' s 内停住（≤0.6 s，模拟时间），货叉不动，人还在车上', v >= 3 && sec != null && sec <= 0.6 + 0.1 + 1e-6 && Math.abs(r.lift - lift0) < 1e-6 && r.seated === K, { v, sec, lift0, r });
        if (name === '暂停') {
          // 输入关着时房主在车前 1.4 m 放一个测试人：司机那边雷达照常响
          const n0 = await ev(driver, () => __v.sounds.length);
          const id = await ev(A, k => { const w = __v.W(k, 0, -3.5); const e = BR.entities.spawn('test_dummy', w.x, undefined, w.z, { force: true, yaw: 0 }); return e ? e.id : null; }, K);
          await sleep(2000);
          const snd = await ev(driver, n => __v.sounds.slice(n), n0);
          check('V6 联机暂停时测试人走到车前 1.4 m：司机那边 fk_radar 照常在播', !!id && snd.includes('fk_radar'), { id, snd });
          await ev(A, id => { if (id) BR.entities.remove(id); return 0; }, id);
        }
        await off();
        await sleep(800);
      }
    });
    await step('V7 司机下车后，房主 levelState.vehicles 和司机最后位姿差 <1 cm', async () => {
      await ev(driver, k => { BR.player.yaw = BR.vehicles.byKey(k).pose.yaw + 0.7; return 0; }, K);
      await ev(driver, () => __v.tap('Space'));
      await waitFor(driver, () => !BR.vehicles.seated, null, 15000);
      await sleep(1500);
      const [pd, ls, sd] = await Promise.all([ev(driver, k => __v.pose(k), K), ev(A, k => BR.levelState.getv('1', 'veh', k), K), ev(driver, () => __v.seat())]);
      check('V7 司机下车（没坐着了），房主 levelState.vehicles 和司机最后位姿差 <1 cm（on 0）', !sd.seated && !!ls && Math.hypot(ls.x - pd.x, ls.z - pd.z) < 0.01 && ls.on === 0, { pd, ls, sd });
    });
    await step('V8 客机司机断线：车停住、还坐着；重连后车不瞬移；房主那边租约超时按最后位姿停车', async () => {
      // 客机重新上车
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      await ev(driver, () => __v.untilRun());
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V8 客机重新坐上车', false, s0); return; }
      await ev(driver, k => __v.accelTo(k, 'KeyS', 1.5, 3), K);
      const n0 = await ev(driver, () => __v.notes.length);
      await ctxB.setOffline(true);
      netDown.add('VB');
      await ev(driver, () => __t.cutPeer());
      const rc = await waitFor(driver, () => BR.coop.phase === 'reconnecting', null, 15000);
      const ms = await ev(driver, k => __v.untilStop(k, 3), K);
      await ev(driver, () => __v.up('KeyS'));
      const r1 = await ev(driver, a => Object.assign(__v.seat(), { notes: __v.notes.slice(a.n), pose: __v.pose(a.k) }), { k: K, n: n0 });
      check('V8 客机掉线：车停住（' + ms + ' s），人还坐在车上，提示「掉线了，车先停住」', rc && ms != null && r1.seated === K && r1.notes.some(t => /掉线了，车先停住/.test(t)), r1);
      await sleep(4000);   // 房主那边 'k:' 租约 3 s 没保活就收尾
      const r2 = await ev(A, k => ({ ls: BR.levelState.getv('1', 'veh', k), pose: __v.pose(k), leases: BR.coop.debugInfo().vehLeases, last: BR.coop.debugInfo().vehLast }), K);
      // 房主只知道断线前最后一帧：车在客机那边又刹了一小段（≤0.6 s），所以只要求房主停在最后位姿上、离客机停下的地方不远
      check('V8 房主那边租约超时：按最后位姿停车（levelState on 0、房主那台车就停在记录上，离客机停下的地方 <0.6 m）', !!r2.ls && r2.ls.on === 0 && Math.hypot(r2.ls.x - r2.pose.x, r2.ls.z - r2.pose.z) < 0.01 && Math.hypot(r2.ls.x - r1.pose.x, r2.ls.z - r1.pose.z) < 0.6, { r2, guest: r1.pose });
      // 房主这边每帧记车的位置，量重连前后最大的单帧跳动
      await ev(A, k => { window.__vTrack = []; const tick = () => { const p = __v.pose(k); if (p) window.__vTrack.push([performance.now(), p.x, p.z]); if (window.__vTrack.length < 2000) window.__vTrackRaf = requestAnimationFrame(tick); }; tick(); return 0; }, K);
      await ctxB.setOffline(false);
      netDown.delete('VB');
      const back = await waitActive([A, B], 60000);
      // 等房主那边的车滑到客机的位置（差 <5 cm，最多 15 s）再量：机器很忙时房主这边一帧要好几百毫秒，固定等 3 s 可能还没滑完（返修 r4）
      const tConv = Date.now();
      let conv = null;
      while (Date.now() - tConv < 15000) {
        const [g, h] = await Promise.all([ev(driver, k => __v.pose(k), K), ev(A, k => __v.pose(k), K)]);
        conv = g && h ? Math.hypot(g.x - h.x, g.z - h.z) : null;
        if (conv != null && conv < 0.05 && Date.now() - tConv > 1500) break;
        await sleep(300);
      }
      info('V8 重连后房主这边滑到客机位置用了 ' + ((Date.now() - tConv) / 1000).toFixed(1) + ' s（差 ' + (conv == null ? '?' : (conv * 100).toFixed(1)) + ' cm）');
      const [r3, r4, tr] = await Promise.all([ev(driver, k => Object.assign(__v.seat(), { pose: __v.pose(k) }), K), ev(A, k => __v.pose(k), K),
        ev(A, () => {
          cancelAnimationFrame(window.__vTrackRaf);
          const t = window.__vTrack;
          let mx = 0, vmax = 0, frames = 0;
          for (let i = 1; i < t.length; i++) {
            const d = Math.hypot(t[i][1] - t[i - 1][1], t[i][2] - t[i - 1][2]), dt = Math.max(1, t[i][0] - t[i - 1][0]) / 1000;
            if (d > 1e-4) { frames++; mx = Math.max(mx, d); vmax = Math.max(vmax, d / dt); }
          }
          return { n: t.length, maxStep: mx, maxSpeed: vmax, movingFrames: frames };
        })]);
      const jump = Math.hypot(r3.pose.x - r1.pose.x, r3.pose.z - r1.pose.z);
      check('V8 重连后客机还坐着（重新拿到租约），自己的车位置跳变 ' + (jump * 100).toFixed(1) + ' cm（<5 cm）', back && r3.seated === K && jump < 0.05, { r3, back });
      // 房主只记得断线前那一帧，客机那边车又刹了一小段：重连后房主这边从记录滑到客机的位置。「不瞬移」= 这段滑动的速度不超过车的最高速 4.5 m/s
      // （SwiftShader 一帧两三百毫秒，单帧位移本身说明不了什么，按墙钟算速度），最后和客机一致
      check('V8 重连后房主这边的车不瞬移（滑过去最快 ' + tr.maxSpeed.toFixed(2) + ' m/s ≤4.5，单帧最大 ' + (tr.maxStep * 100).toFixed(1) + ' cm），最后和客机差 <5 cm', tr.maxSpeed <= 4.5 && Math.hypot(r4.x - r3.pose.x, r4.z - r3.pose.z) < 0.05, { tr, r4, guest: r3.pose });
      // 接着能开
      const p0 = await ev(A, k => __v.pose(k), K);
      await ev(driver, () => __v.hold('KeyW', 0.8));
      await sleep(600);
      const p1 = await ev(A, k => __v.pose(k), K);
      check('V8 重连后接着开：房主看到车在动', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, { p0, p1 });
    });
    // ---- FE1 返修 r2：仪表台大灯开关联机同步（家长定的规则）----
    await step('V12 客机司机拨仪表台的大灯开关：房主那边远端车的大灯跟着灭 / 亮；关着下车，房主坐上去点火大灯也不亮', async () => {
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V12 客机还坐在车上', false, s0); return; }
      const lit0 = await ev(watcher, k => ({ fkr: __v.extra['fkr:' + k] || 0, hl: __v.hl(k) }), K);
      await ev(driver, k => __v.aimSwitch(k), K);
      await sleep(500);
      const c0 = await ev(driver, () => __v.cand());
      await ev(driver, () => __v.tap('Space'));
      const offOk = await waitFor(watcher, k => !(__v.extra['fkr:' + k] > 0) && __v.hl(k) === 0, K, 8000);
      const [d1, w1] = await Promise.all([ev(driver, k => ({ hl: __v.hl(k), fk: __v.extra['fk:' + k] || 0, seated: BR.vehicles.seated }), K), ev(watcher, k => ({ fkr: __v.extra['fkr:' + k] || 0, hl: __v.hl(k) }), K)]);
      check('V12 客机对准开关（「关大灯」）短按空格关掉：自己的大灯撤掉、人还在车上；房主那边远端车的大灯也撤掉（hl 0）',
        lit0.fkr > 0 && !!c0 && c0.key === 'fkhl:' + K && c0.verb === '关大灯' && d1.hl === 0 && d1.fk === 0 && d1.seated === K && offOk && w1.fkr === 0 && w1.hl === 0, { lit0, c0, d1, w1 });
      await ev(driver, k => __v.aimSwitch(k), K);
      await sleep(400);
      await ev(driver, () => __v.tap('Space'));
      const onOk = await waitFor(watcher, k => __v.extra['fkr:' + k] > 0 && __v.hl(k) === 1, K, 8000);
      check('V12 再拨一下打开：房主那边远端车的大灯又亮了', onOk, await ev(watcher, k => ({ fkr: __v.extra['fkr:' + k] || 0, hl: __v.hl(k) }), K));
      // 关着下车：房主 levelState 记 hl 0
      await ev(driver, k => __v.aimSwitch(k), K);
      await sleep(400);
      await ev(driver, () => __v.tap('Space'));
      await waitFor(driver, k => __v.hl(k) === 0, K, 5000);
      await ev(driver, () => __v.lookAway());
      await sleep(400);
      await ev(driver, () => __v.tap('Space'));
      await waitFor(driver, () => !BR.vehicles.seated, null, 15000);
      const lsOk = await waitFor(watcher, k => { const v = BR.levelState.getv('1', 'veh', k); return !!v && v.hl === 0 && v.on === 0; }, K, 8000);
      // 房主坐上去：点着火，大灯照样关着；拨开以后客机看到远端车的大灯
      await ev(watcher, k => __v.standL(k, -1.2, 0.24), K);
      await sleep(600);
      await ev(watcher, () => __v.tap('Space'));
      await ev(watcher, () => __v.untilRun());
      await sleep(800);
      const h1 = await ev(watcher, k => ({ seated: BR.vehicles.seated, hl: __v.hl(k), fk: __v.extra['fk:' + k] || 0, ls: BR.levelState.getv('1', 'veh', k) }), K);
      check('V12 关着大灯下车：房主 levelState 记 hl 0；房主坐上去点着火，大灯照样不亮', lsOk && h1.seated === K && h1.hl === 0 && h1.fk === 0, h1);
      await ev(watcher, k => __v.aimSwitch(k), K);
      await sleep(400);
      await ev(watcher, () => __v.tap('Space'));
      const seeOk = await waitFor(driver, k => __v.extra['fkr:' + k] > 0 && __v.hl(k) === 1, K, 8000);
      check('V12 房主拨开大灯：客机那边看到远端车的大灯亮了', seeOk, await ev(driver, k => ({ fkr: __v.extra['fkr:' + k] || 0, hl: __v.hl(k) }), K));
      await ev(watcher, () => __v.lookAway());
      await sleep(300);
      await ev(watcher, () => __v.tap('Space'));
      await waitFor(watcher, () => !BR.vehicles.seated, null, 15000);
      await sleep(1500);
    });
    // ---- 撞车甩货联机以房主为准（家长定的规则）。联机时本来不能丢东西，货叉上不会有瓶罐：这里两边各摆一只同 id 的罐头挂到货叉上，只为走一遍这条路 ----
    await step('V13 客机司机全速撞柱子、货叉上的罐头甩出去：房主算落点、写 levelState，客机照房主的摆（两边差 <1 cm）', async () => {
      const lane = await ev(watcher, k => __v.pillarLane(k), K);
      if (!lane) { check('V13 找到一条全速撞出生块柱子的直道', false); return; }
      await ev(watcher, a => { BR.levelState.set('1', 'veh', a.k, { x: a.l.x, z: a.l.z, yaw: a.l.yaw, steer: 0, lift: 0, on: 0, carry: null, n: (BR.vehicles.byKey(a.k) || {}).n || 0, hl: 1 }); return 0; }, { k: K, l: lane });
      const placed = await waitFor(driver, a => { const p = __v.pose(a.k); return !!p && Math.hypot(p.x - a.l.x, p.z - a.l.z) < 0.01; }, { k: K, l: lane }, 8000);
      // 两边同一个 id 的罐头摆在左货叉上、挂到这台车上
      const put = k => { const G = BR.L1forklift.geo, p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = -0.28, lz = -1.65;
        const x = p.x + c * lx + s * lz, z = p.z - s * lx + c * lz, y = p.y + (G.forkY || 0.015) + (G.forkT || 0.04);
        const it = BR.items.spawn('canned_food', x, y, z, { id: 'fkt-can1', still: true });
        return { ok: !!it && BR.vehicles.attachItem('fkt-can1', k), x, y, z }; };
      const [pa, pb] = await Promise.all([ev(watcher, put, K), ev(driver, put, K)]);
      // 房主站到车后面 6 m（不挡雷达）；客机上车、按住 W 撞上去
      await ev(watcher, a => { const f = { x: -Math.sin(a.l.yaw), z: -Math.cos(a.l.yaw) }; const P = BR.player; P.x = a.l.x - f.x * 6; P.z = a.l.z - f.z * 6; P.vx = 0; P.vz = 0; return 0; }, { l: lane });
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      const ph = await ev(driver, () => __v.untilRun());
      await sleep(500);
      await ev(driver, () => __v.hold('KeyW', 3.0));
      await ev(driver, k => __v.untilStop(k, 3), K);
      await sleep(3000);
      const look = p => ev(p, () => {
        const it = BR.items.find('fkt-can1'), d = BR.vehicles.debugInfo(), K2 = BR.vehicles.list()[0];
        const riders = Object.values(d.riders || {}).some(a => a.includes('fkt-can1'));
        return { it: it ? { x: +it.x.toFixed(4), y: +it.y.toFixed(4), z: +it.z.toFixed(4), held: !!it.held } : null, riders, throws: d.throws.slice(-1), ground: it ? BR.phys.groundY(it.x, it.z) : null,
          ls: BR.levelState.getv('1', 'item', 'fkt-can1') };
      });
      const [ra, rb] = await Promise.all([look(watcher), look(driver)]);
      const ta = ra.throws[0], tb = rb.throws[0];
      const hostSpot = ta && ta.list.find(e => e[0] === 'fkt-can1');
      check('V13 客机司机撞上去（' + (tb ? tb.v0 : '?') + ' m/s）：房主替他算（by peer）、客机照房主的落点摆（by host）',
        placed && pa.ok && pb.ok && ph === 'run' && !!ta && ta.by === 'peer' && !!tb && tb.by === 'host' && !!hostSpot, { lane, pa, pb, ta, tb });
      check('V13 两边那只罐头都在地上、不在货叉上，位置都等于房主算的落点（差 <1 cm），房主 levelState 记了它',
        !!hostSpot && !!ra.it && !!rb.it && !ra.riders && !rb.riders && Math.abs(ra.it.y - ra.ground) < 0.02 &&
        Math.hypot(ra.it.x - hostSpot[1], ra.it.z - hostSpot[3]) < 0.01 && Math.hypot(rb.it.x - hostSpot[1], rb.it.z - hostSpot[3]) < 0.01 &&
        Array.isArray(ra.ls) && Math.hypot(ra.ls[0] - hostSpot[1], ra.ls[2] - hostSpot[3]) < 0.01, { ra, rb, hostSpot });
    });
    await step('V13b 房主自己开车撞上去：房主算落点、发给客机（net:fkthrow），客机照摆（两边差 <1 cm）', async () => {
      const lane = await ev(watcher, k => __v.pillarLane(k), K);
      if (!lane) { check('V13b 找到一条全速撞出生块柱子的直道', false); return; }
      // 客机先下车（看向别处再按空格），房主把车摆回起点
      await ev(driver, () => __v.lookAway());
      await ev(driver, () => __v.tap('Space'));
      await waitFor(driver, () => !BR.vehicles.seated, null, 15000);
      await sleep(1200);
      await ev(watcher, a => { BR.levelState.set('1', 'veh', a.k, { x: a.l.x, z: a.l.z, yaw: a.l.yaw, steer: 0, lift: 0, on: 0, carry: null, n: (BR.vehicles.byKey(a.k) || {}).n || 0, hl: 1 }); return 0; }, { k: K, l: lane });
      const placed = await waitFor(driver, a => { const p = __v.pose(a.k); return !!p && Math.hypot(p.x - a.l.x, p.z - a.l.z) < 0.01; }, { k: K, l: lane }, 8000);
      const put = k => { const G = BR.L1forklift.geo, p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = 0.28, lz = -1.65;
        const x = p.x + c * lx + s * lz, z = p.z - s * lx + c * lz, y = p.y + (G.forkY || 0.015) + (G.forkT || 0.04);
        const it = BR.items.spawn('canned_food', x, y, z, { id: 'fkt-can2', still: true });
        return { ok: !!it && BR.vehicles.attachItem('fkt-can2', k) }; };
      const [pa, pb] = await Promise.all([ev(watcher, put, K), ev(driver, put, K)]);
      // 客机站到车后面 6 m；房主上车、按住 W 撞上去
      await ev(driver, a => { const f = { x: -Math.sin(a.l.yaw), z: -Math.cos(a.l.yaw) }; const P = BR.player; P.x = a.l.x - f.x * 6; P.z = a.l.z - f.z * 6; P.vx = 0; P.vz = 0; return 0; }, { l: lane });
      await ev(watcher, k => __v.standL(k, -1.2, 0.24), K);
      await sleep(600);
      await ev(watcher, () => __v.tap('Space'));
      const ph = await ev(watcher, () => __v.untilRun());
      await sleep(500);
      await ev(watcher, () => __v.hold('KeyW', 3.0));
      await ev(watcher, k => __v.untilStop(k, 3), K);
      await sleep(3000);
      const look = p => ev(p, () => {
        const it = BR.items.find('fkt-can2'), d = BR.vehicles.debugInfo();
        const riders = Object.values(d.riders || {}).some(a => a.includes('fkt-can2'));
        return { it: it ? { x: +it.x.toFixed(4), y: +it.y.toFixed(4), z: +it.z.toFixed(4) } : null, riders, throws: d.throws.slice(-1), ground: it ? BR.phys.groundY(it.x, it.z) : null };
      });
      const [ra, rb] = await Promise.all([look(watcher), look(driver)]);
      const ta = ra.throws[0], tb = rb.throws[0], spot = ta && ta.list.find(e => e[0] === 'fkt-can2');
      check('V13b 房主撞上去（' + (ta ? ta.v0 : '?') + ' m/s）：房主自己算（by me），客机照房主的落点摆（by host），两边那只罐头都在地上、位置一样（差 <1 cm）',
        placed && pa.ok && pb.ok && ph === 'run' && !!ta && ta.by === 'me' && !!tb && tb.by === 'host' && !!spot && !!ra.it && !!rb.it && !ra.riders && !rb.riders &&
        Math.abs(ra.it.y - ra.ground) < 0.02 && Math.hypot(rb.it.x - spot[1], rb.it.z - spot[3]) < 0.01 && Math.hypot(ra.it.x - spot[1], ra.it.z - spot[3]) < 0.01, { lane, ta, tb, ra, rb });
      // 房主下车，客机重新坐上去（后面 V14 要客机开）
      await ev(watcher, () => __v.lookAway());
      await ev(watcher, () => __v.tap('Space'));
      await waitFor(watcher, () => !BR.vehicles.seated, null, 15000);
      await sleep(1500);
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      await ev(driver, () => __v.untilRun());
      await sleep(800);
    });
    // ---- 客机消息晚到（网络卡了一下，连接没断）：第二轮 play 的 major ----
    await step('V14 客机开着车时出站消息被攒住 7 s（房主按 3 s 超时收走租约）：客机人还坐着、提示「掉线了，车先停住」；消息补到以后两边租约一致、车的位置差 <5 cm', async () => {
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V14 客机还坐在车上', false, s0); return; }
      const n0 = await ev(driver, () => __v.notes.length);
      await ev(driver, () => __v.holdOut(true));
      await ev(driver, () => __v.hold('KeyS', 1.0));
      await ev(driver, k => __v.untilStop(k, 3), K);
      const gone = await waitFor(watcher, k => !BR.coop.debugInfo().vehLeases.some(l => l[0] === 'k:' + k), K, 20000);
      // 客机重新要租约的请求也被攒着：4 s 等不到回复，接着要。最多等 7 s，但要在客机从第一次要租约算起 15 s（REGRAB_GIVEUP）放弃之前
      // 留出 2.5 s 量「人还坐着」—— 机器很忙时房主收走租约要等很久，固定等 7 s 会等过客机放弃的时刻（返修 r4）
      const rg = await ev(driver, () => { const n = BR.vehiclesNet.debugInfo().net; return { since: n.regrabSince, now: performance.now() }; });
      const left = rg.since != null ? 15000 - (rg.now - rg.since) : 15000;
      await sleep(Math.max(0, Math.min(7000, left - 2500)));
      const mid = await ev(driver, a => Object.assign(__v.seat(), { notes: __v.notes.slice(a.n), held: __v.outN, net: BR.vehiclesNet.debugInfo().net }), { n: n0 });
      mid.regrabLeftMs = Math.round(left);
      const nOut = await ev(driver, () => __v.holdOut(false));
      await sleep(8000);
      const st = p => ev(p, k => ({ seated: BR.vehicles.seated, lease: BR.coop.leaseOf('k:' + k), leases: BR.coop.debugInfo().vehLeases.map(l => [l[0], l[1]]), pose: __v.pose(k) }), K);
      const [a1, b1] = await Promise.all([st(watcher), st(driver)]);
      const agree = (b1.seated === K) === (a1.leases.some(l => l[0] === 'k:' + K && l[1] === 'guest')) && (b1.seated === K) === (b1.lease === 'me');
      const diff1 = Math.hypot(a1.pose.x - b1.pose.x, a1.pose.z - b1.pose.z);
      if (gone && mid.seated !== K && left < 3500) {
        // 房主收走租约的时候客机已经要了 11.5 s 以上（机器太忙）：这一项的前提不成立，记下来不算通过也不算失败
        info('SKIP V14 消息攒住期间客机还坐着：房主收走租约时客机已经要了 ' + ((15000 - left) / 1000).toFixed(1) + ' s，离 15 s 放弃太近，前提不成立', mid);
        skips.push('V14 消息攒住期间客机还坐着');
      } else check('V14 消息攒住期间：房主收走了租约，客机人还坐在车上，提示「掉线了，车先停住」（攒了 ' + nOut + ' 条）',
        gone && mid.seated === K && mid.notes.some(t => /掉线了，车先停住/.test(t)), mid);
      check('V14 消息补到 8 s 后：两边租约一致（客机' + (b1.seated === K ? '还坐着、租约在手' : '下了车') + '），车的位置差 ' + (diff1 * 100).toFixed(1) + ' cm（<5 cm）、发动机状态一致',
        agree && diff1 < 0.05 && a1.pose.on === b1.pose.on, { a1, b1 });
      // 客机下车：两边停在同一个地方
      if (b1.seated === K) {
        await ev(driver, () => __v.lookAway());
        await ev(driver, () => __v.tap('Space'));
        await waitFor(driver, () => !BR.vehicles.seated, null, 15000);
      }
      await sleep(2500);
      const [a2, b2] = await Promise.all([st(watcher), st(driver)]);
      const diff2 = Math.hypot(a2.pose.x - b2.pose.x, a2.pose.z - b2.pose.z);
      check('V14 客机下车后两边的车停在同一个地方（差 ' + (diff2 * 100).toFixed(1) + ' cm）、都熄火', diff2 < 0.05 && a2.pose.on === 0 && b2.pose.on === 0 && !b2.seated, { a2, b2 });
    });
    await step('V14b 客机出站消息被攒住 20 s：客机要不回租约被放下车（「没连上，再试一次」）；消息补到以后房主把车停在客机下车的地方（差 <5 cm）', async () => {
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      await ev(driver, () => __v.untilRun());
      await sleep(800);
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V14b 客机重新坐上车', false, s0); return; }
      const n0 = await ev(driver, () => __v.notes.length);
      await ev(driver, () => __v.holdOut(true));
      await ev(driver, () => __v.hold('KeyW', 0.8));
      await ev(driver, k => __v.untilStop(k, 3), K);
      const out = await waitFor(driver, () => !BR.vehicles.seated, null, 30000);
      const mid = await ev(driver, a => Object.assign(__v.seat(), { notes: __v.notes.slice(a.n), pose: __v.pose(a.k) }), { n: n0, k: K });
      const host0 = await ev(watcher, k => __v.pose(k), K);
      await ev(driver, () => __v.holdOut(false));
      await sleep(6000);
      const [a1, b1] = await Promise.all([ev(watcher, k => ({ pose: __v.pose(k), ls: BR.levelState.getv('1', 'veh', k), leases: BR.coop.debugInfo().vehLeases }), K), ev(driver, k => ({ pose: __v.pose(k), seated: BR.vehicles.seated }), K)]);
      const diff = Math.hypot(a1.pose.x - b1.pose.x, a1.pose.z - b1.pose.z);
      check('V14b 要不回租约：客机被放下车，提示「没连上，再试一次」', out && !mid.seated && mid.notes.some(t => /没连上，再试一次/.test(t)), mid);
      check('V14b 消息补到以后：房主那边的车从 ' + (Math.hypot(host0.x - b1.pose.x, host0.z - b1.pose.z) * 100).toFixed(0) + ' cm 外挪到客机下车的地方（差 ' + (diff * 100).toFixed(1) + ' cm），levelState 跟着改，没人拿着租约',
        diff < 0.05 && !!a1.ls && Math.hypot(a1.ls.x - b1.pose.x, a1.ls.z - b1.pose.z) < 0.05 && !a1.leases.some(l => l[0] === 'k:' + K), { host0, a1, b1 });
      // 后面 V9 / V11 要客机接着开
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      await ev(driver, () => __v.untilRun());
      await sleep(800);
    });
    // V14c（FE1 返修 r3）：客机晚到的 rel 遇到「这期间车被挪过」—— 房主 hostRel 的 vehFin 拒绝分支。客机开着车时出站消息被攒住，
    // 房主按超时收走租约（finalizeVeh 记下 vehFin），然后这台车在房主这边被挪到 1.2 m 外（直接改房主 levelState，等于「这期间有人把车挪走了」）；
    // 之后才放出客机攒着的消息（里面有他被放下车时的 rel）。房主的车必须留在挪过去的地方（levelState 不变），客机那边被拉过去（差 <5 cm），没人拿着租约。
    // 不用「房主坐上去开走」来挪：客机的位姿消息也攒着，房主那边一直看到客机坐在车上，上车只给「队友在开叉车」（现有规则），开不走
    await step('V14c 客机消息晚到、这期间车已经在房主那边被挪走：晚到的 rel 不把车挪回去；客机那边的车被拉到房主那边的位置（差 <5 cm），没人拿着租约', async () => {
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V14c 客机还坐在车上', false, s0); return; }
      await ev(driver, () => __v.holdOut(true));
      await ev(driver, () => __v.hold('KeyW', 0.8));
      await ev(driver, k => __v.untilStop(k, 3), K);
      const gone = await waitFor(watcher, k => !BR.coop.debugInfo().vehLeases.some(l => l[0] === 'k:' + k), K, 20000);
      await sleep(500);
      const hp0 = await ev(watcher, k => __v.pose(k), K);
      // 房主这边把车往后挪 1.2 m（车是从那边开过来的，后面空着；挪之前先查不压东西）
      const moved = await ev(watcher, a => {
        const p = __v.pose(a.k), f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
        for (const d of [1.2, 1.0, 1.5]) {
          const x = p.x - f.x * d, z = p.z - f.z * d;
          if (__v.blockedAt(a.k, x, z, p.yaw, 0)) continue;
          const old = BR.levelState.getv('1', 'veh', a.k) || {};
          BR.levelState.set('1', 'veh', a.k, Object.assign({}, old, { x, z, yaw: p.yaw, steer: 0, lift: 0, on: 0 }));
          return { x, z, d };
        }
        return null;
      }, { k: K });
      await sleep(1500);
      const hp1 = await ev(watcher, k => ({ pose: __v.pose(k), ls: BR.levelState.getv('1', 'veh', k) }), K);
      // 客机：要不回租约被放下车（他的 rel 也攒在出站队列里）
      const out = await waitFor(driver, () => !BR.vehicles.seated, null, 30000);
      const gp0 = await ev(driver, k => __v.pose(k), K);
      const nOut = await ev(driver, () => __v.holdOut(false));
      await sleep(2500);
      const [a1, b1] = await Promise.all([
        ev(watcher, k => ({ pose: __v.pose(k), ls: BR.levelState.getv('1', 'veh', k), leases: BR.coop.debugInfo().vehLeases.map(l => [l[0], l[1]]), seated: BR.vehicles.seated }), K),
        ev(driver, k => ({ pose: __v.pose(k), seated: BR.vehicles.seated, lease: BR.coop.leaseOf('k:' + k) }), K),
      ]);
      const mv = Math.hypot(hp1.pose.x - hp0.x, hp1.pose.z - hp0.z), stay = Math.hypot(a1.pose.x - hp1.pose.x, a1.pose.z - hp1.pose.z);
      const lsStay = !!a1.ls && !!hp1.ls && Math.hypot(a1.ls.x - hp1.ls.x, a1.ls.z - hp1.ls.z) < 0.005;
      const gdiff = Math.hypot(b1.pose.x - a1.pose.x, b1.pose.z - a1.pose.z), gFar = Math.hypot(gp0.x - hp1.pose.x, gp0.z - hp1.pose.z);
      check('V14c 房主收走租约后车在房主那边被挪开 ' + mv.toFixed(2) + ' m；客机那时要不回租约被放下车（攒了 ' + nOut + ' 条消息）',
        gone && !!moved && mv >= 0.9 && out, { gone, moved, out, hp0, hp1, gp0 });
      check('V14c 客机攒着的消息（含晚到的 rel）补到以后：房主的车留在挪过去的地方（又挪了 ' + (stay * 100).toFixed(1) + ' cm；客机下车的地方离它 ' + (gFar * 100).toFixed(0) + ' cm），levelState 没被改回客机下车的位置',
        stay < 0.01 && lsStay && !a1.seated, { a1, hp1 });
      check('V14c 客机那边的车从 ' + (gFar * 100).toFixed(0) + ' cm 外被拉到房主那边的位置（差 ' + (gdiff * 100).toFixed(1) + ' cm），两边都没人拿着租约',
        gdiff < 0.05 && !a1.leases.some(l => l[0] === 'k:' + K) && !b1.seated && b1.lease !== 'me', { a1, b1, gp0 });
      // 后面 V9 / V11 要客机接着开
      await ev(driver, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(600);
      await ev(driver, () => __v.tap('Space'));
      await ev(driver, () => __v.untilRun());
      await sleep(800);
    });
    await step('V9 客机开着车、车在房主 4 块以外：房主那边一只测试实体摆到车上会被推出来', async () => {
      await ev(A, () => { const P = BR.player; P.x = 16 + 32 * 4; P.z = 30; P.vx = 0; P.vz = 0; return 0; });
      await sleep(2500);
      const r = await ev(A, k => {
        const p = BR.vehicles.byKey(k).pose;
        const e = BR.entities.spawn('test_dummy', p.x, undefined, p.z, { force: true, yaw: 0 });
        return { id: e ? e.id : null, far: Math.hypot(BR.player.x - p.x, BR.player.z - p.z) };
      }, K);
      const look = () => ev(A, a => {
        const e = BR.entities.get(a.id), pk = (BR.vehicles.list().find(v => v.key === a.k) || {}).physKey;
        if (!e) return { gone: true };
        const inObb = BR.phys.records(pk).obbs.filter(o => { const d = BR.phys.circleVsObb(e.x, e.z, (e.r || 0.3) * 0.9, o, e.y, 1.7); return d && d.depth > 0.02; }).map(o => o.name);
        return { x: +e.x.toFixed(3), z: +e.z.toFixed(3), inObb, pk };
      }, { k: K, id: r.id });
      await sleep(1500);
      const r2 = await look();
      await sleep(2500);
      const r3 = await look();
      check('V9 车在房主 ' + (r.far / 32).toFixed(1) + ' 块外：测试实体摆到车上，被推出来（4 s 内），不穿过车', !!r.id && r.far > 32 * 3.5 && !r3.gone && r3.inObb.length === 0, { r, at1_5s: r2, at4s: r3 });
      await ev(A, id => { if (id) BR.entities.remove(id); const P = BR.player; P.x = 16; P.z = 30; return 0; }, r.id);
      await sleep(1500);
    });
    await step('V11 联机死亡结算：3 m/s 时司机倒下，车 0.6 s 内停住、货叉不动，人落在车旁', async () => {
      const s0 = await ev(driver, () => __v.seat());
      if (s0.seated !== K) { check('V11 客机还坐在车上', false, s0); return; }
      await ev(driver, () => __v.hold('KeyS', 1.5));
      await ev(driver, k => __v.untilStop(k, 3), K);
      const v = await ev(driver, k => __v.accelTo(k, 'KeyW', 3.0, 4), K);
      const lift0 = await ev(driver, k => __v.pose(k).lift, K);
      await ev(driver, () => { BR.player.damage({ hp: 9999, cause: '测试' }); return 0; });
      const ms = await ev(driver, k => __v.untilStop(k, 2), K);
      await ev(driver, () => __v.up('KeyW'));
      await sleep(1500);
      const [rd, rw] = await Promise.all([ev(driver, k => Object.assign(__v.seat(), { pose: __v.pose(k), dead: BR.player.dead, P: { x: BR.player.x, z: BR.player.z } }), K), ev(watcher, k => __v.pose(k), K)]);
      check('V11 司机（' + (v || 0).toFixed(2) + ' m/s）倒下：车 ' + ms + ' s 内停住（≤0.6 s）、货叉不动，人不在车上；房主看到的车也停了', v >= 3 && ms != null && ms <= 0.6 + 0.1 + 1e-6 && rd.dead && !rd.seated && Math.abs(rd.pose.lift - lift0) < 1e-6 && Math.abs(rw.spd) < 0.05, { v, ms, lift0, rd, rw });
      await ev(driver, () => { BR.bus.emit('death:continue'); return 0; });
      await sleep(1500);
    });
  } finally {
    await Promise.all([A, B].map(p => ev(p, () => { try { if (BR.coop.phase !== 'idle') BR.coop.leave(); } catch (e) { /* 忽略 */ } return 0; }).catch(() => {})));
    await ctxA.close().catch(() => {});
    await ctxB.close().catch(() => {});
  }

  // 旧版客机（hello 里没有 veh2）：进层提示叉车用不了，上车被拒
  const ctxC = await newContext(browser, 'VC');
  const ctxD = await newContext(browser, 'VD');
  const C = await newPage(ctxC, 'VC');
  const Dp = await newPage(ctxD, 'VD');
  try {
    await Promise.all([boot(C, base), boot(Dp, base)]);
    lockPages = [C, Dp];
    await Promise.all([C, Dp].map(p => ev(p, installVeh)));
    // D 是「旧版」：发出去的 hello 去掉 veh2（其余照常）
    await ev(Dp, () => {
      const N = BR.net, o = N.send;
      N.send = function (m) {
        const args = Array.prototype.slice.call(arguments);
        if (m && m.t === 'hello' && Array.isArray(m.caps)) args[0] = Object.assign({}, m, { caps: m.caps.filter(c => c !== 'veh2') });
        return o.apply(this, args);
      };
      return 0;
    });
    await step('V10 对方版本较旧（不报 veh2）：进 L1 提示叉车用不了，上车被拒并提示', async () => {
      const code = await hostCamp(C, '房主C');
      const j = code ? await joinCamp(Dp, code, { name: '旧客机D' }) : { joined: false };
      if (!j.joined) { check('V10 两人进了营地', false, { code, j }); return; }
      await tentPick(C, { mode: 'casual', lv: '1' });
      await waitFor(Dp, () => { const s = BR.coopCamp.state; return !!s && s.mode === 'casual' && String(s.lv) === '1'; }, null, 6000);
      const d = await departBoth([C, Dp], '1', 'casual');
      await sleep(2500);
      const caps = await ev(C, () => BR.coop.debugInfo().peerCaps);
      const t1 = await ev(C, () => __v.notes.concat(__t.toasts, __t.notices.map(n => n.text)));
      check('V10 进层提示「对方版本较旧，联机时…叉车用不了」', d.arrived && Array.isArray(caps) && !caps.includes('veh2') && t1.some(t => /对方版本较旧，联机时.*叉车.*用不了/.test(t)), { d, caps, t1: t1.slice(-8) });
      const k = await ev(C, () => __v.key());
      await ev(C, k => __v.standL(k, -1.2, 0.24), k);
      await sleep(800);
      const cur = await ev(C, () => __v.cur());
      const n0 = await ev(C, () => __v.notes.length);
      await ev(C, () => __v.tap('Space'));
      await sleep(2000);
      const r = await ev(C, n => Object.assign(__v.seat(), { notes: __v.notes.slice(n), toasts: __t.toasts.slice(-4), prompt: (document.querySelector('.hud-prompt') || {}).innerText }), n0);
      check('V10 上车被拒（没坐上去），提示「对方版本较旧，联机时开不了车」', !r.seated && r.mode === 'walk' && r.notes.concat(r.toasts, [cur && cur.why || '', r.prompt || '']).some(t => /对方版本较旧，联机时开不了车/.test(t)), { cur, r });
    });
  } finally {
    await Promise.all([C, Dp].map(p => ev(p, () => { try { if (BR.coop.phase !== 'idle') BR.coop.leave(); } catch (e) { /* 忽略 */ } return 0; }).catch(() => {})));
    await ctxC.close().catch(() => {});
    await ctxD.close().catch(() => {});
  }
}

main();
