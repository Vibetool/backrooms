// 后室 · 输入：键鼠（指针锁定）+ 触屏（动态摇杆、右半屏滑动转视角、动作按钮）
// 公开接口见 ARCHITECTURE.md 第 12 节 BR.input。补充约定：
//   move.x 向右为正、move.y 前进为正，模长 ≤ 1；始终是同一个对象，可以缓存引用
//   consumeLook() 返回屏幕方向的弧度增量：dx 向右为正、dy 向下为正；怎么映射到 yaw/pitch 由 player 决定
//   enabled 默认 false（开局在主页），进入游玩画面时由 main 置 true
//   enabled=false 时只保留三个边沿：Esc 'pause'（菜单能用 Esc 关）、V 'mic'（暂停时也能开关麦）、T 'testmenu'（测试面板打开时能用 T 关）
//   麦克风、测试面板的触屏按钮分别由 coop.js、testmode.js 自建，不归本文件
//   额外接口：locked（只读）、sensitivity（视角灵敏度倍率，记在 localStorage）
(function () {
'use strict';
const BR = window.BR;
const clamp = BR.util.clamp;

// ---------- 常量 ----------
const DESK_RAD_PER_PX = 0.0022;
const TOUCH_RAD_PER_PX = 0.005;
const SENS_MIN = 0.2, SENS_MAX = 3;
const SENS_KEY = 'br.input.sensitivity';
// Esc 退出指针锁定时，部分浏览器还会补发 Esc 的 keydown；两路在这个窗口内只算一次暂停
const PAUSE_DEBOUNCE_MS = 400;
// Chrome 指针锁定偶发 movementX 突跳几百像素（光标被拽回窗口中心），单次超过就丢弃
const MOVE_SPIKE_PX = 600;
// 连续失败这么多次就当环境锁不了（如 iframe 没给 allow-pointer-lock），改成拖拽转视角、轻点即使用
const LOCK_FAIL_LIMIT = 2;
const STICK_DEAD = 0.12;

const EDGE_ACTIONS = { interact: 1, use: 1, pause: 1, drop: 1, slot1: 1, slot2: 1, slot3: 1, slot4: 1, slot5: 1, mic: 1, testmenu: 1 };
// 输入禁用（暂停、面板打开）时也要记录的边沿：它们本身就是开关菜单外功能用的
const ALWAYS_EDGES = { mic: 1, testmenu: 1 };
const MOVE_ACTIONS = { fwd: 1, back: 1, left: 1, right: 1 };

// 用 e.code 按物理键位映射，不受输入法和键盘布局影响
const CODE_ACTION = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact', KeyF: 'use', KeyQ: 'drop', Escape: 'pause', KeyV: 'mic', KeyT: 'testmenu',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
  Numpad1: 'slot1', Numpad2: 'slot2', Numpad3: 'slot3', Numpad4: 'slot4', Numpad5: 'slot5',
};
// 老内核没有 e.code 时退回 e.key
const KEY_ACTION = {
  w: 'fwd', arrowup: 'fwd', up: 'fwd', s: 'back', arrowdown: 'back', down: 'back',
  a: 'left', arrowleft: 'left', left: 'left', d: 'right', arrowright: 'right', right: 'right',
  shift: 'sprint', e: 'interact', f: 'use', q: 'drop', escape: 'pause', esc: 'pause', v: 'mic', t: 'testmenu',
  1: 'slot1', 2: 'slot2', 3: 'slot3', 4: 'slot4', 5: 'slot5',
};

const TOUCH_BUTTONS = [['interact', '互动'], ['use', '使用'], ['sprint', '冲刺'], ['pause', '暂停']];

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
};
const T = {
  active: false,
  root: null, stickEl: null, knobEl: null, btns: {},
  owners: new Map(),      // touch.identifier → 'stick' | 'look' | 按钮动作
  btnTouches: {},         // 按钮动作 → 按着它的 identifier 集合（两根手指按同一个键也不会提前松开）
  stick: { id: null, ox: 0, oy: 0, r: 60, jx: 0, jy: 0 },
  look: { id: null, x: 0, y: 0 },
  scrollOk: new Map(),    // identifier → 这根手指落点是否允许浏览器原生滚动（可滚动面板、表单控件）
  lastTap: { t: 0, x: 0, y: 0 },
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
function sprinting() { return S.enabled && (keyHeld('sprint') || touchHeld('sprint')); }

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
  S.enabled = v;
  // 两个方向都清边沿：暂停瞬间残留的按键不该在菜单里生效，菜单里按的 Esc 也不该回到游戏后立刻再暂停一次
  S.edges.clear();
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
  const fresh = !S.keys.has(id) && !e.repeat;
  S.keys.add(id);
  if (fresh) {
    if (act === 'pause') firePause();
    else if ((S.enabled || ALWAYS_EDGES[act]) && EDGE_ACTIONS[act]) S.edges.add(act);
  }
  if (MOVE_ACTIONS[act]) updateMove();
  if (S.enabled && e.cancelable) e.preventDefault();   // 方向键别滚动页面
}

