// Level 2: "Pipe Dreams"
// 来源版本：fandom  URL：https://web.archive.org/web/20251117020519/https://backrooms.fandom.com/wiki/Level_2
//           （原始页面：https://backrooms.fandom.com/wiki/Level_2，wgRevisionId 1080670）  许可：CC BY-SA 3.0
// 外观与布局按游戏主人（贝塔）2026-09-23 的指定重做，用户指定优先于随机选中的版本
//   （data/lore-choices.json levels['2'].userOverride / userRefs，参考图 backrooms-research/refs/2026-09-23/L2-走廊.jpg）：
//   淡黄色墙壁、一条笔直的窄走廊、右手边一整排各式各样的管道（铝皮保温管、细水管、电线管、支架、阀门、接线盒、配电箱）、
//   顶上的桥架和电缆、笼式防护罩的黄色工业灯、有灰和水渍的旧混凝土地面。
// 出口、实体、物品、危害、机制仍只按 fandom 这一个版本；wikidot-en / wikidot-cn 的门系统、荧光灯串联电路、B.N.T.G./大停电历史、
// 死亡飞蛾/杰瑞/无面灵/悲尸/Nguithr'xurhs/尸鼠/人制品售货机/牧蛇/Photoshop/啼物/欺诈鸟 等细节一律不借
// （见 data/lore-choices.json 的 levels['2'].conflicts）。
// 经典 <script> + IIFE，只挂 window.BR；依赖 js/levels/_kit.js。
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const kit = BR.kit;
const U = BR.util;
const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;

// =====================================================================
// 程序化贴图（仓库里没有 jpg，noFile：不去探测文件）
// =====================================================================
// 墙：淡黄色涂料抹灰墙。贴图竖向正好铺满一层楼高（repeatMeters[1] = H），所以画布最上面一行 = 天花板、最下面一行 = 墙根：
// 墙根的脏污带、顶上的熏黄、约 1 m 高的擦痕都能画在对的高度上。所有痕迹都模糊处理，别画成硬边的条和点
BR.assets.registerProcedural('l2_wall_paint', 512, (g, s) => {
  const r = U.rng('l2_wall_paint');
  g.fillStyle = '#e9e1c0'; g.fillRect(0, 0, s, s);
  const blotX = (x, y, rad, col, a) => {
    for (const dx of [-s, 0, s]) {
      const xx = x + dx;
      if (xx + rad < 0 || xx - rad > s) continue;
      const gr = g.createRadialGradient(xx, y, 0, xx, y, rad);
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(xx - rad, y - rad, rad * 2, rad * 2);
    }
  };
  // 涂层厚薄不匀：大片半透明深浅斑
  for (let k = 0; k < 90; k++) { const x = r() * s, y = r() * s, rad = 25 + r() * 90, dk = r() < 0.55, a = 0.04 + r() * 0.07; blotX(x, y, rad, dk ? '160,136,86' : '255,248,220', a); }
  g.filter = 'blur(2px)';
  // 滚筒刷留下的横向淡纹
  for (let k = 0; k < 70; k++) {
    const y = r() * s, x = r() * s, w = 40 + r() * 140, h = 2 + r() * 3, lt = r() < 0.5;
    g.fillStyle = lt ? 'rgba(255,250,228,0.05)' : 'rgba(130,108,66,0.035)';
    for (const dx of [-s, 0, s]) g.fillRect(x + dx, y, w, h);
  }
  // 从上往下的水渍流痕：上宽下尖、越往下越淡
  for (let k = 0; k < 11; k++) {
    const x = r() * s, y0 = r() * s * 0.55, len = 70 + r() * (s - y0) * 0.7, w = 3 + r() * 7, a = 0.07 + r() * 0.08, sway = (r() - 0.5) * 8;
    for (const dx of [-s, 0, s]) {
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, `rgba(135,104,58,${a})`); gr.addColorStop(1, 'rgba(135,104,58,0)');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(x + dx - w / 2, y0); g.lineTo(x + dx + w / 2, y0); g.lineTo(x + dx + sway + 0.5, y0 + len); g.lineTo(x + dx + sway - 0.5, y0 + len);
      g.closePath(); g.fill();
    }
  }
  // 约 1 m 高的横向擦痕（推车、肩膀蹭的）
  for (let k = 0; k < 9; k++) {
    const y = s * (1 - (0.8 + r() * 0.6) / 2.8), x = r() * s, w = 30 + r() * 100, a = 0.06 + r() * 0.08, h = 2 + r() * 3;
    g.fillStyle = `rgba(100,84,58,${a})`;
    for (const dx of [-s, 0, s]) g.fillRect(x + dx, y, w, h);
  }
  g.filter = 'none';
  // 细颗粒
  for (let k = 0; k < 5000; k++) {
    const lt = r() < 0.5, a = 0.04 + r() * 0.08, x = r() * s, y = r() * s;
    g.fillStyle = lt ? `rgba(255,252,235,${a})` : `rgba(120,100,60,${a})`;
    g.fillRect(x, y, 1, 1);
  }
  // 抹灰里零星的小气孔
  for (let k = 0; k < 110; k++) {
    const x = r() * s, y = r() * s, d = 0.5 + r() * 1.0, a = 0.12 + r() * 0.16;
    g.fillStyle = `rgba(110,90,55,${a})`; g.beginPath(); g.arc(x, y, d, 0, TAU); g.fill();
  }
  // 墙根脏污：底部渐深，上沿参差（周期正弦 + 抖动，横向无缝）
  g.filter = 'blur(3px)';
  for (let x = -4; x < s + 4; x += 2) {
    const top = s * (0.82 + 0.03 * Math.sin(x / s * TAU * 3) + 0.02 * Math.sin(x / s * TAU * 7 + 1)) + r() * 5;
    const gr = g.createLinearGradient(0, top, 0, s);
    gr.addColorStop(0, 'rgba(105,84,48,0)'); gr.addColorStop(0.6, 'rgba(105,84,48,0.22)'); gr.addColorStop(1, 'rgba(82,64,36,0.5)');
    g.fillStyle = gr; g.fillRect(x, top, 2, s - top + 8);
  }
  g.filter = 'none';
  // 顶上一圈熏黄
  { const gr = g.createLinearGradient(0, 0, 0, s * 0.08); gr.addColorStop(0, 'rgba(95,76,42,0.22)'); gr.addColorStop(1, 'rgba(95,76,42,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s * 0.08); }
}, { noFile: true });

// 地面/顶板：旧混凝土。地面和天花板共用这张（顶点色区分：地面偏灰褐、顶板提亮成米色），省一个材质槽位 = 省 draw call。
// 水渍（不规则的一圈深色水线 + 里面略深）、灰尘（发白的大片）、细裂缝都画进贴图里，四向无缝
BR.assets.registerProcedural('l2_slab', 512, (g, s) => {
  const r = U.rng('l2_slab');
  g.fillStyle = '#aba28f'; g.fillRect(0, 0, s, s);
  const wrap9 = fn => { for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) fn(dx, dy); };
  const blot = (x, y, rad, col, a) => wrap9((dx, dy) => {
    const xx = x + dx, yy = y + dy;
    if (xx + rad < 0 || xx - rad > s || yy + rad < 0 || yy - rad > s) return;
    const gr = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(xx - rad, yy - rad, rad * 2, rad * 2);
  });
  for (let k = 0; k < 120; k++) { const x = r() * s, y = r() * s, rad = 15 + r() * 80, dk = r() < 0.55, a = 0.05 + r() * 0.09; blot(x, y, rad, dk ? '92,84,68' : '214,205,184', a); }
  for (let k = 0; k < 16; k++) { const x = r() * s, y = r() * s, rad = 40 + r() * 100, a = 0.08 + r() * 0.08; blot(x, y, rad, '226,216,194', a); }   // 积灰
  for (let k = 0; k < 6000; k++) {
    const lt = r() < 0.45, a = 0.05 + r() * 0.1, x = r() * s, y = r() * s, w = 1 + (r() * 1.6 | 0);
    g.fillStyle = lt ? `rgba(232,224,206,${a})` : `rgba(72,66,56,${a})`;
    g.fillRect(x, y, w, w);
  }
  for (let k = 0; k < 320; k++) {
    const x = r() * s, y = r() * s, d = 0.5 + r() * 1.3, a = 0.15 + r() * 0.2;
    g.fillStyle = `rgba(62,57,50,${a})`; g.beginPath(); g.arc(x, y, d, 0, TAU); g.fill();
  }
  // 水渍：不规则的闭合水线（极坐标上叠两层正弦），轻微模糊
  g.filter = 'blur(1.5px)';
  for (let k = 0; k < 5; k++) {
    const x = r() * s, y = r() * s, R = 30 + r() * 55, sq = 0.55 + r() * 0.4, rot = r() * TAU, p1 = r() * TAU, p2 = r() * TAU, lw = 2 + r() * 2;
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * TAU, rr = R * (1 + 0.16 * Math.sin(3 * a + p1) + 0.09 * Math.sin(5 * a + p2));
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr * sq;
        const qx = px * Math.cos(rot) - py * Math.sin(rot), qy = px * Math.sin(rot) + py * Math.cos(rot);
        if (i) g.lineTo(qx, qy); else g.moveTo(qx, qy);
      }
      g.closePath();
    };
    wrap9((dx, dy) => {
      if (x + dx + R * 1.4 < 0 || x + dx - R * 1.4 > s || y + dy + R * 1.4 < 0 || y + dy - R * 1.4 > s) return;
      g.save(); g.translate(x + dx, y + dy);
      path(); g.fillStyle = 'rgba(96,82,60,0.07)'; g.fill();
      g.strokeStyle = 'rgba(92,74,50,0.2)'; g.lineWidth = lw; g.stroke();
      g.restore();
    });
  }
  g.filter = 'none';
  // 细裂缝
  for (let k = 0; k < 6; k++) {
    const pts = [[r() * s, r() * s]];
    let a = r() * TAU;
    for (let i = 0; i < 12; i++) { a += (r() - 0.5) * 1.1; const l = 10 + r() * 16, p = pts[pts.length - 1]; pts.push([p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l]); }
    wrap9((dx, dy) => {
      g.strokeStyle = 'rgba(58,52,44,0.35)'; g.lineWidth = 1; g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0] + dx, p[1] + dy) : g.moveTo(p[0] + dx, p[1] + dy)));
      g.stroke();
    });
  }
}, { noFile: true });

