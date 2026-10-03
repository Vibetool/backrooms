// 后室 · 输入：键鼠（指针锁定）+ 触屏（动态摇杆、右半屏滑动转视角、动作按钮）
// 公开接口见 ARCHITECTURE.md 第 12 节 BR.input。补充约定：
//   move.x 向右为正、move.y 前进为正，模长 ≤ 1；始终是同一个对象，可以缓存引用
//   consumeLook() 返回屏幕方向的弧度增量：dx 向右为正、dy 向下为正；怎么映射到 yaw/pitch 由 player 决定
//   enabled 默认 false（开局在主页），进入游玩画面时由 main 置 true
//   enabled=false 时只保留三个边沿：Esc 'pause'（菜单能用 Esc 关）、V 'mic'（暂停时也能开关麦）、T 'testmenu'（测试面板打开时能用 T 关）
//   麦克风、测试面板的触屏按钮分别由 coop.js、testmode.js 自建，不归本文件
//   额外接口：locked（只读）、sensitivity（视角灵敏度倍率，记在 localStorage）、
//     tap(el, fn)（菜单按钮轻点：另一根手指按着屏幕时也能触发，鼠标键盘照旧走 click，见「菜单按钮轻点」一节）
//
//   空格 / 长按（A1）：
//   - 空格（e.code 'Space'，老内核 e.key ' ' / 'spacebar'）和 E 都映射到 'interact'；E 只是隐藏别名，界面文字里只写空格
//   - 'interact'、'liftUp'、'liftDown' 是「动作级」计数：所有按着它的键和手指合在一起算，0→1 发 pressed、1→0 发 released，
//     空格和 E 同时按只出一次边沿；按下时刻取 event.timeStamp，同一帧里 down+up（Playwright keyboard.press）也能判成短按
//     released(a)        本帧松手（只有正常松手才发；关输入、失焦、情境不允许、按钮被禁用 = 打断，只发 cancelled）
//     cancelled(a)       按住被打断。从打断起一直为真，直到下一个「输入开着」的帧 endFrame 才清：
//                        单机暂停时 player 不跑，也不会漏；读的一方要幂等（idle 状态忽略即可）
//     heldMs(a)          还按着时已经按了多久（ms），没按着是 0
//     lastHoldMs(a)      上一次按住（松手或被打断）一共多久（ms）
//   - 输入关着时按下的 interact 不计数；按住穿过暂停再恢复，held 是 false，要重新按一次（e.repeat 不起头）
//   - 输入开着时空格的 keydown、keyup 都 preventDefault；BR.game.screen 为 'dead' / 'paused' 时也拦空格，
//     免得狂按空格点到暂停菜单、死亡结算里拿着焦点的按钮（只认 Enter 和点击）
//   - 触屏「互动」键按住也能滑动转视角（和冲刺键一样），但先有 10 px 死区，轻点不会晃视角
//   - haptic(ms)：包装 navigator.vibrate，iOS 等不支持的环境静默返回 false；页面还没被用户点过时也不调（Chrome 会报干预警告）
//
//   情境（setContext）：只改「已有动作怎么解释」，F 在所有情境里都是 use，Esc / 暂停键一直可用
//     'walk'   默认
//     'seat'   坐着：冲刺不可用（坐下、起身由 BR.interact 处理：空格短按起身）
//     'view'   看屏幕：冲刺不可用（换画面由 BR.interact 处理）
//     'drive'  开车：W/S/A/D 照旧进 move，由 BR.vehicles 读成油门和方向；冲刺、丢弃不可用；
//              多两个开车专用动作 liftUp（KeyR）/ liftDown（KeyC），手机上只在这个情境多显示「升」「降」两个触屏键。
//              下车 = 空格短按（BR.interact 处理）
//     liftUp / liftDown 只在 drive 里有效，别的情境按 R、C 什么都不发生
//   setButtons(map)：改触屏键的文字和可用状态，map = { interact|use|sprint|drop|liftUp|liftDown: { label, disabled } | null }
//     label 为 null / '' 恢复默认文字；disabled 为 true = 这个动作现在不可用（键灰掉，键盘也不响应），'pause' 不能禁用；
//     某个键给 null 清掉它的覆盖；setButtons(null) 全部清掉。换情境时覆盖一并清掉（同一情境重复 setContext 不清）
//   buttonLabel(a)：触屏键现在显示的文字（HUD 写「点「互动」…」时可以跟着它）
(function () {
'use strict';
const BR = window.BR;
const clamp = BR.util.clamp;

// ---------- 常量 ----------
const DESK_RAD_PER_PX = 0.0022;
// 触屏视角：划满右半屏约转 2.2 rad（126°），按屏宽换算每像素弧度再夹住；874 宽横屏正好是原来的固定值 0.005
const TOUCH_HALF_SWIPE_RAD = 2.2;
const TOUCH_RAD_MIN = 0.004, TOUCH_RAD_MAX = 0.012;
// 菜单按钮轻点（tap）：手指位移阈值；合成 click 的去重窗口；惯性滚动停下前这么久内按下的不算轻点
const TAP_SLOP = 12;
const TAP_CLICK_DEDUP_MS = 800;
const TAP_FLING_MS = 100;
const SENS_MIN = 0.2, SENS_MAX = 3;
const SENS_KEY = 'br.input.sensitivity';
// Esc 退出指针锁定时，部分浏览器还会补发 Esc 的 keydown；两路在这个窗口内只算一次暂停
const PAUSE_DEBOUNCE_MS = 400;
// Chrome 指针锁定偶发 movementX 突跳几百像素（光标被拽回窗口中心），单次超过就丢弃
const MOVE_SPIKE_PX = 600;
// 连续失败这么多次就当环境锁不了（如 iframe 没给 allow-pointer-lock），改成拖拽转视角、轻点即使用
const LOCK_FAIL_LIMIT = 2;
const STICK_DEAD = 0.12;
// 按住「互动」键滑动转视角前的死区：轻点、按住拖东西时拇指难免挪几像素，不该晃视角（冲刺键没有死区）
const INTERACT_LOOK_DEAD_PX = 10;
const HAPTIC_MAX_MS = 400;
// event.timeStamp 和 performance.now() 同源才能直接相减；差得离谱（老内核给的是纪元毫秒）就退回当前时刻
const TS_SANE_MS = 60000;

const EDGE_ACTIONS = { interact: 1, use: 1, pause: 1, drop: 1, slot1: 1, slot2: 1, slot3: 1, slot4: 1, slot5: 1, mic: 1, testmenu: 1, liftUp: 1, liftDown: 1 };
// 输入禁用（暂停、面板打开）时也要记录的边沿：它们本身就是开关菜单外功能用的
const ALWAYS_EDGES = { mic: 1, testmenu: 1 };
const MOVE_ACTIONS = { fwd: 1, back: 1, left: 1, right: 1 };
// 动作级计数的动作：按下 / 松开 / 打断 / 按了多久都按「所有键和手指合起来」算，见文件头
const ACT_LEVEL = { interact: 1, liftUp: 1, liftDown: 1 };

// 用 e.code 按物理键位映射，不受输入法和键盘布局影响
const CODE_ACTION = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'interact', KeyE: 'interact',   // KeyE 是隐藏别名
  KeyF: 'use', KeyQ: 'drop', Escape: 'pause', KeyV: 'mic', KeyT: 'testmenu',
  KeyR: 'liftUp', KeyC: 'liftDown',      // 只在 drive 情境有效
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
  Numpad1: 'slot1', Numpad2: 'slot2', Numpad3: 'slot3', Numpad4: 'slot4', Numpad5: 'slot5',
};
// 老内核没有 e.code 时退回 e.key
const KEY_ACTION = {
  w: 'fwd', arrowup: 'fwd', up: 'fwd', s: 'back', arrowdown: 'back', down: 'back',
  a: 'left', arrowleft: 'left', left: 'left', d: 'right', arrowright: 'right', right: 'right',
  shift: 'sprint', ' ': 'interact', spacebar: 'interact', e: 'interact',
  f: 'use', q: 'drop', escape: 'pause', esc: 'pause', v: 'mic', t: 'testmenu',
  r: 'liftUp', c: 'liftDown',
  1: 'slot1', 2: 'slot2', 3: 'slot3', 4: 'slot4', 5: 'slot5',
};

// 「升」「降」平时隐藏，只在 drive 情境显示
const TOUCH_BUTTONS = [['interact', '互动'], ['use', '使用'], ['sprint', '冲刺'], ['drop', '丢弃'], ['pause', '暂停'],
  ['liftUp', '升'], ['liftDown', '降']];
const BTN_DEFAULT = {};
for (const pair of TOUCH_BUTTONS) BTN_DEFAULT[pair[0]] = pair[1];

// 情境：off = 这个情境里不可用的动作（键盘、触屏都不响应，触屏键灰掉）；show = 这个情境才显示的触屏键
const LIFT_OFF = { liftUp: 1, liftDown: 1 };
const CONTEXTS = {
  walk: { off: LIFT_OFF, show: {} },
  seat: { off: Object.assign({ sprint: 1 }, LIFT_OFF), show: {} },
  view: { off: Object.assign({ sprint: 1 }, LIFT_OFF), show: {} },
  drive: { off: { sprint: 1, drop: 1 }, show: { liftUp: 1, liftDown: 1 } },
};
const HIDDEN_UNLESS_SHOWN = { liftUp: 1, liftDown: 1 };

// ---------- 状态 ----------
const move = { x: 0, y: 0 };
const S = {
  inited: false,
  canvas: null,
  enabled: false,
  touchDevice: false,     // 加载时就判定为触屏设备：不请求指针锁定
  sens: 1,
  keys: new Set(),        // 按住的键：e.code，老内核是 'key:' + e.key
  edges: new Set(),       // 本帧边沿动作，endFrame 清空
  lookDx: 0, lookDy: 0,
  lastPauseAt: -1e9,
  locked: false,
  expectUnlock: false,    // 自己调 exitPointerLock 时置位，免得被当成意外丢失
  lockFails: 0,
  skipMoves: 0,
  mouseUse: false,
  drag: null,             // 未锁定时按住画布拖动：{ x, y, moved }
  // 动作级计数（ACT_LEVEL）：srcs 是按着它的来源 'k:'+键 / 't:'+手指；on 是否算按着；downAt 按下时刻；lastHold 上次按了多久
  act: {},
  releases: new Set(),    // 本帧松手的动作，endFrame 清空
  cancels: new Set(),     // 被打断的动作，下一个输入开着的帧 endFrame 才清
  ctx: 'walk',
  btnOverride: {},        // setButtons 的覆盖：动作 → { label?, disabled? }
};
for (const a in ACT_LEVEL) S.act[a] = { on: false, downAt: 0, lastHold: 0, srcs: new Set() };
const T = {
  active: false,
  root: null, stickEl: null, knobEl: null, btns: {},
  owners: new Map(),      // touch.identifier → 'stick' | 'look' | 按钮动作
  btnTouches: {},         // 按钮动作 → 按着它的 identifier 集合（两根手指按同一个键也不会提前松开）
  // 冲刺 / 互动键手指 identifier → { x, y, skip, ox, oy, live }：按着拖动也转视角。
  // x/y 上次坐标；ox/oy 按下点；live 出了死区才开始转（冲刺键一按下就是 live）
  btnPos: new Map(),
  waiting: new Map(),     // 落在已被占用的摇杆/视角区的手指 identifier → { who, x, y, stale }，前一根抬起后接管
  landscape: null,        // 上次量到的横竖屏，只有它翻转才算转屏
  // reanchor / skip：转屏后下一次移动重定摇杆圆心 / 跳过一次视角增量
  stick: { id: null, ox: 0, oy: 0, r: 60, jx: 0, jy: 0, reanchor: false },
  look: { id: null, x: 0, y: 0, skip: false },
  scrollOk: new Map(),    // identifier → 这根手指落点是否允许浏览器原生滚动（可滚动面板、表单控件）
  lastTap: { t: 0, x: 0, y: 0 },
  // 菜单按钮轻点：document 捕获阶段数到的 touchend 次数、最近一次的时间；tap() 靠它认出不是在本元素上按下的合成 click
  touchEnds: 0, touchEndAt: -1e9, endWatch: false,
};

// ---------- 小工具 ----------
function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }

