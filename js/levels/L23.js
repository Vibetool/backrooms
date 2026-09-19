// Level 23 - "The Petrified Garden"（石化花园）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-23  许可：CC BY-SA 3.0
// 选中版本 = data/lore-choices.json 的 levels['23'].source = 'wikidot-en'（原作者 Beep Bot 与 Kitty Rika）
// 只按这个版本实现；conflicts 里属于其他版本的细节一律不做，包括：
//   不做 fandom 版的「维也纳星期日」——没有永远停在白天的维也纳老城、没有报纸预言前厅历史、没有可疑车辆导致偏执、
//     没有 10–27°C 春季气候与浓雾、没有「窗户通向虚空/门通向非欧空间」的建筑内部危险、没有 Class 2、
//     没有「层级没有任何可持续食物与水源、饿死是首要死因」（本版本相反：水之心滋养全层、基苗水源稳定）；
//   wikidot-cn 只是 wikidot-en 的逐句翻译，唯一实质差异是把 Level 135 写作「深红森林」——本层按 wikidot-en 写 Level 135。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const kit = BR.kit;
const U = BR.util;

// =====================================================================
// 贴图：仓库里没有对应 jpg，也没有生成新 jpg 的额度，三张全部程序化 + noFile（_TEMPLATE 第 15 节）
// =====================================================================
// 树皮：materials「木头与树皮」——隧道壁、天花板树根、树干共用这一张，靠顶点色分别压暗/染绿
BR.assets.registerProcedural('l23_bark', 256, (g, s) => {
  const r = U.rng('l23_bark');
  g.fillStyle = '#54402b'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 3) {                       // 竖向纤维
    const v = 54 + (r() * 42 | 0);
    g.fillStyle = `rgb(${v + 24},${(v * 0.82) | 0},${(v * 0.55) | 0})`;
    g.fillRect(x, 0, 2 + (r() * 2 | 0), s);
  }
  for (let k = 0; k < 16; k++) {                         // 深沟槽：上下贯通，左右只轻微摆动，平铺不出明显接缝
    let x = r() * s;
    g.strokeStyle = `rgba(28,20,12,${0.3 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 2.4;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= s; y += 8) { x += (r() - 0.5) * 2.4; g.lineTo(x, y); }
    g.stroke();
  }
  for (let k = 0; k < 600; k++) {                        // 附生苔点：整层「杂草丛生」
    const v = 58 + (r() * 46 | 0);
    g.fillStyle = `rgba(${(v * 0.55) | 0},${v},${(v * 0.5) | 0},0.16)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
}, { noFile: true });

// 地面：腐殖土 + 苔藓斑块（光穴「空气十分潮湿凉爽」、地表之下的洞穴系统）
BR.assets.registerProcedural('l23_moss', 256, (g, s) => {
  const r = U.rng('l23_moss');
  g.fillStyle = '#2b2719'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 2400; k++) {
    const v = 28 + (r() * 32 | 0);
    g.fillStyle = `rgba(${v + 12},${v},${(v * 0.58) | 0},0.5)`;
    g.fillRect(r() * s, r() * s, 2 + (r() * 2 | 0), 2);
  }
  for (let k = 0; k < 70; k++) {                         // 苔斑：碎一点、淡一点，免得平铺出规则的圆斑（验收①）；
    const x = r() * s, y = r() * s, rad = 2.5 + r() * 7;  // 四个偏移各画一遍，保证平铺环绕不断
    g.fillStyle = `rgba(${44 + (r() * 24 | 0)},${66 + (r() * 28 | 0)},${36 + (r() * 18 | 0)},0.3)`;
    for (const o of [[0, 0], [-s, 0], [0, -s], [-s, -s]]) {
      g.beginPath(); g.arc(x + o[0], y + o[1], rad, 0, Math.PI * 2); g.fill();
    }
  }
  for (let k = 0; k < 120; k++) {                        // 落叶与碎枝
    g.fillStyle = `rgba(${70 + (r() * 30 | 0)},${52 + (r() * 24 | 0)},${26 + (r() * 16 | 0)},0.4)`;
    g.fillRect(r() * s, r() * s, 3 + (r() * 4 | 0), 2);
  }
}, { noFile: true });

// 遗迹石：landmarks「被苔藓和真菌覆盖的废弃石构建筑」
BR.assets.registerProcedural('l23_stone', 256, (g, s) => {
  const r = U.rng('l23_stone');
  g.fillStyle = '#5f5b50'; g.fillRect(0, 0, s, s);
  const rows = 4, h = s / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * h * 0.5;
    for (let i = -1; i < rows + 1; i++) {
      const v = 92 + (r() * 30 | 0);
      g.fillStyle = `rgb(${v},${(v * 0.98) | 0},${(v * 0.88) | 0})`;
      g.fillRect(i * h + off + 1.5, j * h + 1.5, h - 3, h - 3);
    }
  }
  for (let k = 0; k < 900; k++) {                        // 风化麻点
    const v = 70 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v},${v},${(v * 0.9) | 0},0.3)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
  for (let k = 0; k < 60; k++) {                         // 苔藓与真菌覆盖（验收②：原来是规则的大圆点，改碎改淡）
    const x = r() * s, y = r() * s, rad = 2 + r() * 6;
    g.fillStyle = `rgba(${44 + (r() * 22 | 0)},${76 + (r() * 28 | 0)},${44 + (r() * 18 | 0)},0.3)`;
    for (const o of [[0, 0], [-s, 0], [0, -s], [-s, -s]]) {
      g.beginPath(); g.arc(x + o[0], y + o[1], rad, 0, Math.PI * 2); g.fill();
    }
  }
}, { noFile: true });

// =====================================================================
// 尺寸
// =====================================================================
// architecture「地表之下有空气腔和蜿蜒的隧道，类似一个大型洞穴系统」：可玩空间做成地表之下那一层。
// 区块 32 m、8×8 格 → 4 m 一格：树干之间的空腔比办公层走廊宽，走起来像洞穴而不是走廊
const SIZE = 32, N = 8, CELL = SIZE / N;
const H = 4.6;            // 隧道顶（缠结的树根）；原文没给隧道尺寸，取「抬头看得到根须、不压头」的高度
const VAULT = 9.2;        // 光穴穹顶：landmarks「大型开放洞穴……大到看起来像地下森林」
const CORE_VAULT = 14;    // 核心球形天顶（近似，见 notImplemented：真实尺度是行星体级）
const WALL_T = 0.2 * 4 / 3;   // 与 kit.gridWalls 默认墙厚一致（用户要求的加厚值）

// 顶点色：同一张树皮贴图，天花板/树根压暗、入口空心树染绿（colors「显眼的绿色树皮」）
const CEIL_TINT = 0x8a8579;
const SHAFT_TINT = 0x6f6a60;
const GREEN_BARK = 0x93de5c;   // 验收①：原来偏暗，站远了和普通树干分不出来，提亮到一眼能认出"显眼的绿色树皮"
const COL_HALF = 1.7;          // 通往 Level 22 的垮塌洞口：3.4 m 见方

// =====================================================================
// 布局
// =====================================================================
// 边界参数全层所有区块完全一致（_TEMPLATE 7.2）；区块类型之间只改内部参数
const EDGE = { salt: 'L23', boundaryDensity: 0.4, straightness: 0.72, minOpenings: 2 };
// 隧道：蜿蜒、偶尔鼓出一个"空气腔"（roomChance）
const TUNNEL = Object.assign({ wallDensity: 0.5, roomChance: 0.45, maxRooms: 2, roomSize: [2, 3], loopChance: 0.55, pillarChance: 0 }, EDGE);
// 光穴/核心：内部整块打通，边界照常生成
const OPEN = Object.assign({ wallDensity: 0, roomChance: 0, maxRooms: 0, loopChance: 0, pillarChance: 0 }, EDGE);

// 宏格 4×4 区块（128 m）：无限延伸的层要周期性重复摆地标与出口（_TEMPLATE 第 9 节 / 用户规则）
const MX = 4;

