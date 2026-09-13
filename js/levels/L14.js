// Level 14 "Inhospitality"（标题/别称见选中版本 title/nickname）
// 来源版本：fandom  URL：https://web.archive.org/web/2025/https://backrooms.fandom.com/wiki/Level_14  许可：CC BY-SA 3.0
// 抓取：2026-09-12（web.archive.org 快照 20251228124449，另用 fandom api.php 当前 wikitext 比对，内容一致）
// 只按这个版本实现：不做 wikidot-en/cn「天堂」版本的夜间森林绿洲、猩红草、模因诱惑、孩子们/集体"我们"，
//   也不做中文 fandom 译本《孤冷医院》独有的绿色气体/怪异粘液、六七面墙的储藏室、Level 268 之外的漏译出口——
//   这些都不属于选中的 fandom(英文) 版本（data/lore-choices.json levels["14"].conflicts）。
// 用户规则例外提醒：本层与后室社区最知名的"Level 14 = Paradise"（wikidot 版本，夜间森林+孩子们）完全不符——
//   随机结果选中的是 fandom 的「Inhospitality」（废弃医院+The Hunter），玩家印象中的经典 Level 14 形象在本实现里不存在。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：scale「infinitely segmented areas / vast expansiveness」，没有具体尺寸（unverified）——沿用室内迷宫默认尺度
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.8;   // 层高原文未给数字（unverified），用 kit 默认层高
const SPAWN_X = SIZE / 2, SPAWN_Z = SIZE * 0.32;

// ---------- 布局：走廊迷宫为主，按概率抽取房间主题（宏观概率非设定精确数字，只是让"手术室很难找到"这类定性描述可感知）----------
const EDGE = { salt: 'L14', boundaryDensity: 0.38, straightness: 0.6, minOpenings: 2 };
const ROOMY = Object.assign({ wallDensity: 0.42, roomChance: 0.22, maxRooms: 1, roomSize: [2, 2], loopChance: 0.5, pillarChance: 0.02 }, EDGE);
const OPEN = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0 }, EDGE);

function mod(n, m) { return ((n % m) + m) % m; }

// 依据：exits[1]「顺着地板箭头走到医院主出口，回到 Level 130」——每 4 块周期重复，保证任意位置 3-5 块内能找到（规则②）
const MAIN_EXIT_MOD = 4, MAIN_EXIT_OFS = 2;
// 依据：exits[2]「穿过一扇罕见的未来风格的门→Level 15」——比主出口更少见的周期（每 5 块）
const RARE_DOOR_MOD = 5, RARE_DOOR_OFS_X = 1, RARE_DOOR_OFS_Z = 3;
// 依据：exits[3]「在医院里走得太深→Level 16」（距离触发）——离出生点 ≥9 块后，按概率整块铺大半径 zone（规则②"走得够远就离开"的写法）
const DEEP_MIN_DIST = 9, DEEP_CHANCE = 0.3;

// 验收①修复：四种房型统一的房间矩形（格子坐标），buildChunk 必须在 kit.gridWalls 之前用它 carve——
// gridWalls 一跑完，墙就已经变成实体几何+碰撞盒，decorate* 里原来的 g.carve 只改得动 grid 数据，改不动已经建好的墙
const ROOM_RECT = {
  inpatient: { i0: 3, j0: 3, w: 3, d: 2 },
  storage: { i0: 3, j0: 3, w: 3, d: 2 },
  surgery: { i0: 3, j0: 3, w: 2, d: 2 },
  torture: { i0: 3, j0: 3, w: 3, d: 2 },
};

// 依据：entities[0].density「one of the only entities that resides in Level 14」+ landmarks/hazards 各类房间描述，
// 按定性权重瓜分：走廊(默认)最多，住院病房较常见，储藏室/手术室/刑讯室依描述"难找/罕见"依次调低
function chunkPlan(levelSeed, cx, cz) {
  const isMainExit = mod(cx, MAIN_EXIT_MOD) === MAIN_EXIT_OFS && mod(cz, MAIN_EXIT_MOD) === MAIN_EXIT_OFS;
  const isRareDoor = mod(cx, RARE_DOOR_MOD) === RARE_DOOR_OFS_X && mod(cz, RARE_DOOR_MOD) === RARE_DOOR_OFS_Z;
  const dist = Math.max(Math.abs(cx), Math.abs(cz));
  const r = U.rng(levelSeed, 'L14-kind', cx, cz);   // 派生流，与区块主 rng 无关，level.update 里可独立重算（TEMPLATE 4.2 节）
  const rDeep = r();                                 // 先无条件取（4.2 节），是否使用取决于下面的距离判定
  if (isMainExit || isRareDoor) return { kind: 'corridor', toxic: false, special: isMainExit ? 'mainExit' : 'rareDoor' };
  if (!isMainExit && !isRareDoor && dist >= DEEP_MIN_DIST && rDeep < DEEP_CHANCE) return { kind: 'deepzone', toxic: false, special: null };
  const kind = U.weighted(r, [['corridor', 0.58], ['inpatient', 0.20], ['storage', 0.10], ['surgery', 0.07], ['torture', 0.05]]);
  // 依据：hazards「污染房间：充满有毒的放射性物质」——没给具体房型/概率，取普通房间里的一小部分
  const toxic = (kind === 'inpatient' || kind === 'storage' || kind === 'surgery') && r() < 0.12;
  return { kind, toxic, special: null };
}

function nearestMainExitDelta(cx, cz) {
  const near = n => { const lo = Math.floor((n - MAIN_EXIT_OFS) / MAIN_EXIT_MOD) * MAIN_EXIT_MOD + MAIN_EXIT_OFS, hi = lo + MAIN_EXIT_MOD; return Math.abs(n - lo) <= Math.abs(n - hi) ? lo : hi; };
  return { dx: near(cx) - cx, dz: near(cz) - cz };
}

