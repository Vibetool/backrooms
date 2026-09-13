// Level 9 - "The Suburbs"（郊区）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-9  许可：CC BY-SA 3.0
// 抓取：page revision 114，最后编辑 2026-08-07；原作者 Reddit 用户 u/Bart0nius，Stretchsterz 重写
// 只按这一个版本实现（含同站 entity-96「The Neighborhood Watch」、entity-63「The Mangled」两个子页面——
// 它们在调研里被并入 wikidot-en 版本条目本身，不是 conflicts 里的另一站点）：
// 不做 wikidot-cn 的别名"郊区"译法、不做 fandom 的破败房屋/浓雾10米视距/无实体命名/Level 8.4|13|84 出口等。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// layout「开阔/无限的郊区路网」——户外街区层，chunkSize 取开阔层区间上段（_TEMPLATE 16节 32-48）
const SIZE = 44;
const H = 2.8;                 // builder 缺省层高参数，本层结构大多用不到（房屋自己给 height）
const STREET_HALF = 4;         // 街道半宽：本块贡献4m，邻块另4m，拼成8m宽的湿沥青路（materials「湿的沥青路面」）
const SIDEWALK_W = 1.4;        // materials「石质人行道，正常无异常」
const HOUSE_ROW_Z_NORTH = 9;   // 北排住宅（门朝 -Z，面向北侧街道）
const HOUSE_ROW_Z_SOUTH = SIZE - 9;   // 南排住宅（门朝 +Z，面向南侧街道），两排之间留出后院公共区
const LOT_XS = [12, 22, 32];   // architecture「房屋设计和大小各不相同」——沿街三个固定地块位，宽度在每个位置内自己变化
const ANOMALY_MIN_DIST = 7;    // landmarks「走得太远时会看到两栋互相穿插的房子」——"太远"没给数字，取一个明显超出出生点附近的区块距离
const P_ANOMALY = 0.12;        // 空间异常出现概率，非设定精确值，只体现"偶有/走远了才会"的稀有感
const PG_MX = 4;               // 游乐场按 4×4 区块的宏格判定一次，呼应 landmarks「游乐场」这种"某处会有一个"的地标写法

// ---------- 材质（先想能不能不生成：本层 materials 已能用现成贴图覆盖，不新生成图，见返回值说明）----------
function defineMaterials() {
  kit.mat('L9:street', { tex: 'concrete_wet', repeatMeters: 3.5, roughness: 0.6 });     // materials「湿的沥青路面……路上有水洼」
  kit.mat('L9:sidewalk', { tex: 'concrete', repeatMeters: 2.2, roughness: 0.85 });      // materials「石质人行道，正常无异常」
  kit.mat('L9:grass', { color: 0x33422c, roughness: 1 });   // colors 字段未给具体配色（unverified），用与"整体午夜黑暗"基调相配的暗绿平色
}
// file:// 兜底：草地是纯色材质，没有贴图不需要注册 procedural

// ---------- 地面：街道网格（边缘半幅street）+ 内侧人行道 + 其余草坪 ----------
// 依据：layout「郊区路网」——街道沿区块四边生成，相邻区块各出一半，拼成连续的街道网格，不用格子迷宫（户外开阔层，_TEMPLATE 7.4节）
function buildGround(b) {
  b.plane(SIZE / 2, 0, SIZE / 2, SIZE, SIZE, 'L9:grass', { facing: 'up' });
  b.plane(2, 0.002, SIZE / 2, 4, SIZE, 'L9:street', { facing: 'up' });
  b.plane(SIZE - 2, 0.002, SIZE / 2, 4, SIZE, 'L9:street', { facing: 'up' });
  b.plane(SIZE / 2, 0.002, 2, SIZE, 4, 'L9:street', { facing: 'up' });
  b.plane(SIZE / 2, 0.002, SIZE - 2, SIZE, 4, 'L9:street', { facing: 'up' });
  b.plane(4.7, 0.001, SIZE / 2, SIDEWALK_W, SIZE, 'L9:sidewalk', { facing: 'up' });
  b.plane(SIZE - 4.7, 0.001, SIZE / 2, SIDEWALK_W, SIZE, 'L9:sidewalk', { facing: 'up' });
  b.plane(SIZE / 2, 0.001, 4.7, SIZE, SIDEWALK_W, 'L9:sidewalk', { facing: 'up' });
  b.plane(SIZE / 2, 0.001, SIZE - 4.7, SIZE, SIDEWALK_W, 'L9:sidewalk', { facing: 'up' });
}

