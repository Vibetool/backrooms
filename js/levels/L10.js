// Level 10 "The Bumper Crop"
// 来源版本：fandom  URL：https://web.archive.org/web/20251216090901/https://backrooms.fandom.com/wiki/Level_10
// 许可：CC BY-SA 3.0
// backrooms-research/levels/level-10.json 记录：抓取的是 2025-12-16 09:09:01 UTC 的 web.archive.org 快照（MediaWiki revision
// 1064219），页面标题「Level 10: "The Bumper Crop" | Backrooms Wiki | Fandom」，署名 Egglord1 与 scutoid（第二张配图注明由 DALL-E 2 生成）
// 只按这一个版本实现：不借 wikidot-en/wikidot-cn 的逃离难度评分、Level 184（油菜地）出口、M.E.G. 定期收割小麦又停止的历史、
// 面粉增稠剂、湖边泥地与草地、树篱用灌木还是灌木丛的措辞差异、母亲装新木门阶/一家人煮粥昏倒后被烟呛醒逃向湖边的回忆情节——
// 这些都是 wikidot-en/wikidot-cn 独有或有冲突的细节，conflicts 里列了但一概不用
// （data/lore-choices.json levels["10"].source = "fandom"）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// file:// 双击打开时贴图不能读盘，注册一个简单的程序化兜底（15节步骤7），避免洋红占位图
BR.assets.registerProcedural('l10_soil', 128, (g, s) => {
  g.fillStyle = '#5a4630'; g.fillRect(0, 0, s, s);
  const r = U.rng('l10_soil');
  for (let k = 0; k < 500; k++) {
    const v = 60 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v},${v - 14},${v - 30},0.4)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
});

// ---------- 尺寸 ----------
// layout「开阔、无限：小麦与大麦田向四面八方无尽延伸」——开阔户外层，chunkSize 取 32-48 档的上段（第16节）
const SIZE = 44;
const H = 2.6;               // kit.builder 缺省高度参数，本层多数结构自己给 h，只是构件库要求的占位值

// ---------- 道路（每隔 ROAD_EVERY 块一条贯穿全层的东西向土路，cz ≡ 0）----------
// landmarks「土路：两道车辙夹一条草带……长距离沿路走通向 Level 11」：具体宽度未给数字（unverified），取一辆车轮距上下的宽度
const ROAD_EVERY = 8, ROAD_Z = SIZE / 2;
const RUT_W = 0.4, GRASS_W = 0.7;
const ROAD_HALF = RUT_W + GRASS_W / 2;
// exits[0]「找到一条路，长时间沿着它走」→ Level 11：没有距离数字（unverified）。原先整层只有 cz=0 一条路、路上只有 cx=2 一处出口，
// 走进田野深处或往西走的玩家永远出不去；改成每 ROAD_EVERY 块一条路、每条路上每 4 块一处整块 zone 出口（两个方向都有），
// 从任何地方最多走 4 块就能碰到路、沿路再走 2 块就到出口。在首期范围内（0-20），不会被 kit 自动 sealed
const EXIT11_EVERY = 4, EXIT11_CX = 2;
// exits[1]「越过与 Level 35 之间的边界」+ exits[3]「走得足够远逐渐进入 Level 83」：边界位置和外观都未描述（unverified），
// 只能近似成离出生点一定距离的方形边界（chebyshev 距离），越 35 近、83 更远，呼应「先到边界、再往前走更远才到 83」的顺序；
// 两个目标都不在首期范围（0-20/fun/run），kit 会自动 sealed，只摆 zone 标记+提示，不改道
const RING_35 = 8, RING_83 = 14;

