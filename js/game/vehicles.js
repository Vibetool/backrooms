// 后室 · 载具核心（BR.vehicles）：通用载具层，这一阶段只有 L1 的叉车（方案 2026-10-06 叉车驾驶提前版 FE1）
// 经典 <script>，只往 window.BR 上挂东西。加载顺序：js/game/testmode.js → forklift.js → 本文件 → vehicles_net.js，
// 这时 BR.kit、BR.L1forklift、BR.coop 都还没载入 —— 一律用到时再取，不在加载期读。
//
// 分工：
//   BR.forklift（forklift.js）：纯模拟加环境互动（运动学、扫掠碰撞、雷达、升降、头顶障碍、推开物资、藤蔓、下车落点、大灯落点）。
//     核心只通过 create(rec) / sim.step(dt, inp|null, env) / sim.obbsWorld() / sim.exitSpot(pref, force) / sim.lightSpot() 和它交接
//   BR.vehicles（本文件）：登记、升格、共用载具网格、OBB 碰撞、准心候选、上下车、货叉上的物资、声音灯光、生命周期
//   BR.vehiclesNet（vehicles_net.js）：联机表现，远端的车只经 setPose(key, pose, { remote: true }) 进来
//
// 规则（孩子定的 + 方案 FE1）：
//   准心对准车身、护顶架或门架，人站在左右两侧（geo.mountZone）、离座椅 ≤1.5 m：短按空格「上车」；
//   在车前 / 车尾：灰字「绕到侧面上车」；侧面但离得远：「再走近一点」；长按：「叉车太重，拖不动」，车一点不动；队友坐着：「队友在开叉车」。
//   上车 0.5 s 眼点插值（player 按 handle.path('in') 走），落座「吱」→ 钥匙「咔」起动 0.8 s（不让走，提示「发动中」）→ 怠速循环、大灯、警示灯 1 Hz 闪。
//   下车：短按空格（drive 情境里「互动」就是「下车」）；车还在动先刹停（≤0.6 s），按视角选边（sim.exitSpot），三面都挡住提示「两边都被挡住，开出来再下车」。
//   强制下车（死亡、reset、换层、回主页）：sim.exitSpot(…, force=true)，不提示、不刹车动画、人直接落在落点。
//
// 升格（keyDecisions[0]）：停着、没人开过的叉车仍在区块网格里（几何、碰撞框、账面全不动，golden 不变）；第一次有人上车、或收到队友的位姿，
//   才把区块里这台车的顶点段藏掉（kit.hideSpans，车下油渍不藏），改用全层共用的载具网格画它。开过的车状态写 levelState.vehicles，
//   碰撞挂在 'veh|<车 key>#<部件>' 下整层常驻；网格只给玩家（联机加队友）R+1 块以内的车，走远了释放那一段（状态、碰撞留着）。
//   出生保底车（data.runtime）不进区块几何：一载入就直接用载具网格画（高画质 mid、低画质 drvLow），油渍作为不随车动的一段。
// 细节档（keyDecisions[1]）：BR.L1forklift.driveTier(画质, 停放档)；本机没建过原区块的车按 mid（低画质 drvLow），磨损片数按 mid。
// 碰撞（keyDecisions[2]）：14 个部件 OBB（geo.obbs(lift)）。停着的车 'cx,cz#v<i>#<部件>'（区块卸载时一起摘），开过的车 'veh|<key>#<部件>'。
// 共用载具网格（keyDecisions[4]）：kit:prop / kit:glow / kit:decal 各一个网格（低画质没有贴花），不挂区块 group，共用 kit 材质；
//   每台车按部件建一次（临时 kit.builder + 前后 mark 量顶点段），每帧在 CPU 上按 pose 变换顶点、只上传动过的那几段（updateRange）：
//   车身不动；前轮绕轮轴滚；左右后轮绕各自主销转 steer 再滚；方向盘绕倾斜轴转 −steer × steerRatio（司机看来逆时针 = 往左打）；
//   内门架升 d，货叉架升 2d；链条按 lift 重建（预留最大顶点数，多出来的叠成一点）；升降杆绕 geo.liftLever 转 lever。
//   熄火时 glow 里这台车那段的顶点色换成灯罩本色 × 0.35，着车时大灯 × 1.7、警示灯 × 1.5 并 1 Hz 闪。
// 货叉上的物资（keyDecisions[5]）：dropSurface / attachItem；车或货叉在动时 riders 用 items.hold + move 跟着走，停稳一帧后松手一次写 levelState。
//   叉面高过 1.4 m 时，对准叉面上的物资只给灰字「货叉举得太高，够不着」（压一个同 id、近 3 cm 的候选，items.js 不用改）。
//   全速撞车（FE1 返修 r2，家长定的规则；r3 按真实轨迹重做）：「哐」而且撞前车速 ≥2 m/s、往前开时，货叉上的瓶罐沿货叉滑出叉尖、
//   沿抛物线落到叉尖前方 0.2–0.5 m（车速越快越远）；叉尖顶着墙就滑到墙跟前、从叉边滑下去贴着墙落地。每一段都查过不穿货叉、车身、墙
//   和别的东西，落地后 still 静静躺着，落地松手写进本层状态；「咚」（慢慢碰上）、倒车撞上不掉（规则全文见 computeThrow 上面）。
//   联机以房主为准：房主（单机）司机本机算、摆、写，再 coop.emit('fkthrow', { k, list }) 让客机照摆；客机司机 coop.use('k:'+车, 'fkthrow')
//   请房主按房主那边货叉上的东西算，房主摆好、写好状态，把落点回给客机照摆。
// 仪表台大灯开关（FE1 返修 r2，家长定的规则）：pose.hl（1 开 / 0 关，出厂开着），在载具网格里画一个开关（底板 + 拨杆 + 绿色指示灯，
//   区块里停着的车不画、几何一点不动）。坐在车上准心对准它短按空格开 / 关（drive 情境只认这台车的开关，不加新键）；着车时大灯跟着开关，
//   关掉就撤掉灯池那一盏、灯罩和指示灯熄灭（world.lightAt 不再把司机算成被照亮）；手机上准心对着开关时「下车」键临时写成「开大灯 / 关大灯」，
//   移开恢复「下车」。开关状态写进 levelState.vehicles.hl（离开再回来保留），联机经 coop.hand 的第 10 个值同步（vehicles_net）。
//
// 接口（BR.vehicles）：
//   list() → [{ key, x, z, y, yaw, steer, lift, spd, lever, on, driven, meshed, seat, tier, n, runtime, physKey }]   byKey(key) → 内部记录（只读，pose 在 .pose）
//   seated（本机坐着的车 key | null）、handle（交给 player.mount 的那个对象）、mount(key) → bool、dismount(side?) → bool、forceExit(reason)
//   cabFor(playerLike) → { cx, cz, hx, hz, rot, minY, maxY, key, yaw, x, z } | null（世界坐标的驾驶舱矩形，phys OBB 写法）
//   chestOf(playerLike) → { x, y, z } | null   seatWorld(key) → { x, y, z, yaw } | null（坐垫顶面中心）
//   dropSurface(x, z, r, type?) → { y: 叉面, veh: 车 key, tine: 0 左 | 1 右, side, x, z（摆到那根货叉中线上；这根货叉上已经有东西就挪到最近的空位） }
//     | { full: true, veh, tine, y }（整根货叉放不下了） | null   attachItem(id, veh) → bool
//   setPose(key, pose, { remote }) → bool：pose = { x, z, y?, yaw, steer, lift, spd?, lever?, on?, n? }。remote = 队友在开（vehicles_net 插值后每帧调），
//     会顺手升格、挪 'veh|' OBB（影子模拟、大灯、远端音效、推开物资归 vehicles_net）。
//     不带 remote = levelState 回放（没人开着的车按记录摆好）。本机正坐着的车一律不理（以本机模拟为准）；别的层的 key 不理
//   update(dt)（main.js 每帧，排在 entities 之后）   applyChunk(c, st) / unloadChunk(c)（world 建块 / 卸块时调）   clear()
//   debugInfo() → { promoted, meshes, calls, tris, perVehicle, tiers, lease, riders, obbs, seated, phase, light, loops, capacity, lit, btnLabel,
//                   falls, throws, throwMs（最近一次算甩货轨迹用了多少毫秒）, vehicles, … }
//   lightSwitch(key?) → { x, y, z, hl, lit } | null（大灯开关底板中心的世界坐标，测试对准它用）  toggleLight() → bool（等于坐在车上短按开关）
//   headlightLit() → bool：本机坐着的车大灯正亮着（L1 断电提示用）
//   _step(dt, { throttle, steer, lift }, key?) → pose：测试口，直接给模拟一步输入（不走 BR.input、不管起动阶段），网格、riders 一起更新
//   playerLike：BR.player（或 'me'）= 本机；'peer' / 联机队友对象（坐标在队友那台车座椅 2.5 m 内）= 队友坐的那台；也可以直接传车 key
// 和别的模块的交接：
//   BR.forklift：create({ key, physKey, ignoreKey, x, y, z, yaw, steer, lift, lever, spd, on, n, tier })；
//     sim.step(dt, inp | null, env)：inp = { throttle（+ = W 前进）, steer（+ = 按 A 往左打）, lift（+ = R 升）, brake, move:{x,y}, held(a) }，
//     env = { phase: 'mount'|'seat'|'start'|'run'（'run' 才算着车）, local, brake, ignoreKey, riders }；返回 { pose, events, note, noise, shake（秒） }。
//     events（'bang' 'bump' 'radar' 'end' 'strain' …）按 'fk_' + 名字放单次音效；note 交给 hud.driveNote；sim.exitSpot('left'|'right', force)
//   player：mount(handle) / unmount(reason) / mounted。handle = { key, update(dt, inp|null) → { x, z, eyeY, feetY, dyaw, noise, shake（米） },
//     path('in') → [站立眼点, 踏板上方, 座椅眼点]、path('out') → [座椅眼点, 踏板上方（车尾下车是配重上方）, 落点眼点], forceExit(reason), cab(), chest(), yaw() }
//   interact：addSource('vehicles')、handle('vehicle', { short })、setMode('drive', { key, label:'叉车', accept:()=>false, onShort: 下车 })
//   hud：setDrive({ key, label:'叉车' } | null)、driveNote(text, ms)（没有时退回 toast）   audio：play('fk_*')、loop('fk_engine' | 'fk_hydraulic' | 'fk_reverse', pos)
//   world：applyChunkState 的模块表、setExtraLights('fk:' + key, [灯] | null)   phys：addOBBs / removeSolids   kit：builder / mark / hideSpans / decal
//   coop：requestGrab('k:' + key, 'veh', cb)、hand('k:' + key, x, z, yaw, steer, lift, 0, spd)（下车前补发最后一帧）、release('k:' + key, [x, 0, z])、
//     leaseOf / can('veh2')；听 bus 'net:pose'（队友坐哪台车）
//   levelState.vehicles[key] = { x, z, yaw, steer, lift, on: 0|1, carry: null, n: 车号, hl: 0|1 }（单机、房主上车时写 on:1、开关拨动时再写，
//     下车写 on:0；客机只在下车时写本地那份）
// bus：'vehicle:mount' { key }、'vehicle:dismount' { key, x, z, side, reason }、'vehicle:promote' { key }、'vehicle:lights' { key, hl, lit }；
//   听 'net:fkthrow'（房主司机撞车甩货的落点），coop.onUse('fkthrow')（房主替客机司机算）
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const U = BR.util;

// ---------- 文案（界面文字里不出现 E） ----------
const LABEL = '叉车';
const T = {
  mount: '上车',
  heavy: '叉车太重，拖不动',
  side: '绕到侧面上车',
  near: '再走近一点',
  peer: '队友在开叉车',
  old: '对方版本较旧，联机时开不了车',
  starting: '发动中',
  blocked: '两边都被挡住，开出来再下车',
  lifted: '货叉还举着',
  retry: '没连上，再试一次',
  high: '货叉举得太高，够不着',
  // 仪表台大灯开关（家长 2026-10 拍板）：坐在车上准心对准它短按空格；手机上「下车」键这时临时写成这两个字
  lightOn: '开大灯',
  lightOff: '关大灯',
  lightLabel: '大灯开关',
};

// ---------- 常量 ----------
const SEAT_AT = 0.5;          // 上车：眼点插值 0.5 s 落进座椅，这时「吱」一声
const IGNITE_AT = 0.6;        // 接着钥匙「咔」、起动机转两下
const IGNITE_S = 0.8;         // 起动 0.8 s：不让走，按 W 提示「发动中」
const EXIT_BRAKE_S = 0.6;     // 车还在动时先刹停再下，最多等这么久
const STOP_SPD = 0.05;        // 低于它算停住
const GRAB_WAIT_MS = 1500;    // 联机：申请 'k:' 租约 1.5 s 没回音就提示「没连上，再试一次」
const MOUNT_DIST = 1.5;       // 离座椅（水平）这么近才能上车
const CAND_PAD = 3.4;         // 车中心离射线起点 reach + 这么远以内才算候选（车长 4.2 m 的一半多一点）
const FORK_TOL = 0.12;        // dropSurface：落点离货叉中线 ≤12 cm（一掌宽）
const FORK_REACH = 1.4;       // 叉面高过 1.4 m（离地）够不着：丢不上去，也捡不下来
const REATTACH_TOL = 0.02;    // 重新载入时，叉面 ±2 cm 以内的丢弃物重新挂回货叉
const GLOW_OFF = 0.35;        // 熄火：灯罩本色 × 0.35
const GLOW_IND_OFF = 0.12;    // 大灯开关的绿色指示灯熄着：× 0.12（近乎黑，和亮着的 × 1.7 一眼分得开）
const GLOW_ON = 1.7, GLOW_BEACON = 1.5;   // 着车：大灯镜面、警示灯罩的发光色（kit:glow 不吃光照，顶点色 > 1 接近白热）
const BEACON_Y = 2.0;        // glow 顶点高于它的是护顶上的警示灯（其余是两盏前大灯）
const BEACON_HZ = 1;
const RANGE_EVERY = 0.25;     // 每 0.25 s 重算一次哪些车要放进网格
const NOTE_GAP_MS = 900;      // 同一句状态提示最短间隔
const SHAKE_S = 0.15, SHAKE_AMP = 0.03;   // 「哐」：镜头抖 0.15 s（幅度米，player 再按减少动态效果关掉）
const EPS = 1e-6;
// 大灯兜底（sim.lightSpot() 没给的字段）：数值跟 BR.forklift.config.light 走，这里只是 forklift.js 没加载时的默认
const HEADLIGHT = { color: 0xfff0d8, intensity: 3.2, range: 8, decay: 2 };
function headlight() {
  const c = BR.forklift && BR.forklift.config && BR.forklift.config.light;
  return { color: c && c.color != null ? c.color : HEADLIGHT.color, intensity: num(c && c.intensity, HEADLIGHT.intensity), range: num(c && c.range, HEADLIGHT.range), decay: HEADLIGHT.decay };
}
// 部件的建模顺序：链条放最后（它的顶点数随 lift 变，后面预留空位）。lightSwitch / lightToggle 是本文件自己画的大灯开关（见下）
const PART_ORDER = ['body', 'mastOuter', 'wheelsFront', 'wheelRearL', 'wheelRearR', 'steeringWheel', 'liftLever', 'mastInner', 'carriage',
  'lightSwitch', 'lightToggle', 'chains'];
const MATS = ['kit:prop', 'kit:glow', 'kit:decal'];
const PB = { body: 1, mastOuter: 2, wheelsFront: 4, wheelRearL: 8, wheelRearR: 16, steeringWheel: 32, liftLever: 64, mastInner: 128, carriage: 256, chains: 512, oil: 1024,
  lightSwitch: 2048, lightToggle: 4096 };
const ALL_PARTS = 8191;
// ---- 仪表台大灯开关（FE1 返修 r2，家长定的规则）----
// 只在载具网格里画（开过的车、保底车）：区块里停着的车几何一点不动（golden 零变化）。位置在仪表台斜面左半边（方向盘左下方，
// 右边是操纵杆）：L1.js fkBody 的斜面下沿 (y 0.86, z −0.56)、上沿 (y 1.02, z −0.66)，slant(x, f, off) 和那里同一套写法。
// 一块深色底板（离斜面 8 mm，不和仪表板 3 mm、表盘 6 mm 共面）+ 一根镀铬拨杆（开 = 往上扳、关 = 往下扳，绕底板中心的 x 轴转 ±0.5 rad）
// + 拨杆上方一颗绿色指示灯（kit:glow：发动机开着、开关开着才亮，和大灯一起）+ 拨杆下方一个浅色的小灯头图标
function slantPt(x, f, off) { return [x, 0.86 + 0.16 * f + 0.53 * off, -0.56 - 0.1 * f + 0.848 * off]; }
const SW_X = -0.22, SW_F = 0.5, SW_ANG = 0.5;
const SW_T = [0, 0.848, -0.53], SW_N = [0, 0.53, 0.848], SW_AX = [1, 0, 0];   // 斜面往上沿的方向、朝司机的法线、横向
const SW_PIVOT = slantPt(SW_X, SW_F, 0.008);
// 准心命中盒（车本地，轴对齐）：底板 + 两个方向扳过去的拨杆都在里面
const SW_BOX = { min: [SW_X - 0.05, 0.885, -0.655], max: [SW_X + 0.05, 1.0, -0.56] };
const SW_PREFIX = 'fkhl:';    // 开关候选的 key：'fkhl:' + 车 key
const SW_COL = { plate: [0.09, 0.09, 0.095], bat: [0.8, 0.82, 0.84], knob: [0.05, 0.05, 0.05], icon: [0.78, 0.78, 0.72], lamp: [0.3, 0.95, 0.35] };
// ---- 全速撞车掉货（FE1 返修 r2，家长定的规则）----
// 撞上（「哐」）而且撞前车速 ≥2 m/s、往前开：货叉上的瓶罐甩到叉尖前方 0.2–0.5 m（车速 2 → 0.2、4.5 → 0.5）落地，写进本层状态；
// 慢慢碰上（「咚」）不掉。倒车撞上不甩：东西往车这边冲，被挡货架挡住。联机以房主为准（见 throwRiders）
const THROW_V = 2.0;
const THROW_D0 = 0.2, THROW_D1 = 0.5;
const FALL_G = 9.8;
// 车下那滩油（FK_WEAR[0]，L1.js）：保底车不进区块几何，油渍由这里按同样的参数贴进载具网格（不随车动）
const OIL = { kind: 'oil', x: 0.04, y: 0, z: -1.28, facing: 'up', w: 0.62, h: 0.46, rot: 0.6, opacity: 0.5, offset: 0.0065 };
// FORKLIFT_GEO 缺字段时的兜底（数值和 L1.js / 方案接口一致）
const DEF_GEO = {
  wheelFront: { x: 0.48, y: 0.29, z: -0.62, r: 0.29 },
  wheelRear: { x: 0.44, y: 0.23, z: 0.8, r: 0.23 },
  steerWheel: { x: 0, y: 1.25, z: -0.5, tilt: 0.55 },
  steerRatio: 6, maxSteer: 1.13, innerTravel: 1.3, carriageTravel: 2.6,
  forkY: 0.015, forkT: 0.04, forkW: 0.1, forkZ: [-2.1, -1.16], tineX: [-0.28, 0.28],
  seat: { y: 1.16, z: 0.24 }, eye: { x: 0, y: 1.8, z: 0.16 }, seatChest: { x: 0, y: 1.66, z: 0.24 },
  stepPoint: { x: 0.75, y: 0.35, z: -0.19 },
  cab: { x: 0.4, z0: -0.5, z1: 0.55, yFloor: 0.62, ySeat: 1.16, yTop: 2.05 },
  half: { x: 0.6, z: 1.3, h: 2.15 },
  liftLever: null, mountZone: null,
};
const OBB_NAMES = ['chassis', 'hood', 'counterweight', 'dash', 'postFL', 'postFR', 'postRL', 'postRR', 'roof',
  'mastOuter', 'mastInner', 'carriage', 'forkL', 'forkR'];

// ---------- 状态 ----------
const V = new Map();          // 车 key → 记录
const S = {
  lv: null,                   // 当前登记的层（levelId）；换层、回主页置 null
  time: 0,
  seated: null,               // 本机坐着的车 key
  drive: null,                // 本机驾驶状态（见 doMount）
  out: null,                  // 刚下车的落点（player.unmount 时 handle.path('out') 要用）
  pendingGrab: null,          // 联机：等房主回 'k:' 租约
  liftWarned: false,          // 「货叉还举着」本局只说一次
  quality: null,
  layoutDirty: false,
  rangeT: 0,
  pushQ: new Set(),           // 要把压在车 OBB 里的地上物资推出去的车（建块后下一次 update 做）
  riderScan: true,
  peerPose: null,             // 队友的姿态 { mode, key }（coop 'net:pose'）
  lastNote: '', lastNoteAt: -1e9,
  loops: { engine: null, hyd: null, rev: null },
  light: null,                // 本机开着的那台车的大灯（world.setExtraLights 的对象）
  lightOwner: null,
  btnLabel: null,             // 手机：准心对着大灯开关时「下车」键临时写的字（'开大灯' / '关大灯'），没改时 null
  swCand: null,
  falls: [],                  // 撞车甩出去、正在往下掉的瓶罐 [{ id, path:[[t, x, y, z, mode]…], t }]（见 computeThrow）
  throws: [],                 // 最近几次甩货（调试 / 测试看）：[{ key, v0, list, at, by }]
  lying: new Map(),           // 层 → 甩出去落地、静静躺着的物资 id（换层回来 items 照丢弃物摆回去是浮着的，这里再让它躺下；本局有效）
  useReg: false,
  warned: new Set(),
  cpuMs: 0, cpuN: 0,
};
const tmpW = { x: 0, y: 0, z: 0 }, tmpL = { x: 0, z: 0 };

