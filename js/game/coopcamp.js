// 后室 · 联机营地（BR.coopCamp）：营地里的帐篷门、桌上的层级地图、柱子上的制服挂钩；帐篷选单的共享选择（房主说了算）、
// 准备与倒数、灯灭出发、黑幕等人、回营地要对方同意、营地里落单；营地小黑板和桌面纸两块 CanvasTexture 网格。
// 经典 <script>，只往 window.BR 上挂东西。加载顺序：coop.js 之后、main.js 之前；选单 DOM 在 js/ui/tentmenu.js（BR.tentMenu，用到时才找）。
// 方案：2026-10-02 联机营地方案 N1-tent；协议约定见 ARCHITECTURE.md 第 9 节。
//
// 规则：
//   - 交互和画面只在 BR.game.levelId === BR.config.coop.campLevel（'coopcamp'）时工作；帐篷状态不管在不在营地都缓存最新一份（按 v 取新的）
//   - 每帧由 main.tick 调 update(dt)（暂停时也跑），自己不开 rAF 也不开定时器（只在 window 上听按键 / 指针 / 触摸，记「最后一次输入」）
//   - interact 来源 'coopTent' 出三个候选（都不用 b.fixture 登记）：帐篷门「进帐篷」（门洞盒子 1.2×2.0，射线起点在门外、≤ 2.6 m 才出）、
//     桌上的层级地图「看地图」（直接开选单）、制服挂钩「换制服 X那件」（准心对准哪件换哪件，BR.skin.set，同步走现有的 skin 消息；
//     自己、队友正穿着的那件不挂在钩上，对着那一格只说原因「这件就穿在你身上」「「X」穿着这件」）；
//     长按都只给原因：「帐篷是营地的出口，拖不动」「地图桌绑在帐篷杆上，拖不动」「挂钩钉在柱子上，拖不动」
//   - 进帐篷：人站在门前通道（b.data.coopcamp.corridor）里，或者一路 overlapCircle(0.3) 采样都空着，才自动走：关输入，0.9 s 沿
//     门外 → 门洞中线 → 站位平滑走过去（每帧 player.reset full:false），朝向转到桌子；两个站位挑离队友 > 0.8 m 的；然后开选单。否则 toast「走到门口」
//   - 出帐篷（选单里的按钮、Esc、安卓返回键——后两个由 main 先问 onBack()）：先发 'out' 再关选单，0.7 s 走到门外 1.2 m、朝外，还回输入；
//     点按钮出帐篷时在点击里调 BR.input.lock()
//   - 共享选择 state = { mode, diff, lv, ws, spawn, rdy:[房主, 客机], tin:[房主, 客机], goAt, by, chg, v, maps:[{id, name, lv}] }：
//       房主改了直接写，v + 1，BR.coop.emit('tent', state)；客机改走 BR.coop.use('coopcamp:tent', 'tent', 客机眼睛坐标, cb, {op, …})，
//       op = 'pick' {mode?, diff?, lv?, ws?, spawn?} | 'ready' {on} | 'in' | 'out' | 'cancel'，房主在 onUse('tent') 里核对后写入并广播。
//       改了选择（mode / diff / lv / ws / spawn）两边的准备都清掉，对方选单闪一下并 toast「「名字」改成了 Level 3」。
//       tin = 选单开着（算在帐篷里，出帐篷时清掉自己的准备）；by = 'h' | 'g' 最后是谁改的；chg = 改了哪一项（给对方 toast 用）
//       上一局的选择存在会话内存 last 里，回营地时房主先填好。客机进营地 emit('arrived', {lv})，房主收到就再发一次 state
//   - 出发：两人都准备好，房主写 goAt = coop.clock() + countdown（3）。两边选单大字 3、2、1，马灯每一拍暗一下。
//     goAt − 0.5 之前有人点取消、改选择、出帐篷或者断线，倒数就停、准备清空（客机的「取消」只是申请，收到房主的 campCancel 才停）；
//     最后 0.5 s 不能再取消。到 0：已载入区块（含窗外带）的灯描述强度设 0（保存原值，同 L1 的 onBlackoutStart）、gfx.applyEnv 全黑、
//     「嗡——啪」，然后 await BR.hud.curtain(文字)。房主 resolve 后 BR.coop.startRun(…)；客机等 world 消息跟进，进层后 emit('arrived')。
//     房主收到 arrived 或等满 arriveWait 秒就 emit('reveal')，两边 curtain(false)；客机来晚了进层就直接亮。
//     等人期间每帧把 BR.input.enabled 压成 false（main.onGameStart 最后会 setInput(true)）。客机黑幕 15 s 兜底，亮起来并说原因
//   - 回营地：back() 发 'campAsk'；对方横幅「「X」想回营地」同意 / 不要（askSec 秒；这段时间完全没有输入才按同意处理，
//     有输入却没回应 = 不要）。同意时房主发 'campGo'，两边黑幕「回营地」，房主 startRun(营地)，之后和出发一样等人、亮起。
//     不要：提出的一方 toast「「X」还想接着玩」。暂停菜单和结算页的「回营地」都走 back()
//   - 营地里对方走了（bus 'coop:peerGone' where 'camp'）：横幅「「X」离开了营地」——「再开一个营地等朋友」（coop.createRoomInPlace）/「回主页」
//   - 运行时网格只有两块，都用 CanvasTexture，低画质也画，离开营地时 dispose：小黑板（等人时房号 + 等朋友来；两人都在时下一站 + 准备勾）、
//     桌面纸（手画层级图、本子封面「游玩 / 噩梦 / 测试」、纸条「这间仓库没有门。灯灭的时候，就能切出去。」）
//
// 事件（BR.coop.emit，对方收到 bus 'net:'+kind）：'tent' state；'campAsk' {by, r, off?}；'campYes' {by, r}；'campNo' {by, r, auto?}；
//   'campCancel' {by, r}；'campGo' {by}；'arrived' {lv}；'reveal' {at}（r = 'h' | 'g'，发的人的角色）
// 接口：inCamp、panelOpen、state、last、update(dt)、enter(opts?)、exit()、back()、onBack() → bool、_debugSet(patch)、debugInfo()
//   enter({force:true}) 跳过「走到门口」的路径检查（测试用）；_debugSet(patch) 测试口：房主直接写（lv 可以是 'dev'），客机走同一条 use，
//   patch 还可以带 ready:true|false（自己的准备）
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 常量 ----------
const CFG_DEF = { campLevel: 'coopcamp', campMode: 'casual', countdown: 3, arriveWait: 5, askSec: 15 };
const USE_KEY = 'coopcamp:tent';
const KEY_TENT = 'coopcamp:tent', KEY_MAP = 'coopcamp:map', KEY_HOOKS = 'coopcamp:hooks';
const DOOR_REACH = 2.6;        // 射线起点离门洞中心水平这么近才出「进帐篷」
const DOOR_OUT = 0.6;          // 自动走进去时先到门外这么远的一点
const WALK_IN_S = 0.9;
const WALK_OUT_S = 0.7;
const OUT_DIST = 1.2;          // 出帐篷停在门外这么远
const STAND_FREE = 0.8;        // 站位离队友超过它才算空着
const DOOR_LANE = 0.25;        // 联机时两人各走门洞中线一侧这么远（门宽 1.2，人半径 0.3：贴门框还剩 5 cm）
const EXIT_SIDE = 0.5;         // 联机时出帐篷各停在门外中线一侧这么远（两人相距 1 m，都在门前通道 x 15.3..16.7 里）
const EXIT_FAR = 0.5;          // 门外那几个点都离队友太近时，再往外走这么远试试
const EXIT_INSIDE = 0.45;      // 队友堵在门口出不去：走到门槛里面这么远停下
const PEER_STILL = 0.4;        // 队友速度低于它（m/s）算站着不动
const PEER_SPEED_TAU = 0.15;   // 队友速度按时间平滑的时间常数（s）：停下约 0.6 s 后算站着不动，和帧率无关
const PEER_BLOCK = 0.5;        // 站着不动的队友离自动走的路线这么近就算挡路（两人半径 0.3，再近就穿身体）
const HOOKS_MS = 200;          // 挂钩上的制服多久核对一次（自己、队友身上穿的那两件藏起来）
const PATH_STEP = 0.15;        // 自动走路径的 overlapCircle 采样间隔
const PLAYER_R = 0.3;
const CANCEL_LOCK_S = 0.5;     // 倒数最后这么久不能再取消
const GUEST_DARK_MS = 15000;   // 客机黑幕兜底
const HOST_DARK_MS = 15000;    // 房主 startRun 之后一直没进层（出错）的兜底
const ASK_GRACE_MS = 5000;     // 提出回营地的一方比对方多等这么久
const SPAWN_SEND_MS = 200;     // 拖滑条时最多这么久发一次
const SNAP_DELAY_MS = 300;     // 「嗡——啪」：嗡之后多久啪
const BEAT_DIM_MS = 180;       // 倒数每一拍马灯暗这么久
const BOARD_SIG_MS = 250;      // 小黑板内容多久核对一次
const SEL_KEYS = ['mode', 'diff', 'lv', 'ws', 'spawn'];
const PAPER_FONT = '"Kaiti SC","STKaiti","KaiTi","楷体",serif';
const CHALK_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
const MONO_FONT = 'ui-monospace,Menlo,Consolas,monospace';

// ---------- 状态 ----------
const S = {
  inited: false,
  state: null,          // 当前（房主：权威；客机：缓存的最新一份）
  vSeen: 0,             // 见过的最大 v：房主写时从它 + 1，角色换了也单调
  last: null,           // 上一局的选择 { mode, diff, lv, ws, spawn }（会话内存，离开联机清）
  panel: false,         // 选单开着（算在帐篷里）
  walk: null,           // 自动走 { pts, segs, len, t, dur, y, yaw0, yaw1, kind:'in'|'out', then }
  data: null,           // 营地块的 b.data.coopcamp（世界坐标）
  out: null,            // 帐篷门朝外的单位方向 { x, z }
  board: null, paper: null,   // 两块运行时网格 { mesh, tex, canvas, sig }
  boardAt: 0,
  lantern: null,        // 马灯的灯描述（倒数每一拍暗一下）
  useOff: null, useFor: null,   // onUse 的取消函数、登记在哪个 BR.coop 上
  srcAdded: false,
  wasActive: false, roleChar: null, hadPeer: false, peerName: '',
  inputAt: 0,           // 最后一次输入（keydown / pointerdown / touchstart）
  ask: null,            // 我提出的回营地 { at, n }
  askIn: null,          // 对方提出的 { at, n, by }
  gone: null,           // 「X 离开了营地」横幅
  spawnPend: null, spawnSentAt: 0, inSentAt: 0,
  chgToast: { text: '', at: 0 },
  beat: -1, dimUntil: 0, dimOrig: null,
  dimmed: [],           // 灯灭时改过的灯 [[灯描述, 原强度]]
  envSaved: null,
  peerSpeed: 0, peerPrev: null,   // 队友（插值后的人形）水平速度，判断「站着挡路」用
  lockNote: null, lockOff: null,  // 「点一下画面继续」横幅
  uni: null, uniVis: null, uniAt: 0, uniSig: '',   // 挂钩上六件制服的几何件（层级 b.data._uniforms，{皮肤 key: [Piece]}）、当前显隐
  bagNote: '',          // 回营地时背包里有东西：到营地后说一声（非空 = 要说）
};
// 出发 / 回营地的过场：phase 'idle' | 'dark'（黑幕落下中）| 'wait'（全黑，等进层、等人）
const G = { phase: 'idle', kind: '', text: '', token: 0, t0: 0, host: false, entered: false, enterAt: 0, arrived: false, revealed: false, lit: false, snapAt: 0, dest: null };

