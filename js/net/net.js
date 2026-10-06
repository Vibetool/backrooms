// 后室 · 联机网络层：信令走 room.php（和火箭发射共用后端与房号段），接通后游戏消息和语音全部 P2P（WebRTC）
// 只管建连、收发、麦克风、房号续期和备用房号；hello 校验、同步、UI 都在 coop.js。服务器不改。接口：
//   BR.net.on(fn(type, data)) → 取消订阅
//     'status' 文案 | 'peerJoined' 对方昵称 | 'connected' | 'disconnected' { reason, wasConnected, spare, byPeer }
//     'peerLeft' | 'msg' 对方消息（除 bye 外全部） | 'error' { code, text, fatal }
//     'remoteStream' / 'localStream' MediaStream | 'mic' bool（麦克风被系统收回时）
//     'phase' 阶段名 | 'code' 续期后的新房号 | 'spare' 新的备用房号（和下面 hooks 的回调同时发，二选一用）
//   hooks（可选，createRoom / joinRoom / reconnectHost / reconnectGuest 的最后一个参数）：
//     onPhase(p)：'hosting' 房主等人 | 'joining' 客机复查/占房 | 'waitHost' 客机已进房、6 s 还没收到房主的 offer
//                （房主多半切到微信去了，界面写「等「X」回到游戏…」，最多 90 s，超时 'disconnected' reason=host_silent）
//                | 'waitGuest' 房主发了 offer、6 s 还没收到客机的 answer（对称：客机刚加入就切走了，最多 90 s，guest_silent）
//                | 'connecting' 双方信令已到、打洞中（30 s 判 p2p_failed） | 'connected'
//     onCode(code)：房主还没人连上，房号续期换了新号（第 renewMin 分钟，或房间在服务器上没了）
//     onSpare(code)：连通后房主建好/换新的备用房号，coop 用 {t:'spare', code} 发给客机
//     inLobby()：返回 true 表示房主正看着大厅的房号页，这时房间没了按致命错误报，不悄悄续期
//     name：reconnectGuest 用的昵称（刷新后 N.myName 是空的）
//   createRoom(name, hooks) → 房号（昵称截到 15 个字再接营地暗标 U+2063）
//   joinRoom(code, name, hooks) → { hostName, isCamp, code }（先 status 复查：closed / 不是营地 / 满了都不去占房）
//   roomInfo(code) → { state, hostName, isCamp, guestName, host_name, guest_name }（名字都已剥掉暗标）
//   spareCreate() → 备用房号；reconnectHost(code?, hooks) 在备用房里等；reconnectGuest(code, hooks) 加入备用房
//   send(obj, { lossy }) → bool；setMic(on) → Promise<bool>；leave()；errorText(code)（按微信/QQ、iOS 调整文案）
//   致命错误 'error' 的 code：房主自己的房间没了又续不上时是 room_expired（不是给客机看的 room_closed）
//   remotePaused：对方语音的 <audio> 有流但被自动播放策略拦着没播；pagehide 时也会发 'disconnected' { reason: 'closed' }
//   setRemoteVolume(v)：对方语音 <audio> 的音量 0..1，记住，之后每条新的对方语音（含重连）都照用；remoteVolume 读回
//   volumeWorks：false = 这台机器不认 <audio>.volume（iOS Safari 只读、恒为 1），coop 改用 GainNode 并 setRemoteMuted(true)
//   语音：建连时就协商一条收发音频的通道（不带轨道），开麦时才申请麦克风并 replaceTrack，不必重新协商
// 掉线重连：数据通道断了（或客机刷新页面发来软 bye），两边都发 'disconnected' { wasConnected: true }，房主的备用房号保留在
// spare 里；coop 让房主 reconnectHost()、客机 reconnectGuest(备用房号)，走同一套 offer/answer/ICE。放弃时调 leave() 关掉备用房。
(function () {
'use strict';
const BR = window.BR;

const API_TIMEOUT_MS = 8000;
const POLL_MS = 1200;
const STATUS_MS = 1500;
const SLOW_MS = 4000;              // 房主等人超过 2 分钟后，status 和 poll 都放宽到这么久一次，减轻共用服务器的压力
const SLOW_AFTER_MS = 120000;
const GUEST_STATUS_MS = 3000;      // 客机等 offer 时顺带看房间还在不在（真服务器的 poll 不查 closed）
const FAIL_MIN = 3;                // 连续失败至少这么多次、并且持续 FAIL_WINDOW_MS 才认定服务器不可达，停下来报错，不无限转圈
const FAIL_WINDOW_MS = 10000;
const FAIL_WINDOW_CAMP_MS = 60000; // 房主在营地里挂着等人：Wi-Fi 抖一下别把营地关了
const CONNECT_TIMEOUT_MS = 30000;  // 收到 offer 后 P2P 迟迟不通：多半是 NAT 打洞失败，没有 TURN 兜底
const WAIT_HOST_GRACE_MS = 6000;   // 客机进房后这么久还没收到 offer，才说「等房主回到游戏」（房主在线时 offer 几秒内就到）
const HOST_SILENT_MS = 90000;      // 客机最多等房主这么久（房主切到微信发房号，页面被挂起）
const DISC_GRACE_MS = 6000;        // 'disconnected' 常是网络抖动，宽限期内恢复就不算断线
const MIC_TIMEOUT_MS = 20000;      // 部分内嵌浏览器权限弹窗不出现，Promise 会一直悬着
const LOSSY_BUFFER = 256 * 1024;   // 高频位置/快照在通道积压时直接丢，免得延迟越滚越大
const RETRY_MS = 2000;             // 重连时服务器请求失败的重试间隔
const LATE_MS = 2000;              // 判超时的计时器晚到这么久，说明页面刚从后台 / 冻结里回来
const RECHECK_MS = 5000;
const POLL_STALE_MS = SLOW_MS + 3000;  // 这么久没收到信令轮询的回包，说明页面刚被挂起过（或网络断了一阵）
const RENEW_RETRY_MS = 5000;
const SPARE_CHECK_MS = 30000;
const SPARE_RETRY_MS = 60000;
const GONE_RENEW_MAX = 3;          // 5 分钟内「房间没了 → 续期」超过这么多次：服务器有问题，按致命错误报
const HINT_KEY = 'backrooms_net_hint';
const MAX_NAME = 16;               // 与 room.php 的 mb_substr(…, 0, 16) 一致（按字符数，不按 UTF-16 单元）
// 营地暗标：U+2063（不可见分隔符）。PHP 的 trim 只剥 ASCII 空白，不会动它；昵称截到 15 个字再接它，仍在 16 字以内。
// 旧版后室和火箭游戏建的房都没有它，客机据此认出「不是后室营地」。服务器以后要是按 Unicode 去空白，所有营地都会被认成
// 「不是营地」——往安全的方向坏
const CAMP_TAG = '\u2063';
// iOS / iPadOS Safari \u7684\u5a92\u4f53\u5143\u7d20\u97f3\u91cf\u53ea\u80fd\u7528\u5b9e\u4f53\u952e\u8c03\uff0c\u811a\u672c\u5199 volume \u4e0d\u751f\u6548\u3001\u8bfb\u56de\u6052\u4e3a 1\u3002\u5199\u4e00\u4e0b\u8bfb\u56de\u6765\u5c31\u77e5\u9053\u8ba4\u4e0d\u8ba4
const VOLUME_WORKS = (() => {
  try { const a = document.createElement('audio'); a.volume = 0.5; return a.volume === 0.5; } catch (err) { return false; }
})();

// 国内访问不到 Google STUN，放一个国内可达的在前
const DEFAULT_ICE = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const N = {
  gen: 0,             // 每次 teardown 自增：旧连接的异步回调靠它发现自己已过期
  active: false, connected: false, phase: 'idle',
  role: null, code: null, myName: '', wireName: '', peerName: '', peerJoined: false,
  pc: null, dc: null, audioTx: null,
  pollTimer: 0, statusTimer: 0, connectTimer: 0, discTimer: 0, graceTimer: 0, silentTimer: 0,
  since: 0, pendingIce: [], offerSent: false, lastPollAt: 0,
  gotOffer: false, waitingHost: false,          // 客机：房主的第一条 offer 到了没有
  gotAnswer: false,                             // 房主：客机的 answer 到了没有
  localSid: null, remoteSid: null,              // 这一轮 offer 的编号（见 onSignal）
  rejoin: false, deadline: 0,                   // 重连：服务器请求失败时一直重试到 deadline
  createdAt: 0, hostSince: 0, codeClosed: false, // 房主：当前房间建于何时、从何时开始等人；连通后原房间已关
  renewing: false, renewRetryAt: 0, renewFails: 0, goneRenews: [],
  spare: null, sparePending: null, spareTimer: 0, spareRetryAt: 0, orphanTimer: 0,   // 房主的备用房号 { code, at }
  hooks: null,
  localStream: null, micTrack: null, micOn: false, micWant: false, micPending: null,
  remoteStream: null, remoteAudio: null,
  remoteVolume: 1,    // 设置里的「联机语音音量」；teardown 不清，重连后的新 <audio> 流照用
};
const listeners = new Set();

// ---------- 小工具 ----------
function emit(type, data) {
  for (const fn of Array.from(listeners)) {
    try { fn(type, data); } catch (err) { console.error('[net] 事件处理出错', type, err); }
  }
}
function hook(name, arg) {
  const h = N.hooks;
  if (!h || typeof h[name] !== 'function') return undefined;
  try { return h[name](arg); } catch (err) { console.error('[net] 回调出错', name, err); return undefined; }
}
function netPhase(p) {
  N.phase = p;
  hook('onPhase', p);
  emit('phase', p);
}
function netError(code, detail) {
  const e = new Error(code);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
// 判超时的计时器（N[key] 存 id）：页面在后台被挂起 / 冻结时计时器会被拖住，一恢复所有过期的计时器先于第一条轮询回包触发，
// 会把「对方的 offer 早就在队列里了」误判成对方没应答。所以计时器晚到超过 LATE_MS，或者（needPoll）最近 POLL_STALE_MS
// 都没收到过信令轮询的回包，就先立刻查一次信令，再等 RECHECK_MS 才判
function armDeadline(key, ms, fn, needPoll) {
  if (N[key]) clearTimeout(N[key]);
  const due = Date.now() + ms;
  N[key] = setTimeout(() => {
    N[key] = 0;
    const now = Date.now();
    const stale = now - due > LATE_MS || (needPoll && now - N.lastPollAt > POLL_STALE_MS);
    if (!stale) { fn(); return; }
    N[key] = setTimeout(() => { N[key] = 0; fn(); }, RECHECK_MS);
    wake();
  }, ms);
}
function cfgCoop() { return (BR.config && BR.config.coop) || {}; }
function renewMs() { return (+cfgCoop().renewMin || 110) * 60000; }
function spareMs() { return (+cfgCoop().spareMin || 100) * 60000; }
function reconnectMs() { return (+cfgCoop().reconnectSec || 90) * 1000; }
// 去掉落单的代理项：截断时切坏的 emoji 进 JSON 后，PHP 的 json_decode 会整条拒收，昵称（连同暗标）就丢了
function wellFormed(s) {
  if (typeof s.toWellFormed === 'function') return s.toWellFormed().replace(/\uFFFD/g, '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
    } else if (c < 0xDC00 || c > 0xDFFF) out += s[i];
  }
  return out;
}
function stripTag(s) { return String(s == null ? '' : s).split(CAMP_TAG).join('').trim(); }
function isCampName(s) { return typeof s === 'string' && s.length > 0 && s.charAt(s.length - 1) === CAMP_TAG; }
// 按字符（码点）截，和 PHP 的 mb_substr 一致
function cleanName(name, max) {
  let s = wellFormed(stripTag(name));
  s = Array.from(s).slice(0, max || MAX_NAME).join('').trim();
  return s || '匿名流浪者';
}
function normCode(code) { return String(code == null ? '' : code).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function signalUrl() { return (BR.config && BR.config.roomApi) || ''; }
function iceServers() {
  const c = BR.config && BR.config.iceServers;
  return Array.isArray(c) && c.length ? c : DEFAULT_ICE;
}
function stopStream(s) {
  if (!s) return;
  try { s.getTracks().forEach(t => t.stop()); } catch (err) { /* 已经停了 */ }
}
// 服务器暂时性的失败：重连时值得再试
function transient(err) {
  const c = err && err.code;
  return c === 'unreachable' || c === 'timeout' || c === 'bad_response' || c === 'db_unavailable' ||
    c === 'code_exhausted' || /^http_5\d\d$/.test(String(c || ''));
}
// status 的回包 → 剥掉暗标的名字 + 是不是营地
function describe(d) {
  const raw = d && d.host_name != null ? String(d.host_name) : '';
  const hostName = stripTag(raw), guestName = stripTag(d && d.guest_name);
  return { state: d && d.state, hostName, isCamp: isCampName(raw), guestName, host_name: hostName, guest_name: guestName, raw };
}

const WIFI = 'Wi\u2011Fi';
const ERROR_TEXT = {
  no_api: '没有配置联机服务器地址（BR.config.roomApi）。',
  unreachable: '连不上联机服务器（room.php 不可达）。请检查网络后重试；如果是双击打开的本地文件，服务器会拒绝跨域请求，请用网页地址打开游戏。',
  timeout: '联机服务器响应超时，请稍后重试。',
  bad_response: '联机服务器返回了无法识别的内容，请稍后重试。',
  db_unavailable: '联机服务器暂时故障（数据库不可用），请稍后再试。',
  bad_code: '房号应为 6 位字母或数字。',
  room_not_found: '营地已经关了，或者房号不对，请朋友重新开一个。',
  room_full: '这个营地已经有两个人了。',
  room_closed: '营地已经关了，或者房号不对，请朋友重新开一个。',
  room_expired: '这个营地的房号已经失效了，请重新开一个营地。',
  code_exhausted: '服务器暂时分配不出房号，请重试。',
  no_webrtc: '当前浏览器不支持 WebRTC，无法联机。请换用新版 Chrome / Edge / Safari。',
  // 没有中转服务器（TURN）：手机流量和热点大多是运营商的对称 NAT，换过去成功率更低，所以不再建议换热点
  p2p_failed: '两个人连同一个 ' + WIFI + ' 最稳；不在一起时，请都用家里的 ' + WIFI + ' 再试，别用手机流量或热点。',
  host_silent: '房主没有应答：可能还在微信里没回来，或者已经离开。请他回到游戏，或者重开一个营地。',
  guest_silent: '朋友进了营地又没有应答：可能切到微信去了，或者已经离开。等他回到游戏，再让他加入一次。',
  not_camp: '这不是后室的营地：可能是火箭游戏的房间，或者对方的后室版本旧，请对方刷新后重开营地。',
  old_version: '对方的游戏版本旧，请对方刷新页面再试。',
  lost: '和对方的连接断开了。',
  closed: '连接已关闭。',
  cancelled: '已取消。',
  mic_noconn: '还没和对方连上，暂时不能开麦。',
  mic_denied: '麦克风权限被拒绝。请在浏览器地址栏左侧的站点设置里允许使用麦克风，然后再点开麦。',
  mic_notfound: '没有找到可用的麦克风设备。',
  mic_busy: '麦克风被其他程序占用，打不开。',
  mic_insecure: '浏览器只允许在 https 或 localhost 页面使用麦克风，当前页面地址不满足。',
  mic_unsupported: '当前浏览器不支持联机语音。',
  mic_timeout: '麦克风权限请求没有响应，请检查浏览器是否拦截了权限弹窗。',
  mic_failed: '打开麦克风失败。',
};
// 微信 / QQ 内置浏览器没有地址栏，这几类问题的出路是换到系统浏览器
const IN_APP_CODES = { no_webrtc: 1, mic_unsupported: 1, mic_denied: 1 };
function inAppBrowser() { return /MicroMessenger|QQ\//i.test(navigator.userAgent || ''); }
// iPadOS 默认发桌面 UA（Macintosh），靠多点触控区分
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function errorText(code) {
  if (!code) return '联机出错。';
  if (ERROR_TEXT[code]) {
    const inApp = inAppBrowser();
    let t = ERROR_TEXT[code];
    if (code === 'mic_denied') {
      // 默认文案按桌面 Chrome 写的；内置浏览器的权限归宿主应用管，iOS Safari 的入口不在地址栏左侧
      if (inApp) t = '麦克风权限被拒绝。请在系统设置里允许微信 / QQ 使用麦克风，然后再点开麦。';
      else if (isIOS()) t = '麦克风权限被拒绝。请在 Safari 的网站设置里允许使用麦克风（或到系统设置里的 Safari → 麦克风），然后再点开麦。';
    }
    if (inApp && IN_APP_CODES[code]) t += '可点右上角「…」选择「在浏览器打开」。';
    return t;
  }
  if (/^http_\d+$/.test(code)) return '联机服务器出错（HTTP ' + code.slice(5) + '），请稍后再试。';
  return '联机出错：' + code;
}

// ---------- room.php ----------
// 所有对信令服务器的请求都只走这一个函数：测试能整个拦截
function api(action, params, body) {
  const base = signalUrl();
  if (!base) return Promise.reject(netError('no_api'));
  let url;
  try { url = new URL(base, location.href); } catch (err) { return Promise.reject(netError('no_api')); }
  url.searchParams.set('action', action);
  for (const k in (params || {})) url.searchParams.set(k, params[k]);
  const opt = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: action === 'status' || action === 'poll' ? 'GET' : 'POST' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  if (ctl) opt.signal = ctl.signal;

  let timer = 0;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => { if (ctl) ctl.abort(); rej(netError('timeout')); }, API_TIMEOUT_MS);
  });
  const run = (async () => {
    let r;
    try { r = await fetch(url.toString(), opt); }
    catch (err) { throw netError('unreachable', err && err.message); }   // DNS、断网、CORS 拒绝都长这样
    const d = await r.json().catch(() => null);
    if (!d) throw netError(r.ok ? 'bad_response' : 'http_' + r.status);
    if (!d.ok) throw netError(d.error || 'http_' + r.status);
    return d;
  })();
  run.catch(() => {});   // 超时先赢时，被 abort 的请求别变成未处理的 rejection
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}
function closeRoom(code) { if (code) api('close', { code }).catch(() => {}); }

// 重连时服务器请求失败就隔 2 s 再试，直到 deadline；平时（deadline 为 0）失败直接抛
async function retrying(fn, deadline, gen) {
  for (;;) {
    try { return await fn(); }
    catch (err) {
      if (gen !== N.gen) throw netError('cancelled');
      if (!deadline || !transient(err) || Date.now() + RETRY_MS > deadline) throw err;
      await sleep(RETRY_MS);
      if (gen !== N.gen) throw netError('cancelled');
    }
  }
}

function sendSignal(payload) {
  return api('signal', { code: N.code, to: N.role === 'host' ? 'guest' : 'host' }, { payload });
}

// 服务器连续不可达：停下来明确报错，而不是让界面一直显示"连接中"
function fatal(err) {
  let code = (err && err.code) || 'unreachable';
  // 房主自己的房间没了：给客机看的「请朋友重新开一个」对房主不对，换成房主的说法
  if (N.role === 'host' && (code === 'room_not_found' || code === 'room_closed')) code = 'room_expired';
  teardown(true);
  emit('error', { code, text: errorText(code), fatal: true });
}

function inLobby() { return hook('inLobby') === true; }
function hostWaiting() { return N.active && N.role === 'host' && !N.peerJoined && !N.connected; }

// 带失败计数的轮询（setTimeout 链，间隔可以随状态变）；kick() 立刻跑一次（回到前台时）
function loop(ms, gen, fn) {
  const h = { timer: 0, busy: false, dead: false, fails: 0, failSince: 0 };
  const delay = typeof ms === 'function' ? ms : () => ms;
  function arm() { if (!h.dead && gen === N.gen && !h.timer) h.timer = setTimeout(tick, delay()); }
  async function tick() {
    h.timer = 0;
    if (h.dead || gen !== N.gen || h.busy) return;
    h.busy = true;
    let stop = false;
    try {
      await fn();
      h.fails = 0;
      h.failSince = 0;
    } catch (err) {
      if (h.dead || gen !== N.gen) return;
      stop = loopError(err, h);
    } finally {
      h.busy = false;
    }
    if (!stop) arm();
  }
  h.stop = () => { h.dead = true; if (h.timer) clearTimeout(h.timer); h.timer = 0; };
  h.kick = () => {
    if (h.dead || gen !== N.gen || h.busy) return;
    if (h.timer) { clearTimeout(h.timer); h.timer = 0; }
    tick();
  };
  arm();
  return h;
}
// 返回 true：这条轮询到此为止
function loopError(err, h) {
  if (N.connected) return true;   // 已经 P2P 连通，信令轮询（原房间连通后就关了）失败无所谓
  const code = err && err.code;
  if (code === 'room_not_found' || code === 'room_closed') return roomGone(err);
  if (!h.failSince) h.failSince = Date.now();
  h.fails++;
  if (h.fails === 2) emit('status', '和联机服务器的通信不稳定，正在重试…');
  const span = Date.now() - h.failSince;
  const limit = N.deadline ? Math.max(FAIL_WINDOW_MS, N.deadline - h.failSince)
    : hostWaiting() && !inLobby() ? FAIL_WINDOW_CAMP_MS : FAIL_WINDOW_MS;
  if (h.fails >= FAIL_MIN && span >= limit) { fatal(err); return true; }
  return false;
}

// 房间在服务器上没了 / 被关了：房主还在等人、不在大厅时换个新房号接着等；其余情况按致命错误报
function roomGone(err) {
  if (canRenewOnGone()) {
    if (!N.renewing && Date.now() >= N.renewRetryAt) renewRoom('gone');
    return false;
  }
  fatal(err);
  return true;
}
function canRenewOnGone() {
  if (!hostWaiting() || N.rejoin) return false;   // 重连时客机只认这个备用房号，换了也没用
  if (N.renewing) return true;
  if (inLobby()) return false;
  const now = Date.now();
  N.goneRenews = N.goneRenews.filter(t => now - t < 300000);
  return N.goneRenews.length < GONE_RENEW_MAX && N.renewFails < 6;
}

// 房号续期：新建一个房间、关掉旧的，回调 onCode。房主的 pc 这时还没发过 offer，可以接着用
async function renewRoom(why) {
  if (N.renewing || !hostWaiting()) return;
  N.renewing = true;
  const gen = N.gen, old = N.code;
  try {
    const d = await api('create', {}, { name: N.wireName || (cleanName(N.myName, MAX_NAME - 1) + CAMP_TAG) });
    if (gen !== N.gen) { closeRoom(d.code); return; }
    // 等新房号的这一会儿有人进了旧房间：留着旧的
    if (N.peerJoined || N.connected || N.code !== old) { closeRoom(d.code); return; }
    Object.assign(N, { code: d.code, since: 0, createdAt: Date.now(), pendingIce: [], offerSent: false, renewFails: 0, renewRetryAt: 0 });
    if (why === 'gone') N.goneRenews.push(Date.now());
    closeRoom(old);
    saveHint();
    hook('onCode', d.code);
    emit('code', d.code);
    if (N.statusTimer) N.statusTimer.kick();
  } catch (err) {
    if (gen !== N.gen) return;
    N.renewFails++;
    N.renewRetryAt = Date.now() + RENEW_RETRY_MS;
    console.warn('[net] 房号续期失败，稍后再试', why, err && err.code);
    // 旧房间已经没了、新的又建不出来（不是网络抖动）：报错，不悄悄挂着一个没人能进的营地
    if (why === 'gone' && !transient(err)) { N.renewing = false; fatal(err); }
  } finally {
    if (gen === N.gen) N.renewing = false;
  }
}

// 房主等人超过 2 分钟后放慢
function hostSlow() { return hostWaiting() && !N.rejoin && Date.now() - N.hostSince > SLOW_AFTER_MS; }
function pollMs() { return hostSlow() ? SLOW_MS : POLL_MS; }
function statusMs() { return hostSlow() ? SLOW_MS : STATUS_MS; }

function startPolling() {
  stopPolling();
  N.lastPollAt = Date.now();
  const gen = N.gen;
  N.pollTimer = loop(pollMs, gen, async () => {
    const code = N.code;
    let d;
    try { d = await api('poll', { code, me: N.role, since: N.since }); }
    catch (err) { if (gen !== N.gen || code !== N.code) return; throw err; }   // 续期前发出的旧房号请求
    if (gen !== N.gen || code !== N.code) return;
    N.lastPollAt = Date.now();
    if (isFinite(+d.last)) N.since = +d.last;
    for (const m of (d.msgs || [])) {
      if (gen !== N.gen || code !== N.code) return;
      // SDP 出错不算网络失败，记日志继续
      try { await onSignal(m); } catch (err) { console.warn('[net] 处理信令出错', m && m.t, err); }
    }
    // P2P 通了就不再轮询信令
    if (N.connected) stopPolling();
  });
}
function stopPolling() { if (N.pollTimer) { N.pollTimer.stop(); N.pollTimer = 0; } }

// 房主：等人进房；顺带做房号续期
function startStatusWait() {
  stopStatusWait();
  const gen = N.gen;
  N.statusTimer = loop(statusMs, gen, async () => {
    const code = N.code;
    let s;
    try { s = await api('status', { code }); }
    catch (err) { if (gen !== N.gen || code !== N.code) return; throw err; }
    if (gen !== N.gen || code !== N.code) return;
    if (s.state === 'joined') onGuestJoined(s.guest_name);
    else if (s.state === 'closed') throw netError('room_closed');
    else if (!N.rejoin && !N.renewing && Date.now() - N.createdAt >= renewMs() && Date.now() >= N.renewRetryAt) renewRoom('age');
  });
}
function stopStatusWait() { if (N.statusTimer) { N.statusTimer.stop(); N.statusTimer = 0; } }

// 客机：进房后等房主的第一条 offer。6 s 没到 → 'waitHost'；90 s 没到 → host_silent。
// 一直到连通都顺带看房间：房主关了营地 → room_closed（收到 offer 以后房主连通时会关原房间，所以那之后要连着 5 s 都是 closed 才算）
function startGuestWait() {
  clearWaitTimers();
  stopStatusWait();
  const gen = N.gen;
  N.graceTimer = setTimeout(() => {
    N.graceTimer = 0;
    if (gen !== N.gen || N.gotOffer || N.connected) return;
    N.waitingHost = true;
    netPhase('waitHost');
  }, WAIT_HOST_GRACE_MS);
  armDeadline('silentTimer', HOST_SILENT_MS, () => {
    if (gen === N.gen && !N.gotOffer && !N.connected) lost('host_silent');
  }, true);
  let closedSince = 0;
  N.statusTimer = loop(GUEST_STATUS_MS, gen, async () => {
    if (N.connected) { stopStatusWait(); return; }
    const code = N.code;
    const s = await api('status', { code });
    if (gen !== N.gen || code !== N.code || N.connected) return;
    if (s.state !== 'closed') { closedSince = 0; return; }
    if (!N.gotOffer) throw netError('room_closed');
    if (!closedSince) closedSince = Date.now();
    else if (Date.now() - closedSince >= 5000) throw netError('room_closed');
  });
}
function clearWaitTimers() {
  if (N.graceTimer) { clearTimeout(N.graceTimer); N.graceTimer = 0; }
  if (N.silentTimer) { clearTimeout(N.silentTimer); N.silentTimer = 0; }
}
function gotFirstOffer() {
  N.gotOffer = true;
  N.waitingHost = false;
  clearWaitTimers();
  armConnectTimeout();
  netPhase('connecting');
}
// 房主：客机进房后等它的 answer。客机刚点完「加入」就切去微信报信，页面被挂起，answer 要等它回来；
// 和客机等房主对称：6 s 没到 → 'waitGuest'；90 s 没到 → guest_silent。answer 到了才按 30 s 判打洞失败
function startAnswerWait() {
  clearWaitTimers();
  const gen = N.gen;
  N.gotAnswer = false;
  N.graceTimer = setTimeout(() => {
    N.graceTimer = 0;
    if (gen !== N.gen || N.gotAnswer || N.connected) return;
    netPhase('waitGuest');
  }, WAIT_HOST_GRACE_MS);
  armDeadline('silentTimer', HOST_SILENT_MS, () => {
    if (gen === N.gen && !N.gotAnswer && !N.connected) lost('guest_silent');
  }, true);
}
function gotFirstAnswer() {
  N.gotAnswer = true;
  clearWaitTimers();
  armConnectTimeout();
  if (N.phase === 'waitGuest') netPhase('connecting');
}

// ---------- 备用房号（掉线重连用） ----------
function spareCreate() {
  if (!N.active || N.role !== 'host') return Promise.reject(netError('not_host'));
  if (N.sparePending) return N.sparePending;
  const gen = N.gen;
  const p = (async () => {
    const d = await api('create', {}, { name: N.wireName || (cleanName(N.myName, MAX_NAME - 1) + CAMP_TAG) });
    if (gen !== N.gen) { closeRoom(d.code); throw netError('cancelled'); }
    const old = N.spare;
    N.spare = { code: d.code, at: Date.now() };
    N.spareRetryAt = 0;
    if (old && old.code !== d.code) closeRoom(old.code);
    hook('onSpare', d.code);
    emit('spare', d.code);
    return d.code;
  })();
  N.sparePending = p;
  const clear = () => { if (N.sparePending === p) N.sparePending = null; };
  p.then(clear, clear);
  return p;
}
function checkSpare() {
  if (!N.active || !N.connected || N.role !== 'host' || N.sparePending) return;
  // 连接正在抖（客机可能已经拿着旧备用房号去重连了）：这时别换号
  const st = N.pc && (N.pc.connectionState || N.pc.iceConnectionState);
  // （数据通道刚打开时 connectionState 可能还写着 connecting，那不算抖）
  if (st === 'disconnected' || st === 'failed') return;
  const now = Date.now();
  if (now < N.spareRetryAt) return;
  if (N.spare && now - N.spare.at < spareMs()) return;
  spareCreate().catch(err => {
    if (err && err.code === 'cancelled') return;
    N.spareRetryAt = Date.now() + SPARE_RETRY_MS;
    console.warn('[net] 备用房号没建成，稍后再试', err && err.code);
  });
}
function startSpareWatch() {
  stopSpareWatch();
  N.spareTimer = setInterval(checkSpare, SPARE_CHECK_MS);
  checkSpare();
}
function stopSpareWatch() { if (N.spareTimer) { clearInterval(N.spareTimer); N.spareTimer = 0; } }
function closeSpare() {
  if (N.orphanTimer) { clearTimeout(N.orphanTimer); N.orphanTimer = 0; }
  if (N.spare) { closeRoom(N.spare.code); N.spare = null; }
}
// 掉线后备用房号先留着等 reconnectHost；coop 一直没来认领（或忘了 leave），过一阵自己关掉
function armOrphan() {
  if (N.orphanTimer) clearTimeout(N.orphanTimer);
  N.orphanTimer = setTimeout(() => {
    N.orphanTimer = 0;
    if (!N.active && N.spare) closeSpare();
  }, reconnectMs() + 30000);
}

// ---------- WebRTC ----------
function setupPeer(isHost) {
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');
  const gen = N.gen;
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  N.pc = pc;
  pc.onicecandidate = e => {
    if (e.candidate && gen === N.gen) sendSignal({ t: 'ice', c: e.candidate, sid: wantSid() || undefined }).catch(() => {});
  };
  pc.onconnectionstatechange = () => { if (gen === N.gen) onPcState(); };
  pc.oniceconnectionstatechange = () => { if (gen === N.gen) onPcState(); };   // 老 Firefox 没有 connectionState
  pc.ontrack = e => { if (gen === N.gen) attachRemote(e); };
  if (isHost) {
    N.localSid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    // 先占一条收发音频的通道：之后开麦用 replaceTrack 填轨道，不必重新协商
    try { N.audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch (err) { N.audioTx = null; }
    bindChannel(pc.createDataChannel('game', { ordered: true }));
  } else {
    pc.ondatachannel = e => { if (gen === N.gen) bindChannel(e.channel); };
  }
}

function onPcState() {
  const pc = N.pc;
  if (!pc) return;
  const st = pc.connectionState || pc.iceConnectionState;
  if (st === 'connected' || st === 'completed') {
    if (N.discTimer) { clearTimeout(N.discTimer); N.discTimer = 0; }
  } else if (st === 'failed') {
    lost(N.connected ? 'lost' : 'p2p_failed');
  } else if (st === 'disconnected' && N.connected && !N.discTimer) {
    const gen = N.gen;
    armDeadline('discTimer', DISC_GRACE_MS, () => {
      if (gen !== N.gen || !N.pc) return;
      const s = N.pc.connectionState || N.pc.iceConnectionState;
      if (s === 'disconnected' || s === 'failed') lost('lost');
    });
  }
}

function bindChannel(dc) {
  const gen = N.gen;
  N.dc = dc;
  dc.onopen = () => {
    if (gen !== N.gen) return;
    N.connected = true;
    if (N.connectTimer) { clearTimeout(N.connectTimer); N.connectTimer = 0; }
    stopStatusWait();
    clearWaitTimers();
    N.waitingHost = false;
    N.rejoin = false;
    N.deadline = 0;
    netPhase('connected');
    emit('connected');
    if (gen !== N.gen || N.role !== 'host') return;
    // 连通后原房间（已经是 joined，谁也进不来了）关掉；另建一个备用房号给掉线重连用
    if (N.code && !N.codeClosed) { N.codeClosed = true; closeRoom(N.code); }
    startSpareWatch();
  };
  dc.onclose = () => { if (gen === N.gen && N.active) lost(N.connected ? 'lost' : 'p2p_failed'); };
  dc.onmessage = e => {
    if (gen !== N.gen) return;
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m && typeof m === 'object') handlePeerMessage(m);
  };
}

// 游戏语义全交给 coop.js；bye 在这一层处理，免得随后的通道关闭再报一次断线。
// 软 bye（客机关页面/刷新时发）：人可能马上回来，按掉线处理，房主留着备用房号等重连
function handlePeerMessage(m) {
  if (m.t === 'bye') {
    if (m.soft) { lost('lost', { byPeer: true }); return; }
    teardown(false);
    emit('peerLeft');
    return;
  }
  emit('msg', m);
}

function lost(reason, extra) {
  if (!N.active) return;
  const wasConnected = N.connected, isHost = N.role === 'host';
  // 重连这一轮没成（打洞失败、对方没应答）：房间留着，coop 在 reconnectSec 内还会用同一个备用房号再试
  teardown(false, { keepSpare: true, keepRoom: N.rejoin && !wasConnected });
  const spare = isHost && N.spare ? N.spare.code : null;
  emit('disconnected', Object.assign({ reason, wasConnected, spare }, extra || null));
}

function armConnectTimeout() {
  const gen = N.gen;
  armDeadline('connectTimer', CONNECT_TIMEOUT_MS, () => {
    if (gen === N.gen && !N.connected) lost('p2p_failed');
  }, true);
}

function attachRemote(e) {
  if (!e.track || e.track.kind !== 'audio') return;
  let stream = e.streams && e.streams[0];
  if (!stream && typeof MediaStream === 'function') stream = new MediaStream([e.track]);   // 对端 transceiver 没绑 stream
  if (!stream) return;
  N.remoteStream = stream;
  if (!N.remoteAudio) {
    const a = document.createElement('audio');
    a.autoplay = true;
    a.setAttribute('playsinline', '');
    N.remoteAudio = a;
  }
  N.remoteAudio.srcObject = stream;
  // 每条新流都从「不静音、按设定音量」开始：coop 收到 'remoteStream' 后接好 GainNode 才会再静音（接不上就照常用 <audio> 播）
  N.remoteAudio.muted = false;
  applyRemoteVolume();
  resumeAudio();
  emit('remoteStream', stream);
}

function applyRemoteVolume() {
  const a = N.remoteAudio;
  if (!a) return;
  try { a.volume = N.remoteVolume; } catch (err) { /* 老内核越界会抛，值已经夹过 */ }
}
function setRemoteVolume(v) {
  v = +v;
  N.remoteVolume = isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  applyRemoteVolume();
  return N.remoteVolume;
}
// coop 把对方语音改走 GainNode 时静音 <audio>（它还得接着播：Chrome 里远端流不挂在播放中的媒体元素上，WebAudio 收不到数据）
function setRemoteMuted(on) {
  if (N.remoteAudio) N.remoteAudio.muted = !!on;
}

// 自动播放被拦时，coop 在下一次用户手势里再调一次
function resumeAudio() {
  const a = N.remoteAudio;
  if (!a || !a.srcObject || !a.paused) return;
  try {
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) { /* 老内核 play() 不返回 Promise */ }
}

async function flushIce() {
  const pc = N.pc, buf = N.pendingIce, want = wantSid();
  N.pendingIce = [];
  for (const x of buf) {
    if (x.sid && want && x.sid !== want) continue;
    try { await pc.addIceCandidate(x.c); } catch (err) { /* 过期候选 */ }
  }
}

// 客机：把对方 offer 里的音频通道改成收发，应答里才会带上"我也会发"，之后开麦不用重新协商
function prepareGuestAudio(pc) {
  if (typeof pc.getTransceivers !== 'function') return;
  const tx = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
  if (!tx) return;
  try { tx.direction = 'sendrecv'; N.audioTx = tx; } catch (err) { N.audioTx = null; }
}

// 每条 offer / answer / ice 都带 sid（房主这一个 pc 的编号，answer 和客机的 ice 回带同一个）：重连时同一个房间里
// 可能还留着上一次没连成的信令，sid 对不上的一律不理；客机收到一条新 sid 的 offer，就换一个新 pc 按新的来
function wantSid() { return N.role === 'host' ? N.localSid : N.remoteSid; }
async function onSignal(m) {
  let pc = N.pc;
  if (!pc || !m) return;
  if (m.t === 'offer' && N.role === 'guest') {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      if (N.connected || !m.sid || m.sid === N.remoteSid) return;   // 重复投递
      rebuildGuestPeer();   // 房主那边重来了一遍（重连时上一轮没连成）
      pc = N.pc;
    }
    N.remoteSid = m.sid || null;
    // 房主回来了：从这一刻起才按 30 s 判打洞失败
    if (!N.gotOffer) gotFirstOffer(); else armConnectTimeout();
    const gen = N.gen;
    await pc.setRemoteDescription(m.sdp);
    if (gen !== N.gen || pc !== N.pc) return;
    prepareGuestAudio(pc);
    await flushIce();
    const ans = await pc.createAnswer();
    if (gen !== N.gen || pc !== N.pc) return;
    await pc.setLocalDescription(ans);
    await sendSignal({ t: 'answer', sdp: ans, sid: N.remoteSid || undefined });
  } else if (m.t === 'answer' && N.role === 'host') {
    if (m.sid && m.sid !== N.localSid) return;   // 回的是上一轮的 offer
    if (!pc.currentRemoteDescription && pc.signalingState === 'have-local-offer') {
      if (!N.gotAnswer) gotFirstAnswer();
      await pc.setRemoteDescription(m.sdp);
      await flushIce();
    }
  } else if (m.t === 'ice') {
    const want = wantSid();
    if (m.sid && want && m.sid !== want) return;   // 上一轮的候选
    // 远端描述还没设好时直接 add 会抛错，先缓冲
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try { await pc.addIceCandidate(m.c); } catch (err) { /* 过期候选 */ }
    } else {
      N.pendingIce.push({ c: m.c, sid: m.sid || null });
    }
  } else if (m.t === 'joined' && N.role === 'host') {
    onGuestJoined(m.name);
  }
}