// ---------- 房屋 ----------
// 依据：architecture「房屋的设计和大小各不相同」+「相当新」+「没有供照明系统运作的电源」+「有些房子可能是空的」
function houseDesign(rng) {
  const width = 4.6 + rng() * 2.0;    // 具体尺寸未给，只体现"各不相同"，非设定精确值
  const height = 2.6 + rng() * 1.0;
  const hue = rng();
  const palette = [0x4a4d52, 0x5c554a, 0x3f4a3f, 0x55473d]; // colors 未给出具体配色（unverified），取与"整体午夜黑暗"基调相配的中性色循环
  const color = palette[Math.min(palette.length - 1, Math.floor(hue * palette.length))];
  const yardFence = rng() < 0.4;   // landmarks「部分房屋背后有家具齐全的后院」
  const furnished = rng() < 0.5;   // architecture「有些房子可能是空的」——用后院是否摆家具体现"有些空、有些不空"
  return { width, depth: 5.5, height, color, roofColor: 0x24211d, yardFence, furnished };
}

// 单栋房屋：外立面 + 碰撞体（房屋不可进入，规则③：引擎没有多层楼/门锁运行时切换，房屋只做外立面+碰撞体近似）
// isExitHouse：这一栋的正门就是 hazards「进入任意房屋有几率被随机传送到 Level 53」的实物出口
function buildHouse(b, x, z, rot, d, isExitHouse) {
  b.push(x, z, rot);
  b.box(0, 0, 0, d.width, d.height, d.depth, 'kit:prop', { color: d.color, faces: 'sides' });
  b.plane(0, d.height, 0, d.width, d.depth, 'kit:prop', { facing: 'up', color: d.color });   // 顶盖（faces:'sides' 省了顶底）
  b.box(0, d.height, 0, d.width + 0.4, 0.3, d.depth + 0.4, 'kit:prop', { color: d.roofColor, faces: 'noBottom' }); // 屋顶（原文未描述形状，取简化平顶）
  // materials「室内为普通住宅家具……需要电源的物品都不能用」——lighting「照明系统不工作」：窗内一片死黑，不做发光
  kit.prop.window(b, -d.width * 0.28, d.depth / 2, 0, { w: 0.9, h: 0.9, y: 1.1, blackout: true, paint: 0x14161a });
  kit.prop.window(b, d.width * 0.28, d.depth / 2, 0, { w: 0.9, h: 0.9, y: 1.1, blackout: true, paint: 0x14161a });
  if (!isExitHouse) kit.prop.door(b, 0, d.depth / 2, 0, { style: 'wood', color: 0x2a2016, solid: true });
  if (d.furnished) {   // landmarks「部分房屋背后有家具齐全的后院」——简易桌椅示意
    b.box(-0.6, 0.25, -d.depth / 2 - 0.9, 0.5, 0.5, 0.5, 'kit:prop', { color: 0x39332a });
    b.box(0.6, 0.22, -d.depth / 2 - 1.2, 0.35, 0.45, 0.35, 'kit:prop', { color: 0x2e2a24 });
  }
  if (d.yardFence) {
    for (let k = -2; k <= 2; k++) b.box(k * 0.9, 0.4, -d.depth / 2 - 2.2, 0.08, 0.8, 0.08, 'kit:prop', { color: 0x2a2420 });
  }
  b.pop();
  if (isExitHouse) {
    // 门只朝 rot=0（+Z）或 rot=π（-Z）两种，lx=0 时 worldZ = z + depth/2·cos(rot) 与旋转方向无关，直接算即可
    const ez = z + (d.depth / 2) * Math.cos(rot);
    kit.exit(b, {
      to: '53', kind: 'door', x, z: ez, rot, style: 'wood', door: { color: 0x2a2016 },
      label: '房屋正门——有几率被随机传送 → Level 53 (exits[4])',
    });
  }
}

function buildHouseRow(b, rng, centerZ, rot, lots) {
  let prevDesign = null;
  for (const lotX of lots) {
    const rTwin = rng();
    const isTwin = !!prevDesign && rTwin < 0.1;   // landmarks「偶有报告称见过两栋相邻且完全相同的房子」——"偶有"取较低概率，非设定精确值
    const design = isTwin ? prevDesign : houseDesign(rng);
    const rDoorExit = rng();
    const isExitHouse = rDoorExit < 0.22;         // 约两成房子的正门承担 Level 53 出口，非设定精确比例
    buildHouse(b, lotX, centerZ, rot, design, isExitHouse);
    prevDesign = design;
  }
}

function buildNormalBlock(b, rng) {
  buildHouseRow(b, rng, HOUSE_ROW_Z_NORTH, Math.PI, LOT_XS);   // 北排，门朝北街（-Z）
  buildHouseRow(b, rng, HOUSE_ROW_Z_SOUTH, 0, LOT_XS);         // 南排，门朝南街（+Z）
}

