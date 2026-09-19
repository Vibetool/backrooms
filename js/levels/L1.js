// Level 1 - "宜居地带"（Habitable Zone 的中文译名；译者 ShorterIsBetter9、Linw5、whitelu、MC13min、wild ghost377）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-1  许可：CC BY-SA 3.0
// 只按这个版本实现，冲突列表（conflicts）里属于 wikidot-en / fandom 的细节一律不做（WAVE2.md 第 1 节）：
//   没有 fandom 的立体停车场楼梯间/Maintenance Halls/Luxury Lots/tripse 合金/伪水坑/画作实体；
//   没有 wikidot-en 的按数字算出的出口列表差异（740/739 只在中文站，本文件按中文站列出）；
//   过道/小径叫法用中文站术语（halls=过道，corridors=小径），六个区段名沿用中文站译名。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：environment.scale「过道墙壁绵延数英里…Level 1 极为庞大，大得离谱」——开阔层，chunkSize 取上限区间的中段
const SIZE = 32, N = 8, CELL = SIZE / N;   // 32 m 区块、8×8 格、4 m 一格
const H = 2.8;                             // 层高：原文没给数字，用 kit 默认层高

// ---------- 布局：过道（hall，开阔）与小径（corridor，迷宫）----------
// 依据：environment.architecture「过道：宽敞开阔…被形容为地下停车场和废弃仓库的无尽缝合体」
//      「小径：经单/双推门进入…狭窄曲折如迷宫、灯光昏暗的混凝土通道网络」
// 边界参数全层一致（TEMPLATE 7.2 节），区块类型只改内部墙密度/房间/柱子概率
const EDGE = { salt: 'L1', boundaryDensity: 0.28, straightness: 0.6, minOpenings: 3 };
const HALL = Object.assign({ wallDensity: 0.12, roomChance: 0.5, maxRooms: 3, roomSize: [2, 5], loopChance: 0.6, pillarChance: 0.12 }, EDGE);
const CORRIDOR = Object.assign({ wallDensity: 0.55, roomChance: 0.2, maxRooms: 1, roomSize: [2, 3], loopChance: 0.3, pillarChance: 0 }, EDGE);
const P_HALL = 0.8;                        // 依据：过道「绵延数英里」为主体，小径是门后的次级迷宫网络（占少数）
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 六个区段（宏格哈希，跨区块协调，见 TEMPLATE 4.2 节）----------
// 依据：landmarks「天鹰/跃金/哥特/衔尾/花园/传说」六个区段；「衔尾段为迄今记录的最小区段」→ 权重最低
const SECTOR_MX = 3;   // 3×3 区块（约 96 m）一个区段patch，太小会显得区段切换过于频繁
const SECTORS = [['tianying', 0.22], ['yuejin', 0.22], ['gothic', 0.16], ['garden', 0.16], ['legend', 0.16], ['ouroboros', 0.08]];
function sectorAt(levelSeed, cx, cz) {
  const mx = Math.floor(cx / SECTOR_MX), mz = Math.floor(cz / SECTOR_MX);
  if (mx === 0 && mz === 0) return 'tianying';   // 依据：landmarks「新人通常从黄色厅房切入此处；Alpha 基地所在」——出生区固定天鹰段
  return U.weighted(U.rng(levelSeed, 'L1-sector', mx, mz), SECTORS);
}

// ---------- 材质 ----------
function defineMaterials() {
  kit.mats({
    // 依据：materials「水泥地面触感粗糙；混凝土墙与柱」；temperature「过道空气沉闷潮湿」→ 地板取偏湿的贴图
    'L1:wall':   { tex: 'concrete', repeatMeters: 3, roughness: 0.9, vertexColors: true },
    'L1:floor':  { tex: 'concrete_wet', repeatMeters: 3.5, roughness: 1, vertexColors: true },
    'L1:ceiling': { tex: 'ceiling_tile', repeatMeters: 2, roughness: 1 },
    // 依据：materials「小径叙事中为洁白的混凝土墙」「小径水洼少很多」→ 更浅更干的配色，同一张贴图靠颜色区分
    'L1:corridorWall':  { tex: 'concrete', repeatMeters: 2.5, roughness: 0.85, color: 0xdad7c9 },
    'L1:corridorFloor': { tex: 'concrete', repeatMeters: 2.5, roughness: 0.95, color: 0xcecbbd },
  });
}

