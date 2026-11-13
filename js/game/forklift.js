// 后室 · 叉车模拟（BR.forklift，2026-10-06「叉车驾驶提前版」FE1）
// 纯模拟加环境互动：不建网格、不碰 levelState、不碰联机。BR.vehicles（js/game/vehicles.js）每帧调 sim.step，
// 拿回来的 pose 去摆载具网格、登记 phys OBB、放音效；核心和模拟之间只通过下面这几个函数交接。
//
// ---- 接口 ----
//   BR.forklift.geo              叉车几何：BR.L1forklift.geo（L1.js 的 FORKLIFT_GEO）叠在本文件的缺省值上；L1 没载入时全用缺省。
//                                另有本文件算出来的 wheelbase、front/rear（车头货叉尖 / 车尾最外的本地 z）、halfW（最宽处半宽）
//   BR.forklift.config           数值（速度、加速度、转向速率、升降速度、雷达距离、噪音……），见 CFG
//   BR.forklift.create(rec) → sim
//       rec：b.data.forklifts[i]（key, x, z, y, rot）或 levelState.vehicles[key] 加上 key（x, z, yaw, steer, lift, on）
//   BR.forklift.state(key) → 当前 pose 的拷贝 | null；BR.forklift.byKey(key) → sim | null；BR.forklift.list() → [sim…]
//   BR.forklift.sound(ev) → 'fk_' + ev（事件名 ↔ audio 音效名一一对应：bang ↔ fk_bang …）
//   BR.forklift.clearItems(obbs, opts?) → 挪了几件：把地上物资推到这组世界 OBB 外面（停着的车载入时用）
//
//   sim.step(dt, inp|null, env?) → { pose, events, note, noise, shake }
//     inp  = { throttle: −1..1（+ = W 前进）, steer: −1..1（+ = 往左打 = 按 A，和 vehicles.js 的 drvIn.steer 一致）, lift: −1..1（+ = R 升）, brake? }
//            只给 { move: {x, y}, liftUp, liftDown } 也行（move.x + = D 往右，和 BR.input.move 一致）。手机摇杆的模拟量直接当油门和方向。
//            null = 输入被关掉（暂停、结算、切后台）：油门 0、方向回正、不升降，急刹（0.55 s 内停住），雷达照常工作。
//     env  = 全部可选：{ phase: vehicles.js 的上车阶段 'mount'|'seat'|'start'|'run'（'run' 才算着车；点火声、「发动中」由 vehicles 管）,
//                        on: 发动机该开着（不给 phase 时用；这时点火 0.8 s、'ignite'/'off' 事件由本文件出）, local: 本机玩家在开,
//                        brake: 急刹（下车前刹停）, ignoreKey: 额外忽略的碰撞 key, riders: 叉面上的物资 id（Map/Set，不推、不当障碍）,
//                        pushItems: false 不推物资, vines: false 不拨藤蔓 }
//            phase、on 都没给、也没调过 start()/stop()：收到非 null 的 inp 就当着车（不出点火事件），null 时保持原样。
//     pose = { x, z, y, yaw, steer, lift, spd, lever, engine,             ← 方案定的字段
//              carriage, inner, rpm, hyd, beep, on }                      ← 附带（音效、模型用）
//            x/z/yaw = 车身原点（车底投影中心）和朝向，和 b.data.forklifts 的 x/z/rot 同一个约定（kit 的 rot：本地 −z = 车头）；
//            steer = 后轮真实转角（弧度，kit 的旋转约定，和 forkliftModel 里后轮 push 的角度同号）：按 A 是负的 —— 后轮朝右前方、
//            车尾往右甩、车头往左（后轮转向）。方向盘该转 −steer × steerRatio（正 = 司机看来逆时针 = 往左打）；lift = 0..1（forkliftModel 的 lift，
//            货叉架升 2.6·lift 米、内门架升 1.3·lift 米）；spd = 车速 m/s（+ 前进）；lever = 升降杆 −0.35..0.35 rad（+ = 往后扳 = 升）；
//            engine = 0 熄火 / 0..1 起动中（进度）/ 1 着车；rpm 0..1；hyd = 液压泵在转（在升或降）；beep = 倒车蜂鸣该响
//     events = 这一步发生的事，字符串：'ignite' 'off' 'bang' 'bump' 'radar' 'end' 'strain'（音效名 = 'fk_' + 事件名）
//     note   = 状态行文字 | null（「发动中」「雷达自动刹车」「前面是出口，下车走过去」……，见 playerSpec texts；倒车撞上的说「后面是出口，下车走过去」
//              「后面有东西挡着，下车把它拖开」，repair-r1 新加，返修 r3 已同步进方案 playerSpec.texts）
//     noise  = 0 熄火 / 0.25 怠速 / 0.6 行驶 / 0.8 倒车；本机在开时另外每步调 BR.entities.makeNoise（只在噩梦模式生效）
//     shake  = 这一步要不要抖镜头：撞上（≥ 0.8 m/s）时 0.15（秒），系统设了减少动态效果时恒为 0
//   sim.obbsWorld() → [{ name, cx, cz, hx, hz, rot, minY, maxY }] × 14（当前 pose 的世界 OBB，phys.addOBBs 的格式）
//   sim.exitSpot(pref, force) → { x, z, y, side: 'left'|'right'|'rear'|'free' } | null
//       pref：玩家朝向（世界 yaw，数字）或 'left' / 'right' / 'rear'；偏左 > 20° 先左、偏右 > 20° 先右、正前方先左，再另一边，再车尾。
//       force = true（死在车上、换层、回主页）：三面都不行就从车旁一圈圈往外找，永远不落进 OBB 和出口圈
//   sim.lightSpot() → { x, y, z, range, color, intensity, flicker, decay }：前大灯借灯池的那盏（world.setExtraLights 的格式）。
//       FE1R：落点每帧在叉尖前一排候选里挑（见 lightSolve：车前判定区亮、正前方窄东西朝车那面亮、叉尖前 5 m 亮、天花板不比地面亮），
//       逐帧平滑挪过去；光球按平滑后的实际位置收：不伸进跨过光源高度的墙 / 宽块 / 别的车（整车外包盒）的影子里，货架到远侧面往里 0.1 m
//       （FE1Q J9），窄东西（水平两个方向都 ≤1.0 m）不收（K1）。停着 / 刚上车 / 瞬移时当帧收到严格上限；开车时当帧只不越过把端面楔形细缝
//       放宽到 LT.w0r 的上限，再按 LT.rDown 收到严格上限（光源横扫过端面所在平面时不一跳）；顶比光源低不到 LT.yFade 的矮堆垛只当收的目标。
//       强度按判定区要的给，按光源下地面、离光源最近的面封顶（不发白），开得快时封顶再压低。
//       world.lightAt 按画面上这盏灯的 range / intensity 算（FE1Q J8）。
//       sim.lightInfo = 上一次的 { range, intensity, R0（名义范围）, seatLit, bound（影子界限）, hit（车宽带里第一个挡光体离叉尖）, narrow,
//       by: { kind: 'wall'|'rack'|'wide'|'car', key, box }（收住光球的那一样）, s / u / h（光源在叉尖前、横偏、离地）, tgt, zone, zoneMin, zoneCov,
//       faceE, far, ceil, ohE, score, blocker }（调试、测试看）；BR.forklift._light = { LT, ctx, eval, occBound, occKind, sMaxU, ALB, albProf, albGet, surfCap, ambAt, texHi }（测试看候选打分、不发白的上限）
//   sim.litSeat(x, z) → (x, z) 在驾驶舱里时返回 lightInfo.seatLit（≈ 0.34：开着大灯司机算被照亮，FE1Q J8），否则 0。world.lightAt 用
//   附带：sim.key、sim.pose（只读拷贝）、sim.setPose(pose, {push})、sim.start()/stop()、sim.seatWorld()、sim.eyeWorld()、
//         sim.chestWorld()、sim.cab()、sim.toWorld(lx, lz)、sim.toLocal(x, z)、sim.clearItems()、sim.release()、sim.dispose()、
//         sim.stepVines(dt, seated)（公开：vehicles_net 给队友开的车做影子模拟时，用它让藤蔓也被远端的车拨开）
//
// ---- 规则（方案 FE1-fk-sim ①–⑨）----
//   ① 运动学：以前轴为参考点的后轮转向自行车模型，航向角速度 = −v·tan(steer)/轴距（按 A：steer < 0，车头往左）。
//      W/S 加速 2.25 m/s²；反向先以 6 m/s² 刹车；松开 3 m/s² 自动刹车。前进最快 4.5、倒车 2.5。
//      打方向限速 v ≤ sqrt(2.5·轴距/tan|steer|)；货叉底 > 0.5 m 限 1.0、> 1.5 m 限 0.6（超了 6 m/s² 降下来）。
//   ② 碰撞：每步扫掠 14 个 OBB（phys.sweepOBBs 扫静态碰撞体和别的车；人、实体、出口圈、keepClear、头顶东西、
//      车身高度上伸出来却没有碰撞体的东西（b.data.sideObs：柱脚、护角、消火栓箱、路锥、走廊口管排……）由本文件自己扫）。
//      整步撞上时依次试：转角改变减半、不转角（沿车头方向直走）、都不行就停在接触前。车尾那一半撞上而直走不撞 = 车尾往外甩：
//      不让它直走，停住并提示「车尾会往外甩，先倒车带出来」（车头那一半蹭着时才允许直走，倒车把车尾带离墙靠的就是它）。
//      斜放地牛脚下那块轴对齐的老碰撞体跳过（sideObs 条目的 solid → phys skipBoxes），按地牛的真实形状挡（FE1 返修 r3）。
//      推着地上的东西撞墙（推不开、被夹在车和墙之间）：开到还推得动的最远处再停，按车速出「哐」/「咚」，「哐」照样抖镜头（返修 r3）。
//   ③ 升降：货叉架 0.45 m/s 升、0.55 m/s 降；头顶条目（b.data.overhead）或正上方的 sideObs 条目挡住时停在底面以下 2 cm；
//      降的时候货叉 / 货叉架正下方有人、怪、地上物资、sideObs 条目或碰撞体就停在它们上面。
//   ④ 推开地上物资（车身和货叉的 OBB）；⑤ 藤蔓拨开再摆回（kit.spanEdit / spanRestore，纯表现；FE1P H9 / FE1Q J3：贴着看得见的护顶架
//      （纵梁、横梁、格栅横条、斜立柱、灯盒、后视镜、警示灯）、门架零件和链条 0–1 cm，不按物理 OBB）；
//   ⑥ 下车落点；⑦ 噪音；⑧ 前大灯落点（FE1P H8：光不透墙；FE1Q J9：货架通道里照得远；FE1R K1 / K2 / L-occluders / L-ceiling：见 lightSolve）；
//   ⑨ 坐车的人的位置由 BR.vehicles 按座椅给。
//   FE1R F1：升货叉时头顶静态碰撞体（门楣「上面有门框，升不上去」、别的「上面有东西挡着，升不上去」）和别的车也挡；F2：两只后轮各一个 OBB
//   跟着 steer 转，往外打方向会压进墙 / 人 / 地上的东西就停在刚好碰不到的角度（「后轮挨着墙，打不了方向」），开车扫掠也算它；
//   F3：叉上的货（env.riders）按外接盒跟着货叉架升降、参加升降和开车的碰撞（伸出叉尖那一截也算）；F4：降货叉按部件真实平面投影往下扫（不再三条射线）。
(function () {
'use strict';
const BR = window.BR;

// ---------- 数值 ----------
const CFG = {
  vFwd: 4.5, vRev: 2.5,              // 最快前进 / 倒车 m/s
  accel: 2.25,                       // W/S 加速（约 2 s 到 4.5）
  brake: 3,                          // 松开油门自动刹车
  brakeHard: 6,                      // 反向刹车、雷达刹车、超速降下来
  stopTime: 0.55,                    // 急刹（输入关掉、下车前）最多这么久停住：减速度 = max(brakeHard, |v| / stopTime)
  steerRate: 2.0, steerReturn: 2.5,  // 打方向 / 松手回正 rad/s
  steerLatK: 2.5,                    // 打方向限速 v ≤ sqrt(K·轴距/tan|steer|)（满舵约 1.3 m/s）
  liftUp: 0.45, liftDown: 0.55,      // 货叉架升 / 降 m/s
  liftSlow: [[1.5, 0.6], [0.5, 1.0]],// 货叉底离地超过这个高度时的限速
  radar: 1.5, radarBeep: 0.6,        // 雷达距离（从车头货叉尖 / 车尾配重量到人的中心）、嘀嘀的间隔
  crank: 0.8,                        // 起动机转多久
  bangV: 0.8, shakeS: 0.15,          // 撞上的速度 ≥ 这个算「哐」，镜头抖多久
  noise: { idle: 0.25, drive: 0.6, reverse: 0.8 },
  lever: 0.35, leverRate: 6,         // 升降杆扳到底的角度、扳动速度
  overheadGap: 0.02,                 // 升到头顶东西底面以下这么多停
  // person：人 / 实体外形顶（实体按网格量的 shapeOf 已经往上让了 1 cm，人按 personH + 1 cm）再让 1 cm —— 合计停在顶上 2 cm（FE1R ACT-veh）
  underGap: { person: 0.01, item: 0.005, solid: 0.005 },
  // 前大灯：颜色在这里；落点、光球、强度 FE1R 起由 lightSolve 按 LT 算（空地上光源在叉尖前 2.6 m、离地 0.9 m、光球 4.4–6.5 m、强度 2.8 起）。
  // 这几个数只是 vehicles / vehiclesNet 没有模拟时兜底摆灯用的缺省（BR.forklift.config.light）
  light: { ahead: 4.0, y: 1.6, range: 8, near: 2.2, nearMin: 1.8, color: 0xfff0d8, intensity: 3.2 },
  // 藤蔓：车 reach 米内的才拨；摆回去用 back 秒；pad = 护顶 / 门架盒子外扩多少（FE1P H9：0 —— 藤蔓贴着把它推开的东西，
  // 表面离护顶 / 门架真实包围盒 0–1 cm）；head = 司机头胸那段胶囊的半径
  vine: { reach: 4, back: 1.2, pad: 0, head: 0.15 },
  exitMargin: 0.4,
  // personR：人对载具的碰撞半径（FE1R A7）= hazmat.glb 站立 / 走路动画里离竖轴最远的点 + 1 cm（手套甩到外面），本机、队友一样；
  // 车按它刹停 / 扫掠、下车落点按它离车身 OBB。人和墙、静态碰撞体照旧按 BR.config.player.radius（0.3）
  personR: 0.377, personH: 1.8,
};
const DT_MAX = 0.1, SUB_DT = 1 / 30;
const OH_WORD = { pipe: '管子', valve: '管子', gauge: '管子', drip: '管子', lamp: '吊灯', beam: '横梁', tray: '桥架', cable: '电缆', arch: '拱顶' };
// 车身高度上伸出来的东西（b.data.sideObs）升货叉被它挡住时的叫法；没列的按 OH_WORD，再没有说「东西」
const SIDE_WORD = { cabinet: '消火栓箱', extinguisher: '灭火器', switch: '开关盒', cone: '路锥', lamp: '灯' };
const TXT = {
  // FE1R UI-11：出口提示告诉孩子怎么办（车开不进出口圈，得下车走过去）
  crank: '发动中', radar: '雷达自动刹车', exit: '前面是出口，下车走过去', prop: '前面有东西挡着，下车把它拖开',
  // 倒车撞上的（出口圈、拖出来的家具在车尾那边）：说「后面」，孩子不会往前找
  exitBack: '后面是出口，下车走过去', propBack: '后面有东西挡着，下车把它拖开',
  tail: '车尾会往外甩，先倒车带出来', underPerson: '货叉下面有人', underThing: '货叉下面有东西',
  overhead: w => '上面有' + w + '，升不上去',
  // FE1R F1：升货叉被静态的东西挡住（门楣 = 门框）；F2：后轮打方向会压进墙 / 人 / 地上的东西
  overDoor: '上面有门框，升不上去', overThing: '上面有东西挡着，升不上去',
  wheelWall: '后轮挨着墙，打不了方向', wheelPerson: '后轮旁边有人，打不了方向', wheelThing: '后轮挨着东西，打不了方向',
};

function num(v, d) { v = +v; return Number.isFinite(v) ? v : d; }
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function approach(v, t, d) { return v < t ? Math.min(t, v + d) : Math.max(t, v - d); }
function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (err) { return false; }
}
function pt(v, d) {
  if (Array.isArray(v) && v.length >= 3) return { x: num(v[0], d.x), y: num(v[1], d.y), z: num(v[2], d.z) };
  if (v && typeof v === 'object') return { x: num(v.x, d.x), y: num(v.y, d.y), z: num(v.z, d.z) };
  return { x: d.x, y: d.y, z: d.z };
}

// ---------- 几何（缺省值 = L1.js FORKLIFT_GEO 加方案 FE1 新增的字段；L1 载入后以它为准） ----------
// 14 个部件盒（本地坐标，lift = 0；mastInner 随 lift 升 1.3·lift、carriage/forkL/forkR 升 2.6·lift）。
// 只是 L1 没给 obbs() 时的兜底，数值抄 L1.js 的 FK_OBB；驾驶舱 x ±0.4、z −0.5…0.55、地台 0.62 以上留空
const DEF_OBBS = [
  { name: 'chassis', cx: 0, cy: 0.31, cz: -0.1875, hx: 0.595, hy: 0.31, hz: 0.7475 },
  { name: 'hood', cx: 0, cy: 0.7, cz: 0.23, hx: 0.535, hy: 0.3, hz: 0.33 },
  { name: 'counterweight', cx: 0, cy: 0.7375, cz: 0.918, hx: 0.55, hy: 0.7375, hz: 0.358 },
  { name: 'dash', cx: 0, cy: 0.8, cz: -0.68, hx: 0.475, hy: 0.22, hz: 0.12 },
  { name: 'postFL', cx: -0.43, cy: 1.53, cz: -0.635, hx: 0.04, hy: 0.54, hz: 0.115 },
  { name: 'postFR', cx: 0.43, cy: 1.53, cz: -0.635, hx: 0.04, hy: 0.54, hz: 0.115 },
  { name: 'postRL', cx: -0.43, cy: 1.575, cz: 0.575, hx: 0.025, hy: 0.495, hz: 0.075 },
  { name: 'postRR', cx: 0.43, cy: 1.575, cz: 0.575, hx: 0.025, hy: 0.495, hz: 0.075 },
  { name: 'roof', cx: 0, cy: 2.125, cz: -0.02, hx: 0.46, hy: 0.075, hz: 0.6 },
  { name: 'mastOuter', cx: 0, cy: 1.06, cz: -0.93, hx: 0.45, hy: 1, hz: 0.13 },
  { name: 'mastInner', cx: 0, cy: 1.1125, cz: -0.9415, hx: 0.315, hy: 1.0125, hz: 0.1115 },
  { name: 'carriage', cx: 0, cy: 0.6275, cz: -1.0975, hx: 0.46, hy: 0.6125, hz: 0.0625 },
  { name: 'forkL', cx: -0.28, cy: 0.035, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },
  { name: 'forkR', cx: 0.28, cy: 0.035, cz: -1.63, hx: 0.05, hy: 0.02, hz: 0.47 },
];
const DEF_GEO = {
  wheelFront: { x: 0.48, y: 0.29, z: -0.62, r: 0.29, w: 0.2 },
  wheelRear: { x: 0.44, y: 0.23, z: 0.8, r: 0.23, w: 0.16 },
  mastInnerTop: 2.12, innerTravel: 1.3, carriageY: 0.08, forkY: 0.015,
  maxSteer: 1.13, forkW: 0.1, forkT: 0.04, forkZ: [-2.1, -1.16], tineX: [-0.28, 0.28], backrestH: 1.16, carriageTravel: 2.6,
  eye: { x: 0, y: 1.8, z: 0.16 }, seat: { y: 1.16, z: 0.24 }, seatChest: { x: 0, y: 1.66, z: 0.24 },
  stepPoint: { x: 0.75, y: 0.35, z: -0.19 },
  exitSide: 1.0, exitRear: 0.5,
  cab: { x: 0.4, z0: -0.5, z1: 0.55, yFloor: 0.62, ySeat: 1.16, yTop: 2.05 },
  guardTop: 2.1, half: { x: 0.6, z: 1.3, h: 2.15 },
};
const PART_LIFT = { mastInner: 0.5, carriage: 1, forkL: 1, forkR: 1 };   // 跟 carriage 走的比例（× carriageTravel·lift）
// 藤蔓按真实包围盒（FK_OBB）挡的部件：门架。护顶架（roof、四根立柱）按看得见的那几块挡（FE1Q J3，见 VINE_GUARD）
const MAST_PARTS = { mastOuter: 1, mastInner: 1, carriage: 1 };

let geoSrc = undefined, geoCache = null;
function srcGeo() { const L = BR.L1forklift; return L && L.geo && typeof L.geo === 'object' ? L.geo : null; }
function validBoxes(a) {
  if (!Array.isArray(a) || a.length < 10) return false;
  for (const b of a) {
    if (!b || typeof b !== 'object') return false;
    for (const k of ['cx', 'cy', 'cz', 'hx', 'hy', 'hz']) if (!Number.isFinite(+b[k])) return false;
  }
  return true;
}
function buildGeo(src) {
  const g = Object.assign({}, DEF_GEO);
  if (src) for (const k of Object.keys(src)) if (src[k] != null && k !== 'obbs') g[k] = src[k];
  g.wheelFront = Object.assign({}, DEF_GEO.wheelFront, src && src.wheelFront);
  g.wheelRear = Object.assign({}, DEF_GEO.wheelRear, src && src.wheelRear);
  g.maxSteer = num(g.maxSteer, DEF_GEO.maxSteer);
  g.carriageTravel = num(g.carriageTravel, 2 * num(g.innerTravel, 1.3));
  g.innerTravel = num(g.innerTravel, g.carriageTravel / 2);
  g.forkY = num(g.forkY, DEF_GEO.forkY);
  g.forkT = num(g.forkT, DEF_GEO.forkT);
  g.mastInnerTop = num(g.mastInnerTop, DEF_GEO.mastInnerTop);
  g.carriageY = num(g.carriageY, DEF_GEO.carriageY);
  g.backrestH = num(g.backrestH, DEF_GEO.backrestH);
  g.eyeP = pt(g.eye, DEF_GEO.eye);
  g.chestP = pt(g.seatChest, DEF_GEO.seatChest);
  g.seatP = { x: 0, y: num(g.seat && g.seat.y, 1.16), z: num(g.seat && g.seat.z, 0.24) };
  g.wheelbase = Math.abs(num(g.wheelRear.z, 0.8) - num(g.wheelFront.z, -0.62)) || 1.42;
  g.frontAxleZ = num(g.wheelFront.z, -0.62);
  // 部件盒：lift = 0 和 lift = 1 各取一份，逐件按 lift 线性插（只有 y 会变）
  let b0 = null, b1 = null;
  if (src && typeof src.obbs === 'function') {
    try { b0 = src.obbs(0); b1 = src.obbs(1); } catch (err) { b0 = b1 = null; }
    if (!validBoxes(b0) || !validBoxes(b1) || b0.length !== b1.length) { b0 = b1 = null; }
  }
  const parts = [];
  if (b0) {
    // lift 的单位以货叉架的升程为准：obbs(1) − obbs(0) 应当是 carriageTravel（2.6 m）；不是的话按比例换算
    let dc = 0;
    for (let i = 0; i < b0.length; i++) if (b0[i].name === 'carriage') dc = (+b1[i].cy) - (+b0[i].cy);
    const sc = dc > 1e-3 ? g.carriageTravel / dc : 1;
    for (let i = 0; i < b0.length; i++) {
      const a = b0[i], b = b1[i];
      parts.push({ name: String(a.name || ('p' + i)), cx: +a.cx, cy: +a.cy, cz: +a.cz, hx: Math.abs(+a.hx), hy: Math.abs(+a.hy), hz: Math.abs(+a.hz),
        ly: ((+b.cy) - (+a.cy)) * sc });
    }
  } else {
    for (const a of DEF_OBBS) parts.push(Object.assign({}, a, { ly: (PART_LIFT[a.name] || 0) * g.carriageTravel }));
  }
  g.parts = parts;
  let front = 0, rear = 0, halfW = 0;
  for (const p of parts) {
    front = Math.min(front, p.cz - p.hz); rear = Math.max(rear, p.cz + p.hz); halfW = Math.max(halfW, Math.abs(p.cx) + p.hx);
  }
  g.front = front; g.rear = rear; g.halfW = halfW;
  g.cabR = (() => { const c = g.cab || DEF_GEO.cab; return { x: num(c.x, 0.4), z0: num(c.z0, -0.5), z1: num(c.z1, 0.55), yFloor: num(c.yFloor, 0.62), yTop: num(c.yTop, 2.05) }; })();
  // 「车尾那一半」：部件裁到本地 z ≥ 0 的部分（车尾往外甩的判断用）
  g.rearParts = [];
  for (const p of parts) {
    const z0 = Math.max(0, p.cz - p.hz), z1 = p.cz + p.hz;
    if (z1 - z0 < 0.02) continue;
    g.rearParts.push(Object.assign({}, p, { cz: (z0 + z1) / 2, hz: (z1 - z0) / 2 }));
  }
  // 下车落点（本地）
  const es = g.exitSide;
  if (typeof es === 'number' && es > 0) g.exitSideP = { x: es, z: g.seatP.z };
  else { const q = pt(es, { x: 1.0, y: 0, z: g.seatP.z }); g.exitSideP = { x: Math.abs(q.x), z: q.z }; }
  const er = g.exitRear;
  if (typeof er === 'number' && er > 0) g.exitRearP = { x: 0, z: er >= 1.2 ? er : rear + er };
  else { const q = pt(er, { x: 0, y: 0, z: rear + 0.5 }); g.exitRearP = { x: q.x, z: q.z }; }
  return g;
}
function G() {
  const src = srcGeo();
  if (geoCache && src === geoSrc) return geoCache;
  geoSrc = src;
  geoCache = buildGeo(src);
  return geoCache;
}

// ---------- 坐标 ----------
// kit 的约定：本地 (lx, lz) → 世界 (x + c·lx + s·lz, z − s·lx + c·lz)，c = cos(yaw)、s = sin(yaw)；本地 −z = 车头
function fwdX(yaw) { return -Math.sin(yaw); }
function fwdZ(yaw) { return -Math.cos(yaw); }
const tmpW = { x: 0, z: 0 };
function toW(x, z, yaw, lx, lz, out) {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = out || tmpW;
  o.x = x + c * lx + s * lz; o.z = z - s * lx + c * lz;
  return o;
}
function toL(x, z, yaw, wx, wz, out) {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = wx - x, dz = wz - z, o = out || tmpW;
  o.x = c * dx - s * dz; o.z = s * dx + c * dz;
  return o;
}
// 绕 (px, pz) 转 a（同一个约定）
function rotAbout(x, z, px, pz, a, out) {
  const c = Math.cos(a), s = Math.sin(a), dx = x - px, dz = z - pz, o = out || tmpW;
  o.x = px + c * dx + s * dz; o.z = pz - s * dx + c * dz;
  return o;
}

// 世界 OBB（phys.addOBBs 的格式）
// out 给了就复用里面的对象（扫掠每个采样点都要算一遍，不分配）；要留着用的调用方传新数组
function worldBoxes(g, x, z, y, yaw, lift, list, out) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const arr = out || [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i], cy = p.cy + (p.ly || 0) * lift;
    let b = arr[i];
    if (!b) b = arr[i] = { name: '', cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, minY: 0, maxY: 0 };
    b.name = p.name; b.cx = x + c * p.cx + s * p.cz; b.cz = z - s * p.cx + c * p.cz; b.hx = p.hx; b.hz = p.hz; b.rot = yaw + (p.rot || 0);
    b.minY = y + cy - p.hy; b.maxY = y + cy + p.hy;
  }
  arr.length = list.length;
  return arr;
}

// ---------- 纯几何判定（2D：OBB 在 XZ 上，Y 另外比） ----------
// OBB {cx, cz, hx, hz, rot} vs 轴对齐矩形 [x0, x1]×[z0, z1]：分离轴（世界 X、Z，OBB 的 u、w），贴着不算
function obbHitsRect(b, x0, z0, x1, z1, pad) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), ac = Math.abs(c), as = Math.abs(s);
  const ex = (x1 - x0) / 2 + (pad || 0), ez = (z1 - z0) / 2 + (pad || 0), bx = (x0 + x1) / 2, bz = (z0 + z1) / 2;
  const dx = bx - b.cx, dz = bz - b.cz;
  if (Math.abs(dx) >= ex + b.hx * ac + b.hz * as) return false;
  if (Math.abs(dz) >= ez + b.hx * as + b.hz * ac) return false;
  if (Math.abs(dx * c - dz * s) >= b.hx + ex * ac + ez * as) return false;
  if (Math.abs(dx * s + dz * c) >= b.hz + ex * as + ez * ac) return false;
  return true;
}
// 圆心到 OBB 的距离² ；圆心在盒里为负（−穿透深度²）
function circleDist2(b, px, pz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = px - b.cx, dz = pz - b.cz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
  const ex = lx - qx, ez = lz - qz;
  if (ex === 0 && ez === 0) { const m = Math.min(b.hx - Math.abs(lx), b.hz - Math.abs(lz)); return -m * m; }
  return ex * ex + ez * ez;
}
function yOver(a0, a1, b0, b1) { return a1 > b0 + 1e-4 && b1 > a0 + 1e-4; }
// OBB vs OBB（2D 分离轴）
function obbHitsObb(a, b) {
  const ca = Math.cos(a.rot), sa = Math.sin(a.rot), cb = Math.cos(b.rot), sb = Math.sin(b.rot);
  const axes = [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [ux, uz] of axes) {
    const ra = a.hx * Math.abs(ca * ux - sa * uz) + a.hz * Math.abs(sa * ux + ca * uz);
    const rb = b.hx * Math.abs(cb * ux - sb * uz) + b.hz * Math.abs(sb * ux + cb * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb) return false;
  }
  return true;
}

