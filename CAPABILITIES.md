# 引擎能力补课清单（用户 2026-09-13 决定：所有层级做完之后统一执行，与已有实体的逐个画质打磨一起做）

来源：第一批（Level 0–3 + 13 种实体，A–K）、第二批（Level 4–7 + 7 种实体，L–U）、第三批（Level 8–11 + 13 种实体，V 起）各代理的 `notImplemented` / `apiRequests` 报告。只收录**引擎缺能力**导致没做出来、且后面几批大概率还会遇到的项；设定本身没写的、纯叙事的不收。

不在本清单：M.E.G. 基地与交易（用户决定挂上大厅后单独做）、NPC 对话（用户决定不做）、枪械/负重（选中版本里只是建议性描述）。

| # | 能力 | 第一批里卡住的 | 建议接口 | 归属文件 |
|---|---|---|---|---|
| A | 持续状态与感染/变异（部分完成：悲尸感染转化，见 BR.entities.infect） | 猎犬咬伤 20–30 分钟后变异、5 分钟内杏仁水冲洗可解；笑魇怕火；Level 0 污染杏仁水与地毯纤维致病 | 扩展 `BR.effects`：`stages`（按时间切换症状）、`cureTags`（物品 use 时清除带某 tag 的效果）、`onExpire: 'death' \| 'transform:<type>'`；实体侧 `BR.entities.addEffect(e, {...})`（燃烧、中毒） | js/items/_effects.js、js/game/entities.js、js/game/player.js |
| B | "是否被注视"查询 | Level 1 画作/木箱不被注视时消失、自然锁被注视时消失；Level 0 走廊在不被观察时变形 | `BR.view.isObserved(x, y, z, r)`：相机视锥 + `phys.los`，联机时把对方相机也算进去（对方位姿已同步） | 新增 js/core/view.js、js/net/coop.js |
| C | 按区域/标签限定刷怪 | Level 1 影子工人只出现在衔尾宏区 | 层级 entities 条目加 `tags: ['ouroboros']` 或 `where(cx, cz)`；`spawnForChunk` 只在匹配 tag 的 spawnPoints 上生成，密度按匹配面积折算 | js/game/entities.js、js/game/world.js |
| D | 竖直方向的移动与攻击 | 钝人隔墙伸手；Nguithr'xurh 从天花板坠落；肢团爬墙钻通风管；牧蛇钻地 | `api.moveToward(e, x, z, speed, { mode: 'ceiling' \| 'wall' \| 'burrow' })`（忽略地面碰撞、贴天花板/墙面走）；`attack.throughWalls`、`attack.fromAbove` | js/game/entities.js、js/core/phys.js |
| E | 真正封闭的区域 | Level 0 红房间进去出不来；Level 3 铁栏杆不可拆 | `BR.kit.grid` 增加 `pockets`：主通路之外允许生成封闭口袋，入口是单向触发（进去后入口封死）；栏杆做成真实碰撞体但保证主通路另有绕行 | js/levels/_kit.js |
| F | 联机"孤立效应" | Level 0：两人同层却互相找不到、沟通无效，仅一个小房间例外 | 层级 `env.coopIsolation: true` → coop 隐藏对方人形与名牌、静音语音；层级可按区域标记例外 | js/net/coop.js |
| G | 运行时布局变化 | Level 0 Peripheral Shift（不被观察时布局重排） | 世界"位移纪元"：区块种子带 epoch，房主推进 epoch 并广播，只重建当前不被观察（依赖 B）的区块，碰撞体/物品/实体一并重建 | js/game/world.js、js/net/coop.js |
| H | 按层覆写实体行为 | Level 2 实体改为一路猛冲、不再保存体力 | 层级 entities 条目加 `overrides: { speed, brain }`，spawn 时合并到实例 | js/game/entities.js |
| I | 实体生成实体（部分完成：悲尸感染转化，见 BR.entities.infect） | 肢团受伤掉下的肉块长成新肢团 | `api.spawn(type, x, y, z)`，受 maxActiveEntities 与每实体繁殖上限约束 | js/game/entities.js |
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
| V | 远程/范围攻击 | 邻里守望·守望者的光束秒杀只能用超大近战 `attack.range` 近似 | `attack: { kind: 'beam' \| 'projectile', range, width, windup }`，带视线判定与前摇特效；联机只同步发射事件 | js/game/entities.js、js/entities/_archetypes.js |
| W | 玩家对实体的交互 | 灌篮崽「轻敲鼻子驯服后跟随」；杰瑞「喂向日葵种子/杏仁水驯服」；幸运纸鹤「可轻轻拿起清理」 | 对准实体按 E 触发 `def.onInteract(e, player, heldItem, api)`；驯服后实体切到 `A.companion` 骨架跟随玩家 | js/game/player.js、js/game/entities.js、js/entities/_archetypes.js |
| X | 实体把目标带去别的层 | 杰瑞把被教化的人送去杰瑞厅；传送者接触后切入墙体、几分钟后把人投送到目的层 | `api.sendToLevel(target, levelId, { delaySec })`：玩家走层级出口同一套流程（含未开放判定、联机由房主广播），测试人/实体直接移除 | js/game/entities.js、js/game/world.js、js/net/coop.js |
| Y | 实体之间的捕食/畏惧关系 | 受眷鸟只捕食雄性死亡飞蛾；死亡飞蛾/钝人/地栖怪捕食旱虾；猎犬、笑魇等畏惧邻里守望 | `def.relations: { prey: [type], fear: [type] }`：索敌时 prey 越过阵营规则可攻击、fear 进入视野就逃；两边文件都不用互相改 | js/game/entities.js、js/entities/_archetypes.js |
| Z | 噪音诱饵与投掷物 | 迷彩爬行者失明靠听觉，原文弱点是「扔东西制造声响把它引开」 | 玩家可投掷背包物品 → 落点 `BR.bus.emit('noise', { x, z, loudness })`，`A.hearPlayer` 类感知同时响应噪音点 | js/game/player.js、js/game/items.js、js/entities/_archetypes.js |
| AA | 隐身/瞬移表现、持久地面痕迹 | 观察者「被清楚察觉就消失」只能隐藏模型+改坐标；磨损者走过留下墨色腐蚀痕迹 | `A.fx.vanish(e)` / `A.fx.appear(e)`（淡出+粒子）；`BR.world.decal(x, z, { ttl })` 区块级贴花池（数量上限、随区块卸载） | js/entities/_archetypes.js、js/game/world.js |
| AB | 骨架小钩子 | `A.ambush` 分不出扑空/扑中（迷彩爬行者「扑空才嚎叫」）；`A.guide` 不能穿墙（微光向导「穿过墙和物体」） | `A.ambush({ onMiss, onCatch })`；`A.guide({ noclip: true })` 走无碰撞移动 | js/entities/_archetypes.js |
| AD | 模型上的文字与贴花 | Level 13「写着 235 的门」「残迹牌子上的字」只能用 HUD label 代替；Level 15 符文管道、各层据点招牌看不到具体文字 | `kit.prop.sign(b, x, z, rot, { text, font, color })` 用 CanvasTexture 画字（按文本缓存材质）；通用贴花 `kit.prop.decal({ texKey \| canvas })` | js/levels/_kit.js |
| AE | 跨层持续的减益/状态 | Level 12「离开本层后一段时间难以与人正常交流」；Level 14 刑讯室/污染的后遗症 | `BR.effects` 支持 `persistAcrossLevels: true`，换层不清除；联机时同步对方可见的状态图标 | js/items/_effects.js、js/game/world.js、js/net/coop.js |
| AF | 层级 env 动态值与工坊覆盖 | Level 12「离桌椅越远越糟」直接改 ENV 对象，工坊地图启用 env 覆盖时拷贝了一份，改动传不过去 | `env.sanityDrainMul` 等允许函数 `(ctx) => number`，player 每帧读；或 `BR.world.setEnvValue(key, v)` 统一改当前生效的 env | js/game/world.js、js/game/player.js、js/game/workshop.js |
| AG | 画面整体晃动/层级位移 | Level 17「整艘船缓慢移动、偶尔摇晃」只能用音效近似 | `BR.gfx.shake({ amp, freq, seconds })` 相机叠加位移（不改玩家碰撞坐标）；层级可设常驻轻微摇摆 `env.sway` | js/core/gfx.js |
| AH | 有限大小的层级 | Level 17 是面积有限的巨型货船，引擎只能做成无限流式区块 | 层级 `bounds: { minCx, maxCx, minCz, maxCz }`：界外区块不生成，边缘自动封墙/水面 | js/game/world.js、js/levels/_kit.js |
| AI | 场景道具交互与跌落 | Level 17 舵轮「能转但不改航向」、轮机舱机器「运转但不可操作」；Level ! 走廊地面坑洞只能用触碰范围+扣血近似，没有真正掉下去 | 与 W 合并：`kit.prop.*({ onInteract })` 按 E 触发；玩家垂直速度 + 落差伤害（配合 N 的多层结构） | js/game/player.js、js/core/phys.js、js/levels/_kit.js |
| AC | 杂项 | Level 10「土层只有 1 米、挖深了涌出蠕虫」没有挖掘动作；幸运纸鹤「被幸运的人吸引」没有运气属性；受眷鸟的化学感受器；Level 9「电器在本层不能用」没有按层禁用物品的标记；Level 11「车换了喷嘴和油泵就能开」没有载具、「在沙房间里睡着就会被传走」没有睡觉/静止判定、「没人看着时车辆挪位/广告换画」依赖 B 项 | 挖掘交互（铲子类物品）；`BR.player.luck`；`perception.smell` 扩展到信息素；层级 `env.disabledItemTags: ['electronic']`；载具（后期）；`BR.player.idleSec` 静止计时 | 多处，逐项评估 |

执行建议：A、B、C、D、H、I 是跨层级高频需求，优先；E、F、G 主要服务 Level 0，但 Level 0 是入口层、玩家第一印象，建议同批做；J、K 放最后。
第二批新增里 L（手电）、M（水体）、N（多层结构）后面的黑暗层、水域层、多层建筑还会反复遇到，建议和 A–D 同批优先；O 与 A、Q 与 C 合并实现；P、R、S、T、U 放后面。
每项完成后回到第一批对应的层级/实体把"未实现"补上，并在 `tests/` 里加对应的回归测试。
