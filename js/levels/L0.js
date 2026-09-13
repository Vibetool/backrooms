// Level 0 "Threshold"（常用别称 The Yellow Hell）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-0  许可：CC BY-SA 3.0
// 抓取：2026-09-12，page revision 48（15 Aug 2026 13:38 编辑）；u/Deveyerr 改编，DivineAtlas / Robert Goerman / DrAkimoto 重写
// 只按上面这个版本实现，没写的细节不做、不从其他版本（wikidot-cn／fandom）借
// （见 data/lore-choices.json levels["0"].conflicts：标题别称、实体是否存在、出口数量、马尼拉房间、结构变体等条目都按此规则跳过）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }   // BR.util 没有导出这个，各文件自己按需定义（同 world.js/player.js 的写法）

// ---------- 尺寸 ----------
// 原文只强调「Infinity」和数英里/数天的尺度，没给具体房间/走廊米数：沿用 kit 标准迷宫格子
const CELL = 3, N = 8, SIZE = CELL * N;   // 24 m 区块、8×8 格、3 m 一格
const H = 2.8;                            // 层高：原文未给，用 kit.DEFAULT_HEIGHT 同值
const SPAWN_I = 4, SPAWN_J = 4;

// ---------- 布局 ----------
// 边界参数全层所有区块必须一致（_TEMPLATE.md 第 7.2 节）；区块「变体」只改内部墙密度/房间/环路/柱子概率
// 依据 architecture「由随机分段的房间、走廊和楼梯拼接而成」+ layout「无限迷宫，随机拼接」
const EDGE = { salt: 'L0', boundaryDensity: 0.42, straightness: 0.72, minOpenings: 2 };
const MAZE = Object.assign({ wallDensity: 0.42, roomChance: 0.32, maxRooms: 2, roomSize: [2, 4], loopChance: 0.5, pillarChance: 0.02 }, EDGE);
// 拱门区：landmarks[0]「多出现在死胡同或过渡房间...这是最稳定的区域」→ 更多房间过渡、环路更多，同时是最不容易触发「走廊变了」异象的区块（见 update）
const ARCH = Object.assign({ wallDensity: 0.32, roomChance: 0.5, maxRooms: 2, roomSize: [3, 5], loopChance: 0.55, pillarChance: 0.02 }, EDGE);
// 柱厅：landmarks[1]「巨型柱子房间，柱子总是按网格排列」→ 内部清空、大量柱子；边界照旧（同 Ldev 的 HALL 写法）
const PILLAR = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0.42 }, EDGE);
// 断电区：landmarks[3]「整片区域没有灯光...一直在变动」→ 更密的内部墙、更少环路，体现「容易迷路」
const BLACKOUT = Object.assign({ wallDensity: 0.5, roomChance: 0.18, maxRooms: 1, roomSize: [2, 3], loopChance: 0.3, pillarChance: 0.02 }, EDGE);
// 红房间：landmarks[4]「与整层断开的闭环区域，完全进入后无法突破」→ 高墙密度、低环路，尽量绕；
// kit 的格子生成保证块内连通、每条边界线至少 minOpenings 个开口（_TEMPLATE.md 第 7.1 节），
// 引擎不支持「进去出不来」的真正死锁，只能用极度曲折 + 第 14 节的幽闭恐惧效果去逼近，见 notImplemented
const REDROOM = Object.assign({ wallDensity: 0.75, roomChance: 0.08, maxRooms: 1, roomSize: [2, 2], loopChance: 0.12, pillarChance: 0 }, EDGE);

// ---------- 材质 ----------
// 沿用已有的 Level-0 风味贴图（wallpaper_l0/carpet_l0 就是照本层「病态的黄」「棕米色地毯」生成的，见 tools/textures/prompts.json）
// kit.mat 的 color 是乘法叠加，只能让贴图变暗/偏色、不能变浅：红房间用它把黄墙纸压成深红（依据 colors「红房间整体泛深红色调」）；
// 拱门区「浅色墙面」改用调亮该区块灯光来体现（见 buildChunk 的灯光段），不新建材质
function defineMaterials() {
  kit.mat('L0:wall', { tex: 'wallpaper_l0', repeatMeters: 1.5, roughness: 0.95 });
  kit.mat('L0:floor', { tex: 'carpet_l0', repeatMeters: 2, roughness: 1 });
  kit.mat('L0:ceil', { tex: 'ceiling_tile', repeatMeters: 1.2, roughness: 1 });
  kit.mat('L0:wall_red', { tex: 'wallpaper_l0', repeatMeters: 1.5, roughness: 0.95, color: 0xff3030 });
  kit.mat('L0:floor_red', { tex: 'carpet_l0', repeatMeters: 2, roughness: 1, color: 0xff3030 });
}

