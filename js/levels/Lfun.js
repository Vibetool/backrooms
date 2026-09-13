// Level Fun =)（享乐层 =)）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-fun  许可：CC BY-SA 3.0
// 页面版本 60，最后编辑 2026-07-20；原作者 1000dumplings（页面自注有删改）
// data/lore-choices.json levels['fun'].source = 'wikidot-cn'（冲突随机选中，见 conflicts）
// 只按这一个版本实现：wikidot-en 的移动邮轮 Adventure/派对客零号 Deacon Duncan/食肉气球(Entity 110)/
// 派对主人(Entity 167)，以及 fandom 的三段式充气城堡仓库→游戏室→派对室/Sanguine Festivus 病毒等
// conflicts 里列出的细节一律不借。本层绝大多数环境字段选中版本原文标了 unverified（布局、尺度、材质、
// 颜色、灯光、声音、气味、温度、天气），一律不从别的版本补、不凭记忆编造，只用能撑起玩法的最小合理
// 近似（处理思路参照 L12.js 对同样大面积 unverified 字段的做法），并在下面注释里写明是近似。
// "派对之主"在 data/entity-index.json 的 loreOnly 里（层级页没提到它，实体页也没说它在享乐层）——不刷。
//
// 验收修订（第五批集成反馈）：
// ①（high）原实现只用 kit.grid 的 roomChance 随机挖开几块地，四周墙体是否封闭全凭 wallDensity/loopChance
// 的运气，实测经常整面敞开，玩起来看不出"小型派对室"、跟去掉墙纸的 Level 0 没区别。改为在 gridWalls 之前
// 用 g.setWall 把每个 g.rooms 房间的内部周长强制围成墙，只留 1-2 段随机门洞当出入口，并且每间房必刷装饰
// （不再按概率跳过），房间越大堆得越多。见 buildChunk 里的"围墙"与"装饰"两段。
// ②（low）partyTable 里 b.push 的参数顺序错了（签名是 push(x,z,rot,y)，之前传成 (x,y,z)），已改正。
// ③（low）出生点头顶的塌陷天花板缺口/彩带是没有原文依据的编造细节，且完全在玩家视野之外，已删除，腾出
// 的面数预算挪给实际派对装饰。
// ④（low）离场提示改到 enter() 里一次性说完，去掉 update() 里 4.6 秒后弹出的第二条、读起来像调研笔记的提示。
//
// 二次验收修订：
// ⑤（high）entities 表写的 type: 'partygoer' 从未被注册（js/entities/partygoer.js 只注册了
// partygoer_biped/partygoer_pedestal 两个下肢形态），world 静默跳过整行，一只都刷不出来。改成两个
// 真实注册名，密度对半拆分（原文两种下肢形态没给比例）。
// ⑥（high）encloseRoom 逐间强制围墙时没检查 g.rooms 是否互相重叠——kit.grid 生成随机房间时本来就不保证
// 不重叠，两间重叠的房间各自的锁定墙会正好穿过对方内部，reconnect 不会拆锁定墙，导致约 2.5% 的格子被
// 关死出不去，也有约两成派对桌卡在这类锁定墙线上、穿模。改为按出现顺序丢弃与已选房间重叠的房间，只对
// 互不重叠的房间围墙和摆装饰。
// ⑦（high）出生房之前完全跳过装饰（是 g.rooms 之外单独 g.carve 出来的），四面看过去都是没贴东西的素墙，
// 完全不像"小型派对室"。改为按出生房实际生成的墙段动态摆装饰：只贴着真正闭合的墙段（不挡开着的门），
// 并且离出生点留够 2 m 以上净空。
// ⑧（medium）survivalClass 之前直接塞了一整句调研笔记，HUD 会原样拼进标题条给玩家看，改成纯数字，
// 依据挪到该字段旁边的注释里。
// ⑨（medium）气球用最低档二十面体（20 面）在截图里读成一个个色块六边形，桌子只有一条腿悬空；
// 三角面预算还有大量富余，气球提到 1 档细分（80 面）+ 底部收口，桌子改成四条腿。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;