// ---------- 刚体运动：绕 (px, pz) 转 t·dyaw 再平移 t·(dx, dz) ----------
// 车身部件在运动参数 t 时的世界 OBB（不分配：写进 out）
const tmpRot = { x: 0, z: 0 }, tmpSeat = { x: 0, z: 0 };
function boxesAt(g, pose, lift, mo, t, list, out) {
  const o = rotAbout(pose.x, pose.z, mo.px, mo.pz, mo.dyaw * t, tmpRot);
  return worldBoxes(g, o.x + mo.dx * t, o.z + mo.dz * t, pose.y, pose.yaw + mo.dyaw * t, lift, list, out);
}
// 障碍：{ kind: 'circle', x, z, r, minY, maxY, id } | { kind: 'rect', x0, z0, x1, z1, minY, maxY, id } | { kind: 'aabb'（phys 的记录）}
function boxHits(b, ob) {
  if (!yOver(b.minY, b.maxY, ob.minY, ob.maxY)) return false;
  if (ob.kind === 'circle') return circleDist2(b, ob.x, ob.z) < ob.r * ob.r - 1e-8;
  if (ob.kind === 'obb') return obbHitsObb(b, ob);
  return obbHitsRect(b, ob.x0, ob.z0, ob.x1, ob.z1, 0);
}
function anyHit(boxes, ob) {
  for (let i = 0; i < boxes.length; i++) if (boxHits(boxes[i], ob)) return true;
  return false;
}
// 本地扫掠：采样 + 二分。起点就和车重叠的障碍不算（走开就好，不让车卡死）。返回 { t, ob } | null
const sweepBufA = [], sweepBufB = [];
function sweepLocal(g, pose, lift, mo, list, obs) {
  if (!obs.length) return null;
  const R = 2.6 + Math.hypot(mo.dx, mo.dz) + Math.abs(mo.dyaw) * 3;
  const reachR = Math.hypot(pose.x - mo.px, pose.z - mo.pz) + 2.6;
  const disp = Math.hypot(mo.dx, mo.dz) + Math.abs(mo.dyaw) * reachR;
  const n = clamp(Math.ceil(disp / 0.01), 1, 96);
  const b0 = boxesAt(g, pose, lift, mo, 0, list, sweepBufA);
  let yLo = Infinity, yHi = -Infinity;
  for (let i = 0; i < b0.length; i++) { if (b0[i].minY < yLo) yLo = b0[i].minY; if (b0[i].maxY > yHi) yHi = b0[i].maxY; }
  let best = null;
  for (let k = 0; k < obs.length; k++) {
    const ob = obs[k];
    if (!yOver(yLo, yHi, ob.minY, ob.maxY)) continue;
    let ox, oz, orad;
    if (ob.kind === 'circle') { ox = ob.x; oz = ob.z; orad = ob.r; }
    else if (ob.kind === 'obb') { ox = ob.cx; oz = ob.cz; orad = Math.hypot(ob.hx, ob.hz); }
    else { ox = (ob.x0 + ob.x1) / 2; oz = (ob.z0 + ob.z1) / 2; orad = Math.hypot(ob.x1 - ob.x0, ob.z1 - ob.z0) / 2; }
    if (Math.hypot(ox - pose.x, oz - pose.z) > R + orad) continue;
    if (anyHit(b0, ob)) continue;
    const tMax = best ? best.t : 1;
    let lo = 0, hi = -1;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (t > tMax + 1e-9) break;
      if (anyHit(boxesAt(g, pose, lift, mo, t, list, sweepBufB), ob)) { hi = t; break; }
      lo = t;
    }
    if (hi < 0) continue;
    for (let it = 0; it < 12; it++) {
      const m = (lo + hi) / 2;
      if (anyHit(boxesAt(g, pose, lift, mo, m, list, sweepBufB), ob)) hi = m; else lo = m;
    }
    if (!best || lo < best.t) best = { t: lo, ob };
  }
  return best;
}

// ---------- 环境 ----------
function groundAt(x, z, d) {
  if (has(BR.phys, 'groundY')) { const g = +BR.phys.groundY(x, z); if (Number.isFinite(g)) return g; }
  return d;
}
function nearChunks(x, z) {
  const W = BR.world, out = [];
  if (!W || !has(W, 'chunkAt')) return out;
  const size = num(W.chunkSize, 24) || 24;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = W.chunkAt(x + dx * size, z + dz * size);
    if (c && out.indexOf(c) < 0) out.push(c);
  }
  return out;
}
function chunkData(c) { return c && c.res && c.res.data && typeof c.res.data === 'object' ? c.res.data : null; }
function coopRole() {
  const c = BR.game && BR.game.coop;
  if (c && c.active) return c.role || null;
  if (BR.coop && BR.coop.active) return BR.coop.role || null;
  return null;
}
function peerSeatedKey() {
  try { const p = BR.coop && BR.coop.peerPose; if (p && (p.mode === 'drive' || p[0] === 'drive')) return String(p.key != null ? p.key : p[1]); } catch (err) { /* 没有 */ }
  return null;
}
// 人对载具的碰撞半径（FE1R A7）：BR.config.player.vehRadius（缺省 CFG.personR = 0.377）
function personVehR() { return num(BR.config && BR.config.player && BR.config.player.vehRadius, CFG.personR); }
// 人和实体（竖直圆柱）。坐在这台车驾驶舱里的人不算（他是司机）
function peopleCircles(sim, env, out) {
  out.length = 0;
  const g = G(), cab = g.cabR;
  const inCab = (x, z) => { const l = toL(sim.x, sim.z, sim.yaw, x, z); return Math.abs(l.x) <= cab.x + 0.05 && l.z >= cab.z0 - 0.05 && l.z <= cab.z1 + 0.05; };
  const P = BR.player;
  const riderIsMe = env.local === true || (BR.vehicles && BR.vehicles.seated === sim.key) || (P && P.mounted && P.mounted.key === sim.key);
  if (P && !P.dead && Number.isFinite(+P.x) && !riderIsMe && !(P.mounted)) {
    const feet = Number.isFinite(+P.feetY) ? +P.feetY : num(P.y, 1.62) - num(BR.config.player && BR.config.player.eyeHeight, 1.62);
    if (!inCab(P.x, P.z)) out.push({ kind: 'circle', x: +P.x, z: +P.z, r: personVehR(), minY: feet, maxY: feet + CFG.personH + 0.01, id: 'p:me', person: true });
  }
  let peer = null;
  try { peer = BR.coop && BR.coop.peer; } catch (err) { peer = null; }
  if (peer && Number.isFinite(+peer.x) && Number.isFinite(+peer.z) && peerSeatedKey() !== sim.key) {
    const feet = num(peer.y, 1.62) - 1.62;
    if (Math.abs(feet - sim.y) < 2.5 && !inCab(peer.x, peer.z)) out.push({ kind: 'circle', x: +peer.x, z: +peer.z, r: personVehR(), minY: feet, maxY: feet + CFG.personH + 0.01, id: 'p:peer', person: true });
  }
  const E = BR.entities && BR.entities.list;
  if (E && typeof E.length === 'number') {
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e || e.dead || e.removed || !Number.isFinite(+e.x)) continue;
      if (Math.abs(e.x - sim.x) > 8 || Math.abs(e.z - sim.z) > 8) continue;
      // 扒在这台车上 / 立起来够这台车上的人的怪（返修 FE1R · repair-r2 _archetypes.js seatLeap 的 u.perch）不挡这台车：
      // 它的网格就压在车身旁边，算进来车一步都动不了；车一挪它就松开落回地上（seatLeap 里车位姿变了就 leapRelease）
      { const ua = e.obj && e.obj.userData && e.obj.userData.arch, pc = ua && ua.perch; if (pc && pc.phase !== 'drop' && pc.key != null && String(pc.key) === String(sim.key)) continue; }
      // FE1R ACT-veh：按网格此刻的真实外形（BR.entities.shapeOf：0–0.6 / 0.6–1.2 / 1.2 m 以上三段竖直圆柱），不再用碰撞圆柱 e.r / e.h ——
      // 车停在怪的网格外面；挂在天花板上的 Nguithr'xurh（2.59–2.69 m）不挡车身、不触发雷达，只挡升起来的门架和货叉
      let sh = null;
      try { sh = BR.entities && has(BR.entities, 'shapeOf') ? BR.entities.shapeOf(e) : null; } catch (err) { sh = null; }
      if (sh && sh.length) {
        for (let j = 0; j < sh.length; j++) {
          const c = sh[j];
          if (!c || !Number.isFinite(+c.x) || !Number.isFinite(+c.z) || !(c.r > 0)) continue;
          out.push({ kind: 'circle', x: +c.x, z: +c.z, r: +c.r, minY: +c.minY, maxY: +c.maxY, id: 'e:' + e.id + '#' + j, person: true, ent: e });
        }
        continue;
      }
      const r = num(e.r, 0.4), y = num(e.y, sim.y), h = num(e.h, 1.8);
      out.push({ kind: 'circle', x: e.x, z: e.z, r, minY: y, maxY: y + h, id: 'e:' + e.id, person: true, ent: e });
    }
  }
  return out;
}
// 出口圈（+0.4）和 keepClear
function blockerObs(sim, out) {
  const W = BR.world;
  if (!W || !has(W, 'blockers')) return out;
  let list = null;
  try { list = W.blockers({ x: sim.x, z: sim.z, r: 9, margin: CFG.exitMargin }); } catch (err) { list = null; }
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b) continue;
    const y0 = Number.isFinite(+b.y) ? +b.y - 1 : -1e4, y1 = Number.isFinite(+b.y) ? +b.y + 3 : 1e4;
    if (b.x0 != null) out.push({ kind: 'rect', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, minY: y0, maxY: y1, id: 'keep:' + i, keep: true, why: b.why || '' });
    else if (b.r > 0) out.push({ kind: 'circle', x: b.x, z: b.z, r: b.r, minY: y0, maxY: y1, id: (b.kind === 'exit' ? 'exit:' : 'keep:') + i, exit: b.kind === 'exit', keep: b.kind !== 'exit', why: b.why || '' });
  }
  return out;
}
// 头顶条目（b.data.overhead，世界坐标，y = 底面）
function overheadList(sim, out) {
  out.length = 0;
  const cs = nearChunks(sim.x, sim.z);
  for (const c of cs) {
    const d = chunkData(c), oh = d && d.overhead;
    if (!Array.isArray(oh)) continue;
    for (let i = 0; i < oh.length; i++) {
      const e = oh[i];
      if (!e || !Number.isFinite(+e.y)) continue;
      if (e.maxX < sim.x - 6 || e.minX > sim.x + 6 || e.maxZ < sim.z - 6 || e.minZ > sim.z + 6) continue;
      out.push(e);
    }
  }
  return out;
}
function ohObs(list, out) {
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    out.push({ kind: 'rect', x0: Math.min(e.minX, e.maxX), z0: Math.min(e.minZ, e.maxZ), x1: Math.max(e.minX, e.maxX), z1: Math.max(e.minZ, e.maxZ),
      minY: +e.y, maxY: +e.y + 50, id: 'oh:' + i, oh: e });
  }
  return out;
}

// 车身高度上伸出来、却没有碰撞体的东西（b.data.sideObs，世界坐标：外接 AABB { minX, maxX, minY, maxY, minZ, maxZ } 加真实形状
// { cx, cz, hx, hz, rot, round?, r? }，见 sideShape）：
// 墙上的管排、笼罩灯、消火栓箱，施工区的路锥。人照旧挤得过去（原来就没有碰撞体，不动 golden），车当障碍：
// 开过去撞上就停（「咚」/「哐」）；货叉在它下面升不上去，在它上面降不下去
function sideList(sim, out) {
  out.length = 0;
  const cs = nearChunks(sim.x, sim.z);
  for (const c of cs) {
    const d = chunkData(c), so = d && d.sideObs;
    if (!Array.isArray(so)) continue;
    for (let i = 0; i < so.length; i++) {
      const e = so[i];
      if (!e || !Number.isFinite(+e.minY) || !Number.isFinite(+e.maxY) || !Number.isFinite(+e.minX) || !Number.isFinite(+e.minZ)) continue;
      if (e.maxX < sim.x - 6 || e.minX > sim.x + 6 || e.maxZ < sim.z - 6 || e.minZ > sim.z + 6) continue;
      out.push(e);
    }
  }
  return out;
}
// 条目按它真实的形状当障碍（FE1 返修 r2：以前一律按外接矩形，开向斜放的地牛、纸箱会在离它 20–30 cm 的空地上停住）：
// round（路锥、砂堆、灌木）= 竖圆柱 { kind:'circle' }；转过角度的（rot ≠ 0：斜放的地牛、通道里歪着的纸箱）= { kind:'obb' }；其余轴对齐矩形
function sideShape(e, i) {
  const y0 = Math.min(+e.minY, +e.maxY), y1 = Math.max(+e.minY, +e.maxY), id = 'side:' + i;
  if (e.round && Number.isFinite(+e.r) && Number.isFinite(+e.cx) && Number.isFinite(+e.cz)) return { kind: 'circle', x: +e.cx, z: +e.cz, r: +e.r, minY: y0, maxY: y1, id, sideOb: e };
  if (Number.isFinite(+e.rot) && Math.abs(+e.rot) > 1e-6 && Number.isFinite(+e.cx) && Number.isFinite(+e.cz) && +e.hx > 0 && +e.hz > 0) {
    return { kind: 'obb', cx: +e.cx, cz: +e.cz, hx: +e.hx, hz: +e.hz, rot: +e.rot, minY: y0, maxY: y1, id, sideOb: e };
  }
  return { kind: 'rect', x0: Math.min(e.minX, e.maxX), z0: Math.min(e.minZ, e.maxZ), x1: Math.max(e.minX, e.maxX), z1: Math.max(e.minZ, e.maxZ), minY: y0, maxY: y1, id, sideOb: e };
}
function sideObs(list, out) {
  for (let i = 0; i < list.length; i++) out.push(sideShape(list[i], i));
  return out;
}
// 车的一个部件盒 b（平面上）和条目 e 的真实形状重不重叠（升降时用：在它正下方 / 正上方才算）
const sideShapes = new WeakMap();   // 条目 → 形状（不往区块数据上挂东西）
function sideHit(b, e) {
  let sh = sideShapes.get(e);
  if (!sh) { sh = sideShape(e, 0); sideShapes.set(e, sh); }
  if (sh.kind === 'circle') return circleDist2(b, sh.x, sh.z) < sh.r * sh.r - 1e-8;
  if (sh.kind === 'obb') return obbHitsObb(b, sh);
  return obbHitsRect(b, sh.x0, sh.z0, sh.x1, sh.z1, 0);
}
function sideWord(e) { return (e && (SIDE_WORD[e.kind] || OH_WORD[e.kind])) || '东西'; }
// 条目带 solid（斜放的地牛：L1 把它那块轴对齐的老碰撞体 [minX, minY, minZ, maxX, maxY, maxZ] 记在这里，FE1 返修 r3）：
// 叉车扫掠、升降往下打射线时跳过这块（phys opts.skipBoxes），只按地牛的真实形状（这两个 sideObs 条目）挡。人照旧被老碰撞体挡（golden 不动）
function skipBoxesOf(side, out) {
  out.length = 0;
  for (let i = 0; i < side.length; i++) {
    const b = side[i] && side[i].solid;
    if (Array.isArray(b) && b.length >= 6 && out.indexOf(b) < 0) out.push(b);
  }
  return out;
}

// ---------- 后轮（FE1R F2）、叉上的货（FE1R F3）：和车身部件一起参加碰撞 ----------
// 两只后轮各一个小 OBB（轮胎 宽 w × 直径 2r，跟着 steer 绕自己的中心转：worldBoxes 的 p.rot），打方向、开车扫掠都算它（FK_OBB 不动）。
// 叉上的货：BR.items 的外形（footOf：静止时是真实的水平凸包和竖直范围）换到车本地取外接盒，跟着货叉架升降（ly = carriageTravel）
const wheelBuf = [0, 1].map(i => ({ name: i ? 'wheelRR' : 'wheelRL', cx: 0, cy: 0, cz: 0, hx: 0, hy: 0, hz: 0, ly: 0, rot: 0, wheel: true }));
function wheelParts(g, steer) {
  const w = g.wheelRear;
  for (let i = 0; i < 2; i++) {
    const p = wheelBuf[i];
    p.cx = (i ? 1 : -1) * num(w.x, 0.44); p.cy = num(w.y, 0.23); p.cz = num(w.z, 0.8);
    p.hx = num(w.w, 0.16) / 2; p.hy = num(w.r, 0.23); p.hz = num(w.r, 0.23); p.rot = steer;
  }
  return wheelBuf;
}
function cargoParts(sim, riders, out) {
  out.length = 0;
  if (!riders || !has(riders, 'has') || !(riders.size > 0)) return out;
  const I = BR.items, list = I && Array.isArray(I.list) ? I.list : null;
  if (!list) return out;
  const g = G(), T = g.carriageTravel;
  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    if (!it || it.owner || !riders.has(String(it.id)) || !Number.isFinite(+it.x)) continue;
    const f = footOf(it);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i + 1 < f.pts.length; i += 2) {
      const l = toL(sim.x, sim.z, sim.yaw, f.pts[i], f.pts[i + 1], tmpW);
      if (l.x < x0) x0 = l.x; if (l.x > x1) x1 = l.x; if (l.z < z0) z0 = l.z; if (l.z > z1) z1 = l.z;
    }
    if (!(x1 > x0) || !(z1 > z0) || !(f.y1 > f.y0)) continue;
    out.push({ name: 'cargo:' + it.id, cx: (x0 + x1) / 2, cy: (f.y0 + f.y1) / 2 - sim.y - T * sim.lift, cz: (z0 + z1) / 2,
      hx: (x1 - x0) / 2, hy: (f.y1 - f.y0) / 2, hz: (z1 - z0) / 2, ly: T, rot: 0, cargo: true, id: it.id });
  }
  return out;
}
// 头顶静态的东西是不是门楣（门洞上面那一截墙：离地 1.8 m 以上、不高、薄）
function lintelLike(s, gy) {
  if (!s || s.obb) return false;
  const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
  return s.minY - gy >= 1.8 && s.maxY - s.minY <= 1.2 && Math.min(w, d) <= 0.35 && Math.max(w, d) <= 1.8;
}

// ---------- phys 扫掠（静态碰撞体 + 别的车） ----------
function physSweep(sim, g, lift, mo, ignore, parts) {
  const P = BR.phys;
  if (!P) return null;
  const pl = parts || g.parts;
  const list = boxesAt(g, sim, lift, mo, 0, pl, []);
  if (has(P, 'sweepOBBs')) {
    let r = null;
    const skip = sim.skipNow && sim.skipNow.length ? sim.skipNow : undefined;
    try { r = P.sweepOBBs(list, mo, { ignoreKey: ignore, skipBoxes: skip }); } catch (err) { r = null; once('sweep', () => console.warn('[forklift] phys.sweepOBBs 出错', err)); }
    // 起点就压着的东西 phys.sweepOBBs 自己处理（只有越压越深才算撞上，往外开不拦），这里不再把它们加进 ignoreKey 重扫 ——
    // 那样会让车顶着墙越开越深（区块级的 key 还会把整块的墙一起忽略掉）
    if (r && Number.isFinite(+r.t) && +r.t < 1) return { t: clamp(+r.t, 0, 1), key: r.key != null ? String(r.key) : null };
    return null;
  }
  // 兜底（phys 还不认 OBB）：用 overlapBox 收集扫过范围里的 AABB，本地采样扫
  if (!has(P, 'overlapBox')) return null;
  const b1 = boxesAt(g, sim, lift, mo, 1, pl, []);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, yTop = 0;
  for (const bb of list.concat(b1)) {
    const e = Math.hypot(bb.hx, bb.hz);
    x0 = Math.min(x0, bb.cx - e); x1 = Math.max(x1, bb.cx + e); z0 = Math.min(z0, bb.cz - e); z1 = Math.max(z1, bb.cz + e); yTop = Math.max(yTop, bb.maxY);
  }
  const out = [];
  try { P.overlapBox(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, sim.y + 0.005, yTop - sim.y + 0.02, { out, ignoreKey: ignore, tol: 1e-6 }); } catch (err) { return null; }
  const obs = [], skip = sim.skipNow || [];
  for (const s of out) {
    if (!s || !Number.isFinite(+s.minX)) continue;
    if (skip.some(b => Math.abs(b[0] - s.minX) < 1e-3 && Math.abs(b[3] - s.maxX) < 1e-3 && Math.abs(b[2] - s.minZ) < 1e-3 && Math.abs(b[5] - s.maxZ) < 1e-3 && Math.abs(b[4] - s.maxY) < 1e-3)) continue;
    obs.push({ kind: 'rect', x0: s.minX, z0: s.minZ, x1: s.maxX, z1: s.maxZ, minY: s.minY, maxY: s.maxY, id: 'solid', key: s.key != null ? String(s.key) : null });
  }
  const hit = sweepLocal(g, sim, lift, mo, pl, obs);
  return hit ? { t: hit.t, key: hit.ob.key } : null;
}
const onceSet = new Set();
function once(k, fn) { if (onceSet.has(k)) return; onceSet.add(k); try { fn(); } catch (err) { /* 只是日志 */ } }

// 被拖出来的 kit 家具（能拖的道具）：碰撞 key 对得上
function propOfKey(sim, key) {
  const W = BR.world;
  if (!key || !W || !has(W, 'propsNear')) return null;
  let list = null;
  try { list = W.propsNear(sim.x, sim.z, 8); } catch (err) { list = null; }
  if (!Array.isArray(list)) return null;
  for (const P of list) {
    if (!P || P.draggable === false) continue;
    const sk = P.skey != null ? String(P.skey) : null;
    if (sk && (key === sk || key.indexOf(sk + '#') === 0)) return P;
    if (P.key != null && key === String(P.key)) return P;
  }
  return null;
}

// ---------- 推开地上物资 ----------
function itemOnFloor(p) {
  const g = groundAt(p.x, p.z, num(p.y, 0));
  return Math.abs(num(p.y, g) - g) <= 0.03;
}
// 物资的水平半径（模型离竖直转轴最远的那一点，BR.vehicles.footOf）：只在车旁一圈圈找空地、量不到外形时用
function itemR(p) {
  const V = BR.vehicles;
  if (V && typeof V.footOf === 'function') { try { const f = V.footOf(p); if (Number.isFinite(f) && f > 0) return Math.max(0.02, f); } catch (err) { /* 照旧 */ } }
  return Math.max(0.04, num(p.r, 0.1) * 0.8);
}
function itemH(p) { return Math.max(0.05, num(p.hh, 0.1) * 2); }
// 物资在地上的真实外形（返修 r10，验收员 play：以前按离竖轴最远的半径画圆，长的、扁的物资隔空就被推开 5–16 cm）：
// BR.vehicles.footPoly → 世界坐标的水平凸包 pts [x, z, …] 和竖直范围；量不到按半径 itemR 的正 16 边形
// 浮着转圈的丢弃物（不是 still）一直在绕竖轴转、模型还浮在记录高度上面：按离竖轴最远的半径画圆、从记录高度算（和以前一样）
function footOf(p) {
  const V = BR.vehicles;
  let f = null;
  if (p.still && V && typeof V.footPoly === 'function') { try { f = V.footPoly(p); } catch (err) { f = null; } }
  if (f && Array.isArray(f.pts) && f.pts.length >= 6) return { pts: f.pts, y0: f.y0, y1: f.y1 };
  const r = itemR(p), y0 = num(p.y, 0), pts = [];
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r); }
  return { pts, y0, y1: y0 + itemH(p) };
}
// 凸多边形（世界 [x, z, …]，平移 (ox, oz)）在 OBB b 本地坐标里的范围和它自己的边：SAT。
// 返回 null = 不压（贴着、离开都算不压）；否则 { faces: [+x, −x, +z, −z 四个方向各要推多远才出去] }
function polyBox(b, pts, ox, oz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), n = pts.length / 2, L = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[2 * i] + ox - b.cx, dz = pts[2 * i + 1] + oz - b.cz, lx = dx * c - dz * s, lz = dx * s + dz * c;
    L.push(lx, lz);
    if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
  }
  if (x0 >= b.hx - 1e-4 || x1 <= -b.hx + 1e-4 || z0 >= b.hz - 1e-4 || z1 <= -b.hz + 1e-4) return null;
  // 多边形自己的边当分离轴
  for (let i = 0; i < n; i++) {
    const ax = L[2 * i], az = L[2 * i + 1], bx = L[2 * ((i + 1) % n)], bz = L[2 * ((i + 1) % n) + 1];
    let nx = bz - az, nz = -(bx - ax);
    const len = Math.hypot(nx, nz);
    if (len < 1e-9) continue;
    nx /= len; nz /= len;
    let p0 = Infinity, p1 = -Infinity;
    for (let k = 0; k < n; k++) { const v = L[2 * k] * nx + L[2 * k + 1] * nz; if (v < p0) p0 = v; if (v > p1) p1 = v; }
    const r = b.hx * Math.abs(nx) + b.hz * Math.abs(nz);
    if (p0 >= r - 1e-4 || p1 <= -r + 1e-4) return null;
  }
  return { x0, x1, z0, z1, faces: [b.hx - x0, x1 + b.hx, b.hz - z0, z1 + b.hz] };
}
// 盒子 b 的本地坐标（和 phys 同一约定）↔ 世界
function boxWorld(b, lx, lz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: b.cx + c * lx + s * lz, z: b.cz - s * lx + c * lz };
}
// 上一步（盒子 b0 那个位置）这件在盒子哪一面外面：0 +x、1 −x、2 +z、3 −z，都不在（本来就压着）−1
function sideWas(b, pts, ox, oz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), n = pts.length / 2;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[2 * i] + ox - b.cx, dz = pts[2 * i + 1] + oz - b.cz, lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
  }
  const sep = [x0 - b.hx, -b.hx - x1, z0 - b.hz, -b.hz - z1];
  let best = -1, bv = -1e-4;
  for (let i = 0; i < 4; i++) if (sep[i] > bv) { bv = sep[i]; best = i; }
  return best;
}
const FACE_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// boxes0 → boxes1（同一组部件，上一步和这一步）。返回 { ok, moves:[[p, x, z]] }；ok = false：有一件被夹在车和墙之间推不开。
// mine：这台车正推着（hold 住）的物资 id —— 别人抓着的不推；ign：这台车自己在 phys 里的 key（贴墙滑时不算它）。
// 返修 r10：按物资真实的水平外形（凸包）和车的盒子求压不压 —— 真碰到了才推，沿碰上的那一面推出去（上一步在哪一面外面就从哪一面出去，本来就压着按最浅的一面）
function planPush(boxes0, boxes1, cx, cz, reach, mine, riders, ign) {
  const I = BR.items, moves = [];
  const list = I && Array.isArray(I.list) ? I.list : null;
  if (!list || !list.length) return { ok: true, moves };
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.owner || !Number.isFinite(+p.x)) continue;
    if (p.held && !(mine && mine.has(p.id))) continue;
    if (riders && has(riders, 'has') && riders.has(String(p.id))) continue;   // 叉面上的（跟着车走）
    if (Math.abs(p.x - cx) > reach || Math.abs(p.z - cz) > reach) continue;
    if (!itemOnFloor(p)) continue;
    const F = footOf(p), y0 = F.y0, y1 = F.y1;
    let ox = 0, oz = 0, touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < boxes1.length; k++) {
        const b1 = boxes1[k];
        if (!yOver(b1.minY, b1.maxY, y0, y1)) continue;
        if (Math.abs(p.x + ox - b1.cx) > b1.hx + b1.hz + 0.9 || Math.abs(p.z + oz - b1.cz) > b1.hx + b1.hz + 0.9) continue;
        const h = polyBox(b1, F.pts, ox, oz);
        let face = -1, d = 0;
        if (h) {
          const b0 = boxes0 && pass === 0 ? boxes0[k] : null, was = b0 ? sideWas(b0, F.pts, 0, 0) : -1;
          if (was >= 0) face = was;
          else { face = 0; for (let f = 1; f < 4; f++) if (h.faces[f] < h.faces[face]) face = f; }
          d = h.faces[face] + 0.01;
        } else if (boxes0 && pass === 0) {
          // 薄薄的货叉一步扫过去（上一步在一面外、这一步到了对面外）：退回进来的那一面
          const was = sideWas(boxes0[k], F.pts, 0, 0), now = sideWas(b1, F.pts, ox, oz);
          if (was >= 0 && now >= 0 && (was ^ 1) === now) {
            const c = Math.cos(b1.rot), s = Math.sin(b1.rot);
            let lo = Infinity, hi = -Infinity;
            for (let q = 0; q < F.pts.length; q += 2) {
              const dx = F.pts[q] + ox - b1.cx, dz = F.pts[q + 1] + oz - b1.cz, v = was < 2 ? dx * c - dz * s : dx * s + dz * c;
              if (v < lo) lo = v; if (v > hi) hi = v;
            }
            const e = was < 2 ? b1.hx : b1.hz;
            face = was; d = (was & 1 ? hi + e : e - lo) + 0.01;
          }
        }
        if (face < 0) continue;
        // 盒子本地的方向换回世界：本地 (lx, lz) → 世界 (c·lx + s·lz, −s·lx + c·lz)
        const c = Math.cos(b1.rot), s = Math.sin(b1.rot), fd = FACE_DIR[face];
        ox += (c * fd[0] + s * fd[1]) * d; oz += (-s * fd[0] + c * fd[1]) * d;
        moved = touched = true;
      }
      if (!moved) break;
    }
    if (!touched) continue;
    // 墙挡着：外形的外接盒贴墙滑（phys.moveBox，不算这台车自己）；推不出车的范围就算被夹住
    const g = groundAt(p.x, p.z, num(p.y, 0));
    let mx = ox, mz = oz;
    if (BR.phys && has(BR.phys, 'moveBox')) {
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (let q = 0; q < F.pts.length; q += 2) { bx0 = Math.min(bx0, F.pts[q]); bx1 = Math.max(bx1, F.pts[q]); bz0 = Math.min(bz0, F.pts[q + 1]); bz1 = Math.max(bz1, F.pts[q + 1]); }
      try {
        const res = BR.phys.moveBox(bx0, bz0, bx1, bz1, g + 0.02, Math.max(0.03, y1 - y0 - 0.02), ox, oz, ign ? { ignoreKey: ign } : undefined);
        if (res) { mx = num(res.dx, mx); mz = num(res.dz, mz); }
      } catch (err) { /* 用原值 */ }
    }
    const nx = p.x + mx, nz = p.z + mz;
    if (Math.abs(groundAt(nx, nz, g) - g) > 0.2) return { ok: false, moves, pinned: p };
    for (let k = 0; k < boxes1.length; k++) {
      const b1 = boxes1[k];
      if (!yOver(b1.minY, b1.maxY, y0, y1)) continue;
      const h = polyBox(b1, F.pts, mx, mz);
      if (h && Math.min(h.faces[0], h.faces[1], h.faces[2], h.faces[3]) > 0.005) return { ok: false, moves, pinned: p };
    }
    moves.push([p, nx, nz]);
  }
  return { ok: true, moves };
}
// 推完贴地：静止的物资按「放得稳的静止姿态」的最低顶点贴地（返修 r12 裁定 B，BR.items.rest；老版 items 没有 rest 时按模型包围盒底面 ——
// 验收员 play r10：以前按原点贴地，PTG-B 推一下陷进地里）；浮着转的照旧给地面高度
function pushY(p, x, z) {
  if (!p.still) return undefined;
  let lift = 0;
  try {
    const r = BR.items && has(BR.items, 'rest') ? BR.items.rest(p.type) : null;
    if (r && isFinite(+r.bot)) lift = clamp(-r.bot, -0.05, 0.15);
    else { const inf = BR.items && has(BR.items, 'info') ? BR.items.info(p.type) : null; if (inf) lift = clamp(-num(+inf.bot, 0), -0.01, 0.05); }
  } catch (err) { lift = 0; }
  return groundAt(x, z, num(p.y, 0)) + lift;
}

