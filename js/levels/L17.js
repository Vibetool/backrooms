// Level 17 "Abandoned Carrier"（页首副标语 "On the waters that surround"，链接到 Level 7）
// 来源版本：fandom  URL：https://web.archive.org/web/20251231001018/https://backrooms.fandom.com/wiki/Level_17  许可：CC BY-SA 3.0
// 抓取：data/lore-choices.json levels["17"] 记录的存档快照 2025-12-31
// 只按这个版本实现：不做 wikidot-en/cn 的「埃塞克斯级航空母舰内部 + 无限迷宫」设定，不做它们「对视双眼昏迷3-4小时/脑死亡」的
//   印记加剧条件与后果，也不做它们「上层光=肺部积水」「Level 7 水下光源入口」「Level 11 红色金属门出口」——
//   这些都属于本层未选中的另两个版本（data/lore-choices.json levels["17"].conflicts）。
//   本文件里"印记"的行为（鬼魂复刻路线、直视昏迷、看太久变悲尸、24-72小时后进入点重现）来自选中的 fandom 版本，
//   由 js/entities/imprint.js（本批另一位代理）实现，本文件只登记刷新表。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：scale「占地数十万平方米」——有限但庞大，没有给出具体走廊尺寸；沿用室内迷宫默认格局，
// 引擎本身是无限区块流式加载（没有"整层封顶面积"的接口，见 apiRequests），真正的"有限船体"边界未强制实现
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.8;   // 层高原文未给数字（unverified），用 kit 默认层高
const SPAWN_I = 3, SPAWN_J = 3;

function mod(n, m) { return ((n % m) + m) % m; }

// ---------- 分区（宏格哈希，跨区块协调，TEMPLATE 4.2 节）----------
// 依据：architecture「纵向分区：主层(直线走廊+小舱室) → 上层(转弯更多+发光门窗) → 更高处导航舰桥；
//   向下为货舱(集装箱) → 更下为轮机舱」——引擎没有多层楼叠放接口（规则⑥，见 apiRequests），
//   近似成四个水平分区（主层/上层/货舱/轮机舱），出生区固定主层；导航舰桥做成"上层"里的稀有地标房间，
//   不做真实垂直落差
const SECTOR_MX = 3;
function sectorAt(seed, cx, cz) {
  if (cx === 0 && cz === 0) return 'main';
  const mx = Math.floor(cx / SECTOR_MX), mz = Math.floor(cz / SECTOR_MX);
  if (mx === 0 && mz === 0) return 'main';
  const mr = U.rng(seed, 'L17-sector', mx, mz);
  // 依据：landmarks 列出的区域里主层描述最长、出现的房间种类最多 → 权重最高；轮机舱"比其他区域凌乱得多"，篇幅最短 → 权重最低
  return U.weighted(mr, [['main', 0.34], ['upper', 0.30], ['cargo', 0.22], ['engine', 0.14]]);
}

// ---------- 保证可达的出口（规则②：范围内出口必须任意位置 3-5 区块内可达）----------
// 每条只用单轴或双轴 mod 周期，不吃 rng，跟分区结果无关地强制覆盖该区块的用途——
// 参照 L14.js 的 MAIN_EXIT_MOD 写法，但这里给了 5 条不同出口各自的周期，彼此错开避免总撞在一起
function guaranteedKind(cx, cz) {
  if (mod(cx, 4) === 1 && mod(cz, 4) === 1) return 'sleep';      // exits[0] 主出口——最密，约每 16 块 1 个
  if (mod(cx, 5) === 2 && mod(cz, 5) === 0) return 'flooded';    // exits[1]
  if (mod(cx, 5) === 0 && mod(cz, 5) === 3) return 'hulldoor';   // exits[2]（描述段落里的舱门，不在原出口列表编号内）
  if (mod(cx, 4) === 3 && mod(cz, 4) === 0) return 'noclip';     // exits[4]
  if (mod(cx, 5) === 4 && mod(cz, 5) === 4) return 'supply';     // exits[6]
  return null;
}

function chunkPlan(seed, cx, cz, rng) {
  if (cx === 0 && cz === 0) return { sector: 'main', kind: 'corridor' };
  const forced = guaranteedKind(cx, cz);
  if (forced) {
    // 验收修复（低优先级项）：landmarks 明确写"船体舱门（hull doors）：位于货舱"，只有 hulldoor 改用货舱分区
    // 的格子参数与材质；其余强制出口（睡觉舱室/被淹走廊/Supply Room/noclip 管道）沿用主层，简化实现
    const sector = forced === 'hulldoor' ? 'cargo' : 'main';
    return { sector, kind: forced };
  }
  const sector = sectorAt(seed, cx, cz);
  let kind;
  if (sector === 'main') {
    // 依据：landmarks「小舱室：走廊两侧」——常见；「木制狭长走廊→27」「俄文标识门→245」都是范围外，稀有点缀
    kind = U.weighted(rng, [['corridor', 0.60], ['cabin', 0.30], ['wood', 0.05], ['russian', 0.05]]);
  } else if (sector === 'upper') {
    // 依据：landmarks「导航舰桥」在描述里明显比走廊本身罕见得多
    kind = U.weighted(rng, [['corridor', 0.80], ['bridge', 0.08], ['spiral', 0.12]]);
  } else if (sector === 'cargo') {
    kind = 'hold';
  } else {
    kind = 'engine';
  }
  return { sector, kind };
}

// ---------- 边界与格子参数（7.2 节：全层所有区块必须一致，区块类型只改内部墙/房间/回路/立柱概率）----------
const EDGE = { salt: 'L17', boundaryDensity: 0.30, straightness: 0.65, minOpenings: 2 };
// 依据：landmarks「主层走廊较直」
const MAIN = Object.assign({ wallDensity: 0.30, roomChance: 0.42, maxRooms: 2, roomSize: [2, 3], loopChance: 0.55, pillarChance: 0.02 }, EDGE);
// 依据：layout「上层走廊转弯更多」——straightness 不能单独调（须全层一致），改用更高的内部墙密度和回路概率制造更曲折的观感
const UPPER = Object.assign({ wallDensity: 0.52, roomChance: 0.10, maxRooms: 1, roomSize: [2, 2], loopChance: 0.62, pillarChance: 0.04 }, EDGE);
// 依据：landmarks「货舱：巨型集装箱铺满底部…集装箱摆放别扭，堵塞部分走廊和门口」——低墙密度的开阔仓，靠散落的集装箱当障碍物
const CARGO = Object.assign({ wallDensity: 0.05, roomChance: 0, loopChance: 0.2, pillarChance: 0.18 }, EDGE);
// 验收修复（低优先级项）：hulldoor 改用货舱分区后，货舱本身的墙密度 0.05 太稀，pickEdge 经常找不到墙段建门；
// 只给"舱门所在的那一格货舱"单独提一点墙密度，不影响其余普通货舱格子的"开阔仓"观感
const CARGO_DOOR = Object.assign({}, CARGO, { wallDensity: 0.16 });
// 依据：landmarks「轮机舱：比其他区域凌乱得多，地上散落杂物」
const ENGINE = Object.assign({ wallDensity: 0.42, roomChance: 0.12, maxRooms: 1, roomSize: [2, 2], loopChance: 0.4, pillarChance: 0.06 }, EDGE);