// ---------- 尺寸 ----------
// architecture 原文只有一句「小型派对室」，layout/scale 均 unverified——没有走廊/多区域描述，也没有像
// L12 那样"无限空地"的线索。按字面"小"把每个房间做成 2-3 格（6-9 m）的小房间，kit.grid 用高 roomChance
// 让全层长满这种"小派对室"、彼此长得差不多，呼应"不管走到哪都还是这间小派对室、出不去"的整体气氛
// （design 近似）
const SIZE = 24, N = 8, CELL = SIZE / N;   // 区块 24 m、8×8 格、3 m 一格，沿用其他迷宫层的通用档位
const H = 2.8;                             // 层高原文没给数字，用 kit 缺省层高

const EDGE = { salt: 'Lfun', boundaryDensity: 0.32, straightness: 0.55, minOpenings: 2 };
// roomChance 提到 0.8、maxRooms 提到 5：配合下面"强制围墙"的处理，让一个区块里大概率能长出 2-3 间
// 明确带门的小房间，而不是像之前那样平均 1.35 间、还经常和走廊融成一片（验收①）。wallDensity 从 0.28
// 提到 0.34、loopChance 从 0.55 降到 0.4：走廊本身也收紧一点，配合房间围墙一起压缩"纯走廊"的占比
const ROOM = Object.assign({ wallDensity: 0.34, roomChance: 0.8, maxRooms: 5, roomSize: [2, 3], loopChance: 0.4, pillarChance: 0.04 }, EDGE);
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 材质 ----------
// materials/colors 原文都是 unverified（只提到"室内有大量蛋糕、饼干和杏仁水"，没提墙面/地板材质或颜色）；
// 不借用 wikidot-en 的"钢制船体/猩红泳池"或 fandom 的"彩色乙烯基地砖/全息彩带"，用不带贴图的纯色材质
// （顶点色 Phong），选一个不刺眼的暖白基调——刻意和 Level 0 那种偏暗黄办公漆区分开，避免混淆
function defineMaterials() {
  kit.mat('Lfun:wall', { color: 0xe8ddce, roughness: 0.92, vertexColors: true });
  kit.mat('Lfun:floor', { color: 0xcdbfa6, roughness: 0.95, vertexColors: true });
  kit.mat('Lfun:ceil', { color: 0xf1ece2, roughness: 0.95, vertexColors: true });
}

// Entity C-233 页「彩色气球…当诱饵」——原文只给"彩色"，没给具体色号，取常见节庆色
const BALLOON_COLORS = [0xffcf40, 0xff5f7a, 0x4fc3ff, 0x74e28a, 0xffffff];

// 气球串：细分档 1 的二十面体（80 面）比原来的 0 档（20 面，截图里读成一个个色块六边形）更接近圆球，
// 三角面预算还有大量富余，换得起（验收⑤）；系一根细绳到 baseY 那个高度（桌面或地面都能用）
function balloonCluster(b, rng, radius, baseY) {
  const T = window.THREE;
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI * 2 + rng() * 0.6;
    const ax = Math.cos(ang) * radius, az = Math.sin(ang) * radius;
    const by = baseY + 1.1 + rng() * 0.4;
    const col = BALLOON_COLORS[(rng() * BALLOON_COLORS.length) | 0];
    b.cylinder(ax, baseY, az, 0.008, by - baseY, 'kit:prop', { color: 0xd8d0c0, segments: 5, caps: false, solid: false });
    const geo = new T.IcosahedronGeometry(0.13, 1);
    b.mesh(geo, 'kit:prop', { x: ax, y: by, z: az, color: col, solid: false });
    geo.dispose();
    // 气球底部打结的小结——原文没写具体形状，只是给这颗"球"一个能看出上下方向的小细节，不是设定
    b.cylinder(ax, by - 0.12, az, 0.02, 0.03, 'kit:prop', { color: col, segments: 5, solid: false });
  }
}