// =====================================================================
// 材质：一块区块最多 5 种（树皮 / 地面 / 遗迹石 / kit:prop / kit:glow，核心块再加 kit:water）
// =====================================================================
function defineMaterials() {
  kit.mat('L23:bark', { tex: 'l23_bark', repeatMeters: 1.6, roughness: 0.95, vertexColors: true });
  kit.mat('L23:moss', { tex: 'l23_moss', repeatMeters: 2.6, roughness: 1, vertexColors: true });
  kit.mat('L23:stone', { tex: 'l23_stone', repeatMeters: 2.2, roughness: 0.9, vertexColors: true });
}

// =====================================================================
// 宏格规划：每 4×4 区块固定一处基苗、一处核心水库、一处遗迹光穴、一处普通光穴、一根空心圆木、一处垮塌洞口
// =====================================================================
function forceSlot(plan, name, li) {
  if (plan[name] === li) return;
  const old = plan[name];
  for (const k in plan) if (plan[k] === li) plan[k] = old;
  plan[name] = li;
}
function macroPlan(seed, mx, mz) {
  const mr = U.rng(seed, 'L23-macro', mx, mz);          // 派生流：同一宏格里所有区块算出来一样，不吃区块 rng
  const idx = [];
  for (let k = 0; k < MX * MX; k++) idx.push(k);
  for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(mr() * (k + 1)); const t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
  const plan = { seedling: idx[0], core: idx[1], ruin: idx[2], glow: idx[3], log: idx[4], collapse: idx[5] };
  if (mx === 0 && mz === 0) {
    forceSlot(plan, 'seedling', 0);   // 出生块 (0,0) = 基苗：entrances[2]「Level 135 的空心树直接通向 Base Seedling」
    forceSlot(plan, 'core', 6);       // 区块 (2,1)：核心水库离出生点 2 块（≈64 m），在"出生点 3–5 块内找得到出口"内
  }
  return plan;
}
function kindOf(seed, cx, cz) {
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  const p = macroPlan(seed, mx, mz);
  const li = (cz - mz * MX) * MX + (cx - mx * MX);
  if (li === p.seedling) return 'seedling';
  if (li === p.core) return 'core';
  if (li === p.ruin) return 'ruin';
  if (li === p.glow) return 'glow';
  if (li === p.log) return 'log';     // 隧道布局 + Level 121 的空心圆木入口
  if (li === p.collapse) return 'collapse';   // 隧道布局 + 天花板上通往 Level 22 的垮塌洞口
  return 'tunnel';
}

// =====================================================================
// 小工具
// =====================================================================
function reserveArea(g, x0, z0, x1, z1) {
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      const c = g.center(i, j);
      if (c.x >= x0 && c.x <= x1 && c.z >= z0 && c.z <= z1) g.reserve(i, j);
    }
  }
}

// 树干：other「树种极其多样……北美黄杉、白杨、桃花心木、红杉、雪松、柏树、白橡」——
// 引擎里不区分树种（apiRequests），只用粗细/倾斜/树皮色差表现"多个相互缠结的树木物种"
function trunk(b, x, z, r, h, opts) {
  const o = opts || {};
  const tint = o.color != null ? o.color : 0xffffff;
  b.cylinder(x, 0, z, r, h, 'L23:bark', { rTop: r * (o.taper != null ? o.taper : 0.78), segments: o.segments || 7, color: tint, caps: false });
  // 板根：三块贴着地面的鳍，树干看着是"长在这里"而不是插进地里
  for (let k = 0; k < 3; k++) {
    const a = (o.rootAngle || 0) + k * Math.PI * 2 / 3;
    b.box(x + Math.cos(a) * r * 0.85, 0, z + Math.sin(a) * r * 0.85, r * 0.55, r * 1.5, r * 1.3, 'L23:bark',
      { rotY: -a, color: tint, solid: false, faces: 'noBottom' });
  }
}

// 缠结的树枝/树根：从天花板垂下来的一束
function hangingRoots(b, x, z, rng, y) {
  const n = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const len = 0.5 + rng() * 1.9, rr = 0.04 + rng() * 0.07;
    b.cylinder(x + (rng() - 0.5) * 0.9, y - len, z + (rng() - 0.5) * 0.9, rr, len, 'L23:bark',
      { segments: 5, solid: false, color: CEIL_TINT, caps: false });
  }
}

// 发光真菌：environment.lighting「光穴由……生物发光照亮，另有发光真菌」——
// 层级的光源全部是真菌（园丁之歉是实体，项目里没有 → apiRequests，不编造）
const FUNGUS_COLORS = [[0.30, 1.50, 0.95], [0.35, 1.25, 1.45], [0.85, 1.40, 0.70]];
function fungus(b, x, z, rng, opts) {
  const o = opts || {};
  const y = o.y || 0;
  const tint = FUNGUS_COLORS[Math.floor(rng() * FUNGUS_COLORS.length)];
  const n = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const dx = (rng() - 0.5) * 0.9, dz = (rng() - 0.5) * 0.9;
    const hs = 0.1 + rng() * 0.22, rc = 0.07 + rng() * 0.09;
    b.cylinder(x + dx, y, z + dz, 0.025, hs, 'kit:prop', { segments: 4, solid: false, color: 0xd8cfae, caps: false });
    b.cylinder(x + dx, y + hs, z + dz, rc, rc * 0.75, 'kit:glow', { rTop: rc * 0.15, segments: 6, solid: false, caps: false, uv: 'solid', color: tint });
  }
  // 灯只给描述，gfx 自己挑最近的几盏实体化（_TEMPLATE 第 10 节）；恒星方位永不改变、真菌也不闪 → flicker 0
  b.light({ x, z, y: y + 0.5, color: o.lightColor || 0x8fffd0, intensity: o.intensity || 0.42, range: o.range || 7, flicker: 0 });
}

// 贴地的发光菌毯：不占灯描述、也不吃 draw call（并进 kit:glow），
// 用来把光穴的地面整体托起来 —— 验收①里光穴太黑，只靠十几盏点光照不亮 32 m 见方的洞
function fungusMat(b, x, z, rng) {
  const r = 0.8 + rng() * 1.1;
  const tint = FUNGUS_COLORS[Math.floor(rng() * FUNGUS_COLORS.length)];
  const disc = new THREE.CircleGeometry(r, 8);
  disc.rotateX(-Math.PI / 2);
  b.mesh(disc, 'kit:glow', { x, y: 0.015, z, uv: 'solid', color: [tint[0] * 0.032, tint[1] * 0.04, tint[2] * 0.032] });   // 注意 gfx 的 sRGB 输出会把暗色提亮，线性值要压得比直觉低
  disc.dispose();
}

// 灌木/蕨类/落石：environment「杂草丛生」
function undergrowth(b, x, z, rng) {
  const t = rng();
  if (t < 0.55) {
    const n = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const hh = 0.5 + rng() * 0.7;
      b.cylinder(x + (rng() - 0.5) * 0.7, 0, z + (rng() - 0.5) * 0.7, 0.32 + rng() * 0.22, hh, 'kit:prop',
        { rTop: 0.02, segments: 6, solid: false, caps: false, color: [0.16, 0.26, 0.13] });
    }
  } else if (t < 0.8) {
    b.box(x, 0, z, 0.5 + rng() * 0.5, 0.25 + rng() * 0.3, 0.5 + rng() * 0.4, 'kit:prop',
      { rotY: rng() * 3.14, solid: false, color: 0x4a4a42, faces: 'noBottom' });
  } else {
    for (let k = 0; k < 3; k++) {   // 倒木残枝
      b.cylinder(x + (rng() - 0.5) * 1.2, 0.06 + k * 0.1, z + (rng() - 0.5) * 1.2, 0.07 + rng() * 0.05, 1 + rng() * 1.4, 'L23:bark',
        { axis: 'x', segments: 5, solid: false, color: 0xa89a84, rotY: rng() * 3.14 });
    }
  }
}

