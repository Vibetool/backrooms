// 后室 · 叉车联机表现（BR.vehiclesNet，方案 2026-10-06「叉车驾驶提前版」FE1-veh-remote）
// 经典 <script>，只往 window.BR 上挂东西。加载顺序：forklift.js → vehicles.js → 本文件；BR.coop、BR.kit 这时还没载入，一律用到时再取。
//
// 分工：BR.forklift = 模拟，BR.vehicles = 核心（网格、OBB、上下车），本文件 = 联机里「另一个人看到的车」和本机司机的同步：
//   ① 本机坐在车上、联机、手里有 'k:'+key 的租约：每帧 BR.coop.hand('k:'+key, x, z, yaw, steer, lift, 0, spd, on, hl)。
//      网络上仍是 coop 的 15 Hz me（hand 只写内存）；每帧刷新是为了让每一条 me 带的都是最新一帧——
//      要是这里也按 15 Hz 自己数拍子，两边节拍一错开就会有一条 me 重复上一帧、下一条跳一帧，对方看到的车一顿一顿。
//      on（发动机开着）是第 8 个值，跟着 me 的 h 走；coop 转成 'net:veh' 时带上 on（没带时按对方的姿态 ['drive', key] 推断）。
//   ② 'net:veh' { k:'k:'+key, x, z, yaw, steer, lift, tilt, spd, on? }：每台远端车一个插值缓冲（播放时钟落后最新一帧 100 ms；
//      到达时刻的网络抖动先抹掉一部分，播放时钟只调快慢（0.7–1.6 倍速）不跳），断流时最多外推 150 ms（不超过对方报的车速）然后停住；
//      每帧（位姿变了才）调 BR.vehicles.setPose(key, pose, { remote: true })，由核心更新网格和 'veh|' OBB（房主那边实体照样撞得到这台车）。
//      重新开始的一段（掉线重连后、对方重新上车）离当前显示位姿 3 m 以内时从当前位姿滑过去，不瞬移。
//   ③ 远端车的发动机循环（音调随车速）、液压泵、倒车哔哔按 3D 位置播；起动时钥匙、起动机，熄火声；大灯按 sim.lightSpot()
//      借灯池（world.setExtraLights('fkr:'+key)）。对方下车（net:veh 停了且对方不再是驾驶姿态，或 levelstate:set 收到 on:0）就熄火撤灯。
//      远端车另有一个「影子模拟」（BR.forklift.byKey(key)，没有就 BR.forklift.create）只做摆位：算大灯落点、拨开藤蔓、
//      推开地上的瓶罐（房主推的照常写 levelState 同步给客机；客机推的只改显示，以房主为准）。
//   ④ 'levelstate:set'（kind 'veh'）、'levelstate:import'、'levelstate:clear'：没人开着的车按记录摆好（升格、位姿、货叉高度，
//      发动机一律熄着）；正被人开着的车不理，以 net:veh 为准。例外：on:0 的记录 = 司机下车了（或房主按最后位姿收尾），
//      这时就算租约的「放开」还在路上也照它停车；on:1 的记录（上车那一刻的位姿）不把本机已经开过 / 摆过的车往回摆。
//      本机自己坐着的车一律不动（重连后房主补发的整层状态也不动它）。
//   ⑤ 掉线重连（BR.game.coop 还在、BR.coop.phase === 'reconnecting'）：本机坐着的车停住（核心看 phase 自己刹车），人还坐着，
//      状态行「掉线了，车先停住」；重新 active 后自动再 requestGrab('k:'+key)，拿回来接着开，拿不回来强制下车。
//      不用 leaseOf 判断掉线（重连途中它恒为 null）；连上以后租约不在自己手里（房主按超时收走了）也照这条重新拿。
//      重新拿的时候 holding 为真（核心据此让车停着），超过 0.5 s 还没拿回来状态行每 2 s 说一次「掉线了，车先停住」。
//      连接一直是 active、只是自己的消息晚到（网络卡一下、设备很卡）：房主按 3 s 超时收走租约，这边的申请排在卡住的消息后面，
//      coop 4 s 等不到回复 → 不放下车，人还坐着、车停着，接着要（从第一次要起最多 15 s）；晚到的申请到了房主那边照样批，
//      批下来接着开。实在要不回来才放下车（「没连上，再试一次」），这时 coop.release 照样把本机这台车的位姿带给房主
//      （房主走「超时以后他才下车」那条路停车并广播），两边的车停在同一个地方（FE1 返修 r2）。
//   ⑥' 仪表台大灯开关（hl，1 开 / 0 关，缺省开）：本机司机经 coop.hand 的第 10 个值发出去，net:veh 带 hl；
//      远端车 hl 为 0 时不借灯池、灯罩按熄灭画（核心看 pose.hl）；levelState.vehicles 的 hl 原样摆回。
//   ⑥ debugInfo()：每台远端车的缓冲长度、最后一帧时间、插值误差，本机发送和重连的状态。
//
// 每帧驱动：main.js 的 tick 在 simulate 段里、safe('vehicles','update',dt) 之前调 safe('vehiclesNet','update',dt)
//   （先把远端车摆到这一帧的位姿，核心随后更新网格；联机暂停 / 结算时 simulate 照跑，本机司机照样发、远端车照样动）。
//
// 接口（BR.vehiclesNet）：
//   update(dt)                         每帧（见上）；dt 不用，插值按墙钟走（和 net:veh 的到达时刻同一条时间线）
//   holding                            本机坐着的车因为联机原因要停着（掉线重连中、重新拿租约中）
//   remote(key) → { x, z, yaw, steer, lift, spd, lever, on, active } | null   远端车当前显示的位姿
//   debugInfo() → { updates, remotes: { key: { buf, n, active, lastAt, ageMs, lagMs, err, errMax, on, light, lightAt, loops, shadow, pose } },
//                   send: { key, n, at, on, lease }, net: { coop, role, phase, holding, regrab, lastRegrab }, ls: { … } }
//   _feed(p)                           测试口：等于收到一条 'net:veh'
//   _reset()                           测试口：远端表现全部收掉
(function () {
'use strict';
const BR = window.BR;

// ---------- 文案（界面文字里不出现 E） ----------
const T = {
  offline: '掉线了，车先停住',
  peer: '队友在开叉车',
  retry: '没连上，再试一次',
};

// ---------- 常量 ----------
const DELAY = 0.1;            // 插值缓冲：播放时钟落后最新一帧 100 ms
const EXTRAP = 0.15;          // 断流时最多外推 150 ms
const STALE = 0.6;            // 这么久没收到 net:veh 算断流
const RESTART_GAP = 0.5;      // 相邻两帧隔这么久：算新的一段（重连、重新上车）
const SNAP = 1.0;             // 播放时钟偏离目标超过它就直接对齐（平时只调快慢，见 WARP）
const JITTER_MAX = 0.05, JITTER_PULL = 0.7;         // 到达时刻离预测 50 ms 以内：时间戳 = 预测 + 0.7 × 偏差
const WARP = 1.5, WARP_MIN = 0.7, WARP_MAX = 1.6, WARP_TAU = 0.5;   // 播放速度 = 1 + 平滑后的偏差（秒）× 1.5，夹在 0.7–1.6 倍
const BUF_MAX = 48;
const BLEND_MAX = 3;          // 新的一段离当前显示位姿 3 m 以内：滑过去（时长按 4 m/s 算，0.1–0.5 s）；更远直接跳
const BLOCK_AFTER_LS = 0.5;   // 按 on:0 的记录停车后，这么久之内到的旧 net:veh 不理（me 和事件走不同的通道，可能后到）
const LEVER = 0.35, LEVER_RATE = 6;   // 升降杆：跟着货叉升降扳到 ±0.35 rad
const HYD_EPS = 0.01;         // lift（0..1）每秒变化超过它算在升降（液压泵响）
const HYD_HOLD = 0.12;
const REV_SPD = -0.05;
const IGNITE_DELAY = 0.5;     // 对方刚坐上去（on 还是 0）：再过这么久放钥匙、起动机（对方那边是落座后 0.6 s 点火，这边本来就晚 0.1 s）
const PUSH_STILL = 0.3;       // 推开的瓶罐：车停稳这么久就松手（一次写 levelState）
const PUSH_EVERY = 0.5;       // 一直在开：每隔这么久也松一次手，免得一直攥着
const PUSH_SUB_D = 0.1, PUSH_SUB_A = 0.08, PUSH_SUB_MAX = 24;   // 一帧挪得多时切段推：每段 ≤10 cm、≤0.08 rad，最多 24 段
const VINE_TAIL = 2.0;        // 车停了 / 走了以后藤蔓还要这么久摆回去
const RC_NOTE_MS = 2600, RC_NOTE_EVERY = 2.0;
const REGRAB_WAIT = 6;        // coop 自己 4 s 没回音会回 (false, 'timeout')；这里再兜一层
// 连接还在（phase 'active'）、只是房主的回复没等到（客机的消息晚到好几秒：网络卡一下、设备很卡）：人还坐着、车停着，接着要；
// 从第一次要起最多要这么久，还要不回来才放下车（「没连上，再试一次」）。真断线时 coop 会进 reconnecting，走 ⑤ 那条路
const REGRAB_GIVEUP = 15;
const HOLD_NOTE_AFTER = 0.5;  // 重新要租约超过这么久还没要回来：状态行「掉线了，车先停住」（每 2 s 一次），要回来就不再说
// 大灯兜底（影子模拟的 lightSpot() 没给的字段）：数值跟 BR.forklift.config.light 走，这里只是 forklift.js 没加载时的默认
const HEADLIGHT = { color: 0xfff0d8, intensity: 3.2, range: 8, decay: 2, flicker: 0 };
function headlight() {
  const c = BR.forklift && BR.forklift.config && BR.forklift.config.light;
  return { color: c && c.color != null ? c.color : HEADLIGHT.color, intensity: num(c && c.intensity, HEADLIGHT.intensity), range: num(c && c.range, HEADLIGHT.range), decay: HEADLIGHT.decay, flicker: 0 };
}
const EPS = 1e-4;

// ---------- 状态 ----------
const RM = new Map();         // 车 key → 远端车记录
const S = {
  updates: 0,                 // update 被调过几次（main 没接上时一直是 0，debugInfo 里看得出来）
  send: { key: null, n: 0, at: 0, on: 0 },
  holdNet: false,
  rcWas: false,               // 本机坐着时经历过 reconnecting：连回来要重新拿租约
  rcNoteAt: -1e9,
  regrab: null,               // { key, t0, done, ok, why }
  regrabSince: 0,             // 这一轮重新要租约从什么时候开始（墙钟秒；要回来、下车、进重连时清零）
  regrabTries: 0,             // 这一轮已经要了几次（连接还在时没等到回复会接着要）
  lastRegrab: null,
  lastFinish: null,
  ls: { set: 0, import: 0, clear: 0, applied: 0, skipSeat: 0, skipBusy: 0, skipSame: 0 },
  warned: new Set(),
};

// ---------- 小工具 ----------
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function nowS() { return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000; }
function wrap(a) { a = a % (Math.PI * 2); if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; }
function adiff(a, b) { return wrap(b - a); }
function once(k, fn) { if (S.warned.has(k)) return; S.warned.add(k); try { fn(); } catch (err) { /* 忽略 */ } }
function stripKey(k) { return k == null ? '' : String(k).replace(/^k:/, ''); }
function curLv() { return BR.game && BR.game.levelId != null ? String(BR.game.levelId) : null; }
function inWorld() { const s = BR.game && BR.game.screen; return s === 'playing' || s === 'paused' || s === 'dead'; }
function editing() { return !!(BR.workshop && BR.workshop.editing); }
function VH() { return BR.vehicles || null; }
function seatedKey() { const v = VH(); const k = v ? v.seated : null; return k != null ? String(k) : null; }
function coopOn() { const g = BR.game && BR.game.coop; return !!(g && g.active); }
function coopRole() {
  const g = BR.game && BR.game.coop;
  if (g && g.active && g.role) return g.role;
  return BR.coop && BR.coop.active ? BR.coop.role : null;
}
function phase() { try { return BR.coop ? BR.coop.phase : null; } catch (err) { return null; } }
function leaseOf(k) {
  const C = BR.coop;
  if (!has(C, 'leaseOf')) return null;
  try { return C.leaseOf(k); } catch (err) { return null; }
}
// 对方现在的姿态是不是坐在这台车上（me 里捎带的 pose：['drive', 车 key]）
function peerDriving(key) {
  const C = BR.coop;
  let pp = null;
  try { pp = C ? C.peerPose : null; } catch (err) { pp = null; }
  return !!(pp && pp.mode === 'drive' && stripKey(pp.key) === key);
}
function vehRec(key) {
  const v = VH();
  if (!has(v, 'byKey')) return null;
  try { return v.byKey(key) || null; } catch (err) { return null; }
}
function sfx(name, pos) {
  if (!has(BR.audio, 'play')) return null;
  try { return BR.audio.play(name, pos); } catch (err) { return null; }
}
function note(text, ms) {
  const H = BR.hud;
  try {
    if (has(H, 'driveNote')) H.driveNote(text, ms);
    else if (has(H, 'toast')) H.toast(text, ms);
  } catch (err) { /* 忽略 */ }
}
function toast(text, ms) { if (has(BR.hud, 'toast')) { try { BR.hud.toast(text, ms || 1800); } catch (err) { /* 忽略 */ } } }

// ---------- 远端车记录 ----------
function remoteRec(key) {
  let r = RM.get(key);
  if (r) return r;
  r = {
    key,
    buf: [],                  // [{ t, x, z, yaw, steer, lift, spd, on, seed? }]，t = 收到的时刻（秒，墙钟），单调；seed = 重新开始时垫的当前位姿
    rt: 0,                    // 播放时钟（和 t 同一条时间线）
    eF: 0,                    // 播放时钟偏差（平滑后）
    gapEma: 0,                // 两帧平均间隔（秒）
    lastWall: 0,              // 上一帧推进播放时钟时的墙钟
    lastRecv: -1e9,
    n: 0,                     // 收到的帧数
    err: 0, errMax: 0,        // 插值误差：新帧到达时，已经显示过的那一刻按新缓冲该在哪，和实际显示的差多远（米；外推猜错了才不为 0）
    active: false,            // 有一段流在播
    blockUntil: -1e9,
    shown: { x: 0, z: 0, yaw: 0, steer: 0, lift: 0, spd: 0, lever: 0, on: 0, hl: 1 },
    shownRt: 0,               // shown 是按哪个播放时刻取的
    hasShown: false,
    sig: '',
    on: false,                // 发动机（声音、大灯）现在开着
    igniteAt: 0,
    liftVel: 0, hydT: 0,
    loops: { engine: null, hyd: null, rev: null },
    light: null, lightOn: false,
    shadow: null, shadowOwn: false, shPose: null,   // shPose：上一次交给影子的位姿
    stillT: 0, pushAcc: 0, pushed: false,
    endWall: -1e9,            // 停下 / 结束的时刻（藤蔓还要摆回去）
    moveWall: -1e9,
  };
  RM.set(key, r);
  return r;
}

// ---------- ② 收 net:veh ----------
function onNetVeh(p) {
  if (!p || typeof p !== 'object') return;
  const key = stripKey(p.k != null ? p.k : p.key);
  if (!key || editing() || !inWorld()) return;
  if (seatedKey() === key) return;   // 本机坐着的车以本机模拟为准
  const x = +p.x, z = +p.z;
  if (!isFinite(x) || !isFinite(z)) return;
  const wall = nowS();
  const old = RM.get(key);
  if (old && wall < old.blockUntil && !peerDriving(key)) return;
  const r = old || remoteRec(key);
  const s = {
    t: wall, x, z,
    yaw: wrap(num(+p.yaw, 0)), steer: num(+p.steer, 0), lift: clamp(num(+p.lift, 0), 0, 1), spd: num(+p.spd, 0),
    on: p.on == null ? null : (+p.on ? 1 : 0),
    hl: p.hl == null ? null : (+p.hl ? 1 : 0),   // 仪表台大灯开关（旧版不发：null = 按开着算）
  };
  const gap = wall - r.lastRecv;
  r.lastRecv = wall;
  r.n++;
  const last = r.buf.length ? r.buf[r.buf.length - 1] : null;
  if (!r.active || !last || wall - last.t > RESTART_GAP) { restart(r, s, wall); return; }
  // 时间戳：到达时刻有网络抖动，先按「上一帧的时间戳 + 平均间隔」预测，取预测和到达时刻的 3:7 加权（到达时刻离预测 50 ms 以上，
  // 丢帧、对方卡了一下，就直接用到达时刻）。对方是按帧发的、间隔本来就不完全匀，所以只抹掉一部分
  r.gapEma = r.gapEma > 0 ? r.gapEma + (clamp(gap, 0.01, 0.5) - r.gapEma) * 0.1 : clamp(gap, 0.01, 0.5);
  const pred = last.t + r.gapEma, dev = wall - pred;
  s.t = Math.max(Math.abs(dev) < JITTER_MAX ? pred + dev * JITTER_PULL : wall, last.t + 0.004);
  r.buf.push(s);
  if (r.buf.length > BUF_MAX) r.buf.splice(0, r.buf.length - BUF_MAX);
  // 插值误差：已经显示过的那一刻，按新缓冲该在哪（在两帧之间插值的不变；外推猜错了才有差）
  if (r.hasShown) {
    const q = sampleAt(r, r.shownRt, tmpQ);
    const d = Math.hypot(q.x - r.shown.x, q.z - r.shown.z);
    r.err = d;
    if (d > r.errMax) r.errMax = d;
  }
}
// 新的一段：清缓冲；离当前显示位姿不远就先垫一帧当前位姿，从那里滑过去
function restart(r, s, wall) {
  const wasActive = r.active;
  r.buf.length = 0;
  r.active = true;
  r.err = 0;
  r.eF = 0;
  r.gapEma = 0;
  let cur = r.hasShown ? r.shown : null;
  const v = vehRec(r.key);
  if (v && v.pose && (!cur || !wasActive)) cur = v.pose;
  const d = cur ? Math.hypot(num(cur.x, s.x) - s.x, num(cur.z, s.z) - s.z) : Infinity;
  const dyaw = cur ? Math.abs(adiff(num(cur.yaw, s.yaw), s.yaw)) : 0;
  const dl = cur ? Math.abs(num(cur.lift, s.lift) - s.lift) : 0;
  if (cur && d <= BLEND_MAX && (d > 0.02 || dyaw > 0.01 || dl > 0.005)) {
    // 垫的这一帧 = 当前显示的位姿，时刻取「blend 秒之前」和「上一次推进播放时钟的时刻」里早的那个：
    // 本机帧率正常时从当前位姿滑 blend 秒过去；本机一帧比两帧间隔还长（机器很卡）时不会每来一帧就被拉回原地
    const blend = clamp(d / 4, DELAY, 0.5);
    const t0 = r.lastWall > 0 ? Math.min(s.t - blend, r.lastWall) : s.t - blend;
    r.buf.push({ t: t0, x: +cur.x, z: +cur.z, yaw: wrap(num(cur.yaw, s.yaw)), steer: num(cur.steer, s.steer),
      lift: clamp(num(cur.lift, s.lift), 0, 1), spd: 0, on: s.on, hl: s.hl, seed: true });
    r.rt = t0;
  } else {
    r.rt = s.t - DELAY;   // 第一帧：先原样摆着，等后面的帧到了再走
  }
  r.buf.push(s);
  if (!(r.lastWall > 0)) r.lastWall = wall;   // 播放时钟从上一次推进的时刻接着走（新记录从现在起）
  if (!wasActive && !r.on && s.on === 0) r.igniteAt = wall + IGNITE_DELAY;
}

// 按播放时刻取位姿：区间内线性插值（yaw 走短弧）；早于第一帧取第一帧；晚于最后一帧外推（≤150 ms，按最后两帧的速度）
const tmpQ = { x: 0, z: 0, yaw: 0, steer: 0, lift: 0, spd: 0, on: null, hl: null, extra: 0 };
function sampleAt(r, t, out) {
  const b = r.buf, n = b.length;
  out.extra = 0;
  if (!n) return out;
  if (t <= b[0].t) return copyS(b[0], out);
  const L = b[n - 1];
  if (t >= L.t) {
    copyS(L, out);
    out.extra = t - L.t;
    if (n < 2) return out;
    const P = b[n - 2], gap = L.t - P.t, ex = Math.min(t - L.t, EXTRAP);
    if (ex > 0 && !P.seed && gap > 0.02 && gap < 0.3) {   // 垫的那一帧不是真速度，不拿它外推
      // 速度按最后两帧算，但不超过对方报的车速：时间戳有误差时不至于冲过头。车身原点在后轮转向的车上打着方向时
      // 还有横向分量（原点离前轴 0.62 m、轴距 1.42 m），上限按 车速 × √(1 + (0.44·tan 转角)²) 放宽
      let vx = (L.x - P.x) / gap, vz = (L.z - P.z) / gap;
      const kk = 0.44 * Math.tan(Math.min(1.2, Math.abs(num(L.steer, 0))));
      const v = Math.hypot(vx, vz), cap = Math.abs(num(L.spd, 0)) * Math.sqrt(1 + kk * kk) + 0.05;
      if (v > cap) { vx *= cap / v; vz *= cap / v; }
      out.x += vx * ex;
      out.z += vz * ex;
      out.yaw = wrap(out.yaw + adiff(P.yaw, L.yaw) / gap * ex);
    }
    return out;
  }
  let i = n - 2;
  while (i > 0 && b[i].t > t) i--;
  const A = b[i], B = b[i + 1];
  const u = B.t > A.t ? clamp((t - A.t) / (B.t - A.t), 0, 1) : 1;
  out.x = A.x + (B.x - A.x) * u;
  out.z = A.z + (B.z - A.z) * u;
  out.yaw = wrap(A.yaw + adiff(A.yaw, B.yaw) * u);
  out.steer = A.steer + (B.steer - A.steer) * u;
  out.lift = A.lift + (B.lift - A.lift) * u;
  out.spd = A.spd + (B.spd - A.spd) * u;
  out.on = B.on != null ? B.on : A.on;
  out.hl = B.hl != null ? B.hl : A.hl;
  return out;
}
function copyS(s, o) { o.x = s.x; o.z = s.z; o.yaw = s.yaw; o.steer = s.steer; o.lift = s.lift; o.spd = s.spd; o.on = s.on; o.hl = s.hl; return o; }
// 已经显示过的时刻以前的帧只留一帧（插值误差要回看 shownRt）
function trim(r) {
  const b = r.buf, t = Math.min(r.rt, r.shownRt);
  let k = 0;
  while (k < b.length - 2 && b[k + 1].t <= t) k++;
  if (k > 0) b.splice(0, k);
}

// ---------- 远端车每帧 ----------
const tmpP = { x: 0, z: 0, yaw: 0, steer: 0, lift: 0, spd: 0, on: null, hl: null, extra: 0 };
function stepRemote(r, wall) {
  const el = r.lastWall ? clamp(wall - r.lastWall, 0, 1) : 0;
  r.lastWall = wall;
  if (seatedKey() === r.key) { endRemote(r); RM.delete(r.key); return; }
  if (r.active) {
    // 播放时钟：目标 = 最新一帧 − 100 ms。不跳，只调快慢（0.7–1.6 倍速）慢慢追上 / 等一等；偏得离谱（> 1 s）才直接对齐
    // 偏差先按 0.5 s 平滑（每来一帧目标就往前跳一格，不平滑的话车速会跟着一顿一顿）
    const L = r.buf[r.buf.length - 1];
    let e = L ? (L.t - DELAY) - r.rt : 0;
    if (Math.abs(e) > SNAP) { r.rt += e; e = 0; r.eF = 0; }
    r.eF += (e - r.eF) * Math.min(1, el / WARP_TAU);
    r.rt += el * clamp(1 + r.eF * WARP, WARP_MIN, WARP_MAX);
    trim(r);
    const fresh = wall - r.lastRecv < STALE;
    const driving = fresh || peerDriving(r.key);
    const q = sampleAt(r, r.rt, tmpP);
    if (!driving) {
      finish(r, q, wall, 'stale');
    } else {
      const newest = r.buf[r.buf.length - 1];
      // 发动机：帧里带了 on 就听它的；没带（老 coop）就按「有人坐着」算
      const on = newest && newest.on != null ? newest.on === 1 : true;
      applyPose(r, q, on, el, wall);
      if (on !== r.on) setEngine(r, on, wall);
      if (on) r.igniteAt = 0;
      else if (r.igniteAt && wall >= r.igniteAt) { r.igniteAt = 0; sfx('fk_ignite', posOf(r)); }
    }
  }
  updateSound(r);
  updateLight(r);
  updateVines(r, el, wall);
  if (!r.active && !r.on && wall - r.endWall > VINE_TAIL) { dropShadow(r); RM.delete(r.key); }
}
function posOf(r) { const v = vehRec(r.key); const y = v && v.pose ? num(v.pose.y, 0) : 0; return { x: r.shown.x, y: y + 1, z: r.shown.z }; }
function applyPose(r, q, on, el, wall) {
  const sh = r.shown;
  const prevLift = r.hasShown ? sh.lift : q.lift;
  const moved = !r.hasShown || Math.abs(q.x - sh.x) > EPS || Math.abs(q.z - sh.z) > EPS || Math.abs(adiff(sh.yaw, q.yaw)) > EPS ||
    Math.abs(q.lift - sh.lift) > 1e-5 || Math.abs(q.steer - sh.steer) > EPS;
  // 升降杆：货叉在升就往后扳、在降就往前推，停了回中
  r.liftVel = el > 0 ? (q.lift - prevLift) / el : 0;
  if (Math.abs(r.liftVel) > HYD_EPS) { r.hydT = HYD_HOLD; r.hydDir = r.liftVel > 0 ? 1 : -1; }
  else r.hydT = Math.max(0, r.hydT - el);
  const lv = r.hydT > 0 ? (r.hydDir || 0) * LEVER : 0;
  const lever = sh.lever + clamp(lv - sh.lever, -LEVER_RATE * el, LEVER_RATE * el);
  sh.x = q.x; sh.z = q.z; sh.yaw = q.yaw; sh.steer = q.steer; sh.lift = q.lift; sh.spd = q.spd; sh.lever = lever; sh.on = on ? 1 : 0;
  if (q.hl != null) sh.hl = q.hl ? 1 : 0;
  r.shownRt = r.rt;
  r.hasShown = true;
  if (moved) { r.stillT = 0; r.moveWall = wall; } else r.stillT += el;
  // 先让影子推瓶罐（这时 phys 里还是上一帧的车身 OBB，被推的东西往前走不会被车身挡住），再交给核心换这一帧的 OBB
  shadowFollow(r, moved, el);
  const sig = Math.round(sh.x * 1e4) + ',' + Math.round(sh.z * 1e4) + ',' + Math.round(sh.yaw * 1e4) + ',' + Math.round(sh.steer * 1e3) + ',' +
    Math.round(sh.lift * 1e5) + ',' + Math.round(sh.lever * 1e3) + ',' + sh.on + ',' + sh.hl;
  if (sig !== r.sig) {
    r.sig = sig;
    const v = VH();
    if (has(v, 'setPose')) {
      try { v.setPose(r.key, { x: sh.x, z: sh.z, yaw: sh.yaw, steer: sh.steer, lift: sh.lift, spd: sh.spd, lever: sh.lever, on: sh.on, hl: sh.hl, driver: 'peer' }, { remote: true }); }
      catch (err) { once('setPose', () => console.error('[vehiclesNet] vehicles.setPose 出错', err)); }
    }
  }
}
// 熄火、撤灯、摆在最后的位姿（或记录的位姿），座位空出来
function finish(r, pose, wall, why) {
  const was = r.on;
  if (pose) {
    const sh = r.shown;
    sh.x = pose.x; sh.z = pose.z; sh.yaw = wrap(num(pose.yaw, sh.yaw)); sh.steer = num(pose.steer, sh.steer);
    sh.lift = clamp(num(pose.lift, sh.lift), 0, 1); sh.spd = 0; sh.lever = 0; sh.on = 0;
    if (pose.hl === 0 || pose.hl === 1) sh.hl = pose.hl;
    r.hasShown = true;
    r.sig = '';
    placeParked(r.key, sh);
  }
  r.active = false;
  r.buf.length = 0;
  r.igniteAt = 0;
  r.hydT = 0;
  r.endWall = wall;
  setEngine(r, false, wall, !was);
  updateSound(r);
  const shd = r.shadow;
  if (shd && pose && has(shd, 'setPose')) {
    const sh = r.shown;
    try { shd.setPose({ x: sh.x, z: sh.z, yaw: sh.yaw, steer: sh.steer, lift: sh.lift, spd: 0, lever: 0, on: 0 }); } catch (err) { /* 忽略 */ }
    const b = r.shPose || (r.shPose = { x: 0, z: 0, yaw: 0, steer: 0, lift: 0 });
    b.x = sh.x; b.z = sh.z; b.yaw = sh.yaw; b.steer = sh.steer; b.lift = sh.lift;
  }
  if (shd && r.pushed && has(shd, 'release')) { try { shd.release(); } catch (err) { /* 忽略 */ } }
  r.pushed = false;
  r.pushAcc = 0;
  S.lastFinish = { key: r.key, why, at: Math.round(wall * 1000) };
}
// 本机不再表现这台车（本机坐上去了、换层、回主页）：声音灯光收掉，不动核心里的位姿
function endRemote(r) {
  r.active = false;
  r.buf.length = 0;
  stopLoops(r);
  lightOff(r);
  r.on = false;
  dropShadow(r);
}
// 没人开的车按位姿摆好：核心升格、登记 'veh|' OBB；座位空出来，发动机熄着
function placeParked(key, p) {
  const v = VH();
  if (!has(v, 'setPose')) return false;
  const pose = { x: p.x, z: p.z, yaw: num(p.yaw, 0), steer: num(p.steer, 0), lift: clamp(num(p.lift, 0), 0, 1), spd: 0, lever: 0, on: 0 };
  if (p.n != null) pose.n = p.n;
  if (p.hl === 0 || p.hl === 1) pose.hl = p.hl;
  try { return v.setPose(key, pose, { remote: false }) !== false; }
  catch (err) { once('place', () => console.error('[vehiclesNet] vehicles.setPose（摆位）出错', err)); return false; }
}

// ---------- ③ 声音 ----------
function setEngine(r, on, wall, quiet) {
  if (on === r.on) return;
  r.on = on;
  if (!on) {
    stopLoops(r);
    lightOff(r);
    if (!quiet) sfx('fk_off', posOf(r));
  }
}
function loopStart(name, pos) {
  const A = BR.audio;
  if (!has(A, 'loop')) return null;
  try { return A.loop(name, pos) || null; } catch (err) { once('loop:' + name, () => console.error('[vehiclesNet] audio.loop 出错', name, err)); return null; }
}
function loopStop(r, k, fade) {
  const L = r.loops[k];
  if (!L) return;
  r.loops[k] = null;
  try { if (has(L, 'stop')) L.stop(fade); } catch (err) { /* 已经停了 */ }
}
function stopLoops(r) { loopStop(r, 'engine', 0.25); loopStop(r, 'hyd', 0.1); loopStop(r, 'rev', 0.05); }
function loopPos(L, pos) { if (L && has(L, 'setPos')) { try { L.setPos(pos.x, pos.y, pos.z); } catch (err) { /* 忽略 */ } } }
function updateSound(r) {
  if (!r.on || !r.active) { stopLoops(r); return; }
  const pos = posOf(r), sh = r.shown;
  if (!r.loops.engine) r.loops.engine = loopStart('fk_engine', pos);
  const E = r.loops.engine;
  if (E) {
    loopPos(E, pos);
    if (has(E, 'setRate')) { try { E.setRate(0.8 + 0.8 * Math.min(1, Math.abs(sh.spd) / 4.5) + (r.hydT > 0 ? 0.08 : 0)); } catch (err) { /* 忽略 */ } }
  }
  if (r.hydT > 0) { if (!r.loops.hyd) r.loops.hyd = loopStart('fk_hydraulic', pos); loopPos(r.loops.hyd, pos); }
  else loopStop(r, 'hyd', 0.1);
  if (sh.spd < REV_SPD) { if (!r.loops.rev) r.loops.rev = loopStart('fk_reverse', pos); loopPos(r.loops.rev, pos); }
  else loopStop(r, 'rev', 0.05);
}

// ---------- ③ 大灯（借灯池） ----------
function lightOwner(r) { return 'fkr:' + r.key; }
function lightOff(r) {
  if (!r.lightOn) return;
  r.lightOn = false;
  if (has(BR.world, 'setExtraLights')) { try { BR.world.setExtraLights(lightOwner(r), null); } catch (err) { /* 忽略 */ } }
}
function updateLight(r) {
  // 司机把仪表台的大灯开关关了（hl 0）：远端这边也不借灯池
  if (!r.on || !r.active || r.shown.hl === 0) { lightOff(r); return; }
  const W = BR.world;
  if (!has(W, 'setExtraLights')) return;
  const L = r.light || (r.light = Object.assign({ x: 0, y: 0, z: 0, owner: lightOwner(r) }, headlight()));
  let s = null;
  const sh = shadowOf(r);
  if (sh && has(sh, 'lightSpot')) { try { s = sh.lightSpot(); } catch (err) { s = null; } }
  let dirty = !r.lightOn;
  if (s && isFinite(s.x) && isFinite(s.z)) {
    L.x = +s.x; L.z = +s.z; L.y = isFinite(s.y) ? +s.y : L.y;
    for (const k of ['range', 'intensity', 'color', 'decay']) if (s[k] != null && s[k] !== L[k]) { L[k] = s[k]; dirty = true; }
  } else {
    // 没有模拟：车头前 3 m、高 1 m（核心没有模拟时也这么放）
    const v = vehRec(r.key), y0 = v && v.pose ? num(v.pose.y, 0) : 0;
    L.x = r.shown.x - Math.sin(r.shown.yaw) * 3; L.z = r.shown.z - Math.cos(r.shown.yaw) * 3; L.y = y0 + 1;
  }
  if (dirty) {
    try { W.setExtraLights(lightOwner(r), [L]); r.lightOn = true; } catch (err) { once('light', () => console.error('[vehiclesNet] setExtraLights 出错', err)); }
  }
}

// ---------- 影子模拟：大灯落点、拨藤蔓、推瓶罐（只摆位，不 step） ----------
function shadowOf(r) {
  const F = BR.forklift;
  if (!F) return null;
  // 核心为本机开过这台车建过模拟：用登记着的那个；没有才自己建一个（同一个 key：碰撞时忽略的就是这台车自己的 OBB）。
  // 本机以后坐上这台车时核心会重建它的模拟（同 key 的旧的被 dispose），到时远端表现已经收掉
  let sh = has(F, 'byKey') ? F.byKey(r.key) : null, own = false;
  if (!sh && has(F, 'create')) {
    const v = vehRec(r.key), p = v && v.pose ? v.pose : r.shown;
    try {
      sh = F.create({ key: r.key, x: num(p.x, r.shown.x), z: num(p.z, r.shown.z), y: num(p.y, 0), yaw: num(p.yaw, r.shown.yaw),
        steer: num(p.steer, 0), lift: num(p.lift, 0), on: 0, n: v ? v.n : undefined }) || null;
      own = !!sh;
    } catch (err) { once('create', () => console.error('[vehiclesNet] BR.forklift.create 出错', err)); sh = null; }
  }
  if (sh !== r.shadow) { r.shadow = sh; r.shadowOwn = own; r.pushed = false; r.pushAcc = 0; r.shPose = null; }
  return sh;
}
// 不再表现这台车：推着的瓶罐松手；影子是本文件建的就收掉（核心建的模拟留给核心）
function dropShadow(r) {
  const sh = r.shadow, own = r.shadowOwn;
  r.shadow = null;
  r.shadowOwn = false;
  if (sh && r.pushed && has(sh, 'release')) { try { sh.release(); } catch (err) { /* 忽略 */ } }
  r.pushed = false;
  r.pushAcc = 0;
  const F = BR.forklift;
  if (own && sh && has(sh, 'dispose') && F && has(F, 'byKey') && F.byKey(r.key) === sh) { try { sh.dispose(); } catch (err) { /* 忽略 */ } }
}
const shTmp = { x: 0, z: 0, y: 0, yaw: 0, steer: 0, lift: 0, spd: 0, lever: 0, on: 0 };
function shadowFollow(r, moved, el) {
  const sh = shadowOf(r);
  if (!sh || !has(sh, 'setPose')) return;
  const v = vehRec(r.key), y = v && v.pose ? num(v.pose.y, 0) : 0, s = r.shown;
  // 车在开才推：房主推的照常写 levelState、同步给客机；客机推的只改显示（房主的 set 到了会覆盖）
  const push = moved && s.on === 1;
  const a = r.shPose;
  // 一帧挪得多（本机卡、对方卡、重新开始的那一下）：切成每段 ≤10 cm / ≤0.08 rad 一段段推，瓶罐不会被一步跨过去留在车身里
  let n = 1;
  if (push && a) {
    const d = Math.hypot(s.x - a.x, s.z - a.z), dy = Math.abs(adiff(a.yaw, s.yaw)), dl = Math.abs(s.lift - a.lift) * 2.6;
    n = Math.min(PUSH_SUB_MAX, Math.max(1, Math.ceil(Math.max(d / PUSH_SUB_D, dy / PUSH_SUB_A, dl / PUSH_SUB_D))));
  }
  try {
    if (push && !a) sh.setPose({ x: s.x, z: s.z, y, yaw: s.yaw, steer: s.steer, lift: s.lift, spd: s.spd, lever: s.lever, on: s.on });   // 影子刚建：先对齐，不推
    else for (let i = 1; i <= n; i++) {
      const u = i / n, q = shTmp;
      if (n > 1) {
        q.x = a.x + (s.x - a.x) * u; q.z = a.z + (s.z - a.z) * u; q.yaw = wrap(a.yaw + adiff(a.yaw, s.yaw) * u);
        q.steer = a.steer + (s.steer - a.steer) * u; q.lift = a.lift + (s.lift - a.lift) * u;
      } else { q.x = s.x; q.z = s.z; q.yaw = s.yaw; q.steer = s.steer; q.lift = s.lift; }
      q.y = y; q.spd = s.spd; q.lever = s.lever; q.on = s.on;
      sh.setPose(q, { push });
    }
  } catch (err) { once('shpose', () => console.error('[vehiclesNet] 影子模拟 setPose 出错', err)); return; }
  const b = r.shPose || (r.shPose = { x: 0, z: 0, yaw: 0, steer: 0, lift: 0 });
  b.x = s.x; b.z = s.z; b.yaw = s.yaw; b.steer = s.steer; b.lift = s.lift;
  if (push) { r.pushed = true; r.pushAcc += el; }
  if (r.pushed && has(sh, 'release') && ((!moved && r.stillT >= PUSH_STILL) || r.pushAcc >= PUSH_EVERY)) {
    try { sh.release(); } catch (err) { /* 忽略 */ }
    r.pushed = false;
    r.pushAcc = 0;
  }
}
// 藤蔓：车在开、或者刚停 / 刚走的 2 s 内，按影子的位姿拨开再慢慢摆回（纯表现，各端自己算）
function updateVines(r, el, wall) {
  if (!(el > 0)) return;
  const recent = wall - r.moveWall <= VINE_TAIL || wall - r.endWall <= VINE_TAIL;
  if (!recent) return;
  const sh = r.shadow;
  if (!sh || !has(sh, 'stepVines')) return;
  try { sh.stepVines(el, r.active); } catch (err) { once('vine', () => console.warn('[vehiclesNet] 藤蔓出错', err)); }
}

// ---------- ① ⑤ 本机司机：发送、掉线、重新拿租约 ----------
function localDrive(wall) {
  const key = seatedKey();
  if (!key || !coopOn()) {
    S.send.key = null;
    S.holdNet = false;
    S.rcWas = false;
    S.regrabSince = 0; S.regrabTries = 0;
    if (S.regrab) { S.lastRegrab = S.regrab; S.regrab = null; }
    return;
  }
  S.send.key = key;
  if (phase() === 'reconnecting') {
    S.rcWas = true;
    S.holdNet = true;
    S.regrabSince = 0; S.regrabTries = 0;   // 重连成功后重新计时
    if (S.regrab) { S.lastRegrab = S.regrab; S.regrab = null; }
    if (wall - S.rcNoteAt >= RC_NOTE_EVERY) { S.rcNoteAt = wall; note(T.offline, RC_NOTE_MS); }
    return;
  }
  const C = BR.coop;
  if (!C || !C.active) { S.holdNet = S.rcWas; return; }   // 握手还没完
  if (S.regrab) {
    if (S.regrab.key !== key) { S.lastRegrab = S.regrab; S.regrab = null; }
    else if (!S.regrab.done && wall - S.regrab.t0 > REGRAB_WAIT) onRegrab(S.regrab, false, 'timeout');
    if (S.regrab) { S.holdNet = true; holdNote(wall); return; }
  }
  const k = 'k:' + key;
  if (S.rcWas || leaseOf(k) !== 'me') {
    startRegrab(key, wall);
    if (S.regrab || seatedKey() !== key || leaseOf(k) !== 'me') { if (S.regrab) holdNote(wall); return; }
  }
  S.holdNet = false;
  S.regrabSince = 0; S.regrabTries = 0;
  sendHand(key, wall);
}
// 重新要租约的这几秒车不听 W：要了超过 0.5 s 还没要回来就在状态行说「掉线了，车先停住」（每 2 s 一次），孩子不会以为车坏了
function holdNote(wall) {
  if (!S.regrabSince || wall - S.regrabSince < HOLD_NOTE_AFTER || wall - S.rcNoteAt < RC_NOTE_EVERY) return;
  S.rcNoteAt = wall;
  note(T.offline, RC_NOTE_MS);
}
function sendHand(key, wall) {
  const C = BR.coop;
  if (!has(C, 'hand')) return;
  const v = vehRec(key), p = v && v.pose;
  if (!p) return;
  try { C.hand('k:' + key, num(p.x, 0), num(p.z, 0), num(p.yaw, 0), num(p.steer, 0), num(p.lift, 0), 0, num(p.spd, 0), p.on ? 1 : 0, p.hl === 0 ? 0 : 1); }
  catch (err) { once('hand', () => console.error('[vehiclesNet] coop.hand 出错', err)); return; }
  S.send.n++;
  S.send.at = wall;
  S.send.on = p.on ? 1 : 0;
}
function startRegrab(key, wall) {
  const C = BR.coop;
  S.rcWas = false;
  if (!has(C, 'requestGrab')) { S.holdNet = false; return; }
  const tok = { key, t0: wall, done: false, ok: null, why: null };
  S.regrab = tok;
  S.holdNet = true;
  if (!S.regrabSince) S.regrabSince = wall;
  S.regrabTries++;
  tok.tries = S.regrabTries;
  let ret = true;
  // re：告诉房主这是坐在车上的「重新要」（房主收回租约以后车被挪过就不批，FE1 返修 r3）
  try { ret = C.requestGrab('k:' + key, 'veh', (ok, why) => onRegrab(tok, !!ok, why), { re: 1 }); }
  catch (err) { once('regrab', () => console.error('[vehiclesNet] coop.requestGrab 出错', err)); onRegrab(tok, false, 'err'); return; }
  if (ret === false && !tok.done) onRegrab(tok, false, 'bad');
}
function onRegrab(tok, ok, why) {
  if (tok.done) return;
  tok.done = true; tok.ok = ok; tok.why = why != null ? String(why) : null; tok.t1 = nowS();
  if (S.regrab === tok) { S.regrab = null; S.lastRegrab = tok; }
  S.holdNet = false;
  const still = seatedKey() === tok.key;
  if (ok) {
    S.regrabSince = 0; S.regrabTries = 0;
    // 拿回来时人已经不在车上了（死了、换层……）：租约还回去，别把车锁住
    if (!still && has(BR.coop, 'release')) { try { BR.coop.release('k:' + tok.key); } catch (err) { /* 忽略 */ } }
    return;
  }
  if (!still || tok.why === 'released') { S.regrabSince = 0; S.regrabTries = 0; return; }
  // 连接还在、只是没等到房主的回复（客机的消息晚到：申请排在前面卡住的消息后面）：人还坐着、车停着，下一帧接着要。
  // 晚到的申请到了房主那边一样会批（车给掉线的司机留着），批下来就接着开（FE1 返修 r2：以前这里直接放下车，两边的车从此对不上）
  if ((tok.why === 'timeout' || tok.why === 'dup') && phase() === 'active' && S.regrabSince && nowS() - S.regrabSince < REGRAB_GIVEUP) {
    S.holdNet = true;
    return;
  }
  S.regrabSince = 0; S.regrabTries = 0;
  // 要不回来：放下车（finishExit 里 coop.release 会把本机这台车的位姿带给房主，房主按它停车并广播，两边一致）
  const v = VH();
  if (has(v, 'forceExit')) { try { v.forceExit('net'); } catch (err) { console.error('[vehiclesNet] vehicles.forceExit 出错', err); } }
  toast(tok.why === 'peer' ? T.peer : T.retry, 1800);
}

// ---------- ④ levelState ----------
function kindIsVeh(k) { return k === 'veh' || k === 'vehicle' || k === 'vehicles'; }
// 这台车现在有人在开：本机以外的人拿着租约，或者它的流还新鲜，或者对方的姿态是坐在它上面
function busy(key, wall) {
  if (leaseOf('k:' + key) === 'peer') return true;
  const r = RM.get(key);
  if (r && r.active && wall - r.lastRecv < STALE) return true;
  return peerDriving(key);
}
function applyRecord(key, v, wall) {
  if (!key || !v || typeof v !== 'object' || !isFinite(+v.x) || !isFinite(+v.z)) return false;
  if (seatedKey() === key) { S.ls.skipSeat++; return false; }
  const off = +v.on !== 1;
  // 正被人开着：以 net:veh 为准。on:0 = 司机下车了（或房主按最后位姿收尾），这时照记录停车。
  // on:1 的记录是「上车那一刻」的位姿：本机已经有这台车更新的位姿（流摆过、收过尾）就不往回摆，只给本机还没见过的车占个位
  if (!off) {
    const cur = vehRec(key);
    if (busy(key, wall) || (cur && cur.driven)) { S.ls.skipBusy++; return false; }
  }
  const pose = { x: +v.x, z: +v.z, yaw: num(+v.yaw, 0), steer: num(+v.steer, 0), lift: clamp(num(+v.lift, 0), 0, 1), n: v.n, hl: +v.hl === 0 ? 0 : 1 };
  const r = RM.get(key);
  if (r && (r.active || r.on)) {
    finish(r, pose, wall, 'ls');
    r.blockUntil = wall + BLOCK_AFTER_LS;
    S.ls.applied++;
    return true;
  }
  const cur = vehRec(key), cp = cur && cur.pose;
  if (cp && cur.driven && !cp.on && cur.seat !== 'peer' &&
      Math.abs(cp.x - pose.x) < EPS && Math.abs(cp.z - pose.z) < EPS && Math.abs(adiff(cp.yaw, pose.yaw)) < EPS &&
      Math.abs(cp.lift - pose.lift) < 1e-5 && Math.abs(num(cp.steer, 0) - pose.steer) < EPS && (cp.hl === 0 ? 0 : 1) === pose.hl) { S.ls.skipSame++; return false; }
  if (r) {
    const sh = r.shown;
    sh.x = pose.x; sh.z = pose.z; sh.yaw = pose.yaw; sh.steer = pose.steer; sh.lift = pose.lift; sh.spd = 0; sh.lever = 0; sh.on = 0; sh.hl = pose.hl;
    r.hasShown = true; r.sig = '';
  }
  if (placeParked(key, pose)) S.ls.applied++;
  return true;
}
function lsReady(lv) { return lv != null && lv === curLv() && inWorld() && !editing() && !!VH(); }
function onLsSet(p) {
  if (!p || !kindIsVeh(p.kind) || p.key == null) return;
  S.ls.set++;
  const lv = p.lv != null ? String(p.lv) : curLv();
  if (!lsReady(lv)) return;   // 不在这一层：核心进层 / 建块时自己读 levelState
  if (p.v == null) return;    // 删记录：FE1 没有这条路（回主页、新开一局整份清空，核心自己重来）
  applyRecord(stripKey(p.key), p.v, nowS());
}
function onLsImport(p) {
  S.ls.import++;
  const lv = p && p.lv != null ? String(p.lv) : curLv();
  if (!lsReady(lv)) return;
  const L = BR.levelState;
  let st = null;
  try { st = L && has(L, 'peek') ? L.peek(lv) : null; } catch (err) { st = null; }
  const tbl = st && st.vehicles;
  if (!tbl || typeof tbl.forEach !== 'function') return;
  const wall = nowS();
  tbl.forEach((v, key) => applyRecord(stripKey(key), v, wall));
}
function onLsClear(p) {
  S.ls.clear++;
  const lv = p && p.lv != null ? String(p.lv) : null;
  if (lv != null && lv !== curLv()) return;
  resetAll();
}

// ---------- 每帧 ----------
function update() {
  S.updates++;
  if (editing()) { if (RM.size) resetAll(); return; }
  const wall = nowS();
  localDrive(wall);
  if (!RM.size) return;
  if (!inWorld()) { resetAll(); return; }
  for (const r of Array.from(RM.values())) {
    try { stepRemote(r, wall); } catch (err) { once('step', () => console.error('[vehiclesNet] 远端车出错', r.key, err)); }
  }
}
function resetAll() {
  RM.forEach(r => endRemote(r));
  RM.clear();
}
function onNewSession() {
  resetAll();
  if (S.regrab) S.lastRegrab = S.regrab;
  S.regrab = null;
  S.holdNet = false;
  S.rcWas = false;
  S.regrabSince = 0; S.regrabTries = 0;
  S.send.key = null;
}

// ---------- 调试 / 测试 ----------
function remote(key) {
  const r = RM.get(stripKey(key));
  if (!r || !r.hasShown) return null;
  const s = r.shown;
  return { x: s.x, z: s.z, yaw: s.yaw, steer: s.steer, lift: s.lift, spd: s.spd, lever: s.lever, on: r.on ? 1 : 0, active: r.active };
}
function debugInfo() {
  const wall = nowS(), remotes = {};
  RM.forEach(r => {
    const L = r.buf.length ? r.buf[r.buf.length - 1] : null;
    remotes[r.key] = {
      buf: r.buf.length, n: r.n, active: r.active,
      lastAt: r.lastRecv > 0 ? Math.round(r.lastRecv * 1000) : null,
      ageMs: r.lastRecv > 0 ? Math.round((wall - r.lastRecv) * 1000) : null,
      lagMs: L ? Math.round((L.t - r.rt) * 1000) : null,
      err: Math.round(r.err * 1e4) / 1e4, errMax: Math.round(r.errMax * 1e4) / 1e4,
      on: r.on, light: r.lightOn, lightAt: r.lightOn && r.light ? { x: r.light.x, y: r.light.y, z: r.light.z, range: r.light.range } : null,
      loops: { engine: !!r.loops.engine, hyd: !!r.loops.hyd, rev: !!r.loops.rev },
      shadow: !!r.shadow, pose: remote(r.key),
    };
  });
  const sk = seatedKey();
  return {
    updates: S.updates,
    remotes,
    send: { key: S.send.key, n: S.send.n, at: S.send.at ? Math.round(S.send.at * 1000) : null, on: S.send.on, lease: sk ? leaseOf('k:' + sk) : null },
    net: { coop: coopOn(), role: coopRole(), phase: phase(), holding: !!BR.vehiclesNet && BR.vehiclesNet.holding,
      regrab: S.regrab ? Object.assign({}, S.regrab) : null, lastRegrab: S.lastRegrab ? Object.assign({}, S.lastRegrab) : null,
      regrabSince: S.regrabSince ? Math.round(S.regrabSince * 1000) : null, regrabTries: S.regrabTries },
    ls: Object.assign({}, S.ls),
    lastFinish: S.lastFinish,
  };
}

// ---------- 注册 ----------
if (BR.bus) {
  BR.bus.on('net:veh', onNetVeh);
  BR.bus.on('levelstate:set', onLsSet);
  BR.bus.on('levelstate:import', onLsImport);
  BR.bus.on('levelstate:clear', onLsClear);
  BR.bus.on('game:start', onNewSession);
  BR.bus.on('game:home', onNewSession);
  BR.bus.on('level:leave', resetAll);
  // 本机坐上了一台正在表现的远端车（对方刚下车、自己马上上）：以本机模拟为准
  BR.bus.on('vehicle:mount', e => { const k = stripKey(e && e.key); const r = k && RM.get(k); if (r) { endRemote(r); RM.delete(k); } });
}
BR.vehiclesNet = {
  update,
  get holding() { return !!(S.holdNet || (seatedKey() && coopOn() && phase() === 'reconnecting')); },
  remote,
  debugInfo,
  _feed: onNetVeh,
  _reset: onNewSession,
};
})();