// ---------- 材质 ----------
// 依据：materials「原文没提走廊墙面材质」；配图观察 Level14picture2（非原文文字，同一 fandom 页面配图）：
// 米色/桃色墙面、浅色反光地胶+红色标记——生成 l14_wall_hospital / l14_floor_hospital 两张贴图，其余变体靠 color 染色复用
function defineMaterials() {
  kit.mats({
    'L14:wallCorridor': { tex: 'l14_wall_hospital', repeatMeters: 2.4, roughness: 0.9 },
    // 依据：colors「住院病房的家具和设备都是刺眼的白，带少量锈蚀和苔藓」——墙面同贴图调白
    'L14:wallWard': { tex: 'l14_wall_hospital', repeatMeters: 2.4, roughness: 0.85, color: 0xf1ede6 },
    // 依据：materials「储藏室：墙体不对称，像胡乱拼起来的」——取更冷更脏的灰调
    'L14:wallStorage': { tex: 'l14_wall_hospital', repeatMeters: 2.6, roughness: 0.95, color: 0xafa89c },
    // 依据：materials「墙和天花板上往下滴深色液体，已证实是血」——取脏污暗红棕
    'L14:wallTorture': { tex: 'l14_wall_hospital', repeatMeters: 2.8, roughness: 1, color: 0x5c4642 },
    'L14:floor': { tex: 'l14_floor_hospital', repeatMeters: 2.2, roughness: 0.55 },
    // 依据：materials「刑讯室…大理石地板破碎」——没有单独大理石贴图，复用已有 concrete_wet 并染深红近似血污破碎地面（见 apiRequests）
    'L14:floorTorture': { tex: 'concrete_wet', repeatMeters: 2, roughness: 0.9, color: 0x3a1618 },
    'L14:ceiling': { tex: 'ceiling_tile', repeatMeters: 1.6, roughness: 1, color: 0xe6dccd },
    // 彩绘玻璃：单张不重复的纹理贴满整面门，uv:'stretch' 时 repeatMeters 不生效，写 1 只是占位
    'L14:stainedGlass': { tex: 'l14_stained_glass', repeatMeters: 1, roughness: 0.3 },
  });
}

// file:// 双击兜底（_TEMPLATE.md 第 15 节步骤 7）
BR.assets.registerProcedural('l14_wall_hospital', 256, (g, s) => {
  g.fillStyle = '#c8a898'; g.fillRect(0, 0, s, s);
  const r = U.rng('l14_wall_hospital');
  for (let k = 0; k < 500; k++) { const v = 150 + (r() * 40 | 0); g.fillStyle = `rgba(${v + 20},${v},${v - 10},0.15)`; g.fillRect(r() * s, r() * s, 3, 3); }
  g.strokeStyle = 'rgba(120,90,70,0.25)'; g.lineWidth = 1;
  for (let k = 0; k < 4; k++) { const x0 = r() * s; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + (r() - 0.5) * 30, s); g.stroke(); }
});
BR.assets.registerProcedural('l14_floor_hospital', 256, (g, s) => {
  g.fillStyle = '#b0aca4'; g.fillRect(0, 0, s, s);
  const r = U.rng('l14_floor_hospital');
  for (let k = 0; k < 600; k++) { const v = 150 + (r() * 30 | 0); g.fillStyle = `rgba(${v},${v},${v - 4},0.12)`; g.fillRect(r() * s, r() * s, 2, 2); }
  g.strokeStyle = 'rgba(150,50,40,0.3)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, s * 0.5); g.lineTo(s, s * 0.5); g.stroke();
});
// 验收⑥修复：彩绘玻璃旋转门原来是一整排整齐的纯色小方块，像告示板（规则⑤忌讳）——
// 改成递归切割出大小不一的铅条玻璃块，贴成一整张纹理（一次贴图，不再是几十个 box）
// 仓库里没有 l14_stained_glass.jpg，只用程序化画法：noFile 跳过文件探测，免得每次进层都报 404
BR.assets.registerProcedural('l14_stained_glass', 256, (g, s) => {
  g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, s, s);   // 铅条底色
  const r = U.rng('l14_stained_glass');
  const palette = ['#7a1c20', '#1c5e33', '#1c356b', '#7a5c18', '#4a1c5e', '#1c5c5c', '#8a6a1c'];
  function pane(x0, y0, x1, y1, depth) {
    const w = x1 - x0, h = y1 - y0;
    if (depth <= 0 || (w < 34 && h < 34)) {
      g.fillStyle = palette[(r() * palette.length) | 0];
      g.fillRect(x0 + 3, y0 + 3, Math.max(1, w - 6), Math.max(1, h - 6));
      g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2;   // 弧形高光，避免看起来是纯色块
      g.beginPath(); g.moveTo(x0 + w * 0.2, y0 + h * 0.8); g.quadraticCurveTo(x0 + w * 0.5, y0 + h * 0.1, x1 - w * 0.15, y0 + h * 0.35); g.stroke();
      return;
    }
    const t = 0.35 + r() * 0.3;
    if (w > h) { const cx0 = x0 + w * t; pane(x0, y0, cx0, y1, depth - 1); pane(cx0, y0, x1, y1, depth - 1); }
    else { const cy0 = y0 + h * t; pane(x0, y0, x1, cy0, depth - 1); pane(x0, cy0, x1, y1, depth - 1); }
  }
  pane(6, 6, s - 6, s - 6, 4);
  g.strokeStyle = '#0a0a0c'; g.lineWidth = 7; g.strokeRect(3, 3, s - 6, s - 6);
}, { noFile: true });

// ---------- 小工具 ----------
function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}
function roomOpenEdges(g, i0, j0, w, d) {
  return g.edges({ wall: false, interior: true }).filter(e =>
    (e.axis === 'h' && e.i >= i0 && e.i < i0 + w && (e.j === j0 || e.j === j0 + d)) ||
    (e.axis === 'v' && e.j >= j0 && e.j < j0 + d && (e.i === i0 || e.i === i0 + w)));
}
function roomWallEdges(g, i0, j0, w, d) {
  return g.edges({ wall: true, interior: true }).filter(e =>
    (e.axis === 'h' && e.i >= i0 && e.i < i0 + w && (e.j === j0 || e.j === j0 + d)) ||
    (e.axis === 'v' && e.j >= j0 && e.j < j0 + d && (e.i === i0 || e.i === i0 + w)));
}
// 依据：hazards「污染房间：充满有毒的放射性物质」——绿色低光地面雾斑近似，不是真实体积雾（引擎没有体积雾，见 apiRequests）
function toxicHaze(b, x, z) {
  b.plane(x, 0.04, z, 2.2, 2.2, 'kit:glow', { facing: 'up', uv: 'solid', color: [0.22, 0.5, 0.15], glow: 0.32 });
}

