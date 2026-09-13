// 后室 · 开发测试层 Level Dev：3 m 格子的黄色迷宫 —— 同时是 BR.kit 的写法示范（js/levels/_TEMPLATE.md）
// 用途：测区块流式加载、碰撞、灯光预算、出口换层（普通 / 未开放 / 切出）、阵营战斗、构件外观。
// 不进 BR.LEVEL_ORDER，上线前删除（ARCHITECTURE.md 第 10 节）
// 来源版本：无（开发层，不对应任何设定）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;

// ---------- 尺寸 ----------
const CELL = 3;               // 格子边长（米）
const N = 8;                  // 每区块 8×8 格
const SIZE = CELL * N;        // 24 m，即 chunkSize
const H = 2.8;                // 层高：比眼高 1.62 高出一截，天花板不压头也不空旷

// ---------- 布局 ----------
// 稳态约 37% 的边有墙、长段走廊，偶尔掏房间；kit 保证块内连通、每条边界至少 2 个开口
const GRID = { wallDensity: 0.37, straightness: 0.7, roomChance: 0.55, roomSize: [2, 4], maxRooms: 2, loopChance: 0.5, pillarChance: 0.05 };
const SPAWN_I = 4, SPAWN_J = 4;       // 出生格（区块 0,0 内）
const SHOWCASE = { cx: -1, cz: 0 };   // 出生块正西那一块摆满全部构件，截图检查外观用

// ---------- 灯 ----------
const P_BROKEN = 0.06;
const P_FLICKER = 0.10;

// ---------- 出口 ----------
const EXIT_CHANCE = 0.2;
const EXIT_TINT = [0.35, 1.5, 1.25];  // 青色发光圈：在一片黄里一眼能认出来

// ---------- 材质 ----------
// 贴图边长（米）都整除 SIZE 不是必须的：kit 的世界 UV 自带跨区块对齐。
// 天花板砖缝沿 x 错开 0.3 m，正好压在灯盘两端
function defineMaterials() {
  kit.mat('dev:wall', { tex: 'wallpaper_l0', repeatMeters: 1.5, specular: 0x14120a, shininess: 6 });
  kit.mat('dev:floor', { tex: 'carpet_l0', repeatMeters: 2, specular: 0x000000, shininess: 2 });
  kit.mat('dev:ceil', { tex: 'ceiling_tile', repeatMeters: 1.2, uvOffset: [0.3, 0], specular: 0x000000, shininess: 2 });
}

// ---------- 区块 ----------
// 随机数消耗顺序固定：格子 → 灯 → 出口圈。只用传进来的 rng（经 builder），联机双方逐字节一致
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const isShow = cx === SHOWCASE.cx && cz === SHOWCASE.cz;

  const g = kit.grid(b, N, N, GRID);
  if (isSpawn) layoutSpawnRoom(b, g);
  if (isShow) g.carve(0, 0, N, N, { room: true });

  kit.gridWalls(b, g, { height: H, matKey: 'dev:wall', trim: kit.trims.yellowWood });
  kit.prop.floor(b, null, null, 0, { matKey: 'dev:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'dev:ceil', y: H });

  // 灯：每隔一格一盏（偶数行列的格子中心）
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const r = rng();
      const state = r < P_BROKEN ? 'broken' : r < P_BROKEN + P_FLICKER ? 'flicker' : 'on';
      const flicker = state === 'flicker' ? 0.35 + rng() * 0.6 : 0;
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, flicker });
    }
  }

  // 出口圈：出生块不放（出生房间里有专门的测试出口）
  const re = rng(), ei = Math.floor(rng() * N), ej = Math.floor(rng() * N);
  if (!isSpawn && re < EXIT_CHANCE) {
    const c = g.center(ei, ej);
    kit.exit(b, { to: 'dev', kind: 'zone', x: c.x, z: c.z, radius: 0.9, marker: { color: EXIT_TINT }, label: '回到 Level Dev' });
    g.reserve(ei, ej);
  }

  if (isShow) buildShowcase(b);
  kit.gridSpawns(b, g);
  return b.finish();
}

// 出生房间：3×3 格清空、四面各开一个门；西墙南段是切出墙，东墙南段是通往 Level 999（未开放）的电梯。
// 两个测试出口都离出生点 4 m 以上，且不在正北的走廊上：冒烟测试开局按 W 往北走、找开阔方向测速，都碰不到
function layoutSpawnRoom(b, g) {
  g.carve(SPAWN_I - 1, SPAWN_J - 1, 3, 3);
  g.setWall('v', SPAWN_I - 1, SPAWN_J, false);
  g.setWall('v', SPAWN_I + 2, SPAWN_J, false);
  g.setWall('h', SPAWN_I, SPAWN_J - 1, false);
  g.setWall('h', SPAWN_I, SPAWN_J + 2, false);
  g.reserve(SPAWN_I, SPAWN_J);

  // 切出墙：先拆掉那段真墙（没有碰撞体才走得进去），原位放一段会错位闪烁的墙
  const nx = (SPAWN_I - 1) * CELL, nz = (SPAWN_J + 1.5) * CELL;
  g.setWall('v', SPAWN_I - 1, SPAWN_J + 1, false);
  kit.exit(b, { to: 'dev', kind: 'noclip', x: nx, z: nz, rot: Math.PI / 2, w: CELL - 0.22, h: H, matKey: 'dev:wall', label: '切出' });
  g.reserve(SPAWN_I - 1, SPAWN_J + 1);

  // 未开放电梯：那段墙保留，电梯贴在墙的房间一侧
  const ex = (SPAWN_I + 2) * CELL - 0.12, ez = (SPAWN_J + 1.5) * CELL;
  g.setWall('v', SPAWN_I + 2, SPAWN_J + 1, true);
  kit.exit(b, { to: '999', kind: 'elevator', x: ex, z: ez, rot: -Math.PI / 2 });
  g.reserve(SPAWN_I + 1, SPAWN_J + 1);
}

