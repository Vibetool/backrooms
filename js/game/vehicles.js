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
//   运行时车（data.runtime：出生保底车、L1 正常生成时出生块里的所有车（返修 FE1Q · J2，例如种子 12345 的 1@0,0#v0）、一块里按 lowb 都放不下的车
//   （返修 FE1Q · repair-r3，工坊和非工坊一样；以前非工坊用只剩轮廓的 min 档停着）。两端画质不同时同一台车可能一边是运行时车、一边在区块里，各画各的）
//   不进区块几何：一载入就直接用载具网格画（高画质 mid、低画质 drvLow），停着和开过是同一个网格；油渍作为不随车动的一段。
// 细节档（keyDecisions[1]）：BR.L1forklift.driveTier(画质, 停放档)；本机没建过原区块的车按 mid（低画质 drvLow），磨损片数按 mid。
// 碰撞（keyDecisions[2]）：14 个部件 OBB（geo.obbs(lift)）。停着的车 'cx,cz#v<i>#<部件>'（区块卸载时一起摘），开过的车 'veh|<key>#<部件>'。
// 共用载具网格（keyDecisions[4]）：kit:prop / kit:glow / kit:decal 各一个网格（低画质没有贴花），不挂区块 group，共用 kit 材质；
//   每台车按部件建一次（临时 kit.builder + 前后 mark 量顶点段），每帧在 CPU 上按 pose 变换顶点、只上传动过的那几段（updateRange）：
//   车身不动；前轮绕轮轴滚；左右后轮绕各自主销转 steer 再滚；方向盘绕倾斜轴转 −steer × steerRatio（司机看来逆时针 = 往左打）；
//   内门架升 d，货叉架升 2d；链条按 lift 重建（预留最大顶点数，多出来的叠成一点）；升降杆绕 geo.liftLever 转 lever。
//   熄火时 glow 里这台车那段的顶点色换成灯罩本色 × 0.35，着车时大灯 × 1.7、警示灯 × 1.5 并 1 Hz 闪。
// 货叉上的物资（keyDecisions[5]）：dropSurface / attachItem；车或货叉在动时 riders 用 items.hold + move 跟着走，停稳一帧后松手一次写 levelState。
//   叉面高过 1.4 m 时，对准叉面上的物资只给灰字「货叉举得太高，够不着」（压一个同 id、近 3 cm 的候选，items.js 不用改）。
//   放上货叉时重心（模型包围盒中心）一定落在这根货叉的叉面那一条里（attachItem → centerOnTine，返修 r10），按放得稳的静止姿态摆（items.rest，返修 r12 裁定 B：
//   PTG-B 往针头那边歪约 7°、指托和针帽一起着地），叉面上的支撑点围成的凸包要把质心包在里面往里 ≥3 mm，不行、或者横着伸出叉沿超过 2 cm，
//   就绕竖直轴转到满足的朝向里横着伸出叉沿最少的（attachItem → orientOnTine，返修 r11 / r12 / r13）。
//   全速撞车（家长定的规则；FE1 返修 r10 主会话简化重做）：「哐」而且撞前车速 ≥2 m/s、往前开时，每根货叉上的东西是一排，同时顺着货叉往前平移
//   （水平同速、相对位置不变、不转向；没被挡住时初速 = 撞前车速，返修 r12 裁定 A），往前的支撑过了叉尖的一直靠着货叉往前栽下去、碰不着货叉以后按重力落到地上回正
//   （返修 r12 裁定 C），接着跟整排一起滑、一起停：最靠车那件静止时离叉尖至少 0.2–0.5 m（L(v)，车越快滑得越远），地上的摆法 = 叉上的摆法整体往前平移。
//   前面有东西挡着（墙、柱子、货、地上已有的物资）就把这一排缩短到刚好不碰，往前的支撑没过叉尖的留在叉上（叉尖顶着墙时全部留下）。整排停下以前车锁住。
//   落地静静躺着，朝向记进丢弃物那条（返修 r12 裁定 D）。规则全文见 computeThrow 上面。
//   联机以房主为准：房主（单机）司机本机算、摆、写，再 coop.emit('fkthrow', { k, list, id, p, v0 }) 让客机照摆；客机司机 coop.use('k:'+车, 'fkthrow')
//   请房主按房主那边货叉上的东西算，房主摆好、写好状态，回复和广播（同一个 id）客机谁先到用谁，晚到也照摆。
//   id = 'h' + 房主页面载入时随机生成的一串 + ':' + 序号（房主刷新页面以后不会和以前的撞号；客机记着的编号开新局、回主页、联机连上时清空，返修 r11）。
// 仪表台大灯开关（FE1 返修 r2，家长定的规则）：pose.hl（1 开 / 0 关，出厂开着），在载具网格里画一个开关（底板 + 拨杆 + 绿色指示灯）；
//   区块里停着的 high / mid / lite 档也画同一个（FE1P H3：L1.js fkDashSwitch，拨杆扳在「开」、指示灯熄着，常量 FK_SW 和这里的 SW_* 逐个一样，
//   tests/forklift_l1.mjs polish H3 拿 _switchGeo 逐个三角形比对）。坐在车上准心对准它短按空格开 / 关（drive 情境只认这台车的开关，不加新键）；着车时大灯跟着开关，
//   关掉就撤掉灯池那一盏、灯罩和指示灯熄灭（world.lightAt 不再把司机算成被照亮）；手机上准心对着开关时「下车」键临时写成「开大灯 / 关大灯」，
//   移开恢复「下车」。开关状态写进 levelState.vehicles.hl（离开再回来保留），联机经 coop.hand 的第 10 个值同步（vehicles_net）。
//
// 接口（BR.vehicles）：
//   list() → [{ key, x, z, y, yaw, steer, lift, spd, lever, on, driven, meshed, seat, tier, n, runtime, physKey }]   byKey(key) → 内部记录（只读，pose 在 .pose）
//   seated（本机坐着的车 key | null）、handle（交给 player.mount 的那个对象）、mount(key) → bool、dismount(side?) → bool、forceExit(reason)
//   cabFor(playerLike) → { cx, cz, hx, hz, rot, minY, maxY, key, yaw, x, z } | null（世界坐标的驾驶舱矩形，phys OBB 写法）
//   chestOf(playerLike) → { x, y, z } | null   seatWorld(key) → { x, y, z, yaw } | null（坐垫顶面中心）
//   dropSurface(x, z, r, type?) → { y: 原点摆在多高（放得稳的静止姿态的最低顶点贴着叉面：−items.rest(type).bot，PTG-B 针筒原点在最低顶点上方 5.1 mm，返修 r12）, veh: 车 key, tine: 0 左 | 1 右, side, x, z（摆到那根货叉中线上；这根货叉上已经有东西就挪到最近的空位，
//     离瞄准点最多挪 15 cm） } | { full: true, veh, tine, side, y, gx?, gy?, gz? }（瞄准点附近 15 cm 内放不下；gx/gy/gz = 这根货叉旁边一块空地，
//     没有就不给） | null   attachItem(id, veh, keep?) → bool（keep：不转朝向、不挪，撞车甩货里留在叉上的件挂回去时用）
//   setPose(key, pose, { remote }) → bool：pose = { x, z, y?, yaw, steer, lift, spd?, lever?, on?, n? }。remote = 队友在开（vehicles_net 插值后每帧调），
//     会顺手升格、挪 'veh|' OBB（影子模拟、大灯、远端音效、推开物资归 vehicles_net）。
//     不带 remote = levelState 回放（没人开着的车按记录摆好）。本机正坐着的车一律不理（以本机模拟为准）；别的层的 key 不理
//   update(dt)（main.js 每帧，排在 entities 之后）   applyChunk(c, st) / unloadChunk(c)（world 建块 / 卸块时调）   clear()
//   debugInfo() → { promoted, meshes, calls, tris, perVehicle, tiers, lease, riders, obbs, seated, phase, light, loops, capacity, lit, btnLabel,
//                   falls, throws（最近 256 次：{ key, v0, list, at, by, id（联机时这次甩货的编号 'h<页面载入时的随机串>:<序号>'，单机 null）, how,
//                   dur 最后一件落地 / 停下的时刻, off 车锁了多久 = 最晚停下那一排的 Tr }）,
//                   throwMs（最近一次算甩货用了多少毫秒）, throwBusy（撞车后锁着的车）, vehicles, … }
//   _benchThrow(key, v0, n)：测试口（只读），按这台车此刻货叉上的东西把甩货计划算 n 次，返回 { median, all }（毫秒）
//   _planThrow(key, v0)：测试口（只读，返修 r12），按这台车此刻货叉上的东西算一次甩货，返回 { list: [[id, x, y, z, path]…], how }（不摆、不记）
//   footOf(item) → 模型离竖直转轴最远的水平距离；footPoly(item) → { pts（世界坐标水平凸包 [x, z, …]）, y0, y1, lift } | null（forklift.js 推地上物资用）
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
//   听 'net:fkthrow'（房主算好的甩货轨迹，按 id 只摆一次），coop.onUse('fkthrow')（房主替客机司机算）
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
  // 撞车甩出去的那几排还没停下时按油门、方向、升降：车和货叉先不动（返修 r6）。这次有东西翻下叉尖（'fwd'）说 falling；
  // 一件都没掉（都留在叉上、整排往前挪了一段）而且还要锁 0.2 s 以上说 sliding，锁得更短不说（返修 r11：叉尖顶墙时一件没掉却闪出「还在往下掉」）
  falling: '货叉上的东西还在往下掉',
  sliding: '货叉上的东西还在往前滑',
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
// 载具网格里画（开过的车、保底车）；区块里停着的 high / mid / lite 档由 L1.js fkDashSwitch 画同一份（FE1P H3，主会话裁定：停着的车也有开关，
// 拨杆扳在出厂的「开」、指示灯熄着，上车发动以后换成这里画的、指示灯跟大灯一起亮）。改这里的位置、大小、颜色必须同步 L1.js 的 FK_SW ——
// tests/forklift_l1.mjs polish H3 用 _switchGeo 和 BR.L1forklift.dashSwitch 逐个三角形比对。位置在仪表台斜面左半边（方向盘左下方，
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
// ---- 全速撞车掉货（家长定的规则）----
// 撞上（「哐」）而且撞前车速 ≥2 m/s、往前开：货叉上的东西整排往前滑，最靠车那件落在叉尖前方 0.2–0.5 m（车速 2 → 0.2、3.9 及以上 → 0.5），写进本层状态；
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
  falls: [],                  // 撞车甩出去、正在走的东西 [{ id, path:[[t, x, y, z, mode]…], t, veh, tOff（这一排停下的时刻）, onFork }]（见 computeThrow）
  throws: [],                 // 最近 256 次甩货（调试 / 测试看）：[{ key, v0, list, at, by, how, dur, off }]
  throwSeq: 0,                // 房主算的甩货序号
  // 甩货编号 'h' + 这一页载入时随机生成的一串 + ':' + 序号（客机按它只摆一次）。返修 r11：以前只有 'h' + 序号，房主刷新页面以后从 h1 重新数，
  // 客机记着的旧编号又不清，房主前几次撞车的结果会被客机当成摆过的丢掉、两边永久不一致
  throwTok: Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7),
  seenThrows: new Set(),      // 客机：摆过的甩货编号（开新局、回主页、联机连上时清空）
  lying: new Map(),           // 层 → 甩出去落地、静静躺着的物资 id（换层回来 items 照丢弃物摆回去是浮着的，这里再让它躺下；本局有效）
  useReg: false,
  inFrame: false,             // 正在跑 player.update 里本机司机这一帧的模拟（driveUpdate）
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
function r6(v) { return Math.round(v * 1e6) / 1e6; }
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
function boxTN(b, c, hx, ht, hn, col, noBottom, noTop) {
  const X = SW_AX, T3 = SW_T, N3 = SW_N;
  quadC(b, 'kit:prop', v3(c, X, hx), sc(T3, ht), sc(N3, hn), col);    // +X（T × N = X）
  quadC(b, 'kit:prop', v3(c, X, -hx), sc(N3, hn), sc(T3, ht), col);   // −X
  quadC(b, 'kit:prop', v3(c, T3, ht), sc(N3, hn), sc(X, hx), col);    // +T（N × X = T）
  quadC(b, 'kit:prop', v3(c, T3, -ht), sc(X, hx), sc(N3, hn), col);   // −T
  if (!noTop) quadC(b, 'kit:prop', v3(c, N3, hn), sc(X, hx), sc(T3, ht), col);    // +N（X × T = N）
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
  boxTN(b, v3(SW_PIVOT, N3, L / 2), 0.0045, 0.0045, L / 2, SW_COL.bat, true, true);   // 拨杆顶面插在杆头里看不见，不画（FE1Q · J10 腾面；L1.js fkDashSwitch 同一份）
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
  // 撞车甩出去的那几排还没停下：货叉先不动，车的行驶、转向也锁住（车停着不动，像撞懵了一下）。
  // 轨迹是按撞上那一刻的车位姿、叉面算的（世界坐标），这时按住 R / C 叉面会升起来穿过它、或者降下去让它悬在半空；
  // 倒车、打方向开走的话货叉退开了，它还停在原来的叉面高度上悬着。整排停下（Tr，最多 1.6 s）立刻解锁；按了油门 / 方向 / 升降就提示一句。
  // 方向锁住 = 后轮停在撞上那一刻的角度（不跟着按 A / D 转，也不自己回正）：转向输入换成「打到现在这个角度」
  if (inp && throwBusy(veh)) {
    const ms = Math.max(0.1, num(gv('maxSteer'), 1.13));
    const want = Math.abs(num(inp.throttle, 0)) > 0.05 || Math.abs(num(inp.steer, 0)) > 0.05 || !!inp.lift ||
      (inp.move && (Math.abs(num(inp.move.y, 0)) > 0.05 || Math.abs(num(inp.move.x, 0)) > 0.05));
    inp.throttle = 0; inp.lift = 0; inp.brake = 1;
    inp.steer = clamp(-num(veh.pose.steer, 0) / ms, -1, 1);
    if (inp.move) { inp.move.y = 0; inp.move.x = 0; }
    if (inp.liftUp) inp.liftUp = false;
    if (inp.liftDown) inp.liftDown = false;
    // 「还在往前滑」只显示到快要解锁（剩下的锁车时间 + 0.4 s，0.6–1.2 s），别在东西早停下以后还挂着
    if (want && D) { const t = busyNote(veh); if (t) note(t, t === T.sliding ? clamp(Math.round(busyNote.rest * 1000) + 400, 600, 1200) : 1200); }
  }
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
    // rem：这一步里撞上以后还剩多少时间（车这一步走的路比按撞前车速该走的少多少），东西这一帧接着滑这么久（见 applyThrow 的 fresh）
    if (bang && v0 >= THROW_V && veh.riders.size) {
      const moved = Math.hypot(veh.pose.x - px, veh.pose.z - pz), want = Math.abs(v0) * dt;
      throwRiders(veh, v0, want > 1e-6 ? clamp(dt * (1 - moved / want), 0, dt) : 0);
    }
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
  // inFrame：这一步是 player.update 里本机司机的模拟，同一帧后面 vehicles.update 还会 stepFalls(dt) —— 这一步撞上新甩出去的件这一帧不再前进（见 applyThrow 的 fresh）
  S.inFrame = true;
  try { stepSim(veh, dt, use, D); } finally { S.inFrame = false; }
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
// 但离瞄准点（沿货叉）最多挪 15 cm（返修 r5 裁定 ③：不许把东西挪到远处的叉根，看着像瞬移）；
// 15 cm 以内放不下返回 { full: true, veh, tine, y, room, gx, gy, gz }：gx/gz/gy 是这根货叉旁边、瞄准点附近一块空着的地面
// （东西落在那里）；旁边也没有空地就不给 gx（东西留在手里）。room（返修 r6）：这根货叉上离瞄准点更远的地方还有空位时，
// 空位在瞄准点的哪一头 —— 'heel'（往车那边）| 'tip'（往叉尖那边），player 提示「这一段叉面满了，东西放到旁边地上了，叉尖那头还空着 /
// 靠车那头还空着」；整根货叉都摆满了不给 room，提示「这根货叉摆满了，…」（返修 r6 裁定 ⑤：只在真的放不下时才说放不下）。
// type：要丢的那件的类型（量它的水平半径）
const FORK_GAP = 0.01, FORK_END_GAP = 0.02, FORK_SHIFT = 0.15;
// 沿货叉离 z0 最近的空位（离瞄准点 zAim 最多 shift，缺省 15 cm）| null
function freeSpot(z0, lo, hi, busy, zAim, shift) {
  const lim = shift == null ? FORK_SHIFT : shift;
  const free = z => z >= lo - 1e-9 && z <= hi + 1e-9 && Math.abs(z - zAim) <= lim + 1e-9 && busy.every(b => Math.abs(z - b[0]) >= b[1] - 1e-9);
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
      // 整件在叉面上，离叉尖、叉根再留 2 cm（不悬在叉尖边上）
      const half = Math.min(fr + FORK_END_GAP, (fz[1] - fz[0]) / 2);
      const lo = fz[0] + half, hi = fz[1] - half;
      // 这根货叉上已经放着的：[lz, 两件中心至少要隔多远]
      const busy = [];
      veh.riders.forEach((rd, id) => {
        if (Math.abs(rd.lx - tx[t]) >= FORK_TOL) return;
        const it = I && has(I, 'find') ? I.find(id) : null;
        busy.push([rd.lz, (it ? footRaw(it) : 0.06) + fr + FORK_GAP]);
      });
      const lz = freeSpot(clamp(wz, lo, hi), lo, hi, busy, wz);
      bd = d;
      if (lz == null) {
        best = { full: true, y, veh: veh.key, tine: t, side: t === 0 ? 'left' : 'right' };
        // 这根货叉上别处还有空位（瞄准点附近 15 cm 摆满了，叉上别的地方还空着）：告诉 player 往哪头丢
        const far = freeSpot(clamp(wz, lo, hi), lo, hi, busy, wz, Infinity);
        if (far != null) best.room = far > wz ? 'heel' : 'tip';
        const gs = groundBeside(veh, t, tmpL.x, wz, fr, type);
        if (gs) Object.assign(best, gs);
        continue;
      }
      toWorld(p, tx[t], 0, lz, tmpW);
      // y：这件的原点摆在多高 —— 放得稳的静止姿态的最低顶点贴着叉面（−items.rest(type).bot；PTG-B 针筒原点在最低顶点上方 5.1 mm，返修 r12 裁定 B）
      best = { y: y + (type != null ? liftOfType(type) : 0), veh: veh.key, tine: t, side: t === 0 ? 'left' : 'right', x: tmpW.x, z: tmpW.z };
    }
  });
  return best;
}
// 货叉上放不下时：这根货叉旁边（叉沿外再空 2.5 cm）、瞄准点附近（沿货叉 ±15 cm 以内，先瞄准点那一边）一块空着的地面 → { gx, gy, gz } | null。
// 空着：地面和车所在地面差不多高、不压墙货架和车的盒子（phys）、不压 sideObs、离地上别的物资至少 1 cm
function groundBeside(veh, t, aimLx, aimLz, fr, type) {
  const p = veh.pose, P = BR.phys, I = BR.items, G = BR.forklift && BR.forklift._geom;
  if (!has(P, 'overlapCircle')) return null;
  let hh = 0.06;
  try { const inf = I && has(I, 'info') && type != null ? I.info(type) : null; if (inf) hh = num(inf.hh, 0.06); } catch (err) { /* 按 6 cm */ }
  const h = Math.max(0.05, 2 * hh), txt = tineX()[t], halfW = num(gv('forkW'), 0.1) / 2, fz = forkZ();
  const out = Math.sign(txt) || 1, near = Math.abs(aimLx) >= Math.abs(txt) - 0.005 ? out : -out;   // 瞄准点在货叉中线或外侧就先放外侧
  const side = sideNear(p.x, p.z, 4);
  const box = { cx: 0, cz: 0, hx: fr, hz: fr, rot: num(p.yaw, 0), minY: 0, maxY: 0 };
  for (const dz of [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09, 0.12, -0.12, 0.15, -0.15]) {
    const lz = aimLz + dz;
    if (lz < fz[0] - 0.02 || lz > fz[1] + 0.02) continue;
    for (const sd of [near, -near]) {
      const lx = txt + sd * (halfW + fr + 0.025);   // 离叉沿 2.5 cm：斜着看（包围盒）也不像压在货叉底下
      if (sd === -out && Math.abs(lx) < 0.02 + fr) continue;   // 两叉中间放不下（不过中线）
      toWorld(p, lx, 0, lz, tmpW);
      const wx = tmpW.x, wz = tmpW.z, g = groundAt(wx, wz, p.y);
      if (!fin(g) || Math.abs(g - num(p.y, 0)) > THROW_LAND_DY) continue;
      if (P.overlapCircle(wx, wz, fr + 0.005, g + 0.01, h - 0.02)) continue;
      box.cx = wx; box.cz = wz; box.minY = g + 0.005; box.maxY = g + h;
      let hit = false;
      if (G && typeof G.sideHit === 'function') for (const e of side) { try { if (G.sideHit(box, e)) { hit = true; break; } } catch (err) { /* 当空的 */ } }
      if (!hit && I && Array.isArray(I.list)) {
        for (const q of I.list) {
          if (!q || q.owner || !fin(+q.x) || Math.abs(q.x - wx) > 0.5 || Math.abs(q.z - wz) > 0.5) continue;
          const qy = num(+q.y, 0);
          if (qy > g + h || qy + itemTall(q) < g) continue;
          const rr = fr + footRaw(q) + FORK_GAP;
          if ((q.x - wx) * (q.x - wx) + (q.z - wz) * (q.z - wz) < rr * rr) { hit = true; break; }
        }
      }
      if (!hit) return { gx: wx, gy: g, gz: wz };
    }
  }
  return null;
}
// keep（撞车甩货里留在叉上、滑完挂回去的件，和客机晚到的结果挂回去的件）：不转朝向、也不挪（规则 ①：偏航不变、只顺着货叉往前平移；
// 它们放上货叉时已经摆正了，滑完停在哪就挂在哪。返修 r14，验收员 spec：以前照样走 centerOnTine，包围盒中心出了叉尖 1.2 mm 就往车这边拉回 1.2 mm，
// 瓶罐往车这边退了一下；现在留下的件按 stableSlide 本来就停在重心离叉尖 ≥2 cm 的地方）
function attachItem(id, vehKey, keep) {
  const veh = V.get(String(vehKey));
  const I = BR.items;
  if (!veh || !I || !has(I, 'find')) return false;
  const it = I.find(id);
  if (!it) return false;
  footRaw(it);   // 顺手量一下这个类型的水平半径（下一次往货叉上丢同类型的就按量的排）
  if (!keep) { orientOnTine(veh, it); centerOnTine(veh, it); }
  toLocal(veh.pose, it.x, it.z, tmpL);
  veh.riders.set(String(it.id), { lx: tmpL.x, lz: tmpL.z, dy: num(it.y, 0) - forkSurface(veh), rot0: num(it.rotY, 0), yaw0: veh.pose.yaw, holding: false, cand: null });
  veh.riderSig = '';
  return true;
}
// 放上货叉时重心（模型包围盒中心，车本地）必须落在货叉叉面那一条里（返修 r10，验收员：绷带原点在货叉中线上、重心却伸出叉沿 0.5 cm 还平躺着）：
// 横着伸出去了就把这件横着挪到重心在这根货叉的中线上，前后出了叉尖 / 叉根就往里挪
function centerOnTine(veh, it) {
  const sh = typeShape(it), I = BR.items;
  if (!sh || !it.obj || !has(I, 'move')) return;
  it.obj.updateMatrixWorld(true);
  const e = it.obj.matrixWorld.elements, V = sh.V, p = veh.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    const dx = e[0] * x + e[4] * y + e[8] * z + e[12] - p.x, dz = e[2] * x + e[6] * y + e[10] * z + e[14] - p.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
  }
  toLocal(p, it.x, it.z, tmpL);
  const tx = tineX()[tmpL.x < 0 ? 0 : 1], half = num(gv('forkW'), 0.1) / 2, fz = forkZ(), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let mx = 0, mz = 0;
  if (Math.abs(cx - tx) > half - 0.005) mx = tx - cx;
  if (cz < fz[0]) mz = fz[0] - cz; else if (cz > fz[1]) mz = fz[1] - cz;
  if (!mx && !mz) return;
  toWorld(p, tmpL.x + mx, 0, tmpL.z + mz, tmpW);
  I.move(it.id, tmpW.x, it.y, tmpW.z);
}
// 放上货叉时必须放得稳（返修 r11 起；r12 主会话裁定 B 改成「重心在支撑凸包里」）：物资按「放得稳的静止姿态」（items.rest：PTG-B 往针头那边歪约 7°，
// 指托下沿和针帽一起着地）摆，模型最低点贴着叉面；叉面那一条（这根货叉 |lx − 中线| ≤ 叉宽 / 2、叉尖到叉根）正上方、离叉面 ≤2 mm 的顶点围成的凸包
// 要把重心（模型三角面按面积加权的质心）的竖直投影包在里面、往里至少 3 mm（伸出叉沿、悬在叉面外的那部分不算托着）。叉面那一条正上方的最低点离叉面
// 超过 2 mm 也不行（东西架在叉面外的东西上）。支撑点：离叉面 ≤2 mm 的顶点，加上底面里的边和叉沿、叉尖、叉根相交的点（底面压在叉面那一条上的那一块，
// 不管底面比货叉宽不宽；伸出叉沿的部分不算）。不满足、或者放得稳但横着伸出叉沿超过 OVH_MAX（2 cm；返修 r13，验收员 spec：斜放的 PTG-B 推杆那头伸出叉沿 3–5 cm，
// 和「转成顺着货叉、两头都搭在叉面上」对不上）就绕竖直轴每 3° 试一圈（重心照 centerOnTine 挪进叉面那一条以后再查），满足的朝向里用横着伸出叉沿最少的
// （一样少 —— 差 1 mm 以内 —— 挑离原来朝向近的，原来的朝向也算；原来就放得稳、怎么转都要伸出 2 cm 以上、转过去也少伸出不到 1 cm 就不转）
// —— PTG-B、巧克力这种长东西就转成顺着货叉；转一圈都不行就照原样
const SUP_TOL = 0.002, SUP_IN = 0.003, SUP_STEP = Math.PI / 60, OVH_MAX = 0.02;
let supM = null, supE = null;
function supportGap(veh, it, sh, ry, ox, oz) {
  const o = it.obj;
  if (!supM) { supM = new THREE.Matrix4(); supE = new THREE.Euler(); }
  supE.set(num(o.rotation.x, 0), ry, num(o.rotation.z, 0), o.rotation.order);
  supM.makeRotationFromEuler(supE).scale(o.scale);
  const L = linCar(supM.elements, num(veh.pose.yaw, 0)), V = sh.V;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
  const W = new Float32Array(V.length);
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    const cx = L[0] * x + L[1] * y + L[2] * z, cy = L[3] * x + L[4] * y + L[5] * z, cz = L[6] * x + L[7] * y + L[8] * z;
    W[i] = cx; W[i + 1] = cy; W[i + 2] = cz;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
  }
  const tx = tineX()[ox < 0 ? 0 : 1], half = num(gv('forkW'), 0.1) / 2, fz = forkZ();
  const cx = ox + (x0 + x1) / 2, cz = oz + (z0 + z1) / 2;
  const mx = Math.abs(cx - tx) > half - 0.005 ? tx - cx : 0, mz = cz < fz[0] ? fz[0] - cz : cz > fz[1] ? fz[1] - cz : 0;
  // 叉面那一条，换到相对原点（挪过以后）的坐标
  const a0 = tx - half - ox - mx, b0 = tx + half - ox - mx, c0 = fz[0] - oz - mz, d0 = fz[1] - oz - mz;
  supportGap.w = x1 - x0;   // 这个朝向横着多宽（车本地 x）
  supportGap.ovh = Math.abs(cx + mx - tx) + (x1 - x0) / 2 - half;   // 横着伸出叉沿多远（两边里多的那边；挪进叉面那一条以后）
  supportGap.inset = -Infinity;
  // 叉面那一条正上方、离最低点 ≤2 mm 的顶点（托着它的点）；底面比货叉宽的（皇家口粮、跃迁莓）四个角都伸在叉面外面，
  // 托着它的是底面压在叉面上的那一块：底面里的边（两头都离最低点 ≤2 mm）和叉沿、叉尖、叉根相交的点也算
  const pts = [];
  let lo = Infinity;
  for (let i = 0; i < W.length; i += 3) {
    if (W[i] < a0 || W[i] > b0 || W[i + 2] < c0 || W[i + 2] > d0) continue;
    if (W[i + 1] < lo) lo = W[i + 1];
    if (W[i + 1] <= y0 + SUP_TOL) pts.push(W[i], W[i + 2]);
  }
  const Ed = sh.E;
  for (let i = 0; i < Ed.length; i += 2) {
    const p = 3 * Ed[i], q = 3 * Ed[i + 1];
    if (W[p + 1] > y0 + SUP_TOL || W[q + 1] > y0 + SUP_TOL) continue;
    const xa = W[p], za = W[p + 2], dx = W[q] - xa, dz = W[q + 2] - za;
    let ta = 0, tb = 1;
    if (Math.abs(dx) > 1e-12) { let u0 = (a0 - xa) / dx, u1 = (b0 - xa) / dx; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; } ta = Math.max(ta, u0); tb = Math.min(tb, u1); } else if (xa < a0 || xa > b0) continue;
    if (Math.abs(dz) > 1e-12) { let u0 = (c0 - za) / dz, u1 = (d0 - za) / dz; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; } ta = Math.max(ta, u0); tb = Math.min(tb, u1); } else if (za < c0 || za > d0) continue;
    if (ta > tb) continue;
    if (ta > 0) pts.push(xa + dx * ta, za + dz * ta);
    if (tb < 1) pts.push(xa + dx * tb, za + dz * tb);
    const ym = Math.min(W[p + 1] + (W[q + 1] - W[p + 1]) * ta, W[p + 1] + (W[q + 1] - W[p + 1]) * tb);
    if (ym < lo) lo = ym;
  }
  if (!(lo - y0 <= SUP_TOL) || pts.length < 6) return Infinity;
  const hp = hull2(pts);
  if (!hp) return Infinity;
  const c = sh.com, gx = L[0] * c[0] + L[1] * c[1] + L[2] * c[2], gz = L[6] * c[0] + L[7] * c[1] + L[8] * c[2];
  let m = Infinity;
  for (let i = 0; i < hp.length; i += 3) m = Math.min(m, hp[i + 2] - (hp[i] * gx + hp[i + 1] * gz));
  supportGap.inset = m;
  return m >= SUP_IN ? lo - y0 : Infinity;
}
function orientOnTine(veh, it) {
  const I = BR.items;
  if (!it.obj || !it.obj.rotation || !has(I, 'move') || typeof THREE === 'undefined') return;
  const sh = typeShape(it);
  if (!sh || !sh.E || !sh.E.length) return;
  toLocal(veh.pose, it.x, it.z, tmpL);
  const ox = tmpL.x, oz = tmpL.z, r0 = num(it.rotY, 0);
  const ok0 = supportGap(veh, it, sh, r0, ox, oz) <= SUP_TOL, ovh0 = supportGap.ovh;
  if (ok0 && ovh0 <= OVH_MAX) return;
  // 贴得住的朝向里挑横着伸出叉沿最少的（长东西顺着货叉放：整件都在货叉上方，不斜着伸出叉沿；歪着靠稳的闪电瓶往货叉方向歪，不往叉沿外歪），
  // 一样少（差 1 mm 以内）挑离原来朝向近的（原来的朝向 d = 0 也在里面）。返修 r13 起按伸出多少挑（以前按横着多宽：圆肚子的闪电瓶怎么转都差不多宽，
  // 伸出叉沿多少却看它往哪边歪）
  let best = null, bo = Infinity, bk = Infinity;
  for (let k = 0; k < 120; k++) {
    const d = k <= 60 ? k : k - 120, ry = r0 + d * SUP_STEP;
    if (supportGap(veh, it, sh, ry, ox, oz) > SUP_TOL) continue;
    const o = supportGap.ovh, ad = Math.abs(d);
    if (o < bo - 0.001 || (o < bo + 0.001 && ad < bk)) { best = ry; bo = Math.min(bo, o); bk = ad; }
  }
  if (best == null || best === r0) return;
  // 原来就放得稳、最少的也伸出 2 cm 以上、转过去也少伸出不到 1 cm（饼干、蛋糕这种圆的怎么转都差不多）：不转；转过去能不伸出 2 cm 的照转
  if (ok0 && bo > OVH_MAX && ovh0 - bo < 0.01) return;
  it.rotY = wrap(best);
  I.move(it.id, it.x, it.y, it.z);   // still 的物资：place 按 rotY 摆朝向
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
      if (Math.abs(num(it.y, -9) - liftOfType(it.type) - y) > REATTACH_TOL) return;
      toLocal(p, it.x, it.z, tmpL);
      if (tmpL.z < fz[0] - 0.02 || tmpL.z > fz[1] + 0.02) return;
      if (Math.abs(tmpL.x - tx[0]) > FORK_TOL && Math.abs(tmpL.x - tx[1]) > FORK_TOL) return;
      if (!it.still) { it.still = true; if (has(I, 'move')) I.move(it.id, it.x, it.y, it.z); }
      attachItem(it.id, veh.key);
    });
  }
}
// ---------- 全速撞车：货叉上的东西整排往前滑出去（家长定的规则；FE1 返修 r10 主会话简化重做，r2–r9 逐件排落点的那一套删掉了）----------
// 单机、房主司机：本机算轨迹、摆过去，落地松手写进本层状态（丢弃物那张表），再 coop.emit('fkthrow', { k, list, id, p, v0 }) 告诉客机；
// 客机司机：不自己算，coop.use('k:'+车, 'fkthrow', …) 请房主按房主那边货叉上的东西算，房主摆好、写好状态，回复和广播（同一个 id）谁先到客机用谁，
// 晚到也照摆（等房主最多锁车 5 s；那以后才到的不再播动画，直接摆到终点，留在叉上的按撞车那一刻的位置挂回货叉）。
//
// 规则（主会话 r10 裁定，覆盖 r1–r9 的落点规则）：撞前车速 ≥2 m/s、往前开、「哐」一声时 ——
//   ① 只往前，整根叉一起滑：每根货叉上的东西是一排，同时顺着货叉方向往前滑，水平方向始终同速、彼此相对位置不变（整排一起往前平移），
//      不往两侧拐、不散开、不转向（偏航不变；只在翻下叉尖时前后歪一下，落地回正），一直到整排停下。两根叉各算各的；
//      两根叉上的件横向有重叠（宽件）时合成一排。
//   ② 翻下叉尖（返修 r12 裁定 C 重写；「直立」= 放得稳的静止姿态，「重心」= 看得见的重心 = 模型三角面按面积加权的质心）：每件往前的支撑
//      （重心前面离底面 ≤2 mm 的那一截，见 lowTable：平底就是重心那一格，PTG-B 是针帽）过了叉尖就往前栽 —— 一直真的靠着货叉转：绕真正碰着的那一点
//      （叉尖后面最低的轮廓点：平底是叉尖那条棱，PTG-B 先是叉面上的指托、针管落到棱上以后是棱）按重力矩转，重心按「刚好贴着货叉」走，最多歪 THROW_TILT_MAX
//      （再歪就收小转动用的重力）；要贴着就得比自由落体落得还快时离开货叉，按重力自由落、接着转（pivotRun）。托着它的那一截（横着落在货叉叉面那一条里的点）
//      最后一点过了棱，整件就离开货叉，接着看得见的重心竖直按重力落下（接着离开那一刻的速度，加速度 = g），水平照样跟着整排平滑减速；落下去的路上回正，
//      落地回到静止姿态，接着跟整排一起滑、一起停。
//   ③ 滑多远（返修 r12 裁定 A）：没被挡住时整排平移 D = max(最靠车那件最靠车的一点到叉尖的距离 + L(v), v²/(2·0.4g))，L(v)：2 m/s 0.2 m、
//      3.9 m/s 及以上 0.5 m、中间线性，是最靠车那件静止时离叉尖的下限（车越快越远：撞前 3.9 m/s 约 1.5 m，真开到顶速约 4.4 m/s 时约 2.1–2.4 m，只看公式）；其余各件按原来在叉上的间距排在它前面
//      （地上的摆法 = 叉上的摆法整体往前平移 D）。整排的位移 s(t) = D·(1 − (1 − t/Tr)²)：初速 = min(撞前车速, √(2·0.4g·D))（没被挡住时就是撞前车速，
//      水平速度在撞上那一帧连续；被挡住缩短了才降），减速度 2D/Tr² ≤ 0.4 g，平滑减到 0，Tr ≤ 1.6 s。
//   ④ 前面挡住：按真实外形（模型顶点、三角形的边按 2 cm 加密；物资之间按每 1 cm 一层的水平截面）沿平移方向扫一遍 —— 叉面高度那段、翻下去落下去那段、
//      地上那段，只要这一排里任何一件的路径或静止位置会碰到墙、柱子、柱础侧面、货架、别的车、这台车自己、地上已有的物资，
//      就二分把这一排的 D 缩短到刚好不碰。同一排的两件（整排同速，只会上下错开）按截面凸包隔开 PAIR_GAP（0.5 mm）查；压着时先让后件、再让前件翻下去歪得少一点
//      （各最多 3 次），不拿它当「前面挡住」（返修 r13：以前挨着放的闪电瓶和 PTG-B 被自己这一排的第一件「挡住」、只滑 22 cm）。落下去和接着滑的那段必须在
//      同一个高度的稳当面上（地面，或离地 ≤0.3 m 的矮东西顶上、整段滑动都在顶面内，重心和静止姿态支撑凸包的每个顶点底下是同一个面，supportHull），不然也缩短 D。
//      缩短以后往前的支撑没越过叉尖的件留在叉上、停在往前挪过的位置（how 'stay:blocked' / 'stay:surface' / 'stay:stuck'），越过的照常掉下去（'fwd'）；
//      留在叉上的停下来也要放得稳（重心在叉面上的支撑凸包里、往里 ≥3 mm，stableSlide；返修 r13），并且不停在叉尖边上（重心离叉尖 ≥ max(2 cm,
//      重心到最前端的一半)，伸出叉尖的最多约整件的四分之一；返修 r14），不然这一排再少滑一点。滑完挂回货叉时不再挪（attachItem keep，不往车这边退）。
//      叉尖顶着墙撞上：整排往前挪到碰墙为止、全部留在叉上。
//   撞上到整排停下（Tr）以前这台车的行驶、转向、升降都锁住（throwBusy）：轨迹按撞上那一刻的车位姿、叉面算。按了油门 / 方向 / 升降时，这次有东西翻下叉尖
//   提示「货叉上的东西还在往下掉」；一件都没掉、还要锁 0.2 s 以上提示「货叉上的东西还在往前滑」；更短（叉尖顶着墙，只锁几帧）不提示（返修 r11）。
//   本机司机这一帧的模拟里撞上的，东西摆到轨迹起点就算跟着车走到了撞上那一刻，同一帧的 stepFalls 只让它再走这一步里撞上以后剩下的时间
//   （返修 r11：以前整整再走一帧，撞上那一帧往前「窜」一下）。
//   举高限速开不到 2 m/s 不甩、倒车撞上不甩、慢慢碰上（「咚」）不甩（stepSim）。落地后静静躺着（still：不浮不转不弹），按放得稳的静止姿态最低顶点贴住；
//   丢弃物那条多记朝向（[x, y, z, type, count, rotY]，返修 r12 裁定 D），换层回来按记的朝向静静摆回去（老格式没有朝向的由 relayLying 让它躺下）。一次最多甩 THROW_MAX 件。
function forkSurfaceAt(pose) { return num(pose.y, 0) + forkBase() + carriageTravel() * clamp(num(pose.lift, 0), 0, 1); }
// 物资的「脚」：模型离它自己竖直转轴（原点）最远那个顶点的水平距离，按类型量一次（绕竖直轴转多少都一样）。
// dropSurface 排间隔、放得稳的那几个点、forklift.js 找空地按它。
// 返修 r13：按模型本身量，取直立（浮着、拿着）和「放得稳的静止姿态」（items.rest：闪电瓶歪 11.7°、火盐 18.5° 时瓶肚子往外伸得更远）两种里大的那个 ——
// 以前量的是这个类型碰巧第一件当时的样子，第一件是浮着的就量成直立的，往货叉上排的时候歪着的瓶肚子伸到后面那件的上方（验收员 play r13：
// 闪电瓶后面紧跟着的巧克力和它的瓶肚子在车本地前后重叠 0.8 mm，翻下去时擦着压进去）
const footCache = new Map();
function footShape(it) {
  const sh = typeShape(it), o = it && it.obj;
  if (!sh || !o || typeof THREE === 'undefined') return null;
  let r = null;
  try { r = BR.items && has(BR.items, 'rest') ? BR.items.rest(String(it.type)) : null; } catch (err) { r = null; }
  const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r ? num(r.rx, 0) : 0, 0, r ? num(r.rz, 0) : 0, 'YXZ'));
  M.scale(o.scale);
  const e = M.elements, V = sh.V, sx = num(o.scale.x, 1), sz = num(o.scale.z, 1);
  let m = 0;
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    const a = (x * sx) * (x * sx) + (z * sz) * (z * sz), hx = e[0] * x + e[4] * y + e[8] * z, hz = e[2] * x + e[6] * y + e[10] * z, b = hx * hx + hz * hz;
    if (a > m) m = a;
    if (b > m) m = b;
  }
  return m > 0 && fin(m) ? Math.sqrt(m) : null;
}
function footMeasure(it) { const f = footShape(it); return f != null ? f : footOfObj(it.obj); }
// 物资模型里算实物的网格（FE1P H6）：光晕、发光体（物资 build 时标 userData.glow：火盐的光晕球、瓶装闪电的闪电和瓶内光晕）不是实物 ——
// 量外形（摆货叉、甩货、车推、查穿模）、质心都不算它们，和 items.rest（放得稳的静止姿态）同一个口径（items.solidMesh）
function solidPart(n) {
  const I = BR.items;
  if (I && has(I, 'solidMesh')) return I.solidMesh(n);
  return !!(n && n.isMesh) && !(n.userData && n.userData.glow);
}
function footOfObj(obj) {
  if (!obj || typeof obj.traverse !== 'function' || !obj.matrixWorld) return null;
  try { obj.updateMatrixWorld(true); } catch (err) { return null; }
  const o = obj.matrixWorld.elements, ox = o[12], oz = o[14];
  let m = -1;
  obj.traverse(n => {
    if (!solidPart(n)) return;
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
  if (f == null && it.obj) { f = footMeasure(it); if (f != null && ty != null) footCache.set(ty, f); }
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
      const f = footMeasure(p);
      if (f != null) { footCache.set(ty, f); return clamp(f, 0.02, 0.3); }
    }
  }
  let inf = null;
  try { inf = I && has(I, 'info') ? I.info(ty) : null; } catch (err) { inf = null; }
  return clamp(footEst(num(inf && inf.r, num(+r, 0.08)), num(inf && inf.hh, 0.06)), 0.02, 0.3);
}
function itemTall(it) { return Math.max(0.05, 2 * num(it.hh, 0.06)); }
// 模型原点比模型最低点高多少：按「放得稳的静止姿态」（items.rest(type).bot，返修 r12 裁定 B：PTG-B 往针头那边歪约 7°、指托和针帽一起着地）的最低顶点；
// 摆在叉面上、落在地上时这个最低点贴住。老版 items 没有 rest 时按包围盒（items.info().bot）
const LIFT_MIN = -0.05, LIFT_MAX = 0.15;
function liftOfType(type) {
  const I = BR.items;
  let r = null;
  try { r = I && has(I, 'rest') && type != null ? I.rest(String(type)) : null; } catch (err) { r = null; }
  if (r && fin(+r.bot)) return clamp(-r.bot, LIFT_MIN, LIFT_MAX);
  let inf = null;
  try { inf = I && has(I, 'info') && type != null ? I.info(String(type)) : null; } catch (err) { inf = null; }
  const b = inf ? num(+inf.bot, 0) : 0;
  return clamp(-b, -0.01, 0.05);
}
// ---- 常量 ----
const THROW_L_V1 = 3.9;            // 车速到这么快（约全速）以上，最靠车那件落在叉尖前方 THROW_D1
const THROW_DEC = 0.4 * FALL_G;    // 整排减速度上限（空中跟着整排减速也不超过它）
const THROW_T_ROW = 1.6;           // 整排从撞上到停下最多这么久
const THROW_PAD = 0.006;           // 按顶点查：和墙、柱子、柱础、货架、车身横着至少空这么多（竖直只留 2 mm：可以落在矮东西顶上）
const ITEM_GAP = 0.004;            // 物资和物资之间（按水平截面）
const PAIR_GAP = 0.0005;           // 同一排里的两件之间（返修 r13）：整排同速平移，两件只会因为一件先往下掉、歪着栽而上下错开，横着不会互相靠近 ——
                                   // 只要截面凸包一直隔开 0.5 mm（不压进去）就行；以前按 ITEM_GAP 的 4 mm 查，挨着放、只隔 3 mm 的两件（瓶肚子比瓶底宽、
                                   // 针头正对着它）一上下错开就算「压着」，整排被自己的第一件「挡住」、只滑 22 cm 留在叉上（验收员 play r13）
