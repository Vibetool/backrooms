// 后室 · 联机同步（仅游玩模式，2 人）：大厅弹窗、hello 校验、房主权威世界与实体、对方人形、拾取、换层、开麦与说话角标
// 协议见 ARCHITECTURE.md 第 9 节；网络层 BR.net（js/net/net.js）。补充约定：
//   world 额外带 picked（本层已被拿走的物品 id）和 at（房主脚底位置：客机中途加入时直接传送到房主身边，否则无限迷宫里找不到人）
//   me / ents 额外带 lv（层级 id）：换层途中两边层级不同，丢掉旧层的位置和实体
//   me 的 y 是 BR.player.y（眼睛高度）；picked 额外带 type；level / exitReq 额外带 kind、from
//   main 需要每帧（暂停时也要）调用 BR.coop.update(dt)，V 键 pressed('mic') 在这里读；漏调时有 100ms 看门狗兜底收发
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

const ME_HZ = 15;
const ENTS_HZ = 10;
const HELLO_TIMEOUT_MS = 8000;    // 火箭游戏的房间不会发 hello，等这么久就判定是别的游戏
const INTERP_DELAY = 0.1;         // 秒：对方位置晚一个包渲染，两包之间插值
const PEER_STALE_S = 2;           // 这么久没收到对方位置就隐藏人形（对方回主页、切后台）
const SNAP_DIST = 8;              // 相邻两包跳这么远当作传送，直接跳过去不滑行
const TAG_MAX_DIST = 50;          // 名牌最远摆在相机前这么远，否则会被相机远平面（60 m）裁掉
const HIDE_NEAR = 0.6;            // 米：对方人形离本机相机这么近就不画（同一出生点、中途加入传送到房主脚下时相机会在对方模型里）
const SPEAK_ON = 0.08;            // 电平超过它算在说话
const SPEAK_HOLD = 0.35;          // 秒：句中短停顿不让角标闪
const RECONCILE_S = 1;
const WATCHDOG_MS = 100;
const NAME_KEY = 'backrooms_name';
const STYLE_RE = /(^|\/)css\/coop\.css([?#]|$)/;
const SELF_RE = /js\/net\/coop\.js([?#].*)?$/;
// currentScript 只在脚本同步执行期间有值，必须在顶层取
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

const S = {
  inited: false,
  // idle | creating | hosting | checking | confirm | joining | connecting | handshake | active
  phase: 'idle',
  role: null,
  active: false,          // 握手完成才算联机中；world/player 靠它判断客机
  gotHello: false, helloTimer: 0,
  peerName: '', peerSkin: null,
  confirm: null,          // { code, host }：客机"同意加入"前的确认
  status: '', statusKind: '',
  hostSeed: null, hostLevel: null,
  joinAt: null,           // { levelId, x, y, z, yaw }：客机进入该层后传送过去
  taken: { levelId: null, ids: new Set() },        // 本层已被拿走的物品（房主用来回复中途加入和重复拾取）
  remoteTaken: { levelId: null, ids: new Set() },  // 对方拿走了、但本机那块区块还没载入的物品，载入后立即移除
  startingAsGuest: false,
  guestStart: null,       // { run, timer }：客机开局在等大厅那条历史退掉（popstate 或 500ms 兜底）
  meAcc: 0, entsAcc: 0, reconcileAcc: 0,
  lastUpdateAt: 0, lastTickAt: 0,
  micOn: false, micBusy: false,
  micTouchAt: -1e9,       // 麦克风按钮上次由 touchstart 触发的时刻：800ms 内的 click 当作同一次触摸
  micSig: '000',          // 上次广播 coop:mic 时的 active / micOn / micBusy，变了才再发
  localLevel: 0, peerLevel: 0, localHold: 0, peerHold: 0,
  inputWasEnabled: false,
};
const D = {};   // DOM 引用

// ---------- 小工具 ----------
function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
function has(o, fn) { return !!o && typeof o[fn] === 'function'; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }
function uiHost() { return document.getElementById('ui') || document.body; }
function mk(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function btn(cls, text, parent, onClick) {
  const b = mk('button', 'coop-btn' + (cls ? ' ' + cls : ''), parent, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function loadName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (err) { return ''; } }
function saveName(v) { try { localStorage.setItem(NAME_KEY, v); } catch (err) { /* 隐私模式存不了 */ } }
function errText(err) { return BR.net ? BR.net.errorText(err && err.code) : '联机模块没有加载。'; }
function toast(text, ms) {
  if (has(BR.hud, 'toast')) { BR.hud.toast(text, ms); return; }
  const t = mk('div', 'coop-toast', uiHost(), text);
  setTimeout(() => t.remove(), ms || 3000);
}

function inWorld() { return !!(BR.world && BR.world.current) && BR.game.screen !== 'home'; }
function inCasualWorld() { return inWorld() && BR.game.mode === 'casual'; }
function blockedByMode() { return inWorld() && BR.game.mode !== 'casual'; }
function transitioning() { return !!(BR.world && BR.world.transitioning); }
function eyeHeight() { return (BR.config.player && BR.config.player.eyeHeight) || 1.62; }
function mySkin() { return (BR.skin && BR.skin.current) || BR.game.skin || BR.DEFAULT_SKIN; }

function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && STYLE_RE.test(links[i].getAttribute('href') || '')) return;
  }
  // index.html 没引 css/coop.css 时自己补上；按本脚本地址推算路径，tests/ 下的自测页也能找对
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, 'css/coop.css') : 'css/coop.css';
  l.setAttribute('data-owner', 'coop');
  (document.head || document.documentElement).appendChild(l);
}

// ---------- 大厅弹窗 ----------
function buildLobby() {
  if (D.lobby) {
    // 别的模块清空 #ui 时会把弹窗一起带走，补挂回去
    if (!document.body.contains(D.lobby)) uiHost().appendChild(D.lobby);
    return;
  }
  ensureStylesheet();
  const root = mk('div', 'coop-lobby', uiHost());
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '双人联机');
  root.addEventListener('click', e => { if (e.target === root) closeLobby(); });
  // Esc 在 init 里挂到 document 捕获阶段（onDocKeyDown），不挂在这里

  const card = mk('div', 'coop-card', root);
  const head = mk('div', 'coop-head', card);
  mk('h2', 'coop-title', head, '双人联机');
  D.close = btn('coop-close', '×', head, closeLobby);
  D.close.setAttribute('aria-label', '关闭');
  mk('p', 'coop-sub', card, '仅限「游玩」模式 · 2 人 · 语音默认闭麦');
  D.note = mk('p', 'coop-note', card);
  D.note.hidden = true;

  const field = mk('label', 'coop-field', card);
  mk('span', 'coop-label', field, '昵称');
  D.name = mk('input', 'coop-input', field);
  D.name.type = 'text';
  D.name.maxLength = 16;
  D.name.placeholder = '匿名流浪者';
  D.name.autocomplete = 'off';
  D.name.value = loadName();
  D.name.addEventListener('change', () => saveName(D.name.value.trim()));

  D.secCreate = mk('div', 'coop-section', card);
  mk('div', 'coop-section-title', D.secCreate, '创建房间');
  D.createBtn = btn('coop-btn-primary coop-wide', '创建房间', D.secCreate, onCreate);
  D.hostBox = mk('div', 'coop-hostbox', D.secCreate);
  D.hostBox.hidden = true;
  const codeRow = mk('div', 'coop-row', D.hostBox);
  D.code = mk('span', 'coop-code', codeRow);
  D.copyBtn = btn('', '复制', codeRow, onCopy);
  mk('p', 'coop-hint', D.hostBox, '把房号告诉朋友，对方在「加入房间」里输入即可。可以先关掉这个窗口继续玩。');

  D.secJoin = mk('div', 'coop-section', card);
  mk('div', 'coop-section-title', D.secJoin, '加入房间');
  const joinRow = mk('div', 'coop-row', D.secJoin);
  D.joinCode = mk('input', 'coop-input coop-code-input', joinRow);
  D.joinCode.type = 'text';
  D.joinCode.maxLength = 6;
  D.joinCode.placeholder = '6 位房号';
  D.joinCode.autocomplete = 'off';
  D.joinCode.spellcheck = false;
  D.joinCode.setAttribute('autocapitalize', 'characters');
  D.joinCode.addEventListener('input', () => {
    const v = D.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (v !== D.joinCode.value) D.joinCode.value = v;
  });
  D.joinCode.addEventListener('keydown', e => { if (e.key === 'Enter') onJoin(); });
  D.joinBtn = btn('coop-btn-primary', '加入', joinRow, onJoin);
  D.confirmBox = mk('div', 'coop-confirm', D.secJoin);
  D.confirmBox.hidden = true;
  D.confirmText = mk('p', '', D.confirmBox);
  const cRow = mk('div', 'coop-row coop-row-end', D.confirmBox);
  btn('', '取消', cRow, onConfirmNo);
  D.confirmYes = btn('coop-btn-primary', '同意加入', cRow, onConfirmYes);

  D.secPeer = mk('div', 'coop-section', card);
  D.secPeer.hidden = true;
  D.peerLine = mk('p', 'coop-peer-line', D.secPeer);
  // 大厅（z 80）盖住了右上角的麦克风按钮，触屏又没有 V 键：接通后在这里也放一个开关，文案由 renderMic 同步
  D.lobbyMic = btn('coop-lobby-mic', '开麦', D.secPeer, toggleMic);
  D.lobbyMic.hidden = true;
  D.peerTip = mk('p', 'coop-hint', D.secPeer);   // 文案按触屏 / 桌面在 renderLobby 里写

  D.status = mk('p', 'coop-status', card);
  D.status.setAttribute('aria-live', 'polite');
  D.foot = mk('div', 'coop-foot', card);
  D.leaveBtn = btn('coop-btn-danger', '退出联机', D.foot, () => { leave(); setStatus('已退出联机'); });
  D.lobby = root;
}

function renderLobby() {
  if (!D.lobby) return;
  const p = S.phase;
  const idleish = p === 'idle' || p === 'checking' || p === 'confirm';
  const noNet = !BR.net;
  // 微信 / QQ 旧内核等没有 WebRTC：一打开就提示并禁用。不用 BR.net.available()，没配 roomApi 时它也是 false，文案会错
  const noRtc = !!BR.net && typeof RTCPeerConnection !== 'function';
  const blocked = blockedByMode();
  D.note.hidden = !(noNet || noRtc || (blocked && !S.active));
  D.note.textContent = noNet ? '联机模块没有加载（缺少 js/net/net.js）。'
    : noRtc ? BR.net.errorText('no_webrtc')
    : '联机仅限「游玩」模式。请先回主页，选择「游玩」后再联机。';
  D.name.disabled = !idleish;
  D.secCreate.hidden = !(idleish || p === 'creating' || p === 'hosting');
  D.createBtn.hidden = p === 'hosting';
  D.createBtn.disabled = p !== 'idle' || blocked || noNet || noRtc;
  D.createBtn.textContent = p === 'creating' ? '创建中…' : '创建房间';
  D.hostBox.hidden = p !== 'hosting';
  D.code.textContent = (BR.net && BR.net.code) || '';
  D.secJoin.hidden = !(idleish || p === 'joining');
  D.joinCode.disabled = D.joinBtn.disabled = p !== 'idle' || blocked || noNet || noRtc;
  D.joinBtn.textContent = p === 'checking' ? '查询中…' : p === 'joining' ? '加入中…' : '加入';
  D.confirmBox.hidden = !(p === 'confirm' && S.confirm);
  if (S.confirm) {
    D.confirmText.textContent = '即将加入「' + S.confirm.host + '」的房间 ' + S.confirm.code + '。\n' +
      '同意加入后：你当前的游戏会被替换成房主的世界（同一层、同一种子），实体由房主那边模拟；' +
      '你的昵称、位置和制服颜色会发给对方；开麦后对方能听到你的声音（默认闭麦）。';
  }
  const linking = p === 'connecting' || p === 'handshake';
  D.secPeer.hidden = !(p === 'active' || linking);
  D.peerLine.textContent = p === 'active'
    ? '已连接：「' + S.peerName + '」 · 你是' + (S.role === 'host' ? '房主' : '客机')
    : '正在连接' + (S.peerName ? '「' + S.peerName + '」' : '') + '…';
  D.peerTip.hidden = p !== 'active';
  D.peerTip.textContent = BR.input && BR.input.isTouch
    ? '点上面的按钮，或关掉窗口后点右上角麦克风按钮开麦 / 闭麦。'
    : '按 V 键或点屏幕右上角的麦克风按钮开麦 / 闭麦。';
  D.lobbyMic.hidden = D.peerTip.hidden;
  renderLobbyMic();
  D.leaveBtn.hidden = idleish;
  D.foot.hidden = D.leaveBtn.hidden;   // 空底栏也占着外边距，矮屏上省出来
  D.status.textContent = S.status;
  D.status.className = 'coop-status' + (S.statusKind ? ' coop-' + S.statusKind : '');
}

function setStatus(text, kind) {
  S.status = text || '';
  S.statusKind = kind || '';
  renderLobby();
  // 状态行在卡片最底部，矮横屏上出错时常在可视区外：滚到看得见（已可见时 nearest 不动）
  if (S.statusKind === 'err' && lobbyOpen()) D.status.scrollIntoView({ block: 'nearest' });
}

function myName() {
  const v = ((D.name && D.name.value) || loadName() || '').trim();
  saveName(v);
  return v;
}

async function onCreate() {
  if (S.phase !== 'idle' || blockedByMode() || !BR.net) return;
  audioUnlock();
  S.phase = 'creating';
  S.role = 'host';
  setStatus('正在创建房间…');
  try {
    await BR.net.createRoom(myName());
    if (S.phase !== 'creating') return;
    S.phase = 'hosting';
    setStatus('房间已创建，等待朋友加入…', 'ok');
  } catch (err) {
    if ((err && err.code === 'cancelled') || S.phase !== 'creating') return;
    endSession();
    setStatus(errText(err), 'err');
  }
}

async function onJoin() {
  if (S.phase !== 'idle' || blockedByMode() || !BR.net) return;
  const code = D.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { setStatus('请输入 6 位房号。', 'err'); return; }
  audioUnlock();
  S.phase = 'checking';
  setStatus('正在查询房间…');
  try {
    const info = await BR.net.roomInfo(code);
    if (S.phase !== 'checking') return;
    if (info.state === 'joined') { S.phase = 'idle'; setStatus(BR.net.errorText('room_full'), 'err'); return; }
    if (info.state === 'closed') { S.phase = 'idle'; setStatus(BR.net.errorText('room_closed'), 'err'); return; }
    S.confirm = { code, host: info.host_name || '房主' };
    S.phase = 'confirm';
    setStatus('');
    // 矮横屏上确认框落在卡片可视区下方，点完「加入」像没反应：滚到「同意加入」能看见
    D.confirmBox.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    if (S.phase !== 'checking') return;
    S.phase = 'idle';
    setStatus(errText(err), 'err');
  }
}

function onConfirmNo() {
  S.confirm = null;
  if (S.phase === 'confirm') S.phase = 'idle';
  setStatus('');
}

async function onConfirmYes() {
  if (S.phase !== 'confirm' || !S.confirm) return;
  const c = S.confirm;
  S.confirm = null;
  audioUnlock();
  S.phase = 'joining';
  S.role = 'guest';
  setStatus('正在加入房间 ' + c.code + '…');
  try {
    const host = await BR.net.joinRoom(c.code, myName());
    if (S.phase !== 'joining') return;
    S.peerName = host;
    S.phase = 'connecting';
    setStatus('已进入房间，正在和「' + host + '」建立点对点连接…');
  } catch (err) {
    if ((err && err.code === 'cancelled') || S.phase !== 'joining') return;
    endSession();
    setStatus(errText(err), 'err');
  }
}

function legacyCopy(text) {
  const ta = mk('textarea', '', document.body);
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  ta.remove();
  return ok;
}
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}
function onCopy() {
  const code = BR.net && BR.net.code;
  if (!code) return;
  copyText(code).then(ok => {
    D.copyBtn.textContent = ok ? '已复制' : '复制失败';
    if (!ok) setStatus('复制失败，请手动记下房号 ' + code, 'err');
    setTimeout(() => { D.copyBtn.textContent = '复制'; }, 1500);
  });
}