// ---------- 灯光 ----------
// 依据：lighting 原文「走廊阴暗(shadowy)」；配图观察 Level14picture1（非原文文字）「天花板嵌入式荧光灯板，大部分熄灭，只零星亮着几盏」
function decorateLighting(b, g, rng, kind) {
  const dim = kind === 'torture';
  for (let j = 0; j < g.rows; j += 2) {
    for (let i = 0; i < g.cols; i += 2) {
      const r = rng();
      const state = r < 0.5 ? 'broken' : r < 0.72 ? 'flicker' : 'on';
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, {
        y: b.height, w: 0.6, d: 0.5, state, flicker: 0.3 + rng() * 0.4,
        color: dim ? 0xffb0a0 : 0xd7ded2, intensity: dim ? 0.5 : 0.85, range: dim ? 4 : 6,
      });
    }
  }
}

// ---------- 出生点：接待室（唯一出生区块，本层不做为可重复的房间变体）----------
// 依据：landmarks「接待室：所有进入者最先抵达这里，荒凉空旷；只有椭圆形前台、几把椅子和一盏灯，让人不适；
//   后方的彩绘玻璃旋转门后面什么也看不见，相当于"出生点"」
function decorateReception(b, height) {
  const S = b.size, cx = S / 2, cz = S * 0.72;
  // kit 没有专门的椭圆前台构件，用加长办公桌近似（见 apiRequests）
  kit.prop.desk(b, cx, cz, 0, { w: 2.2, d: 0.9, h: 0.8, color: 0x8a8478, monitor: false });
  kit.prop.chair(b, cx - 0.7, cz + 0.9, Math.PI, { color: 0x55504a });
  kit.prop.chair(b, cx + 0.5, cz + 1.05, Math.PI * 0.85, { color: 0x55504a });
  kit.prop.chair(b, cx + 1.5, cz + 0.5, Math.PI * 0.7, { color: 0x55504a });
  // 原文强调"只有一盏灯"，营造空旷不安（依据：lighting「接待室有一盏灯」）
  b.light({ x: cx, y: height - 0.4, z: cz - 0.4, color: 0xffe3b0, intensity: 1.0, range: 7 });
  kit.prop.lightPanel(b, cx, cz - 0.4, 0, { y: height, w: 0.5, d: 0.5, state: 'on', color: 0xffe3b0, intensity: 1.0, range: 7 });
  // 大型彩绘玻璃旋转门，背后一片漆黑（依据：architecture「大型彩绘玻璃旋转门」；landmarks「后面什么也看不见」）
  // 验收⑥修复：原来摆在离南墙 1.44m 的半空中（S*0.94 vs 墙在 S），像飘浮的告示板——改成贴着南墙内壁，
  // 加一圈门框 + 中间两条竖框做出"旋转门有分扇"的轮廓，玻璃本体换成一整张不规则铅条纹理（见上面 registerProcedural）
  // kit 没有真正的旋转门构件，不做旋转/穿透机制，只做静态外观近似（见 apiRequests）
  const wallHalfT = 0.2 * 4 / 3 / 2;   // 与 kit.gridWalls 默认墙厚公式一致，贴着内壁摆才不会浮在半空
  const dz = S - wallHalfT - 0.08;
  const gw = 2.6, gh = height * 0.85, jw = 0.1, frameC = 0x241f1a;
  b.push(cx, dz, 0);
  b.box(-gw / 2 - jw / 2, 0, 0, jw, gh + jw, 0.14, 'kit:prop', { color: frameC, faces: 'noBottom' });
  b.box(gw / 2 + jw / 2, 0, 0, jw, gh + jw, 0.14, 'kit:prop', { color: frameC, faces: 'noBottom' });
  b.box(0, gh, 0, gw + jw * 2, jw, 0.14, 'kit:prop', { color: frameC });
  for (const fx of [-gw / 6, gw / 6]) b.box(fx, 0, 0.03, 0.05, gh, 0.05, 'kit:prop', { color: frameC });   // 旋转门扇之间的竖框，示意分扇而非真实机构
  b.pop();
  b.plane(cx, 0, dz + 0.03, gw - jw * 2, gh - jw, 'L14:stainedGlass', { facing: '+z', uv: 'stretch' });
}

