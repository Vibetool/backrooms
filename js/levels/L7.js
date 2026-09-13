// Level 7 - "Thalassophobia"（深海恐惧症）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-7  许可：CC BY-SA 3.0
// 抓取：2026-09-12；页面顶部挂着"过时"提示，最后编辑于 2026-03-10；原作者 u/Bart0nius 与 u/M654z，后由 Bart0nius 重写
// 只按这一个版本实现：wikidot-cn 的重力异常写法（局部重力轴偏转/垂直浪墙）、fandom 的地堡/超纯水/寄生虫肉/无深度分带
// 等 conflicts 里列出的细节一律不借，选中版本没写的地方（颜色、声音细节、天气）就留空，不从别处补、不凭记忆编造
// （data/lore-choices.json levels["7"].source = "wikidot-en"）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸与尺度换算 ----------
// layout「无限开阔水域」+ scale 用千米描述深度（暮色带~1km、午夜带再下~3km、深渊>7km）：
// 引擎是米级世界，1:1 还原会把玩家困在几十公里纯色雾里走不到头，所以只对"垂直深度"定一个压缩比：
// 1 游戏米 = 250 真实米（下面三个 _Y 常量都是这么算出来的，注释里标好）。水平距离（西行 150 米去 Level 9）不压缩，照抄原数。
const RATIO = 250;
const SIZE = 40;              // chunkSize：开阔水域，用 32-48 档（_TEMPLATE.md 第16节），选 40
const H = 2.8;                // kit.builder 的层高参数，本层多数结构不用它，只是构件库要求的缺省值
const ROOM_Y = 4.5;           // scale「入口门廊距水面约 4.5 米」——原文给出的唯一精确数字，不压缩
const ROOM_H = 2.6;           // 房间层高：原文未给数字，参考"小房间"的常见高度，非设定
const TWILIGHT_Y = -(1000 / RATIO);          // -4：scale「暮色带约在水下 1 千米」
const MIDNIGHT_Y = -((1000 + 3000) / RATIO); // -16：scale「午夜带约在暮色带下方 3 千米」（1000+3000=4000m）
const ABYSS_Y = -(7000 / RATIO);             // -28：scale「深渊在 7 千米以下」
const ABYSS_FLOOR_Y = -34;    // 深渊底部落脚点：比 -28 更深一点，给出可站立的地面，原文没有更具体的数字

// ---------- 材质 ----------
function defineMaterials() {
  // architecture「很高的混凝土天花板」+「入口房间侧嵌进混凝土天花板里」：颜色 materials 段未注明（unverified），
  // 沿用引擎已有的 concrete 贴图，不新起色号
  kit.mat('L7:concrete', { tex: 'concrete', repeatMeters: 3, roughness: 0.9 });
  // materials「入口房间：地毯地面」：颜色未注明，取中性米棕色
  kit.mat('L7:carpet', { tex: 'carpet_l0', repeatMeters: 2, roughness: 1, color: 0xb9ab86 });
}

// ---------- 固定地标的世界坐标 ----------
// 除入口房间所在的出生块 (0,0) 外，其余地标都是"整层唯一一处"，用固定区块坐标摆放，不吃 rng（section 4.3：
// 特殊地标做成区块变体，出现位置本身不需要随机——原文给的也是"唯一一个"这种描述，不是"到处都有"）。
// 深渊竖井 buildAbyssShaft：区块 (0,1)，紧贴出生块南侧——landmarks「高耸海底山，几乎就在入口房间正下方」，
// 引擎只能水平移动，没法做到严格"正下方"，取门廊落水后最近的一块作为"几乎正下方"的近似，误差在注释里说明。
// Level 9 石柱环 buildNineRing：区块 (-4,0)，世界 x = -130（入口房间中心 x=20 再往西 150 米，entrances 段「以西约150米」）。
// Fort Surrender buildFortSurrender：区块 (2,1)，"已记录的最近一座岛"没给出精确坐标，就近取一个未被占用的区块。
// Level 880 孤舟 buildBoatDock：区块 (-8,0)，在石柱环再往西，呼应「乘船一路向西航行极远」。

