# 层级文件写法（js/levels/L&lt;id&gt;.js）

给实现第二波层级的代理看。工具库是 `js/levels/_kit.js`（`BR.kit`），写法示范是 `js/levels/Ldev.js`（开发层，含切出墙、未开放电梯、构件展示间）。
**不许修改** `_kit.js`、`js/game/world.js`、`index.html`、引擎文件；缺能力写进返回值 `apiRequests`，局部工具函数写在自己文件里。

目录：
0 先读什么 · 1 取选中版本 · 2 文件骨架 · 3 register 字段 · 4 坐标与确定性 · 5 Builder · 6 材质 · 7 格子迷宫 · 8 构件 ·
9 出口 · 10 灯光 · 11 高度场 · 12 实体表 · 13 物品表 · 14 enter/update/leave 与危害 · 15 贴图 · 16 性能 · 17 验收 · 18 返回值与自检

---

## 0. 先读什么

- `ARCHITECTURE.md` 第 0、5 节（层级接口、ChunkResult）；`WAVE2.md` 第 1、3、4、6 节。
- 本文档全文。`Ldev.js` 全文（182 行，就是本文档的活例子）。
- 选中版本的调研（第 1 节脚本），**只读选中的那一项**，`conflicts` 也读一遍 —— 那里列出的其他版本细节**一律不做**。

用户定死、和层级相关的规则：
- 设定冲突随机选版本、整体采用、不折中；`version` 必须等于 `data/lore-choices.json` 的 `source`。
- 超出首期范围（0–20、fun、run 以外）的出口**照样摆出实物**，靠近提示"Level X 尚未开放"，**不许改成通往别处**（kit 自动处理，第 9 节）。
- 所有模式都刷食物和杏仁水（第 13 节）。
- 游玩模式实体不打玩家，友善/有害照样互打；测试人（dummy）只挨有害实体打（实体管理负责，层级只列实体表）。

文件名与 id：`'0'…'20'` → `L0.js…L20.js`；`'fun'` → `Lfun.js`（name `'Level Fun'`）；Level ! 的 id 是 `'run'` → `Lrun.js`（name `'Level !'`）。

---

## 1. 取选中版本

```bash
python3 - <<'PY'
import json
ID = '0'                      # 代码里的 id；Level ! 写 'run'
key = '!' if ID == 'run' else ID                      # lore-choices 里 Level ! 的键是 '!'（BR.kit.loreKey 同规则）
ch = json.load(open('/Users/xuanjiang/Downloads/project/backrooms/data/lore-choices.json'))['levels'][key]
print('source:', ch['source'], '\nurl:', ch['url'], '\ntitle:', ch['title'])
r = json.load(open(ch['file']))                       # backrooms-research/levels/level-<id>.json（Level ! 是 level-run.json）
v = next(x for x in r['versions'] if x['source'] == ch['source'])
print(json.dumps(v, ensure_ascii=False, indent=1))
print('\n不做的冲突细节：'); [print(' -', c) for c in r['conflicts']]
PY
```

选中版本那一项的字段：

| 字段 | 内容 | 落到代码哪里 |
|---|---|---|
| `title` `nickname` `survivalClass` | 标题、别称、生存等级 | `title`、`nickname`、`survivalClass` |
| `sourceMeta` | 抓取时间、修订号、作者 | 文件头注释 |
| `environment.architecture/layout/scale` | 结构、布局、尺度 | 格子参数、区块类型、`chunkSize` |
| `environment.materials/colors` | 材质、颜色 | `kit.mat`、贴图（第 15 节）、构件颜色 |
| `environment.lighting` | 灯光 | 灯盘状态比例、色温、无光区（第 10 节）、`env.ambient` |
| `environment.sounds/smells/temperature/weather/other` | 声音等 | `env.audio`、`env.hungerDrainMul`、`update` 里的现象 |
| `landmarks[]` | 地标/特殊区域 | 按概率出现的区块变体（第 4.3 节） |
| `hazards[]` `mechanics[]` | 危害、特殊机制 | `enter/update`（第 14 节） |
| `entities[]`（`en zh hostility behavior density notes`）、`entityDensityOverall` | 实体与密度 | `entities` 表（第 12 节） |
| `items[]`（`en zh availability effect`） | 补给 | `items` 表（第 13 节） |
| `entrances[]`（`from method`） | 入口 | 出生点描述（`spawn`） |
| `exits[]`（`to method notes`） | 出口 | 每一条都用 `BR.kit.exit` 摆实物（第 9 节） |

实体 key（`hound`、`smiler`…）查 `data/entity-index.json` 的 `entities[].key`，`levels` 含本层才算；`loreOnly` 里列的只是传闻，不放进实体表。
`data/entity-index.json` 的 `hazards` 里有按层整理的危害说明（`level` 字段），和选中版本对得上的才做。

---

## 2. 文件骨架

```js
// Level 7 "Thalassophobia"（← 选中版本的标题）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-7  许可：CC BY-SA 3.0
// 抓取：2026-09-12，page revision N（sourceMeta）
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
const SIZE = 24, N = 8, CELL = SIZE / N;   // 区块 24 m、8×8 格、3 m 一格
const H = 2.8;                            // 层高（版本没写就用 kit.DEFAULT_HEIGHT）

// ---------- 布局 ----------
// 边界参数全层所有区块必须完全一样（第 7.2 节），区块类型之间只改内部参数
const EDGE = { salt: 'L7', boundaryDensity: 0.4, straightness: 0.7, minOpenings: 2 };
const MAZE = Object.assign({ wallDensity: 0.4, roomChance: 0.4, maxRooms: 2, roomSize: [2, 4], loopChance: 0.5, pillarChance: 0.03 }, EDGE);
const HALL = Object.assign({ wallDensity: 0, roomChance: 0, loopChance: 0, pillarChance: 0.5 }, EDGE);   // 柱厅：内部清空、边界照旧
const SPAWN_I = 3, SPAWN_J = 3;

// ---------- 材质（key 带层级前缀）----------
function defineMaterials() {
  kit.mat('L7:wall',  { tex: 'wallpaper_l0', repeatMeters: 1.5, roughness: 0.95 });
  kit.mat('L7:floor', { tex: 'carpet_l0', repeatMeters: 2, roughness: 1 });
  kit.mat('L7:ceil',  { tex: 'ceiling_tile', repeatMeters: 1.2, roughness: 1 });
}

// ---------- 区块 ----------
// rng 消耗顺序固定：区块类型 → 格子 → 灯 → 地标 → 出口。只用传进来的 rng
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const rolled = U.weighted(rng, [['maze', 0.85], ['hall', 0.15]]);   // 先无条件取（第 4.2 节），依据：environment.layout「…」
  const kind = isSpawn ? 'maze' : rolled;

  const g = kit.grid(b, N, N, kind === 'hall' ? HALL : MAZE);
  if (isSpawn) { g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true }); g.reserve(SPAWN_I, SPAWN_J); }

  // 切出出口：拆一段内部墙，原位放闪烁墙（依据：exits[0]「扑进闪烁的墙到 Level 1」）
  const rNoclip = rng();
  const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
  if (!isSpawn && rNoclip < 0.15 && ed) {
    g.setWall(ed.axis, ed.i, ed.j, false);
    kit.exit(b, { to: '1', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: 'L7:wall' });
    g.reserve(ed.i, ed.j);
  }

  kit.gridWalls(b, g, { matKey: 'L7:wall', trim: { color: 0x5e4b2c } });
  kit.prop.floor(b, null, null, 0, { matKey: 'L7:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L7:ceil', y: H });

  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const r = rng();
      const state = r < 0.05 ? 'broken' : r < 0.15 ? 'flicker' : 'on';   // 依据：environment.lighting「…」
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, flicker: 0.4 + rng() * 0.5 });
    }
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: '7', name: 'Level 7', title: 'Thalassophobia', nickname: '',
  version: 'wikidot-en',                 // = lore-choices.levels['7'].source
  survivalClass: '4',
  chunkSize: SIZE,
  env: {
    background: 0x2b2512, fogColor: 0x2b2512, fogNear: 6, fogFar: 42,
    ambient: { color: 0xfff0c8, intensity: 0.42 },
    sanityDrainMul: 1, hungerDrainMul: 1, audio: 'fluorescent', darkness: false,
  },
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据：entities[0].density「…」→ 第 12 节换算过程写在这里
    { type: 'hound', officialPer1000m2: BR.config.densityWords.low },
  ],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },   // data/item-spawn.json
    { type: 'food_ration', per1000m2: 0.5 },
  ],
  exits: [
    { to: '1', kind: 'noclip', note: '约 15% 的区块有一段闪烁的墙，贴上去切出（exits[0]）' },
    { to: '27', kind: 'door', note: 'Level 27 不在首期范围：门照摆，只提示尚未开放（exits[1]）' },
  ],
  enter(ctx) {}, update(ctx, dt) {}, leave(ctx) {},
});
})();
```