// ---------- 住院病房 ----------
// 依据：landmarks「住院病房：内科/ICU/行为治疗/产科；病床、书桌、柜子和医疗设备都是刺眼的白，带少量锈蚀和苔藓；
//   是少数有（破碎）窗户的区域，窗外只有黑暗」
function decorateInpatient(b, g, rng, toxic) {
  // 验收①修复：carve 挪去 buildChunk 里 gridWalls 之前执行，这里只读同一份房间矩形
  const { i0, j0, w, d } = ROOM_RECT.inpatient;
  const x0 = i0 * g.cellW, z0 = j0 * g.cellD;
  // 验收⑤修复：床长 2m，原来贴着南/北墙线摆（z0+0.7、z0+d*cellD-0.7）会穿过房间边界墙，往房间内收到 1.2m 留出净空
  kit.prop.bed(b, x0 + 0.8, z0 + 1.2, 0, { color: 0xe9e6dc, frameColor: 0xb2ad9e });
  kit.prop.bed(b, x0 + 0.8, z0 + g.cellD * d - 1.2, Math.PI, { color: 0xe9e6dc, frameColor: 0xb2ad9e });
  kit.prop.desk(b, x0 + g.cellW * w - 0.9, z0 + 0.6, -Math.PI / 2, { color: 0xd7d2c2 });
  kit.prop.cabinet(b, x0 + g.cellW * w - 0.5, z0 + g.cellD * d - 0.6, Math.PI, { kind: 'wardrobe', w: 0.7, h: 1.7, color: 0xcac5b6 });
  if (rng() < 0.3) b.box(x0 + 0.25, 0.06, z0 + 1.5, 0.3, 0.05, 0.5, 'kit:prop', { color: 0x5a6b3c });   // 苔藓斑块（依据：colors「带少量锈蚀和苔藓」）
  const wallEdges = roomWallEdges(g, i0, j0, w, d);
  // 依据：exits[0]「待上一段时间后，可能会找到一扇明亮发光的窗户→Level 777」——777 不在首期范围，kit 自动 sealed，
  // 时间触发条件不影响玩法，这里只按小概率让某个房间的窗户外观是"发光"版本
  const glowWindow = rng() < 0.08;
  if (wallEdges.length) {
    const ed = wallEdges[Math.floor(rng() * wallEdges.length)];
    kit.prop.window(b, ed.x, ed.z, ed.rot, glowWindow
      ? { w: 1.0, h: 1.1, y: 1.0, tint: 0xfff6d8, glow: 0xfff6d8 }
      : { w: 1.0, h: 1.1, y: 1.0, blackout: true, tint: 0x050505 });
    if (glowWindow) {
      kit.exit(b, { to: '777', kind: 'zone', x: ed.x + Math.sin(ed.rot) * 0.5, z: ed.z + Math.cos(ed.rot) * 0.5, radius: 1.0, label: '明亮发光的窗户 (exits[0])' });
    }
  }
  const open = roomOpenEdges(g, i0, j0, w, d);
  if (open.length) { const ed = open[Math.floor(rng() * open.length)]; kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'wood', solid: false, color: 0x6a5a44 }); }
  if (toxic) toxicHaze(b, x0 + g.cellW * w / 2, z0 + g.cellD * d / 2);
}

// ---------- 储藏室 ----------
// 依据：landmarks「储藏室：墙体不对称，像胡乱拼起来的；里面有额外物资」
function decorateStorage(b, g, rng, toxic) {
  // 验收①⑤修复：主房间 + "不对称"凸起都挪去 buildChunk 里 gridWalls 之前 carve（原来的 1×1 carve 凿不动内部墙，
  // 见 buildChunk 里改成的 w+1×1），这里只读结果
  const { i0, j0, w, d } = ROOM_RECT.storage;
  const x0 = i0 * g.cellW, z0 = j0 * g.cellD;
  // 验收⑤修复：箱子原来撒在整个房间范围（含边界线上），改成离四周留 0.5m 净空，不再贴墙/穿墙
  for (let k = 0; k < 6; k++) {
    const x = x0 + 0.5 + rng() * (g.cellW * w - 1.0), z = z0 + 0.5 + rng() * (g.cellD * d - 1.0);
    if (rng() < 0.5) kit.prop.crate(b, x, z, rng() * Math.PI, { size: 0.6 + rng() * 0.3, color: 0x6b5a3e });
    else kit.prop.box(b, x, z, rng() * Math.PI, { stack: 1 + Math.floor(rng() * 2), color: 0x8a7a5a });
  }
  const open = roomOpenEdges(g, i0, j0, w, d);
  if (open.length) { const ed = open[Math.floor(rng() * open.length)]; kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'metal', solid: false, color: 0x5a5850 }); }
  if (toxic) toxicHaze(b, x0 + g.cellW * w / 2, z0 + g.cellD * d / 2);
}

// 依据：landmarks「手术室：通常只有一张倾斜的病床和一盏手术灯」——kit 床构件不能俯仰倾斜，
// 用一块四角高度不同的斜面板代替病床本体近似"倾斜"，非精确还原（见 apiRequests）
function surgeryTable(b, x, z) {
  const y0 = 0.5, y1 = 0.72;
  b.quad([x - 0.4, y0, z - 0.85], [x + 0.4, y0, z - 0.85], [x + 0.4, y1, z + 0.85], [x - 0.4, y1, z + 0.85], 'kit:prop', { color: 0xb7b2a6 });
  for (const [dx, dz, h] of [[-0.35, -0.75, y0], [0.35, -0.75, y0], [-0.35, 0.75, y1], [0.35, 0.75, y1]]) {
    b.box(x + dx, 0, z + dz, 0.05, h, 0.05, 'kit:prop', { color: 0x6b675e });
  }
}

// ---------- 手术室（罕见，本层太大而难找——用比其他房型更低的权重体现，见 chunkPlan）----------
function decorateSurgery(b, g, rng, toxic) {
  // 验收①修复：carve 挪去 buildChunk 里 gridWalls 之前执行
  const { i0, j0, w, d } = ROOM_RECT.surgery;
  const x0 = i0 * g.cellW, z0 = j0 * g.cellD, cx = x0 + g.cellW * w / 2, cz = z0 + g.cellD * d / 2, height = b.height;
  surgeryTable(b, cx, cz);
  // 手术灯（依据：landmarks「一盏手术灯」）
  b.light({ x: cx, y: height - 0.3, z: cz, color: 0xeaf3ff, intensity: 1.3, range: 5 });
  b.cylinder(cx, height - 0.42, cz, 0.22, 0.06, 'kit:glow', { uv: 'solid', color: [1.6, 1.7, 1.9], glow: 1.3 });
  b.cylinder(cx, height - 0.6, cz, 0.03, 0.3, 'kit:prop', { color: 0x8a8a86 });
  // 摆满破旧手术器械的架子（依据：materials）
  kit.prop.cabinet(b, x0 + 0.4, z0 + g.cellD * d - 0.4, 0, { kind: 'file', w: 0.6, h: 1.3, color: 0x8a7a68 });
  for (let k = 0; k < 3; k++) b.box(x0 + 0.25 + k * 0.13, 1.2, z0 + g.cellD * d - 0.65, 0.08, 0.03, 0.03, 'kit:prop', { color: 0x9a9a94 });
  if (rng() < 0.4) for (let k = 0; k < 2; k++) b.cylinder(x0 + 0.4 + k * 0.15, 1.25, z0 + g.cellD * d - 0.5, 0.03, 0.12, 'kit:prop', { color: 0x4a6a34 });   // 长着苔藓/植物的旧试管（依据：materials）
  if (rng() < 0.2) b.plane(x0 + g.cellW * w - 0.02, 1.3, z0 + 0.8, 0.35, 0.45, 'kit:prop', { facing: '+x', color: [0.9, 0.6, 0.7] });   // 偶见儿童海报（依据：materials）；装饰物，效果原文未说明
  const open = roomOpenEdges(g, i0, j0, w, d);
  // 依据：landmarks「门常关、很少上锁」——门扇默认关闭但可通行，kit 没有运行时开关状态（见 apiRequests）
  if (open.length) { const ed = open[Math.floor(rng() * open.length)]; kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'metal', solid: false, color: 0x8a8880 }); }
  if (toxic) toxicHaze(b, cx, cz);
}