// ---------- 模拟 ----------
const sims = new Map();
const bufBoxes = [], bufObs = [], bufPeople = [], bufOh = [], bufSide = [], bufSkip = [], bufWheel = [], bufCol = [], bufBoxes2 = [];

function Sim(rec) {
  const r = rec || {};
  this.key = r.key != null ? String(r.key) : 'fk' + (++Sim.n);
  this.x = num(r.x, 0); this.z = num(r.z, 0);
  this.y = num(r.y, groundAt(this.x, this.z, 0));
  this.yaw = wrap(num(r.yaw, num(r.rot, 0)));
  this.steer = num(r.steer, 0);
  this.lift = clamp(num(r.lift, 0), 0, 1);
  this.spd = 0; this.lever = 0; this.engine = 0; this.crankT = 0;
  this.want = null;                                         // start()/stop() 设过才有值（见 step 里发动机的三种用法）
  if (r.on === 1 || r.on === true) this.engine = 1;
  this.lastDir = 1; this.radarT = 0; this.strainT = 0; this.blockLatch = false; this.endLatch = 0;
  this.liftDir = 0; this.hyd = false; this.beep = false;
  this.pushed = new Map();       // 物资 id → 最后一次推的时间
  this.vines = new Map();        // 'chunkKey|i' → 状态
  this.t = 0;
  this.ignore = null;
  this.cargo = [];               // 叉上的货（FE1R F3，每步按 env.riders 重算）
  this.partsAll = [];            // 车身部件 + 两只后轮 + 叉上的货（碰撞用）
  this.lastNote = null;
  sims.set(this.key, this);
}
Sim.n = 0;
Sim.prototype = {
  get pose() { return this.poseObj(); },
  poseObj() {
    const g = G();
    return { x: this.x, z: this.z, y: this.y, yaw: this.yaw, steer: this.steer, lift: this.lift, spd: this.spd, lever: this.lever, engine: this.engine,
      carriage: this.lift * g.carriageTravel, inner: this.lift * g.innerTravel, rpm: this.rpm(), hyd: this.hyd, beep: this.beep, on: this.engine > 0 ? 1 : 0 };
  },
  rpm() {
    if (this.engine < 1) return this.engine > 0 ? 0.15 : 0;
    return clamp(0.1 + 0.75 * Math.abs(this.spd) / CFG.vFwd + (this.hyd ? 0.25 : 0), 0, 1);
  },
  ignoreKeys(env) {
    // 自己的碰撞体：开过的 'veh|<key>#…'、停着的 '<cx,cz>#v<i>' 和它名下的部件（phys 会把 '<层>@' 前缀去掉再比）
    const k = [ 'veh|' + this.key, this.key ];
    if (env && env.ignoreKey != null) for (const e of [].concat(env.ignoreKey)) if (e != null && e !== '') k.push(String(e));
    return k;
  },
  start() { this.want = true; },
  stop() { this.want = false; },
  toWorld(lx, lz) { const o = toW(this.x, this.z, this.yaw, lx, lz, { x: 0, z: 0 }); return o; },
  toLocal(x, z) { return toL(this.x, this.z, this.yaw, x, z, { x: 0, z: 0 }); },
  pointWorld(p) { const w = this.toWorld(p.x, p.z); return { x: w.x, y: this.y + p.y, z: w.z }; },
  seatWorld() { const g = G(); return this.pointWorld({ x: 0, y: g.seatP.y, z: g.seatP.z }); },
  eyeWorld() { return this.pointWorld(G().eyeP); },
  chestWorld() { return this.pointWorld(G().chestP); },
  // 驾驶舱矩形（世界坐标的 OBB + 高度）：怪的攻击距离量到这里
  cab() {
    const g = G(), c = g.cabR, w = this.toWorld(0, (c.z0 + c.z1) / 2);
    return { cx: w.x, cz: w.z, hx: c.x, hz: (c.z1 - c.z0) / 2, rot: this.yaw, minY: this.y + c.yFloor, maxY: this.y + c.yTop };
  },
  obbsWorld() { const g = G(); return worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, g.parts, []); },
  // 碰撞用的部件表：FK_OBB 那 14 块 + 两只后轮（按当前 steer 转）+ 叉上的货（FE1R F2 / F3）
  allParts() {
    const g = G(), a = this.partsAll;
    a.length = 0;
    for (let i = 0; i < g.parts.length; i++) a.push(g.parts[i]);
    const w = wheelParts(g, this.steer);
    a.push(w[0], w[1]);
    for (let i = 0; i < this.cargo.length; i++) a.push(this.cargo[i]);
    return a;
  },
  // 后轮在转角 st 时压到什么（静态碰撞体 / 别的车、人、地上的物资）：返回提示文字 | null（FE1R F2，容差 2 mm）
  wheelHit(st, people, ign, riders) {
    const g = G(), w = wheelParts(g, st), boxes = worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, w, bufWheel);
    const P = BR.phys, skip = this.skipNow && this.skipNow.length ? this.skipNow : undefined;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      b.minY += 0.05;   // 轮胎压得过去的矮东西（地上的板、5 cm 以下）不算
      if (P && has(P, 'overlapOBB')) { let n = 0; try { n = P.overlapOBB(b, { ignoreKey: ign, skipBoxes: skip, tol: 0.002 }); } catch (err) { n = 0; } if (n) return TXT.wheelWall; }
      for (const c of people) if (yOver(b.minY, b.maxY, c.minY, c.maxY) && circleDist2(b, c.x, c.z) < c.r * c.r - 1e-6) return TXT.wheelPerson;
      const I = BR.items, list = I && Array.isArray(I.list) ? I.list : null;
      if (list) for (let k = 0; k < list.length; k++) {
        const it = list[k];
        if (!it || it.owner || it.held || !Number.isFinite(+it.x)) continue;
        if (riders && has(riders, 'has') && riders.has(String(it.id))) continue;
        if (Math.abs(it.x - b.cx) > 0.8 || Math.abs(it.z - b.cz) > 0.8) continue;
        const f = footOf(it);
        if (!yOver(b.minY, b.maxY, f.y0, f.y1)) continue;
        if (polyBox(b, f.pts, 0, 0)) return TXT.wheelThing;
      }
    }
    return null;
  },

  // 联机远端 / levelState 摆位：不做碰撞。opts.push = true 时按上一步到这一步推开地上物资（房主替客机司机推）
  setPose(p, opts) {
    if (!p) return;
    const g = G(), b0 = opts && opts.push ? worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, g.parts, []) : null;
    if (Number.isFinite(+p.x)) this.x = +p.x;
    if (Number.isFinite(+p.z)) this.z = +p.z;
    if (Number.isFinite(+p.y)) this.y = +p.y;
    const yaw = p.yaw != null ? p.yaw : p.rot;
    if (Number.isFinite(+yaw)) this.yaw = wrap(+yaw);
    if (Number.isFinite(+p.steer)) this.steer = clamp(+p.steer, -g.maxSteer, g.maxSteer);
    if (Number.isFinite(+p.lift)) this.lift = clamp(+p.lift, 0, 1);
    if (Number.isFinite(+p.spd)) this.spd = +p.spd;
    if (Number.isFinite(+p.lever)) this.lever = +p.lever;
    if (p.on != null || p.engine != null) {
      const on = p.engine != null ? +p.engine > 0 : !!+p.on;
      this.engine = on ? (p.engine != null ? clamp(+p.engine, 0, 1) : 1) : 0;
    }
    if (b0) {
      const b1 = worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, g.parts, []);
      const plan = planPush(b0, b1, this.x, this.z, 4, this.pushed);
      this.applyPush(plan.moves);
    }
  },

  step(dt, inp, env) {
    const g = G(), E = env || {};
    const events = [];
    let note = null, shake = 0;
    dt = num(dt, 0);
    if (dt > DT_MAX) dt = DT_MAX;
    const out = () => {
      const noise = this.noiseLevel();
      if (noise > 0 && (E.local === true || (E.local !== false && inp)) && BR.entities && has(BR.entities, 'makeNoise')) {
        try { BR.entities.makeNoise(noise, 0.3); } catch (err) { /* 非噩梦模式本来就不生效 */ }
      }
      if (note) this.lastNote = note;
      return { pose: this.poseObj(), events, note, noise, shake: reducedMotion() ? 0 : shake };
    };
    if (!(dt > 0)) return out();
    this.t += dt;

    // ---- 输入 ----
    let thr = 0, st = 0, lv = 0, brake = !!E.brake;
    if (inp) {
      // st：+1 = 往左打（A）
      if (inp.throttle != null || inp.steer != null) { thr = num(inp.throttle, 0); st = num(inp.steer, 0); }
      else if (inp.move) { thr = num(inp.move.y, 0); st = -num(inp.move.x, 0); }
      if (inp.lift != null) lv = num(inp.lift, 0);
      else lv = (inp.liftUp ? 1 : 0) - (inp.liftDown ? 1 : 0);
      if (inp.brake) brake = true;
      thr = clamp(thr, -1, 1); st = clamp(st, -1, 1); lv = clamp(lv, -1, 1);
      if (Math.abs(thr) < 0.05) thr = 0;
      if (Math.abs(st) < 0.05) st = 0;
      if (Math.abs(lv) < 0.2) lv = 0;
    }
    // ---- 发动机 ----
    // 三种用法：① env.phase（vehicles.js 自己管上车、点火的时间线，这里只照着它算着没着车）；
    // ② env.on / start()/stop()（这里管点火 0.8 s、出 'ignite'/'off'）；③ 都没有：有输入就当着车
    let ownCrank = false;
    if (typeof E.phase === 'string' && E.phase) {
      this.engine = E.phase === 'run' ? 1 : E.phase === 'start' ? 0.5 : 0;
    } else if (E.on != null || this.want != null) {
      ownCrank = true;
      const want = E.on != null ? !!E.on : !!this.want;
      this.want = want;
      if (want && this.engine === 0) { this.engine = 0.001; this.crankT = 0; events.push('ignite'); }
      if (!want && this.engine > 0) { this.engine = 0; this.crankT = 0; events.push('off'); }
      if (this.engine > 0 && this.engine < 1) {
        this.crankT += dt;
        this.engine = Math.min(1, Math.max(0.001, this.crankT / CFG.crank));
      }
    } else if (inp) this.engine = 1;
    const running = this.engine >= 1;
    const cranking = this.engine > 0 && !running;
    if (cranking && ownCrank) note = TXT.crank;  // 起动那 0.8 s：按 W 车不动
    if (!running) { thr = 0; lv = 0; st = 0; }
    const stopping = brake || !inp || !running;

    // ---- 雷达（行进方向 1.5 m 内有人或怪） ----
    const people = peopleCircles(this, E, bufPeople);
    const dir = this.spd > 0.05 ? 1 : this.spd < -0.05 ? -1 : thr > 0 ? 1 : thr < 0 ? -1 : this.lastDir;
    let radar = false;
    if (this.engine > 0) radar = this.radarHit(people, dir);
    if (radar) {
      this.radarT -= dt;
      if (this.radarT <= 0) { events.push('radar'); this.radarT = CFG.radarBeep; }
      if (Math.abs(this.spd) > 0.05 || (dir > 0 ? thr > 0 : thr < 0)) note = note || TXT.radar;
    } else this.radarT = 0;

    // ---- 分步积分 ----
    const nSub = Math.max(1, Math.ceil(dt / SUB_DT - 1e-9)), h = dt / nSub;
    let hitInfo = null;
    const ign = this.ignoreKeys(E);
    const oh = overheadList(this, bufOh);
    this.sideNow = sideList(this, bufSide);
    this.skipNow = skipBoxesOf(this.sideNow, bufSkip);
    this.cargo = cargoParts(this, E.riders, this.cargo);
    for (let k = 0; k < nSub; k++) {
      // 方向（液压助力：着车才打得动；熄火停着的车轮子保持原来的角度）
      if (running) {
        const tgt = -st * g.maxSteer;           // 往左打（st > 0）：后轮朝右前方（steer < 0），车头往左
        const back = Math.abs(tgt) < Math.abs(this.steer) - 1e-6 && (tgt === 0 || Math.sign(tgt) === Math.sign(this.steer));
        const s0 = this.steer, s1 = approach(this.steer, tgt, (back ? CFG.steerReturn : CFG.steerRate) * h);
        this.steer = s1;
        // FE1R F2：往外打（|steer| 变大）时后轮会压进墙 / 别的车 / 人 / 地上的东西 —— 停在刚好碰不到的角度（回正一律放行：转角越小后轮伸出车身越少）
        if (Math.abs(s1) > Math.abs(s0) + 1e-9) {
          const w1 = this.wheelHit(s1, people, ign, E.riders);
          if (w1) {
            let lo = s0, hi = s1;
            if (this.wheelHit(s0, people, ign, E.riders)) hi = lo;
            else for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (this.wheelHit(m, people, ign, E.riders)) hi = m; else lo = m; }
            this.steer = lo;
            note = note || w1;
          }
        }
      }
      // 车速
      const fb = g.forkY + this.lift * g.carriageTravel;
      let lim = Infinity;
      const ts = Math.tan(Math.min(Math.abs(this.steer), 1.5));
      if (ts > 1e-3) lim = Math.sqrt(CFG.steerLatK * g.wheelbase / ts);
      for (const [hgt, v] of CFG.liftSlow) if (fb > hgt) { lim = Math.min(lim, v); break; }
      let v = this.spd;
      if (stopping) {
        // 急刹的减速度在开始刹的那一刻定下来（之后不变）：任何速度都在 stopTime 内停住
        if (this.stopDecel == null) this.stopDecel = Math.max(CFG.brakeHard, Math.abs(v) / CFG.stopTime);
        v = approach(v, 0, this.stopDecel * h);
      } else if (radar && (dir > 0 ? (v > 0 || thr > 0) : (v < 0 || thr < 0))) {
        v = approach(v, 0, CFG.brakeHard * h);
        if (dir > 0 && v === 0 && thr < 0) v = Math.max(-CFG.vRev, -CFG.accel * h);   // 往反方向开照常
        if (dir < 0 && v === 0 && thr > 0) v = Math.min(CFG.vFwd, CFG.accel * h);
      } else if (thr > 0) {
        if (v < -1e-6) v = Math.min(0, v + CFG.brakeHard * h);
        else {
          const target = Math.min(thr * CFG.vFwd, lim);
          v = v < target ? Math.min(target, v + CFG.accel * h) : Math.max(target, v - (v > lim ? CFG.brakeHard : CFG.brake) * h);
        }
      } else if (thr < 0) {
        if (v > 1e-6) v = Math.max(0, v - CFG.brakeHard * h);
        else {
          const target = Math.max(thr * CFG.vRev, -lim);
          v = v > target ? Math.max(target, v - CFG.accel * h) : Math.min(target, v + (-v > lim ? CFG.brakeHard : CFG.brake) * h);
        }
      } else {
        v = approach(v, 0, (Math.abs(v) > lim ? CFG.brakeHard : CFG.brake) * h);
      }
      if (!stopping || v === 0) this.stopDecel = null;
      this.spd = v;
      // 升降
      const ln = this.stepLift(h, lv, oh, people, ign, events, E.riders);
      if (ln) note = note || ln;
      // 走
      if (Math.abs(this.spd) > 1e-5) {
        const hi = this.move(h, people, oh, ign, E, events);
        if (hi) {
          hitInfo = hi;
          if (hi.note) note = hi.note;
          if (hi.shake) shake = Math.max(shake, hi.shake);
        }
      }
    }
    if (Math.abs(this.spd) > 0.05) this.lastDir = this.spd > 0 ? 1 : -1;
    if (!hitInfo && Math.abs(this.spd) > 0.1) this.blockLatch = false;
    // 升降杆：跟着按键扳（挡住了也扳着，液压憋着）；松开回中
    this.lever = approach(this.lever, (running ? lv : 0) * CFG.lever, CFG.leverRate * dt);
    this.beep = running && (this.spd < -0.05 || (thr < 0 && this.spd <= 0.05));
    // 推开的物资：车停住了、或者 0.3 s 没再碰，就松手（松手时一次写 levelState）
    this.releasePushed(Math.abs(this.spd) < 1e-6);
    // 藤蔓
    if (E.vines !== false) this.stepVines(dt, this.engine > 0);
    return out();
  },

  noiseLevel() {
    if (this.engine <= 0) return 0;
    if (this.spd < -0.1 || this.beep) return CFG.noise.reverse;
    if (this.spd > 0.1) return CFG.noise.drive;
    return CFG.noise.idle;
  },

  // 雷达区：车头（倒车时车尾）往外 1.5 m；车快到 6 m/s² 都刹不住 1.5 m 时（> 约 3.2 m/s）按刹车距离 + 半个人放长，
  // 免得刹不住、贴着人一下子停死
  radarHit(people, dir) {
    const g = G();
    const R = Math.max(CFG.radar, this.spd * this.spd / (2 * CFG.brakeHard) + 0.45);
    const z0 = dir > 0 ? g.front - R : g.rear, z1 = dir > 0 ? g.front : g.rear + R;
    for (let i = 0; i < people.length; i++) {
      const c = people[i];
      if (c.maxY < this.y + 0.05 || c.minY > this.y + 2.3) continue;
      const l = toL(this.x, this.z, this.yaw, c.x, c.z);
      if (l.z < z0 || l.z > z1) continue;
      if (Math.abs(l.x) > g.halfW + c.r + 0.1) continue;
      return true;
    }
    return false;
  },

  // 升降一小步。lv：+1 升 / −1 降 / 0 停。返回状态行文字 | null
  stepLift(h, lv, oh, people, ign, events, riders) {
    const g = G(), T = g.carriageTravel;
    this.liftDir = lv > 0 ? 1 : lv < 0 ? -1 : 0;
    this.hyd = false;
    if (!lv) { this.strainT = 0; return null; }
    const cur = this.lift;
    if (lv > 0) {
      let want = Math.min(1, cur + CFG.liftUp * lv * h / T);
      // 头顶条目：内门架顶 2.12 + d、挡货架顶 1.24 + 2d 的平面范围和它相交、底面更低 → 停在底面以下 2 cm
      // FE1R F1 / F3：叉上的货跟着货叉架一起算；头顶静态的碰撞体（门楣、货架板……）和别的车也挡（停在它底面以下 2 cm）
      let maxL = 1, word = null;
      const parts = this.allParts();
      const boxes = worldBoxes(g, this.x, this.z, this.y, this.yaw, 0, parts, bufBoxes);
      const P = BR.phys, skip = this.skipNow && this.skipNow.length ? this.skipNow : undefined;
      for (let i = 0; i < boxes.length; i++) {
        const p = parts[i];
        if (!(p.ly > 0)) continue;
        const b = boxes[i], top0 = b.maxY;   // lift = 0 时的顶
        for (const e of oh) {
          if (!obbHitsRect(b, Math.min(e.minX, e.maxX), Math.min(e.minZ, e.maxZ), Math.max(e.minX, e.maxX), Math.max(e.minZ, e.maxZ), 0)) continue;
          const lim = (+e.y - CFG.overheadGap - top0) / p.ly;
          if (lim < maxL) { maxL = lim; word = OH_WORD[e.kind] || '横梁'; }
        }
        // 车身高度上伸出来的东西：这个部件现在在它下面（顶 ≤ 它的底）才挡；在它上面、和它重叠的不管
        const side = this.sideNow || [];
        for (const e of side) {
          const y0 = Math.min(+e.minY, +e.maxY), topNow = top0 + p.ly * cur;
          if (topNow > y0 + 1e-3) continue;
          if (!sideHit(b, e)) continue;
          const lim = (y0 - CFG.overheadGap - top0) / p.ly;
          if (lim < maxL) { maxL = lim; word = sideWord(e); }
        }
        // 静态碰撞体、别的车：这个部件现在的顶到升到底时的顶这一柱（真实平面投影）里、底面在它上面的
        if (P && has(P, 'overlapOBB')) {
          const topNow = top0 + p.ly * cur, topMax = top0 + p.ly;
          if (topMax > topNow + 1e-3) {
            const col = bufCol[0] || (bufCol[0] = { cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, minY: 0, maxY: 0 });
            col.cx = b.cx; col.cz = b.cz; col.hx = b.hx; col.hz = b.hz; col.rot = b.rot; col.minY = topNow - 0.004; col.maxY = topMax + CFG.overheadGap + 0.02;
            const out = bufCol[1] || (bufCol[1] = []);
            try { P.overlapOBB(col, { out, ignoreKey: ign, skipBoxes: skip, tol: 0.001 }); } catch (err) { out.length = 0; }
            for (let k = 0; k < out.length; k++) {
              const so = out[k], y0 = +so.minY;
              if (!(y0 >= topNow - 0.003)) continue;             // 已经和它在同一高度上（旁边的墙、车身挨着的）：不是头顶的
              const lim = (y0 - CFG.overheadGap - top0) / p.ly;
              if (lim < maxL) { maxL = lim; word = lintelLike(so, this.y) ? TXT.overDoor : TXT.overThing; }
            }
            out.length = 0;
          }
        }
      }
      if (want > maxL) want = Math.max(cur, maxL);
      if (want >= 1 && cur < 1) { want = 1; if (this.endLatch !== 1) { events.push('end'); this.endLatch = 1; } }
      if (want <= cur + 1e-7) {
        if (cur >= 1 - 1e-9) return null;          // 到顶了
        // 被头顶东西挡住：液压憋压
        this.strainT -= h;
        if (this.strainT <= 0) { events.push('strain'); this.strainT = 1.5; }
        this.hyd = true;
        return word === TXT.overDoor || word === TXT.overThing ? word : TXT.overhead(word || '横梁');
      }
      this.strainT = 0;
      this.hyd = true;
      if (this.endLatch === -1 && want > 0.002) this.endLatch = 0;
      this.lift = want;
      return null;
    }
    // 降：货叉、货叉架正下方的人、怪、地上物资、碰撞体
    let want = Math.max(0, cur + CFG.liftDown * lv * h / T);
    const under = this.underLimit(people, ign, riders);
    let msg = null;
    if (under && want < under.lift) {
      want = Math.max(Math.min(cur, under.lift), want);
      if (want <= cur + 1e-7 && cur > 1e-6) msg = under.person ? TXT.underPerson : TXT.underThing;
    }
    if (want <= 0 && cur > 0) { want = 0; if (this.endLatch !== -1) { events.push('end'); this.endLatch = -1; } }
    if (this.endLatch === 1 && want < 0.998) this.endLatch = 0;
    if (want < cur - 1e-9) this.hyd = true;
    this.lift = want;
    this.strainT = 0;
    return msg;
  },

  // 往下降最低能到多少（lift 比例），和最先挡住的是人还是东西
  underLimit(people, ign, riders) {
    const g = G(), T = g.carriageTravel;
    const boxes = worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, g.parts, bufBoxes);
    let best = null;
    const consider = (i, top, gap, person) => {
      const p = g.parts[i], b = boxes[i];
      const bottomNow = b.minY;
      if (top > bottomNow + 0.005) return;                 // 不在它下面（已经和它重叠的不管，phys 本来就挡着）
      const bottom0 = bottomNow - p.ly * this.lift;        // lift = 0 时的底
      const lim = (top + gap - bottom0) / p.ly;
      if (!best || lim > best.lift) best = { lift: lim, person };
    };
    for (let i = 0; i < boxes.length; i++) {
      const p = g.parts[i];
      if (!(p.ly > 0) || p.name === 'mastInner') continue;
      const b = boxes[i];
      for (const c of people) {
        if (circleDist2(b, c.x, c.z) >= c.r * c.r) continue;
        consider(i, c.maxY, CFG.underGap.person, true);
      }
    }
    // 地上物资（叉面上的东西在货叉底以上，不算）
    const I = BR.items, list = I && Array.isArray(I.list) ? I.list : null;
    if (list) for (let k = 0; k < list.length; k++) {
      const it = list[k];
      if (!it || it.owner || !Number.isFinite(+it.x)) continue;
      if (riders && has(riders, 'has') && riders.has(String(it.id))) continue;
      if (Math.abs(it.x - this.x) > 3.5 || Math.abs(it.z - this.z) > 3.5) continue;
      const r = itemR(it), top = num(it.y, 0) + itemH(it);
      for (let i = 0; i < boxes.length; i++) {
        const p = g.parts[i];
        if (!(p.ly > 0) || p.name === 'mastInner') continue;
        if (circleDist2(boxes[i], it.x, it.z) >= r * r) continue;
        consider(i, top, CFG.underGap.item, false);
      }
    }
    // 车身高度上伸出来的东西（路锥、消火栓箱……）：在它正上方往下降，停在它的顶面以上
    const side = this.sideNow || [];
    for (const e of side) {
      for (let i = 0; i < boxes.length; i++) {
        const p = g.parts[i];
        if (!(p.ly > 0) || p.name === 'mastInner') continue;
        if (!sideHit(boxes[i], e)) continue;
        consider(i, Math.max(+e.minY, +e.maxY), CFG.underGap.solid, false);
      }
    }
    // 碰撞体（FE1R F4：以前每根货叉三点、货叉架两点往下打射线，车轮挡卡在两条射线中间、货叉侧边下面就漏）：
    // 每个跟着降的部件（货叉架、两根货叉）正下方那一柱 —— 部件的真实平面投影、从地面到部件底面 —— 里的静态碰撞体、别的车，停在最高的顶上
    const P = BR.phys;
    if (P && has(P, 'overlapOBB')) {
      const skip = this.skipNow && this.skipNow.length ? this.skipNow : undefined;
      const col = bufCol[2] || (bufCol[2] = { cx: 0, cz: 0, hx: 0, hz: 0, rot: 0, minY: 0, maxY: 0 });
      const out = bufCol[3] || (bufCol[3] = []);
      // 叉上的货（FE1R F3）伸出叉尖、悬在外面的那截也一样：它的底面下面有东西就停
      const parts = this.allParts(), pb = worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, parts, bufBoxes2);
      for (let i = 0; i < pb.length; i++) {
        const p = parts[i];
        if (!(p.ly > 0) || p.name === 'mastInner') continue;
        const b = pb[i], ground = groundAt(b.cx, b.cz, this.y);
        if (b.minY - ground < 0.012) continue;
        col.cx = b.cx; col.cz = b.cz; col.hx = b.hx; col.hz = b.hz; col.rot = b.rot; col.minY = ground - 0.005; col.maxY = b.minY - 0.0005;
        try { P.overlapOBB(col, { out, ignoreKey: ign, skipBoxes: skip, tol: 0.0005 }); } catch (err) { out.length = 0; }
        for (let k = 0; k < out.length; k++) {
          const top = +out[k].maxY;
          if (!(top > ground + 0.005) || top > b.minY + 0.005) continue;   // 已经和它重叠的不管（phys 本来就挡着）
          const lim = (top + CFG.underGap.solid - (b.minY - p.ly * this.lift)) / p.ly;
          if (!best || lim > best.lift) best = { lift: lim, person: false };
        }
        out.length = 0;
      }
    }
    if (best) best.lift = clamp(best.lift, 0, 1);
    return best;
  },

  // 走一小步：算运动、扫掠、按方案的顺序试替代方案。返回撞上的信息 | null
  move(h, people, oh, ign, E, events) {
    const g = G(), v = this.spd, L = g.wheelbase;
    const dpsi = -v * Math.tan(this.steer) / L * h;
    const F0 = toW(this.x, this.z, this.yaw, 0, g.frontAxleZ, { x: 0, z: 0 });
    const half = dpsi / 2, sinc = Math.abs(half) > 1e-6 ? Math.sin(half) / half : 1;
    const chord = v * h * sinc, mid = this.yaw + half;
    const full = { dx: chord * fwdX(mid), dz: chord * fwdZ(mid), dyaw: dpsi, px: F0.x, pz: F0.z };
    // 障碍：本文件管的（人、实体、出口圈、keepClear、头顶条目）
    const obs = bufObs;
    obs.length = 0;
    for (const c of people) obs.push(c);
    blockerObs(this, obs);
    ohObs(oh, obs);
    if (this.sideNow) sideObs(this.sideNow, obs);
    // 扫掠的部件：车身 14 块 + 两只后轮（FE1R F2）+ 叉上的货（FE1R F3，伸出叉尖那一截也算）
    const all = this.allParts();
    const test = (mo, list) => {
      const pl = list || all;
      const a = physSweep(this, g, this.lift, mo, ign, pl);
      const b = sweepLocal(g, this, this.lift, mo, pl, obs);
      if (!a && !b) return null;
      if (a && (!b || a.t <= b.t)) return { t: a.t, key: a.key, ob: null };
      return { t: b.t, key: b.ob.key || b.ob.id, ob: b.ob };
    };
    const hit = test(full);
    let mo = full, frac = 1, info = null;
    if (hit) {
      // ① 转角改变减半
      const halfYaw = Object.assign({}, full, { dyaw: dpsi / 2 });
      const straight = { dx: chord * fwdX(this.yaw), dz: chord * fwdZ(this.yaw), dyaw: 0, px: F0.x, pz: F0.z };
      if (Math.abs(dpsi) > 1e-7 && !test(halfYaw)) { mo = halfYaw; }
      else {
        // ② 不转角（沿车头方向直走）：只在车头那一半蹭着时允许 —— 倒车打方向把车尾带离墙时，前轮前面那截会蹭着墙滑。
        //    车尾那一半撞上（后轮转向，车尾往外甩）就是真走不了：停住；往前开时提示先倒车带出来
        const turning = Math.abs(dpsi) > 1e-7;
        const tail = turning && !!test(full, g.rearParts.concat(wheelParts(g, this.steer)));
        const sHit = turning ? test(straight) : hit;
        if (turning && !sHit && !tail) { mo = straight; }
        else {
          // ③ 停在接触前
          frac = hit.t;
          info = this.classify(hit, tail && !sHit && v > 0, v);
        }
      }
    }
    if (frac < 1) {
      const disp = Math.hypot(mo.dx, mo.dz) + Math.abs(mo.dyaw) * 2.6;
      frac = disp > 1e-9 ? Math.max(0, frac - 0.002 / disp) : 0;
    }
    const pushL = g.parts.concat(wheelParts(g, this.steer));   // 推地上物资：车身 + 后轮（FE1R F2：打着方向开，轮胎不扫进物资）
    const b0 = E.pushItems === false ? null : boxesAt(g, this, this.lift, mo, 0, pushL, []);
    const o = rotAbout(this.x, this.z, mo.px, mo.pz, mo.dyaw * frac, { x: 0, z: 0 });
    const nx = o.x + mo.dx * frac, nz = o.z + mo.dz * frac, nyaw = wrap(this.yaw + mo.dyaw * frac);
    // 地上物资：先算推得开推不开（被夹在车和墙之间就整步不走）
    if (b0 && frac > 0) {
      const b1 = worldBoxes(g, nx, nz, this.y, nyaw, this.lift, pushL, []);
      const plan = planPush(b0, b1, (this.x + nx) / 2, (this.z + nz) / 2, 4, this.pushed, E.riders, E.ignoreKey);
      if (!plan.ok) {
        // 有一件被夹在车和墙之间（FE1 返修 r3 裁定 ②）：车停在还推得动的最远处（这一步里二分），被推的东西停在车和墙之间，
        // 不穿墙、不压进货叉；按撞上那一刻的车速出声 —— ≥ bangV 是「哐」+ 镜头抖（叉上的瓶罐照常甩出去，vehicles 看 'bang'），
        // 慢慢顶上去才是「咚」
        let lo = 0, hi = frac, best = null, bx = this.x, bz = this.z, byaw = this.yaw;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          const om = rotAbout(this.x, this.z, mo.px, mo.pz, mo.dyaw * mid, { x: 0, z: 0 });
          const mx = om.x + mo.dx * mid, mz = om.z + mo.dz * mid, myaw = wrap(this.yaw + mo.dyaw * mid);
          const pm = planPush(b0, worldBoxes(g, mx, mz, this.y, myaw, this.lift, pushL, []), (this.x + mx) / 2, (this.z + mz) / 2, 4, this.pushed, E.riders, E.ignoreKey);
          if (pm.ok) { lo = mid; best = pm; bx = mx; bz = mz; byaw = myaw; } else hi = mid;
        }
        if (best) {
          this.applyPush(best.moves);
          this.x = bx; this.z = bz; this.yaw = byaw;
          this.y = groundAt(bx, bz, this.y);
        }
        const sp = Math.abs(v), sound = sp >= CFG.bangV ? 'bang' : sp > 0.05 ? 'bump' : null;
        this.spd = 0;
        const pin = { note: null, sound, shake: 0, pinned: true };
        if (!this.blockLatch) {
          this.blockLatch = true;
          if (sound) events.push(sound);
          if (sound === 'bang') pin.shake = CFG.shakeS;
        }
        return pin;
      }
      this.applyPush(plan.moves);
    }
    this.x = nx; this.z = nz; this.yaw = nyaw;
    this.y = groundAt(nx, nz, this.y);
    if (info) {
      this.spd = 0;
      if (!this.blockLatch) {
        this.blockLatch = true;
        if (info.sound) events.push(info.sound);
        if (info.sound === 'bang') info.shake = CFG.shakeS;
      }
      return info;
    }
    return null;
  },

  // 撞上的是什么：出口圈、被拖出来的家具、头顶东西、人、别的；tail = 车尾往外甩
  classify(hit, tail, v) {
    const ob = hit.ob, sp = Math.abs(v);
    const sound = sp >= CFG.bangV ? 'bang' : sp > 0.05 ? 'bump' : null;
    if (ob && ob.person) return { note: TXT.radar, sound: null };
    // 出口圈、keepClear 是看不见的禁区：停住、提示，不出「咚」
    if (ob && ob.exit) return { note: v < 0 ? TXT.exitBack : TXT.exit, sound: null };
    if (ob && ob.keep) return { note: ob.why || null, sound: null };
    if (ob && ob.oh) return { note: TXT.overhead(OH_WORD[ob.oh.kind] || '横梁'), sound };
    if (tail) return { note: TXT.tail, sound };
    if (hit.key && propOfKey(this, hit.key)) return { note: v < 0 ? TXT.propBack : TXT.prop, sound };
    return { note: null, sound };
  },

  applyPush(moves) {
    const I = BR.items;
    if (!moves || !moves.length || !I || !has(I, 'move')) return;
    const t = this.t;
    for (const [p, x, z] of moves) {
      if (!this.pushed.has(p.id) && has(I, 'hold')) { try { I.hold(p.id, true); } catch (err) { /* 没有 hold 也能推 */ } }
      this.pushed.set(p.id, t);
      try { I.move(p.id, x, pushY(p, x, z), z); } catch (err) { /* 已经被捡走 */ }
    }
  },
  releasePushed(all) {
    if (!this.pushed.size) return;
    const I = BR.items;
    const done = [];
    this.pushed.forEach((t, id) => { if (all || this.t - t > 0.3) done.push(id); });
    for (const id of done) {
      this.pushed.delete(id);
      if (I && has(I, 'hold')) { try { I.hold(id, false); } catch (err) { /* 已经没了 */ } }
    }
  },
  release() { this.releasePushed(true); },
  // 当前 OBB 里压着的地上物资推出去（载入、升格、摆位后调；一帧内推干净）
  clearItems() { return clearItems(this.obbsWorld()); },

  // ---------- 下车落点 ----------
  exitSpot(pref, force) {
    const g = G();
    let order;
    if (pref === 'left' || pref === 'right' || pref === 'rear') order = pref === 'rear' ? ['rear', 'left', 'right'] : pref === 'left' ? ['left', 'right', 'rear'] : ['right', 'left', 'rear'];
    else {
      let yaw = null;
      if (typeof pref === 'number' && Number.isFinite(pref)) yaw = pref;
      else if (pref && typeof pref === 'object' && Number.isFinite(+pref.yaw)) yaw = +pref.yaw;
      else if (BR.player && Number.isFinite(+BR.player.yaw)) yaw = +BR.player.yaw;
      const rel = yaw == null ? 0 : wrap(yaw - this.yaw);   // + = 往左看
      const deg = rel * 180 / Math.PI;
      order = deg < -20 ? ['right', 'left', 'rear'] : ['left', 'right', 'rear'];
    }
    const people = peopleCircles(this, { local: true }, []);
    const blk = blockerObs(this, []);
    const boxes = this.obbsWorld();
    const chest = this.chestWorld();
    for (const side of order) {
      const l = side === 'left' ? { x: -g.exitSideP.x, z: g.exitSideP.z } : side === 'right' ? { x: g.exitSideP.x, z: g.exitSideP.z } : { x: g.exitRearP.x, z: g.exitRearP.z };
      const w = this.toWorld(l.x, l.z);
      const y = this.spotOk(w.x, w.z, boxes, people, blk, side === 'rear' ? 'rear' : chest, true);
      if (y != null) return { x: w.x, z: w.z, y, side };
    }
    if (!force) return null;
    // 强制：从车旁一圈圈往外找（先要求看得见座椅，再放宽）
    const pdir = order[0] === 'right' ? 1 : -1;
    for (const needLos of [true, false]) {
      for (let R = 0.95; R <= 8.01; R += 0.25) {
        const n = Math.max(16, Math.ceil(2 * Math.PI * R / 0.3));
        const cands = [];
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2;
          const lx = Math.cos(a) * R, lz = -0.4 + Math.sin(a) * R;
          cands.push({ lx, lz, pen: Math.abs(wrap(Math.atan2(lz + 0.4, lx) - (pdir > 0 ? 0 : Math.PI))) });
        }
        cands.sort((a, b) => a.pen - b.pen);
        for (const c of cands) {
          const w = this.toWorld(c.lx, c.lz);
          const y = this.spotOk(w.x, w.z, boxes, people, blk, needLos ? chest : null, true);
          if (y != null) return { x: w.x, z: w.z, y, side: 'free' };
        }
      }
    }
    // 实在没有（几乎不可能）：只要求不在车的 OBB 和出口圈里
    for (let R = 1; R <= 12; R += 0.5) {
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2, w = this.toWorld(Math.cos(a) * R, -0.4 + Math.sin(a) * R);
        if (this.spotBasic(w.x, w.z, boxes, blk)) return { x: w.x, z: w.z, y: groundAt(w.x, w.z, this.y), side: 'free' };
      }
    }
    return null;
  },
  spotBasic(x, z, boxes, blk) {
    const r = personVehR();
    for (const b of boxes) if (circleDist2(b, x, z) < (r + 0.02) * (r + 0.02)) return false;
    for (const b of blk) {
      if (b.kind === 'circle') { if (Math.hypot(b.x - x, b.z - z) < b.r) return false; }
      else if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false;
    }
    return true;
  },
  // 站得下：返回地面高度 | null。from = 座椅胸口点（看得见）/ 'rear'（翻过配重：经过配重上方）/ null
  spotOk(x, z, boxes, people, blk, from, strict) {
    // 落点离车身 OBB 按人对载具的半径（spotBasic）；离墙 / 静态碰撞体按人自己的碰撞半径
    const r = num(BR.config && BR.config.player && BR.config.player.radius, 0.3), rv = personVehR(), P = BR.phys;
    const gy = groundAt(x, z, this.y);
    if (Math.abs(gy - this.y) > 0.35) return null;
    if (!this.spotBasic(x, z, boxes, blk)) return null;
    if (P && has(P, 'overlapCircle')) { try { if (P.overlapCircle(x, z, r, gy + 0.02, CFG.personH - 0.04)) return null; } catch (err) { /* 当成能站 */ } }
    if (strict) for (const c of people) {
      if (c.maxY < gy + 0.05 || c.minY > gy + 1.8) continue;
      if (Math.hypot(c.x - x, c.z - z) < c.r + rv) return null;
    }
    if (from && P && has(P, 'los')) {
      const ty = gy + 1.2;
      let ok = true;
      try {
        if (from === 'rear') {
          const g = G(), c = this.chestWorld(), top = this.pointWorld({ x: 0, y: Math.max(1.95, c.y - this.y + 0.25), z: g.rear - 0.05 });
          ok = P.los(c.x, c.y, c.z, top.x, top.y, top.z) && P.los(top.x, top.y, top.z, x, gy + 1.5, z);
        } else ok = P.los(from.x, from.y, from.z, x, ty, z);
      } catch (err) { ok = true; }
      if (!ok) return null;
    }
    return gy;
  },

  // ---------- 前大灯 ----------
  // 点光源没有阴影（全游戏 shadowMap 关着）：「不透墙」靠光球不伸到挡光的东西的影子里（FE1P H8 → FE1R，见 lightSolve / shadowBound）。
  // 光源落点每帧在叉尖前一排候选位置里挑（FE1R K2：车前是空地时叉尖前 0.5–3 m 的地面一定亮），挑中的位置逐帧平滑过去（不一跳一跳），
  // 光球按平滑后的实际位置当帧收（不漏光）。返回的 range / intensity 就是画面上那盏灯的；world.lightAt 也按它们算（FE1Q J8），
  // 只有驾驶舱另算（litSeat：开着大灯司机算被照亮）
  lightSpot() {
    const r = lightSolve(this);
    return { x: r.x, y: r.y, z: r.z, range: r.range, color: CFG.light.color, intensity: r.intensity, flicker: 0, decay: 2, owner: 'forklift:' + this.key };
  },
  // (x, z) 在这台车的驾驶舱里（cab 的矩形：本地 |x| ≤ 0.4、z −0.5…0.55，坐着的司机的位置 = 眼点 z 0.16）就返回 lightInfo.seatLit，否则 0。
  // world.lightAt 对开着的大灯（'fk:' / 'fkr:'）取 max(画面上这一点被照得多亮, litSeat)（FE1Q J8）
  litSeat(x, z) {
    const inf = this.lightInfo;
    if (!inf || !(inf.seatLit > 0)) return 0;
    const c = G().cabR, l = toL(this.x, this.z, this.yaw, x, z, tmpSeat);
    return Math.abs(l.x) <= c.x && l.z >= c.z0 && l.z <= c.z1 ? inf.seatLit : 0;
  },

  // ---------- 藤蔓（纯表现，不同步） ----------
  // 车附近 4 m 内的藤蔓：下段碰到看得见的护顶架、门架零件、链条（FE1Q J3，见 vineVolumes；不按物理 OBB）或司机头胸那段胶囊，
  // 就绕藤蔓顶点往离车的方向转开，转到刚好贴着（表面离车 0–1 cm：藤蔓是 3.6 cm 见方的细杆，按外接圆柱、平的底端算不穿，
  // 侧面平着贴上去时最多留 7.5 mm，转角二分到 0.5 mrad）；车停着时藤蔓靠在把它推开的东西上（往回摆一点就碰：二分到刚好贴着），
  // 车走了 1.2 s 内慢慢摆回，摆到 0 时 spanRestore 逐位恢复。每一帧最后的角度都核过「碰不到」（车还在动时摆回去的路上也不会穿进护顶）。
  // S.touch：这一帧藤蔓是被车顶着的（新碰上、被推开、靠在上面），测试按它查「贴着」
  stepVines(dt, seated) {
    const K = BR.kit;
    if (!K || !has(K, 'spanEdit')) return;
    const V = CFG.vine;
    let vols = null;   // 附近有藤蔓才算挡体（门架零件第一次用到时按档建一次缓存）
    const seen = new Set();
    for (const c of nearChunks(this.x, this.z)) {
      const d = chunkData(c), vs = d && d.vines;
      if (!Array.isArray(vs) || !c.res) continue;
      for (let i = 0; i < vs.length; i++) {
        const vn = vs[i];
        if (!vn || !Array.isArray(vn.top) || !Array.isArray(vn.bot) || !Array.isArray(vn.v)) continue;
        if (Math.hypot(vn.top[0] - this.x, vn.top[2] - this.z) > V.reach) continue;
        const id = c.key + '|' + i;
        seen.add(id);
        let S = this.vines.get(id);
        const vv = vineVolsFor(vn, vols || (vols = this.vineVolumes(seated)));
        if (!S && !vv.boxes.length && !vv.caps.length && !vv.cyls.length && !vv.polys.length) continue;
        if (!S) {
          if (this.vineClear(vn, vv, [1, 0], 0)) continue;
          const best = this.vineSearch(vn, vv, null);
          S = { id, c, res: c.res, vn, dir: best.dir, th: 0, peak: 0, frame: null, touch: true };
          this.vines.set(id, S);
          this.vineSet(S, best.th);
          continue;
        }
        S.res = c.res; S.c = c;
        const te = Math.max(0, S.th - Math.max(S.peak, 0.2) * dt / V.back);
        let th = te;
        S.touch = false;
        if ((vv.boxes.length || vv.caps.length || vv.cyls.length || vv.polys.length) && !this.vineClear(vn, vv, S.dir, te)) {
          S.touch = true;
          // 摆回去一点就碰：靠在把它推开的东西上（二分到刚好贴着），等车走开再摆
          if (S.th > te && this.vineClear(vn, vv, S.dir, S.th)) th = this.vineBisect(vn, vv, S.dir, te, S.th);
          else {
            const up = this.vineMinTh(vn, vv, S.dir, Math.max(te, S.th));
            if (up != null) th = up;
            else { const best = this.vineSearch(vn, vv, S); S.dir = best.dir; th = best.th; }
          }
        }
        this.vineSet(S, th);
      }
    }
    this.vines.forEach((S, id) => {
      if (seen.has(id)) return;
      // 车走远了（或区块换了）：照样摆回去
      if (!S.c || !S.res || (BR.world && has(BR.world, 'chunkAt') && BR.world.chunkAt(S.vn.top[0], S.vn.top[2]) !== S.c)) { this.vines.delete(id); return; }
      this.vineSet(S, Math.max(0, S.th - Math.max(S.peak, 0.2) * dt / V.back));
    });
  },
  // 藤蔓碰得到的车身（世界坐标）：{ boxes: [OBB，可带斜切 sk…], caps: [胶囊…], cyls: [竖直棱台…], polys: [凸多面体…] }，都是看得见的那几块（FE1Q J3）：
  //   护顶架见 VINE_GUARD / guardVolumes —— 不再用物理 roof 盒子（2.05–2.20，为了包住警示灯比横梁顶高 10 cm）和四根立柱的物理盒子
  //   （斜立柱的外包盒，后立柱顶上比看得见的立柱多出 8 cm）；
  //   门架（外门架、内门架、货叉架）见 mastVolumes —— 按这一档可动模型的零件，不再用物理盒子（外门架盒子 ±0.45 是为了包住 0.94 m 高的油缸耳座，
  //   门架顶上比立柱宽出 8.5 cm；内门架盒子比立柱往后多 13 cm）；链条按 FORKLIFT_GEO 现算（随 lift 变）。
  // 物理 OBB（FK_OBB、phys 里登记的）不动。tier（可选，测试用）：按这一档算（缺省按 BR.vehicles 里这台车可动模型的档）
  vineVolumes(seated, tier) {
    const pad = CFG.vine.pad || 0, L = driveLod(this.key, tier);
    const vols = [], caps = [], cyls = [], polys = [];
    mastVolumes(this, L, tier || driveTier(this.key), pad, vols, polys);
    guardVolumes(this, L, pad, vols, caps, cyls);
    if (seated) {
      const c = this.chestWorld(), e = this.eyeWorld();
      caps.push({ name: 'driver', a: c, b: { x: e.x, y: e.y + 0.12, z: e.z }, r: CFG.vine.head + pad });
    }
    return { boxes: vols, caps, cyls, polys };
  },
  // 藤蔓（往 dir 摆 th）碰不碰得到车。藤蔓是方杆（半宽 r，外接圆半径 R = r·√2），按外接圆柱算、底端是平的：
  //   ① 离顶点 4% 到离底端 R + 0.5 mm 那段轴线（线段）到每个盒子 / 胶囊 / 棱台 / 凸多面体的真实距离（3D）不小于 R + 0.5 mm；
  //   ② 最下面那截（底面和往上 0.7 / 1.4 / 2.1 cm 四圈，每圈外接圆上 16 个点，弦和弧差 <0.5 mm）每个点离每样东西 ≥0.5 mm。
  // ② 让底端靠在护顶上时按平的底面贴着（FE1Q J3：以前整根按胶囊算，底端是半球，藤蔓尖顶在纵梁上时离纵梁空出 1 cm 多）
  vineClear(vn, vols, dir, th) {
    const t = vn.top, b = vn.bot, R = num(vn.r, 0.02) * Math.SQRT2, r = R + 0.0005;
    const hx = b[0] - t[0], hy = b[1] - t[1], hz = b[2] - t[2], len = Math.hypot(hx, hy, hz) || 1;
    const rot = vineRot(dir, th), k1 = Math.max(0.04, 1 - r / len);
    const p = applyRot(rot, hx * 0.04, hy * 0.04, hz * 0.04), q = applyRot(rot, hx * k1, hy * k1, hz * k1);
    const ax = t[0] + p[0], ay = t[1] + p[1], az = t[2] + p[2], bx = t[0] + q[0], by = t[1] + q[1], bz = t[2] + q[2];
    for (const o of vols.boxes) if (segObbDist2(ax, ay, az, bx, by, bz, o, r) < r * r) return false;
    for (const C of vols.caps) if (segSegDist(ax, ay, az, bx, by, bz, C.a.x, C.a.y, C.a.z, C.b.x, C.b.y, C.b.z) < C.r + r) return false;
    for (const F of vols.cyls) if (segCylDist(ax, ay, az, bx, by, bz, F, r) < r) return false;
    for (const P of vols.polys) if (segPolyDist(ax, ay, az, bx, by, bz, P, r) < r) return false;
    // 底端那截：只看离底端够近的东西（底端到它的距离 < 底端那截的外接半径 + 5 cm）
    const e = applyRot(rot, hx, hy, hz), ex = t[0] + e[0], ey = t[1] + e[1], ez = t[2] + e[2];
    const near = [];
    for (const o of vols.boxes) if (ptObbDist(o, ex, ey, ez) < 0.08) near.push(o);
    for (const C of vols.caps) if (segSegDist(ex, ey, ez, ex, ey, ez, C.a.x, C.a.y, C.a.z, C.b.x, C.b.y, C.b.z) - C.r < 0.08) near.push(C);
    for (const F of vols.cyls) if (prismDist(F, ex, ey, ez) < 0.08) near.push(F);
    for (const P of vols.polys) if (polyDist(P, ex, ey, ez) < 0.08) near.push(P);
    if (!near.length) return true;
    const ring = vineRing(vn, R);
    for (let i = 0; i < ring.length; i += 3) {
      const w = applyRot(rot, ring[i], ring[i + 1], ring[i + 2]), x = t[0] + w[0], y = t[1] + w[1], z = t[2] + w[2];
      for (const o of near) {
        const d = o.pl ? polyDist(o, x, y, z) : o.m ? prismDist(o, x, y, z) : o.a ? segSegDist(x, y, z, x, y, z, o.a.x, o.a.y, o.a.z, o.b.x, o.b.y, o.b.z) - o.r : ptObbDist(o, x, y, z);
        if (d < 0.0005) return false;
      }
    }
    return true;
  },
  // 换方向找：离车的方向（车中线上离藤蔓顶最近的点 → 藤蔓顶）附近 16 个方向，挑转得最少的（离车越正、和原来的方向越近越好）
  vineSearch(vn, vols, S) {
    const l = this.toLocal(vn.top[0], vn.top[2]);
    const lz = clamp(l.z, -1.2, 0.6);
    let ax = l.x, az = l.z - lz;
    if (Math.hypot(ax, az) < 0.05) { ax = l.x >= 0 ? 1 : -1; az = 0; }
    const al = Math.hypot(ax, az);
    const away = this.toWorld(ax / al, az / al), aw = [away.x - this.x, away.z - this.z];
    const aL = Math.hypot(aw[0], aw[1]) || 1; aw[0] /= aL; aw[1] /= aL;
    const cands = [];
    for (let i = 0; i < 16; i++) {
      const a = Math.atan2(aw[1], aw[0]) + (i < 1 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 8);
      cands.push([Math.cos(a), Math.sin(a)]);
    }
    let best = null;
    for (const d of cands) {
      const dot = d[0] * aw[0] + d[1] * aw[1];
      if (dot < -0.35) continue;
      const th = this.vineMinTh(vn, vols, d, 0);
      if (th == null) continue;
      const cost = th + 0.25 * (1 - dot) + (S && S.th > 0 ? 0.3 * (1 - (d[0] * S.dir[0] + d[1] * S.dir[1])) : 0);
      if (!best || cost < best.cost) best = { dir: d, th, cost };
    }
    if (!best) best = { dir: S && S.th > 0 ? S.dir : aw, th: 1.45, cost: 9 };
    return best;
  },
  // 从 from 往上找最小的、碰不到车的转角（核过的值）；1.45 rad 以内找不到返回 null
  vineMinTh(vn, vols, d, from) {
    let lo = from, hi = -1;
    for (let th = from + 0.04; th <= 1.45 + 1e-9; th += 0.04) {
      if (this.vineClear(vn, vols, d, th)) { hi = th; break; }
      lo = th;
    }
    if (hi < 0) return null;
    return this.vineBisect(vn, vols, d, lo, hi);
  },
  // lo 碰、hi 不碰：二分到 0.5 mrad（2 m 长的藤蔓下端差 1 mm），返回不碰的那一头
  vineBisect(vn, vols, d, lo, hi) {
    for (let i = 0; i < 12 && hi - lo > 0.0005; i++) { const m = (lo + hi) / 2; if (this.vineClear(vn, vols, d, m)) hi = m; else lo = m; }
    return hi;
  },
  vineSet(S, th) {
    if (!(th > 1e-4)) {
      try { BR.kit.spanRestore(S.res, S.vn.mat || 'kit:prop', S.vn.v); } catch (err) { /* 网格已经没了 */ }
      this.vines.delete(S.id);
      return;
    }
    S.peak = th > S.th ? Math.max(S.peak, th) : S.peak;
    if (th === S.th && S.applied) return;
    S.th = th;
    S.applied = true;
    this.vineApply(S);
  },
  vineApply(S) {
    const vn = S.vn, mat = vn.mat || 'kit:prop', rot = vineRot(S.dir, S.th);
    const top = vn.top;
    const self = this;
    try {
      BR.kit.spanEdit(S.res, mat, vn.v, function (pos, nrm, orig) {
        const P0 = orig && orig.pos ? orig.pos : (S.orig || (S.orig = Float32Array.from(pos)));
        const N0 = orig && orig.nrm ? orig.nrm : (S.origN || (nrm ? (S.origN = Float32Array.from(nrm)) : null));
        if (!S.frame) S.frame = vineFrame(S, P0);
        const px = top[0] - S.frame.ox, py = top[1], pz = top[2] - S.frame.oz;
        for (let i = 0; i + 2 < pos.length; i += 3) {
          const v = applyRot(rot, P0[i] - px, P0[i + 1] - py, P0[i + 2] - pz);
          pos[i] = px + v[0]; pos[i + 1] = py + v[1]; pos[i + 2] = pz + v[2];
          if (nrm && N0) { const q = applyRot(rot, N0[i], N0[i + 1], N0[i + 2]); nrm[i] = q[0]; nrm[i + 1] = q[1]; nrm[i + 2] = q[2]; }
        }
        return pos;
      });
    } catch (err) { once('vine', () => console.warn('[forklift] 藤蔓拨开出错', err)); self.vines.delete(S.id); }
  },
  dispose() {
    this.releasePushed(true);
    this.vines.forEach(S => { try { BR.kit.spanRestore(S.res, S.vn.mat || 'kit:prop', S.vn.v); } catch (err) { /* 已经没了 */ } });
    this.vines.clear();
    if (sims.get(this.key) === this) sims.delete(this.key);
  },
};
// 藤蔓底端那截的取样点（相对顶点、没转的时候）：底面和往上 0.7 / 1.4 / 2.1 cm 四圈，每圈外接圆上 16 个点。按藤蔓缓存
const ringCache = new WeakMap();
function vineRing(vn, R) {
  let a = ringCache.get(vn);
  if (a) return a;
  const t = vn.top, b = vn.bot, hx = b[0] - t[0], hy = b[1] - t[1], hz = b[2] - t[2], len = Math.hypot(hx, hy, hz) || 1;
  const ux = hx / len, uy = hy / len, uz = hz / len;
  // 和轴线垂直的两个方向
  let e1x = -uz, e1y = 0, e1z = ux, l1 = Math.hypot(e1x, e1z);
  if (l1 < 1e-6) { e1x = 1; e1y = 0; e1z = 0; l1 = 1; }
  e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;
  a = [];
  for (const h of [0, 0.007, 0.014, 0.021]) for (let k = 0; k < 16; k++) {
    const f = k / 16 * Math.PI * 2, c = Math.cos(f) * R, s = Math.sin(f) * R;
    a.push(hx - ux * h + e1x * c + e2x * s, hy - uy * h + e1y * c + e2y * s, hz - uz * h + e1z * c + e2z * s);
  }
  ringCache.set(vn, a);
  return a;
}
// 点到盒子（phys 格式，可带斜切 sk）的距离；在里面为 0
function ptObbDist(o, x, y, z) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), cy = (o.minY + o.maxY) / 2, hy = (o.maxY - o.minY) / 2, dx = x - o.cx, dz = z - o.cz, py = y - cy;
  const px = dx * c - dz * s, pz = dx * s + dz * c - (o.sk || 0) * py;
  const ex = Math.max(0, Math.abs(px) - o.hx), ey = Math.max(0, Math.abs(py) - hy), ez = Math.max(0, Math.abs(pz) - o.hz);
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}
// 点到凸多面体（各面平面有向距离取最大）
function polyDist(P, x, y, z) {
  const W = P.pl;
  let d = -Infinity;
  for (let i = 0; i < W.length; i += 4) { const q = W[i] * x + W[i + 1] * y + W[i + 2] * z - W[i + 3]; if (q > d) d = q; }
  return d;
}
// 点在不在藤蔓挡体里（sim.vineVolumes 的结果）：在哪一块里返回它的名字，都不在返回 null（测试用：藤蔓顶点每一帧都不该在里面）
function vineHit(V, x, y, z) {
  if (!V) return null;
  for (const o of V.boxes || []) if (ptObbDist(o, x, y, z) <= 0) return o.name || 'box';
  for (const C of V.caps || []) if (segSegDist(x, y, z, x, y, z, C.a.x, C.a.y, C.a.z, C.b.x, C.b.y, C.b.z) < C.r) return C.name || 'cap';
  for (const F of V.cyls || []) if (prismDist(F, x, y, z) < 0) return F.name || 'cyl';
  for (const P of V.polys || []) if (polyDist(P, x, y, z) < 0) return P.name || 'poly';
  return null;
}
// 只留够得着这根藤蔓的那几块（藤蔓绕顶点转，够得着的范围是以顶点为心、藤长为半径的球）
function vineVolsFor(vn, vols) {
  const t = vn.top, b = vn.bot, len = Math.hypot(b[0] - t[0], b[1] - t[1], b[2] - t[2]) + 0.05;
  const boxes = [], caps = [], cyls = [];
  for (const bx of vols.boxes) {
    if (bx.maxY < t[1] - len || bx.minY > t[1]) continue;
    const lean = bx.sk ? Math.abs(bx.sk) * (bx.maxY - bx.minY) / 2 : 0;   // 斜立柱：上下两头沿 z 各偏出这么多
    if (Math.sqrt(Math.max(0, circleDist2(bx, t[0], t[2]))) - lean > len) continue;
    boxes.push(bx);
  }
  for (const C of vols.caps) {
    const d = Math.min(Math.hypot(C.a.x - t[0], C.a.y - t[1], C.a.z - t[2]), Math.hypot(C.b.x - t[0], C.b.y - t[1], C.b.z - t[2]));
    if (d <= len + C.r + 0.6) caps.push(C);
  }
  for (const F of vols.cyls) {
    if (F.y1 < t[1] - len || F.y0 > t[1]) continue;
    if (Math.hypot(F.x - t[0], F.z - t[2]) - F.R > len) continue;
    cyls.push(F);
  }
  const polys = [];
  for (const P of vols.polys) {
    if (Math.hypot(P.c[0] - t[0], P.c[1] - t[1], P.c[2] - t[2]) - P.R > len) continue;
    polys.push(P);
  }
  return { boxes, caps, cyls, polys };
}