// ---------- 材质 ----------
function defineMaterials() {
  // materials「土壤约 1 米厚、轻微疏水」，没给颜色（unverified），用中性偏暖褐色的耕地贴图；vertexColors 开着，
  // 给麦地/大麦地基底做一点点色调区分（buildGround 里用）
  kit.mat('L10:field', { tex: 'l10_soil', repeatMeters: 6, roughness: 1, vertexColors: true, color: 0xffffff });
  // materials「木建筑、木料、钉子」：复用已有的木纹理贴图，不占用本层新增贴图预算
  kit.mat('L10:wood', { tex: 'baseboard_wood', repeatMeters: 1.4, roughness: 0.92 });
  // 作物：程序化的"一簇麦秆 + 麦穗"灰白镂空贴图，顶点色染成金黄/黄绿；双面、alphaTest 镂空（不开 transparent，免排序开销）
  kit.mat('L10:crop', { type: 'lambert', map: stalkTexture(), alphaTest: 0.3, side: 'double', vertexColors: true, color: 0xffffff });
}

// ---------- 作物（成片小麦/大麦）----------
// 原先每丛是两块纯色长方形牌子，截图里像田里插满了浅色卡片，认不出是庄稼。现在：程序化画一张"一簇麦秆 + 叶片 + 麦穗和芒"的
// 灰白镂空贴图，两片交叉的四边形一丛，顶点色染成金黄/黄绿，同材质合并成一个 mesh；丛距缩到 1.15 m（低画质 1.6 m），远看连成一片。
// materials「小麦、大麦」并列描述且都是「大量过剩」，没给具体颜色号（unverified）：取常见成熟麦子的金黄/偏黄绿两档色系
// 做区分；没有比例数字，55/45 只是为了在无限田野里同时出现两种作物、打破网格感，不代表设定比例
const WHEAT_COLORS = [[0.92, 0.76, 0.34], [0.98, 0.82, 0.40], [0.84, 0.68, 0.28]];
const BARLEY_COLORS = [[0.80, 0.78, 0.38], [0.86, 0.83, 0.44], [0.74, 0.72, 0.33]];
// 株高：source 没给数字（unverified），取常见成熟麦类齐腰的高度，三档随机
const CROP_W = 1.2, CROP_HEIGHTS = [0.9, 1.0, 1.12];

let stalkTex = null, cropGeos = null;
function stalkTexture() {
  if (stalkTex) return stalkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = U.rng('L10-stalks');   // 固定种子：贴图每次一样
  g.lineCap = 'round';
  for (let k = 0; k < 34; k++) {
    const x = 8 + r() * 240, lean = (r() - 0.5) * 30, top = 22 + r() * 64;
    const v = 190 + ((r() * 60) | 0);
    const tipX = x + lean, tipY = top + 22;
    // 秆：底部略暗，微微弯
    g.strokeStyle = 'rgb(' + (v - 30) + ',' + (v - 30) + ',' + (v - 30) + ')';
    g.lineWidth = 3.2 + r() * 1.4;
    g.beginPath(); g.moveTo(x, 256); g.quadraticCurveTo(x + lean * 0.25, 160, tipX, tipY); g.stroke();
    // 叶：秆中下部两道斜出的细长叶
    g.lineWidth = 2.2;
    for (let q = 0; q < 2; q++) {
      const ly = 200 - q * 45 - r() * 20, lx = x + lean * (1 - ly / 256) * 0.6, dir = q % 2 ? 1 : -1;
      g.beginPath(); g.moveTo(lx, ly); g.quadraticCurveTo(lx + dir * 10, ly - 16, lx + dir * 20, ly - 12 - r() * 10); g.stroke();
    }
    // 穗：秆顶细长椭圆，两侧几根芒
    g.fillStyle = 'rgb(' + Math.min(255, v + 25) + ',' + Math.min(255, v + 25) + ',' + Math.min(255, v + 25) + ')';
    g.beginPath(); g.ellipse(tipX, tipY - 12, 5, 17, lean * 0.012, 0, Math.PI * 2); g.fill();
    g.strokeStyle = g.fillStyle; g.lineWidth = 1.6;
    for (let a = 0; a < 5; a++) {
      const ay = tipY - 24 + a * 6, dir = a % 2 ? 1 : -1;
      g.beginPath(); g.moveTo(tipX + dir * 3, ay); g.lineTo(tipX + dir * 11, ay - 11); g.stroke();
    }
  }
  stalkTex = new THREE.CanvasTexture(c);
  stalkTex.encoding = THREE.sRGBEncoding;
  return stalkTex;
}

