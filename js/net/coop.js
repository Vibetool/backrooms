// 后室 · 联机同步（仅游玩模式，2 人）：大厅弹窗、hello 校验、房主权威世界与实体、对方人形、拾取、换层、开麦与说话角标
// 协议见 ARCHITECTURE.md 第 9 节；网络层 BR.net（js/net/net.js）。补充约定：
//   world 额外带 picked（本层已被拿走的物品 id）和 at（房主脚底位置：客机中途加入时直接传送到房主身边，否则无限迷宫里找不到人）
//   me / ents 额外带 lv（层级 id）：换层途中两边层级不同，丢掉旧层的位置和实体
//   me 的 y 是 BR.player.y（眼睛高度）；picked 额外带 type；level / exitReq 额外带 kind、from
//   main 需要每帧（暂停时也要）调用 BR.coop.update(dt)，V 键 pressed('mic') 在这里读；漏调时有 100ms 看门狗兜底收发
// 交互大改 A1 起新增（协议细节见下面「事件通道」一节开头）：
//   hello 带 caps:['ev1','fx1','veh1']：ev1 = 事件通道与拖动租约，fx1 = 通用使用请求和座位，veh1 = 载具；对方缺哪项就关哪项并 toast
//   { t:'ev', lv, list } 每个 tick 合批走可靠通道；租约 'p:' 道具 'i:' 物资 'e:' 实体 'u:' 座位 'k:' 载具（'d:' 'v:' 留给 B）
//   me 追加 h（拿着租约时的实时位置，按 key 前缀分两种格式）、pose [mode,key]、c（房主时钟）
//   { t:'st' } 在 world 之后单独发：levelState.export(lv) + taken + 当前租约，超过 32 KB 分片；{ t:'stReq', lv } 要全量
//   拾取记录 taken 按层保存，换层不清，回主页 / 新开一局才清
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
const CAPS = ['ev1', 'fx1', 'veh1'];
const LEASE_TTL_MS = 1500;        // 对方拿着租约这么久没发 h / pose 保活，房主按最后位置替他松手
const OWN_IDLE_MS = 1500;         // 自己拿着拖动类租约、却既没 hand() 也不在拖动状态这么久：当作漏了 release，自己松手
const GRAB_WAIT_MS = 4000;        // 客机申请租约等房主回复的上限
const USE_WAIT_MS = 4000;         // 客机 use 请求等房主回复的上限
const HAND_STALE_MS = 500;        // hand() 超过这么久没更新就不再当作实时手点
const EXIT_MARGIN = 0.4;           // 米：道具离出口触发圈至少留这么多（和 interact 的 exitMargin、kit 的 EXIT_MARGIN 一致）
const GROUND_TOL = 0.05;           // 米：道具占地下面的地面和抓起时差超过它就是悬空 / 卡进地面（和 interact 一致）
const SUPPORT_TOL = 0.06;          // 米：架子上、桌上的道具，底面往下这么近有碰撞体托着才算放稳（和 interact 一致）
const REL_MAX_DIST = 6;           // 米：rel 落点离对方最近一次 me 位置（水平）的上限
const USE_MAX_DIST = 3.5;         // 米：use 的准心命中点离对方眼睛的上限（reach 2.6 + 走动延迟）
const ST_PART = 32 * 1024;        // st 的 JSON 超过这么多字符就切片
const ST_REQ_GAP_MS = 2000;       // stReq 最短间隔
const EV_MAX = 256;               // 一批 ev 最多处理这么多条，其余丢掉
const MSG_OLD = '对方版本较旧，联机拖动已关闭';
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
  taken: new Map(),       // levelId → Set<itemId>：本局各层已被拿走的物品（房主用来回复中途加入和重复拾取）；换层不清
  remoteTaken: new Map(), // levelId → Set<itemId>：对方拿走了、但本机那块区块还没载入的物品，载入后立即移除
  startingAsGuest: false,
  // ---- 事件通道 / 租约 / 使用请求 / 状态回放（A1） ----
  peerCaps: null,         // Set：对方 hello 里的 caps；没有 = 旧版
  holds: new Map(),       // k → { by:'host'|'guest', kind, since, last, p:[x,y,z]|null, a, pending }：房主是权威表，客机是镜像
  pend: new Map(),        // 客机：k → { cb, t }，等房主回 own / deny
  uses: new Map(),        // 客机：q → { cb, t, k, a }，等房主回 ack
  useSeq: 0,
  useHandlers: new Map(), // a → fn(req)：房主（单机时本机）处理 use 的函数，由各系统 onUse 注册
  evq: [],                // [lv, kind, payload]：本 tick 要发的事件
  relP: new Map(),        // 'kind|key' → { lv, kind, k, p }：松手落点，flush 时附到同一项的 set 上
  flushing: false,
  hand: null,             // { k, v:[…], t }：本机手上那件东西的实时位置（hand() 写）
  myPose: null,           // [mode, key]：本机姿态（seat / lie / view / drive），随 me 发
  peerPose: null, peerPoseSig: '',
  peerH: null,            // 对方最近一次 h（解析后）
  peerPos: null,          // { x, y, z, lv, t }：对方最近一次 me 位置（y 是眼睛高度）
  peerN: new Map(),       // 客机：lv → 房主 levelState 该层的版本号（st.v / ev.n）
  sentN: new Map(),       // 房主：lv → 上一次发给客机的版本号（ev.n0 用它）
  stBuf: null,            // 客机：正在拼的分片 st
  stReady: new Map(),     // 客机：lv → st，等开局 / 进层后再套用
  lastImport: null,       // 客机：开局前灌进 levelState 的那份 st，进层后核对还在不在
  needSt: false,          // 客机：开局前丢过 set，进层后要一次全量
  stReqAt: -1e9, stReqLater: null, stSeq: 0,
  clkOff: 0, clkLast: 0, clkSamples: [],
  oldWarnAt: -1e9,
  localHeld: new Set(),   // 客机：本地覆盖了显示位置的实体 id（e._localHold）
  gaveUp: new Set(),      // 客机：被房主的 own 抢先、已经放弃的申请；房主随后对它回的 deny 不再提示
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
  // 游玩中打开大厅等于停手：拖着的东西就地放下，免得队友那边一直显示被拿着
  if (wasHidden) releaseMine('lobby', true);
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

// 世界 / 状态回放 / 换层这几条要排在已经排队的事件后面（同一条有序通道），先把队列冲掉
const FLUSH_FIRST = { world: 1, st: 1, level: 1 };
function send(obj, lossy) {
  if (!lossy && obj && FLUSH_FIRST[obj.t] && S.evq.length + S.relP.size > 0) flushEv();
  return !!(BR.net && BR.net.send(obj, lossy ? { lossy: true } : null));
}

function activate() {
  S.active = true;
  S.phase = 'active';
  S.sentN.clear();
  S.peerN.clear();
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
  // 对方版本旧：关掉对应的联机功能并提示（排在「加入了联机」后面，免得被它盖掉）
  const miss = degradeText();
  if (miss) setTimeout(() => { if (S.active) toast(miss, 5000); }, 3200);
}

function endSession() {
  const wasGuest = S.active && S.role === 'guest';
  if (S.active) {
    // 断线：手上拖着的就地放下；房主替客机把它拿着的东西按最后位置放下（写进本机 levelState，之后单机照样在那儿）
    releaseMine('net', false);
    if (S.role === 'host') {
      Array.from(S.holds).forEach(([k, h]) => { if (h.by === 'guest') { S.holds.delete(k); finalize(k, h.kind, h.p, undefined, h.a, h); } });
    }
  }
  clearLeases('net');
  S.evq.length = 0;
  S.relP.clear();
  S.uses.forEach(u => callSafe(u.cb, { ok: false, why: '联机已断开' }));
  S.uses.clear();
  if (S.helloTimer) clearTimeout(S.helloTimer);
  if (S.guestStart) { clearTimeout(S.guestStart.timer); S.guestStart = null; }   // 还在等退栈的客机开局作废
  Object.assign(S, {
    active: false, gotHello: false, helloTimer: 0, phase: 'idle', role: null, confirm: null,
    peerName: '', peerSkin: null, hostSeed: null, hostLevel: null, joinAt: null,
    micOn: false, micBusy: false, localLevel: 0, peerLevel: 0, localHold: 0, peerHold: 0,
    peerCaps: null, peerPose: null, peerPoseSig: '', peerH: null, peerPos: null, hand: null,
    stBuf: null, lastImport: null, needSt: false, stReqLater: null,
  });
  S.stReady.clear();
  S.peerN.clear();
  S.sentN.clear();
  // 客机断线后 levelState 照旧保留（房主的状态镜像），单机接着玩；对方拿走、本机还没载入的照样不刷
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
  send({ t: 'hello', game: 'backrooms', v: BR.config.version, name: (BR.net && BR.net.myName) || '', skin: mySkin(), caps: CAPS.slice() });
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
    case 'pickDenied': onPickDenied(m); break;
    case 'exitReq': onExitReq(m); break;
    case 'level': onLevel(m); break;
    case 'ev': onEv(m); break;
    case 'st': onSt(m); break;
    case 'stReq': if (S.role === 'host') sendState(m.lv != null ? String(m.lv) : null); break;
  }
}

function onHello(m) {
  if (S.helloTimer) { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  S.gotHello = true;
  if (m.name) S.peerName = String(m.name).slice(0, 16);
  if (!S.peerName) S.peerName = S.role === 'host' ? '客机' : '房主';
  S.peerCaps = new Set(Array.isArray(m.caps) ? m.caps.filter(c => typeof c === 'string').slice(0, 32) : []);
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
    picked: Array.from(takenSet(lv)),
    at: P && isNum(P.x) && isNum(P.z) ? { x: r2(P.x), y: r2(P.y - eyeHeight()), z: r2(P.z), yaw: r3(P.yaw || 0) } : null,
    workshopMap: wsMap,
    c: r3(clock()),
  });
  // 本层被改过的状态单独发（world 可能已经带着 200 KB 的工坊地图，不往里塞）
  sendState(lv);
}