// landmarks「走得太远时会看到两栋房子诡异地互相穿插、卡在彼此之中（物理上不可能）」——只替换北排为两栋刻意重叠的房子
function buildAnomalyHouses(b, rng) {
  const d1 = houseDesign(rng), d2 = houseDesign(rng);
  buildHouse(b, 16, HOUSE_ROW_Z_NORTH, Math.PI, d1, false);
  buildHouse(b, 20.5, HOUSE_ROW_Z_NORTH + 1.0, Math.PI * 0.82, d2, false);   // 偏转角度+与第一栋位置重叠，制造"卡在一起"的观感
  buildHouseRow(b, rng, HOUSE_ROW_Z_SOUTH, 0, LOT_XS);
}

// ---------- 箭头街道标志 ----------
// 依据：landmarks「指向 Level 11 的箭头街道标志」——kit 没有箭头构件，杆+一块发光三角旗近似
function buildArrowSign(b, x, z, rot) {
  b.push(x, z, rot);
  b.box(0, 1.6, 0, 0.06, 1.2, 0.06, 'kit:prop', { color: 0x2a2a26 });
  b.quad([-0.3, 2.0, 0.15], [0.3, 2.0, 0.15], [0.15, 2.0, -0.35], [-0.15, 2.0, -0.35], 'kit:glow', { uv: 'solid', color: [1.2, 1.0, 0.3], glow: 0.9 });
  b.pop();
}

// ---------- 街灯 ----------
// 依据：lighting「路灯通常关闭、不运转，有些会忽明忽灭，偶尔甚至通着电」；entity-63 页「无数路灯持续嗡嗡作响，发出昏暗橙光」
function buildStreetlights(b, rng) {
  const poles = [
    { x: 4, z: 4.2, rot: Math.PI }, { x: 22, z: 4.2, rot: Math.PI }, { x: 40, z: 4.2, rot: Math.PI },
    { x: 4, z: SIZE - 4.2, rot: 0 }, { x: 22, z: SIZE - 4.2, rot: 0 }, { x: 40, z: SIZE - 4.2, rot: 0 },
  ];
  for (const p of poles) {
    const state = U.weighted(rng, [['off', 0.55], ['broken', 0.15], ['flicker', 0.22], ['on', 0.08]]);   // 多数关闭，少数闪烁，偶尔通电
    const fl = rng();
    kit.prop.streetlight(b, p.x, p.z, p.rot, { state, color: 0xffb060, intensity: 1.1, range: 10, flicker: 0.5 + fl * 0.3 });
  }
}

// ---------- 沿街电力线 ----------
// 依据：landmarks「沿街电力线」；mechanics「沿电力线走有几率到达 Level 113」
function buildPowerLine(b, rng) {
  const poleH = 5.5, wireY = 5.0, wireZ = 2;
  b.cylinder(2, 0, wireZ, 0.08, poleH, 'kit:prop', { color: 0x2c281f, segments: 6 });
  b.cylinder(SIZE - 2, 0, wireZ, 0.08, poleH, 'kit:prop', { color: 0x2c281f, segments: 6 });
  b.box(SIZE / 2, wireY, wireZ, SIZE, 0.03, 0.03, 'kit:prop', { color: 0x18140f });   // 主干线，跨区块首尾相接
  const r113 = rng();
  if (r113 < 0.05) {
    kit.exit(b, {
      to: '113', kind: 'zone', x: SIZE - 2, z: wireZ, radius: 1.2,
      marker: { color: [0.6, 0.55, 0.3], pulse: false }, label: '顺着电力线一路走，忽然踏进了别处 → Level 113 (mechanics)',
    });
  }
}

// ---------- 枯树 / 街面水洼 ----------
// 依据：environment.other「发现帖提到四周到处是枯树」；hazards「下水道与排水系统、街面水洼」
function buildDeadTreesAndPuddles(b, rng) {
  const treeSpots = [[6, 16], [38, 28], [15, 26], [29, 18]];
  for (const [x, z] of treeSpots) {
    const r = rng();
    if (r < 0.45) {
      b.cylinder(x, 0, z, 0.14, 2.4, 'kit:prop', { color: 0x2a241d, segments: 6 });   // 光秃秃的枯树干，无叶（原文只说"枯树"，具体形态非设定）
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1;
        b.cylinder(x + Math.cos(a) * 0.35, 2.0 + k * 0.15, z + Math.sin(a) * 0.35, 0.03, 0.7, 'kit:prop', { axis: 'x', color: 0x241f19 });
      }
    }
  }
  const puddleSpots = [[2, 2], [SIZE - 2, 2], [2, SIZE - 2], [SIZE - 2, SIZE - 2]];
  for (const [x, z] of puddleSpots) {
    const r = rng();
    if (r < 0.6) {
      const rx = 0.7 + rng() * 0.4, rz = 0.5 + rng() * 0.3;
      kit.prop.puddle(b, x, z, 0, { rx, rz, y: 0.0035 });
    }
  }
}

