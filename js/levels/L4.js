// Level 4 - "废弃办公室"
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-4  许可：CC BY-SA 3.0
// 抓取：页面版本 33，最后编辑 2025-09-03；原作者 Reddit 用户 u/M654z（页面本身是英文原文的中文翻译，未注明译者）
// 只按这个版本实现，data/lore-choices.json 的 levels['4'].conflicts 里属于其他版本的细节一律不借，包括：
//   不用 wikidot-en/wikidot-cn 翻译差异里的细节（电梯去向表述、T.B.D. 交易方向表述、原作者署名拼写、
//     窗户陷阱警告强度的措辞差异——这些本版本内部已固定，不再挑拣哪种翻译）；
//   不用 fandom 版本：没有生存等级/无固有危险的说法，没有"完全没有敌对生命"的设定（本层仍有猎犬/钝人/传闻笑魇），
//     没有能看见暴雨浓雾假天空的清澈玻璃窗（本层窗户要么涂黑要么是陷阱，没写窗外景象），
//     没有隔间办公桌电脑、荧光灯+雨声+管道声、12–18°C、约 120000 km² 的具体环境数字（本层这些字段一律 unverified，
//     不从 fandom 借数字），没有自动售货机+Greek Fire 的补给设定，没有 M.E.G. Base Opportunity/B.A.S./S.R.C. 据点
//     （本层据点是 wikidot 站的 Omega 基地/神爱之繁生/T.B.D.），没有 Level 3/30/54/16/34/37/47 的入口列表和
//     Level 197/156/14/332/The Void/4.3 的出口列表（本层入口/出口按 wikidot 站列出），没有"大多数非常规出口通往
//     The Void"这条规则；也不添加按抓取结果本文本里没写的"最佳补给会面点/建议囤积杏仁水"两句（unverified）。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：environment.layout/scale 均为 unverified——原文完全没给迷宫/开阔/尺度的说明，
// 只按 architecture「类似一栋空置的办公大楼」用常规室内迷宫参数，非设定数值（同 L2 处理 unverified scale 的方式）
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.8;   // 原文没给层高，用 kit 默认层高（同 Ldev/L1 的处理）

// ---------- 布局：单一区块类型（版本没有区分出不同分区/子结构，不额外发明分区）----------
// wallDensity 略低于 kit 默认 0.4、loopChance 偏高：依据 mechanics「很容易离开 Level 4，返回也一样」，
// 用更稀疏、更多回路的格子降低迷路感；roomChance/roomSize 偏大：依据 architecture「几乎没有任何家具」，
// 空荡的大房间比密集小隔间更贴合"办公楼但没家具"的描述（数值本身非设定，只是方向上贴合这两句原文）
const EDGE = { salt: 'L4', boundaryDensity: 0.35, straightness: 0.65, minOpenings: 2 };
const OFFICE = Object.assign({ wallDensity: 0.35, roomChance: 0.45, maxRooms: 2, roomSize: [3, 5], loopChance: 0.6, pillarChance: 0.08 }, EDGE);
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 材质 ----------
// materials/colors 字段本身 unverified（原文完全没描述地毯/墙面/天花板颜色），不借用其他版本或其他层级的配色，
// 只按 architecture 已确认的"办公楼"这一件事复用现成贴图并压灰/去饱和，非设定色值（同 L2 处理 unverified 材质的方式）
function defineMaterials() {
  kit.mats({
    'L4:wall':  { tex: 'concrete', repeatMeters: 3.2, roughness: 0.9, color: 0xc9c3b4 },   // 灰米色干墙近似
    'L4:floor': { tex: 'carpet_l0', repeatMeters: 2.5, roughness: 1, color: 0x9a9686 },     // 陈旧地毯，去掉贴图自带的黄色倾向
    'L4:ceil':  { tex: 'ceiling_tile', repeatMeters: 2, roughness: 1 },
  });
}

// ---------- 据点：M.E.G. Omega 基地 / 神爱之繁生 / T.B.D.（宏格哈希，跨区块协调，TEMPLATE 4.2/4.3 节）----------
// 依据 bases[] 三条描述；用户规则（2026-09-13"范围决定"）：据点现在只摆静态外观，不做交互/驻守NPC/交易
// 用宏格让它们稀疏出现，不做成每块必有的普通装饰，贴近"据点"应有的稀有感（引擎没有"全层唯一坐标"的简单机制，
// 这里退而求其次用低概率宏格重复出现，见 apiRequests）
const BASE_MX = 5;
function baseAt(levelSeed, cx, cz) {
  const mx = Math.floor(cx / BASE_MX), mz = Math.floor(cz / BASE_MX);
  const mr = U.rng(levelSeed, 'L4-base', mx, mz);
  const kind = U.weighted(mr, [['meg', 0.12], ['cult', 0.08], ['tbd', 0.08], ['none', 0.72]]);
  if (kind === 'none') return null;
  return { kind, hx: mx * BASE_MX + Math.floor(mr() * BASE_MX), hz: mz * BASE_MX + Math.floor(mr() * BASE_MX) };
}