function openLobby() {
  init();
  buildLobby();
  const hint = BR.net && !BR.net.active && has(BR.net, 'readHint') ? BR.net.readHint() : null;
  if (hint && S.phase === 'idle') {
    if (hint.name && !D.name.value) D.name.value = hint.name;
    if (hint.role === 'guest' && hint.code && !D.joinCode.value) D.joinCode.value = hint.code;
  }
  const wasHidden = D.lobby.hidden;
  D.lobby.hidden = false;
  // 安卓返回键 / iOS 边缘返回手势要先关大厅：打开时压一条历史记录。
  // 带上当前的 brHome（主页弹层层数），home.js 的 onPopState 算层数不受影响；已经开着就不重复压
  if (wasHidden) {
    try { history.pushState({ brHome: histHome(), brPanel: 'lobby' }, ''); } catch (err) { /* file:// 或沙箱不让改历史，大厅照常工作 */ }
  }
  // 游玩中直接打开（不经暂停菜单）时要先停掉操作、放开鼠标，关窗时再还回去
  if (wasHidden && BR.input && BR.input.enabled) { S.inputWasEnabled = true; BR.input.enabled = false; }
  renderLobby();
  // 手机上不自动聚焦，免得一打开就弹键盘
  if (wasHidden && S.phase === 'idle' && !D.name.value && !(BR.input && BR.input.isTouch)) {
    try { D.name.focus(); } catch (err) { /* 忽略 */ }
  }
}