// ---------- 小工具 ----------
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function cfg(k) {
  const c = BR.config && BR.config.coop;
  const v = c && c[k];
  return v !== undefined && v !== null ? v : CFG_DEF[k];
}
function campId() { return String(cfg('campLevel')); }
function toast(t, ms) { if (t && has(BR.hud, 'toast')) BR.hud.toast(t, ms || 2200); }
// 回营地这几句是玩家按了「回营地」以后要看到的答复：暂停菜单、死亡结算盖着时 toast 整组藏起来（.hud-toasts-modal），
// 这时改走横幅（z 65，暂停 / 结算上面也看得见），没有按钮、到时自己关
function say(t, ms) {
  if (!t) return;
  const modal = !!(BR.player && BR.player.dead) || BR.game.screen === 'dead' || BR.game.screen === 'paused';
  if (modal && has(BR.hud, 'notice')) { try { BR.hud.notice(t, [], ms || 2600); return; } catch (err) { /* 退回 toast */ } }
  toast(t, ms);
}
function sound(name, opts) { if (has(BR.audio, 'play')) { try { BR.audio.play(name, undefined, opts); } catch (err) { /* 没声音不碍事 */ } } }
function active() { return !!(BR.coop && BR.coop.active); }
// 自己是不是说了算的那一方：没连着（一个人等朋友、队友走了）也算
function isHost() { return !active() || BR.coop.role !== 'guest'; }
function meIdx() { return isHost() ? 0 : 1; }
function myChar() { return isHost() ? 'h' : 'g'; }
function myName() { return (BR.net && BR.net.myName) || '我'; }
function peerName() { return (BR.coop && BR.coop.peerName) || S.peerName || '队友'; }
function clock() {
  if (has(BR.coop, 'clock')) { const c = +BR.coop.clock(); if (isFinite(c)) return c; }
  return nowMs() / 1000;
}
function inWorld() { const s = BR.game.screen; return s === 'playing' || s === 'paused' || s === 'dead'; }
function inCamp() { return inWorld() && String(BR.game.levelId) === campId() && !!(BR.world && BR.world.current); }
function eyeH() { return num(BR.config.player && BR.config.player.eyeHeight, 1.62); }
function feetY() { return BR.player ? num(BR.player.y, eyeH()) - eyeH() : 0; }
function groundY(x, z, d) {
  if (!has(BR.phys, 'groundY')) return d;
  const g = +BR.phys.groundY(x, z);
  return isFinite(g) ? g : d;
}
function smooth(k) { k = U.clamp(k, 0, 1); return k * k * (3 - 2 * k); }
// 角度规整到 [-π, π)：用取模，不用 while 减 2π（玩家 yaw 不封顶，转了很多圈或者是 Infinity 时 while 会转很久甚至卡死）
function wrapA(a) {
  if (!isFinite(a)) return 0;
  const T = 2 * Math.PI;
  return ((a + Math.PI) % T + T) % T - Math.PI;
}
// yaw：0 面朝 -Z，前 = (-sin, -cos)
function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
function inRect(p, r) { return !!r && p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.z >= Math.min(r.z0, r.z1) && p.z <= Math.max(r.z0, r.z1); }
function same(a, b) { return a === b || (a == null && b == null); }
function setInput(on) { if (BR.input) BR.input.enabled = !!on; }

