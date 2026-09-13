// Level 5 - "恐怖旅馆"（Horror Hotel；标题/别称见页面标题「Level 5 - "恐怖旅馆"」）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-5  许可：CC BY-SA 3.0
// 抓取：2026-09-12；译者 JLhze，原作者 Fandom user Discord13，Stretchsterz 重写，ratscrapz 提供想法/编码/Entity 18
// 只按这个版本实现，冲突列表（data/lore-choices.json levels["5"].conflicts）里属于 wikidot-en / fandom 的细节一律不做：
//   不做 fandom 的豪华酒店休息厅/舞厅/客房/餐厅/健身房/泳池、Class 5 生存等级、传闻实体设定、维修大厅去 Level 6；
//   不做 wikidot-en 独有的实体（Wretches、Predatory Windows）、Level 25 街机入口、11 个出口的英文站独有那几条；
//   Entity 130/75 的译名按中文站取（啼物/牧蛇）；子层级 Level 5.3、大堂房间入口未知，均按下文说明不做。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：environment.scale「近乎无限；其他具体尺寸没给」——沿用室内迷宫默认尺度，非设定精确值
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.8;        // 层高：原文未给数字，用 kit 默认层高
const H_TALL = 4.4;   // 贝弗莉室「巨大吊灯」、锅炉房「空间很大」——两处特殊大房间用更高的层高体现"宽敞/巨大"，非设定精确数值
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 布局：主厅（多数）/ 客房走廊（少数）+ 宏格定位的贝弗莉室、锅炉房 ----------
// 依据：architecture「近乎无限的酒店综合楼，房间和大厅极多，有三个可以完全进入的主要区域：
//   酒店主厅、贝弗莉室、锅炉房」；layout「主厅是最容易发现的主区域」——主厅作为默认/多数地形，
//   贝弗莉室与锅炉房作为稀有的整块清空的"枢纽房间"，用宏格（TEMPLATE 4.2 节）各自定位一处
const EDGE = { salt: 'L5', boundaryDensity: 0.3, straightness: 0.62, minOpenings: 3 };
const HALL = Object.assign({ wallDensity: 0.32, roomChance: 0.35, maxRooms: 2, roomSize: [2, 3], loopChance: 0.55, pillarChance: 0.04 }, EDGE);
// 依据：landmarks「客房门：金色标牌，房号随机；大多锁着」——客房走廊墙密度更高、房间更窄小（单间客房尺度）
const CORRIDOR = Object.assign({ wallDensity: 0.5, roomChance: 0.18, maxRooms: 1, roomSize: [2, 2], loopChance: 0.35, pillarChance: 0 }, EDGE);
// 依据：layout「锅炉房空间很大，但被旧机器和交织管道塞满，显得幽闭恐怖」——整块清空后靠 keepPillars 留机器占位
const BOILER = Object.assign({ wallDensity: 0.4, roomChance: 0, loopChance: 0, pillarChance: 0.18 }, EDGE);
// 依据：landmarks「贝弗莉室…非常宽敞」——整块清空、不留柱子
const BEVERLY = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0 }, EDGE);
const P_HALL = 0.75;   // 依据：layout「主厅是最容易发现的主区域」——多数区块判定为主厅，非设定精确比例

// 宏格：4×4 区块（约 96 m）一个宏区域，贝弗莉室、锅炉房各自独立判定是否出现一次，
// 呼应 architecture「三个可以完全进入的主要区域」的稀有枢纽感（宏格大小非设定精确值，不吃主流 rng，见 TEMPLATE 4.2 节）
const MX = 4;
function landmarkAt(levelSeed, cx, cz) {
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  const mr = U.rng(levelSeed, 'L5-landmark', mx, mz);
  const hasBeverly = mr() < 0.6;   // 依据：landmarks「贝弗莉室是主要枢纽」——比锅炉房更常见
  const bi = mx * MX + Math.floor(mr() * MX), bj = mz * MX + Math.floor(mr() * MX);
  const hasBoiler = mr() < 0.5;
  const oi = mx * MX + Math.floor(mr() * MX), oj = mz * MX + Math.floor(mr() * MX);
  if (hasBeverly && cx === bi && cz === bj && !(cx === 0 && cz === 0)) return 'beverly';
  if (hasBoiler && cx === oi && cz === oj && !(cx === 0 && cz === 0) && !(hasBeverly && bi === oi && bj === oj)) return 'boiler';
  return null;
}

