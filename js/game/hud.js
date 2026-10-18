// 后室 · HUD：顶部状态条、左上角层级信息、准星、互动提示、背包栏、toast、层级大标题、暂停菜单
// 接口见 ARCHITECTURE.md 第 12 节 BR.hud。DOM 全部由本文件在 #ui 里创建（class 前缀 hud-），样式在 css/game.css
// 补充约定：
//   pause(true/false) 同时切 BR.game.screen（只在 'playing' ↔ 'paused' 之间）和 BR.input.enabled，
//     并 emit 'game:pause' { paused }。菜单里点「继续」时顺手请求指针锁定（只有点击手势里才锁得上）
//   prompt(text) 是手动提示（层级风味文字、world 的「尚未开放」）：准心没对准东西时占第一行；
//     准心对准目标时准心提示优先，手动提示降到最后一行（.hud-prompt-note），不再整条盖掉。传 null 收起
//   准心提示（A1）：每帧读 BR.interact.current / state / holdProgress()。
//     第一行永远是「空格 + 动词 + 名字」（动词自带宾语的短语不再接名字，见 VERB_PHRASE）；只能拖的写「按住 空格 拖动 X」，
//     门写「按住 空格 往外拉」；short.ok=false 时只用灰字写原因、不出键帽。能拖的加第二行「· 长按拖动」（拖的是父道具时带上它的名字）。
//     触屏统一写「点「互动」…」，「互动」跟着 BR.input.buttonLabel('interact')。界面文字里不出现 E（E 只是隐藏别名）
//   准星：.hud-cross-on 圈（短按有用）、.hud-cross-grab 四角框（只能拖）、.hud-cross-drag 拖动中、.hud-cross-dim 只有原因、
//     .hud-cross-hold 进度环（CSS 变量 --hold 0..1，按下 ringDelayMs 后才出现，短按不闪）、.hud-cross-hide（view 情境）
//   开车（FE1）：
//   - setDrive(state | null)：常驻开车提示行（.hud-drive，独立的 DOM，不经过 prompt，「尚未开放」之类的手动提示挤不掉它）。
//     state = { key, label } 之类的对象（内容不读，只要是真值）；null 收起。只在 BR.input.context === 'drive' 时显示：
//     情境被别处切回 walk（死亡、回主页漏了 setDrive(null)）它自己就藏起来。game:start / game:home 清掉。
//     文字逐字照 playerSpec：电脑「W/S 前进后退 · A/D 打方向 · R 升货叉 · C 降货叉 · 空格 下车 · F 吃喝」，
//     触屏「摇杆开车 · 按住「升」「降」动货叉 · 点「下车」下车」，按 BR.input.isTouch 切换（.hud-drive-text 的 textContent 就是这句）。
//     位置：屏幕下方、准心提示下面、背包栏（连同物品名那一行）上面。每次布局变了（尺寸、转屏、准心提示、物品名、显示）现找空位：
//     触屏用 BR.input.touchLayout() 量按钮和待机摇杆，电脑只有准心提示和背包；先挑行数最少的宽度，再挑最靠下的位置，左右尽量居中
//     （css 里 .hud-drive 的默认位置只在还没摆过时用）
//   - driveNote(text, ms)：开车状态短提示（.hud-drive-note，准心正上方一行）：新的一句直接替换，同一句只续时间、闪一下，不排队；
//     ms 缺省 1800。没在开车（提示行没显示）时退回 toast。窄竖屏右边那列键挡着时限宽折行，不截字
//   - toast 自动避开：准心提示折成多行时排到它下面（A1 起就有）；开车时准心提示和开车提示行之间放得下最新那条，就只留放得下的几条；
//     放不下、或者矮横屏（右上那一列压着「升」「降」键），toast 改成「往上长」（.hud-toasts-up）：居中，底边贴着状态短提示那一格，
//     列宽让开两边的信息块和键，放不下的从最早的收掉
//   - 只读 drive → { on, touch, text, note, place }（测试用；place 是这次摆放的结果）
//   自动订阅 level:enter 播层级大标题（同一层短时间内只播一次，集成层再手动调也不会重复）
//   暂停、死亡时 toast 整组藏起来（.hud-toasts-modal），不清掉；联机暂停时面板右上角有开关麦（.hud-pause-mic）
//   额外只读：visible、paused、curtainState（'off' | 'in' | 'black' | 'out'）
//
//   联机营地（N1）：
//   - 营地（BR.levels.get(levelId).lobby 为真）：模式标签写「联机营地（Level 1 某处）」，不显示饥饿 / san / HP 条
//   - BR.coop.active 时模式标签前加「联机 · 」（左上角和暂停菜单副标题一样）
//   - 房号角标：BR.coop.hosting 为真、还没人连上（!active，也不在 reconnecting）时，左上角信息块多一行
//     「房号 K7M2QX · 等朋友来」（.hud-info-code，房号前三位后三位分两段显示，textContent 里不带空格）；
//     暂停菜单副标题同一行（.hud-pause-code）。收到 bus 'coop:code' {code} 立刻刷新；角标显示着时房号换了，toast「房号换成了 K7M 2QX」
//   - 暂停菜单「联机局」= BR.coop.active、phase 'reconnecting'、hosting，或者人在营地里。联机局里：
//       · 世界真的不停（active 或 reconnecting）时顶上一行小字「联机时暂停，世界不会停」（.hud-pause-coop）
//       · 「返回主页」换成「回营地」（.hud-btn-camp，只在不在营地、队友连着、有 BR.coopCamp.back 时出现；
//         点了调 BR.coopCamp.back() 并关掉暂停菜单回到游戏（返回 false 也关，好让 coopCamp 说原因的 toast 露出来），
//         等队友回答的横幅由 coopCamp 弹）
//         和「离开联机」（.hud-btn-leave，点两次：第一次变成「再点一次：会断开联机，回到主页」，窗口 HOME_CONFIRM_MS；
//         确认后先 BR.coop.leave() 再 emit 'game:home'）。两个按钮包在 .hud-pause-pair 里，横屏手机两个都在时并排
//       · 在营地里暂停只有「继续」和「离开联机」（能见度滑条照旧，只影响自己）；开着营地等朋友（hosting、还没人连上，副标题写着房号）时
//         「离开联机」前面多一个「复制邀请链接」（.hud-btn-invite，调 BR.coop.copyInvite，按钮上闪「已复制，发给朋友」），和「回营地」不会同时出现
//       · 重连中（reconnecting）不出「回营地」：要对方同意，断着问不出去；只有「离开联机」（方案 N1-hud ④ 写的是联机中含重连都换成两个按钮，
//         这里有意少一个，见 ARCHITECTURE 9.9）
//     单机时完全不变。暂停中联机状态变了（队友掉线、连上）按签名每帧刷新这一组
//   - notice(text, actions, ms, opts) → 句柄 { close(), set(text, ms?), open }：屏幕上半部中间的横幅（.hud-notices，z 65；
//     暂停 / 结算盖着时加 .hud-notices-modal 贴顶，不压面板标题），
//     在暂停 / 结算（60）和黑幕（56）之上，暂停、结算、黑幕时都看得见。actions = [{ label, fn, key? }]，按钮 ≥44 px；
//     点按钮先调 fn(句柄)，fn 返回 false 时横幅留着，否则关掉。ms > 0：到时自动关并调 opts.onTimeout；
//     有按钮时显示倒数秒数（opts.countdown 为 false 不显示，为 true 时没按钮也显示）。
//     桌面上按钮带键帽（按钮的 data-key，CSS ::before 画，按钮 textContent 只有 label）：没给 key 时按顺序配 Y / N / U，
//     key:false 不配；指针锁着点不到按钮时按键盘就行。弹出后 NOTICE_ARM_MS 内按钮不响应。
//     game:home 时全部关掉（opts.keep 为真的除外）；game:start 不关，由调用方自己 close
//   - curtain(text | false, ms) → Promise：全屏黑幕（.hud-curtain，z 56，gfx 的淡入淡出占着 55），中间一行字。
//     淡入淡出默认各 CURTAIN_FADE_MS（ms 可改，0..5000）。传文字：全黑那一刻 resolve(true)；已经全黑时只换字、立即 resolve；
//     没到全黑就被 curtain(false) 打断 resolve(false)。传 false：清掉层级大标题的去重（TITLE_DEDUPE_MS），淡出完 resolve(true)，
//     然后补播黑幕期间记下的层级大标题；被新的 curtain(文字) 打断 resolve(false)。
//     黑幕没完全撤掉（in / black / out）时 levelTitle 只记下最后一次，不播。game:home 时立刻撤掉，没 resolve 的都 resolve(false)
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 常量 ----------
const SLOTS = 5;
const PROMPT_SAMPLE_SEC = 0.1;   // 没载入 interact.js 时的兜底：interactTarget 每次都做视线检测，10Hz 足够跟手
const KEY_CAP = '空格';           // 桌面键帽。E 只是隐藏别名，任何文案里都不写
const HEAVY_VOL = 1.5;           // 体积超过这个（m³，含放在上面的东西）的拖动提示加「很重」
const HOLD_EPS = 0.004;          // --hold 变化小于这个不写 style
// 动词表（方案 A1-hud）里自带宾语的短语：后面不再接名字（「空格 坐下」，不写「空格 坐下 椅子」）。
// 不在这里的动词（拾取、打开、开始……以及没见过的）照「空格 + 动词 + 名字」接上候选的 label。
// 候选也可以在 short / hold 里给 name（字符串，'' = 不接名字）强行指定
const VERB_PHRASE = new Set([
  '拉开抽屉', '打开柜门', '打开冰箱', '打开集装箱', '打开电台', '取货', '开机', '关机', '换画面', '看屏幕',
  '启动发电机', '关闭发电机', '坐下', '躺下', '起身', '起来', '上车', '下车', '按喇叭', '开大灯', '关大灯',
  '喝水', '接水喝', '喝杏仁水', '开灯', '关灯', '换台', '戳破', '喷灭火器', '看看', '放录像带', '玩街机',
  '往外拉', '放下', '滑下去', '荡秋千', '扶起来', '推车',
  '进帐篷', '出帐篷', '看地图', '换制服',   // 联机营地（N1）：帐篷门、桌上的层级地图、柱子上的制服挂钩
]);
// short 没写动词时按种类补一个（候选本该自己写，这里只是不让第一行空着）
const KIND_VERB = { item: '拾取', container: '打开', seat: '坐下', vehicle: '上车', door: '往外拉' };
// 第一行开头的说法：桌面「按住 [空格] 往外拉」，触屏「按住「互动」往外拉」
const LEAD_DESK = { tap: '', hold: '按住', long: '长按', release: '松开' };
const LEAD_TOUCH = { tap: '点', hold: '按住', long: '长按', release: '松开' };
const SAN_BLINK_BELOW = 30;
const LOW_HP_RATIO = 0.25;
const TOAST_MS = 2200;
const TOAST_MAX = 3;
const TOAST_OUT_MS = 280;        // 与 css 里 hud-toast-out 的时长一致
const PICKUP_TOAST_MS = 1400;
const TITLE_DEDUPE_MS = 3000;
const TITLE_SAFETY_MS = 15000;   // 正常靠 animationend 收起；HUD 长时间隐藏导致动画没播时的兜底
const TITLE_REDUCED_MS = 3500;
const TITLE_CUT_MS = 300;       // 开车状态短提示压到大标题：大标题 0.25 s 淡出（css .hud-title-cut），这么久以后收起
const HIT_MS = 350;
const PAUSE_ARM_MS = 250;        // 按暂停的那一下不能顺带点中菜单按钮
const INVITE_TEXT = '复制邀请链接';
const HOME_CONFIRM_MS = 2500;    // 「返回主页」「离开联机」点两次才生效：手机上拖能见度滑条时误触会丢掉整局
// 联机营地（N1）
const CAMP_MODE_TEXT = '联机营地（Level 1 某处）';
const COOP_PREFIX = '联机 · ';
const PAUSE_COOP_NOTE = '联机时暂停，世界不会停';
const LEAVE_TEXT = '离开联机';
const LEAVE_CONFIRM_TEXT = '再点一次：会断开联机，回到主页';
const CODE_WAIT_TEXT = '等朋友来';
const CODE_TOAST_MS = 4000;
const NOTICE_ARM_MS = 350;       // 横幅弹出时玩家可能正好在点屏幕上半部：这么久内按钮不响应
const NOTICE_TICK_MS = 200;      // 倒数刷新、到时关闭的检查间隔
const NOTICE_KEYS = ['Y', 'N', 'U'];   // 桌面键帽：按钮按顺序配；都是 input.js 没占的键
const NOTICE_KEY_RESERVED = /^[WASDEFQTVRC0-9]$/;   // input.js 占着的键，调用方给了也不认
const CURTAIN_FADE_MS = 400;
const CURTAIN_MAX_MS = 5000;
const VIS_THUMB_PX = 20;        // 与 css/game.css 里 .hud-range::-webkit-slider-thumb 的宽度一致
// 开车常驻提示行（FE1）：文字逐字照 playerSpec。拆成几段只为窄屏折行时只在「 · 」后面断（每段 inline-block，不在段里断），
// 段和段之间是普通空格，textContent 拼起来和原句一字不差。触屏第二段再拆两半，最窄的竖屏也放得下
const DRIVE_DESK = [['W/S', '前进后退'], ['A/D', '打方向'], ['R', '升货叉'], ['C', '降货叉'], ['空格', '下车'], ['F', '吃喝']];
const DRIVE_TOUCH = [['摇杆开车'], ['按住「升」「降」', '动货叉'], ['点「下车」下车']];
const DRIVE_NOTE_MS = 1800;
// 触屏常驻提示行的几档（placeDrive 依次试）：'' 13px 整段不折行；t1 12px；t2 11px；split 12px、允许「按住「升」「降」」和「动货叉」之间折行
const DRIVE_MODES = ['', 'hud-drive-t1', 'hud-drive-t2', 'hud-drive-split'];
const DRIVE_GAP = 6;             // 开车提示行离按钮、摇杆、准心提示、背包至少这么远（px）
const DRIVE_NAME_RESERVE = 28;   // 背包栏上面给物品名留的高度（物品名显隐时提示行不跳）
const TOAST_GAP = 6;             // toast 和开车提示行 / 状态短提示之间
const TOAST_MIN_H = 28;          // 一条 toast 大约多高：准心提示和开车提示行之间连一条都放不下就改成往上长
const STYLE_RE = /(^|\/)css\/game\.css([?#]|$)/;
const SELF_RE = /js\/game\/hud\.js([?#].*)?$/;
// currentScript 只在脚本同步执行期间有值，必须在顶层取
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

// ---------- 状态 ----------
const dom = { ready: false };
const S = {
  visible: false,
  paused: false,
  touch: null,
  statsOn: null,
  dead: null,
  hungerLvl: -1,
  infoSig: null,
  recSec: -1,
  promptTimer: 0,
  target: null,                    // 兜底路径（没有 BR.interact）采样到的物资
  manualPrompt: null,
  promptSig: null,                 // 已写进 DOM 的提示签名，null = 下一帧强制重写
  crossSig: null,                  // 已写进 DOM 的准星类名组合
  holdShown: -1,                   // 已写进 --hold 的进度
  warnedVerb: new Set(),
  slotSig: new Array(SLOTS).fill(null),
  sel: -1,
  nameSig: null,
  badIcons: new Set(),
  toasts: [],
  toastModal: false,
  micSig: null,
  titleId: null, titleAt: 0, titleTimer: 0,
  pauseArmAt: 0, homeConfirmUntil: 0, homeTimer: 0,
  confirmBtn: null,                // 正在等第二下的按钮（dom.btnHome | dom.btnLeave）
  pauseCoopSig: null,              // 暂停菜单联机那一组已经按哪个状态画过
  shownCode: '',                   // 左上角角标正在显示的房号（'' = 没显示）
  titleWait: null,                 // 黑幕期间记下的层级大标题（最后一次），淡出完再播
  warnedTarget: false,
  layoutDirty: true,               // 提示框内容 / 显隐 / 窗口尺寸变了：下一帧量一次提示框底边，toast 排在它下面
  toastDy: -1,                     // 已写进 --hud-toast-dy 的值（px）
  toastUp: 0,                      // 开车时 toast「往上长」：列底边离屏幕底多少 px（写进 --hud-toast-up），0 = 不往上长
  toastUpW: 0,                     // 往上长时的列宽（px，写进 --hud-toast-w）
  toastTop: 0,                     // 矮横屏有横幅时 toast 排到横幅下面的 top（px，0 = 不挪；写进 --hud-toast-top）
  noticeSig: null,                 // 横幅容器的布局类（触屏 / 状态条开着）已经按哪个状态写过
};
// 开车提示（FE1）：state = setDrive 给的东西；on / touch 已经写进 DOM 的显隐和文字版本；note 状态短提示；place 触屏摆放的结果
const DV = { state: null, on: false, touch: null, note: '', noteUntil: 0, noteOn: false, place: null };
// 横幅（notice）：list 里按弹出先后排，后弹的在下面；tick 是倒数用的 setInterval
const N = { list: [], tick: 0 };
// 黑幕（curtain）：state 'off' | 'in'（淡入中）| 'black'（全黑）| 'out'（淡出中）；toBlack / toClear 是等着的 resolve
const C = { state: 'off', timer: 0, toBlack: [], toClear: [] };

// ---------- 小工具 ----------
function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function toggle(node, cls, on) { if (on) node.classList.add(cls); else node.classList.remove(cls); }
function attached(node) { return node.isConnected !== undefined ? node.isConnected : document.documentElement.contains(node); }
// 菜单按钮用 input 的轻点判定：摇杆手指还按着屏幕时浏览器不合成 click；input 没载入时退回 click
function tap(el, fn) {
  if (BR.input && typeof BR.input.tap === 'function') BR.input.tap(el, fn);
  else el.addEventListener('click', fn);
}

function mk(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (err) { return false; }
}

function isTouch() {
  if (BR.input && typeof BR.input.isTouch === 'boolean') return BR.input.isTouch;
  try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  catch (err) { return false; }
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function levelLabel(id) {
  if (id == null || id === '') return '未知层级';
  const def = BR.levels.get(id);
  const name = (def && def.name) || ('Level ' + id);
  return def && def.title ? name + ' · ' + def.title : name;
}

function modeLabel(g) {
  if (inCamp(g)) return CAMP_MODE_TEXT;
  const m = BR.MODES[g.mode];
  let s = m ? m.zh : String(g.mode || '');
  if (m && Array.isArray(m.difficulties)) {
    const d = m.difficulties.find(x => x.key === g.difficulty);
    if (d) s += ' · ' + d.zh;
  }
  if (!g.attackPlayers) s += ' · 实体不会攻击你';
  return coopLive() ? COOP_PREFIX + s : s;
}

// ---------- 联机营地（N1）的几个判断 ----------
// 营地是隐藏层，层级定义里 lobby 为真
function inCamp(g) {
  const def = BR.levels.get((g || BR.game).levelId);
  return !!(def && def.lobby);
}

// 队友连着（BR.coop.active）。只看 coop 模块的实时状态，不看开局时记下的 BR.game.coop
function coopLive() { return !!(BR.coop && BR.coop.active); }

function coopPhase() { return (BR.coop && BR.coop.phase) || ''; }

// 联机局：暂停菜单、结算页要换成「回营地 / 离开联机」。在营地里一定算（营地只能从「联机」进来）
function coopSession(g) {
  const c = BR.coop;
  if (!c) return false;
  return !!(c.active || c.hosting || coopPhase() === 'reconnecting' || inCamp(g));
}

// 暂停时世界真的不停（main.js 按 BR.coop.active 决定；重连时两边原地等，也照方案算联机中）
function worldRuns() { return coopLive() || coopPhase() === 'reconnecting'; }

// 「回营地」能不能点：不在营地、队友连着（要对方同意）、coopCamp 已载入
function canGoCamp(g) { return !inCamp(g) && coopLive() && !!BR.coopCamp && typeof BR.coopCamp.back === 'function'; }

// 开着营地、还没人连上：返回房号，否则 ''
function waitingCode() {
  const c = BR.coop;
  if (!c || !c.hosting || c.active || coopPhase() === 'reconnecting') return '';
  const code = c.code;
  return typeof code === 'string' && code ? code : '';
}

// 房号分两段显示（K7M 2QX），textContent 里不带空格，和服务器、输入框里的写法一致
function putCode(node, code) {
  node.textContent = '';
  mk('span', 'hud-code-a', node, code.slice(0, 3));
  mk('span', 'hud-code-b', node, code.slice(3));
}

function codeLine(node, code) {
  node.textContent = '';
  mk('span', 'hud-code-label', node, '房号 ');
  putCode(mk('span', 'hud-code', node), code);
  mk('span', 'hud-code-wait', node, ' · ' + CODE_WAIT_TEXT);
}

function groupCode(code) { return code.length > 3 ? code.slice(0, 3) + ' ' + code.slice(3) : code; }

function currentEnv() {
  // world.current 可能是层级定义本身，也可能包了一层 { def }；换层事件期间可能改过 env，优先用它
  const cur = BR.world && BR.world.current;
  if (cur && cur.env) return cur.env;
  if (cur && cur.def && cur.def.env) return cur.def.env;
  const lv = BR.levels.get(BR.game.levelId);
  return (lv && lv.env) || null;
}

function itemName(type) {
  const def = BR.itemTypes.get(type);
  return (def && def.zh) || String(type || '物品');
}

function coopActive() {
  const c = BR.game.coop;
  return !!((c && c.active) || (BR.coop && BR.coop.active));
}

// ---------- DOM ----------
function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && STYLE_RE.test(links[i].getAttribute('href') || '')) return;
  }
  // index.html 没引 css/game.css 时自己补上；按本脚本地址推算路径，tests/ 下的自测页也能找对
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, 'css/game.css') : 'css/game.css';
  l.setAttribute('data-owner', 'hud');
  (document.head || document.documentElement).appendChild(l);
}

function host() { return document.getElementById('ui') || document.body; }

function ensureDom() {
  if (!dom.ready) {
    if (!document.body) return false;
    ensureStylesheet();
    buildHud();
    buildToasts();
    buildPause();
    buildNotices();
    buildCurtain();
    dom.ready = true;
    // 窗口尺寸、横竖屏变了：提示框折行跟着变，toast 的位置重量一次
    window.addEventListener('resize', () => { S.layoutDirty = true; }, { passive: true });
    // 横幅的键帽：捕获阶段，指针锁着时也收得到
    document.addEventListener('keydown', onNoticeKey, true);
  }
  // 别的模块清空 #ui 时会把节点一起带走，补挂回去
  const h = host();
  if (!attached(dom.root)) h.appendChild(dom.root);
  if (!attached(dom.toasts)) h.appendChild(dom.toasts);
  if (!attached(dom.pause)) h.appendChild(dom.pause);
  if (!attached(dom.curtain)) h.appendChild(dom.curtain);
  if (!attached(dom.notices)) h.appendChild(dom.notices);
  return true;
}

function buildStat(parent, key, label) {
  const wrap = mk('div', 'hud-stat hud-stat-' + key, parent);
  const head = mk('div', 'hud-stat-head', wrap);
  mk('span', 'hud-stat-label', head, label);
  const val = mk('span', 'hud-stat-val', head, '--');
  const bar = mk('div', 'hud-bar', wrap);
  const fill = mk('div', 'hud-bar-fill', bar);
  return { wrap, val, fill, shown: null, frac: -1, bad: null, blink: null, hitTimer: 0 };
}

function buildSlot(i, parent) {
  const btn = mk('button', 'hud-slot hud-slot-empty', parent);
  btn.type = 'button';
  btn.tabIndex = -1;   // 不进键盘焦点序列：焦点停在格子上时空格会反复触发它
  btn.setAttribute('aria-label', '背包第 ' + (i + 1) + ' 格：空');
  mk('span', 'hud-slot-num', btn, String(i + 1));
  const icon = mk('img', 'hud-slot-icon', btn);
  icon.alt = '';
  icon.draggable = false;
  icon.hidden = true;
  const text = mk('span', 'hud-slot-text', btn);
  text.hidden = true;
  const count = mk('span', 'hud-slot-count', btn);

  icon.addEventListener('error', () => {
    const src = icon.getAttribute('src');
    if (!src) return;
    // 图标文件缺失就退回文字，并记住这张图，其他格子别再白请求
    S.badIcons.add(src);
    S.slotSig[i] = null;
  });
  // 按下就选中，不等 click：摇杆手指还按着时部分手机不合成 click
  const onDown = (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType !== 'touch') return;
    onSlotDown(i);
  };
  if (window.PointerEvent) btn.addEventListener('pointerdown', onDown);
  else {
    btn.addEventListener('touchstart', onDown, { passive: true });
    btn.addEventListener('mousedown', onDown);
  }
  // 鼠标按下不让按钮拿焦点
  btn.addEventListener('mousedown', (e) => { if (e.cancelable) e.preventDefault(); });
  return { btn, icon, text, count };
}