// 保温管的铝皮：竖向一张 = 1.5 m 一节铝皮。画布横纹贴到管子上 v 沿管长 → 一圈圈的环向波纹（30 道，5 cm 一道）；
// 每节开头一道不锈钢箍带和搭接处的阴影也画在贴图里（原来用几何箍带，一块要多一千多个三角面）；再加纵向搭接缝、污迹、划痕
BR.assets.registerProcedural('l2_jacket', 512, (g, s) => {
  const r = U.rng('l2_jacket');
  const RIBS = 30, band = Math.round(s * 0.03), lap = Math.round(s * 0.014);
  for (let y = 0; y < s; y++) {
    const t = y / s * RIBS * TAU;
    let v = 196 + 20 * Math.sin(t) + 7 * Math.sin(2 * t + 0.6);
    let rr = v, gg = v - 6, bb = v - 18;
    const yb = s - 1 - y;                           // 画布最底下一行 = 贴图 v 的起点（flipY）
    if (yb < band) {                                // 箍带：亮钢，上下两条暗边
      const e = yb < 3 || yb >= band - 3;
      rr = gg = bb = e ? 88 : 226 + ((yb * 37) % 9);
    } else if (yb < band + lap) {                   // 下一节铝皮压在箍带下面的那一小段：暗一点
      const k = 0.72 + 0.28 * (yb - band) / lap; rr *= k; gg *= k; bb *= k;
    }
    g.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
    g.fillRect(0, y, s, 1);
  }
  g.fillStyle = 'rgba(70,64,52,0.5)'; g.fillRect(s * 0.5, 0, 3, s - band);          // 纵向搭接缝（在管顶）
  g.fillStyle = 'rgba(255,252,240,0.35)'; g.fillRect(s * 0.5 + 3, 0, 2, s - band);
  for (let k = 0; k < 60; k++) {
    const x = r() * s, y = r() * s, rad = 10 + r() * 60, a = 0.05 + r() * 0.12;
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, `rgba(105,92,66,${a})`); gr.addColorStop(1, 'rgba(105,92,66,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
  for (let k = 0; k < 60; k++) {
    const x = r() * s, y = r() * s, l = 10 + r() * 40, a = r() * TAU, lt = r() < 0.6;
    g.strokeStyle = lt ? 'rgba(255,255,245,0.35)' : 'rgba(60,55,45,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}, { noFile: true });

// =====================================================================
// 尺寸与布局
// =====================================================================
// 用户指定「一条笔直的走廊」：每个区块都有一段南北向（沿 z）的直走廊，净宽 3 m，东侧（面朝北时的右手边）约 0.8 m 是管架，
// 人走的地方约 2.2 m。区块边长 24 m，所以世界里是一条条相隔 24 m 的平行直走廊，每 3 个区块（72 m）才有一条东西向的横通道
// 把它们连起来 —— 隔很远才有一个岔口，不是迷宫。出口放在西墙的门洞、岔口和一段会闪的墙里，按 8 个区块一个周期重复摆。
const SIZE = 24;
const H = 2.8;                        // 层高：顶上要挂桥架、保温管、吊灯，比维修隧道常见的 2.6 高一点
const XW = 10.8, XE = 13.8;           // 主走廊西墙、东墙内表面（区块本地 x）
const XF = 13.0;                      // 管架前沿：碰撞体从这里到东墙
const XPOST = 13.06;                  // 支架立柱中心
const ZC0 = 10.5, ZC1 = 13.5;         // 横通道北墙、南墙（有横通道的区块）
const XSP = 11.9, ZSP = 12;           // 出生点（区块 0,0），面朝北：右手边就是管道
const P1 = { x: 13.44, y: 0.72, r: 0.30 };   // 下面那根粗保温管
const P2 = { x: 13.44, y: 1.62, r: 0.30 };   // 上面那根粗保温管（参考图里靠近视线高度、带破口的那根）
const P3 = { x: 13.58, y: 2.58, r: 0.18 };   // 贴着顶板的第三根保温管，压在托架横担上
const JACKET_U = TAU * 0.3;           // 铝皮贴图横向正好绕管一圈
const JACKET_V = 1.5;                 // 贴图竖向 1.5 m = 一节铝皮（30 道波纹 + 一道箍带）
const TRAY = { x0: 12.56, x1: 13.16, y: 2.40 };   // 梯式桥架（底面高度 y）
const S1 = { x: 13.22, y: 2.12, r: 0.05 };   // 红色消防给水管
const W1 = { x: 13.64, y: 2.093, r: 0.022 };  // 铜水管
const C1 = { x: 13.024, y: 1.10, r: 0.013 }; // 电线管（立柱前面）
const C2 = { x: 13.024, y: 2.20, r: 0.013 };
const DR = { x: 13.62, y: 0.20, r: 0.05 };   // 贴地的灰色排水管
const LAMP_X = 12.2;
const SUP = [1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5];   // 管架支架（立柱 + 三道横担 + 顶上托架）
const MID = [0, 3, 6, 9, 12, 15, 18, 21];                    // 支架之间的桥架吊架
const LAMPS = [2, 6, 10, 14, 18, 22];                        // 吊灯，4 m 一盏
const BEAMS = [4, 12, 20];                                   // 顶板下的混凝土梁
const M1 = 8.9, M2 = 15.1;                                   // 西墙上的小位置（窗户危害、配电箱）

// 出口周期：slot = (cz + 3·cx) mod 8；出生那一列（cx = 0）从出生块往南北各走 4 个区块以内能遇到每一种出口。
// A/B 是西墙上的两处位置（区块本地 z≈5 / z≈19，各自 ±0.8 m 随机挪一点）
const FEAT = {
  0: {},
  1: { A: 'fire3' },                    // 出生块往南 1 块：消防出口 → Level 3
  2: { A: 'fire477' },                  // 消防出口 → Level 477（范围外，kit 自动 sealed）
  3: { B: 'sewer' },                    // 下水道岔口，地上的洞 → Level 34（sealed）
  4: { A: 'glitch27', B: 'neon' },      // 会闪的墙 → Level 27（sealed）+ 霓虹灯岔口 → Level 699（sealed）
  5: { A: 'phi' },                      // 岔口尽头标 Φ 的金色门 → Level Phi（sealed）
  6: { A: 'glitch4' },                  // 会闪的墙 → Level 4
  7: { B: 'fire1' },                    // 出生块往北 1 块：消防出口 → Level 1
};

// 区块变体（先无条件抽一次，第 4.2 节）：整块的氛围变化，和需要占西墙一处位置的小岔口
const VARIANTS = [
  ['plain', 0.62],
  ['hot', 0.09],       // 依据 environment.temperature「蒸汽管密集区可达 60–100 °C」
  ['cold', 0.07],      // 依据 environment.temperature「通风口多的区域较冷」
  ['wood', 0.08],      // 依据 landmarks「较老的木结构区域」
  ['shelter', 0.05],   // 依据 landmarks/bases「小团体用炸药开凿的临时掩体式居住/储物空间」
  ['pipeline', 0.05],  // 依据 landmarks「Biological Pipeline 的入口：位于爬行空间的某些交汇处」
  ['attic', 0.04],     // 依据 landmarks「被认为是木制阁楼的空房间，内有一扇似乎能看到 the Whole 的窗」
];
const BRANCH_KINDS = new Set(['shelter', 'pipeline', 'attic']);

// ---------- 颜色（全部走顶点色，不为分色新开材质）----------
const C = {
  floor: [0.66, 0.6, 0.52], ceil: [1.1, 1.07, 0.98],
  strut: 0x9fa19b, strutDark: 0x767872, rod: 0x6e706b, band: 0xc8c3b4, clamp: 0x8f918b,
  copper: 0xb0683a, fire: 0x7a3024, conduit: 0xbcbeb8, pvc: 0x8e918c, steel: 0x7c807a,
  box: 0xa3a69f, boxDark: 0x5f625c, panel: 0x8d948c, seam: 0x3a3d38,
  fiber: 0xa47c4c, fiber2: 0xd2b688, fiber3: 0x7e5a36,
  wood: 0xa4642e, woodDark: 0x6e3f1c, lampBody: 0x3a3d34, cage: 0x2a2b27, socket: 0x262622,
  cable: [0x1c1c1c, 0x3a3a3a, 0xb0561c, 0x2d3a4a, 0x505050],
  flesh: 0x7a4a42, fleshDark: 0x4e2a28,
};
const BULB = [2.5, 1.9, 0.95];         // 暖黄灯罩（>1，色调映射后是一团刺眼的黄白光）
const BULB_OFF = [0.14, 0.12, 0.09];
const LAMP_COLOR = 0xffc070, LAMP_HOT = 0xff9a4a;
const JK = { p1: [0.98, 0.96, 0.9], p2: [1.0, 0.98, 0.93], p3: [0.9, 0.88, 0.84], cold: [1.06, 1.1, 1.2], hot: [1.0, 0.86, 0.74] };

const WALL = 'L2:wall', SLAB = 'L2:slab', JACKET = 'L2:jacket', PROP = 'kit:prop', GLOW = 'kit:glow';

// ---------- 材质：墙、地面/顶板、保温铝皮三种 + kit 自带的 prop/glow/water ----------
function defineMaterials() {
  kit.mat(WALL, { tex: 'l2_wall_paint', repeatMeters: [3, H], roughness: 0.9, vertexColors: true });
  kit.mat(SLAB, { tex: 'l2_slab', repeatMeters: 3, roughness: 0.92, vertexColors: true });
  kit.mat(JACKET, { tex: 'l2_jacket', repeatMeters: [JACKET_U, JACKET_V], roughness: 0.35, metalness: 0.55, vertexColors: true });
}

// =====================================================================
// 几何小工具
// =====================================================================
// 模板几何缓存：同尺寸的管段、箍带、弯头、灯泡只建一次（b.mesh 只读顶点，不改它们）
const GEO = new Map();
function cached(key, make) { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; }
const q3 = v => Math.round(v * 1000) / 1000;
function gCyl(r, len, seg, axis, open) {
  return cached(`c${r}|${len}|${seg}|${axis}|${open ? 1 : 0}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !!open);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); else g.translate(0, len / 2, 0);
    return g;
  });
}
// 竖向圆台（灯罩、冰锥）：底半径 rb、顶半径 rt，底面在 y = 0（down: true 时顶面在 y = 0、往下长）
function gCone(rb, rt, h, seg, down) {
  return cached(`k${rb}|${rt}|${h}|${seg}|${down ? 1 : 0}`, () => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
    g.translate(0, down ? -h / 2 : h / 2, 0);
    return g;
  });
}
// 缺一块的管皮（保温铝皮撕开处剩下的部分），沿 z
function gCylPart(r, len, seg, t0, tl) {
  return cached(`p${r}|${len}|${seg}|${t0}|${tl}`, () => new THREE.CylinderGeometry(r, r, len, seg, 1, true, t0, tl).rotateX(Math.PI / 2));
}
const AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
// 圆环 / 弯头：THREE.TorusGeometry 在本地 XY 平面、从 (R,0,0) 起沿 +Y 方向弯；把本地 X→A、本地 Y→B 摆到世界方向上。
// swap：UV 对调，让贴图 v 沿弯头走向（铝皮波纹和直管一样是一圈圈的环）
function gTor(R, r, radial, tubular, arc, A, B, swap) {
  return cached(`t${R}|${r}|${radial}|${tubular}|${arc}|${A}|${B}|${swap ? 1 : 0}`, () => {
    const g = new THREE.TorusGeometry(R, r, radial, tubular, arc);
    if (swap) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); } }
    const a = new THREE.Vector3().fromArray(AX[A]), bb = new THREE.Vector3().fromArray(AX[B]);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(a, bb, new THREE.Vector3().crossVectors(a, bb)));
    return g;
  });
}
// 朝 −x 的圆片（表盘）
function gDisc(r, seg) { return cached(`d${r}|${seg}`, () => new THREE.CircleGeometry(r, seg).rotateY(-Math.PI / 2)); }
function gSphere(r, w, h) { return cached(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h)); }

// 圆柱：axis 'y' 时 (x,y,z) 是底面圆心；'x'/'z' 时是轴线中点。铝皮材质走 scaled UV：横向绕一圈、竖向按米数
function cyl(b, x, y, z, r, len, axis, key, color, seg, open) {
  const L = q3(len);
  const jk = key === JACKET;
  return b.mesh(gCyl(r, L, seg || 8, axis, open !== false), key, { x, y, z, color, uv: jk ? 'scaled' : (key === GLOW ? 'solid' : 'stretch'), uvScale: jk ? [JACKET_U, L] : undefined });
}
function elbow(b, cx, cy, cz, R, r, A, B, key, color, radial, tubular) {
  const jk = key === JACKET;
  return b.mesh(gTor(R, r, radial || 12, tubular || 5, Math.PI / 2, A, B, jk), key, {
    x: cx, y: cy, z: cz, color, uv: jk ? 'stretch' : 'stretch', uvRepeat: jk ? [1, (R * Math.PI / 2) / JACKET_V] : undefined,
  });
}
// 盒子（不带碰撞体）：角点给法
function bx(b, x0, y0, z0, x1, y1, z1, color, faces, key) {
  return b.aabb(x0, y0, z0, x1, y1, z1, key || PROP, { color, solid: false, faces: faces || 'all', uv: key && key !== PROP ? 'world' : 'stretch' });
}
// 盒子（不带碰撞体）：底面中心给法，可绕 y 转
function part(b, x, y, z, w, h, d, color, faces, rotY) {
  return b.box(x, y, z, w, h, d, PROP, { color, solid: false, faces: faces || 'all', uv: 'stretch', rotY });
}
// 任意两点之间的细杆（垂下来的电缆、软管）：朝向每次都不同，没法缓存，只给少量件用
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
function stick(b, p0, p1, r, color, seg, key) {
  _dir.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _dir.length();
  if (len < 1e-4) return null;
  _dir.divideScalar(len);
  const g = new THREE.CylinderGeometry(r, r, len, seg || 5, 1, true);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _dir));
  const pc = b.mesh(g, key || PROP, { x: (p0[0] + p1[0]) / 2, y: (p0[1] + p1[1]) / 2, z: (p0[2] + p1[2]) / 2, color, uv: key === GLOW ? 'solid' : 'stretch' });
  g.dispose();
  return pc;
}
function polyline(b, pts, r, color, seg) { for (let i = 0; i + 1 < pts.length; i++) stick(b, pts[i], pts[i + 1], r, color, seg); }
// 竖直平面 x = const 上的三角形（面朝 +x 或 −x，自动排绕序）
function triX(b, x, a, c, d, key, color, facing) {
  // a/c/d = [z, y]
  const cr = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
  const want = facing === '-x' ? -1 : 1;
  const p = [x, a[1], a[0]], q = [x, c[1], c[0]], w = [x, d[1], d[0]];
  if (Math.sign(cr) === want) b.quad(p, q, w, w, key, { color, uv: key === WALL ? 'world' : 'stretch' });
  else b.quad(p, w, q, q, key, { color, uv: key === WALL ? 'world' : 'stretch' });
}

// =====================================================================
// 墙、地面、顶板
// =====================================================================
// 沿 z 的墙面（主走廊西墙 facing '+x' / 东墙 facing '-x'），按洞口切段：holes [{ z0, z1, y0, y1, solid }]
// 每段一个立面 + 0.5 m 厚的碰撞体（墙后是实心岩体，没人看得到背面）；solid: true 的洞（窗户）整列照样挡人
function wallZ(b, x, facing, z0, z1, holes) {
  const T = 0.5, dir = facing === '+x' ? -1 : 1;
  const xa = Math.min(x, x + dir * T), xb = Math.max(x, x + dir * T);
  const seg = (za, zb, ya, yb, solid) => {
    if (zb - za < 1e-3 || yb - ya < 1e-3) return;
    b.plane(x, ya, (za + zb) / 2, zb - za, yb - ya, WALL, { facing });
    if (solid) b.solid(xa, ya, za, xb, yb, zb);
  };
  let z = z0;
  for (const h of holes.filter(o => o.z1 > z0 && o.z0 < z1).sort((a, c) => a.z0 - c.z0)) {
    seg(z, h.z0, 0, H, true);
    seg(h.z0, h.z1, 0, h.y0, true);
    seg(h.z0, h.z1, h.y1, H, true);
    if (h.solid) b.solid(xa, 0, h.z0, xb, H, h.z1);
    z = Math.max(z, h.z1);
  }
  seg(z, z1, 0, H, true);
}
// 沿 x 的墙面（横通道北墙 facing '+z' / 南墙 facing '-z'）
function wallX(b, z, facing, x0, x1) {
  const T = 0.5, dir = facing === '+z' ? -1 : 1;
  if (x1 - x0 < 1e-3) return;
  b.plane((x0 + x1) / 2, 0, z, x1 - x0, H, WALL, { facing });
  b.solid(x0, 0, Math.min(z, z + dir * T), x1, H, Math.max(z, z + dir * T));
}
function slab(b, x0, z0, x1, z1, yc, floorC, ceilC) {
  b.plane((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, z1 - z0, SLAB, { facing: 'up', color: floorC || C.floor });
  b.plane((x0 + x1) / 2, yc == null ? H : yc, (z0 + z1) / 2, x1 - x0, z1 - z0, SLAB, { facing: 'down', color: ceilC || C.ceil });
}

// =====================================================================
// 灯：笼式防护罩的工业灯（吊灯 / 壁灯）
// =====================================================================
// 灯头：防潮型工业灯（俗称"果酱罐灯"）——铸铝灯座 + 往外张的裙边 + 螺纹压圈 + 长圆的玻璃灯罩 + 四根弯丝的铁丝防护笼
// （一道箍圈 + 底部压盖）；yTop = 灯座顶面。灯罩整只发光（参考图里灯是一团刺眼的暖黄光，看不清灯泡），返回灯罩件（linkGlow 用）。
// 一盏约 250 个三角面：横通道区块一块有 5 盏吊灯 + 2–3 盏壁灯，再多就顶到每块 8000 面的上限
const LAMP_R = 0.062, LAMP_SY = 1.35;                           // 玻璃灯罩半径、竖向拉长
const CAGE = (() => {                                            // 防护笼四根丝：相对灯座顶面的折线（竖直段 + 绕着灯罩往底部压盖收的斜段）
  const yc = -0.098 - LAMP_R * LAMP_SY * 0.92, out = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    out.push([[c * 0.074, -0.1, s * 0.074], [c * 0.081, yc + 0.012, s * 0.081], [c * 0.03, yc - 0.1, s * 0.03]]);
  }
  return { yc, wires: out };
})();
// 任意两点之间的细杆，按端点缓存（灯笼丝这种反复出现、朝向固定的件）
function gStick(p0, p1, r, seg) {
  return cached(`w${p0.map(q3)}|${p1.map(q3)}|${r}|${seg}`, () => {
    const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    return g;
  });
}
function gGlobe() { return cached('globe', () => new THREE.SphereGeometry(LAMP_R, 8, 4).scale(1, LAMP_SY, 1)); }
function lampHead(b, x, z, yTop, lit) {
  cyl(b, x, yTop - 0.05, z, 0.066, 0.05, 'y', PROP, C.lampBody, 8, true);          // 灯座（顶上被吊杆/灯臂挡着，不要端面）
  b.mesh(gCone(0.086, 0.066, 0.03, 8), PROP, { x, y: yTop - 0.081, z, color: C.lampBody });   // 裙边
  cyl(b, x, yTop - 0.1, z, 0.075, 0.019, 'y', PROP, 0x86887f, 8, true);           // 螺纹压圈
  const yc = yTop + CAGE.yc;
  const bulb = b.mesh(gGlobe(), GLOW, { x, y: yc, z, color: lit ? BULB : BULB_OFF, uv: 'solid' });
  for (const w of CAGE.wires) for (let i = 0; i + 1 < w.length; i++) b.mesh(gStick(w[i], w[i + 1], 0.0035, 3), PROP, { x, y: yTop, z, color: C.cage });
  b.mesh(gTor(0.081, 0.0045, 3, 8, TAU, '+z', '+x'), PROP, { x, y: yc + 0.012, z, color: C.cage });
  cyl(b, x, yc - 0.108, z, 0.03, 0.012, 'y', PROP, C.cage, 6, false);             // 笼底压盖
  return { bulb, y: yc };
}
function lampLight(b, x, z, head, state, flick, color) {
  if (state === 'broken') return null;
  const src = b.light({ x, y: head.y, z, color: color || LAMP_COLOR, intensity: 1.45, range: 8.5, flicker: state === 'flicker' ? flick : 0 });
  b.linkGlow(head.bulb, src, BULB, 0.08);
  return src;
}
// 吊灯：顶上一个八角接线盒 + 电线管吊杆
function pendant(b, x, z, state, flick, color) {
  cyl(b, x, H - 0.04, z, 0.055, 0.04, 'y', PROP, C.box, 6, false);
  cyl(b, x, 2.42, z, 0.011, H - 0.04 - 2.42, 'y', PROP, C.conduit, 5, true);
  const head = lampHead(b, x, z, 2.42, state !== 'broken');
  return lampLight(b, x, z, head, state, flick, color);
}
// 壁灯：墙上底板 + 弯臂伸出 0.24 m，灯头挂在臂端；(x, z) 是墙面上的点，rot 让本地 +z 指向墙外
function wallLamp(b, x, z, rot, y, state, flick, color) {
  b.push(x, z, rot);
  part(b, 0, y - 0.07, 0.005, 0.09, 0.14, 0.01, C.lampBody);
  part(b, 0, y - 0.018, 0.13, 0.024, 0.024, 0.24, C.lampBody);
  const head = lampHead(b, 0, 0.24, y - 0.02, state !== 'broken');
  const src = lampLight(b, 0, 0.24, head, state, flick, color);
  b.pop();
  return src;
}

// =====================================================================
// 管架（东侧一整排）
// =====================================================================
function jacketRun(b, P, z0, z1, tint, tears) {
  let z = z0;
  const seg = (a, c) => { if (c - a > 0.01) cyl(b, P.x, P.y, (a + c) / 2, P.r, c - a, 'z', JACKET, tint, 14, true); };
  for (const t of tears) { if (t[1] <= z0 || t[0] >= z1) continue; seg(z, t[0]); z = t[1]; }
  seg(z, z1);   // 箍带画在铝皮贴图里（1.5 m 一道）
}
// 保温铝皮撕开一块（参考图右侧那根管子）：露出里面发黄的保温棉（表面疙疙瘩瘩的棉层 + 从口子里鼓出来的几团），
// 撕口一圈参差的锯齿毛边，边上还有几片翻卷出来的铝皮
const TEAR_HALF = 0.5;                                        // 破口沿管长 1 m（落在两个支架正中间，支架相隔 3 m）
const TEAR_T0 = 1.75 * Math.PI, TEAR_TL = 1.05 * Math.PI;   // 剩下的铝皮：前下方 → 底 → 靠墙 → 后上方；缺的是朝走廊的上半
// 按坐标取的确定性哈希（坐标取到 0.1 mm 的整数再哈希：同一位置的重复顶点算出同一个值，凹凸不会在接缝处裂开）；不用 Math.random
function hash3(x, y, z, k) { return U.hashInts(Math.round(x * 1e4), Math.round(y * 1e4), Math.round(z * 1e4), k | 0) / 4294967296; }
// 表面起伏的棉层（沿 z 的开口圆筒，半径逐点 ±11%；给的半径要留余量，最鼓处也不能顶穿外面的铝皮）
function gLumpyCyl(r, len, k) {
  return cached(`lc${r}|${len}|${k}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, 10, 4, true), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), m = 0.89 + 0.22 * hash3(x, y, z, k); pos.setX(i, x * m); pos.setZ(i, z * m); }
    g.computeVertexNormals();
    return g.rotateX(Math.PI / 2);
  });
}
// 一团蓬松的棉絮：压扁拉长、表面凹凸的小球
function gFluff(r, k, lo) {
  return cached(`fl${r}|${k}|${lo ? 1 : 0}`, () => {
    const g = new THREE.SphereGeometry(r, lo ? 5 : 6, lo ? 3 : 4), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), m = 0.72 + 0.5 * hash3(x, y, z, k); pos.setXYZ(i, x * m, y * m * 0.72, z * m * 1.3); }
    g.computeVertexNormals();
    return g;
  });
}
function tearAt(b, P, za, zb, tint, h) {
  const len = q3(zb - za), zm = (za + zb) / 2, hk = Math.floor(h * 4);
  b.mesh(gLumpyCyl(P.r - 0.035, q3(len + 0.04), hk), PROP, { x: P.x, y: P.y, z: zm, color: C.fiber });
  b.mesh(gCylPart(P.r, len, 10, TEAR_T0, TEAR_TL), JACKET, { x: P.x, y: P.y, z: zm, color: tint, uv: 'scaled', uvScale: [JACKET_U, len] });
  // 截面上 θ 的点：(x + r·sinθ, y − r·cosθ)；θ 增大方向的切向是 (cosθ, sinθ)
  const at = (th, rr) => [P.x + rr * Math.sin(th), P.y - rr * Math.cos(th)];
  // 锯齿毛边和翻卷的铝皮都是两面可见的薄片：攒进一个几何里一次交给 builder（每片正反两个三角形，不用 quad 的退化三角形）
  const tv = [];
  const tri2 = (p0, p1, p2) => tv.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p1);
  // 撕口的锯齿毛边：沿撕口一段段往缺口里伸出长短不一的三角齿
  const rr = P.r + 0.002;
  const teethZ = (th, dir, n) => {                  // 沿管长方向的两条撕口
    const tx = Math.cos(th) * dir, ty = Math.sin(th) * dir, e = at(th, rr);
    for (let i = 0; i < n; i++) {
      const z0 = za + 0.02 + i / n * (len - 0.04), z1 = za + 0.02 + (i + 1) / n * (len - 0.04), ht = 0.018 + 0.05 * hash3(z0, th, 1, hk);
      tri2([e[0], e[1], z0], [e[0], e[1], z1], [e[0] + tx * ht, e[1] + ty * ht, (z0 + z1) / 2 + (hash3(z1, th, 2, hk) - 0.5) * 0.03]);
    }
  };
  const teethT = (z, dz, n) => {                    // 两头环向的撕口：从 T0+TL 绕到 T0+2π
    for (let i = 0; i < n; i++) {
      const t0 = TEAR_T0 + TEAR_TL + i / n * (2 * Math.PI - TEAR_TL), t1 = TEAR_T0 + TEAR_TL + (i + 1) / n * (2 * Math.PI - TEAR_TL);
      const a = at(t0, rr), c = at(t1, rr), m = at((t0 + t1) / 2, rr + 0.004), ht = 0.02 + 0.06 * hash3(t0, z, 3, hk);
      tri2([a[0], a[1], z], [c[0], c[1], z], [m[0], m[1], z + dz * ht]);
    }
  };
  teethZ(TEAR_T0, -1, 9);
  teethZ(TEAR_T0 + TEAR_TL, 1, 9);
  teethT(za, 1, 9);
  teethT(zb, -1, 9);
  // 翻卷出来的几片铝皮
  const flap = (th, zA, zB, tip) => { const a = at(th, P.r); tri2([a[0], a[1], zA], [a[0], a[1], zB], [tip[0], tip[1], (zA + zB) / 2 + (h - 0.5) * 0.08]); };
  const lo = at(TEAR_T0, P.r), hi = at(TEAR_T0 + TEAR_TL, P.r);
  flap(TEAR_T0, za + 0.06, za + 0.3, [lo[0] - 0.09, lo[1] - 0.07]);
  flap(TEAR_T0, zb - 0.28, zb - 0.1, [lo[0] - 0.06, lo[1] - 0.1]);
  flap(TEAR_T0 + TEAR_TL, za + 0.2, za + 0.42, [hi[0] - 0.04, hi[1] + 0.1]);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(tv.length / 3 * 2).fill(0.5), 2));
  tg.computeVertexNormals();
  b.mesh(tg, JACKET, { color: tint, uv: 'stretch' });
  tg.dispose();
  // 从口子里鼓出来的棉絮
  const cols = [C.fiber, C.fiber2, C.fiber3];
  for (let k = 0; k < 4; k++) {
    const th = 0.95 * Math.PI + (k + 0.5) / 4 * 0.7 * Math.PI, p = at(th, P.r * 0.9);
    const z = za + 0.1 + ((k * 0.37 + h) % 1) * (len - 0.2);
    b.mesh(gFluff(k % 2 ? 0.075 : 0.06, (hk + k) % 4, true), PROP, { x: p[0], y: p[1], z, color: cols[(k + hk) % 3] });
  }
  // 垂下来的一缕棉絮
  const d = at(1.55 * Math.PI, P.r);
  b.mesh(gFluff(0.045, 3, true), PROP, { x: d[0] - 0.03, y: d[1] - 0.06, z: zm + 0.1, color: C.fiber2 });
}