// ---------- 刑讯室（The Hunter 的地盘，进入有持续危害，见 level.update）----------
// 依据：landmarks「锈蚀担架层层叠放；墙和天花板往下滴血；大理石地板破碎；金属柜里装着不锈钢刀和剃刀片」；
//   hazards「刑讯室：The Hunter 的地盘，无论如何都不能进」——引擎没有门锁运行时状态，用持续强力伤害近似"不能进"（见 apiRequests）
function decorateTorture(b, g, rng) {
  // 验收①修复：carve 挪去 buildChunk 里 gridWalls 之前执行
  const { i0, j0, w, d } = ROOM_RECT.torture;
  const x0 = i0 * g.cellW, z0 = j0 * g.cellD;
  for (let k = 0; k < 4; k++) b.box(x0 + 0.4, 0.1 + k * 0.22, z0 + 0.5, 1.7, 0.16, 0.6, 'kit:prop', { color: 0x5a3a2e, rotY: (rng() - 0.5) * 0.25 });
  kit.prop.cabinet(b, x0 + g.cellW * w - 0.4, z0 + 0.5, -Math.PI / 2, { kind: 'locker', w: 0.7, h: 1.6, color: 0x4a4a46 });
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI; b.box(x0 + g.cellW * w - 0.7 + Math.cos(a) * 0.18, 1.0 + k * 0.04, z0 + 0.5 + Math.sin(a) * 0.05, 0.16, 0.01, 0.02, 'kit:prop', { color: 0xc8c8c4, rotY: a }); }
  for (let k = 0; k < 3; k++) { const dx = rng() * g.cellW * w, dz = rng() * g.cellD * d; b.box(x0 + dx, b.height - 0.15, z0 + dz, 0.03, 0.15, 0.03, 'kit:prop', { color: 0x3a0808 }); }
  const open = roomOpenEdges(g, i0, j0, w, d);
  if (open.length) {
    const ed = open[Math.floor(rng() * open.length)];
    kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'metal', solid: false, color: 0x2a2624 });
    kit.prop.sign(b, ed.x + Math.sin(ed.rot) * 0.75, ed.z + Math.cos(ed.rot) * 0.75, ed.rot, { color: 0xff2010, backColor: 0x1a0505 });
  }
}

// ---------- 深处：走得太深触发 Level 16（规则②"走得够远就离开"整块铺 zone 出口）----------
function decorateDeepZone(b, rng) {
  const S = b.size, cx = S / 2, cz = S / 2;
  for (let k = 0; k < 6; k++) {
    const a = rng() * Math.PI * 2, rr = rng() * S * 0.35;
    b.box(cx + Math.cos(a) * rr, 0.2, cz + Math.sin(a) * rr, 0.5 + rng() * 0.3, 0.4, 0.9, 'kit:prop', { color: 0x4a4640, rotY: rng() * Math.PI });   // 翻倒的推床/杂物，示意荒废，非设定精确形态
  }
  kit.exit(b, { to: '16', kind: 'zone', x: cx, z: cz, radius: S * 0.75, marker: { color: [0.5, 0.2, 0.2], pulse: true }, label: '在医院里走得太深——忽然到了别处 (exits[3])' });
}

// ---------- 地板箭头（依据：landmarks「地板上指向医院主出口的箭头」，用发光条带近似箭头）----------
function buildFloorArrow(b, x, z, rot) {
  b.push(x, z, rot);
  b.plane(0, 0.012, 0, 0.14, 0.55, 'kit:glow', { facing: 'up', uv: 'solid', color: [0.3, 1.3, 0.4], glow: 0.9 });
  b.pop();
}

// ---------- 主出口 / 罕见未来门 ----------
// 验收②修复：ed 现在由 buildChunk 在 kit.gridWalls 之前挑好、并且已经 g.setWall(false) 拆掉了那段墙——
// 这里只管摆门扇本体；door.wall 用当前区块的走廊墙材质把这段缺口重新围上（只留门洞），门就不会被后建的实体墙埋掉
function buildMainExitDoor(b, g, ed, wallKey) {
  if (!ed) return;
  kit.exit(b, {
    to: '130', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '医院主出口，顺着地板箭头能找到 (exits[1])',
    door: { color: 0x4a4d50, wall: { matKey: wallKey, w: ed.len, h: H } },
  });
  kit.prop.sign(b, ed.x + Math.sin(ed.rot) * 0.8, ed.z + Math.cos(ed.rot) * 0.8, ed.rot, { color: 0xff2a1a, backColor: 0x1a0605, y: 2.3 });   // 呼应配图里发红光的 EXIT 指示牌（非原文文字，Level14picture1）
  g.reserve(ed.i, ed.j);
}
function buildRareDoor(b, g, ed, wallKey) {
  if (!ed) return;
  kit.exit(b, {
    to: '15', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '罕见的未来风格的门 (exits[2])',
    door: { color: 0x2a3038, wall: { matKey: wallKey, w: ed.len, h: H } },
  });
  b.push(ed.x, ed.z, ed.rot);
  b.plane(0, 1.95, 0.03, 0.9, 0.05, 'kit:glow', { facing: '+z', uv: 'solid', color: [0.3, 0.9, 1.6], glow: 1.1 });   // 门框顶部发光条示意"未来风格"，原文未细写外观
  b.pop();
  g.reserve(ed.i, ed.j);
}

