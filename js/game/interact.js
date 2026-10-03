// 后室 · 准心交互（BR.interact）：每帧瞄准、空格短按 / 长按的状态机、长按拖动（物资、kit 道具、测试人）
// 经典 <script>，只往 window.BR 上挂东西。加载顺序在 phys.js 之后、items.js 之前，items / world / entities 在加载期就能 addSource。
//
// 规则（孩子定的 + 方案 A1）：
//   准心对准 + 空格短按 = 使用 / 拾取；长按空格 = 拖动；E 只是隐藏别名（由 input.js 映射，界面文字里不出现）。
//   有「使用」动作的东西（物资、箱子、柜子、设备、座位、车）先进 PRESSED：按住不到 holdMs(350) 松手 = 短按；
//   按满 holdMs 时，能拖就进拖动，有长按动作就开始长按动作（进度环到 hold.ms 才执行），都没有就只给原因。
//   只能拖的（kit 家具、测试人、门扇）一按就拖。墙、通往别层的门、出口没有登记成候选，所以拖不动。
//   只能点、没有任何长按动作的（情境里的「起身 / 下车」、自己拖不了又没有可拖父道具的东西）按下那一刻就执行，不等松手
//   （现行规则；方案字面「有 short 的一律先进 PRESSED」待主会话拍板，见 onPress）。
//   pickSlop 只对物资生效：拖物资松手时累计位移不到 0.15 m，按拾取算；拖道具松手永远不会被当成拾取。
//   拖动不悬空、不堵门（2026-10-02 返修）：每一步先看脚下——道具占地 3×3 个采样点的地面和抓起时的地面差超过 5 cm
//   （坑、楼板洞、台阶、门廊外的海面）就当撞墙；物资跟着地面走，一步高差超过 20 cm 也当撞墙。出口圈（radius + exitMargin）
//   在拖动中就是障碍，东西停在圈外，松手不会再跳回去。单机 / 房主拖道具时，占地里的地上物资被顺着推开（推不开就挡住道具）。
//   声音：抓起一声闷响，道具每拖 0.35 m 一声摩擦，放下「咚」一声；转身太快手里的东西掉了，提示「手滑了」。
//   被台阶边、坑沿、门廊外、架子边挡住超过 0.3 s 说一次真正的原因（「再往前就掉下去了」「搬不下来，只能在上面推」）；
//   挡住后人接着走、东西脱手时也说这个原因，不说「手滑了」。
//
// 候选（来源 out.push 的对象）：
//   { kind:'item'|'prop'|'entity'|'door'|'button'|'container'|'fixture'|'seat'|'vehicle', key, label, t, small,
//     short:{verb, ok, why}|null, hold:{verb, ms, ok?, why?}|null, canDrag, vol, ref, parentKeys:[] (近的在前),
//     可选：dragKey / dragKind（长按拖的不是自己时，例如货架里的箱子拖的是货架）、dragWhy（不能拖时长按给的原因）、
//     solidKey（自己碰撞体的 phys key，和 key 写法不同时给）、x/y/z（命中点）、onShort(c) / onHold(c) }
//
// 接口：
//   addSource(name, fn(ray, reach, out)) / removeSource(name)：ray = {ox,oy,oz,dx,dy,dz（已归一化）, wallT, wallKey, assistTan, touch}
//   hit.sphere(ray,x,y,z,r,small) / hit.box(ray,x0,y0,z0,x1,y1,z1,small) / hit.obb(ray,{x,y,z,rot},min[3],max[3],small)
//     / hit.cylinder(ray,x,z,r,y0,y1,small)：返回 t（起点在体内为 0），没打中 -1；small=true 按 assistDeg 放宽
//   handle(kind, { short(c), hold(c), drag:{ grab(c,D), move(c,D,tx,tz,dt), release(c,D,reason) } })：
//     各模块登记自己那种候选的动作（容器 D1、设备 D1、座位 D2、载具 F1、按钮 / 门 B1）；物资拾取、物资 / 道具 / 测试人拖动是内建的
//   current（复用对象 | null）、target（按下时锁定的那个）、state 'idle'|'pressed'|'drag'|'hold'、holdProgress() 0..1、
//   speedCap()（player.speed 乘它）、dragging、mode、owner、crossHidden、update(dt, inp|null)、cancel(reason)、
//   setMode('walk'|'seat'|'lie'|'drive'|'view', owner)、aimAt(x,y,z)、heldInfo()、debugInfo()
//   setMode 同步 BR.input.setContext（lie → 'seat'）和 BR.coop.setPose(mode, owner.key)
//   长按拖谁：物资、道具、测试人、门拖自己；容器、设备、按钮、载具、座位，以及自己拖不了的静止物资（柜子里的瓶子），
//     拖父链里最近一个能拖的道具。座位候选要带 parentKeys:[椅子 key]（kit 的座位是椅子记录里的锚点，没有自己的道具 key）
//   遮挡：候选 t ≤ 墙的 t 才有效；命中的碰撞体属于候选自己或它的父链时，忽略这条链再打一次射线（phys.raycast 的 ignoreKey）
//   优先级：容器里的物资、容器、格子里的子道具 > 父道具；部件和父道具 t 差 < partPrefer 选部件；小目标近 smallPrefer 内优先；
//     t 相同按 物资 > 按钮 > 容器 > 门 > 设备 > 座位 > 载具 > 实体 > 道具
//   bus：'interact:short' {kind,key,ok}、'interact:hold' {kind,key,ok}、'interact:deny' {kind,key,why}、'interact:pick' {id}、
//     'interact:grab' {kind,key}、'interact:release' {kind,key,x,z}、'interact:cancel' {reason}、'interact:mode' {mode,key}
//   联机：拖动前 BR.coop.requestGrab('i:'|'p:'|'e:'|'d:' + key, kind, cb(ok, why))（客机先动手，被拒再退回），
//     拖动中每帧 BR.coop.hand(k, x, y, z, 0)，松手 BR.coop.release(k, [x,y,z])；coop 收回租约时调 cancel('peer')
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 配置 ----------
// base.js 里 BR.config.interact 是权威值；这里只兜底，单独加载本文件（单元测试）时也能跑
const DEF = {
  reach: 2.6, holdMs: 350, ringDelayMs: 120, assistDeg: 2.5, assistDegTouch: 5, pickSlop: 0.15,
  dragV0: 1.8, dragK: 0.6, dragVMin: 0.25, grabMin: 1.2, grabMax: 2.5, breakDist: 1.5, exitMargin: 0.4,
  smallPrefer: 0.3, partPrefer: 0.3,
};
function cfg() {
  const c = BR.config && BR.config.interact;
  return c || DEF;
}
function cv(name) {
  const c = cfg();
  const v = c[name];
  return typeof v === 'number' && isFinite(v) ? v : DEF[name];
}

const DEG = Math.PI / 180;
const EMPTY = Object.freeze([]);
const TIE_EPS = 0.02;          // t 相差在 2 cm 内算「t 相同」，按种类优先级定
const WALL_EPS = 0.02;         // 候选正好贴在墙面上时不因浮点误差被判成墙后
const PROP_FOOT_CLEAR = 0.05;  // 拖道具时底面抬 5 cm 再查碰撞：门槛、地毯这种薄碰撞体不该把箱子卡住
const EXIT_SCAN = 12;          // 抓起时收集这个半径内的出口，拖动中只查这些
const MOVE_EPS = 1e-4;
const PROP_GROUND_TOL = 0.05;  // 道具 y 不变（A1 的 kit.moveProp 只有 dx/dz）：占地下面的地面和抓起时差超过 5 cm 就是悬空或卡进地面
const ITEM_STEP = 0.2;         // 物资跟着地面走，一步之内高差超过 20 cm（坑沿、台阶边、门廊外）就挡住
const ON_FLOOR = 0.05;         // 物资离脚下地面这么近才算放在地上，拖的时候才跟着地面起伏
const PUSH_GAP = 0.01;         // 道具推开地上物资时多让出的一点距离
const SUPPORT_TOL = 0.06;      // 架子上、桌上、箱子上的东西：底面往下这么近有碰撞体托着才算放稳
const SCRAPE_EVERY = 0.35;     // 拖道具每走这么远响一声摩擦

// t 相同时的优先级：物资 > 按钮 > 容器 > 门 > 设备 > 座位 > 载具 > 测试人/NPC > 道具
const RANK = { item: 0, button: 1, container: 2, door: 3, fixture: 4, seat: 5, vehicle: 6, entity: 7, prop: 8 };
// 有「使用」动作的种类：哪怕此刻 short 为 null（例如 A2 阶段货架里的箱子还不能开），也先进 PRESSED，100 ms 的短按不会变成拖动
const USE_KINDS = { item: 1, container: 1, fixture: 1, seat: 1, vehicle: 1, button: 1 };
// 子候选压过父道具时不看 t 差的种类：容器里的物资、容器、放在父道具里的子道具（货架格子里的箱子）——
// 父道具的 OBB 只是个粗外壳，射线能穿进子件的盒子就是在看它；其余子件（按钮、座位等部件）和父道具 t 差 < partPrefer 才优先
const STRICT_CHILD = { item: 1, container: 1, prop: 1 };
// 情境：seat / lie 只认起身；drive 只认车上的按钮（喇叭）和下车；view 隐藏准心，只认换画面
const MODE_DEFAULTS = {
  walk: null,
  seat: { kind: 'seat', short: { verb: '起身', ok: true, why: '' } },
  lie: { kind: 'seat', short: { verb: '起身', ok: true, why: '' } },
  drive: { kind: 'vehicle', short: { verb: '下车', ok: true, why: '' } },
  view: { kind: 'fixture', short: { verb: '换画面', ok: true, why: '' } },
};
const INPUT_CONTEXT = { walk: 'walk', seat: 'seat', lie: 'seat', drive: 'drive', view: 'view' };
// 联机租约前缀（'d:' 'v:' 留给 B 阶段的门和电梯，'u:' 'k:' 归座位和载具模块自己管）
const LEASE = { item: 'i:', prop: 'p:', entity: 'e:', door: 'd:' };