// ---------- 出口数据表（选中版本 exits[] 全部列出，超范围/未注册层级 kit 自动 sealed）----------
// 每条都在 note 里标了对应 exits[i]（i 与调研 JSON 的顺序一致，Level 2 主出口单独处理，见下）
const EXIT_DEFS = [
  { to: '22',   kind: 'door', style: 'metal', weight: 0.014, note: '玻璃门，kit 没有玻璃门样式，用金属门近似 (exits[1])' },
  { to: '154',  kind: 'door', style: 'metal', sign: true, weight: 0.012, note: '荧光灯走廊尽头、带独特符号的门 (exits[2])' },
  { to: '159',  kind: 'door', style: 'metal', color: 0xb9d3e0, weight: 0.012, note: '结冰金属门 (exits[3])' },
  { to: '218',  kind: 'door', style: 'metal', weight: 0.012, note: '掩体门 (exits[4])' },
  { to: '389',  kind: 'door', style: 'wood', weight: 0.014, note: '无厘头位置的木门（原文另一种方法是穿过小丑画作，只实现门这一种）(exits[5])' },
  { to: '740',  kind: 'door', style: 'metal', color: 0x9db3c2, weight: 0.008, note: '比周围墙面稍冷、位置捉摸不定的门；仅中文站有这一条 (exits[6])' },
  { to: '998',  kind: 'elevator', weight: 0.01, note: '类似电梯的双开铁门，通向一段楼梯（只做电梯这一段）(exits[7])' },
  { to: '998.2', kind: 'door', style: 'wood', color: 0xf1efe6, weight: 0.01, note: '纯白木门 (exits[8])' },
  { to: 'Level Hub', kind: 'door', style: 'metal', weight: 0.008, note: '按特定顺序进入门与走廊；顺序原文未给出，只摆一扇门 (exits[9])' },
  { to: '19',   kind: 'hole', y: H - 0.05, weight: 0.01, note: '爬上天花板的洞；hole 构件按地面坑设计，摆在接近天花板处近似 (exits[10])' },
  { to: '800',  kind: 'hole', weight: 0.01, note: '爬入开放式通风管道；同样用 hole 近似“钻进去的开口” (exits[14])' },
  { to: '128',  kind: 'noclip', weight: 0.014, note: '墙上呈现外部环境的缺口/切出某些墙 (exits[12])' },
  { to: '352',  kind: 'event', weight: 0.006, note: '用拉丁字母说出 bHZsMzUy 开启阈界；没有语音/文本输入系统，只摆门且永不激活 (exits[13])' },
  { to: '24',   kind: 'zone', weight: 0.005, note: '传言类似切入 Level 57 月球画作，原文未证实，权重给到最低 (exits[15])', decorate: 'painting' },
  { to: '201',  kind: 'zone', weight: 0.008, note: '用 Mach+ 录像带切入电视机；没有“物品作用于场景物体”的交互，只摆电视与触发区 (exits[16])', decorate: 'tv' },
  { to: '305',  kind: 'zone', weight: 0.009, note: '切入一棵枯树 (exits[17])', decorate: 'tree' },
  { to: '710',  kind: 'zone', weight: 0.006, note: '持续触摸朝圣者之路上的地标、逐层切换；多段链路未建模，只放一个地标 (exits[18])' },
  { to: '739',  kind: 'zone', weight: 0.006, note: '跃入山顶枯树岩石岛屿画作；仅中文站有这一条 (exits[19])', decorate: 'painting' },
  { to: '817',  kind: 'zone', weight: 0.009, note: '切入装满废金属的板条箱 (exits[20])', decorate: 'scrap' },
  { to: '1.1',  kind: 'door', style: 'metal', weight: 0.006, note: '子层级“腐败的走廊”，入口在 Alpha 基地南部 (exits[21])' },
  { to: '1.2',  kind: 'door', style: 'metal', weight: 0.006, note: '子层级“砼苑”，通道位于天鹰段；花园段避之如瘟，门摆在别处 (exits[22])' },
  { to: 'Level √2', kind: 'zone', weight: 0.004, note: '子层级 √2，进入方式原文未写明，只放一个通用触发区 (exits[23])' },
  { to: '1.5',  kind: 'noclip', weight: 0.006, note: '子层级“颠倒”，通过切出进入 (exits[24])' },
];

