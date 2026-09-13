# 第二波：层级与实体（调研完成后执行）

前置：`ARCHITECTURE.md` 的接口不变；第一波引擎已集成并通过冒烟测试。

## 1. 先定版本

1. 调研全部落盘后运行 `python3 tools/pick_versions.py`，生成 `data/lore-choices.json`。
2. 规则（用户原话"若有冲突随机选择不要折中"）：有冲突用 SystemRandom 整体选一个来源版本；无冲突取信息最全的版本。结果固定，不重掷。
3. 每个层级文件、实体文件的 `version` 字段必须等于 lore-choices 里的 `source`，只照该版本实现，**不许**从其他版本借细节。

## 2. 第一波之后的改动

> 2026-09-12 更新：第一波因会话额度中断，下面的开麦、测试模式、换皮肤已并入补全批次（wave1b）直接实现，接口写进了 ARCHITECTURE.md 第 2、6、9、12 节。第二波只剩层级与实体。以下保留作需求出处。

- **语音改为开麦**（用户 2026-09-12 补充）：联机时开麦/闭麦切换，默认闭麦；V 键和触屏按钮都是切换；HUD 显示"我在说话 / 对方在说话"（对远端音轨接 AnalyserNode 做音量检测）。
  涉及 `js/core/input.js`（'talk' 改为 pressed 边沿动作，`showTalk` 改名 `showMic` 并显示开/关状态）、`js/net/coop.js`、`js/net/net.js`、`js/game/hud.js`，同步更新 ARCHITECTURE.md 第 9、12 节。
- **测试模式**（用户 2026-09-12 补充）：
  - 入口：主页弹窗第三个按钮「测试模式」，排在「噩梦生存」下面（用户指定的上下顺序不动）。参数面板同游玩：能见度、起始层级（没有实体生成量滑条）。
  - 规则：`BR.MODES.test = { attackPlayers:false, statsEnabled:false, coop:false, autoSpawn:false }`。world.js 在 `autoSpawn === false` 时不调 `spawnForChunk`；物品照常刷（所有模式都刷食物和杏仁水）。
  - 实体列表：新模块 `js/game/testmode.js`（前缀 `test-`），按层级分组列出 `BR.entityTypes.all()`，可搜索，点一下在准星前方可落脚处放出；另有「召唤测试人」与「清除全部」。桌面 T 键、触屏右侧按钮打开。
  - 测试人：阵营 `dummy`（新增）—— 有害实体把它当玩家一样攻击，友善实体不攻击它，它不反击；速度 = `BR.config.player.walk × 0.5` 随机游走；模型用 hazmat.glb，颜色取玩家当前皮肤；有 HP，被打死倒地数秒后消失，emit `entity:kill`。
  - 需要改：base.js（MODES、阵营说明）、entities.js（`findTarget` 纳入 dummy 目标、`autoSpawn`）、world.js、home.js、hud.js（测试工具按钮）、input.js（'testmenu' 动作）、ARCHITECTURE.md 第 2、6、12 节。
- **换皮肤**（同日补充）：
  - 主页点击场景里的人（射线命中 hazmat 模型）弹出色板：粉、蓝、黄、紫、绿、红。只改防化服黄色那一个材质；防毒面具、靴子、手套、胶带不变。
  - hazmat.glb 里防化服必须是独立材质（检查第一波导出结果，材质名不明确就改 tools/blender_hazmat.py 命名为 `Suit` 重新导出）。
  - `BR.skin = { colors: {...}, current, set(key), apply(object3d) }`，存 localStorage `backrooms_skin`。
  - 生效范围：主页人物、测试人、联机时对方看到的自己（hello 消息带 skin，换色时发 `{t:'skin'}`）。

## 3. 出口策略

- 目标层级在首期范围内（0–20、fun、run）：真实换层。
- 目标层级超出范围（如 Level 27、63、139、The Void）：出口实物照版本描述摆出来（门、电梯、楼梯、裂缝），靠近时提示"Level X 尚未开放"，**不**改成通往别的层级。
- 切出（noclip）类出口：墙面局部轻微闪烁/错位，玩家贴着走进去触发，带撕裂音效与画面故障。
- 条件类出口（走得够久、灯光同步闪烁时出现门等）：在 `level.update` 里按版本描述实现触发条件。

## 4. "正常后室"实体数量基线

- 版本给了数字 → 按数字换算成 `officialPer1000m2`，在层级文件注释里写清换算过程。
- 只有定性描述 → 用 `BR.config.densityWords`（none/rare/low/moderate/high/extreme）。
- 版本说"没有实体" → 该层 `entities: []`，不为了热闹加实体。
- 敌友：`hostile`→有害，`friendly`→友善，`neutral`/`unknown`→中立；`varies` 按选中版本原文判断。
  选中版本里某层没有友善实体，那一层就不会出现友善 vs 有害的战斗 —— 不虚构友善实体。

## 5. 实体实现

- `js/entities/_archetypes.js`：共用行为骨架 —— 追猎者（人形追逐）、群猎（猎犬类）、飞行群（飞蛾类）、伏击/静态陷阱（窗户、黑暗里的笑魇）、拟态（窃皮者、无面者）、光敏/惧光、环境现象型。
- 每个实体一个文件：数值（HP、速度、感知、攻击、光环）+ 模型（程序化 three.js，重要实体可 Blender 出 GLB）+ `think` 调骨架并按版本描述定制。
- 外形、声音、攻击方式、弱点都要能在选中版本里找到出处。

## 6. 层级实现

每层一个文件 `js/levels/L<id>.js`，要求：

- 区块生成只依赖传入的 rng；每区块合并成少量 mesh；灯光按描述（色温、闪烁、无光区）。
- 版本里的地标/特殊区域以一定概率出现在区块中（例如 Level 0 的红色房间、坑洞区，按选中版本取舍）。
- 危害与特殊规则照版本实现：Level 6 无光、Level ! 追逐、Level Fun 派对等，以选中版本为准。
- 环境音预设、雾、环境光、san/饥饿消耗倍率。
- 物品表：所有层都要有食物和杏仁水（用户要求，所有模式都刷）；版本里另有的补给照加。
- 每层文件顶部注释：来源版本、URL、许可 CC BY-SA 3.0。

素材：每层需要的新贴图走 `tools/textures/gen.sh`（GPT-IMAGE-2 + 无缝处理），总包体控制在合理范围，手机优先。

## 7. 验收

- 每层截图（出生点、地标、实体、出口）人工查看。
- 冒烟测试沿出口链走一遍，确认换层、实体数量随模式缩放（游玩满格 = 50%，噩梦 简单/中等/困难/地狱 = 0/20/40/60%）。
- 游玩模式确认实体不打玩家、友善/有害仍互打；噩梦模式确认会攻击玩家。
- `data/credits.json` 汇总全部来源 URL 与许可，主页署名可点开查看。