// ---------- 街道地面裂缝：切出到 Level 60 ----------
// 依据：mechanics「切出（noclip）街道地面到达 Level 60」——落在街道地面而非墙面，用 hole（不挡路的坑）近似"切出地面"
function maybeNoclipHole60(b, rng) {
  const r = rng();
  if (r < 0.05) {
    kit.exit(b, {
      to: '60', kind: 'hole', x: 10, z: 2, radius: 0.9, hole: { r: 0.9, rimColor: 0x1c1a16 },
      label: '街道地面裂开一道缝，切出会掉进 Level 60 (mechanics)',
    });
  }
}

// ---------- 游乐场（宏格地标，_TEMPLATE 4.3节）----------
// 依据：landmarks「游乐场（带白色发光内窗的管道结构）」；exits「爬进带白色发光内窗的管道结构，通常会被传送到 Level 283 的 Tubes」
function isPlaygroundChunk(levelSeed, cx, cz) {
  const mx = Math.floor(cx / PG_MX), mz = Math.floor(cz / PG_MX);
  const mr = U.rng(levelSeed, 'L9-playground', mx, mz);
  const has = mr() < 0.4;   // 按宏格概率出现一次，非设定精确比例
  const hi = mx * PG_MX + Math.floor(mr() * PG_MX), hj = mz * PG_MX + Math.floor(mr() * PG_MX);
  return has && cx === hi && cz === hj;
}

function buildPlayground(b, rng) {
  const cx = SIZE / 2, cz = SIZE / 2;
  for (let k = 0; k < 4; k++) {
    const ang = k / 4 * Math.PI * 2;
    const x = cx + Math.cos(ang) * 3, z = cz + Math.sin(ang) * 3;
    kit.prop.pipe(b, x, z, 0, { axis: 'y', length: 1.6, y: 0, r: 0.35, color: 0x8a8a86 });
    // landmarks「带白色发光内窗的管道结构」——内窗用发光面片近似
    b.plane(x, 1.2, z, 0.5, 0.5, 'kit:glow', { facing: '+x', uv: 'solid', color: [1.4, 1.4, 1.5], glow: 1.2 });
  }
  b.cylinder(cx, 0.9, cz, 0.4, 1.8, 'kit:prop', { color: 0x7c7c78, segments: 8 });   // 中心塔
  b.box(cx + 6, 1.0, cz, 2.4, 0.08, 0.5, 'kit:prop', { color: 0x555550 });          // 秋千横梁（游乐场常见配套，非设定精确细节）
  for (const sx of [cx + 5, cx + 7]) b.box(sx, 0.5, cz, 0.05, 1.0, 0.05, 'kit:prop', { color: 0x555550 });
  kit.exit(b, {
    to: '283', kind: 'hole', x: cx, z: cz, radius: 1.1, hole: { r: 1.0, rimColor: 0xd8d8d0 },
    label: '爬进发光的管道 → Level 283 (exits[8])',
  });
}

// ---------- 机场 ----------
// 依据：landmarks「机场（沿去 Level 11 的路标途中可发现）」；exits「进入机场即被传送到 Level 36」「机场句之后紧跟负数层级切出」
function buildAirport(b, rng) {
  const cx = SIZE / 2, cz = SIZE * 0.62;
  b.plane(cx, 0.003, SIZE * 0.8, SIZE * 0.7, 6, 'L9:sidewalk', { facing: 'up' });   // 跑道意向，原文无更多细节
  b.box(cx, 1.8, cz, 8, 3.6, 5, 'kit:prop', { color: 0x4a4d52, faces: 'sides' });
  b.plane(cx, 3.6, cz, 8.4, 5.4, 'kit:prop', { facing: 'down' });
  kit.prop.window(b, cx - 2.4, cz - 2.5, 0, { w: 1.1, h: 1.0, y: 1.6, blackout: true, paint: 0x14161a });
  kit.prop.window(b, cx + 2.4, cz - 2.5, 0, { w: 1.1, h: 1.0, y: 1.6, blackout: true, paint: 0x14161a });
  kit.exit(b, {
    to: '36', kind: 'door', x: cx, z: cz - 2.5, rot: 0, style: 'metal', door: { color: 0x555b5f },
    label: '机场航站楼入口 → Level 36 (exits[6])',
  });
  const rNeg = rng();
  if (rNeg < 0.4) {
    kit.exit(b, {
      to: '-1', kind: 'noclip', x: cx - 7, z: cz, rot: Math.PI / 2, w: 3, h: 2.4, matKey: 'kit:prop', color: 0x2a2a26,
      label: '机场附近空气裂开一道口子，能切出到最初几个负数层级 (mechanics)',
    });
  }
  buildArrowSign(b, cx, SIZE - 6, 0);
}