// ---------- 宏格保底出口：通往 Level Fun / Level ! 的两条入口（「补入口」批次，用户 2026-09-19）----------
// 此前全游戏没有任何一层通向 Level Fun / Level !，按这两层各自选中版本的 entrances 补上；上面 exits[0..24] 一条没动。
// 为什么不写进上面那张权重表：硬规则要求「出口必须在出生点 3–5 个区块内找得到」，而权重表是每块各自抽签，
// 实测（种子 12345、±12 共 625 块）weight 0.009 的天花板切出点只有 5 处、最近一处在 8 个区块外 274 m，
// 而 Level Fun 全游戏只有这一条入口，等于没补。改成按宏格周期摆（_TEMPLATE.md 第 4.2 节的宏格哈希，
// 同时满足「无限延伸的层要按周期重复摆放」）：每 MACRO×MACRO 块的宏格里，用 levelSeed 派生流固定选中一块放一处，
// 出生点所在的宏格必有一处 → 最远 MACRO−1 = 4 个区块；平均 1/25 ≈ 4%/块，和本层 '2'（3.5%）、L13 的感叹号门（4.3%）同量级
const MACRO = 5;
const MACRO_EXITS = [
  // 依据：backrooms-research/levels/level-fun.json 的 wikidot-cn「享乐层 =)」entrances[0]
  //      「切入（no-clip）Level 1 的天花板，可能来到这里」——这是该版本三条入口里唯一落在本层、也是唯一现在做得了的一条
  //      （entrances[1] 是 Level 283 休息室前写着 FUN！=) 的对开门，本作没有 Level 283；entrances[3] 是被派对客小组带走，
  //       属于实体主动行为，层级不写攻击/抓捕逻辑）。
  //      触发判定见 js/game/world.js 的 collectInside：平面距离 + 脚底高差。注意 kit 的 builder.exit 总会给出口写一个
  //      数字 y（_kit.js：y = this._T.y + num(d.y, 0)，层级不声明就是 0），所以 typeof ex.y === 'number' 恒为真、
  //      高差判定（|ex.y − 脚底| > 2.5 就不算进圈）每次都跑——触发点必须留在地面高度，天花板上那块补丁只是装饰。
  //      千万别"顺手"给这条出口补一个 y: H，补了玩家就再也触发不了（验收 minor：原来这段注释把引擎行为写反了）
  // 用户 2026-09-19 要求「Fun 得真能进得去」：本条用更密的 3×3 宏格（每 9 块必有一处，走路距离 ≤4 块），
  // 满足硬规则「出口要在出生点 3–5 个区块内找得到」；其余宏格出口仍是 5×5
  { to: 'fun', tag: 'L1-fun-macro', macro: 3, kind: 'zone', radius: 1.2, marker: { color: [1.4, 0.4, 1.25] }, decorate: 'funCeiling',
    note: '天花板上一块错位闪烁、偶尔整块切没的吊顶，走到正下方被切进去 (level-fun.json wikidot-cn entrances[0])' },
  // 依据：backrooms-research/levels/level-run.json 的 wikidot-cn「尘封已久的感叹号…」entrances[1]
  //      「走进一扇画有感叹号符号的门，资料说这是『进入该走廊最常规的方式之一』」——原文写的是任意层级都可能出现，本层照摆；
  //      同版本 entrances[0] 从 Level 109 进（本作没有 Level 109），entrances[2] 是没指明来处的穿模传闻，都不做
  { to: 'run', tag: 'L1-run-macro', kind: 'door', style: 'metal', color: 0x23262a, frameColor: 0x3a3e42, glyph: true,
    note: '一扇和周围混凝土格格不入的深色铁门，门板上有个褪色、刮花的感叹号 (level-run.json wikidot-cn entrances[1])' },
];

// 墙面外挂式门的偏移量：墙厚 0.267（kit.gridWalls 默认 0.2×4/3）的一半 + 门套进深 0.16 的一半，
// 让门整个探出墙面而不是埋进墙体里。EXIT_DEFS 里 exits[0..24] 的门不走这个偏移，位置与行为一字不变
const DOOR_FACE_OFF = 0.21;

// ---------- 区块 ----------
// rng 消耗顺序固定：区段(不吃主流 rng，走派生流) → 类型 → 格子 → 小径房间类型 → 灯 → 区段地标 → 一般水坑/管道 → 出口 → 出生点
// （宏格保底出口 placeMacroExits 同样走 levelSeed 派生流，不吃主流 rng）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const sector = sectorAt(ctx.levelSeed, cx, cz);
  const rolledKind = U.weighted(rng, [['hall', P_HALL], ['corridor', 1 - P_HALL]]);
  const kind = isSpawn ? 'hall' : rolledKind;

  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const g = kit.grid(b, N, N, kind === 'corridor' ? CORRIDOR : HALL);

  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J);
    g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  }

  // 依据：landmarks 里列出的五种「小径房间」——办公室/砖墙小间/医务室/橡胶房间/画作房间
  let roomType = null;
  if (kind === 'corridor' && !isSpawn) {
    roomType = U.weighted(rng, [['office', 0.3], ['brick', 0.22], ['infirmary', 0.16], ['rubber', 0.14], ['painting', 0.18]]);
    g.carve(1, 1, 2, 2, { room: true });
  }

  const wallKey = kind === 'corridor' ? 'L1:corridorWall' : 'L1:wall';
  const floorKey = kind === 'corridor' ? 'L1:corridorFloor' : 'L1:floor';
  // 依据：colors「花园段青翠欲滴的色调」——kit 没有植物构件，用顶点着色把整块墙地染绿近似
  const tint = (kind === 'hall' && sector === 'garden') ? 0x8fae7a : undefined;
  kit.gridWalls(b, g, { matKey: wallKey, color: tint, trim: { color: kind === 'corridor' ? 0x8a887c : 0x4d4a42 } });
  kit.prop.floor(b, null, null, 0, { matKey: floorKey, color: tint });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L1:ceiling', y: H });

  // ---------- 灯光 ----------
  if (kind === 'hall') {
    // 依据：lighting「房间内为惨白的荧光」「跃金段照明更为充足」
    // range 从 kit 默认值 9 收窄到 5.5：默认值下每 2 格(8m)一盏、range 9 的灯彼此重叠覆盖，
    // 过道地板 lightAt 几乎处处 ≥0.95（验收 tests/preview.mjs --entity smiler --level 1 实测），
    // 惧光实体（js/entities/smiler.js 的 A.LIGHT.lit=0.6 阈值）因此在任何走廊里都退缩，永远进不了 chase/attack；
    // 收到 5.5 后灯下仍是 1.0 的惨白亮斑，但两盏灯之间会落回环境光基线 0.4，留出真正暗的过道供惧光实体活动，
    // 视觉上更像"荧光灯管连成光斑"而非一整块死白，同样贴合原文「惨白的荧光」，只是不再是恒定满屏亮度（非设定数值）
    for (let j = 0; j < N; j += 2) {
      for (let i = 0; i < N; i += 2) {
        const r = rng();
        const state = r < 0.05 ? 'broken' : r < 0.15 ? 'flicker' : 'on';
        const c = g.center(i, j);
        kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, flicker: 0.3 + rng() * 0.4, intensity: sector === 'yuejin' ? 1.35 : 1.0, range: 5.5 });
      }
    }
  } else if (roomType) {
    // 依据：lighting「小径灯光昏暗，办公室仅悬一盏灯泡，许多侧室没有灯光」——整块只在主题房间中央留一盏暗灯，其余不放灯描述
    const c = g.center(2, 2);
    kit.prop.lightPanel(b, c.x, c.z, 0, { y: H - 0.35, w: 0.3, d: 0.3, state: 'on', intensity: 0.5, range: 5, color: 0xffe9b8 });
  }

  // ---------- 小径房间装饰 ----------
  if (roomType) decorateCorridorRoom(b, g, rng, roomType);

  // ---------- 过道区段地标 ----------
  if (kind === 'hall') decorateHallSector(b, g, rng, sector);

  // ---------- 出口 ----------
  // 宏格保底出口排在 buildExits 之后：先让原有出口挑走自己的格子/墙段，剩下的再给这两条。
  // 小径（corridor）区块也摆——buildExits 对小径是提前 return 的，宏格要是选中一块小径就整个落空，可达性保证会断
  if (!isSpawn) { buildExits(b, g, rng, kind, cx, cz); placeMacroExits(b, g, ctx, cx, cz); }

  kit.gridSpawns(b, g, { safe: kind === 'corridor' });   // 依据：mechanics「小径中实体极少游荡，可放心使用照明工具」——小径出生点整体标 safe
  return b.finish();
}