function detectTouch() {
  const nav = window.navigator || {};
  const ua = nav.userAgent || '';
  const points = nav.maxTouchPoints | 0;
  if (!('ontouchstart' in window) && points === 0) return false;
  let coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (err) { coarse = false; }
  // 触屏笔记本主指针是 fine，不算；老内核不认 pointer 媒体查询，靠 UA 兜底；iPadOS 13+ 的 UA 伪装成 Mac
  return coarse || /Android|iPhone|iPad|iPod|Mobile|MicroMessenger|Harmony/i.test(ua) ||
    (/Macintosh/.test(ua) && points > 1);
}

function keyId(e) {
  return e.code && e.code !== 'Unidentified' ? e.code : 'key:' + String(e.key || '').toLowerCase();
}
function actionOf(id) {
  return id.indexOf('key:') === 0 ? KEY_ACTION[id.slice(4)] : CODE_ACTION[id];
}
function keyHeld(action) {
  for (const id of S.keys) if (actionOf(id) === action) return true;
  return false;
}
function touchHeld(action) {
  const set = T.btnTouches[action];
  return !!set && set.size > 0;
}
function sprinting() { return S.enabled && !actionOff('sprint') && (keyHeld('sprint') || touchHeld('sprint')); }

function isSpaceId(id) { return id === 'Space' || id === 'key: ' || id === 'key:spacebar'; }