// ---------- 状态 ----------
const sources = [];                  // [{ name, fn }]
const handlers = new Map();          // kind → { short(c), hold(c), drag:{ grab, move, release } }
const cands = [];                    // 本帧候选（来源 push 进来的对象，下一帧清空）
const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1, reach: DEF.reach, wallT: Infinity, wallKey: null, assistTan: 0, touch: false };
const ignoreBuf = [];
const S = {
  state: 'idle',                     // 'idle' | 'pressed' | 'drag' | 'hold'
  has: false,                        // cur 是否有效
  simMs: 0,                          // 按下后累计的模拟时间（毫秒）
  realMs: 0,
  longDone: false,                   // PRESSED 里已经过了 holdMs、给过原因（之后松手什么都不做）
  mode: 'walk',
  owner: null,                       // 情境的接管者 { key, kind, label, short, hold, onShort, onHold, accept }
  warned: new Set(),
  wallCacheSig: null, wallCacheT: Infinity,
};

function blank() {
  return {
    kind: null, key: null, label: '', t: 0, small: false, short: null, hold: null, canDrag: false, vol: 0,
    ref: null, parentKeys: EMPTY, dragKey: null, dragKind: null, dragLabel: '', dragWhy: '', solidKey: null,
    x: 0, y: 0, z: 0, src: '', mode: null, onShort: null, onHold: null,
  };
}
const cur = blank();                 // 准心目标（复用对象，HUD 只读）
const locked = blank();              // 按下那一帧锁定的目标
const modeCand = blank();            // 非 walk 情境下没对准任何东西时的「起身 / 下车 / 换画面」

// 拖动中的状态（复用）
const D = {
  kind: null, key: null, lease: null, label: '', handler: null,
  pending: false, granted: false, sx: 0, sz: 0,
  x: 0, y: 0, z: 0, rot: 0,          // 被拖物体的枢轴（世界坐标）此刻的位置
  vx: 0, vz: 0, validX: 0, validZ: 0, // 上一个合法位置
  moved: 0, grabDist: 1.5, offR: 0, offF: 0,
  v: DEF.dragV0,
  hx0: 0, hx1: 0, hz0: 0, hz1: 0, yFoot: 0, h: 1, r: 0.15,
  ignore: [], exits: [], exitCircles: [],
  ent: null, localHold: null,
  gRef: 0, gDev: new Float64Array(9), onFloor: false,   // 地面：道具抓起时占地中心的地面高度和此刻 9 个采样点的偏差；物资是否放在地上
  elev: false, sup0: false,                              // 不在地上（架子上、桌上）：抓起时底面下有没有东西托着
  pushed: [], scrape: 0,                                 // 这次拖动推开过的地上物资 id；摩擦声的累计距离
  t: 0, edgeSince: -1, edgeAt: -1, edgeWhy: '', edgeSaid: false,   // 拖了多久（模拟秒）；被台阶边、架子边挡住的起止时刻和原因
};
const heldOut = { k: null, kind: null, x: 0, y: 0, z: 0, a: 0 };

// ---------- 小工具 ----------
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function once(key, fn) { if (!S.warned.has(key)) { S.warned.add(key); fn(); } }
function emit(name, p) { if (BR.bus) BR.bus.emit(name, p); }
function sound(name, opts) { if (has(BR.audio, 'play')) BR.audio.play(name, undefined, opts); }
function toast(text, ms) { if (text && has(BR.hud, 'toast')) BR.hud.toast(text, ms || 1500); }
function coopLive() {
  const c = BR.game && BR.game.coop;
  if (c && c.active) return true;
  return !!(BR.coop && BR.coop.active);
}
function coopRole() {
  const c = BR.game && BR.game.coop;
  if (c && c.active && c.role) return c.role;
  return BR.coop && BR.coop.active ? BR.coop.role : null;
}
// __br.setAuto(false) 时测试用 step 精确推进模拟时间，按住多久只看模拟时间；正常游玩再和真实按住时长取大，
// 掉帧（dt 被夹到 0.1 s）时也不会把真按了半秒的长按判成短按
function realTimeOk() { return !(window.__br && window.__br.auto === false); }

// 道具 key（`${lv}@${cx},${cz}#p${n}`）和碰撞体 key（`${cx},${cz}#p${n}`）写法不同，两种都认
function keyMatch(a, b) {
  if (a == null || b == null) return false;
  a = String(a); b = String(b);
  if (a === b) return true;
  const ia = a.indexOf('@'), ib = b.indexOf('@');
  if (ia >= 0 && ib < 0) return a.slice(ia + 1) === b;
  if (ib >= 0 && ia < 0) return b.slice(ib + 1) === a;
  return false;
}
function pushKeyForms(out, k) {
  if (k == null) return;
  k = String(k);
  if (out.indexOf(k) < 0) out.push(k);
  const i = k.indexOf('@');
  if (i >= 0) { const s = k.slice(i + 1); if (out.indexOf(s) < 0) out.push(s); }
}
function parentsOf(c) { return c && Array.isArray(c.parentKeys) ? c.parentKeys : EMPTY; }
function isAncestorOf(anc, c) {
  if (!anc || anc.key == null) return false;
  const ps = parentsOf(c);
  for (let i = 0; i < ps.length; i++) if (keyMatch(ps[i], anc.key)) return true;
  return false;
}
function ownsKey(c, k) {
  if (keyMatch(c.key, k) || keyMatch(c.solidKey, k)) return true;
  const ps = parentsOf(c);
  for (let i = 0; i < ps.length; i++) if (keyMatch(ps[i], k)) return true;
  return false;
}

function copyCand(dst, s) {
  dst.kind = s.kind != null ? String(s.kind) : null;
  dst.key = s.key != null ? s.key : null;
  dst.label = s.label != null ? String(s.label) : '';
  dst.t = num(s.t, 0);
  dst.small = !!s.small;
  dst.short = s.short || null;
  dst.hold = s.hold || null;
  dst.canDrag = !!s.canDrag;
  dst.vol = Math.max(0, num(s.vol, 0));
  dst.ref = s.ref != null ? s.ref : null;
  dst.parentKeys = Array.isArray(s.parentKeys) ? s.parentKeys : EMPTY;
  dst.dragKey = s.dragKey != null ? s.dragKey : null;
  dst.dragKind = s.dragKind != null ? s.dragKind : null;
  dst.dragLabel = s.dragLabel != null ? String(s.dragLabel) : '';
  dst.dragWhy = s.dragWhy ? String(s.dragWhy) : '';
  dst.solidKey = s.solidKey != null ? s.solidKey : null;
  dst.x = num(s.x, 0); dst.y = num(s.y, 0); dst.z = num(s.z, 0);
  dst.src = s.src || '';
  dst.mode = s.mode || null;
  dst.onShort = typeof s.onShort === 'function' ? s.onShort : null;
  dst.onHold = typeof s.onHold === 'function' ? s.onHold : null;
  return dst;
}

// ---------- 命中工具（给各来源用；ray 的方向已归一化） ----------
// 都返回沿射线的距离 t（起点在体内为 0），没命中返回 -1。small=true 时按 assistDeg 放宽（小目标辅助瞄准）
function hitSphere(r0, x, y, z, rad, small) {
  const lx = x - r0.ox, ly = y - r0.oy, lz = z - r0.oz;
  const l2 = lx * lx + ly * ly + lz * lz;
  const R = Math.max(0, num(rad, 0));
  if (l2 <= R * R) return 0;
  const tc = lx * r0.dx + ly * r0.dy + lz * r0.dz;
  if (tc <= 0) return -1;
  const d2 = l2 - tc * tc;
  if (d2 <= R * R) return Math.max(0, tc - Math.sqrt(R * R - d2));
  if (!small) return -1;
  const RA = R + tc * r0.assistTan;
  if (d2 > RA * RA) return -1;
  return Math.max(0, tc - R);
}

// 轴对齐盒（世界坐标）
function slab(o, d, lo, hi, st) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > st.t0) st.t0 = a;
  if (b < st.t1) st.t1 = b;
  return st.t0 <= st.t1;
}
const slabSt = { t0: 0, t1: Infinity };
function boxLocal(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  slabSt.t0 = 0; slabSt.t1 = Infinity;
  if (!slab(ox, dx, x0, x1, slabSt)) return -1;
  if (!slab(oy, dy, y0, y1, slabSt)) return -1;
  if (!slab(oz, dz, z0, z1, slabSt)) return -1;
  return slabSt.t0;
}
function hitBox(r0, x0, y0, z0, x1, y1, z1, small) {
  let t = boxLocal(r0.ox, r0.oy, r0.oz, r0.dx, r0.dy, r0.dz, x0, y0, z0, x1, y1, z1);
  if (t < 0 && small) {
    const cx = (x0 + x1) / 2 - r0.ox, cy = (y0 + y1) / 2 - r0.oy, cz = (z0 + z1) / 2 - r0.oz;
    const e = Math.sqrt(cx * cx + cy * cy + cz * cz) * r0.assistTan;
    t = boxLocal(r0.ox, r0.oy, r0.oz, r0.dx, r0.dy, r0.dz, x0 - e, y0 - e, z0 - e, x1 + e, y1 + e, z1 + e);
  }
  return t;
}
// 有向盒：pivot = { x, y, z, rot }（绕 Y，与 kit 的 push 同向：世界 = 枢轴 + (c·x + s·z, y, −s·x + c·z)），
// min / max 是枢轴坐标系下的 [x, y, z]
function hitObb(r0, pivot, min, max, small) {
  if (!pivot || !min || !max) return -1;
  const rot = num(pivot.rot, 0), c = Math.cos(rot), s = Math.sin(rot);
  const Dx = r0.ox - num(pivot.x, 0), Dz = r0.oz - num(pivot.z, 0);
  const ox = c * Dx - s * Dz, oz = s * Dx + c * Dz, oy = r0.oy - num(pivot.y, 0);
  const dx = c * r0.dx - s * r0.dz, dz = s * r0.dx + c * r0.dz, dy = r0.dy;
  let t = boxLocal(ox, oy, oz, dx, dy, dz, min[0], min[1], min[2], max[0], max[1], max[2]);
  if (t < 0 && small) {
    const cx = (min[0] + max[0]) / 2 - ox, cy = (min[1] + max[1]) / 2 - oy, cz = (min[2] + max[2]) / 2 - oz;
    const e = Math.sqrt(cx * cx + cy * cy + cz * cz) * r0.assistTan;
    t = boxLocal(ox, oy, oz, dx, dy, dz, min[0] - e, min[1] - e, min[2] - e, max[0] + e, max[1] + e, max[2] + e);
  }
  return t;
}
// 竖直圆柱：轴心 (x, z)，半径 rad，高度 y0..y1
function cylLocal(r0, x, z, R, y0, y1) {
  const ox = r0.ox - x, oz = r0.oz - z;
  const a = r0.dx * r0.dx + r0.dz * r0.dz;
  const c0 = ox * ox + oz * oz - R * R;
  let tIn = 0, tOut = Infinity;
  if (a < 1e-12) {
    if (c0 > 0) return -1;
  } else {
    const b = ox * r0.dx + oz * r0.dz;
    const disc = b * b - a * c0;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    tIn = (-b - sq) / a;
    tOut = (-b + sq) / a;
    if (tOut < 0) return -1;
    if (tIn < 0) tIn = 0;
  }
  // 再和 y 区间求交
  if (Math.abs(r0.dy) < 1e-12) {
    if (r0.oy < y0 || r0.oy > y1) return -1;
  } else {
    let a2 = (y0 - r0.oy) / r0.dy, b2 = (y1 - r0.oy) / r0.dy;
    if (a2 > b2) { const t = a2; a2 = b2; b2 = t; }
    if (a2 > tIn) tIn = a2;
    if (b2 < tOut) tOut = b2;
  }
  return tIn <= tOut && tOut >= 0 ? Math.max(0, tIn) : -1;
}
function hitCylinder(r0, x, z, rad, y0, y1, small) {
  const R = Math.max(0, num(rad, 0));
  let t = cylLocal(r0, x, z, R, y0, y1);
  if (t < 0 && small) {
    const cx = x - r0.ox, cy = (y0 + y1) / 2 - r0.oy, cz = z - r0.oz;
    const e = Math.sqrt(cx * cx + cy * cy + cz * cz) * r0.assistTan;
    t = cylLocal(r0, x, z, R + e, y0 - e, y1 + e);
  }
  return t;
}

