// Level 2: "Pipe Dreams"
// 来源版本：fandom  URL：https://web.archive.org/web/20251117020519/https://backrooms.fandom.com/wiki/Level_2
//           （原始页面：https://backrooms.fandom.com/wiki/Level_2，wgRevisionId 1080670）  许可：CC BY-SA 3.0
// 只按 fandom 这一个版本实现；wikidot-en / wikidot-cn 的门系统、荧光灯串联电路、B.N.T.G./大停电历史、
// 死亡飞蛾/杰瑞/无面灵/悲尸/Nguithr'xurhs/尸鼠/人制品售货机/牧蛇/Photoshop/啼物/欺诈鸟 等细节一律不借
// （见 data/lore-choices.json 的 levels['2'].conflicts）。
// 经典 <script> + IIFE，只挂 window.BR；依赖 js/levels/_kit.js。
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// environment.scale 原文只说 'vast'、可能无限，没给走廊/房间的具体米数 → 沿用常规迷宫区块参数（非设定值）
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.6;   // 版本未给层高数值；维护隧道题材，比办公层略矮，非设定，仅为氛围与可玩性取值

// ---------- 布局：格子迷宫，边界参数全层统一（第 7.2 节） ----------
const EDGE = { salt: 'L2', boundaryDensity: 0.36, straightness: 0.72, minOpenings: 2 };
// 依据 architecture「由相互连通的公用隧道、维护竖井和生锈管道构成的巨大网络」+ layout「迷宫式网络」
const TUNNEL = Object.assign({ wallDensity: 0.42, roomChance: 0.12, maxRooms: 1, roomSize: [2, 3], loopChance: 0.4, pillarChance: 0.02 }, EDGE);
// 依据 landmarks「爬行空间(crawlspaces)」本身就是狭窄维护空间 → 更高墙密度、更少房间制造逼仄感（具体尺寸原文未给数值，非设定）
const CRAWL = Object.assign({ wallDensity: 0.58, roomChance: 0.04, loopChance: 0.25, pillarChance: 0.12 }, EDGE);
// 用于 hot/cold/attic/shelter/sewer/pipeline：整块打通成一间大房间（边界参数仍与 TUNNEL 一致，第 7.2 节要求）
const OPEN = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0.06 }, EDGE);

const SPAWN_I = 3, SPAWN_J = 3;

// 区块类型权重：先无条件抽一次（第 4.2 节），出生块固定 'tunnel'
// hot/cold/attic/shelter/sewer/pipeline 都会整块打通成房间，其余是迷宫变体
const OPEN_KINDS = new Set(['hot', 'cold', 'attic', 'shelter', 'sewer', 'pipeline']);
const KIND_WEIGHTS = [
  ['tunnel', 0.43],     // 默认维护隧道
  ['crawl', 0.16],      // 依据 landmarks「爬行空间：出口所在」
  ['wood', 0.08],       // 依据 landmarks「较老的木结构区域」
  ['neon', 0.05],       // 依据 landmarks「霓虹灯逐渐增多的区域（接近 Level 699 出口）」
  ['hot', 0.09],        // 依据 environment.temperature「蒸汽管密集区可达 60–100 °C」
  ['cold', 0.07],       // 依据 environment.temperature「通风口多的区域较冷」
  ['attic', 0.03],      // 依据 landmarks「被认为是木制阁楼的空房间，内有一扇似乎能看到 the Whole 的窗」
  ['shelter', 0.03],    // 依据 landmarks/bases「小团体用炸药开凿的临时掩体式居住/储物空间」
  ['sewer', 0.03],      // 依据 landmarks「下水道隧道（通往 Level 34）」
  ['pipeline', 0.03],   // 依据 landmarks「Biological Pipeline 的入口：位于爬行空间的某些交汇处」
];