// 一丛 = 两片交叉的四边形，底边在 y=0；三档高度各一份几何，全体区块共享（不释放，总共几十个顶点）
function cropGeometries() {
  if (cropGeos) return cropGeos;
  const merge = THREE.BufferGeometryUtils.mergeBufferGeometries;
  cropGeos = CROP_HEIGHTS.map(h => {
    const a = new THREE.PlaneGeometry(CROP_W, h).translate(0, h / 2, 0);
    const b2 = a.clone().rotateY(Math.PI / 2);
    const m = merge([a, b2]);
    a.dispose(); b2.dispose();
    return m;
  });
  return cropGeos;
}

// 作物只是视觉、不参与碰撞：用独立的随机数流，高低画质丛数不同也不会改变后面刷新点/建筑的随机序列（联机双方仍一致）
function buildCrops(b, ctx, cx, cz, crop, exclude) {
  const palette = crop === 'wheat' ? WHEAT_COLORS : BARLEY_COLORS;
  const low = BR.game && BR.game.settings && BR.game.settings.quality === 'low';
  const spacing = low ? 1.6 : 1.15;
  const r = U.rng(ctx.levelSeed, 'L10-crop', cx, cz);
  const geos = cropGeometries();
  const n = Math.round(SIZE / spacing), step = SIZE / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = (r() - 0.5) * step * 0.8, jz = (r() - 0.5) * step * 0.8;
      const skip = r(), gi = (r() * geos.length) | 0, col = palette[(r() * palette.length) | 0], rot = r() * Math.PI;
      const x = (i + 0.5) * step + jx, z = (j + 0.5) * step + jz;
      if (skip < 0.04) continue;                     // 少量空隙，避免过于规整的网格感
      if (exclude && exclude(x, z)) continue;       // 道路/湖泊/建筑地基/挖坑腾出的空地，不种庄稼
      b.mesh(geos[gi], 'L10:crop', { x, y: 0, z, rotY: rot, uv: 'stretch', color: col });
    }
  }
}

// ---------- 地面基底 ----------
function buildGround(b, crop) {
  const tint = crop === 'wheat' ? [1.05, 0.98, 0.86] : [1.0, 1.02, 0.9];   // 麦地/大麦地土壤基底极轻微的暖色差，纯视觉过渡
  b.plane(SIZE / 2, 0, SIZE / 2, SIZE, SIZE, 'L10:field', { facing: 'up', solid: false, color: tint });
}

// ---------- 土路：两道车辙夹一条草带 ----------
function buildRoad(b) {
  const dirt = [0.32, 0.24, 0.16];
  // mechanics「不会重新长草，种子不发芽」：颜色固定不做枯荣变化
  const grass = [0.16, 0.26, 0.10];
  b.plane(SIZE / 2, 0.01, ROAD_Z - GRASS_W / 2 - RUT_W / 2, SIZE, RUT_W, 'kit:prop', { facing: 'up', solid: false, color: dirt });
  b.plane(SIZE / 2, 0.01, ROAD_Z + GRASS_W / 2 + RUT_W / 2, SIZE, RUT_W, 'kit:prop', { facing: 'up', solid: false, color: dirt });
  b.plane(SIZE / 2, 0.012, ROAD_Z, SIZE, GRASS_W, 'kit:prop', { facing: 'up', solid: false, color: grass });
}

