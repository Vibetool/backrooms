// Level 20 - "玻瑞阿斯的建筑"（Boreas' Structure，昵称"娱乐区"）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-20  许可：CC BY-SA 3.0
// 只按这一个版本实现：wikidot-en/fandom 的另一套设定（仓库版 The Warehouse、板条箱货架、恒温10℃等）
// 一律不做，见 data/lore-choices.json 的 conflicts。原文很多字段标注 unverified（灯光类型、墙色、气味等），
// 这些细节不编造，只在"需要一个具体数值才能建模"时选用最朴素的默认值，并在下面用注释标出是近似还是原文明写。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
const LORE_HOUR = (BR.itemKit && BR.itemKit.LORE_HOUR) || 60;   // 设定 1 小时 = 60 秒（ARCHITECTURE.md / 用户规则）
const MIN = LORE_HOUR / 60;                                     // 60 秒/小时 ÷ 60 分钟/小时 = 1，恰好"1 设定分钟 = 1 秒"

// ---------- 尺寸 ----------
const SIZE = 24, N = 8, CELL = SIZE / N;   // 区块 24m、8×8 格、3m 一格（迷宫层常规取值，scale 字段本身没给尺寸）
const H = 2.8;                              // 版本没给层高，沿用 kit 缺省
const SPAWN_I = 4, SPAWN_J = 4;             // 出生房间锚点格（区块 0,0 内）

// 等候厅半径（区块，切比雪夫距离）：依据 layout「探索等候厅约 1 到 4 天后必定找到霓虹区入口」——
// 引擎没有真实天数概念，按规则②"走得够远必定离开"近似：半径 3 块（约 72~108m）作为固定边界，
// 出生块必属于等候厅，越过这个半径就"必定"进入霓虹区（不是概率，是确定性地形分区）
const WAIT_R = 3;
function dist(cx, cz) { return Math.max(Math.abs(cx), Math.abs(cz)); }

// ---------- 格子参数：等候厅走廊迷宫 / 霓虹区开阔大厅 ----------
// 依据 layout「等候厅：白色混凝土走廊」「霓虹区：大厅」——两种区块共用同一套边界参数（_TEMPLATE 7.2节），只改内部密度
const EDGE = { salt: 'L20', boundaryDensity: 0.42, straightness: 0.72, minOpenings: 2 };
const WAITING = Object.assign({ wallDensity: 0.42, roomChance: 0.32, maxRooms: 2, roomSize: [2, 4], loopChance: 0.5, pillarChance: 0.02 }, EDGE);
const NEON = Object.assign({ wallDensity: 0.05, roomChance: 0.2, maxRooms: 1, roomSize: [3, 6], loopChance: 0.6, pillarChance: 0.16 }, EDGE);   // 柱厅：内部基本清空，呼应「大厅」

// ---------- 随机地标出现概率（原文没给密度数字的，都在注释里写明是工程近似）----------
const WINDOW_CHANCE = 0.22;   // 依据 landmarks「等候厅窗户」，密度未写，取一个"常遇到但不是每块都有"的值
const LOCKER_CHANCE = 0.3;    // 依据 landmarks「储物柜」
const SPLAT_CHANCE = 0.32;    // 依据 other「橙色果冻状物质不定时从天花板掉落」——只是装饰性地面痕迹，不挡路、无危害
const GAME_DOOR_CHANCE = 0.3; // 依据 layout「霓虹区……沿途有游戏大门」，密度未写
const PORTAL_CHANCE = 0.02;   // 依据 exits[3-5]「霓虹区游戏门（概率极小）」通向 Level 4/21/36——极小概率取 2%

// 验收②发现：霓虹区只有 GAME_DOOR_CHANCE=0.3 概率的随机游戏门，且要先赢一局才能走，深处很可能几十块
// 都碰不到、碰到了也走不出去——不满足规则②"任意位置 3~5 块内必有可用出口"。按固定周期强制生成一扇
// "打爆小行星"门（不吃 rng，不受 wallDensity=0.05 的迷宫生成影响，一定能建出来），输了传送 Level 6——
// 这是 exits[6] 原文本来就写的后果，不是编造的新出口。周期 4 块，Chebyshev 距离任何位置最多 2 块必有一扇
const NEON_DOOR_PERIOD = 4;
function forcedNeonDoorEdge(g) {
  const i = N / 2, j = N / 2;
  g.setWall('v', i, j, true);   // 先强制把这一段墙建出来（霓虹区内部墙很稀，随机生成不一定有），再当门缝拆开
  return { axis: 'v', i, j, x: i * CELL, z: (j + 0.5) * CELL, rot: Math.PI / 2, len: CELL };
}

// 出生房间接待区固定坐标（区块 0,0 局部坐标，纯常量、不吃 rng）
const LOG_X = 11.5, LOG_Z = 9.85;

// ---------- 霓虹区游戏门 ----------
// 依据 mechanics 五种游戏；权重按原文「常见/不常见/极不常见」三档换算（常见 ≈0.34、不常见 ≈0.14、极不常见 0.04），
// win 是工程近似的胜率（原文没给概率数字，引擎也没有真正的躲激光/接球/踩点操作，用"停留+权重判定"代替技巧判定，见 apiRequests）
const GAMES = {
  hex:      { zh: '绿与红',     weight: 0.34, dwell: 3,        win: 0.6, tint: 0x33cf6a },
  climb:    { zh: '攀岩',       weight: 0.34, dwell: 4,        win: 0.5, tint: 0x2fae6b },
  // 依据 mechanics「躲避激光……或坚持 3 分钟」：3 设定分钟 = 3 秒（LORE_HOUR 换算，见文件头 MIN 常量）
  laser:    { zh: '躲避激光',   weight: 0.14, dwell: 3 * MIN,  win: 0.5, tint: 0xd6403a },
  asteroid: { zh: '打爆小行星', weight: 0.14, dwell: 5,        win: 0.5, tint: 0x3a6bd6 },
  // 依据 mechanics「鼹鼠洞……4 分钟内……」：4 设定分钟 = 4 秒
  mole:     { zh: '鼹鼠洞',     weight: 0.04, dwell: 4 * MIN,  win: 0.3, tint: 0xd6a53a },
};
const GAME_KEYS = Object.keys(GAMES);