function histState() { try { return history.state; } catch (err) { return null; } }
function histHome() { const st = histState(); return st && typeof st.brHome === 'number' ? st.brHome : 0; }

// how：'popstate' = 不动历史（返回键已经把那条记录退掉了，或者调用方自己退，见 startAsGuest）；
//      其余（点 ×、点背景、Esc、外部直接调用，点击时传进来的是事件对象）= 栈顶是大厅那条就 back() 退掉
function closeLobby(how) {
  if (!D.lobby || D.lobby.hidden) return;
  D.lobby.hidden = true;
  if (S.phase === 'confirm') { S.confirm = null; S.phase = 'idle'; }
  const a = document.activeElement;
  if (a && D.lobby.contains(a) && typeof a.blur === 'function') a.blur();
  if (S.inputWasEnabled && BR.input && BR.game.screen === 'playing') BR.input.enabled = true;
  S.inputWasEnabled = false;
  if (how === 'popstate') return;
  const st = histState();
  if (!st || st.brPanel !== 'lobby') return;
  try { history.back(); } catch (err) { /* 忽略 */ }
}

// 返回键：退到的记录不是大厅那条，说明用户按了返回，关掉大厅
function onPopState(e) {
  if (lobbyOpen() && !(e.state && e.state.brPanel === 'lobby')) closeLobby('popstate');
  // 客机开局在等这次退栈：放到下一个任务再开局。在这次 popstate 里直接开的话，main.js 排在后面的 popstate 监听
  // 会把它当成 home.hide() 退弹层的那一次，真正的那一次反而被当成返回键，一开局就进暂停
  if (S.guestStart) setTimeout(S.guestStart.run, 0);
}

// Esc 关大厅：挂在 document 捕获阶段并停止传播。挂在弹窗上的话焦点不在大厅里就收不到，
// 而且会冒泡到 home.js 的 keydown，把底下的主页弹窗也关掉一层，两边各退一次历史，之后多出一次无效返回。
// input.js 在 window 捕获阶段更早收到这次按键，暂停键不受影响
function onDocKeyDown(e) {
  if (e.key !== 'Escape' || !lobbyOpen()) return;
  e.stopPropagation();
  closeLobby();
}

function lobbyOpen() { return !!(D.lobby && !D.lobby.hidden); }

// ---------- 会话生命周期 ----------
function syncGameCoop() {
  const role = S.active ? S.role : null;
  const c = BR.game.coop;
  if (!c || typeof c !== 'object') { BR.game.coop = { active: S.active, role }; return; }
  // main 在 game:start 时可能整体覆盖它，只在不一致时改
  if (c.active !== S.active) c.active = S.active;
  if (c.role !== role) c.role = role;
}

function setGuestAuthority(isGuest) {
  const E = BR.entities;
  if (E && E.authoritative !== !isGuest) E.authoritative = !isGuest;
}

function send(obj, lossy) { return !!(BR.net && BR.net.send(obj, lossy ? { lossy: true } : null)); }

function activate() {
  S.active = true;
  S.phase = 'active';
  syncGameCoop();
  if (S.role === 'guest') setGuestAuthority(true);
  buildHud();
  renderMic();
  const who = '「' + S.peerName + '」';
  if (S.role === 'host') {
    setStatus('已和' + who + '连上。', 'ok');
    toast(who + '加入了联机', 3000);
    sendWorld();
  } else {
    setStatus('已和房主' + who + '连上，等待房主进入游戏…', 'ok');
    toast('已连上房主' + who, 3000);
  }
}

function endSession() {
  const wasGuest = S.active && S.role === 'guest';
  if (S.helloTimer) clearTimeout(S.helloTimer);
  if (S.guestStart) { clearTimeout(S.guestStart.timer); S.guestStart = null; }   // 还在等退栈的客机开局作废
  Object.assign(S, {
    active: false, gotHello: false, helloTimer: 0, phase: 'idle', role: null, confirm: null,
    peerName: '', peerSkin: null, hostSeed: null, hostLevel: null, joinAt: null,
    micOn: false, micBusy: false, localLevel: 0, peerLevel: 0, localHold: 0, peerHold: 0,
  });
  S.remoteTaken = { levelId: null, ids: new Set() };
  if (wasGuest) setGuestAuthority(false);   // 客机回单机：手上的实体交还给本机 AI
  syncGameCoop();
  removeAvatar();
  detachMeter('local');
  detachMeter('peer');
  renderMic();
  renderBadges();
  renderLobby();
}

function leave() {
  if (BR.net && (BR.net.active || S.phase !== 'idle')) BR.net.leave();
  endSession();
}

function otherGame(noHello) {
  const t = noHello ? '这是别的游戏的房间（对方没有发来后室的握手），已断开。' : '这是别的游戏的房间，已断开。';
  leave();
  setStatus(t, 'err');
  if (!lobbyOpen()) toast(t, 5000);
}

function onNetEvent(type, data) {
  switch (type) {
    case 'status':
      if (S.phase !== 'idle' && S.phase !== 'active') setStatus(data);
      break;
    case 'peerJoined':
      if (S.role !== 'host') break;
      S.peerName = data || '对方';
      S.phase = 'connecting';
      setStatus('「' + S.peerName + '」进入了房间，正在建立点对点连接…');
      break;
    case 'connected': onConnected(); break;
    case 'disconnected': onDisconnected(data || {}); break;
    case 'peerLeft': onPeerLeft(); break;
    case 'error': onNetError(data || {}); break;
    case 'msg': onMsg(data); break;
    case 'remoteStream': attachMeter('peer', data); break;
    case 'localStream': attachMeter('local', data); break;
    case 'mic':
      S.micOn = !!data;
      renderMic();
      break;
  }
}