// ---------- 小工具 ----------
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function fin(v) { return typeof v === 'number' && isFinite(v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function once(key, fn) { if (!S.warned.has(key)) { S.warned.add(key); try { fn(); } catch (err) { /* 忽略 */ } } }
function emit(name, p) { if (BR.bus) BR.bus.emit(name, p); }
function toast(text, ms) { if (text && has(BR.hud, 'toast')) BR.hud.toast(text, ms || 1800); }
function sfx(name, pos, opts) {
  if (!name || !has(BR.audio, 'play')) return null;
  try { return BR.audio.play(name, pos, opts); } catch (err) { return null; }
}
function wrap(a) { a = a % (Math.PI * 2); if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; }
function adiff(a, b) { return U && has(U, 'angleDiff') ? U.angleDiff(a, b) : wrap(b - a); }
function r4(v) { return Math.round(v * 1e4) / 1e4; }
function lvNow() { return BR.game && BR.game.levelId != null ? String(BR.game.levelId) : null; }
function quality() { const s = BR.game && BR.game.settings; return s && s.quality === 'low' ? 'low' : 'high'; }
function editing() { return !!(BR.workshop && BR.workshop.editing); }
function coopOn() {
  const g = BR.game && BR.game.coop;
  if (g && g.active) return true;
  return !!(BR.coop && BR.coop.active);
}
function coopRole() {
  const g = BR.game && BR.game.coop;
  if (g && g.active && g.role) return g.role;
  return BR.coop && BR.coop.active ? BR.coop.role : null;
}
function guest() { return coopRole() === 'guest'; }
// 联机掉线后在原地等重连：本机坐着的车停住（坐着不动），vehicles_net 负责提示和重新拿租约
function reconnecting() { return !!(BR.coop && BR.coop.phase === 'reconnecting'); }
function loadR() { return Math.max(0, num(BR.config && BR.config.world && BR.config.world.loadRadius, 2) | 0); }
function chunkSize() { return num(BR.world && BR.world.chunkSize, 24) || 24; }
function groundAt(x, z, d) {
  if (has(BR.phys, 'groundY')) { const g = +BR.phys.groundY(x, z); if (isFinite(g)) return g; }
  return d == null ? 0 : d;
}
function sceneOf() { return (BR.gfx && BR.gfx.scene) || null; }

// ---------- 几何常数（BR.L1forklift.geo，缺的取兜底） ----------
function FL() { return BR.L1forklift || null; }
function geo() { const F = FL(); return (F && F.geo) || null; }
function gv(name) { const g = geo(); const v = g ? g[name] : undefined; return v != null ? v : DEF_GEO[name]; }
function P3(v, d) {
  if (Array.isArray(v)) return { x: num(+v[0], 0), y: num(+v[1], 0), z: num(+v[2], 0) };
  if (v && typeof v === 'object') return { x: num(v.x, 0), y: num(v.y, 0), z: num(v.z, 0) };
  return d || { x: 0, y: 0, z: 0 };
}
function forkBase() { return num(gv('forkY'), 0.015) + num(gv('forkT'), 0.04); }   // lift = 0 时叉面离地 5.5 cm
function carriageTravel() {
  const c = num(gv('carriageTravel'), NaN);
  return c > 0 ? c : 2 * num(gv('innerTravel'), 1.3);
}
function innerTravel() { return carriageTravel() / 2; }
function tineX() { const t = gv('tineX'); return Array.isArray(t) && t.length >= 2 ? [+t[0], +t[1]] : [-0.28, 0.28]; }
function forkZ() { const f = gv('forkZ'); return Array.isArray(f) && f.length >= 2 ? [Math.min(+f[0], +f[1]), Math.max(+f[0], +f[1])] : [-2.1, -1.16]; }
function eyeLocal() { return P3(gv('eye'), DEF_GEO.eye); }
function chestLocal() { return P3(gv('seatChest'), DEF_GEO.seatChest); }
function seatLocal() { const s = gv('seat'); return { x: 0, y: num(s && s.y, 1.16), z: num(s && s.z, 0.24) }; }
function stepLocal() { return P3(gv('stepPoint'), DEF_GEO.stepPoint); }
function cabGeo() {
  const c = gv('cab') || DEF_GEO.cab;
  return { x: num(c.x, 0.4), z0: num(c.z0, -0.5), z1: num(c.z1, 0.55), yFloor: num(c.yFloor, 0.62), yTop: num(c.yTop, 2.05) };
}
// 侧面上车区：geo.mountZone 认 { z0, z1 } / { zMin, zMax } / { minZ, maxZ } / [z0, z1]，可带 x（离车中线至少多远才算侧面）
function mountZone() {
  const m = gv('mountZone');
  let z0 = -0.95, z1 = 1.05, x = 0.6, reach = MOUNT_DIST;
  if (Array.isArray(m) && m.length >= 2) { z0 = +m[0]; z1 = +m[1]; }
  else if (m && typeof m === 'object') {
    z0 = num(m.z0, num(m.zMin, num(m.minZ, z0)));
    z1 = num(m.z1, num(m.zMax, num(m.maxZ, z1)));
    x = num(m.xMin, num(m.minX, num(m.x, x)));
    reach = num(m.reach, reach);
  }
  return { z0: Math.min(z0, z1), z1: Math.max(z0, z1), x: Math.abs(x), reach };
}

// ---------- 坐标 ----------
// 车身坐标 → 世界（kit / phys / hit.obb 同一约定：x' = c·x + s·z，z' = −s·x + c·z；车头在本地 −z）
function toWorld(p, lx, ly, lz, out) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  out.x = p.x + c * lx + s * lz; out.y = p.y + ly; out.z = p.z - s * lx + c * lz;
  return out;
}
function toLocal(p, wx, wz, out) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = wx - p.x, dz = wz - p.z;
  out.x = c * dx - s * dz; out.z = s * dx + c * dz;
  return out;
}

// ---------- 部件 OBB ----------
// 兜底（FE1-L1 的 geo.obbs 没接上时）：粗略的 14 个盒子，只保证车能挡人、驾驶舱留空
function fallbackObbs(lift) {
  const d = innerTravel() * lift, c2 = 2 * d;
  return [
    { name: 'chassis', cx: 0, cy: 0.31, cz: 0.2, hx: 0.58, hy: 0.31, hz: 1.05 },
    { name: 'hood', cx: 0, cy: 0.86, cz: 0.85, hx: 0.55, hy: 0.24, hz: 0.25 },
    { name: 'counterweight', cx: 0, cy: 0.62, cz: 1.15, hx: 0.55, hy: 0.45, hz: 0.15 },
    { name: 'dash', cx: 0, cy: 0.9, cz: -0.7, hx: 0.5, hy: 0.28, hz: 0.17 },
    { name: 'postFL', cx: -0.5, cy: 1.4, cz: -0.62, hx: 0.04, hy: 0.7, hz: 0.04 },
    { name: 'postFR', cx: 0.5, cy: 1.4, cz: -0.62, hx: 0.04, hy: 0.7, hz: 0.04 },
    { name: 'postRL', cx: -0.5, cy: 1.4, cz: 0.68, hx: 0.04, hy: 0.7, hz: 0.04 },
    { name: 'postRR', cx: 0.5, cy: 1.4, cz: 0.68, hx: 0.04, hy: 0.7, hz: 0.04 },
    { name: 'roof', cx: 0, cy: 2.08, cz: 0.03, hx: 0.55, hy: 0.03, hz: 0.7 },
    { name: 'mastOuter', cx: 0, cy: 1.06, cz: -0.98, hx: 0.38, hy: 1.0, hz: 0.08 },
    { name: 'mastInner', cx: 0, cy: 1.11 + d, cz: -1.0, hx: 0.32, hy: 1.01, hz: 0.04 },
    { name: 'carriage', cx: 0, cy: 0.64 + c2, cz: -1.09, hx: 0.46, hy: 0.58, hz: 0.04 },
    { name: 'forkL', cx: -0.28, cy: 0.035 + c2, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },
    { name: 'forkR', cx: 0.28, cy: 0.035 + c2, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },
  ];
}
// 本地 14 个盒子 [{ name, cx, cy, cz, hx, hy, hz }]（每台车按 lift 缓存一份）
function localObbs(veh) {
  const lift = veh.pose.lift;
  if (veh.lobb && Math.abs(veh.lobbLift - lift) < EPS) return veh.lobb;
  const g = geo();
  let list = null;
  if (g && typeof g.obbs === 'function') {
    try { list = g.obbs(lift); } catch (err) { once('obbs', () => console.error('[vehicles] geo.obbs 出错', err)); list = null; }
  }
  if (!Array.isArray(list) || !list.length) list = fallbackObbs(lift);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o) continue;
    out.push({ name: o.name != null ? String(o.name) : OBB_NAMES[i] || 'p' + i, cx: num(+o.cx, 0), cy: num(+o.cy, 0), cz: num(+o.cz, 0),
      hx: Math.abs(num(+o.hx, 0)), hy: Math.abs(num(+o.hy, 0)), hz: Math.abs(num(+o.hz, 0)) });
  }
  veh.lobb = out; veh.lobbLift = lift; veh.hull = null;
  return out;
}
// 准心命中用的整车外接盒（车身 + 护顶 + 门架，不含货叉），本地 min / max
function hullOf(veh) {
  const L = localObbs(veh);
  if (veh.hull) return veh.hull;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const o of L) {
    if (o.name === 'forkL' || o.name === 'forkR') continue;
    mn[0] = Math.min(mn[0], o.cx - o.hx); mx[0] = Math.max(mx[0], o.cx + o.hx);
    mn[1] = Math.min(mn[1], o.cy - o.hy); mx[1] = Math.max(mx[1], o.cy + o.hy);
    mn[2] = Math.min(mn[2], o.cz - o.hz); mx[2] = Math.max(mx[2], o.cz + o.hz);
  }
  if (!(mn[0] < mx[0])) { mn[0] = -0.6; mn[1] = 0; mn[2] = -1.2; mx[0] = 0.6; mx[1] = 2.15; mx[2] = 1.3; }
  veh.hull = { min: mn, max: mx };
  return veh.hull;
}
function worldObbs(veh) {
  if (veh.sim && has(veh.sim, 'obbsWorld') && veh.seat === 'me') {
    let w = null;
    try { w = veh.sim.obbsWorld(); } catch (err) { w = null; }
    if (Array.isArray(w) && w.length >= 14 && w.every(o => o && o.name != null && isFinite(o.cx) && isFinite(o.minY))) return w;
  }
  const p = veh.pose, L = localObbs(veh), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const out = veh.wobb || (veh.wobb = []);
  out.length = 0;
  for (const o of L) {
    out.push({ name: o.name, cx: p.x + c * o.cx + s * o.cz, cz: p.z - s * o.cx + c * o.cz, hx: o.hx, hz: o.hz, rot: p.yaw,
      minY: p.y + o.cy - o.hy, maxY: p.y + o.cy + o.hy });
  }
  return out;
}
function physKeyOf(veh) { return veh.driven ? 'veh|' + veh.key : veh.pkey; }
// 把这台车的 OBB 登记到 phys（同 key 再登记 = 整组替换）。位姿没变时不重登
function registerObbs(veh, force) {
  const P = BR.phys;
  if (!has(P, 'addOBBs')) return;
  const bk = physKeyOf(veh);
  if (veh.obbKey && veh.obbKey !== bk && has(P, 'removeSolids')) P.removeSolids(veh.obbKey);
  const p = veh.pose;
  const sig = r4(p.x) + ',' + r4(p.z) + ',' + r4(p.y) + ',' + r4(p.yaw) + ',' + r4(p.lift);
  if (!force && veh.obbKey === bk && veh.obbSig === sig) return;
  const list = worldObbs(veh);
  for (let i = 0; i < list.length; i++) P.addOBBs(bk + '#' + list[i].name, [list[i]]);
  veh.obbKey = bk; veh.obbSig = sig; veh.obbN = list.length;
}
function removeObbs(veh) {
  const P = BR.phys;
  if (veh.obbKey && has(P, 'removeSolids')) P.removeSolids(veh.obbKey);
  veh.obbKey = null; veh.obbSig = ''; veh.obbN = 0;
}
// 区块里原来那个外接 AABB（kit fixture，'cx,cz#v<i>'）连同挂在它名下的 OBB 一起摘掉
function removeParked(veh) {
  if (veh.pkey && has(BR.phys, 'removeSolids')) BR.phys.removeSolids(veh.pkey);
  if (veh.obbKey === veh.pkey) { veh.obbKey = null; veh.obbSig = ''; }
}

// ---------- 登记 ----------
const KEY_RE = /^(.*)@(-?\d+),(-?\d+)#v(\d+)$/;
function parseKey(key) {
  const m = KEY_RE.exec(String(key));
  return m ? { lv: m[1], cx: +m[2], cz: +m[3], i: +m[4] } : null;
}
function newVeh(key) {
  const k = parseKey(key);
  const veh = {
    key: String(key), lv: k ? k.lv : S.lv, cx: k ? k.cx : 0, cz: k ? k.cz : 0, i: k ? k.i : 0,
    ck: k ? k.cx + ',' + k.cz : null, pkey: k ? k.cx + ',' + k.cz + '#v' + k.i : null,
    n: 0, data: null, parkedTier: null, wearN: null, runtime: false,
    driven: false, chunk: null, hiddenRes: null,
    pose: { x: 0, y: 0, z: 0, yaw: 0, steer: 0, lift: 0, spd: 0, lever: 0, on: 0, hl: 1 },   // hl：仪表台大灯开关（1 开 / 0 关，出厂开着）
    park: null,                 // 停放位姿（保底车的油渍钉在这里）
    rollF: 0, rollR: 0,
    obbKey: null, obbSig: '', obbN: 0, lobb: null, lobbLift: -1, hull: null, wobb: null,
    sim: null, seat: null, remoteAt: -1e9,
    riders: new Map(),          // 物资 id → { lx, lz, dy, rot0, yaw0, holding }
    riderSig: '',
    ent: null, oilEnt: null,    // 网格里的位置（见「共用载具网格」）
    cand: null,
    lastLift: 0, liftMoving: false,
  };
  V.set(veh.key, veh);
  return veh;
}
// 从区块数据补齐 / 刷新这台车的「停放档、磨损片数、车号」（每次建这块都记一次，两端画质可以不同）
function adopt(veh, f, c, i) {
  veh.data = f;
  veh.parkedTier = f.detail != null ? String(f.detail) : null;
  veh.wearN = f.wearN != null ? Math.max(0, f.wearN | 0) : null;
  veh.runtime = !!f.runtime;
  if (f.number != null) veh.n = f.number | 0;
  if (!veh.ck && c) { veh.cx = c.cx; veh.cz = c.cz; veh.ck = c.key; veh.i = i; veh.pkey = c.key + '#v' + i; }
  veh.park = { x: num(f.x, 0), y: num(f.y, 0), z: num(f.z, 0), yaw: num(f.rot, 0) };
}
function lsVeh(key) {
  const L = BR.levelState;
  if (!L || !S.lv) return null;
  try {
    if (has(L, 'getVehicle')) return L.getVehicle(S.lv, key) || null;
    if (has(L, 'getv')) return L.getv(S.lv, 'veh', key) || null;
  } catch (err) { return null; }
  return null;
}
function poseFromLs(veh, v) {
  const p = veh.pose;
  p.x = num(v.x, p.x); p.z = num(v.z, p.z); p.yaw = num(v.yaw, p.yaw);
  p.steer = num(v.steer, 0); p.lift = clamp(num(v.lift, 0), 0, 1);
  p.y = num(v.y, groundAt(p.x, p.z, p.y));
  p.spd = 0; p.lever = 0;
  p.hl = +v.hl === 0 ? 0 : 1;   // 大灯开关离开再回来保留（老记录没有 hl：开着）
  if (v.n != null && !veh.n) veh.n = v.n | 0;
}
// 进了新的一层：levelState 里记着的开过的车整层常驻（碰撞一直在，网格按距离放）
function ensureLevel() {
  const lv = lvNow();
  if (lv === S.lv) return;
  resetAll();
  S.lv = lv;
  if (lv == null || editing()) return;
  const L = BR.levelState;
  let st = null;
  try { st = L && has(L, 'peek') ? L.peek(lv) : null; } catch (err) { st = null; }
  const tbl = st && st.vehicles;
  if (!tbl || typeof tbl.forEach !== 'function') return;
  tbl.forEach((v, key) => {
    if (!v || typeof v !== 'object') return;
    const veh = V.get(key) || newVeh(key);
    poseFromLs(veh, v);
    veh.driven = true;
    registerObbs(veh, true);
  });
  S.riderScan = true;
}

// world 建块后（setupProps 之后、刷物资之前、第一次渲染之前）调；可以重复调
function applyChunk(c, st) {
  if (!c || !c.res) return;
  if (editing()) return;   // 工坊编辑态整体关闭：停着的车照旧是那一个外接 AABB
  ensureLevel();
  const list = c.res.data && c.res.data.forklifts;
  if (!Array.isArray(list) || !list.length) return;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!f || typeof f !== 'object') continue;
    const key = f.key != null ? String(f.key) : (S.lv || '1') + '@' + c.cx + ',' + c.cz + '#v' + i;
    const veh = V.get(key) || newVeh(key);
    adopt(veh, f, c, f.i != null ? f.i | 0 : i);
    veh.chunk = c;
    if (!veh.driven) {
      const v = lsVeh(key);
      if (v) { poseFromLs(veh, v); veh.driven = true; }
      else if (!veh.seat) { veh.pose.x = veh.park.x; veh.pose.y = veh.park.y; veh.pose.z = veh.park.z; veh.pose.yaw = veh.park.yaw; veh.pose.lift = 0; veh.pose.steer = 0; }
    }
    if (veh.driven) hideChunk(veh, c);
    removeParked(veh);
    registerObbs(veh, true);
    if (veh.runtime || veh.driven) S.layoutDirty = true;
    if (veh.runtime && !veh.oilEnt) S.layoutDirty = true;
    if (!guest()) S.pushQ.add(veh.key);
  }
  S.riderScan = true;
  S.rangeT = 0;
}
// world 卸块时调（几何还在）；可以重复调
function unloadChunk(c) {
  if (!c) return;
  const ck = c.key != null ? String(c.key) : c.cx + ',' + c.cz;
  for (const veh of Array.from(V.values())) {
    if (veh.ck !== ck) continue;
    if (veh.chunk === c || !veh.chunk) { veh.chunk = null; veh.hiddenRes = null; }
    if (veh.oilEnt) S.layoutDirty = true;
    if (veh.driven || veh.seat) continue;   // 开过的车整层常驻：状态、碰撞都留着
    // 停着、没开过的：碰撞随区块走（world 非整批卸载时也会按区块前缀摘）
    removeObbs(veh);
    removeParked(veh);
    if (veh.ent || veh.oilEnt) { veh.ent = null; veh.oilEnt = null; S.layoutDirty = true; }
    V.delete(veh.key);
  }
}
// 把区块网格里这台车的顶点段（车身 + 磨损贴花，不含油渍）叠成一点
function hideChunk(veh, c) {
  if (!c || !c.res || veh.hiddenRes === c.res) return;
  veh.hiddenRes = c.res;
  const sp = veh.data && veh.data.spans;
  if (!sp || veh.runtime) return;   // 保底车本来就不在区块几何里
  const spans = { 'kit:prop': [], 'kit:decal': [] };
  const ok = r => Array.isArray(r) && r.length >= 2 && r[1] > r[0];
  if (ok(sp.prop)) spans['kit:prop'].push([sp.prop[0], sp.prop[1]]);
  if (Array.isArray(sp.wear)) for (const r of sp.wear) if (ok(r)) spans['kit:decal'].push([r[0], r[1]]);
  const K = BR.kit;
  if (K && has(K, 'hideSpans')) {
    try { K.hideSpans(c.res, spans); return; } catch (err) { once('hide', () => console.error('[vehicles] kit.hideSpans 出错', err)); }
  }
  // 老 kit 没有 hideSpans：直接把那几段叠成一点（区块卸载时整个网格丢掉，不用恢复）
  const g = c.res.group || c.group;
  if (!g || !g.children) return;
  for (const mk of Object.keys(spans)) {
    const m = g.children.find(o => o.isMesh && o.name === mk);
    const a = m && m.geometry && m.geometry.attributes.position;
    if (!a) continue;
    for (const r of spans[mk]) {
      const v0 = Math.max(0, r[0]), v1 = Math.min(a.count, r[1]);
      if (v1 <= v0) continue;
      const x = a.array[v0 * 3], y = a.array[v0 * 3 + 1], z = a.array[v0 * 3 + 2];
      for (let k = v0 * 3; k < v1 * 3; k += 3) { a.array[k] = x; a.array[k + 1] = y; a.array[k + 2] = z; }
      markRange(a, v0, v1 - v0);
    }
  }
}
// 第一次有人上车、或收到队友的位姿：升格成「开过的车」
function promote(veh) {
  if (veh.driven) return;
  veh.driven = true;
  if (veh.chunk) hideChunk(veh, veh.chunk);
  removeParked(veh);
  registerObbs(veh, true);
  S.layoutDirty = true;
  emit('vehicle:promote', { key: veh.key });
}
// 远端位姿、levelState 回放进来的车本机还没登记（原区块没建过）：按 key 建一条记录
function vehForPose(key, pose) {
  let veh = V.get(key);
  if (veh) return veh;
  veh = newVeh(key);
  const p = veh.pose;
  p.x = num(pose && pose.x, 0); p.z = num(pose && pose.z, 0); p.yaw = num(pose && pose.yaw, 0);
  p.y = num(pose && pose.y, groundAt(p.x, p.z, 0));
  if (pose && pose.n != null) veh.n = pose.n | 0;
  return veh;
}

// ---------- 共用载具网格 ----------
// SH[matKey] = { cap, icap, nv, ni, geo, mesh, comps }：全层一份，按需扩容；每台车（ent）占一段顶点、一段索引
const SH = new Map();
function shared(mk) {
  let g = SH.get(mk);
  if (!g) { g = { mk, comps: mk === 'kit:decal' ? 4 : 3, cap: 0, icap: 0, nv: 0, ni: 0, geo: null, mesh: null }; SH.set(mk, g); }
  return g;
}
function dynAttr(arr, size) {
  const a = new THREE.BufferAttribute(arr, size);
  if (has(a, 'setUsage') && THREE.DynamicDrawUsage != null) a.setUsage(THREE.DynamicDrawUsage);
  return a;
}
function allocShared(g, nv, ni) {
  if (g.geo && nv <= g.cap && ni <= g.icap) return false;
  const cap = Math.max(nv, Math.ceil(g.cap * 1.5), 2048), icap = Math.max(ni, Math.ceil(g.icap * 1.5), 4096);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', dynAttr(new Float32Array(cap * 3), 3));
  geom.setAttribute('normal', dynAttr(new Float32Array(cap * 3), 3));
  geom.setAttribute('uv', dynAttr(new Float32Array(cap * 2), 2));
  geom.setAttribute('color', dynAttr(new Float32Array(cap * g.comps), g.comps));
  geom.setIndex(dynAttr(new Uint32Array(icap), 1));
  geom.setDrawRange(0, 0);
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  if (g.mesh) { const old = g.mesh.geometry; g.mesh.geometry = geom; if (old) old.dispose(); }
  else {
    const m = BR.kit.mat(g.mk);
    const mesh = new THREE.Mesh(geom, m);
    mesh.name = 'vehicles ' + g.mk;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (m.transparent) mesh.renderOrder = g.mk === 'kit:decal' ? 1 : 2;
    g.mesh = mesh;
  }
  g.geo = geom; g.cap = cap; g.icap = icap;
  return true;
}
// 局部上传：一帧里多段变化时取并集（three 上传后把 updateRange.count 置回 -1）
function markRange(attr, start, count) {
  if (!(count > 0)) return;
  const r = attr.updateRange;
  const s = start * attr.itemSize, e = (start + count) * attr.itemSize;
  if (r.count === -1) { r.offset = s; r.count = e - s; }
  else { const end = Math.max(r.offset + r.count, e); r.offset = Math.min(r.offset, s); r.count = end - r.offset; }
  attr.needsUpdate = true;
}

