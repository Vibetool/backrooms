// Level 8 - "岩洞系统"（Cave Systems）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-8  许可：CC BY-SA 3.0
// 译者 Ambersight，译自 backrooms-wiki.wikidot.com/level-8（C-Graph、Kai4C 重写；原作 Bart0nius 与 u/avolded；
// Stretchsterz 首次重写）。data/lore-choices.json levels["8"].source = "wikidot-cn"
// 只按这一个版本实现：不借 wikidot-en 未逐字确认的铜/稀土、酒精清洗伤口、Handyland 温度等细节；
// 不借 fandom 的完全不同条目（The Burrows、Mortisdoptera、Troglosidae、停滞冰水、整体严寒、"不带手电"策略等）——
// 这些都在 conflicts 列表里，选中版本没写的地方（岩石具体颜色等 unverified 项）就留空，不凭记忆编造
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// file:// 双击兜底：贴图文件读不到时的程序化画法（TEMPLATE 15 节步骤 7）
BR.assets.registerProcedural('l8_cave_rock', 256, (g, s) => {
  g.fillStyle = '#5c534a'; g.fillRect(0, 0, s, s);
  const r = U.rng('l8_cave_rock');
  for (let k = 0; k < 1600; k++) {
    const v = 55 + (r() * 55 | 0);
    g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.35)`;
    g.fillRect(r() * s, r() * s, 2 + r() * 3, 2 + r() * 3);
  }
});

// ---------- 尺寸 ----------
// 依据：architecture「天然岩洞…断层室（顶板崩塌形成平面）」+ scale「新莫维勒窟大约一个足球场大」
// 「巨臂林地横跨数英亩」——本批唯一的纯洞穴层，取开阔层区间（TEMPLATE 16 节 32–48）里最大一档
const SIZE = 44, N = 8, CELL = SIZE / N;
const H_TUNNEL = 3.0;  // 第九大道/多维之路/普通岩洞通道：较窄，原文没给数字，取比室内层略高一点（天然岩顶不齐）
const H_HALL = 6.5;    // 罗特尼斯大丛林/巨臂林地/新莫维勒窟：巨型洞室，取远高于人形层高的值表现「足球场大」「横跨数英亩」的挑高感
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 格子参数：全层边界参数（EDGE 内）严格一致（TEMPLATE 7.2 节），区块类型只改内部密度 ----------
const EDGE = { salt: 'L8', boundaryDensity: 0.32, straightness: 0.6, minOpenings: 2 };
// 依据：layout「第九大道沿'稳定孤岛'铺设」——路面维护良好，墙密度低、房间（定居点空地）常见
const ROAD = Object.assign({ wallDensity: 0.2, roomChance: 0.35, maxRooms: 2, roomSize: [2, 4], loopChance: 0.55, pillarChance: 0.05 }, EDGE);
// 普通天然岩洞通道/断层室
const GENERIC = Object.assign({ wallDensity: 0.42, roomChance: 0.3, maxRooms: 2, roomSize: [2, 4], loopChance: 0.45, pillarChance: 0.1 }, EDGE);
// 依据：landmarks「多维之路：二十三条狭窄通道」——高墙密度、少房间，逼仄感
const HYPERSPACE = Object.assign({ wallDensity: 0.6, roomChance: 0.15, maxRooms: 1, roomSize: [2, 3], loopChance: 0.3, pillarChance: 0.02 }, EDGE);
// 巨型洞室（罗特尼斯大丛林/巨臂林地）：内部大面积清空、边界照旧，柱子格点当散落岩柱/石钉
const HALLREGION = Object.assign({ wallDensity: 0.1, roomChance: 0.5, maxRooms: 2, roomSize: [3, 6], loopChance: 0.6, pillarChance: 0.14 }, EDGE);
// 依据：新莫维勒窟「大约一个足球场大」——单个开阔洞室，用满 carve 更纯粹
const MAUVILLE = Object.assign({ wallDensity: 0.15, roomChance: 0.4, maxRooms: 1, roomSize: [4, 6], loopChance: 0.5, pillarChance: 0.05 }, EDGE);

// ---------- 第九大道沿线的固定据点（唯一一处，不吃 rng，位置写死，参照 L7.js 的固定地标做法）----------
// 依据：landmarks「沿途有 M.E.G.、B.N.T.G.、哈莫兹洞穴社群的定居点」+ bases 列表；出生点以西按危险程度递增排列，
// 出生点以东留给主推荐出口（Level 9），两边不冲突
const ROAD_SITES = [
  { cx: -2,  key: 'meg' },       // M.E.G.「空巢」前哨站（友好，静态）
  { cx: -5,  key: 'refugee' },   // 过载贫瘠区（敌对营地，静态+疾病贫困氛围）
  { cx: -8,  key: 'harmouth' },  // 哈莫兹洞穴社群主要基地（友好）+ 附近通往 Level 203 的门
  { cx: -11, key: 'bntg' },      // B.N.T.G. 3 号资源提取站（敌对）
  { cx: -14, key: 'kolperos' },  // U.E.C. 科尔珀洛斯研究所（敌对，不接受访客）
  { cx: -17, key: 'cult' },      // 蒙面教会第三主教区遗址（已消灭，残留受诅咒之物）
  { cx: -20, key: 'kavragost' }, // 卡维戈斯特小镇（废弃，无生命迹象）
];
function siteAt(cx, cz) { if (cz !== 0) return null; const s = ROAD_SITES.find(s => s.cx === cx); return s ? s.key : null; }

// ---------- 区域宏格：第九大道沿 cz=0 整排（稳定孤岛，不吃 rng）；紧邻的近环是罗特尼斯大丛林；
// 更远处按 3×3 宏格随机挑生态区（罗特尼斯之外的三种）----------
const MX = 3;
function regionAt(levelSeed, cx, cz) {
  if (cz === 0) return 'road9';
  if (Math.abs(cz) <= 2) return 'jungle';   // 依据：landmarks「罗特尼斯大丛林」——紧邻主路的近环，兼容 exits[1] 需要「离出生点不远就能摸到」
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  return U.weighted(U.rng(levelSeed, 'L8-biome', mx, mz), [
    ['arm_woodland', 0.42],  // 依据：「已知最大单一洞穴群，横跨数英亩」——应为最常见的生态区
    ['generic', 0.28],       // 普通天然岩洞通道/断层室
    ['hyperspace', 0.18],    // 依据：「二十三条狭窄通道」，数量有限
    ['mauville', 0.12],      // 依据：「大约一个足球场大」——单个开阔洞室，规模远小于巨臂林地
  ]);
}

// ---------- 材质：全部复用同一张天然岩石贴图，vertexColors 逐件染色区分生态区，不为每个生态区新建材质 ----------
function defineMaterials() {
  kit.mats({
    'L8:wall':  { tex: 'l8_cave_rock', repeatMeters: 3.2, roughness: 1, color: 0x8f857a, vertexColors: true },
    'L8:floor': { tex: 'l8_cave_rock', repeatMeters: 3.8, roughness: 1, color: 0x847a6e, vertexColors: true },
    'L8:ceil':  { tex: 'l8_cave_rock', repeatMeters: 3.2, roughness: 1, color: 0x4a453e, vertexColors: true },
  });
}

// 各生态区/据点的岩壁·地面染色（依据：colors 字段「岩石颜色未写（unverified）」，只对有描述颜色的生态区染色；
// 没有颜色描述的（road9/generic/hyperspace 主通道）用材质默认的中性岩石色，不额外编造）
function biomeColor(key) {
  switch (key) {
    case 'jungle':       return { wall: 0x726a52, floor: 0x5c6b46 };   // 依据：彩色发光菌类、苔藓、蕨类——岩壁地面偏苔绿
    case 'arm_woodland': return { wall: 0x7c5f55, floor: 0x6e4c40 };   // 依据：巨臂林地「血红色发光苔藓」——偏暗红棕
    case 'mauville':     return { wall: 0x807c54, floor: 0x736f46 };   // 依据：化能生态、硫磺分解——偏土黄硫色
    case 'hyperspace':   return { wall: 0x5f6f78, floor: 0x546268 };   // 依据：「蓝绿色辉光」——岩壁偏冷青
    case 'refugee':      return { wall: 0x5c5648, floor: 0x4a453a };   // 无序难民营，灰扑扑更脏
    case 'cult':         return { wall: 0x3c3733, floor: 0x322e2b };   // 已被摧毁的遗址，烧灼后的暗色
    case 'kolperos':     return { wall: 0x8f9a97, floor: 0x767f7c };   // 研究设施，冷调偏灰
    case 'kavragost':    return { wall: 0x736c60, floor: 0x635c52 };   // 废弃小镇，积尘土黄
    default:              return { wall: undefined, floor: undefined };
  }
}

function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}

// ---------- 石钟乳/石笋：格子迷宫柱子格点当天然岩柱用（依据 architecture「石钟乳、石笋以各种角度刺出」）----------
// rng 消耗顺序：每个柱子格点先取地面石笋概率，若本区块有顶再取一次悬垂石钟乳概率——同一区块内固定不变
function scatterSpikes(b, g, rng, height, hasCeiling, tint) {
  for (const p of g.pillars) {
    const r = rng();
    if (r < 0.5) {
      const c = g.center(p.i, p.j);
      const h = 0.7 + rng() * (height * 0.3);
      const rb = 0.13 + rng() * 0.15;
      b.cylinder(c.x, 0, c.z, rb, h, 'L8:wall', { rTop: 0.02, segments: 6, color: tint, rotY: rng() * Math.PI });
    }
    if (hasCeiling) {
      const r2 = rng();
      if (r2 < 0.32) {
        const c = g.center(p.i, p.j);
        const h2 = 0.6 + rng() * (height * 0.25);
        const rt = 0.11 + rng() * 0.13;
        b.cylinder(c.x, height - h2, c.z, 0.02, h2, 'L8:wall', { rTop: rt, segments: 6, color: tint });
      }
    }
  }
}

// ---------- 焦油之手：粘稠焦油池，遍布全层（依据 landmarks「焦油之手」+ hazards「将人拖入窒息」）----------
// 位置记进 b.data 供 level.update 做接触伤害；目标层随机（41 或 91，依据 mechanics「不可控」），两者都不在首期范围，
// kit 会自动 sealed，玩家不会真的被传走，只有"被拖住"的伤害与"尚未开放"提示（用户规则：范围外出口不改目的地）
function buildTarPit(b, g, rng) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  kit.prop.puddle(b, cell.x, cell.z, 0, { rx: 1.1, rz: 0.9, color: 0x0c0906 });
  const to = rng() < 0.5 ? '41' : '91';
  kit.exit(b, { to, kind: 'zone', x: cell.x, z: cell.z, radius: 1.0, label: '粘稠的焦油池，仿佛有手从里面伸出来 (hazards「焦油之手」/ exits「被拖入焦油坑」)' });
  const w = b.world(cell.x, cell.z);
  (b.data.tar || (b.data.tar = [])).push({ x: w.x, z: w.z });
  g.reserve(cell.i, cell.j);
}

// ---------- 不稳定重力与浮空岩石：碰一下可能崩塌（依据 hazards「游走在失衡边缘，最轻微一碰都可能瞬间崩塌」）----------
// 引擎没有可变重力方向（apiRequests），这里只近似做"悬浮的岩块，靠近会掉落砸人"的局部危险，不改玩家重力
function buildFloatingRock(b, g, rng, height) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  const y = height * 0.55 + rng() * height * 0.25;
  b.box(cell.x, y, cell.z, 0.9 + rng() * 0.5, 0.7, 0.9 + rng() * 0.5, 'L8:wall', { solid: false });   // 悬浮岩块本身不挡路、不动画，省一个 draw call
  const w = b.world(cell.x, cell.z);
  (b.data.floatRock || (b.data.floatRock = [])).push({ x: w.x, z: w.z });
  g.reserve(cell.i, cell.j);
}

// ---------- 高温区（依据 temperature「部分区域因特殊化学构成与生态系统达 43°C 以上」）----------
function buildHotPocket(b, g, rng) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  b.plane(cell.x, 0.02, cell.z, 1.4, 1.4, 'kit:glow', { facing: 'up', color: [0.9, 0.35, 0.1], glow: 0.35 });
  const w = b.world(cell.x, cell.z);
  (b.data.hot || (b.data.hot = [])).push({ x: w.x, z: w.z });
  g.reserve(cell.i, cell.j);
}

// ---------- 蛛形纲巢穴：装饰性蛛网洞室（密度已按第 12 节公式全层统一分布，这里只做视觉标记，依据 hazards
// 「成片区域被占领，成千上万只」）----------
function buildSpiderNest(b, g, rng) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng() * 0.4;
    b.plane(cell.x + Math.cos(a) * 0.5, 0.9 + rng() * 0.8, cell.z + Math.sin(a) * 0.5, 0.8, 0.8, 'kit:prop', { facing: '+z', color: [0.72, 0.7, 0.66], rotY: a });
  }
  b.plane(cell.x, 0.02, cell.z, 1.6, 1.6, 'kit:prop', { facing: 'up', color: [0.5, 0.48, 0.44] });
  g.reserve(cell.i, cell.j);
}

// ---------- 天然石乐器洞室（叙事段落，无功能，纯装饰；依据 landmarks「卡祖笛、小提琴、吉他、长号、风铃、邦戈鼓」）----------
// 没有匹配的乐器音效可用（音效表里没有对应音色，见 apiRequests），只做形状各异的石笋群暗示乐器轮廓
function buildInstrumentRoom(b, g, rng, height) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2;
    const cx2 = cell.x + Math.cos(ang) * 1.1, cz2 = cell.z + Math.sin(ang) * 1.1;
    const h = 0.5 + rng() * (height * 0.35);
    b.cylinder(cx2, 0, cz2, 0.1 + rng() * 0.12, h, 'L8:wall', { rTop: rng() < 0.5 ? 0.22 : 0.02, segments: 6 });
  }
  g.reserve(cell.i, cell.j);
}

// ---------- 第九大道：M.E.G. 标牌（依据 landmarks「约每 50 米一块 M.E.G. 标牌」，本层 chunkSize=44m 约等价一块一牌）----------
function buildRoadDecor(b, g, cx) {
  const c = g.center(1, 4);
  kit.prop.sign(b, c.x, c.z, Math.PI / 2, { w: 0.5, h: 0.18, y: 1.9, backColor: 0x2a3a2a, color: 0x9fe89f });
  g.reserve(1, 4);
  // 依据「沿途有 M.E.G.、B.N.T.G.、哈莫兹洞穴社群的定居点」——非据点的路段偶尔摆一顶无人帐篷代表流动定居者
  void cx;
}

// ---------- 罗特尼斯大丛林：彩色发光菌类、苔藓蕨类、山丘之巅的神庙、穴顶尸鼠（不做真实倒转重力，见 apiRequests）----------
function buildJungleDecor(b, g, rng, height) {
  for (let k = 0; k < 3; k++) {
    const r = rng();
    if (r < 0.5) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        const hue = rng();
        const col = hue < 0.34 ? [0.2, 1.0, 0.5] : hue < 0.67 ? [0.9, 0.5, 1.0] : [1.0, 0.75, 0.15];
        const th = 0.4 + rng() * (height * 0.4);
        b.cylinder(cell.x, 0, cell.z, 0.18 + rng() * 0.2, th, 'kit:glow', { rTop: 0.14, segments: 6, color: col, glow: 0.5 });
      }
    }
  }
  // 依据「洞穴中央山丘之巅有神爱之繁生的神庙」——概率化的圆形高台 + 环柱，勿伤植物（无交互，仅氛围警示）
  const shrineRoll = rng();
  if (shrineRoll < 0.06) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      b.cylinder(cell.x, 0, cell.z, 1.6, 0.35, 'L8:wall', { segments: 10 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.cylinder(cell.x + Math.cos(a) * 1.3, 0.35, cell.z + Math.sin(a) * 1.3, 0.09, height * 0.5, 'L8:wall', { segments: 6 });
      }
      b.plane(cell.x, 0.36, cell.z, 2.4, 2.4, 'kit:glow', { facing: 'up', color: [0.4, 1.0, 0.5], glow: 0.25 });
      g.reserve(cell.i, cell.j);
    }
  }
  // 依据：death_rat「栖息罗特尼斯穴顶，排泄时倒立…借数百条通风管道去其他层级」——没有真正的顶部可走层（apiRequests，
  // 见文件末尾），用悬垂在高处的暗色团块示意"穴顶的鼠群"，实体密度仍按第 12 节全层统一投放，不额外做湮没重力判定
  const ratRoll = rng();
  if (ratRoll < 0.4) {
    const cell = pickFreeCell(g, rng);
    if (cell) b.plane(cell.x, height - 0.3, cell.z, 0.6, 0.6, 'kit:prop', { facing: 'down', color: [0.16, 0.14, 0.12] });
  }
}

// ---------- 新莫维勒窟：化能生态、硫磺甲烷气味、微生物垫（依据 architecture/smells/hazards）----------
function buildMauvilleDecor(b, g, rng) {
  for (let k = 0; k < 4; k++) {
    const r = rng();
    if (r < 0.5) {
      const cell = pickFreeCell(g, rng);
      if (cell) b.plane(cell.x, 0.02, cell.z, 1.2 + rng() * 0.6, 0.9 + rng() * 0.5, 'kit:prop', { facing: 'up', color: [0.55, 0.5, 0.2] });
    }
  }
}

// ---------- 巨臂林地：手形石钉覆盖血红发光苔藓（本层地标名字的由来），自成天气（极光/风雨/雷暴，flavor 化）----------
function buildHandStalagmite(b, x, z, rng, height) {
  const baseH = 0.5 + rng() * 0.4;
  b.cylinder(x, 0, z, 0.32, baseH, 'L8:wall', { segments: 8 });
  const fingers = 4 + (rng() < 0.5 ? 0 : 1);
  for (let k = 0; k < fingers; k++) {
    const a = (k / fingers) * Math.PI * 2;
    const len = Math.min(height * 0.55, 1.3 + rng() * 1.4);
    const fx = x + Math.cos(a) * 0.22, fz = z + Math.sin(a) * 0.22;
    b.cylinder(fx, baseH, fz, 0.09, len, 'L8:wall', { rTop: 0.03, segments: 5, rotY: a });
    // 依据：「手形石钉覆盖血红发光苔藓」——指尖一小片红色辉光
    b.cylinder(fx, baseH + len * 0.85, fz, 0.1, len * 0.15, 'kit:glow', { rTop: 0.03, segments: 5, color: [1.1, 0.15, 0.12], glow: 0.7 });
  }
}
function buildArmWoodlandDecor(b, g, rng, height) {
  for (let k = 0; k < 2; k++) {
    const r = rng();
    if (r < 0.4) {
      const cell = pickFreeCell(g, rng);
      if (cell) { buildHandStalagmite(b, cell.x, cell.z, rng, height); g.reserve(cell.i, cell.j); }
    }
  }
}

// ---------- 多维之路：辉光细菌真菌、普通水溪流（非杏仁水，依据 other 明确说明）、氙弹珠、微光向导居所 ----------
function buildHyperspaceDecor(b, g, rng) {
  const streamRoll = rng();
  if (streamRoll < 0.4) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      b.plane(cell.x, 0.015, cell.z, 1.6, 3.2, 'kit:water', { facing: 'up', color: 0x88b0a8 });
      const marbleRoll = rng();
      if (marbleRoll < 0.5) {
        // 依据：items「氙弹珠，溪底，微光向导的居所」——纯装饰小球，没有对应可拾取物品文件，见文件末尾说明
        b.cylinder(cell.x, 0.04, cell.z, 0.05, 0.06, 'kit:glow', { color: [0.5, 1.1, 1.2], glow: 0.6 });
      }
      g.reserve(cell.i, cell.j);
    }
  }
  for (let k = 0; k < 3; k++) {
    const r = rng();
    if (r < 0.4) {
      const cell = pickFreeCell(g, rng);
      if (cell) b.plane(cell.x, 0.3 + rng() * 1.2, cell.z, 0.5, 0.5, 'kit:glow', { facing: '+z', color: [0.3, 1.0, 0.9], glow: 0.5, rotY: rng() * Math.PI * 2 });
    }
  }
}

// ============================================================
// 出口：每种目标一个函数，rng 消耗顺序固定写在 buildChunk 各分支里
// ============================================================
function exitToNine(b, cx) {
  // 依据 exits[0]「沿第九大道」（主推荐）——离出生点 4 块起、整块铺 zone（issue②：范围内出口保证摸得到，别用低概率小圈）
  if (cx >= 4) kit.exit(b, { to: '9', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.72, marker: true, label: '沿第九大道继续走，M.E.G. 标牌指向 Level 9 (exits[0]，主推荐)' });
}
function exitToTwo(b, cx) {
  // 依据 exits[1]「罗特尼斯大丛林顶部通风管道」（不建议，尸鼠众多）——jungle 环带内 |cx|>=4 起整块铺 zone，同样在范围内保证摸得到；
  // 阈值和 exitToNine 一样取 4 块（issue②的 3–5 块区间），离出生点近的 jungle 环带留给正常探索/焦油坑等危害，
  // 不要太靠近就把整块变成传送区（同一格全块生效，靠近焦油坑等装饰会被一并带走，出生点附近不宜太快出现）
  if (Math.abs(cx) >= 4) kit.exit(b, { to: '2', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.68, marker: true, label: '头顶的通风管道隐约通向 Level 2 (exits[1]，不建议，尸鼠众多)' });
}
function exitSilverTunnel(b, g, rng) {
  // 依据 exits[3]「偶尔能找到被标志性银色物质包裹的狭窄隧道」→ Level 75（范围外，kit 自动 sealed）
  const r = rng();
  if (r < 0.05) {
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed) {
      g.setWall(ed.axis, ed.i, ed.j, false);
      kit.exit(b, { to: '75', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H_TUNNEL, matKey: 'L8:wall', label: '被银色物质包裹的狭窄隧道 (exits[3])' });
      g.reserve(ed.i, ed.j);
    }
  }
}
function exitWallCut(b, g, rng) {
  // 依据 exits[4]「从几个特定洞穴的墙壁切出」→ Level 93（范围外）
  const r = rng();
  if (r < 0.05) {
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed) {
      g.setWall(ed.axis, ed.i, ed.j, false);
      kit.exit(b, { to: '93', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H_TUNNEL, matKey: 'L8:wall', label: '墙壁上一道切出的裂口 (exits[4])' });
      g.reserve(ed.i, ed.j);
    }
  }
}
function exitCeilingCut(b, g, rng, height) {
  // 依据 exits[6]「抱着明确的目的从洞穴顶部切出」→ Level 205（范围外）——引擎无法真正在顶部落脚，
  // 近似成一段高处墙面的切口（apiRequests：多层结构）
  const r = rng();
  if (r < 0.05) {
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed) {
      g.setWall(ed.axis, ed.i, ed.j, false);
      kit.exit(b, { to: '205', kind: 'noclip', y: height * 0.55, x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: height * 0.4, matKey: 'L8:wall', label: '洞穴高处的一道切口 (exits[6])' });
      g.reserve(ed.i, ed.j);
    }
  }
}
function exitFloorHole(b, g, rng) {
  // 依据 exits[7]「从地面掉出」→ Level 69（范围外）
  const r = rng();
  if (r < 0.05) {
    const cell = pickFreeCell(g, rng);
    if (cell) { kit.exit(b, { to: '69', kind: 'hole', x: cell.x, z: cell.z, label: '地面裂开的一个洞 (exits[7])' }); g.reserve(cell.i, cell.j); }
  }
}

// ============================================================
// 据点：只摆静态建筑与标记，不做交易/交互，不做 NPC 对话（用户规则）
// ============================================================
function buildSiteChunk(b, cx, cz, rng, key, height) {
  void cz;
  const g = kit.grid(b, N, N, ROAD);
  g.carve(0, 0, N, N, { room: true });   // 据点内部整块清空（边界照旧，TEMPLATE 7.2 节规则 2）
  const col = biomeColor(key);
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false, color: col.wall });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor', color: col.floor });
  const cx0 = SIZE / 2, cz0 = SIZE / 2;

  if (key === 'meg') {
    // 依据 bases「M.E.G.'空巢'前哨站（友好）：2016 年初建立，曾用名'洞穴丽影'，20 名常驻员工」
    kit.prop.fence(b, cx0 - 6, cz0 - 4, 0, { length: 10, h: 1.6, kind: 'chain', color: 0x6a6a5a });
    kit.prop.cabinet(b, cx0 - 3, cz0 - 2, 0, { kind: 'locker', w: 0.8, h: 1.8, d: 0.6, color: 0x3a5a3a });
    kit.prop.crate(b, cx0 - 1, cz0 - 2, 0, { size: 0.8, color: 0x556b55 });
    kit.prop.sign(b, cx0, cz0 - 5, 0, { w: 0.9, h: 0.3, y: 2.1, backColor: 0x224422, color: 0xaaffaa });
    b.light({ x: b.world(cx0, cz0 - 1).x, y: 2.6, z: b.world(cx0, cz0 - 1).z, color: 0xffe3b0, intensity: 0.8, range: 9 });
  } else if (key === 'refugee') {
    // 依据 bases「过载贫瘠区（敌对）：无序营地，充斥犯罪、疾病与贫困」——杂乱帐篷、堆积的箱子，无守卫实体（本批无对应 NPC）
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; kit.prop.box(b, cx0 + Math.cos(a) * 3, cz0 + Math.sin(a) * 3, 0, { stack: 1 + (k % 2), color: 0x4a4436 }); }
    kit.prop.fence(b, cx0 - 5, cz0 + 5, Math.PI / 2, { length: 6, h: 1.2, kind: 'chain', color: 0x3a3a30 });
    const w = b.world(cx0, cz0);
    (b.data.hazSite || (b.data.hazSite = [])).push({ x: w.x, z: w.z, r: 6, kind: 'sanity' });
  } else if (key === 'harmouth') {
    // 依据 bases「哈莫兹洞穴社群（友好）：约 100 名洞穴专家…有先进实验室」+ mechanics「四号营地附近有通往 Level 203 的门」
    kit.prop.cabinet(b, cx0 - 3, cz0 - 3, 0, { kind: 'file', w: 0.8, h: 1.6, d: 0.5, color: 0x5a5a66 });
    kit.prop.desk(b, cx0 - 1, cz0 - 3, 0, { w: 1.4, d: 0.7, color: 0x6a6255 });
    kit.prop.chair(b, cx0 - 1, cz0 - 2.2, Math.PI, { color: 0x4a4438 });
    kit.prop.door(b, cx0 + 4, cz0, Math.PI / 2, { style: 'metal', wall: { matKey: 'L8:wall', w: 3, h: height } });
    kit.exit(b, { to: '203', kind: 'door', x: cx0 + 4, z: cz0, rot: Math.PI / 2, label: '四号营地附近的门 (exits「四号营地附近的门」，不建议，Level 203 没有出口)' });
  } else if (key === 'bntg') {
    // 依据 bases「B.N.T.G. 3 号资源提取站（敌对）：被充满仇恨的流放者占据」
    kit.prop.crate(b, cx0 - 2, cz0 - 2, 0, { size: 1.0, color: 0x6a4a2a });
    kit.prop.crate(b, cx0 - 1, cz0 - 2, 0, { size: 0.8, color: 0x5a3f22 });
    kit.prop.pipe(b, cx0 + 2, cz0, 0, { axis: 'z', length: 4, y: 2.4, color: 0x4a3a2a });
    const w = b.world(cx0, cz0);
    (b.data.hazSite || (b.data.hazSite = [])).push({ x: w.x, z: w.z, r: 6, kind: 'damage' });
  } else if (key === 'kolperos') {
    // 依据 bases「U.E.C. 科尔珀洛斯研究所（敌对）：非友善、不接受访客，对闯入者致命」——外观封闭的研究设施
    kit.prop.window(b, cx0 - 3, cz0 - 4, 0, { w: 1.2, h: 1.0, y: 1.4, blackout: true, wall: { matKey: 'L8:wall', w: 4, h: height } });
    kit.prop.cabinet(b, cx0 + 2, cz0 - 2, 0, { kind: 'locker', w: 0.8, h: 1.9, d: 0.6, color: 0x8a9490 });
    kit.prop.sign(b, cx0, cz0 - 4, 0, { w: 0.8, h: 0.25, y: 2.0, backColor: 0x3a1010, color: 0xff5040 });
    const w = b.world(cx0, cz0);
    (b.data.hazSite || (b.data.hazSite = [])).push({ x: w.x, z: w.z, r: 7, kind: 'damage' });
  } else if (key === 'cult') {
    // 依据 landmarks「蒙面教会第三主教区遗址：2016 年被 M.E.G. 与阿尔戈斯之眼摧毁，残留受诅咒之物」——烧毁残垣
    for (let k = 0; k < 3; k++) b.box(cx0 - 3 + k * 2, 0, cz0 - 2, 0.6, 1.2 + rng() * 0.8, 0.6, 'L8:wall', { color: 0x231f1c });
    b.plane(cx0, 0.02, cz0, 2.2, 2.2, 'kit:glow', { facing: 'up', color: [0.5, 0.05, 0.5], glow: 0.2 });
    const w = b.world(cx0, cz0);
    (b.data.hazSite || (b.data.hazSite = [])).push({ x: w.x, z: w.z, r: 5, kind: 'sanity' });
  } else if (key === 'kavragost') {
    // 依据 landmarks「卡维戈斯特小镇：此前约 500 人口，现已废弃、无生命迹象」——空荡的居所轮廓，无实体、无声响
    for (let k = 0; k < 3; k++) {
      const bx = cx0 - 6 + k * 5, bz = cz0 - 3;
      b.box(bx, 0, bz, 2.6, height * 0.7, 2.6, 'L8:wall', { faces: 'sides' });
      kit.prop.door(b, bx, bz + 1.3, 0, { style: 'wood', w: 0.9, solid: false, color: 0x3a3428 });
    }
  }

  kit.gridSpawns(b, g, { safe: true });   // 据点内一律安全点，不刷有害实体（TEMPLATE 12 节 safe 点规则）
  return g;
}

// ============================================================
// 出生点：第九大道起点的入口水池（依据 layout「第九大道起于 Level 6 的入口水池」+ Level 6/7 已实现的出口都指向这里）
// ============================================================
function buildSpawnChunk(b, rng, height) {
  const g = kit.grid(b, N, N, ROAD);
  g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
  g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J);
  g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor' });
  // 入口水池：Level 6 的洞、Level 7 的海底山水下洞穴都通到这里，用一小片安全的杏仁水塘表现「入口水池」
  const pc = g.center(SPAWN_I, SPAWN_J + 1);
  kit.prop.puddle(b, pc.x, pc.z, 0, { rx: 1.3, rz: 1.1, color: 0x3a6a72 });
  kit.prop.sign(b, g.center(SPAWN_I + 2, SPAWN_J).x, g.center(SPAWN_I + 2, SPAWN_J).z, Math.PI / 2, { w: 0.6, h: 0.2, y: 1.9, backColor: 0x2a3a2a, color: 0x9fe89f });
  scatterSpikes(b, g, rng, height, true, 0x8f857a);
  buildRoadDecor(b, g, 0);
  exitToNine(b, 0);
  kit.gridSpawns(b, g, { safe: true });
  return g;
}

// ============================================================
// 第九大道（非据点、非出生点）：普通路段
// ============================================================
function buildRoadChunk(b, rng, height, cx) {
  const g = kit.grid(b, N, N, ROAD);
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L8:ceil', y: height });
  scatterSpikes(b, g, rng, height, true, 0x8f857a);
  buildRoadDecor(b, g, cx);

  const tarRoll = rng();
  if (tarRoll < 0.06) buildTarPit(b, g, rng);
  const nestRoll = rng();
  if (nestRoll < 0.03) buildSpiderNest(b, g, rng);

  exitToNine(b, cx);
  return g;
}

// ============================================================
// 罗特尼斯大丛林近环
// ============================================================
function buildJungleChunk(b, rng, height, cx) {
  const g = kit.grid(b, N, N, HALLREGION);
  const col = biomeColor('jungle');
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false, color: col.wall });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor', color: col.floor });
  scatterSpikes(b, g, rng, height, false, col.wall);
  buildJungleDecor(b, g, rng, height);

  const tarRoll = rng(); if (tarRoll < 0.05) buildTarPit(b, g, rng);
  const nestRoll = rng(); if (nestRoll < 0.04) buildSpiderNest(b, g, rng);
  const instrRoll = rng(); if (instrRoll < 0.03) buildInstrumentRoom(b, g, rng, height);

  exitToTwo(b, cx);
  return g;
}

// ============================================================
// 巨臂林地
// ============================================================
function buildArmWoodlandChunk(b, rng, height) {
  const g = kit.grid(b, N, N, HALLREGION);
  const col = biomeColor('arm_woodland');
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false, color: col.wall });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor', color: col.floor });
  scatterSpikes(b, g, rng, height, false, col.wall);
  buildArmWoodlandDecor(b, g, rng, height);

  // 依据 weather「自成天气：极光、常有风雨、偶尔雷暴」——用一片高处缓慢变色的辉光面片近似极光，不做真实降水系统
  const auroraRoll = rng();
  if (auroraRoll < 0.5) {
    const piece = b.plane(SIZE / 2, height - 0.3, SIZE / 2, SIZE * 0.8, SIZE * 0.8, 'kit:glow', { facing: 'down', color: [0.25, 0.5, 0.35], glow: 0.15 });
    b.update((dt, t) => {
      const h = (t * 0.05) % 1;
      const c = h < 0.5 ? [0.2 + h * 0.4, 0.5, 0.5 - h * 0.3] : [0.4, 0.6 - (h - 0.5) * 0.4, 0.3 + (h - 0.5) * 0.6];
      if (piece.setColor) piece.setColor(c, 0.18);
    });
  }

  const tarRoll = rng(); if (tarRoll < 0.06) buildTarPit(b, g, rng);
  const floatRoll = rng(); if (floatRoll < 0.06) buildFloatingRock(b, g, rng, height);
  const hotRoll = rng(); if (hotRoll < 0.04) buildHotPocket(b, g, rng);
  const nestRoll = rng(); if (nestRoll < 0.04) buildSpiderNest(b, g, rng);

  exitCeilingCut(b, g, rng, height);
  return g;
}

// ============================================================
// 新莫维勒窟
// ============================================================
function buildMauvilleChunk(b, rng, height) {
  const g = kit.grid(b, N, N, MAUVILLE);
  g.carve(1, 1, N - 2, N - 2, { room: true });   // 依据「大约一个足球场大」——单个开阔洞室
  const col = biomeColor('mauville');
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false, color: col.wall });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor', color: col.floor });
  scatterSpikes(b, g, rng, height, false, col.wall);
  buildMauvilleDecor(b, g, rng);

  const w = b.world(SIZE / 2, SIZE / 2);
  (b.data.mauville || (b.data.mauville = [])).push({ x: w.x, z: w.z, r: SIZE * 0.6 });

  const tarRoll = rng(); if (tarRoll < 0.04) buildTarPit(b, g, rng);
  const hotRoll = rng(); if (hotRoll < 0.08) buildHotPocket(b, g, rng);
  return g;
}

// ============================================================
// 多维之路
// ============================================================
function buildHyperspaceChunk(b, rng, height) {
  const g = kit.grid(b, N, N, HYPERSPACE);
  const col = biomeColor('hyperspace');
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false, color: col.wall });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor', color: col.floor });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L8:ceil', y: height });
  scatterSpikes(b, g, rng, height, true, col.wall);
  buildHyperspaceDecor(b, g, rng);

  const tarRoll = rng(); if (tarRoll < 0.03) buildTarPit(b, g, rng);
  exitSilverTunnel(b, g, rng);
  return g;
}

// ============================================================
// 普通天然岩洞通道/断层室
// ============================================================
function buildGenericChunk(b, rng, height) {
  const g = kit.grid(b, N, N, GENERIC);
  kit.gridWalls(b, g, { matKey: 'L8:wall', height, trim: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L8:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L8:ceil', y: height });
  scatterSpikes(b, g, rng, height, true, 0x8f857a);

  const tarRoll = rng(); if (tarRoll < 0.06) buildTarPit(b, g, rng);
  const floatRoll = rng(); if (floatRoll < 0.05) buildFloatingRock(b, g, rng, height);
  const nestRoll = rng(); if (nestRoll < 0.05) buildSpiderNest(b, g, rng);
  const instrRoll = rng(); if (instrRoll < 0.025) buildInstrumentRoom(b, g, rng, height);

  exitWallCut(b, g, rng);
  exitFloorHole(b, g, rng);
  return g;
}

// ============================================================
// 主入口
// ============================================================
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const region = regionAt(ctx.levelSeed, cx, cz);
  const site = region === 'road9' ? siteAt(cx, cz) : null;
  const height = (region === 'jungle' || region === 'arm_woodland' || region === 'mauville') ? H_HALL : H_TUNNEL;
  const b = kit.builder(ctx, cx, cz, rng, { height });

  let g;
  if (isSpawn) g = buildSpawnChunk(b, rng, height);
  else if (site) g = buildSiteChunk(b, cx, cz, rng, site, height);
  else if (region === 'road9') g = buildRoadChunk(b, rng, height, cx);
  else if (region === 'jungle') g = buildJungleChunk(b, rng, height, cx);
  else if (region === 'arm_woodland') g = buildArmWoodlandChunk(b, rng, height);
  else if (region === 'mauville') g = buildMauvilleChunk(b, rng, height);
  else if (region === 'hyperspace') g = buildHyperspaceChunk(b, rng, height);
  else g = buildGenericChunk(b, rng, height);

  if (!site && !isSpawn) kit.gridSpawns(b, g, { safe: region === 'road9' });
  return b.finish();
}

// ============================================================
// 层级状态、危害与 M.E.G. 生存建议（enter/update/leave，第 14 节）
// ============================================================
const S = {
  timer: 0, region: 'road9', hazTimer: 0, mauvilleTime: 0, mauvilleWarned: false, mauvilleIn: false, mauvilleTickAt: 0,
  tipIdx: 0, infectUntil: -1, infectTickAt: 0, unsubDamage: null,
};
// 依据 mechanics「M.E.G. 生存建议 8 条」——原文逐条列出，按固定顺序循环提示
const MEG_TIPS = [
  'M.E.G. 生存建议①：尽量待在第九大道上',
  'M.E.G. 生存建议②：多喝水、注意保暖、不要睡着',
  'M.E.G. 生存建议③：不要碰浮空的岩石',
  'M.E.G. 生存建议④：尊重这里的原住民',
  'M.E.G. 生存建议⑤：留意瓦斯浓度',
  'M.E.G. 生存建议⑥：祷告',
  'M.E.G. 生存建议⑦：避开蜘蛛的巢穴——它们不擅长游泳，跳进最近的水里也许能甩掉',
  'M.E.G. 生存建议⑧：了解悲尸传染的样子，被抓到就麻烦了',
];
const TIP_INTERVAL = 150;      // 依据 other「M.E.G. 标牌…指路」——巡回提示间隔，原文没给数字，取不算频繁的自定节奏
const MAUVILLE_LIMIT = 3600;   // 依据 mechanics「新莫维勒窟滞留不超过一小时」——精确数字，直接对应游戏内秒数

function scanHaz(kind, radius2, cb) {
  for (const c of BR.world.chunks()) {
    const arr = c.res && c.res.data && c.res.data[kind];
    if (!arr) continue;
    for (const p of arr) {
      const dx = BR.player.x - p.x, dz = BR.player.z - p.z;
      const r2 = p.r != null ? p.r * p.r : radius2;
      if (dx * dx + dz * dz < r2) cb(p);
    }
  }
}

BR.levels.register({
  id: '8', name: 'Level 8', title: '岩洞系统', nickname: '岩洞系统',
  version: 'wikidot-cn',
  survivalClass: '4 级 — 极难逃离 / 极端环境风险 / 极多敌意存在',
  chunkSize: SIZE,
  env: {
    // 依据 architecture/lighting「天然岩洞…极暗；生物光在'如墨漆黑'中隐隐闪烁」——背景取近黑，但不是纯黑（下面 ambient 说明）
    background: 0x06060a, fogColor: 0x06060a, fogNear: 2.5, fogFar: 34,
    // 依据 lighting「极暗；100 流明手电在此只剩约 12 流明」，同时 issue① 教训：color 必须是正常亮度色调、靠 intensity 压暗，
    // 不能把 color 本身调近黑。冷蓝绿色（呼应生物荧光的整体基调）× 低强度：有效亮度 ≈ 0.622 × 0.21 ≈ 0.13，
    // 落在"最暗但能看路"的 0.12–0.15 区间，比 Level 6（0.14，"永久黑暗"）略暗一点点，因为本层明确写了手电还能用（只是弱），
    // 不是 Level 6 那种"光源一进来就熄灭"，两者的暗法不同、数值也不该完全照抄
    ambient: { color: 0x8fae9f, intensity: 0.21 },
    sanityDrainMul: 2.0,   // 依据 survivalClass「极难逃离/极端环境风险/极多敌意存在」——Class 4，取 TEMPLATE"危险"档上限
    hungerDrainMul: 1,     // temperature 字段冷热区并存、没有能换算的统一数值，冷热分别做成局部危害（见 update），不整体加成
    audio: 'cave',         // 依据 sounds「回音异常响亮（熵效应）」——预设表里现成的洞穴回声音景
    darkness: false,       // 依据：本层是"极暗但手电仍能用"，不是 Level 6 那种"光源封锁"的无光层，不套用 darkness 标记
  },
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据：entities[Wranglers]「体长一英里甚至更长…日常频率未写，仅有极端历史个案」——没有常规频率数字，
    // 只描述罕见的巨大个体，定性取「rare」；js/entities/wrangler.js 按雌雄二态拆成两个 type（没有单一的 'wrangler'
    // type），选中版本没给雌雄比例，参照 L1.js/L5.js 已用过的 60/40 split（雄性面部更接近人形、更常被当作主要威胁形态）
    { type: 'wrangler_male', officialPer1000m2: BR.config.densityWords.rare * 0.6 },
    { type: 'wrangler_female', officialPer1000m2: BR.config.densityWords.rare * 0.4 },
    // 依据：entities[Arachnids]「成片区域被完全占领，成千上万只」+ entityDensityOverall「蛛形纲成千上万」——版本原文
    // 用词是全篇最极端的数量级，取「extreme」；js/entities/arachnid.js 没有单一的 'arachnid' type，按形蛛/皇后蛛/
    // 弗兰肯蜘蛛拆成三个 type（该文件自己选中的是 entity-39 旧版页面，登记的是三类蜘蛛本身的形态差异，不是本层
    // 页面另外描述的比例）：形蛛（普通个体）占绝大多数，弗兰肯蜘蛛（强化个体，对应「可能巨大化、超强毒液、高速
    // 再生」）少量，皇后蛛（蛛巢核心）最少
    { type: 'arachnid_common', officialPer1000m2: BR.config.densityWords.extreme * 0.86 },
    { type: 'arachnid_franken', officialPer1000m2: BR.config.densityWords.extreme * 0.11 },
    { type: 'arachnid_queen', officialPer1000m2: BR.config.densityWords.extreme * 0.03 },
    // 依据：entities[Wretches]「在过载贫瘠区等荒凉营地中扩散，无数字」——集中在特定聚落而非全层泛滥，取「low」
    { type: 'wretch', officialPer1000m2: BR.config.densityWords.low },
    // 依据：entities[Death Rats]「罗特尼斯穴顶，'众多'」
    { type: 'death_rat', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Deathmoths]「新莫维勒窟、巨臂林地，'大量'；雌性领地意识强」——js/entities/deathmoth.js 按雌/雄/
    // 禁卫拆成三个 type，选中版本没提到「禁卫」这个特化亚型（那是别的层级/版本的细节），只用雌雄二态，参照
    // L5.js 的比例（雌性领地意识强、更常遇到，取比雄性重）
    { type: 'deathmoth_female', officialPer1000m2: BR.config.densityWords.high * 0.6 },
    { type: 'deathmoth_male', officialPer1000m2: BR.config.densityWords.high * 0.4 },
    // 依据：entities[Scits]「巨臂林地，'大量'」
    { type: 'scit', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Dunks]「巨臂林地，'大量'」
    { type: 'dunk', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Light Guides]「多维之路，'无数'发光生物中的一员，无具体数字」——友善且局限在多维之路的狭窄通道，
    // 不是全层泛滥，取中档「moderate」
    { type: 'light_guide', officialPer1000m2: BR.config.densityWords.moderate },
    // 依据：entities[Camo Crawlers]「巨臂林地，'大量'」
    { type: 'camo_crawler', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Curabitur Birds]「新莫维勒窟，'大量'」
    { type: 'curabitur_bird', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Smilers]「巨臂林地，'大量'」
    { type: 'smiler', officialPer1000m2: BR.config.densityWords.high },
    // 依据：entities[Nguithr'xhurs]「巨臂林地，'大量'」
    { type: 'nguithrxurh', officialPer1000m2: BR.config.densityWords.high },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },   // 用户规则：所有模式都刷；也对应 items[Almond Water]「遍布岩洞的水池；洪水」
    { type: 'food_ration', per1000m2: 0.6 },    // 用户规则兜底：所有模式都刷食物；正文没有专门的可拾取食物条目
    { type: 'firesalt', per1000m2: 0.1 },       // data/item-spawn.json：明确把 Level 8（岩洞系统）列入分布范围
    { type: 'royal_rations', per1000m2: 0.01 }, // data/item-spawn.json：不限层级的极稀有物资
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },  // data/item-spawn.json：大多数层级都能找到但很少
    { type: 'moth_jelly', per1000m2: 0.01 },    // data/item-spawn.json：死亡飞蛾多的层级取更高档，本层正是其一
  ],
  exits: [
    { to: '9',  kind: 'zone',   note: '沿第九大道，主推荐；离出生点 4 块起整块是出口 (exits[0])' },
    { to: '2',  kind: 'zone',   note: '罗特尼斯大丛林顶部通风管道，不建议（尸鼠众多）；jungle 环带 |cx|>=4 起整块是出口 (exits[1])' },
    { to: '41 或 91', kind: 'zone', note: '被拖入焦油坑，不可控，两个目标各半概率；范围外自动 sealed (exits[2])' },
    { to: '75', kind: 'noclip', note: '偶尔能找到被银色物质包裹的狭窄隧道，多维之路区域，范围外 sealed (exits[3])' },
    { to: '93', kind: 'noclip', note: '从几个特定洞穴的墙壁切出，普通岩洞区域，范围外 sealed (exits[4])' },
    { to: '203', kind: 'door', note: '四号营地（哈莫兹据点）附近的门，不建议（Level 203 没有出口），范围外 sealed' },
    { to: '205', kind: 'noclip', note: '抱着明确目的从洞穴顶部切出，巨臂林地区域，范围外 sealed（近似成高处墙面切口，见 apiRequests）(exits[6])' },
    { to: '69', kind: 'hole', note: '从地面掉出，普通岩洞区域，范围外 sealed (exits[7])' },
  ],
  enter(ctx) {
    S.timer = 0; S.region = 'road9'; S.hazTimer = 0; S.mauvilleTime = 0; S.mauvilleWarned = false; S.mauvilleIn = false; S.mauvilleTickAt = 0;
    S.tipIdx = 0; S.infectUntil = -1; S.infectTickAt = 0; S._nextTip = 0;
    S.rng = U.rng(ctx.levelSeed, 'L8-flavor');   // 浮空岩石崩塌判定用；不用 Math.random（联机双方要逐字节一致）
    BR.hud.toast('手电的光在这里弱得像蜡烛……回声却大得吓人', 3200);   // 依据 lighting/sounds
    if (BR.audio && BR.audio.play) BR.audio.play('static');
    // 依据 hazards「悲尸感染：接触会传染」——订阅玩家受伤事件，命中来源是悲尸就叠加一段持续的感染伤害
    S.unsubDamage = BR.bus.on('player:damage', (payload) => {
      const src = payload && payload.source;
      if (src && src.type === 'wretch' && S.infectUntil < S.timer) {
        S.infectUntil = S.timer + 20;   // 感染持续时间：原文没给数字，取一段够玩家紧张处理伤口的时长，非设定数值
        BR.hud.toast('伤口火辣辣的……感觉不太对劲，你被感染了', 2600);
      }
    });
    ctx && void ctx;
  },
  update(ctx, dt) {
    S.timer += dt;

    // ---------- M.E.G. 生存建议循环 ----------
    if (!S._nextTip || S.timer >= S._nextTip) {
      S._nextTip = S.timer + TIP_INTERVAL;
      BR.hud.toast(MEG_TIPS[S.tipIdx % MEG_TIPS.length], 3400);
      S.tipIdx++;
    }

    // ---------- 感染持续伤害（依据 14 节：只在 attackPlayers 时扣血）----------
    if (S.infectUntil >= 0 && S.timer < S.infectUntil && S.timer >= S.infectTickAt) {
      S.infectTickAt = S.timer + 2;
      if (BR.game.attackPlayers) BR.player.damage({ hp: 2, sanity: 1, source: 'hazard:wretch-infection' });
    }

    // ---------- 新莫维勒窟滞留计时（依据 mechanics「不超过一小时」）；累计用每帧 dt，是否在区域内跟危害巡检
    // 共用同一条 0.5s 节流（TEMPLATE 16 节：level.update 里不建议每帧遍历区块列表）----------
    if (S.mauvilleIn) {
      S.mauvilleTime += dt;
      if (!S.mauvilleWarned && S.mauvilleTime > MAUVILLE_LIMIT * 0.7) { S.mauvilleWarned = true; BR.hud.toast('硫磺味越来越浓……在新莫维勒窟待太久可不是好主意', 3000); }
      if (S.mauvilleTime > MAUVILLE_LIMIT && S.timer >= S.mauvilleTickAt) {
        S.mauvilleTickAt = S.timer + 3;
        if (BR.game.attackPlayers) BR.player.damage({ hp: 3, sanity: 2, source: 'hazard:mauville-gas' });
      }
    } else { S.mauvilleTime = Math.max(0, S.mauvilleTime - dt * 2); if (S.mauvilleTime < MAUVILLE_LIMIT * 0.7) S.mauvilleWarned = false; }

    // ---------- 定时危害巡检（焦油/浮空岩石/高温/据点敌意/新莫维勒窟区域判定，0.5s 一次，节流以免每帧遍历区块）----------
    S.hazTimer += dt;
    if (S.hazTimer >= 0.5) {
      S.hazTimer = 0;
      S.mauvilleIn = false;
      scanHaz('mauville', 0, (p) => { void p; S.mauvilleIn = true; });
      // 焦油之手：站进去持续拖拽伤害（依据 hazards「拖入窒息」）
      scanHaz('tar', 1.2, () => {
        if (BR.game.attackPlayers) BR.player.damage({ hp: 4, sanity: 1, source: 'hazard:tar' });
        BR.gfx.flash(0x0c0906, 0.3, 0.4);
        if (BR.audio && BR.audio.play) BR.audio.play('hurt');
      });
      // 浮空岩石：靠近小概率崩塌砸伤（依据 hazards「最轻微一碰都可能瞬间崩塌」）；用层级自身的确定性 rng，不用 Math.random
      scanHaz('floatRock', 2.25, () => {
        if (BR.game.attackPlayers && S.rng() < 0.06) {
          BR.gfx.flash(0xccccbb, 0.25, 0.5);
          if (BR.audio && BR.audio.play) BR.audio.play('hit');
          BR.player.damage({ hp: 6, sanity: 1, source: 'hazard:floatrock' });
        }
      });
      // 高温区：持续灼烧（依据 temperature「达 43°C 以上」）
      scanHaz('hot', 1.0, () => { if (BR.game.attackPlayers) BR.player.damage({ hp: 1, sanity: 0, source: 'hazard:heat' }); });
      // 据点敌意范围：伤害型（BNTG/科尔珀洛斯）与精神污染型（过载贫瘠区/蒙面教会遗址）——固定据点坐标直接算，不用建临时数组
      for (const c of BR.world.chunks()) {
        const arr = c.res && c.res.data && c.res.data.hazSite;
        if (!arr) continue;
        for (const site of arr) {
          const dx = BR.player.x - site.x, dz = BR.player.z - site.z;
          if (dx * dx + dz * dz < site.r * site.r && BR.game.attackPlayers) {
            if (site.kind === 'damage') BR.player.damage({ hp: 2, sanity: 0, source: 'hazard:hostile-outpost' });
            else BR.player.damage({ hp: 0, sanity: 2, source: 'hazard:hostile-outpost' });
          }
        }
      }
    }

    // ---------- 音景区域标记（第九大道 vs 其余，仅用于 hud 提示，audio 预设本身全层统一用 'cave'）----------
    const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
    const region = regionAt(ctx.levelSeed, cc.cx, cc.cz);
    if (region !== S.region) {
      S.region = region;
      if (region === 'mauville') BR.hud.toast('空气里弥漫着硫磺和臭鸡蛋味……新莫维勒窟到了', 2800);
      else if (region === 'arm_woodland') BR.hud.toast('岩壁上布满了手掌形状的石钉，覆着一层暗红色的辉光苔藓……巨臂林地', 2800);
      else if (region === 'hyperspace') BR.hud.toast('狭窄的通道里飘着蓝绿色的荧光……多维之路', 2600);
      else if (region === 'jungle') BR.hud.toast('洞室骤然开阔，彩色的发光菌类爬满四壁……罗特尼斯大丛林', 2600);
      else if (region === 'road9') BR.hud.toast('脚下的路面平整了些——回到了第九大道', 2200);
    }
  },
  leave(ctx) {
    BR.hud.prompt(null);
    if (S.unsubDamage) { S.unsubDamage(); S.unsubDamage = null; }
    ctx && void ctx;
  },
});
})();

// ============================================================
// 没有实现/做了简化的细节及原因：
// 1) 蜂巢（landmarks「仅在'建议 #6：祷告'中出现，无位置与描述」）：原文没给位置和外观，按用户规则「选中版本没写的细节
//    就不做」，完全跳过，只保留 M.E.G. 生存建议⑥"祷告"这一句提示。
// 2) 罗特尼斯大丛林穴顶重力相反、尸鼠倒立栖息并借通风管道通向其他层级：引擎是单层 XZ 网格，没有"同一水平位置
//    在不同 Y 上各有一套可走地面"或"局部重力方向"的机制（apiRequests）。这里只做视觉近似（悬垂石钟乳、地面级
//    death_rat 密度仍按第 12 节全层统一投放），没有真正的倒转重力玩法。
// 3) 手电亮度 100→12 流明、电池迅速失效：引擎没有玩家手持光源/电池系统（apiRequests），只用极低的 env.ambient +
//    一次性 toast 表现"手电很弱"，不做可衰减的电池道具。
// 4) 熵增效应的其余表现（食物难以保存、路标极快分解、长期滞留者更快衰老）：没有食物保鲜期、路标耐久度、玩家
//    年龄这些系统可挂载，未实现，只在 mauville 滞留超时的危害里体现了"待太久会出事"的精神。
// 5) 非欧几何（路径绕回、原路不能返回）：没有做真正的空间折叠/传送，只用现有的无限程序化迷宫（本身已经是绕来
//    绕去、不同路线交错）近似，加一句 M.E.G. 生存建议之外的常规探索体验，不强行插入会打断联机同步的位置突变。
// 6) U.E.C. 科尔珀洛斯研究所、B.N.T.G. 3 号资源提取站等"敌对人类"：没有可用的人形 NPC/战斗实体（本批实体清单里
//    没有这类角色，NPC 对话也不做，用户规则），改成靠近据点范围受到伤害/精神污染的环境危害表现，不做可见的
//    人形守卫或战斗 NPC。
// 7) 哈莫兹洞穴社群"另外四个永久性基地"：原文只说了数量没给具体位置和外观区分，只实现了主基地（含四号营地附近
//    通往 Level 203 的门），其余三个未逐一建模。
// 8) 石钉的"八角支柱、订书机"等奇特形状、"潜水管（眼轮廓截面）"地形：叙事细节，没有对应几何做法，只保留最具
//    代表性的"人手形"（巨臂林地）与一般锥形石钟乳/石笋，其余形状未逐个还原。
// 9) 天然石乐器洞室：没有匹配的乐器音效（BR.audio 音效表里没有卡祖笛/小提琴等音色），只做了形状各异的石笋群，
//    没有可触发的声音。
// 10) 焦油坑触发浮空岩石崩塌的"接触即碰撞"没有做成真实物理判定，浮空岩石危害用固定小概率巡检近似，不是精确的
//     "碰一下"触发。
//
// apiRequests（引擎/kit 目前缺、只能近似实现的能力）：
// - 玩家手持光源（手电+电池）系统，以及"进入某层后手电变暗/失灵"的钩子。
// - 真正的多层 Y 向导航（同一水平位置上下两层都可走），用于罗特尼斯大丛林的穴顶倒转重力、巨臂林地"从洞穴顶部
//   切出"等设定。
// - 局部/可变重力方向。
// - 更细的伤害来源标签（当前 BR.player.damage 的 source 在实体攻击时是实体对象本身，本文件用 e.type==='wretch'
//   识别悲尸接触，可用但不如专门的"感染"标签直观）。
//
// 待实现物品（选中版本 items 里提到、但没有对应 js/items/ 文件，本层没有加进 items 表）：
//   氙弹珠（Xenon Marbles，微光向导的居所）——多维之路区域已做成纯装饰小球，没有可拾取效果；
//   燃油（Pyroil，Level 8 事件用于焚烧巨型牧蛇尸体）——历史事件道具，不是常规补给；
//   G9（B.N.T.G. 提取站产出，效果未写）；手电筒、电池驱动发热器、岩洞工作服——本游戏没有对应的装备/保暖系统；
//   天然石质乐器（卡祖笛/小提琴/吉他/长号/风铃/邦戈鼓）、蒙面教会遗址的受诅咒之物——叙事/装饰性道具，没有拾取
//   或使用效果，已在对应地标里做成不可拾取的场景装饰。