// ---------- 护顶架看得见的那几块（藤蔓用，FE1Q J3）----------
// 车本地坐标、lift 无关；数值抄 L1.js forkliftModel 的护顶架（dbox 的 y 是底面、x / z 是中心）：
//   两侧纵梁 dbox(±0.43, 2.04, −0.03, 0.06, 0.06, 1.18) → |x| 0.40–0.46、y 2.04–2.10、z −0.62…0.56
//   前 / 后横梁 dbox(0, 2.04, −0.59 / 0.53, 0.8, 0.06, 0.06) → |x| ≤ 0.40、y 2.04–2.10、z −0.62…−0.56 / 0.50…0.56
//   格栅横条（按这台车可动模型的细节档 FK_LOD[档].slats 根）dbox(0, 2.07, z, 0.8, 0.015, 0.05) → y 2.07–2.085，z 取 BR.L1forklift.slatZ(slats)
//     （FE1R K10：在前横梁后脸 −0.56 和后横梁前脸 0.48 之间均匀排开：3 根 −0.3125 / −0.04 / 0.2325，2 根 −0.2217 / 0.1417）
//   立柱：fkPrism 斜的四棱柱（x 宽 5 cm），截面 (z, y)：前立柱 (−0.75…−0.69, 0.99) → (−0.58…−0.52, 2.07)、后立柱 (0.59…0.65, 1.08) → (0.50…0.56, 2.07)，
//         按沿 z 斜切的盒子算（sk = dz/dy；斜切空间里量的距离和真距离差不到 8%，贴着时 <1 mm）
//   前大灯灯盒（FE1R S8：往后加深、插进前立柱，镜面就是灯盒前脸）dbox(±0.43, 1.86, (−0.685 − 0.597)/2, 0.08, 0.08, 0.088) → |x| 0.39–0.47、y 1.86–1.94、z −0.685…−0.597
//   后视镜：FE1R 起各档都不画（FK_LOD[档].mirror = false，K8 腾面）；有 mirror 的档才按下面 mirror 那份挡
//   警示灯：后横梁正中 (0, 0.53) 竖着的正 n 棱台（fkPost，n = FK_LOD[档].beacon，FE1R 起各档 12 棱、没有底座）：灯罩 r 0.045 → 0.03、y 2.10–2.175
// 车上别的东西（扶手、座椅、方向盘……）在护顶下面，藤蔓先碰到护顶，够不着
const VINE_GUARD = {
  boxes: [
    // 后横梁 10 cm 深、两根纵梁跟着伸到 0.58（返修 FE1Q · repair-r1：警示灯底圈整圈落在后横梁上，L1.js fkBody 护顶那段同一份尺寸）
    ['railL', -0.46, -0.40, 2.04, 2.10, -0.62, 0.58], ['railR', 0.40, 0.46, 2.04, 2.10, -0.62, 0.58],
    ['beamF', -0.40, 0.40, 2.04, 2.10, -0.62, -0.56], ['beamR', -0.40, 0.40, 2.04, 2.10, 0.48, 0.58],
  ],
  slat: { x: 0.40, y0: 2.07, y1: 2.085, d: 0.05, z0: -0.56, z1: 0.48 },
  posts: [
    // [名字, x0, x1, y0, y1, 底端 z0, z1, 顶端 z0, z1]
    ['postFL', -0.455, -0.405, 0.99, 2.07, -0.75, -0.69, -0.58, -0.52], ['postFR', 0.405, 0.455, 0.99, 2.07, -0.75, -0.69, -0.58, -0.52],
    ['postRL', -0.455, -0.405, 1.08, 2.07, 0.59, 0.65, 0.50, 0.56], ['postRR', 0.405, 0.455, 1.08, 2.07, 0.59, 0.65, 0.50, 0.56],
  ],
  lamps: [['lampL', -0.47, -0.39, 1.86, 1.94, -0.685, -0.597], ['lampR', 0.39, 0.47, 1.86, 1.94, -0.685, -0.597]],
  mirror: { box: ['mirror', -0.59, -0.50, 1.74, 1.84, -0.665, -0.642], a: [-0.46, 1.76, -0.6], b: [-0.53, 1.79, -0.655], r: 0.008 * Math.SQRT2 },
  beacon: { x: 0, z: 0.53, y: 2.10, base: { r: 0.05, h: 0.025 }, lamp: { r0: 0.045, r1: 0.03, h: 0.075 } },
};
// 这台车可动模型（载具网格）用的细节档：BR.vehicles 里这台车的 ent.info.tier（上过车 / 队友开过来的车都有），查不到按 mid
function driveTier(key) {
  const V = BR.vehicles;
  if (V && has(V, 'byKey')) {
    try { const v = V.byKey(key), t = v && v.ent && v.ent.info ? v.ent.info.tier : null; if (t) return String(t); } catch (err) { /* 按 mid */ }
  }
  return 'mid';
}
function driveLod(key, want) {
  const F = BR.L1forklift, lod = F && F.lod;
  if (!lod) return null;
  return lod[want] || lod[driveTier(key)] || lod.mid || null;
}