// ---------- 树篱：把田野分成地块（只在纯田野区块里做两道，避免和道路/建筑/湖泊冲突，也不追求跨区块严丝合缝）----------
// mechanics「树篱植物保持同一高度」：统一一个高度常量，没有给具体数字（unverified），取半人高——矮到能看见远处地标
const HEDGE_INSET = 3.2, HEDGE_H = 1.3, HEDGE_STEP = 0.85;
function buildHedgeLine(b, fixed, orientation, gapCenter, color) {
  const gapHalf = 1.3;
  for (let u = HEDGE_STEP / 2; u < SIZE; u += HEDGE_STEP) {
    if (Math.abs(u - gapCenter) < gapHalf) continue;   // 留一处缺口，人能走过去，不把地块围死
    const x = orientation === 'ns' ? fixed : u;
    const z = orientation === 'ns' ? u : fixed;
    b.box(x, 0, z, 0.6, HEDGE_H, 0.6, 'kit:prop', { color, faces: 'noBottom' });
  }
}
function buildHedgerow(b, rng) {
  const green = [0.18, 0.30, 0.12];   // materials「多种灌木构成的树篱」，没给颜色（unverified），取常见灌木绿
  const gapA = HEDGE_INSET + rng() * (SIZE - HEDGE_INSET * 2);
  buildHedgeLine(b, HEDGE_INSET, 'ns', gapA, green);
  const gapB = HEDGE_INSET + rng() * (SIZE - HEDGE_INSET * 2);
  buildHedgeLine(b, HEDGE_INSET, 'ew', gapB, green);
}

// ---------- 湖泊/水坑：与地面同一海拔（layout「水体处在同一海拔」），不用高度场，直接铺水面 ----------
function buildLake(b, rng) {
  const ox = SIZE * 0.32 + rng() * SIZE * 0.36, oz = SIZE * 0.32 + rng() * SIZE * 0.36;
  const rx = 8 + rng() * 5, rz = 7 + rng() * 4;
  // materials「水清澈、看似未受污染」：比 kit.prop.puddle 缺省的浑浊灰色更清亮
  kit.prop.puddle(b, ox, oz, 0, { rx, rz, y: 0.02, color: [0.32, 0.46, 0.47] });
  const r = Math.min(rx, rz);
  // hazards「游进湖里会进入若干水域层级（未指明）」：目标层级不确定，用非层级 ID 字符串，kit 判定不在 LEVEL_ORDER
  // 里自动 sealed；引擎没有游泳/潜水机制（见 apiRequests），这里只放一个湖心 zone 近似「游进去」
  kit.exit(b, {
    to: 'Unknown Aquatic Level', kind: 'zone', x: ox, z: oz, radius: r * 0.55,
    label: '游进湖心', sealedText: '通向哪个水域层级还没研究清楚，暂时游不过去',
  });
  return { x: ox, z: oz, r: r + 1.5 };
}

// ---------- 挖坑：土层只有 1 米深，下面是蠕虫团 ----------
// hazards「挖超过 1 米：蠕虫迅速涌出，可能导致滑倒或摔伤、弄坏衣物，还有蠕虫试图钻进皮肤；建议只挖小洞」
// 引擎没有"挖掘"这个交互动作（见 apiRequests），近似成：田野里偶尔能看到一处已经挖穿的旧坑，蠕虫团还挤在坑口，
// 站得太近会触发和原文一致的后果（滑倒/皮肤不适，只在 attackPlayers 时扣血）
function buildDigPit(b, rng) {
  const x = 6 + rng() * (SIZE - 12), z = 6 + rng() * (SIZE - 12);
  kit.prop.hole(b, x, z, 0, { r: 0.85, rimColor: 0x352a1a });
  for (let k = 0; k < 5; k++) {
    const a = rng() * Math.PI * 2, r2 = rng() * 0.5;
    b.cylinder(x + Math.cos(a) * r2, 0.03, z + Math.sin(a) * r2, 0.07 + rng() * 0.04, 0.1, 'kit:prop', { color: [0.16, 0.13, 0.08], segments: 6, solid: false });
  }
  const wx = b.ox + x, wz = b.oz + z;
  let warned = false;
  b.update((dt) => {
    const P = BR.player, dx = P.x - wx, dz = P.z - wz, d2 = dx * dx + dz * dz;
    if (d2 < 1.1 * 1.1) {
      if (!warned) { warned = true; BR.hud.toast('土层只有一米厚——这处早就挖穿了，蠕虫团正顺着裂缝往外挤', 2600); }
      if (BR.game.attackPlayers) BR.player.damage({ hp: 0.5 * dt, sanity: 0, source: 'hazard:soil-worms' });
    } else if (d2 > 2 * 2) warned = false;
  });
  return { x, z, r: 1.6 };
}