function buildHud() {
  const root = dom.root = mk('div', 'hud-root');
  root.hidden = true;

  const top = mk('div', 'hud-top', root);
  dom.stats = mk('div', 'hud-stats', top);
  dom.stats.hidden = true;
  dom.stat = {
    san: buildStat(dom.stats, 'san', 'SAN'),
    hunger: buildStat(dom.stats, 'hunger', '饥饿'),
    hp: buildStat(dom.stats, 'hp', 'HP'),
  };
  dom.warn = mk('div', 'hud-warn', top);
  dom.warn.hidden = true;

  const info = dom.infoBlock = mk('div', 'hud-info', root);
  dom.infoLevel = mk('div', 'hud-info-level', info);
  dom.infoMode = mk('div', 'hud-info-mode', info);
  const rec = mk('div', 'hud-info-rec', info);
  mk('span', 'hud-rec-dot', rec);
  mk('span', 'hud-rec-label', rec, 'REC');
  dom.recTime = mk('span', 'hud-rec-time', rec, '00:00:00');
  dom.recCoop = mk('span', 'hud-rec-coop', rec);
  dom.recCoop.hidden = true;
  // 开着营地等朋友时的房号角标：放在信息块里最后一行，跟着信息块排，压不到层级名，也不会跑到右上角的麦克风那边
  dom.infoCode = mk('div', 'hud-info-code', info);
  dom.infoCode.hidden = true;

  dom.cross = mk('div', 'hud-cross', root);
  // 提示三行：第一行「[按住] [空格] 动词 名字 ×2」；第二行「· 长按拖动 货架」；最后一行是降下来的手动提示。
  // .hud-prompt-text 里装第一行的文字部分（测试按它取文字）：动词不能被省略号截掉，只截名字
  dom.prompt = mk('div', 'hud-prompt', root);
  dom.prompt.hidden = true;
  const main = mk('div', 'hud-prompt-main', dom.prompt);
  dom.promptLead = mk('span', 'hud-key-lead', main);
  dom.promptKey = mk('span', 'hud-key', main);
  dom.promptText = mk('span', 'hud-prompt-text', main);
  dom.promptVerb = mk('span', 'hud-prompt-verb', dom.promptText);
  dom.promptName = mk('span', 'hud-prompt-name', dom.promptText);
  dom.promptTag = mk('span', 'hud-prompt-tag', dom.promptText);
  dom.promptSub = mk('div', 'hud-prompt-sub', dom.prompt);
  dom.promptNote = mk('div', 'hud-prompt-note', dom.prompt);
  dom.promptLead.hidden = dom.promptKey.hidden = dom.promptVerb.hidden = dom.promptTag.hidden = true;
  dom.promptSub.hidden = dom.promptNote.hidden = true;

  dom.title = mk('div', 'hud-title', root);
  dom.title.hidden = true;
  dom.titleName = mk('div', 'hud-title-name', dom.title);
  dom.titleSub = mk('div', 'hud-title-sub', dom.title);
  dom.titleClass = mk('div', 'hud-title-class', dom.title);
  dom.title.addEventListener('animationend', (e) => { if (e.animationName === 'hud-title') hideTitle(); });

  // 开车（FE1）：常驻提示行在背包栏上面；状态短提示在准心正上方
  dom.drive = mk('div', 'hud-drive', root);
  dom.drive.hidden = true;
  dom.driveText = mk('div', 'hud-drive-text', dom.drive);
  dom.driveNote = mk('div', 'hud-drive-note', root);
  dom.driveNote.hidden = true;
  dom.driveNote.setAttribute('role', 'status');

  const inv = mk('div', 'hud-inv', root);
  dom.inv = inv;
  dom.invName = mk('div', 'hud-inv-name', inv);
  dom.invName.hidden = true;
  const row = mk('div', 'hud-inv-row', inv);
  dom.invRow = row;
  dom.slots = [];
  for (let i = 0; i < SLOTS; i++) dom.slots.push(buildSlot(i, row));
}