// 小径主题房间：办公室 / 砖墙小间 / 医务室 / 橡胶房间 / 画作房间
function decorateCorridorRoom(b, g, rng, roomType) {
  const c = g.center(2, 2);
  if (roomType === 'office') {
    // 依据：landmarks「小型办公室（办公桌+老旧电脑，偶尔是回溯机器；一盏灯泡昏暗照明）」
    kit.prop.desk(b, c.x - 0.6, c.z, 0, { monitor: true, screen: 0x1a2a1a });
    kit.prop.chair(b, c.x - 0.6, c.z + 1.1, Math.PI, {});
  } else if (roomType === 'infirmary') {
    // 依据：landmarks「大型医务室（中间一张病床，周围几张桌子）」
    kit.prop.bed(b, c.x, c.z, 0, {});
    kit.prop.desk(b, c.x - 1.6, c.z - 1.6, Math.PI / 2, {});
    kit.prop.desk(b, c.x + 1.6, c.z - 1.6, -Math.PI / 2, {});
  } else if (roomType === 'rubber') {
    // 依据：landmarks「橡胶房间，中间一把椅子，有时嵌入地板」——嵌入地板需要单独几何，简化为原地放置
    kit.prop.chair(b, c.x, c.z, rng() * Math.PI * 2, { color: 0x3a3a3a });
  } else if (roomType === 'painting') {
    // 依据：landmarks「宽敞房间，墙上和地板上有画作」——kit 没有图案贴图，用纯色平面近似画框
    for (let k = 0; k < 2; k++) {
      const px = c.x + (k === 0 ? -1.3 : 1.3), pz = c.z - 1.7;
      b.plane(px, 0.3, pz, 0.8, 0.9, 'kit:prop', { facing: '+z', color: [0.3 + rng() * 0.5, 0.3 + rng() * 0.5, 0.3 + rng() * 0.5] });
    }
    b.plane(c.x, 0.01, c.z + 1.4, 0.9, 0.7, 'kit:prop', { facing: 'up', color: [0.4, 0.3, 0.25] });
  }
  // 'brick' 依原文「四周砖墙的狭小空间」是个空房间，不额外摆家具

  // 依据：environment.lighting「小径入口门上有亮着的绿色应急灯」——在房间边界一个已有的开口处摆一扇装饰门（门洞已由 carve 打通，门不带碰撞）
  const edges = g.edges({ wall: false, interior: true }).filter(e =>
    (e.axis === 'h' && e.i >= 1 && e.i < 3 && (e.j === 1 || e.j === 3)) ||
    (e.axis === 'v' && e.j >= 1 && e.j < 3 && (e.i === 1 || e.i === 3)));
  if (edges.length) {
    const ed = edges[Math.floor(rng() * edges.length)];
    kit.prop.door(b, ed.x, ed.z, ed.rot, { style: roomType === 'rubber' ? 'metal' : 'wood', sign: 0x35ff7a, solid: false });
  }
}