function onWorld(m) {
  if (S.role !== 'guest' || !isNum(m.seed) || m.levelId == null) return;
  const seed = m.seed >>> 0, lv = String(m.levelId);
  if (!BR.levels.has(lv)) { toast('房主所在的层级 ' + lv + ' 本机没有（双方版本不同？）', 5000); return; }
  S.hostSeed = seed;
  S.hostLevel = lv;
  clockSample(m.c);
  const ids = Array.isArray(m.picked) ? m.picked.map(String) : [];
  const ts = takenSet(lv), rt = remoteSet(lv);
  ids.forEach(id => { ts.add(id); rt.add(id); });
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
  const m = { t: 'me', x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r3(P.yaw || 0), pitch: r3(P.pitch || 0), lv: String(BR.game.levelId) };
  const h = myH();
  if (h) m.h = h;
  if (S.myPose) m.pose = S.myPose;
  if (S.role === 'host') m.c = r3(clock());
  send(m, true);
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
function takenSet(lv) {
  lv = String(lv);
  let s = S.taken.get(lv);
  if (!s) S.taken.set(lv, s = new Set());
  return s;
}
function remoteSet(lv) {
  lv = String(lv);
  let s = S.remoteTaken.get(lv);
  if (!s) S.remoteTaken.set(lv, s = new Set());
  return s;
}
function markTaken(id, lv) { takenSet(lv != null ? lv : curLv()).add(String(id)); }
function markRemoteTaken(id, lv) { remoteSet(lv != null ? lv : curLv()).add(String(id)); }

function onPickRequest(p) {
  if (!p || p.id == null) return;
  if (S.active && S.role === 'guest') {
    // 队友正拖着它：房主那边也会拒，这里先挡住，省一个来回
    if (leaseOf('i:' + p.id) === 'peer') { toast('队友正拿着它', 1500); return; }
    send({ t: 'pick', id: String(p.id) });
    return;
  }
  // BR.game.coop 残留成客机但其实没在联机：别让互动键失效，按单机捡
  if (!S.active && has(BR.items, 'pick')) BR.items.pick(p.id, 'me');
}

// 房主拒绝客机的拾取请求：回一条 pickDenied，客机才知道东西没进背包（不然地上空了、背包也没有，一点动静都没有）。
// why：'taken' 已经被拿走（两人同时按、房主先到）；'peer' 房主正拖着它
function denyPick(id, why) { send({ t: 'pickDenied', id, why }); }
function onPick(m) {
  if (S.role !== 'host' || m.id == null || !inCasualWorld() || !has(BR.items, 'pick')) return;
  const id = String(m.id), lv = curLv();
  // 先查租约：房主正拖着就拒；客机自己拿着（长按没挪远、松手算拾取）就顺手放掉租约
  const lk = 'i:' + id, lh = S.holds.get(lk);
  if (lh && lh.by === 'host') { queueEv('deny', { k: lk, why: 'peer' }); denyPick(id, 'peer'); return; }
  if (lh) { S.holds.delete(lk); itemHold(id, false); queueEv('own', { k: lk, by: null }); }
  const here = has(BR.items, 'find') ? BR.items.find(id) : null;
  if (here) {
    if (!BR.items.pick(id, 'peer')) { denyPick(id, 'taken'); return; }
  } else {
    // 两人离得远，房主这边那块区块没载入：没人拿过就信任客机，等本机载入时再移除
    if (takenSet(lv).has(id)) { denyPick(id, 'taken'); return; }
    markRemoteTaken(id, lv);
    lsWrite(lv, 'taken', id, true);   // 换层回来也不复活
  }
  markTaken(id, lv);
  send({ t: 'picked', id, by: 'guest', type: here ? here.type : undefined });
}

function onItemPickup(p) {
  if (!p || p.id == null || BR.game.mode !== 'casual') return;
  if (S.active && S.role === 'guest') return;   // 客机的拾取都经过房主确认，房主那边已经记过
  const id = String(p.id);
  // 背包只装下一部分时物品还在地上，不算被拿走
  if (has(BR.items, 'find') && BR.items.find(id)) return;
  markTaken(id);   // 单机时也记：之后有人中途加入要告诉他
  if (!S.active) return;
  const lk = 'i:' + id;
  if (S.holds.has(lk)) { S.holds.delete(lk); queueEv('own', { k: lk, by: null }); }
  send({ t: 'picked', id, by: 'host', type: p.type });
}

function onPicked(m) {
  if (S.role !== 'guest' || m.id == null || !has(BR.items, 'pick')) return;
  const id = String(m.id), lv = curLv();
  S.holds.delete('i:' + id);
  markTaken(id, lv);
  if (m.by === S.role) {
    // 请求途中那块区块被卸载了：房主已记成拿走，本机也别再刷出来
    if (!BR.items.pick(id, 'me') && !(has(BR.items, 'find') && BR.items.find(id))) { markRemoteTaken(id, lv); lsWrite(lv, 'taken', id, true); }
  } else if (!BR.items.pick(id, 'peer')) {
    markRemoteTaken(id, lv);
    lsWrite(lv, 'taken', id, true);
  }
}

// 客机：房主拒绝了拾取。东西要么已经被房主拿走（'picked' by host 会把它从地上收掉），要么房主正拖着它
function onPickDenied(m) {
  if (S.role !== 'guest' || m.id == null) return;
  const why = m.why === 'peer' ? '队友正拿着它' : '队友先拿走了';
  toast(why, 1500);
  if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play('click', undefined, { volume: 0.25, rate: 0.75 });
  BR.bus.emit('interact:deny', { kind: 'item', key: String(m.id), why });
}

function applyRemoteTaken() {
  if (!S.remoteTaken.size || !has(BR.items, 'find') || transitioning()) return;
  const rt = S.remoteTaken.get(curLv());
  if (!rt || !rt.size) return;
  rt.forEach(id => { if (BR.items.find(id) && BR.items.pick(id, 'peer')) rt.delete(id); });
}

// =====================================================================
// 事件通道、租约、通用使用请求、状态回放（交互大改 A1；ENGINE_PLAN M6 事件通道的子集）
// =====================================================================
// 协议（除 me 里的 h / pose 外都走可靠有序通道）：
//   { t:'ev', lv, c?, n?, n0?, list:[[kind, payload], …] }  每个 coop tick 合批一次，按层分批。
//     c = 房主时钟（秒）；这一批里有 set 时 n = 房主 levelState 该层当前版本、n0 = 上一批发出时的版本，客机对不上就发 stReq
//   kind：
//     grab {k, kind}                客机→房主：申请租约
//     own  {k, by}                  房主→客机：k 现在归 'host' | 'guest' | null（放开）
//     deny {k, why}                 房主→客机：申请被拒。why：'peer' 队友拿着、'lv' 不在同一层、'gone' 东西没了、'far' 太远、'fixed' 拖不动
//     rel  {k, kind, p, a?, v?}     客机→房主：松手。p=[x,y,z] 落点；v=客机本地 levelState 里的值（房主没载入那块时直接信任）
//     set  {kind, k, v?, p?, lv}    房主→客机：levelState 改了一项（prop / item / taken / container / sw / use / veh / door …），
//                                   p=道具枢轴或物资的世界坐标；v 缺省表示删掉这一项
//     use  {k, a, p, q, x?}         客机→房主：对 k 做动作 a。p=准心命中点，x=附加参数；房主核对同层、离客机眼睛 ≤3.5 m 后交给 onUse(a)
//     ack  {q, k, a, ok, why?, r?}  房主→客机：use 的结果
//     其余 kind 由 BR.coop.emit 发、BR.coop.on 收，coop 不解释；收到的每一条（含上面这些）都转成 BR.bus 'net:'+kind
//   { t:'st', lv, v, id, part, of, st | d }  sendWorld 之后单独发：{ ls: levelState.export(lv), taken:[id…], holds:[[k,by]…], c }；
//                                            JSON 超过 32 KB 按字符切片，每片放在 d 里，客机拼齐后再解析
//   { t:'stReq', lv }                        客机要全量
//   租约 key：'p:'+道具 key、'i:'+物资 id、'e:'+实体 id、'u:'+座位 key（坐着占用）、'k:'+载具 key；'d:' 门、'v:' 电梯留给 B
//   me 追加：h（拿着租约时）按 key 前缀解析 —— 'k:' 开头 [k,x,z,yaw,steer,lift,tilt,spd]，其余 [k,x,y,z,a]，只有 [k] 时只保活；
//            pose [mode,key]（seat / lie / view / drive，这一阶段只收发）；c（房主时钟）
const LS_MAPS = { prop: 'props', item: 'items', taken: 'taken', container: 'containers', sw: 'switches', use: 'uses', veh: 'vehicles', door: 'doors', elev: 'elev', npc: 'npcs' };
const KIND_ALIAS = { props: 'prop', items: 'item', containers: 'container', switches: 'sw', 'switch': 'sw', uses: 'use', vehicles: 'veh', vehicle: 'veh', doors: 'door', npcs: 'npc' };
const PREFIX_KIND = { p: 'prop', i: 'item', e: 'entity', u: 'seat', k: 'veh', d: 'door', v: 'elev' };
const LEASE_RE = /^[a-z]:./;
const DRAG_RE = /^[pied]:/;        // 拖动类租约：暂停、打开大厅时也要松手；另外几种（座位、载具）只在死亡、换层、断线时放
const ZERO_PROP = { dx: 0, dy: 0, dz: 0, ry: 0 };
const warned = new Set();

function warnOnce(key, ...args) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[coop]', ...args);
}
function callSafe(fn, ...args) {
  if (typeof fn !== 'function') return undefined;
  try { return fn(...args); } catch (err) { console.error('[coop] 回调出错', err); return undefined; }
}
function curLv() { return String(BR.game.levelId); }
function str(v, max) { return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max || 160) : ''; }
function normKind(kind) { const s = kind == null ? '' : String(kind); return KIND_ALIAS[s] || s; }
function kindOfKey(k) { return PREFIX_KIND[k[0]] || 'other'; }
function toP(p) {
  if (Array.isArray(p) && isNum(p[0]) && isNum(p[2])) return [p[0], isNum(p[1]) ? p[1] : 0, p[2]];
  if (p && typeof p === 'object' && !Array.isArray(p) && isNum(p.x) && isNum(p.z)) return [p.x, isNum(p.y) ? p.y : 0, p.z];
  return null;
}
function r3p(p) { return p ? [r3(p[0]), r3(p[1]), r3(p[2])] : null; }
function peerHas(cap) { return !!(S.peerCaps && S.peerCaps.has(cap)); }
function capFor(k) { return k[0] === 'k' ? 'veh1' : k[0] === 'u' ? 'fx1' : 'ev1'; }
// 联机时对方支持这项功能吗（单机恒为 true）。fx1 / veh1 都骑在 ev1 的事件通道上
function can(cap) {
  if (!S.active) return true;
  if (!peerHas('ev1')) return false;
  return !cap || peerHas(cap);
}
function degradeText() {
  if (!S.active || !S.peerCaps) return '';
  if (!peerHas('ev1')) return MSG_OLD;
  const miss = [];
  if (!peerHas('fx1')) miss.push('箱子', '柜子', '座位');
  if (!peerHas('veh1')) miss.push('叉车');
  if (!miss.length) return '';
  const last = miss.pop();
  return '对方版本较旧，联机时' + (miss.length ? miss.join('、') + '和' : '') + last + '用不了';
}
function warnOld(cap) {
  const t = nowMs();
  if (t - S.oldWarnAt < 4000) return;
  S.oldWarnAt = t;
  toast(cap === 'veh1' ? '对方版本较旧，联机时开不了车' : cap === 'fx1' ? '对方版本较旧，联机时这个用不了' : MSG_OLD, 3000);
}