const ROOM_RECT = { i0: 3, j0: 3, w: 2, d: 2 };          // sleep / flooded 共用的固定房间格
const BRIDGE_RECT = { i0: 2, j0: 2, w: 4, d: 4 };        // 导航舰桥，稍大一点摆得下控制台

// ---------- 材质 ----------
// 依据：colors「走廊：蓝色地板、白色墙壁」；materials「走廊为金属结构，天花板有管道和电线」
// 验收修复（medium 项）：原来墙用共享的通用 'metal' 拉丝贴图（灰底），乘上偏浅的染色也只到中灰，加上天花板用
// 办公室矿棉板贴图，验收截图看着像"office maze"而不是船。这里专门画两张贴图：白漆钢板拼板缝+铆钉当墙，
// 铆接钢板当天花板，跟其余楼层的"通用金属"区分开，才认得出是「金属走廊、白墙、天花板有管道电线」
// 仓库里没有对应 jpg，只用程序化画法：noFile 跳过文件探测，免得每次进层都报 404
BR.assets.registerProcedural('l17_wall_bulkhead', 256, (g, s) => {
  const r = U.rng('l17_wall_bulkhead');
  g.fillStyle = '#dee3e7'; g.fillRect(0, 0, s, s);   // 白漆钢板底色
  for (let k = 0; k < 260; k++) {
    const v = 190 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.10)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
  // 横向拼板缝（把一整面墙分成三段）+ 缝上的铆钉列，做出板材拼接的形状感，不是纯色方块（规则⑤）
  const seams = [s * 0.34, s * 0.68];
  g.fillStyle = 'rgba(120,128,134,0.55)';
  for (const sy of seams) g.fillRect(0, sy - 1, s, 2);
  g.fillStyle = 'rgba(90,60,40,0.10)';
  for (const sy of seams) g.fillRect(0, sy + 1, s, 1);   // 缝下方一条淡淡的锈痕
  const rivetR = s * 0.012;
  for (const sy of seams) {
    for (let x = rivetR * 3; x < s; x += s / 8) {
      g.fillStyle = '#9aa0a4'; g.beginPath(); g.arc(x, sy, rivetR, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - rivetR * 0.3, sy - rivetR * 0.3, rivetR * 0.4, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = 'rgba(120,128,134,0.4)';
  g.fillRect(s * 0.02, 0, 2, s); g.fillRect(s * 0.98, 0, 2, s);   // 左右竖向拼缝
}, { noFile: true });
BR.assets.registerProcedural('l17_ceiling_deck', 256, (g, s) => {
  const r = U.rng('l17_ceiling_deck');
  g.fillStyle = '#9aa0a4'; g.fillRect(0, 0, s, s);   // 铁灰色钢板天花，区别于办公矿棉吸音板
  for (let k = 0; k < 300; k++) {
    const v = 128 + (r() * 44 | 0);
    g.fillStyle = `rgba(${v},${v},${v + 2},0.12)`;
    g.fillRect(r() * s, r() * s, 2, 2);
  }
  // 验收修复（medium 项④）：原来横竖都画缝线，贴图反复铺开后连成整齐的方格，跟验收吐槽的办公矿棉吊顶
  // 一个模样；改成只沿一个方向画三条纵向加强筋（对应走廊纵深方向），贴图沿走廊铺开时缝线首尾相接，
  // 看起来像贯穿的长条加强筋，不再形成网格
  const ribs = [s * 0.22, s * 0.5, s * 0.78];
  g.fillStyle = 'rgba(55,58,62,0.55)';
  for (const rx of ribs) g.fillRect(rx - 1, 0, 2, s);
  g.fillStyle = 'rgba(200,204,208,0.16)';
  for (const rx of ribs) g.fillRect(rx + 1, 0, 1, s);   // 加强筋侧面高光，做出凸起的形状感（规则⑤）
  const rivetR = s * 0.011;
  for (const rx of ribs) {
    for (let y = s * 0.08; y < s; y += s / 5) {
      g.fillStyle = '#787e82';
      g.beginPath(); g.arc(rx, y, rivetR, 0, Math.PI * 2); g.fill();
    }
  }
}, { noFile: true });
function defineMaterials() {
  kit.mats({
    'L17:wall':   { tex: 'l17_wall_bulkhead', repeatMeters: 2.4, roughness: 0.7, color: 0xffffff },
    'L17:floor':  { tex: 'metal', repeatMeters: 2.2, roughness: 0.55, color: 0x1f5c86 },
    'L17:ceiling': { tex: 'l17_ceiling_deck', repeatMeters: 1.8, roughness: 0.85, color: 0xc7ccd0 },
    // 依据：landmarks「豪华舱室：内饰更奢华」——没有细节可循，取暖色地毯+暖木墙面近似
    'L17:floorLux': { tex: 'carpet_light', repeatMeters: 1.8, roughness: 1, color: 0x8a6a3c },
    // 依据：landmarks「货舱」——比主走廊更脏更冷的金属色
    'L17:wallCargo': { tex: 'metal', repeatMeters: 2.6, roughness: 0.9, color: 0x8a9096 },
    'L17:floorCargo': { tex: 'metal', repeatMeters: 2.4, roughness: 0.85, color: 0x274056 },
    // 依据：landmarks「轮机舱：比其他区域凌乱得多」——暗油污色
    'L17:wallEngine': { tex: 'metal', repeatMeters: 2.6, roughness: 1, color: 0x56524a },
    'L17:floorEngine': { tex: 'concrete_wet', repeatMeters: 2, roughness: 1, color: 0x33302a },
    // 依据：exits[3]「长而窄的木制走廊」——复用已有踢脚线木纹贴图铺大面积当墙板/地板
    'L17:wallWood': { tex: 'baseboard_wood', repeatMeters: 1.4, roughness: 0.8, color: 0x9c744a },
    'L17:floorWood': { tex: 'baseboard_wood', repeatMeters: 1.2, roughness: 0.85, color: 0x7a5836 },
  });
}

// ---------- 小工具 ----------
function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}
function roomWallEdges(g, i0, j0, w, d) {
  return g.edges({ wall: true, interior: true }).filter(e =>
    (e.axis === 'h' && e.i >= i0 && e.i < i0 + w && (e.j === j0 || e.j === j0 + d)) ||
    (e.axis === 'v' && e.j >= j0 && e.j < j0 + d && (e.i === i0 || e.i === i0 + w)));
}
function shade(hex, delta) {
  const cl = v => Math.max(0, Math.min(255, v + delta));
  return (cl((hex >> 16) & 255) << 16) | (cl((hex >> 8) & 255) << 8) | cl(hex & 255);
}

// ---------- 主层脊走廊 + 两侧小舱室（验收修复，medium 项）----------
// 依据：landmarks「主层：笔直走廊，两侧是小舱室」——通用迷宫参数（wallDensity/roomChance）随机出来的
// 效果认不出这句话；这里给主层普通走廊/舱室区块（未被强制出口占用的 corridor/cabin）钉死一条贯穿整块的
// 直走廊，出生区块本身也是 corridor，一并受益。必须在 kit.gridWalls 之前调用（规则⑧），只做 setWall(false)
// 打开洞口和统计舱室格，实际的门+补墙留给 buildChunk 在 gridWalls 之后一起建（跟出口门同一套写法）
const SPINE_ROW = N >> 1;   // N=8 → 固定第 4 行；不吃 rng，逐块都在同一行成脊，保证"笔直"是整层特征而非偶然
function buildMainSpine(g, kind, rng) {
  for (let i = 1; i < N; i++) g.setWall('v', i, SPINE_ROW, false);   // 走廊本身贯穿打直，不留断点
  // setWall(false) 只清墙，不清柱子；MAIN.pillarChance 虽然只有 0.02，但万一有根柱子恰好卡在走廊边界上，
  // 打直的走廊里凭空立一根柱子会比迷宫墙更显眼，顺手扫掉
  g.pillars = g.pillars.filter(p => p.j !== SPINE_ROW && p.j !== SPINE_ROW + 1);
  if (kind !== 'cabin') return [];
  const cabins = [];
  for (const jr of [SPINE_ROW - 1, SPINE_ROW + 1]) {
    const wallJ = jr < SPINE_ROW ? SPINE_ROW : SPINE_ROW + 1;   // 该舱室与走廊之间共享的那条 h 墙
    for (let i = 0; i < N; i++) {
      if (rng() >= 0.5) continue;   // 原文没给舱室间距，取一半密度，免得变成两排严丝合缝的排屋
      g.setWall('h', i, wallJ, false);
      g.reserve(i, jr);   // 舱室里马上要摆床/柜子，不再让 gridSpawns 在同一格里插一个刷新点
      cabins.push({ i, jr, wallJ });
    }
  }
  return cabins;
}
// 走廊<->舱室之间的门（纯装饰，不是出口）：先前 buildMainSpine 已经 setWall(false) 打开了整条 h 边，
// 这里跟出口门同一套 wallWithOpening 手法把门框以外的部分补上墙，不会漏出一个 3m 宽的裸豁口
function buildCabinDoors(b, cabins, wallKey) {
  for (const c of cabins) {
    const x = (c.i + 0.5) * CELL, z = c.wallJ * CELL;
    kit.prop.door(b, x, z, 0, { style: 'metal', color: 0x767c82, wall: { matKey: wallKey, w: CELL, h: H } });
  }
}

// ---------- 天花板管道与电线（依据：materials「天花板有管道和电线」，主层/上层通用特征）----------
// 验收修复（medium 项）：原来两条管子分别贴在区块两条边缘（z=1.2 / SIZE-1.2），出生点四个方向都看不到；
// 改成贯穿区块中轴线的十字后，交叉点又刚好和出生点 (mid,mid) 重合——出生点朝任意基本方向看正好是"正对着
// 管子轴线看过去"，透视收缩成一根从天花板垂到半空的怪竖条。把交叉点往斜后方挪开 2m（仍在出生室范围内），
// 四个方向看到的都是管子斜穿过天花板的正常侧面，不再和视线共线；再加一条更细更暗的电缆束（呼应"有管道和电线"）
function decorateCeilingPipes(b) {
  const OFF = 2;
  const px = SIZE / 2 + OFF, pz = SIZE / 2 - OFF;
  // 验收修复（low 项②）：交叉点偏离区块正中心 OFF 米（避开和出生点视线共线，见上方注释），但管长原来还是
  // 接近整块宽度(SIZE-1)，偏移+半长一算，偏出的那一侧会伸出本区块边界 1.5m、悬在邻块半空；
  // 减去 2×OFF 再留 1m 余量，保证不管往哪个方向偏，两端都留在本区块内
  const len = SIZE - 2 * OFF - 1;
  kit.prop.pipe(b, px, pz, 0, { axis: 'x', length: len, y: H - 0.14, r: 0.05, color: 0x8a8f94 });
  kit.prop.pipe(b, px, pz, Math.PI / 2, { axis: 'x', length: len, y: H - 0.26, r: 0.04, color: 0x6d7378 });
  kit.prop.pipe(b, px, pz + 0.3, 0, { axis: 'x', length: len, y: H - 0.36, r: 0.018, color: 0x232527 });
}

// ---------- 荧光灯（依据：lighting「走廊为荧光灯」——原文没说损坏比例，按办公层惯例给少量坏灯/闪烁）----------
function decorateLights(b, g, rng, dim) {
  for (let j = 0; j < g.rows; j += 2) {
    for (let i = 0; i < g.cols; i += 2) {
      const r = rng();
      const state = r < 0.04 ? 'broken' : r < 0.12 ? 'flicker' : 'on';
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, {
        y: H, state, flicker: 0.3 + rng() * 0.4,
        color: dim ? 0xcfe0ea : 0xeaf2fb, intensity: dim ? 0.75 : 1.0, range: 8,
      });
    }
  }
}

// ---------- 舱室：睡觉即传送到 Level 18（依据：exits[0]"主出口，在本层睡觉"；豪华舱室偶尔出现）----------
// makeExit=false 用于验收修复新增的走廊两侧小舱室（见 buildMainSpine）：只摆床铺当家具，不建传送触发，
// 避免一整块脊走廊两侧十几间舱室全部变成可以睡觉离开的出口，稀释掉 exits[0] 本来"主出口"的定位
function decorateSleepCabin(b, rect, rng, forceLuxury, makeExit) {
  const x0 = rect.i0 * CELL, z0 = rect.j0 * CELL, w = rect.w * CELL, d = rect.d * CELL;
  const luxury = forceLuxury != null ? forceLuxury : rng() < 0.15;
  if (luxury) b.plane(x0 + w / 2, 0.01, z0 + d / 2, w - 0.3, d - 0.3, 'L17:floorLux', { facing: 'up' });
  kit.prop.bed(b, x0 + 0.9, z0 + 0.9, 0, { color: luxury ? 0xcaa15a : 0xb7c2cc, frameColor: luxury ? 0x6a4a26 : 0x545a60 });
  kit.prop.cabinet(b, x0 + w - 0.5, z0 + d - 0.5, Math.PI, { kind: 'locker', w: 0.6, h: 1.7, color: luxury ? 0x8a6a3c : 0x6c7278 });
  // 豪华舱室存有杏仁水/Moth Jelly（依据：landmarks「豪华补给舱室，存有杏仁水、Moth Jelly 等必需品」）——留一个安全刷新点
  if (luxury) b.spawn(x0 + w - 1.1, z0 + 0.7, 'floor', { safe: true });
  if (makeExit === false) return;
  // 原文没给"睡多久才传送"的精确时长，取 4 秒代表"躺下入睡"的动作，太短会误触发、太长会显得卡住
  const h = kit.exit(b, { to: '18', kind: 'zone', x: x0 + 0.9, z: z0 + 0.9, radius: 0.9, active: false, label: '躺下睡一会儿' });
  const w0 = b.world(x0 + 0.9, z0 + 0.9);
  let dwell = 0, toasted = false;
  b.update((dt) => {
    const dx = BR.player.x - w0.x, dz = BR.player.z - w0.z;
    if (dx * dx + dz * dz < 0.9 * 0.9) {
      dwell += dt;
      if (!toasted) { toasted = true; BR.hud.toast('床看起来很有诱惑力……躺一会儿说不定能换个地方醒来', 2200); }
      if (dwell >= 4 && !h.active) h.setActive(true);
    } else {
      dwell = 0; toasted = false;
      // 验收修复（low 项）：原来离开后只重置计时，没有把已经激活的出口关掉，之后随便碰一下就会立刻传送；
      // 离开范围时把它关回去，得重新老实躺够 4 秒才会再触发
      if (h.active) h.setActive(false);
    }
  });
}
// 验收修复（medium 项）：原来舱室来自 kit.grid 通用 roomChance 随机开的房间，跟走廊之间要么完全打通、
// 要么随机才有墙，读不出"走廊两侧排布小舱室、各自开门"的识别度；现在改成吃 buildMainSpine 算好的固定
// 舱室格列表，每间给一张床/柜子当家具，走廊到舱室之间那扇门在 buildChunk 里统一建（跟脊走廊的墙一起处理）
function decorateCabinRooms(b, cabins, rng) {
  let sleepBudget = 2;   // 沿用原来 kit.grid maxRooms:2 的量级，避免一整条脊走廊塞满几十张能睡的床改变游戏节奏
  for (const c of cabins) {
    const makeExit = sleepBudget > 0 && rng() < 0.5;
    if (makeExit) sleepBudget--;
    decorateSleepCabin(b, { i0: c.i, j0: c.jr, w: 1, d: 1 }, rng, null, makeExit);
  }
}

// ---------- 被淹走廊：久留会被冲到 Level 7（依据：hazards「不建议长时间停留，最终会被传送到 Level 7」）----------
function decorateFlooded(b, rect) {
  const x0 = rect.i0 * CELL, z0 = rect.j0 * CELL, w = rect.w * CELL, d = rect.d * CELL;
  b.plane(x0 + w / 2, 0.05, z0 + d / 2, w - 0.3, d - 0.3, 'kit:water', { facing: 'up' });
  const rad = Math.min(w, d) / 2 - 0.2;
  const h = kit.exit(b, { to: '7', kind: 'zone', x: x0 + w / 2, z: z0 + d / 2, radius: rad, active: false, label: '被淹的走廊——久留会被冲走' });
  const w0 = b.world(x0 + w / 2, z0 + d / 2);
  let dwell = 0, toasted = false;
  b.update((dt) => {
    const dx = BR.player.x - w0.x, dz = BR.player.z - w0.z;
    if (dx * dx + dz * dz < rad * rad) {
      dwell += dt;
      if (!toasted) { toasted = true; BR.hud.toast('水没过了脚踝，最好别在这儿待太久……', 2000); }
      if (dwell >= 7 && !h.active) h.setActive(true);   // 原文只说"足够长时间"，取 7 秒
    } else {
      dwell = 0; toasted = false;
      if (h.active) h.setActive(false);   // 验收修复（low 项）：离开积水区要把已激活的出口关掉，不然回来轻轻一碰就传送
    }
  });
}

// ---------- 导航舰桥（依据：landmarks「导航舰桥…舵轮可转但只是模拟转向；大量不能用的电脑、前厅地图、无线电设备、服务器机箱」）----------
function decorateBridge(b, g, rect, rng) {
  const x0 = rect.i0 * CELL, z0 = rect.j0 * CELL, w = rect.w * CELL, d = rect.d * CELL;
  const cx = x0 + w / 2, cz = z0 + 0.9;
  // 舵轮：kit 没有专用构件，自己拼；引擎没有通用交互 API（见 apiRequests），做成常态展示的静态装饰，不做"转动但不改变航向"的交互反馈
  b.push(cx, cz, 0);
  // 验收修复（medium 项）：控制台底座原来 y=0.5 起，落地和台面之间悬空 0.5m；舵轮又摆在底座正中心，
  // 只有轮辐边缘露在箱体外面。现在底座落地(y=0)、挪到舵轮身后，舵轮挪到台面前方、稍高于台面，两者不再互相穿插
  b.box(0, 0, -0.35, 0.6, 1.0, 0.5, 'kit:prop', { color: 0x4a4642 });   // 控制台底座
  b.cylinder(0, 1.1, 0.05, 0.46, 0.05, 'kit:prop', { axis: 'z', color: 0x352f26, segments: 14 });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.box(Math.cos(a) * 0.4, 1.1 + Math.sin(a) * 0.4, 0.05, 0.05, 0.05, 0.1, 'kit:prop', { color: 0x241f1a }); }
  b.pop();
  kit.prop.desk(b, x0 + 0.9, z0 + d - 0.9, Math.PI, { w: 1.6, monitor: true, screen: 0x0a2a3a });
  kit.prop.cabinet(b, x0 + w - 0.7, z0 + d - 0.9, Math.PI, { kind: 'file', w: 0.6, h: 1.8, color: 0x4a4e52 });
  kit.prop.cabinet(b, x0 + w - 0.7, z0 + d - 1.7, Math.PI, { kind: 'file', w: 0.6, h: 1.8, color: 0x4a4e52 });
  kit.prop.chair(b, x0 + 0.9, z0 + d - 1.6, 0, { color: 0x33302c });
  // 依据：weather「船外为看似无尽的海洋」——窗外只做纯色发光近似，没有真实天空盒
  const edges = roomWallEdges(g, rect.i0, rect.j0, rect.w, rect.d);
  if (edges.length) {
    const ed = edges[(rng() * edges.length) | 0];
    // 验收修复（high 项②/⑦）：窗户原来直接摆在墙中心线上，窗框半深 0.06 < 墙半厚 0.133，被整面实墙吞掉，
    // 舰桥里根本看不见；现在沿边法线挪向房间内侧（用房间中心判断哪一侧是"内"），让窗户露出墙面
    const nx = Math.sin(ed.rot), nz = Math.cos(ed.rot);
    const roomCx = x0 + w / 2, roomCz = z0 + d / 2;
    const sign = ((roomCx - ed.x) * nx + (roomCz - ed.z) * nz) >= 0 ? 1 : -1;
    const off = 0.2 * sign;
    kit.prop.window(b, ed.x + nx * off, ed.z + nz * off, ed.rot, { w: 1.3, h: 1.4, y: 0.7, mullions: false, tint: 0x1c3a52, glow: 0x2c5878 });
  }
}

