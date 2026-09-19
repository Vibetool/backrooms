// Level 22 - "颓垣"（Emstable 的废墟）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-22  许可：CC BY-SA 3.0
// 原作 u/Macks1999，由 BoringTalking 重写；中文页是英文页的翻译（调研 JSON loadNote），页面挂「原文重写中」标签。
// 页面本身没给版本号/抓取日期，不编造（data/lore-choices.json levels["22"].source = "wikidot-cn"）。
//
// 只按 wikidot-cn 这一版实现，conflicts 里列的其他版本细节一律不做：
//   · 不做 fandom 版（"Merry-go-mash!" 的诗歌、旋转木马、Ruiter、森林/严寒分类）——那一版根本没有停车场；
//   · 汽车残骸按中文版「大多呈碎片状，唯一一块相对完整的是一辆 50 年代汽车的外壳」做成全层唯一一辆相对完整的车，
//     不按 wikidot-en 的「剩下的只是曾经是 50 年代汽车的外壳」（复数）；
//   · 无限性按中文版「在一定角度上无限延伸」，不按 wikidot-en 的 infinite；
//   · 生存难度用中文版渲染出来的「等级 5e - 环境危害：不安全 / 不稳定 / 非实体危害」，
//     不用 wikidot-en 那个只剩 "5e" 和 {$one}/{$two}/{$three} 占位符的难度框；
//   · 底层居民处境、逃亡方向、帐篷里尸体的程度、B.N.T.G. 通商年份，全部按中文版的说法。
//
// 引擎目前没有真正的多层结构（M13/M15 才做），Emstable 的 29 层楼只能近似成
// 「一层可玩的停车场楼面 + 上下都是塌穿的楼板洞口」，29 层楼层等级制写进返回值 notImplemented。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// =====================================================================
// 尺寸
// =====================================================================
// architecture「20 世纪多层停车场的外观」+ layout「多层停车场」：停车场是开阔结构，
// 用 _TEMPLATE.md 第 16 节开阔层的 32–48 档取下限 32 m；4 m 一格 ≈ 一个车位宽 + 一条通道的模数。
// scale 原文只写「在一定角度上无限延伸」「至少 29 层」，没有任何平面尺寸数字，所以平面尺度是近似。
const SIZE = 32;
const N = 8, CELL = SIZE / N;          // 8×8 格，每格 4 m
const H = 2.7;                         // 停车场净高：比 kit 缺省 2.8 略低一点，压得住头顶又不挡视线（原文未给，近似）

// 边界参数：全层所有区块必须完全一样（_TEMPLATE.md 7.2 节）
const EDGE = { salt: 'L22', boundaryDensity: 0.15, straightness: 0.8, minOpenings: 3 };
// layout「垮塌后……墙壁、承重柱、天花板和地板普遍失稳」：墙密度很低、而且只剩半截，
// 所以整层是「开阔楼面 + 零散的半截墙」，不是迷宫
const DECK = Object.assign({ wallDensity: 0.15, roomChance: 0, maxRooms: 0, loopChance: 0.75, pillarChance: 0 }, EDGE);
const WALL_H = 1.15;                   // 半截墙/女儿墙的高度

// 垮塌洞口（上下两种）：格子内缩 0.4 m 留一圈断茬边沿
const OPEN = 3.2, LEDGE = (CELL - OPEN) / 2;
const SHAFT_DOWN = 2.8, SHAFT_UP = 2.4;         // 洞口里能看进去多深（下一层 / 上一层的层高）
// 「垮塌堆」：爬上去才够得着天花板的洞（方锥台，和 groundAt 的公式逐字对应）
const MOUND_R = 1.9, MOUND_FLAT = 0.7, MOUND_H = 1.35;
// hazards「层内还有大量开采混凝土留下的深坑」：坑心落在格角上，正好占 2×2 格
const PIT_R = CELL, PIT_FLAT = 1.2, PIT_D = 2.0;

const SPAWN = { i: 1, j: 1 };          // 出生格（区块 0,0）
// 可读物件的触发半径：营地/车体这类地标的锚点在营地原点上，看得见的那件东西（钉着普查表的板子等）
// 离锚点能有 2 m 多，所以半径要够人走到实物跟前还在圈里。
// 注意 U.dist2 返回的是平方距离 ⇒ 比较时必须用 READ_R2（上一版直接拿 3.6 比平方距离，实际只有 1.9 m，
// 站在普查板正面根本弹不出来）
const READ_R = 3.6, READ_R2 = READ_R * READ_R;
const RUBBLE_P = 0.34;                 // 有碎石的格子占比（hazards「地面散落碎石和梁柱，步行极不安全」）

// =====================================================================
// 颜色（全部走顶点色，不为家具/车辆新建材质）
// =====================================================================
// materials「混凝土、钢筋、承重柱、梁柱、生锈覆尘的汽车残骸、超市手推车、帐篷、木头或开采混凝土搭的棚屋」；
// colors 原文是 null，所以色相按材料本身定（混凝土灰、铁锈褐、旧帆布），不是从别的版本抄来的
const C = {
  slab: 0xffffff, ceil: 0xb4b7b6, wall: 0xdedbd4, col: 0xefebe3,
  dark: 0x262724, hollow: 0x000000,
  rubbleA: 0x8e8a80, rubbleB: 0x7a766e, rubbleC: 0x9c988e,
  rebar: 0x6a4a33, steel: 0x8d9195,
  rust: 0x6d4a34, rustDark: 0x4d3628, glass: 0x2f3634,
  paint50: 0x7e9a98, chrome: 0xa8aca8,
  canvasA: 0x55604f, canvasB: 0x6a5c46, canvasC: 0x4a4f5c,
  wood: 0x6b5637, woodDark: 0x50412a,
  bay: 0xb8b1a0, paper: 0xd6d0bd, cloth: 0x6d3a33, body: 0x4a473f,
  // 「生锈覆尘的汽车残骸」：一半锈透、一半还剩点褪得看不出原色的旧车漆
  carPaint: [0x6d4a34, 0x5c4436, 0x6b6f66, 0x5a6470, 0x7a7166, 0x654a44],
};
const MAT = 'L22:concrete';

function defineMaterials() {
  // 全层只有一种混凝土材质（地板、天花板、承重柱、半截墙共用一个 mesh），开顶点色分出明暗；
  // 其余全部走 kit:prop / kit:glow ⇒ 每块 3 个 mesh（有切出面的 4 个），远低于第 16 节的 8 个上限
  kit.mat(MAT, { tex: 'concrete', repeatMeters: 3, roughness: 0.96, vertexColors: true });
}

// =====================================================================
// 确定性地形（buildChunk 与地面高度函数共用，不吃区块 rng）
// =====================================================================
const S = {
  seed: 0, terrain: new Map(), timer: 0, stumble: 0, pitTick: 0, quakeAt: 28, read: new Set(), readTick: 0, readHold: 0,
};

function useSeed(ctx) {
  const sd = ctx && ctx.levelSeed;
  if (S.seed !== sd) { S.seed = sd; S.terrain.clear(); }
}
function cellC(i, j) { return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL }; }