// ---------- 文字 ----------
function modeRow(m) {
  const t = BR.home && Array.isArray(BR.home.modeText) ? BR.home.modeText : null;
  if (t) for (const r of t) if (r[0] === m) return r;
  const M = BR.MODES && BR.MODES[m];
  return [m, M ? M.zh : m, ''];
}
function modeName(m) { return modeRow(m)[1]; }
function diffName(d) {
  const list = (BR.MODES.nightmare && BR.MODES.nightmare.difficulties) || [];
  const x = list.find(q => q.key === d);
  return x ? x.zh : '';
}
function lvName(id) {
  const def = BR.levels && BR.levels.get(id);
  return def ? def.name : 'Level ' + id;
}
function modeLabel(st) {
  if (st.mode === 'nightmare') { const d = diffName(st.diff); return modeName('nightmare') + (d ? ' · ' + d : ''); }
  return modeName(st.mode);
}
// 黑幕上的字：「Level 3 · 噩梦生存 · 困难」；选 Level 1 写「Level 1 · 走出营地」；工坊地图写「「地图名」 · 游玩」
function runText(st) {
  const m = st.ws ? findMap(st, st.ws) : null;
  if (m) return '「' + m.name + '」 · ' + modeLabel(st);
  if (String(st.lv) === '1') return lvName('1') + ' · 走出营地';
  return lvName(st.lv) + ' · ' + modeLabel(st);
}
function chgText(st, chg, name) {
  const who = '「' + name + '」';
  switch (chg) {
    case 'lv': return who + '改成了 ' + lvName(st.lv);
    case 'mode': return who + '改成了 ' + modeName(st.mode);
    case 'diff': return who + '改成了 ' + (diffName(st.diff) || '没选难度');
    case 'spawn': return who + '把实体生成量改成了 ' + Math.round(num(st.spawn, 0) * 100) + '%';
    case 'ws': { const m = st.ws ? findMap(st, st.ws) : null; return m ? who + '选了地图「' + m.name + '」' : who + '不用地图了'; }
  }
  return '';
}
function fmtCode(c) {
  const s = String(c || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return s.length === 6 ? s.slice(0, 3) + ' ' + s.slice(3) : s;
}

// ---------- 层级与模式 ----------
function levelIds() { return (BR.LEVEL_ORDER || []).map(String).filter(id => BR.levels && BR.levels.has(id)); }
// 两边都有的层（没连着时 null = 只看自己）
function onlySet() {
  if (!active()) return null;
  const pl = BR.coop.peerLevels;
  return Array.isArray(pl) ? new Set(pl.map(String)) : null;
}
function devUrl() { try { return new URLSearchParams(location.search).has('dev'); } catch (err) { return false; } }
function lvOk(lv, dbg) {
  lv = String(lv);
  if (!BR.levels || !BR.levels.has(lv)) return false;
  const def = BR.levels.get(lv);
  if (def && (def.hidden || def.lobby)) return false;
  if (lv === 'dev') return !!dbg || devUrl();
  if (levelIds().indexOf(lv) < 0) return !!dbg;
  const only = onlySet();
  return !only || only.has(lv) || !!dbg;
}
function modeAvail(m) {
  const M = BR.MODES && BR.MODES[m];
  if (!M) return { ok: false, why: '没有这个模式' };
  if (!M.coop) return { ok: false, why: m === 'nightmare' ? '两个人一起玩噩梦还在做，下一步就开放' : '这个模式还不能两人一起玩' };
  if (m === 'nightmare' && active() && has(BR.coop, 'can') && !BR.coop.can('nm1')) return { ok: false, why: '队友的游戏版本旧' };
  return { ok: true, why: '' };
}
function defaultLv() {
  const s = BR.game.settings || {};
  const ids = levelIds();
  if (s.startLevel != null && ids.indexOf(String(s.startLevel)) >= 0) return String(s.startLevel);
  if (ids.indexOf('0') >= 0) return '0';
  return ids[0] || 'dev';
}
// 房主自己的工坊地图（最近改过的在前，最多 20 张）
function hostMaps() {
  const W = BR.workshop;
  if (!has(W, 'list')) return [];
  let list = [];
  try { list = W.list() || []; } catch (err) { list = []; }
  const out = [];
  for (const m of list) {
    if (!m || m.id == null || m.baseLevel == null) continue;
    out.push({ id: String(m.id), name: String(m.name || '我的后室').slice(0, 24), lv: String(m.baseLevel) });
    if (out.length >= 20) break;
  }
  return out;
}
function findMap(st, id) {
  const ms = st && Array.isArray(st.maps) ? st.maps : [];
  for (const m of ms) if (m && m.id === String(id)) return m;
  return null;
}
// 这一局真正去的层（选了地图就是地图的底层）
function runLv(st) {
  const m = st.ws ? findMap(st, st.ws) : null;
  return m ? m.lv : String(st.lv);
}
function diffOk(d) {
  const list = (BR.MODES.nightmare && BR.MODES.nightmare.difficulties) || [];
  return list.some(x => x.key === d);
}

// ---------- 状态 ----------
function freshState() {
  const L = S.last || {};
  const s = BR.game.settings || {};
  const maps = hostMaps();
  const st = {
    mode: L.mode && modeAvail(L.mode).ok ? L.mode : 'casual',
    diff: L.diff && diffOk(L.diff) ? L.diff : null,
    lv: L.lv && lvOk(L.lv) ? String(L.lv) : defaultLv(),
    ws: null,
    spawn: U.clamp(num(L.spawn, num(s.spawnSlider, 1)), 0, 1),
    rdy: [false, false], tin: [false, false],
    goAt: 0, by: null, chg: null, v: 0, maps,
  };
  if (L.ws && maps.some(m => m.id === L.ws)) st.ws = L.ws;
  return st;
}
function copyState(st) {
  return {
    mode: st.mode, diff: st.diff, lv: st.lv, ws: st.ws, spawn: st.spawn,
    rdy: [!!st.rdy[0], !!st.rdy[1]], tin: [!!st.tin[0], !!st.tin[1]],
    goAt: st.goAt, by: st.by, chg: st.chg, v: st.v,
    maps: (st.maps || []).map(m => ({ id: m.id, name: m.name, lv: m.lv })),
  };
}
// 收到的 state 规整一遍（字段缺了、类型不对的补默认）
function normState(p) {
  if (!p || typeof p !== 'object' || !isFinite(+p.v)) return null;
  const mode = BR.MODES && BR.MODES[p.mode] ? String(p.mode) : 'casual';
  const pair = a => (Array.isArray(a) ? [!!a[0], !!a[1]] : [false, false]);
  const maps = Array.isArray(p.maps) ? p.maps.filter(m => m && m.id != null).slice(0, 20)
    .map(m => ({ id: String(m.id), name: String(m.name || '').slice(0, 24), lv: String(m.lv) })) : [];
  return {
    mode, diff: p.diff != null && diffOk(p.diff) ? String(p.diff) : null,
    lv: p.lv != null ? String(p.lv) : defaultLv(), ws: p.ws != null ? String(p.ws) : null,
    spawn: U.clamp(num(+p.spawn, 1), 0, 1),
    rdy: pair(p.rdy), tin: pair(p.tin), goAt: num(+p.goAt, 0) > 0 ? +p.goAt : 0,
    by: p.by === 'h' || p.by === 'g' ? p.by : null, chg: typeof p.chg === 'string' ? p.chg : null,
    v: +p.v, maps,
  };
}
function ensureState() {
  if (!S.state) S.state = freshState();
  return S.state;
}
function emitState() {
  if (!S.state || !active() || !isHost()) return false;
  return has(BR.coop, 'emit') ? BR.coop.emit('tent', copyState(S.state)) : false;
}
// 房主写完一笔：v + 1、广播、刷新本机界面
function commit(by, chg) {
  const st = S.state;
  st.v = ++S.vSeen;
  st.by = by;
  st.chg = chg || null;
  emitState();
  afterState(by !== myChar(), chg, by === 'h' ? (isHost() ? myName() : peerName()) : (isHost() ? peerName() : myName()));
}
// 改了选择 / 有人出帐篷 / 断线：准备清掉、倒数停
function clearReady(st) { st.rdy[0] = false; st.rdy[1] = false; st.goAt = 0; }
function maybeGo(st) {
  if (st.goAt || !st.rdy[0] || !st.rdy[1] || !active()) return;
  if (!readyCheck(st).ok) { clearReady(st); return; }
  st.goAt = Math.round((clock() + num(+cfg('countdown'), 3)) * 1000) / 1000;
}
// 能不能点「准备」：要有队友、模式能两人玩、这一层两边都有、噩梦选了难度
function reconnecting() { return !!(BR.coop && BR.coop.phase === 'reconnecting'); }
function readyCheck(st) {
  if (!active()) return { ok: false, why: reconnecting() ? '正在重连…' : '等朋友来' };
  const a = modeAvail(st.mode);
  if (!a.ok) return a;
  if (st.mode === 'nightmare' && !diffOk(st.diff)) return { ok: false, why: '先选难度' };
  const lv = runLv(st);
  if (!lvOk(lv, lv === 'dev')) return { ok: false, why: '队友没有这一层' };
  return { ok: true, why: '' };
}

// 房主处理一个操作（自己点的 by='h'，客机 use 过来的 by='g'）→ { ok, why? }
function hostOp(op, x, by) {
  if (!inCamp()) return { ok: false, why: '不在营地里' };
  const st = ensureState();
  const i = by === 'h' ? 0 : 1;
  x = x && typeof x === 'object' ? x : {};
  switch (op) {
    case 'pick': {
      if (st.goAt && clock() >= st.goAt - CANCEL_LOCK_S) return { ok: false, why: '已经出发了' };
      const r = cleanPick(st, x);
      if (r.why) return { ok: false, why: r.why };
      let chg = null;
      for (const k of SEL_KEYS) {
        if (!(k in r.patch) || same(st[k], r.patch[k])) continue;
        st[k] = r.patch[k];
        chg = chg ? (k === 'lv' || k === 'ws' || k === 'mode' ? k : chg) : k;
      }
      if (!chg) return { ok: true };
      const was = st.goAt;
      clearReady(st);
      commit(by, chg);
      if (was) cancelNote(by);
      return { ok: true };
    }
    case 'ready': {
      if (x.on) {
        if (st.goAt) return { ok: true };
        const c = readyCheck(st);
        if (!c.ok) return { ok: false, why: c.why };
        st.rdy[i] = true;
        st.tin[i] = true;
        maybeGo(st);
      } else {
        if (st.goAt && clock() >= st.goAt - CANCEL_LOCK_S) return { ok: false, why: '来不及取消了' };
        const was = st.goAt;
        st.rdy[i] = false;
        st.goAt = 0;
        if (was) { st.rdy[0] = st.rdy[1] = false; commit(by, null); cancelNote(by); return { ok: true }; }
      }
      commit(by, null);
      return { ok: true };
    }
    case 'in': {
      if (st.tin[i]) return { ok: true };
      st.tin[i] = true;
      commit(by, null);
      return { ok: true };
    }
    case 'out': {
      // 最后 0.5 s 出帐篷也拦不住出发（界面上这时出帐篷是灰的）；只记下不在帐篷里
      if (st.goAt && clock() >= st.goAt - CANCEL_LOCK_S) { st.tin[i] = false; return { ok: false, why: '来不及取消了' }; }
      const was = st.goAt;
      st.tin[i] = false;
      st.rdy[i] = false;
      if (was) clearReady(st);
      commit(by, null);
      if (was) cancelNote(by);
      return { ok: true };
    }
    case 'cancel': {
      if (!st.goAt) return { ok: true };
      if (clock() >= st.goAt - CANCEL_LOCK_S) return { ok: false, why: '来不及取消了' };
      clearReady(st);
      commit(by, null);
      cancelNote(by);
      return { ok: true };
    }
  }
  return { ok: false, why: 'bad' };
}
// 倒数被取消：两边都说一声。客机的取消要等这条 campCancel 才停
function cancelNote(by) {
  const name = by === myChar() ? myName() : peerName();
  if (active() && has(BR.coop, 'emit')) BR.coop.emit('campCancel', { by: name, r: by });
  toast(by === myChar() ? '已取消出发' : '「' + name + '」取消了出发', 2000);
  S.beat = -1;
}
// pick 的参数核对：返回 { patch } 或 { why }
function cleanPick(st, x) {
  const patch = {};
  const dbg = !!x.dbg;
  if (x.mode !== undefined) {
    const m = String(x.mode);
    if (!BR.MODES || !BR.MODES[m]) return { why: 'bad' };
    const a = modeAvail(m);
    if (!a.ok && !dbg) return { why: a.why };
    patch.mode = m;
  }
  if (x.diff !== undefined) {
    if (x.diff === null || x.diff === '') patch.diff = null;
    else if (diffOk(String(x.diff))) patch.diff = String(x.diff);
    else return { why: 'bad' };
  }
  if (x.lv !== undefined && x.lv !== null) {
    const lv = String(x.lv);
    if (!lvOk(lv, dbg)) return { why: BR.levels && BR.levels.has(lv) ? '队友没有这一层' : '没有这一层' };
    patch.lv = lv;
  }
  if (x.ws !== undefined) {
    if (x.ws === null || x.ws === '') patch.ws = null;
    else if (findMap(st, x.ws)) patch.ws = String(x.ws);
    else return { why: '没有这张地图' };
  }
  if (x.spawn !== undefined) {
    const v = +x.spawn;
    if (!isFinite(v)) return { why: 'bad' };
    patch.spawn = Math.round(U.clamp(v, 0, 1) * 100) / 100;
  }
  return { patch };
}

// 客机发给房主：结果不好就说原因并按缓存重画（撤回本机先动的控件）。'in' / 'out' 失败不说（刚连上时房主还没收到
// 客机的位置，会回「太远了」；'in' 由 update 每 1.5 s 补发一次，直到房主那边记上）
function guestOp(op, x) {
  const P = BR.player;
  const eye = P ? [num(P.x, 0), num(P.y, eyeH()), num(P.z, 0)] : [0, eyeH(), 0];
  if (!has(BR.coop, 'use')) return;
  if (op === 'in') S.inSentAt = nowMs();
  BR.coop.use(USE_KEY, 'tent', eye, res => {
    if (res && res.ok === false) {
      if (res.why && res.why !== 'bad' && op !== 'in' && op !== 'out') toast(res.why, 2000);
      render(false);
    }
  }, Object.assign({ op }, x || {}));
}
// 自己做一个操作：房主当场写，客机申请
function act(op, x) {
  if (isHost()) {
    const r = hostOp(op, x, 'h');
    if (r && r.ok === false && r.why && r.why !== 'bad') { toast(r.why, 2000); render(false); }
    return r;
  }
  guestOp(op, x);
  return null;
}
function onUseTent(req) {
  if (!req || !req.x || typeof req.x !== 'object') return { ok: false, why: 'bad' };
  if (req.by !== 'peer') return hostOp(String(req.x.op), req.x, 'h');
  if (!isHost()) return { ok: false, why: '不在营地里' };
  return hostOp(String(req.x.op), req.x, 'g');
}

// 收到房主的 state
function onTentEv(p) {
  const st = normState(p);
  if (!st) return;
  if (isHost() && active()) return;   // 自己是房主：不认别人的（两边同时当房主的时候）
  if (S.state && st.v <= S.state.v) return;
  S.vSeen = Math.max(S.vSeen, st.v);
  S.state = st;
  if (!inCamp()) return;
  const by = st.by;
  afterState(by != null && by !== myChar(), st.chg, by === 'h' ? peerName() : myName());
}
// state 变了以后：选单重画、对方改的就闪一下 + toast、倒数停了就清拍子
function afterState(remote, chg, name) {
  const st = S.state;
  if (!st) return;
  if (!st.goAt) S.beat = -1;
  if (remote && chg && inCamp()) {
    const t = chgText(st, chg, name);
    const now = nowMs();
    // 拖滑条连着改：1.5 s 内只说一次
    if (t && !(chg === 'spawn' && S.chgToast.chg === 'spawn' && now - S.chgToast.at < 1500)) toast(t, 2200);
    S.chgToast = { chg, at: now };
    if (S.panel && BR.tentMenu && has(BR.tentMenu, 'flash')) BR.tentMenu.flash();
  }
  render(remote);
  S.boardAt = 0;
}

// ---------- 选单 ----------
function menu() { return BR.tentMenu && has(BR.tentMenu, 'open') ? BR.tentMenu : null; }
function view(remote) {
  const st = S.state || ensureState();
  const me = meIdx(), pe = 1 - me;
  const live = active();
  const modes = (BR.home && Array.isArray(BR.home.modeText) ? BR.home.modeText : [['casual', '游玩', ''], ['nightmare', '噩梦生存', ''], ['test', '测试模式', '']])
    .map(r => { const a = modeAvail(r[0]); return { key: r[0], name: r[1], desc: r[2], ok: a.ok, why: a.why }; });
  const rc = readyCheck(st);
  const now = clock();
  const counting = !!st.goAt && live;
  let peerText;
  if (live) {
    const n = '「' + peerName() + '」：';
    peerText = st.tin[pe] ? n + '在帐篷里 · ' + (st.rdy[pe] ? '已准备 ✓' : '还没准备') : n + '还在外面';
  } else if (reconnecting()) peerText = '「' + peerName() + '」：连接断了，正在重连…';
  else peerText = S.hadPeer ? '队友已离开' : '还没有朋友进来';
  const lv = runLv(st);
  return {
    me, isHost: isHost(), remote: !!remote,
    mode: st.mode, diff: st.diff, lv: st.lv, ws: st.ws, spawn: st.spawn,
    modes, only: onlySet(), maps: st.maps || [],
    myReady: !!st.rdy[me], peerReady: !!st.rdy[pe], peerIn: !!st.tin[pe], peerHere: live,
    peerText,
    readyOk: rc.ok, readyWhy: rc.ok ? '' : rc.why,
    count: counting ? Math.max(1, Math.ceil(st.goAt - now)) : 0,
    canCancel: counting && now < st.goAt - CANCEL_LOCK_S,
    lvNote: (lv === '15' || lv === '16') ? '这一层没有回去的路，可以从暂停菜单回营地' : '',
  };
}
function render(remote) {
  const M = menu();
  if (!S.panel || !M || !has(M, 'render')) return;
  try { M.render(view(remote)); } catch (err) { console.error('[coopCamp] 选单重画出错', err); }
}
const HANDLERS = {
  onMode(m) {
    const a = modeAvail(m);
    if (!a.ok) { toast(a.why, 2000); return; }
    act('pick', { mode: m });
  },
  // modeFields 的 get()：{ spawnSlider, difficulty, startLevel, … }，只发真的变了的
  onFields(v) {
    const st = S.state;
    if (!st || !v) return;
    const p = {};
    if (st.mode === 'nightmare' && v.difficulty !== undefined && !same(v.difficulty, st.diff)) p.diff = v.difficulty;
    if (v.startLevel != null && String(v.startLevel) !== st.lv && !st.ws) p.lv = String(v.startLevel);
    if (Object.keys(p).length) act('pick', p);
    if (st.mode === 'casual' && v.spawnSlider != null && Math.abs(+v.spawnSlider - st.spawn) > 0.004) {
      S.spawnPend = Math.round(U.clamp(+v.spawnSlider, 0, 1) * 100) / 100;
      flushSpawn(false);
    }
  },
  onMap(id) { act('pick', { ws: id == null ? null : String(id) }); },
  onReady(on) { act('ready', { on: !!on }); },
  onCancel() { act('cancel', {}); },
  onExit(fromClick) { exitTent({ click: !!fromClick }); },
};
function flushSpawn(force) {
  if (S.spawnPend == null) return;
  const t = nowMs();
  if (!force && t - S.spawnSentAt < SPAWN_SEND_MS) return;
  const v = S.spawnPend;
  S.spawnPend = null;
  S.spawnSentAt = t;
  act('pick', { spawn: v });
}
function openPanel() {
  const M = menu();
  if (!M) { toast('页面没更新完整，请刷新', 3000); setInput(BR.game.screen === 'playing'); return false; }
  if (S.panel) return true;
  S.panel = true;
  setInput(false);
  if (has(BR.interact, 'cancel')) BR.interact.cancel('mode');
  try { M.open(HANDLERS, view(false)); } catch (err) { console.error('[coopCamp] 选单打开出错', err); S.panel = false; return false; }
  act('in', {});
  return true;
}
// 只在本机关选单（不发 out：出发、换层、回主页时用）
function closePanelLocal() {
  if (!S.panel) return;
  S.panel = false;
  S.spawnPend = null;
  const M = menu();
  if (M && has(M, 'close')) { try { M.close(); } catch (err) { console.error('[coopCamp] 选单关闭出错', err); } }
}

// ---------- 营地数据 ----------
function findData() {
  if (!BR.world || !has(BR.world, 'chunks')) return null;
  const list = BR.world.chunks();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const d = c && c.res && c.res.data && c.res.data.coopcamp;
    if (d && d.tent && d.tent.door) return d;
  }
  return null;
}
// 门朝外的单位方向：门在帐篷里面那块矩形的哪条边上就朝哪边（帐篷只会转 90° 的整数倍）
function outward(d) {
  const door = d.tent.door, r = d.tent.inside;
  if (r) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), z0 = Math.min(r.z0, r.z1), z1 = Math.max(r.z0, r.z1);
    const cand = [[Math.abs(door.z - z1), 0, 1], [Math.abs(door.z - z0), 0, -1], [Math.abs(door.x - x1), 1, 0], [Math.abs(door.x - x0), -1, 0]];
    cand.sort((a, b) => a[0] - b[0]);
    return { x: cand[0][1], z: cand[0][2] };
  }
  return { x: 0, z: 1 };
}
function tentCenter(d) {
  const r = d.tent.inside;
  if (r) return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
  return { x: d.tent.door.x - S.out.x * 2, z: d.tent.door.z - S.out.z * 2 };
}
function setupCamp() {
  const d = findData();
  if (!d) return false;
  S.data = d;
  S.out = outward(d);
  S.lantern = findLantern(d);
  buildMeshes(d);
  return true;
}
function findLantern(d) {
  const L = d.tent && d.tent.lantern;
  if (!L || !BR.world) return null;
  let best = null, bd = 0.8 * 0.8;
  for (const c of BR.world.chunks()) {
    for (const l of (c.lights || [])) {
      const dd = U.dist2(num(l.x, 1e9), num(l.z, 1e9), L.x, L.z) + Math.pow(num(l.y, L.y) - num(L.y, 0), 2);
      if (dd < bd) { bd = dd; best = l; }
    }
  }
  return best;
}