function buildToasts() {
  dom.toasts = mk('div', 'hud-toasts');
  dom.toasts.setAttribute('role', 'status');
  dom.toasts.setAttribute('aria-live', 'polite');
}

function buildPause() {
  const ov = dom.pause = mk('div', 'hud-pause');
  ov.hidden = true;
  const panel = mk('div', 'hud-pause-panel', ov);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '暂停菜单');
  // 联机时暂停只是开了个菜单，房主那边的世界照常跑：顶上写明，免得以为队友也停了
  dom.pauseCoop = mk('div', 'hud-pause-coop', panel, PAUSE_COOP_NOTE);
  dom.pauseCoop.hidden = true;
  mk('div', 'hud-pause-tag', panel, '❚❚ PAUSE');
  mk('div', 'hud-pause-title', panel, '已暂停');
  // 联机时暂停不停世界，右上角的麦克风按钮又被暂停层盖住：面板右上角补一个开关麦，只在联机时显示
  const mic = dom.btnMic = mk('button', 'hud-pause-mic', panel);
  mic.type = 'button';
  mic.hidden = true;
  mk('span', 'hud-pause-mic-ico', mic, '🎙');
  dom.micTxt = mk('span', 'hud-pause-mic-txt', mic, '已闭麦');
  const sub = mk('div', 'hud-pause-sub', panel);
  dom.pauseLevel = mk('div', '', sub);
  dom.pauseMode = mk('div', '', sub);
  dom.pauseCode = mk('div', 'hud-pause-code', sub);
  dom.pauseCode.hidden = true;

  dom.btnResume = mk('button', 'hud-btn hud-btn-primary', panel, '继续');
  dom.btnResume.type = 'button';

  const vis = mk('label', 'hud-vis', panel);
  const head = mk('span', 'hud-vis-head', vis);
  mk('span', 'hud-vis-label', head, '能见度');
  dom.visVal = mk('span', 'hud-vis-val', head, '70%');
  const range = dom.visRange = mk('input', 'hud-range', vis);
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.step = '1';
  range.setAttribute('aria-label', '能见度');

  dom.btnHome = mk('button', 'hud-btn hud-btn-home', panel, '返回主页');
  dom.btnHome.type = 'button';
  // 联机局里「返回主页」换成这两个（renderPauseCoop 切显隐）。包一层：横屏手机高度不够时两个并排（css .hud-pause-pair）
  const pair = dom.pausePair = mk('div', 'hud-pause-pair', panel);
  pair.hidden = true;
  dom.btnCamp = mk('button', 'hud-btn hud-btn-camp', pair, '回营地');
  dom.btnCamp.type = 'button';
  dom.btnCamp.hidden = true;
  // 开着营地等朋友（还没人连上）时：复制邀请链接（营地重开、房号续期后，不用回主页也能把新链接发出去）。和「回营地」不会同时出现
  dom.btnInvite = mk('button', 'hud-btn hud-btn-invite', pair, INVITE_TEXT);
  dom.btnInvite.type = 'button';
  dom.btnInvite.hidden = true;
  dom.btnLeave = mk('button', 'hud-btn hud-btn-leave', pair, LEAVE_TEXT);
  dom.btnLeave.type = 'button';
  dom.btnLeave.hidden = true;
  dom.pauseHint = mk('div', 'hud-pause-hint', panel, '按 Esc 也可以继续');

  tap(dom.btnResume, onResumeClick);
  tap(dom.btnHome, onHomeClick);
  tap(dom.btnCamp, onCampClick);
  tap(dom.btnInvite, onInviteClick);
  tap(dom.btnLeave, onLeaveClick);
  tap(mic, onMicClick);
  range.addEventListener('input', onVisInput);
  range.addEventListener('change', onVisInput);
  // iOS Safari 的滑条点轨道不跳位、只能按住 20px 宽的滑块拖：触屏按下和拖动时按手指横坐标自己换算。
  // 用 targetTouches：另一根手指（摇杆）还按着时 touches[0] 不一定是这根
  const seek = (e) => {
    const t = (e.targetTouches && e.targetTouches[0]) || (e.changedTouches && e.changedTouches[0]);
    const r = range.getBoundingClientRect();
    if (!t || !(r.width > VIS_THUMB_PX)) return;
    // 滑块中心两端各让出半个滑块，和原生换算一致，手指一直压在滑块上
    const v = String(Math.round(U.clamp((t.clientX - r.left - VIS_THUMB_PX / 2) / (r.width - VIS_THUMB_PX), 0, 1) * 100));
    if (v === range.value) return;
    range.value = v;
    onVisInput();
  };
  range.addEventListener('touchstart', seek, { passive: true });
  range.addEventListener('touchmove', seek, { passive: true });
}

// ---------- 状态条 ----------
// 向下取整、但大于 0 时至少显示 1：否则会出现"显示 0 却没触发极度饥饿""显示 20 却已经在减速"
function statText(v, max) {
  return String(v <= 0 ? 0 : Math.max(1, Math.floor(Math.min(v, max))));
}

function setStat(st, v, max) {
  const text = statText(v, max);
  if (text !== st.shown) { st.shown = text; st.val.textContent = text; }
  const frac = U.clamp(v / max, 0, 1);
  // 只在肉眼看得出变化时写 style，数值稳定时每帧零 DOM 写入
  if (Math.abs(frac - st.frac) >= 0.002 || (frac !== st.frac && (frac === 0 || frac === 1))) {
    st.frac = frac;
    st.fill.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
  }
}

function setBad(st, on) {
  if (st.bad === on) return;
  st.bad = on;
  toggle(st.wrap, 'hud-bad', on);
}

function updateStats(g, p) {
  // 营地里不会饿、不掉 san，也没东西打人：整条不显示
  const on = !!(g.statsEnabled && p) && !inCamp(g);
  if (on !== S.statsOn) {
    S.statsOn = on;
    dom.stats.hidden = !on;
    toggle(dom.root, 'hud-stats-on', on);
    if (!on) { dom.warn.hidden = true; S.hungerLvl = -1; }
  }
  if (!on) return;

  const maxHp = num(BR.config.player.maxHp, 100);
  const san = num(p.sanity, 100), hunger = num(p.hunger, 100), hp = num(p.hp, maxHp);
  setStat(dom.stat.san, san, 100);
  setStat(dom.stat.hunger, hunger, 100);
  setStat(dom.stat.hp, hp, maxHp);

  // 直接用 base.js 的移速规则判档，提示文字和实际移速永远一致
  const mul = BR.speedMulFromHunger(hunger);
  const lvl = mul >= 1 ? 0 : mul >= 0.5 ? 1 : 2;
  if (lvl !== S.hungerLvl) {
    S.hungerLvl = lvl;
    setBad(dom.stat.hunger, lvl > 0);
    dom.warn.hidden = lvl === 0;
    toggle(dom.warn, 'hud-warn-severe', lvl === 2);
    dom.warn.textContent = lvl === 2 ? '极度饥饿：移速 1/3' : lvl === 1 ? '饥饿：移速减半' : '';
  }

  const st = dom.stat.san;
  const blink = san < SAN_BLINK_BELOW;
  if (blink !== st.blink) {
    st.blink = blink;
    toggle(st.wrap, 'hud-blink', blink);
    setBad(st, blink);
  }
  setBad(dom.stat.hp, hp < maxHp * LOW_HP_RATIO);
}

function hit(st) {
  if (!dom.ready || !S.statsOn) return;
  st.wrap.classList.add('hud-hit');
  clearTimeout(st.hitTimer);
  st.hitTimer = setTimeout(() => st.wrap.classList.remove('hud-hit'), HIT_MS);
}

// ---------- 左上角信息 ----------
function updateInfo(g) {
  const c = g.coop || {};
  const coop = coopActive();
  const role = c.role || (BR.coop && BR.coop.role) || null;
  const code = waitingCode();
  // 层级文件可能晚于首帧注册，has() 也放进签名，注册后标题自动补上；营地、队友在不在、房号也在签名里
  const sig = [g.levelId, BR.levels.has(g.levelId), g.mode, g.difficulty, g.attackPlayers, coop, role,
    inCamp(g), coopLive(), code].join('|');
  if (sig !== S.infoSig) {
    S.infoSig = sig;
    dom.infoLevel.textContent = levelLabel(g.levelId);
    dom.infoMode.textContent = modeLabel(g);
    dom.recCoop.textContent = coop ? (role === 'guest' ? '联机 · 客机' : '联机 · 房主') : '';
    dom.recCoop.hidden = !coop;
    if (code) codeLine(dom.infoCode, code);
    dom.infoCode.hidden = !code;
    S.shownCode = code;
  }
  const sec = Math.max(0, Math.floor(num(g.time, 0)));
  if (sec !== S.recSec) {
    S.recSec = sec;
    dom.recTime.textContent = fmtClock(sec);
  }
}

// ---------- 准星与互动提示 ----------
// 本帧要显示的东西（复用对象，每帧原地改）。cross：'on' 圈 | 'dim' 灰圈（只有原因）| 'grab' 四角框 | 'drag' 拖动中 | ''
// ring：长按有实际动作（能拖、或有能做的 hold），按住时才画进度环
const PM = { lead: '', key: '', verb: '', name: '', tag: '', why: false, sub: '', note: '', cross: '', ring: false };
// 已写进 DOM 的值，逐项比较，没变的不碰 DOM
const SHOWN = { lead: null, key: null, verb: null, name: null, tag: null, why: null, sub: null, note: null, show: null };
// 兜底路径（没载入 interact.js）用的物资候选
const LEGACY = { kind: 'item', key: null, label: '', short: { verb: '拾取', ok: true, why: null }, hold: null, canDrag: false, vol: 0, ref: null };

function clearPM() {
  PM.lead = PM.key = PM.verb = PM.name = PM.tag = PM.sub = PM.note = PM.cross = '';
  PM.why = false;
  PM.ring = false;
}

function touchBtnLabel() {
  const inp = BR.input;
  let l = '';
  if (has(inp, 'buttonLabel')) {
    try { l = String(inp.buttonLabel('interact') || ''); } catch (err) { l = ''; }
  }
  return l || '互动';
}

// 第一行。how：'tap' 短按 | 'hold' 按住（拖动、拉门）| 'long' 长按（hold 动作）| 'release' 松开
function lead(how, verb, name) {
  if (S.touch) {
    const b = touchBtnLabel();
    // 触屏键已经被改成这个动作的名字（例如开车时「下车」）：只写「点「下车」」，不写成「点「下车」下车」
    PM.verb = LEAD_TOUCH[how] + '「' + b + '」' + (verb === b ? '' : verb);
    PM.lead = '';
    PM.key = '';
  } else {
    PM.lead = LEAD_DESK[how];
    PM.key = KEY_CAP;
    PM.verb = verb;
  }
  PM.name = name || '';
}

// 做不了：灰字写原因，不出键帽
function why(text) {
  PM.lead = PM.key = PM.verb = '';
  PM.name = text ? String(text) : '';
  PM.why = true;
}

function verbOf(act, kind) {
  const v = act && act.verb != null ? String(act.verb) : '';
  if (v) {
    if (!VERB_PHRASE.has(v) && v !== '拾取' && v !== '打开' && v !== '拖动' && v !== '开始' && !S.warnedVerb.has(v)) {
      S.warnedVerb.add(v);
      console.warn('[hud] 动词「' + v + '」不在动词表里，按「动词 + 名字」显示；自带宾语的短语请加进 hud.js 的 VERB_PHRASE');
    }
    return v;
  }
  return KIND_VERB[kind] || '使用';
}

// 动词后面接不接名字：候选给了 name 就用它；自带宾语的短语、动词里已经有这个名字的都不接
function nameFor(act, verb, label) {
  if (act && typeof act.name === 'string') return act.name;
  if (!label || VERB_PHRASE.has(verb) || verb.indexOf(label) >= 0) return '';
  return label;
}

function countTag(c) {
  const r = c.ref;
  const n = r && typeof r === 'object' ? r.count | 0 : 0;
  return n > 1 ? '×' + n : '';
}

function isDoor(c) { return c.kind === 'door' || c.dragKind === 'door'; }
function doorVerb(c) { return (c.hold && c.hold.verb) || KIND_VERB.door; }