// ---------- 小棚屋/附属小屋 ----------
// architecture「零散分布木制小棚屋与附属小屋……内部大多空置，常存有木料和钉子」：尺寸/新旧程度都没写（unverified），
// 取够一两人站立走动的最小规模；屋顶用简单平顶，没有描述具体坡屋顶形状，不去臆造
function buildShack(b, rng) {
  const w = 3.4, d = 3.0, h = 2.3;
  const ox = 8 + rng() * (SIZE - 16), oz = 8 + rng() * (SIZE - 16);
  const rot = ((rng() * 4) | 0) * (Math.PI / 2);
  b.push(ox, oz, rot);
  b.box(0, 0, -d / 2, w, h, 0.08, 'L10:wood', { faces: 'sides' });   // 后墙
  b.box(-w / 2, 0, 0, 0.08, h, d, 'L10:wood', { faces: 'sides' });   // 左墙
  b.box(w / 2, 0, 0, 0.08, h, d, 'L10:wood', { faces: 'sides' });    // 右墙
  kit.prop.door(b, 0, d / 2, 0, { style: 'wood', w: 0.85, h: h - 0.25, wall: { matKey: 'L10:wood', w, h } });   // 前墙一次带门洞建好
  b.box(0, h, 0, w + 0.3, 0.1, d + 0.3, 'L10:wood', { color: 0x3c2e1c });   // 简单平顶
  // 「常存有木料和钉子」：散落的木料 + 一箱钉子（钉子太小，用小木箱抽象表示一箱五金件）
  kit.prop.crate(b, -0.9, -0.7, 0.3, { size: 0.4, color: 0x7a5c38 });
  b.box(0.6, 0.1, -0.6, 1.6, 0.12, 0.25, 'kit:prop', { color: 0x6a4d2e, rotY: 0.15 });
  b.box(0.7, 0.32, -0.55, 1.5, 0.12, 0.22, 'kit:prop', { color: 0x5c4326, rotY: -0.1 });
  b.pop();
  return { x: ox, z: oz, r: Math.max(w, d) / 2 + 1.4 };
}

// ---------- 较大的谷仓/马厩 ----------
// architecture「较大的谷仓和马厩……内部大多空置，常存有木料和钉子」：同一句话涵盖所有建筑类型的内部描述，
// 具体尺寸没写（unverified），谷仓取更高更方正、马厩取更长更低，只为区分体量，不代表设定尺寸，也不虚构马厩隔间等细节
function buildBigBuilding(b, rng, kind) {
  const isBarn = kind === 'barn';
  const w = isBarn ? 9 : 10, d = isBarn ? 6 : 4, h = isBarn ? 4.2 : 2.6;
  const ox = 10 + rng() * (SIZE - 20), oz = 10 + rng() * (SIZE - 20);
  const rot = ((rng() * 4) | 0) * (Math.PI / 2);
  b.push(ox, oz, rot);
  b.box(0, 0, -d / 2, w, h, 0.1, 'L10:wood', { faces: 'sides' });
  b.box(-w / 2, 0, 0, 0.1, h, d, 'L10:wood', { faces: 'sides' });
  b.box(w / 2, 0, 0, 0.1, h, d, 'L10:wood', { faces: 'sides' });
  const doorW = isBarn ? 2.4 : 1.6;
  kit.prop.door(b, 0, d / 2, 0, { style: 'wood', w: doorW, h: h - 0.4, wall: { matKey: 'L10:wood', w, h } });
  b.box(0, h, 0, w + 0.4, 0.12, d + 0.4, 'L10:wood', { color: 0x352a1a });
  for (let k = 0; k < 3; k++) {
    const px = -w / 2 + 1 + k * (w - 2) / 2, pz = -d / 2 + 1;
    b.box(px, 0.1 * k, pz, 1.8, 0.1, 0.3, 'kit:prop', { color: 0x6a4d2e, rotY: 0.1 * k });
  }
  kit.prop.crate(b, w / 2 - 1.2, -d / 2 + 1, -0.4, { size: 0.5, color: 0x7a5c38 });
  b.pop();
  return { x: ox, z: oz, r: Math.max(w, d) / 2 + 1.6 };
}

