// 后室 · 创意工坊界面：地图列表、编辑器（俯视 3D + 第一人称预览）、保存信息卡、模式选择
// 经典 <script>，只往 window.BR 上挂东西。数据格式/钩子/验收标准见 WORKSHOP.md 第 2、7、8 节。
// class 前缀 ws-，z-index 58（同设置面板）。DOM 全部在本文件里用 JS 在 #ui 下自建，样式表自己挂（同 settings.js 写法）。
//
// 俯视视图的关键技巧（为什么不用假二维平面图）：
// 相机严格朝正下方看时，地面（y=0）上任意一点在屏幕上的投影是"仿射"的——没有透视畸变
// （因为透视除法用的是沿视线方向的深度，而地面所有点到相机的这个深度分量都恒等于相机高度）。
// 于是我们可以用 THREE 相机自带的 project()，在相机摆好之后取两三个已知点校准一次，
// 缓存出"世界坐标 → 屏幕像素"的线性映射，后面所有叠加标记（实体点、出口图标、编辑范围遮罩）
// 和"屏幕点击 → 世界坐标"（墙编辑用 edgeAt 找最近的格子边）都用这份缓存做纯 2D 数学，
// 完全不需要对合并过的区块网格做射线检测——那种批量几何本来也拿不到单面墙的可选中对象。
(function () {
'use strict';
const BR = window.BR;
if (!BR) { console.error('[workshop-ui] 需要先加载 js/core/base.js'); return; }
if (!BR.workshop) { console.error('[workshop-ui] 需要先加载 js/game/workshop.js'); return; }
const THREE = window.THREE;
const U = BR.util;

// ---------- 小工具（各 UI 模块各自定义一份，参考 js/ui/settings.js 的写法） ----------
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(o, k) { return !!o && typeof o[k] === 'function'; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
function svgEl(tag, cls, parent) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (cls) el.setAttribute('class', cls);
  if (parent) parent.appendChild(el);
  return el;
}
function host() { return document.getElementById('ui') || document.body; }
function attached(el) { return !!el && document.documentElement.contains(el); }
function viewW() { return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1); }
function viewH() { return Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1); }

// 按本脚本地址推算站点根目录（tests/ 下注入本脚本自测时也能找对 css），同 home.js/settings.js 的写法
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const SELF_RE = /js\/ui\/workshop\.js(\?[^#]*)?(#.*)?$/;
const BASE = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, '') : '';
function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && /css\/workshop\.css(\?.*)?$/.test(links[i].getAttribute('href') || '')) return;
  }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = BASE + 'css/workshop.css';
  l.setAttribute('data-owner', 'workshop');
  (document.head || document.documentElement).appendChild(l);
}

// ---------- 常量 ----------
const FOV_TOP = 50;                 // 俯视用小一点的视场角，边缘畸变小
const FOV_FP = 75;                  // 第一人称预览跟正常游玩相机一致（js/core/gfx.js 里的初始值）
const SECTION_MIN = 0.4, SECTION_MAX = 2.75, SECTION_DEFAULT = 2.65; // 剖切高度：层高常量 DEFAULT_HEIGHT=2.8（_kit.js）再留 0.05 余量
const ALT_MIN = 4, ALT_MAX = 420;
const HISTORY_LIMIT = 60;
const RELOAD_DEBOUNCE = 160;        // 改墙/出口后的场景重建去抖（毫秒）
const CLICK_SLOP = 6;               // 像素：小于这个位移的拖拽算点击

const EXIT_KIND_ZH = { door: '门', stairs: '楼梯', elevator: '电梯', zone: '区域' };
const FACTION_COLOR = { hostile: '#ff6e5a', friendly: '#7fe7a0', neutral: '#ffd76a', dummy: '#9aa0a6' };
function factionColor(f) { return FACTION_COLOR[f] || '#79c7ff'; }

// ---------- 模块状态 ----------
const S = {
  root: null,
  view: 'list',              // 'list' | 'new' | 'editor' | 'info'
  els: {},                   // 各视图根节点
  map: null,                 // 当前编辑/信息卡指向的地图对象（编辑器直接改这个引用）
  savedSnapshot: null,       // JSON 字符串：进入编辑器/保存成功后的快照，判断"有没有未保存改动"
  isNewMap: false,           // 当前 map 是不是还没 save 过
  lastSaveStats: null,       // 保存成功后给信息卡看的改动统计
  tool: 'select',
  selectedEntityType: null,
  toolHint: '',
  cam: { cx: 0, cz: 0, altitude: 60, section: SECTION_DEFAULT },
  proj: null,                // { ox, oy, sx, sy }：世界→屏幕仿射映射缓存
  boundary: null,            // { minX, maxX, minZ, maxZ }
  chunkSize: 24,
  saved3D: null,             // 进入编辑器前的相机/雾状态，退出时还原
  editorSceneOpen: false,
  reloadTimer: 0,
  undoStack: [], redoStack: [],
  drag: null,                // 舞台拖拽（平移/自由墙/标记拖动）状态
  pinch: null,               // 双指缩放
  activePointers: null,      // Map：pointerId -> {x,y}，用于双指缩放
  exitAddArm: false,         // 出口工具的"添加"子模式：下一次空白点击弹出新增出口对话框
  selectedEntityId: null,
  fp: null,                  // 第一人称预览状态
  toastTimer: 0,
};

// =====================================================================
// DOM 骨架
// =====================================================================
function ensureDom() {
  if (!document.body) return false;
  if (!S.root) buildDom();
  if (!attached(S.root)) host().appendChild(S.root);
  return true;
}

function buildDom() {
  ensureStylesheet();
  S.root = mk('div', 'ws-root', null);
  S.root.hidden = true;

  buildListView();
  buildNewDialog();
  buildEditor();
  buildInfoCard();
  buildConfirmDialog();
  buildToast();
}

function switchView(name) {
  S.view = name;
  S.els.list.hidden = name !== 'list';
  S.els.newdlg.hidden = name !== 'new';
  S.els.editor.hidden = name !== 'editor';
  S.els.info.hidden = name !== 'info';
}

// ---------- Toast ----------
function buildToast() {
  const t = mk('div', 'ws-toast', S.root);
  t.hidden = true;
  S.els.toast = t;
}
function toast(msg, ms) {
  const t = S.els.toast;
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
}

// ---------- 二次确认对话框（复用给删除地图 / 未保存改动退出 / 出生点被围死） ----------
function buildConfirmDialog() {
  const modal = mk('div', 'ws-modal', S.root);
  modal.hidden = true;
  const backdrop = mk('div', 'ws-backdrop', modal);
  const panel = mk('div', 'ws-panel ws-panel-narrow', modal);
  panel.setAttribute('role', 'alertdialog');
  const head = mk('div', 'ws-head', panel);
  const title = mk('div', 'ws-title', head);
  const body = mk('div', 'ws-body', panel);
  const bodyText = mk('p', 'ws-note', body);
  const actions = mk('div', 'ws-actions-row', panel);
  const cancelBtn = button('ws-btn', actions, '取消');
  const okBtn = button('ws-btn ws-btn-primary', actions, '确定');
  backdrop.addEventListener('click', () => resolveConfirm(false));
  cancelBtn.addEventListener('click', () => resolveConfirm(false));
  okBtn.addEventListener('click', () => resolveConfirm(true));
  S.els.confirm = { modal, title, bodyText, okBtn, cancelBtn };
}
let confirmResolver = null;
function resolveConfirm(v) {
  S.els.confirm.modal.hidden = true;
  const r = confirmResolver; confirmResolver = null;
  if (r) r(v);
}
function confirmDialog(opts) {
  const c = S.els.confirm;
  c.title.textContent = opts.title || '确认';
  c.bodyText.textContent = opts.body || '';
  c.okBtn.textContent = opts.okText || '确定';
  c.okBtn.className = opts.danger ? 'ws-btn ws-btn-danger' : 'ws-btn ws-btn-primary';
  c.modal.hidden = false;
  return new Promise(resolve => { confirmResolver = resolve; });
}