// 候选 + 状态 → PM
function describe(c, st) {
  const sh = c.short, hd = c.hold;
  const holdOk = !!(hd && hd.ok !== false);
  const label = c.label ? String(c.label) : '';
  const dragName = c.dragLabel ? String(c.dragLabel) : label;
  const heavy = !!c.canDrag && num(c.vol, 0) > HEAVY_VOL;

  if (st === 'drag') {
    // 门是按住一直往外拉，松手停在那个角度：拉的时候提示不变；别的东西松手就放下
    if (isDoor(c)) lead('hold', doorVerb(c), '');
    else lead('release', '放下', '');
    PM.cross = 'drag';
    return;
  }
  if (st === 'hold' && hd) {
    const v = verbOf(hd, c.kind);
    lead('hold', v, nameFor(hd, v, label));
    PM.cross = 'on';
    PM.ring = true;
    return;
  }
  if (sh) {
    if (sh.ok !== false) {
      const v = verbOf(sh, c.kind);
      lead('tap', v, nameFor(sh, v, label));
      if (c.kind === 'item') PM.tag = countTag(c);
      PM.cross = 'on';
    } else {
      why(sh.why || c.dragWhy || label);
      PM.cross = c.canDrag ? 'grab' : 'dim';
    }
    // 第二行：长按做什么。拖的是父道具（货架里的箱子 → 货架）时带上父道具的名字，免得以为拖的是箱子
    if (c.canDrag) PM.sub = '· 长按拖动' + (dragName && dragName !== label ? ' ' + dragName : '') + (heavy ? ' · 很重' : '');
    else if (holdOk) {
      const v = verbOf(hd, c.kind);
      const n = nameFor(hd, v, label);
      PM.sub = '· 长按' + v + (n ? ' ' + n : '');
    }
    PM.ring = !!c.canDrag || holdOk;
    return;
  }
  // 没有短按动作
  if (c.canDrag) {
    // 只能拖的一按就拖（interact.js），所以写「按住」，也不画进度环
    if (isDoor(c)) lead('hold', doorVerb(c), '');
    else {
      lead('hold', '拖动', dragName);
      if (heavy) PM.tag = '· 很重';
    }
    PM.cross = 'grab';
    return;
  }
  if (holdOk) {
    const v = verbOf(hd, c.kind);
    lead('long', v, nameFor(hd, v, label));
    PM.cross = 'on';
    PM.ring = true;
    return;
  }
  why((hd && hd.why) || c.dragWhy || label);
  PM.cross = 'dim';
}

// 没载入 interact.js（单独的 HUD 自测页）：照旧 10Hz 问 player.interactTarget()，只认物资
function legacyCand(dt, p, dead) {
  S.promptTimer -= dt;
  if (S.promptTimer <= 0) {
    S.promptTimer = PROMPT_SAMPLE_SEC;
    S.target = null;
    if (p && !dead && has(p, 'interactTarget')) {
      try { S.target = p.interactTarget(); }
      catch (err) {
        if (!S.warnedTarget) { S.warnedTarget = true; console.error('[hud] interactTarget 出错', err); }
      }
    }
  }
  const t = dead ? null : S.target;
  if (!t) return null;
  LEGACY.key = t.id;
  LEGACY.label = itemName(t.type);
  LEGACY.ref = t;
  const full = has(p, 'canAdd') && !p.canAdd(t.type);
  LEGACY.short.ok = !full;
  LEGACY.short.why = full ? '背包已满' : null;
  return LEGACY;
}

function put(node, field, v) {
  if (SHOWN[field] === v) return;
  SHOWN[field] = v;
  node.textContent = v;
  node.hidden = !v;
  S.layoutDirty = true;
}

// 灰字原因按「，」「、」「· 」分段，每段不在中间断行（2026-10-02 返修：手机竖屏上「插着电，三百多公斤，拖」/「不动」）。
// 超过 WHY_NB_MAX 个字的段照常折行，免得一段比框还宽被截掉
const WHY_NB_MAX = 10;
function whySegments(v) {
  const out = [];
  let a = 0;
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === '，' || ch === '、' || (ch === ' ' && i > 0 && v[i - 1] === '·')) { out.push(v.slice(a, i + 1)); a = i + 1; }
  }
  if (a < v.length) out.push(v.slice(a));
  return out;
}
function putName(v, whyMode) {
  const k = (whyMode ? '\u0001' : '') + v;
  if (SHOWN.name === k) return;
  SHOWN.name = k;
  const node = dom.promptName;
  node.hidden = !v;
  S.layoutDirty = true;
  const segs = whyMode ? whySegments(v) : null;
  if (!segs || segs.length < 2) { node.textContent = v; return; }
  node.textContent = '';
  for (const seg of segs) {
    if (seg.length > WHY_NB_MAX) { node.appendChild(document.createTextNode(seg)); continue; }
    const sp = document.createElement('span');
    sp.className = 'hud-nb';
    sp.textContent = seg;
    node.appendChild(sp);
  }
}

// toast 排在提示框下面（2026-10-02 返修：灰字原因折行 + 「· 长按拖动」、手动提示 + 目标时，toast 压住了下面几行）。
// 只在提示内容、显隐、窗口尺寸变了的那一帧量一次；横屏 toast 挪到右上角时 CSS 把 margin-top 定死成 0，这个值不起作用
const TOAST_DY_MIN = 84;           // 和 css 里 .hud-toasts 原来的 margin-top 一致：单行提示时位置不变
function placeToasts() {
  if (!S.layoutDirty || !dom.toasts) return;
  S.layoutDirty = false;
  let dy = TOAST_DY_MIN;
  const mid = (window.innerHeight || document.documentElement.clientHeight || 0) / 2;
  const pr = dom.prompt.hidden ? null : dom.prompt.getBoundingClientRect();
  if (pr && pr.height > 0) dy = Math.max(TOAST_DY_MIN, Math.ceil(pr.bottom - mid + 6));
  // 开车提示行先摆好（要绕开准心提示），toast 再绕开它
  if (DV.on) {
    placeDrive(pr && pr.height > 0 ? pr : null);
    if (DV.noteOn) placeNote();
    if (S.toasts.length) avoidDrive(dy, mid);
  } else setToastUp(0, 0);
  if (dy !== S.toastDy) { S.toastDy = dy; dom.toasts.style.setProperty('--hud-toast-dy', dy + 'px'); }
}

// up > 0：toast「往上长」，列底边离屏幕底 up px，列宽 w px；0 = 回到平常的版式
function setToastUp(up, w) {
  if (up === S.toastUp && w === S.toastUpW) return;
  S.toastUp = up;
  S.toastUpW = w;
  toggle(dom.toasts, 'hud-toasts-up', up > 0);
  if (up > 0) {
    dom.toasts.style.setProperty('--hud-toast-up', up + 'px');
    dom.toasts.style.setProperty('--hud-toast-w', w + 'px');
  }
}

const SHORT_MQ = '(max-height: 520px)';   // 和 css/game.css 里 toast 挪到右上角的媒体查询一致
function shortScreen() {
  try { return !!(window.matchMedia && window.matchMedia(SHORT_MQ).matches); }
  catch (err) { return (window.innerHeight || 0) <= 520; }
}

function toastHeights(nodes) {
  const hs = nodes.map(t => t.node.offsetHeight);
  return { hs, total: hs.reduce((a, b, i) => a + b + (i ? TOAST_GAP : 0), 0), newest: hs.length ? hs[hs.length - 1] : TOAST_MIN_H };
}

// 开车时 toast 的位置。默认版式（屏幕中线下面）里开车提示行挡在 toast 那一列：上面放得下最新那条就只留放得下的
// （从最新的往回数，更早的提前收掉）；连最新那条都放不下，或者是矮横屏（右上角那一列正好压着「升」「降」键和状态短提示）、
// toast 排在横幅下面的版式，就改成「往上长」：居中，底边贴着准心上方状态短提示那一格，往上排到信息块 / 状态条 / 横幅 / 触屏键为止
// （在两边的东西收窄列宽让开，在中间的就压低上限），放不下的同样从最早的收掉
function avoidDrive(dy, mid) {
  const nodes = [];
  for (const t of S.toasts) if (!t.leaving) nodes.push(t);
  if (!nodes.length) return;
  const H = window.innerHeight || document.documentElement.clientHeight || 0;
  const W = window.innerWidth || document.documentElement.clientWidth || 0;
  const cx = W / 2;
  let goUp = shortScreen() || S.toastTop > 0;
  let cap = Infinity, m = null;
  if (!goUp) {
    setToastUp(0, 0);
    m = toastHeights(nodes);
    const colHalf = Math.min(520, W - 32) / 2;
    const o = dom.drive.hidden ? null : dom.drive.getBoundingClientRect();
    const top = mid + dy;
    if (o && o.height > 0 && o.right > cx - colHalf && o.left < cx + colHalf && o.bottom + TOAST_GAP > top && o.top - TOAST_GAP < top + m.total) {
      const room = o.top - TOAST_GAP - top;
      if (room >= Math.max(m.newest, TOAST_MIN_H)) cap = room;
      else goUp = true;
    }
  }
  if (goUp) {
    // 底边：状态短提示那一格（显示着就量它，没显示按一行高留着，免得它一出来 toast 就跳）
    let noteTop = mid - 30 - 30;
    if (DV.noteOn && !dom.driveNote.hidden) {
      const nr = dom.driveNote.getBoundingClientRect();
      if (nr.height > 0) noteTop = Math.min(noteTop, nr.top);
    }
    const bottom = noteTop - TOAST_GAP;
    let half = Math.min(520, W - 32) / 2, limit = 8;
    const blocks = [];
    // 上半屏别的东西：信息块、状态条、警告、横幅，还有联机的麦克风键（coop.js）、测试模式的「实体」键（testmode.js）
    const others = [dom.infoBlock, dom.stats, dom.warn, dom.notices, document.querySelector('.coop-mic'), document.querySelector('.test-entry')];
    for (const el of others) {
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) blocks.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    }
    const inp = BR.input;
    if (S.touch && inp && has(inp, 'touchLayout')) {
      let L = null;
      try { L = inp.touchLayout(); } catch (err) { L = null; }
      if (L) for (const b of L.buttons) blocks.push(b);
    }
    for (const b of blocks) {
      if (b.t >= bottom) continue;
      // 在两边（离中线 ≥ 100px，窄屏按屏宽的 1/5）：收窄列宽让开；挡在中间：上限压到它下面
      const near = b.l >= cx ? b.l - cx : b.r <= cx ? cx - b.r : 0;
      if (near >= Math.min(100, W * 0.2)) half = Math.min(half, near - 8);
      else limit = Math.max(limit, b.b + TOAST_GAP);
    }
    setToastUp(Math.max(1, Math.round(H - bottom)), Math.floor(half * 2));
    m = toastHeights(nodes);
    cap = Math.max(0, bottom - limit);
  }
  if (m && cap < m.total) {
    let used = 0;
    for (let i = nodes.length - 1; i >= 0; i--) {
      used += m.hs[i] + (i < nodes.length - 1 ? TOAST_GAP : 0);
      if (used > cap && i < nodes.length - 1) dismissToast(nodes[i]);
    }
  }
}

function updatePrompt(dt, p, dead) {
  const I = BR.interact;
  const live = !!I && has(I, 'update');
  let c = null, st = 'idle', prog = 0, hide = false;
  if (live) {
    if (!dead) {
      c = I.current;
      st = I.state || 'idle';
      if ((st === 'pressed' || st === 'hold') && has(I, 'holdProgress')) prog = num(+I.holdProgress(), 0);
      hide = !!I.crossHidden;
    }
  } else {
    c = legacyCand(dt, p, dead);
  }

  clearPM();
  if (c) describe(c, st);
  if (!dead && S.manualPrompt) {
    // 准心提示优先：有目标时手动提示降到最后一行；没目标时它就是第一行（不是灰字）
    if (PM.verb || PM.name || PM.key) PM.note = S.manualPrompt;
    else PM.name = S.manualPrompt;
  }

  if (S.promptSig === null) {
    for (const k in SHOWN) SHOWN[k] = null;
    S.promptSig = 1;
  }
  const show = !!(PM.verb || PM.name || PM.key || PM.sub || PM.note);
  if (SHOWN.show !== show) { SHOWN.show = show; dom.prompt.hidden = !show; S.layoutDirty = true; }
  put(dom.promptLead, 'lead', PM.lead);
  put(dom.promptKey, 'key', PM.key);
  put(dom.promptVerb, 'verb', PM.verb);
  putName(PM.name, PM.why);
  put(dom.promptTag, 'tag', PM.tag);
  put(dom.promptSub, 'sub', PM.sub);
  put(dom.promptNote, 'note', PM.note);
  if (SHOWN.why !== PM.why) { SHOWN.why = PM.why; toggle(dom.prompt, 'hud-prompt-why', PM.why); S.layoutDirty = true; }
  placeToasts();

  // 准星。进度环：按下 ringDelayMs 后 holdProgress() 才大于 0，短按不会闪一下
  const ring = (st === 'hold' || (st === 'pressed' && PM.ring)) && prog > 0;
  if (ring && Math.abs(prog - S.holdShown) >= HOLD_EPS) {
    S.holdShown = prog;
    dom.cross.style.setProperty('--hold', prog.toFixed(3));
  }
  const cross = PM.cross + (hide ? '|hide' : '') + (ring ? '|ring' : '');
  if (cross !== S.crossSig) {
    S.crossSig = cross;
    const k = PM.cross;
    toggle(dom.cross, 'hud-cross-on', k === 'on' || k === 'dim');
    toggle(dom.cross, 'hud-cross-dim', k === 'dim');
    toggle(dom.cross, 'hud-cross-grab', k === 'grab' || k === 'drag');
    toggle(dom.cross, 'hud-cross-drag', k === 'drag');
    toggle(dom.cross, 'hud-cross-hide', hide);
    toggle(dom.cross, 'hud-cross-hold', ring);
  }
}

// ---------- 背包栏 ----------
function selectSlot(i) {
  const p = BR.player;
  if (!p || i < 0 || i >= SLOTS) return;
  if (has(p, 'select')) p.select(i);
  else p.selected = i;
}