// ---------- 候选（interact 来源 'coopTent'） ----------
const C_TENT = {
  kind: 'fixture', key: KEY_TENT, label: '帐篷', t: 0, small: false,
  short: { verb: '进帐篷', ok: true, why: '' }, hold: null, canDrag: false, vol: 0, parentKeys: [],
  dragWhy: '帐篷是营地的出口，拖不动', x: 0, y: 0, z: 0,
  onShort() { return enter() !== false; },
};
const C_MAP = {
  kind: 'fixture', key: KEY_MAP, label: '层级地图', t: 0, small: true,
  short: { verb: '看地图', ok: true, why: '' }, hold: null, canDrag: false, vol: 0, parentKeys: [],
  dragWhy: '地图桌绑在帐篷杆上，拖不动', x: 0, y: 0, z: 0,
  onShort() { return openFromMap(); },
};
const C_HOOKS = {
  kind: 'fixture', key: KEY_HOOKS, label: '制服挂钩', t: 0, small: false,
  short: { verb: '换制服', ok: true, why: '' }, hold: null, canDrag: false, vol: 0, parentKeys: [],
  dragWhy: '挂钩钉在柱子上，拖不动', x: 0, y: 0, z: 0,
  onShort(c) { return nextSkin(c); },
};
function hitPoint(c, ray, t) { c.t = t; c.x = ray.ox + ray.dx * t; c.y = ray.oy + ray.dy * t; c.z = ray.oz + ray.dz * t; }
function source(ray, reach, out) {
  if (!S.data || S.panel || S.walk || G.phase !== 'idle' || !inCamp()) return;
  const H = BR.interact && BR.interact.hit;
  if (!H) return;
  const d = S.data, o = S.out;
  // 帐篷门：门洞盒子，射线起点在门外、离门 ≤ 2.6 m
  const door = d.tent.door;
  const side = (ray.ox - door.x) * o.x + (ray.oz - door.z) * o.z;
  if (side > 0 && Math.hypot(ray.ox - door.x, ray.oz - door.z) <= DOOR_REACH) {
    const w = num(door.w, 1.2) / 2, h = num(door.h, 2.0), y0 = num(door.y, groundY(door.x, door.z, 0));
    const ax = Math.abs(o.x) > 0.5;   // 门面法线沿 x
    const t = ax ? H.box(ray, door.x - 0.05, y0, door.z - w, door.x + 0.05, y0 + h, door.z + w, false)
      : H.box(ray, door.x - w, y0, door.z - 0.05, door.x + w, y0 + h, door.z + 0.05, false);
    if (t >= 0 && t <= reach) { hitPoint(C_TENT, ray, t); out.push(C_TENT); }
  }
  // 桌上的层级地图（map.w / map.d 是世界 x / z 方向的长度；小目标，近处优先于地图桌本身）
  const m = d.tent.map;
  if (m && num(m.x, NaN) === m.x) {
    const ex = num(m.w, 1) / 2, ez = num(m.d, 0.5) / 2;
    const t = H.box(ray, m.x - ex, m.y - 0.03, m.z - ez, m.x + ex, m.y + 0.04, m.z + ez, true);
    if (t >= 0 && t <= reach) { hitPoint(C_MAP, ray, t); out.push(C_MAP); }
  }
  // 柱子上的制服挂钩：层级给了包围盒（box）就用它；没给就按挂钩那一排前后 0.25 m、左右 w/2、往下 1.15 m（制服垂下来的那一截）
  const k = d.hooks;
  if (k && num(k.x, NaN) === k.x) {
    const bx = k.box;
    let t;
    if (bx && num(bx.x0, NaN) === bx.x0) {
      t = H.box(ray, Math.min(bx.x0, bx.x1), Math.min(bx.y0, bx.y1), Math.min(bx.z0, bx.z1), Math.max(bx.x0, bx.x1), Math.max(bx.y0, bx.y1), Math.max(bx.z0, bx.z1), false);
    } else {
      const alongX = Math.abs(Math.sin(num(k.yaw, 0))) > 0.5;   // 法线沿 x：一排挂钩沿 z 排开
      const hw = num(k.w, 1.0) / 2, hd = 0.25, y = num(k.y, 1.7);
      t = alongX ? H.box(ray, k.x - hd, y - 1.15, k.z - hw, k.x + hd, y + 0.15, k.z + hw, false)
        : H.box(ray, k.x - hw, y - 1.15, k.z - hd, k.x + hw, y + 0.15, k.z + hd, false);
    }
    if (t >= 0 && t <= reach) { hitPoint(C_HOOKS, ray, t); C_HOOKS.short = hookShort(hookAt(C_HOOKS.x, C_HOOKS.z)); out.push(C_HOOKS); }
  }
}
// 制服挂钩：准心对准的是哪一件就换哪一件（2026-10-05 返修 r2：原来不管对准哪件都按 BR.SKINS 顺序换「下一种」，
// 会换上队友正穿着、挂钩上根本没有的那件，两人撞色）。挂钩上空着的那一格（自己或队友正穿着）按了只说原因
function skinOf(key) { return (BR.SKINS || []).find(s => s.key === key) || null; }
function mySkinKey() { return String((BR.skin && BR.skin.current) || BR.game.skin || ''); }
function peerSkinKey() { return active() && BR.coop.peerSkin ? String(BR.coop.peerSkin) : ''; }
// 'me' | 'peer' | ''：这种颜色现在穿在谁身上（穿在身上的那件不挂在钩上）
function wornBy(key) {
  if (!key) return '';
  if (key === mySkinKey()) return 'me';
  if (key === peerSkinKey()) return 'peer';
  return '';
}
// 命中点 (x, z) 对着这一排里的哪一件：沿排列方向离哪件制服中心最近（层级 hooks.at，顺序同 skins）
function hookAt(x, z) {
  const d = S.data, k = d && d.hooks, list = d && d.skins;
  if (!k || !Array.isArray(k.at) || !Array.isArray(list) || !k.at.length || !(num(x, NaN) === x) || !(num(z, NaN) === z)) return '';
  const v = Math.abs(Math.sin(num(k.yaw, 0))) > 0.5 ? z : x;   // 挂钩面朝 ±x：一排沿 z 排开
  let best = -1, bd = Infinity;
  for (let i = 0; i < k.at.length && i < list.length; i++) {
    const dd = Math.abs(num(k.at[i], 1e9) - v);
    if (dd < bd) { bd = dd; best = i; }
  }
  return best >= 0 ? String(list[best]) : '';
}
function hookWhy(w) { return w === 'me' ? '这件就穿在你身上' : '「' + peerName() + '」穿着这件'; }
const HOOK_SHORT = { def: { verb: '换制服', ok: true, why: '' } };
// 准心提示：「空格 换制服 黄色那件」；对着空着的那一格灰字写原因（对象按状态缓存，别每帧新建）
function hookShort(key) {
  if (!key) return HOOK_SHORT.def;
  const w = wornBy(key);
  const sig = key + '|' + w + '|' + (w === 'peer' ? peerName() : '');
  let o = HOOK_SHORT[sig];
  if (!o) {
    const s = skinOf(key);
    o = w ? { verb: '换制服', ok: false, why: hookWhy(w) } : { verb: '换制服', ok: true, why: '', name: ((s && s.zh) || '这') + '那件' };
    HOOK_SHORT[sig] = o;
  }
  return o;
}
function nextSkin(c) {
  const list = BR.SKINS || [];
  if (!list.length || !has(BR.skin, 'set')) return false;
  let key = c ? hookAt(num(c.x, NaN), num(c.z, NaN)) : '';
  if (key) {
    // 瞄的时候还挂着、按下去这一刻队友刚好换上了它
    const w = wornBy(key);
    if (w) { toast(hookWhy(w), 1600); return false; }
  } else {
    // 没有命中点（老的营地数据）：按顺序换下一件还挂着的，跳过自己和队友身上的
    const i = list.findIndex(s => s.key === mySkinKey());
    for (let k = 1; k <= list.length && !key; k++) {
      const s = list[(i + k + list.length) % list.length];
      if (s && !wornBy(s.key)) key = s.key;
    }
  }
  const nx = skinOf(key);
  if (!nx) return false;
  BR.skin.set(nx.key);
  stepHooks(true);
  sound('step', { volume: 0.3, rate: 1.3 });
  toast('换上了' + nx.zh + '制服', 1600);
  return true;
}