// 每块一处垮塌洞口：(cx+cz) 偶数朝上（天花板破洞 → Level 21）、奇数朝下（楼板破洞 → Level 23）。
// 周期重复 ⇒ 站在任何地方，最多走一个区块就能同时找到上行和下行的洞（_TEMPLATE 第 9 节：出口要找得到）
function terrain(cx, cz) {
  const key = cx + ',' + cz;
  const hit = S.terrain.get(key);
  if (hit) return hit;
  const r = U.rng(S.seed, 'L22-terrain', cx, cz);
  const up = (((cx + cz) % 2) + 2) % 2 === 0;
  const ci = 1 + Math.floor(r() * (N - 2)), cj = 1 + Math.floor(r() * (N - 2));
  const hasPit = r() < 0.55;
  const pi = 1 + Math.floor(r() * (N - 1)), pj = 1 + Math.floor(r() * (N - 1));
  const hasBlock = r() < 0.3;
  const bi = 2 + Math.floor(r() * (N - 5)), bj = 2 + Math.floor(r() * (N - 5));
  const isSpawn = cx === 0 && cz === 0;
  const t = {
    breach: up ? { i: ci, j: cj } : null,            // 天花板洞口 + 底下的垮塌堆
    hole: up ? null : { i: ci, j: cj },              // 楼板洞口
    pit: hasPit ? { i: pi, j: pj, x: pi * CELL, z: pj * CELL } : null,
    block: hasBlock ? { i: bi, j: bj } : null,       // 2×2 格进不去的垮塌区
  };
  if (isSpawn) {
    // 出生块固定摆：东偏一点 16 m 处一个下行洞口（放在两排车位之间的通道上，不被停着的车挡住）、
    // 正南 16 m 一个上行洞口，开局四下一看就知道往哪走；深坑与垮塌区都挪开，免得出生就掉进坑里
    t.hole = { i: 5, j: 2 };
    t.breach = { i: 1, j: 5 };
    t.pit = { i: 6, j: 6, x: 6 * CELL, z: 6 * CELL };
    t.block = { i: 2, j: 6 };
  }
  S.terrain.set(key, t);
  return t;
}

// 地面高度：「楼板洞口（空的）」「垮塌堆」「开采深坑」三种起伏，其余一律 0。
// 三者的水平尺度都 ≤ 一格，定位又都在块内，所以只查玩家所在区块，不用看邻块
function groundAt(x, z) {
  const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
  const t = terrain(cx, cz);
  const lx = x - cx * SIZE, lz = z - cz * SIZE;
  // 楼板洞口底下是空的：洞口那一格的地面就是井底，踩上去要掉下去 —— 上一版这里返回 0，
  // 人会从 3.2 m 见方的洞上面凌空走过去（'23' 进 LEVEL_ORDER 之后，半径 2.0 m 的出口圈会先换层，
  // 走不到洞里；sealed 的时候掉进井里也爬得回来：井壁是 plane、不是碰撞体，往外走地面就回到 0）
  if (t.hole) {
    const c = cellC(t.hole.i, t.hole.j);
    if (Math.max(Math.abs(lx - c.x), Math.abs(lz - c.z)) < OPEN / 2) return -SHAFT_DOWN;
  }
  if (t.pit) {
    const d = Math.max(Math.abs(lx - t.pit.x), Math.abs(lz - t.pit.z));
    if (d < PIT_R) return -PIT_D * U.clamp((PIT_R - d) / (PIT_R - PIT_FLAT), 0, 1);
  }
  if (t.breach) {
    const c = cellC(t.breach.i, t.breach.j);
    const d = Math.max(Math.abs(lx - c.x), Math.abs(lz - c.z));
    if (d < MOUND_R) return MOUND_H * U.clamp((MOUND_R - d) / (MOUND_R - MOUND_FLAT), 0, 1);
  }
  return 0;
}

// 碎石格：同一个哈希既决定摆不摆碎石，也决定 update 里绊不绊得着人 —— 看见的和踩到的是同一份数据
function rubbleVal(gx, gz) { return U.rng(S.seed, 'L22-rubble', gx, gz)(); }

function inPit(t, i, j) { return !!t.pit && (i === t.pit.i - 1 || i === t.pit.i) && (j === t.pit.j - 1 || j === t.pit.j); }
function inBlock(t, i, j) { return !!t.block && i >= t.block.i && i < t.block.i + 2 && j >= t.block.j && j < t.block.j + 2; }
function isCut(t, i, j) {
  return (!!t.hole && t.hole.i === i && t.hole.j === j) || (!!t.breach && t.breach.i === i && t.breach.j === j);
}
function cellBusy(t, i, j, isSpawn) {
  if (isCut(t, i, j) || inPit(t, i, j) || inBlock(t, i, j)) return true;
  if (isSpawn && i <= SPAWN.i + 1 && j <= SPAWN.j + 1) return true;
  return false;
}

// =====================================================================
// 楼板 / 天花板 / 洞口
// =====================================================================
// 按格铺板：深坑那 2×2 格不铺（方锥自带面），洞口那一格铺成一圈 0.4 m 的断茬边沿
function slab(b, t, y, facing, color) {
  const cut = facing === 'up' ? t.hole : t.breach;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = cellC(i, j);
      if (facing === 'up' && inPit(t, i, j)) continue;
      if (cut && cut.i === i && cut.j === j) {
        const o = OPEN / 2, e = CELL / 2;
        b.plane(c.x, y, c.z - (o + e) / 2, CELL, LEDGE, MAT, { facing, color });
        b.plane(c.x, y, c.z + (o + e) / 2, CELL, LEDGE, MAT, { facing, color });
        b.plane(c.x - (o + e) / 2, y, c.z, LEDGE, OPEN, MAT, { facing, color });
        b.plane(c.x + (o + e) / 2, y, c.z, LEDGE, OPEN, MAT, { facing, color });
        continue;
      }
      b.plane(c.x, y, c.z, CELL, CELL, MAT, { facing, color });
    }
  }
}

// 洞口的井壁 + 尽头的黑：up = 往上看进上一层，down = 往下看进下一层
function shaft(b, x, z, up) {
  const o = OPEN / 2, d = up ? SHAFT_UP : SHAFT_DOWN, y0 = up ? H : -SHAFT_DOWN;
  b.plane(x, y0, z - o, OPEN, d, MAT, { facing: '+z', color: C.dark });
  b.plane(x, y0, z + o, OPEN, d, MAT, { facing: '-z', color: C.dark });
  b.plane(x - o, y0, z, OPEN, d, MAT, { facing: '+x', color: C.dark });
  b.plane(x + o, y0, z, OPEN, d, MAT, { facing: '-x', color: C.dark });
  b.plane(x, up ? H + SHAFT_UP : -SHAFT_DOWN, z, OPEN, OPEN, 'kit:glow',
    { facing: up ? 'down' : 'up', uv: 'solid', color: C.hollow });
}

// 断茬边沿上垂下来的钢筋（materials「钢筋」）：楼板洞口从边沿往下垂，天花板洞口从顶上往下垂
function rebarFringe(b, x, z, y, rng) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rng() * 0.3;
    const rr = OPEN / 2 - 0.03;
    const len = 0.3 + rng() * 0.45;
    b.box(x + Math.cos(a) * rr, y - len, z + Math.sin(a) * rr, 0.025, len, 0.025,
      'kit:prop', { color: C.rebar, solid: false, rotY: a });
  }
}