// ---------- 自定义高度场（半径→高度，平移不变，chunk 内用本地坐标、heightField 里用世界坐标）----------
// 漏斗：r<=6 是深渊底（-34，falls Off，实现见下）；r 在 6..20 是斜坡（cone，从 -22 一路爬到 0，对应海面）
function funnelY(r) {
  if (r > 20) return undefined;
  if (r <= 6) return ABYSS_FLOOR_Y;
  return -22 + 22 * (r - 6) / 14;   // r=6 → -22（约在午夜带底部）；r=20（区块边界）→ 0，与外面的开阔海面齐平
}
function funnelHF(x, z) { return funnelY(Math.hypot(x - 20, z - 60)); }   // 圆心 = 区块 (0,1) 本地 (20,20) 对应的世界坐标

// 石柱环中央的浅坑：scale「水下约 150 米」压缩后只有 0.6 米，做成一个刚好能看出"沉下去一截"的小台阶
function nineY(r) { if (r > 10) return undefined; return -0.6 + 0.6 * (r / 10); }
function nineRingHF(x, z) { return nineY(Math.hypot(x + 130, z - 16)); } // 圆心世界 (-130, 16)

// Fort Surrender 所在的岩石小岛：landmarks「岩石岛屿：由未知岩石构成」，中心最高、边缘沉入海面
function fortY(r) { if (r > 14) return undefined; const t = Math.max(0, 1 - r / 14); return 1.6 * t * t; }
function fortHF(x, z) { return fortY(Math.hypot(x - 90, z - 70)); }      // 圆心世界 (90, 70)

// 入口房间地板：一块固定高度的平台，其余全是默认海面 0（section 11 多层结构写法）
const ROOM_HF = kit.heightField.flat({ minX: 17, maxX: 23, minZ: 14, maxZ: 19, y: ROOM_Y });

function zoneOf(feetY) {
  if (feetY >= ROOM_Y - 0.6) return 'entrance';
  if (feetY > TWILIGHT_Y) return 'daylight';
  if (feetY > MIDNIGHT_Y) return 'twilight';
  if (feetY > ABYSS_Y) return 'midnight';
  return 'abyss';
}

// ---------- 基础：每块都有的海面视觉 + 头顶远处的混凝土天花板 ----------
function buildSeaBase(b) {
  // layout「无限开阔水域」：水面既是视觉也是可走地面（引擎没有游泳/水体物理，见返回值 apiRequests），
  // 用半透明的 kit:water 表现水面反光，实际站立高度由高度场（默认 0）决定
  b.plane(SIZE / 2, 0.02, SIZE / 2, SIZE, SIZE, 'kit:water', { facing: 'up', solid: false });
  // architecture「头顶是很高的混凝土天花板」：原文没给具体高度，取一个视觉上"很高"但仍在雾内能隐约看见的值
  b.plane(SIZE / 2, 30, SIZE / 2, SIZE, SIZE, 'L7:concrete', { facing: 'down', solid: false });
}

// 撒刷新点：开阔场地不用格子，规则网格 + rng 抖动（_TEMPLATE.md 第 7.4 节），每块固定消耗 2×25 次 rng，
// 不管走哪个分支都在 buildChunk 最后调用，顺序恒定
function scatterSpawns(b, rng) {
  const n = 5, step = SIZE / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = (rng() - 0.5) * (step - 1), jz = (rng() - 0.5) * (step - 1);
      b.spawn((i + 0.5) * step + jx, (j + 0.5) * step + jz, 'floor');
    }
  }
}