function pickFreeCell(g, rng) {
  const cells = g.cells(c => !c.room && !c.reserved);
  if (!cells.length) return null;
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))];
}

function buildBase(b, g, rng, kind) {
  const cell = pickFreeCell(g, rng);
  if (!cell) return;
  const x = cell.x, z = cell.z, half = 1.1;
  if (kind === 'meg') {
    // 依据 bases「M.E.G.（探险者总署）Omega 基地：第二个主要基地，半数小队生活于此，守备严密」
    kit.prop.fence(b, x, z - half, 0, { length: half * 2, kind: 'chain', color: 0x5b6b52 });
    kit.prop.fence(b, x, z + half, 0, { length: half * 2, kind: 'chain', color: 0x5b6b52 });
    kit.prop.fence(b, x - half, z, Math.PI / 2, { length: half * 2, kind: 'chain', color: 0x5b6b52 });
    kit.prop.fence(b, x + half, z, Math.PI / 2, { length: half * 2, kind: 'chain', color: 0x5b6b52 });
    kit.prop.crate(b, x - 0.6, z - 0.3, 0.3, { color: 0x4d5a44 });
    kit.prop.cabinet(b, x + 0.55, z + 0.2, -0.2, { kind: 'locker', color: 0x3c4a36 });
    kit.prop.sign(b, x, z + half - 0.05, 0, { y: 2.0, w: 0.55, color: 0xffd23a });
  } else if (kind === 'cult') {
    // 依据 bases「神爱之繁生：崇拜农业的异教团体，仅十位成员，只种植取自 Level 0/1 墙面的几种菌类」
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      b.cylinder(x + Math.cos(a) * 0.5, 0, z + Math.sin(a) * 0.5, 0.12 + 0.05 * rng(), 0.2 + 0.1 * rng(), 'kit:prop', { color: 0x7a8f5a });
    }
    kit.prop.crate(b, x, z - 0.6, 0, { color: 0x5c4a38 });
    kit.prop.sign(b, x, z + 0.7, 0, { y: 1.8, w: 0.4, color: 0xd8b060 });
  } else {
    // 依据 bases「T.B.D.（悬而未决）：仅六人，不理会你时会无视你」——极简小营地，不放招牌不显眼
    kit.prop.crate(b, x - 0.5, z - 0.4, 0.2, { color: 0x6b6357 });
    kit.prop.crate(b, x + 0.4, z + 0.3, -0.4, { color: 0x6b6357 });
    kit.prop.cabinet(b, x, z + 0.7, Math.PI, { kind: 'locker', color: 0x554f44 });
  }
  g.reserve(cell.i, cell.j);
}

// ---------- 房间内景观：窗户 / 冷水器 / 自动售货机 / 杏仁水喷泉 ----------
// 依据 landmarks「被涂黑的窗户（大多数）」「没被涂黑的窗户（陷阱）」「冷水器」「自动售货机」「储存杏仁水的喷水池」
// 固定抽取顺序（TEMPLATE 4.2 节）：窗户是否出现→涂黑与否→冷水器→自动售货机→喷泉，四项独立、与结果无关地各抽一次
function roomPerimeterEdges(g, room) {
  const i0 = room.i, i1 = room.i + room.w, j0 = room.j, j1 = room.j + room.d;
  return g.edges({ wall: true, interior: true }).filter(e => e.axis === 'h'
    ? (e.i >= i0 && e.i < i1 && (e.j === j0 || e.j === j1))
    : (e.j >= j0 && e.j < j1 && (e.i === i0 || e.i === i1)));
}

function buildWaterCooler(b, x, z) {
  // kit 没有专门的冷水机构件（TEMPLATE 8 节：构件不够时自己用 box/cylinder 拼，颜色走 kit:prop 顶点色）
  b.box(x, 0, z, 0.38, 1.0, 0.38, 'kit:prop', { color: 0xe8e6df, faces: 'noBottom' });
  b.cylinder(x, 1.0, z, 0.14, 0.32, 'kit:prop', { color: 0x8fb8cf });
}