// ---------- 走廊：地板箭头 + 遍布本层的锈蚀设备（含罕见的器械暴走/Level 268）+ 不稳地砖 ----------
// 依据：items「遍布本层」的锈蚀医疗设备（故障机器、手术刀、听诊器、注射器）；
//   hazards「器械暴走（罕见）：锈蚀的医疗设备突然启动、发生故障，伤到附近的人」；exits[4]「乱动医院设备，可能被送到 Level 268」
function buildEquipmentCluster(b, g, rng, cell) {
  kit.prop.cabinet(b, cell.x - 0.4, cell.z, 0, { kind: 'locker', w: 0.6, h: 1.6, color: 0x5a5850 });
  kit.prop.pipe(b, cell.x + 0.3, cell.z - 0.2, 0, { axis: 'y', length: 1.1, r: 0.05, color: 0x6b6258 });
  b.box(cell.x + 0.2, 0.25, cell.z + 0.4, 0.35, 0.5, 0.3, 'kit:prop', { color: 0x726a5c });   // 故障机器主体，外观原文未细写，近似形态
  const malfunction = rng() < 0.25;
  if (malfunction) {
    const spark = b.plane(cell.x + 0.2, 0.85, cell.z + 0.4, 0.15, 0.15, 'kit:glow', { facing: 'up', uv: 'solid', color: [1.6, 1.0, 0.3], glow: 1.0 });
    kit.exit(b, { to: '268', kind: 'zone', x: cell.x + 0.2, z: cell.z + 0.4, radius: 0.9, label: '乱动锈蚀设备，可能被送到其他地方 (exits[4])' });
    const w = b.world(cell.x + 0.2, cell.z + 0.4);
    let hit = false;
    b.update((dt, t) => {
      const on = Math.floor(t * 3) % 4 === 0;   // 偶发火花闪烁，节拍非设定精确值（原文只说"罕见"）
      spark.setVisible(on);
      const dx = BR.player.x - w.x, dz = BR.player.z - w.z;
      const near = dx * dx + dz * dz < 1.4;
      if (on && near && !hit) { hit = true; if (BR.game.attackPlayers) BR.player.damage({ hp: 4, sanity: 0.5, source: 'hazard:equipment-malfunction' }); BR.audio.play('hit', [w.x, 0, w.z]); }
      if (!on) hit = false;
    });
  }
  g.reserve(cell.i, cell.j);
}

// 依据：hazards「地板砖塌陷：毫无预兆地塌陷，可能露出暗道，也可能让人坠落身亡；发现不稳的迹象就尽快跑开」
function placeUnstableFloorMaybe(b, g, rng) {
  if (rng() >= 0.12) return;   // 低概率，非设定精确数字
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  g.reserve(cell.i, cell.j);
  const crack = b.plane(cell.x, 0.012, cell.z, 0.55, 0.55, 'kit:prop', { facing: 'up', color: 0x2c2822 });   // 裂纹迹象——"发现不稳就跑开"的视觉线索
  const hp = kit.prop.hole(b, cell.x, cell.z, 0, { r: 0.55, irregular: true, rimColor: 0x1c1a16 });
  hp.disc.setVisible(false); hp.rim.setVisible(false);
  const w = b.world(cell.x, cell.z);
  const phase0 = rng() * 90;
  let collapsed = false;
  b.update((dt, t) => {
    const cyc = 70;   // 塌陷/恢复周期，非设定精确值（原文只说"毫无预兆"）
    const on = ((t + phase0) % cyc) > cyc * 0.62;
    if (on !== collapsed) {
      collapsed = on;
      crack.setVisible(!on); hp.disc.setVisible(on); hp.rim.setVisible(on);
      if (on) {
        const dx = BR.player.x - w.x, dz = BR.player.z - w.z, d2 = dx * dx + dz * dz;
        if (d2 < 64) {
          BR.audio.play('hit', [w.x, 0, w.z]);
          if (d2 < 1.1) { BR.hud.toast('脚下的地砖突然塌陷了！', 1800); if (BR.game.attackPlayers) BR.player.damage({ hp: 16, sanity: 1.2, source: 'hazard:floor-collapse' }); }
          else BR.hud.toast('附近传来地板塌陷的声响……', 1500);
        }
      }
    }
  });
}

function decorateCorridorExtras(b, g, rng, special) {
  if (special === null && rng() < 0.35) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      const { dx, dz } = nearestMainExitDelta(b.cx, b.cz);
      buildFloorArrow(b, cell.x, cell.z, Math.atan2(dx, dz));
      g.reserve(cell.i, cell.j);
    }
  }
  if (rng() < 0.16) {
    const cell = pickFreeCell(g, rng);
    if (cell) buildEquipmentCluster(b, g, rng, cell);
  }
}

