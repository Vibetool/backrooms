// Level 6: "Lights Out"
// 来源版本：fandom  URL：https://web.archive.org/web/20251224183310/https://backrooms.fandom.com/wiki/Level_6  许可：CC BY-SA 3.0
// 抓取：2026-09-12，存档修订 wgRevisionId 1034678，作者 Gamma（审核 Egglord1）
// 只按这个版本实现，冲突列表（conflicts）里属于 wikidot-en / wikidot-cn 的细节一律不做（WAVE2.md 第 1 节）：
//   不做无尽的室内混凝土走廊/隔音室式绝对寂静；不做循环海浪声找楼梯井；不做 Mimicry 模仿者社区、
//   世界静极之屋前哨；不做 M.E.G. 入口外救援纸条；不做去 Level 129 的极冷金属门出口；
//   入口不含 Level 4 Base Omega；幻听内容按 fandom 写成鸟鸣与回荡的人声，不用 wikidot 的碎步声/呼吸声/低语。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：environment.architecture「广阔荒芜的苔原」+「破败的地下走廊网络」+「更深处的洞穴系统」——三种环境共用一套格子，
// 取开阔层区间（TEMPLATE 16 节 32–48）里偏大的一档，让地表格子显得没那么像室内迷宫
const SIZE = 40, N = 8, CELL = SIZE / N;
const H_UNDER = 2.6;   // 地下走廊/洞穴层高：原文没给数字，取接近 kit 默认层高的值
const H_SURF = 3.6;    // 地表巨石比室内层高要高，露天不设顶，写大一点更像旷野而非房间

// ---------- 区域宏格：地表 / 地下走廊 / 深层洞穴 ----------
// 依据：environment.layout「两层结构。地表是开阔的野外地形…地下是走廊网络，再往下是互相连通的洞穴系统」
// 实现说明（简化，见文件末尾）：kit 没有真正的多层 Y 向堆叠导航（同一 XZ 位置同时存在地表与地下两套可走路面），
// 这里改用同一张 XZ 网格上的宏区域切换（做法与 js/levels/L1.js 的 SECTOR 宏格哈希一致）表示"地表→地下→深处"的推进，
// 玩家靠步行穿过宏区域边界，而不是真的向下位移；边界参数（EDGE）全层所有区块严格一致（TEMPLATE 7.2 节）
const EDGE = { salt: 'L6', boundaryDensity: 0.2, straightness: 0.55, minOpenings: 3 };
const SURFACE  = Object.assign({ wallDensity: 0.08, roomChance: 0.1,  maxRooms: 1, roomSize: [3, 5], loopChance: 0.7,  pillarChance: 0.05 }, EDGE);
const CORRIDOR = Object.assign({ wallDensity: 0.5,  roomChance: 0.25, maxRooms: 2, roomSize: [2, 3], loopChance: 0.35, pillarChance: 0 },    EDGE);
const CAVE     = Object.assign({ wallDensity: 0.38, roomChance: 0.45, maxRooms: 2, roomSize: [3, 5], loopChance: 0.5,  pillarChance: 0.06 }, EDGE);
const SPAWN_I = 3, SPAWN_J = 3;
// 「走得够远」离开本层的距离：离出生区块曼哈顿距离 5 块（≥200 m，斜着走约 140 m），黑暗里一两分钟的路；原文没给距离，非设定数值
const FAR_CHUNKS = 5;
const MX = 4;   // 4×4 区块（160 m）一个宏区域；太小会显得地表/地下切换过于频繁，配不上"sprawling"的描述

function regionAt(levelSeed, cx, cz) {
  if (cx === 0 && cz === 0) return 'surface';   // 出生点固定地表：entrances 没写清落在地表还是地下，主体环境是地表苔原
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  // 依据：architecture 地表苔原为主体环境，地下走廊网络在"地表以下几米"，是次级区域
  const top = U.weighted(U.rng(levelSeed, 'L6-top', mx, mz), [['surface', 0.6], ['under', 0.4]]);
  if (top === 'surface') return 'surface';
  // 依据：architecture「更深处有洞穴系统的入口」——地下走廊网络里嵌套更少见的深层洞穴
  return U.weighted(U.rng(levelSeed, 'L6-sub', mx, mz), [['corridor', 0.68], ['cave', 0.32]]);
}
function regionAudio(region) { return region === 'surface' ? 'wind-field' : 'cave'; }