// =====================================================================
// 地图列表
// =====================================================================
function buildListView() {
  const modal = mk('div', 'ws-modal', S.root);
  const backdrop = mk('div', 'ws-backdrop', modal);
  backdrop.addEventListener('click', close);
  const panel = mk('div', 'ws-panel', modal);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '创意工坊');
  const head = mk('div', 'ws-head', panel);
  mk('div', 'ws-title', head, '创意工坊');
  const closeBtn = button('ws-close', head, '×');
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.addEventListener('click', close);
  const body = mk('div', 'ws-body', panel);
  const actionsRow = mk('div', 'ws-actions-row', body);
  const newBtn = button('ws-btn ws-btn-primary', actionsRow, '＋ 新建地图');
  newBtn.addEventListener('click', openNewDialog);
  const cards = mk('div', 'ws-cards', body);
  S.els.list = modal;
  S.els.cards = cards;
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function levelZh(id) {
  const def = BR.levels && BR.levels.get(id);
  return def ? (def.name || ('Level ' + id)) : ('Level ' + id);
}
function mapStatCounts(map) {
  const walls = (map.walls || []).length + (map.freeWalls || []).length;
  const entities = (map.entities || []).length;
  const exits = (map.exits ? (map.exits.removed || []).length + (map.exits.moved || []).length + (map.exits.added || []).length : 0);
  return { walls, entities, exits };
}

function renderList() {
  const cards = S.els.cards;
  cards.innerHTML = '';
  const list = BR.workshop.list();
  if (!list.length) {
    mk('div', 'ws-empty', cards, '还没有自己的后室，点上面「新建地图」开始搭一个。');
    return;
  }
  for (const map of list) {
    const card = mk('div', 'ws-card', cards);
    mk('div', 'ws-card-name', card, map.name || '我的后室');
    mk('div', 'ws-card-meta', card, levelZh(map.baseLevel) + ' · 更新于 ' + fmtTime(map.updatedAt));
    const st = mapStatCounts(map);
    mk('div', 'ws-card-stats', card, '墙改动 ' + st.walls + ' · 实体 ' + st.entities + ' · 出口改动 ' + st.exits);
    const actions = mk('div', 'ws-card-actions', card);
    const editBtn = button('ws-btn', actions, '编辑');
    editBtn.addEventListener('click', () => openEditor(map, false));
    const playBtn = button('ws-btn', actions, '游玩');
    playBtn.addEventListener('click', () => { openInfoCard(map, mapStatCounts(map)); });
    const delBtn = button('ws-btn ws-btn-danger', actions, '删除');
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '删除地图', body: '「' + (map.name || '我的后室') + '」删除后无法恢复，确定删除吗？', okText: '删除', danger: true });
      if (!ok) return;
      BR.workshop.remove(map.id);
      renderList();
    });
  }
}

function open() {
  if (!ensureDom()) return;
  S.root.hidden = false;
  switchView('list');
  renderList();
}
function close() {
  if (!S.root || S.root.hidden) return;
  if (S.view === 'editor') { requestExitEditor(); return; }
  S.root.hidden = true;
}

// =====================================================================
// 新建地图
// =====================================================================
function levelChoicesForBase() {
  // 只列已注册的首期层级（WORKSHOP.md 第 8 节）；开发期一个都没注册时兜底给 dev
  const out = [];
  for (const id of (BR.LEVEL_ORDER || [])) if (BR.levels && BR.levels.has(id)) out.push({ id: String(id), label: levelZh(id) });
  if (!out.length && BR.levels && BR.levels.has('dev')) out.push({ id: 'dev', label: levelZh('dev') });
  return out;
}

function buildNewDialog() {
  const modal = mk('div', 'ws-modal', S.root);
  modal.hidden = true;
  const backdrop = mk('div', 'ws-backdrop', modal);
  backdrop.addEventListener('click', () => switchView('list'));
  const panel = mk('div', 'ws-panel ws-panel-narrow', modal);
  const head = mk('div', 'ws-head', panel);
  mk('div', 'ws-title', head, '新建地图');
  const closeBtn = button('ws-close', head, '×');
  closeBtn.addEventListener('click', () => switchView('list'));
  const body = mk('div', 'ws-body', panel);

  const nameField = mk('div', 'ws-field', body);
  mk('label', 'ws-field-label', nameField, '名称');
  const nameInput = mk('input', 'ws-input', nameField);
  nameInput.type = 'text';
  nameInput.maxLength = 40;
  nameInput.placeholder = '我的后室';

  const lvField = mk('div', 'ws-field', body);
  mk('label', 'ws-field-label', lvField, '起始层级');
  const radioList = mk('div', 'ws-radio-list', lvField);

  const actions = mk('div', 'ws-actions-row', panel);
  const cancelBtn = button('ws-btn', actions, '取消');
  cancelBtn.addEventListener('click', () => switchView('list'));
  const createBtn = button('ws-btn ws-btn-primary', actions, '创建');

  S.els.newdlg = modal;
  S.els.newName = nameInput;
  S.els.newRadios = radioList;
  S.els.newCreate = createBtn;
}

function openNewDialog() {
  S.els.newName.value = '';
  const list = levelChoicesForBase();
  const radioList = S.els.newRadios;
  radioList.innerHTML = '';
  let chosen = list[0] ? list[0].id : '0';
  for (const it of list) {
    const item = mk('label', 'ws-radio-item' + (it.id === chosen ? ' is-active' : ''), radioList);
    const r = mk('input', null, item);
    r.type = 'radio'; r.name = 'ws-new-level'; r.value = it.id; r.checked = it.id === chosen;
    mk('span', null, item, it.label);
    r.addEventListener('change', () => {
      chosen = it.id;
      Array.from(radioList.children).forEach(c => c.classList.toggle('is-active', c === item));
    });
  }
  S.els.newCreate.onclick = () => {
    const map = BR.workshop.create(chosen, S.els.newName.value.trim());
    openEditor(map, true);
  };
  switchView('new');
}