// 垮塌堆（方锥台，公式与 groundAt 完全一致）
function mound(b, x, z, rng) {
  const R = MOUND_R, r0 = MOUND_FLAT, Hm = MOUND_H;
  for (let k = 0; k < 4; k++) {
    b.push(x, z, k * Math.PI / 2);
    b.quad([R, 0, -R], [-R, 0, -R], [-r0, Hm, -r0], [r0, Hm, -r0], MAT, { color: C.rubbleB });
    b.pop();
  }
  b.plane(x, Hm, z, r0 * 2, r0 * 2, MAT, { facing: 'up', color: C.rubbleB });
  // 堆上散的混凝土块与掰断的楼板碎片：贴着斜面摆，不给碰撞体（真正挡不挡人由地面高度函数说了算）
  for (let k = 0; k < 16; k++) {
    const a = rng() * Math.PI * 2, rr = rng() * (R - 0.15);
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    const hy = Hm * U.clamp((R - Math.max(Math.abs(px - x), Math.abs(pz - z))) / (R - r0), 0, 1);
    const big = k % 5 === 0;
    const s = big ? 0.7 + rng() * 0.7 : 0.16 + rng() * 0.32;
    b.box(px, hy - (big ? 0.06 : 0), pz, s, big ? 0.16 : s * 0.62, s * (big ? 0.75 : 0.85), big ? MAT : 'kit:prop',
      { color: k % 3 === 0 ? C.rubbleA : k % 3 === 1 ? C.rubbleC : C.rubbleB, rotY: rng() * Math.PI, solid: false });
    if (big) b.box(px, hy, pz, 0.03, 0.3 + rng() * 0.3, 0.03, 'kit:prop', { color: C.rebar, rotY: rng() * Math.PI, solid: false });
  }
}

// 开采深坑（倒方锥台）：hazards「内部有大量深坑（原采矿点）；理论上可攀爬，但自由攀爬非常危险」
function pit(b, px, pz, rng) {
  const R = PIT_R, r0 = PIT_FLAT, D = PIT_D;
  for (let k = 0; k < 4; k++) {
    b.push(px, pz, k * Math.PI / 2);
    b.quad([R, 0, -R], [-R, 0, -R], [-r0, -D, -r0], [r0, -D, -r0], MAT, { color: C.rubbleB });
    b.pop();
  }
  b.plane(px, -D, pz, r0 * 2, r0 * 2, MAT, { facing: 'up', color: C.rubbleA });
  for (let k = 0; k < 14; k++) {
    const a = rng() * Math.PI * 2, rr = rng() * (R - 0.5);
    const qx = px + Math.cos(a) * rr, qz = pz + Math.sin(a) * rr;
    const hy = -D * U.clamp((R - Math.max(Math.abs(qx - px), Math.abs(qz - pz))) / (R - r0), 0, 1);
    const s = 0.2 + rng() * 0.36;
    b.box(qx, hy, qz, s, s * 0.55, s * 0.9, 'kit:prop',
      { color: k % 3 === 0 ? C.rubbleA : k % 3 === 1 ? C.rubbleC : C.rubbleB, rotY: rng() * Math.PI, solid: false });
    // 采面上露出来的钢筋头
    if (k % 4 === 0) b.box(qx, hy, qz, 0.03, 0.25 + rng() * 0.3, 0.03, 'kit:prop', { color: C.rebar, rotY: rng() * Math.PI, solid: false });
  }
  // 坑底扔着的镐子：items「镐子：由另一层给 Emstable 供应」「居民开采层内混凝土」
  if (rng() < 0.6) pickaxe(b, px + 0.4, pz - 0.3, rng() * Math.PI, -D);
}

// =====================================================================
// 结构件
// =====================================================================
// 承重柱：每 8 m 一根（x、z = 0/8/16/24），跨区块接得上；洞口、深坑、垮塌区那几格只剩断柱
function columns(b, t, rng) {
  for (let jj = 0; jj < 4; jj++) {
    for (let ii = 0; ii < 4; ii++) {
      const x = ii * 8, z = jj * 8;
      const r = rng();
      const ci = U.clamp(Math.floor(x / CELL), 0, N - 1), cj = U.clamp(Math.floor(z / CELL), 0, N - 1);
      const broken = r < 0.22 || isCut(t, ci, cj) || inPit(t, ci, cj);
      if (inPit(t, ci, cj)) continue;                       // 坑里没柱子（柱基早被挖掉了）
      if (broken) {
        const hh = 0.7 + rng() * 0.8;                       // layout「承重柱……普遍失稳」：断成半截
        b.box(x, 0, z, 0.55, hh, 0.55, MAT, { faces: 'noBottom', color: C.col, solid: true });
        for (let k = 0; k < 3; k++) {
          b.box(x + (rng() - 0.5) * 1.4, hh, z + (rng() - 0.5) * 1.4, 0.03, 0.3 + rng() * 0.3, 0.03,
            'kit:prop', { color: C.rebar, solid: false });
        }
      } else {
        b.box(x, 0, z, 0.55, H, 0.55, MAT, { faces: 'sides', color: C.col, solid: true });
      }
    }
  }
}

// 车位线（architecture「看似普通的停车场」）：两排车位，每 2.6 m 一道褪色白漆
function bayLines(b, t) {
  const rows = [1, 5];
  for (const rj of rows) {
    const z0 = rj * CELL;
    for (let k = 0; k < 12; k++) {
      const x = 1.3 + k * 2.6;
      if (x > SIZE - 0.6) continue;
      const i = U.clamp(Math.floor(x / CELL), 0, N - 1);
      if (isCut(t, i, rj) || isCut(t, i, rj + 1) || inPit(t, i, rj) || inPit(t, i, rj + 1)) continue;
      if (inBlock(t, i, rj) || inBlock(t, i, rj + 1)) continue;
      b.plane(x, 0.012, z0 + 2.4, 0.12, 4.8, 'kit:prop', { facing: 'up', color: C.bay, solid: false });
    }
  }
}

// 进不去的垮塌区：layout「大部分区域要么无法以正常方式进入，要么难以进入且危险」
function collapseBlock(b, i0, j0, rng) {
  const x0 = i0 * CELL, z0 = j0 * CELL;
  for (let k = 0; k < 14; k++) {
    const x = x0 + 0.4 + rng() * (CELL * 2 - 0.8), z = z0 + 0.4 + rng() * (CELL * 2 - 0.8);
    const w = 1.1 + rng() * 1.6, d = 1.1 + rng() * 1.6, hh = 1.2 + rng() * (H - 1.2);
    b.box(x, 0, z, w, hh, d, MAT, { faces: 'noBottom', color: k % 3 ? C.rubbleA : C.rubbleB, rotY: rng() * Math.PI, solid: true });
  }
  // 斜插进去的梁：hazards「地面散落碎石和梁柱」
  for (let k = 0; k < 3; k++) {
    const x = x0 + 1 + rng() * (CELL * 2 - 2), z = z0 + 1 + rng() * (CELL * 2 - 2);
    b.box(x, 1.4 + rng() * 0.6, z, 0.45, 0.4, 3.4 + rng() * 1.6, MAT,
      { color: C.rubbleB, rotY: rng() * Math.PI, solid: false });
  }
}

// 散落的碎石与钢筋（和 update 里的绊倒判定共用 rubbleVal）
function rubbleCell(b, gx, gz, i, j) {
  const r = U.rng(S.seed, 'L22-rubble-d', gx, gz);
  const c = cellC(i, j);
  const n = 3 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const x = c.x + (r() - 0.5) * (CELL - 0.6), z = c.z + (r() - 0.5) * (CELL - 0.6);
    const s = 0.16 + r() * 0.34;
    b.box(x, 0, z, s, s * 0.55, s * 0.8, 'kit:prop',
      { color: k % 3 === 0 ? C.rubbleC : k % 3 === 1 ? C.rubbleA : C.rubbleB, rotY: r() * Math.PI, solid: false });
  }
  if (r() < 0.45) {
    const x = c.x + (r() - 0.5) * 2, z = c.z + (r() - 0.5) * 2;
    b.box(x, 0.02, z, 0.028, 0.5 + r() * 0.5, 0.028, 'kit:prop', { color: C.rebar, rotY: r() * Math.PI, solid: false });
  }
  if (r() < 0.25) {
    // 掉下来的梁
    const x = c.x + (r() - 0.5) * 1.6, z = c.z + (r() - 0.5) * 1.6;
    b.box(x, 0, z, 0.38, 0.34, 2.6 + r() * 1.4, MAT, { color: C.rubbleB, rotY: r() * Math.PI, solid: true });
  }
}