// 光穴里的树：landmarks「树木可在其中生根发叶，大到看起来像地下森林」
function glowTree(b, x, z, rng, topY) {
  const r = 0.34 + rng() * 0.5;
  const h = topY * (0.55 + rng() * 0.32);
  trunk(b, x, z, r, h, { rootAngle: rng() * 6.28 });
  const layers = 2 + Math.floor(rng() * 2);
  for (let k = 0; k < layers; k++) {
    const y = h * (0.55 + k * 0.2), rad = (1.5 + rng() * 1.1) * (1 - k * 0.22);
    b.cylinder(x, y, z, rad, 0.9 + rng() * 0.5, 'kit:prop',
      { rTop: rad * 0.15, segments: 7, solid: false, caps: false, color: [0.13, 0.22, 0.11] });
  }
}

// 入口空心树：entrances「穿过巨大的空心树；这些树明显大于周围其它树木，并带有显眼的绿色树皮」
// 用一圈木板围出树干、正面留一道缺口，缺口里是黑的 —— 出口触发点就放在缺口前
function hollowTree(b, x, z, rot, opts) {
  const o = opts || {};
  const r = o.r || 1.9, h = o.h || VAULT;
  const tint = o.green === false ? 0xffffff : GREEN_BARK;
  b.push(x, z, rot);
  const seg = 12;
  for (let k = 0; k < seg; k++) {
    if (k === 0 || k === 1 || k === seg - 1) continue;          // 正面（+Z，a = 0）空出约 2.8 m 宽的树洞
    const a = k / seg * Math.PI * 2;
    b.box(Math.sin(a) * r, 0, Math.cos(a) * r, r * 0.62, h, 0.42, 'L23:bark',
      { rotY: a, color: tint, faces: 'noBottom' });
  }
  const doorH = Math.min(3.4, h - 0.4);
  b.plane(0, 0, -r * 0.55, r * 1.5, doorH, 'kit:glow', { facing: '+z', uv: 'solid', color: 0 });   // 树洞里一片漆黑
  for (const k of [0, 1, seg - 1]) {                            // 树洞上方把缺口补回去，洞口才有"门"的形状
    const a = k / seg * Math.PI * 2;
    b.box(Math.sin(a) * r, doorH, Math.cos(a) * r, r * 0.62, h - doorH, 0.42, 'L23:bark', { rotY: a, color: tint, solid: false });
  }
  b.cylinder(0, h - 0.2, 0, r * 1.12, 1.1, 'L23:bark', { rTop: r * 0.75, segments: 10, solid: false, color: tint, caps: false });
  b.solid(-r * 1.1, 0, -r * 1.1, r * 1.1, h, -r * 0.35);        // 只有背面半圈挡人，正面能走进去
  b.pop();
}

// Level 121 的入口：entrances「通过 Level 121 中一个空心圆木状结构进入」——横躺的空心圆木
function fallenLog(b, x, z, rot) {
  const r = 1.35, len = 7.4;
  b.push(x, z, rot);
  b.cylinder(0, r * 0.92, 0, r, len, 'L23:bark', { axis: 'x', segments: 10, caps: false, solid: false, color: 0xe8dcc2 });
  b.plane(0, 0.2, 0, r * 1.15, r * 1.1, 'kit:glow', { facing: '+z', uv: 'solid', color: 0, rotY: Math.PI / 2 });
  b.cylinder(len / 2 - 0.05, r * 0.92, 0, r * 1.06, 0.26, 'L23:bark', { axis: 'x', segments: 10, caps: false, solid: false, color: 0xd8c9a8 });   // 端口一圈翻起的木茬
  b.solid(-len / 2, 0, -r, len / 2, r * 1.9, -r * 0.2);
  b.solid(-len / 2, 0, r * 0.2, len / 2, r * 1.9, r);
  b.pop();
}

// Level 22 的垮塌洞口（返修·验收员「L23 没有通往 Level 22 的天花板洞口」那条）：level-23 自己的页面从头到尾没提过 Level 22，是 level-22 的页面单方面写的这条通道 ——
//   level-22 wikidot-cn（= 22 的选中版本）entrances[1]「在 Level 23 的天花板上形成的洞口」、exits[1]「沿同一处垮塌洞口离开」，
//   wikidot-en 同一条写作「Level 23 的天花板上开出了洞」，两版一字不差 ⇒ 不是版本冲突，不存在「混版」问题。
//   方向按原文：洞在 23 的天花板上 ⇒ 22 在上面，这一侧是抬头看见的方洞 + 砸下来的混凝土楼板碎块。
//   去向只指 22，不改道（用户规则⑤）；22 还没进 LEVEL_ORDER 时 kit 自动 sealed，只提示「Level 22 尚未开放」。
function collapseRect(x, z) { return { x0: x - COL_HALF, z0: z - COL_HALF, x1: x + COL_HALF, z1: z + COL_HALF }; }
function collapseHole(b, x, z, rng) {
  const HALF = COL_HALF;            // 洞口 3.4 m 见方
  const TOP = H + 3.2;              // 往上看进去的一段井壁（上面那层的楼板厚度 + 一截黑）
  const DARK = 0x46443e, LIP = 0x8f8b7e, RUBBLE = 0x8a877c;

  // 井壁：混凝土（level-22 materials 是混凝土与钢筋），尽头一片黑
  b.plane(x, H, z - HALF, HALF * 2, TOP - H, 'L23:stone', { facing: '+z', color: DARK });
  b.plane(x, H, z + HALF, HALF * 2, TOP - H, 'L23:stone', { facing: '-z', color: DARK });
  b.plane(x - HALF, H, z, HALF * 2, TOP - H, 'L23:stone', { facing: '+x', color: DARK });
  b.plane(x + HALF, H, z, HALF * 2, TOP - H, 'L23:stone', { facing: '-x', color: DARK });
  b.plane(x, TOP, z, HALF * 2, HALF * 2, 'kit:glow', { facing: 'down', uv: 'solid', color: 0 });

  // 断口一圈楼板：稍微垂到树根天花板下面一点，从底下抬头就看得见是「混凝土砸穿了树根」
  for (let k = 0; k < 4; k++) {
    b.push(x, z, k * Math.PI / 2);
    b.box(0, H - 0.14, HALF + 0.24, HALF * 2 + 0.96, 0.38, 0.48, 'L23:stone', { color: LIP, solid: false, faces: 'noTop' });
    b.pop();
  }
  // 断茬上垂下来的钢筋
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rng() * 0.3;
    const len = 0.35 + rng() * 0.55;
    b.box(x + Math.cos(a) * (HALF - 0.06), H - len, z + Math.sin(a) * (HALF - 0.06), 0.03, len, 0.03,
      'kit:prop', { color: 0x241f19, solid: false, rotY: a });
  }

  // 斜靠在洞口下的那块楼板：爬上去才够得着洞（形状交代「怎么上去」，实际触发点在地面）
  const sa = rng() * 6.28;
  b.push(x, z, sa);
  const p0 = [-0.95, 0, 3.3], p1 = [0.95, 0, 3.3], p2 = [0.8, H - 0.4, 1.3], p3 = [-0.8, H - 0.4, 1.3];
  b.quad(p0, p1, p2, p3, 'L23:stone', { color: LIP });
  b.quad(p3, p2, p1, p0, 'L23:stone', { color: 0x5e5b52 });
  b.solid(-1.0, 0, 1.15, 1.0, H - 0.35, 3.45);
  b.pop();

  // 砸下来的碎块：围一圈，在斜楼板对面留一个缺口，保证走得进洞口正下方
  // push(x, z, rot) 的本地 +z 对应世界 (sin rot, cos rot)，换成下面这套极角就是 π/2 − rot
  const gapA = Math.PI / 2 - sa + Math.PI;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + (rng() - 0.5) * 0.36;
    const rr = 2.05 + rng() * 1.05;
    const w = 0.5 + rng() * 0.8, hh = 0.3 + rng() * 0.7, d = 0.5 + rng() * 0.8, rot = rng() * 3.14;
    const T2 = Math.PI * 2;
    const da = Math.abs((((a - gapA) % T2 + T2 + Math.PI) % T2) - Math.PI);
    if (da < 0.62) continue;        // 缺口：离 gapA 0.62 rad 以内不放碎块
    b.box(x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr, w, hh, d, 'L23:stone',
      { rotY: rot, color: RUBBLE, faces: 'noBottom' });
  }
  return collapseRect(x, z);
}