const THROW_TOL_Y = 0.002;
const THROW_TILT_MAX = 0.3;        // 翻下叉尖最多歪这么多（rad，约 17°；叉面离地近、东西又长时按「前端不碰地」再收小）
const THROW_KAPPA_MAX = 4;
const THROW_DT = 1 / 300;          // 翻下去、落下去那段每这么久查一次
const THROW_LAND_DY = 0.3;         // 落点地面和车所在地面差得超过这么多（坑、台阶）不落
const LOW_TOP = 0.3;               // 落在离地 ≤0.3 m 的矮东西顶上也行（放得稳的标准和地面一样）
const THROW_WAIT_S = 5;            // 客机等房主回轨迹时车先刹住最多这么久（coop.use 4 s 内一定回调；晚到的照摆）
const THROW_MAX = 40;              // 一次撞车最多甩这么多件（两根货叉摆满最小的东西也不到 40 件）；再多的留在叉上（'stay:cap'）
const PT_STEP = 0.02;              // 查碰撞的点：模型顶点 + 三角形的边按这么长加密
const SLICE_H = 0.01;              // 物资和物资之间：按每这么高一层的水平截面（凸包）查
const ES_N = 16, ES_PAD = 0.002;   // 托着它的那一截随倾斜变化的表（见 esTable）