function onSlotDown(i) {
  const p = BR.player;
  if (!S.visible || !p || p.dead || S.paused) return;
  const before = p.selected;
  selectSlot(i);
  if (p.selected !== before && has(BR.audio, 'play')) BR.audio.play('click', undefined, { volume: 0.4 });
}

function renderSlot(i, s) {
  const d = dom.slots[i];
  const label = '背包第 ' + (i + 1) + ' 格：';
  if (!s) {
    d.btn.classList.add('hud-slot-empty');
    d.icon.hidden = true;
    d.icon.removeAttribute('src');
    d.text.hidden = true;
    d.text.textContent = '';
    d.count.textContent = '';
    d.btn.setAttribute('aria-label', label + '空');
    return;
  }
  const def = BR.itemTypes.get(s.type);
  const name = itemName(s.type);
  const icon = def && typeof def.icon === 'string' ? def.icon : '';
  d.btn.classList.remove('hud-slot-empty');
  if (icon && !S.badIcons.has(icon)) {
    if (d.icon.getAttribute('src') !== icon) d.icon.setAttribute('src', icon);
    d.icon.hidden = false;
    d.text.hidden = true;
  } else {
    d.icon.hidden = true;
    d.icon.removeAttribute('src');
    d.text.textContent = name;
    d.text.hidden = false;
  }
  const n = s.count | 0;
  d.count.textContent = n > 1 ? '×' + n : '';
  d.btn.setAttribute('aria-label', label + name + (n > 1 ? ' ×' + n : ''));
}

function updateInventory(p) {
  const inv = p && p.inventory;
  for (let i = 0; i < SLOTS; i++) {
    const s = inv ? inv[i] : null;
    const sig = s && s.type ? s.type + '\n' + (s.count | 0) : '';
    if (sig !== S.slotSig[i]) {
      S.slotSig[i] = sig;
      renderSlot(i, sig ? s : null);
    }
  }

  const sel = p ? U.clamp(p.selected | 0, 0, SLOTS - 1) : -1;
  if (sel !== S.sel) {
    if (S.sel >= 0) dom.slots[S.sel].btn.classList.remove('hud-slot-sel');
    if (sel >= 0) dom.slots[sel].btn.classList.add('hud-slot-sel');
    S.sel = sel;
  }

  const cur = inv && sel >= 0 ? inv[sel] : null;
  const coop = coopActive();
  const noDrop = coop || DV.on;   // 联机不许丢；开车时丢弃键也不可用
  const nameSig = cur && cur.type ? cur.type + '|' + S.touch + '|' + noDrop : '';
  if (nameSig !== S.nameSig) {
    S.nameSig = nameSig;
    S.layoutDirty = true;   // 触屏开车提示行要绕开物品名
    dom.invName.hidden = !nameSig;
    if (nameSig) {
      const name = itemName(cur.type);
      // 联机时 player.js 不允许丢弃、开车时丢弃键不可用，就不提示 Q
      dom.invName.textContent = S.touch ? name + ' · 点「使用」' : name + ' · F 使用' + (noDrop ? '' : ' · Q 丢弃');
    }
  }
}

// ---------- 每帧 ----------
function syncTouch() {
  const t = isTouch();
  if (t === S.touch) return;
  // input.js 在第一次真实触摸时才补建触屏控件，isTouch 可能中途变 true
  S.touch = t;
  toggle(dom.root, 'hud-touch', t);
  S.promptSig = null;
  S.nameSig = null;
  S.layoutDirty = true;
  DV.place = null;
}

function update(dt) {
  if (!S.visible || !ensureDom()) return;
  dt = dt > 0 ? Math.min(dt, 0.1) : 0;
  const g = BR.game, p = BR.player, inp = BR.input;
  syncTouch();

  const dead = !!(p && p.dead);
  // 数字键切格。player.update 也读同样的边沿，select 幂等，两边都处理不会冲突
  if (p && !dead && has(inp, 'pressed')) {
    for (let i = 0; i < SLOTS; i++) if (inp.pressed('slot' + (i + 1))) selectSlot(i);
  }
  if (dead !== S.dead) {
    S.dead = dead;
    toggle(dom.root, 'hud-dead', dead);
  }
  // 暂停菜单、死亡结算盖着时 toast（z-index 90）会压住按钮：整组藏起来，关掉后没过期的照常显示
  const modal = S.paused || dead;
  if (modal !== S.toastModal) {
    S.toastModal = modal;
    toggle(dom.toasts, 'hud-toasts-modal', modal);
  }
  // 暂停中联机、麦克风状态会变（对方断开、申请结果回来）：按签名刷新开关麦，没有 coop:mic 事件也跟得上
  if (S.paused) { renderPauseMic(); renderPauseCoop(false); }

  updateStats(g, p);
  updateInfo(g);
  syncNoticeLayout();
  placeToastsBelowNotices();
  updateDrive(dead);
  updatePrompt(dt, p, dead);
  updateInventory(p);
}

// ---------- 开车提示（FE1） ----------
function buildDriveText(touch) {
  const box = dom.driveText;
  box.textContent = '';
  const segs = touch ? DRIVE_TOUCH : DRIVE_DESK;
  segs.forEach((seg, i) => {
    if (i) box.appendChild(document.createTextNode(' '));
    const last = i === segs.length - 1;
    if (touch) {
      // 触屏：每段是纯文字，一段（「按住「升」「降」动货叉 ·」）整段不折行；第二段拆成两块（中间没有空格）包在 .hud-drive-phrase 里，
      // 只有字号收到最小也放不下时（placeDrive 的 'hud-drive-split' 档，320 宽竖屏）才允许在两块之间折行
      const ph = seg.length > 1 ? mk('span', 'hud-drive-phrase', box) : box;
      seg.forEach((part, j) => {
        const sp = mk('span', 'hud-drive-seg', ph, part);
        if (j === seg.length - 1 && !last) mk('span', 'hud-drive-dot', sp, ' ·');
      });
    } else {
      // 电脑：「键 动作」，键画成小键帽
      const sp = mk('span', 'hud-drive-seg', box);
      mk('span', 'hud-drive-key', sp, seg[0]);
      sp.appendChild(document.createTextNode(' ' + seg[1]));
      if (!last) mk('span', 'hud-drive-dot', sp, ' ·');
    }
  });
  box.setAttribute('aria-label', box.textContent);
}

function driveShown() {
  if (!DV.state || !S.visible) return false;
  const inp = BR.input;
  // 输入情境被切回别的（死在车上、interact.reset）而 setDrive(null) 没来：提示行自己藏起来
  if (inp && typeof inp.context === 'string' && inp.context !== 'drive') return false;
  return true;
}

function setNote(on) {
  if (DV.noteOn === on) return;
  DV.noteOn = on;
  dom.driveNote.hidden = !on;
  S.layoutDirty = true;
  if (on) placeNote();
}

// 状态短提示居中在准心上方；窄竖屏右边那一列键（升、降）正好在这个高度：让开它们。一行放得下就照旧一行 —— 居中放不下时
// 往空的那一边挪（320×568 竖屏升键挪到「实体」入口左边以后，「发动中」居中会折成两行；FE1 返修 r2）；一行实在放不下才限宽折行（不截字）
function placeNote() {
  const el = dom.driveNote, st = el.style;
  st.maxWidth = ''; st.whiteSpace = ''; st.left = ''; st.transform = '';
  const inp = BR.input;
  if (!S.touch || !inp || !has(inp, 'touchLayout')) return;
  let L = null;
  try { L = inp.touchLayout(); } catch (err) { L = null; }
  if (!L) return;
  const r = el.getBoundingClientRect();
  if (!(r.height > 0)) return;
  const cx = L.W / 2, ins = L.safe || { l: 0, r: 0 };
  let lo = (ins.l || 0) + 16, hi = L.W - (ins.r || 0) - 16;
  // 折行后会往上长（底边贴着准心上方），上下各多看一行高；跨着中线的键不算（这个高度上没有）
  for (const b of L.buttons) {
    if (b.b <= r.top - r.height - DRIVE_GAP || b.t >= r.bottom + DRIVE_GAP) continue;
    if (b.l >= cx) hi = Math.min(hi, b.l - DRIVE_GAP);
    else if (b.r <= cx) lo = Math.max(lo, b.r + DRIVE_GAP);
  }
  const w = r.width;
  if (w <= hi - lo) {
    const x = Math.min(Math.max(cx - w / 2, lo), hi - w);
    if (Math.abs(x - (cx - w / 2)) > 0.5) { st.left = Math.round(x) + 'px'; st.transform = 'none'; }
    return;
  }
  st.maxWidth = Math.max(40, Math.floor(hi - lo)) + 'px'; st.whiteSpace = 'normal';
  st.left = Math.round(lo) + 'px'; st.transform = 'none';
}

function updateDrive(dead) {
  const on = driveShown() && !dead;
  if (on !== DV.on) {
    DV.on = on;
    dom.drive.hidden = !on;
    DV.place = null;
    S.layoutDirty = true;
    if (!on) { resetDrivePlace(); DV.note = ''; setNote(false); }
  }
  if (!on) return;
  if (DV.touch !== S.touch) {
    DV.touch = S.touch;
    buildDriveText(!!S.touch);
    DV.place = null;
    S.layoutDirty = true;
  }
  if (DV.noteOn && nowMs() >= DV.noteUntil) { DV.note = ''; setNote(false); }
  // 大标题晚于状态短提示出来（黑幕刚撤、先上了车）也让开
  if ((DV.noteOn || (DV.place && DV.place.upper)) && !dom.title.hidden) dodgeTitle();
}

function resetDrivePlace() {
  const st = dom.drive.style;
  st.left = st.top = st.width = st.bottom = st.transform = st.maxWidth = '';
  toggle(dom.drive, 'hud-drive-placed', false);
  for (const m of DRIVE_MODES) if (m) toggle(dom.drive, m, false);
  DV.place = null;
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom };
}

// 宽 w、高 h 的框放在 y 这一行能不能放下：返回离屏幕中线最近的那段空当 { x, a, b }（x 是框的左边），放不下返回 null
function freeX(obs, y, h, w, xMin, xMax, cx, gap) {
  const iv = [];
  for (const o of obs) if (o.b + gap > y && o.t - gap < y + h) iv.push([o.l - gap, o.r + gap]);
  iv.sort((a, b) => a[0] - b[0]);
  let best = null, bestD = Infinity, x0 = xMin;
  const tryGap = (a, b) => {
    if (b - a < w) return;
    const x = U.clamp(cx - w / 2, a, b - w);
    const d = Math.abs(x + w / 2 - cx);
    if (d < bestD) { bestD = d; best = { x, a, b }; }
  };
  for (const v of iv) {
    if (v[0] > x0) tryGap(x0, Math.min(v[0], xMax));
    x0 = Math.max(x0, v[1]);
    if (x0 >= xMax) break;
  }
  tryGap(x0, xMax);
  return best;
}

// 折好行以后框该有多宽：每一行从第一段左边到最后一段右边，取最长的那行，加上左右内边距和边框
function shrinkWidth(el) {
  const segs = el.querySelectorAll('.hud-drive-seg');
  const lines = new Map();
  for (const sg of segs) {
    const r = sg.getBoundingClientRect();
    const k = Math.round(r.top);
    const ln = lines.get(k);
    if (ln) { ln.l = Math.min(ln.l, r.left); ln.r = Math.max(ln.r, r.right); } else lines.set(k, { l: r.left, r: r.right });
  }
  let w = 0;
  lines.forEach(ln => { w = Math.max(w, ln.r - ln.l); });
  const cs = window.getComputedStyle(el);
  const extra = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  return Math.ceil(w + extra) + 1;
}

