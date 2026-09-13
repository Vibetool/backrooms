// 后室 · 联机网络层：信令走 room.php（和火箭发射共用后端与房号段），接通后游戏消息和语音全部 P2P（WebRTC）
// 只管建连、收发、麦克风；hello 校验、同步、UI 都在 coop.js。接口：
//   BR.net.on(fn(type, data)) → 取消订阅
//     'status' 文案 | 'peerJoined' 对方昵称 | 'connected' | 'disconnected' { reason, wasConnected }
//     'peerLeft' | 'msg' 对方消息（除 bye 外全部） | 'error' { code, text, fatal }
//     'remoteStream' / 'localStream' MediaStream | 'mic' bool（麦克风被系统收回时）
//   createRoom(name) → 房号；joinRoom(code, name) → 房主昵称；roomInfo(code) → { state, host_name, guest_name }
//   send(obj, { lossy }) → bool；setMic(on) → Promise<bool>；leave()；errorText(code)
//   语音：建连时就协商一条收发音频的通道（不带轨道），开麦时才申请麦克风并 replaceTrack，不必重新协商
(function () {
'use strict';
const BR = window.BR;

const API_TIMEOUT_MS = 8000;
const POLL_MS = 1200;
const STATUS_MS = 1500;
const MAX_API_FAILS = 8;          // 连续失败这么多次（约 10 秒）就认定服务器不可达，停下来报错，不无限转圈
const CONNECT_TIMEOUT_MS = 30000; // 对方已进房但 P2P 迟迟不通：多半是 NAT 打洞失败，没有 TURN 兜底
const DISC_GRACE_MS = 6000;       // 'disconnected' 常是网络抖动，宽限期内恢复就不算断线
const MIC_TIMEOUT_MS = 20000;     // 部分内嵌浏览器权限弹窗不出现，Promise 会一直悬着
const LOSSY_BUFFER = 256 * 1024;  // 高频位置/快照在通道积压时直接丢，免得延迟越滚越大
const HINT_KEY = 'backrooms_net_hint';
const MAX_NAME = 16;               // 与 room.php 的截断长度一致

// 国内访问不到 Google STUN，放一个国内可达的在前
const DEFAULT_ICE = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const N = {
  gen: 0,             // 每次 teardown 自增：旧连接的异步回调靠它发现自己已过期
  active: false, connected: false,
  role: null, code: null, myName: '', peerName: '', peerJoined: false,
  pc: null, dc: null, audioTx: null,
  pollTimer: 0, statusTimer: 0, connectTimer: 0, discTimer: 0,
  since: 0, pendingIce: [], offerSent: false,
  localStream: null, micTrack: null, micOn: false, micWant: false, micPending: null,
  remoteStream: null, remoteAudio: null,
};
const listeners = new Set();

// ---------- 小工具 ----------
function emit(type, data) {
  for (const fn of Array.from(listeners)) {
    try { fn(type, data); } catch (err) { console.error('[net] 事件处理出错', type, err); }
  }
}
function netError(code, detail) {
  const e = new Error(code);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}
function cleanName(name) {
  const s = String(name == null ? '' : name).trim().slice(0, MAX_NAME);
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

const ERROR_TEXT = {
  no_api: '没有配置联机服务器地址（BR.config.roomApi）。',
  unreachable: '连不上联机服务器（room.php 不可达）。请检查网络后重试；如果是双击打开的本地文件，服务器会拒绝跨域请求，请用网页地址打开游戏。',
  timeout: '联机服务器响应超时，请稍后重试。',
  bad_response: '联机服务器返回了无法识别的内容，请稍后重试。',
  db_unavailable: '联机服务器暂时故障（数据库不可用），请稍后再试。',
  bad_code: '房号应为 6 位字母或数字。',
  room_not_found: '房间不存在，请核对房号。',
  room_full: '房间已满，已经有人加入了。',
  room_closed: '房间已关闭。',
  code_exhausted: '服务器暂时分配不出房号，请重试。',
  no_webrtc: '当前浏览器不支持 WebRTC，无法联机。请换用新版 Chrome / Edge / Safari。',
  p2p_failed: '和对方的点对点连接没有建立起来（常见于公司/校园网或运营商 NAT 限制）。请重试，或换个网络（比如手机热点）。',
  lost: '和对方的连接断开了。',
  closed: '连接已关闭。',
  mic_noconn: '还没和对方连上，暂时不能开麦。',
  mic_denied: '麦克风权限被拒绝。请在浏览器地址栏左侧的站点设置里允许使用麦克风，然后再点开麦。',
  mic_notfound: '没有找到可用的麦克风设备。',
  mic_busy: '麦克风被其他程序占用，打不开。',
  mic_insecure: '浏览器只允许在 https 或 localhost 页面使用麦克风，当前页面地址不满足。',
  mic_unsupported: '当前浏览器不支持联机语音。',
  mic_timeout: '麦克风权限请求没有响应，请检查浏览器是否拦截了权限弹窗。',
  mic_failed: '打开麦克风失败。',
};
function errorText(code) {
  if (!code) return '联机出错。';
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (/^http_\d+$/.test(code)) return '联机服务器出错（HTTP ' + code.slice(5) + '），请稍后再试。';
  return '联机出错：' + code;
}

// ---------- room.php ----------
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

function sendSignal(payload) {
  return api('signal', { code: N.code, to: N.role === 'host' ? 'guest' : 'host' }, { payload });
}

// 服务器连续不可达：停下来明确报错，而不是让界面一直显示"连接中"
function fatal(err) {
  const code = (err && err.code) || 'unreachable';
  teardown(true);
  emit('error', { code, text: errorText(code), fatal: true });
}

// 带失败计数的轮询；busy 防止慢服务器上请求叠加
function loop(ms, gen, fn) {
  let busy = false, fails = 0;
  return setInterval(async () => {
    if (busy || gen !== N.gen) return;
    busy = true;
    try {
      await fn();
      fails = 0;
    } catch (err) {
      if (gen !== N.gen) return;
      if (err && err.code === 'room_not_found' || err && err.code === 'room_closed') { fatal(err); return; }
      fails++;
      if (fails === 2) emit('status', '和联机服务器的通信不稳定，正在重试…');
      if (fails >= MAX_API_FAILS) fatal(err);
    } finally {
      busy = false;
    }
  }, ms);
}

function startPolling() {
  stopPolling();
  const gen = N.gen;
  N.pollTimer = loop(POLL_MS, gen, async () => {
    const d = await api('poll', { code: N.code, me: N.role, since: N.since });
    if (gen !== N.gen) return;
    N.since = d.last;
    for (const m of (d.msgs || [])) {
      if (gen !== N.gen) return;
      // SDP 出错不算网络失败，记日志继续
      try { await onSignal(m); } catch (err) { console.warn('[net] 处理信令出错', m && m.t, err); }
    }
    // P2P 通了就不再轮询信令
    if (N.connected) stopPolling();
  });
}
function stopPolling() { if (N.pollTimer) { clearInterval(N.pollTimer); N.pollTimer = 0; } }

function startStatusWait() {
  stopStatusWait();
  const gen = N.gen;
  N.statusTimer = loop(STATUS_MS, gen, async () => {
    const s = await api('status', { code: N.code });
    if (gen !== N.gen) return;
    if (s.state === 'joined') onGuestJoined(s.guest_name);
    else if (s.state === 'closed') throw netError('room_closed');
  });
}
function stopStatusWait() { if (N.statusTimer) { clearInterval(N.statusTimer); N.statusTimer = 0; } }

// ---------- WebRTC ----------
function setupPeer(isHost) {
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');
  const gen = N.gen;
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  N.pc = pc;
  pc.onicecandidate = e => {
    if (e.candidate && gen === N.gen) sendSignal({ t: 'ice', c: e.candidate }).catch(() => {});
  };
  pc.onconnectionstatechange = () => { if (gen === N.gen) onPcState(); };
  pc.oniceconnectionstatechange = () => { if (gen === N.gen) onPcState(); };   // 老 Firefox 没有 connectionState
  pc.ontrack = e => { if (gen === N.gen) attachRemote(e); };
  if (isHost) {
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
    N.discTimer = setTimeout(() => {
      N.discTimer = 0;
      if (gen !== N.gen || !N.pc) return;
      const s = N.pc.connectionState || N.pc.iceConnectionState;
      if (s === 'disconnected' || s === 'failed') lost('lost');
    }, DISC_GRACE_MS);
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
    emit('connected');
  };
  dc.onclose = () => { if (gen === N.gen && N.active) lost(N.connected ? 'lost' : 'p2p_failed'); };
  dc.onmessage = e => {
    if (gen !== N.gen) return;
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m && typeof m === 'object') handlePeerMessage(m);
  };
}

// 游戏语义全交给 coop.js；bye 在这一层处理，免得随后的通道关闭再报一次断线
function handlePeerMessage(m) {
  if (m.t === 'bye') {
    teardown(false);
    emit('peerLeft');
    return;
  }
  emit('msg', m);
}

function lost(reason) {
  if (!N.active) return;
  const wasConnected = N.connected;
  teardown(false);
  emit('disconnected', { reason, wasConnected });
}

function armConnectTimeout() {
  if (N.connectTimer) clearTimeout(N.connectTimer);
  const gen = N.gen;
  N.connectTimer = setTimeout(() => {
    N.connectTimer = 0;
    if (gen === N.gen && !N.connected) lost('p2p_failed');
  }, CONNECT_TIMEOUT_MS);
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
  resumeAudio();
  emit('remoteStream', stream);
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
  const pc = N.pc, buf = N.pendingIce;
  N.pendingIce = [];
  for (const c of buf) { try { await pc.addIceCandidate(c); } catch (err) { /* 过期候选 */ } }
}

// 客机：把对方 offer 里的音频通道改成收发，应答里才会带上"我也会发"，之后开麦不用重新协商
function prepareGuestAudio(pc) {
  if (typeof pc.getTransceivers !== 'function') return;
  const tx = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
  if (!tx) return;
  try { tx.direction = 'sendrecv'; N.audioTx = tx; } catch (err) { N.audioTx = null; }
}

async function onSignal(m) {
  const pc = N.pc;
  if (!pc || !m) return;
  if (m.t === 'offer' && N.role === 'guest') {
    if (pc.remoteDescription && pc.remoteDescription.type) return;   // 重复投递
    await pc.setRemoteDescription(m.sdp);
    prepareGuestAudio(pc);
    await flushIce();
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await sendSignal({ t: 'answer', sdp: ans });
  } else if (m.t === 'answer' && N.role === 'host') {
    if (!pc.currentRemoteDescription && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(m.sdp);
      await flushIce();
    }
  } else if (m.t === 'ice') {
    // 远端描述还没设好时直接 add 会抛错，先缓冲
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try { await pc.addIceCandidate(m.c); } catch (err) { /* 过期候选 */ }
    } else {
      N.pendingIce.push(m.c);
    }
  } else if (m.t === 'joined' && N.role === 'host') {
    onGuestJoined(m.name);
  }
}

// status 轮询和 'joined' 信令都可能先到，只处理一次
function onGuestJoined(name) {
  if (N.role !== 'host') return;
  if (!N.peerJoined) {
    N.peerJoined = true;
    if (!N.peerName) N.peerName = cleanName(name || '对方');
    stopStatusWait();
    emit('peerJoined', N.peerName);
    armConnectTimeout();
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
    await sendSignal({ t: 'offer', sdp: offer });
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

function teardown(sendBye) {
  N.gen++;
  const pc = N.pc, dc = N.dc, code = N.code, wasActive = N.active;
  let byeSent = false;
  if (sendBye && dc && dc.readyState === 'open') {
    try { dc.send(JSON.stringify({ t: 'bye' })); byeSent = true; } catch (err) { /* 通道已坏 */ }
  }
  stopPolling();
  stopStatusWait();
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
  if (code && wasActive) api('close', { code }).catch(() => {});
  Object.assign(N, {
    active: false, connected: false, role: null, code: null, peerName: '', peerJoined: false,
    pc: null, dc: null, audioTx: null, connectTimer: 0, discTimer: 0,
    since: 0, pendingIce: [], offerSent: false,
    localStream: null, micTrack: null, micOn: false, micWant: false, micPending: null, remoteStream: null,
  });
  clearHint();
}

async function createRoom(name) {
  if (N.active) teardown(true);
  const gen = N.gen;
  N.myName = cleanName(name);
  const d = await api('create', {}, { name: N.myName });
  if (gen !== N.gen) {
    api('close', { code: d.code }).catch(() => {});   // 等待期间点了取消：服务器上的空房顺手关掉
    throw netError('cancelled');
  }
  Object.assign(N, { code: d.code, role: 'host', active: true, connected: false, since: 0,
    offerSent: false, pendingIce: [], peerName: '', peerJoined: false });
  try { setupPeer(true); } catch (err) { teardown(false); throw err; }
  startPolling();
  startStatusWait();
  saveHint();
  return d.code;
}

async function joinRoom(code, name) {
  if (N.active) teardown(true);
  const gen = N.gen;
  const c = normCode(code);
  if (c.length !== 6) throw netError('bad_code');
  if (typeof RTCPeerConnection !== 'function') throw netError('no_webrtc');   // 先查，别占了房主的房间再失败
  N.myName = cleanName(name);
  const d = await api('join', { code: c }, { name: N.myName });
  if (gen !== N.gen) {
    api('close', { code: c }).catch(() => {});
    throw netError('cancelled');
  }
  Object.assign(N, { code: c, role: 'guest', active: true, connected: false, since: 0,
    offerSent: false, pendingIce: [], peerName: cleanName(d.host || '房主'), peerJoined: true });
  try { setupPeer(false); } catch (err) { teardown(true); throw err; }
  startPolling();
  armConnectTimeout();
  saveHint();
  try {
    await sendSignal({ t: 'joined', name: N.myName });
  } catch (err) {
    // 房主那边的 status 轮询也能发现有人进来，这条失败不致命
    console.warn('[net] joined 信令发送失败', err);
  }
  return N.peerName;
}

function roomInfo(code) {
  const c = normCode(code);
  if (c.length !== 6) return Promise.reject(netError('bad_code'));
  return api('status', { code: c }).then(d => ({ state: d.state, host_name: d.host_name, guest_name: d.guest_name }));
}

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

// 关页面时尽量通知对方，对方不必等 ICE 超时才知道人走了
window.addEventListener('pagehide', () => { if (N.active) teardown(true); });

BR.net = {
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  off(fn) { listeners.delete(fn); },
  available() { return !!signalUrl() && typeof RTCPeerConnection === 'function'; },
  createRoom, joinRoom, roomInfo, leave, send, setMic, resumeAudio, errorText,
  readHint, clearHint,
  get active() { return N.active; },
  get connected() { return N.connected; },
  get role() { return N.role; },
  get code() { return N.code; },
  get myName() { return N.myName; },
  get peerName() { return N.peerName; },
  get micOn() { return N.micOn; },
  get micPending() { return !!N.micPending; },
  get localStream() { return N.localStream; },
  get remoteStream() { return N.remoteStream; },
};
})();