// ---------- levelState 适配（js/game/levelstate.js；缺模块或接口对不上时退回直接读写每层的 Map） ----------
function LSt() { return BR.levelState || null; }
function lsLevel(lv) {
  const L = LSt();
  if (!L) return null;
  try {
    if (has(L, 'peek')) return L.peek(String(lv)) || null;   // 只读，不为了查版本号凭空建一层
    return has(L, 'get') ? L.get(String(lv)) || null : null;
  } catch (err) { return null; }
}
function lsVersion(lv) { const st = lsLevel(lv); return st && isNum(st.v) ? st.v : null; }
function lsGet(lv, kind, k) {
  kind = normKind(kind);
  const L = LSt();
  if (!L) return undefined;
  try {
    if (has(L, 'getv')) {
      const v = L.getv(String(lv), kind, k);
      return kind === 'taken' ? (v ? true : undefined) : v;
    }
    if (kind === 'prop' && has(L, 'getProp')) return L.getProp(String(lv), k);
    if (kind === 'item' && has(L, 'getItem')) return L.getItem(String(lv), k);
    const st = lsLevel(lv), m = st && st[LS_MAPS[kind] || kind];
    if (m instanceof Map) return m.get(k);
    if (m instanceof Set) return m.has(k) ? true : undefined;
  } catch (err) { /* 结构对不上就当没有 */ }
  return undefined;
}
// 写一项（v 为 null / undefined = 删掉）。优先通用 set(lv, kind, key, v, meta)；客机写的是房主广播来的，meta.src='net'，
// world / items 听 'levelstate:set' 把已载入的道具、物资摆过去。缺通用 set 时依次退到 setProp / setItem / take… 和直接改 Map
function lsWrite(lv, kind, k, v) {
  kind = normKind(kind);
  lv = String(lv);
  const L = LSt();
  if (!L) return false;
  const meta = { src: S.role === 'guest' ? 'net' : 'coop' };
  try {
    if (has(L, 'set')) return L.set(lv, kind, k, v === undefined ? null : v, meta) !== false;
    const named = { prop: 'setProp', item: 'setItem', taken: 'take', container: 'setContainer', sw: 'setSwitch', use: 'setUse', veh: 'setVehicle', door: 'setDoor' }[kind];
    if (named && has(L, named)) { L[named](lv, k, v); return true; }
    const st = has(L, 'get') ? L.get(lv) : null, m = st && st[LS_MAPS[kind] || kind];
    if (!(m instanceof Map || m instanceof Set)) { warnOnce('ls:' + kind, 'levelState 里没有', kind, '这一项，跳过'); return false; }
    if (m instanceof Set) { if (v === false || v == null) m.delete(k); else m.add(k); }
    else if (v == null) m.delete(k);
    else m.set(k, v);
    st.v = (st.v | 0) + 1;
    BR.bus.emit('levelstate:set', { lv, kind, key: k, v: v == null ? null : v, ver: st.v, src: meta.src });
    return true;
  } catch (err) {
    warnOnce('lsw:' + kind, 'levelState 写入失败', kind, err);
    return false;
  }
}
function entriesOf(x) {
  if (!x) return [];
  if (x instanceof Map) return Array.from(x.entries());
  if (x instanceof Set) return Array.from(x, k => [String(k), true]);
  if (Array.isArray(x)) return x.map(e => (Array.isArray(e) ? [String(e[0]), e[1]] : [String(e), true]));
  if (typeof x === 'object') return Object.keys(x).map(k => [k, x[k]]);
  return [];
}