// 在准心提示下面、背包栏（连同上面物品名那一行）上面，找一块不压任何东西的空位：触屏量 BR.input.touchLayout() 的按钮和待机摇杆，
// 电脑只有准心提示和背包。先挑行数最少（最宽）放得下的，再挑最靠下的（贴着背包栏 / 摇杆上方，准心提示下面给 toast 留地方），
// 左右尽量居中。实在放不下就放宽：不给物品名留高度、间距减半；触屏每一档字号都放不下就挪到准心上方（状态短提示那一格上面）；
// 再不行才压住物品名那一行；最后才贴着准心提示居中（可能压到东西）
function placeDrive(pr) {
  const el = dom.drive;
  const inp = BR.input;
  let L = null;
  if (!S.touch) {
    L = { W: window.innerWidth || document.documentElement.clientWidth || 0, H: window.innerHeight || document.documentElement.clientHeight || 0,
      safe: { t: 0, r: 0, b: 0, l: 0 }, stick: null, buttons: [] };
  } else if (inp && has(inp, 'touchLayout')) {
    try { L = inp.touchLayout(); } catch (err) { L = null; }
  }
  // 触屏层暂时量不到（暂停时藏着、老 input）：保留上一次的位置，没摆过就是 CSS 的默认位置
  if (!L || !(L.W > 0) || !(L.H > 0)) return;
  const promptB = pr ? pr.bottom : L.H / 2 + 50;
  const sig = L.W + 'x' + L.H + '|' + Math.round(promptB) + '|' + S.nameSig + '|' + S.touch + '|' +
    L.buttons.map(b => b.act + Math.round(b.l) + ',' + Math.round(b.t)).join(';');
  if (DV.place && DV.place.sig === sig) return;
  const W = L.W, H = L.H, ins = L.safe;
  const xMin = ins.l + 8, xMax = W - ins.r - 8, yMin = promptB + DRIVE_GAP, cx = W / 2;
  const hard = L.buttons.slice();
  if (L.stick) hard.push({ l: L.stick.l, t: L.stick.t, r: L.stick.r2, b: L.stick.b });
  if (pr) hard.push({ l: pr.left, t: pr.top, r: pr.right, b: pr.bottom });
  const row = rectOf(dom.invRow);
  const inv = [row];
  let invTop = row.t;
  if (!dom.invName.hidden) { const nr = rectOf(dom.invName); inv.push(nr); invTop = Math.min(invTop, nr.t); }
  const reserve = { l: row.l, t: row.t - DRIVE_NAME_RESERVE, r: row.r, b: row.t };
  const floor = H - ins.b - 4;
  const st = el.style;
  toggle(el, 'hud-drive-placed', true);
  // 触屏按档试：13px 整段不折行 → 12px → 11px → 12px 允许「按住「升」「降」」和「动货叉」之间折行（只有 320 宽竖屏用得上）。
  // 第一个放得下（不压任何东西）的档就用它；都放不下用最后一档的兜底位置。电脑只有一档
  const modes = S.touch ? DRIVE_MODES : [''];
  let found = null, fit = false, mode = '', cands = [], upper = false;
  for (let mi = 0; mi < modes.length; mi++) {
    for (const m of DRIVE_MODES) if (m) toggle(el, m, m === modes[mi]);
    mode = modes[mi];
    const r = searchDrive(el, st, { hard, inv, reserve, row, invTop, floor, xMin, xMax, yMin, cx });
    found = r.found; cands = r.cands; fit = !!found;
    if (fit) break;
  }
  // 准心下面怎么都放不下（320×568 这种又窄又矮的竖屏：背包栏、物品名、按钮和摇杆把下半屏占满了）：挪到准心上方，
  // 状态短提示那一格上面、左上信息块下面，让开按钮、测试模式的「实体」键、联机的麦克风键（FE1 返修 r2：以前退到准心提示正下方，
  // 第二行压在物品名和背包栏上，字叠字）。还是按档试，先试字大的
  if (!found && S.touch) {
    const H2 = H / 2;
    let noteTop = H2 - 30 - 30;
    if (DV.noteOn && !dom.driveNote.hidden) { const nr = dom.driveNote.getBoundingClientRect(); if (nr.height > 0) noteTop = Math.min(noteTop, nr.top); }
    const ups = hard.concat(upperBlocks());
    for (let mi = 0; mi < modes.length && !found; mi++) {
      for (const m of DRIVE_MODES) if (m) toggle(el, m, m === modes[mi]);
      mode = modes[mi];
      const r = searchUpper(el, st, { hard: ups, xMin, xMax, cx, noteTop, topLimit: ins.t + 4 });
      if (r.found) { found = r.found; fit = true; upper = true; cands = r.cands; }
    }
  }
  // 还是放不下：压住物品名那一行（总比压住按钮强），按档再试一遍
  if (!found) {
    for (let mi = 0; mi < modes.length && !found; mi++) {
      for (const m of DRIVE_MODES) if (m) toggle(el, m, m === modes[mi]);
      mode = modes[mi];
      const r = searchDrive(el, st, { hard, inv, reserve, row, invTop, floor, xMin, xMax, yMin, cx, lastResort: true });
      if (r.found) { found = r.found; fit = true; cands = r.cands; }
    }
  }
  if (!found) {
    const c = cands[0] || { w: Math.min(el.offsetWidth, xMax - xMin) };
    found = { x: U.clamp(cx - c.w / 2, xMin, Math.max(xMin, xMax - c.w)), y: yMin, w: c.w };
  }
  st.width = Math.ceil(found.w) + 'px';
  st.left = Math.round(found.x) + 'px';
  st.top = Math.round(found.y) + 'px';
  DV.place = { sig, x: found.x, y: found.y, w: found.w, fit, cands, mode, upper };
}

