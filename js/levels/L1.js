// Level 1 - "宜居地带"（Habitable Zone 的中文译名；译者 ShorterIsBetter9、Linw5、whitelu、MC13min、wild ghost377）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-1  许可：CC BY-SA 3.0
// 只按这个版本实现，冲突列表（conflicts）里属于 wikidot-en / fandom 的细节一律不做（WAVE2.md 第 1 节）：
//   没有 fandom 的立体停车场楼梯间/Maintenance Halls/Luxury Lots/车辆与 tripse 合金/伪水坑/画作实体；
//   没有 wikidot-en 的出口列表差异（740/739 只在中文站，本文件按中文站列出）。
//
// 【用户指定，优先于上面的版本】贝塔 2026-09-23（data/lore-choices.json 的 userOverride）：
//   「Level 1 应该是很多灰色柱子的储物空间，并不是迷宫」「除了墙壁、人物和实体，所有东西做得更细」。
//   → 整层不再用 kit.grid 迷宫，改成无限延伸的开阔仓库：
//     · 8 m 柱网的灰色混凝土方柱（柱脚、刷漆的下段、剥落的漆、水渍、柱帽、托梁），全层连续；
//     · 每个 32 m 区块 = 一个 24×24 m 的储物街区（3×3 个柱间）+ 四周 8 m 宽的主通道（沿区块边界，永远畅通）；
//     · 柱间里是货架排（蓝立柱橙横梁的托盘货架，摆满纸箱、缠膜托盘、铁桶、编织袋、周转箱）、落地堆垛、空地、
//       少量隔间小屋（推门进去的「小径」房间）和承重墙段；看得远（主通道、柱间通道），但处处有遮挡。
//   原文「过道：宽敞开阔…被形容为地下停车场和废弃仓库的无尽缝合体」「天花板有管道」「两边排着金属货架、堆满板条箱的长通道」
//   「地板散落木头碎块、包装材料、金属残骸」本来就是这个样子，这里只是把它从格子迷宫还原成仓库。
//   原文的「小径（经推门进入的迷宫式混凝土通道）」按用户要求不再做成迷宫：变成仓库里一间间推门进去的白墙小屋，
//   门上亮着绿色应急灯，闪烁时躲进去的机制照旧（小屋里的刷新点标 safe）。
//
// 出口：原有的每一条（exits[0..24] + Level Fun 天花板切出点 + Level ! 感叹号门）目标层和形式都没变，只是换了地方摆：
//   门/电梯/画挂在小屋外墙和承重墙上，切出墙是承重墙中间那一段，天花板洞/风管/电视/枯树等摆在空柱间里。
//   摆放全部改成宏格保底（第 4.2 节派生流）：每 5×5 区块的宏格里每条出口必有一处 → 离出生点最远 4 个区块；
//   Level Fun 仍是更密的 3×3 宏格。原来那种每块各自抽签（权重 0.4%–1.4%）的摆法，出生点 4 个区块内经常一处都没有。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// ---------- 尺寸 ----------
// 依据：environment.scale「过道墙壁绵延数英里…极为庞大」——开阔层，chunkSize 32（第 16 节开阔层 32–48）
const SIZE = 32;
const H = 4.0;                    // 楼板底标高。原文没给数字；仓库货架要 3 m，取 4 m（梁底 3.55）
const LINES = [4, 12, 20, 28];    // 柱线（区块本地）：8 m 柱网，全层连续；区块边界两侧各 4 m 是主通道
const BEAM_D = 0.45, BEAM_W = 0.5;
const LAMP_Y = 3.2;               // 吊灯灯罩底
const RACK_H = 3.1;
const RACK_LEVELS = [1.2, 2.3];   // 货架两层横梁（梁顶标高），地面一层直接放托盘
const HUT_R = 3.1, HUT_T = 0.2, HUT_H = 2.9;   // 小屋：墙中线 ±3.1、墙厚 0.2、高 2.9（自带屋顶）
const WALL_T = 0.3, WALL_H = H - BEAM_D;       // 承重墙段：顶到梁底
const SPAWN = { x: 16, z: 30, yaw: -HALF_PI }; // 出生在主通道上，面朝东：一眼看到长长的柱廊和两边货架

// ---------- 六个区段（宏格哈希，跨区块协调，见 TEMPLATE 4.2 节）----------
// 依据：landmarks「天鹰/跃金/哥特/衔尾/花园/传说」六个区段；「衔尾段为迄今记录的最小区段」→ 权重最低
const SECTOR_MX = 3;
const SECTORS = [['tianying', 0.22], ['yuejin', 0.22], ['gothic', 0.16], ['garden', 0.16], ['legend', 0.16], ['ouroboros', 0.08]];
function sectorAt(levelSeed, cx, cz) {
  const mx = Math.floor(cx / SECTOR_MX), mz = Math.floor(cz / SECTOR_MX);
  if (mx === 0 && mz === 0) return 'tianying';   // 依据：landmarks「新人通常从黄色厅房切入此处」——出生区固定天鹰段
  return U.weighted(U.rng(levelSeed, 'L1-sector', mx, mz), SECTORS);
}

// 区段外观：柱子一律是灰色混凝土（用户要求），区段只改柱子粗细/形状、下段刷的漆、柱间格局的比例
// bays：柱间类型权重（rack 货架排 / stack 落地堆垛 / open 空地 / hut 小屋 / wall 承重墙 / build 施工区 / grove 绿植）
const STYLE = {
  // 依据：landmarks「天鹰段：灰墙灰地＋巨型混凝土柱…更像停车场；天花板漏水小管子」
  tianying:  { pillar: 0.9, concrete: [0.9, 0.9, 0.9], paint: [1.12, 1.12, 1.1], stripe: [0.34, 0.34, 0.34], floor: [1.12, 1.12, 1.1], lamp: 1.2,
               bays: [['rack', 0.4], ['stack', 0.2], ['open', 0.22], ['hut', 0.1], ['wall', 0.08]] },
  // 依据：「跃金段：更斑斓、照明更为充足…更像仓库；板条箱数量远超其他地点」
  yuejin:    { pillar: 0.7, concrete: [0.95, 0.93, 0.9], paint: 'multi', stripe: [0.3, 0.3, 0.3], floor: [1.16, 1.14, 1.1], lamp: 1.4, crates: true,
               bays: [['rack', 0.5], ['stack', 0.3], ['open', 0.06], ['hut', 0.08], ['wall', 0.06]] },
  // 依据：「哥特段：弯曲建筑，拱门与圆柱」
  gothic:    { pillar: 0.72, round: true, concrete: [0.97, 0.95, 0.9], paint: [1.1, 1.06, 0.98], stripe: [0.5, 0.45, 0.38], floor: [1.12, 1.1, 1.06], lamp: 1.2,
               bays: [['rack', 0.42], ['stack', 0.2], ['open', 0.18], ['hut', 0.12], ['wall', 0.08]] },
  // 依据：「衔尾段：最小区段，永无止境的施工状态」
  ouroboros: { pillar: 0.7, concrete: [1.0, 0.96, 0.88], paint: [1.05, 1.0, 0.9], stripe: [0.85, 0.65, 0.2], floor: [1.1, 1.06, 0.98], lamp: 1.1,
               bays: [['rack', 0.3], ['stack', 0.15], ['open', 0.1], ['build', 0.3], ['hut', 0.08], ['wall', 0.07]] },
  // 依据：colors「花园段青翠欲滴的色调」；landmarks「植被繁生」
  garden:    { pillar: 0.7, concrete: [0.84, 0.95, 0.8], paint: [0.88, 1.08, 0.84], stripe: [0.3, 0.45, 0.25], floor: [0.96, 1.12, 0.9], lamp: 1.15,
               bays: [['rack', 0.3], ['stack', 0.12], ['open', 0.1], ['grove', 0.3], ['hut', 0.1], ['wall', 0.08]] },
  // 依据：「传说段：朱漆木质风貌…重新发现后被霓虹与彩色电缆覆盖」
  legend:    { pillar: 0.7, concrete: [0.95, 0.92, 0.9], paint: [0.7, 0.17, 0.12], stripe: [1.25, 0.95, 0.35], floor: [1.1, 1.06, 1.04], lamp: 1.1,
               bays: [['rack', 0.42], ['stack', 0.2], ['open', 0.16], ['hut', 0.12], ['wall', 0.1]] },
};
const MULTI_PAINT = [[0.35, 0.55, 1.05], [1.15, 0.62, 0.22], [0.42, 0.9, 0.45], [1.1, 0.36, 0.3], [1.1, 1.0, 0.4]];

// ---------- 材质（只有 2 种；家具/货物/灯具全部走 kit:prop / kit:glow 顶点色，不为分色新增材质）----------
// 楼板底面和墙、柱、梁同一张混凝土贴图，只是颜色暗一档 → 直接用 L1:wall 的顶点色，每块省一个 draw call
function defineMaterials() {
  kit.mats({
    // 依据：materials「混凝土墙与柱」「水泥地面触感粗糙」；temperature「过道空气沉闷潮湿」→ 地板取偏湿的贴图
    'L1:wall':    { tex: 'concrete', repeatMeters: 3, roughness: 0.9, vertexColors: true },
    'L1:floor':   { tex: 'concrete_wet', repeatMeters: 3.5, roughness: 1, vertexColors: true },
  });
}
const CEIL_COLOR = [0.56, 0.545, 0.51];   // 楼板底面（原来单独材质的 0x8f8b82）

// ---------- 调色板（kit:prop 顶点色；写在 L1:wall 上的颜色是乘在混凝土贴图上的倍率）----------
const C = {
  rackBlue: [0.18, 0.36, 0.58], rackOrange: [0.83, 0.38, 0.11], deck: [0.55, 0.57, 0.59], guard: [0.85, 0.66, 0.15],
  card: [0.66, 0.5, 0.32], seam: [0.34, 0.25, 0.15], tape: [0.8, 0.72, 0.55], label: [0.9, 0.9, 0.86],
  pallet: [0.56, 0.45, 0.29], palletGap: [0.07, 0.06, 0.05],
  wrap: [0.77, 0.8, 0.83], strap: [0.2, 0.33, 0.55], sheen: [0.95, 0.97, 1.0],
  crate: [0.6, 0.45, 0.27], crateBand: [0.4, 0.29, 0.16],
  steel: [0.48, 0.5, 0.53], galv: [0.66, 0.69, 0.71], dark: [0.13, 0.13, 0.14],
  yellow: [0.86, 0.67, 0.14], black: [0.09, 0.09, 0.09], red: [0.62, 0.12, 0.1], white: [0.9, 0.89, 0.85],
  sacks: [[0.84, 0.82, 0.76], [0.76, 0.68, 0.5], [0.55, 0.64, 0.72], [0.8, 0.78, 0.7]],
  totes: [[0.2, 0.36, 0.6], [0.42, 0.44, 0.46], [0.62, 0.2, 0.14], [0.24, 0.46, 0.3]],
  drums: [[0.16, 0.3, 0.56], [0.55, 0.14, 0.1], [0.36, 0.5, 0.26], [0.45, 0.32, 0.2], [0.2, 0.2, 0.22]],
  tube: [1.7, 1.75, 1.68], housing: [0.78, 0.79, 0.78], rod: [0.28, 0.28, 0.28],
  wood: [0.5, 0.36, 0.22], bark: [0.3, 0.26, 0.21], soil: [0.2, 0.16, 0.12], leaf: [0.24, 0.42, 0.2],
  hutWall: [1.5, 1.48, 1.42],    // 依据：materials「小径叙事中为洁白的混凝土墙」（乘在灰混凝土贴图上，要拉到 1.5 才显白）
  roof: [0.78, 0.77, 0.74],
  pipes: [[0.5, 0.52, 0.5], [0.48, 0.35, 0.24], [0.31, 0.42, 0.29], [0.72, 0.62, 0.22], [0.56, 0.16, 0.13], [0.23, 0.36, 0.52]],
};
const EXIT_GREEN = [0.25, 1.5, 0.55];

// =====================================================================
// 出口表：选中版本 exits[] 全部列出（下标与调研 JSON 一致），外加补入口批次的 Level Fun / Level !
// host：摆在哪 —— wall（小屋外墙/承重墙面）、noclip（承重墙中间那段）、floor（空柱间）、portal / passage（专属柱间）
// 范围外的目标（不在 BR.LEVEL_ORDER）kit 自动 sealed：实物照摆，靠近只提示"尚未开放"，绝不改道
// =====================================================================
const EXIT_DEFS = [
  // 依据：exits[0]「沿管道与仪表盘逐渐显现的方向走足够远」——平滑阈界：离出生点至少 3 个区块，
  // 周围区块的管道上开始出现仪表盘，出口本身是一段刷淡黄漆、右手边排满管道的走廊口（和用户新定的 Level 2 一个样子）
  { to: '2', kind: 'zone', host: 'portal', minDist: 3, label: '沿管道与仪表盘走进淡黄色的管道走廊 (exits[0])' },
  { to: '22', kind: 'door', host: 'wall', look: 'glass', label: '玻璃门 (exits[1])' },
  { to: '154', kind: 'door', host: 'wall', look: 'symbol', label: '荧光灯下、带独特符号的门 (exits[2])' },
  { to: '159', kind: 'door', host: 'wall', look: 'frozen', label: '结冰的金属门 (exits[3])' },
  { to: '218', kind: 'door', host: 'wall', look: 'bunker', label: '掩体门 (exits[4])' },
  // 「无厘头位置的木门」：一扇独自立在空地正中、前后都没有墙的木门（原文另一种方法是穿过小丑画作，只实现门）
  { to: '389', kind: 'door', host: 'floor', look: 'freeDoor', label: '空地中间孤零零立着的木门 (exits[5])' },
  { to: '740', kind: 'door', host: 'wall', look: 'cold', label: '比四周墙面稍冷的门；仅中文站 (exits[6])' },
  { to: '998', kind: 'elevator', host: 'wall', label: '类似电梯的双开铁门，通向一段楼梯 (exits[7])' },
  { to: '998.2', kind: 'door', host: 'wall', look: 'white', label: '纯白木门 (exits[8])' },
  { to: 'Level Hub', kind: 'door', host: 'wall', look: 'plain', label: '按特定顺序进入的门；顺序原文未给出，只摆一扇门 (exits[9])' },
  // 「爬上天花板的洞」：天花板上塌开一个黑洞，一架铁梯竖上去；触发圈在梯子脚下（地面高度，否则高差 >2.5 m 永远触发不了）
  { to: '19', kind: 'hole', host: 'floor', look: 'ceilingHole', label: '爬梯子钻进天花板上的洞 (exits[10])' },
  // 「在故障逐渐加剧的小径上行走」：一间推门进去、里面折成 U 形窄道的小屋，越往里灯闪得越厉害，尽头就是
  { to: '38', kind: 'zone', host: 'passage', label: '故障感逐渐加剧的小径 (exits[11])' },
  { to: '128', kind: 'noclip', host: 'noclip', look: 'outside', label: '墙上透出外面天光的缺口 (exits[12])' },
  // 「用拉丁字母说出 bHZsMzUy」：没有语音/文本输入，只摆一扇永远打不开的门 + 不激活的事件出口
  { to: '352', kind: 'event', host: 'wall', look: 'mute', label: '说出层级名才会开启的门 (exits[13])' },
  // 「爬入开放式通风管道」：一根从楼板直落到地面的方风管，底部格栅被拆下来扔在一边
  { to: '800', kind: 'hole', host: 'floor', look: 'duct', label: '钻进拆了格栅的风管口 (exits[14])' },
  { to: '24', kind: 'zone', host: 'wall', look: 'moon', label: '传言中的月球画作（未证实）(exits[15])' },
  // 「用 Mach+ 录像带切入电视机」：没有物品作用于场景物体的交互，摆电视、录像机和那盘录像带，走近电视即触发
  { to: '201', kind: 'zone', host: 'floor', look: 'tv', label: '放着 Mach+ 录像带的旧电视 (exits[16])' },
  { to: '305', kind: 'zone', host: 'floor', look: 'tree', label: '从地面裂缝里长出来的枯树 (exits[17])' },
  // 「持续触摸朝圣者之路上的地标、逐层切换」：多段链路未建模，只摆一座地标石堆
  { to: '710', kind: 'zone', host: 'floor', look: 'cairn', label: '朝圣者之路上的地标石堆 (exits[18])' },
  { to: '739', kind: 'zone', host: 'wall', look: 'island', label: '山顶枯树岩石岛屿的画；仅中文站 (exits[19])' },
  { to: '817', kind: 'zone', host: 'floor', look: 'scrap', label: '装满废金属的板条箱 (exits[20])' },
  // 依据：landmarks「Level 1.1 入口在 Alpha 基地南部；Level 1.2 通道位于天鹰段」「花园段…砼苑入口应避之如瘟」
  { to: '1.1', kind: 'door', host: 'wall', look: 'meg', prefer: 'tianying', label: '子层级「腐败的走廊」 (exits[21])' },
  { to: '1.2', kind: 'door', host: 'wall', look: 'concrete', prefer: 'tianying', avoid: 'garden', label: '子层级「砼苑」 (exits[22])' },
  { to: 'Level √2', kind: 'zone', host: 'floor', look: 'root2', label: '子层级 √2，进入方式原文未写明 (exits[23])' },
  { to: '1.5', kind: 'noclip', host: 'noclip', look: 'plain', label: '子层级「颠倒」，切出进入 (exits[24])' },
  // 依据：backrooms-research/levels/level-run.json 的 wikidot-cn entrances[1]「走进一扇画有感叹号符号的门」——
  //      资料说这是「进入该走廊最常规的方式之一」、任意层级都可能出现；同版本 entrances[0]（Level 109）本作没有，不做
  { to: 'run', kind: 'door', host: 'wall', look: 'exclaim', label: '一扇格格不入的深色铁门，门上刮花的感叹号 (level-run.json entrances[1])' },
];
// 依据：backrooms-research/levels/level-fun.json 的 wikidot-cn「享乐层 =)」entrances[0]「切入（no-clip）Level 1 的天花板，可能来到这里」。
// 用户 2026-09-19 要求「Fun 得真能进得去」：单独用更密的 3×3 宏格（每 9 块必有一处，出生点 ≤4 个区块内必有）。
// 触发判定见 js/game/world.js collectInside：平面距离 + 脚底高差 ≤2.5 m，所以触发圈留在地面，天花板上那块补丁只是装饰
const FUN_DEF = { to: 'fun', kind: 'zone', host: 'floor', look: 'funCeiling', tag: 'L1-fun-macro', macro: 3,
  label: '天花板上一块错位闪烁、偶尔整块切没的吊顶，走到正下方被切进去 (level-fun.json entrances[0])' };

// ---------- 宏格出口计划 ----------
// 每个 MACRO×MACRO 宏格里，EXIT_DEFS 每一条都分到一个区块（levelSeed 派生流，不吃区块主 rng）：
// 先把宏格里的区块洗牌，再按表的顺序、每条挑"目前分到最少"的区块 → 每块 1–2 条，两条切出墙不进同一块（每块独立物体 ≤2）。
// 出生块 (0,0) 不摆出口（开局面前不该是一扇门），出生点所在宏格照样每条都有 → 最远 MACRO−1 = 4 个区块
const MACRO = 5;
const planCache = new Map();
function macroPlan(seed, mx, mz) {
  const key = seed + ':' + mx + ':' + mz;
  let plan = planCache.get(key);
  if (plan) return plan;
  const r = U.rng(seed, 'L1-exitplan', mx, mz);
  const cells = [];
  for (let dz = 0; dz < MACRO; dz++) {
    for (let dx = 0; dx < MACRO; dx++) {
      const cx = mx * MACRO + dx, cz = mz * MACRO + dz;
      const k = r();
      if (cx === 0 && cz === 0) continue;
      cells.push({ cx, cz, k, defs: [], noclip: 0, sector: sectorAt(seed, cx, cz), dist: Math.max(Math.abs(cx), Math.abs(cz)) });
    }
  }
  cells.sort((a, b) => a.k - b.k);
  for (const def of EXIT_DEFS) {
    let cands = cells;
    const narrow = f => { const c = cands.filter(f); if (c.length) cands = c; };
    if (def.minDist) narrow(c => c.dist >= def.minDist);
    if (def.avoid) narrow(c => c.sector !== def.avoid);
    if (def.prefer) narrow(c => c.sector === def.prefer);
    if (def.host === 'noclip') narrow(c => !c.noclip);
    if (def.host === 'portal' || def.host === 'passage') narrow(c => !c.defs.some(d => d.host === 'portal' || d.host === 'passage'));
    let best = null;
    for (const c of cands) if (!best || c.defs.length < best.defs.length) best = c;
    best.defs.push(def);
    if (def.host === 'noclip') best.noclip++;
  }
  plan = new Map();
  for (const c of cells) plan.set(c.cx + ',' + c.cz, c);
  if (planCache.size > 400) planCache.clear();
  planCache.set(key, plan);
  return plan;
}
function planCell(seed, cx, cz) {
  return macroPlan(seed, Math.floor(cx / MACRO), Math.floor(cz / MACRO)).get(cx + ',' + cz) || null;
}
// Level Fun 的 3×3 宏格选块（沿用上一版的 tag 与算法：同种子下天花板切出点的位置和以前一样）
function macroPick(levelSeed, tag, cx, cz, span) {
  const M = span || MACRO;
  const mx = Math.floor(cx / M), mz = Math.floor(cz / M);
  const r = U.rng(levelSeed, tag, mx, mz);
  let px = mx * M + Math.floor(r() * M), pz = mz * M + Math.floor(r() * M);
  if (px === 0 && pz === 0) { px = mx * M + (M > 2 ? 2 : 1); pz = mz * M + (M > 2 ? 2 : 1); }
  return px === cx && pz === cz;
}
// Level 2 走廊口所在区块（找本块和八个邻块）：邻块的管道上加仪表盘，「沿管道与仪表盘逐渐显现的方向走」
function portalNear(seed, cx, cz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = planCell(seed, cx + dx, cz + dz);
      if (c && c.defs.some(d => d.host === 'portal')) return { dx, dz };
    }
  }
  return null;
}