// 管架支架：立柱（槽钢）+ 三道横担（托下管、托上管、托小管）+ 管卡 + 顶上托架横担（桥架和第三根保温管压在上面）+ 吊杆
function support(b, z, st) {
  const wood = st.kind === 'wood';
  const pc = wood ? C.wood : C.strut, pw = wood ? 0.085 : 0.042;
  const x0 = XPOST - pw / 2, x1 = XPOST + pw / 2;
  bx(b, x0, 0, z - pw / 2, x1, TRAY.y - 0.045, z + pw / 2, pc, 'sides');
  if (!wood) {
    // 立柱上一串长圆孔（槽钢的特征），底座钢板 + 两颗膨胀螺栓
    for (let y = 0.25; y < 2.2; y += 0.5) bx(b, x0 - 0.002, y, z - 0.007, x0, y + 0.05, z + 0.007, C.strutDark, ['nx']);
    bx(b, XPOST - 0.07, 0, z - 0.06, XPOST + 0.07, 0.008, z + 0.06, C.strutDark, ['py', 'nx', 'pz', 'nz']);
  }
  for (const ya of [P1.y - P1.r - 0.043, P2.y - P2.r - 0.043, 2.028]) {
    bx(b, x1, ya, z - pw / 2 + 0.002, XE, ya + 0.041, z + pw / 2 - 0.002, pc, ['py', 'ny', 'pz', 'nz']);
  }
  // 管卡：抱箍 + 朝走廊那边的螺栓耳
  for (const P of [P1, P2]) {
    cyl(b, P.x, P.y, z, P.r + 0.012, 0.04, 'z', PROP, C.clamp, 14, true);
    bx(b, P.x - P.r - 0.05, P.y - 0.012, z - 0.018, P.x - P.r - 0.008, P.y + 0.012, z + 0.018, C.clamp, ['nx', 'py', 'ny', 'pz', 'nz']);
  }
  // 托架横担：从桥架外侧一直到东墙
  bx(b, 12.50, TRAY.y - 0.045, z - 0.021, XE, TRAY.y - 0.005, z + 0.021, pc, ['ny', 'pz', 'nz', 'nx']);
  bx(b, 12.514, TRAY.y - 0.005, z - 0.006, 12.526, H, z + 0.006, C.rod, 'sides');
  bx(b, 12.505, TRAY.y - 0.06, z - 0.012, 12.535, TRAY.y - 0.045, z + 0.012, C.rod, ['ny', 'px', 'nx', 'pz', 'nz']);   // 螺母
  cyl(b, P3.x, P3.y, z, P3.r + 0.01, 0.035, 'z', PROP, C.clamp, 8, true);
}
// 两个支架之间的桥架吊架：短横担 + 两根吊杆
function midHanger(b, z, cross) {
  bx(b, 12.50, TRAY.y - 0.045, z - 0.021, 13.24, TRAY.y - 0.005, z + 0.021, C.strut, ['ny', 'pz', 'nz', 'nx', 'px']);
  for (const x of [12.52, 13.22]) bx(b, x - 0.006, TRAY.y - 0.005, z - 0.006, x + 0.006, H, z + 0.006, C.rod, 'sides');
  if (cross) {
    // 横通道路口没有立柱：小管挂在单独的吊杆横担上跨过去
    bx(b, 13.12, 2.028, z - 0.02, 13.7, 2.068, z + 0.02, C.strut);
    bx(b, 13.294, 2.068, z - 0.006, 13.306, H, z + 0.006, C.rod, 'sides');
    cyl(b, P3.x, P3.y, z, P3.r + 0.01, 0.035, 'z', PROP, C.clamp, 8, true);
  }
}
// 梯式桥架：两条侧边 + 横档 + 里面躺着的几根电缆
function cableTray(b) {
  bx(b, TRAY.x0, TRAY.y, 0, TRAY.x0 + 0.015, TRAY.y + 0.08, SIZE, C.strut, ['px', 'nx', 'py', 'ny']);
  bx(b, TRAY.x1 - 0.015, TRAY.y, 0, TRAY.x1, TRAY.y + 0.08, SIZE, C.strut, ['px', 'nx', 'py', 'ny']);
  for (let z = 0.2; z < SIZE; z += 0.4) bx(b, TRAY.x0 + 0.015, TRAY.y + 0.001, z - 0.012, TRAY.x1 - 0.015, TRAY.y + 0.014, z + 0.012, C.strutDark, ['ny']);
  const cx = [12.64, 12.7, 12.8, 12.93, 13.06], cr = [0.018, 0.013, 0.022, 0.016, 0.02];
  for (let k = 0; k < cx.length; k++) cyl(b, cx[k], TRAY.y + 0.015 + cr[k], SIZE / 2, cr[k], SIZE, 'z', PROP, C.cable[k], 6, true);
}

// 小管线：红色消防管、铜水管、两根电线管、贴地排水管（zs：分段 [z0, z1]）
function smallPipes(b, cross) {
  const full = [[0, SIZE]];
  const runs = (P, segs, color, seg) => { for (const s of segs) cyl(b, P.x, P.y, (s[0] + s[1]) / 2, P.r, s[1] - s[0], 'z', PROP, color, seg, true); };
  runs(S1, full, C.fire, 10);
  for (let z = 0.2; z < SIZE; z += 3) cyl(b, S1.x, S1.y, z, S1.r + 0.01, 0.07, 'z', PROP, 0x6e241c, 8, true);   // 沟槽卡箍
  runs(W1, full, C.copper, 8);
  for (let z = 1.1; z < SIZE; z += 6) cyl(b, W1.x, W1.y, z, W1.r + 0.005, 0.04, 'z', PROP, 0x8a5230, 6, true);   // 焊接套管
  runs(C2, full, C.conduit, 6);
  runs(C1, cross ? [[0, 7.5], [16.5, SIZE]] : full, C.conduit, 6);
  for (let z = 0.5; z < SIZE; z += 6) {
    if (!cross || z < 7.5 || z > 16.5) cyl(b, C1.x, C1.y, z, C1.r + 0.004, 0.035, 'z', PROP, 0x9a9c97, 5, true);   // 电线管接头
    cyl(b, C2.x, C2.y, z, C2.r + 0.004, 0.035, 'z', PROP, 0x9a9c97, 5, true);
  }
  // 排水管：路口处钻进地面，过了路口再钻出来
  const drain = cross ? [[0, 8.6], [15.4, SIZE]] : full;
  runs(DR, drain, C.pvc, 8);
  if (cross) {
    elbow(b, DR.x, DR.y - 0.12, 8.6, 0.12, DR.r, '+z', '+y', PROP, C.pvc, 8, 4);
    elbow(b, DR.x, DR.y - 0.12, 15.4, 0.12, DR.r, '-z', '+y', PROP, C.pvc, 8, 4);
    cyl(b, DR.x, -0.02, 8.72, DR.r, 0.1, 'y', PROP, C.pvc, 8, true);
    cyl(b, DR.x, -0.02, 15.28, DR.r, 0.1, 'y', PROP, C.pvc, 8, true);
  }
  for (let z = 1.2; z < SIZE; z += 4) if (!cross || z < 8.4 || z > 15.6) bx(b, DR.x - 0.04, 0, z - 0.05, DR.x + 0.04, DR.y - DR.r - 0.002, z + 0.05, 0x6d6a62, 'noBottom');   // 垫块
}