// 上半屏别的东西：左上信息块、状态条、警告、横幅，联机的麦克风键（coop.js）、测试模式的「实体」键（testmode.js）
function upperBlocks() {
  const out = [];
  const others = [dom.infoBlock, dom.stats, dom.warn, dom.notices, document.querySelector('.coop-mic'), document.querySelector('.test-entry')];
  for (const o of others) {
    if (!o || o.hidden) continue;
    const r = o.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  return out;
}

// 量几种折行：先一行的自然宽度，再每次收窄 12px。每种行数记两个宽度：最宽的 w（浏览器从前往后塞满，「按住「升」「降」动货叉」
// 不被拆开）和最窄的 wn（左右余量最大），先试宽的
function measureCands(el, st, xMin, xMax) {
  st.transform = 'none'; st.bottom = 'auto'; st.left = '0px'; st.top = '0px';
  st.width = 'max-content'; st.maxWidth = Math.max(40, xMax - xMin) + 'px';
  const cands = [];
  // offsetWidth 是取整后的：小数宽度往下取整再设回去会多折一行，量外框再往上取整
  let w = Math.ceil(el.getBoundingClientRect().width) + 1;
  for (let k = 0; k < 40 && w > 40; k++) {
    st.width = w + 'px';
    // 比最长那一段还窄：字从框里溢出来了，再窄没有意义
    if (k && el.scrollWidth > el.clientWidth) break;
    const h = el.offsetHeight;
    if (!cands.length || h > cands[cands.length - 1].h) cands.push({ w, wn: w, h });
    else cands[cands.length - 1].wn = w;
    w -= 12;
  }
  return cands;
}

// placeDrive 准心下面放不下时的上半屏一档：从状态短提示那一格上面往上找，行数少的先试
function searchUpper(el, st, P) {
  const { hard, xMin, xMax, cx, noteTop, topLimit } = P;
  const cands = measureCands(el, st, xMin, xMax);
  for (const c of cands) {
    for (let y = Math.floor(noteTop - DRIVE_GAP - c.h); y >= topLimit; y -= 2) {
      const g = freeX(hard, y, c.h, c.wn, xMin, xMax, cx, DRIVE_GAP);
      if (!g) continue;
      st.width = Math.floor(Math.min(c.w, g.b - g.a)) + 'px';
      const cw = Math.min(c.w, g.b - g.a, shrinkWidth(el));
      return { found: { x: U.clamp(cx - cw / 2, g.a, g.b - cw), y, w: cw }, cands };
    }
  }
  return { found: null, cands };
}

// placeDrive 的一档：量几种折行（先一行的自然宽度，再每次收窄 12px），在准心提示和背包栏之间找空位。返回 { found | null, cands }
function searchDrive(el, st, P) {
  const { hard, inv, reserve, row, invTop, floor, xMin, xMax, yMin, cx } = P;
  const cands = measureCands(el, st, xMin, xMax);
  let found = null;
  // 一级级放宽：给物品名留高度 → 只绕开显示着的物品名 → 间距减半 → 物品名也不管了（压住物品名总比压住按钮强）
  // （最后这一级「压住物品名」只在每一档字号、准心上方都放不下以后才用：P.lastResort，见 placeDrive）
  const tries = P.lastResort ? [[hard.concat([row]), DRIVE_GAP / 2, Math.min(floor, row.t - DRIVE_GAP / 2)]] : [
    [hard.concat(inv, [reserve]), DRIVE_GAP, Math.min(floor, Math.min(invTop, reserve.t) - DRIVE_GAP)],
    [hard.concat(inv), DRIVE_GAP, Math.min(floor, invTop - DRIVE_GAP)],
    [hard.concat(inv), DRIVE_GAP / 2, Math.min(floor, invTop - DRIVE_GAP / 2)],
  ];
  // 同样行数在 [最窄, 最宽] 之间的宽度行数不变：用最窄的找位置，找到后在那段空当里放到尽量宽（前面的行塞得满，读起来顺）
  for (const t of tries) {
    for (const c of cands) {
      for (let y = Math.floor(t[2] - c.h); y >= yMin; y -= 2) {
        const g = freeX(t[0], y, c.h, c.wn, xMin, xMax, cx, t[1]);
        if (!g) continue;
        // 按空当宽度折好行，再把框收到最长那一行（CSS 折行后不会自己收窄）
        st.width = Math.floor(Math.min(c.w, g.b - g.a)) + 'px';
        const cw = Math.min(c.w, g.b - g.a, shrinkWidth(el));
        found = { x: U.clamp(cx - cw / 2, g.a, g.b - cw), y, w: cw };
        break;
      }
      if (found) break;
    }
    if (found) break;
  }
  return { found, cands };
}

function setDrive(state) {
  DV.state = state ? state : null;
  if (!dom.ready) return;
  // 下一帧 update 再按情境决定显不显示；收起立刻收
  if (!DV.state && DV.on) {
    DV.on = false;
    dom.drive.hidden = true;
    resetDrivePlace();
    DV.note = '';
    setNote(false);
    S.layoutDirty = true;
  }
  if (DV.state && S.visible) updateDrive(!!(BR.player && BR.player.dead));
}

function driveNote(text, ms) {
  if (!ensureDom()) return;
  if (text == null || text === '') { DV.note = ''; setNote(false); return; }
  text = String(text);
  const dur = num(ms, 0) > 0 ? ms : DRIVE_NOTE_MS;
  if (DV.state && S.visible && !DV.on) updateDrive(!!(BR.player && BR.player.dead));
  if (!DV.on) { toast(text, dur); return; }
  const node = dom.driveNote;
  if (DV.note !== text) {
    node.textContent = text;
    DV.note = text;
    if (DV.noteOn) { placeNote(); S.layoutDirty = true; }
  }
  DV.noteUntil = nowMs() + dur;
  // 新的一句、同一句再来都闪一下：玩家知道这是刚刚发生的
  node.classList.remove('hud-drive-note-bump');
  void node.offsetWidth;
  node.classList.add('hud-drive-note-bump');
  setNote(true);
  dodgeTitle();
}

// 进层 5 秒内就上车：层级大标题还没收，准心上方的开车状态短提示（「发动中」……）正好压在大标题那几行上 —— 大标题提前淡出
// （人已经在开车了，大标题让路；减少动态效果时直接收起）
function dodgeTitle() {
  const upper = DV.on && !!DV.place && !!DV.place.upper && !dom.drive.hidden;
  if (!dom.ready || dom.title.hidden || !(DV.noteOn || upper) || dom.title.classList.contains('hud-title-cut')) return;
  const a = dom.title.getBoundingClientRect();
  if (!(a.height > 0)) return;
  // 状态短提示，和挪到准心上方的常驻提示行（窄竖屏）
  const els = [];
  if (DV.noteOn) els.push(dom.driveNote);
  if (upper) els.push(dom.drive);
  let over = false;
  for (const e of els) {
    const b = e.getBoundingClientRect();
    if (!(b.height > 0)) continue;
    if (a.bottom + 4 <= b.top || b.bottom + 4 <= a.top || a.right <= b.left || b.right <= a.left) continue;
    over = true;
  }
  if (!over) return;
  clearTimeout(S.titleTimer);
  if (reducedMotion()) { hideTitle(); return; }
  dom.title.classList.add('hud-title-cut');
  S.titleTimer = setTimeout(hideTitle, TITLE_CUT_MS);
}

// ---------- 显示 / 提示 ----------
function show(v) {
  if (!ensureDom()) return;
  v = !!v;
  if (v === S.visible) return;
  S.visible = v;
  dom.root.hidden = !v;
  if (v) {
    // 隐藏期间可能换过局，旧的拾取目标不能留到新局第一帧
    S.target = null;
    S.promptTimer = 0;
    update(0);
  }
}

function prompt(text) {
  S.manualPrompt = text == null || text === '' ? null : String(text);
}

// ---------- toast ----------
function armToast(t, ms) {
  clearTimeout(t.timer);
  t.timer = setTimeout(() => dismissToast(t), ms);
}

function dismissToast(t) {
  if (t.leaving) return;
  t.leaving = true;
  clearTimeout(t.timer);
  t.node.classList.add('hud-toast-out');
  t.timer = setTimeout(() => removeToast(t), TOAST_OUT_MS);
}

function removeToast(t) {
  clearTimeout(t.timer);
  if (t.node.parentNode) t.node.parentNode.removeChild(t.node);
  const i = S.toasts.indexOf(t);
  if (i >= 0) S.toasts.splice(i, 1);
  if (DV.on) S.layoutDirty = true;
}

function clearToasts() {
  while (S.toasts.length) removeToast(S.toasts[0]);
}

// toast 的文字：「…」里的按钮名（「关大灯」「下车」……）不让断在两行（360 px 竖屏上「关 / 大灯」被拆开过，FE1 返修 r4）。
// 只是包一层不换行的 span，innerText 和原文一模一样
const NOBR_RE = /(「[^「」\n]{1,8}」)/;
function toastNode(text) {
  const n = mk('div', 'hud-toast', dom.toasts);
  for (const part of text.split(NOBR_RE)) {
    if (!part) continue;
    if (NOBR_RE.test(part) && part.charAt(0) === '「') mk('span', 'hud-nobr', n, part);
    else n.appendChild(document.createTextNode(part));
  }
  return n;
}

function toast(text, ms) {
  if (text == null || text === '' || !ensureDom()) return;
  text = String(text);
  const dur = num(ms, 0) > 0 ? ms : TOAST_MS;
  for (let i = 0; i < S.toasts.length; i++) {
    const t = S.toasts[i];
    if (t.text !== text || t.leaving) continue;
    // 同一句话连着来（对着满背包反复按空格）只续时间、闪一下边框，不刷屏
    armToast(t, dur);
    t.node.classList.remove('hud-toast-bump');
    void t.node.offsetWidth;
    t.node.classList.add('hud-toast-bump');
    return;
  }
  const t = { text, node: toastNode(text), timer: 0, leaving: false };
  S.toasts.push(t);
  if (DV.on) S.layoutDirty = true;   // 开车时新 toast 要看看会不会压到开车提示行
  let live = 0;
  for (let i = S.toasts.length - 1; i >= 0; i--) {
    const x = S.toasts[i];
    if (!x.leaving && ++live > TOAST_MAX) dismissToast(x);
  }
  armToast(t, dur);
}

// ---------- 层级大标题 ----------
function hideTitle() {
  clearTimeout(S.titleTimer);
  if (!dom.ready) return;
  dom.title.hidden = true;
  dom.title.classList.remove('hud-title-play');
  dom.title.classList.remove('hud-title-cut');
}

function levelTitle(level) {
  if (!ensureDom()) return;
  // 黑幕还没完全撤掉：先记下（最后一次算数），不碰去重计时；curtain(false) 淡出完再播
  if (C.state !== 'off') {
    if (level != null && level !== '') S.titleWait = level;
    return;
  }
  const def = level && typeof level === 'object' ? level : BR.levels.get(level);
  const id = def && def.id != null ? String(def.id) : level != null && typeof level !== 'object' ? String(level) : '';
  if (!id) return;
  const t = nowMs();
  if (S.titleId === id && t - S.titleAt < TITLE_DEDUPE_MS) return;
  S.titleId = id;
  S.titleAt = t;

  const name = (def && def.name) || ('Level ' + id);
  dom.titleName.textContent = String(name).toUpperCase();
  const sub = (def && def.title) || '';
  dom.titleSub.textContent = sub;
  dom.titleSub.hidden = !sub;
  // 有的版本写成 "Class 1"，去掉前缀免得出现"生存难度等级 Class 1"
  const sc = def && def.survivalClass != null ? String(def.survivalClass).replace(/^\s*class\s*/i, '').trim() : '';
  dom.titleClass.textContent = sc ? '生存难度等级 ' + sc : '';
  dom.titleClass.hidden = !sc;

  const n = dom.title;
  n.hidden = false;
  n.classList.remove('hud-title-play');
  n.classList.remove('hud-title-cut');
  void n.offsetWidth;   // 强制回流，同一个动画才能从头再播
  n.classList.add('hud-title-play');
  clearTimeout(S.titleTimer);
  // 减弱动效时没有 animationend，只能按时收起；正常情况只留一个很长的兜底，
  // 否则 HUD 晚于 level:enter 才显示时，动画会在淡出途中被掐掉
  S.titleTimer = setTimeout(hideTitle, reducedMotion() ? TITLE_REDUCED_MS : TITLE_SAFETY_MS);
}

// ---------- 暂停菜单 ----------
// 「返回主页」（单机）和「离开联机」（联机局）共用一个 2.5 s 确认窗口；btn 是这次进确认态的那个按钮
function setHomeConfirm(on, btn) {
  clearTimeout(S.homeTimer);
  const who = on ? (btn || dom.btnHome) : null;
  S.homeConfirmUntil = on ? nowMs() + HOME_CONFIRM_MS : 0;
  S.confirmBtn = who;
  if (!dom.ready) return;
  const home = who === dom.btnHome, leave = who === dom.btnLeave;
  toggle(dom.btnHome, 'hud-btn-confirm', home);
  dom.btnHome.textContent = home ? '再点一次，确认返回主页' : '返回主页';
  toggle(dom.btnLeave, 'hud-btn-confirm', leave);
  dom.btnLeave.textContent = leave ? LEAVE_CONFIRM_TEXT : LEAVE_TEXT;
  if (on) S.homeTimer = setTimeout(() => setHomeConfirm(false), HOME_CONFIRM_MS);
}

function confirming(btn) { return S.confirmBtn === btn && nowMs() <= S.homeConfirmUntil; }

function renderPause() {
  const g = BR.game;
  const vis = Math.round(U.clamp(num(g.settings && g.settings.visibility, 0.7), 0, 1) * 100);
  dom.visRange.value = String(vis);
  dom.visVal.textContent = vis + '%';
  dom.pauseHint.hidden = isTouch();
  setHomeConfirm(false);
  renderPauseCoop(true);
  renderPauseMic();
}

// 暂停菜单里跟联机有关的一组：副标题（层级、模式、房号）、顶上的小字、「返回主页」还是「回营地 / 离开联机」。
// force：刚打开菜单；否则按签名比较，状态没变不碰 DOM
function renderPauseCoop(force) {
  if (!dom.ready) return;
  const g = BR.game;
  const sess = coopSession(g), runs = worldRuns(), camp = sess && canGoCamp(g), code = waitingCode();
  const sig = [g.levelId, g.mode, g.difficulty, g.attackPlayers, inCamp(g), coopLive(), sess, runs, camp, code].join('|');
  if (!force && sig === S.pauseCoopSig) return;
  const was = S.pauseCoopSig;
  S.pauseCoopSig = sig;
  dom.pauseLevel.textContent = levelLabel(g.levelId);
  dom.pauseMode.textContent = modeLabel(g);
  if (code) codeLine(dom.pauseCode, code);
  dom.pauseCode.hidden = !code;
  dom.pauseCoop.hidden = !(sess && runs);
  dom.btnHome.hidden = sess;
  dom.pausePair.hidden = !sess;
  dom.btnCamp.hidden = !camp;
  const invite = !!code && !camp && !!BR.coop && typeof BR.coop.copyInvite === 'function';
  dom.btnInvite.hidden = !invite;
  if (!invite) { clearTimeout(S.inviteT); dom.btnInvite.textContent = INVITE_TEXT; }
  dom.btnLeave.hidden = !sess;
  toggle(dom.pausePair, 'hud-pause-pair-two', camp || invite);
  // 菜单开着时从联机变回单机（或反过来）：正在确认的那个按钮可能已经藏起来了，确认态作废
  if (!force && was !== null && S.confirmBtn && S.confirmBtn.hidden) setHomeConfirm(false);
}

function pauseMicCoop() {
  const c = BR.coop;
  return c && c.active && typeof c.setMic === 'function' ? c : null;
}

// 文案、配色与 coop.js 的麦克风按钮一致；micBusy 由 coop.js 导出，没有时当作不在申请中
function renderPauseMic() {
  if (!dom.ready) return;
  const c = pauseMicCoop();
  const on = !!(c && c.mic), busy = !!(c && c.micBusy);
  const sig = c ? (busy ? 'busy' : on ? 'on' : 'off') : '';
  if (sig === S.micSig) return;
  S.micSig = sig;
  dom.btnMic.hidden = !c;
  if (!c) return;
  toggle(dom.btnMic, 'hud-mic-on', on);
  toggle(dom.btnMic, 'hud-mic-busy', busy);
  dom.micTxt.textContent = busy ? '申请麦克风…' : on ? '开麦中' : '已闭麦';
  dom.btnMic.setAttribute('aria-pressed', on ? 'true' : 'false');
  dom.btnMic.setAttribute('aria-label', busy ? '正在申请麦克风，点击取消' : on ? '麦克风已打开，点击闭麦' : '麦克风已关闭，点击开麦');
}

function onMicClick() {
  if (!S.paused || nowMs() < S.pauseArmAt) return;
  const c = pauseMicCoop();
  if (!c) return;
  // 申请途中再点 = 取消，和 coop.js 的麦克风按钮一致
  const r = c.setMic(!(c.mic || c.micBusy));
  renderPauseMic();
  if (r && typeof r.then === 'function') r.then(renderPauseMic, renderPauseMic);
}

function closePause() {
  S.paused = false;
  setHomeConfirm(false);
  if (dom.ready) dom.pause.hidden = true;
  syncNoticeLayout();
}

function pause(v) {
  if (!ensureDom()) return false;
  const g = BR.game, inp = BR.input;
  if (v) {
    if (S.paused) return true;
    // Esc 在输入禁用时仍会产生 pause 边沿：主页、载入中、死亡结算时都不该弹暂停菜单
    if ((g.screen !== 'playing' && g.screen !== 'paused') || (BR.player && BR.player.dead)) return false;
    S.paused = true;
    g.screen = 'paused';
    if (inp) inp.enabled = false;
    renderPause();
    dom.pause.hidden = false;
    S.pauseArmAt = nowMs() + PAUSE_ARM_MS;
    if (!isTouch() && typeof dom.btnResume.focus === 'function') {
      try { dom.btnResume.focus({ preventScroll: true }); } catch (err) { dom.btnResume.focus(); }
    }
    syncNoticeLayout();
    BR.bus.emit('game:pause', { paused: true });
    return true;
  }
  if (!S.paused) return false;
  closePause();
  if (g.screen === 'paused') g.screen = 'playing';
  if (inp) inp.enabled = true;
  BR.bus.emit('game:pause', { paused: false });
  return true;
}

function onResumeClick() {
  if (!S.paused || nowMs() < S.pauseArmAt) return;
  pause(false);
  // 指针锁定只能在用户手势里请求：点「继续」时锁上；按 Esc 继续锁不上，玩家点一下画面即可（input.js 处理）
  const inp = BR.input;
  if (inp && !inp.isTouch && inp.enabled && has(inp, 'lock')) inp.lock();
}

function onHomeClick() {
  if (!S.paused || nowMs() < S.pauseArmAt) return;
  if (!confirming(dom.btnHome)) { setHomeConfirm(true, dom.btnHome); return; }
  closePause();
  BR.bus.emit('game:home');
}

// 「回营地」：要队友同意，问的横幅和回答由 BR.coopCamp 管。点了就关掉菜单回到游戏（世界本来就没停），
// 等回答期间照常能走能躲。back() 返回 false（没问出去，例如队友版本旧）也关：原因是 coopCamp 发的 toast，
// 暂停菜单开着时 toast 整组藏着，菜单留着玩家只会看到按钮没反应
function onCampClick() {
  if (!S.paused || nowMs() < S.pauseArmAt || dom.btnCamp.hidden) return;
  const cc = BR.coopCamp;
  if (!cc || typeof cc.back !== 'function') return;
  try { cc.back(); }
  catch (err) { console.error('[hud] coopCamp.back 出错', err); return; }
  if (!S.paused) return;
  pause(false);
  // 和「继续」一样，指针锁定只能在这次点击的调用栈里请求
  const inp = BR.input;
  if (inp && !inp.isTouch && inp.enabled && has(inp, 'lock')) inp.lock();
}

// 「复制邀请链接」：菜单留着（玩家多半接着去微信里发），按钮上闪一下结果
function onInviteClick() {
  if (!S.paused || nowMs() < S.pauseArmAt || dom.btnInvite.hidden) return;
  const c = BR.coop;
  if (!c || typeof c.copyInvite !== 'function') return;
  const flash = t => {
    dom.btnInvite.textContent = t;
    clearTimeout(S.inviteT);
    S.inviteT = setTimeout(() => { if (dom.ready) dom.btnInvite.textContent = INVITE_TEXT; }, 1800);
  };
  let p;
  try { p = c.copyInvite(); } catch (err) { console.error('[hud] coop.copyInvite 出错', err); p = null; }
  if (!p || typeof p.then !== 'function') { flash('复制失败：请记下房号'); return; }
  p.then(r => flash(r === 'copied' ? '已复制，发给朋友' : r === 'shared' ? '已分享' : '复制失败：请记下房号'), () => flash('复制失败：请记下房号'));
}

// 「离开联机」：点两次。先断开联机再回主页，回主页的那一串由 main.onGameHome 收拾
function onLeaveClick() {
  if (!S.paused || nowMs() < S.pauseArmAt || dom.btnLeave.hidden) return;
  if (!confirming(dom.btnLeave)) { setHomeConfirm(true, dom.btnLeave); return; }
  closePause();
  leaveCoop();
  BR.bus.emit('game:home');
}

function leaveCoop() {
  const c = BR.coop;
  if (!c || typeof c.leave !== 'function') return;
  try { c.leave(); } catch (err) { console.error('[hud] coop.leave 出错', err); }
}

function onVisInput() {
  const v = U.clamp((+dom.visRange.value || 0) / 100, 0, 1);
  const g = BR.game;
  if (!g.settings) g.settings = {};
  g.settings.visibility = v;
  dom.visVal.textContent = Math.round(v * 100) + '%';
  const env = currentEnv();
  if (env && BR.gfx && has(BR.gfx, 'applyEnv')) BR.gfx.applyEnv(env, v);
}

// ---------- 横幅（notice，z 65） ----------
function buildNotices() {
  dom.notices = mk('div', 'hud-notices');
  dom.notices.setAttribute('aria-live', 'assertive');
}

function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !/^(button|checkbox|radio|range|color|file|image|reset|submit)$/i.test(el.type || '');
}

// 触屏不画键帽；状态条开着时（窄屏左上信息块被挤到下面）、左上角多了房号那一行时，横幅再往下让一点。
// 暂停菜单 / 结算盖着时左上信息块已经被盖住，横幅改贴着顶部（.hud-notices-modal），别压住面板顶上的标题
// 矮横屏（高 ≤ 520：横屏手机、小窗口）toast 挪到右上角，和横幅（信息块下面、居中、最宽 560）在同一高度带，
// 「点一下画面开始」开着时又来一句「你们都穿黄色…」就叠在一起：有横幅时 toast 排到横幅底边下面 8px。
// 竖屏开着帐篷选单时 toast 也挪到了上半屏（css/tent.css），同样排到横幅下面
function placeToastsBelowNotices() {
  if (!dom.toasts || !dom.notices) return;
  let top = 0;
  const W = window.innerWidth || document.documentElement.clientWidth || 0;
  const H = window.innerHeight || document.documentElement.clientHeight || 0;
  const tentTop = H >= W && document.documentElement.classList.contains('br-tent-open');
  if (N.list.length && (H <= 520 || tentTop)) {
    const r = dom.notices.getBoundingClientRect();
    if (r.height > 0) top = Math.ceil(r.bottom + 8);
  }
  if (top === S.toastTop) return;
  S.toastTop = top;
  if (DV.on) S.layoutDirty = true;   // 开车时横幅一出来，toast 改成往上长、排到横幅下面
  toggle(dom.toasts, 'hud-toasts-below', top > 0);
  if (top > 0) dom.toasts.style.setProperty('--hud-toast-top', top + 'px');
}