// ---- 物资的外形（按类型量一次，模型自己的坐标系）----
// { V 顶点, E 边（顶点下标两两一对）, P 查碰撞的点（顶点 + 边上每 2 cm 一点，3 mm 去重）, sl 每 1 cm 一层的水平截面凸包（半平面 [nx, nz, d]…，
//   点在里面 ⟺ 每条都 nx·x + nz·z ≤ d）, y0 / y1 竖直范围, bb 包围盒 [x0, x1, y0, y1, z0, z1] }；量不到模型 null。
//   只量实物网格（solidPart，FE1P H6：火盐的光晕球、瓶装闪电的闪电和光晕不算，光晕可以和叉面、地面、墙交叠）
const typeShapes = new Map();
function hull2(pts) {
  const n = pts.length / 2;
  if (n < 3) return null;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lo = [], up = [];
  for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 1e-12) lo.pop(); lo.push(i); }
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], i) <= 1e-12) up.pop(); up.push(i); }
  lo.pop(); up.pop();
  const h = lo.concat(up);
  if (h.length < 3) return null;
  // 逆时针（x 右、z 下的平面里面积为正）：外法线 (dz, −dx)
  const out = new Float32Array(h.length * 3);
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], dx = pts[2 * b] - pts[2 * a], dz = pts[2 * b + 1] - pts[2 * a + 1], L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L;
    out[3 * i] = nx; out[3 * i + 1] = nz; out[3 * i + 2] = nx * pts[2 * a] + nz * pts[2 * a + 1];
  }
  return out;
}
// 平面点集 [x, z, x, z…] 的凸包顶点 [[x, z]…]（逆时针）；少于 3 点照原样
function hullPts(pts) {
  const P = [];
  for (let i = 0; i + 1 < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  if (P.length < 3) return P;
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
  for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function typeShape(it) {
  if (!it || !it.obj || typeof it.obj.traverse !== 'function' || typeof THREE === 'undefined') return null;
  const ty = String(it.type);
  if (typeShapes.has(ty)) return typeShapes.get(ty);
  let sh = null;
  try {
    const obj = it.obj;
    obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    const V = [], E = [], Tr = [];
    obj.traverse(n => {
      if (!solidPart(n)) return;   // 光晕、发光体不是实物（FE1P H6）
      const g = n && n.isMesh && n.geometry, pos = g && g.attributes && g.attributes.position;
      if (!pos || typeof pos.getX !== 'function') return;
      M.multiplyMatrices(inv, n.matrixWorld);
      const i0 = V.length / 3, seen = new Set();
      for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(M); V.push(v.x, v.y, v.z); }
      const idx = g.index, nt = Math.floor((idx ? idx.count : pos.count) / 3);
      for (let t = 0; t < nt; t++) {
        Tr.push(i0 + (idx ? idx.getX(3 * t) : 3 * t), i0 + (idx ? idx.getX(3 * t + 1) : 3 * t + 1), i0 + (idx ? idx.getX(3 * t + 2) : 3 * t + 2));
        for (let q = 0; q < 3; q++) {
          const a = idx ? idx.getX(3 * t + q) : 3 * t + q, b = idx ? idx.getX(3 * t + (q + 1) % 3) : 3 * t + (q + 1) % 3;
          if (a === b) continue;
          const key = a < b ? a * 4194304 + b : b * 4194304 + a;
          if (seen.has(key)) continue;
          seen.add(key); E.push(i0 + a, i0 + b);
        }
      }
    });
    if (V.length >= 9) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < V.length; i += 3) {
        x0 = Math.min(x0, V[i]); x1 = Math.max(x1, V[i]); y0 = Math.min(y0, V[i + 1]); y1 = Math.max(y1, V[i + 1]); z0 = Math.min(z0, V[i + 2]); z1 = Math.max(z1, V[i + 2]);
      }
      const P = [], vox = new Set();
      const addP = (x, y, z) => { const k = Math.round(x * 333) + ',' + Math.round(y * 333) + ',' + Math.round(z * 333); if (!vox.has(k)) { vox.add(k); P.push(x, y, z); } };
      const nb = Math.max(1, Math.ceil((y1 - y0) / SLICE_H - 1e-6)), bands = [];
      for (let k = 0; k < nb; k++) bands.push([]);
      // 一层 [y0 + k·H, y0 + (k + 1)·H] 收上下各多一层的点（截面在这一层里变化，取包住它的凸包）
      const addB = (x, y, z) => { const f = (y - y0) / SLICE_H; for (let k = Math.max(0, Math.floor(f) - 1); k <= Math.min(nb - 1, Math.floor(f) + 1); k++) bands[k].push(x, z); };
      for (let i = 0; i < V.length; i += 3) { addP(V[i], V[i + 1], V[i + 2]); addB(V[i], V[i + 1], V[i + 2]); }
      for (let i = 0; i < E.length; i += 2) {
        const a = 3 * E[i], b = 3 * E[i + 1], L = Math.hypot(V[a] - V[b], V[a + 1] - V[b + 1], V[a + 2] - V[b + 2]);
        const mP = Math.ceil(L / PT_STEP), mB = Math.ceil(L / 0.008);
        for (let k = 1; k < mP; k++) { const f = k / mP; addP(V[a] + (V[b] - V[a]) * f, V[a + 1] + (V[b + 1] - V[a + 1]) * f, V[a + 2] + (V[b + 2] - V[a + 2]) * f); }
        for (let k = 1; k < mB; k++) { const f = k / mB; addB(V[a] + (V[b] - V[a]) * f, V[a + 1] + (V[b + 1] - V[a + 1]) * f, V[a + 2] + (V[b + 2] - V[a + 2]) * f); }
      }
      // 质心（返修 r12 裁定 B / C：「看得见的重心」= 模型三角面按面积加权的质心，模型坐标）
      let A = 0, gx = 0, gy = 0, gz = 0;
      for (let t = 0; t < Tr.length; t += 3) {
        const a = 3 * Tr[t], b = 3 * Tr[t + 1], c = 3 * Tr[t + 2];
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
        const ar = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
        A += ar; gx += ar * (V[a] + V[b] + V[c]); gy += ar * (V[a + 1] + V[b + 1] + V[c + 1]); gz += ar * (V[a + 2] + V[b + 2] + V[c + 2]);
      }
      const com = A > 0 ? [gx / (3 * A), gy / (3 * A), gz / (3 * A)] : [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      sh = { V: new Float32Array(V), E: new Uint32Array(E), T: new Uint32Array(Tr), P: new Float32Array(P), sl: bands.map(hull2), y0, y1, bb: [x0, x1, y0, y1, z0, z1], com };
    }
  } catch (err) { once('shape', () => console.error('[vehicles] 量物资外形出错', err)); sh = null; }
  typeShapes.set(ty, sh);
  return sh;
}
// 点（模型自己的坐标）在不在这件物资里：竖直按模型范围（留 2 mm），横着按那一层的凸包外扩 pad
function inSlices(sh, x, y, z, pad) {
  if (y <= sh.y0 + THROW_TOL_Y || y >= sh.y1 - THROW_TOL_Y) return false;
  const S = sh.sl[Math.min(sh.sl.length - 1, Math.max(0, Math.floor((y - sh.y0) / SLICE_H)))];
  if (!S) return false;
  for (let i = 0; i < S.length; i += 3) if (S[i] * x + S[i + 1] * z - S[i + 2] > pad) return false;
  return true;
}
// 从模型坐标里的点 (x, y, z) 沿 (dx, dz) 水平走：最早什么时候进到那一层的凸包（外扩 pad）里；进不去 Infinity
function raySlices(sh, x, y, z, dx, dz, pad) {
  if (y <= sh.y0 + THROW_TOL_Y || y >= sh.y1 - THROW_TOL_Y) return Infinity;
  const S = sh.sl[Math.min(sh.sl.length - 1, Math.max(0, Math.floor((y - sh.y0) / SLICE_H)))];
  if (!S) return Infinity;
  let tE = -Infinity, tL = Infinity;
  for (let i = 0; i < S.length; i += 3) {
    const nm = S[i + 2] + pad - (S[i] * x + S[i + 1] * z), dn = S[i] * dx + S[i + 1] * dz;
    if (Math.abs(dn) < 1e-12) { if (nm < 0) return Infinity; continue; }
    const t = nm / dn;
    if (dn > 0) { if (t < tL) tL = t; } else if (t > tE) tE = t;
  }
  const e = Math.max(0, tE);
  return tL >= e ? e : Infinity;
}
// 三维线性部分（行优先 9 个数）求逆
function inv3(m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12)) return null;
  const r = 1 / det;
  return [A * r, -(b * i - c * h) * r, (b * f - c * e) * r, B * r, (a * i - c * g) * r, -(a * f - c * d) * r, C * r, -(a * h - b * g) * r, (a * e - b * d) * r];
}
// 物资模型坐标 → 车本地的线性部分（模型的缩放、绕三根轴的转，加上车的朝向）：e = 模型的 matrixWorld.elements（父节点是不动的 items 组）
function linCar(e, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c * e[0] - s * e[2], c * e[4] - s * e[6], c * e[8] - s * e[10], e[1], e[5], e[9], s * e[0] + c * e[2], s * e[4] + c * e[6], s * e[8] + c * e[10]];
}

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

// ---- 障碍（车本地坐标；x0…z1 是车本地的外接盒）----
// k 0 = 盒子（ox, oz 中心，ca / sa 车本地 → 盒子本地的转角，hx / hz 半边，ya / yb 竖直范围）、1 = 竖圆柱（ox, oz, r）、2 = 物资（外形 sh、
// 车本地 → 模型坐标的线性部分 Li、原点 ox / oy / oz、沿 −z 走在模型坐标里的方向 dl）。tag：碰上了写进 how（'solid' 'car:forkL' 'side:plinth' 'item:<id>'）
function boxObs(ox, oz, a, hx, hz, ya, yb, tag, tine) {
  const ca = Math.cos(a), sa = Math.sin(a), ex = Math.abs(ca) * hx + Math.abs(sa) * hz, ez = Math.abs(sa) * hx + Math.abs(ca) * hz;
  return { k: 0, ox, oz, ca, sa, hx, hz, ya, yb, x0: ox - ex, x1: ox + ex, z0: oz - ez, z1: oz + ez, tag, tine: tine == null ? -1 : tine };
}
function cylObs(ox, oz, r, ya, yb, tag) { return { k: 1, ox, oz, r, ya, yb, x0: ox - r, x1: ox + r, z0: oz - r, z1: oz + r, tag, tine: -1 }; }
// 点在不在障碍里（横着外扩 pad，竖直留 2 mm）
function inObs(o, x, y, z, pad) {
  if (o.k !== 2 && (y <= o.ya + THROW_TOL_Y || y >= o.yb - THROW_TOL_Y)) return false;
  if (o.k === 0) {
    const dx = x - o.ox, dz = z - o.oz;
    return Math.abs(o.ca * dx - o.sa * dz) < o.hx + pad && Math.abs(o.sa * dx + o.ca * dz) < o.hz + pad;
  }
  if (o.k === 1) { const dx = x - o.ox, dz = z - o.oz, R = o.r + pad; return dx * dx + dz * dz < R * R; }
  const L = o.Li, dx = x - o.ox, dy = y - o.oy, dz = z - o.oz;
  return inSlices(o.sh, L[0] * dx + L[1] * dy + L[2] * dz, L[3] * dx + L[4] * dy + L[5] * dz, L[6] * dx + L[7] * dy + L[8] * dz, pad);
}
// 点 (x, y, z) 沿车本地 −z 平移：最早走多远碰到障碍；碰不到 Infinity
function rayObs(o, x, y, z, pad) {
  if (o.k !== 2 && (y <= o.ya + THROW_TOL_Y || y >= o.yb - THROW_TOL_Y)) return Infinity;
  if (o.k === 0) {
    const dx = x - o.ox, dz = z - o.oz, ux = o.ca * dx - o.sa * dz, uz = o.sa * dx + o.ca * dz, vx = o.sa, vz = -o.ca, ex = o.hx + pad, ez = o.hz + pad;
    let tE = -Infinity, tL = Infinity;
    if (Math.abs(vx) < 1e-12) { if (Math.abs(ux) >= ex) return Infinity; } else { let a = (-ex - ux) / vx, b = (ex - ux) / vx; if (a > b) { const t = a; a = b; b = t; } tE = Math.max(tE, a); tL = Math.min(tL, b); }
    if (Math.abs(vz) < 1e-12) { if (Math.abs(uz) >= ez) return Infinity; } else { let a = (-ez - uz) / vz, b = (ez - uz) / vz; if (a > b) { const t = a; a = b; b = t; } tE = Math.max(tE, a); tL = Math.min(tL, b); }
    if (tL < Math.max(0, tE)) return Infinity;
    return Math.max(0, tE);
  }
  if (o.k === 1) {
    const dx = x - o.ox, dz = z - o.oz, R = o.r + pad, q = R * R - dx * dx;
    if (!(q > 0)) return Infinity;
    const sq = Math.sqrt(q);
    if (dz + sq < 0) return Infinity;
    return Math.max(0, dz - sq);
  }
  const L = o.Li, dx = x - o.ox, dy = y - o.oy, dz = z - o.oz;
  return raySlices(o.sh, L[0] * dx + L[1] * dy + L[2] * dz, L[3] * dx + L[4] * dy + L[5] * dz, L[6] * dx + L[7] * dy + L[8] * dz, o.dl[0], o.dl[2], pad);
}
// 地上的一件物资当障碍（车本地）
function itemObs(it, sh, pose) {
  const o = it.obj;
  o.updateMatrixWorld(true);
  const e = o.matrixWorld.elements, Lc = linCar(e, num(pose.yaw, 0)), Li = inv3(Lc);
  if (!Li) return null;
  toLocal(pose, e[12], e[14], tmpL);
  const ox = tmpL.x, oz = tmpL.z, oy = e[13], bb = sh.bb;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = bb[i & 1], py = bb[2 + ((i >> 1) & 1)], pz = bb[4 + ((i >> 2) & 1)];
    const x = ox + Lc[0] * px + Lc[1] * py + Lc[2] * pz, y = oy + Lc[3] * px + Lc[4] * py + Lc[5] * pz, z = oz + Lc[6] * px + Lc[7] * py + Lc[8] * pz;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { k: 2, id: String(it.id), sh, Lc, Li, ox, oy, oz, ya: y0, yb: y1, x0, x1, z0, z1, tag: 'item:' + it.id, tine: -1, dl: [-Li[2], -Li[5], -Li[8]], Pw: null };
}
// 地上那件物资的点（车本地，查「它的角戳进甩出去的那件」用；要用到才算）
function obsPts(o) {
  if (o.Pw) return o.Pw;
  const P = o.sh.P, L = o.Lc, W = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    W[i] = o.ox + L[0] * x + L[1] * y + L[2] * z; W[i + 1] = o.oy + L[3] * x + L[4] * y + L[5] * z; W[i + 2] = o.oz + L[6] * x + L[7] * y + L[8] * z;
  }
  return (o.Pw = W);
}