// 验收②发现：concrete.jpg 公共贴图实测本身就是中灰，用 color 相乘只会更暗、到不了「白色」，
// 之前调的 0xe8e8e4 tint 完全没用。改注册一张本层自己的浅色混凝土程序化贴图（没有对应 jpg，按规则⑩必须 noFile:true），
// 画法照抄 L13.js 的 l13_wall_plaster：浅底色 + 细小噪点斑，看起来仍是"混凝土"而不是纯色平面
BR.assets.registerProcedural('l20_wall_concrete', 256, (g, s) => {
  g.fillStyle = '#e9e7e0'; g.fillRect(0, 0, s, s);
  const r = U.rng('l20_wall_concrete');
  for (let k = 0; k < 700; k++) {
    const v = 200 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v},${v},${v - 6},0.12)`;
    g.fillRect(r() * s, r() * s, 2 + r() * 2, 2 + r() * 2);
  }
  for (let k = 0; k < 60; k++) {
    g.fillStyle = 'rgba(120,116,108,0.10)';
    g.fillRect(r() * s, r() * s, 6 + r() * 10, 1);
  }
}, { noFile: true });

// ---------- 材质 ----------
function defineMaterials() {
  // colors「白色混凝土墙」——用上面注册的浅色程序化贴图，不再靠 color 相乘硬调亮
  kit.mat('L20:wall', { tex: 'l20_wall_concrete', repeatMeters: 2.4, roughness: 0.85 });
  // colors「棕色地毯」——carpet_l0.jpg 实测均色本就是棕黄色，直接用
  kit.mat('L20:floorWait', { tex: 'carpet_l0', repeatMeters: 2.2, roughness: 1 });
  // colors「灰色瓷砖天花板」——ceiling_tile.jpg 偏米白，压一点灰
  kit.mat('L20:ceilWait', { tex: 'ceiling_tile', repeatMeters: 1.3, roughness: 1, color: 0xd6d6d2 });
  // colors「灰色地毯」（霓虹区）——复用同一张地毯贴图，用灰色相乘盖掉棕色调，不新生成贴图
  kit.mat('L20:floorNeon', { tex: 'carpet_l0', repeatMeters: 2.2, roughness: 1, color: 0x8c8c92 });
  // colors「黑色瓷砖天花板」（霓虹区）——同一张吊顶贴图压到近黑
  kit.mat('L20:ceilNeon', { tex: 'ceiling_tile', repeatMeters: 1.3, roughness: 1, color: 0x1c1c22 });
  // 游戏门屏幕：程序化贴图（见文件底部 registerProcedural），basic + vertexColors，靠逐件 color 染成不同游戏的配色
  kit.mat('L20:screen', { tex: 'l20_screen', type: 'basic', repeatMeters: 1, vertexColors: true });
}

// file:// 兜底：双击 index.html 打开时读不到贴图文件会显示占位色并 warn，注册一个简单画法顶上
// 依据 materials「游戏内有……屏幕、激光、发光按钮」——一块通用的深色蜂窝屏幕底图，具体配色由各游戏门用 color 染
BR.assets.registerProcedural('l20_screen', 256, (g, s) => {
  // 验收⑦发现底色几乎纯黑（原 #07070a），乘 meta.tint 之后基本看不出染色；调亮一档，色差才显得出来
  g.fillStyle = '#242430'; g.fillRect(0, 0, s, s);
  const rr = U.rng('l20_screen');
  g.strokeStyle = 'rgba(225,230,240,0.5)'; g.lineWidth = 1.2;
  const hexR = 20;
  for (let row = -1; row <= s / (hexR * 1.5) + 1; row++) {
    for (let col = -1; col <= s / (hexR * 1.7) + 1; col++) {
      const cx = col * hexR * 1.7 + (row % 2 ? hexR * 0.85 : 0);
      const cy = row * hexR * 1.5;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k;
        const px = cx + Math.cos(a) * hexR * 0.42, py = cy + Math.sin(a) * hexR * 0.42;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.stroke();
    }
  }
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(255,255,255,${(0.4 + rr() * 0.5).toFixed(2)})`;
    g.beginPath(); g.arc(rr() * s, rr() * s, 1.3 + rr() * 1.7, 0, Math.PI * 2); g.fill();
  }
}, { noFile: true });

// 沙发：靠背 + 坐垫 + 两个扶手（验收⑤：不能是一整块纯色方块）。(x, z) 是贴的那面墙的中心线，
// rot 让局部 +Z 指向房间内侧（同 g.edges 的约定），靠背离墙留 0.18m 间隙（半墙厚 0.133m 之外留够余量）
function buildSofa(b, x, z, rot) {
  const GAP = 0.18, Wd = 2.0, armW = 0.16, backT = 0.12, backH = 0.82, seatH = 0.42, armH = 0.55, Dp = 0.55;
  const c = 0x475066, cushion = 0x59647a;
  b.push(x, z, rot);
  b.box(0, 0, GAP + backT / 2, Wd, backH, backT, 'kit:prop', { faces: 'noBottom', color: c, solid: false });
  b.box(0, 0, GAP + backT + Dp / 2, Wd - armW * 2, seatH, Dp, 'kit:prop', { faces: 'noBottom', color: cushion, solid: false });
  for (const s of [-1, 1]) {
    b.box(s * (Wd / 2 - armW / 2), 0, GAP + backT / 2 + Dp / 2, armW, armH, backT + Dp, 'kit:prop', { faces: 'noBottom', color: c, solid: false });
  }
  b.box(0, seatH + 0.005, GAP + backT + Dp * 0.5, 0.02, 0.02, Dp * 0.85, 'kit:prop', { color: 0x333a4a, solid: false });   // 坐垫接缝
  b.solid(-Wd / 2, 0, GAP, Wd / 2, backH, GAP + backT + Dp);
  b.pop();
}