// ---------- 拱门装饰 ----------
// landmarks[0]「浅色墙面开着拱形孔洞」：kit 没有半圆/局部圆柱构件，用逐级收窄的横条叠出简化拱顶造型，
// 挂在一处天然开口正上方靠天花板处、不给碰撞体——这条开口本来就是 kit 连通性需要的通路，不能用实心构件去堵
function buildArchHeader(b, x, z, rot, matKey) {
  b.push(x, z, rot);
  const steps = 3, full = 2.0;
  for (let k = 0; k < steps; k++) {
    const w = full - k * 0.55;
    const y = H - 0.14 - k * 0.18;
    b.box(0, y, 0.05, w, 0.12, 0.06, matKey, { faces: 'sides', solid: false });
  }
  b.pop();
}

// ---------- 坑洞区 ----------
// landmarks[2]「地面上的方形深坑，漆黑...成群按网格分布，通常容易绕开，但有些群落很大或排得很密」
// 固定在区块中心挖一间 4×4 格的房间放坑群（carve 不吃 rng，位置在哪个区块出现由外层的 kind 权重决定）
const HOLE_I0 = 2, HOLE_J0 = 2, HOLE_W = 4, HOLE_D = 4;
function buildHoleZone(b, g, rng) {
  g.carve(HOLE_I0, HOLE_J0, HOLE_W, HOLE_D, { room: true });
  const dense = rng() < 0.4;                                  // 「有些群落很大或排得很密」：4 成概率是密集群
  const holes = [];
  for (let jj = 0; jj < HOLE_D; jj++) {
    for (let ii = 0; ii < HOLE_W; ii++) {
      if (rng() < (dense ? 0.28 : 0.62)) continue;             // 稀疏群多留空、密集群少留空
      const i = HOLE_I0 + ii, j = HOLE_J0 + jj;
      const c = g.center(i, j);
      const r = 0.55 + rng() * 0.5;
      kit.prop.hole(b, c.x, c.z, 0, { r });
      g.reserve(i, j);
      holes.push({ x: b.ox + c.x, z: b.oz + c.z, r });
    }
  }
  b.data.holes = holes;                                        // 世界坐标，level.update 用来判定「跌进坑里」
}