// ---------- 上层发光门窗：站在光里会像溺水一样窒息（依据：hazards「直接站在光中会开始像溺水一样窒息，持续到离开光照或窒息死亡」）----------
function decorateWindows(b, g, rng) {
  if (rng() >= 0.6) return;   // 不是每块都有，但比例较高，体现"上层转弯更多、窗户密集"的观感
  const edges = g.edges({ wall: true, interior: true });
  if (!edges.length) return;
  const ed = edges[(rng() * edges.length) | 0];
  // 验收修复（high 项②/⑦）：窗户原来贴在墙中心线，窗框(半深0.06)整个被 0.133m 厚的实墙吞掉，两侧都看不见，
  // 危害判定又只按平面距离算，隔着墙也会扣血；现在把窗户挪到边法线一侧（露出墙面），伤害判定只认同一侧
  const nx = Math.sin(ed.rot), nz = Math.cos(ed.rot);
  const off = 0.2;   // 墙半厚 0.133 + 窗框半深 0.06 + 一点余量，确保窗完全露在墙外（规则⑦ ≥0.15m 下限）
  const wx = ed.x + nx * off, wz = ed.z + nz * off;
  // 依据：materials「上层窗与门看似玻璃，但打不开也无法损坏」——不拆墙、不留通路，窗户是封死的墙面装饰
  kit.prop.window(b, wx, wz, ed.rot, { w: 1.1, h: 1.5, y: 0.6, mullions: false, tint: 0xbfe6ff, glow: 0x9fd8ff });
  const planeBase = b.world(ed.x, ed.z);
  const w0 = b.world(wx, wz);
  let dwell = 0, warned = false;
  b.update((dt) => {
    const px = BR.player.x - planeBase.x, pz = BR.player.z - planeBase.z;
    const side = px * nx + pz * nz;   // >0 才是窗户真正露出、会发光的一侧，隔着墙的另一侧不再触发
    const dx = BR.player.x - w0.x, dz = BR.player.z - w0.z;
    if (side > 0 && dx * dx + dz * dz < 1.1 * 1.1) {
      dwell += dt;
      if (!warned) { warned = true; BR.hud.toast('那道光让人喘不过气……像是要溺水了', 1800); }
      if (dwell >= 1.0) {
        dwell = 0;
        BR.audio.play('heartbeat', [w0.x, 0, w0.z]);
        if (BR.game.attackPlayers) BR.player.damage({ hp: 3, sanity: 0.8, source: 'hazard:upper-window-light' });
      }
    } else { dwell = 0; warned = false; }
  });
}