// 记下地标实物的位置（世界坐标）：只给验收脚本对镜头用，运行时不读
function mark(b, x, z, tag) {
  const w = b.world(x, z);
  b.data.marks.push({ x: w.x, z: w.z, tag });
}

// 掩没哨兵：hazards「被认为困在木头与树皮的墙壁中，除了尖叫什么也做不了」
// 树皮上一处鼓起的人脸状疙瘩；触发方式见 notImplemented（游戏里没有语音/文本输入）
function sentry(b, ed) {
  b.push(ed.x, ed.z, ed.rot);
  b.cylinder(0, 0, WALL_T / 2 + 0.04, 0.34, 2.3, 'L23:bark', { segments: 8, rTop: 0.2, color: 0xc7b79a, caps: false });
  const fz = WALL_T / 2 + 0.3;
  b.box(-0.12, 1.66, fz, 0.13, 0.09, 0.05, 'kit:prop', { color: 0x0b0906, solid: false });
  b.box(0.12, 1.66, fz, 0.13, 0.09, 0.05, 'kit:prop', { color: 0x0b0906, solid: false });
  b.box(0, 1.3, fz, 0.3, 0.14, 0.05, 'kit:prop', { color: 0x140e08, solid: false });
  b.solid(-0.36, 0, 0, 0.36, 2.3, 0.44);
  b.pop();
  const w = b.world(ed.x, ed.z);
  b.data.sentries.push({ x: w.x, z: w.z, cd: 0 });
}

// 尖叫：sounds「根据听力范围内哨兵的数量，声音可大到足以刺破耳膜；像生锈的电锯切割木材」
function countSentries(wx, wz, rad) {
  const list = BR.world && typeof BR.world.chunks === 'function' ? BR.world.chunks() : [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const d = list[i].res && list[i].res.data && list[i].res.data.sentries;
    if (!d) continue;
    for (let k = 0; k < d.length; k++) {
      const dx = d[k].x - wx, dz = d[k].z - wz;
      if (dx * dx + dz * dz < rad * rad) n++;
    }
  }
  return n;
}
function scream(s) {
  if (S.screamCd > 0) return;
  S.screamCd = 6;
  const n = Math.max(1, countSentries(s.x, s.z, 28));
  const vol = Math.min(1.6, 0.4 + n * 0.22);
  BR.audio.play('screech', [s.x, 1.6, s.z], { volume: vol, rate: 0.72 });
  BR.hud.toast(n > 2 ? '四周的树皮同时裂开尖叫——像一排生锈的电锯切进木头' : '身旁的树皮裂开一道缝，里面传出尖叫', 2800);
  BR.gfx.flash(0xd8e8cc, 0.3, Math.min(0.42, 0.14 + n * 0.07));
  // 环境危害只在 attackPlayers 时结算（_TEMPLATE 第 14 节）：游玩/测试模式只给声音与画面
  if (BR.game.attackPlayers) BR.player.damage({ hp: 1 + n, sanity: 5 + n * 2, source: 'hazard:buried-sentry' });
}

// =====================================================================
// 区块外壳
// =====================================================================
function ceilingPlane(b, y, hole) {
  const key = 'L23:bark', col = CEIL_TINT;
  if (!hole) { b.plane(SIZE / 2, y, SIZE / 2, SIZE, SIZE, key, { facing: 'down', color: col }); return; }
  b.plane(SIZE / 2, y, hole.z0 / 2, SIZE, hole.z0, key, { facing: 'down', color: col });
  b.plane(SIZE / 2, y, (hole.z1 + SIZE) / 2, SIZE, SIZE - hole.z1, key, { facing: 'down', color: col });
  b.plane(hole.x0 / 2, y, (hole.z0 + hole.z1) / 2, hole.x0, hole.z1 - hole.z0, key, { facing: 'down', color: col });
  b.plane((hole.x1 + SIZE) / 2, y, (hole.z0 + hole.z1) / 2, SIZE - hole.x1, hole.z1 - hole.z0, key, { facing: 'down', color: col });
}

// 光穴/核心的高穹顶：边界线上从隧道顶接到穹顶（这一段没有开口，低处的洞口才是通道），只画朝内那一面
function vaultShell(b, top) {
  const t = WALL_T / 2;
  b.aabb(0, H, 0, SIZE, top, t, 'L23:bark', { faces: ['pz'], solid: false, color: CEIL_TINT });
  b.aabb(0, H, SIZE - t, SIZE, top, SIZE, 'L23:bark', { faces: ['nz'], solid: false, color: CEIL_TINT });
  b.aabb(0, H, 0, t, top, SIZE, 'L23:bark', { faces: ['px'], solid: false, color: CEIL_TINT });
  b.aabb(SIZE - t, H, 0, SIZE, top, SIZE, 'L23:bark', { faces: ['nx'], solid: false, color: CEIL_TINT });
}

// 天井：lighting「地表森林极其茂密，几乎没有光线透过」「整颗行星体永久沐浴在来自各个方向的阳光中，恒星方位从不改变」
// → 偶尔有一道从树冠缝隙直下的光柱，强度恒定、不闪（没有昼夜循环）
function sunShaft(b, i, j) {
  const x0 = i * CELL + 0.7, x1 = x0 + CELL - 1.4, z0 = j * CELL + 0.7, z1 = z0 + CELL - 1.4;
  const top = H + 5.5, t = 0.18;
  b.aabb(x0 - t, H, z0 - t, x0, top, z1 + t, 'L23:bark', { faces: ['px'], solid: false, color: SHAFT_TINT });
  b.aabb(x1, H, z0 - t, x1 + t, top, z1 + t, 'L23:bark', { faces: ['nx'], solid: false, color: SHAFT_TINT });
  b.aabb(x0 - t, H, z0 - t, x1 + t, top, z0, 'L23:bark', { faces: ['pz'], solid: false, color: SHAFT_TINT });
  b.aabb(x0 - t, H, z1, x1 + t, top, z1 + t, 'L23:bark', { faces: ['nz'], solid: false, color: SHAFT_TINT });
  b.plane((x0 + x1) / 2, top, (z0 + z1) / 2, x1 - x0, z1 - z0, 'kit:glow', { facing: 'down', uv: 'solid', color: [0.40, 0.46, 0.33] });
  b.light({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: H + 1.4, color: 0xbcd6a4, intensity: 0.5, range: 9, flicker: 0 });
  return { x0, z0, x1, z1 };
}