// ---------- 门架看得见的零件（藤蔓用，FE1Q J3）----------
// 外门架、内门架、货叉架：按这一档可动模型（BR.L1forklift.model，drive）在 lift = 0 建一次（按档缓存），拆成一个个连在一起的零件（一个 dbox、一根管子、
// 一块斜面……），每个零件一个凸体：全是轴对齐面的（dbox）按盒子量（准）；别的（油缸、活塞杆、链轮、倒角面）按它的面所在平面 + 外包盒 6 个面围成的
// 凸多面体量（各面平面距离取最大：正对着面时就是真距离，棱角外面偏小几毫米 —— 藤蔓在那儿多留一点空，不会穿）。
// 升降时内门架整体 +pose.inner、货叉架整体 +pose.carriage；藤蔓够不着的低处（零件顶 < 车底 + 1.4 m）不算。
// 链条随 lift 变形（前段长短、搭在链轮上的那半圈跟着链轮走），按 FORKLIFT_GEO 的链轮 / 链条尺寸现算（chainVolumes）
const MAST_SRC = [['mastOuter', 0], ['mastInner', 1], ['carriage', 2]];
const mastCache = new Map();   // 档 → [[零件…] × 3] | null（拆不出来：退回物理盒子）
function mastPieces(tier) {
  if (mastCache.has(tier)) return mastCache.get(tier);
  const F = BR.L1forklift, K = BR.kit;
  let out = null;
  if (F && has(F, 'model') && K && has(K, 'builder')) {
    out = [];
    for (const [part] of MAST_SRC) {
      try {
        const b = K.builder({}, 0, 0, () => 0, { height: 4, helper: true });
        b._wsHelper = true;
        F.model(b, { detail: tier, drive: true, part, lift: 0, steer: 0, number: 0 });
        out.push(pieceList(b));
      } catch (err) { once('mastPieces', () => console.warn('[forklift] 门架零件拆不出来，藤蔓按门架包围盒挡', err)); out = null; break; }
    }
  }
  mastCache.set(tier, out);
  return out;
}
// 构建器里的三角形拆成零件：{ box: [x0, x1, y0, y1, z0, z1], planes: null | [[nx, ny, nz, d]…]（外法线，n·p ≤ d 在里面） }。
// 先按共用顶点连（kit 的盒子每个面单独一组顶点、管子的端面单独一圈），再把位置重合的连成一块（一个 dbox 的 6 个面、管身和端面）——
// 连起来是凸的就当一个零件；不是凸的（两个零件碰巧有顶点重合）就拆回去一组一组算
function pieceList(b) {
  const out = [];
  if (!b || !b._accs || !has(b._accs, 'forEach')) return out;
  b._accs.forEach((a, mk) => {
    if (typeof mk !== 'string' || mk === 'kit:decal' || !a || !a.idx || !a.pos) return;
    const P = a.pos, I = a.idx, n = Math.floor(P.length / 3);
    const par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const join = (u, v) => { const ru = find(u), rv = find(v); if (ru !== rv) par[ru] = rv; };
    for (let i = 0; i + 2 < I.length; i += 3) { join(I[i], I[i + 1]); join(I[i], I[i + 2]); }
    const small = new Map();   // 按共用顶点连成的组：根 → [三角形起点…]
    for (let i = 0; i + 2 < I.length; i += 3) { const r = find(I[i]); let g = small.get(r); if (!g) small.set(r, g = []); g.push(i); }
    // 位置重合（0.01 mm 以内）的组连在一起
    const roots = Array.from(small.keys()), rid = new Map();
    roots.forEach((r, k) => rid.set(r, k));
    const gp = new Int32Array(roots.length);
    for (let k = 0; k < gp.length; k++) gp[k] = k;
    const gf = k => { while (gp[k] !== k) { gp[k] = gp[gp[k]]; k = gp[k]; } return k; };
    const at = new Map();
    for (let v = 0; v < n; v++) {
      if (!small.has(find(v))) continue;
      const key = Math.round(P[v * 3] * 1e5) + ',' + Math.round(P[v * 3 + 1] * 1e5) + ',' + Math.round(P[v * 3 + 2] * 1e5);
      const k = rid.get(find(v)), o = at.get(key);
      if (o === undefined) at.set(key, k); else { const x = gf(k), y = gf(o); if (x !== y) gp[x] = y; }
    }
    const big = new Map();
    roots.forEach((r, k) => { const g = gf(k); let L = big.get(g); if (!L) big.set(g, L = []); L.push(small.get(r)); });
    big.forEach(groups => {
      const one = convexPiece(P, I, [].concat(...groups));
      if (one) { out.push(one); return; }
      for (const tris of groups) { const q = convexPiece(P, I, tris, true); if (q) out.push(q); }
    });
  });
  return out;
}
// 一组三角形 → 凸零件（外包盒 + 各面所在平面，按顶点的重心定朝外）；force 不为真时不是凸的返回 null
function convexPiece(P, I, tris, force) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], c = [0, 0, 0];
  let nv = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = I[t + k] * 3;
    for (let j = 0; j < 3; j++) { const q = P[v + j]; if (q < lo[j]) lo[j] = q; if (q > hi[j]) hi[j] = q; c[j] += q; }
    nv++;
  }
  if (!nv) return null;
  c[0] /= nv; c[1] /= nv; c[2] /= nv;
  const planes = [];
  let axisOnly = true;
  const addPlane = (nx, ny, nz, d) => {
    for (const q of planes) if (Math.abs(q[0] - nx) < 1e-5 && Math.abs(q[1] - ny) < 1e-5 && Math.abs(q[2] - nz) < 1e-5 && Math.abs(q[3] - d) < 1e-5) return;
    planes.push([nx, ny, nz, d]);
    if (Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 1 - 1e-6) axisOnly = false;
  };
  for (const t of tris) {
    const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const wx = P[i2] - P[i0], wy = P[i2 + 1] - P[i0 + 1], wz = P[i2 + 2] - P[i0 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-10)) continue;
    nx /= l; ny /= l; nz /= l;
    let d = nx * P[i0] + ny * P[i0 + 1] + nz * P[i0 + 2];
    const side = nx * c[0] + ny * c[1] + nz * c[2] - d;
    if (Math.abs(side) < 1e-6) { addPlane(nx, ny, nz, d); addPlane(-nx, -ny, -nz, -d); continue; }   // 一片平的（薄片、扇面）：两面都算
    if (side > 0) { nx = -nx; ny = -ny; nz = -nz; d = -d; }
    addPlane(nx, ny, nz, d);
  }
  if (!force) {
    // 凸：每个顶点都在每个面的里侧
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = I[t + k] * 3;
      for (const q of planes) if (q[0] * P[v] + q[1] * P[v + 1] + q[2] * P[v + 2] - q[3] > 1e-5) return null;
    }
  }
  return { box: [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]], planes: axisOnly ? null : planes };
}
function mastVolumes(sim, L, tier, pad, boxes, polys) {
  const g = G(), y = sim.y, c = Math.cos(sim.yaw), s = Math.sin(sim.yaw), tw = { x: 0, z: 0 };
  const lift = clamp(sim.lift, 0, 1), dy = [0, g.innerTravel * lift, g.carriageTravel * lift];
  const parts = mastPieces(tier);
  if (!parts) {
    // 拆不出来（L1 没载入）：退回门架的物理包围盒
    const wb = worldBoxes(g, sim.x, sim.z, sim.y, sim.yaw, sim.lift, g.parts, []);
    for (let i = 0; i < wb.length; i++) {
      if (!MAST_PARTS[g.parts[i].name]) continue;
      const b = wb[i];
      boxes.push({ name: g.parts[i].name, cx: b.cx, cz: b.cz, hx: b.hx + pad, hz: b.hz + pad, rot: b.rot, minY: b.minY - pad, maxY: b.maxY + pad });
    }
    return;
  }
  for (let k = 0; k < parts.length; k++) {
    const name = MAST_SRC[k][0], h = dy[MAST_SRC[k][1]];
    for (const q of parts[k]) {
      const B = q.box;
      if (B[3] + h < 1.4) continue;   // 藤蔓最低垂到离地 1.55 m
      if (!q.planes) {
        const w = toW(sim.x, sim.z, sim.yaw, (B[0] + B[1]) / 2, (B[4] + B[5]) / 2, tw);
        boxes.push({ name, cx: w.x, cz: w.z, hx: (B[1] - B[0]) / 2 + pad, hz: (B[5] - B[4]) / 2 + pad, rot: sim.yaw, minY: y + B[2] + h - pad, maxY: y + B[3] + h + pad });
        continue;
      }
      polys.push(polyWorld(name, q.planes, B, sim.x, y + h, sim.z, c, s, pad));
    }
  }
  chainVolumes(sim, L, g, dy[1], dy[2], c, s, pad, boxes, polys);
}
// 车本地的凸多面体（平面 + 外包盒）摆到世界：方向按 toW 的转法转，平面常数加上平移
function polyWorld(name, planes, B, tx, ty, tz, c, s, pad) {
  const W = [];
  const put = (nx, ny, nz, d) => {
    const wx = c * nx + s * nz, wz = -s * nx + c * nz;
    W.push(wx, ny, wz, d + wx * tx + ny * ty + wz * tz + pad);
  };
  for (const q of planes) put(q[0], q[1], q[2], q[3]);
  put(1, 0, 0, B[1]); put(-1, 0, 0, -B[0]); put(0, 1, 0, B[3]); put(0, -1, 0, -B[2]); put(0, 0, 1, B[5]); put(0, 0, -1, -B[4]);
  const lx = (B[0] + B[1]) / 2, ly = (B[2] + B[3]) / 2, lz = (B[4] + B[5]) / 2;
  const cen = [tx + c * lx + s * lz, ty + ly, tz - s * lx + c * lz];
  return { name, pl: W, c: cen, R: Math.hypot(B[1] - B[0], B[3] - B[2], B[5] - B[4]) / 2 + pad };
}
// 链条（L1 fkChains 同一套尺寸）：前段（货叉架挂点 → 链轮，含朝前那面 2 mm 外的链板）、后段（外门架锚座 → 链轮）、搭在链轮上的那半圈（外圈折线围成的半圆柱）
function chainVolumes(sim, L, g, inner, carriage, c, s, pad, boxes, polys) {
  const sp = g.sprocket, ch = g.chain;
  if (!sp || !ch || !(sp.r > 0) || (L && !L.sprocket)) return;
  const T = 0.012, hw = 0.013, y = sim.y, cy = sp.y + inner, R = sp.z - ch.z, Ro = R + T / 2, tw = { x: 0, z: 0 };
  const box = (name, x0, x1, y0, y1, z0, z1) => {
    if (y1 - y0 < 1e-4 || y + y1 < y + 1.4) return;
    const w = toW(sim.x, sim.z, sim.yaw, (x0 + x1) / 2, (z0 + z1) / 2, tw);
    boxes.push({ name, cx: w.x, cz: w.z, hx: (x1 - x0) / 2 + pad, hz: (z1 - z0) / 2 + pad, rot: sim.yaw, minY: y + y0 - pad, maxY: y + y1 + pad });
  };
  for (const sx of [-1, 1]) {
    const x = sx * sp.x;
    box('chain', x - hw, x + hw, ch.carriageY + carriage, cy, ch.z - T / 2 - 0.002, ch.z + T / 2);
    // 后段链条：FE1R 起各档都画（FK_LOD 不再有 backChain 字段）；只有明说 backChain: false 的档才不画
    if (L && L.backChain === false) continue;
    box('chain', x - hw, x + hw, ch.anchorY, cy, ch.back - T / 2 - 0.002, ch.back + T / 2);
    const N = L && L.arc ? L.arc : 6, pl = [];
    for (let k = 0; k < N; k++) { const am = Math.PI * (k + 0.5) / N; pl.push([0, Math.sin(am), -Math.cos(am), Ro * Math.cos(Math.PI / (2 * N)) + Math.sin(am) * cy - Math.cos(am) * sp.z]); }
    pl.push([0, -1, 0, -cy]);
    polys.push(polyWorld('chain', pl, [x - hw, x + hw, cy, cy + Ro, sp.z - Ro, sp.z + Ro], sim.x, y, sim.z, c, s, pad));
  }
}
// 线段到凸多面体（各面平面有向距离取最大，凸函数，黄金分割找最小）
function segPolyDist(ax, ay, az, bx, by, bz, P, r) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, W = P.pl;
  // 粗判：线段离外接球很远就不细算
  const L2 = ux * ux + uy * uy + uz * uz;
  let t0 = L2 > 0 ? ((P.c[0] - ax) * ux + (P.c[1] - ay) * uy + (P.c[2] - az) * uz) / L2 : 0;
  t0 = clamp(t0, 0, 1);
  const far = Math.hypot(ax + ux * t0 - P.c[0], ay + uy * t0 - P.c[1], az + uz * t0 - P.c[2]) - P.R;
  if (far > r + 0.05) return far;
  const f = t => {
    const x = ax + ux * t, y = ay + uy * t, z = az + uz * t;
    let d = -Infinity;
    for (let i = 0; i < W.length; i += 4) { const q = W[i] * x + W[i + 1] * y + W[i + 2] * z - W[i + 3]; if (q > d) d = q; }
    return d;
  };
  let a = 0, b = 1, x1 = b - GOLD * (b - a), x2 = a + GOLD * (b - a), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) {
    if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - GOLD * (b - a); f1 = f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLD * (b - a); f2 = f(x2); }
  }
  return Math.min(f1, f2, f(0), f(1));
}
// 护顶横条的 z（和 L1.js fkSlatZ 同一条规则：前横梁后脸 −0.56、后横梁前脸 0.48 之间均匀排开，相邻净空相等）
function slatZLocal(n) {
  const sl = VINE_GUARD.slat, g = (sl.z1 - sl.z0 - n * sl.d) / (n + 1), out = [];
  for (let k = 0; k < n; k++) out.push(sl.z0 + g * (k + 1) + sl.d * k + sl.d / 2);
  return out;
}
function guardVolumes(sim, L, pad, boxes, caps, cyls) {
  const G0 = VINE_GUARD, y = sim.y, tw = { x: 0, z: 0 };
  const add = (name, x0, x1, y0, y1, z0, z1, sk) => {
    const w = toW(sim.x, sim.z, sim.yaw, (x0 + x1) / 2, (z0 + z1) / 2, tw);
    boxes.push({ name, cx: w.x, cz: w.z, hx: (x1 - x0) / 2 + pad, hz: (z1 - z0) / 2 + pad, rot: sim.yaw, minY: y + y0 - pad, maxY: y + y1 + pad, sk: sk || 0 });
  };
  for (const b of G0.boxes) add(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  const n = L ? Math.max(0, L.slats | 0) : 3, sl = G0.slat;
  // 横条位置和模型同一份（BR.L1forklift.slatZ，FE1R K10）；没有 L1forklift 时按同一条规则自己算
  const F = BR.L1forklift, zs = F && has(F, 'slatZ') ? F.slatZ(n) : slatZLocal(n);
  for (let k = 0; k < zs.length; k++) {
    const zc = +zs[k];
    add('slat', -sl.x, sl.x, sl.y0, sl.y1, zc - sl.d / 2, zc + sl.d / 2);
  }
  for (const p of G0.posts) {
    const zc0 = (p[5] + p[6]) / 2, zc1 = (p[7] + p[8]) / 2, hz = (p[6] - p[5]) / 2, zc = (zc0 + zc1) / 2;
    add(p[0], p[1], p[2], p[3], p[4], zc - hz, zc + hz, (zc1 - zc0) / (p[4] - p[3]));
  }
  if (!L || L.lampF) for (const b of G0.lamps) add(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  if (L && L.mirror) {
    const M = G0.mirror, b = M.box;
    add(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
    const a = sim.pointWorld({ x: M.a[0], y: M.a[1], z: M.a[2] }), c = sim.pointWorld({ x: M.b[0], y: M.b[1], z: M.b[2] });
    caps.push({ name: 'mirrorArm', a, b: c, r: M.r + pad });
  }
  const nb = L ? L.beacon | 0 : 6;
  if (nb >= 3) {
    const B = G0.beacon, w = toW(sim.x, sim.z, sim.yaw, B.x, B.z, tw);
    let y0 = B.y;
    if (L && L.beaconBase) { cyls.push(beaconPrism('beaconBase', w.x, w.z, sim.yaw, y + y0, y + y0 + B.base.h, B.base.r, B.base.r, nb, pad)); y0 += B.base.h; }
    cyls.push(beaconPrism('beacon', w.x, w.z, sim.yaw, y + y0, y + y0 + B.lamp.h, B.lamp.r0, B.lamp.r1, nb, pad));
  }
}
// 竖着的正 n 棱台（L1 fkTube 竖着画：第 k 个顶点在车本地 (−sin a, −cos a)·r，a = k/n·2π）：每个侧面的外法线（世界，水平）和底 / 顶的边心距
function beaconPrism(name, x, z, yaw, y0, y1, r0, r1, n, pad) {
  const c = Math.cos(Math.PI / n), cy = Math.cos(yaw), sy = Math.sin(yaw), m = [];
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * Math.PI * 2, lx = -Math.sin(a), lz = -Math.cos(a);
    m.push([cy * lx + sy * lz, -sy * lx + cy * lz]);   // 车本地方向 → 世界（toW 的旋转部分）
  }
  const a0 = r0 * c + pad, a1 = r1 * c + pad, k = (a1 - a0) / (y1 - y0);
  return { name, x, z, y0: y0 - pad, y1: y1 + pad, a0, ya: y0, k, nrm: Math.sqrt(1 + k * k), m, R: Math.max(r0, r1) + pad };
}
// 点到棱台的距离（下界：各个面所在平面的有向距离取最大 —— 正对着面时就是真距离，棱角外面偏小几毫米，藤蔓在那儿多留一点空，不会穿）
function prismDist(F, x, y, z) {
  const dx = x - F.x, dz = z - F.z, a = F.a0 + F.k * (y - F.ya);
  let d = Math.max(F.y0 - y, y - F.y1);
  for (let i = 0; i < F.m.length; i++) { const q = (F.m[i][0] * dx + F.m[i][1] * dz - a) / F.nrm; if (q > d) d = q; }
  return d;
}
// 线段到棱台（各面平面距离取最大是凸函数，黄金分割找最小）
function segCylDist(ax, ay, az, bx, by, bz, F, r) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const f = t => prismDist(F, ax + ux * t, ay + uy * t, az + uz * t);
  // 粗判：线段离棱台外接圆柱的轴很远就不细算
  const far = Math.min(Math.hypot(ax - F.x, az - F.z), Math.hypot(bx - F.x, bz - F.z)) - Math.hypot(ux, uz) - F.R;
  if (far > r + 0.05) return far;
  let a = 0, b = 1, x1 = b - GOLD * (b - a), x2 = a + GOLD * (b - a), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) {
    if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - GOLD * (b - a); f1 = f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLD * (b - a); f2 = f(x2); }
  }
  return Math.min(f1, f2, f(0), f(1));
}
// 网格顶点是区块本地坐标（区块 group 摆在区块原点）还是世界坐标：看原值离哪个顶点近
function vineFrame(S, P0) {
  const W = BR.world, size = W ? num(W.chunkSize, 24) : 24;
  const ox = num(S.c && S.c.cx, 0) * size, oz = num(S.c && S.c.cz, 0) * size;
  const t = S.vn.top;
  let dl = Infinity, dw = Infinity;
  for (let i = 0; i + 2 < P0.length; i += 3) {
    dl = Math.min(dl, Math.hypot(P0[i] - (t[0] - ox), P0[i + 2] - (t[2] - oz)));
    dw = Math.min(dw, Math.hypot(P0[i] - t[0], P0[i + 2] - t[2]));
  }
  return dl <= dw ? { ox, oz } : { ox: 0, oz: 0 };
}
// 绕水平轴转 th：竖直向下的方向转向水平方向 dir（Rodrigues，轴 k = (−dz, 0, dx)）
function vineRot(dir, th) {
  const kx = -dir[1], kz = dir[0], c = Math.cos(th), s = Math.sin(th);
  return { kx, kz, c, s };
}
function applyRot(R, x, y, z) {
  // v' = v·c + (k × v)·s + k·(k·v)·(1 − c)，k = (kx, 0, kz)
  const kdv = R.kx * x + R.kz * z;
  const cx = -R.kz * y, cy = R.kz * x - R.kx * z, cz = R.kx * y;   // k × v
  return [x * R.c + cx * R.s + R.kx * kdv * (1 - R.c), y * R.c + cy * R.s, z * R.c + cz * R.s + R.kz * kdv * (1 - R.c)];
}