// 过道六区段地标（宏格已定好 sector，这里只按 sector 加内部装饰）
function decorateHallSector(b, g, rng, sector) {
  if (sector === 'tianying') {
    // 依据：landmarks「天鹰段：灰墙灰地+巨型混凝土柱…天花板漏水小管子」
    for (const p of g.pillars) if (rng() < 0.5) { const c = g.center(p.i, p.j); kit.prop.pillar(b, c.x, c.z, 0, { w: 0.9, matKey: 'L1:wall' }); }
    if (rng() < 0.4) {
      const cell = pickFreeCell(g, rng);
      if (cell) { kit.prop.pipe(b, cell.x, cell.z, 0, { axis: 'x', y: H - 0.3, length: 2, color: 0x6b6b62 }); kit.prop.puddle(b, cell.x, cell.z, 0, { rx: 0.6, rz: 0.4 }); markPuddle(b, cell.x, cell.z); }
    }
  } else if (sector === 'yuejin') {
    // 依据：landmarks「跃金段：…板条箱数量远超其他已探索地点；商人之家所在」
    for (let k = 0; k < 3; k++) {
      const r = rng();
      if (r < 0.5) { const cell = pickFreeCell(g, rng); if (cell) kit.prop.crate(b, cell.x, cell.z, rng() * Math.PI, { color: 0x8a6a45 + (rng() * 0x101010 | 0) }); }
    }
  } else if (sector === 'gothic') {
    // 依据：landmarks「哥特段：弯曲建筑，拱门与圆柱」——kit 没有拱形构件，用两根柱+一根横梁自拼
    const cell = pickFreeCell(g, rng);
    if (cell && rng() < 0.6) {
      const w = 2.2, hh = H - 0.5;
      b.cylinder(cell.x - w / 2, 0, cell.z, 0.22, hh, 'L1:wall', { segments: 8 });
      b.cylinder(cell.x + w / 2, 0, cell.z, 0.22, hh, 'L1:wall', { segments: 8 });
      b.box(cell.x, hh, cell.z, w + 0.4, 0.35, 0.5, 'L1:wall', {});
    }
  } else if (sector === 'ouroboros') {
    // 依据：landmarks「衔尾段：最小区段，永无止境的施工状态」；hazards「施工者心无旁骛，已导致多起意外」——遍地施工杂物，无据点
    for (let k = 0; k < 2; k++) {
      const cell = pickFreeCell(g, rng);
      if (cell && rng() < 0.5) kit.prop.crate(b, cell.x, cell.z, 0, { color: 0x5c5648 });
    }
    const p = pickFreeCell(g, rng);
    if (p && rng() < 0.3) kit.prop.pipe(b, p.x, p.z, 0, { axis: 'y', length: 1.4, color: 0x716a55 });
  } else if (sector === 'legend') {
    // 依据：landmarks「传说段：…重新发现后被霓虹与彩色电缆覆盖」
    if (rng() < 0.5) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        b.plane(cell.x, H - 0.15, cell.z, 1.4, 0.12, 'kit:glow', { facing: 'up', uv: 'solid', color: [1.6, 0.4, 1.9], glow: 1.4 });
        b.cylinder(cell.x, H - 0.4, cell.z, 0.03, 1.2, 'kit:prop', { axis: 'x', color: [1.8, 1.2, 0.2] });
      }
    }
  }

  // 依据：landmarks「团体地标：饰有团队标志的彩色布料+食物或杏仁水+纸条（门边、墙上、霓虹灯下）」——衔尾段无据点可求助，不放
  if (sector !== 'ouroboros' && rng() < 0.1) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      b.plane(cell.x, 1.1, cell.z - 0.3, 0.6, 0.5, 'kit:prop', { facing: '+z', color: [rng(), rng() * 0.4, rng() * 0.4] });
      b.spawn(cell.x, cell.z, 'room', { safe: true });
    }
  }
  // 依据：environment.weather「过道地面散布液体水坑」；materials「天花板有管道」——一般性水坑/管道，不分区段
  if (rng() < 0.25) { const cell = pickFreeCell(g, rng); if (cell) { kit.prop.puddle(b, cell.x, cell.z, 0, {}); markPuddle(b, cell.x, cell.z); } }
  if (rng() < 0.3) { const cell = pickFreeCell(g, rng); if (cell) kit.prop.pipe(b, cell.x, cell.z, 0, { axis: 'z', y: H - 0.2, length: 2.5 }); }
}

// 记下水坑的世界坐标，供 level.update 做「靠近未密封水坑」接触判定（hazards：爬菌经未密封液体传播）
function markPuddle(b, x, z) {
  const w = b.world(x, z);
  (b.data.puddles || (b.data.puddles = [])).push({ x: w.x, z: w.z });
}

function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}

