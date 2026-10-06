// 后室 · 帐篷选单（BR.tentMenu）：联机营地帐篷里的「选下一站」——三张模式卡、模式表单（BR.home.modeFields：滑条、难度卡、层级下拉）、
// 我的地图、队友状态和「准备」。只管 DOM；共享选择、规则、联机都在 js/game/coopcamp.js（BR.coopCamp），这里只把玩家的操作交给它。
// 经典 <script>，只往 window.BR 上挂东西；放在 home.js 之后。样式在 css/tent.css（z-index 54，在黑幕 56 下面）。
//
// 布局：竖屏是底部抽屉（max-height 62vh，一栏，内部滚动，上面露出帐篷里面和马灯）；横屏是右侧卡片（宽 min(560px, 62vw)，
//   左栏模式卡，右栏设置、层级、我的地图）。不管哪种，底部都钉一条栏：队友状态和「准备」，留出 safe-area。按钮都 ≥ 44 px。
//   选单里没有输入框，不弹键盘；自己不压历史记录（返回键由 main.js 先问 BR.coopCamp.onBack()）。
//   开着时 <html> 带 br-tent-open：准心和准心提示藏起来（选单盖着，「空格 看地图」没意义）。
// 接口：
//   open(handlers, view) / close() / render(view) / update(nowMs, {count, canCancel} | null) / flash() / isOpen / root
//   handlers：onMode(key)、onFields({spawnSlider?, difficulty?, startLevel?} 只含玩家改了的)、onMap(id | null)、onReady(bool)、
//     onCancel()、onExit(fromClick)
//   view（coopcamp.js 的 view()）：{ mode, diff, lv, ws, spawn, modes:[{key, name, desc, ok, why}], only:Set|null, maps:[{id, name, lv}],
//     myReady, peerReady, peerIn, peerHere, peerText, readyOk, readyWhy, count, canCancel, lvNote, remote }
//   view.remote 为真（对方改的）时，文字变了的按钮禁用 1 s，免得正要点的时候点成了别的意思
(function () {
'use strict';
const BR = window.BR;

const LOCK_MS = 1000;      // 按钮文字因为对方改动而变了：禁用这么久
const FLASH_MS = 700;

const S = { open: false, h: null, view: null, fields: null, fieldsSig: '', dragging: false, flashUntil: 0, lastCount: -1 };
const D = {};
const locks = new Map();   // 按钮 → 解禁时刻

function has(o, f) { return !!o && typeof o[f] === 'function'; }
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function mk(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function host() { return document.getElementById('ui') || document.body; }
// 菜单按钮：触屏另一根手指按着时也能点（input.tap）；点完把焦点拿走，免得之后按空格又点一次
function onTap(el, fn) {
  const run = e => {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (!(e && e.type === 'click' && e.detail === 0) && typeof el.blur === 'function') el.blur();
    fn(e);
  };
  if (BR.input && has(BR.input, 'tap')) BR.input.tap(el, run);
  else el.addEventListener('click', run);
}
function btn(cls, parent, text, fn) {
  const b = mk('button', 'tent-btn' + (cls ? ' ' + cls : ''), parent, text);
  b.type = 'button';
  if (fn) onTap(b, fn);
  return b;
}

// ---------- 骨架 ----------
function build() {
  if (D.root && document.documentElement.contains(D.root)) return true;
  if (!document.body) return false;
  const root = D.root = mk('div', 'tent-menu', host());
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '选下一站');
  const card = D.card = mk('div', 'tent-card', root);
  const head = mk('div', 'tent-head', card);
  mk('h2', 'tent-title', head, '选下一站');
  D.exit = btn('tent-exit', head, '出帐篷', e => { if (S.h && has(S.h, 'onExit')) S.h.onExit(!!e); });

  const body = D.body = mk('div', 'tent-body', card);
  const colA = mk('div', 'tent-col tent-col-a', body);
  mk('h3', 'tent-sub', colA, '模式');
  D.modes = mk('div', 'tent-modes', colA);
  D.modeBtns = [];
  // 竖屏手机上三张卡并排、卡里放不下说明：选中那张的说明整行写在卡片下面（文字同 BR.home.modeText；电脑上隐藏，卡里自己有；
  // 矮横屏上也隐藏，改由 css 只露出选中那张卡里的说明，见 tent.css）
  D.modeLine = mk('p', 'tent-mode-line', colA);
  const colB = mk('div', 'tent-col tent-col-b', body);
  D.fieldsBox = mk('div', 'tent-fields', colB);
  D.lvNote = mk('p', 'tent-note tent-note-lv', colB);
  D.lvNote.hidden = true;
  D.maps = mk('div', 'tent-maps', colB);
  mk('h3', 'tent-sub', D.maps, '我的地图');
  D.mapList = mk('div', 'tent-map-list', D.maps);
  D.maps.hidden = true;
  mk('p', 'tent-note tent-note-fresh', colB, '从帐篷出发是新开一局，背包是空的');

  const bar = mk('div', 'tent-bar', card);
  D.peer = mk('div', 'tent-peer', bar);
  const acts = mk('div', 'tent-acts', bar);
  D.why = mk('span', 'tent-why', acts);
  D.ready = btn('tent-ready', acts, '准备', () => {
    const v = S.view, h = S.h;
    if (!v || !h) return;
    if (v.count) { if (has(h, 'onCancel')) h.onCancel(); return; }
    if (has(h, 'onReady')) h.onReady(!v.myReady);
  });
  D.count = mk('div', 'tent-count', card);
  D.count.hidden = true;
  D.count.setAttribute('aria-live', 'assertive');

  // 拖滑条时，别让房主回来的值把滑块拽回去
  root.addEventListener('pointerdown', e => { if (e.target && e.target.type === 'range') S.dragging = true; });
  const up = () => { S.dragging = false; };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  // 滚动选单时不让手势落到底下的画面上
  root.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
  return true;
}

// ---------- 模式卡 ----------
function renderModes(v) {
  if (D.modeBtns.length !== v.modes.length || D.modeBtns.some((b, i) => b.dataset.key !== v.modes[i].key)) {
    D.modes.textContent = '';
    D.modeBtns = v.modes.map(m => {
      const b = btn('tent-mode tent-mode-' + m.key, D.modes, null, () => {
        const cur = S.view;
        if (!cur || !S.h) return;
        const mm = cur.modes.find(x => x.key === m.key);
        if (!mm || !mm.ok || cur.mode === m.key) return;
        if (has(S.h, 'onMode')) S.h.onMode(m.key);
      });
      b.dataset.key = m.key;
      mk('span', 'tent-mode-name', b, m.name);
      mk('span', 'tent-mode-desc', b, m.desc || '');
      mk('span', 'tent-mode-why', b, '');
      return b;
    });
  }
  v.modes.forEach((m, i) => {
    const b = D.modeBtns[i];
    const on = v.mode === m.key;
    b.classList.toggle('is-on', on);
    b.classList.toggle('is-off', !m.ok);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-disabled', m.ok ? 'false' : 'true');
    const why = b.querySelector('.tent-mode-why');
    why.textContent = m.ok ? '' : m.why;
    why.hidden = m.ok;
  });
  const sel = v.modes.find(m => m.key === v.mode);
  const line = sel ? sel.desc || '' : '';
  if (D.modeLine.textContent !== line) D.modeLine.textContent = line;
}

// ---------- 模式表单（BR.home.modeFields，两边文字一字不差） ----------
function onlySig(only) { return only ? Array.from(only).sort().join(',') : '*'; }
function renderFields(v) {
  const H = BR.home;
  if (!H || !has(H, 'modeFields')) {
    if (!D.fieldsMissing) { D.fieldsBox.textContent = ''; D.fieldsMissing = mk('p', 'tent-note', D.fieldsBox, '页面没更新完整，请刷新'); }
    return;
  }
  const sig = v.mode + '|' + onlySig(v.only);
  const value = { spawnSlider: v.spawn, difficulty: v.diff, startLevel: v.lv };
  if (!S.fields || sig !== S.fieldsSig) {
    if (S.fields) { try { S.fields.destroy(); } catch (err) { /* 已经没了 */ } }
    D.fieldsBox.textContent = '';
    S.fieldsSig = sig;
    S.fields = H.modeFields(D.fieldsBox, v.mode, value, onFieldsChange, { level: { only: v.only, dev: true } });
  } else {
    const patch = { difficulty: v.diff, startLevel: v.lv };
    if (!S.dragging) patch.spawnSlider = v.spawn;
    S.fields.set(patch);
  }
  // 选了「我的地图」：层级下拉灰掉，写「地图自带层级」；L15、L16 旁边写没有回去的路
  const sel = S.fields.levelSelect, field = S.fields.levelField;
  if (sel) sel.disabled = !!v.ws;
  if (field) {
    let n = field.querySelector('.tent-lv-why');
    const t = v.ws ? '地图自带层级' : (v.lvNote || '');
    if (t && !n) n = mk('p', 'tent-note tent-lv-why', field);
    if (n) { n.textContent = t; n.hidden = !t; }
    D.lvNote.hidden = true;
  } else {
    D.lvNote.textContent = v.lvNote || '';
    D.lvNote.hidden = !v.lvNote;
  }
}
// 玩家动了表单：只把真的变了的字段交出去（模式不在这里，模式卡自己交）
function onFieldsChange(g) {
  const v = S.view;
  if (!v || !S.h || !g) return;
  const out = {};
  if (v.mode === 'casual' && g.spawnSlider != null && Math.abs(+g.spawnSlider - v.spawn) > 0.004) out.spawnSlider = +g.spawnSlider;
  if (v.mode === 'nightmare' && g.difficulty !== undefined && g.difficulty !== v.diff) out.difficulty = g.difficulty;
  if (g.startLevel != null && String(g.startLevel) !== String(v.lv) && !v.ws) out.startLevel = String(g.startLevel);
  if (Object.keys(out).length && has(S.h, 'onFields')) S.h.onFields(out);
}

// ---------- 我的地图 ----------
function renderMaps(v) {
  const maps = v.maps || [];
  D.maps.hidden = !maps.length;
  if (!maps.length) { D.mapList.textContent = ''; D.mapSig = ''; return; }
  const sig = maps.map(m => m.id + ':' + m.name + ':' + m.lv).join('|');
  if (sig !== D.mapSig) {
    D.mapSig = sig;
    D.mapList.textContent = '';
    const none = btn('tent-map tent-map-none', D.mapList, '不用地图', () => { if (S.view && S.view.ws && S.h) S.h.onMap(null); });
    none.dataset.id = '';
    for (const m of maps) {
      const b = btn('tent-map', D.mapList, null, () => { if (S.view && S.view.ws !== m.id && S.h) S.h.onMap(m.id); });
      b.dataset.id = m.id;
      mk('span', 'tent-map-name', b, m.name);
      const def = BR.levels && BR.levels.get(m.lv);
      const bad = v.only && !v.only.has(String(m.lv));
      mk('span', 'tent-map-lv', b, (def ? def.name : 'Level ' + m.lv) + (bad ? '（队友没有这一层）' : ''));
    }
  }
  for (const b of D.mapList.children) {
    const on = (b.dataset.id || null) === (v.ws || null);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ---------- 底栏 ----------
function setBtn(b, text, enabled, remote) {
  const t = String(text);
  const changed = b.textContent !== t;
  if (changed) b.textContent = t;
  if (changed && remote && b.dataset.seen) locks.set(b, nowMs() + LOCK_MS);
  b.dataset.seen = '1';
  b.dataset.want = enabled ? '1' : '0';
  applyLock(b, nowMs());
}
function applyLock(b, now) {
  const until = locks.get(b) || 0;
  const locked = now < until;
  if (!locked && until) locks.delete(b);
  b.disabled = locked || b.dataset.want !== '1';
  b.classList.toggle('is-locked', locked);
}
function renderBar(v) {
  D.peer.textContent = v.peerText || '';
  D.peer.classList.toggle('is-ready', !!(v.peerHere && v.peerReady));
  D.peer.classList.toggle('is-gone', !v.peerHere);
  let text, ok, why = '';
  if (v.count) { text = '取消'; ok = !!v.canCancel; }
  else if (v.myReady) { text = '取消准备'; ok = true; }
  else { text = '准备'; ok = !!v.readyOk; why = v.readyOk ? '' : (v.readyWhy || ''); }
  setBtn(D.ready, text, ok, v.remote);
  D.ready.classList.toggle('is-on', !!v.myReady && !v.count);
  D.ready.classList.toggle('is-cancel', !!v.count);
  D.why.textContent = why;
  D.why.hidden = !why;
  setBtn(D.exit, '出帐篷', !(v.count && !v.canCancel), false);
  renderCount(v.count);
}
function renderCount(n) {
  n = n > 0 ? n : 0;
  if (n === S.lastCount) return;
  S.lastCount = n;
  D.count.hidden = !n;
  D.count.textContent = n ? String(n) : '';
  if (n) {
    // 每一拍重播一次放大动画
    D.count.classList.remove('is-beat');
    void D.count.offsetWidth;
    D.count.classList.add('is-beat');
  }
}

// ---------- 对外 ----------
function render(v) {
  if (!v || !build()) return;
  S.view = v;
  renderModes(v);
  renderFields(v);
  renderMaps(v);
  renderBar(v);
}
function open(handlers, v) {
  if (!build()) return false;
  S.h = handlers || null;
  S.open = true;
  S.lastCount = -1;
  D.root.hidden = false;
  document.documentElement.classList.add('br-tent-open');
  if (v) render(v);
  if (D.body) D.body.scrollTop = 0;
  return true;
}
function close() {
  if (!S.open && (!D.root || D.root.hidden)) return;
  S.open = false;
  S.h = null;
  S.dragging = false;
  const a = document.activeElement;
  if (a && D.root && D.root.contains(a) && typeof a.blur === 'function') a.blur();
  if (S.fields) { try { S.fields.destroy(); } catch (err) { /* 已经没了 */ } }
  S.fields = null; S.fieldsSig = '';
  if (D.fieldsBox) D.fieldsBox.textContent = '';
  if (D.root) D.root.hidden = true;
  if (D.card) D.card.classList.remove('is-flash');
  locks.clear();
  document.documentElement.classList.remove('br-tent-open');
}
// 每帧（coopcamp.update 调）：倒数数字、取消按钮能不能点、按钮的 1 s 禁用到期、闪一下到期
function update(now, cd) {
  if (!S.open || !D.root) return;
  now = typeof now === 'number' ? now : nowMs();
  if (S.view) {
    const n = cd && cd.count > 0 ? cd.count : 0;
    if (n !== S.lastCount || (cd && !!cd.canCancel !== !!S.view.canCancel)) {
      S.view.count = n;
      S.view.canCancel = !!(cd && cd.canCancel);
      S.view.remote = false;
      renderBar(S.view);
    }
  }
  locks.forEach((u, b) => applyLock(b, now));
  if (S.flashUntil && now >= S.flashUntil) { S.flashUntil = 0; D.card.classList.remove('is-flash'); }
}
function flash() {
  if (!S.open || !D.card) return;
  D.card.classList.remove('is-flash');
  void D.card.offsetWidth;
  D.card.classList.add('is-flash');
  S.flashUntil = nowMs() + FLASH_MS;
}

BR.tentMenu = {
  open, close, render, update, flash,
  get isOpen() { return S.open; },
  get root() { return D.root || null; },
};
// 回主页：选单一定收起（coopcamp 也会关，这里兜底）
if (BR.bus) BR.bus.on('game:home', close);
})();