// 主管（P1/P2/P3）：有横通道时 P1/P2 在路口前弯下去钻进地面、过了路口再从地里弯上来（给东侧的岔口让出路）
function bigPipes(b, st) {
  const tint1 = st.kind === 'cold' ? JK.cold : st.kind === 'hot' ? JK.hot : JK.p1;
  const tint2 = st.kind === 'cold' ? JK.cold : st.kind === 'hot' ? JK.hot : JK.p2;
  const tears = { 1: [], 2: [] };
  for (const t of st.tears) tears[t.p].push([t.z - TEAR_HALF, t.z + TEAR_HALF]);
  const R = 0.35;
  if (!st.cross) {
    jacketRun(b, P1, 0, SIZE, tint1, tears[1]);
    jacketRun(b, P2, 0, SIZE, tint2, tears[2]);
  } else {
    // 北半：P1 先下（z 9.1 起弯，竖管在 9.45），P2 后下（9.8 起弯，竖管在 10.15），两根竖管错开不打架
    const dive = [[P1, 9.1, tint1, 1], [P2, 9.8, tint2, 2]];
    for (const [P, z0, tint, id] of dive) {
      jacketRun(b, P, 0, z0, tint, tears[id]);
      elbow(b, P.x, P.y - R, z0, R, P.r, '+z', '+y', JACKET, tint, 14, 4);
      cyl(b, P.x, -0.02, z0 + R, P.r, P.y - R + 0.02, 'y', JACKET, tint, 14, true);
      cyl(b, P.x, 0, z0 + R, P.r + 0.035, 0.07, 'y', PROP, C.band, 12, true);   // 穿地面的套管
      bx(b, P.x - P.r - 0.1, 0, z0 + R - P.r - 0.1, P.x + P.r + 0.06, 0.03, z0 + R + P.r + 0.1, 0x8a8478, 'noBottom');   // 水泥护墩
    }
    // 南半：镜像
    const rise = [[P2, 14.2, tint2, 2], [P1, 14.9, tint1, 1]];
    for (const [P, z1, tint, id] of rise) {
      jacketRun(b, P, z1, SIZE, tint, tears[id]);
      elbow(b, P.x, P.y - R, z1, R, P.r, '-z', '+y', JACKET, tint, 14, 4);
      cyl(b, P.x, -0.02, z1 - R, P.r, P.y - R + 0.02, 'y', JACKET, tint, 14, true);
      cyl(b, P.x, 0, z1 - R, P.r + 0.035, 0.07, 'y', PROP, C.band, 12, true);
      bx(b, P.x - P.r - 0.1, 0, z1 - R - P.r - 0.1, P.x + P.r + 0.06, 0.03, z1 - R + P.r + 0.1, 0x8a8478, 'noBottom');
    }
  }
  for (const t of st.tears) tearAt(b, t.p === 1 ? P1 : P2, t.z - TEAR_HALF, t.z + TEAR_HALF, t.p === 1 ? tint1 : tint2, t.h);
  // P3：一整根贴着顶板
  cyl(b, P3.x, P3.y, SIZE / 2, P3.r, SIZE, 'z', JACKET, st.kind === 'cold' ? JK.cold : JK.p3, 12, true);
  // 管道标识：绿底白字 + 流向箭头（贴在上管正面）
  for (const zl of [7.05, 19.05]) {
    if (st.cross && zl > 8.5 && zl < 15.5) continue;
    if (st.tears.some(t => t.p === 2 && Math.abs(t.z - zl - 0.15) < TEAR_HALF + 0.2)) continue;
    const xf = P2.x - P2.r - 0.008;
    bx(b, xf, P2.y - 0.045, zl, xf + 0.006, P2.y + 0.045, zl + 0.3, 0x2f7a3a, ['nx']);
    for (let k = 0; k < 4; k++) bx(b, xf - 0.001, P2.y - 0.012, zl + 0.03 + k * 0.045, xf, P2.y + 0.014, zl + 0.03 + k * 0.045 + 0.03, 0xe8e6dc, ['nx']);
    const xa = xf - 0.001;
    b.quad([xa, P2.y + 0.03, zl + 0.22], [xa, P2.y - 0.03, zl + 0.22], [xa, P2.y, zl + 0.285], [xa, P2.y, zl + 0.285], PROP, { color: 0xe8e6dc, uv: 'stretch' });
  }
}

// 接线盒：挂在立柱正面，电线管从侧面穿进去，顶上一根竖管接到上面那根电线管
function junctionBox(b, z, up) {
  bx(b, 12.975, 1.02, z - 0.065, 13.038, 1.18, z + 0.065, C.box, ['nx', 'py', 'ny', 'pz', 'nz']);
  bx(b, 12.969, 1.014, z - 0.07, 12.975, 1.186, z + 0.07, 0xb4b7b0, ['nx', 'py', 'ny', 'pz', 'nz']);
  for (const dy of [0.02, 0.152]) for (const dz of [-0.05, 0.05]) bx(b, 12.966, 1.014 + dy, z + dz - 0.006, 12.969, 1.014 + dy + 0.012, z + dz + 0.006, C.boxDark, ['nx']);
  if (up) {
    cyl(b, C1.x, 1.186, z, 0.011, C2.y - 1.186, 'y', PROP, C.conduit, 6, true);
    cyl(b, C1.x, 1.186, z, 0.016, 0.03, 'y', PROP, 0x8e908b, 6, false);
  }
}
// 管架上的配电箱（参考图右下方那只深色铁箱）：挂在一根立柱正面（箱背离立柱 4 mm，前面那根电线管从箱子里穿过），门比箱体小一圈、往外凸 4 mm，
// 竖把手 + 锁芯、两片合页、黄色警示三角、铭牌、底部百叶；箱顶一根电线管接到上面那根电线管，箱底一根钻进地面
function rackPanel(b, z) {
  const xb = 13.035, D = 0.16, W = 0.46, y0 = 0.72, Hh = 0.62, xf = xb - D, y1 = y0 + Hh;
  const zl = z - W / 2, zr = z + W / 2, xd = xf - 0.004;
  bx(b, xf, y0, zl, xb, y1, zr, 0x3d403b, ['nx', 'py', 'ny', 'pz', 'nz']);                                // 箱体
  bx(b, xd, y0 + 0.02, zl + 0.02, xf, y1 - 0.02, zr - 0.02, 0x4a4e47, ['nx', 'py', 'ny', 'pz', 'nz']);     // 门
  bx(b, xd - 0.028, y0 + 0.24, zr - 0.075, xd, y0 + 0.4, zr - 0.05, 0x1f201e);                              // 竖把手
  bx(b, xd - 0.012, y0 + 0.44, zr - 0.072, xd, y0 + 0.47, zr - 0.052, 0xa9aaa3, ['nx', 'py', 'ny', 'pz', 'nz']);   // 锁芯
  for (const y of [y0 + 0.08, y1 - 0.14]) bx(b, xd - 0.01, y, zl + 0.004, xf, y + 0.06, zl + 0.024, 0x2c2e2b, ['nx', 'py', 'ny', 'nz']);   // 合页
  const xs = xd - 0.001;
  triX(b, xs, [z - 0.07, y0 + 0.42], [z + 0.07, y0 + 0.42], [z, y0 + 0.54], PROP, 0xe0b21c, '-x');          // 警示三角（黄底）
  bx(b, xs - 0.001, y0 + 0.45, z - 0.008, xs, y0 + 0.5, z + 0.008, 0x151515, ['nx']);                        // 三角里的黑道
  bx(b, xs - 0.001, y0 + 0.18, z - 0.1, xs, y0 + 0.24, z + 0.06, 0xe6e3d8, ['nx']);                           // 铭牌
  for (let k = 0; k < 4; k++) bx(b, xd - 0.006, y0 + 0.05 + k * 0.028, z - 0.12, xd, y0 + 0.062 + k * 0.028, z + 0.1, 0x2b2d2a, ['nx', 'py']);   // 百叶
  // 进出线管：箱顶一根竖上去，在电线管高度用一只接头盒接进去；箱底一根竖进地面（带一块地面法兰）
  cyl(b, 12.975, y1, z - 0.12, 0.014, C2.y - 0.02 - y1, 'y', PROP, C.conduit, 6, true);
  bx(b, 12.955, C2.y - 0.035, z - 0.145, 13.045, C2.y + 0.035, z - 0.095, 0x9a9c97);
  cyl(b, 12.975, 0, z + 0.12, 0.018, y0, 'y', PROP, C.conduit, 6, true);
  bx(b, 12.935, 0, z + 0.08, 13.015, 0.008, z + 0.16, C.strutDark, 'noBottom');
  b.solid(xd - 0.03, y0, zl, XF, y1, zr);
}
// 阀门组：从地上立起一根钢管接到红色消防管，中间一个闸阀（红手轮朝走廊）+ 一块压力表
function valveStation(b, z) {
  const x = 13.1;
  cyl(b, x, 0, z, 0.032, S1.y, 'y', PROP, C.steel, 8, true);
  bx(b, x - 0.04, S1.y - 0.04, z - 0.04, x + 0.04, S1.y + 0.04, z + 0.04, C.steel);            // 三通
  cyl(b, (x + S1.x - S1.r) / 2 + 0.02, S1.y, z, 0.03, S1.x - S1.r - x + 0.02, 'x', PROP, C.steel, 8, true);
  bx(b, x - 0.05, 0, z - 0.05, x + 0.05, 0.02, z + 0.05, C.strutDark, 'noBottom');
  // 闸阀
  bx(b, x - 0.045, 1.2, z - 0.05, x + 0.045, 1.31, z + 0.05, 0x6b2a22);
  cyl(b, x - 0.075, 1.255, z, 0.028, 0.06, 'x', PROP, 0x6b2a22, 8, false);
  cyl(b, x - 0.13, 1.255, z, 0.008, 0.06, 'x', PROP, 0xb8b6ae, 5, true);
  b.mesh(gTor(0.08, 0.009, 4, 10, TAU, '+z', '+y'), PROP, { x: x - 0.16, y: 1.255, z, color: 0xa3261c });
  part(b, x - 0.16, 1.25, z, 0.012, 0.012, 0.16, 0xa3261c);
  part(b, x - 0.16, 1.175, z, 0.012, 0.16, 0.012, 0xa3261c);
  // 压力表
  bx(b, x - 0.05, 1.74, z - 0.008, x - 0.032, 1.756, z + 0.008, C.steel);
  cyl(b, x - 0.065, 1.748, z, 0.05, 0.03, 'x', PROP, 0x2d2f2c, 10, false);
  b.mesh(gDisc(0.043, 10), PROP, { x: x - 0.0815, y: 1.748, z, color: 0xe9e5d6 });
  b.push(x - 0.0825, z, 0);
  part(b, 0, 1.748, 0.012, 0.001, 0.004, 0.034, 0x1a1a1a, ['nx'], 0.6);
  part(b, 0, 1.768, -0.02, 0.001, 0.012, 0.012, 0xb02020, ['nx']);
  b.pop();
}
// 木框护箱（参考图右下角那种橙红色木框）：罩在两根保温管前面，里面塞满了发黄的保温棉
function woodFrame(b, zc) {
  const z0 = zc - 0.55, z1 = zc + 0.55, w = C.wood, wd = C.woodDark;
  for (const z of [z0, z1]) bx(b, 12.93, 0.25, z - 0.045, 12.97, 2.02, z + 0.045, w);              // 前面两根竖框
  bx(b, 12.93, 1.94, z0 + 0.045, 12.97, 2.02, z1 - 0.045, w);                                       // 上横框
  bx(b, 12.93, 0.25, z0 + 0.045, 12.97, 0.33, z1 - 0.045, w);                                       // 下横框
  bx(b, 12.932, 1.1, z0 + 0.045, 12.968, 1.16, z1 - 0.045, wd);                                     // 中横框
  // 两侧夹板：保温管从木框里穿过去，所以夹板在两根管子的位置各开一个方口（整块夹板会把管子"截断"，从走廊纵向看像管子到这儿就断了）
  const xh = P1.x - P1.r - 0.03;
  const sideY = [[0.25, P1.y - P1.r - 0.03], [P1.y + P1.r + 0.03, P2.y - P2.r - 0.03], [P2.y + P2.r + 0.03, 2.02]];
  for (const z of [z0, z1]) {
    bx(b, 12.97, 0.25, z - 0.009, xh, 2.02, z + 0.009, wd, ['px', 'nx', 'pz', 'nz', 'py']);
    for (const [ya, yb] of sideY) bx(b, xh, ya, z - 0.009, XE - 0.02, yb, z + 0.009, wd, ['pz', 'nz', 'py', 'ny']);
  }
  bx(b, 12.97, 2.02, z0, XE - 0.02, 2.035, z1, w, ['py', 'ny', 'nx']);                                // 顶板
  // 框里塞满的保温棉：上下两块表面起伏的棉毡（中横框上下分开，颜色一深一浅）+ 几团从框里鼓出来的棉絮
  const zi = z1 - z0 - 0.09;
  b.mesh(gBatt(q3(zi), 0.77, 0), PROP, { x: 13.03, y: 0.715, z: zc, color: C.fiber3 });
  b.mesh(gBatt(q3(zi), 0.77, 1), PROP, { x: 13.03, y: 1.55, z: zc, color: C.fiber });
  for (let k = 0; k < 3; k++) b.mesh(gFluff(0.07 + k * 0.012, k), PROP, { x: 12.99, y: 0.6 + k * 0.52, z: z0 + 0.25 + k * 0.28, color: [C.fiber2, C.fiber, C.fiber2][k] });
}
// 表面起伏的一块棉毡：竖直面朝 −x（朝走廊），宽 w 沿 z、高 h，逐点沿 x 鼓出/凹进 ±3 cm
function gBatt(w, h, k) {
  return cached(`bt${w}|${h}|${k}`, () => {
    const g = new THREE.PlaneGeometry(w, h, 6, 7).rotateY(-Math.PI / 2), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, (hash3(pos.getX(i), pos.getY(i), pos.getZ(i), k + 5) - 0.5) * 0.06);
    g.computeVertexNormals();
    return g;
  });
}
// 垂下来的电线软管（参考图顶上那种金属软管）：从上面那根电线管下垂一个弧再挂回去
function flexLoop(b, z) {
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6, zz = z + t * 0.9, sag = Math.sin(t * Math.PI) * 0.34;
    pts.push([C2.x - 0.02 - Math.sin(t * Math.PI) * 0.05, C2.y - sag, zz]);
  }
  polyline(b, pts, 0.014, 0xa9aaa4, 6);
  for (const p of [pts[0], pts[6]]) bx(b, p[0] - 0.02, p[1] - 0.02, p[2] - 0.02, p[0] + 0.02, p[1] + 0.02, p[2] + 0.02, 0x8e908b);
}