// =====================================================================
// 车辆与生活痕迹
// =====================================================================
// 汽车残骸：landmarks「锈蚀覆尘、多呈碎片状的汽车残骸」。车身长边沿本地 z，rot = 0 车头朝 +Z。
// hollow = true 时不给碰撞体（切出用：mechanics「通过汽车或瓦砾成功切出可前往 Level 817」）
function car(b, x, z, rot, rng, style, hollow) {
  b.push(x, z, rot);
  const solid = !hollow;
  const paint = U.pick(rng, C.carPaint);       // 「覆尘」的褪色旧车漆，一半以上已经锈透
  if (style === 'shell50') {
    // landmarks「唯一一块相对完整的是一辆 50 年代汽车的外壳」：
    // 低车身 + 前后缩短的引擎盖/行李箱 + 中后段的驾驶室 + 尾鳍与镀铬保险杠，架在混凝土垛上（轮子早没了）
    b.box(0, 0.38, 0, 1.86, 0.44, 4.5, 'kit:prop', { color: C.paint50, solid });          // 车身主体
    b.box(0, 0.82, 1.42, 1.72, 0.2, 1.6, 'kit:prop', { color: C.paint50, solid: false }); // 引擎盖
    b.box(0, 0.82, -1.62, 1.72, 0.22, 1.2, 'kit:prop', { color: C.paint50, solid: false }); // 行李箱
    b.box(0, 0.82, -0.25, 1.62, 0.56, 2.0, 'kit:prop', { color: C.paint50, solid: false }); // 驾驶室
    b.box(0, 0.94, -0.25, 1.68, 0.3, 1.66, 'kit:prop', { color: C.glass, solid: false });   // 一圈车窗
    b.box(0, 1.38, -0.3, 1.5, 0.06, 1.7, 'kit:prop', { color: C.paint50, solid: false });   // 车顶
    for (const sx of [-0.8, 0.8]) b.box(sx, 1.04, -2.0, 0.16, 0.36, 0.7, 'kit:prop', { color: C.paint50, solid: false });  // 尾鳍
    for (const sz of [2.28, -2.24]) b.box(0, 0.3, sz, 1.9, 0.16, 0.1, 'kit:prop', { color: C.chrome, solid: false });      // 保险杠
    b.box(0, 0.16, 0, 1.92, 0.06, 4.1, 'kit:prop', { color: C.chrome, solid: false });      // 侧面镀铬饰条
    for (const sx of [-0.72, 0.72]) for (const sz of [-1.7, 1.7]) b.box(sx, 0, sz, 0.44, 0.4, 0.44, MAT, { color: C.rubbleA, solid: false });
  } else if (style === 'frame') {
    // 只剩底盘和一半车身的骨架
    b.box(0, 0.34, 0, 1.75, 0.34, 3.9, 'kit:prop', { color: C.rustDark, solid });
    b.box(0, 0.68, 1.0, 1.6, 0.5, 1.3, 'kit:prop', { color: C.rust, solid: false });
    for (let k = 0; k < 4; k++) b.box(-0.8 + k * 0.53, 0.68, -0.9, 0.05, 0.6, 0.05, 'kit:prop', { color: C.rebar, solid: false });
    b.cylinder(-0.85, 0.3, 1.4, 0.3, 0.2, 'kit:prop', { axis: 'x', segments: 6, color: C.rustDark, solid: false });
  } else {
    b.box(0, 0.3, 0, 1.8, 0.4, 4.1, 'kit:prop', { color: paint, solid });                   // 车身
    b.box(0, 0.7, 1.28, 1.66, 0.18, 1.4, 'kit:prop', { color: paint, solid: false });       // 引擎盖
    b.box(0, 0.7, -1.5, 1.66, 0.2, 1.0, 'kit:prop', { color: paint, solid: false });        // 行李箱
    b.box(0, 0.7, -0.25, 1.58, 0.52, 1.8, 'kit:prop', { color: C.rustDark, solid: false }); // 驾驶室（玻璃早碎光了）
    b.box(0.15, 1.18, -0.3, 1.36, 0.06, 1.5, 'kit:prop', { color: paint, rotY: 0.07, solid: false });  // 压扁歪掉的车顶
    for (const sx of [-0.78, 0.78]) {
      for (const sz of [-1.45, 1.45]) {
        if (rng() < 0.35) continue;                                   // 轮子丢了一两个
        b.cylinder(sx, 0.22, sz, 0.3, 0.2, 'kit:prop', { axis: 'x', segments: 6, color: C.rubbleB, solid: false });
      }
    }
  }
  b.pop();
}

// 超市手推车：items「汽车与超市手推车……原本满载建筑材料和食物」
function cart(b, x, z, rot, tipped) {
  b.push(x, z, rot);
  if (tipped) {
    b.box(0, 0.12, 0, 0.62, 0.24, 0.92, 'kit:prop', { color: C.steel, solid: false });
    b.box(0, 0.3, -0.42, 0.58, 0.36, 0.05, 'kit:prop', { color: C.steel, solid: false });
  } else {
    b.box(0, 0.4, 0, 0.6, 0.45, 0.9, 'kit:prop', { color: C.steel, solid: true });
    b.box(0, 0.86, -0.46, 0.56, 0.06, 0.05, 'kit:prop', { color: C.steel, solid: false });
    for (const sx of [-0.24, 0.24]) for (const sz of [-0.36, 0.36]) b.box(sx, 0, sz, 0.06, 0.18, 0.06, 'kit:prop', { color: C.rubbleB, solid: false });
  }
  b.pop();
}

// 帐篷：materials「帐篷」；landmarks「废弃帐篷，尤其低楼层的帐篷里装满前 Emstable 居民的尸体」
function tent(b, x, z, rot, rng, color, corpse) {
  b.push(x, z, rot);
  const w = 1.1, l = 1.3, hh = 1.15;
  // 两片斜屋面（顶点顺序按外侧逆时针，法线朝外上方）
  b.quad([w, 0, l], [w, 0, -l], [0, hh, -l], [0, hh, l], 'kit:prop', { color, solid: false });
  b.quad([-w, 0, -l], [-w, 0, l], [0, hh, l], [0, hh, -l], 'kit:prop', { color, solid: false });
  // 两头的三角（用退化四边形当三角形，零面积的那条边不产生多余像素）
  b.quad([w, 0, -l], [-w, 0, -l], [0, hh, -l], [0, hh, -l], 'kit:prop', { color, solid: false });
  b.quad([-w, 0, l], [w, 0, l], [0, hh, l], [0, hh, l], 'kit:prop', { color, solid: false });
  b.box(0, 0, 0, 2 * w + 0.1, 0.06, 2 * l + 0.1, 'kit:prop', { color: C.rubbleB, solid: false });
  if (corpse) {
    // 裹在睡袋里的遗骸：不做人形，只做一个盖住的形状（NPC/尸体构件引擎没有，写进 apiRequests）
    b.box(0, 0.06, 0, 0.52, 0.3, 1.7, 'kit:prop', { color: C.body, rotY: (rng() - 0.5) * 0.3, solid: false });
  } else if (rng() < 0.6) {
    b.box(0, 0.06, 0.3, 0.5, 0.18, 1.5, 'kit:prop', { color: C.canvasB, solid: false });   // 空睡袋
  }
  b.pop();
}