// 线段 A→B 到 OBB（phys 格式 {cx, cz, hx, hz, rot, minY, maxY}）的最近距离²（3D）。转到盒子本地以后，点到盒子的距离² 是 t 的凸函数：
// 先用包围球粗判（离得比 r 远一大截直接返回），再黄金分割找最小（40 次，误差远小于 0.1 mm）
const GOLD = (Math.sqrt(5) - 1) / 2;
// o.sk（可选）：斜切的盒子（斜立柱）—— 盒子本地 z 的中心随高度变：z = sk·(y − 盒子中心高度)；在斜切空间里量（z' = z − sk·y），和真距离差不到 sk/2
function segObbDist2(ax, ay, az, bx, by, bz, o, r) {
  const c = Math.cos(o.rot), s = Math.sin(o.rot), cy = (o.minY + o.maxY) / 2, hy = (o.maxY - o.minY) / 2, hx = o.hx, hz = o.hz, sk = o.sk || 0;
  let dx = ax - o.cx, dz = az - o.cz;
  const py = ay - cy, px = dx * c - dz * s, pz = dx * s + dz * c - sk * py;
  dx = bx - o.cx; dz = bz - o.cz;
  const uy = by - cy - py, ux = dx * c - dz * s - px, uz = dx * s + dz * c - sk * (by - cy) - pz;
  const f = t => {
    const ex = Math.max(0, Math.abs(px + ux * t) - hx), ey = Math.max(0, Math.abs(py + uy * t) - hy), ez = Math.max(0, Math.abs(pz + uz * t) - hz);
    return ex * ex + ey * ey + ez * ez;
  };
  // 粗判：线段中点离盒心的距离 − 半段长 − 盒子外接半径 > r + 5 cm
  const mx = px + ux / 2, my = py + uy / 2, mz = pz + uz / 2;
  const far = Math.sqrt(mx * mx + my * my + mz * mz) - Math.sqrt(ux * ux + uy * uy + uz * uz) / 2 - Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (far > r + 0.05) return far * far;
  let a = 0, b = 1, x1 = b - GOLD * (b - a), x2 = a + GOLD * (b - a), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) {
    if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - GOLD * (b - a); f1 = f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLD * (b - a); f2 = f(x2); }
  }
  return Math.min(f1, f2, f(0), f(1));
}
// 两条线段之间的最近距离（3D，闭式解）
function segSegDist(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const x = p1x + d1x * s - (p2x + d2x * t), y = p1y + d1y * s - (p2y + d2y * t), z = p1z + d1z * s - (p2z + d2z * t);
  return Math.sqrt(x * x + y * y + z * z);
}

// ---------- 前大灯落点（FE1R：K1 窄东西不收光球、K2 车前是空地时一定亮、宽块 / 别的车背后不漏光、天花板不比地面亮）----------
// 一盏点光源（从灯池借一盏），没有阴影：画面上光球里朝着光源的面全亮。所以「不透墙」= 光球不伸进挡光体的影子里。
//   挡光体（光源附近的静态碰撞体、切出墙片、别的车）分类（阈值见 LT，写进 ARCHITECTURE）：
//     窄   水平两个方向都 ≤ LT.narrow（1.0 m）：树干 0.34、门框立柱 0.16×0.08、柱子 0.7 / 0.9、灯杆、消火栓箱 0.8×0.32。挡不住视线后面那片地，
//          不收光球（K1，没有影子是全游戏的约定：光照到它身上，也照到它周围和后面的地面）。墙段（长 ≥ 2×厚、高 ≥ 2.4 m）不算窄。
//          光源不越过它放到后面：车宽带里第一个窄东西前 LT.passN 以内不放（它朝车那一面照得到）
//     货架 墙形（长 ≥ 2×厚、长 ≥ 0.4）且厚 > 1.0 m（2.32 × 7.1 的货架）：FE1Q J9，长边那两面按远侧面往里 0.1 m 收（照得到朝通道的货，
//          照不到另一侧的通道）；两头的端面不收（返修 FE1R · repair-r2：端面背后那片影子在这排货架自己那一条里 —— 两节之间的空当、货架头外的横通道，
//          照 FE1Q「货架头那一下漏光接受」；以前按端面收，宽通道正中光球被收到 3 m、叉尖前 5 m 全黑），顶面不收（货架是透的、顶上没东西）
//     墙 / 宽块 / 别的车 —— 其余的：墙（小屋墙 0.2、承重墙 0.3、周转箱架 0.8）、堆垛 1.44、整车外包盒（别的叉车按整车，FE1R L-occluders）、
//          切出墙片。影子里一点光都不吃：光球不超过光源到它「背面」（光源在这个面的里侧的那几个面，含顶面；贴地的底面不算）的最近距离 ——
//          对凸的盒子，影子里离光源最近的点就在背面上
//     只有竖直方向跨过光源高度的收光球（矮于光源的、悬在头顶的不收：同裁定「竖直方向跨过光源高度的静态盒子」）；顶比光源低不到 LT.yFade
//     （底比光源高不到 LT.yFade）的按 1 / (1 − 差 / yFade) 放宽了当收的目标（开车时限速收，不当帧硬收），光源高度挪过箱子顶时光球不一跳
//   落点：叉尖前 s、横偏 u、离地 h 一排候选（LT.s × LT.u × LT.h）。每个候选：光球 R = min(够得着判定区最远点的名义范围, 上面的上限 − 1 cm)；
//   强度 I = max(LT.I0, 判定区最暗处到 LT.zT 要的强度、正前方窄东西那面到 LT.nT 要的强度)，再封顶：光源正下方地面 ≤ LT.eFloor、近处表面不发白
//   （返修 FE1R · repair-r5：按每个挡体表面的颜色、高光和已经吃到的别的光算，见 surfCap；以前是离光源最近的面照度 ≤ LT.eSurf，不看颜色）。打分 = 4·叉尖前 1.5 m 以内覆盖 + 2·更远覆盖 + 叉尖前 5 m 那点 + 1.5·正前方窄东西朝车那面
//   （乘叉尖前 1.5 m 以内最暗那点到 LT.zN 的比例：照那一面不拿近处地面换）− 0.6·天花板 / 头顶条目罚 + 离空地上的位置（LT.nom）近。
//   粗搜 LT.s × LT.u × LT.h，再在粗搜最好的 LT.topK 处（互相隔开的）各细搜两圈；每 LT.every 帧一次，其余帧从上一帧目标爬山。
//   判定区（K2）= 叉尖前 0.5 m 起到 min(3, 车宽带里第一个挡光体 − 0.2)，横向 −0.5…0.5 每 0.25，离任何实体面 < 0.3 m 的点不算。
//   平滑：选中的位置（车本地）按 LT.tauL / LT.tau 逐帧靠过去、每帧挪 ≤ LT.vMax·dt，强度 LT.tau、每帧相对 ≤ LT.iRate·dt；新目标要比当前
//   目标高出 LT.sw 分才换（滞回）。位置不越过车宽带里挡光体前 0.1 m（硬限，当帧）；光球放大 ≤ LT.rUp、收小 ≤ LT.rDown，当帧只受
//   occSoft（楔形细缝放宽到 LT.w0r 的上限）硬限，停稳 / 跳变时就是严格上限。
const LT = {
  s: [-0.5, -0.125, 0.25, 0.625, 1.0, 1.375, 1.75, 2.125, 2.6, 3.1], // 粗搜（叉尖前多远；3.1：货架通道里越过前面货架头放，叉尖前 5 m 照得到）
  u: [0, -0.5, 0.5],                                      // 横偏
  h: [0.5, 0.75, 1.0, 1.2],                               // 离地
  ds: 0.19, du: 0.25, dh: 0.125, topK: 3,                // 细搜：粗搜最好的 topK 处周围各试两圈（第二圈步长减半）
  hMin: 0.45, hMax: 1.2, uMax: 0.55,
  nom: { s: 2.6, u: 0, h: 0.9 },
  R0: 4.4, Rmax: 6.5, reachK: 0.62, I0: 2.8, Imax: 12, ImaxMove: 2.8, eFloorMove: 1.6,
  // eSurf：没建剖面的挡体（别的车、切出墙片）照旧按「最近那个面照度 ≤ eSurf」；wSurf / wSurfG：按颜色封顶时近处表面的线性亮度上限（墙、树干、柱子 / 货架、堆垛的货），见 surfCap
  eFloor: 5.0, eSurf: 2.0, wSurf: 0.78, wSurfG: 0.86, zT: 0.22, zN: 0.12, fT: 0.2, zOkN: 0.15, zOkF: 0.15, badN: 3.0, badF: 2.0,
  ceilY: 4.0, eCeil: 0.3, eOh: 0.5, ceilK: 0.7,
  narrow: 1.0, yFade: 0.1, ySoft: 0.25, wallH: 2.4, deep: 1.0, rackIn: 0.1, w0: 0.03, w0r: 0.15,
  band: 0.6, blockH: 0.5, zU: [-0.5, -0.25, 0, 0.25, 0.5], z0: 0.5, z1: 3, zStep: 0.25, zEnd: 0.2, zClear: 0.3, far: 5,
  pad: 0.2, passN: 0.3, passW: 0.35, passU: 0.3, mid: 0.35, sMin: -0.5, faceY: [0.5, 1.0, 1.6], nT: 0.35,
  tau: 0.15, tauL: 0.05, sw: 0.4, margin: 0.01, every: 4, vMax: 3, rUp: 3, rDown: 3, iRate: 2.4, ls: 0.06, lu: 0.06, lh: 0.04,
  // 两边货架朝通道那面的货（返修 FE1R · repair-r4，主会话 L3，见 lightCtx 的 goods）：车两侧横向 gLat 以内、和车平行的货架，朝车那面上
  // 叉尖前 0–gFar m、离地 gY 每 gStep 一点；照度到 gT 算照满；打分权重 wG（低于车前判定区：近段 4、远段 2）；名义范围按最远那一点 / reachK 放大
  // gCeil（repair-r5）：两边有货架时天花板 / 头顶条目的绝对上限放宽到 gCeil × 两边货里暗的那四分之一档的照度
  gLat: 3.6, gFar: 4, gStep: 1, gY: [0.6, 1.2], gT: 1.0, wG: 1.2, gCeil: 1.0,
};
// 「开着大灯，司机算被照亮」（FE1Q J8，保留「开着车灯怪不敢靠近司机」）：按改前空地上的数（光源在车前 4.46 m、名义 range 8、强度 3.2 时
// 座椅离光源水平 5.4 m）固定 ≈ 0.34，贴着墙、在货架通道里都不变（见 litSeat）
const SEAT_LIT = 3.2 * Math.pow(1 - 5.4 / 8, 2);
const occPool = [], bufOcc = [], bufOccRaw = [], bufNc = [], bufPoly = [], bufPoly2 = [], bufZone = [], bufE1 = [], bufGoods = [], bufGe = [];
const tmpLW = { x: 0, z: 0 }, tmpLL = { x: 0, z: 0 };
function occRec(i) { return occPool[i] || (occPool[i] = { t: '', cx: 0, cz: 0, c: 1, s: 0, hx: 0, hz: 0, minY: 0, maxY: 0, r: 0, key: '', src: null }); }
function occKind(hx, hz, H) {
  const a = Math.max(hx, hz) * 2, b = Math.min(hx, hz) * 2;
  const wallish = a >= 0.4 && a >= 2 * b;
  if (a <= LT.narrow && !(wallish && H >= LT.wallH)) return 'narrow';
  if (wallish && b > LT.deep) return 'rack';
  if (wallish) return 'wall';
  return 'wide';
}
// 光源附近的挡光体（世界坐标的 OBB 记录：中心、cos / sin、半宽、上下沿；别的车的部件按 key 合成整车外包盒）
function lightOcc(sim, gy, ign, x0, z0, x1, z1) {
  const out = bufOcc, P = BR.phys;
  out.length = 0;
  let n = 0;
  const raw = bufOccRaw;
  raw.length = 0;
  if (P && has(P, 'overlapBox')) { try { P.overlapBox(x0, z0, x1, z1, gy + 0.02, 3.0, { out: raw, ignoreKey: ign }); } catch (err) { raw.length = 0; } }
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || s.obb || !Number.isFinite(+s.minX)) continue;   // 车的部件 OBB 不在这里收：别的车按整车外包盒另外加（下面）
    const o = occRec(n++); out.push(o);
    o.cx = (s.minX + s.maxX) / 2; o.cz = (s.minZ + s.maxZ) / 2; o.hx = (s.maxX - s.minX) / 2; o.hz = (s.maxZ - s.minZ) / 2; o.c = 1; o.s = 0;
    o.minY = s.minY; o.maxY = s.maxY; o.key = s.key != null ? String(s.key) : ''; o.src = s;
    o.t = occKind(o.hx, o.hz, o.maxY - o.minY);
  }
  // 别的叉车（停着的、运行时车、联机队友的车）：整车外包盒（货叉尖到配重后脸、车最宽处、地面到护顶 / 升起来的门架顶），FE1R L-occluders。
  // 按 BR.vehicles 的位姿建（不按 phys 里落进查询范围的那几块部件拼，免得车开近时盒子一块块长出来）
  const V = BR.vehicles, list = V && has(V, 'list') ? V.list() : null;
  if (Array.isArray(list)) {
    const g = G();
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v || String(v.key) === sim.key || !Number.isFinite(+v.x) || !Number.isFinite(+v.z)) continue;
      if (v.x < x0 - 3 || v.x > x1 + 3 || v.z < z0 - 3 || v.z > z1 + 3) continue;
      const yaw = num(v.yaw, 0), lift = clamp(num(v.lift, 0), 0, 1), c = Math.cos(yaw), sn = Math.sin(yaw), mz = (g.front + g.rear) / 2;
      const o = occRec(n++); out.push(o);
      o.t = 'car'; o.key = 'veh|' + v.key; o.src = null; o.c = c; o.s = sn; o.hx = g.halfW; o.hz = (g.rear - g.front) / 2;
      o.cx = v.x + sn * mz; o.cz = v.z + c * mz;
      o.minY = num(v.y, gy); o.maxY = o.minY + Math.max(g.guardTop + 0.1, 2.125 + g.innerTravel * lift, 1.24 + g.carriageTravel * lift);
    }
  }
  // 切出墙片（kit 'noclip'，没有碰撞体、看上去是墙）：当墙
  const ncs = noclipBoxes((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2);
  for (let i = 0; i < ncs.length; i++) {
    const b = ncs[i], o = occRec(n++); out.push(o);
    o.cx = (b.minX + b.maxX) / 2; o.cz = (b.minZ + b.maxZ) / 2; o.hx = (b.maxX - b.minX) / 2; o.hz = (b.maxZ - b.minZ) / 2; o.c = 1; o.s = 0;
    o.minY = b.minY; o.maxY = b.maxY; o.key = 'noclip'; o.t = 'wall'; o.src = null;
  }
  for (let i = 0; i < out.length; i++) { const o = out[i]; o.r = Math.hypot(o.hx, o.hz); }
  raw.length = 0;
  return out;
}
function occLocal(o, x, z, out) { const dx = x - o.cx, dz = z - o.cz; out.x = dx * o.c - dz * o.s; out.z = dx * o.s + dz * o.c; return out; }
// 光源 (x, y, z) 到挡体 o 的最近距离（任何面）
function occDist(o, x, y, z) {
  const l = occLocal(o, x, z, tmpLL);
  const ex = Math.max(0, Math.abs(l.x) - o.hx), ez = Math.max(0, Math.abs(l.z) - o.hz);
  const ey = y < o.minY ? o.minY - y : y > o.maxY ? y - o.maxY : 0;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}