// 客机换 pc：旧的回调全摘掉再关，免得它的 close 被当成掉线
function rebuildGuestPeer() {
  const old = N.pc, odc = N.dc;
  if (odc) { odc.onopen = odc.onclose = odc.onmessage = null; }
  if (old) {
    old.onicecandidate = old.ontrack = old.onconnectionstatechange = old.oniceconnectionstatechange = old.ondatachannel = null;
    try { old.close(); } catch (err) { /* 已关闭 */ }
  }
  Object.assign(N, { pc: null, dc: null, audioTx: null, pendingIce: [], remoteSid: null });
  setupPeer(false);
}

// status 轮询和 'joined' 信令都可能先到，只处理一次
function onGuestJoined(name) {
  if (N.role !== 'host') return;
  if (!N.peerJoined) {
    N.peerJoined = true;
    N.peerName = cleanName(name || '对方');
    stopStatusWait();
    emit('peerJoined', N.peerName);
    startAnswerWait();
    netPhase('connecting');
  }
  hostOffer();
}

async function hostOffer() {
  const pc = N.pc;
  if (!pc || N.offerSent || pc.signalingState !== 'stable') return;
  N.offerSent = true;
  const gen = N.gen;
  try {
    const offer = await pc.createOffer();
    if (gen !== N.gen) return;
    await pc.setLocalDescription(offer);
    await sendSignal({ t: 'offer', sdp: offer, sid: N.localSid });
  } catch (err) {
    if (gen !== N.gen) return;
    N.offerSent = false;   // 允许下一次 status 轮询重试
    console.warn('[net] 发 offer 失败，稍后重试', err);
  }
}

