// 后室 · 联机同步（2 人，房主权威）：联机面板、hello 校验、房主权威世界与实体、对方人形、拾取、换层、开麦与说话角标、掉线重连
// 协议见 ARCHITECTURE.md 第 9 节；网络层 BR.net（js/net/net.js）。补充约定：
// 联机营地（N1，孩子 2026-10-02）：联机只从主页「联机」进 —— 开营地 / 加入朋友的营地 → 两人在营地（隐藏层 BR.config.coop.campLevel）
//   → 帐篷里选模式和层级（js/game/coopcamp.js）→ 房主 startRun 开新一局，客机跟着 world 消息进。
//   任何 BR.MODES[mode].coop 为真的模式都能两人一起玩；「是不是同一局」统一看 sameRun()（不再只认游玩）。
//   hello 带 caps（含 'camp1'，缺了就拒绝配对）和 lv（本机已注册的 LEVEL_ORDER 层级）；
//   world 带 mode、difficulty、slot（营地出生格下标）；{ t:'spare', code } 房主把备用房号发给客机（掉线重连用）；
//   { t:'leaving' } 主动离开联机前先发：对方据此区分「点了离开」和「页面被关掉 / 刷新」（后者原地等重连，客机 3 分钟内可回来）
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
// camp1 = 联机营地这一套（营地、帐篷、startRun、备用房号重连）；对方缺它就拒绝配对。
// 测试可在页面脚本执行前设 window.__brCapsOverride（数组）模拟旧版，init 时读
const BASE_CAPS = ['ev1', 'fx1', 'veh1', 'camp1'];
let CAPS = BASE_CAPS.slice();
const CAMP_TAG = '\u2063';           // 营地暗标：net.js createRoom 接在昵称后（PHP trim 不剥它）；显示前一律去掉
const NOT_CAMP_TEXT = '这不是后室的营地：可能是火箭游戏的房间，或者对方的后室版本旧，请对方刷新后重开营地';
const OLD_VERSION_TEXT = '对方的游戏版本旧，请对方刷新页面再试';
const REJOIN_KEY = 'br_coop_rejoin';   // sessionStorage：客机 { code, host, at }，页面被关掉重开 3 分钟内可以回去
const REJOIN_MS = 3 * 60 * 1000;
const REJOIN_REFRESH_MS = 20000;   // 连着的时候每这么久刷新一次 at：3 分钟从断开那一刻算
const SPARE_WAIT_MS = 4000;        // 连通后等 net 自己报备用房号这么久，还没有就由 coop 调 spareCreate()
const RC_RETRY_MS = 3000;          // 重连途中服务器暂时连不上（断网还没恢复）：隔这么久再试
// 只有服务器暂时连不上才值得再试；打洞失败、房间关了时备用房号已经用掉 / 关掉，再试也是白等
const RC_RETRY_CODES = { unreachable: 1, timeout: 1, bad_response: 1, db_unavailable: 1 };
const BAD_MODE_TOAST_MS = 10000;   // 「这个模式本机还不能两人一起玩」最短间隔
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
  // idle | creating | hosting | checking | confirm | joining | connecting | handshake | active | reconnecting
  phase: 'idle',
  role: null,
  active: false,          // 握手完成才算联机中；world/player 靠它判断客机。重连途中为 false（phase 'reconnecting'）
  gotHello: false, helloTimer: 0,
  peerName: '', peerSkin: null,
  confirm: null,          // { code, host }：客机"同意加入"前的确认
  status: '', statusKind: '',
  hostSeed: null, hostLevel: null,
  hostMode: null, hostDiff: null,   // 客机：房主这一局的模式和难度（world 消息里带）
  peerLevels: null,       // 对方 hello 里的 lv：对方已注册的 LEVEL_ORDER 层级 id
  joinAt: null,           // { levelId, x, y, z, yaw }：客机进入该层后传送过去
  // ---- 面板（N1） ----
  view: 'start',          // 第一屏 'start' | 'join'（房主页、局内由 lobbyView 按 phase 推出来）
  viaLink: false,         // 从邀请链接打开（卡片这一步也给昵称框）
  card: null,             // 客机查到的营地卡片 { code, host?, ok?, err?, checking? }
  codeErr: '',            // 房号框下面的红字
  lookupSeq: 0,           // 每次查房号自增：过期的查询结果丢掉
  code: null,             // 房主当前的房号（续期会换）
  closeArmAt: 0, leaveArmAt: 0,
  lobbyStart: null,       // { run, timer }：从面板开局在等面板那条历史退掉（popstate 或 500ms 兜底）
  autoEnter: false,       // 房主停在房号页、朋友先连上：自动进营地（不在用户手势里）
  waitHost: false,        // 客机：已进房，房主还没回到游戏（net onPhase('waitHost')）
  lastGuestStartAt: -1e9,
  badModeAt: -1e9,
  // ---- 掉线重连（N1） ----
  spare: null,            // 备用房号：房主建好后发给客机；掉线后房主在里面等、客机加进去
  spareTimer: 0, spareBusy: false,
  rc: null,               // 重连中：{ gen, t0, deadline, notice, timer, tries }
  rcGen: 0,
  rejoin: null, rejoinErr: '',   // 主页「「X」的营地还开着，回去？」卡片
  rejoinSavedAt: 0,
  peerLeaving: false,     // 对方先发了 { t:'leaving' }：随后的 bye 是主动离开，不等重连
  unloading: false,       // 页面正在关（pagehide）：net 随后报的断开不触发重连
  hintNotice: null,       // 「点一下画面开始」横幅
  hintDone: null,         // 收起它并摘掉监听（hintCheck 在帐篷选单 / 测试面板打开时调）
  taken: new Map(),       // levelId → Set<itemId>：本局各层已被拿走的物品（房主用来回复中途加入和重复拾取）；换层不清
  remoteTaken: new Map(), // levelId → Set<itemId>：对方拿走了、但本机那块区块还没载入的物品，载入后立即移除
  peerTook: new Map(),    // itemId → 时刻：对方刚拿走的（自己同一下按空格没捡到时说「「X」先拿到了」）
  besideGo: null,         // 客机走出口换层后要站到房主身边：{ lv, x, y, z, yaw, t }
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
function cfgCoop() { return (BR.config && BR.config.coop) || {}; }
function campLevel() { return String(cfgCoop().campLevel || 'coopcamp'); }
// 营地按这个模式开局。base.js 缺这一项时（新旧文件混着用）退回第一个「能联机、实体不打人、自动刷怪」的模式
function campMode() {
  const c = cfgCoop().campMode;
  if (c) return c;
  const M = BR.MODES || {};
  return Object.keys(M).find(k => M[k] && M[k].coop && !M[k].attackPlayers && M[k].autoSpawn !== false) || null;
}
function modeCoop(m) { const M = BR.MODES && BR.MODES[m]; return !!(M && M.coop); }
function levelDef(id) { return id != null && BR.levels && has(BR.levels, 'get') ? BR.levels.get(String(id)) || null : null; }
// 当前在营地（或别的 lobby 层）里
function inCamp() {
  if (!inWorld()) return false;
  const id = String(BR.game.levelId), def = levelDef(id);
  return id === campLevel() || !!(def && def.lobby);
}
// 两人在不在「同一局」：在世界里、这一局的模式能两人一起玩；客机还要求模式和种子都是房主那一局的。
// 拾取、实体快照、换层、状态回放、跟随传送都以它为准（N1 起不再只认游玩模式）
function sameRun() {
  if (!inWorld() || !modeCoop(BR.game.mode)) return false;
  if (S.role === 'guest') {
    return S.hostMode != null && BR.game.mode === S.hostMode &&
      S.hostSeed != null && (BR.game.seed >>> 0) === S.hostSeed;
  }
  return true;
}
// 客机重连途中：本机不能自己拿、自己用（房主那边不知道，连回来后会对不上）
function guestOffline() { return S.phase === 'reconnecting' && S.role === 'guest'; }
function randomSeed() {
  try {
    const a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0] >>> 0;
  } catch (err) {
    return (Date.now() * 2654435761 + nowMs() * 40503) >>> 0;
  }
}
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

