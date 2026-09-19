// Level 18 - "回忆"（Memories 的中文译名）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-18  许可：CC BY-SA 3.0
// environment.other 记录的署名链：原作者 u/Liam4Fingarz；1000dumplings 重新撰写；YellowISlol 再次重新撰写；译者 Dr Wingdings。
// 只按这个版本实现，data/lore-choices.json 的 levels['18'].conflicts 里属于其他版本的细节一律不借，包括：
//   不用 wikidot-en 的"过敏被抑制"措辞（中文译文本身没提过敏，直接按译文"被唤醒的记忆效应可通过未知方法抑制"实现）；
//   不用 fandom 版本：没有 Class Ψ 生存分级、没有"危险"分类，没有青春期早期记忆、没有低重力黑色虚空+跳跃移动，
//     没有露天住宅/公园/汽车室外场景，没有孤独绝望、十分钟坠落剧痛、无法睡眠、偏执效应世界变黑、必须持续喝杏仁水这些
//     危险机制（本版本明确写"层级本身没有任何威胁"），没有未命名的跟随实体（本版本的实体是具名的 The Plush Dino/毛绒恐龙），
//     没有提灯光源、没有唯一能带出层级的照片，没有 The Lost Crew/Upset Teenagers 据点（本版本据点是 The Children/孩子们），
//     没有在 Level 17 睡觉或 Level 897 温室的入口，没有黑暗走廊/掉入虚空/Level !、492、956、56、Fun、82、The Room、142
//     这些出口（本版本出口只有"转身到 Level 19"和"跟随毛绒恐龙到想去的层级"两条）。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- file:// 兜底（第 15 节）：双击打开 index.html 时贴图走程序化占位，避免洋红 ----------
BR.assets.registerProcedural('l18_wall_nursery', 256, (g, s) => {
  g.fillStyle = '#b0cdb4'; g.fillRect(0, 0, s, s);
  const r = U.rng('l18_wall_nursery');
  const shapes = ['#d9524a', '#e8c94a', '#4a90d9'];
  for (let k = 0; k < 5; k++) {
    g.fillStyle = shapes[k % shapes.length];
    g.fillRect((k + 0.5) * s / 5 - 8, s * 0.22, 16, 16);
  }
  for (let k = 0; k < 400; k++) {
    const v = 150 + (r() * 30 | 0);
    g.fillStyle = `rgba(${v - 30},${v},${v - 20},0.12)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
});

// 幼儿园地面：验收①指出原来用 carpet_light（和 Level 0 同款浅色地毯）+ 方格吊顶太像办公层，
// 改成彩色泡沫拼图地垫——没有现成贴图，也不占新增 jpg 的包体预算，直接用 canvas 画（规则⑩：没有 jpg 就必须 noFile）
BR.assets.registerProcedural('l18_floor_foam', 256, (g, s) => {
  // 用户 2026-09-19：原来四色饱和度太高，整间房铺满后很刺眼（幼儿园占本层 55% 的房间）。
  // 改成用旧了、晒褪色的泡沫垫配色——色相不变，饱和度压低、亮度提上去，仍然认得出是儿童地垫
  const cols = ['#c98a80', '#d9c795', '#93a8bf', '#98ae94'];
  const n = 4, cell = s / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) { g.fillStyle = cols[(i + j) % cols.length]; g.fillRect(i * cell, j * cell, cell, cell); }
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';   // 拼图咬合缝，纯装饰细节，不是设定（跟着配色一起调淡）
  for (let j = 0; j <= n; j++) g.fillRect(0, j * cell - 2, s, 4);
  for (let i = 0; i <= n; i++) g.fillRect(i * cell - 2, 0, 4, s);
}, { noFile: true });

// ---------- 尺寸 ----------
// 依据 environment.layout「按个人记忆生成的单个场景，原文没有描述迷宫/无限延伸/房间连接方式」——
// 不编造迷宫结构，每个区块做成一整间开敞的"记忆房间"（见下方 OPEN 格子参数），SIZE 取普通居家房间尺度
const SIZE = 20, N = 6;
const H = 2.8;   // 层高：environment.scale 原文未提及，用 kit 默认层高

// ---------- 布局：全层统一的开敞格子（只留边界墙，内部整块打通）----------
// 边界参数全层一致（TEMPLATE 7.2 节）；wallDensity/roomChance/loopChance/pillarChance 全 0 + 之后整块 carve，
// 所以"记忆类型"之间不需要靠内部墙密度区分，只靠材质/家具区分，边界连通规则天然保持一致
// boundaryDensity 验收⑤指出原来 0.3 太低，不同"记忆"拼在一起像一块连续大平层、边界没有墙，
// 提到 0.75（配合 minOpenings 仍保证连通）让每个区块更像自己独立的一间记忆场景
const EDGE = { salt: 'L18', boundaryDensity: 0.75, straightness: 0.6, minOpenings: 3 };
const OPEN = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0 }, EDGE);

// 依据 landmarks「幼儿园/日托所记忆场景（最常见形态）」权重最高；「儿童卧室」「教室」「游乐场」是次常见的三种；
// 「空的空间（仅在流浪者没有这类记忆时出现，极罕见，无影响）」权重最低
// 注：原文"每个人看到的都不同"是千人千云——引擎的区块世界是所有人共享、确定性生成的一份，没有"按玩家生成不同关卡"
// 的能力（联机双方必须看到同一个世界），这里退而求其次做成大家共享的记忆拼贴，按权重随机出现，而非真的因人而异（apiRequests）
const KIND_WEIGHTS = [['kinder', 0.55], ['bedroom', 0.15], ['classroom', 0.15], ['playground', 0.12], ['void', 0.03]];
const BEDROOM_HUES = [0xcfe0ea, 0xf0d7df, 0xdccbe8, 0xd8ecd2];   // 卧室墙面色相抽样：柔和蓝/粉/紫/薄荷绿

// 家具簇的固定锚点（区块本地坐标）；出口门、儿童营地、记忆物件各占一角，互不重叠
// 验收(medium)：原来每个区块只在 FX/FZ 一角摆一小簇家具，20x20 的整间房大半是空地——
// 加 FX2/FZ2（房间另一角，四种 kind 通用的"第二簇"位置）、FX3/FZ3（目前只有幼儿园用到的"第三簇"），
// 三个锚点两两间距都在 4m 以上、且都离出口门/营地/记忆物件/出生点足够远，不会互相挤在一起
const FX = 14, FZ = 6;          // 家具簇（按 kind 摆不同家具）
const FX2 = 6, FZ2 = 11;        // 第二簇：房间对角，四种 kind 都用
const FX3 = 16, FZ3 = 11;       // 第三簇：目前只有幼儿园（家具最多）用
const DOOR_X = 10, DOOR_Z = 16; // 转身可见的"回 Level 19"之门
const CAMP_X = 16, CAMP_Z = 16; // 孩子们营地（宏格稀疏出现）
const MEMO_X = 5, MEMO_Z = 15;  // 重新唤醒的记忆物件（稀疏出现）
const SPAWN_X = 4, SPAWN_Z = 4;

// ---------- 材质 ----------
function defineMaterials() {
  kit.mats({
    'L18:wallNursery': { tex: 'l18_wall_nursery', repeatMeters: 2.2, roughness: 0.92 },
    'L18:floorFoam': { tex: 'l18_floor_foam', repeatMeters: 2.0, roughness: 0.85 },
    // 吊顶全部改成 kit:prop 纯色（见 buildChunk）——验收①指出 ceiling_tile 方格吊顶配日光灯太像 Level 0 办公层；
    // 卧室/教室/游乐场/空场景的墙与地也都用内置 kit:prop（顶点色平铺），靠 color 参数区分，不占贴图预算
  });
}

// ---------- 孩子们（The Children）营地：宏格哈希，跨区块协调（TEMPLATE 4.2/4.3 节）----------
// 依据 bases「孩子们：前哨站主要有20-25人居住…只会停留在这个层级；厌恶毛绒恐龙」，原文没给位置；
// 用户规则（2026-09-13"范围决定"）：据点现在只摆静态外观，不做交互/驻守NPC/交易；用宏格让它稀疏出现，贴近"据点"稀有感
// 验收⑦：15% 的宏格出现率太稀，20-25 人的据点几乎撞不到——提到 25%，仍然保持稀有感
const CAMP_MX = 4;
function campAt(levelSeed, cx, cz) {
  const mx = Math.floor(cx / CAMP_MX), mz = Math.floor(cz / CAMP_MX);
  const mr = U.rng(levelSeed, 'L18-camp', mx, mz);
  if (mr() >= 0.25) return null;
  return { hx: mx * CAMP_MX + Math.floor(mr() * CAMP_MX), hz: mz * CAMP_MX + Math.floor(mr() * CAMP_MX) };
}

// 营地：铺开的被褥 + 三顶帆布小帐篷 + 散落箱子 + 一根无字彩旗，纯静态装饰，没有招牌文字、没有对话
// 依据 bases「前哨站主要有20-25人居住」——验收⑦指出原来只有3处被褥+1顶帐篷太单薄，认不出是几十人的据点，
// 改成 9 处被褥（三圈）+ 3 顶帐篷，外加一根旗杆当据点标记，方便玩家一眼认出"这是个聚居点"
function buildCamp(b, rng, x, z) {
  b.push(x, z, 0);
  const beddingColors = [0x8a6f5a, 0x6f7a5a, 0x7a6a7a, 0x8a7a6f];
  for (let ring = 0; ring < 3; ring++) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + ring * 0.35 + rng() * 0.3;
      const r = 0.8 + ring * 0.9;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      b.box(px, 0.02, pz, 0.55 + rng() * 0.15, 0.05, 0.9, 'kit:prop', { color: beddingColors[(ring * 3 + k) % beddingColors.length], solid: false, rotY: a });
    }
  }
  // 帐篷：没有专门构件，用圆锥近似简易帐篷（TEMPLATE 8 节：构件不够时自己拼，圆锥比手拼斜面四边形更不容易出现法线朝向问题）
  for (const [tx, tz] of [[0, -2.6], [-2.3, 1.6], [2.3, 1.6]]) {
    b.cylinder(tx, 0, tz, 0.75, 0.95, 'kit:prop', { rTop: 0.05, segments: 8, color: 0xcbb789, solid: false });
  }
  kit.prop.crate(b, 1.1, 3.0, 0.3, { size: 0.4, color: 0x8a7355 });
  kit.prop.crate(b, -1.0, 2.9, -0.5, { size: 0.35, color: 0x8a7355 });
  kit.prop.crate(b, 3.0, -0.6, 0.1, { size: 0.38, color: 0x8a7355 });
  kit.prop.crate(b, -3.0, -0.5, -0.2, { size: 0.42, color: 0x8a7355 });
  // 据点标记：旗杆 + 一面纯色布旗（不写字，构件表没有专门的旗帜，自己用圆柱+薄片拼）
  b.cylinder(0, 0, 3.6, 0.03, 2.2, 'kit:prop', { color: 0x6b5a3f, segments: 6 });
  b.box(0.32, 1.7, 3.6, 0.5, 0.32, 0.02, 'kit:prop', { color: 0xb03a3a, solid: false });
  b.pop();
}

// 重新唤醒的记忆物件：一张旧宠物垫 + 小碗，触发一次性的怅然情绪提示，不叙述具体宠物内容（引擎没有个性化文本，只能给通用提示）
function buildMemento(b, x, z) {
  b.push(x, z, 0);
  b.box(0, 0.02, 0, 0.5, 0.05, 0.36, 'kit:prop', { color: 0xb0a58f, solid: false });
  b.cylinder(0.32, 0, 0.04, 0.09, 0.06, 'kit:prop', { color: 0x8f9aa0, solid: false, segments: 10 });
  b.pop();
}

// ---------- 各"记忆类型"的家具（依据 landmarks 列出的五种场景）----------
function buildKinder(b) {
  // 依据 landmarks「幼儿园/日托所记忆场景（最常见形态）」——矮柜、小桌椅、地垫、玩具箱，贴近幼儿园常见陈设
  kit.prop.cabinet(b, FX - 1.3, FZ - 0.9, Math.PI, { kind: 'wardrobe', w: 1.0, h: 0.95, d: 0.32, color: 0xdff0c8 });
  kit.prop.desk(b, FX, FZ, 0, { w: 0.7, d: 0.55, h: 0.44, color: 0xf2c94c });
  kit.prop.chair(b, FX - 0.5, FZ + 0.5, Math.PI * 0.25, { color: 0xe0703c });
  kit.prop.chair(b, FX + 0.5, FZ + 0.5, -Math.PI * 0.25, { color: 0x4f9bd1 });
  b.box(FX + 1.6, 0.02, FZ - 0.6, 0.9, 0.03, 1.3, 'kit:prop', { color: 0xf5d9a8, solid: false });   // 午睡地垫
  kit.prop.crate(b, FX + 1.7, FZ + 0.9, 0.3, { size: 0.45, color: 0xef5b5b });                      // 玩具箱
  const blockColors = [0xe0703c, 0x4f9bd1, 0xe8c94a];
  for (let k = 0; k < 3; k++) b.box(FX - 1.7 + (k % 2 === 0 ? 0.05 : -0.05), 0.03 + k * 0.13, FZ + 1.4, 0.22, 0.13, 0.22, 'kit:prop', { color: blockColors[k], solid: false });   // 积木

  // 验收(medium)：幼儿园「最常见形态」权重最高、家具理应最多——加读书角（第二簇）和第二组小桌椅（第三簇），
  // 让整间日托所都看得到陈设，不只是一角一小撮
  kit.prop.cabinet(b, FX2, FZ2 - 1.0, 0, { kind: 'wardrobe', w: 1.1, h: 0.85, d: 0.28, color: 0xe8c94a });   // 矮柜近似绘本/玩具收纳架（构件表没有专门书架）
  b.box(FX2, 0.02, FZ2 + 0.3, 1.6, 0.03, 1.2, 'kit:prop', { color: 0x8fbf7a, solid: false });   // 读书角地垫
  const cushionColors = [0xd9524a, 0x4a90d9, 0xe8c94a];
  for (let k = 0; k < 3; k++) b.box(FX2 - 0.5 + k * 0.5, 0.06, FZ2 + 0.7, 0.35, 0.1, 0.35, 'kit:prop', { color: cushionColors[k], solid: false });   // 散落坐垫

  kit.prop.desk(b, FX3, FZ3, Math.PI, { w: 0.7, d: 0.55, h: 0.44, color: 0x4f9bd1 });
  kit.prop.chair(b, FX3 - 0.5, FZ3 - 0.5, -Math.PI * 0.75, { color: 0xf2c94c });
  kit.prop.chair(b, FX3 + 0.5, FZ3 - 0.5, Math.PI * 0.75, { color: 0xe0703c });
  kit.prop.crate(b, FX3 + 1.2, FZ3 + 0.6, 0.4, { size: 0.4, color: 0x5aa06a });   // 第二个玩具箱
}

function buildBedroom(b, wallColor) {
  // 依据 landmarks「儿童卧室」——小床、衣柜、玩具箱；床品颜色跟随墙面色相，保持柔和统一
  kit.prop.bed(b, FX, FZ, 0, { w: 0.9, l: 1.7, color: wallColor });
  kit.prop.cabinet(b, FX - 1.4, FZ - 0.8, Math.PI / 2, { kind: 'wardrobe', color: 0x8a6a48 });
  kit.prop.crate(b, FX, FZ + 1.15, 0, { size: 0.5, color: 0xdba556 });
  b.box(FX, 0.01, FZ + 0.2, 1.6, 0.02, 2.3, 'kit:prop', { color: 0xe8dcc4, solid: false });          // 床边地毯
  b.box(FX - 0.75, 0, FZ - 0.6, 0.34, 0.35, 0.34, 'kit:prop', { color: 0xa9825a, solid: false });    // 床头柜柜体
  b.box(FX - 0.75, 0.35, FZ - 0.6, 0.4, 0.02, 0.4, 'kit:prop', { color: 0x8a6a48, solid: false });   // 床头柜台面

  // 验收(medium)：原来只有床边这一簇，房间大半是空地——远离床铺再加一处玩具角（第二簇），撑起整间卧室
  kit.prop.cabinet(b, FX2, FZ2 - 0.9, 0, { kind: 'wardrobe', w: 0.9, h: 0.7, d: 0.28, color: 0xdba556 });   // 玩具/绘本矮柜
  const toyColors = [0xe0703c, 0x4f9bd1, 0xe8c94a];
  for (let k = 0; k < 3; k++) b.box(FX2 - 0.5 + k * 0.5, 0.03 + (k % 2) * 0.13, FZ2 + 0.5, 0.22, 0.13, 0.22, 'kit:prop', { color: toyColors[k], solid: false });   // 散落积木
}

function buildClassroom(b) {
  // 依据 landmarks「教室」——小课桌椅、可移动的画架式小黑板（房间是自由摆放的开敞记忆场景，不贴固定墙面，
  // 所以黑板做成带支架的画架式，而不是嵌墙——TEMPLATE 8 节：构件不够时自己拼）
  const legC = 0x6d5638;
  b.cylinder(FX - 0.7, 0, FZ - 0.9, 0.03, 0.9, 'kit:prop', { color: legC, segments: 6 });
  b.cylinder(FX + 0.7, 0, FZ - 0.9, 0.03, 0.9, 'kit:prop', { color: legC, segments: 6 });
  b.box(FX, 0.55, FZ - 0.9, 1.5, 0.9, 0.04, 'kit:prop', { color: 0x2e4a37 });
  // 粉笔槽：验收(low)指出原来 y=0.12 悬在黑板（y:0.55~1.45）下方 0.38m——挪到黑板底边正下方
  b.box(FX, 0.50, FZ - 0.85, 1.5, 0.05, 0.08, 'kit:prop', { color: 0xcbbfa0 });
  const deskColor = 0xd9cba0, chairColor = 0xb8ad8e;
  // 验收(medium)：讲台前只摆了一排 2 张课桌椅，加第二排凑出 2x2，更认得出"教室"而不是"一张桌子"
  for (const rowZ of [FZ + 0.6, FZ + 2.3]) {
    kit.prop.desk(b, FX - 1.0, rowZ, 0, { w: 0.65, d: 0.5, h: 0.5, color: deskColor });
    kit.prop.chair(b, FX - 1.0, rowZ + 0.5, Math.PI, { color: chairColor });
    kit.prop.desk(b, FX + 1.0, rowZ, 0, { w: 0.65, d: 0.5, h: 0.5, color: deskColor });
    kit.prop.chair(b, FX + 1.0, rowZ + 0.5, Math.PI, { color: chairColor });
  }
  kit.prop.cabinet(b, FX + 1.7, FZ - 0.9, -Math.PI / 2, { kind: 'file', color: chairColor });

  // 验收(medium)：讲台+课桌都挤在同一角，加一处远离讲台的阅读角（第二簇），撑起整间教室
  kit.prop.cabinet(b, FX2, FZ2 - 1.0, 0, { kind: 'wardrobe', w: 1.0, h: 0.9, d: 0.3, color: chairColor });
  b.box(FX2, 0.02, FZ2 + 0.4, 1.4, 0.03, 1.1, 'kit:prop', { color: 0xcfc6ad, solid: false });   // 阅读角地垫
}

function buildPlayground(b) {
  // 依据 landmarks「游乐场」——引擎没有露天场景/物理秋千（apiRequests），近似成室内活动室里的滑梯、秋千架、沙坑，
  // 装饰件一律 solid:false，避免矮台阶挡住玩家（引擎没有自动上台阶，TEMPLATE 第11节）
  const sx = FX - 1.4, sz = FZ - 1.0;
  b.box(sx, 0.55, sz, 0.6, 0.5, 0.6, 'kit:prop', { color: 0xe0703c, solid: false, faces: 'noBottom' });   // 滑梯平台
  // 验收(low)：原来平台悬空、下面什么支撑都没有——补 4 根落地支柱，撑住 0.55m 高的平台底面
  for (const [lxx, lzz] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) {
    b.box(sx + lxx, 0, sz + lzz, 0.06, 0.55, 0.06, 'kit:prop', { color: 0xb35a2e, solid: false });
  }
  b.quad([sx - 0.3, 0.5, sz + 0.3], [sx + 0.3, 0.5, sz + 0.3], [sx + 0.35, 0, sz + 1.4], [sx - 0.35, 0, sz + 1.4], 'kit:prop', { color: 0xf2c94c });   // 滑道
  for (const s of [-1, 1]) b.box(sx + s * 0.32, 0.25, sz + 0.9, 0.04, 0.3, 0.9, 'kit:prop', { color: 0xd94a4a, solid: false });   // 护栏
  const gx = FX + 1.2, gz = FZ - 0.6;
  for (const s of [-1, 1]) {
    b.cylinder(gx + s * 0.9, 0, gz - 0.5, 0.05, 1.6, 'kit:prop', { color: 0x6b8f5a, segments: 6, solid: false });
    b.cylinder(gx + s * 0.9, 0, gz + 0.5, 0.05, 1.6, 'kit:prop', { color: 0x6b8f5a, segments: 6, solid: false });
  }
  b.box(gx, 1.6, gz, 1.9, 0.06, 0.06, 'kit:prop', { color: 0x6b8f5a, solid: false });
  b.box(gx, 0.55, gz, 0.4, 0.05, 0.35, 'kit:prop', { color: 0xf2c94c, solid: false });   // 秋千座
  for (const s of [-1, 1]) b.cylinder(gx + s * 0.16, 0.55, gz, 0.008, 1.05, 'kit:prop', { axis: 'y', color: 0x9aa0a6, segments: 4, solid: false });
  // 沙坑
  const bx = FX - 0.5, bz = FZ + 1.6;
  b.box(bx, 0.005, bz, 1.4, 0.01, 1.1, 'kit:prop', { color: 0xdbc48a, solid: false });
  // 验收(low)：围栏原来 y=0.08 悬空 8cm、又没标 solid:false，会挡玩家——落到地面、补上 solid:false
  for (const [ox, oz, w, d] of [[0, -0.55, 1.4, 0.1], [0, 0.55, 1.4, 0.1], [-0.65, 0, 0.1, 1.1], [0.65, 0, 0.1, 1.1]]) {
    b.box(bx + ox, 0, bz + oz, w, 0.16, d, 'kit:prop', { color: 0xc9a55a, solid: false });
  }

  // 验收(medium)：原来滑梯+秋千+沙坑挤在 FX 附近一角，20x20 的活动室剩下大半空地——
  // 在对角 FX2/FZ2 加一副跷跷板（构件表没有专门跷跷板，用三棱支点+木板+两端座位手拼），撑起另一角
  const px = FX2, pz = FZ2;
  b.cylinder(px, 0, pz, 0.16, 0.42, 'kit:prop', { rTop: 0.03, segments: 4, color: 0x8a6f4a });   // 三角支点
  b.box(px, 0.40, pz, 2.4, 0.06, 0.28, 'kit:prop', { color: 0xe0703c, solid: false });            // 跷跷板板面
  for (const s of [-1, 1]) b.box(px + s * 1.0, 0.30, pz, 0.3, 0.22, 0.28, 'kit:prop', { color: 0x4f9bd1, solid: false });   // 两端座位
}

// ---------- 区块 ----------
// rng 消耗顺序固定（TEMPLATE 4.2 节）：记忆类型 → 卧室色相 → 记忆物件roll → 低语时间×2 → 低语位置×4
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  const rolledKind = U.weighted(rng, KIND_WEIGHTS);
  const hueRoll = rng();
  const rMemento = rng();
  const whisperDelay1 = 3 + rng() * 9, whisperDelay2 = 13 + rng() * 10;
  const whX1 = 2 + rng() * (SIZE - 4), whZ1 = 2 + rng() * (SIZE - 4);
  const whX2 = 2 + rng() * (SIZE - 4), whZ2 = 2 + rng() * (SIZE - 4);

  // 依据 environment.architecture「最常见的外观是幼儿园或日托所」——出生点固定落在这种最典型的记忆里
  const kind = isSpawn ? 'kinder' : rolledKind;

  const g = kit.grid(b, N, N, OPEN);
  g.carve(0, 0, N, N, { room: true });   // 整块打通：单个记忆场景，不做迷宫（environment.layout 原文未描述迷宫）

  // 验收①(high)：原来默认 ceilMat='L18:ceilPlain'，幼儿园分支又用了 'L18:floorNursery'/'L18:ceilNursery'——
  // 这三个名字从没在 defineMaterials() 里定义过，kit.mat() 撞到未定义材质就退化成洋红占位（出生点就是幼儿园，
  // 玩家一进层地板天花板全是洋红）。改法贴合文件头本来就写的设计（86-88 行注释）：吊顶统一用已定义好的
  // 'kit:prop'（顶点色）+ 每种记忆各自的 ceilColor，不再编新材质名；幼儿园地面换成真正定义了的 'L18:floorFoam'
  let wallMat = 'kit:prop', floorMat = 'kit:prop', wallColor, floorColor, ceilColor, trim;
  if (kind === 'kinder') {
    wallMat = 'L18:wallNursery'; floorMat = 'L18:floorFoam'; ceilColor = 0xf7efd8;
    trim = { h: 0.09, t: 0.016, color: 0xe4dcc4, matKey: 'kit:prop' };
  } else if (kind === 'bedroom') {
    wallColor = BEDROOM_HUES[Math.floor(hueRoll * BEDROOM_HUES.length) % BEDROOM_HUES.length];
    floorColor = 0xcbb896; ceilColor = 0xf2efe6;
  } else if (kind === 'classroom') {
    wallColor = 0xe8e2c9; floorColor = 0xcfc6ad; ceilColor = 0xf2efe6;
  } else if (kind === 'playground') {
    wallColor = 0xbfe0f2; floorColor = 0xc96a3e; ceilColor = 0xeaf3f8; trim = false;
  } else {   // void：依据 architecture「没有这类记忆时…像一个空的空间，对漫游者没有任何影响」——素色、无家具、无灯
    wallColor = 0xd6d6d0; floorColor = 0xd6d6d0; ceilColor = 0xd6d6d0; trim = false;
  }

  kit.gridWalls(b, g, { matKey: wallMat, color: wallColor, trim });
  kit.prop.floor(b, null, null, 0, { matKey: floorMat, color: floorColor });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'kit:prop', y: H, color: ceilColor });

  if (kind === 'kinder') buildKinder(b);
  else if (kind === 'bedroom') buildBedroom(b, wallColor);
  else if (kind === 'classroom') buildClassroom(b);
  else if (kind === 'playground') buildPlayground(b);

  // 灯：安全无威胁的层级（hazards「原文称层级本身没有任何威胁」），不做坏灯/闪烁；空场景不放灯，只靠环境光
  if (kind !== 'void') {
    for (const [lx, lz] of [[5, 5], [15, 5], [5, 15], [15, 15]]) {
      kit.prop.lightPanel(b, lx, lz, 0, { y: H, state: 'on', color: 0xfff2da, intensity: 1.0, range: 8 });
    }
  }

  // 转身可见的门：回 Level 19（依据 exits[0]「转身离开（最简单的方法）…原文说出口在一些十分显眼的地方」）；
  // 每个区块都摆同一扇门、位置固定，保证从任何位置出发都在极近处（规则②，比 3-5 区块的要求宽松得多）；
  // 门带独立的一小截墙（kit.exit(kind:'door') 内部已建门，见 TEMPLATE 规则⑧，不再手动 kit.prop.door）
  kit.exit(b, {
    to: '19', kind: 'door', x: DOOR_X, z: DOOR_Z, rot: 0, style: 'wood',
    label: '转身回到 Level 19',
    door: { wall: { matKey: wallMat, w: 2.4, h: H, color: wallColor } },
  });

  // 孩子们营地：宏格稀疏出现，只在被选中的那一格出现且不是出生块
  const camp = campAt(ctx.levelSeed, cx, cz);
  if (camp && camp.hx === cx && camp.hz === cz && !isSpawn) buildCamp(b, rng, CAMP_X, CAMP_Z);

  // 重新唤醒的记忆物件：依据 mechanics「重新唤醒被遗忘的童年记忆（如死去的宠物）」，只在有"个人物品"意味的
  // 幼儿园/卧室场景里出现，稀有概率；原文「这可以通过未知方法抑制」语焉不详、没有可执行的动作，不做压制机制
  const hasMemento = rMemento < 0.07 && (kind === 'kinder' || kind === 'bedroom') && !isSpawn;
  if (hasMemento) buildMemento(b, MEMO_X, MEMO_Z);

  // 低语：依据 hazards「徘徊时有许多"声音"对你低语…几乎不可能压制」——引擎没有按玩家个人生成台词的能力
  // （不知道谁的"最大遗憾"是什么），只能用 whisper 音效近似持续的低语背景，不编造具体遗憾内容（apiRequests）
  const memoWorld = hasMemento ? b.world(MEMO_X, MEMO_Z) : null;
  const wp1 = b.world(whX1, whZ1), wp2 = b.world(whX2, whZ2);
  let firedMemo = false, fired1 = false, fired2 = false;
  b.update((dt, t) => {
    if (!fired1 && t > whisperDelay1) { fired1 = true; BR.audio.play('whisper', [wp1.x, 1.0, wp1.z], { volume: 0.55 }); }
    if (!fired2 && t > whisperDelay2) { fired2 = true; BR.audio.play('whisper', [wp2.x, 1.0, wp2.z], { volume: 0.55 }); }
    if (!firedMemo && memoWorld) {
      const dx = BR.player.x - memoWorld.x, dz = BR.player.z - memoWorld.z;
      if (dx * dx + dz * dz < 1.3 * 1.3) { firedMemo = true; BR.hud.toast('你盯着它看了一会儿，心里没来由地一阵发闷，好像想起了什么已经很久没有想起的事。', 3200); }
    }
  });

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: '18', name: 'Level 18', title: '回忆', nickname: '回忆',
  version: 'wikidot-cn',
  survivalClass: '1',
  chunkSize: SIZE,
  env: {
    // 依据 environment.materials/colors/lighting「原文未提及」——不编造具体氛围，选一个与"没有威胁、提供全部生存
    // 物资"的安全基调一致的暖白色调，而不是随便一层的默认色
    background: 0xe4dcc8, fogColor: 0xe4dcc8, fogNear: 10, fogFar: 32,
    ambient: { color: 0xfff2da, intensity: 0.5 },
    // sanityDrainMul 依据 hazards「原文称层级本身没有任何威胁」+ mechanics「层级提供全部生存必需品」——
    // 按安全区基线（TEMPLATE 0.42/0.5）再降一档，体现"有人会上瘾主动留下"的舒适感
    sanityDrainMul: 0.4, hungerDrainMul: 1,
    // 依据 environment.sounds「许多声音对你低语」，没有风扇/水管/雨声这类具体环境噪音描述——选最安静的预设，
    // 低语本身用 BR.audio.play('whisper', …) 在 update 里按各区块的固定时间点播放（见 buildChunk）
    audio: 'silence', darkness: false,
  },
  spawn() { return { x: SPAWN_X, y: 0, z: SPAWN_Z, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据 entities[0]「你可以找到一个罕见的实体」+ entityDensityOverall="rare"——只有定性描述，按 WAVE2 第4节
    // 用 BR.config.densityWords.rare；原文另说它是"居住在 Level 18 的唯一实体"，这与"到处巡游的稀有实体"在字面上
    // 矛盾，引擎没有"全图仅生成一只"的机制（按区块各自算数量，apiRequests），只能近似成到处都可能碰到、频率很低
    { type: 'plush_dino', officialPer1000m2: BR.config.densityWords.rare },
  ],
  items: [
    // data/item-spawn.json：levels 含 '18' 的条目全部按 perLevel['18']（缺省用 per1000m2）取数，
    // almond_water/food_ration 是用户规则"所有模式都刷食物和杏仁水"的兜底，其余是全层通用的稀有补给
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    { type: 'food_ration', per1000m2: 0.6 },
  ],
  exits: [
    { to: '19', kind: 'door', note: '转身离开即可到 Level 19（exits[0]，原文"出口在很显眼的地方"，每个区块都摆一扇同样的门）' },
    { to: '(玩家想去的层级)', kind: 'event', note: '跟随毛绒恐龙一段时间可到达想去的层级（exits[1]）——原文本身没有具体触发条件和确定目标，也依赖尚未完成的 plush_dino 实体行为，本文件未实现，见返回说明' },
  ],
  enter() { BR.hud.toast('熟悉的气味忽然涌上来，好像回到了很小的时候。', 2600); },
  update() {}, leave() {},
});
})();