// ---------- 麦克风 ----------
function micErrCode(err) {
  if (err && err.code) return err.code;
  const n = err && err.name;
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'mic_denied';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'mic_notfound';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'mic_busy';
  if (n === 'SecurityError') return 'mic_insecure';
  return 'mic_failed';
}

async function ensureMic() {
  if (N.micTrack && N.micTrack.readyState === 'live') return N.micTrack;
  if (N.micPending) return N.micPending;
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    throw netError(window.isSecureContext === false ? 'mic_insecure' : 'mic_unsupported');
  }
  const gen = N.gen;
  N.micPending = (async () => {
    const gum = md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let timer = 0, timedOut = false;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(netError('mic_timeout')); }, MIC_TIMEOUT_MS); });
    let stream;
    try {
      stream = await Promise.race([gum, timeout]);
    } catch (err) {
      // 超时后用户才点允许：拿到的流立刻停掉，别让录音指示灯亮着
      if (timedOut) gum.then(stopStream, () => {});
      throw netError(micErrCode(err));
    } finally {
      clearTimeout(timer);
    }
    if (gen !== N.gen) { stopStream(stream); throw netError('cancelled'); }
    const track = stream.getAudioTracks()[0];
    if (!track) { stopStream(stream); throw netError('mic_notfound'); }
    track.enabled = false;
    try {
      await N.audioTx.sender.replaceTrack(track);
    } catch (err) {
      stopStream(stream);
      throw netError('mic_unsupported');
    }
    if (gen !== N.gen) { stopStream(stream); throw netError('cancelled'); }
    N.localStream = stream;
    N.micTrack = track;
    // 拔掉耳机麦、系统收回权限：轨道结束，界面要跟着变回闭麦
    track.onended = () => {
      if (N.micTrack !== track) return;
      N.micTrack = null;
      N.localStream = null;
      N.micOn = false;
      emit('mic', false);
    };
    emit('localStream', stream);
    return track;
  })();
  try { return await N.micPending; } finally { N.micPending = null; }
}