// =====================================================================
// 通用几何小工具：全部合进已有材质（kit:prop / kit:glow / L1:wall），不新建材质、不建独立 mesh
// =====================================================================
// ---------- 三角面预算（第 16 节：每块 ≤ 8000）----------
// 结构（地面/楼板/梁/柱/灯/管线）和出口是必摆的，先建；货架上的货、堆垛、屋内陈设、墙面挂件这类"可多可少"的内容后建，
// 每一件动手前看一眼这块已经用了多少面，按剩下的额度分配（额度只取决于本块已建的几何 → 同种子两端逐字节一致）。
// 超额时从最不显眼的东西开始省：高层货位先空、墙面挂件先省，地面一层和柱子永远是满细节。
const TRI_BUDGET = 7600;
function rawTri(b) {
  let n = 0;
  for (const a of b._accs.values()) if (a.idx) n += a.idx.length;
  return n / 3;
}
// 画质无关的记账：kit 构件（门、电梯、桌椅柜床、水坑）高画质比低画质多 50–120 面（_kit.js hiDetail），
// 要是直接拿实际面数分预算，两个画质设置不同的联机玩家会算出不一样的货架/堆垛 —— 碰撞体、刷新点都对不上。
// 所以这些构件一律按"标称面数"入账（KIT_EST，取高画质实测值再留一点余量），账面面数只由种子决定；
// 实际面数 ≤ 账面（低画质、或 kit 自己在 7200 面以上退回简版时更少），8000 的上限照样守得住
const KIT_EST = { door: 250, elevator: 165, puddle: 66, desk: 265, deskSmall: 190, chair: 240, cabinet: 135, bed: 125 };
const kitAdj = new WeakMap();
function triCount(b) { return rawTri(b) + (kitAdj.get(b) || 0); }
function kitCall(b, est, fn) {
  const t0 = rawTri(b);
  const out = fn();
  kitAdj.set(b, (kitAdj.get(b) || 0) + est - (rawTri(b) - t0));
  return out;
}
function kitPuddle(b, x, z, opts) { return kitCall(b, KIT_EST.puddle, () => kit.prop.puddle(b, x, z, 0, opts)); }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function mulc(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
function frac(v) { return v - Math.floor(v); }

// 任意多边形面片（当前坐标系），平面法线、扇形三角化；给了 inside 就按"背离 inside"自动定正面
function facets(b, key, faces, color, inside) {
  const uv = key === 'kit:glow' ? 'solid' : key === 'kit:prop' ? 'stretch' : 'world';
  return b._piece(key, 0, 0, 0, 0, (v, t) => {
    let k = 0;
    for (let f of faces) {
      let n = norm3(cross3(sub3(f[1], f[0]), sub3(f[2], f[0])));
      if (inside) {
        let sx = 0, sy = 0, sz = 0;
        for (const p of f) { sx += p[0]; sy += p[1]; sz += p[2]; }
        const m = f.length;
        if (n[0] * (sx / m - inside[0]) + n[1] * (sy / m - inside[1]) + n[2] * (sz / m - inside[2]) < 0) {
          f = f.slice().reverse(); n = [-n[0], -n[1], -n[2]];
        }
      }
      for (const p of f) v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
      for (let i = 1; i + 1 < f.length; i++) t(k, k + i, k + i + 1);
      k += f.length;
    }
  }, { color, uv, solid: false });
}
// 两点间的方截面细杆（斜撑、树枝、钢筋、天线）：4 个侧面 8 个三角形
function stick(b, p0, p1, r, color, key) {
  const d = norm3(sub3(p1, p0));
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = norm3(cross3(d, up)), c = cross3(a, d);
  const P = (p, s, q) => [p[0] + (a[0] * s + c[0] * q) * r, p[1] + (a[1] * s + c[1] * q) * r, p[2] + (a[2] * s + c[2] * q) * r];
  const O = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const faces = [];
  for (let k = 0; k < 4; k++) {
    const s0 = O[k], s1 = O[(k + 1) % 4];
    faces.push([P(p0, s0[0], s0[1]), P(p0, s1[0], s1[1]), P(p1, s1[0], s1[1]), P(p1, s0[0], s0[1])]);
  }
  return facets(b, key || 'kit:prop', faces, color, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]);
}
// 不出碰撞体的盒子
function dbox(b, x, y, z, w, h, d, color, faces, key, rotY) {
  const k = key || 'kit:prop';
  return b.box(x, y, z, w, h, d, k, { color, solid: false, faces: faces || 'all', rotY, uv: k === 'kit:prop' ? 'stretch' : 'world' });
}
function glowBox(b, x, y, z, w, h, d, color) { return b.box(x, y, z, w, h, d, 'kit:glow', { color, solid: false, uv: 'solid' }); }
// 贴面薄片：facing 'up' 时 (x,y,z) 是中心；立面时 (x,z) 是底边中点、y 是底边高度
function sheet(b, x, y, z, w, h, facing, color, key, rotY) {
  const k = key || 'kit:prop';
  return b.plane(x, y, z, w, h, k, { facing, color, rotY, uv: k === 'kit:glow' ? 'solid' : k === 'kit:prop' ? 'stretch' : 'world' });
}
// 地面上一块不规则多边形（油渍、泥、碎屑印）：y 抬 6 mm。地面贴片高度一律错开：主通道标线 4 mm、货位角标 5 mm、
// 油渍/泥 6 mm、油心/脚垫 7 mm（不在同一种柱间）、苔藓 7.5 mm、水坑 8–10 mm —— 不许两片收在同一高度（z-fighting）
function blot(b, x, z, rx, rz, n, color, hs, y) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = -k / n * TAU, rr = 0.7 + 0.5 * hs();
    pts.push([x + Math.cos(a) * rx * rr, y || 0.006, z + Math.sin(a) * rz * rr]);
  }
  return facets(b, 'kit:prop', [pts], color, [x, -1, z]);
}
// 顶上开口的桶/柱体：侧面 + 顶盖（顶盖单独一片，底面永远看不见就不画）
function drum(b, x, y, z, r, h, color, seg) {
  const n = seg || 8;
  b.cylinder(x, y, z, r, h, 'kit:prop', { segments: n, caps: false, color, solid: false, uv: 'stretch' });
  const pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * TAU; pts.push([x + Math.sin(a) * r, y + h, z + Math.cos(a) * r]); }
  facets(b, 'kit:prop', [pts], mulc(color, 0.85), [x, y, z]);
}

// =====================================================================
// 货物（货架上、堆垛里共用）
// =====================================================================
// 可见面模式（货物在当前坐标系里正面朝 +z）：
//   0 = 落地摆放，四面和顶都看得见；1 = 货架地面一层，背面贴着另一侧的货看不见；2 = 货架高层（梁顶 ≥1.2 m 往上），
//   顶面高过眼睛（1.62 m）永远看不见、背面也看不见 —— 这两种不画看不见的面，省下来的面数给地面一层做细节
const VIS_FACES = ['noBottom', ['py', 'pz', 'px', 'nx'], ['pz', 'px', 'nx']];
// 托盘：底座一块 + 正面（和可选背面）的叉车口。宽托盘（货架上 3 m 那种）等于两块托盘并排
function pallet(b, x, y, z, w, d, rot, back, vis) {
  b.push(x, z, rot || 0, y || 0);
  dbox(b, 0, 0, 0, w, 0.13, d, C.pallet, vis ? ['py', 'pz'] : 'noBottom');
  const m = Math.max(2, Math.round(w / 0.75)), ow = w / m * 0.6;
  for (let k = 0; k < m; k++) {
    const px = -w / 2 + (k + 0.5) * w / m;
    sheet(b, px, 0.018, d / 2 + 0.003, ow, 0.075, '+z', C.palletGap);
    if (back) sheet(b, px, 0.018, -d / 2 - 0.003, ow, 0.075, '-z', C.palletGap);
  }
  b.pop();
}
// 一垛纸箱：一个大盒子 + 正面的竖缝/横缝 + 顶上的封箱胶带 + 一张标签 —— 看着是 cols×rows 个箱子，只花一个盒子的面数
function cartonBlock(b, x, y, z, w, h, d, cols, rows, rot, hs, sides, vis) {
  b.push(x, z, rot || 0, y);
  const col = mulc(C.card, 0.86 + 0.26 * hs());
  dbox(b, 0, 0, 0, w, h, d, col, VIS_FACES[vis || 0]);
  const zf = d / 2 + 0.003;
  for (let c = 1; c < cols; c++) sheet(b, -w / 2 + c * w / cols, 0, zf, 0.012, h, '+z', C.seam);
  for (let r = 1; r < rows; r++) {
    sheet(b, 0, r * h / rows - 0.006, zf, w, 0.012, '+z', C.seam);
    if (sides) {
      sheet(b, w / 2 + 0.003, r * h / rows - 0.006, 0, d, 0.012, '+x', C.seam);
      sheet(b, -w / 2 - 0.003, r * h / rows - 0.006, 0, d, 0.012, '-x', C.seam);
    }
  }
  if ((vis || 0) < 2) for (let c = 0; c < cols; c++) sheet(b, -w / 2 + (c + 0.5) * w / cols, h + 0.003, 0, 0.06, d, 'up', C.tape);
  const lc = Math.floor(hs() * cols), lr = Math.floor(hs() * rows);
  sheet(b, -w / 2 + (lc + 0.5) * w / cols, (lr + 0.35) * h / rows, zf + 0.002, 0.15, 0.1, '+z', C.label);
  b.pop();
}
// 缠膜托盘货：浅蓝灰的一块 + 两道打包带 + 一道反光
function wrapLoad(b, x, y, z, w, h, d, rot, vis) {
  b.push(x, z, rot || 0, y);
  dbox(b, 0, 0, 0, w, h, d, C.wrap, VIS_FACES[vis || 0]);
  for (const s of [-0.28, 0.28]) dbox(b, s * w, 0, 0, 0.035, h + 0.004, d + 0.008, C.strap, vis === 2 ? ['pz'] : vis === 1 ? ['py', 'pz'] : ['py', 'pz', 'nz']);
  facets(b, 'kit:prop', [[[-w * 0.42, h * 0.15, d / 2 + 0.003], [-w * 0.3, h * 0.15, d / 2 + 0.003], [w * 0.05, h * 0.9, d / 2 + 0.003], [-w * 0.07, h * 0.9, d / 2 + 0.003]]], C.sheen);
  b.pop();
}
// 编织袋：四周鼓出、顶上隆起的枕头形（12 个三角形）
function sack(b, x, y, z, w, h, d, rot, color) {
  b.push(x, z, rot || 0, y);
  const hw = w / 2, hd = d / 2, iw = hw * 0.78, id = hd * 0.78, hm = h * 0.6;
  const B = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  const T = [[-iw, hm, -id], [iw, hm, -id], [iw, hm, id], [-iw, hm, id]];
  const A = [0, h, 0];
  const faces = [];
  for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; faces.push([B[k], B[k2], T[k2], T[k]]); faces.push([T[k], T[k2], A]); }
  facets(b, 'kit:prop', faces, color, [0, h * 0.3, 0]);
  b.pop();
}
// 木箱：箱体 + 上下两圈箍条 + 正面一道斜撑 + 一块模板喷字
function crate(b, x, y, z, w, h, d, rot, color, vis) {
  b.push(x, z, rot || 0, y);
  const c = color || C.crate;
  dbox(b, 0, 0, 0, w, h, d, c, VIS_FACES[vis || 0]);
  const band = vis ? ['pz', 'px', 'nx'] : 'sides';
  dbox(b, 0, 0.05, 0, w + 0.02, 0.07, d + 0.02, C.crateBand, band);
  dbox(b, 0, h - 0.12, 0, w + 0.02, 0.07, d + 0.02, C.crateBand, band);
  const zf = d / 2 + 0.004;
  facets(b, 'kit:prop', [[[-w / 2 + 0.05, 0.12, zf], [-w / 2 + 0.14, 0.12, zf], [w / 2 - 0.05, h - 0.12, zf], [w / 2 - 0.14, h - 0.12, zf]]], C.crateBand);
  sheet(b, w * 0.18, h * 0.42, zf + 0.002, w * 0.3, h * 0.14, '+z', [0.2, 0.17, 0.13]);
  b.pop();
}
// 周转箱：侧面 + 顶上一块深色（箱口里的阴影）+ 正面一个把手孔
function tote(b, x, y, z, w, h, d, color, rot, vis) {
  b.push(x, z, rot || 0, y);
  dbox(b, 0, 0, 0, w, h, d, color, vis ? ['pz', 'px', 'nx'] : 'sides');
  if ((vis || 0) < 2) sheet(b, 0, h - 0.02, 0, w - 0.04, d - 0.04, 'up', mulc(color, 0.35));
  sheet(b, 0, h - 0.09, d / 2 + 0.003, Math.min(0.12, w * 0.4), 0.035, '+z', mulc(color, 0.3));
  b.pop();
}
// 铁桶：桶身 + 顶盖 + 两道滚箍 + 桶口
function barrel(b, x, y, z, color) {
  const r = 0.29, h = 0.88;
  drum(b, x, y, z, r, h, color, 8);
  for (const yy of [0.3, 0.6]) b.cylinder(x, y + yy, z, r + 0.012, 0.035, 'kit:prop', { segments: 8, caps: false, color: mulc(color, 0.8), solid: false, uv: 'stretch' });
  dbox(b, x + 0.12, y + h, z + 0.06, 0.06, 0.018, 0.06, mulc(color, 0.6), 'noBottom');
}
// 一格货（货架一个 section 的一侧、一层），front=+z 面向通道
const LOAD0 = [['cartons', 0.32], ['wrap', 0.18], ['barrels', 0.08], ['sacks', 0.12], ['crates', 0.1], ['empty', 0.1], ['bins', 0.1]];
const LOAD1 = [['cartons', 0.38], ['wrap', 0.14], ['bins', 0.14], ['crates', 0.1], ['empty', 0.18], ['sacks', 0.06]];
function rackLoad(b, xc, y0, zc, W, D, hMax, level, s, r, st) {
  const kind = U.weighted(r, level === 0 ? LOAD0 : LOAD1);
  const rot = s > 0 ? 0 : Math.PI;
  const vis = level === 0 ? 1 : 2;
  const k1 = r(), k2 = r(), k3 = r();
  if (kind === 'empty') {
    if (k1 < 0.35) cartonBlock(b, xc + (k2 - 0.5) * W * 0.5, y0, zc, 0.6, 0.45, 0.5, 1, 1, rot + (k3 - 0.5) * 0.3, r, false, level ? 2 : 0);
    return;
  }
  if (kind === 'bins') {
    const n = 3 + Math.floor(k1 * 2), bw = (W - 0.1) / n;
    const col = C.totes[Math.floor(k2 * C.totes.length)];
    for (let i = 0; i < n; i++) tote(b, xc - W / 2 + 0.05 + (i + 0.5) * bw, y0, zc, bw - 0.06, 0.34 + 0.08 * (i % 2), D * 0.7, col, rot, vis);
    return;
  }
  pallet(b, xc, y0, zc, W, D, rot, false, vis);
  const y1 = y0 + 0.13, room = hMax - 0.13;
  if (kind === 'cartons') {
    const h = room * (0.5 + 0.45 * k1);
    cartonBlock(b, xc + (k2 - 0.5) * 0.08, y1, zc, W - 0.06 - 0.12 * k3, h, D - 0.05, 3 + (k2 < 0.5 ? 1 : 0), h > 0.55 ? 2 : 1, rot, r, false, vis);
  } else if (kind === 'wrap') {
    wrapLoad(b, xc - W / 4, y1, zc, W / 2 - 0.06, room * (0.7 + 0.25 * k1), D - 0.04, rot, vis);
    if (k2 < 0.7) wrapLoad(b, xc + W / 4, y1, zc, W / 2 - 0.06, room * (0.55 + 0.35 * k3), D - 0.04, rot, vis);
  } else if (kind === 'barrels') {
    for (let i = 0; i < 3; i++) if (i !== 1 || k1 < 0.6) barrel(b, xc + (i - 1) * 0.75, y1, zc, C.drums[Math.floor((k2 + i * 0.37) % 1 * C.drums.length)]);
  } else if (kind === 'sacks') {
    // 一层三袋、上面再压两袋（交错码放）
    const col = C.sacks[Math.floor(k1 * C.sacks.length)];
    for (let i = 0; i < 3; i++) sack(b, xc + (i - 1) * W / 3, y1, zc + (i % 2 - 0.5) * 0.08, W / 3 - 0.03, 0.22, D * 0.8, (k2 - 0.5) * 0.2, col);
    if (room > 0.5) for (let i = 0; i < 2; i++) sack(b, xc + (i - 0.5) * W / 3, y1 + 0.19, zc, W / 3 - 0.05, 0.2, D * 0.72, (k3 - 0.5) * 0.3, col);
  } else if (kind === 'crates') {
    const cc = st.crates ? [0.45 + k1 * 0.3, 0.35 + k2 * 0.25, 0.2 + k3 * 0.2] : C.crate;
    crate(b, xc - W / 4, y1, zc, W / 2 - 0.12, Math.min(room, 0.62), D - 0.1, rot, cc, vis);
    if (k2 < 0.75) crate(b, xc + W / 4, y1, zc, W / 2 - 0.16, Math.min(room, 0.55), D - 0.14, rot, cc, vis);
  }
}

// =====================================================================
// 结构：地面、楼板、梁、柱、主通道标线
// =====================================================================
function buildShell(b, env) {
  const st = env.st;
  kit.prop.floor(b, null, null, 0, { matKey: 'L1:floor', color: st.floor });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L1:wall', y: H, color: CEIL_COLOR });
  // 主梁：沿每条柱线满跨，梁底 3.55。梁两端贴着邻块那一段、不画端面；十字交叉处的梁底被柱身包住
  const bc = mulc(st.concrete, 0.92);
  for (const L of LINES) {
    dbox(b, SIZE / 2, H - BEAM_D, L, SIZE, BEAM_D, BEAM_W, bc, ['ny', 'pz', 'nz'], 'L1:wall');
    dbox(b, L, H - BEAM_D, SIZE / 2, BEAM_W, BEAM_D, SIZE, bc, ['ny', 'px', 'nx'], 'L1:wall');
  }
  // 主通道两侧的黄色标线（旧漆、断续）：区块边界两边各 4 m 是主通道，标线离柱线 0.8 m；十字路口处断开
  const lineCol = [0.8, 0.64, 0.16];
  const hs = U.rng(b.seed, b.cx, b.cz, 'L1-marks');
  for (const zz of [3.2, 28.8]) {
    for (let x = 4.8; x < 27.2; x += 2.8) {
      const len = Math.min(2.8 - 0.3 - hs() * 0.4, 27.2 - x);
      sheet(b, x + len / 2, 0.004, zz, len, 0.12, 'up', lineCol);
      sheet(b, zz, 0.004, x + len / 2, 0.12, len, 'up', lineCol);
    }
  }
}

// 柱子：柱脚 → 柱身（下段刷漆、漆面剥落、上段水渍）→ 喇叭口托 → 柱帽板，顶到梁。每根柱按世界坐标哈希，谁画都一样
function buildPillar(b, x, z, env) {
  const st = env.st, K = 'L1:wall';
  const wx = Math.round(b.ox + x), wz = Math.round(b.oz + z);
  const r = U.rng(b.seed, 'L1-pillar', wx, wz);
  const S = st.pillar;
  const shade = 0.86 + r() * 0.12;
  const conc = mulc(st.concrete, shade);
  const paint = st.paint === 'multi' ? MULTI_PAINT[Math.floor(r() * MULTI_PAINT.length)] : st.paint;
  const bandTop = 1.2 + r() * 0.3;
  const onAisle = x === LINES[0] || x === LINES[3] || z === LINES[0] || z === LINES[3];
  b.push(x, z, 0);
  if (st.round) {
    // 哥特段：八角柱（哥特式教堂常见的柱式）+ 八角柱础 + 喇叭口柱头
    const R = S * 0.56, RSEG = 8;
    b.cylinder(0, 0, 0, R + 0.13, 0.26, K, { segments: RSEG, caps: false, color: mulc(conc, 0.82), solid: false });
    const disc = [];
    for (let k = 0; k < RSEG; k++) { const a = k / RSEG * TAU; disc.push([Math.sin(a) * (R + 0.13), 0.26, Math.cos(a) * (R + 0.13)]); }
    facets(b, K, [disc], mulc(conc, 0.82), [0, 0, 0]);
    b.cylinder(0, 0, 0, R, H, K, { segments: RSEG, caps: false, color: conc, solid: true });
    b.cylinder(0, 0.26, 0, R + 0.012, bandTop - 0.26, K, { segments: RSEG, caps: false, color: paint, solid: false });
    b.cylinder(0, bandTop, 0, R + 0.018, 0.05, K, { segments: RSEG, caps: false, color: st.stripe, solid: false });
    b.cylinder(0, H - 0.95, 0, R, 0.35, K, { rTop: R + 0.3, segments: RSEG, caps: false, color: conc, solid: false });
    dbox(b, 0, H - 0.6, 0, 2 * R + 0.7, 0.14, 2 * R + 0.7, conc, 'noTop', K);
    b.pop();
    return;
  }
  const h2 = S / 2;
  dbox(b, 0, 0, 0, S + 0.16, 0.22, S + 0.16, mulc(conc, 0.8), 'noBottom', K);
  b.box(0, 0, 0, S, H, S, K, { faces: 'sides', color: conc, solid: true });
  // 下段刷漆 + 漆边一道深色线
  dbox(b, 0, 0.22, 0, S + 0.02, bandTop - 0.22, S + 0.02, paint, 'sides', K);
  dbox(b, 0, bandTop, 0, S + 0.03, 0.05, S + 0.03, st.stripe, 'sides', K);
  // 剥落：漆面上露出底下的混凝土（不规则小块，贴在漆面外 3 mm）
  const nPeel = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nPeel; k++) {
    const f = Math.floor(r() * 4), u = (r() - 0.5) * (S - 0.2), v = 0.35 + r() * (bandTop - 0.55);
    const rx = 0.05 + r() * 0.1, ry = 0.04 + r() * 0.09, zf = h2 + 0.013;
    const pts = [];
    for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; const rr = 0.65 + r() * 0.5; pts.push([u + Math.cos(a) * rx * rr, v + Math.sin(a) * ry * rr, zf]); }
    b.push(0, 0, f * HALF_PI);
    facets(b, K, [pts], conc, [u, v, 0]);
    b.pop();
  }
  // 水渍：从柱帽往下挂的深色竖条，上宽下窄
  const nStain = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nStain; k++) {
    const f = Math.floor(r() * 4), u = (r() - 0.5) * (S - 0.2), w = 0.06 + r() * 0.16;
    const yTop = H - 0.96, yBot = Math.max(bandTop + 0.15, yTop - 0.6 - r() * 1.5), zf = h2 + 0.004;
    b.push(0, 0, f * HALF_PI);
    facets(b, K, [[[u - w / 2, yTop, zf], [u - w * 0.15, yBot, zf], [u + w * 0.15, yBot, zf], [u + w / 2, yTop, zf]]], mulc(conc, 0.62), [u, 2, 0]);
    b.pop();
  }
  // 主通道边上的柱子：黄色护角 + 柱号牌（白底两道黑杠）。护角是包住柱角的角钢，只画朝外的两面（里面两面埋在柱身里）
  if (onAisle) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) dbox(b, sx * h2, 0.22, sz * h2, 0.075, 0.9, 0.075, C.yellow, [sx > 0 ? 'px' : 'nx', sz > 0 ? 'pz' : 'nz']);
    const f = z === LINES[0] ? 2 : z === LINES[3] ? 0 : x === LINES[0] ? 3 : 1;
    b.push(0, 0, f * HALF_PI);
    sheet(b, 0, 2.05, h2 + 0.007, 0.34, 0.24, '+z', [0.92, 0.91, 0.86]);
    sheet(b, -0.06, 2.09, h2 + 0.01, 0.07, 0.16, '+z', C.black);
    sheet(b, 0.06, 2.09, h2 + 0.01, 0.07, 0.16, '+z', C.black);
    b.pop();
  }
  // 喇叭口托：四个斜面（平面法线，棱角分明）+ 柱帽板
  const a0 = h2, a1 = h2 + 0.25, y0 = H - 0.95, y1 = H - 0.6;
  facets(b, K, [
    [[-a0, y0, a0], [a0, y0, a0], [a1, y1, a1], [-a1, y1, a1]],
    [[a0, y0, -a0], [-a0, y0, -a0], [-a1, y1, -a1], [a1, y1, -a1]],
    [[a0, y0, a0], [a0, y0, -a0], [a1, y1, -a1], [a1, y1, a1]],
    [[-a0, y0, -a0], [-a0, y0, a0], [-a1, y1, a1], [-a1, y1, -a1]],
  ], conc, [0, (y0 + y1) / 2, 0]);
  dbox(b, 0, H - 0.6, 0, S + 0.55, 0.14, S + 0.55, conc, 'noTop', K);
  b.pop();
}