// =====================================================================
// 西墙上的东西（在 b.push(XW, z, π/2) 里画：本地 +z = 伸进走廊的方向，本地 x = 世界 −z）
// =====================================================================
// 配电箱：柜体、门缝、把手、合页、警示三角、铭牌、底部百叶、顶上进线管
function elecPanel(b, zc) {
  b.push(XW, zc, Math.PI / 2);
  const W = 0.6, Hh = 0.8, D = 0.2, y0 = 1.05;
  part(b, 0, y0, D / 2, W, Hh, D, C.panel, ['px', 'nx', 'py', 'ny', 'pz']);
  const zf = D + 0.0015;
  part(b, 0, y0 + 0.02, zf, W - 0.04, 0.004, 0.003, C.seam);
  part(b, 0, y0 + Hh - 0.024, zf, W - 0.04, 0.004, 0.003, C.seam);
  part(b, -W / 2 + 0.022, y0 + 0.02, zf, 0.004, Hh - 0.04, 0.003, C.seam);
  part(b, W / 2 - 0.022, y0 + 0.02, zf, 0.004, Hh - 0.04, 0.003, C.seam);
  part(b, W / 2 - 0.07, y0 + 0.34, D + 0.012, 0.03, 0.13, 0.02, 0x2a2a28);                   // 把手
  for (const y of [y0 + 0.12, y0 + Hh - 0.2]) part(b, -W / 2 - 0.006, y, D - 0.03, 0.014, 0.08, 0.03, 0x5c5f59);   // 合页
  // 警示三角（黄底 + 黑色闪电）
  const ty = y0 + 0.52, tz = D + 0.003;
  b.quad([-0.08, ty, tz], [0.08, ty, tz], [0, ty + 0.14, tz], [0, ty + 0.14, tz], PROP, { color: 0xe0b21c, uv: 'stretch' });
  part(b, 0.004, ty + 0.03, tz + 0.001, 0.016, 0.06, 0.001, 0x151515, ['pz'], 0.35);
  part(b, -0.12, y0 + 0.2, tz, 0.16, 0.06, 0.002, 0xe6e3d8, ['pz']);                          // 铭牌
  for (let k = 0; k < 4; k++) part(b, 0.1, y0 + 0.08 + k * 0.03, tz, 0.16, 0.012, 0.004, 0x3f423d, ['pz', 'py']);   // 百叶
  cyl(b, 0.15, y0 + Hh, D / 2, 0.022, H - y0 - Hh, 'y', PROP, C.conduit, 8, true);
  cyl(b, -0.1, y0 + Hh, D / 2, 0.016, H - y0 - Hh, 'y', PROP, C.conduit, 6, true);
  for (const x of [0.15, -0.1]) cyl(b, x, y0 + Hh, D / 2, 0.03, 0.03, 'y', PROP, 0x8e908b, 8, false);
  b.pop();
  b.solid(XW, 1.05, zc - 0.3, XW + 0.2, 1.85, zc + 0.3);
}
// 通风口（低温区）：黑洞 + 一圈框 + 斜百叶
function wallVent(b, zc) {
  b.push(XW, zc, Math.PI / 2);
  const W = 0.7, Hh = 0.4, y0 = 2.1, c = 0x9aa3a8;
  b.plane(0, y0, 0.004, W, Hh, GLOW, { facing: '+z', uv: 'solid', color: 0.02 });
  part(b, 0, y0 - 0.03, 0.015, W + 0.06, 0.03, 0.03, c, ['pz', 'py', 'ny', 'px', 'nx']);
  part(b, 0, y0 + Hh, 0.015, W + 0.06, 0.03, 0.03, c, ['pz', 'py', 'ny', 'px', 'nx']);
  part(b, -W / 2 - 0.015, y0, 0.015, 0.03, Hh, 0.03, c, ['pz', 'px', 'nx']);
  part(b, W / 2 + 0.015, y0, 0.015, 0.03, Hh, 0.03, c, ['pz', 'px', 'nx']);
  for (let k = 0; k < 5; k++) part(b, 0, y0 + (k + 0.5) * Hh / 5 - 0.01, 0.014, W, 0.018, 0.022, c, ['pz', 'ny']);
  b.pop();
}
// 高温警示牌（黄三角）
function heatSign(b, zc) {
  b.push(XW, zc, Math.PI / 2);
  const y = 1.55, z = 0.006;
  part(b, 0, y - 0.02, 0.003, 0.34, 0.3, 0.006, 0xe6e3d8, ['pz', 'px', 'nx', 'py', 'ny']);
  b.quad([-0.13, y, z + 0.001], [0.13, y, z + 0.001], [0, y + 0.23, z + 0.001], [0, y + 0.23, z + 0.001], PROP, { color: 0xe0b21c, uv: 'stretch' });
  part(b, 0, y + 0.07, z + 0.002, 0.018, 0.09, 0.001, 0x151515, ['pz']);
  part(b, 0, y + 0.035, z + 0.002, 0.018, 0.018, 0.001, 0x151515, ['pz']);
  b.pop();
}
// 霓虹灯管：发光管 + 两个卡子 + 一端的小变压器盒（本地坐标系里沿本地 x 摆）
function neonTube(b, x, y, z, len, color) {
  part(b, x, y - 0.004, z - 0.004, len + 0.02, 0.012, 0.012, 0x1a1a1a, ['ny', 'pz']);   // 灯管背后的走线槽
  const pc = b.box(x, y + 0.002, z, len - 0.01, 0.024, 0.024, GLOW, { color, solid: false, uv: 'solid', faces: ['pz', 'py', 'ny'] });
  for (const s of [-0.35, 0.35]) part(b, x + s * len, y - 0.01, z + 0.002, 0.02, 0.045, 0.012, 0x3a3a3a, ['pz', 'px', 'nx']);
  part(b, x - len / 2 - 0.06, y - 0.04, z - 0.015, 0.1, 0.1, 0.04, 0x2c2c2c, ['pz', 'px', 'nx', 'py', 'ny']);
  return pc;
}

// =====================================================================
// 出口实物
// =====================================================================
// 西墙上的门洞（深 1.1 m 的凹室，门在最里面）：凹室让门的触发圈缩进墙里，贴着走廊走不会误触
function doorRecess(b, zc, to, label, doorOpts, style) {
  const D = 1.1, W = 1.5, HR = 2.4, x0 = XW - D;
  slab(b, x0, zc - W / 2, XW, zc + W / 2, HR);
  b.plane((x0 + XW) / 2, 0, zc - W / 2, D, HR, WALL, { facing: '+z' });
  b.plane((x0 + XW) / 2, 0, zc + W / 2, D, HR, WALL, { facing: '-z' });
  b.plane(x0, 0, zc, W, HR, WALL, { facing: '+x' });
  b.solid(x0 - 0.3, 0, zc - W / 2 - 0.3, XW, H, zc - W / 2);
  b.solid(x0 - 0.3, 0, zc + W / 2, XW, H, zc + W / 2 + 0.3);
  b.solid(x0 - 0.3, 0, zc - W / 2, x0, H, zc + W / 2);
  // 门洞包边（钢板护角）+ 门槛
  for (const s of [-1, 1]) bx(b, XW - 0.06, 0, zc + s * W / 2 - 0.004 - (s > 0 ? 0.03 : 0), XW + 0.012, HR, zc + s * W / 2 + (s > 0 ? 0.004 : 0.034), 0x7c7a70, ['px', s > 0 ? 'nz' : 'pz']);
  bx(b, XW - 0.06, HR - 0.012, zc - W / 2, XW + 0.012, HR + 0.03, zc + W / 2, 0x7c7a70, ['px', 'ny']);
  bx(b, x0 + 0.12, 0, zc - 0.55, x0 + 0.26, 0.018, zc + 0.55, 0x5d5b55, 'noBottom');
  kit.exit(b, { to, kind: 'door', x: x0 + 0.035, z: zc, rot: Math.PI / 2, style: style || 'fire', label, radius: 0.5, door: doorOpts });
  return { z0: zc - W / 2, z1: zc + W / 2, y0: 0, y1: HR };
}
// 会闪的墙：拆掉一段真墙，原位放一段不带碰撞体、会轻微错位偶尔闪没的墙（用本层墙材质才像"墙在闪"）；
// 闪没的一瞬间露出后面一片漆黑
function glitchWall(b, zc, to) {
  const W = 2.2, z0 = zc - W / 2, z1 = zc + W / 2, xb = XW - 0.6;
  b.plane(xb, 0, zc, W, H, GLOW, { facing: '+x', uv: 'solid', color: 0.01 });
  b.plane((xb + XW) / 2, 0, z0, 0.6, H, GLOW, { facing: '+z', uv: 'solid', color: 0.01 });
  b.plane((xb + XW) / 2, 0, z1, 0.6, H, GLOW, { facing: '-z', uv: 'solid', color: 0.01 });
  b.plane((xb + XW) / 2, 0.001, zc, 0.6, W, GLOW, { facing: 'up', uv: 'solid', color: 0.01 });
  b.plane((xb + XW) / 2, H - 0.001, zc, 0.6, W, GLOW, { facing: 'down', uv: 'solid', color: 0.01 });
  b.solid(xb - 0.4, 0, z0 - 0.4, xb, H, z1 + 0.4);
  b.solid(xb, 0, z0 - 0.4, XW, H, z0);
  b.solid(xb, 0, z1, XW, H, z1 + 0.4);
  kit.exit(b, { to, kind: 'noclip', x: XW - 0.1, z: zc, rot: Math.PI / 2, w: W - 0.02, h: H, matKey: WALL, radius: 0.75 });
  return { z0, z1, y0: 0, y1: H };
}
// 西侧岔口：从西墙往西挖一条 W 宽、D 深的短通道（死胡同），净高 hc
function branch(b, zc, D, W, hc, o) {
  o = o || {};
  const x0 = XW - D, z0 = zc - W / 2, z1 = zc + W / 2, wk = o.wallKey || WALL;
  if (o.floorKey) b.plane((x0 + XW) / 2, 0, zc, D, W, o.floorKey, { facing: 'up', color: o.floorC });
  else b.plane((x0 + XW) / 2, 0, zc, D, W, SLAB, { facing: 'up', color: o.floorC || C.floor });
  if (!o.noCeil) b.plane((x0 + XW) / 2, hc, zc, D, W, o.ceilKey || SLAB, { facing: 'down', color: o.ceilC || C.ceil });
  if (!o.noWalls) {
    b.plane((x0 + XW) / 2, 0, z0, D, hc, wk, { facing: '+z', color: o.wallC, uv: wk === PROP ? 'stretch' : 'world' });
    b.plane((x0 + XW) / 2, 0, z1, D, hc, wk, { facing: '-z', color: o.wallC, uv: wk === PROP ? 'stretch' : 'world' });
    b.plane(x0, 0, zc, W, hc, wk, { facing: '+x', color: o.wallC, uv: wk === PROP ? 'stretch' : 'world' });
  }
  b.solid(x0 - 0.4, 0, z0 - 0.4, XW, H, z0);
  b.solid(x0 - 0.4, 0, z1, XW, H, z1 + 0.4);
  b.solid(x0 - 0.4, 0, z0, x0, H, z1);
  // 洞口过梁的底边包一条钢角
  bx(b, XW - 0.05, hc - 0.012, z0, XW + 0.01, hc + 0.03, z1, 0x7c7a70, ['px', 'ny']);
  return { x0, z0, z1, hole: { z0, z1, y0: 0, y1: hc } };
}
function branchSpawns(b, br, zc, n, safe) { for (let k = 0; k < n; k++) b.spawn(XW - 0.8 - k * 1.1, zc, 'floor', safe ? { safe: true } : undefined); }

