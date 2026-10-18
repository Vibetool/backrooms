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
//     note   = 状态行文字 | null（「发动中」「雷达自动刹车」「前面是出口」……，见 playerSpec texts；倒车撞上的说「后面是出口」
//              「后面有东西挡着，下车把它拖开」，repair-r1 新加，返修 r3 已同步进方案 playerSpec.texts）
//     noise  = 0 熄火 / 0.25 怠速 / 0.6 行驶 / 0.8 倒车；本机在开时另外每步调 BR.entities.makeNoise（只在噩梦模式生效）
//     shake  = 这一步要不要抖镜头：撞上（≥ 0.8 m/s）时 0.15（秒），系统设了减少动态效果时恒为 0
//   sim.obbsWorld() → [{ name, cx, cz, hx, hz, rot, minY, maxY }] × 14（当前 pose 的世界 OBB，phys.addOBBs 的格式）
//   sim.exitSpot(pref, force) → { x, z, y, side: 'left'|'right'|'rear'|'free' } | null
//       pref：玩家朝向（世界 yaw，数字）或 'left' / 'right' / 'rear'；偏左 > 20° 先左、偏右 > 20° 先右、正前方先左，再另一边，再车尾。
//       force = true（死在车上、换层、回主页）：三面都不行就从车旁一圈圈往外找，永远不落进 OBB 和出口圈
//   sim.lightSpot() → { x, y, z, range, color, intensity, flicker }：前大灯借灯池的那盏（world.setExtraLights 的格式）
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
//   ④ 推开地上物资（车身和货叉的 OBB）；⑤ 藤蔓拨开再摆回（kit.spanEdit / spanRestore，纯表现）；⑥ 下车落点；
//   ⑦ 噪音；⑧ 前大灯落点；⑨ 坐车的人的位置由 BR.vehicles 按座椅给。
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
  underGap: { person: 0.02, item: 0.005, solid: 0.005 },
  // 前大灯：点光源放在叉根前 ahead 米、离地 y 米。L1 断电（只剩环境光）时车前 4 m 地面要亮到环境的 3 倍以上：光源抬到 1.6 m、
  // 放在车前 4 m 的正上方附近，光斑在车前 2–8 m 铺开（不是脚下一个刺眼的亮点），车尾后面在 range 8 以外
  light: { ahead: 4.0, y: 1.6, range: 8, near: 2.2, nearMin: 1.8, color: 0xfff0d8, intensity: 3.2 },
  vine: { reach: 4, back: 1.2, pad: 0.1 },
  exitMargin: 0.4,
  personR: 0.3, personH: 1.8,
};
const DT_MAX = 0.1, SUB_DT = 1 / 30;
const OH_WORD = { pipe: '管子', valve: '管子', gauge: '管子', drip: '管子', lamp: '吊灯', beam: '横梁', tray: '桥架', cable: '电缆', arch: '拱顶' };
// 车身高度上伸出来的东西（b.data.sideObs）升货叉被它挡住时的叫法；没列的按 OH_WORD，再没有说「东西」
const SIDE_WORD = { cabinet: '消火栓箱', extinguisher: '灭火器', switch: '开关盒', cone: '路锥', lamp: '灯' };
const TXT = {
  crank: '发动中', radar: '雷达自动刹车', exit: '前面是出口', prop: '前面有东西挡着，下车把它拖开',
  // 倒车撞上的（出口圈、拖出来的家具在车尾那边）：说「后面」，孩子不会往前找
  exitBack: '后面是出口', propBack: '后面有东西挡着，下车把它拖开',
  tail: '车尾会往外甩，先倒车带出来', underPerson: '货叉下面有人', underThing: '货叉下面有东西',
  overhead: w => '上面有' + w + '，升不上去',
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
const ROOF_PARTS = { roof: 1, postFL: 1, postFR: 1, postRL: 1, postRR: 1 };
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
    b.name = p.name; b.cx = x + c * p.cx + s * p.cz; b.cz = z - s * p.cx + c * p.cz; b.hx = p.hx; b.hz = p.hz; b.rot = yaw;
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
const tmpRot = { x: 0, z: 0 };
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
// 人和实体（竖直圆柱）。坐在这台车驾驶舱里的人不算（他是司机）
function peopleCircles(sim, env, out) {
  out.length = 0;
  const g = G(), cab = g.cabR;
  const inCab = (x, z) => { const l = toL(sim.x, sim.z, sim.yaw, x, z); return Math.abs(l.x) <= cab.x + 0.05 && l.z >= cab.z0 - 0.05 && l.z <= cab.z1 + 0.05; };
  const P = BR.player;
  const riderIsMe = env.local === true || (BR.vehicles && BR.vehicles.seated === sim.key) || (P && P.mounted && P.mounted.key === sim.key);
  if (P && !P.dead && Number.isFinite(+P.x) && !riderIsMe && !(P.mounted)) {
    const feet = Number.isFinite(+P.feetY) ? +P.feetY : num(P.y, 1.62) - num(BR.config.player && BR.config.player.eyeHeight, 1.62);
    if (!inCab(P.x, P.z)) out.push({ kind: 'circle', x: +P.x, z: +P.z, r: num(BR.config.player && BR.config.player.radius, 0.3), minY: feet, maxY: feet + CFG.personH, id: 'p:me', person: true });
  }
  let peer = null;
  try { peer = BR.coop && BR.coop.peer; } catch (err) { peer = null; }
  if (peer && Number.isFinite(+peer.x) && Number.isFinite(+peer.z) && peerSeatedKey() !== sim.key) {
    const feet = num(peer.y, 1.62) - 1.62;
    if (Math.abs(feet - sim.y) < 2.5 && !inCab(peer.x, peer.z)) out.push({ kind: 'circle', x: +peer.x, z: +peer.z, r: 0.3, minY: feet, maxY: feet + CFG.personH, id: 'p:peer', person: true });
  }
  const E = BR.entities && BR.entities.list;
  if (E && typeof E.length === 'number') {
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (!e || e.dead || e.removed || !Number.isFinite(+e.x)) continue;
      if (Math.abs(e.x - sim.x) > 8 || Math.abs(e.z - sim.z) > 8) continue;
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
function itemR(p) { return Math.max(0.04, num(p.r, 0.1) * 0.8); }
function itemH(p) { return Math.max(0.05, num(p.hh, 0.1) * 2); }
// 物资圆（世界 x, z、半径 r）在这个 OBB 本地坐标系里，被推到盒外：
// from（上一步的本地点，可选）在盒外时，按进入的那一面推（扫过去的也接得住，不穿过薄薄的货叉）；否则按最小穿透
function pushOut(b, l0, l1, r, gap) {
  const ex = b.hx + r, ez = b.hz + r;
  if (Math.abs(l1.x) >= ex || Math.abs(l1.z) >= ez) {
    // 终点在外面：看路径有没有穿过盒（薄叉一帧走过去）
    if (!l0 || (Math.abs(l0.x) < ex && Math.abs(l0.z) < ez)) return null;
    const dx = l1.x - l0.x, dz = l1.z - l0.z;
    let t0 = 0, t1 = 1, face = -1;
    const slab = (o, d, e, fNeg, fPos) => {
      if (Math.abs(d) < 1e-12) return Math.abs(o) < e;
      let ta = (-e - o) / d, tb = (e - o) / d, fa = fNeg;
      if (ta > tb) { const t = ta; ta = tb; tb = t; fa = fPos; }
      if (ta > t0) { t0 = ta; face = fa; }
      if (tb < t1) t1 = tb;
      return t0 < t1;
    };
    if (!slab(l0.x, dx, ex, 0, 1) || !slab(l0.z, dz, ez, 2, 3)) return null;
    if (face < 0) return null;
    return faceOut(face, l1, ex, ez, gap);
  }
  // 终点在里面
  let face;
  if (l0 && !(Math.abs(l0.x) < ex && Math.abs(l0.z) < ez)) {
    // 从外面进来：哪一面先碰上
    const dx = l1.x - l0.x, dz = l1.z - l0.z;
    let t0 = -Infinity; face = 0;
    const cand = (o, d, e, fNeg, fPos) => {
      if (Math.abs(d) < 1e-12) return;
      let ta = (-e - o) / d, tb = (e - o) / d, fa = fNeg;
      if (ta > tb) { ta = tb; fa = fPos; }
      if (ta > t0) { t0 = ta; face = fa; }
    };
    cand(l0.x, dx, ex, 0, 1); cand(l0.z, dz, ez, 2, 3);
  } else {
    const m = [ex + l1.x, ex - l1.x, ez + l1.z, ez - l1.z];
    face = 0;
    for (let i = 1; i < 4; i++) if (m[i] < m[face]) face = i;
  }
  return faceOut(face, l1, ex, ez, gap);
}
function faceOut(face, l, ex, ez, gap) {
  if (face === 0) return { x: -ex - gap, z: l.z };
  if (face === 1) return { x: ex + gap, z: l.z };
  if (face === 2) return { x: l.x, z: -ez - gap };
  return { x: l.x, z: ez + gap };
}
function boxLocal(b, x, z) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.cx, dz = z - b.cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
function boxWorld(b, lx, lz) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: b.cx + c * lx + s * lz, z: b.cz - s * lx + c * lz };
}
// boxes0 → boxes1（同一组部件，上一步和这一步）。返回 { ok, moves:[[p, x, z]] }；ok = false：有一件被夹在车和墙之间推不开。
// mine：这台车正推着（hold 住）的物资 id —— 别人抓着的不推
function planPush(boxes0, boxes1, cx, cz, reach, mine, riders) {
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
    const r = itemR(p), h = itemH(p), y0 = num(p.y, 0), y1 = y0 + h;
    let x = p.x, z = p.z, touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < boxes1.length; k++) {
        const b1 = boxes1[k];
        if (!yOver(b1.minY, b1.maxY, y0, y1)) continue;
        const l1 = boxLocal(b1, x, z);
        if (Math.abs(l1.x) > b1.hx + r + 0.6 || Math.abs(l1.z) > b1.hz + r + 0.6) continue;
        const b0 = boxes0 ? boxes0[k] : null;
        const l0 = b0 && pass === 0 ? boxLocal(b0, p.x, p.z) : null;
        const q = pushOut(b1, l0, l1, r, 0.01);
        if (!q) continue;
        const w = boxWorld(b1, q.x, q.z);
        x = w.x; z = w.z; moved = touched = true;
      }
      if (!moved) break;
    }
    if (!touched) continue;
    // 墙挡着：照 interact.pushItems，用 moveCircle 贴墙滑；推不出车的范围就算被夹住
    const g = groundAt(p.x, p.z, y0);
    let nx = x, nz = z;
    if (BR.phys && has(BR.phys, 'moveCircle')) {
      try {
        const res = BR.phys.moveCircle(p.x, p.z, r, x - p.x, z - p.z, g + 0.02, h);
        if (res) { nx = num(res.x, nx); nz = num(res.z, nz); }
      } catch (err) { /* 用原值 */ }
    }
    if (Math.abs(groundAt(nx, nz, g) - g) > 0.2) return { ok: false, moves, pinned: p };
    for (let k = 0; k < boxes1.length; k++) {
      const b1 = boxes1[k];
      if (!yOver(b1.minY, b1.maxY, y0, y1)) continue;
      const d2 = circleDist2(b1, nx, nz);
      if (d2 < (r - 0.005) * (r - 0.005)) return { ok: false, moves, pinned: p };
    }
    moves.push([p, nx, nz]);
  }
  return { ok: true, moves };
}