// 吊灯：两根吊杆 + 白铁灯罩 + 两侧反光翼 + 两根灯管；灯管跟着灯光描述明灭（闪烁、断电）
function buildLamp(b, x, z, along, env, hs) {
  const r0 = hs();
  const state = r0 < 0.05 ? 'broken' : r0 < 0.15 ? 'flicker' : 'on';   // 依据：lighting「房间内为惨白的荧光」，少数坏灯/闪灯
  const flick = 0.3 + hs() * 0.4;
  const onBeam = env.lampOnBeam(x, z);
  b.push(x, z, along === 'z' ? HALF_PI : 0);
  const top = onBeam ? H - BEAM_D : H;
  for (const sx of [-0.5, 0.5]) dbox(b, sx, LAMP_Y + 0.07, 0, 0.014, top - LAMP_Y - 0.07, 0.014, C.rod, 'sides');
  dbox(b, 0, LAMP_Y, 0, 1.3, 0.07, 0.2, C.housing, 'noTop');
  facets(b, 'kit:prop', [
    [[-0.65, LAMP_Y, 0.1], [0.65, LAMP_Y, 0.1], [0.65, LAMP_Y - 0.06, 0.17], [-0.65, LAMP_Y - 0.06, 0.17]],
    [[0.65, LAMP_Y, -0.1], [-0.65, LAMP_Y, -0.1], [-0.65, LAMP_Y - 0.06, -0.17], [0.65, LAMP_Y - 0.06, -0.17]],
  ], C.housing, [0, LAMP_Y + 0.5, 0]);
  const lit = state !== 'broken';
  const base = lit ? C.tube : [0.2, 0.2, 0.2];
  const t1 = sheet(b, 0, LAMP_Y - 0.004, -0.045, 1.2, 0.035, 'down', base, 'kit:glow');
  const t2 = sheet(b, 0, LAMP_Y - 0.004, 0.045, 1.2, 0.035, 'down', base, 'kit:glow');
  if (lit) {
    const src = b.light({ x: 0, z: 0, y: LAMP_Y - 0.1, color: 0xf2f4ec, intensity: env.st.lamp,
      // range 5.5：惧光实体（smiler 阈值 lightAt 0.6）在两盏灯之间还有暗处可待（上一版验收的结论，保留）
      range: 5.5, flicker: state === 'flicker' ? flick : 0 });
    b.linkGlow(t1, src, C.tube);
    b.linkGlow(t2, src, C.tube);
  }
  b.pop();
}

// 顶棚管线：沿 x / z 的管道按"整行/整列区块"哈希定位置（邻块算出来一样 → 管子跨区块连续不断）
const PIPE_SLOTS = [6.4, 9.6, 14.4, 17.6, 22.4, 25.6];   // 柱间中线 ±1.6：躲开柱线上的吊灯和柱帽
function pipeLines(seed, axis, idx) {
  const r = U.rng(seed, 'L1-pipes-' + axis, idx);
  const n = r() < 0.55 ? 2 : 1;
  const out = [];
  let s0 = -1;
  for (let k = 0; k < n; k++) {
    let s = Math.floor(r() * PIPE_SLOTS.length);
    if (s === s0) s = (s + 3) % PIPE_SLOTS.length;
    s0 = s;
    out.push({ pos: PIPE_SLOTS[s], r: [0.05, 0.065, 0.085][Math.floor(r() * 3)], color: C.pipes[Math.floor(r() * C.pipes.length)], twin: r() < 0.5, valve: Math.floor(r() * 4) });
  }
  return out;
}
function buildPipes(b, env) {
  const near = env.portalNear;
  for (const axis of ['x', 'z']) {
    const lines = pipeLines(b.seed, axis, axis === 'x' ? b.cz : b.cx);
    const y = axis === 'x' ? 3.42 : 3.2;
    // 离 Level 2 走廊口一块之内、朝着它那个方向的管子上装仪表盘
    const gauges = near && (near.dx !== 0 || near.dz !== 0) && (axis === 'x' ? near.dz === 0 || near.dx !== 0 : near.dx === 0 || near.dz !== 0);
    for (const P of lines) {
      b.push(axis === 'x' ? 0 : P.pos, axis === 'x' ? P.pos : 0, axis === 'x' ? 0 : -HALF_PI);
      // 当前坐标系：管子沿本地 +x 从 0 到 32（axis z 时转了 −90°，本地 x → 世界 +z）
      b.cylinder(SIZE / 2, y, 0, P.r, SIZE, 'kit:prop', { axis: 'x', segments: 8, caps: false, color: P.color, solid: false, uv: 'stretch' });
      if (P.twin) b.cylinder(SIZE / 2, y + 0.02, 0.24, P.r * 0.55, SIZE, 'kit:prop', { axis: 'x', segments: 6, caps: false, color: mulc(P.color, 0.8), solid: false, uv: 'stretch' });
      // 吊杆 + 托码：每 8 m 一副（躲开柱线上的主梁）
      for (let k = 0; k < 4; k++) {
        const ax = 2 + k * 8;
        dbox(b, ax, y + P.r, 0, 0.02, H - y - P.r, 0.02, C.rod, 'sides');
        dbox(b, ax, y - P.r - 0.02, 0, 0.04, 0.02, P.r * 2 + 0.06, C.rod, ['ny', 'pz', 'nz']);
      }
      for (const fx of [0.05, 16]) b.cylinder(fx, y, 0, P.r * 1.45, 0.05, 'kit:prop', { axis: 'x', segments: 8, caps: false, color: mulc(P.color, 0.75), solid: false, uv: 'stretch' });
      // 阀门手轮
      const vx = 4 + P.valve * 8;
      stick(b, [vx, y - P.r, 0], [vx, y - P.r - 0.16, 0], 0.018, C.steel);
      b.cylinder(vx, y - P.r - 0.19, 0, 0.12, 0.03, 'kit:prop', { segments: 8, caps: false, color: C.red, solid: false, uv: 'stretch' });
      if (gauges && P === lines[0]) for (const gx of [7, 23]) gauge(b, gx, y - P.r, P.r);
      b.pop();
    }
  }
  // 电缆桥架：沿主通道（区块本地 z=1.6）走 x 方向，全层每块同一位置 → 连续
  const ty = 3.35;
  dbox(b, SIZE / 2, ty, 1.6, SIZE, 0.02, 0.32, C.galv, ['py', 'ny'], 'kit:prop');
  for (const s of [-1, 1]) dbox(b, SIZE / 2, ty, 1.6 + s * 0.16, SIZE, 0.08, 0.015, C.galv, ['pz', 'nz', 'py']);
  b.cylinder(SIZE / 2, ty + 0.05, 1.54, 0.025, SIZE, 'kit:prop', { axis: 'x', segments: 5, caps: false, color: C.dark, solid: false, uv: 'stretch' });
  b.cylinder(SIZE / 2, ty + 0.045, 1.66, 0.02, SIZE, 'kit:prop', { axis: 'x', segments: 5, caps: false, color: [0.5, 0.14, 0.1], solid: false, uv: 'stretch' });
  for (let k = 0; k < 4; k++) {
    const tx = 2 + k * 8;
    for (const s of [-1, 1]) dbox(b, tx, ty + 0.08, 1.6 + s * 0.17, 0.015, H - ty - 0.08, 0.015, C.rod, 'sides');
    dbox(b, tx, ty - 0.03, 1.6, 0.04, 0.03, 0.4, C.rod, ['ny', 'px', 'nx']);   // 桥架底下的横担
  }
}
// 压力表：管底伸下一截短管，表盘朝两侧（白色表面微微发亮 + 黑指针）
function gauge(b, x, y, r) {
  stick(b, [x, y, 0], [x, y - 0.18, 0], 0.015, C.steel);
  b.cylinder(x, y - 0.27, 0, 0.08, 0.05, 'kit:prop', { axis: 'z', segments: 8, caps: false, color: C.dark, solid: false, uv: 'stretch' });
  for (const s of [-1, 1]) {
    const face = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + TAU / 16; face.push([x + Math.cos(a) * 0.072, y - 0.27 + Math.sin(a) * 0.072, s * 0.026]); }
    facets(b, 'kit:glow', [face], [0.95, 0.93, 0.85], [x, y - 0.27, 0]);
    facets(b, 'kit:prop', [[[x - 0.004, y - 0.27, s * 0.03], [x + 0.004, y - 0.27, s * 0.03], [x + 0.05, y - 0.23, s * 0.03]]], C.black, [x, y - 0.25, 0]);
  }
}

// =====================================================================
// 柱间格局
// =====================================================================
// 区块 3×3 个柱间（中心 8/16/24）。出口需要的柱间先定，其余按区段权重随机
function planBays(rng, defs, isSpawn, st) {
  const bays = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      bays.push({ i, j, k: j * 3 + i, x: 8 + 8 * i, z: 8 + 8 * j, type: null, rot: null, exits: [], noclip: null, roll: rng(), vroll: rng(), order: rng() });
    }
  }
  if (isSpawn) {
    // 出生块：典型的仓库样子，东边一间亮着绿灯的办公小屋
    const T = ['rack', 'rack', 'rack', 'stack', 'open', 'hut', 'rack', 'rack', 'stack'];
    bays.forEach((bb, k) => { bb.type = T[k]; });
    bays[5].hutKind = 'office';
    bays[5].rot = -HALF_PI;
    return bays;
  }
  const queue = bays.slice().sort((a, b) => a.order - b.order);
  const take = type => { const bb = queue.find(q => !q.type); if (bb) bb.type = type; return bb; };
  for (const d of defs) if (d.host === 'portal' || d.host === 'passage') { const bb = take(d.host); if (bb) bb.exits.push(d); }
  for (const d of defs) if (d.host === 'noclip') { const bb = take('wall'); if (bb) bb.noclip = d; }
  for (const d of defs) {
    if (d.host !== 'floor') continue;
    const bb = take('open') || bays.find(q => q.type === 'open' && q.exits.length < 2);
    if (bb) bb.exits.push(d);
  }
  // 墙面出口要有地方挂：承重墙两面约 3 个好位置、小屋三面约 5 个
  const nWall = defs.filter(d => d.host === 'wall').length;
  let cap = 0;
  for (const bb of bays) if (bb.type === 'wall') cap += 3;
  while (cap < nWall) { if (!take('hut')) break; cap += 5; }
  for (const bb of bays) if (!bb.type) bb.type = U.weighted(() => bb.roll, st.bays);
  return bays;
}
const EDGE_ROT = [0, -HALF_PI, Math.PI, HALF_PI];     // 承重墙在本地 −z：北、东、南、西
const FACE_ROT = [Math.PI, HALF_PI, 0, -HALF_PI];     // 门/开口在本地 +z：朝北、东、南、西
const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function neighborScore(env, bay, e, forWall) {
  const ni = bay.i + NB[e][0], nj = bay.j + NB[e][1];
  if (ni < 0 || ni > 2 || nj < 0 || nj > 2) return 3;   // 朝主通道
  const nb = env.bays[nj * 3 + ni];
  switch (nb.type) {
    case 'open': return nb.exits.length ? 1.6 : 2.5;
    case 'rack': return ((e % 2 === 0) === (env.orient === 'x')) ? 2 : 1.1;   // 货架排和这条边平行 = 面前是通道
    case 'stack': case 'build': case 'grove': return 1;
    case 'wall': return forWall ? -6 : 0.6;
    default: return forWall ? -6 : 0.2;
  }
}
function finishLayout(env) {
  const used = new Set();
  const lineKey = (bay, e) => e === 0 ? 'h' + bay.j + ',' + bay.i : e === 2 ? 'h' + (bay.j + 1) + ',' + bay.i : e === 3 ? 'v' + bay.i + ',' + bay.j : 'v' + (bay.i + 1) + ',' + bay.j;
  for (const bay of env.bays) {
    if (bay.type !== 'wall') continue;
    let best = -1, bs = -Infinity;
    for (let e = 0; e < 4; e++) {
      const s = (used.has(lineKey(bay, e)) ? -20 : 0) + neighborScore(env, bay, e, true) + frac(bay.vroll * (e + 1) * 7.13) * 0.4;
      if (s > bs) { bs = s; best = e; }
    }
    used.add(lineKey(bay, best));
    bay.edge = best;
    bay.rot = EDGE_ROT[best];
    // 记下墙所在的柱线段（吊灯碰上就往墙这一侧挪开）
    const horiz = best === 0 || best === 2;
    const line = horiz ? (best === 0 ? bay.z - 4 : bay.z + 4) : (best === 3 ? bay.x - 4 : bay.x + 4);
    const a0 = horiz ? bay.x - 4 : bay.z - 4;
    env.walls.push({ horiz, line, a0, a1: a0 + 8, side: (best === 0 || best === 3) ? 1 : -1 });
  }
  for (const bay of env.bays) {
    if (bay.rot != null || !(bay.type === 'hut' || bay.type === 'portal' || bay.type === 'passage')) continue;
    let best = 0, bs = -Infinity;
    for (let e = 0; e < 4; e++) {
      const s = neighborScore(env, bay, e, false) + frac(bay.vroll * (e + 3) * 5.71) * 0.4;
      if (s > bs) { bs = s; best = e; }
    }
    bay.rot = FACE_ROT[best];
  }
}

// 记一个墙面挂门位：(lx, lz) 是当前柱间坐标系里墙面上的点，lrot 是墙面朝外的方向
function addSlot(b, env, bay, lx, lz, lrot, host) {
  const p = b.point(lx, lz);
  env.slots.push({ x: p.x, z: p.z, rot: bay.rot + lrot, host, used: false, n: env.slots.length });
}
function slotScore(s, env) {
  const px = s.x + Math.sin(s.rot) * 2.3, pz = s.z + Math.cos(s.rot) * 2.3;
  if (px < 4 || px > 28 || pz < 4 || pz > 28) return 3;
  const i = Math.min(2, Math.max(0, Math.floor((px - 4) / 8))), j = Math.min(2, Math.max(0, Math.floor((pz - 4) / 8)));
  const bay = env.bays[j * 3 + i];
  const lx = px - bay.x, lz = pz - bay.z;
  switch (bay.type) {
    case 'open': return bay.exits.length ? 1.4 : 2.5;
    case 'rack': return Math.abs(env.orient === 'x' ? lz : lx) < 1.5 ? -4 : 1.8;
    case 'stack': case 'build': case 'grove': return (Math.abs(lx) < 2.6 && Math.abs(lz) < 2.5) ? -2 : 1;
    case 'wall': return 1.2;
    default: return (Math.abs(lx) < 3.5 && Math.abs(lz) < 3.5) ? -5 : 0.4;
  }
}

// 柱间分两遍建：
//   core —— 必摆的结构和出口：小屋外壳+门、承重墙、Level 2 走廊口、Level 38 小径、空柱间里的地面出口（挂门位也在这一遍登记）；
//   fill —— 可多可少的内容：货架（含货）、堆垛、屋内陈设、空地上的杂物，按 cap（本柱间分到的面数上限）取舍。
// 每个柱间一条自己的派生流，两遍共用（core 先吃、fill 接着吃），和别的柱间互不干扰
function bayRng(b, bay) {
  if (!bay.r) bay.r = U.rng(b.seed, b.cx, b.cz, 'L1-bay', bay.k);
  return bay.r;
}
function buildBayCore(b, bay, env) {
  const r = bayRng(b, bay);
  switch (bay.type) {
    case 'open': if (bay.exits.length) openBayExits(b, bay, r, env); break;
    case 'hut': hutBay(b, bay, r, env); break;
    case 'wall': wallBay(b, bay, r, env); break;
    case 'portal': portalBay(b, bay, r, env); break;
    case 'passage': passageBay(b, bay, r, env); break;
  }
}
function buildBayFill(b, bay, env, cap) {
  const r = bayRng(b, bay);
  switch (bay.type) {
    case 'rack': rackBay(b, bay, r, env, cap); break;
    case 'stack': stackBay(b, bay, r, env, cap); break;
    case 'open': openBay(b, bay, r, env, cap); break;
    case 'hut': if (triCount(b) + 120 < cap) { b.push(bay.x, bay.z, bay.rot); hutInterior(b, bay.hutKindFinal, r, env, cap); b.pop(); } break;
    case 'wall': wallBayFill(b, bay, r, env, cap); break;
    case 'build': if (triCount(b) + 350 < cap) buildSiteBay(b, bay, r, env); break;
    case 'grove': if (triCount(b) + 200 < cap) groveBay(b, bay, r, env); break;
  }
}
// 各类柱间在 fill 这一遍的"胃口"（按比例分剩余预算）、保底面数（货架的架子+地面一层货、堆垛的前两个货位）、先后次序
const FILL_WEIGHT = { rack: 3, stack: 1.4, hut: 1.1, open: 0.45, wall: 0.4, build: 0.9, grove: 0.7 };
const FILL_MIN = { rack: 430, stack: 180, hut: 500 };
const FILL_ORDER = { hut: 0, rack: 1, stack: 2, wall: 3, open: 4, build: 5, grove: 6 };
function fillBays(b, bays, env) {
  const list = bays.filter(bb => FILL_WEIGHT[bb.type]).sort((a, c) => FILL_ORDER[a.type] - FILL_ORDER[c.type] || a.k - c.k);
  let wLeft = 0, minLeft = 0;
  for (const bb of list) { wLeft += FILL_WEIGHT[bb.type]; minLeft += FILL_MIN[bb.type] || 0; }
  for (const bay of list) {
    const w = FILL_WEIGHT[bay.type], mn = FILL_MIN[bay.type] || 0;
    wLeft -= w; minLeft -= mn;
    const used = triCount(b);
    // 先给后面的柱间留足保底，剩下的按胃口比例分；最后 300 面留给墙面挂件和区段点缀
    const left = TRI_BUDGET - 300 - used - minLeft;
    const share = left > 0 ? left * w / (wLeft + w) : 0;
    // 绝对上限：再怎么分也不越过 TRI_BUDGET − 200（单件货最多再冒 ~190 面，最后仍在 8000 以内）
    const cap = Math.min(TRI_BUDGET - 200, used + Math.max(Math.min(mn, Math.max(0, TRI_BUDGET - used - minLeft)), share));
    buildBayFill(b, bay, env, cap);
  }
}