// =====================================================================
// 隧道区块（地表之下的空气腔与蜿蜒隧道）
// =====================================================================
function buildTunnelChunk(b, g, rng, kind) {
  // rng 消耗顺序固定：树干 → 天井 → 垂根 → 真菌 → 灌木 → 哨兵 → 圆木入口 / 垮塌洞口
  const trunks = [];
  for (let k = 0; k < 6; k++) {
    const i = 1 + Math.floor(rng() * (N - 1)), j = 1 + Math.floor(rng() * (N - 1));
    const r = 0.32 + rng() * 0.32, lean = rng() * 6.28;
    if (!g.vertexFree(i, j)) continue;
    trunks.push({ x: i * CELL, z: j * CELL, r, lean });
  }
  const rShaft = rng(), si = Math.floor(rng() * N), sj = Math.floor(rng() * N);
  // 垮塌洞口那一块不再开天井：ceilingPlane 一次只挖得动一个洞，头顶留给 Level 22 的方洞
  const wantShaft = rShaft < 0.16 && kind !== 'collapse';

  // 空心圆木入口（Level 121）：整块里固定放在中央偏一点，好找
  let logSpot = null;
  if (kind === 'log') {
    const lx = 12 + rng() * 8, lz = 12 + rng() * 8, lrot = rng() * 6.28;
    const c = g.cellAt(lx, lz);
    g.carve(Math.max(0, c.i - 1), Math.max(0, c.j - 1), 3, 3, { room: true });   // 给圆木腾出一个空气腔
    logSpot = { x: lx, z: lz, rot: lrot };   // 触发点在圆木的端口上（本地 +X 方向 = 世界 (cos, −sin)）
    reserveArea(g, lx - 3, lz - 3, lx + 3, lz + 3);
  }

  // 垮塌洞口（Level 22）：同样挖一个空气腔，洞口对准格心，抬头就看得见
  let colSpot = null;
  if (kind === 'collapse') {
    const c = g.cellAt(11 + rng() * 10, 11 + rng() * 10);
    const i = U.clamp(c.i, 1, N - 2), j = U.clamp(c.j, 1, N - 2);
    g.carve(i - 1, j - 1, 3, 3, { room: true });
    const cc = g.center(i, j);
    colSpot = { x: cc.x, z: cc.z };
    reserveArea(g, cc.x - 3.5, cc.z - 3.5, cc.x + 3.5, cc.z + 3.5);
  }

  // carve/setWall 做完之后才能砌墙（_TEMPLATE 7.4 / 用户硬规则）
  kit.gridWalls(b, g, { matKey: 'L23:bark', trim: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L23:moss' });
  const shaft = wantShaft && !g.isReserved(si, sj) ? sunShaft(b, si, sj) : null;
  ceilingPlane(b, H, shaft || (colSpot ? collapseRect(colSpot.x, colSpot.z) : null));

  for (const t of trunks) trunk(b, t.x, t.z, t.r, H, { rootAngle: t.lean });

  for (let k = 0; k < 9; k++) hangingRoots(b, rng() * SIZE, rng() * SIZE, rng, H);

  // 墙面上竖着的树干肋：architecture「由若干相互缠结的树木物种组成」——
  // 验收①里隧道壁是一块块平板，加上这些半埋进壁里的树干才像"树缝里的空腔"
  for (let k = 0; k < 5; k++) {
    const ed = g.pickEdge(rng, { wall: true, unlocked: true });
    const rr = 0.24 + rng() * 0.2, off = (rng() - 0.5) * 1.6;
    if (!ed) continue;
    b.push(ed.x, ed.z, ed.rot);
    b.cylinder(off, 0, WALL_T / 2 - 0.05, rr, H, 'L23:bark', { segments: 7, solid: false, color: 0xbcae95, caps: false });
    b.pop();
  }

  for (let k = 0; k < 8; k++) {                      // 发光真菌：隧道里稀疏，只够照出下一个路口
    const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
    const jx = (rng() - 0.5) * 2.2, jz = (rng() - 0.5) * 2.2;
    const c = g.center(i, j);
    if (g.isReserved(i, j)) continue;
    fungus(b, c.x + jx, c.z + jz, rng, { intensity: 0.5, range: 8.5 });
    fungusMat(b, c.x + jx, c.z + jz, rng);
  }
  for (let k = 0; k < 8; k++) {
    const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
    const c = g.center(i, j);
    undergrowth(b, c.x + (rng() - 0.5) * 2.4, c.z + (rng() - 0.5) * 2.4, rng);
  }

  // 掩没哨兵：贴在内部墙段上。基苗所在的光穴没有（bases「区域内……没有掩没哨兵」），这里是隧道，照放
  for (let k = 0; k < 2; k++) {
    const roll = rng();
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed && roll < (k === 0 ? 0.5 : 0.2)) sentry(b, ed);
  }

  if (logSpot) {
    fallenLog(b, logSpot.x, logSpot.z, logSpot.rot);
    mark(b, logSpot.x, logSpot.z, '121');
    // exits/entrances：Level 121 还没做 → kit 自动 sealed，实物照摆、不改道（用户规则⑤）
    kit.exit(b, {
      to: '121', kind: 'zone', x: logSpot.x + Math.cos(logSpot.rot) * 4.0, z: logSpot.z - Math.sin(logSpot.rot) * 4.0,
      radius: 1.4, label: '钻进空心圆木',
    });
    fungus(b, logSpot.x + 2.2, logSpot.z + 2.2, rng, { intensity: 0.75, range: 10 });
    fungus(b, logSpot.x - 2.4, logSpot.z - 1.8, rng, { intensity: 0.6, range: 9 });
    fungusMat(b, logSpot.x, logSpot.z + 2.6, rng);
  }

  if (colSpot) {
    collapseHole(b, colSpot.x, colSpot.z, rng);
    mark(b, colSpot.x, colSpot.z, '22');
    // Level 22 的垮塌洞口：触发点就在洞口正下方的空地上（洞在 4.6 m 高的天花板上，
    // EXIT_DY 只认 ±2.5 m，所以 y 取地面；上去那段由斜靠的楼板与碎石堆交代）
    kit.exit(b, {
      to: '22', kind: 'zone', x: colSpot.x, z: colSpot.z, radius: 1.5,
      label: '顺着塌下来的楼板爬进天花板上的洞口',
    });
    // 断口边上长出来的真菌：不然这块黑得看不见头顶的洞（Level 22 那边是废墟，不会有光漏下来）
    fungus(b, colSpot.x + 2.3, colSpot.z - 1.9, rng, { intensity: 0.75, range: 10 });
    fungus(b, colSpot.x - 2.1, colSpot.z + 2.2, rng, { intensity: 0.6, range: 9 });
    fungusMat(b, colSpot.x, colSpot.z + 1.6, rng);
  }
  attachSentryUpdate(b);
}

// =====================================================================
// 光穴区块（Glow Rooms）：遗迹 / 基苗 / 普通光穴共用这层外壳
// =====================================================================
function buildOpenChunk(b, g, rng, kind) {
  const top = kind === 'core' ? CORE_VAULT : VAULT;
  const keep = kind === 'core' ? { x: 16, z: 16, r: 14 }
    : kind === 'ruin' ? { x: 16, z: 16, r: 13 }
      : kind === 'seedling' ? { x: 16, z: 16, r: 12.5 }
        : { x: 9, z: 9, r: 5 };

  // rng 顺序：树 → 垂根 → 真菌 → 灌木 → 地标 → 出口
  const trees = [];
  for (let k = 0; k < 12; k++) {
    const x = 2.5 + rng() * (SIZE - 5), z = 2.5 + rng() * (SIZE - 5), t = rng();
    if (U.dist2(x, z, keep.x, keep.z) < keep.r * keep.r) continue;
    trees.push({ x, z, t });
  }
  const roots = [];
  for (let k = 0; k < 8; k++) roots.push({ x: rng() * SIZE, z: rng() * SIZE });
  const fungi = [];
  for (let k = 0; k < 17; k++) {
    const x = 2 + rng() * (SIZE - 4), z = 2 + rng() * (SIZE - 4);
    fungi.push({ x, z, mat: rng() < 0.75 });
  }
  const bush = [];
  for (let k = 0; k < 14; k++) bush.push({ x: 2 + rng() * (SIZE - 4), z: 2 + rng() * (SIZE - 4) });

  if (kind === 'core') reserveArea(g, 3, 3, 29, 29);
  else if (kind === 'ruin') reserveArea(g, 5, 5, 27, 27);
  else if (kind === 'seedling') reserveArea(g, 5, 5, 27, 27);

  kit.gridWalls(b, g, { matKey: 'L23:bark', trim: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L23:moss' });
  vaultShell(b, top);
  ceilingPlane(b, top, null);

  for (const t of trees) glowTree(b, t.x, t.z, rng, top);
  for (const r of roots) hangingRoots(b, r.x, r.z, rng, top);
  // lighting「光穴由生物发光照亮」：光穴是全层最亮的地方，灯比隧道多、也更亮（验收①：原来的亮度看不清遗迹）
  for (const f of fungi) {
    fungus(b, f.x, f.z, rng, { intensity: 0.8, range: 11 });
    if (f.mat) fungusMat(b, f.x, f.z, rng);
  }
  for (const s of bush) undergrowth(b, s.x, s.z, rng);
  // weather/temperature「光穴内的空气十分潮湿凉爽」：地上到处是积水
  for (let k = 0; k < 5; k++) kit.prop.puddle(b, 3 + rng() * (SIZE - 6), 3 + rng() * (SIZE - 6), 0, { rx: 0.9 + rng() * 1.3, rz: 0.7 + rng() * 1.1 });

  if (kind === 'ruin') buildRuins(b, rng);
  else if (kind === 'seedling') buildSeedling(b, rng);
  else if (kind === 'core') buildCore(b, rng);
  else {
    // 普通光穴：一棵通往 Level 37 的入口空心树
    const tx = 9, tz = 9, rot = Math.atan2(16 - tx, 16 - tz) + (rng() - 0.5) * 0.4;   // 树洞朝着洞室中心
    hollowTree(b, tx, tz, rot, { h: top - 0.6 });
    kit.exit(b, { to: '37', kind: 'zone', x: tx + Math.sin(rot) * 2.3, z: tz + Math.cos(rot) * 2.3, radius: 1.4, label: '钻进空心树' });
    fungus(b, tx + 2.6, tz - 2.2, rng, { intensity: 0.7, range: 9 });
    mark(b, tx, tz, '37');
  }

  if (kind !== 'seedling' && kind !== 'core') {
    for (let k = 0; k < 2; k++) {
      const roll = rng();
      const ed = g.pickEdge(rng, { wall: true, interior: false, unlocked: true });
      if (ed && roll < 0.45) sentry(b, ed);
    }
  }
  attachSentryUpdate(b);
}

// ---------- 古老遗迹 ----------
// landmarks「与著名前厅建筑形似但形状不同——金字塔形的亚历山大灯塔、球形的大金字塔、方形的大角斗场、三角形的帕特农神庙」
function buildRuins(b, rng) {
  const S1 = 'L23:stone';
  const moss = 0xb6c4a8;

  // 金字塔形的亚历山大灯塔：四级台阶收进去
  b.push(9.5, 9.5, rng() * 6.28);
  for (let k = 0; k < 4; k++) {
    const w = 6.4 - k * 1.5, h = 1.5;
    b.box(0, k * h, 0, w, h, w, S1, { color: k > 1 ? moss : 0xffffff, faces: 'noBottom' });
  }
  b.pop();

  // 球形的大金字塔（"宏伟之球"）：半埋在苔藓里
  const sx = 22.5, sz = 10.5, sr = 4.2;
  const sph = new THREE.SphereGeometry(sr, 12, 8);
  b.mesh(sph, S1, { x: sx, y: sr * 0.72, z: sz, color: [0.78, 0.86, 0.74] });
  sph.dispose();
  b.solid(sx - sr * 0.92, 0, sz - sr * 0.92, sx + sr * 0.92, sr * 1.5, sz + sr * 0.92);
  // landmarks「'Great Sphere' 遗迹底部的拉丁文牌匾，译文标题为 The Gardener's Failed Earth」
  b.push(sx, sz + sr * 0.95, 0);
  b.box(0, 0, 0, 1.5, 0.22, 0.6, S1, { color: moss, faces: 'noBottom' });
  b.box(0, 0.22, -0.06, 1.25, 0.72, 0.12, S1, { rotY: 0, color: 0xd9d6c4, faces: 'noBottom' });
  for (let k = 0; k < 4; k++) b.box(0, 0.36 + k * 0.13, 0.02, 0.85 - (k % 2) * 0.2, 0.03, 0.02, 'kit:prop', { color: 0x5d5a4a, solid: false });
  b.pop();
  const pw = b.world(sx, sz + sr * 0.95 + 0.5);
  b.data.notes.push({ x: pw.x, z: pw.z, r: 3, text: '石球底座上的拉丁文牌匾，译文标题是《园丁的失败大地》' });

  // 方形的大角斗场：四面直墙围成的方环，各开一个门洞
  b.push(10, 22.5, 0);
  for (let s = 0; s < 4; s++) {
    const a = s * Math.PI / 2;
    b.push(Math.sin(a) * 4.2, Math.cos(a) * 4.2, a);
    b.box(-2.55, 0, 0, 2.9, 3.2, 0.7, S1, { color: s % 2 ? moss : 0xffffff, faces: 'noBottom' });
    b.box(2.55, 0, 0, 2.9, 3.2, 0.7, S1, { color: s % 2 ? 0xffffff : moss, faces: 'noBottom' });
    b.box(0, 2.5, 0, 8, 0.7, 0.7, S1, { color: moss, solid: false });
    b.pop();
  }
  b.pop();

  // 三角形的帕特农神庙：三棱柱台基 + 六根柱子 + 三棱柱屋顶
  b.push(23, 23, rng() * 6.28);
  b.cylinder(0, 0, 0, 4.6, 0.7, S1, { segments: 3, color: moss });
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2;
    b.cylinder(Math.cos(a) * 3.1, 0.7, Math.sin(a) * 3.1, 0.34, 2.9 - (k % 3) * 0.7, S1, { segments: 7, color: 0xffffff });
  }
  b.cylinder(0, 3.6, 0, 4.2, 0.55, S1, { segments: 3, color: moss, solid: false });
  b.pop();

  // 文物：items「陶器是遗迹内最常见的文物，另有受损的绘画和布料；质量明显差于前厅同类」（只是摆设，不做交互）
  for (let k = 0; k < 7; k++) {
    const x = 6 + rng() * 20, z = 6 + rng() * 20, t = rng();
    if (t < 0.5) {
      const rr = 0.16 + rng() * 0.12;
      b.cylinder(x, 0, z, rr, 0.3 + rng() * 0.25, 'kit:prop', { rTop: rr * 0.6, segments: 7, solid: false, color: 0x8a6a48 });
    } else if (t < 0.78) {
      b.box(x, 0, z, 0.9, 0.7, 0.08, 'kit:prop', { rotY: rng() * 6.28, solid: false, color: 0x4b4033 });   // 受损的画板
    } else {
      b.box(x, 0.02, z, 1.1, 0.06, 0.8, 'kit:prop', { rotY: rng() * 6.28, solid: false, color: 0x6d5f4c });  // 一堆布料
    }
  }
  // mechanics「遗迹内的文字总是拉丁文，且总是褪色、匆忙写下的信息」：墙上几行褪色刻痕（引擎没有文字贴花，见 apiRequests）
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 5; k++) {
      b.box(7.6 + k * 0.5, 1.6 - row * 0.32, 18.7, 0.3 + (k % 2) * 0.12, 0.035, 0.03, 'kit:prop', { color: 0xa9a48c, solid: false });
    }
  }

  // entrances[1]「穿过 Level 47 中发现的巨大空心树」：遗迹光穴边上也立着一棵绿皮空心树
  const tx = 16, tz = 28, rot = Math.PI;   // 树背靠洞壁、树洞朝着遗迹这一侧，触发点落在room 里而不是压在边界墙上
  hollowTree(b, tx, tz, rot, { h: VAULT - 0.9 });
  kit.exit(b, { to: '47', kind: 'zone', x: tx + Math.sin(rot) * 2.3, z: tz + Math.cos(rot) * 2.3, radius: 1.4, label: '钻进空心树' });
  mark(b, tx, tz, '47');
  fungus(b, tx + 3.2, tz - 2.4, rng, { intensity: 0.7, range: 9 });
}