// ---------- 派对桌摆件：蛋糕 + 饼干 + 气球 ----------
// 依据：items「小型派对室里有大量蛋糕、饼干和杏仁水」+ Entity C-233 页「彩色气球…当诱饵」。
// 这里摆的是不可拾取的静态装饰，用来呈现原文"大量"的堆积感；真正能捡的杏仁水另由 items 表
// 按 data/item-spawn.json 的稀有度随机刷（那张表的稀有度取值来自别的调研页，不代表这屋子里东西很少）
function partyTable(b, rng) {
  const legH = 0.7, topH = 0.05, topY = legH + topH;
  // 四条桌腿代替之前悬空的单腿（验收⑤：单腿在截图里看着像板子飘在半空，没有真实桌子的支撑感）；
  // 内缩 0.15/0.10 让腿落在桌面下方看得见的位置，不贴桌沿
  const lx = 0.65 - 0.15, lz = 0.325 - 0.10;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(sx * lx, 0, sz * lz, 0.05, legH, 0.05, 'kit:prop', { color: 0x8a715a });
  }
  b.box(0, legH, 0, 1.3, topH, 0.65, 'kit:prop', { color: 0xcda06a });               // 桌面

  // 两层蛋糕（原文只说"蛋糕"没写造型；按常见生日蛋糕的双层轮廓给一点形状细节，不编造具体口味/图案）
  // push(x, z, rot, y)：修正此前 (x, y, z) 传错顺序导致 z 偏移丢失、多出一个没意义的小旋转的问题
  b.push(-0.25, -0.05);
  b.cylinder(0, topY, 0, 0.17, 0.12, 'kit:prop', { color: 0xf5e6d3, segments: 10, solid: false });
  b.cylinder(0, topY + 0.12, 0, 0.1, 0.09, 'kit:prop', { color: 0xff9fb8, segments: 10, solid: false });
  b.pop();

  // 饼干堆（原文"饼干"没写外观，参照 js/items/cookies.js 的圆饼干造型，叠几片、位置略微抖动）
  b.push(0.35, 0.15);
  for (let k = 0; k < 3; k++) {
    const jx = (rng() - 0.5) * 0.02, jz = (rng() - 0.5) * 0.02;
    b.cylinder(jx, topY + k * 0.016, jz, 0.06, 0.014, 'kit:prop', { color: 0xc98d4a, segments: 8, solid: false });
  }
  b.pop();

  balloonCluster(b, rng, 0.55, topY);
}

// 房间较大时额外撒的一撮"地摊式"蛋糕+饼干堆（没有桌子撑着，直接堆在地上），配合气球——
// 用来撑起原文"大量"的堆积感，同时不必每一撮都占用一整张桌子的面数（验收①：装饰太少太单薄）
function foodPile(b, rng) {
  b.cylinder(0, 0, 0, 0.16, 0.11, 'kit:prop', { color: 0xf5e6d3, segments: 10, solid: false });
  b.cylinder(0, 0.11, 0, 0.1, 0.08, 'kit:prop', { color: 0xff9fb8, segments: 10, solid: false });
  for (let k = 0; k < 3; k++) {
    const jx = (rng() - 0.5) * 0.3, jz = (rng() - 0.5) * 0.3;
    b.cylinder(jx, k * 0.02, jz, 0.06, 0.014, 'kit:prop', { color: 0xc98d4a, segments: 8, solid: false });
  }
  balloonCluster(b, rng, 0.4, 0);
}

// 出生格所在的 2×2 区域另外单独 g.carve/g.reserve（见 buildChunk），这里判断某个自动生成的 g.rooms
// 房间是否和它重叠，重叠的话既不强制围墙、也不摆装饰，避免出生点被锁死的墙圈住或被桌子堵住
function overlapsSpawnRoom(isSpawn, room) {
  if (!isSpawn) return false;
  return room.i < SPAWN_I + 2 && room.i + room.w > SPAWN_I && room.j < SPAWN_J + 2 && room.j + room.d > SPAWN_J;
}

// 两个 g.rooms 矩形是否重叠——kit.grid 生成随机房间（_kit.js 的"开阔房间"那段）不检查彼此是否
// 重叠，同一区块里两间房完全可能叠在一起（验收⑥）
function roomsOverlap(a, c) {
  return a.i < c.i + c.w && a.i + a.w > c.i && a.j < c.j + c.d && a.j + a.d > c.j;
}