// ---------- 入口房间（区块 (0,0)）----------
function buildEntranceRoom(b) {
  // architecture「入口房间：整个房间侧着嵌进混凝土天花板里」：四面墙+天花板都是承重的那块混凝土，用同一种材质
  b.box(20, ROOM_Y, 14, 6.25, ROOM_H, 0.25, 'L7:concrete', { faces: 'sides' });            // 北墙（背后是来处：楼梯）
  b.box(17, ROOM_Y, 16.5, 0.25, ROOM_H, 5, 'L7:concrete', { faces: 'sides' });             // 西墙
  b.box(23, ROOM_Y, 16.5, 0.25, ROOM_H, 5, 'L7:concrete', { faces: 'sides' });             // 东墙
  // 南墙留 1.8 米缺口——是"门廊"（landmarks「楼梯正对面的门廊直通下方海面」），不是门，不装门扇
  b.box(18.05, ROOM_Y, 19, 2.1, ROOM_H, 0.25, 'L7:concrete', { faces: 'sides' });
  b.box(21.95, ROOM_Y, 19, 2.1, ROOM_H, 0.25, 'L7:concrete', { faces: 'sides' });
  b.plane(20, ROOM_Y + ROOM_H, 16.5, 6.25, 5, 'L7:concrete', { facing: 'down' });
  // materials「地毯地面上积着水洼深浅的水」
  b.plane(20, ROOM_Y, 16.5, 6, 5, 'L7:carpet', { facing: 'up', solid: false });
  kit.prop.puddle(b, 18.6, 15.6, 0, { rx: 0.5, rz: 0.35, y: ROOM_Y + 0.006 });
  kit.prop.puddle(b, 21.3, 17.4, 0.6, { rx: 0.4, rz: 0.3, y: ROOM_Y + 0.006 });
  kit.prop.puddle(b, 19.8, 18.2, 1.1, { rx: 0.35, rz: 0.5, y: ROOM_Y + 0.006 });

  // materials「左墙书架（放着来源不明的书）」：面朝南进门方向，左手边＝西墙
  b.box(17.2, ROOM_Y, 16, 0.3, 1.6, 2.4, 'kit:prop', { color: 0x4a3a26 });
  for (let k = 0; k < 5; k++) {
    b.box(17.32, ROOM_Y + 1.3, 15.1 + k * 0.42, 0.12, 0.4, 0.32, 'kit:prop', { color: [0.32 + 0.08 * (k % 3), 0.22, 0.16 + 0.05 * k], solid: false });
  }
  // materials「小咖啡桌、一把椅子」
  b.box(20.3, ROOM_Y, 17.3, 0.7, 0.35, 0.5, 'kit:prop', { color: 0x3c2e1e });
  kit.prop.chair(b, 20.3, 18.2, Math.PI, { color: 0x2c2418 });
  // materials「荧光吊灯」：原文没提闪烁或色温，用普通日光色、不加 flicker
  kit.prop.lightPanel(b, 20, 16.5, 0, { y: ROOM_Y + ROOM_H, state: 'on', w: 0.9, d: 0.45, color: 0xeaf0ff, intensity: 0.85, range: 6 });
  // entrances「从 Level 6 走下楼梯进入入口房间」：纯装饰，选中版本 exits[] 里没有回 Level 6 这条，不建功能出口
  // depth 1.0 从 z=15.2 往北到 14.2，完全落在室内（北墙内表面在 z=14.125），不被墙体遮挡
  kit.prop.stairwell(b, 20, 15.2, 0, { down: false, w: 1.0, depth: 1.0, steps: 4, sign: false, solid: false });

  // mechanics「入口门廊重力突变……从约 4.5 米高处坠入水中」：门廊本身没有地板也没有墙，
  // 走出缺口后高度场立刻跌回默认海面 0，引擎的重力会自然把人带下去（不用额外做"力场"），这里只挂一次性提示
  let warned = false;
  b.update((dt) => {
    const P = BR.player;
    if (!warned && Math.abs(P.x - 20) < 1.6 && P.z > 18.2 && P.z < 19.8 && P.feetY > ROOM_Y - 0.3) {
      warned = true;
      BR.hud.toast('门廊外就是万丈虚空——脚下的重力好像要把你吸下去', 2600);
    }
  });
}