// ---------- 集装箱（依据：landmarks「货舱：巨型集装箱铺满底部…摆放别扭，堵塞部分走廊和门口」）----------
function buildContainer(b, x, z, rot, rng) {
  const palette = [0x8a2c22, 0x1f5c86, 0x2c6b3a, 0x8a6a1c, 0x55585c];
  const color = palette[(rng() * palette.length) | 0];
  const len = 3.6 + rng() * 1.6;
  const hw = 1.05, hh = 2.2;   // 半宽 1.05、总高 2.2（原文没给尺寸，按缩小版 ISO 集装箱近似）
  b.push(x, z, rot);
  b.box(0, 0, 0, hw * 2, hh, len, 'kit:prop', { color });   // 箱体本身就是唯一的碰撞体，其余细节都是外观（solid:false）
  // 验收修复（high 项⑤）：原来的"瓦楞棱线"是两条贴着中心线的通长横梁，外沿(1.045)反而缩在箱体表面(1.05)以内，
  // 完全被主体吞掉看不见；y 又从 1.1 到 3.0，比箱顶(2.2)、层高(2.8)都高，穿出了天花板。
  // 现在改成沿两条长边真正凸出表面之外的多条竖直瓦楞条，高度也收在箱体内，再加角件、顶沿和简化端门，
  // 避免看起来是一块纯色长方块（规则⑤）
  const ribGap = 0.5, ribN = Math.max(3, Math.round(len / ribGap));
  const ribOut = hw + 0.02;   // 凸出箱体表面 2cm，确保露在外面而不是被吞掉
  for (const sx of [-1, 1]) {
    for (let k = 0; k < ribN; k++) {
      const rz = -len / 2 + 0.3 + k * (len - 0.6) / Math.max(1, ribN - 1);
      b.box(sx * ribOut, 0.15, rz, 0.03, hh - 0.35, 0.07, 'kit:prop', { color: shade(color, -24), faces: 'sides', solid: false });
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // 四角立柱（角件观感），顶端略微凸出箱顶
    b.box(sx * (hw + 0.025), 0, sz * (len / 2 - 0.06), 0.1, hh + 0.05, 0.1, 'kit:prop', { color: shade(color, -34), faces: 'sides', solid: false });
  }
  b.box(0, hh, 0, hw * 2 - 0.08, 0.05, len - 0.08, 'kit:prop', { color: shade(color, -34), solid: false });   // 顶部边沿
  // 两端简化端门：竖缝面板 + 一对锁杆，暗示"门"而不是纯色端面（引擎没有可开关的门交互 API，规则⑥，只做外观）
  for (const sz of [-1, 1]) {
    b.box(0, 0.15, sz * (len / 2 + 0.012), hw * 2 - 0.2, hh - 0.3, 0.024, 'kit:prop', { color: shade(color, -40), solid: false });
    for (const sx2 of [-0.55, 0.55]) b.box(sx2, 0.15, sz * (len / 2 + 0.03), 0.05, hh - 0.3, 0.02, 'kit:prop', { color: 0x2a2a2a, faces: 'sides', solid: false });
  }
  b.pop();
}
// 验收修复（medium 项②③）：集装箱原来是连续随机坐标，不管格子边界、也不 reserve，箱体可能卡进墙里，
// 或者跟 gridSpawns 撒的刷新点/其它构件重叠。现在按格子对齐成 2×1（或 1×2）的整格 footprint，reserve 占用的
// 格子、carve 掉两格之间的内墙（必须在 kit.gridWalls 之前做，规则⑧）——container 最长 5.2m，半长 2.6m，
// footprint 半长 3m（两格），四角富余 ≥0.4m，不会碰到 footprint 边界上可能存在的墙或柱子。
// hulldoor 场景下舱门两侧的格子已经在 buildChunk 里提前 reserve 过，isReserved 检查会自动跳过，不用再传坐标判断距离
function pickContainerSlots(g, rng, count) {
  const slots = [];
  for (let k = 0; k < count; k++) {
    const alongX = rng() < 0.5;
    const w = alongX ? 2 : 1, d = alongX ? 1 : 2;
    const cands = [];
    for (let j = 0; j + d <= g.rows; j++) {
      for (let i = 0; i + w <= g.cols; i++) {
        let ok = true;
        for (let jj = j; jj < j + d && ok; jj++) for (let ii = i; ii < i + w && ok; ii++) {
          if (g.isReserved(ii, jj)) ok = false;
        }
        if (ok) cands.push({ i, j, w, d });
      }
    }
    if (!cands.length) break;   // 格子被占满了，宁可少摆几个也不让箱子叠在一起
    const c = cands[(rng() * cands.length) | 0];
    for (let jj = c.j; jj < c.j + c.d; jj++) for (let ii = c.i; ii < c.i + c.w; ii++) g.reserve(ii, jj);
    g.carve(c.i, c.j, c.w, c.d);
    slots.push({ x: (c.i + c.w / 2) * CELL, z: (c.j + c.d / 2) * CELL, rot: alongX ? Math.PI / 2 : 0 });
  }
  return slots;
}
function decorateCargoHold(b, slots, rng) {
  for (const s of slots) buildContainer(b, s.x, s.z, s.rot, rng);
}

// ---------- 轮机舱（依据：landmarks「轮机舱：比其他区域凌乱得多…有引擎控制室，发电机和引擎正常运转」）----------
function decorateEngineRoom(b, rng) {
  const cx = SIZE / 2, cz = SIZE / 2;
  b.cylinder(cx, 0, cz, 1.1, 1.6, 'kit:prop', { color: 0x3a3a3e, segments: 12 });
  // 验收修复（低优先级项）：pipe 的签名是 (b,x,z,rot,opts)，原来把"离地高度"错传成了世界 z 坐标，
  // 两根管子因此跑到区块边缘（z=1.0/1.4）而不是引擎缸体旁边；改成 z 传 cz、高度用 opts.y
  kit.prop.pipe(b, cx - 1.7, cz, Math.PI / 2, { axis: 'x', length: 2.2, r: 0.09, color: 0x555a5e, y: 1.0 });
  kit.prop.pipe(b, cx + 1.7, cz, Math.PI / 2, { axis: 'x', length: 2.2, r: 0.07, color: 0x4a4e52, y: 1.4 });
  // 依据：hazards「地上散落倒着或立着的杂物：绊倒风险」——引擎没有减速/绊倒判定（见 apiRequests），只做视觉杂物
  for (let k = 0; k < 3; k++) {
    const a = rng() * Math.PI * 2, r = 2.2 + rng() * 1.6;
    // 验收修复（低优先级项）：crate 的签名是 (b,x,z,rot,opts)，原来漏了 rot 参数，size/color 全落回默认值
    kit.prop.crate(b, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0, { size: 0.5 + rng() * 0.3, color: 0x4a463e });
  }
}

// ---------- 出口：船体舱门 / Supply Room 门 / 俄文门（依据：exits[2]描述段落 + exits[6] + exits[7]）----------
// 验收修复（high 项①，规则⑧）：选边、setWall(false)、reserve 必须在 kit.gridWalls 之前做，否则 gridWalls
// 已经把整段实墙的几何和碰撞体建好了，之后再拆墙是空操作——门框(jd=0.16)、noclip 补丁全部被埋进 0.267m 厚的
// 实墙里，玩家看到的只是一堵平墙。现在把选边+拆墙挪到 buildChunk 里 gridWalls 之前（见 buildChunk），
// 这两个函数只负责在已经真正打开的洞口上建门/建管道，不再自己拆墙
function buildDoorExit(b, ed, opts) {
  if (!ed) return;
  kit.exit(b, {
    to: opts.to, kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: opts.style || 'metal',
    // 验收修复（medium 项①，规则⑧）：原来没传 door.wall，gridWalls 已经把整段墙(cellW=3m)整块拆掉后，
    // 门框只占 1.06m 宽，两侧各留出约 1m 的豁口没有补墙；照 L14/L20 的写法把剩下的墙用 wallWithOpening 补回去
    label: opts.label, door: { color: opts.color, sign: opts.sign, wall: { matKey: opts.wallKey, w: ed.len, h: H } },
  });
  if (opts.warn) {
    const w0 = b.world(ed.x, ed.z);
    let warned = false;
    b.update(() => {
      const dx = BR.player.x - w0.x, dz = BR.player.z - w0.z, d2 = dx * dx + dz * dz;
      if (!warned && d2 < 2.6 * 2.6) { warned = true; BR.hud.toast('警告：舱门外是无边海水，打开就会被吸出船外……', 2400); }
      else if (warned && d2 > 4 * 4) warned = false;
    });
  }
}
function buildNoclipPipe(b, ed) {
  if (!ed) return;
  kit.exit(b, { to: '2', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: 'L17:wall', label: '钻进走廊里的管道，可能会切到别处' });
  // 验收修复（low 项③）：标签写"管道"，但原来只贴了一块会抖动的墙面补丁，没有对应的管道造型；
  // 沿墙面法线方向（rot 的约定跟窗户一致）加一段真正的管道几何，一半没入墙里、一半探进房间，视觉上对上文字
  kit.prop.pipe(b, ed.x, ed.z, ed.rot, { axis: 'z', length: 1.0, y: 1.1, r: 0.16, color: 0x6d7278 });
}
function placeSpiralStairs(b, g, rng) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  g.reserve(cell.i, cell.j);
  // 验收修复（medium 项，规则⑧）：kit.exit(kind:'stairs') 内部自己会调 prop.stairwell 建一套楼梯，
  // 原来这里又手动摆了一套（down:false），两套楼梯叠在了一起；现在把参数原样并进 exit 的 stairs 选项，只建一次
  kit.exit(b, { to: '54', kind: 'stairs', x: cell.x, z: cell.z, radius: 0.8, stairs: { down: false, w: 1.2, depth: 2.4, steps: 7, sign: true }, label: '走廊里的螺旋楼梯入口' });
}
function placeWoodExit(b, g, rng) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  g.reserve(cell.i, cell.j);
  kit.exit(b, { to: '27', kind: 'zone', x: cell.x, z: cell.z, radius: 1.0, label: '狭窄的木质走廊，看起来通向别处' });
}