// 岔口尽头标 Φ 的金色门 → Level Phi（范围外，kit 自动 sealed）
function phiBranch(b, zc, st) {
  const br = branch(b, zc, 3.6, 2.0, 2.5);
  kit.exit(b, { to: 'Phi', kind: 'door', x: br.x0 + 0.035, z: zc, rot: Math.PI / 2, style: 'metal', label: '标有「Φ」的金色门',
    door: { color: 0xd4af37, frameColor: 0x8a6b1e } });
  // 门上方的铜牌：Φ
  b.push(br.x0 + 0.01, zc, Math.PI / 2);
  part(b, 0, 2.2, 0.01, 0.3, 0.2, 0.02, 0x8a6b1e, ['pz', 'px', 'nx', 'py', 'ny']);
  b.mesh(gTor(0.055, 0.009, 4, 12, TAU, '+x', '+y'), PROP, { x: 0, y: 2.3, z: 0.024, color: 0xe8c65a });
  part(b, 0, 2.225, 0.024, 0.012, 0.15, 0.01, 0xe8c65a);
  b.pop();
  st.lights.push(wallLamp(b, br.x0 + 1.6, br.z1, Math.PI, 2.3, 'on', 0));
  branchSpawns(b, br, zc, 1);
  return br.hole;
}
// 下水道岔口：尽头墙上一个大的水泥管口，地上一个掀开井盖的洞 → Level 34（sealed）
function sewerBranch(b, zc, st) {
  const br = branch(b, zc, 5.5, 2.2, 2.5, { floorC: [0.72, 0.72, 0.64], wallC: [0.86, 0.86, 0.78] });
  const x0 = br.x0;
  cyl(b, x0 + 0.15, 1.05, zc, 0.62, 0.3, 'x', SLAB, [0.62, 0.6, 0.55], 16, false);
  b.mesh(gCyl(0.5, 0.002, 16, 'x', false), GLOW, { x: x0 + 0.302, y: 1.05, z: zc, color: 0.01, uv: 'solid' });
  kit.prop.puddle(b, x0 + 0.8, zc - 0.3, 0, { rx: 0.9, rz: 0.55, color: [0.16, 0.19, 0.14] });
  kit.prop.puddle(b, x0 + 3.2, zc + 0.5, 0, { rx: 0.5, rz: 0.35, color: [0.16, 0.19, 0.14] });
  kit.exit(b, { to: '34', kind: 'hole', x: x0 + 1.9, z: zc, radius: 0.85, label: '下水道隧道', hole: { r: 0.85, irregular: true, rimColor: 0x3a3f30 } });
  // 掀到一边的铸铁井盖
  cyl(b, x0 + 3.4, 0, zc - 0.55, 0.34, 0.035, 'y', PROP, 0x3b3a36, 16, false);
  for (let k = -1; k <= 1; k++) bx(b, x0 + 3.4 - 0.26, 0.035, zc - 0.55 + k * 0.1 - 0.012, x0 + 3.4 + 0.26, 0.045, zc - 0.55 + k * 0.1 + 0.012, 0x2e2d2a, 'noBottom');
  // 侧墙上一截滴水的铸铁管口 + 下面一道绿色水痕
  cyl(b, x0 + 2.6, 1.8, br.z1 - 0.1, 0.045, 0.2, 'z', PROP, 0x4a3a2c, 8, false);
  b.plane(x0 + 2.6, 0.02, br.z1 - 0.004, 0.09, 1.72, 'kit:water', { facing: '-z', color: [0.18, 0.26, 0.14] });
  st.lights.push(wallLamp(b, x0 + 3.6, br.z0, 0, 2.3, 'flicker', 0.55));
  branchSpawns(b, br, zc, 1);
  return br.hole;
}
// 霓虹灯岔口：越往里霓虹灯管越密，尽头地上一个发光圈 → Level 699（sealed）
function neonBranch(b, zc, st) {
  const D = 6.0, br = branch(b, zc, D, 2.2, 2.5, { wallC: [0.8, 0.78, 0.74] });
  const cols = [[2.2, 0.35, 1.7], [0.35, 1.9, 2.2], [2.2, 1.9, 0.4]];
  const N = 9;
  for (let k = 0; k < N; k++) {
    const t = 1 - Math.pow(1 - (k + 0.5) / N, 1.8);        // 越往里越密
    const x = XW - 0.6 - t * (D - 1.2), side = k % 2, y = 0.9 + ((k * 0.61) % 1) * 1.3;
    b.push(x, side ? br.z1 : br.z0, side ? Math.PI : 0);
    neonTube(b, 0, y, 0.03, 0.75, cols[k % 3]);
    b.pop();
  }
  // 尽头墙上一个折线霓虹招牌
  b.push(br.x0, zc, Math.PI / 2);
  for (let k = 0; k < 4; k++) b.box(-0.45 + k * 0.3, 1.5 + (k % 2) * 0.25, 0.04, 0.34, 0.03, 0.03, GLOW, { color: cols[0], solid: false, uv: 'solid', rotY: 0 });
  part(b, 0, 1.4, 0.015, 1.2, 0.5, 0.02, 0x1c1c1c, ['pz', 'px', 'nx', 'py', 'ny']);
  b.pop();
  st.lights.push(b.light({ x: br.x0 + 1.2, y: 2.0, z: zc, color: 0xff5ac8, intensity: 0.9, range: 6 }));
  kit.exit(b, { to: '699', kind: 'zone', x: br.x0 + 1.0, z: zc, radius: 1.0, marker: { color: [2.2, 0.35, 1.7], pulse: true }, label: '越来越密集的霓虹灯' });
  // 主走廊西墙上洞口两边先冒出两根霓虹灯（"霓虹灯逐渐增多"）
  for (const [dz, c] of [[-1.7, cols[0]], [1.8, cols[1]]]) {
    b.push(XW, zc + dz, Math.PI / 2);
    neonTube(b, 0, 2.05, 0.03, 0.6, c);
    b.pop();
  }
  branchSpawns(b, br, zc, 3);
  return br.hole;
}
// 临时掩体：炸开的粗糙洞壁、碎石、几个箱子和一张铺盖（依据 bases：从未确认遇到其他团队 → 空置无 NPC）
// 一块不规则的石头（低多边形球逐点凹凸）：半截埋进洞壁 = 炸开的岩面上鼓出来的石头；小号的撒在地上当碎石
function gRock(r, k, wS, hS) {
  return cached(`rk${r}|${k}|${wS}|${hS}`, () => {
    const g = new THREE.SphereGeometry(r, wS, hS), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), m = 0.72 + 0.5 * hash3(x, y, z, k + 11); pos.setXYZ(i, x * m, y * m * 0.8, z * m); }
    g.computeVertexNormals();
    return g;
  });
}
function shelterBranch(b, zc, st, rng) {
  const D = 4.2, br = branch(b, zc, D, 2.4, 2.5, { wallC: [0.72, 0.68, 0.6], ceilC: [0.8, 0.76, 0.66] });
  const rocks = [[0.5, 0.48, 0.44], [0.58, 0.55, 0.5], [0.44, 0.42, 0.39]];
  // 洞壁上鼓出来的石头：球心压在墙面上（一半埋在墙里）；9 次抽样只摆 6 块，rng 消耗次数不变
  for (let k = 0; k < 9; k++) {
    const side = k % 3, s = 0.3 + rng() * 0.45, t = rng(), rot = rng() * TAU, y = rng() * 1.6;
    if (k >= 6) continue;
    const x = side === 2 ? br.x0 : XW - 0.4 - t * (D - 0.8);
    const z = side === 0 ? br.z0 : side === 1 ? br.z1 : zc + (t - 0.5) * 2;
    const r = s < 0.45 ? 0.2 : s < 0.6 ? 0.26 : 0.32;
    b.mesh(gRock(r, Math.floor(rot) % 4, 5, 4), SLAB, { x, y: 0.15 + y * 1.2, z, color: rocks[k % 3], uv: 'stretch' });
  }
  // 地上的碎石
  for (let k = 0; k < 6; k++) {
    const x = XW - 0.5 - rng() * (D - 0.8), z = zc + (rng() - 0.5) * 2, a = rng(), c = rng(), d = rng(), rot = rng();
    b.mesh(gRock(a < 0.5 ? 0.05 : 0.08, Math.floor(rot * 4), 4, 3), SLAB, { x, y: 0.02 + c * 0.02, z, color: rocks[(k + (d * 3 | 0)) % 3], uv: 'stretch' });
  }
  kit.prop.crate(b, br.x0 + 0.6, br.z0 + 0.55, 0.2, { size: 0.7, color: 0x6e5838 });
  kit.prop.box(b, br.x0 + 0.55, br.z1 - 0.45, 0.4, { stack: 2, color: 0x9a7e56 });
  bx(b, br.x0 + 1.4, 0, zc - 0.35, br.x0 + 3.2, 0.06, zc + 0.35, 0x3b4a36, 'noBottom');             // 铺盖
  bx(b, br.x0 + 1.4, 0.06, zc - 0.3, br.x0 + 1.75, 0.14, zc + 0.3, 0x55604e, 'noBottom');           // 枕头卷
  // 小油桶：桶身 + 上下两道加强箍 + 桶盖和注油口
  cyl(b, br.x0 + 0.4, 0, zc, 0.13, 0.32, 'y', PROP, 0x9c2a1e, 10, false);
  for (const y of [0.06, 0.24]) cyl(b, br.x0 + 0.4, y, zc, 0.134, 0.018, 'y', PROP, 0x7e2016, 10, true);
  cyl(b, br.x0 + 0.44, 0.322, zc + 0.04, 0.025, 0.02, 'y', PROP, 0x8a8c86, 6, false);   // 注油口（离桶盖 2 mm，不共面）
  cyl(b, br.x0 + 1.1, 0, br.z1 - 0.35, 0.06, 0.16, 'y', PROP, 0x3a3a34, 8, false);                  // 熄灭的马灯
  b.mesh(gSphere(0.04, 6, 4), GLOW, { x: br.x0 + 1.1, y: 0.2, z: br.z1 - 0.35, color: 0.15, uv: 'solid' });
  b.solid(br.x0 + 0.25, 0, br.z0, br.x0 + 0.95, 0.7, br.z0 + 0.95);
  b.solid(br.x0 + 0.25, 0, br.z1 - 0.8, br.x0 + 0.85, 0.76, br.z1);
  st.lights.push(wallLamp(b, XW - 1.4, br.z1, Math.PI, 2.3, 'on', 0));
  branchSpawns(b, br, zc, 3);
  return br.hole;
}
// Biological Pipeline 入口：一段八角截面的活体管道，肉色内壁 + 一道道筋 + 尽头一团收紧的暗红孔口；
// 站在里面不动会被消化（level.update 用 b.data.pipeline 判定）
function pipelineBranch(b, zc, st) {
  const D = 6.0, R = 1.3, cy = 1.2, x0 = XW - D;
  const V = [];
  for (let k = 0; k < 8; k++) { const a = (22.5 + 45 * k) * Math.PI / 180; V.push([Math.cos(a) * R, cy + Math.sin(a) * R]); }
  const ring = (xa, xb, scale, color) => {
    for (let k = 0; k < 8; k++) {
      const A = V[k], B = V[(k + 1) % 8];
      const za = zc + A[0] * scale, ya = cy + (A[1] - cy) * scale, zb = zc + B[0] * scale, yb = cy + (B[1] - cy) * scale;
      b.quad([xb, ya, za], [xa, ya, za], [xa, yb, zb], [xb, yb, zb], PROP, { color: typeof color === 'function' ? color(k) : color, uv: 'stretch' });
    }
  };
  ring(x0, XW, 1, k => [0x7a4a42, 0x84504a, 0x70423c, 0x7e4c44][k % 4]);
  for (let x = XW - 0.5; x > x0 + 0.3; x -= 0.75) ring(x - 0.06, x + 0.06, 0.975, C.fleshDark);
  b.plane(x0 + 0.002, -0.1, zc, 2.8, 2.7, PROP, { facing: '+x', color: 0x5a302c, uv: 'stretch' });
  b.plane(x0 + 0.006, 0.8, zc, 0.8, 0.8, GLOW, { facing: '+x', uv: 'solid', color: [0.12, 0.01, 0.01] });
  kit.prop.puddle(b, x0 + 2.5, zc, 0, { rx: 1.4, rz: 0.4, color: [0.32, 0.26, 0.12] });   // 管内积存的消化残余
  // 西墙洞口是矩形，四个角用墙面三角补上，洞口就是八角形
  const [A0, A1] = [V[0], V[1]];
  for (const s of [-1, 1]) {
    triX(b, XW, [zc + s * A1[0], A1[1]], [zc + s * A0[0], A1[1]], [zc + s * A0[0], A0[1]], WALL, undefined, '+x');
    triX(b, XW, [zc + s * A1[0], 0], [zc + s * A0[0], 0], [zc + s * A0[0], 2 * cy - A0[1]], WALL, undefined, '+x');
  }
  b.solid(x0 - 0.4, 0, zc - R - 0.4, XW, H, zc - 0.85);
  b.solid(x0 - 0.4, 0, zc + 0.85, XW, H, zc + R + 0.4);
  b.solid(x0 - 0.4, 0, zc - 0.85, x0, H, zc + 0.85);
  b.data.pipeline = { x0: b.ox + x0, x1: b.ox + XW - 0.2, z0: b.oz + zc - 1.2, z1: b.oz + zc + 1.2 };
  st.lights.push(b.light({ x: x0 + 3, y: 2.1, z: zc, color: 0xff8a6a, intensity: 0.55, range: 5 }));
  branchSpawns(b, { x0 }, zc, 4, true);
  return { z0: zc + V[3][0], z1: zc + V[0][0], y0: 0, y1: V[1][1] };
}
// 木制阁楼的空房间：木板墙、木地板、几根椽子，尽头一扇亮得发白的窗（landmarks：似乎能望见 the Whole）
function atticBranch(b, zc, st) {
  const D = 4.6, W = 2.4, hc = 2.35;
  const br = branch(b, zc, D, W, hc, { wallKey: PROP, wallC: 0x6b4a2c, floorKey: PROP, floorC: 0x5a3e24, ceilKey: PROP, ceilC: 0x4e3620 });
  // 木板缝
  for (let x = XW - 0.3; x > br.x0 + 0.1; x -= 0.3) {
    b.plane(x, 0, br.z0 + 0.002, 0.012, hc, PROP, { facing: '+z', color: 0x3a2716, uv: 'stretch' });
    b.plane(x, 0, br.z1 - 0.002, 0.012, hc, PROP, { facing: '-z', color: 0x3a2716, uv: 'stretch' });
    b.plane(x, 0.002, zc, 0.012, W, PROP, { facing: 'up', color: 0x3a2716, uv: 'stretch' });
  }
  for (let x = XW - 0.5; x > br.x0; x -= 0.9) bx(b, x - 0.05, hc - 0.14, br.z0, x + 0.05, hc, br.z1, 0x5a3c22, ['ny', 'px', 'nx']);
  kit.prop.window(b, br.x0 + 0.02, zc, Math.PI / 2, { w: 1.1, h: 1.0, y: 1.0, glow: [1.0, 1.08, 1.18], frameColor: 0x7a5a38, solid: false });
  b.data.hasAtticWindow = true;
  st.lights.push(b.light({ x: br.x0 + 0.8, y: 1.5, z: zc, color: 0xdfefff, intensity: 0.8, range: 5 }));
  branchSpawns(b, br, zc, 3);
  return br.hole;
}

// =====================================================================
// 危害
// =====================================================================
// 窗户（entity-index 把它归为危害）：西墙上一扇窗，窗后是一块被掏空的漆黑空间和一个更立体的影子人形
function hazardWindow(b, zc) {
  const W = 1.0, y0 = 0.85, y1 = 2.05, D = 0.55, xb = XW - D;
  b.plane(xb, y0, zc, W, y1 - y0, GLOW, { facing: '+x', uv: 'solid', color: 0.012 });
  b.plane((xb + XW) / 2, y0, zc - W / 2, D, y1 - y0, PROP, { facing: '+z', color: 0x1a1916, uv: 'stretch' });
  b.plane((xb + XW) / 2, y0, zc + W / 2, D, y1 - y0, PROP, { facing: '-z', color: 0x1a1916, uv: 'stretch' });
  b.plane((xb + XW) / 2, y0, zc, D, W, PROP, { facing: 'up', color: 0x22211d, uv: 'stretch' });
  b.plane((xb + XW) / 2, y1, zc, D, W, PROP, { facing: 'down', color: 0x141412, uv: 'stretch' });
  // 影子人形：躯干 + 头 + 一条伸长的扭曲手臂
  bx(b, XW - 0.4, y0, zc - 0.18, XW - 0.3, y0 + 0.95, zc + 0.14, 0x05070a);
  b.mesh(gSphere(0.1, 6, 5), PROP, { x: XW - 0.35, y: y0 + 1.05, z: zc - 0.02, color: 0x05070a });
  stick(b, [XW - 0.34, y0 + 0.8, zc + 0.12], [XW - 0.12, y0 + 0.55, zc + 0.38], 0.03, 0x05070a, 5);
  // 窗框 + 窗台 + 玻璃上两道反光
  const fc = 0xcfc8b4;
  bx(b, XW - 0.05, y0 - 0.06, zc - W / 2 - 0.06, XW + 0.035, y0, zc + W / 2 + 0.06, fc, ['px', 'py', 'pz', 'nz']);
  bx(b, XW - 0.05, y1, zc - W / 2 - 0.06, XW + 0.03, y1 + 0.06, zc + W / 2 + 0.06, fc, ['px', 'ny', 'pz', 'nz']);
  for (const s of [-1, 1]) bx(b, XW - 0.05, y0, zc + s * (W / 2 + 0.03) - 0.03, XW + 0.03, y1, zc + s * (W / 2 + 0.03) + 0.03, fc, ['px', s > 0 ? 'nz' : 'pz']);
  const xg = XW - 0.02;
  b.quad([xg, y0 + 0.5, zc + 0.3], [xg, y0 + 0.9, zc + 0.05], [xg, y0 + 0.93, zc + 0.08], [xg, y0 + 0.53, zc + 0.33], PROP, { color: 0x7e8a8c, uv: 'stretch' });
  b.quad([xg, y0 + 0.4, zc + 0.36], [xg, y0 + 0.62, zc + 0.22], [xg, y0 + 0.64, zc + 0.24], [xg, y0 + 0.42, zc + 0.38], PROP, { color: 0x5e686a, uv: 'stretch' });
  return { z0: zc - W / 2, z1: zc + W / 2, y0, y1, solid: true };
}
// 仍带电的废弃电线：桥架断开一截，几根电缆垂下来，末端铜芯裸露、时不时打火；地上一片烧焦的黑印
function liveWires(b, z) {
  const ends = [];
  for (let k = 0; k < 3; k++) {
    const x0 = 12.62 + k * 0.12, z0 = z - 0.35 + k * 0.12, ex = 12.5 - k * 0.04, ey = 1.05 + k * 0.18, ez = z + 0.05 * k;
    polyline(b, [[x0, TRAY.y + 0.02, z0], [x0 - 0.05, 1.9, z0 + 0.08], [ex + 0.03, ey + 0.35, ez - 0.05], [ex, ey, ez]], 0.016, C.cable[k], 5);
    for (let j = 0; j < 3; j++) stick(b, [ex, ey, ez], [ex + (j - 1) * 0.02, ey - 0.06, ez + (j - 1) * 0.015], 0.003, 0xc87533, 3);
    ends.push([ex, ey - 0.06, ez]);
  }
  const spark = b.box(ends[0][0], ends[0][1] - 0.03, ends[0][2], 0.05, 0.05, 0.05, GLOW, { color: [2.2, 1.6, 0.6], solid: false, uv: 'solid' });
  kit.prop.puddle(b, 12.45, z, 0, { rx: 0.35, rz: 0.3, color: [0.04, 0.035, 0.03] });
  // 桥架断口：挂下来半截的横档
  part(b, 12.86, TRAY.y - 0.2, z - 0.5, 0.56, 0.012, 0.024, C.strutDark, 'all', 0.4);
  return { spark, x: ends[0][0], z: ends[0][2] };
}