// ---------- 材质 ----------
// 依据：materials「主厅：华丽墙纸…墙纸为红木色和金色」——生成 l5_wallpaper_hotel（tools/textures/gen.sh）
// 依据：materials「地板有黑胡桃木、白色大理石、异国情调的红金色地毯」——三种没给比例，生成一张红金地毯贴图，
//   木纹/大理石没有对应贴图，用同一张地毯贴图配合 vertexColors 染色近似（kit 没有单独的木纹/大理石贴图，见 apiRequests）
// 依据：materials「锅炉房…颜色没写（unverified）」——不生成专属贴图，复用已有的 metal/concrete_wet 程序化贴图
function defineMaterials() {
  kit.mats({
    'L5:wall':   { tex: 'l5_wallpaper_hotel', repeatMeters: 2.2, roughness: 0.85 },
    'L5:floor':  { tex: 'l5_carpet_hotel', repeatMeters: 2.6, roughness: 0.9, vertexColors: true },
    'L5:ceiling': { tex: 'ceiling_tile', repeatMeters: 1.8, roughness: 1, color: 0xf1e2ba },
    'L5:boilerWall': { tex: 'metal', repeatMeters: 2, roughness: 0.65, metalness: 0.3, color: 0x54534c },
    'L5:boilerFloor': { tex: 'concrete_wet', repeatMeters: 2.4, roughness: 1 },
  });
}