// ---------- 货架排 ----------
// 依据：architecture「两边排着金属货架（像零售店后间）、堆满板条箱的长通道」。
// 双面托盘货架沿柱间中线，长 6.6 m（两节），相邻柱间的货架排首尾相接、在柱线处留 1.4 m 横穿口
// cap：本柱间可以用到的三角面上限（buildChunk 按剩余预算分配）。货位按"地面一层 → 第二层 → 顶层"的顺序上货，
// 超了就让后面的货位空着 —— 高处空几格货位的货架本来就常见，地面一层（离眼睛最近）永远先摆满
function rackBay(b, bay, r, env, cap) {
  if (triCount(b) + 280 > cap) { emptyRackBay(b, bay, r, env); return; }
  b.push(bay.x, bay.z, env.orient === 'x' ? 0 : HALF_PI);
  const len = 6.6, n = 2, L = len / n, X0 = -len / 2;
  const up = C.rackBlue, beam = C.rackOrange;
  for (let f = 0; f <= n; f++) {
    const x = X0 + f * L;
    for (const s of [-1, 1]) {
      dbox(b, x, 0, s * 1.06, 0.08, RACK_H, 0.07, up, 'sides');
      dbox(b, x, 0, s * 0.14, 0.08, RACK_H, 0.07, up, ['px', 'nx', s > 0 ? 'pz' : 'nz']);   // 背立柱：朝另一半货架那面（21 cm 缝里）看不见
      dbox(b, x, 0, s * 1.08, 0.15, 0.012, 0.13, C.steel, ['py']);   // 地脚板（1 cm 厚，侧面看不出来）
      // 立柱正面一列冲孔（深色细条，挂横梁用的孔位）
      sheet(b, x, 0.25, s * (1.06 + 0.035) + s * 0.002, 0.025, RACK_H - 0.4, s > 0 ? '+z' : '-z', mulc(up, 0.45));
    }
    if (f === 0 || f === n) for (const s of [-1, 1]) frameBraces(b, x, s, up, x < 0 ? -1 : 1);
  }
  for (let k = 0; k < n; k++) {
    const xc = X0 + (k + 0.5) * L;
    for (const s of [-1, 1]) {
      RACK_LEVELS.forEach((lv, li) => {
        // 横梁：朝通道的正面 + 底面，低的那根顶面也看得见；梁头两端的挂片
        dbox(b, xc, lv - 0.1, s * 1.06, L - 0.08, 0.1, 0.05, beam, li === 0 ? ['py', 'ny', s > 0 ? 'pz' : 'nz'] : ['ny', s > 0 ? 'pz' : 'nz']);
        dbox(b, xc, lv, s * 0.6, L - 0.08, 0.02, 0.9, C.deck, ['py']);
        if (li === 0) sheet(b, xc, lv + 0.023, s * 0.6, 0.02, 0.88, 'up', mulc(C.deck, 0.6));   // 钢丝网层板的纵筋（高层看不见）
      });
      // 货位标签条（横梁正面，一小块白色）
      sheet(b, xc - L * 0.3, RACK_LEVELS[0] - 0.08, s * 1.088, 0.12, 0.06, s > 0 ? '+z' : '-z', C.label);
    }
  }
  // 排头护栏（黄色钢板 + 黑色压顶）：顶面被压顶盖住、朝货架那面贴着端框，都不画
  for (const e of [-1, 1]) {
    dbox(b, e * (len / 2 + 0.17), 0, 0, 0.1, 0.42, 2.3, C.yellow, [e > 0 ? 'px' : 'nx', 'pz', 'nz']);
    dbox(b, e * (len / 2 + 0.17), 0.42, 0, 0.11, 0.06, 2.31, C.black, ['py', e > 0 ? 'px' : 'nx', 'pz', 'nz']);
  }
  b.solid(-len / 2 - 0.25, 0, -1.16, len / 2 + 0.25, RACK_H, 1.16);
  // 货位：地面一层 + 两层横梁上（先下后上，超预算的高层货位空着）
  const LV = [[0, 1.05], [RACK_LEVELS[0] + 0.02, 0.9], [RACK_LEVELS[1] + 0.02, 0.68]];
  LV.forEach(([y0, hMax], level) => {
    for (let k = 0; k < n; k++) for (const s of [-1, 1]) {
      if (triCount(b) > cap) { r(); b.data.rackSkip = (b.data.rackSkip || 0) + 1; continue; }
      rackLoad(b, X0 + (k + 0.5) * L, y0, s * 0.6, L - 0.24, 0.92, hMax, level, s, r, env.st);
    }
  });
  // 通道里偶尔掉下来的一个纸箱 / 一滩水
  if (r() < 0.3) { const sx = r() < 0.5 ? -1 : 1; cartonBlock(b, (r() - 0.5) * 4, 0, sx * 2.1, 0.55, 0.4, 0.45, 1, 1, r() * 3, r); }
  if (r() < 0.2) { const px = (r() - 0.5) * 5, pz = (r() < 0.5 ? -1 : 1) * 2.6; kitPuddle(b, px, pz, { rx: 0.7, rz: 0.4, y: 0.009 }); markPuddle(b, px, pz); }
  b.pop();
}
// 预算见底时的货架位：货架已经搬走，地上只剩一圈货位线、一块空托盘和立柱的地脚螺栓孔
function emptyRackBay(b, bay, r, env) {
  b.push(bay.x, bay.z, env.orient === 'x' ? 0 : HALF_PI);
  for (const s of [-1, 1]) sheet(b, 0, 0.005, s * 1.1, 6.8, 0.06, 'up', [0.75, 0.6, 0.15]);
  for (const e of [-1, 1]) sheet(b, e * 3.4, 0.005, 0, 0.06, 2.14, 'up', [0.75, 0.6, 0.15]);
  const px = (r() - 0.5) * 3, pz = r() < 0.5 ? -0.6 : 0.6;
  pallet(b, px, 0, pz, 1.2, 1.0, (r() - 0.5) * 0.3, true);
  b.pop();
  const c = b.point(0, 0);
  b.push(bay.x, bay.z, env.orient === 'x' ? 0 : HALF_PI);
  const p0 = b.point(px - 0.7, pz - 0.6), p1 = b.point(px + 0.7, pz + 0.6);
  b.pop();
  b.solid(Math.min(p0.x, p1.x), 0, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), 0.13, Math.max(p0.z, p1.z));
}
// 货架端框的斜撑：在立柱之间的竖直平面里，只画朝外（out = ±1）那一面 —— 朝里那面对着满架的货，永远看不见
function frameBraces(b, x, s, col, out) {
  const zb = s * 0.18, zf = s * 1.02;
  const pts = [[zb, 0.2], [zf, 1.1], [zb, 2.0], [zf, 2.9]];
  const strip = (a, c) => {
    const dz = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dz, dy) || 1;
    const nz = -dy / l * 0.018, ny = dz / l * 0.018;
    const xx = x + out * 0.022;
    facets(b, 'kit:prop', [[[xx, a[1] + ny, a[0] + nz], [xx, c[1] + ny, c[0] + nz], [xx, c[1] - ny, c[0] - nz], [xx, a[1] - ny, a[0] - nz]]], col, [x, (a[1] + c[1]) / 2, (a[0] + c[0]) / 2]);
  };
  for (let k = 0; k < 3; k++) strip(pts[k], pts[k + 1]);
  strip([zb, 0.2], [zf, 0.2]);
  strip([zb, 2.9], [zf, 2.9]);
}

// ---------- 落地堆垛 ----------
const STACK_KINDS = [['cartons', 0.3], ['wrap', 0.16], ['barrels', 0.12], ['crates', 0.14], ['sacks', 0.12], ['pallets', 0.1], ['bins', 0.06]];
function stackBay(b, bay, r, env, cap) {
  b.push(bay.x, bay.z, 0);
  const lots = [[-1.7, -1.6], [1.7, -1.6], [-1.7, 1.6], [1.7, 1.6]];
  lots.forEach(([lx, lz], q) => {
    const kind = U.weighted(r, env.st.crates ? [['crates', 0.45], ['cartons', 0.25], ['wrap', 0.1], ['barrels', 0.1], ['pallets', 0.1]] : STACK_KINDS);
    const rot = (r() - 0.5) * 0.1 + (r() < 0.5 ? 0 : HALF_PI);
    // 预算紧的时候后两个货位只剩一块空托盘（前两个永远摆货）
    const hgt = stackLot(b, lx, lz, rot, triCount(b) > cap ? 'pallets1' : kind, r, env);
    if (hgt > 0) b.solid(lx - 0.72, 0, lz - 0.72, lx + 0.72, hgt, lz + 0.72);
    // 地上的货位角标（黄色 L 形，两个对角）
    for (const c of [-1, 1]) {
      sheet(b, lx + c * 0.8, 0.005, lz + c * 0.72, 0.05, 0.25, 'up', [0.75, 0.6, 0.15]);
      sheet(b, lx + c * 0.72, 0.005, lz + c * 0.8, 0.25, 0.05, 'up', [0.75, 0.6, 0.15]);
    }
  });
  if (triCount(b) < cap) scatterDebris(b, r, 3, 3.2);
  b.pop();
}
// 一个堆垛位（1.2×1.0 托盘大小），返回高度（0 = 空）
function stackLot(b, x, z, rot, kind, r, env) {
  const k1 = r(), k2 = r(), k3 = r();
  b.push(x, z, rot);
  let top = 0;
  if (kind === 'cartons') {
    pallet(b, 0, 0, 0, 1.2, 1.0, 0, true);
    const rows = 2 + Math.floor(k1 * 3), h = rows * 0.42;
    cartonBlock(b, 0, 0.13, 0, 1.14, h, 0.96, 2, rows, 0, r, true);
    if (k2 < 0.5) cartonBlock(b, 0.2, 0.13 + h, -0.1, 0.55, 0.4, 0.45, 1, 1, 0.3, r);
    top = 0.13 + h + (k2 < 0.5 ? 0.4 : 0);
  } else if (kind === 'wrap') {
    pallet(b, 0, 0, 0, 1.2, 1.0, 0, true);
    const h = 1.0 + k1 * 0.8;
    wrapLoad(b, 0, 0.13, 0, 1.14, h, 0.96, 0);
    top = 0.13 + h;
  } else if (kind === 'barrels') {
    pallet(b, 0, 0, 0, 1.2, 1.0, 0, true);
    const col = C.drums[Math.floor(k1 * C.drums.length)];
    for (const [bx, bz] of [[-0.3, -0.24], [0.3, -0.24], [-0.3, 0.24], [0.3, 0.24]]) if (k2 > 0.25 || bx < 0 || bz < 0) barrel(b, bx, 0.13, bz, col);
    top = 1.05;
  } else if (kind === 'crates') {
    const cc = env.st.crates ? [0.45 + k1 * 0.35, 0.33 + k2 * 0.3, 0.18 + k3 * 0.22] : C.crate;
    crate(b, 0, 0, 0, 1.2, 0.8, 1.0, 0, cc);
    if (k1 < 0.7) crate(b, 0.05, 0.8, 0.02, 1.0, 0.7, 0.85, 0.1, cc);
    if (k1 < 0.3) crate(b, -0.1, 1.5, 0, 0.7, 0.55, 0.65, -0.2, cc);
    top = k1 < 0.3 ? 2.05 : k1 < 0.7 ? 1.5 : 0.8;
  } else if (kind === 'sacks') {
    pallet(b, 0, 0, 0, 1.2, 1.0, 0, true);
    const col = C.sacks[Math.floor(k1 * C.sacks.length)];
    let y = 0.13;
    const layers = 2 + Math.floor(k2 * 3);
    for (let l = 0; l < layers; l++) {
      const alt = l % 2 === 0;
      for (let q = 0; q < 2; q++) sack(b, alt ? (q - 0.5) * 0.56 : 0, y, alt ? 0 : (q - 0.5) * 0.48, alt ? 0.54 : 1.08, 0.2, alt ? 0.95 : 0.46, (k3 - 0.5) * 0.12, col);
      y += 0.17;
    }
    top = y;
  } else if (kind === 'pallets' || kind === 'pallets1') {
    const n = kind === 'pallets1' ? 1 : 3 + Math.floor(k1 * 6);
    for (let q = 0; q < n; q++) pallet(b, (frac(k2 * (q + 1) * 3.7) - 0.5) * 0.06, q * 0.13, 0, 1.2, 1.0, (frac(k3 * (q + 2) * 5.3) - 0.5) * 0.08, true);
    sheet(b, 0, n * 0.13 + 0.003, 0, 1.18, 0.98, 'up', mulc(C.pallet, 1.12));
    for (let q = 0; q < 4; q++) sheet(b, 0, n * 0.13 + 0.006, -0.36 + q * 0.24, 1.16, 0.02, 'up', C.palletGap);
    top = n * 0.13;
  } else if (kind === 'bins') {
    const col = C.totes[Math.floor(k1 * C.totes.length)];
    const hN = 2 + Math.floor(k2 * 3);
    for (const [bx, bz] of [[-0.3, -0.22], [0.3, -0.22], [-0.3, 0.22], [0.3, 0.22]]) {
      for (let q = 0; q < hN; q++) tote(b, bx, q * 0.36, bz, 0.56, 0.35, 0.4, col);
    }
    top = hN * 0.36;
  }
  b.pop();
  return top;
}

// 地上的零碎：木块、包装泡沫、金属残骸（依据：architecture「地板散落木头碎块、包装材料、金属残骸」）
function scatterDebris(b, r, n, span) {
  for (let q = 0; q < n; q++) {
    const x = (r() - 0.5) * 2 * span, z = (r() - 0.5) * 2 * span, k = r(), a = r() * Math.PI;
    if (k < 0.4) dbox(b, x, 0, z, 0.3 + r() * 0.3, 0.024, 0.08, [0.55, 0.42, 0.27], 'noBottom', null, a);   // 2.4 cm 厚：顶面不和路锥底座（3 cm）共面
    else if (k < 0.7) sack(b, x, 0, z, 0.25, 0.08, 0.2, a, [0.85, 0.85, 0.82]);
    else stick(b, [x, 0.02, z], [x + Math.cos(a) * 0.5, 0.02, z + Math.sin(a) * 0.5], 0.012, [0.38, 0.33, 0.3]);
  }
}
// 记下水坑的世界坐标，供 level.update 做「靠近未密封水坑」接触判定（hazards：爬菌经未密封液体传播）
function markPuddle(b, x, z) {
  const w = b.world(x, z);
  (b.data.puddles || (b.data.puddles = [])).push({ x: w.x, z: w.z });
}

// ---------- 空柱间 ----------
// core：空柱间里的地面出口（必摆）
function openBayExits(b, bay, r, env) {
  b.push(bay.x, bay.z, 0);
  const spots = bay.exits.length > 1 ? [[-1.6, -1.6], [1.8, 1.8]] : [[0, 0]];
  bay.exits.forEach((def, q) => placeFloorExit(b, def, spots[q][0], spots[q][1], [0, HALF_PI, Math.PI, -HALF_PI][Math.floor(bay.vroll * 4)], r, env));
  b.pop();
}
// fill：没有出口的空地上摆一样东西（车位线/地牛/空托盘垛/叉车），再加水坑、油渍、碎屑
function openBay(b, bay, r, env, cap) {
  b.push(bay.x, bay.z, 0);
  if (!bay.exits.length && triCount(b) < cap) {
    const k = r();
    if (env.sector === 'tianying' && k < 0.6) parkingLines(b, r);
    else if (k < 0.28) palletJack(b, (r() - 0.5) * 3, (r() - 0.5) * 3, r() * TAU);
    else if (k < 0.5) {
      const lx = (r() - 0.5) * 2.5, lz = (r() - 0.5) * 2.5;
      const hgt = stackLot(b, lx, lz, r() * 0.3, 'pallets', r, env);
      if (hgt > 0) b.solid(lx - 0.75, 0, lz - 0.75, lx + 0.75, hgt, lz + 0.75);
    }
    else if (k < 0.62) forklift(b, (r() - 0.5) * 2, (r() - 0.5) * 2, Math.floor(r() * 4) * HALF_PI + (r() - 0.5) * 0.3);
  }
  // 依据：weather「过道地面散布液体水坑」
  if (r() < (env.sector === 'tianying' ? 0.5 : 0.3)) {
    const px = (r() - 0.5) * 5, pz = (r() - 0.5) * 5;
    if (!bay.exits.length || Math.hypot(px, pz) > 2.2) { kitPuddle(b, px, pz, { rx: 0.9, rz: 0.55, y: 0.009 }); markPuddle(b, px, pz); }
  }
  // 油渍：外圈一层淡的渗开的油印（6 mm）+ 里面一块更黑的油心（7 mm），比地面暗才像湿的；水坑湿边在 8 mm，互相都错开。
  // 有出口的空柱间不画（出口自带地面细节：门前脚垫 7 mm、碎灰、泥土圈，免得和油心收在同一高度）
  {
    const ox = (r() - 0.5) * 5, oz = (r() - 0.5) * 5, orx = 0.5 + r() * 0.6, orz = 0.4 + r() * 0.4;
    if (!bay.exits.length) {
      blot(b, ox, oz, orx, orz, 9, [0.13, 0.128, 0.12], r);
      blot(b, ox + (r() - 0.5) * 0.2, oz + (r() - 0.5) * 0.2, orx * 0.55, orz * 0.55, 8, [0.07, 0.069, 0.066], r, 0.007);
    }
  }
  if (triCount(b) < cap) scatterDebris(b, r, 4, 3.4);
  b.pop();
}
// 天鹰段"更像停车场"：地上一排白色车位线 + 车轮挡（原文 wikidot 没有车辆，只留线）
function parkingLines(b, r) {
  const W = 2.5;
  for (let q = 0; q <= 3; q++) sheet(b, -3.75 + q * W, 0.004, -0.5, 0.1, 5, 'up', [0.82, 0.82, 0.78]);
  for (let q = 0; q < 3; q++) {
    const x = -2.5 + q * W;
    if (r() < 0.8) { dbox(b, x, 0, -2.6, 1.6, 0.12, 0.18, [0.62, 0.6, 0.56], 'noBottom', 'L1:wall'); b.solid(x - 0.8, 0, -2.69, x + 0.8, 0.12, -2.51); }
  }
}
// 手动液压搬运车（地牛）
function palletJack(b, x, z, rot) {
  b.push(x, z, rot);
  for (const s of [-0.28, 0.28]) dbox(b, s, 0.03, 0.2, 0.16, 0.05, 1.15, [0.75, 0.2, 0.12], 'noBottom');
  dbox(b, 0, 0.03, -0.45, 0.72, 0.2, 0.2, [0.75, 0.2, 0.12], 'noBottom');
  b.cylinder(0, 0.23, -0.45, 0.07, 0.25, 'kit:prop', { segments: 8, caps: false, color: C.steel, solid: false, uv: 'stretch' });
  stick(b, [0, 0.45, -0.45], [0, 1.15, -0.72], 0.02, C.dark);
  stick(b, [-0.15, 1.15, -0.72], [0.15, 1.15, -0.72], 0.02, C.dark);
  for (const s of [-1, 1]) b.cylinder(s * 0.2, 0.08, -0.45, 0.08, 0.05, 'kit:prop', { axis: 'x', segments: 8, color: C.dark, solid: false, uv: 'stretch' });
  b.pop();
  b.solid(x - 0.5, 0, z - 0.5, x + 0.5, 0.3, z + 0.5);
}
// 叉车（停着的，没人开）
function forklift(b, x, z, rot) {
  b.push(x, z, rot);
  const Y = [0.86, 0.66, 0.12];
  dbox(b, 0, 0.18, 0, 1.1, 0.75, 1.9, Y, 'noBottom');                  // 车身
  dbox(b, 0, 0.93, 0.62, 1.08, 0.28, 0.62, C.dark, 'noBottom');         // 配重
  dbox(b, 0, 0.93, -0.15, 0.5, 0.12, 0.5, C.dark, 'noBottom');          // 座椅
  dbox(b, 0, 1.05, 0.08, 0.5, 0.45, 0.08, C.dark, 'noBottom');          // 靠背
  for (const sx of [-0.48, 0.48]) for (const sz of [-0.75, 0.55]) stick(b, [sx, 0.93, sz], [sx, 2.1, sz * 0.9], 0.025, C.dark);   // 护顶架立柱
  dbox(b, 0, 2.1, -0.1, 1.0, 0.04, 1.3, C.dark, 'all');                  // 护顶
  for (const sx of [-0.3, 0.3]) dbox(b, sx, 0.05, -1.05, 0.08, 2.5, 0.08, C.dark, 'sides');   // 门架
  dbox(b, 0, 0.05, -1.05, 0.7, 0.1, 0.1, C.dark, 'noBottom');
  for (const sx of [-0.25, 0.25]) dbox(b, sx, 0.02, -1.6, 0.1, 0.04, 1.0, C.steel, 'noBottom');   // 货叉
  stick(b, [0, 1.0, -0.55], [0, 1.35, -0.62], 0.02, C.dark);                                        // 方向盘柱
  b.cylinder(0, 1.36, -0.62, 0.15, 0.03, 'kit:prop', { segments: 10, caps: false, color: C.dark, solid: false, uv: 'stretch' });
  for (const sx of [-0.56, 0.56]) for (const sz of [-0.6, 0.65]) b.cylinder(sx, 0.25, sz, 0.25, 0.2, 'kit:prop', { axis: 'x', segments: 10, color: C.dark, solid: false, uv: 'stretch' });
  b.pop();
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hx = 0.6 * c + 1.3 * s, hz = 0.6 * s + 1.3 * c;
  b.solid(x - hx, 0, z - hz, x + hx, 2.15, z + hz);
}