// ---------- 来源与处理者 ----------
function addSource(name, fn) {
  if (typeof fn !== 'function') return () => {};
  name = String(name || 'src' + sources.length);
  removeSource(name);
  const s = { name, fn };
  sources.push(s);
  return () => removeSource(name);
}
function removeSource(name) {
  for (let i = sources.length - 1; i >= 0; i--) if (sources[i].name === name) sources.splice(i, 1);
}
// 每种候选的动作：{ short(c), hold(c), drag:{ grab(c, D) → bool, move(c, D, x, z, dt), release(c, D, reason) } }
// 物资短按（拾取）、道具 / 物资 / 测试人拖动是内建的；容器、设备、座位、载具、按钮、门由各自模块注册
function handle(kind, h) {
  kind = String(kind);
  if (h) handlers.set(kind, h); else handlers.delete(kind);
  return () => { if (handlers.get(kind) === h) handlers.delete(kind); };
}

// ---------- 瞄准 ----------
function fillRay() {
  const P = BR.player;
  const yaw = num(P && P.yaw, 0), pitch = num(P && P.pitch, 0);
  const cp = Math.cos(pitch);
  ray.ox = num(P && P.x, 0); ray.oy = num(P && P.y, 1.62); ray.oz = num(P && P.z, 0);
  ray.dx = -Math.sin(yaw) * cp; ray.dy = Math.sin(pitch); ray.dz = -Math.cos(yaw) * cp;
  ray.reach = cv('reach');
  ray.touch = !!(BR.input && BR.input.isTouch);
  ray.assistTan = Math.tan((ray.touch ? cv('assistDegTouch') : cv('assistDeg')) * DEG);
  ray.wallT = Infinity;
  ray.wallKey = null;
  S.wallCacheSig = null;
  if (has(BR.phys, 'raycast')) {
    const h = BR.phys.raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, ray.reach);
    if (h && num(h.dist, -1) >= 0) {
      ray.wallT = h.dist;
      ray.wallKey = h.key != null ? String(h.key) : null;
    }
  }
}

// 候选在墙后时：命中的 solid 属于它自己或它的父链（货架、货堆那一整块碰撞盒里的箱子、箱子里的瓶子），
// 就忽略这条链再打一次射线，拿到真正挡在前面的墙
function wallFor(c) {
  if (!ray.wallKey || !ownsKey(c, ray.wallKey) || !has(BR.phys, 'raycast')) return ray.wallT;
  ignoreBuf.length = 0;
  pushKeyForms(ignoreBuf, c.key);
  pushKeyForms(ignoreBuf, c.solidKey);
  const ps = parentsOf(c);
  for (let i = 0; i < ps.length; i++) pushKeyForms(ignoreBuf, ps[i]);
  const sig = ignoreBuf.join('|');
  if (sig === S.wallCacheSig) return S.wallCacheT;
  const h = BR.phys.raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, ray.reach, { ignoreKey: ignoreBuf.slice() });
  let t = h && num(h.dist, -1) >= 0 ? h.dist : Infinity;
  // 老版 phys 不认 ignoreKey：还是打到同一块，就当挡住
  if (h && h.key != null && ownsKey(c, h.key) && Math.abs(h.dist - ray.wallT) < 1e-6) t = ray.wallT;
  S.wallCacheSig = sig;
  S.wallCacheT = t;
  return t;
}
function visibleCand(c) {
  if (c.t <= ray.wallT + WALL_EPS) return true;
  return c.t <= wallFor(c) + WALL_EPS;
}

// a 是否比 b 更该被选中
function better(a, b) {
  // 父子关系：容器里的物资、容器压过父道具；其余子件（按钮、部件）t 差 < partPrefer 才压过
  if (isAncestorOf(b, a)) return !!STRICT_CHILD[a.kind] || a.t - b.t < cv('partPrefer');
  if (isAncestorOf(a, b)) return !(STRICT_CHILD[b.kind] || b.t - a.t < cv('partPrefer'));
  // 小目标和大目标 t 差 < smallPrefer：小的优先
  if (!!a.small !== !!b.small) {
    const sm = a.small ? a : b, bg = a.small ? b : a;
    if (sm.t - bg.t < cv('smallPrefer')) return sm === a;
    return bg === a;
  }
  if (Math.abs(a.t - b.t) > TIE_EPS) return a.t < b.t;
  const ra = RANK[a.kind] != null ? RANK[a.kind] : 9, rb = RANK[b.kind] != null ? RANK[b.kind] : 9;
  return ra < rb;
}

function acceptInMode(c) {
  if (S.mode === 'walk') return true;
  const o = S.owner;
  if (o && typeof o.accept === 'function') {
    try { return !!o.accept(c); } catch (err) { return false; }
  }
  if (S.mode === 'drive') return c.kind === 'button' && !!o && o.key != null && (isAncestorOf({ key: o.key }, c) || keyMatch(c.key, o.key));
  return false;
}

// 长按拖的到底是谁：自己（物资、道具、测试人、门）或者最近的可拖父道具（货架里的箱子 → 货架）
function resolveDrag(c) {
  if (!c.canDrag) {
    c.dragKind = null; c.dragKey = null;
    // 容器里、桌上的静止物资自己拖不了（拖出去会悬在半空）：长按拖托着它的那件道具（柜子里的瓶子 → 柜子），
    // 和货架里的箱子长按拖货架是同一条规则；没有能拖的父道具就什么都不拖
    if (c.kind === 'item' && parentsOf(c).length && dragParent(c)) c.canDrag = true;
    return;
  }
  if (c.dragKind && c.dragKey != null) {
    if (!c.dragLabel && c.dragKind === 'prop') c.dragLabel = propLabel(c.dragKey) || c.label;
    return;
  }
  const k = c.kind;
  if (k === 'item' || k === 'entity' || k === 'door') { c.dragKind = k; c.dragKey = c.key; c.dragLabel = c.dragLabel || c.label; return; }
  if (k === 'prop') { c.dragKind = 'prop'; c.dragKey = c.dragKey != null ? c.dragKey : c.key; c.dragLabel = c.dragLabel || c.label; return; }
  // 容器、设备、按钮、载具、座位：拖最近一个能拖的父道具（体积按父道具连同放在上面的东西算，HUD 的「很重」也看它）。
  // 座位是椅子记录里的锚点，长按拖的是椅子：座位候选带 parentKeys:[椅子 key]；没带父链、key 本身就是椅子的也认
  if (dragParent(c)) return;
  if (k === 'seat' && propRec(c.key)) { c.dragKind = 'prop'; c.dragKey = c.key; c.dragLabel = c.dragLabel || propLabel(c.key) || c.label; return; }
  if (c.dragKey != null) { c.dragKind = c.dragKind || 'prop'; return; }
  c.canDrag = false;
}
// 父链里最近一个能拖的道具：填 dragKind / dragKey / dragLabel / vol，找到返回 true
function dragParent(c) {
  const ps = parentsOf(c);
  for (let i = 0; i < ps.length; i++) {
    const P = propRec(ps[i]);
    if (P && P.draggable !== false) {
      c.dragKind = 'prop'; c.dragKey = ps[i];
      c.dragLabel = c.dragLabel || P.label || '';
      c.vol = famVolume(ps[i], P);
      return true;
    }
  }
  return false;
}

function aim() {
  fillRay();
  cands.length = 0;
  const reach = ray.reach;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const n0 = cands.length;
    try { s.fn(ray, reach, cands); }
    catch (err) { once('src:' + s.name, () => console.error('[interact] 来源出错', s.name, err)); }
    for (let k = n0; k < cands.length; k++) if (cands[k] && !cands[k].src) cands[k].src = s.name;
  }
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || c.kind == null || !(num(c.t, -1) >= 0) || c.t > reach) continue;
    if (!acceptInMode(c)) continue;
    if (!visibleCand(c)) continue;
    if (!best || better(c, best)) best = c;
  }
  if (best) {
    copyCand(cur, best);
    resolveDrag(cur);
    S.has = true;
  } else if (S.mode !== 'walk' && S.owner) {
    copyCand(cur, modeCand);
    S.has = true;
  } else {
    S.has = false;
  }
  cands.length = 0;   // 不留候选对象的引用
}

// ---------- 状态机 ----------
function hasLong(c) { return !!(c.canDrag || c.hold || c.dragWhy); }