// ---------- 材质：全部复用已有贴图靠顶点色区分，本层永久黑暗看不清细节，不新增贴图（15 节"先想能不能不生成"）----------
function defineMaterials() {
  kit.mats({
    // 依据：materials「不稳定、易坍塌的地面」「岩层与锯齿状巨石」——复用湿水泥贴图染深灰褐代表冻土碎石
    'L6:ground':  { tex: 'concrete_wet', repeatMeters: 3.5, roughness: 1,    color: 0x4a4438, vertexColors: true },
    'L6:rock':    { tex: 'concrete',     repeatMeters: 2.2, roughness: 0.95, color: 0x413c34 },
    // 依据：materials「地下：锈蚀金属管道…天花板墙面滴落深色污垢」——水泥贴图染锈褐色
    'L6:pipeWall':  { tex: 'concrete',      repeatMeters: 2.6, roughness: 0.9, color: 0x4d3f30 },
    'L6:pipeFloor': { tex: 'concrete_wet',  repeatMeters: 2.6, roughness: 1,   color: 0x352c22 },
    'L6:pipeCeil':  { tex: 'ceiling_tile',  repeatMeters: 2,   roughness: 1,   color: 0x2c2620 },
    // 依据：architecture「洞穴系统…摇晃的金属栈桥」——洞壁取偏冷灰绿，暗示潮湿霉菌
    'L6:caveWall':  { tex: 'concrete',      repeatMeters: 3,   roughness: 1,   color: 0x333b30 },
    'L6:caveFloor': { tex: 'concrete_wet',  repeatMeters: 3,   roughness: 1,   color: 0x272e24 },
  });
}

// ---------- 区块 ----------
// rng 消耗顺序固定：区域(宏格哈希，不吃本区块 rng) → 格子 → 区域内装饰(各区域内部再各自固定顺序) → 出口(四种，任意区域都无条件掷) → 出生点
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const region = regionAt(ctx.levelSeed, cx, cz);
  const gp = region === 'surface' ? SURFACE : region === 'cave' ? CAVE : CORRIDOR;
  const height = region === 'surface' ? H_SURF : H_UNDER;

  const b = kit.builder(ctx, cx, cz, rng, { height });
  const g = kit.grid(b, N, N, gp);
  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J);
    g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  }

  if (region === 'surface') buildSurfaceRegion(b, g, rng, isSpawn);
  else if (region === 'cave') buildCaveRegion(b, g, rng, isSpawn);
  else buildCorridorRegion(b, g, rng, isSpawn);

  buildExits(b, g, rng, region, cx, cz, isSpawn);

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 地表：广阔苔原，永久黑暗，山谷空地，岩层巨石，大坑 ----------
function buildSurfaceRegion(b, g, rng, isSpawn) {
  // 依据：landmarks「山峰之间的大山谷/空地：地面大多长着散发恶臭的黄褐色草」——约三成非出生块判定为山谷子类型
  const valleyRoll = rng();
  const isValley = !isSpawn && valleyRoll < 0.3;

  kit.gridWalls(b, g, { matKey: 'L6:rock', trim: false });   // 地表巨石阻挡不设踢脚线（不是房间墙）
  // 依据：smells「黄褐色草散发令人作呕的恶臭」——山谷子类型顶点色染黄褐，草地没有独立贴图，复用地面材质染色近似
  kit.prop.floor(b, null, null, 0, { matKey: 'L6:ground', color: isValley ? 0x8a7a3c : undefined });
  // 无天花板：本层永久黑暗、地表露天，不建顶省三角形，背景色本身近黑，视觉上与"无光的天空"无缝

  // 岩层与锯齿状巨石，偶尔带奇怪刻痕或尖锐晶体结构（依据 landmarks）：格子迷宫的柱子格点当巨石用
  for (const p of g.pillars) {
    const r = rng();
    if (r < 0.4) {
      const c = g.center(p.i, p.j);
      kit.prop.pillar(b, c.x, c.z, 0, { w: 0.7, matKey: 'L6:rock' });
      if (r < 0.08) {
        // 依据：materials「一些有奇怪的刻痕或尖锐的晶体结构，暗示不是自然形成」——极少数巨石顶上加一枚微光晶体
        b.cylinder(c.x, H_SURF * 0.5, c.z, 0.05, 0.5, 'kit:glow', { color: [0.6, 1.1, 1.3], glow: 0.6 });
      }
    }
  }

  // 巨大的石制方尖碑：仅山谷子类型出现（依据 landmarks「在部分大空地里，刻着无法解读的符号和文字；用途未知」）
  if (isValley) {
    const obeliskRoll = rng();
    if (obeliskRoll < 0.35) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        b.box(cell.x, 0, cell.z, 0.9, 6.5, 0.9, 'L6:rock', {});
        // 无法解读的符号：kit 没有雕刻贴图，用几块暗色顶点色小面片粗略示意刻痕
        for (let k = 0; k < 3; k++) b.plane(cell.x, 1.2 + k * 1.6, cell.z + 0.46, 0.5, 0.35, 'kit:prop', { facing: '+z', color: [0.15, 0.15, 0.17] });
        g.reserve(cell.i, cell.j);
      }
    }
  }

  // 大坑：地面不稳、容易失足，遍布地表，大片区域完全无法通行（依据 hazards）——用不挡路的坑面 + 单独的碰撞体块表示"进不去"
  const pitRoll = rng();
  if (!isSpawn && pitRoll < 0.16) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      kit.prop.hole(b, cell.x, cell.z, 0, { r: 1.1, irregular: true, rimColor: 0x241f18 });
      b.solid(cell.x - 1.1, -0.2, cell.z - 1.1, cell.x + 1.1, 1.6, cell.z + 1.1);
      g.reserve(cell.i, cell.j);
      markPit(b, cell.x, cell.z);
    }
  }
}