// ---- 建模：临时 kit.builder 按部件调 BR.L1forklift.model，前后量顶点段，拷成这台车自己的一份 ----
const modelCache = new Map();   // sig → 模板（glow / decal 只读共用，prop 每台车拷一份：链条段要按各自的 lift 改）
const chainCaps = new Map();    // 细节档 → { n, ni }：链条在 0..1 各个 lift 下的最大顶点数 / 索引数
function newBuilder() {
  const b = BR.kit.builder({}, 0, 0, () => 0, { height: 4, helper: true });
  b._wsHelper = true;
  return b;
}
function markOf(b) {
  const out = {};
  if (b._accs && typeof b._accs.forEach === 'function') {
    b._accs.forEach((a, k) => { if (typeof k === 'string' && a && typeof a.n === 'number') out[k] = { n: a.n, ni: a.idx ? a.idx.length : 0 }; });
  } else if (has(b, 'mark')) {
    const m = b.mark();
    for (const k in m) out[k] = { n: m[k], ni: 0 };
  }
  return out;
}
// kit finish 里 fillUV 的同一套规则（区块原点取 0：UV 跟着车走，车开动时纹理不在车身上滑）
function bright(col, start, count) {
  let sum = 0;
  for (let i = start; i < start + count; i++) sum += 0.2126 * col[i * 3] + 0.7152 * col[i * 3 + 1] + 0.0722 * col[i * 3 + 2];
  return count > 0 && sum / count > 0.75;
}
function fillUVs(a, mk) {
  const K = BR.kit, m = K.mat(mk);
  const rep = (m.userData && m.userData.kitRepeat) || [1, 1];
  const ru = rep[0] || 1, rv = rep[1] || 1;
  const W = K.WHITE_UV || [96.5 / 256, 1 - 96.5 / 256];
  const uvAll = mk === 'kit:prop' ? 'world' : null;
  const P = a.pos, N = a.nor, Tt = a.uv;
  for (const pc of a.pieces || []) {
    const i0 = pc.start, i1 = pc.start + pc.count;
    if (pc.grainAuto && !pc.flat && bright(a.col, pc.start, pc.count)) pc.flat = true;
    let mode = pc.uv;
    if (uvAll === 'world' && mode !== 'solid' && mode !== 'scaled') mode = pc.uvMetric ? 'metric' : 'world';
    if (mode === 'solid' || pc.flat) { for (let i = i0; i < i1; i++) { Tt[i * 2] = W[0]; Tt[i * 2 + 1] = W[1]; } continue; }
    if (mode === 'metric') { const su = pc.uvMetric[0] / ru, sv = pc.uvMetric[1] / rv; for (let i = i0; i < i1; i++) { Tt[i * 2] *= su; Tt[i * 2 + 1] *= sv; } continue; }
    if (mode === 'stretch') { if (pc.uvRepeat) for (let i = i0; i < i1; i++) { Tt[i * 2] *= pc.uvRepeat[0]; Tt[i * 2 + 1] *= pc.uvRepeat[1]; } continue; }
    if (mode === 'scaled') {
      const su = pc.uvScale ? pc.uvScale[0] / ru : 1, sv = pc.uvScale ? pc.uvScale[1] / rv : 1;
      for (let i = i0; i < i1; i++) { Tt[i * 2] *= su; Tt[i * 2 + 1] *= sv; }
      continue;
    }
    for (let i = i0; i < i1; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      if (ny > 0.5 || ny < -0.5) { Tt[i * 2] = x / ru; Tt[i * 2 + 1] = ny > 0 ? -z / rv : z / rv; }
      else { const l = Math.hypot(nx, nz) || 1, tx = nz / l, tz = -nx / l; Tt[i * 2] = (x * tx + z * tz) / ru; Tt[i * 2 + 1] = y / rv; }
    }
  }
}
// 累加器 → 打包好的一份（typed array）；parts 里的段都是 [v0, v1) / [i0, i1)
function pack(a, mk, parts, reserve) {
  const n = a.n, ni = a.idx.length, comps = mk === 'kit:decal' ? 4 : 3;
  const nRes = n + (reserve ? reserve.n : 0), niRes = ni + (reserve ? reserve.ni : 0);
  const d = {
    n, ni, nRes, niRes, comps, parts,
    pos: new Float32Array(nRes * 3), nor: new Float32Array(nRes * 3), uv: new Float32Array(nRes * 2),
    col: new Float32Array(nRes * comps), idx: new Uint32Array(niRes), chain: null, beacon: null, onCol: null,
  };
  d.pos.set(a.pos); d.nor.set(a.nor); d.uv.set(a.uv);
  if (comps === 4) for (let i = 0; i < n; i++) {
    d.col[i * 4] = a.col[i * 3]; d.col[i * 4 + 1] = a.col[i * 3 + 1]; d.col[i * 4 + 2] = a.col[i * 3 + 2];
    d.col[i * 4 + 3] = a.alp ? a.alp[i] : 1;
  } else d.col.set(a.col);
  d.idx.set(a.idx);
  return d;
}
function tierFor(veh) {
  const F = FL(), q = quality();
  if (F && has(F, 'driveTier')) {
    try { const t = F.driveTier(q, veh.parkedTier); if (t) return String(t); } catch (err) { /* 走兜底 */ }
  }
  if (q === 'low') return 'drvLow';
  const t = veh.parkedTier;
  return t === 'high' || t === 'mid' || t === 'lite' ? t : t ? 'lite' : 'mid';
}
function lodOf(name) { const F = FL(), L = F && F.lod; return (L && L[name]) || null; }
// 杆数按停放档（上车前后一样）；停放档是 lowb / min（0 根）的车上车后升到 lite，至少留一根升降杆（驾驶位右手边要看得见、会动）
function leversFor(veh) {
  const L = lodOf(veh.parkedTier || 'mid');
  return Math.max(1, L && L.levers != null ? L.levers | 0 : 2);
}
function wearFor(veh, tier) {
  if (quality() === 'low' || tier === 'drvLow') return 0;
  if (veh.wearN != null) return veh.wearN;
  const L = lodOf('mid');
  return Math.max(0, (L && L.decals != null ? L.decals | 0 : 6) - 1);   // 去掉 FK_WEAR[0] 那滩油
}
function modelInfo(veh) {
  const tier = tierFor(veh);
  return { tier, levers: leversFor(veh), number: veh.n || 0, wearN: wearFor(veh, tier), q: quality() };
}
function sigOf(info) { return info.tier + '|' + info.levers + '|' + info.number + '|' + info.wearN + '|' + info.q; }
function callModel(b, info, part, lift) {
  BR.L1forklift.model(b, { part, drive: true, detail: info.tier, levers: info.levers, number: info.number, lift: lift || 0, steer: 0 });
}
function chainCap(info) {
  const k = info.tier + '|' + info.levers;
  let c = chainCaps.get(k);
  if (c) return c;
  c = { n: 0, ni: 0 };
  for (let i = 0; i <= 20; i++) {
    const b = newBuilder();
    try { callModel(b, info, 'chains', i / 20); } catch (err) { break; }
    const a = b._accs && b._accs.get('kit:prop');
    if (a) { c.n = Math.max(c.n, a.n); c.ni = Math.max(c.ni, a.idx.length); }
  }
  chainCaps.set(k, c);
  return c;
}
function buildTemplate(info) {
  const F = FL(), K = BR.kit;
  if (!F || !has(F, 'model') || !K || !has(K, 'builder')) return null;
  const b = newBuilder();
  const marks = [];
  for (const part of PART_ORDER) {
    const m0 = markOf(b);
    try { if (part === 'lightSwitch' || part === 'lightToggle') buildSwitch(b, part); else callModel(b, info, part, 0); }
    catch (err) { once('model:' + part, () => console.error('[vehicles] L1forklift.model 出错', part, err)); }
    marks.push([part, m0, markOf(b)]);
  }
  // 磨损贴花分两段画：车身上的（不动）、货叉上的两道刮痕（跟着货叉架升 2d）。FK_WEAR[0] 那滩油不随车动，不在这里画
  if (info.wearN > 0 && has(F, 'wear')) {
    for (const wp of ['body', 'carriage']) {
      const m0 = markOf(b);
      try { F.wear(b, { detail: info.tier, wearN: info.wearN, part: wp, lift: 0 }); }
      catch (err) { once('wear', () => console.error('[vehicles] L1forklift.wear 出错', err)); }
      marks.push([wp, m0, markOf(b)]);
    }
  }
  const cap = chainCap(info);
  const tpl = { info, sig: sigOf(info), mats: {}, tris: 0 };
  b._accs.forEach((a, mk) => {
    if (!a || !a.n || !a.idx || !a.idx.length) return;
    if (typeof mk !== 'string' || MATS.indexOf(mk) < 0) { once('mat:' + String(mk), () => console.warn('[vehicles] 叉车用了载具网格不认的材质，跳过', mk)); return; }
    fillUVs(a, mk);
    const parts = [];
    for (const [part, m0, m1] of marks) {
      const v0 = m0[mk] ? m0[mk].n : 0, v1 = m1[mk] ? m1[mk].n : 0;
      const i0 = m0[mk] ? m0[mk].ni : 0, i1 = m1[mk] ? m1[mk].ni : 0;
      if (v1 > v0) parts.push({ name: part, v0, v1, i0, i1 });
    }
    // 链条段必须正好是这个累加器的最后一段（PART_ORDER 把它排在最后），后面才能接预留的空位
    let chainPart = mk === 'kit:prop' ? parts.find(p => p.name === 'chains') : null;
    if (chainPart && (chainPart.v1 !== a.n || chainPart.i1 !== a.idx.length)) {
      once('chaintail', () => console.warn('[vehicles] 链条不在 kit:prop 末尾，升降时链条不重建'));
      chainPart = null;
    }
    const reserve = chainPart ? { n: Math.max(0, cap.n - (chainPart.v1 - chainPart.v0)), ni: Math.max(0, cap.ni - (chainPart.i1 - chainPart.i0)) } : null;
    const d = pack(a, mk, parts, reserve);
    if (chainPart) {
      d.chain = { v0: chainPart.v0, cap: chainPart.v1 - chainPart.v0 + reserve.n, i0: chainPart.i0, icap: chainPart.i1 - chainPart.i0 + reserve.ni,
        n: chainPart.v1 - chainPart.v0, ni: chainPart.i1 - chainPart.i0 };
      chainPart.v1 = chainPart.v0 + d.chain.cap; chainPart.i1 = chainPart.i0 + d.chain.icap;
      collapseTail(d, chainPart.v0 + d.chain.n, chainPart.v1, chainPart.i0 + d.chain.ni, chainPart.i1, chainPart.v0);
    }
    if (mk === 'kit:glow') {
      // 灯罩本色在模型里；警示灯（护顶后横梁上的黄色灯罩）和前大灯分开亮灭
      d.beacon = new Uint8Array(d.n);
      d.ind = new Uint8Array(d.n);   // 仪表台大灯开关上的绿色指示灯（绿色明显压过红、蓝的顶点）：熄的时候压得更暗，一眼看得出灭了
      d.onCol = d.col.slice();
      for (let i = 0; i < d.n; i++) {
        const r = d.col[i * 3], gg = d.col[i * 3 + 1], bl = d.col[i * 3 + 2];
        d.beacon[i] = d.pos[i * 3 + 1] > BEACON_Y || bl < 0.4 * r ? 1 : 0;
        d.ind[i] = !d.beacon[i] && gg > 2 * r && gg > 2 * bl ? 1 : 0;
      }
    }
    tpl.mats[mk] = d;
    tpl.tris += d.ni / 3;
  });
  return tpl;
}
// ---- 仪表台大灯开关的几何（车本地坐标；拨杆按中位画，mPart('lightToggle') 按开关转）----
function v3(a, d, k) { return [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k]; }
function sc(d, k) { return [d[0] * k, d[1] * k, d[2] * k]; }
// 中心 c、两个半边向量 u、v 的四边形（正面朝 u × v）
function quadC(b, mk, c, u, v, col) {
  b.quad([c[0] - u[0] - v[0], c[1] - u[1] - v[1], c[2] - u[2] - v[2]], [c[0] + u[0] - v[0], c[1] + u[1] - v[1], c[2] + u[2] - v[2]],
    [c[0] + u[0] + v[0], c[1] + u[1] + v[1], c[2] + u[2] + v[2]], [c[0] - u[0] + v[0], c[1] - u[1] + v[1], c[2] - u[2] + v[2]], mk, { color: col, uv: 'solid' });
}
// 一个小方块：中心 c，沿 X / T / N 的半边长 hx / ht / hn；faces 里没有 '-n' 时底面不画（贴着的那面）
function boxTN(b, c, hx, ht, hn, col, noBottom) {
  const X = SW_AX, T3 = SW_T, N3 = SW_N;
  quadC(b, 'kit:prop', v3(c, X, hx), sc(T3, ht), sc(N3, hn), col);    // +X（T × N = X）
  quadC(b, 'kit:prop', v3(c, X, -hx), sc(N3, hn), sc(T3, ht), col);   // −X
  quadC(b, 'kit:prop', v3(c, T3, ht), sc(N3, hn), sc(X, hx), col);    // +T（N × X = T）
  quadC(b, 'kit:prop', v3(c, T3, -ht), sc(X, hx), sc(N3, hn), col);   // −T
  quadC(b, 'kit:prop', v3(c, N3, hn), sc(X, hx), sc(T3, ht), col);    // +N（X × T = N）
  if (!noBottom) quadC(b, 'kit:prop', v3(c, N3, -hn), sc(T3, ht), sc(X, hx), col);
}
function buildSwitch(b, part) {
  if (!has(b, 'quad')) return;
  const X = SW_AX, T3 = SW_T, N3 = SW_N;
  if (part === 'lightSwitch') {
    // 底板 7 × 9.2 cm、厚 8 mm（底面贴着仪表台斜面，不画）
    boxTN(b, slantPt(SW_X, SW_F, 0.004), 0.035, 0.046, 0.004, SW_COL.plate, true);
    // 指示灯：拨杆上方，绿色（kit:glow，跟大灯一起亮灭）
    quadC(b, 'kit:glow', v3(slantPt(SW_X, SW_F, 0.0092), T3, 0.031), sc(X, 0.009), sc(T3, 0.0065), SW_COL.lamp);
    // 小灯头图标：拨杆下方，一个方灯头 + 三道光（浅色，离底板 1.2 mm）
    const ic = v3(slantPt(SW_X, SW_F, 0.0092), T3, -0.03);
    quadC(b, 'kit:prop', v3(ic, X, -0.008), sc(X, 0.0065), sc(T3, 0.0075), SW_COL.icon);
    for (const k of [-1, 0, 1]) quadC(b, 'kit:prop', v3(v3(ic, X, 0.008), T3, k * 0.0055), sc(X, 0.0055), sc(T3, 0.0012), SW_COL.icon);
    return;
  }
  // 拨杆：从底板中心沿法线伸出 3.2 cm 的方杆 + 黑色杆头（中位；开 = 往上扳，关 = 往下扳）
  const L = 0.032;
  boxTN(b, v3(SW_PIVOT, N3, L / 2), 0.0045, 0.0045, L / 2, SW_COL.bat, true);
  boxTN(b, v3(SW_PIVOT, N3, L), 0.007, 0.007, 0.006, SW_COL.knob, false);
}

// [nv0, nv1) 的顶点叠到 base 那一点、[ni0, ni1) 的索引全指向 base（零面积三角形不出像素）
function collapseTail(d, nv0, nv1, ni0, ni1, base) {
  const P = d.pos;
  for (let v = nv0; v < nv1; v++) { P[v * 3] = P[base * 3]; P[v * 3 + 1] = P[base * 3 + 1]; P[v * 3 + 2] = P[base * 3 + 2]; d.nor[v * 3 + 1] = 1; }
  for (let i = ni0; i < ni1; i++) d.idx[i] = base;
}
function templateFor(info) {
  const sig = sigOf(info);
  let t = modelCache.get(sig);
  if (!t) {
    t = buildTemplate(info);
    if (!t) return null;
    if (modelCache.size > 24) modelCache.clear();
    modelCache.set(sig, t);
  }
  return t;
}
// 保底车的那滩油：单独一份（贴在停放位姿上，不随车动；区块载入时才画）
let oilTpl = null;
function oilTemplate() {
  if (oilTpl) return oilTpl;
  const K = BR.kit;
  if (!K || !has(K, 'decal') || !has(K, 'builder')) return null;
  const b = newBuilder(), F = FL();
  try {
    if (F && has(F, 'wear')) F.wear(b, { part: 'oil' });
    const a0 = b._accs.get('kit:decal');
    if (!a0 || !a0.n) K.decal(b, Object.assign({}, OIL));
  } catch (err) { once('oil', () => console.error('[vehicles] 油渍贴花出错', err)); return null; }
  const a = b._accs.get('kit:decal');
  if (!a || !a.n) return null;
  fillUVs(a, 'kit:decal');
  const d = pack(a, 'kit:decal', [{ name: 'oil', v0: 0, v1: a.n, i0: 0, i1: a.idx.length }], null);
  oilTpl = { info: null, sig: 'oil', mats: { 'kit:decal': d }, tris: d.ni / 3 };
  return oilTpl;
}
// 这台车自己的一份（prop 拷一份，链条段按自己的 lift 改；其余共用模板）
function entFor(veh) {
  const info = modelInfo(veh);
  const tpl = templateFor(info);
  if (!tpl) return null;
  const mats = {};
  for (const mk in tpl.mats) {
    const t = tpl.mats[mk];
    if (mk === 'kit:prop' && t.chain) {
      mats[mk] = Object.assign({}, t, { pos: t.pos.slice(), nor: t.nor.slice(), uv: t.uv.slice(), col: t.col.slice(), idx: t.idx.slice(), chain: Object.assign({}, t.chain) });
    } else mats[mk] = t;
  }
  return { veh, kind: 'veh', tpl, info, sig: tpl.sig, mats, slot: {}, w: null, chainLift: 0, glowSig: -1 };
}

// ---- 链条按 lift 重建 ----
function rebuildChain(ent, lift) {
  const d = ent.mats['kit:prop'];
  const ch = d && d.chain;
  if (!ch) return false;
  const b = newBuilder();
  try { callModel(b, ent.info, 'chains', lift); } catch (err) { return false; }
  const a = b._accs && b._accs.get('kit:prop');
  if (!a) return false;
  if (a.n > ch.cap || a.idx.length > ch.icap) { once('chaincap', () => console.warn('[vehicles] 链条顶点超出预留', a.n, ch.cap)); return false; }
  fillUVs(a, 'kit:prop');
  d.pos.set(a.pos, ch.v0 * 3); d.nor.set(a.nor, ch.v0 * 3); d.uv.set(a.uv, ch.v0 * 2); d.col.set(a.col, ch.v0 * 3);
  for (let i = 0; i < a.idx.length; i++) d.idx[ch.i0 + i] = ch.v0 + a.idx[i];
  ch.n = a.n; ch.ni = a.idx.length;
  collapseTail(d, ch.v0 + ch.n, ch.v0 + ch.cap, ch.i0 + ch.ni, ch.i0 + ch.icap, ch.v0);
  ent.chainLift = lift;
  return true;
}