// 出口摆放：Level 2 主出口按“走够远”近似平滑阈界，其余按 EXIT_DEFS 权重表摆放
function buildExits(b, g, rng, kind, cx, cz) {
  if (kind === 'corridor') {
    // 依据：exits「Level 38：在故障逐渐加剧的小径上行走」——这一条专属小径
    if (rng() < 0.05) {
      const cell = pickFreeCell(g, rng);
      if (cell) { kit.exit(b, { to: '38', kind: 'zone', x: cell.x, z: cell.z, radius: 1, marker: true, label: '故障感逐渐加剧的小径 (exits[11])' }); g.reserve(cell.i, cell.j); }
    }
    return;
  }
  // 依据：exits「Level 2：沿管道与仪表盘逐渐显现的方向走足够远」——离出生点足够远（宏观距离近似“足够远”）
  const macroDist = Math.abs(cx) + Math.abs(cz);
  const r2 = rng();
  if (macroDist >= 6 && r2 < 0.06) {
    const cell = pickFreeCell(g, rng);
    if (cell) { kit.exit(b, { to: '2', kind: 'zone', x: cell.x, z: cell.z, radius: 1.4, marker: true, label: '沿管道与仪表盘方向走了很久 (exits[0])' }); g.reserve(cell.i, cell.j); }
  }
  for (const def of EXIT_DEFS) {
    const roll = rng();
    if (roll >= def.weight) continue;
    if (def.kind === 'door' || def.kind === 'elevator' || def.kind === 'noclip') {
      const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (!ed) continue;
      if (def.kind === 'noclip') {
        g.setWall(ed.axis, ed.i, ed.j, false);
        kit.exit(b, { to: def.to, kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: 'L1:wall', label: def.note });
      } else {
        // door/elevator 的颜色、出口灯箱要嵌到 o.door 子对象里，kit.exit 只把 o.door 转给 prop.door（见 _kit.js exit()）
        kit.exit(b, { to: def.to, kind: def.kind, x: ed.x, z: ed.z, rot: ed.rot, style: def.style, label: def.note, door: { color: def.color, sign: def.sign } });
      }
      g.reserve(ed.i, ed.j);
    } else {
      const cell = pickFreeCell(g, rng);
      if (!cell) continue;
      kit.exit(b, { to: def.to, kind: def.kind, x: cell.x, z: cell.z, y: def.y, radius: def.radius || 1, marker: def.kind === 'zone' ? true : undefined, active: def.kind === 'event' ? false : undefined, label: def.note });
      decorateExit(b, cell.x, cell.z, def.decorate);
      g.reserve(cell.i, cell.j);
    }
  }
}

// 宏格选块：本块是不是 tag 这条出口在自己那个宏格（MACRO×MACRO 块）里选中的那一块。
// 是的话返回一个 levelSeed 派生的 rng（给挑格子 / 挑墙段用），不是返回 null。
// 全程不吃本块主 rng：没被选中的区块和"没有这两条入口"时逐字节一致，被选中的区块也只是多出一个出口
function macroPick(levelSeed, tag, cx, cz, span) {
  const M = span || MACRO;
  const mx = Math.floor(cx / M), mz = Math.floor(cz / M);
  const r = U.rng(levelSeed, tag, mx, mz);
  let px = mx * M + Math.floor(r() * M), pz = mz * M + Math.floor(r() * M);
  // 正好选中出生区块时往宏格里挪：出生块不摆出口（buildChunk 跳过 buildExits），不挪的话这个宏格会整个落空
  if (px === 0 && pz === 0) { px = mx * M + (M > 2 ? 2 : 1); pz = mz * M + (M > 2 ? 2 : 1); }
  return px === cx && pz === cz ? r : null;
}

// 摆宏格保底出口。两条都不拆墙（门是外挂在墙面上的，天花板切出点的触发圈在地面），
// 所以排在 kit.gridWalls 之后也不会留下多余的墙（硬规则：拆墙必须在 gridWalls 之前）
function placeMacroExits(b, g, ctx, cx, cz) {
  for (const def of MACRO_EXITS) {
    const r = macroPick(ctx.levelSeed, def.tag, cx, cz, def.macro);
    if (!r) continue;
    if (def.kind === 'door') {
      const ed = g.pickEdge(r, { wall: true, interior: true, unlocked: true });
      if (!ed) continue;
      // 摆在墙线正中的门会被 0.267 m 厚的墙体整个盖住，玩家走到跟前只看到一堵平墙
      //（EXIT_DEFS 里原有的 11 扇门就是这样，属历史问题，不在本轮范围内、没动它们）：
      // 整扇门沿墙面法线往外挪 DOOR_FACE_OFF，探出墙面才看得见
      const dx = ed.x + Math.sin(ed.rot) * DOOR_FACE_OFF, dz = ed.z + Math.cos(ed.rot) * DOOR_FACE_OFF;
      kit.exit(b, { to: def.to, kind: 'door', x: dx, z: dz, rot: ed.rot, style: def.style, label: def.note,
        door: { color: def.color, frameColor: def.frameColor } });
      exclamationGlyph(b, dx, dz, ed.rot);   // 外挂在墙面上，背面贴着墙，只画朝外那一面
      g.reserve(ed.i, ed.j);
    } else {
      const cell = pickFreeCell(g, r);
      if (!cell) continue;
      kit.exit(b, { to: def.to, kind: 'zone', x: cell.x, z: cell.z, radius: def.radius, marker: def.marker, label: def.note });
      decorateExit(b, cell.x, cell.z, def.decorate);
      g.reserve(cell.i, cell.j);
    }
  }
}

// 少数出口需要专属道具（电视/枯树/画/废料箱），kit 构件库没有对应件，自己用基础几何拼
function decorateExit(b, x, z, kind) {
  if (kind === 'tv') {
    b.box(x, 0.4, z, 0.55, 0.5, 0.45, 'kit:prop', { color: 0x2a2a28 });
    b.plane(x, 0.5, z - 0.23, 0.4, 0.32, 'kit:glow', { facing: '-z', uv: 'solid', color: [0.5, 0.7, 1.2] });
  } else if (kind === 'tree') {
    b.cylinder(x, 0, z, 0.14, 1.8, 'kit:prop', { color: 0x4a4032 });
    b.cylinder(x + 0.3, 1.5, z, 0.06, 0.9, 'kit:prop', { axis: 'x', color: 0x4a4032 });
  } else if (kind === 'painting') {
    b.plane(x, 0.9, z - 0.1, 0.9, 1.0, 'kit:prop', { facing: '+z', color: [0.5, 0.35, 0.25] });
  } else if (kind === 'scrap') {
    kit.prop.crate(b, x, z, 0, { color: 0x716b60 });
  } else if (kind === 'funCeiling') {
    funCeilingPatch(b, x, z);
  }
}

