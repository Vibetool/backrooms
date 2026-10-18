# 后室 · The Backrooms —— 架构与接口约定

所有模块必须遵守本文件的接口。改接口前先改这里。

## 0. 硬约束

- **只用经典 `<script>`**，不用 ES module（`file://` 双击也要能跑；中国大陆 CDN 不稳，库全部 vendored）。
- 每个文件包成 `(function () { 'use strict'; const BR = window.BR; ... })();`，只往 `window.BR` 上挂东西，不产生其他全局变量。
- three.js 固定 **r147**（`vendor/three.min.js` + `vendor/GLTFLoader.js` + `vendor/BufferGeometryUtils.js`，全局 `THREE`）。
  r147 的 API：输出色彩用 `renderer.outputEncoding = THREE.sRGBEncoding`，颜色贴图设 `tex.encoding = THREE.sRGBEncoding`；
  **没有** `renderer.outputColorSpace` / `useLegacyLights` 属性（r152+ 才有，在 r147 里赋值静默无效）。
  `THREE.SRGBColorSpace` 常量虽然存在，但只给 ColorManagement 用，不能用来设置输出。
  合并几何用 `THREE.BufferGeometryUtils.mergeBufferGeometries(geos, useGroups)`。
- 单位：米。Y 轴向上。玩家眼高 1.62 m。
- 性能底线：中端安卓手机 30fps。每个区块合并成少量 mesh；真实光源同时最多 `BR.config.world.maxDynamicLights` 盏（其余灯靠自发光面片）；默认关阴影。
- 注释、UI 文案用中文。

## 1. 脚本加载顺序（index.html）

```
vendor/three.min.js
vendor/GLTFLoader.js
vendor/BufferGeometryUtils.js
js/core/base.js        命名空间、工具、事件总线、常量、模式、注册表（已写好，接口以它为准）
js/core/assets.js      贴图/模型/材质缓存，缺素材时程序化兜底
js/core/audio.js       WebAudio：日光灯嗡鸣、脚步、层级环境音、实体 3D 音效
js/core/gfx.js         renderer / scene / camera / 雾 / 灯光预算 / 低 san 屏幕效果
js/core/input.js       键鼠（指针锁定）+ 手机双摇杆 + 动作按钮
js/core/phys.js        AABB 碰撞、滑动、视线检测
js/game/interact.js    准心对准 + 空格短按使用、长按拖动（交互大改 A1）
js/game/levelstate.js  本局各层状态：拖过的道具、捡走的物资……（A1；联机营地那一层按「一次联机」保存，见第 9 节）
js/game/items.js       物品注册 + 场景拾取物管理
js/game/player.js      玩家：位置朝向、HP/饥饿/san、背包、受伤、原地重生
js/game/world.js       层级载入、区块流式加载卸载、出口触发、层级切换
js/game/entities.js    实体管理：按密度生成、阵营战斗、AI 调度、清场
js/game/hud.js         顶部状态条、交互提示、背包栏、层级名提示
js/game/death.js       死亡结算：继续（原地重生）/ 返回主页
js/game/skin.js        制服颜色：主页换皮肤，测试人与联机对方同步
js/game/testmode.js    测试模式面板：手动放出实体、召唤测试人、清除全部
js/game/forklift.js    叉车模拟 BR.forklift（FE1）：运动学、扫掠碰撞、雷达、升降、头顶障碍、推开物资、下车落点；不建网格、不碰联机
js/game/vehicles.js    载具层 BR.vehicles（FE1）：登记、升格、共用载具网格、部件 OBB、准心候选、上下车、货叉上的物资、声音灯光
js/game/vehicles_net.js 叉车联机表现 BR.vehiclesNet（FE1）：本机开车每帧刷新 hand（网络上随 coop 的 15 Hz me 发出）、远端车插值
                       这三个排在 testmode.js 之后、_kit.js 之前：加载期 BR.kit、BR.L1forklift、BR.coop 都还没有，一律用到时再取（第 15 节）
js/levels/_kit.js      层级搭建工具库 BR.kit（写法见 js/levels/_TEMPLATE.md），排在所有层级文件之前
js/levels/_camp.js     营地构件 BR.camp（帐篷、行军床、营地范围），排在 _kit.js 之后、各层级之前
js/levels/L0.js … L20.js, Lfun.js, Lrun.js
js/levels/Lcoopcamp.js 联机营地（隐藏层 coopcamp），紧跟在 L1.js 之后（要用 L1.js 导出的 BR.L1room）
js/entities/<type>.js
js/items/<type>.js
js/net/net.js          复用火箭游戏的 WebRTC 信令（2 人）：建房、加入、营地暗标、房号续期、备用房号重连
js/net/coop.js         联机同步、联机面板
js/game/coopcamp.js    联机营地 BR.coopCamp：帐篷、共享选择、倒数出发、回营地，排在 coop.js 之后、main.js 之前
js/ui/home.js          主页 3D 场景 + 菜单 + 参数面板（含主页「联机」按钮、和帐篷共用的模式表单）
js/ui/tentmenu.js      帐篷选单 DOM BR.tentMenu，排在 home.js 之后
js/main.js             启动、状态机、主循环
```

样式表：`css/coop.css`（联机面板）之后是 `css/tent.css`（帐篷选单）。

## 2. 模式与数值（用户定死，不许改）

见 `js/core/base.js` 的 `BR.MODES`：

| 模式 | 实体攻击玩家 | 饥饿/san | 联机 | 实体数量（相对"正常后室"） |
|---|---|---|---|---|
| 游玩 casual | 否（友善 vs 有害仍互相作战） | 无 | 有 | 滑条 0–100% 映射到 0–50% |
| 噩梦 简单/中等/困难/地狱 | 是 | 有 | N2 打开（N1 期间帐篷里这张卡灰着） | 0% / 20% / 40% / 60% |
| 测试 test | 否（但会攻击测试人；友善 vs 有害仍互相作战） | 无 | 有 | 不自动生成，测试面板手动放出 |

- 「联机」一列以 `BR.MODES[mode].coop` 为准：现在 casual、test 为 true，nightmare 为 false（N2 打开）。
- **联机入口（孩子 2026-10-02 的新话）**：「联机不是在模式里选择，而是在主页里有一个专门的联机按钮，点进去即可找人联机。找人联机后，两人会在一个营地，周围是 level1，被彻底围在一个房间里，会有个帐篷，点进去后即可选择模式和层级，然后就能进去。」
  按这句做：联机在主页单独一个按钮，营地帐篷里选模式（第 9 节）。旧规则「联机仅限游玩模式」**作废**——以前这一节标的「用户定死」，原话其实是「游玩有联机按钮」，并没说只有游玩能联机。
  之前记下的默认「测试模式首期不带联机」也一起作废。主页「游玩」弹窗里不再有联机、开麦按钮；主页单人开局一律不带联机。
- 饥饿 < 20 → 移速 ×0.5；饥饿 = 0 → 移速 ×1/3（`BR.speedMulFromHunger`）。
- 所有模式都刷食物和杏仁水。
- 死亡：结算界面「继续」= 原地重生，背包保留，清除半径 `BR.config.death.clearRadius` 内的实体；「返回主页」。联机时「返回主页」换成「回营地」（要对方同意）和小号的「离开联机」，世界不会停，队友接着玩（第 9.9 节）。
- 设定冲突：每层/每个实体随机选一个来源版本整体采用，记录在 `data/lore-choices.json`，不混合。
- 主页弹窗按钮自上而下：「游玩」「噩梦生存」「测试模式」（前两个的顺序是用户指定的）。
- 测试模式：不自动生成实体（`BR.MODES.test.autoSpawn = false`，world.js 不调 spawnForChunk，物品照常刷）；按 T 或触屏按钮打开实体列表手动放出；可召唤测试人。
- 测试人（`test_dummy`，阵营 `dummy`）：穿玩家当前皮肤的制服（联机时穿召唤者的颜色，两人撞色时头顶挂召唤者的名牌）；有害实体会攻击它，它不还手；以玩家步行速度的一半（`config.player.walk × 0.5`）随机游走；有 HP，被打死倒地后消失。
- 换皮肤：点主页场景里的人弹出色板（`BR.SKINS`：粉、蓝、黄、紫、绿、红），只换防化服材质，防毒面具、靴子、手套、胶带不变。选择存本机，测试人和联机对方看到的都是这个颜色。
- 联机语音：开麦/闭麦切换（默认闭麦），不是按住说话；显示自己和对方是否在说话。开麦只在联机局里（营地和关卡：V 键、触屏麦克风按钮、暂停菜单右上角），主页上没有开麦按钮。

## 3. 全局状态 `BR.game`（base.js 定义）

```
BR.game = {
  screen: 'home' | 'loading' | 'playing' | 'paused' | 'dead',
  mode: 'casual' | 'nightmare' | 'test',
  difficulty: null | 'easy' | 'medium' | 'hard' | 'hell',
  settings: { visibility: 0..1, spawnSlider: 0..1, startLevel: '0', quality: 'low'|'high' },
  spawnFactor: number,       // 相对"正常后室"的实体比例，由 BR.computeSpawnFactor() 算
  attackPlayers: bool, statsEnabled: bool,
  seed: uint32, levelId: string, time: 秒, deepest: string, deaths: int,
  autoSpawn: bool,           // 测试模式为 false
  skin: 'pink'|'blue'|'yellow'|'purple'|'green'|'red',
  coop: { active: bool, role: 'host'|'guest'|null },
}
```

## 4. 事件总线 `BR.bus`

`BR.bus.on(name, fn) → unsubscribe`，`BR.bus.emit(name, payload)`。约定事件：

| 事件 | payload |
|---|---|
| `game:start` | `{ mode, difficulty, settings, seed }` |
| `game:home` | — |
| `level:enter` / `level:leave` | `{ id }` |
| `player:damage` | `{ hp, sanity, source }` |
| `player:death` | `{ cause, levelId }` |
| `player:respawn` | `{ x, y, z }` |
| `item:pickup` / `item:use` | `{ type, id? }` |
| `entity:kill` | `{ killer, victim }`（实体 id 或 'player'） |
| `entity:infect` | `{ id, type, key, toType, source, sourceType }`（实体被感染上；仅房主发，见第 12 节 BR.entities 感染与转化） |
| `entity:transform` | `{ from, to, fromType, toType, x, z, key, cause }`（from/to 为实体 id；cause `'infection'` 到时转化 / `'rise'` 感染尸体爬起；仅房主发） |
| `exit:reach` | `{ to, kind }` |
| `item:pickRequest` | `{ id, type }`（联机客机按互动时发，由 coop 转给房主） |
| `skin:change` | `{ key }` |
| `death:continue` | — |
| `test:spawned` | `{ kind: 'entity' \| 'dummy', id, type, by? }`（by `'me'` / `'peer'`：联机测试模式里谁放的） |
| `net:<kind>` | 对方 `BR.coop.emit(kind, payload)` 发来的事件（A1 事件通道；营地的 `net:tent`、`net:campAsk` 等见第 9 节） |
| `coop:code` | `{ code }`（房主的房号换了：续期、营地里落单后重开） |
| `coop:connected` | `{ role, name }`（hello 对上、联机会话开始；设置面板据此再推一次语音音量。掉线重连回来发的是 `coop:reconnected`） |
| `coop:reconnecting` / `coop:reconnected` | `{ role, name }`（掉线后开始原地重连 / 连回来了） |
| `coop:peerGone` | `{ where: 'camp' \| 'level', name, why }`（队友走了：主动离开 `'left'`、掉线没连回来 `'lost'`、点了「不等了」`'gaveup'`、对方版本旧 `'old'`） |
| `coop:mic` | `{ on, busy, active }`（开麦状态变了） |
| `vehicle:mount` | `{ key }`（本机坐上了这台车；FE1 叉车，见第 15 节） |
| `vehicle:dismount` | `{ key, x, z, side, reason }`（本机下车：落点、哪一边 `'left'`/`'right'`/`'rear'`/`'free'`、原因；强制下车也发） |
| `vehicle:promote` | `{ key }`（停着的车第一次升格进共用载具网格） |
| `net:veh` | `{ k, key, x, z, yaw, steer, lift, tilt, spd, on, lv, t }`（队友开车的位姿，`k` = `'k:' + 车 key`、`key` = 车 key；`on` = h 行第 8 个值（发动机开着，缺省 1）；coop 从队友 `me` 消息的 `h` 拆出来，约 15 Hz，只在同一层时发；房主只为客机拿着租约的车发；见第 15 节） |

`game:start` 的 payload 实际为 `{ mode, difficulty, settings, seed, levelId?, workshop?, coop: null | { role: 'host' | 'guest' } }`：主页开局 `coop` 恒为 null（一律单人）；带 `coop` 的只有联机流程（`BR.coop` 的 startFromLobby / startRun 和客机跟进房主）。`levelId` 用来点名开隐藏层（营地），缺省走 `settings.startLevel`。

`player:death` 的 payload 实际为 `{ cause, causeKey, source, levelId }`：cause 是中文文案，causeKey 如 `'entity:smiler'`、`'sanity'`。

## 5. 层级接口（`BR.levels.register`）

```js
BR.levels.register({
  id: '0', name: 'Level 0', title: '教学关卡', nickname: '',
  version: 'wikidot-cn',                // 随机选中的来源版本，必须与 data/lore-choices.json 一致
  survivalClass: '1',
  chunkSize: 24,                        // 区块边长（米）
  env: {
    background: 0x000000, fogColor: 0x000000,
    fogNear: 2, fogFar: 40,             // 能见度 100% 时的雾；gfx 会按 settings.visibility 缩放
    ambient: { color: 0xffffff, intensity: 0.4 },
    sanityDrainMul: 1,                  // 乘到 BR.config.stats.sanityDrainPerSec 上
    hungerDrainMul: 1,
    audio: 'fluorescent',               // BR.audio.setAmbient 的预设名
    darkness: false,                    // true：无光层级（手电筒/光源规则由层级处理）
  },
  spawn(ctx) { return { x, y, z, yaw }; },
  buildChunk(ctx, cx, cz, rng) { return ChunkResult; },
  entities: [ { type: 'smiler', officialPer1000m2: 0.12 } ],   // "正常后室"的密度
  items:    [ { type: 'almond_water', per1000m2: 0.5 } ],
  exits:    [ { to: '1', kind: 'noclip' | 'door' | 'stairs' | 'zone' | 'event', note: '怎么离开' } ],
  enter(ctx) {}, update(ctx, dt) {}, leave(ctx) {},              // 可选
  // 以下可选，联机营地（N1）起新增，见第 9 节「隐藏层 coopcamp」：
  hidden: true,                         // 不进任何层级列表（主页、帐篷、测试面板、工坊），也不在 LEVEL_ORDER 里；只能由 game:start 的 levelId 点名开
  lobby: true,                          // 联机大厅：HUD 标签写「联机营地（Level 1 某处）」，不显示饥饿 / san / HP；本层状态按「一次联机」保存
  spawnSlots: [ { x, y, z, yaw } ],     // 几个固定出生格（世界坐标）；联机时房主挑一格发给客机（world 消息的 slot）
  keepClear: [ { x, z, r } | { x0, z0, x1, z1, why? } ],   // 拖动禁区（世界坐标）：道具停在区外，规则和出口圈一样，见 BR.world.blockers
});
```

```
ctx = { THREE, BR, level, levelSeed, assets: BR.assets, game: BR.game, scene: BR.gfx.scene }

ChunkResult = {
  group: THREE.Object3D,              // 已合并好的几何，world.js 负责 add/remove/dispose
  solids: [{ minX, minY, minZ, maxX, maxY, maxZ }],   // 世界坐标 AABB
  lights: [{ x, y, z, color, intensity, range, flicker: 0..1 }],
  spawnPoints: [{ x, y, z, tag: 'floor' | 'dark' | 'room' | ... }],   // 保证不在墙里
  exits: [{ x, y, z, radius, to, kind, label, sealed?, sealedText?, active?, tag? }],
  update?(dt),                        // 区块级动画（闪灯、水面）
}
```

- 出口：`sealed: true`（首期范围外，BR.kit 自动判定）或目标层还没注册 → world 不换层：进圈那一刻 toast 一次，站在圈里 `hud.prompt(sealedText)`（缺省 "Level X 尚未开放"），出圈收起。`active: false` 的出口 world 直接跳过（事件型出口由层级 `setActive`）。kind `noclip` 换层时播 `noclip` 音效并 `gfx.flash`。
- 区块生成必须**只依赖** `rng`（= `BR.util.rng(levelSeed, cx, cz)`）→ 联机双方拿同一种子得到完全相同的世界。
  联机营地 coopcamp 是唯一的例外写法：它自己用固定的 `CAMP_SEED` 建 builder（`U.rng(CAMP_SEED, cx, cz)`），布局和游戏种子、画质都无关，仍然完全确定（第 9.6 节）。
- 实体数量：`world.js` 对每个载入的区块、每个 `entities` 条目算
  `BR.stochasticRound(BR.expectedEntityCount(officialPer1000m2, chunkArea, BR.game.spawnFactor), rng)`，
  在 `spawnPoints` 上交给 `BR.entities.spawn`。同时受 `maxActiveEntities` 上限约束（超出时丢弃并在控制台记录）。

## 6. 实体接口（`BR.entityTypes.register`）

```js
BR.entityTypes.register({
  type: 'smiler', en: 'Smilers', zh: '笑魇', version: 'wikidot-en',
  faction: 'hostile' | 'friendly' | 'neutral',
  hp: 60, radius: 0.4, height: 1.8,
  speed: { walk: 1.2, run: 4.0 },
  perception: { sight: 18, hearing: 10, fov: 360, needsLight: false, avoidsLight: false },
  attack: { hp: 40, sanity: 15, range: 1.2, cooldown: 1.5 },
  aura: { radius: 8, sanityPerSec: 0.8 },           // 靠近掉 san（噩梦模式）
  build(ctx) { return THREE.Object3D; },            // 原点在脚底中心，面朝 -Z
  think(e, dt, api) {},                             // 每帧行为
  sounds: { idle: 'breath', alert: 'giggle', attack: 'scream' },   // BR.audio 预设名，可省略
});
```

```
e   = { id, def, x, y, z, yaw, hp, state, target, cooldown, obj, data: {} }
api = {
  time, dt, rng, game: BR.game,
  findTarget(e, range)       // 按阵营规则返回最近可攻击目标：{ kind: 'player'|'entity', ref, x, z, dist } 或 null
  los(e, x, z)               // 视线是否被墙挡
  moveToward(e, x, z, speed) // 带碰撞的移动，返回是否到达
  wander(e, speed)
  flee(e, x, z, speed)
  attack(e, target)          // 处理冷却、伤害、san；游玩模式下对玩家自动无效
  lightAt(x, z)              // 0..1，附近光照强度
  playerNoise()              // 0..1，玩家当前噪音（冲刺更大）
}
```

阵营规则（entities.js 实现，行为代码只调 `findTarget`）：
- `hostile` 攻击 `friendly` 实体和 `dummy` 测试人；`BR.game.attackPlayers` 为真时也攻击玩家。
- `friendly` 攻击 `hostile` 实体，从不攻击玩家和测试人。
- `neutral` 不主动攻击，被攻击后反击。
- `dummy` 从不攻击任何东西，只会被 `hostile` 攻击。

## 7. 物品接口（`BR.itemTypes.register`）

```js
BR.itemTypes.register({
  type: 'almond_water', en: 'Almond Water', zh: '杏仁水', version: 'wikidot-en',
  category: 'drink' | 'food' | 'medical' | 'tool' | 'hazard',
  stack: 5,
  build(ctx) { return THREE.Object3D; },     // 场景里的拾取模型，原点在底部
  icon: 'assets/tex/icon_almond_water.png',  // 背包图标，可缺省（hud 画文字）
  use(player, game) { /* 改 hunger/sanity/hp，返回 true 表示消耗 */ },
});
```

游玩模式没有饥饿/san：物品仍可拾取和使用，数值变化被 player.js 忽略。

## 8. 玩家 `BR.player`

```
BR.player = {
  x, y, z, yaw, pitch, vx, vz, onGround,
  hp, hunger, sanity,                        // 0..100
  inventory: [{ type, count }], selected,
  sprinting, noise,
  speed(): 当前移速（已乘饥饿系数）
  damage({ hp, sanity, source })
  useSelected(); interact(); dropSelected(); select(i)
  respawnInPlace()                           // 回满 HP，饥饿/san 回到 50 以上，保留背包
  reset(spawn, { full }?)                    // game:start / game:home 后第一次 reset 清背包回满；换层再调只移动位置
  handleActions: bool                        // 默认 true：player.update 自己处理 interact/use/drop/slot 按键，main 不要重复处理
  mount(handle) → bool                       // 上车（FE1 叉车；D2 player.setPose 的最小子集）：已经坐着、死了、handle 不对返回 false
  unmount(reason, { instant }?) → bool       // 下车：交还 handle；死亡、换层、回主页、复活这类原因直接落到落点，不播 0.5 s 插值
  mounted                                    // 坐着的载具 handle（含上车插值那 0.5 s）；没坐车、或已经开始下车插值时为 null
  pose                                       // 'stand' | 'drive'（坐在载具上，含上下车那 0.5 s）；坐 / 躺以后由 D2 加
}
```

- `inventory` 是定长 5 的数组，空格为 `null`（用掉一格后后面的物品不挪位）。
- 受伤闪屏要有冷却（持续掉 san 的光环不能把屏幕一直压红）。
- 坐在车上（`mounted` 不为 null）时 `player.x / z` 是座椅、`y` 是眼高：出口（world 直接跳过）、水坑（L1 跳过）、实体攻击（量到驾驶舱矩形）、coop 位置、besideHost 都按这个规则处理，见第 15.6 节。

```
```

## 9. 联机（主页联机 → 营地 → 帐篷）