function onConnected() {
  if (S.phase === 'idle') return;
  S.phase = 'handshake';
  S.gotHello = false;
  setStatus('已连通，正在核对游戏…');
  send({ t: 'hello', game: 'backrooms', v: BR.config.version, name: (BR.net && BR.net.myName) || '', skin: mySkin() });
  if (S.helloTimer) clearTimeout(S.helloTimer);
  S.helloTimer = setTimeout(() => {
    S.helloTimer = 0;
    if (!S.gotHello && S.phase === 'handshake') otherGame(true);
  }, HELLO_TIMEOUT_MS);
}

function onDisconnected(info) {
  if (S.phase === 'idle') return;
  const wasActive = S.active, wasGuest = S.role === 'guest', name = S.peerName;
  endSession();
  const t = wasActive
    ? (wasGuest ? '和房主「' + name + '」的连接断开了，已切回单机继续游玩。' : '和「' + name + '」的连接断开了。')
    : errText({ code: info.reason });
  setStatus(t, 'err');
  if (wasActive || !lobbyOpen()) toast(t, 5000);
}

function onPeerLeft() {
  if (S.phase === 'idle') return;
  const wasGuest = S.role === 'guest', name = S.peerName || '对方';
  endSession();
  const t = '「' + name + '」离开了联机' + (wasGuest ? '，已切回单机继续游玩。' : '。');
  setStatus(t);
  toast(t, 4000);
}

function onNetError(e) {
  if (!e.fatal || S.phase === 'idle') return;
  endSession();
  const t = e.text || errText(e);
  setStatus(t, 'err');
  if (!lobbyOpen()) toast(t, 5000);
}

// ---------- 消息 ----------
function onMsg(m) {
  if (!m || typeof m.t !== 'string') return;
  if (!S.gotHello) {
    // 第一条必须是后室的 hello；火箭游戏的房间号段相同，进错房会先收到它的消息
    if (m.t !== 'hello' || m.game !== 'backrooms') { otherGame(false); return; }
    onHello(m);
    return;
  }
  if (!S.active) return;
  switch (m.t) {
    case 'world': onWorld(m); break;
    case 'worldReq': if (S.role === 'host') sendWorld(); break;
    case 'ents': onEnts(m); break;
    case 'me': onMe(m); break;
    case 'skin': onSkin(m.key); break;
    case 'pick': onPick(m); break;
    case 'picked': onPicked(m); break;
    case 'exitReq': onExitReq(m); break;
    case 'level': onLevel(m); break;
  }
}