---

## 3. register 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | `'0'`…`'20'`、`'fun'`、`'run'` |
| `name` | ✓ | `'Level 7'` / `'Level Fun'` / `'Level !'`（HUD 层级名提示用） |
| `title` `nickname` | | 选中版本的标题/别称（中文版本就写中文） |
| `version` | ✓ | lore-choices 的 `source` |
| `survivalClass` | | 选中版本原文的等级字符串 |
| `chunkSize` | | 区块边长（米），默认 24。开阔层 32–48（第 16 节） |
| `env` | ✓ | 见下表 |
| `spawn(ctx)` | ✓ | 返回 `{ x, y, z, yaw }`（世界坐标，`yaw` 0 = 面朝 −Z）。必须落在空地上、不在出口圈里；只能依赖 `ctx.levelSeed`。最简单是像 Ldev 那样在区块 (0,0) 里 `carve` 一个出生房间 |
| `buildChunk(ctx, cx, cz, rng)` | ✓ | 返回 `b.finish()`（第 5 节） |
| `entities` | ✓ | `[{ type, officialPer1000m2 }]`（第 12 节），可以是 `[]` |
| `items` | ✓ | `[{ type, per1000m2 }]`（第 13 节），杏仁水与食物必有 |
| `exits` | ✓ | `[{ to, kind, note }]`：**文档用途**（不参与触发），逐条对应选中版本的 `exits`，范围外的也列、note 写"尚未开放" |
| `enter/update/leave` | | 第 14 节 |

`env` 各字段（gfx/audio/player 读）：

| 字段 | 含义 | 参考值 |
|---|---|---|
| `background` `fogColor` | 清屏色、雾色，一般相同 | 黄色办公层 `0x2b2512`（远处沉进昏黄，不发黑）；水泥/管道 `0x141414`；无光 `0x000000`；户外夜 `0x0a0d14` |
| `fogNear` `fogFar` | 能见度 100% 时雾的起止（米）。gfx 按设置里的能见度把 `fogFar` 缩放到 0.25–1 倍 | 室内迷宫 6 / 42；昏暗 2 / 24；无光 0.5 / 10；开阔层（chunkSize 48）15 / 90。**`fogFar` ≤ chunkSize × 2**（载入半径 2 块，雾外的区块可能还没建） |
| `ambient` | `{ color, intensity }` 环境光；同时是 `BR.world.lightAt` 的底数（实体"怕光/要光"就看它） | 灯火通明 0.42；昏暗 0.15–0.2；无光 0.02–0.05 |
| `sanityDrainMul` | 乘基础掉 san 速度（20 分钟掉空） | 安全区 0.5；普通 1；压抑 1.5；危险/无光 2–3。依据写注释 |
| `hungerDrainMul` | 乘基础饥饿速度（14 分钟饿空） | 1；酷热/严寒 1.3 |
| `audio` | 环境音预设 | `'fluorescent' 'pipes' 'electrical' 'office-rain' 'hotel' 'dark' 'ocean' 'cave' 'suburb-night' 'wind-field' 'city' 'party' 'chase' 'silence'` |
| `darkness` | 无光层标记（手电等规则由层级在 update 里处理，引擎没有手电 → 写 `apiRequests`） | 版本明说无光才 `true` |

---

## 4. 坐标与确定性

### 4.1 坐标
- 米，Y 向上。区块 (cx, cz) 覆盖世界 `x ∈ [cx·S, (cx+1)·S)`、`z ∈ [cz·S, (cz+1)·S)`。
- **builder 里的坐标全是区块本地坐标**：`(0, 0)` 是区块最小角，`x` 向东、`z` 向南，范围 `0..S`。`b.world(x, z)` 换成世界坐标。
- 旋转 `rot` 绕 Y、与 three.js `rotation.y` 同向：`rot = 0` 构件正面朝 +Z（南），`π/2` 朝 +X（东），`−π/2` 朝 −X（西），`π` 朝 −Z（北）。
- 玩家 `yaw = 0` 面朝 −Z（北），`π/2` 面朝西，`−π/2` 面朝东，`π` 面朝南。

### 4.2 确定性（联机两边逐字节一致）
- `buildChunk` **只**用传进来的 `rng`（= `BR.util.rng(levelSeed, cx, cz)`）和由 `ctx.levelSeed` 派生的流；**禁止** `Math.random`、`Date`、`BR.game.mode/settings`、已载入的邻块、玩家位置。
- 消耗顺序固定：先无条件地取随机数再判断（`const r = rng(); if (!isSpawn && r < P) …`），别写成"满足条件才取"，否则改一个条件后面全挪位。
- 需要跨区块协调的随机（"每 4×4 块最多一个红房间"）用派生流，不吃区块 rng：

```js
const MX = 4;                                                     // 宏格 4×4 区块
const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
const mr = U.rng(ctx.levelSeed, 'L0-redroom', mx, mz);            // 同一宏格里所有区块算出来一样
const has = mr() < 0.3, hx = mx * MX + Math.floor(mr() * MX), hz = mz * MX + Math.floor(mr() * MX);
if (has && cx === hx && cz === hz && !(cx === 0 && cz === 0)) buildRedRoom(b, g);
```

### 4.3 地标/区块变体
- 版本里的特殊区域做成区块变体，按概率出现（上面两种写法），出生块 (0,0) 保持最典型的样子。
- 变体只改**内部**：边界线必须照常生成（第 7.2 节）。跨多块的大地标用宏格定位、每块画自己那一部分。

---

## 5. Builder

```js
const b = kit.builder(ctx, cx, cz, rng, { height: 2.8 });   // height 缺省 kit.DEFAULT_HEIGHT = 2.8
```