2026-10-02 起按孩子的新话做（原话见第 2 节）：主页上单独一个「联机」按钮 → 开营地或加入朋友的营地 → 两人一起出现在联机营地（Level 1 里一间四面封死的仓库间）→ 走进帐篷选模式和层级 → 两人都准备好，灯一灭就一起出发 → 玩完可以商量好一起回营地。
**房主权威；三种模式都能两人一起玩**（`BR.MODES[mode].coop` 为真的模式：现在是游玩和测试，噩梦在 N2 打开）。只和认识的朋友联机（房号 / 邀请链接），不做随机配陌生人，也不做公开房间列表。信令照旧用现成的 room.php，服务器不改。方案原文：`backrooms-research/plans/2026-10-02-coop-camp-plan.json` 的 N1、N2。

### 9.1 入口和联机面板（js/net/coop.js 的 buildLobby / renderLobby，class 前缀 `coop-`，z 80）

- 主页 `.home-secondary-btn.is-coop`（深色底、2 px 金黄描边、金黄字、CSS 画的两人小图标；电脑和横屏在挂牌上方那一列最上面，竖屏手机在牌子左边那一列最下面）点了调 `BR.coop.openLobby()`。
  `BR.coop` 没加载：按钮变灰，title「联机模块未加载」。`BR.coop` 在但没有 `startRun` 或没有 `BR.coopCamp`（同一台机器新旧文件混着用）：toast「页面没更新完整，请刷新」。
- 主页「游玩」弹窗里不再有联机、开麦按钮和联机状态行；工坊地图信息卡也没有联机按钮。主页开局一律单人（`game:start` 的 `coop` 恒为 null）。营地开着时从主页单人开局，coop 先 `leave()` 并 toast「已关闭营地」。
- 第一屏：标题「联机」、副标题「2 人 · 语音默认闭麦」、昵称框（记住上次填的）、两个大按钮「开一个营地」「加入朋友的营地」。这一屏不出现模式、层级、难度。
- **房主**：`BR.net.createRoom` 成功后用等宽大字显示房号，分组写成 `K7M 2QX`（房号 6 位，没有 0、O、1、I）。按钮「复制邀请链接」「复制房号」，`navigator.share` 可用时再加「分享」（text「来我的营地：房号 K7M2QX」）。提示「把房号或链接发给朋友，发完马上回到游戏——你不在游戏里，朋友连不上」。
  主按钮「进营地等朋友」：在点击的同步调用栈里先 `BR.input.lock()`、解锁音频，再 `startFromLobby({ mode: BR.config.coop.campMode, levelId: 'coopcamp', seed: 随机, settings, coop: { role: 'host' } })`。
  停在房号页时朋友先连上，就自动进营地；这时不在用户手势里（指针锁不上、音频没解锁），所以弹横幅「点一下画面开始」。在房号页关面板要点两次（「再点一次：不等朋友了」），确认后 `leave()`，营地关掉。
- **客机**：房号框自动转大写，去掉空格和横杠；敲到 0、O、1、I 时这个字不收，当场红字「房号里没有 0、O、1、I」。满 6 位自动 `roomInfo`：
  不是后室营地（`isCamp` 为假）时卡片位置直接写 `not_camp` 的文案，不给「加入」；是营地就显示卡片「「hostName」的营地」、按钮「加入」和隐私提示「你的昵称和制服颜色会发给对方；开麦后对方能听到你，默认闭麦」。
  点「加入」时 `joinRoom` 先再查一次 status：已经关了直接报 `room_closed`，不去占房。进度三步「找到营地 ✓ → 正在连线… → 进入营地…」，`onPhase('waitHost')` 时中间那步写「等「X」回到游戏…」；失败一律用 `BR.net.errorText(code)`。
- 在局内调 `openLobby()` 只显示当前联机状态（房号、队友、离开联机），不能新建也不能加入。
- `startFromLobby(payload)`：房主和客机从面板开局都走它——栈顶是面板那条历史时先退掉，等 popstate（500 ms 兜底）再 emit `game:start`，避免和 `home.hide()` 退弹层的那次 popstate 挤在一起把历史栈弄乱。

### 9.2 邀请链接

- 链接是 `location.origin + location.pathname + '#join=' + 房号`，里面只有房号。
- coop `init` 读 `location.hash` 里的 `join=XXXXXX`，读完立刻 `history.replaceState(history.state, '', 去掉 hash 的地址)`；等主页显示（`BR.home.shown`）后调 `openLobby({ join: code })`，直接停在卡片那一步。仍然要点一下「加入」（这一下也用来解锁音频）。刷新时人停在局内就不弹。

### 9.3 信令、营地暗标和错误文案（js/net/net.js）

- 信令复用 `https://api.ovobot.ai/room.php`（host/guest 两人，房间码和火箭游戏共用号段）。所有请求走同一个 `api()`，测试能整个拦截。**测试绝不连真实服务器**：tests/coop.mjs 用内存假 room.php（和 PHP 行为一致：name 照 `trim` + `mb_substr(0, 16)` 处理，join 只拦 joined、不拦 closed）。
- **营地暗标 U+2063**：`createRoom(name)` 把昵称截到 15 个字，再接一个 U+2063（不可见分隔符）。PHP 的 `trim` 只剥 ASCII 空白，不会动它，加上后仍在 16 字以内。`roomInfo(code)`、`joinRoom(code, name)` 返回 `{ hostName（已剥掉暗标）, isCamp }`。
  旧版后室和火箭游戏建的房都没有暗标，客机在点「加入」之前就拦住（`not_camp`）。服务器以后要是按 Unicode 去空白，所有营地都会被认成「不是营地」——往安全的方向坏；发布前用真手机在真服务器上建一次营地核对。
- `errorText` 新增和改过的文案：
  - `old_version`：「对方的游戏版本旧，请对方刷新页面再试」
  - `host_silent`：「房主没有应答：可能还在微信里没回来，或者已经离开。请他回到游戏，或者重开一个营地」；对称的 `guest_silent`（房主这边：朋友进了营地又没应答）
  - `not_camp`：「这不是后室的营地：可能是火箭游戏的房间，或者对方的后室版本旧，请对方刷新后重开营地」
  - `room_not_found`、`room_closed` 都改成「营地已经关了，或者房号不对，请朋友重新开一个」；`room_expired` 是房主自己的房间没了又续不上
  - `p2p_failed` 改成「两个人连同一个 Wi‑Fi 最稳；不在一起时，请都用家里的 Wi‑Fi 再试，别用手机流量或热点」，不再建议换热点
- **没有中转服务器（TURN）**：只配了 STUN，两个人在不同的家里、尤其用手机流量时，有时候会连不上。这次不搭（家长说先不管中继服务器），连不上时如实说明原因。将来要加，只改 `BR.config.iceServers`。

### 9.4 握手：caps camp1、hello、world

- DataChannel 第一条消息 `{ t: 'hello', game: 'backrooms', v, name, skin, caps, lv }`，game 不对就断开。
  `caps` 现在是 `['ev1', 'fx1', 'veh1', 'veh2', 'camp1']`（`veh2` 叉车驾驶，FE1 加；`veh1` 是 A1 占的位，线上旧版已经声明了它却开不了车，所以照旧发出去、但不再代表能开车，能不能一起开叉车只看 `veh2`，见第 15.7 节）。**`camp1` 必需**（营地、帐篷、startRun、备用房号重连这一套）：对方缺它，新版这边提示 `old_version` 并 `leave()`，旧版那边只会看到对方离开、回到 idle。测试可以在页面脚本执行前设 `window.__brCapsOverride` 模拟旧版。
  `lv` 是本机已注册的 `LEVEL_ORDER` 层级 id 数组，存进 `BR.coop.peerLevels`；帐篷的层级列表只让选两边都有的层（`BR.home.levelOptions({ only })`，对方没有的灰着写「队友没有这一层」）。
- 房主权威：`{ t: 'world', seed, levelId, mode, difficulty, settings, picked, at, slot?, workshopMap?, c }`。
  `mode`、`difficulty` 是这一局的模式和难度（客机只接受 `BR.MODES[mode].coop` 为真的模式，否则提示「这个模式本机还不能两人一起玩」并忽略；`settings` 里客机保留自己的 quality 和 visibility）；
  `slot` 是营地出生格下标（见 9.6）；`picked` 本层已被拿走的物品 id；`at` 房主脚底位置（没有出生格的层：帐篷出发、中途加入时客机落到房主身边——区块建好后 `besideHost` 在房主右手边 / 左手边 / 身后 / 身前 / 斜角 1 m（再不行 1.4 m）找一块空地，中间不隔墙、地面高差 ≤ 0.35 m，都不行才和房主站同一点，免得两人叠在一起互相看不见）；`workshopMap` 房主在工坊地图里时的整张地图对象；`c` 房主时钟。
  客机判断「这是新的一局」：`mode`、`difficulty`、`seed` 任何一个不同都算。
- 「两人在不在同一局」统一看 `BR.coop.sameRun()`（在世界里；客机还要求 `BR.game.mode === hostMode` 并且种子相同），不再只认游玩模式。拾取确认、实体快照、换层、租约、本层状态同步都按它判断（测试模式拾取不再复制）。`sendWorld` 在任何 `coop` 为真的模式的世界里都发。
- 实体只在房主模拟，10Hz 发 `{ t:'ents', list:[[id,type,x,z,yaw,state,hp]] }`；双方 15Hz 发 `{ t:'me', x,y,z,yaw,pitch }`。
- 实体行尾部可选列（2026-09-14，向后兼容）：`[id,type,x,z,yaw,state,hp, y?, flags?, infStage?]`。`y` 是 ENGINE_PLAN M4 快照 v2 预留的离地高度，目前写 `null`；`flags` 位表沿用 M4 草案，bit3（8）= 感染中；`infStage` 是感染阶段号（0 起）。没感染的行仍是 7 列。旧客机只读前 7 列，新客机收到 7 列当作没感染。感染的计时和转化只在房主，转化靠现有的删一个 id、增一个 id 同步。
- 拾取：客机发 `{ t:'pick', id }`，房主确认后广播 `{ t:'picked', id, by }`。
  两人抢同一件、没抢到的一方提示「「X」先拿到了」：interact 在按下空格时那件没了（按着的这一下里消失），或者按下前 1 s 内还对准着、按下时已经不在了
  （东西先从这边屏幕上消失、人慢半拍才按到；2026-10-05 返修 r2），都发 `interact:itemGone`；coop 只在 3 s 内确实是队友拿走的才说。
- 换层：任一方到达出口 → 房主广播 `{ t:'level', to }`，两人一起换层。
- 主动离开联机前先发 `{ t: 'leaving' }`：对方据此区分「点了离开」和「页面被关掉 / 刷新」（后者原地等重连）。
- 语音：开麦/闭麦切换，默认闭麦；V 键（input 的 `'mic'` 边沿动作）或 coop.js 自建的触屏麦克风按钮切换；对本地和远端音轨各接 AnalyserNode，coop.js 自建小角标显示"我在说话 / 对方在说话"。
- 皮肤：`hello` 消息带 `skin`，换皮肤时发 `{ t: 'skin', key }`，对方的人形用 `BR.skin.apply` 上色。两人穿同一种颜色时提示「你们都穿黄色，可以去柱子上的挂钩换一件」。
- A1 的事件通道（`{ t:'ev' }`、租约、`use` / `onUse`、`{ t:'st' }` 本层状态）照旧，见 coop.js 「事件通道」一节；营地的事件都走它（9.7）。

### 9.5 等房主回来、房号续期

- **等房主回来**：客机进房后 6 s 还没收到房主的第一条 offer（房主多半切到微信发房号去了，iOS 会挂起页面），net 回调 `onPhase('waitHost')`，界面写「等「X」回到游戏…」，最多等 90 s，超时报 `host_silent`。收到 offer 以后才按原来的 30 s 判 `p2p_failed`。
  对称地，房主发了 offer 6 s 没收到 answer 时是 `'waitGuest'`，90 s 报 `guest_silent`。房主页面回到前台（visibilitychange）立刻轮询一次 status；房主等人超过 2 分钟，status 和 poll 的间隔放宽到 4 s，减轻共用服务器的压力。
- **房号续期**：服务器上的房间 2 小时过期。房主开着营地、还没人连上时，到建房后第 `BR.config.coop.renewMin`（110）分钟新建一个房间、关掉旧的，回调 `onCode(code)`；不在大厅时收到 `room_not_found` 也走同一条续期，不当致命错误（房主正看着大厅的房号页时按致命错误报）。
  coop 收到后更新 `BR.coop.code` 并 emit bus `'coop:code' { code }`：营地小黑板、左上角房号角标、暂停菜单一起更新，并 toast「房号换成了 …」。

### 9.6 隐藏层 coopcamp（js/levels/Lcoopcamp.js）

- `BR.levels.register({ id: 'coopcamp', name: '联机营地', title: 'Level 1 某处 · 一间封死的仓库', hidden: true, lobby: true, spawnSlots, keepClear, entities: [], items: [], exits: [], … })`。
  - `hidden`：不在 `LEVEL_ORDER`，不进主页、帐篷、测试面板、工坊的任何层级列表；只能由 `game:start` 的 `levelId` 点名开（main.js `pickLevel`；主页记下的 startLevel 万一是隐藏层，单人开局按没选处理）。
  - `lobby`：HUD 模式标签写「联机营地（Level 1 某处）」，不显示饥饿、san、HP；本层状态按一次联机保存（9.10）。
  - `spawnSlots`：两个出生格 `(15, 21.2)`、`(17, 21.2)`，面朝帐篷。房主 `sendWorld` 从里面挑离房主当前位置远、并且 `BR.phys.overlapCircle` 为 false 的那一格，作为 `slot` 发给客机；客机落在 `BR.levels.get(lv).spawnSlots[slot]`。重连回到同一局时客机留在原地，不传送。
  - `keepClear`：门前通道和帐篷中间过道两个矩形，加两个出生格各一个半径 0.55 m 的圆（why「出生的地方得空着」；不然椅子能拖到出生格上，回营地时人出生在椅子里）。椅子、睡垫能拖，但会停在区外（和出口圈同一套规则，`BR.world.blockers()`）。
    顶着圈推 0.3 s 以上说 why（圆形禁区由 `phys.moveBox` 截短位移，interact 按「想走的那一步会新压进哪个圈」认出原因；出口圈说「门口得留出来」。2026-10-05 返修 r2：原来圆形的什么都不说）。
    房主进营地时第 0 格万一被占着（老的营地布置），换到空着的另一格。
  - **固定种子**：`buildChunk` 自己建 builder，`levelSeed` 一律用固定的 `CAMP_SEED`，营地布局和游戏种子、画质都无关。家具按固定面数（`preNominal`）先入账，货架额度只由种子决定。
- 环境用 `BR.L1room.env`（`sanityDrainMul`、`hungerDrainMul` 都是 0）；没有 `update`，所以没有 L1 的断电、闪灯；没有门、没有出口、不刷实体和物资，货架上的箱子标 `loot: 0`（打开是空的）。
- 布局：区块 (0,0) 里 24×24 m 的房间，3×3 个 8 m 柱间，用的全是 L1 自己的构件（`BR.L1room.build`）；北、东、西三面墙高处各开两扇铁丝玻璃窗，窗外三块用 `walls: 'none'` 建离墙最近的一排柱、梁、吊灯、货架（每块 ≤ 4000 面），抬头能看到墙外的 Level 1，人过不去。
  营地中间一顶 3.2×4.0 m 的墙式帆布帐篷（`BR.camp.tent`），里面两张防潮垫和睡袋、地图桌、马灯，门右边前墙上夹一块小黑板；帐篷外两把折叠椅，出生点东北那根柱子上一排制服挂钩。
  `b.data.coopcamp`（世界坐标）`= { tent: { inside, door, stand, map, lantern }, board, hooks, corridor, … }` 交给 `BR.coopCamp` 用。
- 预算：营地块高画质 ≤ 9600 面、低画质 ≤ 7800 面，mesh ≤ 7。营地不进入库 golden（不在 `LEVEL_ORDER`），布局固定性由 tests/camp.mjs 单独检查；以后改 L1 构件（A2、D1、B1、F1、D3）营地会跟着变，各阶段的 golden 白名单要写上 coopcamp。

- `BR.coop.peerSkin`：对方制服颜色 key（hello / skin 消息里来的，已校验），没连上时为 null。挂钩藏起队友身上那件、测试人颜色、同色提示都用它。

### 9.7 帐篷和 BR.coopCamp（js/game/coopcamp.js，选单 DOM 在 js/ui/tentmenu.js）

- 交互和画面只在 `BR.game.levelId === 'coopcamp'` 时工作，每帧由 main.tick 调 `update(dt)`（暂停时也跑）。interact 来源 `'coopTent'` 出三个候选：
  帐篷门「进帐篷」（站在门前通道里、准心对准门洞、2.6 m 以内）、桌上的层级地图「看地图」（直接开选单）、柱子上的挂钩「换制服 X那件」（准心对准哪件就换哪件）。
  挂钩上只挂没人穿的颜色：自己和队友身上那两种从挂钩上取下（层级把每件的几何件放在 `b.data._uniforms`，coopCamp 用 `Piece.setVisible` 藏，不加网格），换下来的那件挂回去。
  对准哪件按命中点沿挂钩那一排离哪件制服中心最近算（层级 `hooks.at`，顺序同 `skins`）；对着空着的那一格（自己或队友正穿着）只灰字说原因
  「这件就穿在你身上」「「X」穿着这件」，按了不换——永远换不到队友身上那件，两人不会因为挂钩撞色（2026-10-05 返修 r2；原来按 `BR.SKINS` 顺序换「下一种」）。
  长按只给原因：「帐篷是营地的出口，拖不动」「地图桌绑在帐篷杆上，拖不动」「挂钩钉在柱子上，拖不动」。不在通道里短按帐篷只提示「走到门口」，不会穿过椅子走进去。
  HUD 动词新增「进帐篷」「出帐篷」「看地图」「换制服」：桌面准心提示写「空格 进帐篷」，手机写「点「互动」进帐篷」（界面文字里不出现 E）。
- 进帐篷：0.9 s 内自己走到地图桌前的站位（两个站位相隔 1 m），然后开选单。联机时站位按角色固定：房主 `stand[0]`、客机 `stand[1]`（两人前后脚按空格，各自看到的对方位置都晚 100–300 ms，按「离队友远」挑会两边都挑中同一格），只有对方正站在自己那一格上才换另一格；
  两人各走门洞中线自己站位那一侧 0.25 m，同时进出时路线不交叉。队友站着不动、挡在要走的路上时不走，toast「「小红」挡在门口」（队友自己也在走就不算挡）。
  出帐篷（选单按钮、Esc、安卓返回键）：先发 `'out'` 再关选单，0.7 s 走到门外 1.2 m；联机时按自己站位那一边横向错开 0.5 m（两人一起出来各站一边、相距约 1 m），那一点站着队友或被东西占着就换另一边。
  两边都不行（队友站在门外正中等着）再试横向 ±1.0 m、往外再走 0.5 m 的三个点；候选点要离队友 > 0.8 m、从门洞走过去不擦着站着不动的队友（两人半径相加 0.6 m）。
  都不行（队友堵在门口）就只走到门槛里面 0.45 m 停下，toast「「X」挡在门口」，人留在帐篷里，等队友让开自己走出去（2026-10-05 返修 r2：原来退回门外正中，正好走进队友身体里）。
  电脑上按 Esc / 返回键走出来（不是点击，锁不上指针）、出发或回营地的过场亮起来以后（过场里关输入会退出指针锁定），弹横幅「点一下画面继续」，锁上或点一下就收。
  这条横幅和客机自动进营地的「点一下画面开始」都带 `hud-notice-pass`（`pointer-events: none`）：照字面点在横幅上，这一下也落到画面上、由 input.js 锁住指针（原来点横幅只把它关了，之后转不了视角）。
  点在别的横幅的按钮上（「同意 / 不要」）不收它：按下那一刻先把它收了，下面那条横幅往上一挪，按钮就点空了。
  「站着不动的队友」按时间平滑的速度判断（时间常数 0.15 s，停下约 0.6 s 后算），和帧率无关（原来按帧平滑，机器卡时停下好几秒还算在走）。选单自己不压历史，Esc / 返回键由 main.js 先问 `BR.coopCamp.onBack()`（返回 true 表示已经关了选单、走出帐篷，这次不进暂停）。
- **共享选择，房主说了算**：`state = { mode, diff, lv, ws, spawn, rdy: [房主, 客机], tin: [房主, 客机], goAt, by, chg, v, maps }`（`tin` = 选单开着、算在帐篷里；`chg` = 改了哪一项；`maps` = 房主的工坊地图 `[{ id, name, lv }]`）。
  房主改了直接写，`v + 1`，`BR.coop.emit('tent', state)`；客机改走 `BR.coop.use('coopcamp:tent', 'tent', 客机眼睛坐标, cb, { op: 'pick' | 'ready' | 'in' | 'out' | 'cancel', … })`，房主在 `onUse('tent')` 里核对后写入并广播。
  不管谁改了选择，两边的准备都清掉，对方选单闪一下并 toast「「名字」改成了 Level 3」。客机进营地后 `emit('arrived', { lv })`，房主收到就再发一次 state。帐篷状态不管在不在营地都缓存最新一份（按 `v` 取新的）。
- 选单（标题「选下一站」）：三张模式卡和主页一字不差（`BR.home.modeText`），下面用 `BR.home.modeFields` 画滑条、难度卡和层级下拉；房主有工坊地图时多一栏「我的地图」（选了以后层级下拉变灰，写「地图自带层级」）。
  灰字「从帐篷出发是新开一局，背包是空的」；选 L15、L16 时旁边写「这一层没有回去的路，可以从暂停菜单回营地」。底部钉一条栏放队友状态（「在帐篷里 · 已准备 ✓」「还在外面」「队友已离开」）和「准备」；竖屏是底部抽屉，横屏是右侧两栏卡片，选单里没有输入框。
  能选的模式：`BR.MODES[m].coop` 为真；噩梦还要求对方也有 `'nm1'`（`BR.coop.can('nm1')`，N2 加进 caps）。不能选的卡片变灰写实话：N1 期间噩梦卡写「两个人一起玩噩梦还在做，下一步就开放」，对方版本旧时写「队友的游戏版本旧」。没有队友时「准备」是灰的，写「等朋友来」。营地里没有「一个人出发」：想一个人玩就离开联机，从主页开局。