function onKeyUp(e) {
  // Mac 松开 ⌘ 之前按下的字母键不会发 keyup，干脆全部清掉
  if (e.key === 'Meta' || e.key === 'OS') { S.keys.clear(); updateMove(); return; }
  const id = keyId(e);
  if (S.keys.delete(id) && MOVE_ACTIONS[actionOf(id)]) updateMove();
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
  // 右下角弧形排布：拇指落点最近的是「使用」，互动在左、冲刺在上；右上角只有暂停，麦克风按钮由 coop.js 摆在它下方
  btnCss('use', 76, 22, 26, false, 'font-size:16px'),
  btnCss('interact', 62, 112, 30, false),
  btnCss('sprint', 62, 30, 116, false),
  btnCss('pause', 48, 12, 12, true, 'border-radius:14px;font-size:13px;letter-spacing:0'),
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
  layoutStickIdle();
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
  drawStick(ins.l + Math.max(r + 28, W * 0.13), H - ins.b - Math.max(r + 40, H * 0.24), 0, 0);
  T.stickEl.classList.remove('touch-on');
}

function startStick(t) {
  const st = T.stick;
  sizeStick(stickRadius());
  st.id = t.identifier;
  st.ox = t.clientX;
  st.oy = t.clientY;
  st.jx = st.jy = 0;
  T.stickEl.classList.add('touch-on');
  drawStick(st.ox, st.oy, 0, 0);
}

function moveStick(t) {
  const st = T.stick, r = st.r;
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

function pressButton(act, id) {
  const el = T.btns[act];
  if (!el) return false;
  const set = T.btnTouches[act] || (T.btnTouches[act] = new Set());
  const first = set.size === 0;
  set.add(id);
  if (first) {
    el.classList.add('touch-on');
    if (act === 'pause') firePause();
    else if (EDGE_ACTIONS[act]) S.edges.add(act);
  }
  return true;
}

function releaseButton(act, id) {
  const set = T.btnTouches[act];
  if (!set || !set.delete(id) || set.size > 0) return;
  if (T.btns[act]) T.btns[act].classList.remove('touch-on');
}

function clearButton(act) {
  const set = T.btnTouches[act];
  if (set) set.clear();
  if (T.btns[act]) T.btns[act].classList.remove('touch-on');
}

function resetTouch() {
  T.owners.clear();
  T.stick.id = null;
  T.stick.jx = T.stick.jy = 0;
  T.look.id = null;
  for (const act in T.btnTouches) clearButton(act);
  layoutStickIdle();
}

function ownerOf(el) {
  for (; el && el !== T.root; el = el.parentNode) {
    if (el.dataset && el.dataset.touch) return el.dataset.touch;
  }
  return null;
}

// 每根手指从落下起就归属一个控件，按 identifier 路由：摇杆、转视角、按钮互不抢
function onRootStart(e) {
  if (e.cancelable) e.preventDefault();   // 挡掉合成鼠标事件、双击缩放、长按菜单
  if (!S.enabled) return;
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (T.owners.has(t.identifier)) continue;
    const who = ownerOf(t.target);
    if (!who) continue;
    if (who === 'stick') {
      if (T.stick.id !== null) continue;
      startStick(t);
    } else if (who === 'look') {
      if (T.look.id !== null) continue;
      T.look.id = t.identifier;
      T.look.x = t.clientX;
      T.look.y = t.clientY;
    } else if (!pressButton(who, t.identifier)) {
      continue;
    }
    T.owners.set(t.identifier, who);
  }
}

function onRootMove(e) {
  if (e.cancelable) e.preventDefault();
  if (!S.enabled) return;
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const who = T.owners.get(t.identifier);
    if (who === 'stick') {
      moveStick(t);
    } else if (who === 'look') {
      addLook(t.clientX - T.look.x, t.clientY - T.look.y, TOUCH_RAD_PER_PX);
      T.look.x = t.clientX;
      T.look.y = t.clientY;
    }
    // 按钮手指滑出按钮范围仍算按住，直到抬起，冲刺时拇指稍微挪一下不会断
  }
}

function onRootEnd(e) {
  if (e.cancelable) e.preventDefault();
  const list = e.changedTouches;
  for (let i = 0; i < list.length; i++) {
    const id = list[i].identifier;
    const who = T.owners.get(id);
    if (!who) continue;
    T.owners.delete(id);
    if (who === 'stick') { if (T.stick.id === id) endStick(); }
    else if (who === 'look') { if (T.look.id === id) T.look.id = null; }
    else releaseButton(who, id);
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
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 300); });
  // iOS Safari 地址栏伸缩时 window 不一定发 resize，待机摇杆会被挤到工具栏下面
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

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

  pressed(action) { return S.edges.has(action); },

  // 不依赖 this，解构出来单独调也行
  held(action) {
    switch (action) {
      case 'sprint': return sprinting();
      case 'use': return S.enabled && (S.mouseUse || keyHeld('use') || touchHeld('use'));
      case 'interact': return S.enabled && (keyHeld('interact') || touchHeld('interact'));
      default: return false;
    }
  },

  endFrame() { S.edges.clear(); },

  lock,

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