// =====================================================================
// 编辑器：DOM 骨架
// =====================================================================
function buildEditor() {
  const root = mk('div', 'ws-editor', S.root);
  root.hidden = true;

  const stage = mk('div', 'ws-stage', root);
  const svg = svgEl('svg', 'ws-svg', root);
  const gMask = svgEl('g', null, svg);
  const gEdge = svgEl('g', null, svg);
  const gEnt = svgEl('g', null, svg);
  const gExit = svgEl('g', null, svg);
  const gSpawn = svgEl('g', null, svg);
  const gCursor = svgEl('g', null, svg);

  // 工具栏
  const toolbar = mk('div', 'ws-toolbar', root);
  const tools = [
    ['select', '选择'], ['wall', '删/加墙'], ['freewall', '自由墙'],
    ['entity', '放实体'], ['exit', '出口'], ['spawn', '出生点'],
  ];
  const toolBtns = {};
  for (const [key, label] of tools) {
    const b = button('ws-tool-btn', toolbar, label);
    b.addEventListener('click', () => setTool(key));
    toolBtns[key] = b;
  }
  mk('div', 'ws-tool-sep', toolbar);
  const previewBtn = button('ws-tool-btn', toolbar, '3D 预览');
  previewBtn.addEventListener('click', enterPreview);
  const settingsBtn = button('ws-tool-btn', toolbar, '基本设置');
  settingsBtn.addEventListener('click', () => openPanel('settings'));

  // 剖切高度滑条
  const section = mk('div', 'ws-section', root);
  mk('div', 'ws-section-label', section, '剖切高度');
  const sectionRange = mk('input', null, section);
  sectionRange.type = 'range';
  sectionRange.min = String(SECTION_MIN); sectionRange.max = String(SECTION_MAX); sectionRange.step = '0.05';
  sectionRange.addEventListener('input', () => { S.cam.section = Number(sectionRange.value); applyCamera(); });

  // 底部条：提示 + 撤销/重做/保存/退出
  const bottombar = mk('div', 'ws-bottombar', root);
  const hint = mk('div', 'ws-hint', bottombar, '');
  const undoBtn = button('ws-tool-btn', bottombar, '撤销');
  undoBtn.addEventListener('click', doUndo);
  const redoBtn = button('ws-tool-btn', bottombar, '重做');
  redoBtn.addEventListener('click', doRedo);
  const saveBtn = button('ws-tool-btn ws-btn-primary', bottombar, '保存');
  saveBtn.addEventListener('click', doSave);
  const exitBtn = button('ws-tool-btn', bottombar, '退出');
  exitBtn.addEventListener('click', requestExitEditor);

  // 侧滑面板：实体 / 出口 / 设置（同一份 DOM，切换内容）
  const panel = mk('div', 'ws-panelslide', root);
  panel.hidden = true;
  const panelHead = mk('div', 'ws-panelslide-head', panel);
  const panelTitle = mk('div', 'ws-panelslide-title', panelHead);
  const panelClose = button('ws-close', panelHead, '×');
  panelClose.addEventListener('click', closePanel);
  const panelBody = mk('div', 'ws-panelslide-body', panel);

  // 新增出口的小弹窗
  const exitDlg = mk('div', 'ws-modal', root);
  exitDlg.hidden = true;
  const exitBackdrop = mk('div', 'ws-backdrop', exitDlg);
  const exitPanel = mk('div', 'ws-panel ws-panel-narrow', exitDlg);
  const exitHead = mk('div', 'ws-head', exitPanel);
  mk('div', 'ws-title', exitHead, '新增出口');
  const exitCloseBtn = button('ws-close', exitHead, '×');
  const exitBody = mk('div', 'ws-body', exitPanel);
  const exitToField = mk('div', 'ws-field', exitBody);
  mk('label', 'ws-field-label', exitToField, '目标层级');
  const exitToSel = mk('select', 'ws-select', exitToField);
  const exitKindField = mk('div', 'ws-field', exitBody);
  mk('label', 'ws-field-label', exitKindField, '类型');
  const exitKindSel = mk('select', 'ws-select', exitKindField);
  for (const k of ['door', 'stairs', 'elevator', 'zone']) {
    const o = mk('option', null, exitKindSel, EXIT_KIND_ZH[k]); o.value = k;
  }
  const exitLabelField = mk('div', 'ws-field', exitBody);
  mk('label', 'ws-field-label', exitLabelField, '标签（可选）');
  const exitLabelInput = mk('input', 'ws-input', exitLabelField);
  exitLabelInput.maxLength = 20;
  const exitActions = mk('div', 'ws-actions-row', exitPanel);
  const exitCancel = button('ws-btn', exitActions, '取消');
  const exitConfirm = button('ws-btn ws-btn-primary', exitActions, '添加');
  exitBackdrop.addEventListener('click', () => { exitDlg.hidden = true; });
  exitCloseBtn.addEventListener('click', () => { exitDlg.hidden = true; });
  exitCancel.addEventListener('click', () => { exitDlg.hidden = true; });

  root.addEventListener('keydown', () => {});

  S.els.editor = root;
  S.els.stage = stage;
  S.els.svg = svg; S.els.gMask = gMask; S.els.gEdge = gEdge; S.els.gEnt = gEnt; S.els.gExit = gExit; S.els.gSpawn = gSpawn; S.els.gCursor = gCursor;
  S.els.toolBtns = toolBtns;
  S.els.previewBtn = previewBtn;
  S.els.sectionRange = sectionRange;
  S.els.hint = hint;
  S.els.undoBtn = undoBtn; S.els.redoBtn = redoBtn;
  S.els.panel = panel; S.els.panelTitle = panelTitle; S.els.panelBody = panelBody;
  S.els.exitDlg = exitDlg; S.els.exitToSel = exitToSel; S.els.exitKindSel = exitKindSel; S.els.exitLabelInput = exitLabelInput; S.els.exitConfirm = exitConfirm;

  bindStagePointer();
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onEditorKeydown);
}

function onWindowResize() {
  if (S.view === 'editor' && S.editorSceneOpen && !S.fp) { applyCamera(); redrawOverlay(); }
}
function onEditorKeydown(e) {
  if (S.view !== 'editor') return;
  if (S.fp) { onFpKeydown(e); return; }
  if (e.key === 'Escape') requestExitEditor();
  else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
}

// =====================================================================
// 编辑器：进入 / 退出、场景与相机
// =====================================================================
function openEditor(map, isNew) {
  S.map = map;
  S.isNewMap = !!isNew;
  S.savedSnapshot = snapshotOf(map);
  S.undoStack = []; S.redoStack = [];
  S.tool = 'select'; S.selectedEntityType = null; S.selectedEntityId = null; S.exitAddArm = false;
  switchView('editor');
  openScene();
  setTool('select');
  refreshUndoButtons();
}

function snapshotOf(map) {
  return JSON.stringify({ walls: map.walls, freeWalls: map.freeWalls, entities: map.entities, exits: map.exits, spawn: map.spawn, settings: map.settings });
}
function isDirty() { return S.map && snapshotOf(S.map) !== S.savedSnapshot; }

// 打开真实 3D 场景做编辑器背景：隐藏主页、切走 screen 让 tick() 的 home/playing 分支都不再抢相机，
// 但 gfx.render 每帧仍然无条件执行，正好用来画我们摆好的俯视相机
function openScene() {
  const gfx = BR.gfx;
  S.saved3D = {
    fov: gfx.camera.fov, near: gfx.camera.near, far: gfx.camera.far,
    up: gfx.camera.up.clone(), pos: gfx.camera.position.clone(), quat: gfx.camera.quaternion.clone(),
    fogNear: gfx.scene.fog ? gfx.scene.fog.near : null, fogFar: gfx.scene.fog ? gfx.scene.fog.far : null,
    screen: BR.game.screen,
  };
  if (has(BR.home, 'hide')) BR.home.hide();
  BR.game.screen = 'workshop';
  BR.workshop.activate(S.map, { editing: true });
  try { BR.world.start(S.map.baseLevel, S.map.seed); }
  catch (err) { console.error('[workshop-ui] 载入层级失败', err); toast('载入层级失败：' + (err && err.message || err)); }

  const info = has(BR.world, 'debugInfo') ? BR.world.debugInfo() : null;
  S.chunkSize = (info && info.chunkSize) || BR.world.chunkSize || 24;
  const sc = (info && info.spawnChunk) || [0, 0];
  const r = Math.max(0, num(S.map.radius, 3) | 0);
  S.boundary = {
    minX: (sc[0] - r) * S.chunkSize, maxX: (sc[0] + r + 1) * S.chunkSize,
    minZ: (sc[1] - r) * S.chunkSize, maxZ: (sc[1] + r + 1) * S.chunkSize,
  };
  const p = BR.player;
  S.cam.cx = p ? num(p.x, 0) : (S.boundary.minX + S.boundary.maxX) / 2;
  S.cam.cz = p ? num(p.z, 0) : (S.boundary.minZ + S.boundary.maxZ) / 2;
  S.cam.altitude = clamp(Math.max(S.boundary.maxX - S.boundary.minX, S.boundary.maxZ - S.boundary.minZ) * 0.62, ALT_MIN, ALT_MAX);
  S.cam.section = SECTION_DEFAULT;
  extendFog();
  S.editorSceneOpen = true;
  applyCamera();
  redrawOverlay();
}

// 场景重新读到的雾/相机远裁剪面每次 world.start 都会被 present() 按层级 env 重设，
// 编辑器俯视范围（默认 7×7 区块 ≈ 168 米）比正常雾效可视距离大得多，这里把雾推得足够远
function extendFog() {
  const gfx = BR.gfx;
  if (gfx.scene.fog) { gfx.scene.fog.near = 4000; gfx.scene.fog.far = 8000; }
  const diag = S.boundary ? Math.hypot(S.boundary.maxX - S.boundary.minX, S.boundary.maxZ - S.boundary.minZ) : 300;
  gfx.camera.far = Math.max(gfx.camera.far, diag + 200, 500);
  gfx.camera.updateProjectionMatrix();
}

function closeScene() {
  S.editorSceneOpen = false;
  clearTimeout(S.reloadTimer);
  const gfx = BR.gfx;
  if (S.saved3D) {
    gfx.camera.fov = S.saved3D.fov; gfx.camera.near = S.saved3D.near; gfx.camera.far = S.saved3D.far;
    gfx.camera.up.copy(S.saved3D.up); gfx.camera.position.copy(S.saved3D.pos); gfx.camera.quaternion.copy(S.saved3D.quat);
    gfx.camera.updateProjectionMatrix();
    if (gfx.scene.fog && S.saved3D.fogNear != null) { gfx.scene.fog.near = S.saved3D.fogNear; gfx.scene.fog.far = S.saved3D.fogFar; }
  }
  BR.workshop.deactivate();
  if (has(BR.world, 'clear')) BR.world.clear();
  BR.game.screen = 'home';
  if (has(BR.home, 'show')) BR.home.show();
}