function onHello(m) {
  if (S.helloTimer) { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  S.gotHello = true;
  if (m.name) S.peerName = String(m.name).slice(0, 16);
  if (!S.peerName) S.peerName = S.role === 'host' ? '客机' : '房主';
  onSkin(m.skin);
  if (m.v !== BR.config.version) {
    toast('双方游戏版本不同（我 ' + BR.config.version + ' / 对方 ' + m.v + '），可能出现不同步', 5000);
  }
  activate();
}

function onSkin(key) {
  if (typeof key !== 'string') return;
  if (Array.isArray(BR.SKINS) && !BR.SKINS.some(s => s.key === key)) return;
  S.peerSkin = key;   // updateAvatar 发现与已上的颜色不同会重新上色
}

// ---------- 世界与换层（房主权威） ----------
function sendWorld() {
  if (!S.active || S.role !== 'host' || !inCasualWorld()) return;
  const P = BR.player, lv = String(BR.game.levelId);
  // 房主如果在工坊地图里，把整张地图对象带给客机：客机没有本机存储里那份，靠这个激活同一张图（第 9 节）
  const wsMap = BR.workshop && BR.workshop.active && !BR.workshop.editing ? BR.workshop.active : undefined;
  send({
    t: 'world', seed: BR.game.seed >>> 0, levelId: lv,
    settings: Object.assign({}, BR.game.settings),
    picked: S.taken.levelId === lv ? Array.from(S.taken.ids) : [],
    at: P && isNum(P.x) && isNum(P.z) ? { x: r2(P.x), y: r2(P.y - eyeHeight()), z: r2(P.z), yaw: r3(P.yaw || 0) } : null,
    workshopMap: wsMap,
  });
}

function onWorld(m) {
  if (S.role !== 'guest' || !isNum(m.seed) || m.levelId == null) return;
  const seed = m.seed >>> 0, lv = String(m.levelId);
  if (!BR.levels.has(lv)) { toast('房主所在的层级 ' + lv + ' 本机没有（双方版本不同？）', 5000); return; }
  S.hostSeed = seed;
  S.hostLevel = lv;
  const ids = Array.isArray(m.picked) ? m.picked.map(String) : [];
  if (S.remoteTaken.levelId === lv) ids.forEach(id => S.remoteTaken.ids.add(id));
  else S.remoteTaken = { levelId: lv, ids: new Set(ids) };
  const fresh = !inWorld() || BR.game.mode !== 'casual' || (BR.game.seed >>> 0) !== seed;
  if (fresh) {
    // main 的开局可能是异步的：刚发过 game:start 就别被重复的 world 再开一次
    if (nowMs() - (S.lastGuestStartAt || -1e9) < 4000) return;
    startAsGuest(m, lv, seed);
  } else if (String(BR.game.levelId) !== lv) {
    goToLevel(lv);
  }
}

function startAsGuest(m, lv, seed) {
  const settings = Object.assign({}, BR.game.settings, m.settings || {}, { startLevel: lv });
  // 画质按本机性能，不跟房主
  if (BR.game.settings && BR.game.settings.quality) settings.quality = BR.game.settings.quality;
  const at = m.at;
  S.joinAt = at && isNum(at.x) && isNum(at.z)
    ? { levelId: lv, x: at.x, y: isNum(at.y) ? at.y : 0, z: at.z, yaw: isNum(at.yaw) ? at.yaw : 0, t: nowMs() }
    : null;
  S.lastGuestStartAt = nowMs();   // 下面可能要等一次 popstate 才真正开局，期间重复收到的 world 照样忽略
  S.inputWasEnabled = false;   // 开局由 main 接管输入
  const begin = () => {
    S.startingAsGuest = true;
    try {
      // 客机激活房主同步来的地图对象（不写本机存储）：main.js 的 onGameStart 认 workshop 字段，是对象就直接用
      BR.bus.emit('game:start', {
        mode: 'casual', difficulty: null, settings, seed, levelId: lv, coop: { role: 'guest' },
        workshop: m.workshopMap || undefined,
      });
    } finally {
      S.startingAsGuest = false;
    }
    syncGameCoop();
    setGuestAuthority(true);
    toast('已进入房主的世界', 2500);
  };
  const st = histState();
  const viaLobby = lobbyOpen() && !!st && st.brPanel === 'lobby';
  closeLobby('popstate');
  if (!viaLobby) { begin(); return; }
  // 栈顶是大厅那条：先退掉再开局。开局时 home.hide() 会 history.go(-n) 退主页弹层，和 back() 挤在同一任务里两次遍历不可靠；
  // 只 replaceState 抹掉标记的话会多留一条 { brHome } 记录，回主页后返回键要多按一次。等 popstate（onPopState 转过来），500ms 兜底
  try { history.back(); } catch (err) { begin(); return; }
  const job = {
    run() {
      if (S.guestStart !== job) return;
      S.guestStart = null;
      clearTimeout(job.timer);
      if (S.active && S.role === 'guest') begin();   // 等的时候断线或退出了联机就不开了
    },
    timer: 0,
  };
  job.timer = setTimeout(job.run, 500);
  S.guestStart = job;
}

// force：房主明确广播的换层，即使是同一层（比如 Level Dev 的"回到 Level Dev"圈，出生点重置）也要跟着重进
function goToLevel(lv, kind, force) {
  if (!has(BR.world, 'goTo') || (!force && String(BR.game.levelId) === lv)) return;
  BR.world.goTo(lv, kind ? { kind } : undefined).catch(err => console.error('[coop] 跟随换层失败', lv, err));
}

function onLevel(m) {
  if (S.role !== 'guest' || m.to == null) return;
  S.hostLevel = String(m.to);
  if (inCasualWorld()) goToLevel(S.hostLevel, m.kind, true);
}

function onExitReq(m) {
  if (S.role !== 'host' || m.to == null || !inCasualWorld() || transitioning()) return;
  const to = String(m.to), here = String(BR.game.levelId);
  // 客机还在旧层时发出的过期请求不理，随后的 world 会把它拉到正确的层
  if (m.from != null && String(m.from) !== here) return;
  // 同层出口（to === here）也要换：客机走进"回到本层"的圈，房主不理的话这个出口在客机上就是死的
  if (!BR.levels.has(to)) return;
  BR.world.goTo(to, { kind: m.kind }).catch(err => console.error('[coop] 换层失败', to, err));
  send({ t: 'level', to, kind: m.kind });
}

function onExitReach(p) {
  if (!S.active || !p || p.to == null || !inCasualWorld()) return;
  const to = String(p.to);
  if (S.role === 'guest') {
    // world.js 看到客机就不自己换层，转给房主决定
    send({ t: 'exitReq', to, kind: p.kind, from: String(BR.game.levelId) });
  } else if (!transitioning()) {
    // exit:reach 在 world.goTo 之前发出；已经在换层说明这次会被合并掉，不广播
    send({ t: 'level', to, kind: p.kind });
  }
}

// 客机兜底：消息在对方换层途中被合并掉时，每秒核对一次层级和种子
function reconcile(dt) {
  if (S.role !== 'guest' || !S.hostLevel) return;
  S.reconcileAcc += dt;
  if (S.reconcileAcc < RECONCILE_S) return;
  S.reconcileAcc = 0;
  if (!inWorld() || transitioning() || BR.game.screen === 'dead') return;
  if (BR.game.mode !== 'casual' || (S.hostSeed != null && (BR.game.seed >>> 0) !== S.hostSeed)) { send({ t: 'worldReq' }); return; }
  if (String(BR.game.levelId) !== S.hostLevel) goToLevel(S.hostLevel);
}

// 客机中途加入：传送到房主身边，并把周围区块当场建完，免得走进还没生成的墙里
function applyJoinAt() {
  const j = S.joinAt;
  if (!j) return;
  if (nowMs() - j.t > 15000) { S.joinAt = null; return; }
  if (!inCasualWorld() || transitioning() || String(BR.game.levelId) !== j.levelId || !has(BR.player, 'reset')) return;
  S.joinAt = null;
  BR.player.reset({ x: j.x, y: j.y, z: j.z, yaw: j.yaw }, { full: false });
  if (has(BR.world, 'update') && has(BR.world, 'debugInfo')) {
    BR.world.update(0);   // world.update 每次只建 1 块
    for (let i = 0; i < 64 && BR.world.current && BR.world.debugInfo().queued > 0; i++) BR.world.update(0);
  }
}

// ---------- 实体（只在房主模拟） ----------
function sendEnts() {
  const E = BR.entities;
  if (!has(E, 'snapshot') || !inCasualWorld() || transitioning()) return;
  let list;
  try { list = E.snapshot(); } catch (err) {
    if (!S.entsErr) { S.entsErr = true; console.error('[coop] entities.snapshot 出错', err); }
    return;
  }
  send({ t: 'ents', lv: String(BR.game.levelId), list }, true);
}

function onEnts(m) {
  if (S.role !== 'guest' || !Array.isArray(m.list) || !inCasualWorld() || transitioning()) return;
  if (m.lv != null && String(m.lv) !== String(BR.game.levelId)) return;
  const E = BR.entities;
  if (!has(E, 'applySnapshot')) return;
  setGuestAuthority(true);
  try { E.applySnapshot(m.list); } catch (err) {
    if (!S.snapErr) { S.snapErr = true; console.error('[coop] entities.applySnapshot 出错', err); }
  }
}

function sendMe() {
  const P = BR.player;
  if (!P || !inWorld() || !isNum(P.x) || !isNum(P.z)) return;
  send({ t: 'me', x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r3(P.yaw || 0), pitch: r3(P.pitch || 0), lv: String(BR.game.levelId) }, true);
}

function netSends(dt) {
  const me = 1 / ME_HZ, en = 1 / ENTS_HZ;
  S.meAcc += dt;
  if (S.meAcc >= me) { S.meAcc = S.meAcc >= 2 * me ? 0 : S.meAcc - me; sendMe(); }
  if (S.role !== 'host') return;
  S.entsAcc += dt;
  if (S.entsAcc >= en) { S.entsAcc = S.entsAcc >= 2 * en ? 0 : S.entsAcc - en; sendEnts(); }
}

// ---------- 拾取 ----------
function markTaken(id) {
  const lv = String(BR.game.levelId);
  if (S.taken.levelId !== lv) S.taken = { levelId: lv, ids: new Set() };
  S.taken.ids.add(String(id));
}
function markRemoteTaken(id) {
  const lv = String(BR.game.levelId);
  if (S.remoteTaken.levelId !== lv) S.remoteTaken = { levelId: lv, ids: new Set() };
  S.remoteTaken.ids.add(String(id));
}

function onPickRequest(p) {
  if (!p || p.id == null) return;
  if (S.active && S.role === 'guest') { send({ t: 'pick', id: String(p.id) }); return; }
  // BR.game.coop 残留成客机但其实没在联机：别让互动键失效，按单机捡
  if (!S.active && has(BR.items, 'pick')) BR.items.pick(p.id, 'me');
}

function onPick(m) {
  if (S.role !== 'host' || m.id == null || !inCasualWorld() || !has(BR.items, 'pick')) return;
  const id = String(m.id);
  const here = has(BR.items, 'find') ? BR.items.find(id) : null;
  if (here) {
    if (!BR.items.pick(id, 'peer')) return;
  } else {
    // 两人离得远，房主这边那块区块没载入：没人拿过就信任客机，等本机载入时再移除
    if (S.taken.levelId === String(BR.game.levelId) && S.taken.ids.has(id)) return;
    markRemoteTaken(id);
  }
  markTaken(id);
  send({ t: 'picked', id, by: 'guest', type: here ? here.type : undefined });
}

function onItemPickup(p) {
  if (!p || p.id == null || BR.game.mode !== 'casual') return;
  if (S.active && S.role === 'guest') return;   // 客机的拾取都经过房主确认，房主那边已经记过
  const id = String(p.id);
  // 背包只装下一部分时物品还在地上，不算被拿走
  if (has(BR.items, 'find') && BR.items.find(id)) return;
  markTaken(id);   // 单机时也记：之后有人中途加入要告诉他
  if (S.active) send({ t: 'picked', id, by: 'host', type: p.type });
}

function onPicked(m) {
  if (S.role !== 'guest' || m.id == null || !has(BR.items, 'pick')) return;
  const id = String(m.id);
  if (m.by === S.role) {
    // 请求途中那块区块被卸载了：房主已记成拿走，本机也别再刷出来
    if (!BR.items.pick(id, 'me') && !(has(BR.items, 'find') && BR.items.find(id))) markRemoteTaken(id);
  } else if (!BR.items.pick(id, 'peer')) {
    markRemoteTaken(id);
  }
}

function applyRemoteTaken() {
  const rt = S.remoteTaken;
  if (!rt.ids.size || rt.levelId !== String(BR.game.levelId) || !has(BR.items, 'find') || transitioning()) return;
  rt.ids.forEach(id => { if (BR.items.find(id) && BR.items.pick(id, 'peer')) rt.ids.delete(id); });
}

// ---------- 总线 ----------
function onGameStart(p) {
  if (S.startingAsGuest) return;
  // 新开一局，上一局记下的拾取状态作废
  S.taken = { levelId: null, ids: new Set() };
  S.remoteTaken = { levelId: null, ids: new Set() };
  if (S.phase === 'idle') return;
  if (!p || p.mode !== 'casual') {
    leave();
    const t = '联机仅限「游玩」模式，已退出联机。';
    setStatus(t, 'err');
    toast(t, 4000);
    return;
  }
  // 客机自己开了一局：以房主为准，要一次最新世界
  if (S.active && S.role === 'guest') send({ t: 'worldReq' });
}

function onLevelEnter(p) {
  const id = p && p.id != null ? String(p.id) : String(BR.game.levelId);
  S.taken = { levelId: id, ids: new Set() };
  if (S.remoteTaken.levelId !== id) S.remoteTaken = { levelId: id, ids: new Set() };
  if (S.active && S.role === 'host') sendWorld();
}

function onGameHome() {
  S.taken = { levelId: null, ids: new Set() };
  if (S.phase === 'idle') return;
  leave();
  setStatus('回到主页，已退出联机。');
  toast('已退出联机', 2500);
}

function onSkinChange(p) {
  if (S.active && p && p.key) send({ t: 'skin', key: String(p.key) });
}

// ---------- 麦克风按钮与说话角标 ----------
const PEER_TALK = '🔊 对方在说话';
// 对方语音被自动播放策略拦着时的角标文案：触屏说轻触，桌面说点击
const PEER_TAP_TOUCH = '🔊 轻触屏幕收听对方语音';
const PEER_TAP_CLICK = '🔊 点击页面收听对方语音';

function buildHud() {
  if (D.hud) {
    if (!document.body.contains(D.hud)) uiHost().appendChild(D.hud);
    return;
  }
  ensureStylesheet();
  const root = mk('div', 'coop-hud', uiHost());
  D.mic = mk('button', 'coop-mic', root);
  D.mic.type = 'button';
  D.mic.hidden = true;
  mk('span', 'coop-mic-ico', D.mic, '🎙');
  D.micTxt = mk('span', 'coop-mic-txt', D.mic, '已闭麦');
  mk('kbd', 'coop-mic-key', D.mic, 'V');
  // 触屏走 touchstart：另一根手指按着摇杆时部分手机不合成 click（hud.js 背包格、testmode 入口同理）。
  // preventDefault 顺带吞掉合成 click；鼠标、键盘仍走 click，800ms 内的 click 当作同一次触摸，不再切一次
  D.mic.addEventListener('touchstart', e => {
    if (e.cancelable) e.preventDefault();
    S.micTouchAt = nowMs();
    toggleMic();
  }, { passive: false });
  D.mic.addEventListener('click', e => {
    e.preventDefault();
    if (nowMs() - S.micTouchAt < 800) return;
    toggleMic();
    D.mic.blur();   // 留着焦点的话空格/回车会再点一次
  });
  const talk = mk('div', 'coop-talk', root);
  D.badgeMe = mk('div', 'coop-badge coop-badge-me', talk, '🎙 我在说话');
  D.badgeMe.hidden = true;
  D.badgePeer = mk('div', 'coop-badge coop-badge-peer', talk, PEER_TALK);
  D.badgePeer.hidden = true;
  D.badgePeerTxt = PEER_TALK;
  D.hud = root;
}

// 大厅里的开关：申请中再点 = 取消，所以不禁用
function renderLobbyMic() {
  if (!D.lobbyMic) return;
  D.lobbyMic.textContent = S.micBusy ? '申请麦克风…' : S.micOn ? '闭麦' : '开麦';
  D.lobbyMic.setAttribute('aria-pressed', S.micOn ? 'true' : 'false');
}

function renderMic() {
  if (D.hud) {
    D.hud.classList.toggle('coop-touch', !!(BR.input && BR.input.isTouch));
    D.mic.hidden = !S.active;
    D.mic.classList.toggle('coop-on', S.micOn);
    D.mic.classList.toggle('coop-busy', S.micBusy);
    D.micTxt.textContent = S.micBusy ? '申请麦克风…' : S.micOn ? '开麦中' : '已闭麦';
    D.mic.setAttribute('aria-pressed', S.micOn ? 'true' : 'false');
    D.mic.setAttribute('aria-label', S.micOn ? '麦克风已打开，点击闭麦' : '麦克风已关闭，点击开麦');
  }
  renderLobbyMic();
  // 暂停菜单、结算页、主页游玩弹窗里的开麦按钮（hud / death / home）靠这个事件刷新，状态没变不发
  const sig = (S.active ? '1' : '0') + (S.micOn ? '1' : '0') + (S.micBusy ? '1' : '0');
  if (sig !== S.micSig) {
    S.micSig = sig;
    BR.bus.emit('coop:mic', { on: S.micOn, busy: S.micBusy, active: S.active });
  }
}

function renderBadges() {
  if (!D.hud) return;
  const me = S.active && S.localHold > 0, peer = S.active && S.peerHold > 0;
  if (D.badgeMe.hidden === me) D.badgeMe.hidden = !me;
  if (D.badgePeer.hidden === peer) D.badgePeer.hidden = !peer;
  if (!peer) return;
  // 对方语音的 <audio> 被自动播放策略拦着（iOS）时角标亮着却没声音：提示点一下，onGesture 会补 play()。每帧都跑，文字变了才写 DOM
  const t = BR.net && BR.net.remotePaused ? (BR.input && BR.input.isTouch ? PEER_TAP_TOUCH : PEER_TAP_CLICK) : PEER_TALK;
  if (t !== D.badgePeerTxt) { D.badgePeerTxt = t; D.badgePeer.textContent = t; }
}

// ---------- 开麦与音量电平 ----------
const A = { ctx: null, sink: null, local: null, peer: null };

function audioCtx() {
  if (A.ctx) return A.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    A.ctx = new AC();
    // 分析节点经一路静音增益接到输出：有的内核不接到 destination 就不处理数据
    A.sink = A.ctx.createGain();
    A.sink.gain.value = 0;
    A.sink.connect(A.ctx.destination);
  } catch (err) {
    A.ctx = null;
  }
  return A.ctx;
}