// ---------- M.E.G. Base Seedling（基苗）----------
// bases「一座探索、人类学兼研究基地，建立在一处光穴内部……守卫着 Level 23 唯一已知的稳定出口」
// 用户规则：据点只摆静态建筑和标记，不做交互、不做驻守 NPC、不做交易
function cabin(b, x, z, rot) {
  const w = 4.4, d = 3.4, h = 2.6;
  b.push(x, z, rot);
  b.box(0, 0, -d / 2, w, h, 0.12, 'kit:prop', { color: 0x3f453c, faces: 'sides' });
  b.box(-w / 2, 0, 0, 0.12, h, d, 'kit:prop', { color: 0x3f453c, faces: 'sides' });
  b.box(w / 2, 0, 0, 0.12, h, d, 'kit:prop', { color: 0x3f453c, faces: 'sides' });
  kit.prop.door(b, 0, d / 2, 0, { style: 'metal', w: 0.9, h: 2.05, color: 0x39413a, frameColor: 0x2f352e, wall: { matKey: 'kit:prop', w, h, t: 0.12, color: 0x3f453c } });   // 不给 color 的话 wallWithOpening 会用 kit:prop 的浅灰底色，小屋正面白得发光
  b.box(0, h, 0, w + 0.4, 0.16, d + 0.4, 'kit:prop', { color: 0x2c312b });
  b.pop();
}
function buildSeedling(b, rng) {
  // 中央的空心树：exits「在 Base Seedling 中央有一棵空心树，可以把人带回 Level 135」（双向通道）
  hollowTree(b, 16, 11.5, 0, { h: VAULT - 0.8, r: 2.0 });
  kit.exit(b, { to: '135', kind: 'zone', x: 16, z: 13.9, radius: 1.5, label: '钻进基苗中央的空心树' });
  mark(b, 16, 11.5, '135');

  cabin(b, 8.2, 17, Math.PI / 2);
  cabin(b, 23.8, 17, -Math.PI / 2);
  cabin(b, 16, 25.4, Math.PI);

  // 水源：bases「食物供应有限但水源供应稳定」——接在水循环上的储水罐与水槽
  b.cylinder(23.4, 0, 11.6, 1.15, 2.7, 'kit:prop', { segments: 9, color: 0x555c5f });
  b.cylinder(23.4, 2.7, 11.6, 1.2, 0.18, 'kit:prop', { segments: 9, color: 0x434a4d, solid: false });
  kit.prop.pipe(b, 22, 11.6, 0, { axis: 'x', length: 2.6, y: 2.2, r: 0.07 });
  b.box(21, 0, 13.4, 2.2, 0.55, 0.8, 'kit:prop', { color: 0x4e555a });

  // 补给堆：食物供应有限 → 只有几箱
  kit.prop.crate(b, 10.5, 21.5, 0.3, { size: 0.8, color: 0x7a6242 });
  kit.prop.crate(b, 11.4, 22.2, -0.2, { size: 0.7, color: 0x6d5838 });
  kit.prop.box(b, 21.6, 21.8, 0.4, { stack: 3, color: 0xa9895c });
  kit.prop.box(b, 20.6, 22.4, -0.3, { stack: 2, color: 0xa08052 });

  // 围挡与门口标牌（静态标识，不可交互）
  for (const s of [0, 1, 2, 3]) {
    const a = s * Math.PI / 2;
    for (let k = -1; k <= 1; k++) {
      if (s === 2 && k === 0) continue;               // 南面留大门
      const cxp = 16 + Math.sin(a) * 11, czp = 16 + Math.cos(a) * 11;
      kit.prop.fence(b, cxp + Math.cos(a) * k * 7, czp - Math.sin(a) * k * 7, a, { length: 6.4, kind: 'chain', h: 1.9, color: 0x4c5149, meshColor: 0x20241f });
    }
  }
  kit.prop.sign(b, 16, 26.6, 0, { y: 2.1, w: 0.9, h: 0.3, color: 0x64ff9a });
  kit.prop.sign(b, 16, 26.6, Math.PI, { y: 2.1, w: 0.9, h: 0.3, color: 0x64ff9a });

  // 照明：基地把光穴的发光真菌养在柱顶（原文没写基地照明，按本层唯一的光源做最小推断）
  for (const p of [[11, 15.5], [21, 15.5], [11, 23], [21, 23]]) {
    b.cylinder(p[0], 0, p[1], 0.09, 2.5, 'kit:prop', { segments: 6, color: 0x40453e });
    fungus(b, p[0], p[1], rng, { y: 2.5, intensity: 0.45, range: 8, lightColor: 0xa8ffd8 });
  }
}