// 暂停菜单、死亡结算的「继续」拿着焦点：这时空格也要拦，只认 Enter 和点击
function screenBlocksSpace() {
  const g = BR.game;
  return !!g && (g.screen === 'dead' || g.screen === 'paused');
}

function evTime(e) {
  const n = nowMs();
  const ts = e && typeof e.timeStamp === 'number' ? e.timeStamp : -1;
  return ts > 0 && ts <= n + 50 && ts > n - TS_SANE_MS ? ts : n;
}

// ---------- 情境与按钮可用状态 ----------
// 这个动作现在能不能用：情境不允许，或 setButtons 禁用了。暂停永远可用
function actionOff(a) {
  if (a === 'pause') return false;
  const c = CONTEXTS[S.ctx];
  if (c && c.off[a]) return true;
  const o = S.btnOverride[a];
  return !!(o && o.disabled);
}

// ---------- 动作级计数（interact / liftUp / liftDown） ----------
function actDown(a, src, ts) {
  const st = S.act[a];
  if (!st || !S.enabled || actionOff(a)) return false;
  st.srcs.add(src);
  if (!st.on) {
    st.on = true;
    st.downAt = ts;
    S.edges.add(a);
  }
  return true;
}

function actUp(a, src, ts) {
  const st = S.act[a];
  if (!st || !st.srcs.delete(src) || st.srcs.size > 0 || !st.on) return;
  st.on = false;
  st.lastHold = Math.max(0, ts - st.downAt);
  S.releases.add(a);
}

// 打断：不发 released，只记 cancelled；来源全部丢掉，之后松开的键、手指都不再算数
function actCancel(a) {
  const st = S.act[a];
  if (!st) return;
  st.srcs.clear();
  if (!st.on) return;
  st.on = false;
  st.lastHold = Math.max(0, nowMs() - st.downAt);
  S.releases.delete(a);
  S.cancels.add(a);
}

function cancelAllAct() { for (const a in S.act) actCancel(a); }

// Mac 松开 ⌘ 时收不到别的键的 keyup：键盘来源全部作废，还有手指按着的不动
function dropKeySources() {
  for (const a in S.act) {
    const st = S.act[a];
    let had = false;
    for (const src of st.srcs) if (src.charAt(0) === 'k') { st.srcs.delete(src); had = true; }
    if (had && st.srcs.size === 0) actCancel(a);
  }
}

function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !/^(button|checkbox|radio|range|color|file|image|reset|submit)$/i.test(el.type || '');
}

function firePause() {
  const t = nowMs();
  if (t - S.lastPauseAt < PAUSE_DEBOUNCE_MS) return;
  S.lastPauseAt = t;
  S.edges.add('pause');
}

function addLook(px, py, radPerPx) {
  const k = radPerPx * S.sens;
  // 主循环有几帧没来取（淡入淡出、换层载入）时别攒出一个大跳
  S.lookDx = clamp(S.lookDx + px * k, -Math.PI, Math.PI);
  S.lookDy = clamp(S.lookDy + py * k, -Math.PI, Math.PI);
}

// 触屏视角每像素弧度随屏宽缩放：竖屏、小屏手机也能一两下转过身，平板不至于太灵
function touchRadPerPx() {
  return clamp(TOUCH_HALF_SWIPE_RAD / Math.max(1, window.innerWidth / 2), TOUCH_RAD_MIN, TOUCH_RAD_MAX);
}

function updateMove() {
  let x = 0, y = 0;
  if (S.enabled) {
    x = (keyHeld('right') ? 1 : 0) - (keyHeld('left') ? 1 : 0) + T.stick.jx;
    y = (keyHeld('fwd') ? 1 : 0) - (keyHeld('back') ? 1 : 0) + T.stick.jy;
    // 斜向键盘移动和"键盘+摇杆"叠加都不能超过 1，否则斜着走更快
    const m = Math.sqrt(x * x + y * y);
    if (m > 1) { x /= m; y /= m; }
  }
  move.x = x;
  move.y = y;
}

// 切后台、失焦时收不到 keyup/touchend，不清掉就会一直往前走
function releaseAll() {
  // 按着的空格 / 互动键算打断，不算松手：失焦那一下不能被当成短按拾取
  cancelAllAct();
  S.keys.clear();
  S.mouseUse = false;
  S.drag = null;
  S.lookDx = S.lookDy = 0;
  resetTouch();
  updateMove();
}

function setEnabled(v) {
  v = !!v;
  if (v === S.enabled) return;
  // 关输入时按着的 interact 只记 cancelled、不发 released；动作级的键本来就不进 S.keys，恢复后 held 不会直接为真
  if (!v) cancelAllAct();
  S.enabled = v;
  // 两个方向都清边沿：暂停瞬间残留的按键不该在菜单里生效，菜单里按的 Esc 也不该回到游戏后立刻再暂停一次。
  // cancels 不清：单机暂停时 player 不跑，留到恢复后的第一帧让 BR.interact 看到
  S.edges.clear();
  S.releases.clear();
  S.lookDx = S.lookDy = 0;
  S.mouseUse = false;
  S.drag = null;
  resetTouch();
  if (!v) {
    if (S.canvas && document.pointerLockElement === S.canvas && document.exitPointerLock) {
      S.expectUnlock = true;
      document.exitPointerLock();
    }
  } else {
    // 刚点过的「继续」按钮还带着焦点，不移走的话空格/回车会再触发它
    const a = document.activeElement;
    if (a && a !== document.body && !isTypingTarget(a) && typeof a.blur === 'function') a.blur();
  }
  updateMove();
  syncTouchVisibility();
}

// ---------- 键盘 ----------
function onKeyDown(e) {
  if (isTypingTarget(e.target)) return;
  const id = keyId(e);
  const act = actionOf(id);
  if (!act) return;
  // 带修饰键的留给浏览器快捷键；Mac 按住 ⌘ 时其他键收不到 keyup，记下来会卡键
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (ACT_LEVEL[act]) {
    // 动作级：输入关着时不计数；按住穿过暂停的那次（只剩 repeat）不起头，要重新按
    if (!e.repeat) actDown(act, 'k:' + id, evTime(e));
  } else {
    const fresh = !S.keys.has(id) && !e.repeat;
    S.keys.add(id);
    if (fresh) {
      if (act === 'pause') firePause();
      else if ((S.enabled || ALWAYS_EDGES[act]) && EDGE_ACTIONS[act] && !actionOff(act)) S.edges.add(act);
    }
    if (MOVE_ACTIONS[act]) updateMove();
  }
  // 方向键、空格别滚动页面；暂停菜单、结算里拿着焦点的按钮也不能被空格点到
  if ((S.enabled || (isSpaceId(id) && screenBlocksSpace())) && e.cancelable) e.preventDefault();
}