// 按 g.rooms 出现顺序挑一批互不重叠、也不跟出生房重叠的房间：后出现的房间只要跟已经选中的某间
// 重叠就整个丢弃（不围墙、不摆装饰）。验收⑥核心修复：之前对每间房都各自 encloseRoom，两间重叠的
// 房间会各自把锁定墙插进对方内部——reconnect 只拆得动没锁定的墙，这类锁定墙会把部分格子永久围死，
// 也会有派对桌卡在这类墙线上穿模；丢弃重叠的房间后每间被处理的房间都是完整、独立的矩形
function pickNonOverlappingRooms(g, isSpawn) {
  const kept = [];
  for (const room of g.rooms) {
    if (overlapsSpawnRoom(isSpawn, room)) continue;
    if (kept.some(r => roomsOverlap(r, room))) continue;
    kept.push(room);
  }
  return kept;
}

// 把一个 g.rooms 房间的内部周长强制围成墙，只留 1-2 段随机门洞（贴住区块边界的那几段交给边界生成，
// 不强改——setWall 本来就不让碰边界线）。gridWalls 检测到 g._dirty 会自动用独立随机流重新 reconnect
// 一次（不吃层级 rng、也不会拆掉这里锁上的墙），所以不用担心把地图切成孤岛（验收①核心修复）
function encloseRoom(g, room, rng) {
  const perim = [];
  for (let i = room.i; i < room.i + room.w; i++) {
    if (room.j > 0) perim.push({ axis: 'h', i, j: room.j });
    if (room.j + room.d < g.rows) perim.push({ axis: 'h', i, j: room.j + room.d });
  }
  for (let j = room.j; j < room.j + room.d; j++) {
    if (room.i > 0) perim.push({ axis: 'v', i: room.i, j });
    if (room.i + room.w < g.cols) perim.push({ axis: 'v', i: room.i + room.w, j });
  }
  if (!perim.length) return; // 四面都贴区块边界（房间几乎和区块一样大），交给边界生成决定，不强行围死
  const doorCount = Math.min(perim.length, rng() < 0.5 ? 1 : 2);
  const doors = new Set();
  while (doors.size < doorCount) doors.add(Math.floor(rng() * perim.length));
  perim.forEach((e, idx) => g.setWall(e.axis, e.i, e.j, !doors.has(idx)));
}

// 出生房单独装饰：出生房是 g.carve 手工挖出来的、不在 g.rooms 里，之前两个装饰循环都靠 overlapsSpawnRoom
// 整间跳过，导致朝哪看都是没贴东西的素墙（验收⑦）。这里不新增墙（出生点四周会不会被围死不可控，不
// 冒这个险），只按出生房实际生成的墙段"贴墙摆"：8 段周长里凡是闭合的（isWall 为真）就在它内侧摆一件，
// 开着口的那几段（门/过道）留空不挡；每段内侧摆放点到房间中心的直线距离最近也有约 2.1 m（inset 0.9 m
// 加上房间半宽 3 m 的几何关系），出生点周围留得够干净。东墙（spawn() 的 yaw 面朝 +X）的闭合段优先摆桌子，
// 让玩家一睁眼朝前就能看见；东墙两段都是门/过道（没有闭合段可贴）时，仍在正前方偏一侧硬摆一件保底，
// 不然朝前看还是只有一条空走廊（验收⑦的硬性要求）
function decorateSpawnRoom(b, g, rng) {
  const inset = 0.9;
  const east = [];
  let rest = [];
  for (let j = SPAWN_J; j < SPAWN_J + 2; j++) {
    if (g.isWall('v', SPAWN_I + 2, j)) east.push({ x: (SPAWN_I + 2) * g.cellW - inset, z: (j + 0.5) * g.cellD });
  }
  for (let i = SPAWN_I; i < SPAWN_I + 2; i++) {
    if (g.isWall('h', i, SPAWN_J)) rest.push({ x: (i + 0.5) * g.cellW, z: SPAWN_J * g.cellD + inset });
    if (g.isWall('h', i, SPAWN_J + 2)) rest.push({ x: (i + 0.5) * g.cellW, z: (SPAWN_J + 2) * g.cellD - inset });
  }
  for (let j = SPAWN_J; j < SPAWN_J + 2; j++) {
    if (g.isWall('v', SPAWN_I, j)) rest.push({ x: SPAWN_I * g.cellW + inset, z: (j + 0.5) * g.cellD });
  }
  if (!east.length) {
    // 1.4 m 的偏移：离出生点够远（>1.2 m 净空），离东墙也够远（东墙如果整段是门，6 m 宽绰绰有余不挡路）
    const fx = (SPAWN_I + 1) * g.cellW + 1.4, fz = (SPAWN_J + 1) * g.cellD - 1.4;
    east.push({ x: fx, z: fz });
    rest = rest.filter(s => Math.hypot(s.x - fx, s.z - fz) > 1.3); // 离保底这件太近的贴墙点让开，避免穿模
  }
  const spots = east.concat(rest);
  spots.forEach((s, idx) => {
    b.push(s.x, s.z, rng() * Math.PI * 2);
    if (idx === 0) partyTable(b, rng); else foodPile(b, rng);
    b.pop();
  });
}