// 棚屋：materials「木头或开采混凝土搭的棚屋」
function shack(b, x, z, rot, rng) {
  b.push(x, z, rot);
  const w = 1.5, d = 1.2, hh = 1.45;
  for (let k = 0; k < 5; k++) {
    b.box(-w + k * (2 * w / 4), 0, -d, 0.3, hh - rng() * 0.35, 0.09, 'kit:prop', { color: k % 2 ? C.wood : C.woodDark, solid: true });
  }
  for (let k = 0; k < 3; k++) {
    b.box(-w + 0.15, 0, -d + 0.4 + k * 0.4, 0.09, hh - 0.2, 0.35, 'kit:prop', { color: C.woodDark, solid: true });
  }
  // 开采混凝土砌的半截侧墙
  for (let k = 0; k < 3; k++) b.box(w - 0.2, k * 0.3, -d + 0.5 + k * 0.1, 0.35, 0.3, 1.5, MAT, { color: C.rubbleA, solid: true });
  b.quad([-w - 0.2, hh, -d - 0.2], [w + 0.2, hh, -d - 0.2], [w + 0.2, hh - 0.35, d + 0.2], [-w - 0.2, hh - 0.35, d + 0.2],
    'kit:prop', { color: C.woodDark, solid: false });
  b.pop();
}

function pickaxe(b, x, z, rot, y) {
  b.push(x, z, rot, y || 0);
  b.box(0, 0.05, 0, 0.05, 0.05, 0.86, 'kit:prop', { color: C.wood, solid: false });
  b.box(0, 0.07, -0.4, 0.62, 0.06, 0.07, 'kit:prop', { color: C.steel, solid: false });
  b.pop();
}

// =====================================================================
// 地标与可读物件
// =====================================================================
// 引擎没有「可读文档」道具（写进 apiRequests）：做成看得见的实物 + 走近了弹提示
function addRead(b, x, z, lines) {
  const w = b.world(x, z);
  if (!b.data.reads) b.data.reads = [];
  b.data.reads.push({ x: w.x, z: w.z, lines });
}

// 人口普查报告：landmarks「在 Emstable 顶层发现的第十层人口普查报告（01/07/10，总人口 26,158）」
function censusCamp(b, x, z, rot, rng) {
  b.push(x, z, rot);
  tent(b, -1.6, 0.4, 0.3, rng, C.canvasA, false);
  kit.prop.crate(b, 0.5, 0, 0.2, { size: 0.7, color: C.wood });
  kit.prop.desk(b, 1.8, -0.6, Math.PI, { w: 1.3, d: 0.65, color: C.woodDark });
  // 钉在板子上的普查表
  b.box(1.8, 0.78, -0.95, 1.1, 0.02, 0.62, 'kit:prop', { color: C.paper, solid: false });
  b.box(1.8, 0, -1.3, 1.2, 1.5, 0.06, 'kit:prop', { color: C.woodDark, solid: true });
  b.box(1.8, 0.9, -1.27, 0.9, 0.55, 0.01, 'kit:prop', { color: C.paper, solid: false });
  cart(b, 3.2, 0.8, 0.6, false);
  b.pop();
  addRead(b, x, z, [
    '复原文件：Emstable 第十次人口普查报告（01/07/10）',
    '逐层列出人数与指定物资；总人口 26,158，第 28 层 0 人（-1,760），第 29 层全是 N/A',
  ]);
}

// 「Hilda」日记三页：landmarks / items「日志［经复原］：「Hilda」，属于 Jacobs Opal，收录三页」
function hildaCamp(b, x, z, rot, rng) {
  b.push(x, z, rot);
  tent(b, 0, 0, 0, rng, C.canvasC, false);
  shack(b, 3.1, -0.6, -0.5, rng);
  kit.prop.box(b, -2.2, 0.6, 0.2, { stack: 2, color: C.canvasB });
  pickaxe(b, 2.0, 1.2, 0.8, 0);
  const pages = [[-1.5, 1.4], [0.6, 1.6], [2.2, -1.5]];
  for (const p of pages) {
    b.box(p[0], 0.015, p[1], 0.3, 0.012, 0.42, 'kit:prop', { color: C.paper, rotY: rng() * Math.PI, solid: false });
    b.box(p[0] + 0.06, 0.03, p[1] + 0.05, 0.12, 0.08, 0.12, 'kit:prop', { color: C.rubbleA, solid: false });
  }
  b.pop();
  const wp = [
    ['「Hilda」第一页（02/08/2014）', '交够了上贡的混凝土，一家人又往上搬了一层'],
    ['「Hilda」第二页（06/08/2014）', '镐子还是别的层级供的，这回对方给打了折'],
    ['「Hilda」第三页（30/10/2015）', '目标是二十层，可家里人一个接一个地散了'],
  ];
  for (let k = 0; k < 3; k++) {
    const lp = pages[k];
    const px = x + lp[0] * Math.cos(rot) + lp[1] * Math.sin(rot);
    const pz = z - lp[0] * Math.sin(rot) + lp[1] * Math.cos(rot);
    addRead(b, px, pz, [wp[k][0] + ' —— 复原后由卡拉格灵协会持有', wp[k][1]]);
  }
}

// Emstable 的旗帜：landmarks「Emstable 的旗帜」（原文没写图案与颜色，只做一面褪色旧布，不编纹章）
function flagPost(b, x, z, rot) {
  b.push(x, z, rot);
  b.box(0, 0, 0, 0.1, 2.5, 0.1, 'kit:prop', { color: C.steel, solid: true });
  b.box(0.62, 2.16, 0, 1.2, 0.05, 0.05, 'kit:prop', { color: C.steel, solid: false });      // 横杆：旗是吊上去的
  b.box(0.46, 1.4, 0, 0.82, 0.76, 0.02, 'kit:prop', { color: C.cloth, solid: false });      // 旗面（垂下来的两段，中间有一道折）
  b.box(1.06, 1.36, 0.06, 0.4, 0.68, 0.02, 'kit:prop', { color: C.cloth, rotY: 0.22, solid: false });
  b.box(0.35, 0, -0.5, 0.7, 0.35, 0.7, MAT, { color: C.rubbleA, solid: true });
  b.pop();
  addRead(b, x, z, [
    'Emstable 的旗帜 —— 国名由 embattle 与 stable（停车场的同义词）生造',
    '1987 年宣称建国，1990 年封死大部分入口，与外界只剩贸易往来',
  ]);
}

// 装着旧胶片相机的帐篷：landmarks「一间帐篷里的旧胶片相机，内含崩溃前仅有的已知图像之一」
function cameraTent(b, x, z, rot, rng) {
  b.push(x, z, rot);
  tent(b, 0, 0, 0, rng, C.canvasB, false);
  kit.prop.crate(b, 1.5, 0.2, -0.3, { size: 0.6, color: C.wood });
  b.push(1.5, 0.2, -0.3, 0.62);
  b.box(0, 0.6, 0, 0.26, 0.16, 0.14, 'kit:prop', { color: 0x2c2b28, solid: false });
  b.cylinder(0, 0.68, 0.08, 0.05, 0.08, 'kit:prop', { axis: 'z', segments: 8, color: 0x1b1b19, solid: false });
  b.box(0.08, 0.76, 0, 0.06, 0.05, 0.06, 'kit:prop', { color: C.chrome, solid: false });
  b.pop();
  b.pop();
  addRead(b, x, z, [
    '帐篷里有一台旧胶片相机，胶卷还在里面',
    '这是 Emstable 崩溃之前仅有的已知图像之一',
  ]);
}