// =====================================================================
// 横通道（每 3 个区块一条，东西向，连起相邻的平行走廊）
// =====================================================================
function buildCross(b, st, rng) {
  slab(b, 0, ZC0, XW, ZC1);
  slab(b, XE, ZC0, SIZE, ZC1);
  wallX(b, ZC0, '+z', 0, XW); wallX(b, ZC0, '+z', XE, SIZE);
  wallX(b, ZC1, '-z', 0, XW); wallX(b, ZC1, '-z', XE, SIZE);
  // 北墙上两根无保温的钢管 + 一根电线管：西段走到路口前拐进墙里，东段从墙里拐出来
  const Q = [{ y: 2.45, r: 0.075, R: 0.13, c: 0x4f5b4a, xw: 10.35, xe: 14.25 }, { y: 2.22, r: 0.05, R: 0.1, c: 0x7a4a30, xw: 10.2, xe: 14.4 }];
  for (const q of Q) {
    const zq = ZC0 + q.R;
    cyl(b, (q.xw - q.R) / 2, q.y, zq, q.r, q.xw - q.R, 'x', PROP, q.c, 10, true);
    elbow(b, q.xw - q.R, q.y, ZC0, q.R, q.r, '+x', '+z', PROP, q.c, 8, 4);
    cyl(b, q.xe + q.R + (SIZE - q.xe - q.R) / 2, q.y, zq, q.r, SIZE - q.xe - q.R, 'x', PROP, q.c, 10, true);
    elbow(b, q.xe + q.R, q.y, ZC0, q.R, q.r, '-x', '+z', PROP, q.c, 8, 4);
    for (const xs of [q.xw, q.xe]) cyl(b, xs, q.y, ZC0 + 0.02, q.r + 0.025, 0.04, 'z', PROP, 0x8e8a80, 8, true);   // 穿墙套管
    for (let x = 1.5; x < SIZE; x += 6) if (x < 9.6 || x > 15) cyl(b, x, q.y, zq, q.r + 0.008, 0.05, 'x', PROP, 0x3c3f3a, 8, true);
  }
  cyl(b, XW / 2 - 0.1, 2.64, ZC0 + 0.03, 0.014, XW - 0.2, 'x', PROP, C.conduit, 6, true);
  cyl(b, XE + (SIZE - XE) / 2 + 0.1, 2.64, ZC0 + 0.03, 0.014, SIZE - XE - 0.2, 'x', PROP, C.conduit, 6, true);
  // 墙上的 L 形托架
  for (let x = 1; x < SIZE; x += 3) {
    if (x > 9.8 && x < 14.6) continue;
    bx(b, x - 0.03, 2.1, ZC0, x + 0.03, 2.4, ZC0 + 0.01, C.strutDark, ['pz', 'px', 'nx', 'py', 'ny']);
    bx(b, x - 0.018, 2.13, ZC0 + 0.01, x + 0.018, 2.168, ZC0 + 0.17, C.strut, ['px', 'nx', 'py', 'ny', 'pz']);
    bx(b, x - 0.018, 2.335, ZC0 + 0.01, x + 0.018, 2.373, ZC0 + 0.22, C.strut, ['px', 'nx', 'py', 'ny', 'pz']);
  }
  // 南墙上的壁灯
  for (const x of [4, 20]) st.lights.push(wallLamp(b, x, ZC1, Math.PI, 2.5, st.lampState(), 0.5, st.lampColor));
  // 地上一两滩水、一些碎屑
  const px = rng() < 0.5 ? 3 + rng() * 5 : 16 + rng() * 5;
  kit.prop.puddle(b, px, 12 + (rng() - 0.5) * 1.2, 0, { rx: 0.6 + rng() * 0.5, rz: 0.4, color: [0.17, 0.16, 0.14] });
  for (let x = 0.6; x < SIZE; x += 1.2) if (x < 10.3 || x > 14.3) b.spawn(x + (rng() - 0.5) * 0.2, 12 + (rng() - 0.5) * 0.8, 'floor', st.safe ? { safe: true } : undefined);
}

// =====================================================================
// 区块
// =====================================================================
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const cross = mod(cz, 3) === 1;
  const F = isSpawn ? {} : FEAT[mod(cz + 3 * cx, 8)];

  // ---- 1. 区块级随机数一次性按固定顺序抽完（第 4.2 节）----
  const rKind = U.weighted(rng, VARIANTS);
  const jA = rng(), jB = rng();
  const rWin = rng(), rWinSite = rng(), rWinPhase = rng();
  const rWire = rng(), rWireK = rng(), rWirePhase = rng();
  const rPanel = rng(), rPanelSite = rng();
  const rFrame = rng(), rFrameK = rng(), rValve = rng(), rValveK = rng(), rFlex = rng(), rFlexK = rng();
  const rDrain = rng(), rDrainZ = rng();
  const rTearN = rng(), rTear = [[rng(), rng(), rng()], [rng(), rng(), rng()]];
  const lampR = LAMPS.map(() => rng()), lampF = LAMPS.map(() => rng()), crossLampR = [rng(), rng()];
  const jboxR = SUP.map(() => rng());
  const rRack = rng(), rRackK = rng();

  let kind = isSpawn ? 'plain' : rKind;
  const zA = 5 + (jA - 0.5) * 1.6, zB = 19 + (jB - 0.5) * 1.6;
  let branchZone = null;
  if (BRANCH_KINDS.has(kind)) {
    // 横通道区块不再挖岔口（路口、弯管、两盏壁灯已经把这块的三角面用到 7000 上下，再加一个掩体/活体管道就超每块 8000 的上限）
    branchZone = cross ? null : !F.A ? 'A' : !F.B ? 'B' : null;
    if (!branchZone) kind = 'plain';
  }
  b.data.variant = kind;   // 区块变体名：自测脚本按它找各种变体（level.update 只读 kind / pipeline）
  const lampColor = kind === 'hot' ? LAMP_HOT : LAMP_COLOR;
  let lampIdx = 0;
  const st = {
    kind, cross, lights: [], safe: kind === 'hot', lampColor,
    lampState() { const r = crossLampR[(lampIdx++) % 2]; return r < 0.06 ? 'broken' : r < 0.16 ? 'flicker' : 'on'; },
    tears: [],
  };

  // ---- 2. 西墙上的出口、岔口、窗户、配电箱 ----
  const westHoles = [];
  if (cross) westHoles.push({ z0: ZC0, z1: ZC1, y0: 0, y1: H });
  const placeFeat = (f, zc) => {
    if (f === 'fire1') westHoles.push(doorRecess(b, zc, '1', '消防出口', { sign: true }));          // exits「消防出口 → Level 1」
    else if (f === 'fire3') westHoles.push(doorRecess(b, zc, '3', '消防出口', { sign: true }));     // exits「消防出口 → Level 3」
    else if (f === 'fire477') westHoles.push(doorRecess(b, zc, '477', '消防出口', { sign: true })); // exits「消防出口 → Level 477」（sealed）
    else if (f === 'glitch4') westHoles.push(glitchWall(b, zc, '4'));                              // exits「某些走廊有概率通往 Level 4」
    else if (f === 'glitch27') westHoles.push(glitchWall(b, zc, '27'));                            // 同一机制 → Level 27（sealed）
    else if (f === 'phi') westHoles.push(phiBranch(b, zc, st));                                    // exits「标有 Φ 的金色门 → Level Phi」（sealed）
    else if (f === 'sewer') westHoles.push(sewerBranch(b, zc, st));                                // exits「遇到下水道隧道 → Level 34」（sealed）
    else if (f === 'neon') westHoles.push(neonBranch(b, zc, st));                                  // exits「霓虹灯逐渐增多 → Level 699」（sealed）
  };
  if (F.A) placeFeat(F.A, zA);
  if (F.B) placeFeat(F.B, zB);
  if (branchZone) {
    const zc = branchZone === 'A' ? zA : zB;
    b.data.branchZ = zc;   // 自测脚本按它找岔口（level.update 不读）
    if (kind === 'shelter') westHoles.push(shelterBranch(b, zc, st, rng));
    else if (kind === 'pipeline') westHoles.push(pipelineBranch(b, zc, st));
    else if (kind === 'attic') westHoles.push(atticBranch(b, zc, st));
  }
  // 窗户危害：依据 entities[Windows].behavior「本层变种：玻璃后面像层级里被掏空的一块，影子人形更立体，扭曲手臂能伸得更远」，
  // 密度原文未给数值，取低概率
  const windows = [];
  let winSite = null;
  if (!isSpawn && rWin < 0.07) {
    winSite = rWinSite < 0.5 ? M1 : M2;
    westHoles.push(hazardWindow(b, winSite));
    const wp = b.world(XW - 0.3, winSite);
    windows.push({ x: wp.x, z: wp.z, phase: rWinPhase * TAU, hit: false });
  }
  if (isSpawn || rPanel < 0.3) {
    const site = isSpawn ? M1 : (winSite === M1 ? M2 : winSite === M2 ? M1 : (rPanelSite < 0.5 ? M1 : M2));
    elecPanel(b, site);
  }
  if (kind === 'hot') heatSign(b, winSite === M2 ? M1 : M2);
  if (kind === 'cold') for (const z of [3, 9.3, 16.2, 21.5]) if (!westHoles.some(h => z > h.z0 - 0.5 && z < h.z1 + 0.5)) wallVent(b, z);

  // ---- 3. 主走廊：墙、地面、顶板、梁 ----
  slab(b, XW, 0, XE, SIZE);
  wallZ(b, XW, '+x', 0, SIZE, westHoles);
  wallZ(b, XE, '-x', 0, SIZE, cross ? [{ z0: ZC0, z1: ZC1, y0: 0, y1: H }] : []);
  for (const zb of BEAMS) {
    if (kind === 'wood') bx(b, XW, H - 0.2, zb - 0.09, XE, H, zb + 0.09, C.woodDark, 'noTop');
    else b.aabb(XW, H - 0.24, zb - 0.15, XE, H, zb + 0.15, SLAB, { color: C.ceil, solid: false, faces: cross && zb === 12 ? 'noTop' : ['ny', 'pz', 'nz'] });
  }
  // 管架碰撞体（整排管子当一堵矮墙）
  if (!cross) b.solid(XF, 0, 0, XE, H, SIZE);
  else { b.solid(XF, 0, 0, XE, H, 10.45); b.solid(XF, 0, 13.55, XE, H, SIZE); }

  // ---- 4. 管架 ----
  const sup = SUP.filter(z => !cross || z < 9 || z > 15);
  // 破口：1–2 处，落在两个支架正中间（z = 3k），和木框、阀门错开
  const cand = [3, 6, 9, 12, 15, 18, 21].filter(z => !cross || z < 8 || z > 16);
  const pickCand = r => { if (!cand.length) return null; const i = Math.floor(r * cand.length); return cand.splice(i, 1)[0]; };
  const zFrame = !cross && rFrame < 0.45 ? pickCand(rFrameK) : null;   // 横通道区块东西已经够多，不再放木框
  const nTear = rTearN < 0.5 || cross ? 1 : 2;   // 横通道区块最多一处（同上，三角面预算）
  for (let k = 0; k < nTear; k++) { const z = pickCand(rTear[k][0]); if (z != null) st.tears.push({ z, p: rTear[k][1] < 0.6 ? 2 : 1, h: rTear[k][2] }); }
  for (const z of sup) support(b, z, st);
  for (const z of MID) midHanger(b, z, cross && z > 8 && z < 16);
  cableTray(b);
  bigPipes(b, st);
  smallPipes(b, cross);
  if (zFrame != null) woodFrame(b, zFrame);
  b.data.tears = st.tears.map(t => [t.p, t.z]);   // 自测脚本按它找保温层破口、木框（level.update 不读）
  b.data.frame = zFrame;
  // 管架上的配电箱：非横通道区块 30% 挂一只（挂在它的那根立柱上就不再放接线盒）
  const rackAt = !cross && rRack < 0.3 ? Math.floor(rRackK * sup.length) : -1;
  if (rackAt >= 0) { rackPanel(b, sup[rackAt]); b.data.rackZ = sup[rackAt]; }
  sup.forEach((z, i) => {
    const forced = cross && (z === 7.5 || z === 16.5);     // 路口两边电线管断开的地方必须接进接线盒
    if (i !== rackAt && (forced || jboxR[i] < 0.35)) junctionBox(b, z, !forced && jboxR[i] < 0.15);
  });
  // 横通道区块的东西已经够多（多出路口的弯管、两盏壁灯），不再放阀门组，免得顶到每块 8000 面
  if (!cross && rValve < 0.55) valveStation(b, sup[Math.floor(rValveK * sup.length)] + 0.35);
  if (rFlex < 0.5) flexLoop(b, sup[Math.floor(rFlexK * sup.length)] + 0.3);

  // 高温区：接缝处烧得发红，一股股蒸汽从铝皮缝里往外喷（半透明锥体轮流显隐）
  if (kind === 'hot') {
    const puffs = [];
    for (const zp of [2.25, 11.25, 20.25]) {
      if (cross && zp > 8.5 && zp < 15.5) continue;
      cyl(b, P2.x, P2.y, zp, P2.r + 0.012, 0.035, 'z', GLOW, [1.6, 0.42, 0.12], 12, true);
      for (let k = 0; k < 3; k++) {
        const pc = b.mesh(gCone(0.03 + k * 0.01, 0.16 + k * 0.05, 0.45 + k * 0.1, 7), 'kit:water', { x: P2.x - 0.2 - k * 0.04, y: P2.y + 0.18, z: zp + (k - 1) * 0.04, color: [0.85, 0.84, 0.8] });
        puffs.push({ pc, k, ph: zp });
      }
    }
    b.update((dt, t) => {
      for (const p of puffs) {
        const on = Math.floor(t * 3 + p.ph) % 3 === p.k;
        if (p.pc.visible !== on) p.pc.setVisible(on);
      }
    });
    b.data.kind = 'hot';   // level.update 用它判定高温灼烧
  }
  // 低温区：管子底下挂冰锥
  if (kind === 'cold') {
    for (let k = 0; k < 8; k++) {
      const P = k % 2 ? P1 : P2, z = 1.2 + k * 2.8;
      if (cross && z > 8.5 && z < 15.5) continue;
      b.mesh(gCone(0, 0.02, 0.1 + (k % 3) * 0.04, 6, true), PROP, { x: P.x - 0.05, y: P.y - P.r, z, color: 0xdfeaf0 });
    }
  }
  // 老木结构区：旧木箱堆在路边
  if (kind === 'wood') kit.prop.crate(b, 11.25, cross ? 3 : 15.5, 0.15, { size: 0.65, color: 0x7a5a36 });

  // ---- 5. 灯：4 m 一盏吊灯 ----
  LAMPS.forEach((z, i) => {
    if (cross && (z === 10 || z === 14)) { if (z === 14) return; z = 12; }   // 路口两侧的两盏并成一盏，挂在十字路口正中
    const r = lampR[i];
    const state = isSpawn ? 'on' : r < 0.05 ? 'broken' : r < 0.14 ? 'flicker' : 'on';   // 依据 lighting 无具体描述 → 大多正常，少量闪/坏
    st.lights.push(pendant(b, LAMP_X, z, state, 0.35 + lampF[i] * 0.55, lampColor));
  });

  // ---- 6. 危害：带电电线 ----
  // 依据 hazards「爬行空间中仍带电的电线，常导致重伤」、landmarks「有时被大量仍带电的废弃电线堵塞」
  const wires = [];
  if (!isSpawn && rWire < 0.12) {
    const zs = [3, 6, 18, 21].concat(cross ? [] : [9, 15]);
    const w = liveWires(b, zs[Math.floor(rWireK * zs.length)]);
    const wp = b.world(w.x, w.z);
    wires.push({ x: wp.x, z: wp.z, phase: rWirePhase * 10, hit: false, spark: w.spark });
  }

  // ---- 7. 地面：排水口、水渍、碎屑 ----
  if (rDrain < 0.35) {
    const zd = 2 + rDrainZ * 20, xd = 12.62;
    if (!cross || zd < 9 || zd > 15) {
      b.plane(xd, 0.002, zd, 0.26, 0.26, GLOW, { facing: 'up', uv: 'solid', color: 0.03 });
      bx(b, xd - 0.16, 0, zd - 0.16, xd + 0.16, 0.01, zd - 0.13, 0x4d4b45, 'noBottom');
      bx(b, xd - 0.16, 0, zd + 0.13, xd + 0.16, 0.01, zd + 0.16, 0x4d4b45, 'noBottom');
      for (let k = 0; k < 6; k++) bx(b, xd - 0.13 + k * 0.052, 0.003, zd - 0.13, xd - 0.118 + k * 0.052, 0.011, zd + 0.13, 0x3c3a36, 'noBottom');
      kit.prop.puddle(b, xd - 0.35, zd + 0.3, 0, { rx: 0.55, rz: 0.4, color: [0.17, 0.16, 0.14] });
    }
  }
  const nPud = rng() < 0.45 ? 2 : 1;
  for (let k = 0; k < nPud; k++) {
    const z = 1 + rng() * 22, x = 12.1 + rng() * 0.6, rx = 0.4 + rng() * 0.6, rz = 0.3 + rng() * 0.4;
    kit.prop.puddle(b, x, z, 0, { rx, rz, color: kind === 'cold' ? [0.72, 0.8, 0.85] : [0.17, 0.16, 0.14] });
  }
  for (let k = 0; k < 16; k++) {
    const t = rng(), z = 0.3 + rng() * 23.4, near = rng() < 0.5, x = near ? XW + 0.06 + rng() * 0.25 : XF - 0.08 - rng() * 0.3, rot = rng() * TAU, s = rng();
    if (westHoles.some(h => z > h.z0 - 0.1 && z < h.z1 + 0.1 && near)) continue;
    if (t < 0.55) part(b, x, 0, z, 0.02 + s * 0.05, 0.012 + s * 0.03, 0.02 + s * 0.04, [0x8a8274, 0x6f695e, 0x9c9282][k % 3], 'noBottom', rot);   // 碎水泥块
    else if (t < 0.85) part(b, x, 0, z, 0.1 + s * 0.08, 0.002, 0.07 + s * 0.06, [0xd8d2c0, 0xc9b98f, 0xe4e0d4][k % 3], 'noBottom', rot);   // 纸片
    else cyl(b, x, 0.02, z, 0.02, 0.1, k % 2 ? 'x' : 'z', PROP, 0x9a3a2a, 7, false);                                                      // 压扁的易拉罐
  }

  // ---- 8. 横通道 ----
  if (cross) buildCross(b, st, rng);

  // ---- 9. 刷新点：沿走廊两条线，每 1.2 m 一个（规则网格 + 抖动，第 7 节）----
  for (let z = 0.6; z < SIZE; z += 1.2) {
    for (const x of [11.35, 12.45]) b.spawn(x + (rng() - 0.5) * 0.14, z + (rng() - 0.5) * 0.3, 'floor', st.safe ? { safe: true } : undefined);
  }

  if (windows.length) b.data.windowZ = winSite;
  if (wires.length) b.data.wires = true;
  // ---- 10. 危害逐帧 ----
  if (windows.length) {
    b.update((dt, t) => {
      const P = BR.player;
      for (const w of windows) {
        const reaching = Math.sin(t * 0.5 + w.phase) > 0.85;   // 手臂周期性探出，比常规范围更远（依据「手臂能伸得更远」）
        if (reaching && !w.hit) {
          const d = Math.hypot(P.x - w.x, P.z - w.z);
          if (d < 2.4) {
            if (BR.game.attackPlayers) P.damage({ hp: 16, sanity: 5, source: 'hazard:window' });
            BR.audio.play('screech', [w.x, 1.2, w.z]);
          }
          w.hit = true;
        } else if (!reaching) { w.hit = false; }
      }
    });
  }
  if (wires.length) {
    b.update((dt, t) => {
      const P = BR.player;
      for (const w of wires) {
        const spark = Math.sin(t * 3.1 + w.phase) > 0.6;
        const flash = spark && Math.sin(t * 47 + w.phase) > 0;
        if (w.lit !== flash) { w.lit = flash; w.spark.setColor(flash ? [2.4, 1.9, 0.9] : [0.25, 0.12, 0.05]); }
        if (spark && !w.hit) {
          const d = Math.hypot(P.x - w.x, P.z - w.z);
          if (d < 0.9 && BR.game.attackPlayers) P.damage({ hp: 10, sanity: 0, source: 'hazard:live_wire' });
          w.hit = true;
        } else if (!spark) { w.hit = false; }
      }
    });
  }

  return b.finish();
}

