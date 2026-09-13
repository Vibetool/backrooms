// Level 3 - "发电站"（The Electrical Station）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-3  许可：CC BY-SA 3.0
// 抓取：2026-09-12；页面版本 35；原作者 Reddit 用户 u/M654z，Natedagreat563 重写，译者 Lambda Core
// 只按上面这个版本实现，没写的细节不做、不从其他版本（wikidot-en／fandom）借
// （见 data/lore-choices.json levels["3"].conflicts：生存等级数字、墙地材质、温度上限、栅栏来源年份、
//  实体名单与智力设定、Gamma 基地规模、去 69/11 的方式等条目都按此规则跳过，一律不借）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// architecture「一系列长而黑暗的曲折走廊，结构与 Level 0 类似」→ 沿用 Level 0 同款 3 m 格子、24 m 区块
const CELL = 3, N = 8, SIZE = CELL * N;
const H = 2.8;   // 层高：原文未给数字，用 kit.DEFAULT_HEIGHT 同值，非设定
const SPAWN_I = 4, SPAWN_J = 4;

// ---------- 布局 ----------
// 边界参数全层所有区块必须一致（_TEMPLATE.md 第 7.2 节）
// 依据 layout「迷宫式：曲折冗长的走廊 + 随机分割的房间，房间大小与布局和 Level 0 相似」
// roomChance 比 Level 0 更高：materials「有些房间内有独一无二的物体，可用来区分房间（Level 0 没有这一特征）」
const EDGE = { salt: 'L3', boundaryDensity: 0.4, straightness: 0.72, minOpenings: 2 };
const MAZE = Object.assign({ wallDensity: 0.44, roomChance: 0.5, maxRooms: 2, roomSize: [2, 4], loopChance: 0.48, pillarChance: 0.02 }, EDGE);

// 电力房固定挖出的区域（landmarks「走廊中会出现电力房」），9×9 m，够放发电机+断路器箱+两张桌子
const POWER_I0 = 2, POWER_J0 = 2, POWER_W = 3, POWER_D = 3;

// ---------- 材质 ----------
// materials「积灰的棕色砖墙」「积灰的灰色瓷砖地板」「天花板完全由金属构成」
// 墙/地没有现成贴图，新生成 l3_brick_brown / l3_tile_gray（tools/textures/gen.sh）；
// 天花板复用已有的程序化 'metal' 贴图（本层没有单独的金属贴图描述细节，'metal' 本身就是无花纹金属，够用，省一张贴图预算）
function defineMaterials() {
  kit.mat('L3:wall', { tex: 'l3_brick_brown', repeatMeters: 1.4, roughness: 0.92 });
  kit.mat('L3:floor', { tex: 'l3_tile_gray', repeatMeters: 1.0, roughness: 0.85 });
  kit.mat('L3:ceil', { tex: 'metal', repeatMeters: 1.6, roughness: 0.6, metalness: 0.4 });
}

// file:// 双击兜底：贴图文件读不到时的程序化画法（第 15 节步骤 7）
BR.assets.registerProcedural('l3_brick_brown', 256, (g, s) => {
  g.fillStyle = '#4a3a30'; g.fillRect(0, 0, s, s);
  const r = U.rng('l3_brick_brown');
  const bw = s / 6, bh = s / 12;
  for (let row = 0; row < 12; row++) {
    const off = (row % 2) * (bw / 2);
    for (let col = -1; col < 7; col++) {
      g.fillStyle = `rgb(${60 + (r() * 30 | 0)},${45 + (r() * 20 | 0)},${34 + (r() * 16 | 0)})`;
      g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
});
BR.assets.registerProcedural('l3_tile_gray', 256, (g, s) => {
  g.fillStyle = '#8f8d88'; g.fillRect(0, 0, s, s);
  const r = U.rng('l3_tile_gray');
  const t = s / 8;
  g.strokeStyle = '#6c6a65'; g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, s); g.stroke();
    g.beginPath(); g.moveTo(0, i * t); g.lineTo(s, i * t); g.stroke();
  }
  for (let k = 0; k < 500; k++) { const v = 120 + (r() * 40 | 0); g.fillStyle = `rgba(${v},${v},${v - 3},0.3)`; g.fillRect(r() * s, r() * s, 2, 2); }
});

