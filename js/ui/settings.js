// 后室 · 设置面板：实体上限、各分组音量、灵敏度、画质、默认能见度
// 经典 <script>，只往 window.BR 上挂东西。接口/数据格式见 WORKSHOP.md 第 9 节，class 前缀 set-，z-index 58
// DOM 全部在本文件里用 JS 在 #ui 下自建，不依赖 index.html；样式在 css/settings.css（本文件缺样式表时自己补挂）
(function () {
'use strict';
const BR = window.BR;
if (!BR) { console.error('[settings] 需要先加载 js/core/base.js'); return; }

const STORAGE_KEY = 'backrooms_settings_v1';

// 默认值：实体上限、四组音量、视角灵敏度都和其它模块自己的默认值对齐（base.js / input.js）
const DEFAULTS = {
  maxActiveEntities: 28,
  masterVolume: 1,
  ambientVolume: 1,
  sfxVolume: 1,
  voiceVolume: 1,
  sensitivity: 1,
  quality: 'high',
  visibility: 0.7,
};
const ENTITY_MIN = 8, ENTITY_MAX = 60;
const SENS_MIN = 0.2, SENS_MAX = 3;

// ---------- 小工具 ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
const has = (o, k) => !!o && typeof o[k] === 'function';

function mk(tag, cls, parent, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
function button(cls, parent, text) {
  const b = mk('button', cls, parent, text);
  b.type = 'button';
  return b;
}
function host() { return document.getElementById('ui') || document.body; }
function attached(el) { return !!el && document.documentElement.contains(el); }

// 按本脚本地址推算站点根目录，跟 home.js 一个写法：tests/ 下的自测页注入本脚本也能找对 css
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const SELF_RE = /js\/ui\/settings\.js(\?[^#]*)?(#.*)?$/;
const BASE = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, '') : '';

function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && /css\/settings\.css(\?.*)?$/.test(links[i].getAttribute('href') || '')) return;
  }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = BASE + 'css/settings.css';
  l.setAttribute('data-owner', 'settings');
  (document.head || document.documentElement).appendChild(l);
}

// ---------- 读写与校验：坏值/缺字段一律退回默认，不让一条脏数据拖垮整份设置 ----------
function sanitize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    maxActiveEntities: Math.round(clamp(num(s.maxActiveEntities, DEFAULTS.maxActiveEntities), ENTITY_MIN, ENTITY_MAX)),
    masterVolume: clamp(num(s.masterVolume, DEFAULTS.masterVolume), 0, 1),
    ambientVolume: clamp(num(s.ambientVolume, DEFAULTS.ambientVolume), 0, 1),
    sfxVolume: clamp(num(s.sfxVolume, DEFAULTS.sfxVolume), 0, 1),
    voiceVolume: clamp(num(s.voiceVolume, DEFAULTS.voiceVolume), 0, 1),
    sensitivity: clamp(num(s.sensitivity, DEFAULTS.sensitivity), SENS_MIN, SENS_MAX),
    quality: s.quality === 'low' ? 'low' : 'high',
    visibility: clamp(num(s.visibility, DEFAULTS.visibility), 0, 1),
  };
}
function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (err) { return sanitize(null); }   // 隐私模式/存储损坏时用默认值，不报错
}
function persist() {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* 存不了就只在本次生效 */ }
}

let state = load();

