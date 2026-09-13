# 创意工坊与设置 —— 需求与接口约定

需求原文（用户 2026-09-13）：主页再加两个按钮「创意工坊」「设置」。创意工坊可以制作自己的后室：先选起始层级，再删除/添加墙壁，也可以放置实体（保存后正式游玩时在那里刷，玩家足够接近才刷），可以改动出口位置和后室的基本设置；地图确认保存后，保存完的信息里有「游玩」按钮，选择模式游玩。设置可以设置实体上限、背景音乐大小等。

已告知用户的默认设计：出生点周围 7×7 区块可编辑、范围外照常生成；俯视编辑 + 3D 预览；放置实体默认 20 m 触发、被打死不复活；本机保存、首期不做上传分享；联机时房主把地图同步给客机。

所有规则仍受 ARCHITECTURE.md 约束（经典 script、r147、中文注释、DOM 自建前缀、z-index 表）。

## 1. 文件归属

| 文件 | 负责 | 说明 |
|---|---|---|
| js/game/workshop.js | 工坊核心 | 地图数据、本机存储、运行时钩子 |
| js/levels/_kit.js | 工坊核心（授权最小修改） | grid 墙编辑钩子、exit 钩子、Builder.finish 装饰钩子 |
| js/game/world.js、js/main.js、js/net/coop.js（地图同步部分） | 工坊核心（授权最小修改） | 环境/密度/出生点覆盖、game:start 的 workshop 字段、联机同步 |
| js/ui/workshop.js、css/workshop.css | 工坊界面 | 地图列表、编辑器、保存信息卡、模式选择 |
| js/ui/settings.js、css/settings.css | 设置 | 设置面板与应用 |
| js/ui/home.js（只加两个按钮） | 设置 | 「创意工坊」「设置」 |
| js/core/audio.js（音量分组）、js/net/coop.js（语音音量） | 设置（授权最小修改） | |
| index.html | 集成 | |

两个代理都要改 coop.js 时：工坊核心只加 `workshopMap` 同步，设置只加 `setVoiceVolume`，各自改自己那几行，互不覆盖对方（改前先重新读文件）。

## 2. 地图数据（WorkshopMap，版本 1）

```js
{
  v: 1,
  id: 'ws_ab12cd34',              // 本机唯一
  name: '我的后室',
  baseLevel: '0',                 // 起始层级，必须是已注册的首期层级
  seed: 123456789,                // 固定种子：编辑时看到的布局 = 游玩时的布局
  radius: 3,                      // 可编辑半径（区块数），3 → 7×7
  createdAt: 0, updatedAt: 0,     // ms
  spawn: null,                    // 或 { x, z, yaw }：出生点覆盖
  settings: {
    visibility: null,             // null = 跟随玩家设置；0..1 = 固定
    lightMul: 1,                  // 灯光亮度倍率 0.2..1.5
    flicker: 'level',             // 'level' | 'off' | 'more'
    blackout: false,              // 全部熄灯（环境光压到很暗）
    ambient: 'level',             // 'level' 或 BR.audio 预设名
    autoEntities: true,           // 保留层级自带的实体生成
    entityDensityMul: 1,          // 0..2
    autoItems: true,              // 保留层级自带的补给（食物与杏仁水无论如何都刷 —— 用户规则"所有模式都刷食物和杏仁水"）
    itemDensityMul: 1,            // 0..2
    sanityDrainMul: 1,            // 0..3，乘在层级 env 上
    hungerDrainMul: 1,            // 0..3
    triggerRadius: 20,            // 放置实体的默认触发距离（米）
  },
  walls: [ { k: 'v@12.00,36.00', on: false } ],      // 格子边编辑，见第 3 节
  freeWalls: [ { x, z, len, rot, h } ],               // 非格子墙（层级不用 grid 的地方），只加不删
  entities: [ { id: 'p1', type: 'hound', x, z, yaw, radius: null } ],   // radius null = settings.triggerRadius
  exits: {
    removed: [ '0@1,0#2' ],
    moved:   [ { key: '0@1,0#2', x, z, rot } ],
    added:   [ { id: 'x1', to: '1', kind: 'door', x, z, rot, label: '' } ],
  },
}
```

存储：`localStorage['backrooms_workshop_v1'] = { maps: [WorkshopMap, ...] }`；单图 JSON 超过 200 KB 时拒绝保存并提示。