// ---------- 深渊竖井（区块 (0,1)）----------
function buildAbyssShaft(b) {
  const CX = 20, CZ = 20;   // 本地坐标里的漏斗圆心，对应世界 (20,60)，与 funnelHF 的圆心一致
  // 只是视觉标记，提示"这一圈在往下斜"，不对应精确带宽
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, r = 13, y = funnelY(r);
    b.cylinder(CX + Math.cos(a) * r, y, CZ + Math.sin(a) * r, 0.3, 2.6, 'kit:prop', { color: 0x332e28, segments: 6 });
  }
  // hazards「暮色带散落骨头与生锈金属碎片」「午夜带……另有超大鱼形骸骨」：固定几处碎片覆盖暮色→午夜带（r≈8.5-15）
  const bones = [[9, 0.2], [13, 2.9], [15, 5.3]];
  const metal = [[11, 1.6], [8.5, 4.1], [10, 0.9]];
  for (const [r, ang] of bones) {
    const x = CX + Math.cos(ang) * r, z = CZ + Math.sin(ang) * r, y = funnelY(r);
    b.box(x, y, z, 1.1, 0.2, 0.35, 'kit:prop', { color: 0xdcd6c4, rotY: ang });
  }
  for (const [r, ang] of metal) {
    const x = CX + Math.cos(ang) * r, z = CZ + Math.sin(ang) * r, y = funnelY(r);
    b.box(x, y, z, 0.5, 0.18, 0.5, 'kit:prop', { color: 0x7a4224, rotY: ang * 1.3 });
  }
  // landmarks「高耸海底山……山侧有一个水下洞穴」→ Level 8：放在漏斗喉部边缘（约午夜带底部）
  const doorAng = 0.5, doorR = 6.4, doorY = funnelY(doorR);
  kit.exit(b, {
    to: '8', kind: 'hole', x: CX + Math.cos(doorAng) * doorR, z: CZ + Math.sin(doorAng) * doorR, y: doorY,
    radius: 1.3, label: '山侧的水下洞穴 → Level 8', hole: { r: 1.3, rimColor: 0x2a241e },
  });
  // hazards「深渊：成山的焦油与岩石」+「深渊失去意识会被送到 Level 83（强烈不建议）」：喉部以内（r≤6）是深渊底
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + 0.3, r = 3;
    b.cylinder(CX + Math.cos(a) * r, ABYSS_FLOOR_Y, CZ + Math.sin(a) * r, 1 + (k % 2) * 0.3, 1.4 + (k % 3) * 0.5, 'kit:prop', { color: 0x0e0c0a, segments: 6, rTop: 0.25 });
  }
  // Level 83 不在首期范围（0-20/fun/run），kit 会自动 sealed，这里只摆地标 + 提示
  kit.exit(b, {
    to: '83', kind: 'zone', x: CX, z: CZ, y: ABYSS_FLOOR_Y, radius: 3,
    label: '深渊', marker: { color: [0.4, 0.15, 0.05], pulse: false },
  });
}

// ---------- Level 9 石柱环（区块 (-4,0)）----------
function buildNineRing(b) {
  const CX = 30, CZ = 16;   // 本地坐标，对应世界 (-130, 16)
  // landmarks「巨型水下管道和石柱围成一圈」：8 个位置交替摆石柱和管道
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, r = 8;
    const x = CX + Math.cos(a) * r, z = CZ + Math.sin(a) * r, y = nineY(r);
    if (k % 2 === 0) b.box(x, y, z, 0.7, 3.2, 0.7, 'kit:prop', { color: 0x5c554a, faces: 'sides' });
    else b.cylinder(x, y, z, 0.28, 3, 'kit:prop', { color: 0x6b6258, segments: 8 });
  }
  // 中央圆形石台
  b.cylinder(CX, nineY(0), CZ, 3.2, 0.3, 'kit:prop', { color: 0x716a5d, segments: 16 });
  // hazards「这里骸骨密集，被认为是 Tiny 最常待的地方」
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3, r = 2.2 + (k % 2) * 0.6;
    b.box(CX + Math.cos(a) * r, nineY(0) + 0.3, CZ + Math.sin(a) * r, 0.9, 0.18, 0.3, 'kit:prop', { color: 0xdcd6c4, rotY: a });
  }
  // exits「中央圆形石台地面上嵌着一扇木门」→ Level 9（在首期范围内，不会被 kit 自动 sealed）
  kit.exit(b, {
    to: '9', kind: 'hole', x: CX, z: CZ, y: nineY(0) + 0.3, radius: 1.4,
    label: '石台上的木门 → Level 9', hole: { r: 1.2, rimColor: 0x4a3a26 },
  });
}