// ---------- 小屋（「小径」房间）----------
// 依据：architecture「小径：经单推或双推门进入（门上有时有出口标志）」；materials「洁白的混凝土墙」「门框有薄薄一层灰色涂层」；
// lighting「小径入口门上有亮着的绿色应急灯」「办公室仅悬一盏灯泡，许多侧室没有灯光」；
// landmarks 五种小径房间（办公室/砖墙小间/医务室/橡胶房间/画作房间）+ 储藏室（仓库里最常见的隔间）
const HUT_KINDS = [['office', 0.24], ['storage', 0.2], ['brick', 0.14], ['infirmary', 0.14], ['rubber', 0.12], ['painting', 0.16]];
function hutShell(b, bay, env, doorX, r) {
  const R = HUT_R, T = HUT_T, HH = HUT_H, K = 'L1:wall', W = C.hutWall;
  const DW = 1.16, DH = 2.13;
  b.box(0, 0, -R, 2 * R + T, HH, T, K, { faces: 'sides', color: W });
  b.box(-R, 0, 0, T, HH, 2 * R - T, K, { faces: 'sides', color: W });
  b.box(R, 0, 0, T, HH, 2 * R - T, K, { faces: 'sides', color: W });
  b.aabb(-R - T / 2, 0, R - T / 2, doorX - DW / 2, HH, R + T / 2, K, { faces: 'sides', color: W });
  b.aabb(doorX + DW / 2, 0, R - T / 2, R + T / 2, HH, R + T / 2, K, { faces: 'sides', color: W });
  b.aabb(doorX - DW / 2, DH, R - T / 2, doorX + DW / 2, HH, R + T / 2, K, { faces: ['ny', 'pz', 'nz'], color: W, solid: true });
  // 屋顶板（挑出 6 cm）+ 一圈压顶
  dbox(b, 0, HH, 0, 2 * R + T + 0.12, 0.16, 2 * R + T + 0.12, C.roof, 'all', K);
  // 外墙根一道灰色勒脚（贴在墙外 3 mm）
  for (const f of [0, 1, 2, 3]) {
    b.push(0, 0, f * HALF_PI);
    if (f !== 0) sheet(b, 0, 0, R + T / 2 + 0.003, 2 * R + T, 0.15, '+z', [0.62, 0.62, 0.6], K);
    else {
      const lw = doorX - DW / 2 + R + T / 2, rw = R + T / 2 - doorX - DW / 2;
      sheet(b, -R - T / 2 + lw / 2, 0, R + T / 2 + 0.003, lw, 0.15, '+z', [0.62, 0.62, 0.6], K);
      sheet(b, R + T / 2 - rw / 2, 0, R + T / 2 + 0.003, rw, 0.15, '+z', [0.62, 0.62, 0.6], K);
    }
    b.pop();
  }
  // 推杠防火门，半开着；门上亮绿色应急灯
  kitCall(b, KIT_EST.door, () => kit.prop.door(b, doorX, R, 0, { style: 'fire', color: 0x8d9296, frameColor: 0xa4a49e, open: 0.8, sign: true }));
  // 门边：开关盒 + 一根线管爬上屋顶
  const sx = doorX + (doorX > 0 ? -0.95 : 0.95);
  dbox(b, sx, 1.2, R + T / 2 + 0.02, 0.09, 0.13, 0.04, [0.85, 0.84, 0.8], 'noBottom');
  dbox(b, sx, 1.33, R + T / 2 + 0.012, 0.025, HH - 1.33, 0.025, [0.7, 0.7, 0.68], 'sides');
  // 灭火器（一半的小屋有）
  if (r() < 0.5) {
    const ex = doorX + (doorX > 0 ? -1.5 : 1.5), ez = R + T / 2 + 0.12;
    drum(b, ex, 0.12, ez, 0.08, 0.48, C.red, 8);
    stick(b, [ex, 0.6, ez], [ex + 0.06, 0.66, ez + 0.03], 0.015, C.dark);
    dbox(b, ex, 0.5, R + T / 2 + 0.01, 0.06, 0.22, 0.02, C.dark, 'noBottom');
  }
  // 屋顶上偶尔堆着东西（远处看得见）
  if (r() < 0.4) cartonBlock(b, (r() - 0.5) * 3, HH + 0.16, (r() - 0.5) * 3, 1.0, 0.5, 0.7, 2, 1, r() * 3, r);
  // 挂门位：北、东、西三面各两个（门那一面不挂）
  for (const p of [-1.6, 1.6]) {
    addSlot(b, env, bay, p, -R - T / 2, Math.PI, 'hut');
    addSlot(b, env, bay, R + T / 2, p, HALF_PI, 'hut');
    addSlot(b, env, bay, -R - T / 2, p, -HALF_PI, 'hut');
  }
  // 屋内矩形（区块坐标，轴对齐）：刷新点落在里面的标 safe
  const p0 = b.point(-R + 0.1, -R + 0.1), p1 = b.point(R - 0.1, R - 0.1);
  env.huts.push({ x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z) });
}
// 屋里吊着的一盏灯泡
function hutBulb(b, x, z, intensity, flicker) {
  const y = HUT_H - 0.45;
  dbox(b, x, y + 0.08, z, 0.012, HUT_H - y - 0.08, 0.012, C.rod, 'sides');
  dbox(b, x, y + 0.04, z, 0.05, 0.05, 0.05, C.dark, 'sides');
  const bulb = glowBox(b, x, y - 0.04, z, 0.07, 0.08, 0.07, [1.9, 1.6, 1.1]);
  const src = b.light({ x, z, y: y - 0.05, color: 0xffe2a8, intensity, range: 4.5, flicker: flicker || 0 });
  b.linkGlow(bulb, src, [1.9, 1.6, 1.1]);
}
function hutBay(b, bay, r, env) {
  b.push(bay.x, bay.z, bay.rot);
  const kind = bay.hutKind || U.weighted(r, HUT_KINDS);
  hutShell(b, bay, env, 0, r);
  const lit = kind === 'office' || r() < 0.55;   // 依据：「许多侧室没有灯光」
  if (lit) hutBulb(b, 0, -0.4, 0.55, r() < 0.2 ? 0.5 : 0);
  bay.hutKindFinal = kind;                       // 屋内陈设在 fill 那一遍按预算摆（buildBayFill）
  b.pop();
}
// 屋内（门在 +z，门扇往里开，扫过 x∈[−0.5, 0.5]、z∈[2.0, 3.0]，家具避开）
// 屋里的大件（kit 的桌椅柜床每件 120–260 面）逐件看预算：放不下就少摆一件，主件（办公桌/病床/层架）总在
function hutInterior(b, kind, r, env, cap) {
  const R = HUT_R - HUT_T / 2, K = 'L1:wall';
  const fits = n => triCount(b) + n <= cap;
  if (kind === 'office') {
    // 依据：landmarks「小型办公室（办公桌＋老旧电脑…一盏灯泡昏暗照明）」
    if (fits(KIT_EST.desk)) kitCall(b, KIT_EST.desk, () => kit.prop.desk(b, -1.2, -2.4, 0, { monitor: true, screen: 0x1a2a1a }));
    const chairRot = Math.PI + (r() - 0.5) * 0.6;
    if (fits(KIT_EST.chair)) kitCall(b, KIT_EST.chair, () => kit.prop.chair(b, -1.2, -1.55, chairRot, {}));
    if (fits(KIT_EST.cabinet)) kitCall(b, KIT_EST.cabinet, () => kit.prop.cabinet(b, 2.3, -2.62, 0, { kind: 'file' }));
    drum(b, 0.3, 0, -2.6, 0.16, 0.36, [0.3, 0.32, 0.34], 8);
    for (let q = 0; q < 4; q++) sheet(b, (r() - 0.5) * 3, 0.006 + q * 0.001, (r() - 0.5) * 2.5, 0.21, 0.3, 'up', [0.92, 0.91, 0.86], null, r() * 3);
    // 软木告示板 + 钉着的纸条
    dbox(b, 1.0, 1.2, -R + 0.015, 1.1, 0.75, 0.03, [0.55, 0.4, 0.25], 'noBottom');
    for (let q = 0; q < 4; q++) sheet(b, 0.62 + q * 0.25, 1.3 + (q % 2) * 0.28, -R + 0.034, 0.16, 0.2, '+z', [[0.95, 0.93, 0.7], [0.9, 0.9, 0.88], [0.8, 0.9, 0.95]][q % 3]);
    if (fits(170)) for (const s of [-1, 1]) windowBlinds(b, s * (R + HUT_T / 2), 0, s * HALF_PI, true);
  } else if (kind === 'storage') {
    if (fits(170)) shelfUnit(b, -R + 0.3, -0.6, HALF_PI, r);
    if (fits(170)) shelfUnit(b, R - 0.3, -0.6, -HALF_PI, r);
    drum(b, 1.2, 0, 2.3, 0.2, 0.32, [0.72, 0.6, 0.15], 8);   // 拖把桶
    stick(b, [1.2, 0.3, 2.3], [1.35, 1.5, 2.45], 0.015, [0.6, 0.5, 0.35]);
    cartonBlock(b, 0, 0, -2.4, 1.2, 0.8, 0.8, 2, 2, 0, r);
  } else if (kind === 'brick') {
    // 依据：landmarks「四周砖墙的狭小空间」；materials「房间有砖墙…床垫/沙发」
    const brick = [0.95, 0.52, 0.4], mortar = [1.15, 1.1, 1.0];
    for (const f of [1, 2, 3]) {
      b.push(0, 0, f * HALF_PI);
      sheet(b, 0, 0, R - 0.003, 2 * R, HUT_H, '-z', brick, K);
      for (let q = 1; q < 10; q++) sheet(b, 0, q * 0.29, R - 0.006, 2 * R, 0.02, '-z', mortar, K);
      b.pop();
    }
    sack(b, 1.3, 0, -1.8, 1.0, 0.16, 1.9, 0.1, [0.62, 0.6, 0.5]);   // 地上一张旧床垫
    blot(b, 1.4, -1.6, 0.25, 0.2, 6, [0.4, 0.33, 0.2], r, 0.17);
    const chairRot = r() * TAU;
    if (fits(KIT_EST.chair)) kitCall(b, KIT_EST.chair, () => kit.prop.chair(b, -1.4, -1.0, chairRot, { color: 0x4a3d2e }));
  } else if (kind === 'infirmary') {
    // 依据：landmarks「大型医务室（中间一张病床，周围几张桌子）」
    kitCall(b, KIT_EST.bed, () => kit.prop.bed(b, 0, -1.2, 0, { color: 0xb8c4c8 }));
    if (fits(KIT_EST.deskSmall)) kitCall(b, KIT_EST.deskSmall, () => kit.prop.desk(b, -2.3, -1.2, HALF_PI, { w: 1.1, d: 0.55 }));
    if (fits(KIT_EST.deskSmall)) kitCall(b, KIT_EST.deskSmall, () => kit.prop.desk(b, 2.3, -1.2, -HALF_PI, { w: 1.1, d: 0.55 }));
    // 输液架
    stick(b, [0.8, 0, -2.2], [0.8, 1.9, -2.2], 0.012, C.steel);
    for (let q = 0; q < 3; q++) { const a = q / 3 * TAU; stick(b, [0.8, 0.02, -2.2], [0.8 + Math.cos(a) * 0.25, 0.02, -2.2 + Math.sin(a) * 0.25], 0.012, C.steel); }
    stick(b, [0.65, 1.9, -2.2], [0.95, 1.9, -2.2], 0.01, C.steel);
    sack(b, 0.72, 1.62, -2.2, 0.1, 0.24, 0.06, 0, [0.9, 0.95, 0.95]);
    // 墙上药柜 + 红十字
    dbox(b, 0, 1.35, -R + 0.1, 0.7, 0.6, 0.2, [0.92, 0.92, 0.9], 'noBottom');
    sheet(b, 0, 1.6, -R + 0.203, 0.07, 0.22, '+z', C.red);
    sheet(b, 0, 1.675, -R + 0.206, 0.22, 0.07, '+z', C.red);
  } else if (kind === 'rubber') {
    // 依据：landmarks「橡胶房间，中间一把椅子，有时嵌入地板」；materials「橡胶软地面」
    // 软包：每面墙 4×2 块鼓起的垫子（只画朝屋里的面和四边）
    for (const f of [1, 2, 3]) {
      if (!fits(90)) break;
      b.push(0, 0, f * HALF_PI);
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 2; rr++) {
        dbox(b, -2.25 + c * 1.5, 0.05 + rr * 1.35, R - 0.05, 1.46, 1.31, 0.09, [0.86, 0.84, 0.76], ['nz', 'py', 'ny', 'px', 'nx']);
      }
      b.pop();
    }
    sheet(b, 0, 0.006, 0, 2 * R - 0.2, 2 * R - 0.2, 'up', [0.35, 0.33, 0.3]);
    b.push(0, 0, r() * TAU, -0.22);   // 椅子半截陷进地里
    if (fits(KIT_EST.chair)) kitCall(b, KIT_EST.chair, () => kit.prop.chair(b, 0, 0, 0, { color: 0x3a3a3a, solid: false }));
    b.pop();
    b.solid(-0.3, 0, -0.3, 0.3, 0.6, 0.3);
  } else if (kind === 'painting') {
    // 依据：landmarks「宽敞房间，墙上和地板上有画作」（地上的画不被注视时消失——注视机制没做）
    for (const [px, f] of [[-1.3, 2], [1.2, 2], [0, 1], [0.2, 3]]) {
      b.push(0, 0, f * HALF_PI);
      canvas(b, px, 1.1, -(R - 0.02), 0.8 + r() * 0.4, 0.6 + r() * 0.4, r);
      b.pop();
    }
    // 地上两幅画：可能叠在一起，第二幅整体垫高 8 mm（画框顶和画布都不和第一幅共面）
    for (let q = 0; q < 2; q++) {
      const px = (r() - 0.5) * 3, pz = -0.5 + (r() - 0.5) * 2, ft = 0.025 + q * 0.008, ang = r() * 3;
      dbox(b, px, 0, pz, 0.9, ft, 0.7, [0.4, 0.3, 0.2], 'noBottom', null, ang);
      sheet(b, px, ft + 0.003, pz, 0.78, 0.58, 'up', [0.3 + r() * 0.5, 0.3 + r() * 0.5, 0.3 + r() * 0.5], null, ang);   // 画布跟画框一起转
    }
  }
}
// 画框 + 画布上几块色块（抽象画）。在当前坐标系里画布朝 +z，(x, y, z) 是画的底边中点
function canvas(b, x, y, z, w, h, r) {
  dbox(b, x, y - 0.04, z, w + 0.08, h + 0.08, 0.03, [0.35, 0.25, 0.15], 'noBottom');
  sheet(b, x, y, z + 0.018, w, h, '+z', [0.8 + r() * 0.2, 0.78 + r() * 0.15, 0.7]);
  for (let q = 0; q < 3; q++) {
    const cw = w * (0.2 + r() * 0.4), ch = h * (0.2 + r() * 0.4);
    sheet(b, x + (r() - 0.5) * (w - cw), y + r() * (h - ch), z + 0.021 + q * 0.001, cw, ch, '+z', [r(), r() * 0.8, r() * 0.7]);
  }
}
// 窗 + 百叶：墙外、墙内各一套（窗不透光，百叶半放）。(x, z) 墙中线上的点，rot 朝外
function windowBlinds(b, x, z, rot, both) {
  b.push(x, z, rot);
  for (const s of both ? [1, -1] : [1]) {
    b.push(0, 0, s > 0 ? 0 : Math.PI);
    const zf = HUT_T / 2;
    dbox(b, 0, 0.95, zf, 1.3, 0.05, 0.06, [0.8, 0.8, 0.78], ['py', 'pz', 'px', 'nx']);
    dbox(b, 0, 2.05, zf, 1.3, 0.05, 0.04, [0.8, 0.8, 0.78], ['ny', 'pz', 'px', 'nx']);
    for (const sx of [-1, 1]) dbox(b, sx * 0.63, 1.0, zf, 0.04, 1.05, 0.04, [0.8, 0.8, 0.78], ['pz', 'px', 'nx']);
    sheet(b, 0, 1.0, zf + 0.003, 1.22, 1.05, '+z', [0.1, 0.13, 0.15]);
    for (let q = 0; q < 6; q++) sheet(b, 0, 1.97 - q * 0.1, zf + 0.008, 1.2, 0.07, '+z', [0.78, 0.77, 0.72]);
    b.pop();
  }
  b.pop();
}
// 储藏室的金属层架：四根立柱 + 四层板 + 板上的盒子
function shelfUnit(b, x, z, rot, r) {
  b.push(x, z, rot);
  const W = 1.9, D = 0.45, Hh = 2.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) dbox(b, sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02), 0.035, Hh, 0.035, [0.6, 0.62, 0.64], 'sides');
  for (let q = 0; q < 4; q++) {
    const y = 0.12 + q * 0.6;
    dbox(b, 0, y, 0, W, 0.025, D, [0.66, 0.68, 0.7], ['py', 'ny', 'pz']);
    if (q < 3 || r() < 0.5) {
      // 每格 2–3 件，宽度不超过格距（相邻两件同深度，一重叠正面就共面闪烁）
      const n = 2 + Math.floor(r() * 2), pitch = (W - 0.3) / n;
      for (let k = 0; k < n; k++) {
        const bw = Math.min(0.3 + r() * 0.25, pitch - 0.06), bx = -W / 2 + 0.15 + (k + 0.5) * pitch;
        if (r() < 0.5) tote(b, bx, y + 0.025, 0, bw, 0.25, 0.36, C.totes[Math.floor(r() * 4)]);
        else cartonBlock(b, bx, y + 0.025, 0, bw, 0.28, 0.36, 1, 1, 0, r);
      }
    }
  }
  b.pop();
  b.solid(x - 0.4, 0, z - 1.0, x + 0.4, Hh, z + 1.0);
}

// ---------- 承重墙段 ----------
// 柱线上两根柱子之间砌满一道混凝土墙（顶到梁底），像停车场里的剪力墙；两面都能挂门，中间那段可以是切出墙
function wallBay(b, bay, r, env) {
  b.push(bay.x, bay.z, bay.rot);   // 墙在本地 z = −4，x 从 −4 到 4（两端伸进柱身）
  const K = 'L1:wall', T = WALL_T, z0 = -4;
  const col = mulc(env.st.concrete, 0.96 + r() * 0.08);
  const nc = bay.noclip;
  if (nc) {
    b.aabb(-4, 0, z0 - T / 2, -0.8, WALL_H, z0 + T / 2, K, { faces: 'sides', color: col });
    b.aabb(0.8, 0, z0 - T / 2, 4, WALL_H, z0 + T / 2, K, { faces: 'sides', color: col });
    // 切出墙：一段没有碰撞体、会轻微错位闪烁的墙（kit noclip），两侧各留 5 cm 的黑缝
    kit.exit(b, { to: nc.to, kind: 'noclip', x: 0, z: z0, rot: 0, w: 1.5, h: WALL_H, thickness: T, matKey: K, color: col, label: nc.label });
    if (nc.look === 'outside') {
      // 依据：exits[12]「墙上呈现外部环境的缺口」——切出墙旁边的墙面上裂开一道透出天光的口子（两面都有）
      for (const s of [1, -1]) {
        const zf = z0 + s * (T / 2 + 0.007);   // 墙裙 4 mm、水渍 5 mm 之上，不共面
        const pts = [[1.0, 0.9], [1.25, 1.35], [1.12, 1.8], [1.4, 2.3], [1.2, 2.6], [1.05, 2.1], [0.92, 1.6]];
        facets(b, 'kit:glow', [pts.map(p => [p[0], p[1], zf])], [1.25, 1.45, 1.7], [1.1, 1.7, z0]);
      }
    }
  } else {
    b.aabb(-4, 0, z0 - T / 2, 4, WALL_H, z0 + T / 2, K, { faces: 'sides', color: col });
  }
  // 两面：下段刷一道灰漆墙裙、对拉螺栓孔、水渍
  for (const s of [1, -1]) {
    b.push(0, z0, s > 0 ? 0 : Math.PI);
    const zf = T / 2 + 0.004;
    if (!nc) sheet(b, 0, 0, zf, 7.2, 1.2, '+z', mulc(col, 1.15), K);
    else for (const sx of [-1, 1]) sheet(b, sx * 2.35, 0, zf, 2.9, 1.2, '+z', mulc(col, 1.15), K);
    for (let q = 0; q < 4; q++) for (let rr = 0; rr < 2; rr++) {
      const hx = -2.7 + q * 1.8;
      if (nc && Math.abs(hx) < 1.0) continue;
      sheet(b, hx, 1.6 + rr * 1.1, zf + 0.004, 0.05, 0.05, '+z', [0.3, 0.3, 0.29], K);   // 比水渍（+1 mm）再高 3 mm，免得叠在一起闪
    }
    const u = (r() - 0.5) * 5;
    if (!nc || Math.abs(u) > 1.2) facets(b, K, [[[u - 0.2, WALL_H, zf + 0.001], [u - 0.05, 1.5 + r(), zf + 0.001], [u + 0.07, 1.5 + r(), zf + 0.001], [u + 0.2, WALL_H, zf + 0.001]]], mulc(col, 0.6), [u, 2, 0]);
    b.pop();
  }
  // 挂门位：两面各两个（x = ±2.35，离切出段和柱子都够远）
  for (const p of [-2.35, 2.35]) {
    addSlot(b, env, bay, p, z0 - T / 2, Math.PI, 'wall');
    addSlot(b, env, bay, p, z0 + T / 2, 0, 'wall');
  }
  b.pop();
}
// 柱间另一半：靠远处摆一堆货（离墙 ≥ 3 m，墙面前留空给门）
function wallBayFill(b, bay, r, env, cap) {
  b.push(bay.x, bay.z, bay.rot);
  if (r() < 0.6 && triCount(b) < cap) {
    const lx = (r() - 0.5) * 3, lz = 1.8;
    const hgt = stackLot(b, lx, lz, (r() - 0.5) * 0.2, U.weighted(r, STACK_KINDS), r, env);
    if (hgt > 0) b.solid(lx - 0.72, 0, lz - 0.72, lx + 0.72, hgt, lz + 0.72);
  }
  if (triCount(b) < cap) scatterDebris(b, r, 3, 3);
  b.pop();
}
// 没被出口占用的墙面挂门位：随机挂配电柜 / 消火栓箱 / 告示（依据：other「用地标锁定法导航（…配电柜、板条箱）」）
function decorateFreeSlots(b, env) {
  const r = U.rng(b.seed, b.cx, b.cz, 'L1-slotdeco');
  for (const s of env.slots) {
    const k = r();
    if (s.used || k > 0.45 || triCount(b) > TRI_BUDGET - 80) continue;
    b.push(s.x, s.z, s.rot);
    if (k < 0.2) {
      // 配电柜：柜体 + 门缝 + 黄色警示三角 + 两根线管上顶
      dbox(b, 0, 0.9, 0.16, 0.8, 1.2, 0.3, [0.58, 0.6, 0.6], 'noBottom');
      sheet(b, 0, 0.94, 0.313, 0.012, 1.12, '+z', [0.2, 0.2, 0.2]);
      facets(b, 'kit:prop', [[[-0.3, 1.75, 0.315], [-0.14, 1.75, 0.315], [-0.22, 1.9, 0.315]]], C.yellow, [-0.22, 1.8, 0]);
      dbox(b, 0.28, 1.35, 0.33, 0.03, 0.12, 0.03, C.dark, 'all');
      for (const px of [-0.2, 0.2]) dbox(b, px, 2.1, 0.06, 0.05, (s.host === 'hut' ? HUT_H : WALL_H) - 2.1, 0.05, [0.62, 0.62, 0.6], 'sides');
      b.solid(-0.4, 0, 0, 0.4, 2.1, 0.32);
    } else if (k < 0.33) {
      // 消火栓箱：红框 + 玻璃窗里的水带卷
      dbox(b, 0, 0.8, 0.1, 0.7, 0.9, 0.2, C.red, 'noBottom');
      sheet(b, 0, 0.88, 0.203, 0.56, 0.74, '+z', [0.14, 0.16, 0.17]);
      b.cylinder(0, 1.25, 0.12, 0.2, 0.06, 'kit:prop', { axis: 'z', segments: 10, color: [0.75, 0.7, 0.55], solid: false, uv: 'stretch' });
    } else {
      // 旧告示：一张褪色的纸 + 一张歪掉的
      sheet(b, -0.2, 1.4, 0.004, 0.42, 0.55, '+z', [0.88, 0.86, 0.76]);
      sheet(b, 0.35, 1.2, 0.006, 0.3, 0.4, '+z', [0.8, 0.85, 0.9], null, 0.15);
    }
    b.pop();
  }
}