// ---------- 撒物品刷新点：网格 + 抖动（本层不用格子迷宫，第7.4节写法），每块固定候选点数，顺序恒定 ----------
function scatterSpawns(b, rng, exclude) {
  const n = 6, step = SIZE / n;   // 36 个候选点，减去排除区仍能满足"每块 ≥ 20 个"（第16节）
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = (rng() - 0.5) * (step - 1), jz = (rng() - 0.5) * (step - 1);
      const x = (i + 0.5) * step + jx, z = (j + 0.5) * step + jz;
      if (exclude && exclude(x, z)) continue;
      b.spawn(x, z, 'floor');
    }
  }
}

// ---------- 区块入口 ----------
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const mod = (v, m) => ((v % m) + m) % m;
  const isRoad = mod(cz, ROAD_EVERY) === 0;
  const cheb = Math.max(Math.abs(cx), Math.abs(cz));
  const isRing35 = cheb === RING_35;
  const isRing83 = cheb === RING_83;
  // 路上每 EXIT11_EVERY 块一处 Level 11 出口（东西两个方向都有）；和未开放的 35/83 边界块错开，免得两个大圈叠在一起
  const isExit11 = isRoad && mod(cx, EXIT11_EVERY) === EXIT11_CX && !isRing35 && !isRing83;

  // rng 消耗顺序固定：地块类型 → 作物种类 → 挖坑地标 →（分支内）建筑/湖泊细节 → 撒刷新点
  const rolled = U.weighted(rng, [['field', 0.79], ['shack', 0.10], ['barn', 0.04], ['lake', 0.07]]);
  const kind = isRoad ? 'field' : rolled;   // 道路所在的整行区块保持田野+道路，不放建筑/湖（landmarks 只说路贯穿田地）
  const cropRoll = rng();
  const crop = cropRoll < 0.55 ? 'wheat' : 'barley';
  const digRoll = rng();
  const hasDigPit = kind === 'field' && !isRoad && !isSpawn && digRoll < 0.08;

  const excludes = [];
  if (isRoad) excludes.push((x, z) => Math.abs(z - ROAD_Z) < ROAD_HALF + 0.4);

  let buildingInfo = null, lakeInfo = null, digInfo = null;
  if (kind === 'shack' && !isSpawn) buildingInfo = buildShack(b, rng);
  else if (kind === 'barn' && !isSpawn) buildingInfo = buildBigBuilding(b, rng, U.weighted(rng, [['barn', 0.55], ['stable', 0.45]]));
  else if (kind === 'lake' && !isSpawn) lakeInfo = buildLake(b, rng);
  if (buildingInfo) excludes.push((x, z) => Math.hypot(x - buildingInfo.x, z - buildingInfo.z) < buildingInfo.r);
  if (lakeInfo) excludes.push((x, z) => Math.hypot(x - lakeInfo.x, z - lakeInfo.z) < lakeInfo.r);
  if (hasDigPit) { digInfo = buildDigPit(b, rng); excludes.push((x, z) => Math.hypot(x - digInfo.x, z - digInfo.z) < digInfo.r); }
  const exclude = excludes.length ? (x, z) => excludes.some((f) => f(x, z)) : null;

  buildGround(b, crop);
  buildCrops(b, ctx, cx, cz, crop, exclude);
  if (isRoad) buildRoad(b);
  if (kind === 'field' && !isRoad && !isSpawn) buildHedgerow(b, rng);   // 出生块保持最典型的开阔田野样子（4.3节）

  if (isExit11) {
    kit.exit(b, { to: '11', kind: 'zone', x: SIZE / 2, z: ROAD_Z, radius: SIZE * 0.75, label: '沿着土路走了很久，眼前的农田变成了 Level 11' });
  }
  if (isRing35) {
    kit.exit(b, { to: '35', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.75, label: '与 Level 35 的边界', marker: { color: [0.55, 0.45, 0.2], pulse: false } });
  }
  if (isRing83) {
    kit.exit(b, { to: '83', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.75, label: '走得太远，田野好像要变成别的地方了', marker: { color: [0.3, 0.32, 0.36], pulse: false } });
  }

  scatterSpawns(b, rng, exclude);
  return b.finish();
}