只读属性：`b.cx b.cz`、`b.size`（区块边长）、`b.ox b.oz`（区块原点世界坐标）、`b.seed`（levelSeed）、`b.rng`、`b.height`、`b.level`、`b.ctx`；
`b.data = {}` 随意放东西，`finish` 后挂在 `ChunkResult.data`（level.update 里用 `BR.world.chunkAt(x, z).res.data` 取）。

**几何累积、finish 时按材质合并**：同一材质的所有件在一块里只成 1 个 mesh（等价于 `mergeBufferGeometries(useGroups=false)`，但不产生临时 geometry）。
几何按区块本地坐标存、整组平移到区块原点（走几公里也不丢精度）；贴图 UV 默认按世界米数平铺（`米数 / repeatMeters`），相邻区块无缝。

### 5.1 局部坐标系
| 方法 | 说明 |
|---|---|
| `b.push(x, z, rot, y?)` / `b.pop()` | 之后的坐标都相对 (x, y, z)、绕 Y 转 rot；构件内部都这么摆零件，可嵌套 |
| `b.point(x, z)` → `{x, z}` | 当前坐标系 → 区块本地 |
| `b.world(x, z)` → `{x, z}` | 当前坐标系 → 世界 |
| `b.groundY(x, z)` | 当前坐标系下该点的地面高度（第 11 节装了高度场才非 0） |

### 5.2 几何原语（返回 `Piece`）
`opts` 通用：`color`（`0xRRGGBB` 或 `[r,g,b]`，可 >1，只对开了 `vertexColors` 的材质有效）、`glow`（乘到 color 上）、`rotY`（额外绕 Y）、
`uv`：`'world'`（缺省，按世界米数平铺）| `'stretch'`（整面贴一张，`uvRepeat: [u, v]` 贴几遍）| `'solid'`（只给 `'kit:glow'` 用：纯色发光）。

| 方法 | 说明 |
|---|---|
| `b.box(x, y, z, w, h, d, matKey, { solid = true, uv, faces, color, glow, rotY })` | (x, z) 底面中心、y 底面高度；w 沿 x、h 沿 y、d 沿 z。`faces`：`'all'`（缺省）\| `'sides'`（顶天立地的墙，省顶底）\| `'noBottom'`（放地上的东西）\| `'noTop'` \| `['px','nx','py','ny','pz','nz']`。`solid` 时按变换后的顶点出世界 AABB |
| `b.aabb(minX, minY, minZ, maxX, maxY, maxZ, matKey, opts)` | 同 box，用角点给 |
| `b.plane(x, y, z, w, h, matKey, { facing = 'up', solid = false, uv, uvRepeat, color, glow, rotY })` | `facing 'up'/'down'`：(x,y,z) 面中心、w 沿 x、h 沿 z（地板/天花板）；`'+z' '-z' '+x' '-x'`：(x,z) 底边中点、y 底边高度、w 水平、h 竖直 |
| `b.quad(p0, p1, p2, p3, matKey, opts)` | 任意四边形，4 个 `[x,y,z]` 逆时针为正面（坡道、斜顶） |
| `b.cylinder(x, y, z, r, h, matKey, { rTop, segments = 8, axis = 'y', caps = true, solid = (axis==='y'), uv, color, glow })` | axis `'y'`：(x,z) 底面圆心、y 底高；`'x'/'z'`：(x,y,z) 轴线中点 |
| `b.mesh(geometry, matKey, { x, y, z, rotY, solid = false, uv = 'stretch', color, glow })` | 任意 BufferGeometry（只读 position/normal/uv，调用方自己 dispose）。`uv:'stretch'` 保留几何自带 UV |
| `b.object(obj, { solid })` | **不合并**的独立 Object3D（会动的东西），每个多 1 个 draw call，每块 ≤ 2 个 |
| `b.solid(minX, minY, minZ, maxX, maxY, maxZ)` | 纯碰撞体（有旋转时取外接 AABB） |

`Piece`（合并后仍能单独改）：`piece.setColor(color, mul?)`（需要 vertexColors 材质）、`piece.setVisible(bool)`、`piece.visible`。
事件门出现/消失、发光件明灭都用它，不必单独建 mesh。碰撞体不随 `setVisible` 变，要"消失的墙"就别给 solid、改用出口或自己在 update 里判定。

### 5.3 灯、刷新点、出口、动画
| 方法 | 说明 |
|---|---|
| `b.light({ x, y = height-0.35, z, color = 0xfff1d0, intensity = 1, range = 9, flicker = 0 })` → 描述 | 世界坐标的灯光描述，推给 gfx 灯光预算（第 10 节）。之后改 `desc.intensity / color / flicker`，真光与 `linkGlow` 的面片都跟着变 |
| `b.linkGlow(piece, lightDesc, baseColor, offRatio = 0.06)` | 发光面片跟随灯光描述明灭（闪烁与真光逐帧对齐；intensity ≤ 0 时暗到 offRatio） |
| `b.spawn(x, z, tag = 'floor', { safe, y })` | 物品/实体刷新点。`safe: true` 的点不刷有害实体（安全屋）。y 缺省取高度场。finish 时剔掉离碰撞体 < 0.45 m、压在出口圈（半径 +0.4）上的点 |
| `b.exit({ x, z, y, radius = 1, to, kind = 'zone', label, sealed?, sealedText?, active?, tag })` → `ExitHandle` | **只有描述不摆实物**；要实物用 `kit.exit`（第 9 节） |
| `b.update(fn(dt, t, res))` | 区块级每帧回调（t = 本区块载入后秒数），区块卸载后自动停。闪烁、水面、事件门都放这里 |
| `b.finish()` → `ChunkResult` | 同一个 builder 只能调一次 |

`ChunkResult = { group, solids, lights, spawnPoints, exits, update?, data, kit: { exits: [ExitHandle], stats: { meshes, triangles, solids, lights, spawnPoints, spawnDropped } } }`

---

## 6. 材质 `BR.kit.mat`

```js
kit.mat('L6:concrete', { tex: 'concrete_wet', repeatMeters: 2.5, roughness: 0.7 });
b.box(12, 0, 12, 0.6, 2.8, 0.6, 'L6:concrete', { faces: 'sides' });
```

- `kit.mat(key, def)` → THREE.Material。同 key 全局只建一次（走 `BR.assets.material` 缓存），world 卸区块不释放共享材质。
  **第一次定义生效**，之后同 key 不同参数会 warn 并沿用第一次 —— key 必须带层级前缀（`'L6:floor'`）。每块开头调一遍 `defineMaterials()` 没开销。
- 没定义就用的 key 显示洋红色并 warn（验收截图里看到洋红 = 漏定义）。
- `kit.mats({ key: def, ... })` 批量定义，返回 `{ key: material }`。

`def` 字段：