// ---------- 出生房间：接待区 ----------
// 依据 landmarks「空接待台、杏仁水饮水机、软饮料自动售货机、储物柜」——集中放在出生房间，一进层就能看到，
// 也呼应规则②"出口/关键地标离出生点要近"（这里是纯装饰地标，不是出口，但同理不藏起来）
function buildSpawnRoom(b, g) {
  g.carve(SPAWN_I - 1, SPAWN_J - 1, 3, 3, { room: true });
  g.setWall('v', SPAWN_I - 1, SPAWN_J, false);
  g.setWall('v', SPAWN_I + 2, SPAWN_J, false);
  g.setWall('h', SPAWN_I, SPAWN_J - 1, false);
  g.setWall('h', SPAWN_I, SPAWN_J + 2, false);
  g.reserve(SPAWN_I, SPAWN_J);

  kit.prop.desk(b, 11.5, 9.6, 0, { monitor: false });   // 空接待台：没有屏幕/坐席
  kit.prop.vending(b, 14.2, 9.6, 0, { color: 0x2f6fae, glow: 0x8fd0ff, light: true, intensity: 0.3 });   // 杏仁水饮水机：蓝色调区分
  kit.prop.vending(b, 16.3, 9.6, 0, { color: 0xb23a2e, glow: 0xffcf8a, light: true, intensity: 0.3 });   // 软饮料售货机：暖色调区分
  kit.prop.cabinet(b, 9.7, 11, Math.PI / 2, { kind: 'locker' });
  kit.prop.cabinet(b, 9.7, 12, Math.PI / 2, { kind: 'locker' });
  kit.prop.cabinet(b, 9.7, 13, Math.PI / 2, { kind: 'locker' });
  // 垃圾桶：构件表没有专门的垃圾桶，_TEMPLATE 8节末尾允许"构件不够就自己拼"，用小圆柱近似
  b.cylinder(10.2, 0, 14.6, 0.24, 0.5, 'kit:prop', { color: 0x2a2a2a });
  // 沙发 + 纪念牌：验收⑤发现原来的一整块纯色方块 + 发光牌都堆在南墙中间被打通的那段开口里，
  // 0.6m 宽的玩家从沙发背后挤不过去、纪念牌也悬空没有墙托着。挪到南墙"角落"没被打通的那一段实墙
  // （g.setWall 只拆了 SPAWN_I 那一列中间格，SPAWN_I+1 这一格两侧的墙都还在），沙发拆成靠背+坐垫+
  // 两个扶手（验收⑤另一条：家具不能是纯色长方块），纪念牌贴着同一段墙、离墙中心线 0.18m（规则⑦ ≥0.15m）
  buildSofa(b, (SPAWN_I + 1 + 0.5) * CELL, (SPAWN_J + 2) * CELL, Math.PI);
  kit.prop.chair(b, 10.6, 16.4, Math.PI, {});
  kit.prop.chair(b, 16.4, 16.4, Math.PI, {});
  // 依据 entrances「标着"娱乐区"的蓝色门」——纪念一下刚穿过的那扇门，纯装饰发光牌，不是出口
  kit.prop.sign(b, (SPAWN_I + 1 + 0.5) * CELL, (SPAWN_J + 2) * CELL - 0.18, Math.PI, { y: 2.1, color: 0x3366ff, backColor: 0x0a1030 });
  // 依据 hazards「M.E.G. 探险记录是信息危害：读过后再进入 Level 20 的人都会受到伤害」——放一份在接待台上
  b.box(LOG_X, 0.78, LOG_Z, 0.26, 0.02, 0.34, 'kit:prop', { color: 0xe8e0c8 });
}

