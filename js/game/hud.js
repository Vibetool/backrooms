// 后室 · HUD：顶部状态条、左上角层级信息、准星、互动提示、背包栏、toast、层级大标题、暂停菜单
// 接口见 ARCHITECTURE.md 第 12 节 BR.hud。DOM 全部由本文件在 #ui 里创建（class 前缀 hud-），样式在 css/game.css
// 补充约定：
//   pause(true/false) 同时切 BR.game.screen（只在 'playing' ↔ 'paused' 之间）和 BR.input.enabled，
//     并 emit 'game:pause' { paused }。菜单里点「继续」时顺手请求指针锁定（只有点击手势里才锁得上）
//   prompt(text) 是手动提示，优先于自动的拾取提示；传 null 交还给自动提示
//   自动订阅 level:enter 播层级大标题（同一层短时间内只播一次，集成层再手动调也不会重复）
//   额外只读：visible、paused
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 常量 ----------
const SLOTS = 5;
const PROMPT_SAMPLE_SEC = 0.1;   // interactTarget 每次都做视线检测，10Hz 足够跟手
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
  target: null,
  manualPrompt: null,
  promptSig: null,
  crossOn: null,
  slotSig: new Array(SLOTS).fill(null),
  sel: -1,
  nameSig: null,
  badIcons: new Set(),
  toasts: [],
  titleId: null, titleAt: 0, titleTimer: 0,
  pauseArmAt: 0, homeConfirmUntil: 0, homeTimer: 0,
  warnedTarget: false,
};

// ---------- 小工具 ----------
function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function toggle(node, cls, on) { if (on) node.classList.add(cls); else node.classList.remove(cls); }
function attached(node) { return node.isConnected !== undefined ? node.isConnected : document.documentElement.contains(node); }

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
  dom.prompt = mk('div', 'hud-prompt', root);
  dom.prompt.hidden = true;
  dom.promptKey = mk('span', 'hud-key', dom.prompt);
  dom.promptText = mk('span', 'hud-prompt-text', dom.prompt);

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

  dom.btnResume.addEventListener('click', onResumeClick);
  dom.btnHome.addEventListener('click', onHomeClick);
  range.addEventListener('input', onVisInput);
  range.addEventListener('change', onVisInput);
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
function updatePrompt(dt, p, dead) {
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
  let key = '', text = '';
  if (!dead && S.manualPrompt) {
    text = S.manualPrompt;
  } else if (t) {
    const cnt = t.count > 1 ? ' ×' + t.count : '';
    if (S.touch) text = '点「互动」拾取 ' + itemName(t.type) + cnt;
    else { key = 'E'; text = '拾取 ' + itemName(t.type) + cnt; }
    if (has(p, 'canAdd') && !p.canAdd(t.type)) text += '（背包已满）';
  }
  const sig = key + '\n' + text;
  if (sig !== S.promptSig) {
    S.promptSig = sig;
    dom.prompt.hidden = !text;
    dom.promptKey.hidden = !key;
    dom.promptKey.textContent = key;
    dom.promptText.textContent = text;
  }
  const crossOn = !!t;
  if (crossOn !== S.crossOn) {
    S.crossOn = crossOn;
    toggle(dom.cross, 'hud-cross-on', crossOn);
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
    // 同一句话连着来（对着满背包反复按 E）只续时间、闪一下边框，不刷屏
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
  hideTitle();
  show(false);
});

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