// ---------- 应用到各模块：unlock 前调用 BR.audio 的接口只会记状态，不报错 ----------
function safeCall(obj, name) {
  if (!has(obj, name)) return false;
  try { obj[name].apply(obj, Array.prototype.slice.call(arguments, 2)); return true; }
  catch (err) { console.error('[settings] 应用失败', name, err); return false; }
}
const APPLIERS = {
  maxActiveEntities() { if (BR.config && BR.config.world) BR.config.world.maxActiveEntities = state.maxActiveEntities; },
  masterVolume() { safeCall(BR.audio, 'setMaster', state.masterVolume); },
  ambientVolume() { safeCall(BR.audio, 'setAmbientVolume', state.ambientVolume); },
  sfxVolume() { safeCall(BR.audio, 'setSfxVolume', state.sfxVolume); },
  // BR.coop.setVoiceVolume 由工坊核心代理加，这里只做存在性判断，不缓存"是否存在"，避免它后来才挂上就再也调不到
  voiceVolume() { safeCall(BR.coop, 'setVoiceVolume', state.voiceVolume); },
  sensitivity() { if (BR.input) BR.input.sensitivity = state.sensitivity; },
  quality() {
    if (BR.game && BR.game.settings) BR.game.settings.quality = state.quality;
    safeCall(BR.gfx, 'setQuality', state.quality);   // 游戏没启动/gfx 还没 init 时是空操作，值已经记在 BR.game.settings 里了
    refreshQualityHint();
  },
  visibility() { if (BR.game && BR.game.settings) BR.game.settings.visibility = state.visibility; },
};
function applyOne(key) { const fn = APPLIERS[key]; if (fn) fn(); }
function applyAll() { Object.keys(APPLIERS).forEach(applyOne); }

// ---------- DOM ----------
let root = null, dom = null;
let prevInputEnabled = null;

function fmtPct(v) { return Math.round(v * 100) + '%'; }
function fmtSens(v) { return 'x' + v.toFixed(1); }

// 一行"标签 + 数值 + 滑条"，onInput(v) 里 v 已经换算成存储用的单位
function sliderField(parent, label, opts) {
  const f = mk('div', 'set-field', parent);
  const row = mk('div', 'set-field-row', f);
  mk('label', 'set-field-label', row, label);
  const val = mk('span', 'set-field-value', row);
  const inp = mk('input', 'set-range', f);
  inp.type = 'range';
  inp.min = String(opts.min);
  inp.max = String(opts.max);
  inp.step = String(opts.step);
  if (opts.note) mk('p', 'set-note', f, opts.note);
  const field = {
    input: inp,
    set(v) { inp.value = String(v / opts.unit); val.textContent = opts.fmt(v); },
  };
  inp.addEventListener('input', () => {
    const v = clamp(Number(inp.value) * opts.unit, opts.min * opts.unit, opts.max * opts.unit);
    val.textContent = opts.fmt(v);
    opts.onInput(v);
  });
  return field;
}