// 开麦/闭麦切换：只启用/禁用音轨，流保留到退出联机，免得每次开麦都重新弹权限
async function setMic(on) {
  on = !!on;
  N.micWant = on;
  if (!on) {
    N.micOn = false;
    if (N.micTrack) N.micTrack.enabled = false;
    return false;
  }
  if (!N.active || !N.pc || !N.connected) throw netError('mic_noconn');
  if (!N.audioTx || !N.audioTx.sender || typeof N.audioTx.sender.replaceTrack !== 'function') throw netError('mic_unsupported');
  const track = await ensureMic();
  // 等权限期间可能已经点了闭麦
  if (!N.micWant || track !== N.micTrack) { track.enabled = false; N.micOn = false; return false; }
  track.enabled = true;
  N.micOn = true;
  return true;
}

// ---------- 收发与生命周期 ----------
function send(obj, opts) {
  const dc = N.dc;
  if (!dc || dc.readyState !== 'open') return false;
  if (opts && opts.lossy && dc.bufferedAmount > LOSSY_BUFFER) return false;
  try { dc.send(JSON.stringify(obj)); return true; } catch (err) { return false; }
}

// opts.keepSpare：掉线时备用房号留着等重连；opts.soft：发软 bye；opts.keepHint：刷新后还要用昵称
function teardown(sendBye, opts) {
  const o = opts || {};
  N.gen++;
  const pc = N.pc, dc = N.dc, code = N.code, wasActive = N.active, codeClosed = N.codeClosed, role = N.role, createdAt = N.createdAt;
  let byeSent = false;
  if (sendBye && dc && dc.readyState === 'open') {
    try { dc.send(JSON.stringify(o.soft ? { t: 'bye', soft: true } : { t: 'bye' })); byeSent = true; } catch (err) { /* 通道已坏 */ }
  }
  stopPolling();
  stopStatusWait();
  stopSpareWatch();
  clearWaitTimers();
  if (N.connectTimer) clearTimeout(N.connectTimer);
  if (N.discTimer) clearTimeout(N.discTimer);
  if (dc) { dc.onopen = dc.onclose = dc.onmessage = null; }
  if (pc) {
    pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = pc.oniceconnectionstatechange = pc.ondatachannel = null;
  }
  // 立刻关 pc 会丢掉还在缓冲里的 bye，稍等一下再关
  const closeAll = () => {
    try { if (dc) dc.close(); } catch (err) { /* 已关闭 */ }
    try { if (pc) pc.close(); } catch (err) { /* 已关闭 */ }
  };
  if (byeSent) setTimeout(closeAll, 200); else closeAll();
  stopStream(N.localStream);
  if (N.remoteAudio) {
    try { N.remoteAudio.pause(); } catch (err) { /* 忽略 */ }
    N.remoteAudio.srcObject = null;
  }
  if (code && wasActive && !codeClosed) {
    // keepRoom：房主把它放回备用房号（leave / 过期照样关掉）；客机不关，留给下一次重连
    if (o.keepRoom) { if (role === 'host' && !(N.spare && N.spare.code === code)) { closeSpare(); N.spare = { code, at: createdAt || Date.now() }; } }
    else closeRoom(code);
  }
  if (o.keepSpare && N.spare) armOrphan(); else closeSpare();
  Object.assign(N, {
    active: false, connected: false, phase: 'idle', role: null, code: null, peerName: '', peerJoined: false,
    pc: null, dc: null, audioTx: null, connectTimer: 0, discTimer: 0, graceTimer: 0, silentTimer: 0,
    since: 0, pendingIce: [], offerSent: false, gotOffer: false, waitingHost: false, gotAnswer: false,
    localSid: null, remoteSid: null,
    rejoin: false, deadline: 0, codeClosed: false, renewing: false, renewRetryAt: 0, renewFails: 0,
    sparePending: null, spareRetryAt: 0,
    localStream: null, micTrack: null, micOn: false, micWant: false, micPending: null, remoteStream: null,
  });
  if (!o.keepHint) clearHint();
}