// ---------- 环境：永远阴天白天，偶尔短暂小雨/雾 ----------
// lighting「永远是白天（unchanging state of daylight），阴天自然光」；colors「天空阴沉如铅（overcast, leaden）」
const ENV = {
  background: 0x8c9098, fogColor: 0x8c9098, fogNear: 10, fogFar: 80,   // fogFar ≤ chunkSize×2=88（第16节）
  ambient: { color: 0xe6e8e2, intensity: 0.62 },   // 阴天自然光，没有人工光源（lighting「人工光源未描述」），只给环境光
  // other「资源丰富、没有直接危险，被视为定居首选候选地」：san 消耗按安全区取值；temperature 全篇 unverified，hunger 不改
  sanityDrainMul: 0.6, hungerDrainMul: 1,
  audio: 'wind-field',   // sounds「只有偶尔一阵风吹过庄稼」——wind-field 预设本身就是阵风时强时弱，正好对应
  darkness: false,
};
// weather「气候不变：阴沉铅灰的天空，偶尔短暂的小雨和雾」：引擎没有天气粒子（见 apiRequests），
// 用短暂收紧雾距+调暗环境光近似"起雾下雨"，配合提示文字
const ENV_RAIN = Object.assign({}, ENV, {
  background: 0x6d7278, fogColor: 0x6d7278, fogNear: 4, fogFar: 30,
  ambient: { color: 0xc7cbc6, intensity: 0.42 },
});

const S = { rng: null, weather: 'clear', timer: 0 };

function enter(ctx) {
  S.rng = U.rng(ctx.levelSeed, 'L10-weather');
  S.weather = 'clear'; S.timer = 70 + S.rng() * 60;
  // mechanics「没有昼夜循环」+「难以计算时间」：不做任何随时间变化的光照，只在进层时提一句
  BR.hud.toast('永远阴沉的白天——很难说清这里已经过了多久', 2400);
}

function update(ctx, dt) {
  S.timer -= dt;
  if (S.timer > 0) return;
  if (S.weather === 'clear') {
    S.weather = 'rain'; S.timer = 20 + S.rng() * 25;   // weather「偶尔短暂的小雨和雾」：一次持续 20-45 秒
    BR.gfx.applyEnv(ENV_RAIN, BR.game.settings.visibility);
    BR.hud.toast('远处飘来一阵雾气和细雨', 2200);
  } else {
    S.weather = 'clear'; S.timer = 90 + S.rng() * 120;   // 大部分时间保持晴朗阴天（weather「气候不变」，雨雾只是偶尔）
    BR.gfx.applyEnv(ENV, BR.game.settings.visibility);
  }
}

function leave() { BR.hud.prompt(null); }