function onPress(inp) {
  if (!S.has) return;
  copyCand(locked, cur);
  S.simMs = 0;
  S.realMs = 0;
  S.longDone = false;
  const c = locked;
  const usey = !!(c.short || c.hold || USE_KINDS[c.kind] || c.mode);
  if (usey && hasLong(c)) { setState('pressed'); return; }
  // 只能点的（没有任何长按动作：情境里的「起身 / 下车」、自己拖不了又没有可拖父道具的东西）：按下就执行，不用等松手。
  // 方案 A1 ② 字面是「有 short 的一律先进 PRESSED、松手时才算短按」；两种写法玩家只差按下到执行的那几十毫秒，
  // 现在保留按下即执行（手感更跟手），待主会话拍板。要改成松手执行：这一行改成 setState('pressed')，stepPressed 已经能处理
  if (c.short || c.mode) { fireShort(c); return; }
  if (c.canDrag) { startDrag(c); return; }                    // 只能拖的（kit 家具、测试人、门扇）：一按就拖
  if (USE_KINDS[c.kind]) { setState('pressed'); return; }     // 有用途但此刻用不了：短按不出任何动作，也不拖
}

function heldMsNow(inp, up) {
  let ms = S.simMs;
  if (inp && realTimeOk()) {
    let r = 0;
    if (up && has(inp, 'lastHoldMs')) r = num(+inp.lastHoldMs('interact'), 0);
    else if (!up && has(inp, 'heldMs')) r = num(+inp.heldMs('interact'), 0);
    if (r > ms) ms = r;
  }
  S.realMs = ms;
  return ms;
}

function onLong(c) {
  // 按满 holdMs：能拖就拖，有长按动作就开始长按动作，都没有就只给原因
  S.longDone = true;
  if (c.canDrag && S.mode === 'walk') { startDrag(c); return; }
  if (c.hold) {
    if (c.hold.ok === false) { deny(c, c.hold.why || c.dragWhy); setState('idle'); return; }
    setState('hold');
    return;
  }
  deny(c, c.dragWhy || '');
  setState('idle');
}

function holdTargetMs(c) {
  return Math.max(cv('holdMs'), num(c.hold && c.hold.ms, 0));
}

function stepPressed(dt, inp, up, cancelled) {
  const c = locked;
  if (cancelled) { cancel('input'); return; }
  if (!targetAlive(c)) { cancel('gone'); return; }
  const ms = heldMsNow(inp, up);
  if (up) {
    setState('idle');
    if (ms < cv('holdMs')) fireShort(c);
    else if (!S.longDone) {
      // 这一帧才发现已经按满（同一帧里越过阈值又松手）：拖动等于原地放下，长按动作要够 hold.ms 才算
      if (!c.canDrag && c.hold && c.hold.ok !== false && ms >= holdTargetMs(c)) fireHold(c);
      else if (!c.canDrag && (c.dragWhy || (c.hold && c.hold.ok === false))) deny(c, (c.hold && c.hold.why) || c.dragWhy);
    }
    return;
  }
  if (ms >= cv('holdMs') && !S.longDone) onLong(c);
}

function stepHold(dt, inp, up, cancelled) {
  const c = locked;
  if (cancelled) { cancel('input'); return; }
  if (!targetAlive(c)) { cancel('gone'); return; }
  const ms = heldMsNow(inp, up);
  if (ms >= holdTargetMs(c)) { setState('idle'); fireHold(c); return; }
  if (up) { setState('idle'); emit('interact:cancel', { reason: 'early' }); }
}

function setState(s) { S.state = s; }

function targetAlive(c) {
  if (c.mode) return true;
  if (c.kind === 'item') return !!itemRec(c);
  return true;
}

// ---------- 动作 ----------
function deny(c, why) {
  sound('click', { volume: 0.25, rate: 0.75 });
  if (why) toast(why, 1500);
  emit('interact:deny', { kind: c.kind, key: c.key, why: why || '' });
}

function fireShort(c) {
  const sh = c.short;
  if (sh && sh.ok === false) { deny(c, sh.why); return false; }
  let ok = false;
  try {
    if (c.mode) ok = modeShort(c);
    else if (c.onShort) ok = c.onShort(c) !== false;
    else if (c.kind === 'item') ok = pickItem(c);
    else {
      const h = handlers.get(c.kind);
      if (h && typeof h.short === 'function') ok = h.short(c) !== false;
      else { deny(c, ''); return false; }   // 这种东西的模块还没接上（或此刻没有用途）：只给一声轻响
    }
  } catch (err) { console.error('[interact] 短按出错', c.kind, c.key, err); ok = false; }
  emit('interact:short', { kind: c.kind, key: c.key, ok: !!ok });
  return ok;
}

function fireHold(c) {
  let ok = false;
  try {
    if (c.mode && S.owner && typeof S.owner.onHold === 'function') ok = S.owner.onHold(c) !== false;
    else if (c.onHold) ok = c.onHold(c) !== false;
    else {
      const h = handlers.get(c.kind);
      if (h && typeof h.hold === 'function') ok = h.hold(c) !== false;
    }
  } catch (err) { console.error('[interact] 长按动作出错', c.kind, c.key, err); ok = false; }
  emit('interact:hold', { kind: c.kind, key: c.key, ok: !!ok });
  return ok;
}

function modeShort(c) {
  const o = S.owner;
  if (o && typeof o.onShort === 'function') return o.onShort(c) !== false;
  const h = handlers.get(c.kind);
  emit('interact:modeShort', { mode: S.mode, key: o ? o.key : null });
  if (h && typeof h.short === 'function') return h.short(c) !== false;
  return true;
}

function itemRec(c) {
  const r = c.ref;
  if (r && r.id != null && has(BR.items, 'find')) return BR.items.find(r.id);
  if (r && r.id != null) return r;
  return has(BR.items, 'find') ? BR.items.find(c.key) : null;
}

function pickItem(c) {
  const rec = itemRec(c);
  if (!rec) return false;
  const P = BR.player;
  let ok = false;
  if (has(P, 'interact')) ok = !!P.interact(rec);
  else if (has(BR.items, 'pick')) ok = !!BR.items.pick(rec.id, 'me');
  if (ok) emit('interact:pick', { id: rec.id });
  return ok;
}

// ---------- 拖动 ----------
function propRec(key) {
  if (key == null || !has(BR.world, 'propByKey')) return null;
  try { return BR.world.propByKey(key) || null; } catch (err) { return null; }
}
function propLabel(key) { const P = propRec(key); return P && P.label ? String(P.label) : ''; }
// 拖这件道具时一起走的 key（它自己 + 还放在它上面的子孙），moveBox 要忽略它们
function famKeys(key) {
  if (has(BR.world, 'dragKeys')) {
    try { const ks = BR.world.dragKeys(key); if (Array.isArray(ks) && ks.length) return ks; } catch (err) { /* 退回只忽略自己 */ }
  }
  return [key];
}
// 一起动的那一家子的体积：每件只算自己的（world 记录的 ownVol）。kit 的 volume 已经含子道具，
// 拿它逐件相加会把放在上面的子道具重复算进去，拖起来会偏慢；没有 ownVol 的老 world 只算顶上那件的 volume
function famVolume(key, P) {
  P = P || propRec(key);
  if (!P) return 0;
  if (typeof P.ownVol !== 'number') return Math.max(0, num(P.volume, 0));
  const ks = famKeys(key);
  let v = 0;
  for (let i = 0; i < ks.length; i++) {
    const K = ks[i] === key ? P : propRec(ks[i]);
    if (K) v += Math.max(0, num(K.ownVol, 0));
  }
  return v;
}
// world 的道具记录：pivot 是此刻的世界坐标枢轴（已含拖过的位移），obb 在枢轴坐标系
function propPose(P, out) {
  const pv = P.pivot || P;
  out.x = num(pv.x, 0); out.y = num(pv.y, 0); out.z = num(pv.z, 0); out.rot = num(pv.rot, 0);
  return out;
}
const tmpPose = { x: 0, y: 0, z: 0, rot: 0 };

function entityById(id) {
  const E = BR.entities;
  if (!E) return null;
  if (has(E, 'get')) { const e = E.get(id); if (e) return e; }
  const L = E.list;
  if (!L) return null;
  if (!Array.isArray(L) && has(L, 'get')) return L.get(id) || null;
  if (Array.isArray(L)) { for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i]; return null; }
  return null;
}

function dragSpeed(V) {
  return Math.max(cv('dragVMin'), cv('dragV0') / (1 + cv('dragK') * Math.max(0, V)));
}

// 玩家水平前向，写进 F（不分配）
const F = { fx: 0, fz: -1 };
function horizF() {
  const yaw = num(BR.player && BR.player.yaw, 0);
  F.fx = -Math.sin(yaw); F.fz = -Math.cos(yaw);
  return F;
}

