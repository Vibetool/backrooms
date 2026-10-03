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
//   自动订阅 level:enter 播层级大标题（同一层短时间内只播一次，集成层再手动调也不会重复）
//   暂停、死亡时 toast 整组藏起来（.hud-toasts-modal），不清掉；联机暂停时面板右上角有开关麦（.hud-pause-mic）
//   额外只读：visible、paused
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
  '启动发电机', '关闭发电机', '坐下', '躺下', '起身', '起来', '上车', '下车', '按喇叭',
  '喝水', '接水喝', '喝杏仁水', '开灯', '关灯', '换台', '戳破', '喷灭火器', '看看', '放录像带', '玩街机',
  '往外拉', '放下', '滑下去', '荡秋千', '扶起来', '推车',
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
const HIT_MS = 350;
const PAUSE_ARM_MS = 250;        // 按暂停的那一下不能顺带点中菜单按钮
const HOME_CONFIRM_MS = 2500;    // 「返回主页」点两次才生效：手机上拖能见度滑条时误触会丢掉整局
const VIS_THUMB_PX = 20;         // 与 css/game.css 里 .hud-range::-webkit-slider-thumb 的宽度一致
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
  warnedTarget: false,
  layoutDirty: true,               // 提示框内容 / 显隐 / 窗口尺寸变了：下一帧量一次提示框底边，toast 排在它下面
  toastDy: -1,                     // 已写进 --hud-toast-dy 的值（px）
};

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
  const m = BR.MODES[g.mode];
  let s = m ? m.zh : String(g.mode || '');
  if (m && Array.isArray(m.difficulties)) {
    const d = m.difficulties.find(x => x.key === g.difficulty);
    if (d) s += ' · ' + d.zh;
  }
  if (!g.attackPlayers) s += ' · 实体不会攻击你';
  return s;
}

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
    dom.ready = true;
    // 窗口尺寸、横竖屏变了：提示框折行跟着变，toast 的位置重量一次
    window.addEventListener('resize', () => { S.layoutDirty = true; }, { passive: true });
  }
  // 别的模块清空 #ui 时会把节点一起带走，补挂回去
  const h = host();
  if (!attached(dom.root)) h.appendChild(dom.root);
  if (!attached(dom.toasts)) h.appendChild(dom.toasts);
  if (!attached(dom.pause)) h.appendChild(dom.pause);
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

  const info = mk('div', 'hud-info', root);
  dom.infoLevel = mk('div', 'hud-info-level', info);
  dom.infoMode = mk('div', 'hud-info-mode', info);
  const rec = mk('div', 'hud-info-rec', info);
  mk('span', 'hud-rec-dot', rec);
  mk('span', 'hud-rec-label', rec, 'REC');
  dom.recTime = mk('span', 'hud-rec-time', rec, '00:00:00');
  dom.recCoop = mk('span', 'hud-rec-coop', rec);
  dom.recCoop.hidden = true;

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

  const inv = mk('div', 'hud-inv', root);
  dom.invName = mk('div', 'hud-inv-name', inv);
  dom.invName.hidden = true;
  const row = mk('div', 'hud-inv-row', inv);
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
  dom.pauseHint = mk('div', 'hud-pause-hint', panel, '按 Esc 也可以继续');

  tap(dom.btnResume, onResumeClick);
  tap(dom.btnHome, onHomeClick);
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
  const on = !!(g.statsEnabled && p);
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
  // 层级文件可能晚于首帧注册，has() 也放进签名，注册后标题自动补上
  const sig = [g.levelId, BR.levels.has(g.levelId), g.mode, g.difficulty, g.attackPlayers, coop, role].join('|');
  if (sig !== S.infoSig) {
    S.infoSig = sig;
    dom.infoLevel.textContent = levelLabel(g.levelId);
    dom.infoMode.textContent = modeLabel(g);
    dom.recCoop.textContent = coop ? (role === 'guest' ? '联机 · 客机' : '联机 · 房主') : '';
    dom.recCoop.hidden = !coop;
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
  if (!dom.prompt.hidden) {
    const r = dom.prompt.getBoundingClientRect();
    const mid = (window.innerHeight || document.documentElement.clientHeight || 0) / 2;
    if (r.height > 0) dy = Math.max(TOAST_DY_MIN, Math.ceil(r.bottom - mid + 6));
  }
  if (dy !== S.toastDy) { S.toastDy = dy; dom.toasts.style.setProperty('--hud-toast-dy', dy + 'px'); }
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
  const nameSig = cur && cur.type ? cur.type + '|' + S.touch + '|' + coop : '';
  if (nameSig !== S.nameSig) {
    S.nameSig = nameSig;
    dom.invName.hidden = !nameSig;
    if (nameSig) {
      const name = itemName(cur.type);
      // 联机时 player.js 不允许丢弃，就不提示 Q
      dom.invName.textContent = S.touch ? name + ' · 点「使用」' : name + ' · F 使用' + (coop ? '' : ' · Q 丢弃');
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
  if (S.paused) renderPauseMic();

  updateStats(g, p);
  updateInfo(g);
  updatePrompt(dt, p, dead);
  updateInventory(p);
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
}

function clearToasts() {
  while (S.toasts.length) removeToast(S.toasts[0]);
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
  const t = { text, node: mk('div', 'hud-toast', dom.toasts, text), timer: 0, leaving: false };
  S.toasts.push(t);
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
}

function levelTitle(level) {
  if (!ensureDom()) return;
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
  void n.offsetWidth;   // 强制回流，同一个动画才能从头再播
  n.classList.add('hud-title-play');
  clearTimeout(S.titleTimer);
  // 减弱动效时没有 animationend，只能按时收起；正常情况只留一个很长的兜底，
  // 否则 HUD 晚于 level:enter 才显示时，动画会在淡出途中被掐掉
  S.titleTimer = setTimeout(hideTitle, reducedMotion() ? TITLE_REDUCED_MS : TITLE_SAFETY_MS);
}

// ---------- 暂停菜单 ----------
function setHomeConfirm(on) {
  clearTimeout(S.homeTimer);
  S.homeConfirmUntil = on ? nowMs() + HOME_CONFIRM_MS : 0;
  if (!dom.ready) return;
  toggle(dom.btnHome, 'hud-btn-confirm', on);
  dom.btnHome.textContent = on ? '再点一次，确认返回主页' : '返回主页';
  if (on) S.homeTimer = setTimeout(() => setHomeConfirm(false), HOME_CONFIRM_MS);
}

function renderPause() {
  const g = BR.game;
  dom.pauseLevel.textContent = levelLabel(g.levelId);
  dom.pauseMode.textContent = modeLabel(g);
  const vis = Math.round(U.clamp(num(g.settings && g.settings.visibility, 0.7), 0, 1) * 100);
  dom.visRange.value = String(vis);
  dom.visVal.textContent = vis + '%';
  dom.pauseHint.hidden = isTouch();
  setHomeConfirm(false);
  renderPauseMic();
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
  if (nowMs() > S.homeConfirmUntil) { setHomeConfirm(true); return; }
  closePause();
  BR.bus.emit('game:home');
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

// ---------- 事件 ----------
BR.bus.on('level:enter', (p) => {
  S.infoSig = null;
  if (p && p.id != null) levelTitle(p.id);
});

BR.bus.on('game:start', () => {
  S.titleId = null;
  S.manualPrompt = null;
  S.target = null;
  clearToasts();
  if (S.paused) closePause();
});

BR.bus.on('game:home', () => {
  // 只收起菜单，不动输入：回主页时输入该保持禁用，由集成层决定
  if (S.paused) closePause();
  S.manualPrompt = null;
  S.target = null;
  S.titleId = null;
  clearToasts();
  S.toastModal = false;
  if (dom.ready) toggle(dom.toasts, 'hud-toasts-modal', false);
  hideTitle();
  show(false);
});

// 麦克风状态变了（coop.js 发）：暂停菜单开着就立即刷新；没有这个事件时靠 update 里的签名兜底
BR.bus.on('coop:mic', () => { if (S.paused) renderPauseMic(); });

BR.bus.on('player:death', () => {
  // 联机时暂停并不停世界，可能在菜单里被打死：让位给结算界面，输入保持禁用
  if (S.paused) closePause();
  S.target = null;
});

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
  get visible() { return S.visible; },
  get paused() { return S.paused; },
};
})();