// =====================================================================
// 幻觉提示文案（Clockwork Theory，见 mechanics）
// =====================================================================
// 逐条对应 mechanics 里列出的具体幻象内容，用自己的话转述，不新编不存在的幻象
const HALLUC_MSGS = [
  '墙上出现一扇你确定不存在的门，锁得死死的',
  '死胡同尽头有一扇空白的窗户，望进去只有一堵混凝土墙',
  '拐角处摆着一张小茶几，烟灰缸里还插着没抽完的雪茄',
  '墙上挂着一幅画，画的是外面明媚的风景',
  '旁边的房间不知何时变成了一间装修齐全的卧室',
  '一段楼梯从墙里探出来，通向更高处的走廊',
];

// ---------- 层级状态（enter 里重置，非区块级）----------
const S = { hallucCooldown: 10, quakeCooldown: 60, idleTimer: 0, dissolving: false };

BR.levels.register({
  id: '2', name: 'Level 2', title: 'Pipe Dreams', nickname: 'Pipe Dreams',
  version: 'fandom',                     // = data/lore-choices.json 的 levels['2'].source
  survivalClass: 'Threat Index: Class 2（Unsafe / Stable / Low Entity Count）',
  chunkSize: SIZE,
  env: {
    // 用户指定的暖黄工业灯：雾是昏黄偏褐的颜色，走廊远处沉进一片暗金色里，而不是发黑
    background: 0x3a2d1a, fogColor: 0x3a2d1a, fogNear: 6, fogFar: 40,
    // 灯是主光源（4 m 一盏、灯下亮灯间稍暗，像参考图那样一团团的光）；环境光暖黄、有效亮度约 0.25 × (1, 0.86, 0.67) ≈ 0.22，坏灯那一段也看得清路
    ambient: { color: 0xffdcaa, intensity: 0.25 },
    sanityDrainMul: 1.2,   // 依据 survivalClass「Unsafe」+ 持续的幻觉/污染压力，取中等偏高，非设定精确数值
    hungerDrainMul: 1.15,  // 依据 mechanics「刚进入的地球人比常人消耗更多能量」（能量异常）
    audio: 'pipes',        // 依据 materials「大量水管、蒸汽管和通风管道」
    darkness: false,       // 版本没有明说是无光层，只说存在黑暗区域
  },
  // 依据 entrances「许多流浪者第一次进入后室就是直接切入 Level 2」：出生在一段普通的直走廊里，面朝北，右手边是管道
  spawn() { return { x: XSP, y: 0, z: ZSP, yaw: 0 }; },
  buildChunk,
  entities: [
    // entityDensityOverall = 'low'（Threat Index 标注 'Low Entity Count'）；四种实体本页都没有单独给数值，
    // 只说它们「适应为一头猛冲，无需保存体力」，因此统一按整体密度词 low 换算（第 12 节：只有定性描述 → densityWords）
    { type: 'clump', officialPer1000m2: BR.config.densityWords.low },
    { type: 'hound', officialPer1000m2: BR.config.densityWords.low },
    { type: 'smiler', officialPer1000m2: BR.config.densityWords.low },
    { type: 'skin_stealer', officialPer1000m2: BR.config.densityWords.low },
  ],
  items: [
    // 用户规则：所有模式都刷杏仁水与食物（即使版本没单独强调也照刷）
    { type: 'almond_water', per1000m2: 1.2 },              // data/item-spawn.json：不限层级都放
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'warpberries', per1000m2: 0.1 },               // item-spawn.json 明确写「确认在 Level 0 和 Level 2 出现过」
    { type: 'moth_jelly', per1000m2: 0.003 },              // 本层没有死亡飞蛾，用 item-spawn.json 的「无飞蛾层级也少量散落」兜底值
    { type: 'food_ration', per1000m2: 0.6 },               // 用户规则兜底口粮（item-spawn.json：食物设定物品覆盖不到本层）
  ],
  // 出口按 8 个区块一个周期摆在西墙（slot = (cz + 3·cx) mod 8）；出生那一列从出生块往南北各走 4 块以内每种都能遇到
  exits: [
    { to: '1', kind: 'door', note: '消防出口（西墙 1.1 m 深的门洞里，门上绿色出口灯箱）；slot 7，出生块往北 1 块、约 17 m' },
    { to: '3', kind: 'door', note: '消防出口；slot 1，出生块往南 1 块、约 17 m' },
    { to: '477', kind: 'door', note: '消防出口；slot 2（出生块往南 2 块）。477 超出首期范围，摆实物但提示尚未开放' },
    { to: 'Phi', kind: 'door', note: '西侧岔口尽头标有「Φ」的金色门；slot 5（往北 3 块）。Level Phi 超出首期范围，尚未开放' },
    { to: '4', kind: 'noclip', note: '走廊西墙有一段会错位、偶尔闪没的墙（"走廊本身有概率通往 Level 4"）；slot 6（往北 2 块）' },
    { to: '27', kind: 'noclip', note: '同一机制的另一目标；slot 4（南北各 4 块）。27 超出首期范围，尚未开放' },
    { to: '34', kind: 'hole', note: '下水道岔口里地上掀开井盖的洞；slot 3（往南 3 块）。34 超出首期范围，尚未开放' },
    { to: '699', kind: 'zone', note: '霓虹灯越来越密的岔口尽头的发光圈；slot 4（南北各 4 块）。699 超出首期范围，尚未开放' },
    { to: 'unspecified', kind: 'unknown', note: '「完成特定任务后进入 Level 2 的子层级」——原文没写具体子层级和触发方式，无法落实成实物，未实现' },
    { to: 'unspecified', kind: 'unknown', note: '「爬进通风系统」——原文没写目的地，且原文自己也不建议这么做，无法落实成实物，未实现' },
  ],
  enter(ctx) {
    S.hallucCooldown = 10; S.quakeCooldown = 60; S.idleTimer = 0; S.dissolving = false;
    S.rng = U.rng(ctx.levelSeed, 'L2-flavor');   // 幻觉/地震/杏仁水污染判定用；不用 Math.random（_TEMPLATE.md 第14节：事件条件要确定性输入）
    // 依据 mechanics「通讯失灵：无线电、对讲机完全失效」
    BR.hud.toast('对讲机里只有沙沙的静电声——这层没法呼叫任何人', 3200);
  },
  update(ctx, dt) {
    const P = BR.player;

    // Clockwork Theory 幻觉：离出生点越远（走廊越复杂）触发越频繁（依据 mechanics 原文「离入口越远越复杂，
    // 幻觉性布局变化比 Level 0 更频繁」）；摄像机录不到变化本身，这里只做屏幕轻闪 + 提示文案
    S.hallucCooldown -= dt;
    if (S.hallucCooldown <= 0) {
      const cc = BR.world.chunkCoordsAt(P.x, P.z);
      const dist = Math.max(Math.abs(cc.cx), Math.abs(cc.cz));
      const chance = Math.min(0.85, 0.12 + dist * 0.05);
      if (S.rng() < chance) {
        BR.hud.toast(HALLUC_MSGS[(S.rng() * HALLUC_MSGS.length) | 0], 3200);
        BR.gfx.flash(0xffffff, 0.15, 0.12);
      }
      S.hallucCooldown = 14 + S.rng() * 18;
    }

    // 地震（依据 hazards/weather「地震频率与前厅环太平洋火山带相当」）：
    // 只做轻微提示 + 音效，强震"永久封闭区域"未实现（见 apiRequests，需要动态摧毁区块的能力）
    S.quakeCooldown -= dt;
    if (S.quakeCooldown <= 0) {
      BR.hud.toast('脚下传来一阵闷响，地面轻轻晃动了一下', 2400);
      BR.audio.play('buzz');
      S.quakeCooldown = 150 + S.rng() * 180;
    }

    const chunk = BR.world.chunkAt(P.x, P.z);
    const data = chunk && chunk.res && chunk.res.data ? chunk.res.data : null;
    const pipe = data && data.pipeline;
    const inPipeline = !!(pipe && P.x > pipe.x0 && P.x < pipe.x1 && P.z > pipe.z0 && P.z < pipe.z1);

    // Biological Pipeline：只要持续移动就不会被消化，站着不动太久才会被碱液溶解
    // （依据 mechanics「只要持续移动就不会被消化」，hazards「碱性消化液数秒内溶解成年人」）。
    // 原文是"吞下几小时不动才开始消化"，这个尺度在游戏里没法还原，压缩成几秒钟，注释说明取舍
    if (inPipeline && Math.hypot(P.vx, P.vz) < 0.15) {
      S.idleTimer += dt;
      if (S.idleTimer > 6) {
        if (!S.dissolving) { S.dissolving = true; BR.hud.toast('粘稠的碱液开始包裹你——快动起来！', 2600); }
        if (BR.game.attackPlayers) P.damage({ hp: 24 * dt, sanity: 6 * dt, source: 'hazard:biological_pipeline' });
      }
    } else { S.idleTimer = 0; S.dissolving = false; }

    // 高温区持续灼烧（依据 hazards「极端温度（蒸汽管区 60–100 °C）」）
    if (data && data.kind === 'hot' && BR.game.attackPlayers) P.damage({ hp: 3 * dt, sanity: 0, source: 'hazard:steam_heat' });
  },
  leave(ctx) {},
});

// 被污染的管道液体（依据 hazards「被污染的管道液体与病原体（接触或饮用传播，后室疫情主要源头）」，
// items「杏仁水（管道中）：可能存在于水管内，但被锈、细菌、病原体污染，饮用或接触可能感染未知疾病」）。
// 原文没有给出具体感染概率，取 0.4 作为可玩数值（非设定）；只在本层喝到普通杏仁水时判定，
// 彩色瓶版本是另一种独立设定物品，不在本条污染描述范围内
BR.bus.on('item:use', payload => {
  if (!payload || payload.type !== 'almond_water') return;
  if (BR.game.levelId !== '2') return;
  if (S.rng() < 0.4) {
    BR.hud.toast('水里有股铁锈味，你感觉肠胃一阵翻搅', 3000);
    if (BR.game.attackPlayers) BR.player.damage({ hp: 8, sanity: 6, source: 'hazard:contaminated_pipe' });
  }
});
})();

// ==================== 待实现物品（js/items/ 里没有对应文件，暂不落地）====================
// - Contaminated pipe liquids：不是独立拾取物，已经用上面「喝杏仁水有概率污染」的判定实现了它的效果
// - Snow（雪）：无对应物品文件，只用低温区的结霜水渍（puddle）和冰锥表现，没有做成可拾取/可食用的物品
// - Explosives（炸药）：无对应物品文件，只用于背景说明「小团体炸开临时掩体」，掩体已做成 shelter 岔口
// - Radios / walkie-talkies（对讲机）：无对应物品文件，效果（完全失灵）已用 enter() 的一次性提示表现
// - Video cameras（摄像机）：无对应物品文件，纯背景设定（拍不到布局变化本身），不影响玩法
// - DuPont–Bayer solution（碱液）：不是玩家拾取物，是 Biological Pipeline 自身机制，已在 update() 里实现
// - Recovered Diary: My Findings No. 7（寻获日记）：无对应物品文件，纯背景文本，不影响玩法
// - Hallucinatory furnishings（幻象陈设）：无对应物品文件，且原文自己说「不宜当作可拾取物资」，
//   真实性存疑、具体外观和触发条件也没写，只用 HALLUC_MSGS 的提示文案表现
