// 后室 · 死亡结算：死因、存活时长、当前层级、到过的最深层级；「继续」原地重生 /「返回主页」
// 接口见 ARCHITECTURE.md 第 12 节 BR.death。DOM 由本文件在 #ui 里创建（class 前缀 death-），样式在 css/game.css
// 补充约定（与 hud.pause 对称）：
//   show() 把 BR.game.screen 从 playing/paused 切到 'dead'，并置 BR.input.enabled = false ——
//     input 关闭时会退出指针锁定；否则锁定状态下鼠标事件全落在画布上，结算按钮根本点不到
//   「继续」：收起 → screen 'dead' 回 'playing' 并打开输入 → emit 'death:continue'（respawnInPlace 由监听方调）
//     → 同步调 BR.input.lock()：桌面指针锁定只能在用户手势的调用栈里请求
//   「返回主页」：收起 → emit 'game:home'。不锁指针（主页要用鼠标点菜单），输入保持禁用
//   弹出后 ARM_MS 内按钮不响应：死的那一下玩家往往正在连点，免得误触直接重生或丢掉整局
//   game:start / game:home 时自动收起；player:respawn（别的路径复活）时收起并恢复 screen 和输入
//   额外只读：visible
(function () {
'use strict';
const BR = window.BR;

// ---------- 常量 ----------
const ARM_MS = 800;
const STYLE_RE = /(^|\/)css\/game\.css([?#]|$)/;
const SELF_RE = /js\/game\/death\.js([?#].*)?$/;
// currentScript 只在脚本同步执行期间有值，必须在顶层取
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';

// ---------- 状态 ----------
const dom = { ready: false };
const S = { visible: false, armAt: 0, armTimer: 0, pending: null, waiting: false };

// ---------- 小工具 ----------
function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function str(v) { return v == null ? '' : String(v); }

function mk(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
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
// 屏幕阅读器念 "00:12:34" 不直观，另给一句人话
function fmtWords(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ' 小时 ' : '') + (h || m ? m + ' 分 ' : '') + s + ' 秒';
}

// 与 hud.js 同样的写法，结算和左上角显示的层级名保持一致
function levelLabel(id) {
  if (!id) return '未知层级';
  const def = BR.levels.get(id);
  const name = (def && def.name) || ('Level ' + id);
  return def && def.title ? name + ' · ' + def.title : name;
}

// 调用方给的 deepest 可能比当前层还浅（刚换层还没来得及更新），按 LEVEL_ORDER 取更深的；
// 不在顺序表里的（dev 层等）无法比较，照调用方给的显示
function deeperOf(cur, deepest) {
  if (!deepest) return cur;
  const order = BR.LEVEL_ORDER || [];
  const ic = order.indexOf(cur), id = order.indexOf(deepest);
  if (ic < 0 || id < 0) return deepest;
  return ic > id ? cur : deepest;
}

// ---------- DOM ----------
function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && STYLE_RE.test(links[i].getAttribute('href') || '')) return;
  }
  // 和 hud.js 共用一份 css：谁先建 DOM 谁补 <link>，另一个检测到就不重复插
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, 'css/game.css') : 'css/game.css';
  l.setAttribute('data-owner', 'death');
  (document.head || document.documentElement).appendChild(l);
}

function host() { return document.getElementById('ui') || document.body; }

function buildStat(parent, label) {
  const row = mk('div', 'death-stat', parent);
  mk('dt', 'death-stat-label', row, label);
  return mk('dd', 'death-stat-val', row, '--');
}

function buildBtn(parent, cls, main, sub) {
  const b = mk('button', 'death-btn ' + cls, parent);
  b.type = 'button';
  mk('span', 'death-btn-main', b, main);
  if (sub) mk('span', 'death-btn-sub', b, sub);
  b.setAttribute('aria-label', sub ? main + '：' + sub : main);
  return b;
}

function build() {
  const root = dom.root = mk('div', 'death-root');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '死亡结算');

  // 左上角录像机 OSD，纯装饰
  const osd = mk('div', 'death-osd', root);
  osd.setAttribute('aria-hidden', 'true');
  mk('span', 'death-osd-stop', osd, '■ STOP');
  dom.osdTime = mk('span', 'death-osd-time', osd, '00:00:00');

  const panel = mk('div', 'death-panel', root);
  mk('div', 'death-tag', panel, 'SIGNAL LOST · 信号中断');
  mk('div', 'death-title', panel, '你死了');

  const cause = mk('div', 'death-cause', panel);
  mk('span', 'death-cause-label', cause, '死因');
  dom.cause = mk('span', 'death-cause-text', cause, '');

  const stats = mk('dl', 'death-stats', panel);
  dom.time = buildStat(stats, '存活时长');
  dom.level = buildStat(stats, '当前层级');
  dom.deepest = buildStat(stats, '到过的最深层级');

  const actions = mk('div', 'death-actions', panel);
  dom.btnContinue = buildBtn(actions, 'death-btn-continue', '继续', '原地重生，保留背包');
  dom.btnHome = buildBtn(actions, 'death-btn-home', '返回主页', '');
  dom.hint = mk('div', 'death-hint', panel, '按 Enter 继续');

  dom.btnContinue.addEventListener('click', onContinue);
  dom.btnHome.addEventListener('click', onHome);
}

function ensureDom() {
  if (!dom.ready) {
    if (!document.body) return false;
    ensureStylesheet();
    build();
    dom.ready = true;
  }
  return true;
}

// ---------- 显示 / 收起 ----------
function arm() {
  if (!S.visible || !dom.ready) return;
  dom.root.classList.add('death-armed');
  // 桌面把焦点给「继续」，回车即可重生（按键也算用户手势，能锁指针）；触屏不给，免得出焦点框
  if (!isTouch() && typeof dom.btnContinue.focus === 'function') {
    try { dom.btnContinue.focus({ preventScroll: true }); } catch (err) { dom.btnContinue.focus(); }
  }
}

function show(info) {
  const d = info || {};
  if (!ensureDom()) {
    // 脚本放在 <head> 里、body 还没有时先记下，DOM 就绪再弹
    S.pending = d;
    if (!S.waiting) {
      S.waiting = true;
      document.addEventListener('DOMContentLoaded', () => {
        S.waiting = false;
        const p = S.pending;
        S.pending = null;
        if (p) show(p);
      }, { once: true });
    }
    return;
  }
  S.pending = null;

  const g = BR.game;
  const levelId = str(d.levelId) || str(g.levelId);
  const deepest = deeperOf(levelId, str(d.deepest) || str(g.deepest));
  const sec = Math.max(0, Math.floor(num(d.time, num(g.time, 0))));

  dom.cause.textContent = str(d.cause) || '未知原因';
  dom.time.textContent = fmtClock(sec);
  dom.time.setAttribute('aria-label', fmtWords(sec));
  dom.osdTime.textContent = fmtClock(sec);
  dom.level.textContent = levelLabel(levelId);
  dom.deepest.textContent = levelLabel(deepest);
  dom.hint.hidden = isTouch();

  // 挪到 #ui 最后：和暂停菜单同为 z-index 60，后挂的盖在上面
  const h = host(), root = dom.root;
  if (root.parentNode !== h || h.lastChild !== root) h.appendChild(root);
  root.hidden = false;
  root.classList.remove('death-in', 'death-armed');
  void root.offsetWidth;   // 强制回流，连续两次 show 入场动画也能从头播
  root.classList.add('death-in');
  root.scrollTop = 0;
  S.visible = true;

  clearTimeout(S.armTimer);
  S.armAt = nowMs() + ARM_MS;
  S.armTimer = setTimeout(arm, ARM_MS);

  if (g.screen === 'playing' || g.screen === 'paused') g.screen = 'dead';
  if (BR.input) BR.input.enabled = false;
}

function hide() {
  clearTimeout(S.armTimer);
  S.pending = null;
  S.visible = false;
  if (!dom.ready) return;
  dom.root.hidden = true;
  dom.root.classList.remove('death-in', 'death-armed');
  const a = document.activeElement;
  if (a && dom.root.contains(a) && typeof a.blur === 'function') a.blur();
}

// 从结算回到游戏：收起，并把 show() 改过的 screen / 输入还原
function release() {
  hide();
  const g = BR.game;
  if (g.screen === 'dead') g.screen = 'playing';
  // 只在确实回到游玩画面时开输入：换层载入中等状态交给集成层
  if (BR.input && g.screen === 'playing') BR.input.enabled = true;
}

// ---------- 按钮 ----------
function onContinue() {
  if (!S.visible || nowMs() < S.armAt) return;
  release();
  BR.bus.emit('death:continue');
  // 必须留在这次点击的同步调用栈里；触屏设备 input.lock 自己会跳过。监听方若改回主页就不锁
  const inp = BR.input;
  if (inp && typeof inp.lock === 'function' && BR.game.screen !== 'home') inp.lock();
}

function onHome() {
  if (!S.visible || nowMs() < S.armAt) return;
  hide();
  BR.bus.emit('game:home');
}

// ---------- 事件 ----------
BR.bus.on('game:start', hide);
BR.bus.on('game:home', hide);
BR.bus.on('player:respawn', () => { if (S.visible) release(); });

// ---------- 导出 ----------
function init() {
  // 脚本放在 <head> 里时 body 还没有，等 DOM 就绪再建
  if (!ensureDom()) document.addEventListener('DOMContentLoaded', ensureDom, { once: true });
  return BR.death;
}

BR.death = {
  init, show, hide,
  get visible() { return S.visible; },
};
})();
