// Level 3 - "发电站"（The Electrical Station）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-3  许可：CC BY-SA 3.0
// 抓取：2026-09-12；页面版本 35；原作者 Reddit 用户 u/M654z，Natedagreat563 重写，译者 Lambda Core
// 出口、实体、物品、危害与机制只按上面这个版本实现，不从其他版本（wikidot-en／fandom）借
// （见 data/lore-choices.json levels["3"].conflicts：生存等级数字、温度上限、栅栏来源年份、实体名单与智力设定、
//  Gamma 基地规模、去 69/11 的方式等条目都按此规则跳过，一律不借）
//
// 【外观与布局：游戏主人（贝塔）2026-09-23 亲自指定，优先于上面的维基版本】
//   data/lore-choices.json levels["3"].userOverride / userRefs，两张手表拍屏幕的参考照片（看结构、比例、颜色和物件，不看像素）：
//   refs/2026-09-23/L3-通道.jpg  —— 一条条通道：下半截米黄/棕色瓷砖墙、斑驳起皮的旧天花板、日光灯管、湿亮反光的地面，
//                                   通道口一扇开着的白漆方格铁栅门，旁边挂黑底黄字 "OUT OF BOUNDS" 牌子；
//   refs/2026-09-23/L3-发电机.jpg —— 绿色钢框架（带螺栓的连接板）、横着的橙红色铜排（带螺栓、贴白标签）、
//                                   从上面垂下来的粗黑电缆（末端黄铜接线鼻）、带伞裙的瓷绝缘子、
//                                   底下一排圆柱形保险丝（蓝/绿色标签）和接线端子、吊着的梯形罩日光灯。
//   规律要明显：每 24 m 一个路口（十字，少数被锈栅栏挡住或封死成丁字），沿通道每 24 m 一台发电机，
//   每段通道靠路口那头一扇铁栅门。维基版本的"曲折走廊 + 棕砖墙 + 金属天花板"外观不再使用。
//   这一版把原来的格子迷宫换成固定的通道网：区块中心一个路口，南北、东西两条通道穿过区块。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
const THREE = window.THREE;

// ---------- 尺寸 ----------
// 区块 24 m，中心是路口；两条 2.4 m 宽的通道（参考图通道比人肩宽两倍左右）南北、东西贯穿区块。
// 相邻区块的通道首尾相接 ⇒ 路口间距恒为 24 m，发电机间距恒为 24 m
const SIZE = 24, H = 2.8;
const C = SIZE / 2, HW = 1.2;
const A0 = C - HW, A1 = C + HW;            // 10.8 / 13.2：通道两侧墙线（x、z 两个方向同值）
const BAY_A = 2.4, BAY_B = 6.6, BAY_D = 1.4; // 发电机凹间：沿通道 2.4–6.6 m，进深 1.4 m（北臂东墙、西臂北墙各一个）
const GATE_AT = 9.2;                       // 铁栅门离区块边 9.2 m ＝ 离路口 1.6 m（北臂、西臂的通道口）
const SLOT_D = 2.4;                        // 墙上凹进去的小间（电梯厅、木门、杂物）进深：出口触发圈不伸进通道
const SPAWN = { x: C, z: 16.8 };           // 出生在南臂，面朝北：正前方是路口、铁栅门，门后右手边就是第一台发电机

// 墙上的小凹间（区块本地坐标）：bx/bz 是后墙中点，rot 让"正面朝 +Z"的构件面向通道
const SLOTS = {
  sw: { x0: A0 - SLOT_D, x1: A0, z0: 15.8, z1: 18.6, bx: A0 - SLOT_D, bz: 17.2, rot: Math.PI / 2 },   // 南臂西墙
  se: { x0: A1, x1: A1 + SLOT_D, z0: 19.2, z1: 22.0, bx: A1 + SLOT_D, bz: 20.6, rot: -Math.PI / 2 },  // 南臂东墙
  en: { x0: 17.0, x1: 19.8, z0: A0 - SLOT_D, z1: A0, bx: 18.4, bz: A0 - SLOT_D, rot: 0 },            // 东臂北墙
  es: { x0: 19.2, x1: 22.0, z0: A1, z1: A1 + SLOT_D, bx: 20.6, bz: A1 + SLOT_D, rot: Math.PI },      // 东臂南墙
};
// 汽车电力房（exits[2]）：东南角块里 7.2×7.2 m 的房间，从南臂东墙一段 1.6 m 的过道进去（与 se 凹间互斥）
const ROOM = { x0: 15.0, x1: 22.2, z0: 16.0, z1: 23.2 };
const ROOM_DOOR = { x0: A1, x1: 15.0, z0: 16.8, z1: 18.4 };

// ---------- 出口周期（规则：任意位置 3–5 块内找得到，无限层按周期重复）----------
// (cx mod 4, cz mod 4) 命中下表的区块摆对应出口；4 块周期 ⇒ 任何区块离每种出口的切比雪夫距离 ≤ 2 块
const EXIT_PERIOD = 4;
const EXIT_AT = { elev4: [2, 1], elev5: [1, 3], door31: [3, 2], car69: [2, 3] };

// ---------- 颜色 ----------
const COL = {
  // 顶点色按线性值进着色器、输出再做 sRGB 编码，看起来会比 hex 亮一截：深色要写得更深
  green: 0x4c6a36, copper: 0xae4418, brass: 0xa87a28, cab: 0x0f1713,
  porcelain: 0x7d8c96, rubber: 0x14181a, white: 0xd8d6cc, rust: 0x5e3218, steel: 0x6c716e, dark: 0x0c0e0c,
};

function mod(a, n) { return ((a % n) + n) % n; }
function tint(hex, k) {
  if (Array.isArray(hex)) return [hex[0] * k, hex[1] * k, hex[2] * k];
  const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k];
}

// 东西向通道的一段（区块 sx 与 sx+1 之间、第 cz 行）是否被挡：只在偶数 sx 上挡 ⇒ 一个路口东西两臂不会同时被挡；
// cz 是 3 的倍数的行永远不挡 ⇒ 南北通道永远不断，每 3 行至少一条东西向"主干"，整层连通。
// 'bars' ＝ 区块交界处一排锈迹斑斑的监狱栅栏（landmarks「锈迹斑斑的监狱栅栏区」，mechanics「无法拆除或打开」），两边都成死胡同；
// 'wall' ＝ 整段不存在，两头的路口变成丁字
function segState(seed, sx, cz) {
  if (mod(sx, 2) !== 0 || mod(cz, 3) === 0) return 'open';
  const r = U.rng(seed, sx, cz, 'L3-seg')();
  return r < 0.2 ? 'bars' : r < 0.32 ? 'wall' : 'open';
}

// ---------- 贴图（仓库里没有 jpg：只用程序化画法，noFile 跳过文件探测）----------
function wrapX(s, x, rad, fn) { fn(x); if (x - rad < 0) fn(x + s); if (x + rad > s) fn(x - s); }
function wrapXY(s, x, y, rad, fn) {
  wrapX(s, x, rad, xx => { fn(xx, y); if (y - rad < 0) fn(xx, y + s); if (y + rad > s) fn(xx, y - s); });
}
function flakePts(r, rad) {
  const n = 6 + (r() * 5 | 0), pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, d = rad * (0.45 + r() * 0.75); pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
  return pts;
}
function drawPoly(g, pts, x, y) {
  g.beginPath();
  for (let k = 0; k < pts.length; k++) { if (k) g.lineTo(x + pts[k][0], y + pts[k][1]); else g.moveTo(x + pts[k][0], y + pts[k][1]); }
  g.closePath();
}