| 字段 | 说明 |
|---|---|
| `type` | `'phong'`（缺省；r147 的 Lambert 逐顶点插值，大墙面上灯光会糊）\| `'lambert'` \| `'basic'`（不吃光，发光/纯黑）\| `'standard'`（贵，只在确实需要时用） |
| `tex` | `BR.assets.texture` 的名字（`assets/tex/<名字>.jpg` 或程序化兜底） |
| `linear` | 数据贴图（noise）不做 sRGB 解码 |
| `repeatMeters` | **贴图一张在世界里铺多少米**：数字或 `[u米, v米]`。UV = 米数 / repeatMeters |
| `uvOffset` | `[u米, v米]` 平铺起点偏移（把砖缝对齐到灯盘两端之类） |
| `color` | 材质底色（有贴图时乘上去） |
| `roughness` `metalness` | Phong 下自动换算成 shininess/specular；也可直接给 `shininess` `specular` |
| `emissive` `emissiveIntensity` `emissiveTex` | 自发光 |
| `transparent` `opacity` `alphaTest` `depthWrite` | 透明 |
| `side` | `'front'`（缺省）\| `'back'` \| `'double'` |
| `vertexColors` | `true` 时各件的 `color` 选项生效（给贴图材质逐件染色） |
| `polygonOffset` | 负数 = 往前挤，贴在同一平面上的装饰防 z-fighting |
| `flatShading` `fog` | |

内置（构件用，也可以直接拿来用）：
- `'kit:prop'`：无贴图、顶点色 Phong。一块里所有桌椅柜子合成一个 mesh。
- `'kit:glow'`：Basic、light_panel 贴图、顶点色。`uv:'stretch'` 显示灯盘格栅；`uv:'solid'` 是纯色发光（指示灯、黑洞、窗外亮光），颜色可 >1。
- `'kit:glass'`：半透明玻璃；`'kit:water'`：半透明高光水面。

---

## 7. 格子迷宫

### 7.1 生成
```js
const g = kit.grid(b, cols, rows, opts);      // 第一个参数是 builder（跨区块无缝要用它的区块坐标和层级种子）
kit.gridWalls(b, g, { matKey: 'L0:wall' });
kit.gridSpawns(b, g);
```

`opts`（后室不是完美迷宫：马尔可夫长墙段 → 掏房间 → 并查集打通孤岛 → 死胡同开洞成回路 → 空旷格点立柱）：

| 字段 | 缺省 | 说明 |
|---|---|---|
| `wallDensity` | 0.4 | 内部墙段占比（稳态） |
| `straightness` | 0.7 | 墙段"连着下去"的概率，越大走廊越长 |
| `boundaryDensity` | = wallDensity | 区块边界线上的墙占比 |
| `minOpenings` | ⌊n/4⌋（至少 1） | 每条边界线至少几个开口 |
| `roomChance` `maxRooms` `roomSize` | 0.3 / 2 / [2,4] | 每块最多掏几个开阔房间（格数范围） |
| `loopChance` | 0.5 | 死胡同再打通一面的概率（回路） |
| `pillarChance` | 0 | 四面无墙的内部格点立柱子的概率 |
| `salt` | `'grid'` | 边界哈希的盐；同一层同一套格子用同一个 |
| `rng` | `b.rng` | 内部墙用的随机流 |

保证：块内全连通；每条边界至少 `minOpenings` 个开口；相邻两块算出的边界线逐段一致 ⇒ 整个无限世界连通，玩家不会被困（`tests/kit.mjs` 在 7×7 块上验证）。

### 7.2 跨区块无缝的硬规则（违反会出现"墙只有半堵、从背面能看穿"）
1. 边界线只由 `(levelSeed, salt, 线的全局坐标, n, boundaryDensity, straightness, minOpenings)` 决定。**同一层所有区块**这几项必须一样：`salt`、`cols/rows`、`boundaryDensity`、`straightness`、`minOpenings`、`chunkSize`。区块类型之间只改 `wallDensity/roomChance/loopChance/pillarChance`。
2. 边界墙每边只画朝向自己那一侧的半堵（厚度一半），邻块画另一半。所以**特殊区块也必须调 `kit.grid` 并 `gridWalls`**：要整块打通就 `g.carve(0, 0, cols, rows, { room: true })`（只清内部，边界照旧）——Ldev 的构件展示间就是这么做的。
3. `g.setWall` 不能改边界线（改了会被忽略并 warn）。要在边界上开大门，把地标放进块内部。
4. 不要在边界开口正前方的格子里摆实心构件堵路；要摆就先 `g.edges({ wall: false })` 找开口避开，或只摆不挡路的（坑、水坑、管道）。

### 7.3 Grid 查询与修改
坐标：墙在格线上。`'v'` 墙段是 `x = i·cellW` 这条竖线上第 j 行（i = 0..cols），`'h'` 墙段是 `z = j·cellD` 这条横线上第 i 列（j = 0..rows）。

| 方法 | 说明 |
|---|---|
| `g.cols g.rows g.cellW g.cellD g.size` | |
| `g.rooms` `[{ i, j, w, d }]`、`g.pillars` `[{ i, j }]` | 掏出的房间、柱子格点 |
| `g.isWall(axis, i, j)` | |
| `g.walls(i, j)` → `{ n, s, w, e }` | 格子四面（n = −z） |
| `g.wallCount(i, j)`、`g.vertexFree(i, j)` | |
| `g.center(i, j)` → `{ x, z }`、`g.cellAt(x, z)` → `{ i, j }` | 区块本地坐标 |
| `g.isRoom(i, j)`、`g.isReserved(i, j)`、`g.reserve(i, j)` | reserve 的格子 `gridSpawns` 不放刷新点（出口、地标占位） |
| `g.cells(filter?)` → `[{ i, j, x, z, room, reserved, walls }]`、`g.deadEnds()` | |
| `g.edges({ wall, interior, unlocked })` → `[{ axis, i, j, x, z, rot, len, wall }]` | 墙段/开口列表。`rot` 让"正面朝 +Z 的构件"正对格子 (i, j)（'v' 段是东边那格，'h' 段是南边那格）；翻面加 π |
| `g.pickEdge(rng, filter)` | 随机取一条 |
| `g.carve(i0, j0, w, d, { room, keepPillars })` | 清掉矩形内部墙（四周与边界不动） |
| `g.setWall(axis, i, j, on)` | 手动加/拆**内部**墙并锁定。加过墙后 `gridWalls` 会自动再跑一次 `reconnect`（独立随机流，不影响层级 rng；锁定的墙不拆） |
| `g.reconnect(rng?)` | 手动打通孤岛；不传 rng 用派生流（绝不用 Math.random）。故意围死的房间别用 setWall 围，会 warn —— 用 `b.box` 自己砌 |

### 7.4 gridWalls / gridSpawns
- `kit.gridWalls(b, g, { matKey, height = b.height, thickness = 0.2, color, top, trim, trimMatKey, pillarSize = 0.5, pillarMatKey })` → `{ walls, pillars }`
  - 连续墙段合成一个盒子，端头多出半个墙厚，L 形拐角不留缝；矮于层高的隔断自动带顶面（`top` 可强制）。
  - `trim`：踢脚线，缺省开 `{ h: 0.1, t: 0.015, color: 0x5a4a32, matKey: 'kit:prop' }`；`trim: false` 关。
- `kit.gridSpawns(b, g, { every = 1, tag = 'floor', roomTag = 'room', safe })` → 数量。每个未 reserve 的格子中心一个点；`every: 2` 隔格取。

不用格子的层（开阔场地、洞穴、城市）：直接 `b.box/b.plane` 搭，自己 `b.spawn` 撒刷新点（规则网格 + rng 抖动，每块 ≥ 20 个），区块边界上别出现半堵墙。

---

## 8. 构件 `BR.kit.prop.<name>(b, x, z, rot, opts)`