function requestExitEditor() {
  if (isDirty()) {
    confirmDialog({ title: '未保存的改动', body: '离开编辑器会丢失未保存的改动，确定离开吗？', okText: '离开', danger: true })
      .then(ok => { if (ok) { closeScene(); switchView('list'); renderList(); } });
  } else {
    closeScene(); switchView('list'); renderList();
  }
}

// ---------- 相机：仿射投影（世界 xz 平面 → 屏幕像素） ----------
function applyCamera() {
  const gfx = BR.gfx;
  const c = gfx.camera;
  c.fov = FOV_TOP;
  c.up.set(0, 0, -1);
  c.position.set(S.cam.cx, S.cam.altitude, S.cam.cz);
  c.lookAt(S.cam.cx, 0, S.cam.cz);
  c.near = Math.max(0.02, S.cam.altitude - S.cam.section);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  calibrateProjection();
}

function calibrateProjection() {
  const gfx = BR.gfx;
  const rect = stageRect();
  const p0 = worldPointToPx(S.cam.cx, S.cam.cz, rect);
  const p1 = worldPointToPx(S.cam.cx + 10, S.cam.cz, rect);
  const p2 = worldPointToPx(S.cam.cx, S.cam.cz + 10, rect);
  const sx = (p1.x - p0.x) / 10, sy = (p2.y - p0.y) / 10;
  S.proj = { ox: p0.x, oy: p0.y, sx: sx || 1, sy: sy || 1 };
}
function worldPointToPx(x, z, rect) {
  const v = new THREE.Vector3(x, 0, z).project(BR.gfx.camera);
  return { x: (v.x * 0.5 + 0.5) * rect.width, y: (1 - (v.y * 0.5 + 0.5)) * rect.height };
}
function stageRect() { return S.els.stage.getBoundingClientRect(); }
function worldToScreen(x, z) {
  const pr = S.proj; if (!pr) return { x: 0, y: 0 };
  return { x: pr.ox + (x - S.cam.cx) * pr.sx, y: pr.oy + (z - S.cam.cz) * pr.sy };
}
function screenToWorld(px, py) {
  const pr = S.proj; if (!pr) return { x: S.cam.cx, z: S.cam.cz };
  return { x: S.cam.cx + (px - pr.ox) / pr.sx, z: S.cam.cz + (py - pr.oy) / pr.sy };
}
function clientToWorld(clientX, clientY) {
  const rect = stageRect();
  return screenToWorld(clientX - rect.left, clientY - rect.top);
}

function panBy(dxPx, dyPx) {
  const pr = S.proj; if (!pr) return;
  S.cam.cx -= dxPx / pr.sx;
  S.cam.cz -= dyPx / pr.sy;
  applyCamera();
}
function zoomBy(factor, aroundClientX, aroundClientY) {
  const rect = stageRect();
  const before = aroundClientX != null ? screenToWorld(aroundClientX - rect.left, aroundClientY - rect.top) : null;
  S.cam.altitude = clamp(S.cam.altitude * factor, Math.max(ALT_MIN, S.cam.section + 0.5), ALT_MAX);
  applyCamera();
  if (before) {
    // 让缩放围绕鼠标/双指中点进行：缩放后重新算一次那个点现在对应的世界坐标，把差值再平移回去
    const after = screenToWorld(aroundClientX - rect.left, aroundClientY - rect.top);
    S.cam.cx -= (after.x - before.x); S.cam.cz -= (after.z - before.z);
    applyCamera();
  }
}

// =====================================================================
// 叠加标记：编辑范围遮罩 / 实体 / 出口 / 出生点
// =====================================================================
function redrawOverlay() {
  if (!S.editorSceneOpen || S.fp) return;
  drawBoundaryMask();
  drawEntities();
  drawExits();
  drawSpawn();
}

function rectPath(x0, y0, x1, y1) { return 'M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z'; }

function drawBoundaryMask() {
  const g = S.els.gMask; g.innerHTML = '';
  if (!S.boundary) return;
  const rect = stageRect();
  const a = worldToScreen(S.boundary.minX, S.boundary.minZ);
  const b = worldToScreen(S.boundary.maxX, S.boundary.maxZ);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  // 外圈整片暗色 + 中间镂空（用 evenodd 一个 path 挖洞），比四条矩形拼接简单
  const p = svgEl('path', 'ws-mask-rect', g);
  p.setAttribute('fill-rule', 'evenodd');
  p.setAttribute('d', rectPath(-8, -8, rect.width + 8, rect.height + 8) + ' ' + rectPath(x0, y0, x1, y1));
  const border = svgEl('rect', 'ws-bounds-rect', g);
  border.setAttribute('x', x0); border.setAttribute('y', y0);
  border.setAttribute('width', Math.max(0, x1 - x0)); border.setAttribute('height', Math.max(0, y1 - y0));
}

function entityZh(type) {
  const d = BR.entityTypes && BR.entityTypes.get(type);
  return d ? (d.zh || type) : type;
}
function drawEntities() {
  const g = S.els.gEnt; g.innerHTML = '';
  const list = (S.map.entities || []);
  const defaultR = num(S.map.settings && S.map.settings.triggerRadius, 20);
  for (const e of list) {
    if (!e) continue;
    const p = worldToScreen(e.x, e.z);
    const def = BR.entityTypes && BR.entityTypes.get(e.type);
    const color = factionColor(def && def.faction);
    const r = (typeof e.radius === 'number' && e.radius > 0) ? e.radius : defaultR;
    const pr = S.proj;
    const ring = svgEl('circle', 'ws-ent-ring', g);
    ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('r', Math.abs(r * pr.sx));
    ring.setAttribute('stroke', color);
    const dot = svgEl('circle', 'ws-ent-dot', g);
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', e.id === S.selectedEntityId ? 9 : 7);
    dot.setAttribute('fill', color);
    dot.dataset.id = e.id;
    dot.addEventListener('pointerdown', onEntityPointerDown);
    const label = svgEl('text', 'ws-ent-label', g);
    label.setAttribute('x', p.x); label.setAttribute('y', p.y - 12);
    label.textContent = entityZh(e.type);
  }
}

function drawExits() {
  const g = S.els.gExit; g.innerHTML = '';
  if (!S.boundary) return;
  const cx = (S.boundary.minX + S.boundary.maxX) / 2, cz = (S.boundary.minZ + S.boundary.maxZ) / 2;
  const R = Math.hypot(S.boundary.maxX - S.boundary.minX, S.boundary.maxZ - S.boundary.minZ) / 2 + 4;
  const list = has(BR.workshop, 'exitsNear') ? BR.workshop.exitsNear(cx, cz, R) : [];
  for (const ex of list) {
    const p = worldToScreen(ex.x, ex.z);
    const opened = !!(BR.levels && BR.levels.has(ex.to));
    const cls = 'ws-exit-icon' + (ex.source === 'added' ? ' is-added' : '') + (ex.sealed || !opened ? ' is-sealed' : '');
    const icon = svgEl('rect', cls, g);
    icon.setAttribute('x', p.x - 8); icon.setAttribute('y', p.y - 8); icon.setAttribute('width', 16); icon.setAttribute('height', 16);
    icon.dataset.key = String(ex.key);
    icon.addEventListener('pointerdown', onExitPointerDown);
    const label = svgEl('text', 'ws-exit-label', g);
    label.setAttribute('x', p.x); label.setAttribute('y', p.y + 22);
    label.textContent = (EXIT_KIND_ZH[ex.kind] || ex.kind) + ' → ' + levelZh(ex.to) + (opened ? '' : '（未开放）');
  }
}

function drawSpawn() {
  const g = S.els.gSpawn; g.innerHTML = '';
  const s = S.map.spawn;
  const p0 = BR.player;
  const x = s ? s.x : (p0 ? p0.x : S.cam.cx), z = s ? s.z : (p0 ? p0.z : S.cam.cz);
  const p = worldToScreen(x, z);
  const flag = svgEl('path', 'ws-spawn-flag', g);
  flag.setAttribute('d', 'M' + p.x + ' ' + (p.y + 12) + 'V' + (p.y - 12) + 'L' + (p.x + 12) + ' ' + (p.y - 6) + 'L' + p.x + ' ' + p.y + 'Z');
}

