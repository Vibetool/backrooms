# 引擎能力补课清单（用户 2026-09-13 决定：所有层级做完之后统一执行，与已有实体的逐个画质打磨一起做）

来源：第一批（Level 0–3 + 13 种实体）各代理的 `notImplemented` 报告。只收录**引擎缺能力**导致没做出来、且后面几批大概率还会遇到的项；设定本身没写的、纯叙事的不收。

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

执行建议：A、B、C、D、H、I 是跨层级高频需求，优先；E、F、G 主要服务 Level 0，但 Level 0 是入口层、玩家第一印象，建议同批做；J、K 放最后。
每项完成后回到第一批对应的层级/实体把"未实现"补上，并在 `tests/` 里加对应的回归测试。