// ---------- 自动走 ----------
// 站位：联机时按角色固定——房主 stand[0]、客机 stand[1]（2026-10-05 返修：两人前后脚按空格，各自看到的对方位置都晚
// 100–300 ms，按「离队友远」挑会两边都挑中 stand[0]、叠在一起）。只有对方正好站在我那一格上（自己走进去站着）才换另一格；
// 一个人时挑离对方（没有对方）最近的第一格
function stands(d) { return Array.isArray(d.tent.stand) ? d.tent.stand.filter(p => p && num(p.x, NaN) === p.x) : []; }
function standPick(d) {
  const st = stands(d);
  if (!st.length) return null;
  const peer = active() ? BR.coop.peer : null;
  const free = p => !peer || Math.hypot(p.x - peer.x, p.z - peer.z) > STAND_FREE;
  if (active() && st.length >= 2) {
    const mine = st[meIdx()], other = st[1 - meIdx()];
    return free(mine) || !free(other) ? mine : other;
  }
  for (const p of st) if (free(p)) return p;
  return st[0];
}
// 门轴上的横向单位向量（朝外方向转 90°）和这个站位在门的哪一边（−1 / +1；正对门轴中线为 0）
function doorLat(o) { return { x: -o.z, z: o.x }; }
function sideOf(p, door, lat) {
  const s = (p.x - door.x) * lat.x + (p.z - door.z) * lat.z;
  return Math.abs(s) < 0.05 ? 0 : (s > 0 ? 1 : -1);
}
// 联机时两人各走门洞的一侧（偏中线 DOOR_LANE），和各自的站位同一边：同时进出帐篷时路线不交叉、不在门口叠成一个人
function laneOff(stand, door, o) {
  if (!active() || !stand) return { x: 0, z: 0 };
  const lat = doorLat(o), s = sideOf(stand, door, lat);
  return { x: lat.x * s * DOOR_LANE, z: lat.z * s * DOOR_LANE };
}
// 队友站着不动、挡在要走的路上：返回描述（门口 / 路上），没挡着返回 ''。队友自己在走（比如也正往帐篷里走）不算。
// near：离路线多近算挡（默认 PEER_BLOCK；出帐篷挑落点时用两人半径相加，擦着身体过去也不行）
function peerBlocks(pts, door, o, near) {
  if (!active() || S.peerSpeed > PEER_STILL) return '';
  const peer = BR.coop.peer;
  if (!peer) return '';
  const lim = num(near, PEER_BLOCK);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const k = L2 > 1e-9 ? U.clamp(((peer.x - a.x) * dx + (peer.z - a.z) * dz) / L2, 0, 1) : 0;
    if (Math.hypot(a.x + dx * k - peer.x, a.z + dz * k - peer.z) < lim) {
      const along = (peer.x - door.x) * o.x + (peer.z - door.z) * o.z;
      return Math.abs(along) < 0.8 ? '门口' : '路上';
    }
  }
  return '';
}
// 出帐篷停在哪：门外 OUT_DIST，联机时按自己站位那一边横向错开 EXIT_SIDE（两人一起出来各站一边、相距约 1 m）；
// 候选点离队友 > STAND_FREE、脚下没被东西占着、从门洞 from 走过去不擦着站着不动的队友（两人半径相加）才要。
// 2026-10-05 返修 r2：队友站在门外正中等着时，两边 ±0.5 都离他 < 0.8，原来退回正中——正好是队友站的地方，走进他身体里。
// 现在再试 ±1.0、往外再走 0.5 的三个点；都不行返回 null（队友堵在门口，出不去）
function exitSpot(d, o, from) {
  const door = d.tent.door, lat = doorLat(o);
  const C = { x: door.x + o.x * OUT_DIST, z: door.z + o.z * OUT_DIST };
  if (!active()) return C;
  const mine = stands(d)[meIdx()];
  let s = mine ? sideOf(mine, door, lat) : 0;
  if (!s) s = isHost() ? -1 : 1;
  const peer = BR.coop.peer;
  const ok = p => (!peer || Math.hypot(p.x - peer.x, p.z - peer.z) > STAND_FREE) &&
    !(has(BR.phys, 'overlapCircle') && BR.phys.overlapCircle(p.x, p.z, PLAYER_R, groundY(p.x, p.z, 0) + 0.05, 1.6)) &&
    !(from && peerBlocks([from, p], door, o, PLAYER_R * 2));
  const out = (k, far) => ({ x: C.x + lat.x * k + o.x * far, z: C.z + lat.z * k + o.z * far });
  const cand = [out(s * EXIT_SIDE, 0), out(-s * EXIT_SIDE, 0), out(s * EXIT_SIDE * 2, 0), out(-s * EXIT_SIDE * 2, 0),
    out(0, EXIT_FAR), out(s * EXIT_SIDE, EXIT_FAR), out(-s * EXIT_SIDE, EXIT_FAR)];
  for (const p of cand) if (ok(p)) return p;
  return null;
}
// 电脑上按 Esc / 返回键走出帐篷、出发或回营地的过场亮起来以后（过场里关输入会退出指针锁定，2026-10-05 返修 r2）：
// 这时不在点击里，锁不上指针，鼠标转不了视角。弹「点一下画面继续」，锁上或点了就收。
// 横幅带 hud-notice-pass（不接点击）：照字面点在横幅上，这一下也落到画面上、由 input.js 锁上指针（原来点横幅只把它关了）
function lockHint() {
  if ((BR.input && BR.input.isTouch) || document.pointerLockElement || BR.game.screen !== 'playing') return;
  if (S.lockNote && S.lockNote.open !== false) return;
  closeLockHint();
  if (!has(BR.hud, 'notice')) { toast('点一下画面继续', 3000); return; }
  let n = null;
  try { n = BR.hud.notice('点一下画面继续', [], 0, { cls: 'hud-notice-pass' }); } catch (err) { n = null; }
  if (!n) return;
  // 点在别的横幅的按钮上（「同意 / 不要」）不收：这一下先把这条收了，下面那条横幅往上一挪，按钮就点空了（2026-10-05 返修 r2，
  // coop.mjs 12a：到了新层没点画面、横幅还在，队友问回营地时点「不要」点不到）。点画面（落到画布上）、锁上指针才收
  const done = e => {
    if (e && e.type === 'pointerdown' && e.target && e.target.closest && e.target.closest('.hud-notices')) return;
    if (S.lockNote === n) closeLockHint();
  };
  S.lockNote = n;
  S.lockOff = () => {
    document.removeEventListener('pointerlockchange', done);
    window.removeEventListener('pointerdown', done, true);
  };
  document.addEventListener('pointerlockchange', done);
  window.addEventListener('pointerdown', done, true);
}
function closeLockHint() {
  if (S.lockOff) { S.lockOff(); S.lockOff = null; }
  if (S.lockNote) { try { S.lockNote.close(); } catch (err) { /* 已经关了 */ } S.lockNote = null; }
}
function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}
function pathClear(pts) {
  if (!has(BR.phys, 'overlapCircle')) return true;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / PATH_STEP));
    for (let k = i === 1 ? 1 : 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
      if (BR.phys.overlapCircle(x, z, PLAYER_R, groundY(x, z, 0) + 0.05, 1.6)) return false;
    }
  }
  return true;
}
function startWalk(pts, dur, yaw1, kind, then) {
  const P = BR.player;
  const len = polyLen(pts);
  S.walk = { pts, len, t: 0, dur, y: feetY(), yaw0: num(P.yaw, 0), yaw1, kind, then };
  setInput(false);
  if (has(BR.interact, 'cancel')) BR.interact.cancel('mode');
  if (len < 1e-3) stepWalk(dur);
}
function stepWalk(dt) {
  const W = S.walk;
  if (!W) return;
  if (!inCamp() || !BR.player) { S.walk = null; return; }
  W.t += dt;
  const k = W.dur > 0 ? Math.min(1, W.t / W.dur) : 1;
  const e = smooth(k);
  let s = W.len * e, x = W.pts[0].x, z = W.pts[0].z;
  for (let i = 1; i < W.pts.length; i++) {
    const a = W.pts[i - 1], b = W.pts[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === W.pts.length - 1) {
      const f = L > 1e-6 ? U.clamp(s / L, 0, 1) : 1;
      x = a.x + (b.x - a.x) * f; z = a.z + (b.z - a.z) * f;
      break;
    }
    s -= L;
  }
  const yaw = W.yaw0 + wrapA(W.yaw1 - W.yaw0) * e;
  if (has(BR.player, 'reset')) BR.player.reset({ x, y: W.y, z, yaw }, { full: false });
  if (k >= 1) {
    S.walk = null;
    if (typeof W.then === 'function') W.then();
  }
}
// 进帐篷。opts.force：不查「站在门前、一路空着」（测试用）
function enter(opts) {
  if (!inCamp() || S.panel || S.walk || G.phase !== 'idle') return false;
  if (!S.data && !setupCamp()) return false;
  const d = S.data, o = S.out, door = d.tent.door, P = BR.player;
  if (!P) return false;
  const stand = standPick(d);
  if (!stand) return openPanel();
  const p0 = { x: num(P.x, 0), z: num(P.z, 0) };
  const ln = laneOff(stand, door, o);
  const A = { x: door.x + o.x * DOOR_OUT + ln.x, z: door.z + o.z * DOOR_OUT + ln.z };
  const B = { x: door.x + ln.x, z: door.z + ln.z };
  const along = (p0.x - door.x) * o.x + (p0.z - door.z) * o.z;
  const pts = along > DOOR_OUT + 0.05 ? [p0, A, B, { x: stand.x, z: stand.z }] : [p0, B, { x: stand.x, z: stand.z }];
  const force = !!(opts && opts.force);
  const ok = force || inRect(p0, d.corridor) || pathClear(pts);
  if (!ok) { toast('走到门口', 1500); return false; }
  const blk = force ? '' : peerBlocks(pts, door, o);
  if (blk) { toast('「' + peerName() + '」挡在' + blk, 1500); return false; }
  const m = d.tent.map;
  const yaw1 = m ? yawTo(m.x - stand.x, m.z - stand.z) : yawTo(-o.x, -o.z);
  sound('step', { volume: 0.35, rate: 0.85 });
  startWalk(pts, WALK_IN_S, yaw1, 'in', () => { if (BR.player) BR.player.pitch = -0.28; openPanel(); });
  return true;
}
// 站在帐篷里对着地图按空格：直接开选单
function openFromMap() {
  if (!inCamp() || S.panel || S.walk || G.phase !== 'idle') return false;
  return openPanel();
}
// 出帐篷。opts.click：从选单按钮点的（在点击里请求指针锁定）
function exitTent(opts) {
  opts = opts || {};
  if (S.walk && S.walk.kind === 'out') return true;
  if (!S.panel && !S.walk) return false;
  const st = S.state;
  if (st && st.goAt && active() && clock() >= st.goAt - CANCEL_LOCK_S) { toast('马上出发了', 1200); return true; }
  if (S.panel) act('out', {});
  closePanelLocal();
  S.walk = null;
  if (opts.click && has(BR.input, 'lock') && !(BR.input && BR.input.isTouch)) { try { BR.input.lock(); } catch (err) { /* 锁不上就拖视角 */ } }
  const d = S.data, P = BR.player;
  if (!d || !P || !inCamp()) { setInput(BR.game.screen === 'playing'); return true; }
  const o = S.out, door = d.tent.door;
  const p0 = { x: num(P.x, 0), z: num(P.z, 0) };
  const ln = laneOff(stands(d)[meIdx()], door, o);
  const B = { x: door.x + ln.x, z: door.z + ln.z };
  const along = (p0.x - door.x) * o.x + (p0.z - door.z) * o.z;
  const inside = along < -0.05;
  const O = exitSpot(d, o, inside ? B : p0);
  const click = !!opts.click;
  const after = () => {
    if (BR.game.screen === 'playing' && !S.panel && G.phase === 'idle') {
      setInput(true);
      if (!click) lockHint();
    }
  };
  if (!O) {
    // 队友站在门口 / 门外正前方不动，哪个落点都要从他身上穿过去：走到门槛里面停下，说一声，等他让开自己走出去
    const I = { x: door.x - o.x * EXIT_INSIDE + ln.x, z: door.z - o.z * EXIT_INSIDE + ln.z };
    toast('「' + peerName() + '」挡在门口', 1800);
    startWalk(inside ? [p0, I] : [p0], WALK_OUT_S, yawTo(o.x, o.z), 'out', after);
    return true;
  }
  const pts = inside ? [p0, B, O] : [p0, O];
  startWalk(pts, WALK_OUT_S, yawTo(o.x, o.z), 'out', after);
  return true;
}
// main 在 Esc / 返回键时先问它：true = 已经处理了（关了选单、走出帐篷，或者正在黑幕里），这次不进暂停
function onBack() {
  if (G.phase !== 'idle') return true;
  if (S.walk) return true;
  if (S.panel) { exitTent({}); return true; }
  return false;
}

// ---------- 倒数与出发 ----------
function stepCountdown() {
  const st = S.state;
  if (!st || !inCamp() || G.phase !== 'idle') return;
  if (!st.goAt) { S.beat = -1; return; }
  if (!active()) {
    // 断线：倒数停、准备清空（房主自己写；客机只改本机缓存，连回来以房主为准）
    if (isHost()) { clearReady(st); commit('h', null); } else clearReady(st);
    toast('连接断了，出发取消', 2200);
    return;
  }
  const now = clock();
  const left = st.goAt - now;
  if (left <= 0) { depart(); return; }
  const n = Math.ceil(left);
  if (n !== S.beat) {
    S.beat = n;
    dimLantern();
    sound('click', { volume: 0.5, rate: 0.7 });
    render(false);
  }
}
function dimLantern() {
  const L = S.lantern;
  if (!L) return;
  if (!S.dimOrig) S.dimOrig = [L, L.intensity];
  L.intensity = num(S.dimOrig[1], 0.7) * 0.25;
  S.dimUntil = nowMs() + BEAT_DIM_MS;
}
function stepLantern() {
  if (S.dimOrig && nowMs() >= S.dimUntil) {
    const [L, v] = S.dimOrig;
    if (G.phase === 'idle') L.intensity = v;
    S.dimOrig = null;
  }
}
function lightsOut() {
  restoreLantern();
  S.dimmed.length = 0;
  if (BR.world && has(BR.world, 'chunks')) {
    for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { S.dimmed.push([l, l.intensity]); l.intensity = 0; }
  }
  const lv = BR.world && BR.world.current;
  S.envSaved = lv && lv.env ? lv.env : null;
  const base = S.envSaved || {};
  const black = Object.assign({}, base, {
    background: 0x000000, fogColor: 0x000000, fogNear: 0.5, fogFar: 6,
    ambient: { color: 0x000000, intensity: 0 },
  });
  if (has(BR.gfx, 'applyEnv')) BR.gfx.applyEnv(black, BR.game.settings ? BR.game.settings.visibility : undefined);
}
function lightsBack() {
  for (const [l, v] of S.dimmed) l.intensity = v;
  S.dimmed.length = 0;
  if (S.envSaved && has(BR.gfx, 'applyEnv') && inCamp()) BR.gfx.applyEnv(S.envSaved, BR.game.settings ? BR.game.settings.visibility : undefined);
  S.envSaved = null;
}
function restoreLantern() {
  if (S.dimOrig) { S.dimOrig[0].intensity = S.dimOrig[1]; S.dimOrig = null; }
}
function curtain(text) {
  if (has(BR.hud, 'curtain')) return BR.hud.curtain(text);
  return Promise.resolve(true);
}
// 到 0：灯灭、「嗡——啪」、黑幕。全黑后房主开新一局，客机等 world 消息
function depart() {
  const st = S.state;
  const text = runText(st);
  beginTransit('run', text, true);
}
function beginTransit(kind, text, lights) {
  const tok = ++G.token;
  G.phase = 'dark'; G.kind = kind; G.text = text; G.t0 = nowMs(); G.host = isHost();
  G.entered = false; G.enterAt = 0; G.arrived = false; G.revealed = false; G.lit = !!lights;
  G.dest = kind === 'camp' ? campId() : null;
  // 回营地是新开一局，背包带不回去：有东西的话记下来，到营地后说一声（提出、同意时横幅上已经提前说过）。
  // 不点层名：东西可能是前面几层捡的（2026-10-05 返修 r2：原来写「在 Level 1 捡的」，其实是在 Level 0 捡的）
  S.bagNote = kind === 'camp' && bagCount() > 0 && !inCamp() ? 'bag' : '';
  if (S.state) { clearReady(S.state); S.state.tin = [false, false]; }
  S.beat = -1;
  setInput(false);
  if (has(BR.interact, 'cancel')) BR.interact.cancel('mode');
  if (lights) {
    lightsOut();
    sound('buzz', { volume: 0.8 });
    G.snapAt = nowMs() + SNAP_DELAY_MS;
  } else G.snapAt = 0;
  curtain(text).then(ok => onBlack(tok, ok), () => onBlack(tok, false));
}
function onBlack(tok, ok) {
  if (tok !== G.token || G.phase !== 'dark') return;
  if (!ok) { endTransit(false); return; }
  closePanelLocal();
  S.walk = null;
  G.phase = 'wait';
  G.t0 = nowMs();
  if (!G.host) {
    if (G.entered && G.revealed) reveal(false);
    return;
  }
  // 房主：记下这一局的选择，开局
  if (!active()) { endTransit(true); toast('队友不在了，没有出发', 2500); return; }
  let p = null;
  if (G.kind === 'run') {
    const st = S.state;
    S.last = { mode: st.mode, diff: st.diff, lv: st.lv, ws: st.ws, spawn: st.spawn };
    p = runPayload(st);
    S.state = null;   // 回营地时按 last 重新填
  } else {
    p = { mode: String(cfg('campMode')), difficulty: null, settings: settingsFor(null), seed: randSeed(), levelId: campId() };
  }
  let started = true;
  try {
    if (has(BR.coop, 'startRun')) started = BR.coop.startRun(p) !== false;
    else BR.bus.emit('game:start', Object.assign(p, { coop: { role: 'host' } }));
  } catch (err) {
    console.error('[coopCamp] 开局出错', err);
    started = false;
  }
  if (!started && G.phase === 'wait' && !G.entered) { endTransit(true); toast('出发失败了，再准备一次试试', 2500); }
}
function settingsFor(st) {
  const s = Object.assign({}, BR.game.settings || {});
  if (st) { s.spawnSlider = st.spawn; s.startLevel = runLv(st); }
  delete s.visibility;   // 能见度只影响自己，不跟房主
  return s;
}
function randSeed() {
  try { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] >>> 0; } catch (err) { return (Date.now() * 2654435761) >>> 0; }
}
function runPayload(st) {
  const lv = runLv(st);
  const p = {
    mode: st.mode, difficulty: st.mode === 'nightmare' ? st.diff : null,
    settings: settingsFor(st), seed: randSeed(), levelId: lv,
  };
  if (st.ws && has(BR.workshop, 'get')) {
    const m = BR.workshop.get(st.ws);
    if (m) { p.workshop = m.id; p.seed = m.seed >>> 0; p.levelId = String(m.baseLevel); }
  }
  return p;
}
// 两边一起亮起来（房主发 reveal）
function reveal(send) {
  if (send && G.host && active() && has(BR.coop, 'emit')) BR.coop.emit('reveal', { at: clock() });
  endTransit(false);
}
// 过场结束：restore = 还在原地（没走成），把灯和环境还回去
function endTransit(restore) {
  if (G.phase === 'idle') return;
  // 回营地亮起来时说一声背包清空了（黑幕里说看不清）；没走成就不说
  if (S.bagNote && G.entered && !restore && inCamp()) toast('背包清空了：捡的东西带不回营地', 3500);
  S.bagNote = '';
  G.phase = 'idle';
  G.token++;
  if (restore && G.lit) lightsBack(); else { S.dimmed.length = 0; S.envSaved = null; }
  G.lit = false;
  curtain(false);
  if (BR.game.screen === 'playing' && !S.panel && !S.walk) {
    setInput(true);
    // 过场里关输入时退出了指针锁定（input.setEnabled(false)）：电脑上提示点一下画面，不然鼠标转不了视角又没有任何提示
    lockHint();
  }
}
function stepTransit() {
  if (G.phase === 'idle') return;
  const t = nowMs();
  if (G.snapAt && t >= G.snapAt) { G.snapAt = 0; sound('click', { volume: 1, rate: 0.45 }); }
  if (G.phase !== 'wait') return;
  if (G.host) {
    if (!G.entered) {
      if (t - G.t0 > HOST_DARK_MS) { endTransit(true); toast('没能出发，请再试一次', 3000); }
      return;
    }
    if (G.arrived || !active() || t - G.enterAt >= num(+cfg('arriveWait'), 5) * 1000) reveal(true);
    return;
  }
  if (t - G.t0 > GUEST_DARK_MS) {
    const why = !active() ? '和房主断开了' : '房主那边一直没有动静（可能切到了别的应用）';
    endTransit(!G.entered);
    toast(why + '，先亮起来了', 4000);
  }
}