function startDrag(c) {
  if (S.mode !== 'walk') return false;
  const kind = c.dragKind || (c.kind === 'item' || c.kind === 'entity' || c.kind === 'door' ? c.kind : 'prop');
  const key = c.dragKey != null ? c.dragKey : c.key;
  const P = BR.player;
  D.kind = kind; D.key = key; D.label = c.dragLabel || c.label || '';
  D.handler = handlers.get(kind) && handlers.get(kind).drag ? handlers.get(kind).drag : null;
  D.ent = null; D.localHold = null;
  D.moved = 0;
  D.ignore.length = 0;
  D.exits.length = 0;
  D.exitCircles.length = 0;
  D.pushed.length = 0;
  D.scrape = 0;
  D.t = 0; D.edgeSince = -1; D.edgeAt = -1; D.edgeWhy = ''; D.edgeSaid = false;
  D.onFloor = false;
  D.elev = false; D.sup0 = false;
  let V = c.vol;

  // 被拖物体此刻的位置和尺寸
  if (kind === 'item') {
    const rec = itemRec(c);
    if (!rec) { cancel('gone'); return false; }
    D.key = rec.id;
    D.x = num(rec.x, 0); D.y = num(rec.y, 0); D.z = num(rec.z, 0); D.rot = 0;
    D.r = Math.max(0.05, num(rec.r, 0.12));
    D.h = Math.max(0.1, num(rec.hh, 0.1) * 2);
    D.onFloor = Math.abs(D.y - gY(D.x, D.z)) <= ON_FLOOR;
    D.elev = !D.onFloor && D.y > gY(D.x, D.z);
    D.sup0 = D.elev && supportedAt(D.x, D.z, D.y, 0.02, 0.02, null);
  } else if (kind === 'entity') {
    const e = entityById(key);
    if (!e || e.dead) { cancel('gone'); return false; }
    D.ent = e;
    D.x = num(e.x, 0); D.y = num(e.y, 0); D.z = num(e.z, 0); D.rot = 0;
    D.r = Math.max(0.1, num(e.r, num(e.def && e.def.radius, 0.35)));
    D.h = Math.max(0.3, num(e.h, 1.7));
    if (!(V > 0)) V = num(e.def && e.def.drag && e.def.drag.vol, 0);
  } else if (kind === 'prop') {
    const R = propRec(key);
    if (!R) { deny(c, c.dragWhy || ''); setState('idle'); return false; }
    if (R.draggable === false) { deny(c, c.dragWhy || R.why || ''); setState('idle'); return false; }
    propPose(R, tmpPose);
    D.x = tmpPose.x; D.y = tmpPose.y; D.z = tmpPose.z; D.rot = tmpPose.rot;
    if (!famExtents(key)) propExtents(R);
    V = famVolume(key, R);
    const ks = famKeys(key);
    for (let i = 0; i < ks.length; i++) pushKeyForms(D.ignore, ks[i]);
    pushKeyForms(D.ignore, R.solidKey);
    // 地面参照：占地中心此刻的地面；之后每一步 9 个采样点都和它比（抓起时就骑在台阶边的，只要不更糟就让挪）
    D.gRef = gY(D.x + (D.hx0 + D.hx1) / 2, D.z + (D.hz0 + D.hz1) / 2);
    propGroundDev(D.x, D.z, D.gDev);
    // 不在地上的（L3 钢货架隔板上的纸箱、桌上的东西）：改看底面下面有没有东西托着
    D.elev = D.yFoot - PROP_FOOT_CLEAR - D.gRef > PROP_GROUND_TOL;
    D.sup0 = D.elev && propSupported(D.x, D.z);
  } else {
    // 门等由各自模块接管的拖动
    D.x = num(c.x, 0); D.y = num(c.y, 0); D.z = num(c.z, 0); D.rot = 0;
  }
  D.v = dragSpeed(V);
  // 实体的限速由 entities 自己按 def.drag.vol 算（hold 里就是按它走的），人和它用同一个数
  if (kind === 'entity' && has(BR.entities, 'dragSpeed')) {
    const ev = num(BR.entities.dragSpeed(key), 0);
    if (ev > 0) D.v = ev;
  }

  // 手点：抓起时的水平距离夹在 grabMin..grabMax；物体枢轴相对手点的偏移按玩家朝向记下来，转身时东西跟着转到面前
  const f = horizF();
  const px = num(P && P.x, 0), pz = num(P && P.z, 0);
  const gx = c.t > 0 ? ray.ox + ray.dx * c.t : D.x, gz = c.t > 0 ? ray.oz + ray.dz * c.t : D.z;
  const hd = Math.hypot(gx - px, gz - pz);
  D.grabDist = U.clamp(hd, cv('grabMin'), cv('grabMax'));
  const hx = px + f.fx * D.grabDist, hz = pz + f.fz * D.grabDist;
  const ox = D.x - hx, oz = D.z - hz;
  // 右 = (cos yaw, −sin yaw) = (−fz, fx)
  D.offR = ox * -f.fz + oz * f.fx;
  D.offF = ox * f.fx + oz * f.fz;
  D.validX = D.x; D.validZ = D.z;
  collectExits();

  // 联机：先向房主要租约。BR.coop.requestGrab(k, kind, cb(ok, why)) 返回 false = 当场被拒；
  // true = 已经拿到或还在等房主——客机先动手、不等回复（手感不延迟），房主回 deny 时 cb(false) 再退回去
  const pre = LEASE[kind];
  D.lease = pre ? pre + key : null;
  D.pending = false; D.granted = true;
  D.sx = D.x; D.sz = D.z;
  if (coopLive() && D.lease) {
    const C = BR.coop;
    if (!has(C, 'requestGrab')) { deny(c, ''); setState('idle'); return false; }
    if (has(C, 'leaseOf')) {
      let L = null;
      try { L = C.leaseOf(D.lease); } catch (err) { L = null; }
      const by = L && typeof L === 'object' ? L.by : L;
      if (by != null && by !== 'me' && by !== coopRole() && by !== true) { deny(c, '队友正拿着它'); setState('idle'); return false; }
    }
    const myLease = D.lease;
    D.pending = true;
    let sync = true;
    try { sync = C.requestGrab(myLease, kind, (ok, why) => onGrant(myLease, ok, why)); }
    catch (err) { console.error('[interact] requestGrab 出错', err); sync = false; }
    if (D.lease === myLease && D.pending && sync === false) onGrant(myLease, false, 'bad');
    if (D.lease !== myLease || !D.granted) return false;   // 当场被拒（onGrant 已经回到 idle）
  }
  setState('drag');
  beginHold(c);
  return true;
}

// 房主的回复。过期的（已经松手或换了目标）不管：松手时已经发过 release，房主那边会收回
function onGrant(lease, ok, why) {
  if (D.lease !== lease || !D.pending) return;
  D.pending = false;
  if (ok) return;
  D.granted = false;
  if (why === 'peer') toast('队友正拿着它', 1500);
  if (S.state === 'drag') {
    // 先动的那几帧退回原处：这件东西归队友，位置以房主广播的为准
    if (D.kind === 'item' || D.kind === 'prop') { D.x = D.sx; D.z = D.sz; applyPos(); }
    release('taken');   // 会发 'interact:cancel' {reason:'taken'}
  } else {
    resetDrag();
    emit('interact:cancel', { reason: 'taken' });
  }
}

// 开始拖（单机、房主直接拿到；客机先动手）
function beginHold(c) {
  if (D.kind === 'item') { if (has(BR.items, 'hold')) BR.items.hold(D.key, true); }
  else if (D.kind === 'entity') {
    if (coopRole() === 'guest') { D.localHold = true; setLocalHold(D.x, D.z); }
    else if (has(BR.entities, 'grab') && BR.entities.grab(D.key, 'me') === false) { cancelGrab(); return; }
  } else if (D.handler && typeof D.handler.grab === 'function') {
    let ok = true;
    try { ok = D.handler.grab(c, D) !== false; } catch (err) { console.error('[interact] grab 出错', err); }
    if (!ok) { cancelGrab(); return; }
  }
  if (has(BR.input, 'haptic')) BR.input.haptic(12);
  grabSound();
  emit('interact:grab', { kind: D.kind, key: D.key });
}

// ---------- 拖动的声音（音效库里没有专门的拖拽声：用压低音调的脚步声当闷响和摩擦，A1 不加循环声） ----------
function grabSound() {
  if (D.kind === 'prop') sound('step', { volume: 0.55, rate: 0.6 });
  else if (D.kind === 'item') sound('step', { volume: 0.22, rate: 1.6 });
  else if (D.kind === 'entity') sound('step', { volume: 0.4, rate: 0.8 });
}
function scrapeSound(d) {
  if (D.kind !== 'prop') return;
  D.scrape += d;
  if (D.scrape < SCRAPE_EVERY) return;
  D.scrape = 0;
  // 越重越响、越闷
  const heavy = U.clamp((cv('dragV0') - D.v) / cv('dragV0'), 0, 1);
  sound('step', { volume: 0.25 + 0.3 * heavy, rate: 0.62 - 0.14 * heavy });
}
function dropSound(reason) {
  // 换层、卸块、东西没了、死亡：场景马上要变，不出声
  if (reason === 'level' || reason === 'unload' || reason === 'gone' || reason === 'death' || reason === 'home') return;
  if (D.kind === 'prop') sound('step', { volume: 0.8, rate: 0.5 });
  else if (D.kind === 'item') sound('step', { volume: 0.25, rate: 1.4 });
  else if (D.kind === 'entity') sound('step', { volume: 0.45, rate: 0.75 });
}
// 抓取当场失败（实体不让拖、门的模块拒绝）：还掉租约，回到空闲
function cancelGrab() {
  if (coopLive() && D.lease && has(BR.coop, 'release')) {
    try { BR.coop.release(D.lease, [D.x, D.y, D.z]); } catch (err) { /* 没拿到就没什么可还 */ }
  }
  resetDrag();
  setState('idle');
}

// 拖动时的占地：道具连同放在上面的子孙此刻的世界外接盒（world.propBox），存成相对枢轴的范围
const famBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
function famExtents(key) {
  if (!has(BR.world, 'propBox')) return false;
  let b = null;
  try { b = BR.world.propBox(key, famBox); } catch (err) { b = null; }
  if (!b || !(b.minX <= b.maxX) || !(b.minZ <= b.maxZ) || !(b.minY <= b.maxY)) return false;
  D.hx0 = b.minX - D.x; D.hx1 = b.maxX - D.x; D.hz0 = b.minZ - D.z; D.hz1 = b.maxZ - D.z;
  D.yFoot = b.minY + PROP_FOOT_CLEAR;
  D.h = Math.max(0.05, b.maxY - b.minY - PROP_FOOT_CLEAR);
  D.r = Math.max(D.hx1 - D.hx0, D.hz1 - D.hz0) / 2;
  return true;
}
// 兜底：道具 OBB 投到水平面的包围盒（相对枢轴），和竖直范围
function propExtents(R) {
  const ob = R.obb || {};
  const mn = Array.isArray(ob.min) ? ob.min : [-0.3, 0, -0.3], mx = Array.isArray(ob.max) ? ob.max : [0.3, 1, 0.3];
  // world 的 OBB 转角是 orot + ry（OBB 由碰撞体外接盒兜底时 orot = 0，不一定等于枢轴的 rot）
  const th = typeof R.orot === 'number' ? R.orot + num(R.ry, 0) : D.rot;
  const c = Math.cos(th), s = Math.sin(th);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const lx = i & 1 ? mx[0] : mn[0], lz = i & 2 ? mx[2] : mn[2];
    const wx = c * lx + s * lz, wz = -s * lx + c * lz;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
    if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
  }
  D.hx0 = x0; D.hx1 = x1; D.hz0 = z0; D.hz1 = z1;
  D.yFoot = D.y + num(mn[1], 0) + PROP_FOOT_CLEAR;
  D.h = Math.max(0.05, num(mx[1], 1) - num(mn[1], 0) - PROP_FOOT_CLEAR);
  D.r = Math.max(x1 - x0, z1 - z0) / 2;
}