// ---------- 区块 ----------
// rng 消耗顺序固定：格子（含自动房间挑选）→ 逐间房围墙（每间房 1 次门数 roll + 若干次门位置 roll，
// 重叠被丢弃的房间不消耗）→ 出生房装饰（每件摆件 1 次朝向 roll，不消耗别的 rng）→ 普通房间装饰
// （1 次朝向 roll + 桌子/地摊堆内部各自的 roll）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  const g = kit.grid(b, N, N, ROOM);
  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    // 整间出生房都要留干净（不放派对桌），不然出生点正好卡进桌子/气球里——4 个格子全部 reserve
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) g.reserve(SPAWN_I + di, SPAWN_J + dj);
  }

  // 互不重叠、也不跟出生房重叠的房间列表，围墙和装饰两段都用这同一份，保证处理的都是完整独立的房间（验收⑥）
  const rooms = pickNonOverlappingRooms(g, isSpawn);

  // 逐间房强制围墙、留 1-2 个门洞，让"小型派对室"真正读得出是一间间独立小屋（验收①）
  for (const room of rooms) encloseRoom(g, room, rng);

  kit.gridWalls(b, g, { matKey: 'Lfun:wall' });
  kit.prop.floor(b, null, null, 0, { matKey: 'Lfun:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'Lfun:ceil', y: H });

  if (isSpawn) decorateSpawnRoom(b, g, rng); // 验收⑦：出生房单独按实际墙段摆装饰

  // 「小型派对室」堆着大量蛋糕/饼干/彩色气球——数量原文没给（unverified）。每间房都摆至少一桌，
  // 房间越大（面数预算允许的前提下）额外撒 1-3 撮地摊式堆，让"到处都是"的观感更实在（验收①：
  // 之前用 0.55 的概率跳过装饰，导致八成房间空空如也；现在改成必刷）
  for (const room of rooms) {
    const rot = Math.floor(rng() * 4) * (Math.PI / 2);
    const rx = (room.i + room.w / 2) * g.cellW, rz = (room.j + room.d / 2) * g.cellD;
    b.push(rx, rz, rot);
    partyTable(b, rng);
    b.pop();

    const area = room.w * room.d;                       // 2x2=4、2x3/3x2=6、3x3=9
    const extra = Math.min(3, Math.floor(area / 3));     // 4->1、6->2、9->3 撮额外堆，总计 2-4 撮／间
    for (let e = 0; e < extra; e++) {
      const ox = (room.i + 0.6 + rng() * Math.max(0.01, room.w - 1.2)) * g.cellW;
      const oz = (room.j + 0.6 + rng() * Math.max(0.01, room.d - 1.2)) * g.cellD;
      b.push(ox, oz, rng() * Math.PI * 2);
      foodPile(b, rng);
      b.pop();
    }
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: 'fun', name: 'Level Fun',
  title: '享乐层 =)',
  nickname: '', // 原文没有正式别称，只有第一人称欢快口吻的自我介绍，不硬造一个别称往里塞
  version: 'wikidot-cn',
  // 验收⑧：survivalClass 之前直接把调研笔记塞进这个字段，HUD 会原样拼进"生存难度等级 XXX"标题条给玩家看
  // （js/game/hud.js 只是在前面加前缀，不会再处理），改成纯数字，页面标注依据挪到这条注释里：
  // 生存难度 5 只是选中版本 wikidot-cn 页面的标签栏标注，正文没有单独的难度框或安全性描述词
  survivalClass: '5',
  chunkSize: SIZE,
  env: {
    background: 0x241d17, fogColor: 0x241d17, fogNear: 6, fogFar: 40,
    // lighting 原文 unverified：不摆灯盘等具体灯具（没有色温/闪烁可参照），只用环境光把房间照到"看得清
    // 但不刺眼"的亮度——处理思路同 L12.js 对"lighting unverified"的做法（那边原文写了"明亮"所以环境光
    // 顶到 1.05；这里原文什么都没说，只保证不违反①号验收规则的"纯黑"，不额外发明灯具/闪烁细节）
    ambient: { color: 0xfff1de, intensity: 0.42 },
    sanityDrainMul: 1, hungerDrainMul: 1,   // temperature/weather 原文 unverified，用默认倍率，不额外加成
    audio: 'silence',   // sounds 原文「unverified（原文未描述）」——不编造声音，选最不生编的档（同 L12/L16 先例）
    darkness: false,
  },
  // 出生房南北两面墙正好没有开口（3m 外就是整面墙），朝北/朝南出生第一眼就是一堵空墙，很难看；
  // 东西两面是这间房通向迷宫其他房间的开口，朝东出生第一眼能看到房间外的过道，体验近似（design 近似）
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: -Math.PI / 2 }; },
  buildChunk,
  entities: [
    // entityDensityOverall「high（依据 Entity C-233 页：绝大部分派对客栖息于享乐层；层级页本身没给数量）」
    // → 定性描述直接取 BR.config.densityWords.high；officialPer1000m2 是"正常后室"密度，游玩/噩梦的减半、
    // 分档系数由 world 按 spawnFactor 处理，这里不再手动打折（用户规则）
    // 验收⑤：js/entities/partygoer.js 没有注册总名 'partygoer'，只注册了 partygoer_biped/partygoer_pedestal
    // 两个下肢形态（世界会静默跳过未注册的 type，写总名会导致一只都刷不出来，见规则④）。C-233 页原文只说
    // "下肢形态不固定：有时……有时……"，两种形态没有给比例，也没有"转化后的人类多为人腿型"这类说法——
    // 不编造比例，把 high 的份额对半拆给两个已注册形态（同款处理见 L9.js/L20.js 对 deathmoth 雌雄的对半拆分）
    { type: 'partygoer_biped', officialPer1000m2: BR.config.densityWords.high / 2 },
    { type: 'partygoer_pedestal', officialPer1000m2: BR.config.densityWords.high / 2 },
  ],
  items: [
    // data/item-spawn.json 里 levels 含 'fun' 且 js/items/<key>.js 已存在的全部条目（数值原样取用）。
    // 验收②：原来还列了 partygoer_cake，但那个道具的文件头写的是 wikidot-en「派对客用人体组织做蛋糕、
    // 禁止食用」的设定，和本层选中的 wikidot-cn 版本冲突（conflicts 明确点名这条不许借），已移除；
    // data/item-spawn.json 里 cookies 的 levels 是空数组（basis 写着"选中版本没提到饼干"），但 wikidot-cn
    // 原文明明写了"大量蛋糕、饼干和杏仁水"——这是数据表用错版本判断，本文件不许碰 data/*.json，
    // 已在返回值 apiRequests 里报给数据维护者，这里不擅自加 cookies
    { type: 'almond_water', per1000m2: 1.2 },                   // 用户规则：所有模式都刷杏仁水
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    { type: 'food_ration', per1000m2: 0.6 },                    // 用户规则：所有模式都刷食物；本层没有设定内成型食物，占位罐头口粮兜底
  ],
  // 出口栏原文只有一句反问「你为什么想要离开呢？=)」，没有给出任何离开方法（规则⑫）：
  // 不摆通往已开放层级的出口，也不新增虚构出口；改在 enter() 里一次性 toast 提示暂停菜单能回主页
  exits: [],
  enter() {
    // hazards「隐性威胁：页面提醒访客不要扫了主人的兴」+ 层级页第一人称的欢快邀请语气（转述，不摘原文）；
    // 验收④：把"没写离开办法"的提示合并进同一条欢迎语，去掉 update() 里延迟 4.6 秒弹出的第二条提示
    BR.hud.toast('欢迎来到享乐层 =) 大家都很期待你留下来——你为什么想要离开呢？=) 如果实在想走，可以从暂停菜单返回主页', 5600);
  },
  update(ctx, dt) {},
  leave() {},
});
})();