// ---------- 材质 ----------
// 颜色未在选中版本里核实（colors 字段写「原文没有给出明确配色」），这里按 materials 描述本身
// （混凝土、生锈管道、蒸汽管/通风管、老木结构）取常见色，非设定数值。贴图全部复用现有素材，不新开纹理。
function defineMaterials() {
  kit.mat('L2:wall', { tex: 'concrete', repeatMeters: 3, roughness: 0.92, color: 0x9aa39c });
  kit.mat('L2:wall_wood', { color: 0x4b3621, roughness: 0.9 });                 // 老木结构区域，纯色仿旧木，无需新贴图
  kit.mat('L2:pipe_wall', { tex: 'metal', repeatMeters: 2, roughness: 0.55, metalness: 0.4, color: 0x585a4e }); // Biological Pipeline 内壁
  kit.mat('L2:floor', { tex: 'concrete_wet', repeatMeters: 2.6, roughness: 0.85, color: 0x767f78 }); // 依据 weather「地面结冰」+ hazards「管道液体污染」，用湿混凝土体现潮湿/积水
  kit.mat('L2:ceil', { tex: 'concrete', repeatMeters: 3, roughness: 0.95, color: 0x5b625c });
}

// 版本没写具体灯具（lighting 字段是 unverified），只用环境光会太暗看不清路；这里用零星的裸露接线盒/指示灯
// 代表"带电电线仍在通电"（依据 materials「带电电线」），保证基本可玩能见度，数值非设定
function bulbLight(b, x, z, opts) {
  const o = Object.assign({ y: H - 0.4, color: 0xffcf9e, intensity: 0.5, range: 6.5 }, opts);
  const wp = b.world(x, z);
  b.box(x, o.y, z, 0.12, 0.1, 0.12, 'kit:glow', { uv: 'solid', color: o.color, glow: 1.5 });
  b.light({ x: wp.x, y: o.y, z: wp.z, color: o.color, intensity: o.intensity, range: o.range });
}

// ---------- 幻觉提示文案（Clockwork Theory，见 mechanics） ----------
// 逐条对应 mechanics 里列出的具体幻象内容，用自己的话转述，不新编不存在的幻象
const HALLUC_MSGS = [
  '墙上出现一扇你确定不存在的门，锁得死死的',
  '死胡同尽头有一扇空白的窗户，望进去只有一堵混凝土墙',
  '拐角处摆着一张小茶几，烟灰缸里还插着没抽完的雪茄',
  '墙上挂着一幅画，画的是外面明媚的风景',
  '旁边的房间不知何时变成了一间装修齐全的卧室',
  '一段楼梯从墙里探出来，通向更高处的走廊',
];