function collectExits() {
  D.exits.length = 0;
  D.exitCircles.length = 0;
  if (!has(BR.world, 'exits')) return;
  let list = null;
  try { list = BR.world.exits(); } catch (err) { list = null; }
  if (!Array.isArray(list)) return;
  const m = cv('exitMargin');
  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    if (!ex || ex.active === false || !(num(ex.x, NaN) === ex.x)) continue;
    const R = num(ex.radius, 1) + EXIT_SCAN;
    if (U.dist2(ex.x, ex.z, D.x, D.z) > R * R) continue;
    D.exits.push(ex);
    // 拖道具时出口圈（+exitMargin）当成圆形障碍交给 phys.moveBox，东西停在圈外（不同高度的不算）
    if (!(typeof ex.y === 'number' && Math.abs(ex.y - D.y) > 2.5)) D.exitCircles.push([ex.x, ex.z, num(ex.radius, 1) + m]);
  }
}

// 被拖物体在 (x, z) 时压没压在出口圈（+exitMargin）或玩家上：0 没压着，1 压着出口圈，2 压着人
function overlapsAt(x, z) {
  if (exitHitAt(x, z)) return 1;
  const PR = num(BR.config && BR.config.player && BR.config.player.radius, 0.3);
  const P = BR.player;
  if (P && circleHits(x, z, P.x, P.z, PR - 0.02)) return 2;
  const peer = peerPos();
  if (peer && circleHits(x, z, peer.x, peer.z, PR - 0.02)) return 2;
  return 0;
}
function exitHitAt(x, z) {
  const m = cv('exitMargin');
  for (let i = 0; i < D.exits.length; i++) {
    const ex = D.exits[i];
    if (typeof ex.y === 'number' && Math.abs(ex.y - D.y) > 2.5) continue;
    const R = num(ex.radius, 1) + m;
    if (circleHits(x, z, ex.x, ex.z, R)) return true;
  }
  return false;
}

// ---------- 地面（拖动不悬空） ----------
function gY(x, z) {
  if (!has(BR.phys, 'groundY')) return 0;
  const g = +BR.phys.groundY(x, z);
  return Number.isFinite(g) ? g : 0;
}
// 道具占地（枢轴在 (x, z) 时）3×3 个采样点（四角内缩一点）的地面和抓起时的地面差，写进 out[0..8]
function propGroundDev(x, z, out) {
  const ix = Math.min(0.02, (D.hx1 - D.hx0) * 0.25), iz = Math.min(0.02, (D.hz1 - D.hz0) * 0.25);
  const x0 = x + D.hx0 + ix, x1 = x + D.hx1 - ix, z0 = z + D.hz0 + iz, z1 = z + D.hz1 - iz;
  let k = 0;
  for (let a = 0; a < 3; a++) {
    const sx = a === 0 ? x0 : a === 1 ? (x0 + x1) / 2 : x1;
    for (let b = 0; b < 3; b++) {
      const sz = b === 0 ? z0 : b === 1 ? (z0 + z1) / 2 : z1;
      out[k++] = Math.abs(gY(sx, sz) - D.gRef);
    }
  }
  return out;
}
const gNew = new Float64Array(9);
// (cx, cz) 周围 ±hw / ±hd 的小块里，底面 yb 往下 SUPPORT_TOL 以内有没有碰撞体（隔板、桌面、整块货架碰撞盒）托着
function supportedAt(cx, cz, yb, hw, hd, ignore) {
  if (!has(BR.phys, 'overlapBox')) return true;
  return BR.phys.overlapBox(cx - hw, cz - hd, cx + hw, cz + hd, yb - SUPPORT_TOL, SUPPORT_TOL + 0.01, ignore && ignore.length ? { ignoreKey: ignore } : null) > 0;
}
// 不在地上的道具：重心（占地中心附近一小块，边长 12%）下面还有东西托着——重心拖出架子、拖过桌边就停（再往外就该翻下去了）
function propSupported(x, z) {
  const cx = x + (D.hx0 + D.hx1) / 2, cz = z + (D.hz0 + D.hz1) / 2;
  return supportedAt(cx, cz, D.yFoot - PROP_FOOT_CLEAR, Math.max(0.02, (D.hx1 - D.hx0) * 0.06), Math.max(0.02, (D.hz1 - D.hz0) * 0.06), D.ignore);
}
// 道具挪到 (x, z) 时脚下还是不是抓起时那块地：每个采样点都在 5 cm 以内，或者至少没比现在更糟；
// 不在地上的看重心下面有没有托着（抓起时就悬空的，不更糟就让挪）。挡住时 blockWhy 记下是哪一种（给玩家说原因）
let blockWhy = '';
const EDGE_WHY = { edge: '再往前就掉下去了', elev: '搬不下来，只能在上面推', exit: '门口得留出来' };
function propGroundOk(x, z) {
  if (D.elev) {
    if (!D.sup0 || propSupported(x, z)) return true;
    blockWhy = 'elev';
    return false;
  }
  propGroundDev(x, z, gNew);
  for (let i = 0; i < 9; i++) if (gNew[i] > PROP_GROUND_TOL && gNew[i] > D.gDev[i] + 1e-4) { blockWhy = 'edge'; return false; }
  return true;
}
// 物资挪到 (x, z)：中心和前后左右半径一半处的地面，和它此刻脚下的地面高差都不超过一步；出口圈也不能进
function itemStepOk(x, z) {
  if (D.elev) {
    // 架子上、桌上的（浮动的拾取物刷在高处）：中心下面要一直有东西托着
    if (D.sup0 && !supportedAt(x, z, D.y, 0.02, 0.02, null)) { blockWhy = 'elev'; return false; }
  } else {
    const g0 = gY(D.x, D.z), h = D.r * 0.5;
    if (Math.abs(gY(x, z) - g0) > ITEM_STEP || Math.abs(gY(x + h, z) - g0) > ITEM_STEP || Math.abs(gY(x - h, z) - g0) > ITEM_STEP ||
        Math.abs(gY(x, z + h) - g0) > ITEM_STEP || Math.abs(gY(x, z - h) - g0) > ITEM_STEP) { blockWhy = 'edge'; return false; }
  }
  if (exitHitAt(x, z) && !exitHitAt(D.x, D.z)) { blockWhy = 'exit'; return false; }   // 本来就压在圈里的（生成时就在门口）让它出来
  return true;
}
// 这一步 (mx, mz) 走不了就试试只走 X 或只走 Z（贴着坑沿 / 出口圈滑），都不行就不动；结果写回 stepOut
const stepOut = { x: 0, z: 0 };
function filterStep(mx, mz, ok) {
  stepOut.x = 0; stepOut.z = 0;
  blockWhy = '';
  if (ok(D.x + mx, D.z + mz)) { stepOut.x = mx; stepOut.z = mz; return stepOut; }
  if (Math.abs(mx) > MOVE_EPS && ok(D.x + mx, D.z)) { stepOut.x = mx; return stepOut; }
  if (Math.abs(mz) > MOVE_EPS && ok(D.x, D.z + mz)) { stepOut.z = mz; return stepOut; }
  return stepOut;
}

// ---------- 道具推开占地里的地上物资（单机、房主；客机拖的由房主 commitProp 时挪开） ----------
// (mx, mz) 是道具这一步的位移；推不开（物资被墙卡住、前面是坑）返回 false，道具这一步就不走
function pushItems(mx, mz) {
  const I = BR.items;
  const list = I && Array.isArray(I.list) ? I.list : null;
  if (!list || !list.length || !has(I, 'move')) return true;
  const x0 = D.x + mx + D.hx0, x1 = D.x + mx + D.hx1, z0 = D.z + mz + D.hz0, z1 = D.z + mz + D.hz1;
  const yb = D.yFoot - PROP_FOOT_CLEAR, yt = yb + D.h + PROP_FOOT_CLEAR;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.owner || (p.held && D.pushed.indexOf(p.id) < 0)) continue;
    const g = gY(p.x, p.z);
    if (Math.abs(num(p.y, g) - g) > ON_FLOOR) continue;           // 只推放在地上的（桌上、箱里的不管）
    if (p.y > yt || p.y + num(p.hh, 0.1) * 2 < yb) continue;       // 高度上碰不到
    const r = Math.max(0.04, num(p.r, 0.1) * 0.8);
    const qx = U.clamp(p.x, x0, x1), qz = U.clamp(p.z, z0, z1);
    if (U.dist2(qx, qz, p.x, p.z) >= r * r) continue;
    // 往道具前进的方向推到占地外面：挑位移最小的那一侧
    let bx = 0, bz = 0, best = Infinity;
    if (mx > MOVE_EPS) { const d = x1 + r + PUSH_GAP - p.x; if (d < best) { best = d; bx = d; bz = 0; } }
    if (mx < -MOVE_EPS) { const d = p.x - (x0 - r - PUSH_GAP); if (d < best) { best = d; bx = -d; bz = 0; } }
    if (mz > MOVE_EPS) { const d = z1 + r + PUSH_GAP - p.z; if (d < best) { best = d; bx = 0; bz = d; } }
    if (mz < -MOVE_EPS) { const d = p.z - (z0 - r - PUSH_GAP); if (d < best) { best = d; bx = 0; bz = -d; } }
    if (!(best < Infinity)) return false;
    let nx = p.x + bx, nz = p.z + bz;
    if (has(BR.phys, 'moveCircle')) {
      const res = BR.phys.moveCircle(p.x, p.z, r, bx, bz, g + 0.02, Math.max(0.1, num(p.hh, 0.1) * 2));
      if (res) { nx = num(res.x, nx); nz = num(res.z, nz); }
    }
    if (Math.abs(gY(nx, nz) - g) > ITEM_STEP) return false;          // 前面是坑：推不过去，道具也停下
    const cx = U.clamp(nx, x0, x1), cz = U.clamp(nz, z0, z1);
    if (U.dist2(cx, cz, nx, nz) < (r - 0.005) * (r - 0.005)) return false;   // 被墙卡住推不开
    if (D.pushed.indexOf(p.id) < 0) {
      D.pushed.push(p.id);
      if (has(I, 'hold')) I.hold(p.id, true);   // 推的过程中不浮动、不每步写 levelState，放下时一次写
    }
    I.move(p.id, nx, undefined, nz);
  }
  return true;
}
function releasePushed() {
  const I = BR.items;
  for (let i = 0; i < D.pushed.length; i++) if (has(I, 'hold')) I.hold(D.pushed[i], false);
  D.pushed.length = 0;
}
function circleHits(x, z, cx, cz, R) {
  if (D.kind === 'prop') {
    const qx = U.clamp(cx, x + D.hx0, x + D.hx1), qz = U.clamp(cz, z + D.hz0, z + D.hz1);
    return U.dist2(qx, qz, cx, cz) < R * R;
  }
  const rr = R + D.r;
  return U.dist2(x, z, cx, cz) < rr * rr;
}
function peerPos() {
  if (!coopLive() || !BR.coop) return null;
  let p = null;
  try { p = BR.coop.peer; } catch (err) { p = null; }
  if (!p || !(num(p.x, NaN) === p.x)) return null;
  if (typeof p.y === 'number' && Math.abs(p.y - num(BR.player && BR.player.y, p.y)) > 2) return null;
  return p;
}