约定：(x, z) 是构件在地面上的中心（当前坐标系），`rot = 0` 正面朝 +Z；零件进 `'kit:prop' / 'kit:glow' / 'kit:glass' / 'kit:water'`，一块里摆多少种构件都只多这几个 draw call；碰撞体按整体外形给一两个 AABB。
所有 `opts` 都可省略；`solid: false` 关碰撞体；`color` 系列字段是 hex。

| 构件 | opts（缺省值） | 返回 |
|---|---|---|
| `lightPanel` 日光灯格栅 | `y = b.height`, `w = 1.2`, `d = 0.6`, `state = 'on'\|'flicker'\|'broken'\|'off'`, `flicker = 0.6`, `flickerLater`, `glow = 1.8`, `panelColor`, `frame = true`, `frameColor`, `light = true`, `color = 0xfff1d0`, `intensity = 1.1`, `range = 9` | `{ piece, src }`。broken 灰面板无灯；off 有灯描述但 intensity 0，点亮：`src.intensity = src.onIntensity` |
| `ceiling` / `floor` 吊顶/地板 | `x, z` 传 `null` 铺满整块；`matKey`, `w = S`, `d = S`, `y`（吊顶缺省 b.height、地板 0）, `uv`, `color` | `piece` |
| `baseboard` 踢脚线 | `length = 1`, `h = 0.1`, `t = 0.015`, `color`, `matKey`（背面贴 z = 0，向 +Z 凸出） | `piece` |
| `door` 门 | `style = 'wood'\|'metal'\|'fire'`, `w`, `h = 2.05`, `open = 0..1`（绕左合页向 −Z 推开）, `color`, `frameColor`, `sign`（true 或颜色：门上出口灯箱）, `wall: { matKey, w, h, t }`（带一截开了洞的墙）, `solid` | `{ leaf }` |
| `stairwell` 楼梯间入口 | `down = true`（地上黑洞 + 三面栏杆）/ `false`（向 −Z 升起的台阶通进黑门洞）, `w = 1.3`, `depth = 2.6`, `steps = 6`, `h`, `railColor`, `stepColor`, `wallColor`, `matKey`, `sign` | `{}` |
| `elevator` 电梯门 | `w = 1.1`, `h = 2.1`, `open = 0..1`, `frameColor`, `doorColor`, `indicator`（楼层灯颜色）, `interior`（轿厢颜色，缺省黑）, `wall`, `solid` | `{ left, right }` |
| `vent` 通风口 | `w = 0.6`, `h = 0.35`, `color`, `y = 2.3`（墙上，中心高度）；`ceiling: true` 贴天花板朝下（`y = b.height`） | `{}` |
| `pipe` 管道 | `length = 3`, `r = 0.06`, `axis = 'x'\|'z'\|'y'`, `y`（横管轴线高 2.5；竖管底部 0）, `color`, `solid`（竖管缺省有） | `{}` |
| `puddle` 水坑 | `rx = 0.8`, `rz = 0.5`, `y`, `color`（形状按位置哈希，不吃 rng，不挡路） | `{ piece }` |
| `box` 纸箱 | `w = 0.5`, `h = 0.38`, `d = 0.4`, `stack = 1`, `color` | `{}` |
| `crate` 木箱 | `size = 0.8`, `color` | `{}` |
| `desk` 办公桌 | `w = 1.4`, `d = 0.7`, `h = 0.75`, `color`, `monitor`, `screen`（屏幕颜色，缺省黑） | `{}` |
| `chair` 办公椅 | `color`（靠背在 −Z） | `{}` |
| `cubicle` 隔间 | `w = 2`, `d = 2`, `h = 1.4`, `color`, `desk = true`, `chair = true`, `monitor = true`（正面 +Z 敞开） | `{}` |
| `window` 窗户 | `w = 1.2`, `h = 1.2`, `y = 0.9`（窗台高）, `frameColor`, `mullions = true`, `blackout`（涂黑）+ `paint`, `glow`（true 或颜色：外面很亮）, `tint`（玻璃色）, `wall` | `{ pane }` |
| `vending` 自动售货机 | `color`, `glow`, `light = true`, `intensity = 0.35`, `range = 3.5` | `{ src }` |
| `bed` 床 | `w = 1`, `l = 2`, `frameColor`, `color`（床头在 −Z） | `{}` |
| `cabinet` 柜子 | `kind = 'file'\|'wardrobe'\|'locker'`, `w`, `h`, `d`, `color` | `{}` |
| `streetlight` 路灯 | `h = 6`, `poleColor`, `state`（同灯盘）, `lampColor`, `light = true`, `color = 0xffc98a`, `intensity = 1.4`, `range = 14`, `flicker`（灯臂伸向 +Z） | `{ src, lens }` |
| `fence` 栅栏 | `length = 4`, `h`, `kind = 'chain'\|'picket'\|'rail'`, `color`, `meshColor`（沿本地 x） | `{}` |
| `pillar` 柱子 | `w = 0.6`, `d = w`, `h = b.height`, `matKey`（给贴图材质就按世界尺寸平铺）, `color` | `{ piece }` |
| `sign` 发光指示牌 | `w = 0.4`, `h = 0.15`, `y = 2.2`, `backColor`, `color`（缺省出口绿） | `{ piece }` |
| `hole` 地上的坑 | `r = 1.1`, `irregular = true`, `rimColor`（不挡路） | `{ disc, rim }` |
| `wallWithOpening` 开洞的墙 | `w = 3`, `h`, `t = 0.2`, `openW = 1`, `openY0 = 0`, `openY1 = 2.1`, `matKey`, `color` | — |

外观对照：`__br.start({ mode: 'test', levelId: 'dev' })` 后走到区块 (−1, 0)（世界 x −24..0），每种构件摆了一件；截图见 `tests/output/kit-show-*.png`。
构件不够还原版本描述时，在自己文件里用 `b.push/b.box/b.cylinder` 拼（参照 `_kit.js` 里 `desk`、`vending` 的写法），颜色用 `'kit:prop'` 顶点色，不要为一件家具新建材质。

---

## 9. 出口 `BR.kit.exit(b, opts)` → `ExitHandle`

```js
kit.exit(b, { to: '1', kind: 'door', x: 6, z: 11.9, rot: Math.PI, style: 'metal', label: '维修通道' });
kit.exit(b, { to: 'Level 27', kind: 'stairs', x: 18, z: 20, stairs: { down: true } });   // 范围外 → 自动 sealed
```

| opts | 说明 |
|---|---|
| `to` | 目标层。`'7'`、`'Level 7'`、`'Level !'`（→ `'run'`）、`'Level Fun'`（→ `'fun'`）、`'The Void'`（原样）都行，kit 统一规整 |
| `kind` | `'door' \| 'stairs' \| 'elevator' \| 'noclip' \| 'hole' \| 'zone' \| 'event'` |
| `x, z, rot, y` | 位置（当前坐标系）、朝向（正面朝 +Z）、高度（多层结构） |
| `radius` | 触发半径；缺省按 kind（下表）。sealed 的提示圈至少 1.4 m（"靠近就提示"） |
| `label` | 缺省 `'前往 Level X'` / `'Level X 尚未开放'` |
| `sealed` `sealedText` | 一般不写，kit 自动判：`to` 不在 `BR.LEVEL_ORDER`（也不是 dev）→ `sealed: true`、`sealedText: 'Level X 尚未开放'` |
| `active` | 缺省 `kind !== 'event'` |
| `tag` | 自定义标记，`BR.kit.handles({ tag })` 找回 |
| kind 专属 | `door: { …door opts }` + `style`；`stairs: { …stairwell opts }`；`elevator: { …elevator opts }`；`hole: { r, … }`；`marker: true \| { color, pulse }`（zone 地上发光圈）；noclip 的 `w, h = b.height, thickness = 0.2, matKey, color, glitch = 1` |