function buildAlmondFountain(b, x, z) {
  // 依据 landmarks「储存有杏仁水的喷水池」；kit 没有喷泉构件，用矮基座+水面+中心柱近似
  b.cylinder(x, 0, z, 0.9, 0.35, 'kit:prop', { color: 0xcfcabb, segments: 12 });
  b.cylinder(x, 0.35, z, 0.75, 0.02, 'kit:water', { segments: 12, color: 0xe8dcc0 });   // 杏仁水偏乳白，水面顶点色略偏暖
  b.cylinder(x, 0.35, z, 0.08, 0.5, 'kit:prop', { color: 0xb7b2a0 });
}

// 未涂黑窗户（陷阱）的世界坐标记下来，供 level.update 做「靠近→低语引诱→贴近→伸手拖拽」判定（Entity 2「窗户」不是可四处走动的实体，走环境危害）
function markWindowTrap(b, x, z) {
  const w = b.world(x, z);
  (b.data.trapWindows || (b.data.trapWindows = [])).push({ x: w.x, z: w.z, nextLure: 0, nextGrab: 0 });
}

function decorateRoom(b, g, room, rng) {
  const rWindow = rng(), rBlackout = rng(), rCooler = rng(), rVending = rng(), rFountain = rng();
  const c = g.center(Math.min(g.cols - 1, room.i + (room.w >> 1)), Math.min(g.rows - 1, room.j + (room.d >> 1)));
  if (rWindow < 0.4) {
    const edges = roomPerimeterEdges(g, room);
    if (edges.length) {
      const ed = edges[Math.floor(rng() * edges.length)];
      const blackout = rBlackout < 0.82;   // 依据「大多数窗户被完全涂黑」，"大多数"取约 4/5，非精确设定值
      kit.prop.window(b, ed.x, ed.z, ed.rot, { blackout });
      if (!blackout) markWindowTrap(b, ed.x, ed.z);   // 未涂黑=陷阱，看起来就是块普通玻璃，不额外加发光提示（原文没写外观区别）
    }
  }
  if (rCooler < 0.12) buildWaterCooler(b, c.x - 0.8, c.z);
  if (rVending < 0.12) kit.prop.vending(b, c.x + 0.8, c.z, Math.PI, {});
  if (rFountain < 0.05) buildAlmondFountain(b, c.x, c.z + 1.2);
}

// ---------- 出口：办公室楼梯(→5/→6)、电梯(→3)、地下室楼梯(→71，很少见，超首期范围自动 sealed) ----------
// 依据 exits[]：楼梯/电梯"偶尔出现"，权重都调低；地下室楼梯"很少情况下"，权重再调低一档（非设定数值，只是相对大小关系）
// 楼梯朝向(up/down)原文未说明，5/6 取"向上走进门洞"的常见样式，71 明确是地下室，取"向下的黑洞"样式
const EXIT_DEFS = [
  { to: '5',  kind: 'stairs', weight: 0.05, stairs: { down: false }, note: '办公室风格楼梯，偶尔出现；失去视野后可能消失 (exits[0])' },
  { to: '6',  kind: 'stairs', weight: 0.05, stairs: { down: false }, note: '办公室风格楼梯，偶尔出现；失去视野后可能消失 (exits[1])' },
  { to: '3',  kind: 'elevator', weight: 0.03, note: '有时以通向 Level 3 的电梯形式出现；失去视野后可能消失 (exits[2])' },
  { to: '71', kind: 'stairs', weight: 0.01, stairs: { down: true }, note: '很少见的通往地下室的楼梯；失去视野后可能消失；不在首期范围内，kit 自动标记尚未开放 (exits[3])' },
];

function buildExits(b, g, rng) {
  for (const def of EXIT_DEFS) {
    const roll = rng();
    if (roll >= def.weight) continue;
    const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (!ed) continue;
    kit.exit(b, { to: def.to, kind: def.kind, x: ed.x, z: ed.z, rot: ed.rot, stairs: def.stairs, label: def.note, tag: 'l4-flicker' });
    g.reserve(ed.i, ed.j);
  }
}