// 这一步被脚下的规则挡掉了一大半（台阶边、坑沿、门廊外、架子边、出口圈）：记下来。挡住超过 0.3 s 说一次原因；
// 人接着走、手和东西拉开太远时（cancel 'far'）说的也是这个原因，不说「手滑了」（2026-10-02 返修：L3 货架纸箱拿不下来）
const EDGE_SAY_S = 0.3, EDGE_RECENT_S = 1;
function noteEdge(mx, mz) {
  const want = Math.hypot(mx, mz);
  if (!blockWhy || want < MOVE_EPS || Math.hypot(stepOut.x, stepOut.z) > want * 0.5) { D.edgeSince = -1; return; }
  if (D.edgeSince < 0) D.edgeSince = D.t;
  D.edgeAt = D.t;
  D.edgeWhy = EDGE_WHY[blockWhy] || '';
  if (!D.edgeSaid && D.edgeWhy && D.t - D.edgeSince >= EDGE_SAY_S) { D.edgeSaid = true; toast(D.edgeWhy, 1500); }
}
function edgeRecent() { return !!D.edgeWhy && D.edgeAt >= 0 && D.t - D.edgeAt <= EDGE_RECENT_S; }

const circles = [];
const circP = [0, 0, 0.3], circQ = [0, 0, 0.3];
function stepDrag(dt, inp, up, cancelled) {
  if (cancelled) { cancel('input'); return; }
  if (up) { release('release'); return; }
  D.t += num(dt, 0);
  const P = BR.player;
  if (!P) { cancel('gone'); return; }
  // 目标还在不在
  let ent = null;
  if (D.kind === 'item') {
    const rec = has(BR.items, 'find') ? BR.items.find(D.key) : null;
    if (!rec) { cancel('gone'); return; }
  } else if (D.kind === 'entity') {
    ent = entityById(D.key);
    if (!ent || ent.dead) { cancel('gone'); return; }
    D.ent = ent;
  } else if (D.kind === 'prop') {
    if (!propRec(D.key)) { cancel('unload'); return; }
  }

  const f = horizF();
  const px = num(P.x, 0), pz = num(P.z, 0);
  const hx = px + f.fx * D.grabDist, hz = pz + f.fz * D.grabDist;
  // 右 = (−fz, fx)
  const ox = -f.fz * D.offR + f.fx * D.offF, oz = f.fx * D.offR + f.fz * D.offF;
  const tx = hx + ox, tz = hz + oz;

  // 手点和物体上被抓的那一点离太远（被卡住、转身太快）：原地放下
  const gx = D.x - ox, gz = D.z - oz;
  if (Math.hypot(gx - hx, gz - hz) > cv('breakDist')) { cancel('far'); return; }

  let sx = tx - D.x, sz = tz - D.z;
  const len = Math.hypot(sx, sz);
  const maxStep = D.v * dt;
  if (len > maxStep && len > 0) { sx *= maxStep / len; sz *= maxStep / len; }

  if (D.kind === 'entity') {
    // 实体由 entities.hold 自己按限速和碰撞推过去；客机只覆盖本地显示位置
    if (D.localHold) {
      // 客机：本机先按手点显示（贴墙），房主收到 me.h 后按同一个手点真的挪
      let mx = sx, mz = sz;
      if (has(BR.phys, 'moveCircle')) {
        const r = BR.phys.moveCircle(D.x, D.z, D.r, sx, sz, D.y, D.h);
        if (r) { mx = num(r.x, D.x) - D.x; mz = num(r.z, D.z) - D.z; }
      }
      D.x += mx; D.z += mz;
      D.moved += Math.hypot(mx, mz);
      setLocalHold(D.x, D.z);
    } else {
      if (has(BR.entities, 'hold')) BR.entities.hold(D.key, tx, tz);
      const nx = num(ent.x, D.x), nz = num(ent.z, D.z);
      D.moved += Math.hypot(nx - D.x, nz - D.z);
      D.x = nx; D.z = nz;
    }
  } else if (D.kind === 'item' || D.kind === 'prop') {
    if (Math.abs(sx) + Math.abs(sz) > MOVE_EPS) {
      let mx = sx, mz = sz;
      if (D.kind === 'prop' && has(BR.phys, 'moveBox')) {
        // 圆形障碍：人、队友、附近的出口圈（东西停在圈外，门口留出来）
        circles.length = 0;
        circP[0] = px; circP[1] = pz; circP[2] = num(BR.config.player && BR.config.player.radius, 0.3);
        circles.push(circP);
        const peer = peerPos();
        if (peer) { circQ[0] = peer.x; circQ[1] = peer.z; circQ[2] = circP[2]; circles.push(circQ); }
        for (let i = 0; i < D.exitCircles.length; i++) circles.push(D.exitCircles[i]);
        const r = BR.phys.moveBox(D.x + D.hx0, D.z + D.hz0, D.x + D.hx1, D.z + D.hz1, D.yFoot, D.h, sx, sz,
          { ignoreKey: D.ignore, circles });
        if (r) { mx = num(r.dx, 0); mz = num(r.dz, 0); }
        // 脚下：占地要一直落在抓起时那块地上（坑、楼板洞、台阶、门廊外都当墙）
        filterStep(mx, mz, propGroundOk);
        noteEdge(mx, mz);
        mx = stepOut.x; mz = stepOut.z;
        // 占地里的地上物资顺着推开；推不开（卡墙、前面是坑）道具这一步也不走
        if (Math.abs(mx) + Math.abs(mz) > MOVE_EPS && coopRole() !== 'guest' && !pushItems(mx, mz)) { mx = 0; mz = 0; }
      } else if (D.kind === 'item' && has(BR.phys, 'moveCircle')) {
        const r = BR.phys.moveCircle(D.x, D.z, D.r, sx, sz, D.y, D.h);
        if (r) { mx = num(r.x, D.x) - D.x; mz = num(r.z, D.z) - D.z; }
        filterStep(mx, mz, itemStepOk);
        noteEdge(mx, mz);
        mx = stepOut.x; mz = stepOut.z;
      }
      if (Math.abs(mx) + Math.abs(mz) > MOVE_EPS) {
        D.x += mx; D.z += mz;
        const d = Math.hypot(mx, mz);
        D.moved += d;
        if (D.kind === 'prop') propGroundDev(D.x, D.z, D.gDev);
        else if (D.onFloor) D.y = gY(D.x, D.z);   // 放在地上的物资跟着地面起伏（斜坡、小台阶）
        applyPos();
        scrapeSound(d);
      }
    }
  } else if (D.handler && typeof D.handler.move === 'function') {
    try { D.handler.move(locked, D, tx, tz, dt); } catch (err) { console.error('[interact] 拖动出错', err); }
  }
  if (!overlapsAt(D.x, D.z)) { D.validX = D.x; D.validZ = D.z; }
  // 联机：每帧把手上那件东西的位置报给 coop（随 me.h 发出去；道具 = 枢轴，物资 = 物资坐标，实体 = 本机的手点）
  if (D.lease && coopLive() && has(BR.coop, 'hand')) {
    try { BR.coop.hand(D.lease, D.x, D.y, D.z, 0); } catch (err) { /* 联机模块自己会报 */ }
  }
}

function applyPos() {
  if (D.kind === 'item') { if (has(BR.items, 'move')) BR.items.move(D.key, D.x, D.y, D.z); }
  else if (D.kind === 'prop') { if (has(BR.world, 'movePropTo')) BR.world.movePropTo(D.key, D.x, D.z); }
  else if (D.kind === 'entity' && D.localHold) setLocalHold(D.x, D.z);
}
// 联机客机拖实体：只改本机显示位置（entities.localHold），null 表示松手
function setLocalHold(x, z) {
  if (has(BR.entities, 'localHold')) { BR.entities.localHold(D.key, x, z); return; }
  const e = D.ent;
  if (!e) return;
  if (x == null) e._localHold = null;
  else if (e._localHold) { e._localHold.x = x; e._localHold.z = z; }
  else e._localHold = { x, z };
}

// 松手（reason='release'）或被打断（暂停、死亡、换层、走远……）：都原地放下；压在出口圈或人身上就退回上一个合法位置
function release(reason) {
  if (S.state !== 'drag') return;
  setState('idle');
  // 兜底：拖动中出口圈已经是障碍，这里一般不会再发生；真压着了（比如刚载入的出口）退回上一个合法位置，并说清楚为什么
  const ov = D.kind === 'item' || D.kind === 'prop' ? overlapsAt(D.x, D.z) : 0;
  if (ov && (D.validX !== D.x || D.validZ !== D.z)) {
    D.x = D.validX; D.z = D.validZ;
    if (D.kind === 'item' && D.onFloor) D.y = gY(D.x, D.z);
    applyPos();
    if (ov === 1 && reason === 'release') toast('门口得留出来', 1500);
  }
  releasePushed();
  dropSound(reason);
  if (reason === 'far') toast(edgeRecent() ? D.edgeWhy : '手滑了', 1200);
  let picked = false;
  if (D.kind === 'item') {
    if (has(BR.items, 'hold')) BR.items.hold(D.key, false);
    // pickSlop 只对物资：几乎没挪就松手 = 想捡
    if (reason === 'release' && D.moved < cv('pickSlop')) picked = pickItem(locked);
  } else if (D.kind === 'prop') {
    if (has(BR.world, 'commitProp')) {
      try { BR.world.commitProp(D.key); } catch (err) { console.error('[interact] commitProp 出错', err); }
    }
  } else if (D.kind === 'entity') {
    if (D.localHold) { setLocalHold(null, null); D.localHold = null; }
    else if (has(BR.entities, 'release')) BR.entities.release(D.key);
  } else if (D.handler && typeof D.handler.release === 'function') {
    try { D.handler.release(locked, D, reason); } catch (err) { console.error('[interact] 松手出错', err); }
  }
  if (coopLive() && D.lease && has(BR.coop, 'release')) {
    try { BR.coop.release(D.lease, [D.x, D.y, D.z]); } catch (err) { console.error('[interact] coop.release 出错', err); }
  }
  if (reason !== 'release') emit('interact:cancel', { reason });
  if (!picked) emit('interact:release', { kind: D.kind, key: D.key, x: D.x, z: D.z });
  resetDrag();
}