// ---------- 区块 ----------
// rng 消耗顺序固定：区块类型 → 格子 → （坑洞房间，不吃 rng）→ 切出出口 → 灯 → 拱门/坑洞细节 → 刷新点
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  // 红房间：landmarks[4] 是「几乎不可能撞见」的孤立区域 → 每 4×4 区块的宏格里最多 1 个、30% 概率出现，
  // 用独立派生流选，不吃本区块的 rng（_TEMPLATE.md 第 4.2 节），出生宏格（0,0）永远不选
  const MX = 4;
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  const mr = U.rng(ctx.levelSeed, 'L0-redroom', mx, mz);
  const redHit = mr() < 0.3;
  const rcx = mx * MX + Math.floor(mr() * MX), rcz = mz * MX + Math.floor(mr() * MX);
  const isRedroomTarget = redHit && !(mx === 0 && mz === 0) && cx === rcx && cz === rcz;

  // 无条件先掷一次区块类型（决定顺序固定），出生块永远是普通迷宫
  const rolled = U.weighted(rng, [
    ['maze', 0.60], ['arch', 0.14], ['pillar', 0.10], ['blackout', 0.08], ['hole', 0.08],
  ]);
  const kind = isRedroomTarget ? 'redroom' : (isSpawn ? 'maze' : rolled);

  const gridOpts = kind === 'pillar' ? PILLAR : kind === 'blackout' ? BLACKOUT : kind === 'arch' ? ARCH : kind === 'redroom' ? REDROOM : MAZE;
  const g = kit.grid(b, N, N, gridOpts);
  if (isSpawn) { g.carve(SPAWN_I - 1, SPAWN_J - 1, 3, 3, { room: true }); g.reserve(SPAWN_I, SPAWN_J); }
  if (kind === 'hole') buildHoleZone(b, g, rng);

  const wallKey = kind === 'redroom' ? 'L0:wall_red' : 'L0:wall';
  const floorKey = kind === 'redroom' ? 'L0:floor_red' : 'L0:floor';

  // 离开方式：mechanics「活得够久，找到一面闪烁的墙，扑进去」（exits[0]）；红房间不放（进去别想着还能马上出去）
  const rNoclip = rng();
  const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
  if (!isSpawn && kind !== 'redroom' && rNoclip < 0.12 && ed) {
    g.setWall(ed.axis, ed.i, ed.j, false);
    kit.exit(b, { to: '1', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: wallKey });
    g.reserve(ed.i, ed.j);
  }

  kit.gridWalls(b, g, { matKey: wallKey, pillarSize: kind === 'pillar' ? 0.75 : 0.5, trim: kit.trims.yellowWood });   // 用户指定：黄色墙纸房间用黄色木质矮踢脚线
  kit.prop.floor(b, null, null, 0, { matKey: floorKey });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L0:ceil', y: H });

  // 灯：environment.lighting「头顶荧光灯持续嗡鸣，光线刺眼」，原文没给色温/闪烁频率，用日光灯暖白近似；
  // 断电区完全不放灯描述（hazards「断电区：黑暗中容易迷路」）；红房间灯改红（第 10 节色温对照表：红房间 0xff5040）；
  // 拱门区是「最稳定」「浅色墙面」的区域，灯调亮一档、坏灯概率减半来体现「浅色」的观感（kit.mat 的 color 只能变暗，改不了）
  if (kind !== 'blackout') {
    const pBroken = kind === 'arch' ? 0.025 : 0.05, pFlicker = kind === 'arch' ? 0.07 : 0.13;
    for (let j = 0; j < N; j += 2) {
      for (let i = 0; i < N; i += 2) {
        const r = rng();
        const state = r < pBroken ? 'broken' : r < pBroken + pFlicker ? 'flicker' : 'on';
        const c = g.center(i, j);
        kit.prop.lightPanel(b, c.x, c.z, 0, {
          y: H, state, flicker: state === 'flicker' ? 0.4 + rng() * 0.5 : 0,
          color: kind === 'redroom' ? 0xff5040 : 0xfff1d0,
          intensity: kind === 'redroom' ? 0.55 : kind === 'arch' ? 1.35 : 1.1,
          range: kind === 'redroom' ? 7 : 9,
        });
      }
    }
  }

  // 地毯积液：materials「拱门区地毯很厚、积液多」「断电区...地面下凹，积液及踝」；柱厅「地毯浅、较干」不放
  if (kind === 'arch' || kind === 'blackout') {
    const n = kind === 'arch' ? 5 : 4;
    for (let k = 0; k < n; k++) {
      kit.prop.puddle(b, rng() * SIZE, rng() * SIZE, 0, { rx: 0.5 + rng() * 0.6, rz: 0.35 + rng() * 0.45 });
    }
  }

  if (kind === 'arch') {
    const openings = g.edges({ wall: false, interior: true });
    if (openings.length) {
      const ed2 = openings[Math.floor(rng() * openings.length)];
      buildArchHeader(b, ed2.x, ed2.z, ed2.rot, wallKey);
    }
  }

  b.data.kind = kind;
  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态（心理效应、断电区环境音、坑洞跌落） ----------
// 依据 sanityDrainMul 基线：官方判定 Safe/Secure（生存难度 1），但 environment.other 强调持续的谵妄、
// 孤立感、偏执和被注视感 → 取比「普通 1」高但低于典型「压抑 1.5」的 1.3；靠近红房间时临时拉到 3（见 update）
const BASE_SAN = 1.3;
const ENV = {
  background: 0x2b2512, fogColor: 0x2b2512, fogNear: 6, fogFar: 40,
  // ambient 0.2 特意压到 DARK_LIGHT(0.25，js/game/player.js) 以下：断电区没有灯描述时正好落在「暗」判定里，
  // 自动获得引擎自带的 2 倍掉 san（hazards「断电区：黑暗中容易迷路」），普通区块则靠灯盘把亮度顶上去
  ambient: { color: 0xfff1d0, intensity: 0.2 },
  sanityDrainMul: BASE_SAN,
  hungerDrainMul: 1,          // temperature/weather 原文都是 unverified，用默认掉率
  audio: 'fluorescent',       // environment.sounds「头顶荧光灯持续嗡鸣」
  darkness: false,
};

const S = { timer: 0, rng: null, blackoutAmb: false, wasNearRed: false, buzzT: 0, redT: 0, spikeT: 0, anomalyT: 0, fallT: 0 };