// =====================================================================
// 联机面板（DOM）：buildLobby 建骨架，renderLobby 按 S.phase / S.view 摆；协议和会话在后面「会话生命周期」以下
// 视图：start 第一屏（昵称 + 「开一个营地」「加入朋友的营地」）/ host 房号页 / join 输房号 → 卡片 → 进度 / live 局内只看状态
// =====================================================================
function lobbyView() {
  if (inWorld()) return 'live';
  if (S.role === 'host' && S.phase !== 'idle') return 'host';
  if (S.role === 'guest' || S.view === 'join' || S.phase === 'checking' || S.phase === 'confirm') return 'join';
  return 'start';
}
function idleish() { return S.phase === 'idle' || S.phase === 'checking' || S.phase === 'confirm'; }
// 房主开着营地、还没人连上（creating 时还没有房号）：hud 的房号角标、小黑板「等朋友来」都看它
function hosting() {
  return S.role === 'host' && !S.active &&
    (S.phase === 'creating' || S.phase === 'hosting' || S.phase === 'connecting' || S.phase === 'handshake');
}
function setPhase(p) {
  S.phase = p;
  renderLobby();
  renderRejoin();
}
function normCode(c) { return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function codeOf(r) {
  const c = typeof r === 'string' ? r : r && typeof r === 'object' ? r.code : null;
  const n = normCode(c);
  return n.length === 6 ? n : null;
}
// net.errorText 认得这个错误码就用它的文案（N1-net 写的实话），认不得（旧 net.js）用这里的兜底
function errT(code, fallback) {
  if (BR.net && has(BR.net, 'errorText')) {
    let t = '';
    try { t = BR.net.errorText(code); } catch (err) { t = ''; }
    if (t && !/^联机出错/.test(t)) return t;
  }
  return fallback;
}
// 给 net 的回调：onPhase('waitHost') 房主还没回到游戏；onCode(code) 房号续期换了新的；onSpare(code) 备用房号（重连用）；
// inLobby() 房主正看着面板上的房号页（这时房间没了按出错报，不悄悄续期）；name 重连用的昵称（刷新后 net 不记得）。
// net 同时也发 BR.net.on 的 'phase' / 'code' / 'spare' 事件，两条路都接，处理是幂等的（见 onNetEvent）
function netHooks() {
  return {
    onPhase: onNetPhase, onCode: onNetCode, onSpare: onNetSpare,
    inLobby: () => lobbyOpen() && lobbyView() === 'host',
    name: myName(),
  };
}
function onNetPhase(ph) {
  // 房主这边对称的一种：朋友进了营地却没应答（多半刚点完「加入」就切去微信报信了）
  if (ph === 'waitGuest' && S.role === 'host' && !S.active && !S.rc && S.phase !== 'idle') {
    setStatus('「' + (S.peerName || '朋友') + '」进了营地，等他回到游戏…');
  }
  const w = ph === 'waitHost';
  if (S.waitHost === w) return;
  S.waitHost = w;
  renderLobby();
  renderRejoin();
}
// 房号换了（建房成功、110 分钟续期、等人时服务器把房间清掉后重开）：面板、hud 角标、营地小黑板都跟着换
function onNetCode(code) {
  const c = codeOf(code);
  if (!c || S.role !== 'host') return;
  const changed = S.code !== c;
  S.code = c;
  renderLobby();
  if (changed) BR.bus.emit('coop:code', { code: c });
}

// ---------- sessionStorage 'br_coop_rejoin'：客机 { code: 备用房号, host: 房主昵称, at }，3 分钟内有效 ----------
function readRejoin() {
  let rj = null;
  try { const raw = sessionStorage.getItem(REJOIN_KEY); rj = raw ? JSON.parse(raw) : null; } catch (err) { rj = null; }
  if (!rj || typeof rj !== 'object' || !codeOf(rj.code) || !isNum(rj.at)) return null;
  if (Date.now() - rj.at > REJOIN_MS || rj.at > Date.now() + 60000) { clearRejoin(); return null; }
  return { code: codeOf(rj.code), host: stripTag(String(rj.host || '')).slice(0, 16), at: rj.at };
}
function saveRejoin() {
  if (S.role !== 'guest' || !S.spare) return;
  S.rejoinSavedAt = nowMs();
  try { sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ code: S.spare, host: S.peerName || '', at: Date.now() })); } catch (err) { /* 存不了就不能回来，不影响游戏 */ }
}
function clearRejoin() {
  try { sessionStorage.removeItem(REJOIN_KEY); } catch (err) { /* 忽略 */ }
}

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
  root.setAttribute('aria-label', '联机');
  root.addEventListener('click', e => { if (e.target === root) closeLobby('backdrop'); });
  // Esc 在 init 里挂到 document 捕获阶段（onDocKeyDown），不挂在这里

  const card = mk('div', 'coop-card', root);
  const head = mk('div', 'coop-head', card);
  D.back = btn('coop-back', '‹ 返回', head, onJoinBack);
  mk('h2', 'coop-title', head, '联机');
  D.close = btn('coop-close', '×', head, () => closeLobby('btn'));
  D.close.setAttribute('aria-label', '关闭');
  mk('p', 'coop-sub', card, '2 人 · 语音默认闭麦');
  D.armed = mk('p', 'coop-armed', card);
  D.armed.setAttribute('aria-live', 'assertive');
  D.armed.hidden = true;
  D.note = mk('p', 'coop-note', card);
  D.note.hidden = true;

  D.nameField = mk('label', 'coop-field coop-name-field', card);
  mk('span', 'coop-label', D.nameField, '昵称');
  D.name = mk('input', 'coop-input', D.nameField);
  D.name.type = 'text';
  D.name.maxLength = 15;            // 第 16 个字留给营地暗标（net.js createRoom）
  D.name.placeholder = '匿名流浪者';
  D.name.autocomplete = 'off';
  D.name.value = loadName();
  D.name.addEventListener('change', () => saveName(D.name.value.trim()));

  // ---- 第一屏 ----
  D.vStart = mk('div', 'coop-view coop-view-start', card);
  D.hostBtn = btn('coop-big-btn coop-btn-primary coop-btn-host', '开一个营地', D.vStart, onCreate);
  D.joinOpenBtn = btn('coop-big-btn coop-btn-join', '加入朋友的营地', D.vStart, onOpenJoin);

  // ---- 房号页（开营地的人） ----
  D.vHost = mk('div', 'coop-view coop-view-host', card);
  mk('p', 'coop-label coop-host-label', D.vHost, '营地房号');
  D.code = mk('div', 'coop-code', D.vHost);
  const shareRow = mk('div', 'coop-row coop-share-row', D.vHost);
  D.inviteBtn = btn('coop-btn-invite', '复制邀请链接', shareRow, onCopyInvite);
  D.copyBtn = btn('coop-btn-copy', '复制房号', shareRow, onCopyCode);
  D.shareBtn = btn('coop-btn-share', '分享', shareRow, onShare);
  D.shareBtn.hidden = true;
  D.hostHint = mk('p', 'coop-hint coop-host-hint', D.vHost, '把房号或链接发给朋友，发完马上回到游戏——你不在游戏里，朋友连不上');
  D.enterBtn = btn('coop-btn-primary coop-wide coop-btn-enter', '进营地等朋友', D.vHost, onEnterCamp);

  // ---- 加入朋友的营地 ----
  D.vJoin = mk('div', 'coop-view coop-view-join', card);
  const codeField = mk('label', 'coop-field', D.vJoin);
  mk('span', 'coop-label', codeField, '朋友的房号（6 位）');
  D.joinCode = mk('input', 'coop-input coop-code-input', codeField);
  D.joinCode.type = 'text';
  D.joinCode.maxLength = 12;        // 允许粘贴「K7M 2QX」「K7M-2QX」，收下时去掉空格和横杠
  D.joinCode.placeholder = 'K7M 2QX';
  D.joinCode.autocomplete = 'off';
  D.joinCode.spellcheck = false;
  D.joinCode.setAttribute('autocapitalize', 'characters');
  D.joinCode.setAttribute('autocorrect', 'off');
  D.joinCode.setAttribute('inputmode', 'text');
  D.joinCode.addEventListener('input', onCodeInput);
  D.joinCode.addEventListener('keydown', e => { if (e.key === 'Enter' && S.phase === 'confirm') onConfirmYes(); });
  D.codeErr = mk('p', 'coop-code-err', D.vJoin);
  D.codeErr.setAttribute('aria-live', 'assertive');
  D.campCard = mk('div', 'coop-camp-card', D.vJoin);
  D.cardTitle = mk('p', 'coop-card-title', D.campCard);
  D.cardWhy = mk('p', 'coop-card-why', D.campCard);
  D.joinBtn = btn('coop-btn-primary coop-wide coop-btn-joincamp', '加入', D.campCard, onConfirmYes);
  D.privacy = mk('p', 'coop-hint coop-privacy', D.campCard, '你的昵称和制服颜色会发给对方；开麦后对方能听到你，默认闭麦');
  D.steps = mk('ol', 'coop-steps', D.vJoin);
  D.step = [mk('li', '', D.steps, '找到营地 ✓'), mk('li', '', D.steps, '正在连线…'), mk('li', '', D.steps, '进入营地…')];

  // ---- 局内：只看联机状态 ----
  D.vLive = mk('div', 'coop-view coop-view-live', card);
  D.peerLine = mk('p', 'coop-peer-line', D.vLive);
  D.liveCode = mk('div', 'coop-code coop-code-small', D.vLive);
  // 面板（z 80）盖住了右上角的麦克风按钮，触屏又没有 V 键：接通后在这里也放一个开关，文案由 renderLobbyMic 同步
  D.lobbyMic = btn('coop-lobby-mic', '开麦', D.vLive, toggleMic);
  D.peerTip = mk('p', 'coop-hint', D.vLive);
  D.leaveBtn = btn('coop-btn-danger coop-btn-leave', '离开联机', D.vLive, onLeaveClick);

  D.status = mk('p', 'coop-status', card);
  D.status.setAttribute('aria-live', 'polite');
  D.lobby = root;
}

function renderLobby() {
  if (!D.lobby) return;
  const p = S.phase, view = lobbyView(), idle = idleish();
  const noNet = !BR.net;
  // 微信 / QQ 旧内核等没有 WebRTC：一打开就提示并禁用。不用 BR.net.available()，没配 roomApi 时它也是 false，文案会错
  const noRtc = !!BR.net && typeof RTCPeerConnection !== 'function';
  const cantNet = noNet || noRtc;
  D.note.hidden = !cantNet || view === 'live';
  D.note.textContent = noNet ? '联机模块没有加载（缺少 js/net/net.js）。' : noRtc ? BR.net.errorText('no_webrtc') : '';
  const armed = closeArmed() || leaveArmed();
  D.armed.hidden = !closeArmed();
  D.armed.textContent = closeArmed() ? '再点一次：不等朋友了' : '';
  D.close.setAttribute('aria-label', closeArmed() ? '再点一次：不等朋友了' : '关闭');
  D.close.classList.toggle('is-armed', !!armed && closeArmed());
  D.back.hidden = !(view === 'join' && idle);

  // 昵称：第一屏；从邀请链接直接进卡片时也给一个（还没填过昵称的朋友）
  D.nameField.hidden = !(view === 'start' || (view === 'join' && S.viaLink && idle));
  D.name.disabled = !idle;

  D.vStart.hidden = view !== 'start';
  D.hostBtn.disabled = D.joinOpenBtn.disabled = p !== 'idle' || cantNet;

  D.vHost.hidden = view !== 'host';
  if (view === 'host') {
    const code = S.code || '';
    D.code.textContent = code ? fmtCode(code) : '……';
    D.code.classList.toggle('is-wait', !code);
    D.inviteBtn.disabled = D.copyBtn.disabled = D.shareBtn.disabled = !code;
    D.shareBtn.hidden = !canShare();
    const busy = p === 'active' || !!S.lobbyStart;
    D.enterBtn.disabled = !code || busy;
    D.enterBtn.textContent = busy ? '进入营地…' : '进营地等朋友';
  }

  D.vJoin.hidden = view !== 'join';
  if (view === 'join') {
    D.joinCode.disabled = !idle || cantNet;
    D.codeErr.textContent = S.codeErr || '';
    D.codeErr.hidden = !S.codeErr;
    const c = S.card;
    const linking = S.role === 'guest' && !idle;
    D.campCard.hidden = !c;
    if (c) {
      D.campCard.classList.toggle('is-bad', !!c.err);
      D.cardTitle.hidden = !(c.checking || c.host != null);
      D.cardTitle.textContent = c.checking ? '正在找营地…' : c.host != null ? '「' + c.host + '」的营地' : '';
      D.cardWhy.hidden = !c.err;
      D.cardWhy.textContent = c.err || '';
      D.joinBtn.hidden = !c.ok || linking;
      D.joinBtn.disabled = p !== 'confirm';
      D.privacy.hidden = !c.ok || linking;
    }
    D.steps.hidden = !linking;
    if (linking) {
      const s1 = p === 'active' ? 'done' : 'on', s2 = p === 'active' ? 'on' : '';
      D.step[0].className = 'is-done';
      D.step[1].className = s1 === 'done' ? 'is-done' : 'is-on';
      D.step[1].textContent = s1 === 'done' ? '连上了 ✓'
        : S.waitHost ? '等「' + (S.peerName || '房主') + '」回到游戏…' : '正在连线…';
      D.step[2].className = s2 ? 'is-on' : '';
    }
  }

  D.vLive.hidden = view !== 'live';
  if (view === 'live') {
    const who = '「' + (S.peerName || '队友') + '」';
    D.peerLine.textContent = p === 'active' ? '已连接：' + who + ' · 你是' + (S.role === 'host' ? '房主' : '客机')
      : p === 'reconnecting' ? '和' + who + '的连接断了，正在重连…'
      : hosting() ? '等朋友来' + (S.peerName && p !== 'hosting' ? ' · ' + who + '正在连线…' : '')
      : p === 'creating' ? '正在开营地…'
      : p === 'idle' ? '现在是一个人玩。想和朋友一起玩：回主页点「联机」。'
      : '正在连接' + (S.peerName ? who : '') + '…';
    D.liveCode.hidden = !(hosting() && S.code);
    D.liveCode.textContent = S.code ? '房号 ' + fmtCode(S.code) : '';
    D.peerTip.hidden = p !== 'active';
    D.peerTip.textContent = BR.input && BR.input.isTouch
      ? '点上面的按钮，或关掉面板后点右上角麦克风按钮开麦 / 闭麦。'
      : '按 V 键或点屏幕右上角的麦克风按钮开麦 / 闭麦。';
    D.lobbyMic.hidden = p !== 'active';
    D.leaveBtn.hidden = p === 'idle';
    D.leaveBtn.textContent = leaveArmed() ? '再点一次：会断开联机，回到主页' : '离开联机';
    D.leaveBtn.classList.toggle('is-armed', leaveArmed());
  }
  renderLobbyMic();
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
  const v = ((D.name && D.name.value) || loadName() || '').trim().slice(0, 15);
  saveName(v);
  return v;
}

// ---------- 第一屏 ----------
function onCreate() {
  if (S.phase !== 'idle' || inWorld() || !BR.net) return;
  audioUnlock();
  openRoomOnPage('');
}
// 面板上开营地（停在房号页）。why：上一个房号被没连上的朋友占过、这是换的新房号时，写在状态行里
async function openRoomOnPage(why) {
  resetClock();
  S.role = 'host';
  S.code = null;
  S.card = null;
  S.codeErr = '';
  S.closeArmAt = 0;
  setPhase('creating');
  setStatus(why ? why + ' 正在换一个新房号…' : '正在开营地…', why ? 'err' : '');
  try {
    const r = await BR.net.createRoom(myName(), netHooks());
    if (S.phase !== 'creating') return;
    setPhase('hosting');
    onNetCode(codeOf(r) || (BR.net && BR.net.code));
    setStatus(why ? why + ' 营地换了新房号，再发给朋友一次。' : '', why ? 'err' : '');
  } catch (err) {
    if ((err && err.code === 'cancelled') || S.phase !== 'creating') return;
    endSession();
    setStatus(errText(err), 'err');
  }
}

function onOpenJoin() {
  if (S.phase !== 'idle') return;
  S.view = 'join';
  S.viaLink = false;
  S.card = null;
  S.codeErr = '';
  setStatus('');
  // 手机上不自动聚焦，免得一点就弹键盘盖住卡片；桌面直接能打字
  if (!(BR.input && BR.input.isTouch)) { try { D.joinCode.focus(); } catch (err) { /* 忽略 */ } }
}

function onJoinBack() {
  if (!idleish()) return;
  S.lookupSeq++;
  if (S.phase !== 'idle') setPhase('idle');
  S.view = 'start';
  S.viaLink = false;
  S.card = null;
  S.codeErr = '';
  setStatus('');
}

