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
js/game/items.js       物品注册 + 场景拾取物管理
js/game/player.js      玩家：位置朝向、HP/饥饿/san、背包、受伤、原地重生
js/game/world.js       层级载入、区块流式加载卸载、出口触发、层级切换
js/game/entities.js    实体管理：按密度生成、阵营战斗、AI 调度、清场
js/game/hud.js         顶部状态条、交互提示、背包栏、层级名提示
js/game/death.js       死亡结算：继续（原地重生）/ 返回主页
js/game/skin.js        制服颜色：主页换皮肤，测试人与联机对方同步
js/game/testmode.js    测试模式面板：手动放出实体、召唤测试人、清除全部
js/levels/_kit.js      层级搭建工具库 BR.kit（写法见 js/levels/_TEMPLATE.md），排在所有层级文件之前
js/levels/L0.js … L20.js, Lfun.js, Lrun.js
js/entities/<type>.js
js/items/<type>.js
js/net/net.js          复用火箭游戏的 WebRTC 信令（2 人）
js/net/coop.js         联机同步
js/ui/home.js          主页 3D 场景 + 菜单 + 参数面板
js/main.js             启动、状态机、主循环
```

## 2. 模式与数值（用户定死，不许改）

见 `js/core/base.js` 的 `BR.MODES`：

| 模式 | 实体攻击玩家 | 饥饿/san | 联机 | 实体数量（相对"正常后室"） |
|---|---|---|---|---|
| 游玩 casual | 否（友善 vs 有害仍互相作战） | 无 | 有 | 滑条 0–100% 映射到 0–50% |
| 噩梦 简单/中等/困难/地狱 | 是 | 有 | 无 | 0% / 20% / 40% / 60% |
| 测试 test | 否（但会攻击测试人；友善 vs 有害仍互相作战） | 无 | 无 | 不自动生成，测试面板手动放出 |

- 饥饿 < 20 → 移速 ×0.5；饥饿 = 0 → 移速 ×1/3（`BR.speedMulFromHunger`）。
- 所有模式都刷食物和杏仁水。
- 死亡：结算界面「继续」= 原地重生，背包保留，清除半径 `BR.config.death.clearRadius` 内的实体；「返回主页」。
- 设定冲突：每层/每个实体随机选一个来源版本整体采用，记录在 `data/lore-choices.json`，不混合。
- 主页弹窗按钮自上而下：「游玩」「噩梦生存」「测试模式」（前两个的顺序是用户指定的）。
- 测试模式：不自动生成实体（`BR.MODES.test.autoSpawn = false`，world.js 不调 spawnForChunk，物品照常刷）；按 T 或触屏按钮打开实体列表手动放出；可召唤测试人。
- 测试人（`test_dummy`，阵营 `dummy`）：穿玩家当前皮肤的制服；有害实体会攻击它，它不还手；以玩家步行速度的一半（`config.player.walk × 0.5`）随机游走；有 HP，被打死倒地后消失。
- 换皮肤：点主页场景里的人弹出色板（`BR.SKINS`：粉、蓝、黄、紫、绿、红），只换防化服材质，防毒面具、靴子、手套、胶带不变。选择存本机，测试人和联机对方看到的都是这个颜色。
- 联机语音：开麦/闭麦切换（默认闭麦），不是按住说话；显示自己和对方是否在说话。

## 3. 全局状态 `BR.game`（base.js 定义）

```
BR.game = {
  screen: 'home' | 'loading' | 'playing' | 'paused' | 'dead',
  mode: 'casual' | 'nightmare',
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
| `test:spawned` | `{ kind: 'entity' \| 'dummy', id, type }` |

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
}
```

- `inventory` 是定长 5 的数组，空格为 `null`（用掉一格后后面的物品不挪位）。
- 受伤闪屏要有冷却（持续掉 san 的光环不能把屏幕一直压红）。

```
```

## 9. 联机（仅游玩模式）

- 信令复用 `https://api.ovobot.ai/room.php`（host/guest 两人）。DataChannel 第一条消息 `{ t: 'hello', game: 'backrooms', v }`，game 不对就断开（房间码和火箭游戏共用号段）。
- 房主权威：`{ t:'world', seed, levelId, settings }`；实体只在房主模拟，10Hz 发 `{ t:'ents', list:[[id,type,x,z,yaw,state,hp]] }`；双方 15Hz 发 `{ t:'me', x,y,z,yaw,pitch }`。
- 实体行尾部可选列（2026-09-14，向后兼容）：`[id,type,x,z,yaw,state,hp, y?, flags?, infStage?]`。`y` 是 ENGINE_PLAN M4 快照 v2 预留的离地高度，目前写 `null`；`flags` 位表沿用 M4 草案，bit3（8）= 感染中；`infStage` 是感染阶段号（0 起）。没感染的行仍是 7 列。旧客机只读前 7 列，新客机收到 7 列当作没感染。感染的计时和转化只在房主，转化靠现有的删一个 id、增一个 id 同步。
- 拾取：客机发 `{ t:'pick', id }`，房主确认后广播 `{ t:'picked', id, by }`。
- 换层：任一方到达出口 → 房主广播 `{ t:'level', to }`，两人一起换层。
- 语音：开麦/闭麦切换，默认闭麦；V 键（input 的 `'mic'` 边沿动作）或 coop.js 自建的触屏麦克风按钮切换；对本地和远端音轨各接 AnalyserNode，coop.js 自建小角标显示"我在说话 / 对方在说话"。
- 皮肤：`hello` 消息带 `skin`，换皮肤时发 `{ t: 'skin', key }`，对方的人形用 `BR.skin.apply` 上色。

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
| js/levels/_kit.js, js/levels/_TEMPLATE.md | 层级工具库（层级代理只读；改接口先改 _TEMPLATE.md） |
| js/levels/*, js/entities/* | 调研完成后按层级/实体分派 |
| js/levels/Ldev.js, js/entities/_dev_*.js | 开发测试用（不进 LEVEL_ORDER，上线前删除） |
| js/game/skin.js | 主页 |
| js/game/testmode.js | 测试模式 |
| js/entities/test_dummy.js | 实体管理 |
| index.html, js/main.js, css/base.css | 集成 |
| css/coop.css | 联机 |
| tests/<模块>.html | 各模块自测页，可选 |

## 11. DOM 规则

- `index.html` 只放 `<canvas id="gl">` 和 `<div id="ui">`。所有 UI 模块**自己用 JS 在 `#ui` 里创建 DOM**，不依赖 index.html 里的其他元素，这样并行开发互不冲突。
- 每个 UI 模块的根节点带自己的 class 前缀（`home-`、`hud-`、`death-`、`coop-`、`touch-`），CSS 只写带前缀的选择器。
- z-index：画布 0，gfx 低 san 覆盖 10，touch 控件 20，HUD 30，说话角标 35，gfx 闪屏 40，主页 50，测试面板 52，gfx 淡入淡出 55，结算/暂停 60，皮肤色板 70，联机弹窗 80，toast 90。
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
held(action): bool                     'sprint' 'use' 'interact'
locked; sensitivity                    是否已锁定指针（只读）；视角灵敏度倍率 0.2–3（localStorage）
                                       麦克风和测试面板的触屏按钮分别由 coop.js、testmode.js 自建，不归 input
endFrame()                             主循环末尾调用
lock()                                 桌面请求指针锁定
isTouch: bool                          触屏时自动显示左摇杆、右侧滑动视角、互动/使用/冲刺/暂停按钮
```

### BR.phys（js/core/phys.js）
```
addSolids(key, solids); removeSolids(key); clear()
moveCircle(x, z, r, dx, dz, yFeet?, height?): { x, z, hitX, hitZ, hit }   带滑动的圆形碰撞；同 key 再 addSolids 是替换
los(ax, ay, az, bx, by, bz): bool      true = 视线通畅（起点在盒子里算被挡）
raycast(ox, oy, oz, dx, dy, dz, max): { dist, x, y, z, nx, ny, nz } | null
overlapCircle(x, z, r, yFeet, height): bool   出生/重生/放实体前检查落脚点
groundY(x, z): number                  默认 0；层级在 enter 里 setGroundFn(fn) 覆盖（clear() 会重置 groundFn）
                                       没有自动上台阶：高度变化走 groundFn，低矮盒子会直接挡住
```

### BR.player（js/game/player.js）见第 8 节，另加：
```
update(dt)                             读 input、走 phys、按 statsEnabled 结算饥饿/san
interactTarget(): pickup | null        准星附近 2 m 内最近的拾取物
```

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
```

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
- 联机：联机只在游玩模式，实体不打玩家，房主的实体也不以客机为目标，所以客机玩家没有感染通道；实体的感染症状经快照尾列同步。
- 实体行为里的用法：`onAttack(e, t, api) { if (api.isHuman(t)) api.infect(t, SPEC, e); }`；`api.transform` 同 `BR.entities.transform`。

### BR.hud（js/game/hud.js）
```
init(); show(bool); update(dt)         顶部：san、饥饿、HP（仅 statsEnabled）；背包栏；准星；互动提示
toast(text, ms?); levelTitle(level); prompt(text | null)
pause(bool)                            暂停菜单：继续 / 能见度 / 返回主页（emit 'game:home'）
```

### BR.death（js/game/death.js）
```
show({ cause, levelId, time, deepest })   「继续」emit 'death:continue'；「返回主页」emit 'game:home'
hide()
```

### BR.home（js/ui/home.js）
```
init(); show(); hide()
开始游戏时 emit 'game:start' { mode, difficulty, settings, seed, coop: null | { role } }
```

### BR.coop（js/net/coop.js）
```
init(); openLobby(); update(dt); active; role
mic: bool; setMic(on)                  开麦/闭麦
localSpeaking; peerSpeaking            0..1 音量电平（AnalyserNode）
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
面板按层级分组列出 `BR.entityTypes.all()`（跳过 `_dev_*` 和 `test_dummy`），可搜索；打开面板时 `BR.input.enabled = false`。

### 开发测试
- `js/levels/Ldev.js`：id 'dev'，简单黄色迷宫，用来测流式加载/碰撞/灯光预算。
- `js/entities/_dev_hostile.js`、`_dev_friendly.js`：色块实体，用来测阵营战斗。

## 13. 补全批次与第二波地基新增的模块（2026-09-13）

详细签名以各自的写法说明为准，这里只列入口，避免两处文档不一致。

| 全局 | 文件 | 说明 |
|---|---|---|
| `BR.kit` | js/levels/_kit.js | 层级搭建：`builder(ctx,cx,cz,rng)`、`mat`、`grid`/`gridWalls`/`gridSpawns`（跨区块无缝，默认墙厚 0.267 m）、`trims.yellowWood`（黄色墙纸房间的黄木矮踢脚线）、`prop.*` 29 种构件、`exit`（首期范围外自动 sealed、noclip、event 可 setActive）、`heightField`、`loreKey`。写法见 **js/levels/_TEMPLATE.md** |
| `BR.arch` | js/entities/_archetypes.js | 实体行为骨架（stalker/pack/flyer/ambush/mimic/lightBound/wanderer/guide/swarm/hazardEntity）、模型构件 `parts.*`、动画 `anim.*`。写法见 **js/entities/_TEMPLATE.md** |
| `BR.itemKit` | js/items/_kit.js | 物品共用：小模型、图标、数值结算（只在 statsEnabled 时生效）、分次食用、投掷；`LORE_HOUR` = 设定 1 小时对应游戏 60 秒 |
| `BR.effects` | js/items/_effects.js | 时效效果：`add({key,seconds,speedMul,hpPerSec,sanityPerSec,hungerPerSec,visual,negative,tags})`、`update(dt)`、`speedMul()`、`clear({negative})`。player.speed() 乘 speedMul；原地重生只清负面效果；换层不清（防止走出口解毒）。分阶段病（2026-09-14）：`stages[i].cureTags`（该阶段能治它的解药标记，空数组 = 无药可救）、`onExpire: 'death' \| 'transform:<type>'`（lethalAtEnd 是 death 的别名；transform 对玩家也是致死，死因取 cause）、`cureToast`、`cure(tags)`、`cureByItem(def)`（食物类别 → 'food'，杏仁水及彩色瓶 → 'almond_water'，外加物品 def 的 `cureTags`） |

加载顺序补充：`js/game/items.js → js/items/_kit.js → js/items/_effects.js → 其余物品`；`js/game/entities.js → js/entities/_archetypes.js → 各实体`；`js/game/world.js → js/levels/_kit.js → 各层级`。

实体定义可选钩子（entities.js 已支持）：`init(e, api)`、`animate(e, dt, api)`（房主和客机每帧都跑，只做表现）、`onHit(e, amount, attacker, api)`、`onDeath(e, api) → 尸体保留秒数`、`dispose(e)`、`attack.entityHp`、`human: true`（人类目标：感染类攻击只对它和玩家生效）。
`BR.entities` 额外：`get(id)`、`remove`、`damage`、`kill`、`count()`、`infect`、`transform`、`isHuman`（见第 12 节）；`spawn` 的 opts 支持 `yaw`、`from`、`force`、`manual`（手动放出的不随区块卸载、不受 maxActiveEntities 限制）。

联机打洞：`net.js` 默认 ICE 为小米 STUN → Google STUN → Cloudflare STUN；设置 `BR.config.iceServers` 可整体覆盖（将来加 TURN 中继就在这里配）。

数据文件：`data/lore-choices.json`（每个层级/实体/物品随机选中的来源）、`data/entity-index.json`（实体清单、各层环境危害）、`data/item-spawn.json`（物品建议密度与出现层级）、`data/credits.json`（署名）。

测试：`tests/smoke.mjs`（单机流程）、`tests/coop.mjs`（双浏览器联机）、`tests/items.mjs`（物品）、`tests/kit.mjs`（层级工具库）、`tests/preview.mjs`（按层级/实体出截图与统计，第二波验收用）、`tests/phys.test.js`。

## 14. 创意工坊与设置（2026-09-13 新增）

需求、数据格式、钩子与界面约定见 **WORKSHOP.md**。要点：`BR.workshop`（js/game/workshop.js，地图数据 + 本机存储 + 钩子，未激活时所有钩子为空操作）、`BR.workshopUI`（js/ui/workshop.js）、`BR.settingsUI`（js/ui/settings.js）；
`game:start` 新增 `workshop` 字段；`_kit.js` 的 gridWalls / exit / Builder.finish 各有一个工坊钩子；`audio.js` 新增 `setAmbientVolume`、`setSfxVolume`；`coop.js` 新增 `setVoiceVolume` 与 `workshopMap` 同步。