// ---------- 路标终点开阔地：Level 11 ----------
// 依据：exits[0]「沿箭头街道标志走 100 到 200 英里」——引擎世界无法还原真实距离，按规则②用固定区块+大半径 zone 出口近似：
// 出生点沿箭头方向走到第 4 个区块，视野忽然开阔，代表"终于走到头"
function buildPortalClearing(b) {
  buildArrowSign(b, SIZE / 2, SIZE / 2, 0);
  b.plane(SIZE / 2, 0.002, SIZE / 2, SIZE * 0.8, SIZE * 0.8, 'L9:sidewalk', { facing: 'up' });
  kit.exit(b, {
    to: '11', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.75,
    marker: { color: [1.0, 0.85, 0.3], pulse: true },
    label: '沿箭头走了很远——视野忽然开阔，像是到了尽头 → Level 11 (exits[0])',
  });
}

// ---------- 草地/田野：Level 9.1（步道尽头，范围外）与 Level 10（走进田野深处，范围内）----------
// 依据：exits[1]「走通往草地的人行步道」→ 9.1；exits[2]「离开步道走进田野」→ 10（原文两处写法本身矛盾，两条都做）
function buildMeadow(b, rng) {
  b.plane(SIZE / 2, 0.003, 6, SIZE * 0.6, 6, 'L9:sidewalk', { facing: 'up' });   // 步道
  for (let k = 0; k < 24; k++) {
    const x = rng() * SIZE, z = 10 + rng() * (SIZE - 14);
    b.box(x, 0.15, z, 0.12, 0.3, 0.12, 'kit:prop', { color: 0x33422c });   // 没过脚踝的杂草丛，示意"田野"，非设定精确形态
  }
  kit.exit(b, {
    to: '9.1', kind: 'zone', x: SIZE / 2, z: 6, radius: 2.2,
    marker: { color: [0.5, 0.7, 0.4], pulse: false }, label: '步道尽头的草地 → Level 9.1 (exits[1])',
  });
  kit.exit(b, {
    to: '10', kind: 'zone', x: SIZE / 2, z: SIZE * 0.72, radius: SIZE * 0.5,
    marker: { color: [0.55, 0.75, 0.35], pulse: true }, label: '离开步道，走进田野深处——忽然到了别处 → Level 10 (exits[2])',
  });
}

// ---------- M.E.G. 营地 "Watchful Wanderer"（郊区边缘，纯静态地标）----------
// 依据：bases「M.E.G. 研究部门的临时营地……一个切进来的集装箱，横在郊区边缘山口中央，朝郊区一面被撕开」
// 用户规则：据点只摆静态建筑与标记，不做交易/交互，不做 NPC 对话
function buildMegCamp(b) {
  const cx = SIZE / 2, cz = SIZE / 2;
  b.box(cx, 1.3, cz, 2.4, 2.6, 6.0, 'kit:prop', { color: 0x35402f, faces: 'sides' });
  b.plane(cx, 2.6, cz, 2.5, 6.2, 'kit:prop', { facing: 'up', color: 0x2c352a });
  kit.prop.sign(b, cx, cz + 3.2, 0, { color: 0x3fa0ff, backColor: 0x1a2430 });
  let toasted = false;
  b.update(() => {
    const P = BR.player, dx = P.x - (b.ox + cx), dz = P.z - (b.oz + cz);
    if (!toasted && dx * dx + dz * dz < 15 * 15) {
      toasted = true;
      BR.hud.toast('一个切进来的集装箱——M.E.G. 在此设了个叫"守望旅人"的临时营地', 2600);
    }
  });
}

// ---------- 撒刷新点（开阔层不用格子，规则网格+抖动，_TEMPLATE 7.4节）----------
function scatterSpawns(b, rng) {
  const n = 6, step = SIZE / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const jx = (rng() - 0.5) * (step - 1), jz = (rng() - 0.5) * (step - 1);
      b.spawn((i + 0.5) * step + jx, (j + 0.5) * step + jz, 'floor');
    }
  }
}