function drawHoverEdge(edge) {
  const g = S.els.gEdge; g.innerHTML = '';
  if (!edge) return;
  const a = worldToScreen(edge.x0, edge.z0), b = worldToScreen(edge.x1, edge.z1);
  const line = svgEl('line', 'ws-edge-hi' + (edge.on ? '' : ' is-off'), g);
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
}

// =====================================================================
// 工具与撤销/重做
// =====================================================================
const TOOL_HINTS = {
  select: '拖动平移，滚轮缩放；拖动地图上的实体/出口可以移动它们',
  wall: '点击格子边切换有无墙；区块交界线两侧会一起改',
  freewall: '在非格子区域拖出一段自由墙（只能加不能删）',
  entity: '先在右侧面板选一种实体，再点地图放置',
  exit: '拖动已有出口图标移动它；点「添加出口」再点地图选位置',
  spawn: '点击地图设置出生点',
};
function setTool(key) {
  S.tool = key;
  S.exitAddArm = false;
  Object.keys(S.els.toolBtns).forEach(k => S.els.toolBtns[k].classList.toggle('is-active', k === key));
  S.els.stage.classList.toggle('is-tool-wall', key === 'wall');
  S.els.hint.textContent = TOOL_HINTS[key] || '';
  if (key === 'entity') openPanel('entity'); else if (key === 'exit') openPanel('exit'); else closePanel();
}

function pushHistory() {
  S.undoStack.push(snapshotOf(S.map));
  if (S.undoStack.length > HISTORY_LIMIT) S.undoStack.shift();
  S.redoStack = [];
  refreshUndoButtons();
}
function restoreSnapshot(json) {
  const o = JSON.parse(json);
  Object.assign(S.map, o);
  refreshAfterDataChange(true);
}
function doUndo() {
  if (!S.undoStack.length) return;
  S.redoStack.push(snapshotOf(S.map));
  const prev = S.undoStack.pop();
  restoreSnapshot(prev);
  refreshUndoButtons();
}
function doRedo() {
  if (!S.redoStack.length) return;
  S.undoStack.push(snapshotOf(S.map));
  const next = S.redoStack.pop();
  restoreSnapshot(next);
  refreshUndoButtons();
}
function refreshUndoButtons() {
  S.els.undoBtn.disabled = !S.undoStack.length;
  S.els.redoBtn.disabled = !S.redoStack.length;
}

// 墙/自由墙/出口的改动会改变静态几何，需要重新生成场景才能在画面上反映出来；
// 实体/出生点/基本设置只影响运行时钩子，编辑期不刷实体也看不出视觉差别，不需要重建
function refreshAfterDataChange(geometryChanged) {
  if (geometryChanged) scheduleReload(); else redrawOverlay();
}
function scheduleReload() {
  clearTimeout(S.reloadTimer);
  S.reloadTimer = setTimeout(reloadScene, RELOAD_DEBOUNCE);
}
function reloadScene() {
  if (!S.editorSceneOpen) return;
  try { BR.world.start(S.map.baseLevel, S.map.seed); }
  catch (err) { console.error('[workshop-ui] 重建场景失败', err); }
  extendFog();
  applyCamera();
  redrawOverlay();
}

// ---------- 舞台指针交互：平移/缩放/各工具的点击与拖拽 ----------
function bindStagePointer() {
  const stage = S.els.stage;
  S.activePointers = new Map();
  stage.addEventListener('pointerdown', onStagePointerDown);
  stage.addEventListener('pointermove', onStagePointerMove);
  stage.addEventListener('pointerup', onStagePointerUp);
  stage.addEventListener('pointercancel', onStagePointerUp);
  stage.addEventListener('wheel', onStageWheel, { passive: false });
}

function onStageWheel(e) {
  e.preventDefault();
  const factor = Math.exp(e.deltaY * 0.0016);
  zoomBy(factor, e.clientX, e.clientY);
}

function onStagePointerDown(e) {
  if (S.fp) return;
  S.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.activePointers.size === 2) {
    const pts = Array.from(S.activePointers.values());
    S.pinch = { d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), alt0: S.cam.altitude, mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2 };
    S.drag = null;
    return;
  }
  S.els.stage.setPointerCapture && S.els.stage.setPointerCapture(e.pointerId);
  S.drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
}
function onStagePointerMove(e) {
  if (S.fp) return;
  if (S.activePointers.has(e.pointerId)) S.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.pinch && S.activePointers.size === 2) {
    const pts = Array.from(S.activePointers.values());
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (d > 1 && S.pinch.d0 > 1) {
      S.cam.altitude = clamp(S.pinch.alt0 * (S.pinch.d0 / d), Math.max(ALT_MIN, S.cam.section + 0.5), ALT_MAX);
      applyCamera(); redrawOverlay();
    }
    return;
  }
  if (!S.drag) {
    if (S.tool === 'wall') { drawHoverEdge(BR.workshop.edgeAt(clientToWorld(e.clientX, e.clientY).x, clientToWorld(e.clientX, e.clientY).z)); }
    return;
  }
  const dx = e.clientX - S.drag.lastX, dy = e.clientY - S.drag.lastY;
  S.drag.lastX = e.clientX; S.drag.lastY = e.clientY;
  if (Math.hypot(e.clientX - S.drag.startX, e.clientY - S.drag.startY) > CLICK_SLOP) S.drag.moved = true;
  if (S.drag.moved) {
    if (S.tool === 'freewall') { drawFreewallGhost(S.drag.startX, S.drag.startY, e.clientX, e.clientY); }
    else { S.els.stage.classList.add('is-panning'); panBy(dx, dy); redrawOverlay(); }
  }
}
function onStagePointerUp(e) {
  S.activePointers.delete(e.pointerId);
  if (S.activePointers.size < 2) S.pinch = null;
  S.els.stage.classList.remove('is-panning');
  const drag = S.drag; S.drag = null;
  if (S.fp || !drag) return;
  if (!drag.moved) {
    onStageClick(e.clientX, e.clientY);
  } else if (S.tool === 'freewall') {
    S.els.gCursor.innerHTML = '';
    commitFreewall(drag.startX, drag.startY, e.clientX, e.clientY);
  }
}

function onStageClick(clientX, clientY) {
  const w = clientToWorld(clientX, clientY);
  if (S.tool === 'wall') {
    const edge = BR.workshop.edgeAt(w.x, w.z);
    if (!edge) { toast('这里不在格子墙范围内'); return; }
    pushHistory();
    S.map.walls.push({ k: edge.key, on: !edge.on });
    refreshAfterDataChange(true);
  } else if (S.tool === 'entity') {
    if (!S.selectedEntityType) { toast('先在右侧选择实体类型'); return; }
    pushHistory();
    if (!Array.isArray(S.map.entities)) S.map.entities = [];
    S.map.entities.push({ id: U.uid('went_'), type: S.selectedEntityType, x: w.x, z: w.z, yaw: 0, radius: null });
    refreshAfterDataChange(false);
  } else if (S.tool === 'exit') {
    if (S.exitAddArm) openAddExitDialog(w.x, w.z);
  } else if (S.tool === 'spawn') {
    pushHistory();
    const prevYaw = S.map.spawn ? num(S.map.spawn.yaw, 0) : 0;
    S.map.spawn = { x: w.x, z: w.z, yaw: prevYaw };
    refreshAfterDataChange(false);
  }
}

function drawFreewallGhost(x0, y0, x1, y1) {
  const g = S.els.gCursor; g.innerHTML = '';
  const rect = stageRect();
  const line = svgEl('line', 'ws-freewall-drag', g);
  line.setAttribute('x1', x0 - rect.left); line.setAttribute('y1', y0 - rect.top);
  line.setAttribute('x2', x1 - rect.left); line.setAttribute('y2', y1 - rect.top);
}
function commitFreewall(cx0, cy0, cx1, cy1) {
  const a = clientToWorld(cx0, cy0), b = clientToWorld(cx1, cy1);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.3) return;
  const rot = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2; // 约定：rot=0 沿世界 +X 延伸（见 js/game/workshop.js buildFreeWalls 注释）
  pushHistory();
  if (!Array.isArray(S.map.freeWalls)) S.map.freeWalls = [];
  S.map.freeWalls.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len, rot, h: undefined });
  refreshAfterDataChange(true);
}