// ---------- 地下：破败的锈蚀管道走廊网络，湿度高、多霉菌，荧光灯破裂失效 ----------
function buildCorridorRegion(b, g, rng, isSpawn) {
  kit.gridWalls(b, g, { matKey: 'L6:pipeWall', trim: { color: 0x3a2c1c } });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L6:pipeCeil', y: H_UNDER });
  kit.prop.floor(b, null, null, 0, { matKey: 'L6:pipeFloor' });

  // 依据：lighting「地下的荧光灯破裂失效，有的被整个从天花板扯下」——原有灯位一半左右还剩破损的灰面板，其余视为已被扯下、什么都不放
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const r = rng();
      if (r < 0.55) {
        const c = g.center(i, j);
        kit.prop.lightPanel(b, c.x, c.z, 0, { y: H_UNDER, state: 'broken' });
      }
    }
  }

  // 锈蚀金属管道 + 天花板墙面滴落的焦油状污垢（依据 materials）
  for (let k = 0; k < 3; k++) {
    const r = rng();
    if (r < 0.5) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        const axisRoll = rng();
        kit.prop.pipe(b, cell.x, cell.z, 0, { axis: axisRoll < 0.5 ? 'x' : 'z', y: H_UNDER - 0.3, length: 2.2, color: 0x5c4326 });
        kit.prop.puddle(b, cell.x, cell.z, 0, { rx: 0.5, rz: 0.4, color: 0x1c150e });
      }
    }
  }

  // 大量霉菌（依据 entities「abundant mold，地下区域湿度高，是本层唯一有记录的生命」；
  // entity-index.json hazards 说明「原文没说它有害，适合只做成环境表现」——因此不注册实体，只做贴图斑块）
  for (let k = 0; k < 4; k++) {
    const r = rng();
    if (r < 0.45) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        const sr = rng(), sr2 = rng();
        b.plane(cell.x, 0.02, cell.z, 0.9 + sr * 0.6, 0.7 + sr2 * 0.5, 'kit:prop', { facing: 'up', color: [0.22, 0.3, 0.13] });
      }
    }
  }
}