- 事件（`BR.coop.emit`，对方收到 bus `'net:' + kind`；`r` 是发的人的角色 `'h'` / `'g'`）：

  | kind | payload | 谁发、什么时候 |
  |---|---|---|
  | `tent` | state | 房主：选择、准备、倒数变了就广播 |
  | `campAsk` | `{ by, r, off? }` | 提出回营地的一方（`off` 为真 = 「算了」撤回） |
  | `campYes` | `{ by, r }` | 客机同意了房主的提议（房主自己同意时不发这条，直接 `campGo`） |
  | `campNo` | `{ by, r, auto? }` | 对方点了「不要」，或者 15 s 里有输入却没回应（`auto`） |
  | `campCancel` | `{ by, r }` | 房主确认客机的「取消」，倒数停下 |
  | `campGo` | `{ by }` | 房主：同意回营地了（两人同时提出也算同意），两边一起黑屏「回营地」 |
  | `arrived` | `{ lv }` | 客机进了营地 / 进了新层 |
  | `reveal` | `{ at }` | 房主：客机到了（或等满 `arriveWait` 秒），两边一起撤黑幕 |

- 运行时网格只有两块，都用 CanvasTexture，低画质也画，离开营地时 dispose：小黑板（等人时「房号 K7M 2QX / 等朋友来」，收到 `'coop:code'` 就重画；两人都在时「下一站：Level 3 / 噩梦生存 · 困难」加两个人的准备勾）、桌面纸（手画层级图、本子封面「游玩 / 噩梦 / 测试」、纸条「这间仓库没有门。灯灭的时候，就能切出去。」）。
- 调试口 `BR.coopCamp._debugSet(patch)`：测试用它让房主直接写 state（`lv` 可以是 `'dev'`），走同一条广播路径。

### 9.8 出发：灯灭切出

- 两人都在帐篷里点了「准备」，房主写 `goAt = BR.coop.clock() + countdown`（3）并广播。双方选单大字 3、2、1，马灯每一拍暗一下。
  `goAt − 0.5` 之前有人点「取消」、改选择、出帐篷或者断线，倒数就停、准备清空（客机的「取消」只是向房主申请，收到 `campCancel` 才停）；最后 0.5 s 不能再取消，免得一边已经出发、一边停下。
- 到 0：已载入区块（含窗外带）的灯描述强度设 0（保存原值，做法同 L1 的 onBlackoutStart），`gfx.applyEnv` 换全黑的 env，「嗡——啪」一声，然后 `await BR.hud.curtain(文字)`（全黑那一刻 resolve）。文字写「Level 3 · 噩梦生存 · 困难」，选 Level 1 写「Level 1 · 走出营地」。
- 房主在 resolve 以后调 `BR.coop.startRun({ mode, difficulty, settings: { …BR.game.settings, spawnSlider, startLevel }（不带 visibility）, seed: 随机, levelId, workshop? })`；客机等 world 消息跟进，进层后 `emit('arrived')`。
  房主收到 `arrived`，或者等满 `arriveWait`（5）秒，就 `emit('reveal')`，两边一起 `curtain(false)`；客机来晚了进层就直接亮。等人期间输入关着；客机的黑幕有 15 s 兜底。层级大标题在黑幕撤掉以后才播。
- 从帐篷出发等于新开一局，背包是空的。能见度和画质只影响自己，不放进帐篷，客机进层时不会被房主的能见度覆盖。

### 9.9 回营地要同意、落单

- 联机时暂停菜单顶上一行小字「联机时暂停，世界不会停」，「返回主页」换成「回营地」和「离开联机」（点两次：「再点一次：会断开联机，回到主页」，确认后先 `BR.coop.leave()` 再 emit `'game:home'`）；在营地里暂停只有「继续」和「离开联机」。结算页联机时是「继续」（原地重生）/「回营地」（副标题「要队友同意，背包带不回去」）/ 小号的「离开联机」。单机时这些都不变。
  - 重连中（`phase 'reconnecting'`，`BR.coop.active` 为 false）暂停菜单不出「回营地」，只有「离开联机」：回营地要对方同意，断着问不出去，点了也没用。方案 N1-hud ④ 写的是「联机中（包括 reconnecting）换成两个按钮」，这里有意少一个；连回来以后按钮自己出现。
  - 开着营地等朋友（`BR.coop.hosting`、还没人连上，副标题写着房号）时，「离开联机」前面多一个「复制邀请链接」（`BR.coop.copyInvite()`，复制不了时手机弹系统分享）：营地重开、房号续期以后，不用回主页也能把新链接发给朋友。它和「回营地」不会同时出现。
- HUD：营地的模式标签写「联机营地（Level 1 某处）」；联机局在原标签前加「联机 · 」（例如「联机 · 噩梦生存 · 困难」）；房主开着营地、还没人连上时，左上角多一行「房号 K7M2QX · 等朋友来」，暂停菜单副标题也写房号。
- **回营地**：`BR.coopCamp.back()` 发 `campAsk`（在结算页倒下时提出带 `dead: true`）。对方屏幕上半部弹横幅「「小明」想回营地」（倒下时「「小明」倒下了，想回营地」），按钮「同意」「不要」，`askSec`（15）秒；提出的一方看到「等「小红」同意…」，带「算了」。
  回营地是新开一局，背包带不回去：谁的背包里有东西，谁的横幅后面就多一句（提出的一方「（背包里的东西带不回营地）」，回答的一方「（你背包里的东西带不回去）」），回到营地亮起来时再 toast「背包清空了：捡的东西带不回营地」（不点层名：东西可能是前面几层捡的）。
- **队友倒下**：自己死了发 `'down' { by }`，对方 toast（暂停 / 结算盖着时走横幅）「「小明」倒下了」。营地里不发。
  对方点「同意」：房主 `startRun({ mode: campMode, levelId: 'coopcamp', … })`，两边一起黑屏回营地，客机落在挑出来的出生格。对方点「不要」，或者这 15 s 里有输入却没回应：不回，提出的人 toast「「小红」还想接着玩」。
  只有对方 15 s 里完全没有输入（coopCamp 自己听 keydown、pointerdown、touchstart，不改 input.js）才按同意处理——不会在对方被追的时候把他拉走。回到营地后，帐篷里是上一局的选择（`BR.coopCamp.last`），准备已清空。
- **营地里落单**（bus `'coop:peerGone'`，`where: 'camp'`）：横幅「「小明」离开了营地」，两个按钮：「再开一个营地等朋友」调 `BR.coop.createRoomInPlace()`（原地重新开房、换新房号、角色切成房主，不重开世界）；「回主页」。
- **关卡里落单**（`where: 'level'`）：toast「「小明」断开了，你接着一个人玩」，这一局变回单人，暂停菜单跟着恢复成单人的样子。

### 9.10 营地布置按一次联机保存

- `BR.levelState` 里营地层（`BR.config.coop.campLevel` 和 `lobby` 为真的层）的记录按「一次联机」保存：从帐篷出发、回营地（`game:start` 带 `coop.role`、模式能联机）都不清，挪过的椅子、睡垫还在原处；只有离开联机（`game:home`）或主页单人开局（`game:start` 不带 `coop`）才清。
- 客机加入时由房主照现有的中途加入回放（`{ t:'st' }` 整层发过去）。

### 9.11 备用房号和掉线重连

- **备用房号**：连通以后关掉原房间（它已经是 joined），房主 `BR.net.spareCreate()` 新建一个备用房号，coop 用 `{ t: 'spare', code }` 从数据通道发给客机；每 `spareMin`（100）分钟换一个新的。每次联机在服务器上最多同时占 2 个房间（共用火箭游戏的 room.php），离开联机时都要 close。
- **掉线重连**：数据通道断了、两人又在 `sameRun()` 时，phase 进入 `'reconnecting'`（`BR.coop.active` 为 false），bus `'coop:reconnecting'`。两边原地不动，顶上横幅 `BR.hud.notice('连接断了，正在重连…（最多 90 秒）', [{ label: '不等了' }])`；房主 `reconnectHost()` 在备用房里等，客机 `reconnectGuest(备用房号)` 加入，走同一套 offer/answer/ICE。
  连上以后照常 hello、world，对方的人形恢复，层级、背包、位置都不变（bus `'coop:reconnected'`）。`reconnectSec`（90）秒内没连上，或者有人点了「不等了」，就 emit bus `'coop:peerGone' { where: 'camp' | 'level' }`，按 9.9 处理。90 秒是因为手机切去微信回一条消息常常超过 1 分钟。
- **rejoin**：客机把 `{ code: 备用房号, host: 房主昵称, at }` 存进 sessionStorage `'br_coop_rejoin'`，有效 3 分钟（连着时定期刷新 `at`，3 分钟从断开那一刻算）。页面被手机关掉重开、或者刷新后 3 分钟内打开游戏，主页显示卡片「「小明」的营地还开着，回去？」。

### 9.12 测试模式两人一起玩（js/game/testmode.js）

- 客机放实体：本机算好准心前方的落点，`BR.coop.use('t:' + 计数, 'test:spawn', 客机眼睛坐标, cb, { type, x, y, z, skin })`；房主在 `onUse('test:spawn')` 里核对（落点离客机 ≤ 12 m、`freeSpot` 再找一次、场上没满）后放出，把结果回给客机。失败说原因：「场上已满 28 个」（上限是 `BR.config.world.maxActiveEntities`，默认 28，两人合用）「那里放不下」。
- 「清除全部」：客机也走 `use('test:clear')`，房主清完 `BR.coop.emit('testClear', { by: 名字 })`，两边都 toast 是谁清的。面板上的「场上 X/28」两边读同一个数（客机数快照里的实体）。
- 测试人 id 一律是 `'dummy~<皮肤>~<h|g>~<uid>'`，`test_dummy.build` 从 id 前缀取召唤者的制服颜色，两边看到的一样；两个玩家同色时测试人头顶挂召唤者昵称的小名牌。

### 9.13 版本混用和发布

- 两台机器之间的版本差靠 `camp1` 和昵称暗标挡住；同一台机器上新旧文件混着用（GitHub Pages 和游戏大厅约 10 分钟内会给一部分人旧文件），靠主页联机按钮的接口检查提示「页面没更新完整，请刷新」。发布① 之前还要给 index.html 里所有 script、link 加 `?v=<提交号>`。
- 配置 `BR.config.coop = { campLevel: 'coopcamp', campMode: 'casual', countdown: 3, arriveWait: 5, askSec: 15, reconnectSec: 90, renewMin: 110, spareMin: 100 }`（base.js）。营地按 `campMode` 开局（实体不打人、没有饥饿和 san），营地自己不刷实体。

## 10. 文件归属（并行开发时各改各的，别碰别人的文件）