// ---------- 世界里的东西：位置、跟随、放下 ----------
function propRec(key) {
  if (!has(BR.world, 'propByKey')) return null;
  try { return BR.world.propByKey(key) || null; } catch (err) { return null; }
}
function recPos(r) {
  if (!r) return null;
  if (isNum(r.x) && isNum(r.z)) return [r.x, isNum(r.y) ? r.y : 0, r.z];
  const pv = r.world || r.pivot || r.pos;
  if (pv && isNum(pv.x) && isNum(pv.z)) return [pv.x, isNum(pv.y) ? pv.y : 0, pv.z];
  return null;
}
// 东西现在在哪（道具 = 枢轴世界坐标，物资 = 物资坐标，实体 = 脚底）；没载入返回 null
function objPos(k) {
  const id = k.slice(2);
  try {
    if (k[0] === 'p') return recPos(propRec(id));
    if (k[0] === 'i') {
      const it = has(BR.items, 'find') ? BR.items.find(id) : null;
      return it && isNum(it.x) && isNum(it.z) ? [it.x, isNum(it.y) ? it.y : 0, it.z] : null;
    }
    if (k[0] === 'e') {
      const e = has(BR.entities, 'get') ? BR.entities.get(id) : null;
      return e && !e.removed && isNum(e.x) ? [e.x, isNum(e.y) ? e.y : 0, e.z] : null;
    }
  } catch (err) { /* 忽略 */ }
  return null;
}
function itemHold(id, on) {
  if (!has(BR.items, 'hold')) return;
  try { BR.items.hold(id, !!on); } catch (err) { warnOnce('ihold', 'items.hold 出错', err); }
}
function movePropLive(key, p) {
  if (!p || !has(BR.world, 'movePropTo')) return false;
  try { return BR.world.movePropTo(key, p[0], p[2]) !== false; } catch (err) { warnOnce('mpt', 'world.movePropTo 出错', err); return false; }
}
function commitProp(key) {
  if (!has(BR.world, 'commitProp')) return;
  try { BR.world.commitProp(key); } catch (err) { warnOnce('cpr', 'world.commitProp 出错', err); }
}
// 把一项道具状态摆到已载入的网格上：有世界坐标 p 就 movePropTo + commitProp（两边生成一致，偏移自然一样）；
// 只有 levelState 的值 v 时用 world.applyProp(key, v)。没载入返回 false
function applyPropVisual(key, v, p) {
  if (p && propRec(key) && movePropLive(key, p)) { commitProp(key); return true; }
  const W = BR.world;
  if (v !== undefined && has(W, 'applyProp')) {
    try { return !!W.applyProp(key, v || ZERO_PROP); } catch (err) { warnOnce('apr', 'world.applyProp 出错', err); }
  }
  return false;
}
// 对方拿着时的实时显示：道具改网格（不提交），物资挪位置并停掉浮动，实体（只在房主）推向手点
function liveFollow(k, h) {
  const id = k.slice(2), p = h.p;
  if (!p) return;
  if (k[0] === 'p') {
    if (movePropLive(id, p)) {
      h.followed = true;
      // 房主：客机拖着的道具，每次跟手后核对一次，记下最后一个合法位置（松手时落点不合法就退回这里）
      if (S.role === 'host' && h.by === 'guest' && propPlaceOk(id, h)) h.validP = p.slice();
    }
  }
  else if (k[0] === 'i') {
    if (!has(BR.items, 'move') || !has(BR.items, 'find') || !BR.items.find(id)) return;
    if (!h.itemHeld) { itemHold(id, true); h.itemHeld = true; }
    try { BR.items.move(id, p[0], p[1], p[2]); } catch (err) { warnOnce('imv', 'items.move 出错', err); }
  } else if (k[0] === 'e' && S.role === 'host' && has(BR.entities, 'hold')) {
    try { BR.entities.hold(id, p[0], p[2]); } catch (err) { warnOnce('ehd', 'entities.hold 出错', err); }
  }
}
// 物资落点卡进墙里：就近挪开（房主载入了那块时）。返回挪过的点或 null（不用挪 / 挪不开）
function nudgeFree(x, y, z, r) {
  const P = BR.phys;
  if (!has(P, 'overlapCircle')) return null;
  const yf = y + 0.02, hh = 0.2;
  if (!P.overlapCircle(x, z, r, yf, hh)) return null;
  for (let d = 0.1; d <= 1.2001; d += 0.1) {
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d;
      if (!P.overlapCircle(nx, nz, r, yf, hh)) return [nx, y, nz];
    }
  }
  return null;
}
// 房主核对客机放下的道具（客机拖的时候自己已经挡过墙、出口圈和坑；这里防两边不同步）：
// 不和别的碰撞体重叠（抓起时就挨着的不算）、不压出口圈（+0.4 m）、脚下还是抓起时那块地（不悬在坑上、门廊外）
const placeBuf = [];
function propBoxNow(id) {
  if (!has(BR.world, 'propBox')) return null;
  try { return BR.world.propBox(id) || null; } catch (err) { return null; }
}
function propIgnore(id) {
  if (!has(BR.world, 'dragKeys')) return [id];
  try { const ks = BR.world.dragKeys(id); return Array.isArray(ks) && ks.length ? ks : [id]; } catch (err) { return [id]; }
}
function groundSamples(b, out) {
  const P = BR.phys;
  out.length = 0;
  if (!has(P, 'groundY')) return out;
  const ix = Math.min(0.02, (b.maxX - b.minX) * 0.25), iz = Math.min(0.02, (b.maxZ - b.minZ) * 0.25);
  const x0 = b.minX + ix, x1 = b.maxX - ix, z0 = b.minZ + iz, z1 = b.maxZ - iz;
  for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
    const g = +P.groundY(a === 0 ? x0 : a === 1 ? (x0 + x1) / 2 : x1, c === 0 ? z0 : c === 1 ? (z0 + z1) / 2 : z1);
    out.push(isNum(g) ? g : 0);
  }
  return out;
}
const gsBuf = [];
// 抓起时（hostGrab 批准 'p:' 租约那一刻）的基准：已经挨着的碰撞体、占地中心的地面、各采样点的偏差、抓起前的偏移
function propBaseline(id, h) {
  const b = propBoxNow(id);
  if (!b || !has(BR.phys, 'overlapBox')) return;
  const base = [];
  BR.phys.overlapBox(b.minX, b.minZ, b.maxX, b.maxZ, b.minY + 0.05, Math.max(0.05, b.maxY - b.minY - 0.05), { ignoreKey: propIgnore(id), out: base, tol: 0.005 });
  h.base = base;
  groundSamples(b, gsBuf);
  h.g0 = gsBuf.length ? gsBuf[4] : 0;
  h.gd0 = gsBuf.map(g => Math.abs(g - h.g0));
  // 不在地上的（货架隔板上、桌上）：改看重心下面有没有东西托着
  h.elev = b.minY - h.g0 > GROUND_TOL;
  h.sup0 = h.elev && propSupportedNow(id, b);
  h.from = lsGet(curLv(), 'prop', id);
}
function propSupportedNow(id, b) {
  const P = BR.phys;
  if (!has(P, 'overlapBox')) return true;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hw = Math.max(0.02, (b.maxX - b.minX) * 0.06), hd = Math.max(0.02, (b.maxZ - b.minZ) * 0.06);
  return P.overlapBox(cx - hw, cz - hd, cx + hw, cz + hd, b.minY - SUPPORT_TOL, SUPPORT_TOL + 0.01, { ignoreKey: propIgnore(id) }) > 0;
}
function propPlaceOk(id, h) {
  const b = propBoxNow(id), P = BR.phys;
  if (!b || !has(P, 'overlapBox')) return true;
  placeBuf.length = 0;
  P.overlapBox(b.minX, b.minZ, b.maxX, b.maxZ, b.minY + 0.05, Math.max(0.05, b.maxY - b.minY - 0.05), { ignoreKey: propIgnore(id), out: placeBuf, tol: 0.005 });
  for (let i = 0; i < placeBuf.length; i++) if (!h || !Array.isArray(h.base) || h.base.indexOf(placeBuf[i]) < 0) { placeBuf.length = 0; return false; }
  placeBuf.length = 0;
  const ex = has(BR.world, 'exits') ? BR.world.exits() : [];
  for (let i = 0; i < ex.length; i++) {
    const e = ex[i];
    if (!e || e.active === false || !isNum(e.x) || !isNum(e.z)) continue;
    if (isNum(e.y) && Math.abs(e.y - b.minY) > 2.5) continue;
    const R = (isNum(e.radius) ? e.radius : 1) + EXIT_MARGIN;
    const qx = Math.min(Math.max(e.x, b.minX), b.maxX), qz = Math.min(Math.max(e.z, b.minZ), b.maxZ);
    if ((qx - e.x) * (qx - e.x) + (qz - e.z) * (qz - e.z) < R * R) return false;
  }
  if (h && h.elev) return !h.sup0 || propSupportedNow(id, b);
  if (h && isNum(h.g0) && Array.isArray(h.gd0)) {
    groundSamples(b, gsBuf);
    for (let i = 0; i < gsBuf.length; i++) {
      const d = Math.abs(gsBuf[i] - h.g0);
      if (d > GROUND_TOL && d > (h.gd0[i] || 0) + 1e-3) return false;
    }
  }
  return true;
}
// 房主：把一件被放下的东西落到 p（客机 rel、租约超时、断线、换层时都走这里），并安排把结果广播给客机。
// h = 那条租约（有的话：客机拖的道具落点不合法时退回 h.validP，没有合法记录就退回抓起前的位置）
function finalize(k, kind, p, v, a, h) {
  const lv = curLv(), id = k.slice(2);
  p = toP(p);
  try {
    if (k[0] === 'p') {
      if (propRec(id)) {
        if (p) movePropLive(id, p);
        if (h && h.by === 'guest' && !propPlaceOk(id, h)) {
          // 落点压着别的东西、出口圈或悬空：退回最后一个合法位置；一个都没有就放回抓起前的地方
          if (h.validP) { p = h.validP.slice(); movePropLive(id, p); }
          else if (has(BR.world, 'applyProp')) {
            try { BR.world.applyProp(id, h.from || ZERO_PROP, 'host'); } catch (err) { warnOnce('apr', 'world.applyProp 出错', err); }
            p = objPos(k);
          }
        }
        commitProp(id);                       // 收尾（跟手时 movePropTo 标了 dragging）；world 写 levelState → 'levelstate:set' → 转发
      } else if (v !== undefined && v !== null) {
        lsWrite(lv, 'prop', id, v);           // 房主没载入那块：信任客机，等载入时由 world 套用
      }
      if (p) S.relP.set('prop|' + id, { lv, kind: 'prop', k: id, p });
    } else if (k[0] === 'i') {
      const it = has(BR.items, 'find') ? BR.items.find(id) : null;
      if (p && it) {
        const q = nudgeFree(p[0], p[1], p[2], 0.12);
        if (q) p = q;
        if (has(BR.items, 'move')) { try { BR.items.move(id, p[0], p[1], p[2]); } catch (err) { warnOnce('imv', 'items.move 出错', err); } }
        const cur = toP(lsGet(lv, 'item', id));
        if (!cur || Math.abs(cur[0] - p[0]) + Math.abs(cur[2] - p[2]) > 1e-3) lsWrite(lv, 'item', id, [p[0], p[1], p[2]]);
      } else if (p) {
        lsWrite(lv, 'item', id, [p[0], p[1], p[2]]);
      }
      if (it) itemHold(id, false);
      if (p) S.relP.set('item|' + id, { lv, kind: 'item', k: id, p });
    } else if (k[0] === 'e') {
      if (has(BR.entities, 'release')) BR.entities.release(id);
    } else if (k[0] === 'k') {
      if (v && typeof v === 'object') lsWrite(lv, 'veh', id, v);
    }
  } catch (err) {
    console.error('[coop] 放下出错', k, err);
  }
}
// 房主：把房主这边 k 的当前状态再发一次（客机的 rel 不合法、或过期时用来把客机拉回来）
function resendState(k) {
  const lv = curLv(), id = k.slice(2), kind = kindOfKey(k);
  if (kind !== 'prop' && kind !== 'item') return;
  const v = lsGet(lv, kind, id), p = objPos(k);
  if (v === undefined && !p) {
    if (kind === 'prop') queueSet(lv, 'prop', id, ZERO_PROP, null);
    return;
  }
  queueSet(lv, kind, id, v === undefined && kind === 'prop' ? ZERO_PROP : v, p);
}

// ---------- 队列 ----------
function queueEv(kind, p, lv) {
  if (!S.active) return false;
  S.evq.push([lv != null ? String(lv) : curLv(), kind, p === undefined ? null : p]);
  return true;
}
function queueSet(lv, kind, k, v, p) {
  const o = { kind, k, lv: String(lv) };
  if (v !== undefined) o.v = v;
  if (p) o.p = r3p(p);
  return queueEv('set', o, lv);
}
function sendBatch(b) {
  if (!b || !b.list.length) return;
  const m = { t: 'ev', lv: b.lv, list: b.list };
  if (S.role === 'host') {
    m.c = r3(clock());
    if (b.hasSet) {
      const n = lsVersion(b.lv);
      if (n != null) {
        m.n = n;
        if (S.sentN.has(b.lv)) m.n0 = S.sentN.get(b.lv);
        S.sentN.set(b.lv, n);
      }
    }
  }
  send(m);
}
function flushEv() {
  if (S.flushing || (!S.evq.length && !S.relP.size)) return;
  if (!S.active || !BR.net) { S.evq.length = 0; S.relP.clear(); return; }
  S.flushing = true;
  try {
    // 松手落点附到同一项最后一条 set 上；levelState 没写（缺模块、或写在租约放开前被跳过）就单独补一条，值现读
    if (S.relP.size) {
      for (let i = S.evq.length - 1; i >= 0 && S.relP.size; i--) {
        const e = S.evq[i];
        if (e[1] !== 'set') continue;
        const id = e[2].kind + '|' + e[2].k, r = S.relP.get(id);
        if (!r) continue;
        if (!e[2].p) e[2].p = r3p(r.p);
        S.relP.delete(id);
      }
      S.relP.forEach(r => {
        const o = { kind: r.kind, k: r.k, lv: r.lv, p: r3p(r.p) };
        const v = lsGet(r.lv, r.kind, r.k);
        if (v !== undefined) o.v = v;
        S.evq.push([r.lv, 'set', o]);
      });
      S.relP.clear();
    }
    let b = null;
    for (let i = 0; i < S.evq.length; i++) {
      const e = S.evq[i];
      if (!b || b.lv !== e[0]) { sendBatch(b); b = { lv: e[0], list: [], hasSet: false }; }
      const p = e[2];
      if (e[1] === 'rel' && p && p.fill) {
        // 客机松手时 interact 可能还没 commit：发出前现读本机 levelState，房主没载入那块时用它
        delete p.fill;
        const v = lsGet(e[0], kindOfKey(p.k), p.k.slice(2));
        if (v !== undefined) p.v = v;
      }
      if (e[1] === 'set') b.hasSet = true;
      b.list.push([e[1], p]);
    }
    sendBatch(b);
  } finally {
    S.evq.length = 0;
    S.flushing = false;
  }
}