// ---------- 深层洞穴：更潮湿的霉菌洞穴，用金属栈桥相互连接 ----------
function buildCaveRegion(b, g, rng, isSpawn) {
  kit.gridWalls(b, g, { matKey: 'L6:caveWall', trim: false });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L6:pipeCeil', y: H_UNDER, color: 0x232922 });
  kit.prop.floor(b, null, null, 0, { matKey: 'L6:caveFloor' });

  // 摇晃的金属栈桥（依据 architecture「洞穴之间常用摇晃的金属栈桥连接」）——简化为架空金属步道 + 两侧扶手，
  // 不做真实的缺口物理（kit 没有局部悬空地板碰撞体系统），下方仍是实心地面，细节见文件末尾说明
  const catwalkRoll = rng();
  if (!isSpawn && catwalkRoll < 0.3) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      b.box(cell.x, 0.05, cell.z, 1.4, 0.06, 2.4, 'kit:prop', { color: 0x4a463c });
      b.box(cell.x - 0.68, 0.5, cell.z, 0.05, 0.9, 2.4, 'kit:prop', { color: 0x3c382e });
      b.box(cell.x + 0.68, 0.5, cell.z, 0.05, 0.9, 2.4, 'kit:prop', { color: 0x3c382e });
    }
  }

  // 更浓的霉菌（洞穴比地下走廊更潮湿，依据 architecture「霉菌」+「潮湿」）
  for (let k = 0; k < 5; k++) {
    const r = rng();
    if (r < 0.55) {
      const cell = pickFreeCell(g, rng);
      if (cell) {
        const sr = rng(), sr2 = rng();
        b.plane(cell.x, 0.02, cell.z, 1 + sr * 0.7, 0.8 + sr2 * 0.6, 'kit:prop', { facing: 'up', color: [0.18, 0.26, 0.13] });
      }
    }
  }

  // 洞壁凸起（岩层的延伸，格子迷宫柱子格点当石笋/岩柱用）
  for (const p of g.pillars) {
    const r = rng();
    if (r < 0.5) { const c = g.center(p.i, p.j); kit.prop.pillar(b, c.x, c.z, 0, { w: 0.5, matKey: 'L6:caveWall' }); }
  }
}

// ---------- 出口：四条都无条件掷骰，保持消耗顺序稳定；对应区域不符时骰子照掷但不生效 ----------
function buildExits(b, g, rng, region, cx, cz, isSpawn) {
  // exits[0]：被倒下的树枝绊倒到 Level 6.1（原文 may lead，不保证）——只在地表判定
  const branchRoll = rng();
  if (!isSpawn && region === 'surface' && branchRoll < 0.05) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      b.cylinder(cell.x, 0.1, cell.z, 0.08, 1.6, 'L6:rock', { axis: 'x', color: 0x2c2418 });
      kit.exit(b, { to: '6.1', kind: 'zone', x: cell.x, z: cell.z, radius: 0.9, label: '被倒下的树枝绊倒 (exits[0])' });
      g.reserve(cell.i, cell.j);
    }
  }

  // exits[1]：进入一个洞到 Level 8（原文 will lead，必然）——只在深层洞穴判定
  const holeRoll = rng();
  if (!isSpawn && region === 'cave' && holeRoll < 0.05) {
    const cell = pickFreeCell(g, rng);
    if (cell) {
      kit.exit(b, { to: '8', kind: 'hole', x: cell.x, z: cell.z, label: '进入洞穴深处的一个洞 (exits[1])' });
      g.reserve(cell.i, cell.j);
    }
  }

  // exits[2]：走得足够远到 Level 7。原文的意思是"走得够远"本身就会离开本层，不是去找某个点：
  // 离出生区块 FAR_CHUNKS 块以外的每个区块都铺一个盖住整块的无实物 zone 出口（半径 30 m 盖住 40 m 见方的四角），走进去就换层。
  // 原先是"8 块以外 3% 概率摆一个 1.4 m 的小圈"——本层能见度只有十米上下，玩家基本摸不到，等于这一层没有出口。
  // 用 zone 不用 event：zone 默认激活，出生点落在圈里不算（world 开局会 latch），创意工坊把出生点挪远也不会一开局就被传走
  const distRoll = rng();   // 保留这次取数，后面 exits[3] 等特征的随机序列不变
  void distRoll;
  const macroDist = Math.abs(cx) + Math.abs(cz);
  if (!isSpawn && macroDist >= FAR_CHUNKS) {
    kit.exit(b, { to: '7', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: SIZE * 0.75, label: '走得足够远，隐约感到已经离开本层 (exits[2])' });
  }

  // exits[3]：找到看似异常的光源到 Level 7——依据附录路线（管道走廊→霉菌洞穴→异常明亮走廊→门），放在深层洞穴
  // 这是本层唯一违反"光源封锁"机制的地方：一盏稳定不闪的冷白光，正是版本描述里的"异常"
  const lightRoll = rng();
  if (!isSpawn && region === 'cave' && lightRoll < 0.05) {
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (ed) {
      kit.prop.lightPanel(b, ed.x, ed.z, 0, { y: H_UNDER - 0.3, w: 0.3, d: 0.3, state: 'on', intensity: 1.3, range: 7, color: 0xdff3ff, flicker: 0 });
      kit.exit(b, { to: '7', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '异常明亮走廊尽头的门 (exits[3])' });
      g.reserve(ed.i, ed.j);
    }
  }
}