// Level Fun 入口的天花板补丁（依据：level-fun.json wikidot-cn entrances[0]「切入 Level 1 的天花板」）。
// 不用 kind:'noclip'——那是竖着的墙面补丁；这里照 _kit.js noclipPatch 的时间哈希闪法自己画一块横的：
// 上面一层是"吊顶背后的另一边"（kit:glow 不吃光，切没的瞬间是一块彩色亮斑），下面一层是盖住它的吊顶补丁。
// 两块都合进已有的 kit:glow / kit:prop，不新建 mesh、不建独立 object（第 16 节预算）
function funCeilingPatch(b, x, z) {
  const W = 1.8;
  const SEAM = [0.03, 0.025, 0.035];         // 关着的时候只剩四周一道暗缝，像有人从吊顶上裁下来一块
  const PARTY = [[1.9, 0.35, 1.5], [0.4, 1.5, 1.7], [1.9, 1.25, 0.3]];   // 切没的瞬间透进来的彩灯
  // 上层：吊顶背后的另一边。比补丁大一圈，露出来的边就是那道暗缝
  const back = b.plane(x, H - 0.005, z, W + 0.07, W + 0.07, 'kit:glow', { facing: 'down', uv: 'solid', color: SEAM });
  // 下层：盖住它的吊顶补丁。材质、平铺都和本层吊顶一样（世界 UV 自动对齐），不闪的时候看着就是普通吊顶
  const cover = b.plane(x, H - 0.03, z, W, W, 'L1:ceiling', { facing: 'down' });
  // 闪法按坐标+时间哈希（纯函数，重载区块闪法不变，也不吃 rng；参考 _kit.js noclipPatch）
  const seed = U.hashInts(b.seed, 'L1-fun-patch', b.cx, b.cz, Math.round(x * 10), Math.round(z * 10));
  let lastSlot = -1;
  b.update((dt, t) => {
    const slot = Math.floor(t * 9);          // 每秒 9 档，只在换档时改颜色/显隐，不逐帧分配
    if (slot === lastSlot) return;
    lastSlot = slot;
    const e = U.hashInts(seed, slot) / 4294967296;
    const open = e < 0.26;                   // 约四分之一的时间整块切没：抬头几秒总能撞见一次
    if (cover.visible === open) cover.setVisible(!open);
    back.setColor(open ? PARTY[U.hashInts(seed, slot, 1) % PARTY.length] : SEAM);
  });
}

// 感叹号门的门板标记（依据：level-run.json wikidot-cn entrances[1]「画有感叹号符号的门」，
// 另一条资料写这个印记是「褪色、有刮痕」的）。引擎没有文字渲染/贴花能力（见 apiRequests），
// 用两块褪色的小面片拼出 "!" 的形状；坐标系与 kit.exit 建门时一致（门板中心在本地 x=0，板厚 0.045）
function exclamationGlyph(b, x, z, rot) {
  const OFF = 0.045 / 2 + 0.008;
  const FADED = [0.55, 0.53, 0.47];          // 褪色的骨白，不发光
  b.push(x, z, rot);
  b.box(0, 1.00, OFF, 0.085, 0.54, 0.006, 'kit:prop', { color: FADED });   // 竖杠
  b.box(0, 0.82, OFF, 0.085, 0.085, 0.006, 'kit:prop', { color: FADED });  // 点
  b.pop();
}

// ---------- 层级状态与危害（enter/update/leave）----------
const S = { timer: 0, epoch: -1, blackout: false, blackoutUntil: 0, scareAt: 0, gardenTimer: 0, warned: false };
const EPOCH_LEN = 45;          // 依据：lighting「何时开始与结束皆不可预测」——原文没给数值，取一个不算频繁的巡检间隔
const BLACKOUT_CHANCE = 0.3;   // 判断依据：hazards「闪烁…可能是最致命现象之一」，但也不是每次巡检都发生
const GARDEN_HOUR = (BR.itemKit && BR.itemKit.LORE_HOUR) || 60;   // 依据：landmarks「花园段停留一小时开始植物化」，1 设定小时=60 秒（沿用 itemKit.LORE_HOUR）

// 依据：lighting「头顶的人造光源冲泻而下…房间内为惨白的荧光」——不发黑的中灰底色，人造光偏暖白；闪烁期间/结束靠这份原始 env 切换/还原
const LEVEL_ENV = {
  background: 0x353128, fogColor: 0x353128, fogNear: 8, fogFar: 52,
  ambient: { color: 0xf2ead2, intensity: 0.4 },
  sanityDrainMul: 0.9,   // 依据：survivalClass「安全稳定」+ 昵称「宜居地带」，比默认基线略缓
  hungerDrainMul: 1,
  audio: 'pipes',        // 依据：sounds「天花板管道间不时传来零星的金属撞击声、间歇隆隆声」
  darkness: false,
};