| kind | 实物 | 触发点（本地）/ 缺省半径 |
|---|---|---|
| `door` | 关着的门（有碰撞），可带墙 | 门前 z = +0.7 / 0.8 |
| `stairs` | down：黑洞 + 栏杆；up：台阶进黑门洞 | down z = −0.9，up z = −0.4 / 0.8 |
| `elevator` | 关着的电梯门 | 门前 z = +0.75 / 0.85 |
| `noclip` | 一段**无碰撞**的墙，独立 mesh，按时间哈希轻微错位、偶尔闪没 | 墙中心 / 0.9 |
| `hole` | 地上的坑（不挡路） | 中心 / r × 0.75 |
| `zone` | 无实物（`marker` 可加发光圈） | 中心 / 1 |
| `event` | 无实物，**缺省不激活** | 中心 / 1 |

world 的处理（`js/game/world.js`，层级不用管）：
- 玩家进圈（水平距离 ≤ radius、脚底高差 ≤ 2.5 m）的那一刻触发，站着不重复触发；出生点落在圈里不算。
- 普通出口：`emit('exit:reach')` → 淡出换层；`door` 播开门声；`noclip` 播 `BR.audio.play('noclip')` + `BR.gfx.flash` 闪白。联机客机交给房主广播。
- `sealed`，或目标在范围内但层级文件还没注册：**不换层**；进圈 toast 一次，站在圈里 `hud.prompt` 一直显示，出圈收起。
- `active === false`：跳过。

**切出墙**（kind `'noclip'`）必须放在拆掉的墙段上，否则真墙挡着走不进去：
```js
const ed = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
g.setWall(ed.axis, ed.i, ed.j, false);                                     // 先拆真墙
kit.exit(b, { to: '1', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: 'L0:wall' });   // 用本层墙材质才像"墙在闪"
g.reserve(ed.i, ed.j);
```

**事件型出口**（走够久、灯同步闪、派对门出现……）：kit 只产生描述，条件在层级里判定。
```js
// buildChunk：摆一扇先隐藏的门 + 事件出口
const door = kit.prop.door(b, 12, 9, 0, { style: 'wood', solid: false });   // 摆在墙段上：g.setWall('h', 4, 3, true) 那段
door.leaf.setVisible(false);
const h = kit.exit(b, { to: 'fun', kind: 'event', x: 12, z: 9.7, radius: 0.8, tag: 'party-door' });
b.update((dt, t) => { const on = t > 30; if (h.active !== on) { h.setActive(on); door.leaf.setVisible(on); } });   // 区块内状态放 b.update
// 或者全层条件放 level.update：
update(ctx, dt) { for (const h of BR.kit.handles({ tag: 'party-door' })) h.setActive(S.timer > 600); }
```
- `ExitHandle`：`setActive(bool)`、`active`、`sealed`、`to`、`kind`、`x`、`z`、`desc`（推给 world 的描述）、`parts`（实物的 Piece：door `{ leaf }`、elevator `{ left, right }`、noclip `{ mesh }`、hole `{ disc, rim }`、zone `{ marker }`）。
- 玩家站在圈里时 `setActive(true)` 会立刻触发 —— "被追上就掉下去"这类强制换层也这么做（在玩家脚下放一个 event 出口再激活），**不要直接调 `BR.world.goTo`**（会绕过未开放判定和联机同步）。
- `BR.kit.handles({ kind, to, tag })` 返回已载入区块里的句柄；区块卸载后句柄作废，每次用时重新取。

---

## 10. 灯光

- 层级**只给灯光描述**（`b.light` 或构件自带），gfx 每帧挑离相机最近的 `BR.config.world.maxDynamicLights`（6）盏实体化，其余靠发光面片。不要自己 `new THREE.PointLight`。
- `range` 一般 6–12 m（越大越费、`lightAt` 查询越宽）；`intensity` 0.6–1.4；色温：冷白 `0xe8f0ff`、日光灯 `0xfff1d0`、暖黄 `0xffd9a0`、钠灯 `0xffb060`、红房间 `0xff5040`。
- 闪烁：`flicker` 0..1，gfx 按灯坐标和时间哈希（纯函数：重载区块闪法不变），`linkGlow` 让面片同步。坏灯 `state: 'broken'`；整片断电区不放灯描述、`env.ambient` 放低。
- 运行时开关灯：改描述的 `intensity`（`lightPanel` 的 off 灯存了 `onIntensity`）。全层同步闪（"灯光同步闪烁时出现门"）：在 level.update 里遍历 `BR.world.chunks()` 的 `lights` 改 `flicker`。
- 灯的密度：迷宫层每 2 格一盏（每块 16 盏描述）足够；描述数量本身不贵，但每块 > 30 盏会拖慢 `lightAt`。

---

## 11. 高度场（多层结构、坡道、下沉地面）

phys 没有自动上台阶：高度变化只能走地面函数，低矮盒子会直接挡住。
```js
enter(ctx) {
  const HF = kit.heightField;
  HF(HF.stack(
    HF.ramp({ minX: 0, maxX: 6, minZ: 10, maxZ: 12, axis: 'x', y0: 0, y1: 1.5 }),   // x 方向从 0 升到 1.5
    HF.flat({ minX: 6, maxX: 12, minZ: 10, maxZ: 12, y: 1.5 }),
    (x, z) => undefined,                                                            // 自定义：返回数字生效，undefined 交给下一个
  )).install();                                                                     // = BR.phys.setGroundFn
},
```
- `kit.heightField(fn)` → `f`（`f(x, z)` 非有限数时 phys 退回 0；`f.at(x, z)` 取数、`f.install()` 装上）。坐标是**世界坐标**；无限重复的结构用 `((x % S) + S) % S` 取区块内坐标。
- **必须在 `enter` 里装**：enter 在建区块之前，`b.spawn` 的 y、`b.groundY` 才读得到。换层时 world 调 `phys.clear()` 会复位地面函数，`leave` 不用管。
- 楼上楼下的出口给 `y`（world 按脚底高差 2.5 m 区分）；刷新点 `b.spawn(x, z, tag, { y })` 或让它读高度场。

---

## 12. 实体表（WAVE2.md 第 4 节）

world 对每个载入的区块、每个条目：`数量 = stochasticRound(officialPer1000m2 × 区块面积 / 1000 × spawnFactor)`，在刷新点上生成。
`spawnFactor`：游玩满格 0.5、噩梦 简单/中等/困难/地狱 = 0 / 0.2 / 0.4 / 0.6、测试 0（手动放）。`officialPer1000m2` 写"正常后室"的密度，**不要**自己乘模式系数。