// ---------- 不发白封顶按表面颜色算（返修 FE1R · repair-r5，主会话 L3；验收员 play / spec / tests）----------
// 以前「离光源最近的面不发白」是一个固定的照度代理：最近那个面（任何碰撞体）的照度 ≤ LT.eSurf（2.0），不管那个面是什么颜色。宽货架通道正中
// 离光源最近的是 0.45 m 外一根下段刷深绿漆的柱子，照度 2.0 时画面上最亮才 101，强度却被卡在 2.42，两边货架的货只有 FE1Q 的一半；
// 把 eSurf 统一放大又会让 K1 的枯树干（树皮更浅）发白。现在按「画面上会不会真发白」封：光源照得到的近处表面里，反照率 × 照度
// （I·k²·cos）最大的那一点 ≤ LT.wSurf（线性、色调映射前；树皮在照度 2.0 时正好是这个数 —— K1 树干的封顶和以前一样，最大通道 <245）。
// 反照率 = 那一点看得见的最外一层（刷漆、贴花盖着的按盖在外面的那层，半透明的贴花、玻璃取它和后面那层里亮的）：顶点色 × 材质色 ×
// 贴图亮处（p98，sRGB 贴图先解码成线性）；发光件（Basic）不吃光，记 0。
// 剖面（albProf）：每个静态挡体第一次用到时，沿它的四个侧面（和不高的顶面）一格格往里打射线（行 ALB.dv、列 ≤ALB.du，最多进 ALB.depth），
// 记下打到的点、法线、反照率；按 phys 的记录缓存（区块卸载重建后记录换了就重算）。一次 lightCtx 最多新建 ALB.build 个，没建好的、
// 别的车、切出墙片照旧按 LT.eSurf（反照率当 LT.wSurf / LT.eSurf，和以前一模一样）
const ALB = { exp: 0.05, expN: 0.12, duN: 0.06, dv: 0.1, du: 0.25, cols: 28, vMax: 4.2, depth: 1.2, win: 1.5, build: 8, pct: 0.98, topH: 3.0, tauA: 0.5, minHead: 0.25 };
const albCache = new WeakMap(), texStat = new WeakMap(), ALB_T = 13, ALB_C = 9;
let albLeft = 0;
// 贴图亮处：把贴图画到 ≤128×128 的画布上（不插值），R / G / B 各取 p98（sRGB 贴图解码成线性）—— 分通道（返修 FE1R · repair-r5 标定：
// 柱子下段刷的绿漆是 G 通道最亮，混凝土贴图的 G 比最大通道暗一点；不分通道时柱子按最大通道估亮 15%）；拿不到图（还没载入、跨域）返回 [1, 1, 1]
const TEX1 = [1, 1, 1];
function texHi(t) {
  if (!t || !t.image) return TEX1;
  const c = texStat.get(t);
  if (c != null) return c;
  let v = TEX1, ok = false;
  try {
    const img = t.image, w0 = +(img.width || img.videoWidth || 0), h0 = +(img.height || img.videoHeight || 0);
    let d = null, step = 4;
    if (img.data && w0 && h0) { d = img.data; step = Math.round(d.length / (w0 * h0)) || 4; if (!(d instanceof Uint8Array || d instanceof Uint8ClampedArray)) d = null; }
    else if (w0 && h0 && typeof document !== 'undefined' && (img.complete !== false)) {
      const w = Math.min(w0, 128), h = Math.min(h0, 128), cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, w, h);
      d = g.getImageData(0, 0, w, h).data; step = 4;
    }
    if (d && d.length >= step) {
      const srgb = t.encoding === THREE.sRGBEncoding, out = [0, 0, 0];
      for (let ch = 0; ch < 3; ch++) {
        const hist = new Uint32Array(256);
        let n = 0;
        for (let i = ch; i < d.length; i += step) { hist[d[i]]++; n++; }
        let acc = 0, q = 255;
        for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * ALB.pct) { q = k; break; } }
        const x = q / 255;
        out[ch] = srgb ? (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)) : x;
      }
      v = out; ok = true;
    }
  } catch (err) { v = TEX1; ok = false; }
  if (ok || (t.image && t.image.complete !== false)) texStat.set(t, v);
  return v;
}
// Phong 高光的峰值（白色、按照度算）：BlinnPhong = F·¼·(shininess / 2 + 1)·(N·H)^shininess，F 取材质高光色最大通道；Lambert、Basic 没有
function specPeak(m) {
  if (!m || !m.isMeshPhongMaterial || !m.specular) return 0;
  const sp = Math.max(m.specular.r, m.specular.g, m.specular.b);
  return sp * 0.25 * (num(m.shininess, 30) / 2 + 1);
}
// 区块网格里碰到盒子（外扩 ALB.exp）的三角形：[9 个坐标, 漫反射反照率, 高光峰值 ks, shininess, 半透明 1 / 不透明 0]（每个 ALB_T 个数）
function albTris(box, ex) {
  const out = [], e3 = ex;
  const x0 = box.minX - e3, x1 = box.maxX + e3, y0 = box.minY - e3, y1 = box.maxY + e3, z0 = box.minZ - e3, z1 = box.maxZ + e3;
  const seen = new Set();
  for (const ch of nearChunks((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2)) {
    const g = ch && (ch.group || (ch.res && ch.res.group));
    if (!g || !Array.isArray(g.children) || seen.has(g)) continue;
    seen.add(g);
    for (const m of g.children) {
      if (!m || !m.isMesh || m.visible === false || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position || Array.isArray(m.material)) continue;
      const mat = m.material;
      if (!mat) continue;
      const geo = m.geometry, P = geo.attributes.position, Ix = geo.index;
      const Cc = mat.vertexColors && geo.attributes.color ? geo.attributes.color : null;
      m.updateMatrixWorld();
      const E = m.matrixWorld.elements;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      // 盒子粗筛（只平移、没旋转的区块网格最常见；有旋转时按 8 个角的包围盒）
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const px = k & 1 ? bb.max.x : bb.min.x, py = k & 2 ? bb.max.y : bb.min.y, pz = k & 4 ? bb.max.z : bb.min.z;
        const wx = E[0] * px + E[4] * py + E[8] * pz + E[12], wy = E[1] * px + E[5] * py + E[9] * pz + E[13], wz = E[2] * px + E[6] * py + E[10] * pz + E[14];
        if (wx < bx0) bx0 = wx; if (wx > bx1) bx1 = wx; if (wy < by0) by0 = wy; if (wy > by1) by1 = wy; if (wz < bz0) bz0 = wz; if (wz > bz1) bz1 = wz;
      }
      if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1 || bz1 < z0 || bz0 > z1) continue;
      const basic = !!mat.isMeshBasicMaterial, clear = !!mat.transparent && !basic;
      const mc = mat.color || { r: 1, g: 1, b: 1 }, tf = texHi(mat.map), ks = basic ? 0 : specPeak(mat), sh = num(mat.shininess, 30);
      const nt = Ix ? Ix.count / 3 : P.count / 3;
      const pa = P.array, ps = P.itemSize || 3, ia = Ix ? Ix.array : null;
      const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let t = 0; t < nt; t++) {
        let tx0 = Infinity, tx1 = -Infinity, ty0 = Infinity, ty1 = -Infinity, tz0 = Infinity, tz1 = -Infinity, cr = 0, cg = 0, cb = 0;
        for (let j = 0; j < 3; j++) {
          const vi = ia ? ia[t * 3 + j] : t * 3 + j, o = vi * ps;
          const px = pa[o], py = pa[o + 1], pz = pa[o + 2];
          const wx = E[0] * px + E[4] * py + E[8] * pz + E[12], wy = E[1] * px + E[5] * py + E[9] * pz + E[13], wz = E[2] * px + E[6] * py + E[10] * pz + E[14];
          v[j * 3] = wx; v[j * 3 + 1] = wy; v[j * 3 + 2] = wz;
          if (wx < tx0) tx0 = wx; if (wx > tx1) tx1 = wx; if (wy < ty0) ty0 = wy; if (wy > ty1) ty1 = wy; if (wz < tz0) tz0 = wz; if (wz > tz1) tz1 = wz;
          if (Cc) { cr += Cc.getX(vi); cg += Cc.getY(vi); cb += Cc.getZ(vi); }
        }
        if (tx1 < x0 || tx0 > x1 || ty1 < y0 || ty0 > y1 || tz1 < z0 || tz0 > z1) continue;
        if (!Cc) { cr = cg = cb = 3; }
        const a = basic ? 0 : Math.max(mc.r * cr * tf[0], mc.g * cg * tf[1], mc.b * cb * tf[2]) / 3;
        out.push(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], a, ks, sh, clear ? 1 : 0);
      }
    }
  }
  return out;
}
// 射线 (o, d) 和三角形（双面）：返回 t 或 Infinity
function rayTri(T, i, ox, oy, oz, dx, dy, dz) {
  const ax = T[i], ay = T[i + 1], az = T[i + 2];
  const e1x = T[i + 3] - ax, e1y = T[i + 4] - ay, e1z = T[i + 5] - az, e2x = T[i + 6] - ax, e2y = T[i + 7] - ay, e2z = T[i + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az, u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, w = (dx * qx + dy * qy + dz * qz) * inv;
  if (w < -1e-6 || u + w > 1 + 1e-6) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : Infinity;
}
// 一个静态挡体（phys 的 AABB 记录）的表面剖面：{ amax, faces: [{ ax, sg, p, ua, va, u0, du, nu, v0, dv, nv, amax, cells }] }，
// ax 法线轴（0 = x、1 = y、2 = z）、sg 朝外的符号、p 面所在的坐标，ua / va 面内两根轴；cells 每格 ALB_C 个数：打到的点 xyz、朝外的法线 xyz、漫反射反照率（0 = 没打到）、
// 高光峰值、shininess；amax = 漫反射 + 高光峰值的最大值（剪枝、窗口外的上界用）
function albProf(s) {
  const box = { minX: +s.minX, maxX: +s.maxX, minY: +s.minY, maxY: Math.min(+s.maxY, +s.minY + ALB.vMax), minZ: +s.minZ, maxZ: +s.maxZ };
  // 窄的（树干、柱子）：盒子外扩多一点（树杈根、柱子护角伸出碰撞盒），列也密一点（树干 0.34 m 一面至少 6 列：7 棱的树干，正对着光的那个面要采到）
  const narrowBox = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) <= LT.narrow, EX = narrowBox ? ALB.expN : ALB.exp;
  const T = albTris(box, EX), nT = T.length / ALB_T;
  const lo = [box.minX, box.minY, box.minZ], hi = [box.maxX, box.maxY, box.maxZ];
  const faces = [];
  let amax = 0;
  const dirs = [[0, -1], [0, 1], [2, -1], [2, 1]];
  if (+s.maxY - +s.minY <= ALB.topH) dirs.push([1, 1]);
  const ord = [], hits = [];
  for (const [ax, sg] of dirs) {
    const ua = ax === 0 ? 2 : 0, va = ax === 1 ? 2 : 1;
    const p = sg > 0 ? hi[ax] : lo[ax];
    const wu = hi[ua] - lo[ua], wv = hi[va] - lo[va];
    if (!(wu > 0) || !(wv > 0)) continue;
    const nu = clamp(Math.max(Math.ceil(wu / ALB.du), Math.ceil(wu / ALB.duN)), 1, ALB.cols), nv = clamp(Math.ceil(wv / ALB.dv), 1, 64);
    const du = wu / nu, dv = wv / nv;
    const depth = Math.min(hi[ax] - lo[ax], ALB.depth) + EX;
    // 三角形按投影分到格子里
    const bins = new Array(nu * nv);
    for (let t = 0; t < nT; t++) {
      const i = t * ALB_T;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (let j = 0; j < 3; j++) {
        const a = T[i + j * 3 + ua], b = T[i + j * 3 + va], c = T[i + j * 3 + ax];
        if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; if (c < c0) c0 = c; if (c > c1) c1 = c;
      }
      // 深度范围：面外 EX 到面里 depth
      const dIn = sg > 0 ? p - c1 : c0 - p, dOut = sg > 0 ? c0 - p : p - c1;
      if (dOut > EX || dIn > depth) continue;
      const iu0 = Math.max(0, Math.floor((a0 - lo[ua]) / du)), iu1 = Math.min(nu - 1, Math.floor((a1 - lo[ua]) / du));
      const iv0 = Math.max(0, Math.floor((b0 - lo[va]) / dv)), iv1 = Math.min(nv - 1, Math.floor((b1 - lo[va]) / dv));
      for (let iv = iv0; iv <= iv1; iv++) for (let iu = iu0; iu <= iu1; iu++) { const k = iv * nu + iu; (bins[k] || (bins[k] = [])).push(i); }
    }
    const cells = new Float32Array(nu * nv * ALB_C);
    let fmax = 0;
    for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
      const k = iv * nu + iu, list = bins[k];
      if (!list) continue;
      const o = [0, 0, 0], d = [0, 0, 0];
      o[ax] = p + sg * EX; o[ua] = lo[ua] + (iu + 0.5) * du; o[va] = lo[va] + (iv + 0.5) * dv; d[ax] = -sg;
      hits.length = 0; ord.length = 0;
      for (const i of list) { const t = rayTri(T, i, o[0], o[1], o[2], d[0], d[1], d[2]); if (t <= depth + EX) { hits.push(t, i); } }
      if (!hits.length) continue;
      for (let q = 0; q < hits.length; q += 2) ord.push(q);
      ord.sort((x, y) => hits[x] - hits[y]);
      // 最外一层不透明的那个面；它前面半透明的（贴花、玻璃）取亮的
      let a = 0, ks = 0, sh = 30, hit = -1;
      for (const q of ord) { const i = hits[q + 1]; if (T[i + 9] > a) a = T[i + 9]; if (T[i + 10] > ks) { ks = T[i + 10]; sh = T[i + 11]; } if (T[i + 12]) continue; hit = q; break; }
      if (hit < 0 && ord.length) hit = ord[0];
      const i = hits[hit + 1], t = hits[hit];
      let nx = (T[i + 4] - T[i + 1]) * (T[i + 8] - T[i + 2]) - (T[i + 5] - T[i + 2]) * (T[i + 7] - T[i + 1]);
      let ny = (T[i + 5] - T[i + 2]) * (T[i + 6] - T[i]) - (T[i + 3] - T[i]) * (T[i + 8] - T[i + 2]);
      let nz = (T[i + 3] - T[i]) * (T[i + 7] - T[i + 1]) - (T[i + 4] - T[i + 1]) * (T[i + 6] - T[i]);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (nx * d[0] + ny * d[1] + nz * d[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }   // 朝射线来的方向（朝外）
      const c = k * ALB_C;
      cells[c] = o[0] + d[0] * t; cells[c + 1] = o[1] + d[1] * t; cells[c + 2] = o[2] + d[2] * t;
      cells[c + 3] = nx; cells[c + 4] = ny; cells[c + 5] = nz; cells[c + 6] = a; cells[c + 7] = ks; cells[c + 8] = sh;
      if (a + ks > fmax) fmax = a + ks;
    }
    if (fmax > amax) amax = fmax;
    faces.push({ ax, sg, p, ua, va, u0: lo[ua], du, nu, v0: lo[va], dv, nv, amax: fmax, cells });
  }
  return { amax, faces, nT };
}
function albGet(o) {
  const s = o.src;
  if (!s) return null;
  const c = albCache.get(s);
  if (c !== undefined) return c;
  if (albLeft <= 0) return null;
  albLeft--;
  let p = null;
  try { p = albProf(s); if (!p.nT) p = null; } catch (err) { p = null; }
  albCache.set(s, p);
  return p;
}
const tmpPL = [0, 0, 0];
// 一个面上不发白要的强度上限：每格 (LT.wSurf / a − Ea) / (k²·cos)。只看光源投影周围 ALB.win 以内的格子，
// 窗口外的按这个面最亮的反照率、窗口边上的距离、面法线方向的余弦给个下界
function albFaceCap(F, x, y, z, R, Ea, cap, eye, faceOn, WS) {
  tmpPL[0] = x; tmpPL[1] = y; tmpPL[2] = z;
  const sd = F.sg * (tmpPL[F.ax] - F.p);
  if (!(sd > 0)) return cap;
  const pu = tmpPL[F.ua], pv = tmpPL[F.va], C = F.cells, W = ALB.win, mh = ALB.minHead;
  const iu0 = Math.max(0, Math.floor((pu - W - F.u0) / F.du)), iu1 = Math.min(F.nu - 1, Math.floor((pu + W - F.u0) / F.du));
  const iv0 = Math.max(0, Math.floor((pv - W - F.v0) / F.dv)), iv1 = Math.min(F.nv - 1, Math.floor((pv + W - F.v0) / F.dv));
  for (let iv = iv0; iv <= iv1; iv++) for (let iu = iu0; iu <= iu1; iu++) {
    const c = (iv * F.nu + iu) * ALB_C, a = C[c + 6];
    if (!(a > 0)) continue;
    const dx = x - C[c], dy = y - C[c + 1], dz = z - C[c + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d < R) || d < 1e-4) continue;
    const nx = C[c + 3], ny = C[c + 4], nz = C[c + 5], cs = (nx * dx + ny * dy + nz * dz) / d;
    if (!(cs > 0)) continue;
    if (Math.max(WS - a * Ea, mh * WS) / ((1 - d / R) * (1 - d / R) * cs * (a + C[c + 7])) >= cap) continue;   // 高光开到峰值也不比现在的上限紧
    // 高光（Blinn-Phong）：朝着司机的眼睛看；faceOn（墙、树干、柱子这类正对着车的挡体 —— K1 / K2 是贴近了正对着量最亮那一点）再和「正对着这一面看」取大
    //（视线就是法线：N·H = cos(θ / 2)，θ 是光线和法线的夹角）。货架、堆垛朝通道那面的货按司机看到的算（L3：驾驶座画面里两边货架的货）
    let sp = C[c + 7];
    if (sp > 0) {
      let se = 0;
      if (eye) {
        const vx = eye.x - C[c], vy = eye.y - C[c + 1], vz = eye.z - C[c + 2], vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        const hx = dx / d + vx / vl, hy = dy / d + vy / vl, hz = dz / d + vz / vl, hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1, nh = (nx * hx + ny * hy + nz * hz) / hl;
        se = nh > 0 ? Math.pow(nh, C[c + 8]) : 0;
      } else se = 1;
      if (faceOn) se = Math.max(se, Math.pow(Math.sqrt((1 + cs) / 2), C[c + 8]));
      sp *= se;
    }
    const k = 1 - d / R, v = Math.max(WS - a * Ea, mh * WS) / (k * k * cs * (a + sp));
    if (v < cap) cap = v;
  }
  const u1 = F.u0 + F.nu * F.du, v1 = F.v0 + F.nv * F.dv;
  const full = pu - W <= F.u0 && pv - W <= F.v0 && pu + W >= u1 && pv + W >= v1;
  if (!full) {
    // 窗口外的格子：面内离光源投影 ≥ max(窗口半宽, 投影到这个面矩形的距离)；反照率按这个面最亮的（含高光峰值）
    const ru = Math.max(0, F.u0 - pu, pu - u1), rv = Math.max(0, F.v0 - pv, pv - v1), dout = Math.hypot(sd, Math.max(W, Math.hypot(ru, rv)));
    if (dout < R) { const k = 1 - dout / R, v = Math.max(WS - F.amax * Ea, mh * WS) / (k * k * (sd / dout) * F.amax); if (v < cap) cap = v; }
  }
  return cap;
}
// 挡体那一处已经吃到的别的光（层级的半球环境光 + 区块灯，按灯的原始亮度、不算闪烁，3D 距离、不算朝向 —— 往大里估）：
// 开着灯的仓库里墙、树干本来就亮，再加车灯更容易发白；断电时只剩一层很暗的环境光。按挡体记录缓存，每帧最多算一次，
// 再按 ALB.tauA 慢慢跟（断电 / 来电那一下封顶不一跳，强度本来也是逐帧平滑的）
const ambCache = new WeakMap();
let hemiRef = null;
function ambAt(o, gy) {
  const s = o.src, now = BR.game && Number.isFinite(+BR.game.time) ? +BR.game.time : 0;
  const c = s ? ambCache.get(s) : null;
  if (c && c.t === now) return c.v;
  let v = 0;
  if (!hemiRef || !hemiRef.parent) { hemiRef = null; const sc = BR.gfx && BR.gfx.scene; if (sc) for (const ch of sc.children) if (ch && ch.isHemisphereLight) { hemiRef = ch; break; } }
  if (hemiRef) v += hemiRef.intensity * Math.max(hemiRef.color.r, hemiRef.color.g, hemiRef.color.b);
  const W = BR.world, x = o.cx, z = o.cz, y = gy + 1.0;
  if (W && typeof W.chunks === 'function') {
    for (const ch of nearChunks(x, z)) {
      const ls = ch && ch.lights;
      if (!Array.isArray(ls)) continue;
      for (let i = 0; i < ls.length; i++) {
        const L = ls[i], I = L && L.intensity != null ? +L.intensity : 0;
        if (!(I > 0)) continue;
        const r = num(L.range, num(L.distance, 10)), d = Math.hypot(num(L.x, 0) - x, num(L.y, y + 2.5) - y, num(L.z, 0) - z) - o.r;
        if (!(d < r)) continue;
        const k = 1 - Math.max(0, d) / r;
        v += I * k * k * Math.max(0.2, Math.min(1, num(L.color && L.color.r != null ? Math.max(L.color.r, L.color.g, L.color.b) : 1, 1)));
      }
    }
  }
  if (c && Number.isFinite(c.v)) {
    const dt = clamp(now - c.t, 0, 1);
    v = c.v + (v - c.v) * (1 - Math.exp(-dt / ALB.tauA));
  }
  if (s) ambCache.set(s, { t: now, v });
  return v;
}
// 光源 (x, y, z)、光球 R 时不发白要的强度上限（Infinity = 不封）：近处每个表面格子 a·(I·k²·cos + Ea) ≤ LT.wSurf，
// a 反照率、Ea 那一处已经吃到的别的光（ambAt）。没剖面的挡体（别的车、切出墙片、还没建）照旧按 LT.eSurf：I·k² ≤ LT.eSurf
// floor（可选）：调用方最后和它取大（旧的 eSurf 上限）—— 上限一旦降到 floor 以下就不用再算了，直接返回
function surfCap(occ, x, y, z, R, gy, eye, floor) {
  let cap = Infinity;
  const fl = floor > 0 ? floor : 0;
  for (let i = 0; i < occ.length; i++) {
    if (cap <= fl) return cap;
    const o = occ[i];
    if (Math.hypot(x - o.cx, z - o.cz) - o.r >= R) continue;
    const d = occDist(o, x, y, z);
    if (!(d < R)) continue;
    const k = 1 - d / R, p = albGet(o);
    if (!p) { const c = LT.eSurf / (k * k); if (c < cap) cap = c; continue; }
    if (!(p.amax > 0)) continue;
    const Ea = ambAt(o, gy), faceOn = o.t !== 'rack' && o.t !== 'wide', WS = faceOn ? LT.wSurf : LT.wSurfG;
    // 这个挡体能给的最紧的上限（最亮的反照率、最近的距离、正对着）比现在的还松就不用细算
    const head = Math.max(WS - p.amax * Ea, ALB.minHead * WS) / p.amax;
    if (head / (k * k) >= cap) continue;
    for (let f = 0; f < p.faces.length; f++) {
      const F = p.faces[f];
      if (!(F.amax > 0)) continue;
      const hf = Math.max(WS - F.amax * Ea, ALB.minHead * WS) / F.amax;
      if (hf / (k * k) >= cap) continue;
      cap = albFaceCap(F, x, y, z, R, Ea, cap, eye, faceOn, WS);
      if (cap <= fl) return cap;
    }
  }
  return cap;
}
// 从驾驶座眼点看叉尖前 t、横偏 u 的地面那一点，有没有被车自己的门架零件挡住（车本地坐标；零件 = mastPieces 的凸块，内门架 +inner、货叉架 +carriage）。
// 按 档 | lift（0.02 一档）| t | u 缓存
const cabVis = new Map();
function cabHidden(sim, tipZ, t, u) {
  const tier = driveTier(sim.key), lq = Math.round(clamp(num(sim.lift, 0), 0, 1) * 50);
  const key = tier + '|' + lq + '|' + t.toFixed(3) + '|' + u.toFixed(3);
  const hit = cabVis.get(key);
  if (hit !== undefined) return hit;
  if (cabVis.size > 20000) cabVis.clear();
  const parts = mastPieces(tier), g = G(), E = g.eyeP;
  let res = false;
  if (parts && E) {
    const lift = lq / 50, dys = [0, g.innerTravel * lift, g.carriageTravel * lift];
    const ax = +E.x || 0, ay = +E.y || 1.8, az = +E.z || 0, bx = u, by = 0.02, bz = tipZ - t;
    for (let k = 0; k < parts.length && !res; k++) {
      const dy = dys[MAST_SRC[k][1]];
      for (const q of parts[k]) { if (segPiece(q, dy, ax, ay, az, bx, by, bz)) { res = true; break; } }
    }
  }
  cabVis.set(key, res);
  return res;
}
// 线段（只算 0–0.97 那一截，终点那一点本身在地上）穿不穿过凸零件 q（外包盒 + 平面，竖直平移 dy）
function segPiece(q, dy, ax, ay, az, bx, by, bz) {
  const B = q.box;
  let t0 = 0, t1 = 0.97;
  const clip = (p0, d, lo, hi) => {
    if (Math.abs(d) < 1e-12) return p0 >= lo && p0 <= hi;
    let a = (lo - p0) / d, b = (hi - p0) / d; if (a > b) { const k = a; a = b; b = k; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; return t0 < t1;
  };
  if (!clip(ax, bx - ax, B[0], B[1]) || !clip(ay, by - ay, B[2] + dy, B[3] + dy) || !clip(az, bz - az, B[4], B[5])) return false;
  if (!q.planes) return true;
  for (const P of q.planes) {
    // 平面 n·p ≤ d + ny·dy 在里面
    const d = P[3] + P[1] * dy, s0 = P[0] * ax + P[1] * ay + P[2] * az - d, s1 = P[0] * bx + P[1] * by + P[2] * bz - d, ds = s1 - s0;
    if (Math.abs(ds) < 1e-12) { if (s0 > 0) return false; continue; }
    const tc = -s0 / ds;
    if (ds > 0) { if (tc < t1) t1 = tc; } else if (tc > t0) t0 = tc;
    if (t0 >= t1) return false;
  }
  return t0 < t1;
}
// 线段 (ax, ay, az) → (bx, by, bz) 穿不穿过挡体 o（水平按 OBB 夹、竖直按这一截线段的高度范围和 minY…maxY 有没有重叠）
const tmpSA = { x: 0, z: 0 }, tmpSB = { x: 0, z: 0 };
function segHits(o, ax, ay, az, bx, by, bz) {
  const a = occLocal(o, ax, az, tmpSA), b = occLocal(o, bx, bz, tmpSB);
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) < 1e-9) { if (Math.abs(a.x) > o.hx) return false; }
  else { let p = (-o.hx - a.x) / dx, q = (o.hx - a.x) / dx; if (p > q) { const k = p; p = q; q = k; } t0 = Math.max(t0, p); t1 = Math.min(t1, q); if (t0 >= t1) return false; }
  if (Math.abs(dz) < 1e-9) { if (Math.abs(a.z) > o.hz) return false; }
  else { let p = (-o.hz - a.z) / dz, q = (o.hz - a.z) / dz; if (p > q) { const k = p; p = q; q = k; } t0 = Math.max(t0, p); t1 = Math.min(t1, q); if (t0 >= t1) return false; }
  const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
  return Math.min(y0, y1) < o.maxY && Math.max(y0, y1) > o.minY;
}
function occDist2(o, x, z) {
  const l = occLocal(o, x, z, tmpLL);
  const ex = Math.max(0, Math.abs(l.x) - o.hx), ez = Math.max(0, Math.abs(l.z) - o.hz);
  return Math.sqrt(ex * ex + ez * ez);
}
// 光源 (x, y, z) 对挡体 o 的光球上限（见上面的分类）；窄的、不跨过光源高度的 → Infinity
function occBound(o, x, y, z, gy) {
  occSoft = Infinity;
  if (o.t === 'narrow') return Infinity;
  // 光源高过挡体顶（或低过底）cv：不算"跨光源高度"的挡体（L-occluders 只管跨的），但不能一越过顶就整个不算 —— 光源高度
  // 本来就在 0.45–1.2 m 之间挪，1 m 左右高的箱子垛顶一来一回，光球会一跳（FE1R K2 平滑：柱子旁边打满方向转圈）。
  // 越过 cv 以后按 1 / (1 − cv / LT.yFade) 连续放宽，cv ≥ LT.yFade 才不算；背面距离带上竖直那一截
  const cv = Math.max(y - o.maxY, o.minY - y);
  if (cv >= Math.max(LT.yFade, LT.ySoft)) return Infinity;
  const kf = cv >= LT.yFade ? Infinity : cv > 0 ? 1 / (1 - cv / LT.yFade) : 1, cy = Math.max(0, cv);
  const l = occLocal(o, x, z, tmpLL), lx = l.x, lz = l.z, hx = o.hx, hz = o.hz;
  const ax = Math.abs(lx), az = Math.abs(lz);
  if (ax < hx && az < hz && cv <= 0) { occSoft = 0; return 0; }
  const ex = Math.max(0, ax - hx), ez = Math.max(0, az - hz);
  // 背面 F（光源在它所在平面的里侧，离平面 a）：影子里离光源最近的点在 F 上，距离 d。光源几乎和 F 共面（a → 0，比如车头刚好开过货架头那个端面）时
  // F 后面的影子只是贴着 F 的一条楔形细缝（离 F 的棱 ρ 处宽 ≈ ρ·a/d）：宽不到 LT.w0 的那段不算，上限放到 d·(1 + w0/a) —— 光源从端面里侧
  // 挪到外侧时光球连续地放开，不一跳（FE1R K2 平滑）；正对着的远侧面只多出 w0
  // 货架（J9）：长边那两面到远侧面往里 0.1 m（照得到朝通道的货、照不到另一侧的通道）；两头的端面不收（repair-r2，见下）
  // occSoft：同一个上限，楔形细缝按 LT.w0r 放宽（货架长边那两面除外，照严格的收）：开车时光球往严格上限收（限速 LT.rDown）、
  // 当帧只不越过 occSoft，静下来收到 occBound（见 lightSolve）。光源横扫过某个端面所在平面时（原地打满方向转圈，叉尖前的光源
  // 一帧横移十几厘米）严格上限 d·(1 + w0/a) 随 a 变得很陡，当帧硬收光球会一跳；端面后面那条楔形细缝开车经过时亮一下看不出来
  const rack = o.t === 'rack', thinX = hx <= hz, w0 = LT.w0, wr = LT.w0r;
  let b = Infinity, bs = Infinity;
  // 返修 FE1R · repair-r2（验收员 spec / play / tests：宽货架通道正中车灯只照 1.9–3 m，叉尖前 5 m 开关灯一样黑 —— 收住光球的不是货架长边，
  // 是两节货架之间空当里、货架头拐角背后那片影子）：货架两头的端面不再收光球。端面背后的影子在这排货架自己的那一条里（两节之间的空当、
  // 货架头外面的横通道），照 FE1Q「货架头那一下漏光接受」；另一侧的通道一定在远侧长边那个平面后面，长边那条界限（远侧面往里 0.1 m）照旧管着
  for (let sg = -1; sg <= 1; sg += 2) {
    if (sg * lx < hx && !(rack && !thinX)) {
      const a = hx - sg * lx, h0 = Math.hypot(a, ez, cy), off = rack && thinX ? LT.rackIn : 0;
      const d = h0 * (1 + w0 / a) - off; if (d < b) b = d;
      const ds = h0 * (1 + (rack && thinX ? w0 : wr) / a) - off; if (ds < bs) bs = ds;
    }
    if (sg * lz < hz && !(rack && thinX)) {
      const a = hz - sg * lz, h0 = Math.hypot(a, ex, cy), off = rack && !thinX ? LT.rackIn : 0;
      const d = h0 * (1 + w0 / a) - off; if (d < b) b = d;
      const ds = h0 * (1 + (rack && !thinX ? w0 : wr) / a) - off; if (ds < bs) bs = ds;
    }
  }
  if (!rack && o.maxY > y) { const a = o.maxY - y, h0 = Math.hypot(ex, a, ez), d = h0 * (1 + w0 / a), ds = h0 * (1 + wr / a); if (d < b) b = d; if (ds < bs) bs = ds; }
  if (o.minY > gy + 0.05 && o.minY < y) { const a = y - o.minY, h0 = Math.hypot(ex, a, ez), d = h0 * (1 + w0 / a), ds = h0 * (1 + wr / a); if (d < b) b = d; if (ds < bs) bs = ds; }
  // occSoft 在光源高度挪过挡体顶 / 底的上下 LT.ySoft 以内连续放宽（顶上 ySoft 处放到无穷，正好在顶的高度放宽一倍）：
  // 开车时光源高度一帧挪 2–3 cm，硬限不能随它一跳（原地打满方向转圈，光源从 1.06 m 落到 1.03 m，1.05 m 高的箱子垛一下变成跨光源高度）
  const ys = LT.ySoft, kS = cv <= -ys ? 1 : cv >= ys ? Infinity : 1 / (1 - (cv + ys) / (2 * ys));
  occSoft = Math.max(0, bs) * kS;
  return kf === Infinity ? Infinity : Math.max(0, b) * kf;
}
let occSoft = Infinity;
const bufTops = [];
// o 的地面投影进叉尖前车宽带（车本地 |x| ≤ hw、t = 从叉尖往前的距离 ≥ 0）的最小 t；不进 → Infinity
const CORN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
function clipU(src, dst, lim, sgn) {
  dst.length = 0;
  const n = src.length / 2;
  for (let i = 0; i < n; i++) {
    const au = src[2 * i], at = src[2 * i + 1], j = (i + 1) % n, bu = src[2 * j], bt = src[2 * j + 1];
    const ain = sgn * au <= lim, bin = sgn * bu <= lim;
    if (ain) dst.push(au, at);
    if (ain !== bin) { const k = (sgn * lim - au) / (bu - au); dst.push(sgn * lim, at + (bt - at) * k); }
  }
  return dst;
}
function bandEntry(o, sim, tipZ, hw) {
  const P = bufPoly;
  P.length = 0;
  for (let i = 0; i < 4; i++) {
    const lx = CORN[i][0] * o.hx, lz = CORN[i][1] * o.hz;
    const wx = o.cx + o.c * lx + o.s * lz, wz = o.cz - o.s * lx + o.c * lz;
    const l = toL(sim.x, sim.z, sim.yaw, wx, wz, tmpLW);
    P.push(l.x, tipZ - l.z);
  }
  const A = clipU(P, bufPoly2, hw, 1), B = clipU(A, P, hw, -1);
  if (!B.length) return Infinity;
  let mn = Infinity, mx = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (let i = 0; i < B.length; i += 2) { u0 = Math.min(u0, B[i]); u1 = Math.max(u1, B[i]); if (B[i + 1] < mn) mn = B[i + 1]; if (B[i + 1] > mx) mx = B[i + 1]; }
  if (mx < 0) return Infinity;
  bandSpan.u0 = u0; bandSpan.u1 = u1;
  return Math.max(0, mn);
}
const bandSpan = { u0: 0, u1: 0 };   // 上一次 bandEntry 进带那一截的横向范围
// 地面上一点的照度（I = 1）：光源离地 h、到这一点的距离 d、光球 R —— 和 gfx 一样 (1 − d/R)²，再乘入射角
function e1(d, h, R) { if (!(d < R)) return 0; const k = 1 - d / R; return k * k * h / d; }