// 墙：一张贴图正好对应 2.4 m 宽 × 2.8 m 高（墙面 UV 的 v = 离地米数 / 2.8，底边就是地面）。
// 离地 0–1.8 m 是 0.15 m 见方的釉面砖：最下一排深棕踢脚砖、中间米黄/浅棕、最上一排深棕压边砖；1.8 m 以上是发黄起皮的旧涂料
BR.assets.registerProcedural('l3_wall_tile', 512, (g, s) => {
  const r = U.rng('l3_wall_tile');
  const ppm = s / H, Y = m => s - m * ppm;
  const ROW = 0.15, COLS = 16, tw = s / COLS, top = Y(1.8);
  g.fillStyle = 'rgb(150,142,122)'; g.fillRect(0, 0, s, top + 2);
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = r() < 0.5 ? `rgba(88,80,62,${0.05 + r() * 0.08})` : `rgba(214,208,190,${0.05 + r() * 0.08})`;
    g.fillRect(r() * s, r() * top, 1 + r() * 3, 1 + r() * 3);
  }
  for (let k = 0; k < 16; k++) {           // 从天花板往下流的水渍
    const x = r() * s, w = 3 + r() * 16, len = (0.25 + r() * 0.75) * top, a = 0.18 + r() * 0.25;
    wrapX(s, x, w, xx => {
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(92,74,46,${a})`); gr.addColorStop(1, 'rgba(92,74,46,0)');
      g.fillStyle = gr; g.fillRect(xx - w / 2, 0, w, len);
    });
  }
  for (let k = 0; k < 26; k++) {           // 起皮：浅色翘起的漆片 + 深色边
    const x = r() * s, y = 6 + r() * (top - 14), rad = 2 + r() * 7, pts = flakePts(r, rad);
    wrapX(s, x, rad * 1.3, xx => {
      drawPoly(g, pts, xx, y); g.fillStyle = 'rgba(184,178,160,0.8)'; g.fill();
      g.strokeStyle = 'rgba(60,52,40,0.4)'; g.lineWidth = 1; g.stroke();
    });
  }
  const gradTop = g.createLinearGradient(0, 0, 0, top * 0.5);
  gradTop.addColorStop(0, 'rgba(40,34,24,0.35)'); gradTop.addColorStop(1, 'rgba(40,34,24,0)');
  g.fillStyle = gradTop; g.fillRect(0, 0, s, top * 0.5);
  g.fillStyle = 'rgb(78,66,52)'; g.fillRect(0, top, s, s - top);      // 砖缝
  const PAL = [[214, 194, 150], [204, 182, 136], [196, 170, 122], [222, 204, 160], [190, 163, 118], [208, 188, 146]];
  for (let row = 0; row < 12; row++) {
    const yb = Y(row * ROW), yt = Y((row + 1) * ROW);
    for (let c = 0; c < COLS; c++) {
      let col = row === 0 ? [102, 76, 52] : row === 11 ? [134, 98, 64] : PAL[(r() * PAL.length) | 0];
      if (row > 0 && row < 11 && r() < 0.07) col = [166, 128, 86];
      const k = 0.84 + r() * 0.14;
      const x0 = c * tw + 1.2, y0 = yt + 1.2, w = tw - 2.4, h = yb - yt - 2.4;
      g.fillStyle = `rgb(${col[0] * k | 0},${col[1] * k | 0},${col[2] * k | 0})`; g.fillRect(x0, y0, w, h);
      g.fillStyle = 'rgba(255,248,228,0.24)'; g.fillRect(x0, y0, w, 2);            // 釉面上沿的反光
      g.fillStyle = 'rgba(255,248,228,0.10)'; g.fillRect(x0 + 2, y0 + 2, w * 0.35, h * 0.4);
      g.fillStyle = 'rgba(36,26,16,0.2)'; g.fillRect(x0, y0 + h - 2, w, 2);
      if (row > 0 && r() < 0.07) {           // 裂纹
        g.strokeStyle = 'rgba(52,40,28,0.7)'; g.lineWidth = 1; g.beginPath();
        g.moveTo(x0 + r() * w, y0); g.lineTo(x0 + r() * w, y0 + h * (0.4 + r() * 0.6)); g.stroke();
      }
      if (row > 0 && row < 11 && r() < 0.025) {   // 掉了半块釉：露出灰色砖坯
        g.fillStyle = 'rgba(120,112,98,0.9)'; g.fillRect(x0 + w * r() * 0.5, y0 + h * r() * 0.5, w * 0.4, h * 0.45);
      }
    }
  }
  g.fillStyle = 'rgba(255,240,210,0.3)'; g.fillRect(0, Y(1.8) + 1, s, 2);            // 压边砖圆角的高光
  for (let k = 0; k < 1800; k++) { g.fillStyle = `rgba(40,30,18,${0.06 + r() * 0.12})`; g.fillRect(r() * s, top + r() * (s - top), 1 + r() * 2, 1 + r() * 2); }
  const gradLow = g.createLinearGradient(0, Y(0.6), 0, s);
  gradLow.addColorStop(0, 'rgba(30,24,14,0)'); gradLow.addColorStop(1, 'rgba(30,24,14,0.5)');
  g.fillStyle = gradLow; g.fillRect(0, Y(0.6), s, s - Y(0.6));
  for (let k = 0; k < 8; k++) {           // 涂料上的脏水一直流到瓷砖上
    const x = r() * s, w = 2 + r() * 6, len = (0.2 + r() * 0.5) * (s - top);
    wrapX(s, x, w, xx => {
      const gr = g.createLinearGradient(0, top, 0, top + len);
      gr.addColorStop(0, 'rgba(70,54,32,0.3)'); gr.addColorStop(1, 'rgba(70,54,32,0)');
      g.fillStyle = gr; g.fillRect(xx - w / 2, top, w, len);
    });
  }
}, { noFile: true });

// 地面：0.3 m 见方的灰绿色地砖（参考图地面偏暗绿灰），一张贴图 2.4 m；湿亮靠材质高光，不靠贴图
BR.assets.registerProcedural('l3_floor_wet', 512, (g, s) => {
  const r = U.rng('l3_floor_wet');
  const n = 8, t = s / n;
  g.fillStyle = 'rgb(34,36,32)'; g.fillRect(0, 0, s, s);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = 0.86 + r() * 0.22, gtint = r() * 8;
    g.fillStyle = `rgb(${72 * k | 0},${(79 + gtint) * k | 0},${70 * k | 0})`;
    g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
    g.fillStyle = 'rgba(200,210,196,0.05)'; g.fillRect(i * t + 3, j * t + 3, t - 6, 3);
    if (r() < 0.3) { g.fillStyle = `rgba(20,22,18,${0.15 + r() * 0.2})`; g.fillRect(i * t + 2 + r() * t * 0.5, j * t + 2 + r() * t * 0.5, t * 0.4, t * 0.4); }
  }
  for (let k = 0; k < 5000; k++) { const v = r() < 0.5 ? 20 : 140; g.fillStyle = `rgba(${v},${v + 6},${v},${0.05 + r() * 0.1})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
  for (let k = 0; k < 16; k++) {
    const x = r() * s, y = r() * s, rad = 20 + r() * 60, a = 0.12 + r() * 0.2;
    wrapXY(s, x, y, rad, (xx, yy) => {
      const gr = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
      gr.addColorStop(0, `rgba(16,18,14,${a})`); gr.addColorStop(1, 'rgba(16,18,14,0)');
      g.fillStyle = gr; g.fillRect(xx - rad, yy - rad, rad * 2, rad * 2);
    });
  }
}, { noFile: true });

// 天花板：发灰的旧涂料，大片霉斑水渍 + 起皮的浅色碎片（参考图通道顶上那种斑驳）
BR.assets.registerProcedural('l3_ceil_peel', 512, (g, s) => {
  const r = U.rng('l3_ceil_peel');
  g.fillStyle = 'rgb(140,136,126)'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 20; k++) {
    const x = r() * s, y = r() * s, rad = 30 + r() * 90, a = 0.2 + r() * 0.3;
    wrapXY(s, x, y, rad, (xx, yy) => {
      const gr = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
      gr.addColorStop(0, `rgba(66,60,48,${a})`); gr.addColorStop(1, 'rgba(66,60,48,0)');
      g.fillStyle = gr; g.fillRect(xx - rad, yy - rad, rad * 2, rad * 2);
    });
  }
  for (let k = 0; k < 80; k++) {
    const x = r() * s, y = r() * s, rad = 2 + r() * 8, pts = flakePts(r, rad), light = r() < 0.65;
    wrapXY(s, x, y, rad * 1.3, (xx, yy) => {
      drawPoly(g, pts, xx, yy);
      g.fillStyle = light ? 'rgba(190,186,172,0.85)' : 'rgba(62,56,46,0.6)'; g.fill();
      g.strokeStyle = 'rgba(44,40,32,0.4)'; g.lineWidth = 1; g.stroke();
    });
  }
  for (let k = 0; k < 1400; k++) { g.fillStyle = `rgba(36,32,26,${0.1 + r() * 0.3})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
}, { noFile: true });

// 旧贴图：本层不再用，但 Level 11 的砖墙还在用 l3_brick_brown —— file:// 双击时它靠这里的兜底画法，保留
BR.assets.registerProcedural('l3_brick_brown', 256, (g, s) => {
  g.fillStyle = '#4a3a30'; g.fillRect(0, 0, s, s);
  const r = U.rng('l3_brick_brown');
  const bw = s / 6, bh = s / 12;
  for (let row = 0; row < 12; row++) {
    const off = (row % 2) * (bw / 2);
    for (let col = -1; col < 7; col++) {
      g.fillStyle = `rgb(${60 + (r() * 30 | 0)},${45 + (r() * 20 | 0)},${34 + (r() * 16 | 0)})`;
      g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
});

// 材质只有墙、地、顶三种贴图材质；所有道具进 'kit:prop'（顶点色分色）/ 'kit:glow'，不为分色新增材质
function defineMaterials() {
  kit.mat('L3:wall', { tex: 'l3_wall_tile', repeatMeters: [2.4, H], shininess: 26, specular: 0x2c2822 });
  kit.mat('L3:floor', { tex: 'l3_floor_wet', repeatMeters: 2.4, shininess: 64, specular: 0x57564e });   // 湿地面：强高光把灯拉成亮斑
  kit.mat('L3:ceil', { tex: 'l3_ceil_peel', repeatMeters: 3, shininess: 3, specular: 0x060606 });
}

// ---------- 小工具（全部在当前 push 坐标系下）----------
function P(b, x, y, z, w, h, d, color, faces) {
  return b.box(x, y, z, w, h, d, 'kit:prop', { color, solid: false, uv: 'stretch', faces: faces || 'all' });
}
function F(b, x, y, z, w, h, facing, color) { return b.plane(x, y, z, w, h, 'kit:prop', { facing, color, uv: 'stretch' }); }
function GF(b, x, y, z, w, h, facing, color) { return b.plane(x, y, z, w, h, 'kit:glow', { facing, color, uv: 'solid' }); }
function GB(b, x, y, z, w, h, d, color) { return b.box(x, y, z, w, h, d, 'kit:glow', { color, uv: 'solid', solid: false }); }
function CY(b, x, y, z, r, h, color, seg, o) {
  return b.cylinder(x, y, z, r, h, 'kit:prop', Object.assign({ color, segments: seg || 6, uv: 'stretch', solid: false }, o));
}
// 任意四边形，给一个大致的朝向 hint，自动按它定正反面（不用手算绕序）
function Q(b, p0, p1, p2, p3, color, hint, key) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const o = { color, uv: key === 'kit:glow' ? 'solid' : 'stretch' };
  return (nx * hint[0] + ny * hint[1] + nz * hint[2] >= 0) ? b.quad(p0, p1, p2, p3, key || 'kit:prop', o) : b.quad(p0, p3, p2, p1, key || 'kit:prop', o);
}
// 螺栓头：贴在朝 +Z 的面 zs 上（只画正面和顶面，凸出 12 mm，不与底面共面）
function bolt(b, x, y, zs, sz, color) { return P(b, x, y - sz / 2, zs + 0.006, sz, sz, 0.012, color != null ? color : 0x56603f, ['pz', 'py']); }
const _v = p => new THREE.Vector3(p[0], p[1], p[2]);
function cable(b, pts, r, color, tubular, radial) {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(_v)), tubular || 10, r, radial || 5, false);
  b.mesh(g, 'kit:prop', { color, uv: 'stretch' });
  g.dispose();
}

// 3×5 点阵字（牌子上的字：OUT OF BOUNDS、电梯楼层号），每行连续的点合成一条，(x, yTop) 是左上角，贴在朝 +Z 的面上
const FONT = {
  O: ['111', '101', '101', '101', '111'], U: ['101', '101', '101', '101', '111'], T: ['111', '010', '010', '010', '010'],
  F: ['111', '100', '110', '100', '100'], B: ['110', '101', '110', '101', '110'], N: ['1001', '1101', '1011', '1001', '1001'],
  D: ['110', '101', '101', '101', '110'], S: ['111', '100', '111', '001', '111'], A: ['010', '101', '111', '101', '101'],
  G: ['111', '100', '101', '101', '111'], E: ['111', '100', '110', '100', '111'], R: ['110', '101', '110', '101', '101'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
};
function textWidth(text, px) { let n = 0; for (const ch of text) n += (FONT[ch] ? FONT[ch][0].length : 3) + 1; return (n - 1) * px; }
function pixText(b, text, x, yTop, z, px, color, key) {
  let cx = x;
  for (const ch of text) {
    const gl = FONT[ch];
    if (gl) {
      for (let row = 0; row < 5; row++) {
        const line = gl[row], L = line.length;
        for (let k = 0; k < L;) {
          if (line[k] !== '1') { k++; continue; }
          let e = k; while (e < L && line[e] === '1') e++;
          const w = (e - k) * px, xx = cx + k * px + w / 2, yy = yTop - (row + 1) * px;
          if (key === 'kit:glow') GF(b, xx, yy, z, w, px, '+z', color); else F(b, xx, yy, z, w, px, '+z', color);
          k = e;
        }
      }
    }
    cx += ((gl ? gl[0].length : 3) + 1) * px;
  }
}

// ---------- 区块布局：空地矩形 → 实心块 → 墙面 ----------
// 空地（通道、凹间、房间）用矩形给；剩下的全是实心：按坐标压缩切成格子再合并成少量 AABB 碰撞体，
// 墙面只画实心块朝空地那一面（区块边界线上的面由邻块的实心块挡着，不画）
function uniqSorted(a) { a.sort((p, q) => p - q); const out = []; for (const v of a) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v); return out; }
function solidRects(free) {
  const xs = [0, SIZE], zs = [0, SIZE];
  for (const f of free) { xs.push(f.x0, f.x1); zs.push(f.z0, f.z1); }
  const X = uniqSorted(xs), Z = uniqSorted(zs);
  const out = [];
  let open = [];
  for (let i = 0; i + 1 < X.length; i++) {
    const mx = (X[i] + X[i + 1]) / 2;
    const runs = [];
    for (let j = 0; j + 1 < Z.length; j++) {
      const mz = (Z[j] + Z[j + 1]) / 2;
      const isFree = free.some(f => mx > f.x0 && mx < f.x1 && mz > f.z0 && mz < f.z1);
      if (isFree) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - Z[j]) < 1e-6) last[1] = Z[j + 1]; else runs.push([Z[j], Z[j + 1]]);
    }
    const next = [];
    for (const rn of runs) {
      const hit = open.find(o => Math.abs(o.z0 - rn[0]) < 1e-6 && Math.abs(o.z1 - rn[1]) < 1e-6);
      if (hit) { hit.x1 = X[i + 1]; next.push(hit); }
      else { const o = { x0: X[i], x1: X[i + 1], z0: rn[0], z1: rn[1] }; out.push(o); next.push(o); }
    }
    open = next;
  }
  return out;
}
function subtract(iv, a, b2) {
  const out = [];
  for (const [p, q] of iv) {
    if (b2 <= p + 1e-6 || a >= q - 1e-6) { out.push([p, q]); continue; }
    if (a > p + 1e-6) out.push([p, a]);
    if (b2 < q - 1e-6) out.push([b2, q]);
  }
  return out;
}
const eq = (a, b2) => Math.abs(a - b2) < 1e-6;
function buildWalls(b, rects) {
  const walls = [];
  for (const R of rects) {
    b.solid(R.x0, 0, R.z0, R.x1, H, R.z1);
    const sides = [
      { skip: eq(R.x0, 0), facing: '-x', at: R.x0, a: R.z0, b: R.z1, adj: o => eq(o.x1, R.x0), ra: o => o.z0, rb: o => o.z1 },
      { skip: eq(R.x1, SIZE), facing: '+x', at: R.x1, a: R.z0, b: R.z1, adj: o => eq(o.x0, R.x1), ra: o => o.z0, rb: o => o.z1 },
      { skip: eq(R.z0, 0), facing: '-z', at: R.z0, a: R.x0, b: R.x1, adj: o => eq(o.z1, R.z0), ra: o => o.x0, rb: o => o.x1 },
      { skip: eq(R.z1, SIZE), facing: '+z', at: R.z1, a: R.x0, b: R.x1, adj: o => eq(o.z0, R.z1), ra: o => o.x0, rb: o => o.x1 },
    ];
    for (const sd of sides) {
      if (sd.skip) continue;
      let iv = [[sd.a, sd.b]];
      for (const o of rects) if (o !== R && sd.adj(o)) iv = subtract(iv, sd.ra(o), sd.rb(o));
      for (const [p, q] of iv) {
        if (q - p < 1e-3) continue;
        const m = (p + q) / 2, xAxis = sd.facing === '-x' || sd.facing === '+x';
        b.plane(xAxis ? sd.at : m, 0, xAxis ? m : sd.at, q - p, H, 'L3:wall', { facing: sd.facing });
        walls.push({ facing: sd.facing, at: sd.at, a: p, b: q });
      }
    }
  }
  return walls;
}

// ---------- 日光灯管（参考图天花板上的裸灯管 + 灯架）----------
function tubeLight(b, x, z, along, state, flick, cold) {
  b.push(x, z, along === 'z' ? Math.PI / 2 : 0);
  P(b, 0, H - 0.058, 0, 1.3, 0.05, 0.1, 0xc6c1b4, 'noTop');                  // 灯架 y 2.742–2.792，离顶 8 mm
  for (const sx of [-0.625, 0.625]) P(b, sx, H - 0.1, 0, 0.03, 0.046, 0.046, 0xb2ada2, 'noTop');   // 两头灯座
  const base = cold ? [1.45, 1.6, 1.9] : [1.8, 1.7, 1.45];
  const lit = state !== 'broken';
  const tube = b.box(0, H - 0.094, 0, 1.23, 0.026, 0.026, 'kit:glow', { color: base, glow: lit ? 1 : 0.13, uv: 'solid', solid: false });
  let src = null;
  if (lit) {
    src = b.light({ x: 0, z: 0, y: H - 0.3, color: cold ? 0xdfe6ff : 0xffe2b4, intensity: cold ? 0.9 : 0.6, range: cold ? 9 : 7, flicker: state === 'flicker' ? flick : 0 });
    b.linkGlow(tube, src, base, 0.08);
  }
  b.pop();
  return src;
}

// ---------- 发电机（参考图 L3-发电机.jpg）----------
// 本地坐标：凹间开口在 z = 0（通道在 +Z 一侧），后墙 z = −1.4，宽 x ∈ [−2.1, 2.1]
// o: { rng（本台的派生流，只管配色和小变化）, heat（骤热区：红灯全亮、吊灯闪）, lampOn }
function generator(b, x, z, rot, o) {
  const r = o.rng;
  const G = () => tint(COL.green, 0.86 + r() * 0.22);
  const CU = () => tint(COL.copper, 0.82 + r() * 0.3);
  b.push(x, z, rot);
  // 基座：水泥台 + 前沿黄黑警示斜纹
  P(b, 0, 0, -0.78, 4.0, 0.1, 1.16, 0x5b574e, 'noBottom');
  F(b, 0, 0.012, -0.196, 3.96, 0.076, '+z', 0x191816);
  for (let k = 0; k < 9; k++) {
    const x0 = -1.92 + k * 0.44;
    Q(b, [x0, 0.014, -0.193], [x0 + 0.18, 0.014, -0.193], [x0 + 0.25, 0.086, -0.193], [x0 + 0.07, 0.086, -0.193], 0xc9a21c, [0, 0, 1]);
  }
  // 后面的深色配电柜：面板缝、把手、压力表、指示灯
  P(b, 0, 0.1, -1.2, 3.9, 2.08, 0.3, COL.cab, 'noBottom');
  for (const sx of [-1.3, -0.65, 0, 0.65, 1.3]) F(b, sx, 0.14, -1.047, 0.012, 1.98, '+z', 0x080d0a);
  for (const sx of [-0.33, 0.98]) P(b, sx + 0.2, 0.98, -1.036, 0.022, 0.13, 0.02, 0x8d938f, ['pz', 'px', 'nx', 'py']);
  CY(b, -1.0, 1.95, -1.035, 0.075, 0.03, 0x161616, 8, { axis: 'z' });
  CY(b, -1.0, 1.95, -1.017, 0.062, 0.004, 0xe4ddc8, 8, { axis: 'z' });
  Q(b, [-1.0, 1.945, -1.0135], [-0.965, 1.99, -1.0135], [-0.97, 1.994, -1.0135], [-1.004, 1.95, -1.0135], 0xa01e18, [0, 0, 1]);
  const lampC = o.heat ? [[1.9, 0.25, 0.15], [1.9, 0.25, 0.15], [1.9, 0.25, 0.15]] : [[0.3, 1.5, 0.4], [1.5, 0.95, 0.2], [0.35, 0.06, 0.05]];
  for (let k = 0; k < 3; k++) GF(b, -0.55 + k * 0.12, 1.9, -1.046, 0.035, 0.035, '+z', lampC[k]);
  // 柜面上横着的三根铜排（相线），立在绝缘支柱上，每个支柱一颗螺栓
  for (let k = 0; k < 3; k++) {
    const y = 1.5 + k * 0.13;
    P(b, 0.15, y, -0.975, 2.9, 0.055, 0.014, CU(), ['pz', 'py', 'ny', 'px', 'nx']);
    for (const sx of [-1.1, 1.4]) {
      P(b, sx, y - 0.005, -1.016, 0.045, 0.065, 0.068, 0x9aa4a8, ['pz', 'py']);
      bolt(b, sx, y + 0.0275, -0.968, 0.026, 0x7a6a50);
    }
  }
  // 绿色钢框架：四根立柱、顶上一圈横梁、中间一道横梁，节点上是带四颗螺栓的连接板
  for (const sx of [-1, 1]) {
    P(b, sx * 1.8, 0.1, -0.32, 0.18, 2.3, 0.18, G(), 'sides');
    P(b, sx * 1.8, 0.1, -0.95, 0.14, 2.3, 0.14, G(), 'sides');
    P(b, sx * 1.8, 2.42, -0.645, 0.16, 0.18, 0.45, G(), ['py', 'ny', 'px', 'nx']);
  }
  P(b, 0, 2.4, -0.32, 4.196, 0.22, 0.2, G(), ['py', 'ny', 'pz', 'nz']);
  P(b, 0, 2.4, -0.95, 4.196, 0.2, 0.16, G(), ['py', 'ny', 'pz', 'nz']);
  P(b, 0, 1.34, -0.32, 3.42, 0.2, 0.14, G(), ['py', 'ny', 'pz', 'nz']);
  for (const sx of [-1, 1]) {
    P(b, sx * 1.8, 1.27, -0.222, 0.34, 0.34, 0.012, G(), ['pz', 'py', 'ny', 'px', 'nx']);
    P(b, sx * 1.8, 2.2, -0.212, 0.36, 0.4, 0.012, G(), ['pz', 'py', 'ny', 'px', 'nx']);
    for (const [dx, dy] of [[-0.1, 1.34], [0.1, 1.54]]) bolt(b, sx * 1.8 + dx, dy, -0.216, 0.034);
    for (const [dx, dy] of [[-0.11, 2.29], [0.11, 2.29], [-0.11, 2.51], [0.11, 2.51]]) bolt(b, sx * 1.8 + dx, dy, -0.206, 0.034);
  }
  for (let k = 0; k < 8; k++) bolt(b, -1.26 + k * 0.36, 2.51, -0.22, 0.03);
  // 主铜排：挂在中横梁下面，正面一排螺栓；三片竖起的铜接线片，贴白标签，挂黑色电缆
  P(b, 0, 1.18, -0.29, 3.24, 0.12, 0.08, CU());
  for (let k = 0; k < 4; k++) bolt(b, -1.35 + k * 0.9, 1.24, -0.25, 0.026, 0x7a6a50);
  const tabs = [-0.75, 0.0, 0.75];
  const cableEnd = [[-1.15, 0.8, -0.6], [-0.3, 0.8, -0.6], [0.8, 0.84, -0.6]];
  for (let k = 0; k < 3; k++) {
    const tx = tabs[k];
    P(b, tx, 1.22, -0.238, 0.09, 0.4, 0.012, CU(), ['pz', 'px', 'nx', 'py']);
    bolt(b, tx, 1.3, -0.232, 0.026, 0x7a6a50);
    bolt(b, tx, 1.5, -0.232, 0.026, 0x7a6a50);
    F(b, tx, 1.36, -0.2295, 0.062, 0.075, '+z', 0xe8e6de);
    P(b, tx, 1.58, -0.2195, 0.04, 0.07, 0.025, 0x2c2f2c, ['pz', 'px', 'nx', 'py', 'ny']);
    const e = cableEnd[k];
    cable(b, [[tx, 1.6, -0.205], [tx + 0.04, 1.62, -0.14], [tx + 0.06, 1.3, -0.12], [(tx + e[0]) / 2, 1.02, -0.2], [e[0], 0.92, -0.42], e], 0.017, 0x1c2230, 8, 4);
  }
  // 参考图下半截那一大把蓝黑色电缆：再从主铜排底下甩两根粗一点的，垂到基座上进电缆沟
  cable(b, [[-1.2, 1.18, -0.27], [-1.3, 0.9, -0.15], [-1.55, 0.45, -0.12], [-1.7, 0.16, -0.3]], 0.022, 0x161c2a, 8, 4);
  cable(b, [[1.25, 1.18, -0.27], [1.3, 0.95, -0.14], [1.45, 0.5, -0.1], [1.52, 0.16, -0.32]], 0.022, 0x1a1f26, 8, 4);
  // 三个带伞裙的瓷绝缘子，吊在前横梁下，底下绿色锥形支座 + 铜搭接片连到中横梁
  for (const ix of [-1.05, 0.0, 1.05]) {
    CY(b, ix, 2.1, -0.32, 0.026, 0.3, COL.porcelain, 6, { caps: false });
    for (const sy of [2.33, 2.26, 2.19]) CY(b, ix, sy, -0.32, 0.068, 0.022, tint(COL.porcelain, 0.95 + r() * 0.1), 7);
    CY(b, ix, 2.05, -0.32, 0.034, 0.05, 0x77776c, 6);
    CY(b, ix, 1.92, -0.32, 0.016, 0.125, G(), 4, { rTop: 0.05 });
    P(b, ix, 1.546, -0.32, 0.04, 0.376, 0.01, CU(), 'sides');
  }
  // 从天花板垂下来的三根粗黑电缆：从柜顶的电缆盒出来，翻过前横梁，在绝缘子前面垂下，末端黄铜接线鼻
  P(b, 0, 2.735, -0.8, 3.2, 0.06, 0.3, 0x262a28, ['ny', 'pz', 'nz', 'px', 'nx']);
  for (const ix of [-1.05, 0.0, 1.05]) {
    cable(b, [[ix - 0.3, 2.77, -0.8], [ix - 0.22, 2.72, -0.55], [ix - 0.12, 2.7, -0.3], [ix - 0.05, 2.62, -0.13], [ix, 2.45, -0.12], [ix, 2.3, -0.14]], 0.034, COL.rubber, 9, 4);
    CY(b, ix, 2.18, -0.14, 0.024, 0.12, COL.brass, 5);
  }
  // 底下一排圆柱形保险丝（白瓷身、蓝/绿标签、黄铜端帽），装在黑色底板的夹座上
  P(b, -0.7, 0.1, -0.62, 1.7, 0.68, 0.05, 0x121513, 'noBottom');
  F(b, -0.7, 0.66, -0.5925, 1.4, 0.035, '+z', 0xcfcab4);
  for (let k = 0; k < 5; k++) {
    const fx = -1.3 + k * 0.27;
    P(b, fx, 0.24, -0.585, 0.05, 0.34, 0.02, 0x4c504a, ['pz', 'py']);
    CY(b, fx, 0.29, -0.545, 0.03, 0.22, 0xd8d0ba, 7);
    CY(b, fx, 0.37, -0.545, 0.0315, 0.07, k % 2 ? 0x2c8a4a : 0x2c55a0, 7, { caps: false });
    CY(b, fx, 0.495, -0.545, 0.034, 0.035, COL.brass, 7, { caps: false });
  }
  // 右边的接线端子排：导轨 + 一排彩色端子 + 往下走的细线
  P(b, 0.82, 0.1, -0.62, 1.0, 0.74, 0.05, 0x1a1d1b, 'noBottom');
  P(b, 0.82, 0.5, -0.588, 0.92, 0.035, 0.014, 0xa8aca8, ['pz', 'py', 'ny']);
  const TB = [0x8c908a, 0x2d4f96, 0x8c908a, 0x7a9a2a, 0x8c908a, 0x2d4f96, 0x9a2a22];
  for (let k = 0; k < 7; k++) {
    const mx = 0.44 + k * 0.126;
    P(b, mx, 0.43, -0.55, 0.11, 0.17, 0.062, TB[k], ['pz', 'py', 'px', 'nx']);
    if (k % 3 === 1) GF(b, mx, 0.575, -0.517, 0.018, 0.018, '+z', [0.3, 1.6, 0.4]);
    if (k % 2 === 0) P(b, mx - 0.02, 0.2, -0.54, 0.01, 0.23, 0.01, k % 4 ? 0x9a2a22 : 0x2d4f96, ['pz', 'px', 'nx']);
  }
  // 黄色高压警示牌（左前柱）
  P(b, -1.8, 1.72, -0.222, 0.2, 0.2, 0.012, 0xd8b31e, ['pz', 'px', 'nx', 'py', 'ny']);
  Q(b, [-1.79, 1.9, -0.2145], [-1.75, 1.9, -0.2145], [-1.8, 1.8, -0.2145], [-1.83, 1.8, -0.2145], 0x141414, [0, 0, 1]);
  Q(b, [-1.81, 1.81, -0.2145], [-1.77, 1.81, -0.2145], [-1.79, 1.74, -0.2145], [-1.8, 1.74, -0.2145], 0x141414, [0, 0, 1]);
  // 吊着的梯形罩日光灯：两根吊杆、白搪瓷灯罩（内外两面）、两根灯管
  const LX = 0.95, LZ = -0.66, x0 = LX - 0.46, x1 = LX + 0.46;
  for (const sx of [-0.33, 0.33]) P(b, LX + sx, 2.142, LZ, 0.012, 0.65, 0.012, 0x6e6e68, ['px', 'nx', 'pz', 'nz']);
  P(b, LX, 2.13, LZ, 0.92, 0.012, 0.12, 0xdedbd2, ['py', 'pz', 'nz', 'px', 'nx']);
  for (const sz of [-1, 1]) {
    const pa = [x0, 1.99, LZ + sz * 0.17], pb = [x1, 1.99, LZ + sz * 0.17], pc = [x1, 2.13, LZ + sz * 0.06], pd = [x0, 2.13, LZ + sz * 0.06];
    Q(b, pa, pb, pc, pd, 0xe6e3da, [0, 0.6, sz]);
    Q(b, pa, pb, pc, pd, 0xf4f2ec, [0, -0.6, -sz]);
  }
  for (const ex of [x0, x1]) {
    const pa = [ex, 1.99, LZ - 0.17], pb = [ex, 1.99, LZ + 0.17], pc = [ex, 2.13, LZ + 0.06], pd = [ex, 2.13, LZ - 0.06];
    Q(b, pa, pb, pc, pd, 0xe6e3da, [ex > LX ? 1 : -1, 0, 0]);
    Q(b, pa, pb, pc, pd, 0xf4f2ec, [ex > LX ? -1 : 1, 0, 0]);
  }
  const lb = [1.8, 1.72, 1.5];
  const t1 = GB(b, LX, 2.03, LZ - 0.05, 0.86, 0.024, 0.024, lb);
  const t2 = GB(b, LX, 2.03, LZ + 0.05, 0.86, 0.024, 0.024, lb);
  const lamp = b.light({ x: LX, z: LZ + 0.4, y: 1.85, color: 0xffeccc, intensity: o.lampOn === false ? 0 : 0.85, range: 6, flicker: o.heat ? 0.45 : 0 });
  if (o.lampOn === false) lamp.onIntensity = 0.85;
  b.linkGlow(t1, lamp, lb, 0.08); b.linkGlow(t2, lamp, lb, 0.08);
  // 通道地上一条黑橡胶绝缘垫
  P(b, 0, 0.004, 0.42, 3.8, 0.012, 0.64, 0x080908, 'noBottom');
  // 打火花（hazards「机械经常故障……曾数次自燃或爆炸」）：平时隐藏，区块动画里偶尔亮一下
  const spark = [
    GF(b, -0.75, 1.64, -0.19, 0.36, 0.02, '+z', [3, 2.6, 1.6]),
    GF(b, -0.75, 1.47, -0.188, 0.02, 0.36, '+z', [3, 2.6, 1.6]),
    Q(b, [-0.9, 1.52, -0.186], [-0.88, 1.5, -0.186], [-0.6, 1.78, -0.186], [-0.62, 1.8, -0.186], [2.6, 2.2, 1.2], [0, 0, 1], 'kit:glow'),
  ];
  for (const s of spark) s.setVisible(false);
  const pos = b.world(0, -0.3);
  b.solid(-2.0, 0, -1.36, 2.0, H, -0.2);
  b.pop();
  return { pos, spark, lamp };
}
// 打火花：计时只由区块坐标派生（不用 Math.random），离得近才闪白、出声；游玩/测试模式只给视听提示
function sparkUpdate(b, gen, k) {
  let t = 4 + (U.hashInts(b.cx, b.cz, k, 7) % 11), on = 0;
  b.update(dt => {
    if (on > 0) { on -= dt; if (on <= 0) for (const s of gen.spark) s.setVisible(false); }
    t -= dt;
    if (t > 0) return;
    t = 13 + (U.hashInts(b.cx, b.cz, k, Math.floor(t * 10)) % 7);
    const P0 = BR.player, d2 = U.dist2(P0.x, P0.z, gen.pos.x, gen.pos.z);
    if (d2 > 14 * 14) return;
    for (const s of gen.spark) s.setVisible(true);
    on = 0.16;
    if (d2 < 8 * 8) BR.audio.play('static', gen.pos, { volume: 0.5 });
    if (d2 < 4 * 4) BR.gfx.flash(0xfff4c2, 0.12, 0.3);
    if (d2 < 2.4 * 2.4 && BR.game.attackPlayers) {
      BR.player.damage({ hp: 18, sanity: 6, source: 'hazard:generator' });
      BR.hud.toast('机器猛地炸出一团火花！', 1600);
    }
  });
}

// ---------- 白漆方格铁栅门（参考图 L3-通道.jpg）----------
// 本地坐标：门洞横跨 x ∈ [−1.2, 1.2]（整条通道宽），门面在 z = 0，正面朝 +Z（路口一侧）；两扇门都向 −Z 推开靠墙
function gate(b, x, z, rot, o) {
  const r = o.rng;
  const paint = () => { const q = r(); return q < 0.72 ? tint(COL.white, 0.9 + r() * 0.1) : q < 0.9 ? tint(0xcdc4b2, 0.95) : tint(0xa88e76, 1); };
  b.push(x, z, rot);
  for (const sx of [-1, 1]) {
    P(b, sx * 1.16, 0, 0, 0.07, 2.36, 0.07, paint(), 'sides');
    b.solid(sx * 1.16 - 0.035, 0, -0.035, sx * 1.16 + 0.035, 2.36, 0.035);
  }
  P(b, 0, 2.36, 0, 2.39, 0.07, 0.07, paint(), ['py', 'ny', 'pz', 'nz']);
  // 门楣上方到顶的固定栅格
  for (let k = 0; k < 11; k++) P(b, -1.0 + k * 0.2, 2.43, 0, 0.022, 0.365, 0.012, paint(), ['pz', 'nz']);
  P(b, 0, 2.72, 0, 2.39, 0.03, 0.018, paint(), ['pz', 'nz', 'ny']);
  leaf(b, -1.12, 1.25 + r() * 0.22, 1, paint, r, true);
  leaf(b, 1.12, -(1.0 + r() * 0.35), -1, paint, r, false);
  if (o.sign) {
    // 黑底黄字 "OUT OF BOUNDS"：挂在门楣上方的栅格正面
    P(b, 0, 2.415, 0.0205, 0.62, 0.3, 0.015, 0x121210, ['pz', 'px', 'nx', 'py', 'ny']);
    const yc = [0.86, 0.72, 0.18];
    F(b, 0, 2.43, 0.0295, 0.58, 0.012, '+z', yc); F(b, 0, 2.689, 0.0295, 0.58, 0.012, '+z', yc);
    F(b, -0.284, 2.442, 0.0295, 0.012, 0.247, '+z', yc); F(b, 0.284, 2.442, 0.0295, 0.012, 0.247, '+z', yc);
    const px = 0.02;
    pixText(b, 'OUT OF', -textWidth('OUT OF', px) / 2, 2.672, 0.0295, px, yc);
    pixText(b, 'BOUNDS', -textWidth('BOUNDS', px) / 2, 2.552, 0.0295, px, yc);
  }
  b.pop();
}
// 一扇门：hx 是合页位置，rot 是开门角（绕合页），dir = 1 门扇朝本地 +x 伸出、−1 朝 −x
function leaf(b, hx, rot, dir, paint, r, lock) {
  const LW = 1.06, y0 = 0.05, LH = 2.22;
  b.push(hx, 0, rot);
  const X = t => dir * (0.035 + t);
  P(b, X(0.0225), y0, 0, 0.045, LH, 0.03, paint(), 'sides');
  P(b, X(LW - 0.0225), y0, 0, 0.045, LH, 0.03, paint(), 'sides');
  for (const ry of [y0, y0 + 1.05, y0 + LH - 0.045]) P(b, X(LW / 2), ry, 0, LW - 0.09, 0.045, 0.03, paint(), ['py', 'ny', 'pz', 'nz']);
  for (let k = 1; k <= 9; k++) P(b, X(0.045 + k * 0.097), y0 + 0.045, 0, 0.026, LH - 0.09, 0.012, paint(), ['pz', 'nz']);
  for (const yy of [0.33, 0.6, 0.86, 1.36, 1.62, 1.88]) P(b, X(LW / 2), yy, 0, LW - 0.09, 0.026, 0.018, paint(), ['pz', 'nz']);
  // 掉漆露锈：竖边框正反面各一两块
  for (let k = 0; k < 3; k++) {
    const yy = 0.2 + r() * 1.7, hh = 0.08 + r() * 0.25, t = r() < 0.5 ? 0.0225 : LW - 0.0225;
    F(b, X(t), yy, 0.0175, 0.036, hh, '+z', tint(COL.rust, 0.8 + r() * 0.4));
    F(b, X(t), yy + 0.1, -0.0175, 0.036, hh * 0.7, '-z', tint(COL.rust, 0.8 + r() * 0.4));
  }
  for (const hy of [0.3, 2.0]) CY(b, X(0), hy, 0, 0.018, 0.12, 0x8a8880, 6, { caps: false });
  P(b, X(LW - 0.01), 0.97, 0, 0.05, 0.06, 0.05, 0x6a6a64);
  for (const sz of [1, -1]) P(b, X(LW - 0.12), 0.92, sz * 0.03, 0.02, 0.16, 0.02, 0x55554f, ['px', 'nx', 'pz', 'nz', 'py']);
  if (lock) {   // 打开的挂锁挂在门闩上
    P(b, X(LW + 0.02), 0.86, 0.035, 0.045, 0.055, 0.02, COL.brass);
    P(b, X(LW + 0.02), 0.915, 0.035, 0.03, 0.04, 0.008, 0x9a9a92, ['pz', 'nz', 'px', 'nx']);
  }
  b.pop();
}

// ---------- 锈迹斑斑的监狱栅栏（东西向通道被挡的那一段）----------
function bars(b, x, z, rot, r) {
  b.push(x, z, rot);
  for (let k = 0; k < 19; k++) CY(b, -1.08 + k * 0.12, 0, 0, 0.022, H - 0.004, tint(COL.rust, 0.7 + r() * 0.5), 6, { caps: false });
  for (const yy of [0.12, 1.1, 2.1]) P(b, 0, yy, 0, 2.396, 0.05, 0.06, tint(0x5a3a26, 0.8 + r() * 0.4), ['py', 'ny', 'pz', 'nz']);
  P(b, 0, 0, 0, 2.396, 0.06, 0.1, 0x3e2c20, ['py', 'pz', 'nz']);
  b.pop();
}

// ---------- 墙上/凹间里的小物件（都细化过，但控制面数）----------
// 墙挂配电箱：箱体、门缝、合页、黄标签、往天花板走的线管和管卡
function junctionBox(b, x, z, rot) {
  b.push(x, z, rot);
  P(b, 0, 1.2, 0.07, 0.36, 0.46, 0.14, 0x565c55, ['pz', 'px', 'nx', 'py', 'ny']);
  F(b, 0.16, 1.22, 0.1415, 0.006, 0.42, '+z', 0x3e423d);
  for (const hy of [1.28, 1.56]) CY(b, -0.185, hy, 0.13, 0.012, 0.06, 0x5e625c, 6, { caps: false });
  F(b, -0.02, 1.52, 0.1415, 0.14, 0.06, '+z', 0xd4b022);
  P(b, 0.13, 1.38, 0.15, 0.03, 0.07, 0.02, 0x4a4e48, ['pz', 'px', 'nx', 'py']);
  CY(b, 0.08, 1.66, 0.06, 0.02, H - 1.665, 0x8a8e88, 6, { caps: false });
  for (const hy of [2.0, 2.5]) P(b, 0.08, hy, 0.045, 0.06, 0.025, 0.05, 0x6e726c, ['pz', 'px', 'nx', 'py', 'ny']);
  b.pop();
}
// 油桶：桶身、两道加强箍、桶盖边、注油口；lie 为真时横躺
function drum(b, x, z, color, lie) {
  if (lie) {
    b.push(x, z, 0);
    CY(b, 0, 0.29, 0, 0.29, 0.88, color, 12, { axis: 'x' });
    for (const sx of [-0.2, 0.2]) CY(b, sx, 0.29, 0, 0.296, 0.025, tint(color, 0.8), 12, { axis: 'x', caps: false });
    b.solid(-0.44, 0, -0.29, 0.44, 0.58, 0.29);
    b.pop();
    return;
  }
  CY(b, x, 0, z, 0.29, 0.88, color, 12, { solid: true });
  for (const hy of [0.28, 0.6]) CY(b, x, hy, z, 0.296, 0.025, tint(color, 0.8), 12, { caps: false });
  CY(b, x, 0.86, z, 0.295, 0.028, tint(color, 0.7), 12, { caps: false });
  CY(b, x + 0.14, 0.883, z - 0.08, 0.03, 0.012, 0x3a3a36, 6);   // 注油口，离桶盖 3 mm
}
// 凹间里的杂物：kind 'drums' 油桶和漏出来的黑色粘液 | 'shelf' 钢货架 | 'breaker' 大配电盘
function recessDecor(b, S, kind, r) {
  b.push(S.bx, S.bz, S.rot);    // 本地：后墙在 z = 0，通道方向 +Z，凹间宽 x ∈ [−1.4, 1.4]
  if (kind === 'drums') {
    drum(b, -0.8, 0.45, tint(0x2f4a6a, 0.8 + r() * 0.3), false);
    drum(b, -0.1, 0.4, tint(0x7a3a24, 0.8 + r() * 0.3), false);
    drum(b, 0.55, 1.3, tint(0x8e7422, 0.8 + r() * 0.3), true);
    kit.prop.puddle(b, 0.3, 1.0, 0.4, { rx: 0.7, rz: 0.45, color: [0.03, 0.026, 0.02] });   // materials「管道里流着黑色粘稠液体」
  } else if (kind === 'shelf') {
    const SW = 1.9, SD = 0.5, SH = 1.9;
    for (const sx of [-1, 1]) for (const sz of [0.06, SD]) P(b, sx * SW / 2, 0, sz, 0.04, SH, 0.04, 0x5a6066, 'sides');
    for (const sy of [0.1, 0.72, 1.32, SH - 0.02]) {
      P(b, 0, sy, SD / 2 + 0.03, SW, 0.02, SD, 0x6c7278, 'all');
      P(b, 0, sy - 0.05, SD + 0.03, SW, 0.05, 0.012, 0x4a5056, ['pz', 'ny']);
    }
    b.solid(-SW / 2, 0, 0, SW / 2, SH, SD + 0.05);
    b.push(-0.5, 0.3, 0.2 * r(), 0.123); kit.prop.box(b, 0, 0, 0, { stack: 1, solid: false }); b.pop();   // 底层纸箱（抬到隔板面上 3 mm）
    for (let k = 0; k < 5; k++) CY(b, 0.15 + k * 0.14, 0.743, 0.25 + (k % 2) * 0.12, 0.05, 0.16, tint(0x6e5a3a, 0.7 + r() * 0.5), 6);
    b.push(0.5, 0.3, 0.3 * r(), 1.343); kit.prop.box(b, 0, 0, 0, { stack: 1, solid: false }); b.pop();
    for (let k = 0; k < 3; k++) CY(b, -0.6 + k * 0.2, 1.343, 0.28, 0.07, 0.1, 0x4a4e52, 8);
  } else if (kind === 'breaker') {
    P(b, 0, 0.6, 0.1, 1.2, 1.3, 0.2, 0x6f746e, ['pz', 'px', 'nx', 'py', 'ny']);
    F(b, 0, 0.66, 0.2015, 1.1, 1.18, '+z', 0x3a3e3a);
    for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
      const up = r() < 0.8;
      P(b, -0.4 + k * 0.16, 1.45 - row * 0.4, 0.203, 0.05, 0.1, 0.03, 0x1c1e1c, ['pz', 'py']);
      P(b, -0.4 + k * 0.16, up ? 1.51 - row * 0.4 : 1.45 - row * 0.4, 0.233, 0.02, 0.04, 0.02, up ? 0xdedcd2 : 0xa02a20, ['pz', 'py']);
    }
    F(b, 0, 1.78, 0.2035, 0.5, 0.06, '+z', 0xd4b022);
    for (const sx of [-0.4, 0, 0.4]) CY(b, sx, 1.9, 0.08, 0.028, H - 1.905, 0x8a8e88, 6, { caps: false });
    b.solid(-0.6, 0, 0, 0.6, 1.9, 0.2);
  }
  b.pop();
}
// 墙上的铁笼防爆灯（凹间出口上方），同时给一盏小灯描述
function bulkhead(b, x, z, rot, y) {
  b.push(x, z, rot);
  P(b, 0, y - 0.1, 0.05, 0.2, 0.2, 0.1, 0x3a3e3a, ['pz', 'px', 'nx', 'py', 'ny']);
  const lb = [1.7, 1.5, 1.0];
  const glass = b.cylinder(0, y, 0.133, 0.065, 0.06, 'kit:glow', { color: lb, segments: 8, axis: 'z', uv: 'solid', solid: false });   // 离灯座正面 3 mm
  P(b, 0, y - 0.006, 0.166, 0.15, 0.012, 0.012, 0x2a2c2a, ['pz', 'px', 'nx', 'py', 'ny']);     // 灯罩上的十字铁笼（两根错开 3 mm）
  P(b, 0, y - 0.075, 0.169, 0.012, 0.15, 0.012, 0x2a2c2a, ['pz', 'px', 'nx', 'py', 'ny']);
  const src = b.light({ x: 0, z: 0.5, y: y - 0.1, color: 0xffe2b0, intensity: 0.7, range: 4.5 });
  b.linkGlow(glass, src, lb, 0.1);
  b.pop();
}
// 电力房值班桌：铁皮桌（桌面封边、四条腿、三格抽屉带拉手）、CRT 显示器（机身、后壳、绿屏、边框）、键盘，桌前一只铁凳
// 本地：桌子靠后墙（−Z），人坐在 +Z 一侧
function consoleDesk(b, x, z, rot) {
  b.push(x, z, rot);
  P(b, 0, 0.72, 0, 1.3, 0.03, 0.66, 0x55585a);
  P(b, 0, 0.705, 0.332, 1.3, 0.03, 0.006, 0x2a2c2c, ['pz', 'ny']);
  for (const sx of [-0.61, 0.61]) for (const sz of [-0.29, 0.29]) P(b, sx, 0, sz, 0.035, 0.72, 0.035, 0x3a3c3c, 'sides');
  P(b, 0.42, 0.1, 0, 0.4, 0.62, 0.6, 0x4a4e50, 'noBottom');
  for (let k = 0; k < 3; k++) {
    F(b, 0.42, 0.13 + k * 0.2, 0.3015, 0.37, 0.17, '+z', 0x5a5e60);
    P(b, 0.42, 0.25 + k * 0.2, 0.305, 0.12, 0.018, 0.016, 0x2a2c2c, ['pz', 'py', 'ny']);
  }
  P(b, -0.2, 0.753, -0.08, 0.4, 0.36, 0.36, 0xbdb6a2, ['pz', 'nz', 'py', 'px', 'nx']);   // 抬离桌面 3 mm，不画底面
  P(b, -0.2, 0.8, -0.34, 0.28, 0.26, 0.16, 0xb0a994, ['nz', 'py', 'ny', 'px', 'nx']);
  F(b, -0.2, 0.8, 0.1015, 0.36, 0.28, '+z', 0x8e887a);
  GF(b, -0.2, 0.83, 0.1035, 0.29, 0.22, '+z', [0.14, 0.42, 0.18]);
  P(b, -0.2, 0.75, 0.24, 0.42, 0.022, 0.15, 0xc4bca8, 'noBottom');
  F(b, -0.2, 0.7725, 0.245, 0.4, 0.11, 'up', 0x8a8474);
  b.solid(-0.65, 0, -0.33, 0.65, 0.75, 0.33);
  // 铁凳
  CY(b, -0.2, 0.46, 0.75, 0.17, 0.04, 0x3a3c3c, 8);
  for (const [dx, dz] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) P(b, -0.2 + dx, 0, 0.75 + dz, 0.025, 0.46, 0.025, 0x2e3030, 'sides');
  P(b, -0.2, 0.18, 0.75, 0.25, 0.02, 0.02, 0x2e3030, ['pz', 'nz', 'py']);
  b.pop();
}
// 汽车（exits[2]「坐到电力房中汽车的前座会失去知觉，随后在 Level 69 醒来」；原文没写车型，取普通旧轿车）
// 本地：车头朝 +Z，驾驶座在左手（+X）一侧
function car(b, x, z, rot) {
  const BODY = 0x4a1512, GLASS = 0x0b1013, CHROME = 0x6a6c6a;
  b.push(x, z, rot);
  b.box(0, 0.3, 0, 1.76, 0.52, 4.3, 'kit:prop', { color: BODY, uv: 'stretch', solid: true, faces: 'noBottom' });
  P(b, 0, 0.14, 0, 1.64, 0.16, 3.9, 0x121212, 'sides');
  const yb = 0.82, yt = 1.3, wb = 0.8, wt = 0.68, zf0 = 0.95, zf1 = 0.3, zr0 = -1.5, zr1 = -1.0;
  Q(b, [-wt, yt, zf1], [wt, yt, zf1], [wt, yt, zr1], [-wt, yt, zr1], BODY, [0, 1, 0]);
  Q(b, [-wb, yb, zf0], [wb, yb, zf0], [wt, yt, zf1], [-wt, yt, zf1], GLASS, [0, 0.6, 0.8]);
  Q(b, [-wb, yb, zr0], [wb, yb, zr0], [wt, yt, zr1], [-wt, yt, zr1], GLASS, [0, 0.6, -0.8]);
  for (const sx of [-1, 1]) {
    Q(b, [sx * wb, yb, zf0], [sx * wb, yb, zr0], [sx * wt, yt, zr1], [sx * wt, yt, zf1], GLASS, [sx, 0.2, 0]);
    Q(b, [sx * (wb + 0.006), yb, -0.3], [sx * (wb + 0.006), yb, -0.4], [sx * (wt + 0.006), yt, -0.4], [sx * (wt + 0.006), yt, -0.3], BODY, [sx, 0.2, 0]);   // B 柱：贴在侧窗外 6 mm
    for (const sz of [-1.38, 1.38]) {
      CY(b, sx * 0.8, 0.33, sz, 0.33, 0.22, 0x111111, 9, { axis: 'x' });
      CY(b, sx * 0.915, 0.33, sz, 0.17, 0.012, CHROME, 6, { axis: 'x' });
    }
    F(b, sx * 0.8835, 0.36, 0.95, 0.008, 0.44, sx > 0 ? '+x' : '-x', 0x2a0e0c);
    F(b, sx * 0.8835, 0.36, -0.35, 0.008, 0.44, sx > 0 ? '+x' : '-x', 0x2a0e0c);
    P(b, sx * 0.9, 0.66, 0.55, 0.03, 0.025, 0.12, CHROME, ['px', 'nx', 'py', 'pz', 'nz']);
    P(b, sx * 0.94, 0.86, 0.85, 0.12, 0.08, 0.05, BODY);
  }
  P(b, 0, 0.28, 2.19, 1.8, 0.16, 0.1, CHROME);
  P(b, 0, 0.28, -2.19, 1.8, 0.16, 0.1, CHROME);
  F(b, 0, 0.5, 2.153, 0.7, 0.18, '+z', 0x161616);
  for (const sx of [-0.6, 0.6]) {
    GF(b, sx, 0.58, 2.153, 0.3, 0.12, '+z', [0.32, 0.3, 0.26]);
    GF(b, sx, 0.6, -2.153, 0.28, 0.1, '-z', [0.45, 0.05, 0.04]);
  }
  F(b, 0, 0.3, 2.243, 0.36, 0.11, '+z', 0xd8d4c4);
  F(b, 0, 0.3, -2.243, 0.36, 0.11, '-z', 0xd8d4c4);
  b.pop();
}

// ---------- 区块 ----------
// 主 rng 只决定"大结构"（区块变体、出口、灯的状态），顺序固定；道具配色等小变化用本块的派生流（U.rng(levelSeed, cx, cz, 用途)）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const seed = b.seed;
  const R = tag => U.rng(seed, cx, cz, 'L3-' + tag);
  const isSpawn = cx === 0 && cz === 0;
  const px = mod(cx, EXIT_PERIOD), pz = mod(cz, EXIT_PERIOD);
  const at = k => px === EXIT_AT[k][0] && pz === EXIT_AT[k][1];

  // 1) 区块变体（先无条件取数）
  //    'heat'：temperature「某些地带温度会突然升到难以忍受」；'lonelight'：lighting「另一张更暗的走廊由一个不寻常的荧光灯照亮」
  const rKind = rng(), rBoiler = rng(), rLone = rng();
  const kind = isSpawn ? 'normal' : rKind < 0.08 ? 'heat' : rKind < 0.16 ? 'lonelight' : 'normal';
  const E = segState(seed, cx, cz), W = segState(seed, cx - 1, cz);
  b.data.kind = kind;
  b.data.bars = [];

  // 2) 这块用到哪些凹间/房间
  const use = {};                               // slot 名 → 内容
  if (isSpawn) use.sw = 'spawnDoor';
  if (at('elev4')) use.sw = 'elev4';
  if (at('elev5')) use.se = 'elev5';
  if (at('door31')) use.en = 'door31';
  const hasCar = at('car69');
  const exitChunk = hasCar || at('elev4') || at('elev5') || at('door31');
  // hazards「装有锅炉的电力房……相关区域都已封锁」：约 7% 的普通区块南臂墙上一扇锁死的锅炉房铁门
  if (!isSpawn && !exitChunk && rBoiler < 0.07) use[rBoiler < 0.035 ? 'sw' : 'se'] = 'boiler';
  const rd = R('decor');
  let nDecor = 0;
  for (const k of ['sw', 'se', 'en', 'es']) {
    const q = rd();
    if (use[k] || hasCar || nDecor >= 2) continue;
    if ((k === 'en' || k === 'es') && E === 'wall') continue;
    if (q < 0.14) use[k] = 'drums';
    else if (q < 0.25) use[k] = 'shelf';
    else if (q < 0.34) use[k] = 'breaker';
    if (use[k]) nDecor++;
  }

  // 3) 空地 → 实心块、墙面
  const free = [{ x0: A0, x1: A1, z0: 0, z1: SIZE }];                         // 南北通道（永远不断）
  if (W !== 'wall') free.push({ x0: 0, x1: A0, z0: A0, z1: A1 });              // 西臂
  if (E !== 'wall') free.push({ x0: A1, x1: SIZE, z0: A0, z1: A1 });           // 东臂
  free.push({ x0: A1, x1: A1 + BAY_D, z0: BAY_A, z1: BAY_B });                 // 北臂东墙发电机凹间
  if (W !== 'wall') free.push({ x0: BAY_A, x1: BAY_B, z0: A0 - BAY_D, z1: A0 });  // 西臂北墙发电机凹间
  for (const k in use) free.push(SLOTS[k]);
  if (hasCar) { free.push(ROOM); free.push(ROOM_DOOR); }
  const walls = buildWalls(b, solidRects(free));
  kit.prop.floor(b, null, null, 0, { matKey: 'L3:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L3:ceil', y: H });

  // 4) 通道灯管：每 4 m 一根，挂在通道中线；灯的状态吃主 rng（固定 12 次）
  //    lighting「走廊长而黑暗」→ 约两成坏灯、一成闪；lonelight 变体整块只亮一根偏冷白的灯管（发电机吊灯也不亮）
  const LN = [2, 6, 10.2], LS = [14.4, 18.4, 22.2];
  const spots = [];
  for (const z of LN.concat(LS)) spots.push({ x: C, z, along: 'z', ok: true });
  for (const x of LN) spots.push({ x, z: C, along: 'x', ok: W !== 'wall' });
  for (const x of LS) spots.push({ x, z: C, along: 'x', ok: E !== 'wall' });
  const lone = Math.floor(rLone * spots.length);
  const rl = R('flicker');
  for (let k = 0; k < spots.length; k++) {
    const q = rng(), fl = 0.3 + rl() * 0.5;
    let state = q < 0.2 ? 'broken' : q < 0.3 ? 'flicker' : 'on';
    if (isSpawn) state = 'on';
    if (kind === 'lonelight') state = k === lone ? 'on' : 'broken';
    if (spots[k].ok) tubeLight(b, spots[k].x, spots[k].z, spots[k].along, state, fl, kind === 'lonelight');
  }

  // 5) 发电机（每条通道每 24 m 一台）＋ 铁栅门（每段通道靠路口一头一扇）
  const gens = [];
  const gOpt = tag => ({ rng: R(tag), heat: kind === 'heat', lampOn: kind !== 'lonelight' });
  gens.push(generator(b, A1, (BAY_A + BAY_B) / 2, -Math.PI / 2, gOpt('gen0')));
  if (W !== 'wall') gens.push(generator(b, (BAY_A + BAY_B) / 2, A0, 0, gOpt('gen1')));
  gens.forEach((g, k) => sparkUpdate(b, g, k));
  b.data.gens = gens.map(g => g.pos);
  const rg = R('gate');
  const signN = rg() < 0.6 || isSpawn;
  gate(b, C, GATE_AT, 0, { rng: rg, sign: signN });
  if (W !== 'wall') gate(b, GATE_AT, C, Math.PI / 2, { rng: rg, sign: !signN && rg() < 0.5 });

  // 6) 被挡住的东西向通道：锈栅栏画在西边那块（交界处往西 0.1 m），两边都放碰撞体
  if (E === 'bars') {
    bars(b, SIZE - 0.1, C, Math.PI / 2, R('bars'));
    b.solid(SIZE - 0.16, 0, A0, SIZE, H, A1);
    b.data.bars.push(b.world(SIZE - 0.1, C));
  }
  if (W === 'bars') { b.solid(0, 0, A0, 0.06, H, A1); b.data.bars.push(b.world(0, C)); }

  // 7) 管线：南北通道西墙一对铜管（materials「铜质管道」，带法兰接头、阀门、墙托），东西通道南墙一条电缆桥架
  const rp = R('pipes');
  const PX1 = A0 + 0.13, PX2 = A0 + 0.3;
  CY(b, PX1, 2.55, C, 0.055, SIZE - 0.004, tint(COL.copper, 0.72), 8, { axis: 'z', caps: false });
  CY(b, PX2, 2.52, C, 0.035, SIZE - 0.004, tint(COL.copper, 0.85), 8, { axis: 'z', caps: false });
  for (const zc of [3, 9, 15, 21]) CY(b, PX1, 2.55, zc, 0.07, 0.07, tint(COL.copper, 0.55), 8, { axis: 'z', caps: false });
  for (let zb = 1.2; zb < SIZE; zb += 2.4) {
    const hasWall = walls.some(w => w.facing === '+x' && eq(w.at, A0) && zb > w.a + 0.1 && zb < w.b - 0.1);
    if (!hasWall) continue;
    P(b, A0 + 0.2, 2.44, zb, 0.4, 0.03, 0.04, 0x5a5e5a, ['py', 'ny', 'pz', 'nz', 'px']);
    P(b, A0 + 0.012, 2.36, zb, 0.024, 0.14, 0.06, 0x5a5e5a, ['px', 'pz', 'nz']);
  }
  // 阀门：闸阀阀体 + 阀杆 + 红色手轮
  const vz = 19.5;
  P(b, PX2, 2.44, vz, 0.1, 0.16, 0.14, tint(COL.copper, 0.6));
  CY(b, PX2, 2.6, vz, 0.012, 0.1, 0x777, 6, { caps: false });
  CY(b, PX2, 2.7, vz, 0.085, 0.018, 0x9a2a1e, 10);
  // 漏点：接头下面墙上一道黑色流痕、地上一滩黑色粘液（landmarks「墙角管道流动黑色粘稠液体」）
  const leak = rp();
  if (leak < 0.45) {
    const lz = leak < 0.22 ? 18 : 21;
    if (walls.some(w => w.facing === '+x' && eq(w.at, A0) && lz > w.a + 0.1 && lz < w.b - 0.1)) {   // 流痕只画在有墙的地方
      F(b, A0 + 0.003, 0.02, lz, 0.06, 2.4, '+x', 0x100c08);
      F(b, A0 + 0.0045, 0.02, lz + 0.03, 0.025, 1.6, '+x', 0x1a120a);
    }
    kit.prop.puddle(b, A0 + 0.45, lz, 0, { rx: 0.45, rz: 0.6, color: [0.03, 0.026, 0.02] });
  }
  const tx0 = W === 'wall' ? A0 : 0, tx1 = E === 'wall' ? A1 : SIZE, TL = tx1 - tx0, TX = (tx0 + tx1) / 2, TZ = A1 - 0.25;
  P(b, TX, 2.63, TZ, TL - 0.004, 0.008, 0.3, 0x80847f, ['py', 'ny']);
  for (const sz of [-0.15, 0.15]) P(b, TX, 2.63, TZ + sz, TL - 0.004, 0.06, 0.008, 0x80847f, ['pz', 'nz', 'py']);
  for (const [cz0, cc] of [[-0.08, 0x1c1c1c], [0, 0x2a2622], [0.08, 0x3a1e18]]) CY(b, TX, 2.66, TZ + cz0, 0.022, TL - 0.004, cc, 6, { axis: 'x', caps: false });
  for (let xh = tx0 + 2.4; xh < tx1 - 0.5; xh += 4.8) {
    if (xh > A0 - 0.3 && xh < A1 + 0.3) continue;
    for (const sz of [-0.17, 0.17]) P(b, xh, 2.69, TZ + sz, 0.012, 0.105, 0.012, 0x6a6e6a, ['px', 'nx', 'pz', 'nz']);
    P(b, xh, 2.612, TZ, 0.04, 0.016, 0.38, 0x6a6e6a);
  }

  // 8) 地漏 + 积水；墙根的霉斑（hazards「爬菌在此生长」；只做外观）
  const rf = R('floor');
  b.plane(A0 + 0.45, 0.003, 14.6, 0.3, 0.3, 'kit:prop', { facing: 'up', color: 0x0c0d0c, uv: 'stretch' });
  for (let k = 0; k < 5; k++) P(b, A0 + 0.45, 0.003, 14.48 + k * 0.06, 0.28, 0.008, 0.022, 0x3a3c38, ['py']);
  if (rf() < 0.6) kit.prop.puddle(b, A0 + 0.75 + rf() * 0.4, 14.9, rf() * 3, { rx: 0.6 + rf() * 0.4, rz: 0.4 + rf() * 0.3, color: [0.035, 0.045, 0.04] });
  else { rf(); rf(); rf(); rf(); }
  const rm = R('mold');
  for (let k = 0; k < 4 && walls.length; k++) {
    const w = walls[Math.floor(rm() * walls.length)];
    const len = w.b - w.a;
    if (len < 1.2) { rm(); rm(); continue; }
    const m = w.a + 0.4 + rm() * (len - 0.8), spread = 0.25 + rm() * 0.35;
    const sgn = w.facing === '+x' || w.facing === '+z' ? 1 : -1;
    const xAxis = w.facing === '-x' || w.facing === '+x';
    for (let q = 0; q < 6; q++) {   // 一簇大小不一的深绿黑斑点，贴墙根往上长，每片离墙错开 2 mm（6–16 mm，避开 3/4.5 mm 的管道流痕）
      const u = m + (rm() - 0.5) * spread * 2, sz = 0.04 + rm() * 0.12, yy = rm() * 0.35 * (1 - Math.abs(u - m) / (spread + 0.01));
      const off = sgn * (0.006 + q * 0.002);
      b.plane(xAxis ? w.at + off : u, yy, xAxis ? u : w.at + off, sz, sz * (0.6 + rm() * 0.6), 'kit:prop', { facing: w.facing, color: q % 2 ? 0x070b05 : 0x0e1509, uv: 'stretch' });
    }
  }
  if (E !== 'wall' && !hasCar) junctionBox(b, 15.4, A0, 0);

  // 9) 凹间内容与出口
  let boilerWorld = null;
  const rs = R('slots');
  for (const k of ['sw', 'se', 'en', 'es']) {
    const what = use[k];
    if (!what) continue;
    const S = SLOTS[k];
    if (what === 'elev4' || what === 'elev5') {
      // exits[0]「搭乘电梯通常前往 Level 4 或 5」：电梯厅凹间，后墙一部电梯，上方铁笼灯 + 楼层号
      const to = what === 'elev4' ? '4' : '5';
      b.push(S.bx, S.bz, S.rot);
      kit.exit(b, { to, kind: 'elevator', x: 0, z: 0.12, rot: 0 });
      P(b, 0, 2.52, 0.03, 0.2, 0.2, 0.06, 0x1a1a18, ['pz', 'px', 'nx', 'py', 'ny']);
      pixText(b, to, -textWidth(to, 0.02) / 2, 2.67, 0.0615, 0.02, [1.6, 0.8, 0.2], 'kit:glow');
      bulkhead(b, 0.95, 0, 0, 2.4);
      b.pop();
    } else if (what === 'door31') {
      // exits[1]「木门通向 Level 31」：不在首期范围，kit 自动 sealed（只提示"尚未开放"）
      b.push(S.bx, S.bz, S.rot);
      kit.exit(b, { to: '31', kind: 'door', x: 0, z: 0.09, rot: 0, style: 'wood' });
      bulkhead(b, 0.9, 0, 0, 2.3);
      b.pop();
    } else if (what === 'boiler') {
      // 锁死的锅炉电力房铁门：门上红灯、门框黄黑警示条、门边压力表；靠近有热浪（hazards 段落）
      b.push(S.bx, S.bz, S.rot);
      kit.prop.door(b, 0, 0.09, 0, { style: 'metal', open: 0, sign: 0xff5030 });
      for (let k2 = 0; k2 < 6; k2++) Q(b, [-0.6, 0.3 + k2 * 0.33, 0.004], [-0.52, 0.3 + k2 * 0.33, 0.004], [-0.52, 0.44 + k2 * 0.33, 0.004], [-0.6, 0.38 + k2 * 0.33, 0.004], 0xc9a21c, [0, 0, 1]);
      CY(b, 0.8, 1.5, 0.03, 0.08, 0.05, 0x1a1a1a, 10, { axis: 'z' });
      CY(b, 0.8, 1.5, 0.0575, 0.066, 0.004, 0xe4ddc8, 10, { axis: 'z' });
      Q(b, [0.8, 1.495, 0.0605], [0.85, 1.52, 0.0605], [0.848, 1.525, 0.0605], [0.798, 1.5, 0.0605], 0xa01e18, [0, 0, 1]);
      boilerWorld = b.world(0, 0.6);
      b.data.boilerDoor = boilerWorld;
      b.pop();
    } else if (what === 'spawnDoor') {
      // entrances「Level 2 中未上锁的门通常通向 Level 3」：出生点旁一扇虚掩的木门当来路，门后一片漆黑，纯装饰
      b.push(S.bx, S.bz, S.rot);
      GF(b, 0, 0, 0.004, 0.9, 2.05, '+z', 0);
      kit.prop.door(b, 0, 0.09, Math.PI, { style: 'wood', open: 0.28, solid: false });
      b.pop();
    } else {
      recessDecor(b, S, what, rs);
    }
  }

  // 10) 汽车电力房（exits[2]）：昏暗，只有一根闪烁灯管；汽车、断路器配电盘、电脑、监视器、松动的电线
  if (hasCar) {
    const rc = R('car');
    tubeLight(b, 18.6, 17.4, 'x', 'flicker', 0.55);
    car(b, 18.8, 20.2, Math.PI / 2);
    b.push(18.8, 20.2, Math.PI / 2);
    kit.exit(b, { x: 1.3, z: 0.3, kind: 'zone', to: '69', radius: 1.0, label: '坐进驾驶座', marker: { color: [1, 0.6, 0.3] } });
    b.pop();
    consoleDesk(b, 21.0, 16.45, 0);                                              // 「电脑」：旧铁桌 + CRT 显示器 + 铁凳
    // 「安全摄像监视器」：墙角铁架上一台小监视器，暗绿色雪花屏
    P(b, 21.7, 0, 22.7, 0.5, 1.1, 0.4, 0x3a3e3c, 'noBottom');
    P(b, 21.7, 1.103, 22.72, 0.4, 0.34, 0.36, 0x2a2c2a, ['pz', 'nz', 'py', 'px', 'nx']);
    GF(b, 21.7, 1.15, 22.901, 0.32, 0.24, '+z', [0.12, 0.3, 0.14]);
    b.solid(21.45, 0, 22.5, 21.95, 1.44, 22.9);
    recessDecor(b, { bx: ROOM.x0, bz: 21.2, rot: Math.PI / 2 }, 'breaker', rc);  // 「断路器盒」
    for (let k = 0; k < 2; k++) {                                                 // 「松动的电线」：从天花板垂下来的几根
      const wx = 17.0 + k * 2.4, wz = 17.2 + rc() * 0.8, dy = 0.9 + rc() * 0.8;
      cable(b, [[wx, H - 0.01, wz], [wx + 0.1, H - dy * 0.5, wz + 0.1], [wx + 0.25, H - dy, wz + 0.05], [wx + 0.3, H - dy - 0.15, wz + 0.2]], 0.012, 0x1a1a1a, 6, 4);
    }
  }

  // 11) 区块动画：锅炉门热浪
  if (boilerWorld) {
    let wasNear = false;
    b.update(dt => {
      const P0 = BR.player, near = U.dist2(P0.x, P0.z, boilerWorld.x, boilerWorld.z) < 1.4 * 1.4;
      if (near && !wasNear) {
        BR.hud.toast('门缝里渗出灼人的热浪——有记录测到过 57℃，这间已经封锁了', 2400);
        BR.audio.play('static', boilerWorld, { volume: 0.4 });
      }
      if (near && BR.game.attackPlayers) BR.player.damage({ hp: 0.4 * dt, sanity: 0, source: 'hazard:boiler-door' });
      wasNear = near;
    });
  }

  // 12) 刷新点：通道中线每 2 m 一个，凹间和房间里各几个（碰撞体里、出口圈上的 finish 会剔掉）
  for (let z = 1; z < SIZE; z += 2) b.spawn(C, z, 'floor');
  for (let z = 2; z < SIZE; z += 4) b.spawn(C - 0.6, z, 'floor');
  for (let x = 1; x < SIZE; x += 2) {
    if (x > A0 && x < A1) continue;
    if ((x < A0 && W === 'wall') || (x > A1 && E === 'wall')) continue;
    b.spawn(x, C, 'floor');
  }
  for (const k in use) {
    const S = SLOTS[k];
    b.spawn((S.x0 + S.x1) / 2, (S.z0 + S.z1) / 2, 'room');
  }
  if (hasCar) for (const [x, z] of [[16.2, 17.2], [21.2, 22.4], [16.4, 21.0], [21.4, 19.4]]) b.spawn(x, z, 'room');
  return b.finish();
}

// ---------- 层级状态：栅栏恐惧、局部骤热、爬菌/疫疾提示、Wi-Fi 彩蛋 ----------
const BASE_SAN = 1.6;     // 依据：wikidot-cn 生存难度标 4；实体密度 high + 机械/化学多重危害，取比 Level 0 的 1.3 更高一档
const BASE_HUNGER = 1.15; // 依据 temperature「部分区域空气潮湿、厚重、难以呼吸」→ 略高于默认，非精确设定值
const ENV = {
  // 雾色偏暗的暖棕：远处的通道沉进昏黄里；有效环境光 ≈ (1, 0.9, 0.77) × 0.17 ≈ (0.17, 0.15, 0.13)，暗处也看得清路
  background: 0x17140f, fogColor: 0x17140f, fogNear: 4, fogFar: 34,
  ambient: { color: 0xffe6c4, intensity: 0.17 },
  sanityDrainMul: BASE_SAN,
  hungerDrainMul: BASE_HUNGER,
  audio: 'pipes',   // sounds「处处充斥轰鸣的机器噪音；管道中流动的黑色粘稠液体是主要噪音来源之一」
  darkness: false,
};

const S = { rng: null, wasInBars: false, wasInHeat: false, wifiToasted: false, floraT: 0 };

function enter(ctx) {
  S.rng = U.rng(ctx.levelSeed, 'L3-flavor');
  S.wasInBars = false; S.wasInHeat = false; S.wifiToasted = false; S.floraT = 40 + S.rng() * 40;
  ENV.sanityDrainMul = BASE_SAN; ENV.hungerDrainMul = BASE_HUNGER;
}

// 离锈栅栏 7 m 以内算"栅栏区"：查玩家所在区块和周围 8 块的 data.bars（不分配对象）
function nearBars(P0) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const c = BR.world.chunkAt(P0.x + dx * SIZE, P0.z + dz * SIZE);
      const list = c && c.res && c.res.data ? c.res.data.bars : null;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) if (U.dist2(P0.x, P0.z, list[i].x, list[i].z) < 49) return true;
    }
  }
  return false;
}

function update(ctx, dt) {
  const P0 = BR.player;
  const chunk = BR.world.chunkAt(P0.x, P0.z);
  const kind = chunk && chunk.res && chunk.res.data ? chunk.res.data.kind : null;

  // other「Level 3 是所有层级中 Wi-Fi 最强的一层，强度一般稳定在 3-4」：引擎没有 Wi-Fi 格数 UI，用一次性 toast 代替
  if (!S.wifiToasted) { S.wifiToasted = true; BR.hud.toast('手机信号栏跳到了满格——这里的 Wi-Fi 出奇地稳', 2200); }

  // 栅栏恐惧区：hazards「监狱栅栏密集区：强烈恐惧与极度不适，常有人感觉被监视」
  const inBars = nearBars(P0);
  if (inBars !== S.wasInBars) {
    S.wasInBars = inBars;
    ENV.sanityDrainMul = inBars ? BASE_SAN * 1.8 : BASE_SAN;
    BR.hud.prompt(inBars ? '锈迹斑斑的栅栏后面，好像有什么在盯着你看' : null);
    if (inBars) BR.audio.play('whisper', null, { volume: 0.4 });
  }

  // 局部骤热区：temperature「某些地带温度会突然升到难以忍受」
  const inHeat = kind === 'heat';
  if (inHeat !== S.wasInHeat) {
    S.wasInHeat = inHeat;
    ENV.hungerDrainMul = inHeat ? BASE_HUNGER * 1.6 : BASE_HUNGER;
    if (inHeat) { BR.hud.toast('空气突然烫得让人喘不过气……发电机的红灯全亮着', 2000); BR.gfx.flash(0xffa050, 0.5, 0.22); }
  }

  // hazards「爬菌在此生长；高湿度让疫疾容易传播，建议保持卫生」：entity-index.json 把这两项列为 hazards
  // 而非 entities，选中版本也没给出可执行的传播/伤害规则，只做成墙根的霉斑外观 + 偶发的氛围提示
  S.floraT -= dt;
  if (S.floraT <= 0) {
    S.floraT = 90 + S.rng() * 60;
    BR.hud.toast('墙角能看见类似真菌的斑块在生长——这地方湿度太高了，记得保持卫生', 2600);
  }
}

function leave() {
  ENV.sanityDrainMul = BASE_SAN; ENV.hungerDrainMul = BASE_HUNGER;
  BR.hud.prompt(null);
  S.wasInBars = false; S.wasInHeat = false;
}

BR.levels.register({
  id: '3', name: 'Level 3', title: '发电站', nickname: '',
  version: 'wikidot-cn',
  survivalClass: '4',   // 依据：页面标签含「生存难度4」（等级框三条描述词是页面未渲染的占位符，没有可读文本）
  chunkSize: SIZE,
  env: ENV,
  spawn() { return { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0 }; },
  buildChunk,

  // entities：entity-index.json 里 levels 含 "3" 且本批已实现的 9 个物种（deathmoth 按其自身选中版本
  // 拆成雄/雌两个 type）。entityDensityOverall = "high"（依据：「层级充斥着大量危险实体，长距离穿行而一次不遇
  // 几乎不可能」），但选中版本没有给出各物种单独的密度数字，每个物种的 density 字段都只写"同上（合称描述）"。
  // 按 WAVE2.md 第 4 节，把 BR.config.densityWords.high(0.9) 均摊到 9 个物种上（0.9/9=0.1 每种），
  // 死亡飞蛾选中版本（wikidot-cn）明确写了"雄性和雌性都栖息于此"、没写比例 → 把物种份额 0.1 平分成雄/雌各 0.05；
  // 这样 9 个物种的密度加总仍精确等于 high 档，且不臆造"谁比谁多"的排名。
  // 说明：faceling 在自己文件里按其独立选中版本（wikidot-en）注册为 faction:'neutral'，
  // 与本层版本（wikidot-cn）把它写作 hostile 不同——按用户规则，每个实体的行为只认它自己选中的版本，
  // 层级这里只负责给密度，不覆盖其阵营。
  entities: [
    { type: 'hound', officialPer1000m2: 0.1 },
    { type: 'smiler', officialPer1000m2: 0.1 },
    { type: 'skin_stealer', officialPer1000m2: 0.1 },
    { type: 'clump', officialPer1000m2: 0.1 },
    { type: 'duller', officialPer1000m2: 0.1 },
    { type: 'wretch', officialPer1000m2: 0.1 },
    { type: 'faceling', officialPer1000m2: 0.1 },
    { type: 'burster', officialPer1000m2: 0.1 },
    { type: 'deathmoth_male', officialPer1000m2: 0.05 },
    { type: 'deathmoth_female', officialPer1000m2: 0.05 },
  ],

  // items：data/item-spawn.json 里 levels 含 "3" 且 js/items/<key>.js 已存在的条目（perLevel["3"] 优先）
  items: [
    { type: 'almond_water', per1000m2: 1.2 },       // item-spawn.json：不限层级最常见补水物（用户规则：所有模式都刷）
    { type: 'royal_rations', per1000m2: 0.3 },      // item-spawn.json perLevel["3"]=0.3：本层页面把它列入"储量丰富"资源清单，比全局默认 0.01 高很多
    { type: 'liquid_pain', per1000m2: 0.05 },       // item-spawn.json：Base Gamma 防御系统把它装胶囊当弹弓弹药，页面没给具体数字，取全局低值
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },   // item-spawn.json：稀有度 7/10，蓝色最常见
    { type: 'moth_jelly', per1000m2: 0.01 },        // item-spawn.json perLevel["3"]=0.01：死亡飞蛾多的层级都有
    { type: 'food_ration', per1000m2: 0.6 },        // 用户规则：所有模式都刷食物；选中版本没写具体食物道具，用占位口粮兜底
  ],

  exits: [
    { to: '4', kind: 'elevator', note: 'exits[0] 之一：搭乘电梯通常前往 Level 4。南臂西墙的电梯厅凹间，(cx mod 4, cz mod 4) = (2, 1) 的区块各一部，出生点 2 块内就有' },
    { to: '5', kind: 'elevator', note: 'exits[0] 之二：搭乘电梯通常前往 Level 5（原文一台电梯可去 4 或 5，做成两种独立电梯）。南臂东墙的电梯厅凹间，(1, 3) 周期' },
    { to: '31', kind: 'door', note: 'exits[1]：木门通向 Level 31；不在首期范围，只提示"尚未开放"。东臂北墙凹间，(3, 2) 周期' },
    { to: '69', kind: 'zone', note: 'exits[2]：坐进电力房里汽车的前座会失去知觉，随后在 Level 69 醒来；不在首期范围，只提示"尚未开放"。南臂东墙过道进去的汽车电力房，(2, 3) 周期，车左侧驾驶门旁的触发圈' },
  ],
  enter, update, leave,
});
})();
