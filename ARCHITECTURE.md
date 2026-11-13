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
  attack(e, target, onLand?) // 起手：定冷却、正对目标、排挥臂，返回 true = 起手了（FE1P H11）；扣血 / 扣 san 在起手后 STRIKE_HIT_K（0.38）个冷却周期
                             // = 胳膊挥到最前那一帧才结算，那一刻目标已跑出 攻击距离 + 人的半径 + STRIKE_SLACK（0.15 m）、视线被挡、canAttack 不过就算没打中；
                             // 抡的这一下里实体不想事，但脚下接着扑（返修 r1）：每帧正对目标，按起手前 3 s 内最近一次 moveToward / flee 的速度
                             // （没有就 def.speed.run）往追击点挪，挪到离目标「攻击距离 − LUNGE_IN（0.15 m）」为止，被墙、车身挡住就贴着滑；
                             // onLand(e, t, api) 只在打中那一刻调；游玩模式下对玩家自动无效
  attackStart(e) / swinging(e) // 这一下起手的时刻（秒）| null；正在抡（起手了还没结算）
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
  矮横屏（高 ≤ 520）toast 在右上角，和横幅同一高度带：横幅开着时 hud.js 量横幅底边，toast 排到它下面 8px（`.hud-toasts-below`）；站着时那一列压到触屏键 / 实体键 / 准心提示就改成往上长（FE1Q J5，见 BR.hud 的 toast 那几条）。
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
update(dt, inp | null); refresh(); current; target; state 'idle' | 'pressed' | 'drag' | 'hold'; dragging; mode; owner（接管者的 key）; crossHidden
holdProgress(); speedCap(); cancel(reason); aimAt(x, y, z); heldInfo(); debugInfo()
  // debugInfo().cands（FE1 返修 r14）：最近一次 aim 考虑过的候选 [{ src, kind, key, t0（来源给的 t）, t（按模型重排后）, why }]，
  //   why = 'best' 选中 | 'lost' 被压过 | 'mesh' 别的物资被准心打中了模型、它没有 | 'far' 够不着 | 'mode' 情境不收 | 'wall' 被墙挡住 | 'bad'；debugInfo().ray：那一次的准心射线
```
- 准心对准 + 空格短按 = 使用 / 拾取，长按（≥ `BR.config.interact.holdMs` 350 ms）= 拖动；原来的互动键只在 input.js 里留作隐藏别名，界面文字里只写空格。墙、通往别层的门、出口不登记成候选，所以拖不动。
- 物资挤在一起时（`refineItems`，FE1 返修 r10 / r12）：两件以上物资候选时按准心射线真正打中的模型（三角形）重排，打中了的 t 换成打中模型的距离、记 `meshSeq`；
  两件都打中了模型时 `better` 严格按打中的距离选（返修 r12 裁定 E：不再套「2 cm 内算平手按种类排」和「小目标优先」），高亮的、按空格捡到的就是准心最先碰到的那件。
  歪着摆的静止物资（放得稳的静止姿态）命中球多包一点（items.js `hitAdd`）。tests/interact.mjs clutter：9 种挤成 3×3、6 个站位 270 个准心点 0 个不一致，真按空格捡的也是那件。
- **准心目标按画出来的那一帧选**（返修 r13，验收员 play）：`update` 在 player.update 里、转视角和 items.update（浮着的物资上下浮、转圈）之前跑，选目标用的是上一帧的视角和物资位置；
  main.js 在 items.update / workshop.update 之后、hud.update 之前调 `refresh()`（idle 时再 `aim()` 一次），HUD 提示就是这一帧画面里准心先碰到的那件；
  下一帧按下空格时 update 开头的 aim 用的还是这一刻的视角和物资位置，捡到的就是提示写的那件。clutter 测试对准以后走整帧 1/30 s（物资照常浮动）再比。
- 按下那一刻怎么走（`onPress`）：
  - 有使用动作、也有长按动作（能拖、有 `hold`、或者长按要给原因 `dragWhy`）的候选：先进 PRESSED，按住不到 holdMs 松手 = 短按，按满 holdMs = 拖动 / 长按动作 / 只给原因。叉车属于这一种：短按「上车」，长按只给「叉车太重，拖不动」，车一点不动。
  - **只有短按、没有任何长按动作的候选，按下即执行，不等松手**：情境里的「起身」「下车」，以及自己拖不了、又没有可拖父道具的东西。A1 方案字面是「有 short 的一律先进 PRESSED、松手才算短按」；A1 验收 minor ⑦ 由主会话决定**保留按下即执行**（两种写法玩家只差按下到执行的那几十毫秒，按下即执行更跟手），以本条为准。以后真要改成松手执行，只改 onPress 里那一行（`setState('pressed')`，stepPressed 已经能处理）。
  - 只能拖的（kit 家具、测试人、门扇）一按就拖；有用途但此刻用不了的种类（物资、容器、设备、座位、载具、按钮）进 PRESSED，短按不出动作，也不拖。
- drive 情境（FE1）：BR.vehicles 上车后调 `setMode('drive', { key: 车 key, kind: 'vehicle', label: '叉车', accept: () => false, onShort: 下车 })`。`accept` 恒为 false，准心对着哪里都只有情境候选「下车」（`MODE_DEFAULTS.drive`），它只有短按，所以按下即执行；中间提示「空格 下车」（手机「点「下车」」；返修 FE1R · repair-r3：电脑上低头看、往下超过 0.9 rad 时，只剩这一句的提示挪到准心右边（触屏右边那一列是「升」「降」键，照旧在准心下面） —— hud.js `updatePrompt` 给 .hud-prompt 加 `hud-prompt-side`，
  不盖住准心正下方要看的东西，例如 K9 从驾驶座往左下看安全带扣头下面那截短带）。坐车时捡不了、丢不了东西，冲刺没用；F 使用（扔出去的除外，FE1R F5）、切背包格子照常。
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
- reset、respawnInPlace、死亡结算之前先调 `handle.forceExit(reason)`。`dropSelected` 先问 `BR.vehicles.dropSurface(px, pz, r, type)`：返回车就把物品 `still: true` 刷在返回的叉面高度上并 `attachItem`；返回 `{ full }` 时有 gx/gy/gz 就丢在那块地上、没有就留在手里，
  提示说清楚发生了什么（「这一段叉面满了，东西放到旁边地上了，叉尖那头还空着」「这根货叉摆满了，旁边地上也放不下」这一类，按每秒 6 个字、不少于 3 s，见 15.8）；返回 null 照旧落地。

### BR.items（js/game/items.js）
```
spawn(type, x, y, z, { id, chunkKey }?): pickup     pickup = { id, type, x, y, z, obj, chunkKey }
removeChunk(chunkKey); clear()
nearest(x, z, maxDist): pickup | null
pick(id, by): bool                     by = 'me' | 'peer'；进背包并从场景移除
update(dt)
list
rest(type) → { rx, rz, bot, com, hull, inset }   放得稳的静止姿态（见 15.8）；只按实物网格算（FE1P H6）
solidMesh(n) → bool                    n 是网格并且没有 userData.glow 才算实物（FE1P H6）：物资 build 时给光晕、发光体标 mesh.userData.glow = true
                                       （火盐的光晕球、瓶装闪电的闪电和瓶内光晕；clone 会带上）；静止姿态、vehicles.js typeShape / footOfObj、测试的 F.solid 都按它判，
                                       准心命中球、items.info 的包围盒照旧按整个模型
floorLift(id) → 米                     静静躺着的 = −rest(type).bot（最低顶点比原点高时是负的、原点放在地面下面一点，FE1P H13；那时立着的糖果袋是 −2.5 mm，返修 r1 起糖果袋倒平、是 +32.5 mm，现在没有物资是负的）、浮着的 0
```

### BR.world（js/game/world.js）
```
start(levelId, seed): Promise          清场、载入出生点周围区块、放置玩家、emit level:enter
goTo(levelId, via?): Promise           淡出 → 换层 → 淡入
update(dt)                             流式加载/卸载、出口检测、level.update
current; levelSeed; chunkArea
lightAt(x, z): 0..1                    额外光源（叉车大灯）那部分按画面上那盏灯（收过的 range、补过的 intensity）算，衰减和 gfx 一样 (1 − d/range)²，
                                       d = 光源到「站在 (x, z) 的人」（离地 0–1.8 m 那段竖线）最近的距离（FE1Q J8：和画面一致，被墙 / 货架收短的地方不算亮）；
                                       owner 'fk:<key>' / 'fkr:<key>' 并且 BR.forklift.byKey 找得到模拟的（光球已经按墙、货架收过）不再看视线（画面没有影子），
                                       再和 sim.litSeat(x, z) 取大的 —— 车灯开着时驾驶舱矩形里固定 ≈0.338（保住「开着车灯怪不敢靠近司机」，断电时座位 0.40 → 0.74）；
                                       别的额外光源照旧从光源到 (x, z) 看视线（extraSees(L, owner, x, z, d, gy)）
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
                                       颜色、强度、range 变了要再调一次。工坊的 lightTransform 照样套；lightAt 也算上它们；换层、回主页整个清空。
                                       FE1P H8：层在的时候马上 pushLights（同一帧灯池就换上新的 range、强度，车开向墙时不会有一帧光球伸到墙后）；
                                       FE1Q J8 起光源不再带 litRange / litIntensity（lightAt 按画面上的 range / intensity 算）
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
A.melee(e, api, t, onLand?)            近战骨架（FE1P H11 起第 4 个参数 onLand）：只起手，onLand（骨架选项 onAttack）在胳膊抡到最前、真打中那一刻才调
A.anim.strikeCurve / STRIKE_PEAK（0.38）/ strikePhase(e, api, t, u, cd)   抡胳膊的曲线、峰值（= entities 的 STRIKE_HIT_K）；相位从 api.attackStart(e) 算，
                                       客机没有起手时刻照旧按 stateAt 循环；抡完一轮停在收回的姿势，不空抡。FE1Q J1：smiler.js 的脸部放大也按 strikePhase / strikeCurve，
                                       onAttack 作为 onLand 交给 A.melee —— 笑魇鼓脸鼓到最大那一帧正好扣血（tests/infection.mjs h7，偏差 0 帧）
A.parts.hazmat(ctx, { color, detail })  程序化防化服（坐车队友、窃皮者伪装）：FE1P H10 起手套 / 靴子 / 面具颜色和 hazmat.glb 一样，换皮肤只换制服（见 15.7）；
                                       FE1Q J7 起低画质的面罩框、滤罐、手套、靴子也按顶点色上成 glb 的颜色（hazPal().low），面数、槽位、draw call 不变；
                                       FE1Q repair-r1 起面罩、滤罐、靴子的形状也照 glb（hzMask：椭球脸罩 HZ_MASK + 目镜带 + 呼气阀 + 两侧圆滤罐；hzBoot：0.365 m 高筒靴 + 圆靴头），
                                       几何键 hazmat_lite_v4，高 2400 / 低 768 面；tests/smoke.mjs 量脸罩、滤罐、靴子包围盒和 glb 相差 ≤15%
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
  货叉尖前面的怪够不着，会绕到车侧或车尾（叉车不是安全屋）。FE1P H11（主会话裁定）起攻击距离改成量到**司机身体**：hypot(怪 − seatWorld(车)) ≤ attack.range + 玩家半径，
  不再量驾驶舱矩形再加半径（以前悲尸站在车身外 1.1 m、离司机 1.5 m 就打中了）；追击点在车侧收到够得着司机的那一段，车尾够不着司机（配重在座椅后面约 1 m），会绕到车尾侧角。
  扣血时刻对所有近战怪统一（见第 6 节 attack）：胳膊挥到最前那一帧（strike 曲线峰值 0.38，`BR.arch.anim.STRIKE_PEAK`）才结算，那一刻再量距离、视线；
  抡的这一段实体不 think，脚下接着往目标扑（返修 r1：以前原地不动，人一直往前走 0.46 s 走出 1.4 m，所有近战怪每一下都空挥），冷却照走；被打死 / 被拖走就落空。e._m.lastSwing = { start, at, kind, hit, why: 'hit' | 'far' | 'wall' | 'cannot' | 'nodmg', dist }。spawnForChunk 和实体表一行没改（golden 的实体落点靠它）。
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
                                       FE1R：toast 时长 = max(ms 或 2200, readMs)，没显示满不被挤掉（排队 BR.hud.toastQueue，30 s 上限）；levelTitle 副行中文层名、
                                       生存难度行查表，按准心和触屏键摆（BR.hud.titlePlace）。levelName(id) / levelLabel(id) / levelClass(id | def) / readMs(text)，见 15.13「界面」
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
                                       电脑「W/S 前进后退 · A/D 打方向 · R 升货叉 · C 降货叉 · F 使用 · 空格 下车」，
                                       手机「摇杆开车 · 按住「升」「降」动货叉 · 点「下车」键离开」（FE1R UI-6 / UI-8）
                                       触屏按档摆：13px 整段不折行 → 12px → 11px → 12px 允许「按住「升」「降」」和「动货叉」之间折行（只有 320 宽竖屏用得上），
                                       第一个不压任何按钮、摇杆、物品栏（连同物品名那一行）的档就用它（360×640 竖屏是 11px 三行，每行一整段；320×568 竖屏拿着东西时是 12px 四行）；
                                       每一档在准心下面都放不下时挪到准心上方（状态短提示那一格上面、左上信息块下面，让开按钮、测试模式「实体」入口、联机麦克风键），
                                       再不行才压住物品名那一行（repair-r2：以前压物品名排在换小字号之前，320×568 字叠字）。`BR.hud.drive.place` = { mode（用上的档）, upper（挪到了准心上方）, fit, dots（藏掉的行末点个数）, … }
                                       FE1P H15：竖屏触屏时把摇杆推得到的圆（半径 1.25r + 圆头半径，按 12 条横带近似）也算要让开的东西 —— 先试准心下面不拆段的几档，
                                       再试准心上方不拆段的几档，最后才拆段；折好行以后行末的「 ·」加 .hud-drive-dot-end（visibility:hidden，占位不变、不来回跳）。横屏、电脑不变。
                                       返修 r1（摇杆是浮动的，左半屏哪里按下哪里起摇杆，按偏 30–60 px 再推照样盖住框）：竖屏开车时 hud.js 给 <html> 加 hud-stick-cap、
                                       写 --hud-stick-top = 提示框底边 + R（R = 1.25r + 圆头半径）+ 6 px，css/game.css 把 .touch-zone-l 的上沿收到这里、右边视角区铺满整宽
                                       并用 clip-path 切成 L 形（上沿以上的左半屏归转视角）；摆框时把「摇杆区（上沿最高到待机摇杆上沿 − 0.6r）里任何一点推得到的范围」
                                       当成要让开的矩形，准心下面放不下就挪到准心上方（四种竖屏实测都在准心上方一行）。place 多给 stickTop、stickReach、stickOk。
                                       下车、横屏、电脑时去掉 hud-stick-cap（tests/mobile.mjs DR7b 查下车以后类和变量都清掉、摇杆区回到上车前、原来上沿以上照常起摇杆；DR9c 查横屏开车不收）。
                                       FE1Q J4：input.js moveStick 在 <html> 有 hud-stick-cap 时把圆心夹在 --hud-stick-top 以下（stickCapTop()），左右照旧跟着手指走；
                                       tests/mobile.mjs DR9d 从待机中心每 20 px 一步往上拖到屏幕顶、再斜着拖到提示框中心，每一步圆头和底盘都不碰提示框（4 台竖屏）
                                       FE1R UI-6 / UI-8：电脑最后一段「F 使用」，触屏最后一段「点「下车」键离开」；准心对着大灯开关时这一段临时换成「空格 关大灯 / 开大灯」
                                       （触屏「点「关大灯」/「开大灯」」，.hud-drive-alt 按最宽那一版占位，各段 x 不变；BR.hud.drive.alt）。见 15.13「界面」
driveNote(text, ms?)                   开车状态短提示（「发动中」「雷达自动刹车」「前面是出口，下车走过去」「上面有管子，升不上去」……）：同一行替换，不排队刷屏。
                                       FE1R UI-10 / UI-2：显示时长 ≥ 字数 × 1000 / 6 ms（BR.hud.readMs），driveNote('') 来早了先挂到读完；触屏竖屏按空位找地方（BR.hud.drive.notePlace）
                                       准心正上方居中；触屏上这一高度旁边有键（窄竖屏的升键）时一行放得下就往空的那边挪，一行实在放不下才折行（不截字）。
                                       层级大标题还没收、和它（或挪到准心上方的常驻提示行）压在一起时，大标题 0.25 s 淡出（进层 5 秒内就上车的情况）