function isNearRedroom(x, z) {
  const { cx, cz } = BR.world.chunkCoordsAt(x, z);
  const list = BR.world.chunks();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.res && c.res.data && c.res.data.kind === 'redroom' && Math.abs(c.cx - cx) <= 1 && Math.abs(c.cz - cz) <= 1) return true;
  }
  return false;
}

function enter(ctx) {
  S.timer = 0; S.rng = U.rng(ctx.levelSeed, 'L0-anomaly');
  S.blackoutAmb = false; S.wasNearRed = false;
  S.buzzT = 0; S.redT = 0; S.spikeT = 14; S.anomalyT = 8; S.fallT = 0;
  ENV.sanityDrainMul = BASE_SAN;
}

function update(ctx, dt) {
  S.timer += dt;
  const P = BR.player;
  const chunk = BR.world.chunkAt(P.x, P.z);
  const kind = chunk && chunk.res && chunk.res.data ? chunk.res.data.kind : null;

  // 断电区：environment.sounds「断电区没有灯声，极度安静」→ 切安静环境音；离开时切回荧光灯嗡鸣
  const inBlackout = kind === 'blackout';
  if (inBlackout !== S.blackoutAmb) {
    S.blackoutAmb = inBlackout;
    if (has(BR.audio, 'setAmbient')) BR.audio.setAmbient(inBlackout ? 'silence' : ENV.audio, 1.2);
    if (inBlackout) BR.hud.toast('灯光忽然没了……', 1800);
  }
  if (inBlackout) {
    // mechanics「断电区里嗡声的声源位置会漂移，跟着走不一定能找到出口」：每隔几秒在玩家周围一个随机方向响一次
    S.buzzT -= dt;
    if (S.buzzT <= 0) {
      S.buzzT = 3 + S.rng() * 4;
      const a = S.rng() * Math.PI * 2, d = 4 + S.rng() * 8;
      BR.audio.play('buzz', { x: P.x + Math.cos(a) * d, y: P.y, z: P.z + Math.sin(a) * d }, { volume: 0.5 });
    }
  }

  // 红房间：hazards「光是靠近就会引起严重幽闭恐惧和急性偏执...建议掉头离开」
  const nearRed = isNearRedroom(P.x, P.z);
  if (nearRed) {
    ENV.sanityDrainMul = 3;
    BR.hud.prompt('这里让人喘不过气……回头，别再往里走了');
    S.redT -= dt;
    if (S.redT <= 0) { S.redT = 2.5; BR.gfx.flash(0xff2020, 0.35, 0.18); BR.audio.play('heartbeat', null, { volume: 0.6 }); }
  } else if (S.wasNearRed) {
    ENV.sanityDrainMul = BASE_SAN;
    BR.hud.prompt(null);
  }
  S.wasNearRed = nearRed;

  // 坑洞：hazards「掉进坑洞区的深坑...没有人报告掉入后生还」；引擎没有真正的地面塌陷，
  // 走进坑心视作跌落——攻击玩家的模式才真的扣血，游玩/测试只给画面音效提示（第 14 节危害伤害约定）
  S.fallT -= dt;
  if (kind === 'hole' && chunk.res.data.holes && S.fallT <= 0) {
    const holes = chunk.res.data.holes;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i], dx = P.x - h.x, dz = P.z - h.z, rr = h.r * 0.55;
      if (dx * dx + dz * dz < rr * rr) {
        S.fallT = 4;
        if (BR.game.attackPlayers) BR.player.damage({ hp: 999, sanity: 0, source: 'hazard:hole' });
        BR.gfx.flash(0x000000, 0.6, 0.9);
        BR.hud.toast('脚下一空——', 1600);
        break;
      }
    }
  }

  // 荧光灯音量尖峰：hazards「荧光灯音量尖峰：长时间暴露损伤听力」；引擎没有单独的听力值，
  // 按第 14 节约定用极小的 sanity 伤害近似「暴露损伤」，且只在会攻击玩家的模式下才真的扣
  S.spikeT -= dt;
  if (S.spikeT <= 0) {
    S.spikeT = 14 + S.rng() * 18;
    const hard = S.rng() < 0.3;
    BR.audio.play('buzz', null, { volume: hard ? 1 : 0.55, rate: hard ? 1.3 : 1 });
    if (hard && BR.game.attackPlayers) BR.player.damage({ hp: 0, sanity: 3, source: 'hazard:buzz-spike' });
  }

  // 被注视感 / 低语 / 熟悉的声音 / 墙后抓挠：hazards「被注视感」+ environment.sounds「含糊的低语；
  // 熟悉的声音在喊你；墙后的抓挠声」；mechanics「越往深处待得越久，越容易遇到结构异常」→ 触发间隔随 S.timer 缩短；
  // 拱门区最稳定不触发（landmarks[0]「这是最稳定的区域，身后基本不变形」）
  if (kind !== 'arch') {
    S.anomalyT -= dt;
    if (S.anomalyT <= 0) {
      S.anomalyT = Math.max(10, 32 - S.timer / 20);
      const r = S.rng();
      if (r < 0.34) { BR.audio.play('whisper', null, { volume: 0.5 }); BR.hud.toast('你听见含糊的低语，还有人在喊你的名字……', 2200); }
      else if (r < 0.6) { BR.hud.toast('余光里，走廊尽头似乎有黑影一晃而过', 1800); }               // 黑影尾随/被注视感，entity-index.json 备注做成视觉现象而非可交互实体
      else { BR.audio.play('static', null, { volume: 0.4 }); }                                     // 墙后抓挠声：引擎没有专门的挠抓音效，暂用 static 近似（见 apiRequests）
    }
  }
}