// 50 年代汽车的外壳（全层唯一相对完整的一辆）：同时是 mechanics「通过汽车切出可前往 Level 817」的位置
function car50(b, x, z, rot, rng) {
  car(b, x, z, rot, rng, 'shell50', true);
  addRead(b, x, z, [
    '一辆 50 年代汽车的外壳 —— 这里唯一一块还算完整的车体',
    '车身另一侧的空气有点不对劲，像是可以直接挤过去',
  ]);
  return { x: x + 1.15 * Math.cos(rot), z: z - 1.15 * Math.sin(rot), rot: rot + Math.PI / 2 };
}

function buildLandmark(b, kind, i, j, rng) {
  const c = cellC(i, j), rot = rng() * Math.PI * 2;
  if (kind === 'census') { censusCamp(b, c.x, c.z, rot, rng); return null; }
  if (kind === 'hilda') { hildaCamp(b, c.x, c.z, rot, rng); return null; }
  if (kind === 'flag') { flagPost(b, c.x, c.z, rot); return null; }
  if (kind === 'camera') { cameraTent(b, c.x, c.z, rot, rng); return null; }
  return car50(b, c.x, c.z, rot, rng);      // 'car50'：返回切出面的位置
}

// 每 2×2 个区块一处地标（约 64 m 一处），种类在五种之间轮换
const LM_KINDS = [['census', 1], ['hilda', 1], ['flag', 1], ['camera', 1], ['car50', 1]];
function macroLandmark(cx, cz) {
  const mx = Math.floor(cx / 2), mz = Math.floor(cz / 2);
  const mr = U.rng(S.seed, 'L22-landmark', mx, mz);
  const kind = U.weighted(mr, LM_KINDS);
  const hx = mx * 2 + Math.floor(mr() * 2), hz = mz * 2 + Math.floor(mr() * 2);
  const i = 1 + Math.floor(mr() * (N - 2)), j = 1 + Math.floor(mr() * (N - 2));
  return { kind, cx: hx, cz: hz, i, j };
}

// 出生块：被混凝土封死的玻璃门。entrances「在 Level 1 内找到玻璃门（原始入口，少见）」+
// exits 注释「没有找到崩溃前存在的原始出口，Level 1 只能进不能出」—— 所以这里只是个地标，不是出口
function sealedGlassDoor(b, x, z, rot) {
  b.push(x, z, rot);
  b.box(0, 0, 0, 2.4, H, 0.28, MAT, { faces: 'sides', color: C.wall, solid: true });
  b.box(0, 0, 0.16, 1.5, 2.2, 0.08, 'kit:prop', { color: C.steel, solid: false });          // 门框
  b.box(0, 0.06, 0.21, 1.3, 2.08, 0.03, 'kit:glass', { color: 0x9fb4ae, solid: false });    // 还留着的玻璃
  b.box(0, 1.06, 0.2, 0.06, 2.0, 0.04, 'kit:prop', { color: C.steel, solid: false });       // 中梃（双开玻璃门）
  // 从这一侧砌死：六层错缝的开采混凝土砌块（每层三块，错缝摆），最上面一层没砌满，露出一条玻璃
  for (let k = 0; k < 6; k++) {
    const off = (k % 2 ? 0.11 : -0.11);
    for (let m = 0; m < 3; m++) {
      if (k === 5 && m === 2) continue;                                   // 最上一层缺一块
      const bw = 0.46 + (m === 1 ? 0.06 : 0);
      b.box(off + (m - 1) * 0.47, k * 0.31, 0.31 + (m === 1 ? 0.02 : 0), bw, 0.29, 0.3, MAT,
        { color: (k + m) % 3 === 0 ? C.rubbleA : (k + m) % 3 === 1 ? C.rubbleC : C.rubbleB, solid: true });
    }
  }
  b.pop();
  addRead(b, x + 0.8, z, [
    '你进来的那扇玻璃门，从这一侧被混凝土砌死了',
    'Emstable 当年封堵了大部分入口 —— 崩溃前的原始出口，一个都没再找到',
  ]);
}

