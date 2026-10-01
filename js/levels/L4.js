// Level 4 - "废弃办公室"
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-4  许可：CC BY-SA 3.0
// 抓取：页面版本 33，最后编辑 2025-09-03；原作者 Reddit 用户 u/M654z（页面本身是英文原文的中文翻译，未注明译者）
//
// 【用户指定优先】2026-09-23 游戏的主人（贝塔）用手表拍了两张参考照片：
//   backrooms-research/refs/2026-09-23/L4-房间1.jpg、L4-房间2.jpg（data/lore-choices.json levels['4'].userOverride / userRefs）。
//   外观与布局按用户：白墙、深蓝灰地毯、带长条通风口的矿棉方格吊顶、橙木色的门（有的门上有小玻璃窗）、
//   墙上透进亮光的窗户（窗洞一圈浅木色衬板、窗下旧暖气片）、门边的灭火器和消防箱；
//   地形是「比较绕的楼道，算不上迷宫，连接着一个个房间」：走廊会拐弯、有岔路、有死角，一眼看得出是楼道。
//   与原文冲突的地方按用户：
//     · 原文「几乎没有任何家具」→ 多数房间仍是空的（参考图 2 就是空房间），一部分摆办公桌椅/文件柜/隔断/货架；
//     · 原文「大多数窗户被涂黑」→ 大多数窗户透进白亮的光（参考图），涂黑的窗和"没涂黑的透明陷阱窗"保留为少数。
//   窗户开在「采光井」上：几格封死、进不去的竖井，窗外就是井里的天光——窗户两侧不会出现"两边都亮"的穿帮。
// 【用户 2026-10-01】「材质也得跟随着细化，一些方块的角不能太尖锐，一些方块还需要过渡，比如 level4 墙的刮痕两边就需要细一点的过渡」：
//   · 墙面贴图提到 512，刮痕/擦痕/踢脚印/墙根脏污/吊顶渗下的水渍全部改用 kit.paint 软边画笔（中间深、两侧一路淡出、两头收尖），不再 fillRect；
//   · 桌面、桌屉柜、文件柜、椅垫、门框门扇、窗衬板窗台、暖气片、消火栓箱、冷水器、售货机、隔断、会议桌倒角（b.box bevel）；
//   · 发黄的吊顶板、涂黑窗上刷不匀的那一道、白板上没擦净的笔迹改成软边贴花（低画质不画贴花，这三处照改前的样子画）；
//     墙上擦痕、地毯污渍、门把手手印、杯印、阀门锈水用贴花补几处。
// 其余（出口、实体、物品、据点、危害机制）仍只按 wikidot-cn 这一版，conflicts 里其他版本的细节一律不借：
//   不用 fandom 版本的生存等级/"完全没有敌对生命"/能看见暴雨浓雾假天空的清澈玻璃窗/荧光灯+雨声+管道声/12–18°C/
//   约 120000 km²/自动售货机+Greek Fire/M.E.G. Base Opportunity、B.A.S.、S.R.C./Level 3/30/54/16/34/37/47 入口表与
//   Level 197/156/14/332/The Void/4.3 出口表/"大多数非常规出口通往 The Void"；不添加"最佳补给会面点/建议囤积杏仁水"。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
const TAU = Math.PI * 2;

// =====================================================================
// 尺寸
// =====================================================================
// 2 m 一格、12×12 格：走廊一格宽，扣掉墙厚净宽约 1.73 m（真实办公楼走廊 1.5–1.8 m）；
// 房间 2–6 格见方（净 3.7–11.7 m），和参考图 2 那种空旷大办公室对得上
const SIZE = 24, N = 12, CELL = SIZE / N;
const H = 2.8;                          // 原文没给层高，用 kit 默认层高
const WT = 0.2 * 4 / 3, HT = WT / 2;    // kit.gridWalls 的默认墙厚（用户 2026-09-13 要求加厚 1/3）
const CW = WT - 0.008;                  // 自己砌的门洞墙/窗洞墙：两面各缩 4 mm，和格子墙永不共面
const TILE = CELL / 3;                  // 吊顶板 0.667 m 见方：三块正好一格，格子中心就是板中心，灯盘/风口都落在龙骨网格里
const TRIM_H = 0.1, TRIM_T = 0.015;     // 格子墙踢脚线（深灰橡胶踢脚，参考图 1 墙根那条黑边）
const TRIM_H2 = 0.102, TRIM_T2 = 0.017; // 自砌墙的踢脚线：比格子墙的高 2 mm、薄 1.5 mm，拐角重叠处不共面

// 边界参数全层一致（_TEMPLATE.md 7.2 节）。boundaryDensity 0.95 + straightness 0.95 ⇒ 马尔可夫"无墙→有墙"概率恰好 1：
// 区块交界线上的开口永远只有一格宽，每条交界线平均 1–2 个，每个开口就是一条走廊穿过去（楼道在区块之间接得上）；
// 开口少 ⇒ 每块只有四五条走廊汇在一起，不会织成一张网（不是迷宫）
const EDGE = { salt: 'L4-office', boundaryDensity: 0.95, straightness: 0.95, minOpenings: 1 };
// 内部墙全部由本层的楼道/房间规划决定（setWall 逐段锁定），kit 自己不撒墙、不掏房间
const GRID = Object.assign({ wallDensity: 0, roomChance: 0, maxRooms: 0, loopChance: 0, pillarChance: 0 }, EDGE);

// 预算（2026-10-01 起按画质分：高画质每块 ≤ 10000、低画质 ≤ 8000，_TEMPLATE.md 第 16 节）。
// 墙/门/窗/灯/出口是必需的，先建；家具、墙上小件、杂物按余量逐件加，超了就不加。
// 摆不摆一件家具只看「基础三角面」= 这块在低画质下会有的面数：高画质多出来的倒角、贴花、kit 构件细节零件另记一本账（X.extra），
// 不算进基础面数 ⇒ 两种画质摆出来的家具、碰撞体、刷新点、rng 消耗完全一样（联机两边画质不同也一致）。
// 以前直接数实际面数：高画质构件细节多，同一块会少摆几件家具（9×9 块里 29 块两种画质的碰撞体不一样）。
// 基础上限仍是改前的 7900（验收：家具、碰撞体、刷新点不许比改前少）⇒ 低画质和改前逐块一模一样，高画质和改前的低画质一样。
// 高画质细节最多再加 EXTRA_MAX，实际 ≤ 7900 + 1900 + 零头 < 10000。kit 的倒角/贴花/构件细节在本块实际面数到 9000 就停，
// 而基础面数到最后几乎都顶到 7900 ⇒ 家具摆完以后只剩约 1100 面的细节余量：所以要紧的细节先建（软边贴花挪到家具前面），
// 改前就有的痕迹换成贴花的那几处画不出来就照改前画硬边薄片（soft），痕迹本身永远不丢
const TRI_CAP = 7900;                   // 基础三角面上限（= 低画质实际面数 = 改前的上限，≤ 8000）
const EXTRA_MAX = 10000 - TRI_CAP - 200;   // 高画质细节账总上限 1900：实际 ≤ 7900 + 1900 + 零头（soft 贴花、最后一件的估算误差）< 10000
const BEVEL_CAP = 1600, DECAL_CAP = EXTRA_MAX;   // 倒角最多用到 1600（门窗先建、先拿到），剩下的留给贴花
const X = { extra: 0, decals: 0, bevelSkip: 0, softMiss: 0, decalMiss: 0 };   // 本块的细节账（buildChunk 开头清零；建块是同步的，不会两块交错）
const baseTris = b => triCount(b) - X.extra;
const can = (b, cost) => baseTris(b) + cost <= TRI_CAP;   // 每件可选构件先按它的最大（基础）三角面估一下，放得下才放
// 还能不能加高画质细节；只影响外观，不影响布局（位置、碰撞体、rng 一律和它无关）
const fine = (cost, cap) => X.extra + cost <= Math.min(cap || BEVEL_CAP, EXTRA_MAX);
const MAX_LIGHTS = 28;                  // 每块灯描述上限 30（第 16 节），留 2 盏余量

// =====================================================================
// 颜色（全部走 kit:prop / kit:glow 顶点色，不为任何家具新建材质）
// =====================================================================
const C = {
  door: 0xb3622a, doorDark: 0x7a4220,         // 参考图两张里的橙木色门扇
  frame: 0xd8d4ca,                            // 门框：米白漆
  frameWood: 0xb4834f,                        // 窗洞木衬板（参考图 1 右边那扇窗）
  winFrame: 0xd2d3cf, sill: 0xdcd8cc,
  steel: 0xb9bdc1, alu: 0xc9cbcc, dark: 0x2f3134, black: 0x1b1c1e, rubber: 0x2e3034,
  red: 0xb8281f, redDeep: 0x8a1c16, hose: 0xb0301f, label: 0xe8e4d8, white: 0xeceae4,
  radiator: 0xe2ddcf, radiatorDark: 0xc6c0b1, pipe: 0x9b9d99, valve: 0xa3302a,
  deskTop: 0xc3b69b, deskMetal: 0x6d7176, deskPanel: 0xa89b81, drawer: 0xb6a98e, handle: 0x3a3c3f,
  fabric: [0x3a4456, 0x565a60, 0x5b3a36, 0x3d4a40],
  partition: 0x6b7482, partitionCap: 0xa9adb2,
  cabinet: [0x9da2a7, 0xc8c0ab, 0x7f8790],
  shelfPost: 0x686c71, shelfBoard: 0x8c9196,
  cardboard: 0xa9865a, paper: 0xe8e5da, paperOld: 0xd8cfa8,
  board: 0xe9e8e2, cork: 0xa57a4c, woodFrame: 0x6e4d30,
  coolerBody: 0xdedad0, bottle: 0x98bfd6,
  vendBody: 0x2d4a78,
  stain: 0xb4a98e, ceilTile: 0xcfd0cb, plate: 0x484b50,   // stain：只给低画质的发黄吊顶板用（高画质是贴花）
  binders: [0x2f4f7a, 0x7a2f2f, 0x2f6a45, 0x333333, 0x8a7a2a],
  meg: 0x4f5a3c, megDark: 0x363e2b, fungus: 0xc9a650, fungusStem: 0xe0d6b8, wallpaper0: 0xc8b25a,
  glassDark: [0.05, 0.065, 0.08], sky: [1.32, 1.35, 1.4], exitGreen: [0.2, 1.4, 0.5], pict: [1.3, 1.35, 1.3],
};