// ---------- 窗户：等候厅窗户 + 切入窗户的出口 ----------
// 依据 landmarks「等候厅窗户（外面是星空黑色虚空和月亮）」、colors「窗外是群星点缀的黑色虚空，偶尔有月亮」，
// hazards「窗户周围一定范围内为 -22℃ 至 -43℃ 极寒，进入会轻微头痛、极度偏执」，
// exits[1][2]「切入等候厅的窗户，通往 Level 24 或 Level 78，具体方法未写」——原文没区分"哪扇窗户通向哪层"，
// 所以让每一扇窗户都有 50% 概率对应其中一个目标；两层都不在首期范围，kit 自动 sealed
function buildWindowFeature(b, g, ed, rng) {
  g.setWall(ed.axis, ed.i, ed.j, false);
  const isMoon = rng() < 0.15;   // 「偶尔有月亮」——大多数时候只是纯黑虚空
  // 验收①发现：kit:glass 只有 30% 不透明度，几乎等于直接看穿到隔壁走廊——引擎的无限区块网格没有真正的
  // "块外天空盒"，窗户背面在几何上就是相邻走廊，没法真的渲染出虚空。改用 blackout 整块涂黑（双面都挡光），
  // 再叠一小撮 kit:glow 星点（同一手法 L15.js 门框对面"夜空"已经用过），星点是独立小方块、任何角度都看得见，
  // 双面都能看到；偶尔（isMoon）额外加一颗小球体当月亮，而不是整面发光，避免看起来像另一种发光窗
  kit.prop.window(b, ed.x, ed.z, ed.rot, {
    w: 1.3, h: 1.3, y: 0.85, mullions: false, blackout: true, paint: 0x05060c,
    wall: { matKey: 'L20:wall', w: ed.len, h: H },
  });
  b.push(ed.x, ed.z, ed.rot);
  for (let k = 0; k < 10; k++) {
    const sx = (rng() - 0.5) * 1.1, sy = 0.85 + (rng() - 0.5) * 1.1;
    b.box(sx, sy, 0, 0.025, 0.025, 0.02, 'kit:glow', { uv: 'solid', color: [2, 2, 2.1] });
  }
  if (isMoon) {
    const orb = new THREE.SphereGeometry(0.15, 8, 6);
    b.mesh(orb, 'kit:glow', { x: 0.35, y: 1.15, z: 0, uv: 'solid', color: [2.3, 2.15, 1.7] });
    orb.dispose();
  }
  b.pop();
  const world = b.world(ed.x, ed.z);
  (b.data.windows = b.data.windows || []).push({ x: world.x, z: world.z });
  const target = rng() < 0.5 ? '24' : '78';
  kit.exit(b, { to: target, kind: 'zone', x: ed.x, z: ed.z, radius: 1.2, label: '窗户外的虚空' });
  g.reserve(ed.i, ed.j);
}

// ---------- 储物柜（走廊内散布，非出生房间）----------
// 验收⑥发现：原来钉在 room 左上角格子的正中心，正好和 kit.gridSpawns 给这个格子刷的那个"room"刷新点
// 完全重合，物品/实体/相机都可能卡进柜子实体碰撞体里。改成贴在这个房间的一段真墙上、离墙留出间隙，
// 并把柜子落脚的那一格标记 reserved，gridSpawns 就会跳过它，不再抢同一个位置
function buildLockers(b, g, rng) {
  const room = g.rooms[0];
  if (!room) return;
  const edges = g.edges({ wall: true, unlocked: true }).filter(e => (
    e.axis === 'v'
      ? (e.i === room.i || e.i === room.i + room.w) && e.j >= room.j && e.j < room.j + room.d
      : (e.j === room.j || e.j === room.j + room.d) && e.i >= room.i && e.i < room.i + room.w
  ));
  if (!edges.length) return;
  const ed = edges[Math.floor(rng() * edges.length)];
  // ed.rot 默认让"正面朝 +Z 的构件"对着 (ed.i, ed.j) 格；这一格如果落在房间矩形外（挑到的是房间"远侧"那一条边），
  // 说明这个朝向背对房间，要多转 180° 柜子才会面朝房间内侧
  const far = ed.axis === 'v' ? ed.i === room.i + room.w : ed.j === room.j + room.d;
  const rot = ed.rot + (far ? Math.PI : 0);
  const cellI = ed.axis === 'v' ? (far ? room.i + room.w - 1 : room.i) : ed.i;
  const cellJ = ed.axis === 'h' ? (far ? room.j + room.d - 1 : room.j) : ed.j;
  const n = rng() < 0.5 ? 2 : 3;
  b.push(ed.x, ed.z, rot);
  for (let k = 0; k < n; k++) kit.prop.cabinet(b, (k - (n - 1) / 2) * 0.9, 0.5, 0, { kind: 'locker' });
  b.pop();
  g.reserve(cellI, cellJ);
}

// ---------- 员工专用门：通往 Level 2 ----------
// 依据 landmarks「等候厅员工专用门（通往 Level 2）」、exits[0]。按 (cx,cz) 都是 3 的倍数周期放置（规则②的
// "按周期重复"写法），保证等候厅内任意位置 3 个区块内必有一扇，Level 2 已在 0-16 批次完成、不是 sealed
function buildStaffDoor(b, g, ed) {
  g.setWall(ed.axis, ed.i, ed.j, false);
  kit.exit(b, {
    to: '2', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '员工专用门',
    door: { color: 0x8a8f96, sign: 0x39c25a, wall: { matKey: 'L20:wall', w: ed.len, h: H } },
  });
  g.reserve(ed.i, ed.j);
}