// =====================================================================
// 区块
// =====================================================================
// rng 消耗顺序固定：格子 → 柱子 → 垮塌区 → 洞口 → 深坑 → 碎石 → 车辆/生活痕迹 → 地标 → 灯 → 切出
function buildChunk(ctx, cx, cz, rng) {
  useSeed(ctx);
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const t = terrain(cx, cz);
  const isSpawn = cx === 0 && cz === 0;

  // ---- 格子（先清干净再砌墙：_TEMPLATE 硬规则）----
  const g = kit.grid(b, N, N, DECK);
  if (t.hole) { g.carve(t.hole.i, t.hole.j, 1, 1); g.reserve(t.hole.i, t.hole.j); }
  if (t.breach) { g.carve(t.breach.i, t.breach.j, 1, 1); g.reserve(t.breach.i, t.breach.j); }
  if (t.pit) {
    g.carve(t.pit.i - 1, t.pit.j - 1, 2, 2);
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) g.reserve(t.pit.i + di, t.pit.j + dj);
  }
  if (t.block) {
    g.carve(t.block.i, t.block.j, 2, 2);
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) g.reserve(t.block.i + di, t.block.j + dj);
  }
  if (isSpawn) { g.carve(SPAWN.i - 1, SPAWN.j - 1, 3, 3); g.reserve(SPAWN.i, SPAWN.j); }

  kit.gridWalls(b, g, { height: WALL_H, matKey: MAT, color: C.wall, trim: false });

  // ---- 楼板与天花板 ----
  slab(b, t, 0, 'up', C.slab);
  slab(b, t, H, 'down', C.ceil);
  columns(b, t, rng);
  bayLines(b, t);

  // ---- 垮塌区 ----
  if (t.block) collapseBlock(b, t.block.i, t.block.j, rng);

  // ---- 两种垮塌洞口（出口实物）----
  if (t.hole) {
    const c = cellC(t.hole.i, t.hole.j);
    shaft(b, c.x, c.z, false);
    rebarFringe(b, c.x, c.z, 0.02, rng);
    for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2, rr = OPEN / 2 + 0.25 + rng() * 0.9;
      b.box(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr, 0.3 + rng() * 0.3, 0.2, 0.3 + rng() * 0.3,
        'kit:prop', { color: C.rubbleA, rotY: rng() * Math.PI, solid: false });
    }
    // exits[1]「Level 23：沿同一处垮塌洞口离开」（entrances 里 Level 23 是「在 23 的天花板上形成的洞口」⇒ 23 在下面）
    kit.exit(b, {
      to: '23', kind: 'zone', x: c.x, z: c.z, radius: 2.0,
      label: '顺着塌穿的楼板洞口下到 Level 23 (exits[1])',
    });
  }
  if (t.breach) {
    const c = cellC(t.breach.i, t.breach.j);
    shaft(b, c.x, c.z, true);
    rebarFringe(b, c.x, c.z, H, rng);
    mound(b, c.x, c.z, rng);
    // exits[0]「Level 21：沿同一处垮塌洞口离开」（entrances 里 Level 21 是「21 的地板上形成的洞口」⇒ 21 在上面）
    kit.exit(b, {
      to: '21', kind: 'zone', x: c.x, z: c.z, y: MOUND_H, radius: 1.35,
      label: '爬上碎石堆，钻过天花板上的洞口去 Level 21 (exits[0])',
    });
  }

  // ---- 开采深坑 ----
  if (t.pit) pit(b, t.pit.x, t.pit.z, rng);

  // ---- 碎石（与绊倒判定同一份哈希）----
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (isCut(t, i, j) || inPit(t, i, j) || inBlock(t, i, j)) continue;
      if (isSpawn && i === SPAWN.i && j === SPAWN.j) continue;
      const gx = cx * N + i, gz = cz * N + j;
      if (rubbleVal(gx, gz) < RUBBLE_P) rubbleCell(b, gx, gz, i, j);
    }
  }

  // ---- 车位里的车与手推车 ----
  for (const rj of [1, 5]) {
    for (let k = 0; k < 6; k++) {
      const x = 2.6 + k * 5.2, z = rj * CELL + 2.4;
      const r = rng(), style = r < 0.45 ? 'frame' : 'wreck';
      const i = U.clamp(Math.floor(x / CELL), 0, N - 1), j = U.clamp(Math.floor(z / CELL), 0, N - 1);
      if (rng() < 0.45) continue;
      if (cellBusy(t, i, j, isSpawn)) continue;
      car(b, x, z, (rj === 1 ? 0 : Math.PI) + (rng() - 0.5) * 0.12, rng, style, false);
    }
  }
  for (let k = 0; k < 4; k++) {
    const x = 1.5 + rng() * (SIZE - 3), z = 1.5 + rng() * (SIZE - 3);
    const tip = rng() < 0.5, rot = rng() * Math.PI * 2;
    const i = U.clamp(Math.floor(x / CELL), 0, N - 1), j = U.clamp(Math.floor(z / CELL), 0, N - 1);
    if (cellBusy(t, i, j, isSpawn)) continue;
    cart(b, x, z, rot, tip);
  }

  // ---- 帐篷与棚屋（居民留下的痕迹）----
  const camps = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < camps; k++) {
    const x = 2.5 + rng() * (SIZE - 5), z = 2.5 + rng() * (SIZE - 5);
    const rot = rng() * Math.PI * 2;
    const corpse = rng() < 0.4;                  // landmarks「尤其低楼层的帐篷里装满前 Emstable 居民的尸体」
    const isShack = rng() < 0.35;
    const i = U.clamp(Math.floor(x / CELL), 0, N - 1), j = U.clamp(Math.floor(z / CELL), 0, N - 1);
    if (cellBusy(t, i, j, isSpawn)) continue;
    if (isShack) shack(b, x, z, rot, rng);
    else {
      tent(b, x, z, rot, rng, k % 2 ? C.canvasA : C.canvasC, corpse);
      if (corpse) addRead(b, x, z, ['帐篷里是一具前 Emstable 居民的遗骸', '底层的帐篷大多如此 —— 崩溃时没人走得掉']);
    }
  }

  // ---- 地标 ----
  let cutSpot = null;
  const lm = macroLandmark(cx, cz);
  if (isSpawn) {
    censusCamp(b, cellC(3, 2).x, cellC(3, 2).z, Math.PI * 0.75, rng);
    const c50 = cellC(4, 4);
    cutSpot = car50(b, c50.x, c50.z, Math.PI / 2, rng);
    sealedGlassDoor(b, 1.2, cellC(SPAWN.i, SPAWN.j).z, Math.PI / 2);
  } else if (lm.cx === cx && lm.cz === cz && !cellBusy(t, lm.i, lm.j, false)) {
    cutSpot = buildLandmark(b, lm.kind, lm.i, lm.j, rng);
  }

  // ---- 灯 ----
  // lighting 原文是 null：20 世纪停车场本来就是吊在梁下的日光灯管，废弃后绝大多数已经坏掉，
  // 只有零星几盏还在闪 —— 这是为了能玩做的近似，写进返回值 notImplemented/risks
  for (let j = 1; j < N; j += 2) {
    for (let i = 1; i < N; i += 2) {
      const r = rng();
      const state = r < 0.58 ? 'broken' : r < 0.78 ? 'off' : r < 0.92 ? 'flicker' : 'on';
      const fl = 0.45 + rng() * 0.5;
      if (isCut(t, i, j)) continue;
      const c = cellC(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, {
        y: H, w: 1.1, d: 0.3, state, flicker: state === 'flicker' ? fl : 0,
        color: 0xe6eef0, intensity: 0.95, range: 9, frameColor: C.steel,
      });
    }
  }

  // ---- 切出：mechanics「通过汽车或瓦砾成功切出可前往 Level 817」----
  const rCut = rng();
  if (cutSpot) {
    kit.exit(b, {
      to: '817', kind: 'noclip', x: cutSpot.x, z: cutSpot.z, rot: cutSpot.rot,
      w: 1.9, h: 1.15, thickness: 0.18, matKey: 'kit:prop', color: C.paint50, glitch: 0.8,
    });
  } else if (rCut < 0.32) {
    // 瓦砾版：一堆没有碰撞体的混凝土块，正面那一片能挤过去
    const i = 1 + Math.floor(rng() * (N - 2)), j = 1 + Math.floor(rng() * (N - 2));
    const rot = rng() * Math.PI * 2;
    if (!cellBusy(t, i, j, isSpawn)) {
      const c = cellC(i, j);
      b.push(c.x, c.z, rot);
      for (let k = 0; k < 7; k++) {
        const r2 = U.rng(S.seed, 'L22-cut', cx, cz, k);
        b.box((r2() - 0.5) * 1.6, 0, -0.35 - r2() * 0.8, 0.5 + r2() * 0.5, 0.5 + r2() * 1.1, 0.5 + r2() * 0.5,
          MAT, { color: k % 2 ? C.rubbleA : C.rubbleB, rotY: r2() * Math.PI, solid: false });
      }
      b.pop();
      kit.exit(b, {
        to: '817', kind: 'noclip', x: c.x, z: c.z, rot,
        w: 1.7, h: 1.3, thickness: 0.2, matKey: MAT, color: C.rubbleA, glitch: 0.8,
      });
      g.reserve(i, j);
    }
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

// =====================================================================
// 层级
// =====================================================================
BR.levels.register({
  id: '22',
  name: 'Level 22',
  title: '颓垣',
  nickname: '颓垣；原居民自称的国名为 "Emstable"',
  version: 'wikidot-cn',                       // = data/lore-choices.json levels["22"].source
  survivalClass: '等级 5e - 环境危害：不安全 / 不稳定 / 非实体危害',
  chunkSize: SIZE,
  env: {
    // 一整座水泥废墟：远处沉进灰白的水泥灰尘里，不发黑也不发黄
    background: 0x20211e, fogColor: 0x20211e,
    fogNear: 5, fogFar: 56,                   // ≤ chunkSize × 2 = 64
    // lighting/colors 原文都是 null：不是无光层，但绝大多数灯管已经坏了，靠水泥面的漫反射撑起一层灰白的底光
    ambient: { color: 0xccd2d6, intensity: 0.34 },
    sanityDrainMul: 1.5,                      // 5e 环境危害 + 帐篷里的尸体：压抑档
    hungerDrainMul: 1,                        // temperature/weather 原文是 null，不加成
    audio: 'cave',                            // 空旷水泥结构里的风声、滴水和落石回声
    darkness: false,
  },
  spawn() {
    // entrances[2]「在 Level 1 内找到玻璃门」：出生在被封死的玻璃门内侧，面朝东（+X）——
    // 右前方 16 m 是塌穿的楼板洞口（→23），右手边 16 m 是碎石堆与天花板洞口（→21），身后就是封死的玻璃门
    const c = cellC(SPAWN.i, SPAWN.j);
    return { x: c.x, y: 0, z: c.z, yaw: -Math.PI / 2 };
  },
  buildChunk,
  // entityDensityOverall「Level 22 中敌对实体数量很少，正因如此该层曾充当无数团体和个人的社区中心」：
  //   是「很少」不是「没有」—— 上一版读成了「没有」留了空表，改回来。
  // 换算：只有定性描述 → _TEMPLATE 第 12 节取 BR.config.densityWords.rare = 0.04 /1000 m²，
  //   页面一个实体也没点名（entities 数组为空），所以只能用已注册的通用敌对实体凑出这份「很少」：
  //   hound（猎犬，废墟里最常见的捕食者）与 smiler（笑魇，专挑坏了灯的暗处）各分一半 = 0.02。
  //   量级：32 m 区块 = 1024 m² ⇒ 每块期望 0.04 只，游玩满格（spawnFactor 0.5）载入 16 块 ≈ 0.33 只、
  //   噩梦·地狱（0.6）≈ 0.39 只 —— 走上好几个区块才撞见一只，对得上「数量很少」，
  //   也远低于 maxActiveEntities 28。出生块周围 3×3 块本来就不刷有害实体，社区中心的安全感还在。
  // 不点名、也不借别的层的设定实体：原文那种「无名的本土敌对实体」项目里没有，写进 apiRequests。
  entities: [
    { type: 'hound', officialPer1000m2: 0.02 },
    { type: 'smiler', officialPer1000m2: 0.02 },
  ],
  items: [
    // data/item-spawn.json 里没有 levels 含 '22' 的条目；用户规则「所有模式都刷食物和杏仁水」照刷，
    // 数值取两者的全局缺省。设定上也说得通：items「汽车与超市手推车……原本满载建筑材料和食物」「水果与庄稼：居民定期收割」
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'food_ration', per1000m2: 0.6 },
  ],
  exits: [
    { to: '21', kind: 'zone', note: '每隔一个区块一处：爬上碎石堆钻过天花板上的垮塌洞口 (exits[0])' },
    { to: '23', kind: 'zone', note: '每隔一个区块一处：塌穿的楼板洞口，下去就是 Level 23 (exits[1])' },
    { to: '817', kind: 'noclip', note: '从 50 年代汽车的车身或瓦砾堆里切出去 (exits[2])；Level 817 不在范围内，实物照摆、只提示尚未开放' },
  ],

  enter(ctx) {
    useSeed(ctx);
    S.timer = 0; S.stumble = 0; S.pitTick = 0; S.quakeAt = 28; S.readTick = 0; S.readHold = 0;
    S.read.clear();
    // 必须在建区块之前装：b.spawn 的 y、b.groundY 都要读它
    kit.heightField(groundAt).install();
  },

  update(ctx, dt) {
    S.timer += dt;
    const P = BR.player;
    if (!P || P.dead) return;
    const gx = Math.floor(P.x / CELL), gz = Math.floor(P.z / CELL);

    // hazards「地面散落碎石和梁柱，步行极不安全；杂物容易导致行人在混凝土、钢筋和毁坏的汽车上绊倒受伤」
    const moving = Math.hypot(P.vx, P.vz) > 1.6;
    if (moving && rubbleVal(gx, gz) < RUBBLE_P) {
      S.stumble += dt;
      // 阈值 1.6 s、离开碎石后按 0.25/s 慢慢消退：在碎石堆里连着走才会绊，穿过一格干净地面不会立刻清零
      if (S.stumble > 1.6) {
        S.stumble = 0;
        const h = U.hashInts(S.seed, 'stumble', gx, gz, Math.floor(S.timer / 1.6)) / 4294967296;
        if (h < 0.45) {
          BR.hud.toast('脚下的碎石一滑，钢筋绊了一下', 1600);
          BR.audio.play('hit', [P.x, 0, P.z], { volume: 0.7 });
          if (BR.game.attackPlayers) BR.player.damage({ hp: 5, sanity: 0.5, source: 'hazard:rubble-trip' });
        }
      }
    } else if (S.stumble > 0) S.stumble = Math.max(0, S.stumble - dt * 0.25);

    // hazards「深坑……理论上可攀爬到达新区域，但因自由攀爬的危险性非常不建议，很多起意外死亡正源于此」
    // 掉进楼板洞口的井里走的是同一条「爬上爬下要命」的判定，只是换一句文案
    const gy = groundAt(P.x, P.z);
    if (gy < -0.3) {
      const inShaft = gy <= -SHAFT_DOWN + 0.05;
      S.pitTick += dt;
      if (S.pitTick > 3.4) {
        S.pitTick = 0;
        BR.hud.toast(inShaft ? '你掉进了塌穿的楼板洞口，井壁全是断茬 —— 得爬回楼面上去'
          : '坑壁上的混凝土一碰就碎，这里爬上爬下都要命', 2200);
        if (BR.game.attackPlayers) {
          BR.player.damage({ hp: 3, sanity: 1.2, source: inShaft ? 'hazard:shaft-climb' : 'hazard:pit-climb' });
        }
      }
    } else S.pitTick = 0;

    // hazards「结构不稳定……已发生整体垮塌」：隔一阵子附近掉一块楼板
    if (S.timer > S.quakeAt) {
      const n = Math.floor(S.timer / 30);
      const hr = U.rng(S.seed, 'L22-quake', n, gx, gz);
      S.quakeAt = S.timer + 26 + hr() * 22;
      const a = hr() * Math.PI * 2, d = 3 + hr() * 9;
      const qx = P.x + Math.cos(a) * d, qz = P.z + Math.sin(a) * d;
      BR.audio.play('hit', [qx, 0, qz], { volume: 1, rate: 0.6 });
      if (d < 5.5) {
        BR.hud.toast('头顶的楼板炸开一道缝，一整块砸了下来', 2200);
        if (BR.gfx && BR.gfx.flash) BR.gfx.flash(0x9b978c, 0.18, 0.3);
        if (BR.game.attackPlayers) BR.player.damage({ hp: 9, sanity: 2, source: 'hazard:slab-collapse' });
      } else {
        BR.hud.toast('不远处传来楼板垮下来的闷响', 1800);
      }
    }

    // 可读物件：引擎没有「文档」道具，靠近弹提示（每件只弹一次）
    if (S.readHold > 0) S.readHold -= dt;
    S.readTick += dt;
    if (S.readTick < 0.25 || S.readHold > 0) return;
    S.readTick = 0;
    const list = BR.world.chunks();
    // 一次只弹最近的那一件：HUD 同屏只留 3 条 toast，Hilda 的三页纸只隔 2 m，
    // 同一帧弹两件会把先弹的那条顶掉
    let best = null, bestD = READ_R2;
    for (let i = 0; i < list.length; i++) {
      const data = list[i].res && list[i].res.data;
      const reads = data && data.reads;
      if (!reads) continue;
      for (let k = 0; k < reads.length; k++) {
        const rd = reads[k];
        const key = Math.round(rd.x * 2) + ':' + Math.round(rd.z * 2);
        if (S.read.has(key)) continue;
        const d2 = U.dist2(P.x, P.z, rd.x, rd.z);     // 平方距离，和 READ_R2 比
        if (d2 > bestD) continue;
        bestD = d2; best = { key, rd };
      }
    }
    if (!best) return;
    S.read.add(best.key);
    BR.hud.toast(best.rd.lines[0], 4200);
    if (best.rd.lines[1]) BR.hud.toast(best.rd.lines[1], 6200);
    S.readHold = 5.5;                                  // 等这两条读完再弹下一件
    if (BR.game.attackPlayers && best.rd.lines[0].indexOf('遗骸') >= 0) {
      BR.player.damage({ hp: 0, sanity: 2.5, source: 'hazard:corpse-tent' });
    }
  },

  leave() { BR.hud.prompt(''); },
});
})();