// ---------- Level 2 走廊口 ----------
// 依据：exits[0]「沿管道与仪表盘逐渐显现的方向走足够远」；目的地 Level 2 按用户 2026-09-23 的样子：
// 淡黄色墙壁、一条笔直的走廊、右手边各种各样的管道、黄色工业灯 —— 这里是那条走廊的入口，走进去就到
function portalBay(b, bay, r, env) {
  b.push(bay.x, bay.z, bay.rot);   // 开口朝本地 +z，走进去是往 −z
  const K = 'L1:wall', W = 2.3, T = 0.25, HH = 2.8, Z1 = 3.2, Z0 = -3.2;
  const outer = mulc(env.st.concrete, 0.95), paleY = [1.38, 1.24, 0.82];
  for (const s of [-1, 1]) {
    b.aabb(s > 0 ? W / 2 : -W / 2 - T, 0, Z0, s > 0 ? W / 2 + T : -W / 2, HH + 0.25, Z1, K, { faces: 'sides', color: outer });
    // 里面刷淡黄色（贴在墙内 3 mm）
    sheet(b, s * (W / 2 - 0.003), 0, (Z0 + Z1) / 2, Z1 - Z0, HH, s > 0 ? '-x' : '+x', paleY, K);
  }
  dbox(b, 0, HH, (Z0 + Z1) / 2, W + 2 * T + 0.1, 0.25, Z1 - Z0 + 0.1, outer, 'all', K);
  sheet(b, 0, HH - 0.003, (Z0 + Z1) / 2, W, Z1 - Z0, 'down', mulc(paleY, 0.9), K);
  sheet(b, 0, 0.004, (Z0 + Z1) / 2 + 0.3, W, Z1 - Z0 - 0.6, 'up', [1.35, 1.3, 1.15], 'L1:floor');
  // 走廊深处一片漆黑（像还能一直走下去）
  sheet(b, 0, 0, Z0 + 0.3, W, HH, '+z', [0.01, 0.01, 0.008], 'kit:glow');
  // 右手边（本地 +x 墙）一排管道：粗细、颜色各不相同，带托架、法兰、阀门、两块表
  const pipes = [[0.45, 0.07, C.pipes[1]], [0.85, 0.05, C.pipes[5]], [1.35, 0.09, C.pipes[0]], [1.8, 0.04, C.pipes[4]], [2.35, 0.06, C.pipes[2]]];
  pipes.forEach(([py, pr, pc], q) => {
    const px = W / 2 - 0.1 - pr - (q % 2) * 0.08;
    b.cylinder(px, py, (Z0 + Z1) / 2 + 0.25, pr, Z1 - Z0 + 0.5, 'kit:prop', { axis: 'z', segments: 8, caps: false, color: pc, solid: false, uv: 'stretch' });
    for (const fz of [2.4, -0.6]) b.cylinder(px, py, fz, pr * 1.45, 0.05, 'kit:prop', { axis: 'z', segments: 8, caps: false, color: mulc(pc, 0.7), solid: false, uv: 'stretch' });
  });
  for (const bz of [2.8, 1.2, -0.4, -2.0]) dbox(b, W / 2 - 0.1, 0.3, bz, 0.2, 2.2, 0.04, C.steel, ['nx', 'pz', 'nz']);
  b.cylinder(W / 2 - 0.35, 1.35, 1.5, 0.13, 0.03, 'kit:prop', { axis: 'x', segments: 8, color: C.red, solid: false, uv: 'stretch' });
  b.push(W / 2 - 0.15, 0.3, -HALF_PI);
  gauge(b, 0, 1.25, 0.05);
  b.pop();
  // 黄色工业灯：左墙上一盏笼罩灯
  const lampZ = 0.3;
  dbox(b, -W / 2 + 0.06, 2.2, lampZ, 0.12, 0.08, 0.12, C.dark, 'all');
  const bulb = glowBox(b, -W / 2 + 0.16, 2.08, lampZ, 0.1, 0.13, 0.1, [2.0, 1.55, 0.5]);
  for (const s of [-1, 1]) stick(b, [-W / 2 + 0.06, 2.21, lampZ + s * 0.07], [-W / 2 + 0.22, 2.06, lampZ + s * 0.07], 0.006, C.dark);
  const src = b.light({ x: -W / 2 + 0.3, z: lampZ, y: 2.0, color: 0xffc050, intensity: 0.9, range: 5, flicker: 0 });
  b.linkGlow(bulb, src, [2.0, 1.55, 0.5]);
  // 入口：门楣上一道黄黑警示带；外面两根管子从楼板上下来钻进走廊顶，管上两块压力表
  for (let q = 0; q < 8; q++) sheet(b, -W / 2 - T + (q + 0.5) * (W + 2 * T) / 8, HH + 0.02, Z1 + 0.054, (W + 2 * T) / 8, 0.2, '+z', q % 2 ? C.black : C.yellow);
  for (const [px, pc] of [[-0.6, C.pipes[1]], [0.7, C.pipes[5]]]) {
    b.cylinder(px, HH + 0.25, Z1 - 0.5, 0.07, H - HH - 0.25, 'kit:prop', { segments: 8, caps: false, color: pc, solid: false, uv: 'stretch' });
    b.push(px, Z1 - 0.43, 0);
    gauge(b, 0, 3.5, 0.07);
    b.pop();
  }
  kit.exit(b, { to: '2', kind: 'zone', x: 0, z: -1.6, radius: 1.0, marker: true, label: bay.exits[0] ? bay.exits[0].label : '' });
  b.pop();
}

// ---------- Level 38 的「小径」----------
// 推门进去，里面一道隔墙折成 U 形窄道；三盏灯越往里闪得越厉害，尽头就是出口
function passageBay(b, bay, r, env) {
  b.push(bay.x, bay.z, bay.rot);
  hutShell(b, bay, env, -1.55, r);
  b.aabb(-0.1, 0, -1.55, 0.1, HUT_H, HUT_R - HUT_T / 2, 'L1:wall', { faces: 'sides', color: C.hutWall });
  hutBulb(b, -1.55, 0.6, 0.5, 0.25);
  hutBulb(b, 0, -2.3, 0.45, 0.6);
  hutBulb(b, 1.55, 1.2, 0.4, 0.95);
  // 墙上的裂纹（越往里越多）
  const cr = (x, z, rot, y, n) => {
    b.push(x, z, rot);
    for (let q = 0; q < n; q++) {
      const u = (r() - 0.5) * 1.6, v = y + r() * 1.2;
      facets(b, 'kit:prop', [[[u, v, 0.004], [u + 0.02, v, 0.004], [u + 0.25 * (r() - 0.3), v + 0.5, 0.004], [u + 0.25 * (r() - 0.3) - 0.015, v + 0.5, 0.004]]], [0.25, 0.25, 0.24], [u, v, -1]);
    }
    b.pop();
  };
  cr(-1.55, -(HUT_R - HUT_T / 2), 0, 0.6, 2);
  cr(0.1, 0.5, HALF_PI, 0.4, 3);
  cr(1.55, HUT_R - HUT_T / 2, Math.PI, 0.3, 5);
  kit.exit(b, { to: '38', kind: 'zone', x: 1.55, z: 2.15, radius: 0.85, marker: true, label: bay.exits[0] ? bay.exits[0].label : '' });
  b.pop();
}

// ---------- 衔尾段施工区 ----------
// 依据：landmarks「衔尾段：永无止境的施工状态；外观如影子的生物漫无目的修补建筑」
function buildSiteBay(b, bay, r, env) {
  b.push(bay.x, bay.z, 0);
  // 脚手架：四根立杆 + 两层横杆 + 脚手板 + 一道斜撑
  const sx = -1.2, sz = -1.0, W = 2.2, D = 1.1;
  for (const px of [0, W]) for (const pz of [0, D]) stick(b, [sx + px, 0, sz + pz], [sx + px, 2.9, sz + pz], 0.025, [0.55, 0.57, 0.58]);
  for (const y of [1.2, 2.4]) {
    for (const pz of [0, D]) stick(b, [sx, y, sz + pz], [sx + W, y, sz + pz], 0.02, [0.55, 0.57, 0.58]);
    dbox(b, sx + W / 2, y + 0.02, sz + D / 2, W, 0.04, D - 0.1, [0.62, 0.5, 0.3], 'all');
  }
  stick(b, [sx, 0.1, sz + D], [sx + W, 2.3, sz + D], 0.018, [0.55, 0.57, 0.58]);
  b.solid(sx - 0.05, 0, sz - 0.05, sx + W + 0.05, 2.9, sz + D + 0.05);
  // 砂堆 + 水泥袋 + 半截砖墙 + 路锥
  b.cylinder(1.9, 0, 1.9, 0.9, 0.55, 'kit:prop', { rTop: 0.08, segments: 9, caps: false, color: [0.72, 0.62, 0.45], solid: false, uv: 'stretch' });
  b.solid(1.3, 0, 1.3, 2.5, 0.4, 2.5);
  for (let q = 0; q < 5; q++) sack(b, -2.2 + (q % 3) * 0.5, Math.floor(q / 3) * 0.14, 2.0, 0.48, 0.16, 0.34, (r() - 0.5) * 0.3, [0.6, 0.6, 0.58]);
  b.solid(-2.5, 0, 1.8, -0.9, 0.3, 2.2);
  const wallH = [0.9, 1.1, 0.7, 1.3, 0.5];
  for (let q = 0; q < 5; q++) dbox(b, 0.2 + q * 0.4, 0, -2.6, 0.4, wallH[q] + r() * 0.2, 0.22, [1.0, 0.55, 0.42], 'noBottom', 'L1:wall');
  b.solid(0, 0, -2.72, 2.2, 1.3, -2.48);
  for (let q = 0; q < 3; q++) {
    const cx = -2.8 + q * 0.9, cz = -2.8;
    b.cylinder(cx, 0.03, cz, 0.16, 0.6, 'kit:prop', { rTop: 0.025, segments: 7, caps: false, color: [0.95, 0.4, 0.1], solid: false, uv: 'stretch' });
    b.cylinder(cx, 0.3, cz, 0.105, 0.1, 'kit:prop', { rTop: 0.09, segments: 7, caps: false, color: [0.95, 0.95, 0.9], solid: false, uv: 'stretch' });
    dbox(b, cx, 0, cz, 0.38, 0.03, 0.38, [0.2, 0.2, 0.2], 'noBottom');
  }
  scatterDebris(b, r, 6, 3.2);
  b.pop();
}

// ---------- 花园段绿植 ----------
// 依据：colors「花园段青翠欲滴的色调」；landmarks「植被繁生」——混凝土地面裂开，长出灌木，梁上挂下藤蔓
function groveBay(b, bay, r, env) {
  b.push(bay.x, bay.z, 0);
  for (let q = 0; q < 5; q++) {
    const x = (r() - 0.5) * 5, z = (r() - 0.5) * 5, rr = 0.35 + r() * 0.45;
    blot(b, x, z, rr * 1.5, rr * 1.3, 7, C.soil, r);
    const g = new THREE.IcosahedronGeometry(rr, 0);
    g.scale(1, 0.75 + r() * 0.4, 1);
    b.mesh(g, 'kit:prop', { x, y: rr * 0.55, z, color: mulc(C.leaf, 0.8 + r() * 0.5), uv: 'stretch' });
    g.dispose();
    b.solid(x - rr * 0.7, 0, z - rr * 0.7, x + rr * 0.7, rr * 1.2, z + rr * 0.7);
  }
  for (let q = 0; q < 6; q++) blot(b, (r() - 0.5) * 6, (r() - 0.5) * 6, 0.4 + r() * 0.6, 0.3 + r() * 0.5, 6, [0.22, 0.34, 0.16], r, 0.0075);
  b.pop();
}

// ---------- 地面出口（空柱间里）----------
function placeFloorExit(b, def, x, z, rot, r, env) {
  switch (def.look) {
    case 'ceilingHole': ceilingHole(b, x, z, rot, def, r); break;
    case 'duct': ductExit(b, x, z, rot, def, r); break;
    case 'tv': tvExit(b, x, z, rot, def, r); break;
    case 'tree': treeExit(b, x, z, rot, def, r); break;
    case 'cairn': cairnExit(b, x, z, rot, def, r); break;
    case 'scrap': scrapExit(b, x, z, rot, def, r); break;
    case 'root2': root2Exit(b, x, z, rot, def, r); break;
    case 'freeDoor': freeDoorExit(b, x, z, rot, def, r); break;
    case 'funCeiling':
      funCeilingPatch(b, x, z);
      kit.exit(b, { to: def.to, kind: 'zone', x, z, radius: 1.2, marker: { color: [1.4, 0.4, 1.25] }, label: def.label, tag: def.tag });
      break;
  }
}
// hole 类出口：kit 的地面坑实物藏掉，只留触发圈（实物是层级自己搭的）
// 坑本来就藏掉：detail: false 让 kit 走简版（不白算高画质的坑沿/碎石，面数也不随画质变）
function holeExit(b, def, x, z, radius) {
  const h = kit.exit(b, { to: def.to, kind: 'hole', x, z, hole: { r: 0.4, detail: false }, radius, label: def.label });
  if (h && h.parts) { if (h.parts.disc) h.parts.disc.setVisible(false); if (h.parts.rim) h.parts.rim.setVisible(false); }
  return h;
}
function ceilingHole(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  const R = 0.65, n = 14, rad = [];
  for (let k = 0; k < n; k++) rad.push(0.82 + 0.3 * r());
  const ring = (s, y) => { const p = []; for (let k = 0; k < n; k++) { const a = k / n * TAU; p.push([Math.cos(a) * R * rad[k] * s, y, Math.sin(a) * R * rad[k] * s]); } return p; };
  facets(b, 'kit:glow', [ring(1, H - 0.006)], [0.012, 0.012, 0.014], [0, H + 1, 0]);
  const inner = ring(0.96, H - 0.003), outer = ring(1.32, H - 0.003), quads = [];
  for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; quads.push([inner[k], inner[k2], outer[k2], outer[k]]); }
  facets(b, 'kit:prop', quads, [0.36, 0.35, 0.33], [0, H + 1, 0]);
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.4; stick(b, [Math.cos(a) * R * 0.95, H - 0.01, Math.sin(a) * R * 0.95], [Math.cos(a) * R * 0.7, H - 0.3 - 0.1 * k, Math.sin(a) * R * 0.7], 0.008, [0.4, 0.26, 0.18]); }
  // 竖梯：两根扶手 + 踏棍，顶端伸进洞里
  const lz = -R * 0.55;
  for (const s of [-0.22, 0.22]) dbox(b, s, 0, lz, 0.05, H - 0.01, 0.05, [0.45, 0.47, 0.5], 'sides');
  for (let y = 0.3; y < H - 0.1; y += 0.3) dbox(b, 0, y, lz, 0.44, 0.03, 0.03, [0.52, 0.54, 0.56], ['py', 'ny', 'pz', 'nz']);
  b.solid(-0.25, 0, lz - 0.04, 0.25, H, lz + 0.04);
  // 洞下一小堆掉下来的碎混凝土和灰
  blot(b, 0.4, 0.3, 0.7, 0.5, 8, [0.55, 0.54, 0.5], r);
  for (let q = 0; q < 6; q++) dbox(b, 0.2 + r() * 0.6, 0, 0.1 + r() * 0.5, 0.08 + r() * 0.12, 0.05 + r() * 0.08, 0.08 + r() * 0.1, [0.62, 0.61, 0.58], 'noBottom', 'L1:wall', r() * 3);
  holeExit(b, def, 0, lz + 0.6, 0.85);
  b.pop();
}
function ductExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  const W = 0.9, D = 0.9, y0 = 0.12, ow = 0.66, oy0 = 0.2, oy1 = 0.8, G = C.galv;
  dbox(b, 0, y0, 0, W, H - y0, D, G, ['px', 'nx', 'nz']);
  sheet(b, -(W / 2 + ow / 2) / 2, y0, D / 2, W / 2 - ow / 2, H - y0, '+z', G);
  sheet(b, (W / 2 + ow / 2) / 2, y0, D / 2, W / 2 - ow / 2, H - y0, '+z', G);
  sheet(b, 0, oy1, D / 2, ow, H - oy1, '+z', G);
  sheet(b, 0, y0, D / 2, ow, oy0 - y0, '+z', G);
  sheet(b, 0, oy0, D / 2 - 0.25, ow, oy1 - oy0, '+z', [0.01, 0.01, 0.01], 'kit:glow');   // 管口里一片黑
  for (let y = 1.0; y < H - 0.2; y += 1.0) dbox(b, 0, y, 0, W + 0.024, 0.04, D + 0.024, mulc(G, 0.85), 'sides');
  dbox(b, 0, oy1, D / 2 + 0.02, ow + 0.06, 0.03, 0.04, mulc(G, 0.8), 'all');                 // 口沿
  dbox(b, 0, 0, 0, W + 0.1, y0, D + 0.1, C.steel, 'noBottom');                                 // 底座
  dbox(b, 0, H - 0.45, -D / 2 - 1.5, W, 0.4, 3.0, G, ['px', 'nx', 'ny', 'nz']);               // 顶上接一段横风管
  // 拆下来的格栅扔在地上，旁边两颗螺丝
  b.push(0.75, D / 2 + 0.45, 0.5);
  dbox(b, 0, 0, 0, 0.7, 0.02, 0.62, mulc(G, 0.9), 'noBottom');
  for (let q = 0; q < 6; q++) sheet(b, 0, 0.022, -0.25 + q * 0.1, 0.62, 0.035, 'up', C.dark);
  b.pop();
  for (let q = 0; q < 2; q++) dbox(b, 0.5 + q * 0.2, 0, D / 2 + 0.9, 0.02, 0.015, 0.02, C.steel, 'noBottom');
  b.solid(-W / 2 - 0.05, 0, -D / 2 - 0.05, W / 2 + 0.05, H, D / 2 + 0.05);
  holeExit(b, def, 0, D / 2 + 0.5, 0.8);
  b.pop();
}
function tvExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  const wood = [0.42, 0.3, 0.19];
  dbox(b, 0, 0, 0, 1.1, 0.5, 0.45, wood, 'noBottom');
  sheet(b, 0, 0.04, 0.228, 0.012, 0.42, '+z', mulc(wood, 0.5));
  for (const s of [-0.1, 0.1]) dbox(b, s, 0.3, 0.23, 0.03, 0.03, 0.02, [0.7, 0.6, 0.35], 'all');
  // 录像机 + 绿色数码管
  dbox(b, 0, 0.5, 0.02, 0.44, 0.09, 0.32, C.dark, 'noBottom');
  sheet(b, 0.1, 0.53, 0.183, 0.1, 0.025, '+z', [0.3, 1.5, 0.5], 'kit:glow');
  sheet(b, -0.1, 0.52, 0.183, 0.16, 0.03, '+z', [0.02, 0.02, 0.02], 'kit:glow');
  // CRT：机身 + 后面收窄的屁股 + 屏幕（雪花闪）+ 旋钮 + 天线
  const ty = 0.59;
  dbox(b, 0, ty, 0.02, 0.64, 0.5, 0.42, [0.3, 0.29, 0.27], 'noBottom');
  facets(b, 'kit:prop', [
    [[-0.3, ty + 0.03, -0.19], [0.3, ty + 0.03, -0.19], [0.18, ty + 0.1, -0.45], [-0.18, ty + 0.1, -0.45]],
    [[0.3, ty + 0.47, -0.19], [-0.3, ty + 0.47, -0.19], [-0.18, ty + 0.4, -0.45], [0.18, ty + 0.4, -0.45]],
    [[0.3, ty + 0.03, -0.19], [0.3, ty + 0.47, -0.19], [0.18, ty + 0.4, -0.45], [0.18, ty + 0.1, -0.45]],
    [[-0.3, ty + 0.47, -0.19], [-0.3, ty + 0.03, -0.19], [-0.18, ty + 0.1, -0.45], [-0.18, ty + 0.4, -0.45]],
    [[-0.18, ty + 0.1, -0.45], [0.18, ty + 0.1, -0.45], [0.18, ty + 0.4, -0.45], [-0.18, ty + 0.4, -0.45]],
  ], [0.27, 0.26, 0.24], [0, ty + 0.25, -0.2]);
  const screen = sheet(b, -0.06, ty + 0.07, 0.233, 0.44, 0.35, '+z', [0.55, 0.62, 0.7], 'kit:glow');
  for (let q = 0; q < 2; q++) b.cylinder(0.24, ty + 0.3 - q * 0.12, 0.25, 0.025, 0.03, 'kit:prop', { axis: 'z', segments: 6, color: C.dark, solid: false, uv: 'stretch' });
  for (const s of [-1, 1]) stick(b, [0.05 * s, ty + 0.5, -0.05], [0.3 * s, ty + 1.0, -0.12], 0.006, [0.7, 0.7, 0.72]);
  // 标着 Mach+ 的录像带
  dbox(b, 0.38, 0.5, 0.1, 0.19, 0.025, 0.105, [0.06, 0.06, 0.06], 'noBottom', null, 0.3);
  sheet(b, 0.38, 0.527, 0.1, 0.13, 0.05, 'up', [0.92, 0.9, 0.84], null, 0.3);
  b.solid(-0.56, 0, -0.46, 0.56, 1.1, 0.24);
  // 雪花：每 0.1 s 换一档亮度（纯函数，不吃 rng）
  const seed = U.hashInts(b.seed, 'L1-tv', b.cx, b.cz);
  let last = -1;
  b.update((dt, t) => {
    const slot = Math.floor(t * 10);
    if (slot === last) return;
    last = slot;
    const e = 0.75 + 0.35 * (U.hashInts(seed, slot) / 4294967296);
    screen.setColor([0.55 * e, 0.62 * e, 0.7 * e]);
  });
  kit.exit(b, { to: def.to, kind: 'zone', x: 0, z: 1.05, radius: 0.85, marker: true, label: def.label });
  b.pop();
}
function treeExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  // 地面裂开一圈露出泥土，几块翘起的水泥板
  blot(b, 0, 0, 1.0, 0.85, 9, C.soil, r);
  b.cylinder(0, 0, 0, 0.55, 0.12, 'kit:prop', { rTop: 0.22, segments: 8, caps: false, color: mulc(C.soil, 1.3), solid: false, uv: 'stretch' });
  for (let q = 0; q < 3; q++) { const a = q / 3 * TAU + r(); dbox(b, Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, 0.5, 0.06, 0.35, [0.6, 0.59, 0.56], 'noBottom', 'L1:wall', a); }
  b.cylinder(0, 0, 0, 0.17, 1.7, 'kit:prop', { rTop: 0.1, segments: 7, caps: false, color: C.bark, solid: true, uv: 'stretch' });
  const br = [[0.1, 1.2, 0, 0.9, 2.2, 0.3], [-0.05, 1.5, 0, -0.8, 2.5, -0.2], [0, 1.7, 0.05, 0.3, 2.9, 0.6], [0, 1.65, -0.05, -0.2, 2.8, -0.7], [0.05, 1.0, 0.05, 0.6, 1.6, 0.8]];
  for (const q of br) {
    stick(b, [q[0], q[1], q[2]], [q[3], q[4], q[5]], 0.045, C.bark);
    stick(b, [q[3], q[4], q[5]], [q[3] * 1.35 + 0.15, q[4] + 0.35, q[5] * 1.3 - 0.1], 0.018, C.bark);
  }
  for (let q = 0; q < 3; q++) { const a = q / 3 * TAU + 0.5; stick(b, [0, 0.1, 0], [Math.cos(a) * 0.55, 0.02, Math.sin(a) * 0.55], 0.04, C.bark); }
  kit.exit(b, { to: def.to, kind: 'zone', x: 0, z: 0, radius: 1.0, marker: true, label: def.label });
  b.pop();
}
function cairnExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  let y = 0;
  for (let q = 0; q < 6; q++) {
    const rr = 0.42 - q * 0.055, hh = 0.12 + r() * 0.06;
    b.cylinder((r() - 0.5) * 0.06, y, (r() - 0.5) * 0.06, rr, hh, 'kit:prop', { rTop: rr * 0.9, segments: 7, color: mulc([0.55, 0.53, 0.5], 0.8 + r() * 0.3), solid: false, uv: 'stretch' });
    y += hh;
  }
  b.solid(-0.42, 0, -0.42, 0.42, y, 0.42);
  // 一根插在石缝里的木杆，挂着褪色的布条
  stick(b, [0.1, y - 0.1, 0], [0.12, y + 0.9, 0.02], 0.015, [0.45, 0.35, 0.22]);
  for (let q = 0; q < 3; q++) {
    const yy = y + 0.8 - q * 0.18, c = [[0.8, 0.3, 0.25], [0.3, 0.5, 0.75], [0.85, 0.75, 0.3]][q];
    for (const s of [1, -1]) facets(b, 'kit:prop', [[[0.12, yy, 0.02], [0.12, yy - 0.12, 0.02], [0.42, yy - 0.16, 0.05 + s * 0.001], [0.42, yy - 0.04, 0.05 + s * 0.001]]], c, [0.25, yy, 0.02 - s]);
  }
  // 通往石堆的一串踏脚石
  for (let q = 1; q <= 4; q++) blot(b, 0, 0.6 + q * 0.55, 0.2, 0.15, 6, [0.5, 0.49, 0.46], r);
  kit.exit(b, { to: def.to, kind: 'zone', x: 0, z: 0, radius: 1.1, marker: true, label: def.label });
  b.pop();
}
function scrapExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  const W = 1.1, D = 0.85, Hh = 0.75, T = 0.05, wood = [0.58, 0.44, 0.27];
  dbox(b, 0, 0, D / 2 - T / 2, W, Hh, T, wood, 'noBottom');
  dbox(b, 0, 0, -D / 2 + T / 2, W, Hh, T, wood, 'noBottom');
  dbox(b, W / 2 - T / 2, 0, 0, T, Hh, D - 2 * T, wood, 'noBottom');
  dbox(b, -W / 2 + T / 2, 0, 0, T, Hh, D - 2 * T, wood, 'noBottom');
  for (const y of [0.2, 0.45]) sheet(b, 0, y, D / 2 + 0.003, W, 0.012, '+z', [0.3, 0.22, 0.13]);
  sheet(b, 0, 0.55, 0, W - 2 * T, D - 2 * T, 'up', [0.2, 0.19, 0.18]);
  // 废金属：钢筋、角铁、钢板、齿轮、一截管子
  const rust = [[0.45, 0.28, 0.18], [0.5, 0.5, 0.52], [0.38, 0.3, 0.25]];
  for (let q = 0; q < 7; q++) {
    const px = (r() - 0.5) * 0.8, pz = (r() - 0.5) * 0.6;
    stick(b, [px, 0.5, pz], [px + (r() - 0.5) * 0.6, 0.8 + r() * 0.6, pz + (r() - 0.5) * 0.5], 0.015 + r() * 0.02, rust[q % 3]);
  }
  for (let q = 0; q < 3; q++) dbox(b, (r() - 0.5) * 0.6, 0.55 + q * 0.08, (r() - 0.5) * 0.4, 0.35, 0.02, 0.28, rust[(q + 1) % 3], 'all', null, r() * 3);
  b.cylinder(0.25, 0.8, -0.1, 0.16, 0.04, 'kit:prop', { axis: 'x', segments: 10, color: [0.42, 0.42, 0.44], solid: false, uv: 'stretch' });
  b.cylinder(-0.2, 0.7, 0.15, 0.06, 0.9, 'kit:prop', { axis: 'z', segments: 7, caps: false, color: [0.5, 0.35, 0.22], solid: false, uv: 'stretch' });
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  kit.exit(b, { to: def.to, kind: 'zone', x: 0, z: 0, radius: 1.15, marker: true, label: def.label });
  b.pop();
}
function root2Exit(b, x, z, rot, def, r) {
  b.push(x, z, rot + Math.PI / 4);
  // 一块转了 45° 的方形地面，四周一圈极淡的青色缝光；上面有人用粉笔写了 √2
  dbox(b, 0, 0, 0, 1.0, 0.012, 1.0, [1.25, 1.25, 1.3], 'noBottom', 'L1:floor');
  for (const s of [-1, 1]) {
    sheet(b, 0, 0.003, s * 0.515, 1.06, 0.025, 'up', [0.3, 0.9, 1.0], 'kit:glow');
    sheet(b, s * 0.515, 0.003, 0, 0.025, 1.0, 'up', [0.3, 0.9, 1.0], 'kit:glow');
  }
  const chalk = [1.2, 1.2, 1.15], y = 0.016;
  const seg = (a, c, w) => {
    const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    facets(b, 'kit:prop', [[[a[0] + nx, y, a[1] + nz], [c[0] + nx, y, c[1] + nz], [c[0] - nx, y, c[1] - nz], [a[0] - nx, y, a[1] - nz]]], chalk, [0, -1, 0]);
  };
  seg([-0.34, 0.02], [-0.26, 0.12], 0.012); seg([-0.26, 0.12], [-0.14, -0.2], 0.012); seg([-0.14, -0.2], [0.14, -0.2], 0.012);
  seg([0.02, -0.08], [0.12, -0.12], 0.01); seg([0.12, -0.12], [0.16, -0.05], 0.01); seg([0.16, -0.05], [0.02, 0.1], 0.01); seg([0.02, 0.1], [0.17, 0.1], 0.01);
  b.pop();
  b.push(x, z, rot);
  kit.exit(b, { to: def.to, kind: 'zone', x: 0, z: 0, radius: 1.0, marker: true, label: def.label });
  b.pop();
}
function freeDoorExit(b, x, z, rot, def, r) {
  b.push(x, z, rot);
  dbox(b, 0, 0, 0, 1.2, 0.025, 0.34, [0.48, 0.4, 0.3], 'noBottom');           // 门槛石
  sheet(b, 0, 0.007, 0.62, 0.8, 0.45, 'up', [0.42, 0.33, 0.22]);                // 门前一块脚垫
  kitCall(b, KIT_EST.door, () => kit.exit(b, { to: def.to, kind: 'door', x: 0, z: 0, rot: 0, style: 'wood', label: def.label }));
  b.pop();
}