// ---------- 霓虹区游戏门 ----------
// 依据 landmarks「霓虹区游戏大门（绿与红、攀岩、打爆小行星、躲避激光、鼹鼠洞）」、mechanics 五条游戏规则，
// exits[3-5]「霓虹区游戏门（概率极小）」——绝大多数游戏门是可玩的小游戏（胜负判定见 level.update 的 resolveGame），
// 极小概率（PORTAL_CHANCE）是"失灵"的游戏门，直接做成通向 Level 4/21/36 的实物门（三层都不在首期范围，sealed）。
// forceKind：验收②的兜底出口用，传了就跳过随机选游戏种类和"失灵传送门"分支，强制建成指定游戏（不吃 rng）
function buildGameDoor(b, g, cx, cz, ed, rng, forceKind) {
  g.setWall(ed.axis, ed.i, ed.j, false);
  const kindKey = forceKind || U.weighted(rng, GAME_KEYS.map(k => [k, GAMES[k].weight]));
  const isPortal = !forceKind && rng() < PORTAL_CHANCE;
  if (isPortal) {
    const target = U.weighted(rng, [['4', 1 / 3], ['21', 1 / 3], ['36', 1 / 3]]);
    kit.exit(b, {
      to: target, kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '不对劲的游戏门',
      door: { color: 0x552266, wall: { matKey: 'L20:wall', w: ed.len, h: H } },
    });
    g.reserve(ed.i, ed.j);
    return;
  }
  const meta = GAMES[kindKey];
  kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'metal', color: meta.tint, solid: false, wall: { matKey: 'L20:wall', w: ed.len, h: H } });
  // 屏幕面板：验收⑦发现原来贴在 y=1.55（门 2.05m 高，屏幕会盖住门头和门框顶），且只有 +z 一面能看到、
  // 贴图底色太黑基本看不出染色。抬到门头以上（墙 2.8m 高，2.2~2.7m 留出到顶的余量），两面各贴一块，
  // 底色也在 l20_screen 里调亮了一档，tint 才看得出来（离墙中心线 0.2m，满足规则⑦ ≥0.15m）
  b.push(ed.x, ed.z, ed.rot);
  b.plane(0, 2.2, 0.2, 0.9, 0.5, 'L20:screen', { facing: '+z', uv: 'stretch', color: meta.tint });
  b.plane(0, 2.2, -0.2, 0.9, 0.5, 'L20:screen', { facing: '-z', uv: 'stretch', color: meta.tint });
  b.pop();
  const world = b.world(ed.x, ed.z);
  const tag = 'L20d_' + cx + '_' + cz;
  (b.data.doors = b.data.doors || []).push({ kind: kindKey, x: world.x, z: world.z, tag, cooldownUntil: 0 });
  // 惩罚性传送用隐藏的 event 出口占位，胜负判定时在 update 里 setActive(true)（_TEMPLATE 9节"事件型出口"写法）。
  // 验收④发现：半径原来只有 1.6，但游戏在 2.2m 内开始、3.4m 外才取消，玩家判负时经常已经站在 1.6~3.4m
  // 之间，传送圈根本碰不到，输了等于没事发生；半径改成比"游戏取消距离"3.4m 再放宽一点（3.5m，留出浮点
  // 误差余量），判负那一刻玩家必然还在圈内，一定能触发。同时 resolveGame 判完负会在极短时间内强制
  // setActive(false)（见 armPunishExit），不会留一个"曾经点亮过、以后随便走近都会被传送"的出口
  if (kindKey === 'asteroid') {
    // 依据 exits[6]「传送到 Level 6，或改为生成牧蛇」——生成实体不可行（见 apiRequests），只做传送这一半
    kit.exit(b, { to: '6', kind: 'event', x: ed.x, z: ed.z, radius: 3.5, active: false, tag: tag + '-lose6', label: '打爆小行星失败' });
  } else if (kindKey === 'laser') {
    // 依据 exits[7][8]「传送到 Level 7 或 Level 154」——Level 7 做实物出口；Level 154 远超首期范围、
    // 传送了也只会显示"尚未开放"提示、不会真的换层，见 resolveGame 里直接跳过 setActive，不留悬空出口
    kit.exit(b, { to: '7', kind: 'event', x: ed.x, z: ed.z, radius: 3.5, active: false, tag: tag + '-lose7', label: '躲避激光失败' });
    kit.exit(b, { to: '154', kind: 'event', x: ed.x, z: ed.z, radius: 3.5, active: false, tag: tag + '-lose154', label: '躲避激光失败' });
  }
  g.reserve(ed.i, ed.j);
}

// ---------- 橙色果冻状物质痕迹（装饰，不挡路，无危害）----------
// 依据 other「橙色果冻状物质不定时从天花板掉落，来源不明，目前未显现危害」
function placeSplat(b, rng) {
  const x = 2 + rng() * (SIZE - 4), z = 2 + rng() * (SIZE - 4);
  kit.prop.puddle(b, x, z, 0, { rx: 0.4 + rng() * 0.3, rz: 0.3 + rng() * 0.2, color: 0xcc6a1a });
}

// ---------- 灯 ----------
// 依据 lighting「等候厅灯光未描述（unverified）」「霓虹区有霓虹灯；灯具类型、颜色、亮度、闪烁均未描述（unverified）」——
// 两处都没给具体数值，不编造閃烁/损坏比例（问题①的教训是"别把无描述的层搞得全黑"，不是"必须加閃烁"），
// 等候厅按普通日光灯全亮处理；霓虹区选用两种常见霓虹配色（洋红/青）交替，仅体现"是霓虹灯"这一明确写到的事实
function placeLights(b, g, neon) {
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const c = g.center(i, j);
      if (neon) {
        const hue = (i + j) % 4 < 2 ? 0xff3fd0 : 0x3fd0ff;
        kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state: 'on', color: hue, intensity: 0.85, range: 7, panelColor: 0x111116, glow: 2.0 });
      } else {
        kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state: 'on', color: 0xfff1d6, intensity: 1.0, range: 8 });
      }
    }
  }
}