BR.levels.register({
  id: '10', name: 'Level 10', title: 'The Bumper Crop', nickname: 'The Bumper Crop',
  version: 'fandom',
  survivalClass: 'Threat Index: Class 1（Safe / Stable / Minimal Entity Count，无逃离难度评分）',
  chunkSize: SIZE,
  env: ENV,
  // entrances「Level 11 的某些街道上能找到一条通往 Level 10 的后路」：出生点摆在贯穿全层的土路上，呼应这条后路；
  // 另一条入口（Level 9 的人行道通向草地）没有更具体的落点描述，不额外表现
  spawn() { return { x: 6, y: 0, z: ROAD_Z, yaw: -Math.PI / 2 }; },   // 面朝东（+X），朝 Level 11 出口方向
  buildChunk,

  // entities：entity-index.json 里没有任何实体的 levels 数组包含 "10"。选中版本自己也只写了一种「无正式名称的类蠕虫
  // 实体」，note 明说「没有独立实体页……entities 链接到 Entity_List 总表」，按第12节规则「只列 entity-index.json 里
  // levels 含本层、且已注册的类型」，没有可注册的类型，entities: []。蠕虫本身"挖深会涌出"的行为按 hazard 在
  // buildDigPit + update 里近似实现，不是可生成/可战斗的独立实体（也符合 Threat Index「Minimal Entity Count」）。
  entities: [],

  items: [
    { type: 'almond_water', per1000m2: 1.2 },                          // item-spawn.json：不限层级，用户规则所有模式都刷
    { type: 'almond_water_blue', per1000m2: 0.06 },                    // item-spawn.json：彩色瓶稀有，蓝色最常见
    { type: 'almond_water_green', per1000m2: 0.04 },                   // item-spawn.json：绿色次之
    { type: 'almond_water_red', per1000m2: 0.002 },                    // item-spawn.json：红色全后室仅发现过 5 瓶
    { type: 'royal_rations', per1000m2: 0.01 },                        // item-spawn.json：极其稀有，随机出现在任意角落
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },                // item-spawn.json：稀有度 7/10，蓝色最常见
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },     // item-spawn.json：人工闪电比蓝色少
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },         // item-spawn.json：黑色闪电比蓝色更少
    { type: 'warpberries', per1000m2: 0.1 },                           // item-spawn.json：wikidot-en 记载研究人员在本层
                                                                        // 种活并繁殖了跳跃莓——这是这件物品自己的设定来源，和本层选中的 fandom 版本描述无关
    { type: 'moth_jelly', per1000m2: 0.003 },                          // item-spawn.json：极稀有，本层没有死亡飞蛾，
                                                                        // 属于"瓶罐装少量散落在其他层级"的分支
    { type: 'food_ration', per1000m2: 0.6 },                           // item-spawn.json：用户规则『所有模式都刷食物』的
                                                                        // 兜底——本层描述的小麦/大麦没有对应的可拾取物品文件（见文末"待实现物品"）
  ],

  exits: [
    { to: '11', kind: 'zone', note: 'exits[0]：找到一条路、长时间沿着它走 → Level 11（首期范围内；每 8 块一条土路，路上每 4 块一处整块 zone 出口，东西两个方向都有）' },
    { to: '35', kind: 'zone', note: 'exits[1]：越过与 Level 35 之间的边界，位置和外观都未描述 → 不在首期范围，摆在离出生点 8 个区块的方形边界上，自动 sealed' },
    { to: 'Unknown Aquatic Level', kind: 'zone', note: 'exits[2]：游进湖里 → 若干未指明的水域层级；目标未知，湖心 zone 出口始终 sealed（自定义 sealedText）' },
    { to: '83', kind: 'zone', note: 'exits[3]：在本层走得足够远，逐渐进入 Level 83；不在首期范围，摆在离出生点 14 个区块的方形边界上，自动 sealed' },
  ],
  enter, update, leave,
});
})();

// ==================== 待实现物品（js/items 里没有对应文件，本层描述里出现过）====================
// Wheat / Barley（小麦/大麦）：items[0][1]「遍布全层，大量过剩」，据探索者报告看起来能安全食用，但营养属性仍待调查，
//   摘下后不腐烂（访谈摘录）——本批只用环境里的作物景观（buildCrops）表现，没有对应的可拾取/可食用物品文件，
//   所有模式的食物兜底靠 food_ration（用户规则）
// Wood / Nails / Building structural elements（木料/钉子/建筑结构件）：items[3][4][5]「常存放在空置建筑中……可用于
//   建造」——本批只用静态场景（buildShack/buildBigBuilding 里的木料堆、钉子箱）表现，没有建造系统，也没有对应拾取物品
// Lake / pit water（湖水/水坑水）：items[2]「可安全饮用，有泥土味」——没有"就地取水饮用"的交互，只做了可见的湖面景观
//   （buildLake），需要新的"环境取水"能力，写进 apiRequests
// Worms (collectable)（可收集的蠕虫）：items[6]「挖小洞即可接触」，原文没说用途（unverified），
//   本批只把蠕虫团做成 buildDigPit 的装饰+危害表现，没有可拾取物品