// =====================================================================
// 贴图（仓库里没有 jpg，按规则只注册程序化画法 + noFile，免得每次进层 404）
// =====================================================================
// 白墙：米白乳胶漆，漆面轻微不匀、细颗粒；贴图纵向正好一个层高（repeatMeters v = 2.8），
// 所以贴图底边就是墙根：画墙根发灰的脏污和鞋尖踢的黑印、离地 0.7–1 m 的椅背磕碰刮痕、从吊顶渗下的淡黄水渍（"废弃"感）。
// 2026-10-01 用户「刮痕两边就需要细一点的过渡」：以前 256 px 上用 fillRect 画 1–2 px 的实心条，放到墙上是一刀切的硬边灰条。
// 现在 512 px（一个纹素约 4.7 mm）、全部用 kit.paint 软边画笔：刮痕横截面钟形（中间深、两侧一路淡到 0）、两头收尖、略弯，
// 一侧带一道很淡的亮翻边（刮开的漆皮边）；墙根脏污是一串高低不一、径向淡出的污渍团；水渍是顶边一团晕 + 往下越流越细越淡的水痕。
// 横向无缝（wrap: [s, 0]）；纵向不需要（一张贴图正好从墙根到吊顶）。不用 ctx.filter
BR.assets.registerProcedural('l4_wall', 512, (g, s) => {
  const r = U.rng('l4_wall');
  const P = kit.paint, WR = [s, 0];
  g.fillStyle = '#dcdad3'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 40; k++) {
    const x = r() * s, y = r() * s, rad = 36 + r() * 120, dark = r() < 0.55;
    for (const ox of [-s, 0, s]) {   // 横向无缝：跨边的斑块两头各画一次
      const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      gr.addColorStop(0, dark ? 'rgba(146,142,130,0.05)' : 'rgba(255,255,250,0.06)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  }
  for (let k = 0; k < 12800; k++) {   // 漆面细颗粒（单个纹素的明暗点，不是痕迹）
    const v = 168 + (r() * 72 | 0);
    g.fillStyle = `rgba(${v},${v},${v - 4},0.10)`;
    g.fillRect(r() * s | 0, r() * s | 0, 1, 1);
  }
  // 墙根：很淡的一层整宽渐变（从墙根往上 28 cm 淡到 0）+ 一串压扁的污渍团（高低、浓淡不一，外圈一路淡出）——不再是一条整齐的灰带。
  // 踢脚线高 10 cm（贴图底下 3.6% 被它挡住），污渍团中心放在 8–16 cm，露出来的是它往上淡出的那一半
  const base = g.createLinearGradient(0, s, 0, s * 0.9);
  base.addColorStop(0, 'rgba(78,74,64,0.16)'); base.addColorStop(0.55, 'rgba(78,74,64,0.05)'); base.addColorStop(1, 'rgba(78,74,64,0)');
  g.fillStyle = base; g.fillRect(0, s * 0.9, s, s * 0.1);
  for (let k = 0; k < 16; k++) {
    P.stain(g, r() * s, s * (0.943 + r() * 0.028), s * (0.028 + r() * 0.05), { squash: 0.38 + r() * 0.3, lobes: 4, alpha: 0.07 + r() * 0.09, color: [80, 76, 66], wrap: WR, seed: 'l4w-base' + k });
  }
  // 鞋尖踢出来的黑胶印：离地 10–25 cm，一小束顺着踢的方向的细擦痕，很淡（远看是墙根一抹灰，不是一个个黑点）
  for (let k = 0; k < 7; k++) {
    P.scuff(g, r() * s, s * (0.915 + r() * 0.04), s * (0.025 + r() * 0.035), (r() - 0.5) * 0.7, { count: 3 + (r() * 3 | 0), width: 2 + r(), spread: 2.5 + r() * 2.5, alpha: 0.09 + r() * 0.09, color: [62, 60, 58], wrap: WR, seed: 'l4w-kick' + k });
  }
  // 椅背、推车磕出来的刮痕：离地 0.72–1.0 m，细长（14–45 cm），全宽 2.5–4.5 px（1.2–2.1 cm，含两侧淡出）：
  // 横截面钟形，中间那一两毫米最深、往两侧一路淡到 0；两头收尖；一侧一道很淡的亮翻边（刮开的漆皮边）
  for (let k = 0; k < 9; k++) {
    P.scratch(g, r() * s, s * (0.643 + r() * 0.1), s * (0.06 + r() * 0.12), (r() - 0.5) * 0.2, {
      width: 2.5 + r() * 2, soft: 2.4, taper: 0.7, wobble: 0.3, alpha: 0.13 + r() * 0.17, color: [92, 90, 86], lip: { color: [252, 252, 248], alpha: 0.08 }, wrap: WR, seed: 'l4w-s' + k,
    });
  }
  // 椅子扶手蹭出来的一束平行细擦痕（几道挨得很近，叠成一抹）
  for (let k = 0; k < 3; k++) {
    P.scuff(g, r() * s, s * (0.66 + r() * 0.08), s * (0.07 + r() * 0.08), (r() - 0.5) * 0.12, { count: 4 + (r() * 3 | 0), width: 2, spread: 3 + r() * 3, alpha: 0.1 + r() * 0.08, color: [96, 94, 90], wrap: WR, seed: 'l4w-u' + k });
  }
  // 发丝细划痕（钥匙、推车角）：更细更淡，散在 0.5–1.5 m
  for (let k = 0; k < 7; k++) {
    P.scratch(g, r() * s, s * (0.46 + r() * 0.36), s * (0.04 + r() * 0.08), (r() - 0.5) * 0.6, { width: 2 + r() * 1.2, soft: 1.8, taper: 0.7, wobble: 0.2, alpha: 0.08 + r() * 0.08, color: [104, 102, 98], wrap: WR, seed: 'l4w-h' + k });
  }
  // 吊顶渗下来的淡黄水渍：顶边一团压扁的晕 + 1–3 道往下流、越往下越细越淡、末端收尖的水痕（以前是竖直的实心渐变条，两侧硬边）
  for (let k = 0; k < 6; k++) {
    const x = r() * s, len = s * (0.06 + r() * 0.26), n = 1 + (r() * 3 | 0);
    P.stain(g, x, 0, s * (0.025 + r() * 0.035), { squash: 0.5, lobes: 4, alpha: 0.07 + r() * 0.06, color: [170, 146, 92], wrap: WR, seed: 'l4w-wt' + k });
    for (let q = 0; q < n; q++) {
      P.drip(g, x + (r() - 0.5) * s * 0.04, 0, len * (q ? 0.35 + r() * 0.5 : 1), { width: 5 + r() * 8, alpha: 0.08 + r() * 0.07, color: [170, 146, 92], head: false, wrap: WR, seed: 'l4w-wd' + k + ':' + q });
    }
  }
}, { noFile: true });

// 深蓝灰圈绒地毯（参考图两张的地面）：深浅两色绒点 + 大块发旧，四向无缝
BR.assets.registerProcedural('l4_carpet', 256, (g, s) => {
  const r = U.rng('l4_carpet');
  g.fillStyle = '#363d4a'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 16; k++) {
    const x = r() * s, y = r() * s, rad = 24 + r() * 56, dark = r() < 0.5;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, dark ? 'rgba(20,24,32,0.16)' : 'rgba(96,106,124,0.10)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  for (let k = 0; k < 15000; k++) {
    const t = r();
    g.fillStyle = t < 0.45 ? 'rgba(80,90,110,0.55)' : t < 0.88 ? 'rgba(28,32,40,0.55)' : 'rgba(118,126,140,0.35)';
    g.fillRect(r() * s | 0, r() * s | 0, r() < 0.3 ? 2 : 1, 1);
  }
}, { noFile: true });

// 矿棉吸音板吊顶：一张贴图 2×2 块（每块 0.667 m），虫蛀状细孔 + 板边微凹 + T 型龙骨亮线与一侧阴影
BR.assets.registerProcedural('l4_ceiling', 256, (g, s) => {
  const r = U.rng('l4_ceiling');
  g.fillStyle = '#d5d6d2'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(118,120,116,${0.22 + r() * 0.3})`;
    g.fillRect(r() * s | 0, r() * s | 0, r() < 0.4 ? 2 : 1, 1);
  }
  for (let k = 0; k < 520; k++) {
    g.fillStyle = 'rgba(138,138,132,0.28)';
    if (r() < 0.5) g.fillRect(r() * s | 0, r() * s | 0, 2 + (r() * 4 | 0), 1);
    else g.fillRect(r() * s | 0, r() * s | 0, 1, 2 + (r() * 4 | 0));
  }
  const half = s / 2;
  g.lineWidth = 5; g.strokeStyle = 'rgba(96,98,94,0.10)';
  for (const ox of [0, half]) for (const oy of [0, half]) g.strokeRect(ox + 4, oy + 4, half - 8, half - 8);
  g.fillStyle = '#e9e9e5';
  for (const p of [0, half]) { g.fillRect(p, 0, 3, s); g.fillRect(0, p, s, 3); }
  g.fillStyle = 'rgba(78,80,78,0.35)';
  for (const p of [0, half]) { g.fillRect(p + 3, 0, 1, s); g.fillRect(0, p + 3, s, 1); }
}, { noFile: true });

function defineMaterials() {
  kit.mats({
    'L4:wall':  { tex: 'l4_wall', repeatMeters: [2.4, H], roughness: 0.93 },
    'L4:floor': { tex: 'l4_carpet', repeatMeters: 1.6, roughness: 1 },
    'L4:ceil':  { tex: 'l4_ceiling', repeatMeters: TILE * 2, roughness: 1 },
  });
}

// =====================================================================
// 小工具
// =====================================================================
const CORR = -1, WELL = -2, FREE = 0;
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];   // 方向：0 东(+x) 1 南(+z) 2 西(−x) 3 北(−z)
const idx = (i, j) => j * N + i;
const ci = c => c % N, cj = c => (c / N) | 0;
const inGrid = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
const center = c => ({ x: (ci(c) + 0.5) * CELL, z: (cj(c) + 0.5) * CELL });
// 格子 c 朝 d 那一面的墙段（kit 约定：'v' 段 (i,j) 在 x = i·CELL 上，'h' 段 (i,j) 在 z = j·CELL 上）
function edgeOf(c, d) {
  const i = ci(c), j = cj(c);
  return d === 0 ? { axis: 'v', i: i + 1, j } : d === 2 ? { axis: 'v', i, j } : d === 1 ? { axis: 'h', i, j: j + 1 } : { axis: 'h', i, j };
}
const ekey = e => (e.axis === 'v' ? 0 : 10000) + e.i * 100 + e.j;
const edgeEndsV = e => e.axis === 'v' ? [e.i * 100 + e.j, e.i * 100 + e.j + 1] : [e.i * 100 + e.j, (e.i + 1) * 100 + e.j];
// 门/窗不许和已有的门/窗共用一个墙角顶点：否则两扇门的门扇会在墙角互相挡住门洞（或打到窗下暖气片）
function cornerClash(P, e) {
  const a = edgeEndsV(e);
  for (const o of P.custom.values()) { const q = edgeEndsV(o); if (q[0] === a[0] || q[0] === a[1] || q[1] === a[0] || q[1] === a[1]) return true; }
  return false;
}
const edgeMid = e => e.axis === 'v' ? { x: e.i * CELL, z: (e.j + 0.5) * CELL } : { x: (e.i + 0.5) * CELL, z: e.j * CELL };
const isBorderEdge = e => e.axis === 'v' ? (e.i === 0 || e.i === N) : (e.j === 0 || e.j === N);
// 让构件本地 +Z 指向格子 front 那一侧（front 是这段墙两侧的格子之一）
function rotFront(e, front) {
  if (e.axis === 'h') return cj(front) === e.j ? 0 : Math.PI;
  return ci(front) === e.i ? Math.PI / 2 : -Math.PI / 2;
}
const rotInto = d => Math.atan2(DX[d], DZ[d]);      // 本地 +Z 指向方向 d
const rotToward = d => Math.atan2(-DX[d], -DZ[d]);  // 本地 −Z 指向方向 d
function shuffle(arr, rng) {
  for (let k = arr.length - 1; k > 0; k--) { const m = Math.floor(rng() * (k + 1)); const t = arr[k]; arr[k] = arr[m]; arr[m] = t; }
  return arr;
}
// 本块已经累积的实际三角面数（读 builder 的累加器，只读不改；含高画质细节，布局判断用 baseTris = 它减去 X.extra）
function triCount(b) {
  let t = 0;
  if (b._accs) b._accs.forEach(a => { if (a.idx) t += a.idx.length / 3; });
  return t;
}
// 构件本地矩形 → 区块本地 AABB（rot 只用直角）
function rectAt(x, z, rot, x0, z0, x1, z1) {
  const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot));
  let a = Infinity, bz = Infinity, cx = -Infinity, dz = -Infinity;
  for (const lx of [x0, x1]) for (const lz of [z0, z1]) {
    const wx = x + c * lx + s * lz, wz = z - s * lx + c * lz;
    if (wx < a) a = wx; if (wx > cx) cx = wx; if (wz < bz) bz = wz; if (wz > dz) dz = wz;
  }
  return [a, bz, cx, dz];
}
const overlap = (p, q) => p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3];

// 零件：全部进 kit:prop（顶点色），不出碰撞体（整件家具另给一个 AABB）
function BX(b, x, y, z, w, h, d, color, faces, rotY) {
  return b.box(x, y, z, w, h, d, 'kit:prop', { color, solid: false, faces: faces || 'all', uv: 'stretch', rotY });
}
function PL(b, x, y, z, w, h, facing, color, rotY) {
  return b.plane(x, y, z, w, h, 'kit:prop', { facing, color, uv: 'stretch', solid: false, rotY });
}
function GL(b, x, y, z, w, h, facing, color) {
  return b.plane(x, y, z, w, h, 'kit:glow', { facing, color, uv: 'solid', solid: false });
}
function CY(b, x, y, z, r, h, color, o) {
  return b.cylinder(x, y, z, r, h, 'kit:prop', Object.assign({ color, uv: 'stretch', solid: false, segments: 8 }, o));
}

// ---------- 细化（2026-10-01）：倒角零件、软边贴花、kit 构件 —— 高画质多出来的面都记进 X.extra，不占布局预算 ----------
const nFaces = f => (!f || f === 'all') ? 6 : (f === 'noBottom' || f === 'noTop') ? 5 : f === 'sides' ? 4 : f.length;
// 倒角零件（_TEMPLATE.md 5.4 节）：同 BX，多给 bevel 半径（米）和 bevelEdges。低画质、本块到了 kit 的细节上限、或细节账满了 → 普通盒
function BV(b, x, y, z, w, h, d, color, faces, bevel, edges, rotY) {
  const t0 = triCount(b), ok = fine(32);
  const p = b.box(x, y, z, w, h, d, 'kit:prop', { color, solid: false, faces: faces || 'all', uv: 'stretch', rotY, bevel: ok ? bevel : 0, bevelEdges: edges });
  const ex = triCount(b) - t0 - 2 * nFaces(faces);
  X.extra += ex;
  if (!ex) X.bevelSkip++;
  return p;
}
// 软边贴花（5.5 节）：低画质 kit 直接不画（返回 null），不消耗任何 rng —— 位置里用到的随机数一律在调用前算好
function DC(b, o) {
  if (!o.essential && !fine(2, DECAL_CAP)) { X.decalMiss++; return null; }
  const t0 = triCount(b);
  const p = kit.decal(b, o);
  const n = triCount(b) - t0;
  X.extra += n;
  if (n) X.decals++;
  else if (!lowQ()) X.decalMiss++;
  return p;
}
// soft() 里换掉改前硬边薄片的贴花：只在高画质调用（soft 在低画质根本不调 draw），带 essential ⇒ 不受 kit 的 9000 细节上限、也不受本层细节账限制
// （kit 约定 essential 免 DETAIL_TRI_CAP，_kit.js decal()）。它们画在家具后面（吊顶水渍的 rng 在家具之后才取），不这样的话
// 基础面数顶到 7900 的块里几乎全都画不出来、退回硬边薄片。每处净多 0–4 个面（贴花每片 2 面，薄片的 2 面已扣掉），一块最多二三十片
const DCs = (b, o) => DC(b, Object.assign({ essential: true }, o));
function scatter(b, surfaces, o) {
  if (!surfaces.length || !fine(2 * (o.max || 40), DECAL_CAP)) return 0;
  const t0 = triCount(b);
  const n = kit.scatterDecals(b, surfaces, o);
  X.extra += triCount(b) - t0;
  X.decals += n;
  return n;
}
// kit 构件（高画质自动加细节零件）：多出来的面记进 X.extra。低画质那一版有几个面，在一个草稿 builder 里传 detail:false
// 再建一遍量出来（草稿不 finish、不进场景，用完即弃；构件本身不吃 rng，草稿给一个常数流以防万一）。
// make(bb, lo)：lo 为 null 时建真的，为 { detail: false } 时建草稿 —— 里面用到的 rng 必须在 make 外面先取好，不能在 make 里取（会取两遍）
const NO_RNG = () => 0.5;
const KP_EST = 160;   // 一件 kit 构件高画质最多多出来的面（估计，留余量）：细节账快满时这件直接建低画质版，免得顶破 EXTRA_MAX
function kitProp(b, make) {
  if (!fine(KP_EST, EXTRA_MAX)) return make(b, { detail: false });   // 和低画质那一版一样：不多出面，X.extra 不动
  const t0 = triCount(b);
  const res = make(b, null);
  const sb = kit.builder(b.ctx, b.cx, b.cz, NO_RNG, { height: H });
  make(sb, { detail: false });
  X.extra += triCount(b) - t0 - triCount(sb);
  return res;
}
// 出口实物：楼梯间/电梯门也带细节档，同样量出低画质那一版（只量构件本身，kit.exit 的描述/工坊钩子不在草稿里跑）
function exitProp(b, o) {
  const t0 = triCount(b);
  const h = kit.exit(b, o);
  if (!h) return h;   // 创意工坊把这个出口删了：什么都没建，不能再减草稿那份（X.extra 会变负、布局预算算错）
  const sb = kit.builder(b.ctx, b.cx, b.cz, NO_RNG, { height: H });
  if (o.kind === 'stairs') kit.prop.stairwell(sb, 0, 0, 0, Object.assign({}, o.stairs, { detail: false }));
  else if (o.kind === 'elevator') kit.prop.elevator(sb, 0, 0, 0, Object.assign({}, o.elevator, { detail: false }));
  X.extra += triCount(b) - t0 - triCount(sb);
  return h;
}
// 改前就有的几处痕迹（发黄的吊顶板、白板上的笔迹、涂黑窗上刷不匀的那一道）换成了软边贴花，但痕迹本身不能丢：
// 低画质不画贴花（_TEMPLATE.md 第 16 节「低画质倒角/贴花一律关闭」），高画质也可能画不出来（细节账满、本块到了 kit 的 9000 细节上限）——
// 这两种情况都照改前画那块硬边薄片（slab），和改前一模一样。draw() 画出来了返回 true。
// 薄片的面数（slabTris）在两种画质都算基础面数（= 改前的实际面数）：高画质画了贴花、没画薄片，就从 X.extra 里扣掉这几个面
// ⇒ 基础面数在两种画质、以及和改前相比都一样，摆家具的判断一样
const lowQ = () => !!(BR.game && BR.game.settings && BR.game.settings.quality === 'low');
function soft(b, draw, slab, slabTris) {
  if (!lowQ() && draw()) { X.extra -= slabTris; return; }
  if (!lowQ()) X.softMiss++;
  slab();
}
// 构件上的小痕迹（杯印、手印、锈水）有没有、偏多少：按构件的世界位置派生一条随机流，不吃区块 rng（两种画质一样、加减贴花不挪后面的布局）
function markRng(b, tag) {
  const w = b.world(0, 0);
  return U.rng(b.seed, 'L4-mark-' + tag, Math.round(w.x * 20), Math.round(w.z * 20));
}

// =====================================================================
// 楼道 + 房间规划（每块独立，只吃本块 rng；交界线开口由 kit 边界哈希决定，两块算出来一致）
// =====================================================================
// 做法：交界线上的每个开口都是一条走廊的入口 → 从开口出发用带转弯代价/随机权重的最短路连到块内走廊网
// （先连到中心附近的一个"楼道节点"，后来的就近并入已有走廊）⇒ 走廊一格宽、会拐弯、在节点处分岔，不是迷宫；
// 再从走廊侧面伸出 1–2 条两三格长的尽头支路（死角）；剩下的格子按 2–4 格见方切成一个个房间，
// 每个房间至少开一扇门通走廊（没挨着走廊的就开门通隔壁已经连通的房间），整块保证连通
const NOISE = 1.3, TURN = 1.4, ADJ = 2.6, BORDER = 1.6, MERGE = 0.35;

function newRoom(P, i, j, w, d) {
  const R = { id: P.rooms.length, cells: [], rect: { i, j, w, d }, kind: 'empty', doors: [], keep: [], placed: [] };
  for (let jj = j; jj < j + d; jj++) for (let ii = i; ii < i + w; ii++) { P.reg[idx(ii, jj)] = R.id; R.cells.push(idx(ii, jj)); }
  P.rooms.push(R);
  return R;
}

// 带方向的 Dijkstra：状态 = 格 × 进入方向（转弯要额外代价 ⇒ 走廊有长直段）
function route(P, src, startDir, noise) {
  const reg = P.reg, S = N * N * 4;
  const dist = new Float64Array(S).fill(Infinity), from = new Int32Array(S).fill(-1);
  const hc = [], hs = [];
  const push = (c, s) => {
    hc.push(c); hs.push(s);
    let k = hc.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hc[p] <= hc[k]) break;
      const tc = hc[p]; hc[p] = hc[k]; hc[k] = tc; const ts = hs[p]; hs[p] = hs[k]; hs[k] = ts; k = p;
    }
  };
  const pop = () => {
    const c = hc[0], s = hs[0], lc = hc.pop(), ls = hs.pop();
    if (hc.length) {
      hc[0] = lc; hs[0] = ls;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hc.length && hc[l] < hc[m]) m = l;
        if (r < hc.length && hc[r] < hc[m]) m = r;
        if (m === k) break;
        const tc = hc[m]; hc[m] = hc[k]; hc[k] = tc; const ts = hs[m]; hs[m] = hs[k]; hs[k] = ts; k = m;
      }
    }
    return [c, s];
  };
  for (let d = 0; d < 4; d++) { const s = src * 4 + d; dist[s] = d === startDir ? 0 : TURN; push(dist[s], s); }
  while (hc.length) {
    const [c0, s] = pop();
    if (c0 > dist[s]) continue;
    const cell = s >> 2, pd = s & 3;
    if (cell !== src && reg[cell] === CORR) {
      const path = [];
      for (let t = s; t >= 0; t = from[t]) path.push(t >> 2);
      return path;
    }
    const i0 = ci(cell), j0 = cj(cell);
    for (let d = 0; d < 4; d++) {
      const ni = i0 + DX[d], nj = j0 + DZ[d];
      if (!inGrid(ni, nj)) continue;
      const nc = idx(ni, nj), r = reg[nc];
      if (r !== FREE && r !== CORR) continue;   // 预置房间/采光井是障碍
      let cost = r === CORR ? MERGE : 1 + noise[nc];
      if (d !== pd) cost += TURN;
      if (r !== CORR) {
        for (let q = 0; q < 4; q++) {
          const qi = ni + DX[q], qj = nj + DZ[q];
          if (!inGrid(qi, qj)) continue;
          const qc = idx(qi, qj);
          if (qc !== cell && reg[qc] === CORR) cost += ADJ;   // 不贴着已有走廊平行走（否则会并成两格宽的大厅）
        }
        if (ni === 0 || nj === 0 || ni === N - 1 || nj === N - 1) cost += BORDER;
      }
      const ns = nc * 4 + d, nd = c0 + cost;
      if (nd < dist[ns]) { dist[ns] = nd; from[ns] = s; push(nd, ns); }
    }
  }
  return null;
}

// 从走廊侧面伸出一条直的尽头支路（死角）。strict：两侧不能贴着别的走廊、不碰区块边缘格
function makeSpur(P, rng, lo, hi, forExit, strict) {
  const reg = P.reg, cand = [];
  for (let c = 0; c < N * N; c++) if (reg[c] === CORR && !P.spurCell.has(c)) for (let d = 0; d < 4; d++) cand.push(c * 4 + d);
  if (!cand.length) return null;
  for (let t = 0; t < 40; t++) {
    const s = cand[Math.floor(rng() * cand.length)], L = U.randInt(rng, lo, hi);
    const c0 = s >> 2, d = s & 3, i0 = ci(c0), j0 = cj(c0);
    const cells = [];
    let ok = true;
    for (let k = 1; k <= L && ok; k++) {
      const ni = i0 + DX[d] * k, nj = j0 + DZ[d] * k;
      const lim = strict ? 1 : 0;
      if (ni < lim || nj < lim || ni > N - 1 - lim || nj > N - 1 - lim) { ok = false; break; }
      const nc = idx(ni, nj);
      if (reg[nc] !== FREE || P.noWell.has(nc) && forExit) { ok = false; break; }
      const prev = k === 1 ? c0 : cells[k - 2];
      if (strict || forExit) {
        for (let q = 0; q < 4; q++) {
          const qi = ni + DX[q], qj = nj + DZ[q];
          if (!inGrid(qi, qj)) continue;
          const qc = idx(qi, qj);
          if (qc !== prev && reg[qc] === CORR) ok = false;
        }
      }
      cells.push(nc);
    }
    if (!ok) continue;
    const bi = i0 + DX[d] * (L + 1), bj = j0 + DZ[d] * (L + 1);
    if (!inGrid(bi, bj)) continue;
    const beyond = idx(bi, bj);
    if (forExit && reg[beyond] !== FREE) continue;
    for (const c of cells) { reg[c] = CORR; P.spurCell.add(c); }
    const end = cells[cells.length - 1];
    const sp = { cells, dir: d, end, beyond, endEdge: edgeOf(end, d), from: c0 };
    if (forExit) {
      // 出口占着尽头两格：尽头那面墙、两侧墙都不开门，也不许挨着采光井开窗
      P.noDoor.add(ekey(sp.endEdge));
      P.noWell.add(beyond);
      for (const c of cells.slice(-2)) for (let q = 0; q < 4; q++) {
        if (q === d || q === (d + 2) % 4) continue;
        P.noDoor.add(ekey(edgeOf(c, q)));
        const qi = ci(c) + DX[q], qj = cj(c) + DZ[q];
        if (inGrid(qi, qj)) P.noWell.add(idx(qi, qj));
      }
    }
    P.spurs.push(sp);
    return sp;
  }
  return null;
}

function wellOk(P, c, allow) {
  const i = ci(c), j = cj(c);
  if (i < 1 || j < 1 || i > N - 2 || j > N - 2) return false;
  if (P.reg[c] !== FREE || P.noWell.has(c)) return false;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const q = idx(i + di, j + dj);
    if (q !== c && q !== allow && P.reg[q] === WELL) return false;
  }
  return true;
}

function doorOpts(rng, open) {
  const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
  return { open, angle: 1.45 + r1 * 0.17, hinge: r2 < 0.5 ? -1 : 1, off: (r3 - 0.5) * 0.38, glass: r4 < 0.45 };
}
function addDoor(P, e, inC, outC, o) {
  const D = Object.assign({ type: 'door', axis: e.axis, i: e.i, j: e.j, inC, outC }, o);
  P.custom.set(ekey(e), D);
  return D;
}
// 房间 R 的某一面墙段，通向 want(格) 为真的邻格；排除区块边界、已经是门/窗的段、noDoor
function roomEdges(P, R, want) {
  const out = [];
  for (const c of R.cells) for (let d = 0; d < 4; d++) {
    const ni = ci(c) + DX[d], nj = cj(c) + DZ[d];
    if (!inGrid(ni, nj)) continue;
    const nc = idx(ni, nj);
    if (!want(nc)) continue;
    const e = edgeOf(c, d), k = ekey(e);
    if (P.custom.has(k) || P.noDoor.has(k) || cornerClash(P, e)) continue;
    out.push({ e, inC: c, outC: nc });
  }
  return out;
}
const edist = (a, b2) => { const p = edgeMid(a), q = edgeMid(b2); return Math.abs(p.x - q.x) + Math.abs(p.z - q.z); };

// 连通检查：门（开着的）和同一区域内部可走；采光井、关着的门不可走
function reachable(P) {
  const seen = new Uint8Array(N * N), reg = P.reg;
  let start = -1;
  for (let c = 0; c < N * N; c++) if (reg[c] === CORR) { start = c; break; }
  if (start < 0) return seen;
  const q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.pop();
    for (let d = 0; d < 4; d++) {
      const ni = ci(c) + DX[d], nj = cj(c) + DZ[d];
      if (!inGrid(ni, nj)) continue;
      const nc = idx(ni, nj);
      if (seen[nc] || reg[nc] === WELL) continue;
      const cu = P.custom.get(ekey(edgeOf(c, d)));
      const pass = cu ? (cu.type === 'door' && cu.open) : reg[nc] === reg[c];
      if (pass) { seen[nc] = 1; q.push(nc); }
    }
  }
  return seen;
}

function connectAll(P, rng) {
  for (let guard = 0; guard < 80; guard++) {
    const seen = reachable(P);
    let pick = null, pickSoft = null;
    for (let c = 0; c < N * N && !pick; c++) {
      if (!seen[c] || P.reg[c] === WELL) continue;
      for (let d = 0; d < 4 && !pick; d++) {
        const ni = ci(c) + DX[d], nj = cj(c) + DZ[d];
        if (!inGrid(ni, nj)) continue;
        const nc = idx(ni, nj);
        if (seen[nc] || P.reg[nc] === WELL) continue;
        const e = edgeOf(c, d), k = ekey(e), cu = P.custom.get(k);
        if (cu && cu.type !== 'door') continue;
        const roomIn = P.reg[nc] > 0 || P.reg[c] <= 0 ? nc : c;   // 门扇总是往房间里开，不挡走廊
        const cand = { e, inC: roomIn, outC: roomIn === nc ? c : nc, cu };
        if (P.noDoor.has(k) || !cu && cornerClash(P, e)) { if (!pickSoft) pickSoft = cand; } else pick = cand;
      }
    }
    const p = pick || pickSoft;
    if (!p) return;
    if (p.cu) { p.cu.open = true; if (!(p.cu.angle > 0)) p.cu.angle = 1.4; }
    else addDoor(P, p.e, p.inC, p.outC, doorOpts(rng, true));
  }
}

// 出生块：参考图 2 那间空旷的大办公室（7×5 格），出生点面朝北墙：两扇关着的橙木门、中间消防箱+落地灭火器、
// 右手边东墙两扇透亮的窗（后面是采光井）；西墙、南墙各一扇开着的门通楼道
function presetSpawn(P) {
  const reg = P.reg;
  for (let i = 1; i <= 10; i++) reg[idx(i, 3)] = CORR;
  for (let j = 4; j <= 10; j++) reg[idx(1, j)] = CORR;
  const R = newRoom(P, 2, 4, 7, 5);
  R.kind = 'spawn'; R.preset = true;
  const W = { cells: [idx(9, 4), idx(9, 5)], kind: 'bright', force: new Set([ekey({ axis: 'v', i: 9, j: 4 }), ekey({ axis: 'v', i: 9, j: 5 })]) };
  for (const c of W.cells) reg[c] = WELL;
  P.wells.push(W);
  R.doors.push(addDoor(P, { axis: 'h', i: 4, j: 4 }, idx(4, 4), idx(4, 3), { open: false, glass: true, hinge: 1, off: 0.12, angle: 0 }));
  R.doors.push(addDoor(P, { axis: 'h', i: 6, j: 4 }, idx(6, 4), idx(6, 3), { open: false, glass: true, hinge: -1, off: -0.1, angle: 0, exitSign: 'in' }));
  R.doors.push(addDoor(P, { axis: 'v', i: 2, j: 6 }, idx(2, 6), idx(1, 6), { open: true, angle: 1.45, hinge: 1, off: 0, glass: false }));
  R.doors.push(addDoor(P, { axis: 'h', i: 5, j: 9 }, idx(5, 8), idx(5, 9), { open: true, angle: 1.5, hinge: -1, off: 0.15, glass: true }));
}

function planChunk(b, g, rng, isSpawn, exitsHere, special) {
  const reg = new Int16Array(N * N);
  const P = { reg, rooms: [null], spurs: [], spurCell: new Set(), wells: [], custom: new Map(), noDoor: new Set(), noWell: new Set(), exitSpurs: [] };
  const noise = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) noise[k] = rng() * NOISE;

  if (isSpawn) presetSpawn(P);
  else { const hi = 3 + Math.floor(rng() * 6), hj = 3 + Math.floor(rng() * 6); reg[idx(hi, hj)] = CORR; }

  // 1) 交界线开口 → 走廊
  const seeds = [];
  for (let j = 0; j < N; j++) {
    if (!g.isWall('v', 0, j)) seeds.push([idx(0, j), 0]);
    if (!g.isWall('v', N, j)) seeds.push([idx(N - 1, j), 2]);
  }
  for (let i = 0; i < N; i++) {
    if (!g.isWall('h', i, 0)) seeds.push([idx(i, 0), 1]);
    if (!g.isWall('h', i, N)) seeds.push([idx(i, N - 1), 3]);
  }
  shuffle(seeds, rng);
  P.nSeeds = seeds.length;
  for (const [c, d] of seeds) {
    if (reg[c] === CORR) continue;
    if (reg[c] !== FREE) continue;
    const path = route(P, c, d, noise);
    if (path) for (const q of path) reg[q] = CORR;
    else reg[c] = CORR;
  }

  // 2) 出口专用的尽头支路（楼梯/电梯摆在尽头），再加 1–2 条普通死角
  for (const ex of exitsHere) {
    const sp = makeSpur(P, rng, 2, 3, true, true) || makeSpur(P, rng, 2, 2, true, false) || makeSpur(P, rng, 1, 1, true, false);
    if (sp) { sp.exit = ex; P.exitSpurs.push(sp); }
  }
  const nSpur = rng() < 0.55 ? 2 : 1;
  for (let k = 0; k < nSpur; k++) makeSpur(P, rng, 2, 3, false, true);

  // 3) 采光井（窗户背后那几格封死的竖井）
  const rw = rng(), nW = isSpawn ? 0 : rw < 0.18 ? 0 : rw < 0.7 ? 1 : 2;
  for (let k = 0; k < nW; k++) {
    const rPref = rng(), rExt = rng(), dExt = Math.floor(rng() * 4), kind = U.weighted(rng, [['bright', 0.62], ['black', 0.26], ['trap', 0.12]]);
    let c = -1;
    // 六成优先放在普通死角的尽头外：走廊走到头是一扇透亮的窗（参考图 1、2 远处那片亮）
    if (rPref < 0.6) for (const sp of P.spurs) if (!sp.exit && wellOk(P, sp.beyond)) { c = sp.beyond; break; }
    if (c < 0) {
      const list = [];
      for (let q = 0; q < N * N; q++) if (wellOk(P, q)) list.push(q);
      if (list.length) c = list[Math.floor(rng() * list.length)];
    }
    if (c < 0) break;
    const W = { cells: [c], kind, force: new Set() };
    reg[c] = WELL;
    if (rExt < 0.35) {
      const ni = ci(c) + DX[dExt], nj = cj(c) + DZ[dExt];
      if (inGrid(ni, nj) && wellOk(P, idx(ni, nj), c)) { reg[idx(ni, nj)] = WELL; W.cells.push(idx(ni, nj)); }
    }
    P.wells.push(W);
  }

  // 4) 剩下的格子切房间：按行扫描，每个空格起一个 2–4 格（偶尔 5–6 格的大办公区）的矩形
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (reg[idx(i, j)] !== FREE) continue;
    const big = rng() < 0.12;
    const tw = big ? U.randInt(rng, 5, 6) : U.weighted(rng, [[2, 0.18], [3, 0.42], [4, 0.4]]);
    const td = big ? U.randInt(rng, 4, 5) : U.weighted(rng, [[2, 0.18], [3, 0.42], [4, 0.4]]);
    let w = 0;
    while (w < tw && i + w < N && reg[idx(i + w, j)] === FREE) w++;
    let d = 1;
    while (d < td && j + d < N) {
      let ok = true;
      for (let k = 0; k < w; k++) if (reg[idx(i + k, j + d)] !== FREE) { ok = false; break; }
      if (!ok) break;
      d++;
    }
    newRoom(P, i, j, w, d);
  }
  // 一格宽的小条、三格以下的碎块：并进相邻最小的房间（变成 L 形房间），没有相邻房间就留作储藏间
  for (let id = 1; id < P.rooms.length; id++) {
    const R = P.rooms[id];
    if (!R || R.dead || R.preset) continue;
    const thinR = R.rect.w === 1 || R.rect.d === 1;
    if (!(R.cells.length <= 4 || thinR && R.cells.length <= 5)) continue;
    let best = null;
    for (const c of R.cells) for (let d = 0; d < 4; d++) {
      const ni = ci(c) + DX[d], nj = cj(c) + DZ[d];
      if (!inGrid(ni, nj)) continue;
      const o = reg[idx(ni, nj)];
      if (o > 0 && o !== id && !P.rooms[o].dead && !P.rooms[o].preset && P.rooms[o].cells.length + R.cells.length <= 20 && (!best || P.rooms[o].cells.length < best.cells.length)) best = P.rooms[o];
    }
    if (!best) continue;
    for (const c of R.cells) { reg[c] = best.id; best.cells.push(c); }
    R.dead = true;
  }
  P.alive = P.rooms.filter(R => R && !R.dead);

  // 5) 房间用途（按面积）。原文「几乎没有任何家具」+ 参考图的空房间 ⇒ 空房间始终占三四成
  for (const R of P.alive) {
    const r = rng();
    if (R.preset) continue;
    const a = R.cells.length, thin = R.rect.w === 1 || R.rect.d === 1;
    if (thin) R.kind = r < 0.45 ? 'storage' : 'empty';
    else if (a >= 12 && R.rect.w >= 3 && R.rect.d >= 3) R.kind = r < 0.34 ? 'empty' : r < 0.64 ? 'cubicles' : r < 0.84 ? 'office' : 'meeting';
    else if (a >= 6) R.kind = r < 0.36 ? 'empty' : r < 0.74 ? 'office' : r < 0.86 ? 'meeting' : 'storage';
    else R.kind = r < 0.4 ? 'empty' : r < 0.72 ? 'storage' : 'office';
  }
  // 据点（静态外观，用户 2026-09-13 范围决定）：M.E.G. Omega 基地挨着通往 Level 5 的楼梯（原文「靠近一个前往 Level 5 及 Level 6 的入口」）
  if (special.meg) {
    const sp = P.exitSpurs.find(s => s.exit && s.exit.def.to === '5');
    let best = null, bestScore = -1;
    for (const R of P.alive) {
      if (R.preset || R.cells.length < 4) continue;
      let near = 0;
      if (sp) for (const c of R.cells) for (const s of sp.cells) if (Math.abs(ci(c) - ci(s)) + Math.abs(cj(c) - cj(s)) === 1) near = 1;
      const score = near * 100 + R.cells.length;
      if (score > bestScore) { bestScore = score; best = R; }
    }
    if (best) best.kind = 'meg';
  }
  if (special.camp) {
    let best = null;
    for (const R of P.alive) if (!R.preset && R.kind !== 'meg' && R.cells.length >= 4 && (!best || R.cells.length > best.cells.length)) best = R;
    if (best) best.kind = special.camp;
  }

  // 6) 门：每个挨着走廊的房间开一扇（大房间有时两扇），有时再加一扇关着的（参考图 2 那两扇并排关着的门）
  const isCorr = c => reg[c] === CORR;
  for (const R of P.alive) {
    const r1 = rng(), r2 = rng(), r3 = rng();
    if (R.preset) continue;
    const cand = roomEdges(P, R, isCorr);
    if (!cand.length) continue;
    const first = cand[Math.floor(r1 * cand.length)];
    R.doors.push(addDoor(P, first.e, first.inC, first.outC, doorOpts(rng, true)));
    if (R.cells.length >= 12 && cand.length >= 3 && r2 < 0.4) {
      let far = null, fd = 0;
      for (const c of cand) { const dd = edist(c.e, first.e); if (dd > fd && !P.custom.has(ekey(c.e)) && !cornerClash(P, c.e)) { fd = dd; far = c; } }
      if (far && fd >= 6) R.doors.push(addDoor(P, far.e, far.inC, far.outC, doorOpts(rng, true)));
    }
    if (cand.length >= 2 && r3 < 0.3) {
      const c2 = cand.find(c => !P.custom.has(ekey(c.e)) && !cornerClash(P, c.e) && R.doors.every(D => edist(c.e, D) >= 3));
      if (c2) R.doors.push(addDoor(P, c2.e, c2.inC, c2.outC, doorOpts(rng, false)));
    }
  }
  // 房间之间偶尔有门相通（绕一点：从一间办公室穿到隔壁再出去）
  for (const R of P.alive) {
    const r = rng();
    if (R.preset || r >= 0.12) continue;
    const cand = roomEdges(P, R, c => reg[c] > 0 && reg[c] !== R.id);
    if (cand.length) { const c = cand[Math.floor(rng() * cand.length)]; R.doors.push(addDoor(P, c.e, c.inC, c.outC, doorOpts(rng, true))); }
  }
  connectAll(P, rng);
  // connectAll 补的门也记进房间，家具要避开
  for (const D of P.custom.values()) if (D.type === 'door') {
    for (const c of [D.inC, D.outC]) { const R = reg[c] > 0 ? P.rooms[reg[c]] : null; if (R && R.doors.indexOf(D) < 0) R.doors.push(D); }
  }

  // 7) 窗：采光井每一面挨着房间/走廊的墙七成开窗（至少一扇；每块最多 5 扇，控三角面）
  let nWin = 0;
  for (const W of P.wells) {
    const per = [];
    for (const c of W.cells) for (let d = 0; d < 4; d++) {
      const ni = ci(c) + DX[d], nj = cj(c) + DZ[d];
      if (!inGrid(ni, nj) || reg[idx(ni, nj)] === WELL) continue;
      per.push({ e: edgeOf(c, d), inC: c, outC: idx(ni, nj) });
    }
    let any = false;
    for (const p of per) {
      const r0 = rng(), r1 = rng(), r2 = rng(), r3 = rng();
      const k = ekey(p.e);
      if (!(W.force.has(k) || r0 < 0.7 && nWin < 5) || P.noDoor.has(k) || !W.force.has(k) && cornerClash(P, p.e)) continue;
      nWin++;
      P.custom.set(k, { type: 'window', axis: p.e.axis, i: p.e.i, j: p.e.j, inC: p.inC, outC: p.outC, well: W, blinds: W.kind === 'bright' && r1 < 0.4, slats: 3 + Math.floor(r2 * 7), radiator: r3 < 0.8 || W.force.has(k) });
      any = true;
    }
    if (!any && per.length) {
      const p = per.find(q => !P.noDoor.has(ekey(q.e)) && !cornerClash(P, q.e)) || per.find(q => !P.noDoor.has(ekey(q.e))) || per[0];
      P.custom.set(ekey(p.e), { type: 'window', axis: p.e.axis, i: p.e.i, j: p.e.j, inC: p.inC, outC: p.outC, well: W, blinds: false, slats: 0, radiator: true });
    }
  }
  return P;
}

// 把规划写进 kit 格子：每段内部墙都 setWall 锁定；门/窗那一段在格子里是"开口"，墙由本层自己砌
function applyWalls(P, g) {
  const reg = P.reg;
  for (let i = 1; i < N; i++) for (let j = 0; j < N; j++) {
    const e = { axis: 'v', i, j };
    if (P.custom.has(ekey(e))) { g.setWall('v', i, j, false); continue; }
    g.setWall('v', i, j, reg[idx(i - 1, j)] !== reg[idx(i, j)]);
  }
  for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
    const e = { axis: 'h', i, j };
    if (P.custom.has(ekey(e))) { g.setWall('h', i, j, false); continue; }
    g.setWall('h', i, j, reg[idx(i, j - 1)] !== reg[idx(i, j)]);
  }
}

// =====================================================================
// 自砌墙段（门洞、窗洞）
// =====================================================================
function edgeGeom(e) {
  if (e.axis === 'v') return { vert: true, L: e.i * CELL, s0: e.j * CELL, s1: (e.j + 1) * CELL, v0: [e.i, e.j], v1: [e.i, e.j + 1] };
  return { vert: false, L: e.j * CELL, s0: e.i * CELL, s1: (e.i + 1) * CELL, v0: [e.i, e.j], v1: [e.i + 1, e.j] };
}
// 端点：顶点上有 kit 画的墙（它的端头已经把顶点那一小方块填满）就缩进半个墙厚；
// 没有的话（顶点周围全是自砌段）在顶点立一根墙厚的小方柱，两边都缩到柱面
function edgeEnds(b, g, P, eg) {
  const kitAt = (vi, vj) => g.isWall('v', vi, vj - 1) || g.isWall('v', vi, vj) || g.isWall('h', vi - 1, vj) || g.isWall('h', vi, vj);
  const ins = v => {
    if (kitAt(v[0], v[1])) return HT;
    const k = v[0] * 100 + v[1];
    if (!P.posts.has(k)) {
      P.posts.add(k);
      const x = v[0] * CELL, z = v[1] * CELL;
      b.aabb(x - CW / 2, 0, z - CW / 2, x + CW / 2, H, z + CW / 2, 'L4:wall', { faces: 'sides', solid: true });
      b.aabb(x - CW / 2 - TRIM_T2, 0, z - CW / 2 - TRIM_T2, x + CW / 2 + TRIM_T2, TRIM_H2 + 0.002, z + CW / 2 + TRIM_T2, 'kit:prop', { faces: 'noBottom', solid: false, color: C.rubber });
    }
    return CW / 2;
  };
  return { u0: Math.max(0, eg.s0 + ins(eg.v0)), u1: Math.min(SIZE, eg.s1 - ins(eg.v1)) };
}
function wallBox(b, eg, u0, u1, y0, y1, faces) {
  if (u1 - u0 < 0.002) return;
  const t = CW / 2;
  if (eg.vert) b.aabb(eg.L - t, y0, u0, eg.L + t, y1, u1, 'L4:wall', { faces, solid: true });
  else b.aabb(u0, y0, eg.L - t, u1, y1, eg.L + t, 'L4:wall', { faces, solid: true });
}
// side：+1 只画 +x/+z 那一面，−1 只画 −x/−z 那一面，0 两面都画
function wallTrim(b, eg, u0, u1, side) {
  if (u1 - u0 < 0.01) return;
  const t = CW / 2;
  for (const s of [-1, 1]) {
    if (side && s !== side) continue;
    const a = s > 0 ? eg.L + t : eg.L - t - TRIM_T2;
    const faces = [eg.vert ? (s > 0 ? 'px' : 'nx') : (s > 0 ? 'pz' : 'nz'), 'py'];   // 只画朝外那面和顶面
    if (eg.vert) b.aabb(a, 0, u0, a + TRIM_T2, TRIM_H2, u1, 'kit:prop', { faces, solid: false, color: C.rubber });
    else b.aabb(u0, 0, a, u1, TRIM_H2, a + TRIM_T2, 'kit:prop', { faces, solid: false, color: C.rubber });
  }
}
const sideOf = (eg, front) => eg.vert ? (ci(front) === Math.round(eg.L / CELL) ? 1 : -1) : (cj(front) === Math.round(eg.L / CELL) ? 1 : -1);
const vfaces = (eg, extra) => (eg.vert ? ['px', 'nx'] : ['pz', 'nz']).concat(extra);

// ---------- 门：门洞墙 + 米白门框 + 橙木门扇（有的带竖条小玻璃窗）+ 把手 + 踢脚板 + 闭门器 + 门牌 + 房间一侧的开关面板 ----------
const DW = 0.92, DH = 2.05, FJ = 0.06, OW = DW + FJ * 2, FD = CW + 0.03, LT = 0.045;
function buildDoor(b, g, P, D) {
  const e = D, eg = edgeGeom(e), ends = edgeEnds(b, g, P, eg);
  const uc = (eg.s0 + eg.s1) / 2 + D.off;
  const a = uc - OW / 2, c = uc + OW / 2;
  wallBox(b, eg, ends.u0, a, 0, H, 'sides');
  wallBox(b, eg, c, ends.u1, 0, H, 'sides');
  wallBox(b, eg, a, c, DH + FJ, H, vfaces(eg, ['ny']));
  wallTrim(b, eg, ends.u0, a, 0);
  wallTrim(b, eg, c, ends.u1, 0);
  D.stubs = [[ends.u0, a], [c, ends.u1]];
  D.uc = uc;
  const pos = eg.vert ? { x: eg.L, z: uc } : { x: uc, z: eg.L };
  D.pos = pos; D.rot = rotFront(e, D.outC);
  b.push(pos.x, pos.z, D.rot);
  // 门框（比墙两面各凸出 1.5 cm，像门套）
  // 门套两根立框（顶面在眼高以上、永远看不见，省掉）。四条竖棱倒 1 cm 圆角、上框底面两条棱倒角（不再是刀切的方条）
  BV(b, -DW / 2 - FJ / 2, 0, 0, FJ, DH + FJ, FD, C.frame, ['px', 'nx', 'pz', 'nz'], 0.01, 'vertical');
  BV(b, DW / 2 + FJ / 2, 0, 0, FJ, DH + FJ, FD, C.frame, ['px', 'nx', 'pz', 'nz'], 0.01, 'vertical');
  BV(b, 0, DH, 0, DW, FJ, FD, C.frame, ['ny', 'pz', 'nz'], 0.01, 'horizontal');
  b.solid(-DW / 2 - FJ, 0, -FD / 2, -DW / 2, DH, FD / 2);
  b.solid(DW / 2, 0, -FD / 2, DW / 2 + FJ, DH, FD / 2);
  // 门扇：合页在 hs 一侧，向房间（本地 −Z）推开 angle 弧度。四条竖边倒 8 mm（开着的门正对人的就是这条边）
  const hs = D.hinge, th = D.open ? D.angle : 0, lx = -hs, hz = -LT / 2 - 0.006;
  b.push(hs * DW / 2, hz, -hs * th);
  BV(b, lx * DW / 2, 0.008, 0, DW - 0.012, DH - 0.014, LT, C.door, 'noBottom', 0.008, 'vertical');
  // 把手周围一圈手摸出来的灰印（两面，有的门有）：软边污渍贴花，中心在把手内侧一点
  {
    const m = markRng(b, 'door'), on = m() < 0.35, sz = 0.14 + m() * 0.08, dy = (m() - 0.5) * 0.08;
    if (on) for (const s of [1, -1]) DC(b, { kind: 'stain', x: lx * (DW - 0.13), y: 1.0 + dy, z: s * LT / 2, facing: s > 0 ? '+z' : '-z', w: sz, color: 0x3a2c20, opacity: 0.32 });
  }
  if (D.glass) {
    for (const s of [1, -1]) {
      const f = s > 0 ? '+z' : '-z';
      PL(b, lx * DW * 0.62, 1.0, s * (LT / 2 + 0.002), 0.2, 0.72, f, C.doorDark);
      GL(b, lx * DW * 0.62, 1.04, s * (LT / 2 + 0.005), 0.13, 0.64, f, C.glassDark);
    }
  }
  const kx = lx * (DW - 0.075);
  for (const s of [1, -1]) {
    const f = s > 0 ? '+z' : '-z';
    PL(b, kx, 0.97, s * (LT / 2 + 0.002), 0.055, 0.085, f, C.steel);                 // 把手底座
    BX(b, kx - lx * 0.05, 0.998, s * (LT / 2 + 0.028), 0.135, 0.022, 0.05, C.steel, ['py', 'ny', s > 0 ? 'pz' : 'nz']);  // 压把
    PL(b, lx * DW / 2, 0.012, s * (LT / 2 + 0.002), DW - 0.12, 0.2, f, 0x9fa3a6);    // 踢脚板
  }
  BX(b, lx * 0.26, DH - 0.15, -(LT / 2 + 0.034), 0.3, 0.062, 0.062, 0x8d9094, ['px', 'nx', 'py', 'ny', 'nz']);   // 闭门器
  b.pop();
  if (D.open) {
    const hx = hs * DW / 2, tx = hx + lx * DW * Math.cos(th), tz = hz - DW * Math.sin(th);
    const lr = [Math.min(hx, tx) - 0.025, Math.min(hz, tz) - 0.02, Math.max(hx, tx) + 0.025, Math.min(-0.03, Math.max(hz, tz))];
    b.solid(lr[0], 0, lr[1], lr[2], DH, lr[3]);
    // 推开的门扇占着房间里一块地：记成区块本地 AABB，摆家具/查通行时当障碍（窄房间里门扇+垃圾桶会把路堵死）
    D.leafRect = rectAt(pos.x, pos.z, D.rot, lr[0], lr[1], lr[2], lr[3]);
  } else {
    b.solid(-DW / 2, 0, -0.06, DW / 2, DH, 0.02);
  }
  // 门牌（走廊一侧门楣上）/ 出口灯（有 exitSign 的门）
  if (D.exitSign === 'in') exitSign(b, 0, DH + 0.2, -(CW / 2 + 0.026), Math.PI, false);
  else if (D.exitSign === 'out') exitSign(b, 0, DH + 0.2, CW / 2 + 0.026, 0, false);
  else if (P.reg[D.outC] === CORR) {
    PL(b, 0, DH + 0.2, CW / 2 + 0.003, 0.24, 0.1, '+z', C.plate);
    PL(b, 0, DH + 0.23, CW / 2 + 0.005, 0.17, 0.035, '+z', C.white);
  }
  // 房间一侧：锁舌那边的开关面板
  PL(b, lx * (OW / 2 + 0.07), 1.08, -(CW / 2 + 0.003), 0.08, 0.12, '-z', 0xe4e1d8);
  PL(b, lx * (OW / 2 + 0.07), 1.115, -(CW / 2 + 0.005), 0.028, 0.05, '-z', 0xcfcbc0);
  b.pop();
}

// ---------- 窗：窗洞墙 + 浅木色衬板 + 窗台板 + 铝框中梃 + 井里的天光（或涂黑/陷阱）+ 百叶 + 窗下暖气片 ----------
const WW = 1.2, WL = 0.025, OWW = WW + WL * 2, SILL = 0.85, HEAD = 2.2;
function buildWindow(b, g, P, Wd) {
  const eg = edgeGeom(Wd), ends = edgeEnds(b, g, P, eg);
  const mid = (eg.s0 + eg.s1) / 2, a = mid - OWW / 2, c = mid + OWW / 2;
  const side = sideOf(eg, Wd.outC);
  wallBox(b, eg, ends.u0, a, 0, H, 'sides');
  wallBox(b, eg, c, ends.u1, 0, H, 'sides');
  wallBox(b, eg, a, c, 0, SILL, vfaces(eg, ['py']));
  wallBox(b, eg, a, c, HEAD, H, vfaces(eg, ['ny']));
  wallTrim(b, eg, ends.u0, a, side);
  wallTrim(b, eg, a, c, side);
  wallTrim(b, eg, c, ends.u1, side);
  const pos = eg.vert ? { x: eg.L, z: mid } : { x: mid, z: eg.L };
  b.push(pos.x, pos.z, rotFront(Wd, Wd.outC));
  const dz = CW + 0.024;
  // 窗洞木衬板：朝屋里那条边倒 8 mm；窗台板上沿三条棱倒 1 cm
  BV(b, -OWW / 2 + WL / 2, SILL, 0, WL, HEAD - SILL, dz, C.frameWood, ['px', 'nx', 'pz'], 0.008, 'vertical');
  BV(b, OWW / 2 - WL / 2, SILL, 0, WL, HEAD - SILL, dz, C.frameWood, ['px', 'nx', 'pz'], 0.008, 'vertical');
  BV(b, 0, HEAD - WL, 0, WW, WL, dz, C.frameWood, ['ny', 'pz'], 0.008, 'horizontal');
  BV(b, 0, SILL + 0.002, 0.045, OWW + 0.1, 0.03, CW + 0.09, C.sill, ['py', 'pz', 'px', 'nx', 'ny'], 0.01, 'top');
  // 铝窗框：型材朝外的棱倒 5–6 mm（铝型材本来就是圆角的）
  const fz = -0.03, fp = 0.045, y0 = SILL + 0.032, y1 = HEAD - WL, iw = WW;
  BV(b, -iw / 2 + fp / 2, y0, fz, fp, y1 - y0, fp, C.winFrame, ['pz', 'px', 'nx'], 0.006, 'vertical');
  BV(b, iw / 2 - fp / 2, y0, fz, fp, y1 - y0, fp, C.winFrame, ['pz', 'px', 'nx'], 0.006, 'vertical');
  BV(b, 0, y0, fz, iw - fp * 2, fp, fp, C.winFrame, ['pz', 'py'], 0.006, 'horizontal');
  BV(b, 0, y1 - fp, fz, iw - fp * 2, fp, fp, C.winFrame, ['pz', 'ny'], 0.006, 'horizontal');
  BX(b, 0, y0 + fp, fz, 0.04, y1 - y0 - fp * 2, 0.04, C.winFrame, ['pz', 'px', 'nx']);
  BX(b, 0, y0 + (y1 - y0) * 0.72, fz, iw - fp * 2, 0.035, 0.04, C.winFrame, ['pz', 'py', 'ny']);
  const pw = iw - fp * 2, ph = y1 - y0 - fp * 2;
  const kind = Wd.well.kind;
  if (kind === 'bright') GL(b, 0, y0 + fp, fz, pw, ph, '+z', C.sky);
  else if (kind === 'black') {
    PL(b, 0, y0 + fp, fz, pw, ph, '+z', 0x0f0f10);
    // 刷得不匀的几道：以前是一块硬边的浅黑矩形，现在是软边刷痕贴花（宽而淡的抹痕 + 顺向细刷丝，两头收尖）
    const m = markRng(b, 'paint');
    soft(b, () => {
      let ok = false;
      for (let k = 0; k < 2; k++) {
        if (DCs(b, { kind: 'drag', x: (m() - 0.5) * pw * 0.5, y: y0 + fp + ph * (0.4 + m() * 0.2), z: fz, facing: '+z', w: ph * (0.5 + m() * 0.2), h: pw * (0.22 + m() * 0.12), rot: Math.PI / 2 + (m() - 0.5) * 0.2, color: 0x34343a, opacity: 0.55 + m() * 0.25 })) ok = true;
        else if (!ok) break;   // 第一道就画不出来：照改前画那一道硬边的
      }
      return ok;
    }, () => PL(b, -pw * 0.18, y0 + fp + ph * 0.1, fz + 0.004, pw * 0.3, ph * 0.75, '+z', 0x1c1c1e), 2);   // 画不出贴花：改前那一道
  } else {
    GL(b, 0, y0 + fp, fz, pw, ph, '+z', C.glassDark);
    GL(b, pw * 0.28, y0 + fp + ph * 0.15, fz + 0.004, 0.05, ph * 0.7, '+z', [0.13, 0.14, 0.16]);   // 玻璃反光
    const w = b.world(0, 0.35);
    (b.data.trapWindows || (b.data.trapWindows = [])).push({ x: w.x, z: w.z, nextLure: 0, nextGrab: 0 });
  }
  if (Wd.blinds) {   // 拉了一半的百叶
    BX(b, 0, y1 - 0.055, 0.03, iw - 0.02, 0.045, 0.05, C.white);
    for (let k = 0; k < Wd.slats; k++) PL(b, 0, y1 - 0.105 - k * 0.052, 0.036, iw - 0.04, 0.04, '+z', 0xd9d6cc);
    BX(b, 0, y1 - 0.12 - Wd.slats * 0.052, 0.036, iw - 0.03, 0.025, 0.035, 0xc9c6bc);
    BX(b, iw / 2 - 0.07, y1 - 0.75, 0.05, 0.008, 0.7, 0.008, 0xbab6aa, ['pz', 'px', 'nx']);
  }
  if (Wd.radiator) {
    const rz = CW / 2 + 0.055 + 0.06;
    radiator(b, 0, rz, 0, 0.96, CW / 2 - rz);
    Wd.radRect = rectAt(pos.x, pos.z, rotFront(Wd, Wd.outC), -0.53, rz - 0.075, 0.58, rz + 0.055);   // 同 radiator() 的碰撞体
  }
  b.pop();
}

// =====================================================================
// 构件（比 kit 自带的细：更多零件，但全在 kit:prop / kit:glow 两个槽位里）
// =====================================================================
// 铸铁柱式暖气片（参考图 1 窗下那种）：背板 + 一排散热柱 + 上下联箱 + 两只脚 + 进水管和红色阀门。
// 散热柱朝外两条竖棱倒圆（铸铁柱本来是圆的）、上下联箱一圈棱倒角；有的阀门漏过水：墙上一道往下流的锈水、地毯上一摊潮印（软边贴花）。
// wallZ：墙面在本地的 z（贴锈水用）
function radiator(b, x, z, rot, W, wallZ) {
  const Hr = 0.64, D = 0.11, n = Math.max(5, Math.round(W / 0.1));
  b.push(x, z, rot);
  BX(b, 0, 0.1, -0.02, W, Hr - 0.16, 0.04, C.radiatorDark, ['pz', 'py', 'px', 'nx']);
  const pitch = W / n, cw = pitch * 0.64;
  for (let k = 0; k < n; k++) BV(b, -W / 2 + (k + 0.5) * pitch, 0.08, 0.004, cw, Hr - 0.1, D - 0.02, C.radiator, ['pz', 'px', 'nx'], Math.min(0.02, cw * 0.32), 'vertical');
  BV(b, 0, Hr - 0.045, 0, W + 0.02, 0.035, D + 0.012, C.radiator, ['py', 'pz', 'px', 'nx', 'ny'], 0.012, 'top');
  BV(b, 0, 0.055, 0, W + 0.02, 0.035, D + 0.012, C.radiator, ['pz', 'px', 'nx', 'py'], 0.012, 'top');
  for (const s of [-1, 1]) BX(b, s * (W / 2 - 0.06), 0, 0, 0.05, 0.056, 0.07, C.radiatorDark, ['pz', 'px']);
  CY(b, W / 2 + 0.07, 0, -0.01, 0.017, 0.44, C.pipe, { segments: 6, caps: false });
  BX(b, W / 2 + 0.035, 0.44, -0.01, 0.08, 0.03, 0.03, C.pipe, ['pz', 'py', 'ny']);
  BX(b, W / 2 + 0.07, 0.36, -0.01, 0.045, 0.05, 0.045, C.valve);
  {
    const m = markRng(b, 'rad'), leak = m() < 0.5, h = 0.24 + m() * 0.1, sw = 0.24 + m() * 0.12;
    if (leak) {
      // 锈水比立管（直径 3.4 cm）宽、往外侧错开 3.5 cm：正对着看也露在管子旁边（以前 7 cm 宽、正好躲在管子后面，几乎看不见）
      DC(b, { kind: 'rust', x: W / 2 + 0.105, y: 0.37 - h / 2, z: wallZ, facing: '+z', w: 0.11, h, color: 0x8a5c38, opacity: 0.55 });
      // 地毯上的潮印带一点锈色（以前是深蓝灰，和深蓝地毯几乎一个颜色）
      DC(b, { kind: 'stain', x: W / 2 + 0.05, y: 0, z: 0.03, facing: 'up', w: sw, color: 0x2c2118, opacity: 0.55 });
    }
  }
  b.solid(-W / 2 - 0.05, 0, -D / 2 - 0.02, W / 2 + 0.1, Hr, D / 2);
  b.pop();
}

// 手提式灭火器：红瓶身 + 瓶肩 + 黑阀头 + 压把 + 提把 + 顺瓶身垂下的喷管 + 白标签；onWall 挂在墙上的托架上
function extinguisher(b, x, z, rot, onWall) {
  b.push(x, z, rot);
  const r = 0.075, y0 = onWall ? 0.34 : 0, zc = onWall ? r + 0.03 : 0;
  if (onWall) {
    BX(b, 0, y0 - 0.04, 0.008, 0.07, 0.62, 0.016, C.dark, ['pz', 'px', 'nx', 'py', 'ny']);
    BX(b, 0, y0 + 0.44, 0.04, 0.1, 0.03, 0.06, C.dark);
    PL(b, 0, y0 + 0.72, 0.004, 0.2, 0.2, '+z', 0xc2261c);    // 墙上的红色"灭火器"标识
    PL(b, 0, y0 + 0.76, 0.008, 0.12, 0.05, '+z', C.white);
  }
  CY(b, 0, y0, zc, r, 0.46, C.red, { segments: 10, caps: false });   // 瓶底贴地/朝下看不见，瓶顶被瓶肩盖住
  CY(b, 0, y0 + 0.46, zc, r, 0.05, C.red, { rTop: r * 0.45, segments: 10, caps: false });
  BX(b, 0, y0 + 0.51, zc, 0.04, 0.05, 0.04, C.black);
  BX(b, 0.03, y0 + 0.565, zc, 0.13, 0.016, 0.03, C.black);
  BX(b, -0.015, y0 + 0.535, zc, 0.08, 0.014, 0.026, C.steel);
  BX(b, -r - 0.01, y0 + 0.13, zc, 0.018, 0.4, 0.018, C.black, ['px', 'nx', 'pz', 'nz']);
  BX(b, -r - 0.01, y0 + 0.09, zc, 0.028, 0.05, 0.028, C.black, ['px', 'nx', 'pz', 'nz', 'ny']);
  PL(b, 0, y0 + 0.13, zc + r + 0.002, 0.08, 0.17, '+z', C.label);
  PL(b, 0, y0 + 0.24, zc + r + 0.005, 0.08, 0.03, '+z', 0x3a3c3f);
  if (!onWall) b.solid(-0.1, 0, zc - 0.1, 0.1, 0.62, zc + 0.1);
  b.pop();
}

// 消火栓箱（参考图 2 左边墙上那只暗红箱子）：箱体 + 铝门框 + 玻璃后面一圈红色水带 + 门把 + 白色字牌
function hoseBox(b, x, z, rot) {
  const W = 0.68, Hh = 0.8, D = 0.2, y0 = 0.78;
  b.push(x, z, rot);
  BV(b, 0, y0, D / 2, W, Hh, D, C.redDeep, ['pz', 'px', 'nx', 'py', 'ny'], 0.012, 'all');   // 钣金箱体一圈棱倒角
  PL(b, 0, y0 + 0.03, D + 0.003, W - 0.05, Hh - 0.06, '+z', 0xb9bbbd);
  GL(b, 0, y0 + 0.1, D + 0.007, W - 0.17, Hh - 0.28, '+z', [0.2, 0.06, 0.05]);
  b.cylinder(0, y0 + 0.39, D + 0.012, 0.19, 0.004, 'kit:prop', { axis: 'z', segments: 12, color: C.hose, uv: 'stretch', solid: false });
  b.cylinder(0, y0 + 0.39, D + 0.018, 0.07, 0.004, 'kit:prop', { axis: 'z', segments: 8, color: 0x5a5c5e, uv: 'stretch', solid: false });
  BX(b, W / 2 - 0.07, y0 + 0.34, D + 0.012, 0.025, 0.13, 0.02, C.steel);
  PL(b, 0, y0 + Hh - 0.13, D + 0.006, 0.32, 0.07, '+z', C.white);
  PL(b, 0, y0 + Hh - 0.115, D + 0.009, 0.24, 0.035, '+z', 0xb8281f);
  b.solid(-W / 2, y0, 0, W / 2, y0 + Hh, D);
  b.pop();
}

// 绿色安全出口灯箱：挂墙（只有正面）或吊在天花板上（两面发光）
function exitSign(b, x, y, z, rot, hanging) {
  b.push(x, z, rot);
  if (hanging) for (const s of [-1, 1]) BX(b, s * 0.12, y + 0.16, 0, 0.008, H - y - 0.16, 0.008, C.dark, ['px', 'nx', 'pz', 'nz']);
  BX(b, 0, y, 0, 0.38, 0.16, 0.05, 0xe6e6e0);
  for (const s of [1, -1]) {
    if (!hanging && s < 0) continue;
    const f = s > 0 ? '+z' : '-z';
    GL(b, 0, y + 0.02, s * 0.028, 0.34, 0.12, f, C.exitGreen);
    GL(b, s * -0.08, y + 0.035, s * 0.031, 0.045, 0.09, f, C.pict);
    GL(b, s * 0.05, y + 0.07, s * 0.031, 0.14, 0.022, f, C.pict);
  }
  b.pop();
}

// 办公桌（背靠墙，正面 +Z 朝人）：桌面 + 两侧金属板腿 + 挡板 + 三屉柜（抽屉面+拉手）+ 桌上显示器/键盘/文件
function desk(b, x, z, rot, rng, o) {
  const W = (o && o.w) || 1.4, D = 0.7, Hh = 0.74;
  const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
  b.push(x, z, rot);
  BV(b, 0, Hh - 0.028, 0, W, 0.028, D, C.deskTop, 'all', 0.01, 'top');      // 桌面：上沿四条棱倒 1 cm
  BX(b, 0, Hh - 0.034, D / 2 - 0.004, W, 0.006, 0.008, 0x8a7d66, ['pz']);   // 桌沿封边
  for (const s of [-1, 1]) BX(b, s * (W / 2 - 0.03), 0, 0, 0.03, Hh - 0.028, D - 0.08, C.deskMetal, ['px', 'nx', 'pz', 'nz']);
  BX(b, 0, 0.3, -D / 2 + 0.06, W - 0.08, 0.38, 0.015, C.deskPanel, ['pz', 'nz']);
  const px = W / 2 - 0.26;
  BV(b, px, 0.02, 0.02, 0.4, Hh - 0.05, D - 0.1, C.deskPanel, ['px', 'nx', 'pz'], 0.012, 'vertical');   // 三屉柜：朝外两条竖棱倒角
  for (let k = 0; k < 3; k++) {
    const y = 0.05 + k * 0.22;
    PL(b, px, y, 0.02 + (D - 0.1) / 2 + 0.003, 0.37, 0.2, '+z', C.drawer);
    PL(b, px, y + 0.15, 0.02 + (D - 0.1) / 2 + 0.006, 0.12, 0.018, '+z', C.handle);
  }
  if (r1 < 0.6) {   // 显示器：底座 + 支杆 + 屏幕（有时是老式 CRT）
    const mx = -0.18 + (r2 - 0.5) * 0.2;
    if (r3 < 0.5) {
      BX(b, mx, Hh, -0.12, 0.22, 0.015, 0.16, 0x2a2b2d, ['py', 'pz', 'px', 'nx']);
      BX(b, mx, Hh + 0.015, -0.15, 0.04, 0.2, 0.03, 0x2a2b2d, ['pz', 'px', 'nx']);
      BX(b, mx, Hh + 0.12, -0.13, 0.5, 0.32, 0.035, 0x232426);
      GL(b, mx, Hh + 0.14, -0.13 + 0.0185, 0.46, 0.28, '+z', 0.025);
    } else {
      BV(b, mx, Hh, -0.14, 0.4, 0.36, 0.34, 0xd6cfbe, ['py', 'pz', 'px', 'nx'], 0.03, 'all');   // 老式 CRT：塑料壳圆角
      BV(b, mx, Hh + 0.04, -0.31, 0.3, 0.26, 0.14, 0xcac2af, ['py', 'px', 'nx', 'nz'], 0.03, 'all');
      GL(b, mx, Hh + 0.07, 0.031, 0.31, 0.24, '+z', 0.03);
    }
    BX(b, mx + 0.02, Hh, 0.14, 0.44, 0.022, 0.15, 0x303134, ['py', 'pz', 'px', 'nx']);   // 键盘
    PL(b, mx + 0.02, Hh + 0.026, 0.135, 0.4, 0.11, 'up', 0x46484c);
  }
  if (r4 < 0.7) { PL(b, 0.3, Hh + 0.003, 0.05, 0.21, 0.297, 'up', C.paper, r2 * 0.8); PL(b, 0.33, Hh + 0.006, 0.08, 0.21, 0.297, 'up', C.paperOld, -r3 * 0.6); }
  // 桌面上干掉的咖啡杯印（一两圈软边环）、桌面前沿手肘磨出来的一道擦痕
  {
    const m = markRng(b, 'desk'), ring = m() < 0.55, rx = W / 2 - 0.12 - m() * 0.1, rz = (m() - 0.5) * 0.36, two = m() < 0.4, sc = m() < 0.5;
    if (ring) {
      DC(b, { kind: 'water', x: rx, y: Hh, z: rz, facing: 'up', w: 0.095, color: 0x5e4630, opacity: 0.6 });
      if (two) DC(b, { kind: 'water', x: rx - 0.05, y: Hh, z: rz + 0.04, facing: 'up', w: 0.09, color: 0x5e4630, opacity: 0.4 });
    }
    if (sc) DC(b, { kind: 'scuff', x: -0.1 + rz, y: Hh, z: D / 2 - 0.07, facing: 'up', w: 0.32, rot: 0.04, color: 0x7d7060, opacity: 0.35 });
  }
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
}

// 办公转椅（座面朝 +Z，靠背在 −Z）：坐垫 + 靠背 + 靠背支杆 + 气压杆 + 底盘 + 五爪 + 五个脚轮（有的带扶手）
function chair(b, x, z, rot, rng) {
  const r1 = rng(), r2 = rng();
  const c = C.fabric[Math.floor(r1 * C.fabric.length)];
  b.push(x, z, rot);
  BV(b, 0, 0.44, 0, 0.47, 0.07, 0.45, c, 'all', 0.025, 'top');   // 坐垫：上沿圆鼓鼓的
  BV(b, 0, 0.6, -0.25, 0.44, 0.5, 0.06, c, 'all', 0.022, 'vertical');   // 靠背垫：两侧圆边
  BX(b, 0, 0.42, -0.22, 0.05, 0.22, 0.03, C.dark, ['px', 'nx', 'pz', 'nz']);
  CY(b, 0, 0.09, 0, 0.024, 0.33, C.dark, { segments: 6, caps: false });
  BX(b, 0, 0.4, 0, 0.2, 0.04, 0.2, C.dark, ['px', 'nx', 'pz', 'nz', 'ny']);
  for (let k = 0; k < 5; k++) {
    b.push(0, 0, k * TAU / 5);
    BX(b, 0, 0.065, 0.15, 0.04, 0.035, 0.28, C.dark, ['px', 'nx', 'py', 'pz']);
    BX(b, 0, 0, 0.29, 0.035, 0.065, 0.05, C.black, ['px', 'nx', 'py', 'pz', 'nz']);
    b.pop();
  }
  if (r2 < 0.4) for (const s of [-1, 1]) {
    BX(b, s * 0.255, 0.47, -0.04, 0.025, 0.2, 0.03, C.dark, ['px', 'nx', 'pz', 'nz']);
    BX(b, s * 0.255, 0.67, -0.02, 0.05, 0.025, 0.26, C.dark);
  }
  b.solid(-0.3, 0, -0.3, 0.3, 0.95, 0.3);
  b.pop();
}

// 会议室折叠椅：座面 + 靠背 + 两侧 U 形钢管
function stackChair(b, x, z, rot, c) {
  b.push(x, z, rot);
  BV(b, 0, 0.44, 0, 0.44, 0.04, 0.42, c, 'all', 0.012, 'top');
  BX(b, 0, 0.56, -0.2, 0.42, 0.3, 0.03, c);
  for (const s of [-1, 1]) {
    BX(b, s * 0.2, 0, 0.17, 0.02, 0.44, 0.02, C.steel, ['px', 'nx', 'pz', 'nz']);
    BX(b, s * 0.2, 0, -0.19, 0.02, 0.86, 0.02, C.steel, ['px', 'nx', 'pz', 'nz']);
  }
  b.solid(-0.25, 0, -0.25, 0.25, 0.9, 0.25);
  b.pop();
}

// 四屉文件柜：柜体 + 四个抽屉面（比柜体浅一点）+ 拉手 + 标签框；有时顶上压着纸箱
function fileCab(b, x, z, rot, rng) {
  const W = 0.47, Hh = 1.32, D = 0.62, r1 = rng(), r2 = rng();
  const c = C.cabinet[Math.floor(r1 * C.cabinet.length)];
  b.push(x, z, rot);
  BV(b, 0, 0, 0, W, Hh, D, c, 'noBottom', 0.014, 'all');   // 钢柜体：竖棱和顶沿倒 1.4 cm（抽屉面板离边 1.5 cm，落在平面上）
  const dh = (Hh - 0.06) / 4;
  for (let k = 0; k < 4; k++) {
    const y = 0.035 + k * dh;
    PL(b, 0, y + 0.01, D / 2 + 0.002, W - 0.03, dh - 0.02, '+z', 0xaeb2b6);
    BX(b, 0, y + dh * 0.58, D / 2 + 0.016, 0.13, 0.022, 0.028, C.handle, ['pz', 'py', 'ny', 'px', 'nx']);
    PL(b, 0, y + dh * 0.72, D / 2 + 0.004, 0.08, 0.035, '+z', C.label);
  }
  if (r2 < 0.3) { BV(b, 0.02, Hh, 0, 0.4, 0.26, 0.34, C.cardboard, 'noBottom', 0.01, 'top', 0.2); PL(b, 0.02, Hh + 0.264, 0, 0.07, 0.34, 'up', 0xcdb98e, 0.2); }
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
}

// 钢制货架：四根立柱 + 四层隔板 + 每层一样东西（一排文件盒 / 纸箱 / 空着）
function shelfUnit(b, x, z, rot, rng) {
  const W = 0.92, Hh = 1.85, D = 0.4;
  b.push(x, z, rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) BX(b, sx * (W / 2 - 0.015), 0, sz * (D / 2 - 0.015), 0.03, Hh, 0.03, C.shelfPost, ['px', 'nx', 'pz', 'nz']);
  for (let k = 0; k < 4; k++) {
    const y = 0.1 + k * 0.56;
    BX(b, 0, y, 0, W - 0.03, 0.02, D - 0.03, C.shelfBoard, ['py', 'ny', 'pz']);
    const r = rng(), col = C.binders[Math.floor(rng() * C.binders.length)];
    if (r < 0.42) {
      BX(b, -0.12, y + 0.022, 0.01, 0.6, 0.3, 0.28, col, ['pz', 'py', 'px', 'nx']);
      for (let q = 0; q < 4; q++) PL(b, -0.37 + q * 0.16, y + 0.03, 0.152, 0.012, 0.28, '+z', 0x1e1f21);
      PL(b, -0.12, y + 0.2, 0.151, 0.5, 0.05, '+z', C.label);
    } else if (r < 0.78) {
      BX(b, 0.12, y + 0.022, 0, 0.44, 0.28, 0.34, C.cardboard, ['pz', 'py', 'px', 'nx']);
      PL(b, 0.12, y + 0.302, 0, 0.07, 0.34, 'up', 0xcdb98e);
    }
  }
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
}

// 白板（挂墙，本地 z = 0 是墙面）：铝框 + 板面 + 笔槽 + 没擦干净的几道笔迹
function whiteboard(b, x, z, rot, rng) {
  b.push(x, z, rot);
  BV(b, 0, 0.9, 0.012, 1.3, 0.92, 0.024, C.alu, ['pz', 'px', 'nx', 'py', 'ny'], 0.007, 'all');   // 铝边框圆角
  b.plane(0, 0.93, 0.028, 1.24, 0.86, 'kit:prop', { facing: '+z', color: C.board, uv: 'stretch', solid: false, grain: false });   // 白板面不铺道具表面纹理，不然像脏大理石
  BX(b, 0, 0.87, 0.045, 1.1, 0.022, 0.06, C.alu, ['pz', 'py', 'px', 'nx']);
  // 没擦干净的几道笔迹：以前是硬边的彩色细条，现在是两头收尖、两侧淡出的软笔痕贴花（rng 取法、顺序和以前一样）
  for (let k = 0; k < 5; k++) {
    const sx = -0.42 + rng() * 0.84, sy = 1.15 + rng() * 0.5, sw = 0.12 + rng() * 0.32, blue = rng() < 0.7;
    soft(b, () => !!DCs(b, { kind: k % 2 ? 'hairline' : 'scratch', x: sx, y: sy + 0.006, z: 0.028, facing: '+z', w: sw, h: 0.016, rot: (k - 2) * 0.03, color: blue ? 0x58709e : 0xa05a5a, opacity: 0.6 }),
      () => PL(b, sx, sy, 0.031 + k * 0.001, sw, 0.012, '+z', blue ? 0x7d8fb0 : 0xb07d7d), 2);   // 画不出贴花：改前的细条
  }
  b.pop();
}

// 布告栏：木框 + 软木板 + 几张钉着的纸
function noticeBoard(b, x, z, rot, rng) {
  b.push(x, z, rot);
  BV(b, 0, 1.05, 0.012, 1.0, 0.72, 0.024, C.woodFrame, ['pz', 'px', 'nx', 'py', 'ny'], 0.007, 'all');
  PL(b, 0, 1.08, 0.028, 0.94, 0.66, '+z', C.cork);
  for (let k = 0; k < 5; k++) PL(b, -0.34 + rng() * 0.68, 1.12 + rng() * 0.36, 0.031 + k * 0.0012, 0.15, 0.2, '+z', rng() < 0.3 ? 0xe6dc98 : C.paper);
  b.pop();
}

// 挂钟：黑框 + 白表盘 + 时针分针（早就停了）
function wallClock(b, x, z, rot, rng) {
  b.push(x, z, rot);
  b.cylinder(0, 2.1, 0.02, 0.16, 0.04, 'kit:prop', { axis: 'z', segments: 12, color: C.dark, uv: 'stretch', solid: false });
  b.cylinder(0, 2.1, 0.041, 0.14, 0.002, 'kit:prop', { axis: 'z', segments: 12, color: C.white, uv: 'stretch', solid: false });
  b.plane(0, 2.1, 0.044, 0.012, 0.1, 'kit:prop', { facing: '+z', color: C.black, rotY: 0 });
  BX(b, 0.03 + rng() * 0.02, 2.095, 0.045, 0.08, 0.01, 0.003, C.black, ['pz']);
  b.pop();
}

// 饮水机（冷水器）：机身 + 取水凹槽 + 冷热龙头 + 接水盘 + 水桶 + 纸杯架
function cooler(b, x, z, rot) {
  b.push(x, z, rot);
  BV(b, 0, 0, 0, 0.32, 0.96, 0.32, C.coolerBody, 'noBottom', 0.022, 'all');   // 塑料机身圆角
  PL(b, 0, 0.58, 0.162, 0.22, 0.26, '+z', 0x6d7072);
  BX(b, -0.05, 0.74, 0.175, 0.03, 0.05, 0.03, 0x3f6fc2);
  BX(b, 0.05, 0.74, 0.175, 0.03, 0.05, 0.03, 0xc23f3f);
  BX(b, 0, 0.58, 0.17, 0.22, 0.015, 0.05, C.dark);
  CY(b, 0, 0.962, 0, 0.13, 0.36, C.bottle, { segments: 10 });
  CY(b, 0, 1.322, 0, 0.13, 0.06, C.bottle, { segments: 10, rTop: 0.05, caps: false });
  CY(b, 0.19, 0.55, 0.05, 0.035, 0.24, C.white, { segments: 6 });
  b.solid(-0.2, 0, -0.2, 0.2, 1.4, 0.2);
  b.pop();
}

// 自动售货机：机身 + 发光展示窗 + 五排货架（货品用彩色面片，不用小盒子）+ 投币面板 + 屏幕 + 出货口 + 顶部灯箱
function vendingL4(b, x, z, rot) {
  const W = 0.9, Hh = 1.82, D = 0.78, pal = [0xd23b2f, 0x2f6fd2, 0xe0c341, 0x3fa34d, 0xeeeeee, 0x7b3fa0, 0xd8a060];
  b.push(x, z, rot);
  BV(b, 0, 0, 0, W, Hh, D, C.vendBody, 'noBottom', 0.025, 'all');
  GL(b, -0.1, 0.6, D / 2 + 0.003, 0.58, 1.08, '+z', [1.12, 1.12, 1.02]);
  for (let r = 0; r < 5; r++) {
    PL(b, -0.1, 0.62 + r * 0.21, D / 2 + 0.005, 0.56, 0.015, '+z', 0x33363a);
    for (let k = 0; k < 4; k++) PL(b, -0.1 + (k - 1.5) * 0.135, 0.64 + r * 0.21, D / 2 + 0.006, 0.08, 0.15, '+z', pal[(r * 3 + k * 2) % pal.length]);
  }
  BX(b, 0.33, 0.8, D / 2 + 0.01, 0.16, 0.62, 0.02, 0x26282b);
  GL(b, 0.33, 1.28, D / 2 + 0.024, 0.11, 0.05, '+z', [0.35, 1.2, 0.5]);
  PL(b, 0.33, 1.0, D / 2 + 0.024, 0.08, 0.14, '+z', 0x8a8d90);
  GL(b, -0.1, 0.12, D / 2 + 0.003, 0.58, 0.3, '+z', 0.02);
  GL(b, 0, Hh - 0.2, D / 2 + 0.003, W - 0.1, 0.14, '+z', [1.25, 0.4, 0.32]);
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
}

// 朝上的圆盘/圆环（池沿顶面、池底）：kit 的 cylinder 顶盖是整块圆盘，会把池子里的水盖住
function discUp(b, x, y, z, r0, r1, seg, color) {
  const geo = r0 > 0 ? new THREE.RingGeometry(r0, r1, seg, 1) : new THREE.CircleGeometry(r1, seg);
  geo.rotateX(-Math.PI / 2);
  b.mesh(geo, 'kit:prop', { x, y, z, color, uv: 'stretch' });
  geo.dispose();
}
// 从里面看的开口圆筒（池壁内侧）：翻转三角形绕序、法线取反
function innerWall(b, x, y, z, r, h, seg, color) {
  const geo = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  geo.translate(0, h / 2, 0);
  const ia = geo.index.array;
  for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
  const na = geo.attributes.normal.array;
  for (let k = 0; k < na.length; k++) na[k] = -na[k];
  b.mesh(geo, 'kit:prop', { x, y, z, color, uv: 'stretch' });
  geo.dispose();
}
// 杏仁水喷水池（landmarks）：十二边形石砌池（外壁 + 池沿顶环 + 内壁 + 池底）+ 乳白水面（kit:water）+ 中心柱 + 承水盘（盘里也有水）+
// 出水口 + 顺着柱子流下的一道水 + 池沿上一圈深色水渍
function fountain(b, x, z) {
  const stone = 0xbdb7a7, rim = 0xcdc7b7, inner = 0x9d9786, milk = 0xe8dcc0;
  b.push(x, z, 0);
  CY(b, 0, 0, 0, 0.92, 0.42, stone, { segments: 12, caps: false });
  CY(b, 0, 0, 0, 0.95, 0.06, 0x8f8a7c, { segments: 12, caps: false });   // 贴地一圈深色勒脚（比池壁凸出 3 cm）
  discUp(b, 0, 0.42, 0, 0.78, 0.92, 12, rim);
  innerWall(b, 0, 0.2, 0, 0.78, 0.22, 12, inner);
  discUp(b, 0, 0.2, 0, 0, 0.78, 12, 0x6f6a5e);                          // 池底（隔着半透明的水隐约看得见）
  b.cylinder(0, 0.3, 0, 0.775, 0.02, 'kit:water', { segments: 12, color: milk, solid: false, caps: true });
  discUp(b, 0, 0.424, 0, 0.8, 0.83, 12, 0xa9a292);                      // 池沿内口一圈水渍（比顶环高 4 mm，不共面）
  CY(b, 0, 0.2, 0, 0.09, 0.69, 0xb7b2a0, { segments: 8, caps: false });
  CY(b, 0, 0.89, 0, 0.26, 0.06, rim, { segments: 10, rTop: 0.3, caps: false });
  discUp(b, 0, 0.89, 0, 0, 0.26, 10, inner);                            // 承水盘底（朝上，被下面的水面挡住大半）
  b.cylinder(0, 0.9, 0, 0.262, 0.035, 'kit:water', { segments: 10, color: milk, solid: false });
  CY(b, 0, 0.95, 0, 0.03, 0.12, C.steel, { segments: 6 });
  BX(b, 0.05, 1.03, 0, 0.07, 0.022, 0.022, C.steel);                    // 出水嘴
  b.cylinder(0.085, 0.935, 0, 0.012, 0.1, 'kit:water', { segments: 5, color: milk, solid: false, caps: false });   // 落下的一道水
  b.solid(-0.95, 0, -0.95, 0.95, 0.42, 0.95);
  b.pop();
}

// 办公隔断板：布面 + 铝压顶
function partition(b, x, z, rot, len) {
  b.push(x, z, rot);
  BV(b, 0, 0, 0, len, 1.22, 0.05, C.partition, ['px', 'nx', 'pz', 'nz'], 0.015, 'vertical');   // 布面板两头圆边
  BV(b, 0, 1.22, 0, len + 0.01, 0.03, 0.06, C.partitionCap, ['py', 'pz', 'nz', 'px', 'nx'], 0.01, 'top');   // 铝压顶圆角
  b.solid(-len / 2, 0, -0.03, len / 2, 1.25, 0.03);
  b.pop();
}

// 工位组：中间一道长隔断，两侧背靠背各 cols 个工位（隔断 + 桌 + 椅）
function cluster(b, x, z, rot, cols, rng) {
  const cw = 1.6, cd = 1.45, L = cols * cw;
  b.push(x, z, rot);
  partition(b, 0, 0, 0, L);
  for (const s of [-1, 1]) {
    for (let k = 0; k <= cols; k++) partition(b, -L / 2 + k * cw, s * (cd / 2 + 0.03), Math.PI / 2, cd - 0.02);
    for (let k = 0; k < cols; k++) {
      const dx = -L / 2 + (k + 0.5) * cw;
      desk(b, dx, s * 0.4, s > 0 ? 0 : Math.PI, rng, { w: 1.4 });
      if (rng() < 0.85) chair(b, dx + (rng() - 0.5) * 0.3, s * (1.05 + rng() * 0.25), (s > 0 ? Math.PI : 0) + (rng() - 0.5) * 0.9, rng);
    }
  }
  b.pop();
}

// 会议桌：桌面 + 两个板式桌腿 + 脚板 + 桌上散着的文件；椅子围一圈（有的被推开）
function meetingSet(b, x, z, rot, rng, n) {
  b.push(x, z, rot);
  BV(b, 0, 0.72, 0, 2.2, 0.035, 1.0, 0x8a6a4a, 'all', 0.012, 'top');
  for (const s of [-1, 1]) {
    BX(b, s * 0.75, 0.04, 0, 0.06, 0.68, 0.7, 0x5c5f63, ['px', 'nx', 'pz', 'nz']);
    BX(b, s * 0.75, 0, 0, 0.12, 0.04, 0.78, 0x5c5f63, ['py', 'px', 'nx', 'pz', 'nz']);
  }
  for (let k = 0; k < 3; k++) PL(b, -0.6 + rng() * 1.2, 0.758 + k * 0.003, -0.3 + rng() * 0.6, 0.21, 0.297, 'up', C.paper, rng() * TAU);
  b.solid(-1.1, 0, -0.5, 1.1, 0.755, 0.5);
  const c = C.fabric[Math.floor(rng() * C.fabric.length)];
  const seats = [[-0.6, 1], [0.1, 1], [0.75, 1], [-0.6, -1], [0.1, -1], [0.75, -1]];
  for (let k = 0; k < Math.min(n, seats.length); k++) {
    const [sx, sz] = seats[k];
    stackChair(b, sx + (rng() - 0.5) * 0.2, sz * (0.78 + rng() * 0.25), (sz > 0 ? Math.PI : 0) + (rng() - 0.5) * 0.5, c);
  }
  b.pop();
}

function trashBin(b, x, z) {
  CY(b, x, 0, z, 0.15, 0.36, 0x6a6e72, { rTop: 0.17, segments: 10, caps: false });
  CY(b, x, 0.26, z, 0.16, 0.004, 0xd8d4c8, { segments: 8 });
  b.solid(x - 0.17, 0, z - 0.17, x + 0.17, 0.36, z + 0.17);
}

function paperAt(b, x, z, rng) {
  PL(b, x, 0.003 + rng() * 0.005, z, 0.21, 0.297, 'up', rng() < 0.8 ? C.paper : C.paperOld, rng() * TAU);
}

// =====================================================================
// 房间内：墙边槽位（每段墙一个）+ 门/窗前的禁放区
// =====================================================================
function slotInfo(P, g, c, d) {
  const e = edgeOf(c, d), cu = P.custom.get(ekey(e));
  const status = cu ? cu.type : g.isWall(e.axis, e.i, e.j) ? 'wall' : 'open';
  const m = edgeMid(e), into = (d + 2) % 4;
  return { c, d, e, status, x: m.x, z: m.z, rot: rotInto(into) };
}
function roomSlots(P, g, R) {
  const { i, j, w, d } = R.rect, out = [];
  const add = (c, dd, k, n, lowDir) => {
    const s = slotInfo(P, g, c, dd);
    const into = (dd + 2) % 4, lxw = [DZ[into], -DX[into]];   // 本地 +x 在世界里的方向
    const low = lowDir[0] * lxw[0] + lowDir[1] * lxw[1];
    s.corner = (k === 0 ? low : 0) || (k === n - 1 ? -low : 0);
    out.push(s);
  };
  for (let k = 0; k < w; k++) { add(idx(i + k, j), 3, k, w, [-1, 0]); add(idx(i + k, j + d - 1), 1, k, w, [-1, 0]); }
  for (let k = 0; k < d; k++) { add(idx(i, j + k), 2, k, d, [0, -1]); add(idx(i + w - 1, j + k), 0, k, d, [0, -1]); }
  return out;
}
function roomKeepouts(P, R) {
  R.keep = [];
  for (const D of R.doors) {
    const eg = edgeGeom(D), inside = R.cells.indexOf(D.inC) >= 0 ? D.inC : D.outC;
    const s = sideOf(eg, inside), depth = inside === D.inC ? 1.4 : 1.1;
    const u0 = (D.uc != null ? D.uc : (eg.s0 + eg.s1) / 2) - OW / 2 - 0.35, u1 = u0 + OW + 0.7;
    const n0 = s > 0 ? eg.L : eg.L - depth, n1 = s > 0 ? eg.L + depth : eg.L;
    R.keep.push(eg.vert ? [n0, u0, n1, u1] : [u0, n0, u1, n1]);
  }
}
// 已经建好的固定障碍：推开在本房间里的门扇、本房间窗下的暖气片（家具不许压上去，通行检查也把它们算进去）
function roomFixed(P, R) {
  const inR = new Set(R.cells);
  for (const cu of P.custom.values()) {
    if (cu.type === 'door' && cu.leafRect && inR.has(cu.inC)) R.placed.push(cu.leafRect);
    else if (cu.type === 'window' && cu.radRect && inR.has(cu.outC)) R.placed.push(cu.radRect);
  }
}
function fits(R, r) {
  for (const k of R.keep) if (overlap(k, r)) return false;
  for (const k of R.placed) if (overlap(k, r)) return false;
  R.placed.push(r);
  if (!roomPassable(R)) { R.placed.pop(); return false; }
  return true;
}
// 摆完这件家具以后，房间里还有空地的每一格、每扇门里侧还能不能走到（0.2 m 网格洪泛，家具外扩玩家半径 0.3 m）。
// 走不通就不摆：不允许一张会议桌/一组工位把房间的另一半或另一扇门堵死（刷在那里的物品会拿不到）。
// 墙按真实厚度算：房间边界墙往里让 HT + 0.3；L 形房间内拐角处伸出来的墙头（顶点上有墙）四周也让出同样距离
const PST = 0.2, PPER = Math.round(CELL / PST), PR = 0.36;   // 玩家半径 0.3 + 6 cm 余量：不留"侧身才挤得过去"的缝
function passBase(R, P) {
  if (R.pb) return R.pb;
  let i0 = N, j0 = N, i1 = -1, j1 = -1;
  for (const c of R.cells) { i0 = Math.min(i0, ci(c)); j0 = Math.min(j0, cj(c)); i1 = Math.max(i1, ci(c)); j1 = Math.max(j1, cj(c)); }
  const W = (i1 - i0 + 1) * PPER, D = (j1 - j0 + 1) * PPER, gx0 = i0 * PPER, gz0 = j0 * PPER;
  const base = new Uint8Array(W * D), cellOf = new Int16Array(W * D).fill(-1);
  const inR = new Set(R.cells), inset = HT + PR;
  const diff = (a, b2) => P.reg[a] !== P.reg[b2];
  const vWall = (vi, vj) => {   // 顶点 (vi, vj) 连着的四段墙里有没有墙
    if (vj - 1 >= 0 && vi > 0 && vi < N && diff(idx(vi - 1, vj - 1), idx(vi, vj - 1))) return true;
    if (vj < N && vi > 0 && vi < N && diff(idx(vi - 1, vj), idx(vi, vj))) return true;
    if (vi - 1 >= 0 && vj > 0 && vj < N && diff(idx(vi - 1, vj - 1), idx(vi - 1, vj))) return true;
    if (vi < N && vj > 0 && vj < N && diff(idx(vi, vj - 1), idx(vi, vj))) return true;
    return vi <= 0 || vj <= 0 || vi >= N || vj >= N;
  };
  R.cells.forEach((c, ck) => {
    const i = ci(c), j = cj(c);
    const open = d => { const ni = i + DX[d], nj = j + DZ[d]; return inGrid(ni, nj) && inR.has(idx(ni, nj)); };
    const o = [open(0), open(1), open(2), open(3)];
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].filter(([a, q]) => vWall(i + a, j + q)).map(([a, q]) => [a * CELL, q * CELL]);
    for (let a = 0; a < PPER; a++) for (let q = 0; q < PPER; q++) {
      const lx = (a + 0.5) * PST, lz = (q + 0.5) * PST;
      if (lx < inset && !o[2] || lx > CELL - inset && !o[0] || lz < inset && !o[3] || lz > CELL - inset && !o[1]) continue;
      let hit = false;
      for (const k of corners) if (Math.abs(lx - k[0]) < inset && Math.abs(lz - k[1]) < inset) { hit = true; break; }
      if (hit) continue;
      const p = (i * PPER + a - gx0) + (j * PPER + q - gz0) * W;
      base[p] = 1; cellOf[p] = ck;
    }
  });
  R.pb = { W, D, gx0, gz0, base, cellOf };
  return R.pb;
}
function roomPassable(R) {
  const { W, D, gx0, gz0, base, cellOf } = passBase(R, R.P);
  const m = base.slice();
  for (const q of R.placed) {
    const a0 = Math.max(0, Math.ceil((q[0] - PR) / PST - 0.5) - gx0), a1 = Math.min(W - 1, Math.floor((q[2] + PR) / PST - 0.5) - gx0);
    const b0 = Math.max(0, Math.ceil((q[1] - PR) / PST - 0.5) - gz0), b1 = Math.min(D - 1, Math.floor((q[3] + PR) / PST - 0.5) - gz0);
    for (let bq = b0; bq <= b1; bq++) for (let a = a0; a <= a1; a++) m[a + bq * W] = 0;
  }
  const starts = [];
  for (const Dd of R.doors) {
    if (!Dd.open || !Dd.pos) continue;
    const sgn = R.cells.indexOf(Dd.inC) >= 0 ? -1 : 1;
    const x = Dd.pos.x + Math.sin(Dd.rot) * 0.6 * sgn, z = Dd.pos.z + Math.cos(Dd.rot) * 0.6 * sgn;
    // 门里侧 0.6 m 那一点可能正好落在推开的门扇外扩余量里：就近（±0.4 m 内）找一个空点当起点
    const ka = Math.floor(x / PST) - gx0, kb = Math.floor(z / PST) - gz0;
    let best = -1, bd = 1e9;
    for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) {
      const a = ka + da, bq = kb + db;
      if (a < 0 || bq < 0 || a >= W || bq >= D || !m[a + bq * W]) continue;
      if (da * da + db * db < bd) { bd = da * da + db * db; best = a + bq * W; }
    }
    if (best >= 0) starts.push(best);
  }
  if (!starts.length) return true;
  const seen = new Uint8Array(W * D), stack = [starts[0]];
  seen[starts[0]] = 1;
  while (stack.length) {
    const k = stack.pop(), a = k % W;
    if (a + 1 < W && m[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
    if (a > 0 && m[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
    if (k + W < W * D && m[k + W] && !seen[k + W]) { seen[k + W] = 1; stack.push(k + W); }
    if (k - W >= 0 && m[k - W] && !seen[k - W]) { seen[k - W] = 1; stack.push(k - W); }
  }
  for (const k of starts) if (!seen[k]) return false;
  // 被家具整格盖住的格子不算（靠墙的桌子连同拉椅子的余量就占满一格）；
  // 只要求"还有空地的格子"都走得到 —— 不许家具把房间的另一半隔成死区
  const has = new Uint8Array(R.cells.length), got = new Uint8Array(R.cells.length);
  for (let k = 0; k < m.length; k++) if (m[k]) { has[cellOf[k]] = 1; if (seen[k]) got[cellOf[k]] = 1; }
  for (let c = 0; c < has.length; c++) if (has[c] && !got[c]) return false;
  return true;
}
// 挂墙件（白板、布告栏、暖气片）不占地，只要这段墙是实墙、离门够远
function freeWallSlots(slots, rng) { return shuffle(slots.filter(s => s.status === 'wall'), rng); }

// 分两遍摆（每块三角面有上限，门窗已经吃掉一大块）：
//   第 0 遍每个房间只摆"一眼认得出用途"的核心件（办公室一张桌+椅、储藏室一个货架、工位区一组隔断工位、会议室一套桌椅；
//            出生房间和据点整套摆完）；
//   第 1 遍再按同一顺序补第二三张桌子、文件柜、白板、暖气片、纸箱、垃圾桶、地上的纸。
// 这样预算不够时是"每间都少几件"，而不是"先轮到的房间摆满、后面的房间全空"
function furnishRoom(b, P, g, R, rng, pass) {
  let F = R.F;
  if (!F) {
    R.P = P;
    const slots = roomSlots(P, g, R);
    roomKeepouts(P, R);
    roomFixed(P, R);
    const clear = [R.rect.i * CELL + HT, R.rect.j * CELL + HT, (R.rect.i + R.rect.w) * CELL - HT, (R.rect.j + R.rect.d) * CELL - HT];
    F = R.F = {
      slots, walls: freeWallSlots(slots, rng), thin: R.rect.w === 1 || R.rect.d === 1,
      rr: [rng(), rng(), rng(), rng(), rng()], clear, cx: (clear[0] + clear[2]) / 2, cz: (clear[1] + clear[3]) / 2,
      usedWall: new Set(), nDesk: 0, nShelf: 0,
    };
  }
  const { slots, walls, thin, rr, clear, cx, cz, usedWall } = F;
  const budget = cost => can(b, cost);
  const againstWall = (s, lx0, lx1, depth) => rectAt(s.x, s.z, s.rot, lx0, HT, lx1, HT + depth);
  const placeDesk = s => {
    if (!budget(330) || usedWall.has(s)) return false;
    const r = againstWall(s, -0.74, 0.74, 1.76);   // 连同拉出来、转了个角度的椅子（椅子碰撞体转过以后外扩到 ±0.4）
    if (!fits(R, r)) return false;
    usedWall.add(s);
    b.push(s.x, s.z, s.rot);
    desk(b, 0, HT + 0.37, 0, rng);
    if (rng() < 0.85) chair(b, (rng() - 0.5) * 0.4, HT + 1.05 + rng() * 0.3, Math.PI + (rng() - 0.5) * 0.9, rng);
    b.pop();
    F.nDesk++;
    return true;
  };
  const placeCab = s => {
    if (!budget(85) || usedWall.has(s)) return false;
    const lx = s.corner ? s.corner * (CELL / 2 - HT - 0.26) : 0;
    const r = againstWall(s, lx - 0.25, lx + 0.25, 0.66);
    if (!fits(R, r)) return false;
    usedWall.add(s);
    b.push(s.x, s.z, s.rot); fileCab(b, lx, HT + 0.33, 0, rng); b.pop();
    return true;
  };
  const placeShelf = s => {
    if (!budget(180) || usedWall.has(s)) return false;
    const r = againstWall(s, -0.48, 0.48, 0.44);
    if (!fits(R, r)) return false;
    usedWall.add(s);
    b.push(s.x, s.z, s.rot); shelfUnit(b, 0, HT + 0.22, 0, rng); b.pop();
    F.nShelf++;
    return true;
  };
  const placeHung = (s, fn) => {
    if (!budget(50) || usedWall.has(s)) return false;
    usedWall.add(s);
    b.push(s.x, s.z, s.rot); fn(b, 0, HT + 0.002, 0, rng); b.pop();
    return true;
  };
  const desks = n => {
    for (const s of walls) { if (F.nDesk >= n) break; if (!s.corner && placeDesk(s)) continue; }
    for (const s of walls) { if (F.nDesk >= n) break; placeDesk(s); }
  };
  const shelves = n => { for (const s of walls) { if (F.nShelf >= n) break; placeShelf(s); } };

  if (R.kind === 'spawn') { if (pass === 0) furnishSpawn(b, P, g, R, rng, slots); return; }
  if (R.kind === 'meg' || R.kind === 'cult' || R.kind === 'tbd') { if (pass === 0) furnishBase(b, P, g, R, rng, walls, clear); return; }

  if (pass === 0) {
    if (R.kind === 'office') desks(1);
    else if (R.kind === 'storage') shelves(1);
    else if (R.kind === 'cubicles') {
      const cols = R.rect.w >= 4 && R.rect.d >= 3 ? 2 : 1;
      const along = R.rect.w * CELL - WT >= cols * 1.6 + 2.2 ? 0 : Math.PI / 2;
      const ext = along === 0 ? [cols * 0.8 + 0.1, 1.9] : [1.9, cols * 0.8 + 0.1];
      if (budget(cols === 2 ? 1350 : 700) && fits(R, [cx - ext[0], cz - ext[1], cx + ext[0], cz + ext[1]])) cluster(b, cx, cz, along, cols, rng);
      else desks(1);   // 放不下整组工位（预算或门挡着）就退成一张靠墙的桌子
    } else if (R.kind === 'meeting') {
      const along = (clear[2] - clear[0]) >= (clear[3] - clear[1]) ? 0 : Math.PI / 2;
      const ext = along === 0 ? [1.5, 1.4] : [1.4, 1.5];
      if (budget(400) && fits(R, [cx - ext[0], cz - ext[1], cx + ext[0], cz + ext[1]])) meetingSet(b, cx, cz, along, rng, 3 + Math.floor(rng() * 4));
    }
    return;
  }

  if (R.kind === 'office') {
    desks(thin ? 1 : 1 + (R.cells.length >= 6 ? 1 : 0) + (R.cells.length >= 12 ? 1 : 0));
    if (!thin) for (const s of walls) if (s.corner && placeCab(s)) break;
    if (rr[0] < 0.4) for (const s of walls) if (!usedWall.has(s) && placeHung(s, whiteboard)) break;
  } else if (R.kind === 'storage') {
    shelves(thin ? 1 + (R.cells.length >= 3 ? 1 : 0) : 2 + (rr[0] < 0.5 ? 1 : 0));
    if (!thin) for (const s of walls) if (s.corner && placeCab(s)) break;
    if (budget(140) && rr[1] < 0.7) {   // 纸箱最多三层，每层 46 面
      const bx = cx + (rng() - 0.5) * 0.8, bz = cz + (rng() - 0.5) * 0.8;
      if (fits(R, [bx - 0.4, bz - 0.4, bx + 0.4, bz + 0.4])) {
        const rot = rng() * 3, stack = 1 + Math.floor(rng() * 3);   // 先取好随机数（顺序同以前），kitProp 会把构件建两遍
        kitProp(b, (bb, lo) => kit.prop.box(bb, bx, bz, rot, Object.assign({ stack }, lo)));
      }
    }
  } else if (R.kind === 'cubicles') {
    for (const s of walls) if (s.corner && placeCab(s)) break;
    if (rr[0] < 0.5) for (const s of walls) if (!usedWall.has(s) && placeHung(s, whiteboard)) break;
  } else if (R.kind === 'meeting') {
    for (const s of walls) if (!usedWall.has(s) && placeHung(s, whiteboard)) break;
  }
  // 墙角旧暖气片（任何房间都可能有）
  if (rr[2] < 0.35 && can(b, 140)) {
    for (const s of walls) {
      if (usedWall.has(s) || !s.corner) continue;
      const lx = s.corner * (CELL / 2 - HT - 0.55);
      const r = againstWall(s, lx - 0.5, lx + 0.5, 0.2);
      if (!fits(R, r)) continue;
      usedWall.add(s);
      b.push(s.x, s.z, s.rot); radiator(b, lx, HT + 0.06, 0, 0.8, -0.06); b.pop();
      break;
    }
  }
  // 杂物：地上的纸、纸箱、垃圾桶
  if (can(b, 100)) {
    const np = Math.floor(rr[3] * 4);
    for (let k = 0; k < np; k++) paperAt(b, clear[0] + 0.3 + rng() * (clear[2] - clear[0] - 0.6), clear[1] + 0.3 + rng() * (clear[3] - clear[1] - 0.6), rng);
    if (rr[4] < 0.22) {
      for (const s of walls) {
        if (usedWall.has(s)) continue;
        const r = againstWall(s, -0.3, 0.3, 0.5);
        if (!fits(R, r)) continue;
        usedWall.add(s);
        const rot = (rng() - 0.5) * 0.4, stack = 1 + Math.floor(rng() * 2);
        b.push(s.x, s.z, s.rot); kitProp(b, (bb, lo) => kit.prop.box(bb, 0, HT + 0.25, rot, Object.assign({ stack }, lo))); b.pop();
        break;
      }
    } else if (rr[4] > 0.85) {
      for (const s of walls) {
        if (usedWall.has(s)) continue;
        const r = againstWall(s, 0.3, 0.7, 0.4);
        if (!fits(R, r)) continue;
        usedWall.add(s);
        b.push(s.x, s.z, s.rot); trashBin(b, 0.5, HT + 0.19); b.pop();
        break;
      }
    }
  }
}

// 出生房间（参考图 2）：北墙两扇门之间的消火栓箱 + 落地灭火器，东墙窗下暖气片（窗户自带），南墙边一张被推开的桌子，
// 西南角文件柜，西墙白板、一摞纸箱，地上散着几张纸；房间中央空着
// 出生房间的门是固定的，但别的房间没挨着走廊时 connectAll 会往出生房间开门：地上的件先按参考图的位置试，
// 碰到门前禁放区/门扇/堵路就换同一面墙的下一格（fits 同一套检查），挂墙件只要是实墙就行
function furnishSpawn(b, P, g, R, rng, slots) {
  const at = (i, j, d) => slots.find(s => s.c === idx(i, j) && s.d === d);
  const list = (...q) => q.map(a => at(a[0], a[1], a[2])).filter(s => s && s.status === 'wall');
  const used = new Set();
  const put = (cands, lx0, lx1, depth, fn) => {
    for (const s of cands) {
      if (used.has(s)) continue;
      const lo = typeof lx0 === 'function' ? lx0(s) : lx0, hi = typeof lx1 === 'function' ? lx1(s) : lx1;
      if (!fits(R, rectAt(s.x, s.z, s.rot, lo, HT, hi, HT + depth))) continue;
      used.add(s); b.push(s.x, s.z, s.rot); fn(s); b.pop();
      return true;
    }
    return false;
  };
  const hang = (cands, fn) => {
    for (const s of cands) { if (used.has(s)) continue; used.add(s); b.push(s.x, s.z, s.rot); fn(s); b.pop(); return; }
  };
  // 北墙两扇门之间：消火栓箱 + 落地灭火器（参考图 2）；布告栏
  put(list([3, 4, 3], [7, 4, 3], [8, 4, 3]), -0.1, 0.95, 0.26, () => { hoseBox(b, 0.25, HT + 0.002, 0); extinguisher(b, 0.78, HT + 0.12, 0, false); });
  hang(list([5, 4, 3], [7, 4, 3]), () => noticeBoard(b, 0, HT + 0.002, 0, rng));
  // 南墙：一张被推开的桌子（椅子斜着）、墙角文件柜、垃圾桶
  put(list([7, 8, 1], [6, 8, 1], [4, 8, 1], [3, 8, 1]), -0.76, 0.84, 1.95, () => {
    desk(b, 0.1, HT + 0.37, 0, rng); chair(b, -0.3, HT + 1.5, 2.4, rng);
    // 被推开的椅子旁边，地毯上一摊洒掉的咖啡（软边污渍，外圈一路淡出）
    DC(b, { kind: 'stain', x: 0.42, y: 0, z: HT + 1.32, facing: 'up', w: 0.42, rot: 0.7, color: 0x1a1c22, opacity: 0.55 });
  });
  const cabX = s => (s.corner || 0) * (CELL / 2 - HT - 0.26);
  put(list([8, 8, 1], [2, 8, 1], [8, 4, 3]), s => cabX(s) - 0.25, s => cabX(s) + 0.25, 0.66, s => fileCab(b, cabX(s), HT + 0.33, 0, rng));
  put(list([3, 8, 1], [4, 8, 1], [6, 8, 1]), 0.2, 0.6, 0.4, () => trashBin(b, 0.4, HT + 0.19));
  // 西墙：白板、一摞纸箱
  hang(list([2, 4, 2], [2, 5, 2]), () => whiteboard(b, 0, HT + 0.002, 0, rng));
  put(list([2, 7, 2], [2, 5, 2], [2, 8, 2]), -0.5, 0.75, 0.62, () => {
    kitProp(b, (bb, lo) => kit.prop.box(bb, -0.2, HT + 0.25, 0.1, Object.assign({ stack: 3 }, lo)));
    kitProp(b, (bb, lo) => kit.prop.box(bb, 0.45, HT + 0.3, -0.3, Object.assign({ stack: 1 }, lo)));
  });
  for (const [x, z] of [[8.2, 12.5], [8.5, 12.9], [14.6, 11.1], [6.1, 16.4]]) paperAt(b, x, z, rng);
}

// 据点（静态外观，用户 2026-09-13 范围决定：不做交互/驻守 NPC/交易）
function furnishBase(b, P, g, R, rng, walls, clear) {
  const cx = (clear[0] + clear[2]) / 2, cz = (clear[1] + clear[3]) / 2;
  const used = new Set();
  // cost：这一件的三角面上限（kit 构件按实测：储物柜 90、床 116、木箱 218、指示牌 58）
  const wallPut = (depth, fn, half, cost) => {
    const hw = half || 0.8;
    if (!can(b, cost || 80)) return false;
    for (const s of walls) {
      if (used.has(s)) continue;
      const r = rectAt(s.x, s.z, s.rot, -hw, HT, hw, HT + depth);
      if (!fits(R, r)) continue;
      used.add(s);
      b.push(s.x, s.z, s.rot); fn(); b.pop();
      return true;
    }
    return false;
  };
  if (R.kind === 'meg') {
    // M.E.G. Omega 基地（bases「第二个主要基地，半数小队生活于此，守备严密」）：储物柜一排、行军床、补给箱、电台桌、墙上的旗
    wallPut(0.55, () => { for (let k = 0; k < 3; k++) kitProp(b, (bb, lo) => kit.prop.cabinet(bb, -0.44 + k * 0.44, HT + 0.27, 0, Object.assign({ kind: 'locker', color: C.meg }, lo))); }, 0.8, 280);
    wallPut(0.95, () => kitProp(b, (bb, lo) => kit.prop.bed(bb, 0, HT + 0.47, Math.PI / 2, Object.assign({ w: 0.8, l: 1.9, frameColor: 0x4a4f44, color: C.meg }, lo))), 1.02, 125);
    wallPut(0.9, () => {
      kitProp(b, (bb, lo) => kit.prop.crate(bb, -0.45, HT + 0.42, 0.2, Object.assign({ color: 0x4d5a44 }, lo)));
      kitProp(b, (bb, lo) => kit.prop.crate(bb, 0.5, HT + 0.36, -0.1, Object.assign({ size: 0.65, color: C.megDark }, lo)));
    }, 0.95, 445);
    wallPut(0.8, () => {
      BV(b, 0, 0.72, HT + 0.38, 1.2, 0.03, 0.6, 0x5a5e52, 'all', 0.01, 'top');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) BX(b, sx * 0.55, 0, HT + 0.38 + sz * 0.25, 0.03, 0.72, 0.03, C.dark, ['px', 'nx', 'pz', 'nz']);
      BV(b, -0.2, 0.75, HT + 0.3, 0.36, 0.18, 0.22, 0x2f332c, 'all', 0.012, 'all');
      GL(b, -0.28, 0.8, HT + 0.411, 0.12, 0.05, '+z', [1.3, 0.8, 0.2]);
      BX(b, -0.05, 0.93, HT + 0.25, 0.008, 0.45, 0.008, C.dark);
      b.solid(-0.6, 0, HT + 0.08, 0.6, 0.75, HT + 0.68);
    }, 0.8, 80);
    wallPut(0.05, () => { PL(b, 0, 1.2, HT + 0.003, 1.1, 0.7, '+z', C.megDark); PL(b, 0, 1.45, HT + 0.007, 0.5, 0.22, '+z', 0xd8b030); PL(b, 0, 1.3, HT + 0.007, 0.8, 0.04, '+z', 0xd8b030); });
    // 门外走廊一侧挂黄色标牌
    if (can(b, 60)) for (const D of R.doors) if (P.reg[D.outC] === CORR && D.pos) { b.push(D.pos.x, D.pos.z, D.rot); kitProp(b, (bb, lo) => kit.prop.sign(bb, 0, CW / 2 + 0.03, 0, Object.assign({ y: DH + 0.38, w: 0.5, h: 0.16, color: [1.4, 1.1, 0.25] }, lo))); b.pop(); break; }
  } else if (R.kind === 'cult') {
    // 神爱之繁生（bases「崇拜农业……只种植从 Level 0 和 Level 1 墙面获得的几种菌类」）：几只种植箱里长满菌子，墙上贴着撕下来的 Level 0 黄墙纸
    const box = (x, z, rot) => {
      b.push(x, z, rot);
      BV(b, 0, 0, 0, 0.9, 0.3, 0.5, 0x5c4a38, 'noBottom', 0.015, 'all');
      PL(b, 0, 0.302, 0, 0.84, 0.44, 'up', 0x3a2e22);
      for (let k = 0; k < 6; k++) {
        const mx = -0.35 + rng() * 0.7, mz = -0.16 + rng() * 0.32, hgt = 0.06 + rng() * 0.12;
        CY(b, mx, 0.3, mz, 0.015, hgt, C.fungusStem, { segments: 5, caps: false });
        CY(b, mx, 0.3 + hgt, mz, 0.05 + rng() * 0.04, 0.03, C.fungus, { segments: 7, rTop: 0.012 });
      }
      b.solid(-0.45, 0, -0.25, 0.45, 0.3, 0.25);
      b.pop();
    };
    if (can(b, 490) && fits(R, [cx - 1.5, cz - 0.3, cx + 1.5, cz + 0.3])) { box(cx - 0.55, cz, 0); box(cx + 0.55, cz, 0); }   // 每箱约 240 面
    wallPut(0.05, () => { for (let k = 0; k < 3; k++) PL(b, -0.5 + k * 0.5, 0.6 + rng() * 0.6, HT + 0.003 + k * 0.001, 0.4, 0.55, '+z', C.wallpaper0); });
    wallPut(0.9, () => { kitProp(b, (bb, lo) => kit.prop.crate(bb, 0, HT + 0.4, 0.1, Object.assign({ color: 0x5c4a38 }, lo))); for (let k = 0; k < 3; k++) BX(b, -0.3 + k * 0.08, 0.8, HT + 0.25, 0.02, 0.06, 0.02, [1.5, 1.1, 0.5]); }, 0.8, 260);
  } else {
    // T.B.D.（bases「仅有六人……只会售卖没有实际用途的奇特物品」）：一张摆满古怪小物件的桌子、两只凳子
    wallPut(0.8, () => {
      BV(b, 0, 0.7, HT + 0.4, 1.3, 0.03, 0.65, 0x6b5a46, 'all', 0.01, 'top');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) BX(b, sx * 0.6, 0, HT + 0.4 + sz * 0.28, 0.03, 0.7, 0.03, C.dark, ['px', 'nx', 'pz', 'nz']);
      for (let k = 0; k < 9; k++) {
        const col = [0xd23b8f, 0x2fb2d2, 0xe0c341, 0x8a3fd0, 0x3fd07a][Math.floor(rng() * 5)];
        if (rng() < 0.5) BX(b, -0.55 + rng() * 1.1, 0.732, HT + 0.15 + rng() * 0.5, 0.05 + rng() * 0.08, 0.04 + rng() * 0.12, 0.05 + rng() * 0.08, col, 'noBottom', rng() * 3);
        else CY(b, -0.55 + rng() * 1.1, 0.732, HT + 0.15 + rng() * 0.5, 0.02 + rng() * 0.04, 0.05 + rng() * 0.1, col, { segments: 6 });
      }
      b.solid(-0.65, 0, HT + 0.08, 0.65, 0.73, HT + 0.72);
    }, 0.8, 270);
    for (const [sx, sz] of [[-0.6, 1.0], [0.6, 1.1]]) if (can(b, 45) && fits(R, [cx + sx - 0.2, cz + sz - 0.2, cx + sx + 0.2, cz + sz + 0.2])) {
      CY(b, cx + sx, 0.42, cz + sz, 0.17, 0.04, 0x6b5a46, { segments: 8 });
      CY(b, cx + sx, 0, cz + sz, 0.025, 0.42, C.dark, { segments: 5, caps: false });
      b.solid(cx + sx - 0.18, 0, cz + sz - 0.18, cx + sx + 0.18, 0.46, cz + sz + 0.18);
    }
  }
}

// =====================================================================
// 出口：楼梯(→5/→6)、电梯(→3)、地下室楼梯(→71，首期范围外，kit 自动 sealed)
// =====================================================================
// 硬规则「出口要在出生点 3–5 个区块内找得到、无限层按周期重复摆」：每条出口按宏格哈希（_TEMPLATE.md 4.2 节）摆，
// 每 MACRO×MACRO 块必有一处；出生块所在的宏格从 (0,0) 向正方向铺开 ⇒ 最远 MACRO−1 块。
// 原文「偶尔出现」「很少情况下」：5/6/3 用 4×4 宏格（每块 1/16 ≈ 6%），71 用 5×5 宏格（4%）。
// 楼梯朝向原文没写：5/6 取"向上走进门洞"，71 明确是地下室，取"向下的黑洞"。都摆在专门挖出来的死胡同尽头
const EXIT_DEFS = [
  { to: '5', kind: 'stairs', macro: 4, tag: 'L4-x5', note: '办公室楼梯（向上），每 4×4 区块必有一处，摆在一条死胡同尽头；失去视野后可能消失 (exits[0])' },
  { to: '6', kind: 'stairs', macro: 4, tag: 'L4-x6', note: '办公室楼梯（向上），每 4×4 区块必有一处，摆在死胡同尽头；失去视野后可能消失 (exits[1])' },
  { to: '3', kind: 'elevator', macro: 4, tag: 'L4-x3', note: '通向 Level 3 的电梯，每 4×4 区块必有一处，嵌在死胡同尽头的墙上；失去视野后可能消失 (exits[2])' },
  { to: '71', kind: 'stairs', macro: 5, tag: 'L4-x71', note: '很少见的地下室楼梯（向下），每 5×5 区块一处；不在首期范围内，kit 自动标记尚未开放 (exits[3])' },
];
function macroPick(levelSeed, tag, cx, cz, M) {
  const mx = Math.floor(cx / M), mz = Math.floor(cz / M);
  const r = U.rng(levelSeed, tag, mx, mz);
  let px = mx * M + Math.floor(r() * M), pz = mz * M + Math.floor(r() * M);
  if (px === 0 && pz === 0) { px = mx * M + 2; pz = mz * M + 1; }   // 出生块不摆出口，挪到同一宏格里别的块
  return px === cx && pz === cz ? r : null;
}
// 据点：M.E.G. 跟着 Level 5 楼梯所在的那一块（四成宏格有）；神爱之繁生 / T.B.D. 各自按 5×5 宏格低概率出现
function specialsAt(levelSeed, cx, cz, exitsHere) {
  const out = {};
  const x5 = exitsHere.find(x => x.def.to === '5');
  if (x5 && x5.r() < 0.4) out.meg = true;
  const M = 5, mx = Math.floor(cx / M), mz = Math.floor(cz / M);
  const r = U.rng(levelSeed, 'L4-camp', mx, mz);
  const kind = U.weighted(r, [['cult', 0.14], ['tbd', 0.14], ['none', 0.72]]);
  const px = mx * M + Math.floor(r() * M), pz = mz * M + Math.floor(r() * M);
  if (kind !== 'none' && px === cx && pz === cz && !(cx === 0 && cz === 0)) out.camp = kind;
  return out;
}

function placeExit(b, P, g, sp) {
  const def = sp.exit.def, d = sp.dir, cc = center(sp.end);
  const fx = cc.x + DX[d] * (CELL / 2 - HT), fz = cc.z + DZ[d] * (CELL / 2 - HT);   // 尽头那面墙的墙面
  const rot = rotToward(d);
  const back = dist => ({ x: fx - DX[d] * dist, z: fz - DZ[d] * dist });
  let p;
  if (def.kind === 'elevator') {
    p = back(-0.013);
    exitProp(b, { to: def.to, kind: 'elevator', x: p.x, z: p.z, rot, elevator: { w: 1.0, frameColor: 0x9a9ea2, doorColor: 0xb4b8bc }, tag: 'l4-flicker' });
  } else if (def.to === '71') {
    const deep = sp.cells.length >= 2 ? 2.6 : 1.7;
    p = back(deep + 0.05);
    exitProp(b, { to: def.to, kind: 'stairs', x: p.x, z: p.z, rot, stairs: { down: true, depth: deep, railColor: 0x6a6e72 }, tag: 'l4-flicker' });
  } else {
    p = back(1.81);
    exitProp(b, { to: def.to, kind: 'stairs', x: p.x, z: p.z, rot, stairs: { down: false, w: 1.524, h: H, matKey: 'L4:wall', stepColor: 0x9a968d, sign: true }, tag: 'l4-flicker' });
  }
  // 支路入口墙上挂一块楼层导向牌（深灰底 + 白色箭头条），M.E.G. 那一处换成黄牌
  const ent = sp.cells[0], side = (d + 1) % 4;
  const s = slotInfo(P, g, ent, side);
  if (s.status === 'wall') {
    b.push(s.x, s.z, s.rot);
    PL(b, 0, 1.55, HT + 0.004, 0.42, 0.2, '+z', P.meg && def.to === '5' ? 0xd8b030 : C.plate);
    PL(b, 0, 1.62, HT + 0.006, 0.3, 0.04, '+z', C.white);
    b.pop();
  }
  for (const c of sp.cells.slice(-2)) g.reserve(ci(c), cj(c));
  // 楼梯间/电梯/地洞占着的那两格（外扩 0.35 m，含两侧和尽头的墙面）：墙面、地面贴花都不撒进去（会浮在黑洞上、穿进电梯门框）
  let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
  for (const c of sp.cells.slice(-2)) { a0 = Math.min(a0, ci(c) * CELL); b0 = Math.min(b0, cj(c) * CELL); a1 = Math.max(a1, (ci(c) + 1) * CELL); b1 = Math.max(b1, (cj(c) + 1) * CELL); }
  (P.noMark || (P.noMark = [])).push([a0 - 0.35, b0 - 0.35, a1 + 0.35, b1 + 0.35]);
}

// =====================================================================
// 区块
// =====================================================================
// rng 消耗顺序固定：规划（噪声→节点→开口顺序→支路→采光井→房间→用途→门→窗）→ 灯/风口 → 走廊消防件 → 房间家具 → 走廊墙上小件 → 吊顶破损
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  X.extra = 0; X.decals = 0; X.bevelSkip = 0; X.softMiss = 0; X.decalMiss = 0;
  const isSpawn = cx === 0 && cz === 0;
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const g = kit.grid(b, N, N, Object.assign({ rng: U.rng(ctx.levelSeed, 'L4-gridfill', cx, cz) }, GRID));

  const exitsHere = [];
  if (!isSpawn) for (const def of EXIT_DEFS) { const r = macroPick(ctx.levelSeed, def.tag, cx, cz, def.macro); if (r) exitsHere.push({ def, r }); }
  const special = isSpawn ? {} : specialsAt(ctx.levelSeed, cx, cz, exitsHere);
  const P = planChunk(b, g, rng, isSpawn, exitsHere, special);
  P.posts = new Set();
  P.meg = !!special.meg;
  applyWalls(P, g);

  for (const W of P.wells) for (const c of W.cells) g.reserve(ci(c), cj(c));
  const DBG = b.data.dbg = { reg: Array.from(P.reg), t: [], n: { seeds: P.nSeeds, corr: P.reg.filter(v => v === CORR).length, rooms: P.alive.length, doors: [...P.custom.values()].filter(v => v.type === 'door').length, closed: [...P.custom.values()].filter(v => v.type === 'door' && !v.open).length, wins: [...P.custom.values()].filter(v => v.type === 'window').length } };
  DBG.rooms = P.alive.map(R => [R.id, R.kind, R.cells.length]);
  DBG.wells = P.wells.map(W => [W.kind, W.cells.slice()]);
  const gw = kit.gridWalls(b, g, { matKey: 'L4:wall', trim: { h: TRIM_H, t: TRIM_T, color: C.rubber } });
  DBG.t.push(['walls', baseTris(b), X.extra]);
  kit.prop.floor(b, null, null, 0, { matKey: 'L4:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L4:ceil', y: H });

  // 门、窗（自砌墙段）
  const customs = Array.from(P.custom.values()).sort((a, c) => ekey(a) - ekey(c));
  for (const D of customs) if (D.type === 'door') buildDoor(b, g, P, D);
  for (const Wd of customs) if (Wd.type === 'window') buildWindow(b, g, P, Wd);
  DBG.doors = customs.filter(D => D.type === 'door').map(D => [D.pos.x, D.pos.z, D.rot, D.open ? 1 : 0, P.reg[D.inC], P.reg[D.outC]]);

  DBG.t.push(['doors+windows', baseTris(b), X.extra]);
  // ---------- 灯：嵌在吊顶网格里的 600 方格栅灯 + 长条风口；采光井里一盏冷白天光 ----------
  let lights = 0;
  for (const W of P.wells) {
    if (W.kind !== 'bright') continue;
    let x = 0, z = 0;
    for (const c of W.cells) { const p = center(c); x += p.x / W.cells.length; z += p.z / W.cells.length; }
    b.light({ x, z, y: 1.7, color: 0xeef3ff, intensity: 1.05, range: 7.5 });
    lights++;
  }
  const lit = new Uint8Array(N * N);
  const wantLight = [];
  for (let c = 0; c < N * N; c++) if (P.reg[c] === CORR && (ci(c) + cj(c)) % 3 === 0) wantLight.push([c, 'corr']);
  for (const sp of P.exitSpurs) if (!sp.cells.some(c => (ci(c) + cj(c)) % 3 === 0)) wantLight.push([sp.cells[0], 'corr']);
  for (const R of P.alive) {
    const { i, j, w, d } = R.rect;
    if (R.kind === 'spawn') { for (const [a, bb] of [[3, 5], [7, 5], [5, 7], [3, 7], [7, 7]]) wantLight.push([idx(a, bb), 'spawn']); continue; }
    const spread = (a0, n) => { const k = n <= 3 ? 1 : n <= 5 ? 2 : 3, out = []; for (let q = 0; q < k; q++) out.push(a0 + Math.floor((q + 0.5) * n / k)); return out; };
    const xs = spread(i, w), zs = spread(j, d);
    for (const a of xs) for (const bb of zs) wantLight.push([idx(a, bb), 'room']);
  }
  const spawnStates = ['on', 'flicker', 'on', 'broken', 'broken'];
  let si = 0;
  for (const [c, kind] of wantLight) {
    if (lit[c]) continue;
    lit[c] = 1;
    const r = rng(), rf = rng();
    let state = kind === 'spawn' ? spawnStates[si++] : kind === 'corr'
      ? (r < 0.72 ? 'on' : r < 0.84 ? 'flicker' : 'broken')
      : (r < 0.55 ? 'on' : r < 0.67 ? 'flicker' : 'broken');
    if (state !== 'broken' && lights >= MAX_LIGHTS) state = 'broken';
    if (state !== 'broken') lights++;
    const p = center(c);
    const lo0 = { y: H, w: TILE - 0.06, d: TILE - 0.06, frame: false, state, flicker: 0.3 + rf * 0.5, color: 0xf3f6ff, intensity: kind === 'corr' ? 1.0 : 1.1, range: kind === 'corr' ? 7.5 : 8.5 };
    kitProp(b, (bb, lo) => kit.prop.lightPanel(bb, p.x, p.z, 0, Object.assign({}, lo0, lo)));
    PL(b, p.x, H - 0.008, p.z, TILE - 0.012, TILE - 0.012, 'down', 0xc2c4c4);
  }
  // 长条风口：落在龙骨线上，走廊里顺着走廊方向，房间里整间一个方向（参考图 2 天花板上那一排排深色长条）
  for (let c = 0; c < N * N; c++) {
    const rg = P.reg[c];
    if (rg === WELL || lit[c]) continue;
    const r = rng(), r2 = rng();
    if (r > (rg === CORR ? 0.5 : 0.6)) continue;
    let alongX;
    if (rg === CORR) { const e = ci(c) + 1 < N && P.reg[c + 1] === CORR, w = ci(c) > 0 && P.reg[c - 1] === CORR; alongX = e || w; }
    else alongX = (P.rooms[rg].id % 2) === 0;
    const p = center(c), off = (r2 < 0.5 ? -1 : 1) * TILE / 2;
    const x = alongX ? p.x : p.x + off, z = alongX ? p.z + off : p.z;
    const w = alongX ? TILE * 2 - 0.1 : 0.11, d = alongX ? 0.11 : TILE * 2 - 0.1;
    PL(b, x, H - 0.008, z, w, d, 'down', 0xbcbfc0);
    GL(b, x, H - 0.012, z, alongX ? w - 0.04 : 0.05, alongX ? 0.05 : d - 0.04, 'down', 0.018);
  }

  DBG.t.push(['lights+slots', baseTris(b), X.extra]);
  // ---------- 出口 ----------
  for (const sp of P.exitSpurs) placeExit(b, P, g, sp);
  // 出口那两格（楼梯间/电梯/地洞）不贴任何贴花：会浮在黑洞上、穿进电梯门框
  const keep = P.noMark || [];
  const clearOf = (x0, z0, x1, z1) => keep.every(k => x1 < k[0] || x0 > k[2] || z1 < k[1] || z0 > k[3]);
  // ---------- 墙面、地毯的软边贴花（只用派生随机流，不吃区块 rng，也不占基础面数 ⇒ 放在哪一步建都不影响布局）----------
  // 放在家具前面建：家具摆完基础面数几乎都顶到 7900，kit 的细节上限 9000 只剩约 1100 面，放到最后常常一片都贴不上
  // 墙面：gridWalls 的立面（门洞墙、窗洞墙是自砌的，不在里面 ⇒ 不会贴到门框窗框上）。出口那两格的墙不贴
  const NRM = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
  const wallFaces = ((gw && gw.faces) || []).filter(f => {
    const n = NRM[f.facing];
    if (!n) return false;
    const hx = n[1] ? f.w / 2 : 0, hz = hx ? 0 : f.w / 2;
    const qx = f.x + n[0] * 0.3, qz = f.z + n[1] * 0.3;   // 墙面前面那一格是采光井（封死的竖井，看不见）就不贴
    const qi = Math.floor(qx / CELL), qj = Math.floor(qz / CELL);
    if (inGrid(qi, qj) && P.reg[idx(qi, qj)] === WELL) return false;
    return clearOf(f.x - hx, f.z - hz, f.x + hx, f.z + hz);
  });
  // 椅背、推车、搬东西磕出来的刮痕/擦痕（0.55–1.25 m）；墙根鞋尖踢的黑印、拖地蹭的抹痕（0.14–0.42 m）
  scatter(b, wallFaces, { salt: 'L4-wallmarks', kinds: [['scuff', 3], ['scratch', 3], ['hairline', 2]], per: 0.045, max: 12, y: [0.55, 1.25], color: 0x6d6961, opacity: [0.25, 0.5] });
  scatter(b, wallFaces, { salt: 'L4-kickmarks', kinds: [['scuff', 2], ['drag', 1]], per: 0.06, max: 6, y: [0.16, 0.42], size: [0.45, 0.8], color: 0x45433f, opacity: [0.18, 0.35] });
  // 地毯：咖啡/脏水洇开的深色污渍、干掉的浅色水印（走廊和房间的每一格，采光井和出口那两格除外）
  const floors = [];
  for (let c = 0; c < N * N; c++) {
    if (P.reg[c] === WELL) continue;
    const p = center(c), h = (CELL - WT) / 2;
    if (!clearOf(p.x - h, p.z - h, p.x + h, p.z + h)) continue;
    floors.push({ x: p.x, y: 0, z: p.z, facing: 'up', w: CELL - WT, h: CELL - WT });
  }
  scatter(b, floors, { salt: 'L4-carpet', kinds: [['stain', 3], ['oil', 1]], per: 0.016, max: 8, size: [0.6, 1.3], color: 0x191c23, opacity: [0.3, 0.6] });
  // 干掉的浅色水印用 oil 那格（淡外圈 + 环内一团不匀的晕）：water 那格是双线正圆，铺在地毯上像个泡泡/杯垫
  scatter(b, floors, { salt: 'L4-carpet-dry', kinds: ['oil'], per: 0.006, max: 3, size: [0.8, 1.3], color: 0x8a909c, opacity: [0.2, 0.32] });
  DBG.t.push(['marks', baseTris(b), X.extra]);

  // ---------- 走廊：门边的灭火器、消火栓箱 ----------
  const corrSlots = [];
  for (let c = 0; c < N * N; c++) {
    if (P.reg[c] !== CORR || P.spurCell.has(c) && P.exitSpurs.some(sp => sp.cells.indexOf(c) >= 0)) continue;
    for (let d = 0; d < 4; d++) { const s = slotInfo(P, g, c, d); if (s.status === 'wall') corrSlots.push(s); }
  }
  const slotUsed = new Set(), cellUsed = new Set();
  const takeSlot = (s) => { slotUsed.add(s); cellUsed.add(s.c); };
  const nearDoor = s => { for (const D of P.custom.values()) if (D.type === 'door' && D.outC === s.c && D.pos) return true; return false; };
  for (const D of customs) {
    if (D.type !== 'door' || P.reg[D.outC] !== CORR) continue;
    const r = rng(), r2 = rng();
    if (r >= 0.22 || !can(b, 130)) continue;
    const eg = edgeGeom(D), st = D.stubs[r2 < 0.5 ? 0 : 1];
    if (st[1] - st[0] < 0.26) continue;
    const u = (st[0] + st[1]) / 2, sp = eg.vert ? { x: eg.L, z: u } : { x: u, z: eg.L };
    b.push(sp.x, sp.z, D.rot); extinguisher(b, 0, CW / 2 + 0.001, 0, true); b.pop();
    cellUsed.add(D.outC);
  }
  shuffle(corrSlots, rng);
  const nHose = (rng() < 0.75 ? 1 : 0) + (rng() < 0.3 ? 1 : 0);
  let hosed = 0;
  for (const s of corrSlots) {
    if (hosed >= nHose || !can(b, 290)) break;
    if (cellUsed.has(s.c) || !nearDoor(s)) continue;
    takeSlot(s);
    b.push(s.x, s.z, s.rot); hoseBox(b, -0.3, HT + 0.002, 0); extinguisher(b, 0.42, HT + 0.12, 0, false); b.pop();
    hosed++;
  }
  // 地标：冷水器 / 自动售货机 / 杏仁水喷水池（landmarks；原文列为补给点）
  const rCool = rng(), rVend = rng(), rFount = rng();
  if (!isSpawn && rCool < 0.28 && can(b, 140)) for (const s of corrSlots) {
    if (slotUsed.has(s) || cellUsed.has(s.c)) continue;
    takeSlot(s); b.push(s.x, s.z, s.rot); cooler(b, 0, HT + 0.18, 0); b.pop();
    (DBG.lm || (DBG.lm = [])).push(['cooler', s.x + Math.sin(s.rot) * 0.4, s.z + Math.cos(s.rot) * 0.4]);
    break;
  }
  if (!isSpawn && rVend < 0.14 && can(b, 130)) {
    const sp = P.spurs.find(q => !q.exit && P.custom.get(ekey(q.endEdge)) == null && g.isWall(q.endEdge.axis, q.endEdge.i, q.endEdge.j)
      && [0, 1, 2, 3].every(d => !P.custom.has(ekey(edgeOf(q.end, d)))));
    if (sp) {
      const s = slotInfo(P, g, sp.end, sp.dir);
      b.push(s.x, s.z, s.rot); vendingL4(b, 0, HT + 0.41, 0); b.pop();
      (DBG.lm || (DBG.lm = [])).push(['vending', s.x + Math.sin(s.rot) * 0.6, s.z + Math.cos(s.rot) * 0.6]);
      cellUsed.add(sp.end);
    }
  }
  if (!isSpawn && rFount < 0.05 && can(b, 340)) {
    const R = P.alive.find(q => q.kind === 'empty' && q.rect.w >= 3 && q.rect.d >= 3);
    if (R) {
      const x = (R.rect.i + R.rect.w / 2) * CELL, z = (R.rect.j + R.rect.d / 2) * CELL;
      fountain(b, x, z);
      (DBG.lm || (DBG.lm = [])).push(['fountain', x, z]);
      R.placed.push([x - 1.1, z - 1.1, x + 1.1, z + 1.1]);
    }
  }

  DBG.t.push(['exits+corrdecor', baseTris(b), X.extra]);
  // ---------- 房间家具（打乱顺序：预算不够时被省掉的房间是随机的，不总是块里靠下的那几间）----------
  const order = shuffle(P.alive.slice(), rng);
  for (const R of order) furnishRoom(b, P, g, R, rng, 0);
  for (const R of order) furnishRoom(b, P, g, R, rng, 1);

  DBG.t.push(['furniture', baseTris(b), X.extra]);
  // ---------- 走廊墙上小件：吊挂出口灯、布告栏、挂钟、地上的纸 ----------
  const rN = rng(), rK = rng(), nPaper = Math.floor(rng() * 3);
  let signs = 0;
  for (let c = 0; c < N * N && signs < 2; c++) {
    if (P.reg[c] !== CORR) continue;
    let nb = 0, ax = 0;
    for (let d = 0; d < 4; d++) { const ni = ci(c) + DX[d], nj = cj(c) + DZ[d]; if (inGrid(ni, nj) && P.reg[idx(ni, nj)] === CORR) { nb++; ax = d; } }
    const r = rng();
    if (nb < 3 || r > 0.45 || lit[c] || !can(b, 50)) continue;
    const p = center(c);
    exitSign(b, p.x, 2.34, p.z, rotInto(ax), true);
    signs++;
  }
  const hang = (fn) => {
    for (const s of corrSlots) {
      if (slotUsed.has(s) || cellUsed.has(s.c)) continue;
      takeSlot(s); b.push(s.x, s.z, s.rot); fn(b, 0, HT + 0.002, 0, rng); b.pop();
      return;
    }
  };
  if (rN < 0.4 && can(b, 40)) hang(noticeBoard);
  if (rK < 0.25 && can(b, 105)) hang(wallClock);
  if (can(b, 10)) for (let k = 0; k < nPaper; k++) {
    const list = [];
    for (let c = 0; c < N * N; c++) if (P.reg[c] === CORR) list.push(c);
    const c = list[Math.floor(rng() * list.length)], p = center(c);
    paperAt(b, p.x + (rng() - 0.5) * 1.0, p.z + (rng() - 0.5) * 1.0, rng);
  }

  // ---------- 吊顶破损：掉了一块板的黑洞（板摔在正下方地上）、渗水发黄的板 ----------
  for (let c = 0; c < N * N; c++) {
    const r = rng(), t = Math.floor(rng() * 9);
    if (P.reg[c] === WELL || lit[c] || !can(b, 40)) continue;
    const p = center(c), tx = p.x + ((t % 3) - 1) * TILE, tz = p.z + (((t / 3) | 0) - 1) * TILE;
    if (t === 4) continue;   // 正中那块是灯/风口位
    const mk = clearOf(tx - 0.5, tz - 0.5, tx + 0.5, tz + 0.5);   // 贴花只看位置，不影响上面 rng 的取法
    if (r < 0.02) {
      GL(b, tx, H - 0.004, tz, TILE - 0.02, TILE - 0.02, 'down', 0.012);
      BX(b, tx + 0.1, 0.004, tz - 0.08, TILE - 0.03, 0.014, TILE - 0.03, C.ceilTile, 'noBottom', r * 90);
      BX(b, tx + 0.08, H - 0.55, tz, 0.012, 0.54, 0.012, C.dark, ['px', 'nx', 'pz', 'nz']);   // 从洞里垂下来的电线
      // 板摔下来时扬起的一圈矿棉灰（地毯上一摊软边浅灰）
      if (mk) DC(b, { kind: 'stain', x: tx + 0.1, y: 0, z: tz - 0.08, facing: 'up', w: TILE * 1.35, rot: r * 300, color: 0xa3a39c, opacity: 0.22 });
    } else if (r < 0.07) {
      // 渗水发黄的吊顶板：以前整块板平涂成黄色（四条硬边的方块），现在是软边水渍 —— 一圈压扁的淡水线圈住一团不均匀的黄晕（oil 那格：外环 + 环内一团），
      // 再错开叠两团形状不规则的污渍（stain 两种变体），外轮廓是一团花边、不是正圆。每一层都从中间往外一路淡出。
      // 只放正圆的 water 环像杯垫/圆灯、三个环错开叠像一串泡泡（自测都踩过）。整团落在这块板里面（离板中心 ≤ 0.56 sw ≤ 0.31 m < 半块板 0.333 m）。
      // 一半的正下方地毯上还有一圈干掉的浅色水印。低画质（不画贴花）、出口旁边、或贴花画不出来时照改前那样整块板涂黄
      const f = (r - 0.02) / 0.05, sw = TILE * (0.62 + 0.2 * f);
      soft(b, () => {
        if (!mk) return false;
        const a = f * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const at = (u, v) => ({ x: tx + (ca * u - sa * v) * sw, z: tz + (sa * u + ca * v) * sw });
        let p = at(0, 0);
        if (!DCs(b, { kind: 'oil', x: p.x, y: H, z: p.z, facing: 'down', w: sw, h: sw * 0.84, rot: a, color: 0x9a7e4c, opacity: 0.5 })) return false;
        p = at(0.2, 0.1);
        DCs(b, { kind: 'stain', x: p.x, y: H, z: p.z, facing: 'down', w: sw * 0.66, variant: 0, rot: a + 1.3, color: 0xa88a52, opacity: 0.42 });
        p = at(-0.2, -0.12);
        DCs(b, { kind: 'stain', x: p.x, y: H, z: p.z, facing: 'down', w: sw * 0.5, variant: 1, rot: a + 2.9, color: 0xa88a52, opacity: 0.34 });
        return true;
      }, () => PL(b, tx, H - 0.004, tz, TILE - 0.03, TILE - 0.03, 'down', C.stain), 2);
      if (mk && f < 0.5) DC(b, { kind: 'oil', x: tx + 0.05, y: 0, z: tz - 0.04, facing: 'up', w: TILE * (0.8 + 0.3 * f), h: TILE * (0.7 + 0.2 * f), rot: f * 23, color: 0x8d94a2, opacity: 0.32 });
    }
  }

  DBG.x = { extra: X.extra, decals: X.decals, bevelSkip: X.bevelSkip, softMiss: X.softMiss, decalMiss: X.decalMiss };

  DBG.t.push(['end', baseTris(b), X.extra]);
  kit.gridSpawns(b, g);
  return b.finish();
}

// =====================================================================
// 层级状态与危害
// =====================================================================
const S = { timer: 0 };
const EXIT_LOST_RADIUS = 12, EXIT_LOST_SEC = 6, EXIT_VANISH_CHANCE = 0.4;   // 数值非设定：够近、够久没看它才判定"失去视野"
const WINDOW_LURE_R = 3, WINDOW_GRAB_R = 0.75;

// lighting/sounds 原文 unverified；外观按用户参考图：白墙 + 冷白日光灯 + 窗里的天光。
// 雾色用偏冷的深灰（远处的楼道沉进灰暗里，不发黑、不发黄）
const LEVEL_ENV = {
  background: 0x2b2e33, fogColor: 0x2b2e33, fogNear: 6, fogFar: 40,
  ambient: { color: 0xe6ebf2, intensity: 0.34 },   // 有效亮度 ≈ 0.31：灯全坏的走廊也看得清路
  sanityDrainMul: 0.85,   // 依据 survivalClass「生存难度等级 1」+ mechanics「很容易离开，返回也一样」，比默认基线略缓
  hungerDrainMul: 1,      // temperature/weather 均 unverified，不额外加成
  audio: 'fluorescent',
  darkness: false,
};

BR.levels.register({
  id: '4', name: 'Level 4', title: '废弃办公室', nickname: '废弃办公室',
  version: 'wikidot-cn',
  survivalClass: '生存难度 等级 1（原文标签仅"生存难度1"，未见子标签）',
  chunkSize: SIZE,
  env: LEVEL_ENV,
  // 依据 entrances「从枢纽的墙上跃进（切入）；原文称这是最广为人知的方法」：出生在出生块那间大办公室里，面朝北墙
  spawn() { return { x: 11, y: 0, z: 16.2, yaw: 0 }; },
  buildChunk,
  entities: [
    // entityDensityOverall「rare —— 原文称本层接近实体绝迹状态，猎犬与钝人是唯二可观测实体」→ rare(0.04) 拆成两份
    { type: 'hound', officialPer1000m2: 0.02 },
    { type: 'duller', officialPer1000m2: 0.02 },
    // 笑魇：页面明确写"一人曾声称看到过，但没有证据"，不计入上面的 rare 预算；
    // 比照 item-spawn.json 里"全站最稀有"量级（almond_water_red 的 0.004）取同一数量级，代表传闻级而非可观测密度
    { type: 'smiler', officialPer1000m2: 0.004 },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },              // 用户规则：所有模式都刷；版本 landmarks 也列了冷水器/售货机/杏仁水喷泉
    { type: 'almond_water_blue', per1000m2: 0.12 },        // item-spawn.json：特殊配色瓶多数报告于 Level 4，perLevel 已翻倍
    { type: 'almond_water_green', per1000m2: 0.08 },       // 同上，绿色为第二常见彩色瓶
    { type: 'almond_water_red', per1000m2: 0.004 },        // item-spawn.json：全站最稀有色，仅 5 瓶记录，不限层级
    { type: 'royal_rations', per1000m2: 0.01 },            // item-spawn.json：不限层级的极稀有物资
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },    // item-spawn.json：大多数层级都有但很少，蓝色最常见
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },              // item-spawn.json：极稀有，无死亡飞蛾的层级也少量散落
    { type: 'food_ration', per1000m2: 0.6 },               // 用户规则兜底：本层未单独设定食物道具，用现有罐头口粮补齐
  ],
  exits: EXIT_DEFS.map(d => ({ to: d.to, kind: d.kind, note: d.note })),
  enter(ctx) {
    S.timer = 0;
    S.rng = U.rng(ctx.levelSeed, 'L4-flavor');   // 出口消失判定、窗户危害的音效/伤害节奏用；不用 Math.random
  },
  update(ctx, dt) {
    S.timer += dt;

    // ---------- 出口失去视野后可能消失（exits[] 每条都写了这条规则）----------
    // 用玩家朝向与出口连线的夹角近似"是否在视野里"：够近、且持续不在正前方一段时间后，按概率停用触发点。
    // kit 的楼梯/电梯实物没有整体可见性开关，做不到把整座楼梯间变没；这里只让触发失效并提示，是对"消失"的近似。
    // 同一区块一旦卸载重建，会按同一套确定性 rng 重新摆出这条出口，整体上就是"这次来时它可能不见了，下次可能又出现"。
    const yaw = BR.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const h of kit.handles({ tag: 'l4-flicker' })) {
      if (!h.active) continue;
      const dx = h.x - BR.player.x, dz = h.z - BR.player.z, d2 = dx * dx + dz * dz;
      if (d2 > EXIT_LOST_RADIUS * EXIT_LOST_RADIUS || d2 < 0.01) { h._lostT = 0; continue; }
      const len = Math.sqrt(d2), dot = (dx / len) * fx + (dz / len) * fz;
      if (dot > 0.2) { h._lostT = 0; continue; }   // 大致在视野前方 ~78° 锥角内算"看得见"
      h._lostT = (h._lostT || 0) + dt;
      if (h._lostT >= EXIT_LOST_SEC) {
        h._lostT = 0;
        if (S.rng() < EXIT_VANISH_CHANCE) {
          h.setActive(false);
          BR.hud.toast('回头一看，那条出路好像不见了……', 2400);
          BR.audio.play('static');
        }
      }
    }

    // ---------- 没涂黑的透明陷阱窗（Entity 2「窗户」）：低语手势引诱 → 贴近时伸手拖拽 ----------
    for (const c of BR.world.chunks()) {
      const wins = c.res && c.res.data && c.res.data.trapWindows;
      if (!wins) continue;
      for (const w of wins) {
        const dx = BR.player.x - w.x, dz = BR.player.z - w.z, d2 = dx * dx + dz * dz;
        if (d2 < WINDOW_LURE_R * WINDOW_LURE_R && S.timer >= w.nextLure) {
          w.nextLure = S.timer + 6 + S.rng() * 5;
          BR.audio.play('whisper');   // 依据「用低语和手势引诱流浪者」
        }
        if (d2 < WINDOW_GRAB_R * WINDOW_GRAB_R && S.timer >= w.nextGrab) {
          w.nextGrab = S.timer + 3;
          BR.gfx.flash(0x140a1c, 0.3, 0.55);   // 依据「再伸出手臂把人拖进窗内的思维空间」——游玩/测试模式只给视觉提示
          if (BR.game.attackPlayers) BR.player.damage({ hp: 8, sanity: 10, source: 'hazard:windows' });
        }
      }
    }
  },
  leave(ctx) { BR.hud.prompt(null); },
});
})();

// ============================================================
// 没有实现的细节（选中版本 wikidot-cn 里提到，但本文件没做）：
//   - entrances「Level 3 电梯」「Level 2 未上锁的门」「Level 283 掉入海洋球池、几率被传送穿过 Level 4 天花板」：
//     这些是"从别的层级进入 Level 4"的方式，触发逻辑写在对方层级的文件里（Level 283 不在首期范围）。
//   - bases「神爱之繁生敌意强烈，通常不与你交易，除非持有宗教物品」「T.B.D. 只售卖没有实际用途的奇特物品」：
//     按用户 2026-09-13"范围决定"，据点只摆静态外观（M.E.G. 储物柜/行军床/电台/旗，神爱之繁生的菌子种植箱，
//     T.B.D. 的怪东西桌），不做交易、不做可进入交互、不驻守会攻击/交谈的 NPC。
//   - items「宗教物品」「没有实际用途的奇特物品」：与据点交易挂钩，没有 js/items 文件，交易系统未实现，不放进 items 表。
//   - 出口"失去视野后消失"只停用触发点、实物还在（kit 没有整座楼梯间的可见性开关）。
// ============================================================