// 记下大坑的世界坐标，供 level.update 做"靠近大坑容易失足"判定
function markPit(b, x, z) {
  const w = b.world(x, z);
  (b.data.pits || (b.data.pits = [])).push({ x: w.x, z: w.z });
}

function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}

// ---------- 层级状态与危害（enter/update/leave）----------
const S = { timer: 0, region: 'surface', hallucAt: 0, sleepAt: 0, pitTimer: 0, rng: null };
const HALLUC_MIN = 20, HALLUC_MAX = 50;   // 依据：sounds「经常出现幻听」，原文没给频率，取不算频繁的随机间隔
const SLEEP_TIER = 300;                    // 依据：other「待久了会疲劳，反复出现不由自主的短暂入睡（microsleep），探索越来越难」，
                                            // 原文没给数值，取 5 设定分钟一档，档位越高微睡眠越频繁（自定节奏，非设定数值）

// 依据：lighting「永久黑暗」，但 conflicts 里明确写了选中版本（fandom）附录「暴雪夜浑浊的黑暗中看不到几米以外」——
// 也就是说选中版本自己承认了"几米"可视度，不是绝对纯黑。取比现有最暗的正常层级（L3 的 0.16）还低的环境光，
// 但不下探到 L1 断电那种 0.02 的临时惊吓值（那是几十秒的短暂事件，本层是常态，必须能看清脚下摸索前进）
// gfx 的环境光亮度 = ambient.color × intensity：原先 color 0x232d3a 本身就接近纯黑（约 0.18），乘 0.3 只剩约 0.05，
// 预览截图整屏纯黑、墙和出口都找不到。改成正常亮度的冷灰蓝色 × 低强度：有效亮度约 0.14。数值上和 Level 3 的环境光
// （0xffb060 × 0.16 ≈ 0.12）差不多，但本层一盏能用的灯都没有、Level 3 走廊里有灯，所以实际画面仍是现有层级里最暗的；
// 0.09 那一版实测开阔地表脚下仍几乎全黑。现在脚下几米能摸清墙和地面，远处被近黑色的雾吞掉——"最暗但能勉强看路"
const LEVEL_ENV = {
  background: 0x05070a, fogColor: 0x05070a, fogNear: 1.5, fogFar: 14,
  ambient: { color: 0x9fb0c8, intensity: 0.2 },
  sanityDrainMul: 2.2,   // 依据：other「缺觉加孤立造成精神剥夺、现实解体」+ TEMPLATE"无光层" 2–3 区间取中间偏低
  hungerDrainMul: 1,     // 正文温度字段没有可换算的数值（严寒只在附录个人叙事里出现），不额外加成
  audio: 'wind-field',   // 地表默认音景；地下/洞穴由 update() 按玩家所在宏区域动态切换到 'cave'
  darkness: true,        // 依据：lighting「永久黑暗」
};