// ---- 变换：每个部件一个 3×4 矩阵 [r00 r01 r02 r10 r11 r12 r20 r21 r22 tx ty tz] ----
const ML = new Float64Array(12), MW = new Float64Array(12), MC = new Float64Array(12), MA = new Float64Array(12), MB = new Float64Array(12);
function mIdent(M) { M.fill(0); M[0] = M[4] = M[8] = 1; return M; }
// 绕过点 (px, py, pz)、单位轴 (ax, ay, az) 转 ang（右手）
function mRot(M, ax, ay, az, ang, px, py, pz) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  M[0] = c + ax * ax * t; M[1] = ax * ay * t - az * s; M[2] = ax * az * t + ay * s;
  M[3] = ay * ax * t + az * s; M[4] = c + ay * ay * t; M[5] = ay * az * t - ax * s;
  M[6] = az * ax * t - ay * s; M[7] = az * ay * t + ax * s; M[8] = c + az * az * t;
  M[9] = px - (M[0] * px + M[1] * py + M[2] * pz);
  M[10] = py - (M[3] * px + M[4] * py + M[5] * pz);
  M[11] = pz - (M[6] * px + M[7] * py + M[8] * pz);
  return M;
}
// out = A ∘ B（先 B 后 A）
function mMul(A, B, out) {
  const r00 = A[0] * B[0] + A[1] * B[3] + A[2] * B[6], r01 = A[0] * B[1] + A[1] * B[4] + A[2] * B[7], r02 = A[0] * B[2] + A[1] * B[5] + A[2] * B[8];
  const r10 = A[3] * B[0] + A[4] * B[3] + A[5] * B[6], r11 = A[3] * B[1] + A[4] * B[4] + A[5] * B[7], r12 = A[3] * B[2] + A[4] * B[5] + A[5] * B[8];
  const r20 = A[6] * B[0] + A[7] * B[3] + A[8] * B[6], r21 = A[6] * B[1] + A[7] * B[4] + A[8] * B[7], r22 = A[6] * B[2] + A[7] * B[5] + A[8] * B[8];
  const tx = A[0] * B[9] + A[1] * B[10] + A[2] * B[11] + A[9];
  const ty = A[3] * B[9] + A[4] * B[10] + A[5] * B[11] + A[10];
  const tz = A[6] * B[9] + A[7] * B[10] + A[8] * B[11] + A[11];
  out[0] = r00; out[1] = r01; out[2] = r02; out[3] = r10; out[4] = r11; out[5] = r12; out[6] = r20; out[7] = r21; out[8] = r22;
  out[9] = tx; out[10] = ty; out[11] = tz;
  return out;
}
// 车身 → 世界：绕 y 转 yaw（kit 约定）再平移
function mWorld(M, p) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  M[0] = c; M[1] = 0; M[2] = s; M[3] = 0; M[4] = 1; M[5] = 0; M[6] = -s; M[7] = 0; M[8] = c;
  M[9] = p.x; M[10] = p.y; M[11] = p.z;
  return M;
}
// 部件在车身坐标里的变换（lift = 0、steer = 0、不滚的那份 → 现在的样子）
function mPart(M, veh, name) {
  const p = veh.pose;
  if (name === 'mastInner' || name === 'carriage') {
    mIdent(M);
    M[10] = innerTravel() * clamp(p.lift, 0, 1) * (name === 'carriage' ? 2 : 1);
    return M;
  }
  if (name === 'wheelsFront') {
    const w = gv('wheelFront') || DEF_GEO.wheelFront;
    return mRot(M, 1, 0, 0, veh.rollF, 0, num(w.y, 0.29), num(w.z, -0.62));
  }
  if (name === 'wheelRearL' || name === 'wheelRearR') {
    const w = gv('wheelRear') || DEF_GEO.wheelRear;
    const sx = (name === 'wheelRearL' ? -1 : 1) * num(w.x, 0.44), wz = num(w.z, 0.8);
    mRot(MA, 1, 0, 0, veh.rollR, 0, num(w.y, 0.23), wz);
    mRot(MB, 0, 1, 0, p.steer, sx, 0, wz);
    return mMul(MB, MA, M);
  }
  if (name === 'steeringWheel') {
    const sw = gv('steerWheel') || DEF_GEO.steerWheel, tilt = num(sw.tilt, 0.55);
    // pose.steer 是后轮的真实转角（按 A 是负的，车头往左）；方向盘转 −steer × steerRatio：正 = 司机看来逆时针 = 往左打
    return mRot(M, 0, Math.cos(tilt), Math.sin(tilt), -p.steer * num(gv('steerRatio'), 6), num(sw.x, 0), num(sw.y, 1.25), num(sw.z, -0.5));
  }
  if (name === 'lightToggle') {
    // 大灯开关的拨杆：开着往上扳（朝斜面上沿），关着往下扳。绕底板中心的横轴（+x）转：负角 = 法线往上沿转
    return mRot(M, 1, 0, 0, p.hl === 0 ? SW_ANG : -SW_ANG, SW_PIVOT[0], SW_PIVOT[1], SW_PIVOT[2]);
  }
  if (name === 'liftLever') {
    const lv = gv('liftLever');
    if (!lv || !p.lever) return mIdent(M);
    const pv = P3(lv.pivot, null), ax = P3(lv.axis, { x: 1, y: 0, z: 0 });
    const L = Math.hypot(ax.x, ax.y, ax.z) || 1;
    return mRot(M, ax.x / L, ax.y / L, ax.z / L, p.lever, pv.x, pv.y, pv.z);
  }
  return mIdent(M);
}
// 写一段顶点（d 里的 [v0, v1) → 共用网格里 base + v），位置按 M、法线按 M 的旋转部分
function writeXf(d, g, base, v0, v1, M) {
  const src = d.pos, sn = d.nor, P = g.geo.attributes.position.array, N = g.geo.attributes.normal.array;
  for (let v = v0; v < v1; v++) {
    const i = v * 3, o = (base + v) * 3;
    const x = src[i], y = src[i + 1], z = src[i + 2];
    P[o] = M[0] * x + M[1] * y + M[2] * z + M[9];
    P[o + 1] = M[3] * x + M[4] * y + M[5] * z + M[10];
    P[o + 2] = M[6] * x + M[7] * y + M[8] * z + M[11];
    const nx = sn[i], ny = sn[i + 1], nz = sn[i + 2];
    N[o] = M[0] * nx + M[1] * ny + M[2] * nz;
    N[o + 1] = M[3] * nx + M[4] * ny + M[5] * nz;
    N[o + 2] = M[6] * nx + M[7] * ny + M[8] * nz;
  }
}
// 写这台车在某个材质里的部件（mask 里的那些）。返回写过的顶点区间 [lo, hi)（相对共用网格）
function writeParts(ent, mk, mask) {
  const d = ent.mats[mk], s = ent.slot[mk], g = SH.get(mk);
  if (!d || !s || !g || !g.geo) return null;
  const veh = ent.veh;
  if (ent.kind === 'oil') mWorld(MW, ent.park); else mWorld(MW, veh.pose);
  let lo = Infinity, hi = -Infinity;
  for (const part of d.parts) {
    const bit = PB[part.name] || PB.body;
    if (!(mask & bit)) continue;
    if (ent.kind === 'oil') mIdent(ML); else mPart(ML, veh, part.name);
    mMul(MW, ML, MC);
    writeXf(d, g, s.vb, part.v0, part.v1, MC);
    if (s.vb + part.v0 < lo) lo = s.vb + part.v0;
    if (s.vb + part.v1 > hi) hi = s.vb + part.v1;
  }
  if (hi > lo) {
    markRange(g.geo.attributes.position, lo, hi - lo);
    markRange(g.geo.attributes.normal, lo, hi - lo);
  }
  return hi > lo ? [lo, hi] : null;
}
// glow：前大灯和警示灯按「开着 / 熄火、警示灯这一拍亮不亮」写顶点色
function glowState(ent) {
  if (ent.kind !== 'veh') return 0;
  const p = ent.veh.pose;
  if (!p.on) return 0;
  const beat = Math.floor(S.time * BEACON_HZ * 2) % 2 === 0;
  // 前大灯（连同仪表台上的绿色指示灯）跟着大灯开关；警示灯只看发动机
  return (beat ? 2 : 0) | (p.hl === 0 ? 0 : 1);
}
function writeGlow(ent, state) {
  const d = ent.mats['kit:glow'], s = ent.slot['kit:glow'], g = SH.get('kit:glow');
  if (!d || !s || !g || !g.geo || !d.onCol) return;
  const C = g.geo.attributes.color.array, base = s.vb;
  const lamps = !!(state & 1), beacon = !!(state & 2);
  for (let v = 0; v < d.n; v++) {
    const lit = d.beacon[v] ? beacon : lamps;
    const r = d.onCol[v * 3], gg = d.onCol[v * 3 + 1], b = d.onCol[v * 3 + 2];
    // 亮：本色 × GLOW_ON（顶点色 > 1，过色调映射后接近白热）；熄：本色 × 0.35（暗色灯罩，不开洞）
    const k = lit ? (d.beacon[v] ? GLOW_BEACON : GLOW_ON) : d.ind && d.ind[v] ? GLOW_IND_OFF : GLOW_OFF;
    C[(base + v) * 3] = r * k; C[(base + v) * 3 + 1] = gg * k; C[(base + v) * 3 + 2] = b * k;
  }
  markRange(g.geo.attributes.color, base, d.n);
  ent.glowSig = state;
}
// 把一台车整段写进共用网格（布局变了以后）
function writeFull(ent, mk) {
  const d = ent.mats[mk], s = ent.slot[mk], g = SH.get(mk);
  if (!d || !s || !g || !g.geo) return;
  const A = g.geo.attributes, comps = g.comps;
  A.uv.array.set(d.uv.subarray(0, d.nRes * 2), s.vb * 2);
  if (comps === d.comps) A.color.array.set(d.col.subarray(0, d.nRes * comps), s.vb * comps);
  const I = g.geo.index.array;
  for (let i = 0; i < d.niRes; i++) I[s.ib + i] = s.vb + d.idx[i];
  writeParts(ent, mk, ALL_PARTS);
  if (mk === 'kit:glow') writeGlow(ent, glowState(ent));
}
// 链条段重建后：uv、颜色、索引也要重写这一段
function writeChain(ent) {
  const d = ent.mats['kit:prop'], s = ent.slot['kit:prop'], g = SH.get('kit:prop');
  if (!d || !s || !g || !g.geo || !d.chain) return;
  const ch = d.chain, A = g.geo.attributes;
  A.uv.array.set(d.uv.subarray(ch.v0 * 2, (ch.v0 + ch.cap) * 2), (s.vb + ch.v0) * 2);
  A.color.array.set(d.col.subarray(ch.v0 * 3, (ch.v0 + ch.cap) * 3), (s.vb + ch.v0) * 3);
  markRange(A.uv, s.vb + ch.v0, ch.cap);
  markRange(A.color, s.vb + ch.v0, ch.cap);
  const I = g.geo.index.array;
  for (let i = 0; i < ch.icap; i++) I[s.ib + ch.i0 + i] = s.vb + d.idx[ch.i0 + i];
  markRange(g.geo.index, s.ib + ch.i0, ch.icap);
  writeParts(ent, 'kit:prop', PB.chains);
}
function snapW(ent) {
  const p = ent.veh.pose;
  const w = ent.w || (ent.w = {});
  w.x = p.x; w.y = p.y; w.z = p.z; w.yaw = p.yaw; w.steer = p.steer; w.lift = p.lift; w.lever = p.lever; w.hl = p.hl === 0 ? 0 : 1;
  w.rollF = ent.veh.rollF; w.rollR = ent.veh.rollR;
}
// 哪些车要放进网格：本机坐着的、玩家（联机加队友）R+1 块以内的开过的车 / 保底车
function nearChunk(x, z, R) {
  const size = chunkSize(), cx = Math.floor(x / size), cz = Math.floor(z / size);
  const P = BR.player;
  if (P && fin(P.x) && fin(P.z) && Math.max(Math.abs(Math.floor(P.x / size) - cx), Math.abs(Math.floor(P.z / size) - cz)) <= R) return true;
  let peer = null;
  try { peer = BR.coop && BR.coop.peer; } catch (err) { peer = null; }
  if (peer && fin(peer.x) && fin(peer.z) && Math.max(Math.abs(Math.floor(peer.x / size) - cx), Math.abs(Math.floor(peer.z / size) - cz)) <= R) return true;
  return false;
}
function wantMesh(veh) {
  if (veh.seat) return true;
  if (!veh.driven && !veh.runtime) return false;
  if (!veh.driven && veh.runtime && !veh.chunk) return false;
  return nearChunk(veh.pose.x, veh.pose.z, loadR() + 1);
}
function wantOil(veh) {
  return veh.runtime && !!veh.chunk && !!veh.park && quality() !== 'low';
}
// 重新排布共用网格（哪些车在网格里变了、换了细节档、链条预留不够时）。整段重写，次数很少
function layout() {
  S.layoutDirty = false;
  if (!BR.kit || !THREE) return;
  const ents = [];
  V.forEach(veh => {
    const want = wantMesh(veh);
    if (want) {
      const info = modelInfo(veh);
      if (!veh.ent || veh.ent.sig !== sigOf(info)) {
        const old = veh.ent;
        veh.ent = entFor(veh);
        if (veh.ent && old) veh.ent.chainLift = -1;
      }
      if (veh.ent) ents.push(veh.ent);
    } else veh.ent = null;
    if (wantOil(veh)) {
      if (!veh.oilEnt) { const t = oilTemplate(); veh.oilEnt = t ? { veh, kind: 'oil', tpl: t, sig: 'oil', mats: t.mats, slot: {}, park: veh.park, w: null } : null; }
      if (veh.oilEnt) ents.push(veh.oilEnt);
    } else veh.oilEnt = null;
  });
  // 链条：lift 不是 0 的车先按自己的 lift 重建那一段
  for (const e of ents) if (e.kind === 'veh' && Math.abs(e.chainLift - e.veh.pose.lift) > EPS) rebuildChain(e, e.veh.pose.lift);
  const scene = sceneOf();
  for (const mk of MATS) {
    let nv = 0, ni = 0;
    for (const e of ents) {
      const d = e.mats[mk];
      if (!d) { delete e.slot[mk]; continue; }
      e.slot[mk] = { vb: nv, ib: ni };
      nv += d.nRes; ni += d.niRes;
    }
    const g = shared(mk);
    if (!nv) {
      g.nv = 0; g.ni = 0;
      if (g.geo) g.geo.setDrawRange(0, 0);
      if (g.mesh) g.mesh.visible = false;
      continue;
    }
    allocShared(g, nv, ni);
    for (const e of ents) if (e.slot[mk]) writeFull(e, mk);
    g.nv = nv; g.ni = ni;
    g.geo.setDrawRange(0, ni);
    const A = g.geo.attributes;
    for (const a of [A.position, A.normal, A.uv, A.color]) { a.updateRange.offset = 0; a.updateRange.count = nv * a.itemSize; a.needsUpdate = true; }
    g.geo.index.updateRange.offset = 0; g.geo.index.updateRange.count = ni; g.geo.index.needsUpdate = true;
    g.mesh.visible = true;
    if (scene && g.mesh.parent !== scene) scene.add(g.mesh);
  }
  for (const e of ents) if (e.kind === 'veh') snapW(e);
  S.ents = ents;
  bounds();
}
// 包围球按网格里的车实时重算（全在身后时整块被视锥裁掉）
function bounds() {
  const ents = S.ents || [];
  if (!ents.length) return;
  let sx = 0, sz = 0, n = 0;
  for (const e of ents) { const p = e.kind === 'oil' ? e.park : e.veh.pose; sx += p.x; sz += p.z; n++; }
  const cx = sx / n, cz = sz / n;
  let r = 0, cy = 0;
  for (const e of ents) {
    const p = e.kind === 'oil' ? e.park : e.veh.pose;
    cy += p.y;
    r = Math.max(r, Math.hypot(p.x - cx, p.z - cz) + (e.kind === 'oil' ? 0.6 : 2.6));
  }
  cy = cy / n + 1.9;
  r = Math.hypot(r, 2.2);
  for (const mk of MATS) {
    const g = SH.get(mk);
    if (!g || !g.geo || !g.nv) continue;
    const bs = g.geo.boundingSphere || (g.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1));
    bs.center.set(cx, cy, cz);
    bs.radius = r;
  }
}
// 每帧：动过的车只重写动过的部件
function refreshMesh() {
  const ents = S.ents || [];
  let moved = false;
  for (const e of ents) {
    if (e.kind !== 'veh') continue;
    const veh = e.veh, p = veh.pose, w = e.w;
    if (!w) { snapW(e); continue; }
    let mask = 0;
    if (Math.abs(w.x - p.x) > EPS || Math.abs(w.z - p.z) > EPS || Math.abs(w.y - p.y) > EPS || Math.abs(w.yaw - p.yaw) > EPS) mask = ALL_PARTS;
    else {
      if (Math.abs(w.steer - p.steer) > EPS) mask |= PB.wheelRearL | PB.wheelRearR | PB.steeringWheel;
      if (Math.abs(w.rollF - veh.rollF) > EPS) mask |= PB.wheelsFront;
      if (Math.abs(w.rollR - veh.rollR) > EPS) mask |= PB.wheelRearL | PB.wheelRearR;
      if (Math.abs(w.lift - p.lift) > EPS) mask |= PB.mastInner | PB.carriage | PB.chains;
      if (Math.abs(w.lever - p.lever) > EPS) mask |= PB.liftLever;
      if (w.hl !== (p.hl === 0 ? 0 : 1)) mask |= PB.lightToggle;
    }
    if (Math.abs(e.chainLift - p.lift) > EPS && rebuildChain(e, p.lift)) { writeChain(e); mask &= ~PB.chains; }
    if (mask) {
      for (const mk of MATS) if (e.slot[mk]) writeParts(e, mk, mask);
      moved = true;
    }
    const gs = glowState(e);
    if (gs !== e.glowSig) writeGlow(e, gs);
    snapW(e);
  }
  if (moved) bounds();
}

// ---------- 准心候选 ----------
function peerOn(veh) {
  if (veh.seat === 'peer') return true;
  const pp = S.peerPose;
  if (pp && pp.mode === 'drive' && (pp.key === veh.key || pp.key === 'k:' + veh.key)) return true;
  const C = BR.coop;
  if (C && C.active && has(C, 'leaseOf')) {
    try { return C.leaseOf('k:' + veh.key) === 'peer'; } catch (err) { return false; }
  }
  return false;
}
const SH_OK = { verb: T.mount, ok: true, why: '' };
const SH_SIDE = { verb: T.mount, ok: false, why: T.side };
const SH_NEAR = { verb: T.mount, ok: false, why: T.near };
const SH_PEER = { verb: T.mount, ok: false, why: T.peer };
const SH_OLD = { verb: T.mount, ok: false, why: T.old };
// 站在哪能上车：侧面上车区里、离座椅 ≤1.5 m
function mountCheck(veh, px, pz) {
  if (peerOn(veh)) return SH_PEER;
  const C = BR.coop;
  if (C && C.active && has(C, 'can')) {
    let ok = true;
    try { ok = C.can('veh2') !== false; } catch (err) { ok = true; }
    if (!ok) return SH_OLD;
  }
  toLocal(veh.pose, px, pz, tmpL);
  const z = mountZone();
  // 「在侧面」= 离车中线够远、前后在车身（门架前脸到配重后脸）范围里：站在配重、后轮旁边或前轮、门架旁边也算侧面，
  // 离座椅远了说「再走近一点」；在货叉前方、配重后面才说「绕到侧面上车」
  const h = hullOf(veh), z0 = Math.min(z.z0, h.min[2]), z1 = Math.max(z.z1, h.max[2]);
  if (Math.abs(tmpL.x) < z.x || tmpL.z < z0 || tmpL.z > z1) return SH_SIDE;
  const st = seatLocal();
  if (Math.hypot(tmpL.x - st.x, tmpL.z - st.z) > z.reach) return SH_NEAR;
  return SH_OK;
}
function canUse() {
  const P = BR.player;
  // 上下车那 0.5 s 插值（player.pose 一直是 'drive'）不出候选：下车动画里准心下不会闪「绕到侧面上车」，
  // 连按两下空格的第二下也不会被当成「上车」拒绝（咔一声 + 灰字）
  return !!P && !P.dead && !editing() && !S.seated && P.pose !== 'drive';
}
function vehSource(ray, reach, out) {
  if (S.seated) { switchSource(ray, reach, out); return; }
  if (!canUse() || !V.size) return;
  const I = BR.interact;
  if (!I || !I.hit) return;
  const P = BR.player;
  const lim = reach + CAND_PAD;
  V.forEach(veh => {
    if (veh.seat === 'me') return;
    const p = veh.pose;
    const dx = p.x - ray.ox, dz = p.z - ray.oz;
    if (dx * dx + dz * dz > lim * lim) return;
    const h = hullOf(veh);
    const t = I.hit.obb(ray, { x: p.x, y: p.y, z: p.z, rot: p.yaw }, h.min, h.max, false);
    if (!(t >= 0) || t > reach) return;
    const c = veh.cand || (veh.cand = { kind: 'vehicle', key: veh.key, label: LABEL, t: 0, small: false, short: SH_OK, hold: null,
      canDrag: false, dragWhy: T.heavy, vol: 0, ref: veh, parentKeys: [], solidKey: null, x: 0, y: 0, z: 0 });
    c.t = t;
    c.short = mountCheck(veh, P.x, P.z);
    c.solidKey = veh.obbKey || physKeyOf(veh);
    c.x = ray.ox + ray.dx * t; c.y = ray.oy + ray.dy * t; c.z = ray.oz + ray.dz * t;
    out.push(c);
  });
  highRiders(ray, reach, out);
}
// 坐在车上：准心对准仪表台的大灯开关 → 按钮候选（drive 情境只认这台车的开关，见 doMount 的 accept）。
// 上车往座椅里落的那 0.5 s、正在下车时不出。开关埋在仪表台的碰撞盒（dash）里面：射线先打到的是这台车自己的盒子，t 收到墙那里
const SH_LON = { verb: T.lightOn, ok: true, why: '', name: '' };
const SH_LOFF = { verb: T.lightOff, ok: true, why: '', name: '' };
function switchSource(ray, reach, out) {
  const D = S.drive, veh = D && V.get(D.key), I = BR.interact, P = BR.player;
  if (!veh || D.phase === 'mount' || D.exit || !I || !I.hit || !P || P.dead || editing()) return;
  const p = veh.pose;
  let t = I.hit.obb(ray, { x: p.x, y: p.y, z: p.z, rot: p.yaw }, SW_BOX.min, SW_BOX.max, true);
  if (!(t >= 0) || t > reach) return;
  const own = (veh.obbKey || physKeyOf(veh)) + '#';
  if (ray.wallKey && String(ray.wallKey).indexOf(own) === 0 && ray.wallT < t) t = Math.max(0, ray.wallT);
  const c = S.swCand || (S.swCand = { kind: 'button', key: '', label: T.lightLabel, t: 0, small: true, short: SH_LOFF, hold: null,
    canDrag: false, dragWhy: '', vol: 0, ref: null, parentKeys: [], solidKey: null, x: 0, y: 0, z: 0, onShort: () => toggleLight() });
  c.key = SW_PREFIX + veh.key;
  c.t = t;
  c.short = p.hl === 0 ? SH_LON : SH_LOFF;
  c.solidKey = veh.obbKey || physKeyOf(veh);
  toWorld(p, SW_PIVOT[0], SW_PIVOT[1], SW_PIVOT[2], tmpW);
  c.x = tmpW.x; c.y = tmpW.y; c.z = tmpW.z;
  out.push(c);
}
// 短按开关：开 ↔ 关。发动机开着就马上点亮 / 撤掉大灯（灯池那一盏、灯罩、指示灯一起）；「咔哒」一声。
// 单机、房主写进 levelState（离开再回来保留）；客机经 coop.hand 的 hl 同步给房主，下车时随 rel 带过去
function toggleLight() {
  const D = S.drive, veh = D && V.get(D.key);
  if (!veh || D.phase === 'mount' || D.exit) return false;
  const p = veh.pose;
  p.hl = p.hl === 0 ? 1 : 0;
  sfx('click', undefined, { volume: 0.5, rate: p.hl ? 1.35 : 1.1 });
  if (p.on) { if (p.hl) lightOn(veh); else lightOff(); }
  if (!guest()) writeLs(veh, 1);
  emit('vehicle:lights', { key: veh.key, hl: p.hl, lit: seatLit() });
  return true;
}
// 本机坐着的车大灯现在亮着（发动机开着、开关开着、灯池里借了一盏）：L1 断电时据此换提示
function seatLit() {
  const veh = S.seated && V.get(S.seated);
  return !!(veh && veh.pose.on && veh.pose.hl !== 0 && S.lightOwner);
}
// 手机：准心对着大灯开关时「下车」键临时写成「开大灯 / 关大灯」，移开恢复「下车」（setButtons 的覆盖，换情境时 input 自己清）
function syncSwitchLabel() {
  const inp = BR.input, I = BR.interact;
  if (!has(inp, 'setButtons')) return;
  let want = null;
  if (S.seated && I) {
    const c = I.current;
    if (c && c.kind === 'button' && typeof c.key === 'string' && c.key.indexOf(SW_PREFIX) === 0 && c.short && c.short.verb) want = String(c.short.verb);
  }
  try {
    if (want) {
      const cur = has(inp, 'buttonLabel') ? inp.buttonLabel('interact') : null;
      if (cur !== want) inp.setButtons({ interact: { label: want } });
      S.btnLabel = want;
    } else if (S.btnLabel) {
      if (inp.context === 'drive') inp.setButtons({ interact: null });
      S.btnLabel = null;
    }
  } catch (err) { once('btnlabel', () => console.error('[vehicles] input.setButtons 出错', err)); }
}

// 举得太高的货叉上的物资：压一个同 id、近一点的灰字候选，短按只给原因（够不着）
function highRiders(ray, reach, out) {
  const I = BR.interact, items = BR.items;
  if (!items || !has(items, 'find')) return;
  V.forEach(veh => {
    if (!veh.riders.size) return;
    if (forkSurface(veh) - veh.pose.y <= FORK_REACH) return;
    veh.riders.forEach((r, id) => {
      const it = items.find(id);
      if (!it) return;
      const hh = num(it.hh, 0.08);
      const t = I.hit.sphere(ray, it.x, it.y + hh, it.z, Math.max(0.1, num(it.r, 0.1)), true);
      if (!(t >= 0) || t > reach) return;
      const c = r.cand || (r.cand = { kind: 'item', key: id, label: '', t: 0, small: true, short: { verb: '拾取', ok: false, why: T.high },
        hold: null, canDrag: false, vol: 0, ref: it, parentKeys: [] });
      c.ref = it;
      c.t = Math.max(0, t - 0.03);
      out.push(c);
    });
  });
}