// ---------- 核心：Heart of Water ----------
// landmarks「位于行星体最中心、被 Green Giants 纠缠的根茎完全包围的巨大水库，滋养整个层级」
// exits「进入层级核心的水库后，随机被切入 Level 7 / Level 121 的海洋中间，也有机会切入 Level 43 的一个展品中」
function buildCore(b, rng) {
  const cxp = 18, czp = 18, R = 8.4;

  // Green Giant：scale「最大的 Green Giant 高约 3.2 km、宽约 18.3 m」——引擎里只能给出一截，穹顶被它撑住
  trunk(b, 7, 7, 4.6, CORE_VAULT, { segments: 12, taper: 0.92, rootAngle: 0.4 });
  // landmarks「该区域最为茂盛，生长着别处没有的奇特植物与真菌」：真菌顺着巨人的树皮往上长，
  // 顺带把这根 14 m 高的树干从纯黑照出轮廓（验收①）
  for (let k = 0; k < 5; k++) {
    const a = 0.6 + k * 0.7;
    fungus(b, 7 + Math.cos(a) * 4.9, 7 + Math.sin(a) * 4.9, rng, { y: k * 1.3, intensity: 0.7, range: 10 });
  }
  for (let k = 0; k < 7; k++) {   // 纠缠的根茎：从巨人脚下伸向水库
    const a = 0.2 + k * 0.42, len = 9 + rng() * 6;
    b.cylinder(7 + Math.cos(a) * 4.8, 0.5 + rng() * 0.5, 7 + Math.sin(a) * 4.8, 0.4 + rng() * 0.3, len, 'L23:bark',
      { axis: 'x', segments: 7, rotY: -a, solid: false, color: 0xbfae93, caps: false });
  }

  // 水库
  const disc = new THREE.CircleGeometry(R, 26);
  disc.rotateX(-Math.PI / 2);
  const water = b.mesh(disc, 'kit:water', { x: cxp, y: 0.11, z: czp, color: [0.28, 0.66, 0.74] });
  disc.dispose();
  b.update((dt, t) => water.setColor([0.28, 0.66, 0.74], 0.86 + 0.14 * Math.sin(t * 0.7)));
  for (let k = 0; k < 16; k++) {   // 水库边缘一圈树根围栏
    const a = k / 16 * Math.PI * 2;
    b.cylinder(cxp + Math.cos(a) * (R + 0.5), 0, czp + Math.sin(a) * (R + 0.5), 0.22 + rng() * 0.12, 0.8 + rng() * 0.7, 'L23:bark',
      { segments: 6, solid: false, color: 0xa79a82, caps: false });
  }
  for (let k = 0; k < 3; k++) fungus(b, cxp + Math.cos(k * 2) * (R + 2.2), czp + Math.sin(k * 2) * (R + 2.2), rng, { intensity: 0.7, range: 10 });

  // 三个漩涡：原文说"同一个水库出口随机切入三处"。引擎的出口目标是固定的（apiRequests），
  // 于是把三个去向做成水库里三处下沉的根须漏斗、位置由本块 rng 打乱 —— 玩家每次找到的那个通向哪并不确定，
  // 又保证已实现的 Level 7 一定在场，不至于走到出口却发现只有"尚未开放"
  const dest = ['7', '121', '43'];
  for (let k = dest.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = dest[k]; dest[k] = dest[j]; dest[j] = t; }
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + 0.5;
    const x = cxp + Math.cos(a) * R * 0.58, z = czp + Math.sin(a) * R * 0.58;
    kit.prop.hole(b, x, z, 0, { r: 1.25, rimColor: 0x3a3226 });
    for (let m = 0; m < 5; m++) {   // 漏斗边上支棱着的根须
      const aa = m / 5 * Math.PI * 2;
      b.cylinder(x + Math.cos(aa) * 1.35, 0, z + Math.sin(aa) * 1.35, 0.11, 0.7, 'L23:bark', { segments: 5, solid: false, color: 0x9d9078, caps: false });
    }
    kit.exit(b, {
      to: dest[k], kind: 'zone', x, z, radius: 1.3, marker: { color: [0.3, 0.95, 1.35] },
      label: dest[k] === '7' ? '沉进根须漏斗（前往 Level 7）' : undefined,
    });
  }
}