function onBlackoutStart(ctx) {
  BR.hud.toast('灯光闪了一下……万籁俱寂', 2000);
  if (!S.warned) { BR.hud.toast('闪烁：别开灯，找亮着绿色应急灯的门躲进小径', 3500); S.warned = true; }
  BR.audio.play('static');
  BR.gfx.applyEnv(Object.assign({}, LEVEL_ENV, { ambient: { color: 0x000000, intensity: 0.02 }, background: 0x000000, fogColor: 0x000000, fogNear: 1, fogFar: 8 }), BR.game.settings.visibility);
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
    return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 };
  },
  buildChunk,
  entities: [
    // 依据：entities[] 里除「手臂」「爬菌」外的 9 种都列在 entity-index.json 的 level '1'，且都在本批实现范围内。
    // entityDensityOverall「moderate（判断）」：11 种常见清单没给数字，把 moderate(0.35) 拆到各类型上，
    // 单一形态的敌对类型每种取 rare(0.04)，钝人图注特别标注「常见」上浮一档取 low(0.12)；
    // 拆成雌雄/变体两个 type 注册的物种（牧蛇、悲尸），把同一物种的 rare(0.04) 预算按形态比重拆开，不重复计（否则密度翻倍）。
    // 6 项单一形态 ×0.04 + duller 0.12 + wrangler 0.04 + wretch 0.04 + shadow_worker 系 ≈0.007 ≈ 0.447，量级贴近整体 moderate 判断。
    { type: 'hound', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'smiler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'skin_stealer', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'clump', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'duller', officialPer1000m2: BR.config.densityWords.low },   // 图注称「Level 1 中常见的人形实体之一」
    { type: 'growler', officialPer1000m2: BR.config.densityWords.rare },
    { type: 'nguithrxurh', officialPer1000m2: BR.config.densityWords.rare },
    // 牧蛇雌雄二态分开注册（js/entities/wrangler.js）：雄性「敌对」为主要威胁形态，雌性「中立退避」，
    // 把 rare(0.04) 按主次拆成 0.025 / 0.015，不是雌雄各给一份 rare
    { type: 'wrangler_male', officialPer1000m2: 0.025 },
    { type: 'wrangler_female', officialPer1000m2: 0.015 },
    // 悲尸标准型/畸形肉块变体分开注册（js/entities/wretch.js），版本原文没分别给两种形态的比例，rare(0.04) 平分
    { type: 'wretch', officialPer1000m2: 0.02 },
    { type: 'wretch_lump', officialPer1000m2: 0.02 },
    // 中立，仅衔尾段出没：引擎没有按宏区限定实体类型的接口（见 apiRequests），把 rare 除以 6 个区段数近似“仅一处出现”的稀缺度，
    // 再按「一般工人为主、Penelope/Grunt 是具名个体」拆成 0.005 / 0.001 / 0.001（shadow_worker.js 注册了三个 type）
    { type: 'shadow_worker', officialPer1000m2: 0.005 },
    { type: 'shadow_worker_penelope', officialPer1000m2: 0.001 },
    { type: 'shadow_worker_grunt', officialPer1000m2: 0.001 },
  ],
  items: [
    // 全部来自 data/item-spawn.json 里 levels 含 '1' 且 js/items/<key>.js 已存在的条目，per1000m2 直接取该文件的值
    { type: 'almond_water', per1000m2: 1.2 },     // 用户规则：所有模式都刷
    { type: 'canned_food', per1000m2: 0.5 },      // 依据：items「板条箱里有，小径带家具房间偶有（多数变质）」——同时满足“所有模式都刷食物”
    { type: 'antiseptics', per1000m2: 0.3 },      // 依据：items「板条箱物资清单里有消毒剂、肥皂、洗手液」
    { type: 'royal_rations', per1000m2: 0.01 },   // item-spawn.json：极稀有，不限层级
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'warpberries', per1000m2: 0.1 },      // 依据：items「迁跃浆果」，item-spawn.json 标注同站 Level 1 页说板条箱里有
    { type: 'moth_jelly', per1000m2: 0.003 },
  ],
  exits: [
    { to: '2', kind: 'zone', note: '沿管道与仪表盘逐渐显现的方向走足够远；平滑阈界，用离出生点的宏观距离近似“走得够远” (exits[0])' },
    ...EXIT_DEFS.map((d, i) => ({ to: d.to, kind: d.kind, note: d.note })),
    ...MACRO_EXITS.map(d => ({ to: d.to, kind: d.kind, note: d.note })),
  ],
  enter(ctx) {
    S.timer = 0; S.epoch = -1; S.blackout = false; S.blackoutUntil = 0; S.scareAt = 0; S.gardenTimer = 0; S.puddleTimer = 0;
    S.rng = U.rng(ctx.levelSeed, 'L1-flavor');   // 断电区音效/伤害、水坑感染判定用；不用 Math.random（_TEMPLATE.md 第14节：事件条件要确定性输入）
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
        S.scareAt = S.timer + 4 + S.rng() * 3;   // 音效间隔 + 是否命中都走同一条派生流，同存档同时间线必然复现同一序列
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
    // 依据：hazards「水坑与漏水不宜饮用；未密封液体可能传播爬菌」；entities「爬菌：致病真菌，短时间内占据感染者意识」——按接触算轻微 san 损耗，不给即死
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