// 一次甩货的场景（车本地）：车位姿、叉面、这台车自己的盒子、墙货架柱子别的车（phys）、sideObs、地上已有的物资；
// topAt / supportHull 也用它（pose、ign、skip、side、sideHit）
function throwScene(veh, pose, xLo, xHi, zLo) {
  const P = BR.phys, G = BR.forklift && BR.forklift._geom, I = BR.items;
  const lift = clamp(num(pose.lift, 0), 0, 1), surf = forkSurfaceAt(pose), py = num(pose.y, 0), yaw = num(pose.yaw, 0);
  const tx = tineX(), half = num(gv('forkW'), 0.1) / 2, fz = forkZ();
  const T = {
    pose, ign: veh.obbKey || physKeyOf(veh), surf, py, tip: fz[0], heel: fz[1], tx, half,
    side: sideNear(pose.x, pose.z, 5), sideHit: G && typeof G.sideHit === 'function' ? G.sideHit : null, skip: undefined,
    own: [], obs: [], items: [], tops: new Map(),
  };
  const sk = [];
  for (const e of T.side) if (Array.isArray(e.solid) && e.solid.length >= 6 && sk.indexOf(e.solid) < 0) sk.push(e.solid);
  if (sk.length) T.skip = sk;
  // 这台车自己的盒子（按撞车那一刻的 lift；两根货叉记下是哪根）
  for (const o of obbsAtLift(veh, lift)) {
    const tine = /fork/i.test(o.name) ? (o.cx < 0 ? 0 : 1) : -1;
    T.own.push(boxObs(o.cx, o.cz, 0, o.hx, o.hz, py + o.cy - o.hy, py + o.cy + o.hy, 'car:' + o.name, tine));
  }
  // 往前扫的那一块（车本地）：两边的东西、叉尖前方 zLo 以内
  const cx = (xLo + xHi) / 2, cz = (zLo + T.heel + 0.3) / 2, hx = (xHi - xLo) / 2, hz = (T.heel + 0.3 - zLo) / 2;
  toWorld(pose, cx, 0, cz, tmpW);
  const region = { cx: tmpW.x, cz: tmpW.z, hx, hz, rot: yaw, minY: py - 0.2, maxY: surf + 1.0 };
  const hits = [];
  if (has(P, 'overlapOBB')) { try { P.overlapOBB(region, { tol: 0, ignoreKey: T.ign, out: hits, skipBoxes: T.skip }); } catch (err) { hits.length = 0; } }
  for (const s of hits) {
    if (s.obb) { toLocal(pose, s.cx, s.cz, tmpL); T.obs.push(boxObs(tmpL.x, tmpL.z, num(s.rot, 0) - yaw, s.hx, s.hz, s.minY, s.maxY, 'solid')); }
    else {
      toLocal(pose, (s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2, tmpL);
      T.obs.push(boxObs(tmpL.x, tmpL.z, -yaw, (s.maxX - s.minX) / 2, (s.maxZ - s.minZ) / 2, s.minY, s.maxY, 'solid'));
    }
  }
  // sideObs（柱础、护角、纸箱、地牛……）按真实形状
  for (const e of T.side) {
    const ya = Math.min(+e.minY, +e.maxY), yb = Math.max(+e.minY, +e.maxY), tag = 'side:' + (e.kind || '');
    let o;
    if (e.round && fin(+e.r) && fin(+e.cx) && fin(+e.cz)) { toLocal(pose, +e.cx, +e.cz, tmpL); o = cylObs(tmpL.x, tmpL.z, +e.r, ya, yb, tag); }
    else if (fin(+e.rot) && Math.abs(+e.rot) > 1e-6 && fin(+e.cx) && fin(+e.cz) && +e.hx > 0 && +e.hz > 0) { toLocal(pose, +e.cx, +e.cz, tmpL); o = boxObs(tmpL.x, tmpL.z, +e.rot - yaw, +e.hx, +e.hz, ya, yb, tag); }
    else {
      const x0 = Math.min(+e.minX, +e.maxX), x1 = Math.max(+e.minX, +e.maxX), z0 = Math.min(+e.minZ, +e.maxZ), z1 = Math.max(+e.minZ, +e.maxZ);
      toLocal(pose, (x0 + x1) / 2, (z0 + z1) / 2, tmpL); o = boxObs(tmpL.x, tmpL.z, -yaw, (x1 - x0) / 2, (z1 - z0) / 2, ya, yb, tag);
    }
    if (o.x1 < xLo - 0.3 || o.x0 > xHi + 0.3 || o.z1 < zLo - 0.3 || o.z0 > T.heel + 0.5) continue;
    T.obs.push(o);
  }
  // 地上已有的物资（这台车货叉上的不算：它们在这次的排里）
  if (I && Array.isArray(I.list)) {
    for (const it of I.list) {
      if (!it || it.owner || it.held || veh.riders.has(String(it.id)) || !it.obj || !fin(+it.x)) continue;
      if (Math.abs(it.x - pose.x) > 5 || Math.abs(it.z - pose.z) > 5) continue;
      const sh = typeShape(it);
      if (!sh) continue;
      const o = itemObs(it, sh, pose);
      if (!o || o.x1 < xLo - 0.3 || o.x0 > xHi + 0.3 || o.z1 < zLo - 0.3 || o.z0 > T.heel + 0.5) continue;
      T.items.push(o);
    }
  }
  return T;
}

// ---- 轨迹（path）：[[t, x, y, z, mode]…]，车本地或世界坐标都行；x / y / z 是「直立时的原点」（直立 = 放得稳的静止姿态，返修 r12 裁定 B） ----
// 第一个关键帧多带 [cn, lift, Tr, onFork, H, gz, gy]：cn = 包围盒中心离原点沿滑动方向多远（倾斜时绕包围盒中心下面那一点 C 转），lift = 原点比模型底面高多少，
// Tr = 这一排停下的时刻（水平位置按 σ(t) = 1 − (1 − t/Tr)² 走：整排匀减速），onFork = 1 留在叉上（滑完挂回货叉），H = 模型包围盒高（返修 r11），
// gz / gy = 看得见的重心（模型三角面按面积加权的质心）离 C 往车尾多远、比底面高多少（返修 r12 裁定 C；对方旧版没有就按 0、H/2 —— 包围盒中心）。
// mode（这一段怎么走，记在这一段的终点上）：0 贴着叉面 / 地面滑；1 竖直从静止往下掉（对方旧版只给落点时用）；
//   2 翻下叉尖（一直真的碰着货叉：靠着叉尖那条棱或叉面上的点转，碰不着时按重力落）：关键帧多带 [θ 表, 落差表]（这一段 w = 0…1 等分若干份时的倾斜、C 往下掉了多少，
//     房主按模型真实的底面算好的；返修 r14 起翻下叉尖那段按碰着 / 离开货叉切成几段，每段按时长等分 4–PV_N 份，见 pivotRun 的 segs）；对方旧版没给表时按「底面所在的平面贴着那条棱」：竖直从静止往下掉（w²）、θ = atan(落差 / 离起点水平走了多远）；
//   3 整件离开货叉以后：倾斜从上一段末了的 θa 起 θa·(1 + κw)(1 − w)²（先接着歪一点再回正，落地时直立；κ 按上一段末了倾斜得多快接上，
//     最多 THROW_KAPPA_MAX）；竖直是看得见的重心按重力落（重心高度 = 起点 − c1·w − c2·w²：c1 = 上一段末了画出来的重心竖直速度 × T，c2 = 落差 − c1 ≈ ½g·T²，
//     FE1P H13 起两段接上的那一刻竖直速度连续），C 跟着倾斜在它下面。
// 水平：有 Tr 时每一段都按 σ 走（整排同速），没有（老轨迹）按 w 线性。写进 out = [x, y, z, θ, nx, nz]（n = 往哪边倾斜的水平单位向量）
function sig(T, t) { const u = clamp(t / T, 0, 1); return 1 - (1 - u) * (1 - u); }
const tmpPv = [0, 0, 0, 0, 0, 0];
// 看得见的重心离 C 的偏移 [往车尾多远, 比底面高多少]（轨迹上记的；老轨迹按包围盒中心）
function pathG(P) { return P.gy != null ? [num(P.gz, 0), P.gy] : [0, num(P.H, 0) / 2]; }
// 等分表 A（w = 0…1）在 w 处的值：三次 Hermite（Catmull-Rom 切线，两头按二次外推的切线）—— 等分采样的二次函数（自由落体那一段）原样复原，
// 逐帧量的竖直加速度不会因为线性插值忽大忽小（返修 r12）
function tabAt(A, w) {
  const n = A.length - 1, x = clamp(w, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const tan = j => (j <= 0 ? (n >= 2 ? (-3 * A[0] + 4 * A[1] - A[2]) / 2 : A[1] - A[0]) : j >= n ? (n >= 2 ? (3 * A[n] - 4 * A[n - 1] + A[n - 2]) / 2 : A[n] - A[n - 1]) : (A[j + 1] - A[j - 1]) / 2);
  const p0 = A[i], p1 = A[i + 1], m0 = tan(i), m1 = tan(i + 1), f2 = f * f, f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * p1 + (f3 - f2) * m1;
}
function segAt(P, k, w, out) {
  const a = P[k - 1], b = P[k], m = b[4] | 0, T = P.T;
  let f = w;
  if (T > 0) {
    const sa = sig(T, a[0]), sb = sig(T, b[0]);
    f = sb - sa > 1e-9 ? (sig(T, a[0] + (b[0] - a[0]) * w) - sa) / (sb - sa) : (Math.abs(b[1] - a[1]) + Math.abs(b[3] - a[3]) > 1e-6 ? w : 0);
  }
  out[0] = a[1] + (b[1] - a[1]) * f; out[2] = a[3] + (b[3] - a[3]) * f;
  out[3] = 0; out[4] = P.nx || 0; out[5] = P.nz || 0;
  if (m === 2) {
    if (b.th && b.dr) { out[3] = Math.max(0, tabAt(b.th, w)); out[1] = a[2] - tabAt(b.dr, w); return out; }
    const drop = (a[2] - b[2]) * w * w, along = Math.hypot(out[0] - a[1], out[2] - a[3]);
    out[1] = a[2] - drop;
    out[3] = drop > 0 && along > 1e-7 ? Math.atan2(drop, along) : 0;
    return out;
  }
  if (m === 3) {
    // 离开货叉以后：倾斜从 θa（翻下叉尖那一段末了）接着它的转速平滑回到 0；看得见的重心（质心，离 C (gz, gy)、跟着倾斜转）按重力落。
    // 重心的落差 Dc = D + gy·(cos θa − 1) + gz·sin θa；out[1]（直立时的原点高）= 重心高 − (gy·cos θ + gz·sin θ) + lift，两头正好接上 a、b 两个关键帧。
    // 重心落差 = c1·w + c2·w²：c1 接着上一段（翻下叉尖）末了画出来的重心竖直速度（FE1P H13，验收员 r15：3.9 m/s PTG-B 在 mode 2 → 3 那一刻竖直速度差 1–2 cm/s ——
    // 以前按 c2 = ½g·Tf² 定，计划里的速度和两张表插出来的速度差一点、关键帧时刻又取整到 0.1 ms，接上的地方速度就断一下）；c2 = Dc − c1，加速度 2·c2/Tf² 和 g 只差取整那一点
    const Tf = b[0] - a[0], D = a[2] - b[2], G = pathG(P), gz = G[0], gy = G[1];
    let tha = 0, th = 0, vc = NaN;
    if (k >= 2 && (a[4] | 0) === 2) {
      // θa、κ、上一段末了重心往下多快 vc（每秒）只和上一段有关：每条轨迹每段算一次记在轨迹上（甩货计划里 pairHit / sampleFall 每 1/300 s 要算一遍）
      let c3 = P.c3 && P.c3[k];
      if (!c3) {
        segAt(P, k - 1, 1, tmpPv);
        const t1 = tmpPv[3], Tp = Math.max(1e-6, a[0] - P[k - 2][0]);
        let kap = 2;
        if (t1 > 1e-5) {
          segAt(P, k - 1, 0.99, tmpPv);
          const dth = (t1 - tmpPv[3]) / (0.01 * Tp);   // 上一段末了每秒倾斜多少
          kap = clamp(2 + dth * Tf / t1, 2, THROW_KAPPA_MAX);
        }
        const cy = q => { segAt(P, k - 1, q, tmpPv); return tmpPv[1] + gy * Math.cos(tmpPv[3]) + gz * Math.sin(tmpPv[3]); }, e = 0.002;
        const v1 = -(3 * cy(1) - 4 * cy(1 - e) + cy(1 - 2 * e)) / (2 * e * Tp);
        c3 = [t1 > 1e-5 ? t1 : 0, kap, fin(v1) ? v1 : NaN];
        (P.c3 || (P.c3 = {}))[k] = c3;
      }
      tha = c3[0]; vc = c3[2];
      if (tha > 0) th = Math.max(0, tha * (1 + c3[1] * w) * (1 - w) * (1 - w));
    }
    out[3] = th;
    const Dc = D + gy * (Math.cos(tha) - 1) + gz * Math.sin(tha);
    let c2 = 0.5 * FALL_G * Tf * Tf;
    if (vc === vc && Dc > 0) c2 = Dc - clamp(vc * Tf, 0, Dc);
    else if (!(Dc > 0) || c2 > Dc) c2 = Math.max(0, Dc);
    out[1] = a[2] + gy * (Math.cos(tha) - Math.cos(th)) + gz * (Math.sin(tha) - Math.sin(th)) - (Dc - c2) * w - c2 * w * w;
    return out;
  }
  out[1] = m === 1 ? a[2] + (b[2] - a[2]) * w * w : a[2] + (b[2] - a[2]) * w;
  return out;
}
// 整条轨迹在时刻 t：t 过了终点就是终点（直立）
function pathEval(P, t, out) {
  const end = P[P.length - 1];
  if (!(t < end[0])) { out[0] = end[1]; out[1] = end[2]; out[2] = end[3]; out[3] = 0; out[4] = P.nx || 0; out[5] = P.nz || 0; return out; }
  let k = 1;
  while (k < P.length - 1 && P[k][0] <= t) k++;
  const a = P[k - 1], b = P[k], w = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 1;
  return segAt(P, k, w, out);
}

// ---- 落在哪儿 ----
function landGround(T, lx, lz) {
  toWorld(T.pose, lx, 0, lz, tmpW);
  const py = num(T.pose.y, 0), g = groundAt(tmpW.x, tmpW.z, py);
  return fin(g) && Math.abs(g - py) <= THROW_LAND_DY ? g : null;
}
// 从高 yTop 竖直掉下去，(lx, lz) 底下先接住它的面：地面、碰撞体顶面（墙脚、货、柱子；车的 OBB 不算 —— 车会开走）、
// 没有碰撞体的东西的顶面（sideObs：柱础、护角、地牛……）。返回高度 | null（坑、台阶，或者会落在车上）。按 5 mm 的格子记下来（一次撞车里它们不动）
const tinyBox = { cx: 0, cz: 0, hx: 0.005, hz: 0.005, rot: 0, minY: 0, maxY: 0 };
function topAt(T, lx, lz, yTop) {
  const key = Math.round(lx * 200) + ',' + Math.round(lz * 200) + ',' + Math.round(yTop * 200);
  if (T.tops && T.tops.has(key)) return T.tops.get(key);
  let g = landGround(T, lx, lz);
  if (g != null) {
    toWorld(T.pose, lx, 0, lz, tmpW);
    const wx = tmpW.x, wz = tmpW.z, P = BR.phys;
    if (has(P, 'raycast') && yTop > g + 0.01) {
      let hit = null;
      try { hit = P.raycast(wx, yTop, wz, 0, -1, 0, yTop - g + 0.005, { ignoreKey: T.ign, skipBoxes: T.skip }); } catch (err) { hit = null; }
      if (hit && fin(+hit.y) && hit.y > g + 0.005) g = hit.obb || hit.y > yTop - 0.005 ? null : +hit.y;
    }
    if (g != null && T.sideHit) {
      tinyBox.cx = wx; tinyBox.cz = wz;
      for (const e of T.side) {
        const top = Math.max(+e.minY, +e.maxY);
        if (!(top > g + 0.005) || top > yTop + 0.002) continue;
        let on = false;
        try { on = T.sideHit(tinyBox, e); } catch (err) { on = false; }
        if (on) g = top;
      }
    }
  }
  if (T.tops) T.tops.set(key, g);
  return g;
}
function fallTime(dy) { return Math.sqrt(2 * Math.max(0, dy) / FALL_G); }
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

// ---- 一排的计划 ----
// L(v)：最靠车那件静止时离叉尖至少多远（2 m/s 0.2 m、3.9 m/s 及以上 0.5 m、中间线性；返修 r12 裁定 A 起是下限）
function throwL(v0) { return clamp(THROW_D0 + (v0 - THROW_V) * (THROW_D1 - THROW_D0) / (THROW_L_V1 - THROW_V), THROW_D0, THROW_D1); }
// 叉尖前面没被挡住时整排平移多远（返修 r12 裁定 A）：D = max(最靠车那件最靠车的一点到叉尖的距离 + L(v), v² / (2·0.4 g))。
// 这样整排的初速就是撞前车速 v（水平速度在撞上那一帧连续），减速度 v² / (2D) ≤ 0.4 g；车越快滑得越远（撞前 3.9 m/s 时最靠车那件离叉尖约 1.5 m，顶速约 4.4 m/s 时约 2.1–2.4 m）
function throwDfull(rear, tip, v0) { const v = Math.max(0, num(v0, THROW_V)); return Math.max(0, rear - tip + throwL(v), v * v / (2 * THROW_DEC)); }
// 整排平移 D 用多久停下：初速 min(撞前车速, √(2·0.4g·D))，匀减速。D ≥ v²/(2·0.4g)（没被挡住）时初速 = 撞前车速；
// 被挡住、D 缩短到不够按 0.4 g 从 v 减到 0 时初速才降到 √(0.8g·D)（这时撞上那一下货跟着顿一下，裁定 A 认可）
function rowTime(D, v0) {
  if (!(D > 1e-6)) return 0;
  const vi = Math.min(Math.max(num(v0, THROW_V), 0.1), Math.sqrt(2 * THROW_DEC * D));
  return clamp(2 * D / vi, 0.02, THROW_T_ROW);
}
// 货叉上的一件（车本地，撞上那一刻）：原点、模型的点（相对包围盒中心下面那一点 C）、包围盒、重心过叉尖要平移多远 sA、最多歪多少
function prepItem(T, id, r, it) {
  const sh = typeShape(it);
  if (!sh) return null;
  const pose = T.pose, o = it.obj;
  // 模型朝向按撞上那一刻（riders 跟车转：r.rot0 + 车转过的角度）；原点按 riders 记的车本地位置、叉面 + dy
  let e, ry = 0;
  try {
    ry = num(r.rot0, num(it.rotY, 0)) + adiff(num(r.yaw0, pose.yaw), num(pose.yaw, 0));
    const eu = new THREE.Euler(o.rotation.x, ry, o.rotation.z, o.rotation.order), M = new THREE.Matrix4().makeRotationFromEuler(eu);
    M.scale(o.scale);
    e = M.elements;
  } catch (err) { return null; }
  const Lc = linCar(e, num(pose.yaw, 0)), Li = inv3(Lc);
  if (!Li) return null;
  const ox = num(r.lx, 0), oz = num(r.lz, 0), oy = T.surf + num(r.dy, 0);
  const V = sh.V, nv = V.length / 3, Vc = new Float32Array(V.length);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    const cx = Lc[0] * x + Lc[1] * y + Lc[2] * z, cy = Lc[3] * x + Lc[4] * y + Lc[5] * z, cz = Lc[6] * x + Lc[7] * y + Lc[8] * z;
    Vc[i] = cx; Vc[i + 1] = cy; Vc[i + 2] = cz;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
  }
  const cn = -(z0 + z1) / 2, lift = -y0, H = y1 - y0;
  // 相对 C = (原点 x, 底面, 包围盒中心 z) 的点：查碰撞用 P（顶点 + 边加密），算「托着它的那一截」用顶点
  const P = sh.P, Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    Q[i] = Lc[0] * x + Lc[1] * y + Lc[2] * z; Q[i + 1] = Lc[3] * x + Lc[4] * y + Lc[5] * z - y0; Q[i + 2] = Lc[6] * x + Lc[7] * y + Lc[8] * z + cn;
  }
  for (let i = 0; i < nv; i++) { Vc[3 * i + 1] -= y0; Vc[3 * i + 2] += cn; }
  const bot0 = oy + y0, cz0 = oz - cn, E = (z1 - z0) / 2;
  // 看得见的重心（模型三角面按面积加权的质心，返修 r12 裁定 B / C）：相对 C 的 [x（相对原点）, 比底面高多少, 往车尾多远]
  const sc = sh.com, g = [Lc[0] * sc[0] + Lc[1] * sc[1] + Lc[2] * sc[2], Lc[3] * sc[0] + Lc[4] * sc[1] + Lc[5] * sc[2] - y0, Lc[6] * sc[0] + Lc[7] * sc[1] + Lc[8] * sc[2] + cn];
  // 支撑凸包（离底面 ≤2 mm 的顶点，相对 C 的 [x, z]）：落地、落在矮东西顶上时这些点底下都得是同一个面（放得稳）
  const cp = [];
  for (let i = 0; i < nv; i++) if (Vc[3 * i + 1] <= SUP_TOL) cp.push(Vc[3 * i], Vc[3 * i + 2]);
  // 绕横轴转的回转半径²（模型三角面按面积分布，相对重心；翻下叉尖时算角加速度用）
  let k2 = 0, kA = 0;
  const Tg = sh.T;
  if (Tg) for (let t = 0; t < Tg.length; t += 3) {
    const a3 = 3 * Tg[t], b3 = 3 * Tg[t + 1], c3 = 3 * Tg[t + 2];
    const ux = Vc[b3] - Vc[a3], uy = Vc[b3 + 1] - Vc[a3 + 1], uz = Vc[b3 + 2] - Vc[a3 + 2], wx = Vc[c3] - Vc[a3], wy = Vc[c3 + 1] - Vc[a3 + 1], wz = Vc[c3 + 2] - Vc[a3 + 2];
    const ar = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    const my = (Vc[a3 + 1] + Vc[b3 + 1] + Vc[c3 + 1]) / 3 - g[1], mz = (Vc[a3 + 2] + Vc[b3 + 2] + Vc[c3 + 2]) / 3 - g[2];
    k2 += ar * (my * my + mz * mz); kA += ar;
  }
  k2 = kA > 0 ? k2 / kA : (H * H + 4 * E * E) / 12;
  const I = { id, it, r, sh, Lc, Li, ox, oy, oz, cn, lift, H, E, bot0, cz0, ry, sC: cz0 - T.tip, sA: cz0 + g[2] - T.tip, rear0: oz + z1, front0: oz + z0, g,
    xa: ox + x0, xb: ox + x1, comX: ox + g[0], bx: [x0, x1], bzc: [z0 + cn, z1 + cn], Q, Vc, fr: footRaw(it), capMul: 1, EsT: null, Lt: null, cap: THROW_TILT_MAX, prof: profHull(Vc), cpts: hullPts(cp), k2 };
  // 翻下去时最多歪多少：THROW_TILT_MAX；前端最多低下去 2E·sinθ，不碰棱下面的地
  const gA = landGround(T, ox, T.tip - E), clear = bot0 - (gA == null ? T.py : gA) - 0.012;
  I.cap0 = clamp(Math.asin(clamp(clear / (2 * Math.max(0.005, E)), 0, 1)), 0.02, THROW_TILT_MAX);
  return I;
}
// 托着它的那一截（只算横着落在 strips 里的部分 —— 这根 / 这两根货叉的叉面那一条，伸出去的下面是空的）随倾斜变化的表：
// 比底面高的部分也算：底面贴着叉面那一截过了棱，它还在叉面上方的话，往下一掉就搁在棱上（针筒的推杆、推杆盘）。放上货叉时 orientOnTine 已经保证底面真的贴着叉面
// EsT[k] = 倾斜 θk = k·THROW_TILT_MAX / (ES_N − 1) 时，托着的那一截里 (离 C 往后多远 − 高 × tan θk) 的最大值。整件离开叉面 ⟺ 离棱走过的距离 ≥ EsT(θ)·cos θ。
// 按模型的每条边裁到 strips 里取两个端点（这个量沿边是线性的，最大值一定在端点上），不漏长棱中间横跨叉面的那一截
function esTable(I, strips) {
  const T = new Float32Array(ES_N).fill(-1), tg = new Float32Array(ES_N), V = I.Vc, Ed = I.sh.E, ox = I.ox;
  for (let k = 0; k < ES_N; k++) tg[k] = Math.tan(k * THROW_TILT_MAX / (ES_N - 1));
  // 只有「往后更远、又不更高」的点才可能是某个 θ 下的最大值：先按高度每 1 mm 一格记每格里最靠后的那一点，再逐格算 16 个倾斜（点很多时省得每点算 16 次）
  const HB = 1e-3, nh = Math.max(1, Math.min(400, Math.ceil(I.H / HB) + 1)), best = new Float64Array(nh).fill(-Infinity);
  const add = (r, h) => { const b = Math.min(nh - 1, Math.max(0, Math.floor(h / HB))); if (r > best[b]) best[b] = r; };
  for (const [lo, hi] of strips) {
    const a0 = lo - ES_PAD - ox, b0 = hi + ES_PAD - ox;
    for (let i = 0; i < Ed.length; i += 2) {
      const p = 3 * Ed[i], q = 3 * Ed[i + 1];
      let xa = V[p], xb = V[q];
      if ((xa < a0 && xb < a0) || (xa > b0 && xb > b0)) continue;
      let ta = 0, tb = 1;
      if (Math.abs(xb - xa) > 1e-9) {
        let u0 = (a0 - xa) / (xb - xa), u1 = (b0 - xa) / (xb - xa);
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        ta = Math.max(0, u0); tb = Math.min(1, u1);
        if (ta > tb) continue;
      }
      add(V[p + 2] + (V[q + 2] - V[p + 2]) * ta, V[p + 1] + (V[q + 1] - V[p + 1]) * ta);
      add(V[p + 2] + (V[q + 2] - V[p + 2]) * tb, V[p + 1] + (V[q + 1] - V[p + 1]) * tb);
    }
  }
  // 每格按格子下沿的高度算（同一格里的点高不超过下沿 1 mm：r − h·tanθ 最多高估 1 mm × tan 17° ≈ 0.3 mm，偏向「还托着」）
  for (let b = 0; b < nh; b++) {
    const r = best[b];
    if (r === -Infinity) continue;
    const h = b * HB;
    for (let k = 0; k < ES_N; k++) { const v = r - h * tg[k]; if (v > T[k]) T[k] = v; }
  }
  for (let k = 0; k < ES_N; k++) T[k] = Math.max(0, T[k]);
  I.EsT = T;
}
function esAt(I, th) {
  const T = I.EsT, x = clamp(th / THROW_TILT_MAX, 0, 1) * (ES_N - 1), k = Math.min(ES_N - 2, Math.floor(x)), f = x - k;
  return T[k] + (T[k + 1] - T[k]) * f;
}
// 托着它的底面（返修 r12 裁定 C）：模型在叉面那一条（strips）正上方那部分的「侧面下轮廓」η(ζ)（ζ 相对 C 往车尾、η 比底面高多少，每 1 mm 一格，
// 按三角形裁到 strips 里再投到侧面上取最低）。由它定：
//   sA（往前的支撑什么时候没了）：重心前面（含重心那一格）离底面 ≤2 mm、最靠后的那一格过了叉尖 —— 底是平的就是重心过叉尖；PTG-B 按静止姿态
//     指托下沿和针帽着地、中间的针管离底面 1–2 cm：针帽一过叉尖，前面就没有托着的了，从这时候起就绕还在叉面上的指托往前栽；
//   Lt（翻下叉尖时真实的接触）：倾斜 θ、C 离叉尖往前 a 时，叉尖后面（还在货叉上方）的点里最低的那一点比 C 高多少 L(θ, a)；C 往下掉多少只能是它
//     （东西一直真的靠着叉尖那条棱或叉面上的点，不会绕看不见的点转）。表里存的是重心的落差 LG = L + gy·(1 − cos θ) − gz·sin θ。
//   底在这一段里是平的、而且托着它的就是这块平底（瓶子、罐头、盒子）时不建表，按「底面所在的平面贴着棱」解析地算（和 r11 一样）
const ENV_DZ = 0.001, LT_DA = 0.002, LT_FLAT = 0.0015;
function clipX(poly, x, keepGreater) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = keepGreater ? a[0] >= x : a[0] <= x, ib = keepGreater ? b[0] >= x : b[0] <= x;
    if (ia) out.push(a);
    if (ia !== ib) { const f = (x - a[0]) / (b[0] - a[0]); out.push([x, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
  }
  return out;
}
function lowTable(I, strips) {
  const V = I.Vc, Tr = I.sh.T, ox = I.ox;
  I.Lt = null;
  if (!Tr || !Tr.length) return;
  const z0 = I.bzc[0] - 0.002, z1 = I.bzc[1] + 0.002, nb = Math.max(2, Math.ceil((z1 - z0) / ENV_DZ) + 1);
  const env = new Float64Array(nb).fill(Infinity);
  const put = (z, y) => { const j = Math.round((z - z0) / ENV_DZ); if (j >= 0 && j < nb && y < env[j]) env[j] = y; };
  for (const [lo, hi] of strips) {
    const a0 = lo - ES_PAD - ox, b0 = hi + ES_PAD - ox;   // 和 esTable 同一条（外扩 2 mm）：表里没有点了 ⟺ 整件离开货叉
    for (let t = 0; t < Tr.length; t += 3) {
      const ia = 3 * Tr[t], ib = 3 * Tr[t + 1], ic = 3 * Tr[t + 2];
      if ((V[ia] < a0 && V[ib] < a0 && V[ic] < a0) || (V[ia] > b0 && V[ib] > b0 && V[ic] > b0)) continue;
      let poly = [[V[ia], V[ia + 1], V[ia + 2]], [V[ib], V[ib + 1], V[ib + 2]], [V[ic], V[ic + 1], V[ic + 2]]];
      poly = clipX(clipX(poly, a0, true), b0, false);
      for (let k = 0; k < poly.length; k++) {
        const u = poly[k], v = poly[(k + 1) % poly.length];
        put(u[2], u[1]);
        const ja = Math.ceil((Math.min(u[2], v[2]) - z0) / ENV_DZ), jb = Math.floor((Math.max(u[2], v[2]) - z0) / ENV_DZ), dz = v[2] - u[2];
        if (Math.abs(dz) < 1e-12) continue;
        for (let j = Math.max(0, ja); j <= Math.min(nb - 1, jb); j++) { const zz = z0 + j * ENV_DZ, y = u[1] + (v[1] - u[1]) * (zz - u[2]) / dz; if (y < env[j]) env[j] = y; }
      }
    }
  }
  // 往前的支撑：重心那一格离底面 ≤2 mm 就是重心本身，不然是重心前面离底面 ≤2 mm 的最靠后的一格
  const gz = I.g[2], jg = clamp(Math.round((gz - z0) / ENV_DZ), 0, nb - 1);
  let js = -1;
  for (let j = jg; j >= 0; j--) if (env[j] <= SUP_TOL) { js = j; break; }
  const zs = js < 0 || js === jg ? gz : z0 + js * ENV_DZ;
  I.sA = I.sC + zs;
  // 平底：从支撑点往车尾、一直到整件离开货叉时最后过叉尖的那一点，底都贴着底面（≤1.5 mm：瓶底、罐底外圈的小倒角也算平）——
  // 翻下叉尖时托着它的一直是这块底，按「底面所在的平面贴着棱」算就是真实的接触
  let aMax = -Infinity;
  for (let k = 0; k < ES_N; k++) aMax = Math.max(aMax, I.EsT[k]);
  const jE = clamp(Math.floor((aMax - z0) / ENV_DZ), 0, nb - 1);
  let flat = true;
  for (let j = Math.max(0, js < 0 ? jg : js); j <= jE; j++) if (!(env[j] <= LT_FLAT)) { flat = false; break; }
  if (flat) return;
  // 表：θ 按 esTable 的 16 档，a 从支撑点前 4 mm 到整件离开货叉后 4 mm，每 2 mm 一格
  const pts = [];
  for (let j = 0; j < nb; j++) if (env[j] < Infinity) pts.push(z0 + j * ENV_DZ, env[j]);
  const np = pts.length / 2;
  if (np < 2) return;
  const A0 = zs - 0.004, na = Math.max(2, Math.ceil((aMax + 0.004 - A0) / LT_DA) + 1), tab = new Float32Array(ES_N * na), zc = new Float32Array(ES_N * na);
  const Z = new Float64Array(np), Y = new Float64Array(np), ord = new Array(np), pm = new Float64Array(np);
  for (let k = 0; k < ES_N; k++) {
    const th = k * THROW_TILT_MAX / (ES_N - 1), c = Math.cos(th), sn = Math.sin(th);
    for (let i = 0; i < np; i++) { const z = pts[2 * i], y = pts[2 * i + 1]; Z[i] = z * c - y * sn; Y[i] = y * c + z * sn; ord[i] = i; }
    ord.sort((a, b) => Z[b] - Z[a]);   // 从车尾往前
    let m = Infinity, mz = 0;
    const pz = new Float64Array(np);
    for (let i = 0; i < np; i++) { if (Y[ord[i]] < m) { m = Y[ord[i]]; mz = Z[ord[i]]; } pm[i] = m; pz[i] = mz; }
    const add = I.g[1] * (1 - c) - gz * sn;
    let q = -1;
    for (let ai = na - 1; ai >= 0; ai--) {
      const a = A0 + ai * LT_DA;
      while (q + 1 < np && Z[ord[q + 1]] >= a) q++;
      tab[k * na + ai] = q < 0 ? NaN : pm[q] + add;   // 叉尖后面已经没有点：碰不着货叉了（已经离开）
      zc[k * na + ai] = q < 0 ? a : Math.max(a, pz[q]);   // 碰着的那一点（最低的那一点）水平在哪儿（相对 C，往车尾为正）
    }
  }
  I.Lt = { a0: A0, na, tab, zc };
}
// 重心的落差 LG(θ, a)：C 离叉尖往前 a、倾斜 θ 时，东西靠在货叉（叉尖那条棱 / 叉面）上，重心比静止时低多少。
// LGat.zc = 那时碰着的那一点水平在哪儿（相对 C，往车尾为正；平底就是叉尖那条棱）
function LGat(I, th, a) {
  const g = I.g, c = Math.cos(th), sn = Math.sin(th);
  if (!I.Lt) { LGat.zc = a; return a * sn / Math.max(1e-9, c) + g[1] * (1 - c) - g[2] * sn; }
  const L = I.Lt, x = clamp(th / THROW_TILT_MAX, 0, 1) * (ES_N - 1), k = Math.min(ES_N - 2, Math.floor(x)), f = x - k;
  const y = clamp((a - L.a0) / LT_DA, 0, L.na - 1), i = Math.min(L.na - 2, Math.floor(y)), e = y - i, T = L.tab, Z = L.zc, n = L.na;
  const lerp2 = A => { const v0 = A[k * n + i] + (A[k * n + i + 1] - A[k * n + i]) * e, v1 = A[(k + 1) * n + i] + (A[(k + 1) * n + i + 1] - A[(k + 1) * n + i]) * e; return v0 + (v1 - v0) * f; };
  LGat.zc = lerp2(Z);
  return lerp2(T);
}
LGat.zc = 0;
// 翻下叉尖（往前的支撑没了起，tA 时刻；返修 r12 裁定 C 重写）：每 1 ms 一步 ——
//   靠着货叉时：绕真正碰着的那一点（LG 表里最低的那一点：平底就是叉尖那条棱，PTG-B 先是还在叉面上的指托、针管落到棱上以后是棱）转，
//     角加速度 = gc·（重心离那一点的水平距离）/（k² + 重心到那一点的距离²）（k² 按模型三角面的面积分布算，gc 是重力，会歪过 cap 时收小）；
//     重心的位置由「刚好贴着货叉」定（LG）。要贴着就得让重心比自由落体落得还快 → 东西离开货叉，接下来按重力自由落、照原来的转速接着转；
//     自由落的路上又碰上货叉（LG < 重心落差）→ 贴上去、这一下不再转（不弹）；碰着的那一点从重心后面换到重心前面（同时搁在两处）→ 也不再转。
//   一直到叉面那一条正上方的最后一点过了棱（esTable）或者表里那一条上方已经没有它的点，整件离开货叉。
//   所以东西要么真的靠着货叉转，要么整件按重力落，不会绕看不见的点慢慢转。
// sf(t) = 整排在 t 时的位移。返回 { tau, drop（C 落了多少）, th, gc, dG（重心落了多少）, vG（重心往下的速度）, dth（倾斜的转速）,
//   segs（轨迹 mode 2 用的几段：[{ t（这段末了，相对 tA）, d1（这段末了 C 落了多少）, ths, drs（这段里等分的 θ、相对这段开头 C 又落了多少） }…]） }
// | { over: true }（靠着货叉转要歪过 cap）| null（整排先停了：这件挂在叉尖上 —— 这个 D 不行）
// 碰着 / 离开货叉的那一刻（ev：又碰上 2、碰着的那一点换边 3、离开 1）切成单独的几段（返修 r14，验收员 play：以前整段压成 16 等分、点之间插值，
// PTG-B 尾部又碰上叉尖那一下的减速被摊到前一个点开始，离叉尖还有 4–8 mm 就慢下来了）：每段在自己里面等分，速度突变正好落在段与段之间。
// 轨迹最多 8 个关键帧，翻下叉尖那段最多切 PV_SPLIT 刀：先切重心竖直速度突变大的（又碰上、换边），再切离开；整段按 PV_N 等分的密度分给各段
const PV_N = 32, PV_SPLIT = 3, PV_MIN_SEG = 0.0005;
// 交出去的 vG（离开货叉那一刻重心往下多快，mode 3 从它接着按重力落）按「1 ms 记录的那串位置」的导数给（FE1P H13，验收员 r15：3.9 m/s PTG-B 在 mode 2 → 3
// 那一刻竖直速度差约 5 mm/s）：半隐式欧拉每步先加速度后挪位置，位置串的斜率比这一步末了的 v 大半步的速度变化（自由落体 ½g·dt ≈ 4.9 mm/s），
// mode 2 的表是按位置串插的，mode 3 以前从 v 接着落，那一帧速度就小了一截。按 v + ½·(这一步的速度变化) 交出去，两边接上
function pivotRun(I, sf, tA, Tr, gc, cap) {
  const dt = 0.001, g = I.g, H = [0], TH = [0], DC = [0], EV = [], k2 = Math.max(1e-5, num(I.k2, 0.002));
  let dG = 0, vG = 0, vP = 0, th = 0, om = 0, touch = true, side = 0, pDiff = (sf(tA) - I.sC) - esAt(I, 0);
  for (let tau = dt; tA + tau <= Tr + 1e-9; tau += dt) {
    const a = sf(tA + tau) - I.sC, pth = th;
    let nd, nv;
    // 自由落体这一步落到哪儿（半隐式欧拉，和下面绕碰着的那一点转的积分同一种步法：不然第一步转角按 α·dt²、落差按 ½g·dt² 比，会假装「要比自由落体落得还快」而离开货叉）
    const dF = dG + (vG + FALL_G * dt) * dt;
    if (touch) {
      // 绕碰着的那一点转：力臂 = 碰着的那一点 − 重心（水平，往车尾为正 → 往前栽）
      const L0 = LGat(I, th, a);
      if (L0 !== L0) return finishPivot(H, TH, DC, Math.max(0.001, tau - dt), th, DC[DC.length - 1], gc, dG, vG + 0.5 * (vG - vP), om, EV);
      const c = Math.cos(th), sn = Math.sin(th), gX = g[2] * c - g[1] * sn, gY = g[1] * c + g[2] * sn, cY = L0 - g[1] * (1 - c) + g[2] * sn;   // C 落了多少 = 碰着的那一点比 C 高多少
      const x = LGat.zc - gX, r2 = x * x + (gY - cY) * (gY - cY), sd = x > 1e-4 ? 1 : x < -1e-4 ? -1 : side;
      if (side && sd && sd !== side) { om = 0; EV.push([H[H.length - 1], 3, -1]); }   // 碰着的那一点换到重心另一边：同时搁在两处，不再转（速度突变多大这一步末了再记）
      side = sd;
      om += gc * x / (k2 + r2) * dt;
      th = clamp(th + om * dt, 0, THROW_TILT_MAX);
      if (th <= 0 && om < 0) om = 0;   // 往回转到静止姿态就停住（叉面托着，不会比静止时还往后仰）
      if (th > cap + 1e-9) return { over: true };
      const lv = LGat(I, th, a);
      if (lv !== lv) return finishPivot(H, TH, DC, Math.max(0.001, tau - dt), pth, DC[DC.length - 1], gc, dG, vG + 0.5 * (vG - vP), om, EV);
      if (lv > dF + 1e-7) { nd = dF; nv = vG + FALL_G * dt; touch = false; EV.push([H[H.length - 1], 1, 0]); }   // 贴着货叉得比自由落体落得还快：离开货叉（按 g 自由落、接着转）
      else { nd = Math.max(dG, lv); nv = (nd - dG) / dt; }
    } else {
      // 碰不着货叉：接着转，快到 cap 时平滑慢下来（30 ms 的时间常数），不在空中一下子停住
      if (om > 0) om = Math.min(om, Math.max(0, cap - th) / 0.03);
      th = clamp(th + om * dt, 0, Math.max(cap, th));
      nd = dF; nv = vG + FALL_G * dt;
      const lv = LGat(I, th, a);
      if (lv !== lv) return finishPivot(H, TH, DC, Math.max(0.001, tau - dt), th, DC[DC.length - 1], gc, dG, vG + 0.5 * (vG - vP), om, EV);
      if (lv < nd) { nd = Math.max(dG, lv); nv = (nd - dG) / dt; om = 0; touch = true; side = 0; EV.push([H[H.length - 1], 2, -1]); }   // 又碰上货叉：贴上去，不弹
    }
    const c = Math.cos(th), dC = nd - g[1] * (1 - c) + g[2] * Math.sin(th);
    if (EV.length && EV[EV.length - 1][2] < 0) EV[EV.length - 1][2] = Math.abs(nv - (vG + FALL_G * dt));   // 这一步重心竖直速度突变了多少（又碰上、换边）
    const diff = a - esAt(I, th) * c;
    if (diff >= 0) {
      const f = pDiff < 0 ? -pDiff / (diff - pDiff) : 1, t1 = tau - dt + dt * f;
      return finishPivot(H, TH, DC, Math.max(0.001, t1), pth + (th - pth) * f, DC[DC.length - 1] + (dC - DC[DC.length - 1]) * f, gc, dG + (nd - dG) * f, vG + (nv - vG) * (f + 0.5), om, EV);
    }
    H.push(tau); TH.push(th); DC.push(dC);
    vP = vG; dG = nd; vG = nv; pDiff = diff;
  }
  return null;
}
// 翻下叉尖那一段收尾：在 tEnd 离开货叉（倾斜 thE、C 落了 dCE、重心落了 dG、往下 vG）。ev = [[时刻, 1 离开 | 2 又碰上 | 3 换边, 重心竖直速度突变多少]…]
// （时刻就在 1 ms 的网格点上，速度从这一点之后变）：挑最多 PV_SPLIT 个切开（又碰上、换边按速度突变从大到小先挑，再按时间挑离开；离两头、彼此不到 0.5 ms 的不切），
// 每段按时长分 4–PV_N 等分给轨迹的 θ 表、落差表
function finishPivot(H, TH, DC, tEnd, thE, dCE, gc, dG, vG, dth, ev) {
  while (H.length > 1 && H[H.length - 1] >= tEnd) { H.pop(); TH.pop(); DC.pop(); }
  H.push(tEnd); TH.push(thE); DC.push(dCE);
  const at = (A, tq) => {   // 1 ms 的记录在 tq 处（线性）
    let lo = 0, hi = H.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m] <= tq) lo = m; else hi = m; }
    const u = H[hi] > H[lo] ? clamp((tq - H[lo]) / (H[hi] - H[lo]), 0, 1) : 1;
    return A[lo] + (A[hi] - A[lo]) * u;
  };
  const cut = [];
  if (ev && ev.length) {
    const hit = ev.filter(e => e[1] !== 1 && e[2] > 1e-3).sort((x, y) => y[2] - x[2]), off = ev.filter(e => e[1] === 1);
    for (const e of hit.concat(off)) {
      if (cut.length >= PV_SPLIT) break;
      if (!(e[0] > PV_MIN_SEG) || !(e[0] < tEnd - PV_MIN_SEG) || cut.some(c => Math.abs(c - e[0]) < PV_MIN_SEG)) continue;
      cut.push(e[0]);
    }
    cut.sort((x, y) => x - y);
  }
  const bounds = [0].concat(cut, [tEnd]), segs = [];
  for (let k = 1; k < bounds.length; k++) {
    const t0 = bounds[k - 1], t1 = bounds[k], n = clamp(Math.round(PV_N * (t1 - t0) / tEnd), 4, PV_N), d0 = at(DC, t0);
    const ths = [], drs = [];
    for (let q = 0; q <= n; q++) { const tq = q === n ? t1 : t0 + (t1 - t0) * q / n; ths.push(at(TH, tq)); drs.push(at(DC, tq) - d0); }
    segs.push({ t: t1, d1: k === bounds.length - 1 ? dCE : at(DC, t1), ths, drs });
  }
  return { tau: tEnd, drop: dCE, th: thE, gc, dG, vG, dth, segs };
}
function pivotSolve(I, sf, tA, Tr) {
  const cap = I.cap0 * I.capMul;
  const pv = pivotRun(I, sf, tA, Tr, FALL_G, cap);
  if (!pv || !pv.over) return pv;
  let lo = 0, hi = FALL_G, best = null;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2, r = pivotRun(I, sf, tA, Tr, mid, cap);
    if (!r || r.over) { hi = mid; continue; }
    lo = mid; best = r;
  }
  if (best) return best;
  const r = pivotRun(I, sf, tA, Tr, Math.max(1e-4, lo), cap);
  return r && !r.over ? r : null;
}
// 落地 / 落在矮东西顶上放得稳（返修 r12 裁定 B）：重心和支撑凸包的每个顶点底下都是同一个面（差 ≤5 mm）→ 那个面的高度；不平 NaN；下面空着 / 坑 null。
// cx = 原点 x，cz = C 的 z（车本地，静止时）
function supportHull(T, I, cx, cz, yTop) {
  const g0 = topAt(T, cx + I.g[0], cz + I.g[2], yTop);
  if (g0 == null) return null;
  for (const q of I.cpts) {
    const g = topAt(T, cx + q[0], cz + q[1], yTop);
    if (g == null || Math.abs(g - g0) > 0.005) return NaN;
  }
  return g0;
}
// 整排平移 s 以后（还没翻下去、留在叉上）放得稳不稳（返修 r13，验收员 play：前面挡住、整排少滑一段时，留下的瓶子停在叉尖最前端、一半圆肚子伸出叉尖外）：
// 叉面那一条（strips 横着、叉尖到叉根）上离底面 ≤2 mm 的顶点，加上底面里的边（两头都离底面 ≤2 mm）被叉沿、叉尖、叉根裁出来的点，围成的凸包把重心包在里面往里多远
// （和 supportGap 放上货叉时的标准一样，只是叉尖跟着这一排往后挪了 s）。点不够 → −Infinity
function insetAt(T, I, s, strips) {
  const V = I.Vc, ox = I.ox, zt = s - I.sC, zh = T.heel - I.cz0 + s, pts = [];
  // 离底面 ≤2 mm 的顶点、两头都离底面 ≤2 mm 的边，按件收一次（二分要算十几次）
  if (!I.botV) {
    const bv = [], be = [], Ed0 = I.sh.E;
    for (let i = 0; i < V.length; i += 3) if (V[i + 1] <= SUP_TOL) bv.push(i);
    for (let i = 0; i < Ed0.length; i += 2) if (V[3 * Ed0[i] + 1] <= SUP_TOL && V[3 * Ed0[i + 1] + 1] <= SUP_TOL) be.push(Ed0[i], Ed0[i + 1]);
    I.botV = bv; I.botE = be;
  }
  const BV = I.botV, Ed = I.botE;
  for (const [lo, hi] of strips) {
    const a0 = lo - ox, b0 = hi - ox;
    for (const i of BV) {
      if (V[i] < a0 || V[i] > b0 || V[i + 2] < zt || V[i + 2] > zh) continue;
      pts.push(V[i], V[i + 2]);
    }
    for (let i = 0; i < Ed.length; i += 2) {
      const p = 3 * Ed[i], q = 3 * Ed[i + 1];
      const xa = V[p], za = V[p + 2], dx = V[q] - xa, dz = V[q + 2] - za;
      let ta = 0, tb = 1;
      if (Math.abs(dx) > 1e-12) { let u0 = (a0 - xa) / dx, u1 = (b0 - xa) / dx; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; } ta = Math.max(ta, u0); tb = Math.min(tb, u1); } else if (xa < a0 || xa > b0) continue;
      if (Math.abs(dz) > 1e-12) { let u0 = (zt - za) / dz, u1 = (zh - za) / dz; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; } ta = Math.max(ta, u0); tb = Math.min(tb, u1); } else if (za < zt || za > zh) continue;
      if (ta > tb) continue;
      if (ta > 0) pts.push(xa + dx * ta, za + dz * ta);
      if (tb < 1) pts.push(xa + dx * tb, za + dz * tb);
    }
  }
  if (pts.length < 6) return -Infinity;
  const hp = hull2(pts);
  if (!hp) return -Infinity;
  const gx = I.g[0], gz = I.g[2];
  let m = Infinity;
  for (let i = 0; i < hp.length; i += 3) m = Math.min(m, hp[i + 2] - (hp[i] * gx + hp[i + 1] * gz));
  return m;
}
// 留在叉上时最多能往前滑多远：两条都要满足 ——
//   ① 放得稳：重心在支撑凸包里往里 ≥3 mm（0 到 sA 之间二分，往前滑支撑只会被叉尖裁掉更多）；
//   ② 不停在叉尖边上（返修 r14，验收员 spec：闪电瓶、火盐这种歪着靠稳的圆东西只按 ① 会停在 3 mm 的极限上 —— 重心离叉尖 3–6 mm、
//      瓶肚子约一半伸出叉尖外，靠底边和叉尖那条线的交点撑着）：看得见的重心（网格质心）离叉尖至少 TIP_COM_MIN（2 cm）、
//      并且至少是「重心到这件最前端」那段的一半 —— 伸出叉尖的最多是重心前面那半截的一半（约整件的四分之一），整件大部分在叉面上。
// 撞上那一刻就不满足的（老存档、测试直接摆的）按「不比撞上那一刻更悬」算；量不出支撑（点不够）的 ① 不限
const TIP_COM_MIN = 0.02;
function tipComNeed(I) { return Math.max(TIP_COM_MIN, (I.E + I.g[2]) / 2); }
function stableSlide(T, I, strips) {
  const sA = Math.max(0, I.sA), c0 = I.sC + I.g[2];   // c0：撞上那一刻重心离叉尖多远（往车尾为正）
  const sT = Math.max(0, c0 - Math.min(tipComNeed(I), c0 - 1e-4));
  const lim = Math.min(sA, sT), i0 = insetAt(T, I, 0, strips);
  if (!(i0 > -Infinity)) return lim;
  const thr = Math.min(SUP_IN, i0 - 1e-4);
  if (insetAt(T, I, lim, strips) >= thr) return lim;
  let lo = 0, hi = lim;
  for (let k = 0; k < 14 && hi - lo > 2e-4; k++) { const m = (lo + hi) / 2; if (insetAt(T, I, m, strips) >= thr) lo = m; else hi = m; }
  return lo;
}
// 一件在整排平移 D（Tr 停下）时怎么走：留在叉上 / 翻下去落到哪儿。返回 { ok, why, hit, pl }
function planItem(T, I, D, Tr, sf) {
  if (D <= 1e-6) return { ok: true, pl: { stay: true } };
  if (D <= I.sA + 1e-6) {
    if (D > I.freeA + 1e-6) return { ok: false, why: 'blocked', hit: I.hitA };
    // 留在叉上的停下来也得放得稳、不停在叉尖边上（stableSlide：支撑凸包往里 ≥3 mm，重心离叉尖 ≥ max(2 cm, 重心到最前端的一半)）→ 这个 D 不行，整排再少滑一点
    if (I.sS != null && D > I.sS + 1e-6) return { ok: false, why: 'edge', hit: 'tip' };
    return { ok: true, pl: { stay: true } };
  }
  if (I.sA > I.freeA + 1e-6) return { ok: false, why: 'blocked', hit: I.hitA };
  const tA = I.sA <= 0 ? 0 : Tr * (1 - Math.sqrt(Math.max(0, 1 - I.sA / D)));
  const pv = pivotSolve(I, sf, tA, Tr);
  if (!pv) return { ok: false, why: 'stuck', hit: 'tip' };
  // 离开货叉以后：看得见的重心（质心）按重力落下，接着翻下叉尖那一段末了的速度（pv.vG），落地时直立（重心高 = 落点 + gy）。
  // 每 1/240 s 看重心底下的面，碰到就算落地（在那一小步里按抛物线解出落地的时刻）
  const tr = tA + pv.tau, gy = I.g[1], gz = I.g[2], yG0 = I.bot0 + gy - pv.dG, vG = pv.vG, yTop = I.bot0 + 0.002, mx = I.comX;
  let tL = null, gs = null, pu = 0;
  for (let u = 1 / 240; u < 2.5; u += 1 / 240) {
    const yc = yG0 - vG * u - 0.5 * FALL_G * u * u, cz = I.cz0 + gz - sf(tr + u), g = topAt(T, mx, cz, yTop);
    if (g == null) return { ok: false, why: 'surface', hit: 'ground' };
    if (yc <= g + gy) {
      const D2 = yG0 - g - gy, us = (-vG + Math.sqrt(vG * vG + 2 * FALL_G * Math.max(0, D2))) / FALL_G;
      tL = tr + clamp(us, pu, u); gs = g;
      break;
    }
    pu = u;
  }
  if (tL == null) return { ok: false, why: 'surface', hit: 'fall' };
  // 落点放得稳（重心和支撑凸包的顶点底下是同一个面）、是地面或离地 ≤0.3 m 的矮东西顶上；接着跟整排滑的那一段一直在同一个高度的面上；静止处不在地牛老碰撞体里
  const zL = I.cz0 - sf(tL), gL = landGround(T, mx, zL + gz), s0 = supportHull(T, I, I.ox, zL, yTop);
  if (gL == null || s0 == null || s0 !== s0 || Math.abs(s0 - gs) > 0.005 || gs - gL > LOW_TOP + 1e-6) return { ok: false, why: 'surface', hit: s0 !== s0 ? 'edge' : 'land' };
  const sL = sf(tL);
  if (D - sL > 1e-4) {
    for (let s = sL + 0.03; s < D; s += 0.03) { const g = topAt(T, mx, I.cz0 + gz - s, yTop); if (g == null || Math.abs(g - gs) > 0.005) return { ok: false, why: 'surface', hit: 'slide' }; }
    const se = supportHull(T, I, I.ox, I.cz0 - D, yTop);
    if (se == null || se !== se || Math.abs(se - gs) > 0.005) return { ok: false, why: 'surface', hit: 'rest' };
    const fc = freeAlong(T, I, gs, I.cz0 - sL, D - sL + 0.01, false);
    if (fc.d < D - sL - 1e-6) return { ok: false, why: 'blocked', hit: fc.hit };
  }
  if (inSkip(T, mx, I.cz0 + gz - D, gs, I.H, I.fr)) return { ok: false, why: 'surface', hit: 'jack' };
  return { ok: true, pl: { stay: false, tA, tr, tL, drop: pv.drop, gs, segs: pv.segs } };
}
// 直立着、底面高 yb、包围盒中心在 z = cz 的这件沿 −z 平移：最多走多远不碰（墙、柱子、sideObs、地上的物资；fork = true 时它还在叉面高度，不查这台车）
function freeAlong(T, I, yb, cz, maxD, fork) {
  const Q = I.Q, ox = I.ox, x0 = I.xa - THROW_PAD, x1 = I.xb + THROW_PAD, ylo = yb, yhi = yb + I.H, zf = cz + I.bzc[0], zr = cz + I.bzc[1];
  let best = Infinity, hit = null;
  const lists = fork ? [T.obs, T.items] : [T.obs, T.items, T.own];
  for (const L of lists) {
    for (const o of L) {
      if (o.x1 < x0 || o.x0 > x1 || o.z0 > zr + 0.01 || o.z1 < zf - maxD - 0.01 || o.yb <= ylo + THROW_TOL_Y || o.ya >= yhi - THROW_TOL_Y) continue;
      if (o.tine >= 0 && !fork) continue;
      const pad = o.k === 2 ? ITEM_GAP : THROW_PAD;
      for (let i = 0; i < Q.length; i += 3) {
        const d = rayObs(o, ox + Q[i], yb + Q[i + 1], cz + Q[i + 2], pad);
        if (d < best) { best = d; hit = o.tag; }
      }
      // 地上那件的角戳进这一件（反过来：它的点沿 +z 走进这件的截面）
      if (o.k === 2) {
        // 车本地（相对这件的原点：原点 = C + (0, lift, cn)）→ 这件的模型坐标；相对它往 +z 走
        const W = obsPts(o), L2 = I.Li, oy = yb + I.lift, oz = cz + I.cn;
        for (let i = 0; i < W.length; i += 3) {
          if (W[i] < x0 - 0.01 || W[i] > x1 + 0.01 || W[i + 2] > zr + 0.01) continue;
          const rx = W[i] - ox, ry = W[i + 1] - oy, rz = W[i + 2] - oz;
          const lx = L2[0] * rx + L2[1] * ry + L2[2] * rz, ly = L2[3] * rx + L2[4] * ry + L2[5] * rz, lz = L2[6] * rx + L2[7] * ry + L2[8] * rz;
          const d = raySlices(I.sh, lx, ly, lz, L2[2], L2[8], ITEM_GAP);
          if (d < best) { best = d; hit = o.tag; }
        }
      }
    }
  }
  return { d: best, hit };
}
// 这一件此刻（C = 包围盒中心下面那一点，往前歪 th）的点 i 在车本地哪儿
function ptAt(I, i, cx, cy, cz, c, s, out) {
  const Q = I.Q, x = Q[i], y = Q[i + 1], z = Q[i + 2];
  out[0] = cx + x; out[1] = cy + y * c + z * s; out[2] = cz + z * c - y * s;
  return out;
}
const tmpQ = [0, 0, 0], tmpE = [0, 0, 0, 0, 0, 0], tmpE2 = [0, 0, 0, 0, 0, 0];
// 此刻的外接盒（车本地）
function boxAt(I, cx, cy, cz, c, s, out) {
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const y of [0, I.H]) for (const z of I.bzc) { const yy = cy + y * c + z * s, zz = cz + z * c - y * s; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; if (zz < z0) z0 = zz; if (zz > z1) z1 = zz; }
  out[0] = cx + I.bx[0]; out[1] = cx + I.bx[1]; out[2] = y0; out[3] = y1; out[4] = z0; out[5] = z1;
  return out;
}
// 车本地的点 → 这件（此刻 C、倾斜 th）的模型坐标
function toItem(I, px, py, pz, cx, cy, cz, c, s, out) {
  const rx = px - cx, ry = py - cy, rz = pz - cz;
  const ux = rx, uy = ry * c - rz * s, uz = rz * c + ry * s;           // 转回直立（相对 C）
  const qx = ux, qy = uy - I.lift, qz = uz - I.cn;                      // 相对原点（车本地朝向）
  const L = I.Li;
  out[0] = L[0] * qx + L[1] * qy + L[2] * qz; out[1] = L[3] * qx + L[4] * qy + L[5] * qz; out[2] = L[6] * qx + L[7] * qy + L[8] * qz;
  return out;
}
const tmpBx = [0, 0, 0, 0, 0, 0], tmpBy = [0, 0, 0, 0, 0, 0];
// 翻下去、落下去那段（tA → tL）每 1/300 s 按顶点查一遍：墙、柱子、sideObs、这台车（翻下去那一小段不查托着它的货叉：底面平面贴着棱，几何上压不进去）、地上的物资
function sampleFall(T, I, P, pl, own) {
  const out = tmpE;
  for (let t = pl.tA, last = false; ; t += THROW_DT) {
    if (t >= pl.tL) { t = pl.tL; last = true; }
    pathEval(P, t, out);
    const th = out[3], c = Math.cos(th), s = Math.sin(th), cx = out[0], cy = out[1] - I.lift, cz = out[2] - I.cn, piv = t < pl.tr;
    const B = boxAt(I, cx, cy, cz, c, s, tmpBx);
    for (const L of [T.obs, T.own, T.items]) {
      for (const o of L) {
        if (o.x1 < B[0] - THROW_PAD || o.x0 > B[1] + THROW_PAD || o.z1 < B[4] - THROW_PAD || o.z0 > B[5] + THROW_PAD || o.yb <= B[2] + THROW_TOL_Y || o.ya >= B[3] - THROW_TOL_Y) continue;
        let pad = o.k === 2 ? ITEM_GAP : THROW_PAD;
        if (o.tine >= 0 && own[o.tine]) { if (piv) continue; pad = -THROW_TOL_Y; }
        for (let i = 0; i < I.Q.length; i += 3) { ptAt(I, i, cx, cy, cz, c, s, tmpQ); if (inObs(o, tmpQ[0], tmpQ[1], tmpQ[2], pad)) return o.tag; }
        if (o.k === 2) {
          const W = obsPts(o);
          for (let i = 0; i < W.length; i += 3) {
            if (W[i] < B[0] - 0.01 || W[i] > B[1] + 0.01 || W[i + 2] < B[4] - 0.01 || W[i + 2] > B[5] + 0.01) continue;
            toItem(I, W[i], W[i + 1], W[i + 2], cx, cy, cz, c, s, tmpQ);
            if (inSlices(I.sh, tmpQ[0], tmpQ[1], tmpQ[2], ITEM_GAP)) return o.tag;
          }
        }
      }
    }
    if (last) break;
  }
  return null;
}
// 同一排里两件（A 在前、B 在后）在 [t0, t1] 里压不压：先按侧面（沿滑动方向、竖直这个平面里的两个转过的矩形）粗查，压着了再按顶点查截面
// 侧面轮廓：模型的点投到「竖直 × 滑动方向」这个平面（相对 C：y 往上、z 往车尾）上的凸包顶点 [y, z, …]（逆时针）。同一排两件横着一样宽，
// 侧面轮廓（转过倾斜角）不压就一定不压（沿 x 投影是保守的）；比按包围盒的矩形紧（瓶子的瓶颈、罐头的圆边），pairHit 少走很多按点的查
function profHull(V) {
  // 先按高度每 2 mm 一格收每格 z 的最小、最大值（每格按格子上下沿各记一点：格子里的点都在这几点围成的矩形里，凸包只会大一点不会小），再求凸包
  let y1 = 0;
  for (let i = 1; i < V.length; i += 3) if (V[i] > y1) y1 = V[i];
  const nb = Math.max(1, Math.min(160, Math.ceil(y1 / 0.002))), zl = new Float64Array(nb).fill(Infinity), zh = new Float64Array(nb).fill(-Infinity);
  for (let i = 0; i < V.length; i += 3) {
    const b = Math.min(nb - 1, Math.max(0, Math.floor(V[i + 1] / Math.max(1e-9, y1) * nb)));
    if (V[i + 2] < zl[b]) zl[b] = V[i + 2];
    if (V[i + 2] > zh[b]) zh[b] = V[i + 2];
  }
  const P = [];
  for (let b = 0; b < nb; b++) {
    if (!(zl[b] <= zh[b])) continue;
    const ya = b * y1 / nb, yb = (b + 1) * y1 / nb;
    P.push([ya, zl[b]], [ya, zh[b]], [yb, zl[b]], [yb, zh[b]]);
  }
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-12) lo.pop(); lo.push(p); }
  for (let k = P.length - 1; k >= 0; k--) { const p = P[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 1e-12) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  const h = lo.concat(up), out = new Float64Array(h.length * 2);
  h.forEach((p, k) => { out[2 * k] = p[0]; out[2 * k + 1] = p[1]; });
  return out;
}
const profRA = [], profRB = [];
function profPlace(I, c, s, cy, cz, R) {
  const H = I.prof;
  R.length = H.length;
  for (let i = 0; i < H.length; i += 2) { const y = H[i], z = H[i + 1]; R[i] = cy + y * c + z * s; R[i + 1] = cz + z * c - y * s; }
}
// 两件的侧面轮廓（各自转过倾斜角、摆到此刻的位置）隔得开（沿某条边的法线分开 gap 以上）→ false；隔不开 → true（再按点查）
function profHit(A, ca, sa, cyA, czA, B, cb, sb, cyB, czB, gap) {
  if (!A.prof || !B.prof || A.prof.length < 6 || B.prof.length < 6) return true;
  profPlace(A, ca, sa, cyA, czA, profRA); profPlace(B, cb, sb, cyB, czB, profRB);
  for (let r = 0; r < 2; r++) {
    const P = r ? profRB : profRA, n = P.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, ax = P[j + 1] - P[i + 1], az = -(P[j] - P[i]), L = Math.hypot(ax, az);
      if (!(L > 1e-9)) continue;
      const ux = ax / L, uz = az / L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < profRA.length; k += 2) { const v = profRA[k] * ux + profRA[k + 1] * uz; if (v < a0) a0 = v; if (v > a1) a1 = v; }
      for (let k = 0; k < profRB.length; k += 2) { const v = profRB[k] * ux + profRB[k + 1] * uz; if (v < b0) b0 = v; if (v > b1) b1 = v; }
      if (a1 + gap <= b0 || b1 + gap <= a0) return false;
    }
  }
  return true;
}
// 两件撞上那一刻（直立、都在叉面上）按水平截面隔多远（返修 r13）：B 的点到 A 的截面凸包、A 的点到 B 的截面凸包，取最小（正 = 隔开）。
// 同一排的两件按 PAIR_GAP 查；撞上那一刻就比它近的（测试直接摆、贴着放的），只要不比那一刻更近就不算压着
function sliceDist(sh, x, y, z) {
  if (y <= sh.y0 + THROW_TOL_Y || y >= sh.y1 - THROW_TOL_Y) return Infinity;
  const S = sh.sl[Math.min(sh.sl.length - 1, Math.max(0, Math.floor((y - sh.y0) / SLICE_H)))];
  if (!S) return Infinity;
  let m = -Infinity;
  for (let i = 0; i < S.length; i += 3) { const d = S[i] * x + S[i + 1] * z - S[i + 2]; if (d > m) m = d; }
  return m;
}
function pairGap0(A, B) {
  let m = Infinity;
  const ay = A.oy - A.lift, az = A.oz - A.cn, by = B.oy - B.lift, bz = B.oz - B.cn;
  for (let r = 0; r < 2; r++) {
    const P = r ? A : B, Q = r ? B : A, py = r ? ay : by, pz = r ? az : bz, qy = r ? by : ay, qz = r ? bz : az;
    // 只看朝着对方那一面附近的点（离对方包围盒前后 1 cm 以内）：A 在前，B 的点看 z < A 的后沿 + 1 cm，A 的点看 z > B 的前沿 − 1 cm
    const zLim = r ? B.front0 - 0.01 : A.rear0 + 0.01;
    for (let i = 0; i < P.Q.length; i += 3) {
      const pzc = pz + P.Q[i + 2];
      if (r ? pzc < zLim : pzc > zLim) continue;
      ptAt(P, i, P.ox, py, pz, 1, 0, tmpQ);
      toItem(Q, tmpQ[0], tmpQ[1], tmpQ[2], Q.ox, qy, qz, 1, 0, tmpQ);
      const d = sliceDist(Q.sh, tmpQ[0], tmpQ[1], tmpQ[2]);
      if (d < m) m = d;
    }
  }
  return m;
}
// pad：两件至少隔多远（同一排的两件 PAIR_GAP；撞上那一刻就隔得比它近的，按那一刻的间隙少 0.5 mm —— 只要不比那一刻更近就不算压着）
function pairHit(A, PA, B, PB, t0, t1, pad) {
  const ea = tmpE, eb = tmpE2;
  if (pad == null) pad = ITEM_GAP;
  for (let t = t0, last = false; ; t += THROW_DT) {
    if (t >= t1) { t = t1; last = true; }
    pathEval(PA, t, ea); pathEval(PB, t, eb);
    const ca = Math.cos(ea[3]), sa = Math.sin(ea[3]), cb = Math.cos(eb[3]), sb = Math.sin(eb[3]);
    const axc = ea[0], ayc = ea[1] - A.lift, azc = ea[2] - A.cn, bxc = eb[0], byc = eb[1] - B.lift, bzc = eb[2] - B.cn;
    if ((ea[3] > 1e-4 || eb[3] > 1e-4 || Math.abs(ayc - byc) > 1e-4) && profHit(A, ca, sa, ayc, azc, B, cb, sb, byc, bzc, Math.max(0, pad))) {
      const BA = boxAt(A, axc, ayc, azc, ca, sa, tmpBx), BB = boxAt(B, bxc, byc, bzc, cb, sb, tmpBy);
      for (let i = 0; i < B.Q.length; i += 3) {
        ptAt(B, i, bxc, byc, bzc, cb, sb, tmpQ);
        if (tmpQ[0] < BA[0] - 0.01 || tmpQ[0] > BA[1] + 0.01 || tmpQ[2] < BA[4] - 0.01 || tmpQ[2] > BA[5] + 0.01 || tmpQ[1] < BA[2] - 0.01 || tmpQ[1] > BA[3] + 0.01) continue;
        toItem(A, tmpQ[0], tmpQ[1], tmpQ[2], axc, ayc, azc, ca, sa, tmpQ);
        if (inSlices(A.sh, tmpQ[0], tmpQ[1], tmpQ[2], pad)) return true;
      }
      for (let i = 0; i < A.Q.length; i += 3) {
        ptAt(A, i, axc, ayc, azc, ca, sa, tmpQ);
        if (tmpQ[0] < BB[0] - 0.01 || tmpQ[0] > BB[1] + 0.01 || tmpQ[2] < BB[4] - 0.01 || tmpQ[2] > BB[5] + 0.01 || tmpQ[1] < BB[2] - 0.01 || tmpQ[1] > BB[3] + 0.01) continue;
        toItem(B, tmpQ[0], tmpQ[1], tmpQ[2], bxc, byc, bzc, cb, sb, tmpQ);
        if (inSlices(B.sh, tmpQ[0], tmpQ[1], tmpQ[2], pad)) return true;
      }
    }
    if (last) break;
  }
  return false;
}
// 一件的轨迹（车本地）
function itemPath(I, D, Tr, sf, pl) {
  const K = [[0, I.ox, I.oy, I.oz, 0]];
  if (pl.stay) { if (D > 1e-5) K.push([Tr, I.ox, I.oy, I.oz - D, 0]); }
  else {
    if (pl.tA > 1e-4) K.push([pl.tA, I.ox, I.oy, I.oz - sf(pl.tA), 0]);
    // 翻下叉尖那一段：碰着 / 离开货叉的那一刻切开的几段（finishPivot），每段一个 mode 2 关键帧带自己的 θ 表、落差表（落差相对上一个关键帧）
    const segs = pl.segs && pl.segs.length ? pl.segs : [{ t: pl.tr - pl.tA, d1: pl.drop, ths: null, drs: null }];
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i], t = i === segs.length - 1 ? pl.tr : pl.tA + sg.t;
      const k2 = [t, I.ox, I.oy - (i === segs.length - 1 ? pl.drop : sg.d1), I.oz - sf(t), 2];
      if (sg.ths && sg.drs) { k2.th = sg.ths; k2.dr = sg.drs; }
      K.push(k2);
    }
    K.push([pl.tL, I.ox, pl.gs + I.lift, I.oz - sf(pl.tL), 3]);
    if (pl.tL < Tr - 1e-4) K.push([Tr, I.ox, pl.gs + I.lift, I.oz - D, 0]);
  }
  K.T = Tr; K.nx = 0; K.nz = -1; K.H = I.H; K.gz = I.g[2]; K.gy = I.g[1];
  return K;
}
// 整排平移 D 行不行：每件的轨迹都不碰、落在稳当面上。同一排两件压着时，后面那件翻下去歪得少一点再试（最多 3 次）
function rowEval(T, R, D, v0) {
  const Tr = rowTime(D, v0), sf = t => (t >= Tr ? D : D * sig(Tr, t));
  const own = R.own, plans = [];
  for (const I of R.items) {
    const r = planItem(T, I, D, Tr, sf);
    if (!r.ok) return { ok: false, why: r.why, hit: r.hit };
    const P = itemPath(I, D, Tr, sf, r.pl);
    if (!r.pl.stay) { const h = sampleFall(T, I, P, r.pl, own); if (h) return { ok: false, why: 'blocked', hit: h }; }
    plans.push({ I, pl: r.pl, P });
  }
  for (let tries = 0; ; tries++) {
    let bad = null;
    for (let i = 0; i < plans.length && !bad; i++) for (let j = 0; j < plans.length && !bad; j++) {
      if (i === j) continue;
      const a = plans[i], b = plans[j];
      if (a.I.cz0 > b.I.cz0 || (a.I.cz0 === b.I.cz0 && i > j)) continue;   // a 在前
      if (a.pl.stay && b.pl.stay) continue;
      if (a.I.xb + ITEM_GAP < b.I.xa || b.I.xb + ITEM_GAP < a.I.xa) continue;
      if (b.I.front0 - a.I.rear0 > 0.12) continue;
      const t0 = Math.min(a.pl.stay ? Infinity : a.pl.tA, b.pl.stay ? Infinity : b.pl.tA), t1 = Math.max(a.pl.stay ? 0 : a.pl.tL, b.pl.stay ? 0 : b.pl.tL);
      if (!(t1 > t0)) continue;
      const gk = a.I.id + '|' + b.I.id;
      if (!R.gap) R.gap = new Map();
      // 包围盒前后就隔开 1 cm 以上的不用按点量（截面凸包按面算的距离在尖角那里会比真实距离小，留足余量）
      if (!R.gap.has(gk)) R.gap.set(gk, b.I.front0 - a.I.rear0 >= 0.01 ? Infinity : pairGap0(a.I, b.I));
      const g0 = R.gap.get(gk), pad = Math.min(PAIR_GAP, g0 - 0.0005);
      if (pairHit(a.I, a.P, b.I, b.P, t0, t1, pad)) bad = [a, b];
    }
    if (!bad) break;
    // 先让后面那件翻下去时歪得少一点（最多 3 次），还压着就让前面那件歪得少一点（最多 3 次）；留在叉上的那件不用改
    const b = (tries < 3 ? [bad[1], bad[0]] : [bad[0], bad[1]]).find(q => !q.pl.stay);
    if (tries >= 6 || !b) return { ok: false, why: 'blocked', hit: 'item:' + bad[0].I.id };
    b.I.capMul *= 0.5;
    const r = planItem(T, b.I, D, Tr, sf);
    if (!r.ok) return { ok: false, why: r.why, hit: r.hit };
    b.pl = r.pl; b.P = itemPath(b.I, D, Tr, sf, r.pl);
    if (!r.pl.stay) { const h = sampleFall(T, b.I, b.P, r.pl, own); if (h) return { ok: false, why: 'blocked', hit: h }; }
  }
  return { ok: true, D, Tr, plans };
}
// 撞上那一刻的计划：每排 { items, D, Tr, plans, why, hit }。只读（不摆东西）
function planThrow(veh, v0, pose) {
  const Itm = BR.items;
  const rows0 = [];
  veh.riders.forEach((r, id) => { const it = Itm.find(id); if (it) rows0.push([String(id), r, it]); });
  rows0.sort((a, b) => a[1].lz - b[1].lz);
  const cap = rows0.slice(THROW_MAX), use = rows0.slice(0, THROW_MAX);
  const L = throwL(v0), fz = forkZ(), tx = tineX(), half = num(gv('forkW'), 0.1) / 2;
  // 场景先按一个保守的范围收（叉尖前方：整根货叉长 + L 或 v²/(2·0.4g) 里大的那个、再加 0.8 m；货叉两边 0.7 m），每件的外形量好以后再按实际的排算
  let xLo = Math.min(tx[0], tx[1]) - 0.7, xHi = Math.max(tx[0], tx[1]) + 0.7;
  const T = throwScene(veh, pose, xLo, xHi, fz[0] - Math.max(fz[1] - fz[0] + THROW_D1, throwDfull(0, 0, v0)) - 0.8);
  const items = [], fails = [];
  for (const [id, r, it] of use) {
    let I = null;
    try { I = prepItem(T, id, r, it); } catch (err) { once('prep', () => console.error('[vehicles] 甩货外形出错', err)); I = null; }
    if (I) items.push(I); else fails.push(id);
  }
  // 分排：左叉 / 右叉；两排的件横着有重叠（宽件）就合成一排
  const left = items.filter(I => I.r.lx < 0), right = items.filter(I => I.r.lx >= 0);
  let rows;
  const span = A => [Math.min(...A.map(I => I.xa)), Math.max(...A.map(I => I.xb))];
  if (left.length && right.length && span(left)[1] + ITEM_GAP >= span(right)[0]) rows = [{ items: items.slice(), own: [true, true] }];
  else rows = [left, right].map((A, i) => ({ items: A, own: [i === 0, i === 1] })).filter(R => R.items.length);
  const out = [];
  for (const R of rows) {
    const strips = [];
    for (let k = 0; k < 2; k++) if (R.own[k]) strips.push([tx[k] - half, tx[k] + half]);
    const Dfull = throwDfull(Math.max(...R.items.map(I => I.rear0)), T.tip, v0);
    for (const I of R.items) {
      esTable(I, strips);
      lowTable(I, strips);
      I.sS = stableSlide(T, I, strips);
      const f = freeAlong(T, I, I.bot0, I.cz0, Dfull + 0.05, true);
      I.freeA = f.d; I.hitA = f.hit;
    }
    // 走满 Dfull 不行：why / hit 记那时碰上了什么（留在叉上的件 how 写它），再二分到刚好不碰
    let res = rowEval(T, R, Dfull, v0), why = null, hit = null;
    if (!res.ok) {
      why = res.why; hit = res.hit;
      let lo = 0, hi = Dfull, good = rowEval(T, R, 0, v0);
      for (let it = 0; it < 11 && hi - lo > 0.0015; it++) {
        const mid = (lo + hi) / 2, r = rowEval(T, R, mid, v0);
        if (r.ok) { lo = mid; good = r; } else hi = mid;
      }
      res = good;
    }
    out.push({ items: R.items, D: res.D, Tr: res.Tr, plans: res.plans, why, hit, Dfull });
  }
  return { rows: out, cap, fails, L, T };
}
// 返回 [[id, x, y, z, path]…]（世界坐标；path = [[t, x, y, z, mode]…]，客机照着摆）：甩出去的、留在叉上但往前挪过的都在里面
function computeThrow(veh, v0, pose) {
  const I = BR.items;
  S.lastHow = [];
  if (!veh || !I || !has(I, 'find') || !veh.riders.size) return [];
  const t0 = nowMs();
  let plan = null;
  try { plan = planThrow(veh, v0, pose); } catch (err) { once('throw', () => console.error('[vehicles] 甩货轨迹出错', err)); plan = null; }
  const out = [];
  if (!plan) { veh.riders.forEach((r, id) => S.lastHow.push([String(id), 'stay:error'])); S.lastThrowMs = nowMs() - t0; return out; }
  S.lastRows = plan.rows.map(R => ({ D: r4(R.D), Dfull: r4(R.Dfull), Tr: r4(R.Tr), why: R.why, hit: R.hit, ids: R.items.map(I => I.id) }));
  for (const R of plan.rows) {
    for (const q of R.plans) {
      const it = q.I;
      S.lastHow.push([it.id, q.pl.stay ? 'stay:' + (R.why || 'blocked') : 'fwd', r4(R.D), r4(R.Tr), q.pl.stay ? R.hit || null : null]);
      if (!(R.D > 1e-4)) continue;
      const P = q.P, e = P[P.length - 1];
      const path = P.map(p => {
        toWorld(pose, p[1], 0, p[3], tmpW);
        // 时刻记到 0.1 ms（返修 r14：翻下叉尖那段按碰着 / 离开货叉切成几段，短的只有零点几到几毫秒，按 1 ms 取整会把短段里的等分表拉伸变形）；
        // 高度和 mode 2 的两张表记到 1 µm（返修 r14：表里相邻两点只隔几毫秒，按 0.1 mm 取整，插值出来的重心竖直加速度会在 ±0.6 g 之间来回抖 ——
        // 火盐、闪电瓶翻下叉尖那一小段，1/240 s 逐帧看重心落得忽快忽慢；关键帧高度取整到 0.1 mm，段与段接上的地方也会差出 0.1 mm）
        const k = [r4(p[0]), r4(tmpW.x), r6(p[2]), r4(tmpW.z), clamp(p[4] | 0, 0, 3)];
        if (p.th && p.dr) k.push(p.th.map(r6), p.dr.map(r6));   // mode 2：θ 表、C 的落差表（返修 r12）
        return k;
      });
      path[0].push(r4(it.cn), r4(it.lift), r4(R.Tr), q.pl.stay ? 1 : 0, r4(it.H), r4(it.g[2]), r4(it.g[1]));
      toWorld(pose, e[1], 0, e[3], tmpW);
      // 第 6 项：朝向 rotY（撞上那一刻；甩货不改偏航，落地也是它。返修 r13：客机按房主的朝向摆，不靠两边各自按同一 id 摆出来碰巧一样）
      out.push([it.id, r4(tmpW.x), r4(e[2]), r4(tmpW.z), path, r4(wrap(it.ry))]);
    }
  }
  for (const q of plan.cap) S.lastHow.push([q[0], 'stay:cap']);
  for (const id of plan.fails) S.lastHow.push([id, 'stay:error']);
  S.lastThrowMs = nowMs() - t0;
  return out;
}
// 测试口（只读）：同一份输入按撞上那一刻算 n 次（不摆、不记），返回耗时的中位数和每次的
function benchThrow(key, v0, n) {
  const veh = V.get(String(key != null ? key : S.seated));
  if (!veh || !veh.riders.size) return null;
  const ms = [], keep = S.lastHow, keepMs = S.lastThrowMs;
  for (let i = 0; i < Math.max(1, n | 0 || 5); i++) { const t0 = nowMs(); planThrow(veh, num(v0, THROW_V), veh.pose); ms.push(nowMs() - t0); }
  S.lastHow = keep; S.lastThrowMs = keepMs;
  const s = ms.slice().sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], all: ms.map(v => Math.round(v * 100) / 100) };
}