## 3. 墙：用世界坐标标识格子边

- 一条格子边用"方向 + 世界坐标中点（保留两位小数）"做 key：竖边（沿 Z 方向延伸）`v@<x>,<zMid>`，横边 `h@<xMid>,<z>`。区块交界线上的边被两侧区块算出同一个 key，所以两边自然一致。
- 钩子：`gridWalls(b, g, opts)` 在 `if (g._dirty) g.reconnect()` **之前**调用 `BR.workshop.applyGrid(b, g)`：
  - 对落在本 grid 上的每条编辑边设置开关。区块交界线上的边也允许改（工坊编辑两侧都会应用），为此给 grid 加一个只供工坊用的内部方法绕过 `setWall` 的边界保护。
  - 本 grid 有任何工坊编辑时**跳过自动 reconnect**：创作者故意封路是合法的。编辑器负责在出生点被围死时给出警告。
- 不在工坊地图里（`BR.workshop.active` 为空）时钩子什么都不做，现有层级行为完全不变。

## 4. 出口

- `BR.kit.exit(b, opts)` 为每个出口生成稳定 key：`<levelId>@<cx>,<cz>#<n>`，n 是该区块内第几次调用 exit（区块生成只依赖 rng，所以稳定）。出口描述对象带上 `key`。
- 钩子：exit() 开头调用 `BR.workshop.exitOverride(b, key, opts)`：返回 `null` → 整个出口不建（没有实物、没有触发圈）；返回新 opts → 按新位置建；返回 `undefined` → 不变。
- 新增出口：`Builder.finish()` 合并前调用 `BR.workshop.decorate(b)`，对落在本区块的 `exits.added` 调 `BR.kit.exit`（key 前缀 `ws:`），同时建 `freeWalls`。

## 5. 放置实体与触发

- 地图激活且处于游玩（不是编辑）时，main 每帧调 `BR.workshop.update(dt)`：对每个还没刷出的放置实体，若本机玩家（房主还要算 `BR.coop.peer`）进入触发距离 → `BR.entities.spawn(type, x, BR.phys.groundY(x, z), z, { manual: true, id: 'ws:' + p.id, yaw })`，标记已刷出。本局内被打死不再复活。
- 联机客机不刷（实体只在房主模拟，走快照）。
- 三种模式都刷放置实体（测试模式的 autoSpawn=false 只关层级自带生成）；攻击规则照 entities.js 阵营规则与 `attackPlayers`。

## 6. 基本设置如何生效（整张地图，含可编辑范围外）

- `world.start`：`level.spawn` 结果交给 `BR.workshop.spawnOverride(spawn)`；`level.env` 交给 `BR.workshop.envOverride(env)`（visibility、ambient 预设、环境光、san/饥饿倍率、blackout）。
- 灯光：`lightMul`、`flicker`、`blackout` 作用于区块灯光描述（world 汇总给 `gfx.setLightSources` 之前统一处理）和环境光。
- 密度：world 生成物品时每条乘 `BR.workshop.densityMul('items', type)`（`autoItems=false` 时返回 0，但 `almond_water` 与食物类始终 ≥1）；entities.spawnForChunk 的密度乘 `BR.workshop.densityMul('entities', type)`（`autoEntities=false` 时为 0）。

## 7. BR.workshop（js/game/workshop.js）

```
list(): WorkshopMap[]                     按 updatedAt 倒序
get(id); create(baseLevel, name?) → 未保存的新地图（新随机种子）
save(map) → { ok, error }；remove(id)；duplicate(id)
active: WorkshopMap | null；editing: bool
activate(map, { editing })；deactivate()
// 钩子（active 为空时都是空操作）
applyGrid(b, g)；exitOverride(b, key, opts)；decorate(b)
envOverride(env) → env；spawnOverride(spawn) → spawn；densityMul(kind, type) → number；lightTransform(list) → list
update(dt)
// 编辑辅助（基于已载入区块）
edgeAt(x, z) → { key, axis, on, x0, z0, x1, z1 } | null    离点最近的格子边
exitsNear(x, z, r) → [{ key, to, kind, x, z, rot, label, source: 'base' | 'added', sealed }]
inRadius(x, z) → bool
```

`game:start` payload 新增 `workshop: mapId`（或联机客机收到的地图对象）：main 先 `BR.workshop.activate(map, { editing: false })`，再 `world.start(map.baseLevel, map.seed)`；`game:home` 时 `deactivate()`。
联机：房主 `{ t: 'world', seed, levelId, settings, workshopMap }`，客机收到后激活这份地图对象（不写入本机存储）再开局。