// ---------- 回营地 ----------
function canAsk() {
  if (!active() || !inWorld() || inCamp() || G.phase !== 'idle') return false;
  return true;
}
function back() {
  if (!active()) { say('队友不在，回不了营地', 2600); return false; }
  if (inCamp() || G.phase !== 'idle') return false;
  if (S.ask) return true;
  if (S.askIn) { answer(true, false); return true; }   // 对方也正想回：直接同意
  const dead = !!(BR.player && BR.player.dead);
  const sent = has(BR.coop, 'emit') && BR.coop.emit('campAsk', dead ? { by: myName(), r: myChar(), dead: true } : { by: myName(), r: myChar() });
  if (!sent) { say('队友的游戏版本旧，回不了营地', 2600); return false; }
  const name = peerName();
  const ms = (num(+cfg('askSec'), 15) * 1000) + ASK_GRACE_MS;
  // 背包里有东西：先说清楚回营地带不回去（「算了」就还来得及）
  const txt = '等「' + name + '」同意…' + (bagCount() > 0 ? '（背包里的东西带不回营地）' : '');
  const n = has(BR.hud, 'notice') ? BR.hud.notice(txt, [{ label: '算了', fn: withdraw }], ms, {
    countdown: false,
    onTimeout() { if (S.ask) { S.ask = null; say('「' + name + '」没有回应', 2600); } },
  }) : null;
  S.ask = { at: nowMs(), n };
  return true;
}
function withdraw() {
  if (!S.ask) return;
  S.ask = null;
  if (active() && has(BR.coop, 'emit')) BR.coop.emit('campAsk', { by: myName(), r: myChar(), off: true });
}
function closeAsk() { if (S.ask) { if (S.ask.n) S.ask.n.close(); S.ask = null; } }
function closeAskIn() { if (S.askIn) { if (S.askIn.n) S.askIn.n.close(); S.askIn = null; } }
function onCampAsk(p) {
  if (!p) return;
  if (p.off) { closeAskIn(); return; }
  if (!canAsk()) return;
  if (S.ask) { closeAsk(); answer(true, false, true); return; }   // 两人同时想回
  closeAskIn();
  const by = String(p.by || peerName()).slice(0, 16);
  const ms = num(+cfg('askSec'), 15) * 1000;
  const at = nowMs();
  // 对方是在结算页（倒下了）提出的：照实说；自己背包里有东西：提醒带不回去
  const txt = '「' + by + '」' + (p.dead ? '倒下了，' : '') + '想回营地' + (bagCount() > 0 ? '（你背包里的东西带不回去）' : '');
  const n = has(BR.hud, 'notice') ? BR.hud.notice(txt, [
    { label: '同意', fn: () => answer(true, false) },
    { label: '不要', fn: () => answer(false, false) },
  ], ms, {
    // 到时：这段时间一点输入都没有（挂机、去倒水了）才按同意处理；有输入却没回应 = 还想接着玩
    onTimeout() { if (S.askIn && S.askIn.at === at) answer(S.inputAt <= at, true); },
  }) : null;
  S.askIn = { at, n, by };
  if (!n) answer(true, true);
}
function answer(yes, auto, quiet) {
  const had = !!S.askIn || quiet;
  closeAskIn();
  if (!had || !active()) return;
  if (!yes) { BR.coop.emit('campNo', { by: myName(), r: myChar(), auto: !!auto }); return; }
  if (isHost()) hostGoCamp();
  else BR.coop.emit('campYes', { by: myName(), r: myChar() });
}
function hostGoCamp() {
  closeAsk(); closeAskIn();
  if (G.phase !== 'idle' || inCamp() || !active() || !isHost()) return;
  BR.coop.emit('campGo', { by: myName() });
  beginTransit('camp', '回营地', false);
}
function onCampYes() {
  if (!S.ask) return;
  closeAsk();
  if (isHost()) hostGoCamp();
}
function onCampNo(p) {
  if (!S.ask) return;
  closeAsk();
  say('「' + String((p && p.by) || peerName()).slice(0, 16) + '」还想接着玩', 2600);
}
function onCampGo() {
  closeAsk(); closeAskIn();
  if (isHost() || G.phase !== 'idle' || inCamp()) return;
  beginTransit('camp', '回营地', false);
}

// ---------- 营地里落单 ----------
function onPeerGone(p) {
  const name = String((p && p.name) || S.peerName || '队友').slice(0, 16);
  closeAsk(); closeAskIn();
  // 过场里：还在原地就把灯还回去，已经进了新层就直接亮
  if (G.phase !== 'idle') endTransit(!G.entered);
  const st = S.state;
  if (st) { st.tin[1] = false; clearReady(st); S.beat = -1; }
  const where = p && p.where ? p.where : (inCamp() ? 'camp' : 'level');
  if (where !== 'camp' || !inCamp()) { render(false); return; }
  if (st) { st.v = ++S.vSeen; render(false); }
  if (S.gone && S.gone.open) S.gone.close();
  if (!has(BR.hud, 'notice')) { toast('「' + name + '」离开了营地', 4000); return; }
  S.gone = BR.hud.notice('「' + name + '」离开了营地', [
    { label: '再开一个营地等朋友', fn: reopen },
    { label: '回主页', fn: goHome },
  ], 0);
}
function reopen() {
  if (!has(BR.coop, 'createRoomInPlace')) { toast('页面没更新完整，请刷新', 3000); return; }
  let r;
  try { r = BR.coop.createRoomInPlace(); } catch (err) { console.error('[coopCamp] 重开营地出错', err); }
  if (r && typeof r.then === 'function') r.then(code => { if (code) { S.boardAt = 0; toast('营地开好了，房号 ' + fmtCode(code), 3500); } }, () => {});
}
function goHome() {
  if (has(BR.coop, 'leave')) { try { BR.coop.leave(); } catch (err) { /* 已经断了 */ } }
  BR.bus.emit('game:home');
}