function onKeyUp(e) {
  // Mac 松开 ⌘ 之前按下的字母键不会发 keyup，干脆全部清掉
  if (e.key === 'Meta' || e.key === 'OS') { S.keys.clear(); dropKeySources(); updateMove(); return; }
  const id = keyId(e);
  const act = actionOf(id);
  if (ACT_LEVEL[act]) actUp(act, 'k:' + id, evTime(e));
  else if (S.keys.delete(id) && MOVE_ACTIONS[act]) updateMove();
  // 按钮在空格 keyup 时才合成 click，keydown 拦了 keyup 也要拦
  if (isSpaceId(id) && !isTypingTarget(e.target) && (S.enabled || screenBlocksSpace()) && e.cancelable) e.preventDefault();
}

// ---------- 鼠标与指针锁定 ----------
function lockSupported() {
  return !!(S.canvas && S.canvas.requestPointerLock && 'pointerLockElement' in document);
}
function lockUnusable() { return !lockSupported() || S.lockFails >= LOCK_FAIL_LIMIT; }

// 触屏层的两块滑动区盖在画布上，鼠标点到它们也等同点画布（触屏笔记本）
function isGameSurface(el) {
  if (!el) return false;
  if (el === S.canvas) return true;
  const who = el.dataset && el.dataset.touch;
  return who === 'stick' || who === 'look';
}

function lock() {
  const c = S.canvas;
  if (!c || S.touchDevice || !lockSupported() || document.pointerLockElement === c) return;
  try {
    const p = c.requestPointerLock();
    // 新版 Chrome 返回 Promise；失败次数统一在 pointerlockerror 里记，这里只吞掉 rejection
    if (p && typeof p.then === 'function') p.then(null, function () {});
  } catch (err) {
    S.lockFails++;
  }
}

function onLockChange() {
  const isLocked = !!S.canvas && document.pointerLockElement === S.canvas;
  if (isLocked === S.locked) return;
  S.locked = isLocked;
  if (isLocked) {
    S.lockFails = 0;
    S.skipMoves = 1;      // 刚锁上的第一次 movement 常带着光标归位的大跳
    S.drag = null;
    return;
  }
  S.mouseUse = false;
  if (S.expectUnlock) { S.expectUnlock = false; return; }
  // 用户按 Esc、切标签页、系统弹窗抢焦点：游戏里视角突然不跟手，必须停下来
  if (S.enabled) firePause();
}

function onLockError() { S.lockFails++; }

function onMouseDown(e) {
  if (!S.enabled) return;
  if (S.locked) {
    if (e.button === 0) { S.mouseUse = true; S.edges.add('use'); }
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (e.button !== 0 || !isGameSurface(e.target)) return;
  // 没锁定时这一下只负责锁鼠标，不算"使用"
  S.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  lock();
}

function onMouseMove(e) {
  if (!S.enabled) return;
  if (S.locked) {
    if (S.skipMoves > 0) { S.skipMoves--; return; }
    const mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > MOVE_SPIKE_PX || Math.abs(my) > MOVE_SPIKE_PX) return;
    addLook(mx, my, DESK_RAD_PER_PX);
    return;
  }
  // 锁不上（或锁定还没生效）时退化成按住拖动转视角
  const d = S.drag;
  if (!d) return;
  if (e.buttons !== undefined && (e.buttons & 1) === 0) { S.drag = null; return; }   // 在窗口外松开了
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.x = e.clientX;
  d.y = e.clientY;
  d.moved += Math.abs(dx) + Math.abs(dy);
  addLook(dx, dy, DESK_RAD_PER_PX);
}

function onMouseUp(e) {
  if (e.button !== 0) return;
  S.mouseUse = false;
  const d = S.drag;
  S.drag = null;
  // 锁不上的环境没有"先点一下锁鼠标"这一步，轻点就当使用
  if (d && S.enabled && !S.locked && lockUnusable() && d.moved < 6) S.edges.add('use');
}

function onContextMenu(e) {
  const tgt = e.target;
  if (isTypingTarget(tgt)) return;
  // 触屏游玩中长按任何地方都不该弹菜单；桌面只拦画布和触屏层，菜单里的右键照常
  if (tgt === S.canvas || (T.root && T.root.contains(tgt)) || (T.active && S.enabled)) e.preventDefault();
}

// ---------- 触屏控件 ----------
function btnCss(cls, size, right, v, fromTop, extra) {
  const side = fromTop ? 'top' : 'bottom';
  return '.touch-btn-' + cls + '{width:' + size + 'px;height:' + size + 'px;' +
    'right:' + right + 'px;right:calc(' + right + 'px + env(safe-area-inset-right, 0px));' +
    side + ':' + v + 'px;' + side + ':calc(' + v + 'px + env(safe-area-inset-' + side + ', 0px));' +
    (extra || '') + '}';
}

// 前一条声明是不认 env() 的老内核的兜底，认的会被后一条覆盖
const TOUCH_CSS = [
  '.touch-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:20;pointer-events:none;box-sizing:border-box;' +
    // padding 不影响绝对定位的子元素，只当安全区探针给 JS 读
    'padding:0;padding:env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);' +
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;' +
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
  '.touch-root[hidden],.touch-root [hidden]{display:none!important}',
  '.touch-zone{position:absolute;top:0;bottom:0;width:50%;pointer-events:auto;touch-action:none}',
  '.touch-zone-l{left:0}',
  '.touch-zone-r{right:0}',
  '.touch-stick{position:absolute;left:0;top:0;box-sizing:border-box;border-radius:50%;pointer-events:none;' +
    'border:2px solid rgba(255,240,170,.42);background:rgba(22,19,8,.28);opacity:.35;transition:opacity .15s;will-change:transform}',
  '.touch-stick.touch-on{opacity:1}',
  '.touch-knob{position:absolute;left:50%;top:50%;border-radius:50%;background:rgba(255,242,184,.62);box-shadow:0 1px 8px rgba(0,0,0,.4)}',
  '.touch-btn{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
    'pointer-events:auto;touch-action:none;border-radius:50%;border:2px solid rgba(255,240,170,.55);' +
    'background:rgba(22,19,8,.42);color:#fff5cc;font-size:14px;font-weight:600;letter-spacing:1px;' +
    'text-shadow:0 1px 2px rgba(0,0,0,.7);transition:transform .08s,background-color .08s}',
  '.touch-btn.touch-on{background:rgba(255,236,150,.62);color:#211d0c;text-shadow:none;transform:scale(.93)}',
  // 当前情境不可用（开车时的冲刺、丢弃）：灰掉，按了没反应
  '.touch-btn.touch-off{opacity:.4;border-color:rgba(200,200,200,.4);background:rgba(30,30,30,.36);color:#bdbdbd}',
  '.touch-btn.touch-off.touch-on{transform:none}',
  // setButtons 换的文字超过两个字时缩小字号，免得撑出圆圈
  '.touch-btn.touch-long{font-size:12px;letter-spacing:0}',
  // 右下角弧形排布：拇指落点最近的是「使用」，互动在左、冲刺在上，丢弃在冲刺左侧、互动上方；
  // 右上角只有暂停，麦克风按钮由 coop.js 摆在它下方
  btnCss('use', 76, 22, 26, false, 'font-size:16px'),
  btnCss('interact', 62, 112, 30, false),
  btnCss('sprint', 62, 30, 116, false),
  btnCss('drop', 52, 117, 104, false, 'font-size:13px;letter-spacing:0'),
  btnCss('pause', 48, 12, 12, true, 'border-radius:14px;font-size:13px;letter-spacing:0'),
  // 开车专用「升」「降」：只在 drive 情境显示。横屏摞在丢弃键正上方，升在上：
  // 底边中间是背包格和物品名（窄横屏、平板竖屏会伸到右边），屏幕中线下方是拾取提示（css/game.css 限宽到 right:177 以左），都让开
  btnCss('liftUp', 54, 120, 234, false, 'font-size:16px'),
  btnCss('liftDown', 54, 120, 168, false, 'font-size:16px'),
  // 竖屏（与 css/game.css 背包改两排的断点相同）：左下物品名标签和互动、冲刺同一高度带，长名字会伸到丢弃键底下，
  // 丢弃键挪到冲刺键正上方；升降键接着摞在丢弃键上面（右边一列）：互动键上方是长物品名，屏幕中间是提示，
  // 开车时的提示只有「下车」这类短字，居中放得下
  '@media (max-width:559px){' + btnCss('drop', 52, 35, 188, false) +
    btnCss('liftDown', 50, 36, 252, false) + btnCss('liftUp', 50, 36, 308, false) + '}',
].join('\n');