// ---------- 区块 ----------
// rng 消耗顺序：区块类型 → 格子 → 各类型专属装饰/出口 → 灯饰点缀 → 刷新点
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const rolled = U.weighted(rng, KIND_WEIGHTS);
  const kind = isSpawn ? 'tunnel' : rolled;

  const isOpen = OPEN_KINDS.has(kind);
  const gridParams = kind === 'crawl' ? CRAWL : (isOpen ? OPEN : TUNNEL);
  const g = kit.grid(b, N, N, gridParams);
  if (isSpawn) { g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true }); g.reserve(SPAWN_I, SPAWN_J); }
  if (isOpen && !isSpawn) g.carve(0, 0, N, N, { room: true });

  const wallKey = (kind === 'wood') ? 'L2:wall_wood' : (kind === 'pipeline' ? 'L2:pipe_wall' : 'L2:wall');

  const windows = [];   // Windows 危害：{x,z,phase,hit}（世界坐标）
  const wires = [];     // 爬行空间带电电线：{x,z,phase,hit}

  // ---- 窗户危害（entity-index 把它归为 hazards，不是可刷新实体）----
  // 只在有正常墙面的区块类型里出现；依据 entities[Windows].behavior「本层变种：玻璃后面像层级里被掏空的一块，
  // 影子人形更立体，扭曲手臂能伸得更远」，密度原文未给数值，取低概率
  if (!isSpawn && (kind === 'tunnel' || kind === 'wood' || kind === 'neon' || kind === 'crawl')) {
    const rWin = rng();
    if (rWin < 0.07) {
      const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (ed) {
        kit.prop.window(b, ed.x, ed.z, ed.rot, { w: 1.0, h: 1.3, y: 0.8, mullions: false, tint: 0x14181a, wall: { matKey: wallKey, w: ed.len, h: H } });
        // 窗后的影子人形：比普通空洞更立体的一块深色实体（依据「更有实体感」）
        b.push(ed.x, ed.z, ed.rot);
        b.box(0, 0.1, 0.3, 0.5, 1.5, 0.14, 'kit:prop', { color: 0x05070a, solid: false });
        b.pop();
        const wp = b.world(ed.x, ed.z);
        windows.push({ x: wp.x, z: wp.z, phase: rng() * Math.PI * 2, hit: false });
        g.reserve(ed.i, ed.j);
      }
    }
  }

  // ---- 爬行空间：出口所在地 + 带电废弃电线 ----
  if (kind === 'crawl') {
    // 依据 hazards「爬行空间中仍带电的电线，常导致重伤」、landmarks「有时被大量仍带电的废弃电线堵塞」
    const rWire = rng();
    if (rWire < 0.35) {
      const open = g.cells().filter(c => !c.reserved && !c.room);
      if (open.length) {
        const c = open[Math.floor(rng() * open.length)];
        b.push(c.x, c.z, rng() * Math.PI * 2);
        for (let k = 0; k < 4; k++) b.cylinder(0, 0.05 + k * 0.06, 0, 0.02, 0.5 + rng() * 0.35, 'kit:prop', { axis: 'x', color: 0x171512 });
        b.box(0, 0.04, 0, 0.4, 0.1, 0.4, 'kit:glow', { uv: 'solid', color: 0xff8a2a, glow: 1.3 });
        b.pop();
        const wp = b.world(c.x, c.z);
        wires.push({ x: wp.x, z: wp.z, phase: rng() * 10, hit: false });
        g.reserve(c.i, c.j);
      }
    }
    // 依据 landmarks「爬行空间：出口所在」，出口列表里的消防出口(1/3/477)与金色 Φ 门都放在这里
    const rExit = rng();
    if (rExit < 0.4) {
      const pick = U.weighted(rng, [['fire1', 0.28], ['fire3', 0.28], ['fire477', 0.24], ['gold', 0.2]]);
      const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (ed) {
        if (pick === 'gold') {
          // 依据 exits「标有「Φ」的金色门 → Level Phi」；Level Phi 不在首期范围，kit 自动 sealed
          kit.exit(b, { to: 'Phi', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '标有「Φ」的金色门',
            door: { color: 0xd4af37, frameColor: 0x8a6b1e, wall: { matKey: wallKey, w: ed.len, h: H } } });
        } else {
          const to = pick === 'fire1' ? '1' : pick === 'fire3' ? '3' : '477';
          // 依据 exits「消防出口 → Level 1 / 3 / 477」；477 超出首期范围，kit 自动 sealed
          kit.exit(b, { to, kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'fire', label: '消防出口',
            door: { wall: { matKey: wallKey, w: ed.len, h: H } } });
        }
        g.reserve(ed.i, ed.j);
      }
    }
  }

  // ---- 走廊本身有概率变成通往 Level 4 / 27 的错位墙 ----
  // 依据 exits「Level 2 的某些走廊有概率通往 Level 4 / Level 27」
  if (!isSpawn && (kind === 'tunnel' || kind === 'wood' || kind === 'neon')) {
    const rHall = rng();
    if (rHall < 0.1) {
      const target = rng() < 0.5 ? '4' : '27';   // 27 超出首期范围，kit 自动 sealed
      const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
      if (ed) {
        g.setWall(ed.axis, ed.i, ed.j, false);
        kit.exit(b, { to: target, kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: wallKey });
        g.reserve(ed.i, ed.j);
      }
    }
  }

  // ---- 管道/通风口装饰（tunnel、wood 通用；依据 materials「大量水管、蒸汽管和通风管道」）----
  if (kind === 'tunnel' || kind === 'wood' || kind === 'neon' || kind === 'crawl') {
    const rPipe = rng();
    if (rPipe < 0.5) {
      const ed = g.pickEdge(rng, { wall: true, interior: true });
      if (ed) kit.prop.pipe(b, ed.x, ed.z, ed.rot, { length: Math.min(ed.len - 0.4, 3), r: 0.07, axis: 'x', y: 2.1, color: 0x6b4a2e });
    }
  }

  // ---- 老木结构区域：木梁横跨走廊（纯装饰，不新开材质）----
  if (kind === 'wood') {
    const cells = g.cells().filter(c => !c.reserved);
    for (let k = 0; k < 2 && k < cells.length; k++) {
      const c = cells[(rng() * cells.length) | 0];
      b.box(c.x, H - 0.18, c.z, CELL * 0.9, 0.16, 0.16, 'kit:prop', { color: 0x3a2a1a });
    }
  }

  // ---- 霓虹灯逐渐增多的区域，末端可能就是 Level 699 出口 ----
  if (kind === 'neon') {
    const edges = g.edges({ wall: true, interior: true });
    const colors = [0xff2fd8, 0x2fe8ff, 0xffe62f];
    for (let k = 0; k < 3 && edges.length; k++) {
      const ed = edges[(rng() * edges.length) | 0];
      b.push(ed.x, ed.z, ed.rot);
      b.box(0, 1.4, 0.06, 0.9, 0.08, 0.04, 'kit:glow', { uv: 'solid', color: colors[k % colors.length], glow: 2 });
      b.pop();
    }
    const rNeon = rng();
    if (rNeon < 0.25) {
      const open = g.cells().filter(c => !c.reserved);
      if (open.length) {
        const c = open[(rng() * open.length) | 0];
        // 依据 exits「霓虹灯逐渐增多说明出口就在附近 → Level 699」；699 超出首期范围，kit 自动 sealed
        kit.exit(b, { to: '699', kind: 'zone', x: c.x, z: c.z, radius: 1.2, marker: { color: 0xff2fd8, pulse: true }, label: '越来越密集的霓虹灯' });
        g.reserve(c.i, c.j);
      }
    }
  }

  // ---- 高温区：蒸汽管密集，60–100 °C（依据 temperature）----
  if (kind === 'hot') {
    for (let k = 0; k < 5; k++) {
      const x = 3 + rng() * (SIZE - 6), z = 3 + rng() * (SIZE - 6);
      kit.prop.pipe(b, x, z, 0, { length: H - 0.3, r: 0.09, axis: 'y', y: 0, color: 0x8a4a2c });
      if (rng() < 0.5) b.box(x, 0.4, z, 0.18, 0.04, 0.18, 'kit:glow', { uv: 'solid', color: 0xff5a2a, glow: 1.1 }); // 热气发红的接口
    }
    kit.prop.puddle(b, SIZE * 0.5, SIZE * 0.5, 0, { rx: 1.2, rz: 0.9, color: 0x3a2f28 }); // 冷凝水渍
  }

  // ---- 低温区：通风口密集，较冷（依据 temperature；原文没给具体危害数值，只做外观）----
  if (kind === 'cold') {
    for (let k = 0; k < 4; k++) {
      const ed2 = g.pickEdge(rng, { wall: true });
      if (ed2) kit.prop.vent(b, ed2.x, ed2.z, ed2.rot, { color: 0x8b98a0 });
    }
    kit.prop.puddle(b, SIZE * 0.5, SIZE * 0.5, 0, { rx: 1, rz: 0.7, color: 0xcfe3ea }); // 结霜/薄冰（依据 weather「地面结冰」）
  }

  // ---- 木制阁楼空房间 + 那扇能望见 the Whole 的窗（landmarks 唯一提到的具体房间）----
  if (kind === 'attic') {
    kit.mat('L2:attic_wall', { color: 0x4b3621, roughness: 0.9 });
    const win = kit.prop.window(b, SIZE / 2, SIZE - 0.3, Math.PI, { w: 1.3, h: 1.4, y: 0.9, glow: 0xdfefff, wall: { matKey: 'L2:attic_wall', w: SIZE, h: H } });
    b.data.hasAtticWindow = true;
    void win;
  }

  // ---- 临时掩体式居住/储物空间（bases：小团体用炸药开凿，从未确认遇到其他团队 → 空置无 NPC）----
  if (kind === 'shelter') {
    for (let k = 0; k < 3; k++) {
      const x = 4 + rng() * (SIZE - 8), z = 4 + rng() * (SIZE - 8);
      if (rng() < 0.5) kit.prop.crate(b, x, z, rng() * Math.PI * 2, { size: 0.7, color: 0x5a4a32 });
      else kit.prop.box(b, x, z, rng() * Math.PI * 2, { stack: 1 + ((rng() * 2) | 0), color: 0x8a7a5a });
    }
  }

  // ---- 下水道隧道：地上一个通往 Level 34 的洞（依据 exits「遇到下水道隧道 → Level 34」；34 超出首期范围，kit 自动 sealed）----
  if (kind === 'sewer') {
    kit.prop.puddle(b, SIZE / 2 - 1.6, SIZE / 2, 0, { rx: 1.4, rz: 1, color: 0x3a3f30 });
    kit.exit(b, { to: '34', kind: 'hole', x: SIZE / 2, z: SIZE / 2, radius: 1, label: '下水道隧道', hole: { r: 1.1, irregular: true, rimColor: 0x3a3f30 } });
  }

  // ---- Biological Pipeline 入口：藏在爬行空间交汇处的活体管道内壁（landmarks + hazards + mechanics）----
  if (kind === 'pipeline') {
    b.data.kind = 'pipeline';   // level.update 用它判定玩家是否站在管道里
    kit.prop.puddle(b, SIZE / 2, SIZE / 2, 0, { rx: 2, rz: 1.6, color: 0x4a3f2a }); // 管内积存的消化残余
  }

  if (kind === 'hot') b.data.kind = 'hot';   // level.update 用它判定高温灼烧

  // 零星指示灯：数量随机但先无条件抽取（第 4.2 节），open 房间给 2 盏、迷宫格给 0–1 盏
  const rBulb = rng();
  const nBulbs = isOpen ? 2 : (rBulb < 0.7 ? 1 : 0);
  const openCells = g.cells().filter(c => !c.reserved);
  for (let k = 0; k < nBulbs && openCells.length; k++) {
    const c = openCells[Math.floor(rng() * openCells.length)];
    const color = kind === 'hot' ? 0xff7a45 : (kind === 'cold' ? 0xbfe0ff : 0xffcf9e);
    bulbLight(b, c.x, c.z, { color, intensity: kind === 'hot' ? 0.7 : 0.5 });
  }

  kit.gridWalls(b, g, { matKey: wallKey, trim: false });   // 维护隧道无踢脚线（版本没写室内装修细节，非住宅风格）
  kit.prop.floor(b, null, null, 0, { matKey: 'L2:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L2:ceil', y: H });

  // 高温区/管道内不刷有害实体（依据 mechanics「高温与极端湿度使复杂区域没有实体出没报告」「实体普遍回避这些管网」）
  const safeSpawns = (kind === 'hot' || kind === 'pipeline');
  kit.gridSpawns(b, g, { safe: safeSpawns });

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