// ---------- 两块运行时网格 ----------
function scene() { return (BR.gfx && BR.gfx.scene) || null; }
function makePlane(w, h, cw, ch, transparent) {
  const T = window.THREE;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const tex = new T.CanvasTexture(canvas);
  tex.encoding = T.sRGBEncoding;
  tex.anisotropy = 4;
  const mat = new T.MeshPhongMaterial({
    map: tex, emissive: 0x262626, emissiveMap: tex, shininess: 4, specular: 0x080808,
    transparent: false, alphaTest: transparent ? 0.4 : 0,
  });
  mat.name = 'coopcamp:canvas';
  const geo = new T.PlaneGeometry(w, h);
  const mesh = new T.Mesh(geo, mat);
  mesh.name = 'coopcamp:canvas';
  mesh.matrixAutoUpdate = false;
  return { mesh, tex, canvas, sig: null };
}
function buildMeshes(d) {
  disposeMeshes();
  const sc = scene();
  if (!sc || !window.THREE) return;
  // 小黑板：层级给的板面中心已经在板面前 3 mm（不和板面共面）；yaw 是 PlaneGeometry 的 rotation.y（0 = 正面朝 +Z），
  // 万一给反了（法线朝帐篷里），按「朝帐篷外」翻过来
  const B = d.board;
  if (B && num(B.x, NaN) === B.x) {
    const w = num(B.w, 0.8), h = num(B.h, 0.6);
    const o = makePlane(w, h, 512, Math.max(64, Math.round(512 * h / w)), false);
    let yaw = num(B.yaw, 0);
    const c = tentCenter(d);
    if ((B.x - c.x) * Math.sin(yaw) + (B.z - c.z) * Math.cos(yaw) < 0) yaw += Math.PI;
    o.mesh.rotation.set(0, yaw, 0);
    o.mesh.position.set(B.x, num(B.y, 1.3), B.z);
    o.mesh.updateMatrix();
    sc.add(o.mesh);
    S.board = o;
    drawBoard(true);
  }
  // 桌面纸：层级给的 y 已经比桌面高 3 mm（不和桌面共面），平放；字头朝桌子里侧（站位看过去是正的）。
  // map.w / map.d 是世界 x / z 方向的长度：读的人朝 ±z 看时纸宽 = w，朝 ±x 看时纸宽 = d
  const M = d.tent.map;
  if (M && num(M.x, NaN) === M.x) {
    const stand = (d.tent.stand && d.tent.stand[0]) || { x: M.x + S.out.x, z: M.z + S.out.z };
    let fx = M.x - stand.x, fz = M.z - stand.z;
    if (Math.abs(fx) > Math.abs(fz)) { fx = Math.sign(fx); fz = 0; } else { fz = Math.sign(fz) || -1; fx = 0; }
    const w = fx ? num(M.d, 0.5) : num(M.w, 1.2), dep = fx ? num(M.w, 1.2) : num(M.d, 0.5);
    const o = makePlane(w, dep, 1024, Math.max(64, Math.round(1024 * dep / w)), true);
    o.mesh.rotation.order = 'YXZ';
    o.mesh.rotation.set(-Math.PI / 2, Math.atan2(-fx, -fz), 0);
    o.mesh.position.set(M.x, num(M.y, 0.75), M.z);
    o.mesh.updateMatrix();
    sc.add(o.mesh);
    S.paper = o;
    drawPaper(o);
  }
}
function disposeOne(o) {
  if (!o) return;
  if (o.mesh.parent) o.mesh.parent.remove(o.mesh);
  o.mesh.geometry.dispose();
  o.mesh.material.dispose();
  o.tex.dispose();
}
function disposeMeshes() {
  disposeOne(S.board); disposeOne(S.paper);
  S.board = null; S.paper = null;
}
// 一行字缩到放得下
function fitFont(ctx, text, maxW, size, family, weight) {
  let s = size;
  ctx.font = (weight || '') + ' ' + s + 'px ' + family;
  while (s > 10 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = (weight || '') + ' ' + s + 'px ' + family; }
  return s;
}
function boardSig() {
  const st = S.state;
  const code = BR.coop ? BR.coop.code : null;
  const hosting = !!(BR.coop && BR.coop.hosting);
  return JSON.stringify([active(), hosting, code, myName(), peerName(), st ? [st.lv, st.mode, st.diff, st.ws, st.rdy, isHost()] : null]);
}
function drawBoard(force) {
  const o = S.board;
  if (!o) return;
  const sig = boardSig();
  if (!force && sig === o.sig) return;
  o.sig = sig;
  const c = o.canvas, ctx = c.getContext('2d'), W = c.width, H = c.height;
  // 黑板底色 + 擦过的粉笔灰
  ctx.fillStyle = '#26352b';
  ctx.fillRect(0, 0, W, H);
  const rnd = U.rng(20261002, 'board');
  ctx.fillStyle = 'rgba(220,230,220,0.05)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rnd() * W, rnd() * H, 30 + rnd() * 90, 6 + rnd() * 16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eef0e6';
  const st = S.state;
  const hosting = !!(BR.coop && BR.coop.hosting);
  const code = BR.coop && BR.coop.code;
  if (!active() && hosting && code) {
    ctx.fillStyle = '#cfd6c8';
    ctx.font = '600 ' + Math.round(H * 0.11) + 'px ' + CHALK_FONT;
    ctx.fillText('房号', W / 2, H * 0.2);
    ctx.fillStyle = '#ffffff';
    fitFont(ctx, fmtCode(code), W * 0.9, Math.round(H * 0.3), MONO_FONT, '700');
    ctx.fillText(fmtCode(code), W / 2, H * 0.5);
    ctx.fillStyle = '#e8e2a8';
    ctx.font = '600 ' + Math.round(H * 0.12) + 'px ' + CHALK_FONT;
    ctx.fillText('等朋友来', W / 2, H * 0.8);
  } else if (active() && st) {
    const m = st.ws ? findMap(st, st.ws) : null;
    const l1 = '下一站：' + (m ? '「' + m.name + '」' : lvName(runLv(st)));
    fitFont(ctx, l1, W * 0.9, Math.round(H * 0.15), CHALK_FONT, '700');
    ctx.fillText(l1, W / 2, H * 0.22);
    ctx.fillStyle = '#e8e2a8';
    const l2 = modeLabel(st);
    fitFont(ctx, l2, W * 0.9, Math.round(H * 0.12), CHALK_FONT, '600');
    ctx.fillText(l2, W / 2, H * 0.45);
    // 两个人的准备勾
    const names = isHost() ? [myName(), peerName()] : [peerName(), myName()];
    ctx.fillStyle = '#eef0e6';
    for (let i = 0; i < 2; i++) {
      const y = H * (0.66 + i * 0.16);
      const t = String(names[i]).slice(0, 8) + '  ' + (st.rdy[i] ? '✓ 准备好了' : '○');
      fitFont(ctx, t, W * 0.86, Math.round(H * 0.1), CHALK_FONT, '600');
      ctx.fillText(t, W / 2, y);
    }
  } else {
    ctx.font = '700 ' + Math.round(H * 0.15) + 'px ' + CHALK_FONT;
    ctx.fillText('联机营地', W / 2, H * 0.36);
    ctx.fillStyle = '#e8e2a8';
    ctx.font = '600 ' + Math.round(H * 0.11) + 'px ' + CHALK_FONT;
    ctx.fillText(active() ? '朋友到了' : S.hadPeer ? '朋友走了' : '等朋友来', W / 2, H * 0.62);
  }
  o.tex.needsUpdate = true;
}
// 纸边抖一点：手画的感觉（固定种子，两边、每次一样）
function wobbleRect(ctx, rnd, x, y, w, h, j) {
  ctx.beginPath();
  ctx.moveTo(x + (rnd() - 0.5) * j, y + (rnd() - 0.5) * j);
  ctx.lineTo(x + w + (rnd() - 0.5) * j, y + (rnd() - 0.5) * j);
  ctx.lineTo(x + w + (rnd() - 0.5) * j, y + h + (rnd() - 0.5) * j);
  ctx.lineTo(x + (rnd() - 0.5) * j, y + h + (rnd() - 0.5) * j);
  ctx.closePath();
}
function arrow(ctx, x0, y0, x1, y1, s) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
  ctx.moveTo(x1, y1); ctx.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
  ctx.stroke();
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}
function drawPaper(o) {
  const c = o.canvas, ctx = c.getContext('2d'), W = c.width, H = c.height;
  const rnd = U.rng(20261002, 'paper');
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // ① 手画层级图（左半边）
  ctx.save();
  ctx.translate(W * 0.27, H * 0.5);
  ctx.rotate(-0.03);
  const mw = W * 0.5, mh = H * 0.9;
  ctx.fillStyle = '#efe7d0';
  wobbleRect(ctx, rnd, -mw / 2, -mh / 2, mw, mh, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,100,70,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#23395b'; ctx.strokeStyle = '#23395b';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = Math.round(mh * 0.1) + 'px ' + PAPER_FONT;
  ctx.fillText('层级图', -mw / 2 + mw * 0.05, -mh / 2 + mh * 0.04);
  const ids = levelIds().slice(0, 12);
  const cols = 4, bw = mw * 0.15, bh = mh * 0.15, gx = mw * 0.22, gy = mh * 0.24;
  const ox = -mw / 2 + mw * 0.12, oy = -mh / 2 + mh * 0.22;
  const pos = ids.map((id, i) => {
    const row = Math.floor(i / cols), k = i % cols, col = row % 2 ? cols - 1 - k : k;   // 蛇形：一行往右、下一行往左
    return { id, x: ox + col * gx, y: oy + row * gy };
  });
  ctx.lineWidth = 2.5;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    wobbleRect(ctx, rnd, p.x, p.y, bw, bh, 3);
    ctx.stroke();
    ctx.font = Math.round(bh * 0.55) + 'px ' + PAPER_FONT;
    ctx.fillText(p.id, p.x + bw / 2, p.y + bh / 2 + 1);
    if (i > 0) {
      const a = pos[i - 1];
      if (Math.abs(a.y - p.y) < 1) {
        const dir = p.x > a.x ? 1 : -1;
        arrow(ctx, dir > 0 ? a.x + bw + 4 : a.x - 4, a.y + bh / 2, dir > 0 ? p.x - 4 : p.x + bw + 4, p.y + bh / 2, 9);
      } else arrow(ctx, a.x + bw / 2, a.y + bh + 4, p.x + bw / 2, p.y - 4, 9);
    }
  }
  // 「我们在这」：Level 1 旁边画个圈
  const p1 = pos.find(p => p.id === '1');
  if (p1) {
    ctx.strokeStyle = '#a3322a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p1.x + bw / 2, p1.y + bh / 2, bw * 0.75, bh * 0.85, 0.1, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a3322a';
    ctx.font = Math.round(bh * 0.4) + 'px ' + PAPER_FONT;
    ctx.fillText('营地在这', p1.x + bw / 2, p1.y - bh * 0.42);
  }
  ctx.restore();
  // ② 本子（中间）：封面写「游玩 / 噩梦 / 测试」
  ctx.save();
  ctx.translate(W * 0.655, H * 0.5);
  ctx.rotate(0.025);
  const nw = W * 0.21, nh = H * 0.82;
  ctx.fillStyle = '#6b2f2a';
  wobbleRect(ctx, rnd, -nw / 2, -nh / 2, nw, nh, 2);
  ctx.fill();
  ctx.fillStyle = '#4e211d';
  ctx.fillRect(-nw / 2, -nh / 2, nw * 0.08, nh);   // 书脊
  ctx.fillStyle = '#efe7d0';
  ctx.fillRect(-nw * 0.3, -nh * 0.32, nw * 0.68, nh * 0.6);
  ctx.fillStyle = '#2b2b2b';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = Math.round(nh * 0.12) + 'px ' + PAPER_FONT;
  ['游玩', '噩梦', '测试'].forEach((t, i) => ctx.fillText(t, nw * 0.04, -nh * 0.2 + i * nh * 0.18));
  ctx.restore();
  // ③ 纸条（右边）：「这间仓库没有门。灯灭的时候，就能切出去。」
  ctx.save();
  ctx.translate(W * 0.88, H * 0.47);
  ctx.rotate(0.07);
  const sw = W * 0.2, sh = H * 0.66;
  ctx.fillStyle = '#f3e7a1';
  wobbleRect(ctx, rnd, -sw / 2, -sh / 2, sw, sh, 3);
  ctx.fill();
  ctx.fillStyle = '#3a3226';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const fs = Math.round(sh * 0.13);
  ctx.font = fs + 'px ' + PAPER_FONT;
  const lines = [];
  for (const part of ['这间仓库没有门。', '灯灭的时候，', '就能切出去。']) for (const l of wrapLines(ctx, part, sw * 0.84)) lines.push(l);
  lines.forEach((l, i) => ctx.fillText(l, -sw / 2 + sw * 0.08, -sh / 2 + sh * 0.08 + i * fs * 1.25));
  ctx.restore();
  o.tex.needsUpdate = true;
}