// file:// 双击兜底：贴图文件读不到时的程序化画法（_TEMPLATE.md 第 15 节步骤 7）
BR.assets.registerProcedural('l5_wallpaper_hotel', 256, (g, s) => {
  g.fillStyle = '#4a1414'; g.fillRect(0, 0, s, s);
  const r = U.rng('l5_wallpaper_hotel');
  g.fillStyle = '#c8862c';
  const cell = s / 5;
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
    const cx = i * cell + cell / 2, cy = j * cell + cell / 2, rr = cell * 0.28;
    g.beginPath();
    g.moveTo(cx, cy - rr); g.lineTo(cx + rr * 0.6, cy); g.lineTo(cx, cy + rr); g.lineTo(cx - rr * 0.6, cy);
    g.closePath(); g.fill();
  }
  for (let k = 0; k < 200; k++) { const v = 50 + (r() * 20 | 0); g.fillStyle = `rgba(${v + 20},${v},${v},0.18)`; g.fillRect(r() * s, r() * s, 3, 3); }
});
BR.assets.registerProcedural('l5_carpet_hotel', 256, (g, s) => {
  g.fillStyle = '#7a3c28'; g.fillRect(0, 0, s, s);
  const r = U.rng('l5_carpet_hotel');
  for (let k = 0; k < 1400; k++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(160,90,40,${0.15 + r() * 0.2})` : `rgba(90,40,30,${0.15 + r() * 0.2})`;
    g.fillRect(r() * s, r() * s, 3, 3);
  }
});

// ---------- 通用出口（任意主厅/客房走廊区块，位置不限）----------
// 依据：exits[3]「打开一扇深色木门，原文没说在哪个区域」；exits[4]「找到一扇开着、显现森林景象的门」
const GENERIC_EXIT_DEFS = [
  { to: '9', kind: 'door', style: 'wood', color: 0x2a1c12, weight: 0.02, note: '深色木门，原文未指明区域 (exits[3])' },
  { to: '63', kind: 'zone', weight: 0.015, note: '开着、显现森林景象的门；原文门可能在墙壁/地板/天花板上，只做墙面这一种 (exits[4])' },
];
// 仅主厅：依据 exits[1]「回到电梯」；exits[5]「进入主厅里的金属门」
const HALL_EXIT_DEFS = [
  { to: '3', kind: 'elevator', weight: 0.02, note: '现代或古董电梯，回到 Level 3 (exits[1])' },
  { to: '98', kind: 'door', style: 'metal', weight: 0.02, note: '主厅里的金属门 (exits[5])' },
];

function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}

function decorateForestDoor(b, x, z, rng) {
  // kit 没有森林画面/贴图构件，用绿色发光平面近似"门内透出的林间景象"
  b.plane(x, 1.0, z - 0.15, 0.9, 2.0, 'kit:glow', { facing: '+z', uv: 'solid', color: [0.32, 0.7 + rng() * 0.2, 0.3], glow: 0.85 });
}

function buildExits(b, g, rng, kind) {
  const defs = kind === 'hall' ? GENERIC_EXIT_DEFS.concat(HALL_EXIT_DEFS) : GENERIC_EXIT_DEFS;
  for (const def of defs) {
    const roll = rng();
    if (roll >= def.weight) continue;
    if (def.kind === 'door' || def.kind === 'elevator') {
      const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (!ed) continue;
      kit.exit(b, { to: def.to, kind: def.kind, x: ed.x, z: ed.z, rot: ed.rot, style: def.style, label: def.note, door: { color: def.color } });
      g.reserve(ed.i, ed.j);
    } else {
      const cell = pickFreeCell(g, rng);
      if (!cell) continue;
      kit.exit(b, { to: def.to, kind: 'zone', x: cell.x, z: cell.z, radius: 1.1, marker: true, label: def.note });
      decorateForestDoor(b, cell.x, cell.z, rng);
      g.reserve(cell.i, cell.j);
    }
  }
}

// ---------- 灯光（主厅/客房走廊）----------
// 依据：lighting「主厅墙上的古董烛台，部分是烛台模样的电灯，持续发出和 Level 0 荧光灯相似的嗡嗡声」
// kit 没有壁挂烛台构件，用天花板灯盘近似并调暖金色调，"嗡嗡声"由 env.audio 的整体环境声层表现（见 apiRequests）
function decorateLighting(b, g, rng, kind) {
  for (let j = 0; j < g.rows; j += 2) {
    for (let i = 0; i < g.cols; i += 2) {
      const r = rng();
      const state = r < 0.06 ? 'broken' : r < 0.16 ? 'flicker' : 'on';
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, {
        y: b.height, w: 0.5, d: 0.5, state, flicker: 0.25 + rng() * 0.35,
        color: 0xffdca0, intensity: kind === 'corridor' ? 0.75 : 0.95, range: 6,
      });
      // 依据：hazards「大量死亡飞蛾从黑暗房间飞出占据大厅」——熄灯格点小概率长出巢状土堆，暗示这就是"黑暗房间"蛾巢
      if (state === 'broken' && rng() < 0.3) b.box(c.x + 0.3, 0.12, c.z + 0.2, 0.5, 0.24, 0.45, 'kit:prop', { color: 0x463a26 });
    }
  }
}

// ---------- 客房走廊：少数带家具的客房 + 沿墙的金色门牌客房门 ----------
// 依据：landmarks「客房门：金色标牌，房号随机；大多锁着，有些会随时间解锁，有些会随机开关」；
//   architecture「大多数房间是空的，少数有齐全家具，可以在里面生活」
function decorateCorridorRoom(b, g, rng) {
  if (rng() < 0.28) {
    g.carve(3, 3, 2, 2, { room: true });
    const c = g.center(3, 3);
    kit.prop.bed(b, c.x, c.z, 0, {});
    kit.prop.desk(b, c.x + 1.1, c.z - 1.0, Math.PI / 2, {});
    const edges = g.edges({ wall: false, interior: true }).filter(e =>
      (e.axis === 'h' && e.i >= 3 && e.i < 5 && (e.j === 3 || e.j === 5)) ||
      (e.axis === 'v' && e.j >= 3 && e.j < 5 && (e.i === 3 || e.i === 5)));
    if (edges.length) { const ed = edges[Math.floor(rng() * edges.length)]; kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'wood', sign: 0xd4af37, solid: false }); }
  }
  // 金色标牌客房门：门本身没有运行时开合/上锁状态切换 API（kit 没有对应能力，见 apiRequests），
  // 只在建块时用随机数决定每扇门是否可通行，近似"大多锁着、少数解锁"的静态快照
  const wallEdges = g.edges({ wall: true, interior: true });
  const doorCount = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < doorCount && wallEdges.length; k++) {
    const ed = wallEdges[Math.floor(rng() * wallEdges.length)];
    const unlocked = rng() < 0.25;
    kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'wood', sign: 0xd4af37, solid: !unlocked, color: 0x5a3d22 });
  }
}

// ---------- 主厅地标：M.E.G. 哨所侧 / 家常酒店 / 失落的大厅协会（图书馆一侧）----------
// 用户固定规则：据点/M.E.G. 前哨只摆静态建筑与标记，不做交易与交互；NPC 对话不做
function decorateHallLandmark(b, g, rng) {
  const pick = U.weighted(rng, [['none', 0.82], ['megoutpost', 0.06], ['homehotel', 0.06], ['library', 0.06]]);
  if (pick === 'none') return;
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  if (pick === 'megoutpost') {
    // 依据：landmarks「酒店里被 M.E.G. 看护的一侧（通往 Level 171）」；bases「M.E.G. 哨所"家政服务"」
    kit.prop.crate(b, cell.x - 0.5, cell.z, 0, { color: 0x3d4a3a });
    kit.prop.crate(b, cell.x + 0.5, cell.z - 0.3, Math.PI / 5, { color: 0x333d33 });
    kit.prop.sign(b, cell.x, cell.z + 0.8, 0, { color: 0x3fa0ff, backColor: 0x1a2430 });
    kit.exit(b, { to: '171', kind: 'door', x: cell.x, z: cell.z - 0.9, rot: Math.PI, style: 'metal', label: '被 M.E.G. 看护的一侧 (exits[10])', door: { color: 0x555b5f } });
  } else if (pick === 'homehotel') {
    // 依据：landmarks「主厅里家常酒店的独特标识和营业区」；bases「家常酒店：提供食物和客房服务保证安全，需填申请入住」
    // ——交易/入住交互属于用户规则里"上线大厅后再做"的交易系统，这里只摆前台外观
    kit.prop.desk(b, cell.x, cell.z, 0, { monitor: false });
    kit.prop.chair(b, cell.x, cell.z + 1.0, Math.PI, {});
    kit.prop.sign(b, cell.x, cell.z - 0.75, 0, { color: 0xd4af37, backColor: 0x241a10 });
  } else if (pick === 'library') {
    // 依据：landmarks「本层靠近图书馆的一侧（失落的大厅协会所在地）」；bases「以大量书籍、地图等收藏闻名」
    kit.prop.cabinet(b, cell.x - 0.6, cell.z, Math.PI / 2, { kind: 'file', h: 1.8 });
    kit.prop.cabinet(b, cell.x + 0.6, cell.z, -Math.PI / 2, { kind: 'file', h: 1.8 });
  }
  g.reserve(cell.i, cell.j);
}

// ---------- 贝弗莉室：小桌+麻将+饮料+巨大吊灯+许多装饰门（低概率出现通往 Level 84 的巨门）----------
function decorateBeverly(b, g, rng, height) {
  const S = b.size, cx = S / 2, cz = S / 2;
  // 依据：landmarks「贝弗莉室中间的小桌：许多饮料和一盘未打完的麻将，巨大吊灯」——kit 没有圆桌构件，用矮方桌近似
  kit.prop.desk(b, cx, cz, 0, { w: 1.1, d: 1.1, h: 0.55, color: 0x3d2a1c });
  b.box(cx, 0.565, cz, 0.55, 0.02, 0.55, 'kit:prop', { color: 0x171512 });
  for (let k = 0; k < 10; k++) {
    const a = rng() * Math.PI * 2, rr = 0.08 + rng() * 0.18;
    b.box(cx + Math.cos(a) * rr, 0.585, cz + Math.sin(a) * rr, 0.045, 0.025, 0.032, 'kit:prop', { color: 0xe9e2c8, rotY: rng() * Math.PI });
  }
  for (let k = 0; k < 5; k++) {
    const a = rng() * Math.PI * 2, rr = 0.35 + rng() * 0.18;
    b.cylinder(cx + Math.cos(a) * rr, 0.565, cz + Math.sin(a) * rr, 0.032, 0.1, 'kit:prop', { color: 0x203a14 + (rng() * 0x040404 | 0) });
  }
  // 巨大吊灯：单盏高亮暖光覆盖整间房，层高已拉到 H_TALL 呼应"巨大"体量感
  b.light({ x: cx, y: height - 0.35, z: cz, color: 0xffd9a0, intensity: 1.8, range: 15, flicker: 0.03 });
  b.cylinder(cx, height - 0.5, cz, 0.5, 0.35, 'kit:glow', { rTop: 0.15, uv: 'solid', color: [1.7, 1.3, 0.7], glow: 1.4 });
  for (let arm = 0; arm < 6; arm++) {
    const a = (arm / 6) * Math.PI * 2;
    b.cylinder(cx + Math.cos(a) * 0.35, height - 0.75, cz + Math.sin(a) * 0.35, 0.02, 0.35, 'kit:prop', { axis: 'y', color: 0x7a6438 });
  }

  // 依据：landmarks「非常宽敞…很多门，通向主厅（最常见）或锅炉房」——沿墙摆一圈闭合的装饰门，紧贴既有边界墙，
  // 不新开墙洞（边界墙不能被特殊区块改动，_TEMPLATE.md 7.2 节）；其中一处低概率换成真出口（exits[9]「见到它的概率很低」）
  const doorSpots = [
    { x: 4, z: 0.25, rot: 0 }, { x: S - 4, z: 0.25, rot: 0 },
    { x: 4, z: S - 0.25, rot: Math.PI }, { x: S - 4, z: S - 0.25, rot: Math.PI },
    { x: 0.25, z: S / 2 - 4, rot: Math.PI / 2 }, { x: S - 0.25, z: S / 2 + 4, rot: -Math.PI / 2 },
  ];
  const bigDoorIdx = rng() < 0.35 ? Math.floor(rng() * doorSpots.length) : -1;
  doorSpots.forEach((sp, idx) => {
    const style = rng() < 0.5 ? 'wood' : 'metal';
    if (idx === bigDoorIdx) {
      kit.exit(b, {
        to: '84', kind: 'door', x: sp.x, z: sp.z, rot: sp.rot, style: 'wood',
        label: '贝弗莉室的巨大木门 (exits[9])', door: { w: 1.8, h: height - 0.5, color: 0x4a2f1a },
      });
    } else {
      kit.prop.door(b, sp.x, sp.z, sp.rot, { style, solid: false, color: 0x4a3320 });
    }
  });
}

// ---------- 锅炉房：机器管道+维护电梯+街机(→40)+气闸门(→78)+深处极端高温(→6) ----------
function decorateBoiler(b, g, rng, height) {
  const S = b.size;
  // 依据：materials「大量旧机器和老式机械，墙上交织缠绕的大型工业管道，排气阀，多数房间有烧水锅炉，部分有熔炉」
  for (const p of g.pillars) {
    const c = g.center(p.i, p.j);
    if (rng() < 0.7) b.cylinder(c.x, 0, c.z, 0.55, height - 0.3, 'L5:boilerWall', { segments: 10 });
    else kit.prop.pipe(b, c.x, c.z, 0, { axis: 'y', length: height - 0.4, r: 0.09, color: 0x4a4a44 });
  }
  const wallEdges = g.edges({ wall: true, interior: false });
  for (let k = 0; k < 6 && wallEdges.length; k++) {
    const ed = wallEdges[Math.floor(rng() * wallEdges.length)];
    kit.prop.pipe(b, ed.x, ed.z, ed.rot, { axis: 'x', y: height - 0.6 - rng() * 0.8, length: 1.6 + rng(), color: 0x55524a });
  }
  // 依据：hazards「锅炉房管道因水压漏水，空气里充满蒸汽」+ mechanics「自我清洁：脏污几分钟后消失」
  // ——用这一处漏水水坑同时体现两条描述：水坑本身是漏水，定期隐去又出现是"自我清洁"周期（kit 没有专门的"脏污"构件，
  // 全层只有这一处可视化这条机制，非设定精确周期）
  const pd = kit.prop.puddle(b, 10, 16, 0, { rx: 1.0, rz: 0.7 });
  b.update((dt, t) => { pd.piece.setVisible((t % 240) < 200); });

  // 维护电梯（landmarks「锅炉房的维护电梯（不建议使用）」）——只做外观+警示牌，不额外做危害（原文没写不建议使用的具体后果）
  kit.prop.elevator(b, S - 0.3, 5, -Math.PI / 2, { w: 1.1, h: 1.9, indicator: 0xff5030, interior: 0x1a1410 });
  kit.prop.sign(b, S - 1.1, 5, -Math.PI / 2, { color: 0xff4020, w: 0.4, h: 0.12 });

  // 街机游戏机（landmarks「锅炉房的街机游戏机（通往 Level 40）」）——kit 没有街机构件，自拼
  const ax = 0.3, az = 19;
  b.box(ax + 0.28, 0.55, az, 0.5, 1.1, 0.55, 'kit:prop', { color: 0x2a2a30, rotY: Math.PI / 2 });
  b.plane(ax + 0.55, 1.15, az, 0.4, 0.32, 'kit:glow', { facing: '+x', uv: 'solid', color: [0.3, 1.2, 0.9], glow: 1.2 });
  kit.exit(b, { to: '40', kind: 'zone', x: ax + 0.9, z: az, radius: 0.9, marker: true, label: '锅炉房的街机游戏机 (exits[7])' });

  // 气闸门大门（landmarks「锅炉房里类似气闸门的大门（通往 Level 78）」）——处于开阔区域中央，没有背靠边界墙，
  // 用门自带的 wall 选项现拼一小截墙（_TEMPLATE.md 9 节），kit 没有专门的气闸样式，用加粗金属门近似
  kit.exit(b, {
    to: '78', kind: 'door', x: 14, z: 8, rot: 0, style: 'metal',
    label: '锅炉房的气闸式大门 (exits[8])',
    door: { w: 1.6, h: height - 0.6, color: 0x3a3d40, wall: { matKey: 'L5:boilerWall', w: 2.4, h: height } },
  });

  // 深处极端高温（hazards「深入锅炉房：通常极端高温，极度不建议从这里去 Level 6」）——房间最深角落放出口，
  // 持续高温伤害在 level.update 里按玩家所在宏格判定（见下方 update，不依赖这个具体坐标）
  b.plane(S - 3, 0.02, S - 3, 2.4, 2.4, 'kit:glow', { facing: 'up', uv: 'solid', color: [1.6, 0.35, 0.1], glow: 0.65 });
  kit.exit(b, { to: '6', kind: 'zone', x: S - 3, z: S - 3, radius: 1.3, marker: true, label: '深入锅炉房的极端高温区 (exits[2])' });
}

// ---------- 区块 ----------
// rng 消耗顺序固定：区块类型(仅普通块) → 格子内部 → 楼层地板色调(非锅炉) → 灯光/装饰 → 出口
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const lm = isSpawn ? null : landmarkAt(ctx.levelSeed, cx, cz);
  const kind = lm || (isSpawn ? 'hall' : U.weighted(rng, [['hall', P_HALL], ['corridor', 1 - P_HALL]]));
  const height = (kind === 'beverly' || kind === 'boiler') ? H_TALL : H;

  const b = kit.builder(ctx, cx, cz, rng, { height });
  const gopts = kind === 'boiler' ? BOILER : kind === 'beverly' ? BEVERLY : kind === 'corridor' ? CORRIDOR : HALL;
  const g = kit.grid(b, N, N, gopts);

  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J);
    g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  } else if (kind === 'beverly') {
    g.carve(0, 0, N, N, { room: true });                       // 依据：「贝弗莉室…非常宽敞」——整块清空
  } else if (kind === 'boiler') {
    g.carve(0, 0, N, N, { room: true, keepPillars: true });    // 依据：「锅炉房空间很大，但被旧机器和管道塞满」——留柱子当机器占位
  }

  let floorTint;
  const wallKey = kind === 'boiler' ? 'L5:boilerWall' : 'L5:wall';
  const floorKey = kind === 'boiler' ? 'L5:boilerFloor' : 'L5:floor';
  if (kind !== 'boiler') {
    // 依据：materials「地板有黑胡桃木、白色大理石、异国情调的红金色地毯」——三者没给比例，等权随机，
    // 用同一张红金地毯贴图配合顶点色染色近似木纹（深棕）/大理石（浅灰白），kit 没有单独的木纹/大理石贴图（见 apiRequests）
    const ft = U.weighted(rng, [['walnut', 1], ['marble', 1], ['carpet', 1]]);
    floorTint = ft === 'walnut' ? 0x2a1912 : ft === 'marble' ? 0xe7e1d2 : undefined;
  }

  kit.gridWalls(b, g, { matKey: wallKey, trim: kind === 'boiler' ? false : { color: 0x3b2013 } });
  // 依据：colors「墙纸为红木色和金色」——踢脚线取深红木色；本层墙纸不是用户规定套黄木踢脚线的那种黄色墙纸
  kit.prop.floor(b, null, null, 0, { matKey: floorKey, color: floorTint });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L5:ceiling', y: height });

  if (kind === 'hall' || kind === 'corridor') decorateLighting(b, g, rng, kind);
  else if (kind === 'beverly') decorateBeverly(b, g, rng, height);
  else if (kind === 'boiler') decorateBoiler(b, g, rng, height);

  if (kind === 'corridor' && !isSpawn) decorateCorridorRoom(b, g, rng);
  if (kind === 'hall' && !isSpawn) decorateHallLandmark(b, g, rng);

  // 灯光同步闪烁出现的木门（mechanics「周围灯光同时闪烁时会出现一扇木制的门」，exits[6] 通往 Level 427）
  // ——门放在既有的迷宫内墙上（真实碰撞不变），默认不激活、门扇隐藏；level.update 按全层计时统一显隐/开放
  if (kind === 'hall' && !isSpawn && rng() < 0.12) {
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed) {
      const h = kit.exit(b, {
        to: '427', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'wood', active: false,
        tag: 'l5-flicker-door', label: '灯光同步闪烁时出现的木门 (exits[6])', door: { solid: false, color: 0x4a2f1a },
      });
      if (h.parts && h.parts.leaf) h.parts.leaf.setVisible(false);
      g.reserve(ed.i, ed.j);
    }
  }

  if (isSpawn) {
    // 依据：entrances「从 Level 4：找到并进入一段老旧楼梯」；exits[0]「转身回到带你进来的楼梯」
    const sc = g.center(SPAWN_I, SPAWN_J);
    kit.exit(b, { to: '4', kind: 'stairs', x: sc.x + 1.0, z: sc.z - 1.0, rot: 0, stairs: { down: false }, label: '转身回到带你进来的楼梯 (exits[0])' });
  } else if (kind === 'hall' || kind === 'corridor') {
    buildExits(b, g, rng, kind);
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态与危害（enter/update/leave）----------
const S = { timer: 0, heatTick: 0, mahjongTimer: 0, mahjongTick: 0, flickerEpoch: -1, flickerActive: false, flickerUntil: 0 };
const BOILER_HEAT_TICK = 1;      // 依据：temperature「锅炉房温度相当高…深入锅炉房通常有极端高温」——按秒计的持续伤害节拍，数值非设定
const FLICKER_EPOCH = 50;        // 依据：mechanics「周围灯光同时闪烁时会出现一扇木门」——没给触发频率，取不过分打扰的巡检间隔，非设定
const FLICKER_CHANCE = 0.35;
const FLICKER_DUR = 5;
const MAHJONG_GRACE = 8;         // 依据：hazards「麻将：想打完的人会感到被迫远离它」——给一点缓冲时间再开始施压，非设定

BR.levels.register({
  id: '5', name: 'Level 5', title: '恐怖旅馆', nickname: '恐怖旅馆',
  version: 'wikidot-cn',
  survivalClass: '生存难度 等级 2',
  chunkSize: SIZE,
  env: {
    background: 0x2a1810, fogColor: 0x2a1810, fogNear: 6, fogFar: 40,
    ambient: { color: 0xffd9a0, intensity: 0.4 },
    // 依据：other「有看不见的东西在角落监视、背后耳语、独处时被拍肩、老画像的眼睛一直看着人」
    // ——比中性基线略高的偏执氛围，但生存难度只是等级 2，不套用高危层级的倍率
    sanityDrainMul: 1.15,
    hungerDrainMul: 1,
    // 依据：sounds「老式唱片机一直播放优雅的爵士乐…墙另一边的聚会闲聊声」——现有预设里 party 最贴合
    audio: 'party',
    darkness: false,
  },
  spawn() {
    // 依据：entrances「从 Level 4：找到并进入一段老旧楼梯」——出生点设在楼梯旁的小房间
    return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 };
  },
  buildChunk,
  entities: [
    // 死亡飞蛾例外：entityDensityOverall 明确「大量的死亡飞蛾在本层里筑巢安家；本层是其核心巢穴之一」，
    // 局部可视为 high(0.9)；雌性「在本层级确实更加常见」→ 雌性权重更高
    { type: 'deathmoth_female', officialPer1000m2: 0.55 },
    { type: 'deathmoth_male', officialPer1000m2: 0.35 },
    // 其余"普通实体"共享 entityDensityOverall=low(0.12)：wikidot-cn 明确列出「已知出现在 Level 5 的其他实体」7 种
    // （猎犬/木灵/窃皮者/观察者/Nguithr'xurh/啼物/尸鼠）按同等权重瓜分主要份额（0.014×7=0.098）；
    // 蚂蚁(Entity 89)和牧蛇(Entity 75)原文只写"有报告/观察报告"、不算已确认目击，份额更小（0.01 + 0.012 = 0.022）；
    // 合计 0.098+0.022=0.12，对应 entityDensityOverall 的 low
    { type: 'hound', officialPer1000m2: 0.014 },
    { type: 'woodlin', officialPer1000m2: 0.014 },
    { type: 'skin_stealer', officialPer1000m2: 0.014 },
    { type: 'watcher', officialPer1000m2: 0.014 },
    { type: 'nguithrxurh', officialPer1000m2: 0.014 },
    { type: 'growler', officialPer1000m2: 0.014 },
    { type: 'death_rat', officialPer1000m2: 0.014 },
    { type: 'ant', officialPer1000m2: 0.01 },
    // 牧蛇雌雄二态分开注册（js/entities/wrangler.js：雄性敌对为主要威胁形态，雌性中立退避），
    // 把上面的 0.012 份额按同一比例（雄多雌少）再拆开，不重复计
    { type: 'wrangler_male', officialPer1000m2: 0.007 },
    { type: 'wrangler_female', officialPer1000m2: 0.005 },
    // 萨曼莎（Entity 26）：主厅「偶尔」游荡的具名个体，原文没有敌意描述，不计入"普通实体"总量，取独立的低密度
    { type: 'samantha', officialPer1000m2: 0.01 },
  ],
  items: [
    // 全部取自 data/item-spawn.json 里 levels 含 '5' 且 js/items/<key>.js 已存在的条目，per1000m2 直接取该文件的值
    { type: 'almond_water', per1000m2: 1.2 },              // 用户规则：所有模式都刷；依据 items「似乎流过锅炉房的管道」
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'soft_drink', per1000m2: 0.8 },                // 依据：items「饮料：贝弗莉室小桌上，许多」——item-spawn.json 明确点名 Level 5 贝弗莉
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.01 },               // 依据：本层是死亡飞蛾核心巢穴之一，item-spawn.json 把 moth_jelly 分给了有死亡飞蛾的层级
    { type: 'high_quality_meat', per1000m2: 0.05 },        // 依据：mechanics「想接近萨曼莎要带优质的肉」
    { type: 'food_ration', per1000m2: 0.6 },               // 用户规则：所有模式都刷食物
  ],
  exits: [
    { to: '4', kind: 'stairs', note: '转身回到带你进来的楼梯，出生点附近 (exits[0])' },
    { to: '3', kind: 'elevator', note: '回到电梯；仅主厅区块小概率出现 (exits[1])' },
    { to: '6', kind: 'zone', note: '深入锅炉房；极度不建议，通常极端高温 (exits[2])' },
    { to: '9', kind: 'door', note: '打开一扇深色木门，原文未指明区域 (exits[3])' },
    { to: '63', kind: 'zone', note: '找到一扇开着、显现森林景象的门 (exits[4])' },
    { to: '98', kind: 'door', note: '进入主厅里的金属门 (exits[5])' },
    { to: '427', kind: 'door', note: '周围灯光同时闪烁时出现的木门；需灯光同步闪烁触发 (exits[6])' },
    { to: '40', kind: 'zone', note: '在锅炉房玩街机游戏机 (exits[7])' },
    { to: '78', kind: 'door', note: '进入锅炉房里类似气闸门的大门 (exits[8])' },
    { to: '84', kind: 'door', note: '穿过贝弗莉室的巨大木门；出现概率很低 (exits[9])' },
    { to: '171', kind: 'door', note: 'Level 171 不在首期范围，只提示尚未开放；进入酒店里被 M.E.G. 看护的一侧 (exits[10])' },
  ],
  enter(ctx) {
    Object.assign(S, { timer: 0, heatTick: 0, mahjongTimer: 0, mahjongTick: 0, flickerEpoch: -1, flickerActive: false, flickerUntil: 0 });
  },
  update(ctx, dt) {
    S.timer += dt;
    const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
    const lm = (cc.cx === 0 && cc.cz === 0) ? null : landmarkAt(ctx.levelSeed, cc.cx, cc.cz);

    // ---------- 锅炉房高温（hazards「锅炉房通常极端高温」）----------
    if (lm === 'boiler') {
      S.heatTick += dt;
      if (S.heatTick >= BOILER_HEAT_TICK) {
        S.heatTick = 0;
        if (BR.game.attackPlayers) BR.player.damage({ hp: 1, sanity: 0.4, source: 'hazard:boiler-heat' });
      }
    } else S.heatTick = 0;

    // ---------- 麻将逼人远离（hazards「麻将：想打完的人会感到被迫远离它」）----------
    if (lm === 'beverly') {
      const tx = cc.cx * SIZE + SIZE / 2, tz = cc.cz * SIZE + SIZE / 2;
      const dx = BR.player.x - tx, dz = BR.player.z - tz;
      if (dx * dx + dz * dz < 1.0) {
        S.mahjongTimer += dt;
        if (S.mahjongTimer > MAHJONG_GRACE) {
          S.mahjongTick += dt;
          if (S.mahjongTick >= 1) {
            S.mahjongTick = 0;
            BR.hud.toast('一股说不清的冲动催你离开这张桌子……', 2200);
            if (BR.game.attackPlayers) BR.player.damage({ hp: 0, sanity: 1.2, source: 'hazard:mahjong' });
          }
        }
      } else { S.mahjongTimer = 0; S.mahjongTick = 0; }
    } else { S.mahjongTimer = 0; S.mahjongTick = 0; }

    // ---------- 灯光同步闪烁 → 出现木门（exits[6]）----------
    const epoch = Math.floor(S.timer / FLICKER_EPOCH);
    if (epoch !== S.flickerEpoch) {
      S.flickerEpoch = epoch;
      const r = U.rng(ctx.levelSeed, 'L5-flicker', epoch);
      if (!S.flickerActive && r() < FLICKER_CHANCE) { S.flickerActive = true; S.flickerUntil = S.timer + FLICKER_DUR; }
    }
    if (S.flickerActive) {
      const on = Math.floor(S.timer * 8) % 2 === 0;
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) {
        if (l._l5orig === undefined) l._l5orig = l.intensity;
        l.intensity = on ? l._l5orig : 0;
      }
      for (const h of BR.kit.handles({ tag: 'l5-flicker-door' })) {
        if (!h.active) { h.setActive(true); if (h.parts && h.parts.leaf) h.parts.leaf.setVisible(true); }
      }
      if (S.timer >= S.flickerUntil) {
        S.flickerActive = false;
        for (const c of BR.world.chunks()) for (const l of (c.lights || [])) if (l._l5orig !== undefined) l.intensity = l._l5orig;
        for (const h of BR.kit.handles({ tag: 'l5-flicker-door' })) { h.setActive(false); if (h.parts && h.parts.leaf) h.parts.leaf.setVisible(false); }
      }
    }
  },
  leave(ctx) {
    if (S.flickerActive) {
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) if (l._l5orig !== undefined) l.intensity = l._l5orig;
    }
    S.flickerActive = false;
    BR.hud.prompt(null);
  },
});
})();

// ============================================================
// 待实现物品（选中版本 items[] 里提到、但 js/items/ 还没有对应文件，本层没有加进 items 表）：
//   未打完的麻将（贝弗莉室小桌上的叙事道具，已用场景几何表现，没有可拾取的 item 文件）；
//   书籍、地图和其他知识媒介（失落的大厅协会的收藏，已用文件柜场景几何表现，没有对应 item 文件）；
//   饮料本身没有独立于 soft_drink 的物品文件，已用 soft_drink 覆盖"贝弗莉室饮料"这条描述。
// ============================================================