// ---------- 区块入口 ----------
// rng 消耗顺序：（特殊固定坐标区块各走自己的分支，内部各自固定）→ 普通区块：异常判定 → 房屋两排 → 街灯 → 电力线 →
// 枯树/水洼 → 地面裂缝 → 刷新点。固定坐标分支的选择本身不吃 rng（按 cx/cz 直接判定，同 L7 的固定地标写法）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  buildGround(b);

  const isSpawn = cx === 0 && cz === 0;
  // 出口区块每 8 块重复一次（负坐标取正模）：原先整层只有 (4,0) 和 (0,-4) 各一块，往反方向走的玩家在无限郊区里永远找不到出口；
  // 现在从任何位置出发，沿 x 或 z 轴走 4 块内总有一处通往 Level 11 / Level 10
  const mod8 = v => ((v % 8) + 8) % 8;
  const isPortal = mod8(cx) === 4 && mod8(cz) === 0;
  const isAirport = cx === 2 && cz === 0;
  const isMeadow = mod8(cx) === 0 && mod8(cz) === 4;
  const isMeg = cx === 0 && cz === 8;

  if (isPortal) {
    buildPortalClearing(b);
  } else if (isAirport) {
    buildAirport(b, rng);
  } else if (isMeadow) {
    buildMeadow(b, rng);
  } else if (isMeg) {
    buildMegCamp(b);
  } else {
    const rAnomaly = rng();   // 无条件先取（_TEMPLATE 4.2节），是否使用取决于下面的距离判定
    const dist = Math.max(Math.abs(cx), Math.abs(cz));
    const isPg = !isSpawn && isPlaygroundChunk(ctx.levelSeed, cx, cz);
    const isAnomaly = !isSpawn && !isPg && dist >= ANOMALY_MIN_DIST && rAnomaly < P_ANOMALY;
    if (isPg) buildPlayground(b, rng);
    else if (isAnomaly) buildAnomalyHouses(b, rng);
    else buildNormalBlock(b, rng);
    if ((cx === 1 || cx === 3) && cz === 0) buildArrowSign(b, SIZE / 2, 3, Math.PI / 2);   // 路标沿途（exits[0] 途中标志）
  }

  buildStreetlights(b, rng);
  buildPowerLine(b, rng);
  buildDeadTreesAndPuddles(b, rng);
  maybeNoclipHole60(b, rng);
  scatterSpawns(b, rng);
  return b.finish();
}

// ---------- 层级环境 ----------
// 依据：lighting「永久午夜；黑暗程度类似 Level 6，但没那么危险」——ambient 用正常亮度色调（冷灰蓝）+ 较低 intensity 控制明暗，
// 不能把 color 调成近黑色（上一批 Level 6 教训：color×intensity 才是有效亮度，color 本身太暗会整屏纯黑）
const BASE_ENV = {
  background: 0x05060a, fogColor: 0x05060a, fogNear: 3, fogFar: 55,   // fogFar ≤ chunkSize(44)×2=88
  ambient: { color: 0x9fb0c8, intensity: 0.22 },
  sanityDrainMul: 1.9,    // other「几乎和 Level 6 一样糟」但「没那么危险」——比 L6 的 2.2 略低
  hungerDrainMul: 1,      // 温度字段本层未给出可换算数值（unverified），不额外加成
  audio: 'suburb-night',  // sounds（entity-63 页）「路灯嗡嗡白噪声、蟋蟀鸣叫；部分街区令人窒息的寂静」——预设里最贴合
  darkness: true,         // lighting「永久午夜」，与 L6 同档黑暗程度
};
// hazards「雾气出现即意味着 The Mangled 生成」期间：能见度骤降+光线更冷更暗，呼应「气温骤降」「浓烟遮天」
const FOG_ENV = Object.assign({}, BASE_ENV, {
  background: 0x14161d, fogColor: 0x14161d, fogNear: 1, fogFar: 16,
  ambient: { color: 0x8a94a8, intensity: 0.14 },
});

const S = { timer: 0, fogActive: false, fogUntil: 0, fogEpoch: -1, glitchEpoch: -1 };

function enter(ctx) {
  Object.assign(S, { timer: 0, fogActive: false, fogUntil: 0, fogEpoch: -1, glitchEpoch: -1 });
}