function leave() {
  ENV.sanityDrainMul = BASE_SAN;
  BR.hud.prompt(null);
  S.blackoutAmb = false; S.wasNearRed = false;
}

BR.levels.register({
  id: '0', name: 'Level 0', title: 'Threshold', nickname: 'The Yellow Hell',
  version: 'wikidot-en',
  survivalClass: '1 · Safe / Secure / Unconfirmed Entities',
  chunkSize: SIZE,
  env: ENV,
  // entrances「跌出现实」「后室各处的隐藏入口」：没有具体可还原的场景描述，落地就是一间普通迷宫房间
  spawn() { return { x: SPAWN_I * CELL + CELL / 2, y: 0, z: SPAWN_J * CELL + CELL / 2, yaw: 0 }; },
  buildChunk,
  // entities[]：entity-index.json 里没有任何 levels 含 "0" 的确认实体；选中版本 entityDensityOverall
  // = "none（未确认）"——生存难度标注 Unconfirmed Entities，只有「黑影尾随」的目击传闻，原文没写攻击方式，
  // entity-index.json 的 hazards 备注也说明它「适合做成视觉和音效现象，不做可交互实体」。
  // 按 WAVE2.md 第 4 节「版本说没有实体 → entities: []，不为了热闹加实体」处理；黑影/被注视感在 update() 里做成偶发现象
  entities: [],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },                    // data/item-spawn.json：不限层级最常见补水物；选中版本称本层这批「被污染」，但没有单独的「被污染杏仁水」道具类型，仍按通用杏仁水刷（用户规则：所有模式都刷）
    { type: 'almond_water_blue', per1000m2: 0.06 },               // data/item-spawn.json：彩色瓶稀有，蓝色最常见
    { type: 'almond_water_green', per1000m2: 0.04 },              // data/item-spawn.json：绿色次之
    { type: 'almond_water_red', per1000m2: 0.002 },               // data/item-spawn.json：红色全后室只发现过 5 瓶
    { type: 'royal_rations', per1000m2: 0.01 },                   // data/item-spawn.json：极其稀有，不限层级
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },           // data/item-spawn.json：稀有度 7/10，蓝色最常见
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },// data/item-spawn.json：人工闪电比蓝色少
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },    // data/item-spawn.json：黑色闪电最少
    { type: 'warpberries', per1000m2: 0.1 },                      // data/item-spawn.json：Warpberries 物品页确认在 Level 0 出现过
    { type: 'moth_jelly', per1000m2: 0.003 },                     // data/item-spawn.json：极其稀有，瓶罐装的少量散落在没有死亡飞蛾的层级
    { type: 'food_ration', per1000m2: 0.6 },                      // 用户规则：所有模式都刷食物；选中版本没写具体食物，用占位罐头口粮兜底
  ],
  exits: [
    { to: '1', kind: 'noclip', note: 'exits[0]：活得够久，找到一面闪烁的墙，扑进去——约 12% 的非出生、非红房间区块内墙会做成这种闪烁墙' },
    { to: 'unknown', kind: 'hole', note: 'exits[1]：掉进坑洞区的深坑，结果未知、没有人报告生还——没有真实目标层级，不用 kit.exit() 摆门，做成"坑洞区"里的致命环境危害（见 update 与 hazards）' },
  ],
  enter, update, leave,
});
})();