// ---------- Fort Surrender（区块 (2,1)）----------
function buildFortSurrender(b) {
  const CX = 10, CZ = 30;   // 本地坐标，对应世界 (90, 70)
  // landmarks「岩石岛屿：由未知岩石构成」：几块粗糙岩石堆出岛体轮廓
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, r = 6 + (k % 2) * 2;
    b.cylinder(CX + Math.cos(a) * r, fortY(r) - 0.4, CZ + Math.sin(a) * r, 1.4, 1.2, 'kit:prop', { color: 0x5a544a, segments: 7, rTop: 1.0 });
  }
  // bases「用碎家具胡乱堆成、再用焦油粘合的简陋庇护所」：按用户规则（据点只摆静态外观，不做交互/交易/NPC对话），
  // 只搭一圈焦油浸黑的板材围挡，不建可进入的建筑
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2, r = 3.2, y = fortY(r);
    b.push(CX + Math.cos(a) * r, CZ + Math.sin(a) * r, a);
    b.box(0, y, 0, 0.5, 1.1 + (k % 3) * 0.3, 0.12, 'kit:prop', { color: 0x241e18 });
    b.pop();
  }
  // bases「传闻居民已转而崇拜 The Thing」：中心一根焦黑柱子暗示崇拜对象，不做可互动祭坛
  b.box(CX, fortY(0), CZ, 0.3, 1.5, 0.3, 'kit:prop', { color: 0x0e0c0a });
  let toasted = false;
  b.update(() => {
    const P = BR.player, dx = P.x - (b.ox + CX), dz = P.z - (b.oz + CZ);
    if (!toasted && dx * dx + dz * dz < 18 * 18) {
      toasted = true;
      BR.hud.toast('焦油糊起来的简陋营地——传闻这里的人已经不欢迎外来者', 2600);   // bases「居民传闻有敌意」
    }
  });
}

// ---------- Level 880 孤舟码头（区块 (-8,0)）----------
function buildBoatDock(b) {
  const CX = 20, CZ = 16;   // 本地坐标，对应世界 (-300, 16)
  // exits「乘船从入口房间向西航行极远的距离」——只是几个人的说法，未证实；不在首期范围内，自动 sealed
  b.push(CX, CZ, 0);
  for (let k = 0; k < 4; k++) b.box(-0.6 + k * 0.4, 0.05, 0, 0.35, 0.08, 3.2, 'kit:prop', { color: 0x4a3a26 });   // 简陋木栈道
  b.box(1.6, 0.3, 0, 1.6, 0.55, 3.4, 'kit:prop', { color: 0x3a2c1c });     // 船体（外形未设定，取普通小船轮廓，非设定）
  b.box(1.6, 0.75, -0.6, 1.3, 0.4, 1.6, 'kit:prop', { color: 0x241c12 }); // 船舱
  b.pop();
  kit.exit(b, {
    to: '880', kind: 'zone', x: CX + 1.6, z: CZ, radius: 2, label: '孤舟',
    marker: { color: [0.3, 0.25, 0.15], pulse: false },
  });
}

// ---------- 区块入口 ----------
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  buildSeaBase(b);
  if (cx === 0 && cz === 0) buildEntranceRoom(b);
  else if (cx === 0 && cz === 1) buildAbyssShaft(b);
  else if (cx === -4 && cz === 0) buildNineRing(b);
  else if (cx === 2 && cz === 1) buildFortSurrender(b);
  else if (cx === -8 && cz === 0) buildBoatDock(b);
  // 其余区块：开阔海面，不额外造景（岛屿等次要地标未实现，见返回值说明；原文对岛屿数量/间距本就没有规则）
  scatterSpawns(b, rng);
  return b.finish();
}