// ---------- 上车 ----------
function mount(key) {
  const veh = V.get(String(key));
  if (!veh || !canUse() || S.pendingGrab) return false;
  const P = BR.player;
  const chk = mountCheck(veh, P.x, P.z);
  if (!chk.ok) { toast(chk.why, 1500); return false; }
  if (coopOn() && BR.coop && has(BR.coop, 'requestGrab')) {
    const k = 'k:' + veh.key;
    const tok = { key: veh.key, t0: nowMs(), done: false };
    S.pendingGrab = tok;
    // 房主当场回调；客机等房主回 own / deny（1.5 s 没回音由 update 收掉，提示「没连上，再试一次」）
    BR.coop.requestGrab(k, 'veh', (ok, why) => {
      if (tok.done || S.pendingGrab !== tok) return;
      tok.done = true;
      S.pendingGrab = null;
      if (!ok) { denyMsg(why); return; }
      // 客机等回复期间可能换了层、回了主页：按 key 重新找这台车，找不到就把租约还回去
      const cur = V.get(tok.key);
      if ((!cur || !doMount(cur)) && has(BR.coop, 'release')) BR.coop.release(k);
    });
    return true;
  }
  return doMount(veh);
}
function denyMsg(why) {
  const w = why ? String(why) : '';
  if (w === 'peer') toast(T.peer, 1800);
  else if (w === 'old' || w === 'net') { /* coop 自己已经提示过 */ }
  else if (w === 'far') toast(T.near, 1500);
  else toast(T.retry, 1800);
}
function createSim(veh) {
  const F = BR.forklift;
  if (!F || !has(F, 'create')) return null;
  const p = veh.pose;
  try {
    return F.create({
      key: veh.key, physKey: physKeyOf(veh), ignoreKey: physKeyOf(veh),
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, steer: p.steer, lift: p.lift, lever: 0, spd: 0, on: 0,
      n: veh.n, number: veh.n, tier: veh.ent ? veh.ent.info.tier : null,
    }) || null;
  } catch (err) {
    once('create', () => console.error('[vehicles] BR.forklift.create 出错', err));
    return null;
  }
}
function sideOf(veh, px, pz) { toLocal(veh.pose, px, pz, tmpL); return tmpL.x < 0 ? 'left' : 'right'; }
function doMount(veh) {
  const P = BR.player;
  if (!P || P.dead || !has(P, 'mount') || S.seated) {
    if (P && !has(P, 'mount')) once('nomount', () => console.warn('[vehicles] BR.player.mount 还没接上'));
    return false;
  }
  promote(veh);
  veh.seat = 'me';
  veh.pose.spd = 0;
  veh.sim = createSim(veh);
  S.seated = veh.key;
  S.out = null;
  S.drive = {
    key: veh.key, t: 0, phase: 'mount', side: sideOf(veh, P.x, P.z), from: { x: P.x, y: P.y, z: P.z },
    exit: null, igniteAt: IGNITE_AT, shakeT: 0, noise: 0, res: null,
    out: { x: P.x, z: P.z, eyeY: P.y, feetY: num(P.feetY, P.y - 1.62), dyaw: 0, noise: 0, shake: 0 },
  };
  S.layoutDirty = true;
  layout();
  if (has(BR.interact, 'setMode')) {
    // drive 情境只认车上的按钮：这台车仪表台上的大灯开关（别的东西一律不出候选，准心空着时「下车」）
    const swKey = SW_PREFIX + veh.key;
    BR.interact.setMode('drive', { key: veh.key, kind: 'vehicle', label: LABEL, accept: c => !!c && c.kind === 'button' && c.key === swKey, onShort: () => { dismount(); return true; } });
  }
  let ok = false;
  try { ok = P.mount(handle) !== false; } catch (err) { console.error('[vehicles] player.mount 出错', err); ok = false; }
  if (!ok) {
    S.seated = null; S.drive = null; veh.seat = null;
    if (has(BR.interact, 'setMode')) BR.interact.setMode('walk');
    return false;
  }
  if (has(BR.hud, 'setDrive')) BR.hud.setDrive({ key: veh.key, label: LABEL });
  // 单机、房主：开过的车马上进 levelState（on:1）。客机不写，下车时按「先写再放租约」交给房主
  if (!guest()) writeLs(veh, 1);
  S.rangeT = 0;
  emit('vehicle:mount', { key: veh.key });
  return true;
}

// ---------- 坐着：每帧由 player.update 经 handle.update 调 ----------
const drvIn = {
  throttle: 0, steer: 0, lift: 0, brake: 0,
  move: { x: 0, y: 0 },
  held(a) { return a === 'liftUp' ? this.lift > 0 : a === 'liftDown' ? this.lift < 0 : false; },
  pressed() { return false; },
  released() { return false; },
};
function fillInput(src) {
  drvIn.throttle = 0; drvIn.steer = 0; drvIn.lift = 0; drvIn.brake = 0; drvIn.move.x = 0; drvIn.move.y = 0;
  if (!src) return drvIn;
  if (src.move) {
    // 摇杆 / WASD：move.y 前进为正，move.x 向右为正；输入 steer +1 = 往左打（按 A，车头往左）。
    // 注意和 FORKLIFT_GEO / pose.steer 的号相反：pose.steer 正 = 后轮前缘往左、车头往右，所以按 A 时 pose.steer 为负
    drvIn.throttle = clamp(num(src.move.y, 0), -1, 1);
    drvIn.steer = clamp(-num(src.move.x, 0), -1, 1);
  } else {
    drvIn.throttle = clamp(num(src.throttle, 0), -1, 1);
    drvIn.steer = clamp(num(src.steer, 0), -1, 1);
  }
  if (has(src, 'held')) drvIn.lift = src.held('liftUp') ? 1 : src.held('liftDown') ? -1 : 0;
  else drvIn.lift = clamp(Math.round(num(src.lift, 0)), -1, 1);
  if (src.brake) drvIn.brake = 1;
  drvIn.move.x = -drvIn.steer; drvIn.move.y = drvIn.throttle;
  return drvIn;
}
function zeroInput(brake) { fillInput(null); drvIn.brake = brake ? 1 : 0; return drvIn; }
// env（sim.step 的第三个参数）：phase = 上车阶段（'mount' | 'seat' | 'start' 不算着车，'run' 才算；点火声、「发动中」由这里管），
// local = 本机在开（雷达不把自己当人）、brake = 下车前急刹、ignoreKey = 自己的碰撞 key、riders = 叉面上的物资（不推、不当障碍）
function envOf(veh, D) {
  const e = veh.env || (veh.env = { key: veh.key, physKey: '', ignoreKey: '', riders: null, local: false, phase: null, brake: false, exiting: false, coop: null });
  e.physKey = e.ignoreKey = physKeyOf(veh);
  e.riders = veh.riders;
  e.local = veh.seat === 'me';
  e.phase = D ? D.phase : veh.pose.on ? 'run' : null;
  e.brake = e.exiting = !!(D && D.exit);
  e.coop = coopRole();
  return e;
}
// 跑一步模拟，把结果套到车上（位姿、OBB、事件音效、状态提示）
function stepSim(veh, dt, inp, D) {
  const prev = veh.pose;
  const px = prev.x, pz = prev.z, pyaw = prev.yaw, v0 = num(prev.spd, 0);   // v0：撞前车速（这一步开始时）
  let res = null;
  if (veh.sim && has(veh.sim, 'step')) {
    try { res = veh.sim.step(dt, inp, envOf(veh, D)); }
    catch (err) { once('step', () => console.error('[vehicles] sim.step 出错', err)); res = null; }
  }
  const np = res && res.pose;
  if (np) {
    const p = veh.pose;
    if (fin(np.x)) p.x = np.x;
    if (fin(np.z)) p.z = np.z;
    if (fin(np.y)) p.y = np.y;
    if (fin(np.yaw)) p.yaw = np.yaw;
    if (fin(np.steer)) p.steer = np.steer;
    if (fin(np.lift)) p.lift = clamp(np.lift, 0, 1);
    if (fin(np.spd)) p.spd = np.spd;
    if (fin(np.lever)) p.lever = np.lever;
  } else veh.pose.spd = 0;
  rollWheels(veh, px, pz, pyaw);
  registerObbs(veh);
  if (res) {
    const ev = res.events;
    let bang = false;
    if (Array.isArray(ev)) for (const e of ev) { if (onSimEvent(veh, e, D) === 'fk_bang') bang = true; }
    // 全速撞上（「哐」、撞前 ≥2 m/s、往前开）：货叉上的瓶罐甩出去（慢慢碰上的「咚」、倒车撞上都不甩）
    if (bang && v0 >= THROW_V && veh.riders.size) throwRiders(veh, v0);
    if (res.note) note(String(res.note));
    if (D) D.noise = num(res.noise, 0);
    // shake：这一步撞上了要抖多久（秒，模拟已经按「减少动态效果」置 0）；幅度由这里按时间衰减
    if (D && typeof res.shake === 'number' && res.shake > 0) D.shakeT = Math.max(D.shakeT, Math.min(0.5, res.shake));
  } else if (D) D.noise = veh.pose.on ? 0.25 : 0;
  return res;
}
const LOOP_EV = { fk_engine: 1, fk_hydraulic: 1, fk_reverse: 1 };
function onSimEvent(veh, e, D) {
  let name = typeof e === 'string' ? e : e && (e.name || e.type || e.ev || e.sound);
  if (!name) return;
  name = String(name);
  if (name.indexOf('fk_') !== 0) name = 'fk_' + name;
  if (LOOP_EV[name]) return name;   // 循环声由这里按状态开关
  if (name === 'fk_bang' && D) D.shakeT = Math.max(D.shakeT, SHAKE_S);
  const opts = e && typeof e === 'object' && isFinite(e.volume) ? { volume: +e.volume } : undefined;
  sfx(name, undefined, opts);
  return name;
}
// 前轮按走过的路滚、后轮也滚（半径不同）
function rollWheels(veh, px, pz, pyaw) {
  const p = veh.pose;
  const dx = p.x - px, dz = p.z - pz;
  if (Math.abs(dx) + Math.abs(dz) < 1e-7) return;
  const ds = -Math.sin(pyaw) * dx - Math.cos(pyaw) * dz;   // 沿车头方向走了多远（前进为正）
  const rf = num((gv('wheelFront') || {}).r, 0.29), rr = num((gv('wheelRear') || {}).r, 0.23);
  veh.rollF = wrap(veh.rollF - ds / rf);
  veh.rollR = wrap(veh.rollR - ds / rr);
}
function note(text, ms) {
  if (!text) return;
  const t = nowMs();
  if (text === S.lastNote && t - S.lastNoteAt < NOTE_GAP_MS) return;
  S.lastNote = text; S.lastNoteAt = t;
  if (has(BR.hud, 'driveNote')) BR.hud.driveNote(text, ms || 1800);
  else toast(text, ms || 1800);
}
function driveUpdate(dt, inp) {
  const D = S.drive;
  const veh = D && V.get(D.key);
  if (!veh) return null;
  dt = num(dt, 0);
  D.t += dt;
  if (D.phase === 'mount' && D.t >= SEAT_AT) {
    D.phase = 'seat'; sfx('fk_seat');
    if (D.wantExit) { const w = D.wantExit; D.wantExit = null; dismount(w.side || undefined); }
  }
  if (D.phase === 'seat' && D.t >= D.igniteAt && !D.exit) { D.phase = 'start'; D.startAt = D.t; sfx('fk_ignite'); note(T.starting, Math.round(IGNITE_S * 1000)); }
  if (D.phase === 'start' && D.t >= D.startAt + IGNITE_S) engineOn(veh);
  // 掉线重连中、vehicles_net 正在重新拿租约（holding）：车先停着
  const live = !!inp && !reconnecting() && !(BR.vehiclesNet && BR.vehiclesNet.holding);
  // 输入关着（联机暂停、结算、切后台、掉线重连）传 null：模拟当成「油门 0、方向回正、不升降」自己刹住，雷达照常
  let use = null;
  if (D.exit) { D.exit.t += dt; use = live ? zeroInput(true) : null; }
  else if (!live) use = null;
  else if (D.phase !== 'run') {
    fillInput(inp);
    if (D.phase === 'start' && Math.abs(drvIn.throttle) > 0.15) note(T.starting, 900);
    use = zeroInput(false);
  } else use = fillInput(inp);
  const pyaw = veh.pose.yaw;
  stepSim(veh, dt, use, D);
  if (D.exit && (Math.abs(veh.pose.spd) < STOP_SPD || D.exit.t >= EXIT_BRAKE_S)) D.exit.ready = true;
  const o = D.out;
  toWorld(veh.pose, eyeLocal().x, eyeLocal().y, eyeLocal().z, tmpW);
  o.x = tmpW.x; o.z = tmpW.z; o.eyeY = tmpW.y; o.feetY = veh.pose.y;
  o.dyaw = adiff(pyaw, veh.pose.yaw);
  o.noise = D.noise;
  if (D.shakeT > 0) { o.shake = SHAKE_AMP * Math.min(1, D.shakeT / SHAKE_S); D.shakeT = Math.max(0, D.shakeT - dt); }
  else o.shake = 0;
  return o;
}
function engineOn(veh) {
  const D = S.drive;
  if (D) D.phase = 'run';
  veh.pose.on = 1;
  if (veh.pose.hl !== 0) lightOn(veh);   // 大灯开关关着：着车也不亮
  emit('vehicle:lights', { key: veh.key, hl: veh.pose.hl === 0 ? 0 : 1, lit: seatLit() });
}
function engineOff(veh, quiet) {
  veh.pose.on = 0;
  stopLoops();
  lightOff();
  if (!quiet) sfx('fk_off');
}

// ---------- 下车 ----------
// side：'left' | 'right' | 不给（按视角：偏左 >20° 左边，偏右 >20° 右边，正前方先左）
function dismount(side) {
  const D = S.drive;
  if (!D || D.exit) return false;
  // 还在往座椅里落（0.5 s）：记下这一下，一落座就按下车处理（不点火）——「任何时候短按空格就下车」
  if (D.phase === 'mount') { D.wantExit = { side: side === 'left' || side === 'right' ? side : null }; return true; }
  const veh = V.get(D.key);
  if (!veh) return false;
  D.exit = { t: 0, pref: side === 'left' || side === 'right' ? side : viewSide(veh), ready: false };
  return true;
}
function viewSide(veh) {
  const P = BR.player;
  if (!P) return 'left';
  const rel = adiff(veh.pose.yaw, num(P.yaw, veh.pose.yaw));   // 正 = 往左看
  if (rel < -20 * Math.PI / 180) return 'right';
  return 'left';
}
// 落点：sim.exitSpot；没有模拟时按同样的规则自己找
function exitSpot(veh, pref, force) {
  let s = null;
  if (veh.sim && has(veh.sim, 'exitSpot')) {
    try { s = veh.sim.exitSpot(pref, !!force); } catch (err) { once('exit', () => console.error('[vehicles] sim.exitSpot 出错', err)); s = undefined; }
    if (s === null && !force) return null;
  }
  if (!s || !fin(s.x) || !fin(s.z)) s = fallbackSpot(veh, pref, force);
  if (!s) return null;
  let side = s.side;
  if (side === 'L' || side === -1) side = 'left';
  else if (side === 'R' || side === 1) side = 'right';
  else if (side === 'back' || side === 'tail') side = 'rear';
  if (side !== 'left' && side !== 'right' && side !== 'rear') {
    toLocal(veh.pose, s.x, s.z, tmpL);
    side = tmpL.z > 1.0 && Math.abs(tmpL.x) < 0.7 ? 'rear' : Math.abs(tmpL.x) > 0.5 && Math.abs(tmpL.x) < 2.5 && tmpL.z > -1.2 && tmpL.z < 1.4 ? (tmpL.x < 0 ? 'left' : 'right') : 'free';
  }
  return { x: +s.x, z: +s.z, side };
}
function spotFree(x, z, veh) {
  const P = BR.phys, r = num(BR.config.player && BR.config.player.radius, 0.3), h = num(BR.config.player && BR.config.player.height, 1.8);
  const g = groundAt(x, z, veh.pose.y);
  if (Math.abs(g - veh.pose.y) > 0.5) return false;
  if (has(P, 'overlapCircle') && P.overlapCircle(x, z, r, g + 0.02, h)) return false;
  if (has(BR.world, 'blockers')) {
    let bs = null;
    try { bs = BR.world.blockers({ x, z, r }); } catch (err) { bs = null; }
    if (Array.isArray(bs) && bs.length) return false;
  }
  return true;
}
function fallbackSpot(veh, pref, force) {
  const es = gv('exitSide'), er = gv('exitRear');
  const side = es && typeof es === 'object' ? num(es.x, 1.0) : num(es, 1.0), sz = es && typeof es === 'object' ? num(es.z, 0.24) : seatLocal().z;
  const rear = er && typeof er === 'object' ? num(er.z, 1.75) : num((gv('half') || {}).z, 1.3) + num(er, 0.5);
  const order = pref === 'right' ? [['right', side], ['left', -side]] : [['left', -side], ['right', side]];
  for (const [nm, lx] of order) { toWorld(veh.pose, lx, 0, sz, tmpW); if (spotFree(tmpW.x, tmpW.z, veh)) return { x: tmpW.x, z: tmpW.z, side: nm }; }
  toWorld(veh.pose, 0, 0, rear, tmpW);
  if (spotFree(tmpW.x, tmpW.z, veh)) return { x: tmpW.x, z: tmpW.z, side: 'rear' };
  if (!force) return null;
  for (let d = 1.6; d <= 8.01; d += 0.4) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const x = veh.pose.x + Math.cos(a) * d, z = veh.pose.z + Math.sin(a) * d;
      if (spotFree(x, z, veh)) return { x, z, side: 'free' };
    }
  }
  return { x: veh.pose.x, z: veh.pose.z, side: 'free' };
}
function doExit(veh) {
  const D = S.drive;
  if (!D || !D.exit) return false;
  const s = exitSpot(veh, D.exit.pref, false);
  if (!s) { D.exit = null; note(T.blocked, 2500); return false; }
  finishExit(veh, s, 'exit');
  return true;
}
// 强制下车（死亡、reset、复活、换层、回主页、掉线拿不回租约）：不提示、不刹车，人直接落在落点
function forceExit(reason) {
  if (!S.seated) return false;
  const veh = V.get(S.seated);
  if (!veh) { clearSeat(); return false; }
  const pref = S.drive && S.drive.exit ? S.drive.exit.pref : viewSide(veh);
  const s = exitSpot(veh, pref, true) || { x: veh.pose.x, z: veh.pose.z, side: 'free' };
  finishExit(veh, s, reason || 'force');
  return true;
}
function finishExit(veh, spot, reason) {
  const normal = reason === 'exit';
  veh.pose.spd = 0;
  veh.pose.lever = 0;   // 松手：升降杆回中（货叉留在原高度）
  engineOff(veh, !normal || !veh.pose.on);   // 熄火声只在着过车、正常下车时放
  veh.seat = null;
  writeLs(veh, 0);
  if (coopOn() && BR.coop) {
    const C = BR.coop, k = 'k:' + veh.key, p = veh.pose;
    // 最后一帧：tilt 0、spd 0、on 0（第 9 个值不给时 coop 当成 on:1 —— 熄火这一帧要明确报 0），第 10 个值是大灯开关
    if (has(C, 'hand')) { try { C.hand(k, p.x, p.z, p.yaw, p.steer, p.lift, 0, 0, 0, p.hl === 0 ? 0 : 1); } catch (err) { /* 老 coop */ } }
    if (has(C, 'release')) { try { C.release(k, [p.x, 0, p.z]); } catch (err) { /* 已经放了 */ } }
  }
  const lifted = veh.pose.lift > 0.02;
  S.out = { key: veh.key, x: spot.x, z: spot.z, side: spot.side };
  S.seated = null;
  S.drive = null;
  if (S.btnLabel && BR.input && has(BR.input, 'setButtons') && BR.input.context === 'drive') { try { BR.input.setButtons({ interact: null }); } catch (err) { /* 忽略 */ } }
  S.btnLabel = null;
  if (has(BR.interact, 'setMode') && BR.interact.mode === 'drive') BR.interact.setMode('walk');
  if (has(BR.hud, 'setDrive')) BR.hud.setDrive(null);
  const P = BR.player;
  if (P && has(P, 'unmount') && P.mounted === handle) {
    try { P.unmount(reason); } catch (err) { console.error('[vehicles] player.unmount 出错', err); }
  }
  if (normal && lifted && !S.liftWarned) { S.liftWarned = true; toast(T.lifted, 2200); }
  S.rangeT = 0;
  S.riderScan = true;
  emit('vehicle:dismount', { key: veh.key, x: spot.x, z: spot.z, side: spot.side, reason });
}
// 不经下车流程直接清掉坐车状态（新开一局 / 回主页：levelState 已经重置，不能再写）
function clearSeat() {
  if (S.seated) { const veh = V.get(S.seated); if (veh) { veh.seat = null; veh.pose.on = 0; } }
  S.seated = null; S.drive = null; S.out = null;
  S.btnLabel = null;
  stopLoops();
  lightOff();
  if (has(BR.hud, 'setDrive')) BR.hud.setDrive(null);
}

// ---------- handle（交给 player.mount） ----------
// path(dir)：'in' → [站立眼点, 踏板上方, 座椅眼点]；'out' → [座椅眼点, 踏板上方（车尾下车是配重上方）, 落点眼点]
function eyePath(dir) {
  const key = S.seated || (S.out && S.out.key);
  const veh = key && V.get(key);
  if (!veh) return [];
  const eye = eyeLocal(), stp = stepLocal();
  const eyeH = num(BR.config.player && BR.config.player.eyeHeight, 1.62);
  const seat = Object.assign({}, toWorld(veh.pose, eye.x, eye.y, eye.z, tmpW));
  const stepUp = eyeH;   // geo.stepPoint.y 是在站立眼高上再抬的高度（踩在踏板上）
  if (dir === 'out') {
    const o = S.out;
    if (!o) return [seat];
    let mid;
    if (o.side === 'rear') {
      // 车尾下车：翻过配重（中间点在配重顶上方）
      let top = 1.1, cz = 1.0;
      for (const b of localObbs(veh)) if (b.name === 'counterweight') { top = b.cy + b.hy; cz = b.cz; }
      mid = Object.assign({}, toWorld(veh.pose, 0, top + 0.5, cz, tmpW));
    } else {
      const sx = (o.side === 'right' ? 1 : -1) * Math.abs(stp.x);
      mid = Object.assign({}, toWorld(veh.pose, sx, stp.y + stepUp, stp.z, tmpW));
    }
    const g = groundAt(o.x, o.z, veh.pose.y);
    return [seat, mid, { x: o.x, y: g + eyeH, z: o.z }];
  }
  const D = S.drive;
  const side = D && D.side === 'right' ? 1 : -1;
  const from = D ? D.from : null;
  const mid = Object.assign({}, toWorld(veh.pose, side * Math.abs(stp.x), stp.y + stepUp, stp.z, tmpW));
  return [from ? { x: from.x, y: from.y, z: from.z } : mid, mid, seat];
}
const handle = {
  get key() { return S.seated; },
  update(dt, inp) { return driveUpdate(dt, inp); },
  path(dir) { return eyePath(dir); },
  forceExit(reason) { forceExit(reason); },
  cab() { return cabFor(BR.player); },
  chest() { return chestOf(BR.player); },
  yaw() { const veh = S.seated && V.get(S.seated); return veh ? veh.pose.yaw : null; },
};