// Level Fun 入口的天花板补丁（依据：level-fun.json wikidot-cn entrances[0]「切入 Level 1 的天花板」）。
// 上面一层是"楼板背后的另一边"（kit:glow 不吃光，切没的瞬间是一块彩色亮斑），下面一层是盖住它的楼板补丁；
// 闪法按坐标+时间哈希（纯函数，重载区块闪法不变，也不吃 rng；参考 _kit.js noclipPatch）
function funCeilingPatch(b, x, z) {
  const W = 1.8;
  const SEAM = [0.03, 0.025, 0.035];
  const PARTY = [[1.9, 0.35, 1.5], [0.4, 1.5, 1.7], [1.9, 1.25, 0.3]];
  const back = b.plane(x, H - 0.005, z, W + 0.07, W + 0.07, 'kit:glow', { facing: 'down', uv: 'solid', color: SEAM });
  const cover = b.plane(x, H - 0.03, z, W, W, 'L1:wall', { facing: 'down', color: CEIL_COLOR });
  const seed = U.hashInts(b.seed, 'L1-fun-patch', b.cx, b.cz, Math.round(x * 10), Math.round(z * 10));
  let lastSlot = -1;
  b.update((dt, t) => {
    const slot = Math.floor(t * 9);
    if (slot === lastSlot) return;
    lastSlot = slot;
    const e = U.hashInts(seed, slot) / 4294967296;
    const open = e < 0.26;
    if (cover.visible === open) cover.setVisible(!open);
    back.setColor(open ? PARTY[U.hashInts(seed, slot, 1) % PARTY.length] : SEAM);
  });
}

// ---------- 墙面出口 ----------
// 门的外观：颜色、样式（kit.prop.door 的参数）
const DOOR_LOOKS = {
  glass: { style: 'metal', color: 0xb8bec2, frame: 0x9aa1a6 },
  symbol: { style: 'metal', color: 0x8e9398, frame: 0x6e7378 },
  frozen: { style: 'metal', color: 0xb9d3e0, frame: 0xa9c2cf },
  bunker: { style: 'metal', color: 0x4d5443, frame: 0x2f332a },
  cold: { style: 'metal', color: 0x9db3c2, frame: 0x8aa0ae },
  white: { style: 'wood', color: 0xf1efe6, frame: 0xe6e3da },
  plain: { style: 'metal', color: 0x7f868c, frame: 0x6e7378 },
  mute: { style: 'metal', color: 0x55595e, frame: 0x44474b },
  meg: { style: 'metal', color: 0x7d8a7a, frame: 0x6a7368 },
  concrete: { style: 'metal', color: 0x8a8a84, frame: 0x74746e },
  exclaim: { style: 'metal', color: 0x23262a, frame: 0x3a3e42 },
};
function placeWallExits(b, env, defs) {
  for (const s of env.slots) s.score = slotScore(s, env) + frac(s.n * 0.618) * 0.1;
  for (const def of defs) {
    let best = null;
    for (const s of env.slots) if (!s.used && (!best || s.score > best.score)) best = s;
    if (!best) {
      // 兜底（按设计不会发生）：主通道上立一扇独立的门，出口宁可摆得怪也不能丢
      best = { x: 2, z: 8 + 8 * (defs.indexOf(def) % 3), rot: HALF_PI, host: 'fallback', used: true };
    }
    best.used = true;
    placeWallExit(b, def, best);
  }
}
function placeWallExit(b, def, s) {
  const nx = Math.sin(s.rot), nz = Math.cos(s.rot);
  if (def.kind === 'elevator') {
    const x = s.x + nx * 0.116, z = s.z + nz * 0.116;
    kitCall(b, KIT_EST.elevator, () => kit.exit(b, { to: def.to, kind: 'elevator', x, z, rot: s.rot, label: def.label, elevator: { indicator: [1.6, 0.5, 0.2] } }));
    // 「通向一段楼梯」：门边一块指向下方的楼梯标志
    b.push(x, z, s.rot);
    sheet(b, -0.95, 1.5, 0.005 - 0.116, 0.22, 0.22, '+z', [0.15, 0.45, 0.25]);
    for (let q = 0; q < 3; q++) sheet(b, -1.02 + q * 0.05, 1.54 + q * 0.04, 0.008 - 0.116, 0.05, 0.02, '+z', [0.95, 0.95, 0.92]);
    b.pop();
    return;
  }
  if (def.kind === 'zone') {
    painting(b, s.x, s.z, s.rot, def.look);
    kit.exit(b, { to: def.to, kind: 'zone', x: s.x + nx * 0.95, z: s.z + nz * 0.95, radius: 0.85, marker: true, label: def.label });
    return;
  }
  const L = DOOR_LOOKS[def.look] || DOOR_LOOKS.plain;
  const off = 0.086;
  const x = s.x + nx * off, z = s.z + nz * off;
  if (def.kind === 'event') {
    kitCall(b, KIT_EST.door, () => kit.prop.door(b, x, z, s.rot, { style: L.style, color: L.color, frameColor: L.frame }));
    kit.exit(b, { to: def.to, kind: 'event', x: x + nx * 0.7, z: z + nz * 0.7, radius: 0.8, active: false, label: def.label });
  } else {
    kitCall(b, KIT_EST.door, () => kit.exit(b, { to: def.to, kind: 'door', x, z, rot: s.rot, style: L.style, label: def.label, door: { color: L.color, frameColor: L.frame } }));
  }
  doorExtras(b, def.look, x, z, s.rot);
}
// 门上的附加细节（门板本地坐标：门扇中心 x=0，正面 z≈0.0225，门高 2.05、宽 0.9）
function doorExtras(b, look, x, z, rot) {
  const zf = 0.0225 + 0.004;
  b.push(x, z, rot);
  if (look === 'glass') {
    // 依据：exits[1]「玻璃门」——门扇上一大块深色玻璃 + 一道反光 + 推杠
    sheet(b, 0, 0.35, zf, 0.66, 1.55, '+z', [0.14, 0.2, 0.22]);
    facets(b, 'kit:prop', [[[-0.25, 0.5, zf + 0.002], [-0.12, 0.5, zf + 0.002], [0.2, 1.8, zf + 0.002], [0.07, 1.8, zf + 0.002]]], [0.4, 0.5, 0.55], [0, 1, -1]);
    dbox(b, 0, 0.98, 0.05, 0.72, 0.04, 0.035, [0.75, 0.77, 0.78], 'all');
  } else if (look === 'symbol') {
    // 依据：exits[2]「装有荧光灯的走廊尽头、带独特符号的门」——门上方一支荧光灯，门板上一个圆环套三角的符号
    const g = new THREE.RingGeometry(0.12, 0.16, 16);
    b.mesh(g, 'kit:prop', { x: 0, y: 1.45, z: zf, color: [0.55, 0.08, 0.08], uv: 'stretch' });
    g.dispose();
    facets(b, 'kit:prop', [[[-0.085, 1.39, zf], [0.085, 1.39, zf], [0, 1.54, zf]]], [0.55, 0.08, 0.08], [0, 1.45, -1]);
    dbox(b, 0, 2.45, 0.06, 1.2, 0.06, 0.12, C.housing, 'all');
    const tube = glowBox(b, 0, 2.42, 0.08, 1.1, 0.03, 0.05, C.tube);
    const src = b.light({ x: 0, z: 0.5, y: 2.3, color: 0xeef4ff, intensity: 0.6, range: 4, flicker: 0.15 });
    b.linkGlow(tube, src, C.tube);
  } else if (look === 'frozen') {
    // 依据：exits[3]「结冰金属门」——门板下半截白霜，门楣挂冰棱，门前地上一滩冰。
    // 霜盖在 kit 金属门的踢脚板（正面 30.5 mm）外面，离它 2 mm
    const zfr = 0.0325;
    sheet(b, 0, 0.02, zfr, 0.86, 0.55, '+z', [0.92, 0.96, 1.0]);
    facets(b, 'kit:prop', [[[-0.43, 0.57, zfr], [0.43, 0.57, zfr], [0.3, 0.75, zfr], [-0.1, 0.66, zfr], [-0.35, 0.8, zfr]]], [0.92, 0.96, 1.0], [0, 0.6, -1]);
    for (let q = 0; q < 6; q++) b.cylinder(-0.45 + q * 0.18, 2.13 - (0.12 + (q % 3) * 0.07), 0.07, 0.003, 0.12 + (q % 3) * 0.07, 'kit:prop', { rTop: 0.022, segments: 5, caps: false, color: [0.85, 0.93, 1.0], solid: false, uv: 'stretch' });
    kitPuddle(b, 0, 0.55, { rx: 0.6, rz: 0.35, y: 0.009, color: [0.65, 0.78, 0.86] });
  } else if (look === 'bunker') {
    // 依据：exits[4]「掩体门」——厚重的暗绿钢门，转盘把手、三个大合页、门框刷黄黑警示条
    b.cylinder(0, 1.1, 0.06, 0.2, 0.03, 'kit:prop', { axis: 'z', segments: 10, color: [0.3, 0.32, 0.28], solid: false, uv: 'stretch' });
    for (let q = 0; q < 4; q++) { const a = q / 4 * TAU; stick(b, [0, 1.1, 0.06], [Math.cos(a) * 0.19, 1.1 + Math.sin(a) * 0.19, 0.06], 0.012, [0.22, 0.24, 0.2]); }
    for (let q = 0; q < 3; q++) dbox(b, -0.47, 0.25 + q * 0.75, 0.03, 0.06, 0.16, 0.07, [0.2, 0.22, 0.18], 'all');
    for (const sx of [-1, 1]) for (let q = 0; q < 7; q++) sheet(b, sx * 0.49, q * 0.3, 0.0845, 0.08, 0.3, '+z', q % 2 ? C.black : C.yellow);   // 门框面 80 mm、kit 门框线 82 mm 之上
    sheet(b, 0, 1.6, zf, 0.7, 0.35, '+z', [0.36, 0.4, 0.32]);
  } else if (look === 'cold') {
    // 依据：exits[6]「感觉比四周墙面稍冷」——门缝底下一道薄霜
    sheet(b, 0, 0.004, 0.2, 0.9, 0.3, 'up', [0.8, 0.88, 0.95]);
  } else if (look === 'white') {
    // 依据：exits[8]「纯白木门」——kit 的木门格子板是深色的，盖上白色。kit 深色板正面在 30.5 mm、
    // 高画质的凸起门芯板在 33 mm：白板夹在两者中间（31.5 mm），各差 1 mm 以上，门芯板照样凸出来
    for (const y of [0.22, 1.14]) sheet(b, 0, y, 0.0315, 0.64, 0.72, '+z', [0.9, 0.89, 0.85]);
  } else if (look === 'plain' || look === 'meg' || look === 'concrete') {
    sheet(b, 0, 1.5, zf, 0.2, 0.26, '+z', look === 'meg' ? [0.25, 0.4, 0.62] : [0.85, 0.85, 0.82]);
  } else if (look === 'exclaim') {
    // 依据：level-run.json「画有感叹号符号的门」，另一条资料写这个印记「褪色、有刮痕」
    const FADED = [0.55, 0.53, 0.47];
    dbox(b, 0, 1.0, zf, 0.085, 0.54, 0.006, FADED, 'all');
    dbox(b, 0, 0.82, zf, 0.085, 0.085, 0.006, FADED, 'all');
    for (let q = 0; q < 3; q++) facets(b, 'kit:prop', [[[-0.2 + q * 0.12, 1.25, zf + 0.004], [-0.18 + q * 0.12, 1.25, zf + 0.004], [-0.05 + q * 0.12, 0.7, zf + 0.004], [-0.07 + q * 0.12, 0.7, zf + 0.004]]], [0.4, 0.4, 0.38], [0, 1, -1]);
  }
  b.pop();
}
// 墙上的画（画布朝墙外）：moon = 月球画作（exits[15]）；island = 山顶枯树岩石岛屿（exits[19]）
function painting(b, x, z, rot, look) {
  b.push(x, z, rot);
  const W = 1.1, Hh = 0.82, y0 = 1.1, zf = 0.03;
  const fc = [0.5, 0.38, 0.18];
  dbox(b, 0, y0 - 0.06, zf / 2, W + 0.12, 0.06, zf, fc, 'all');
  dbox(b, 0, y0 + Hh, zf / 2, W + 0.12, 0.06, zf, fc, 'all');
  for (const s of [-1, 1]) dbox(b, s * (W / 2 + 0.03), y0, zf / 2, 0.06, Hh, zf, fc, 'all');
  sheet(b, 0, y0, zf - 0.006, W, Hh, '+z', look === 'moon' ? [0.04, 0.05, 0.1] : [0.55, 0.7, 0.85]);
  const z1 = zf - 0.003;
  if (look === 'moon') {
    const g = new THREE.CircleGeometry(0.2, 14);
    b.mesh(g, 'kit:prop', { x: 0.12, y: y0 + 0.45, z: z1, color: [0.88, 0.87, 0.8], uv: 'stretch' });
    g.dispose();
    for (const [cx, cy, cr] of [[0.05, 0.5, 0.04], [0.18, 0.38, 0.03], [0.16, 0.55, 0.025]]) {
      const c = new THREE.CircleGeometry(cr, 7);
      b.mesh(c, 'kit:prop', { x: cx, y: y0 + cy, z: z1 + 0.002, color: [0.62, 0.61, 0.56], uv: 'stretch' });
      c.dispose();
    }
    // 星星贴在画布（zf − 6 mm）上 1 mm、月亮（z1）下 2 mm：碰上月亮就被盖住，不和月面共面
    for (let q = 0; q < 7; q++) sheet(b, -0.48 + frac(q * 0.37) * 0.9, y0 + 0.08 + frac(q * 0.61) * 0.68, zf - 0.005, 0.012, 0.012, '+z', [0.9, 0.9, 0.85]);
  } else {
    sheet(b, 0, y0, z1, W, Hh * 0.42, '+z', [0.2, 0.42, 0.5]);               // 海
    sheet(b, 0, y0 + Hh * 0.72, z1, W, Hh * 0.28, '+z', [0.85, 0.62, 0.45]); // 晚霞
    facets(b, 'kit:prop', [[[-0.3, y0 + Hh * 0.42, z1 + 0.002], [0.3, y0 + Hh * 0.42, z1 + 0.002], [0.12, y0 + Hh * 0.62, z1 + 0.002], [-0.08, y0 + Hh * 0.64, z1 + 0.002]]], [0.4, 0.34, 0.28], [0, y0, -1]);
    const tb = y0 + Hh * 0.63;
    for (const [a, c] of [[[0.02, tb], [0.03, tb + 0.18]], [[0.03, tb + 0.12], [0.1, tb + 0.2]], [[0.025, tb + 0.08], [-0.05, tb + 0.16]]]) {
      facets(b, 'kit:prop', [[[a[0] - 0.006, a[1], z1 + 0.004], [a[0] + 0.006, a[1], z1 + 0.004], [c[0] + 0.004, c[1], z1 + 0.004], [c[0] - 0.004, c[1], z1 + 0.004]]], [0.12, 0.1, 0.08], [0, y0, -1]);
    }
  }
  b.pop();
}