function planOnly(key, v0) {
  const veh = V.get(String(key != null ? key : S.seated));
  if (!veh) return null;
  const keep = S.lastHow, keepMs = S.lastThrowMs;
  const list = computeThrow(veh, num(v0, THROW_V), veh.pose), how = S.lastHow;
  S.lastHow = keep; S.lastThrowMs = keepMs;
  return { list, how, rows: S.lastRows || [] };
}

// ---- 摆过去、逐帧走、落地 ----
// 关键帧 [t, x, y, z, mode]（见 segAt）；第一个关键帧多带 [cn, lift, Tr, onFork, H]，写在返回的数组上（out.cn、out.lift、out.T、out.onFork、out.H，
// 还有 out.nx / out.nz = 起点到终点的水平方向）
function validPath(p) {
  if (!Array.isArray(p) || p.length < 2 || p.length > 8) return null;
  const out = [];
  let t0 = -1;
  const tabOk = A => Array.isArray(A) && A.length >= 2 && A.length <= 64 && A.every(v => fin(+v) && Math.abs(+v) < 5);
  for (let i = 0; i < p.length; i++) {
    const k = p[i];
    if (!Array.isArray(k) || k.length < 4) return null;
    const t = +k[0], x = +k[1], y = +k[2], z = +k[3], m = Math.round(num(+k[4], 0));
    if (!fin(t) || !fin(x) || !fin(y) || !fin(z) || t < t0 || t > 5) return null;
    const q = [t, x, y, z, m >= 0 && m <= 3 ? m : (k[4] ? 1 : 0)];
    // mode 2 带的表（θ、C 的落差；返修 r12）。第一个关键帧后面带的是 [cn, lift, …]，不是表
    if (i > 0 && q[4] === 2 && tabOk(k[5]) && tabOk(k[6]) && k[5].length === k[6].length) { q.th = k[5].map(Number); q.dr = k[6].map(Number); }
    out.push(q);
    t0 = t;
  }
  const k0 = p[0], a = out[0], b = out[out.length - 1], dx = b[1] - a[1], dz = b[3] - a[3], L = Math.hypot(dx, dz);
  out.cn = clamp(num(+k0[5], 0), -0.3, 0.3);
  out.lift = clamp(num(+k0[6], 0), LIFT_MIN, LIFT_MAX);
  const T = num(+k0[7], 0);
  out.T = T > 0 && T <= 5 ? T : 0;
  out.onFork = +k0[8] === 1;
  out.H = clamp(num(+k0[9], 0), 0, 1);   // 模型包围盒高（对方旧版没有就按 0）
  // 看得见的重心（质心）离 C 往车尾多远、比底面高多少（返修 r12；空中按它落，见 segAt 的 mode 3）；对方旧版没有就按包围盒中心（0、H/2）
  if (fin(+k0[11])) { out.gy = clamp(+k0[11], -0.5, 1); out.gz = clamp(num(+k0[10], 0), -1, 1); }
  out.nx = L > 1e-6 ? dx / L : 0; out.nz = L > 1e-6 ? dz / L : 0;
  return out;
}
// 车锁到什么时候：这一排停下的时刻（Tr）；老轨迹按离开叉面（第一个 mode 2 的关键帧，或者第一个比起点低 1 mm 以上的）
function offTime(P) {
  if (P.T > 0) return P.T;
  for (let i = 1; i < P.length; i++) if ((P[i][4] | 0) === 2 || P[i][2] < P[0][2] - 0.001) return P[i][0];
  return P[P.length - 1][0];
}
// 这台车撞车甩出去的那几排还没停下（S.falls 里 t < tOff），或者客机还在等房主回轨迹：车和货叉都先不动（见 stepSim）
function throwBusy(veh) {
  if (veh.throwWait && veh.throwWait > S.time) return true;
  for (const f of S.falls) if (f.veh === veh.key && f.t < f.tOff) return true;
  return false;
}
// 车锁着时按了油门 / 升降说哪句：有一件翻下叉尖（不是 onFork）的还没停 → falling；都留在叉上、还要锁 0.2 s 以上 → sliding；否则不说。
// 客机等房主回轨迹那一会儿还不知道会怎样，照多数情况说 falling
function busyNote(veh) {
  if (veh.throwWait && veh.throwWait > S.time) return T.falling;
  let fwd = false, rest = 0;
  for (const f of S.falls) {
    if (f.veh !== veh.key || !(f.t < f.tOff)) continue;
    if (!f.onFork) fwd = true;
    rest = Math.max(rest, f.tOff - (fin(f.t) ? f.t : 0));
  }
  busyNote.rest = rest;
  return fwd ? T.falling : rest > 0.2 ? T.sliding : null;
}
// 把轨迹摆过去：从货叉上松开（不再跟车）、抓住，逐帧由 stepFalls 照 path 摆，落地松手（单机、房主写 levelState）。
// late（客机：房主的结果晚于锁车时限才到）：不再播动画 —— 甩出去的直接摆到终点；留在叉上的按撞车那一刻的车位姿 cp 换到车本地，挂回现在的货叉上。
// fresh（本机司机这一帧的模拟里撞上的，返修 r11）= 这一步里撞上以后还剩的时间（秒）：车这一帧已经走到撞上那一刻，东西摆到轨迹起点（撞上那一刻的叉面位置）
// 就等于跟着车走到了撞上那一刻；同一帧后面的 stepFalls(dt) 只让它们再走这剩下的一点（不是整整一帧），不然撞上那一帧会多走一帧的路、往前「窜」一下
function applyThrow(veh, list, late, cp, fresh) {
  const I = BR.items;
  if (!I || !has(I, 'find') || !Array.isArray(list)) return 0;
  let n = 0;
  for (const e of list.slice(0, THROW_MAX)) {
    if (!Array.isArray(e) || e.length < 4) continue;
    const id = String(e[0]), x = +e[1], y = +e[2], z = +e[3];
    if (!fin(x) || !fin(y) || !fin(z)) continue;
    const it = I.find(id);
    if (!it || it.owner) continue;
    // 房主给的朝向（第 6 项，返修 r13；对方旧版没有就照本机的）：先转过去再摆，甩下去、挂回货叉都按它
    const ry = +e[5];
    if (e.length > 5 && fin(ry) && Math.abs(adiff(num(it.rotY, 0), ry)) > 1e-4) { it.rotY = ry; if (veh && veh.riders.has(id)) { const rd = veh.riders.get(id); rd.rot0 = ry; rd.yaw0 = veh.pose.yaw; } }
    let path = validPath(e[4]);
    if (path) {
      const f = path[path.length - 1];
      if (Math.abs(f[1] - x) > 0.01 || Math.abs(f[2] - y) > 0.01 || Math.abs(f[3] - z) > 0.01) path = null;
    }
    if (late && path && path.onFork && veh && cp) {
      // 车已经开走了：按撞车那一刻货叉上的位置挂回去（终点相对撞车位姿的车本地坐标）
      toLocal(cp, x, z, tmpL);
      toWorld(veh.pose, tmpL.x, 0, tmpL.z, tmpW);
      S.falls = S.falls.filter(f => f.id !== id);
      veh.riders.delete(id);
      if (has(I, 'move')) I.move(id, tmpW.x, forkSurface(veh) + path.lift, tmpW.z);
      attachItem(id, veh.key, true);
      n++;
      continue;
    }
    if (veh) veh.riders.delete(id);
    if (has(I, 'hold')) I.hold(id, true);
    it.still = true;   // 叉面上本来就是静止摆着的；落地以后也静静躺着
    if (!path) {
      // 对方旧版只给落点：从现在的位置水平匀速、竖直往下掉过去
      const x0 = num(it.x, x), y0 = num(it.y, y), z0 = num(it.z, z);
      path = [[0, x0, y0, z0, 0], [clamp(fallTime(y0 - y), 0.15, 0.7), x, y, z, 1]];
      path.cn = 0; path.lift = 0; path.T = 0; path.onFork = false; path.nx = 0; path.nz = 0; path.H = 0;
    }
    S.falls = S.falls.filter(f => f.id !== id);
    // tOff：这一排停下的时刻，在这之前这台车不动（见 stepSim）。rx / rz：模型本来的朝向（倾斜时在它上面再绕那条棱转，落地时转回来）
    const o = it.obj;
    S.falls.push({ id, path, t: late ? Infinity : 0, veh: veh ? veh.key : null, tOff: offTime(path), cn: num(path.cn, 0), lift: num(path.lift, 0), onFork: !!path.onFork,
      rx: o && o.rotation ? num(o.rotation.x, 0) : 0, rz: o && o.rotation ? num(o.rotation.z, 0) : 0, tilted: false, skip: fin(fresh) && !late ? 1 : 0, adv: fin(fresh) ? clamp(fresh, 0, 1) : 0 });
    // 马上摆到轨迹起点（撞停那一刻它在货叉上的位置）：这一帧车已经往前挪过，货叉上的东西不在这里摆一下会落后车一帧的路
    if (has(I, 'move') && !late) I.move(id, path[0][1], path[0][2], path[0][3]);
    n++;
  }
  if (veh) veh.riderSig = '';
  if (late) stepFalls(0);
  return n;
}
// 测试口 _step 里撞上的：这一步剩下的时间（fresh）马上走掉，和真开车时同一帧后面 stepFalls(dt) 走的那一点一样（只动这一步新甩出去的件）
function stepFresh() {
  const I = BR.items;
  for (const f of S.falls) {
    if (!f.skip) continue;
    f.skip = 0; f.t += f.adv;
    const it = I && has(I, 'find') ? I.find(f.id) : null, P = f.path;
    if (it && f.t < P[P.length - 1][0]) { pathEval(P, f.t, tmpFe); placeFall(I, it, f, tmpFe); }
  }
}
function stepFalls(dt, finish) {
  if (!S.falls.length) return;
  const I = BR.items;
  for (let i = S.falls.length - 1; i >= 0; i--) {
    const f = S.falls[i];
    const it = I && has(I, 'find') ? I.find(f.id) : null;
    if (!it) { S.falls.splice(i, 1); continue; }
    if (f.skip && !finish) { f.skip = 0; f.t += Math.min(dt, f.adv); } else f.t += dt;   // 撞上那一帧（fresh）只走撞上以后剩下的那一点
    const P = f.path, end = P[P.length - 1];
    if (!finish && f.t < end[0]) {
      pathEval(P, f.t, tmpFe);
      placeFall(I, it, f, tmpFe);
      continue;
    }
    untilt(it, f);
    it.still = true;   // 静静躺着（不浮动、不转圈，不会落地那一下往上弹）
    I.move(f.id, end[1], end[2], end[3]);
    if (has(I, 'hold')) I.hold(f.id, false);   // 松手：挪过就写进本层状态（丢弃物那张表；客机不写，等房主）
    const veh = f.onFork && f.veh != null ? V.get(f.veh) : null;
    if (veh) attachItem(f.id, veh.key, true);   // 留在叉上的：滑完挂回货叉（车这时候还锁着，没动过；不转朝向）
    else {
      const lv = lvNow();
      if (lv != null) { let set = S.lying.get(lv); if (!set) S.lying.set(lv, set = new Set()); set.add(f.id); }
      if (!finish) sfx('step', { x: end[1], y: end[2] + 0.1, z: end[3] }, { volume: 0.32, rate: 1.5 });
    }
    S.falls.splice(i, 1);
  }
}
// 甩出去的一件摆到轨迹上 e = [x, y, z, θ, nx, nz] 那里（x / y / z 是「直立时的原点」）。倾斜时绕包围盒中心下面那一点 C
// （= 原点 + cn·n − lift·ŷ，底面上）往 n 那边转 θ：原点 = C + (−cn·cosθ + lift·sinθ)·n + (cn·sinθ + lift·cosθ)·ŷ，朝向 = 绕 (ŷ × n) 转 θ ∘ 本来的朝向
const tmpFe = [0, 0, 0, 0, 0, 0];
let tiltQt = null, tiltAx = null;
function placeFall(I, it, f, e) {
  const th = e[3], o = it.obj;
  if (!(th > 1e-4) || !o || typeof THREE === 'undefined') { if (f.tilted) untilt(it, f); I.move(f.id, e[0], e[1], e[2]); return; }
  const s = Math.sin(th), c = Math.cos(th), nx = e[4], nz = e[5], cn = f.cn, lift = f.lift, k = -cn * c + lift * s;
  I.move(f.id, e[0] + (cn + k) * nx, e[1] - lift + cn * s + lift * c, e[2] + (cn + k) * nz);
  if (!tiltQt) { tiltQt = new THREE.Quaternion(); tiltAx = new THREE.Vector3(); }
  o.rotation.set(f.rx, num(it.rotY, 0), f.rz);
  tiltAx.set(nz, 0, -nx);
  if (tiltAx.lengthSq() > 1e-9) { tiltAx.normalize(); tiltQt.setFromAxisAngle(tiltAx, th); o.quaternion.premultiply(tiltQt); }
  f.tilted = true;
}
function untilt(it, f) {
  if (!f.tilted) return;
  f.tilted = false;
  if (it && it.obj && it.obj.rotation) it.obj.rotation.set(f.rx, num(it.rotY, 0), f.rz);
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
function logThrow(key, v0, list, by, id) {
  // how：每件 [id, 'fwd' 翻下叉尖落到地上 | 'stay:blocked' / 'stay:surface' / 'stay:stuck'（这一排被挡住缩短了，往前的支撑没过叉尖、留在叉上）| 'stay:cap' | 'stay:error',
  //   这一排平移了多远 D, 这一排停下的时刻 Tr, 留下时挡着它的是什么]，只有本机算的才有；一件都没动也记一条（list 为空）。
  // off：车锁了多久（这几排里最晚停下的那一排的 Tr）；dur：最后一件落地 / 停下的时刻 —— 这一批甩货的总时长（秒）
  let dur = 0, off = 0;
  for (const e of list) {
    const P = validPath(e[4]);
    if (!P) continue;
    dur = Math.max(dur, P[P.length - 1][0]);
    off = Math.max(off, offTime(P));
  }
  // kf（返修 r14，测试看）：每件轨迹关键帧的 [时刻, mode]（翻下叉尖那段按碰着 / 离开货叉切开的几段在这里看得出来）
  S.throws.push({ key, v0: r4(v0), list: list.map(e => e.slice(0, 4)), at: r4(S.time), by, id: id != null ? String(id) : null, how: by !== 'host' && S.lastHow ? S.lastHow.slice() : null, dur: r4(dur), off: r4(off),
    kf: list.map(e => [String(e[0]), Array.isArray(e[4]) ? e[4].map(k => [+k[0], k[4] | 0]) : []]) });
  S.lastHow = null;
  if (S.throws.length > 256) S.throws.shift();   // 测试一局里会撞几十次，按条数差数甩了几次
}
function throwRiders(veh, v0, rem) {
  const p = veh.pose;
  if (guest()) {
    const C = BR.coop;
    if (!C || !has(C, 'use')) return;
    const key = veh.key, e = eyeLocal();
    toWorld(p, e.x, e.y, e.z, tmpW);
    // 等房主回轨迹的这一会儿（一个来回）车也先刹住：房主按撞停那一刻的位姿算，车先开走的话东西会摆回原来的叉面高度上悬着。
    // 最多 5 s；房主的结果（回复或广播，同一个 id）晚于这个时限才到也照摆（onThrowResult 的 late）
    veh.throwWait = S.time + THROW_WAIT_S;
    veh.throwReq = S.time;
    try {
      C.use('k:' + key, 'fkthrow', [tmpW.x, tmpW.y, tmpW.z], res => {
        const vv = V.get(key);
        if (res && res.ok && res.r && Array.isArray(res.r.list)) {
          onThrowResult(res.r, v0);
          // 这就是房主对这一次的回复：同一个编号的广播先到、已经摆过（onThrowResult 按编号跳过）也一样不再等（返修 r11）
          if (vv) { vv.throwReq = null; vv.throwWait = 0; }
          return;
        }
        if (vv) vv.throwWait = 0;   // 没回应（4 s）/ 被拒：先解锁；房主的广播之后才到也照摆（onThrowResult 按 late 摆）
      }, { v0: r4(v0), x: r4(p.x), z: r4(p.z), yaw: r4(p.yaw), lift: r4(p.lift) });
    } catch (err) { veh.throwWait = 0; once('throwuse', () => console.error('[vehicles] coop.use(fkthrow) 出错', err)); }
    return;
  }
  const list = computeThrow(veh, v0, p);
  // 一件都没动（都 'stay:…'）也记一条（list 为空、how 里写着为什么留下），调试信息里查得到
  if (!list.length) { if (S.lastHow && S.lastHow.length) logThrow(veh.key, v0, list, 'me'); return; }
  applyThrow(veh, list, false, null, S.inFrame ? num(rem, 0) : null);
  const net = coopOn() && BR.coop && has(BR.coop, 'emit'), id = net ? throwId() : null;
  logThrow(veh.key, v0, list, 'me', id);
  if (net) {
    try { BR.coop.emit('fkthrow', { k: veh.key, list, id, p: [r4(p.x), r4(p.z), r4(p.yaw)], v0: r4(v0) }); } catch (err) { /* 对方旧版 */ }
  }
}
function throwId() { return 'h' + S.throwTok + ':' + (++S.throwSeq); }
// 房主：客机司机全速撞车了。车位姿按客机报的（撞停那一刻）；离房主这边看到的超过 1.5 m 就按房主的。
// 算好、摆好、写好状态以后，回复客机的 use，同时再广播一次 'fkthrow'（同一个 id）：回复晚于客机的 4 s 时限被丢掉时，客机照广播摆
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
  const id = throwId();
  logThrow(key, v0, list, 'peer', id);
  const r = { k: key, list, id, p: [r4(pose.x), r4(pose.z), r4(pose.yaw)], v0: r4(v0) };
  if (BR.coop && has(BR.coop, 'emit')) { try { BR.coop.emit('fkthrow', r); } catch (err) { /* 对方旧版 */ } }
  return { ok: true, r };
}
// 客机：房主算好的一次甩货（房主自己开车撞的广播，或者替客机算的回复 / 广播）。按 id 只摆一次；客机自己撞的、过了锁车时限才到的按 late 摆
function onThrowResult(r, v0) {
  if (!r || !Array.isArray(r.list)) return;
  const key = String(r.k || '').replace(/^k:/, ''), veh = V.get(key) || null, id = r.id != null ? String(r.id) : null;
  if (id) {
    if (S.seenThrows.has(id)) return;
    S.seenThrows.add(id);
    if (S.seenThrows.size > 64) S.seenThrows.delete(S.seenThrows.values().next().value);
  }
  // 客机自己撞的：车已经解锁了（等房主超时、或者过了 5 s）才到 —— 车可能已经开走，不再从撞车那一刻的位置播动画
  let late = false;
  if (veh && veh.throwReq != null) { late = !(veh.throwWait > S.time) || S.time - veh.throwReq >= THROW_WAIT_S - 1e-3; veh.throwReq = null; veh.throwWait = 0; }
  const cp = Array.isArray(r.p) && r.p.length >= 3 && fin(+r.p[0]) && fin(+r.p[1]) && fin(+r.p[2]) ? { x: +r.p[0], z: +r.p[1], yaw: +r.p[2] } : (veh ? veh.pose : null);
  applyThrow(veh, r.list, late, cp);
  logThrow(key, num(+r.v0, num(v0, 0)), r.list.slice(0, THROW_MAX), 'host', id);
}
function onNetThrow(p) {
  if (!guest() || !p || typeof p !== 'object' || !Array.isArray(p.list)) return;
  onThrowResult(p, 0);
}
// 物资在地上的水平外形（世界坐标的凸包，逆时针）和竖直范围：forklift.js 推地上物资时按它求和车的盒子压不压（返修 r10：以前按离竖轴最远的半径画圆，
// 长的、扁的隔空就被推开）。按物资缓存，位置、朝向变了再算。量不到模型 null
const footPolys = new WeakMap();
function footPoly(it) {
  if (!it || !it.obj) return null;
  const sh = typeShape(it);
  if (!sh) return null;
  const o = it.obj;
  o.updateMatrixWorld(true);
  const e = o.matrixWorld.elements;
  let c = footPolys.get(it);
  if (c && c.e.every((v, i) => Math.abs(v - e[i]) < 1e-7)) return c;
  const V = sh.V, xz = [];
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    xz.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]);
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  const hp = hull2(xz);
  if (!hp) return null;
  // 凸包的顶点（半平面相邻两条的交点）
  const n = hp.length / 3, pts = [];
  for (let i = 0; i < n; i++) {
    const a = 3 * ((i + n - 1) % n), b = 3 * i, det = hp[a] * hp[b + 1] - hp[a + 1] * hp[b];
    if (Math.abs(det) < 1e-12) continue;
    pts.push((hp[a + 2] * hp[b + 1] - hp[a + 1] * hp[b + 2]) / det, (hp[a] * hp[b + 2] - hp[a + 2] * hp[b]) / det);
  }
  c = { e: Array.from(e), pts, y0, y1, lift: Math.max(0, num(it.y, y0) - y0) };
  footPolys.set(it, c);
  return c;
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
    // world.lightAt 按画面上这盏灯的 range / intensity 算（FE1Q J8），驾驶舱另问 sim.litSeat
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
  S.seenThrows.clear();
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
    fallT: S.falls.map(f => [f.id, f.t]),   // 正在甩的每件走到轨迹上的哪个时刻（秒，从撞上那一刻算；测试按它找轨迹关键帧，返修 r14）
    throwBusy: Array.from(V.values()).filter(throwBusy).map(v => v.key),
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
  // 撞上那一步和真开车一样（返修 r13，验收员 tests：以前测试口这一步撞上，东西只摆到撞上那一刻、这一帧剩下的时间不走，撞上那一帧看着「顿一下」，
  // 「撞上那一帧水平速度连续」在这条路上查不了）：按 inFrame 甩出去，这一步剩下的时间马上走掉（真开车时是同一帧后面的 stepFalls 走）
  S.inFrame = true;
  try { stepSim(veh, num(dt, 1 / 60), inp ? fillInput(inp) : null, D); } finally { S.inFrame = false; }
  stepFresh();
  veh.liftMoving = Math.abs(veh.pose.lift - veh.lastLift) > 1e-5;
  veh.lastLift = veh.pose.lift;
  updateRiders();
  if (S.layoutDirty) layout(); else refreshMesh();
  S.cpuMs += nowMs() - t0; S.cpuN++;
  return Object.assign({}, veh.pose);
}