function injectStyle() {
  if (document.getElementById('touch-style')) return;
  const s = document.createElement('style');
  s.id = 'touch-style';
  s.textContent = TOUCH_CSS;
  (document.head || document.documentElement).appendChild(s);
}

function mk(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
}

function buildTouchUI() {
  if (T.root) return;
  injectStyle();
  const host = document.getElementById('ui') || document.body;
  const root = mk('touch-root');
  root.hidden = true;
  mk('touch-zone touch-zone-l', root).dataset.touch = 'stick';
  mk('touch-zone touch-zone-r', root).dataset.touch = 'look';
  T.stickEl = mk('touch-stick', root);
  T.knobEl = mk('touch-knob', T.stickEl);
  for (const pair of TOUCH_BUTTONS) {
    const b = mk('touch-btn touch-btn-' + pair[0], root);
    b.dataset.touch = pair[0];
    b.textContent = pair[1];
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', pair[1]);
    T.btns[pair[0]] = b;
  }
  const opt = { passive: false };
  root.addEventListener('touchstart', onRootStart, opt);
  root.addEventListener('touchmove', onRootMove, opt);
  root.addEventListener('touchend', onRootEnd, opt);
  root.addEventListener('touchcancel', onRootEnd, opt);
  host.appendChild(root);
  T.root = root;
  applyButtons();
  layoutStickIdle();
}

function btnShown(act) {
  if (!HIDDEN_UNLESS_SHOWN[act]) return true;
  const c = CONTEXTS[S.ctx];
  return !!(c && c.show[act]);
}

// 情境或 setButtons 变了：打断不再可用的动作，刷新触屏键的文字、显隐和灰态
function applyButtons() {
  for (const a in S.act) if (actionOff(a)) actCancel(a);
  for (const act in BTN_DEFAULT) {
    const el = T.btns[act];
    if (!el) continue;
    const o = S.btnOverride[act];
    const label = (o && o.label) || BTN_DEFAULT[act];
    if (el.textContent !== label) {
      el.textContent = label;
      el.setAttribute('aria-label', label);
    }
    el.classList.toggle('touch-long', label.length > 2);
    const shown = btnShown(act), off = actionOff(act);
    if (el.hidden !== !shown) el.hidden = !shown;
    el.classList.toggle('touch-off', off);
    if (off) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
    // 正按着的键被藏起来或禁用：当作松开（动作级的已经在上面算成打断）
    if ((off || !shown) && touchHeld(act)) clearButton(act);
  }
}

function setContext(ctx) {
  if (!CONTEXTS[ctx]) return false;
  if (ctx === S.ctx) return true;
  S.ctx = ctx;
  S.btnOverride = {};
  applyButtons();
  return true;
}

function setButtons(map) {
  if (map == null) S.btnOverride = {};
  else if (typeof map === 'object') {
    for (const act in map) {
      if (!BTN_DEFAULT[act]) continue;
      const v = map[act];
      if (v == null) { delete S.btnOverride[act]; continue; }
      if (typeof v !== 'object') continue;
      const o = S.btnOverride[act] || (S.btnOverride[act] = {});
      if ('label' in v) {
        if (v.label == null || v.label === '') delete o.label;
        else o.label = String(v.label);
      }
      if ('disabled' in v) {
        if (v.disabled == null || act === 'pause') delete o.disabled;
        else o.disabled = !!v.disabled;
      }
    }
  }
  applyButtons();
}

function buttonLabel(act) {
  const o = S.btnOverride[act];
  return (o && o.label) || BTN_DEFAULT[act] || '';
}

function haptic(ms) {
  const nav = window.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return false;   // iOS Safari、桌面 Safari 没有
  if (!(S.touchDevice || T.active)) return false;
  // 页面还没被用户点过时 Chrome 会拦下并在控制台报干预警告
  const ua = nav.userActivation;
  if (ua && ua.hasBeenActive === false) return false;
  const d = Math.round(clamp(+ms || 0, 0, HAPTIC_MAX_MS));
  if (d <= 0) return false;
  try { return !!nav.vibrate(d); } catch (err) { return false; }
}

function syncTouchVisibility() {
  if (!T.root) return;
  // 别的模块清空 #ui 时会把控件一起带走，补挂回去，免得手机上突然没法操作
  if (!document.body.contains(T.root)) (document.getElementById('ui') || document.body).appendChild(T.root);
  const wasHidden = T.root.hidden;
  T.root.hidden = !S.enabled;
  // 隐藏时量不到安全区，显示出来再摆一次待机摇杆
  if (wasHidden && S.enabled) layoutStickIdle();
}

function safeInsets() {
  if (!T.root) return { t: 0, r: 0, b: 0, l: 0 };
  const cs = window.getComputedStyle(T.root);
  return {
    t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
    b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0,
  };
}

function stickRadius() { return clamp(Math.min(window.innerWidth, window.innerHeight) * 0.13, 44, 72); }

function sizeStick(r) {
  const kr = Math.round(r * 0.45);
  const s = T.stickEl.style, k = T.knobEl.style;
  s.width = s.height = (r * 2) + 'px';
  k.width = k.height = (kr * 2) + 'px';
  k.marginLeft = k.marginTop = (-kr) + 'px';
  T.stick.r = r;
}

function drawStick(cx, cy, kx, ky) {
  const r = T.stick.r;
  T.stickEl.style.transform = 'translate3d(' + (cx - r) + 'px,' + (cy - r) + 'px,0)';
  T.knobEl.style.transform = 'translate3d(' + kx + 'px,' + ky + 'px,0)';
}