// ---------- 区块 ----------
// rng 消耗顺序：先无条件抽"是否放置"的判定量（含 pickEdge），再决定要不要真的建（_TEMPLATE 4.2节）；
// 等候厅/霓虹区是两条完全不同的分支（由 cx,cz 的确定性距离决定，不吃 rng），分支内部各自的消耗顺序自洽即可
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const d = dist(cx, cz);
  const neon = !isSpawn && d > WAIT_R;

  const g = kit.grid(b, N, N, neon ? NEON : WAITING);
  if (isSpawn) buildSpawnRoom(b, g);

  if (!neon) {
    const rWindow = rng();
    const edWindow = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (!isSpawn && rWindow < WINDOW_CHANCE && edWindow) buildWindowFeature(b, g, edWindow, rng);

    const rLocker = rng();
    if (!isSpawn && rLocker < LOCKER_CHANCE && g.rooms.length) buildLockers(b, g, rng);

    const pm = ((cx % 3) + 3) % 3, pn = ((cz % 3) + 3) % 3;
    if (!isSpawn && pm === 0 && pn === 0) {
      const edStaff = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (edStaff) buildStaffDoor(b, g, edStaff);
    }
  } else {
    const pm4 = ((cx % NEON_DOOR_PERIOD) + NEON_DOOR_PERIOD) % NEON_DOOR_PERIOD;
    const pn4 = ((cz % NEON_DOOR_PERIOD) + NEON_DOOR_PERIOD) % NEON_DOOR_PERIOD;
    if (pm4 === 0 && pn4 === 0) {
      buildGameDoor(b, g, cx, cz, forcedNeonDoorEdge(g), rng, 'asteroid');
    } else {
      const rGame = rng();
      const edGame = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (rGame < GAME_DOOR_CHANCE && edGame) buildGameDoor(b, g, cx, cz, edGame, rng);
    }
  }

  const rSplat = rng();
  if (rSplat < SPLAT_CHANCE) placeSplat(b, rng);

  kit.gridWalls(b, g, { matKey: 'L20:wall', height: H });
  kit.prop.floor(b, null, null, 0, { matKey: neon ? 'L20:floorNeon' : 'L20:floorWait' });
  kit.prop.ceiling(b, null, null, 0, { matKey: neon ? 'L20:ceilNeon' : 'L20:ceilWait', y: H });
  placeLights(b, g, neon);

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态、环境切换、危害 ----------
const WAITING_ENV = {
  // colors「白色混凝土、棕色地毯、灰色瓷砖天花板」——雾色/背景跟墙面基调走，亮堂的室内办公感
  background: 0xd8d4c8, fogColor: 0xd8d4c8, fogNear: 6, fogFar: 40,
  ambient: { color: 0xfff2df, intensity: 0.42 },
  // sounds「幻听：强风声、粗重的呼吸声……近来报告激增，偏执成为探索的一大威胁」——sanity 掉得比普通层快一档
  sanityDrainMul: 1.3, hungerDrainMul: 1,
  audio: 'wind-field', darkness: false,
};
const NEON_ENV = {
  // colors「霓虹区黑色瓷砖天花板、灰色地毯」——整体调暗调冷，配合霓虹灯的局部光源
  background: 0x0a0714, fogColor: 0x0a0714, fogNear: 4, fogFar: 30,
  ambient: { color: 0xaab0e6, intensity: 0.26 },
  // temperature「霓虹区越深入越冷，最低 -27℃」——sanity 掉速再上一档，配合 update 里的冻伤伤害体现"更危险"
  sanityDrainMul: 2, hungerDrainMul: 1,
  audio: 'wind-field', darkness: false,
};

const WINDOW_EPOCH = 4, COLD_EPOCH = 6, JELLY_EPOCH = 9;
const S = { timer: 0, game: null, attempt: 0, inNeon: false, windowEpoch: -1, coldEpoch: -1, jellyEpoch: -1, logRead: false, logCursed: false, logReadAt: 0, armed: [] };

// 惩罚性传送出口：只在判负的一瞬间打开，最多留 1.5 秒就强制关掉（验收④：以前开了就再也不关，
// 之后随便走近都会被传送，还绕开 20 秒冷却）。半径已经放大到和游戏判负距离一致（见 buildGameDoor），
// 正常情况下这一瞬间玩家必然还在圈里，会立刻触发换层；watchdog 只是防止极端情况下真的没触发时留手尾
function armPunishExit(tag) {
  const h = BR.kit.handles({ tag })[0];
  if (!h) return;
  h.setActive(true);
  S.armed.push({ tag, until: S.timer + 1.5 });
}

function resolveGame(ctx, d) {
  S.attempt += 1;
  const rf = U.rng(ctx.levelSeed, 'L20-game', Math.round(d.x * 10), Math.round(d.z * 10), S.attempt);
  const win = rf() < GAMES[d.kind].win;
  switch (d.kind) {
    case 'hex':
      if (win) { BR.player.addItem('soft_drink', 1); BR.hud.toast('你精准地砸中了绿色的六边形——一罐随机软饮咔哒一声掉了出来', 2400); BR.audio.play('click'); }
      else BR.hud.toast('红色的六边形冒了出来，扣分提示闪了一下，除此之外什么也没发生', 2200);
      break;
    case 'climb':
      if (win) { BR.player.addItem('hot_chocolate', 1); BR.hud.toast('你爬到了顶端——一杯热巧克力从终点滑了出来', 2400); }
      else {
        BR.hud.toast('脚下发绿光的踏点突然变红，液态痛苦从天花板灌了下来，瞬间没过了膝盖', 2600);
        BR.gfx.flash(0xff6a1a, 0.4, 0.5);
        if (BR.game.attackPlayers) BR.player.damage({ hp: 4, sanity: 6, source: 'hazard:liquid_pain' });
      }
      break;
    case 'asteroid':
      if (win) { BR.player.addItem('space_beverage', 1); BR.hud.toast('屏幕上最后一颗小行星炸开——一瓶太空主题饮料掉了下来', 2400); }
      else {
        BR.hud.toast('屏幕整个变红，你感到脚下一空', 2000);
        BR.gfx.flash(0x2a3a6a, 0.4, 0.4);   // 呼应门/屏幕的蓝色调（GAMES.asteroid.tint）
        armPunishExit(d.tag + '-lose6');
      }
      break;
    case 'laser':
      if (win) { BR.player.addItem('food_ration', 1); BR.player.addItem('almond_water', 1); BR.hud.toast('三分钟过去了，取物口掉出了食物和一瓶杏仁水', 2600); }
      else {
        const toSeven = rf() < 0.5;
        BR.gfx.flash(0xff2a4a, 0.4, 0.4);   // 呼应门/屏幕的红色调（GAMES.laser.tint）
        if (toSeven) {
          BR.hud.toast('激光扫过的瞬间，房间的边界忽然变得不真实', 2000);
          armPunishExit(d.tag + '-lose7');
        } else {
          // Level 154 远超首期范围，是 sealed 出口，传送了也只会弹"尚未开放"提示、不会真的换层——
          // 验收④：与其留一个只会常驻显示提示的隐藏出口，不如直接告诉玩家这条路走不通，出口保持关闭
          BR.hud.toast('房间的边界扭曲了一下——那条路通向的地方似乎还没有向任何人打开', 2400);
        }
      }
      break;
    case 'mole':
      if (win) BR.hud.toast('球准确地掉进了第 20 个洞里，屏幕闪烁了一下', 2400);
      else { BR.hud.toast('四声压低的犬吠从四面八方逼近……', 2400); BR.audio.play('growl'); }
      break;
  }
}

