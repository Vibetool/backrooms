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
// ---------- 三角面预算（第 16 节：低画质每块 ≤ 8000、高画质 ≤ 10000；这里的账面按低画质算，高画质多出来的细节档见下面 bev/soft）----------
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
// 实际面数 ≤ 账面（低画质、或 kit 自己在 DETAIL_TRI_CAP 以上退回简版时更少），低画质 8000 的上限照样守得住
const KIT_EST = { door: 250, elevator: 165, puddle: 66, desk: 265, deskSmall: 190, chair: 240, cabinet: 135, bed: 125 };
const kitAdj = new WeakMap();
function triCount(b) { return rawTri(b) + (kitAdj.get(b) || 0); }
function kitCall(b, est, fn) {
  const t0 = rawTri(b);
  const out = fn();
  kitAdj.set(b, (kitAdj.get(b) || 0) + est - (rawTri(b) - t0));
  return out;
}
// 水坑：外面那圈干掉的软边水渍印由 kit.prop.puddle 自己画（高画质，rx·rz ≤ 0.7 的水坑都有），这里不再另贴一圈（叠两圈会发黑）
function kitPuddle(b, x, z, opts) { return kitCall(b, KIT_EST.puddle, () => kit.prop.puddle(b, x, z, 0, opts)); }