// ---------- 发电机 / 电力房内构件 ----------
// landmarks「电力房：分布在走廊中，各方面都可能完全不同，但大多非常黑暗且内有一台发电机；
// 有断路器盒、电脑、松动的电线、安全摄像监视器、荧光灯等」
// kit.prop 没有专门的发电机/断路器箱构件，按 _TEMPLATE.md 第 8 节末尾用 b.cylinder/b.box 自己拼
function buildGenerator(b, x, z, rot) {
  b.push(x, z, rot);
  b.cylinder(0, 0, 0, 0.55, 1.05, 'kit:prop', { color: 0x3a3a38, segments: 10 });         // 发电机机身
  b.box(0, 1.05, 0, 0.9, 0.12, 0.9, 'kit:prop', { color: 0x2a2a28 });                     // 顶盖
  for (let k = 0; k < 4; k++) {                                                          // 顶部散热格栅（近似）
    b.box(-0.3 + k * 0.2, 1.12, 0, 0.05, 0.03, 0.7, 'kit:prop', { color: 0x151513, solid: false });
  }
  b.pop();
}
function buildBreakerBox(b, x, z, rot) {
  // 断路器盒：kit.prop 没有对应构件，approximate 用挂墙小箱体 + 几个色块表示指示灯
  b.push(x, z, rot);
  b.box(0, 1.3, 0.06, 0.5, 0.7, 0.1, 'kit:prop', { color: 0x2f332e });
  for (let k = 0; k < 3; k++) {
    b.box(-0.15 + k * 0.15, 1.55, 0.11, 0.04, 0.04, 0.02, 'kit:glow', {
      uv: 'solid', color: k === 1 ? 0xff4020 : 0x40ff60, glow: 2.2, solid: false,
    });
  }
  b.pop();
}
function buildCar(b, x, z, rot) {
  // exits「坐到电力房中汽车的前座会失去知觉，随后在 Level 69 醒来」；没有车型/颜色描述，取普通轿车轮廓，非设定
  b.push(x, z, rot);
  b.box(0, 0.35, 0, 1.7, 0.7, 3.6, 'kit:prop', { color: 0x4a2020 });
  b.box(0, 0.85, -0.35, 1.5, 0.55, 1.9, 'kit:prop', { color: 0x2c1414 });
  const wy = 0.18;
  for (const [ox, oz] of [[-0.75, -1.2], [0.75, -1.2], [-0.75, 1.2], [0.75, 1.2]]) {
    b.cylinder(ox, wy, oz, 0.32, 0.22, 'kit:prop', { axis: 'z', color: 0x141414, segments: 8 });
  }
  b.pop();
}