// ---------- 实体标记：点击选中 / 拖动移动 ----------
function onEntityPointerDown(e) {
  e.stopPropagation();
  const id = e.target.dataset.id;
  S.selectedEntityId = id;
  redrawOverlay();
  let moved = false, historyPushed = false;
  const move = (ev) => {
    const w = clientToWorld(ev.clientX, ev.clientY);
    const ent = (S.map.entities || []).find(x => x.id === id);
    if (!ent) return;
    if (!historyPushed) { pushHistory(); historyPushed = true; }
    moved = true;
    ent.x = w.x; ent.z = w.z;
    redrawOverlay();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) refreshEntityPanel();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function deleteSelectedEntity() {
  if (!S.selectedEntityId) return;
  pushHistory();
  S.map.entities = (S.map.entities || []).filter(x => x.id !== S.selectedEntityId);
  S.selectedEntityId = null;
  refreshAfterDataChange(false);
  refreshEntityPanel();
}

// ---------- 出口标记：拖动移动 ----------
function onExitPointerDown(e) {
  e.stopPropagation();
  const key = e.target.dataset.key;
  let moved = false, historyPushed = false;
  const move = (ev) => {
    const w = clientToWorld(ev.clientX, ev.clientY);
    if (!historyPushed) { pushHistory(); historyPushed = true; }
    moved = true;
    setExitMoved(key, w.x, w.z);
    redrawOverlay();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) refreshAfterDataChange(true); else refreshExitPanel();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function setExitMoved(key, x, z, rot) {
  if (!S.map.exits) S.map.exits = { removed: [], moved: [], added: [] };
  const list = S.map.exits.moved;
  let m = list.find(x2 => String(x2.key) === String(key));
  if (!m) { m = { key: String(key) }; list.push(m); }
  m.x = x; m.z = z; if (rot != null) m.rot = rot;
}
function removeOrRestoreExit(ex) {
  pushHistory();
  if (ex.source === 'added') {
    const id = String(ex.key).replace(/^ws:/, '');
    S.map.exits.added = (S.map.exits.added || []).filter(a => a.id !== id);
  } else {
    const removed = S.map.exits.removed || (S.map.exits.removed = []);
    const i = removed.findIndex(k => String(k) === String(ex.key));
    if (i >= 0) removed.splice(i, 1); else removed.push(String(ex.key));
  }
  refreshAfterDataChange(true);
  refreshExitPanel();
}
function openAddExitDialog(x, z) {
  const sel = S.els.exitToSel;
  sel.innerHTML = '';
  for (const id of (BR.LEVEL_ORDER || [])) {
    const opened = BR.levels && BR.levels.has(id);
    const o = mk('option', null, sel, levelZh(id) + (opened ? '' : '（未开放）'));
    o.value = String(id);
  }
  S.els.exitLabelInput.value = '';
  S.els.exitDlg.hidden = false;
  S.els.exitConfirm.onclick = () => {
    pushHistory();
    if (!S.map.exits) S.map.exits = { removed: [], moved: [], added: [] };
    S.map.exits.added.push({
      id: U.uid('wex_'), to: sel.value, kind: S.els.exitKindSel.value, x, z, rot: 0,
      label: S.els.exitLabelInput.value.trim(),
    });
    S.els.exitDlg.hidden = true;
    S.exitAddArm = false;
    refreshAfterDataChange(true);
    refreshExitPanel();
  };
}

// =====================================================================
// 侧滑面板：实体 / 出口 / 基本设置
// =====================================================================
function openPanel(kind) {
  S.els.panel.hidden = false;
  if (kind === 'entity') { S.els.panelTitle.textContent = '放置实体'; buildEntityPanel(); }
  else if (kind === 'exit') { S.els.panelTitle.textContent = '出口'; buildExitPanel(); }
  else if (kind === 'settings') { S.els.panelTitle.textContent = '基本设置'; buildSettingsPanel(); }
  S.els.panel.dataset.kind = kind;
}
function closePanel() { S.els.panel.hidden = true; S.els.panel.dataset.kind = ''; }

function isDevEntityType(type) { return type === 'test_dummy' || String(type).charAt(0) === '_'; }
function levelLabelFor(lv) { return (lv.name ? lv.name : 'Level ' + lv.id) + (lv.title ? ' · ' + lv.title : ''); }
function sortedLevelDefs() {
  const order = BR.LEVEL_ORDER || [];
  const rank = lv => { const i = order.indexOf(String(lv.id)); return i < 0 ? order.length : i; };
  return (BR.levels ? BR.levels.all() : []).slice().sort((a, b) => rank(a) - rank(b));
}
function entityGroups() {
  const byType = new Map();
  for (const d of (BR.entityTypes ? BR.entityTypes.all() : [])) if (d && d.type != null && !isDevEntityType(d.type)) byType.set(String(d.type), d);
  const used = new Set(), groups = [];
  for (const lv of sortedLevelDefs()) {
    const defs = [], seen = new Set();
    for (const ent of (Array.isArray(lv.entities) ? lv.entities : [])) {
      const t = String(ent && typeof ent === 'object' ? ent.type : ent);
      const d = byType.get(t);
      if (!d || seen.has(t)) continue;
      seen.add(t); used.add(t); defs.push(d);
    }
    if (defs.length) groups.push({ label: levelLabelFor(lv), defs });
  }
  const rest = [];
  for (const d of byType.values()) if (!used.has(String(d.type))) rest.push(d);
  if (rest.length) groups.push({ label: '其他', defs: rest });
  return groups;
}
function buildEntityPanel() {
  const body = S.els.panelBody; body.innerHTML = '';
  for (const grp of entityGroups()) {
    mk('div', 'ws-group-label', body, grp.label);
    for (const d of grp.defs) {
      const b = mk('button', 'ws-ent-btn' + (S.selectedEntityType === d.type ? ' is-active' : ''), body);
      b.type = 'button';
      const sw = mk('span', 'ws-ent-swatch', b); sw.style.background = factionColor(d.faction);
      mk('span', null, b, d.zh || d.type);
      b.addEventListener('click', () => { S.selectedEntityType = d.type; buildEntityPanel(); });
    }
  }
  mk('div', 'ws-sep', body);
  mk('div', 'ws-group-label', body, '已放置（' + (S.map.entities || []).length + '）');
  refreshEntityPanel();
}
function refreshEntityPanel() {
  if (S.els.panel.dataset.kind !== 'entity') return;
  const body = S.els.panelBody;
  let list = body.querySelector('.ws-placed-list');
  if (!list) { list = mk('div', 'ws-placed-list', body); } else { list.innerHTML = ''; }
  for (const e of (S.map.entities || [])) {
    const row = mk('div', 'ws-exit-row', list);
    const main = mk('div', 'ws-exit-row-main', row);
    mk('div', 'ws-exit-row-title', main, entityZh(e.type));
    mk('div', 'ws-exit-row-sub', main, '触发 ' + (e.radius || (S.map.settings && S.map.settings.triggerRadius) || 20) + ' m');
    const del = button('ws-icon-btn ws-btn-danger', row, '×');
    del.addEventListener('click', () => { S.selectedEntityId = e.id; deleteSelectedEntity(); });
  }
  const stat = body.querySelector('.ws-group-label:nth-of-type(2)');
  if (stat) stat.textContent = '已放置（' + (S.map.entities || []).length + '）';
}

function buildExitPanel() {
  const body = S.els.panelBody; body.innerHTML = '';
  const armBtn = button('ws-btn ws-btn-primary', body, S.exitAddArm ? '点地图选位置…' : '＋ 添加出口');
  armBtn.style.width = '100%'; armBtn.style.marginBottom = '10px';
  armBtn.addEventListener('click', () => { S.exitAddArm = !S.exitAddArm; buildExitPanel(); toast(S.exitAddArm ? '点地图上任意位置放置出口' : '已取消'); });
  mk('div', 'ws-placed-list', body);
  refreshExitPanel();
}
function refreshExitPanel() {
  if (S.els.panel.dataset.kind !== 'exit') return;
  const body = S.els.panelBody;
  const list = body.querySelector('.ws-placed-list');
  if (!list) return;
  list.innerHTML = '';
  if (!S.boundary) return;
  const cx = (S.boundary.minX + S.boundary.maxX) / 2, cz = (S.boundary.minZ + S.boundary.maxZ) / 2;
  const R = Math.hypot(S.boundary.maxX - S.boundary.minX, S.boundary.maxZ - S.boundary.minZ) / 2 + 4;
  const exits = has(BR.workshop, 'exitsNear') ? BR.workshop.exitsNear(cx, cz, R) : [];
  if (!exits.length) { mk('div', 'ws-note', list, '这片范围内没有出口。'); return; }
  for (const ex of exits) {
    const opened = !!(BR.levels && BR.levels.has(ex.to));
    const removed = ex.source === 'base' && (S.map.exits.removed || []).some(k => String(k) === String(ex.key));
    const row = mk('div', 'ws-exit-row', list);
    const main = mk('div', 'ws-exit-row-main', row);
    mk('div', 'ws-exit-row-title', main, (EXIT_KIND_ZH[ex.kind] || ex.kind) + ' → ' + levelZh(ex.to) + (opened ? '' : '（未开放）'));
    mk('div', 'ws-exit-row-sub', main, ex.source === 'added' ? '新增' : (removed ? '已删除' : '原有'));
    const del = button('ws-icon-btn' + (removed ? '' : ' ws-btn-danger'), row, removed ? '↺' : '×');
    del.title = removed ? '恢复' : '删除';
    del.addEventListener('click', () => removeOrRestoreExit(ex));
  }
}

function slider(parent, label, value, opts) {
  const f = mk('div', 'ws-set-field', parent);
  const row = mk('div', 'ws-set-row', f);
  mk('label', null, row, label);
  const val = mk('span', 'ws-set-value', row);
  const inp = mk('input', 'ws-range', f);
  inp.type = 'range'; inp.min = String(opts.min); inp.max = String(opts.max); inp.step = String(opts.step || 0.01);
  inp.value = String(value);
  val.textContent = opts.fmt ? opts.fmt(value) : String(value);
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    val.textContent = opts.fmt ? opts.fmt(v) : String(v);
    opts.onInput(v);
  });
  return inp;
}
function checkRow(parent, label, checked, onChange) {
  const row = mk('label', 'ws-check-row', parent);
  const c = mk('input', null, row); c.type = 'checkbox'; c.checked = !!checked;
  mk('span', null, row, label);
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}
function selectRow(parent, label, value, options, onChange) {
  const f = mk('div', 'ws-set-field', parent);
  mk('label', 'ws-field-label', f, label);
  const sel = mk('select', 'ws-select', f);
  for (const [v, zh] of options) { const o = mk('option', null, sel, zh); o.value = v; }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
function fmtPct(v) { return Math.round(v * 100) + '%'; }

function buildSettingsPanel() {
  const body = S.els.panelBody; body.innerHTML = '';
  const s = S.map.settings;
  const mutate = (fn) => { pushHistory(); fn(); refreshAfterDataChange(false); };

  const visRow = mk('div', 'ws-set-field', body);
  const followRow = mk('label', 'ws-check-row', visRow);
  const followChk = mk('input', null, followRow); followChk.type = 'checkbox'; followChk.checked = s.visibility == null;
  mk('span', null, followRow, '能见度跟随玩家设置');
  const visSlider = slider(visRow, '固定能见度', s.visibility == null ? 0.7 : s.visibility, {
    min: 0, max: 1, step: 0.01, fmt: fmtPct, onInput: v => mutate(() => { s.visibility = v; }),
  });
  visSlider.disabled = s.visibility == null;
  followChk.addEventListener('change', () => mutate(() => { s.visibility = followChk.checked ? null : Number(visSlider.value); visSlider.disabled = followChk.checked; }));

  slider(body, '灯光亮度倍率', s.lightMul, { min: 0.2, max: 1.5, step: 0.05, fmt: v => 'x' + v.toFixed(2), onInput: v => mutate(() => { s.lightMul = v; }) });
  selectRow(body, '灯光闪烁', s.flicker, [['level', '跟随层级'], ['off', '关闭'], ['more', '更频繁']], v => mutate(() => { s.flicker = v; }));
  checkRow(body, '全部熄灯（黑屋）', s.blackout, v => mutate(() => { s.blackout = v; }));
  mk('div', 'ws-sep', body);
  checkRow(body, '保留层级自带实体生成', s.autoEntities, v => mutate(() => { s.autoEntities = v; }));
  slider(body, '实体密度倍率', s.entityDensityMul, { min: 0, max: 2, step: 0.05, fmt: v => 'x' + v.toFixed(2), onInput: v => mutate(() => { s.entityDensityMul = v; }) });
  checkRow(body, '保留层级自带补给', s.autoItems, v => mutate(() => { s.autoItems = v; }));
  mk('p', 'ws-note', body, '食物与杏仁水无论如何都会刷（用户规则：所有模式都刷食物和杏仁水）。');
  slider(body, '补给密度倍率', s.itemDensityMul, { min: 0, max: 2, step: 0.05, fmt: v => 'x' + v.toFixed(2), onInput: v => mutate(() => { s.itemDensityMul = v; }) });
  mk('div', 'ws-sep', body);
  slider(body, 'San 掉落倍率', s.sanityDrainMul, { min: 0, max: 3, step: 0.05, fmt: v => 'x' + v.toFixed(2), onInput: v => mutate(() => { s.sanityDrainMul = v; }) });
  slider(body, '饥饿掉落倍率', s.hungerDrainMul, { min: 0, max: 3, step: 0.05, fmt: v => 'x' + v.toFixed(2), onInput: v => mutate(() => { s.hungerDrainMul = v; }) });
  slider(body, '放置实体默认触发距离', s.triggerRadius, { min: 3, max: 60, step: 1, fmt: v => Math.round(v) + ' m', onInput: v => mutate(() => { s.triggerRadius = v; }) });
}

// =====================================================================
// 3D 预览（第一人称走动，Esc 返回俯视）
// =====================================================================
function enterPreview() {
  if (S.fp) return;
  const gfx = BR.gfx;
  const canvas = gfx.renderer && gfx.renderer.domElement;
  S.fp = {
    x: S.cam.cx, z: S.cam.cz, yaw: 0, pitch: 0,
    keys: Object.create(null), canvas,
    savedFov: gfx.camera.fov, savedUp: gfx.camera.up.clone(),
  };
  gfx.camera.fov = FOV_FP; gfx.camera.up.set(0, 1, 0); gfx.camera.updateProjectionMatrix();
  S.els.stage.style.cursor = 'none';
  if (canvas && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (err) { /* 拒绝也不影响用键盘走动 */ } }
  document.addEventListener('mousemove', onFpMouseMove);
  S.fp.raf = requestAnimationFrame(fpLoop);
  toast('WASD 走动，鼠标看方向，Esc 返回俯视');
}
function exitPreview() {
  if (!S.fp) return;
  cancelAnimationFrame(S.fp.raf);
  document.removeEventListener('mousemove', onFpMouseMove);
  if (document.exitPointerLock) document.exitPointerLock();
  const gfx = BR.gfx;
  gfx.camera.fov = S.fp.savedFov; gfx.camera.up.copy(S.fp.savedUp); gfx.camera.updateProjectionMatrix();
  S.els.stage.style.cursor = '';
  S.fp = null;
  applyCamera(); redrawOverlay();
}
function onFpKeydown(e) {
  if (e.key === 'Escape') { exitPreview(); return; }
  if (S.fp) S.fp.keys[e.key.toLowerCase()] = true;
}
function onFpKeyup(e) { if (S.fp) S.fp.keys[e.key.toLowerCase()] = false; }
function onFpMouseMove(e) {
  if (!S.fp) return;
  const sens = 0.0022;
  S.fp.yaw -= (e.movementX || 0) * sens;
  S.fp.pitch = clamp(S.fp.pitch - (e.movementY || 0) * sens, -1.3, 1.3);
}
let fpLastT = 0;
function fpLoop(t) {
  if (!S.fp) return;
  const dt = fpLastT ? Math.min(0.05, (t - fpLastT) / 1000) : 0;
  fpLastT = t;
  stepFp(dt);
  S.fp.raf = requestAnimationFrame(fpLoop);
}
function stepFp(dt) {
  const fp = S.fp, PC = BR.config.player;
  const k = fp.keys;
  let mx = 0, mz = 0;
  if (k.w) mz -= 1; if (k.s) mz += 1; if (k.a) mx -= 1; if (k.d) mx += 1;
  const mag = Math.hypot(mx, mz);
  if (mag > 0) { mx /= mag; mz /= mag; }
  const sp = PC.walk;
  const s = Math.sin(fp.yaw), c = Math.cos(fp.yaw);
  const wx = (c * mx - s * mz) * sp * dt, wz = (-s * mx - c * mz) * sp * dt;
  if (wx || wz) {
    if (has(BR.phys, 'moveCircle')) {
      const feetY = has(BR.phys, 'groundY') ? BR.phys.groundY(fp.x, fp.z) : 0;
      const r = BR.phys.moveCircle(fp.x, fp.z, PC.radius, wx, wz, feetY, PC.height);
      if (r) { fp.x = num(r.x, fp.x); fp.z = num(r.z, fp.z); }
    } else { fp.x += wx; fp.z += wz; }
  }
  const gy = has(BR.phys, 'groundY') ? BR.phys.groundY(fp.x, fp.z) : 0;
  const gfx = BR.gfx;
  gfx.camera.position.set(fp.x, gy + PC.eyeHeight, fp.z);
  gfx.camera.up.set(0, 1, 0);
  gfx.camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
}
document.addEventListener('keyup', onFpKeyup);

// =====================================================================
// 保存 / 出生点被围死检测
// =====================================================================
function isSpawnSealed() {
  const p = BR.player, PC = BR.config.player;
  if (!p || !has(BR.phys, 'moveCircle') || !has(BR.phys, 'groundY')) return false;
  const feetY = BR.phys.groundY(p.x, p.z);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const r = BR.phys.moveCircle(p.x, p.z, PC.radius, dx * 1.4, dz * 1.4, feetY, PC.height);
    if (r && Math.hypot(num(r.x, p.x) - p.x, num(r.z, p.z) - p.z) > 0.12) return false;
  }
  return true;
}