// 自动播放策略：AudioContext 和对方语音的 <audio> 都要在用户手势里恢复
function audioUnlock() {
  const ctx = audioCtx();
  if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
  if (has(BR.net, 'resumeAudio')) BR.net.resumeAudio();
}
function onGesture() { if (S.active) audioUnlock(); }

function attachMeter(which, stream) {
  detachMeter(which);
  const ctx = audioCtx();
  if (!ctx || !stream || !ctx.createMediaStreamSource) return;
  try {
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    an.connect(A.sink);   // 只量电平；对方的声音由 net.js 的 <audio> 播放，这里不出声
    A[which] = { src, an, buf: new Uint8Array(an.fftSize) };
  } catch (err) {
    console.warn('[coop] 音量检测接不上', which, err);
  }
}

function detachMeter(which) {
  const m = A[which];
  if (!m) return;
  try { m.src.disconnect(); m.an.disconnect(); } catch (err) { /* 已断开 */ }
  A[which] = null;
}

function readLevel(which) {
  const m = A[which];
  if (!m) return 0;
  m.an.getByteTimeDomainData(m.buf);   // byte 版各内核都有，float 版老 Safari 没有
  let sum = 0;
  for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
  return U.clamp(Math.sqrt(sum / m.buf.length) * 5, 0, 1);   // 正常说话 RMS 约 0.02–0.15
}