// ---------- 区块 ----------
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const plan = chunkPlan(ctx.levelSeed, cx, cz, rng);
  const { sector, kind } = plan;

  const gopts = sector === 'upper' ? UPPER
    : sector === 'cargo' ? (kind === 'hulldoor' ? CARGO_DOOR : CARGO)
    : sector === 'engine' ? ENGINE : MAIN;
  const g = kit.grid(b, N, N, gopts);

  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J); g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  }
  // 规则⑧：特殊房间必须在 kit.gridWalls 之前 carve
  if (kind === 'sleep' || kind === 'flooded') g.carve(ROOM_RECT.i0, ROOM_RECT.j0, ROOM_RECT.w, ROOM_RECT.d, { room: true });
  if (kind === 'bridge') g.carve(BRIDGE_RECT.i0, BRIDGE_RECT.j0, BRIDGE_RECT.w, BRIDGE_RECT.d, { room: true });
  // 验收修复（低优先级项）：轮机舱的引擎缸体正好卡在网格顶点 (SIZE/2, SIZE/2)=(12,12) 上（i=4,j=4），
  // 原来没有 carve，可能有墙从中间穿过，验收截图发现相机在那卡住；把中心 2×2 格内部墙先拆掉
  if (kind === 'engine') g.carve(N / 2 - 1, N / 2 - 1, 2, 2);

  // 验收修复（high 项①，规则⑧）：门/穿模管道要用的墙段必须在 kit.gridWalls 之前选好、真正拆掉、reserve；
  // 门/管道实体本身仍放到 gridWalls 之后建（在下面的 switch 里用同一个 ed 对象）
  let doorEdge = null, noclipEdge = null;
  if (!isSpawn && (kind === 'hulldoor' || kind === 'supply' || kind === 'russian')) {
    doorEdge = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (doorEdge) {
      g.setWall(doorEdge.axis, doorEdge.i, doorEdge.j, false);
      g.reserve(doorEdge.i, doorEdge.j);
      // 验收修复（medium 项③）：原来只 reserve 门这一侧的格子，货舱那一侧的箱子仍可能贴到门跟前堵门；
      // 把门轴另一侧的格子也占住，pickContainerSlots 的 isReserved 检查就会自动绕开门口两侧
      if (kind === 'hulldoor') {
        if (doorEdge.axis === 'v') g.reserve(doorEdge.i - 1, doorEdge.j);
        else g.reserve(doorEdge.i, doorEdge.j - 1);
      }
    }
  } else if (!isSpawn && kind === 'noclip') {
    noclipEdge = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (noclipEdge) { g.setWall(noclipEdge.axis, noclipEdge.i, noclipEdge.j, false); g.reserve(noclipEdge.i, noclipEdge.j); }
  }
  // 验收修复（medium 项④）：主层普通走廊/舱室区块钉一条贯穿的直走廊脊，两侧挖小舱室（见 buildMainSpine 头部注释）
  const cabins = (sector === 'main' && (kind === 'corridor' || kind === 'cabin')) ? buildMainSpine(g, kind, rng) : [];
  // 验收修复（medium 项②）：货舱集装箱按格子对齐，reserve+carve 都要在 gridWalls 之前做（见 pickContainerSlots）
  const containerSlots = (!isSpawn && (kind === 'hold' || kind === 'hulldoor'))
    ? pickContainerSlots(g, rng, kind === 'hulldoor' ? 2 : 2 + ((rng() * 3) | 0))
    : [];

  const wallKey = sector === 'cargo' ? 'L17:wallCargo' : sector === 'engine' ? 'L17:wallEngine' : (kind === 'wood' ? 'L17:wallWood' : 'L17:wall');
  const floorKey = sector === 'cargo' ? 'L17:floorCargo' : sector === 'engine' ? 'L17:floorEngine' : (kind === 'wood' ? 'L17:floorWood' : 'L17:floor');

  kit.gridWalls(b, g, { matKey: wallKey, trim: { color: 0x384450 } });
  kit.prop.floor(b, null, null, 0, { matKey: floorKey });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L17:ceiling', y: H });

  if (sector === 'main' || sector === 'upper') decorateCeilingPipes(b);
  decorateLights(b, g, rng, sector === 'cargo' || sector === 'engine');

  switch (kind) {
    case 'sleep': decorateSleepCabin(b, ROOM_RECT, rng, false); break;
    case 'flooded': decorateFlooded(b, ROOM_RECT); break;
    case 'bridge': decorateBridge(b, g, BRIDGE_RECT, rng); break;
    case 'cabin': decorateCabinRooms(b, cabins, rng); buildCabinDoors(b, cabins, wallKey); break;
    case 'hold': decorateCargoHold(b, containerSlots, rng); break;
    case 'engine': decorateEngineRoom(b, rng); break;
    case 'hulldoor': decorateCargoHold(b, containerSlots, rng); break;
    default: break;
  }
  if (sector === 'upper' && (kind === 'corridor' || kind === 'spiral')) decorateWindows(b, g, rng);

  if (!isSpawn) {
    if (kind === 'hulldoor') buildDoorExit(b, doorEdge, { to: '7', label: '船体舱门', color: 0x6a5850, warn: true, wallKey });
    else if (kind === 'supply') buildDoorExit(b, doorEdge, { to: '20', label: 'Supply Room', sign: true, color: 0x6c7278, wallKey });
    else if (kind === 'russian') buildDoorExit(b, doorEdge, { to: '245', label: '带俄文标识的门', color: 0x5a5850, wallKey });
    else if (kind === 'wood') placeWoodExit(b, g, rng);
    else if (kind === 'spiral') placeSpiralStairs(b, g, rng);
    else if (kind === 'noclip') buildNoclipPipe(b, noclipEdge);
  }

  kit.gridSpawns(b, g, { safe: kind === 'bridge' });
  return b.finish();
}