// ---------- 模拟 ----------
const sims = new Map();
const bufBoxes = [], bufObs = [], bufPeople = [], bufOh = [], bufSide = [], bufSkip = [];

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
    for (let k = 0; k < nSub; k++) {
      // 方向（液压助力：着车才打得动；熄火停着的车轮子保持原来的角度）
      if (running) {
        const tgt = -st * g.maxSteer;           // 往左打（st > 0）：后轮朝右前方（steer < 0），车头往左
        const back = Math.abs(tgt) < Math.abs(this.steer) - 1e-6 && (tgt === 0 || Math.sign(tgt) === Math.sign(this.steer));
        this.steer = approach(this.steer, tgt, (back ? CFG.steerReturn : CFG.steerRate) * h);
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
      let maxL = 1, word = null;
      const boxes = worldBoxes(g, this.x, this.z, this.y, this.yaw, 0, g.parts, bufBoxes);
      for (let i = 0; i < boxes.length; i++) {
        const p = g.parts[i];
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
      }
      if (want > maxL) want = Math.max(cur, maxL);
      if (want >= 1 && cur < 1) { want = 1; if (this.endLatch !== 1) { events.push('end'); this.endLatch = 1; } }
      if (want <= cur + 1e-7) {
        if (cur >= 1 - 1e-9) return null;          // 到顶了
        // 被头顶东西挡住：液压憋压
        this.strainT -= h;
        if (this.strainT <= 0) { events.push('strain'); this.strainT = 1.5; }
        this.hyd = true;
        return TXT.overhead(word || '横梁');
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
    // 碰撞体：每根货叉三点、货叉架两点往下打射线
    const P = BR.phys;
    if (P && has(P, 'raycast')) {
      for (let i = 0; i < boxes.length; i++) {
        const p = g.parts[i];
        if (!(p.ly > 0) || p.name === 'mastInner') continue;
        const b = boxes[i];
        const pts = p.name === 'carriage' ? [[-b.hx * 0.85, 0], [b.hx * 0.85, 0]] : [[0, -b.hz * 0.9], [0, 0], [0, b.hz * 0.9]];
        for (const [lx, lz] of pts) {
          const w = boxWorld(b, lx, lz), y0 = b.minY - 0.002;
          const ground = groundAt(w.x, w.z, this.y);
          if (y0 - ground < 0.01) continue;
          let hit = null;
          try { hit = P.raycast(w.x, y0, w.z, 0, -1, 0, y0 - ground + 0.02, { ignoreKey: ign, skipBoxes: this.skipNow && this.skipNow.length ? this.skipNow : undefined }); } catch (err) { hit = null; }
          if (hit && Number.isFinite(+hit.y) && hit.y > ground + 0.005) consider(i, +hit.y, CFG.underGap.solid, false);
        }
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
    const test = (mo, list) => {
      const a = physSweep(this, g, this.lift, mo, ign, list);
      const b = sweepLocal(g, this, this.lift, mo, list || g.parts, obs);
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
        const tail = turning && !!test(full, g.rearParts);
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
    const b0 = E.pushItems === false ? null : boxesAt(g, this, this.lift, mo, 0, g.parts, []);
    const o = rotAbout(this.x, this.z, mo.px, mo.pz, mo.dyaw * frac, { x: 0, z: 0 });
    const nx = o.x + mo.dx * frac, nz = o.z + mo.dz * frac, nyaw = wrap(this.yaw + mo.dyaw * frac);
    // 地上物资：先算推得开推不开（被夹在车和墙之间就整步不走）
    if (b0 && frac > 0) {
      const b1 = worldBoxes(g, nx, nz, this.y, nyaw, this.lift, g.parts, []);
      const plan = planPush(b0, b1, (this.x + nx) / 2, (this.z + nz) / 2, 4, this.pushed, E.riders);
      if (!plan.ok) {
        // 有一件被夹在车和墙之间（FE1 返修 r3 裁定 ②）：车停在还推得动的最远处（这一步里二分），被推的东西停在车和墙之间，
        // 不穿墙、不压进货叉；按撞上那一刻的车速出声 —— ≥ bangV 是「哐」+ 镜头抖（叉上的瓶罐照常甩出去，vehicles 看 'bang'），
        // 慢慢顶上去才是「咚」
        let lo = 0, hi = frac, best = null, bx = this.x, bz = this.z, byaw = this.yaw;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          const om = rotAbout(this.x, this.z, mo.px, mo.pz, mo.dyaw * mid, { x: 0, z: 0 });
          const mx = om.x + mo.dx * mid, mz = om.z + mo.dz * mid, myaw = wrap(this.yaw + mo.dyaw * mid);
          const pm = planPush(b0, worldBoxes(g, mx, mz, this.y, myaw, this.lift, g.parts, []), (this.x + mx) / 2, (this.z + mz) / 2, 4, this.pushed, E.riders);
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
      try { I.move(p.id, x, undefined, z); } catch (err) { /* 已经被捡走 */ }
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
    const r = CFG.personR;
    for (const b of boxes) if (circleDist2(b, x, z) < (r + 0.02) * (r + 0.02)) return false;
    for (const b of blk) {
      if (b.kind === 'circle') { if (Math.hypot(b.x - x, b.z - z) < b.r) return false; }
      else if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false;
    }
    return true;
  },
  // 站得下：返回地面高度 | null。from = 座椅胸口点（看得见）/ 'rear'（翻过配重：经过配重上方）/ null
  spotOk(x, z, boxes, people, blk, from, strict) {
    const r = CFG.personR, P = BR.phys;
    const gy = groundAt(x, z, this.y);
    if (Math.abs(gy - this.y) > 0.35) return null;
    if (!this.spotBasic(x, z, boxes, blk)) return null;
    if (P && has(P, 'overlapCircle')) { try { if (P.overlapCircle(x, z, r, gy + 0.02, CFG.personH - 0.04)) return null; } catch (err) { /* 当成能站 */ } }
    if (strict) for (const c of people) {
      if (c.maxY < gy + 0.05 || c.minY > gy + 1.8) continue;
      if (Math.hypot(c.x - x, c.z - z) < c.r + r) return null;
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
  lightSpot() {
    const g = G(), L = CFG.light;
    const LZ = -0.7;                                   // 射线从两盏大灯之间（前立柱）出发
    const o = this.toWorld(0, LZ);
    const fx = fwdX(this.yaw), fz = fwdZ(this.yaw);
    // 「车头」= 门架前脸 / 叉根（forkZ 里靠后的那个）；灯放在它前面 CFG.light.ahead（4 m）、离地 1.6 m（数值以这里为准，方案已同步）
    const heel = Array.isArray(g.forkZ) ? Math.max(+g.forkZ[0], +g.forkZ[1]) : -1.16;
    const maxD = Math.abs(LZ - heel) + L.ahead;
    const y = this.y + L.y;
    let d = maxD, range = L.range;
    const P = BR.phys;
    if (P && has(P, 'raycast')) {
      let hit = null;
      try { hit = P.raycast(o.x, y, o.z, fx, 0, fz, maxD, { ignoreKey: this.ignoreKeys(null) }); } catch (err) { hit = null; }
      if (hit && Number.isFinite(+hit.dist)) {
        const dh = +hit.dist;
        d = Math.max(0.15, dh - 0.3);
        // 墙前：照亮车和墙之间就够，不透过去（点光源没有阴影，靠收小范围：光源离墙 0.3 m，范围 ≤ 2.2 m，
        // 墙另一侧 2 m 处已经在范围外）；墙在窗口最远那半米时慢慢放回 range（8），不跳
        const nearR = clamp(dh, L.nearMin, L.near);
        const k = clamp((dh - (maxD - 0.5)) / 0.5, 0, 1);
        range = nearR + (L.range - nearR) * k;
      }
    }
    return { x: o.x + fx * d, y, z: o.z + fz * d, range, color: L.color, intensity: L.intensity, flicker: 0, decay: 2, owner: 'forklift:' + this.key };
  },

  // ---------- 藤蔓（纯表现，不同步） ----------
  // 车附近 4 m 内的藤蔓：下段进了护顶、门架（外门架、内门架、货叉架）或司机胸口外扩 0.1 m 的范围，就绕藤蔓顶点往离车的方向转开；
  // 车走了 1.2 s 内慢慢摆回，摆到 0 时 spanRestore 逐位恢复。每一帧最后的角度都核过「碰不到」（车还在动时摆回去的路上也不会穿进护顶）
  stepVines(dt, seated) {
    const K = BR.kit;
    if (!K || !has(K, 'spanEdit')) return;
    const V = CFG.vine;
    const vols = this.vineVolumes(seated);
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
        const vv = vineVolsFor(vn, vols);
        if (!S && !vv.boxes.length && !vv.cap) continue;
        if (!S) {
          if (this.vineClear(vn, vv, [1, 0], 0)) continue;
          const best = this.vineSearch(vn, vv, null);
          S = { id, c, res: c.res, vn, dir: best.dir, th: 0, peak: 0, frame: null };
          this.vines.set(id, S);
          this.vineSet(S, best.th);
          continue;
        }
        S.res = c.res; S.c = c;
        const te = Math.max(0, S.th - Math.max(S.peak, 0.2) * dt / V.back);
        let th = te;
        if ((vv.boxes.length || vv.cap) && !this.vineClear(vn, vv, S.dir, te)) {
          if (S.th > te && this.vineClear(vn, vv, S.dir, S.th)) th = S.th;   // 摆回去一点就碰：先停在原处，等车走开再摆
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
  vineVolumes(seated) {
    const g = G(), pad = CFG.vine.pad;
    const boxes = worldBoxes(g, this.x, this.z, this.y, this.yaw, this.lift, g.parts, []);
    const vols = [];
    for (let i = 0; i < boxes.length; i++) {
      const n = g.parts[i].name;
      if (!ROOF_PARTS[n] && !MAST_PARTS[n]) continue;
      const b = boxes[i];
      vols.push({ cx: b.cx, cz: b.cz, hx: b.hx + pad, hz: b.hz + pad, rot: b.rot, minY: b.minY - pad, maxY: b.maxY + pad });
    }
    let cap = null;
    if (seated) {
      const c = this.chestWorld(), e = this.eyeWorld();
      cap = { a: c, b: { x: e.x, y: e.y + 0.12, z: e.z }, r: 0.15 + pad };
    }
    return { boxes: vols, cap };
  },
  // 藤蔓（往 dir 摆 th）碰不碰得到车：查离顶点 5% 以下的轴线采样点（3 cm 一个），外扩藤蔓半径
  vineClear(vn, vols, dir, th) {
    const t = vn.top, b = vn.bot, r = num(vn.r, 0.02) + 0.005;
    const hx = b[0] - t[0], hy = b[1] - t[1], hz = b[2] - t[2];
    const len = Math.hypot(hx, hy, hz);
    const n = Math.max(8, Math.ceil(len / 0.03));
    const rot = vineRot(dir, th);
    for (let i = 0; i <= n; i++) {
      const u = 0.04 + 0.96 * i / n;
      const v = applyRot(rot, hx * u, hy * u, hz * u);
      const x = t[0] + v[0], y = t[1] + v[1], z = t[2] + v[2];
      for (const bx of vols.boxes) {
        if (y < bx.minY - r || y > bx.maxY + r) continue;
        if (circleDist2(bx, x, z) < r * r) return false;
      }
      if (vols.cap) {
        const C = vols.cap, ax = C.b.x - C.a.x, ay = C.b.y - C.a.y, az = C.b.z - C.a.z;
        const L2 = ax * ax + ay * ay + az * az;
        const k = clamp(((x - C.a.x) * ax + (y - C.a.y) * ay + (z - C.a.z) * az) / (L2 || 1), 0, 1);
        const qx = C.a.x + ax * k, qy = C.a.y + ay * k, qz = C.a.z + az * k;
        if (Math.hypot(x - qx, y - qy, z - qz) < C.r + r) return false;
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
  // lo 碰、hi 不碰：二分到 3 mrad，返回不碰的那一头
  vineBisect(vn, vols, d, lo, hi) {
    for (let i = 0; i < 7 && hi - lo > 0.003; i++) { const m = (lo + hi) / 2; if (this.vineClear(vn, vols, d, m)) hi = m; else lo = m; }
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
// 只留够得着这根藤蔓的那几块（藤蔓绕顶点转，够得着的范围是以顶点为心、藤长为半径的球）
function vineVolsFor(vn, vols) {
  const t = vn.top, b = vn.bot, len = Math.hypot(b[0] - t[0], b[1] - t[1], b[2] - t[2]) + 0.05;
  const boxes = [];
  for (const bx of vols.boxes) {
    if (bx.maxY < t[1] - len || bx.minY > t[1]) continue;
    if (Math.sqrt(Math.max(0, circleDist2(bx, t[0], t[2]))) > len) continue;
    boxes.push(bx);
  }
  let cap = vols.cap;
  if (cap) {
    const C = cap, d = Math.min(Math.hypot(C.a.x - t[0], C.a.y - t[1], C.a.z - t[2]), Math.hypot(C.b.x - t[0], C.b.y - t[1], C.b.z - t[2]));
    if (d > len + C.r + 0.6) cap = null;
  }
  return { boxes, cap };
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
  for (const [p, x, z] of plan.moves) { I.move(p.id, x, undefined, z); n++; }
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
        if (ok) { I.move(p.id, x, undefined, z); n++; done = true; }
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
  _geom: { obbHitsRect, obbHitsObb, circleDist2, worldBoxes, toW, toL, sweepLocal, sideShape, sideHit },
  _disposeAll: disposeAll,
};
})();