```
- toast 自动避开多行交互提示和开车提示行（A1 minor ①）。toast 折行时「…」里的按钮名不拆开（FE1 返修 r4），用「，」隔开的 7 个字以内的短段也不拆开（FE1 返修 r6：「…，靠车那头还空着」在 360 px 竖屏上被拆成「靠车那 / 头还空着」），长段里几个固定的词（下车、大灯开关、应急灯、躲进小屋、靠车那头、叉尖那头、旁边地上、叉面、货叉）也不拆开（FE1 返修 r7：断电提示折成「或者下 / 车找亮着…」「绿色应 / 急灯」「门躲 / 进小屋」）；都只是包一层不换行的 span，文字不变。按「，」切段手写循环，不用正则后行断言（r7：`(?<=，)` 在 iOS / iPadOS Safari 16.4 以下解析就报错，整个 hud.js 不执行；tests/forklift.mjs D0 查 js/ 里没有 `(?<=` / `(?<!`）。
- 开车时 toast（`avoidDrive`，返修 r2，验收员 play：竖屏开车提示框挪到准心上方以后，断电那条两行的提示留在准心下面的默认位置，盖住「升」「降」，320×568 还盖住摇杆和「丢弃」）：
  默认那一列（屏幕中线 + dy）先按开车提示框收（框在下面挡着就只留放得下的，放不下改往上长），触屏再和站着时一样量触屏键、待机摇杆（`touchColumnHit`，按算的位置、只算排得下的那几条），压到了也改成「往上长」。
  `placeUp` 返修 r2 起：底边贴着状态短提示那一格；竖屏开车提示框在准心上方（`place.upper`）、跨着中间时底边改贴它的上沿（排在它上面，不叠在一起）；
  按实际排出来的那一列找位置 —— 先试最宽的一列，再试收窄到让开两边东西的一列（按这个宽度重新量每条多高），留下的条数多的用哪个（一样多用宽的）；只看和这一列上下有交叠的东西（信息块、状态条、警告、横幅、联机麦克风、测试「实体」键、触屏键、待机摇杆），右上角「暂停」键这种比列顶还高的不再让列收窄；
  连最新那条都怎么都放不下才退回老办法（收窄、上限压到中间那些东西下面，最新那条照常显示）。tests/mobile.mjs DR10（所有跑开车段的设备）：开车时来一条短 toast、紧跟着断电那条 53 个字的长提示，看得见的 toast（不含正在淡出的）不压触屏键、待机摇杆和开车提示框。
- 触屏站着（没开车）时 toast 那一列按算出来的位置（列顶 = 屏幕中线 + dy，一条条往下排、居中；不量 getBoundingClientRect，margin-top 有过渡、淡入有位移）压着看得见的触屏键或待机摇杆，就和开车时一样改成「往上长」（`avoidTouch` → `placeUp`，FE1 返修 r7：360×640 竖屏上往货叉上丢东西的两行提示被准心下面的两三行提示推到 y≈400，盖住「丢弃」键和摇杆上沿）。tests/mobile.mjs A3b 查两条长 toast 不压触屏键和摇杆：跑 game 段的 360×640、640×360、402×874、874×402 在 game 段里查，方案 phone[4] 点名的 390×844、844×390 和最窄的 320×568 单独开一局只跑 A3b（`secA3b`，FE1 返修 r8 裁定 ⑥：以前正式套件只覆盖前 4 种）。
  FE1Q J5（FE1 就有：640×360 横屏站着两条两行 toast 叠在右上角，盖住「冲刺」「丢弃」和准心提示）：矮横屏（`shortScreen()`，高 ≤520）以前 `avoidTouch` 直接 return，现在用 `cornerColumnHit(nodes)` 量右上角那一列
  （按容器位置，每条 offsetLeft + 排下来的高度，不受淡入位移影响）压不压触屏键、待机摇杆、`.test-entry`、`.coop-mic`、`.hud-prompt`（各留 4 px），压到就 `placeUp(nodes, mid, stand=true)`：
  居中，底边 = 准心连进度环上沿（mid − `CROSS_REACH` 18 − 6），站着没有状态短提示那一格不用留，底边往下 4 px 以内的东西也让开；放不下的从最早的收掉。
  一旦往上长（`S.toastUp > 0`），这一批 toast 全部收掉之前跳过检查直接 placeUp，不跳回原位（竖屏站着也生效）；只剩正在淡出的 toast 时不动；矮横屏开着测试面板（`html.br-test-open`，css 把 toast 挪到左边）时照旧；
  `S.testSig` 记「实体」键显隐和测试面板开关，placeToasts 每帧比对，变了重新摆。844×390 游玩模式两条两行照旧留在右上角。tests/mobile.mjs 新设备 se1-l（568×320），android-l、iphone13-l 各加一段 toast-short：
  A3c（游玩 / 测试模式连发两条两行 toast 不压触屏键、待机摇杆、实体 / 开麦键、准心提示，在视口里，844 游玩模式照旧在右上角）、A3d（最早那条收掉以后不跳回右上角、底边不动）、A3e（再来断电长提示也不压）。新文字里不出现隐藏别名键的那个字母；HUD 写手机提示时跟着 `BR.input.buttonLabel('interact')`（开车时是「点「下车」」，不重复成「点「下车」下车」）。
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
seatBody({ detail, headYaw, pitch, keep }?) → { verts, box: { min, max }, tris, dims, detail, group? } | null
                                       FE1P：照坐车队友同一套摆法建坐姿人形（程序化防化服），返回蒙皮后车本地坐标（车头 −Z、地面 y = 0、座椅 (0, 1.16, 0.24)）的顶点和包围盒
                                       （高画质 x ±0.281、y 0.650–2.091、z −0.508–0.464）；keep: true 还给摆好的 group（单机拍车外照片当替身）。安全带离人、怪的手离司机身体的测试用
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
                                       part 'all' 且不开 drive 时照原位置、原顺序画（停着的车）。FE1P（主会话裁定 H1/H2/H3/H5）起停着的车改了灯盒、安全带、开关、链条，
                                       顶点不再和 FE1 逐位一样，改动只在叉车自己那几段（tests/forklift_l1.mjs snap 的 geoNoFk：去掉叉车段以后 900 块逐字节一致）。
                                       drive: true = 可动模型（只给开过的车）：货叉水平段等补底面；后轮转向扫过的圆柱里底盘收窄到半宽 0.188、
                                       配重下半截前脸让开（打满 65° 胎面离车身 ≥ 1 cm）；配重上半截在收窄段补底面、发动机盖后脸补挡板（FE1P H4，贴地低机位看不穿）；
                                       下半截前脸两个角的 x 取上半截轮廓在 cwFront 处的半宽（返修 r1：以前宽出 3–5 mm，y 0.5 一条楔形缝，站着从车后侧角看得到车底）；
                                       驾驶位地台各档都画左右侧面（返修 r1：mid / lite / drvLow 以前没有，站在车侧看得到车底；停着的车不动）；
                                       返修 r2（验收员 spec，FE1 就有的空口）：外门架顶梁两头的端面、护顶两侧纵梁六个面、前后横梁和格栅横条朝司机那面、
                                       起升油缸缸口封顶、杆头底面、挡货架立柱顶面、扶手（handle 1）顶端封口，各档都画（停着的车不动，golden 不变；
                                       可动模型 high 1936 / mid 1546 / lite 1215 / drvLow 1113 面，加开关和最多的磨损 high 1996 ≤ 2000）；
                                       FE1Q J11 起上面 r1 / r2 补的面停着的车也一样画（见下面 lod 那一条），「停着的车不动」不再成立；
                                       安全带（fkBelt，和停着的 belt > 0 档同一份）；两盏前大灯镜面和警示灯罩放进 kit:glow
                                       （只这一份，不和 kit:prop 叠着）；levers = 操纵杆根数（传停放档的根数，至少 1，升降杆要能扳）。drive 不取随机数
wear(b, opts)                          磨损贴花：opts = { detail, wearN, part = 'all', lift = 0 }，画 FK_WEAR[1..wearN]，跳过 FK_WEAR[0]（车下那滩油不随车动）；
                                       part: 'oil' 只画那滩油（运行时车的地面油渍）。不看区块贴花上限，返回画了几片
lod                                    【FE1R 起以 15.13 为准（K3）：停放档只剩 high / mid / lite / low（FK_PARK_FLOOR = 'low'，按 low 都放不下的车改成运行时车），
                                       low 停放档和 drvLow 同一份几何；lowb、min 已经删掉（FK_LOD 只有 high / mid / lite / low / drvLow），停放档只剩 high / mid / lite / low。下面是各轮的历史记录】
                                       FK_LOD：high / mid / lite / low / lowb / min，FE1 加 drvLow = lite 去掉倒角和贴花（bev:false、ch:0、cwC:0、decals:0），
                                       返修 r1：lite 也画操纵杆头（knobs，每根 10 个三角形；可动模型各档本来就画，lite 停着的以前没有、上车多出一个黑疙瘩），
                                       也就是 low 加上扶手、安全带、倾斜油缸耳座，没有 trim 砍掉的面。
                                       FE1Q J10：high / mid / lite / drvLow sprocket 12 棱、arc 6 段（链条搭在链轮上那半圈），low / lowb 8 / 4，min 0 / 0；停着的车和同档可动模型一样。
                                       给 high 可动模型腾面（1996 → 1998 / 2000）：high 档 beaconBase false（警示灯各档都是灯罩直接坐在后横梁上，y 2.10–2.175、底半径 4.5 cm、顶 3 cm，中心 (0, 0.53)）、
                                       plate 1（铭牌一道字）、grille 3（配重顶散热缝）、hitch 0（牵引销没有钳口）；去掉看不见的面：踏板朝里侧面、挡泥内板底边、fendU 档翼子板前头端面、开关拨杆顶面（开关 40 面）；
                                       后视镜镜片 = 镜壳后脸（镜壳不画 pz，镜片 9 × 10 cm 在 z −0.645，3 mm 缝没了）。
                                       FE1Q J11：停着的车和可动模型同样画 —— 外门架和内门架顶梁六个面（trim 档也画底面）、护顶纵梁 'all'、前后横梁 py / ny / pz / nz、横条补 pz / nz、缸口、杆头底面、
                                       挡货架立柱五个面、挡货架顶横梁和竖条四个面、驾驶位地台两侧面（trim 档不画前沿）、扶手 1 档顶端封口、配重下半截前脸（不分倒角档）、trim 档轮胎贴车架那面、min 链条背面。
                                       面数：停放档 high 1940、mid 1588、lite 1265、low 981、lowb 805、min 556（车号 88）；可动模型含开关和最多的磨损 high 1998、mid 1666、lite 1359、drvLow 1259。
                                       FE1Q repair-r1（圆的零件，验收员 play：方向盘、车轮、表盘一眼看出是多边形）：ring high / mid [16, 3]、lite / drvLow [14, 3]、low [12, 3]（lowb [6, 2] 照旧，repair-r2 改成 [12, 2]）；
                                       swHub high / mid 12；column lite / drvLow 10、low 8（没有中心盖的档转向柱顶封口当中心）；knob high 6；wf / wr high / mid / lite / drvLow / low [12, 1]、lugs（胎面一深一浅），
                                       lowb [8, 1] / [6, 1]（repair-r2 改成 [10, 1] / [8, 1]）、min [6, 1] 照旧；hub high / mid 12 = fkCone 矮圆锥（底圈贴在轮辋上、尖顶高 9 mm，光滑法线像个圆盖），hubR 各档 false；
                                       表盘 FK_GAUGE.n = 12 边 + 一根深红指针（K.needle，离表面 1 mm）。轮胎各档都是「胎面 + 内外两面 + 轮辋」一种做法（np 1）。
                                       high 腾面：spokes 2（一根横辐条）、straps / hose / tails false，加耳座底面、内门架立柱 / 底梁底面、翼子板中间那段底面（永远是背面）。
                                       停着的车（drive 不开）另省：胎面贴地那两段（外法线 y < −0.9）、后轮贴车架那面、链轮轴 pz（可见性探针 0 像素；可动模型照画）。
                                       后横梁 10 cm 深（z 0.48–0.58）、纵梁伸到 0.58（警示灯底圈落在横梁上；forklift.js VINE_GUARD 同步）；high 扶手顶端封口；low / lowb 倾斜油缸顶端封口；min 链轮方块补底面。
                                       面数：停放 high 1901、mid 1661、lite 1363、low 1073、lowb 793、min 552；可动模型含开关和最多的磨损 high 1993、mid 1773、lite 1491、drvLow 1391。
                                       换档（101 个种子 × 5×5 块）：高画质 181 台停着的车换档 29 台（lite → low 22），低画质 low → lowb 4 台（方案 risks[11] / [26]）。
                                       FE1Q repair-r2（验收员 play）：表盘 FK_GAUGE = { n 12, r 0.045, pos [[0.25, 0.5], [−0.335, 0.5]]（斜面上的 [x, f]）, needle }：以前 x ±0.13 正好在
                                       司机眼点 (0, 1.8, 0.16) 看方向盘轮圈的后面（表心在盘面上离中心 0.1585、轮圈 0.144–0.176），指针整根被挡；挪到轮圈外面（最靠里的点离中心
                                       0.190 / 0.242）。仪表板黑板宽到 ±0.39（左边那块落在板上）。lowb ring [12, 2]、wf [10, 1]、wr [8, 1]、lugs；trim 档（lowb / min，只有停着的车用）
                                       不画气瓶压进配重的底棱面（fkTube 新选项 skipN）、方向盘辐条底面（stick 新参数 skipN）、挡货架顶横梁底面（各 2 面，停着永远是背面）。
                                       面数：停放 lowb 793 → 839、min 552 → 546，其余不变。换档（101 个种子 × 5×5 块）：高画质种子 80 (−2,1) lowb,lowb → lowb,min；
                                       低画质种子 87 (0,−2) lowb,lowb → low,min；种子 12345 不换档（(2,−2) 两台 lowb 低画质每台只剩 840.5 面，lowb 不能超过 840）。
                                       FE1Q repair-r3（验收员 play：min 停着时方向盘六段扁框、车轮六边形、没有灯盒和起升油缸）：min 不再当停放档 —— buildForklifts 里所有台按
                                       FK_PARK_FLOOR（'lowb'）都放不下时从最后一台起改成运行时车（工坊、非工坊同一条；账面照旧 n × FK_NOMINAL），剩下的照旧挑档。
                                       换档（101 个种子 × 5×5 块）：高画质种子 80 (−2,1) lowb,min → lite,运行时车；低画质种子 87 (0,−2) low,min → low,运行时车、
                                       70 (−1,−1) lowb,min → low,运行时车；别的块逐位不变（golden 25 块不变），停着的 min 0 台。FK_LOD.min 留着（forkliftModel / 测试照样能建）。
                                       tests/forklift_l1.mjs polish J11 parkShut（停放 6 档 + 可动 4 档，140 个站立 / 坐姿眼点往 15 类零件里连线 0 漏光）、后视镜（15730 条视线 0 漏光）、H4b 停放 6 档
ladder                                 FK_LADDER：停放档的挑档顺序 { high: [...], low: [...] }
gauge                                  【FE1R 起：边数 FK_GAUGE.n = 20（K8）；repair-r2 起表盘画在叉车图集里，是真圆 + 指针，见 15.13】
                                       FK_GAUGE（只读，FE1Q repair-r2）：表盘的边数、半径、在仪表台斜面上的位置 pos[g] = [x, f]、指针方向；tests/forklift_l1.mjs polish 查驾驶座看得见指针用
dashSwitch(b)                          FE1P H3：停着的车那份仪表台大灯开关（拨杆扳在出厂的「开」、指示灯熄着的暗绿，全在 kit:prop；FE1Q 起拨杆顶面不画，40 面）；
                                       和 vehicles.js buildSwitch 同一份几何（常量 FK_SW = vehicles.js 的 SW_*，boxTN 的 noTop），polish H3 拿 BR.vehicles._switchGeo 逐个三角形比对
belt                                   【FE1R 起：停放 high / mid / lite / low 和可动 high / mid / lite / drvLow 各档同一份 fkBelt（K3：low 也有，停着、开过逐像素一样；K9 扣头顶上黑插口 + 红按钮），
                                       下面「low / lowb / min 停放档没有」是 FE1P 时的说法】
                                       FE1P H2：FK_BELT（只读）安全带各件在车本地坐标的盒子 { retractor, strap, tongue, stub, buckle }：没扣上、被卷收器收着 ——
                                       靠背右侧卷收器（出口朝下）、带子 4.4 cm 宽竖直垂到 1.115、锁舌在坐垫右侧面外 1 mm；左边短带落在发动机盖顶面、顶着扣头。
                                       停着的 high / mid / lite 和可动模型各档同一份 42 面（low / lowb / min 停放档没有，上车换成 lite / drvLow 后出现）
                                       FE1P 其余：FK_LOD.lampF 各档统一画底面、两侧、朝前、朝司机 5 面（H1；顶面 1.94 m 比谁的眼睛都高不画，min 没灯）；
                                       链条（H5）一根绕过链轮顶上 —— 前段从货叉架挂点上到链轮、外表面搭过链轮上半圈（FK_LOD.arc 段，按所在链节着色，两侧扇面）、
                                       后段下到外门架锚座；FK_LOD.links 是节距（high / mid 0.05 m 一深一浅的链板，前后两段都有；其余 0），sprocket 两端面都画（FE1Q J10：high / mid / lite / drvLow 12 棱、搭在链轮上 6 段，low / lowb 8 棱 4 段）；
                                       geo.sprocket.y 2.09 → 2.084（链条最高点 = 2.125 = mastInner OBB 顶）；drive 模型链条顶点数和 lift 无关（落在链轮上那一节缩成一点占位）
driveTier(quality, parkedTier)         【FE1R 起（K3，以这一条为准）：低画质一律 'drvLow'；高画质停放档 high / mid / lite 照用，low → 'drvLow'（和 low 停放档同一份几何），
                                       parkedTier 为 null（运行时车、本机没建过原区块）→ 'mid'。下面是 FE1Q 时的说法】
                                       开过的车用哪一档：低画质一律 'drvLow'；高画质 = 停放档，比 lite 粗（low / lowb / min）用 'lite'，
                                       parkedTier 为 null（本机没建过原区块：队友开过来的车、运行时车 —— 出生块里的车（保底车和本来就生成的车，FE1Q J2）、按 lowb 都放不下的车（repair-r3，含工坊））用 'mid'。lowb、min 永远不会出现在开过的车上
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
叉车（FE1）：`tests/forklift.mjs`（按 `--group data|mount|drive|crash|side|lift|items|exits|life|pause|nightmare|dark|perf` 分组，能并行跑；side 是 repair-r1 加的 sideObs 用例）、`tests/forklift_l1.mjs`（叉车模型顶点哈希、drive 模型、出生保底、overhead / vines，支持 `--tag` / `--against` 快照和 `--quick`）、`tests/forklift_probe.mjs`（只读探针，all.mjs 列在 SPECIAL 里不自动跑）；联机用例在 `tests/coop.mjs`（假 room.php），手机键位在 `tests/mobile.mjs`。
FE1P 打磨（主会话裁定 H1–H15）：`tests/forklift_polish.mjs`（`--group light`：车头顶墙 / 货架大灯不透墙、逐帧光球、远端车；`vine`：藤蔓贴着护顶 0–1 cm、逐位恢复；`coop`：客机开车房主那边 lift 不往回掉；
`--old` 用 FE1 提交的三份文件跑反证，light / vine 应该 FAIL），all.mjs 登记成 forklift_polish（light,vine，截图类）和 forklift_polish-coop（失败等负载降下来单独重跑）两项；
`tests/forklift_l1.mjs --only polish`（H1 灯盒视线、H2 安全带、H3 开关和载具层逐个三角形比、H4 低机位、H4b 站着 / 坐着的眼高看配重下半截和地台下面（返修 r1）、H5 链条、H12 断电新载入区块）；
返修 r1 另加：`tests/infection.mjs` h2b（抡的时候往前扑）、h6（真键盘按住 W 走 12 s 甩不掉悲尸，≥7 次）；`tests/mobile.mjs` DR9 从待机中心往上 0–90 px、左右 ±30 px 和摇杆区上沿按下推满，DR9b 摇杆区上沿；
`tests/forklift_polish.mjs` coop 组 C3 在房主那边包一层 BR.vehicles.setPose 逐次记 lift；`tests/items.mjs` 糖果袋倒平、支撑全在袋身上；snap 记录多了 geoNoFk（去掉叉车段以后的几何哈希）。
返修 r2 另加：`tests/forklift_l1.mjs` polish H1c（可动模型 4 档，车侧站着看外门架顶梁两头、驾驶座看护顶纵梁 / 横梁 / 横条、起升油缸缸口、杆头底面、挡货架立柱顶、扶手顶端都是实心的）；`tests/mobile.mjs` DR10（开车时长 toast 不压触屏键、待机摇杆、开车提示框）、DR7b（下车以后摇杆区恢复）、DR9c（横屏开车不收摇杆区）；`tests/all.mjs` forklift-items 超时 120 分钟（别的叉车组仍是 45 分钟）。结构基线：`node tests/golden.mjs`（对入库基线）和 `--against <开工前打的快照>`，FE1 要求 26 层加 coopcamp 逐字节不变；营地另用 `node tests/camp.mjs --against N1-final`。
FE1Q（主会话裁定 J1–J13）另加：`tests/infection.mjs` h7（笑魇脸最大那一帧 = 扣血那一帧，±1 帧；57 项）；`tests/forklift_polish.mjs` vine V1–V3 同时量挡体和可动模型三角形、V5 挡体对得上可动模型、light L7–L11（lightAt 和画面一致、司机座位算亮、货架通道照得远）、`--before <目录>` 反证；
`tests/forklift_l1.mjs` polish J2（真进游戏：出生车运行时、mid / drvLow、开过同一个 sig）、J11 parkShut 和后视镜、H4b 扩到停放 6 档、H5 / J10（≥12 棱、≥6 段），snap 加「J2 出生块去掉叉车段以后别的段逐字节不变」；
`tests/smoke.mjs` 防化服低画质加面罩框、滤罐；`tests/visualhooks.mjs` 低档白名单放开 skin_stealer 伪装的 gear；`tests/mobile.mjs` DR9d、se1-l 和 toast-short（A3c–A3e）；
`tests/coop.mjs` V.blkHitAt / V.laneBlk（甩货直道跳过碰出口圈 / keepClear 的，V13 多一项核对，194 项）、V8 等准心提示变成「上车」再按；`tests/forklift.mjs` F.exitHit（chockLane 同一规则）、L9 用 `_geom.vineHit`。
`tests/all.mjs`：mobile 超时 50 分钟；forklift_l1 有 `tests/output/golden-tags/FE1P-final/forklift_l1.json` 就 `--against FE1P-final`，没有才用 FE1-before。入库基线 `tests/golden/1.json` 按 FE1Q 的 L1 重拍（J12，只有叉车四块的网格顶点数变）。
FE1R repair-r2 另加 / 改：`tests/forklift_l1.mjs` polish「同向共面」（停放 4 档 + 可动 4 档三角形两两比，法线同向、平面距离 <0.1 mm、重叠 >1 mm² 的对数 0）、K8 段数多查助力球 ≥10 / 前轮轮毂盖（图集 uv）/ 车号两边都喷、「图集里的表盘和轮毂盖最近机位一个纹素 <1 px」、表盘指针按图集取点；K3 逐像素比的车按新普查换成 157 (2,−1) lite、27 (−2,−2) low（停车那一段把区块动画 `c.tick` 停掉：出口圈的脉动从门架缝里透出来不算车上的差别）；K3FIX / EXTRA_BLOCKS 按 census-r2 加了 9 块。`tests/infection.mjs` k 组：出生点按怪的网格整个在车外挑、有链的怪每个方向 3 个摆动相位（`--phases`）、扣血那一帧记插进人的是哪根骨骼、扑人 / 伸肢体的怪「有东西托着」那一项。`tests/forklift_polish.mjs` L9 改回 J9 原文判、k2 墙后暗不算同一排货架那一条里的地。`tests/mobile.mjs` DD1 / DD2 / DD3 跟着电脑开车提示的新顺序（「空格 下车」在最后，每个「·」到下一段键帽一样宽）。`tests/forklift.mjs` life M4 目标签名的杆数按 `BR.L1forklift.lod.high.levers` 取（以前写死 1）、perf G5 找停放 lite 的车先看种子 157（27 那台换成了 low）。
FE1R repair-r3 另加 / 改：`tests/infection.mjs` k 组新增「站得稳」（`K.balance`：扑上车的怪趴在车上的每一帧顶点重心在着力点凸包里 ≥3 mm，搭在车身上又站不稳的每次连着 ≤9 帧）；`tests/smoke.mjs` 坐车人形的滤罐颜色在没有程序化端面圆心顶点时改量罐身侧面、金属件也认 glb 的 #b9bec4；`tests/coop.mjs` 跨很多帧的 `__v.hold` / `untilStop` / `accelTo` 改成 `evRun`（页面里 `__v.run` 开始、马上返回一个号，测试这边每 250 ms 用很短的 page.evaluate 取结果，页面里墙钟上限 180 s；以前一个 page.evaluate 等到底，机器忙时 rAF 一秒一两帧，V5 / V6 必超 EV_TIMEOUT 45 s 整步记「流程未中断」）。
FE1Q repair-r1 另加：`tests/forklift_l1.mjs` polish「圆的零件」（方向盘轮圈 / 轮胎 / 轮辋 / 轮毂盖 / 表盘按顶点量棱数）、parkShut 加警示灯罩和 high 档扶手顶端、H1c 加 high 档扶手顶端；
`tests/forklift.mjs` life F4b–F6b（区块里停着的车 1@1,0#v0：开走 → 走到 loadR + 3 块外卸块 → 回来 / 换层回来，重建的区块里原位置那段又藏掉）；`tests/smoke.mjs` 防化服形状和 glb 比（≤15%）；
`tests/mobile.mjs` D11b 触摸拖动两回都没滚起来记 SKIP；`tests/all.mjs` mobile 首次失败（没有页面报错）时低负载只重跑挂了 / 记 SKIP 的设备、按重跑判。入库基线 `tests/golden/1.json` 和 FE1P-final 两个标签按 repair-r1 重拍（只有 L1 叉车三块的网格顶点数变）。
FE1Q repair-r2 另加：`tests/forklift_l1.mjs` polish「表盘指针从驾驶座看得见」（司机眼点左中右往每根指针上 7 个点连线，先碰到的都是指针；停着的 / 开过的 high、mid）、
「圆的零件」加 lowb（轮圈 ≥12、前轮 ≥10、后轮 ≥8）和后轮；`tests/forklift_polish.mjs` coop 组：J2a–J2f（客机低画质：出生车两边都是运行时车、mid / drvLow，
客机开车两边位姿一致、(0,0) 不用藏段，下车 levelState 记下；以前只在整合员的一次性脚本里），C3 每一趟先下车、levelState 摆回同一个起点再上车，升降 / 开车按模拟时间等，
升不到 / 没开动重摆重来一次、还不成立记 SKIP（汇总「跳过 N 项」），没开动时 detail 带客机逐帧的输入、phase、车速；`tests/coop.mjs` 7「两人同时捡同一件」
等 B 的请求在房主那边批下来以后 A 才松手，A 先进了拖动 / 等不到批下来记 SKIP（只查不复制），V8 上车前 player.reset + 显式对准车身、每秒重对一次，没对上记现场（V.aimDiag）；
`tests/all.mjs` mobile 超时时首次日志里跑完、没有 FAIL / SKIP 的设备照旧算，其余设备低负载单独重跑、按重跑判（以前超时直接记失败）。
FE1Q repair-r3 另加：`tests/forklift_l1.mjs` snap「停着的车不再是 min 档」（所有块没有停着的 min；MINFIX 三块是 [停着的车, 运行时车]；整块 ≤10000 / 8000；运行时车只排在块的最后）、
出生 3×3 以外的 EXTRA_BLOCKS（种子 80 (−2,1)、87 (0,−2)）也拍进快照；polish「坐着的人脚踩在地台上」（repair-r2 写的检查；js/net/coop.js 坐姿 SEAT_THIGH 1.236、整个人往车头挪 SEAT_FWD −0.05：靴底离地台顶面 3 mm，靴跟离发动机盖前脸 1 cm）；
`tests/all.mjs` lowRetry 的项（coop、polish coop 等）首次通过但记了 SKIP 时也进低负载补测、整项重跑，补测还记 SKIP 算失败；
`tests/coop.mjs` step() 中途出错以后松开两页的按键（CDP 键盘 + 派发的 keyup）、摘掉 V6 钉住的测试人、还原「切后台」改写和暂停，后一段从干净的状态开始；
V14b / V14c 结尾和 V11 前客机重新上车改用 remountGuest（照 V8：standAim、等准心提示变成「上车」再按，没坐上再来一遍，失败记 aimDiag）。
`tests/all.mjs` 里叉车各组超时 45 分钟（items 组 120 分钟），失败 / 超时先不判、等这一轮别的项跑完机器空下来单独重跑一次再判（`--jobs 1` 时紧接着重跑）；forklift、coop、mobile、kit、interact 都是先打印汇总、`browser.close()` 最多等 10 s 再退出（Chrome 的 crashpad 占着管道时 close 会卡好几分钟）。
mobile DR8（进层马上上车，「发动中」和大标题不叠）先重播一次大标题保证前提成立，前提没了（机器太忙、大标题在提示出来前就自己淡完）记 SKIP，不算通过。

## 14. 创意工坊与设置（2026-09-13 新增）

需求、数据格式、钩子与界面约定见 **WORKSHOP.md**。要点：`BR.workshop`（js/game/workshop.js，地图数据 + 本机存储 + 钩子，未激活时所有钩子为空操作）、`BR.workshopUI`（js/ui/workshop.js）、`BR.settingsUI`（js/ui/settings.js）；
`game:start` 新增 `workshop` 字段；`_kit.js` 的 gridWalls / exit / Builder.finish 各有一个工坊钩子；`audio.js` 新增 `setAmbientVolume`、`setSfxVolume`；`coop.js` 新增 `setVoiceVolume` 与 `workshopMap` 同步（2026-10-03 核对时发现 coop.js 里其实一直没有 `setVoiceVolume`，滑条不起作用；2026-10-05 补上：`BR.coop.setVoiceVolume` + `BR.net.setRemoteVolume`，iOS 走 GainNode，设置面板启动时和 `coop:connected` / `coop:reconnected` 时各推一次，见第 12 节 BR.coop / BR.net）。
N1 起工坊地图联机从帐篷「我的地图」进（地图信息卡上不再有联机按钮），见 WORKSHOP.md 第 7、8 节和本文第 9.7 节。

## 15. 载具与叉车驾驶（FE1，2026-10-06 叉车驾驶提前版）

孩子的话：「叉车能开能举东西」，道具用途要「特别合理，有一点不合理就不行」。家长 2026-10-06 拍板排在联机营地 N1 之后马上做。方案原文：`backrooms-research/plans/2026-10-06-forklift-early-plan.json`（`plan.stages` 的 FE1 / FE2，`playerSpec` 是叉车的「特别合理」检查清单，覆盖 2026-10-02 道具方案里叉车条目和 F1 / F2 的写法）。
FE1 交付：能开、能升降货叉、单机时货叉上能放瓶罐、两人联机；FE2 交付：叉起托盘货、运走、放到地面 / 货顶 / 货架横梁上。**FE1 全部是运行时或纯数据改动：26 层加隐藏层 coopcamp 的 golden 逐字节不变**（停着的车几何、碰撞框、账面、取随机数一律不动）。

### 15.1 操作（家长定死）

- 准心对准叉车 + 空格短按上车；坐上去以后 W/S 前进后退、A/D 打方向（后轮转向）、按住 R 升货叉、按住 C 降货叉（R、C 是键盘上开车专用的键，只在车上有效）；任何时候空格短按下车。F 使用照常（吃喝、用药；火盐、瓶装闪电这类要扔出去的坐在车上扔不出去，FE1R F5），背包照常切；坐着捡不了、丢不了东西，冲刺没用。
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
  sim.lightSpot() → { x, y, z, range, color, intensity, flicker, decay, owner }（world.setExtraLights 的格式）
      FE1P H8：range / intensity 是画面上那盏灯用的，已经收过、补过；FE1Q J8 起不再给 litRange / litIntensity（world.lightAt 也按画面上这盏灯算）。见 15.11
  sim.lightInfo → 上一次 lightSpot 的 { range, intensity, R0（不管墙的名义范围）, seatLit, bound, hit, by: { kind: 'wall' | 'hit' | 'noclip', key, box } }（调试、测试看光球被哪一样收住）
  sim.litSeat(x, z) → number（FE1Q J8）：(x, z) 在驾驶舱矩形里（本地 |x| ≤ 0.4、z −0.5…0.55）且车灯开着时返回 lightInfo.seatLit（≈ 0.338），否则 0；world.lightAt 和光球那部分取大的
  sim.vines（FE1P H9）：每根藤蔓的状态多一个 touch（这一帧被车顶着：新碰上、被推开、靠在上面）；BR.forklift.config.vine = { reach: 4, back: 1.2, pad: 0, head: 0.15 }
  sim.vineVolumes(seated, tier?) → { boxes, caps, cyls, polys }（FE1Q J3 藤蔓挡体，见 15.11）；BR.forklift._geom.vineHit(V, x, y, z) → 包住这一点的挡体名字 | null（测试用）

BR.vehicles
  list() → [{ key, x, z, y, yaw, steer, lift, spd, lever, on, driven, meshed, seat, tier, n, runtime, physKey }]；byKey(key) → 内部记录（只读）
  seated                               本机坐着的车 key | null；handle：交给 player.mount 的那个对象
  mount(key) → bool；dismount(side?) → bool；forceExit(reason)
  cabFor(playerLike) → 世界坐标驾驶舱矩形 { cx, cz, hx, hz, rot, minY, maxY, … } | null；chestOf(playerLike) → { x, y, z } | null
  seatWorld(key) → { x, y, z, yaw } | null（坐垫顶面中心）
  dropSurface(x, z, r, type?) → { y: 叉面, veh, tine: 0 左 | 1 右, side, x, z } | { full: true, y, veh, tine, side, room?: 'heel' | 'tip', gx?, gy?, gz? } | null（见 15.8）；attachItem(id, veh) → bool
  setPose(key, pose, { remote }?) → bool   remote = 队友在开（会顺手升格、挪 'veh|' OBB）；不带 = levelState 回放；本机正坐着的车不理
  update(dt)；applyChunk(c, st) / unloadChunk(c)（world 建块 / 卸块调，幂等）；clear()
  debugInfo() → { promoted, meshes, calls, tris, perVehicle, tiers: { key: tier }, lease, riders, obbs, seated, phase, light, loops, falls, throws, throwMs, throwBusy, … }（甩货那几项见 15.4）
  _step(dt, { throttle, steer, lift }, key?) → pose   测试口：直接给模拟一步输入（不走 BR.input、不管起动阶段），网格、riders 一起更新
  _switchGeo(hl?) → [[x0, y0, z0, x1, y1, z1, x2, y2, z2, 材质, r, g, b], …]   测试口（FE1P H3）：载具层画的大灯开关，拨杆按 hl 转好、车本地坐标；
                                       和 BR.L1forklift.dashSwitch 比对（几何逐个一样，只有指示灯在 kit:glow、颜色是亮着的绿）
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

- **停着的车不动**：没人开过的叉车仍合并在区块网格里，碰撞框、账面不动（几何按 FE1P H1–H5、FE1Q J10 / J11 的裁定改过：只有叉车自己那几段变，去掉叉车段以后逐字节不变）。第一次有人上车、或者收到队友的 `net:veh` / levelState 记录，才**升格**：
  `kit.hideSpans` 把区块里这台车的顶点段（`spans.prop` 加 `spans.wear`）叠成一点，车下的地面油渍 `spans.oil`（FK_WEAR[0]）不藏；再用 `BR.L1forklift.model`（`drive: true`）按部件把它建进全层共用的载具网格。升格后的车状态存 `levelState.vehicles`，不再依赖原区块（bus `'vehicle:promote'`）。
- **出生块里的车**（`runtime: true`，不进区块几何）：出生保底车，以及 FE1Q J2 起 L1 正常生成时出生块 (0,0) 里本来就生成的车（种子 12345 的 1@0,0#v0 等；工坊地图不算）。一载入就直接以载具网格出现（高画质 mid、低画质 drvLow），地面油渍作为载具网格里不随车动的一段（`wear({ part: 'oil' })`）；
  孩子最先看到的那台停着、上车都是同一个网格（同一个 sig，例如 'mid|2|44|5|high'）。L1.js buildChunk 设 `b._fkSpawnRT`（条件和 bays[4].forceFk 一样），forklift() 出 runtime 记录、不进 fkQueue，
  占位累加器 FK_PH 照旧占 pend 面（前面的倒角 / 贴花判断不变，块里别的东西逐字节不变），buildForklifts 开头删掉占位、把账面和细节档退回去。联机两边都是运行时车，客机开它不用藏区块段。
- **共用载具网格**：kit:prop、kit:glow、kit:decal 各一个网格（低画质没有贴花），预分配、按需扩容，不挂区块 group，共用 BR.assets 的 kit 材质。不管几台车最多 3 个 draw call（低画质 2 个）。
  每台车用一个临时 `kit.builder`（区块外）按部件调 model / wear，部件前后各调 `b.mark()` 量出顶点段，拷进共用缓冲里属于这台车的一段。部件建模顺序：body、mastOuter、wheelsFront、wheelRearL、wheelRearR、steeringWheel、liftLever、mastInner、carriage、chains（链条放最后，按最大长度预留顶点，用不到的叠成一点）。
- **每帧按 pose 在 CPU 上变换顶点**：车身不动；前轮绕轮轴 (y 0.29, z −0.62) 滚；左右后轮各绕自己的主销 (±0.44, z 0.8) 转 steer 再滚；方向盘绕倾斜轴转 −steer × 6（司机看来逆时针 = 往左打）；内门架升 d、货叉架升 2d；链条按 lift 重写；升降杆绕 `geo.liftLever` 转 lever。
  只改动过的部件，只 `updateRange` 上传那几段；包围球按网格里的车实时重算（车全在身后时整块被视锥裁掉）。
- **熄火 / 着车**：熄火时 glow 网格里这台车那段的顶点色换成灯罩本色 × 0.35（不藏、不开洞）；着车时大灯镜面和警示灯罩点亮，警示灯 1 Hz 闪。
- **只放附近的车**：本机坐着的、玩家（联机加上队友）R+1 块以内的开过的车 / 保底车才放进网格；走远了释放那一段（状态和碰撞留着），回来按状态重建。
- **细节档**（`BR.L1forklift.driveTier`）：开过的车在高画质下 = 本机停放档，比 lite 粗就用 lite；低画质一律 drvLow（无倒角、无贴花、不砍面）；lowb、min 永远不会出现在开过的车上。
  **FE1R K3 起**：停放档只剩 high / mid / lite / low（lowb、min 删掉），停放 low 开过是 drvLow（两档同一份几何，停着、开过逐像素一样），档位按画质记进 levelState 车记录的 park（M-return），见 15.13。
  档位和磨损片数由各端按自己的区块数据现算：`applyChunk` 每次都记下 key → { 停放档, wearN }，**这两个值不进 levelState**（两端画质可以不一样）。本机从没建过这台车的原区块（队友开过来的、运行时车）用 mid（低画质 drvLow），磨损按 mid 档。
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
- **全速撞车掉货**（家长 2026-10 拍板；FE1 返修 r10 主会话简化重做 —— r2–r9 那套逐件排落点的算法整个删掉，BR.vehicles `computeThrow` / `planThrow` / `rowEval`）：
  「哐」而且撞前车速 v ≥ 2 m/s、往前开（stepSim：`bang && v0 >= THROW_V`）时：
  ① **每根货叉上的东西是一排**，同时顺着货叉方向往前平移：水平方向始终同速、彼此相对位置不变，不往两侧拐、不散开、不转向（偏航不变），一直到整排停下。
     两根叉各算各的；两根叉上的件横向有重叠（宽件）时合成一排（`planThrow` 按每件车本地 x 范围判断）。整排的位移 s(t) = D·σ(t)，σ(t) = 1 − (1 − t/Tr)²（匀减速、平滑停下）：
     初速 = min(v, √(2·0.4g·D))，减速度 2D/Tr² ≤ 0.4 g，Tr ≤ 1.6 s（`rowTime`）。叉尖前面没被挡住时 D ≥ v²/(2·0.4g)（见 ③），初速就是撞前车速 v，
     水平速度在撞上那一帧连续（返修 r12 裁定 A）；被挡住、D 缩短到不够按 0.4 g 从 v 减到 0 时初速才降到 √(0.8g·D)（撞上那一下货跟着顿一下，裁定 A 认可）。
  ② **翻下叉尖**（返修 r12 裁定 C 重写；「直立」一律指放得稳的静止姿态，见 15.8；「重心」= 看得见的重心 = 模型三角面按面积加权的质心，`typeShape` 的 `com`）：
     先按模型在叉面那一条（strips，外扩 2 mm）里的部分算**侧面下轮廓** η(ζ)（`lowTable`：三角形裁到 strips 里投到侧面，每 1 mm 一格取最低；ζ 相对 C 往车尾、η 比底面高多少）。
     **往前的支撑**：重心那一格离底面 ≤ 2 mm 就是重心本身，不然是重心前面离底面 ≤ 2 mm、最靠后的那一格；整排走了 sA（这一格到叉尖的距离）它就过了叉尖，前面没有托着的了，
     从这一刻（tA）起往前栽 —— 平底的瓶罐盒子就是重心过叉尖；PTG-B 按静止姿态指托下沿和针帽着地、中间的针管离底面 1–2.6 cm，针帽一过叉尖就绕还在叉面上的指托往前栽。
     **栽下去**（`pivotRun`，每 1 ms 一步）：靠着货叉时绕真正碰着的那一点转 —— 那一点是叉尖后面（还在货叉上方）的轮廓点里最低的一点（`LGat.zc`：平底是叉尖那条棱，
     PTG-B 先是叉面上的指托、针管落到棱上以后是棱），角加速度 = gc ×（重心离那一点的水平距离）/（k² + 重心到那一点的距离²），k² 是按模型三角面的面积分布算的回转半径²；
     重心的高度由「刚好贴着货叉」定：`Lt` 表存 LG(θ, a) = 倾斜 θ、C 离叉尖往前 a 时叉尖后面最低的轮廓点比 C 高多少 + 重心随倾斜的升降（θ 16 档 × a 每 2 mm）；
     底在这一段里是平的（离底面 ≤ 1.5 mm，一直到整件离开货叉时最后过叉尖的那一点）就不建表，按「底面所在的平面贴着棱」解析地算（`LGat` 的平底分支）。
     要贴着就得让重心比自由落体落得还快 → 东西离开货叉，接下来重心按 g 自由落、照原来的转速接着转（最多歪到 cap）；自由落的路上又碰上货叉 → 贴上去、这一下不再转（不弹）；
     碰着的那一点从重心后面换到重心前面（同时搁在两处）→ 也不再转；往回转到静止姿态就停住。歪得会超过 cap = min(`THROW_TILT_MAX` 0.3 rad，前端不碰地) 时
     `pivotSolve` 把 gc（靠着货叉转时的「重力」）收小到正好不超。所以东西要么真的靠着货叉转，要么整件按重力落，不会绕看不见的点慢慢转（验收员 play r12：以前「底面平面贴着棱」，
     PTG-B 针管离棱 2–4 cm 还按 0.4 g 慢慢转）。
     **托着它的那一截**只算横着落在货叉叉面那一条里的部分（`esTable`：模型每条边裁到叉面那一条里取两个端点，EsT[θ] = max(离 C 往后多远 − 高 × tan θ)；比底面高的部分也算），
     走过的距离 ≥ EsT(θ)·cos θ（或 `Lt` 表里叉尖后面已经没有点）就整件离开货叉，轨迹 mode 2 结束；mode 2 的倾斜和 C 的落差等分记在关键帧上（房主算、客机照着摆，按三次 Hermite 插值：自由落体那一段的二次曲线原样复原）。
     **碰着 / 离开货叉的那一刻切开**（返修 r14，验收员 play：以前整段压成 16 等分、点之间插值，2.05 m/s 时 PTG-B 跟在别的东西后面，尾部又碰上叉尖那一下的减速被摊到前一个点开始，
     离叉尖还有 4–8 mm 就慢下来）：`pivotRun` 记下每次又碰上（2）、碰着的那一点换边（3）、离开（1）的时刻和这一步重心竖直速度突变了多少，`finishPivot` 挑最多 `PV_SPLIT` 3 刀
     （又碰上、换边按突变从大到小，再按时间挑离开；离两头、彼此不到 0.5 ms 的不切；轨迹最多 8 个关键帧），翻下叉尖那段变成 1–4 个 mode 2 关键帧，每段在自己里面按时长分
     4–`PV_N`（32）等分、落差相对这一段开头 —— 速度突变正好落在段与段之间。房主发出去的关键帧时刻记到 0.1 ms、高度和两张表记到 1 µm（按 0.1 mm 取整时表里相邻两点只隔几毫秒，
     插值出来的重心竖直加速度在 ±0.6 g 之间来回抖：火盐、闪电瓶翻下叉尖那一小段 1/240 s 逐帧看忽快忽慢）。实测（repair-r14/probe/vp/pivot_v5_*.out）：验收员那一组
     （左叉闪电瓶 + PTG-B、右叉火盐 + 罐头 + PTG-B，PTG-B 针头朝叉尖）和另一组 6 件混装，撞前 2.025 m/s，1/240 s 细步长按网格质心看，离货叉、离地都 > 2 mm 的每一步竖直加速度 0.99–1.0 g
     （跨过碰撞那一刻的差分也不低于 0.8 g）；按 30 帧看时碰撞那一下落在两帧之间，跨过它的差分照样会小（那是真的碰了一下，不是空中慢下来）。
     离开以后**看得见的重心**竖直按重力落下（离开那一刻的速度接着，加速度 = g；FE1P H13 起 mode 3 的重心落差 = c1·w + c2·w²，c1 = 上一段 mode 2 末了**画出来的**
     重心竖直速度 × Tf（每段算一次缓存在 P.c3[k][2]），c2 = Dc − c1 ≈ ½g·Tf²；pivotRun 交出的 vG 按 1 ms 位置串的导数给（v + ½Δv，半隐式欧拉的位置串斜率比 v 大半步）——
     以前 3.9 m/s 的 PTG-B 在 mode 2 → 3 那一刻竖直速度差 4–5 cm/s，现在 18 种摆法都 ≤0.2 mm/s，tests/forklift.mjs I26b 盯着 ≤2 mm/s）；水平照样跟着整排；落下去的路上从 θa 起 θa·(1 + κw)(1 − w)² 回正（κ 接上翻下去末了倾斜得多快），
     C 跟着倾斜在重心下方，落地回到静止姿态（重心 = 落点 + gy），接着跟整排滑、一起停。落地的面：每 1/240 s 看重心正下方（`topAt`：地面、碰撞体顶面、sideObs 顶面），
     碰到就在那一步里按抛物线解出落地时刻。
  ③ **滑多远看车速**（返修 r12 裁定 A）：没被挡住时 D = max(最靠车那件此刻最靠车那一点到叉尖的距离 + L(v), v²/(2·0.4g))（`throwDfull`），
     L(v) = 0.2 + (v − 2)·0.3/1.9（夹在 0.2–0.5 m，3.9 m/s 及以上 0.5 m，`throwL`）是最靠车那件静止时离叉尖的**下限**：车越快滑得越远，实际位置按 D 的公式
     （撞前 3.9 m/s 约 1.5 m；真开到顶速约 4.4 m/s 时约 2.1–2.4 m）；其余各件按原来在叉上的间距排在它前面 —— 地上的摆法 = 叉上的摆法整体往前平移 D。
     整排停下仍 ≤ 1.6 s（撞前 3.9 m/s 约 1.0 s，顶速约 1.1 s）。
  ④ **前面挡住**（`rowEval`）：按真实外形查这一排每件的整条路 —— 叉面高度那段（`freeAlong`：模型的点沿 −z 打射线，一次算好走多远会碰上）、翻下去落下去那段
     （`sampleFall`：每 1/300 s 按顶点查，翻下去那一小段不查托着它的货叉；查碰撞的点 = 模型顶点 + 三角形的边按 PT_STEP 2 cm 加密，按 1 cm 一格去重 ——
     返修 FE1R · repair-r2：以前 3 mm 一格，K8-ui 把水瓶这类圆东西加到 20 段以后点多了约 2.5 倍、forklift timing T1 慢了 1.4 倍；圆柱面上相邻两点最多隔 ~1.7 cm，中间鼓出去 <1.5 mm，比 THROW_PAD 6 mm 小）、地上那段（`freeAlong` 从落地处起）—— 碰到墙 / 柱子 / 货架 / 别的车（phys.overlapOBB 收进来、
     换成车本地的盒子）、柱础侧面这些 sideObs（真实形状）、这台车自己的 14 个盒子、地上已有的物资就把这一排的 D **二分缩短到刚好不碰**；
     **同一排的别的件不算「前面挡住」**（返修 r13，验收员 play：左叉「闪电瓶在前、PTG-B 在后」只隔 3 mm，以前按物资之间的 4 mm 查，前件一往下掉、两件上下一错开就算压着，
     整排被自己的第一件「挡住」、只滑 22 cm 留在叉上）：整排同速，两件只会上下错开，`pairHit` 按截面凸包隔开 `PAIR_GAP`（0.5 mm）查（撞上那一刻就比这近的，按「不比那一刻更近」查，
     `pairGap0`）；先按侧面两个转过的矩形粗查，压着了再按顶点查截面；压着时先让后件、再让前件翻下去歪得少一点（各最多 3 次）。
     另外按类型量的「脚」（`footRaw`：dropSurface 排间隔用）改成按模型本身量、取直立和静止姿态里大的那个（`footShape`；以前量的是这个类型碰巧第一件当时的样子，
     第一件是浮着的就量成直立的，歪着的闪电瓶瓶肚子伸到后面那件上方）。扫描：32 种前件 × 8 种后件 × 24 个朝向 × 2.05 / 3.9 m/s、叉面 0.3 / 0.5 m、三件一排，
     叉尖前面空地共 25176 次规划 0 次留在叉上（tests/output/stage-FE1/repair-r13/probe/rowscanH*.out）；
     落下去和接着滑的那段必须在同一个高度的稳当面上（地面，或离地 ≤ 0.3 m 的矮东西顶上、整段滑动都在顶面内，放得稳 = 重心和静止姿态支撑凸包的每个顶点底下都是同一个面，`supportHull`，返修 r12），
     不然也缩短 D；整排停下时还挂在叉尖上（往前栽了、托着的那一截还没过棱）的 D 也不行。缩短以后**往前的支撑没过叉尖的件留在叉上**、停在往前挪过的位置
     （轨迹第一个关键帧带 onFork = 1，滑完 `attachItem` 挂回货叉），越过的照常掉下去。留在叉上的停下来也要放得稳（返修 r13）：`stableSlide` 按叉面那一条上的支撑凸包
     （离底面 ≤ 2 mm 的顶点 + 底边被叉沿、叉尖、叉根裁出来的点，叉尖跟着这一排往后挪）二分出最多能滑多远还让重心往里 ≥ 3 mm（`insetAt`），滑得比这远、又还没翻下去的 D 不行
     （撞上那一刻就不到 3 mm 的按「不比那一刻更悬」）。**不停在叉尖边上**（返修 r14，验收员 spec：只按上面那条，闪电瓶、火盐这种歪着靠稳的圆东西会停在 3 mm 的极限上 ——
     重心离叉尖 3–6 mm、瓶肚子约一半伸出叉尖外，靠底边和叉尖那条线的交点撑着）：`stableSlide` 同时要求看得见的重心离叉尖 ≥ max(`TIP_COM_MIN` 2 cm, 重心到这件最前端那段的一半)
     （`tipComNeed`；伸出叉尖的最多是重心前面那半截的一半，约整件的四分之一；撞上那一刻就不够的同样按「不比那一刻更近」）。滑完挂回货叉（`attachItem` keep）不再走 `centerOnTine`
     （以前包围盒中心出了叉尖 1.2 mm 就往车这边拉回 1.2 mm，逐帧检查报 back）。实测（repair-r14/probe/vs/staysweep_real.out，验收员的 staysweep / stayreal 指到现在的代码）：
     叉尖前 0.06–1.2 m 地上放一只罐头、300 组里 52 件留在叉上，支撑余量（裁剪凸包）最小 4.8 mm；闪电瓶 + PTG-B（罐头在 0.7 m）闪电瓶重心离叉尖 40.3 mm、最前端伸出 39.6 / 150 mm，
     只按顶点的凸包也有 5.6 mm；火盐重心离叉尖 49 mm、伸出 47 / 189 mm。叉尖顶着墙撞上：整排往前挪到碰墙为止、全部留在叉上；
     叉尖前面地上已经有上次甩下来的东西：这一排少滑一段，落不下去的留在叉上。查碰撞的点：模型顶点 + 三角形的边每 2 cm 一点（`typeShape`，按类型量一次）；
     物资和物资之间按模型自己坐标里每 1 cm 一层的水平截面凸包（外扩 4 mm）；和墙、柱子、车身横着留 6 mm、竖直留 2 mm（可以落在矮东西顶上）。斜放地牛那块 1 m 老碰撞体：
     路上跳过（按地牛的真实形状挡），静止处不许落进去（`inSkip`）。一次最多 40 件（`THROW_MAX`，多出来的 'stay:cap'）。
     `BR.vehicles._planThrow(key, v0)`（测试口，只读）返回这一次会怎么甩（list 带轨迹、how、每排 { D, Dfull, Tr, why, hit }），不摆不记。
  **车锁**：撞上到这几排都停下（`throwBusy`：`S.falls` 里还有 t < Tr 的；客机等房主回结果的 `veh.throwWait` 最多 5 s）车的行驶、转向、升降都锁住。按了油门 / 方向 / 升降时
  （`busyNote`，返修 r11）：这次有东西翻下叉尖（不是 onFork 的轨迹）还没停 → 「货叉上的东西还在往下掉」；一件都没掉（都留在叉上、往前挪了一段）而且还要锁 0.2 s 以上 →
  「货叉上的东西还在往前滑」；更短（叉尖顶着墙，只锁几帧）不提示；客机等房主回结果那一会儿照多数情况说「还在往下掉」。
  **撞上那一帧**：本机司机的模拟在 player.update 里跑（`driveUpdate` → `stepSim` → `throwRiders` → `applyThrow`），东西摆到轨迹起点（撞上那一刻的叉面位置）就等于跟着车走完了这一帧；
  同一帧后面 vehicles.update 的 `stepFalls(dt)` 只让这些新轨迹再走「这一步里撞上以后剩下的时间」（stepSim 按车这一步实际走的路和按撞前车速该走的路之比算，fall 记 skip / adv；
  返修 r11：以前整整再走一帧，撞上那一帧往前「窜」到车速的 1.7–2 倍）。测试口 `_step` 撞上那一步也一样（返修 r13：`stepFresh` 马上走掉这一步剩下的时间，
  以前测试口这条路上撞上那一帧只走到撞上那一刻、看着「顿一下」，「撞上那一帧速度连续」查不了）。实测坐车真开全速撞车轮挡（返修 r13，见 repair-r13/probe/framestep.out）：左叉 4 只罐头（按 Q 丢上去）、叉面 0.5 m、撞前 3.9 m/s，罐头每帧水平挪 12.75 / 13.0 cm → 撞上那一帧 12.9–13.0 cm → 12.4–12.6 / 12.1–12.2 / 11.6–11.7 / 11.2 cm …，平滑往下减（每帧少约 4.4 mm，即 0.4 g），约 1.0 s 停下；空中看得见的重心竖直加速度 0.98–1.01 g（独立的逐帧尺子，verify-play 的 r13_throw.mjs 指到现在的代码上跑）。
  房主替客机算的、客机照房主摆的都从消息回调里来，不跳这一帧。
  落地静静躺着（still），按放得稳的静止姿态最低顶点贴住（`liftOfType` = −`items.rest(type).bot`；PTG-B 原点在最低顶点上方 5.1 mm）；落地松手写进本层状态（丢弃物）：
  静静躺着的丢弃物那条多记朝向 `[x, y, z, type, count, rotY]`（返修 r12 裁定 D；levelState 的 drop 校验认第 6 项），换层回来、联机另一边（levelState 'st' / 'set'）按记的朝向静静摆回去；
  旧格式 5 项照旧能读（浮着转圈、朝向按 id 定；老存档里甩出去的由 `relayLying` 让它躺下）。
  慢慢碰上（「咚」）、2 m/s 以下的「哐」、倒车撞上不甩；叉底过 0.5 m 限速 1.0 m/s、过 1.5 m 限速 0.6 m/s，举高了开不到 2 m/s 不甩（边开边按 R 撞上时叉面最多约 0.7 m，照样甩）。
  **轨迹格式**（`validPath` / `segAt` / `pathEval` / `applyThrow` / `stepFalls` / `placeFall`）：`[[t, x, y, z, mode]…]`（世界坐标，x / y / z 是直立时的原点，≤ 8 个关键帧、5 s 以内），
  第一个关键帧多带 `[cn, lift, Tr, onFork, H, gz, gy]`（倾斜时绕包围盒中心下面那一点 C 转、原点比模型底面高多少、这一排停下的时刻、留在叉上、模型包围盒高、
  看得见的重心离 C 往车尾多远 / 比底面高多少 —— 返修 r12，对方旧版没有 gz / gy 就按包围盒中心）；有 Tr 时每一段的水平位置按 σ(t) 走（整排同速），
  mode 0 贴着叉面 / 地面滑、2 翻下叉尖（关键帧多带 `[θ 表, C 的落差表]` 两个同样长的数组（5–33 项，返修 r14 起按碰着 / 离开货叉切成 1–4 个 mode 2 关键帧，落差相对上一个关键帧；返修 r12 时是一个关键帧、17 项），按 w 三次 Hermite 插值；没带表的老轨迹按竖直 w²、倾斜 atan(往下掉了多少 / 离棱走了多远)）、
  3 离开货叉以后重心按重力落、1 老轨迹（只给落点）。
  `debugInfo().throws` 最近 256 次 `{ key, v0, list: [[id, x, y, z]…], at, by: 'me' | 'peer' | 'host', id, how, dur, off, kf }`（id：联机时这次甩货的编号，单机 null；kf（返修 r14，测试用）每件轨迹关键帧的 `[时刻, mode]`；
  另有 `debugInfo().fallT` = 正在甩的每件 `[id, 走到轨迹上的时刻]`）：`how` 每件 `[id, 'fwd' | 'stay:blocked' | 'stay:surface' | 'stay:stuck' | 'stay:cap' | 'stay:error', D, Tr, 挡着的是什么]`
  （留下的原因是这一排走满 D 时碰上的：blocked 碰到东西、surface 落点不稳 / 太高、stuck 挂在叉尖上；第五项 'solid' / 'side:plinth' / 'car:forkL' / 'item:<id>' …），
  `dur` 最后一件落地 / 停下的时刻，`off` 车锁了多久（最晚停下那一排的 Tr）；一件都没动也记一条（list 为空）。`throwMs` 最近一次算用了多少毫秒；
  `BR.vehicles._benchThrow(key, v0, n)`（只读）按这台车此刻货叉上的东西算 n 次取中位数（测试要求 ≤ 8 ms）。
  实测（SwiftShader，返修 r12；r13 的 I19v 复核）：叉底 0.3 m 撞前 3.9 m/s 一根货叉 4 只罐头 D 1.94 m、Tr 0.99 s（最靠车那只离叉尖约 1.5 m：1.94 − 撞上时离叉尖 0.43 = 1.51），撞前 2.05 m/s D 0.64 m、Tr 0.62 s；两根货叉各 10 瓶水全速 D 1.94 m。
  算一次（返修 r11 提速：同一排两件先按侧面轮廓的凸包 `profHull` 查压不压 —— 比包围盒矩形紧，瓶颈、罐头圆边那里不再按点细查；`esTable` 先按高度每 1 mm 一格收最靠后的点；
  segAt 的 θa、κ 每条轨迹每段只算一次；返修 r12：平底的翻下叉尖按牛顿迭代 / 解析的 LG，`lowTable` 只给不是平底的建表）：两根货叉各 10 瓶水全速约 4 ms、2.05 m/s 约 3.5 ms，
  左叉两支 PTG-B 约 3–5 ms（负载 1–2）；返修 r13 加了留在叉上放得稳的二分（stableSlide）和同一排两件撞上那一刻的间隙（pairGap0）以后，负载 2.9 / 8 核时 20 瓶水 6.0 / 4.9 ms、两支 PTG-B 1.2 / 1.0 ms、_step 0.10 ms。每件物资第一次被甩时 `typeShape` 要量一遍外形（单次约 10–30 ms），之后按类型缓存。
  返修 FE1R · repair-r3（验收员 play / tests / spec：K8-ui 把水瓶段数加多以后 T1 比 FE1Q 慢 1.4 倍，1 cm 去重没起作用 —— profile 下来大头在 lowTable，其次是每件的 prepItem）：
  `prepItem` 里只跟「种类、朝向」有关的那块（`prepGeom`：模型点换到车本地、包围盒、重心、支撑凸包、回转半径、侧面轮廓）按「种类 | 朝向矩阵逐位一样」在一次甩货里共用；
  esTable / lowTable 按「种类 | 朝向 | 叉面那一条相对原点」共用；lowTable 三角形按最低点从低到高处理、轮廓已经比它整块低的跳过（跳过的本来一格都改不了，表逐位一样），
  处理顺序按「形状 + 朝向 y 那一行」缓存（立着、只绕竖直轴转的一排水瓶共用一份）；Lt 表每档倾斜从上一档的顺序接着插入排序（以前每档从头 sort）。
  T1 低负载（1.9–2.7 / 8 核）连跑 3 次：全速 5.6 / 6.2 / 5.6 ms、2.05 m/s 4.8 / 4.6 / 4.5 ms，全量 all.mjs 的 forklift-timing（负载 3.6）5.6 / 4.7 ms（改前 6.9–7.8 / 6.0；FE1Q 的 HEAD 约 5.0）；T2 0.8–0.9、T3 0.13 ms。forklift-items 190 / 190。
  **联机**以房主为准：房主（单机）司机本机算、摆、写，再 `coop.emit('fkthrow', { k, list, id, p, v0 })`（list 每件 `[id, x, y, z, path, rotY]`，path 见上面的轨迹格式；
  rotY 是撞上那一刻它的朝向（甩货不改偏航），客机 `applyThrow` 先转到这个朝向再摆（返修 r13：以前不带，两边靠各自按同一 id、同一放法摆出来碰巧一样；对方旧版没有第 6 项就照本机的）；
  id = `'h' + 房主页面载入时随机生成的一串 + ':' + 序号`，返修 r11：以前只有 'h' + 序号，房主刷新页面以后从 h1 重新数、客机记着的旧编号又不清，前几次的结果被客机当成摆过的丢掉）；客机司机不自己算，`coop.use('k:' + 车, 'fkthrow', 眼睛, cb, { v0, x, z, yaw, lift })`，
  房主（`onThrowUse`）按客机报的撞停位姿（离房主看到的 ≤ 1.5 m）算、摆、写，回复 `{ ok, r: { k, list, id, p, v0 } }` 的同时再广播一次 'fkthrow'（同一个 id）；
  客机（`onThrowResult`）回复和广播谁先到用谁、按 id 只摆一次（记着的编号开新局、回主页、'coop:connected' 时清空；回复到了不管是不是已经按广播摆过，都清掉这台车的等待）；车已经解锁了才到（coop.use 等满 4 s 没回应先解锁、回复被丢掉，广播照样到；或者过了 5 s）：不再播动画 —— 甩到地上的直接摆到终点，
  留在叉上的按撞车那一刻的车位姿 p 换成车本地、挂回现在的货叉（返修 r10，验收员 play r10）。
  测试（tests/forklift.mjs items 组）：I12 / I12c / I12d / I12e / I17b 撞车轮挡往前翻下去；I12f / I12g / I12h 撞上马上升降 / 倒车：整排停下以前车和货叉不动；I19（2 / 4 / 8 件全速）、
  I19 低速（2.05 / 2.1 m/s，L 比全速近）、I19b / I19c（各 10 瓶水）、I19d（叉面 0.5 m）、I19e（两根货叉摆满最小的东西：20 瓶水，全速和 2.05 m/s 各量一次耗时）、I20（宽物资五个朝向）、
  I20b（一根货叉两件大的）、I20c（混装 7 + 7 三组 id）、I20f（左叉两支 PTG-B，2.05 / 2.5 m/s 和全速）：
  一件不留、最靠车那件离叉尖 max(L(v), v²/(2·0.4g) − 撞上时它离叉尖) ±5 cm 且 ≥ L(v) − 1 cm、地上两两距离和叉上差 ≤ 1 cm、整排 ≤ 1.6 s、落地回到放得稳的姿态、
  算一次 ≤ 8 ms（`_benchThrow` 中位数；超了但量的时候负载超过核数只记 WARN，全量跑完后 forklift-timing 低负载真判）；I19v（返修 r12；r13 改查撞上那一帧）叉尖前面是空地、撞前 2.05–全速：
  撞上那一帧罐头水平挪的和撞前一帧差 ≤ 5%、下一帧只按 ≤ 0.4 g 慢一点，最靠车那只离叉尖 ≥ L(v) − 1 cm 且车越快越远；I23（返修 r13）叉尖前面是空地，歪着放的（闪电瓶 3 种、火盐、
  蛾子果冻、糖果）和 PTG-B 两两一排（前后两种排法，加两支 PTG-B）、按丢的摆法、24 个朝向、2.05 / 3.9 m/s，`_planThrow` 624 次 0 次留在叉上；I23b 真键盘：闪电瓶（相对车头 3.665 rad）
  在前、PTG-B 在后，两件都 fwd；I20g 每种物资两件、2.05 m/s 逐帧都对；I12r 甩到地上的 PTG-B 和罐头换层回来朝向不变（旧格式照旧能读）；
  I21（每种 × 5 个朝向放上货叉）/ I22（每种 × 5 个朝向放在地上）质心在支撑凸包里往里 ≥ 3 mm；I21b（返修 r13）放上货叉横着不伸出叉沿 2 cm 以上（PTG-B 每次都是，有不伸出去的朝向的种类都转过去）；
  留在叉上的（`lieState` 的 fins）质心在叉面上的支撑凸包里往里 ≥ 3 mm，并且（返修 r14，`lieState` 的 tipc）重心离叉尖 ≥ max(2 cm, 重心到最前端的一半)（`rowOk` / `forkStable` 一起查）；
  返修 r14 新增：I12s 甩到地上的火盐 / 微波餐 / PTG-B / 皇家口粮真键盘长按空格拖开再松手（还有 items.move 不给 y 的推开那条路）：最低顶点离地 ≤ 1 mm、drop 记录的 y = 地面 − rest.bot、
  朝向不变，换层回来也一样；I21b 再扫 PTG-B 相对车头 24 个朝向 + r13 报过的 1.207 / 1.83 rad 等 8 个斜放，每次都不伸出叉沿 2 cm 以上；I23 再加一组「挨得很近」：同样的两两一排前后只隔 3 mm、
  朝向不转（attachItem keep），`_planThrow` 一次都不许留在叉上；I25 叉尖前 0.55–0.9 m 地上有罐头、左叉闪电瓶 / 火盐 / 罐头靠叉尖、后面跟 PTG-B 或罐头 / 闪电瓶，撞前 3.9 m/s：
  留下的放得稳、不停在叉尖边上、逐帧不往回退；I26 2.05 m/s 验收员那一组（PTG-B 跟在闪电瓶后面、跟在火盐 + 罐头后面），1/240 s 细步长和 1/30 s 逐帧（`__fk.fineRun`）：
  离货叉、离地都 > 2 mm、3 点差分里没有轨迹关键帧（碰着 / 离开货叉那一刻）的每一步重心竖直加速度 ≥ 0.8 g，两支 PTG-B 都切出了又碰上货叉那一段；
  I14 / I14b / I14c / I14d / I14e / I16 / I16c / I16d（每种各一件，种数必须等于 `BR.itemTypes.all()` 的种数）叉尖顶着柱子 / 墙：全部留在叉上（stay:blocked）；I16e / I16f 真键盘顶墙撞上、
  撞后按住 W：一件没掉时不提示「还在往下掉」（滑了 0.2 s 以上可以说「还在往前滑」），叉尖贴着墙只锁几帧时什么都不说；I14f 柱子只挡一根货叉：那根留下、另一根照常；I14g 地上已有东西再撞：少滑一段；I18 叉尖离货架 20–30 cm。
  每一帧（`__fk.hover` + `fallBad`）：不穿货叉 / 车身 / 碰撞体 / 柱础 / 别的物资（碰撞体和柱础按模型的点 —— 顶点 + 边上每 8 mm 一点，直立的也一样，返修 r11 去掉了「0.85×最大半径竖圆柱」粗筛，
  I20e 正反对照；物资之间按每个 mesh 每 5 mm 一层的截面查，I20d 正反对照）；撞上那一帧水平挪的不比撞上前一帧（车速）多 1 cm 以上（pop），这一排初速是撞前车速
  （how 的 D ≥ v²/(0.8 g)）时也不比撞前一帧少 max(5%, 5 mm)（dip，返修 r13；撞上后第一帧也和撞上那一帧比 jump）；横偏 ≤ 1 cm、偏航 ≤ 3°
  （先去掉静止姿态的歪再量）、不往回退；碰不着货叉（模型的点离叉面 / 叉尖那条棱都 > 3 mm）连着三帧时看得见的重心（网格质心）竖直加速度 ≥ 0.8 g（nograv，返修 r12）、
  离开叉面以后在叉面高度最多 1 帧（float）；水平每帧变化 ≤ 1 cm（落地那一帧 snap、其余 jump）。`--selftest`（tests/all.mjs 的 forklift-selftest）给六份改坏的
  vehicles.js（半空冻结、匀速下落、横向漂移、落地瞬移，返修 r12 加 pop：撞上那一帧东西整整再走一帧；返修 r13 加 dip：撞上那一帧剩下的时间不走；这两种坐在车上真开撞），要求逐帧检查都报出来。
  tests/coop.mjs V13 / V13b / V13c / V13d（房主的消息卡住 6 s）两边一致、客机记的编号是房主这一次的；V13r 撞车前客机那边故意把 PTG-B、罐头转开（+0.6 / +0.9 rad），落地以后两边朝向差 ≤ 1°；
  V15 房主刷新页面、和同一个客机重开营地再撞：编号不和上一场撞，客机照摆。
- 地上物资：单机和房主那边，载入时把压在任何车 OBB 里的地上物资沿最近的边推到外面（`items.hold` / `move`，松手时一次写 levelState，联机照常同步；客机不推，等房主的 levelState）；开车时车身和货叉推着地上的瓶罐走，不会卡进车里。
  推不推按物资**真实的水平外形**（返修 r10：`BR.vehicles.footPoly` 的世界坐标凸包和车的盒子做分离轴，真碰到了才推，沿碰上的那一面推出去；以前按离竖轴最远的半径画圆，长的、扁的被隔空推开 5–16 cm），
  推完照旧贴地（forklift.js `pushY`；静止的物资原点高度不变，按放得稳的静止姿态最低顶点贴着地）；贴墙滑按外形的外接盒（phys.moveBox，不算这台车自己）。

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
  不行换另一边，再不行从车尾翻过配重下来（配重后 0.5 m）；三面都不行就不下车，driveNote「两边和后面都下不去，开出来再下车」（FE1R UI-12）。拿到落点：写 levelState.vehicles（on:0），联机时先写再 `release('k:' + key)`，然后 `setMode('walk')`、`player.unmount`（0.5 s 走上车的反路线）、fk_off、撤大灯、灯罩变回暗色，bus `'vehicle:dismount'`。
  第一次举着货叉下车提示「货叉还举着」（本局只说一次）。下车落点永远不在出口圈里（落在出口圈里的那一边算被挡住）。下车后车停在原地，挡人、挡怪、挡车，别人能上去开。
- **强制下车**（死在车上、reset、换层、回主页、复活）：`sim.exitSpot(…, force = true)`，三面都不行就从车旁一圈一圈往外找空地，永远不落进 OBB 和出口圈；不提示、不播刹车动画，人直接落在落点；车熄火停住、货叉保持原高度。
  死在车上：人倒在车旁（下车的那个位置）。开着车回主页、复活、换层：先自动下车再走，回来时车停在下车前的位置。
- **生命周期**：interact 的 reset / cancel 不通知 owner，所以 BR.vehicles 自己听 `game:start` / `game:home`（清空）、`level:leave` / `player:death`（强制下车并写状态）；工坊编辑态整体关闭。
- **暂停、切后台**：单机按暂停时整个世界停住，车、货叉、声音都停；联机暂停、看结算、切到别的窗口（输入被关掉）时 handle 收到 inp = null：车 0.6 s 内自己刹住，货叉停在原高度，防撞雷达照常工作。

### 15.6 坐在车上时别处怎么处理

- `player.x / z` = 座椅、`y` = 眼高、feetY = 车下地面：world 的出口检测（collectInside / checkExits）直接跳过，不显示「尚未开放」；L1 的水坑接触判定跳过（开过没密封的水坑不掉理智）；实体按第 12 节 BR.entities「坐在车上的玩家」处理；coop 的位置、besideHost 照常按 player.x / z。
- 怪打坐着的人（FE1P H11）：攻击距离量到司机身体（seatWorld + 人的半径），扣血在胳膊挥到最前那一帧（见第 12 节 BR.entities「坐在车上的玩家」）；
  坐着的人都不扣安全带（带子垂在座椅右侧外面，离坐姿人形 ≥1 cm），第一人称看不到自己的身体（D2 再做）。
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
- **对方人形**：`me.pose = ['drive', key]` 时，对方把整只 hazmat.glb 藏起来，换成程序化防化服 `hazmat(ctx, { color: 对方皮肤色 })`（_archetypes.js 新增 `o.color`，材质缓存键带颜色，不影响拟态实体共用的材质；
  FE1P H10 起手套 0x141414、靴子 0x111111、面罩框 0x252525、目镜 0x0a0e11、滤罐 0x353535 都和 hazmat.glb 一样（线性值走顶点色，不加槽位；FE1Q J7 起低画质也一样上色：gear 槽材质取手套色，面罩框、滤罐、手套、靴子按顶点色 tint 成 glb 的颜色（HAZ_PAL.low），tests/visualhooks.mjs 低档白名单放开 skin_stealer 伪装的 gear 槽位），
  换皮肤只换制服；不再长制服色的手和脚（手套 = 深色方块 + 深色手指，靴子里没有脚掌方块）；FE1Q repair-r1 起面罩（圆脸罩 + 目镜 + 两侧圆滤罐）、靴子（圆头高筒靴）的形状也照 glb，几何键 hazmat_lite_v4，高 2400 / 低 768 面；窃皮者伪装共用），摆坐姿钉在 `BR.vehicles.seatWorld(key)`，身体朝向取车的 yaw，头按对方相机相对车转（限 ±90°）；下车切回 glb。名牌坐车时放在 seatWorld + 1.2，视线检查对准 `chestOf(对方)`（护顶四周是空的，隔着车身名牌也不变淡）。
- 三种模式都能联机（入口：主页「联机」→ 营地 → 帐篷，见第 9 节）；叉车跟着 `BR.game.coop` 走，不另加模式判断。测试一律用 tests/coop.mjs 的假 room.php，绝不连真实服务器。

### 15.8 货叉上的物资（单机）

- `dropSurface(x, z, r, type)`：落点离某根货叉中线 ≤ 12 cm（一掌宽）、并且叉面离地 ≤ 1.4 m（够得着）时返回 `{ y: 叉面, veh, tine, x, z }`（x / z 摆到那根货叉中线上）。player.dropSelected 先问它，返回车就用 `still: true` 刷在叉面上并 `attachItem(id, veh)` 记进这台车的 riders；返回 null 照旧落地。
  **这根货叉上已经有东西**（r4，以前站在原地连按几次 Q 会叠成一件）：沿货叉找离落点最近的空位，两件中心至少隔两件模型水平半径之和 + 1 cm（`footRaw`；要丢的那件按类型量，没量过找一件同类型的量，再没有按包围盒的半对角线估），
  一样近先往叉根那边；整件在叉面上、离叉尖和叉根再留 2 cm（不悬在叉尖边上）；**离瞄准点（沿货叉）最多挪 15 cm**（r5 裁定 ③：不许把东西挪到远处的叉根，看着像瞬移）。
  瞄准点附近 15 cm 内放不下了返回 `{ full: true, …, gx, gy, gz }`：`groundBeside` 在这根货叉旁边（叉沿外再空 2.5 cm，瞄准点在中线或外侧就先放外侧、再两叉中间）、瞄准点附近（沿货叉 ±15 cm，每 3 cm）找一块空地
  （地面和车所在地面差不多高、不压墙货架和车的盒子、不压 sideObs、离地上别的物资至少 1 cm），player 把东西丢在那块地上；旁边也没有空地（或者看不见那块地）才不给 gx，东西留在手里
  （隔着墙看不见那根货叉时照老规则丢地上）。这根货叉上离瞄准点更远的地方还有空位时 dropSurface 多给 `room`：'heel'（空位在车那头）/ 'tip'（在叉尖那头）。
  提示（主会话 r6 裁定 ⑤：**只在真的放不下时才说放不下**，说清楚发生了什么、不歧义 —— 不说「往里 / 往外」这种看人站在哪边的话）：
  东西放到了货叉旁边的地上 —— 这根货叉别处还空着「这一段叉面满了，东西放到旁边地上了，叉尖那头还空着」/「…，靠车那头还空着」，整根货叉都摆满了「这根货叉摆满了，东西放到旁边地上了」；
  旁边地上也没空地、东西留在手里 —— 「这一段叉面满了，旁边地上也没地方，叉尖那头还空着」/「…，靠车那头还空着」，整根都满了「这根货叉摆满了，旁边地上也放不下」。
  显示时长按每秒 6 个字算、不少于 3 s（和 L1 断电提示同一个算法：`max(3000, ⌈字数 × 1000 / 6⌉)` ms；24 个字的显示 4 s；别的短提示还是 1.5 s）。
  tests/forklift.mjs I17：站在原地连丢，叉上的离瞄准点都不超过 15 cm，再丢落在货叉旁边的地上、提示「这一段叉面满了，东西放到旁边地上了，叉尖 / 靠车那头还空着」（不出现「放不下」）；
  I17d 对着叉尖连丢，前两只没有提示、第三只提示「…，靠车那头还空着」；I17c 整根货叉摆满再丢「这根货叉摆满了，东西放到旁边地上了」，两边地上也摆满再丢「这根货叉摆满了，旁边地上也放不下」、留在手里；都查显示时长。
  丢在两根货叉中间的空当、或者叉面举得比 1.4 m 高时，东西落在地上（之后降货叉会停在它上面，提示「货叉下面有东西」）。
- **放得稳的静止姿态**（返修 r12 裁定 B，items.js `restOf` / `BR.items.rest(type)`）：静止摆放、不在容器里的物资（still && !owner：货叉上、地上、柱础 / 矮东西顶上、甩出去落地、车推开、手放下）
  按这个姿态摆 —— 重心（模型三角面按面积加权的质心）的竖直投影落在离支撑面 ≤ 2 mm 的顶点围成的凸包里、往里至少 3 mm。**只算实物网格**（FE1P H6，`BR.items.solidMesh`：
  物资 build 时给光晕 / 发光体标 userData.glow —— 火盐的光晕球、瓶装闪电的闪电和瓶内光晕；vehicles.js typeShape / footOfObj 和测试的 F.solid 同一口径，光晕可以和叉面、地面、墙交叠）。
  按模板量一次：直立就站得稳的不歪（返修 r1 起 tests/items.mjs 列的 31 种里 25 种，含火盐 —— 坐在自己的晶体底座上，余量 26.6 mm，光晕球心挪到 y 0.066、最低点比底座底面高 1 mm）；
  糖果袋返修 r1 起倒平躺着（验收员：底封口以前是 1.9 cm 厚的方块，袋子靠它笔直立着）：枕形袋中间一块（|nx|、|ny| ≤ 0.5）一样鼓、上下两头收扁到 5 mm，
  封口是 2 mm 的薄压边，按同一套算法从直立倒下去，正面或背面整块着地（歪 90°，余量 34.4 mm），两颗糖用透明胶带贴在两个窄侧面上、离支撑面 >2 mm，不当脚；
  站不稳的按刚体倒下去的样子算（绕离重心投影最近的那条支撑边往重心那边转，转到下一个顶点碰到支撑面为止，重复到稳）：PTG-B 往针头那边歪约 7.3°、指托下沿和针帽一起着地（余量 13.5 mm），
  闪电瓶三种约 11.3°（底是尖的，余量 11.4 mm）、蛾子果冻约 3.2°（罐底外鼓，余量 4.8 mm）（FE1P 以前火盐靠着光晕球歪 18°、糖果袋站在脚边两颗糖上歪 4.4°）。姿态只含前后、左右的歪：`obj.rotation` 用 Euler 'YXZ'，`(rx, rotY, rz)` ——
  先歪再绕竖直轴转 rotY，绕竖直轴的朝向照旧自由；`rest(type)` 给 `{ rx, rz, bot（最低顶点离原点多高）, com, hull, inset }`。浮着转圈的、手里拿着的、容器 / 取货口里的照原样。
  vehicles.js 摆到叉面 / 地面时原点 = 支撑面 − bot（`liftOfType`），forklift.js 推完贴地（`pushY`）同样；interact 长按拖地上的物资（`D.dy`）、道具推开地上物资和 world 把物资挪出道具占地
  （`items.move` 不给 y）也一样 —— `BR.items.floorLift(id)` = 静静躺着的 −bot（最低顶点比原点高时是负的，FE1P H13；返修 r1 起糖果袋倒平、+32.5 mm，现在没有物资是负的）、浮着的 0（返修 r14，验收员 play：以前拖动时原点直接放到地面高度，甩出去落地的火盐一拖晶体尖就陷进地里 18.5 mm、
  PTG-B 5.1 mm，陷下去的高度还写进了 drop 记录）；静静躺着的丢弃物 drop 记录的 y 记到 0.1 mm（按 1 mm 取整换层回来会离地 ±0.5 mm）。准心命中球按歪过的角度多包一点（`hitAdd`）。
- **放上货叉时**（`attachItem`）：先 `orientOnTine` 再 `centerOnTine`。`supportGap`（返修 r11 起；r12 改成「重心在支撑凸包里」）：按放得稳的静止姿态，
  叉面那一条（这根货叉 |lx − 中线| ≤ 叉宽 / 2、叉尖到叉根）正上方、离最低点 ≤ 2 mm 的顶点，加上底面里的边（两头都离最低点 ≤ 2 mm）和叉沿、叉尖、叉根相交的点
  （托着它的就是底面压在这根货叉叉面那一条上的那一块，伸出叉沿的部分不算 —— 对所有物资都这么算，不只是底面比货叉宽的皇家口粮、跃迁莓；只按顶点算的话
  巧克力、微波餐、蛾子果冻、派对蛋糕也会不到 3 mm）围成的凸包，要把重心的竖直投影包在里面、往里至少 3 mm；
  叉面那一条正上方的最低点离最低点超过 2 mm（架在叉面外的东西上）也不行。`orientOnTine`：不满足、或者放得稳但横着伸出叉沿超过 `OVH_MAX` 2 cm（返修 r13，验收员 spec：
  斜放的 PTG-B 推杆那头伸出叉沿 3–5 cm）就绕竖直轴每 3° 试一圈（每次先照 centerOnTine 把重心挪进叉面那一条再查），满足的朝向里用横着伸出叉沿最少的
  （一样少 —— 差 1 mm 以内 —— 挑离原来朝向近的，原来的朝向也算；原来就放得稳、怎么转都要伸出 2 cm 以上、转过去也少伸出不到 1 cm 就不转；it.rotY，place 摆朝向。
  返修 r13 起按伸出多少挑：以前按横着多宽，圆肚子的闪电瓶怎么转都差不多宽，伸出叉沿多少却看它往哪边歪）；转一圈都不行就照原样。PTG-B、巧克力这种长东西会转成顺着货叉，指托和针帽都搭在叉面上。`centerOnTine`（返修 r10）：重心（模型包围盒中心）横着离货叉中线
  超过 4.5 cm 就挪回中线，前后出了叉尖 / 叉根就挪进来。撞车甩货里留在叉上、滑完挂回去的件（`attachItem(id, veh, true)`）不转朝向（规则 ①：偏航不变）。
  tests/forklift.mjs I21：32 种 × 5 个朝向（按 id 定的和 rotY 0 / 90° / 180° / 270°）都放得上，叉面那一条正上方的最低点离叉面 ≤ 2 mm（`__fk.stripGap`），
  质心在叉面上的支撑凸包里往里 ≥ 3 mm（`__fk.supportInset`，逐种报最小余量）；I22 同样 32 种 × 5 个朝向放在地上。
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

- `b.data.forklifts[i] = { key: '1@cx,cz#v<i>', i, x, z, y, rot（世界坐标）, lx, lz（区块本地）, number（车身编号）, detail（停放档；运行时车 null）, tris, solid（res.solids 下标）, spans: { prop: [v0, v1], wear: [[v0, v1]…]（不含 FK_WEAR[0]）, oil: [v0, v1] | null }, wearN, runtime }`。
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
- `b.data.vines = [{ top: [x, y, z], bot: [x, y, z], r, mat: 'kit:prop', v: [v0, v1] }]`：花园段梁上挂下来的每根实际画出来的藤蔓（v 是它在区块 kit:prop 里的顶点段）。车附近 4 m 内的藤蔓下段碰到看得见的护顶架、门架零件、链条（FE1Q J3 藤蔓挡体，见 15.11）或司机头胸胶囊，就绕顶点往离车的方向转开（`kit.spanEdit`），车离开后约 1.5 s 内慢慢摆回（`spanRestore`）；纯表现，不同步。传说段垂下来的电缆是硬的，会挡车（在 overhead 里）。
- **出生保底**：L1 正常生成时（工坊地图、营地不算），出生块 (0,0) 的中间柱间永远有一台叉车。openBay 加 force 判断：k 落在叉车区间（天鹰段 0.6 ≤ k < 0.62）而且放得下就照旧走 forklift()（种子 12345 就是这样，逐字节不变）；
  否则排在车位线 / 地牛 / 托盘垛之前，按叉车分支同样的公式取 4 次随机数，放一台保底车：只出 fixture 包住的外接 AABB 和一条 `runtime: true` 的记录（没有 spans），不建区块几何、不进 fkQueue、不记账面，所以不受面数闸门影响。
  FE1Q J2：出生块里本来就生成的车（不触发保底，比如种子 12345）也一样出 runtime 记录、不建区块几何（FK_PH 照旧占面，块里别的段逐字节不变；tests/forklift_l1.mjs snap「J2 出生块 100 块去掉叉车段以后别的段逐字节不变」）。
  同一柱间后面的碎屑只在保底触发时跳过落进叉车占地（含货叉）外扩 0.2 m 的那几片，随机数照取。保底只改变这个柱间之后的取数，块和块之间互不影响；约 98% 种子的 (0,0) 会变，但它们都不在 golden 里。
- 工坊地图要给工坊的出口和自由墙留面数时（原来低画质最重的两台叉车块加 3 个出口会超 8000），按出口种类预留（「区域」出口不画地上发光圈，留 0）；所有台按 lowb 都放不下时从最后一台起改成运行时车（`runtime: true`，和保底车一样由载具网格画）。FE1Q repair-r3 起非工坊生成也是这条规则（以前工坊是连 min 都放不下才改、非工坊放不下也按 min 建）：
  停着的车不再是 min 档；受影响的块只有叉车自己变（tests/forklift_l1.mjs snap MINFIX / EXTRA_BLOCKS，去掉叉车段以后逐字节不变），运行时车在区块账面上照旧按 FK_NOMINAL 记。
- 营地（`BR.L1room`）不写 overhead、sideObs、vines，不放叉车也不走保底。

### 15.11 前大灯和声音

- **仪表台大灯开关**（家长 2026-10 拍板，repair-r2）：`pose.hl`（1 开 / 0 关，出厂开着）。BR.vehicles 在载具网格里画（FE1P H3 起区块里停着的 high / mid / lite 档也由 L1.js `fkDashSwitch` 画同一份 —— 拨杆扳在「开」、指示灯熄着的暗绿在 kit:prop 里，上车发动后换成这里画的、指示灯跟大灯一起亮）：仪表台斜面左半边（方向盘左下方）一块深色底板 + 镀铬拨杆（开往上扳、关往下扳）
  + 拨杆上方一颗绿色指示灯（kit:glow，着车且开着才亮，熄着 × 0.12 近乎黑）+ 下方小灯头图标。坐在车上准心对准它（候选 `{ kind: 'button', key: 'fkhl:' + 车 key, label: '大灯开关', small }`）短按空格开 / 关，
  「咔哒」一声；**点火时大灯跟着开关**（出厂开着，所以点火默认亮），关着就撤掉灯池那一盏、灯罩和指示灯熄灭，`world.lightAt` 不再把司机算成被照亮（理智、怕光 / 找光的怪都看它）。
  手机上准心对着开关时「下车」键临时写成「开大灯 / 关大灯」（`input.setButtons({ interact: { label } })`），移开恢复「下车」。开关状态单机 / 房主写进 levelState.vehicles.hl（离开再回来保留），联机经 hand 的第 10 个值同步。
  `BR.vehicles.lightSwitch(key?) → { x, y, z, hl, lit }`（底板中心世界坐标，测试对准它用）、`toggleLight()`、`headlightLit()`（本机坐着的车大灯正亮着），bus `'vehicle:lights' { key, hl, lit }`。
- **L1 断电提示**：坐在开着大灯的车上时断电开始（或断电途中大灯亮起来）说「闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关按空格可以关掉，或者下车找亮着绿色应急灯的门躲进小屋」（每次断电最多一次）；
  手机上（`BR.input.isTouch`）说「闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关点「关大灯」键可以关掉，或者下车找亮着绿色应急灯的门躲进小屋」（手机上没有空格，开关靠对准时临时写成「关大灯」的那个键拨，repair-r3 裁定 ④）。
  两句都是家长定的原话（49 / 53 字），显示时长按每秒 6 个字算、不少于 6 秒（8.2 / 8.8 秒，L1.js `fkDarkTip`）。别的时候还是「闪烁：别开灯，找亮着绿色应急灯的门躲进小屋」（一局一次）。
- **FE1R 起大灯落点、光球界限、判定区、平滑、工坊规则以 15.13 为准**（下面「光源在墙前 0.3 m」「射线正前方打到的那一样按背面收」「最多补到 2.2 倍」是 FE1P / FE1Q 的历史写法）。
- 前大灯（数值以代码为准，主会话 r3 裁定 ⑤ 认可、方案已同步：断电时车前 6–8 m 真的照亮、车后不亮、不透墙，tests/forklift.mjs dark 组 K1–K6）：层级不建 PointLight。开着的车通过 `world.setExtraLights('fk:' + key, [灯])` 交给 gfx 现有 6 盏灯池里的一盏，每台开着的车 1 盏，和别的灯一样按离相机的距离挑。光源由 `sim.lightSpot()` 给：先从前立柱沿车头方向 raycast，叉根前 4 m 以内有墙就放在墙前 0.3 m（range 收到 1.8–2.2 m，墙另一侧 2 m 处已在范围外），否则放在叉根前 4 m；离地 1.6 m、range 8、强度 3.2、暖白（光斑铺在车前 2–8 m，L1 断电时车前 4 m 地面约是环境的 3 倍多，车尾后 2 m 在 range 外）。
  所以车头顶着墙时光不透到墙那边，车后面不亮；L1 断电时正好空出灯位，平时会挤掉最远的一盏区块灯。
  **FE1P H8（主会话裁定：墙另一侧一点光都不吃）**：点光源没有影子，光球只能不伸到挡光的东西后面（forklift.js `lightSpot` / `lightBound`）——
  ① 墙类（竖直跨过光源高度、水平细长：长边 ≥ 短边 2 倍且 ≥ 0.4 m 的静态碰撞体，加上区块 group 里名为 'noclip' 的切出墙片按包围盒当墙）：取墙沿薄方向的中面、两头各伸出 min(厚/2, 0.15) m，
  光源到中面距离 d、到中面所在平面的垂距 p，range ≤ d·(1 + min(厚/2, 0.1)/p)；侧着看墙头时不收；货架只算到中面外 0.1 m。② 射线正前方打到的那一样（柱子、堆垛、别的车、墙、切出墙片）：
  光源在它哪个面的里侧，range 就不超过光源到那个面的距离（墙在射线窗口最远那半米时按原来的 k 慢慢放开）。range 收小后补强度，让光源正下方地面和 range 8 时一样亮（最多 2.2 倍）：
  顶着小屋墙时 range 0.49、强度 7.04（墙上一块亮斑），试车场 range 4.42。光源仍在墙前 0.3 m。world.setExtraLights 改成马上 pushLights（不会有一帧光球伸到墙后）；
  远端车（vehicles_net 借灯池）走影子模拟的 lightSpot，同样被收住。tests/forklift_polish.mjs light 组。
  代价：附近有墙类时光斑比空地小（贴墙开约 1.5–2 m）；柱子、堆垛等矮东西后面照旧会亮（不做影子），只有车头正对着时按背面收住。
  **FE1Q J9（厚挡光体）**：墙类界限 `wallBound` 改用 `occDepth(hn, pn)` —— 半厚 hn ≤ 0.1 m 的薄墙照旧到远侧面为止（顶墙时墙上一块圆亮斑，墙里那间屋一点光不吃）；货架这类有进深的，
  光源离开它进深 0.5 m 以外时界限放到远侧面往里 0.1 m（照得到货架上朝通道的货，照不到货架另一侧的通道），光源在进深范围里（对着货架头）照旧中面外 0.1 m，0–0.5 m 之间平滑过渡（`OCC.ramp`）。
  窄货架道（车中心离货架 1.25 m）光球 2.5 → 3.46 m、叉尖前 5 m 地面开灯比关灯亮 19，宽通道 4.09 → 5.05 m；货架另一侧通道地面差 0。代价：货架是透的，另一侧通道隔着货架缝能看到架子里朝车那边的货被照亮。车从货架头斜着开出来、光源正好在货架中线延长线上时光球不收，货架另一侧通道靠近货架头那一条地面会亮一下（约 2.8 m²，随机位姿约 2%），lightAt 在那里也算亮；接受（从货架头外面本来就绕得过去看到那一段，按两个角收会让车前的光缩到 1–2 m）。
  **FE1Q J8（lightAt 和画面一致）**：world.lightAt 按画面上那盏灯算（第 12 节 BR.world），被墙 / 货架收短的地方不算亮；开着车灯时驾驶舱里固定算亮（`sim.litSeat`，≈ 0.338）。
  tests/forklift_polish.mjs light L7（队友驾驶舱）、L8 / L8b（窄货架道）、L9 / L9b（宽通道）、L10（司机座位四处）、L11（空地 21 个地面点：画面亮 ≥8 的 lightAt 亮，光球外画面 ≤2 的不亮），--before <目录> 反证。
- **L1 断电时新载入的区块**（FE1P H12）：断电途中往没去过的方向走，新载入的区块灯也一起灭、不占灯池（L1.js update 断电期间每帧 `dimLights`，原亮度记在 `_l1orig`），
  来电时一起按原亮度亮回（以前只灭断电开始那一刻已载入的块，远处新块 18 盏灯亮着、5 盏占了灯池）。tests/forklift_l1.mjs polish H12。
- **藤蔓**（FE1P H9，FE1Q J3）：碰到看得见的护顶架、门架零件和链条（`sim.vineVolumes`：护顶架用 VINE_GUARD —— 两根纵梁 |x| 0.40–0.46、y 2.04–2.10、z −0.62…0.56，前后横梁，按这一档根数算的格栅横条 y 2.07–2.085，
  斜立柱，前大灯灯盒，high 档后视镜，警示灯单独一个正 n 棱台；外门架、内门架、货叉架按这一档可动模型的零件（BR.L1forklift.model 按档建一次缓存，按顶点连成零件，凸的照轴对齐盒子或凸多面体算，升降跟着 inner / carriage 动）；
  链条按 FORKLIFT_GEO 现算；查不到这台车的档按 mid，L1 拆不出零件时退回物理盒子；物理 OBB FK_OBB 不动，不再用 roof 盒子 2.05–2.20）或司机头胸胶囊（半径 CFG.vine.head 0.15）就绕挂点往离车的方向转到刚好贴着：
  vineClear 按藤蔓轴线段到每个 OBB 的精确 3D 距离（先粗判再黄金分割）、到胶囊的线段间距离，阈值 = 方杆外接半径 r·√2 + 0.5 mm，转角二分到 0.5 mrad；车停着时往回摆一点就碰到的，
  二分到刚好贴着停住（表面离挡体 0–1 cm、不穿进去，以前停在离护顶 12 cm 以上歪着悬空）；FE1Q J3：藤蔓最下面 2 cm 按平底外接圆柱算（底面和往上 0.7 / 1.4 / 2.1 cm 共 4 圈 × 16 点，每点离挡体 ≥0.5 mm），
  轴线胶囊只算到离底端 R 为止，停住时藤蔓尖贴着纵梁 0.6 mm（以前按物理 roof 盒子，离看得见的横梁 31 mm）。车走开后 1.2 s 内慢慢摆回、顶点逐位恢复。
  tests/forklift_polish.mjs vine 组（V1–V3 同时量到挡体和可动模型三角形，V5 四档 × lift 0 / 0.6 离地 1.7 m 以上的模型顶点都在挡体里；V3-side-level.png 是车右侧平视、护顶高度的特写）；tests/forklift.mjs L9 用 `_geom.vineHit` 查每帧顶点。没人开的车大灯不亮；熄火后撤掉，灯罩变回暗色。
  vehicles.js / vehicles_net.js 里 lightSpot() 没给的字段（颜色、强度、range）按 `BR.forklift.config.light` 补（两边的 HEADLIGHT 只是 forklift.js 没加载时的默认，数值同上）。
- 声音：一次性的 `BR.audio.play('fk_*', pos)`，持续的 `BR.audio.loop('fk_engine' | 'fk_hydraulic' | 'fk_reverse', pos)`（第 12 节 BR.audio）。发动机声随车速变高变低；按住 R / C 液压泵「嗡」；倒车「哔、哔」；到顶到底「咔」；头顶挡住憋压；撞上「哐」/「咚」；雷达「嘀嘀嘀」。

### 15.12 以后接着做的阶段要知道的

- FE2（托盘货）按本节定下的 key 和接口接着做：托盘货全部用显式 key 纯数据登记；车开始对口插入的那一刻把货的顶点段拷进全层共用的「搬运件」网格（`kit.extractProp`），原区块那段藏掉；`world` 模块表里的 `'cargo'` 就是它；叉货、放货走可靠事件 fkLoad / fkDrop。
- N2 / A2 / D1 / D2 / B1 / B2 在 forklift 分支合回之后开工，沿用这里的 key（`'k:'` 租约、`'veh|'` 碰撞、`'#v<i>'` fixture）和接口（player.mount 是 D2 player.setPose 的子集，A2 的道具登记沿用显式 key 不占自动编号）。
- 改 L1 构件的阶段，golden 白名单照例写上 coopcamp；叉车四块（种子 12345 的 (0,0)、(1,0)、(2,−2)、(−2,2)）任何结构变化都是 bug，不许扩白名单。

### 15.13 FE1R 返修（2026-11，主会话 K1–K13 + 规则员定夺）

这一节写 FE1R 改了什么、以哪份为准。和前面各节冲突时以这里为准（前面 H8 / J9「光源在墙前 0.3 m」、15.3「lowb / min 停放档」等说法是历史）。

**大灯落点（forklift.js `lightCtx` / `lightEval` / `lightSolve` / `lightBound`，阈值都在 `LT`）**
- 挡光体分四类（`occKind(hx, hz, H)`；a = 水平长边、b = 短边）：**窄**（a ≤ `LT.narrow` 1.0 m，且不是「墙段」= a ≥ 0.4、a ≥ 2b、高 ≥ `LT.wallH` 2.4 m 的）
  —— 树干 0.34 m、门框立柱 0.16 × 0.08 m、L1 的 0.7 / 0.9 m 柱子、灯杆都算窄；**货架**（墙形、短边 > 1.0 m）；**墙**（墙形）；**宽块**（其余，例如 1.44 m 的宽堆垛）。
  别的叉车（停着的、运行时车、联机队友的车）一律按整车外包盒（叉尖到配重、车最宽处、地面到护顶或升起的门架顶）当一个「车」挡光体。
  阈值的意思是「挡不挡得住视线后面那片地」：1 m 以内的细东西挡不住一间屋，没有影子是全游戏的约定，光照到它身上也照到它后面（K1）。
- 光球界限：窄东西不收；墙 / 宽块 / 车按「光源到它背面的最近距离 ×(1 + 0.03/a)」收（光不伸进跨过光源高度的挡体的影子里）；货架长边那两面按远侧面往里 `LT.rackIn` 0.1 m（FE1Q J9 照旧）。
  光源不进任何车的外包盒、不越过车宽带里挡在正前方（中心横向 ±`LT.mid` 0.35 m 以内）的窄东西（停在它朝车那面前 `LT.passN` 0.3 m，它朝车那面 0.5 / 1.0 / 1.6 m 高三点要照亮）；
  偏在车宽带边上的窄东西，光源横向离它 ≥ `LT.passU` 就能从旁边过去。
- **判定区**（K2，「车前是空地时开灯一定亮」）：叉尖前 0.5 m 到 min(3 m, 车宽带里第一个挡光体 − 0.2 m) 为止，横向 −0.5…0.5 每 0.25 m 一点，去掉离任何实体面 < 0.3 m 的点和从驾驶座看不见的点。
  **返修 FE1R · repair-r1 改回裁定原文**：窄东西不是挡光体（K1），不截断判定区 —— 树干、柱子旁边和后面看得见的那片地照样是车前的空地、照样要亮；被它挡住、从驾驶座看不见的那几点不算。
  （整合那一版把判定区截在正前方的窄东西前面，验收员 tests 按原文的判定区量出来有近处照不亮的位姿。）forklift.js `lightCtx`（gM 只留给调试）和 tests/forklift_polish.mjs `__lt.blockDist` 同一个口径。
- 落点：每帧在叉尖前 s ∈ [−0.5, 3.1]、横偏 |u| ≤ 0.55、离地 h ∈ [0.45, 1.2] 的候选里挑（粗搜 `LT.s × LT.u × LT.h` 每 4 帧一次，在粗搜最好的 3 处各细搜两圈；
  别的帧从上一帧的目标爬山，切换目标带滞回）。打分 = 4 × 叉尖前 1.5 m 内的平均覆盖 + 2 × 更远的平均覆盖 + 叉尖前 5 m 那点 + 1.5 × 正前方窄东西朝车那面 − 天花板罚分 + 离名义位置近
  − 照不亮的点（照度 < `LT.zOkN` / `LT.zOkF` 0.15，和测试暴力搜判「照得全」同一个阈值；近段每点 `LT.badN` 3、远段每点 `LT.badF` 2）（整合员加的，差不多是「先少照不亮的点、再比别的」，
  一盏灯照不全时的先后：叉尖前 0.5–1.5 m → 1.5–3 m → 叉尖前 5 m 那一点（J9）。以前只按平均算，远角一点差一截只扣 0.05 分，比光源横偏的偏好分还小，求解器宁可让远角暗着；
  只在照不亮时才扣，照得全的位姿挑法和以前一样）。**J9 的 5 m（返修 FE1R · repair-r1，不再是「K2 优先、5 m 只记录」）**：宽货架通道正中 (−12, 57.5) 叉尖前 3 m 有一根 0.7 m 的柱子
  （K1：光源不越过它），光源只能放在前面货架头那个端面（z 52.2）的这一侧，端面背后拐角那片影子把光球收在 3 m 左右，5 m 那一点（在柱子后面）一盏受界的灯照不到 —— 这是 K2 的几何例外，
  不是放宽：tests/forklift_polish.mjs L9 用同一套界限（不越过柱子、货架、墙）细网格暴力搜一遍，5 m 那两点没亮的每一点都没有一个光源位置能照亮（照度 ≥0.15）才算例外、截图存档，照得到却没照亮算失败；朝通道的货（竖直面，照度按它的法线算）在这两处只记录 ——
  贴着柱子那条道实测 6.39 级、暴力搜照得到 0.357：求解器只给车前判定区和叉尖前 5 m 打分、不管两边货架的货，是已知差距（方案 risks[30]）；
  **返修 FE1R · repair-r2（验收员 spec / play / tests：J9 不许拿 K2 几何例外顶 —— 收住光球的不是货架长边，是两节货架之间空当里、货架头拐角背后那片影子）**：上面这段的几何例外撤回。
  `occBound` 里货架（'rack'）两头的端面不再收光球：端面背后的影子在这排货架自己那一条里（两节之间 1 m 的空当、货架头外面的横通道），照 FE1Q「货架头那一下漏光接受」；
  另一侧的通道一定在远侧长边那个平面后面，长边那条界限（远侧面往里 0.1 m）照旧管着。L9 两处改回 J9 原文判：通道正中光球 4.4 m、叉尖前 5 m 两点 19 / 15 级、朝通道的货 18 级；
  贴着柱子那条道光球 3.7 m、20 / 18 级、货 51 级；L9b 另一侧通道 0。k2 组「墙后暗」被货架挡住、但没越过这排货架远侧长边往里 0.1 m 那条线的地（同一排的空当、横通道）不算墙后；
  贴着柱子那条道 (−13.4, 57.5) 同样判。前面 5 m 以内没有柱子、货架头的地方（L9c (−10.9, 61.1)，车靠右边那排、量近的右边货架）叉尖前 5 m、朝通道的货照旧都要 ≥8（J9 原文）；窄道 L8 照旧；
  判定区去掉从驾驶座看不见的点（挡体按盒子算视线 `segHits`；车自己的门架、货叉架、链条按这一档可动模型的凸零件 `mastPieces` 算 `cabHidden`，按 lift 缓存）；
  候选打分用的光球和摆上去以后实际的光球一致（`lightEval` 里 R = min(R0, B − margin, Bs − margin)：光源刚高过矮堆垛顶一点时 occBound 不收、occSoft 照收，以前打分按大光球算、摆上去变小）；
  强度按判定区要的给，按光源下地面、近处表面封顶（不发白，最大通道 < 245；光球很小时不再补到 2.2 倍；返修 FE1R · repair-r5 起按表面颜色算，见文末 repair-r5 那段），开得快时封顶压低。
- 平滑：光源位置按车本地坐标平滑（爬山 τ 0.05 s、全局换位 τ 0.15 s，每帧最多挪 3 m/s·dt）；光球放大、收小都限速 3 m/s；强度 τ 0.15 s。
  界限当帧收（不漏光）：开车时当帧的硬上限是把端面楔形细缝放宽到 `LT.w0r` 0.15 m、光源高度在挡体顶 / 底上下 0.25 m 内连续放宽的那份，再按 3 m/s 收到严格上限；
  停着、刚上车、瞬移时当帧就是严格上限。
- **几何例外**（K2 唯一允许的）：一盏没有阴影、受界限的点光源要照亮地上一点，光球必须包住这一点，光球又不许伸进任何跨过光源高度的挡体的影子里 ——
  车侧贴着墙 / 货架、对着货架头或墙角时，所有允许的光源位置到判定区远端的距离都超过影子界限，测试用同一套界限在 0.1 × 0.1 × 0.075 m 的细网格上暴力搜也照不全，记作几何例外；
  这些位姿叉尖前 0.5–1.5 m 仍须全亮。最近一次实测（返修 FE1R · repair-r2 的全量 all.mjs，forklift_polish-k2，`tests/output/forklift_polish/k2/k2-exceptions.json`；repair-r3 没改求解器，repair-r3 的全量 all.mjs 重跑结果一样）：
  种子 12345 / 16 / 39 合计 551 个位姿，几何例外 12 个（2.2%）：影子界限 4 个（12345 #53 货架头、#121 贴墙；16 #76 墙角、#125 树），正前方有窄东西、光源不越过它、后面那片照不到（K1）8 个
  （12345 #93 #165 货架通道、#137 贴墙；16 #45 #151 贴墙；39 #7 货架端头、#108 柱子、#121 贴墙）；光源照得全却没照全的 0 个，墙后漏光 0、lightAt 不一致 0（清单和截图见方案 risks[29]、tests/output/forklift_polish/k2/）。返修 FE1R · repair-r4（L3 加了两边货架的货那一项）重跑：同样 551 个位姿、几何例外 12 个（2.2%），清单逐个一样；smooth 12 条路线、light、k1 组照旧全过。
  （以前写的「6 个 1.1%」是整合那一版的数；repair-r1 把判定区改回到正前方窄东西后面那片地以后是 15 个 2.7%，repair-r2 货架头端面不再收光球以后是 12 个。）
- 天花板（L-ceiling）：打分里天花板罚分 —— 前方 ≥6 m 开阔时光源上方天花板的开关灯差 ≤ 叉尖前 1 m 地面的差、且 ≤ 40 级；车后天花板 0。
- 工坊（L-workshop，推翻以前「工坊全黑时大灯也不亮」）：world.js `pushLights` 里工坊的 `lightTransform`（全部熄灯、闪烁、亮度倍率）只套区块灯，
  `setExtraLights` 进来的额外光源（大灯）原样进灯池；`lightAt` 用和画面同一份强度。L1 自己断电时大灯照常亮，工坊的灯光设置也一样只管层级自己的灯。
- `sim.lightInfo` = { range, intensity, R0, seatLit, bound, hit, narrow, by: { kind: 'wall'|'rack'|'wide'|'car', key, box }, s, u, h, tgt, zone, zoneMin, zoneCov, faceE, far, ceil, ohE, score, blocker }；
  `BR.forklift._light` = { LT, ctx, eval, solve, occBound, occKind, sMaxU }（测试看候选打分；solve 是 lightSolve 本身，探针直接对一台 sim 求落点）。`world.lightAt` 照旧跟画面走（FE1Q J8），开着大灯时司机座位算亮（≈0.338）。
- 测试：tests/forklift_polish.mjs `--group k2`（种子 12345 / 16 / 39 各 ≥150 个随机位姿，按 15 类生成，统计车前地面亮 / 墙后暗 / lightAt 一致，几何例外截图 k2-<种子>-<序号>-<类>.png；
  每个位姿摆好推 0.6 s 以后再等大灯落定 —— 光源位置差 <5 mm、光球差 <1 cm、强度差 <0.5%，最多再等 3 s —— 才量，量的是停着的车灯落定以后的样子）、
  `k1`（⑨ 枯树、离树 0.3–4 m、柱子 / 门框立柱）、`smooth`（12 条真键盘路线 60 fps 逐帧：叉尖前 0.5 / 1.5 / 3 / 5 m 相邻帧差 ≤8 级、驾驶座画面下半区 ≤4 级）、`ws`（工坊三种灯光设置）、
  `light`（H8 小屋那几处、J9 通道、L-occ）。tests/all.mjs 里是 forklift_polish、forklift_polish-k2、forklift_polish-fe1r 三项。

**升降、转向、叉上的货（F1–F4，forklift.js）**
- F1：往上升时内门架、货叉架、两根货叉、叉上的货按目标高度的盒子查 phys 静态 AABB 和别的车 OBB（`sim.allParts()`），碰到就停在它底面以下 2 cm；门楣形状的（`lintelLike`）
  提示「上面有门框，升不上去」，别的「上面有东西挡着，升不上去」。不改 b.data。
- F2：两只后轮各一个小 OBB（`wheelParts(g, steer)`，跟着 steer 绕主销转），参加移动扫掠、车尾外甩和推开；打方向会压进静态 AABB、别的车、人或地上的东西时二分限住 steer，
  提示「后轮挨着墙 / 旁边有人 / 挨着东西，打不了方向」。FK_OBB、停车摆位不变。
- F3：叉上每件货（env.riders）按 BR.items 静止姿态的外接 OBB（`cargoParts`）参加升降和行驶扫掠，伸出叉尖的那一截也算；被挡住时车停或货叉停、给一句提示。甩货规则（r13 A–G）不变。
- F4：降货叉改成部件盒子往下扫（不再 3 条射线），停在第一个静态 AABB / 别的车 OBB / 人和实体外形顶上；货叉底面按 M-fork 以后的形状（顶面平到叉尖、收薄在底面）。
- 人和实体（`peopleCircles`）：实体按 `BR.entities.shapeOf(e)` 的真实外形（0–0.6 / 0.6–1.2 / 1.2 m 以上三段竖直圆柱，id 'e:<id>#<段>'），挂在天花板上的 Nguithr'xurh（2.59–2.69 m）
  不挡车身、不触发雷达（雷达只看 y + 0.05 … y + 2.3），只挡升起来的门架和货叉；人（本机、队友）按人对载具的半径 `BR.config.player.vehRadius` 0.377（A7），顶在 1.8 m + 1 cm；
  降货叉停在人 / 实体外形顶上 `CFG.underGap.person` 0.01 m（实体外形本身已往上让 1 cm，合计 2 cm）。

**人对载具的半径（A7，js/core/phys.js、js/game/player.js）**
- `phys.moveCircle(x, z, r, dx, dz, yFeet, height, obbR)`：第 8 个参数 obbR（可选）是对 OBB（载具）用的半径，对墙 / 静态 AABB 照旧用 r。玩家传 `BR.config.player.vehRadius` 0.377
  （hazmat.glb 站立 / 走路动画里离竖轴最远的点 + 1 cm），贴着车走手套不插进配重、发动机盖、门架、货叉。forklift.js 的 `CFG.personR` 也是 0.377（雷达、扫掠、下车落点离车身 OBB），
  下车落点离墙 / 静态碰撞体照旧按 0.3。队友在他自己那边走路用同一套，所以两边一样。

**模型（L1.js，K3 / K4 / K5 / K8–K12 / M-gaps / M-fork / M-return）**
- 停放档只有 high / mid / lite / low（`FK_LADDER = { high: ['high','mid','lite','low'], low: ['low'] }`，`FK_PARK_FLOOR = 'low'`），lowb、min 删掉了；一块里所有车按 low 还放不下时，
  从最后一台起改成运行时车（画在载具网格里）。`FK_LOD.low` 和 `drvLow` 同一份参数（K3：停着 low、开过 drvLow 逐像素一样），`fkDriveTier(*, 'low')` 和 vehicles.js `tierFor` 都给 drvLow：
  高画质停着是 high / mid / lite 的车上车照旧同一档，停着是 low 的上车是 drvLow；低画质一律 drvLow。
  测试（tests/forklift_l1.mjs polish K3，返修 FE1R · repair-r1）：停放 high / lite / low@高画质 / low@低画质四对车，有电、断电各 26 个机位（一圈每 30°）逐像素比，车所在像素（外扩 2 px）里
  不许有 3×3 成片的差；有电那组某个机位成片时过 1.3 s 再拍一遍开过的车重比、按少的算（车外场景在动，偶尔在车边 2 px 里凑出一片；几何差异再拍照样成片）。
  mid 停放档实际生成不出来（和 high 一样 2000 面，放得下 mid 就放得下 high），不比。
- K4 车架：停着的车和可动模型同一个车架（收窄底盘 |x| 0.185、配重下半截前脸 1.06、H4 两段底面 —— z 0.54–0.56 处 |x| ≤0.53、0.56–1.06 处 |x| ≤0.55 —— 和侧裙后端的挡板），
  `FK_DRV = { chassisZ 0.54, chassisHalf 0.185, cwFront 1.06 }`。
- K5：可动模型的大灯镜面、警示灯罩、仪表台开关指示灯各画两份（part 'lampOff' / 'lampOn'、'beaconOff' / 'beaconOn'、vehicles.js 'indOff' / 'indOn'）：熄着那份 kit:prop 和停着的车逐个三角形一样，
  亮着那份 kit:glow。**返修 FE1R · repair-r1（验收员 spec：硬规则「可动模型每台 ≤2000 面」按缓冲区算）**：载具层不再把两份都放进缓冲区、用不上的叠成一点 ——
  `modelInfo` 带 `vis = lampVis(veh)`（1 = 大灯镜面和指示灯亮、2 = 警示灯亮），`sigOf` 带上它，`buildTemplate` 只放这一状态用得上的那份；灯一换状态（着车 / 熄火、开关大灯）
  `refreshMesh` 发现模板的 vis 不对就当帧 `layout()` 换模板、重排共用网格（次数很少）。`debugInfo().perVehicle` 和 `perVehicleBuf` 一样多。
- **K8 圆的量法（规则员定）**：1280×720、竖直视野 75°，取零件最近的正常机位（站着眼高 1.62 m、离车外接矩形 1 m 一圈；本车驾驶座；旁边车驾驶座离 1 m；最近的 showOwner 机位），
  投影后每段直边离真圆最远处（弦高）≤ 1.0 px，同时不低于点名的段数下限（原文「每段边 ≤6 px」要 70–90 段，做不到，也和点名的「气瓶 ≥12」对不上）。被别的零件挡住的机位不算（CPU 射线剔除）。
  叉车：轮胎前 22 / 后 20 段、轮辋 16 / 15、方向盘轮圈 23 × 3、方向盘中心盖 16（矮圆锥 + 底面）、转向柱 10、气瓶 19 棱两端封口、铜阀门 8、链轮 20、链条半圈 10、警示灯罩 12、表盘 20、
  起升缸 9 / 杆 8、倾斜缸 8 / 杆 8、扶手 8 棱圆管、升降杆头 6 棱短柱 + 锥顶（弦高 0.94 px）、配重俯视后角一刀 45° 切角 0.12 m（`BR.L1forklift.cwChamfer`）。
  tests/forklift_l1.mjs polish「K8 圆零件段数 / 弦高」（含铜阀门、中心盖）停放 4 档 + 可动 4 档都 ≤1 px。
  **返修 FE1R · repair-r1（验收员 play / tests / spec：K8 点名的圆件一件都不许降、H5 链板不许是一根灰条）**：补回铜阀门、方向盘中心盖（K8 点名）、仪表台右侧铭牌（离侧面 1 mm）、
  配重顶上三道散热缝（离顶面 1 mm）、第 3 道百叶；链条一深一浅的链板画在链条贴图里（见下）。腾面：灯的两份不同时进缓冲区（−30）、表盘改成离板面 1 mm 的圆片（不再在板面开洞，−22）、
  大灯开关底板顶面整块（−6）、转向柱 16 → 10 棱（顶插进中心盖，−26）、high / mid 护顶横条 3 → 2 根（−6）、链轮轴顶面（2.09 m 往上，−4）。
  可见性普查（stage-FE1R/repair-r1/scripts/vis.mjs：站着 1.62 m 离车 0.38–6 m 每 5° 一圈、驾驶座、旁边车驾驶座、0.3 m 低机位一圈、升起货叉下面，可动模型升降 0 / 0.5 / 1、满舵，
  软光栅立方体全景，每个三角形看得见没有）只找到 7 个谁都看不到的三角形 —— 圆件段数（K8）和封闭（K12）定下来以后没有别的能省的面。
  还是放不下、各档都不画的：第 2 / 3 根操纵杆、前轮轮毂盖、左侧车号、后视镜、方向盘助力球、座椅减震底座、挡泥板（方案 risks 逐项写孩子看不看得出来）。
  **返修 FE1R · repair-r2（验收员 play / tests / spec：K8 腾面顺序 ③ 只许降 high 才有、正常机位看不出的点缀 —— mid 原有、孩子看得到的第 2 根操纵杆、前轮轮毂盖、左侧车号，
  K8 点名的助力球不许删）**（repair-r3：这个材质加 polygonOffset factor −1 / units −2 —— 贴片离面 1 mm，30 m 外深度精度只剩 1 个 LSB 左右，警示条、百叶开始撕裂，
  40 m 碎成一段一段；拉一点以后 30 / 35 / 40 / 45 m 都完整，横移 3 mm 也一样。链条本身不和任何面共面）：叉车贴图图集 —— 链条材质 `L1:fkChain` 的贴图 `l1_fk_chain` 从 64×64 扩成 512×512（`FK_AT`：链条一列 x 2–126 整张高、v 照旧周期两节；
  10 个数字（7 段字形，48×96 + 4 px 透明边）、警示条、百叶、散热缝、铭牌、表盘（真圆、深色表圈、红指针，别的表按 uv 转过去）、前轮轮辋盘 + 轮毂盖），材质加 alphaTest 0.5（透明底挖掉），
  一块花纹 2 个三角形（`fkTexQuad` / `fkTexQuadX`，离面 1 mm）。车号每位一块、两边都喷；表盘那块离板面 1 mm（板面上一圈沿去掉了）；前轮轮辋还是那个 16 段矮圆锥（`fkConeTex`，尖顶 uv 在轮毂盖正中）。
  腾出来约 62 面补回：第 2 根操纵杆（各档 levers 2）、助力球（`FK_SW_KNOB`：10 棱、半径 1.1 cm、高 5 cm 的短圆柱 + 圆顶，底圈落在三角截面的轮圈管里、底面不画）、左侧车号、前轮轮毂盖。
  面数：可动 high / mid 每台最多 1999（含 88 号、最多磨损、开关、2 根操纵杆），lite 1993、drvLow 1963；停放成本（普查口径，含贴花）high / mid 2001、lite 1995、low 1963。
  坐垫顶棱各档都倒圆（`FK_BEV_ON`；low / drvLow 以前不倒，坐垫侧面一直到顶和靠背侧面共面，驾驶座往左下看短带被直角坐垫边挡住）。
  还是不画的（K8 ③ 的取舍，方案 risks[33]）：后视镜（以前只有 high 有）、座椅减震底座（坐垫各档都一直落到发动机盖顶，从外面看不出少一块）、地台防滑棱、货叉挂钩、挡泥板。
  `BR.L1forklift.atlas`（size、cells、rimPx、gaugePx、knob、tex）给测试按 uv 认这些块；tests/forklift_l1.mjs polish K8 段数多查助力球 ≥10、两个前轮都有轮毂盖、车号两边都喷，
  「图集里的表盘、轮毂盖在最近机位上一个纹素 <1 px」；表盘指针那一项改成沿指针 27 点连线、先碰到表盘贴图。
- **链条贴图（H5，返修 FE1R · repair-r1）**：整根链条（前后两段的四个长面、搭在链轮上那半圈的外表面和两侧扇面）画在 `FK_CHAIN_MAT = 'L1:fkChain'`（Phong + 顶点色白 × 64×64 贴图
  `l1_fk_chain`：一个周期两节，外链板浅、内链板深，节与节之间一颗销子头，两边是链板的边；线性值和 kit:prop 上的链条一个亮度），v = 弧长 s / (2 × 节距 `FK_CHAIN_PITCH` 0.045)，
  s 从货叉架挂点算（前段 y − y0、链轮上 hf + R·θ、后段 hf + πR + (cy − y)），u 横跨链宽 —— 升降时整根链条在链轮上滑，链节跟着走。不加面。区块里这一材质单独一个网格
  （停着的车 `spans.chain` 记它那一段，载具层升格时一起藏掉），载具网格里也单独一个（vehicles.js `CHAIN_MK`、MATS 多一项；链条重建 `rebuildChain` / `writeChain` 在这个材质里）：
  载具网格 draw call 高画质 4（prop、glow、decal、chain）、低画质 3；L1 块的 mesh 普查最多 8（高画质）/ 7（低画质）。`BR.L1forklift.chainMat` 给测试 / 载具层用。
- K9 安全带扣头：扣头顶面嵌黑色插口和红色按钮（离顶面 1 mm，不共面），短带四面都画、看得出连进坐垫缝；靠背加宽到 ±0.25（和坐垫一样宽），竖带贴靠背 0.5 mm。
  返修 FE1R · repair-r2（验收员 spec critical：短带和扣头朝坐垫那面都在 x −0.2505，同向共面 z-fighting；不倒角的档坐垫侧面和靠背侧面在 x ±0.25 共面）：短带顶到扣头底面 1.15 为止（不再插进扣头 1.5 cm），
  靠背两侧收进 0.4 mm（±0.2496）。坐垫各档倒圆以后 low / drvLow 从驾驶座也看得见短带。
- K10 护顶横条：`BR.L1forklift.slatZ(n)` 在前横梁后脸 −0.56 和后横梁前脸 0.48 之间均匀排开（横条 x ±0.40、y 2.07–2.085、深 0.05）：各档 2 根 [−0.2217, 0.1417]（净空 0.3134 m ≤0.35；
  返修 FE1R · repair-r1 起 high / mid 也是 2 根，腾 6 面给铜阀门、中心盖）。forklift.js VINE_GUARD（藤蔓）按同一份算。
- K11 牵引销：各档都画 fkPost(0, y 0.23–0.40, z 1.261, r 0.014, 5 棱)，插进配重后脸 3 mm。
- K12：S1–S19 逐条补面（唇边、双面边沿、端盖、底面、平嵌指示灯 / 表盘）；背面探针（站着 1.62 m 离车 1–4 m 每 10°、旁边车驾驶座、本车驾驶座环顾、0.3 m 低机位，可动另加升降 0 / 0.5 / 1 和满舵）
  CPU 射线复核后 0 漏光。只省谁都看不到的面：朝下且离地 ≤0.3 m、朝上且离地 ≥1.8 m、贴着别的零件被整块盖住的。返修 FE1R · repair-r1：背面探针做成自动测试
  tests/forklift_l1.mjs `--only k12`（停放 4 档 + 可动 4 档升降 / 满舵共 24 份模型 × 2402 个机位软光栅，kit:prop + 链条材质，约 3 分钟，默认跑）。
- M-gaps：灯盒后脸插进前立柱、坐垫底在 0.998 插进发动机盖顶、货叉竖直段插进横梁 2 mm 等，窄缝检测 0 px。M-fork：所有档货叉顶面 0.055 一直平到叉尖 z −2.1，收薄在底面（从 z −1.97 起由 0.015 抬到 0.04），
  dropSurface / forkSurface 按平面摆就是对的。
- M-return：levelState.vehicles 的记录多 `park: { high?: { t, w, rt }, low?: { t, w, rt } }`（停放档、磨损片数、是不是运行时车，按画质分开记，写的那端只写自己画质那份、和另一份合并）；
  回到这一层、原区块还没载入时照记录设档；没有本机画质那份（联机另一端画质不同、自己没载入过原区块，或旧存档）时离线生成一次原区块（scene 为 null，用完 dispose，按车 key + 画质缓存），
  不会先按 mid 画、等原区块载入再当面换档。coop 的 `vehVal` 把多出来的字段原样带着，park 跟着同步。
- 面数（返修 FE1R · repair-r1 起按缓冲区算 = 画出来的面数）：可动 high / mid 每台最多 1998（车号 88 最费面，含载具层的大灯开关和最多的磨损；tests/forklift_l1.mjs polish 那一项量的），lite 1966、drvLow 1927，≤2000；
  停放成本 high / mid 2000、lite 1968、low 1927；FK_CAP 9950 / 7950 不变。因为 high 和 mid 一样贵，停着的 mid 实际不会出现；运行时车占大多数（普查数字见方案 risks）。
  返修 FE1R · repair-r1 普查（101 个种子 × 5×5 块 × 高低画质，stage-FE1R/repair-r1/logs/census-r1.json、tier-changes-FE1R-to-r1.txt）：相对 FE1R 整合版换了档的 6 块 ——
  高画质 12 (1,1) lite → low、26 (−1,−2) low → 运行时车、56 (−1,2) low → 运行时车、70 (−2,0) low,low → high,运行时车、81 (2,0) low → 运行时车；低画质 12345 (1,0) low → 运行时车。

**怪和坐车的人（K6 / K7 / K8-actors / ACT-seat / A1 / ACT-veh / A10 / F6）**
- K6：怪打坐在车上的人用 `_archetypes.js` `seatReach / armTo（双骨 IK）/ strikeSeat / striking` 和 entities.js `driverMarks（肩、肋、脸三个靶点）/ seatPlan / seatAim / seatRoute / seatTarget / seatReachNow`：
  站到驾驶舱侧面的站点（被挡住换另一侧，绕车角过去），出手那只手抡到司机近侧的肩 / 上臂（笑魇是脸），扣血那一帧手离司机身体外壳 ≤2 cm、插进去 ≤1 cm；整个过程不进叉车实心部件（14 个 OBB + 坐垫 0.998–1.16、
  靠背 ±0.25 的棱柱）超过 1 cm，脚不进底盘。攻击距离、扣血量、出手时机（抡到最前 / 脸鼓到最大）、冷却、感染不变。def.seatStrike 可以自己声明怎么打（smiler: { kind: 'face', reach: 0.95, y: 1.7 }）。
  **没有胳膊的（返修 FE1R · repair-r1，验收员 play / tests：整合那一版「按设计不打坐车的人」让叉车成了安全屋）**：def.seatStrike 'leap' / 'chain'，`seatReach` 照笑魇的口径给 entities.js（kind 'face'，
  落点 tf = 司机这一侧最靠外那一点；「肩膀」= 碰人的那一点在基础姿势下的位置；low / mid = 身体往前伸出去多远，站点让出来再多 5 cm）：
  'leap'（猎犬 tuck 前腿、啼物 tuck 前腿、悲尸肉块、Nguithr'xurh）整只平移（`seatLeap` 改 pivot 的 x / y / z）：碰人的那一点（此刻姿势下沿扑的方向最前面那一点）在车本地走三段 ——
  同样高横着挪到驾驶舱侧面外 `ss.out`（缺省 0.55 m）那条线上、和落点前后对齐（站在站点上的不动；挂在天花板上的 Nguithr'xurh 在天花板那么高挪过去，护顶上方）→ 竖直到落点那么高 →
  横着进驾驶舱侧面的开口到落点前 4 mm（STRIKE_PEAK），原路退回；扑的这一下不再叠 lunge / bite（lunge 把胯往前推 15 cm，站在车边会推进车身里）。
  'chain'（肢团最长那条肢体、牧蛇从第 4 节起的前半截）：链根不动，最后一节横着（头 / 肢体梢正面碰人），前面几节按一条往上拱、弧长 = 链长的二次曲线摆，再 FABRIK 来回 12 遍把每节长度对上；
  梢的路线同样先抬到落点外 45 cm、同样高，再横着进去，停在落点外 `gap`（缺省 4 mm）。牧蛇的站点让出前面贴地的那几节再多 `pad` 1.7 m（拱起来的余地）。
  肢团 `at: 't2'`（落点换成近侧肋下那一点：坐着的人转头时面罩两侧的滤罐转到肩膀外面，细肢体从肩膀那么高横着进来会戳到滤罐）、`gap: 0.009`（4 mm 时偶尔有一趟扣血那一帧插进人 1.3–1.6 cm）。攻击距离从碰人的那一点量（`strikeDist`，按「脸朝车侧面」的朝向）。
  一动不动的陷阱（Nguithr'xurh，`fixed`）不去站点：车开到它下面（它自己的攻击距离以内）、三段路线都看得通（`losTarget`）就扑；打坐车目标时不往下沉（`fly.low`），扑那一下由 seatLeap 摆。
  **返修 FE1R · repair-r2（验收员 play：猎犬扑坐车的人时整只竖直浮到驾驶舱高度、在半空悬停，后腿吊着、底下什么都没有）**：地上的 'leap' 不再整只平移 ——
  起跳前一帧按趴着时的样子（基础姿势 + 前腿收好）算一个「趴在车上的姿势」（`solvePerch`）：两种里挑 ① 立起来（后脚 = 后 45% 里最低那一点踩在地上、在车身侧面外 ≥0.62，绕它把身子立起来；
  身子长的啼物走这种）② 跳上去（前脚 = 前 45% 里最低那一点搭在座椅外侧、发动机盖边沿里面那条顶面上 `LEAP_HOOD`，离面 6 mm），仰角 0–1.2 rad、前后挪着试，整只往车里推到
  最先碰到坐着的人的那个顶点离人 `LEAP_GAP` 5 mm（`driverSurf`：坐姿人形三角形按 y 切片、沿 z 光栅化的「人身最外一层」1 cm 一格表，头往左右转 1.2 rad 的也并进来），
  全身压进车身部件盒（让 2 cm）不超标，同样不穿车时立起来的优先（不腾空）。立起来：0.35 s 绕后脚起身、往车边挪到位，一直踩着地；跳上去：在 STRIKE_PEAK 落定倒推腾空时间
  （按要升多高、重力 9.8 算，约 0.35–0.4 s；repair-r3 实测各怪 0.13–0.47 s，见下），pivot 竖直按重力走抛物线（落定时已过顶点，是落下来的）、水平匀速，转动球面插值到趴着的朝向（模型转到正对车侧面、再仰起来，pivot 用四元数）。
  落定那一刻就是咬到（扣血）；还在打就一直扒在车上（前爪托着；repair-r3 起只有站得稳的才这样，站不稳的扑咬一口就落回去，见下），下一轮绕前爪往后一仰（0.14 rad）、STRIKE_PEAK 再探回来咬到；不打了（没目标、车挪了、死了）：
  跳上去的前脚往外一滑、从静止按重力落回站点，立起来的原路放下来（`leapRelease`）。挂天花板的 Nguithr'xurh 照旧 repair-r1 的路线，往下那一段改成从静止匀加速落下。
  tests/infection.mjs 坐车多一项「有东西托着」：扑人（不含挂天花板的）/ 伸肢体的怪扑的那几帧（seatLeap 摆着 pivot），要么最低的顶点离地 ≤2 cm，要么有顶点在车身哪个部件盒顶面上方 0–1 cm；
  没托着的只许是一次起跳的腾空（连着的那几帧 pivot 竖直加速度 −g ±25%，第一次扣血前最多一段）。跳上去要升 0.5–0.6 m，按重力腾空就得 0.35–0.4 s（验收员建议的 ≤0.25 s 只够升 0.3 m，
  跳不上 1 m 高的发动机盖），按物理定，写进方案 risks。
  **返修 FE1R · repair-r3（验收员 play major：猎犬前爪搭在发动机盖上、后半截身子悬在车侧外面，后腿离地 0.35–0.43 m 一直吊着，顶点重心在着力线外 26 cm；
  spec：肉块腾空 0.47 s、啼物从车左侧来也跳，和文档写的不一样）**：`solvePerch` 加平衡约束（`balAt` / `hullMargin`，口径同物资静止姿态裁定 B）——
  姿势的顶点重心水平投影要落在「着力点」（离地 ≤2 cm 的顶点；车身部件盒 geo.obbs + 坐垫、靠背顶面上方 0–1 cm、落在脚印里的顶点；贴着部件侧面、在它外面 ≤1 cm 的顶点）
  围成的凸包里往里 ≥`BAL_IN` 3 mm。立起来（rear）立着和平时再立直 0.14 rad 那个姿势都要站得稳，站不稳的不许选；跳上去（hood）趴着和平时往后仰 0.14 rad 那个姿势都站得稳
  才 `stay`（趴在车上接着咬，'on'），站不稳的扑咬一口就落回去（'snap'）：同样按重力跳上去、前脚落在发动机盖上那一刻正好咬到（扣血），咬完前脚一蹬，把扑上去那一段倒着走一遍
  （`snapStep` = `jumpPose(1 − τ)`：时间倒过来的抛物线竖直加速度照旧 −g；落上去、蹬起来那一下是前脚撑在发动机盖上的一次碰撞），先往外退出发动机盖边沿再落下，不从发动机盖里划过去，
  落回站的地方；这一下扑过了（`u.snapHit`）就等下一下，半路才对上目标、出手时刻已经过了也不补跳。同样不穿车时站得稳的优先（站不稳的多记 0.25）。
  不打了（`leapRelease`）：正往上扑的从这一点原路落回去，正在落的接着落完。实测（种子 12345，8 个方向 × 高低画质）：猎犬、啼物、悲尸肉块现在都站不稳 ——
  猎犬身子 0.83 m 长、后腿 0.72 m，前爪搭在 1 m 高的发动机盖上时胯离地 0.9 m，后腿够不着地；啼物立起来重心在后脚前面、前面又没靠着车身；肉块搭在发动机盖边沿，
  重心在接触面外 1.6 mm —— 全部扑咬一口就落回地上（啼物以前从车右侧过来是立起来的，现在从哪边来都跳）；一次扑咬按要升多高、重力算：猎犬上去 0.13–0.23 s、啼物约 0.3 s、肉块约 0.47 s，
  落回去一样长（k 组「腾空」量的是脚离地那几帧，上去、下来中间前爪搭在发动机盖上 ≤2 帧时算一段，最长 0.97 s）。规划结果在怪站着没挪、车没动时最多复用 4 s（以前 0.6 s 就重算）。
  tests/infection.mjs 坐车加一项「站得稳」：趴在车上（perch 'on'）的每一帧重心在着力点凸包里 ≥3 mm（`K.balance`，和 balAt 同一个口径）；搭在车身上又站不稳的（扑上去前爪落在发动机盖上、
  咬一口、一蹬那一下）每次连着 ≤9 帧（0.3 s）—— 改前猎犬一直挂到不打为止。
  链（肢团、牧蛇，返修 FE1R · repair-r2，验收员 tests：肢团走近时触手梢插进配重 3.6–6.7 cm，相位不同时好时坏）：摆动 / 呼吸 / 抽搐的相位按实体 id 定（以前 wrap 时 Math.random）；
  vehFit 的链按离车 3 cm 以内就收（`vfDepths` 的 m：主骨骼量的比蒙皮混合出来的少伸 1–3 cm）、收完再量、还贴着就把让的距离加大再收，最多三遍；`pushOut` 往实体在车外接矩形哪一边伸出去得多就沿哪个轴推，
  薄横板（≤8 cm 厚，货叉）从上面出去更近就往上推；有链的怪 vehNear 多让 0.6 m；用一条链打坐车的人时别的链躲开司机的外接盒（`driverBox`）。
  tests/infection.mjs 坐车那几项的出生点还要让怪的网格整个在车外（出生那一帧顶点压进车身 = 0，压到了左右挪 0.6 / 0.9 m 再换距离；验收员 tests：啼物车前 2.5 m 那个出生点前腿第 1 帧就插在货叉里），
  有链的怪每个方向再强制两个摆动相位（`--phases`，缺省 1.9、4.4）各跑一遍。
  tests/infection.mjs 坐车那几项：所有会近战的怪（Level 1 的 10 种）× 车的 8 个方向 × 高低画质 × 噩梦，10 s 内都出手、扣血那一帧碰到司机（≤2 cm、不插进去 1 cm），整个过程不插进车身；
  伏击型的放在它出手的范围里（啼物 2.5 m、Nguithr'xurh 天花板上离座椅 1 m）。tests/forklift.mjs N3 钝人、猎犬各一只都要 6 s 内打到。
- K7：坐车的程序化防化服 `hazmat({ seat: true })` 不分画质都走全细节（目镜带、呼气阀、滤罐浅灰端盖、头带、反光条、拉链、腰带和扣、胸前小包、腕部胶带），颜色照 J7 / H10。
  返修 FE1R · repair-r1（验收员 play / spec：并排看和 glb 不一样）：面罩最宽那一圈套一个黑面框（torus，28 段）；头带改成贴着兜帽、往后仰 0.5 rad 的一道细带（兜帽椭球和那个斜面的交线往外 5 mm），
  不再是伸出兜帽两侧的横杆；拉链从领口通到腰带（两道黑线，顺着胸口曲面）；胸前口袋挪到 glb 那一边的胸口、大一号；glb 上没有的臂章、腰侧小包去掉了。几何缓存键 hazmat_seat_v6。
  返修 FE1R · repair-r2（验收员 spec / play：按头的朝向同机位并排看，面框和面罩连成一块、目镜没有边框、呼气阀看不见、白带在兜帽顶上、胸口多一道带）：面框是比脸罩大 4% 的一圈圆管
  （手套色，伸出脸罩侧影，受光的侧面就是 glb 上那道亮边）；目镜四周一圈边框（比目镜大一圈的椭球片，`HAZ_SRGB.frame` 0x3c3c3c，比面罩浅一档，和滤罐色错开 7 个色阶）+ 两端两颗浅色卡扣；
  呼气阀往外凸 4 cm、根上一圈 frame 色的环、圆顶；兜帽反光带挪到面罩顶上那么高、按兜帽截面水平绕一圈；坐车的胸口不再画那圈反光带（glb 没有）。几何缓存键 hazmat_seat_v8。
  返修 FE1R · repair-r3（验收员 play major / spec：按头对齐同机位并排看，滤罐的朝向和形状、目镜的大小和位置、呼气阀还是两个样子）：坐车人形的面罩直接用 hazmat.glb 里的面罩件
  （`hzGlbParts` / `hzMaskGlb`）—— 材质 Mask / Visor / Filter / Metal / Tape 按连通块（位置 0.1 mm 焊在一起）挑：包围盒中心在 1.45 m 以上、不在面罩椭球中心后面 3 cm 以外、
  前后进深 ≤0.16 m、横向中心 |x| < 0.2（绕到后脑勺的两条头带、兜帽那圈反光带、胸前拉链头不要）；挑出来的是脸罩椭球、目镜（前后两层 + 侧壁）、目镜橡胶框和四颗螺钉、
  呼气阀（阀体 + 圆顶盖）、两侧滤罐（接口、罐身、两道加强筋、端盖、接嘴）、面罩外沿那圈黑胶带，共 3592 面；整体平移到程序化面罩的位置（glb 椭球中心 (0, 1.615, −0.078) →
  HZ_MASK (0, 1.6, −0.135)，大小、朝向一样），挂在 head 骨骼上、gear 槽位，颜色按 glb 材质色上 tint（`HAZ_SRGB` 加 cap 0xb9bec4 = glb 的 Metal、tapeG 0x0c0c0c = Tape、
  shine 0xc8ced4）。目镜左上贴一小块 1.1 × 0.7 cm 的浅色椭圆当高光（glb 的目镜是低粗糙度的 Standard，灯下有亮点；坐姿人形是 Lambert）。兜帽反光带挪到 glb 那么高
  （面罩中心往上 5–8.5 cm）、用 cap 色。glb 没载入时退回 hzMask（几何缓存键 glb 版 hazmat_seat_v9g、程序化版 hazmat_seat_v9p，分开缓存）。
  坐车人形 7844 → 10082 面（面罩多 2238 面；场上最多一个坐姿人形，不算区块预算，高低画质一样）。tests/smoke.mjs 滤罐颜色在找不到程序化那个端面圆心顶点时改量罐身侧面
  （轴上往外 3.7 cm 再往上 4.4 cm、离它 ≤1 cm 最近的顶点），金属件按 #9aa0a6 或 glb 的 #b9bec4 都算。
  同机位并排图 stage-FE1R/repair-r2/shots/k7-after-high.png。
- K8-actors：笑魇眼睛 20 段、高光 12 段；人形（实体构建时）头按 ⑱c 机位弦高 ≤1 px（segFor）、四肢 10 段、关节 10×6、躯干 12、颈 10。L15 的尸体不在 ROUND 范围里，golden 不变。
- ACT-seat：coop.js `SEAT = { hipUp 0.092（repair-r4 起，以前 0.09）, lean 0.52, thigh 1.16, fwd −0.07, splay 0.08, scale 0.97, neck 0.15 }`，头顶离护顶各件 ≥1 cm（转头 ±1.5 rad、抬头低头都算）；
  握点跟着方向盘转（`gripTurn`，每 π/2 换一次握位、10° 回差）。
- A1：联机 'me' 消息的 pose：上车 ['drive', key, 'in']、坐着 ['drive', key]、下车 ['exit', key]；对方按它在踏板外保持站姿、过了踏板才坐下，下车那 0.5 s 照旧坐姿、落地才换站姿。
  返修 FE1R · repair-r1（验收员 spec：「人形不许消失超过 0.1 s」没人量过）：tests/coop.mjs V7（下车）/ V8（上车）观察那页每一帧记对方人形在不在画面里（没有人形、坐姿时没有坐姿模型、相机离它 >0.6 m 却 visible false 都算消失），
  按游戏自己的帧时长 min(0.1, 两帧间隔) 累计每段连续消失，最长一段 ≤0.1 s（机器忙时 rAF 很慢，一帧就封顶 0.1 s，连着两帧消失就判失败）。
- ACT-veh：`BR.entities.shapeOf(e)` / `BR.arch.shapeOf(e)`（见上）；`vehFit` 把伸进车身的长链（牧蛇尾巴、肢团肢体）推出车的 14 个 OBB 和坐垫、靠背；怪被车挡住时按车的外接矩形绕（`vehDetour`），
  隔着车不出手（`vehBetween`）；车附近的实体每帧都更新动画（不走 LOD 跳帧）。
- A10：笑魇身后的黑影按离车身、驾驶室、队友、墙、地面的距离缩（`shroudFit`），不和这些几何体相交。
- F6（L1.js `armsSafe`）：断电时的「手臂」在人站在小屋屋内矩形里（区块 b.data.bays 里 'h' 的柱间，墙内侧 ±3.0 m）、或坐在自己这台大灯开着的车上时不抓；关着大灯坐在车上照样抓；
  抓到时 toast「黑暗里伸出一只手抓了你一下」。S.rng() 照旧每次都抽（抽签顺序不变）。测试口 `BR.levels.get('1')._armsSafe()`；返修 FE1R · repair-r1 加
  `_holdBlackout(sec)`（正在断电时把这次断电至少再延长 sec 秒）：tests/forklift.mjs F6 临时打开 attackPlayers 实打实推 —— 小屋里 30 s、开着大灯坐车 30 s 掷骰 ≥3 次、0 次被抓，
  关着大灯坐车最多 60 s 至少被抓 1 次、弹那句 toast（以前测试模式里手臂根本不抓，「0 次」量不出东西）。

**界面（K13-ui / UI-1…UI-12 / F5 / K8-ui，hud.js、css/game.css、js/items）**
- 进层大标题：副行是中文层名（`BR.hud.levelName(id)`：title 本来是中文的照用，英文的用层级定义的中文昵称，再没有用 hud.js LEVEL_ZH 的译名 —— 门槛、管道之梦、熄灯、郊区、大丰收、不夜城、温水煮青蛙、不宜居、
  废弃航母、编号门），生存难度行查 LEVEL_CLASS_ZH（`BR.hud.levelClass`：每层一句中文，「生存难度」只出现一次、没有英文字母；表里没有的层只取 survivalClass 里的数字写「生存难度 等级 N」）。
  大标题按准心（±18 px）、触屏键、「实体」键、开麦键的屏幕矩形摆，压到就挪到准心上方、宽度收到两边的键以内，再放不下才收掉生存难度行（`BR.hud.titlePlace`）。
  左上角信息块、暂停菜单、主页、帐篷、死亡画面、测试模式、工坊都用 `BR.hud.levelLabel(id)`（「Level 2 · 管道之梦」）。层级定义一个字没动，golden 不变。
- toast：显示时长 = max(给的 ms 或 2200, 字数 × 1000 / 6，标点空格不算 —— `BR.hud.readMs`）；没显示满的不会被新来的挤掉：屏上已有 3 条或有人在排队时新来的排队，放不下的后来者收回队首，
  排队超过 30 s 不再显示（`BR.hud.toastQueue`）。矮横屏往上长的那一列可以不居中、可以小一号字、让开大标题。driveNote 同样按字数兜底最短显示，触屏竖屏按空位找地方放（`BR.hud.drive.notePlace`），
  NOBR_WORDS 加了开出来、下车、货叉、大灯、出口、拖开、倒车、往外甩、带出来、刹车、升不上去、下不去、走过去、仪表台、关掉。
- 开车提示行：电脑「W/S 前进后退 · A/D 打方向 · R 升货叉 · C 降货叉 · F 使用 · 空格 下车」，触屏「摇杆开车 · 按住「升」「降」动货叉 · 点「下车」键离开」；准心对着大灯开关时最后一段临时换成
  「空格 关大灯 / 开大灯」（触屏「点「关大灯」/「开大灯」」），按最宽那一版占位（`.hud-drive-alt`），各段位置不跳。返修 FE1R · repair-r1：占位框里的字（连同电脑上跟在后面的「 ·」，
  放进框里 `.hud-drive-alt-in`）靠左，多出来的宽度只留在「·」后面（以前居中，「空格 ␣␣下车␣␣ ·F」）；tests/mobile.mjs DD3 量键帽到字、字到「·」都 ≤8 px。
  返修 FE1R · repair-r2（验收员 play / tests / spec：多出来的宽度落在「下车 ·」后面，到「F」空了 22 px）：电脑那一行把会换说法的「空格 下车」挪到最后一段（`DRIVE_DESK`、`DRIVE_ALT_DESK = 5`），
  占位多出来的宽度在整行末尾；DD3 改成量每个「·」到下一段键帽（5 处都 3.6 px，最大减最小 ≤2、都 ≤8）、会换说法的那段是最后一段。
- 状态短提示：「前面是出口，下车走过去」「后面是出口，下车走过去」（UI-11），下不了车「两边和后面都下不去，开出来再下车」（UI-12）；F1 / F2 的新提示见上。
- 联机角标「联机 · 房主」/「联机 · 客人」，有角标时模式行不再加「联机 · 」；联机面板「你是房主 / 你是客人」，对方没起名时默认叫「客人」（玩家看得到的字里不说「客机」）。
- F5：坐在车上（含上下车那 0.5 s）按 F 用要扔出去的东西（火盐、瓶装闪电，`BR.itemKit.seatedNoThrow`）：东西留在手里、不消耗，提示「坐在车上扔不出去，下车再扔」。
- K8-ui：PTG-B 按压盘 32 段（⑳a2 弦高 0.72 px，斜躺 6.99°）、瓶身 ≥20 段、瓶塞瓶盖 ≥16 段、糖球 16×8、光晕 / 光团高段数球；物资不进区块预算，tests/items.mjs 每件三角面上限 1400。

**返修 FE1R · repair-r4（主会话 L1–L7；L8 T1 接受）**
- L1 坐车人形从头到脚照 hazmat.glb（_archetypes.js）：glb 没有骨骼，`hzGlbComps()` 把 glb 按材质、连通块（位置 0.1 mm 焊在一起）拆开（模型坐标原样），`hzGlbParts()` 挑三组：
  头（重心 ≥1.45 m、|x| < 0.2：兜帽、脸罩、目镜、橡胶框、螺钉、呼气阀、滤罐、两条头带、面罩外沿黑胶带、兜帽反光带）挂 head 骨骼；躯干（0.8 ≤ 重心 < 1.45、|x| < 0.2：躯干、腰带、扣、
  右胯小包、胸前小包和挂带、拉链黑胶带和两侧压条、拉链头、胸背反光带）—— repair-r4 按脊柱转轴拆成上下两截、叠 11 cm，坐着前倾以后后腰露出台阶，
  repair-r5 改成整块按高度在 hips / spine 之间线性蒙皮（见文末 repair-r5 那段）；两只靴子（Boots 全部 + 重心 < 0.45、高 < 6 cm 的 Tape =
  靴口胶带）横挪到程序化小腿中线（glb 靴筒中线 x ±0.150、z 0.009 → ±hipW、0）挂 shin 骨骼（坐姿小腿竖直，靴子和站着一模一样）。制服色的件进 head / body 槽位（跟着换肤），别的进 gear 槽位、
  按 glb 材质色上 tint（HAZ_SRGB 加 belt 0x1a1a1a、pouch 0x2b2a22）。glb 那一版 `humanoid({ torso: false, headSize: 0.85 })`：不建程序化躯干（buildHumanoid 新选项 torso:false，
  缺省照旧），头骨缩到整个罩在 glb 兜帽里。头上的件整体往下挪 `HZ_GLB_HEAD_DY` 1.3 cm 挂：glb 兜帽顶 1.80 比以前程序化的头顶高 1.3 cm，坐着时头顶离护顶横条只剩 0.1 cm；
  试过上身多前倾（lean 0.58），头顶够了，但胳膊够方向盘时肘往外撇，钝人的手插进司机上臂 2.2 cm（K6），所以坐姿只把 hipUp 0.09 → 0.092（glb 鞋底比程序化靴子低 1 mm，靴底照旧不低于防滑棱）。
  四肢要弯，按 glb 量出来的画（`hzSeatGlb`）：反光带（Metal #b9bec4，比肢体粗 4 mm）上臂 1.245–1.300、前臂 1.000–1.050、小腿 0.437–0.487（glb 0.45–0.50；程序化膝关节 0.486，
  不跨过膝关节）；外侧黑压胶条（Tape，半径 5 mm）胳膊 1.40→肘→0.90、裤腿 0.92→膝→0.36（在肘、膝断开）；手套护腕（Gloves）0.985→0.80、上沿 0.958–0.996 黑胶带（repair-r5 换成 glb 的护腕和胶带，手换成圆的握拳，见文末）；护膝（制服色，
  0.508–0.632、宽 9 cm、厚 2.4 cm）挂大腿骨骼。glb 上没有的（肩上反光章和压胶条、大腿侧袋、颈封、背面压胶条、臂章）不画。glb 没载入时退回程序化那一套（hazmat_seat_v9p，反光带
  高度和颜色照 glb、靴口是黑胶带）。坐车人形 10082 → 15080 面（高低画质一样，场上最多一个，不算区块预算）。`BR.arch.hzGlbInfo()`（测试用：从 glb 挑了多少顶点、headDy）。
- L2 tests/smoke.mjs `hazmatParity().seatGlb`：(a) 几何缓存键 hazmat_seat_v9g、hzGlbInfo 给得出头 / 躯干 / 靴子；(b) 一侧滤罐（Filter 色、x > 0.03，顶点去重）投影方差最小的方向
  （轴）和 glb 夹角 ≤10°，目镜（Visor 色）三角形正面投影按脸罩那一圈的包围盒中心对齐、1 mm 一格光栅化，和 glb 的 IoU ≥0.97（裁定原文 0.9；负对照退回程序化面罩是 0.948）；
  (c) 上臂 / 前臂 / 小腿反光带（四肢骨骼上的浅色顶点）和 glb Metal 色差 ≤6、中心高度差 ≤2 cm，靴口胶带（小腿骨骼、0.33–0.41 m、离小腿中线 ≥7.5 cm）和 glb Tape 色差 ≤6、高度差 ≤2 cm，
  兜帽宽（1.55 m 以上的制服色）差 ≤1 cm，四肢外侧有 Tape 色顶点。负对照：hzGlbParts 返回 null → (a)(c) FAIL；靴口加回白条 → (c) FAIL。
- K6 落点（entities.js `driverMarks`，返修 repair-r4）：肩膀外侧 t1 不再按顶点找（胳膊是圆台、只有两头一圈顶点，落点跟着上臂外侧最高那圈顶点跳 —— 换了反光带高度、加了外侧压胶条以后高了 5 cm，
  低画质窃皮者够不着、肢团的梢离人 2 cm 多），改按坐着的人身最外一层（`BR.arch.driverSurfAt`：driverSurf 那张三角形光栅化的表、取 (y, z) 落的那一格 `surfAt1`）在
  肩膀顶往下 10–16 cm、前后 ±12 cm 里找最靠外的那一格；肋下 t2 只看躯干（spine / hips）上的顶点（glb 躯干比以前的方块胯窄，那一块里最靠外的顶点落到了上臂反光带上）。
  两只手抓的（grab：钝人、窃皮者）站位：两肩中间对着 t1、t2 中间够不着时改成对着 t1（`seatPlan`）；两只手不用那个竖直面，改按人身最外一层贴（`strikeSeat`：手 = 前臂骨骼上离肘最远的 40%，
  离那一层最近的那一点留 `SEAT_HAND` 6 mm —— 插进去往外挪，离远了按出手进度 pw 往里贴）。swipe 的另一只手（不出手）在出手这一段也不越过落点那个竖直面（越过多少往后摆多少）。
  肢团 seatStrike.gap 9 → 6 mm（梢斜着贴圆的肋下）。tests/infection.mjs 扣血那一帧多记 drvBone（插进司机哪根骨骼）、gapBy（每只手离司机多远，>2 cm 时）。
- L3 两边货架的货（forklift.js `lightCtx` 的 goods、`lightEval`）：车两侧（车宽带外）横向 `LT.gLat` 3.6 m 以内、长边和车平行的货架（'rack'），朝车那一面上叉尖前 0–4 m、离地 0.6 / 1.2 m
  每 1 m 一点（法线朝车中线）；名义范围 R0 也要够得着最远那一点；强度要够把照得到的点里暗的那四分之一照满（`LT.gT` 1.0）；打分加 `LT.wG` 1.2 × 照满比例（两边都有货架时取差的那一边），
  再乘车前判定区最暗那一点的照满比例（判定区没照满时不拿它换货）。界限照旧（货架远侧面往里 0.1 m，另一侧通道照不到）。和 FE1Q 比（同一测试、同一量法，FE1Q 的 forklift.js / world.js /
  vehicles_net.js 跑的 tests/forklift_polish.mjs light 组）：宽通道正中左边货那一点 48.3 → 现在 24.0、贴柱子那条道 86.1 → 51–54（两次实测）、L9c 右边 78.1 → 45.4（都在 50–63%）；
  驾驶座画面区域平均（repair-r4 scripts/j9reg.py，FE1Q 用验收员 r2 拍的 j9-head）左边货 0.32 → 0.84、右边 0.27 → 0.53。repair-r4 说「三处都顶在 K2 的不发白封顶 eSurf 2.0 上，
  再亮就发白」—— 验收员实测不成立（eSurf 是一个不看颜色的照度代理，通道正中离光源最近的是下段刷深绿漆的柱子，照度 6 都不发白）；repair-r5 改成按表面颜色封顶、
  天花板 / 头顶条目放宽到两边货的亮度，通道正中两边的货回到 FE1Q 的 110% / 84%，见文末 repair-r5 那段。
- L4 / L6 hud.js：坐车往下看超过 0.9 rad、准心没对着东西（只剩「下车」）时，电脑 `.hud-prompt-side`（准心右边），触屏 `.hud-prompt-up`（准心上方，底边离准心中心 28 px）；
  `placeDrive` 在 hud-prompt-up 时照旧让开准心下方提示本来那一格（不然常驻开车提示行顶上来盖住扣头下面的短带）。tests/mobile.mjs `secK9`（iphone13-p / android800-p / se1-l / iphone13-l
  触屏、desktop 电脑）：③d 机位（头往左 1.6、往下 1.15 rad），扣头和短带露出坐垫缝那一截 8 个角投影的外接框不和准心提示、常驻开车提示行相交，提示不碰触屏键、不压准心；
  往下 0.5 rad 时不挪。tests/forklift_l1.mjs model 段：`BR.assets.material('kit|L1:fkChain')` polygonOffset 开着、factor ≤ −1。负对照（撤掉挪位、撤掉 polygonOffset）都 FAIL。
- L5 tests/coop.mjs：`loadK()`（1 分钟负载 / 核数，夹在 1–4）乘到 waitFor 的墙钟上限和几处固定墙钟循环；`waitActive` 每 250 ms 短轮询，有一边还在 reconnecting / handshake / connecting
  就接着等（最多 8 分钟，游戏自己 90 s 的重连期限到了回到 idle 就不算过渡态），两边都不在过渡态又没连上时等满 timeout × loadK 判失败。

**返修 FE1R · repair-r5（验收员复验 r5：L1 坐车人形的手套、后腰台阶；L3 宽货架通道的货；L5 coop 营地那几项墙钟；all.mjs 计时项；文档旧说法）**
- 不发白按表面颜色封顶（forklift.js `surfCap` / `albProf` / `ambAt`，取代 `LT.eSurf` 那个照度代理；验收员实测宽通道正中离光源 0.45 m 的柱子下段是深绿漆，照度 6 也不发白，
  树干（浅一点、Phong 高光强）照度 3 就到 247）。三步：
  ① 剖面：每个静态挡体（phys 的 AABB 记录，按记录缓存）第一次用到时，沿它的四个侧面（和不高于 3 m 的顶面）一格格往里打射线（行 0.1 m、列 ≤0.25 m 且 ≤0.06 m（窄的至少 6 列，
  7 棱的树干正对着光的那个面要采到），最多进 1.2 m，盒子外扩 5 cm、窄的 12 cm 收树杈根），射线打区块网格里落在这个盒子附近的三角形（按面投影分桶），
  记下最外一层不透明面（刷漆、贴花盖着的按外面那层；半透明的贴花 / 玻璃取亮的）的点、法线、漫反射反照率（顶点色 × 材质色 × 贴图分通道 p98，sRGB 贴图先解码成线性）、
  Phong 高光峰值 ks = 高光色 × ¼ ×（shininess / 2 + 1）和 shininess；发光件（Basic）记 0。一次 lightCtx 最多新建 8 个（ALB.build），没建好的、别的车、切出墙片照旧按 LT.eSurf。
  ② 别的光 Ea（`ambAt`）：半球环境光 + 附近区块灯（原始亮度、不算闪烁、3D 距离、不算朝向，往大里估），按挡体记录缓存、0.5 s 时间常数跟（断电 / 来电那一下封顶不一跳）。
  ③ 上限：光源 (x, y, z)、光球 R 时，近处每一格 (WS − a·Ea) / (k²·cos·(a + 高光))，取最小（k = 1 − d / R）；高光按司机眼睛方向的 Blinn-Phong，墙、树干、柱子（faceOn：不是货架、堆垛的）
  再和「正对着这一面看」（N·H = cos(θ/2)）取大 —— K1 / K2 是贴近正对着量最亮那一点；货架、堆垛上的货按司机看到的算（L3 的口径）。WS：faceOn 的 `LT.wSurf` 0.78（线性，sRGB 229），
  货架 / 堆垛的 `LT.wSurfG` 0.86（238）。最后的封顶取「按颜色算的」和以前「最近那个面照度 ≤ eSurf 2.0」里松的那个（验收员给的第二种办法：保留 eSurf 2.0、
  按反照率放宽）：颜色说安全的地方（深色漆的柱子、暗的货）放开；颜色估计更严的地方（亮黄护角、白箱子、高光强的树皮）照旧按 eSurf —— 全按颜色收严试过，
  种子 12345 的 K2 几何例外从 5 个涨到 7 个（车前地面让给了柱子上的黄色护角），K1 树干也比以前暗，所以不收严。
  省时间：候选的封顶只在「要的强度」超过别的上限和旧上限时才按颜色细算（结果逐位一样；最后摆上去那个位置一定算），surfCap 一旦降到旧上限以下就返回，
  每格先拿高光峰值估个下界、不比现在紧就不算 pow。负载 28 的机器上量（repair-r5 scripts/p_cost.js）：光源求解每帧宽货架通道正中 1.4 ms、树前 0.7 ms（repair-r4 0.6 / 0.37 ms）；
  剖面第一次建约 2 ms 一个、一次 lightCtx 最多 8 个。每个面只细算光源投影周围 ±1.5 m 的格子，窗口外按这个面最亮的（漫反射 + 高光峰值）、窗口边或面矩形的距离给下界；每个挡体先拿最亮、最近、正对着
  估一个上界，比现有的松就不细算。标定（repair-r5 scripts/p_cal.js：浮点 RT 量线性亮度 / 屏幕路径量 sRGB，和模型比）：屏幕输出是线性值直接 sRGB 编码（245 ↔ 线性 0.913）；
  树干模型反照率 0.25 + 高光峰值 0.178，实测正对着量的 aEff 0.24–0.38（高光正好对上的那一点最高）；柱子绿漆 0.25（分通道以后），实测 0.19–0.22；货架下层托盘 0.61 + 高光，实测 0.70–0.74。
  `BR.forklift._light` 多了 ALB、albProf、albGet、surfCap、ambAt、texHi（测试和探针用）。
- 天花板 / 头顶条目的绝对上限（L-ceiling 的 eCeil 0.3、eOh 0.5）在两边有货架（goods 那一项有点）时放宽到「两边货里暗的那四分之一档的照度」（`LT.gCeil` 1.0 × I × gQ）：
  货架通道里一盏点光源照两边 2.8 m 外的货，头顶 3 m 的天花板必然差不多亮，按空地的上限卡，货永远只有 FE1Q 的一半（L-ceiling 裁定点名的是空地上前方 ≥6 m 开阔的 9 个位姿，
  那里没有货架，这一条不变；「天花板不比叉尖前 1 m 的地面亮」照旧）。
- L3 实测（tests/forklift_polish.mjs light 组，驾驶座截图 960×540、左右各 25% 宽、28–72% 高的区域，开灯减关灯的平均 Rec.601 亮度；FE1Q 和加 L3 之前两份基准是同一测试拿
  git HEAD 的 forklift.js / world.js / vehicles_net.js、repair-r4 改动前的 forklift.js 跑的）：宽通道正中左边 15.2（FE1Q 13.8，110%；加 L3 之前 4.7）、右边 16.8（FE1Q 20.0，84%；5.4），
  整幅画面开灯后新冒出的 ≥245 像素 0。测试那一点（叉尖前约 2.4 m、离地 1.2 m 朝通道的货）：通道正中 27.5（FE1Q 48.3、加 L3 之前 17.9）；L9c 56.3（FE1Q 78.1、加 L3 之前 45.2）；
  贴柱子那条道 43.2（FE1Q 86.1、加 L3 之前 51.0，85%）—— 这条道光源偏向右边（离左边货架 1.9 m）、强度按车前判定区要的给（4.0，没顶在封顶上），把货的权重调到 1.5、关掉天花板放宽都没更亮；
  同一套界限和不发白上限下暴力搜那一点的照度最多 1.86（现在 1.0），有位置能照得更亮但求解器要同时顾车前判定区、5 m 点、天花板和整排的货，没挑 —— 没做完，留在方案 risks[43]。forklift_polish L9 / L9c 断言：通道正中驾驶座画面两边都 ≥ FE1Q 的 80% 且比加 L3 之前亮、测试那一点比加 L3 之前亮；贴柱子那条道、L9c 测试那一点 ≥ 加 L3 之前的 80%；
  整幅画面新发白的像素 0；同一套界限、不发白上限下暴力搜那一点的照度上界（brute5 的 bestCap）只记录。
- L1 坐车人形的手套（_archetypes.js `hzSeatGlove`）：护腕和护腕上沿那圈黑胶带用 hazmat.glb 的 Gloves 护腕、Tape 那两块（`hzGlbParts` 多挑 glove / cuffAt），glb 的胳膊往外撇，
  按胶带环的平面法线（协方差最小的特征向量，Jacobi）定护腕的轴、转成竖直、挪到程序化前臂中线（高度不变，`hzCuffXf`）；手是圆的握拳：腕（圆台，比袖子粗一圈、把袖子末端包住）、
  手掌（扁椭圆柱，里面那一面离握点中心线 2.15 cm 贴着轮缘）、四根手指（圆管沿绕轮缘的圆弧从指根绕过轮缘底下到另一侧顶上，指尖半球，粗 2.1 cm、间隔 2.3 cm）、
  拇指（顺着轮缘压在上面），颜色照 glb Gloves。手指、拇指挂新骨骼 `grip<L/R>`（父骨骼前臂、原点在握点 handY − 0.04H）。coop.js `armIK` 多一个参数 tan：前臂绕自己的轴拧到本地 +z
  顺着轮缘切线（−s × 切线，拇指朝 12 点钟那边）；`poseSeat` 再让 grip 绕本地 x 转（轮缘在手里和前臂不垂直，转方向盘时斜 −32°…+15°）。握孔半径 2.15 cm（轮缘管 1.65 cm +
  5 mm：轮缘是半径 0.165 的弯，外面两根手指那里往轮心偏 3.6 mm）。tests/smoke.mjs 握方向盘那项按新手套判：手套 = 前臂、grip 骨骼上的 gear 顶点，轮缘截面四个方向都有（wrapped），
  离轮缘中心线最近 1.5–2.6 cm（以前「≤1 cm」是方块手插进轮缘管的判法）。11 个转角实测 1.66–1.67 cm、辐条和中心盖插进 0。
- L1 坐车人形的躯干（`hzGlbTorso`）：不再在脊柱转轴处拆成两截，躯干上的件（制服、腰带、扣、小包、拉链黑胶带、压条、胸背反光带）整块挂 hips，
  按顶点高度线性蒙皮到 spine（`RB.geo` 新选项 `{ blend: { bone, y0, y1 } }`，`prepGeo` 写两根骨骼的 skinIndex / skinWeight，权重大的排第一；`HZ_TORSO_BLEND` 1.03 → 1.30 smoothstep：
  腰带顶以下全跟胯、胸口以上全跟脊柱）。tests/smoke.mjs 加一项：胯 / 脊柱骨骼上同一位置（0.1 mm）的顶点权重都一样（拆两截时同一处一份挂胯一份挂脊柱），腰带上沿到胸口之间有按高度渐变的权重。
  坐车人形 15080 → 19064 面（手套 +4000 左右；拆两截时重复的那 11 cm 去掉了），场上最多一个，不算区块预算。
- L5 tests/coop.mjs：4b3 队友堵门两种情况、进帐篷那一次都不再固定睡 2.5 s，等到 A 页面里 `BR.coopCamp.debugInfo().peerSpeed`（新加：队友人形的平滑速度，堵门判断按 < 0.4 m/s 算站着）< 0.2；
  4c「客机 1 s 内收到同一份 state」墙钟上限乘 loadK；4e 最后半秒内的取消，房主已经出发回「不在同一层」、两人照样到了 Dev 也算「取消无效」；20 两页联机时钟各读 5 次取差最小的那一对、
  容差 0.3 s × loadK。tests/all.mjs：coop 的总时限按开跑时的负载 × 负载 / 核数（1–2 倍）。
- tests/all.mjs forklift-timing（照主会话 L8「只有负载 <4 时 T1 >8 ms 才报」）：等 15 分钟负载没降到核数一半以下的再多等 15 分钟；还降不下来就照样跑，
  这一遍只有计时类（T1 / T2 / T3、单次 page.evaluate ≤60 s）挂、而且跑的前后负载都高于核数一半时记成「负载高没真测」（loadskip，汇总里单列，不算失败）；别的检查挂了、或者负载降下来以后挂了照旧算失败。