// ---------- 区块 ----------
// rng 消耗顺序固定：格子内部 → [验收②] 出口边选取 → 灯光 → 房型专属装饰 → 走廊附加物 → 不稳地砖
// （kind 本身来自独立派生流 chunkPlan，不吃这里的 rng；房间 carve 和出口 setWall 不吃 rng，只挪了执行时机）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const plan = isSpawn ? { kind: 'reception', toxic: false, special: null } : chunkPlan(ctx.levelSeed, cx, cz);
  const { kind, toxic, special } = plan;

  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const gopts = (kind === 'reception' || kind === 'deepzone') ? OPEN : ROOMY;
  const g = kit.grid(b, N, N, gopts);
  if (kind === 'reception' || kind === 'deepzone') g.carve(0, 0, N, N, { room: true });

  // 验收①修复：四种房型必须在 kit.gridWalls 建墙之前 carve，否则迷宫内部墙已经变成实体几何+碰撞盒，
  // decorate* 里的 carve 只改得动 grid 数据，房间会被迷宫墙填满（见 _kit.js gridWalls 是按 g.v/g.h 当时的状态直接出墙）
  const rect = ROOM_RECT[kind];
  if (rect) {
    g.carve(rect.i0, rect.j0, rect.w, rect.d, { room: true });
    // 验收⑤修复：原来的 g.carve(i0-1, j0, 1, 1) 是 1×1，_kit.js carve 的内部墙循环从 i0+1/j0+1 起步，1×1 一次都不循环、
    // 凿不掉任何墙——改成 w+1×1，让凸起格与主房间共享一条边，才是真的"不对称"轮廓
    if (kind === 'storage') g.carve(rect.i0 - 1, rect.j0, rect.w + 1, 1, { room: true });
  }

  const wallKey = kind === 'torture' ? 'L14:wallTorture' : (kind === 'inpatient' || kind === 'surgery') ? 'L14:wallWard' : kind === 'storage' ? 'L14:wallStorage' : 'L14:wallCorridor';
  const floorKey = kind === 'torture' ? 'L14:floorTorture' : 'L14:floor';

  // 验收②修复：主出口/罕见门要先选边、在 gridWalls 建墙前把那段墙拆掉（g.setWall false），
  // 门扇才不会被 gridWalls 紧接着建出来的实体墙埋在墙芯里；两种 special 都只在 kind==='corridor' 的区块出现（见 chunkPlan）
  let exitEdge = null;
  if (special === 'mainExit' || special === 'rareDoor') {
    exitEdge = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (exitEdge) g.setWall(exitEdge.axis, exitEdge.i, exitEdge.j, false);
  }

  kit.gridWalls(b, g, { matKey: wallKey, trim: kind === 'torture' ? { color: 0x2a1010 } : { color: 0x746a5e } });
  kit.prop.floor(b, null, null, 0, { matKey: floorKey });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L14:ceiling', y: H });

  if (kind !== 'reception' && kind !== 'deepzone') decorateLighting(b, g, rng, kind);

  if (kind === 'reception') decorateReception(b, H);
  else if (kind === 'inpatient') decorateInpatient(b, g, rng, toxic);
  else if (kind === 'storage') decorateStorage(b, g, rng, toxic);
  else if (kind === 'surgery') decorateSurgery(b, g, rng, toxic);
  else if (kind === 'torture') decorateTorture(b, g, rng);
  else if (kind === 'deepzone') decorateDeepZone(b, rng);
  else decorateCorridorExtras(b, g, rng, special);

  if (special === 'mainExit') buildMainExitDoor(b, g, exitEdge, wallKey);
  else if (special === 'rareDoor') buildRareDoor(b, g, exitEdge, wallKey);

  if (kind !== 'reception' && kind !== 'deepzone') placeUnstableFloorMaybe(b, g, rng);

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态与危害 ----------
const S = { timer: 0, whisperEpoch: -1, tortureTick: 0, tortureWarned: false, toxicTick: 0, toxicToastTick: 0 };
const WHISPER_EPOCH = 14;   // 依据：sounds「持续能听到远处的脚步声和低语」——重复间隔非设定精确值
const TORTURE_TICK = 1.4;   // 依据：hazards「刑讯室：The Hunter 的地盘，无论如何都不能进」——持续伤害节拍非设定精确值
const TOXIC_TICK = 1.8;     // 依据：hazards「污染房间…更严重时通常致死」——持续伤害节拍非设定精确值