// 没按住时在左下角留一个半透明摇杆，告诉玩家这里能拖
function layoutStickIdle() {
  if (!T.stickEl || T.stick.id !== null) return;
  sizeStick(stickRadius());
  const ins = safeInsets(), r = T.stick.r, W = window.innerWidth, H = window.innerHeight;
  // 竖屏背包是左下两排格子 + 物品名，约 146px 高（断点与 css/game.css 的 max-width:559px 一致），圈要整个画在它上面
  const floor = W < 560 ? r + 146 : 0;
  drawStick(ins.l + Math.max(r + 28, W * 0.13), H - ins.b - Math.max(r + 40, H * 0.24, floor), 0, 0);
  T.stickEl.classList.remove('touch-on');
}

function startStick(t) {
  const st = T.stick;
  sizeStick(stickRadius());
  st.id = t.identifier;
  st.ox = t.clientX;
  st.oy = t.clientY;
  st.jx = st.jy = 0;
  st.reanchor = false;
  T.stickEl.classList.add('touch-on');
  drawStick(st.ox, st.oy, 0, 0);
}

function moveStick(t) {
  const st = T.stick, r = st.r;
  if (st.reanchor) {
    // 转屏后旧圆心在新坐标系里没有意义，以手指当前位置为圆心重新起算，免得一下跳到反方向满推
    st.reanchor = false;
    st.ox = t.clientX;
    st.oy = t.clientY;
  }
  let dx = t.clientX - st.ox, dy = t.clientY - st.oy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > r) {
    // 拖出圈外时圆心跟着手指走，往反方向推时不必先退回整个半径
    dx *= r / len;
    dy *= r / len;
    st.ox = t.clientX - dx;
    st.oy = t.clientY - dy;
  }
  const m = Math.min(len, r) / r;
  if (m < STICK_DEAD) {
    st.jx = st.jy = 0;
  } else {
    // 死区外重新映射到 0..1，否则刚出死区就是 0.12 的突变
    const k = (m - STICK_DEAD) / (1 - STICK_DEAD) / (m * r);
    st.jx = dx * k;
    st.jy = -dy * k;
  }
  drawStick(st.ox, st.oy, dx, dy);
  updateMove();
}

function endStick() {
  T.stick.id = null;
  T.stick.jx = T.stick.jy = 0;
  layoutStickIdle();
  updateMove();
}

// 灰掉的键（当前情境不可用）、藏起来的键按了不响应，手指也不转去控制视角
function pressButton(act, id, ts) {
  const el = T.btns[act];
  if (!el || el.hidden || actionOff(act)) return false;
  const set = T.btnTouches[act] || (T.btnTouches[act] = new Set());
  const first = set.size === 0;
  set.add(id);
  // 动作级：每根手指都是一个来源，和键盘合起来数
  if (ACT_LEVEL[act]) actDown(act, 't:' + id, ts);
  if (first) {
    el.classList.add('touch-on');
    if (act === 'pause') firePause();
    else if (!ACT_LEVEL[act] && EDGE_ACTIONS[act]) S.edges.add(act);
  }
  return true;
}

function releaseButton(act, id, ts) {
  const set = T.btnTouches[act];
  if (!set || !set.delete(id)) return;
  if (ACT_LEVEL[act]) actUp(act, 't:' + id, ts);
  if (set.size > 0) return;
  if (T.btns[act]) T.btns[act].classList.remove('touch-on');
}

function clearButton(act) {
  const set = T.btnTouches[act];
  if (set) {
    // 动作级：这些手指不再算数；只剩它们按着的话算打断，不算松手
    const st = S.act[act];
    if (st && set.size > 0) {
      set.forEach(function (id) { st.srcs.delete('t:' + id); });
      if (st.srcs.size === 0) actCancel(act);
    }
    set.clear();
  }
  if (T.btns[act]) T.btns[act].classList.remove('touch-on');
}

function resetTouch() {
  T.owners.clear();
  T.waiting.clear();
  T.btnPos.clear();
  T.stick.id = null;
  T.stick.jx = T.stick.jy = 0;
  T.stick.reanchor = false;
  T.look.id = null;
  T.look.skip = false;
  for (const act in T.btnTouches) clearButton(act);
  layoutStickIdle();
}

function ownerOf(el) {
  for (; el && el !== T.root; el = el.parentNode) {
    if (el.dataset && el.dataset.touch) return el.dataset.touch;
  }
  return null;
}

// 手指接管摇杆或视角区；stale 表示坐标是转屏前记下的，接管后的第一次移动要重锚
function takeZone(who, id, x, y, stale) {
  if (who === 'stick') {
    startStick({ identifier: id, clientX: x, clientY: y });
    T.stick.reanchor = stale;
  } else {
    T.look.id = id;
    T.look.x = x;
    T.look.y = y;
    T.look.skip = stale;
  }
}

// 前一根手指抬起后，同区等着的手指从它当前的位置接管，不会跳
function promoteWaiting(who) {
  for (const entry of T.waiting) {
    const id = entry[0], w = entry[1];
    if (w.who !== who) continue;
    T.waiting.delete(id);
    takeZone(who, id, w.x, w.y, w.stale);
    T.owners.set(id, who);
    return;
  }
}

// 每根手指从落下起就归属一个控件，按 identifier 路由：摇杆、转视角、按钮互不抢
function onRootStart(e) {
  if (e.cancelable) e.preventDefault();   // 挡掉合成鼠标事件、双击缩放、长按菜单
  if (!S.enabled) return;
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (T.owners.has(t.identifier) || T.waiting.has(t.identifier)) continue;
    const who = ownerOf(t.target);
    if (!who) continue;
    if (who === 'stick' || who === 'look') {
      // 这块区域已经有手指了：先记下来，等前一根抬起再接管，不用抬起重按
      if ((who === 'stick' ? T.stick.id : T.look.id) !== null) {
        T.waiting.set(t.identifier, { who, x: t.clientX, y: t.clientY, stale: false });
        continue;
      }
      takeZone(who, t.identifier, t.clientX, t.clientY, false);
    } else {
      if (!pressButton(who, t.identifier, evTime(e))) continue;
      // 按着冲刺拖动顺带转视角：两个拇指就能边冲刺边拐弯；按着互动（拖东西）也能转，但先过 10 px 死区
      if (who === 'sprint' || who === 'interact') {
        T.btnPos.set(t.identifier, { x: t.clientX, y: t.clientY, skip: false, ox: t.clientX, oy: t.clientY, live: who === 'sprint' });
      }
    }
    T.owners.set(t.identifier, who);
  }
}