async function createRoom(name, hooks) {
  if (N.active || N.spare) teardown(true);
  N.hooks = hooks && typeof hooks === 'object' ? hooks : null;
  // 和 joinRoom 一样先查：不然会先在服务器上建好房，到 setupPeer 才失败再关房
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');
  const gen = N.gen;
  N.myName = cleanName(name, MAX_NAME - 1);
  N.wireName = N.myName + CAMP_TAG;
  const d = await api('create', {}, { name: N.wireName });
  if (gen !== N.gen) {
    closeRoom(d.code);   // 等待期间点了取消：服务器上的空房顺手关掉
    throw netError('cancelled');
  }
  const now = Date.now();
  Object.assign(N, { code: d.code, role: 'host', active: true, connected: false, since: 0,
    offerSent: false, pendingIce: [], peerName: '', peerJoined: false,
    createdAt: now, hostSince: now, codeClosed: false, rejoin: false, deadline: 0, goneRenews: [] });
  try { setupPeer(true); } catch (err) { teardown(false); throw err; }
  startPolling();
  startStatusWait();
  saveHint();
  netPhase('hosting');
  return d.code;
}

// 客机进房：joinRoom 和 reconnectGuest 共用
async function guestConnect(code, name, rejoin) {
  const gen = N.gen;
  const c = normCode(code);
  if (c.length !== 6) throw netError('bad_code');
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');   // 先查，别占了房主的房间再失败
  N.myName = cleanName(name);
  const deadline = rejoin ? Date.now() + reconnectMs() : 0;
  netPhase('joining');
  // 先复查一次：closed 的房间真服务器照样让 join（会把它改回 joined），不能去占
  const info = describe(await retrying(() => api('status', { code: c }), deadline, gen));
  if (gen !== N.gen) throw netError('cancelled');
  if (info.state === 'closed') throw netError('room_closed');
  if (!info.isCamp) throw netError('not_camp');
  let skipJoin = false;
  if (info.state === 'joined') {
    // 重连时上一次 join 其实成功了、只是回包丢了：服务器上的客人就是我
    if (rejoin && info.guestName === N.myName) skipJoin = true;
    else throw netError('room_full');
  }
  let hostRaw = info.raw;
  if (!skipJoin) {
    let d;
    try {
      d = await retrying(() => api('join', { code: c }, { name: N.myName }), deadline, gen);
    } catch (err) {
      if (!(rejoin && err && err.code === 'room_full' && gen === N.gen)) throw err;
      const again = describe(await api('status', { code: c }));
      if (gen !== N.gen) throw netError('cancelled');
      if (again.state !== 'joined' || again.guestName !== N.myName) throw err;
      d = { host: again.raw };
    }
    if (gen !== N.gen) {
      closeRoom(c);
      throw netError('cancelled');
    }
    if (d && d.host != null) hostRaw = String(d.host);
    // 复查之后房号被别人重用（极少）：不是营地就不连；别人的房间也不替他关
    if (!isCampName(hostRaw)) throw netError('not_camp');
  }
  Object.assign(N, { code: c, role: 'guest', active: true, connected: false, since: 0,
    offerSent: false, pendingIce: [], peerName: cleanName(stripTag(hostRaw) || '房主'), peerJoined: true,
    gotOffer: false, waitingHost: false, rejoin: !!rejoin, deadline, codeClosed: false });
  try { setupPeer(false); } catch (err) { teardown(true); throw err; }
  startPolling();
  startGuestWait();
  saveHint();
  try {
    await sendSignal({ t: 'joined', name: N.myName });
  } catch (err) {
    // 房主那边的 status 轮询也能发现有人进来，这条失败不致命
    if (gen === N.gen) console.warn('[net] joined 信令发送失败', err);
  }
  return { hostName: N.peerName, isCamp: true, code: c };
}