function update(ctx, dt) {
  S.timer += dt;

  // ---------- 街道最危险（hazards「街道是本层最危险的区域」）----------
  const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
  const lx = BR.player.x - cc.cx * SIZE, lz = BR.player.z - cc.cz * SIZE;
  const inStreet = lx < STREET_HALF || lx > SIZE - STREET_HALF || lz < STREET_HALF || lz > SIZE - STREET_HALF;
  if (inStreet && BR.game.attackPlayers) {
    BR.player.damage({ hp: 0, sanity: 0.35 * dt, source: 'hazard:street' });   // 数值非设定精确值，只体现"街道更危险"的相对差异
  }

  // ---------- 雾 = The Mangled 生成机制（entity-63 页叙事：气温骤降、浓烟黑柱、雷鸣、周期性地震）----------
  const FOG_EPOCH = 150;   // 触发间隔非设定精确值，取一个不过分打扰又能被撞见的巡检周期
  const fe = Math.floor(S.timer / FOG_EPOCH);
  if (fe !== S.fogEpoch) {
    S.fogEpoch = fe;
    const r = U.rng(ctx.levelSeed, 'L9-fog', fe);
    if (!S.fogActive && r() < 0.3) {
      S.fogActive = true; S.fogUntil = S.timer + 22;
      BR.gfx.applyEnv(FOG_ENV, BR.game.settings.visibility);
      BR.audio.play('growl', null, { volume: 0.4 });   // entity-63「咆哮」——音效表没有专门的雷鸣/嘶吼，growl 近似
      BR.hud.toast('气温骤降，浓雾从街尽头翻滚而来——The Mangled 要出现了', 3000);
    }
  }
  if (S.fogActive) {
    if (inStreet && BR.game.attackPlayers) {
      // entity-63「触手会把人卷上高空」——本批没有 The Mangled 的实体文件（更适合做事件型危害，entity-index 已注明），
      // 用持续高额伤害近似"待在街上被抓到的风险"，不做抓取动画
      BR.player.damage({ hp: 0.6 * dt, sanity: 0.5 * dt, source: 'hazard:the-mangled' });
    }
    if (S.timer >= S.fogUntil) {
      S.fogActive = false;
      BR.gfx.applyEnv(BASE_ENV, BR.game.settings.visibility);
      BR.hud.toast('雾散了，街道中央多出一个深坑——它已经走远了', 2600);   // entity-63「离开后街道中央只剩一个大坑」
    }
  }

  // ---------- 电子设备故障（entity-96 页「本层电子设备容易出错，屏幕烧出白条，出现随机图片/音频/音乐」）----------
  const GLITCH_EPOCH = 45;
  const ge = Math.floor(S.timer / GLITCH_EPOCH);
  if (ge !== S.glitchEpoch) {
    S.glitchEpoch = ge;
    const r = U.rng(ctx.levelSeed, 'L9-glitch', ge);
    if (r() < 0.4) BR.audio.play('static', null, { volume: 0.25 });
  }
}

function leave() {
  if (S.fogActive) { S.fogActive = false; BR.gfx.applyEnv(BASE_ENV, BR.game.settings.visibility); }
  BR.hud.prompt(null);
}