// ---------- 层级环境：入口房间 / 日光带 / 暮色带 / 午夜带 / 深渊 五档，随玩家垂直位置切换 ----------
// lighting「层级没有固定光源，只有弥漫的昏暗自然光」「日光带最亮」「暮色带明显变暗」「午夜带完全黑暗」
const ENTRANCE_ENV = {
  background: 0x241f18, fogColor: 0x241f18, fogNear: 4, fogFar: 50,   // 门廊正对面能看到海面，fogFar 留大一些
  ambient: { color: 0xfff0c8, intensity: 0.5 }, sanityDrainMul: 0.7, hungerDrainMul: 1, audio: 'fluorescent', darkness: false,
};
const DAYLIGHT_ENV = {
  background: 0x27424c, fogColor: 0x1c333c, fogNear: 6, fogFar: 65,
  ambient: { color: 0xbfe0ea, intensity: 0.5 }, sanityDrainMul: 1.1, hungerDrainMul: 1.1, audio: 'ocean', darkness: false,
};
const TWILIGHT_ENV = {
  background: 0x0e1e26, fogColor: 0x0a161c, fogNear: 3, fogFar: 34,
  ambient: { color: 0x5f8797, intensity: 0.22 }, sanityDrainMul: 1.4, hungerDrainMul: 1.25, audio: 'ocean', darkness: false,   // temperature「暮色带比日光带明显更冷」
};
const MIDNIGHT_ENV = {
  background: 0x000000, fogColor: 0x000000, fogNear: 0.6, fogFar: 15,   // hazards「黑暗：午夜带起完全无光」
  ambient: { color: 0x141b20, intensity: 0.04 }, sanityDrainMul: 2, hungerDrainMul: 1.3, audio: 'cave', darkness: true,
};
const ABYSS_ENV = {
  background: 0x000000, fogColor: 0x000000, fogNear: 0.3, fogFar: 9,   // hazards「水压：……深渊中极大」+「资料最少」
  ambient: { color: 0x0c0805, intensity: 0.02 }, sanityDrainMul: 2.6, hungerDrainMul: 1.4, audio: 'cave', darkness: true,
};
const ENV_BY_ZONE = { entrance: ENTRANCE_ENV, daylight: DAYLIGHT_ENV, twilight: TWILIGHT_ENV, midnight: MIDNIGHT_ENV, abyss: ABYSS_ENV };

const S = { rng: null, zone: 'entrance', bubbleT: 4 };

function enter(ctx) {
  S.rng = U.rng(ctx.levelSeed, 'L7-flavor');
  S.zone = 'entrance'; S.bubbleT = 4;
  kit.heightField(kit.heightField.stack(ROOM_HF, funnelHF, nineRingHF, fortHF)).install();
}

function update(ctx, dt) {
  const fy = BR.player.feetY;
  const z = zoneOf(fy);
  if (z !== S.zone) {
    const prev = S.zone; S.zone = z;
    const env = ENV_BY_ZONE[z];
    BR.gfx.applyEnv(env, BR.game.settings.visibility);
    if (BR.audio && BR.audio.setAmbient) BR.audio.setAmbient(env.audio, 1.4);
    if (prev === 'entrance' && z === 'daylight') {
      BR.hud.toast('你一头栽进冰冷的海水——没提前放绳子的话，几乎不可能再爬回门廊了', 3200);   // hazards「回不去」
    } else if (z === 'twilight') {
      BR.hud.toast('水温骤降，光线也跟着暗了下去', 2000);   // lighting「暮色带明显变暗」+ temperature「更冷」
    } else if (z === 'midnight') {
      BR.hud.toast('周围彻底黑透了——七层之物据说就潜伏在这片黑暗里', 2600);   // lighting「完全黑暗」+ entities「The Thing」
    } else if (z === 'abyss') {
      BR.hud.toast('你摔进了深渊……资料最少的地方，撑不了太久', 2600);   // hazards「深渊：资料最少，最长一次探索不到两分钟」
    }
  }
  // hazards「极低水温」+「水压：暮色带起已相当强，深渊中极大」：只在攻击判定打开时扣血（游玩/测试只做提示，不扣血）
  if (BR.game.attackPlayers) {
    const dmg = { entrance: 0, daylight: 0, twilight: 0.12, midnight: 0.4, abyss: 1.1 }[z];
    if (dmg > 0) BR.player.damage({ hp: dmg * dt, sanity: 0, source: 'hazard:cold-pressure' });
  }
  // sounds「深渊中来源不明、持续稳定的冒泡」：音效表没有专门的泡泡声，用 static 近似（见 apiRequests）
  if (z === 'abyss') {
    S.bubbleT -= dt;
    if (S.bubbleT <= 0) { S.bubbleT = 3 + S.rng() * 2.5; BR.audio.play('static', null, { volume: 0.22 }); }
  }
}