// ---------- 细节档（用户 2026-10-01：「材质也得跟随着细化，一些方块的角不能太尖锐，一些方块还需要过渡」）----------
// 倒角（b.box 的 bevel）和软边贴花（kit.decal）只在高画质出现：低画质时 kit 退回普通盒、贴花不画（这里画回原来的硬边几何）。
// 记账：一律按"改之前、低画质的面数"入账（倒角盒 = 普通盒、替换掉的硬边几何 = 它原来的面数、新加的贴花 = 0）——
// 账面面数只由种子决定：两种画质摆出来的货架/堆垛/碰撞体逐字节一样（联机），也和改之前一样（账面最多约 7700）。
// 高画质实际面数 = 账面 + D（D = 倒角多出来的 + 贴花 + kit 构件细节档超出 KIT_EST 的部分）。倒角只在 D < EXTRA_CAP 时做，
// 于是高画质 ≤ 7700 + 1350 + 少量余波 < 10000。EXTRA_CAP 取 1350 而不是更大：整块要停在 kit 的 DETAIL_TRI_CAP（9000）以下 ——
// 过了 9000，后建的贴花（地上的油渍、泥土）和 kit 构件 finish 时贴的磨损（水坑外的水渍圈、门边擦痕）都会被截掉（账面 ≥ 7600 的少数块仍会略过）
const EXTRA_CAP = 1350;
const DECAL_MAX = 100;           // 每块自己贴的贴花上限（kit 硬上限 120；kit 构件 finish 时还会贴磨损，实测每块 ≤ 15 片，留余量不触发 warn）
// 贴花分两档：A = 原来就有、换成软边的痕迹（剥漆、水渍、油渍、裂纹、刮痕、泥土……），一片都不许丢，额度用到 DECAL_MAX；
// B = 这次新加的点缀（轮胎印、擦痕、滴痕、拖痕；墙根脏污改用不占额度的渐变带 grimeBand），只在给后面阶段的 A 档留够份额时才画（e.keep[阶段] = 要留几片）。
// 柱子（每块 16 根 × 平均 4 片 ≈ 64 片）是 A 档大头、最先建，B 档都排在柱子后面；后面阶段 A 档要几片按本块柱间种类估（keepFor）
const A_CORE = { wall: 2, passage: 10 }, A_FILL = { grove: 11, open: 1, hut: 1 };   // 每种柱间 A 档贴花片数（墙面水渍 / 裂纹 / 泥土苔藓 / 油渍 / 床垫）
// 核心/填货阶段里还没建的柱间各自的 A 档也要留（keepCore / keepFill 在逐个柱间建的时候更新）
function keepFor(bays) {
  let core = 4, fill = 2;                                // 4：墙上出口门（刮痕 3）、地面出口（泥土 / 碎灰 1）
  for (const bb of bays) { core += A_CORE[bb.type] || 0; fill += A_FILL[bb.type] || 0; }
  return { shell: 99, pillar: 99, misc: core + fill, core: core + fill, fill, deco: 0 };
}
function keepCore(e, bb) { e.keep.core -= A_CORE[bb.type] || 0; }    // 这个柱间建完：它的 A 档不用再留
function keepFill(e, bb) { e.keep.fill -= A_FILL[bb.type] || 0; }
const FLOOR_DECAL = 0.0065;      // 地面贴花离地 6.5 mm：在主通道标线（4）、货位角标（5）、碎灰（6）之上，脚垫（7）、水坑（8–12）之下
// 贴图平均色（解码到线性）：L1:wall 的 concrete.jpg、L1:floor 的 concrete_wet.jpg；kit:prop 的有效底色 = 顶点色 × 0.8。
// 贴花用 srgb: false + 这里算出来的线性色 → 和"顶点色 × 贴图"的墙面、地面是同一套颜色
const CONC_LIN = [0.2326, 0.2231, 0.2097];
const PROP_LIN = 0.8;
const extra = new WeakMap();
// lim：填货阶段每个柱间分到的 D 上限（按柱间胃口摊，免得前几个货架把倒角份额吃光、后面的堆垛一个都倒不了）
// hi：本块已经成功画出过贴花 = 高画质（低画质贴花一片都画不出来）。第一根柱子的第一块剥漆（哥特段八角柱没有剥漆，就是随后的轮胎印）
// 是全块第一片贴花，那时块里 0 片、离 DETAIL_TRI_CAP 很远，高画质一定画得出来 → 从这以后 hi 都判得准
function ext(b) { let e = extra.get(b); if (!e) { e = { tris: 0, decals: 0, hi: false, lim: Infinity, cat: '-', by: {}, lost: {}, keep: {} }; extra.set(b, e); } return e; }
function addExtra(e, n) { e.tris += n; e.by[e.cat] = (e.by[e.cat] || 0) + n; }
// 还没建出来的叉车由占位累加器按"改前那台在这里会建出多少面"算在 rawTri 里（见 forklift）：中间这段时间别的东西倒不倒角和改之前一模一样
function overD(b) { return rawTri(b) - triCount(b); }
function mul3(a, c) { return [a[0] * c[0], a[1] * c[1], a[2] * c[2]]; }
function charge(b, n) { kitAdj.set(b, (kitAdj.get(b) || 0) + n); }
const FACE_N = { all: 6, sides: 4, noBottom: 5, noTop: 5 };
function nFaces(f) { return Array.isArray(f) ? f.length : FACE_N[f || 'all'] || 6; }
// 倒角盒（opts 同 b.box，带 bevel / bevelEdges）。返回 true = 真的倒了角（高画质、D 没到上限、没到 DETAIL_TRI_CAP）
function bev(b, x, y, z, w, h, d, key, opts) {
  const e = ext(b);
  const D = opts.bevel > 0 ? overD(b) : 0;
  const o = D >= Math.min(EXTRA_CAP, e.lim) ? Object.assign({}, opts, { detail: false }) : opts;
  const t0 = rawTri(b);
  b.box(x, y, z, w, h, d, key, o);
  const plain = nFaces(o.faces) * 2, got = rawTri(b) - t0;
  addExtra(e, got - plain);
  charge(b, plain - got);
  return got > plain;
}
// dbox 的倒角版（不出碰撞体）：edges = bevelEdges
function bbox(b, x, y, z, w, h, d, color, faces, bevel, edges, key, rotY) {
  const k = key || 'kit:prop';
  return bev(b, x, y, z, w, h, d, k, { color, solid: false, faces: faces || 'all', rotY, uv: k === 'kit:prop' ? 'stretch' : 'world', bevel, bevelEdges: edges });
}
// 软边贴花。画不了时：低画质画 fallback（原来的硬边几何）；高画质（配额用完、到了 DETAIL_TRI_CAP）这一片干脆不画，
// 免得高画质里软硬两种混着出现。nominal = fallback 的面数（入账用，两种画质一样）；bonus = B 档点缀（见 BONUS_KEEP）
function soft(b, o, nominal, fallback, bonus) {
  const e = ext(b);
  let got = 0, p = null;
  if (e.decals < DECAL_MAX - (bonus ? e.keep[e.cat] || 0 : 0)) {
    const t0 = rawTri(b);
    p = kit.decal(b, o);
    if (p) { e.decals++; e.hi = true; }
    else if (fallback && !e.hi) fallback();
    else if (e.hi) { const k = e.cat + (bonus ? ':B' : ':A') + ':cap'; e.lost[k] = (e.lost[k] || 0) + 1; }
    got = rawTri(b) - t0;
  } else { const k = e.cat + (bonus ? ':B' : ':A') + ':q'; e.lost[k] = (e.lost[k] || 0) + 1; }
  addExtra(e, got - nominal);
  charge(b, nominal - got);
  return p;
}
// 预先取 n 个随机数（和原来硬边几何的取数顺序一致），seq 再按顺序吐出来喂给 fallback
function take(r, n) { const a = []; for (let k = 0; k < n; k++) a.push(r()); return a; }
function seq(a) { let i = 0; return () => a[i++ % a.length]; }
function clampAbs(v, m) { return m <= 0 ? 0 : Math.max(-m, Math.min(m, v)); }
// 从 yTop 往下流到 yBot 的一道软边水痕（朝 +z、贴在 z 处的立面上；顶宽 w、中心 u；flat = 立面平的部分半宽，看得见的部分不出这个范围）。
// 窄（w < 0.13）用 'drip' 格子：主流痕在格子横向 0.55 处、半高宽约 0.23 格宽，竖向 2%–95%；
// 宽的用 'rust' 格子：几道流痕铺在横向 0.16–0.75、源头一团在竖向 2%–17%、流痕到 85%。源头顶到 yTop 上面 2 cm（被上面的托/梁挡住）
function streak(w, yTop, yBot, u, z, flat, color, opacity, maxW) {
  const L = yTop - yBot, narrow = w < 0.13;
  const dw = narrow ? Math.min(0.6, Math.max(0.22, w * 4.3)) : Math.min(maxW || 0.45, Math.max(0.24, w / 0.55));
  const dh = L / (narrow ? 0.93 : 0.85), flip = frac(u * 7.3 + L * 3.1) < 0.5;
  const x = u + (narrow ? -0.05 : 0.045) * dw * (flip ? -1 : 1);   // 流痕不在格子正中：挪回 u
  return { kind: narrow ? 'drip' : 'rust', x: clampAbs(x, flat - 0.32 * dw), y: yTop + 0.02 + 0.02 * dh - dh / 2, z, facing: '+z', w: dw, h: dh,
    color, srgb: false, opacity, flip };
}
// 墙根脏污（"渐变污迹"）：沿当前坐标系 x ∈ [x0, x1]、朝 +z、贴在 z 处的墙面（或墙裙）外面的一条顶点色渐变带。
// 和底下的墙面同一个材质、同一套世界 UV → 纹理逐像素对齐；顶边颜色 = 底下墙面的颜色（base），所以顶边看不出接缝，
// 往下越来越暗（y0 处 × (1 − dark)）：三行顶点 0 / 0.4 / 1，暗度 1 / 0.4 / 0 —— 贴地一段暗得快、往上慢慢淡掉。
// 顶边高度沿墙起伏（每 ~2.4 m 一个控制点，28–50 cm），等暗线跟着起伏，不是一刀切的水平线。
// 原来这里是一排 'stain' 软边贴花，但每块的贴花额度先给柱子的剥漆/水渍（A 档），承重墙一多就轮不到（实测 40 个有承重墙的块里 15 个一片都没画上）；
// 渐变带不占贴花额度、每段只有 4n 个三角面。只在高画质画（低画质照旧没有，和贴花一样）；面数记在细节档 D 上（账面 0，不影响布局）。
// gr：派生流（两种画质取数一样）
function lowQ() { return !!(BR.game && BR.game.settings && BR.game.settings.quality === 'low'); }
const GRIME_ROWS = [0, 0.4, 1], GRIME_DARK = [1, 0.4, 0];
function grimeBand(b, x0, x1, z, y0, base, dark, gr, key) {
  const n = Math.max(1, Math.round((x1 - x0) / 2.4)), hs = [];
  for (let i = 0; i <= n; i++) hs.push(0.28 + 0.22 * gr());
  if (lowQ() || rawTri(b) >= kit.budget.detailCap) return;
  const t0 = rawTri(b);
  const pc = b._piece(key, 0, 0, 0, 0, (v, t) => {
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      for (let j = 0; j < 3; j++) v(x, y0 + hs[i] * GRIME_ROWS[j], z, 0, 0, 1, 0, 0);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, c = a + 3; t(a, c, c + 1); t(a, c + 1, a + 1); }
  }, { color: base, uv: 'world', solid: false });
  // 逐顶点压暗（finish 之前 Piece 的顶点色还在 acc.col 里，Piece.setColor 也是这么改的）
  const col = pc.acc.col;
  for (let i = 0; i <= n; i++) for (let j = 0; j < 3; j++) {
    const k = (pc.start + i * 3 + j) * 3, m = 1 - dark * GRIME_DARK[j];
    col[k] *= m; col[k + 1] *= m; col[k + 2] *= m;
  }
  const got = rawTri(b) - t0;
  addExtra(ext(b), got);
  charge(b, -got);
}
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
// 倒角：地面上的、货架地面一层的托盘倒上棱（1 cm：叠起来的一摞托盘之间出一道 V 形浅槽）；高层货位上的不倒（省面）
function pallet(b, x, y, z, w, d, rot, back, vis) {
  b.push(x, z, rot || 0, y || 0);
  bbox(b, 0, 0, 0, w, 0.13, d, C.pallet, vis ? ['py', 'pz'] : 'noBottom', (vis || 0) < 2 ? 0.01 : 0, 'top');
  const m = Math.max(2, Math.round(w / 0.75)), ow = w / m * 0.6;
  for (let k = 0; k < m; k++) {
    const px = -w / 2 + (k + 0.5) * w / m;
    sheet(b, px, 0.018, d / 2 + 0.003, ow, 0.075, '+z', C.palletGap);
    if (back) sheet(b, px, 0.018, -d / 2 - 0.003, ow, 0.075, '-z', C.palletGap);
  }
  b.pop();
}
// 一垛纸箱：一个大盒子 + 正面的竖缝/横缝 + 顶上的封箱胶带 + 一张标签 —— 看着是 cols×rows 个箱子，只花一个盒子的面数
// 倒角：纸箱棱 1.2 cm（高层货位上的不倒）；倒了角时缝线、胶带缩回到平面部分，不伸到斜面外面悬空
function cartonBlock(b, x, y, z, w, h, d, cols, rows, rot, hs, sides, vis) {
  b.push(x, z, rot || 0, y);
  const col = mulc(C.card, 0.86 + 0.26 * hs());
  const bv = (vis || 0) < 2 && bbox(b, 0, 0, 0, w, h, d, col, VIS_FACES[vis || 0], 0.012) ? 0.012 : 0;
  if (!bv && (vis || 0) >= 2) dbox(b, 0, 0, 0, w, h, d, col, VIS_FACES[vis || 0]);
  const zf = d / 2 + 0.003;
  for (let c = 1; c < cols; c++) sheet(b, -w / 2 + c * w / cols, 0, zf, 0.012, h - bv, '+z', C.seam);
  for (let r = 1; r < rows; r++) {
    sheet(b, 0, r * h / rows - 0.006, zf, w - 2 * bv, 0.012, '+z', C.seam);
    if (sides) {
      sheet(b, w / 2 + 0.003, r * h / rows - 0.006, 0, d - 2 * bv, 0.012, '+x', C.seam);
      sheet(b, -w / 2 - 0.003, r * h / rows - 0.006, 0, d - 2 * bv, 0.012, '-x', C.seam);
    }
  }
  if ((vis || 0) < 2) for (let c = 0; c < cols; c++) sheet(b, -w / 2 + (c + 0.5) * w / cols, h + 0.003, 0, 0.06, d - 2 * bv, 'up', C.tape);
  const lc = Math.floor(hs() * cols), lr = Math.floor(hs() * rows);
  sheet(b, -w / 2 + (lc + 0.5) * w / cols, (lr + 0.35) * h / rows, zf + 0.002, 0.15, 0.1, '+z', C.label);
  b.pop();
}
// 缠膜托盘货：浅蓝灰的一块 + 两道打包带 + 一道反光
// 倒角：缠膜货四条竖棱 4 cm（缠绕膜包出来的本来就是圆角，打包带在面中间，不碰竖棱）
function wrapLoad(b, x, y, z, w, h, d, rot, vis) {
  b.push(x, z, rot || 0, y);
  bbox(b, 0, 0, 0, w, h, d, C.wrap, VIS_FACES[vis || 0], (vis || 0) < 2 ? 0.04 : 0, 'vertical');
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
// 倒角：箱体 12 条棱 2 cm（箍条是钉在外面的木条，方角凸出来，照旧）
function crate(b, x, y, z, w, h, d, rot, color, vis) {
  b.push(x, z, rot || 0, y);
  const c = color || C.crate;
  bbox(b, 0, 0, 0, w, h, d, c, VIS_FACES[vis || 0], 0.02);
  const band = vis ? ['pz', 'px', 'nx'] : 'sides';
  dbox(b, 0, 0.05, 0, w + 0.02, 0.07, d + 0.02, C.crateBand, band);
  dbox(b, 0, h - 0.12, 0, w + 0.02, 0.07, d + 0.02, C.crateBand, band);
  const zf = d / 2 + 0.004;
  facets(b, 'kit:prop', [[[-w / 2 + 0.05, 0.12, zf], [-w / 2 + 0.14, 0.12, zf], [w / 2 - 0.05, h - 0.12, zf], [w / 2 - 0.14, h - 0.12, zf]]], C.crateBand);
  sheet(b, w * 0.18, h * 0.42, zf + 0.002, w * 0.3, h * 0.14, '+z', [0.2, 0.17, 0.13]);
  b.pop();
}
// 周转箱：侧面 + 顶上一块深色（箱口里的阴影）+ 正面一个把手孔
// 倒角：塑料周转箱四条竖棱 1.8 cm（高层货位上的不倒）
function tote(b, x, y, z, w, h, d, color, rot, vis) {
  b.push(x, z, rot || 0, y);
  bbox(b, 0, 0, 0, w, h, d, color, vis ? ['pz', 'px', 'nx'] : 'sides', (vis || 0) < 2 ? 0.018 : 0, 'vertical');
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
  // 梁底两条长棱倒 3.5 cm（梁两头不画端面，所以只有这两条）：斜面朝下斜着接灯光，梁的轮廓不再是刀切的
  const bc = mulc(st.concrete, 0.92);
  for (const L of LINES) {
    bbox(b, SIZE / 2, H - BEAM_D, L, SIZE, BEAM_D, BEAM_W, bc, ['ny', 'pz', 'nz'], 0.035, 'all', 'L1:wall');
    bbox(b, L, H - BEAM_D, SIZE / 2, BEAM_W, BEAM_D, SIZE, bc, ['ny', 'px', 'nx'], 0.035, 'all', 'L1:wall');
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
// 主通道地上的叉车轮胎印（软边贴花，B 档，只在高画质）：两道平行的淡黑拖痕（轮距 0.95 m），每 2.6 m 一段、段与段之间微微拐弯。
// 派生流 'L1-tire'，不吃区块 rng；低画质照样把随机数取完（贴花不画）。柱子之后再画（柱子的 A 档贴花优先）
function tireTracks(b) {
  const r = U.rng(b.seed, b.cx, b.cz, 'L1-tire');
  const n = r() < 0.35 ? 1 : 2;
  for (let t = 0; t < n; t++) {
    const strip = Math.floor(r() * 4);                 // 0/1：沿 x 的两条主通道（z≈2 / z≈30）；2/3：沿 z 的两条（x≈2 / x≈30）
    const c = (strip % 2 ? 29.2 : 1.1) + r() * 1.7;    // 车道中线离区块边 1.1–2.8 m（柱子 3.47 m 起，不压柱脚）
    let a = 1 + r() * 12, ang = (r() - 0.5) * 0.08;
    const segs = 2 + Math.floor(r() * 3), op = 0.5 + r() * 0.2, wid = 0.17 + r() * 0.06;
    for (let k = 0; k < segs; k++) {
      const len = 2.6, turn = (r() - 0.5) * 0.07;
      const a1 = a + Math.cos(ang) * len, dc = Math.sin(ang) * len;
      for (const side of [-0.475, 0.475]) {
        const mid = (a + a1) / 2, cc = c + dc / 2 + side;
        const x = strip < 2 ? mid : cc, z = strip < 2 ? cc : mid;
        // 地面贴花 w 沿本地 x；沿 z 走的车道转 90°。末段淡一点（轮胎上的灰蹭完了）
        soft(b, { kind: 'drag', x, y: 0, z, facing: 'up', w: len + 0.25, h: wid, rot: strip < 2 ? -ang : HALF_PI + ang,
          color: [0.02, 0.019, 0.018], srgb: false, opacity: op * (k === segs - 1 ? 0.6 : 1), offset: FLOOR_DECAL, flip: k % 2 === 1 }, 0, null, true);
      }
      a = a1; ang += turn;
      if (a > 30) break;
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
    bbox(b, 0, H - 0.6, 0, 2 * R + 0.7, 0.14, 2 * R + 0.7, conc, 'noTop', 0.03, 'all', K);
    b.pop();
    return;
  }
  // 倒角（用户 2026-10-01「一些方块的角不能太尖锐」）：柱身四条竖棱 4–5 cm；漆面、漆边线是包在柱身外面的薄层，
  // 倒角跟着放大（漆面 +1 cm、漆边线 +1.5 cm），斜面上也比柱身斜面凸出 7 mm 以上，不共面；柱脚倒上面一圈棱
  // （柱脚只有 22 cm 高，竖棱看不太出来；只倒上棱 +8 面，全倒 +20 面 × 16 根，省下来给货物倒角）
  const h2 = S / 2, rp = S >= 0.8 ? 0.05 : 0.04;
  bbox(b, 0, 0, 0, S + 0.16, 0.22, S + 0.16, mulc(conc, 0.8), 'noBottom', 0.035, 'top', K);
  const round = bev(b, 0, 0, 0, S, H, S, K, { faces: 'sides', color: conc, solid: true, bevel: rp, bevelEdges: 'vertical' });
  // 下段刷漆 + 漆边一道深色线
  bbox(b, 0, 0.22, 0, S + 0.02, bandTop - 0.22, S + 0.02, paint, 'sides', round ? rp + 0.01 : 0, 'vertical', K);
  bbox(b, 0, bandTop, 0, S + 0.03, 0.05, S + 0.03, st.stripe, 'sides', round ? rp + 0.015 : 0, 'vertical', K);
  // 剥落：漆面上露出底下的混凝土。高画质是软边贴花（中间露底、四周渐渐过渡回漆面），低画质照旧是贴在漆面外 3 mm 的不规则小块。
  // 取数顺序和原来一样（同一根柱子的剥落、水渍位置、块数都不变，1–3 块一块不少）。'stain' 格子里的斑只占格子约 60% × 43%、
  // 浓的核心约 1/3，所以贴花边长取原来六边形半径的 4.2 倍：核心 ≈ 原来那块的大小，外面一圈软边淡回漆面
  const nPeel = 1 + Math.floor(r() * 3);
  const flat = h2 - rp;                                  // 漆面上没倒角的平面部分半宽（漆面半宽 h2+0.01、倒角 rp+0.01）
  for (let k = 0; k < nPeel; k++) {
    const f = Math.floor(r() * 4), u = (r() - 0.5) * (S - 0.2), v = 0.35 + r() * (bandTop - 0.55);
    const rx = 0.05 + r() * 0.1, ry = 0.04 + r() * 0.09, zf = h2 + 0.013;
    const rr6 = take(r, 6).map(q => 0.65 + q * 0.5);   // 原来六边形每个角的半径倍率
    const pw = rx * 4.2, ph = ry * 4.2;
    b.push(0, 0, f * HALF_PI);
    soft(b, { kind: 'stain', x: clampAbs(u, flat - pw * 0.3), y: v, z: h2 + 0.01, facing: '+z', w: pw, h: ph, rot: (rr6[0] - 0.9) * 0.8,
      color: mul3(CONC_LIN, conc), srgb: false, opacity: 0.95, variant: rr6[1] < 0.9 ? 0 : 1 }, 4, () => {
      const pts = [];
      for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; pts.push([u + Math.cos(a) * rx * rr6[q], v + Math.sin(a) * ry * rr6[q], zf]); }
      facets(b, K, [pts], conc, [u, v, 0]);
    });
    b.pop();
  }
  // 水渍：从柱帽往下挂的上宽下窄的竖条。高画质每道换成一片软边流痕贴花（1–3 道一道不少）：窄的用 'drip'（一道上浓下淡、末端收尖的水痕），
  // 宽的用 'rust' 格子染成潮混凝土色（源头一团 + 几道往下流的水痕）。源头顶在喇叭口托下沿、上面一截伸进托里被挡住 →
  // 贴着柱帽最深、往下渐渐淡掉，两侧也是一路淡回混凝土。低画质照旧是深色梯形
  const nStain = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nStain; k++) {
    const f = Math.floor(r() * 4), u = (r() - 0.5) * (S - 0.2), w = 0.06 + r() * 0.16;
    const yTop = H - 0.96, yBot = Math.max(bandTop + 0.15, yTop - 0.6 - r() * 1.5), zf = h2 + 0.004;
    b.push(0, 0, f * HALF_PI);
    soft(b, streak(w, yTop, yBot, u, h2, flat, mul3(CONC_LIN, mulc(conc, 0.4)), 0.8), 2, () => {
      facets(b, K, [[[u - w / 2, yTop, zf], [u - w * 0.15, yBot, zf], [u + w * 0.15, yBot, zf], [u + w / 2, yTop, zf]]], mulc(conc, 0.62), [u, 2, 0]);
    });
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
  // 喇叭口托：柱身倒了角时是八个斜面（四个大面 + 四条接着柱身竖棱斜面往上张开的窄面，底口和柱身切角对齐，不留缝），
  // 没倒角（低画质）时照旧四个斜面；入账一律按四个面（8 个三角形）。上面压柱帽板（底面一圈棱倒 2 cm，底面平的部分盖得住喇叭口顶边）
  const a0 = h2, a1 = h2 + 0.25, y0 = H - 0.95, y1 = H - 0.6;
  if (round) {
    const ring = (a, c, y) => [[a - c, y, a], [-(a - c), y, a], [-a, y, a - c], [-a, y, -(a - c)], [-(a - c), y, -a], [a - c, y, -a], [a, y, -(a - c)], [a, y, a - c]];
    const R0 = ring(a0, rp, y0), R1 = ring(a1, rp + 0.1, y1), faces = [];
    for (let k = 0; k < 8; k++) faces.push([R0[k], R0[(k + 1) % 8], R1[(k + 1) % 8], R1[k]]);
    facets(b, K, faces, conc, [0, (y0 + y1) / 2, 0]);
    addExtra(ext(b), 8);
    charge(b, -8);
  } else {
    facets(b, K, [
      [[-a0, y0, a0], [a0, y0, a0], [a1, y1, a1], [-a1, y1, a1]],
      [[a0, y0, -a0], [-a0, y0, -a0], [-a1, y1, -a1], [a1, y1, -a1]],
      [[a0, y0, a0], [a0, y0, -a0], [a1, y1, -a1], [a1, y1, a1]],
      [[-a0, y0, -a0], [-a0, y0, a0], [-a1, y1, a1], [-a1, y1, -a1]],
    ], conc, [0, (y0 + y1) / 2, 0]);
  }
  bbox(b, 0, H - 0.6, 0, S + 0.55, 0.14, S + 0.55, conc, 'noTop', round ? 0.02 : 0, 'horizontal', K);
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
  const e = ext(b);
  for (const bay of list) {
    const w = FILL_WEIGHT[bay.type], mn = FILL_MIN[bay.type] || 0;
    // 倒角份额（只影响高画质的可见几何，不影响账面）：剩下的 D 额度按胃口摊给这个柱间
    const D = overD(b);
    e.lim = D + Math.max(0, EXTRA_CAP - D) * w / wLeft;
    wLeft -= w; minLeft -= mn;
    const used = triCount(b);
    // 先给后面的柱间留足保底，剩下的按胃口比例分；最后 300 面留给墙面挂件和区段点缀
    const left = TRI_BUDGET - 300 - used - minLeft;
    const share = left > 0 ? left * w / (wLeft + w) : 0;
    // 绝对上限：再怎么分也不越过 TRI_BUDGET − 200（单件货最多再冒 ~190 面，最后仍在 8000 以内）
    const cap = Math.min(TRI_BUDGET - 200, used + Math.max(Math.min(mn, Math.max(0, TRI_BUDGET - used - minLeft)), share));
    buildBayFill(b, bay, env, cap);
    keepFill(e, bay);
  }
  e.lim = Infinity;
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
      // 立柱竖棱倒 1.2 cm（8×7 cm 的钢立柱，斜面接光后是一道细亮边）
      bbox(b, x, 0, s * 1.06, 0.08, RACK_H, 0.07, up, 'sides', 0.012, 'vertical');
      dbox(b, x, 0, s * 0.14, 0.08, RACK_H, 0.07, up, ['px', 'nx', s > 0 ? 'pz' : 'nz']);   // 背立柱：朝另一半货架那面（21 cm 缝里）看不见；藏在货后面，不倒角
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
        // 横梁：朝通道的正面 + 底面，低的那根顶面也看得见；正面上下两条长棱倒 1 cm
        bbox(b, xc, lv - 0.1, s * 1.06, L - 0.08, 0.1, 0.05, beam, li === 0 ? ['py', 'ny', s > 0 ? 'pz' : 'nz'] : ['ny', s > 0 ? 'pz' : 'nz'], 0.01);
        dbox(b, xc, lv, s * 0.6, L - 0.08, 0.02, 0.9, C.deck, ['py']);
        if (li === 0) sheet(b, xc, lv + 0.023, s * 0.6, 0.02, 0.88, 'up', mulc(C.deck, 0.6));   // 钢丝网层板的纵筋（高层看不见）
      });
      // 货位标签条（横梁正面，一小块白色）
      sheet(b, xc - L * 0.3, RACK_LEVELS[0] - 0.08, s * 1.088, 0.12, 0.06, s > 0 ? '+z' : '-z', C.label);
    }
  }
  // 排头护栏（黄色钢板 + 黑色压顶）：顶面被压顶盖住、朝货架那面贴着端框，都不画；护栏两条外竖棱倒 2 cm
  for (const e of [-1, 1]) {
    bbox(b, e * (len / 2 + 0.17), 0, 0, 0.1, 0.42, 2.3, C.yellow, [e > 0 ? 'px' : 'nx', 'pz', 'nz'], 0.02, 'vertical');
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
  // 油渍：高画质是软边油渍贴花（实心油斑 + 外圈一层淡淡渗开的油晕，边缘一路淡到地面，不是一刀切的多边形）；
  // 低画质照旧：外圈淡油印（6 mm）+ 里面更黑的油心（7 mm）。取数顺序和原来一样（外圈 9 个、油心偏移 2 个 + 8 个），入账按两块多边形 7 + 6 面。
  // 有出口的空柱间不画（出口自带地面细节：门前脚垫 7 mm、碎灰、泥土圈）
  {
    const ox = (r() - 0.5) * 5, oz = (r() - 0.5) * 5, orx = 0.5 + r() * 0.6, orz = 0.4 + r() * 0.4;
    if (!bay.exits.length) {
      const h0 = take(r, 9), dx = (r() - 0.5) * 0.2, dz = (r() - 0.5) * 0.2, h1 = take(r, 8);
      (b.data.oil || (b.data.oil = [])).push(b.world(ox, oz));   // 自测找机位用
      soft(b, { kind: 'oil', x: ox, y: 0, z: oz, facing: 'up', w: orx * 2.3, h: orz * 2.3, rot: h0[0] * TAU, opacity: 0.6 + h0[1] * 0.25, offset: FLOOR_DECAL }, 13, () => {
        blot(b, ox, oz, orx, orz, 9, [0.13, 0.128, 0.12], seq(h0));
        blot(b, ox + dx, oz + dz, orx * 0.55, orz * 0.55, 8, [0.07, 0.069, 0.066], seq(h1), 0.007);
      });
      // 油渍边上一两道拖出去的油脚印/轮印（只在高画质，新加的不入账）
      soft(b, { kind: 'drag', x: ox + Math.cos(h0[2] * TAU) * orx * 1.3, y: 0, z: oz + Math.sin(h0[2] * TAU) * orz * 1.3, facing: 'up', w: 1.0 + h0[3], h: 0.14,
        rot: -h0[2] * TAU, color: 0x161412, opacity: 0.3, offset: FLOOR_DECAL }, 0, null, true);
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
    if (r() < 0.8) { bbox(b, x, 0, -2.6, 1.6, 0.12, 0.18, [0.62, 0.6, 0.56], 'noBottom', 0.03, 'all', 'L1:wall'); b.solid(x - 0.8, 0, -2.69, x + 0.8, 0.12, -2.51); }   // 车轮挡棱倒 3 cm
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
// ---------- 叉车 ----------
// 用户 2026-10-02：「level1 的叉车车身细节不够」→ 照仓库里最常见的平衡重式叉车（内燃 · 液化气）重做；紧接着又要「叉车能开、能举东西」——
// 这次只做模型，但按"会动的部分"拆开写（forkliftModel 的 part），各部分的枢轴 / 局部原点都在 FORKLIFT_GEO 里，以后做可驾驶的叉车原样拿去用：
//   body（车身，不动）：深灰底盘；黄色钣金 —— 包住前轮上半的翼子板（里面一块深灰挡泥内板）、侧裙 + 黑色防滑上车踏板、驾驶位橡胶地台、
//     仪表台（斜面上仪表板 + 表、右边一排液压操纵杆、转向柱）、发动机盖（前上角斜切，两侧散热百叶 + 车身编号）、铭牌；
//     后部圆角的铸铁配重（顶上散热格栅、后面黄黑警示条、两个尾灯、牵引销）；横放在配重上的液化气瓶（托架、箍带、阀门、接进发动机盖的软管）；
//     座椅（减震底座、坐垫、靠背、橙色安全带 + 卷收器 + 锁扣）；护顶架（四根斜立柱、四根边梁、顶上一排格栅横条）、两个前大灯、
//     顶上黄色警示灯、左前立柱上的上车扶手、后视镜；两根倾斜油缸（缸筒尾端在仪表台前脸，活塞杆接外门架的耳座）
//   wheelsFront / wheelsRear：前轮大（驱动）后轮小（转向）；胎面（花纹块）+ 胎肩 + 胎侧 + 轮辋 + 轮毂盖
//   steeringWheel：轮圈 + 辐条 + 中心盖 + 助力球
//   mastOuter：两根立柱、顶梁、坐在车架前面的底座、两根起升油缸缸筒、链条锚座、倾斜油缸耳座
//   mastInner：两根立柱（套在外门架里）、顶梁、底梁、起升油缸活塞杆 + 杆头、顶上两个链轮
//   carriage：货叉架上下横梁 + 链条挂点、两个滚轮架（把上下横梁连起来、后端贴着内门架立柱前脸滑）、挡货架（格栅）、两根 L 形货叉（叉根圆角、叉尖削薄）+ 挂钩
//   chains：前段（货叉架挂点 → 链轮前缘）、后段（外门架锚座 → 链轮后缘），长度随升降变
// 没有任何品牌名或商标（车身上只有编号）。
//
// 车身坐标：原点 = 车底投影中心的地面；−z = 车头（门架、货叉），+z = 车尾（配重）；+x = 坐在座椅上的人的右手边。
// 以后做"能开、能举东西"的叉车：每个部分按 lift = 0、steer = 0 各建一份（forkliftModel 的 part），然后
//   内门架整体上移 pose(lift).inner、货叉架整体上移 pose(lift).carriage（两级门架：起升油缸顶着内门架，链条一头锚在外门架上、
//   绕过内门架顶上的链轮、另一头挂货叉架 —— 内门架升 d，货叉架升 2d），链条按 lift 重建（forkliftModel part 'chains'，或前 / 后段各沿 y 缩放）；
//   后轮各绕自己的转向主销（过轮心的竖直轴 wheelRear）转 steer（叉车是后轮转向）；前轮绕轮心的 x 轴滚；
//   方向盘绕自己的轴线转 steer × steerRatio；司机眼点 eye；货叉尖 forkTip（叉托盘用）；门架前后倾绕 mastPivot
const FORKLIFT_GEO = {
  wheelFront: { x: 0.48, y: 0.29, z: -0.62, r: 0.29, w: 0.2 },     // 驱动轮轮心（±x 对称）
  wheelRear: { x: 0.44, y: 0.23, z: 0.8, r: 0.23, w: 0.16 },       // 转向轮轮心 = 转向主销（竖直轴）位置
  mastPivot: { y: 0.1, z: -0.87 },          // 外门架底座铰点（门架前后倾时绕这条 x 轴转；倾斜油缸前端在外门架耳座 tiltEye）
  tiltEye: { x: 0.42, y: 0.98, z: -0.97 },  // 倾斜油缸活塞杆端（外门架上）；缸筒尾端在仪表台前脸 tiltBase
  tiltBase: { x: 0.42, y: 0.7, z: -0.8 },
  mastOuterTop: 2.06,                       // 外门架顶
  mastInnerTop: 2.12,                       // 内门架顶（lift = 0；lift = 1 时 3.42，仍在梁底 3.55 以下）
  innerTravel: 1.3,                         // 内门架最大伸出量
  carriageY: 0.08,                          // 货叉架下横梁底（lift = 0）
  carriageMin: 0.08, carriageMax: 2.68,     // 货叉架下横梁底的最低 / 最高（= carriageY + 2 × innerTravel）。挡货架顶比它高 1.16：升满时 3.84，开到梁下面别升满
  forkY: 0.015,                             // 货叉水平段底面（lift = 0；升到顶 = forkY + 2 × innerTravel ≈ 2.62，够得着第二层货架 2.3）
  forkTip: { x: 0.28, z: -2.1 },            // 货叉尖（±x 两根，宽 0.1、厚 4 cm）
  forkHeel: -1.16,                          // 货叉竖直段前面（托盘最多插到这里）
  sprocket: { x: 0.12, y: 2.09, z: -1.01, r: 0.035 },   // 链轮（内门架上，lift = 0）
  chain: { z: -1.045, back: -0.975, anchorY: 1.94, carriageY: 0.58 },   // 链条前段 / 后段的 z、外门架锚座高度、货叉架挂点顶（lift = 0）
  steerWheel: { x: 0, y: 1.25, z: -0.5, tilt: 0.55, r: 0.16 },        // 方向盘中心；轴线从竖直往车尾倒 tilt 弧度
  steerRatio: 6,                            // 方向盘转角 = 后轮转角 × steerRatio
  seat: { y: 1.16, z: 0.24 },               // 坐垫顶面中心
  eye: { x: 0, y: 1.8, z: 0.16 },           // 司机眼点
  guardTop: 2.1,                            // 护顶架顶
  half: { x: 0.6, z: 1.3, h: 2.15 },        // 碰撞盒半宽 / 半长 / 高（车身，不含伸到前面的货叉）
  pose(lift) {
    const d = Math.max(0, Math.min(1, +lift || 0)) * FORKLIFT_GEO.innerTravel;
    return { inner: d, carriage: 2 * d };
  },
};
const FK = {
  body: [0.86, 0.66, 0.12], chassis: [0.15, 0.15, 0.16], cw: [0.17, 0.17, 0.18], black: [0.07, 0.07, 0.075],
  mast: [0.12, 0.12, 0.13], mastIn: [0.16, 0.16, 0.17], fork: [0.22, 0.22, 0.23], tire: [0.1, 0.1, 0.1], lug: [0.055, 0.055, 0.055],
  rim: [0.66, 0.66, 0.63], hub: [0.3, 0.3, 0.31], seat: [0.1, 0.1, 0.11], mat: [0.085, 0.085, 0.085],
  belt: [0.95, 0.42, 0.08], amber: [1.05, 0.58, 0.1], lens: [0.95, 0.94, 0.86], tail: [0.62, 0.07, 0.05],
  tank: [0.62, 0.64, 0.66], brass: [0.75, 0.58, 0.27], chrome: [0.8, 0.82, 0.84], steel: [0.48, 0.5, 0.53],
  plate: [0.8, 0.81, 0.82], glass: [0.42, 0.5, 0.56], chain: [0.16, 0.16, 0.16], link: [0.36, 0.35, 0.33],
  gauge: [0.62, 0.62, 0.6], hose: [0.05, 0.05, 0.05], rib: [0.15, 0.15, 0.15], digit: [0.05, 0.05, 0.05],
};
// 细节档。high / mid / lite / low 的轮廓和部件都一样（车身钣金、翼子板、配重、气瓶、座椅、护顶架、灯、两级门架 + 起升油缸（缸筒、活塞杆、杆头）、
// 链轮 + 链轮轴、前后两段链条、货叉架 + 滚轮架 + 挡货架 + 货叉、倾斜油缸、四个轮子、方向盘、两侧百叶和车身编号）；
// 差别在倒角、圆的段数、格栅根数、看不太见的面，和小点缀（后视镜、扶手撑、安全带卷收器、气瓶封头 / 箍带 / 软管、链板、牵引钳口……）。
// 一块里放不下时再往下退的 lowb / min 见下面。面数见 fkTris（车身编号按最费面的 "88" 算）。挑档见 buildForklifts：
//   高画质：high → mid → lite → low → lowb → min，整块实际面数放得下的最细一档；低画质：low → lowb → min（不倒角、不贴花）。
//   wf / wr = 前 / 后轮 [一圈段数, 胎截面边数]；ring = 方向盘 [轮圈段数, 管截面段数]；cw = 配重俯视轮廓点数；ch / cwC / backC = 端面斜角（米）；
//   其余是数量（根数、段数）或开关
const FK_LOD = {
  high: { bev: true, ch: 0.025, cwC: 0.04, cw: 10, backC: 0.02, fendU: true, fendP: true, wf: [10, 2], wr: [8, 2], hub: 5, hubR: true, ring: [10, 3], spokes: 3, swHub: 5, knob: 4,
    slats: 5, slatF: ['py', 'ny', 'pz', 'nz'], back: [-0.27, 0, 0.27], midRail: true, louvers: 3, ribs: 3, grille: 5, digits: 2,
    plate: 3, gauges: 2, levers: 3, knobs: true, mirror: true, lampF: ['py', 'ny', 'px', 'nx', 'nz'], beacon: 6, beaconBase: true,
    cyl: 6, cylCap: true, rod: 5, rods: true, column: 6, tank: 8, domes: true, straps: true, valve: true, hose: true, links: 0.12, backChain: true,
    sprocket: 6, axle: true, heads: true, ears: true, tilt: 2, hitch: 1, belt: 3, heel: true, tip: true, hook: true, ridges: true, step: true, matSides: true,
    tails: true, handle: 2, seatBase: true, guardEnds: true, posts: 'noBottom', bracket: true, decals: 10 },
  mid: { bev: true, ch: 0.02, cwC: 0.03, cw: 8, backC: 0, fendU: false, fendP: true, wf: [8, 2], wr: [8, 2], hub: 4, hubR: false, ring: [8, 3], spokes: 2, swHub: 5, knob: 0,
    slats: 3, slatF: ['py', 'ny'], back: [-0.27, 0.27], midRail: false, louvers: 3, ribs: 2, grille: 3, digits: 2,
    plate: 1, gauges: 1, levers: 2, knobs: true, mirror: false, lampF: ['py', 'px', 'nx', 'nz'], beacon: 6, beaconBase: false,
    cyl: 5, cylCap: true, rod: 4, rods: true, column: 5, tank: 8, domes: false, straps: false, valve: true, hose: false, links: 0, backChain: true,
    sprocket: 5, axle: true, heads: true, ears: true, tilt: 2, hitch: 0, belt: 2, heel: false, tip: true, hook: true, ridges: false, step: true, matSides: false,
    tails: false, handle: 1, seatBase: true, guardEnds: true, posts: 'noBottom', bracket: true, decals: 6 },
  low: { bev: false, ch: 0, cwC: 0, cw: 8, backC: 0, fendU: false, fendP: false, wf: [8, 1], wr: [8, 1], hub: 0, hubR: false, ring: [6, 3], spokes: 2, swHub: 0, knob: 0,
    slats: 2, slatF: ['py', 'ny'], back: [-0.27, 0.27], midRail: false, louvers: 2, ribs: 0, grille: 0, digits: 2,
    plate: 0, gauges: 0, levers: 1, knobs: false, mirror: false, lampF: ['py', 'nz'], beacon: 5, beaconBase: false,
    cyl: 4, cylCap: false, rod: 4, rods: true, column: 4, tank: 8, domes: false, straps: false, valve: false, hose: false, links: 0, backChain: true,
    sprocket: 5, axle: true, heads: true, ears: false, tilt: 1, hitch: 0, belt: 0, heel: false, tip: false, hook: false, ridges: false, step: false, matSides: false,
    tails: false, handle: 0, seatBase: false, guardEnds: false, posts: 'sides', bracket: true, decals: 0 },
};
// lite：高画质里一块挤了两三台叉车、连 mid 都放不下时用 —— low 的几何 + 倒角（和高画质别的东西一样是圆边）+ 扶手、安全带、倾斜油缸耳座、几片磨损
FK_LOD.lite = Object.assign({}, FK_LOD.low, { bev: true, ch: 0.02, cwC: 0.03, handle: 1, belt: 1, ears: true, tilt: 2, decals: 4 });
// 一块里放不下 low 时往下退（两种画质都可能用到）。trim = 省掉站着看不见或很窄的面（侧裙前后端、翼子板两头的端面、轮胎贴着车架那面、
// 地台前沿、配重用六边形、靠背不收角、门架 / 货叉架横梁只画朝外的面），气瓶不要托架、直接落在配重顶上。
//   lowb：会动部件之间的关系件都还在（起升油缸 + 活塞杆 + 杆头、链轮 + 轴、前后两段链条、滚轮架、倾斜油缸、百叶），编号只喷右边
//   min：最后的保底，只剩轮廓（车身、翼子板、配重、气瓶、护顶架、座椅、两级门架、货叉架 + 滚轮架 + 货叉、链条、轮子、方向盘）
FK_LOD.lowb = Object.assign({}, FK_LOD.low, { trim: true, cw: 6, wr: [6, 1], ring: [6, 2], digits: 1, tank: 6, slats: 0, back: [], levers: 0 });
FK_LOD.min = Object.assign({}, FK_LOD.lowb, { wf: [6, 1], louvers: 0, digits: 0, lampF: null,
  cyl: 0, rods: false, column: 3, backChain: false, sprocket: 0, axle: false, heads: false, tilt: 0 });

// ---- 叉车用的几何小工具（全部进 kit:prop、不出碰撞体）----
// 倒角盒：这一档要倒角时直接走 kit 的切角实现（叉车在整块最后按剩余额度挑档，不再看 DETAIL_TRI_CAP）
function fkBox(b, L, x, y, z, w, h, d, color, faces, r, edges) {
  const o = { color, solid: false, faces: faces || 'all', uv: 'stretch' };
  if (r > 0 && L.bev) { const p = b._bevelBox(x, y, z, w, h, d, 'kit:prop', Object.assign({ bevel: r, bevelEdges: edges }, o)); if (p) return p; }
  return b.box(x, y, z, w, h, d, 'kit:prop', o);
}
// 凸多边形截面沿一根轴拉伸成棱柱（车身钣金、配重、货叉、立柱都用它）。
// poly = [[u, v], ...]（凸，任意绕向）；axis 'x'：(u, v) = (z, y)；'y'：(u, v) = (x, z)；'z'：(u, v) = (x, y)；沿轴从 a0 到 a1。
// o.c0 / o.c1：a0 / a1 端面一圈棱倒 45° 斜角（米）；o.cap0 / o.cap1 = false：不画那个端面（贴着别的零件、永远看不见）；
// o.skip：不画的侧面（截面边序号，边 i = 点 i → 点 i+1；贴着别的零件的面），这几条边上也不倒角
function fkPrism(b, poly, axis, a0, a1, color, o) {
  o = o || {};
  const n = poly.length, skip = o.skip || [], on = i => skip.indexOf(i) < 0;
  let ar = 0, cu = 0, cv = 0;
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; ar += p[0] * q[1] - q[0] * p[1]; cu += p[0] / n; cv += p[1] / n; }
  const sg = ar > 0 ? 1 : -1;
  const M = axis === 'x' ? (u, v, a) => [a, v, u] : axis === 'y' ? (u, v, a) => [u, a, v] : (u, v, a) => [u, v, a];
  const N = [];   // 每条边的内法线
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n], du = q[0] - p[0], dv = q[1] - p[1], l = Math.hypot(du, dv) || 1;
    N.push([-dv / l * sg, du / l * sg]);
  }
  // 端面往里缩：每条边按自己的倒角量平移（skip 的边不动），相邻两条平移线的交点
  const inset = c => poly.map((p, i) => {
    const ia = (i + n - 1) % n, A = N[ia], B = N[i], da = on(ia) ? c : 0, db = on(i) ? c : 0;
    const det = A[0] * B[1] - A[1] * B[0];
    if (Math.abs(det) < 1e-9) return [p[0] + A[0] * da, p[1] + A[1] * da];
    return [p[0] + (da * B[1] - db * A[1]) / det, p[1] + (A[0] * db - B[0] * da) / det];
  });
  const cap0 = o.cap0 !== false, cap1 = o.cap1 !== false;
  const sd = a1 > a0 ? 1 : -1;
  const c0 = cap0 && o.c0 > 0 ? o.c0 : 0, c1 = cap1 && o.c1 > 0 ? o.c1 : 0;
  const b0 = a0 + sd * c0, b1 = a1 - sd * c1, F = [];
  for (let i = 0; i < n; i++) if (on(i)) {
    const p = poly[i], q = poly[(i + 1) % n];
    F.push([M(p[0], p[1], b0), M(q[0], q[1], b0), M(q[0], q[1], b1), M(p[0], p[1], b1)]);
  }
  const end = (c, a, bb) => {
    const P = c > 0 ? inset(c) : poly;
    if (c > 0) for (let i = 0; i < n; i++) if (on(i)) {
      const j = (i + 1) % n;
      F.push([M(poly[i][0], poly[i][1], bb), M(poly[j][0], poly[j][1], bb), M(P[j][0], P[j][1], a), M(P[i][0], P[i][1], a)]);
    }
    F.push(P.map(p => M(p[0], p[1], a)));
  };
  if (cap0) end(c0, a0, b0);
  if (cap1) end(c1, a1, b1);
  return facets(b, 'kit:prop', F, color, M(cu, cv, (a0 + a1) / 2));
}
// 开口折线 P（[u, v]）往 toward 那一侧平移 t（中间的拐点按两条边的平移线求交）：翼子板的内表面
function fkOffsetLine(P, t, toward) {
  const N = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const du = P[i + 1][0] - P[i][0], dv = P[i + 1][1] - P[i][1], l = Math.hypot(du, dv) || 1;
    let nn = [-dv / l, du / l];
    if (nn[0] * (toward[0] - (P[i][0] + P[i + 1][0]) / 2) + nn[1] * (toward[1] - (P[i][1] + P[i + 1][1]) / 2) < 0) nn = [-nn[0], -nn[1]];
    N.push(nn);
  }
  return P.map((p, i) => {
    const A = N[Math.max(0, i - 1)], B = N[Math.min(N.length - 1, i)], det = A[0] * B[1] - A[1] * B[0];
    if (Math.abs(det) < 1e-9) return [p[0] + A[0] * t, p[1] + A[1] * t];
    return [p[0] + (t * B[1] - t * A[1]) / det, p[1] + (A[0] * t - B[0] * t) / det];
  });
}
// 两点间的圆管（油缸、活塞杆、转向柱、软管、气瓶）：侧面法线光滑；o.r1 = B 端半径（锥台），o.cap0 / o.cap1 = 画 A / B 端的盖；
// o.arc = [k0, k1]：只画第 k0..k1 段（箍带只包气瓶露在外面的上半圈）。第 k 段从 e1 转到 e2，管轴接近水平时 e1 = 轴 × 竖直、e2 = 轴 × e1
function fkTube(b, A, B, r, seg, color, o) {
  o = o || {};
  const d = norm3(sub3(B, A)), up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm3(cross3(d, up)), e2 = cross3(d, e1), r1 = o.r1 != null ? o.r1 : r, n = seg || 8;
  const k0 = o.arc ? o.arc[0] : 0, k1 = o.arc ? o.arc[1] : n;
  const dir = k => { const a = k / n * TAU, c = Math.cos(a), s = Math.sin(a); return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]; };
  return b._piece('kit:prop', 0, 0, 0, 0, (v, t) => {
    for (let k = k0; k <= k1; k++) {
      const m = dir(k);
      v(A[0] + m[0] * r, A[1] + m[1] * r, A[2] + m[2] * r, m[0], m[1], m[2], 0, 0);
      v(B[0] + m[0] * r1, B[1] + m[1] * r1, B[2] + m[2] * r1, m[0], m[1], m[2], 0, 0);
    }
    for (let k = 0; k < k1 - k0; k++) { const a = 2 * k; t(a, a + 2, a + 3); t(a, a + 3, a + 1); }
    let base = 2 * (k1 - k0 + 1);
    if (o.arc) return;
    for (const [want, C, rr, sgn] of [[o.cap0, A, r, -1], [o.cap1, B, r1, 1]]) {
      if (!want) continue;
      for (let k = 0; k < n; k++) { const m = dir(k); v(C[0] + m[0] * rr, C[1] + m[1] * rr, C[2] + m[2] * rr, d[0] * sgn, d[1] * sgn, d[2] * sgn, 0, 0); }
      for (let k = 1; k + 1 < n; k++) if (sgn > 0) t(base, base + k, base + k + 1); else t(base, base + k + 1, base + k);
      base += n;
    }
  }, { color, uv: 'stretch', solid: false });
}
// 竖直的圆管（警示灯、链轮）：底面圆心 (x, y, z)、高 h；caps 同 fkTube
function fkPost(b, x, y, z, r, h, seg, color, o) { return fkTube(b, [x, y, z], [x, y + h, z], r, seg, color, o); }
// 圆环（方向盘轮圈）：圆心 C、轴线 ax（单位向量）、环半径 R、管半径 r，N × M 个四边形，法线光滑
function fkRing(b, C, ax, R, r, N, Mm, color, e1) {
  const u = e1 || norm3(cross3(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = cross3(ax, u);
  return b._piece('kit:prop', 0, 0, 0, 0, (v, t) => {
    for (let i = 0; i <= N; i++) for (let j = 0; j <= Mm; j++) {
      const th = i / N * TAU, ph = (j + 0.5) / Mm * TAU, ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
      const rho = [u[0] * ct + w[0] * st, u[1] * ct + w[1] * st, u[2] * ct + w[2] * st];
      const nn = [rho[0] * cp + ax[0] * sp, rho[1] * cp + ax[1] * sp, rho[2] * cp + ax[2] * sp];
      v(C[0] + rho[0] * R + nn[0] * r, C[1] + rho[1] * R + nn[1] * r, C[2] + rho[2] * R + nn[2] * r, nn[0], nn[1], nn[2], 0, 0);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < Mm; j++) { const a = i * (Mm + 1) + j, c = a + Mm + 1; t(a, c, c + 1); t(a, c + 1, a + 1); }
  }, { color, uv: 'stretch', solid: false });
}
// 绕 x 轴的回转面（轮胎）：截面折线 prof = [[半径, x], ...]（x 相对轮心），一圈 S 段；绕轴方向法线光滑。
// cols[k]：第 k 条截面边的颜色，或 [颜色 A, 颜色 B] = 相邻段交替（胎面花纹块）；inside：截面里面一点 [半径, x]（定法线朝外）
function fkLathe(b, C, prof, S, cols, inside) {
  const groups = new Map();
  for (let k = 0; k + 1 < prof.length; k++) {
    const r0 = prof[k][0], x0 = prof[k][1], r1 = prof[k + 1][0], x1 = prof[k + 1][1];
    let nr = x1 - x0, nx = -(r1 - r0);
    const l = Math.hypot(nr, nx) || 1;
    nr /= l; nx /= l;
    if (nr * ((r0 + r1) / 2 - inside[0]) + nx * ((x0 + x1) / 2 - inside[1]) < 0) { nr = -nr; nx = -nx; }
    for (let j = 0; j < S; j++) {
      const c = Array.isArray(cols[k][0]) ? cols[k][j % 2] : cols[k];
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push([r0, x0, r1, x1, nr, nx, j]);
    }
  }
  groups.forEach((qs, col) => b._piece('kit:prop', 0, 0, 0, 0, (v, t) => {
    let i = 0;
    for (const [r0, x0, r1, x1, nr, nx, j] of qs) {
      const a0 = j / S * TAU, a1 = (j + 1) / S * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const q = [[C[0] + x0, C[1] + r0 * c0, C[2] + r0 * s0, nx, nr * c0, nr * s0], [C[0] + x0, C[1] + r0 * c1, C[2] + r0 * s1, nx, nr * c1, nr * s1],
        [C[0] + x1, C[1] + r1 * c1, C[2] + r1 * s1, nx, nr * c1, nr * s1], [C[0] + x1, C[1] + r1 * c0, C[2] + r1 * s0, nx, nr * c0, nr * s0]];
      for (const p of q) v(p[0], p[1], p[2], p[3], p[4], p[5], 0, 0);
      // 正反面：让三角形的几何法线和这一段中间的法线同向
      const g = cross3(sub3(q[1], q[0]), sub3(q[2], q[0])), cm = Math.cos((a0 + a1) / 2), sm = Math.sin((a0 + a1) / 2);
      if (g[0] * nx + g[1] * nr * cm + g[2] * nr * sm >= 0) { t(i, i + 1, i + 2); t(i, i + 2, i + 3); } else { t(i, i + 2, i + 1); t(i, i + 3, i + 2); }
      i += 4;
    }
  }, { color: col, uv: 'stretch', solid: false }));
}
// 垂直于 x 轴的正多边形圆盘（轮辋、轮胎内侧），正面朝 side·x；顶点和同段数的 fkLathe 对齐
function fkDisc(b, cx, cy, cz, r, n, color, side) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * TAU; pts.push([cx, cy + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return facets(b, 'kit:prop', [pts], color, [cx - side, cy, cz]);
}
// 竖直面（法线 ±z）上一块平面多边形的点 [x, y] → 只留 s·(x − xc) ≥ 0 的部分（警示条裁到带子里）
function fkClip(poly, xc, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = s * (p[0] - xc), dq = s * (q[0] - xc);
    if (dp >= 0) out.push(p);
    if (dp * dq < 0) { const k = dp / (dp - dq); out.push([xc, p[1] + (q[1] - p[1]) * k]); }
  }
  return out;
}
// 黄黑警示条：z = zf、朝 +z 的竖直面上，x0..x1 × y0..y1 的带子里一排 45° 斜条（条宽 wd，底色是配重本身的深灰）
function fkStripes(b, x0, x1, y0, y1, zf, wd, color) {
  const h = y1 - y0, F = [];
  for (let xs = x0 - h; xs < x1; xs += 2 * wd) {
    const p = fkClip(fkClip([[xs, y0], [xs + wd, y0], [xs + wd + h, y1], [xs + h, y1]], x0, 1), x1, -1);
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    if (p.length >= 3 && Math.abs(a) > 1e-4) F.push(p.map(q => [q[0], q[1], zf]));
  }
  if (F.length) facets(b, 'kit:prop', F, color, [(x0 + x1) / 2, (y0 + y1) / 2, zf - 0.1]);
}
// 车身编号：两位数、7 段数码字形（黑漆喷在黄色侧面上）。side = ±1：x = side·xs 的侧面，从外面看左读到右；(zc, y0) = 号码底边中点，H = 字高
const FK_SEG7 = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
// 字形：a / d 横笔占满整个字宽；左右两根竖笔夹在 a、d 之间，上下两段在半高处接上（g 不亮的 0、1、7 竖笔也是连着的）；
// g 夹在两根竖笔之间。同一根竖笔上下两段都亮时合成一块（少两个三角形）。各笔只在边上相接，不重叠、不共面
function fkNumber(b, num, side, xs, zc, y0, H, color) {
  const W = H * 0.5, t = H * 0.14, hh = H / 2 - t, str = String(num).padStart(2, '0'), dir = -side, xv = (W - t) / 2;
  for (let i = 0; i < str.length; i++) {
    const uc = (i - (str.length - 1) / 2) * W * 1.45, on = FK_SEG7[+str[i]], S = [];
    if (on.includes('a')) S.push([0, H - t, W, t]);
    if (on.includes('d')) S.push([0, 0, W, t]);
    if (on.includes('g')) S.push([0, (H - t) / 2, W - 2 * t, t]);
    for (const [x, up, dn] of [[-xv, 'f', 'e'], [xv, 'b', 'c']]) {
      const u = on.includes(up), d = on.includes(dn);
      if (u && d) S.push([x, t, t, H - 2 * t]);
      else if (u) S.push([x, H / 2, t, hh]);
      else if (d) S.push([x, t, t, hh]);
    }
    for (const s of S) sheet(b, side * xs, y0 + s[1], zc + dir * (uc + s[0]), s[2], s[3], side > 0 ? '+x' : '-x', color);
  }
}

// ---- 车身（不动的部分）----
function fkBody(b, L, o) {
  const G = FORKLIFT_GEO, K = FK, WF = G.wheelFront, M = !!L.trim;
  // 底盘（深灰）：前脸 z = −0.80（外门架底座贴在这里）。顶面全被地台 / 发动机盖盖住、后头埋进配重，只画两侧和前脸
  dbox(b, 0, 0.12, 0.13, 0.68, 0.46, 1.86, K.chassis, ['px', 'nx', 'nz']);
  for (const s of [-1, 1]) {
    // 侧裙（踏板下面那段车身）：外侧、顶、前、后四面，顶上一圈棱倒 3 cm
    fkBox(b, L, s * 0.445, 0.14, 0.12, 0.21, 0.26, 0.84, K.body, M ? [s > 0 ? 'px' : 'nx', 'py'] : [s > 0 ? 'px' : 'nx', 'py', 'pz', 'nz'], 0.03, 'top');
    // 上车踏板：前轮后面、发动机盖前面那一段侧裙顶上的黑色防滑板（+ 两道防滑棱）。低档只画顶面，压低到离侧裙顶 3 mm（不悬空）
    dbox(b, s * 0.46, 0.4, -0.19, 0.12, L.step ? 0.012 : 0.003, 0.16, K.black, L.step ? 'noBottom' : ['py']);
    if (L.ridges) for (const dz of [-0.04, 0.04]) sheet(b, s * 0.46, 0.415, -0.19 + dz, 0.11, 0.012, 'up', K.steel);
  }
  // 驾驶位地台：橡胶垫（后面贴着发动机盖前脸，那一面不画）+ 横向防滑棱
  dbox(b, 0, 0.585, -0.44, 0.74, 0.03, 0.68, K.mat, L.matSides ? ['py', 'px', 'nx', 'nz'] : M ? ['py'] : ['py', 'nz']);
  for (let k = 0; k < L.ribs; k++) sheet(b, 0, 0.618, -0.46 + k * 0.1, 0.62, 0.016, 'up', K.rib);
  // 前翼子板：2.5 cm 厚的钣金折成"斜 — 平 — 斜"三段包住前轮上半；里面一块深灰挡泥内板把它和车架、侧裙连起来。
  // 朝里的端面贴着仪表台 / 车架，不画；低档不画翼子板底面（朝着轮胎、站着看不见）和挡泥内板（后面就是同色的车架侧面）
  const FO = [[-0.935, 0.44], [-0.86, 0.665], [-0.4, 0.665], [-0.28, 0.43]];
  const FI = fkOffsetLine(FO, 0.025, [WF.z, WF.y]);
  for (const s of [-1, 1]) {
    const xa = s > 0 ? 0.355 : -0.59, xb = s > 0 ? 0.59 : -0.355, u = L.fendU ? [] : [2];
    for (let i = 0; i < 3; i++) {   // trim：前后两头 2.5 cm 的钣金端面也省掉
      fkPrism(b, [FO[i], FO[i + 1], FI[i + 1], FI[i]], 'x', xa, xb, K.body, { cap0: s < 0, cap1: s > 0, skip: (i === 0 ? [1] : i === 1 ? [1, 3] : [3]).concat(u, M ? [1, 3] : []) });
    }
    if (L.fendP) fkPrism(b, [[FI[0][0], 0.33], FI[0], FI[1], FI[2], FI[3], [FI[3][0], 0.33]], 'x', s * 0.355, s * 0.375, K.chassis, { skip: [1, 2, 3], cap0: false });
  }
  // 仪表台（前围）：上半截宽到 ±0.47、坐在两边翼子板上（前立柱脚、操纵杆、转向柱都在它上面），斜面朝司机；下半截在两块挡泥内板之间
  const CP = [[-0.8, 0.665], [-0.56, 0.665], [-0.56, 0.86], [-0.66, 1.02], [-0.8, 1.02]];
  fkPrism(b, CP, 'x', -0.47, 0.47, K.body, { c0: L.ch, c1: L.ch, skip: [0] });
  fkPrism(b, [[-0.8, 0.58], [-0.56, 0.58], [-0.56, 0.665], [-0.8, 0.665]], 'x', -0.355, 0.355, K.body, { cap0: false, cap1: false, skip: [0, 2] });
  // 斜面上的仪表板（黑）+ 表盘：slant(x, f, off) = 斜面上 f（0 = 下沿、1 = 上沿）处、离面 off 的点
  const slant = (x, f, off) => [x, 0.86 + 0.16 * f + 0.53 * off, -0.56 - 0.1 * f + 0.848 * off];
  if (!M) facets(b, 'kit:prop', [[slant(-0.3, 0.18, 0.003), slant(0.3, 0.18, 0.003), slant(0.3, 0.82, 0.003), slant(-0.3, 0.82, 0.003)]], K.black, [0, 0.8, -0.7]);
  for (let g = 0; g < L.gauges; g++) {
    const pts = [];
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; pts.push(slant((g ? 0.13 : -0.13) + Math.cos(a) * 0.045, 0.5 + Math.sin(a) * 0.045 / 0.189, 0.006)); }
    facets(b, 'kit:prop', [pts], K.gauge, [0, 0.8, -0.7]);
  }
  // 铭牌：仪表台右侧面一块铝牌 + 几行字（只是几道黑线，没有任何文字 / 商标）
  if (L.plate) {
    sheet(b, 0.473, 0.77, -0.68, 0.11, 0.065, '+x', K.plate);
    for (let k = 0; k < L.plate; k++) sheet(b, 0.475, 0.783 + k * 0.016, -0.68 + (k === 0 ? 0.012 : 0), k === 0 ? 0.06 : 0.085, 0.006, '+x', K.black);
  }
  // 发动机盖：前上角斜切；底边落在侧裙 / 底盘上、后边贴着配重，这两面不画
  fkPrism(b, [[-0.1, 0.4], [0.56, 0.4], [0.56, 1.0], [-0.03, 1.0], [-0.1, 0.93]], 'x', -0.53, 0.53, K.body, { c0: L.ch && L.ch + 0.005, c1: L.ch && L.ch + 0.005, skip: [0, 1] });
  for (const s of [-1, 1]) {
    for (let k = 0; k < L.louvers; k++) sheet(b, s * 0.533, 0.72 + k * 0.055, 0.34, 0.3, 0.024, s > 0 ? '+x' : '-x', K.black);   // 散热百叶
    if (L.digits > 1 || (L.digits && s > 0)) fkNumber(b, o.number || 7, s, 0.533, 0.05, 0.5, 0.14, K.digit);                    // 车身编号（两边都喷）
  }
  // 配重：铸铁，俯视后角是圆的；上半截在后轮上面（顶棱倒圆），下半截在后轮后面往下一直到离地 12 cm。
  // 上半截的底面（悬在后轮上方 4 cm）和下半截的底面看不见，不画
  const CWP = L.cw > 8 ? [[-0.55, 0.56], [0.55, 0.56], [0.55, 1.05], [0.52, 1.14], [0.44, 1.21], [0.3, 1.25], [-0.3, 1.25], [-0.44, 1.21], [-0.52, 1.14], [-0.55, 1.05]]
    : L.cw > 6 ? [[-0.55, 0.56], [0.55, 0.56], [0.55, 1.05], [0.47, 1.2], [0.3, 1.25], [-0.3, 1.25], [-0.47, 1.2], [-0.55, 1.05]]
    : [[-0.55, 0.56], [0.55, 0.56], [0.55, 1.08], [0.4, 1.25], [-0.4, 1.25], [-0.55, 1.08]];
  fkPrism(b, CWP, 'y', 0.5, 1.12, K.cw, { cap0: false, c1: L.cwC });
  fkPrism(b, CWP.slice(2), 'y', 0.12, 0.5, K.cw, { cap0: false, cap1: false, skip: L.bev ? [] : [CWP.length - 3] });
  // 配重顶上的散热格栅（几道黑缝）、后面的黄黑警示条、两个尾灯
  for (let k = 0; k < L.grille; k++) sheet(b, 0, 1.123, 1.0 + k * 0.04, 0.48, 0.02, 'up', K.black);
  fkStripes(b, -0.28, 0.28, 0.64, 0.86, 1.253, L.bev ? 0.07 : 0.09, K.body);
  for (const s of [-1, 1]) {
    if (L.tails) dbox(b, s * 0.22, 0.94, 1.26, 0.12, 0.08, 0.02, K.black, ['py', 'ny', 'px', 'nx', 'pz']);
    sheet(b, s * 0.22, 0.95, L.tails ? 1.273 : 1.253, 0.1, 0.06, '+z', K.tail);
  }
  // 牵引销：配重下半截后面一个凹口（黑）+ 下面一片钳口 + 竖插的销子
  if (!M) sheet(b, 0, 0.27, 1.252, 0.12, 0.08, '+z', [0.03, 0.03, 0.03]);
  if (L.hitch) dbox(b, 0, 0.235, 1.2725, 0.16, 0.035, 0.045, K.mast, ['py', 'ny', 'px', 'nx', 'pz']);
  if (L.hitch || L.bev) fkPost(b, 0, L.hitch ? 0.2 : 0.23, 1.268, 0.014, L.hitch ? 0.23 : 0.17, 5, K.steel, { cap1: true });
  // 液化气瓶：横放在配重顶上（两块托架 + 两道箍带），右头是阀门和接进发动机盖的软管。
  // trim 档（lowb / min，六棱的瓶子）不画托架：瓶子底下那条棱面（离轴 0.866·TR = 0.13）直接落在配重顶上、压进 5 mm
  const TY = M ? 1.245 : 1.32, TZ = 0.86, TR = 0.15, TL = L.domes ? 0.3 : 0.36;
  if (L.tank) {
    fkTube(b, [-TL, TY, TZ], [TL, TY, TZ], TR, L.tank, K.tank, { cap0: !L.domes, cap1: !L.domes });
    for (const s of [-1, 1]) {
      if (L.domes) fkTube(b, [s * 0.3, TY, TZ], [s * 0.36, TY, TZ], TR, L.tank, K.tank, { r1: 0.095, cap1: true });   // 两头的封头
      if (!M) dbox(b, s * 0.16, 1.12, TZ, 0.05, 0.07, 0.26, K.black, 'noBottom');                       // 托架
      if (L.straps) fkTube(b, [s * 0.16 - 0.018, TY, TZ], [s * 0.16 + 0.018, TY, TZ], TR + 0.004, L.tank, K.black, { arc: [L.tank / 2, L.tank] });   // 箍带（上半圈）
    }
    if (L.valve) fkTube(b, [0.36, TY, TZ], [0.41, TY, TZ], 0.022, 5, K.brass, { cap1: true });
    if (L.hose) fkTube(b, [0.4, TY - 0.015, TZ], [0.37, 0.99, 0.47], 0.012, 4, K.hose);
  }
  // 座椅：减震底座、坐垫、靠背（略后仰，四周倒圆；trim 档的靠背顶上不收角）
  if (L.seatBase) dbox(b, 0, 1.0, 0.24, 0.4, 0.06, 0.36, K.black, 'sides');
  fkBox(b, L, 0, L.seatBase ? 1.06 : 1.003, 0.24, 0.5, L.seatBase ? 0.1 : 0.157, 0.44, K.seat, 'noBottom', 0.035, 'top');
  fkPrism(b, M ? [[0.4, 1.13], [0.5, 1.13], [0.54, 1.63], [0.44, 1.63]] : [[0.4, 1.13], [0.5, 1.13], [0.54, 1.6], [0.52, 1.63], [0.46, 1.63], [0.44, 1.6]],
    'x', -0.24, 0.24, K.seat, { c0: L.backC, c1: L.backC, skip: [0] });
  // 安全带：右边靠背上的卷收器 → 一条橙色带子顺着坐垫右侧斜下来；左边坐垫旁一个锁扣
  if (L.belt) {
    const A = [0.47, 1.44], B2 = [0.14, 1.13], du = B2[0] - A[0], dv = B2[1] - A[1], l = Math.hypot(du, dv), nu = -dv / l * 0.022, nv = du / l * 0.022;
    fkPrism(b, [[A[0] + nu, A[1] + nv], [B2[0] + nu, B2[1] + nv], [B2[0] - nu, B2[1] - nv], [A[0] - nu, A[1] - nv]], 'x', 0.252, 0.258, K.belt, { cap0: false, cap1: L.belt > 1 });
    if (L.belt > 2) dbox(b, 0.255, 1.4, 0.49, 0.04, 0.09, 0.07, K.black, 'noBottom');
    if (L.belt > 1) dbox(b, -0.265, 1.08, 0.16, 0.03, 0.05, 0.06, K.steel, ['py', 'nx', 'pz', 'nz']);
  }
  // 护顶架（黑）：前立柱从仪表台两角、后立柱从配重顶斜着上去，顶上四根边梁 + 一排格栅横条
  for (const s of [-1, 1]) {
    const xa = s > 0 ? 0.405 : -0.455, xb = s > 0 ? 0.455 : -0.405;   // 立柱比顶上边梁窄 1 cm，侧面不和边梁共面
    fkPrism(b, [[-0.75, 0.99], [-0.69, 0.99], [-0.52, 2.07], [-0.58, 2.07]], 'x', xa, xb, K.black, { skip: [0, 2] });
    fkPrism(b, [[0.59, 1.08], [0.65, 1.08], [0.56, 2.07], [0.5, 2.07]], 'x', xa, xb, K.black, { skip: [0, 2] });
    dbox(b, s * 0.43, 2.04, -0.03, 0.06, 0.06, 1.18, K.black, L.guardEnds ? 'all' : 'sides');
  }
  for (const z of [-0.59, 0.53]) dbox(b, 0, 2.04, z, 0.8, 0.06, 0.06, K.black, M ? ['py', z < 0 ? 'nz' : 'pz'] : L.bev ? ['py', 'ny', 'pz', 'nz'] : ['py', 'ny', z < 0 ? 'nz' : 'pz']);
  for (let k = 0; k < L.slats; k++) dbox(b, 0, 2.07, -0.45 + k * 0.9 / (L.slats - 1), 0.8, 0.015, 0.05, K.black, L.slatF);
  // 前大灯：两根前立柱上头朝前各一个
  if (L.lampF) for (const s of [-1, 1]) {
    dbox(b, s * 0.43, 1.86, -0.645, 0.08, 0.08, 0.08, K.black, L.lampF);
    sheet(b, s * 0.43, 1.87, -0.688, 0.06, 0.06, '-z', K.lens);
  }
  // 警示灯：后横梁正中，黑底座 + 黄色灯罩（顶上收小）
  if (L.beaconBase) fkPost(b, 0, 2.1, 0.53, 0.05, 0.025, L.beacon, K.black, { cap1: true });
  if (L.beacon) fkPost(b, 0, L.beaconBase ? 2.125 : 2.1, 0.53, 0.045, 0.075, L.beacon, K.amber, { r1: 0.03, cap1: true });
  // 上车扶手：左前立柱后面一根黄色把手（两头各一根短撑）
  {
    const zb = y => -0.69 + (y - 0.99) / 1.08 * 0.17;   // 前立柱后面那条边
    if (L.handle > 1) {
      stick(b, [-0.43, 1.2, zb(1.2) + 0.05], [-0.43, 1.62, zb(1.62) + 0.05], 0.014, K.body);
      for (const y of [1.24, 1.58]) stick(b, [-0.43, y, zb(y) - 0.01], [-0.43, y, zb(y) + 0.05], 0.01, K.black);
    } else if (L.handle) stick(b, [-0.43, 1.2, zb(1.2) + 0.012], [-0.43, 1.62, zb(1.62) + 0.012], 0.014, K.body);   // 中档：直接贴着立柱
  }
  // 后视镜：左前立柱外侧
  if (L.mirror) {
    stick(b, [-0.46, 1.76, -0.6], [-0.53, 1.79, -0.655], 0.008, K.black);
    dbox(b, -0.545, 1.74, -0.655, 0.09, 0.1, 0.02, K.black, 'all');
    sheet(b, -0.545, 1.75, -0.642, 0.08, 0.08, '+z', K.glass);
  }
  // 转向柱：从仪表台里伸出来，往司机这边倒
  const SW = G.steerWheel, ca = Math.cos(SW.tilt), sa = Math.sin(SW.tilt);
  // 没有方向盘中心盖（swHub）的档：转向柱一直伸到轮圈中心、顶上封口，辐条横穿过它（方向盘不悬空）
  const cTop = L.swHub ? 0.04 : 0.004;
  fkTube(b, [SW.x, SW.y - ca * 0.38, SW.z - sa * 0.38], [SW.x, SW.y - ca * cTop, SW.z - sa * cTop], 0.03, L.column, K.black, { cap1: !L.swHub });
  // 液压操纵杆：仪表台右边一排（升降、前后倾……），根部一块黑色防尘罩
  if (L.levers > 2) dbox(b, 0.235, 1.02, -0.72, 0.2, 0.015, 0.07, K.black, ['py', 'pz', 'nz', 'px', 'nx']);
  else if (L.levers > 1) sheet(b, 0.235, 1.023, -0.72, 0.2, 0.07, 'up', K.black);
  for (let k = 0; k < L.levers; k++) {
    const x = L.levers > 2 ? 0.17 + k * 0.065 : 0.19 + k * 0.09;
    stick(b, [x, 1.02, -0.72], [x, 1.22, -0.645], 0.008, K.steel);
    if (L.knobs) dbox(b, x, 1.215, -0.645, 0.03, 0.05, 0.03, K.black, 'noBottom');
  }
  // 倾斜油缸：缸筒尾端在仪表台前脸，活塞杆伸到外门架外侧的耳座
  if (L.tilt) for (const s of [-1, 1]) {
    const A = [s * G.tiltBase.x, G.tiltBase.y, G.tiltBase.z], B2 = [s * G.tiltEye.x, G.tiltEye.y, G.tiltEye.z];
    if (L.tilt < 2) { fkTube(b, A, [s * 0.385, B2[1], B2[2]], 0.03, 4, K.mast); continue; }   // 低档：一根管直接顶到外门架立柱外侧（没有耳座）
    const M = [A[0] + (B2[0] - A[0]) * 0.62, A[1] + (B2[1] - A[1]) * 0.62, A[2] + (B2[2] - A[2]) * 0.62];
    fkTube(b, A, M, 0.034, L.cyl, K.mast, { cap1: true });
    fkTube(b, M, B2, 0.017, L.rod, K.chrome);
  }
}
// ---- 轮子：在当前坐标系原点（轮心正下方的地面）建，s = 外侧朝 ±x ----
function fkWheel(b, L, s, front) {
  const W = front ? FORKLIFT_GEO.wheelFront : FORKLIFT_GEO.wheelRear, K = FK, R = W.r, hw = W.w / 2, y = W.y, C = [0, y, 0];
  const [S, np] = front ? L.wf : L.wr, rr = R * 0.6;
  // 截面：轮辋边 → 胎侧（略往外鼓）→ 胎肩 → 胎面 → 内侧边；胎面一深一浅 = 花纹块。np = 截面边数（3 / 2 / 1 = 只有胎面）
  if (np >= 2) {
    const prof = np >= 3 ? [[rr, s * (hw - 0.012)], [R - 0.035, s * hw], [R, s * (hw - 0.03)], [R, -s * (hw - 0.02)]]
      : [[rr, s * (hw - 0.012)], [R, s * (hw - 0.02)], [R, -s * (hw - 0.02)]];
    fkLathe(b, C, prof, S, np >= 3 ? [K.tire, K.tire, [K.tire, K.lug]] : [K.tire, [K.tire, K.lug]], [(rr + R) / 2, 0]);
    fkDisc(b, -s * (hw - 0.02), y, 0, R, S, K.tire, -s);                     // 轮胎内侧（贴着车架那面）
    fkDisc(b, s * (hw - 0.012), y, 0, rr, S, K.rim, s);                       // 轮辋（凹在胎侧里 1.2 cm）
  } else {                                                                     // 低档：胎面一圈 + 内外两面，外面一块灰色轮辋（trim 档不画贴着车架那面）
    fkLathe(b, C, [[R, s * hw], [R, -s * hw]], S, [K.tire], [R * 0.5, 0]);
    if (!L.trim) fkDisc(b, -s * hw, y, 0, R, S, K.tire, -s);
    fkDisc(b, s * hw, y, 0, R, S, K.tire, s);
    fkDisc(b, s * (hw + 0.003), y, 0, rr, S, K.rim, s);
  }
  if (L.hub && (front || L.hubR)) fkTube(b, [s * (hw - 0.012), y, 0], [s * (hw + 0.008), y, 0], R * 0.2, L.hub, K.hub, { cap1: true });   // 轮毂盖
}
// ---- 方向盘：轮圈 + 辐条 + 中心盖 + 助力球；turn = 方向盘自己转了多少（弧度）----
function fkSteeringWheel(b, L, turn) {
  const SW = FORKLIFT_GEO.steerWheel, K = FK, ca = Math.cos(SW.tilt), sa = Math.sin(SW.tilt);
  const C = [SW.x, SW.y, SW.z], ax = [0, ca, sa], e2 = cross3(ax, [1, 0, 0]);   // e2：盘面里朝车头的方向
  const dir = a => { const c = Math.cos(a + turn), s = Math.sin(a + turn); return [c, e2[1] * s, e2[2] * s]; };
  const at = (a, r, up) => { const d = dir(a); return [C[0] + d[0] * r + ax[0] * up, C[1] + d[1] * r + ax[1] * up, C[2] + d[2] * r + ax[2] * up]; };
  fkRing(b, C, ax, SW.r, 0.016, L.ring[0], L.ring[1], K.black, dir(0));
  if (L.spokes > 2) for (const a of [0, Math.PI, -HALF_PI]) stick(b, at(a, 0.035, -0.012), at(a, SW.r - 0.01, 0), 0.009, K.black);
  else stick(b, at(0, SW.r - 0.01, 0), at(Math.PI, SW.r - 0.01, 0), 0.009, K.black);
  if (L.swHub) fkTube(b, at(0, 0, -0.035), at(0, 0, 0.004), 0.04, L.swHub, K.black, { cap1: true });
  // 助力球：左前方（单手打方向用）
  if (L.knob) { const P = at(Math.PI * 0.8, SW.r, 0); fkTube(b, P, [P[0] + ax[0] * 0.055, P[1] + ax[1] * 0.055, P[2] + ax[2] * 0.055], 0.016, L.knob, K.black, { cap1: true }); }
}
// ---- 外门架：两根立柱（前后 12 cm、左右 7 cm）、顶梁、底座、起升油缸缸筒、链条锚座、倾斜油缸耳座 ----
function fkMastOuter(b, L) {
  const K = FK, G = FORKLIFT_GEO, M = !!L.trim;
  for (const s of [-1, 1]) {
    dbox(b, s * 0.33, 0.06, -1.0, 0.07, G.mastOuterTop - 0.06, 0.12, K.mast, L.posts);                                       // 立柱
    if (L.ears) dbox(b, s * 0.4075, 0.94, -0.97, 0.085, 0.08, 0.06, K.mast, ['py', 'ny', s > 0 ? 'px' : 'nx', 'pz', 'nz']);   // 倾斜油缸耳座
    if (L.cyl) fkTube(b, [s * 0.2, 0.14, -0.865], [s * 0.2, 1.75, -0.865], 0.04, L.cyl, K.mast, { cap1: L.cylCap });         // 起升油缸缸筒（坐在底座上）
  }
  dbox(b, 0, 1.9, -0.925, 0.73, 0.08, 0.03, K.mast, M ? ['py', 'pz'] : ['py', 'ny', 'pz', 'nz']);   // 顶梁（在内门架后面，两头接立柱）
  dbox(b, 0, 0.06, -0.87, 0.73, 0.08, 0.14, K.mast, M ? ['py', 'nz'] : ['py', 'nz', 'px', 'nx']);   // 底座：后面贴着车架前脸
  if (L.backChain || !M) dbox(b, 0, 1.92, -0.9625, 0.3, 0.05, 0.045, K.mast, L.backChain ? ['py', 'ny', 'nz', 'px', 'nx'] : ['py', 'nz']);   // 链条锚座
}
// ---- 内门架（lift = 0 的位置；升起来时整体上移 pose(lift).inner）----
function fkMastInner(b, L) {
  const K = FK, G = FORKLIFT_GEO, sp = G.sprocket, M = !!L.trim;
  for (const s of [-1, 1]) {
    dbox(b, s * 0.265, 0.1, -1.0, 0.1, G.mastInnerTop - 0.1, 0.07, K.mastIn, L.posts);                                        // 立柱
    if (L.rods) fkTube(b, [s * 0.2, 0.4, -0.865], [s * 0.2, 2.07, -0.865], 0.022, L.rod, K.chrome);                           // 起升油缸活塞杆
    if (L.heads) dbox(b, s * 0.2, 2.06, -0.8975, 0.06, 0.055, 0.135, K.mast, L.bev ? ['py', 'ny', 'px', 'nx', 'pz'] : ['py', 'px', 'nx', 'pz']);   // 杆头：顶住内门架顶梁
    // 链轮 + 链轮轴（从立柱内侧伸出来）。min：一块方的，往后伸进顶梁 2 mm（不悬空）
    if (L.sprocket) {
      // 低档（不倒角）：链轮只画朝里那个端面（朝立柱那面被轴挡住），轴只画顶面和正面
      fkTube(b, [s * (sp.x - 0.015), sp.y, sp.z], [s * (sp.x + 0.015), sp.y, sp.z], sp.r, L.sprocket, K.steel, { cap0: L.axle, cap1: L.bev || !L.axle });
      if (L.axle) dbox(b, s * 0.175, sp.y - 0.01, sp.z, 0.08, 0.02, 0.02, K.steel, L.bev ? ['py', 'ny', 'pz', 'nz'] : ['py', 'nz']);
    } else dbox(b, s * sp.x, sp.y - sp.r, sp.z + 0.006, 0.03, 2 * sp.r, 0.082, K.steel, ['nz', 'px', 'nx', 'py']);
  }
  dbox(b, 0, G.mastInnerTop - 0.08, -0.9475, 0.43, 0.08, 0.035, K.mastIn, M ? ['py', 'nz'] : ['py', 'ny', 'pz', 'nz']);   // 顶梁
  if (!M) dbox(b, 0, 0.16, -0.9475, 0.43, 0.08, 0.035, K.mastIn, ['py', 'pz', 'nz']);                         // 底梁
}
// ---- 货叉架 + 挡货架 + 货叉（lift = 0 的位置；升起来时整体上移 pose(lift).carriage）----
function fkCarriage(b, L) {
  const K = FK, G = FORKLIFT_GEO, M = !!L.trim;
  fkBox(b, L, 0, 0.44, -1.09, 0.92, 0.1, 0.05, K.mast, L.hook ? 'all' : M ? ['py', 'nz'] : ['py', 'ny', 'pz', 'nz'], 0.01, 'top');   // 上横梁（货叉挂在它上面）
  dbox(b, 0, 0.08, -1.09, 0.92, 0.08, 0.05, K.mast, L.heel ? ['py', 'ny', 'pz', 'nz', 'px', 'nx'] : M ? ['py', 'nz'] : ['py', 'pz', 'nz']);   // 下横梁
  for (const s of [-1, 1]) {
    dbox(b, s * G.sprocket.x, 0.5, -1.052, 0.03, 0.08, 0.026, K.steel, L.hook ? ['py', 'pz', 'px', 'nx'] : ['py', 'pz']);             // 链条挂点（上横梁后面）
    dbox(b, s * 0.44, 0.54, -1.085, 0.04, 0.7, 0.03, K.mast, L.hook ? ['pz', 'nz', 'px', 'nx', 'py'] : M ? ['nz', 'pz'] : 'sides');   // 挡货架立柱
    // 滚轮架：把上下横梁连起来，后端顶到内门架立柱前脸（z −1.035，那一面不画）—— 升降时货叉架靠它沿内门架上下滑。
    // 顶比上横梁低 5 mm、前面插进两根横梁 5 mm，不和横梁的面共面
    if (L.bracket) dbox(b, s * 0.26, 0.08, -1.0525, 0.05, 0.455, 0.035, K.mast, L.bev ? ['px', 'nx', 'nz', 'py'] : ['px', 'nx', 'nz']);
  }
  dbox(b, 0, 1.2, -1.085, 0.84, 0.04, 0.03, K.mast, M ? ['pz', 'nz'] : ['pz', 'nz', 'py', 'ny']);
  if (L.midRail) dbox(b, 0, 0.88, -1.085, 0.84, 0.03, 0.03, K.mast, ['pz', 'nz', 'py']);
  for (const x of L.back) dbox(b, x, 0.54, -1.085, 0.025, 0.66, 0.02, K.mast, L.bev ? ['pz', 'nz', 'px', 'nx'] : ['pz', 'nz']);
  // 货叉：竖直段（后下角圆过渡）+ 水平段（叉尖上面削薄、下面倒角）+ 骑在上横梁上的挂钩。
  // 低档：竖直段直接贴到上横梁前面（不画挂钩），水平段是一块平板
  for (const s of [-1, 1]) {
    const x0 = s * G.forkTip.x - 0.05, x1 = s * G.forkTip.x + 0.05, T = G.forkTip.z, zb = L.hook ? -1.12 : -1.115;
    fkPrism(b, L.heel ? [[-1.16, 0.015], [-1.135, 0.015], [-1.12, 0.03], [-1.12, 0.58], [-1.16, 0.58]] : [[-1.16, 0.015], [zb, 0.015], [zb, 0.58], [-1.16, 0.58]],
      'x', x0, x1, K.fork, { skip: L.hook ? [0] : [0, 1] });
    if (L.tip) fkPrism(b, [[T, 0.024], [T + 0.025, 0.015], [-1.16, 0.015], [-1.16, 0.055], [-1.97, 0.055], [T, 0.034]], 'x', x0, x1, K.fork, { skip: [1, 2] });
    else fkPrism(b, [[T, 0.015], [-1.16, 0.015], [-1.16, 0.055], [T, 0.035]], 'x', x0, x1, K.fork, { skip: [0, 1] });
    if (L.hook) dbox(b, s * G.forkTip.x, 0.54, -1.09, 0.1, 0.04, 0.06, K.fork, ['py', 'pz', 'px', 'nx']);
  }
}
// ---- 链条：前段（货叉架挂点 → 链轮前缘）、后段（外门架锚座 → 链轮后缘）；长度跟着升降变 ----
function fkChains(b, L, ps) {
  const K = FK, G = FORKLIFT_GEO, sp = G.sprocket, top = sp.y + ps.inner, y0 = G.chain.carriageY + ps.carriage;
  for (const s of [-1, 1]) {
    const x = s * sp.x, h = top - y0;
    dbox(b, x, y0, G.chain.z, 0.026, h, 0.012, K.chain, L.backChain ? ['nz', 'px', 'nx', 'pz'] : ['nz', 'px', 'nx']);   // 比链轮窄 4 mm：侧面不和链轮端面共面
    if (L.links) {   // 链板：正面一节深一节浅
      const n = Math.max(2, Math.round(h / L.links)), p = h / n;
      for (let k = 0; k < n; k += 2) sheet(b, x, y0 + k * p, G.chain.z - 0.008, 0.026, p, '-z', K.link);
    }
    if (L.backChain) dbox(b, x, G.chain.anchorY, G.chain.back, 0.026, top - G.chain.anchorY, 0.012, K.chain, ['nz', 'pz']);
  }
}
// ---- 磨损（软边贴花，只在高画质）：踏板边上蹭掉的漆、配重后角的刮痕、配重侧面的锈迹、仪表台前脸往下流的油痕、
//      地台上的泥脚印、门架前地上的一滩油、货叉上面磨亮的刮痕。按重要程度排，细节档 decals 决定贴前几片 ----
const FK_WEAR = [
  ['body', { kind: 'oil', x: 0.04, y: 0, z: -1.28, facing: 'up', w: 0.62, h: 0.46, rot: 0.6, opacity: 0.5, offset: FLOOR_DECAL }],
  ['carriage', { kind: 'scratch', x: -0.28, y: 0.055, z: -1.62, facing: 'up', w: 0.62, h: 0.03, rot: HALF_PI - 0.02, color: 0x8d8a82, opacity: 0.45 }],
  ['carriage', { kind: 'scratch', x: 0.28, y: 0.055, z: -1.62, facing: 'up', w: 0.62, h: 0.03, rot: HALF_PI + 0.02, color: 0x8d8a82, opacity: 0.45 }],
  ['body', { kind: 'scuff', x: -0.55, y: 0.33, z: -0.12, facing: '-x', w: 0.32, h: 0.05, rot: 0.08 }],
  ['body', { kind: 'rust', x: 0.55, y: 0.78, z: 0.86, facing: '+x', w: 0.14, h: 0.44, color: 0x6a3d22, opacity: 0.5 }],
  ['body', { kind: 'drip', x: 0.28, y: 0.84, z: -0.8, facing: '-z', w: 0.09, h: 0.3, color: 0x1a1814, opacity: 0.55 }],
  ['body', { kind: 'scratch', x: 0.37, y: 0.82, z: 1.23, normal: [0.275, 0, 0.962], w: 0.26, h: 0.02, rot: 0.2, color: 0x8a8578, opacity: 0.55 }],
  ['body', { kind: 'stain', x: 0.06, y: 0.615, z: -0.34, facing: 'up', w: 0.36, color: 0x3a342a, opacity: 0.4, offset: 0.006 }],
  ['body', { kind: 'scuff', x: 0.55, y: 0.3, z: -0.14, facing: '+x', w: 0.26, h: 0.045, rot: -0.06 }],
  ['body', { kind: 'scratch', x: -0.2, y: 1.12, z: 0.62, facing: 'up', w: 0.3, h: 0.02, rot: 0.4, color: 0x8a8578, opacity: 0.5 }],
];
// 贴这一档的磨损（part 同 forkliftModel；货叉上的跟着货叉架升 ps.carriage）。dec(o) → Piece | null
function fkWearEmit(b, L, want, ps, dec) {
  for (let k = 0; k < Math.min(L.decals, FK_WEAR.length); k++) {
    const [part, o] = FK_WEAR[k];
    if (!want(part)) continue;
    dec(part === 'carriage' ? Object.assign({}, o, { y: o.y + ps.carriage }) : o);
  }
}
// 纯建模：在当前坐标系原点建一台叉车（不出碰撞体、不吃随机数）。
// opts：{ lift: 0..1 货叉升起比例, steer: 后轮转角（弧度，正 = 车头往左偏）, part: 'all' | 'body' | 'wheelsFront' | 'wheelsRear' | 'steeringWheel'
//         | 'mastOuter' | 'mastInner' | 'carriage' | 'chains', detail: 'high' | 'mid' | 'lite' | 'low' | 'lowb' | 'min', number: 车身编号, decal: 贴花函数（缺省不贴）}
function forkliftModel(b, opts) {
  const o = opts || {}, G = FORKLIFT_GEO, L = FK_LOD[o.detail] || FK_LOD.high, part = o.part || 'all';
  const want = k => part === 'all' || part === k, ps = G.pose(o.lift), steer = +o.steer || 0;
  if (want('body')) fkBody(b, L, o);
  if (want('wheelsFront')) for (const s of [-1, 1]) { b.push(s * G.wheelFront.x, G.wheelFront.z, 0); fkWheel(b, L, s, true); b.pop(); }
  if (want('wheelsRear')) for (const s of [-1, 1]) { b.push(s * G.wheelRear.x, G.wheelRear.z, steer); fkWheel(b, L, s, false); b.pop(); }
  if (want('steeringWheel')) fkSteeringWheel(b, L, steer * G.steerRatio);
  if (want('mastOuter')) fkMastOuter(b, L);
  if (want('mastInner')) { b.push(0, 0, 0, ps.inner); fkMastInner(b, L); b.pop(); }
  if (want('carriage')) { b.push(0, 0, 0, ps.carriage); fkCarriage(b, L); b.pop(); }
  if (want('chains')) fkChains(b, L, ps);
  if (typeof o.decal === 'function') fkWearEmit(b, L, want, ps, o.decal);
}
// 场景里停着的叉车（没人开）：货叉落地、轮子摆正。
// 账面：一律按改之前那台叉车的面数 FK_NOMINAL 入账（两种画质一样）→ 后面的柱间、货架、堆垛分到的额度和改之前逐字节一致。
// 真正的几何留到这块 b.finish 里才建（buildChunk 开头给 b.finish 包了一层；kit 构件的磨损贴花也是 finish 时才贴、包在更外面，
// 所以顺序是：磨损贴花 → 叉车 → 合并几何）。那时这块别的东西都建完了，看实际还剩多少面挑细节档（FK_LADDER，整块 ≤ FK_CAP）。
// 在那之前，forklift() 先往这块塞一个"占位"累加器 FK_PH：没有顶点（n = 0），三角形数 = 改前那台叉车在这里会建出的面数 pend
// （FK_NOMINAL + 改前 5 个倒角盒在高画质下多出来的面，fkOldExtra 按改前的顺序和条件逐个判断）。rawTri、kit 的 DETAIL_TRI_CAP 判断
// （倒角、贴花、构件细节档、finish 时的磨损贴花）都把它算进去 → 生成过程中块里的面数和改之前一模一样，别的东西倒不倒角、
// 贴花画不画都不变；kit 的 finish / 磨损贴花判断 mesh 时 n = 0 的累加器直接跳过，buildForklifts 一开头就把它删掉。
// 叉车自己的磨损贴花在它的几何之前贴（离 DETAIL_TRI_CAP 最远），只往已经有贴花 mesh 的块里贴（不多开 mesh）。
// 多出来的面数记在细节档 D 上（和倒角、贴花一样，只影响可见几何）。
const FK_NOMINAL = 318;                       // 改前叉车的面数（4 个倒角盒按普通盒算 + 门架 / 货叉 / 方向盘 / 4 个轮子），两种画质都是这个
const FK_CAP = { high: 9950, low: 7950 };     // 建完叉车后整块实际面数的上限（kit 预算 10000 / 8000，留 50 的余量）
// 挑档顺序：高画质 high → mid → lite → low → lowb → min；低画质 low → lowb → min（不倒角、不贴花）
const FK_LADDER = { high: ['high', 'mid', 'lite', 'low', 'lowb', 'min'], low: ['low', 'lowb', 'min'] };
const FK_PH = 'L1:forklift-pending';          // 占位累加器的 key（不是材质，不会建成 mesh）
const fkQueue = new WeakMap(), fkCost = {};
// 改前那台叉车的 5 个倒角盒（车身、配重、座椅、靠背、护顶）：[w, h, d, faces, 倒角, 倒哪些棱, 它前面先建了多少面（护顶前面是 4 根立柱）]
const FK_OLD_BEV = [[1.1, 0.75, 1.9, 'noBottom', 0.02], [1.08, 0.28, 0.62, 'noBottom', 0.04], [0.5, 0.12, 0.5, 'noBottom', 0.03],
  [0.5, 0.45, 0.08, 'noBottom', 0.025], [1.0, 0.04, 1.3, 'all', 0.015, 'top', 32]];
let fkOldX = null;
function fkOldExtra(b) {
  if (lowQ()) return 0;   // 低画质改前也不倒角
  if (!fkOldX) fkOldX = FK_OLD_BEV.map(([w, h, d, f, r, ed]) => {   // 每个盒倒了角多几个面（kit 同一个切角实现，量一次）
    const t = kit.builder({}, 0, 0, () => 0, { height: H });
    const pc = t._bevelBox(0, 0, 0, w, h, d, 'kit:prop', { color: C.dark, solid: false, faces: f, uv: 'stretch', bevel: r, bevelEdges: ed });
    return pc ? rawTri(t) - nFaces(f) * 2 : 0;
  });
  // 改前 bev()：D（overD）没到 min(EXTRA_CAP, e.lim)、kit 那边块里的实际面数没到 DETAIL_TRI_CAP 才倒。
  // 改前那时块里的实际面数 = 现在的（前面几台还没建的叉车已经由占位累加器算在里面）+ 本台已经建了的那几块
  const e = ext(b), cap = Math.min(EXTRA_CAP, e.lim);
  let x = 0, raw = rawTri(b);
  FK_OLD_BEV.forEach((k, i) => {
    raw += k[6] || 0;
    const on = fkOldX[i] > 0 && overD(b) + x < cap && raw < kit.budget.detailCap;
    if (on) x += fkOldX[i];
    raw += nFaces(k[3]) * 2 + (on ? fkOldX[i] : 0);
  });
  return x;
}
// 每档一台叉车实际多少面：建一台到临时 Builder 里量（每档只量一次）；贴花每片 2 个三角形另加
function fkTris(detail) {
  if (fkCost[detail] == null) {
    const t = kit.builder({}, 0, 0, () => 0, { height: H });
    forkliftModel(t, { detail, number: 88 });
    fkCost[detail] = rawTri(t) + Math.min(FK_LOD[detail].decals, FK_WEAR.length) * 2;
  }
  return fkCost[detail];
}
// 工坊地图：kit 的 finish 在叉车之后才让工坊把自由墙、新增出口摆进这块（BR.workshop.decorate），先给它们留出面数
// （自由墙一面 12 个三角形；出口按最费面的那种留：高画质门 250、楼梯间 224、电梯 200 → 300；低画质楼梯间 148、门 116 → 160）。
// 不在工坊地图里时是 0
const FK_WS_EXIT = { high: 300, low: 160 };
function fkWsReserve(b) {
  const ws = BR.workshop && BR.workshop.active;
  if (!ws || b._wsHelper) return 0;
  const inC = o => { const x = +o.x || 0, z = +o.z || 0; return x >= b.ox && x < b.ox + b.size && z >= b.oz && z < b.oz + b.size; };
  let n = 0;
  for (const w of Array.isArray(ws.freeWalls) ? ws.freeWalls : []) if (w && w.len > 0 && inC(w)) n += 12;
  for (const a of ws.exits && Array.isArray(ws.exits.added) ? ws.exits.added : []) if (a && a.to != null && inC(a)) n += FK_WS_EXIT[lowQ() ? 'low' : 'high'];
  return n;
}
function forklift(b, x, z, rot) {
  const p = b.point(x, z), w = b.world(x, z), R = b._T.rot + rot;
  const pend = FK_NOMINAL + fkOldExtra(b);
  if (!fkQueue.has(b)) fkQueue.set(b, []);
  fkQueue.get(b).push({ x: p.x, z: p.z, y: b._T.y, rot: R, pend, number: 1 + U.hashInts(b.seed, 'L1-forklift', Math.round(w.x * 10), Math.round(w.z * 10)) % 98 });
  (b.data.forklifts || (b.data.forklifts = [])).push({ x: w.x, z: w.z, rot: R, detail: null, tris: 0 });   // 世界坐标：自测找机位用，以后开叉车也从这里找
  // 占位：先按改前那台的面数 pend 占上（见上面的说明）。账面只记 FK_NOMINAL：pend 里多出来的倒角面数和改前一样记在细节档 D 上
  let ph = b._accs.get(FK_PH);
  if (!ph) { ph = { key: FK_PH, n: 0, idx: [] }; b._accs.set(FK_PH, ph); }
  ph.idx.length += 3 * pend;
  charge(b, FK_NOMINAL - pend);
  addExtra(ext(b), pend - FK_NOMINAL);
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hx = 0.6 * c + 1.3 * s, hz = 0.6 * s + 1.3 * c;
  b.solid(x - hx, 0, z - hz, x + hx, 2.15, z + hz);
}
// 块里不走累加器、单独挂进去的物体（出口地上的发光圈、noclip 墙片……，kit 的 b.object）的三角面：rawTri 数不到，整块合计要算上
function fkObjTris(b) {
  let n = 0;
  for (const obj of b._objects) obj.traverse(m => {
    const g = m.isMesh && m.geometry, P = g && g.attributes && g.attributes.position;
    if (P) n += (g.index ? g.index.count : P.count) / 3 * (m.isInstancedMesh ? m.count : 1);
  });
  return n;
}
// b.finish 里（kit 构件的磨损贴花贴完之后、合并几何之前）：删掉占位、把排队的叉车真正建出来
function buildForklifts(b) {
  const q = fkQueue.get(b);
  b._accs.delete(FK_PH);
  if (!q || !q.length) return;
  fkQueue.delete(b);
  const lad = FK_LADDER[lowQ() ? 'low' : 'high'], cap = FK_CAP[lowQ() ? 'low' : 'high'] - fkWsReserve(b);
  const e = ext(b), cat = e.cat, T0 = b._T, t0 = rawTri(b), n = q.length, pend = q.reduce((a, f) => a + f.pend, 0);
  // 挑档：先定保底档 = 所有台都用同一档时放得下的最细一档（都放不下就用最省的 min），所有台都按它占上；
  // 再从第一台起逐台往细里升，放得下就升。整块合计 = 累加器里的 + 单独挂进去的物体 + 叉车
  const base = t0 + fkObjTris(b);
  let fl = lad.length - 1;
  for (let j = 0; j < lad.length; j++) if (base + n * fkTris(lad[j]) <= cap) { fl = j; break; }
  const det = q.map(() => fl);
  let used = base + n * fkTris(lad[fl]);
  q.forEach((f, i) => {
    for (let j = 0; j < fl; j++) {
      const u = used - fkTris(lad[fl]) + fkTris(lad[j]);
      if (u <= cap) { det[i] = j; used = u; break; }
    }
  });
  e.cat = 'forklift';
  b._T = { x: 0, y: 0, z: 0, rot: 0, c: 1, s: 0 };   // 区块本地坐标系（队列里记的就是区块本地坐标）
  const got = q.map(() => 0);
  // 先贴磨损：这块已经有贴花 mesh（低画质没有）才贴，贴花总数不过 kit 的上限
  const da = b._accs.get('kit:decal');
  if (da && da.idx && da.idx.length) {
    const dec = o => { if ((b._decalN || 0) >= kit.budget.decalsPerChunk) return null; const pc = kit.decal(b, o); if (pc) e.decals++; return pc; };
    q.forEach((f, i) => {
      const r0 = rawTri(b);
      b.push(f.x, f.z, f.rot, f.y);
      fkWearEmit(b, FK_LOD[lad[det[i]]], () => true, FORKLIFT_GEO.pose(0), dec);
      b.pop();
      got[i] += rawTri(b) - r0;
    });
  }
  q.forEach((f, i) => {
    const r0 = rawTri(b);
    b.push(f.x, f.z, f.rot, f.y);
    forkliftModel(b, { part: 'all', lift: 0, steer: 0, detail: lad[det[i]], number: f.number });
    b.pop();
    got[i] += rawTri(b) - r0;
    const rec = b.data.forklifts[i];
    rec.detail = lad[det[i]]; rec.tris = got[i];
  });
  // 占位删掉了（rawTri 少了 pend）、叉车建上了（多了 all）：账面不变，多出来的记在细节档 D 上
  const all = rawTri(b) - t0;
  charge(b, pend - all);
  addExtra(e, all - pend);
  if (b.data.tri) { b.data.tri.extra = e.tris; b.data.tri.decals = e.decals; }
  b._T = T0;
  e.cat = cat;
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
  // 屋顶板（挑出 6 cm）+ 一圈压顶：12 条棱倒 3.5 cm（远处看屋顶的轮廓不再是一块刀切的板）
  bbox(b, 0, HH, 0, 2 * R + T + 0.12, 0.16, 2 * R + T + 0.12, C.roof, 'all', 0.035, 'all', K);
  // 外墙根一道灰色勒脚（贴在墙外 3 mm）+ 勒脚上面往上渐渐淡掉的一层脏污（grimeBand 渐变带，只在高画质；派生流，不吃柱间 rng）：
  // 贴着勒脚最深、往上 30–50 cm 一路淡回白墙
  const gr = U.rng(b.seed, b.cx, b.cz, 'L1-hutgrime', bay.k);
  const zw = R + T / 2;
  for (const f of [0, 1, 2, 3]) {
    b.push(0, 0, f * HALF_PI);
    const segs = [];
    if (f !== 0) { sheet(b, 0, 0, zw + 0.003, 2 * R + T, 0.15, '+z', [0.62, 0.62, 0.6], K); segs.push([-zw, zw]); }
    else {
      const lw = doorX - DW / 2 + R + T / 2, rw = R + T / 2 - doorX - DW / 2;
      sheet(b, -R - T / 2 + lw / 2, 0, zw + 0.003, lw, 0.15, '+z', [0.62, 0.62, 0.6], K);
      sheet(b, R + T / 2 - rw / 2, 0, zw + 0.003, rw, 0.15, '+z', [0.62, 0.62, 0.6], K);
      segs.push([-zw, doorX - DW / 2], [doorX + DW / 2, zw]);
    }
    // 渐变脏污带从勒脚顶（15 cm）往上，和勒脚同在墙外 3 mm（上下相接、不重叠）；转角处两头各多伸 3 mm，和隔壁那面墙的带子对上
    for (const [s0, s1] of segs) grimeBand(b, s0 - (s0 <= -zw ? 0.003 : 0), s1 + (s1 >= zw ? 0.003 : 0), zw + 0.003, 0.15, W, 0.4, gr, K);

    b.pop();
  }
  // 门边一道推车蹭的擦痕（门洞两侧随机一边）
  {
    const side = gr() < 0.5 ? -1 : 1, k = gr();
    b.push(0, 0, 0);
    soft(b, { kind: 'scuff', x: doorX + side * (DW / 2 + 0.25 + k * 0.4), y: 0.35 + k * 0.5, z: zw, facing: '+z', w: 0.4 + k * 0.3, rot: (k - 0.5) * 0.3,
      color: mul3(CONC_LIN, mulc(W, 0.3)), srgb: false, opacity: 0.55, offset: 0.005 }, 0, null, true);
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
    // 床垫上一块发黄的旧污渍：高画质软边污渍贴花（边缘一路淡回床垫），低画质照旧是浮在床垫顶上的六边形。取数顺序同原来。
    // 床垫顶是中间隆起 16 cm 的缓坡：贴花水平放在隆起顶点上方（和原来的六边形同一高度），四周淡出的部分离坡面 1–3 cm，看不出悬空
    { const hs = take(r, 6); soft(b, { kind: 'stain', x: 1.4, y: 0.16, z: -1.6, facing: 'up', w: 0.75, h: 0.62, rot: hs[0] * TAU, color: mulc([0.4, 0.33, 0.2], PROP_LIN), srgb: false, opacity: 0.8, offset: 0.006 }, 4,
      () => blot(b, 1.4, -1.6, 0.25, 0.2, 6, [0.4, 0.33, 0.2], seq(hs), 0.17)); }
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
        bbox(b, -2.25 + c * 1.5, 0.05 + rr * 1.35, R - 0.05, 1.46, 1.31, 0.09, [0.86, 0.84, 0.76], ['nz', 'py', 'ny', 'px', 'nx'], 0.04);   // 软包垫四周倒 4 cm：鼓起来的样子
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
    // 水渍：从梁底渗下来、上宽（40 cm）下窄的一道。高画质是一片软边流痕贴花（'rust' 格子染成潮混凝土色：源头一团伸进梁里被挡住 →
    // 贴着梁底最深，几道水痕往下流、末端收尖，两侧一路淡回墙面）+ 旁边一道更长的细滴痕（B 档点缀）；低画质照旧是一块深色梯形。取数顺序同原来
    const u = (r() - 0.5) * 5;
    if (!nc || Math.abs(u) > 1.2) {
      const yb0 = 1.5 + r(), yb1 = 1.5 + r(), wet = mul3(CONC_LIN, mulc(col, 0.42));
      const p = soft(b, Object.assign(streak(0.4, WALL_H, Math.min(yb0, yb1), u, T / 2, 9, wet, 0.8, 0.75), { offset: 0.005 }), 2,
        () => facets(b, K, [[[u - 0.2, WALL_H, zf + 0.001], [u - 0.05, yb0, zf + 0.001], [u + 0.07, yb1, zf + 0.001], [u + 0.2, WALL_H, zf + 0.001]]], mulc(col, 0.6), [u, 2, 0]));
      if (p) soft(b, Object.assign(streak(0.07, WALL_H, Math.max(1.25, Math.max(yb0, yb1) - 0.35), u + 0.13, T / 2, 9, wet, 0.5), { offset: 0.005 }), 0, null, true);
    }
    // 墙根一层往上淡掉的脏污（渐变带，铺在墙裙上、范围和墙裙一样，墙裙外 2 mm）+ 几道叉车/托盘蹭出来的擦痕、刮痕
    // （软边贴花，再外 2 mm）。都只在高画质；派生流，不吃柱间 rng
    const gr = U.rng(b.seed, b.cx, b.cz, 'L1-wallgrime', bay.k, s);
    const wain = mulc(col, 1.15);
    if (nc) { grimeBand(b, -3.8, -0.9, zf + 0.002, 0, wain, 0.45, gr, K); grimeBand(b, 0.9, 3.8, zf + 0.002, 0, wain, 0.45, gr, K); }
    else grimeBand(b, -3.6, 3.6, zf + 0.002, 0, wain, 0.45, gr, K);
    for (let q = 0; q < 2; q++) {
      const k1 = gr(), k2 = gr(), k3 = gr();
      let x = (k1 - 0.5) * 6.2;
      if (nc && Math.abs(x) < 1.2) x = (x < 0 ? -1 : 1) * (1.2 + Math.abs(x) * 1.5);   // 切出段两侧 1.2 m 内不贴
      soft(b, { kind: k3 < 0.5 ? 'scuff' : 'scratch', x, y: 0.18 + k2 * 0.85, z: T / 2, facing: '+z', w: 0.35 + k3 * 0.4, rot: (k3 - 0.5) * 0.25,
        color: mul3(CONC_LIN, mulc(col, 0.34)), srgb: false, opacity: 0.45 + k2 * 0.25, offset: 0.008 }, 0, null, true);
    }
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
      bbox(b, 0, 0.9, 0.16, 0.8, 1.2, 0.3, [0.58, 0.6, 0.6], 'noBottom', 0.02);   // 柜体棱倒 2 cm
      sheet(b, 0, 0.94, 0.313, 0.012, 1.12, '+z', [0.2, 0.2, 0.2]);
      facets(b, 'kit:prop', [[[-0.3, 1.75, 0.315], [-0.14, 1.75, 0.315], [-0.22, 1.9, 0.315]]], C.yellow, [-0.22, 1.8, 0]);
      dbox(b, 0.28, 1.35, 0.33, 0.03, 0.12, 0.03, C.dark, 'all');
      for (const px of [-0.2, 0.2]) dbox(b, px, 2.1, 0.06, 0.05, (s.host === 'hut' ? HUT_H : WALL_H) - 2.1, 0.05, [0.62, 0.62, 0.6], 'sides');
      b.solid(-0.4, 0, 0, 0.4, 2.1, 0.32);
    } else if (k < 0.33) {
      // 消火栓箱：红框 + 玻璃窗里的水带卷
      bbox(b, 0, 0.8, 0.1, 0.7, 0.9, 0.2, C.red, 'noBottom', 0.015);
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
  bbox(b, 0, HH, (Z0 + Z1) / 2, W + 2 * T + 0.1, 0.25, Z1 - Z0 + 0.1, outer, 'all', 0.035, 'all', K);   // 顶板棱倒 3.5 cm
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
  // 墙上的裂纹（越往里越多）：高画质是软边细裂纹贴花（中间深、两侧淡出、两头收尖），低画质照旧是细长四边形。取数顺序同原来
  const cr = (x, z, rot, y, n) => {
    b.push(x, z, rot);
    for (let q = 0; q < n; q++) {
      const u = (r() - 0.5) * 1.6, v = y + r() * 1.2, t0 = r(), t1 = r();
      const ex = 0.25 * (t0 - 0.3), len = Math.hypot(ex, 0.5);
      soft(b, { kind: q % 2 ? 'hairline' : 'scratch', x: u + ex / 2, y: v + 0.25, z: 0, facing: '+z', w: len + 0.06, h: 0.035, rot: Math.atan2(0.5, ex),
        color: 0x2a2826, opacity: 0.85, variant: 2 }, 2,
        () => facets(b, 'kit:prop', [[[u, v, 0.004], [u + 0.02, v, 0.004], [u + 0.25 * (t0 - 0.3), v + 0.5, 0.004], [u + 0.25 * (t1 - 0.3) - 0.015, v + 0.5, 0.004]]], [0.25, 0.25, 0.24], [u, v, -1]));
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
    // 灌木根下的泥土：高画质软边污渍贴花（边缘渐渐淡回混凝土地面），低画质照旧是七边形。取数顺序同原来
    const hs = take(r, 7);
    soft(b, { kind: 'stain', x, y: 0, z, facing: 'up', w: rr * 4.6, h: rr * 4.0, rot: hs[0] * TAU, color: mulc(C.soil, PROP_LIN), srgb: false, opacity: 0.95, offset: FLOOR_DECAL }, 5,
      () => blot(b, x, z, rr * 1.5, rr * 1.3, 7, C.soil, seq(hs)));
    const g = new THREE.IcosahedronGeometry(rr, 0);
    g.scale(1, 0.75 + r() * 0.4, 1);
    b.mesh(g, 'kit:prop', { x, y: rr * 0.55, z, color: mulc(C.leaf, 0.8 + r() * 0.5), uv: 'stretch' });
    g.dispose();
    b.solid(x - rr * 0.7, 0, z - rr * 0.7, x + rr * 0.7, rr * 1.2, z + rr * 0.7);
  }
  // 地上的苔藓：同上，软边贴花 / 低画质六边形
  for (let q = 0; q < 6; q++) {
    const mx = (r() - 0.5) * 6, mz = (r() - 0.5) * 6, mrx = 0.4 + r() * 0.6, mrz = 0.3 + r() * 0.5, hs = take(r, 6);
    soft(b, { kind: 'stain', x: mx, y: 0, z: mz, facing: 'up', w: mrx * 3.2, h: mrz * 3.2, rot: hs[0] * TAU, color: mulc([0.22, 0.34, 0.16], PROP_LIN), srgb: false, opacity: 0.8, offset: FLOOR_DECAL + 0.0005 }, 4,
      () => blot(b, mx, mz, mrx, mrz, 6, [0.22, 0.34, 0.16], seq(hs), 0.0075));
  }
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
  // 洞下一小堆掉下来的碎混凝土和灰：高画质是一块软边灰斑（'stain' 格子，和泥土同样按"格子边长 ≈ 原来半径 × 3.07"换算，
  // 浓的核心 ≈ 原来那块多边形的大小，边缘一路淡回地面）；低画质照旧是八边形。取数顺序同原来。
  // （之前用的 'splash' 格子只有中间一小团 + 零星水点，实拍几乎看不见，等于把这堆灰弄丢了 —— 改回实心的软斑）
  { const hs = take(r, 8); soft(b, { kind: 'stain', x: 0.4, y: 0, z: 0.3, facing: 'up', w: 2.15, h: 1.54, rot: hs[0] * TAU, color: mulc([0.55, 0.54, 0.5], PROP_LIN), srgb: false, opacity: 0.92, offset: FLOOR_DECAL }, 6,
    () => blot(b, 0.4, 0.3, 0.7, 0.5, 8, [0.55, 0.54, 0.5], seq(hs))); }
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
  bbox(b, 0, 0, 0, 1.1, 0.5, 0.45, wood, 'noBottom', 0.02);   // 电视柜：棱倒 2 cm
  sheet(b, 0, 0.04, 0.228, 0.012, 0.42, '+z', mulc(wood, 0.5));
  for (const s of [-0.1, 0.1]) dbox(b, s, 0.3, 0.23, 0.03, 0.03, 0.02, [0.7, 0.6, 0.35], 'all');
  // 录像机 + 绿色数码管
  dbox(b, 0, 0.5, 0.02, 0.44, 0.09, 0.32, C.dark, 'noBottom');
  sheet(b, 0.1, 0.53, 0.183, 0.1, 0.025, '+z', [0.3, 1.5, 0.5], 'kit:glow');
  sheet(b, -0.1, 0.52, 0.183, 0.16, 0.03, '+z', [0.02, 0.02, 0.02], 'kit:glow');
  // CRT：机身 + 后面收窄的屁股 + 屏幕（雪花闪）+ 旋钮 + 天线
  const ty = 0.59;
  bbox(b, 0, ty, 0.02, 0.64, 0.5, 0.42, [0.3, 0.29, 0.27], 'noBottom', 0.02);   // CRT 机壳圆边（2 cm：后面收窄的屁股接在背面平的部分里）
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
  { const hs = take(r, 9); soft(b, { kind: 'stain', x: 0, y: 0, z: 0, facing: 'up', w: 3.1, h: 2.7, rot: hs[0] * TAU, color: mulc(C.soil, PROP_LIN), srgb: false, opacity: 0.97, offset: FLOOR_DECAL }, 7,
    () => blot(b, 0, 0, 1.0, 0.85, 9, C.soil, seq(hs))); }
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
    kitPuddle(b, 0, 0.55, { rx: 0.6, rz: 0.35, y: 0.009, color: [0.65, 0.78, 0.86] });   // 冰面外那圈淡水印照画（像化开的冰水；kit.prop.puddle 现在有 ring:false 开关，这里有意保留）
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
    // 三道刮痕：高画质是软边刮痕贴花（中间一道实的、两侧淡出、两头收尖），低画质照旧是细长四边形。
    // 颜色和原来的四边形同一套（kit:prop 顶点色 × 0.8，srgb: false）—— 之前写的 0x6a6862 按屏幕色解码后只有原来亮度的 4 成，
    // 在深灰门板上几乎看不见；格子高 5 cm：实心核心约 1.9 cm（≈ 原来 2 cm 宽），两侧各约 0.8 cm 的软边
    for (let q = 0; q < 3; q++) {
      const x0 = -0.19 + q * 0.12, x1 = -0.06 + q * 0.12, len = Math.hypot(x1 - x0, 0.55);
      soft(b, { kind: 'scratch', x: (x0 + x1) / 2, y: 0.975, z: zf, facing: '+z', w: len + 0.05, h: 0.05, rot: Math.atan2(-0.55, x1 - x0) + Math.PI,
        color: mulc([0.4, 0.4, 0.38], PROP_LIN), srgb: false, opacity: 0.92, offset: 0.008, variant: q }, 2,
        () => facets(b, 'kit:prop', [[[-0.2 + q * 0.12, 1.25, zf + 0.004], [-0.18 + q * 0.12, 1.25, zf + 0.004], [-0.05 + q * 0.12, 0.7, zf + 0.004], [-0.07 + q * 0.12, 0.7, zf + 0.004]]], [0.4, 0.4, 0.38], [0, 1, -1]));
    }
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
  // 叉车的几何留到 finish 里才建（账面早就按改前的面数记过了，见 forklift / buildForklifts）。这一层包在最里面：
  // kit 构件第一次记磨损贴花时会把 b.finish 再包一层（先贴磨损、再调这里），所以顺序是 磨损贴花 → 叉车 → 合并几何
  const fin = b.finish;
  b.finish = function () { buildForklifts(this); return fin.apply(this, arguments); };
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

  const ex = ext(b);
  ex.keep = keepFor(bays);
  ex.cat = 'shell';
  buildShell(b, env);
  ex.cat = 'pillar';
  for (const px of LINES) for (const pz of LINES) buildPillar(b, px, pz, env);
  ex.cat = 'misc';
  tireTracks(b);
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
  ex.cat = 'core';
  for (const bay of bays) { buildBayCore(b, bay, env); keepCore(ex, bay); }
  placeWallExits(b, env, defs.filter(d => d.host === 'wall'));
  // 可选：剩余预算分给各柱间（货架优先）
  ex.cat = 'fill';
  fillBays(b, bays, env);
  ex.cat = 'deco';
  decorateFreeSlots(b, env);
  sectorExtras(b, env);
  addSpawns(b, env);
  b.data.sector = sector;
  b.data.bays = bays.map(bb => bb.type[0] + (bb.exits.length ? '*' : '')).join('');
  b.data.tri = { nominal: Math.round(triCount(b)), extra: ex.tris, decals: ex.decals, by: ex.by, lost: ex.lost };   // 自测用：账面面数、细节档多出的面数
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
