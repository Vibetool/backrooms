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
};

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

function onGameStart(payload) {
  const p = payload || {};
  const g = BR.game;
  const mode = BR.MODES[p.mode] ? p.mode : 'casual';
  const M = BR.MODES[mode];

  // 原地合并而不是换新对象：hud 的能见度滑条、gfx 每帧都按引用读 BR.game.settings
  if (!g.settings || typeof g.settings !== 'object') g.settings = {};
  Object.assign(g.settings, p.settings || {});
  const settings = g.settings;

  let difficulty = null;
  if (mode === 'nightmare') {
    const list = M.difficulties || [];
    difficulty = list.some(d => d.key === p.difficulty) ? p.difficulty : (list[0] && list[0].key);
  }
  // 联机客机必须用房主给的种子，不能重新随机，否则两边世界不一样
  const seed = typeof p.seed === 'number' && isFinite(p.seed) ? p.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  const levelId = pickLevel(p, settings);

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
  // world / entities / hud / death / testmode 各自也监听了 game:home，这里再显式调一遍，
  // 保证不管脚本注册顺序如何，回到主页时场景和界面都是干净的
  safe('world', 'clear');
  safe('entities', 'clear');
  safe('items', 'clear');
  safe('effects', 'clear');   // 物品时效效果（js/items/_effects.js）：回主页时加速、毒发、画面效果都要停
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
  if (S.auto) tick(dt, true);
  else safe('gfx', 'render', 0);
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
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  window.addEventListener('touchend', unlockAudio, true);

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