换算，过程写成注释：
- **版本给了数字**：
  - "每平方公里约 N 只" → `N / 1000`。
  - "每走 X 米走廊遇到 1 只" → 按走廊宽 w 米：`1000 / (X × w)`。例：每 200 m、走廊 2.8 m → `1000 / 560 = 1.79`。
  - "一群 4–8 只、每片区域一群" → 按**只数**算（平均 6 只 / 区域面积），群体行为由实体文件处理。
- **只有定性描述**：直接引用 `BR.config.densityWords.<词>`（none 0、rare 0.04、low 0.12、moderate 0.35、high 0.9、extreme 2.2），注释写原文。
- **版本说没有实体**：`entities: []`，不为热闹加实体；版本里没有友善实体就不虚构。
- 只列 `data/entity-index.json` 里 `levels` 含本层、且 `js/entities/<key>.js` 已存在或本批在实现的类型；未注册的类型 world 会跳过并 warn。

量级自检：5×5 块（24 m 区块 = 14 400 m²）内期望只数 ≈ `Σ per1000m2 × 14.4 × spawnFactor`；超过 `maxActiveEntities`（28）的会被丢弃。
出生块周围 3×3 块不刷有害实体；`b.spawn(…, { safe: true })` 的点也不刷。

---

## 13. 物品表

- `items: [{ type, per1000m2 }]`：world 每块每种 `stochasticRound(per1000m2 × 区块面积 / 1000)`，**不乘 spawnFactor**（所有模式都刷），每件占一个不同的刷新点。
- **必有杏仁水和至少一种食物**（用户规则，选中版本说本层没有也照刷，注释写明"用户规则"）。
- 数值取 `data/item-spawn.json`：`levels` 含本层的条目都放，`perLevel[本层]` 优先：

```bash
python3 - <<'PY'
import json, os
ID = '7'; ROOT = '/Users/xuanjiang/Downloads/project/backrooms'
spawn = json.load(open(ROOT + '/data/item-spawn.json'))
files = set(f[:-3] for f in os.listdir(ROOT + '/js/items'))
for k, v in spawn.items():
    if k.startswith('_') or ID not in v.get('levels', []): continue
    base = k.split('_blue')[0].split('_green')[0].split('_red')[0].split('_expired')[0].split('_artificial')[0].split('_black')[0]
    print("{ type: '%s', per1000m2: %s },   // %s%s" % (k, v.get('perLevel', {}).get(ID, v['per1000m2']), v.get('basis', '')[:60], '' if base in files else '  ← 物品文件不存在'))
PY
```
- 刷新点要够：`Σ per1000m2 × 面积 / 1000` 远小于每块刷新点数（第 16 节要求每块 ≥ 20 个）。

---

## 14. enter / update / leave 与危害

| 钩子 | 时机 | 用途 |
|---|---|---|
| `enter(ctx)` | 清场后、**建区块之前** | 装高度场、预算全层数据、重置层级状态 |
| `update(ctx, dt)` | 每帧，区块动画之后、出口检测之前；`dt ≤ 0.1` | 事件出口条件、全层现象（同步闪灯、追逐）、危害 |
| `leave(ctx)` | 换层/回主页清场时 | 收起自己挂的 `hud.prompt`、停自定义音效 |

- 层级状态放模块级变量（`const S = { timer: 0 }`），在 `enter` 里重置。
- 不要长期持有区块对象（会被卸载）；每帧用 `BR.world.chunks()` / `chunkAt(x, z)` / `kit.handles()` 取。`BR.world.chunkCoordsAt(x, z)`、`chunkBounds(cx, cz)` 做区块换算。
- 事件条件用确定性输入（累计时间、玩家位置、区块坐标），不用 `Math.random`。
- 提示文字优先 `BR.hud.toast(text, ms)`；`BR.hud.prompt` 是全局唯一的一行，world 的"尚未开放"也用它。
- **环境危害伤害约定**（全层统一）：`if (BR.game.attackPlayers) BR.player.damage({ hp, sanity, source: 'hazard:<名字>' })` —— 游玩/测试模式只给视觉、声音提示，不扣血（和"游玩模式实体不打玩家"一致）。san 在游玩模式本来就不结算。
- 音效：`BR.audio.play(name, pos?, { volume, rate })`，name ∈ `'step' 'step-wet' 'pickup' 'drink' 'eat' 'hurt' 'death' 'whisper' 'giggle' 'growl' 'screech' 'door' 'noclip' 'heartbeat' 'buzz' 'static' 'click' 'hit'`；屏幕效果 `BR.gfx.flash(color, seconds, peak)`。需要新音色/手电/天气写进 `apiRequests`。

---

## 15. 贴图（tools/textures/gen.sh）

先想能不能不生成：现有贴图 `wallpaper_l0 carpet_l0 carpet_light ceiling_tile ceiling_light light_panel concrete concrete_wet`（jpg）和 `metal noise`（程序化）；构件、家具用 `'kit:prop'` 顶点色，不需要贴图。
包体预算：`assets/tex` 下 jpg 合计 1200 KB，现有约 380 KB，23 层分 → **每层最多新增 1 张 512² 或 2 张 256²**。

步骤（多个代理并行，`prompts.json`、`process.py` 只用 Edit 插入自己那一行，不整文件重写，改之前重新读一遍）：
1. **命名**：`l<id>_<材质>`，小写下划线（`l6_concrete_dark`、`lfun_carpet_party`）。
2. **prompt**：在 `tools/textures/prompts.json` 加 `"l6_concrete_dark": "<英文，只描述材质本身：材料、颜色、磨损、污渍>"`。
   不用写"无缝、正交、无光影、无文字、后室氛围"—— `_common` 会自动拼在后面。颜色描述照选中版本的 `materials/colors`。
3. **后处理参数**：在 `tools/textures/process.py` 的 `SPEC` 里加：
   ```python
   "l6_concrete_dark": dict(src="l6_concrete_dark", size=256, kind="tile", mean_rgb=(60, 58, 55), chroma=0.6, destripe=True, soften=0.35),
   ```
   - `size` 256 或 512；`kind` 普通材质用 `"tile"`（`"ceiling"` 是吊顶专用、`"panel"` 是灯盘专用）。
   - `mean_rgb`：成品平均色（sRGB），按版本颜色描述定 —— 生成图的色相靠不住，这里强制拉过去。`chroma`：色度起伏倍率（水泥 0.6、墙纸 1.0）。
   - 随机纹理（地毯、水泥、泥土）加 `destripe=True, soften=0.35`；规律花纹（墙纸、瓷砖）加 `periodic=True`。
4. **生成**：`VIBETOOL_KEY_FILE=<调度脚本给的 key 文件路径> tools/textures/gen.sh l6_concrete_dark`
   - 只传自己的名字。已有原图默认跳过；`FORCE=1` 重新生成；`ONLY_PROCESS=1` 不调接口只重跑后处理。单张 1–5 分钟，卡住会自动补交。
   - 原图落在 `tools/textures/raw/<名字>.png`，成品 `assets/tex/<名字>.jpg`；gen.sh 最后跑一遍 process.py，打印"接缝/内部差异比"（≈1 好，> 1.5 重生成）和包体合计。
   - key 只通过 `VIBETOOL_KEY_FILE` 传，不写进仓库、不打印、不出现在返回值里。