async function joinRoom(code, name, hooks) {
  if (N.active || N.spare) teardown(true);
  N.hooks = hooks && typeof hooks === 'object' ? hooks : null;
  return guestConnect(code, name, false);
}

// 客机重连：加入房主发来的备用房号。服务器请求失败会一直重试到 reconnectSec
async function reconnectGuest(code, hooks) {
  if (N.active || N.spare) teardown(false, { keepRoom: N.active && N.role === 'guest' && N.code === normCode(code) });
  let name = null;
  if (typeof hooks === 'string') name = hooks;
  else if (hooks && typeof hooks === 'object') { N.hooks = hooks; if (hooks.name != null) name = hooks.name; }
  if (name == null || !String(name).trim()) name = N.myName || ((readHint() || {}).name) || '';
  return guestConnect(code, name, true);
}

// 房主重连：回到备用房里等客机（不传 code 就用自己留着的备用房号）
async function reconnectHost(code, hooks) {
  if (hooks && typeof hooks === 'object') N.hooks = hooks;
  const c = normCode(code || (N.spare && N.spare.code));
  if (c.length !== 6) throw netError('bad_code');
  if (N.active) teardown(false, { keepSpare: true, keepRoom: N.code === c });
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');
  if (N.orphanTimer) { clearTimeout(N.orphanTimer); N.orphanTimer = 0; }
  // 备用房号从此就是当前房间：连上后照常关掉它、再建下一个备用
  let at = Date.now();
  if (N.spare && N.spare.code === c) { at = N.spare.at; N.spare = null; }
  else closeSpare();
  if (!N.wireName) N.wireName = cleanName(N.myName, MAX_NAME - 1) + CAMP_TAG;
  const now = Date.now();
  Object.assign(N, { code: c, role: 'host', active: true, connected: false, since: 0,
    offerSent: false, pendingIce: [], peerName: '', peerJoined: false,
    createdAt: at, hostSince: now, codeClosed: false, rejoin: true, deadline: now + reconnectMs(), goneRenews: [] });
  try { setupPeer(true); } catch (err) { teardown(false); throw err; }
  startPolling();
  startStatusWait();
  saveHint();
  netPhase('hosting');
  return c;
}