// ---------- 区块 ----------
// rng 消耗顺序固定：区块类型 → 格子（内部墙用同一 rng）→（电力房：汽车？特殊地标：电梯/门？）→ 灯 → 房间装饰 → 刷新点
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  const rolled = U.weighted(rng, [
    ['maze', 0.50], ['power', 0.20], ['bars', 0.14], ['lonelight', 0.08], ['heat', 0.08],
  ]);
  const kind = isSpawn ? 'maze' : rolled;

  const g = kit.grid(b, N, N, MAZE);
  if (isSpawn) {
    g.carve(SPAWN_I - 1, SPAWN_J - 1, 3, 3, { room: true });
    g.reserve(SPAWN_I, SPAWN_J);
    // entrances「Level 2 中未上锁的门通常通向 Level 3」：出生房间背后摆一扇半开的木门当来路，纯装饰不可互动
    const dx = (SPAWN_I - 1) * CELL, dz = (SPAWN_J + 0.5) * CELL;
    kit.prop.door(b, dx, dz, Math.PI / 2, { style: 'wood', open: 1, solid: false });
  }

  let hasCar = false;
  if (kind === 'power') {
    g.carve(POWER_I0, POWER_J0, POWER_W, POWER_D, { room: true });
    hasCar = rng() < 0.22;   // landmarks「部分电力房里有汽车」→ 少数概率
  }

  // 特殊地标（电梯 / 木门 / 锁死的锅炉电力房门）：只在普通走廊块放，出生块不放，罕见
  let special = 'none', edS = null;
  if (kind === 'maze' && !isSpawn) {
    const rSpecial = rng();
    edS = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
    if (edS) {
      if (rSpecial < 0.02) special = 'elevator4';
      else if (rSpecial < 0.04) special = 'elevator5';
      else if (rSpecial < 0.06) special = 'wooddoor31';
      else if (rSpecial < 0.08) special = 'boilerdoor';
    }
  }

  const wallKey = 'L3:wall', floorKey = 'L3:floor';
  kit.gridWalls(b, g, { matKey: wallKey, trim: false });   // materials 没提踢脚线 → 不强套黄木踢脚线（附：其他材质层级自行决定）
  kit.prop.floor(b, null, null, 0, { matKey: floorKey });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L3:ceil', y: H });

  // 灯：environment.lighting「走廊长而黑暗」「电力房大多非常黑暗，仅被发电机光芒照亮」
  // 「另一张更暗的走廊由一个不寻常的荧光灯照亮」「无闪烁或频率描述」→ 只用 on/broken 两态，不加 flicker（原文没写）
  if (kind === 'power') {
    // 电力房不放天花板灯盘，只靠发电机自身的光（下面 buildGenerator 处单独挂灯）
  } else if (kind === 'lonelight') {
    // 「一个不寻常的荧光灯」：整块只留这一盏亮的，其余全黑
    const li = 2 * Math.floor(rng() * (N / 2)), lj = 2 * Math.floor(rng() * (N / 2));
    const c = g.center(li, lj);
    kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state: 'on', color: 0xdfe6ff, intensity: 1.15, range: 10 });
  } else {
    const pBroken = 0.5;   // 「长而黑暗」→ 一半灯是坏的
    for (let j = 0; j < N; j += 2) {
      for (let i = 0; i < N; i += 2) {
        const r = rng();
        const state = r < pBroken ? 'broken' : 'on';
        const c = g.center(i, j);
        kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, color: 0xdcefff, intensity: 0.85, range: 8 });
      }
    }
  }

  // 电力房内部装饰
  let genWorld = null, doorWorld = null;
  if (kind === 'power') {
    const cx0 = (POWER_I0 + POWER_W / 2) * CELL, cz0 = (POWER_J0 + POWER_D / 2) * CELL;
    const xMin = POWER_I0 * CELL, xMax = (POWER_I0 + POWER_W) * CELL;
    const zMin = POWER_J0 * CELL, zMax = (POWER_J0 + POWER_D) * CELL;
    buildGenerator(b, cx0, cz0, 0);
    genWorld = b.world(cx0, cz0);
    b.light({ x: genWorld.x, y: 1.1, z: genWorld.z, color: 0xffb060, intensity: 0.95, range: 7 });   // 「仅被发电机的光芒照亮」
    buildBreakerBox(b, xMin + 0.06, zMin + 1.2, Math.PI / 2);
    kit.prop.desk(b, xMax - 1.0, zMin + 0.6, Math.PI, { monitor: true, screen: 0x2f6e3f });           // 「电脑」
    kit.prop.chair(b, xMax - 1.0, zMin + 1.5, 0, {});
    kit.prop.desk(b, xMin + 0.9, zMax - 0.6, 0, { monitor: true, screen: 0x1f2f1f });                 // 「安全摄像监视器」近似：另一张暗绿屏幕的桌子
    kit.prop.pipe(b, xMin + 0.4, zMax - 0.4, 0, { axis: 'y', length: 1.2, r: 0.05, color: 0x8a8478, solid: false });  // 「松动的电线」近似：一截歪斜细管
    if (hasCar) buildCar(b, xMax - 1.3, cz0 + 1.0, Math.PI / 2);
    if (hasCar) kit.exit(b, { x: xMax - 1.3, z: cz0 + 1.0, kind: 'zone', to: '69', radius: 1.0, label: '坐进驾驶座', marker: { color: [1, 0.6, 0.3] } });
    b.data.kind = 'power';
  } else if (kind === 'bars') {
    // landmarks「锈迹斑斑的监狱栅栏区」+ mechanics「栅栏及周围墙壁无法用任何手段拆除或打开」
    // kit 保证块内连通、不允许真正封死通路（_TEMPLATE.md 7.1/7.2 节），这里只做视觉 + 恐惧效果，
    // 不做成真实阻挡（见返回值 notImplemented）
    const ed = g.pickEdge(rng, { wall: true, interior: true });
    if (ed) {
      b.push(ed.x, ed.z, ed.rot);
      kit.prop.fence(b, 0, 0.12, 0, { length: Math.max(1, ed.len - 0.3), h: H * 0.7, kind: 'rail', color: 0x5b4a34, meshColor: 0x8a7a5c, solid: false });
      b.pop();
    }
    b.data.kind = 'bars';
  } else if (kind === 'heat') {
    b.data.kind = 'heat';
  }

  // 走廊角落的铜管（materials「铜质管道」+ landmarks「墙角管道（流动黑色粘稠液体）」，「数量远少于 Level 2，
  // 但大多数走廊的角落都能找到」）：只在普通迷宫房间里放，电力房/栅栏区已经有自己的装饰
  if (kind === 'maze') {
    for (const room of g.rooms) {
      const xMin = room.i * CELL, zMin = room.j * CELL;
      const xMax = (room.i + room.w) * CELL, zMax = (room.j + room.d) * CELL;
      if (rng() < 0.55) {
        kit.prop.pipe(b, xMin + 0.35, zMin + 0.35, 0, { axis: 'y', length: H * 0.85, r: 0.06, color: 0xb5651d });
      }
      // 「有些房间内有独一无二的物体，可用来区分房间」：一半房间摆一件独特家具
      const rProp = rng();
      if (rProp < 0.5) {
        const which = U.weighted(rng, [['crate', 0.4], ['box', 0.3], ['cabinet', 0.3]]);
        const px = xMax - 0.7, pz = zMax - 0.7;
        if (which === 'crate') kit.prop.crate(b, px, pz, 0, {});
        else if (which === 'box') kit.prop.box(b, px, pz, 0, { stack: 1 + (rng() < 0.4 ? 1 : 0) });
        else kit.prop.cabinet(b, px, pz, 0, { kind: 'locker' });
      } else { rng(); }   // 占位保持每个房间固定消耗 2 次 rng（是否独特物体 + 具体种类抽签），未命中时也吃掉第二次抽签量
    }
  }

  // 罕见地标：电梯 / 木门 / 锁死的锅炉电力房门
  if (special !== 'none' && edS) {
    if (special === 'elevator4') {
      kit.exit(b, { to: '4', kind: 'elevator', x: edS.x, z: edS.z, rot: edS.rot });
    } else if (special === 'elevator5') {
      kit.exit(b, { to: '5', kind: 'elevator', x: edS.x, z: edS.z, rot: edS.rot });
    } else if (special === 'wooddoor31') {
      kit.exit(b, { to: '31', kind: 'door', x: edS.x, z: edS.z, rot: edS.rot, style: 'wood' });
    } else if (special === 'boilerdoor') {
      // hazards「装有锅炉的电力房：最高温 135°F...类似情况只有少数记录，相关区域都已封锁」
      // → 做成锁死的金属门（solid，打不开），不建可进入的高温房间本体
      kit.prop.door(b, edS.x, edS.z, edS.rot, { style: 'metal', open: 0, sign: 0xff5030 });
      doorWorld = b.world(edS.x, edS.z);
      b.data.boilerDoor = { x: doorWorld.x, z: doorWorld.z };
    }
    g.reserve(edS.i, edS.j);
  }

  // 区块级动画：发电机故障火花（hazards「机械经常故障需要维护...曾数次自燃或爆炸，重伤附近流浪者；
  // 不鲁莽行事、找安全路线就能轻易避开」）+ 锅炉门缝渗热（同上「已封锁」段）
  if (genWorld) {
    let sparkT = 6 + (cx * 131 + cz * 977) % 9;   // 不用 Math.random：用区块坐标派生一个偏移量，避免所有电力房同时打火
    b.update((dt) => {
      sparkT -= dt;
      if (sparkT <= 0) {
        sparkT = 14;
        BR.audio.play('static', genWorld, { volume: 0.5 });
        BR.gfx.flash(0xfff4c2, 0.12, 0.35);
        const P = BR.player, dx = P.x - genWorld.x, dz = P.z - genWorld.z;
        if (dx * dx + dz * dz < 2.4 * 2.4 && BR.game.attackPlayers) {
          BR.player.damage({ hp: 18, sanity: 6, source: 'hazard:generator' });
          BR.hud.toast('机器猛地炸出一团火花！', 1600);
        }
      }
    });
  }
  if (doorWorld) {
    let wasNear = false;
    b.update((dt) => {
      const P = BR.player, dx = P.x - doorWorld.x, dz = P.z - doorWorld.z;
      const near = dx * dx + dz * dz < 1.3 * 1.3;
      if (near && !wasNear) {
        BR.hud.toast('门缝里渗出灼人的热浪——有记录测到过 57℃，这间已经封锁了', 2400);
        BR.audio.play('static', doorWorld, { volume: 0.4 });
      }
      if (near && BR.game.attackPlayers) BR.player.damage({ hp: 0.4 * dt, sanity: 0, source: 'hazard:boiler-door' });
      wasNear = near;
    });
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

// ---------- 层级状态：栅栏恐惧、局部骤热、爬菌/疫疾提示、Wi-Fi 彩蛋 ----------
const BASE_SAN = 1.6;     // 依据：wikidot-cn 生存难度标 4；实体密度 high + 机械/化学多重危害，取比 Level 0 的 1.3 更高一档
const BASE_HUNGER = 1.15; // 依据 temperature「部分区域空气潮湿、厚重、难以呼吸」→ 略高于默认，非精确设定值
const ENV = {
  background: 0x1a1512, fogColor: 0x1a1512, fogNear: 5, fogFar: 32,
  ambient: { color: 0xffb060, intensity: 0.16 },   // 依据 lighting「走廊长而黑暗」→ 压得比 Level 0 更暗
  sanityDrainMul: BASE_SAN,
  hungerDrainMul: BASE_HUNGER,
  audio: 'pipes',   // sounds「处处充斥轰鸣的机器噪音；管道中流动的黑色粘稠液体是主要噪音来源之一」→ 'pipes' 预设正是锅炉低频轰+蒸汽嘶声+管道滴水回声
  darkness: false,
};

const S = { rng: null, wasInBars: false, wasInHeat: false, wifiToasted: false, floraT: 0 };

function enter(ctx) {
  S.rng = U.rng(ctx.levelSeed, 'L3-flavor');
  S.wasInBars = false; S.wasInHeat = false; S.wifiToasted = false; S.floraT = 40 + S.rng() * 40;
  ENV.sanityDrainMul = BASE_SAN; ENV.hungerDrainMul = BASE_HUNGER;
}

function update(ctx, dt) {
  const P = BR.player;
  const chunk = BR.world.chunkAt(P.x, P.z);
  const kind = chunk && chunk.res && chunk.res.data ? chunk.res.data.kind : null;

  // other「Level 3 是所有层级中 Wi-Fi 最强的一层，强度一般稳定在 3-4」：引擎没有 Wi-Fi 格数 UI（见 apiRequests），
  // 用一次性 toast 代替
  if (!S.wifiToasted) { S.wifiToasted = true; BR.hud.toast('手机信号栏跳到了满格——这里的 Wi-Fi 出奇地稳', 2200); }

  // 栅栏恐惧区：hazards「监狱栅栏密集区：强烈恐惧与极度不适，常有人感觉被监视」
  const inBars = kind === 'bars';
  if (inBars !== S.wasInBars) {
    S.wasInBars = inBars;
    ENV.sanityDrainMul = inBars ? BASE_SAN * 1.8 : BASE_SAN;
    BR.hud.prompt(inBars ? '锈迹斑斑的栅栏后面，好像有什么在盯着你看' : null);
    if (inBars) BR.audio.play('whisper', null, { volume: 0.4 });
  }

  // 局部骤热区：temperature「某些地带温度会突然升到难以忍受」
  const inHeat = kind === 'heat';
  if (inHeat !== S.wasInHeat) {
    S.wasInHeat = inHeat;
    ENV.hungerDrainMul = inHeat ? BASE_HUNGER * 1.6 : BASE_HUNGER;
    if (inHeat) { BR.hud.toast('空气突然烫得让人喘不过气……', 2000); BR.gfx.flash(0xffa050, 0.5, 0.22); }
  }

  // hazards「爬菌在此生长；高湿度让疫疾容易传播，建议保持卫生」：entity-index.json 把这两项列为 hazards
  // 而非 entities，选中版本也没给出可执行的传播/伤害规则，只做成偶发的氛围提示
  S.floraT -= dt;
  if (S.floraT <= 0) {
    S.floraT = 90 + S.rng() * 60;
    BR.hud.toast('墙角能看见类似真菌的斑块在生长——这地方湿度太高了，记得保持卫生', 2600);
  }
}

function leave() {
  ENV.sanityDrainMul = BASE_SAN; ENV.hungerDrainMul = BASE_HUNGER;
  BR.hud.prompt(null);
  S.wasInBars = false; S.wasInHeat = false;
}

BR.levels.register({
  id: '3', name: 'Level 3', title: '发电站', nickname: '',
  version: 'wikidot-cn',
  survivalClass: '4',   // 依据：页面标签含「生存难度4」（等级框三条描述词是页面未渲染的占位符，没有可读文本）
  chunkSize: SIZE,
  env: ENV,
  spawn() { return { x: SPAWN_I * CELL + CELL / 2, y: 0, z: SPAWN_J * CELL + CELL / 2, yaw: 0 }; },
  buildChunk,

  // entities：entity-index.json 里 levels 含 "3" 且本批已实现的 9 个物种（deathmoth 按其自身选中版本
  // 拆成雄/雌两个 type）。entityDensityOverall = "high"（依据：「层级充斥着大量危险实体，长距离穿行而一次不遇
  // 几乎不可能」），但选中版本没有给出各物种单独的密度数字，每个物种的 density 字段都只写"同上（合称描述）"。
  // 按 WAVE2.md 第 4 节，把 BR.config.densityWords.high(0.9) 均摊到 9 个物种上（0.9/9=0.1 每种），
  // 死亡飞蛾选中版本（wikidot-cn）明确写了"雄性和雌性都栖息于此"、没写比例 → 把物种份额 0.1 平分成雄/雌各 0.05；
  // 这样 9 个物种的密度加总仍精确等于 high 档，且不臆造"谁比谁多"的排名。
  // 说明：faceling 在自己文件里按其独立选中版本（wikidot-en）注册为 faction:'neutral'，
  // 与本层版本（wikidot-cn）把它写作 hostile 不同——按用户规则，每个实体的行为只认它自己选中的版本，
  // 层级这里只负责给密度，不覆盖其阵营。
  entities: [
    { type: 'hound', officialPer1000m2: 0.1 },
    { type: 'smiler', officialPer1000m2: 0.1 },
    { type: 'skin_stealer', officialPer1000m2: 0.1 },
    { type: 'clump', officialPer1000m2: 0.1 },
    { type: 'duller', officialPer1000m2: 0.1 },
    { type: 'wretch', officialPer1000m2: 0.1 },
    { type: 'faceling', officialPer1000m2: 0.1 },
    { type: 'burster', officialPer1000m2: 0.1 },
    { type: 'deathmoth_male', officialPer1000m2: 0.05 },
    { type: 'deathmoth_female', officialPer1000m2: 0.05 },
  ],

  // items：data/item-spawn.json 里 levels 含 "3" 且 js/items/<key>.js 已存在的条目（perLevel["3"] 优先）
  items: [
    { type: 'almond_water', per1000m2: 1.2 },       // item-spawn.json：不限层级最常见补水物（用户规则：所有模式都刷）
    { type: 'royal_rations', per1000m2: 0.3 },      // item-spawn.json perLevel["3"]=0.3：本层页面把它列入"储量丰富"资源清单，比全局默认 0.01 高很多
    { type: 'liquid_pain', per1000m2: 0.05 },       // item-spawn.json：Base Gamma 防御系统把它装胶囊当弹弓弹药，页面没给具体数字，取全局低值
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },   // item-spawn.json：稀有度 7/10，蓝色最常见
    { type: 'moth_jelly', per1000m2: 0.01 },        // item-spawn.json perLevel["3"]=0.01：死亡飞蛾多的层级都有
    { type: 'food_ration', per1000m2: 0.6 },        // 用户规则：所有模式都刷食物；选中版本没写具体食物道具，用占位口粮兜底
  ],

  exits: [
    { to: '4', kind: 'elevator', note: 'exits[0] 之一：搭乘电梯通常前往 Level 4；电梯很罕见（约 2% 的普通走廊块会摆一台）' },
    { to: '5', kind: 'elevator', note: 'exits[0] 之二：搭乘电梯通常前往 Level 5（原文一台电梯可去 4 或 5，做成两种同样罕见的独立电梯地标）' },
    { to: '31', kind: 'door', note: 'exits[1]：木门通向 Level 31；不在首期范围（0–20/fun/run），只提示"尚未开放"' },
    { to: '69', kind: 'zone', note: 'exits[2]：坐进电力房里汽车的前座会失去知觉，随后在 Level 69 醒来；不在首期范围，只提示"尚未开放"；没有真实的门/电梯实体，用车旁的触发圈近似' },
  ],
  enter, update, leave,
});
})();