// 测试口（只读，FE1P H3）：载具层画的仪表台大灯开关，拨杆按 hl（缺省 1 = 开）转好，车本地坐标的三角形
// [[x0, y0, z0, x1, y1, z1, x2, y2, z2, 材质, r, g, b], …]（和 L1.js dashSwitch 比对：几何逐个一样，只有指示灯在 kit:glow、颜色是亮着的绿）
function _switchGeo(hl) {
  if (!BR.kit || !has(BR.kit, 'builder')) return null;
  const out = [], M = mRot(new Float64Array(12), 1, 0, 0, hl === 0 ? SW_ANG : -SW_ANG, SW_PIVOT[0], SW_PIVOT[1], SW_PIVOT[2]);
  for (const part of ['lightSwitch', 'lightToggle']) {
    const b = newBuilder();
    buildSwitch(b, part);
    b._accs.forEach((a, mk) => {
      if (typeof mk !== 'string' || !a || !a.idx) return;
      for (let i = 0; i < a.idx.length; i += 3) {
        const t = [];
        for (let j = 0; j < 3; j++) {
          const v = a.idx[i + j], x = a.pos[v * 3], y = a.pos[v * 3 + 1], z = a.pos[v * 3 + 2];
          if (part === 'lightToggle') t.push(M[0] * x + M[1] * y + M[2] * z + M[9], M[3] * x + M[4] * y + M[5] * z + M[10], M[6] * x + M[7] * y + M[8] * z + M[11]);
          else t.push(x, y, z);
        }
        const v0 = a.idx[i], c = a.col || a.color;
        t.push(mk);
        if (c && c.length >= (v0 + 1) * 3) t.push(c[v0 * 3], c[v0 * 3 + 1], c[v0 * 3 + 2]);
        out.push(t);
      }
    });
  }
  return out;
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
  BR.bus.on('coop:connected', () => S.seenThrows.clear());   // 联机连上（新的一场）：上一场记的编号不要了
}

BR.vehicles = {
  _benchThrow: benchThrow,   // 测试口（只读）：按这台车此刻货叉上的东西把甩货计划算 n 次，返回耗时中位数
  _planThrow: planOnly,      // 测试口（只读，返修 r12）：按这台车此刻货叉上的东西、撞前车速 v0 算一次，返回 { list（和广播的一样：[id, x, y, z, path]）, how, rows（每排 { D, Dfull, Tr, why, hit, ids }） }，不摆、不记
  list, byKey, mount, dismount, forceExit, cabFor, chestOf, seatWorld, dropSurface, attachItem, setPose,
  footOf: it => footRaw(it),   // 物资模型离它竖直转轴最远的水平距离（按类型量一次；forklift.js 在车旁找空地时用）
  footPoly,                    // 物资在地上的水平外形（世界坐标凸包）和竖直范围（forklift.js 推地上物资按它，返修 r10）
  update, applyChunk, unloadChunk, clear, debugInfo, _step, _switchGeo,
  lightSwitch, toggleLight,
  headlightLit: seatLit,   // 本机坐着的车大灯正亮着（L1 断电提示用）
  get seated() { return S.seated; },
  get handle() { return handle; },
};
})();
