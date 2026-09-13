# 引擎能力补课清单（用户 2026-09-13 决定：所有层级做完之后统一执行，与已有实体的逐个画质打磨一起做）

来源：第一批（Level 0–3 + 13 种实体，A–K）、第二批（Level 4–7 + 7 种实体，L–U）各代理的 `notImplemented` / `apiRequests` 报告。只收录**引擎缺能力**导致没做出来、且后面几批大概率还会遇到的项；设定本身没写的、纯叙事的不收。

不在本清单：M.E.G. 基地与交易（用户决定挂上大厅后单独做）、NPC 对话（用户决定不做）、枪械/负重（选中版本里只是建议性描述）。

| # | 能力 | 第一批里卡住的 | 建议接口 | 归属文件 |
|---|---|---|---|---|
| A | 持续状态与感染/变异 | 猎犬咬伤 20–30 分钟后变异、5 分钟内杏仁水冲洗可解；笑魇怕火；Level 0 污染杏仁水与地毯纤维致病 | 扩展 `BR.effects`：`stages`（按时间切换症状）、`cureTags`（物品 use 时清除带某 tag 的效果）、`onExpire: 'death' \| 'transform:<type>'`；实体侧 `BR.entities.addEffect(e, {...})`（燃烧、中毒） | js/items/_effects.js、js/game/entities.js、js/game/player.js |
| B | "是否被注视"查询 | Level 1 画作/木箱不被注视时消失、自然锁被注视时消失；Level 0 走廊在不被观察时变形 | `BR.view.isObserved(x, y, z, r)`：相机视锥 + `phys.los`，联机时把对方相机也算进去（对方位姿已同步） | 新增 js/core/view.js、js/net/coop.js |
| C | 按区域/标签限定刷怪 | Level 1 影子工人只出现在衔尾宏区 | 层级 entities 条目加 `tags: ['ouroboros']` 或 `where(cx, cz)`；`spawnForChunk` 只在匹配 tag 的 spawnPoints 上生成，密度按匹配面积折算 | js/game/entities.js、js/game/world.js |
| D | 竖直方向的移动与攻击 | 钝人隔墙伸手；Nguithr'xurh 从天花板坠落；肢团爬墙钻通风管；牧蛇钻地 | `api.moveToward(e, x, z, speed, { mode: 'ceiling' \| 'wall' \| 'burrow' })`（忽略地面碰撞、贴天花板/墙面走）；`attack.throughWalls`、`attack.fromAbove` | js/game/entities.js、js/core/phys.js |
| E | 真正封闭的区域 | Level 0 红房间进去出不来；Level 3 铁栏杆不可拆 | `BR.kit.grid` 增加 `pockets`：主通路之外允许生成封闭口袋，入口是单向触发（进去后入口封死）；栏杆做成真实碰撞体但保证主通路另有绕行 | js/levels/_kit.js |
| F | 联机"孤立效应" | Level 0：两人同层却互相找不到、沟通无效，仅一个小房间例外 | 层级 `env.coopIsolation: true` → coop 隐藏对方人形与名牌、静音语音；层级可按区域标记例外 | js/net/coop.js |
| G | 运行时布局变化 | Level 0 Peripheral Shift（不被观察时布局重排） | 世界"位移纪元"：区块种子带 epoch，房主推进 epoch 并广播，只重建当前不被观察（依赖 B）的区块，碰撞体/物品/实体一并重建 | js/game/world.js、js/net/coop.js |
| H | 按层覆写实体行为 | Level 2 实体改为一路猛冲、不再保存体力 | 层级 entities 条目加 `overrides: { speed, brain }`，spawn 时合并到实例 | js/game/entities.js |
| I | 实体生成实体 | 肢团受伤掉下的肉块长成新肢团 | `api.spawn(type, x, y, z)`，受 maxActiveEntities 与每实体繁殖上限约束 | js/game/entities.js |
| J | 蹲伏与窄道 | Level 3 需要弯腰/侧身通过的窄走廊 | 玩家蹲伏（C 键 / 触屏按钮，眼高 1.0 m、碰撞高 1.1 m）；kit 窄道构件带低矮顶棚碰撞体 | js/game/player.js、js/core/input.js、js/levels/_kit.js |
| K | 天气粒子 | Level 2 降雪 | `BR.gfx.weather({ type: 'snow' \| 'rain' \| 'dust', intensity })`，跟随相机的粒子盒，低画质减量 | js/core/gfx.js |
| L | 手持光源 / 手电 | Level 6「光源一带进来就熄灭」只能靠极低环境光近似；观察者「手电照射可能离开」、七层之物「用光照射可暂时制服」都没有定向光可判 | 玩家光源：相机下固定一盏 SpotLight（占灯池 1 个名额），开关/电量，层级可强制熄灭 `BR.player.snuffLight(sec)`；`BR.view.litBy(target)` 判断手电是否照到目标 | js/game/player.js、js/core/gfx.js、js/core/input.js |
| M | 水体与游泳 | Level 7 海面只能当可走地面、深度分带靠高度场竖井；Tiny 分不清水和陆地，只能用领地半径近似；七层之物用飞行高度模拟沉浮；没有落水/冒泡音色；`kit:water` 单面，水下看不到水面 | `BR.world.waterAt(x, z) → { surfaceY, depth }`；玩家游泳模式（浮力、下潜、氧气条，噩梦才扣血）；实体 `api.inWater(e)`；水材质双面 + 水下雾色；音效 `splash` `bubble` | js/game/player.js、js/game/world.js、js/levels/_kit.js、js/core/audio.js |
| N | 多层竖向结构 | Level 6「地表 → 地下管道 → 深层洞穴」只能做成同一平面上的宏区域；金属栈桥下面是实地没有跌落；Level 7「没有绳索回不去」做不成硬门槛（高度场对任何落差都贴地上升） | grid 按 `floor` 分层（每层独立碰撞与区块），楼梯/竖井连接；`phys` 加可跨越台阶高度上限，配合绳索/梯子道具 | js/core/phys.js、js/levels/_kit.js、js/game/world.js |
| O | 对目标施加控制效果 | Tiny 喷焦油让猎物减速、迷惑；Level 6 微睡眠只能给玩家本人加减速 | 与 A 项合并：`api.applyEffect(target, { key, seconds, speedMul, blind })`，玩家和实体通用、联机同步 | js/game/entities.js、js/items/_effects.js |
| P | 门/出口的运行时状态 | Level 4 出口「移开视线后可能消失」只能停用触发点，楼梯间/电梯外观还在；Level 5 客房门随时间解锁、随机开合只能建块时定死；电梯没有楼层选择（1–12 楼内部传送、13 楼以上出事） | kit 出口/门返回句柄：`setVisible(bool)`、`setLocked(bool)`、`open(t)`；电梯楼层面板 UI（按楼层号走不同出口/事件） | js/levels/_kit.js、js/game/hud.js |
| Q | 地标贴着出口、实体限定房型 | Level 4 M.E.G. 基地应该在通往 Level 5/6 的出口旁；Level 5 萨曼莎只在主厅、牧蛇只在锅炉房 | `g.reserveNear(exitId, radius)` 让地标挑出口附近的格子；刷怪按房型/宏区过滤（和 C 项一起做） | js/levels/_kit.js、js/game/entities.js |
| R | 实体影响环境 | 尸鼠「尖叫事件」时整层灯光闪烁 | `api.levelEvent('flicker', { radius, seconds })`，交给层级/gfx 在灯光预算内处理 | js/game/entities.js、js/core/gfx.js |
| S | 实体局部材质控制 | Tiny 眼睛亮度随环境光变化（只改眼睛，不改整个 glow 槽位） | onFrame 里 `u.slotMat(slot)` 拿到本实例该槽位的独立材质（按需克隆） | js/entities/_archetypes.js |
| T | 穿墙感知 | 萨曼莎「读心/透视」应能隔墙发现目标 | `perception.xray: true` → 索敌跳过 `phys.los` | js/entities/_archetypes.js |
| U | 通用贴图与小道具 | Level 5 黑胡桃木地板/白色大理石只能拿地毯贴图染色；观察者「无法被拍照」没有相机道具 | 生成 `wood_floor`、`marble` 等通用贴图进 MANIFEST；相机道具放到物品批次 | assets/tex、js/core/assets.js、js/items/ |

执行建议：A、B、C、D、H、I 是跨层级高频需求，优先；E、F、G 主要服务 Level 0，但 Level 0 是入口层、玩家第一印象，建议同批做；J、K 放最后。
第二批新增里 L（手电）、M（水体）、N（多层结构）后面的黑暗层、水域层、多层建筑还会反复遇到，建议和 A–D 同批优先；O 与 A、Q 与 C 合并实现；P、R、S、T、U 放后面。
每项完成后回到第一批对应的层级/实体把"未实现"补上，并在 `tests/` 里加对应的回归测试。