// ---------- 层级状态：整层缓慢移动的听觉线索 ----------
// 依据：other「整个层级在缓慢移动，速度时快时慢但从不停下；本层偶尔会摇晃」——引擎没有整体位移/摄像机震动 API
// （见 apiRequests），只能靠周期性的机械声模拟"船体仍在移动"，不做真实的画面晃动
const S = { driftTimer: 0, driftEpoch: -1 };

BR.levels.register({
  id: '17', name: 'Level 17', title: 'Abandoned Carrier', nickname: 'On the waters that surround',
  version: 'fandom',                 // = lore-choices.levels['17'].source
  survivalClass: 'Threat Index: Class 1 —— Safe / Stable / Minimal Entity Count',
  chunkSize: SIZE,
  env: {
    background: 0x11202c, fogColor: 0x11202c, fogNear: 6, fogFar: 40,
    // 依据：lighting「走廊为荧光灯」——正常照明水平，不是无光层
    ambient: { color: 0xe4edf5, intensity: 0.40 },
    // 依据：survivalClass「Safe / Stable」——威胁等级低于普通层级基线
    sanityDrainMul: 0.7, hungerDrainMul: 1,
    audio: 'ocean',   // 依据：sounds「能听到船下方的水声」+ Threat Index 标签「Aquatic」
    darkness: false,
  },
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据：entities[0].density「mostly lacking any significant entities，本层仅有 2 种实体」+
    //   entityDensityOverall「rare / Minimal Entity Count」——原文无数字，取定性密度 rare
    // 注：imprint 的实体文件（js/entities/imprint.js）由本批另一位代理实现，此处先登记 key；
    //   若对方尚未完成，world 会静默跳过直到该文件注册同名 type（规则④，最终统一做一致性核对）
    { type: 'imprint', officialPer1000m2: BR.config.densityWords.rare },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },              // fandom：最常见补水物品，不限层级；用户规则所有模式都刷
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.05 },                // fandom：本层豪华舱室明确提到 Moth Jelly
    { type: 'food_ration', per1000m2: 0.6 },                // 用户规则『所有模式都刷食物』的兜底
  ],
  exits: [
    { to: '18', kind: 'zone', note: '在任意舱室的床边躺一会儿即可传送（原文"在本层睡觉"，主出口）(exits[0])' },
    { to: '7', kind: 'zone', note: '被淹的走廊里多停留一会儿会被冲走（原文只说"足够长时间"，无精确秒数）(exits[1])' },
    { to: '7', kind: 'door', note: '货舱船体舱门，靠近打开就会被吸出船外（描述段落里的出口，不在原列表编号内）(exits[2])' },
    { to: '27', kind: 'zone', note: '狭长的木制走廊；超出首期范围，照原文摆出但 sealed (exits[3])' },
    { to: '2', kind: 'noclip', note: '走廊里的管道，no-clip 切入 (exits[4])' },
    { to: '54', kind: 'stairs', note: '走廊里的螺旋楼梯入口；超出首期范围，sealed (exits[5])' },
    { to: '20', kind: 'door', note: '标着 Supply Room 的门 (exits[6])' },
    { to: '245', kind: 'door', note: '带俄文标识的门；超出首期范围，sealed (exits[7])' },
  ],
  enter(ctx) { S.driftTimer = 0; S.driftEpoch = -1; },
  update(ctx, dt) {
    S.driftTimer += dt;
    const period = 14;
    const epoch = Math.floor(S.driftTimer / period);
    if (epoch !== S.driftEpoch) {
      S.driftEpoch = epoch;
      const r = U.rng(ctx.levelSeed, 'L17-drift', epoch);   // 派生流，不用 Math.random（规则）
      if (r() < 0.7) BR.audio.play('buzz', [BR.player.x, 0, BR.player.z], { volume: 0.22 });
    }
  },
  leave(ctx) {},
});
})();