## 8. 编辑器界面（js/ui/workshop.js，class 前缀 ws-，z-index 58）

- **地图列表**：主页「创意工坊」打开。「新建」（选起始层级 + 名称）；每张图一张卡片：名称、起始层级、更新时间、改动统计（墙/实体/出口），按钮「编辑」「游玩」「删除」（二次确认）。
- **编辑器**：
  - 进入时 `activate(map, { editing: true })`，以 `map.seed` 载入起始层级；编辑态不跑实体 AI、不刷任何实体和物品，把可编辑范围内的区块全部载入。
  - 俯视正交相机；相机放在层级天花板略下方朝下看，天花板被近裁剪面切掉。提供"剖切高度"滑条，适配不同层高。
  - 拖动平移，滚轮 / 双指缩放；可编辑范围外盖暗色遮罩并画边框。
  - 工具栏：选择、删墙、加墙（点格子边切换；非格子区域拖出一段自由墙）、放实体（面板按层级分组，同测试模式列表）、出口（拖动移动、删除、添加并选目标层级）、出生点、基本设置（面板，覆盖第 2 节 settings 全部字段）、3D 预览（第一人称走动，Esc 返回俯视）、撤销、重做、保存、退出（有未保存改动时确认）。
  - 叠加标记：实体（阵营色圆点 + 中文名 + 触发半径圈）、出口（门形图标 + 目标层级，范围外出口标"未开放"）、出生点（旗子）。
  - 出生点所在格被围死时，保存前警告，但允许保存。
- **保存后的信息卡**：名称、起始层级、改动统计，「游玩」→ 模式选择（游玩 / 噩梦生存四档难度 / 测试模式）→ emit `game:start { mode, difficulty, settings, seed: map.seed, workshop: map.id }`；游玩模式下「联机」按钮沿用 BR.coop。
- 手机：工具栏底部横排可滚动，按钮 ≥ 44 px，safe-area，面板 overscroll-behavior:contain。

## 9. 设置（js/ui/settings.js + css/settings.css，class 前缀 set-，z-index 58）

- 主页「设置」打开。设置项：
  - 实体上限：8–60，默认 28。说明文字：调低后实际实体可能少于模式比例。
  - 总音量、背景音乐（环境音）音量、音效音量、联机语音音量。
  - 视角灵敏度、画质（低/高，抗锯齿需刷新时提示）、默认能见度。
  - 「恢复默认」。
- `localStorage['backrooms_settings_v1']`；启动时应用，改动实时生效：
  - `BR.config.world.maxActiveEntities`
  - `BR.audio.setMaster(v)`，以及新增的 `setAmbientVolume(v)`、`setSfxVolume(v)`：audio.js 里环境层和单次音效各接一个 GainNode 再进主总线；unlock 前调用只记状态。
  - `BR.coop.setVoiceVolume(v)`：远端语音音量
  - `BR.input.sensitivity`
  - `BR.game.settings.quality` / `visibility`
- 主页两个新按钮加在「游玩」上方，竖排，次要样式；「创意工坊」调 `BR.workshopUI.open()`，「设置」调 `BR.settingsUI.open()`（都做存在性判断）。

## 10. 验收（tests/workshop.mjs + 回归）

- 新建基于 Level 0 的地图：
  - 删一段墙：模型和碰撞体都没了；加一段墙：碰撞体生效；区块交界线上的边改完两侧一致。
  - 放 hound，触发半径 20：远处不刷，走近才刷。
  - 移动、删除、新增出口，都在新位置生效。
  - 禁用自动实体后，只剩放置的实体。
  - 改能见度、灯光。
- 保存后刷新页面，地图仍在。
- 从信息卡「游玩」：
  - 游玩模式：实体不打玩家。
  - 噩梦模式：实体会打玩家。
  - 测试模式：放置实体也会刷。
- 联机（复用 tests/coop.mjs 的信令模拟）：客机拿到同一张地图，墙的改动、出口、放置实体都一致。
- 设置：各项生效并持久化；实体上限影响 spawnForChunk 的丢弃数。
- 回归：smoke、kit、items、coop 全部通过；非工坊地图的层级布局与改动前逐字节一致（kit.mjs 已覆盖）。