// 按钮手指滑动转视角；互动键没出死区前不转，出死区那一刻从死区边上接着算，不会突跳
function moveBtnLook(p, t) {
  const cx = t.clientX, cy = t.clientY;
  if (p.skip) {
    p.skip = false;
    p.x = cx; p.y = cy;
    if (!p.live) { p.ox = cx; p.oy = cy; }
    return;
  }
  if (!p.live) {
    const dx = cx - p.ox, dy = cy - p.oy, d = Math.sqrt(dx * dx + dy * dy);
    if (d < INTERACT_LOOK_DEAD_PX) return;
    p.live = true;
    p.x = p.ox + dx * INTERACT_LOOK_DEAD_PX / d;
    p.y = p.oy + dy * INTERACT_LOOK_DEAD_PX / d;
  }
  addLook(cx - p.x, cy - p.y, touchRadPerPx());
  p.x = cx;
  p.y = cy;
}

function onRootMove(e) {
  if (e.cancelable) e.preventDefault();
  if (!S.enabled) return;
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const w = T.waiting.get(t.identifier);
    if (w) { w.x = t.clientX; w.y = t.clientY; w.stale = false; continue; }
    const who = T.owners.get(t.identifier);
    if (who === 'stick') {
      moveStick(t);
    } else if (who === 'look') {
      if (T.look.skip) T.look.skip = false;
      else addLook(t.clientX - T.look.x, t.clientY - T.look.y, touchRadPerPx());
      T.look.x = t.clientX;
      T.look.y = t.clientY;
    } else if (who === 'sprint' || who === 'interact') {
      const p = T.btnPos.get(t.identifier);
      if (p) moveBtnLook(p, t);
    }
    // 按钮手指滑出按钮范围仍算按住，直到抬起，冲刺时拇指稍微挪一下不会断
  }
}

function onRootEnd(e) {
  if (e.cancelable) e.preventDefault();
  const list = e.changedTouches;
  const ts = evTime(e);
  for (let i = 0; i < list.length; i++) {
    const id = list[i].identifier;
    if (T.waiting.delete(id)) continue;
    const who = T.owners.get(id);
    if (!who) continue;
    T.owners.delete(id);
    T.btnPos.delete(id);
    if (who === 'stick') { if (T.stick.id === id) { endStick(); promoteWaiting('stick'); } }
    else if (who === 'look') { if (T.look.id === id) { T.look.id = null; promoteWaiting('look'); } }
    else if (e.type === 'touchcancel' && ACT_LEVEL[who]) {
      // 系统抢走手指（来电、手势）：动作级算打断，不当成松手拾取
      const set = T.btnTouches[who];
      if (set && set.delete(id)) {
        const st = S.act[who];
        st.srcs.delete('t:' + id);
        if (st.srcs.size === 0) actCancel(who);
        if (set.size === 0 && T.btns[who]) T.btns[who].classList.remove('touch-on');
      }
    } else releaseButton(who, id, ts);
  }
}

// ---------- 全局手势防护（下拉刷新、捏合/双击缩放、长按菜单） ----------
function allowsNativeGesture(el) {
  if (el && el.nodeType === 3) el = el.parentNode;
  for (; el && el.nodeType === 1 && el !== document.body && el !== document.documentElement; el = el.parentNode) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const cs = window.getComputedStyle(el);
    if ((el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(cs.overflowY)) ||
        (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX))) return true;
  }
  return false;
}

function isClickable(el) {
  if (el && el.nodeType === 3) el = el.parentNode;
  for (; el && el.nodeType === 1 && el !== document.body; el = el.parentNode) {
    if (/^(BUTTON|A|LABEL|SUMMARY|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return true;
    if (el.getAttribute('role') === 'button' || typeof el.onclick === 'function') return true;
  }
  return false;
}

function onDocTouchStart(e) {
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    // 滚动面板和表单控件放行原生手势，其余地方一律不让页面被拖动
    T.scrollOk.set(t.identifier, !(T.root && T.root.contains(t.target)) && allowsNativeGesture(t.target));
  }
}

function onDocTouchMove(e) {
  if (e.defaultPrevented || !e.cancelable) return;
  // 双指一律拦：安卓捏合缩放
  if (e.touches.length > 1) { e.preventDefault(); return; }
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    // 微信/安卓浏览器的下拉刷新、iOS 橡皮筋回弹都起于这里的默认行为
    if (T.scrollOk.get(list[i].identifier) !== true) { e.preventDefault(); return; }
  }
}

function onDocTouchEnd(e) {
  const list = e.changedTouches;
  if (e.type === 'touchend' && !e.defaultPrevented && e.cancelable && list.length === 1 && e.touches.length === 0) {
    const t = list[0], tm = Date.now(), lt = T.lastTap;
    // iOS Safari 无视 user-scalable=no，双击仍会缩放；可点击的控件放行，免得连点按钮吞掉第二次 click
    if (tm - lt.t < 320 && Math.abs(t.clientX - lt.x) < 40 && Math.abs(t.clientY - lt.y) < 40 &&
        T.scrollOk.get(t.identifier) !== true && !isClickable(t.target)) e.preventDefault();
    lt.t = tm;
    lt.x = t.clientX;
    lt.y = t.clientY;
  }
  for (let i = 0; i < list.length; i++) T.scrollOk.delete(list[i].identifier);
}

function preventIfCancelable(e) { if (e.cancelable !== false) e.preventDefault(); }

function installGestureGuards() {
  const d = document;
  d.addEventListener('touchstart', onDocTouchStart, { passive: true, capture: true });
  // Chrome/Safari 把 document 上的 touch 监听默认当 passive，必须显式声明才能 preventDefault
  d.addEventListener('touchmove', onDocTouchMove, { passive: false });
  d.addEventListener('touchend', onDocTouchEnd, { passive: false });
  d.addEventListener('touchcancel', onDocTouchEnd, { passive: true });
  // iOS Safari 的捏合缩放走私有 gesture 事件
  d.addEventListener('gesturestart', preventIfCancelable, { passive: false });
  d.addEventListener('gesturechange', preventIfCancelable, { passive: false });
}

// ---------- 菜单按钮轻点（暂停、结算、测试面板共用） ----------
// 另一根手指还按在屏上时（摇杆手指、搭在遮罩上的手指）浏览器不合成 click，只绑 click 的按钮点不动。
// 这里按 touchend 自己判定：同一根手指位移 < TAP_SLOP、抬起时仍在元素范围内就触发，并 preventDefault 吞掉单指时的合成 click；
// 鼠标、键盘（Enter/空格）照旧走 click，距上次触屏触发不到 TAP_CLICK_DEDUP_MS 的 click 当成合成的忽略。
// 手指不是在本元素上按下的（结算保护期里按在还不接收点击的按钮位置、解锁后才抬起），抬起时浏览器补的 click 也忽略：
// 触屏激活一律走 touchend，click 只留给鼠标键盘。
// 不看 S.enabled：暂停、结算时输入是关着的，按钮照样要能点
function noteTouchEnd() {
  T.touchEnds++;
  T.touchEndAt = nowMs();
}