// ---------- 时钟（房主为准；客机按收到的房主时钟估偏移，取 10 s 内最大值，单调不回退） ----------
function clock() {
  const t = nowMs() / 1000 + S.clkOff;
  if (t > S.clkLast) S.clkLast = t;
  return S.clkLast;
}
function clockSample(c) {
  if (S.role !== 'guest' || !isNum(c)) return;
  const t = nowMs();
  const a = S.clkSamples;
  a.push([t, c - t / 1000]);
  while (a.length && (t - a[0][0] > 10000 || a.length > 64)) a.shift();
  let best = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i][1] > best) best = a[i][1];
  S.clkOff = best;
}

// ---------- 对外：事件 ----------
function emitEv(kind, p) {
  kind = str(kind, 32);
  if (!kind || !S.active || !peerHas('ev1')) return false;
  return queueEv(kind, p);
}
function onEvKind(kind, fn) { return BR.bus.on('net:' + kind, fn); }

// ---------- 对外：租约 ----------
// 'me' | 'peer' | null（单机、没人拿着）
function leaseOf(k) {
  if (!S.active) return null;
  const h = S.holds.get(String(k));
  if (!h) return null;
  return h.by === S.role ? 'me' : 'peer';
}
// 返回 false = 当场被拒（cb 也已经同步收到 (false, why)）；true = 已拿到或在等房主（客机先动手、不等回复）。
// cb(ok, why) 只调一次：单机 / 房主当场调；客机等房主回 own / deny，或 4 s 没回复按 (false, 'timeout')。
// why：'peer' 队友拿着、'old' 对方版本旧、'lv' 'gone' 'far' 'fixed' 房主核对不过、'timeout'、'bad'
function requestGrab(k, kind, cb) {
  k = str(k);
  const done = (ok, why) => { callSafe(cb, ok, why); return ok; };
  if (!LEASE_RE.test(k)) return done(false, 'bad');
  if (!S.active) return done(true);
  const need = capFor(k);
  if (!can(need)) { warnOld(peerHas('ev1') ? need : 'ev1'); return done(false, 'old'); }
  kind = kind ? String(kind) : kindOfKey(k);
  const t = nowMs(), h = S.holds.get(k);
  if (h && h.by !== S.role) return done(false, 'peer');
  if (S.role === 'host') {
    if (h) { h.last = t; return done(true); }
    const why = k[0] === 'i' && takenSet(curLv()).has(k.slice(2)) ? 'gone' : '';
    if (why) return done(false, why);
    S.holds.set(k, { by: 'host', kind, since: t, last: t, p: null, a: 0 });
    queueEv('own', { k, by: 'host' });
    return done(true);
  }
  if (h && !h.pending) { h.last = t; return done(true); }
  const old = S.pend.get(k);
  if (old) callSafe(old.cb, false, 'dup');
  S.holds.set(k, { by: 'guest', kind, since: t, last: t, p: null, a: 0, pending: true });
  S.pend.set(k, { cb, t });
  queueEv('grab', { k, kind });
  return true;
}
// 松手。p = 落点 [x,y,z] 或 {x,y,z}（道具 = 枢轴世界坐标）。不是自己拿着的返回 false
function release(k, p) {
  k = str(k);
  if (!S.active) return true;
  const h = S.holds.get(k);
  if (!h || h.by !== S.role) return false;
  const pos = toP(p) || h.p || objPos(k);
  S.holds.delete(k);
  if (S.hand && S.hand.k === k) S.hand = null;
  if (S.role === 'guest') {
    const pd = S.pend.get(k);
    if (pd) { S.pend.delete(k); callSafe(pd.cb, false, 'released'); }
    clearLocalHold(k);
    const o = { k, kind: h.kind, p: r3p(pos), fill: true };
    if (isNum(h.a) && h.a) o.a = r3(h.a);
    queueEv('rel', o);
  } else {
    queueEv('own', { k, by: null });
    const kind = kindOfKey(k);
    if (pos && (kind === 'prop' || kind === 'item')) S.relP.set(kind + '|' + k.slice(2), { lv: curLv(), kind, k: k.slice(2), p: pos });
  }
  return true;
}
// 拖动中每帧报一次被拿着那件东西的位置（道具 = 枢轴世界坐标，物资 = 物资坐标，实体 = 手点）。
// 载具：hand('k:'+key, x, z, yaw, steer, lift, tilt, spd)。只在自己持有 k 的租约时才随 me 发出去
function hand(k) {
  k = str(k);
  if (!k) return;
  const v = [];
  for (let i = 1; i < arguments.length && i <= 8; i++) v.push(isNum(arguments[i]) ? arguments[i] : 0);
  S.hand = { k, v, t: nowMs() };
  const h = S.holds.get(k);
  if (h && h.by === S.role) {
    h.last = S.hand.t;
    if (k[0] !== 'k' && v.length >= 3) { h.p = [v[0], v[1], v[2]]; h.a = v[3] || 0; }
  }
}
function setPose(mode, key) {
  S.myPose = mode && mode !== 'walk' ? [String(mode).slice(0, 12), str(key)] : null;
}
function handFor(k) {
  const hd = S.hand;
  return hd && hd.k === k && nowMs() - hd.t < HAND_STALE_MS && hd.v.length >= 3 ? hd.v : null;
}
// interact 正拖着的东西：{ k: 租约 key, x, y, z, a }（拿到租约后才有）
function interactHeld() {
  const I = BR.interact;
  if (!has(I, 'heldInfo')) return null;
  let hi = null;
  try { hi = I.heldInfo(); } catch (err) { return null; }
  return hi && typeof hi.k === 'string' && isNum(hi.x) && isNum(hi.z)
    ? { k: hi.k, x: hi.x, y: isNum(hi.y) ? hi.y : 0, z: hi.z, a: isNum(hi.a) ? hi.a : 0 } : null;
}
// interact 正在拖（含等租约）的那件的租约 key；拿不到时 null
function interactLease() {
  const I = BR.interact;
  if (!I || I.state !== 'drag') return null;
  const hi = interactHeld();
  if (hi) return hi.k;
  try { const d = has(I, 'debugInfo') ? I.debugInfo().drag : null; return d && d.lease ? String(d.lease) : null; } catch (err) { return null; }
}
// me 里捎带的 h：优先 hand() 报的实时位置，其次 interact.heldInfo()（拖动中的东西），再按东西当前位置（道具、物资）；
// 都没有只发 [k] 保活
function myH() {
  if (!S.active || !S.holds.size) return undefined;
  const hd = S.hand;
  if (hd && nowMs() - hd.t < HAND_STALE_MS) {
    const h = S.holds.get(hd.k);
    if (h && h.by === S.role) return [hd.k].concat(hd.v.map(r3));
  }
  const hi = interactHeld();
  if (hi) {
    const h = S.holds.get(hi.k);
    if (h && h.by === S.role && !h.pending) {
      h.p = [hi.x, hi.y, hi.z];
      h.a = hi.a;
      return [hi.k, r3(hi.x), r3(hi.y), r3(hi.z), r3(hi.a)];
    }
  }
  let keep = null;
  for (const [k, h] of S.holds) {
    if (h.by !== S.role || h.pending || !DRAG_RE.test(k)) continue;
    const p = k[0] === 'e' ? null : objPos(k);
    if (p) return [k, r3(p[0]), r3(p[1]), r3(p[2]), r3(h.a || 0)];
    if (!keep) keep = [k];
  }
  return keep || undefined;
}
function onPeerH(h, lv) {
  if (!Array.isArray(h) || typeof h[0] !== 'string' || !h[0]) return;
  const k = h[0].slice(0, 160);
  if (k[0] === 'k' && k[1] === ':') {
    const v = h.slice(1, 8);
    if (v.length < 7 || !v.every(isNum)) return;
    S.peerH = { k, x: v[0], z: v[1], yaw: v[2], steer: v[3], lift: v[4], tilt: v[5], spd: v[6] };
    if (lv === curLv()) BR.bus.emit('net:veh', S.peerH);
    return;
  }
  if (h.length < 4) return;   // [k] 只保活
  if (!isNum(h[1]) || !isNum(h[2]) || !isNum(h[3])) return;
  S.peerH = { k, x: h[1], y: h[2], z: h[3], a: isNum(h[4]) ? h[4] : 0 };
  if (lv !== curLv() || transitioning()) return;
  const held = S.holds.get(k);
  if (!held || held.by === S.role || held.pending) return;   // 没有租约的 h 不理，免得客机随手挪东西
  held.p = [h[1], h[2], h[3]];
  held.a = S.peerH.a;
  liveFollow(k, held);
}
// 对方的保活：h 的 key 对得上，或 pose 的 key 对得上（座位 'u:' / 载具 'k:'）
function keepAlive(h, lv) {
  if (!S.holds.size || lv !== curLv()) return;
  const t = nowMs(), hk = Array.isArray(h) && typeof h[0] === 'string' ? h[0] : null;
  const pk = S.peerPose ? S.peerPose.key : null;
  S.holds.forEach((x, k) => {
    if (x.by === S.role) return;
    if (k === hk || (pk && (k.slice(2) === pk || k === pk))) x.last = t;
  });
}
function onPeerPose(p) {
  const v = Array.isArray(p) && typeof p[0] === 'string' ? { mode: p[0].slice(0, 12), key: str(p[1]) } : null;
  const sig = v ? v.mode + '|' + v.key : '';
  if (sig === S.peerPoseSig) return;
  S.peerPoseSig = sig;
  S.peerPose = v;
  BR.bus.emit('net:pose', v);
}