// ---------- 别的模块查询 ----------
function vehOf(p) {
  if (p == null) return null;
  if (typeof p === 'string') {
    if (V.has(p)) return V.get(p);
    if (p === 'me' || p === 'local') return S.seated ? V.get(S.seated) || null : null;
    if (p === 'peer' || p === 'remote') return peerVeh();
    return null;
  }
  if (typeof p !== 'object') return null;
  if (p === BR.player || p.local === true || p.isLocal === true) return S.seated ? V.get(S.seated) || null : null;
  if (p.mounted && p.mounted.key != null && V.has(p.mounted.key)) return V.get(p.mounted.key);
  const k = p.vehicle != null ? p.vehicle : p.veh;
  if (k != null && V.has(String(k))) return V.get(String(k));
  const pv = peerVeh();
  if (pv && fin(p.x) && fin(p.z)) {
    const st = seatWorld(pv.key);
    if (st && Math.hypot(st.x - p.x, st.z - p.z) <= 2.5) return pv;
    return null;
  }
  return pv && p.peer === true ? pv : null;
}
function peerVeh() {
  const pp = S.peerPose;
  if (pp && pp.mode === 'drive' && pp.key) {
    const k = String(pp.key).replace(/^k:/, '');
    if (V.has(k)) return V.get(k);
  }
  for (const veh of V.values()) if (veh.seat === 'peer') return veh;
  return null;
}
const cabOut = { cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, minY: 0, maxY: 0, key: null, yaw: 0, x: 0, z: 0 };
function cabFor(p) {
  const veh = vehOf(p);
  if (!veh) return null;
  const c = cabGeo(), v = veh.pose;
  toWorld(v, 0, 0, (c.z0 + c.z1) / 2, tmpW);
  cabOut.cx = tmpW.x; cabOut.cz = tmpW.z; cabOut.hx = c.x; cabOut.hz = (c.z1 - c.z0) / 2;
  cabOut.rot = v.yaw; cabOut.yaw = v.yaw; cabOut.minY = v.y + c.yFloor; cabOut.maxY = v.y + c.yTop;
  cabOut.key = veh.key; cabOut.x = v.x; cabOut.z = v.z;
  return cabOut;
}
const chestOut = { x: 0, y: 0, z: 0 };
function chestOf(p) {
  const veh = vehOf(p);
  if (!veh) return null;
  const c = chestLocal();
  toWorld(veh.pose, c.x, c.y, c.z, chestOut);
  return chestOut;
}
function seatWorld(key) {
  const veh = V.get(String(key));
  if (!veh) return null;
  const s = seatLocal();
  toWorld(veh.pose, s.x, s.y, s.z, tmpW);
  return { x: tmpW.x, y: tmpW.y, z: tmpW.z, yaw: veh.pose.yaw };
}