function syncNoticeLayout() {
  if (!dom.ready) return;
  // 不读 S.toastModal（每帧 update 才更新）：暂停 / 死亡的那一刻 pause()、player:death 就直接调过来
  const modal = (S.paused || !!(BR.player && BR.player.dead)) && S.visible;
  const touch = isTouch(), stats = !modal && !!S.statsOn && S.visible, code = !modal && !!S.shownCode && S.visible;
  const sig = (touch ? 't' : 'd') + (stats ? 's' : '') + (code ? 'c' : '') + (modal ? 'm' : '');
  if (sig === S.noticeSig) return;
  S.noticeSig = sig;
  toggle(dom.notices, 'hud-notices-touch', touch);
  toggle(dom.notices, 'hud-notices-stats', stats);
  toggle(dom.notices, 'hud-notices-code', code);
  toggle(dom.notices, 'hud-notices-modal', modal);
}

function noticeKey(a, used) {
  if (a.key === false) return '';
  if (typeof a.key === 'string' && a.key) {
    const k = a.key.trim().toUpperCase();
    if (/^[A-Z]$/.test(k) && !NOTICE_KEY_RESERVED.test(k) && !used.has(k)) return k;
    console.warn('[hud] 横幅按钮的键「' + a.key + '」不能用（只认没被游戏占用的一个字母），改成自动分配');
  }
  for (const k of NOTICE_KEYS) if (!used.has(k)) return k;
  return '';
}

function remainSec(n) { return Math.max(0, Math.ceil((n.until - nowMs()) / 1000)); }

function renderCount(n) {
  if (!n.showCount) return;
  const s = n.until ? remainSec(n) : 0;
  if (s === n.countShown) return;
  n.countShown = s;
  n.count.textContent = String(s);
  n.count.hidden = !n.until;
}

function armTick() {
  const need = N.list.some(n => n.until > 0);
  if (need && !N.tick) N.tick = setInterval(noticeTick, NOTICE_TICK_MS);
  else if (!need && N.tick) { clearInterval(N.tick); N.tick = 0; }
}

function noticeTick() {
  const t = nowMs();
  // 先拷一份：到时回调里可能再开、再关横幅
  for (const n of N.list.slice()) {
    if (!n.open || !n.until) continue;
    if (t >= n.until) {
      closeNotice(n);
      if (typeof n.onTimeout === 'function') {
        try { n.onTimeout(n.handle); } catch (err) { console.error('[hud] notice onTimeout 出错', err); }
      }
    } else renderCount(n);
  }
  armTick();
}

function closeNotice(n) {
  if (!n.open) return;
  n.open = false;
  const a = document.activeElement;
  if (a && n.node.contains(a) && typeof a.blur === 'function') a.blur();
  if (n.node.parentNode) n.node.parentNode.removeChild(n.node);
  const i = N.list.indexOf(n);
  if (i >= 0) N.list.splice(i, 1);
  armTick();
  placeToastsBelowNotices();
}

function fireNotice(n, b) {
  if (!n.open || nowMs() < n.armAt) return;
  let r;
  try { r = typeof b.fn === 'function' ? b.fn(n.handle) : undefined; }
  catch (err) { console.error('[hud] 横幅按钮「' + b.label + '」出错', err); }
  if (r !== false) closeNotice(n);
}

function onNoticeKey(e) {
  if (!N.list.length || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  const k = e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : (e.key && e.key.length === 1 ? e.key.toUpperCase() : '');
  if (!k) return;
  // 后弹的优先
  for (let i = N.list.length - 1; i >= 0; i--) {
    const n = N.list[i];
    const b = n.btns.find(x => x.key === k);
    if (!b) continue;
    if (e.cancelable) e.preventDefault();
    fireNotice(n, b);
    return;
  }
}

// text：一行字（可以折行）；actions：[{ label, fn(句柄) → false 留着, key? }]；ms > 0 到时自动关；
// opts：{ countdown?: bool, onTimeout?: fn(句柄), keep?: bool（game:home 也不关）, cls?: 额外 class }
function notice(text, actions, ms, opts) {
  const o = opts || {};
  const n = { open: false, until: 0, armAt: 0, btns: [], countShown: -1, showCount: false, keep: !!o.keep, onTimeout: o.onTimeout, node: null };
  const handle = n.handle = {
    close() { closeNotice(n); },
    // set(text, ms)：换字；给了 ms 就从现在起重新倒数（0 = 不再自动关）
    set(t, ms2) {
      if (!n.node) return;
      n.text.textContent = t == null ? '' : String(t);
      if (ms2 !== undefined) {
        n.until = num(ms2, 0) > 0 ? nowMs() + ms2 : 0;
        n.countShown = -1;
        renderCount(n);
        armTick();
      }
    },
    get open() { return n.open; },
  };
  if (!ensureDom()) return handle;

  const acts = Array.isArray(actions) ? actions.filter(a => a && a.label != null && a.label !== '') : [];
  const node = n.node = mk('div', 'hud-notice' + (acts.length ? ' hud-notice-ask' : '') + (o.cls ? ' ' + o.cls : ''));
  node.setAttribute('role', acts.length ? 'alertdialog' : 'status');
  const head = mk('div', 'hud-notice-head', node);
  n.text = mk('div', 'hud-notice-text', head, text == null ? '' : String(text));
  n.count = mk('span', 'hud-notice-count', head);
  n.count.hidden = true;
  n.count.setAttribute('aria-hidden', 'true');
  if (acts.length) {
    const row = mk('div', 'hud-notice-acts', node);
    const used = new Set();
    acts.forEach((a, i) => {
      const btn = mk('button', 'hud-notice-btn' + (i === 0 ? ' hud-notice-btn-first' : ''), row, String(a.label));
      btn.type = 'button';
      btn.tabIndex = -1;   // 不拿焦点：玩家接着按空格互动时不会点到它（只认点击和键帽）
      btn.addEventListener('mousedown', (e) => { if (e.cancelable) e.preventDefault(); });
      const k = noticeKey(a, used);
      if (k) { used.add(k); btn.dataset.key = k; btn.setAttribute('aria-keyshortcuts', k); }
      const b = { label: String(a.label), fn: a.fn, key: k, btn };
      n.btns.push(b);
      tap(btn, () => fireNotice(n, b));
    });
  }
  n.showCount = o.countdown === true || (o.countdown !== false && acts.length > 0);
  n.until = num(ms, 0) > 0 ? nowMs() + ms : 0;
  n.armAt = nowMs() + (acts.length ? NOTICE_ARM_MS : 0);
  n.open = true;
  N.list.push(n);
  dom.notices.appendChild(node);
  // 要玩家拿主意的横幅（带按钮）出来时，正在播的层级大标题提前收掉：两个都在屏幕上半部中间，叠在一起谁都看不清
  // （回营地刚亮起来对方就离开时，「「X」离开了营地」压在「联机营地」大标题上，2026-10-05 返修）
  if (acts.length && !dom.title.hidden) hideTitle();
  syncNoticeLayout();
  placeToastsBelowNotices();
  renderCount(n);
  armTick();
  return handle;
}

function closeNotices(all) {
  for (const n of N.list.slice()) if (all || !n.keep) closeNotice(n);
}

// ---------- 黑幕（curtain，z 56） ----------
function buildCurtain() {
  const el = dom.curtain = mk('div', 'hud-curtain');
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  dom.curtainText = mk('div', 'hud-curtain-text', el);
}

function settle(list, v) {
  const fns = list.splice(0, list.length);
  for (const r of fns) r(v);
}

// 从当前实际不透明度出发，剩下多少走多少（被打断的半程不会再走满 0.4 s），done 在到位时调
function fadeCurtain(target, dur, done) {
  const el = dom.curtain;
  clearTimeout(C.timer);
  el.hidden = false;
  toggle(el, 'hud-curtain-on', target === 1);   // 全黑和淡入时挡住点击；淡出时放行
  let from = parseFloat(window.getComputedStyle(el).opacity);
  if (!isFinite(from)) from = target ? 0 : 1;
  const ms = Math.round(dur * Math.abs(target - from));
  el.style.transition = 'none';
  el.style.opacity = String(from);
  void el.offsetWidth;   // 先提交起点再开 transition
  el.style.transition = ms > 0 ? 'opacity ' + ms + 'ms linear' : 'none';
  el.style.opacity = String(target);
  // 用定时器不用 transitionend：起止相同、标签页在后台时 transitionend 不一定来（和 gfx.fade 一样）
  C.timer = setTimeout(done, ms > 0 ? ms + 30 : 0);
}

function flushTitle() {
  const t = S.titleWait;
  S.titleWait = null;
  if (t != null) levelTitle(t);
}

function curtain(text, ms) {
  if (!ensureDom()) return Promise.resolve(false);
  const dur = num(ms, -1) >= 0 ? U.clamp(ms, 0, CURTAIN_MAX_MS) : CURTAIN_FADE_MS;
  if (text === false || text === null) {
    // 撤黑幕：去重清掉，淡出完补播黑幕期间记下的大标题（同一层 3 秒内也要播）
    S.titleId = null;
    S.titleAt = 0;
    if (C.state === 'off') { flushTitle(); return Promise.resolve(true); }
    const p = new Promise(r => C.toClear.push(r));
    if (C.state === 'out') return p;
    settle(C.toBlack, false);   // 还没全黑就被撤：等全黑的那些照实说没到
    C.state = 'out';
    fadeCurtain(0, dur, () => {
      C.state = 'off';
      dom.curtain.hidden = true;
      settle(C.toClear, true);
      flushTitle();
    });
    return p;
  }
  const t = text == null ? '' : String(text);
  dom.curtainText.textContent = t;
  dom.curtainText.hidden = !t;
  if (C.state === 'black') return Promise.resolve(true);
  const p = new Promise(r => C.toBlack.push(r));
  if (C.state === 'in') return p;
  settle(C.toClear, false);     // 正在淡出又要黑：等撤完的那些照实说没撤完
  C.state = 'in';
  fadeCurtain(1, dur, () => {
    C.state = 'black';
    settle(C.toBlack, true);
  });
  return p;
}

// 回主页：立刻撤掉，不淡出；没 resolve 的都 resolve(false)，记下的大标题作废
function resetCurtain() {
  clearTimeout(C.timer);
  C.state = 'off';
  S.titleWait = null;
  if (dom.ready) {
    const el = dom.curtain;
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.hidden = true;
    toggle(el, 'hud-curtain-on', false);
  }
  settle(C.toBlack, false);
  settle(C.toClear, false);
}

// ---------- 事件 ----------
BR.bus.on('level:enter', (p) => {
  S.infoSig = null;
  if (p && p.id != null) levelTitle(p.id);
});

BR.bus.on('game:start', () => {
  setDrive(null);
  S.titleId = null;
  S.manualPrompt = null;
  S.target = null;
  clearToasts();
  if (S.paused) closePause();
});

BR.bus.on('game:home', () => {
  // 只收起菜单，不动输入：回主页时输入该保持禁用，由集成层决定
  if (S.paused) closePause();
  setDrive(null);
  S.manualPrompt = null;
  S.target = null;
  S.titleId = null;
  clearToasts();
  S.toastModal = false;
  if (dom.ready) toggle(dom.toasts, 'hud-toasts-modal', false);
  hideTitle();
  // 联机的横幅和黑幕都是局内的：回主页一律收掉（keep 的横幅除外）
  closeNotices(false);
  resetCurtain();
  S.shownCode = '';
  S.infoSig = null;
  show(false);
  syncNoticeLayout();   // 留下来的 keep 横幅按主页的版式排（没有状态条、没有房号那一行）
});

// 房号换了（续期、营地里落单后原地重开）：角标、暂停菜单立刻跟上；角标正显示着旧房号时 toast 一句
BR.bus.on('coop:code', (p) => {
  const code = p && typeof p.code === 'string' ? p.code : '';
  const old = S.shownCode;
  S.infoSig = null;
  if (S.paused) renderPauseCoop(true);
  if (code && old && code !== old && S.visible && waitingCode()) toast('房号换成了 ' + groupCode(code), CODE_TOAST_MS);
  if (S.visible) updateInfo(BR.game);
});

// 麦克风状态变了（coop.js 发）：暂停菜单开着就立即刷新；没有这个事件时靠 update 里的签名兜底
BR.bus.on('coop:mic', () => { if (S.paused) renderPauseMic(); });

BR.bus.on('player:death', () => {
  // 联机时暂停并不停世界，可能在菜单里被打死：让位给结算界面，输入保持禁用
  if (S.paused) closePause();
  S.target = null;
  syncNoticeLayout();   // 结算盖上来：开着的横幅（等回营地的回答之类）立刻贴顶
});

BR.bus.on('player:respawn', () => { syncNoticeLayout(); });

BR.bus.on('player:damage', (p) => {
  if (!p || !dom.ready) return;
  if (p.hp > 0) hit(dom.stat.hp);
  if (p.sanity > 0) hit(dom.stat.san);
});

BR.bus.on('item:pickup', (p) => {
  if (!p || !p.type || !S.visible) return;
  const n = p.count | 0;
  toast('拾取 ' + itemName(p.type) + (n > 1 ? ' ×' + n : ''), PICKUP_TOAST_MS);
});

// ---------- 导出 ----------
function init() {
  // 脚本放在 <head> 里时 body 还没有，等 DOM 就绪再建
  if (!ensureDom()) document.addEventListener('DOMContentLoaded', ensureDom, { once: true });
  return BR.hud;
}

BR.hud = {
  init, show, update, toast, levelTitle, prompt, pause,
  notice, curtain,
  setDrive, driveNote,
  get drive() {
    return { on: DV.on, touch: !!DV.touch, text: DV.on ? dom.driveText.textContent : '', note: DV.noteOn ? DV.note : '',
      place: DV.place ? { x: DV.place.x, y: DV.place.y, w: DV.place.w, fit: DV.place.fit, cands: DV.place.cands, mode: DV.place.mode || '', upper: !!DV.place.upper } : null };
  },
  get visible() { return S.visible; },
  get paused() { return S.paused; },
  get curtainState() { return C.state; },
};
})();