BR.levels.register({
  id: '6', name: 'Level 6', title: 'Lights Out', nickname: '',
  version: 'fandom',
  survivalClass: 'THREAT INDEX：Class Pending。Exit 4/5（出口稀少）；Environment 3/5（环境中度危险）；Entities ?/5（无法确定）',
  chunkSize: SIZE,
  env: LEVEL_ENV,
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据：entityDensityOverall「none（按正文）。Entity Presence 段称唯一有记录的生命是地下区域的大量霉菌」。
    // data/entity-index.json 的 entities[] 里没有任何条目把 levels 划进 "6"（death_rat/woodlin/watcher/ant/samantha/
    // thing_on_level_7/tiny 分别属于 5、5、5、5、5、7、7），Skin-Stealer 虽在原文附录出现过一次，但原文未确认发生在
    // 本层、entity-index.json 也没有把它列入 levels:["6"]，按用户规则（版本说没有实体就 entities:[]，不擅自加）留空。
    // 霉菌按 entity-index.json 的 hazards 说明"适合只做成环境表现"，已在 buildCorridorRegion/buildCaveRegion 里做成
    // 贴图斑块，不注册为实体。
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },     // 用户规则：所有模式都刷；也对应附录里从结冰湖凿冰取水得到的"杏仁水"
    { type: 'food_ration', per1000m2: 0.6 },      // 用户规则兜底：所有模式都刷食物；正文本身没有专门的食物条目
    { type: 'firesalt', per1000m2: 0.1 },         // data/item-spawn.json：主要分布在洞穴状/破败层级，对应本层地下走廊与洞穴
    { type: 'royal_rations', per1000m2: 0.01 },   // data/item-spawn.json：不限层级的极稀有物资
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },   // data/item-spawn.json：大多数层级都能找到但很少
    { type: 'moth_jelly', per1000m2: 0.003 },     // data/item-spawn.json：瓶罐装的少量散落在没有死亡飞蛾的层级，本层属此类
  ],
  exits: [
    { to: '6.1', kind: 'zone', note: '被倒下的树枝绊倒，原文 may lead（不保证）；6.1 是子层级，不在 BR.LEVEL_ORDER 范围内，kit 自动 sealed 显示"尚未开放" (exits[0])' },
    { to: '8',   kind: 'hole', note: '进入洞穴深处的一个洞，原文 will lead（必然）(exits[1])' },
    { to: '7',   kind: 'zone', note: '走得足够远：离出生区块 5 块（曼哈顿）以外的区块整块都是出口 (exits[2])' },
    { to: '7',   kind: 'door', note: '找到看似异常的光源，附录路线：地下楼梯井→管道走廊→霉菌洞穴→异常明亮走廊→门 (exits[3])' },
  ],
  enter(ctx) {
    S.timer = 0; S.region = 'surface'; S.pitTimer = 0;
    S.rng = U.rng(ctx.levelSeed, 'L6-flavor');   // 幻听间隔、微睡眠节奏、大坑失足判定用；不用 Math.random（联机双方要逐字节一致）
    S.hallucAt = HALLUC_MIN + S.rng() * (HALLUC_MAX - HALLUC_MIN);
    S.sleepAt = SLEEP_TIER;
    // 依据：mechanics「光源封锁：火、手电和其他照明一进入本层即熄灭」——引擎目前没有玩家手持光源系统（见 apiRequests），
    // 只能用这条一次性提示 + 极暗的 env 表现这个机制
    BR.hud.toast('打火机哧地灭了……这里的光源一进来就熄灭', 3200);
    // 依据：mechanics「电子与通讯封锁：电子设备不工作，无线电信号失灵」——用静电噪声一次性提示设备失灵
    BR.audio.play('static');
  },
  update(ctx, dt) {
    S.timer += dt;

    // ---------- 宏区域切换：音景与提示（surface / corridor / cave）----------
    const cc = BR.world.chunkCoordsAt(BR.player.x, BR.player.z);
    const region = regionAt(ctx.levelSeed, cc.cx, cc.cz);
    if (region !== S.region) {
      S.region = region;
      if (BR.audio && BR.audio.setAmbient) BR.audio.setAmbient(regionAudio(region), 2.5);
      if (region === 'corridor') BR.hud.toast('脚下的地面变成了锈蚀的金属管道走廊……空气发闷发臭', 3000);
      else if (region === 'cave') BR.hud.toast('墙壁变成了潮湿的岩壁，远处传来金属栈桥的摇晃声', 3000);
      else BR.hud.toast('重新回到了地表，风声呜咽', 2200);
    }

    // ---------- 快走够远时给一句预兆（exits[2] 在 FAR_CHUNKS 块以外，提前一块提示方向是对的）----------
    if (!S.farHinted && Math.abs(cc.cx) + Math.abs(cc.cz) >= FAR_CHUNKS - 1) {
      S.farHinted = true;
      BR.hud.toast('风里好像带着潮湿的咸味……再往前走，也许就离开这里了', 3200);
    }

    // ---------- 幻听：远处的鸟鸣、回荡的听不清人声（依据 sounds）----------
    if (S.timer >= S.hallucAt) {
      S.hallucAt = S.timer + HALLUC_MIN + S.rng() * (HALLUC_MAX - HALLUC_MIN);
      BR.audio.play('whisper');
    }

    // ---------- 暴露越久越糟：缺觉加孤立造成的微睡眠（依据 other）----------
    if (S.timer >= S.sleepAt) {
      const tier = Math.floor(S.timer / SLEEP_TIER);
      S.sleepAt = S.timer + Math.max(45, SLEEP_TIER - tier * 30);   // 档位越高间隔越短，表现"探索越来越难"（自定节奏）
      BR.hud.toast('眼皮突然撑不住了……', 1600);
      BR.gfx.flash(0x000000, 0.7, 0.9);
      if (BR.game.attackPlayers) BR.effects.add({ key: 'l6-microsleep', seconds: 2.5, speedMul: 0.35, tags: ['hazard'] });
    }

    // ---------- 地面不稳：靠近大坑容易失足（依据 hazards「地面不稳、容易失足；大坑遍布」）----------
    S.pitTimer += dt;
    if (S.pitTimer >= 0.5) {
      S.pitTimer = 0;
      for (const c of BR.world.chunks()) {
        const pits = c.res && c.res.data && c.res.data.pits;
        if (!pits) continue;
        for (const p of pits) {
          const dx = BR.player.x - p.x, dz = BR.player.z - p.z;
          if (dx * dx + dz * dz < 2.25 && BR.game.attackPlayers && S.rng() < 0.05) {
            BR.gfx.flash(0x1a1006, 0.3, 0.4);
            BR.audio.play('hurt');
            BR.player.damage({ hp: 5, sanity: 2, source: 'hazard:pitfall' });
          }
        }
      }
    }
  },
  leave(ctx) {
    BR.hud.prompt(null);
  },
});
})();