// ---------- 货叉上的物资 ----------
function forkSurface(veh) { return veh.pose.y + forkBase() + carriageTravel() * clamp(veh.pose.lift, 0, 1); }
// (x, z) 落下去会不会落在某根货叉的叉面上：离货叉中线 ≤12 cm、在叉尖和叉根之间、叉面离地 ≤1.4 m。
// 返回 { y: 叉面, veh: 车 key, tine: 0 左 | 1 右, x, z（摆到那根货叉中线上的位置） }；
// 这根货叉上已经有东西（返修 r4）：沿货叉找离落点最近的空位（两件水平半径之和 + 1 cm，一样近先往叉根那边），
// 整根货叉都放不下返回 { full: true, veh, tine, y }（player 提示「货叉上放不下了」，东西留在手里）。type：要丢的那件的类型（量它的水平半径）
const FORK_GAP = 0.01, FORK_END_GAP = 0.02;
function freeSpot(z0, lo, hi, busy) {
  const free = z => z >= lo - 1e-9 && z <= hi + 1e-9 && busy.every(b => Math.abs(z - b[0]) >= b[1] - 1e-9);
  if (free(z0)) return z0;
  let best = null, bd = Infinity;
  for (const b of busy) {
    for (const z of [b[0] + b[1], b[0] - b[1]]) {   // 先叉根（+z）后叉尖：一样近时留叉根那个
      const c = clamp(z, lo, hi);
      if (!free(c)) continue;
      const dd = Math.abs(c - z0);
      if (dd < bd - 1e-9) { bd = dd; best = c; }
    }
  }
  return best;
}
function dropSurface(x, z, r, type) {
  if (!V.size || editing()) return null;
  x = +x; z = +z;
  if (!isFinite(x) || !isFinite(z)) return null;
  const I = BR.items;
  const fr = type != null ? footOfType(type, r) : clamp(num(+r, 0.06), 0.02, 0.2) * 0.8;   // 要丢的那件的水平半径
  const tx = tineX(), fz = forkZ();
  let best = null, bd = Infinity;
  V.forEach(veh => {
    const p = veh.pose;
    if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) > 16) return;
    toLocal(p, x, z, tmpL);
    if (tmpL.z < fz[0] - 0.02 || tmpL.z > fz[1] + 0.02) return;
    const y = forkSurface(veh);
    if (y - p.y > FORK_REACH) return;
    const wz = tmpL.z;
    for (let t = 0; t < 2; t++) {
      const d = Math.abs(tmpL.x - tx[t]);
      if (d > FORK_TOL || d >= bd) continue;
      // 整件在叉面上，离叉尖、叉根再留 2 cm（不悬在叉尖边上：叉尖顶着墙撞上时，它离墙还有一点空，能从叉边滑下去）
      const half = Math.min(fr + FORK_END_GAP, (fz[1] - fz[0]) / 2);
      const lo = fz[0] + half, hi = fz[1] - half;
      // 这根货叉上已经放着的：[lz, 两件中心至少要隔多远]
      const busy = [];
      veh.riders.forEach((rd, id) => {
        if (Math.abs(rd.lx - tx[t]) >= FORK_TOL) return;
        const it = I && has(I, 'find') ? I.find(id) : null;
        busy.push([rd.lz, (it ? footRaw(it) : 0.06) + fr + FORK_GAP]);
      });
      const lz = freeSpot(clamp(wz, lo, hi), lo, hi, busy);
      bd = d;
      if (lz == null) { best = { full: true, y, veh: veh.key, tine: t, side: t === 0 ? 'left' : 'right' }; continue; }
      toWorld(p, tx[t], 0, lz, tmpW);
      best = { y, veh: veh.key, tine: t, side: t === 0 ? 'left' : 'right', x: tmpW.x, z: tmpW.z };
    }
  });
  return best;
}
function attachItem(id, vehKey) {
  const veh = V.get(String(vehKey));
  const I = BR.items;
  if (!veh || !I || !has(I, 'find')) return false;
  const it = I.find(id);
  if (!it) return false;
  footRaw(it);   // 顺手量一下这个类型的水平半径（下一次往货叉上丢同类型的就按量的排）
  toLocal(veh.pose, it.x, it.z, tmpL);
  veh.riders.set(String(it.id), { lx: tmpL.x, lz: tmpL.z, dy: num(it.y, 0) - forkSurface(veh), rot0: num(it.rotY, 0), yaw0: veh.pose.yaw, holding: false, cand: null });
  veh.riderSig = '';
  return true;
}
function riderSigOf(veh) { const p = veh.pose; return r4(p.x) + ',' + r4(p.z) + ',' + r4(p.yaw) + ',' + r4(p.lift) + ',' + r4(p.y); }
// 车或货叉在动：riders 抓住（停掉浮动、不逐帧写 levelState）跟着挪；停稳一帧后松手（一次写 levelState）
function updateRiders() {
  const I = BR.items;
  if (!I || !has(I, 'find')) return;
  V.forEach(veh => {
    if (!veh.riders.size) return;
    const sig = riderSigOf(veh);
    const moving = sig !== veh.riderSig;
    veh.riderSig = sig;
    const y0 = forkSurface(veh);
    veh.riders.forEach((r, id) => {
      const it = I.find(id);
      if (!it || it.owner) { veh.riders.delete(id); return; }
      if (it.held && !r.holding) { veh.riders.delete(id); return; }   // 被人拖走了
      if (moving) {
        if (!r.holding && has(I, 'hold')) { I.hold(id, true); r.holding = true; }
        toWorld(veh.pose, r.lx, 0, r.lz, tmpW);
        it.rotY = r.rot0 + adiff(r.yaw0, veh.pose.yaw);
        if (has(I, 'move')) I.move(id, tmpW.x, y0 + r.dy, tmpW.z);
      } else if (r.holding) {
        r.holding = false;
        if (has(I, 'hold')) I.hold(id, false);
      }
    });
  });
}
// 重新载入（走远回来、换层回来）：叉面 ±2 cm 以内的丢弃物重新挂回去
function scanRiders() {
  S.riderScan = false;
  const I = BR.items;
  if (!I || !Array.isArray(I.list) || !V.size) return;
  const tx = tineX(), fz = forkZ();
  for (const it of I.list) {
    if (!it || !it.dropped || it.owner || it.held) continue;
    V.forEach(veh => {
      if (veh.riders.has(String(it.id))) return;
      const p = veh.pose;
      if ((p.x - it.x) * (p.x - it.x) + (p.z - it.z) * (p.z - it.z) > 16) return;
      const y = forkSurface(veh);
      if (Math.abs(num(it.y, -9) - y) > REATTACH_TOL) return;
      toLocal(p, it.x, it.z, tmpL);
      if (tmpL.z < fz[0] - 0.02 || tmpL.z > fz[1] + 0.02) return;
      if (Math.abs(tmpL.x - tx[0]) > FORK_TOL && Math.abs(tmpL.x - tx[1]) > FORK_TOL) return;
      if (!it.still) { it.still = true; if (has(I, 'move')) I.move(it.id, it.x, it.y, it.z); }
      attachItem(it.id, veh.key);
    });
  }
}
// ---------- 全速撞车：货叉上的瓶罐甩出去（家长定的规则，FE1 返修 r2；r3 按真实轨迹逐段查；r4 每一段都照动画的样子查）----------
// 单机、房主司机：本机算落点和轨迹、摆过去，落地松手写进本层状态（丢弃物那张表），房主再 coop.emit('fkthrow') 告诉客机；
// 客机司机：不自己算，coop.use('k:'+车, 'fkthrow', …) 请房主按他那边货叉上的东西算，房主摆好、写好状态，把落点和轨迹回给客机照摆（以房主为准）
//
// 每件按真实的样子走（主会话 r3 裁定 ①）：
//   ① 往前：沿着自己那根货叉、贴着叉面往前滑，圆心过了叉尖 0.3 rad 就翻下叉尖（一瞬间，不到一帧走的路：整个离开叉尖、底面比叉面低 3 mm），
//      接着沿抛物线落到叉尖前方 d（车速 2 → 0.2 m、4.5 → 0.5 m）的地上。叉面高度上圆心不会越过叉尖 0.3 rad 以上（不悬在半空）。
//   ② 碰上：抛物线半路碰上东西（墙、货、柱子、柱础、别的物资），在碰上之前停住，贴着它竖直掉下去（落在叉尖和它之间）。
//   ③ 往前不行（叉尖顶着墙、柱子，滑不出叉尖；或者前面落不下）：从这一件还在叉面上的地方横着滑下叉边（先外侧、再两叉中间），
//      圆心过了叉沿 0.3 rad 就翻下去，竖直掉到地上（贴着挡住它的东西）。走这条路时它一直在叉面上（不会先滑出叉尖再退回来，r4）。
//   落点：圆心底下先接住它的面（一般是地面；贴着柱子掉下去可能是柱础顶面）要放得稳（圆心周围 0.35 rad 都在同一个面上），
//   不能落进斜放地牛那块看不见的 1 m 老碰撞体（人走不进去、准心也够不着，r4），落地时不压着别的东西；
//   不行就先往外挪（离货叉远一点，每 2 cm 最多 10 cm：贴着先落地的那件落在外侧），再往车这边挪（每 2 cm 最多 12 cm：磕到柱础边往回落）。
//   先试 ②（只往外挪）、③ 两侧（只往外挪），都不行再试 ② ③ 往车这边挪的；全都不行：留在叉面上原处不动。
//   每一段（贴着叉面滑、横着滑、抛物线、竖直掉、往回落的斜线）都按动画同样的插值每 2 cm 查一次：这台车自己的 14 个盒子（按撞车那一刻的位姿算）、
//   墙货架别的车（phys）、车身高度上没有碰撞体的东西（sideObs：柱础、护角、地牛、纸箱、路锥……）、地上别的物资、留在叉上的，
//   还有先甩出去的那几件（按同一时刻它在轨迹上的位置），任何一处都不穿过去。
// 落地后静静躺在地上（still：不浮动、不转圈、落地那一下不往上弹，主会话 r3 裁定 ③；换层回来由 relayLying 再让它躺下）
function forkSurfaceAt(pose) { return num(pose.y, 0) + forkBase() + carriageTravel() * clamp(num(pose.lift, 0), 0, 1); }
// 物资的「脚」：模型离它自己竖直转轴（原点）最远那个顶点的水平距离，按类型量一次（绕竖直轴转多少都一样）。
// 返修 r4：以前按包围球半径 × 0.8，细高的瓶子大了 2.5 倍（水瓶 0.111，模型 0.044），从叉边下去会在半空横走、「贴着墙」落下离墙 7 cm
const footCache = new Map();
function footOfObj(obj) {
  if (!obj || typeof obj.traverse !== 'function' || !obj.matrixWorld) return null;
  try { obj.updateMatrixWorld(true); } catch (err) { return null; }
  const o = obj.matrixWorld.elements, ox = o[12], oz = o[14];
  let m = -1;
  obj.traverse(n => {
    const pos = n && n.isMesh && n.geometry && n.geometry.attributes ? n.geometry.attributes.position : null;
    if (!pos || !n.matrixWorld || typeof pos.getX !== 'function') return;
    const e = n.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dx = e[0] * x + e[4] * y + e[8] * z + e[12] - ox, dz = e[2] * x + e[6] * y + e[10] * z + e[14] - oz;
      const d = dx * dx + dz * dz;
      if (d > m) m = d;
    }
  });
  return m > 0 && fin(m) ? Math.sqrt(m) : null;
}
// 量不到模型（还没生成、没有 three）：包围盒水平那一截的半对角线（模型绕原点转，是个上界）
function footEst(r, hh) { return Math.sqrt(Math.max(0.0004, r * r - hh * hh)); }
function footRaw(it) {
  if (!it) return 0.05;
  const ty = it.type != null ? String(it.type) : null;
  let f = ty != null ? footCache.get(ty) : undefined;
  if (f == null && it.obj) { f = footOfObj(it.obj); if (f != null && ty != null) footCache.set(ty, f); }
  if (f == null) f = footEst(num(it.r, 0.08), num(it.hh, 0.06));
  return clamp(f, 0.02, 0.3);
}
// 还没生成的（往货叉上丢的那一件）：量过这个类型就用量的，没量过找一件同类型的量，再没有按包围盒估
function footOfType(type, r) {
  const ty = String(type);
  if (footCache.has(ty)) return clamp(footCache.get(ty), 0.02, 0.3);
  const I = BR.items;
  if (I && Array.isArray(I.list)) {
    for (const p of I.list) {
      if (!p || String(p.type) !== ty || !p.obj) continue;
      const f = footOfObj(p.obj);
      if (f != null) { footCache.set(ty, f); return clamp(f, 0.02, 0.3); }
    }
  }
  let inf = null;
  try { inf = I && has(I, 'info') ? I.info(ty) : null; } catch (err) { inf = null; }
  return clamp(footEst(num(inf && inf.r, num(+r, 0.08)), num(inf && inf.hh, 0.06)), 0.02, 0.3);
}
// 查碰撞时多留 1.2 cm：贴着墙落下时看着就是贴着（≤ 1.2 cm），从任何角度看模型（含没那么圆的罐身、瓶盖）都不会碰进墙、货叉
const THROW_PAD = 0.012;
function itemFoot(it) { return footRaw(it) + THROW_PAD; }
function itemTall(it) { return Math.max(0.05, 2 * num(it.hh, 0.06)); }
const THROW_STEP = 0.02;      // 轨迹每 2 cm 查一次
const THROW_SLIDE_V = 1.5;    // 在叉面上往前滑最慢这么快（m/s，只管动画时长）
const THROW_SIDE_V = 1.2;     // 从叉边横着滑下去（翻过叉沿那一下不到一帧走的路）
const THROW_LAND_DY = 0.3;    // 落点地面和车所在地面差得超过这么多（坑、台阶）不落
const THROW_TIP = 0.3;        // 圆心过了叉尖 / 叉沿 0.3 rad 就翻下去
const THROW_DRIFT = 0.015;    // 从叉边翻下去时还往外偏一点
const THROW_BACK_N = 6;       // 落不下时往车这边挪：每 2 cm，最多 6 步（12 cm）
// 这台车在 lift 下的 14 个本地盒子（撞车那一刻的 lift 可能和车现在的不一样：房主替客机算时按客机报的）
function obbsAtLift(veh, lift) {
  if (Math.abs(num(veh.pose.lift, 0) - lift) < EPS) return localObbs(veh);
  const g = geo();
  let list = null;
  if (g && typeof g.obbs === 'function') { try { list = g.obbs(lift); } catch (err) { list = null; } }
  if (!Array.isArray(list) || !list.length) list = fallbackObbs(lift);
  return list.filter(Boolean).map(o => ({ name: String(o.name), cx: num(+o.cx, 0), cy: num(+o.cy, 0), cz: num(+o.cz, 0),
    hx: Math.abs(num(+o.hx, 0)), hy: Math.abs(num(+o.hy, 0)), hz: Math.abs(num(+o.hz, 0)) }));
}
// 车附近的 sideObs 条目（世界坐标，L1 写在 b.data.sideObs）
function sideNear(x, z, R) {
  const out = [], W = BR.world;
  if (!W || !has(W, 'chunks')) return out;
  let cs = null;
  try { cs = W.chunks(); } catch (err) { cs = null; }
  if (!Array.isArray(cs)) return out;
  for (const c of cs) {
    const d = c && c.res && c.res.data, so = d && d.sideObs;
    if (!Array.isArray(so)) continue;
    for (const e of so) {
      if (!e || !fin(+e.minX) || !fin(+e.minY) || +e.maxX < x - R || +e.minX > x + R || +e.maxZ < z - R || +e.minZ > z + R) continue;
      out.push(e);
    }
  }
  return out;
}
// 一次甩货的场景：车位姿、自己的盒子、附近的东西
function throwScene(veh, pose) {
  const I = BR.items, G = BR.forklift && BR.forklift._geom;
  const T = {
    pose, own: obbsAtLift(veh, clamp(num(pose.lift, 0), 0, 1)), ign: veh.obbKey || physKeyOf(veh),
    side: sideNear(pose.x, pose.z, 4), sideHit: G && typeof G.sideHit === 'function' ? G.sideHit : null,
    others: [], movers: [], box: { cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, minY: 0, maxY: 0 },
    tip: forkZ()[0], tx: Math.abs(tineX()[0]), forkW: num(gv('forkW'), 0.1), surf: forkSurfaceAt(pose), skip: undefined,
  };
  // 斜放地牛那块轴对齐的老碰撞体：轨迹和叉车一样跳过，按地牛的真实形状（它的 sideObs 条目）挡；落点不许落进去（inSkip）
  const sk = [];
  for (const e of T.side) if (Array.isArray(e.solid) && e.solid.length >= 6 && sk.indexOf(e.solid) < 0) sk.push(e.solid);
  if (sk.length) T.skip = sk;
  // 地上别的物资（这台车货叉上的另算：留在叉上的按原处、甩出去的按轨迹，逐件加进来）
  if (I && Array.isArray(I.list)) {
    for (const it of I.list) {
      if (!it || it.owner || veh.riders.has(String(it.id)) || !fin(+it.x) || !fin(+it.z)) continue;
      if (Math.abs(it.x - pose.x) > 4 || Math.abs(it.z - pose.z) > 4) continue;
      const y0 = num(+it.y, 0);
      T.others.push({ id: String(it.id), x: +it.x, z: +it.z, r: itemFoot(it), y0, y1: y0 + itemTall(it) });
    }
  }
  return T;
}
// 轨迹 path（车本地 [[t, lx, y, lz, mode]…]）在时刻 t 的位置，和 stepFalls 同一套插值；t 过了终点就是终点。写进 out = [lx, y, lz]
const tmpP = [0, 0, 0];
function pathAt(P, t, out) {
  const end = P[P.length - 1];
  if (!(t < end[0])) { out[0] = end[1]; out[1] = end[2]; out[2] = end[3]; return out; }
  let k = 1;
  while (k < P.length - 1 && P[k][0] <= t) k++;
  const a = P[k - 1], b = P[k], w = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 1;
  out[0] = a[1] + (b[1] - a[1]) * w;
  out[1] = b[4] ? a[2] + (b[2] - a[2]) * w * w : a[2] + (b[2] - a[2]) * w;
  out[2] = a[3] + (b[3] - a[3]) * w;
  return out;
}
// 竖圆柱（车本地 (lx, lz)、底面 y0、高 h、半径 rad）放在这里压不压东西：null = 空的，否则说压着什么。
// time：动画里的时刻（先甩出去的那几件按那一刻在轨迹上的位置算）；null = 都停下以后（落点）
function throwHit(T, lx, lz, y0, h, rad, skip, time) {
  const pose = T.pose, y1 = y0 + h, py = num(pose.y, 0);
  for (const o of T.own) {
    const b0 = py + o.cy - o.hy, b1 = py + o.cy + o.hy;
    if (y1 <= b0 + 0.002 || y0 >= b1 - 0.002) continue;
    const qx = clamp(lx, o.cx - o.hx, o.cx + o.hx), qz = clamp(lz, o.cz - o.hz, o.cz + o.hz);
    if ((qx - lx) * (qx - lx) + (qz - lz) * (qz - lz) < (rad - 0.002) * (rad - 0.002)) return 'car:' + o.name;
  }
  toWorld(pose, lx, 0, lz, tmpW);
  const wx = tmpW.x, wz = tmpW.z, b = T.box;
  // phys 只认盒子：圆柱按外切的方块（半边 rad，朝车头摆正）查墙、货架、别的车 —— 正对车头的墙离圆柱正好 rad，斜角处偏保守
  b.cx = wx; b.cz = wz; b.hx = b.hz = rad; b.rot = num(pose.yaw, 0); b.minY = y0; b.maxY = y1;
  const P = BR.phys;
  if (has(P, 'overlapOBB')) { try { if (P.overlapOBB(b, { ignoreKey: T.ign, tol: 0.0005, skipBoxes: T.skip }) > 0) return 'solid'; } catch (err) { /* 当空的 */ } }
  else if (has(P, 'overlapCircle') && P.overlapCircle(wx, wz, rad, y0 + 0.01, Math.max(0.02, h - 0.02))) return 'solid';
  if (T.sideHit) {
    for (const e of T.side) {
      if (y1 <= Math.min(+e.minY, +e.maxY) + 0.002 || y0 >= Math.max(+e.minY, +e.maxY) - 0.002) continue;
      let hit = false;
      try { hit = T.sideHit(b, e); } catch (err) { hit = false; }
      if (hit) return 'side:' + (e.kind || '');
    }
  }
  for (const q of T.others) {
    if (q.id === skip || y1 <= q.y0 + 0.002 || y0 >= q.y1 - 0.002) continue;
    if ((q.x - wx) * (q.x - wx) + (q.z - wz) * (q.z - wz) < (rad + q.r) * (rad + q.r)) return 'item';
  }
  for (const m of T.movers) {
    if (m.id === skip) continue;
    pathAt(m.path, time == null ? Infinity : time, tmpP);
    if (y1 <= tmpP[1] + 0.002 || y0 >= tmpP[1] + m.h - 0.002) continue;
    if ((tmpP[0] - lx) * (tmpP[0] - lx) + (tmpP[2] - lz) * (tmpP[2] - lz) < (rad + m.r) * (rad + m.r)) return 'item';
  }
  return null;
}
// 落点 (lx, lz) 从 t0 起会不会被先甩出去、还在路上的那几件扫到（它们的轨迹不知道这一件会落在这里）
function moverAfter(T, lx, lz, y0, h, rad, t0, skip) {
  for (const m of T.movers) {
    if (m.id === skip) continue;
    const tEnd = m.path[m.path.length - 1][0];
    for (let t = Math.max(0, t0); ; t += 0.02) {
      const tt = Math.min(t, tEnd);
      pathAt(m.path, tt, tmpP);
      if (!(y0 + h <= tmpP[1] + 0.002 || y0 >= tmpP[1] + m.h - 0.002) &&
        (tmpP[0] - lx) * (tmpP[0] - lx) + (tmpP[2] - lz) * (tmpP[2] - lz) < (rad + m.r) * (rad + m.r)) return 'item';
      if (tt >= tEnd) break;
    }
  }
  return null;
}
// 落点压没压进斜放地牛那块老碰撞体（轴对齐 1 m 方块，人和准心照旧被它挡：落进去就捡不起来了）
function inSkip(T, lx, lz, y0, h, rad) {
  if (!T.skip) return false;
  toWorld(T.pose, lx, 0, lz, tmpW);
  for (const s of T.skip) {
    if (y0 + h <= s[1] + 0.002 || y0 >= s[4] - 0.002) continue;
    const qx = clamp(tmpW.x, s[0], s[3]), qz = clamp(tmpW.z, s[2], s[5]);
    if ((qx - tmpW.x) * (qx - tmpW.x) + (qz - tmpW.z) * (qz - tmpW.z) < rad * rad) return true;
  }
  return false;
}
// 沿参数 u（0 → 1）走一段，fn(u) → [lx, lz, y0]；动画里这一段从 t0 到 t1（time 跟着 u 线性走）。
// 返回第一个碰上之前、还空着的 u（二分到 1 mm 内）；整段都空返回 1
function throwSweep(T, fn, len, h, rad, id, t0, t1) {
  const n = Math.max(1, Math.ceil(len / THROW_STEP));
  const tm = u => t0 == null ? null : t0 + (t1 - t0) * u;
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const u = k / n, q = fn(u);
    const hit = throwHit(T, q[0], q[1], q[2], h, rad, id, tm(u));
    if (!hit) { prev = u; continue; }
    T.lastHit = hit;
    let lo = prev, hi = u;
    for (let i = 0; i < 6; i++) {
      const m = (lo + hi) / 2, w = fn(m);
      if (throwHit(T, w[0], w[1], w[2], h, rad, id, tm(m))) hi = m; else lo = m;
    }
    return lo;
  }
  return 1;
}
function landGround(T, lx, lz) {
  toWorld(T.pose, lx, 0, lz, tmpW);
  const py = num(T.pose.y, 0), g = groundAt(tmpW.x, tmpW.z, py);
  return fin(g) && Math.abs(g - py) <= THROW_LAND_DY ? g : null;
}
// 从高 yTop 竖直掉下去，圆心底下先接住它的面：地面、碰撞体顶面（墙脚、货、柱子；车的 OBB 不算 —— 车会开走）、
// 没有碰撞体的东西的顶面（sideObs：柱础、护角、地牛……）。返回高度 | null（坑、台阶，或者会落在车上）
const tinyBox = { cx: 0, cz: 0, hx: 0.005, hz: 0.005, rot: 0, minY: 0, maxY: 0 };
function topAt(T, lx, lz, yTop) {
  let g = landGround(T, lx, lz);
  if (g == null) return null;
  toWorld(T.pose, lx, 0, lz, tmpW);
  const wx = tmpW.x, wz = tmpW.z, P = BR.phys;
  if (has(P, 'raycast') && yTop > g + 0.01) {
    let hit = null;
    try { hit = P.raycast(wx, yTop, wz, 0, -1, 0, yTop - g + 0.005, { ignoreKey: T.ign, skipBoxes: T.skip }); } catch (err) { hit = null; }
    if (hit && fin(+hit.y) && hit.y > g + 0.005) {
      if (hit.obb || hit.y > yTop - 0.005) return null;
      g = +hit.y;
    }
  }
  if (T.sideHit) {
    tinyBox.cx = wx; tinyBox.cz = wz;
    for (const e of T.side) {
      const top = Math.max(+e.minY, +e.maxY);
      if (!(top > g + 0.005) || top > yTop + 0.002) continue;
      let on = false;
      try { on = T.sideHit(tinyBox, e); } catch (err) { on = false; }
      if (on) g = top;
    }
  }
  return g;
}
// 半径 rad 的东西从高 yTop 竖直掉到 (lx, lz)：圆心和它周围 0.35 rad 的四个点底下都是同一个面才算放得稳（落在柱础顶上要整个坐上去，
// 不能一半悬在边上）；不平（一半在柱础上、一半在地上）返回 NaN，下面空着 / 坑返回 null
function supportAt(T, lx, lz, yTop, rad) {
  const g0 = topAt(T, lx, lz, yTop);
  if (g0 == null) return null;
  const e = 0.35 * (rad || 0);
  if (e > 0) {
    for (const [dx, dz] of [[e, 0], [-e, 0], [0, e], [0, -e]]) {
      const g = topAt(T, lx + dx, lz + dz, yTop);
      if (g == null || Math.abs(g - g0) > 0.01) return NaN;
    }
  }
  return g0;
}
function fallTime(dy) { return Math.sqrt(2 * Math.max(0, dy) / FALL_G); }
// 一件的轨迹：返回 { lx, lz, y, path:[[t, lx, y, lz, mode]…], how }（车本地，mode 1 = 这一段竖直从静止往下掉、水平匀速）| null（留在叉上）
function throwOne(T, id, r, it, d) {
  const rad = itemFoot(it), h = itemTall(it), fr = footRaw(it);   // rad：查碰撞用的半径（模型半径 fr + 1.2 cm）
  const tip = T.tip, half = T.forkW / 2, lx0 = r.lx, lz0 = r.lz;
  const sg = lx0 < 0 ? -1 : 1;                                     // 这根货叉在车的哪一侧（往外 = sg）
  const s0 = T.surf + 0.003;                                       // 底面贴着叉面（离 3 mm，不算压着货叉）
  const yC = T.surf - 0.004;                                       // 翻下叉尖 / 叉沿以后：底面比叉面低 4 mm，水平已经整个离开货叉
  const zT = tip - THROW_TIP * fr;                                 // 圆心过了叉尖 0.3 个模型半径：开始往下翻
  const zC = tip - rad - 0.004;                                    // 整个离开叉尖（模型离叉尖 1.6 cm）
  const zL = tip - Math.max(d, rad + 0.03);                        // 落点（圆心）
  const gL = landGround(T, lx0, zL);
  const tB = gL == null ? 0.3 : fallTime(yC - gL);
  const vh = gL == null ? THROW_SLIDE_V : (zC - zL) / Math.max(0.05, tB);
  const vS = Math.max(THROW_SLIDE_V, vh);
  const why = [];   // 每一步为什么不行（调试 / 测试看：debugInfo().throws[i].how）
  let path = null, t = 0;
  const reset = () => { path = [[0, lx0, s0, lz0, 0]]; t = 0; };
  const last = () => path[path.length - 1];
  // 从现在这一点走一段到 (lx, y, lz)：mode 0 直线（贴着叉面滑）、mode 1 竖直从静止往下掉 + 水平匀速（和 stepFalls 同一套插值），用时 dt。
  // 每 2 cm 查一次（按动画里同一时刻）。整段都空着才记进 path，返回走到第几成（1 = 整段空着）；yMin：查的时候底面不低于它（落地那一下离地 3 mm 查）
  const seg = (lx, y, lz, mode, dt, yMin) => {
    const a = last(), ta = t, lo = yMin == null ? -Infinity : yMin;
    const len = Math.max(Math.hypot(lx - a[1], lz - a[3]), Math.abs(y - a[2]));
    const fn = u => [a[1] + (lx - a[1]) * u, a[3] + (lz - a[3]) * u, Math.max(lo, a[2] + (y - a[2]) * (mode ? u * u : u))];
    const u = len > 1e-4 ? throwSweep(T, fn, len, h, rad, id, ta, ta + dt) : 1;
    if (u >= 1) { t += dt; path.push([t, lx, y, lz, mode ? 1 : 0]); }
    return u;
  };
  // 一瞬间翻过叉尖 / 叉沿（不到一帧走的路，中间几个位置不会画出来）：只查翻过去那一点
  const jump = (lx, lz) => {
    const hit = throwHit(T, lx, lz, yC, h, rad, id, t);
    if (hit) { T.lastHit = hit; return false; }
    path.push([t, lx, yC, lz, 0]);
    return true;
  };
  // 从现在这一点往下掉到 cands 里的某个落点（车本地 [lx, lz, 记号]）：落点要放得稳、不进地牛老碰撞体、落地时不压东西、
  // 之后不会被先甩出去的那几件扫到；整条下落轨迹（往回落的斜线也一样）逐段查。返回记号 | null
  const fallTo = cands => {
    const a = last(), n0 = path.length, t0 = t;
    let first = null;
    for (const c of cands) {
      const g = supportAt(T, c[0], c[1], a[2], rad);
      let w = null;
      if (g == null || g > a[2] + 0.002) w = 'ground';
      else if (g !== g) w = 'edge';
      else if (inSkip(T, c[0], c[1], g, h, rad)) w = 'jack';
      else {
        const dt = fallTime(a[2] - g);
        w = throwHit(T, c[0], c[1], g + 0.003, h, rad, id, null) || moverAfter(T, c[0], c[1], g + 0.003, h, rad, t + dt, id);
        if (!w) {
          if (seg(c[0], g, c[1], 1, dt, g + 0.003) >= 1) return c[2];
          w = T.lastHit;
          path.length = n0; t = t0;
        }
      }
      if (!first) first = w;
    }
    T.lastHit = first;
    return null;
  };
  // 落点候选：正下方 / 往外挪（away：离货叉远的方向，每 2 cm 最多 10 cm）是第 0 档；往车这边挪（每 2 cm 最多 12 cm，够从柱础边上落下去；
  // 再远就像被往回拽了，r4 从 30 cm 收到 12 cm，挪不下就留在叉上）是第 1 档
  const near = (lx, lz, away) => {
    const A = [[lx, lz, '']];
    for (let k = 1; k <= 5; k++) A.push([lx + away * 0.02 * k, lz, '-wide']);
    return A;
  };
  const back = (lx, lz) => { const B = []; for (let k = 1; k <= THROW_BACK_N; k++) B.push([lx, lz + 0.02 * k, '-back']); return B; };
  const done = (how, extra) => { const e = last(); return { lx: e[1], lz: e[3], y: e[2], path, how: how + (extra && why.length ? ' (' + why.join(' ') + ')' : '') }; };

  // ① 往前：沿货叉滑到叉尖（圆心过叉尖 0.3 rad）
  reset();
  const lenA = Math.max(0, lz0 - zT);
  const uA = lenA > 1e-4 ? seg(lx0, s0, zT, 0, lenA / vS) : 1;
  const zS = lz0 - lenA * uA;                                      // A 段碰上了：停在叉面上这里（顶着它）
  let stop = null;                                                 // ② 碰上之后的那一截（往车这边挪的候选留到后面再试）
  if (uA < 1) why.push('A:' + T.lastHit);
  else if (gL == null) why.push('L:ground');
  else if (!jump(lx0, zC)) why.push('J:' + T.lastHit);
  else {
    // 抛物线（水平匀速、竖直从静止往下掉）落到叉尖前方 d
    const tC = t;
    const fnB = u => [lx0, zC + (zL - zC) * u, Math.max(gL + 0.003, yC - (yC - gL) * u * u)];
    const lenB = Math.hypot(zC - zL, yC - gL);
    const uB = throwSweep(T, fnB, lenB, h, rad, id, tC, tC + tB);
    if (uB >= 1) {
      // fallTo 从 C 点（抛物线起点）往下掉：竖直从静止、水平匀速，就是这条抛物线。落点放不稳（柱础边、地牛老碰撞体里）
      // 就近一点（每 3 cm）或者往外偏一点（每 2 cm）
      const got = fallTo([[lx0, zL, '']].concat(Array.from({ length: 8 }, (_, k) => [lx0, zL + 0.03 * (k + 1), '-near']).filter(c => c[1] < zC - 0.03),
        Array.from({ length: 5 }, (_, k) => [lx0 + sg * 0.02 * (k + 1), zL, '-wide'])));
      if (got != null) return done('fwd' + got, got !== '');
      why.push('L:' + T.lastHit);
    } else {
      why.push('B:' + T.lastHit);
      // ② 碰上了：在碰上之前停住，贴着它竖直掉下去（落在叉尖和它之间）
      const zK = zC + (zL - zC) * uB, yK = Math.max(gL, yC - (yC - gL) * uB * uB);
      t = tC + tB * uB;
      path.push([t, lx0, yK, zK, 1]);
      const got = fallTo(near(lx0, zK, sg));
      if (got != null) return done('stop' + got, got !== '');
      why.push('C:' + T.lastHit);
      stop = { path: path.slice(), t, lx: lx0, lz: zK };
    }
  }
  // ③ 往前落不下：从叉面上停住的地方横着滑下叉边（先外侧、再两叉中间），竖直掉下去。它一直在叉面上：不会先滑出叉尖再退回来
  const zSide = uA >= 1 ? Math.min(lz0, tip + rad + 0.005) : zS;  // A 段没碰上（是后面落不下）：滑到叉尖那头（还整个在叉面上）
  const sides = [];
  for (const tag of ['out', 'in']) {
    const inner = tag === 'in';
    const edge = sg * (inner ? T.tx - half : T.tx + half), dir = inner ? -sg : sg;   // 叉沿的车本地 x、往哪边滑下去
    const lxE = edge + dir * THROW_TIP * fr, lxC = edge + dir * (rad + 0.004), lxL = lxC + dir * THROW_DRIFT;
    if (inner && sg * lxL < 0.02) continue;                         // 两叉中间放不下
    reset();
    const lenF = Math.max(0, lz0 - zSide);
    if (lenF > 1e-4 && seg(lx0, s0, zSide, 0, lenF / vS) < 1) { why.push(tag + 'F:' + T.lastHit); continue; }
    if (seg(lxE, s0, zSide, 0, Math.abs(lxE - lx0) / THROW_SIDE_V) < 1) { why.push(tag + 'S:' + T.lastHit); continue; }
    if (!jump(lxC, zSide)) { why.push(tag + 'J:' + T.lastHit); continue; }
    const got = fallTo(near(lxL, zSide, dir));
    if (got != null) return done('side-' + tag + got, true);
    why.push(tag + 'D:' + T.lastHit);
    sides.push({ tag, path: path.slice(), t, lx: lxL, lz: zSide });
  }
  // 第 1 档：往车这边挪（磕到柱础边往回落），② 先、③ 后
  for (const s of (stop ? [Object.assign({ tag: null }, stop)] : []).concat(sides)) {
    path = s.path.slice(); t = s.t;
    const got = fallTo(back(s.lx, s.lz));
    if (got != null) return done(s.tag ? 'side-' + s.tag + got : 'stop' + got, true);
    why.push((s.tag || 'stop') + 'K:' + T.lastHit);
  }
  T.stay = why.join(' ');
  return null;
}
// 返回 [[id, x, y, z, path]…]（世界坐标；path = [[t, x, y, z, mode]…]，客机照着摆）。叉尖那头的先甩；留在叉上的不在里面
function computeThrow(veh, v0, pose) {
  const I = BR.items;
  if (!veh || !I || !has(I, 'find') || !veh.riders.size) return [];
  const d = clamp(THROW_D0 + (v0 - THROW_V) * (THROW_D1 - THROW_D0) / (4.5 - THROW_V), THROW_D0, THROW_D1);
  const T = throwScene(veh, pose);
  const rows = [];
  veh.riders.forEach((r, id) => { const it = I.find(id); if (it) rows.push([String(id), r, it]); });
  rows.sort((a, b) => a[1].lz - b[1].lz);
  const out = [];
  S.lastHow = [];
  const t0 = nowMs();
  for (const [id, r, it] of rows) {
    let res = null;
    T.stay = '';
    try { res = throwOne(T, id, r, it, d); } catch (err) { once('throw', () => console.error('[vehicles] 甩货轨迹出错', err)); res = null; }
    const rad = itemFoot(it), h = itemTall(it);
    S.lastHow.push([id, res ? res.how : 'stay (' + T.stay + ')']);
    if (!res) {
      // 留在叉上：后面的几件要绕开它
      toWorld(pose, r.lx, 0, r.lz, tmpW);
      T.others.push({ id, x: tmpW.x, z: tmpW.z, r: rad, y0: T.surf, y1: T.surf + h });
      continue;
    }
    // 甩出去的：后面的几件按同一时刻它在轨迹上的位置绕开它（落地以后就是落点）
    T.movers.push({ id, path: res.path, r: rad, h });
    toWorld(pose, res.lx, 0, res.lz, tmpW);
    const x = r4(tmpW.x), z = r4(tmpW.z);
    const path = res.path.map(p => { toWorld(pose, p[1], 0, p[3], tmpW); return [Math.round(p[0] * 1000) / 1000, r4(tmpW.x), r4(p[2]), r4(tmpW.z), p[4] ? 1 : 0]; });
    out.push([id, x, r4(res.y), z, path]);
  }
  S.lastThrowMs = nowMs() - t0;
  return out;
}
// 把甩出去的摆过去：从货叉上松开（不再跟车）、抓住，掉下去的过程由 stepFalls 逐帧照 path 摆，落地松手（单机、房主写 levelState）
function validPath(p) {
  if (!Array.isArray(p) || p.length < 2 || p.length > 8) return null;
  const out = [];
  let t0 = -1;
  for (const k of p) {
    if (!Array.isArray(k) || k.length < 4) return null;
    const t = +k[0], x = +k[1], y = +k[2], z = +k[3];
    if (!fin(t) || !fin(x) || !fin(y) || !fin(z) || t < t0 || t > 5) return null;
    out.push([t, x, y, z, k[4] ? 1 : 0]);
    t0 = t;
  }
  return out;
}
function applyThrow(veh, list) {
  const I = BR.items;
  if (!I || !has(I, 'find') || !Array.isArray(list)) return 0;
  let n = 0;
  for (const e of list.slice(0, 16)) {
    if (!Array.isArray(e) || e.length < 4) continue;
    const id = String(e[0]), x = +e[1], y = +e[2], z = +e[3];
    if (!fin(x) || !fin(y) || !fin(z)) continue;
    const it = I.find(id);
    if (!it || it.owner) continue;
    if (veh) veh.riders.delete(id);
    if (has(I, 'hold')) I.hold(id, true);
    it.still = true;   // 叉面上本来就是静止摆着的；落地以后也静静躺着
    let path = validPath(e[4]);
    if (path) {
      const f = path[path.length - 1];
      if (Math.abs(f[1] - x) > 0.01 || Math.abs(f[2] - y) > 0.01 || Math.abs(f[3] - z) > 0.01) path = null;
    }
    if (!path) {
      // 对方旧版只给落点：从现在的位置水平匀速、竖直往下掉过去
      const x0 = num(it.x, x), y0 = num(it.y, y), z0 = num(it.z, z);
      path = [[0, x0, y0, z0, 0], [clamp(fallTime(y0 - y), 0.15, 0.7), x, y, z, 1]];
    }
    S.falls = S.falls.filter(f => f.id !== id);
    S.falls.push({ id, path, t: 0 });
    // 马上摆到轨迹起点（撞停那一刻它在货叉上的位置）：这一帧车已经往前挪过，货叉上的东西不在这里摆一下会落后车一帧的路（返修 r4）
    if (has(I, 'move')) I.move(id, path[0][1], path[0][2], path[0][3]);
    n++;
  }
  if (veh) veh.riderSig = '';
  return n;
}
function stepFalls(dt, finish) {
  if (!S.falls.length) return;
  const I = BR.items;
  for (let i = S.falls.length - 1; i >= 0; i--) {
    const f = S.falls[i];
    const it = I && has(I, 'find') ? I.find(f.id) : null;
    if (!it) { S.falls.splice(i, 1); continue; }
    f.t += dt;
    const P = f.path, end = P[P.length - 1];
    if (!finish && f.t < end[0]) {
      let k = 1;
      while (k < P.length - 1 && P[k][0] <= f.t) k++;
      const a = P[k - 1], b = P[k], w = b[0] > a[0] ? clamp((f.t - a[0]) / (b[0] - a[0]), 0, 1) : 1;
      // mode 1：竖直从静止往下掉（w²）、水平匀速；mode 0：贴着叉面滑（直线）
      const y = b[4] ? a[2] + (b[2] - a[2]) * w * w : a[2] + (b[2] - a[2]) * w;
      I.move(f.id, a[1] + (b[1] - a[1]) * w, y, a[3] + (b[3] - a[3]) * w);
      continue;
    }
    it.still = true;   // 落在地上静静躺着（不浮动、不转圈，不会落地那一下往上弹）
    I.move(f.id, end[1], end[2], end[3]);
    if (has(I, 'hold')) I.hold(f.id, false);   // 松手：挪过就写进本层状态（丢弃物那张表；客机不写，等房主）
    const lv = lvNow();
    if (lv != null) { let set = S.lying.get(lv); if (!set) S.lying.set(lv, set = new Set()); set.add(f.id); }
    if (!finish) sfx('step', { x: end[1], y: end[2] + 0.1, z: end[3] }, { volume: 0.32, rate: 1.5 });
    S.falls.splice(i, 1);
  }
}
// 换层回来：items 按丢弃物把它们摆回去（浮着转圈），甩出去落地的那几件照旧静静躺着（'level:enter'，items 先摆）
function relayLying() {
  const lv = lvNow(), set = lv != null ? S.lying.get(lv) : null, I = BR.items;
  if (!set || !set.size || !I || !has(I, 'find')) return;
  for (const id of Array.from(set)) {
    const it = I.find(id);
    if (!it) { set.delete(id); continue; }   // 捡走了
    if (it.still || it.held || it.owner) continue;
    it.still = true;
    if (has(I, 'move')) I.move(id, it.x, it.y, it.z);
  }
}
function logThrow(key, v0, list, by) {
  // how：每件怎么落的（'fwd' 叉尖前方、'stop' 碰上东西贴着它落、'side-out' / 'side-in' 从叉边滑下去、'stay (…)' 留在叉上），只有本机算的才有
  S.throws.push({ key, v0: r4(v0), list: list.map(e => e.slice(0, 4)), at: r4(S.time), by, how: by !== 'host' && S.lastHow ? S.lastHow.slice() : null });
  S.lastHow = null;
  if (S.throws.length > 8) S.throws.shift();
}
function throwRiders(veh, v0) {
  const p = veh.pose;
  if (guest()) {
    const C = BR.coop;
    if (!C || !has(C, 'use')) return;
    const key = veh.key, e = eyeLocal();
    toWorld(p, e.x, e.y, e.z, tmpW);
    try {
      C.use('k:' + key, 'fkthrow', [tmpW.x, tmpW.y, tmpW.z], res => {
        if (!res || !res.ok || !res.r || !Array.isArray(res.r.list)) return;
        applyThrow(V.get(key) || null, res.r.list);
        logThrow(key, v0, res.r.list, 'host');
      }, { v0: r4(v0), x: r4(p.x), z: r4(p.z), yaw: r4(p.yaw), lift: r4(p.lift) });
    } catch (err) { once('throwuse', () => console.error('[vehicles] coop.use(fkthrow) 出错', err)); }
    return;
  }
  const list = computeThrow(veh, v0, p);
  if (!list.length) return;
  applyThrow(veh, list);
  logThrow(veh.key, v0, list, 'me');
  if (coopOn() && BR.coop && has(BR.coop, 'emit')) { try { BR.coop.emit('fkthrow', { k: veh.key, list }); } catch (err) { /* 对方旧版 */ } }
}
// 房主：客机司机全速撞车了。车位姿按客机报的（撞停那一刻）；离房主这边看到的超过 1.5 m 就按房主的
function onThrowUse(req) {
  const key = String((req && req.k) || '').replace(/^k:/, ''), veh = V.get(key);
  if (!veh) return { ok: false, why: 'gone' };
  const x = req.x && typeof req.x === 'object' ? req.x : {};
  let pose = veh.pose;
  if (fin(x.x) && fin(x.z) && fin(x.yaw) && Math.hypot(x.x - pose.x, x.z - pose.z) < 1.5) {
    pose = { x: x.x, z: x.z, y: veh.pose.y, yaw: x.yaw, lift: fin(x.lift) ? clamp(x.lift, 0, 1) : veh.pose.lift };
  }
  const v0 = clamp(num(+x.v0, THROW_V), THROW_V, 4.5);
  const list = computeThrow(veh, v0, pose);
  applyThrow(veh, list);
  logThrow(key, v0, list, 'peer');
  return { ok: true, r: { k: key, list } };
}
// 客机：房主（司机）撞车甩出去的，照房主算的落点摆
function onNetThrow(p) {
  if (!guest() || !p || typeof p !== 'object' || !Array.isArray(p.list)) return;
  const key = String(p.k || '').replace(/^k:/, '');
  applyThrow(V.get(key) || null, p.list);
  logThrow(key, 0, p.list.slice(0, 16), 'host');
}