function doSave() {
  const proceed = () => {
    const r = BR.workshop.save(S.map);
    if (!r.ok) { toast(r.error || '保存失败'); return; }
    S.savedSnapshot = snapshotOf(S.map);
    S.isNewMap = false;
    S.lastSaveStats = mapStatCounts(S.map);
    closeScene();
    openInfoCard(S.map, S.lastSaveStats);
  };
  if (isSpawnSealed()) {
    confirmDialog({ title: '出生点被围死', body: '出生点周围没有可以走出去的方向，仍然允许保存，但游玩时玩家可能被困住。要继续保存吗？', okText: '仍然保存' })
      .then(ok => { if (ok) proceed(); });
  } else proceed();
}

// =====================================================================
// 保存后信息卡 + 模式选择
// =====================================================================
function buildInfoCard() {
  const modal = mk('div', 'ws-modal', S.root);
  modal.hidden = true;
  const backdrop = mk('div', 'ws-backdrop', modal);
  const panel = mk('div', 'ws-panel', modal);
  const head = mk('div', 'ws-head', panel);
  mk('div', 'ws-title', head, '地图已保存');
  const closeBtn = button('ws-close', head, '×');
  const body = mk('div', 'ws-body', panel);
  const name = mk('div', 'ws-card-name', body);
  const meta = mk('div', 'ws-card-meta', body);
  const stats = mk('div', 'ws-info-stats', body);
  const modeList = mk('div', 'ws-mode-list', body);
  const diffRow = mk('div', 'ws-diff-row', body); diffRow.hidden = true;
  const coopRow = mk('div', 'ws-coop-row', body); coopRow.hidden = true;

  backdrop.addEventListener('click', () => { switchView('list'); renderList(); });
  closeBtn.addEventListener('click', () => { switchView('list'); renderList(); });

  const backActions = mk('div', 'ws-actions-row', panel);
  const editAgainBtn = button('ws-btn', backActions, '继续编辑');
  editAgainBtn.addEventListener('click', () => openEditor(S.map, false));
  const backBtn = button('ws-btn', backActions, '返回列表');
  backBtn.addEventListener('click', () => { switchView('list'); renderList(); });

  S.els.info = modal;
  S.els.infoName = name; S.els.infoMeta = meta; S.els.infoStats = stats;
  S.els.infoModeList = modeList; S.els.infoDiffRow = diffRow; S.els.infoCoopRow = coopRow;
}