// ---------- 层级状态（enter 里重置，非区块级）----------
const S = { hallucCooldown: 10, quakeCooldown: 60, idleTimer: 0, dissolving: false };

BR.levels.register({
  id: '2', name: 'Level 2', title: 'Pipe Dreams', nickname: 'Pipe Dreams',
  version: 'fandom',                     // = data/lore-choices.json 的 levels['2'].source
  survivalClass: 'Threat Index: Class 2（Unsafe / Stable / Low Entity Count）',
  chunkSize: SIZE,
  env: {
    // 颜色未在选中版本核实，按 materials「混凝土、生锈管道」取常见灰绿色调，非设定数值
    background: 0x181a17, fogColor: 0x181a17, fogNear: 5, fogFar: 32,
    // 版本没有描述具体灯具（lighting 字段写「unverified」），只提到存在黑暗区域，
    // 因此不放常规灯具/光源，只用中等偏低环境光 + 自发光装饰件维持可玩能见度（非设定数值）
    ambient: { color: 0xb9c2bd, intensity: 0.28 },
    sanityDrainMul: 1.2,   // 依据 survivalClass「Unsafe」+ 持续的幻觉/污染压力，取中等偏高，非设定精确数值
    hungerDrainMul: 1.15,  // 依据 mechanics「刚进入的地球人比常人消耗更多能量」（能量异常）
    audio: 'pipes',        // 依据 materials「大量水管、蒸汽管和通风管道」
    darkness: false,       // 版本没有明说是无光层，只说存在黑暗区域
  },
  // 依据 entrances「许多流浪者第一次进入后室就是直接切入 Level 2，是从正常现实能到达的最远层级」，
  // 出生点放在一间典型维护隧道交汇处，代表刚从现实切出、尚未意识到发生了什么
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
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
  exits: [
    { to: '1', kind: 'door', note: '爬行空间里的消防出口之一（exits，door 用 style: fire）' },
    { to: '3', kind: 'door', note: '同一处消防出口的另一个可能目的地' },
    { to: '477', kind: 'door', note: '同一处消防出口的第三个可能目的地；477 超出首期范围，摆实物但提示尚未开放' },
    { to: 'Phi', kind: 'door', note: '标有「Φ」的金色门；Level Phi 超出首期范围，尚未开放' },
    { to: '4', kind: 'noclip', note: '走廊本身有概率变成通往 Level 4 的错位墙' },
    { to: '27', kind: 'noclip', note: '同一机制的另一目标；27 超出首期范围，尚未开放' },
    { to: '34', kind: 'hole', note: '下水道隧道区块地上的洞；34 超出首期范围，尚未开放' },
    { to: '699', kind: 'zone', note: '霓虹灯区块尽头的发光圈；699 超出首期范围，尚未开放' },
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
    const chunkKind = chunk && chunk.res && chunk.res.data ? chunk.res.data.kind : null;

    // Biological Pipeline：只要持续移动就不会被消化，站着不动太久才会被碱液溶解
    // （依据 mechanics「只要持续移动就不会被消化」，hazards「碱性消化液数秒内溶解成年人」）。
    // 原文是"吞下几小时不动才开始消化"，这个尺度在游戏里没法还原，压缩成几秒钟，注释说明取舍
    if (chunkKind === 'pipeline' && Math.hypot(P.vx, P.vz) < 0.15) {
      S.idleTimer += dt;
      if (S.idleTimer > 6) {
        if (!S.dissolving) { S.dissolving = true; BR.hud.toast('粘稠的碱液开始包裹你——快动起来！', 2600); }
        if (BR.game.attackPlayers) P.damage({ hp: 24 * dt, sanity: 6 * dt, source: 'hazard:biological_pipeline' });
      }
    } else { S.idleTimer = 0; S.dissolving = false; }

    // 高温区持续灼烧（依据 hazards「极端温度（蒸汽管区 60–100 °C）」）
    if (chunkKind === 'hot' && BR.game.attackPlayers) P.damage({ hp: 3 * dt, sanity: 0, source: 'hazard:steam_heat' });
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
// - Snow（雪）：无对应物品文件，只用地面积水/结冰贴图（puddle）表现，没有做成可拾取/可食用的物品
// - Explosives（炸药）：无对应物品文件，只用于背景说明「小团体炸开临时掩体」，掩体已做成 shelter 区块
// - Radios / walkie-talkies（对讲机）：无对应物品文件，效果（完全失灵）已用 enter() 的一次性提示表现
// - Video cameras（摄像机）：无对应物品文件，纯背景设定（拍不到布局变化本身），不影响玩法
// - DuPont–Bayer solution（碱液）：不是玩家拾取物，是 Biological Pipeline 自身机制，已在 update() 里实现
// - Recovered Diary: My Findings No. 7（寻获日记）：无对应物品文件，纯背景文本，不影响玩法
// - Hallucinatory furnishings（幻象陈设）：无对应物品文件，且原文自己说「不宜当作可拾取物资」，
//   真实性存疑、具体外观和触发条件也没写，只用 HALLUC_MSGS 的提示文案表现