// ---------- 房主：处理客机的 grab / rel / use ----------
function grabCheck(k) {
  const id = k.slice(2), lv = curLv();
  if (k[0] === 'i' && takenSet(lv).has(id)) return 'gone';
  if (k[0] === 'p') { const r = propRec(id); if (r && (r.draggable === false || r.fixed)) return 'fixed'; }
  if (k[0] === 'e' && has(BR.entities, 'get') && !BR.entities.get(id)) return 'gone';
  const op = objPos(k), pp = S.peerPos;
  if (op && pp && pp.lv === lv && Math.hypot(op[0] - pp.x, op[2] - pp.z) > REL_MAX_DIST) return 'far';
  return '';
}
function hostGrab(o, lv) {
  const k = str(o.k);
  if (!LEASE_RE.test(k)) return;
  if (lv !== curLv() || transitioning()) { queueEv('deny', { k, why: 'lv' }); return; }
  if (!peerHas(capFor(k))) { queueEv('deny', { k, why: 'old' }); return; }
  const h = S.holds.get(k), t = nowMs();
  if (h && h.by === 'host') { queueEv('deny', { k, why: 'peer' }); return; }
  if (h) { h.last = t; queueEv('own', { k, by: 'guest' }); return; }
  const why = grabCheck(k);
  if (why) { queueEv('deny', { k, why }); return; }
  if (k[0] === 'e' && has(BR.entities, 'grab')) {
    let ok = true;
    try { ok = BR.entities.grab(k.slice(2), 'guest') !== false; } catch (err) { ok = false; console.error('[coop] entities.grab 出错', err); }
    if (!ok) { queueEv('deny', { k, why: 'fixed' }); return; }
  }
  const nh = { by: 'guest', kind: o.kind ? str(o.kind, 16) : kindOfKey(k), since: t, last: t, p: null, a: 0 };
  if (k[0] === 'p') propBaseline(k.slice(2), nh);
  S.holds.set(k, nh);
  queueEv('own', { k, by: 'guest' });
}
function relOk(p, lv) {
  if (!p || Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e4 || Math.abs(p[2]) > 1e6) return false;
  const pp = S.peerPos;
  if (!pp || pp.lv !== lv) return true;   // 还没收到对方位置：和拾取一样先信任
  return Math.hypot(p[0] - pp.x, p[2] - pp.z) <= REL_MAX_DIST;
}
function hostRel(o, lv) {
  const k = str(o.k);
  if (!LEASE_RE.test(k)) return;
  const h = S.holds.get(k);
  if (!h || h.by !== 'guest') { if (lv === curLv()) resendState(k); return; }   // 过期或从没拿到：把客机拉回房主这边的状态
  S.holds.delete(k);
  queueEv('own', { k, by: null });
  if (lv !== curLv()) return;   // 错层：只放锁，不落位置
  const p = toP(o.p);
  if (o.p != null && (!p || !relOk(p, lv))) {
    finalize(k, h.kind, h.p, undefined, h.a, h);   // 坐标非法或离客机太远：按房主看到的最后位置放下
    resendState(k);
    return;
  }
  finalize(k, h.kind, p || h.p, o.v, isNum(o.a) ? o.a : h.a, h);
}
function runUse(req) {
  const fn = S.useHandlers.get(req.a) || S.useHandlers.get('*');
  if (!fn) return { ok: false, why: req.by === 'peer' ? '对方版本不支持' : '用不了' };
  let res;
  try { res = fn(req); } catch (err) { console.error('[coop] use 处理出错', req.a, err); return { ok: false, why: '出错了' }; }
  if (res === true) return { ok: true };
  if (!res || typeof res !== 'object') return { ok: false };
  if (Array.isArray(res.set)) res.set.forEach(s => { if (s && s.kind && s.k != null) lsWrite(req.lv, s.kind, String(s.k), s.v); });
  const out = { ok: res.ok !== false };
  if (res.why) out.why = String(res.why).slice(0, 60);
  if (res.r !== undefined) out.r = res.r;
  return out;
}
function hostUse(o, lv) {
  const q = o.q, k = str(o.k), a = str(o.a, 32);
  const ack = res => queueEv('ack', Object.assign({ q, k, a }, res));
  if (!k || !a) { ack({ ok: false, why: 'bad' }); return; }
  if (lv !== curLv() || transitioning()) { ack({ ok: false, why: '不在同一层' }); return; }
  if (!peerHas('fx1')) { ack({ ok: false, why: '对方版本较旧' }); return; }
  const p = toP(o.p), pp = S.peerPos;
  if (!p) { ack({ ok: false, why: 'bad' }); return; }
  if (!pp || pp.lv !== lv || Math.hypot(p[0] - pp.x, p[1] - pp.y, p[2] - pp.z) > USE_MAX_DIST) { ack({ ok: false, why: '太远了' }); return; }
  ack(runUse({ k, a, p, x: o.x, by: 'peer', lv }));
}
// 对外：对 k 做动作 a（开柜门、取货、开关…）。单机 / 房主当场交给 onUse(a) 的处理函数，返回结果对象并同步调 cb；
// 客机发给房主核对，返回 null，结果到了再 cb({ ok, why?, r? })。p = 准心命中点（世界坐标），x = 附加参数（可 JSON 化）
function use(k, a, p, cb, x) {
  k = str(k);
  a = str(a, 32);
  const pos = toP(p);
  const done = res => { callSafe(cb, res); return res; };
  if (!k || !a) return done({ ok: false, why: 'bad' });
  if (!S.active || S.role === 'host') return done(runUse({ k, a, p: pos, x, by: 'me', lv: curLv() }));
  if (!can('fx1')) { warnOld(peerHas('ev1') ? 'fx1' : 'ev1'); return done({ ok: false, why: '对方版本较旧' }); }
  const q = ++S.useSeq;
  S.uses.set(q, { cb, t: nowMs(), k, a });
  const o = { k, a, p: r3p(pos), q };
  if (x !== undefined) o.x = x;
  queueEv('use', o);
  return null;
}
// 房主（和单机）处理 use 的函数：fn({ k, a, p, x, by:'me'|'peer', lv }) → true | { ok, why?, r?, set?:[{kind,k,v}] }。
// 改状态请写 levelState（会自动转发成 set）；by='peer' 时东西给客机，放进 r 让客机自己加背包
function onUse(a, fn) {
  a = str(a, 32);
  if (!a || typeof fn !== 'function') return () => {};
  S.useHandlers.set(a, fn);
  return () => { if (S.useHandlers.get(a) === fn) S.useHandlers.delete(a); };
}

// ---------- 客机：处理房主的 own / deny / set / ack ----------
function resolvePend(k, ok, why) {
  const pd = S.pend.get(k);
  if (!pd) return false;
  S.pend.delete(k);
  callSafe(pd.cb, ok, why);
  return true;
}
// interact 正拖着 k（或认不出拖的是哪件）时让它原地放下
function interactCancelIf(k, reason) {
  const I = BR.interact;
  if (!I || !has(I, 'cancel') || I.state !== 'drag') return;
  const lk = interactLease();
  if (lk && lk !== k) return;
  try { I.cancel(reason); } catch (err) { console.error('[coop] interact.cancel 出错', err); }
}
// 本机先动手、房主后来判给了队友（或等不到回复）：在本机发一条 'net:deny'，interact 按它停下（和房主真发来的 deny 同一条路）
function localDeny(k, why) {
  if (interactLease() !== k) return;
  BR.bus.emit('net:deny', { k, why, local: true });
}
function guestOwn(o, lv) {
  const k = str(o.k);
  if (!LEASE_RE.test(k) || lv !== curLv()) return;
  const h = S.holds.get(k), t = nowMs();
  if (o.by === 'guest') {
    if (!h || h.by !== 'guest') return;   // 已经松手了（rel 在路上），不再认领
    h.pending = false;
    h.last = t;
    resolvePend(k, true);
  } else if (o.by === 'host') {
    S.holds.set(k, { by: 'host', kind: kindOfKey(k), since: t, last: t, p: null, a: 0 });
    if (h && h.by === 'guest') {
      // 两人同时伸手，房主先判给了自己：本机先动手的那份作废
      clearLocalHold(k);
      if (h.pending) S.gaveUp.add(k);   // 随后房主还会对这次 grab 回 deny，别再提示一遍
      resolvePend(k, false, 'peer');
      localDeny(k, 'peer');
    }
  } else {
    if (h && h.pending) return;   // 新的申请还在路上，旧租约的放开不影响它
    S.holds.delete(k);
    if (h && h.by === 'guest') {
      // 房主替我放掉了（超时）：手上的拖动也停下（先删租约，interact 松手时就不会再发 rel）
      clearLocalHold(k);
      interactCancelIf(k, 'lost');
    }
    if (h && h.by === 'host') endFollow(k, h);
  }
}
function guestDeny(o) {
  const k = str(o.k);
  if (!LEASE_RE.test(k)) return;
  const h = S.holds.get(k);
  if (h && h.by === 'guest') { S.holds.delete(k); clearLocalHold(k); }
  const why = o.why ? str(o.why, 16) : 'peer';
  const gave = S.gaveUp.delete(k);   // 本机已经按房主的 own 放弃过这次申请（提示也已经出过）
  if (!resolvePend(k, false, why) && !gave) {
    // 不是在等的申请（比如拾取被拒、房主那边正拿着它）
    if (why === 'peer') toast('队友正拿着它', 1500);
    else if (why === 'old') warnOld(capFor(k));
    interactCancelIf(k, why);
  }
}
function heldByMe(kind, k) {
  const pre = kind === 'prop' ? 'p:' : kind === 'item' ? 'i:' : null;
  if (!pre) return false;
  const h = S.holds.get(pre + k);
  return !!(h && h.by === S.role);
}
function applySet(o, batchLv) {
  const kind = normKind(o.kind), k = str(o.k), lv = o.lv != null ? String(o.lv) : batchLv;
  if (!kind || !k || lv == null) return;
  if (guestWaitingStart()) { S.needSt = true; return; }   // 还没进房主那局：开局时会清 levelState，进层后要全量
  const here = lv === curLv() && !transitioning();
  const mine = heldByMe(kind, k);
  if (kind === 'prop') {
    // v：null = 回原位；缺省且有 p = levelState 没记值、只知道落点（不写，载入着就按 p 摆，commitProp 自己写）
    const p = toP(o.p), v = o.v !== undefined ? o.v : p ? undefined : null;
    // 写进 levelState 后 world 听 'levelstate:set' 自己把已载入的道具摆过去（自己正拖着的不动）；没写成或只有落点时自己摆
    const wrote = v !== undefined && lsWrite(lv, 'prop', k, v);
    if (here && !mine && (!wrote || v === undefined)) applyPropVisual(k, v, p);
  } else if (kind === 'item') {
    const p = toP(o.v) || toP(o.p);
    const it = here && has(BR.items, 'find') ? BR.items.find(k) : null;
    if (it && it.held && !mine) itemHold(k, false);   // 房主那边松手了：停止跟手，恢复浮动
    // items.js 听 'levelstate:set' 自己挪；没写成（缺 levelState）时自己挪
    const wrote = p ? lsWrite(lv, 'item', k, p) : o.v === null ? lsWrite(lv, 'item', k, null) : false;
    if (!wrote && it && p && !mine && has(BR.items, 'move')) {
      try { BR.items.move(k, p[0], p[1], p[2]); } catch (err) { warnOnce('imv', 'items.move 出错', err); }
    }
  } else if (kind === 'taken') {
    // 本机还刷着这件时不动它：随后到的 picked 会按谁拿的处理（自己的请求被批准时要进自己背包）
    if (!(here && has(BR.items, 'find') && BR.items.find(k))) { markTaken(k, lv); lsWrite(lv, 'taken', k, o.v === undefined ? true : o.v); }
  } else {
    lsWrite(lv, kind, k, o.v);
  }
}
function guestAck(o) {
  const u = S.uses.get(o.q);
  if (!u) return;
  S.uses.delete(o.q);
  const res = { ok: !!o.ok };
  if (o.why != null) res.why = str(o.why, 60);
  if (o.r !== undefined) res.r = o.r;
  callSafe(u.cb, res);
}