// ============================================================
// 待实现物品（data/item-spawn.json 里 levels 含 "6"，但 js/items/ 还没有对应文件，本层没有加进 items 表）：
//   almond_water_blue / almond_water_green / almond_water_red（彩色杏仁水瓶，item-spawn.json 已把 Level 6 划入范围，
//     但对应文件不存在）；lightning_in_a_bottle_artificial / lightning_in_a_bottle_black（另外两种颜色，同样缺文件）。
// 选中版本（fandom）本身列出的其他"物品"，本游戏没有对应的可拾取系统，未做成 items 表条目：
//   便携光源（火、手电）与电子设备/无线电——版本里是"进入即失效"的负面机制，不是补给，已用 enter() 的一次性提示表现；
//   管道中的焦油状粘液——原文没说明效果（"未说明"），只做视觉污渍（见 buildCorridorRegion 的 puddle）；
//   严重损坏的胶片相机——只出现在图注，是背景道具，不是正文列出的物品。
//
// 没有实现/做了简化的环境细节及原因：
//   1) 真正的地表/地下/深层洞穴垂直分层没有做：kit 的格子迷宫与碰撞系统是单层 XZ 网格，没有"同一水平位置在不同 Y
//      上各有一套可走地面"的机制，需要引擎级的多层导航支持（见 apiRequests）。这里改用同一 XZ 网格上的宏区域切换
//      表示地表→地下→深处的推进（regionAt，做法与 L1.js 的 SECTOR 一致），玩家靠步行穿过宏区域边界，不是真的下降。
//   2)（附录）结冰的湖、摇晃的野餐桌、暴雪、严寒冻伤：附录是两名流浪者的一次性个人叙事（日期 2016-12-18），不是
//      正文里对本层的通用环境描述，且正文 temperature/weather 字段本身没有给可换算的数值，所以没有做成天气系统或
//      耐寒机制，只保留它作为"杏仁水"这个必刷物品的出处依据。
//   3)（附录）奇怪的地下楼梯井、异常明亮的走廊：地下楼梯井只用宏区域切换时的一次性 toast 表现（"脚下的地面变成了
//      锈蚀的金属管道走廊……"），没有建对应的楼梯间几何——因为按 1) 的简化，玩家是"走进"地下区域而非"走下"楼梯，
//      摆一个功能上不通向任何地方的楼梯间会造成误导；异常明亮的走廊则做成了 exits[3] 的具体地点（唯一亮着的灯 + 门）。
//   4) 摇晃的金属栈桥：做成了洞穴区块里的架空步道装饰（见 buildCaveRegion），但下方仍是实心地板，没有真正的缺口和
//      跌落判定——kit 没有"局部悬空地板"碰撞体系统，强行挖空地板会破坏该格子的可达性判定。
//   5) Skin-Stealer：原文附录只说人物额头的伤口"来自此前与 Skin-Stealer 的遭遇"，没有确认这次遭遇发生在 Level 6，
//      data/entity-index.json 的 skin_stealer.levels 也没有把 "6" 列进去，按用户规则（不擅自加、不凭记忆编造）未加入
//      entities 表。
// ============================================================