// ============================================================
// 没有实现的细节（原因见各条）：
//   船的真正"有限规模"（占地数十万平方米，非无限）——引擎是无限流式区块世界，没有"整层封顶面积"的接口，
//     用四个水平分区近似船体分层，实际可走范围仍是无限的（见 apiRequests）。
//   主层/上层/导航舰桥/货舱/轮机舱的真实垂直落差（原文明确写"爬多段楼梯到上层""向下为货舱→更下为轮机舱"）——
//     引擎没有多层楼叠放接口（规则⑥），近似成同一水平面上的四个分区，螺旋楼梯/舵轮等只做静态外观，不做真实上下楼。
//   小舱室"自清洁"（弄乱后离开会自动整理复原）——没有"物品被移动"的持久状态系统，也没有实现摆放家具可被玩家挪动，
//     无法验证也无法表现，未做。
//   轮机舱杂物被挪走后瞬移回原位、轮机舱机器完全不可交互——同上，引擎没有拾取/挪动场景道具的通用交互接口，
//     只摆了静态杂物和机器外观（见 apiRequests：缺少通用非出口场景道具交互 API）。
//   舵轮转动的模拟转向反馈——舵轮只做静态展示，不做"转动但画面假装转弯"的交互（同样缺交互 API）。
//   层级整体缓慢移动、偶尔摇晃的画面表现——引擎没有整体位移/摄像机震动 API（见 apiRequests），只用周期性 buzz 音效近似。
//   Innocuous Windows（无害窗户）作为独立实体——data/entity-index.json 的 entities[] 里没有它（只在 hazards 里作为
//     讨论提示，且未定论"发光门窗是不是这种实体的变种"），也没有 js/entities/windows.js，按规则④不登记为可刷新实体；
//     上层的发光门窗只做静态危害现象（见 decorateWindows）。
//   船外的强力吸力把无人机也一并吸走、外部海况细节——本游戏没有无人机/可探索的"船外"场景，未实现；
//     船体舱门只做"靠近就传送到 Level 7"的近似，不做真实的"被吸出船体"抛体轨迹。
//   多个层级远处可见的"破旧货船"、Level 41/54 方向的入口——这些入口分别属于其它层级文件（41/54 均不在首期范围，
//     也不是本文件能修改的对象），本文件的出生点仅按 fandom 的"Level 16 走廊渐变"主入口做叙事呼应，
//     grep "to: '17'" js/levels/L*.js 目前没有其它已完成层级指向本层，因此没有可对照的入口坐标。
// ============================================================