function updateMeters(dt) {
  const l = S.micOn ? readLevel('local') : 0;   // 闭麦时音轨是静音，直接算 0
  const p = readLevel('peer');
  // 起得快、落得慢：电平不随音节抖动
  S.localLevel = l > S.localLevel ? l : U.damp(S.localLevel, l, 10, dt);
  S.peerLevel = p > S.peerLevel ? p : U.damp(S.peerLevel, p, 10, dt);
  S.localHold = S.localLevel > SPEAK_ON ? SPEAK_HOLD : Math.max(0, S.localHold - dt);
  S.peerHold = S.peerLevel > SPEAK_ON ? SPEAK_HOLD : Math.max(0, S.peerHold - dt);
  renderBadges();
}

async function setMic(on) {
  on = !!on;
  if (!BR.net) return false;
  if (on && !S.active) { toast('联机连上之后才能开麦', 2500); return false; }
  audioUnlock();
  if (!on) {
    BR.net.setMic(false);
    S.micOn = false;
    S.localHold = 0;
    renderMic();
    renderBadges();
    return false;
  }
  if (S.micBusy) return false;
  S.micBusy = true;
  renderMic();
  try {
    const ok = await BR.net.setMic(true);
    S.micOn = !!ok && S.active;
  } catch (err) {
    S.micOn = false;
    if (!(err && err.code === 'cancelled')) toast(errText(err), 6000);
  } finally {
    S.micBusy = false;
    renderMic();
  }
  return S.micOn;
}

// 申请麦克风途中再按一次 = 取消（之前按 !micOn 算，申请中再按还是"开"，被 micBusy 吞掉，关不掉）
function toggleMic() { return setMic(!(S.micOn || S.micBusy)); }

// ---------- 对方人形 ----------
const R = {
  obj: null, head: null, own: [], model: false, loadingModel: false, skinKey: null,
  tag: null, tagTex: null, tagCtx: null, tagText: '', tagAcc: 0,
  samples: [], lv: null, lastRecv: -1e9, walk: 0,
  cur: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
};

function onMe(m) {
  if (!isNum(m.x) || !isNum(m.y) || !isNum(m.z)) return;
  const lv = m.lv != null ? String(m.lv) : null;
  const a = R.samples, last = a[a.length - 1];
  // 换层或传送：清掉旧样本直接跳过去，不从旧位置滑行
  if (lv !== R.lv || (last && U.dist2(last.x, last.z, m.x, m.z) > SNAP_DIST * SNAP_DIST)) a.length = 0;
  R.lv = lv;
  const t = nowMs() / 1000;
  a.push({ t, x: m.x, y: m.y, z: m.z, yaw: isNum(m.yaw) ? m.yaw : 0, pitch: isNum(m.pitch) ? m.pitch : 0 });
  if (a.length > 24) a.splice(0, a.length - 24);
  R.lastRecv = t;
}

function sampleAt(t, out) {
  const a = R.samples, n = a.length;
  let p = a[n - 1], q = p, k = 0;
  if (t <= a[0].t) {
    p = q = a[0];
  } else if (t < a[n - 1].t) {
    for (let i = n - 1; i > 0; i--) {
      if (a[i - 1].t <= t) { p = a[i - 1]; q = a[i]; k = (t - p.t) / Math.max(1e-3, q.t - p.t); break; }
    }
  }
  out.x = U.lerp(p.x, q.x, k);
  out.y = U.lerp(p.y, q.y, k);
  out.z = U.lerp(p.z, q.z, k);
  out.yaw = p.yaw + U.angleDiff(p.yaw, q.yaw) * k;
  out.pitch = U.lerp(p.pitch, q.pitch, k);
  return out;
}

function suitColor(key) {
  const s = Array.isArray(BR.SKINS) && BR.SKINS.find(x => x.key === key);
  return s ? s.color : 0xd8b21f;
}

// 没有 hazmat.glb 时的胶囊体：身体是 Suit 材质（随皮肤变），面具和靴子固定深色
function buildFallback() {
  const g = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: suitColor(BR.DEFAULT_SKIN) });
  suit.name = 'Suit';
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
  const glass = new THREE.MeshLambertMaterial({ color: 0x0c1418, emissive: 0x06090a });
  const bodyGeo = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.28, 1.14, 4, 12)
    : new THREE.CylinderGeometry(0.28, 0.28, 1.7, 12);
  const body = new THREE.Mesh(bodyGeo, suit);
  body.position.y = 0.85;
  body.userData.suit = true;
  g.add(body);
  const head = new THREE.Group();
  head.position.y = 1.5;
  g.add(head);
  const maskGeo = new THREE.BoxGeometry(0.34, 0.22, 0.14);
  const mask = new THREE.Mesh(maskGeo, glass);
  mask.position.set(0, 0, -0.24);   // 面朝 -Z，与实体约定一致
  head.add(mask);
  const filterGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10);
  const filter = new THREE.Mesh(filterGeo, dark);
  filter.rotation.x = Math.PI / 2;
  filter.position.set(0, -0.14, -0.3);
  head.add(filter);
  const bootGeo = new THREE.BoxGeometry(0.16, 0.14, 0.28);
  [-0.12, 0.12].forEach(sx => {
    const b = new THREE.Mesh(bootGeo, dark);
    b.position.set(sx, 0.07, -0.03);
    g.add(b);
  });
  R.head = head;
  R.own.push(bodyGeo, maskGeo, filterGeo, bootGeo, suit, dark, glass);
  return g;
}

// 模型单位不确定时按身高归一，别出现巨人或小人
function normalizeModel(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y;
  if (h > 0.01 && (h < 1.4 || h > 2.2)) obj.scale.multiplyScalar(1.75 / h);
  return obj;
}

function disposeOwn() {
  R.own.forEach(x => { try { x.dispose(); } catch (err) { /* 忽略 */ } });
  R.own.length = 0;
}

function ensureAvatar(scene) {
  if (R.obj) {
    if (R.obj.parent !== scene) scene.add(R.obj);
    if (R.tag && R.tag.parent !== scene) scene.add(R.tag);
    return;
  }
  const root = new THREE.Group();
  root.name = 'coop-peer';
  const model = has(BR.assets, 'modelSync') ? BR.assets.modelSync('hazmat') : null;
  root.add(model ? normalizeModel(model) : buildFallback());
  R.model = !!model;
  R.obj = root;
  R.skinKey = null;
  scene.add(root);
  if (!model && !R.loadingModel && has(BR.assets, 'model')) {
    R.loadingModel = true;
    // 模型还没预载就异步取一次，到了换掉胶囊体；没有 glb 就一直用胶囊体
    BR.assets.model('hazmat').then(m => { if (m && R.obj === root) swapModel(m); }, () => {});
  }
  buildTag(scene);
}

function swapModel(m) {
  const root = R.obj;
  while (root.children.length) root.remove(root.children[0]);
  disposeOwn();
  R.head = null;
  root.add(normalizeModel(m));
  R.model = true;
  R.skinKey = null;   // 新模型要重新上色
}

function applySkin(obj, key) {
  if (!obj || !key) return;
  if (has(BR.skin, 'apply')) {
    try { BR.skin.apply(obj, key); } catch (err) { console.warn('[coop] 皮肤上色失败', err); }
    return;
  }
  // skin.js 缺席时的兜底：同样只改 Suit 材质 / userData.suit 网格，先 clone 免得污染模型缓存
  const color = suitColor(key);
  obj.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(mt => mt.name === 'Suit' || o.userData.suit)) return;
    if (!o.userData.coopMat) {
      o.material = Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone();
      o.userData.coopMat = true;
    }
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(mt => {
      if ((mt.name === 'Suit' || o.userData.suit) && mt.color) mt.color.setHex(color);
    });
  });
}