function buildDom() {
  ensureStylesheet();
  root = mk('div', 'set-root', null);
  root.hidden = true;

  const backdrop = mk('div', 'set-backdrop', root);
  backdrop.addEventListener('click', close);

  const panel = mk('div', 'set-panel', root);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '设置');

  const head = mk('div', 'set-head', panel);
  mk('div', 'set-title', head, '设置');
  const closeBtn = button('set-close', head, '×');
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.addEventListener('click', close);

  const body = mk('div', 'set-body', panel);

  dom = {};
  dom.maxEntities = sliderField(body, '实体上限', {
    min: ENTITY_MIN, max: ENTITY_MAX, step: 1, unit: 1,
    fmt: v => String(Math.round(v)),
    note: '调低后实际实体可能少于模式比例。',
    onInput(v) { state.maxActiveEntities = Math.round(v); applyOne('maxActiveEntities'); persist(); },
  });

  mk('div', 'set-sep', body);
  dom.masterVolume = sliderField(body, '总音量', {
    min: 0, max: 100, step: 1, unit: 0.01, fmt: v => fmtPct(v),
    onInput(v) { state.masterVolume = v; applyOne('masterVolume'); persist(); },
  });
  dom.ambientVolume = sliderField(body, '背景音乐（环境音）音量', {
    min: 0, max: 100, step: 1, unit: 0.01, fmt: v => fmtPct(v),
    onInput(v) { state.ambientVolume = v; applyOne('ambientVolume'); persist(); },
  });
  dom.sfxVolume = sliderField(body, '音效音量', {
    min: 0, max: 100, step: 1, unit: 0.01, fmt: v => fmtPct(v),
    onInput(v) { state.sfxVolume = v; applyOne('sfxVolume'); persist(); },
  });
  dom.voiceVolume = sliderField(body, '联机语音音量', {
    min: 0, max: 100, step: 1, unit: 0.01, fmt: v => fmtPct(v),
    onInput(v) { state.voiceVolume = v; applyOne('voiceVolume'); persist(); },
  });

  mk('div', 'set-sep', body);
  dom.sensitivity = sliderField(body, '视角灵敏度', {
    min: SENS_MIN * 10, max: SENS_MAX * 10, step: 1, unit: 0.1, fmt: v => fmtSens(v),
    onInput(v) { state.sensitivity = v; applyOne('sensitivity'); persist(); },
  });

  const qf = mk('div', 'set-field', body);
  const qrow = mk('div', 'set-field-row', qf);
  mk('label', 'set-field-label', qrow, '画质');
  const qseg = mk('div', 'set-seg', qf);
  const qBtns = { low: button('set-seg-btn', qseg, '低'), high: button('set-seg-btn', qseg, '高') };
  Object.keys(qBtns).forEach(k => {
    qBtns[k].addEventListener('click', () => {
      if (state.quality === k) return;
      state.quality = k;
      renderQualitySeg();
      applyOne('quality');
      persist();
    });
  });
  dom.qualityBtns = qBtns;
  dom.qualityHint = mk('p', 'set-note', qf, '抗锯齿开关需要刷新页面后生效。');
  dom.qualityHint.hidden = true;

  dom.visibility = sliderField(body, '默认能见度', {
    min: 0, max: 100, step: 1, unit: 0.01, fmt: v => fmtPct(v),
    onInput(v) { state.visibility = v; applyOne('visibility'); persist(); },
  });

  const actions = mk('div', 'set-actions', panel);
  const resetBtn = button('set-btn', actions, '恢复默认');
  resetBtn.addEventListener('click', resetDefaults);
}

function renderQualitySeg() {
  if (!dom) return;
  dom.qualityBtns.low.classList.toggle('is-active', state.quality === 'low');
  dom.qualityBtns.high.classList.toggle('is-active', state.quality === 'high');
}
function refreshQualityHint() {
  if (!dom) return;
  dom.qualityHint.hidden = !(BR.gfx && BR.gfx.qualityNeedsReload);
}

function renderAll() {
  dom.maxEntities.set(state.maxActiveEntities);
  dom.masterVolume.set(state.masterVolume);
  dom.ambientVolume.set(state.ambientVolume);
  dom.sfxVolume.set(state.sfxVolume);
  dom.voiceVolume.set(state.voiceVolume);
  dom.sensitivity.set(state.sensitivity);
  renderQualitySeg();
  refreshQualityHint();
  dom.visibility.set(state.visibility);
}

function resetDefaults() {
  state = Object.assign({}, DEFAULTS);
  applyAll();
  persist();
  renderAll();
}

function ensureDom() {
  if (!document.body) return false;
  if (!root) buildDom();
  if (!attached(root)) host().appendChild(root);
  return true;
}

function onKeydown(e) { if (e.key === 'Escape') close(); }

function open() {
  if (!ensureDom()) return;
  renderAll();
  root.hidden = false;
  prevInputEnabled = BR.input ? BR.input.enabled : null;
  if (BR.input) BR.input.enabled = false;
  document.addEventListener('keydown', onKeydown);
}
function close() {
  if (!root || root.hidden) return;
  root.hidden = true;
  if (BR.input && prevInputEnabled != null) BR.input.enabled = prevInputEnabled;
  document.removeEventListener('keydown', onKeydown);
}

// ---------- 启动即应用（不需要打开面板），改动都是实时生效 ----------
applyAll();

BR.settingsUI = {
  open, close,
  get isOpen() { return !!root && !root.hidden; },
};
})();