function roomInfo(code) {
  const c = normCode(code);
  if (c.length !== 6) return Promise.reject(netError('bad_code'));
  return api('status', { code: c }).then(d => {
    const r = describe(d);
    delete r.raw;
    return r;
  });
}

// 主动离开：发 bye、关掉当前房间和备用房间（掉线后还没重连时调也行）
function leave() { teardown(true); }

// 会话提示：刷新后大厅能预填上次的房号/昵称（连接本身无法跨刷新保留）
function saveHint() {
  try { sessionStorage.setItem(HINT_KEY, JSON.stringify({ code: N.code, role: N.role, name: N.myName })); } catch (err) { /* 存不了就算了 */ }
}
function readHint() {
  try { const r = sessionStorage.getItem(HINT_KEY); return r ? JSON.parse(r) : null; } catch (err) { return null; }
}
function clearHint() {
  try { sessionStorage.removeItem(HINT_KEY); } catch (err) { /* 忽略 */ }
}

// 回到前台 / 页面从冻结恢复 / 网络恢复：立刻查一次，不等下一拍（房主切到微信发完房号回来，客机正等着）
function wake() {
  if (N.statusTimer) N.statusTimer.kick();
  if (N.pollTimer && !N.connected) N.pollTimer.kick();
  if (N.connected && N.role === 'host') checkSpare();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
document.addEventListener('resume', wake);   // Page Lifecycle：frozen → active
window.addEventListener('online', wake);

// 关页面时尽量通知对方，对方不必等 ICE 超时才知道人走了；
// 同时告诉 coop.js 连接没了：页面万一从往返缓存恢复，不会卡在"联机中、实体不归本机管"的状态。
// 客机发软 bye（多半是刷新，马上会从「回去？」卡片连回来），房主照掉线处理、在备用房里等；
// 房主刷新以后接不回原来的局，发普通 bye 并关掉备用房，客机立刻知道
window.addEventListener('pagehide', () => {
  if (!N.active && !N.spare) return;
  const was = N.connected, act = N.active;
  // 客机正在重连（备用房是房主的）：别替房主关掉，刷新回来还要用
  if (N.role === 'guest') teardown(true, { soft: true, keepHint: true, keepRoom: N.rejoin });
  else teardown(true);
  if (act) emit('disconnected', { reason: 'closed', wasConnected: was, spare: null });
});

BR.net = {
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  off(fn) { listeners.delete(fn); },
  available() { return !!signalUrl() && typeof RTCPeerConnection === 'function'; },
  createRoom, joinRoom, roomInfo, leave, send, setMic, resumeAudio, errorText,
  setRemoteVolume, setRemoteMuted,
  spareCreate, reconnectHost, reconnectGuest,
  readHint, clearHint,
  CAMP_TAG, stripTag, isCampName,
  get active() { return N.active; },
  get connected() { return N.connected; },
  get role() { return N.role; },
  get code() { return N.code; },
  get spare() { return N.spare ? N.spare.code : null; },
  get phase() { return N.phase; },
  get waitingHost() { return N.waitingHost; },
  get gotOffer() { return N.gotOffer; },
  get myName() { return N.myName; },
  get peerName() { return N.peerName; },
  get micOn() { return N.micOn; },
  get micPending() { return !!N.micPending; },
  get localStream() { return N.localStream; },
  get remoteStream() { return N.remoteStream; },
  // 对方语音已接上却没在播（自动播放被拦着）：coop.js 据此把说话角标换成"轻触收听"
  get remotePaused() { return !!N.remoteAudio && !!N.remoteAudio.srcObject && N.remoteAudio.paused; },
  get remoteVolume() { return N.remoteVolume; },
  get volumeWorks() { return VOLUME_WORKS; },
  // 测试用：看内部状态；_debugAge(ms) 把建房 / 等人 / 备用房号的时间往前推 ms 毫秒（「快进到 110 分钟」不必动时钟）
  _debug() {
    const now = Date.now();
    return {
      role: N.role, code: N.code, spare: N.spare ? N.spare.code : null, active: N.active, connected: N.connected,
      phase: N.phase, gotOffer: N.gotOffer, waitingHost: N.waitingHost, rejoin: N.rejoin, codeClosed: N.codeClosed,
      roomAgeMs: N.createdAt ? now - N.createdAt : 0, hostWaitMs: N.hostSince ? now - N.hostSince : 0,
      spareAgeMs: N.spare ? now - N.spare.at : 0, statusMs: statusMs(), pollMs: pollMs(), renewing: N.renewing,
      // 对方语音 <audio> 的实际状态（它不挂在 DOM 上，测试只能从这里看）
      audio: N.remoteAudio ? { volume: N.remoteAudio.volume, muted: N.remoteAudio.muted, paused: N.remoteAudio.paused, stream: !!N.remoteAudio.srcObject } : null,
    };
  },
  _debugAge(ms) {
    ms = +ms || 0;
    if (N.createdAt) N.createdAt -= ms;
    if (N.hostSince) N.hostSince -= ms;
    if (N.spare) N.spare.at -= ms;
    wake();
  },
};
})();