function leave() { BR.hud.prompt(null); }

BR.levels.register({
  id: '7', name: 'Level 7', title: 'Thalassophobia', nickname: '深海恐惧症',
  version: 'wikidot-en',
  survivalClass: '4',   // survivalClass「Survival Difficulty 4」
  chunkSize: SIZE,
  env: ENTRANCE_ENV,     // 出生在入口房间里，先用房间环境；落水后 update() 按垂直位置切到对应深度带
  spawn() { return { x: 20, y: 0, z: 16, yaw: Math.PI }; },   // 面朝南（+Z），正对门廊看出去就是海面
  buildChunk,

  // entities：entities[]「过去报告本层只有一个实体（The Thing），自 2019-04-18 起又多了 Tiny」——两者都是
  // "整层仅 1 个个体"的顶级掠食者；entityDensityOverall="rare"（BR.config.densityWords.rare=0.04）是原文给出的
  // 唯一定量线索，WAVE2 第 4 节的按面积密度公式本来就表示不了"全层恰好 1 个"这种单例，只能取最接近的定性词
  // 再对半分给两个物种（各自的地盘/行为由 js/entities/thing_on_level_7.js、tiny.js 自己实现，层级只给密度）
  entities: [
    { type: 'thing_on_level_7', officialPer1000m2: BR.config.densityWords.rare / 2 },
    { type: 'tiny', officialPer1000m2: BR.config.densityWords.rare / 2 },
  ],

  // items：选中版本本层没有写明任何食物或补水道具，杏仁水与食物按用户规则兜底刷出；
  // items[] 里的绳索/梯子/潜水装备/船/巨响道具/来源不明的书都不存在对应 js/items 文件，见文件末尾"待实现物品"
  items: [
    { type: 'almond_water', per1000m2: 1.2 },   // item-spawn.json：不限层级，用户规则所有模式都刷
    { type: 'food_ration', per1000m2: 0.6 },    // item-spawn.json：用户规则『所有模式都刷食物』的兜底
  ],

  exits: [
    { to: '8', kind: 'hole', note: 'exits[0]：潜到午夜带底部，几乎在入口房间正下方的海底山，山侧水下洞穴 → Level 8（首期范围内）' },
    { to: '9', kind: 'hole', note: 'exits[1]：入口房间以西约150米、下潜约150米，管道石柱环形阵中央石台的木门 → Level 9（首期范围内）' },
    { to: '83', kind: 'zone', note: 'exits[2]：潜入深渊并失去意识会被送到 Level 83；不在首期范围，只摆深渊地标+提示"尚未开放"' },
    { to: '880', kind: 'zone', note: 'exits[3]：几个人声称乘船一路向西航行极远后到达 Level 880（未证实）；不在首期范围，只提示"尚未开放"' },
  ],
  enter, update, leave,
});
})();

// ==================== 待实现物品（js/items 里没有对应文件，本层描述里出现过）====================
// Rope / Ladder（绳索/梯子）：hazards/mechanics 反复强调"没有它几乎回不了入口房间"，是本层最关键的道具，
//   但没有可参考的现有物品实现，且需要新的"可放置/可攀爬"交互能力，写进 apiRequests
// Diving gear（潜水装备）：原文说不带也能应付（长时间屏气），本层不强制需要
// Boat（船）：exits[3] 提到"乘船"，已在 Level 880 码头摆了静态船体，但船只是场景，不能真正驾驶（无载具系统）
// Noise-making objects（能制造巨响的物品）：mechanics「Tiny 听觉极强……可短暂压制」，需要 Tiny 自己的实体文件
//   提供"被巨响吓退"的钩子，且需要一件新道具，本层只在物品/密度层面留空，交给后续批次
// Books of unknown origin（来源不明的书）：入口房间书架已做静态场景，没有可拾取效果（原文也没说效果）