BR.levels.register({
  id: '9', name: 'Level 9', title: 'The Suburbs', nickname: '',
  version: 'wikidot-en',
  survivalClass: '5',   // survivalClass「Survival Difficulty 5」
  chunkSize: SIZE,
  env: BASE_ENV,
  // entrances：主要方式是在 Level 8 随机掉穿地板；出生点放在两排房屋之间的后院公共区，铺装以外的开阔草地上，
  // 不落在任何房屋碰撞体/出口圈内（LOT_XS 房屋只占 z∈[6.5,11.5]∪[32.5,37.5]，z=22 必然安全）
  spawn() { return { x: 6, y: 0, z: 22, yaw: 0 }; },
  buildChunk,

  // 实体表：换算依据见 WAVE2 第4节。密度基线取自 data/entity-index.json 的原文摘录
  entities: [
    // 邻里守望（Entity 96）：Level 9 页称其为"本层最著名的特有实体"，街道被称为"最危险区域"——整体按定性描述取 high(0.9)。
    // 实体文件把三种形态注册成了三个 type（没有叫 neighborhood_watch 的 type，写成总名会被 world 静默跳过、一只都不刷）：
    // entity-96 页"每见到 1 个 Watcher，附近约 3 个 Strider"→ 按 1:3 拆分；Swimmer 生活在水里，本层没有水体，不在这里刷
    { type: 'neighborhood_watch_watcher', officialPer1000m2: BR.config.densityWords.high * 0.25 },
    { type: 'neighborhood_watch_strider', officialPer1000m2: BR.config.densityWords.high * 0.75 },
    // 悲尸（Wretch）：原文明确「many Wretches」——介于"仅列名单"与"最著名实体"之间，取 moderate(0.35)
    { type: 'wretch', officialPer1000m2: BR.config.densityWords.moderate },
    // 磨损者、八层之蛛：均标注"有目击报告，似乎是从 Level 8 游荡过来的"外来个体——比"仅列于名单"更偶发，取 rare(0.04)
    { type: 'frayed', officialPer1000m2: BR.config.densityWords.rare },
    // 八层之蛛也拆成了三个 type（没有叫 arachnid 的 type）：本层只是从 Level 8 游荡过来的零星个体——
    // 形蛛"数量最多"占大头、弗兰肯蜘蛛少量；皇后蛛是"所有普通蜘蛛的母亲"、体长 7–10 m，不会游荡到郊区，不在这里刷
    { type: 'arachnid_common', officialPer1000m2: BR.config.densityWords.rare * 0.85 },
    { type: 'arachnid_franken', officialPer1000m2: BR.config.densityWords.rare * 0.15 },
    // 观察者：Level 9 页仅列出名字，无链接无描述——同样按"确认存在但无频率线索"取 rare(0.04)
    { type: 'observer', officialPer1000m2: BR.config.densityWords.rare },
    // 死亡飞蛾：本层原文未区分雌雄，js/entities/deathmoth.js 没有不分性别的 'deathmoth' 类型，
    // 把下面"仅列于名单"同款的 rare 份额对半拆给两个已注册的性别形态
    { type: 'deathmoth_male', officialPer1000m2: BR.config.densityWords.rare / 2 },
    { type: 'deathmoth_female', officialPer1000m2: BR.config.densityWords.rare / 2 },
    // 以下：Level 9 页原文都只是"仅列于可出现在 Level 9 的实体名单中，无数量描述"——没有任何频率/行为线索，
    // 按 WAVE2 第4节"只有定性描述"处理，统一取最低非零档 rare(0.04)，不假设比悲尸/邻里守望更常见
    { type: 'smiler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'skin_stealer', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'jerry', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'hound', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'transporter', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'death_rat', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'warning_kite', officialPer1000m2: BR.config.densityWords.rare },
  ],

  // 物品表：data/item-spawn.json 里 levels 含 '9' 且 js/items/<key>.js 已存在的条目，per1000m2 直接取该文件的值
  items: [
    { type: 'almond_water', per1000m2: 1.2 },                        // 用户规则：所有模式都刷
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.01 },                          // 本层有死亡飞蛾，item-spawn.json 把它分给了有蛾的层级
    { type: 'food_ration', per1000m2: 0.6 },                          // 用户规则：所有模式都刷食物的兜底
  ],

  exits: [
    { to: '11', kind: 'zone', note: '沿箭头街道标志走 100-200 英里，用每 8 块重复的区块+大半径zone近似（首期范围内）(exits[0])' },
    { to: '9.1', kind: 'zone', note: '走通往草地的人行步道；9.1 不在首期范围，自动 sealed (exits[1])' },
    { to: '10', kind: 'zone', note: '离开步道走进田野深处，每 8 块重复的草地区块（首期范围内）(exits[2])' },
    { to: '60', kind: 'hole', note: '切出街道地面；不在首期范围，只提示尚未开放 (exits[3])' },
    { to: '53', kind: 'door', note: '进入任意房屋有几率被随机传送；约两成房子的门是这条出口；不在首期范围 (exits[4])' },
    { to: '113', kind: 'zone', note: '沿电力线走有几率到达；不在首期范围 (exits[5])' },
    { to: '36', kind: 'door', note: '进入机场；不在首期范围 (exits[6])' },
    { to: '-1', kind: 'noclip', note: '机场附近切出到最初几个负数层级；不在首期范围 (exits[7])' },
    { to: '283', kind: 'hole', note: '游乐场里爬进发光内窗的管道；不在首期范围 (exits[8])' },
  ],
  enter, update, leave,
});
})();

// ==================== 没有实现的细节（及原因）====================
// Pockets（Object 51）：entity-96 页描述其"收纳惰性物质到维度口袋"的交互，且携带它会立刻暴露给邻里守望——
//   js/items 里没有对应文件，也没有"携带特定物品触发实体追踪"的引擎钩子，本层不添加（见下方 apiRequests）。
// Cell phones / glasses（遇难者遗物）：entity-96 页提到灰堆旁的散落遗物，纯叙事细节，没有对应 js/items 文件，
//   也没有做"辨认失踪者"这类玩法，只在场景上没有单独还原（灰堆本身也不在本批实现范围）。
// Firesalt（Object 15）：js/items/firesalt.js 已存在，但 data/item-spawn.json 里它的 levels 没有包含 '9'
//   （不许修改 data/*.json），本层不刷这件物品；entity-96 页对它在本层的作用只是"提及可能用于对付 Watcher/引来其他实体"，
//   属于邻里守望实体自己的机制，交给 js/entities/neighborhood_watch.js 处理。
// 房屋室内：architecture 提到"有家具、相当新"，但引擎没有多层楼、房屋只做外立面+碰撞体+黑窗（规则③），室内不建模。
// 两栋互相穿插的房子 / 两栋完全相同的房子：均按概率近似实现（见 buildAnomalyHouses、buildHouseRow 的 twin 逻辑），
//   原文没有给出具体概率，取值非设定精确值。