function onEv(m) {
  if (!Array.isArray(m.list)) return;
  const lv = m.lv != null ? String(m.lv) : null;
  if (S.role === 'guest') {
    clockSample(m.c);
    if (lv != null && isNum(m.n)) {
      const last = S.peerN.get(lv);
      if (isNum(m.n0) && last != null && m.n0 !== last) requestState(lv);   // 漏了一批：要全量
      S.peerN.set(lv, m.n);
    }
  }
  const n = Math.min(m.list.length, EV_MAX);
  for (let i = 0; i < n; i++) {
    const it = m.list[i];
    if (!Array.isArray(it) || typeof it[0] !== 'string' || !it[0]) continue;
    const kind = it[0].slice(0, 32), p = it[1], o = p && typeof p === 'object' && !Array.isArray(p) ? p : null;
    try {
      switch (kind) {
        case 'grab': if (S.role === 'host' && o) hostGrab(o, lv); break;
        case 'rel': if (S.role === 'host' && o) hostRel(o, lv); break;
        case 'use': if (S.role === 'host' && o) hostUse(o, lv); break;
        case 'own': if (S.role === 'guest' && o) guestOwn(o, lv); break;
        case 'deny': if (S.role === 'guest' && o) guestDeny(o); break;
        case 'set': if (S.role === 'guest' && o) applySet(o, lv); break;
        case 'ack': if (S.role === 'guest' && o) guestAck(o); break;
      }
    } catch (err) {
      console.error('[coop] 处理事件出错', kind, err);
    }
    BR.bus.emit('net:' + kind, p);
  }
}

// ---------- 状态回放 st ----------
function holdsList() { return Array.from(S.holds, ([k, h]) => [k, h.by]); }
function sendState(lv) {
  if (!S.active || S.role !== 'host' || !inCasualWorld() || !peerHas('ev1')) return;
  lv = lv != null ? String(lv) : curLv();
  const L = LSt();
  let ls = null;
  if (has(L, 'export')) { try { ls = L.export(lv) || null; } catch (err) { console.error('[coop] levelState.export 出错', lv, err); } }
  const body = { ls, taken: Array.from(takenSet(lv)), holds: lv === curLv() ? holdsList() : [], c: r3(clock()) };
  const v = lsVersion(lv);
  if (S.evq.length + S.relP.size) flushEv();   // 已经排队的 set 排在 st 前面，版本号接得上
  if (v != null) S.sentN.set(lv, v);
  const id = ++S.stSeq;
  let json;
  try { json = JSON.stringify(body); } catch (err) { console.error('[coop] st 序列化失败', err); return; }
  if (json.length <= ST_PART) { send({ t: 'st', lv, v, id, part: 0, of: 1, st: body }); return; }
  const of = Math.ceil(json.length / ST_PART);
  for (let i = 0; i < of; i++) send({ t: 'st', lv, v, id, part: i, of, d: json.slice(i * ST_PART, (i + 1) * ST_PART) });
}
function requestState(lv) {
  if (!S.active || S.role !== 'guest' || lv == null) return;
  const t = nowMs();
  if (t - S.stReqAt < ST_REQ_GAP_MS) { S.stReqLater = String(lv); return; }
  S.stReqAt = t;
  S.stReqLater = null;
  send({ t: 'stReq', lv: String(lv) });
}
// 客机还没进房主那局（等开局、种子不同、不在游玩世界里）：这时收到的状态要先存着
function guestWaitingStart() {
  return S.role === 'guest' && (!!S.guestStart || !inCasualWorld() || (S.hostSeed != null && (BR.game.seed >>> 0) !== S.hostSeed));
}
function onSt(m) {
  if (S.role !== 'guest' || m.lv == null) return;
  const lv = String(m.lv);
  let body = null;
  const of = isNum(m.of) ? Math.min(4096, Math.max(1, m.of | 0)) : 1;
  if (of > 1) {
    let b = S.stBuf;
    if (!b || b.id !== m.id || b.lv !== lv || b.of !== of) b = S.stBuf = { id: m.id, lv, of, parts: new Array(of), got: 0 };
    const i = m.part | 0;
    if (typeof m.d !== 'string' || i < 0 || i >= of || b.parts[i] != null) return;
    b.parts[i] = m.d;
    if (++b.got < of) return;
    S.stBuf = null;
    try { body = JSON.parse(b.parts.join('')); } catch (err) { console.warn('[coop] st 拼接后解析失败，重新要', err); requestState(lv); return; }
  } else {
    body = m.st;
  }
  if (!body || typeof body !== 'object') return;
  clockSample(body.c);
  const st = { lv, v: isNum(m.v) ? m.v : null, body };
  if (guestWaitingStart()) { S.stReady.set(lv, st); return; }   // 开局时（建块之前）再灌进 levelState
  // 换层途中目标层的 st 先到：直接灌进那一层（levelState 按层存，world 建块时自己套用）；已经在这一层就当场摆
  importSt(st, lv === curLv() && !transitioning());
}
// remember：开局前灌的那份记下来，进层后核对还在不在（见 onLevelEnter）
function importSt(st, live, remember) {
  const lv = st.lv, body = st.body || {};
  const L = LSt();
  const before = live ? entriesOf((lsLevel(lv) || {}).props).map(e => e[0]) : null;
  let imported = false;
  if (body.ls && has(L, 'import')) {
    // world / items 听 'levelstate:import'，把已载入的道具、物资按新记录重摆，拿走过的物资移除
    try { imported = L.import(lv, body.ls, { src: 'net' }) !== false; } catch (err) { console.error('[coop] levelState.import 出错', lv, err); }
  }
  if (st.v != null) S.peerN.set(lv, st.v);
  if (remember) S.lastImport = { lv, v: lsVersion(lv), st };
  const ts = takenSet(lv), rt = remoteSet(lv);
  const ids = new Set((Array.isArray(body.taken) ? body.taken : []).map(String));
  entriesOf(body.ls && body.ls.taken).forEach(e => ids.add(e[0]));
  ids.forEach(id => { ts.add(id); rt.add(id); });   // 本机已经刷出来的，tick 里 applyRemoteTaken 移除
  if (lv === curLv()) mirrorHolds(body.holds);
  if (live && !imported) applyLive(lv, body, before);   // 没有 levelState.import 时自己摆
  BR.bus.emit('net:st', { lv, live: !!live });
}
// 已经建好的区块按回放的状态摆一遍：道具（要 world.applyProp）、物资位置
function applyLive(lv, body, before) {
  const ls = body.ls || {};
  const seen = new Set();
  entriesOf(ls.props).forEach(([key, v]) => {
    seen.add(key);
    if (!heldByMe('prop', key)) applyPropVisual(key, v, null);
  });
  // 本机挪过、房主那边没挪过的：回原位
  if (before) before.forEach(key => { if (!seen.has(key) && !heldByMe('prop', key)) applyPropVisual(key, ZERO_PROP, null); });
  if (has(BR.items, 'find') && has(BR.items, 'move')) {
    entriesOf(ls.items).forEach(([id, pos]) => {
      const p = toP(pos);
      if (!p || heldByMe('item', id) || !BR.items.find(id)) return;
      try { BR.items.move(id, p[0], p[1], p[2]); } catch (err) { warnOnce('imv', 'items.move 出错', err); }
    });
  }
}
function mirrorHolds(list) {
  if (S.role !== 'guest' || !Array.isArray(list)) return;
  const old = new Map(S.holds);
  S.holds.clear();
  const t = nowMs();
  list.forEach(e => {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !LEASE_RE.test(e[0]) || e[1] !== 'host') return;
    const o = old.get(e[0]);
    // 原来就是房主拿着的沿用原记录（跟手显示的标记还在，松手时才收得了尾）
    S.holds.set(e[0], o && o.by === 'host' ? o : { by: 'host', kind: kindOfKey(e[0]), since: t, last: t, p: null, a: 0 });
  });
  old.forEach((h, k) => {
    if (h.by === 'host') { if (!S.holds.has(k)) endFollow(k, h); return; }
    // 自己手上的以本机为准（rel 可能还在路上）；房主说归他的，房主赢
    if (!S.holds.has(k)) { S.holds.set(k, h); return; }
    clearLocalHold(k);
    if (h.pending) S.gaveUp.add(k);
    resolvePend(k, false, 'peer');
    localDeny(k, 'peer');
  });
}