| 文件 | 负责模块 |
|---|---|
| js/core/base.js | 架构（改接口要先改本文档） |
| js/core/assets.js, tools/textures.* | 素材 |
| js/core/audio.js | 音频 |
| js/core/gfx.js | 渲染 |
| js/core/input.js | 输入 |
| js/core/phys.js | 物理 |
| js/game/player.js, items.js, js/items/* | 玩家与物品 |
| js/game/world.js | 世界流式加载 |
| js/game/entities.js | 实体管理 |
| js/game/hud.js, death.js, css/game.css | HUD 与结算 |
| js/ui/home.js, css/home.css, tools/blender_hazmat.py | 主页 |
| js/net/coop.js | 联机 |
| js/net/net.js | 联机网络层（信令、营地暗标、续期、备用房号；能单独测） |
| js/game/coopcamp.js, js/ui/tentmenu.js, css/tent.css | 联机营地（帐篷、共享选择、出发、回营地；选单 DOM） |
| js/levels/_camp.js | 营地构件 BR.camp（联机营地和 C1 的 NPC 营地共用） |
| js/levels/Lcoopcamp.js | 联机营地层（隐藏层 coopcamp；L1.js 只加了 BR.L1room 导出，L1 自己的 buildChunk 不动） |
| js/levels/_kit.js, js/levels/_TEMPLATE.md | 层级工具库（层级代理只读；改接口先改 _TEMPLATE.md） |
| js/levels/*, js/entities/* | 调研完成后按层级/实体分派 |
| js/levels/Ldev.js, js/entities/_dev_*.js | 开发测试用（不进 LEVEL_ORDER，上线前删除） |
| js/game/skin.js | 主页 |
| js/game/testmode.js | 测试模式 |
| js/game/vehicles.js | 载具层（登记、升格、载具网格、上下车；改接口先改第 15 节） |
| js/game/forklift.js | 叉车模拟（只经 create / step / obbsWorld / exitSpot / lightSpot 和载具层交接） |
| js/game/vehicles_net.js | 叉车联机表现（远端的车只经 BR.vehicles.setPose 进来） |
| js/entities/test_dummy.js | 实体管理 |
| index.html, js/main.js, css/base.css | 集成 |
| css/coop.css | 联机 |
| tests/<模块>.html | 各模块自测页，可选 |

## 11. DOM 规则

- `index.html` 只放 `<canvas id="gl">` 和 `<div id="ui">`。所有 UI 模块**自己用 JS 在 `#ui` 里创建 DOM**，不依赖 index.html 里的其他元素，这样并行开发互不冲突。
- 每个 UI 模块的根节点带自己的 class 前缀（`home-`、`hud-`、`death-`、`coop-`、`tent-`、`touch-`），CSS 只写带前缀的选择器。
- z-index：画布 0，gfx 低 san 覆盖 10，touch 控件 20，HUD 30，说话角标 35，gfx 闪屏 40，主页 50，测试面板 52，**帐篷选单 54**，gfx 淡入淡出 55，**黑幕 56**（`BR.hud.curtain`），工坊 / 设置 58，结算/暂停 60，**横幅 65**（`BR.hud.notice`），皮肤色板 70，**「回去？」卡片 78**（主页上的 rejoin 卡片 `.coop-rejoin`，css/coop.css），联机弹窗 80，toast 90。
  联机营地（N1）新增的三层：54 帐篷选单在黑幕下面，出发时黑幕盖住选单；56 黑幕在 gfx 淡入淡出（55）之上、暂停和结算（60）之下；65 横幅（「「小明」想回营地」、重连、落单）在暂停和结算之上、皮肤色板（70）之下，暂停、结算、黑幕时都看得见。css/game.css 顶部注释写着同一张表。
  矮横屏（高 ≤ 520）toast 在右上角，和横幅同一高度带：横幅开着时 hud.js 量横幅底边，toast 排到它下面 8px（`.hud-toasts-below`）。
- 手机端：点击目标 ≥ 44px；尊重 `env(safe-area-inset-*)`；文字 ≥ 12px。

## 12. 各模块公开 API（并行开发以此为准）

### BR.assets（js/core/assets.js）
```
init(): Promise                        预载 manifest 里的贴图与模型
texture(name, { repeat: [u, v] }?)     assets/tex/<name>.jpg；文件不存在时用 registerProcedural 注册的画法生成
                                       自动设 sRGBEncoding、RepeatWrapping、anisotropy。同名同 repeat 复用
registerProcedural(name, size, draw)   draw(ctx2d, size) 画一张兜底贴图
material(key, factory)                 按 key 缓存材质，factory() 只调一次
model(name): Promise<Object3D>         assets/models/<name>.glb，返回克隆
modelSync(name): Object3D | null       预载后同步取克隆
```

### BR.audio（js/core/audio.js）
```
unlock()                               第一次用户手势里调用
setAmbient(preset)                     'fluorescent' 'pipes' 'electrical' 'office-rain' 'hotel' 'dark' 'ocean'
                                       'cave' 'suburb-night' 'wind-field' 'city' 'party' 'chase' 'silence'
play(name, pos?, { volume, rate }?)    'step' 'step-wet' 'pickup' 'drink' 'eat' 'hurt' 'death' 'whisper'
                                       'giggle' 'growl' 'screech' 'door' 'noclip' 'heartbeat' 'buzz'
                                       'static' 'click' 'hit'；pos 给了就是 3D 声源
setListener(x, y, z, yaw)
setMaster(v)                           0..1
setSanity(v)                           0..1（1=正常），越低越闷、越多幻听
loop(name, { x, y, z }?) → { setRate(r), setGain(g), setPos(x, y, z), stop(fadeS) }
                                       循环音效（FE1 叉车）：走单次音效的总线和 3D 规则（给了位置就是 3D 声源），占声部上限；
                                       切后台、回主页时自动停。'fk_engine'（液化气发动机怠速，rate 随车速 0.8–1.6）'fk_hydraulic'（液压泵）
                                       'fk_reverse'（倒车哔哔）
叉车单次音效（play）：'fk_ignite'（钥匙咔 + 起动机转两下）'fk_end'（货叉到顶 / 到底的咔）'fk_strain'（液压憋压）'fk_bang'（哐）
                                       'fk_bump'（咚）'fk_seat'（座椅弹簧）'fk_radar'（雷达嘀嘀嘀）'fk_off'（熄火）。
                                       BR.forklift 的事件名和音效名一一对应：事件 'bang' ↔ 'fk_bang'……
```
全部用 WebAudio 程序化合成，不依赖音频文件。

### BR.gfx（js/core/gfx.js）
```
init(canvas); renderer, scene, camera
applyEnv(env, visibility)              背景、雾、环境光；visibility 0..1 线性缩放 fogFar（最低 0.25 倍）
setLightSources(list)                  所有已载入区块的灯光描述；每帧取离相机最近的 maxDynamicLights 盏实体化，其余不亮真光
setSanityEffect(v)                     0..1（0=正常），暗角、色差、画面抖动
fade(toBlack, seconds): Promise
flash(color, seconds, peak?)           peak 默认 0.6
flickerAt(light, t?)                   与真光同步的闪烁系数，给自发光灯管面片用
qualityNeedsReload                     运行中切画质后抗锯齿需要刷新才生效
注意：必须先 gfx.init 再 assets.init（贴图 anisotropy 要读 renderer.capabilities）；每帧都要 render，主页和暂停时也要
setQuality('low' | 'high')
render(dt); resize()
```

### BR.input（js/core/input.js）
```
init(canvas); enabled                  菜单打开时置 false
move: { x, y }                         -1..1，y 为前进
consumeLook(): { dx, dy }              本帧累计视角增量（像素已换算成弧度）
sprint: bool
pressed(action): bool                  边沿触发：'interact' 'use' 'pause' 'slot1'…'slot5' 'drop' 'mic'(V) 'testmenu'(T)
                                       'liftUp'(R) 'liftDown'(C)（开车专用，只在 drive 情境有效）
held(action): bool                     'sprint' 'use' 'interact' 'liftUp' 'liftDown'（键盘 R / C 和触屏「升」「降」一致）
released(a); cancelled(a); heldMs(a); lastHoldMs(a)
                                       只对动作级的 'interact' 'liftUp' 'liftDown' 有意义（A1）：所有按着它的键和手指合在一起算
setContext(ctx)                        'walk' | 'seat' | 'view' | 'drive'：只改已有动作怎么解释，F 在所有情境里都是 use，暂停一直可用。
                                       drive（FE1 开车）：W/S/A/D 照旧进 move，由 BR.vehicles 读成油门和方向；这个情境里 move.x / move.y 是两根独立的轴，
                                       各自限在 ±1（不像走路那样把斜向合成长度归一：W+A 要能全油门加打满方向；摇杆照样是模拟量）；
                                       冲刺、丢弃不可用（触屏键灰掉）；
                                       多两个开车专用动作 liftUp / liftDown，手机上只在这个情境显示「升」「降」两个触屏键
                                       （竖屏摞在丢弃键上面；高 ≤600 的窄竖屏升键挪到测试模式「实体」入口那一列的左边，不再被入口压住，repair-r2）；
                                       触屏「互动」键写「下车」（CONTEXTS.drive.labels = { interact: '下车' }，setContext 切进来套上、切走恢复，
                                       不经过 setButtons，所以 setButtons(null) 清不掉它）；准心对着仪表台大灯开关时 BR.vehicles 用 setButtons 临时写「开大灯 / 关大灯」
setButtons(map)                        改触屏键的文字和可用状态，map = { interact|use|sprint|drop|liftUp|liftDown: { label, disabled } | null }；
                                       优先级：setButtons 的 label > 情境键名 > 默认文字；换情境时覆盖一并清掉
buttonLabel(a)                         触屏键现在显示的文字（HUD 写「点「互动」…」时跟着它：开车时是「点「下车」」）
touchLayout()                          触屏控件现在的位置（HUD 给开车提示行找空位用），触屏层没显示时为 null
locked; sensitivity                    是否已锁定指针（只读）；视角灵敏度倍率 0.2–3（localStorage）
                                       麦克风和测试面板的触屏按钮分别由 coop.js、testmode.js 自建，不归 input
endFrame()                             主循环末尾调用
lock()                                 桌面请求指针锁定
isTouch: bool                          触屏时自动显示左摇杆、右侧滑动视角、互动/使用/冲刺/暂停按钮
```
指针锁在暂停 / 结算之后才生效（点画面那一下请求的锁，浏览器晚一拍才给）时，锁着鼠标菜单和横幅都点不到：main.js 的
`onLateLock`（pointerlockchange）在 `screen` 是 `paused` / `dead`、输入关着时马上放掉（input 那边输入关着，不会当成意外丢失再暂停一次）。
只认暂停和结算：主页点「进营地」、帐篷里点「出帐篷」时也是先请求锁、输入还关着，那几次的锁要留着（2026-10-05 返修 r2）。

### BR.phys（js/core/phys.js）
```
addSolids(key, solids); removeSolids(key); clear()
moveCircle(x, z, r, dx, dz, yFeet?, height?): { x, z, hitX, hitZ, hit }   带滑动的圆形碰撞；同 key 再 addSolids 是替换
los(ax, ay, az, bx, by, bz): bool      true = 视线通畅（起点在盒子里算被挡）
raycast(ox, oy, oz, dx, dy, dz, max): { dist, x, y, z, nx, ny, nz } | null
overlapCircle(x, z, r, yFeet, height): bool   出生/重生/放实体前检查落脚点
groundY(x, z): number                  默认 0；层级在 enter 里 setGroundFn(fn) 覆盖（clear() 会重置 groundFn）
                                       没有自动上台阶：高度变化走 groundFn，低矮盒子会直接挡住
moveBox(minX, minZ, maxX, maxZ, yFeet, h, dx, dz, opts?); overlapBox(minX, minZ, maxX, maxZ, yFeet, h, opts?)   拖道具用（A1），OBB 也挡
raycast(…, max, { ignoreKey }?)        ignoreKey 字符串或数组：跳过这些 key 的碰撞体（准心对准货架里的箱子时传父道具链）
—— OBB（FE1 叉车起；只在运行时用，生成期 res.solids 一个字节不变）——
addOBBs(key, [{ cx, cz, hx, hz, rot, minY, maxY, name? }]) → 登记个数
                                       绕竖直轴转过的盒子，rot 的约定和 kit 道具记录 / interact 的 hit.obb 一样（= THREE 的 rotation.y）；
                                       竖直范围也认 cy / hy（叉车 geo.obbs 的写法）。同 key 再登记是整组替换。宽相用外接 AABB 落进同样的 4 m 格子
removeSolids(key)                      连同 '<key>#*' 名下的 OBB 一起摘（停着的叉车 'cx,cz#v<i>#chassis'… 跟着区块 key 'cx,cz' 摘）
moveCircle / moveBox / overlapCircle / overlapBox / raycast / los   都认 OBB。moveCircle 起点已经压进 OBB 时，先沿最小穿透方向推出
                                       （一次调用最多推 r，下一次再推，不会卡死，也不会一帧瞬移）；子步 ≤ r/2，10 cm 宽的货叉也穿不过去
ignoreKey 的前缀匹配                    只对 OBB 生效：ignoreKey 'veh|1@0,0#v0' 跳过 'veh|1@0,0#v0#chassis' 这类部件 key；
                                       AABB 照旧精确匹配（ignoreKey '0,0' 时 '0,0#p2' 不被跳过）
sweepOBBs(list, { dx, dz, dyaw, px, pz }, { ignoreKey, skipBoxes, circles, boxes, y }?) → { t, key, circleId, kind, index, name, box, boxIndex, depth } | null
                                       一组随车转动的 OBB 绕 (px, pz) 转 dyaw 再平移 (dx, dz)，子步 ≤ 5 cm 且 ≤ 2°，对静态 AABB、别的 OBB、
                                       circles（人、怪：[{ x, z, r, minY, maxY, id }]）、boxes（禁区：world.blockers() 的圆 / 矩形、头顶条目）
                                       找第一次碰撞；t = 最后一个不撞的时刻 0..1，整段不撞返回 null。停下处总留约 0.1 mm 的缝；
                                       出发时已经贴着或压着的东西只要不更近 / 更深就不算撞（贴墙能倒出来、能沿墙开）
overlapOBB(o, { ignoreKey, skipBoxes, tol, out }?) → 重叠个数；records(key) → { solids, obbs }（测试、调试用）
skipBoxes（FE1 返修 r3）                sweepOBBs / overlapOBB / raycast 认：[[minX, minY, minZ, maxX, maxY, maxZ]…]，跳过六个数都差 1 mm 以内的静态 AABB
                                       （区块里一整块共用一个 key，ignoreKey 跳不了其中一块；叉车用它跳过斜放地牛脚下那块老碰撞体，见 15.10）。不给就逐位不变
obbVsAabb(o, a); obbVsObb(a, b); circleVsObb(x, z, r, o, yFeet?, height?) → { depth, nx, nz } | null; pointInObb(o, x, [y,] z)
toWorldOBBs(list, x, z, yaw, y?)       纯函数：本地部件盒（geo.obbs(lift) 的 { name, cx, cy, cz, hx, hy, hz }）摆到世界里
```
- 硬要求：场景里没有任何 OBB 时，所有函数的结果和改前逐位一致（golden 的实体落点靠它；tests/phys.test.js 用 1000 个随机用例对照）。
- phys key 的约定：区块碰撞 'cx,cz'；kit 道具 / 固定设备 'cx,cz#p<n>'、'cx,cz#f<n>'；停着的叉车外接 AABB 'cx,cz#v<i>'（载入后换成 14 个 OBB
  'cx,cz#v<i>#<部件>'）；开过的车 'veh|<车 key>#<部件>'（整层常驻，不跟区块走）。

### BR.interact（js/game/interact.js，交互大改 A1；完整规则和候选字段见文件头）
```
addSource(name, fn(ray, reach, out)) / removeSource(name)   各模块往 out 里 push 自己的候选（物资、kit 道具、实体是内建来源；
                                       载具来源 'vehicles' 由 BR.vehicles 加，FE1）
handle(kind, { short(c), hold(c), drag: { grab, move, release } })   登记一种候选的动作（'vehicle' 由 BR.vehicles 登记）
hit.sphere / hit.box / hit.obb / hit.cylinder(ray, …)  候选的命中测试，返回 t（起点在体内为 0），没打中 -1
setMode('walk' | 'seat' | 'lie' | 'drive' | 'view', owner)   情境：同步 BR.input.setContext（lie → 'seat'）和 BR.coop.setPose；
                                       owner = { key, kind, label, short, hold, onShort, onHold, accept }（缺的按情境默认值补）
update(dt, inp | null); current; target; state 'idle' | 'pressed' | 'drag' | 'hold'; dragging; mode; owner（接管者的 key）; crossHidden
holdProgress(); speedCap(); cancel(reason); aimAt(x, y, z); heldInfo(); debugInfo()
```
- 准心对准 + 空格短按 = 使用 / 拾取，长按（≥ `BR.config.interact.holdMs` 350 ms）= 拖动；原来的互动键只在 input.js 里留作隐藏别名，界面文字里只写空格。墙、通往别层的门、出口不登记成候选，所以拖不动。
- 按下那一刻怎么走（`onPress`）：
  - 有使用动作、也有长按动作（能拖、有 `hold`、或者长按要给原因 `dragWhy`）的候选：先进 PRESSED，按住不到 holdMs 松手 = 短按，按满 holdMs = 拖动 / 长按动作 / 只给原因。叉车属于这一种：短按「上车」，长按只给「叉车太重，拖不动」，车一点不动。
  - **只有短按、没有任何长按动作的候选，按下即执行，不等松手**：情境里的「起身」「下车」，以及自己拖不了、又没有可拖父道具的东西。A1 方案字面是「有 short 的一律先进 PRESSED、松手才算短按」；A1 验收 minor ⑦ 由主会话决定**保留按下即执行**（两种写法玩家只差按下到执行的那几十毫秒，按下即执行更跟手），以本条为准。以后真要改成松手执行，只改 onPress 里那一行（`setState('pressed')`，stepPressed 已经能处理）。
  - 只能拖的（kit 家具、测试人、门扇）一按就拖；有用途但此刻用不了的种类（物资、容器、设备、座位、载具、按钮）进 PRESSED，短按不出动作，也不拖。
- drive 情境（FE1）：BR.vehicles 上车后调 `setMode('drive', { key: 车 key, kind: 'vehicle', label: '叉车', accept: () => false, onShort: 下车 })`。`accept` 恒为 false，准心对着哪里都只有情境候选「下车」（`MODE_DEFAULTS.drive`），它只有短按，所以按下即执行；中间提示「空格 下车」（手机「点「下车」」）。坐车时捡不了、丢不了东西，冲刺没用；F 吃喝、切背包格子照常。
- 新开一局 / 回主页时内部的 reset，和死亡、换层时的 `cancel`，都**不通知 owner**：接管情境的模块要自己听 `game:start`、`game:home`、`level:leave`、`player:death`（BR.vehicles 就是这样强制下车的），漏一个就会留在 drive 情境。

### BR.player（js/game/player.js）见第 8 节，另加：
```
update(dt)                             读 input、走 phys、按 statsEnabled 结算饥饿/san
interactTarget(): pickup | null        准星附近 2 m 内最近的拾取物
mount(handle) / unmount(reason) / mounted / pose   上下车（FE1），handle 的格式见第 15.5 节
```
- 坐着时：照常转视角（pitch 限位不变）、照跑 interact.update 和 handleActions，跳过 updateMovement / updateVertical / updateBob；每帧调 `handle.update(dt, inp)`（输入关着时 inp 传 null），
  拿回来的 `{ x, z, eyeY, feetY, dyaw, noise, shake }` 写进 player：x / z = 座椅，y = 眼高，yaw += dyaw（车转弯视角跟着转），noise = 车的响动，镜头加 shake 抖动（系统设了减少动态效果就不抖）。
- 上车、下车各 0.5 s 眼点插值，沿 `handle.path('in' | 'out')` 的三个点走折线（站立 → 踏板上方 → 座椅；下车反过来，车尾下车时中间点是配重上方），插值时不能动，首点换成当前眼点不跳。不许用 reset 每帧摆位（会把 pitch 清零）。
- reset、respawnInPlace、死亡结算之前先调 `handle.forceExit(reason)`。`dropSelected` 先问 `BR.vehicles.dropSurface(px, pz, r)`：返回车就把物品 `still: true` 刷在返回的叉面高度上并 `attachItem`，返回 null 照旧落地。

### BR.items（js/game/items.js）
```
spawn(type, x, y, z, { id, chunkKey }?): pickup     pickup = { id, type, x, y, z, obj, chunkKey }
removeChunk(chunkKey); clear()
nearest(x, z, maxDist): pickup | null
pick(id, by): bool                     by = 'me' | 'peer'；进背包并从场景移除
update(dt)
list
```

### BR.world（js/game/world.js）
```
start(levelId, seed): Promise          清场、载入出生点周围区块、放置玩家、emit level:enter
goTo(levelId, via?): Promise           淡出 → 换层 → 淡入
update(dt)                             流式加载/卸载、出口检测、level.update
current; levelSeed; chunkArea
lightAt(x, z): 0..1
clear()
chunkCoordsAt(x, z): { cx, cz }        chunkBounds(cx, cz): { minX, minZ, maxX, maxZ }
chunkAt(x, z): 区块记录 | null          chunks(): 全部已载入区块记录；exits(): 已载入出口描述（记录只读）
decal(x, z, { color, radius=0.6, ttl=60, y? }?): bool
                                       贴地斑块（墨迹、腐蚀痕）。纯表现、不同步，各端按实体位置本地调；区块没载入返回 false。
                                       全场 1 个 InstancedMesh（1 个 draw call），高画质 ≤64 / 低画质 ≤32 块，满了挤掉最老的；
                                       每块记所属区块，区块卸载时清掉，clear()/换层全清；寿命最后 20% 缩小消失。
                                       y 缺省取 phys.groundY；不进 chunk.group，不影响区块几何（golden）
decalInfo(): { count, cap, byChunk: { "cx,cz": n }, inScene, visible, instances }   调试 / 测试用
blockers(opts?) → [{ kind: 'exit', x, z, r, y? } | { kind: 'keep', x, z, r, why } | { kind: 'keep', x0, z0, x1, z1, why }]
                                       拖动禁区（N1），世界坐标：已载入区块里 active 不为 false 的出口圈（r = radius + margin，
                                       margin 缺省 BR.config.interact.exitMargin 0.4；y 是出口高度，楼上楼下的出口按它跳过），
                                       加上层级定义的 keepClear（圆或矩形，原样给出不外扩；why = 拖到边上时说的话）。没写 keepClear 的层只有出口圈，和以前一样。
                                       interact 拖东西、_kit.js 判断生成时能不能拖、coop.propPlaceOk 共用这一份，道具停在区外。
                                       opts.exits 用这组出口描述代替已载入区块的（kit 建块时传本块自己的）；opts.level 读哪一层的 keepClear
                                       （缺省当前层，显式 null 不读）；opts.margin 出口圈外扩；opts.x / z / r 只要 (x, z) 附近 r 以内的
setExtraLights(owner, list | null) → bool
                                       额外光源（FE1：开着的叉车前大灯，owner 'fk:' + 车 key）：整组替换，null / 空数组 = 撤掉；并进 pushLights 交给
                                       gfx 的灯池，和区块灯一样按离相机的距离挑（最多 maxDynamicLights 盏真光，层级不自己建 PointLight）。
                                       光源 { x, y, z, color, intensity, range, decay?, flicker? }（世界坐标）由调用方持有、每帧直接改 x / y / z，gfx 每帧跟随；
                                       颜色、强度、range 变了要再调一次。工坊的 lightTransform 照样套；lightAt 也算上它们；换层、回主页整个清空
```
- 区块状态模块表（`applyChunkState` / `unloadChunkState`）：`['containers', 'devices', 'vehicles', 'cargo']`，不存在的模块自动跳过（cargo 是 FE2 的）。
  `BR[m].applyChunk(c, st)` 必须幂等，`st` 为 null 表示本层没有记录（或工坊编辑态）；调用时机在 setupProps 登记完碰撞体（含 kit fixture 的 skey，例如停着的叉车 `'cx,cz#v<i>'`）、
  placeChunkProps 套完偏移之后，spawnItems / spawnEntities 之前、区块第一次渲染之前 —— 开走的车在原地藏掉顶点，不会闪一帧。卸块时先 `unloadChunk` 收尾，再拆几何。
- `BR.player.mounted`（或 `pose === 'drive'`）时 collectInside / checkExits 直接跳过：坐在车上不触发出口，也不显示「尚未开放」。车本身开不进出口圈 +0.4，下车落点也不在出口圈里。
- props / fixtures 两个准心来源跳过 `kind === 'vehicle'` 的登记：碰撞体照常按 skey 登记，候选交给 BR.vehicles 自己的来源（不然同一台车两个候选，「叉车太重，拖不动」会盖住「空格 上车」）。
  spawnItems 一行没改：压在车 OBB 里的地上物资由 BR.vehicles 推出去。

### BR.arch 视觉钩子（js/entities/_archetypes.js，ENGINE_PLAN M1；完整写法见 js/entities/_TEMPLATE.md 6.10）
```
RigBuilder.box/sphere/limb/cone/chain/geo(..., { tint: 0xRRGGBB })   顶点色；最终颜色 = 槽位材质色 × tint
A.mat.keyOf(material): string | null   缓存键（tint 槽位的材质键 = 原键 + '/vc'）
u.slotMat(slot): Material | 只读视图 | null      u = A.wrap 返回的 root.userData.arch（anim.onFrame / animate 第 4 个参数）
A.fx.vanish(e, { sec }?) / A.fx.appear(e, { sec }?)   写 e.state = 'vanish' / 'appear'；淡出淡入在 animate 里跑（房主和客机都跑）
A.fx.update(e, dt)                     自己写 animate、没用 def.anim 的实体手动推进淡出淡入
A.fx.burst(x, y, z, { color | [colors], count=24, speed, life, gravity, drag, up, spread, floor, flash=true, radius, flashSec }?): 实际发出的粒子数
A.fx.clear()   A.fx.debugInfo(): { particles, particleCap, poolMax, points, clones }
```

### BR.entities（js/game/entities.js）
```
spawn(type, x, y, z, { id, chunkKey }?): e
spawnForChunk(level, chunkKey, spawnPoints, rng)    按第 5 节公式生成
removeChunk(chunkKey)
update(dt)                             authoritative 为 false（联机客机）时不跑 AI，只插值快照
clearRadius(x, z, r)
clear()
list; authoritative
snapshot(): [[id, type, x, z, yaw, state, hp, y?, flags?, infStage?], ...]   尾部 3 列只在感染中的实体上出现，见第 9 节
applySnapshot(list)
infect(target, spec, source?): bool    target 为实体 / id / BR.player / findTarget 结果；新感染上才返回 true
transform(e | id, toType, { key, cause }?): e | null    仅房主
isHuman(target): bool                  本机玩家，或 def.human === true 的实体（目前只有测试人）
```
- **坐在车上的玩家**（FE1 叉车；本机或联机队友，`BR.vehicles.cabFor(玩家)` 给出驾驶舱矩形）：视线目标点 = `BR.vehicles.chestOf(玩家)`（护顶四周是空的，从车侧、车尾看得见坐着的人）；
  追击目标点 = 车身左右两侧（驾驶舱那一段，z ∈ [−0.5, 0.55]）和车尾外沿上离怪最近的一点，往外让出怪的半径；攻击距离量到驾驶舱矩形，货叉不算 ——
  货叉尖前面的怪够不着，会绕到车侧或车尾（叉车不是安全屋）。spawnForChunk 和实体表一行没改（golden 的实体落点靠它）。
- 队友开的车在房主这边只按位姿摆 OBB（不扫掠）：开到站着不动的实体身上时，每 0.25 s 把车 4 m 以内被压住的实体推到车外 —— 先用 moveCircle 零位移轻推；推不出来（夹在两根货叉之间、几个部件 OBB 互相顶着）就一圈圈往外找最近的空地放过去（落点不压任何碰撞体，从实体到落点腰高的射线除了这台车自己的部件不碰别的东西，不会被放到墙那边）；场上没有载具时什么都不做。

**感染与转化**（ENGINE_PLAN M4「状态效果、感染与转化」的子集，2026-09-14；目前只有悲尸在用，M4 在此基础上扩成通用 `addEffect` / `applyEffect`）
```
spec = {
  key: 'wretch_cycle', toType: 'wretch',
  stages: [{ at: 0, ...玩家侧字段 }, { at: 15, ... }, { at: 30, ... }],   // at = 感染后第几秒进入该阶段，第一个必须是 0
  transformAt: 45,              // 到这一秒还没治好就转化
  deathRiseSec: 4,              // 感染中被打死，尸体几秒后原地爬起来变成 toType（0 = 按普通死亡处理）
  sparesInfected: true,         // 可选：带这份规格的实体（def.infection）不再攻击已带同一 key 感染的实体
  cause: '你变成了悲尸',         // 玩家侧死因
  cureToast: '…',               // 玩家治好时的提示
}
```
- 感染源实体在定义里写 `infection: spec`（悲尸两种形态都写了同一份）。`sparesInfected` 为真时，`canAttack` 对已带同一 `key` 感染的实体返回 false（findTarget 扫候选、保留旧目标、attack 都认），悲尸挠上就去找下一个——测试人不会跑也不还手，不放过的话挨两下就死，看不到后面的阶段和原地转化。只管实体目标：噩梦里的玩家照常被追杀（模式规则）。
- 阶段提示停留时长：`stages[i].toastMs`，不写按字数估（每字 120 ms，2.2–6 s），`cureToast` 同样按字数估。
- 客机回单机（本机重新拿到权威）时，快照建出的没有 `spec` 的感染记录在下一次 AI 帧清掉，之后可以被重新感染。
- 旧来源兼容：L8.js 进层时自己订阅 `player:damage` 做的 20 s 悲尸感染持续伤害（source `'hazard:wretch-infection'`）已被 `wretch_cycle` 取代，`player.damage` 直接忽略这个来源；M4 回填 L8 删掉那段订阅后一起删。L8 那句"你被感染了"的 toast 仍会和第一阶段提示同时弹出（L8.js 不在 2026-09-14 这次的改动范围）。
- 实体目标（仅房主）：写 `e.infection = { key, toType, stage, stageAt, since, elapsed, riseAt }`（只读，给 `animate` 画症状；客机上由快照建出，只有 `stage` / `stageAt` 有意义）。已感染再中不重置计时；目标类型就是 `toType` 时不感染；被这一击当场打死的也算感染上（直接进入爬起倒计时）。到 `transformAt` 在原地（位置、朝向、`chunkKey`、`manual` 继承）生成 `toType`、移除原目标（不算击杀），发 `entity:transform`；感染尸体到 `deathRiseSec` 爬起来（原目标补发 `entity:kill`）。尸体爬起是净增一只，活跃实体数达到 `maxActiveEntities` 时改按普通尸体结算；活着的原地转化是一换一，不受限制。清场（`clearRadius` / 区块卸载）遇到等着爬起的尸体按击杀结算。
- 玩家目标：只对本机玩家、只在 `BR.game.attackPlayers` 为真（噩梦生存）时生效，转成 `BR.effects.add({ key, stages（at 换成 seconds）, onExpire: 'transform:<toType>', cause, cureToast, tags: [key], negative: true })`。阶段字段 `toast` / `visual` / `cureTags` 由 BR.effects 处理，吃喝后 `player.useSelected` 调 `BR.effects.cureByItem(def)`。不打 `'infection'` 标签、不标 `hostile`：消毒剂按标签清、杏仁水按 hostile 清都不看阶段。到期走死亡结算（causeKey `'transform:<type>'`），不在原地生成实体（用户 2026-09-14 定，避免和"继续时清掉附近实体"冲突）；原地重生清负面效果时一起清掉。
- 联机：N1 期间能两人一起玩的是游玩和测试模式，这两种模式实体都不打玩家，房主的实体也不以客机为目标，所以客机玩家没有感染通道；实体的感染症状经快照尾列同步。N2 打开噩梦联机时要补上客机玩家这一路（房主判定、客机结算）。
- 实体行为里的用法：`onAttack(e, t, api) { if (api.isHuman(t)) api.infect(t, SPEC, e); }`；`api.transform` 同 `BR.entities.transform`。

### BR.hud（js/game/hud.js）
```
init(); show(bool); update(dt)         顶部：san、饥饿、HP（仅 statsEnabled）；背包栏；准星；互动提示
toast(text, ms?); levelTitle(level); prompt(text | null)
pause(bool)                            暂停菜单：继续 / 能见度 / 返回主页（emit 'game:home'）
                                       联机局里（BR.coop.active、hosting、phase 'reconnecting'，或人在营地）顶上加「联机时暂停，世界不会停」，
                                       「返回主页」换成「回营地」（不在营地、队友连着时才有，调 BR.coopCamp.back()）和「离开联机」（点两次，
                                       确认后先 BR.coop.leave() 再 emit 'game:home'）；营地里只有「继续」「离开联机」。见第 9.9 节
notice(text, actions, ms, opts?) → { close(), set(text, ms?), open }
                                       屏幕上半部中间的横幅（.hud-notices，z 65），暂停、结算、黑幕时都看得见。actions = [{ label, fn, key? }]，
                                       按钮 ≥ 44 px；点按钮先调 fn(句柄)，fn 返回 false 时横幅留着，否则关掉。ms > 0 到时自动关并调 opts.onTimeout；
                                       有按钮时显示倒数秒数（opts.countdown 控制）。桌面上按钮带键帽（没给 key 时按顺序配 Y / N / U，key:false 不配），
                                       指针锁着时按键盘就行。game:home 时全部关掉（opts.keep 为真的除外）
curtain(text | false, ms?) → Promise<bool>
                                       全屏黑幕（.hud-curtain，z 56；gfx 的淡入淡出占着 55），中间一行字，淡入淡出各 0.4 s。
                                       传文字：全黑那一刻 resolve(true)（已经全黑时只换字、立即 resolve）；没到全黑就被 curtain(false) 打断 resolve(false)。
                                       传 false：清掉层级大标题的去重计时（TITLE_DEDUPE_MS），淡出完 resolve(true)，再补播黑幕期间记下的层级大标题。
                                       黑幕没完全撤掉时 levelTitle 只记下最后一次、不播。game:home 时立刻撤掉，没 resolve 的都 resolve(false)
visible; paused; curtainState          只读；curtainState 'off' | 'in' | 'black' | 'out'
setDrive(state | null)                 常驻开车提示行（FE1）：独立的 DOM，放在中间交互提示下面、物品栏上面，不和准心提示抢位置，
                                       也不会被「尚未开放」之类的 prompt 挤掉。state = { key, label: '叉车' }，null 收起。文字按 BR.input 是不是触屏切换：
                                       电脑「W/S 前进后退 · A/D 打方向 · R 升货叉 · C 降货叉 · 空格 下车 · F 吃喝」，
                                       手机「摇杆开车 · 按住「升」「降」动货叉 · 点「下车」下车」
                                       触屏按档摆：13px 整段不折行 → 12px → 11px → 12px 允许「按住「升」「降」」和「动货叉」之间折行（只有 320 宽竖屏用得上），
                                       第一个不压任何按钮、摇杆、物品栏（连同物品名那一行）的档就用它（360×640 竖屏是 11px 三行，每行一整段；320×568 竖屏拿着东西时是 12px 四行）；
                                       每一档在准心下面都放不下时挪到准心上方（状态短提示那一格上面、左上信息块下面，让开按钮、测试模式「实体」入口、联机麦克风键），
                                       再不行才压住物品名那一行（repair-r2：以前压物品名排在换小字号之前，320×568 字叠字）。`BR.hud.drive.place` = { mode（用上的档）, upper（挪到了准心上方）, fit, … }
driveNote(text, ms?)                   开车状态短提示（「发动中」「雷达自动刹车」「前面是出口」「上面有管子，升不上去」……）：同一行替换，不排队刷屏。
                                       准心正上方居中；触屏上这一高度旁边有键（窄竖屏的升键）时一行放得下就往空的那边挪，一行实在放不下才折行（不截字）。
                                       层级大标题还没收、和它（或挪到准心上方的常驻提示行）压在一起时，大标题 0.25 s 淡出（进层 5 秒内就上车的情况）
```
- toast 自动避开多行交互提示和开车提示行（A1 minor ①）。新文字里不出现隐藏别名键的那个字母；HUD 写手机提示时跟着 `BR.input.buttonLabel('interact')`（开车时是「点「下车」」，不重复成「点「下车」下车」）。
- 准心提示的动词（VERB_PHRASE）N1 新增「进帐篷」「出帐篷」「看地图」「换制服」；FE1 新增「上车」「下车」，repair-r2 新增「开大灯」「关大灯」（仪表台大灯开关）。
- 模式标签：营地（层级 `lobby` 为真）写「联机营地（Level 1 某处）」、不显示饥饿 / san / HP 条；`BR.coop.active` 时原标签前加「联机 · 」。
  房号角标：`BR.coop.hosting` 为真、还没人连上时左上角加一行「房号 K7M2QX · 等朋友来」，收到 bus `'coop:code'` 立刻刷新并 toast「房号换成了 …」。

### BR.death（js/game/death.js）
```
show({ cause, levelId, time, deepest })   「继续」emit 'death:continue'；「返回主页」emit 'game:home'
hide()
```
联机局里按钮换成「继续」（原地重生，不变）/「回营地」（调 `BR.coopCamp.back()`，要对方同意；结算页留着，同意以后 game:start 自己收起）/ 小号的「离开联机」（点两次）。单机时不变。

### BR.home（js/ui/home.js）
```
init(); show(); hide(); shown          shown：主页正显示着（邀请链接等它再弹联机面板）
openMenu()                             直接打开模式菜单
开始游戏时 emit 'game:start' { mode, difficulty, settings, seed, coop: null }   主页开局一律单人，两人一起玩走主页「联机」→ 营地 → 帐篷
modeText                               [[key, 名字, 说明] × 3]，用户定的顺序：游玩 / 噩梦生存 / 测试模式；帐篷的模式卡读它，两边一字不差
levelOptions(opts?) → [{ id, label, ok, note }]
                                       起始层级列表，按 BR.LEVEL_ORDER 排（隐藏层永远不列）。note '制作中'（本机没注册）；
                                       opts.only（Set 或数组）里没有的层 ok=false、note '队友没有这一层'（帐篷传两边都有的层）；
                                       opts.dev 为真并且地址栏带 ?dev 时末尾加开发测试层 'dev'
levelLabel(id) → 'Level 3 · …'
modeFields(el, mode, value, onChange, opts?) → { get(), set(patch), destroy(), root, levelSelect, levelField }
                                       主页三个弹窗和帐篷选单共用的模式表单：游玩画「实体生成量」滑条；噩梦画 4 张难度卡（只选中、加 .is-on，
                                       不开局）；测试什么都不画；都不画能见度（它只影响自己）。opts.level 为真时再画「起始层级」下拉
                                       （opts.level 可写成 { only, dev }，照 levelOptions 列层）。
                                       value / get() 的字段两套名字都认：spawnSlider|spawn、difficulty|diff、startLevel|lv，外加 mode。
                                       onChange(get()) 只在玩家动了控件、值真的变了时调；建表单和 set() 都不回调。
                                       set(patch) 只改给了的字段；patch 带 mode 就地重画，带 only / dev 换层级列表参数整组重画
```
- 主页「联机」按钮：`.home-secondary-btn.is-coop`，在 `.home-secondary-actions` 里按 DOM 顺序 联机 / 创意工坊 / 设置；竖屏手机（max-aspect-ratio 17/20 且宽 ≤ 559）用 order 排到最下面一格。点了的检查见第 9.1 节。
- 「游玩」弹窗里没有联机、开麦按钮和联机状态行，副标题写「实体不攻击你，可调能见度和实体数量」。噩梦弹窗照旧从 Level 0 开始（帐篷里才能选层）。

### BR.coop（js/net/coop.js）
```
init(); update(dt); leave(); active; role; phase; peerName
                                       phase：idle | creating | hosting | checking | confirm | joining | connecting | handshake | active | reconnecting
                                       （reconnecting 时 active 为 false）
openLobby(opts?); closeLobby()         opts.join = 房号：停在加入卡片那一步（邀请链接用）。在局内只显示当前联机状态，不能新建也不能加入
mic: bool; micBusy; setMic(on)         开麦/闭麦
localSpeaking; peerSpeaking            0..1 音量电平（AnalyserNode）
setVoiceVolume(v) → 夹过的值; voiceVolume   对方语音音量 0..1（设置「联机语音音量」，启动时和 coop:connected / coop:reconnected 时由设置面板调）。
                                       记住，之后每条新的对方语音流（含重连）都照用。桌面 / 安卓：交给 BR.net.setRemoteVolume 设 <audio>.volume；
                                       iOS Safari（BR.net.volumeWorks 为 false，<audio>.volume 只读恒为 1）且音量 < 100% 时：电平检测那路
                                       MediaStreamSource 再分一支经 GainNode 接 destination（coop 自己的 AudioContext），<audio> 静音但继续播；
                                       100% 时拆掉，照旧只用 <audio>。debugInfo().voice = { vol, gain（没走 GainNode 时 null）, ctx }
peer                                   对方当前渲染位置 { x, y, z } | null
—— 联机营地（N1）——
hosting                                房主开着营地、还没人连上（HUD 房号角标、小黑板「等朋友来」）
code                                   房主当前的房号（续期、落单重开会换，换时 bus 'coop:code' { code }）
peerLevels                             对方 hello 里的 lv（对方已注册的 LEVEL_ORDER 层级 id）；没连上时 null
hostMode                               这一局房主开的模式（房主 = 自己在世界里的模式，客机 = world 消息里的）；没有时 null
inCamp                                 人在营地里
sameRun() → bool                       两人在同一局里：在世界里、模式能联机；客机还要求模式、种子和房主一致
startRun(payload) → bool               只给房主：补上 coop:{ role:'host' } 再 emit game:start（帐篷出发、回营地）
createRoomInPlace() → Promise<房号 | false>   营地里落单时原地重新开房、角色切成房主，不重开世界
can(cap) → bool                        对方有没有这项能力：'ev1' 拖动、'fx1' 使用请求与座位、'veh2' 叉车驾驶（FE1；'veh1' 只是 A1 占的位，
                                       不代表能开车）、'camp1' 营地（N2 加 'nm1'）；单机恒为 true
clock() → 秒                           联机时以房主时钟为准（帐篷倒数 goAt 用它）；只增不减。新开一次联机（面板上开营地、加入、「回去？」）时清零重估，
                                       客机还没收到房主时钟时先给本机时间但不记进单调值（2026-10-05 返修 r2：本页比房主页面老时会卡住不走）
debugInfo()                            { active, role, phase, caps, peerCaps, code, spare, hostMode, hostSeed, hostLevel, peerLevels, sameRun, inCamp, rc, lobby, … }
—— A1 事件通道（协议见 coop.js「事件通道」一节）——
emit(kind, payload) → bool; on(kind, fn) → 取消函数      对方收到 bus 'net:' + kind
use(k, a, p, cb, x); onUse(a, fn)       客机的使用请求交给房主核对（帐篷 'tent'、测试模式 'test:spawn' / 'test:clear' 都走它）
leaseOf / requestGrab / release / hand / setPose; peerPose; peerCaps
                                       叉车（FE1）：租约 'k:' + 车 key = 谁坐在驾驶座上；requestGrab('k:' + key, 'veh', cb)，
                                       hand('k:' + key, x, z, yaw, steer, lift, 0, spd, on) 每帧刷新、随 15 Hz 的 me.h 捎带，release('k:' + key, [x, 0, z])；见第 15.7 节
```
- bus 事件：`'coop:connected'`、`'coop:code'`、`'coop:reconnecting'`、`'coop:reconnected'`、`'coop:peerGone' { where: 'camp' | 'level', name, why }`、`'coop:mic'`（见第 4 节）。
- sessionStorage `'br_coop_rejoin'` = `{ code, host, at }`（客机，3 分钟有效，见第 9.11 节）。配置 `BR.config.coop`（见第 9.13 节）。

### BR.net（js/net/net.js）
```
on(fn(type, data)) → 取消订阅           'status' | 'peerJoined' | 'connected' | 'disconnected' { reason, wasConnected, spare, byPeer } | 'peerLeft'
                                       | 'msg' | 'error' { code, text, fatal } | 'remoteStream' / 'localStream' | 'mic' | 'phase' | 'code' | 'spare'
createRoom(name, hooks?) → 房号         昵称截到 15 个字再接营地暗标 U+2063
roomInfo(code) → { state, hostName, isCamp, guestName }        名字都已剥掉暗标
joinRoom(code, name, hooks?) → { hostName, isCamp, code }      先 status 复查：closed / 不是营地 / 满了都不去占房
spareCreate() → Promise<备用房号>; reconnectHost(code?, hooks?); reconnectGuest(code, hooks?)
send(obj, { lossy }?) → bool; setMic(on) → Promise<bool>; leave(); errorText(code)
setRemoteVolume(v) → 夹过的值; remoteVolume   对方语音 <audio> 的音量 0..1；teardown 不清，attachRemote 每条新流（含重连）都重新设上
setRemoteMuted(on)                     静音 / 取消静音 <audio>（coop 改走 GainNode 时用）；每条新流都先取消静音，coop 接好再静音
volumeWorks                            false = 本机不认 <audio>.volume（iOS / iPadOS Safari），加载时写一下读回来判断
hooks = { onPhase(p), onCode(code), onSpare(code), inLobby(), name }
                                       onPhase：'hosting' | 'joining' | 'waitHost' | 'waitGuest' | 'connecting' | 'connected'
CAMP_TAG; stripTag(s); isCampName(s)
```
错误码和文案见第 9.3 节；没有中转服务器（TURN），不同网络下有时连不上。

### BR.coopCamp（js/game/coopcamp.js）
```
update(dt)                             main.tick 每帧调（暂停时也跑）；自己不开 rAF 和定时器
enter(opts?); exit()                   进帐篷（自动走到站位、开选单；opts.force 跳过「走到门口」检查，测试用）/ 出帐篷
back() → bool                          提出回营地（emit 'campAsk'），暂停菜单和结算页的「回营地」都调它
onBack() → bool                        main.js 的 Esc / 返回键先问它：选单开着时关选单、走出帐篷，返回 true
inCamp; panelOpen; state; last; transit 只读：state 见第 9.7 节；last = 上一局的选择（会话内存，离开联机清）
_debugSet(patch); debugInfo()          测试口：房主直接写 state（lv 可以是 'dev'），客机走同一条 use；patch 还可以带 ready
```
事件、共享选择、出发和回营地的规则见第 9.7–9.9 节。

### BR.tentMenu（js/ui/tentmenu.js，class 前缀 `tent-`，z 54）
```
open(handlers, view); close(); render(view); update(nowMs, { count, canCancel } | null); flash(); isOpen; root
handlers = { onMode(key), onFields(patch), onMap(id | null), onReady(bool), onCancel(), onExit(fromClick) }
```
只管 DOM，规则都在 BR.coopCamp。按钮文字因为对方改动而变了时禁用 1 s。

### BR.L1room（js/levels/L1.js 末尾的窄接口，N1）
```
build(b, spec) → { lamps: [灯描述], clear: [{ x0, z0, x1, z1 }] }
                                       用 L1 自己的构件（柱、梁、吊灯、管道、承重墙、货架、堆垛）建一间仓库间或窗外带。坐标一律区块本地，柱网 8 m。
                                       spec = { x0, z0, nx, nz, sector, orient?, walls: 'ring' | 'none', windows: [{ side, at, w, y0, y1 }],
                                                bays: [{ i, j, kind: 'rack' | 'stack' | 'open' | 'keep', orient }], noLoot, keep: [{ x0, z0, x1, z1 }],
                                                pre(b), preNominal, budget, extra? }
                                       walls 'ring' = 沿矩形四周承重墙（墙顶到梁底 3.55）；'none' = 窗外带，只有柱、梁、吊灯、管道、货架，没有刷新点。
                                       windows 在墙上开铁丝玻璃窗（看得穿，碰撞仍是整面墙）。sector 不能是 tianying / garden。
                                       pre(b) 是调用方的家具，按 preNominal 固定面数先入账，货架分配和画质无关。noLoot：容器标 loot: 0。
                                       不放叉车、小屋、电视、出口；吊灯全亮，没有 update（不断电、不闪）
env                                    L1 的环境（拷一份再改）
mats = { wall: 'L1:wall', floor: 'L1:floor', define() }
height; pillarW(sector)                楼板底标高 4.0；柱子边长
```
- **调用方的 builder 必须带固定的 levelSeed**（营地用 `CAMP_SEED`）：私有函数照用 `b.seed`，布局就和游戏种子无关。L1 自己的 `buildChunk` 一个字不动，`golden --levels 1` 逐字节不变。
- 营地路径（`BR.L1room.build`）不写 `b.data.overhead`、`b.data.sideObs`、`b.data.vines`，也不走出生保底车（FE1）。

### BR.L1forklift（js/levels/L1.js 末尾的窄接口，FE1；给 vehicles.js / forklift.js 用）
```
geo                                    FORKLIFT_GEO（深冻结，只读）：车身坐标原点 = 车底投影中心的地面，−z = 车头（门架、货叉），+x = 坐着的人的右手边。
                                       原有字段（轮心、门架、链条、方向盘、seat、eye { 0, 1.8, 0.16 }、half……）之外，FE1 新增：
                                       maxSteer 1.13（后轮最大转角 65°）、forkW 0.1、forkT 0.04、forkZ [−2.1, −1.16]、tineX [−0.28, 0.28]、
                                       backrestH 1.16、carriageTravel 2.6、liftLever { pivot, axis, travel: 0.35 }、
                                       mountZone { xMin: 0.6, z0: −0.95, z1: 1.05, reach: 1.5 }、stepPoint (±0.75, 0.35, −0.19)、
                                       exitSide { x: ±1.0, z: 0.24 }（座椅侧外 1.0 m）、exitRear { x: 0, z: 1.75 }（配重后 0.5 m）、
                                       cab { x: 0.4, z0: −0.5, z1: 0.55, zHood: −0.1, yFloor: 0.62, ySeat: 1.16, yTop: 2.05 }、seatChest (0, 1.66, 0.24)、
                                       pose(lift) → { inner: 1.3·lift, carriage: 2.6·lift }、obbs(lift) → 14 个 { name, cx, cy, cz, hx, hy, hz }（见第 15.4 节）
model(b, opts)                         forkliftModel。opts = { lift, steer, part, detail, number, decal, drive, levers, seg }：
                                       part 'all' | 'body' | 'liftLever' | 'wheelsFront' | 'wheelsRear' | 'wheelRearL' | 'wheelRearR' | 'steeringWheel'
                                       | 'mastOuter' | 'mastInner' | 'carriage' | 'chains'（'body' 不含升降杆）；
                                       part 'all' 且不开 drive 时照原位置、原顺序画，顶点逐位不变（停着的车、golden 都靠它）。
                                       drive: true = 可动模型（只给开过的车）：货叉水平段等补底面；后轮转向扫过的圆柱里底盘收窄到半宽 0.188、
                                       配重下半截前脸让开（打满 65° 胎面离车身 ≥ 1 cm）；安全带两条、4.4 cm 宽；两盏前大灯镜面和警示灯罩放进 kit:glow
                                       （只这一份，不和 kit:prop 叠着）；levers = 操纵杆根数（传停放档的根数，至少 1，升降杆要能扳）。drive 不取随机数
wear(b, opts)                          磨损贴花：opts = { detail, wearN, part = 'all', lift = 0 }，画 FK_WEAR[1..wearN]，跳过 FK_WEAR[0]（车下那滩油不随车动）；
                                       part: 'oil' 只画那滩油（保底车的地面油渍）。不看区块贴花上限，返回画了几片
lod                                    FK_LOD：high / mid / lite / low / lowb / min，FE1 加 drvLow = lite 去掉倒角和贴花（bev:false、ch:0、cwC:0、decals:0），
                                       也就是 low 加上扶手、安全带、倾斜油缸耳座，没有 trim 砍掉的面
ladder                                 FK_LADDER：停放档的挑档顺序 { high: [...], low: [...] }
driveTier(quality, parkedTier)         开过的车用哪一档：低画质一律 'drvLow'；高画质 = 停放档，比 lite 粗（low / lowb / min）用 'lite'，
                                       parkedTier 为 null（本机没建过原区块：队友开过来的车、出生保底车）用 'mid'。lowb、min 永远不会出现在开过的车上
```

### BR.camp（js/levels/_camp.js，营地构件；N1 联机营地先做，C1 的 NPC 营地沿用）
```
tent(b, x, z, rot90, opts?) → { mouth, bed, inside: { x0, z0, x1, z1 }, stand: [{ x, z, yaw }], table, board, lantern, door }   局部坐标
                                       墙式帆布帐篷。rot90 只能是 90° 的整数倍（碰撞体全是轴对齐的），0 = 门朝 +Z。
                                       opts 缺省是 C1 的小军帐：w 2.4、d 3.0、wall 1.4、ridge 2.25、doorW 1.1、doorH 1.75、cot: true、glow: true；
                                       营地传 { w: 3.2, d: 4.0, wall: 1.8, ridge: 2.7, doorW: 1.2, doorH: 2.0, cot: false, mapTable: true, lantern: true,
                                       flapRolled: true, board: 'right' }。
                                       帆布正反各画一遍（外卡其、里暗一档，错开 4 mm 不共面），材质只用 'kit:prop' / 'kit:glow'，高低画质面数一样；
                                       侧墙、后墙、门两边的前墙给轴对齐 b.solid，屋顶不给碰撞。table 是桌面上留空的纸面矩形，board 是门边小黑板的板面，
                                       字和图由调用方贴 CanvasTexture；lantern.src 是马灯的灯描述（0xffd9a0、0.7、range 4）
cot(b, x, z, rot, opts?) → { rec, bed }   solid:false 的行军床，登记成道具和一个躺位
zone(b, spec) → 营地记录                按 C1 的营地数据格式写进 b.data.camps（世界坐标）
rod; COLORS; LANTERN                   内部辅助（杆件、顶点色、马灯灯描述），给营地家具共用
```

### BR.skin（js/game/skin.js）
```
current                                当前皮肤 key（localStorage 'backrooms_skin'，默认 'yellow'）
set(key)                               切换、写 BR.game.skin、emit skin:change
color(key?): hex
apply(object3d, key?)                  只改防化服：优先找名为 'Suit' 的材质，其次 userData.suit === true 的网格；
                                       先 clone 材质再改色，不污染共享原型
```

### BR.test（js/game/testmode.js）
```
init(); open(); close(); update(dt)    仅 BR.game.mode === 'test' 时生效；T 键或自建触屏按钮开关面板
spawnEntity(type): e | null            在准星前方可落脚处放出（BR.phys.overlapCircle 检查），emit test:spawned
spawnDummy(): e | null                 召唤测试人（test_dummy）
clearAll()                             清除全部实体和测试人
```
面板按层级分组列出 `BR.entityTypes.all()`（跳过 `_dev_*` 和 `test_dummy`），可搜索；打开面板时 `BR.input.enabled = false`。层级分组跳过 `def.hidden` 的层（营地不出现）。
联机（N1 起测试模式也能两人一起玩）：客机上 `spawnEntity` 返回 null，结果走回调（`use('test:spawn')` 交给房主核对）；「清除全部」走 `use('test:clear')`，房主清完 emit `'testClear' { by }`；测试人 id 一律 `'dummy~<皮肤>~<h|g>~<uid>'`，穿召唤者的制服颜色。见第 9.12 节。

### 开发测试
- `js/levels/Ldev.js`：id 'dev'，简单黄色迷宫，用来测流式加载/碰撞/灯光预算。
- `js/entities/_dev_hostile.js`、`_dev_friendly.js`：色块实体，用来测阵营战斗。

## 13. 补全批次与第二波地基新增的模块（2026-09-13）

详细签名以各自的写法说明为准，这里只列入口，避免两处文档不一致。

| 全局 | 文件 | 说明 |
|---|---|---|
| `BR.kit` | js/levels/_kit.js | 层级搭建：`builder(ctx,cx,cz,rng)`、`mat`、`grid`/`gridWalls`/`gridSpawns`（跨区块无缝，默认墙厚 0.267 m）、`trims.yellowWood`（黄色墙纸房间的黄木矮踢脚线）、`prop.*` 29 种构件、`exit`（首期范围外自动 sealed、noclip、event 可 setActive）、`heightField`、`loreKey`。写法见 **js/levels/_TEMPLATE.md**。FE1 新增 `hideSpans` / `showSpans`、`spanEdit` / `spanRestore`、`builder` 区块外可用加 `b.mark()`、显式 `meta.key` 不占自动编号，见第 15.9 节 |
| `BR.arch` | js/entities/_archetypes.js | 实体行为骨架（stalker/pack/flyer/ambush/mimic/lightBound/wanderer/guide/swarm/hazardEntity）、模型构件 `parts.*`、动画 `anim.*`。写法见 **js/entities/_TEMPLATE.md** |
| `BR.itemKit` | js/items/_kit.js | 物品共用：小模型、图标、数值结算（只在 statsEnabled 时生效）、分次食用、投掷；`LORE_HOUR` = 设定 1 小时对应游戏 60 秒 |
| `BR.effects` | js/items/_effects.js | 时效效果：`add({key,seconds,speedMul,hpPerSec,sanityPerSec,hungerPerSec,visual,negative,tags})`、`update(dt)`、`speedMul()`、`clear({negative})`。player.speed() 乘 speedMul；原地重生只清负面效果；换层不清（防止走出口解毒）。分阶段病（2026-09-14）：`stages[i].cureTags`（该阶段能治它的解药标记，空数组 = 无药可救）、`onExpire: 'death' \| 'transform:<type>'`（lethalAtEnd 是 death 的别名；transform 对玩家也是致死，死因取 cause）、`cureToast`、`cure(tags)`、`cureByItem(def)`（食物类别 → 'food'，杏仁水及彩色瓶 → 'almond_water'，外加物品 def 的 `cureTags`） |

加载顺序补充：`js/game/items.js → js/items/_kit.js → js/items/_effects.js → 其余物品`；`js/game/entities.js → js/entities/_archetypes.js → 各实体`；`js/game/world.js → js/levels/_kit.js → 各层级`。

实体定义可选钩子（entities.js 已支持）：`init(e, api)`、`animate(e, dt, api)`（房主和客机每帧都跑，只做表现）、`onHit(e, amount, attacker, api)`、`onDeath(e, api) → 尸体保留秒数`、`dispose(e)`、`attack.entityHp`、`human: true`（人类目标：感染类攻击只对它和玩家生效）。
`BR.entities` 额外：`get(id)`、`remove`、`damage`、`kill`、`count()`、`infect`、`transform`、`isHuman`（见第 12 节）；`spawn` 的 opts 支持 `yaw`、`from`、`force`、`manual`（手动放出的不随区块卸载、不受 maxActiveEntities 限制）。

联机打洞：`net.js` 默认 ICE 为小米 STUN → Google STUN → Cloudflare STUN；设置 `BR.config.iceServers` 可整体覆盖（将来加 TURN 中继就在这里配）。现在没有中转服务器：两个人连同一个 Wi‑Fi 最稳，不同网络下（尤其手机流量）有时连不上，失败文案如实说明（第 9.3 节）。

数据文件：`data/lore-choices.json`（每个层级/实体/物品随机选中的来源）、`data/entity-index.json`（实体清单、各层环境危害）、`data/item-spawn.json`（物品建议密度与出现层级）。

测试：`tests/smoke.mjs`（单机流程）、`tests/coop.mjs`（双浏览器联机：主页联机 → 营地 → 帐篷，辅助函数 `hostCamp` / `joinCamp` / `tentPick` / `readyBoth`；拦截 api.ovobot.ai，用内存假 room.php，绝不连真实服务器）、`tests/camp.mjs`（联机营地单页检查：封闭、预算、布局和种子 / 画质无关）、`tests/items.mjs`（物品）、`tests/kit.mjs`（层级工具库）、`tests/preview.mjs`（按层级/实体出截图与统计，第二波验收用）、`tests/phys.test.js`（含 OBB、sweepOBBs 和「没有 OBB 时逐位不变」的对照）。
叉车（FE1）：`tests/forklift.mjs`（按 `--group data|mount|drive|crash|side|lift|items|exits|life|pause|nightmare|dark|perf` 分组，能并行跑；side 是 repair-r1 加的 sideObs 用例）、`tests/forklift_l1.mjs`（叉车模型顶点哈希、drive 模型、出生保底、overhead / vines，支持 `--tag` / `--against` 快照和 `--quick`）、`tests/forklift_probe.mjs`（只读探针，all.mjs 列在 SPECIAL 里不自动跑）；联机用例在 `tests/coop.mjs`（假 room.php），手机键位在 `tests/mobile.mjs`。结构基线：`node tests/golden.mjs`（对入库基线）和 `--against <开工前打的快照>`，FE1 要求 26 层加 coopcamp 逐字节不变；营地另用 `node tests/camp.mjs --against N1-final`。
`tests/all.mjs` 里叉车各组超时 45 分钟，失败 / 超时先不判、等这一轮别的项跑完机器空下来单独重跑一次再判（`--jobs 1` 时紧接着重跑）；forklift、coop、mobile、kit、interact 都是先打印汇总、`browser.close()` 最多等 10 s 再退出（Chrome 的 crashpad 占着管道时 close 会卡好几分钟）。
mobile DR8（进层马上上车，「发动中」和大标题不叠）先重播一次大标题保证前提成立，前提没了（机器太忙、大标题在提示出来前就自己淡完）记 SKIP，不算通过。

## 14. 创意工坊与设置（2026-09-13 新增）

需求、数据格式、钩子与界面约定见 **WORKSHOP.md**。要点：`BR.workshop`（js/game/workshop.js，地图数据 + 本机存储 + 钩子，未激活时所有钩子为空操作）、`BR.workshopUI`（js/ui/workshop.js）、`BR.settingsUI`（js/ui/settings.js）；
`game:start` 新增 `workshop` 字段；`_kit.js` 的 gridWalls / exit / Builder.finish 各有一个工坊钩子；`audio.js` 新增 `setAmbientVolume`、`setSfxVolume`；`coop.js` 新增 `setVoiceVolume` 与 `workshopMap` 同步（2026-10-03 核对时发现 coop.js 里其实一直没有 `setVoiceVolume`，滑条不起作用；2026-10-05 补上：`BR.coop.setVoiceVolume` + `BR.net.setRemoteVolume`，iOS 走 GainNode，设置面板启动时和 `coop:connected` / `coop:reconnected` 时各推一次，见第 12 节 BR.coop / BR.net）。
N1 起工坊地图联机从帐篷「我的地图」进（地图信息卡上不再有联机按钮），见 WORKSHOP.md 第 7、8 节和本文第 9.7 节。

## 15. 载具与叉车驾驶（FE1，2026-10-06 叉车驾驶提前版）

孩子的话：「叉车能开能举东西」，道具用途要「特别合理，有一点不合理就不行」。家长 2026-10-06 拍板排在联机营地 N1 之后马上做。方案原文：`backrooms-research/plans/2026-10-06-forklift-early-plan.json`（`plan.stages` 的 FE1 / FE2，`playerSpec` 是叉车的「特别合理」检查清单，覆盖 2026-10-02 道具方案里叉车条目和 F1 / F2 的写法）。
FE1 交付：能开、能升降货叉、单机时货叉上能放瓶罐、两人联机；FE2 交付：叉起托盘货、运走、放到地面 / 货顶 / 货架横梁上。**FE1 全部是运行时或纯数据改动：26 层加隐藏层 coopcamp 的 golden 逐字节不变**（停着的车几何、碰撞框、账面、取随机数一律不动）。

### 15.1 操作（家长定死）

- 准心对准叉车 + 空格短按上车；坐上去以后 W/S 前进后退、A/D 打方向（后轮转向）、按住 R 升货叉、按住 C 降货叉（R、C 是键盘上开车专用的键，只在车上有效）；任何时候空格短按下车。F 吃喝照常，背包照常切；坐着捡不了、丢不了东西，冲刺没用。
- 手机：只有开车时才出现「升」「降」两个键，「互动」键改名「下车」，「冲刺」「丢弃」变灰；下车后全部恢复。摇杆的模拟量直接当油门和方向。
- 不加别的键：没有喇叭、没有门架倾斜、没有滚轮微调。界面文字和文档里写按键只写空格、W/S、A/D、R、C、F、Q（丢弃）；隐藏别名键的那个字母一律不出现在界面文字里。
- 2026-10-02 方案里的「握杆 + W/S 升降」「不新增任何按键」「下车要转头 50°」「grip 情境、axis('lever')」都作废。

### 15.2 三个模块和交接

| 全局 | 文件 | 管什么 | 只通过什么交接 |
|---|---|---|---|
| `BR.forklift` | js/game/forklift.js | 纯模拟加环境互动：运动学、扫掠碰撞、雷达、升降、头顶障碍、推开地上物资、藤蔓、下车落点、大灯落点、噪音。不建网格、不碰 levelState、不碰联机 | `create(rec)` → sim；`sim.step` / `obbsWorld` / `exitSpot` / `lightSpot` |
| `BR.vehicles` | js/game/vehicles.js | 通用载具层（这次只有叉车）：登记、升格、共用载具网格、部件 OBB、准心候选、上下车、货叉上的物资、声音灯光、生命周期 | 模拟只调 BR.forklift 的接口；联机表现只经 `setPose(key, pose, { remote: true })` 进来 |
| `BR.vehiclesNet` | js/game/vehicles_net.js | 联机表现：本机开车时每帧刷新 hand（随 15 Hz 的 me 发出）；远端车插值后交给核心；远端车的声音、大灯（灯池 owner `'fkr:' + key`）、影子模拟（推瓶罐、拨藤蔓）；掉线重连 | `BR.coop.hand` / bus `'net:veh'` / `BR.vehicles.setPose` |

加载顺序：testmode.js → forklift.js → vehicles.js → vehicles_net.js（都在 _kit.js、L1.js、coop.js 之前，所以 `BR.kit`、`BR.L1forklift`、`BR.coop` 一律用到时再取）。
main.js 的 tick 在 simulate 段里、entities 之后依次调 `safe('vehiclesNet', 'update', dt)`（队友开的车插值后经 setPose 进来）和 `safe('vehicles', 'update', dt)`（实体这一帧撞的是车的新位姿）；本机司机的模拟在 `player.update` 里经 `handle.update` 跑，`vehicles.update` 只管升格 / 释放网格、riders、顶点更新、声音灯光。回主页时 main 再兜底调一次 `vehicles.clear`；`__br.info().vehicles` = `BR.vehicles.debugInfo()`。

```
BR.forklift
  geo                                  BR.L1forklift.geo 叠在本文件的缺省值上（L1 没载入时全用缺省），另算 wheelbase、front / rear、halfW
  config                               速度、加速度、转向速率、升降速度、雷达距离、噪音（见下）
  create(rec) → sim                    rec = b.data.forklifts[i]，或 levelState.vehicles[key] 加上 key
  state(key) → pose 拷贝 | null；byKey(key) → sim | null；list()；sound(ev) → 'fk_' + ev；clearItems(obbs, opts?) → 挪了几件
  sim.step(dt, inp | null, env?) → { pose, events, note, noise, shake }
      inp = { throttle −1..1（+ = W 前进）, steer −1..1（+ = 往左打 = 按 A）, lift −1..1（+ = R 升）, brake? }（也认 { move, liftUp, liftDown }）；
            null = 输入被关掉（暂停、结算、切后台）：油门 0、方向回正、不升降、0.55 s 内刹停，雷达照常工作
      env = { phase: 'mount' | 'seat' | 'start' | 'run'（'run' 才算着车）, local, brake, ignoreKey, riders, pushItems, vines }
      pose = { x, z, y, yaw, steer, lift, spd, lever, engine, carriage, inner, rpm, hyd, beep, on }
             x / z / yaw 和 b.data.forklifts 的 x / z / rot 同一约定（kit 的 rot：本地 −z = 车头）；steer = 后轮真实转角（按 A 为负：车尾往右甩、车头往左）；
             lift 0..1（货叉架升 2.6·lift、内门架升 1.3·lift）；lever = 升降杆 −0.35..0.35 rad（+ = 往后扳 = 升）；engine 0 熄火 / 0..1 起动中 / 1 着车
      events：'ignite' 'off' 'bang' 'bump' 'radar' 'end' 'strain'（音效名 = 'fk_' + 事件名）；note：状态行文字 | null；
      noise：0 熄火 / 0.25 怠速 / 0.6 行驶 / 0.8 倒车；shake：撞上（≥ 0.8 m/s）时 0.15 s，减少动态效果时恒 0
  sim.obbsWorld() → 14 个世界 OBB（phys.addOBBs 的格式）
  sim.exitSpot(pref, force) → { x, z, y, side: 'left' | 'right' | 'rear' | 'free' } | null
  sim.lightSpot() → { x, y, z, range, color, intensity, flicker }（world.setExtraLights 的格式）

BR.vehicles
  list() → [{ key, x, z, y, yaw, steer, lift, spd, lever, on, driven, meshed, seat, tier, n, runtime, physKey }]；byKey(key) → 内部记录（只读）
  seated                               本机坐着的车 key | null；handle：交给 player.mount 的那个对象
  mount(key) → bool；dismount(side?) → bool；forceExit(reason)
  cabFor(playerLike) → 世界坐标驾驶舱矩形 { cx, cz, hx, hz, rot, minY, maxY, … } | null；chestOf(playerLike) → { x, y, z } | null
  seatWorld(key) → { x, y, z, yaw } | null（坐垫顶面中心）
  dropSurface(x, z, r) → { y: 叉面, veh, tine: 0 左 | 1 右, x, z } | null；attachItem(id, veh) → bool
  setPose(key, pose, { remote }?) → bool   remote = 队友在开（会顺手升格、挪 'veh|' OBB）；不带 = levelState 回放；本机正坐着的车不理
  update(dt)；applyChunk(c, st) / unloadChunk(c)（world 建块 / 卸块调，幂等）；clear()
  debugInfo() → { promoted, meshes, calls, tris, perVehicle, tiers: { key: tier }, lease, riders, obbs, seated, phase, light, loops, … }
  _step(dt, { throttle, steer, lift }, key?) → pose   测试口：直接给模拟一步输入（不走 BR.input、不管起动阶段），网格、riders 一起更新
  playerLike：BR.player（或 'me'）= 本机；'peer' / 联机队友对象 = 队友坐的那台；也可以直接传车 key

BR.vehiclesNet
  update(dt)                           main.tick 每帧调（排在 vehicles.update 之前）：本机坐着、拿着 'k:' 租约时每帧调
                                       BR.coop.hand('k:'+key, x, z, yaw, steer, lift, 0, spd, on)（只写内存，网络上仍是 coop 的 15 Hz me；
                                       每帧刷新是为了两边节拍错开时不出重复帧、跳帧）；远端车插值后 setPose
  holding（getter）→ bool              本机坐着的车因为联机要停着（重连中、重新拿租约中）：核心按「输入关着」处理
  remote(key) → { x, z, yaw, steer, lift, spd, lever, on, active } | null
  监听 'net:veh'、'levelstate:set'（kind 'veh'）、'levelstate:import'、'levelstate:clear'、game:start/home、level:leave、vehicle:mount
  debugInfo() → { updates, remotes: { key: { buf, n, active, lastAt, ageMs, lagMs, err, errMax, on, light, lightAt, loops, shadow, pose } },
                  send, net: { coop, role, phase, holding, regrab, lastRegrab }, ls, lastFinish }
  _feed(p)（= 收到一条 net:veh）、_reset()：测试口
  远端车的大灯借灯池（owner 'fkr:' + key，本机司机的是 'fk:' + key）；影子模拟 = BR.forklift.byKey(key)（没有就 create 一个只摆位的），
  车在开时 setPose(pose, { push: true }) 推瓶罐、stepVines 拨藤蔓
```

数值（`BR.forklift.config`）：前进最快 4.5 m/s、倒车 2.5；W/S 加速 2.25 m/s²（约 2 s 到最快），反向先以 6 m/s² 刹车，松开 3 m/s² 自动刹车；转向速率 2.0 rad/s、回正 2.5 rad/s，最大转角 `geo.maxSteer` 1.13 rad（65°）；
打方向限速 v ≤ sqrt(2.5·轴距 / tan|steer|)（满舵约 1.3 m/s）；货叉底离地 > 0.5 m 限 1.0、> 1.5 m 限 0.6；货叉架升 0.45 m/s、降 0.55 m/s（按住 R 1 s 升约 0.45 m）；雷达 1.5 m；起动 0.8 s。
运动学是以前轴为参考点的后轮转向自行车模型：航向角速度 = −v·tan(steer) / 轴距 1.42。

### 15.3 升格、共用载具网格、细节档

- **停着的车不动**：没人开过的叉车仍合并在区块网格里，几何、碰撞框、账面全不动（L1 golden 逐字节不变）。第一次有人上车、或者收到队友的 `net:veh` / levelState 记录，才**升格**：
  `kit.hideSpans` 把区块里这台车的顶点段（`spans.prop` 加 `spans.wear`）叠成一点，车下的地面油渍 `spans.oil`（FK_WEAR[0]）不藏；再用 `BR.L1forklift.model`（`drive: true`）按部件把它建进全层共用的载具网格。升格后的车状态存 `levelState.vehicles`，不再依赖原区块（bus `'vehicle:promote'`）。
- **出生保底车**（`runtime: true`，不进区块几何）：一载入就直接以载具网格出现（高画质 mid、低画质 drvLow），地面油渍作为载具网格里不随车动的一段（`wear({ part: 'oil' })`）。
- **共用载具网格**：kit:prop、kit:glow、kit:decal 各一个网格（低画质没有贴花），预分配、按需扩容，不挂区块 group，共用 BR.assets 的 kit 材质。不管几台车最多 3 个 draw call（低画质 2 个）。
  每台车用一个临时 `kit.builder`（区块外）按部件调 model / wear，部件前后各调 `b.mark()` 量出顶点段，拷进共用缓冲里属于这台车的一段。部件建模顺序：body、mastOuter、wheelsFront、wheelRearL、wheelRearR、steeringWheel、liftLever、mastInner、carriage、chains（链条放最后，按最大长度预留顶点，用不到的叠成一点）。
- **每帧按 pose 在 CPU 上变换顶点**：车身不动；前轮绕轮轴 (y 0.29, z −0.62) 滚；左右后轮各绕自己的主销 (±0.44, z 0.8) 转 steer 再滚；方向盘绕倾斜轴转 −steer × 6（司机看来逆时针 = 往左打）；内门架升 d、货叉架升 2d；链条按 lift 重写；升降杆绕 `geo.liftLever` 转 lever。
  只改动过的部件，只 `updateRange` 上传那几段；包围球按网格里的车实时重算（车全在身后时整块被视锥裁掉）。
- **熄火 / 着车**：熄火时 glow 网格里这台车那段的顶点色换成灯罩本色 × 0.35（不藏、不开洞）；着车时大灯镜面和警示灯罩点亮，警示灯 1 Hz 闪。
- **只放附近的车**：本机坐着的、玩家（联机加上队友）R+1 块以内的开过的车 / 保底车才放进网格；走远了释放那一段（状态和碰撞留着），回来按状态重建。
- **细节档**（`BR.L1forklift.driveTier`）：开过的车在高画质下 = 本机停放档，比 lite 粗就用 lite；低画质一律 drvLow（无倒角、无贴花、不砍面）；lowb、min 永远不会出现在开过的车上。
  档位和磨损片数由各端按自己的区块数据现算：`applyChunk` 每次都记下 key → { 停放档, wearN }，**这两个值不进 levelState**（两端画质可以不一样）。本机从没建过这台车的原区块（队友开过来的、保底车）用 mid（低画质 drvLow），磨损按 mid 档。
  高画质停放档在 high / mid / lite 的车，上车前后同一档、同样的磨损，看起来一样（同机位截图平均像素差 < 2）。
- 预算：每台 ≤ 2000 面（实测 lite 1031、mid 1342、high 1810，加 drive 改动约 100）；最坏 6 台开过的车都在附近合计 ≤ 12000 面；叉车不往任何区块里加一个面。L1 出生点开着车、旁边再停 5 台开过的车，高低画质 `BR.gfx.debugInfo().calls` 都 ≤ 120。
  叉车模拟加顶点更新平均每帧 ≤ 0.6 ms（`_step` 连跑 1000 步）。

### 15.4 碰撞：14 个 OBB 和驾驶舱空当

- `BR.L1forklift.geo.obbs(lift)` 给 14 个部件盒（本地坐标）：chassis（底盘与地台，含前轮）、hood（发动机盖）、counterweight（配重与气瓶，含后轮）、dash（仪表台）、postFL / postFR / postRL / postRR（4 根护顶立柱）、roof（护顶顶板）、mastOuter（外门架）、mastInner（内门架，含链条，+inner）、carriage（货叉架与挡货架，+carriage）、forkL / forkR（两根货叉水平段，+carriage）。
  尺寸取各部件实际顶点（6 档并起来）的包围盒，离模型表面不超过 7 cm（人贴着车身绕一圈，最多离车身 7 cm 被挡；走到货叉前面被货叉挡住）。
  例外两处（tests/forklift_l1.mjs 单独记）：底盘盒顶压在驾驶舱地台 0.62，前翼子板顶面高出 4.5 cm；配重后脸是圆角的，盒子后脸压在 1.276（从后角斜着走过来也 ≤7 cm），中间凸出来那块（|x| ≤ 0.3）high 档伸出盒子 1.9 cm、mid 0.3 cm。
  **这两处是定下来的取舍**（主会话 2026-10 认可，FE1 返修 r3）：碰撞盒露出模型 4.5 cm / 1.9 cm 不改 —— 底盘盒再抬高就会压进驾驶舱地台的留空，配重盒再往后伸从后角斜着走过来就离车超过 7 cm；
  以后真要收，就加第 15 个盒子（前翼子板单独一块）、把配重盒拆成中间和两角，不要动现在这 14 个的尺寸（golden 不看它们，但 tests/forklift_l1.mjs obb 段和人绕车走一圈的用例都按它们算）。
- **驾驶舱留空**（这里面没有任何盒子）：本地 |x| ≤ 0.4；脚下 z −0.5…−0.1（发动机盖前脸）、地台以上 0.62–2.05；座椅上方 z −0.1…0.55、1.16–2.05。司机眼点 (0, 1.8, 0.16) 和座椅胸口点 (0, 1.66, 0.24) 都不在任何盒子里：
  怪看得见坐着的人，名牌和司机自己往外看的视线不被车身挡住；从驾驶舱往外的 `phys.los` 不被挡，车侧 6 m 到胸口点的 los 不被挡。
- **phys key**：停着的车由 L1 用 kit fixture（显式 key `'1@cx,cz#v<i>'`）包住原来那一个外接 AABB，world 按 A1 的规则登记成 `'cx,cz#v<i>'`；载入时 BR.vehicles `removeSolids('cx,cz#v<i>')` 再 `addOBBs` 14 个 OBB，挂在 `'cx,cz#v<i>#<部件>'` 名下，区块卸载、golden 按区块摘碰撞时一起摘掉。
  开过的车用 `'veh|<车 key>#<部件>'`，**整层常驻**：网格走远会释放，碰撞一直在（房主替远处的队友模拟怪时照样撞得到车）；换层、回主页时清掉。
- 车的扫掠（BR.forklift）：每步分两路扫 14 个 OBB。`phys.sweepOBBs`（forklift.js 的 physSweep，只传 ignoreKey 自己的 key）只扫**静态碰撞体和别的车**（`'veh|'` OBB）；
  人（本机玩家以外的人和所有实体，按圆）、出口圈 +0.4 和 keepClear（`world.blockers()`）、头顶条目（overhead，举着货叉时）、车身高度上伸出来却没有碰撞体的东西（`b.data.sideObs`，见 15.10；人照旧挤得过去，只有车当障碍）
  都由 forklift.js `move()` 交给本文件的 `sweepLocal` 扫：sideObs 按条目的真实形状出障碍 —— round（路锥、砂堆、灌木）是圆 `{ kind: 'circle' }`，转过角度的（斜放的地牛、通道里歪着的纸箱）是 `{ kind: 'obb' }`，其余轴对齐矩形（repair-r2；以前一律按外接矩形，开向斜放的地牛会在离它 20–30 cm 的空地上停住）。
  斜放的地牛脚下还有一块 A1 留下的 1 m 见方、0.3 m 高、轴对齐不跟着转的老碰撞体（golden 里有它，人照旧被它挡）：它的世界坐标记在地牛两个 sideObs 条目的 `solid` 上，
  physSweep 把车 6 m 内这些 `solid` 作为 `skipBoxes` 交给 `phys.sweepOBBs`、升降往下打的射线也跳过它，车只按地牛的真实形状（叉腿、泵体两个条目）挡 —— 撞上时贴着地牛停，不再在离它 7–30 cm 的空地上「哐」地停住（repair-r3 裁定 ⑦）。
  整步撞上时依次试：转角改变减半、不转角（沿车头方向直走）、半步；都不行就停在接触前。车尾那一半撞上而直走不撞（车尾往外甩蹭墙）：停住并提示「车尾会往外甩，先倒车带出来」；打着方向倒车能把车尾带离墙，不打方向能沿墙开走。
  v ≥ 0.8 m/s 撞上是「哐」（fk_bang，镜头抖 0.15 s），慢的是「咚」（fk_bump）。**推着地上的东西撞墙**（planPush 推不开：东西被夹在车和墙之间，repair-r3 裁定 ②）也一样按车速分「哐」/「咚」、「哐」照样抖镜头、照样甩货；
  这一步里先二分出还推得动的最远处，车开到那里（东西贴着墙、停在车和墙之间）再停，不再推着东西一帧停死、只「咚」一声。行进方向 1.5 m 内有人或怪：自动刹车、「雷达自动刹车」（fk_radar）；碰到出口禁区「前面是出口」；碰到被拖出来的 kit 家具「前面有东西挡着，下车把它拖开」；
  倒车撞上的（车速 < 0）说「后面是出口」「后面有东西挡着，下车把它拖开」（repair-r1 新加的文案，主会话在返修 r3 按裁定 ⑥ 同步进了方案 playerSpec.texts）。车撞不伤人和怪，也推不动他们。
- **全速撞车掉货**（家长 2026-10 拍板，repair-r2；轨迹按主会话 r3 裁定 ①③ 重写，r4 返修，BR.vehicles `computeThrow` / `throwOne`）：「哐」**而且撞前车速 ≥ 2 m/s、往前开**时，这台车货叉上的瓶罐甩出去，
  叉尖那头的先算。每件按真实的样子走，**每一段都按动画同样的插值每 2 cm 查一次，任何一段都不穿过东西**：这台车自己的 14 个盒子（按撞车那一刻的位姿和 lift，本地坐标精确算）、墙 / 货架 / 别的车（`phys.overlapOBB`，
  圆柱按外切方块、跳过自己的 key 和斜放地牛的老碰撞体）、车身高度上没有碰撞体的东西（sideObs：柱础、护角、地牛……）、地上别的物资、留在叉上的，
  还有**先甩出去的那几件按同一时刻它在轨迹上的位置**（`T.movers` + `pathAt`，r4；落点还要查之后会不会被它们扫到）。
  半径（r4）：`footRaw` = 模型所有顶点离它竖直转轴最远的水平距离，按类型量一次（转多少都一样；以前按包围球 × 0.8，细高的水瓶大了 2.5 倍，从叉边下去会在半空横走、「贴着墙」落下离墙 7 cm），
  查碰撞用 `itemFoot` = footRaw + 1.2 cm（贴着墙落下时看着就是贴着；斜着摆的罐身、瓶盖从哪个角度看都碰不进墙和货叉）。
  ① 贴着叉面沿自己那根货叉往前滑，圆心过了叉尖 0.3 个模型半径就**翻下叉尖**：一瞬间（同一时刻的两个关键帧，不到一帧走的路）整个离开叉尖、底面比叉面低 4 mm，
  所以还在叉面高度时圆心不会越过叉尖 0.3 个模型半径以上、不会悬在叉尖外面；
  ② 接着沿抛物线（水平匀速、竖直从静止往下掉）落到叉尖前方 d（车速 2 → 0.2 m、4.5 → 0.5 m，线性，量到圆心）的地上，横向不变；落点放不稳（柱础边、地牛老碰撞体里）就近一点（每 3 cm）或往外偏一点；
  ③ 抛物线半路碰上东西（墙、货、柱子、地上的物资）：在碰上之前停住、贴着它竖直掉下去 —— 落在叉尖和它之间，下面是它的脚（柱础、货的底座）就落在那个顶面上；
  ④ 往前不行（叉尖顶着墙 / 柱子，第 ① 步就停在叉面上；或者 ②③ 落不下）：从**它还在叉面上的地方**横着滑下叉边（先外侧、再两叉中间），圆心过了叉沿 0.3 个模型半径就翻下去、往外偏 1.5 cm 竖直掉到地上（贴着挡住它的东西）。
  走这条路时轨迹从头算：不会先滑出叉尖、悬在半空，再倒着滑回叉面（r4 修掉的 major：以前 ① 的关键帧在 ②③ 失败后没清掉）。
  落点：圆心周围 0.35 rad 的四个点底下都是同一个面（不一半悬在柱础边上）；**不落进斜放地牛那块 1 m 老碰撞体**（`inSkip`：人和准心照旧被它挡，落进去就捡不起来，r4）；落地时不压东西、之后不会被先甩出去的扫到。
  不行就先往外挪（离货叉远的方向，每 2 cm 最多 10 cm：被先落地的那件占了就贴着它落在外侧），再往车这边挪（每 2 cm 最多 12 cm：磕到柱础边往回落，往回落的斜线也逐段查；r3 是 30 cm，退那么远看着像被往回拽，r4 收到 12 cm，再挪不下就留在叉上）。
  顺序：③ 和 ④ 两侧先只试正下方 / 往外挪，都不行再试 ③ ④ 往车这边挪的；⑤ 都不行（四周都被占了）：留在叉面上原处不动。所以**举着货叉撞墙时不会有东西从货叉正下方穿下去**，也不会落在举着的货叉投影里。
  动画按算出来的轨迹逐段摆（`path` 关键帧，mode 1 = 竖直从静止往下掉；同一时刻两个关键帧 = 一瞬间翻过去），甩出去的那一刻先摆到轨迹起点（撞停那一刻它在货叉上的位置，不落后车一帧）；
  落地后 **still（静静躺着，不浮动、不转圈，落地那一下不往上弹）**，`items.hold(false)` 一次写进本层状态（丢弃物那张 drops 表）；
  换层回来 items 照丢弃物把它摆回来（浮着），BR.vehicles 在 'level:enter' 里把本局甩出去落地的那几件（`S.lying`）再让它躺下。「咚」（< 0.8 m/s）、0.8–2 m/s 的「哐」、倒车撞上（东西往车这边冲、被挡货架挡住）都不掉。
  车速：货叉底高过 0.5 m 限速 1.0 m/s、高过 1.5 m 限速 0.6 m/s（方案 drive），所以叉面 1.2 m、满升时真开过去到不了 2 m/s、不会甩货；只有刚把货叉举起来、车还没减下速的那一下会在 0.5–0.8 m 甩出去
  （tests/forklift.mjs I16 / I16b 真开 0.5 m、1.2 m、满升，I16c 在 1.2 m 和满升把撞前车速直接设成 3.9 m/s 查轨迹；I12 / I12c 撞车轮挡、叉面 0.34 / 0.5 m 往前飞；I18 车头撞纸箱、叉尖离货架 25 cm；
  每一帧都查不穿过货叉、车身、墙、sideObs 和别的物资（`__fk.fallBad`），I12 / I12c / I18 还查在叉面高度时不悬在叉尖外面、不往回退（`__fk.hover`）；S12d 撞斜放地牛，落地的都能「空格 拾取」）。
  `debugInfo().throws[i].how`：每件怎么落的（'fwd' 叉尖前方、'stop' 碰上东西贴着它落、'side-out' / 'side-in' 从叉边滑下去；后缀 '-near' 落近了一点、'-wide' 往外挪过、'-back' 往车这边挪过；
  'stay (…)' 留在叉上，括号里是前面几步为什么不行：A 沿货叉滑、J 翻过叉尖、B 抛物线、L 落点、C 碰上后往下掉、outF / outS / outJ / outD（inF…）叉边那条路的往前滑 / 横着滑 / 翻过叉沿 / 往下掉、stopK / outK / inK 往车这边挪）。
  `debugInfo().throwMs` 是最近一次算轨迹用了多少毫秒。
  联机以房主为准：房主（单机）司机本机算、摆、写，再 `coop.emit('fkthrow', { k, list })` 让客机照摆；客机司机不自己算，`coop.use('k:' + 车, 'fkthrow', 眼点, cb, { v0, x, z, yaw, lift })` 请房主按房主那边货叉上的东西和这一刻的车位姿算（离房主看到的超过 1.5 m 就按房主的），
  房主摆好、写好状态，把落点和轨迹 `{ k, list: [[id, x, y, z, path]…] }`（path = [[t, x, y, z, mode]…]，世界坐标；旧版只给前 4 个数时客机从现在的位置直接掉过去）回给客机照摆。联机时本来不能丢东西，货叉上不会有瓶罐，这条路平时走不到（tests/coop.mjs V13 两边各挂一只同 id 的罐头走一遍）。
  `BR.vehicles.debugInfo().throws` 记最近 8 次（by：'me' 自己算的、'peer' 替客机算的、'host' 照房主摆的）、`falls` 是正在往下掉的件数。
- 地上物资：单机和房主那边，载入时把压在任何车 OBB 里的地上物资沿最近的边推到外面（`items.hold` / `move`，松手时一次写 levelState，联机照常同步；客机不推，等房主的 levelState）；开车时车身和货叉推着地上的瓶罐走，不会卡进车里。

### 15.5 上车、坐着、下车（player.mount 和 handle）

- **准心候选**：`interact.addSource('vehicles')`，`hit.obb` 用整车外接盒（车身 + 护顶 + 门架），候选 `{ kind: 'vehicle', label: '叉车', solidKey: 这台车当前的 phys key }`；`interact.handle('vehicle', { short })`。
  站在车侧面（离车中线 ≥ mountZone.xMin，前后在 mountZone 和车身外接盒前后两端（门架前脸约 −1.13 到配重后脸 1.276）并起来的范围里）、离座椅 ≤ 1.5 m：短按动词「上车」（「空格 上车」/「点「互动」上车」）；
  在货叉前面（含货叉两旁）或车尾后面：灰字「绕到侧面上车」；侧面但离座椅超过 1.5 m（比如配重、后轮旁边站远了，门架、前轮旁边）：「再走近一点」；
  坐在车上时准心对准仪表台的**大灯开关**是一个按钮候选（见 15.11），drive 情境只认它（`setMode('drive', { accept })`），准心空着时还是「下车」。
  上车、下车那两段 0.5 s 插值里（`player.pose === 'drive'`）不出车的候选：下车动画里准心下不会闪「绕到侧面上车」，连按的第二下空格也不会被当成「上车」拒绝；长按：「叉车太重，拖不动」，车一点也不动；队友正坐着：「队友在开叉车」；对方版本旧：「对方版本较旧，联机时开不了车」。工坊编辑态不出候选。
- **上车**：联机时先 `BR.coop.requestGrab('k:' + key, 'veh')`，拿到才继续（1.5 s 没回音提示「没连上，再试一次」，被拒按原因提示）；然后升格（还没升格的话）、`interact.setMode('drive', …)`（第 12 节 BR.interact）、`player.mount(handle)`、`BR.hud.setDrive({ key, label: '叉车' })`，bus `'vehicle:mount'`。
  0.5 s 视角先移到侧面踏板上方再落进驾驶座（不穿护顶立柱和仪表台），落座 fk_seat → 钥匙咔、起动机转两下 fk_ignite（这 0.8 s 里按 W 车不动，driveNote「发动中」）→ fk_engine 怠速循环、两盏前大灯亮、护顶警示灯 1 Hz 闪。
- **handle**（BR.vehicles 给 player.mount 的对象）：
  ```
  { key,
    update(dt, inp | null) → { x, z, eyeY, feetY, dyaw, noise, shake }   inp 为 null（输入关掉）时当成「油门 0、方向回正、不升降」
    path('in')  → [站立眼点, 踏板眼点, 座椅眼点]（世界坐标）；path('out') → [座椅眼点, 踏板上方（车尾下车是配重上方）, 落点眼点]
    forceExit(reason); cab() → 世界坐标的驾驶舱矩形; chest() → 世界坐标胸口点; yaw() → 车头朝向 }
  ```
- **坐着**：可以随便转头（上下、左右、回头），车转弯时视角跟着车转（dyaw），没有走路时的头晃；中间提示是「空格 下车」（手机「点「下车」」），准心对准仪表台的大灯开关时是「空格 关大灯 / 开大灯」，屏幕下方常驻 `setDrive` 那一行。
- **下车**：任何时候短按空格（drive 情境里只有短按，按下即执行；上车插值那 0.5 s 里按的记下来，一落座就按下车处理、不点火）。车还在动先自动刹停（≤ 0.6 s）；`sim.exitSpot(按视角选的边)`：偏左 > 20° 先左、偏右 > 20° 先右、正前方先左，落点 = 座椅侧外 1.0 m，用 overlapCircle（人的半径、全身高）加 blockers 加从座椅到落点的 los 判断站不站得下；
  不行换另一边，再不行从车尾翻过配重下来（配重后 0.5 m）；三面都不行就不下车，driveNote「两边都被挡住，开出来再下车」。拿到落点：写 levelState.vehicles（on:0），联机时先写再 `release('k:' + key)`，然后 `setMode('walk')`、`player.unmount`（0.5 s 走上车的反路线）、fk_off、撤大灯、灯罩变回暗色，bus `'vehicle:dismount'`。
  第一次举着货叉下车提示「货叉还举着」（本局只说一次）。下车落点永远不在出口圈里（落在出口圈里的那一边算被挡住）。下车后车停在原地，挡人、挡怪、挡车，别人能上去开。
- **强制下车**（死在车上、reset、换层、回主页、复活）：`sim.exitSpot(…, force = true)`，三面都不行就从车旁一圈一圈往外找空地，永远不落进 OBB 和出口圈；不提示、不播刹车动画，人直接落在落点；车熄火停住、货叉保持原高度。
  死在车上：人倒在车旁（下车的那个位置）。开着车回主页、复活、换层：先自动下车再走，回来时车停在下车前的位置。
- **生命周期**：interact 的 reset / cancel 不通知 owner，所以 BR.vehicles 自己听 `game:start` / `game:home`（清空）、`level:leave` / `player:death`（强制下车并写状态）；工坊编辑态整体关闭。
- **暂停、切后台**：单机按暂停时整个世界停住，车、货叉、声音都停；联机暂停、看结算、切到别的窗口（输入被关掉）时 handle 收到 inp = null：车 0.6 s 内自己刹住，货叉停在原高度，防撞雷达照常工作。

### 15.6 坐在车上时别处怎么处理

- `player.x / z` = 座椅、`y` = 眼高、feetY = 车下地面：world 的出口检测（collectInside / checkExits）直接跳过，不显示「尚未开放」；L1 的水坑接触判定跳过（开过没密封的水坑不掉理智）；实体按第 12 节 BR.entities「坐在车上的玩家」处理；coop 的位置、besideHost 照常按 player.x / z。
- 噪音：怠速 0.25、行驶 0.6、倒车 0.8（都比走路的 0.4 大，怠速比走路轻）；本机在开时另外每步调 `BR.entities.makeNoise`（只在噩梦模式生效）。联机时客机开车的响动和客机走路一样，房主那边的怪听不见（现有规则，留给 N2）。

### 15.7 levelState.vehicles 和联机

- `levelState.vehicles[key] = { x, z, yaw, steer, lift, on: 0 | 1, carry: null, n: 车号, hl: 0 | 1 }`（key = `'1@cx,cz#v<i>'`；hl = 仪表台大灯开关，老记录没有时按开着）：只存和画质无关的状态，**细节档和 wearN 不存**（各端现算）。
  levelstate.js 的 NORM.veh 原样保留多出的字段，并补 `tilt: 0`（没有倾斜键，恒 0）。单机、房主上车时写 on:1，下车写 on:0；客机只在下车时写本地那份。区块载入时 `applyChunk` 按记录把开过的车摆好（原位置区块里那段藏掉、原位置不留碰撞），走远几块再回来、离开这一层再回来都在原处；`game:start` 清掉，所以回主页重新开始、联机从帐篷重新出发时车回到原位。
- **能力名 `veh2`**：线上 A1 / N1 版本已经声明了 `veh1`、却不会开车，所以叉车只看 `veh2`（coop.js 的 BASE_CAPS、capFor('k') → 'veh2'、degradeText、warnOld 一起改）。对方缺 `veh2`：进层提示「对方版本较旧，联机时…叉车用不了」，上车被拒并提示「对方版本较旧，联机时开不了车」（单机照常能开）。
- **租约 `'k:' + 车 key`** = 谁坐在驾驶座上：上车 `requestGrab('k:' + key, 'veh')`，房主自己上车也走同一张租约表，两人同时抢只有一个人拿到。房主的 grabCheck 对 `'k:'` 另外核对：同一层；请求者最近一次 me 位置离 `BR.vehicles.seatWorld(key)` ≤ 3 m；这把租约没人拿着。
- **位姿**：开车时 BR.vehiclesNet 每帧调 `BR.coop.hand('k:' + key, x, z, yaw, steer, lift, 0, spd, on, hl)`（只写内存），随 15 Hz 的 `me.h` 捎带（h 行 `[k, x, z, yaw, steer, lift, tilt, spd, on, hl]`，tilt 恒 0；hl 是 repair-r2 加的第 10 个值，旧版不发时按开着）；对方 coop 拆出来 emit bus `'net:veh'` `{ k, key, x, z, yaw, steer, lift, tilt, spd, on, hl, lv, t }`。
  远端车 hl 为 0 时不借灯池（`'fkr:' + key` 撤掉）、灯罩按熄灭画；下车时最后一帧 hand 也带 hl，房主写进 levelState。on 跟着 h 走（缺省 1）；对方下车时 net:veh 断流、或收到 levelstate:set 的 on:0，就熄火、撤灯。
  BR.vehiclesNet 给每台远端车一个 100 ms 的插值缓冲（最多外推 150 ms），每帧调 `BR.vehicles.setPose(key, pose, { remote: true })`，由核心更新网格和 `'veh|'` OBB（房主那边实体照样撞得到）；远端车的发动机循环、倒车哔哔按 3D 位置播，大灯照样借灯池。车停下 0.5 s 后两边位姿差 < 5 cm。
- **房主裁决**（「动手端先算，房主裁决」）：司机那端先算，房主只核距离。房主记下每把 `'k:'` 租约的最后一帧位姿；租约超时（叉车的保活上限放宽到 3 s，切后台时 me 变稀不会误判）、断线时，按最后位姿把车停下写进 levelState.vehicles（on:0）并广播；`onLsSet` 不把正被人开着的车回推给司机。
- **掉线重连**：`BR.game.coop` 且 coop `phase === 'reconnecting'` 时，本机坐着的车停住、人还坐着，driveNote「掉线了，车先停住」；重新 active 后自动再 requestGrab，拿回来接着开（车不瞬移），拿不回来就强制下车。房主给掉线的司机留着这台车（重连途中加连回来后约 5 s），这期间房主上不去。判断用 `BR.game.coop` + phase，不能用 leaseOf（重连时恒为 null）。真的断开了，车停在最后的位置，谁都能再上去开。
- **客机的消息晚到**（连接没断、phase 一直 active：网络卡一下、客机设备很卡；repair-r2 修第二轮 play 的 major）：房主照样按 3 s 超时收走租约、按听到的最后位姿停车。客机发现租约没了就坐在车上重新要，
  车停着、超过 0.5 s 还没要回来，状态行每 2 s 说一次「掉线了，车先停住」；coop 4 s 等不到回复（申请排在卡住的消息后面）时**不放下车**，接着要（vehicles_net `REGRAB_GIVEUP`：从第一次要起最多 15 s），晚到的申请到了房主那边照样批，批下来接着开，两边一致。
  实在要不回来才放下车（「没连上，再试一次」）：这时 `coop.release('k:' + key, p)` 对已经没有租约的客机**照样发 rel**（fill：发出前带上本机这台车此刻的 levelState 值 v），房主走 hostRel「超时以后他才下车，车停在他下车的地方」那条路写 levelState 并广播，两边的车停在同一个地方。
  房主记着自己最近一次替客机停车（finalizeVeh）写下的位置（S.vehFin）：晚到的 rel 到的时候，levelState 里这台车已经不在那儿了（这期间房主或谁开走过），就不挪车、把房主现在的状态发回给客机（resendState）。
  客机坐在车上重新要租约时申请带 `re: 1`（`coop.requestGrab(k, kind, cb, { re: 1 })`，vehicles_net 自动要的那种）：房主收回以后车被挪过（levelState 不在 vehFin 那儿了）就回 deny 'moved'、不批 ——
  repair-r3 补的：以前晚到的旧申请会先被批下来，紧跟着晚到的 rel 走正常下车那条路，把车拽回客机看到的旧位置，vehFin 那道防线被绕过去（V14c 第一次跑出来的）。客机收到 'moved' 就放下车，rel 到了走 vehFin 分支。
  tests/coop.mjs V14（客机出站消息攒 7 s：人还坐着、补到以后租约一致、位置差 < 5 cm）、V14b（攒 20 s：放下车、房主把车挪到客机下车的地方）、
  V14c（repair-r3：攒着的这段时间里房主收走租约、车在房主那边被挪开 1.2 m（直接改 levelState），晚到的 rel 不把车挪回去，客机那边被拉过去，没人拿着租约。
  注意：这期间房主自己上不了这台车 —— 客机的位姿消息也攒着，房主那边一直看到他坐在车上，只给「队友在开叉车」；所以 vehFin 这道防线现在只防 levelState 被别的路子改过的情况）。
- **对方人形**：`me.pose = ['drive', key]` 时，对方把整只 hazmat.glb 藏起来，换成程序化防化服 `hazmat(ctx, { color: 对方皮肤色 })`（_archetypes.js 新增 `o.color`，材质缓存键带颜色，不影响拟态实体共用的材质），摆坐姿钉在 `BR.vehicles.seatWorld(key)`，身体朝向取车的 yaw，头按对方相机相对车转（限 ±90°）；下车切回 glb。名牌坐车时放在 seatWorld + 1.2，视线检查对准 `chestOf(对方)`（护顶四周是空的，隔着车身名牌也不变淡）。
- 三种模式都能联机（入口：主页「联机」→ 营地 → 帐篷，见第 9 节）；叉车跟着 `BR.game.coop` 走，不另加模式判断。测试一律用 tests/coop.mjs 的假 room.php，绝不连真实服务器。

### 15.8 货叉上的物资（单机）

- `dropSurface(x, z, r, type)`：落点离某根货叉中线 ≤ 12 cm（一掌宽）、并且叉面离地 ≤ 1.4 m（够得着）时返回 `{ y: 叉面, veh, tine, x, z }`（x / z 摆到那根货叉中线上）。player.dropSelected 先问它，返回车就用 `still: true` 刷在叉面上并 `attachItem(id, veh)` 记进这台车的 riders；返回 null 照旧落地。
  **这根货叉上已经有东西**（r4，以前站在原地连按几次 Q 会叠成一件）：沿货叉找离落点最近的空位，两件中心至少隔两件模型水平半径之和 + 1 cm（`footRaw`；要丢的那件按类型量，没量过找一件同类型的量，再没有按包围盒的半对角线估），
  一样近先往叉根那边；整件在叉面上、离叉尖和叉根再留 2 cm（叉尖顶着墙撞上时它离墙还有一点空，能从叉边滑下去）；整根货叉放不下了返回 `{ full: true, … }`，player 提示「货叉上放不下了」、东西留在手里（隔着墙看不见那根货叉时照老规则丢地上）。
  丢在两根货叉中间的空当、或者叉面举得比 1.4 m 高时，东西落在地上（之后降货叉会停在它上面，提示「货叉下面有东西」）。
- 车或货叉在动时，对 riders 调 `items.hold(id, true)`，每帧按 pose 跟着挪；停稳一帧以后 `hold(false)`，一次写 levelState。降到底它还在叉面上（叉面离地 5.5 cm），不会掉进货叉、也不会穿到地上。
  重新载入时，把落在某根货叉叉面 ±2 cm 以内的丢弃物重新挂回去，所以走远、离开这一层再回来都还在叉上。货叉降下来以后叉面上的东西照常能捡；叉面高过 1.4 m 时对准它只给灰字「货叉举得太高，够不着」。
- 联机时本来就不能丢东西（现有规则），所以货叉上不会有瓶罐。FE2 以后 dropSurface 也覆盖登记了的托盘货顶。

### 15.9 kit 新增（js/levels/_kit.js，FE1）

```
kit.hideSpans(res, spans) → 新藏的顶点数；kit.showSpans(res, spans) → 放出的顶点数
                                       spans = { 'kit:prop': [v0, v1] | [[v0, v1], …], 'kit:decal': … }（键写材质名，不是 b.data 里的 prop / wear / oil）。
                                       照 Piece.setVisible 的做法把一段顶点叠到段首一点（零面积三角形不出像素），原值存下来；幂等（重复 hide 不改网格、不上传），
                                       只上传这几段（updateRange）。和 moveProp 的 _saved、Piece.setVisible 叠着用往返逐位不变：藏着期间它们改的是存着的原值
kit.spanHidden(res, matKey, [v0, v1])   这一段是不是整段都藏着（测试、调试用）
kit.spanEdit(res, matKey, [v0, v1], fn(pos, nrm, orig)) → bool
                                       把这一段的 position、normal 视图交给 fn 改，只上传这一段；第一次调用存原值，orig 只读（每帧按原值重算，不会越改越歪）。
                                       这段有一部分被 hideSpans 藏着时不改、返回 false。藤蔓被车拨开用；不要用在能拖的道具上（moveProp 会把改过的形状冲掉）
kit.spanRestore(res, matKey, [v0, v1]?) → bool   相交的 spanEdit 段逐位放回原值；不传 range = 这个网格上所有改过的段
kit.builder(ctx, cx, cz, rng)          区块外也能用（ctx 里没有层级，或 opts.helper）：BR.vehicles 按部件建可动叉车；finish() 不跑工坊 decorate
b.mark() → { matKey: 当前顶点数 }        只读数、不加几何、不吃 rng：部件前后各调一次，[前, 后) 就是中间画的那段（kit 构件的磨损贴花晚到 finish 才画，不落在两次 mark 之间）
                                       注意：BR.vehicles（vehicles.js 的 markOf）还直接读 builder._accs（Map<matKey, { n, idx, … }>）拿索引数 ——
                                       改 kit 累加器的内部结构时要一起改那里（或者给 mark() 加上索引数）
```
- **显式 `meta.key` 不占自动编号**：给已有的东西补一个显式 key 包起来（叉车 fixture `'1@cx,cz#v<i>'`、FE2 的托盘货），自动编号的 `#p` / `#f` / `#c`（和子道具的 .n）照旧连着往下数，别的道具的 key 一个都不变（联机、存档只靠 key 对上）。显式 key 撞上别的记录时后一个覆盖前一个，控制台提醒一次。

### 15.10 L1 的数据（纯数据，golden 不看 res.data / res.kit）

- `b.data.forklifts[i] = { key: '1@cx,cz#v<i>', i, x, z, y, rot（世界坐标）, lx, lz（区块本地）, number（车身编号）, detail（停放档；保底车 null）, tris, solid（res.solids 下标）, spans: { prop: [v0, v1], wear: [[v0, v1]…]（不含 FK_WEAR[0]）, oil: [v0, v1] | null }, wearN, runtime }`。
  停着的车的碰撞框由 `b.fixture({ key, kind: 'vehicle', label: '叉车', why: '叉车太重，拖不动' }, () => b.solid(...))` 包住原来那一次 b.solid（res.solids 的顺序和内容不变）；spans 是 buildForklifts 在每台车的磨损和模型前后量出来的累加器顶点段。
- `b.data.overhead = [{ kind: 'beam' | 'lamp' | 'pipe' | 'valve' | 'gauge' | 'tray' | 'cable' | 'drip' | 'arch', minX, maxX, minZ, maxZ, y, … }]`（世界坐标，y 是底面离地高）：在画这些东西的地方顺手记，不多取随机数、不改几何，高低画质一样。
  主梁底 3.55、吊灯罩底约 3.14、沿 x 的管子 3.42 − r（托码再低 2 cm）、沿 z 的管子 3.2 − r、阀门手轮和压力表底、桥架 3.35、走廊顶板 2.8、天鹰段漏水小管、传说段垂下来的电缆（分段，最低约 2.3）、哥特段的拱（按 0.25 m 一段切成台阶盒）。
  叉车升货叉时门架顶（2.12 + d）、挡货架顶（1.24 + 2d）碰到之前就停在底面以下约 2 cm，提示「上面有管子，升不上去」（按 kind 说管子 / 吊灯 / 横梁 / 桥架 / 电缆 / 拱顶，阀门、压力表、漏水小管都算管子）；举着货叉开车时这几块的顶高也纳入扫掠。满升时内门架顶约 3.42、挡货架顶约 3.84。
- `b.data.sideObs = [{ kind, cx, cz, hx, hz, rot, minX, maxX, minZ, maxZ, minY, maxY, round?, r? }]`（repair-r1）：车身高度上伸出来、却没有碰撞体的东西（世界坐标：中心、半宽、绕 Y 转角
  （90° 的倍数折成 0、半宽对调），外接矩形，底 / 顶离地高；round = 竖直圆柱，r 半径）。L1.js `sideAdd(b, env, kind, x0, x1, y0, y1, z0, z1, round)` 在画的地方顺手按当前坐标系记，
  和 ohAdd 一样不取随机数、不改几何、高低画质一样，只在 buildChunk 的 env 上挂了 side 才记（营地不记）。种类：plinth（柱脚，每边比柱身碰撞盒宽 8 cm、高 0.22；哥特段八角柱础宽 13 cm、高 0.26）、
  guard（主通道边柱子的黄色护角，凸出柱面 3.75 cm、0.22–1.12）、cabinet（墙上消火栓箱，0.8–1.7、凸出 0.21）、extinguisher（小屋门边的灭火器）、switch（小屋门边开关盒）、door（小屋推开着的防火门扇，往屋里转 72°，
  叉尖伸进门洞时挡住）、carton（货架通道里掉下来的纸箱）、jack（地牛：叉腿和泵体 / 拉杆 / 把手两块，跟着地牛转；两块都带 `solid: [minX, minY, minZ, maxX, maxY, maxZ]` = 地牛脚下那块 1 m 见方老碰撞体的世界坐标（同一个数组），叉车跳过它，见 15.4）、cone（施工区路锥 r 0.16 高 0.63 + 底座）、sand（砂堆坡脚 r 0.87 高 0.2）、shrub（花园段灌木 r = 叶团半径）、
  pipe / valve / gauge / lamp（Level 2 走廊口右墙的管排、法兰、托架、阀门手轮、压力表，左墙笼罩灯）。
  BR.forklift 每步把车 6 m 内的条目按真实形状（圆 / OBB / 矩形，forklift.js `sideShape`）加进扫掠（撞上「咚 / 哐」，不出状态行）；升货叉时部件在条目正下方（同样按真实形状判断）就停在它底面以下 2 cm
  （「上面有消火栓箱 / 灭火器 / 开关盒 / 路锥 / 灯，升不上去」，管排说管子；没列的说「东西」）；降货叉时在条目正上方就停在它顶面以上（「货叉下面有东西」）。
  tests/forklift_l1.mjs data 段守着它：字段合法、每根柱子有柱脚、高低画质逐项一样、营地不写、地牛的 solid 正好对上 res.solids 里那一块；tests/forklift.mjs side 组 S12 / S12b 偏心开向斜放的地牛、纸箱和路锥、砂堆，被挡住时离真实形状 ≤ 5 cm；
  S12c 专门开向斜放的地牛（正对、偏心 0.3 / 0.6 m，4 个方向），量到地牛两个条目的真实形状，那块老碰撞体不算「别的碰撞体」。没覆盖的（都记在 repair-r1 报告里）：小屋里面的家具（只有叉尖伸得进 1.0 m 宽的门洞）、地上 8 cm 以下的碎屑、凸出墙面 ≤ 3 cm 的窗台、门把手。
- `b.data.vines = [{ top: [x, y, z], bot: [x, y, z], r, mat: 'kit:prop', v: [v0, v1] }]`：花园段梁上挂下来的每根实际画出来的藤蔓（v 是它在区块 kit:prop 里的顶点段）。车附近 4 m 内的藤蔓下段进了护顶、门架或司机胸口点外扩 0.1 m 的范围，就绕顶点往离车的方向转开（`kit.spanEdit`），车离开后约 1.5 s 内慢慢摆回（`spanRestore`）；纯表现，不同步。传说段垂下来的电缆是硬的，会挡车（在 overhead 里）。
- **出生保底**：L1 正常生成时（工坊地图、营地不算），出生块 (0,0) 的中间柱间永远有一台叉车。openBay 加 force 判断：k 落在叉车区间（天鹰段 0.6 ≤ k < 0.62）而且放得下就照旧走 forklift()（种子 12345 就是这样，逐字节不变）；
  否则排在车位线 / 地牛 / 托盘垛之前，按叉车分支同样的公式取 4 次随机数，放一台保底车：只出 fixture 包住的外接 AABB 和一条 `runtime: true` 的记录（没有 spans），不建区块几何、不进 fkQueue、不记账面，所以不受面数闸门影响。
  同一柱间后面的碎屑只在保底触发时跳过落进叉车占地（含货叉）外扩 0.2 m 的那几片，随机数照取。保底只改变这个柱间之后的取数，块和块之间互不影响；约 98% 种子的 (0,0) 会变，但它们都不在 golden 里。
- 工坊地图要给工坊的出口和自由墙留面数时（原来低画质最重的两台叉车块加 3 个出口会超 8000），按出口种类预留（「区域」出口不画地上发光圈，留 0）；连 min 档都放不下时从最后一台起改成运行时车（`runtime: true`，和保底车一样由载具网格画），非工坊生成逐字节不变。
- 营地（`BR.L1room`）不写 overhead、sideObs、vines，不放叉车也不走保底。

### 15.11 前大灯和声音

- **仪表台大灯开关**（家长 2026-10 拍板，repair-r2）：`pose.hl`（1 开 / 0 关，出厂开着）。BR.vehicles 在载具网格里画（区块里停着的车不画，golden 不动）：仪表台斜面左半边（方向盘左下方）一块深色底板 + 镀铬拨杆（开往上扳、关往下扳）
  + 拨杆上方一颗绿色指示灯（kit:glow，着车且开着才亮，熄着 × 0.12 近乎黑）+ 下方小灯头图标。坐在车上准心对准它（候选 `{ kind: 'button', key: 'fkhl:' + 车 key, label: '大灯开关', small }`）短按空格开 / 关，
  「咔哒」一声；**点火时大灯跟着开关**（出厂开着，所以点火默认亮），关着就撤掉灯池那一盏、灯罩和指示灯熄灭，`world.lightAt` 不再把司机算成被照亮（理智、怕光 / 找光的怪都看它）。
  手机上准心对着开关时「下车」键临时写成「开大灯 / 关大灯」（`input.setButtons({ interact: { label } })`），移开恢复「下车」。开关状态单机 / 房主写进 levelState.vehicles.hl（离开再回来保留），联机经 hand 的第 10 个值同步。
  `BR.vehicles.lightSwitch(key?) → { x, y, z, hl, lit }`（底板中心世界坐标，测试对准它用）、`toggleLight()`、`headlightLit()`（本机坐着的车大灯正亮着），bus `'vehicle:lights' { key, hl, lit }`。
- **L1 断电提示**：坐在开着大灯的车上时断电开始（或断电途中大灯亮起来）说「闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关按空格可以关掉，或者下车找亮着绿色应急灯的门躲进小屋」（每次断电最多一次）；
  手机上（`BR.input.isTouch`）说「闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关点「关大灯」键可以关掉，或者下车找亮着绿色应急灯的门躲进小屋」（手机上没有空格，开关靠对准时临时写成「关大灯」的那个键拨，repair-r3 裁定 ④）。
  两句都是家长定的原话（49 / 53 字），显示时长按每秒 6 个字算、不少于 6 秒（8.2 / 8.8 秒，L1.js `fkDarkTip`）。别的时候还是「闪烁：别开灯，找亮着绿色应急灯的门躲进小屋」（一局一次）。
- 前大灯（数值以代码为准，主会话 r3 裁定 ⑤ 认可、方案已同步：断电时车前 6–8 m 真的照亮、车后不亮、不透墙，tests/forklift.mjs dark 组 K1–K6）：层级不建 PointLight。开着的车通过 `world.setExtraLights('fk:' + key, [灯])` 交给 gfx 现有 6 盏灯池里的一盏，每台开着的车 1 盏，和别的灯一样按离相机的距离挑。光源由 `sim.lightSpot()` 给：先从前立柱沿车头方向 raycast，叉根前 4 m 以内有墙就放在墙前 0.3 m（range 收到 1.8–2.2 m，墙另一侧 2 m 处已在范围外），否则放在叉根前 4 m；离地 1.6 m、range 8、强度 3.2、暖白（光斑铺在车前 2–8 m，L1 断电时车前 4 m 地面约是环境的 3 倍多，车尾后 2 m 在 range 外）。
  所以车头顶着墙时光不透到墙那边，车后面不亮；L1 断电时正好空出灯位，平时会挤掉最远的一盏区块灯。没人开的车大灯不亮；熄火后撤掉，灯罩变回暗色。
  vehicles.js / vehicles_net.js 里 lightSpot() 没给的字段（颜色、强度、range）按 `BR.forklift.config.light` 补（两边的 HEADLIGHT 只是 forklift.js 没加载时的默认，数值同上）。
- 声音：一次性的 `BR.audio.play('fk_*', pos)`，持续的 `BR.audio.loop('fk_engine' | 'fk_hydraulic' | 'fk_reverse', pos)`（第 12 节 BR.audio）。发动机声随车速变高变低；按住 R / C 液压泵「嗡」；倒车「哔、哔」；到顶到底「咔」；头顶挡住憋压；撞上「哐」/「咚」；雷达「嘀嘀嘀」。

### 15.12 以后接着做的阶段要知道的

- FE2（托盘货）按本节定下的 key 和接口接着做：托盘货全部用显式 key 纯数据登记；车开始对口插入的那一刻把货的顶点段拷进全层共用的「搬运件」网格（`kit.extractProp`），原区块那段藏掉；`world` 模块表里的 `'cargo'` 就是它；叉货、放货走可靠事件 fkLoad / fkDrop。
- N2 / A2 / D1 / D2 / B1 / B2 在 forklift 分支合回之后开工，沿用这里的 key（`'k:'` 租约、`'veh|'` 碰撞、`'#v<i>'` fixture）和接口（player.mount 是 D2 player.setPose 的子集，A2 的道具登记沿用显式 key 不占自动编号）。
- 改 L1 构件的阶段，golden 白名单照例写上 coopcamp；叉车四块（种子 12345 的 (0,0)、(1,0)、(2,−2)、(−2,2)）任何结构变化都是 bug，不许扩白名单。