5. **检查**：Read `assets/tex/<名字>.jpg` 看颜色与重复感。
6. **使用**：`kit.mat('L6:floor', { tex: 'l6_concrete_dark', repeatMeters: 2.5 })`。
7. **file:// 兜底**（双击 index.html 打开时不能读 jpg）：在层级文件顶部注册一个简单画法，否则会 warn 并显示占位图：
   ```js
   BR.assets.registerProcedural('l6_concrete_dark', 256, (g, s) => {
     g.fillStyle = '#3c3a37'; g.fillRect(0, 0, s, s);
     const r = U.rng('l6_concrete_dark');
     for (let k = 0; k < 900; k++) { const v = 40 + r() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; g.fillRect(r() * s, r() * s, 2, 2); }
   });
   ```
不在 `assets.js` 预载清单里的贴图第一次用时才加载，头几帧显示占位色，可以接受；不要改 `assets.js`。

---

## 16. 性能约束（中端安卓 30 fps）

| 项 | 上限 | Level Dev 实测 |
|---|---|---|
| 每块 mesh（= 材质种类 + `b.object` + 切出墙） | ≤ 8 | 5–7 |
| 每块三角形 | ≤ 8000 | 平均 1457，构件展示间 4310 |
| 出生点一帧 draw call（`BR.gfx.renderer.info.render.calls`） | ≤ 120 | 71 |
| 每块刷新点 | ≥ 20 | 60+ |
| `b.object` 独立物体 | 每块 ≤ 2 | — |
| 每块灯描述 | ≤ 30，range ≤ 12 | 16 |
| `buildChunk` 耗时 | 桌面 ≤ 8 ms（world 每帧最多建一块） | — |

- 层级自己的材质控制在 3–4 种（墙、地、顶 + 一种特殊），装饰件全部走 `'kit:prop'`。
- 贴图 512² 以内；不开阴影；不用 `MeshStandardMaterial` 除非版本描述离不开金属反射；透明材质尽量少（排序和 overdraw 贵）。
- `b.update` / `level.update` 里不分配对象、不建几何；`piece.setColor/setVisible` 每帧只改少量件（`linkGlow` 已经做了变化检测）。
- 用 THREE 几何喂 `b.mesh` 后立刻 `geometry.dispose()`；`segments` 保持 6–12。
- `chunkSize` 24 适合室内迷宫；开阔层（户外、洞穴、大厅）用 32–48，并相应放大 `fogFar`（≤ chunkSize × 2）。

---

## 17. 验收截图

首选第二波的预览工具：`node tests/preview.mjs --level <id> --shots 6`（自动注入还没进 index.html 的脚本），Read 每张截图对照选中版本逐条核对。
需要自己补截图时，照 `tests/kit.mjs` 的写法（静态服务 + Playwright + SwiftShader，`boot/tp/shot` 三个函数和俯视图可以直接抄）：
```js
await page.evaluate(() => { __br.start({ mode: 'test', seed: 20260913, levelId: '7' }); __br.setAuto(false); __br.step(0.5); });
await page.evaluate(a => { Object.assign(BR.player, { x: a.x, z: a.z, yaw: a.yaw, pitch: 0, vx: 0, vz: 0 }); __br.step(0.3); }, { x: 12, z: 12, yaw: 0 });
await page.screenshot({ path: 'tests/output/L7-spawn-north.png' });
```
- 开局头几秒屏幕中间有层级名大字（`.hud-title`），截图前注入 `.hud-title{display:none!important}` 样式（`tests/kit.mjs` 就这么做）。
- 必须有的截图：出生点四个方向；每种地标/区块变体；每种出口实物站在跟前（sealed 的要能看到"尚未开放"提示）；5×5 块俯视图（碰撞体、刷新点、出口，见 `tests/kit.mjs` 末尾）；游玩模式满格时的实体；无光/昏暗层用默认能见度 0.7 截。
- 逐项看：没有洋红色（漏定义材质）；区块边界没有看穿的半堵墙；出生点不在墙里；出口在俯视图上可达；draw call ≤ 120；每块三角形 ≤ 8000（`BR.world.chunks()[i].res.kit.stats`）；控制台零 error、零 `[kit]` warn。

改了 `_kit.js`（只有地基维护者）要跑 `node tests/kit.mjs`（40 项）和 `node tests/smoke.mjs`。

---

## 18. 返回值与自检

返回值包含：
1. 文件：`js/levels/L<id>.js`，以及要加进 `index.html` 的一行 `<script src="js/levels/L<id>.js"></script>`（放在 `js/levels/_kit.js` 之后，按 `BR.LEVEL_ORDER` 顺序）；新增贴图名与 KB。
2. 实现了的描述细节（逐条，对应 environment / landmarks / hazards / mechanics / exits 的原文）。
3. 没实现的细节 + 原因。
4. 实体表、物品表的换算依据。
5. 截图路径。
6. `apiRequests`（引擎/kit 缺的能力）。

自检清单：
- [ ] 文件头：来源版本、URL、许可 CC BY-SA 3.0；`version` = lore-choices 的 `source`；没有其他版本的细节。
- [ ] `node --check js/levels/L<id>.js` 通过；经典 IIFE，只挂 `window.BR`。
- [ ] `buildChunk` 只用 rng / levelSeed 派生流；rng 消耗顺序固定。
- [ ] 格子边界参数全层一致；特殊区块也调了 `kit.grid` + `gridWalls`。
- [ ] 选中版本的每个出口都有实物；范围外的没改成通往别处。
- [ ] 切出墙放在拆掉的墙段上、用本层墙材质。
- [ ] 实体表按第 12 节换算并注释；没实体就 `[]`。
- [ ] 物品表有杏仁水和食物。
- [ ] 危害伤害按第 14 节约定只在 `attackPlayers` 时扣血。
- [ ] 性能表各项在上限内；截图齐全且逐张看过。

## 附：墙体外观（用户 2026-09-13 指定）

- `BR.kit.gridWalls` 的默认墙厚已改为 **0.2 × 4/3 ≈ 0.267 m**（用户要求在原厚度上加 1/3）。没有设定依据就不要自己传更薄的 `thickness`。
- **黄色墙纸的房间**（Level 0 这类单调黄墙）：
  - 墙纸用 `wallpaper_l0`（贴图已整体压暗 10%，用户要求墙色略深一点点，不要再自己调亮）；
  - 踢脚线用黄色木质矮条：`kit.gridWalls(b, grid, { ..., trim: BR.kit.trims.yellowWood })`，单独摆放用
    `const yw = BR.kit.trims.yellowWood; BR.kit.prop.baseboard(b, x, z, rot, { length, h: yw.h, t: yw.t, color: yw.color, matKey: yw.matKey })`（高 7 cm、厚 1.8 cm、贴图 `baseboard_wood`）。
- 其他材质的层级（水泥、管道、办公室等）按选中设定版本自己决定踢脚线，不强行套黄木踢脚线。

## 附：范围决定（用户 2026-09-13）

- **M.E.G. 等据点/基地**：挂上游戏大厅之后单独做。现在层级里按选中版本只摆静态建筑、标识、围挡等外观，不做可进入的交互、驻守 NPC 或据点逻辑。
- **交易系统**：同样挂上大厅之后再做。现在不要为交易品设计交互（例如"交给某实体换东西"），物品保持自用。
- **NPC 对话**：不做。实体描述里的说话、交谈、喊话一律不实现，也不要做文字气泡；需要时用已有音效表现"在说话"。