function buildTag(scene) {
  if (R.tag) return;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  R.tagCtx = c.getContext('2d');
  R.tagTex = new THREE.CanvasTexture(c);
  R.tagTex.encoding = THREE.sRGBEncoding;
  R.tagTex.minFilter = THREE.LinearFilter;
  R.tagTex.generateMipmaps = false;
  // 不做深度测试、不随距离缩放：隔着墙也能看到队友在哪个方向
  const mat = new THREE.SpriteMaterial({ map: R.tagTex, transparent: true, depthTest: false, depthWrite: false });
  mat.fog = false;
  mat.sizeAttenuation = false;
  R.tag = new THREE.Sprite(mat);
  R.tag.renderOrder = 999;
  R.tag.scale.set(0.24, 0.06, 1);
  R.tagText = '';
  R.tagAcc = 0;
  scene.add(R.tag);
}

function drawTag(text) {
  if (text === R.tagText || !R.tagCtx) return;
  R.tagText = text;
  const g = R.tagCtx, W = 256, H = 64;
  const font = size => '600 ' + size + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  let size = 30;
  g.font = font(size);
  while (size > 16 && g.measureText(text).width > W - 24) { size -= 2; g.font = font(size); }
  const w = Math.min(W, g.measureText(text).width + 24), x = (W - w) / 2, y = 8, h = H - 16, r = 12;
  g.clearRect(0, 0, W, H);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = 'rgba(12,10,4,0.62)';
  g.fill();
  g.fillStyle = '#fff5cc';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 1);
  R.tagTex.needsUpdate = true;
}

function updateTag(dt, c, feet) {
  const cam = BR.gfx && BR.gfx.camera, tag = R.tag;
  if (!tag || !cam) return;
  const cp = cam.position;
  const hx = c.x, hy = feet + 2.05, hz = c.z;
  const dx = hx - cp.x, dy = hy - cp.y, dz = hz - cp.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = d > TAG_MAX_DIST ? TAG_MAX_DIST / d : 1;   // 远了就沿视线拉近，方向不变
  tag.position.set(cp.x + dx * k, cp.y + dy * k, cp.z + dz * k);
  tag.visible = true;
  R.tagAcc -= dt;
  if (R.tagAcc > 0) return;
  R.tagAcc = 0.25;
  const hd = Math.sqrt(dx * dx + dz * dz);
  drawTag((S.peerName || '队友') + (hd > 8 ? ' · ' + Math.round(hd) + ' m' : ''));
  // 隔墙时名牌变淡：还能指路，但一眼看得出不在视线里
  const blocked = has(BR.phys, 'los') && !BR.phys.los(cp.x, cp.y, cp.z, hx, feet + 1.6, hz);
  tag.material.opacity = blocked ? 0.45 : 0.95;
}

function updateAvatar(dt) {
  const scene = BR.gfx && BR.gfx.scene;
  const t = nowMs() / 1000;
  const show = !!scene && inWorld() && R.samples.length > 0 && !transitioning() &&
    (R.lv == null || R.lv === String(BR.game.levelId)) && t - R.lastRecv < PEER_STALE_S;
  if (!show) {
    if (R.obj) R.obj.visible = false;
    if (R.tag) R.tag.visible = false;
    return;
  }
  ensureAvatar(scene);
  const skin = S.peerSkin || BR.DEFAULT_SKIN;
  if (R.skinKey !== skin) { R.skinKey = skin; applySkin(R.obj, skin); }
  const prevX = R.obj.position.x, prevZ = R.obj.position.z;
  const c = sampleAt(t - INTERP_DELAY, R.cur);
  const feet = c.y - eyeHeight();
  // 走动时轻微起伏，免得像雕像在地上滑
  const speed = dt > 0 ? Math.min(6, Math.sqrt(U.dist2(prevX, prevZ, c.x, c.z)) / dt) : 0;
  R.walk += speed * dt * 2.2;
  const bob = speed > 0.3 ? Math.abs(Math.sin(R.walk * Math.PI)) * 0.04 : 0;
  R.obj.position.set(c.x, feet + bob, c.z);
  R.obj.rotation.y = c.yaw;   // 与相机同一套 yaw：面朝 -Z 的模型直接用
  if (R.head) R.head.rotation.x = U.clamp(c.pitch, -0.6, 0.6);
  // 两人重叠时相机在对方模型里面，满屏是面罩内侧：贴得太近先不画人形，名牌照常显示
  const cam = BR.gfx && BR.gfx.camera;
  R.obj.visible = !(cam && U.dist2(cam.position.x, cam.position.z, c.x, c.z) < HIDE_NEAR * HIDE_NEAR);
  updateTag(dt, c, feet);
}

function removeAvatar() {
  if (R.obj && R.obj.parent) R.obj.parent.remove(R.obj);
  if (R.tag) {
    if (R.tag.parent) R.tag.parent.remove(R.tag);
    R.tag.material.dispose();
    R.tagTex.dispose();
  }
  disposeOwn();
  Object.assign(R, {
    obj: null, head: null, model: false, loadingModel: false, skinKey: null,
    tag: null, tagTex: null, tagCtx: null, tagText: '', lv: null, lastRecv: -1e9,
  });
  R.samples.length = 0;
}

// ---------- 主循环 ----------
function tick(dt) {
  S.lastTickAt = nowMs();
  syncGameCoop();
  if (!S.active) return;
  if (S.role === 'guest') setGuestAuthority(true);   // entities.clear 之类可能把它改回去
  if (D.hud && !document.body.contains(D.hud)) buildHud();
  netSends(dt);
  applyRemoteTaken();
  applyJoinAt();
  reconcile(dt);
  updateMeters(dt);
  updateAvatar(dt);
}

function update(dt) {
  dt = isNum(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  S.lastUpdateAt = nowMs();
  if (S.active && has(BR.input, 'pressed') && BR.input.pressed('mic')) toggleMic();
  tick(dt);
}

// main 没调 update（载入中、或还没接入）时照样收发位置、刷新角标
function watchdog() {
  if (!S.active) return;
  const t = nowMs();
  if (t - S.lastUpdateAt < 300) return;
  tick(Math.min(0.25, Math.max(0, (t - (S.lastTickAt || t)) / 1000)));
}

function init() {
  if (S.inited) return;
  S.inited = true;
  if (document.body) { buildHud(); renderMic(); }
  if (has(BR.net, 'on')) BR.net.on(onNetEvent);
  BR.bus.on('game:start', onGameStart);
  BR.bus.on('game:home', onGameHome);
  BR.bus.on('level:enter', onLevelEnter);
  BR.bus.on('exit:reach', onExitReach);
  BR.bus.on('item:pickRequest', onPickRequest);
  BR.bus.on('item:pickup', onItemPickup);
  BR.bus.on('skin:change', onSkinChange);
  // 对方语音的播放要在用户手势里补一次：iOS 上 pointerdown 不一定算用户激活，和 audio.js 的解锁一样多听 touchend / click
  // （触屏层对 touchstart 的 preventDefault 不影响 touchend 到达 document 捕获阶段）
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(n => document.addEventListener(n, onGesture, { capture: true, passive: true }));
  document.addEventListener('keydown', onDocKeyDown, true);
  window.addEventListener('popstate', onPopState);
  setInterval(watchdog, WATCHDOG_MS);
}

BR.coop = {
  init, openLobby, closeLobby, update, leave, setMic,
  get active() { return S.active; },
  get role() { return S.role; },
  get mic() { return S.micOn; },
  get micBusy() { return S.micBusy; },   // 正在申请麦克风；这时再切一次 = 取消（别处的开麦按钮按 !(mic || micBusy) 调 setMic）
  get localSpeaking() { return S.localLevel; },
  get peerSpeaking() { return S.peerLevel; },
  get peerName() { return S.peerName; },
  get phase() { return S.phase; },
  // 联机对方当前渲染位置（插值后），房主用来判断自己 + 对方谁先进工坊放置实体的触发圈；没有有效样本时 null
  get peer() { return S.active && R.samples.length ? { x: R.cur.x, y: R.cur.y, z: R.cur.z } : null; },
  get code() { return (BR.net && BR.net.code) || null; },
};

// 拾取记录要从第一局就开始记（有人中途加入时要告诉他），不等 main 调 init
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
})();