// =====================================================================
// 区段点缀、团体地标、刷新点
// =====================================================================
// 区段的结构性特征（每块都有、不看预算）：哥特段的拱门、传说段柱子上的霓虹灯管
function sectorInfra(b, env) {
  const sector = env.sector;
  if (sector === 'gothic') {
    // 拱门：主通道边上两条柱线（z=4、z=28）相邻两柱之间一道弧形拱板，拱脚 2.5 m、拱顶贴梁底
    const R = env.st.pillar * 0.56;
    for (const zl of [LINES[0], LINES[3]]) for (let k = 0; k < 3; k++) archPlate(b, LINES[k] + R, LINES[k + 1] - R, zl, mulc(env.st.concrete, 0.95));
  } else if (sector === 'legend') {
    // 霓虹灯管竖贴在主通道边的柱子上
    const neon = [[1.9, 0.4, 1.6], [0.35, 1.6, 1.9], [1.9, 1.3, 0.3]];
    for (let k = 0; k < 4; k++) {
      const px = LINES[k], pz = LINES[3], h2 = env.st.pillar / 2 + 0.02;
      glowBox(b, px, 1.6, pz + h2, 0.04, 1.5, 0.02, neon[k % 3]);
    }
  }
}
// 区段点缀（看预算）：传说段垂下的彩色电缆、花园段的藤蔓、天鹰段的漏水管、团体地标
function sectorExtras(b, env) {
  const r = U.rng(b.seed, b.cx, b.cz, 'L1-extra');
  const sector = env.sector;
  const roomy = triCount(b) < TRI_BUDGET - 160;
  if (sector === 'gothic') {
    // 拱门在 sectorInfra
  } else if (sector === 'legend') {
    for (let k = 0; k < 3 && roomy; k++) {
      const x0 = LINES[k] + 0.4, x1 = LINES[k + 1] - 0.4, zc = LINES[3] + 0.3 + k * 0.05;
      const col = [[0.8, 0.15, 0.15], [0.15, 0.4, 0.85], [0.9, 0.75, 0.15]][k];
      let prev = [x0, 3.2, zc];
      for (let q = 1; q <= 6; q++) {
        const t = q / 6, y = 3.2 - Math.sin(t * Math.PI) * (0.6 + k * 0.15);
        const p = [x0 + (x1 - x0) * t, y, zc];
        stick(b, prev, p, 0.014, col);
        prev = p;
      }
    }
  } else if (sector === 'garden') {
    // 梁上挂下来的藤蔓
    for (let q = 0; q < 8; q++) {
      if (triCount(b) > TRI_BUDGET - 20) break;
      const alongX = r() < 0.5, line = LINES[Math.floor(r() * 4)], a = 2 + r() * 28;
      const x = alongX ? a : line + 0.26, z = alongX ? line + 0.26 : a, len = 0.6 + r() * 1.4;
      stick(b, [x, H - BEAM_D, z], [x + (r() - 0.5) * 0.2, H - BEAM_D - len, z + (r() - 0.5) * 0.2], 0.018, mulc(C.leaf, 0.8 + r() * 0.4));
    }
  } else if (sector === 'tianying') {
    // 依据：landmarks「天鹰段天花板漏水小管子」——一根细水管，接头处滴水，下面一滩水
    const zl = 8 + 8 * Math.floor(r() * 3) + (r() - 0.5) * 2.6;   // 柱间中线附近（柱线上是梁）
    if (roomy) b.cylinder(SIZE / 2, H - 0.2, zl, 0.03, SIZE, 'kit:prop', { axis: 'x', segments: 6, caps: false, color: [0.55, 0.5, 0.42], solid: false, uv: 'stretch' });
    for (let q = 0; q < 2; q++) {
      const px = 6 + r() * 20;
      if (!roomy || Math.abs(((px - 4) % 8 + 8) % 8 - 4) > 3.2) continue;   // 柱线附近不滴（柱帽下面）
      b.cylinder(px, H - 0.2, zl, 0.045, 0.08, 'kit:prop', { axis: 'x', segments: 6, color: [0.45, 0.4, 0.3], solid: false, uv: 'stretch' });
      glowBox(b, px, H - 0.34, zl, 0.02, 0.05, 0.02, [0.45, 0.55, 0.6]);
      kitPuddle(b, px, zl, { rx: 0.7, rz: 0.5, y: 0.012 });   // 比别处水坑（9 mm）高 3 mm：碰巧叠在一起也不闪
      markPuddle(b, px, zl);
    }
  }
  // 依据：landmarks「团体地标：饰有团队标志的彩色布料＋食物或杏仁水＋纸条（门边、墙上、霓虹灯下）」——衔尾段无据点可求助，不放
  if (sector !== 'ouroboros' && r() < 0.12 && triCount(b) < TRI_BUDGET - 60) {
    const k = Math.floor(r() * 3) + 1, px = LINES[k], pz = LINES[0], h2 = env.st.pillar / 2;
    const cloth = [r(), r() * 0.4 + 0.2, r() * 0.4 + 0.2];
    b.push(px, pz, Math.PI);
    sheet(b, 0, 1.35, h2 + 0.02, 0.62, 0.8, '+z', cloth);
    facets(b, 'kit:prop', [[[-0.12, 1.65, h2 + 0.024], [0.12, 1.65, h2 + 0.024], [0, 1.85, h2 + 0.024]]], [0.95, 0.9, 0.7], [0, 1.7, 0]);
    sheet(b, 0.22, 1.1, h2 + 0.024, 0.14, 0.18, '+z', [0.95, 0.94, 0.88]);
    crate(b, 0, 0, h2 + 0.5, 0.5, 0.35, 0.4, 0, C.crate);
    b.pop();
    b.solid(px - 0.3, 0, pz - h2 - 0.75, px + 0.3, 0.35, pz - h2 - 0.25);
    b.spawn(px, pz - h2 - 1.1, 'room', { safe: true });
  }
}
// 哥特段拱板：两根柱之间、从拱脚 2.5 m 到梁底 3.55 m 的一块弧形板，前后两面 + 拱底面
function archPlate(b, x0, x1, zl, color) {
  const n = 8, ys = 2.5, yt = H - BEAM_D, t = 0.2, xm = (x0 + x1) / 2, hw = (x1 - x0) / 2;
  const curve = [];
  for (let k = 0; k <= n; k++) { const u = -1 + 2 * k / n; curve.push([xm + u * hw, ys + (yt - 0.12 - ys) * Math.sqrt(Math.max(0, 1 - u * u))]); }
  const faces = [];
  for (let k = 0; k < n; k++) {
    const a = curve[k], c = curve[k + 1];
    for (const s of [-1, 1]) faces.push([[a[0], a[1], zl + s * t], [c[0], c[1], zl + s * t], [c[0], yt, zl + s * t], [a[0], yt, zl + s * t]]);
    faces.push([[a[0], a[1], zl - t], [c[0], c[1], zl - t], [c[0], c[1], zl + t], [a[0], a[1], zl + t]]);
  }
  // 自动定向：前后两面背离拱板中面，拱底面背离上方
  const front = faces.filter((f, i) => i % 3 !== 2), soffit = faces.filter((f, i) => i % 3 === 2);
  for (const f of front) facets(b, 'L1:wall', [f], color, [xm, (ys + yt) / 2, zl]);
  facets(b, 'L1:wall', soffit, mulc(color, 0.9), [xm, yt + 5, zl]);
}

// 刷新点：4 m 网格 + 抖动（每块 64 个候选，压在货架/堆垛/墙里的由 kit 剔掉），小屋里的标 room + safe
function addSpawns(b, env) {
  const r = U.rng(b.seed, b.cx, b.cz, 'L1-spawns');
  for (let gz = 0; gz < 8; gz++) {
    for (let gx = 0; gx < 8; gx++) {
      const x = 2 + gx * 4 + (r() - 0.5) * 1.4, z = 2 + gz * 4 + (r() - 0.5) * 1.4;
      const hut = env.huts.find(h => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
      if (hut) b.spawn(x, z, 'room', { safe: true });   // 依据：mechanics「小径中实体极少游荡，可放心使用照明工具」
      else b.spawn(x, z, 'floor');
    }
  }
  for (const h of env.huts) {
    b.spawn(h.x0 + 1.1, h.z0 + 1.1, 'room', { safe: true });
    b.spawn(h.x1 - 1.1, (h.z0 + h.z1) / 2, 'room', { safe: true });
  }
}

// =====================================================================
// 区块
// =====================================================================
// 随机数：区块主 rng 只取「柱网方向 + 九个柱间的 3 个骰子」（固定 28 次）；
// 柱间内容、灯、刷新点、点缀各走 U.rng(levelSeed, cx, cz, 用途) 派生流，出口计划走宏格派生流
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const seed = b.seed;
  const isSpawn = cx === 0 && cz === 0;
  const sector = sectorAt(seed, cx, cz);
  const st = STYLE[sector];

  const defs = [];
  if (!isSpawn) {
    const cell = planCell(seed, cx, cz);
    if (cell) for (const d of cell.defs) defs.push(d);
    if (macroPick(seed, FUN_DEF.tag, cx, cz, FUN_DEF.macro)) defs.push(FUN_DEF);
  }
  const rOrient = rng();
  const orient = isSpawn ? 'x' : rOrient < 0.5 ? 'x' : 'z';
  const bays = planBays(rng, defs, isSpawn, st);
  const env = { st, sector, orient, bays, slots: [], huts: [], walls: [], portalNear: isSpawn ? null : portalNear(seed, cx, cz) };
  finishLayout(env);
  env.lampOnBeam = (x, z) => LINES.indexOf(x) >= 0 || LINES.indexOf(z) >= 0;

  buildShell(b, env);
  for (const px of LINES) for (const pz of LINES) buildPillar(b, px, pz, env);
  sectorInfra(b, env);

  // 吊灯：挂在柱线中点（梁下），刚好在货架排之间的通道正上方；撞上承重墙就往墙这一侧挪 1.4 m
  const lr = U.rng(seed, cx, cz, 'L1-lamps');
  for (let a = 0; a < 4; a++) {
    for (let c = 0; c < 4; c++) {
      let x = orient === 'x' ? a * 8 : LINES[a], z = orient === 'x' ? LINES[c] : c * 8;
      for (const w of env.walls) {
        if (w.horiz && Math.abs(z - w.line) < 0.01 && x > w.a0 && x < w.a1) z += w.side * 1.4;
        if (!w.horiz && Math.abs(x - w.line) < 0.01 && z > w.a0 && z < w.a1) x += w.side * 1.4;
      }
      buildLamp(b, x, z, orient, env, lr);
    }
  }
  buildPipes(b, env);

  // 必摆：结构性柱间 + 出口
  for (const bay of bays) buildBayCore(b, bay, env);
  placeWallExits(b, env, defs.filter(d => d.host === 'wall'));
  // 可选：剩余预算分给各柱间（货架优先）
  fillBays(b, bays, env);
  decorateFreeSlots(b, env);
  sectorExtras(b, env);
  addSpawns(b, env);
  b.data.sector = sector;
  b.data.bays = bays.map(bb => bb.type[0] + (bb.exits.length ? '*' : '')).join('');
  return b.finish();
}

// ---------- 层级状态与危害（enter/update/leave）----------
const S = { timer: 0, epoch: -1, blackout: false, blackoutUntil: 0, scareAt: 0, gardenTimer: 0, warned: false };
const EPOCH_LEN = 45;          // 依据：lighting「何时开始与结束皆不可预测」——原文没给数值，取一个不算频繁的巡检间隔
const BLACKOUT_CHANCE = 0.3;   // 判断依据：hazards「闪烁…可能是最致命现象之一」，但也不是每次巡检都发生
const GARDEN_HOUR = (BR.itemKit && BR.itemKit.LORE_HOUR) || 60;   // 依据：landmarks「花园段停留一小时开始植物化」，1 设定小时=60 秒

// 依据：lighting「头顶的人造光源冲泻而下…房间内为惨白的荧光」——不发黑的中灰底色，人造光偏冷白
const LEVEL_ENV = {
  background: 0x34322d, fogColor: 0x34322d, fogNear: 8, fogFar: 56,   // fogFar ≤ chunkSize × 2 = 64
  ambient: { color: 0xf0ecdc, intensity: 0.4 },
  sanityDrainMul: 0.9,   // 依据：survivalClass「安全稳定」+ 昵称「宜居地带」，比默认基线略缓
  hungerDrainMul: 1,
  audio: 'pipes',        // 依据：sounds「天花板管道间不时传来零星的金属撞击声、间歇隆隆声」
  darkness: false,
};
// 闪烁（全层断光）时的环境：灯全灭，只剩一层很暗的冷灰（有效亮度 ≈0.13，看得清脚下的路，不整屏全黑）；
// 小屋门上的绿色应急灯（kit:glow，不吃光）这时在黑暗里格外显眼——正好是原文说的「找亮着绿色应急灯的门」
const BLACKOUT_ENV = Object.assign({}, LEVEL_ENV, {
  ambient: { color: 0xa4acbc, intensity: 0.2 }, background: 0x0b0c0f, fogColor: 0x0b0c0f, fogNear: 1.5, fogFar: 16,
});

function onBlackoutStart(ctx) {
  BR.hud.toast('灯光闪了一下……万籁俱寂', 2000);
  if (!S.warned) { BR.hud.toast('闪烁：别开灯，找亮着绿色应急灯的门躲进小屋', 3500); S.warned = true; }
  BR.audio.play('static');
  BR.gfx.applyEnv(BLACKOUT_ENV, BR.game.settings.visibility);
  for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { if (l._l1orig === undefined) l._l1orig = l.intensity; l.intensity = 0; }
}
function onBlackoutEnd() {
  BR.audio.play('buzz');
  BR.gfx.applyEnv(LEVEL_ENV, BR.game.settings.visibility);
  for (const c of BR.world.chunks()) for (const l of (c.lights || [])) if (l._l1orig !== undefined) l.intensity = l._l1orig;
}

BR.levels.register({
  id: '1', name: 'Level 1', title: '宜居地带', nickname: '宜居地带（Habitable Zone）',
  version: 'wikidot-cn',
  survivalClass: '生存难度 等级 1：安全稳定 + 存在异常资源',
  chunkSize: SIZE,
  env: LEVEL_ENV,
  spawn() {
    return { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: SPAWN.yaw };
  },
  buildChunk,
  entities: [
    // 依据：entities[] 里除「手臂」「爬菌」外的 9 种都列在 entity-index.json 的 level '1'，且都在本批实现范围内。
    // entityDensityOverall「moderate（判断）」：11 种常见清单没给数字，把 moderate(0.35) 拆到各类型上，
    // 单一形态的敌对类型每种取 rare(0.04)，钝人图注特别标注「常见」上浮一档取 low(0.12)；
    // 拆成雌雄/变体两个 type 注册的物种（牧蛇、悲尸），把同一物种的 rare(0.04) 预算按形态比重拆开，不重复计（否则密度翻倍）。
    { type: 'hound', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'smiler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'skin_stealer', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'clump', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'duller', officialPer1000m2: BR.config.densityWords.low },   // 图注称「Level 1 中常见的人形实体之一」
    { type: 'growler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'nguithrxurh', officialPer1000m2: BR.config.densityWords.rare },
    // 牧蛇雌雄二态分开注册（js/entities/wrangler.js）：雄性「敌对」为主要威胁形态，雌性「中立退避」
    { type: 'wrangler_male', officialPer1000m2: 0.025 },
    { type: 'wrangler_female', officialPer1000m2: 0.015 },
    // 悲尸标准型/畸形肉块变体分开注册（js/entities/wretch.js），版本原文没分别给两种形态的比例，rare(0.04) 平分
    { type: 'wretch', officialPer1000m2: 0.02 },
    { type: 'wretch_lump', officialPer1000m2: 0.02 },
    // 中立，仅衔尾段出没：引擎没有按宏区限定实体类型的接口，把 rare 除以 6 个区段数近似“仅一处出现”的稀缺度
    { type: 'shadow_worker', officialPer1000m2: 0.005 },
    { type: 'shadow_worker_penelope', officialPer1000m2: 0.001 },
    { type: 'shadow_worker_grunt', officialPer1000m2: 0.001 },
  ],
  items: [
    // 全部来自 data/item-spawn.json 里 levels 含 '1' 且 js/items/<key>.js 已存在的条目，per1000m2 直接取该文件的值
    { type: 'almond_water', per1000m2: 1.2 },     // 用户规则：所有模式都刷
    { type: 'canned_food', per1000m2: 0.5 },      // 依据：items「板条箱里有，小径带家具房间偶有（多数变质）」
    { type: 'antiseptics', per1000m2: 0.3 },      // 依据：items「板条箱物资清单里有消毒剂、肥皂、洗手液」
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'warpberries', per1000m2: 0.1 },
    { type: 'moth_jelly', per1000m2: 0.003 },
  ],
  exits: [
    ...EXIT_DEFS.map(d => ({ to: d.to, kind: d.kind, note: d.label + '；摆在' + ({ wall: '小屋外墙/承重墙面', noclip: '承重墙中间那段', floor: '空柱间', portal: '专属柱间（淡黄色管道走廊口）', passage: '专属小屋（U 形小径）' }[d.host]) + '，每 5×5 区块必有一处' })),
    { to: FUN_DEF.to, kind: FUN_DEF.kind, note: FUN_DEF.label + '；每 3×3 区块必有一处' },
  ],
  enter(ctx) {
    S.timer = 0; S.epoch = -1; S.blackout = false; S.blackoutUntil = 0; S.scareAt = 0; S.gardenTimer = 0; S.puddleTimer = 0;
    S.rng = U.rng(ctx.levelSeed, 'L1-flavor');
    planCache.clear();
  },
  update(ctx, dt) {
    S.timer += dt;
    // ---------- 闪烁（全层断光）----------
    const epoch = Math.floor(S.timer / EPOCH_LEN);
    if (epoch !== S.epoch) {
      S.epoch = epoch;
      const r = U.rng(ctx.levelSeed, 'L1-blackout', epoch);
      if (!S.blackout && r() < BLACKOUT_CHANCE) {
        const dur = 8 + r() * 20;
        S.blackout = true; S.blackoutUntil = S.timer + dur;
        onBlackoutStart(ctx);
      }
    }
    if (S.blackout && S.timer >= S.blackoutUntil) { S.blackout = false; onBlackoutEnd(); }

    if (S.blackout) {
      // 依据：hazards「手臂：灯光熄灭时从通风管道和裂缝伸出，猎捕流浪者」——没有独立实体文件，按环境危害处理
      if (S.timer >= S.scareAt) {
        S.scareAt = S.timer + 4 + S.rng() * 3;
        BR.audio.play('growl');
        if (BR.game.attackPlayers && S.rng() < 0.25) {
          BR.gfx.flash(0x3a0000, 0.3, 0.5);
          BR.player.damage({ hp: 6, sanity: 4, source: 'hazard:arms' });
        }
      }
    }

    // ---------- 花园段植物化：连续停留 1 设定小时（GARDEN_HOUR 秒）----------
    const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
    const inGarden = sectorAt(ctx.levelSeed, cc.cx, cc.cz) === 'garden';
    if (inGarden) {
      S.gardenTimer += dt;
      if (S.gardenTimer >= GARDEN_HOUR) {
        S.gardenTimer = 0;
        BR.hud.toast('皮肤下钻出了嫩绿的芽……得离开花园段了', 3000);
        if (BR.game.attackPlayers) BR.effects.add({ key: 'l1-plantify', seconds: 30, speedMul: 0.6, hpPerSec: -0.3, sanityPerSec: -0.5, visual: { flash: '#3a6b2a', peak: 0.25, flashSec: 1.2 }, tags: ['hazard'] });
      }
    } else S.gardenTimer = 0;

    // ---------- 未密封水坑接触感染（爬菌）----------
    // 依据：hazards「水坑与漏水不宜饮用；未密封液体可能传播爬菌」——按接触算轻微 san 损耗，不给即死
    S.puddleTimer = (S.puddleTimer || 0) + dt;
    if (S.puddleTimer >= 0.5) {
      S.puddleTimer = 0;
      for (const c of BR.world.chunks()) {
        const puddles = c.res && c.res.data && c.res.data.puddles;
        if (!puddles) continue;
        for (const p of puddles) {
          const dx = BR.player.x - p.x, dz = BR.player.z - p.z;
          if (dx * dx + dz * dz < 0.36 && BR.game.attackPlayers && S.rng() < 0.05) {
            BR.player.damage({ hp: 0, sanity: 3, source: 'hazard:crawler' });
          }
        }
      }
    }
  },
  leave(ctx) {
    if (S.blackout) onBlackoutEnd();
    S.blackout = false;
    BR.hud.prompt(null);
  },
});
})();

// ============================================================
// 待实现物品（选中版本 items[] 里提到、但 js/items/ 还没有对应文件，本层没有加进 items 表）：
//   撬棍 Crowbar；保暖衣物/备用衣服/合适鞋子；绷带/纱布（bandages.js 已存在但 item-spawn.json 没把 Level 1 划进它的 levels，
//     按规则不擅自加）；刀/斧头；火柴/打火机；头灯/手电筒；纱线；笔记本和笔；手表；手机充电器；睡袋；便携炉具/露营装备；
//   福友玉 Frvyo jades；滋水枪 Squirt Guns；背包；板条箱木板；枪/砍刀；标有 “Mach+” 的 VHS 录像带；老旧电脑/回溯机器（叙事道具，非拾取物）。
//   另外 item-spawn.json 给 Level 1 分配过、但对应 js/items 文件还不存在的：almond_water_blue/green/red（彩色瓶）、
//   lightning_in_a_bottle_artificial/black（另外两种颜色）。
// ============================================================
