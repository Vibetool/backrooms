// 后室 · 集成：启动顺序、状态机（home / loading / playing / paused / dead）、主循环、调试钩子
// 经典 <script>，只往 window.BR 上挂东西；另挂 window.__br 给冒烟测试用（后台标签页 rAF 被节流时手动推进）
(function () {
'use strict';
const BR = window.BR;

const MAX_DT = 0.1;          // 切后台回来的超长帧：一步跳完会穿墙、瞬间饿一大截
const STEP_DT = 1 / 30;      // __br.step 的步长，和中端手机 30fps 同量级，碰撞子步不被放大

const S = {
  booted: false,
  raf: 0,
  last: 0,
  auto: true,                // false：rAF 只渲染不推进逻辑，测试用 step 精确推进
  failed: new Set(),         // 同一个模块函数只报一次错，免得每帧刷屏
  frames: 0,
  lastRender: 0,             // 上一次 rAF 渲染的时刻（ms）：单机暂停/结算时按它降帧
  landscapeHinted: false,
};

const PAUSED_RENDER_MS = 250;   // 单机暂停/结算画面是静止的，4 次/秒足够，省电省发热
const CTX_TIMEOUT_MS = 3000;    // WebGL 上下文丢失后前台等这么久还没恢复，就提示刷新
const LANDSCAPE_HINT_KEY = 'backrooms_landscape_hint';

function has(o, f) { return !!o && typeof o[f] === 'function'; }

// 某个模块抛错不能把整个主循环带崩：记一次日志，其余模块照常跑
function safe(mod, fn, a, b) {
  const m = BR[mod];
  if (!has(m, fn)) return undefined;
  try { return m[fn](a, b); }
  catch (err) {
    const k = mod + '.' + fn;
    if (!S.failed.has(k)) { S.failed.add(k); console.error('[main] ' + k + ' 出错', err); }
    return undefined;
  }
}

function setInput(on) { if (BR.input) BR.input.enabled = !!on; }

// ---------- 启动失败提示 ----------
function fatal(title, err) {
  console.error('[main] ' + title, err);
  const host = document.getElementById('ui') || document.body;
  const box = document.createElement('div');
  box.className = 'boot-error';
  const card = document.createElement('div');
  card.className = 'boot-error-card';
  const h = document.createElement('p');
  h.className = 'boot-error-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = '请换用新版 Chrome / Safari / 微信内置浏览器，或在系统设置里打开硬件加速后刷新。';
  const d = document.createElement('div');
  d.className = 'boot-error-detail';
  d.textContent = String((err && err.message) || err || '');
  card.appendChild(h); card.appendChild(p); card.appendChild(d);
  box.appendChild(card);
  host.appendChild(box);
}

// ---------- 音频解锁 ----------
// WebAudio 必须在用户手势里 resume；主页只在「游玩」按钮上解锁，这里兜住其他所有第一次点击/按键/触摸
function unlockAudio() {
  const A = BR.audio;
  if (!has(A, 'unlock')) return;
  if (A.unlocked) {
    // 解锁之后 audio.js 自己常驻手势监听处理 iOS interrupted / 切后台恢复
    window.removeEventListener('pointerdown', unlockAudio, true);
    window.removeEventListener('keydown', unlockAudio, true);
    window.removeEventListener('touchend', unlockAudio, true);
    return;
  }
  try {
    const p = A.unlock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) { /* 下次手势再试 */ }
}

// ---------- 游戏内返回键 ----------
// 开局压一条 { brGame: 1 } 历史：安卓返回键 / iOS 左缘右滑 / 微信返回先退掉这一条，页面不离开，改成打开暂停菜单。
// 坑：从主页弹层开局时 home.hide() 会 history.go(-n) 退弹层历史，那次 popstate 在 game:start 之后才到，
// 不能当成返回键（否则每次开局都直接进暂停），要等它落地再压
const H = { armed: false, pending: false, timer: 0 };

function live() {
  const s = BR.game.screen;
  return s === 'playing' || s === 'paused' || s === 'dead';
}

function pushGameEntry() {
  try { history.pushState({ brGame: 1 }, ''); H.armed = true; } catch (err) { /* file:// 或沙箱不让改历史：返回键照旧离开页面 */ }
}

function armHistory() {
  if (H.armed) return;
  let hs = null;
  try { hs = history.state; } catch (err) { hs = null; }
  // brHome > 0：主页弹层刚被收起，退栈还没落地。{ brHome: 0, brPanel } 这类面板状态不会触发 go(-n)，直接压
  if (hs && typeof hs.brHome === 'number' && hs.brHome > 0) {
    H.pending = true;
    clearTimeout(H.timer);
    // 兜底：有的内核 history.go 不发 popstate，1 秒后还没等到就直接压
    H.timer = setTimeout(() => { H.timer = 0; if (H.pending && live()) pushGameEntry(); }, 1000);
    return;
  }
  pushGameEntry();
}

function onPopState(e) {
  if (H.pending) {
    // home.hide() 自己退弹层历史的那一次，不是返回键：不暂停，只保证当前停在哨兵上。
    // 1 秒兜底已经压过、这次才迟到（或 go(-n) 根本没发 popstate、这次其实是返回键）时也照样补压
    H.pending = false;
    clearTimeout(H.timer);
    H.timer = 0;
    if (live() && !(e.state && e.state.brGame)) pushGameEntry();
    return;
  }
  if (!H.armed || (e.state && e.state.brGame)) return;
  // 返回键退掉了开局压的那条：补回去，页面留住
  H.armed = false;
  if (live()) pushGameEntry();
  if (BR.game.screen !== 'playing') return;
  // 测试面板开着时和 Esc 一样先关面板；否则暂停，免得面板和暂停菜单叠在一起、继续后面板还开着就能走动
  if (BR.test && BR.test.isOpen) safe('test', 'close');
  else safe('hud', 'pause', true);
}

// 竖屏开局提示一次（本次会话内）：竖屏水平视野窄，gfx 已把竖直视野放大，但横屏仍然看得更开
function hintLandscape() {
  if (S.landscapeHinted || !(BR.input && BR.input.isTouch) || !(window.innerHeight > window.innerWidth)) return;
  S.landscapeHinted = true;
  try {
    if (window.sessionStorage.getItem(LANDSCAPE_HINT_KEY)) return;
    window.sessionStorage.setItem(LANDSCAPE_HINT_KEY, '1');
  } catch (err) { /* 隐私模式读写不了存储：本页只提示一次 */ }
  safe('hud', 'toast', '横屏游玩视野更开阔', 3500);
}

// ---------- WebGL 上下文丢失 ----------
// iOS 切后台回收显存、驱动重置时会丢上下文：画面全黑但 HUD 照常，单机世界还在跑。
// 丢失时暂停并挂提示；只在前台计时（手机常常回到前台才补发 restored），超时才让玩家刷新
const C = { lost: false, failed: false, timer: 0, box: null, text: null, btn: null };

function ctxIsLost() {
  const r = BR.gfx && BR.gfx.renderer;
  try { return !!(r && r.getContext().isContextLost()); } catch (err) { return false; }
}

function renderCtxBox() {
  if (!C.box) {
    const box = document.createElement('div');
    box.className = 'ctx-lost';
    box.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.className = 'ctx-lost-text';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-lost-btn';
    btn.textContent = '刷新页面';
    btn.addEventListener('click', () => location.reload());
    box.appendChild(text);
    box.appendChild(btn);
    C.box = box; C.text = text; C.btn = btn;
  }
  C.text.textContent = C.failed ? '画面没能恢复，请刷新页面继续' : '画面暂时丢失，正在恢复…';
  C.btn.hidden = !C.failed;
  if (!C.box.parentNode) (document.getElementById('ui') || document.body).appendChild(C.box);
}

function stopCtxTimer() {
  clearTimeout(C.timer);
  C.timer = 0;
}

function armCtxTimer() {
  stopCtxTimer();
  if (!C.lost || C.failed || document.hidden) return;
  C.timer = setTimeout(() => {
    C.timer = 0;
    if (!C.lost) return;
    if (!ctxIsLost()) { onContextRestored(); return; }   // 已恢复但 restored 没发到：按恢复处理
    C.failed = true;
    renderCtxBox();
  }, CTX_TIMEOUT_MS);
}

function onContextLost() {
  C.lost = true;
  C.failed = false;
  if (BR.game.screen === 'playing') safe('hud', 'pause', true);
  renderCtxBox();
  armCtxTimer();
}

function onContextRestored() {
  const was = C.lost;
  C.lost = false;
  C.failed = false;
  stopCtxTimer();
  if (C.box && C.box.parentNode) C.box.parentNode.removeChild(C.box);
  if (was) safe('hud', 'toast', '画面已恢复');
}

// ---------- 状态切换 ----------
function pickLevel(p, settings) {
  const want = p.levelId != null ? String(p.levelId) : String(settings.startLevel);
  if (BR.levels.has(want)) return want;
  if (BR.levels.has('dev')) return 'dev';
  const order = BR.LEVEL_ORDER || [];
  for (let i = 0; i < order.length; i++) if (BR.levels.has(order[i])) return String(order[i]);
  const all = BR.levels.all();
  return all.length ? String(all[0].id) : want;
}

// payload.workshop：mapId（本机地图，字符串）或联机客机收到的地图对象（不查本机存储）。
// 没有就返回 null——主页正常开局的路径完全不变
function resolveWorkshopMap(p) {
  if (p.workshop == null) return null;
  if (typeof p.workshop === 'string') return has(BR.workshop, 'get') ? BR.workshop.get(p.workshop) : null;
  return typeof p.workshop === 'object' ? p.workshop : null;
}

function onGameStart(payload) {
  const p = payload || {};
  const g = BR.game;
  const mode = BR.MODES[p.mode] ? p.mode : 'casual';
  const M = BR.MODES[mode];
  const wsMap = resolveWorkshopMap(p);

  // 原地合并而不是换新对象：hud 的能见度滑条、gfx 每帧都按引用读 BR.game.settings
  if (!g.settings || typeof g.settings !== 'object') g.settings = {};
  Object.assign(g.settings, p.settings || {});
  const settings = g.settings;

  let difficulty = null;
  if (mode === 'nightmare') {
    const list = M.difficulties || [];
    difficulty = list.some(d => d.key === p.difficulty) ? p.difficulty : (list[0] && list[0].key);
  }
  // 联机客机必须用房主给的种子，不能重新随机，否则两边世界不一样；工坊地图种子/层级定死，覆盖掉随机种子和主页选的层
  const seed = wsMap ? (wsMap.seed >>> 0)
    : typeof p.seed === 'number' && isFinite(p.seed) ? p.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  const levelId = wsMap ? String(wsMap.baseLevel) : pickLevel(p, settings);
  // 先激活/停用工坊地图，world.start 之前——world.js 的 spawnOverride/envOverride 等钩子读的是 BR.workshop.active
  if (wsMap) safe('workshop', 'activate', wsMap, { editing: false });
  else safe('workshop', 'deactivate');

  g.mode = mode;
  g.difficulty = difficulty;
  g.spawnFactor = BR.computeSpawnFactor(mode, difficulty, settings.spawnSlider);
  g.attackPlayers = !!M.attackPlayers;
  g.statsEnabled = !!M.statsEnabled;
  g.autoSpawn = M.autoSpawn !== false;
  g.seed = seed;
  g.time = 0;
  g.deaths = 0;
  g.deepest = levelId;   // world 只会往更深的层更新它；从 dev 开局时结算页不该显示没到过的 Level 0
  g.coop = p.coop && M.coop ? { active: true, role: p.coop.role || null } : { active: false, role: null };
  if (BR.skin && BR.skin.current) g.skin = BR.skin.current;
  g.screen = 'loading';

  setInput(false);
  safe('death', 'hide');
  safe('home', 'hide');
  if (BR.gfx && settings.quality && BR.gfx.quality !== settings.quality) safe('gfx', 'setQuality', settings.quality);

  try {
    // start 内部同步建完出生点周围区块（Promise 执行器同步运行），返回时玩家已落地
    const r = BR.world.start(levelId, seed);
    if (r && typeof r.catch === 'function') r.catch(err => console.error('[main] 载入层级失败', levelId, err));
  } catch (err) {
    console.error('[main] 载入层级失败', levelId, err);
    safe('hud', 'toast', '载入层级失败：' + levelId, 4000);
    BR.bus.emit('game:home');
    return;
  }

  safe('hud', 'show', true);
  g.screen = 'playing';
  setInput(true);
  armHistory();
  hintLandscape();
}

function onPlayerDeath(p) {
  const g = BR.game;
  setInput(false);
  g.deaths = (g.deaths | 0) + 1;
  safe('death', 'show', {
    cause: p && p.cause,
    levelId: (p && p.levelId) || g.levelId,
    time: g.time,
    deepest: g.deepest,
  });
}

function onDeathContinue() {
  // death.js 在 emit 之前已经把 screen / 输入还原并会在点击栈里请求指针锁定；这里补齐第 2 节的原地重生
  safe('death', 'hide');
  safe('player', 'respawnInPlace');
  const g = BR.game;
  if (g.screen === 'dead' || g.screen === 'loading') g.screen = 'playing';
  if (g.screen === 'playing') setInput(true);
}

function onGameHome() {
  // 开局压的那条返回键历史退掉，回到主页后返回键和没开过局一样；退回来的那次 popstate armed 已清，不会当成返回键
  if (H.armed) {
    H.armed = false;
    try { if (history.state && history.state.brGame) history.back(); } catch (err) { /* 忽略 */ }
  }
  // world / entities / hud / death / testmode 各自也监听了 game:home，这里再显式调一遍，
  // 保证不管脚本注册顺序如何，回到主页时场景和界面都是干净的
  safe('world', 'clear');
  safe('entities', 'clear');
  safe('items', 'clear');
  safe('effects', 'clear');   // 物品时效效果（js/items/_effects.js）：回主页时加速、毒发、画面效果都要停
  safe('workshop', 'deactivate');
  safe('hud', 'show', false);
  safe('death', 'hide');
  safe('test', 'close');
  setInput(false);
  BR.game.screen = 'home';   // 先切 screen：home.show 立即摆一次镜头，screen 不是 home 时它不写相机
  safe('home', 'show');
}

function onVisibility() {
  // 切到后台：单机世界要停下来，回来时停在暂停菜单而不是已经被咬死
  if (document.hidden && BR.game.screen === 'playing') safe('hud', 'pause', true);
  // 上下文丢失的恢复计时只在前台走：切后台先停，回到前台还没恢复就重新计时
  if (C.lost) {
    if (document.hidden) stopCtxTimer();
    else if (ctxIsLost()) armCtxTimer();
  }
}

// ---------- 主循环 ----------
function tick(dt, render) {
  const g = BR.game;
  const inp = BR.input;
  S.frames++;

  // Esc：游玩中打开暂停；暂停中再按一次继续。测试面板开着时 Esc 由 testmode 自己关面板
  if (inp && has(inp, 'pressed') && inp.pressed('pause')) {
    if (g.screen === 'playing' && !(BR.test && BR.test.isOpen)) safe('hud', 'pause', true);
    else if (g.screen === 'paused') safe('hud', 'pause', false);
  }

  const screen = g.screen;
  const coopLive = !!(BR.coop && BR.coop.active);
  // 联机时暂停/结算不停世界：房主那边还在跑，客机要继续收实体快照、看得到队友
  const simulate = screen === 'playing' || (coopLive && (screen === 'paused' || screen === 'dead'));

  if (screen === 'playing') g.time += dt;
  if (simulate) {
    safe('player', 'update', dt);
    safe('world', 'update', dt);
    safe('entities', 'update', dt);
    safe('items', 'update', dt);
    safe('workshop', 'update', dt);   // 地图未激活或在编辑态时是空操作，见 js/game/workshop.js
  }
  // 联机每帧都要跑（主页大厅里建房、暂停、结算时也要收发），且必须在 endFrame 之前读 V 键
  safe('coop', 'update', dt);
  if (screen === 'playing' || screen === 'paused' || screen === 'dead') {
    safe('test', 'update', dt);
    safe('hud', 'update', dt);
  } else if (screen === 'home') {
    safe('home', 'update', dt);   // 目前 home 自带 rAF，没导出 update；以后导出了就由这里驱动
  }
  if (render) safe('gfx', 'render', dt);
  if (inp && has(inp, 'endFrame')) inp.endFrame();
}

function loop(now) {
  S.raf = requestAnimationFrame(loop);
  const dt = S.last ? Math.min(MAX_DT, Math.max(0, (now - S.last) / 1000)) : 0;
  S.last = now;
  // 只降渲染不降逻辑：tick 照常每帧跑（Esc 继续、测试面板、input.endFrame 都靠它）。
  // 联机时暂停/结算不停世界，照常满帧
  const g = BR.game;
  const stat = (g.screen === 'paused' || g.screen === 'dead') && !(BR.coop && BR.coop.active);
  const doRender = !stat || now - (S.lastRender || 0) >= PAUSED_RENDER_MS;
  if (S.auto) tick(dt, doRender);
  else if (doRender) safe('gfx', 'render', 0);
  if (doRender) S.lastRender = now;
}

// ---------- 启动 ----------
function boot() {
  if (S.booted) return;
  S.booted = true;
  const canvas = document.getElementById('gl');

  // 顺序是硬依赖：assets 建贴图时要读 renderer.capabilities 算 anisotropy
  try {
    BR.gfx.init(canvas);
  } catch (err) {
    fatal('无法启动 3D 渲染（WebGL 不可用）', err);
    return;
  }
  if (has(BR.assets, 'init')) {
    const ready = BR.assets.init();
    if (ready && typeof ready.catch === 'function') ready.catch(err => console.warn('[main] 素材预载失败，改用兜底', err));
  }
  safe('input', 'init', canvas);
  safe('hud', 'init');
  safe('death', 'init');
  safe('home', 'init');
  safe('coop', 'init');
  safe('test', 'init');

  // main 最后加载，这些监听排在各模块自己的监听之后：模块先清理自己，main 再做跨模块的收尾
  BR.bus.on('game:start', onGameStart);
  BR.bus.on('player:death', onPlayerDeath);
  BR.bus.on('death:continue', onDeathContinue);
  BR.bus.on('game:home', onGameHome);
  BR.bus.on('gfx:contextlost', onContextLost);
  BR.bus.on('gfx:contextrestored', onContextRestored);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  window.addEventListener('touchend', unlockAudio, true);
  // 游戏中刷新页面：历史里残留的开局哨兵清掉，免得回到主页后返回键行为错乱
  try { if (history.state && history.state.brGame) history.replaceState(null, ''); } catch (err) { /* 忽略 */ }

  BR.game.screen = 'home';
  setInput(false);
  safe('home', 'show');
  S.raf = requestAnimationFrame(loop);
}

// ---------- 调试钩子 ----------
window.__br = {
  // 手动推进 seconds 秒逻辑（按 STEP_DT 切小步），最后渲染一帧；无头浏览器 rAF 很慢或被节流时用
  step(seconds) {
    let left = Math.max(0, +seconds || 0);
    if (left <= 0) { tick(0, true); return BR.game; }
    while (left > 1e-6) {
      const dt = Math.min(STEP_DT, left);
      left -= dt;
      tick(dt, left <= 1e-6);
    }
    return BR.game;
  },
  // 直接开局（绕过主页 UI）：opts = { mode, difficulty, settings, seed, levelId }
  start(opts) {
    const o = opts || {};
    BR.bus.emit('game:start', {
      mode: o.mode || 'casual',
      difficulty: o.difficulty || null,
      settings: Object.assign({}, BR.game.settings, o.settings || {}),
      seed: typeof o.seed === 'number' ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0,
      levelId: o.levelId,
      coop: null,
    });
    return BR.game;
  },
  // false：rAF 不再推进逻辑（仍渲染），测试里用 step 精确控制时间
  setAuto(on) { S.auto = !!on; S.last = 0; return S.auto; },
  get auto() { return S.auto; },
  get state() { return BR.game; },
  get frames() { return S.frames; },
  info() {
    return {
      screen: BR.game.screen, mode: BR.game.mode, levelId: BR.game.levelId,
      world: has(BR.world, 'debugInfo') ? BR.world.debugInfo() : null,
      entities: has(BR.entities, 'debugInfo') ? BR.entities.debugInfo() : null,
      gfx: has(BR.gfx, 'debugInfo') ? BR.gfx.debugInfo() : null,
      failed: Array.from(S.failed),
    };
  },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
})();