function tap(el, fn) {
  if (!el || typeof fn !== 'function') return;
  if (!T.endWatch) {
    T.endWatch = true;
    // 捕获阶段，先于元素自己的 touchend 监听计数
    document.addEventListener('touchend', noteTouchEnd, { capture: true, passive: true });
  }
  const downs = new Map();   // identifier → { x, y, sx, sy, fling }
  let firedAt = -1e9, scrolledAt = -1e9;
  let ownEnd = -1;           // 最近一次在本元素上按下的手指抬起时的 T.touchEnds
  // 可滚动的列表：按下是为了停住惯性滚动，或按住拖着滚了一段，都不算轻点，和原生 click 一致
  el.addEventListener('scroll', function () { scrolledAt = nowMs(); }, { passive: true });
  el.addEventListener('touchstart', function (e) {
    const list = e.changedTouches;
    const fling = nowMs() - scrolledAt < TAP_FLING_MS;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (el.contains(t.target)) downs.set(t.identifier, { x: t.clientX, y: t.clientY, sx: el.scrollLeft, sy: el.scrollTop, fling });
    }
  }, { passive: true });
  function end(e) {
    const list = e.changedTouches;
    let hit = false;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], d = downs.get(t.identifier);
      if (!d) continue;
      downs.delete(t.identifier);
      if (e.type === 'touchend') ownEnd = T.touchEnds;
      if (e.type !== 'touchend' || d.fling || el.scrollLeft !== d.sx || el.scrollTop !== d.sy) continue;
      const dx = t.clientX - d.x, dy = t.clientY - d.y;
      if (dx * dx + dy * dy >= TAP_SLOP * TAP_SLOP) continue;
      const r = el.getBoundingClientRect();
      if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) hit = true;
    }
    if (!hit) return;
    if (e.cancelable) e.preventDefault();
    firedAt = nowMs();
    fn(e);
  }
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: true });
  el.addEventListener('click', function (e) {
    const t = nowMs();
    if (t - firedAt < TAP_CLICK_DEDUP_MS) return;
    // 刚有手指抬起、但不是本元素上按下的那根：合成 click，不算。detail 为 0 的是键盘 Enter/空格或脚本 el.click()，照常
    if (e.detail !== 0 && t - T.touchEndAt < TAP_CLICK_DEDUP_MS && ownEnd !== T.touchEnds) return;
    fn(e);
  });
}

function whenDomReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

function activateTouch() {
  if (T.active) return;
  T.active = true;
  BR.input.isTouch = true;
  installGestureGuards();
  whenDomReady(function () {
    buildTouchUI();
    syncTouchVisibility();
  });
}

// 判定成桌面但用户真的摸了屏幕（识别漏掉的内核、触屏笔记本），补建触屏控件，否则手机上完全没法玩
function onFirstTouch() {
  window.removeEventListener('touchstart', onFirstTouch, true);
  activateTouch();
}

function onResize() {
  if (T.stick.id === null) layoutStickIdle();
}

// 横竖屏切换后，按住的手指还带着旧坐标系的锚点：视角（含冲刺键拖动）跳过下一次增量，摇杆以手指当前位置重定圆心。
// 只认宽高大小关系翻转：iOS 地址栏伸缩也会发 resize，那种不能重锚
function onViewportChange() {
  const land = window.innerWidth > window.innerHeight;
  if (land !== T.landscape) {
    T.landscape = land;
    if (T.look.id !== null) T.look.skip = true;
    if (T.stick.id !== null) T.stick.reanchor = true;
    T.btnPos.forEach(function (p) { p.skip = true; });
    T.waiting.forEach(function (w) { w.stale = true; });
  }
  onResize();
}

function onVisibility() {
  if (document.hidden) releaseAll();
}

// ---------- 初始化 ----------
function init(canvas) {
  if (S.inited) return;
  S.inited = true;
  S.canvas = canvas || document.getElementById('gl');

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);   // 捕获阶段：别人 stopPropagation 也要收到松键
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);
  T.landscape = window.innerWidth > window.innerHeight;
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', function () { setTimeout(onViewportChange, 300); });
  // iOS Safari 地址栏伸缩时 window 不一定发 resize，待机摇杆会被挤到工具栏下面
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

  if (S.touchDevice) activateTouch();
  else window.addEventListener('touchstart', onFirstTouch, { passive: true, capture: true });
}

function loadSensitivity() {
  try {
    const v = parseFloat(window.localStorage.getItem(SENS_KEY));
    if (v > 0) return clamp(v, SENS_MIN, SENS_MAX);
  } catch (err) { /* 隐私模式或沙箱 iframe 读不了存储，用默认值 */ }
  return 1;
}

S.touchDevice = detectTouch();
S.sens = loadSensitivity();

BR.input = {
  init,
  move,
  isTouch: S.touchDevice,

  get enabled() { return S.enabled; },
  set enabled(v) { setEnabled(v); },

  get sprint() { return sprinting(); },

  consumeLook() {
    const r = { dx: S.lookDx, dy: S.lookDy };
    S.lookDx = S.lookDy = 0;
    return r;
  },

  pressed(action) { return S.edges.has(action) && !actionOff(action); },

  // 不依赖 this，解构出来单独调也行
  held(action) {
    switch (action) {
      case 'sprint': return sprinting();
      case 'use': return S.enabled && !actionOff('use') && (S.mouseUse || keyHeld('use') || touchHeld('use'));
      case 'interact': case 'liftUp': case 'liftDown': return S.enabled && S.act[action].on;
      default: return false;
    }
  },

  // 以下只对动作级的 'interact' 'liftUp' 'liftDown' 有意义，其他动作恒为 false / 0，见文件头
  released(action) { return S.releases.has(action); },
  cancelled(action) { return S.cancels.has(action); },
  heldMs(action) {
    const st = S.act[action];
    return st && st.on && S.enabled ? Math.max(0, nowMs() - st.downAt) : 0;
  },
  lastHoldMs(action) {
    const st = S.act[action];
    return st ? st.lastHold : 0;
  },

  endFrame() {
    S.edges.clear();
    S.releases.clear();
    // 打断要撑到输入恢复后的第一帧：单机暂停、结算时 player 不跑，否则 BR.interact 永远看不到
    if (S.enabled) S.cancels.clear();
  },

  haptic,

  // 情境：'walk' | 'seat' | 'view' | 'drive'，只改已有动作怎么解释，不加键（drive 的 R / C 升降除外，见文件头）
  setContext,
  get context() { return S.ctx; },
  setButtons,
  buttonLabel,

  lock,

  // 菜单按钮轻点：另一根手指按着屏幕时也能触发，鼠标键盘照旧走 click
  tap,

  get locked() { return S.locked; },

  get sensitivity() { return S.sens; },
  set sensitivity(v) {
    v = parseFloat(v);
    if (!(v > 0)) return;
    S.sens = clamp(v, SENS_MIN, SENS_MAX);
    try { window.localStorage.setItem(SENS_KEY, String(S.sens)); } catch (err) { /* 存不了就只在本次生效 */ }
  },
};
})();