BR.levels.register({
  id: '14', name: 'Level 14', title: 'Inhospitality', nickname: 'Inhospitality',
  version: 'fandom',   // = data/lore-choices.json levels["14"].source
  survivalClass: 'Class 4',   // 原文：Class 4 —— Unsafe / Unstable / Dangerous Entities and Hazards（分类还含 Cluster I、Dangerous Levels）
  chunkSize: SIZE,
  env: {
    // 依据：colors「窗外和旋转门后只有漆黑」；lighting「走廊阴暗(shadowy)」——不是无光层，ambient 用正常亮度色调（冷临床灰蓝）
    // + 较低 intensity 控制明暗，参照第一批教训（color 太暗会整屏纯黑）
    background: 0x14171a, fogColor: 0x14171a, fogNear: 3, fogFar: 30,
    ambient: { color: 0xaab4bc, intensity: 0.18 },
    // 依据：sounds「持续能听到远处的脚步声和低语，会让人迷失方向、陷入无休止的偏执」+ Class 4 危险等级
    sanityDrainMul: 1.6,
    hungerDrainMul: 1,   // 温度：只有 The Hunter 靠近时骤降，不是持续环境状态，不加成
    audio: 'dark',       // 现有预设里最贴近"阴暗走廊+分不清方向的远处动静"（低通脚步声/敲击声/次声轰鸣）
    darkness: false,     // 原文是 shadowy（阴暗）不是无光，且部分房间仍有可用光源
  },
  spawn() { return { x: SPAWN_X, y: 0, z: SPAWN_Z, yaw: 0 }; },   // 依据：mechanics「所有进入者先出现在接待室」
  buildChunk,
  // 实体表：hunter/infecting_agent 由本批(chunk4)另一位代理实现 js/entities/hunter.js / infecting_agent.js，
  // 已核对两个文件的 register({ type: '...' })，type 名与下面完全一致（规则④），无需再改
  entities: [
    // 依据：entities[0].density「one of the only entities that resides in Level 14」——强调是本层为数不多的个体、接近唯一，
    // 参照 L5 对具名孤例实体（萨曼莎）的处理，取远低于 entityDensityOverall="low"(0.12) 基线的数值，非官方精确数字
    { type: 'hunter', officialPer1000m2: 0.01 },
    // 依据：entities[1].density「原文没有数字，由 The Hunter 释放」——取 entityDensityOverall 的 low 作为下限估计
    { type: 'infecting_agent', officialPer1000m2: 0.12 },
  ],
  items: [
    // 用户规则：所有模式都刷杏仁水与食物；其余取自 data/item-spawn.json 里 levels 含 '14' 且 js/items/<key>.js 已存在的条目
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'bandages', per1000m2: 0.3 },        // 依据：items「常见于接待室前台」
    { type: 'painkillers', per1000m2: 0.3 },     // 依据：items「接待室前台，和绷带、抗生素放在一起」
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    { type: 'food_ration', per1000m2: 0.6 },     // 用户规则：所有模式都刷食物
  ],
  exits: [
    { to: '777', kind: 'zone', note: 'Level 777 不在首期范围，只提示尚未开放；待一段时间后可能找到的发光窗户，本实现按固定概率出现（时间触发未做，反正范围外已 sealed）(exits[0])' },
    { to: '130', kind: 'door', note: '顺着地板箭头走到医院主出口；每 4 块周期性重复的走廊区块 (exits[1])' },
    { to: '15', kind: 'door', note: '穿过一扇罕见的未来风格门；每 5 块周期性重复 (exits[2])' },
    { to: '16', kind: 'zone', note: '在医院里走得太深；离出生点 ≥9 块的区块按概率整块铺大半径 zone (exits[3])' },
    { to: '268', kind: 'zone', note: 'Level 268 不在首期范围，只提示尚未开放；乱动锈蚀医疗设备偶发触发 (exits[4])' },
  ],
  enter(ctx) { Object.assign(S, { timer: 0, whisperEpoch: -1, tortureTick: 0, tortureWarned: false, toxicTick: 0, toxicToastTick: 0 }); },
  update(ctx, dt) {
    S.timer += dt;
    // 持续的远处脚步声/低语（依据：sounds）——点缀音效，env.audio='dark' 已有基础的远处脚步/敲击层
    const epoch = Math.floor(S.timer / WHISPER_EPOCH);
    if (epoch !== S.whisperEpoch) {
      S.whisperEpoch = epoch;
      const r = U.rng(ctx.levelSeed, 'L14-whisper', epoch);
      if (r() < 0.6) BR.audio.play(r() < 0.5 ? 'whisper' : 'step', [BR.player.x + (r() - 0.5) * 6, 0, BR.player.z + (r() - 0.5) * 6]);
      if (r() < 0.15) BR.hud.toast('你分不清那脚步声是从哪个方向传来的……', 2000);   // 依据：sounds「让人迷失方向、陷入无休止的偏执」
    }

    const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
    const isSpawnChunk = cc.cx === 0 && cc.cz === 0;
    const plan = isSpawnChunk ? null : chunkPlan(ctx.levelSeed, cc.cx, cc.cz);
    // 验收④修复：伤害原来按整个 24×24 区块判定，连房间外的普通走廊都会扣血——现在换算成区块本地坐标，
    // 只有站在房间矩形范围内（ROOM_RECT，和 buildChunk 里 carve 用的是同一份）才算「在刑讯室/污染房间里」
    const rect = plan && ROOM_RECT[plan.kind];
    let inRoom = false;
    if (rect) {
      const lx = BR.player.x - cc.cx * SIZE, lz = BR.player.z - cc.cz * SIZE;
      inRoom = lx >= rect.i0 * CELL && lx < (rect.i0 + rect.w) * CELL && lz >= rect.j0 * CELL && lz < (rect.j0 + rect.d) * CELL;
    }

    // 刑讯室：The Hunter 的地盘（依据：hazards「无论如何都不能进」——引擎没有门锁运行时状态，用持续强力伤害近似）
    if (plan && plan.kind === 'torture' && inRoom) {
      S.tortureTick += dt;
      if (!S.tortureWarned) { BR.hud.toast('这里是猎手的地盘——赶紧离开！', 2400); S.tortureWarned = true; }
      if (S.tortureTick >= TORTURE_TICK) { S.tortureTick = 0; if (BR.game.attackPlayers) BR.player.damage({ hp: 3, sanity: 1.6, source: 'hazard:torture-chamber' }); }
    } else { S.tortureTick = 0; S.tortureWarned = false; }

    // 污染房间（依据：hazards「充满有毒的放射性物质，导致幻觉、迷失方向、恐惧和失忆，更严重时通常致死」）
    if (plan && plan.toxic && inRoom) {
      S.toxicTick += dt; S.toxicToastTick += dt;
      if (S.toxicToastTick >= 5) { S.toxicToastTick = 0; BR.hud.toast('空气中弥漫着刺鼻的化学味……视线开始模糊', 2000); }
      if (S.toxicTick >= TOXIC_TICK) { S.toxicTick = 0; if (BR.game.attackPlayers) BR.player.damage({ hp: 1.5, sanity: 2, source: 'hazard:contaminated-room' }); }
    } else { S.toxicTick = 0; S.toxicToastTick = 0; }
  },
  leave(ctx) { BR.hud.prompt(null); },
});
})();

// ============================================================
// 没有实现的细节（原因见各条）：
//   The Hunter 靠近前兆（突然恐惧、气温骤降、空气变沉浊、层级"被毒化"）——原文把它写成 The Hunter 自身的能力，
//     属于 js/entities/hunter.js（本批另一位代理）的实体行为，层级文件不重复实现，也无法读取其他实体的运行时状态。
//   "对视就无可挽救"的视线判定——同上，属于 hunter 实体自身的攻击/判负逻辑。
//   窗户可能是伪装的实体（Entity 2 "Windows"）——data/entity-index.json 的 entities[] 里没有它（只在 hazards 里作为提示），
//     也没有 js/entities/windows.js，按规则④不登记为可刷新实体；已在住院病房窗户旁保留了"看似普通"的静态窗户外观。
//   接待室"离开后无法再进入"（单向）——引擎按区块坐标载入/卸载，没有"访问过就永久锁死"的状态，仅保留为叙事背景。
//   T.14.R.G. 研究组遗迹、实验舱等具体据点——原文没写位置（unverified），未强行摆放。
//   14 号化合物 / 抗生素——item-spawn.json 未把 Level 14 列入 antibiotics 的 levels（basis 写"选中版本未提到"，
//     与 fandom 版本实际文本不符，可能是登记时假设了另一版本），未擅自修改 data/*.json，仅在 apiRequests 提出核对请求。
// ============================================================