// 构件展示间（区块 -1,0 整块打通）：每种构件摆一件，给 kit 改动后截图对照
function buildShowcase(b) {
  const P = kit.prop;
  const wall = { matKey: 'dev:wall', w: 2.4, h: H };
  // 第一排 z = 4
  P.box(b, 2, 4, 0, { stack: 2 });
  P.crate(b, 4, 4, 0.3, {});
  P.desk(b, 7.5, 4, 0, { monitor: true });
  P.chair(b, 7.5, 5.1, Math.PI, {});
  P.cabinet(b, 11, 4, 0, { kind: 'file' });
  P.cabinet(b, 13, 4, 0, { kind: 'wardrobe' });
  P.cabinet(b, 15, 4, 0, { kind: 'locker' });
  P.vending(b, 18, 4, 0, {});
  P.bed(b, 21.5, 4, 0, {});
  // 第二排 z = 11：门、电梯、楼梯
  P.door(b, 2, 11, 0, { style: 'wood', wall });
  P.door(b, 5, 11, 0, { style: 'metal', open: 0.5 });
  P.door(b, 8, 11, 0, { style: 'fire', sign: true });
  P.elevator(b, 12, 11, 0, { open: 0.6, wall: { matKey: 'dev:wall', w: 2.6, h: H } });
  P.stairwell(b, 16, 12.5, 0, { down: true });
  P.stairwell(b, 20, 12.5, 0, { down: false, sign: true });
  // 第三排 z = 17.5：隔间、窗、栅栏
  P.cubicle(b, 2.5, 18, 0, {});
  P.window(b, 6.5, 17.5, 0, { wall });
  P.window(b, 9.5, 17.5, 0, { blackout: true, wall });
  P.window(b, 12.5, 17.5, 0, { glow: true, wall });
  P.fence(b, 16.5, 17.5, 0, { length: 3, kind: 'chain' });
  P.fence(b, 20.5, 17.5, 0, { length: 3, kind: 'picket' });
  // 第四排 z = 21.5：地面与墙面细节
  P.puddle(b, 2.5, 21.5, 0, {});
  P.hole(b, 6, 21.5, 0, { r: 0.9 });
  P.pipe(b, 10, 21.5, 0, { axis: 'x', y: 2.4, length: 3 });
  P.pipe(b, 12, 22.5, 0, { axis: 'y', length: H });
  P.pillar(b, 14.5, 21.5, 0, { matKey: 'dev:wall', w: 0.7 });
  P.vent(b, 14.5, 21.85, 0, { y: 2.2 });
  P.vent(b, 10, 19.5, 0, { ceiling: true, y: H });
  P.streetlight(b, 17.5, 22.5, Math.PI, { h: 2.6, intensity: 0.8, range: 6 });
  P.sign(b, 21, 23.7, Math.PI, { y: 2.1 });
  { const yw = kit.trims.yellowWood; P.baseboard(b, 19.5, 23.8, Math.PI, { length: 3, h: yw.h, t: yw.t, color: yw.color, matKey: yw.matKey }); }
}

BR.levels.register({
  id: 'dev',
  name: 'Level Dev',
  title: '开发测试层',
  nickname: '',
  version: 'dev',
  survivalClass: '-',
  chunkSize: SIZE,
  env: {
    // 雾色是暗黄褐：远处的墙沉进一片昏黄里，而不是发黑
    background: 0x2b2512, fogColor: 0x2b2512,
    fogNear: 6, fogFar: 42,          // 小于载入半径 2 块（48 m），边缘区块晚几帧出现也看不见
    ambient: { color: 0xfff0c8, intensity: 0.42 },
    sanityDrainMul: 1,
    hungerDrainMul: 1,
    audio: 'fluorescent',
    darkness: false,
  },
  spawn() {
    // 区块 0,0 的出生格中心，面朝 -Z 正对北门
    return { x: SPAWN_I * CELL + CELL / 2, y: 0, z: SPAWN_J * CELL + CELL / 2, yaw: 0 };
  },
  buildChunk,
  // 测试用密度偏高（0.9/1000 m² ≈ 每块 0.52 只）：游玩满格约 13 只、地狱约 23 只，都在 maxActiveEntities 内，足够看到互打
  entities: [
    { type: '_dev_hostile', officialPer1000m2: 0.9 },
    { type: '_dev_friendly', officialPer1000m2: 0.9 },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.0 },
    { type: 'food_ration', per1000m2: 1.0 },
  ],
  exits: [
    { to: 'dev', kind: 'zone', note: '约 20% 的区块（出生块除外）地上有青色发光圈，走进去回到 Level Dev（同种子同一世界，出生点重置）' },
    { to: 'dev', kind: 'noclip', note: '出生房间西墙南段一截轻微错位闪烁的墙，贴上去切出回到 Level Dev（测切出音效与闪白）' },
    { to: '999', kind: 'elevator', note: '出生房间东墙南段的电梯；Level 999 不在首期范围，只提示"Level 999 尚未开放"（测 sealed）' },
  ],
});
})();