function lightCtx(sim) {
  const g = G();
  albLeft = ALB.build;
  const gy = sim.y;
  const tipZ = Array.isArray(g.forkZ) ? Math.min(+g.forkZ[0], +g.forkZ[1]) : -2.1;
  const ign = sim.ignoreKeys(null);
  // 收挡体：叉尖到叉尖前 5 m 这一段，四周外扩 Rmax
  const a = toW(sim.x, sim.z, sim.yaw, 0, tipZ - LT.sMin, { x: 0, z: 0 }), b = toW(sim.x, sim.z, sim.yaw, 0, tipZ - LT.far, { x: 0, z: 0 });
  const E = LT.Rmax;
  const occ = lightOcc(sim, gy, ign, Math.min(a.x, b.x) - E, Math.min(a.z, b.z) - E, Math.max(a.x, b.x) + E, Math.max(a.z, b.z) + E);
  // 车宽带里第一个挡光体（不是窄的、高过 0.5 m）、第一个窄东西
  // 窄东西记下进带的位置和横向范围：光源只是不越过挡在它自己前面（横向 LT.passU 以内）的窄东西（贴墙的柜子在车宽带边上，光源从旁边过去照样行）
  // gM：挡在车正前方（中心横向 ±LT.mid 以内）的第一个窄东西 —— 光源不越过它（K1）。返修 FE1R · repair-r1：判定区不再到它为止（整合 FE1R 那样
  // 截断，树干、柱子旁边和后面看得见的那片地就不查了，验收员 tests 按裁定原文的判定区量出来有照不亮的）
  let gB = Infinity, gN = Infinity, gM = Infinity, gBy = null, face = null;
  const nar = [];
  for (let i = 0; i < occ.length; i++) {
    const o = occ[i];
    if (o.maxY < gy + LT.blockH || o.minY > gy + 1.9) continue;
    if (o.t === 'narrow') {
      const t = bandEntry(o, sim, tipZ, LT.band + LT.passU);
      if (t < Infinity) {
        // 挡在车正前方（中心横向在 ±LT.mid 以内）的：光源一律不越过它（树干、杆子、柱子朝车那一面要照得到，K1）；偏在车宽带边上的，
        // 光源只要横向离它 ≥LT.passU 就能从旁边过去（判定区远端照得到；它朝车那面斜着照到）
        const lc = toL(sim.x, sim.z, sim.yaw, o.cx, o.cz, tmpLL), mid = Math.abs(lc.x) <= LT.mid;
        nar.push({ t, u0: mid ? -9 : bandSpan.u0, u1: mid ? 9 : bandSpan.u1 });
        if (t < gN && bandSpan.u1 > -LT.band && bandSpan.u0 < LT.band) gN = t;
        if (mid && (!face || t < face.t)) face = { t, u: clamp(0, bandSpan.u0, bandSpan.u1), o };
        // 判定区到它前面为止：按它进车宽带（±LT.band，和测试 __lt.blockDist 的 5 条水平射线同宽）的位置，不按放宽了 LT.passU 的带
        if (mid) { const tm = bandEntry(o, sim, tipZ, LT.band); if (tm < gM) gM = tm; }
      }
    } else { const t = bandEntry(o, sim, tipZ, LT.band); if (t < gB) { gB = t; gBy = o; } }
  }
  // 判定区（K2）
  const zone = bufZone;
  zone.length = 0;
  // 返修 FE1R · repair-r1（验收员 tests：K1 窄东西不算挡光体，它周围、后面的地照样是车前的空地）：判定区不再到正前方的窄东西为止（gM 只留着给调试看）；
  // 被它挡住、从驾驶座看不见的那几点照旧不算（下面 hidden）
  const T = Math.min(LT.z1, gB - LT.zEnd);
  const ts = [];
  for (let t = LT.z0; t <= T + 1e-6; t += LT.zStep) ts.push(t);
  if (T >= LT.z0 && ts.length && T - ts[ts.length - 1] > 0.1) ts.push(T);
  const near = (x, z) => { for (let i = 0; i < occ.length; i++) { const o = occ[i]; if (o.maxY < gy + 0.03 || o.minY > gy + 2) continue; if (occDist2(o, x, z) < LT.zClear) return true; } return false; };
  // 从驾驶座看不见的点不算（整合 FE1R：和 tests/forklift_polish.mjs 判定区去掉「驾驶座看不见的点」一致；以前偏在车宽带边上的树干、柱子
  // 后面那几点也拿来打分，求解器为了照它们把看得见的远角让掉了 —— 种子 39 #172 树、#179 柱子）。按挡体盒子算视线（车自己的门架不算）
  // 车自己的门架、货叉架、链条（从驾驶座往前看，立柱、横梁、挡货架会挡住一部分地面）按这一档可动模型的零件（mastPieces，藤蔓也用它）算，
  // 车本地坐标、按 lift 缓存（cabHidden）
  const eye = sim.eyeWorld();
  const hidden = (x, z, t, u) => { if (cabHidden(sim, tipZ, t, u)) return true; for (let i = 0; i < occ.length; i++) if (segHits(occ[i], eye.x, eye.y, eye.z, x, gy + 0.02, z)) return true; return false; };
  let z1i = -1;
  for (const t of ts) for (const u of LT.zU) {
    const w = toW(sim.x, sim.z, sim.yaw, u, tipZ - t, tmpLW);
    if (near(w.x, w.z)) continue;
    if (hidden(w.x, w.z, t, u)) continue;
    if (u === 0 && (z1i < 0 || Math.abs(t - 1) < Math.abs(zone[z1i].t - 1))) z1i = zone.length;
    zone.push({ x: w.x, z: w.z, t, u });
  }
  let far = null;
  if (gB >= LT.far + 0.3) { const w = toW(sim.x, sim.z, sim.yaw, 0, tipZ - LT.far, tmpLW); if (!near(w.x, w.z)) far = { x: w.x, z: w.z }; }
  // 正前方的窄东西（K1）：朝车那一面 0.5 / 1.0 / 1.6 m 高三点要照亮（车宽带里第一个挡光体前面、LT.far 以内）
  let fpts = null;
  if (face && face.t < Math.min(gB, LT.far)) {
    const w = toW(sim.x, sim.z, sim.yaw, face.u, tipZ - face.t, { x: 0, z: 0 });
    fpts = [];
    for (const y of LT.faceY) if (gy + y > face.o.minY + 0.05 && gy + y < face.o.maxY - 0.05) fpts.push({ x: w.x, y: gy + y, z: w.z });
    if (!fpts.length) fpts = null;
  }
  // 两边货架朝通道那面的货（返修 FE1R · repair-r4，主会话 L3：宽货架通道正中开灯减关灯，两边货架上的货只剩 FE1Q 的 3 成 —— 求解器只给车前判定区、
  // 叉尖前 5 m 和正前方窄东西打分，光球收到最小的 4.4 m、强度 2.4，2.8 m 外的货几乎照不到）：车两侧（车宽带外）横向 LT.gLat 以内、长边和车平行的货架，
  // 朝车那一面上叉尖前 0–LT.gFar m、离地 LT.gY 每 LT.gStep m 一点，法线朝车中线。光照不到货架另一侧照旧（J9：界限到远侧面往里 0.1 m）
  const goods = bufGoods;
  goods.length = 0;
  for (let i = 0; i < occ.length; i++) {
    const o = occ[i];
    if (o.t !== 'rack' || o.maxY < gy + 0.6) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const lx = CORN[k][0] * o.hx, lz = CORN[k][1] * o.hz, l = toL(sim.x, sim.z, sim.yaw, o.cx + o.c * lx + o.s * lz, o.cz - o.s * lx + o.c * lz, tmpLL);
      if (l.x < x0) x0 = l.x; if (l.x > x1) x1 = l.x; if (l.z < z0) z0 = l.z; if (l.z > z1) z1 = l.z;
    }
    if (x1 - x0 > z1 - z0) continue;   // 长边不和车平行（车头对着货架）
    const sd = x0 > LT.band + 0.1 ? 1 : x1 < -(LT.band + 0.1) ? -1 : 0;
    if (!sd) continue;
    const fx = sd > 0 ? x0 : x1;
    if (Math.abs(fx) > LT.gLat) continue;
    const nw = toW(0, 0, sim.yaw, -sd, 0, { x: 0, z: 0 });   // 法线（车本地 −sd·x）换到世界：toW 的平移部分是 0
    for (let t = 0; t <= LT.gFar + 1e-6; t += LT.gStep) {
      const lz = tipZ - t;
      if (lz < z0 + 0.05 || lz > z1 - 0.05) continue;
      const w = toW(sim.x, sim.z, sim.yaw, fx, lz, tmpLW);
      for (const yy of LT.gY) if (gy + yy < o.maxY - 0.05 && gy + yy > o.minY + 0.05) goods.push({ x: w.x, y: gy + yy, z: w.z, nx: nw.x, nz: nw.z, sd });
    }
  }
  // 头顶：天花板（L1 楼板底 4.0）和头顶条目（梁、管子、桥架的底面）
  const oh = overheadList(sim, bufOh);
  const sMax = Math.max(LT.sMin, gB - LT.passW);
  // 开得快时强度封顶压低（地上一块很亮的小光斑跟车跑，车前某一点逐帧的明暗变化太大，FE1R K2 平滑）：停着 / 慢开照常，2.5 m/s 以上压到 LT.ImaxMove
  const mv = clamp((Math.abs(num(sim.spd, 0)) - 0.5) / 2, 0, 1);
  return { sim, gy, tipZ, occ, zone, far, oh, z1i, sMax, gB, gN, gBy, nar, fpts, goods, eye, nx: -fwdX(sim.yaw), nz: -fwdZ(sim.yaw), T: Math.max(LT.z0, T), tFar: clamp(gB - 0.3, LT.z1, LT.far),
    Imax: LT.Imax + (LT.ImaxMove - LT.Imax) * mv, eFloor: LT.eFloor + (LT.eFloorMove - LT.eFloor) * mv };
}
// 横偏 u 处光源最远能放到叉尖前多远：不进车宽带里挡光体前 LT.passW、不越过横向挡在它前面的窄东西（前 LT.passN）
function sMaxU(ctx, u) {
  let m = ctx.sMax;
  for (let i = 0; i < ctx.nar.length; i++) { const n = ctx.nar[i]; if (u > n.u0 - LT.passU && u < n.u1 + LT.passU) m = Math.min(m, n.t - LT.passN); }
  return Math.max(LT.sMin, m);
}
function lightSolve(sim) {
  const g = G();
  const st = sim.lt || (sim.lt = { s: 0, u: 0, h: 0, I: 0, tgt: null, clock: null, x: NaN, z: NaN, yaw: NaN, init: false });
  const now = BR.game && Number.isFinite(+BR.game.time) ? +BR.game.time : 0;
  let dt = st.clock == null ? 0 : now - st.clock;
  st.clock = now;
  const jump = !st.init || dt < 0 || dt > 0.5 || !(Math.hypot(sim.x - st.x, sim.z - st.z) <= 1.0) || !(Math.abs(wrap(sim.yaw - st.yaw)) <= 0.6);
  dt = clamp(dt, 0, 0.1);
  st.x = sim.x; st.z = sim.z; st.yaw = sim.yaw;
  const ctx = lightCtx(sim);
  const { gB, gN, gBy, sMax, zone } = ctx;
  // 候选：粗搜一遍，再在粗搜最好的 LT.topK 处（s、u 互相隔开的）周围各细搜两圈。只细搜最好那一处不够：光源挪过货架头 / 墙头那个端面
  // 所在平面时上限一下放开（种子 12345 #6：叉尖前 2.6 m 光球 1.95、2.65 m 就 3.5），粗网格正好跨过那一段，别处又有个次好的
  let best = null, lb = null;
  const tops = bufTops;
  tops.length = 0;
  const tryC = (s, u, h, top) => {
    if (s > sMaxU(ctx, u) + 1e-6 || s < LT.sMin - 1e-6 || Math.abs(u) > LT.uMax + 1e-6 || h < LT.hMin - 1e-6 || h > LT.hMax + 1e-6) return;
    const c = lightEval(ctx, s, u, h, false);
    if (!c) return;
    if (!best || c.score > best.score) best = c;
    if (!lb || c.score > lb.score) lb = c;
    if (top) {
      let k = -1;
      for (let i = 0; i < tops.length; i++) if (Math.abs(tops[i].s - c.s) < 0.4 && Math.abs(tops[i].u - c.u) < 0.3) { k = i; break; }
      if (k >= 0) { if (c.score > tops[k].score) tops[k] = c; }
      else tops.push(c);
      tops.sort((a, b) => b.score - a.score);
      if (tops.length > LT.topK) tops.length = LT.topK;
    }
  };
  // 全局搜每 LT.every 帧一次（摊开省时间：手机上一帧也只多一点点）；刚上车、瞬移、上一帧没目标时马上搜
  st.n = (st.n || 0) + 1;
  const full = jump || !st.tgt || st.n % LT.every === 0;
  if (full) for (const s of LT.s) for (const u of LT.u) for (const h of LT.h) tryC(s, u, h, true);
  const seeds = tops.slice();
  for (let q = 0; q < seeds.length; q++) {
    lb = seeds[q];
    for (let r = 0; r < 2 && lb; r++) {
      const b0 = lb, f = r ? 0.5 : 1;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if (i || j || k) tryC(b0.s + i * LT.ds * f, b0.u + j * LT.du * f, b0.h + k * LT.dh * f, false);
    }
  }
  if (!best && full) best = lightEval(ctx, sMaxU(ctx, 0), 0, LT.h[1], true);
  // 跟踪：从上一帧的目标出发在附近细步爬山（目标随车的处境连续地挪，没有滞后）；全局搜到的明显更好（高出 LT.sw）才跳过去（滞回）
  let loc = null;
  if (st.tgt && !jump) {
    const lc = (s, u, h) => (s > sMaxU(ctx, u) + 1e-6 || s < LT.sMin - 1e-6 || Math.abs(u) > LT.uMax + 1e-6 || h < LT.hMin - 1e-6 || h > LT.hMax + 1e-6) ? null : lightEval(ctx, s, u, h, false);
    let c = lc(Math.min(st.tgt.s, sMaxU(ctx, st.tgt.u)), st.tgt.u, st.tgt.h);
    for (let it = 0; c && it < 3; it++) {
      let nb = c;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if (!(i || j || k)) continue;
        const q = lc(c.s + i * LT.ls, c.u + j * LT.lu, c.h + k * LT.lh);
        if (q && q.score > nb.score + 1e-6) nb = q;
      }
      if (nb === c) break;
      c = nb;
    }
    loc = c;
  }
  if (!loc && !best) best = lightEval(ctx, sMaxU(ctx, 0), 0, LT.h[1], true);
  let tgt = best, far = !loc;
  if (loc && !(best && best.score > loc.score + LT.sw)) tgt = loc;
  st.tgt = { s: tgt.s, u: tgt.u, h: tgt.h };
  // 平滑（车本地）：沿着爬山挪的用短时间常数（几乎不滞后），全局换了个位置的用长一点的（不一跳），每帧挪动再限个速（LT.vMax）
  if (jump) { st.s = tgt.s; st.u = tgt.u; st.h = tgt.h; }
  else {
    const k = 1 - Math.exp(-dt / (tgt === loc && !far ? LT.tauL : LT.tau)), m = LT.vMax * dt;
    st.s += clamp((tgt.s - st.s) * k, -m, m); st.u += clamp((tgt.u - st.u) * k, -m, m); st.h += clamp((tgt.h - st.h) * k, -m / 2, m / 2);
  }
  // 退到限制以内：挡光体（墙、货架、宽块、别的车）前 0.1 m 是硬的（光源不许越过它，当帧退）；挡光体前 LT.passW、窄东西前 LT.passN 是软的
  // （拐弯时柱子扫进车宽带，光源按 LT.vMax 退回来，不一下跳 1 m 多）
  const soft = sMaxU(ctx, st.u);
  if (st.s > soft) st.s = jump ? soft : Math.max(soft, st.s - LT.vMax * dt);
  st.s = clamp(st.s, LT.sMin, Math.max(LT.sMin, ctx.gB - 0.1));
  const fin = lightEval(ctx, st.s, st.u, st.h, true);
  // 光球：放大按 LT.rUp 慢慢放（货架头、墙头这种光源一挪过端面界限就整个放开的地方不一跳）；收小也按 LT.rDown 收，但当帧不超过
  // 放宽了货架端面的那个上限（occSoft：只有货架两头的楔形细缝放宽，墙、宽块、别的车、货架长边一律当帧收），静下来收敛到严格上限
  // Rhi 不跟 Rlo 取大：矮堆垛顶附近严格上限随光源高度变得很陡，硬限只按 occSoft（连续）走
  const Rlo = Math.max(0.05, fin.R), Rhi = Math.max(0.05, Math.min(fin.R0, fin.Bs - LT.margin));
  if (jump || !(st.R > 0)) st.R = Rlo;
  else st.R = Math.min(st.R < Rlo ? Math.min(Rlo, st.R + LT.rUp * dt) : Math.max(Rlo, st.R - LT.rDown * dt), Rhi);
  // 强度：照这个光球重算封顶，逐帧平滑；白点封顶允许平滑途中超 25%（静止时收敛到封顶以内）
  const kF = st.R > st.h ? 1 - st.h / st.R : 1;
  let cap = Math.min(ctx.Imax, ctx.eFloor / (kF * kF));
  { const co = fin.dsurf < st.R ? LT.eSurf / ((1 - fin.dsurf / st.R) * (1 - fin.dsurf / st.R)) : Infinity; cap = Math.min(cap, Math.max(surfCap(ctx.occ, fin.x, fin.y, fin.z, st.R, ctx.gy, ctx.eye, co), co)); }
  // 每帧最多变 LT.iRate·dt（相对）：光球慢慢放大、开快了封顶压低时强度都是一点点变，地上一点逐帧不跳；封顶允许途中超 50%（停稳后收敛到封顶以内）
  const Iw = Math.min(fin.I, cap), Iprev = st.I;
  if (jump || !(st.I > 0)) st.I = Iw;
  else {
    const r = Math.exp(LT.iRate * dt), next = st.I + (Iw - st.I) * (1 - Math.exp(-dt / LT.tau));
    st.I = clamp(next, st.I / r, st.I * r);
  }
  // 超过封顶 1.5 倍的往回压，但连同上面的平滑一帧合计最多压 1.5·LT.iRate·dt（光源扫向一个面、光球按 LT.rUp 放大时，离光源最近那个面的
  // 封顶一帧掉百分之十几，当帧硬压会一跳；原地打满方向转圈，叉尖前 1.5 m 地面一帧暗 9 级）；跳变（刚放上车、瞬移）照旧当帧压
  st.I = jump ? Math.min(st.I, cap * 1.5) : Math.min(st.I, Math.max(cap * 1.5, Iprev * Math.exp(-1.5 * LT.iRate * dt)));
  st.init = true;
  const range = st.R;
  sim.lightInfo = { range, intensity: st.I, R0: fin.R0, seatLit: SEAT_LIT, bound: fin.B, hit: Number.isFinite(gB) ? gB : null, narrow: Number.isFinite(gN) ? gN : null,
    by: fin.by ? { kind: fin.by.t, key: fin.by.key, box: { cx: fin.by.cx, cz: fin.by.cz, hx: fin.by.hx, hz: fin.by.hz, c: fin.by.c, s: fin.by.s, minY: fin.by.minY, maxY: fin.by.maxY } } : null,
    s: st.s, u: st.u, h: st.h, tgt: st.tgt, zone: zone.length, zoneMin: fin.zMin, zoneCov: fin.zs, faceE: fin.faceE, far: fin.fE, ceil: fin.Ec, ohE: fin.Eh, score: fin.score, blocker: gBy ? gBy.t : null, goods: fin.gS, goodsN: fin.gN };
  return { x: fin.x, y: fin.y, z: fin.z, range, intensity: st.I };
}
// 一个候选（叉尖前 s、横偏 u、离地 h）：光球、强度、打分。force = 位置太贴着东西也照样算（最后用的那个位置）
function lightEval(ctx, s, u, h, force) {
  const { sim, gy, tipZ, occ, zone, far, oh } = ctx;
  const w = toW(sim.x, sim.z, sim.yaw, u, tipZ - s, tmpLW);
  const x = w.x, z = w.z, y = gy + h;
  // 名义范围：够得着判定区最远的角（叉尖前 T、横向 ±0.5；光源放到判定区前头时还有叉尖前 0.5 m 那两个角）和更远那一点（叉尖前 clamp(挡光体 − 0.3, 3, 5)），那里还剩 1 − LT.reachK 的余量。
  // 按挡光体距离连续地算（不按判定区里剩下哪几个点），光球不因为某个点进出判定区跳一下
  const dT = Math.max(0, ctx.T - s), dF = Math.max(0, ctx.tFar - s), dN = Math.max(0, s - LT.z0), du = 0.5 + Math.abs(u);
  let dFar = Math.max(Math.hypot(dT, du, h), Math.hypot(dF, Math.abs(u), h), Math.hypot(dN, du, h));
  // 两边货架的货（L3）：名义范围也要够得着最远那一点
  const goods = ctx.goods;
  for (let i = 0; i < goods.length; i++) { const q = goods[i], d = Math.hypot(q.x - x, q.y - y, q.z - z); if (d > dFar) dFar = d; }
  const R0 = clamp(dFar / LT.reachK, LT.R0, LT.Rmax);
  let B = Infinity, Bs = Infinity, dsurf = Infinity, by = null;
  for (let i = 0; i < occ.length; i++) {
    const o = occ[i];
    const d0 = Math.hypot(x - o.cx, z - o.cz) - o.r;
    if (d0 > R0 && d0 > dsurf) continue;
    const dd = occDist(o, x, y, z);
    if (dd < dsurf) dsurf = dd;
    const bb = occBound(o, x, y, z, gy);
    if (bb < B) { B = bb; by = o; }
    if (occSoft < Bs) Bs = occSoft;
  }
  if (!force && dsurf < LT.pad) return null;
  // 整合 FE1R：按实际会用上的光球打分 —— lightSolve 摆灯时光球还要被 occSoft（Bs）封顶（Rhi = min(R0, Bs − margin)）。光源刚好高过矮堆垛顶
  // LT.yFade–LT.ySoft 那一截时 occBound 不算它（B = ∞）、occSoft 却还收着：以前打分按 4.4 m 的光球算判定区都照得到，摆上去光球只有 3 m，
  // 叉尖前 0.5 m 那点只剩 6.8 级（种子 16 #10）
  const R = Math.min(R0, B - LT.margin, Bs - LT.margin);
  if (!force && !(R > h + 0.1)) return null;
  // 判定区、5 m（I = 1）：叉尖前 1.5 m 以内的点算两份（够不全时先保近处，K2 的例外也要求 0.5–1.5 m 全亮）
  let z1 = Infinity, zr = Infinity, g1 = 0;
  const e1s = bufE1;
  e1s.length = 0;
  for (let i = 0; i < zone.length; i++) {
    const q = zone[i], d = Math.hypot(q.x - x, h, q.z - z), e = e1(d, h, R);
    e1s.push(e);
    if (e < z1) z1 = e;
    if (e > 1e-4 && e < zr) zr = e;
    if (i === ctx.z1i) g1 = e;
  }
  const f1 = far ? e1(Math.hypot(far.x - x, h, far.z - z), h, R) : null;
  // 强度：底值 / 判定区（够得着的点里最暗的）要的，封顶（光源下的地面、离光源最近的面不发白）
  let Icap = ctx.Imax;
  if (R > h) { const k = 1 - h / R; Icap = Math.min(Icap, ctx.eFloor / (k * k)); }
  // 不发白（返修 FE1R · repair-r5）：按近处表面的颜色封（surfCap，见上），但不比以前「最近那个面照度 ≤ LT.eSurf」更严 —— 颜色说安全的地方
  // （深色漆的柱子、货）放开，颜色估计更严的地方（亮黄护角、白箱子、高光强的树皮）照旧按 eSurf（验收员的第二种办法：保留 eSurf 2.0、按反照率放宽；
  // 全按颜色收严时种子 12345 的 K2 几何例外从 5 个涨到 7 个，车前地面让给了护角）。按颜色那一份只在用得上时算（要的强度超过了别的上限和旧上限；
  // 最后摆上去的那个位置 force 时一定算）：结果逐位一样，候选多的那几帧省时间
  const capOld = dsurf < R ? LT.eSurf / ((1 - dsurf / R) * (1 - dsurf / R)) : Infinity;
  // 正前方窄东西朝车那一面（法线朝车）
  let n1 = Infinity;
  if (ctx.fpts) for (let i = 0; i < ctx.fpts.length; i++) {
    const q = ctx.fpts[i], dx = x - q.x, dy = y - q.y, dz = z - q.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const c = (dx * ctx.nx + dz * ctx.nz) / d;
    const e = d < R && c > 0 ? (1 - d / R) * (1 - d / R) * c : 0;
    if (e < n1) n1 = e;
  }
  // 两边货架的货（L3）：每一点的照度（I = 1，竖直面、法线朝车中线）；强度要够把照得到的点里暗的那四分之一档照满
  let gReq = 0;
  const ge = bufGe;
  ge.length = 0;
  for (let i = 0; i < goods.length; i++) {
    const q = goods[i], dx = x - q.x, dy = y - q.y, dz = z - q.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), c = (dx * q.nx + dz * q.nz) / d;
    ge.push(d < R && c > 0 ? (1 - d / R) * (1 - d / R) * c : 0);
  }
  let gQ = 0;
  if (ge.length) { const srt = ge.filter(v => v > 1e-4).sort((a, b) => a - b); if (srt.length) { gQ = srt[srt.length >> 2]; gReq = LT.gT / gQ; } }
  const need = Math.max(LT.I0, zone.length && zr < Infinity ? LT.zT / zr : 0, ctx.fpts && n1 > 1e-4 ? LT.nT / n1 : 0, gReq);
  Icap = force || need > Math.min(Icap, capOld) ? Math.min(Icap, Math.max(surfCap(ctx.occ, x, y, z, R, gy, ctx.eye, capOld), capOld)) : Math.min(Icap, capOld);
  const I = Math.min(Icap, need);
  // 头顶：天花板（楼板底，正上方）和头顶条目（梁、管子、吊灯的底面）
  const dc = LT.ceilY - h;
  let dh = Infinity;
  for (let i = 0; i < oh.length; i++) {
    const e = oh[i], yb = +e.y - gy;
    if (!(yb > h)) continue;
    const ex = Math.max(0, Math.min(e.minX, e.maxX) - x, x - Math.max(e.minX, e.maxX)), ez = Math.max(0, Math.min(e.minZ, e.maxZ) - z, z - Math.max(e.minZ, e.maxZ));
    const d = Math.hypot(ex, yb - h, ez);
    if (d < dh) dh = d;
  }
  const Ec = dc < R ? I * (1 - dc / R) * (1 - dc / R) : 0, Eh = dh < R ? I * (1 - dh / R) * (1 - dh / R) : 0;
  // 判定区覆盖：叉尖前 1.5 m 以内（K2 例外也必须全亮）和更远的分开算
  let nw = 0, ns = 0, fw = 0, fsum = 0, nmin = 1, bad = 0;
  for (let i = 0; i < zone.length; i++) {
    const v = Math.min(1, I * e1s[i] / LT.zT), near = zone[i].t <= 1.5 + 1e-6;
    if (near) { nw++; ns += v; const vn = Math.min(1, I * e1s[i] / LT.zN); if (vn < nmin) nmin = vn; } else { fw++; fsum += v; }
    // 照不亮的点：近段照度不到 LT.zOkN 扣 LT.badN、远段不到 LT.zOkF 扣 LT.badF（两个阈值都是 0.15，和测试暴力搜判「照得全」同一个；
    // 近段扣得更重：一盏灯照不全时先保叉尖前 0.5–1.5 m，再保 1.5–3 m，最后才是叉尖前 5 m 那一点（K2 比 J9 的 5 m 优先，见 ARCHITECTURE 15.13）
    if (I * e1s[i] < (near ? LT.zOkN : LT.zOkF)) bad += near ? LT.badN : LT.badF;
  }
  const nearC = nw ? ns / nw : 1, farC = fw ? fsum / fw : 1, zs = zone.length ? (ns + fsum) / (nw + fw) : 1;
  const fs = far ? Math.min(1, I * f1 / LT.fT) : 1;
  const faceS = ctx.fpts ? Math.min(1, I * n1 / LT.nT) : 1;
  let cp = 0;
  // 天花板的绝对上限（L-ceiling：空地上 ≤40 级）：两边有货架时放宽到两边货里暗的那四分之一档的照度（天花板不比两边的货亮；返修 FE1R · repair-r5，
  // 主会话 L3 —— 货架通道里一盏点光源照两边 2.8 m 外的货，头顶 3 m 的天花板必然差不多亮，按空地的上限卡，货永远只有 FE1Q 的一半）。
  // 「天花板不比叉尖前 1 m 的地面亮」（下面 ceilK 那条）照旧
  const eCeil = gQ > 0 ? Math.max(LT.eCeil, LT.gCeil * I * gQ) : LT.eCeil;
  if (Ec > eCeil) cp += Math.min(1, (Ec - eCeil) / LT.eCeil);
  const eOh = gQ > 0 ? Math.max(LT.eOh, LT.gCeil * I * gQ) : LT.eOh;
  if (Eh > eOh) cp += Math.min(1, (Eh - eOh) / LT.eOh);
  if (ctx.z1i >= 0 && Ec > LT.ceilK * I * g1) cp += 0.5;
  const pref = -0.04 * Math.abs(s - LT.nom.s) - 0.2 * Math.abs(h - LT.nom.h) - 0.3 * Math.abs(u - LT.nom.u);
  // 正前方窄东西那一面（1.5·faceS）按叉尖前 1.5 m 以内最暗那一点打折（nmin：照度到 LT.zN 算 1）：K2 的例外也要求这一段全亮，
  // 照那一面不能拿近处地面换（种子 16 #150：光源抬到 1 m 照柱子，叉尖前 1.25 m 有一点只剩 3.5 级）
  // bad（整合 FE1R）：判定区里照不亮的点按个数扣分 —— 以前只按平均覆盖算，远角一点差一截（v 0.6）只扣 0.05 分，比光源横偏的偏好分（0.3·|u|）
  // 还小，求解器宁可让远角暗着也不往边上挪（种子 39 #172 树、#179 柱子，暴力搜照得全）。只在照不亮时才扣，照得全的位姿挑法和以前一样
  // 两边货架的货（L3）：照满的比例，两边都有货架时按照得差的那一边算（光源不偏到一边去，两边都要亮），权重 LT.wG（低于车前判定区）；
  // 没有货架时这一项不算（同一个位姿的候选都一样，不影响挑法）
  let gS = 0;
  if (ge.length) {
    let sl = 0, nl = 0, sr = 0, nr = 0;
    for (let i = 0; i < ge.length; i++) { const v = Math.min(1, I * ge[i] / LT.gT); if (goods[i].sd > 0) { sr += v; nr++; } else { sl += v; nl++; } }
    gS = nl && nr ? Math.min(sl / nl, sr / nr) : (sl + sr) / (nl + nr);
  }
  // 货那一项按车前判定区里最暗那一点打折（照度到 LT.zT 才算 1）：车前地面没照满时不拿它换两边的货（K2 优先；repair-r4 第一版没打折，
  // 种子 16 #122 货架端头叉尖前 2.75 m 那一点被让到 6.9 级）
  const gGate = zone.length ? Math.min(1, I * z1 / LT.zT) : 1;
  const score = 4 * nearC + 2 * farC + fs + 1.5 * (ctx.fpts ? faceS * nmin : 1) - 0.6 * cp + pref - bad + LT.wG * gS * gGate;
  return { s, u, h, x, y, z, R0, B, Bs, R, I, Icap, by, score, nearC, farC, bad, nmin, fs, cp, pref, zs, faceS, faceE: ctx.fpts ? I * n1 : null, zMin: zone.length ? I * z1 : null, fE: far ? I * f1 : null, Ec, Eh, dsurf, gS: ge.length ? gS : null, gN: ge.length, gQ, g1 };
}

// 切出墙片：kit 'noclip' 出口那段没有碰撞体、会闪的墙（网格名 'noclip'，顶点是区块本地坐标，区块 group 摆在区块原点）。
// 按网格的包围盒（世界坐标）当墙；每个区块 group 扫一次记在 WeakMap 里（子节点个数变了再扫）。(x, z) 附近 reach 米以内的
const ncCache = new WeakMap();   // group → { n: 子节点个数, list: [盒子…] }
function noclipOf(g) {
  let e = ncCache.get(g);
  if (e && e.n === g.children.length) return e.list;
  const list = [];
  const gx = g.position ? g.position.x : 0, gy = g.position ? g.position.y : 0, gz = g.position ? g.position.z : 0;
  for (let i = 0; i < g.children.length; i++) {
    const m = g.children[i];
    if (!m || m.name !== 'noclip' || !m.geometry) continue;
    const geo = m.geometry;
    if (!geo.boundingBox && has(geo, 'computeBoundingBox')) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (bb) list.push({ minX: bb.min.x + gx, maxX: bb.max.x + gx, minY: bb.min.y + gy, maxY: bb.max.y + gy, minZ: bb.min.z + gz, maxZ: bb.max.z + gz });
  }
  ncCache.set(g, { n: g.children.length, list });
  return list;
}
function noclipBoxes(x, z, reach) {
  const out = bufNc;
  out.length = 0;
  for (const c of nearChunks(x, z)) {
    const g = c && (c.group || (c.res && c.res.group));
    if (!g || !Array.isArray(g.children)) continue;
    const list = noclipOf(g);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.maxX < x - reach || b.minX > x + reach || b.maxZ < z - reach || b.minZ > z + reach) continue;
      out.push(b);
    }
  }
  return out;
}

// 停着的车（没 sim）的 OBB 里压着的地上物资：推到外面最近的一侧，推不出去就一圈圈找空地
function clearItems(obbs, opts) {
  const I = BR.items;
  const list = I && Array.isArray(I.list) ? I.list : null;
  if (!list || !list.length || !Array.isArray(obbs) || !obbs.length || !has(I, 'move')) return 0;
  let cx = 0, cz = 0;
  for (const b of obbs) { cx += b.cx; cz += b.cz; }
  cx /= obbs.length; cz /= obbs.length;
  const plan = planPush(null, obbs, cx, cz, 5);
  let n = 0;
  const bad = new Set();
  for (const [p, x, z] of plan.moves) { I.move(p.id, x, pushY(p, x, z), z); n++; }
  if (!plan.ok && plan.pinned) bad.add(plan.pinned);
  // 推不出去的（夹在车和墙之间）：车旁一圈圈找
  for (const p of bad) {
    const r = itemR(p), h = itemH(p), g = groundAt(p.x, p.z, num(p.y, 0));
    let done = false;
    for (let R = 0.2; R <= 4 && !done; R += 0.15) {
      for (let i = 0; i < 16 && !done; i++) {
        const a = i / 16 * Math.PI * 2, x = p.x + Math.cos(a) * R, z = p.z + Math.sin(a) * R;
        let ok = Math.abs(groundAt(x, z, g) - g) <= 0.05;
        for (const b of obbs) if (ok && yOver(b.minY, b.maxY, g, g + h) && circleDist2(b, x, z) < (r + 0.01) * (r + 0.01)) ok = false;
        if (ok && BR.phys && has(BR.phys, 'overlapCircle')) { try { if (BR.phys.overlapCircle(x, z, r, g + 0.02, h)) ok = false; } catch (err) { /* 当成空 */ } }
        if (ok) { I.move(p.id, x, pushY(p, x, z), z); n++; done = true; }
      }
    }
  }
  return n;
}

// 离开这一层：推着的物资松手（位置一次写进 levelState）、藤蔓摆回去；回主页：整张表清掉（BR.vehicles 一般也会自己 dispose）
function disposeAll() { Array.from(sims.values()).forEach(s => s.dispose()); }
function softAll() {
  sims.forEach(s => {
    s.releasePushed(true);
    s.vines.forEach(S => { try { BR.kit.spanRestore(S.res, S.vn.mat || 'kit:prop', S.vn.v); } catch (err) { /* 已经没了 */ } });
    s.vines.clear();
  });
}
if (BR.bus && has(BR.bus, 'on')) {
  BR.bus.on('game:home', disposeAll);
  BR.bus.on('level:leave', softAll);
  // 下车（含强制下车）以后 BR.vehicles 不再 step 这台车：推着的物资在这里松手
  BR.bus.on('vehicle:dismount', e => { const s = e && e.key != null ? sims.get(String(e.key)) : null; if (s) s.releasePushed(true); });
}

BR.forklift = {
  get geo() { return G(); },
  config: CFG,
  create(rec) {
    const k = rec && rec.key != null ? String(rec.key) : null;
    if (k && sims.has(k)) sims.get(k).dispose();
    return new Sim(rec);
  },
  state(key) { const s = sims.get(String(key)); return s ? s.poseObj() : null; },
  byKey(key) { return sims.get(String(key)) || null; },
  list() { return Array.from(sims.values()); },
  sound(ev) { return 'fk_' + String(ev); },
  clearItems,
  // 纯函数（测试 / 别的模块用）
  _geom: { obbHitsRect, obbHitsObb, circleDist2, worldBoxes, toW, toL, sweepLocal, sideShape, sideHit, vineHit },
  _disposeAll: disposeAll,
  // 大灯落点（测试、调试看候选打分）
  _light: { LT, ctx: lightCtx, eval: lightEval, solve: lightSolve, occBound, occKind, sMaxU, ALB, albProf, albGet, surfCap, ambAt, texHi },
};
})();