function enter(ctx) {
  S.timer = 0; S.game = null; S.attempt = 0; S.inNeon = false;
  S.windowEpoch = -1; S.coldEpoch = -1; S.jellyEpoch = -1;
  S.logRead = false; S.logCursed = false; S.logReadAt = 0;
  S.armed = [];
  BR.gfx.applyEnv(WAITING_ENV);
  // 依据 entrances「标记'娱乐区'的蓝色门」/「名为'娱乐区'的建筑」（L11.js 已建好对应的 to:'20' 门）
  BR.hud.toast('你穿过标着"FUN ZONE"的蓝色门，身后的门无声地合上了——面前是望不到头的白色等候厅', 3600);
}

function update(ctx, dt) {
  S.timer += dt;

  // ---------- 惩罚性传送出口 watchdog：到期还没触发就强制关掉（见 armPunishExit 的注释）----------
  if (S.armed.length) {
    for (let k = S.armed.length - 1; k >= 0; k--) {
      if (S.timer >= S.armed[k].until) {
        const h = BR.kit.handles({ tag: S.armed[k].tag })[0];
        if (h) h.setActive(false);
        S.armed.splice(k, 1);
      }
    }
  }

  // ---------- 霓虹区进出：切换环境光/雾色，体现"越深越冷、越压抑"----------
  const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
  const dNow = dist(cc.cx, cc.cz);
  const inNeonNow = dNow > WAIT_R;
  if (inNeonNow !== S.inNeon) {
    S.inNeon = inNeonNow;
    BR.gfx.applyEnv(inNeonNow ? NEON_ENV : WAITING_ENV);
    BR.hud.toast(inNeonNow ? '灯光变成了霓虹色——你走进了霓虹区，大厅在向下延伸' : '灯光变白了——你退回了等候厅', 2600);
  }

  // ---------- 霓虹区深处：越深越冷，冻伤风险（hazards「越深越冷，有冻伤风险」）----------
  if (inNeonNow) {
    const depth = Math.min(dNow - WAIT_R, 6);
    const fe = Math.floor(S.timer / COLD_EPOCH);
    if (fe !== S.coldEpoch) {
      S.coldEpoch = fe;
      const r = U.rng(ctx.levelSeed, 'L20-cold', fe);
      if (r() < 0.15 + depth * 0.05) {
        BR.audio.play('static');
        BR.gfx.flash(0x1a2540, 0.3, 0.35);
        if (BR.game.attackPlayers) BR.player.damage({ hp: 2 + depth, sanity: 3, source: 'hazard:frostbite' });
        else BR.hud.toast('刺骨的冷意扎进骨头里', 1800);
      }
    }
  }

  // ---------- 窗户附近：极寒 + 偏执幻觉（hazards「-22℃至-43℃……轻微头痛、极度偏执」）----------
  const we = Math.floor(S.timer / WINDOW_EPOCH);
  if (we !== S.windowEpoch) {
    S.windowEpoch = we;
    let near = false;
    for (const c of BR.world.chunks()) {
      const wins = c.res && c.res.data && c.res.data.windows;
      if (!wins) continue;
      for (const w of wins) {
        const dx = BR.player.x - w.x, dz = BR.player.z - w.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) { near = true; break; }
      }
      if (near) break;
    }
    if (near) {
      const r = U.rng(ctx.levelSeed, 'L20-window', we);
      if (r() < 0.4) {
        const msgs = ['耳边灌满了呼啸的风声——可四下一点风都没有', '沉重的呼吸声贴着后颈响了一下，回头却没人', '太阳穴突突地跳，像是被人用力按了一下'];
        BR.hud.toast(msgs[(r() * msgs.length) | 0], 2200);
        BR.audio.play('whisper');
        if (BR.game.attackPlayers && r() < 0.5) BR.player.damage({ sanity: 3, hp: 0, source: 'hazard:window_cold' });
      }
    }
  }

  // ---------- 橙色果冻状物质：纯氛围，无危害 ----------
  const je = Math.floor(S.timer / JELLY_EPOCH);
  if (je !== S.jellyEpoch) {
    S.jellyEpoch = je;
    const r = U.rng(ctx.levelSeed, 'L20-jelly', je);
    if (r() < 0.25) { BR.audio.play('hit'); BR.hud.toast('头顶啪嗒一声——一坨橙色的胶状物砸在不远处的地上，没什么异常', 2200); }
  }

  // ---------- 信息危害：探险日志（接待台上，固定位置）----------
  if (!S.logRead) {
    const dx = BR.player.x - LOG_X, dz = BR.player.z - LOG_Z;
    if (dx * dx + dz * dz < 1.4 * 1.4) {
      S.logRead = true; S.logReadAt = S.timer;
      BR.hud.toast('桌上摊着一份麦克唐纳小队的探险记录：2月6日雅各布被撕碎，2月7日约瑟夫被杀，2月8日艾萨克最后一次接触了什么东西……', 4200);
    }
  }
  if (S.logRead && !S.logCursed && S.timer - S.logReadAt > 3) {
    S.logCursed = true;
    BR.hud.toast('看完这些记录，你感到一阵不祥的寒意顺着后颈爬了上来', 3000);
    if (BR.game.attackPlayers) BR.player.damage({ sanity: 6, hp: 0, source: 'hazard:info_hazard' });
  }

  // ---------- 霓虹区游戏门：靠近开始、离开取消、停留够时长判定胜负 ----------
  if (!S.game) {
    outer:
    for (const c of BR.world.chunks()) {
      const doors = c.res && c.res.data && c.res.data.doors;
      if (!doors) continue;
      for (const dr of doors) {
        if (S.timer < dr.cooldownUntil) continue;
        const dx = BR.player.x - dr.x, dz = BR.player.z - dr.z;
        if (dx * dx + dz * dz <= 2.2 * 2.2) {
          S.game = { door: dr, t: 0 };
          BR.hud.toast(`你走近了"${GAMES[dr.kind].zh}"游戏门，机关开始运转……`, 1800);
          break outer;
        }
      }
    }
  } else {
    const dr = S.game.door;
    const dx = BR.player.x - dr.x, dz = BR.player.z - dr.z;
    if (dx * dx + dz * dz > 3.4 * 3.4) {
      S.game = null;
    } else {
      S.game.t += dt;
      if (S.game.t >= GAMES[dr.kind].dwell) {
        resolveGame(ctx, dr);
        dr.cooldownUntil = S.timer + 20;
        S.game = null;
      }
    }
  }
}