function resetDrag() {
  if (D.localHold) setLocalHold(null, null);
  if (D.pushed.length) releasePushed();
  D.kind = null; D.key = null; D.lease = null; D.handler = null; D.ent = null; D.localHold = null;
  D.pending = false; D.granted = false;
}

// 外部打断：暂停、死亡、换层、目标被队友拿走、区块卸载、手离物体太远
function cancel(reason) {
  const st = S.state;
  if (st === 'drag') { release(reason || 'cancel'); return; }
  setState('idle');
  if (st !== 'idle') emit('interact:cancel', { reason: reason || 'cancel' });
}

// ---------- 每帧 ----------
// player.update 在转完视角、走路之前调用；inp 为 null 表示输入关着（暂停、菜单、死亡）
function update(dt, inp) {
  dt = num(dt, 0);
  const P = BR.player;
  if (!P || P.dead) {
    if (S.state !== 'idle') cancel(P && P.dead ? 'death' : 'gone');
    S.has = false;
    return;
  }
  if (!inp) {
    if (S.state !== 'idle') cancel('pause');
    aim();
    return;
  }
  const pressed = has(inp, 'pressed') && inp.pressed('interact');
  const held = has(inp, 'held') ? !!inp.held('interact') : false;
  const relEdge = has(inp, 'released') ? !!inp.released('interact') : false;
  const cancelled = has(inp, 'cancelled') ? !!inp.cancelled('interact') : false;

  if (S.state === 'idle') aim();

  if (pressed && S.state !== 'idle') {
    // 漏掉了上一次松手（老 input 没有 released）：把上一轮当松手收掉，再处理这次按下
    if (S.state === 'drag') release('release'); else setState('idle');
  }
  if (pressed) {
    onPress(inp);
    // 同一帧里按下又松开（keyboard.press）：下面按松手处理
  } else if (S.state !== 'idle') {
    S.simMs += dt * 1000;
  }
  const up = relEdge || !held;
  if (S.state === 'pressed') stepPressed(dt, inp, up, cancelled && !pressed);
  else if (S.state === 'hold') stepHold(dt, inp, up, cancelled && !pressed);
  else if (S.state === 'drag') stepDrag(dt, inp, up, cancelled && !pressed);

  // 非 idle 时准心目标保持为按下时锁定的那个，HUD 提示不跟着视线乱跳
  if (S.state !== 'idle') { copyCand(cur, locked); S.has = true; }
}

// ---------- 情境 ----------
// mode：'walk' | 'seat' | 'lie' | 'drive' | 'view'；owner：key 字符串，或
// { key, kind, label, short:{verb,ok,why}, hold, onShort(c), onHold(c), accept(c) }（缺的按情境默认值补）
function setMode(mode, owner) {
  mode = Object.prototype.hasOwnProperty.call(MODE_DEFAULTS, mode) ? mode : 'walk';
  if (S.state !== 'idle') cancel('mode');
  S.mode = mode;
  const def = MODE_DEFAULTS[mode];
  if (!def) {
    S.owner = null;
  } else {
    const o = owner && typeof owner === 'object' ? owner : { key: owner != null ? owner : null };
    S.owner = {
      key: o.key != null ? o.key : null,
      kind: o.kind || def.kind,
      label: o.label || '',
      short: o.short || def.short,
      hold: o.hold || null,
      onShort: typeof o.onShort === 'function' ? o.onShort : null,
      onHold: typeof o.onHold === 'function' ? o.onHold : null,
      accept: typeof o.accept === 'function' ? o.accept : null,
    };
    const m = blank();
    m.kind = S.owner.kind; m.key = S.owner.key; m.label = S.owner.label;
    m.short = S.owner.short; m.hold = S.owner.hold; m.mode = mode; m.t = 0;
    copyCand(modeCand, m);
  }
  if (has(BR.input, 'setContext')) {
    try { BR.input.setContext(INPUT_CONTEXT[mode] || 'walk'); } catch (err) { /* 老 input 不认的情境忽略 */ }
  }
  // 联机：姿态随 me 发给对方（这一阶段只收发；座位 'u:' / 载具 'k:' 租约靠 pose 的 key 保活，所以 key 就是情境接管者的 key）
  if (has(BR.coop, 'setPose')) {
    try { BR.coop.setPose(mode, S.owner ? S.owner.key : null); } catch (err) { /* 老 coop 没有姿态 */ }
  }
  S.has = false;
  // 立刻按新情境重算一次，HUD 这一帧就能显示「起身 / 下车 / 换画面」
  if (BR.player && !BR.player.dead) aim();
  emit('interact:mode', { mode, key: S.owner ? S.owner.key : null });
  return mode;
}

// ---------- 测试 / 联机辅助 ----------
// 让准心对准某一点（改 player 的 yaw / pitch），立即重算一次瞄准，返回 current
function aimAt(x, y, z) {
  const P = BR.player;
  if (!P) return null;
  const dx = x - P.x, dy = y - P.y, dz = z - P.z;
  const h = Math.hypot(dx, dz);
  if (h > 1e-6) P.yaw = Math.atan2(-dx, -dz);
  P.pitch = U.clamp(Math.atan2(dy, Math.max(h, 1e-6)), -85 * DEG, 85 * DEG);
  if (S.state === 'idle') aim();
  return S.has ? cur : null;
}

function heldInfo() {
  if (S.state !== 'drag' || !D.granted || !D.lease) return null;
  heldOut.k = D.lease; heldOut.kind = D.kind;
  heldOut.x = D.x; heldOut.y = D.y; heldOut.z = D.z; heldOut.a = 0;
  return heldOut;
}

function holdProgress() {
  if (S.state !== 'pressed' && S.state !== 'hold') return 0;
  const ms = Math.max(S.simMs, S.realMs);
  if (ms < cv('ringDelayMs')) return 0;
  const c = locked;
  const target = S.state === 'hold' || (!c.canDrag && c.hold) ? holdTargetMs(c) : cv('holdMs');
  return U.clamp(ms / target, 0, 1);
}

function speedCap() {
  if (S.state !== 'drag') return 1;
  const walk = num(BR.config.player && BR.config.player.walk, 3);
  return U.clamp(D.v / walk, 0, 1);
}

function debugInfo() {
  return {
    state: S.state, mode: S.mode, owner: S.owner ? S.owner.key : null,
    current: S.has ? { kind: cur.kind, key: cur.key, label: cur.label, t: +cur.t.toFixed(3), canDrag: cur.canDrag,
      short: cur.short ? cur.short.verb || '' : null, dragKind: cur.dragKind, dragKey: cur.dragKey, src: cur.src } : null,
    wallT: ray.wallT, wallKey: ray.wallKey,
    sources: sources.map(s => s.name), handlers: Array.from(handlers.keys()),
    drag: S.state === 'drag' ? { kind: D.kind, key: D.key, x: D.x, z: D.z, moved: D.moved, v: D.v, pending: D.pending, lease: D.lease } : null,
    heldMs: Math.max(S.simMs, S.realMs),
  };
}

// 新开一局 / 回主页：场景马上整个清掉，不写回 world / levelState，直接丢掉拖动状态
function reset() {
  const st = S.state;
  setState('idle');
  if (st !== 'idle') emit('interact:cancel', { reason: 'home' });
  S.has = false;
  const wasMode = S.mode;
  S.mode = 'walk';
  S.owner = null;
  D.pushed.length = 0;   // 场景整个要清掉：推开过的物资不用再写回
  resetDrag();
  // 上一局停在坐 / 开车 / 看监控里回的主页：输入情境也要回到走路
  if (wasMode !== 'walk' && has(BR.input, 'setContext')) {
    try { BR.input.setContext('walk'); } catch (err) { /* 老 input 没有情境 */ }
  }
  if (wasMode !== 'walk' && has(BR.coop, 'setPose')) {
    try { BR.coop.setPose('walk', null); } catch (err) { /* 老 coop 没有姿态 */ }
  }
}

// ---------- 局外 ----------
if (BR.bus) {
  BR.bus.on('player:death', () => { cancel('death'); S.has = false; });
  BR.bus.on('level:leave', () => { cancel('level'); S.has = false; });
  // 单机暂停时 main 不再跑 player.update，等不到 inp=null 那一帧：这里直接原地放下
  BR.bus.on('game:pause', p => { if (p && p.paused) cancel('pause'); });
  BR.bus.on('game:home', reset);
  BR.bus.on('game:start', reset);
  // 联机：房主拒绝或收回租约（目标被队友拿走）
  // why：'peer' 队友拿着（提示「队友正拿着它」）；'old' 对方版本旧（coop 自己已经提示过）；
  // 'far' / 'gone' / 'lv' / 'fixed' / 'timeout' / 'released' / 'bad'：不另外提示，原地放下就行
  BR.bus.on('net:deny', p => {
    if (S.state !== 'drag' || !p) return;
    const k = p.k != null ? p.k : p.key;
    if (k !== D.lease) return;
    const why = p.why ? String(p.why) : 'peer';
    if (D.pending) onGrant(D.lease, false, why);
    else { if (why === 'peer') toast('队友正拿着它', 1500); cancel(why === 'peer' ? 'taken' : why); }
  });
}

BR.interact = {
  addSource, removeSource, handle,
  hit: { sphere: hitSphere, box: hitBox, obb: hitObb, cylinder: hitCylinder },
  update, cancel, setMode, aimAt, heldInfo, holdProgress, speedCap, debugInfo,
  // 准心目标：复用对象，没对准任何东西时为 null（HUD 只读，别改）
  get current() { return S.has ? cur : null; },
  // 按下那一帧锁定的目标（state 不是 idle 时有意义）
  get target() { return S.state !== 'idle' ? locked : null; },
  get state() { return S.state; },
  get dragging() { return S.state === 'drag'; },
  get mode() { return S.mode; },
  get owner() { return S.owner ? S.owner.key : null; },
  // view 情境（监控画面）隐藏准心
  get crossHidden() { return S.mode === 'view'; },
  get ray() { return ray; },
  get config() { return cfg(); },
};
})();