// ---------- 区块 ----------
// rng 消耗顺序固定：格子(内部)→灯→各房间装饰(窗/冷水机/售货机/喷泉，按 g.rooms 顺序)→据点(仅命中宏格的那一块)→出口
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const g = kit.grid(b, N, N, OFFICE);

  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J);
    g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1);
  }

  kit.gridWalls(b, g, { matKey: 'L4:wall', trim: { color: 0x4a463c } });
  kit.prop.floor(b, null, null, 0, { matKey: 'L4:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L4:ceil', y: H });

  // 灯光：lighting 字段完全 unverified，用 kit 常规日光灯配比保证基本可玩能见度，非设定数值（同 L2 处理 unverified 灯具的方式）
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const r = rng();
      const state = r < 0.05 ? 'broken' : r < 0.15 ? 'flicker' : 'on';
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, flicker: 0.3 + rng() * 0.4 });
    }
  }

  if (!isSpawn) {
    for (const room of g.rooms) decorateRoom(b, g, room, rng);
    const baseInfo = baseAt(ctx.levelSeed, cx, cz);
    if (baseInfo && baseInfo.hx === cx && baseInfo.hz === cz) buildBase(b, g, rng, baseInfo.kind);
    buildExits(b, g, rng);
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态与危害 ----------
const S = { timer: 0 };
const EXIT_LOST_RADIUS = 12, EXIT_LOST_SEC = 6, EXIT_VANISH_CHANCE = 0.4;   // 数值非设定：够近、够久没看它才判定"失去视野"
const WINDOW_LURE_R = 3, WINDOW_GRAB_R = 0.75;

// lighting/sounds 均 unverified：背景色取不发黑的中性灰棕（怀旧办公楼、非无光层），环境音选 fluorescent
// （原文没写声音，按 architecture 已确认的"办公楼+日光灯盘"选最贴近场景本身的现有预设，不代表版本描述了这种声音）
const LEVEL_ENV = {
  background: 0x2e2a24, fogColor: 0x2e2a24, fogNear: 6, fogFar: 40,
  ambient: { color: 0xf0e6c8, intensity: 0.38 },
  sanityDrainMul: 0.85,   // 依据 survivalClass「生存难度等级 1」+ mechanics「很容易离开，返回也一样」，比默认基线略缓
  hungerDrainMul: 1,      // temperature/weather 均 unverified，不额外加成
  audio: 'fluorescent',
  darkness: false,
};

BR.levels.register({
  id: '4', name: 'Level 4', title: '废弃办公室', nickname: '废弃办公室',
  version: 'wikidot-cn',
  survivalClass: '生存难度 等级 1（原文标签仅"生存难度1"，未见子标签）',
  chunkSize: SIZE,
  env: LEVEL_ENV,
  // 依据 entrances「从枢纽的墙上跃进（切入）；原文称这是最广为人知的方法」——出生点按这条主入口摆放，
  // 其余入口(Level 3 电梯/Level 2 未上锁的门/Level 283 掉落穿顶)不是"从本层出发能触发"的东西，见下方未实现说明
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  entities: [
    // entityDensityOverall「rare —— 原文称本层接近实体绝迹状态，猎犬与钝人是唯二可观测实体」→ rare(0.04) 拆成两份
    { type: 'hound', officialPer1000m2: 0.02 },
    { type: 'duller', officialPer1000m2: 0.02 },
    // 笑魇：页面明确写"一人曾声称看到过，但没有证据"，不计入上面的 rare 预算；
    // 比照 item-spawn.json 里"全站最稀有"量级（almond_water_red 的 0.004）取同一数量级，代表传闻级而非可观测密度
    { type: 'smiler', officialPer1000m2: 0.004 },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },              // 用户规则：所有模式都刷；版本 landmarks 也列了冷水器/售货机/杏仁水喷泉
    { type: 'almond_water_blue', per1000m2: 0.12 },        // item-spawn.json：特殊配色瓶多数报告于 Level 4，perLevel 已翻倍
    { type: 'almond_water_green', per1000m2: 0.08 },       // 同上，绿色为第二常见彩色瓶
    { type: 'almond_water_red', per1000m2: 0.004 },        // item-spawn.json：全站最稀有色，仅 5 瓶记录，不限层级
    { type: 'royal_rations', per1000m2: 0.01 },            // item-spawn.json：不限层级的极稀有物资
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },    // item-spawn.json：大多数层级都有但很少，蓝色最常见
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },              // item-spawn.json：极稀有，无死亡飞蛾的层级也少量散落
    { type: 'food_ration', per1000m2: 0.6 },               // 用户规则兜底：本层未单独设定食物道具，用现有罐头口粮补齐
  ],
  exits: EXIT_DEFS.map(d => ({ to: d.to, kind: d.kind, note: d.note })),
  enter(ctx) {
    S.timer = 0;
    S.rng = U.rng(ctx.levelSeed, 'L4-flavor');   // 出口消失判定、窗户危害的音效/伤害节奏用；不用 Math.random
  },
  update(ctx, dt) {
    S.timer += dt;

    // ---------- 出口失去视野后可能消失（exits[] 每条都写了这条规则）----------
    // 用玩家朝向与出口连线的夹角近似"是否在视野里"：够近、且持续不在正前方一段时间后，按概率停用触发点。
    // kit 的楼梯/电梯实物没有整体可见性开关（只有 door 的 leaf、elevator 的门扇能单独隐藏），做不到把整座楼梯间
    // 变没；这里只让触发失效并提示，是对"消失"的近似（写进 apiRequests）。同一区块一旦卸载重建，会按同一套
    // 确定性 rng 重新摆出这条出口，整体上就是"这次来时它可能不见了，下次可能又出现"。
    const yaw = BR.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const h of kit.handles({ tag: 'l4-flicker' })) {
      if (!h.active) continue;
      const dx = h.x - BR.player.x, dz = h.z - BR.player.z, d2 = dx * dx + dz * dz;
      if (d2 > EXIT_LOST_RADIUS * EXIT_LOST_RADIUS || d2 < 0.01) { h._lostT = 0; continue; }
      const len = Math.sqrt(d2), dot = (dx / len) * fx + (dz / len) * fz;
      if (dot > 0.2) { h._lostT = 0; continue; }   // 大致在视野前方 ~78° 锥角内算"看得见"
      h._lostT = (h._lostT || 0) + dt;
      if (h._lostT >= EXIT_LOST_SEC) {
        h._lostT = 0;
        if (S.rng() < EXIT_VANISH_CHANCE) {
          h.setActive(false);
          BR.hud.toast('回头一看，那条出路好像不见了……', 2400);
          BR.audio.play('static');
        }
      }
    }

    // ---------- 未涂黑窗户（Entity 2「窗户」）：低语手势引诱 → 贴近时伸手拖拽 ----------
    for (const c of BR.world.chunks()) {
      const wins = c.res && c.res.data && c.res.data.trapWindows;
      if (!wins) continue;
      for (const w of wins) {
        const dx = BR.player.x - w.x, dz = BR.player.z - w.z, d2 = dx * dx + dz * dz;
        if (d2 < WINDOW_LURE_R * WINDOW_LURE_R && S.timer >= w.nextLure) {
          w.nextLure = S.timer + 6 + S.rng() * 5;
          BR.audio.play('whisper');   // 依据「用低语和手势引诱流浪者」
        }
        if (d2 < WINDOW_GRAB_R * WINDOW_GRAB_R && S.timer >= w.nextGrab) {
          w.nextGrab = S.timer + 3;
          BR.gfx.flash(0x140a1c, 0.3, 0.55);   // 依据「再伸出手臂把人拖进窗内的思维空间」——游玩/测试模式只给视觉提示
          if (BR.game.attackPlayers) BR.player.damage({ hp: 8, sanity: 10, source: 'hazard:windows' });
        }
      }
    }
  },
  leave(ctx) { BR.hud.prompt(null); },
});
})();