// 压在车 OBB 里的地上物资：沿最近的边推到外面（单机、房主；客机等房主的 levelState）
function pushItemsOut(veh) {
  const I = BR.items;
  if (!I || !Array.isArray(I.list) || !has(I, 'move')) return;
  // BR.forklift.clearItems：同样把物资推出这组 OBB，推不出去（夹在车和墙之间）还会在车旁一圈圈找空地
  const F = BR.forklift;
  if (F && has(F, 'clearItems')) {
    try { F.clearItems(worldObbs(veh).slice(), { riders: veh.riders }); return; }
    catch (err) { once('clear', () => console.error('[vehicles] forklift.clearItems 出错', err)); }
  }
  const p = veh.pose, L = localObbs(veh);
  for (const it of I.list) {
    if (!it || it.owner || it.held || veh.riders.has(String(it.id))) continue;
    if ((it.x - p.x) * (it.x - p.x) + (it.z - p.z) * (it.z - p.z) > 12.25) continue;
    const r = Math.max(0.04, num(it.r, 0.1) * 0.8), y0 = num(it.y, 0), y1 = y0 + Math.max(0.05, 2 * num(it.hh, 0.1));
    toLocal(p, it.x, it.z, tmpL);
    let lx = tmpL.x, lz = tmpL.z, moved = false;
    for (let pass = 0; pass < 6; pass++) {
      let hit = null;
      for (const o of L) {
        const b0 = p.y + o.cy - o.hy, b1 = p.y + o.cy + o.hy;
        if (y1 <= b0 + 0.005 || y0 >= b1 - 0.005) continue;
        const qx = clamp(lx, o.cx - o.hx, o.cx + o.hx), qz = clamp(lz, o.cz - o.hz, o.cz + o.hz);
        if ((qx - lx) * (qx - lx) + (qz - lz) * (qz - lz) < r * r) { hit = o; break; }
      }
      if (!hit) break;
      // 四个方向里位移最小、推过去不撞墙的那个
      const cand = [
        [hit.cx - hit.hx - r - 0.01 - lx, 0], [hit.cx + hit.hx + r + 0.01 - lx, 0],
        [0, hit.cz - hit.hz - r - 0.01 - lz], [0, hit.cz + hit.hz + r + 0.01 - lz],
      ].sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
      let ok = false;
      for (const c of cand) {
        const nx = lx + c[0], nz = lz + c[1];
        toWorld(p, nx, 0, nz, tmpW);
        if (has(BR.phys, 'overlapCircle')) {
          // 墙、货架这些静态的挡住就换一边（车自己的 OBB 不算：下一轮循环再看）
          const blocked = BR.phys.overlapCircle(tmpW.x, tmpW.z, r, y0 + 0.02, Math.max(0.1, y1 - y0)) && !insideOwn(veh, L, nx, nz, r, y0, y1);
          if (blocked) continue;
        }
        lx = nx; lz = nz; ok = true; moved = true;
        break;
      }
      if (!ok) break;
    }
    if (!moved) continue;
    toWorld(p, lx, 0, lz, tmpW);
    if (has(I, 'hold')) I.hold(it.id, true);
    I.move(it.id, tmpW.x, it.still ? y0 : undefined, tmpW.z);
    if (has(I, 'hold')) I.hold(it.id, false);
  }
}
// 圆在不在这台车自己的某个 OBB 里（overlapCircle 撞到的是不是只有车自己）
function insideOwn(veh, L, lx, lz, r, y0, y1) {
  const p = veh.pose;
  for (const o of L) {
    const b0 = p.y + o.cy - o.hy, b1 = p.y + o.cy + o.hy;
    if (y1 <= b0 || y0 >= b1) continue;
    const qx = clamp(lx, o.cx - o.hx, o.cx + o.hx), qz = clamp(lz, o.cz - o.hz, o.cz + o.hz);
    if ((qx - lx) * (qx - lx) + (qz - lz) * (qz - lz) < r * r) return true;
  }
  return false;
}

// ---------- 声音、灯光 ----------
function loopStart(name, pos) {
  const A = BR.audio;
  if (!A || !has(A, 'loop')) return null;
  try { return A.loop(name, pos) || null; } catch (err) { once('loop:' + name, () => console.error('[vehicles] audio.loop 出错', name, err)); return null; }
}
function loopStop(k, fade) {
  const L = S.loops[k];
  if (!L) return;
  S.loops[k] = null;
  try { if (has(L, 'stop')) L.stop(fade == null ? 0.15 : fade); } catch (err) { /* 已经停了 */ }
}
function stopLoops() { loopStop('engine', 0.25); loopStop('hyd', 0.1); loopStop('rev', 0.05); }
function updateSound(veh) {
  const D = S.drive;
  if (!D || D.phase !== 'run' || !veh.pose.on) { stopLoops(); return; }
  const p = veh.pose, pos = { x: p.x, y: p.y + 1, z: p.z };
  if (!S.loops.engine) S.loops.engine = loopStart('fk_engine', pos);
  const E = S.loops.engine;
  if (E) {
    try {
      if (has(E, 'setPos')) E.setPos(pos.x, pos.y, pos.z);
      if (has(E, 'setRate')) E.setRate(0.8 + 0.8 * Math.min(1, Math.abs(p.spd) / 4.5));
    } catch (err) { /* 忽略 */ }
  }
  const lifting = veh.liftMoving;
  if (lifting && !S.loops.hyd) S.loops.hyd = loopStart('fk_hydraulic', pos);
  else if (!lifting) loopStop('hyd', 0.1);
  if (S.loops.hyd && has(S.loops.hyd, 'setPos')) { try { S.loops.hyd.setPos(pos.x, pos.y, pos.z); } catch (err) { /* 忽略 */ } }
  const rev = p.spd < -0.05;
  if (rev && !S.loops.rev) S.loops.rev = loopStart('fk_reverse', pos);
  else if (!rev) loopStop('rev', 0.05);
  if (S.loops.rev && has(S.loops.rev, 'setPos')) { try { S.loops.rev.setPos(pos.x, pos.y, pos.z); } catch (err) { /* 忽略 */ } }
}
// 前大灯：从 gfx 的 6 盏灯池借 1 盏（world.setExtraLights），位置每帧按 sim.lightSpot() 跟着走
function lightOn(veh) {
  if (!has(BR.world, 'setExtraLights')) return;
  const L = S.light || (S.light = Object.assign({ x: 0, y: 0, z: 0 }, headlight()));
  placeLight(veh, true);
  S.lightOwner = 'fk:' + veh.key;
  BR.world.setExtraLights(S.lightOwner, [L]);
}
function lightOff() {
  if (S.lightOwner && has(BR.world, 'setExtraLights')) BR.world.setExtraLights(S.lightOwner, null);
  S.lightOwner = null;
}
function placeLight(veh, init) {
  const L = S.light;
  if (!L) return;
  let s = null;
  if (veh.sim && has(veh.sim, 'lightSpot')) { try { s = veh.sim.lightSpot(); } catch (err) { s = null; } }
  if (s && fin(s.x) && fin(s.z)) {
    L.x = s.x; L.z = s.z; L.y = fin(s.y) ? s.y : veh.pose.y + 1;
    let dirty = false;
    for (const k of ['range', 'intensity', 'color', 'decay']) if (s[k] != null && s[k] !== L[k]) { L[k] = s[k]; dirty = true; }
    if (dirty && !init && S.lightOwner && has(BR.world, 'setExtraLights')) BR.world.setExtraLights(S.lightOwner, [L]);
    return;
  }
  // 没有模拟：车头前 3 m（3 m 内有墙就放在墙前 0.3 m），高 1.0 m
  const p = veh.pose, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  toWorld(p, 0, 1.0, -1.2, tmpW);
  let d = 3;
  if (has(BR.phys, 'raycast')) {
    const h = BR.phys.raycast(tmpW.x, tmpW.y, tmpW.z, fx, 0, fz, 3.3, { ignoreKey: physKeyOf(veh) });
    if (h && h.dist < 3.3) d = Math.max(0, h.dist - 0.3);
  }
  L.x = tmpW.x + fx * d; L.y = tmpW.y; L.z = tmpW.z + fz * d;
}

// ---------- levelState ----------
function writeLs(veh, on) {
  const L = BR.levelState;
  if (!L || !has(L, 'set') || !S.lv) return;
  const p = veh.pose;
  const v = { x: r4(p.x), z: r4(p.z), yaw: r4(p.yaw), steer: r4(p.steer), lift: r4(p.lift), on: on ? 1 : 0, carry: null, n: veh.n | 0, hl: p.hl === 0 ? 0 : 1 };
  try { L.set(S.lv, 'veh', veh.key, v); } catch (err) { console.error('[vehicles] levelState 写叉车出错', err); }
}

// ---------- 远端 / 回放：位姿从外面进来 ----------
// pose：{ x, z, y?, yaw, steer, lift, spd?, lever?, on?, n? }；remote = 队友在开（vehicles_net 插值后每帧调）
function setPose(key, pose, opts) {
  if (key == null || !pose || typeof pose !== 'object') return false;
  if (editing()) return false;
  ensureLevel();
  key = String(key).replace(/^k:/, '');
  const pk = parseKey(key);
  if (pk && S.lv != null && pk.lv !== S.lv) return false;   // 别的层的车（换层途中晚到的包）
  const remote = !!(opts && opts.remote);
  const fresh = !V.has(key);
  const veh = vehForPose(key, pose);
  if (veh.seat === 'me') return false;   // 本机坐着的车以本机模拟为准（远端位姿、levelState 回放都不理）
  const p = veh.pose, px = p.x, pz = p.z, pyaw = p.yaw, was = veh.driven;
  if (fin(pose.x)) p.x = pose.x;
  if (fin(pose.z)) p.z = pose.z;
  p.y = fin(pose.y) ? pose.y : groundAt(p.x, p.z, p.y);
  if (fin(pose.yaw)) p.yaw = pose.yaw;
  if (fin(pose.steer)) p.steer = pose.steer;
  if (fin(pose.lift)) p.lift = clamp(pose.lift, 0, 1);
  if (fin(pose.spd)) p.spd = pose.spd; else if (!remote) p.spd = 0;
  if (fin(pose.lever)) p.lever = pose.lever; else if (!remote) p.lever = 0;
  if (pose.on != null) p.on = pose.on ? 1 : 0;
  if (pose.hl === 0 || pose.hl === 1) p.hl = pose.hl;
  if (pose.n != null && !veh.n) veh.n = pose.n | 0;
  rollWheels(veh, px, pz, pyaw);
  if (remote) {
    veh.remoteAt = S.time;
    if (p.on || pose.driver === 'peer') veh.seat = 'peer';
    else if (veh.seat === 'peer') veh.seat = null;
  } else if (veh.seat === 'peer' && !p.on) veh.seat = null;
  promote(veh);
  registerObbs(veh);
  // 队友开的车的「影子模拟」（大灯落点、拨藤蔓、房主这边推开地上物资）归 vehicles_net（BR.forklift.byKey / create），这里不碰
  veh.sim = null;
  if (!veh.ent && wantMesh(veh)) S.layoutDirty = true;
  if (fresh || !was) S.riderScan = true;
  return true;
}

// ---------- 每帧（main.js tick 里排在 entities 之后） ----------
function update(dt) {
  dt = num(dt, 0);
  S.time += dt;
  // 工坊编辑态整体关闭（工坊没有事件，这里每帧看一眼）：坐着的先放下，登记全部清掉
  if (editing()) {
    if (S.seated) forceExit('force');
    if (V.size || S.lv != null) resetAll();
    return;
  }
  ensureLevel();
  if (!S.useReg && BR.coop && has(BR.coop, 'onUse')) { try { BR.coop.onUse('fkthrow', onThrowUse); S.useReg = true; } catch (err) { S.useReg = true; } }
  if (S.pendingGrab && nowMs() - S.pendingGrab.t0 > GRAB_WAIT_MS) {
    const tok = S.pendingGrab;
    tok.done = true;
    S.pendingGrab = null;
    if (BR.coop && has(BR.coop, 'release')) { try { BR.coop.release('k:' + tok.key); } catch (err) { /* 忽略 */ } }
    toast(T.retry, 1800);
  }
  const D = S.drive;
  const dv = D && V.get(D.key);
  if (D && dv && D.exit && D.exit.ready) doExit(dv);
  if (quality() !== S.quality) { S.quality = quality(); S.layoutDirty = true; }
  S.rangeT -= dt;
  if (S.rangeT <= 0) {
    S.rangeT = RANGE_EVERY;
    V.forEach(veh => {
      if (!!wantMesh(veh) !== !!veh.ent) S.layoutDirty = true;
      if (!!wantOil(veh) !== !!veh.oilEnt) S.layoutDirty = true;
    });
  }
  if (S.pushQ.size) {
    if (!guest()) for (const k of S.pushQ) { const veh = V.get(k); if (veh) pushItemsOut(veh); }
    S.pushQ.clear();
  }
  if (S.riderScan) scanRiders();
  V.forEach(veh => {
    const moving = Math.abs(veh.pose.lift - veh.lastLift) > 1e-5;
    veh.liftMoving = moving;
    veh.lastLift = veh.pose.lift;
  });
  updateRiders();
  stepFalls(dt);
  if (S.layoutDirty) layout();
  else refreshMesh();
  const sv = S.seated && V.get(S.seated);
  if (sv) {
    updateSound(sv);
    if (S.lightOwner) placeLight(sv, false);
  }
  syncSwitchLabel();
  const scene = sceneOf();
  if (scene) for (const g of SH.values()) if (g.mesh && g.nv && g.mesh.parent !== scene) scene.add(g.mesh);
}

// ---------- 生命周期 ----------
function resetAll() {
  if (S.seated) clearSeat();
  S.falls.length = 0;
  V.forEach(veh => removeObbs(veh));
  V.clear();
  S.pendingGrab = null;
  S.pushQ.clear();
  S.ents = [];
  S.lv = null;
  S.out = null;
  for (const g of SH.values()) {
    g.nv = 0; g.ni = 0;
    if (g.geo) g.geo.setDrawRange(0, 0);
    if (g.mesh) g.mesh.visible = false;
  }
}
function clear() {
  const P = BR.player;
  if (S.seated && P && P.mounted === handle && has(P, 'unmount')) {
    S.out = { key: S.seated, x: P.x, z: P.z, side: 'free' };
    try { P.unmount('home'); } catch (err) { /* 忽略 */ }
  }
  resetAll();
}
function onNewSession() {
  clear();
  S.liftWarned = false;
  S.lying.clear();
  modelCache.clear();
}
function onLeave() {
  if (S.seated) forceExit('level');
  stepFalls(0, true);   // 正在往下掉的瓶罐直接落地（落点写进这一层的状态）
  resetAll();
}
function onDeath() { if (S.seated) forceExit('death'); }
function onPause(p) {
  // 单机暂停：世界停了，循环声跟着停（继续后按状态重新开）；联机暂停不停世界
  if (p && p.paused && !coopOn()) stopLoops();
}
function onPeerPose(v) {
  const prev = S.peerPose;
  S.peerPose = v && typeof v === 'object' ? { mode: v.mode != null ? String(v.mode) : null, key: v.key != null ? String(v.key).replace(/^k:/, '') : null } : null;
  if (prev && prev.mode === 'drive' && prev.key && (!S.peerPose || S.peerPose.key !== prev.key)) {
    const veh = V.get(prev.key);
    if (veh && veh.seat === 'peer') veh.seat = null;
  }
  if (S.peerPose && S.peerPose.mode === 'drive' && S.peerPose.key) {
    const veh = V.get(S.peerPose.key);
    if (veh && veh.seat !== 'me') veh.seat = 'peer';
  }
}

// ---------- 调试 / 测试 ----------
function list() {
  const out = [];
  V.forEach(veh => {
    const p = veh.pose;
    out.push({ key: veh.key, x: p.x, z: p.z, y: p.y, yaw: p.yaw, steer: p.steer, lift: p.lift, spd: p.spd, lever: p.lever, on: p.on,
      driven: veh.driven, meshed: !!veh.ent, seat: veh.seat, tier: veh.ent ? veh.ent.info.tier : null, n: veh.n, runtime: veh.runtime,
      physKey: veh.obbKey || physKeyOf(veh), hl: p.hl === 0 ? 0 : 1 });
  });
  return out;
}
function byKey(key) { return V.get(String(key)) || null; }
function debugInfo() {
  const promoted = [], tiers = {}, lease = {}, riders = {};
  let obbs = 0;
  V.forEach(veh => {
    if (veh.ent) { promoted.push(veh.key); tiers[veh.key] = veh.ent.info.tier; }
    if (veh.riders.size) riders[veh.key] = Array.from(veh.riders.keys());
    obbs += veh.obbN || 0;
    const C = BR.coop;
    if (C && C.active && has(C, 'leaseOf')) { try { lease[veh.key] = C.leaseOf('k:' + veh.key); } catch (err) { /* 忽略 */ } }
  });
  let meshes = 0, calls = 0, tris = 0, live = 0;
  for (const g of SH.values()) {
    if (!g.mesh) continue;
    meshes++;
    if (g.mesh.visible && g.ni > 0 && g.mesh.parent) { calls++; tris += g.ni / 3; }
  }
  const per = {};
  for (const e of S.ents || []) {
    let t = 0;
    for (const mk in e.mats) { const d = e.mats[mk]; t += (d.chain ? d.ni - (d.chain.icap - d.chain.ni) : d.ni) / 3; }
    if (e.kind === 'veh') { per[e.veh.key] = Math.round(t); live += t; } else live += t;
  }
  const D = S.drive;
  return {
    level: S.lv, count: V.size, promoted, meshes, calls, tris: Math.round(live), slotTris: Math.round(tris), perVehicle: per, tiers, lease, riders, obbs,
    seated: S.seated, phase: D ? D.phase : null, exiting: !!(D && D.exit), pendingGrab: S.pendingGrab ? S.pendingGrab.key : null,
    light: S.lightOwner, loops: { engine: !!S.loops.engine, hyd: !!S.loops.hyd, rev: !!S.loops.rev },
    capacity: Array.from(SH.values()).map(g => ({ mat: g.mk, cap: g.cap, icap: g.icap, nv: g.nv, ni: g.ni })),
    cpuMs: S.cpuN ? S.cpuMs / S.cpuN : 0,
    lit: seatLit(), btnLabel: S.btnLabel, falls: S.falls.length, throws: S.throws.map(t => Object.assign({}, t)), throwMs: S.lastThrowMs || 0,
    vehicles: list(),
  };
}
// 大灯开关在世界里的位置（底板中心，离斜面 8 mm）和开关状态：测试 / 截图对准它用
function lightSwitch(key) {
  const veh = V.get(String(key != null ? key : S.seated));
  if (!veh) return null;
  toWorld(veh.pose, SW_PIVOT[0], SW_PIVOT[1], SW_PIVOT[2], tmpW);
  return { x: tmpW.x, y: tmpW.y, z: tmpW.z, hl: veh.pose.hl === 0 ? 0 : 1, lit: veh.key === S.seated ? seatLit() : !!(veh.pose.on && veh.pose.hl !== 0) };
}
// 测试口：直接给模拟一步输入（不走 BR.input、不管起动阶段），再把网格、riders 更新到位。返回位姿
function _step(dt, inp, key) {
  const k = key != null ? String(key) : S.seated;
  const veh = k && V.get(k);
  if (!veh) return null;
  promote(veh);   // 没人坐着也要动它（测试）：先升格，区块网格里那台藏掉、改用载具网格
  if (!veh.sim) veh.sim = createSim(veh);
  const t0 = nowMs();
  const D = S.seated === veh.key ? S.drive : null;
  stepSim(veh, num(dt, 1 / 60), inp ? fillInput(inp) : null, D);
  veh.liftMoving = Math.abs(veh.pose.lift - veh.lastLift) > 1e-5;
  veh.lastLift = veh.pose.lift;
  updateRiders();
  if (S.layoutDirty) layout(); else refreshMesh();
  S.cpuMs += nowMs() - t0; S.cpuN++;
  return Object.assign({}, veh.pose);
}

// ---------- 注册 ----------
if (BR.interact && has(BR.interact, 'addSource')) {
  BR.interact.addSource('vehicles', vehSource);
  if (has(BR.interact, 'handle')) BR.interact.handle('vehicle', { short: c => mount(c && c.key) });
}
if (BR.bus) {
  BR.bus.on('game:start', onNewSession);
  BR.bus.on('game:home', onNewSession);
  BR.bus.on('level:leave', onLeave);
  BR.bus.on('level:enter', () => { S.riderScan = true; S.rangeT = 0; relayLying(); });
  BR.bus.on('player:death', onDeath);
  BR.bus.on('game:pause', onPause);
  BR.bus.on('net:pose', onPeerPose);
  BR.bus.on('net:fkthrow', onNetThrow);
}

BR.vehicles = {
  list, byKey, mount, dismount, forceExit, cabFor, chestOf, seatWorld, dropSurface, attachItem, setPose,
  update, applyChunk, unloadChunk, clear, debugInfo, _step,
  lightSwitch, toggleLight,
  headlightLit: seatLit,   // 本机坐着的车大灯正亮着（L1 断电提示用）
  get seated() { return S.seated; },
  get handle() { return handle; },
};
})();