function openInfoCard(map, stats) {
  S.map = map;
  S.els.infoName.textContent = map.name || '我的后室';
  S.els.infoMeta.textContent = levelZh(map.baseLevel);
  S.els.infoStats.innerHTML = '';
  mk('span', null, S.els.infoStats, '墙改动 ' + stats.walls);
  mk('span', null, S.els.infoStats, '实体 ' + stats.entities);
  mk('span', null, S.els.infoStats, '出口改动 ' + stats.exits);

  const modeList = S.els.infoModeList; modeList.innerHTML = '';
  const diffRow = S.els.infoDiffRow; diffRow.hidden = true; diffRow.innerHTML = '';
  const coopRow = S.els.infoCoopRow; coopRow.hidden = true; coopRow.innerHTML = '';

  const casualBtn = mk('button', 'ws-mode-btn', modeList);
  casualBtn.type = 'button';
  mk('div', 'ws-mode-btn-title', casualBtn, '游玩');
  mk('div', 'ws-mode-btn-sub', casualBtn, '实体不攻击玩家，可联机');
  casualBtn.addEventListener('click', () => launchMap('casual', null));

  const nightmareBtn = mk('button', 'ws-mode-btn', modeList);
  nightmareBtn.type = 'button';
  mk('div', 'ws-mode-btn-title', nightmareBtn, '噩梦生存');
  mk('div', 'ws-mode-btn-sub', nightmareBtn, '实体攻击玩家，有饥饿与 san 值');
  nightmareBtn.addEventListener('click', () => {
    diffRow.hidden = !diffRow.hidden;
    if (!diffRow.hidden && !diffRow.childElementCount) {
      for (const d of (BR.MODES.nightmare.difficulties || [])) {
        const b = button('ws-btn', diffRow, d.zh);
        b.addEventListener('click', () => launchMap('nightmare', d.key));
      }
    }
  });

  const testBtn = mk('button', 'ws-mode-btn', modeList);
  testBtn.type = 'button';
  mk('div', 'ws-mode-btn-title', testBtn, '测试模式');
  mk('div', 'ws-mode-btn-sub', testBtn, '不自动生成实体，放置实体依旧会刷');
  testBtn.addEventListener('click', () => launchMap('test', null));

  coopRow.hidden = false;
  const coopBtn = button('ws-btn', coopRow, '联机');
  const coopStatus = mk('span', 'ws-coop-status', coopRow);
  const ok = !!(BR.coop && has(BR.coop, 'openLobby'));
  coopBtn.disabled = !ok;
  coopBtn.addEventListener('click', () => { if (ok) BR.coop.openLobby(); });
  coopStatus.textContent = ok && BR.coop.active ? ('已联机 · ' + (BR.coop.role === 'host' ? '你是房主' : '你是客机')) : '';

  switchView('info');
}

function launchMap(mode, difficulty) {
  if (has(BR.input, 'lock')) { try { BR.input.lock(); } catch (err) { /* 锁不上就退化成拖动视角，不阻塞开局 */ } }
  const settings = BR.game.settings || (BR.game.settings = {});
  const coop = mode === 'casual' && BR.coop && BR.coop.active ? { role: BR.coop.role } : null;
  const payload = {
    mode, difficulty: difficulty || null,
    settings: Object.assign({}, settings),
    seed: S.map.seed, workshop: S.map.id, coop,
  };
  if (S.root) S.root.hidden = true;
  BR.bus.emit('game:start', payload);
}

// 真的开局了（不管是不是从这里点的）就把工坊面板收起来，避免叠在 HUD 上面
BR.bus.on('game:start', () => { if (S.root) S.root.hidden = true; });

// =====================================================================
BR.workshopUI = {
  open, close,
  get isOpen() { return !!S.root && !S.root.hidden; },
};
})();