// =====================================================================
// 哨兵的每帧判定（区块级，区块卸载自动停）
// =====================================================================
function attachSentryUpdate(b) {
  if (!b.data.sentries.length && !b.data.notes.length) return;
  b.update((dt) => {
    const P = BR.player;
    const list = b.data.sentries;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (s.cd > 0) { s.cd -= dt; continue; }
      const dx = P.x - s.x, dz = P.z - s.z;
      if (dx * dx + dz * dz < 4) { s.cd = 20; scream(s); }      // 走到 2 m 内就惊动它
    }
    const notes = b.data.notes;
    for (let k = 0; k < notes.length; k++) {
      const nt = notes[k];
      if (nt.shown) continue;
      const dx = P.x - nt.x, dz = P.z - nt.z;
      if (dx * dx + dz * dz < nt.r * nt.r) { nt.shown = true; BR.hud.toast(nt.text, 3400); }
    }
  });
}

// =====================================================================
// 区块
// =====================================================================
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const kind = kindOf(ctx.levelSeed, cx, cz);
  b.data.kind = kind;
  b.data.sentries = [];
  b.data.notes = [];
  b.data.marks = [];

  const open = kind === 'glow' || kind === 'ruin' || kind === 'seedling' || kind === 'core';
  const g = kit.grid(b, N, N, open ? OPEN : TUNNEL);
  if (open) g.carve(0, 0, N, N, { room: true });     // 只清内部，边界照旧（7.2 节）

  if (open) buildOpenChunk(b, g, rng, kind);
  else buildTunnelChunk(b, g, rng, kind);

  // 基苗：bases「区域内敌意实体已被清除、没有掩没哨兵」→ 整块刷新点标记为安全，不刷有害实体
  kit.gridSpawns(b, g, { safe: kind === 'seedling' });
  return b.finish();
}

// =====================================================================
// 层级状态
// =====================================================================
const S = { screamCd: 0 };

BR.levels.register({
  id: '23',
  name: 'Level 23',
  title: 'The Petrified Garden',
  nickname: '石化花园',
  version: 'wikidot-en',                 // = data/lore-choices.json 的 levels['23'].source
  survivalClass: 'Class 4：Unsafe（不安全）/ Overgrown（杂草丛生）/ Medium Entity Count（中等数量实体）',
  chunkSize: SIZE,
  env: {
    // 地表之下的洞穴：远处沉进湿冷的墨绿，而不是纯黑
    background: 0x0c120d, fogColor: 0x0c120d,
    fogNear: 4, fogFar: 52,              // ≤ chunkSize × 2
    // lighting「地表森林极其茂密，几乎没有光线透过」：昏暗但不是无光（光穴有真菌）。
    // 有效亮度 = color × intensity ≈ 0.124–0.146，色本身不能近黑
    ambient: { color: 0xc6e8d2, intensity: 0.16 },
    sanityDrainMul: 1.3,                 // Class 4 不安全 + 中等数量实体 + 树皮里随时可能尖叫的哨兵
    hungerDrainMul: 1,                   // temperature 只说光穴「十分潮湿凉爽」，没有酷热严寒
    audio: 'cave',
    darkness: false,
  },
  // 出生点：基苗（区块 0,0）中央广场，面朝 −Z 正对通往 Level 135 的空心树
  spawn() { return { x: 16, y: 0, z: 20.5, yaw: 0 }; },
  buildChunk,
  entities: [
    // entityDensityOverall「Medium Entity Count……大多数实体生活在地表之下的洞穴区域」：只有定性描述 →
    // 按 _TEMPLATE 第 12 节取 BR.config.densityWords.moderate = 0.35，均分给原文列出、且项目里已注册的 7 类常见实体（各 0.05）。
    // Wranglers 原文写「非常罕见（very rarely）」→ densityWords.rare = 0.04，由已注册的雌雄两形态平分（各 0.02）。
    // 合计 0.39/1000 m²：5×5 块（25 600 m²）游玩满格期望 ≈ 5 只，地狱档 ≈ 6 只，都在 maxActiveEntities 内。
    // 原文列出但项目里没有的双尾狐 Volpes、园丁之歉 Gardener's Sorries、掩没哨兵 Buried Sentries、
    // 光穴未知本土实体、巨人树枝上的奇异野生动物一律不写进表（写进 apiRequests，不拿别的实体顶替）
    { type: 'hound', officialPer1000m2: 0.05 },
    { type: 'clump', officialPer1000m2: 0.05 },
    { type: 'smiler', officialPer1000m2: 0.05 },
    { type: 'death_rat', officialPer1000m2: 0.05 },
    { type: 'deathmoth_male', officialPer1000m2: 0.05 },
    { type: 'deathmoth_female', officialPer1000m2: 0.05 },
    { type: 'curabitur_bird', officialPer1000m2: 0.05 },
    { type: 'wrangler_male', officialPer1000m2: 0.02 },
    { type: 'wrangler_female', officialPer1000m2: 0.02 },
  ],
  items: [
    // data/item-spawn.json 里还没有 '23' 这一层的条目（见 apiRequests）。
    // 用户规则「所有模式都刷食物和杏仁水」：按两条的基准值 per1000m2 放，本层原文的水源是水之心而不是瓶装水
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'food_ration', per1000m2: 0.6 },
  ],
  exits: [
    { to: '7', kind: 'zone', note: '核心水库（Heart of Water）水面上三处下沉的根须漏斗之一，走进去被切入 Level 7 的海洋中间（exits[0]，本作已有，真的通）' },
    { to: '121', kind: 'zone', note: '同一水库的另一处漏斗（exits[1]）；Level 121 不在已实现范围，漏斗照摆，只提示尚未开放' },
    { to: '43', kind: 'zone', note: '同一水库的第三处漏斗（exits[2]）；Level 43 不在已实现范围，只提示尚未开放' },
    { to: '135', kind: 'zone', note: '基苗中央的空心树，双向通回 Level 135（exits[3]）；Level 135 不在已实现范围，树照摆，只提示尚未开放' },
    // ↓ 下面三条原文（wikidot-en）只写在 entrances 里，exits 章节没有；本作按「空心树/空心圆木是双向通道」的推断
    //   也做成出口（exits[3] 的基苗空心树是原文明写的双向通道，同一种构件）。实物与触发照摆、不改道（用户规则⑤）
    { to: '37', kind: 'zone', note: '光穴里那棵明显更大、绿色树皮的空心树。原文只写作入口（entrances[0]「穿过 Level 37 中发现的巨大空心树」），没写能从 23 走回 37 —— 这一条是本作按空心树双向的推断补的出口，Level 37 尚未开放' },
    { to: '47', kind: 'zone', note: '遗迹光穴里的同款绿皮空心树。原文同样只写作入口（entrances[1]），出口方向是本作的推断，Level 47 尚未开放' },
    { to: '121', kind: 'zone', note: '隧道里横躺的空心圆木。原文只写作入口（entrances[3]「通过 Level 121 中一个空心圆木状结构进入」），出口方向是本作的推断；和上面 exits[1] 的水库漏斗是两条不同的通道，Level 121 尚未开放' },
    // ↓ 这一条 level-23 页面没写，是 level-22 页面单方面写的同一处通道（返修·补另一半洞口）
    { to: '22', kind: 'zone', note: '隧道天花板上被砸穿的方洞 + 砸下来的混凝土楼板。依据是 level-22 的选中版本 wikidot-cn：entrances[1]「在 Level 23 的天花板上形成的洞口」、exits[1]「沿同一处垮塌洞口离开」（wikidot-en 同一条一字不差，不是版本冲突）。level-23 自己的页面没提过 Level 22，所以这条不出现在上面的 exits 逐条对应里；每个 4×4 宏格一处，Level 22 进 LEVEL_ORDER 之前提示尚未开放' },
  ],
  enter() { S.screamCd = 0; },
  update(ctx, dt) { if (S.screamCd > 0) S.screamCd -= dt; },
  leave() { S.screamCd = 0; },
});
})();