// ---------- 房号页 ----------
function fmtCode(c) { c = String(c || ''); return c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c; }
function inviteLink(code) {
  let base = '';
  try { base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.replace(/#.*$/, ''); } catch (err) { base = ''; }
  return base + '#join=' + code;
}
function canShare() { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }
function flashBtn(b, text, base) {
  b.textContent = text;
  clearTimeout(b._coopT);
  b._coopT = setTimeout(() => { b.textContent = base; }, 1500);
}
function onCopyInvite() {
  const code = S.code;
  if (!code) return;
  copyText(inviteLink(code)).then(ok => {
    flashBtn(D.inviteBtn, ok ? '已复制' : '复制失败', '复制邀请链接');
    if (!ok) setStatus('复制失败，请手动记下房号 ' + fmtCode(code), 'err');
  });
}
// 游戏里（暂停菜单）复制邀请链接：营地重开、房号续期以后，等人的一方不用回主页也能把新链接发给朋友。
// 复制不了、但能调系统分享（手机）就弹分享；返回 Promise<'copied' | 'shared' | false>
function copyInvite() {
  const code = S.code || (S.role === 'host' && BR.net && BR.net.code) || '';
  if (!code) return Promise.resolve(false);
  const url = inviteLink(code);
  return copyText(url).then(ok => {
    if (ok) return 'copied';
    if (!canShare()) return false;
    try {
      const p = navigator.share({ text: '来我的营地：房号 ' + code, url });
      if (p && typeof p.then === 'function') return p.then(() => 'shared', () => false);
      return 'shared';
    } catch (err) { return false; }
  });
}
function onCopyCode() {
  const code = S.code;
  if (!code) return;
  copyText(code).then(ok => {
    flashBtn(D.copyBtn, ok ? '已复制' : '复制失败', '复制房号');
    if (!ok) setStatus('复制失败，请手动记下房号 ' + fmtCode(code), 'err');
  });
}
function onShare() {
  const code = S.code;
  if (!code || !canShare()) return;
  try {
    const p = navigator.share({ text: '来我的营地：房号 ' + code, url: inviteLink(code) });
    if (p && typeof p.catch === 'function') p.catch(() => {});   // 用户取消分享也会 reject
  } catch (err) { /* 忽略 */ }
}
// 「进营地等朋友」：指针锁定、音频解锁都必须在点击的同步调用栈里
function onEnterCamp() {
  if (S.role !== 'host' || !S.code || S.lobbyStart || inWorld()) return;
  if (BR.input && has(BR.input, 'lock')) { try { BR.input.lock(); } catch (err) { /* 锁不上 input 会退化成拖动视角 */ } }
  audioUnlock();
  if (has(BR.audio, 'unlock')) { try { const r = BR.audio.unlock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* 忽略 */ } }
  enterCamp(false);
}
// auto：朋友先连上、房主还停在房号页，不在用户手势里——桌面锁不上指针、音频也没解锁，进去后提示点一下画面
function enterCamp(auto) {
  if (S.lobbyStart || inWorld()) return false;
  const lv = campLevel();
  if (!BR.levels.has(lv)) {
    // 新旧文件混着用：营地层没加载
    toast('页面没更新完整，请刷新', 4000);
    return false;
  }
  S.autoEnter = !!auto;
  startFromLobby({
    mode: campMode(), difficulty: null, levelId: lv,
    settings: Object.assign({}, BR.game.settings),
    seed: randomSeed(),
    coop: { role: 'host' },
  }, () => S.role === 'host' && S.phase !== 'idle', auto ? clickHint : null);
  return true;
}

// ---------- 加入朋友的营地 ----------
const BAD_CODE_RE = /[01OI]/;
// 房号框：自动转大写，去掉空格和横杠；0、O、1、I 不收并当场红字提示；满 6 位自动去查
function onCodeInput() {
  const raw = D.joinCode.value;
  let out = '', bad = false;
  const up = raw.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const ch = up[i];
    if (BAD_CODE_RE.test(ch)) { bad = true; continue; }
    if (/[A-Z2-9]/.test(ch)) out += ch;
  }
  out = out.slice(0, 6);
  if (out !== raw) D.joinCode.value = out;
  S.codeErr = bad ? '房号里没有 0、O、1、I' : '';
  // 改了房号：之前查到的卡片作废
  if (S.card && S.card.code !== out) {
    S.lookupSeq++;
    S.card = null;
    if (S.phase === 'checking' || S.phase === 'confirm') setPhase('idle');
  }
  if (out.length === 6 && S.phase === 'idle' && !(S.card && S.card.code === out)) { lookup(out); return; }
  renderLobby();
}

function hostNameOf(r) {
  if (typeof r === 'string') return stripTag(r);
  if (!r || typeof r !== 'object') return '';
  const n = r.hostName != null ? r.hostName : r.host_name != null ? r.host_name : r.host;
  return n == null ? '' : stripTag(String(n));
}
function isCampOf(r) {
  if (r && typeof r === 'object' && typeof r.isCamp === 'boolean') return r.isCamp;
  // 旧 net.js 不认暗标：自己看昵称最后一个字
  const n = typeof r === 'string' ? r : r && (r.host_name != null ? r.host_name : r.host);
  return typeof n === 'string' ? n.slice(-1) === CAMP_TAG : null;
}
function stripTag(s) { return String(s).split(CAMP_TAG).join('').trim(); }

async function lookup(code) {
  if (!BR.net || S.phase !== 'idle') return;
  const seq = ++S.lookupSeq;
  S.card = { code, checking: true };
  setPhase('checking');
  setStatus('');
  try {
    const info = await BR.net.roomInfo(code);
    if (seq !== S.lookupSeq || S.phase !== 'checking') return;
    const host = hostNameOf(info) || '房主';
    const camp = isCampOf(info);
    if (info.state === 'closed') S.card = { code, err: errT('room_closed', '营地已经关了，或者房号不对，请朋友重新开一个') };
    else if (camp === false) S.card = { code, err: errT('not_camp', NOT_CAMP_TEXT) };
    else if (info.state === 'joined') S.card = { code, host, err: errT('room_full', '这个营地已经有两个人了。') };
    else S.card = { code, host, ok: true };
    setPhase(S.card.ok ? 'confirm' : 'idle');
    renderLobby();
    // 矮横屏上卡片落在可视区下方：滚到「加入」能看见
    if (lobbyOpen()) D.campCard.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    if (seq !== S.lookupSeq || S.phase !== 'checking') return;
    S.card = { code, err: errText(err) };
    setPhase('idle');
    renderLobby();
  }
}

async function onConfirmYes() {
  if (S.phase !== 'confirm' || !S.card || !S.card.ok || !BR.net) return;
  const c = S.card;
  audioUnlock();
  resetClock();
  S.role = 'guest';
  S.peerName = c.host || '房主';
  S.waitHost = false;
  setPhase('joining');
  setStatus('');
  try {
    const r = await BR.net.joinRoom(c.code, myName(), netHooks());
    if (S.phase !== 'joining' && S.phase !== 'connecting') return;
    if (isCampOf(r) === false) {
      // 查的时候还是营地、点「加入」时换了人开房（极少）：不连
      leave(true);
      S.card = { code: c.code, err: errT('not_camp', NOT_CAMP_TEXT) };
      renderLobby();
      return;
    }
    const host = hostNameOf(r);
    if (host) S.peerName = host;
    if (S.phase === 'joining') setPhase('connecting');
    renderLobby();
  } catch (err) {
    if ((err && err.code === 'cancelled') || (S.phase !== 'joining' && S.phase !== 'connecting')) return;
    endSession();
    S.view = 'join';
    S.card = { code: c.code, host: c.host, err: errText(err) };
    setStatus('');
  }
}

// ---------- 局内：离开联机（点两次） ----------
const ARM_MS = 2500;
function leaveArmed() { return nowMs() - S.leaveArmAt < ARM_MS; }
function onLeaveClick() {
  if (S.phase === 'idle') return;
  if (!leaveArmed()) {
    S.leaveArmAt = nowMs();
    renderLobby();
    setTimeout(renderLobby, ARM_MS + 50);
    return;
  }
  S.leaveArmAt = 0;
  const wasInWorld = inWorld();
  leave();
  hideLobby(true);
  if (wasInWorld) BR.bus.emit('game:home');
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

// ---------- 打开 / 关闭 ----------
// opts.join：邀请链接里的房号，直接停在卡片这一步（仍然要点一下「加入」，这一下也用来解锁音频）。
// 在局内打开只显示当前联机状态（房号、队友、离开联机），不能新建也不能加入
function openLobby(opts) {
  init();
  buildLobby();
  const o = opts && typeof opts === 'object' ? opts : {};
  const wasHidden = D.lobby.hidden;
  const hint = BR.net && !BR.net.active && has(BR.net, 'readHint') ? BR.net.readHint() : null;
  if (hint && hint.name && !D.name.value) D.name.value = String(hint.name).split(CAMP_TAG).join('').slice(0, 15);
  if (!inWorld() && S.phase === 'idle') {
    const jc = o.join ? normCode(o.join) : '';
    if (jc) {
      S.view = 'join';
      S.viaLink = true;
      S.card = null;
      S.codeErr = '';
      D.joinCode.value = jc;
    } else if (wasHidden) {
      S.view = 'start';
      S.viaLink = false;
      S.card = null;
      S.codeErr = '';
    }
  }
  hideRejoin();
  // 游玩中打开面板等于停手：拖着的东西就地放下，免得队友那边一直显示被拿着
  if (wasHidden) releaseMine('lobby', true);
  D.lobby.hidden = false;
  S.closeArmAt = 0;
  S.leaveArmAt = 0;
  // 安卓返回键 / iOS 边缘返回手势要先关面板：打开时压一条历史记录。
  // 带上当前的 brHome（主页弹层层数），home.js 的 onPopState 算层数不受影响；已经开着就不重复压
  if (wasHidden) pushLobbyEntry();
  // 游玩中直接打开（不经暂停菜单）时要先停掉操作、放开鼠标，关面板时再还回去
  if (wasHidden && BR.input && BR.input.enabled) { S.inputWasEnabled = true; BR.input.enabled = false; }
  if (S.view === 'join' && S.phase === 'idle') onCodeInput();   // 链接带来的房号：规整一遍，满 6 位自动查
  else renderLobby();
  // 手机上不自动聚焦，免得一打开就弹键盘
  if (wasHidden && lobbyView() === 'start' && !D.name.value && !(BR.input && BR.input.isTouch)) {
    try { D.name.focus(); } catch (err) { /* 忽略 */ }
  }
}

function pushLobbyEntry() {
  try { history.pushState({ brHome: histHome(), brPanel: 'lobby' }, ''); } catch (err) { /* file:// 或沙箱不让改历史，面板照常工作 */ }
}
function histState() { try { return history.state; } catch (err) { return null; } }
function histHome() { const st = histState(); return st && typeof st.brHome === 'number' ? st.brHome : 0; }

// 房号页（营地已经开了、人还没进营地）关面板要点两次：第一次只提示「再点一次：不等朋友了」
const CLOSE_ARM_MS = 3000;
function needCloseConfirm() { return S.role === 'host' && S.phase !== 'idle' && !inWorld() && !S.lobbyStart; }
function closeArmed() { return needCloseConfirm() && nowMs() - S.closeArmAt < CLOSE_ARM_MS; }

// 用户关面板（点 ×、点背景、Esc、返回键 how='popstate'、外部直接调用）
function closeLobby(how) {
  if (!D.lobby || D.lobby.hidden) return;
  if (needCloseConfirm()) {
    if (!closeArmed()) {
      S.closeArmAt = nowMs();
      if (how === 'popstate') pushLobbyEntry();   // 返回键已经把面板那条退掉了：补回去，面板留着
      renderLobby();
      setTimeout(renderLobby, CLOSE_ARM_MS + 50);
      return;
    }
    S.closeArmAt = 0;
    leave();
    setStatus('');
  }
  hideLobby(how !== 'popstate');
}

// 收起面板。popHistory：栈顶是面板那条就 back() 退掉（返回键关的、或调用方自己退时传 false）
function hideLobby(popHistory) {
  if (!D.lobby || D.lobby.hidden) return;
  D.lobby.hidden = true;
  S.closeArmAt = 0;
  S.leaveArmAt = 0;
  if (idleish() && S.role !== 'guest') {
    // 没在连的时候关掉：下次从第一屏开始
    S.lookupSeq++;
    if (S.phase !== 'idle') setPhase('idle');
    S.view = 'start';
    S.viaLink = false;
    S.card = null;
    S.codeErr = '';
  }
  const a = document.activeElement;
  if (a && D.lobby.contains(a) && typeof a.blur === 'function') a.blur();
  if (S.inputWasEnabled && BR.input && BR.game.screen === 'playing') BR.input.enabled = true;
  S.inputWasEnabled = false;
  if (!popHistory) return;
  const st = histState();
  if (!st || st.brPanel !== 'lobby') return;
  try { history.back(); } catch (err) { /* 忽略 */ }
}

// 返回键：退到的记录不是面板那条，说明用户按了返回，关掉面板
function onPopState(e) {
  if (lobbyOpen() && !(e.state && e.state.brPanel === 'lobby')) closeLobby('popstate');
  // 从面板开局在等这次退栈：放到下一个任务再开局。在这次 popstate 里直接开的话，main.js 排在后面的 popstate 监听
  // 会把它当成 home.hide() 退弹层的那一次，真正的那一次反而被当成返回键，一开局就进暂停
  if (S.lobbyStart) setTimeout(S.lobbyStart.run, 0);
}

// Esc 关面板：挂在 document 捕获阶段并停止传播。挂在弹窗上的话焦点不在面板里就收不到，
// 而且会冒泡到 home.js 的 keydown，把底下的主页弹窗也关掉一层，两边各退一次历史，之后多出一次无效返回。
// input.js 在 window 捕获阶段更早收到这次按键，暂停键不受影响
function onDocKeyDown(e) {
  if (e.key !== 'Escape' || !lobbyOpen()) return;
  e.stopPropagation();
  closeLobby('esc');
}

function lobbyOpen() { return !!(D.lobby && !D.lobby.hidden); }

// 从面板开局（房主「进营地等朋友」、朋友连上后自动进营地、客机跟进房主的世界）：
// 栈顶是面板那条时先退掉再开局。开局时 home.hide() 会 history.go(-n) 退主页弹层，和 back() 挤在同一任务里两次遍历不可靠；
// 只 replaceState 抹掉标记的话会多留一条 { brHome } 记录，回主页后返回键要多按一次。等 popstate（onPopState 转过来），500ms 兜底。
// stillOk()：真正开局前再核对一次（等的时候断线或退出了联机就不开了）；after()：开局以后调（提示、toast）
function startFromLobby(payload, stillOk, after) {
  if (S.lobbyStart) { clearTimeout(S.lobbyStart.timer); S.lobbyStart = null; }
  const p = Object.assign({}, payload);
  S.inputWasEnabled = false;   // 开局由 main 接管输入
  hideRejoin();
  const begin = () => {
    if (typeof stillOk === 'function' && !stillOk()) { renderLobby(); return; }
    const guest = !!(p.coop && p.coop.role === 'guest');
    if (guest) S.startingAsGuest = true;
    try {
      BR.bus.emit('game:start', p);
    } finally {
      S.startingAsGuest = false;
    }
    syncGameCoop();
    if (guest) setGuestAuthority(true);
    if (typeof after === 'function') callSafe(after);
  };
  const st = histState();
  const viaLobby = lobbyOpen() && !!st && st.brPanel === 'lobby';
  hideLobby(false);
  if (!viaLobby) { begin(); return; }
  try { history.back(); } catch (err) { begin(); return; }
  const job = {
    run() {
      if (S.lobbyStart !== job) return;
      S.lobbyStart = null;
      clearTimeout(job.timer);
      begin();
    },
    timer: 0,
  };
  job.timer = setTimeout(job.run, 500);
  S.lobbyStart = job;
}

// ---------- 主页上的「回去？」卡片（客机页面被关掉重开，3 分钟内） ----------
function buildRejoin() {
  if (D.rejoin) {
    if (!document.body.contains(D.rejoin)) uiHost().appendChild(D.rejoin);
    return;
  }
  ensureStylesheet();
  const root = mk('div', 'coop-rejoin', uiHost());
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '回到营地');
  D.rejoinText = mk('p', 'coop-rejoin-text', root);
  D.rejoinWhy = mk('p', 'coop-rejoin-why', root);
  const row = mk('div', 'coop-row coop-row-end', root);
  D.rejoinNo = btn('coop-rejoin-no', '不了', row, onRejoinNo);
  D.rejoinYes = btn('coop-btn-primary coop-rejoin-yes', '回去', row, onRejoinYes);
  D.rejoin = root;
}
function showRejoin(rj) {
  if (!rj || S.phase !== 'idle' || BR.game.screen !== 'home' || lobbyOpen()) return;
  buildRejoin();
  S.rejoin = rj;
  S.rejoinErr = '';
  D.rejoin.hidden = false;
  renderRejoin();
}
function renderRejoin() {
  if (!D.rejoin || D.rejoin.hidden || !S.rejoin) return;
  const busy = S.phase !== 'idle';
  D.rejoinText.textContent = '「' + (S.rejoin.host || '房主') + '」的营地还开着，回去？';
  D.rejoinWhy.hidden = !(busy || S.rejoinErr);
  D.rejoinWhy.className = 'coop-rejoin-why' + (S.rejoinErr ? ' coop-err' : '');
  D.rejoinWhy.textContent = S.rejoinErr || (S.phase === 'active' ? '进入营地…' : S.waitHost ? '等「' + (S.rejoin.host || '房主') + '」回到游戏…' : '正在连线…');
  D.rejoinYes.hidden = !!S.rejoinErr;
  D.rejoinYes.disabled = busy;
  D.rejoinNo.textContent = S.rejoinErr ? '知道了' : busy ? '算了' : '不了';
}
function hideRejoin() {
  if (D.rejoin) D.rejoin.hidden = true;
}
function onRejoinNo() {
  if (S.phase !== 'idle' && S.role === 'guest' && !S.active) leave(true);
  S.rejoin = null;
  clearRejoin();
  hideRejoin();
}
async function onRejoinYes() {
  const rj = S.rejoin;
  if (!rj || S.phase !== 'idle' || !BR.net) return;
  audioUnlock();
  resetClock();
  S.role = 'guest';
  S.peerName = rj.host || '房主';
  S.spare = rj.code;
  S.waitHost = false;
  setPhase('joining');
  renderRejoin();
  try {
    if (has(BR.net, 'reconnectGuest')) await BR.net.reconnectGuest(rj.code, netHooks());
    else await BR.net.joinRoom(rj.code, myName(), netHooks());
    if (S.phase === 'joining') setPhase('connecting');
    renderRejoin();
  } catch (err) {
    if ((err && err.code === 'cancelled') || S.phase === 'idle') return;
    endSession();
    clearRejoin();
    S.rejoinErr = errText(err);
    renderRejoin();
  }
}

// ---------- 进页面时：邀请链接 #join=XXXXXX、没过期的「回去？」 ----------
function readJoinHash() {
  let h = '';
  try { h = String(location.hash || ''); } catch (err) { return ''; }
  const m = /^#(?:.*&)?join=([^&]*)/i.exec(h);
  if (!m) return '';
  // 读完立刻把 hash 去掉：刷新、复制地址都不会再带着它
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* 沙箱不让改 */ }
  let raw = '';
  try { raw = decodeURIComponent(m[1]); } catch (err) { raw = m[1]; }
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
// 等主页真正显示出来再弹（main.boot 之后），最多等 30 秒；刷新时停在局内就不弹
function whenHome(fn) {
  const t0 = nowMs();
  const tryIt = () => {
    if (BR.game.screen === 'home' && BR.home && BR.home.shown) { fn(); return; }
    if (inWorld() || nowMs() - t0 > 30000) return;
    setTimeout(tryIt, 200);
  };
  setTimeout(tryIt, 0);
}
function bootEntry() {
  const join = readJoinHash();
  if (join) { whenHome(() => { if (S.phase === 'idle' && !inWorld()) openLobby({ join }); }); return; }
  const rj = readRejoin();
  if (rj) whenHome(() => showRejoin(readRejoin()));
}
// 游戏已经开着、又点了一次邀请链接（同一个地址只换 hash，页面不重新加载）
function onHashChange() {
  const join = readJoinHash();
  if (join) whenHome(() => { if (S.phase === 'idle' && !inWorld()) openLobby({ join }); });
}

// ---------- 会话生命周期 ----------
// BR.game.coop：重连途中两边原地等，仍按联机算（客机不自己换层、不自己写 levelState、拾取照样问房主）；BR.coop.active 这时为 false
function syncGameCoop() {
  const live = S.active || S.phase === 'reconnecting';
  const role = live ? S.role : null;
  const c = BR.game.coop;
  if (!c || typeof c !== 'object') { BR.game.coop = { active: live, role }; return; }
  // main 在 game:start 时可能整体覆盖它，只在不一致时改
  if (c.active !== live) c.active = live;
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

// 本机已注册的 LEVEL_ORDER 层级（hello 的 lv）：帐篷选单据此把队友没有的层灰掉
function myLevels() {
  return (BR.LEVEL_ORDER || []).map(String).filter(id => BR.levels && has(BR.levels, 'has') && BR.levels.has(id));
}

function activate() {
  S.active = true;
  S.phase = 'active';
  S.waitHost = false;
  S.peerLeaving = false;
  S.sentN.clear();
  S.peerN.clear();
  syncGameCoop();
  if (S.role === 'guest') setGuestAuthority(true);
  buildHud();
  renderMic();
  const who = '「' + S.peerName + '」';
  if (S.role === 'host') {
    // 房主停在房号页、朋友先连上：自动进营地。不在用户手势里，进去后提示点一下画面（startFromLobby 的 after）
    const willCamp = inCamp() || !!S.lobbyStart || (!inWorld() && enterCamp(true));
    setStatus('已和' + who + '连上。', 'ok');
    toast(willCamp ? who + '来到了营地' : who + '加入了联机', 3000);
    sendWorld();
    if (S.spare) sendSpare();   // net 在握手前就报了备用房号
    else scheduleSpare();
  } else {
    S.spare = null;   // 从「回去？」卡片连回来时用的是旧备用房号，已经用掉；房主马上发新的
    setStatus('');
    toast('已连上' + who, 3000);
  }
  maybeSkinHint();
  renderRejoin();
  // 对方版本旧：关掉对应的联机功能并提示（排在「加入了联机」后面，免得被它盖掉）
  const miss = degradeText();
  if (miss) setTimeout(() => { if (S.active) toast(miss, 5000); }, 3200);
  BR.bus.emit('coop:connected', { role: S.role, name: S.peerName });
}

// 两人连上、都在营地里时颜色一样：提示去挂钩换一件（每次联机只提示一次）
function maybeSkinHint() {
  if (S.skinHinted || !S.active || !inCamp() || !S.peerSkin || S.peerSkin !== mySkin()) return;
  S.skinHinted = true;
  const s = Array.isArray(BR.SKINS) ? BR.SKINS.find(x => x.key === S.peerSkin) : null;
  setTimeout(() => {
    if (S.active && inCamp() && S.peerSkin === mySkin()) toast('你们都穿' + ((s && s.zh) || '一样的颜色') + '，可以去柱子上的挂钩换一件', 4500);
  }, 3400);
}

function endSession() {
  const live = S.active || S.phase === 'reconnecting';
  const wasGuest = live && S.role === 'guest';
  if (S.active) {
    // 断线：手上拖着的就地放下；房主替客机把它拿着的东西按最后位置放下（写进本机 levelState，之后单机照样在那儿）
    releaseMine('net', false);
    if (S.role === 'host') {
      Array.from(S.holds).forEach(([k, h]) => { if (h.by === 'guest') { S.holds.delete(k); finalize(k, h.kind, h.p, undefined, h.a, h); } });
    }
  }
  stopRc();
  clearLeases('net');
  S.evq.length = 0;
  S.relP.clear();
  S.uses.forEach(u => callSafe(u.cb, { ok: false, why: '联机已断开' }));
  S.uses.clear();
  if (S.helloTimer) clearTimeout(S.helloTimer);
  if (S.spareTimer) clearTimeout(S.spareTimer);
  if (S.lobbyStart) { clearTimeout(S.lobbyStart.timer); S.lobbyStart = null; }   // 还在等退栈的开局作废
  Object.assign(S, {
    active: false, gotHello: false, helloTimer: 0, phase: 'idle', role: null, confirm: null,
    peerName: '', peerSkin: null, hostSeed: null, hostLevel: null, hostMode: null, hostDiff: null, peerLevels: null, joinAt: null,
    micOn: false, micBusy: false, localLevel: 0, peerLevel: 0, localHold: 0, peerHold: 0,
    peerCaps: null, peerPose: null, peerPoseSig: '', peerH: null, peerPos: null, hand: null,
    stBuf: null, lastImport: null, needSt: false, stReqLater: null,
    code: null, spare: null, spareSent: null, spareTimer: 0, spareBusy: false, waitHost: false, autoEnter: false,
    peerLeaving: false, skinHinted: false, closeArmAt: 0, leaveArmAt: 0,
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
  renderRejoin();
}

// quiet：不发 { t:'leaving' }、不清「回去？」记录（出错、被拒、对方先走时）。BR.coop.leave() 是玩家主动离开
function leave(quiet) {
  if (quiet !== true) {
    if (S.active) send({ t: 'leaving' });   // 和随后 net 的 bye 同一条有序通道：对方知道这是主动离开，不等重连
    clearRejoin();
  }
  if (BR.net && (BR.net.active || S.phase !== 'idle')) BR.net.leave();
  endSession();
}

function otherGame(noHello) {
  const t = noHello ? '这是别的游戏的房间（对方没有发来后室的握手），已断开。' : '这是别的游戏的房间，已断开。';
  failNotActive(t, true);
}

// 还没连上（加入、建连、握手途中）就失败了：结束会话，把原因写在看得见的地方（卡片、状态行、「回去？」卡片、toast）
// 房主已经在营地里等人、朋友这一次没连上（打洞失败、对方旧版、进错房）：原来的房间已经被占过，原地换一个新房号接着等
function failNotActive(t, close) {
  const card = S.card;
  const campHost = S.role === 'host' && inWorld();
  const pageHost = S.role === 'host' && !inWorld() && S.phase !== 'creating' && lobbyOpen() && lobbyView() === 'host';
  const peer = S.peerName;
  if (close) leave(true); else endSession();
  const why = (peer ? '「' + peer + '」没连上：' : '') + t;
  // 自动换新房号 5 分钟内最多 3 次：服务器一直出错时别没完没了地开房
  const now = nowMs();
  S.reopenAt = (S.reopenAt || []).filter(x => now - x < 300000);
  const canReopen = S.reopenAt.length < 3 && !!BR.net;
  if (campHost) {
    toast(why, 6000);
    if (canReopen) { S.reopenAt.push(now); createRoomInPlace(); }
    return;
  }
  if (pageHost && canReopen) { S.reopenAt.push(now); openRoomOnPage(why); return; }
  if (card && card.code) {
    S.view = 'join';
    S.card = { code: card.code, host: card.host, err: t };
    setStatus('');
  } else {
    setStatus(t, 'err');
  }
  if (D.rejoin && !D.rejoin.hidden && S.rejoin) { S.rejoinErr = t; renderRejoin(); }
  else if (!lobbyOpen()) toast(t, 5000);
}

function onNetEvent(type, data) {
  switch (type) {
    case 'status':
      if (S.phase !== 'idle' && S.phase !== 'active' && S.phase !== 'reconnecting') setStatus(data);
      break;
    case 'peerJoined':
      if (S.role !== 'host' || S.rc) break;
      S.peerName = stripTag(String(data || '对方')).slice(0, 16) || '对方';
      S.phase = 'connecting';
      setStatus('「' + S.peerName + '」进入了营地，正在连线…');
      break;
    case 'phase': onNetPhase(data); break;
    case 'code': onNetCode(data); break;
    case 'spare': onNetSpare(data); break;
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
  if (!S.rc) S.phase = 'handshake';   // 重连途中 phase 保持 'reconnecting'，hello 对上才算连回来
  S.gotHello = false;
  S.waitHost = false;
  if (!S.rc) setStatus('已连通，正在核对游戏…');
  renderRejoin();
  send({
    t: 'hello', game: 'backrooms', v: BR.config.version, name: stripTag((BR.net && BR.net.myName) || ''),
    skin: mySkin(), caps: CAPS.slice(), lv: myLevels(),
  });
  if (S.helloTimer) clearTimeout(S.helloTimer);
  S.helloTimer = setTimeout(() => {
    S.helloTimer = 0;
    if (S.gotHello) return;
    if (S.rc) rcFailed('lost');
    else if (S.phase === 'handshake') otherGame(true);
  }, HELLO_TIMEOUT_MS);
}

// 页面正在关（pagehide；net 随后报 'disconnected' reason 'closed'）：不重连，客机记下「回去？」的时间点
function pageGone() {
  if (S.role === 'guest' && S.spare) saveRejoin();
  endSession();
}

function onDisconnected(info) {
  if (S.phase === 'idle') return;
  if (S.unloading || info.reason === 'closed') { pageGone(); return; }
  // net 掉线时把房主留着的备用房号一起报上来（客机刷新页面发的软 bye 也走这里，byPeer 为真）
  if (S.role === 'host' && codeOf(info.spare) && !S.rc) S.spare = codeOf(info.spare);
  if (S.rc) { rcFailed(info.reason || 'lost'); return; }
  if (S.active && inWorld()) {
    if (canReconnect()) enterReconnect();
    else peerGone('lost');
    return;
  }
  const wasActive = S.active, name = S.peerName;
  failNotActive(wasActive ? '和「' + name + '」的连接断开了。' : errText({ code: info.reason }), false);
}

// 对方发了 bye：主动离开联机，或者房主关掉 / 刷新了页面（房主回不到原来那一局）。
// 客机关掉 / 刷新页面发的是软 bye，net 按掉线报 'disconnected'，房主原地等它从「回去？」卡片回来
function onPeerLeft() {
  if (S.phase === 'idle') return;
  if (S.rc) { rcFailed('left'); return; }
  if (S.active && inWorld()) { peerGone(S.peerLeaving ? 'left' : 'lost'); return; }
  if (!S.active && S.role === 'host' && inWorld()) { failNotActive('对方走了', false); return; }
  const wasActive = S.active, name = S.peerName || '对方';
  endSession();
  const t = wasActive ? '「' + name + '」离开了联机。' : errT('room_closed', '营地已经关了，或者房号不对，请朋友重新开一个');
  setStatus(t, wasActive ? '' : 'err');
  if (D.rejoin && !D.rejoin.hidden && S.rejoin) { S.rejoinErr = t; renderRejoin(); }
  toast(t, 4000);
}

function onNetError(e) {
  if (!e.fatal || S.phase === 'idle') return;
  if (S.rc) { rcFailed(e.code); return; }
  if (S.active && inWorld()) {
    if (canReconnect()) enterReconnect();
    else peerGone('lost');
    return;
  }
  // 房主等人时房间没了（net 自己续期失败才会报到这里）：failNotActive 原地换一个新房号接着等（有次数上限）
  failNotActive(e.text || errText(e), false);
}

// ---------- 消息 ----------
function onMsg(m) {
  if (!m || typeof m.t !== 'string') return;
  if (!S.gotHello) {
    // 第一条必须是后室的 hello；火箭游戏的房间号段相同，进错房会先收到它的消息
    if (m.t !== 'hello' || m.game !== 'backrooms') {
      if (S.rc) rcFailed('other');
      else otherGame(false);
      return;
    }
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
    case 'spare': if (S.role === 'guest') onSpareMsg(m.code); break;
    case 'leaving': S.peerLeaving = true; break;
  }
}

function onHello(m) {
  if (S.helloTimer) { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  S.gotHello = true;
  if (m.name) S.peerName = stripTag(String(m.name)).slice(0, 16);
  if (!S.peerName) S.peerName = S.role === 'host' ? '客机' : '房主';
  S.peerCaps = new Set(Array.isArray(m.caps) ? m.caps.filter(c => typeof c === 'string').slice(0, 32) : []);
  // 对方没有营地这一套（旧版）：拒绝配对。旧版那边只会看到这边离开、回到 idle
  if (!S.peerCaps.has('camp1')) { refuseOld(); return; }
  S.peerLevels = Array.isArray(m.lv)
    ? m.lv.filter(x => typeof x === 'string' || typeof x === 'number').map(x => String(x).slice(0, 16)).slice(0, 128)
    : [];
  onSkin(m.skin);
  if (m.v !== BR.config.version) {
    toast('双方游戏版本不同（我 ' + BR.config.version + ' / 对方 ' + m.v + '），可能出现不同步', 5000);
  }
  if (S.rc) resumeAfterReconnect();
  else activate();
}

function refuseOld() {
  const t = errT('old_version', OLD_VERSION_TEXT);
  if (S.rc) { peerGone('old'); toast(t, 5000); return; }
  failNotActive(t, true);
}

function onSkin(key) {
  if (typeof key !== 'string') return;
  if (Array.isArray(BR.SKINS) && !BR.SKINS.some(s => s.key === key)) return;
  S.peerSkin = key;   // updateAvatar 发现与已上的颜色不同会重新上色
}

// ---------- 备用房号（掉线重连用） ----------
// 房主：连通后由 net 建一个备用房间（net 自己建好报 onSpare / 'spare'；等 SPARE_WAIT_MS 还没有就由这里调 spareCreate()），
// 从数据通道 { t:'spare', code } 发给客机；net 每 100 分钟换一个新的，照样报上来再发
function netSpare() {
  const n = BR.net;
  let v = null;
  try { v = n ? (n.spare != null ? n.spare : n.spareCode) : null; } catch (err) { v = null; }
  return codeOf(v);
}
function onNetSpare(code) {
  const c = codeOf(code);
  if (!c || S.role !== 'host') return;
  if (S.spareTimer) { clearTimeout(S.spareTimer); S.spareTimer = 0; }
  if (S.rc && S.rc.code === c) return;   // 正在用它重连
  if (S.spare === c && S.spareSent === c) return;   // hooks 和事件各报一次
  S.spare = c;
  sendSpare();
}
function sendSpare() {
  if (!S.active || S.role !== 'host' || !S.spare) return;
  if (send({ t: 'spare', code: S.spare })) S.spareSent = S.spare;
}
function scheduleSpare() {
  if (S.role !== 'host' || !BR.net) return;
  if (S.spareTimer) clearTimeout(S.spareTimer);
  S.spareTimer = setTimeout(() => {
    S.spareTimer = 0;
    if (S.role !== 'host' || !S.active || S.spare) return;
    const k = netSpare();
    if (k && !(S.rc && S.rc.code === k)) { onNetSpare(k); return; }
    if (!has(BR.net, 'spareCreate') || S.spareBusy) return;
    S.spareBusy = true;
    let pr;
    try { pr = BR.net.spareCreate(); } catch (err) { pr = Promise.reject(err); }
    Promise.resolve(pr).then(c => { S.spareBusy = false; onNetSpare(c); }, err => {
      S.spareBusy = false;
      console.warn('[coop] 备用房号没建成，掉线后不能自动重连', (err && err.code) || err);
    });
  }, SPARE_WAIT_MS);
}
function onSpareMsg(code) {
  const c = codeOf(code);
  if (!c) return;
  S.spare = c;
  saveRejoin();
}

// ---------- 掉线重连 ----------
// 数据通道断了、两人又在同一局里：两边原地不动，房主在备用房里等（reconnectHost），客机加进去（reconnectGuest），
// 连上后照常 hello、world，对方人形恢复。reconnectSec 秒内没连上、或者有人点了「不等了」，就当对方走了（coop:peerGone）
function rcSec() { return Math.max(5, +cfgCoop().reconnectSec || 90); }
function canReconnect() {
  if (!S.spare || !BR.net || !inWorld() || S.unloading) return false;
  if (!has(BR.net, S.role === 'host' ? 'reconnectHost' : 'reconnectGuest')) return false;
  return sameRun();
}
function enterReconnect() {
  // 手上的都放下（和断线一样），但不结束会话：角色、队友名字、本局拾取记录、备用房号都留着
  releaseMine('net', false);
  if (S.role === 'host') {
    Array.from(S.holds).forEach(([k, h]) => { if (h.by === 'guest') { S.holds.delete(k); finalize(k, h.kind, h.p, undefined, h.a, h); } });
  }
  clearLeases('net');
  S.evq.length = 0;
  S.relP.clear();
  S.uses.forEach(u => callSafe(u.cb, { ok: false, why: '连接断了' }));
  S.uses.clear();
  if (S.helloTimer) { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  const wasGuest = S.role === 'guest';
  Object.assign(S, {
    active: false, gotHello: false, phase: 'reconnecting', waitHost: false, peerLeaving: false,
    micOn: false, micBusy: false, localLevel: 0, peerLevel: 0, localHold: 0, peerHold: 0,
    peerPose: null, peerPoseSig: '', peerH: null, hand: null, stBuf: null,
  });
  const t = nowMs();
  S.rc = { gen: ++S.rcGen, t0: t, deadline: t + rcSec() * 1000, notice: null, timer: 0, code: S.spare, tries: 0 };
  R.lastRecv = -1e9;   // 人形马上藏起来（updateAvatar 看它）
  if (R.obj) R.obj.visible = false;
  if (R.tag) R.tag.visible = false;
  if (wasGuest) { setGuestAuthority(true); saveRejoin(); }
  syncGameCoop();
  detachMeter('local');
  detachMeter('peer');
  renderMic();
  renderBadges();
  renderLobby();
  showRcNotice();
  BR.bus.emit('coop:reconnecting', { role: S.role, name: S.peerName });
  rcAttempt();
}
function showRcNotice() {
  const rc = S.rc;
  if (!rc) return;
  const text = '连接断了，正在重连…（最多 ' + rcSec() + ' 秒）';
  if (has(BR.hud, 'notice')) {
    try { rc.notice = BR.hud.notice(text, [{ label: '不等了', fn: () => { giveUpRc('user'); } }], 0, { keep: true }); }
    catch (err) { rc.notice = null; console.warn('[coop] hud.notice 出错', err); }
  }
  if (!rc.notice) toast(text, 5000);
}
function rcAttempt() {
  const rc = S.rc;
  if (!rc || !BR.net) return;
  rc.timer = 0;
  rc.tries++;
  S.gotHello = false;
  const gen = rc.gen, fn = S.role === 'host' ? 'reconnectHost' : 'reconnectGuest';
  let pr;
  try { pr = BR.net[fn](rc.code, netHooks()); } catch (err) { pr = Promise.reject(err); }
  Promise.resolve(pr).then(() => {}, err => {
    if (S.rc && S.rc.gen === gen && !S.active) rcFailed((err && err.code) || 'lost');
  });
}
// 这一次没连上：服务器暂时连不上（断网还没恢复）且时间还够，就隔一会儿再试；打洞失败、房间关了、对方走了就不等了
function rcFailed(code) {
  const rc = S.rc;
  if (!rc || code === 'cancelled') return;
  if (rc.timer) return;   // 已经排了下一次
  if (S.helloTimer) { clearTimeout(S.helloTimer); S.helloTimer = 0; }
  S.gotHello = false;
  S.waitHost = false;
  if (RC_RETRY_CODES[code] && rc.deadline - nowMs() > RC_RETRY_MS) {
    rc.timer = setTimeout(() => { if (S.rc === rc) rcAttempt(); }, RC_RETRY_MS);
    return;
  }
  giveUpRc(code === 'left' ? 'left' : 'lost');
}
function giveUpRc(why) {
  if (!S.rc) return;
  peerGone(why === 'user' ? 'gaveup' : why || 'lost');
}
function stopRc() {
  const rc = S.rc;
  if (!rc) return;
  S.rc = null;
  if (rc.timer) clearTimeout(rc.timer);
  if (rc.notice) { try { rc.notice.close(); } catch (err) { /* 已关 */ } }
}
// 每帧（和看门狗）核对重连有没有超时
function rcTick() {
  const rc = S.rc;
  if (rc && !S.active && nowMs() > rc.deadline) giveUpRc('timeout');
}
function resumeAfterReconnect() {
  const rc = S.rc;
  stopRc();
  if (rc && S.spare === rc.code) S.spare = null;   // 用掉的备用房号作废，房主马上换一个新的
  S.active = true;
  S.phase = 'active';
  S.waitHost = false;
  S.peerLeaving = false;
  S.sentN.clear();
  S.peerN.clear();
  syncGameCoop();
  if (S.role === 'guest') setGuestAuthority(true);
  buildHud();
  renderMic();
  renderLobby();
  toast('「' + S.peerName + '」连回来了', 2500);
  if (S.role === 'host') {
    sendWorld();   // 客机在同一局里就留在原地（onWorld 不算 fresh、不传送），只补状态
    S.spareSent = null;
    if (S.spare) sendSpare();
    else scheduleSpare();
  }
  BR.bus.emit('coop:reconnected', { role: S.role, name: S.peerName });
}

// 对方走了（主动离开、掉线没连回来、点了「不等了」）：这一局变回单人。
// 在营地里由 BR.coopCamp 弹「「X」离开了营地」（再开一个营地等朋友 / 回主页）；在关卡里 toast，暂停菜单跟着恢复成单人
function peerGone(why) {
  const name = S.peerName || '队友';
  const world = inWorld();
  const where = inCamp() ? 'camp' : 'level';
  leave(true);
  clearRejoin();
  if (world) {
    if (where === 'level') toast('「' + name + '」' + (why === 'left' ? '离开了联机' : '断开了') + '，你接着一个人玩', 4500);
    else if (!BR.coopCamp) toast('「' + name + '」离开了营地', 4500);
  }
  setStatus('');
  BR.bus.emit('coop:peerGone', { where, name, why: why || 'lost' });
}

// 营地里落单（coop:peerGone where 'camp'）：原地重新开房、角色切成房主，不重开世界。返回 Promise<房号 | false>
async function createRoomInPlace() {
  if (!BR.net || !inWorld()) return false;
  if (S.phase !== 'idle') return hosting() && S.code ? S.code : false;
  S.role = 'host';
  S.code = null;
  setPhase('creating');
  try {
    const r = await BR.net.createRoom(myName(), netHooks());
    if (S.phase !== 'creating') return false;
    setPhase('hosting');
    onNetCode(codeOf(r) || (BR.net && BR.net.code));
    return S.code || false;
  } catch (err) {
    if ((err && err.code === 'cancelled') || S.phase !== 'creating') return false;
    endSession();
    toast(errText(err), 5000);
    return false;
  }
}

// ---------- 世界与换层（房主权威） ----------
// 营地出生格：两个 spawnSlots 里挑离房主远、而且没被东西占着（overlapCircle 为 false）的那一格；都占着就不给，客机落到房主身边
function spawnSlot(lv) {
  const def = levelDef(lv), slots = def && def.spawnSlots;
  if (!Array.isArray(slots) || !slots.length) return undefined;
  const P = BR.player, ph = BR.phys;
  const pr = (BR.config.player && BR.config.player.radius) || 0.3;
  let best = -1, bd = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || !isNum(s.x) || !isNum(s.z)) continue;
    let busy = false;
    if (has(ph, 'overlapCircle')) { try { busy = !!ph.overlapCircle(s.x, s.z, pr, isNum(s.y) ? s.y : null, 1.6); } catch (err) { busy = false; } }
    if (busy) continue;
    const d = P && isNum(P.x) && isNum(P.z) ? U.dist2(P.x, P.z, s.x, s.z) : 0;
    if (d > bd) { bd = d; best = i; }
  }
  return best >= 0 ? best : undefined;
}

function sendWorld() {
  if (!S.active || S.role !== 'host' || !sameRun()) return;
  const P = BR.player, lv = curLv();
  // 房主如果在工坊地图里，把整张地图对象带给客机：客机没有本机存储里那份，靠这个激活同一张图（第 9 节）
  const wsMap = BR.workshop && BR.workshop.active && !BR.workshop.editing ? BR.workshop.active : undefined;
  const m = {
    t: 'world', seed: BR.game.seed >>> 0, levelId: lv,
    mode: BR.game.mode, difficulty: BR.game.difficulty == null ? null : BR.game.difficulty,
    settings: Object.assign({}, BR.game.settings),
    picked: Array.from(takenSet(lv)),
    at: P && isNum(P.x) && isNum(P.z) ? { x: r2(P.x), y: r2(P.y - eyeHeight()), z: r2(P.z), yaw: r3(P.yaw || 0) } : null,
    workshopMap: wsMap,
    c: r3(clock()),
  };
  const slot = spawnSlot(lv);
  if (slot !== undefined) m.slot = slot;
  send(m);
  // 本层被改过的状态单独发（world 可能已经带着 200 KB 的工坊地图，不往里塞）
  sendState(lv);
}

function badMode() {
  const t = nowMs();
  if (t - S.badModeAt < BAD_MODE_TOAST_MS) return;
  S.badModeAt = t;
  toast('这个模式本机还不能两人一起玩', 4000);
}

function onWorld(m) {
  if (S.role !== 'guest' || !isNum(m.seed) || m.levelId == null || typeof m.mode !== 'string') return;
  const seed = m.seed >>> 0, lv = String(m.levelId), mode = m.mode;
  const diff = m.difficulty == null ? null : String(m.difficulty);
  if (!BR.levels.has(lv)) { toast('房主所在的层级 ' + lv + ' 本机没有（双方版本不同？）', 5000); return; }
  if (!modeCoop(mode)) { badMode(); return; }
  clockSample(m.c);
  const fresh = !inWorld() || BR.game.mode !== mode || (BR.game.difficulty == null ? null : String(BR.game.difficulty)) !== diff ||
    (BR.game.seed >>> 0) !== seed;
  if (fresh) {
    // 新的一局：上一局（营地、上一层）记下的拾取和状态作废，免得同 id 的东西在新世界里被误删
    S.taken.clear();
    S.remoteTaken.clear();
    S.stReady.clear();
    S.lastImport = null;
  }
  S.hostSeed = seed;
  S.hostLevel = lv;
  S.hostMode = mode;
  S.hostDiff = diff;
  const ids = Array.isArray(m.picked) ? m.picked.map(String) : [];
  const ts = takenSet(lv), rt = remoteSet(lv);
  ids.forEach(id => { ts.add(id); rt.add(id); });
  if (fresh) {
    if (BR.game.screen === 'loading') return;   // 正在开局（main 同步建块中）：随后的 reconcile 会再要
    startAsGuest(m, lv, seed, mode, diff);
  } else if (curLv() !== lv) {
    goToLevel(lv);
  }
}

function hiddenLevel(id) { const d = levelDef(id); return !!(d && (d.hidden || d.lobby)); }
// 客机进房主的世界后站在哪：营地按房主挑的出生格；别的层（帐篷出发、中途加入）站到房主身边（beside：进层后 besideHost 找空地）
function joinPoint(m, lv) {
  const def = levelDef(lv), slots = def && def.spawnSlots;
  if (Array.isArray(slots) && isNum(m.slot)) {
    const s = slots[m.slot | 0];
    if (s && isNum(s.x) && isNum(s.z)) return { levelId: lv, x: s.x, y: isNum(s.y) ? s.y : 0, z: s.z, yaw: isNum(s.yaw) ? s.yaw : 0, t: nowMs() };
  }
  const at = m.at;
  return at && isNum(at.x) && isNum(at.z)
    ? { levelId: lv, x: at.x, y: isNum(at.y) ? at.y : 0, z: at.z, yaw: isNum(at.yaw) ? at.yaw : 0, t: nowMs(), beside: true }
    : null;
}
// 客机按房主的位置落地时别和房主站同一个点（两个人互相看不见，像钻进了对方身体里）：在房主右手边（不行就左手边、身后、身前、
// 四个斜角）1 m（再不行 1.4 m）找一块空地；从房主到那里一路不能有墙，地面高度差不过 0.35 m。都不行返回 null（和房主站同一点）。
// 进层、区块建好以后才调（要用碰撞体）
function besideHost(j) {
  const P = BR.phys;
  if (!has(P, 'overlapCircle')) return null;
  const R = BR.config.player && BR.config.player.radius;
  const pr = (isNum(R) ? R : 0.3) + 0.05;
  const yaw = isNum(j.yaw) ? j.yaw : 0;
  // 玩家朝向约定：前方 (-sin yaw, -cos yaw)，右手 (cos yaw, -sin yaw)
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const s = Math.SQRT1_2;
  const dirs = [[rx, rz], [-rx, -rz], [-fx, -fz], [fx, fz],
    [(rx - fx) * s, (rz - fz) * s], [(-rx - fx) * s, (-rz - fz) * s], [(rx + fx) * s, (rz + fz) * s], [(-rx + fx) * s, (-rz + fz) * s]];
  const gy = (x, z) => { try { const v = has(P, 'groundY') ? P.groundY(x, z) : null; return isNum(v) ? v : null; } catch (err) { return null; } };
  const y0 = gy(j.x, j.z);
  try {
    for (const D of [1.0, 1.4]) {
      for (let i = 0; i < dirs.length; i++) {
        const dx = dirs[i][0] * D, dz = dirs[i][1] * D, x = j.x + dx, z = j.z + dz;
        let ok = !P.overlapCircle(x, z, pr, null, 1.6);
        for (let k = 1; k < 4 && ok; k++) if (P.overlapCircle(j.x + dx * k / 4, j.z + dz * k / 4, 0.12, null, 1.6)) ok = false;
        if (!ok) continue;
        const y1 = gy(x, z);
        if (y0 != null && y1 != null && Math.abs(y1 - y0) > 0.35) continue;
        return { x, y: y1 != null ? y1 : j.y, z };
      }
    }
  } catch (err) { return null; }
  return null;
}

function startAsGuest(m, lv, seed, mode, diff) {
  const mine = BR.game.settings || {};
  const settings = Object.assign({}, mine, m.settings || {});
  // 画质按本机性能、能见度按本机习惯，不跟房主
  ['quality', 'visibility'].forEach(k => { if (mine[k] !== undefined) settings[k] = mine[k]; else delete settings[k]; });
  // 主页记下的起始层不能被营地这类隐藏层改掉
  if (!hiddenLevel(lv)) settings.startLevel = lv;
  else if (mine.startLevel !== undefined) settings.startLevel = mine.startLevel;
  else delete settings.startLevel;
  S.joinAt = joinPoint(m, lv);
  S.lastGuestStartAt = nowMs();
  const first = !inWorld(), host = S.peerName || '房主';
  startFromLobby({
    mode, difficulty: diff, settings, seed, levelId: lv, coop: { role: 'guest' },
    // 客机激活房主同步来的地图对象（不写本机存储）：main.js 的 onGameStart 认 workshop 字段，是对象就直接用
    workshop: m.workshopMap || undefined,
  }, () => S.active && S.role === 'guest' && S.hostSeed === seed, () => {
    if (!first) return;
    toast(hiddenLevel(lv) ? '来到了「' + host + '」的营地' : '已进入「' + host + '」的世界', 2500);
    clickHint();
  });
}

// 房主开新一局（帐篷出发、回营地）：补上 coop:{role:'host'} 再开局；客机等 world 消息跟进。只给房主用
function startRun(payload) {
  if (S.role !== 'host' || S.phase === 'idle') return false;
  const p = Object.assign({}, payload || {}, { coop: { role: 'host' } });
  if (!modeCoop(p.mode)) { toast('这个模式还不能两人一起玩', 3000); return false; }
  BR.bus.emit('game:start', p);
  syncGameCoop();
  return true;
}

// force：房主明确广播的换层，即使是同一层（比如 Level Dev 的"回到 Level Dev"圈，出生点重置）也要跟着重进
// beside：进层后站到房主身边（走出口换层：两人落在同一个到达点，见 besideAfterGo）
function goToLevel(lv, kind, force, beside) {
  if (!has(BR.world, 'goTo') || (!force && String(BR.game.levelId) === lv)) return;
  BR.world.goTo(lv, kind ? { kind } : undefined).then(() => { if (beside) besideAfterGo(lv); })
    .catch(err => console.error('[coop] 跟随换层失败', lv, err));
}

function onLevel(m) {
  if (S.role !== 'guest' || m.to == null) return;
  S.hostLevel = String(m.to);
  if (sameRun()) goToLevel(S.hostLevel, m.kind, true, true);
}
// 走出口换层：房主和客机按同一个种子落在同一个到达点，两人叠在一起、互相看不见（2026-10-05 返修）。
// 客机进层后记下落点，下一帧（区块建好、换层过场结束）站到房主右手边 1 m 的空地上（besideHost，和帐篷出发、中途加入同一套）；
// 那之前自己已经走开了（> 0.5 m）就不挪
function besideAfterGo(lv) {
  const P = BR.player;
  if (S.role !== 'guest' || !S.active || !P || String(BR.game.levelId) !== String(lv) || !isNum(P.x) || !isNum(P.z)) return;
  S.besideGo = { lv: String(lv), x: P.x, y: P.y - eyeHeight(), z: P.z, yaw: isNum(P.yaw) ? P.yaw : 0, t: nowMs() };
}
function applyBesideGo() {
  const j = S.besideGo;
  if (!j) return;
  if (nowMs() - j.t > 5000 || String(BR.game.levelId) !== j.lv || S.role !== 'guest' || !S.active) { S.besideGo = null; return; }
  if (transitioning() || !has(BR.player, 'reset')) return;
  S.besideGo = null;
  const P = BR.player;
  if (!isNum(P.x) || !isNum(P.z) || U.dist2(P.x, P.z, j.x, j.z) > 0.25) return;
  const b = besideHost(j);
  if (b) BR.player.reset({ x: b.x, y: b.y, z: b.z, yaw: P.yaw }, { full: false });
}

function onExitReq(m) {
  if (S.role !== 'host' || m.to == null || !sameRun() || transitioning()) return;
  const to = String(m.to), here = String(BR.game.levelId);
  // 客机还在旧层时发出的过期请求不理，随后的 world 会把它拉到正确的层
  if (m.from != null && String(m.from) !== here) return;
  // 同层出口（to === here）也要换：客机走进"回到本层"的圈，房主不理的话这个出口在客机上就是死的
  if (!BR.levels.has(to)) return;
  BR.world.goTo(to, { kind: m.kind }).catch(err => console.error('[coop] 换层失败', to, err));
  send({ t: 'level', to, kind: m.kind });
}

function onExitReach(p) {
  if (!S.active || !p || p.to == null || !sameRun()) return;
  const to = String(p.to);
  if (S.role === 'guest') {
    // world.js 看到客机就不自己换层，转给房主决定
    send({ t: 'exitReq', to, kind: p.kind, from: String(BR.game.levelId) });
  } else if (!transitioning()) {
    // exit:reach 在 world.goTo 之前发出；已经在换层说明这次会被合并掉，不广播
    send({ t: 'level', to, kind: p.kind });
  }
}

// 客机兜底：消息在对方换层途中被合并掉时，每秒核对一次是不是同一局、同一层
function reconcile(dt) {
  if (S.role !== 'guest' || !S.hostLevel) return;
  S.reconcileAcc += dt;
  if (S.reconcileAcc < RECONCILE_S) return;
  S.reconcileAcc = 0;
  if (!inWorld() || transitioning() || BR.game.screen === 'dead' || S.lobbyStart) return;
  if (!sameRun()) { if (modeCoop(S.hostMode)) send({ t: 'worldReq' }); return; }
  if (String(BR.game.levelId) !== S.hostLevel) goToLevel(S.hostLevel);
}

// 客机进房主的世界：传送到出生格 / 房主身边，并把周围区块当场建完，免得走进还没生成的墙里
function applyJoinAt() {
  const j = S.joinAt;
  if (!j) return;
  if (nowMs() - j.t > 15000) { S.joinAt = null; return; }
  if (!sameRun() || transitioning() || String(BR.game.levelId) !== j.levelId || !has(BR.player, 'reset')) return;
  S.joinAt = null;
  BR.player.reset({ x: j.x, y: j.y, z: j.z, yaw: j.yaw }, { full: false });
  if (has(BR.world, 'update') && has(BR.world, 'debugInfo')) {
    BR.world.update(0);   // world.update 每次只建 1 块
    for (let i = 0; i < 64 && BR.world.current && BR.world.debugInfo().queued > 0; i++) BR.world.update(0);
  }
  // 按房主位置落地的：区块（碰撞体）建好了，再挪到房主身边的空地上
  if (j.beside) {
    const b = besideHost(j);
    if (b) BR.player.reset({ x: b.x, y: b.y, z: b.z, yaw: j.yaw }, { full: false });
  }
}

// 不在用户手势里开的局（房主自动进营地、客机跟进房主）：桌面锁不上指针、音频可能没解锁，提示点一下画面。
// 不自动消失（房主可能还在微信里，回来时还要看得到），点一下画面 / 锁上指针 / 回主页才关
function clickHint() {
  const touch = !!(BR.input && BR.input.isTouch);
  const lockedNow = !!document.pointerLockElement;
  const audioLocked = !!(BR.audio && BR.audio.unlocked === false);
  if ((touch || lockedNow) && !audioLocked) return;
  if (typeof S.hintDone === 'function') S.hintDone();
  if (S.hintNotice) { try { S.hintNotice.close(); } catch (err) { /* 忽略 */ } S.hintNotice = null; }
  const text = '点一下画面开始';
  if (has(BR.hud, 'notice')) {
    // hud-notice-pass：横幅不接点击，点在它上面也落到画面上锁住指针（2026-10-05 返修 r2：原来点横幅只把它关了，之后转不了视角）
    try { S.hintNotice = BR.hud.notice(text, [], 0, { cls: 'hud-notice-pass' }); } catch (err) { S.hintNotice = null; }
  }
  if (!S.hintNotice) { toast(text, 4000); return; }
  const h = S.hintNotice;
  const done = e => {
    // 点在别的横幅的按钮上不收：这一下先把这条收了，下面那条横幅往上一挪，按钮就点空了（同 coopcamp lockHint）
    if (e && e.type === 'pointerdown' && e.target && e.target.closest && e.target.closest('.hud-notices')) return;
    document.removeEventListener('pointerlockchange', done);
    window.removeEventListener('pointerdown', done, true);
    if (S.hintNotice === h) { S.hintNotice = null; S.hintDone = null; }
    try { h.close(); } catch (err) { /* 忽略 */ }
  };
  S.hintDone = done;
  document.addEventListener('pointerlockchange', done);
  window.addEventListener('pointerdown', done, true);
}
// 帐篷选单、测试面板开着时横幅（z 65）会盖住它们的标题和按钮：一打开就收起（玩家显然已经在操作了）
function hintCheck() {
  const h = S.hintNotice;
  if (!h) return;
  const cc = BR.coopCamp;
  let busy = !!(cc && cc.panelOpen);
  if (!busy) { try { busy = document.documentElement.classList.contains('br-test-open'); } catch (err) { busy = false; } }
  if (!busy && BR.game.screen !== 'home') return;
  if (typeof S.hintDone === 'function') S.hintDone();
  else { S.hintNotice = null; try { h.close(); } catch (err) { /* 忽略 */ } }
}

// ---------- 实体（只在房主模拟） ----------
function sendEnts() {
  const E = BR.entities;
  if (!has(E, 'snapshot') || !sameRun() || transitioning()) return;
  let list;
  try { list = E.snapshot(); } catch (err) {
    if (!S.entsErr) { S.entsErr = true; console.error('[coop] entities.snapshot 出错', err); }
    return;
  }
  send({ t: 'ents', lv: String(BR.game.levelId), list }, true);
}

function onEnts(m) {
  if (S.role !== 'guest' || !Array.isArray(m.list) || !sameRun() || transitioning()) return;
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
  if (guestOffline()) { toast('正在重连，连上了再捡', 1500); return; }
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
  if (S.role !== 'host' || m.id == null || !sameRun() || !has(BR.items, 'pick')) return;
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
  notePeerTook(id);
  send({ t: 'picked', id, by: 'guest', type: here ? here.type : undefined });
}
// 对方刚拿走的东西（id → 时刻）：自己同时按了空格、没捡到时说一声「「X」先拿到了」（2026-10-05 返修：以前一点提示都没有）
const PEER_TOOK_MS = 3000;
function notePeerTook(id) {
  const t = nowMs();
  S.peerTook.set(String(id), t);
  if (S.peerTook.size > 32) S.peerTook.forEach((v, k) => { if (t - v > PEER_TOOK_MS) S.peerTook.delete(k); });
}
function peerName() { return S.peerName || '队友'; }
// interact：对准、按下了空格，那件东西却在这一下里没了（被对方先拿走，或者别的原因消失）
function onItemGone(p) {
  if (!S.active || !p) return;
  const id = p.id != null ? String(p.id) : p.key != null ? String(p.key) : '';
  const at = id ? S.peerTook.get(id) : undefined;
  if (at === undefined || nowMs() - at > PEER_TOOK_MS) return;
  S.peerTook.delete(id);
  toast('「' + peerName() + '」先拿到了', 1600);
}

// 单机或同一局里（任何能联机的模式，含测试模式）都记：之前只认游玩，测试模式里房主捡了东西客机那边还在，会复制
function onItemPickup(p) {
  if (!p || p.id == null) return;
  if (S.active && !sameRun()) return;
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
  } else {
    notePeerTook(id);
    if (!BR.items.pick(id, 'peer')) {
      markRemoteTaken(id, lv);
      lsWrite(lv, 'taken', id, true);
    }
  }
}

// 客机：房主拒绝了拾取。东西要么已经被房主拿走（'picked' by host 会把它从地上收掉），要么房主正拖着它
function onPickDenied(m) {
  if (S.role !== 'guest' || m.id == null) return;
  const why = m.why === 'peer' ? '「' + peerName() + '」正拿着它' : '「' + peerName() + '」先拿到了';
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
// 道具占地 b 压没压着禁放区：出口圈（radius + EXIT_MARGIN）和层级的 keepClear（营地门前通道、帐篷过道之类）。
// 和本地拖动同一套：BR.world.blockers({ margin }) → [{kind:'exit', x,z,r,y?} | {kind:'keep', x,z,r} | {kind:'keep', x0,z0,x1,z1}]
// （世界坐标，出口圈的 r 已经外扩过 margin，keepClear 原样）；旧 world.js 没有它时退回只看出口圈
function blockedAt(b) {
  let list = null;
  if (has(BR.world, 'blockers')) { try { list = BR.world.blockers({ margin: EXIT_MARGIN }); } catch (err) { list = null; } }
  if (!Array.isArray(list)) {
    list = [];
    let ex = null;
    if (has(BR.world, 'exits')) { try { ex = BR.world.exits(); } catch (err) { ex = null; } }
    (Array.isArray(ex) ? ex : []).forEach(e => {
      if (e && e.active !== false && isNum(e.x) && isNum(e.z)) list.push({ x: e.x, y: e.y, z: e.z, r: (isNum(e.radius) ? e.radius : 1) + EXIT_MARGIN });
    });
  }
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    if (isNum(e.y) && Math.abs(e.y - b.minY) > 2.5) continue;   // 不同高度的出口（楼上楼下）不算
    if (isNum(e.x0) && isNum(e.z0) && isNum(e.x1) && isNum(e.z1)) {
      const x0 = Math.min(e.x0, e.x1), x1 = Math.max(e.x0, e.x1), z0 = Math.min(e.z0, e.z1), z1 = Math.max(e.z0, e.z1);
      if (b.maxX > x0 && b.minX < x1 && b.maxZ > z0 && b.minZ < z1) return true;
      continue;
    }
    if (!isNum(e.x) || !isNum(e.z) || !isNum(e.r)) continue;
    const qx = Math.min(Math.max(e.x, b.minX), b.maxX), qz = Math.min(Math.max(e.z, b.minZ), b.maxZ);
    if ((qx - e.x) * (qx - e.x) + (qz - e.z) * (qz - e.z) < e.r * e.r) return true;
  }
  return false;
}
function propPlaceOk(id, h) {
  const b = propBoxNow(id), P = BR.phys;
  if (!b || !has(P, 'overlapBox')) return true;
  placeBuf.length = 0;
  P.overlapBox(b.minX, b.minZ, b.maxX, b.maxZ, b.minY + 0.05, Math.max(0.05, b.maxY - b.minY - 0.05), { ignoreKey: propIgnore(id), out: placeBuf, tol: 0.005 });
  for (let i = 0; i < placeBuf.length; i++) if (!h || !Array.isArray(h.base) || h.base.indexOf(placeBuf[i]) < 0) { placeBuf.length = 0; return false; }
  placeBuf.length = 0;
  if (blockedAt(b)) return false;
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
// 客机还没收到房主的时钟（刚加入、样本清空了）：先按本机时间给，但不记进 clkLast——本页比房主页面开得早时，
// 本机时间比房主时钟大，记下来以后 clock() 只增不减，就会卡在这个值上不走（2026-10-05 返修）
function clock() {
  const t = nowMs() / 1000 + S.clkOff;
  if (S.role === 'guest' && !S.clkSamples.length) return t;
  if (t > S.clkLast) S.clkLast = t;
  return S.clkLast;
}
// 新开一次联机（面板上开营地、加入朋友、从「回去？」卡片回去）：时钟从头估。旧值留着的话，这页之前用过时钟（自己开过营地、
// 进过帐篷、用过售货机、当过别人的房主或客机）又去加入一个页面开得更晚的朋友时，clkLast 比房主时钟大好几分钟，
// clock() 停着不走，帐篷倒数一到客机这边立刻黑幕、也取消不了。营地里落单原地重开房（createRoomInPlace）不清：同一个世界接着用
function resetClock() {
  S.clkOff = 0;
  S.clkLast = 0;
  S.clkSamples.length = 0;
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
  if (guestOffline()) { toast('正在重连，连上了再拿', 1500); return done(false, 'net'); }
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
// 对外：对 k 做动作 a（开柜门、取货、开关、帐篷选单…）。单机 / 房主当场交给 onUse(a) 的处理函数，返回结果对象并同步调 cb；
// 房主核对 p 离客机眼睛 ≤3.5 m（USE_MAX_DIST）：准心打不到实物的动作（比如帐篷选单 'tent'）p 就传客机自己的眼睛坐标。
// 客机发给房主核对，返回 null，结果到了再 cb({ ok, why?, r? })。p = 准心命中点（世界坐标），x = 附加参数（可 JSON 化）
function use(k, a, p, cb, x) {
  k = str(k);
  a = str(a, 32);
  const pos = toP(p);
  const done = res => { callSafe(cb, res); return res; };
  if (!k || !a) return done({ ok: false, why: 'bad' });
  if (guestOffline()) return done({ ok: false, why: '正在重连' });
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
  if (!S.active || S.role !== 'host' || !sameRun() || !peerHas('ev1')) return;
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
// 客机还没进房主那局（等开局、模式或种子不同、不在世界里）：这时收到的状态要先存着
function guestWaitingStart() {
  return S.role === 'guest' && (!!S.lobbyStart || !sameRun());
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
  hideRejoin();   // 主页上的「回去？」卡片只在主页有意义
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
  if (!p || !p.coop) {
    // 主页单人开局（游玩 / 噩梦 / 测试弹窗、工坊地图）：两人一起玩只走 主页「联机」→ 营地 → 帐篷，开着的营地关掉
    const host = S.role === 'host';
    leave();
    const t = host ? '已关闭营地' : '已退出联机';
    setStatus(t);
    toast(t, 3000);
    return;
  }
  if (!modeCoop(p.mode)) {
    leave();
    const t = '这个模式还不能两人一起玩';
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
  if (S.active) maybeSkinHint();
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
  if (S.hintNotice) { try { S.hintNotice.close(); } catch (err) { /* 忽略 */ } S.hintNotice = null; }
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
// voice：iOS 上对方语音改走的 GainNode（见 routeVoice）；vol：设置里的「联机语音音量」0..1
const A = { ctx: null, sink: null, local: null, peer: null, voice: null, vol: 1 };

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
  // iOS 来电 / Siri 之后是 'interrupted'：对方语音走 GainNode 时（routeVoice）不恢复就一直没声音
  if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted') && ctx.resume) ctx.resume().catch(() => {});
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
    an.connect(A.sink);   // 只量电平；对方的声音由 net.js 的 <audio> 播放（iOS 调小音量时例外，见 routeVoice）
    A[which] = { src, an, buf: new Uint8Array(an.fftSize) };
  } catch (err) {
    console.warn('[coop] 音量检测接不上', which, err);
  }
  if (which === 'peer') routeVoice();
}

function detachMeter(which) {
  const m = A[which];
  if (!m) return;
  if (which === 'peer') unrouteVoice();
  try { m.src.disconnect(); m.an.disconnect(); } catch (err) { /* 已断开 */ }
  A[which] = null;
}

// 对方语音音量（设置「联机语音音量」）：net.js 记住并设到 <audio>.volume，之后的新流、重连都照用。
// iOS Safari 不认 volume（BR.net.volumeWorks 为 false）：音量低于 100% 时把电平检测那路源再分一支，经 GainNode 接到扬声器，
// <audio> 静音但继续播。100% 时照旧只用 <audio>，不调音量的人走的还是原来那条路
function setVoiceVolume(v) {
  v = +v;
  A.vol = isFinite(v) ? U.clamp(v, 0, 1) : 1;
  if (has(BR.net, 'setRemoteVolume')) BR.net.setRemoteVolume(A.vol);
  routeVoice();
  return A.vol;
}
function routeVoice() {
  const m = A.peer;
  if (!m || A.vol >= 1 || !BR.net || BR.net.volumeWorks !== false) { unrouteVoice(); return; }
  if (!A.voice) {
    try {
      A.voice = A.ctx.createGain();   // 先记下：只接上一半就失败时 unrouteVoice 也能拆干净
      m.src.connect(A.voice);
      A.voice.connect(A.ctx.destination);
    } catch (err) {
      console.warn('[coop] 语音音量接不上，按原音量播放', err);
      unrouteVoice();
      return;
    }
    if (has(BR.net, 'setRemoteMuted')) BR.net.setRemoteMuted(true);
  }
  A.voice.gain.value = A.vol;
}
function unrouteVoice() {
  const g = A.voice;
  A.voice = null;
  if (g) {
    try { if (A.peer) A.peer.src.disconnect(g); } catch (err) { /* 已断开 */ }
    try { g.disconnect(); } catch (err) { /* 已断开 */ }
  }
  if (has(BR.net, 'setRemoteMuted')) BR.net.setRemoteMuted(false);
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
  rcTick();
  hintCheck();
  if (S.phase === 'reconnecting') {
    // 重连途中两边原地等：客机的实体照旧不归本机管（不自己刷、不自己跑），人形藏着
    if (S.role === 'guest') setGuestAuthority(true);
    updateAvatar(dt);
    return;
  }
  if (!S.active) return;
  if (S.role === 'guest') {
    setGuestAuthority(true);   // entities.clear 之类可能把它改回去
    if (S.spare && nowMs() - S.rejoinSavedAt > REJOIN_REFRESH_MS) saveRejoin();
  }
  if (D.hud && !document.body.contains(D.hud)) buildHud();
  leaseTimers();
  localHolds();
  netSends(dt);
  if (S.stReqLater && nowMs() - S.stReqAt >= ST_REQ_GAP_MS) requestState(S.stReqLater);
  flushEv();
  applyRemoteTaken();
  applyJoinAt();
  applyBesideGo();
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

// main 没调 update（载入中、或还没接入）时照样收发位置、刷新角标、核对重连超时
function watchdog() {
  if (!S.active && !S.rc) return;
  const t = nowMs();
  if (t - S.lastUpdateAt < 300) return;
  tick(Math.min(0.25, Math.max(0, (t - (S.lastTickAt || t)) / 1000)));
}

// 页面正在关 / 进往返缓存：net 的 pagehide 随后会断开并报 'disconnected'，这时不重连；客机记下「回去？」的时间点
function onPageHide() {
  S.unloading = true;
  if (S.role === 'guest' && S.spare) saveRejoin();
}
function onPageShow(e) { if (e && e.persisted) S.unloading = false; }

function init() {
  if (S.inited) return;
  S.inited = true;
  // 测试用：页面脚本执行前设 window.__brCapsOverride = [...] 模拟旧版（比如去掉 'camp1'）
  if (Array.isArray(window.__brCapsOverride)) CAPS = window.__brCapsOverride.filter(c => typeof c === 'string').slice(0, 32);
  if (document.body) { buildHud(); renderMic(); }
  if (has(BR.net, 'on')) BR.net.on(onNetEvent);
  BR.bus.on('game:start', onGameStart);
  BR.bus.on('game:home', onGameHome);
  BR.bus.on('level:enter', onLevelEnter);
  BR.bus.on('exit:reach', onExitReach);
  BR.bus.on('item:pickRequest', onPickRequest);
  BR.bus.on('item:pickup', onItemPickup);
  BR.bus.on('interact:itemGone', onItemGone);
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
  // 捕获阶段：排在 net.js 的 pagehide 前面
  window.addEventListener('pagehide', onPageHide, true);
  window.addEventListener('pageshow', onPageShow, true);
  window.addEventListener('hashchange', onHashChange);
  setInterval(watchdog, WATCHDOG_MS);
  bootEntry();
}

BR.coop = {
  init, openLobby, closeLobby, update, leave, setMic,
  copyInvite,              // copyInvite() → Promise<'copied'|'shared'|false>：复制本营地的邀请链接（本页#join=房号），复制不了时手机弹分享
  setVoiceVolume,          // setVoiceVolume(v 0..1) → 夹过的值：对方语音音量，记住，新流 / 重连后照用（设置面板调）
  get voiceVolume() { return A.vol; },
  get active() { return S.active; },
  get role() { return S.role; },
  get mic() { return S.micOn; },
  get micBusy() { return S.micBusy; },   // 正在申请麦克风；这时再切一次 = 取消（别处的开麦按钮按 !(mic || micBusy) 调 setMic）
  get localSpeaking() { return S.localLevel; },
  get peerSpeaking() { return S.peerLevel; },
  get peerName() { return S.peerName; },
  get peerSkin() { return S.peerSkin; },   // 对方制服颜色 key（hello / skin 消息里来的，已校验）；没连上时 null。测试人同色名牌用
  // idle | creating | hosting | checking | confirm | joining | connecting | handshake | active | reconnecting
  get phase() { return S.phase; },
  // 联机对方当前渲染位置（插值后），房主用来判断自己 + 对方谁先进工坊放置实体的触发圈；没有有效样本时 null
  get peer() { return S.active && R.samples.length ? { x: R.cur.x, y: R.cur.y, z: R.cur.z } : null; },
  // ---- 联机营地（N1） ----
  get hosting() { return hosting(); },     // 房主开着营地、还没人连上（hud 房号角标、小黑板「等朋友来」）
  get code() { return S.code || (S.role === 'host' && BR.net && BR.net.code) || null; },   // 房主的房号（续期会换，换时 bus 'coop:code'）
  get peerLevels() { return S.peerLevels ? S.peerLevels.slice() : null; },   // 对方已注册的 LEVEL_ORDER 层级；没连上时 null
  // 这一局是房主开的什么模式：房主 = 自己在世界里的模式，客机 = world 消息里的；没有时 null
  get hostMode() { return S.role === 'host' ? (inWorld() ? BR.game.mode : null) : S.hostMode; },
  get inCamp() { return inCamp(); },
  sameRun,                 // sameRun() → bool：两人在同一局里（模式能联机；客机还要模式、种子和房主一致）
  startRun,                // startRun(payload) → bool：只给房主，补上 coop:{role:'host'} 再 emit game:start（帐篷出发、回营地）
  createRoomInPlace,       // createRoomInPlace() → Promise<房号 | false>：营地里落单时原地重新开房、角色切成房主，不重开世界
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
  can,                     // can(cap) → bool：'ev1' 拖动、'fx1' 使用请求与座位、'veh1' 载具、'camp1' 营地；单机恒为 true
  clock,                   // clock() → 秒：联机时以房主时钟为准（冷却 readyAt、开关 sinceClk、帐篷倒数 goAt 都用它）
  get peerPose() { return S.peerPose; },   // { mode, key } | null：对方姿态（这一阶段只收发）
  get peerCaps() { return S.peerCaps ? Array.from(S.peerCaps) : null; },
  debugInfo() {
    return {
      active: S.active, role: S.role, phase: S.phase, caps: CAPS.slice(), peerCaps: S.peerCaps ? Array.from(S.peerCaps) : null,
      code: S.code, spare: S.spare, hostMode: S.hostMode, hostSeed: S.hostSeed, hostLevel: S.hostLevel,
      peerLevels: S.peerLevels ? S.peerLevels.slice() : null, sameRun: sameRun(), inCamp: inCamp(),
      rc: S.rc ? { tries: S.rc.tries, left: Math.max(0, Math.round((S.rc.deadline - nowMs()) / 1000)), code: S.rc.code } : null,
      lobby: { open: lobbyOpen(), view: lobbyView(), card: S.card ? Object.assign({}, S.card) : null, waitHost: S.waitHost, starting: !!S.lobbyStart },
      holds: Array.from(S.holds, ([k, h]) => [k, h.by, !!h.pending]),
      pend: Array.from(S.pend.keys()), uses: S.uses.size, handlers: Array.from(S.useHandlers.keys()),
      evq: S.evq.length, peerN: Array.from(S.peerN), sentN: Array.from(S.sentN),
      stReady: Array.from(S.stReady.keys()), stBuf: S.stBuf ? [S.stBuf.got, S.stBuf.of] : null,
      taken: Array.from(S.taken, ([lv, s]) => [lv, s.size]), remoteTaken: Array.from(S.remoteTaken, ([lv, s]) => [lv, s.size]),
      pose: S.myPose, peerPose: S.peerPose, peerH: S.peerH, clockOff: S.clkOff,
      voice: { vol: A.vol, gain: A.voice ? A.voice.gain.value : null, ctx: A.ctx ? A.ctx.state : null },
    };
  },
};

// 拾取记录要从第一局就开始记（有人中途加入时要告诉他），不等 main 调 init
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
})();