// ---------- 自己手上的租约：松手、超时、本地显示 ----------
// 暂停、死亡、打开大厅、换层、断线：持有端主动松手（dragOnly 时只放拖动类，座位和载具留着）
function releaseMine(reason, dragOnly) {
  if (!S.active || !S.holds.size) return;
  const I = BR.interact;
  if (I && has(I, 'cancel') && I.state === 'drag') {
    try { I.cancel(reason); } catch (err) { console.error('[coop] interact.cancel 出错', err); }
  }
  Array.from(S.holds).forEach(([k, h]) => {
    if (h.by !== S.role || (dragOnly && !DRAG_RE.test(k))) return;
    release(k, h.p || objPos(k));
  });
}
function entLocalHold(id, x, z) {
  const E = BR.entities;
  try {
    if (has(E, 'localHold')) { E.localHold(id, x, z); return; }
    const e = has(E, 'get') ? E.get(id) : null;
    if (!e) return;
    if (x == null) e._localHold = null;
    else e._localHold = { x, z };
  } catch (err) { warnOnce('elh', 'entities.localHold 出错', err); }
}
// 只清 coop 自己（hand() 那条路）设的本地覆盖；interact 设的由 interact 松手时自己清
function clearLocalHold(k) {
  if (k[0] !== 'e') return;
  const id = k.slice(2);
  if (!S.localHeld.has(id)) return;
  S.localHeld.delete(id);
  entLocalHold(id, null, null);
}
// 对方松手（或租约作废）：结束跟手显示。道具要 commitProp 收尾（movePropTo 标了 dragging，不收尾的话
// world 不再套用随后到的 set、包围球也不刷），物资恢复浮动；最终位置由随后的 set 摆
function endFollow(k, h) {
  if (h.followed && k[0] === 'p') { h.followed = false; commitProp(k.slice(2)); }
  if (h.itemHeld) { h.itemHeld = false; itemHold(k.slice(2), false); }
}
// 换层、断线：租约全部作废，等着的申请一律按失败回调
function clearLeases(why) {
  S.pend.forEach(pd => callSafe(pd.cb, false, why));
  S.pend.clear();
  S.holds.forEach((h, k) => { if (h.by !== S.role) endFollow(k, h); });
  S.holds.clear();
  S.localHeld.forEach(id => entLocalHold(id, null, null));
  S.localHeld.clear();
  S.gaveUp.clear();
  S.hand = null;
}
function leaseTimers() {
  const t = nowMs();
  // 客机：等房主回复超时
  S.pend.forEach((pd, k) => {
    if (t - pd.t < GRAB_WAIT_MS) return;
    S.pend.delete(k);
    const h = S.holds.get(k);
    if (h && h.by === 'guest') { S.holds.delete(k); clearLocalHold(k); queueEv('rel', { k, kind: h.kind, p: null }); }
    callSafe(pd.cb, false, 'timeout');
    localDeny(k, 'timeout');
  });
  S.uses.forEach((u, q) => {
    if (t - u.t < USE_WAIT_MS) return;
    S.uses.delete(q);
    callSafe(u.cb, { ok: false, why: '联机没有回应' });
  });
  const I = BR.interact;
  const dragging = !!(I && I.state === 'drag');
  S.holds.forEach((h, k) => {
    if (h.by === S.role) {
      // 自己的拖动类租约：拖着就续命；漏了 release（interact 已经回到空闲、也没有 hand()）就自己放
      if (!DRAG_RE.test(k) || h.pending) return;
      if (dragging || (S.hand && S.hand.k === k && t - S.hand.t < HAND_STALE_MS)) { h.last = t; return; }
      if (I && t - h.last > OWN_IDLE_MS) release(k, h.p || objPos(k));
      return;
    }
    // 房主：客机拿着的，1.5 s 没保活就按最后位置替他放下并广播
    if (S.role !== 'host' || t - h.last <= LEASE_TTL_MS) return;
    S.holds.delete(k);
    queueEv('own', { k, by: null });
    finalize(k, h.kind, h.p, undefined, h.a, h);
  });
}
// 客机拖实体：显示位置按自己的手点覆盖（房主的快照晚一拍），松手后回到快照。
// interact 自己会设 e._localHold；这里只管经 hand() 报手点的调用方
function localHolds() {
  if (S.role !== 'guest' || !S.hand || S.hand.k[0] !== 'e') return;
  const k = S.hand.k, h = S.holds.get(k), v = handFor(k);
  if (!h || h.by !== 'guest' || !v) return;
  const id = k.slice(2);
  S.localHeld.add(id);
  entLocalHold(id, v[0], v[2]);
}

// ---------- 总线 ----------
function onGameStart(p) {
  if (S.startingAsGuest) {
    // 客机开局：levelState 刚被它自己的 game:start 监听清空（levelstate.js 先加载），趁建块之前把房主的状态灌进去
    S.stReady.forEach(st => importSt(st, false, true));
    S.stReady.clear();
    return;
  }
  // 新开一局，上一局记下的拾取和状态作废
  S.myPose = null;
  S.taken.clear();
  S.remoteTaken.clear();
  S.stReady.clear();
  S.lastImport = null;
  S.peerN.clear();
  S.sentN.clear();
  clearLeases('start');
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
  if (S.active && S.role === 'host') sendWorld();
  if (!S.active || S.role !== 'guest') return;
  const st = S.stReady.get(id);
  if (st) { S.stReady.delete(id); importSt(st, true); }
  // 开局前灌进去的那份被清掉了（levelState 的 game:start 监听排在后面时）：重灌并当场摆。只核对这一次
  const li = S.lastImport;
  S.lastImport = null;
  if (li && li.lv === id && li.v != null && lsVersion(id) !== li.v) importSt(li.st, true);
  if (S.needSt) { S.needSt = false; requestState(id); }
}

// 离开一层（world.clear 发，levelId 还是旧的）：手上的都放下，排队的事件按旧层发出去，租约作废
function onLevelLeave() {
  S.myPose = null;   // 换层了还坐着 / 开着车说不通，姿态由各系统在新层重新设
  if (!S.active) return;
  releaseMine('level', false);
  if (S.role === 'host') {
    Array.from(S.holds).forEach(([k, h]) => { if (h.by === 'guest') { S.holds.delete(k); finalize(k, h.kind, h.p, undefined, h.a, h); } });
  }
  flushEv();
  clearLeases('lv');
}

function onPause(p) { if (p && p.paused) releaseMine('pause', true); }
function onDeath() { releaseMine('death', false); }

// 房主的 levelState 每写一项就转发给客机（拿着租约的道具 / 物资拖动中的逐帧写入不发，松手时发最终值）
function onLsSet(p) {
  if (!S.active || S.role !== 'host' || !p || p.src === 'net' || !peerHas('ev1')) return;
  const kind = normKind(p.kind);
  const k = p.key != null ? String(p.key) : p.k != null ? String(p.k) : null;
  if (!kind || k == null) return;
  if ((kind === 'prop' && S.holds.has('p:' + k)) || (kind === 'item' && S.holds.has('i:' + k))) return;
  queueSet(p.lv != null ? String(p.lv) : curLv(), kind, k, p.v, null);
}

function onGameHome() {
  S.myPose = null;
  S.taken.clear();
  S.remoteTaken.clear();
  S.stReady.clear();
  S.lastImport = null;
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
  S.peerPos = { x: m.x, y: m.y, z: m.z, lv, t: nowMs() };
  if (S.role === 'guest') clockSample(m.c);
  onPeerPose(m.pose);
  onPeerH(m.h, lv);
  keepAlive(m.h, lv);
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
  leaseTimers();
  localHolds();
  netSends(dt);
  if (S.stReqLater && nowMs() - S.stReqAt >= ST_REQ_GAP_MS) requestState(S.stReqLater);
  flushEv();
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
  BR.bus.on('level:leave', onLevelLeave);
  BR.bus.on('game:pause', onPause);
  BR.bus.on('player:death', onDeath);
  BR.bus.on('levelstate:set', onLsSet);
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
  // ---- 事件通道 / 租约 / 使用请求（交互大改 A1，协议见「事件通道」一节） ----
  emit: emitEv,            // emit(kind, payload) → bool：发给对方，对方收到 BR.bus 'net:'+kind；单机 / 对方旧版返回 false
  on: onEvKind,            // on(kind, fn) → 取消函数：等于 BR.bus.on('net:'+kind, fn)
  leaseOf,                 // leaseOf(k) → 'me' | 'peer' | null
  requestGrab,             // requestGrab(k, kind, cb(ok, why)) → bool
  release,                 // release(k, p) → bool
  hand,                    // hand(k, x, y, z, a) / hand('k:'+key, x, z, yaw, steer, lift, tilt, spd)：拿着时每帧报位置
  setPose,                 // setPose(mode, key)：'seat' | 'lie' | 'view' | 'drive'；'walk' 或空 = 清掉
  use,                     // use(k, a, p, cb, x) → 结果对象（单机 / 房主）| null（客机，结果走 cb）
  onUse,                   // onUse(a, fn) → 取消函数：房主（单机）处理 use 的函数
  can,                     // can(cap) → bool：'ev1' 拖动、'fx1' 使用请求与座位、'veh1' 载具；单机恒为 true
  clock,                   // clock() → 秒：联机时以房主时钟为准（冷却 readyAt、开关 sinceClk 都用它）
  get peerPose() { return S.peerPose; },   // { mode, key } | null：对方姿态（这一阶段只收发）
  get peerCaps() { return S.peerCaps ? Array.from(S.peerCaps) : null; },
  debugInfo() {
    return {
      active: S.active, role: S.role, caps: CAPS.slice(), peerCaps: S.peerCaps ? Array.from(S.peerCaps) : null,
      holds: Array.from(S.holds, ([k, h]) => [k, h.by, !!h.pending]),
      pend: Array.from(S.pend.keys()), uses: S.uses.size, handlers: Array.from(S.useHandlers.keys()),
      evq: S.evq.length, peerN: Array.from(S.peerN), sentN: Array.from(S.sentN),
      stReady: Array.from(S.stReady.keys()), stBuf: S.stBuf ? [S.stBuf.got, S.stBuf.of] : null,
      taken: Array.from(S.taken, ([lv, s]) => [lv, s.size]), remoteTaken: Array.from(S.remoteTaken, ([lv, s]) => [lv, s.size]),
      pose: S.myPose, peerPose: S.peerPose, peerH: S.peerH, clockOff: S.clkOff,
    };
  },
};

// 拾取记录要从第一局就开始记（有人中途加入时要告诉他），不等 main 调 init
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
})();