// ============================================================
// 没有实现的细节（选中版本 wikidot-cn 里提到，但本文件没做）：
//   - entrances「Level 3 电梯」「Level 2 未上锁的门」「Level 283 掉入海洋球池、几率被传送穿过 Level 4 天花板」：
//     这些是"从别的层级进入 Level 4"的方式，触发逻辑应写在对方层级的文件里（Level 2/3 已实现，可在各自文件里加一条
//     指向 Level 4 的出口；Level 283 不在首期范围，没有文件可写）。本文件的 spawn() 只体现了原文称"最广为人知"的
//     从枢纽切入方式，其余三种没有对应的"从 Level 4 出发"的入口点可摆。
//   - bases「神爱之繁生敌意强烈，通常不与你交易，除非持有宗教物品」「T.B.D. 只售卖没有实际用途的奇特物品」：
//     按用户 2026-09-13"范围决定"，据点现在只摆静态外观（已实现：buildBase 的 meg/cult/tbd 三种），
//     不做交易、不做可进入交互、不驻守会攻击/交谈的 NPC；交易系统与据点逻辑挂上游戏大厅后再补。
//   - items「宗教物品（如耶稣像等）」「没有实际用途的奇特物品（T.B.D. 出售）」：两者都是与据点交易挂钩的道具，
//     没有 js/items 文件，且交易系统本身未实现，不放进 items 表。
//   - bases 提到「M.E.G. Omega 基地靠近一个前往 Level 5 及 Level 6 的入口」：kit 没有"地标与出口空间耦合"的
//     能力（见 apiRequests），buildBase 与 EXIT_DEFS 各自独立按概率摆放，没有强制相邻。
// ============================================================