// ---------- 联机状态跟踪 ----------
function ensureUse() {
  // BR.coop 换了对象（测试里换成假的）也重新登记一次
  if (has(BR.coop, 'onUse') && S.useFor !== BR.coop) { S.useOff = BR.coop.onUse('tent', onUseTent); S.useFor = BR.coop; }
  if (!S.srcAdded && has(BR.interact, 'addSource')) { BR.interact.addSource('coopTent', source); S.srcAdded = true; }
}
function trackPeer() {
  const a = active();
  if (a) { S.hadPeer = true; if (BR.coop.peerName) S.peerName = BR.coop.peerName; }
  const rc = myChar();
  if (a !== S.wasActive) {
    S.wasActive = a;
    if (a) {
      if (rc === 'g' && S.state) S.state.v = -1;   // 刚以客机身份连上：下一份房主的 state 一定收
      if (inCamp()) {
        if (rc === 'h') { const st = ensureState(); st.maps = hostMaps(); st.v = ++S.vSeen; emitState(); }
        else {
          if (has(BR.coop, 'emit')) BR.coop.emit('arrived', { lv: campId() });
          if (S.panel) guestOp('in', {});
        }
      }
    } else if (S.state) {
      // 断了（掉线、重连中、对方走了）：帐篷里只算自己，准备和倒数都清掉
      S.state.tin[1] = false;
      clearReady(S.state);
      S.beat = -1;
    }
    render(false);
    S.boardAt = 0;
  }
  if (rc !== S.roleChar) {
    const was = S.roleChar;
    S.roleChar = rc;
    // 从客机变成说了算的一方（队友走了、原地重开营地）：选择留着，帐篷里只剩自己
    if (was === 'g' && rc === 'h' && S.state) {
      const st = S.state;
      st.tin = [S.panel, false];
      st.rdy = [false, false];
      st.goAt = 0;
      st.maps = hostMaps();
      if (st.ws && !findMap(st, st.ws)) st.ws = null;
      st.v = ++S.vSeen;
      render(false);
    }
  }
}
// 队友人形的水平速度（指数平滑）：站着不动才算挡路
// 按时间平滑（时间常数 PEER_SPEED_TAU）：原来按帧平滑（每帧 ×0.75），机器卡、一秒只有几帧时，队友停下 2–3 s 了还算「在走」，
// 堵在门口也不算挡路（2026-10-05 返修 r2，coop.mjs 4b3）
function trackPeerSpeed(dt) {
  const p = active() && inCamp() ? BR.coop.peer : null;
  if (!p || !(dt > 0)) { if (!p) { S.peerPrev = null; S.peerSpeed = 0; } return; }
  if (S.peerPrev) {
    const v = Math.min(Math.hypot(p.x - S.peerPrev.x, p.z - S.peerPrev.z) / dt, 20);
    S.peerSpeed += (v - S.peerSpeed) * (1 - Math.exp(-dt / PEER_SPEED_TAU));
  } else S.peerSpeed = 0;
  S.peerPrev = { x: p.x, z: p.z };
}
// 挂钩上的制服：自己、队友身上穿的那种颜色从挂钩上藏掉（Piece.setVisible 把顶点叠成一点，不加网格），换下来的那件挂回去。
// 层级把每件的几何件放在 b.data._uniforms（{皮肤 key: [Piece]}）；区块重建（换画质）后重新取
function uniPieces() {
  if (!BR.world || !has(BR.world, 'chunks')) return null;
  for (const c of BR.world.chunks()) {
    const u = c && c.res && c.res.data && c.res.data._uniforms;
    if (u && typeof u === 'object') return u;
  }
  return null;
}
function stepHooks(force) {
  if (!inCamp()) return;
  const me = (BR.skin && BR.skin.current) || BR.game.skin;
  const peer = active() && BR.coop.peerSkin ? String(BR.coop.peerSkin) : '';
  const sig = String(me || '') + '|' + peer;
  const t = nowMs();
  // 换了颜色当帧就挂上 / 取下；颜色没变时每 HOOKS_MS 核对一次（区块重建过要重新取几何件）
  if (!force && sig === S.uniSig && t - S.uniAt < HOOKS_MS) return;
  S.uniAt = t;
  S.uniSig = sig;
  const u = uniPieces();
  if (!u) return;
  if (u !== S.uni) { S.uni = u; S.uniVis = {}; }
  const worn = new Set();
  if (me) worn.add(String(me));
  if (peer) worn.add(peer);
  for (const k of Object.keys(u)) {
    const want = !worn.has(k);
    if (S.uniVis[k] === want) continue;
    S.uniVis[k] = want;
    for (const p of (u[k] || [])) if (p && has(p, 'setVisible')) { try { p.setVisible(want); } catch (err) { /* 区块正在卸载 */ } }
  }
}
// 房主进营地落在第 0 格；那里万一被东西占着（老的营地布置），换到另一格
function hostSpawnFree() {
  const def = BR.levels && BR.levels.get(campId());
  const slots = def && Array.isArray(def.spawnSlots) ? def.spawnSlots : [];
  const P = BR.player;
  if (!P || !slots.length || !has(BR.phys, 'overlapCircle') || !has(P, 'reset')) return;
  const busy = (x, z) => { try { return !!BR.phys.overlapCircle(x, z, PLAYER_R, groundY(x, z, 0) + 0.05, 1.6); } catch (err) { return false; } };
  if (!busy(num(P.x, 0), num(P.z, 0))) return;
  const peer = active() ? BR.coop.peer : null;
  for (const s of slots) {
    if (!s || busy(s.x, s.z) || (peer && Math.hypot(s.x - peer.x, s.z - peer.z) < STAND_FREE)) continue;
    P.reset({ x: s.x, y: num(s.y, 0), z: s.z, yaw: num(s.yaw, 0) }, { full: false });
    return;
  }
}
function bagCount() {
  const inv = BR.player && Array.isArray(BR.player.inventory) ? BR.player.inventory : [];
  let n = 0;
  for (const s of inv) if (s && num(s.count, 1) > 0) n++;
  return n;
}
// 自己倒下了：告诉队友（房主那边原来一点动静都没有）
function onMyDeath() {
  if (!active() || !has(BR.coop, 'emit') || inCamp()) return;
  BR.coop.emit('down', { by: myName() });
}
function onPeerDown(p) {
  if (!active() || inCamp()) return;
  say('「' + String((p && p.by) || peerName()).slice(0, 16) + '」倒下了', 3000);
}
function onReconnected() {
  if (!inCamp()) return;
  if (isHost()) { if (S.state) { S.state.v = ++S.vSeen; emitState(); } }
  else {
    if (has(BR.coop, 'emit')) BR.coop.emit('arrived', { lv: campId() });
    if (S.panel) guestOp('in', {});
  }
}

// ---------- 每帧 ----------
// 测试模式的实体面板开着时指针本来就是放开的，「点一下画面继续」横幅会压住面板（和 coop.js hintCheck 同一条件）
function testPanelOpen() {
  try { return document.documentElement.classList.contains('br-test-open'); } catch (err) { return false; }
}

function update(dt) {
  dt = num(dt, 0) > 0 ? Math.min(dt, 0.1) : 0;
  if (!S.inited) init();
  ensureUse();
  trackPeer();
  const camp = inCamp();
  if (camp && !S.data) setupCamp();
  if (!camp && (S.board || S.paper || S.data) && G.phase === 'idle') leaveCamp();
  trackPeerSpeed(dt);
  stepWalk(dt);
  stepHooks(false);
  // 出发 / 回营地亮起来后的提示在关卡里也留着（不再要求在营地里），暂停、开选单、自动走、过场时收起
  if (S.lockNote && (BR.game.screen !== 'playing' || S.panel || S.walk || G.phase !== 'idle' || testPanelOpen())) closeLockHint();
  stepCountdown();
  stepLantern();
  stepTransit();
  flushSpawn(false);
  // 客机开着选单、房主那边还没记上「在帐篷里」：补发 in
  if (S.panel && camp && active() && !isHost() && S.state && !S.state.tin[1] && G.phase === 'idle' && nowMs() - S.inSentAt > 1500) guestOp('in', {});
  if (S.panel || S.walk || G.phase !== 'idle') { if (BR.input && BR.input.enabled) setInput(false); }
  if (S.panel) {
    if (!camp) closePanelLocal();
    else if (BR.tentMenu && has(BR.tentMenu, 'update')) {
      const st = S.state;
      const now = clock();
      BR.tentMenu.update(nowMs(), st && st.goAt && active() ? { count: Math.max(1, Math.ceil(st.goAt - now)), canCancel: now < st.goAt - CANCEL_LOCK_S } : null);
    }
  }
  if (camp && S.board && nowMs() - S.boardAt >= BOARD_SIG_MS) { S.boardAt = nowMs(); drawBoard(false); }
}
function leaveCamp() {
  closePanelLocal();
  closeLockHint();
  S.walk = null;
  restoreLantern();
  disposeMeshes();
  S.data = null; S.out = null; S.lantern = null;
  S.uni = null; S.uniVis = null; S.uniSig = ''; S.peerPrev = null; S.peerSpeed = 0;
}

// ---------- 局外 ----------
function onLevelEnter(p) {
  const id = p && p.id != null ? String(p.id) : String(BR.game.levelId);
  // 客机进了任何一层都说一声：房主据此结束等人、在营地里再发一次 state
  if (active() && BR.coop.role === 'guest' && has(BR.coop, 'emit')) BR.coop.emit('arrived', { lv: id });
  if (G.phase !== 'idle') {
    G.entered = true;
    G.enterAt = nowMs();
    if (!G.host && G.revealed && G.phase === 'wait') reveal(false);
  }
  if (id === campId()) {
    S.data = null;
    setupCamp();
    stepHooks(true);
    if (isHost()) hostSpawnFree();
    if (isHost()) {
      S.state = freshState();
      S.state.v = ++S.vSeen;
      emitState();
    } else if (S.state) {
      clearReady(S.state);
      S.state.tin = [false, false];
    }
    S.beat = -1;
  }
}
function onLevelLeave(p) {
  const id = p && p.id != null ? String(p.id) : null;
  if (id === campId() || S.data) leaveCamp();
}
function onArrived(p) {
  if (!isHost() || !active()) return;
  const lv = p && p.lv != null ? String(p.lv) : '';
  if (lv === campId() && inCamp()) { ensureState(); emitState(); }
  if (G.phase !== 'idle' && G.host && lv === String(BR.game.levelId) && G.entered) G.arrived = true;
}
function onReveal() {
  if (G.phase === 'idle' || G.host) return;
  G.revealed = true;
  if (G.entered && G.phase === 'wait') reveal(false);
}
function onCampCancel(p) {
  const st = S.state;
  if (p && p.r && p.r !== myChar() && !isHost()) toast('「' + String(p.by || peerName()).slice(0, 16) + '」取消了出发', 2000);
  else if (p && p.r === myChar() && !isHost()) toast('已取消出发', 2000);
  if (st && !isHost()) { clearReady(st); render(false); }
  // 过场已经开始（客机这边钟慢、先灭了灯）但房主取消了：还在营地就把灯还回去
  if (G.phase !== 'idle' && !G.entered && G.kind === 'run' && !G.host) endTransit(true);
}
function onGameStart(p) {
  const coop = !!(p && p.coop && p.coop.role);
  if (!coop) { resetSession(); return; }
  // 客机这边钟慢：房主的 world 先到了、本机还在营地里倒数——直接按出发处理（黑幕补上，灯不用再灭，营地马上就没了）
  if (G.phase === 'idle' && S.state && S.state.goAt && !isHost() && inCamp()) beginTransit('run', runText(S.state), false);
  closePanelLocal();
  S.walk = null;
}
function onGameHome() { resetSession(); }
function resetSession() {
  if (G.phase !== 'idle') { G.phase = 'idle'; G.token++; S.dimmed.length = 0; S.envSaved = null; G.lit = false; }
  closeAsk(); closeAskIn();
  if (S.gone && S.gone.open) S.gone.close();
  S.gone = null;
  leaveCamp();
  S.state = null; S.last = null; S.hadPeer = false; S.peerName = ''; S.beat = -1; S.bagNote = '';
  S.wasActive = active(); S.roleChar = null;
}

function init() {
  if (S.inited) return;
  S.inited = true;
  const mark = () => { S.inputAt = nowMs(); };
  ['keydown', 'pointerdown', 'touchstart'].forEach(n => window.addEventListener(n, mark, { capture: true, passive: true }));
  BR.bus.on('level:enter', onLevelEnter);
  BR.bus.on('level:leave', onLevelLeave);
  BR.bus.on('game:start', onGameStart);
  BR.bus.on('game:home', onGameHome);
  BR.bus.on('net:tent', onTentEv);
  BR.bus.on('net:campAsk', onCampAsk);
  BR.bus.on('net:campYes', onCampYes);
  BR.bus.on('net:campNo', onCampNo);
  BR.bus.on('net:campGo', onCampGo);
  BR.bus.on('net:campCancel', onCampCancel);
  BR.bus.on('net:arrived', onArrived);
  BR.bus.on('net:reveal', onReveal);
  BR.bus.on('coop:peerGone', onPeerGone);
  BR.bus.on('coop:reconnected', onReconnected);
  BR.bus.on('coop:code', () => { S.boardAt = 0; });
  BR.bus.on('player:death', onMyDeath);
  BR.bus.on('net:down', onPeerDown);
  ensureUse();
}

// 测试口：房主直接写（lv 可以是 'dev'，仍然走同一条广播路径）；客机走 use。patch.ready：自己的准备
function _debugSet(patch) {
  if (!patch || typeof patch !== 'object') return null;
  const x = { dbg: 1 };
  let pick = false;
  for (const k of SEL_KEYS) if (k in patch) { x[k] = patch[k]; pick = true; }
  if (pick) act('pick', x);
  if ('ready' in patch) act('ready', { on: !!patch.ready });
  return S.state ? copyState(S.state) : null;
}

function debugInfo() {
  return {
    inCamp: inCamp(), panel: S.panel, walking: S.walk ? S.walk.kind : null, data: !!S.data,
    state: S.state ? copyState(S.state) : null, last: S.last ? Object.assign({}, S.last) : null, vSeen: S.vSeen,
    transit: { phase: G.phase, kind: G.kind, text: G.text, host: G.host, entered: G.entered, arrived: G.arrived, revealed: G.revealed },
    ask: !!S.ask, askIn: !!S.askIn, gone: !!(S.gone && S.gone.open),
    meshes: { board: !!S.board, paper: !!S.paper }, lantern: !!S.lantern, role: myChar(), inputAt: S.inputAt,
  };
}

BR.coopCamp = {
  update, enter, exit: () => exitTent({}), back, onBack, _debugSet, debugInfo,
  get inCamp() { return inCamp(); },
  get panelOpen() { return S.panel; },
  get state() { return S.state; },
  get last() { return S.last; },
  get transit() { return G.phase; },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
})();