function leave() { S.game = null; }

BR.levels.register({
  id: '20',
  name: 'Level 20',
  title: '玻瑞阿斯的建筑',
  nickname: '娱乐区',
  version: 'wikidot-cn',
  survivalClass: '4',
  chunkSize: SIZE,
  env: WAITING_ENV,
  spawn() {
    // 出生在接待房间中心，面朝 -Z 正对接待台/储物柜/售货机（landmarks 里最先列出的一批地标）
    return { x: (SPAWN_I + 0.5) * CELL, y: 0, z: (SPAWN_J + 0.5) * CELL, yaw: 0 };
  },
  buildChunk,
  entities: [
    // 依据 entities[]：8 个物种大多"只列出名字"或密度只写"等候厅内实体极少；霓虹区越深入数量越多"，
    // entityDensityOverall 判断为 moderate；参照 L1/L5/L9 对同一批物种的拆法——单一形态取 rare(0.04)，
    // 雌雄两态各分一半。"越深越多"的空间梯度引擎做不到（entities 表是整层单值，见 apiRequests），
    // 只能依赖引擎"出生点周边 3×3 块不刷有害实体"的默认规则，让等候厅入口附近天然更安全一些。
    // 牧蛇（wrangler）在本版本里只在「打爆小行星」游戏失败时被生成，原文没写它会在等候厅/霓虹区常态游荡，
    // 不编造常驻密度，改在 resolveGame 的传送分支里体现（见 apiRequests：不能真的生成实体，只做传送半截）
    { type: 'hound', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'clump', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'skin_stealer', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'growler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'nguithrxurh', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'faceling', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'deathmoth_male', officialPer1000m2: BR.config.densityWords.rare / 2 },
    { type: 'deathmoth_female', officialPer1000m2: BR.config.densityWords.rare / 2 },
  ],
  items: [
    // 全部取自 data/item-spawn.json 里 levels 含 '20' 且 js/items/<key>.js 已存在的条目，per1000m2 直接用该文件的值
    { type: 'almond_water', per1000m2: 1.2 },                     // 用户规则：所有模式都刷
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'soft_drink', per1000m2: 0.8 },                       // items「储物柜、软饮料自动售货机」
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.01 },                      // 死亡飞蛾出没层级之一
    { type: 'hot_chocolate', per1000m2: 0 },                      // 只作攀岩胜利奖励发放，不在地上随机刷（item-spawn.json 同值）
    { type: 'food_ration', per1000m2: 0.6 },                      // 用户规则：所有模式都刷食物
  ],
  exits: [
    { to: '2', kind: 'door', note: '等候厅员工专用门；按 (cx%3,cz%3)==(0,0) 周期放置，任意位置 3 块内必有一扇 (exits[0])' },
    { to: '24', kind: 'zone', note: '切入等候厅窗户；每扇窗户 50% 概率通向这里，Level 24 不在首期范围，sealed (exits[1])' },
    { to: '78', kind: 'zone', note: '同一扇窗户另 50% 概率通向这里，Level 78 不在首期范围，sealed (exits[2])' },
    { to: '4', kind: 'door', note: '霓虹区游戏门"概率极小"失灵变传送门；三个目标各占 1/3，Level 4 不在首期范围，sealed (exits[3])' },
    { to: '21', kind: 'door', note: '同上，Level 21 不在首期范围，sealed (exits[4])' },
    { to: '36', kind: 'door', note: '同上，Level 36 不在首期范围，sealed (exits[5])' },
    { to: '6', kind: 'event', note: '打爆小行星游戏失败的惩罚性传送；另一后果"生成牧蛇"引擎不能运行时生成实体，未实现 (exits[6])' },
    { to: '7', kind: 'event', note: '躲避激光游戏失败，50% 概率传送到这里 (exits[7])' },
    { to: '154', kind: 'event', note: '躲避激光游戏失败，另 50% 概率；Level 154 不在首期范围，sealed (exits[8])' },
  ],
  enter,
  update,
  leave,
});
})();
