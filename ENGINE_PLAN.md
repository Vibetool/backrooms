# 后室 · 下一阶段计划：实体画质打磨 + 引擎补课（ENGINE_PLAN）

> 2026-09-14 编写。由三份独立规划（玩家体验优先 / 技术依赖优先 / 回填优先）合并而成。
> 能力编号 A–AI 对应 CAPABILITIES.md。本文件是执行顺序与接口草案；动手时接口以 ARCHITECTURE.md 与两份 _TEMPLATE.md 为准，每个里程碑完工时同步更新这三份文档和 CAPABILITIES.md 的状态。

---

## 0. 总览

**现状**：提交 0c64537，首期全部完成：23 个层级、57 种实体、32 种物品，游玩 / 噩梦生存 / 测试三种模式，2 人联机开麦，创意工坊与设置，线上 23/23 层 0 报错。

**阶段目标**（用户确认的顺序）：
1. 已有实体逐个画质打磨：沿用立体图形堆叠，多加形状，让实体和人更有细节。
2. CAPABILITIES.md 引擎补课：A–AI，每项做完回到对应层级 / 实体，把"未实现"补上。
3. 以上两项完成后，再做 M.E.G. 基地与交易。NPC 对话不做。

两件事穿插进行，不是先做完全部打磨再补引擎。

**执行顺序原则**（按优先级）：
1. **依赖不能违反**：联机事件通道先于所有"房主判定、客机执行"的能力；多层结构先于水体和贴天花板移动；交互注册表先于门和梯子。
2. **满足依赖后，玩家体验优先**：前 30 分钟会遇到的内容（L0–L3 的实体、入口层机制）排前面，深层内容排后面。
3. **每个里程碑尽量多关闭"未实现"**：优先选能一次回填较多文件的能力。
4. **引擎与打磨交替**：最多连续两个引擎里程碑，就插一批画质打磨，让用户持续看到进度。
5. **新能力一律可选、默认旧行为**：23 层和 57 种实体不改代码也要照常运行。用 golden 世界哈希和"未改动类型像素差为 0"两道闸门证明。
6. **设定规则不变**：冲突随机选版本、不许折中；知名实体的选中版本和经典形象冲突时，先问用户。

**额度约束下的节奏**：
- 每个里程碑用一个 ≤10 个代理的流水线完成，做完就能单独发布（全量测试 + 线上实测）。
- 代理默认用 sonnet。只有标注的高风险引擎代理用 opus：M4 效果、M6 联机、M13 物理、M14 移动模式。
- 每个文件预览最多 3 轮。
- 一个会话窗口只跑一个里程碑。开工前先查磁盘上已经落盘的文件，代理常常写完文件才撞额度，续跑时只补失败的步骤。
- 每个里程碑发布后，更新记忆里的进度锚点。

---

## 1. 三份规划怎么合并的

| 取自 | 采纳的点子 | 理由 |
|---|---|---|
| 回填优先 | 打磨前先做**图库出图 + 打分表 + 顶点色 tint**（M1） | 57 种实体不能凭感觉挑。tint 能在同一个材质槽位里上多种颜色，是"多加形状但 draw call ≤5"的关键。统一机位的前后对照图，还能让验收不依赖代理自评 |
| 回填优先 | 刷怪规则加 `unique` / `group` / `where` / `densityNow`；天气、晃动、有限边界、动态 env 合成一批（M3） | 这些集中在 entities.js / gfx.js / world.js，不改联机协议，一次关闭十几个层级文件 |
| 回填优先 | 状态效果排在注视判定前（M4 早于 M6） | A 能关闭的未实现最多（约 19 条），而且是远程攻击、投掷、驯服的前置 |
| 玩家体验优先 | M1 就做 `tests/all.mjs` 一条命令全量测试 + `tests/online.mjs` 线上实测 + 预算表 | 后面 15 次发布每次都要用，越早做越省额度 |
| 玩家体验优先 | 第一批打磨紧跟 M1；经典形象闸门（猎犬先问） | 用户把打磨排第一；玩家前 10 分钟遇到的实体观感最差 |
| 玩家体验优先 | 手电 SpotLight 常驻场景、用 intensity 0 表示关灯；单程层级进入前确认；天气需求先核对原文（L2 的 Snow 是物品，不是天气）；文字贴图和一批打磨合并发布；触屏动作轮只改一次 | 避免重编译卡顿；不编造出口也能防止误入断档；少做无效回填 |
| 技术依赖优先 | 联机通用事件通道 `BR.coop.emit` + 迟到客机状态回放 `registerState`；快照尾部追加字段 + 握手版本比对 | 后面 P/E/R/V/W/X/Z 都要一次性事件和状态回放，只造一次轮子 |
| 技术依赖优先 | golden 世界哈希（几何 / 碰撞 / 刷新点 / 出口 / 刷怪结果） | 每次改引擎都要证明"未回填的层逐字节不变" |
| 技术依赖优先 | view.js 带上队友视锥，`A.playerLooking` 改为内部调用它 | hunter / imprint / watcher 不改代码就能把队友的视线算进去 |
| 技术依赖优先 | 门先于多层结构，多层结构先于水体和特殊移动；`stepMax` 默认 0；交互注册表复用给门、梯子、舵轮；relations 可以单方声明（`scares`） | 避免楼梯和门的句柄重写两遍；不改变 23 层现有的碰撞手感；实体文件不用互相改 |

**不采纳的做法**：
- **把全部联机地基塞进 M1**（技术依赖优先）：M1 本身已经是工具性里程碑。协议改动挪到第一个真正用它的里程碑：快照 flags 放 M4，事件通道放 M6，风险分散。
- **`world.lightAt` 默认叠加手电**（玩家体验优先）：会让现有所有读 lightAt 的实体行为悄悄变化，比如萨曼莎的瞬移选点。改成显式参数 `withFlashlight`，只有 `A.lightBound` 和声明了 `perception.flashlight` 的实体读取。这样笑魇、七层之物、观察者仍然不改代码就能响应手电。
- **状态效果排到很后**（玩家体验优先的 M7）：它是 V/Z/W 的前置，关闭条目也最多，所以提前到 M4。
- **第一批打磨排在效果之后**（技术依赖优先的 M4）：用户排第一的就是打磨。第一批实体后续只改行为、不改模型，打磨规则又限定只动 `build()`，不会返工。
- **`tags` 刷怪"保证整层期望总数不变"**：这个说法和"撤掉 rare÷6 近似"自相矛盾。改成显式的 `densityScope`，见 M3。
- **天气给 L2 加雪**：L2.js:436 写明 Snow 是物品。L6 的暴雪出自附录里的个人叙事，也不做。
- **状态效果时间换算**：三份规划说法各不相同（真实分钟 / LORE_HOUR 字面换算 / 照字面由用户定），列进用户拍板（第 5 节）。
- **电梯楼层面板（1–12 楼内部传送、13 楼以上出事）**：js/levels 和 lore-choices.json 里都搜不到出处。M12 开工前先查调研 JSON，查不到就删掉这一条。

---

## 2. 标准流水线（每个里程碑都照这个跑，下文只写差异）

```
0 开工前   读本节和该里程碑小节；查磁盘已落盘文件（续跑）；确认"前置决定"已由用户拍板
1 基线     改动前跑 golden（--tag before）和相关类型的 gallery（--tag before）
2 引擎     按文件归属串行，一个文件只归一个代理；先写接口进 ARCHITECTURE / 模板
3 回填     并行，按文件分组，互不改同一个文件；只删 / 改自己做到的"未实现"条目，其余原样保留
4 测试     新增回归测试，挂进 tests/all.mjs
5 独立验收 不看构建代理的自评，对照选中版本和本计划出问题清单；高危必须修
6 修复
7 集成发布 index.html / 文档 / CAPABILITIES 状态列；tests/all.mjs 全绿；golden 只更新白名单里的层；
          主会话亲自看截图（出生点、before/after 拼图、低画质手机尺寸）；
          按首期惯例经用户确认后推送；tests/online.mjs 线上实测 0 报错；更新记忆锚点
```

硬规则（写进每个代理的提示词）：
- 世界生成禁止 `Math.random`，确定性随机用 `U.rng(levelSeed, …)`。
- 层级不自己建 PointLight，只给灯光描述。
- 实体 high 档 ≤4000 面、≤5 draw call；每块 ≤8000 面；全场 draw calls ≤120；动态灯池 6 盏。
- 游玩 / 测试模式下，任何新机制都不能让实体伤害玩家。
- 速度一律用 `A.SPEED` 档位。
- 暗层有效亮度 ≈0.12–0.15。
- 层间出口必须在出生点 3–5 个区块内找得到。

---

## 3. 里程碑一览

"打磨"指实体画质打磨，批次和验收标准见第 4 节。"回填"列只列主要文件，完整清单见各小节。

| 编号 | 标题 | 覆盖 CAPABILITIES 项 | 做完回填的层级 / 实体 | 验收测试（除 all.mjs 全绿 + 线上实测外） | 规模 |
|---|---|---|---|---|---|
| M1 | 回归地基与打磨工具 | S、AA；清单外：all / online / golden 测试、gallery 出图与预算表、顶点色 tint、可选 LOD | tiny、skin_stealer、observer、samantha、warning_kite、frayed、wretch（视觉部分） | golden 基线入库；57 种实体 high/low 预算表；未回填类型像素差 0；slotMat 克隆释放 | 10 代理，约 3 h |
| M2 | 打磨第 1 批：人与入口层经典实体 | 打磨 | hazmat.glb + parts.hazmat + test_dummy、skin_stealer、bacteria、smiler、hound*、duller、clump、faceling、partygoer + Lfun 装饰 | 第 4 节验收标准；六色皮肤；联机队友人形 | 9 代理，约 2.5 h |
| M3 | 刷怪规则与环境表现 | C、H、Q、K、AG、AH、AF、AE（本地部分） | L1、L2、L4、L5、L8、L9、L10、L12、L14、L16、L17、L18、L20、warning_kite | spawnrules.mjs、envfx.mjs；--scale 比例不变；golden 白名单外不变 | 9 代理，约 3 h |
| M4 | 状态效果、感染与转化 | A、O、I、AE（效果标志）；快照 v2 | hound、partygoer、ptg_b、wretch、frayed、woodlin、imprint、hunter、growler、tiny、clump、smiler、firesalt、almond_water、antiseptics、antibiotics、L0、L6、L8、L17、L20 | effects.mjs；items.mjs 148 项不回退；新旧快照互通 | 9 代理，约 3 h |
| M5 | 打磨第 2 批：L1–L5 常见实体 | 打磨 | deathmoth、wretch、growler、death_rat、nguithrxurh、shadow_worker、wrangler、burster | 第 4 节验收；28 只雌性死亡飞蛾同屏 draw calls ≤120 | 7 代理，约 2.5 h |
| M6 | 注视判定与联机事件通道 | B、F、P（出口整体隐藏）、AE（联机部分） | L0*、L1、L4、L11、observer、duller；核对 hunter / imprint / watcher | view.mjs 真值表；coop.mjs 事件往返与迟到回放 | 9 代理，约 3 h |
| M7 | 手电、蹲伏与电器失灵 | L、J、AC（disabledItemTags / electronicFault） | L1、L3、L6、L8、L9、L19、Lrun、thing_on_level_7、observer、transporter、smiler、watcher | flashlight.mjs（开关 20 次不重编译）；蹲伏窄道；coop 手电光锥 | 8 代理，约 2.5 h |
| M8 | 打磨第 3 批 + 场景文字与贴图 | 打磨、AD、U（相机道具除外） | samantha、woodlin、watcher、ant、arachnid、scit、curabitur_bird、camo_crawler；L4、L5、L14、L15、L18 | 第 4 节验收；kit.mjs 文字材质复用与释放 | 9 代理，约 3 h |
| M9 | 实体关系、索敌与远程攻击 | Y、T、AB、R、V、D（攻击部分）、Z（刺激事件）、AC（嗅觉 / 信息素） | curabitur_bird、deathmoth、moth_jelly、death_rat、neighborhood_watch、samantha、light_guide、plush_dino、wrangler、frayed、camo_crawler、tiny、transporter、clump、smiler、burster、duller、nguithrxurh、L7 | relations.mjs、ranged.mjs；游玩模式实体不打玩家专项 | 9 代理，约 3 h |
| M10 | 交互与投掷 | W、AI（场景道具）、Z（投掷动作）、AC（挖掘、idleSec） | dunk、jerry、lucky_crane、plush_dino、camo_crawler、tiny、L2、L7、L10、L17 | interact.mjs；客机驯服 / 投掷经房主确认 | 8 代理，约 3 h |
| M11 | 打磨第 4 批：L8–L9 实体 | 打磨 | light_guide、dunk、jerry、transporter、warning_kite、frayed、observer、neighborhood_watch | 第 4 节验收 | 7 代理，约 2.5 h |
| M12 | 门、出口与跨层 | P（上锁 / 开合 / 电梯面板*）、E、X；单程层级确认 | L0*、L3、L4、L5、L11、L14、L19、partygoer、transporter、jerry | kit.mjs 口袋连通性（100 种子）；doors.mjs；coop 门状态回放、双方同时换层 | 9 代理，约 3.5 h |
| M13 | 竖向结构引擎 | N、AI（跌落）；绳索 / 梯子 | L0、L6（栈桥）、L7、Lrun | phys.test.js 新用例；golden 白名单；多层块低画质预算 | 10 代理，约 5 h |
| M14 | 水体与特殊移动 | M、D（移动模式） | L7、L10、L16、tiny、thing_on_level_7、neighborhood_watch、curabitur_bird、lucky_crane、clump、nguithrxurh、wrangler、death_rat、watcher | swim.mjs、vertical.mjs；每种移动模式 10 秒不穿墙 | 9 代理，约 4 h |
| M15 | 多层与布局重写的层级回填 | N / AH 的层级回填 | L17（五层船体）、L6（三层下降）、L11（楼上可达）、L8（穴顶出口）、L13（直走廊两侧排门 + 门牌） | 逐楼层出生点与楼梯截图；逐出口传送检查 | 8 代理，约 4 h |
| M16 | 打磨第 5 批 + 画质总回归 | 打磨 | thing_on_level_7、tiny、lucky_crane、hunter、infecting_agent、imprint、plush_dino；57 种实体全量重拍 | 第 4 节验收 + 全量预算表 + 23 层 level-shots | 8 代理，约 3 h |
| M17（可选） | 运行时布局变化 | G | L0 Peripheral Shift、L2 强震永久封闭 | epoch 重建确定性、联机一致 | 做完 M16 再问用户 |
| M18 | M.E.G. 基地与交易 | 不在 CAPABILITIES 清单 | L4 等据点 | 另行规划 | 另行规划 |

标 * 的项有前置决定，见第 5 节：hound 形态、L0 联机孤立、L0 红房间、电梯面板出处。

依赖关系：

```
M1 ─► M2（打磨工具）
M1 ─► M3（golden）
M4 ─► M7（stun 预设）、M9（命中施加效果）、M10（驯服用物品效果）
M6 ─► M7（litBy 用队友位姿）、M9（fire / flicker 事件）、M10（客机请求）、M12（门状态回放）、M17（isObserved）
M9 ─► M10（投掷落点发刺激）
M10 ─► M12（门按 E 开）、M13（梯子 / 绳索交互）
M12 ─► M13（门与楼梯句柄定型后再叠楼层）
M13 ─► M14（groundAt / ceilingAt）、M15（楼层构件）
```

---

## 4. 各里程碑设计要点

### M1 回归地基与打磨工具

**为什么排第一**：后面 15 次发布都要"全量测试 + 线上实测"，一条命令能省大量额度。打磨前必须先拍基线图，否则前后对照失效。tint 是后面 5 批打磨都要用的地基。S、AA 顺手做完，能关闭 7 条纯表现层的未实现，这批也不是只有工具、没有可见变化。

**接口草案**

测试脚本：
- `tests/all.mjs`：串行跑下面这些，最后输出一张汇总表；`--quick` 跳过截图类。
  - phys.test.js、smoke、kit、items、coop、settings、workshop、workshop_core、workshop_ui、golden
  - `preview --arch`
  - 23 层 `preview --scale`，比例必须仍是游玩上限 / 噩梦四档 = 0.5 : 0 : 0.2 : 0.4 : 0.6
- `tests/online.mjs --url https://vibetool.github.io/backrooms/ [--levels ..] [--entities ..]`：测试模式逐层进入，统计已注册实体类型数，放出指定实体，收集 console error。
- `tests/golden.mjs [--update --levels L1,L2]`：每层固定 5×5 区块，哈希以下内容，存进 tests/golden/*.json：
  - 几何顶点数与材质 key
  - solids
  - spawnPoints
  - exits（坐标四舍五入到 1 mm）
  - 固定 rng 下 spawnForChunk 的 [type, x, z]

预览工具（tests/preview.mjs 新增）：
- `--gallery all|<types> --quality high,low --tag <name> [--shard k/n]`：摄影棚环境。
  - 场景：中性灰背景、关雾、环境光 0.55、一盏固定主光。
  - 实体：`__br.setAuto(false)`，动画固定在 idle 相位，按包围盒自动取景。
  - 每类型出 6 张：3/4 正面、正侧、背面、头部特写、低画质正面、首个出场层级出生点灯光下 6 m 处。
  - 写出 gallery.json：高低两档三角面、drawCalls、材质数、bbox、图元数（RigBuilder 记在 `root.userData.primitives`）、tint 数。
  - 预算：超过 4000 面或 5 个 draw call 直接判失败。
- `--stress <type> --count 28 [--level L3]`：记录 renderer.info.render.calls 和平均帧时间。

打磨辅助（tools/polish/）：
- `sheet.sh <tag>`：用 magick montage 拼联系表，每 8 个类型一张，标注三角面和 draw call。
- `sheet.sh --compare <before> <after>`：生成并排对照图，并对本批未改动的类型跑 `magick compare -metric AE`。
- `scores.json`、`batches.json`：放 tools/，不放 data/。

顶点色 tint（_archetypes.js）：
- RigBuilder 的 box / sphere / limb / cone / chain / geo 接受可选 `{ tint: 0xRRGGBB }`。
- 某槽位出现 tint 后，该槽位几何带 color 属性，未上色的图元写纯白，材质缓存键加 `vc` 并开 vertexColors。
- 不带 tint 的实体，几何和材质逐字节不变。

S：`u.slotMat(slot)` 懒克隆本实例该槽位材质，dispose 时释放；距相机 >28 m 或低画质时返回共享材质，写入静默忽略。

AA：
- `A.fx.vanish(e, { sec })` / `A.fx.appear(e)`：由 `e.state` 驱动，房主和客机的 animate 都跑，不改协议。
- 共享粒子池：1 个 THREE.Points，≤200 粒，低画质减半；`A.fx.burst` 复用 `itemKit.burstFx`。
- `BR.world.decal(x, z, { color, radius, ttl })`：区块级环形缓冲，InstancedMesh 1 个 draw call，高画质 ≤64 / 低画质 ≤32，随区块卸载清掉。纯表现，各端按 e.x/e.z 本地生成，不同步。

可选 LOD：`A.wrap(model, { lod: { far: 14 } })` 同时建高低两份几何，超距切低档；默认关闭，只给预算表里 high 档 >3500 面的实体开。

**回填**：
- tiny：眼睛亮度随 `api.lightAt` 变化（slotMat）。
- skin_stealer：tint 做深陷的非发光白眼。
- observer：消失改用 vanish / appear；察觉判定本身留到 M6。
- samantha：瞬移加粒子。
- warning_kite：自我了结时彩纸 burst，替换 fall: 'fade'。
- frayed：墨色腐蚀痕迹改用 decal，ttl ≈60 s。
- wretch：tint 做残留衣物色块。

**执行顺序**：
1. 测试地基和出图工具两个代理并行；工具做完立即拍 `--gallery all --tag base`，同时入库 golden 基线。
2. 构件视觉钩子代理（tint / slotMat / fx / decal / lod）。
3. 回填 2 个代理，与首轮打分 2 名（互相独立，都看 base 图）并行。
4. 验收、修复、集成发布。

**联机**：不改协议。

**低画质**：粒子和贴花数量减半；slotMat 不克隆。

**风险**：
- vertexColors 若把未上色图元写成非纯白，旧实体会整体偏色。靠"未回填类型像素差为 0"兜底。
- SwiftShader 出图慢、偶发超时，必须支持 `--shard` 分片续跑。
- 两名打分员在同一轴差 ≥2 分时，由主会话看图裁决。

**规模**：10 个代理，约 3 h。
- 测试地基 1、出图工具 1、构件视觉钩子 1（opus 可选）
- 回填 2、首轮打分 2
- 验收 1、修复 1、集成 1
- 额度紧时首轮打分减为 1 名，由主会话抽查。

### M2 打磨第 1 批：人与入口层经典实体

**为什么排这里**：用户排第一的就是打磨，原话点名"实体和人"。人形在主页、联机队友、测试人、窃皮者伪装里无处不在；bacteria、smiler、hound、skin_stealer、duller、clump 是 L0–L3 出场最多的。

**范围**：
- "人"有两套模型，必须都做：
  - `assets/models/hazmat.glb`：主页人物、联机队友、测试人在用。用 `tools/blender_hazmat.py` 程序化重建，Blender 已装在 /Applications，脚本重跑逐字节一致。
  - `A.parts.hazmat`：窃皮者伪装和 glb 缺失时的兜底。改 detail: 'high' 分支。
  - 两套都保持 Suit 材质独立，换皮肤只改这一个材质。
- 其余文件：skin_stealer（真身）、bacteria（按 userOverride：比人高的瘦长黑色人形、手臂过膝、无五官的头纵向裂开露齿）、smiler（只在"漂浮白色笑脸"范围内加牙列厚度、眼窝、边缘层次，不许加身体）、duller、clump、faceling（×3 形态）、partygoer（×2 形态，顺带改善圆台底座看不出走路的问题）+ Lfun 装饰（气球改用绳而不是直杆；原文没写墙面颜色，不改色）。
- **hound 闸门**：现模型是犬形四足。选中的 fandom 版写的是人被咬后变形而成，社区经典形象是四肢着地的人形。形态怎么定由用户拍板；没答复前 hound 只加细节、不改形态，或者整只挪到 M5。

**构建代理规则**（每人 2 个文件，详见第 4 节"实体画质打磨流程"）：只动 `build()` / extend / 模型辅助函数 / look；不改 radius、height、speed、attack、brain。

**联机**：glb 变了，但文件名和 Suit 材质约定不变，队友端照常加载。

**低画质**：glb 如果面数上升，另导出 `hazmat_low.glb` 给低画质用，否则保持单文件。parts.hazmat 的 low 档保持简版。

**风险**：
- parts.hazmat 是共享构件，改动会波及拟态实体，要单独做像素差和六色截图。
- glb 面数上升会拖主页和联机的帧率，要实测。

**规模**：9 个代理，约 2.5 h。
- 构建 5：hazmat glb + parts + test_dummy / skin_stealer + bacteria / smiler + clump / hound + duller / faceling + partygoer + Lfun 装饰
- 复评验收 1、修复 1、集成 1
- 另有 1 个代理机动：hound 待决时去做 wretch

### M3 刷怪规则与环境表现

**为什么排这里**：
- 引擎增量小，gfx 里已有 san 用的 applyShake，effects 已经换层不清。
- 不改联机协议：刷怪本来就是房主权威，天气和晃动纯本地。
- 一次关闭约 14 个层级文件的近似实现；进层就看得见下雨、船在摇。
- 刷怪的 `where` 过滤后面水域栖息地会复用。

**接口草案**

刷怪规则（entities.js spawnForChunk + _archetypes.js）。层级实体表条目新增可选字段：

```js
{ type: 'shadow_worker', density: 'rare', tags: ['ouroboros'], densityScope: 'habitat' },
{ type: 'plush_dino', density: 'rare', unique: 1 },
{ type: 'neighborhood_watch_watcher', density: 'rare',
  group: { with: [{ type: 'neighborhood_watch_strider', count: [2, 4] }], radius: 6 } },
{ type: 'wretch', density: 'common', where: (cx, cz, ctx) => 0..1 },
{ type: 'deathmoth_male', density: 'moderate', densityNow: ctx => mul },
{ type: 'hound', density: 'common', overrides: { speedMul, chaseSpeed, restless: true, searchSec, perception: {...} } },
```

各字段含义：
- `tags`：只在 tag 匹配 `b.spawn(x, z, tag)` 或 zone 的刷新点生成。
- `densityScope`：
  - `'habitat'`（带 tags 时的默认值）：密度词描述"栖息地里有多密"。区块期望数 = 原公式 × 匹配点占比，整层总数随栖息地面积按比例下降，这正是 L1"撤掉 rare÷6"要的效果。
  - `'level'`：密度词描述整层总量时写这个，按匹配点占比反向放大，上限 ×6。
  - 选哪个由层级代理照原文判断，并在注释里写明依据。
- `where(cx, cz, ctx)`：纯函数，只能读区块坐标、levelSeed、模块常量。
- `densityNow(ctx)`：只在房主生成实体时读，允许读层级运行时状态；明确不影响几何。
- `unique`：同时存活 ≤n，被击杀的不补。
- `group`：伴生群。
- `overrides`：spawn 时生成 `e.over`，`A.speedOf`、findTarget、attack 读取时优先于 def。
- 不带新字段的条目，rng 消耗顺序逐字节不变（golden 锁死）。新字段用独立子流 `U.rng(levelSeed, cx, cz, 'entities:' + type)`。

kit：
- `g.reserveNear(exitHandleOrCell, radius)` 和 `b.exitsInChunk()`。
- 模板写死 rng 顺序：出口 → 地标 → 刷新点。

环境表现：
- K：`BR.gfx.weather({ type: 'rain'|'snow'|'dust'|'ash'|'spores', intensity, color, wind } | null)`。跟随相机的粒子盒，1 个 THREE.Points、1 个 draw call，高画质 ≤2000 粒、低画质 ≤500 粒，depthWrite false，不占灯。层级在 `env.weather` 静态声明，或在 update 里按宏区切换（进室内关掉）。
- AG：`BR.gfx.shake({ amp, freq, seconds })`，公开现有的 applyShake，与 san 抖动叠加，只动相机、不改 player.x/z。`env.sway: { amp, periodSec }` 做常驻轻摇。设置新增"画面晃动强度"滑条 0–100%，存 localStorage。
- AH：register 新字段 `bounds: { minCx, maxCx, minCz, maxCz, edge: 'wall'|'water'|'void', buildEdge?(b, side) }`。界外不建区块；边缘块由 `kit.edge` 自动封墙或铺水面并加碰撞；刷怪和物品只在界内；工坊 7×7 可编辑区与 bounds 取交集。
- AF：
  - `BR.world.env` 返回真正生效的 env（已套过工坊覆盖）。
  - `BR.world.envValue(key)` 对函数值 `(ctx) => number` 求值，5 Hz 缓存。
  - `BR.world.setEnvValue(key, v)` 写生效副本，雾、环境光这类键写完重新 applyEnv。
  - player 的 sanityDrainMul / hungerDrainMul 改走 envValue。
  - workshop.envOverride 覆盖后，函数值照样生效，修掉 L12 同时写两份 ENV 的写法。
- AE（本地部分）：文档写明 BR.effects 默认跨层保留；层级 `leave()` 可以用 `BR.effects.add` 施加带 tags 的后遗症。

**回填**：
- L1：影子工人 ×3 改用 tags，撤掉 rare÷6。
- L2：实体 overrides 一路猛冲；地震加 shake；不加雪。
- L4：M.E.G. Omega 基地用 reserveNear 贴着通往 5/6 的出口。
- L5：samantha 只在主厅，wrangler 只在锅炉房。
- L9：watcher 带 strider 伴生群，swimmer 三只一组（数量以原文为准）。
- L8：巨臂林地加 rain + 雷暴 gfx.flash，保留极光面片。
- L10：间歇小雨 + 雾距脉动。
- L12：sanityDrainMul 改函数式 env；离层施加 comm_impair 标签后遗症。
- L14：污染房间用绿色 dust；离开刑讯室 / 污染区的后遗症照原文写。
- L16：densityNow 按雨林 / 冰原形态调整；天气先核对原文，写了才加。
- L17：env.sway + 偶发 shake，替换 buzz 音效近似；bounds 做有限船体，edge: 'water'，舱门出口保持在界内。
- L18：plush_dino unique: 1。
- L20：bounds 替换半径 3 块的近似；where 做越深越多。
- warning_kite：只改注释，说明数量随危险程度增减由层级 densityNow / group 承担。

**测试**：
- `tests/spawnrules.mjs`：
  - tags 只落在匹配点。
  - habitat / level 两种 scope 统计 200 块，误差 <15%。
  - unique 上限；group 组成。
  - overrides 只作用本层。
  - reserveNear 落在半径内。
- `tests/envfx.mjs`：
  - 粒子数不超上限，draw call 只多 1。
  - shake 期间 player.x/z 不变；滑条持久化。
  - bounds：界外无区块，出口 BFS 可达。
  - 工坊覆盖激活时函数 env 仍生效。
  - 后遗症换层仍在，原地重生清除。
- golden：白名单只含上面回填的层。
- 截图：--level-shots 回填层，高低画质各一轮。

**联机**：无协议改动。天气和晃动纯本地；L16 天气切换时刻两端可能差几秒，纯表现，可以接受。

**风险**：
- 全屏半透明粒子在低端手机上填充率开销大，要实测后再定粒子数。
- 常驻摇摆引发晕动症，必须有滑条。
- L17 / L20 加 bounds 后，出口或地标可能落到界外。
- densityNow 一旦混进 where，会导致两端几何不一致。

**规模**：9 个代理，约 3 h。
- 引擎 2：刷怪规则（entities / archetypes / kit） / 环境表现（gfx / world / player / settings / workshop）
- 回填 3：L1 L2 L4 L5 L9 / L8 L10 L12 L14 / L16 L17 L18 L20 warning_kite
- 测试 1、验收 1、修复 1、集成 1

### M4 状态效果、感染与转化

**为什么排这里**：
- 关闭的未实现最多：11 个实体、5 个层级、4 个物品。
- 玩家侧地基已有一半：stages / tags / hostile / lethalAtEnd / clear({ tag })。
- 是 M9 远程命中、M10 驯服、M7 手电制服的前置。
- 联机只在游玩模式，而游玩模式实体不打玩家，所以玩家侧效果不需要同步，只有实体燃烧 / 减速 / 昏迷的表现要走快照 flags。

**前置决定**：状态效果的时间换算（第 5 节第 4 条）。

**接口草案**

效果预设（_effects.js）：
- `BR.effects.define(key, spec)`：联机和存档只传 key、秒数、阶段号，不传函数。
- spec 新增字段：
  - `onExpire: 'death'|'transform:<type>'`：lethalAtEnd 保留为 death 的别名。
  - `cureWindow: { stage | seconds }`：窗口内可以用解药清除。
  - 阶段标志 `freeze`：不能移动和转视角，暂停菜单和死亡流程照常可用。
  - 阶段标志 `blind` 0..1（暗角）、`muffle` 0..1（声音发闷）、`confuse` 0..1（移动方向漂移）。
  - `survivesRespawn`、`clearOnLevelChange`、`icon`。
- 物品 def 声明 `cureTags`，`itemKit.use` 时调用 `BR.effects.clear({ tag, respectWindow: true })`。

统一入口：
- `api.applyEffect(target, keyOrOpts, { seconds, stage, source })`：
  - target 是本机玩家：走 BR.effects，仍受模式规则约束，只在会攻击玩家的模式生效。
  - target 是测试人或实体：走 `BR.entities.addEffect(e, …)`。

实体侧（entities.js）：
- `e._fx` 用定长数组，think 里不 new 对象；房主每 0.25 s 结算一次：
  - speedMul 乘进 moveToward 和 A.speedOf。
  - hpPerSec 扣血。
  - stun 期间跳过 think。
  - blind 让感知半径 ×(1−blind)。
  - fear 触发 flee。

转化与生成：
- `api.spawn(type, x, y, z, { parent, maxChildren: 2, maxDepth: 2 })`：每层运行时生成总量 ≤8，再受 maxActiveEntities 约束；只在房主执行，继承 chunkKey。
- `api.transform(target, type)`：移除目标后原地 spawn。
- 噩梦里玩家到期：死因"变成了 X"，房主在原地生成 X；原地重生时的 clearRadius 要覆盖这个点。

快照 v2：
- 行格式 `[id, type, x, z, yaw, state, hp, y?, flags?]`，只在尾部追加。
- y 只在离地 >5 cm 时写，否则写 null；flags 为 0 时省略。
- 旧客机 applySnapshot 只读前 7 列，天然兼容；新客机缺字段时走旧逻辑。
- flags 位表写进 ARCHITECTURE §9：bit0 burn、bit1 slow、bit2 stun、bit3 infected、bit4 vanish、bit5 tamed、bit6 swim、bit7 ceiling、bit8 burrow（后三个预留给 M10 / M14）。
- hello 的 v 升级为协议版本号，不一致时双方提示"请刷新页面"。

**回填**（时长一律按第 5 节拍板的换算写，注释里写清）：
- hound：咬伤分阶段 → transform:hound；杏仁水在冲洗窗口内可解。
- partygoer：PTG-A 咬伤 → transform:partygoer_biped；ptg_b 按 key / tag 清除，与实体侧一致。
- wretch：棕色淤泥三阶段，按选中版本列出每阶段的解药。
- frayed：长时间接触后转化。
- woodlin：表面痊愈后延时死亡，替换一次性 severe 伤害。
- imprint：直视 → freeze 阶段昏迷，极端情况致死，替换 sanityPulse。
- hunter：对视 → 噩梦里致死的短效果，替换 sanityPulse。
- growler：声波减速，玩家和实体通用。
- tiny：焦油减速 + blind。
- clump：受伤掉下的肉块经 api.spawn 长成新肢团，每只上限 2。
- smiler + firesalt：燃烧 → flee。
- almond_water / antiseptics / antibiotics：cureTags。
- L0：污染杏仁水、地毯纤维致病（tags: ['illness']）。
- L6：微睡眠改用标准 stun / 减速预设。
- L8：悲尸接触打上 infection 来源标签。
- L17：杂物区绊倒短暂减速。
- L20：打爆小行星失败时"生成牧蛇"分支补上（房主侧 spawn）。

**测试**：
- `tests/effects.mjs`：
  - 实体 speedMul / 燃烧掉血；stun 跳过 think。
  - 测试人被 hound 咬到期变 hound；clump 子代上限与 28 只总上限。
  - 游玩 / 测试模式玩家不中实体效果，噩梦中。
  - freeze 期间暂停菜单可用。
  - 死因文字正确；重生清负面但保留 survivesRespawn。
- items.mjs 扩充：cureTags、冲洗窗口。
- coop.mjs：客机看到实体燃烧 flag；旧格式快照与 v2 混发。

**低画质**：燃烧用 M1 的共享粒子 + glow 闪色，不占真灯。

**风险**：
- 转化链式生成可能刷怪风暴：三层上限 + 压测。
- freeze 在噩梦里可能软锁：暂停菜单和返回主页必须可用。
- 页面缓存旧脚本的一端协议不兼容：版本比对提示刷新。

**规模**：9 个代理，约 3 h。
- 引擎 2（串行）：_effects / player / death / hud（opus） / entities / archetypes / 快照 / 版本号
- 回填 4：hound partygoer ptg_b 解药物品 / wretch frayed woodlin imprint hunter / growler tiny clump smiler firesalt / L0 L6 L8 L17 L20
- 测试与验收 1、修复 1、集成 1

### M5 打磨第 2 批：L1–L5 常见实体

**为什么排这里**：
- 这批实体集中出现在 L1–L5，曝光仅次于第 1 批：
  - deathmoth：L3、L5、L8、L9、L20，而且 L5/L8 密度高。
  - wretch：L1、L3、L8、L9。
  - growler、nguithrxurh、wrangler：L1、L5、L8、L20。
  - burster：L3。
  - death_rat：L5、L8、L9。
  - shadow_worker：L1。
- M3、M4 刚改完其中几只的行为，上下文还新。
- 排在 M6 之前，避免连续三个引擎里程碑。

**范围**：deathmoth（×3）、wretch（×2，补脓疱与皮肤起伏）、growler、death_rat、nguithrxurh、shadow_worker（×3，补回"槽位预算放不下"而省略的外形细节）、wrangler（×2）、burster。

**特殊预算**：deathmoth 是群体实体，单只 ≤1500 面，翅脉用 tint 线条，不加槽位。

**规模**：7 个代理，约 2.5 h。
- 构建 4（每人 2 个文件）
- 复评验收 1、修复 1、集成 1

### M6 注视判定与联机事件通道

**为什么排这里**：
- B 是 M7 litBy（共用视锥和队友位姿）、M12 门状态、M17 布局位移的前置。
- 事件通道是 M9 / M10 / M12 所有"房主判定、客机执行"的前置。
- 能关闭入口层的怪异事件：L1 画作消失、L4 出口消失、L11 车辆挪位。

**前置决定**：L0 联机孤立怎么做（第 5 节第 5 条）。另外，L0.js 里没搜到孤立效应的原文引用，开工前先查调研 JSON，确认选中版本真的写了。

**接口草案**

联机事件通道（coop.js）：
- `BR.coop.emit(kind, payload)`：双向，客机发给房主的视为请求；消息格式 `{ t: 'ev', k, p }`，每帧合批发送。
- 接收端 `BR.bus.emit('net:' + kind, payload, from)`；房主侧对请求类 kind 做校验。
- `BR.coop.registerState(key, get, apply)`：在 world / hello 握手和换层完成后，把已登记的状态整包回放给客机。
- hello 附带 fov / aspect；'me' 消息追加 `fx` 短表（状态图标），并预留 `fl`（手电）、`cr`（蹲伏）位。

视线查询（新文件 js/core/view.js，index.html 里放在 phys.js 之后）：
- `BR.view.isObserved(x, y, z, r, { by: 'any'|'me'|'peer', maxDist, pad })`：
  - 视锥：本机相机，或者用 'me' 消息位姿加 hello 里 fov/aspect 还原的队友相机。
  - 遮挡：phys.los 打包围球中心和两侧边缘共 3 个点，低画质只打 1 点。
  - 性能：每帧 los 预算 ≤24；按 key 缓存 0.2 s（低画质 0.3 s）；判定加 0.3–0.5 s 滞后。
- `BR.view.lookingAt(x, y, z, maxDeg, range, by)`；`BR.view.cameras()`。
- `A.playerLooking` 内部改调 `lookingAt(by: 'any')`。

同步规则：只影响表现的变化（画作消失、车辆换位、广告换画）各端本地判定；影响碰撞或出口的变化由房主判定，经 emit 广播，并通过 registerState 回放给迟到的客机。

出口整体隐藏（kit）：
- `ExitHandle.setVisible(bool)`：隐藏该出口的全部 Piece（楼梯间 / 电梯 / 门脸），关门扇碰撞，并 setActive(false)。
- 状态按稳定 key（与工坊出口 key 同一算法）存进 `BR.world.exitState`，区块重建后恢复。

F 联机孤立：
- 层级 `env.coopIsolation: true | { except(x, z) }`。
- 双方都不在例外区时：隐藏对方人形和名牌，语音增益置 0，并提示一次"这是本层效应"。只改表现，不改同步。

AE 联机部分：本机效果带 comm_impair 标签时，对方的语音走低通并乘 0.4。L12 的后遗症在 M3 已经挂好标签，这里只让 coop 响应。

**回填**：
- L0：孤立效应（按拍板结果）。
- L1：画作 / 木箱不被注视若干秒后消失（本地）；自然锁被注视时消失（影响通行时走房主）。
- L4：楼梯 / 电梯出口失去视野后，由房主判定 setVisible(false)，替换"只让触发失效并提示"；消失后仍要保证 3–5 块内有出口。
- L11：无人观察时车辆挪位、广告换画，按区块和计数器确定变体。
- observer：被清楚察觉（lookingAt + 距离）才消失，配合 M1 的 vanish。
- duller：非狩猎状态被目击时无声逃走，玩家冲过去会被吓退；狩猎状态仍要能攻击测试人（duller.js:34 记过这个验收坑）。
- 只核对不改代码：hunter、imprint、watcher 自动计入队友视线。

**测试**：
- `tests/view.mjs`：正对、背对、隔墙、雾外、队友视锥五种情况的真值表；los 预算与缓存；滞后。
- coop.mjs 新增：
  - 事件往返；迟到客机收到出口隐藏状态。
  - L0 孤立（隐藏人形、音量 0、进例外区恢复）。
  - comm_impair 下对方语音变闷。
- 本地测联机的 CORS / 隐私保护坑，按火箭游戏记忆处理。

**低画质**：view 只打 1 点 LOS、缓存 0.3 s；事件通道没有渲染开销。

**风险**：
- 实体多的层 LOS 吃 CPU，严格按预算。
- 队友位姿只有 15 Hz，刚转身时会误判"没看见"，靠滞后缓解。
- 孤立效应和"开麦联机"的体验冲突，提示文案要说清楚。

**规模**：9 个代理，约 3 h。
- 引擎 2：coop 通道 / 状态回放 / 孤立 / 语音（opus） / view.js + archetypes + kit setVisible
- 回填 3：L0 + L1 / L4 + L11 / observer + duller + 核对三只
- 联机测试 1、验收 1、修复 1、集成 1

### M7 手电、蹲伏与电器失灵

**为什么排这里**：
- 黑暗层是现在体验最差的一段：L1 的断电事件、L6、L8、L9。
- 笑魇选中版本（fandom）写"可见光照到会像疼痛般退缩"，smiler.js 已是 `lightBound({ mode: 'avoid', onLight: 'flee' })`，手电一上线，入口层就有了真正的求生手段。
- 手电和蹲伏都要改 player / input / 触屏，合在一起做，触屏布局只改一次。
- 依赖 M6 的 view.js 与队友位姿，以及 M4 的 stun 预设。

**前置决定**：手电开局自带还是要捡、电量规则（第 5 节第 6 条）。

**接口草案**

手电（player / gfx / view / coop / input）：
- 状态：`BR.player.light = { on, battery, maxBattery, toggle(), snuff(sec, reason) }`。
  - 按键 R（E=互动、F=使用、Q=丢弃、V=麦克风、T=测试面板都已占用）。
  - 电量只在噩梦生存消耗；游玩和测试无限，电量 HUD 只在噩梦显示。
- 渲染：gfx 在 init 时就建好一盏 SpotLight 挂在相机下，无阴影。
  - 关灯时 intensity=0，不增删灯、不切 visible，否则所有材质会重编译。
  - 灯池变成"5 盏点光 + 1 盏手电"；进层时 renderer.compile 预热。
- 照射判定：`BR.view.litBy(x, y, z, { by })` → 0..1，由锥角、距离衰减和 los 算出，覆盖本机和队友手电。
- lightAt 不改默认语义：`BR.world.lightAt(x, z, { withFlashlight: true })` 才叠加手电。
  - `A.lightBound` 默认传 withFlashlight。
  - 实体可以用 `perception.flashlight: 'ignore'|'attract'|'repel'|'stun'` 覆盖。
- 联机：'me' 消息里的 fl 位。对方手电平时只画发光光锥和地面光斑，不占灯池。

层级开关：
- `env.lightSnuff: true`：进层即熄灭。
- `env.lightMul`：手电亮度倍率。
- `env.electronicFault: { chance }`：可复现的间歇闪烁熄灭。
- `env.disabledItemTags: ['electronic']`：命中时物品 use 失败并提示。

蹲伏（J）：
- 动作 crouch（C 键，按住或切换在设置里选；触屏切换按钮）。
- 眼高 1.0 m、碰撞高 1.1 m、移速 ×0.5、噪音 ×0.4。
- 起身前用 `phys.overlapCircle(…, 1.62)` 检查头顶。
- 队友蹲姿由 'me' 的 cr 位驱动。

kit：`kit.prop.lowPassage(b, x, z, rot, { len, h: 1.2 })` 带低矮顶棚碰撞体；只放在支路上，并断言主通路另有能站着走的路线。

触屏：右下角改成可展开的动作轮，放手电、蹲伏，给 M10 的投掷预留位置。

**回填**：
- L1：断电事件时提示可以开手电。
- L3：弯腰窄走廊改用 lowPassage。
- L6：lightSnuff。
- L8：lightMul 0.12（原文 100 流明只剩约 12），噩梦里耗电加快。
- L9：electronicFault。L9.js:407 已有"电子设备容易出错"的风味实现，按原文做成间歇故障，不是完全禁用。
- L19：斜顶下需要蹲着走的格子；开关手电后看出生点截图。
- Lrun：开关手电后看出生点截图。
- 所有黑暗层都不降低现有环境光，手电只是额外帮助。
- thing_on_level_7：litBy 照射 → stun 预设，暂时制服。
- observer：被手电照到可能离开（按原文）。
- transporter：黑暗里向它打光会被盯上；吸光皮肤在手电下仍然全黑。
- smiler：核对 lightBound 阈值和冷却，避免一照就彻底失去威胁。
- watcher：关键词命中，核对。

**测试**：
- `tests/flashlight.mjs`：
  - 开关 20 次后 renderer.info.programs 数量不变，灯池恒为 6。
  - 噩梦耗电、游玩不耗电。
  - L6 熄灭；L8 倍率；L9 故障按 levelSeed 可复现。
  - litBy 正对 / 背对 / 隔墙 / 队友手电。
- 蹲伏：低矮通道站着过不去、蹲着能过；在通道里站不起来。
- coop：客机开手电，房主能看到光锥。
- 截图：L1 断电、L6、L8、L9、L19、Lrun 出生点开关手电各一张，高低画质。

**低画质**：手电不开 penumbra，锥角更窄、距离更短；对方光锥不画光斑。

**风险**：
- 手电让暗层不再吓人，数值等用户看过线上再调。
- 原本同时亮 6 盏真光的场景会少一盏，要逐层看图。
- 首次开灯可能卡顿，靠预热兜住。

**规模**：8 个代理，约 2.5 h。
- 引擎 3：player / input / hud / 动作轮 / 蹲伏 | gfx 灯池 / litBy / coop 位（opus） | world env 开关 / kit lowPassage / settings
- 回填 2：L1 L3 L6 L8 L9 L19 Lrun | thing_on_level_7 observer transporter smiler watcher
- 测试与验收 1、修复 1、集成 1

### M8 打磨第 3 批 + 场景文字与贴图

**为什么排这里**：
- 纯观感提升的一次发布，插在 M6、M7 和 M9、M10 两对引擎里程碑之间。
- L5 / L8 实体的行为到 M9 前后才定型；而打磨规则只动 build()，不会冲突。

**打磨范围**：samantha、woodlin、watcher、ant（群体个体 ≤120 面，只加轮廓分节，负反照率仍不做）、arachnid（×3）、scit、curabitur_bird、camo_crawler。

**AD**（_kit.js）：
- `kit.prop.sign(b, x, z, rot, { text, font, color, bg, glow, w, h })`：
  - 用 CanvasTexture 画字，按 (text, font, color, bg, 尺寸) 经 BR.assets.material 缓存并引用计数，区块卸载时释放。
  - 每区块唯一牌子 ≤8；画布高画质 512×128、低画质 256×64。
  - 中文用系统字体栈，测试缺字回退。
- `kit.prop.decal(b, x, y, z, rot, { texKey | draw(ctx, size), w, h })`：用 polygonOffset 防 z-fighting。

**U**：wood_floor、marble 走 `BR.assets.registerProcedural(…, { noFile: true })` 程序化生成，不调图片 API，file:// 下也能跑。相机道具推迟（见第 6 节）。

**回填**：
- L4：M.E.G. Omega 基地招牌（静态，不做交互）。
- L5：黑胡桃木地板、白色大理石换用新贴图。
- L14：刑讯室大理石地板。
- L15：符文管道贴花。
- L18：营地彩旗原文"无字"，只核对、保持无字。
- L13 的门牌放到 M15，和布局重写一起做，免得改两遍。

**测试**：
- 本批按第 4 节验收。
- kit.mjs：同一 text 两次调用复用同一材质；区块卸载后纹理数不增长。
- 截图：--level-shots L4、L5、L14、L15。

**风险**：微信内置浏览器和部分手机缺中文字形，招牌文字要尽量短。

**规模**：9 个代理，约 3 h。
- 构建 4、文字贴图引擎 1、层级回填 1
- 复评验收 1、修复 1、集成 1

### M9 实体关系、索敌与远程攻击

**为什么排这里**：
- 全部落在 entities.js 的 findTarget / canAttack / attack 和 archetypes 的感知段，一次改完整条索敌管线。
- 游玩模式里友善和有害实体照样互打，所以这批在所有模式下都看得到。
- 依赖 M4（命中施加效果、火焰刺激）和 M6（fire / flicker 事件广播）。
- 一次关闭约 18 个文件的未实现。

**接口草案**

关系（entities.js）：
- `def.relations = { prey: [type | 'tag:x'], fear: [...], scares: [...], ignore: [...], lure: { itemTags: [...] } }`：
  - prey 可以越过阵营规则攻击。
  - fear 的对象进入视野就 flee。
  - scares 是反向声明：邻里守望写一次 scares，就不用去改猎犬、笑魇的文件；引擎注册时把两个方向合并成 Set。
- `def.targetRule(e, target, api) → 'attack'|'ignore'|null`：动态敌意。
- canAttack 的最后一步永远先判模式，游玩 / 测试不打玩家。

感知：
- `perception.xray: true`：跳过 los。
- `perception.smell: { radius, tags }`：配合 `def.scent: ['pheromone:male']`。
- 查询：`api.levelQuery({ kind: 'players'|'distress'|'items'|'entities', type })`，只查已载入区块、限频；`api.nearestSupply(e, { types, radius })`；`api.players()`。

刺激事件：
- `BR.bus.emit('stimulus', { kind: 'noise'|'fire'|'light', x, z, loudness, sec, by })`。
- 现有来源：玩家奔跑、firesalt / lightning 爆点（itemKit.burstFx 的调用方）、death_rat 尖叫。M10 再加投掷落点。
- `A.hear(e, api)` 合并 hearPlayer 和最近的刺激点；stalker 的 investigate 前往刺激点；`def.onStimulus(e, s, api)` 钩子。

骨架钩子（AB）：`A.ambush({ onMiss, onCatch })`；`A.guide({ noclip: true })` 走无碰撞移动，仍受 bounds 和地面约束。

远程攻击（V）：
- `attack: { kind: 'melee'|'beam'|'projectile', range, width, windup, speed, effect }`。
- beam：phys.raycast 判线段加宽度，前摇期间先画一条细线预警。
- projectile：固定对象池，每层 ≤16 发，每步 raycast。
- 伤害只在房主结算；联机发 `emit('fire', { id, kind, from, to })`，客机只播特效。

D（攻击部分）：
- `attack.throughWalls`：跳过 los，但穿透厚度 ≤0.6 m，用 raycast 量。
- `attack.fromAbove`：按竖直距离判定。
- 移动模式放到 M14。

R：
- `api.levelEvent('flicker'|'blackout', { x, z, radius, seconds, strength })`。
- 先调层级可选的 `level.onEvent`，没有就由 world 临时改半径内灯描述的 flicker，到时还原。
- 房主广播；区块在事件期间重建时读剩余时长。

**回填**（4 组）：
- 第 1 组：
  - curabitur_bird：只捕食雄性死亡飞蛾，靠 smell 信息素。
  - deathmoth：雄性带 scent；携带 moth_jelly 的玩家被忽略（lure）。
  - moth_jelly：物品标签对接。
  - death_rat：追猎其他实体时尖叫，触发 levelEvent flicker。
  - clump：用 entity:kill 做饱食蛰伏。
- 第 2 组：
  - neighborhood_watch：scares 猎犬 / 笑魇 / 窃皮者 / 死亡飞蛾；守望者改为 beam，替换超大近战 range。
  - burster：喷酸改为 projectile。
  - duller：throughWalls 隔墙伸手。
  - nguithrxurh：fromAbove 坠落命中。
- 第 3 组：
  - samantha：xray 读心透视。
  - light_guide：levelQuery 全层感知 + nearestSupply 带路 + noclip 穿墙。
  - plush_dino：distress 查询全层感知。
  - wrangler：怀孕雌性用 targetRule 临时捕食流浪者，仍受模式规则。
  - frayed：targetRule 主动靠近。
- 第 4 组：
  - camo_crawler：ambush onMiss 才嚎叫。
  - tiny：巨响刺激短暂压制。
  - transporter：奔跑 / 噪音刺激提高警觉。
  - smiler：fire 刺激逃离。
  - L7：巨响物品先用火盐爆点代替，M10 后改成任意投掷物。

**测试**：
- `tests/relations.mjs`（setAuto(false) 固定步进）：
  - 受眷鸟只打雄蛾；猎犬看到守望者逃跑。
  - 萨曼莎隔墙锁定测试人；带飞蛾果冻不被飞蛾攻击。
  - 游玩模式下 relations / targetRule 不会攻击玩家。
- `tests/ranged.mjs`：
  - 光束前摇期间侧移 1.5 m 可以躲开；隔墙不发射。
  - 投射物撞墙消失；throughWalls 只穿 ≤0.6 m。
- coop：客机能看到光束、弹道和灯闪。
- `preview --arch`：28 只 AI 耗时 ≤ 改前 ×1.15。

**低画质**：光束是单个拉伸发光盒，弹道无拖尾；flicker 只作用于真灯和同步面片。

**风险**：
- relations 越过阵营规则后，最严重的回归是游玩模式实体打玩家，必须专项测试。
- 畏惧和捕食互相抵消会让实体来回抖动，需要状态保持时间。
- 全层查询开销大，要限频。

**规模**：9 个代理，约 3 h。
- 引擎 2：关系 / 感知 / 刺激 / 钩子（entities + archetypes） | 远程攻击 / 表现池 / levelEvent / coop 事件
- 回填 4
- 测试与验收 1、修复 1、集成 1

### M10 交互与投掷

**为什么排这里**：
- 现在按 E 只认拾取物。把拾取物、实体、场景道具统一成一张交互目标注册表后，门（M12）、梯子和绳索（M13）、舵轮、取水、挖坑都能复用。
- 投掷和交互改的是同一组文件（player / input / items），也走同一条"客机请求 → 房主执行"链路。
- 依赖 M6 的事件通道和 M9 的刺激事件。

**接口草案**

交互注册表（新文件 js/game/interact.js，index.html 里放在 player.js 之后）：
- `BR.interact.register({ id, x, y, z, r, prompt, owner: 'chunk'|'entity', chunkKey, can(player, held), use(player, held) })`、`unregister(id)`、`nearest()`。
- 挑选规则：准星锥内先比角度再比距离；同时命中时优先级为拾取物 > 实体 > 道具。
- 区块卸载时按 chunkKey 自动清理。
- hud.prompt 显示动作名和对象名。

场景道具：
- 所有 `kit.prop.*` 接受 `{ onInteract(ctx, player, held), prompt }`。
- key 用"层级@区块#调用序号"，与工坊出口 key 同一算法，联机两端一致。

实体交互与驯服：
- `def.onInteract(e, player, heldItem, api)`：只在房主执行；客机按 E 时发 `emit('interact', { id, held })`。
- 驯服后切到新骨架 `A.companion({ owner, follow: 2.5, leash: 20 })`：
  - 快照 flags.tamed，归属写在 `e.data.owner`。
  - 计入 28 只上限；对主人友善；跟丢时瞬移回主人身后。
  - 换层时先留在原层并提示，跨层跟随等 M12。

投掷：
- 动作 throw（G 键 + 动作轮）；`BR.player.throwSelected()` 复用 itemKit.throwPoint 算抛物线。
- 落点生成拾取物，并发 stimulus noise。
- 客机投掷走请求，由房主生成拾取物和噪音。

AC 小项：
- `BR.player.idleSec`：没有位移、没有视角输入的累计秒数，任意输入清零。
- 挖掘：层级摆"可挖点"道具，长按 E 持续数秒。原文没提铲子，就不新增铲子物品。

**回填**：
- dunk：轻敲鼻子驯服，之后跟随。
- jerry：喂杏仁水驯服，替换"携带杏仁水接触"的近似。向日葵种子不在 item-spawn 里，核对选中版本后再决定，不许凭记忆新增。
- lucky_crane：可以轻轻拿起挪走，不触发群攻。
- plush_dino：给食物会吃（核对原文）。
- camo_crawler：被投掷噪音引开。
- tiny：投掷巨响短暂压制。
- L7：巨响物品改成任意投掷物。
- L17：舵轮能转但不改航向；轮机舱机器运转，提示不可操作。
- L10：就地喝湖水 / 坑水；在可挖点挖深会涌出蠕虫。
- L2：管道区站着不动会被消化，改用 idleSec（可选）。

**测试**：
- `tests/interact.mjs`：
  - 拾取物、实体、道具同时在准星附近时的优先级。
  - 区块卸载后注册表清空。
  - 驯服跟随，且不攻击主人。
  - 投掷落点让 camo_crawler 转向。
  - 任意输入后 idleSec 清零。
- coop：客机驯服、投掷、拾取都经房主确认。
- smoke：动作轮里有投掷按钮。

**低画质**：投掷只显示物品本身模型，无拖尾。

**风险**：拾取物旁边正好站着可驯服实体时，E 键目标会冲突，提示文字要写清对象。

**规模**：8 个代理，约 3 h。
- 引擎 2：interact / player / input / hud / items 投掷 | entities onInteract / companion / coop 请求
- 回填 3：dunk jerry lucky_crane plush_dino | camo_crawler tiny L7 | L10 L17 L2
- 测试与验收 1、修复 1、集成 1

### M11 打磨第 4 批：L8–L9 实体

**为什么排这里**：
- 这批实体的驯服跟随（M10）、光束和感知（M9）、手电反应（M7）、消失特效（M1 / M6）都已落地，模型和动作的最终形态已定，打磨一次到位。
- 插在 M10 和 M12 两个引擎里程碑之间。

**范围**：
- light_guide：只加光晕层次，不加真灯。
- dunk、jerry、transporter。
- warning_kite：M1 已加彩纸。
- frayed、observer。
- neighborhood_watch（×3 形态，按 type 逐一截图）。

**规模**：7 个代理，约 2.5 h。
- 构建 4
- 复评验收 1、修复 1、集成 1

### M12 门、出口与跨层

**为什么排这里**：
- P、E、X 都围绕 world 的出口检测和换层流水线，以及 kit 的出口 / 门句柄。
- 门的开关复用 M10 的交互注册表，状态回放复用 M6 的 registerState。
- 放在 M13 之前，免得多层结构里还要把门和楼梯句柄重写一遍。

**前置决定**：
- L0 红房间要不要真封闭（第 5 节第 7 条）。
- L15 / L16 死路怎么处理（同上）。
- 电梯楼层面板的出处（开工第一步先查调研 JSON）。

**接口草案**

门与出口状态（kit + world + coop）：
- ExitHandle 和门构件在 M6 的 setVisible 之外，新增 `setLocked(bool)` 和 `open(t01)`。
- 门扇碰撞随开合启停；没上锁的门默认挂交互，按 E 开合。
- `BR.world.doorStates` 只记偏离默认值的门，按稳定 key 存。
- 房主改动时 `emit('door')`，并通过 `registerState('doors')` 回放给迟到的客机；区块重建时先建默认状态，再套用记录。
- 时间驱动的开合（L5 客房门）由房主用 `U.rng(levelSeed, 'door', key, epoch)` 决定后广播。

E 封闭口袋：
- `kit.grid(…, { pockets: { chance, size, entrance: 'oneWay', tag } })`：口袋只挂在主通路之外。
- 连通性检查排除口袋格，并断言出生点和出口永远不在口袋里。
- 玩家完全进入后，入口门 setLocked，并追加碰撞 `phys.addSolids(chunkKey + '#pocket')`；状态像门一样持久化、由房主广播。
- 入口前 2 m 给风味提示，可选复用单程确认框。
- `kit.prop.bars` 是真实碰撞体，生成时断言有绕行路线。

X 跨层：
- `api.sendToLevel(target, levelId | 'random<=3', { delaySec })`：
  - 目标是玩家：在脚下放一个 event 出口并激活，走和出口完全相同的流程（包括未开放判定），联机由房主广播 level，双方一起走。
  - 目标是测试人或实体：直接移除。
  - `'random<=3'` 按已注册层级的生存难度筛选。
- `def.followAcrossLevels: { radius, chance }`：出口触发时房主记下正在追击的实体，进新层后在玩家附近生成。只在房主生成。

单程层级确认：
- 层级注册时自动算 `BR.levels.noReturn(id)`：exits 里没有任何 to 属于已开放层级。按现有数据应该命中 L15、L16。
- 踩到指向单程层的出口时，hud 弹确认框；取消就把玩家推回触发圈外。
- 设置里加"单程出口提醒"开关，默认开；工坊启用出口覆盖时按覆盖后的出口重算。
- 在单程层打开暂停菜单时，显示"按设定本层没有通往已开放层级的出口"，并突出"返回主页"。
- 联机：客机先在本机确认，再发现有的 exitReq，由房主广播换层。
- Fun =) 和 Level ! 没有任何层指向它们，只能从起始层进入，所以只加提示。

电梯楼层面板（出处查到了才做）：`BR.hud.elevatorPanel({ floors, onPick })`；kind 'elevator' 的出口可以带 floors 表。触屏友好的大按钮，DOM 实现。

**回填**：
- L0：红房间改用 pockets（按拍板结果）。
- L3：铁栏杆真实碰撞 + 绕行。
- L4：核对 M6 的出口消失在门句柄定型后仍然成立。
- L5：客房门随时间解锁、随机开合。
- L11：在沙房间睡着（idleSec 超过阈值）会被传走。
- L14：门常关但很少上锁；刑讯室真上锁，替换持续扣血；接待室离开后无法再进入。
- L19：箱子里的游戏机拾取后传送，目标层未开放时给出提示。
- partygoer：能操作机械开门；发现流浪者后跟着切出。
- transporter：接触后按拍板的时间换算投送。
- jerry：被教化者延时送往杰瑞厅，目标层未开放时按未开放提示。

**测试**：
- kit.mjs：
  - 口袋连通性跑 100 个种子，出口和出生点永远可达、不在口袋里。
  - 栏杆绕行；门句柄在区块卸载重载后保持状态。
- `tests/doors.mjs`：sendToLevel 经过未开放判定；跨层跟随的实体会出现；单程确认的取消 / 确认 / 关掉开关。
- coop：门状态迟到回放；房主开门客机能看到；sendToLevel 双方同时换层。
- golden：白名单外不变。

**低画质**：门动画只转门扇 1 个 mesh。

**风险**：
- 口袋算错会把出生点或出口封住：kit 断言 + golden + 连通性测试。
- 红房间在默认出生层 L0，玩家误入会以为是 bug。
- 跨层跟随在联机里可能生成两份：只在房主生成。

**规模**：9 个代理，约 3.5 h。
- 引擎 3：kit 门 / 口袋 / 栏杆 | world 状态 / 单程确认 / hud / settings / workshop / coop | entities sendToLevel / 跨层跟随
- 回填 3：L0 L3 L4 L5 | L11 L14 L19 + 电梯出处 | partygoer transporter jerry
- 测试与验收 1、修复 1、集成 1

### M13 竖向结构引擎

**为什么排这里**：
- 改动最大的引擎项，会改 phys 地面查询的语义。
- 游泳要自由上下，贴天花板要天花板高度查询，布局重写要叠楼层，所以必须排在 M14、M15 之前。
- 依赖 M10（梯子 / 绳索交互）和 M12（门句柄已定型）。

**接口草案**

phys：
- `groundAt(x, z, yFeet, r)`：取两者较高的一个。
  - 高度场 `groundFn(x, z, yFeet)`：不超过 yFeet + stepMax 时有效。
  - 与圆重叠、顶面不超过 yFeet + stepMax 的 solids 顶面。
- `ceilingAt(x, z, yFeet)`：返回最近的上方底面。
- 旧的 `groundY(x, z)` 语义不变：groundFn 忽略第三个参数时，结果逐字节一致。
- `BR.phys.stepMax` 默认 0，维持现状；层级写 `env.stepMax: 0.35` 才开启自动上台阶。
- `env.climbLimit`：落差大于 stepMax 时不能贴地直接升上去，修掉 L7 高度场遇到任何落差都自动升上去的问题。

player：
- updateVertical 改用带 yFeet 的 groundAt。
- 落地速度超过 7 m/s 开始算伤害，只在噩梦模式，死因 fall。
- 梯子和绳索登记为交互目标，进入攀爬态后上下移动。

kit：
- `kit.grid(…, { floorY })`：同一区块叠放多套格子。
- `b.floor(n, y)`：把几何按楼层分组。
- `kit.prop.stairsFlight(b, x, z, rot, { from, to })`：每级 ≤0.3 m 的台阶碰撞体。
- `kit.prop.ladder`、`kit.prop.rope`（场景固定件）、`g.shaft(i, j)`（楼板开洞）。

world：
- 区块记录新增 `floors: [{ y, group }]`，只显示玩家所在楼层 ±1 层；低画质只显示当前层和正下方洞口。
- 每块面数上限按可见楼层计算。

entities：
- groundAt 带上 e.y；快照 v2 的 y 列生效，客机不再用 groundAt(x, z) 猜楼层。
- findTarget 只找同层目标（高差 <2.5 m）。

**绳索和梯子**：item-spawn.json 里没有 rope / ladder，本批只做场景固定件，不新增可拾取物品。L7 "没有绳索回不去"就做成入口房间下方的固定绳索点。

**回填**：
- L7：没有绳索回不去做成硬门槛（climbLimit + 固定绳索）。
- Lrun：坑洞陷阱区真的掉下去，困在坑底要爬出来。
- L0：方形深坑群有真实落差。
- L6：金属栈桥真正悬空、下面能掉下去；整层分层留到 M15。

**测试**：
- phys.test.js：groundAt、ceilingAt、stepMax=0 兼容用例。
- golden：除回填层外不变。
- `tests/floors.mjs`：上下楼、梯子、跌落伤害（噩梦扣血、游玩不扣）、客机看到的实体楼层正确。
- coop：两人在不同楼层能看到对方。
- level-shots：多层块在低画质下 draw calls ≤120。

**风险**：
- 这是风险最高的里程碑。stepMax 默认值只要不是 0，就会改变 23 层的碰撞手感。
- 多层块面数翻倍会超过 8000：按楼层分组剔除 + 断言。
- 实体寻路仍是 2D，跨层追击写进 notImplemented。

**规模**：10 个代理，约 5 h。
- 引擎 4：phys（opus） | player + interact 攀爬 | kit 楼层构件 | world 楼层显示
- 回填 2：L7 + L0 | Lrun + L6
- 测试 1、验收 1、修复 1、集成 1

### M14 水体与特殊移动

**为什么排这里**：
- 游泳需要 M13 的自由上下和天花板 / 楼层查询。
- 实体贴天花板、钻地、穿墙过通风管、在水里游，本质上是同一套"不贴地面碰撞、按模式决定 y 和朝向"的移动代码，所以合并。

**接口草案**

水体（world / player / hud / gfx / audio）：
- 层级声明 `water: (x, z) => ({ surfaceY, depth }) | null`，或者用 kit 水体块自动登记；查询接口 `BR.world.waterAt(x, z)`。
- 玩家脚底低于水面 1 m 进入游泳：
  - 有浮力；Space / 触屏上浮，C 下潜；速度 ×0.6。
  - 氧气条只在噩梦模式耗尽时扣血，死因 drown 已存在。
- 水下 gfx 切到 `env.underwater = { fogColor, fogFar }`。
- kit:water 材质改双面。
- audio 新增程序化音色 splash、bubble。

实体移动模式（entities / archetypes）：
- `api.moveToward(e, x, z, speed, { mode: 'ground'|'ceiling'|'burrow'|'swim', y })`：
  - ceiling：用 ceilingAt 吸附天花板。
  - burrow：模型下沉只露背脊，地面留隆起贴花，不参与 LOS 遮挡。
  - swim：在水底和水面之间自由上下。
- "爬墙 / 钻通风管"统一做成 burrow 式穿越：从墙一侧消失、另一侧出现，只允许穿过 ≤0.6 m 的墙或通风管。不做真正的贴墙行走，风险太高。
- `api.inWater(e)`。
- 快照 flags 的 swim / ceiling / burrow 让客机姿态正确。
- anim.fly 的天花板检测改用 ceilingAt，修掉 watcher 飞进天花板的问题。
- 每 0.5 s 检查一次卡墙，失败就退回地面模式。

**回填**：
- 层级：L7 海面变成真水体，按深度分带，加落水 / 冒泡音效；L10 湖可以游进去；L16 河水。
- 水中实体：
  - tiny：只在水中行动，替换领地半径近似。
  - thing_on_level_7：真实沉浮游动，替换飞行高度模拟。
  - neighborhood_watch swimmer：水中比陆地快，能钻管道。
  - curabitur_bird：浮力划水。
  - lucky_crane：怕水（waterAt）。
- 特殊移动实体：
  - clump：穿墙钻通风管。
  - nguithrxurh：贴着天花板移动再坠落。
  - wrangler：钻地 + 地面隆起。
  - death_rat：L8 倒挂天花板栖息（ceiling 模式，不做重力反转）。
  - watcher：恢复原设定的悬浮高度。

**测试**：
- `tests/swim.mjs`：游泳、下潜、氧气（噩梦扣血、游玩不扣）。
- `tests/vertical.mjs`：每种移动模式跑 10 秒不穿墙、不掉出世界；ceiling 贴顶高度正确；burrow 期间不可被攻击。
- coop：客机看到的天花板姿态、水中姿态正确。
- 截图：L7、L10、L16 水上 / 水下；golden 白名单外不变。

**低画质**：水面是单层平面、无反射，水下只改雾色；切换移动模式不增加几何。

**风险**：burrow 做不好会看起来像穿墙 bug，要在测试模式里逐只看。

**规模**：9 个代理，约 4 h。
- 引擎 3：水体 + 玩家（opus） | 实体移动模式（opus） | kit 水材质 + archetypes 动画
- 回填 3：L7 L10 L16 | tiny thing_on_level_7 neighborhood_watch curabitur_bird lucky_crane | clump nguithrxurh wrangler death_rat watcher
- 测试与验收 1、修复 1、集成 1

### M15 多层与布局重写的层级回填

**为什么排这里**：
- 纯层级工作，引擎在 M13、M14 已经稳定，出问题只影响个别层级。
- L13 的格子迷宫重写成直走廊两侧排门，也放在这里，一次做完门牌和布局。

**范围**：
- L17：主层、上层、导航舰桥、货舱、轮机舱真实分层；螺旋楼梯能走；接 M3 的 bounds。
- L6：地表 → 地下管道 → 深层洞穴真实下降，用楼梯井 / 竖井连接。
- L11：选一类建筑开放二层以上（楼梯 + 楼板），其余保持实心量体。
- L8：巨臂林地从洞穴顶部切出（天花板层出口）。
- L13：直走廊两侧排门 + kit.prop.sign 门牌（写着 235 的门、283 号残迹牌子）。
- L9：房屋内部仍按选中版本规则③不建模，不回填。

**测试**：
- 每层每个楼层的出生点和楼梯截图。
- golden 只允许这 5 层更新。
- 逐个出口传送检查能否触发，并重新验证"出口在出生点 3–5 块内可达"。
- online.mjs 逐层走一遍楼梯。

**风险**：
- L17 接近重写，出口 y 和楼层对不上会出现"出口摸不到"。
- 联机双方楼层可见性不一致会互相看不见，coop.mjs 专项测。

**规模**：8 个代理，约 4 h。
- 层级 5（每层 1 个）
- 验收 1、修复 1、集成 1

### M16 打磨第 5 批 + 画质总回归

**范围**：thing_on_level_7、tiny、lucky_crane（×3，死后透过纸隐约看见变硬的管道）、hunter（吸光黑暗用近黑材质加局部暗化光晕，不占灯池）、infecting_agent、imprint、plush_dino。

**总回归**：
- 57 种实体全量重拍 gallery（高 / 低画质），和 M1 的 base 拼成总对照图，出最终分数表。
- 预算表全过。
- 23 层 --level-shots 高低画质各一轮，draw calls ≤120。

**规模**：8 个代理，约 3 h。
- 构建 4
- 复评 1、总回归 1、修复 1、集成 1

### M17（可选）运行时布局变化 G

**内容**：
- 世界"位移纪元"：区块种子带 epoch，房主推进 epoch 并广播，只重建当前不被任何玩家观察（B）的区块，碰撞体 / 物品 / 实体一并重建。
- 服务 L0 的 Peripheral Shift（走廊在不被观察时变形），以及 L2 强震"永久封闭区域"。

**为什么放最后、而且可选**：
- 只有两层需要。
- 风险高：在玩家附近重建区块、联机时序、工坊 7×7 可编辑区的冲突。
- 依赖 B 和 M13 之后稳定的区块重建流程。

M16 完成后问用户要不要做。

### M18 M.E.G. 基地与交易

放在全部打磨和引擎补课之后，另开规划：
- 基地交互。
- 交易物品表，要核对各层选中版本的交易描述。
- 联机时的交易同步。

NPC 对话按用户决定不做。在这之前，各层里的基地只摆静态建筑和标记（M8 给 L4 基地加招牌）。

### 实体画质打磨流程（上文说的"第 4 节验收"）

**方法**：沿用立体图形堆叠，多加形状。在同一个材质槽位里用顶点色 tint 区分颜色，不新增材质槽位。高画质走 `detail: 'high'` 分支加细节，低画质保持简版。

**批量截图**：
- 工具：M1 的 `preview --gallery`。统一摄影棚，每类型 6 张：3/4 正面、正侧、背面、头部特写、低画质正面、首个出场层级灯光下 6 m。
- 数据：gallery.json 记录三角面、draw call、bbox、图元数。
- 拼图：`tools/polish/sheet.sh` 出联系表和 before/after 并排图。
- 标签：`base` 是 M1 拍的全量基线；每批开工前拍 `bN-before`，完工后拍 `bN-after`。

**打分**（tools/polish/scores.json，每轴 1–5 分）：
1. 轮廓辨识度：10 m 外能否认出是谁。
2. 细节层次：可指认的形状细节数量。
3. 设定符合度：对照 lore-choices 选中版本和 userOverride。
4. 比例与姿态。
5. 低画质可读性。

- M1 由 2 名打分员独立给全部类型打首轮分；同一轴相差 ≥2 分时，由主会话看图裁决。
- 之后每批由 1 名复评代理打分，主会话亲自看对照拼图，作为第二意见。

**排序**：优先级 = 曝光权重 ×（5 − 平均分）。曝光权重看首次出场层级、出场层数、密度、知名度。约束：用户点名的"人"和 L0–L3 的经典实体固定在第 1 批。M1 打分后可以在批次之间调换，但每批规模不变。

**每批数量**：7–9 个实体文件，4–5 个构建代理，每人 2 个文件。5 批覆盖全部 40 个实体文件和所有注册类型：

| 批次 | 里程碑 | 实体文件 | 选入理由 |
|---|---|---|---|
| 1 | M2 | hazmat.glb + parts.hazmat + test_dummy、skin_stealer、bacteria、smiler、hound*、duller、clump、faceling、partygoer + Lfun 装饰 | 人形无处不在；L0–L3 最常见；用户点名 |
| 2 | M5 | deathmoth、wretch、growler、death_rat、nguithrxurh、shadow_worker、wrangler、burster | L1–L5 常见，多层高密度 |
| 3 | M8 | samantha、woodlin、watcher、ant、arachnid、scit、curabitur_bird、camo_crawler | L5 / L8 |
| 4 | M11 | light_guide、dunk、jerry、transporter、warning_kite、frayed、observer、neighborhood_watch | L8 / L9，驯服和光束落地之后 |
| 5 | M16 | thing_on_level_7、tiny、lucky_crane、hunter、infecting_agent、imprint、plush_dino | L7 / L11 / L14 / L17 / L18，水体落地之后 |

**构建代理规则**：
1. 先读 data/lore-choices.json 的选中版本和 userOverride，以及调研 JSON。
2. 列出 ≥3 处（目标 5 处）截图上能指认、还没建模的形状细节，每处写原文依据。
3. 只改 `build()`、extend、模型辅助函数和 look。不改 radius、height、speed、perception、attack、brain。后续引擎里程碑的回填代理反过来也不许碰 `build()`。
4. 知名实体如果打磨会改变整体形象、而不只是加细节，立即停下，交主会话问用户。
5. 最多 3 轮预览。

**验收标准**（全部满足才算过）：
1. 预算：
   - high 档 ≤4000 面、≤5 draw call。
   - low 档面数 ≤ 改前 ×1.1。
   - 群体个体：ant ≤120 面，deathmoth 单只 ≤1500 面。
2. 细节：图元数 ≥ 改前 ×1.4，且新增 ≥3 处可指认的形状。
3. 分数：复评平均分提升 ≥1.0，任何一轴不下降。
4. 形体：包围盒偏差 ≤10%；diff 里没有行为字段改动。
5. 隔离：本批以外所有类型像素差 AE = 0。共享构件（parts.hazmat 等）改动要单独出图。
6. 场景：
   - 本批实体所在层用 `--level-shots` 在噩梦地狱档截图。
   - `--stress` 同类型 28 只，draw calls ≤120，帧时间劣化 ≤10%。
   - 手机尺寸低画质截图。
7. 主会话亲自看 before/after 拼图，不采信代理自评。
8. `tests/all.mjs` 全绿；线上用测试模式放出本批全部类型，0 报错。

**与引擎里程碑的穿插**：M1（工具）→ M2 打磨 → M3、M4 → M5 打磨 → M6、M7 → M8 打磨 → M9、M10 → M11 打磨 → M12–M15 → M16 打磨 + 总回归。

批次尽量排在"会改该实体行为或姿态的里程碑"之后。例外是第 1、2 批：它们后续只改行为、不改模型，所以提前做。

---

## 5. 需要用户拍板的事

每条标出最晚在哪个里程碑开工前需要答复。答复前，相关部分按括号里的默认处理，或者先跳过。

1. **跨网络联机要不要架 TURN 中继服务器**（不阻塞任何里程碑）
   - 现状：只配了 STUN（小米 → Google → Cloudflare）。两台设备在对称 NAT 或手机流量下大概率连不上。
   - 架 TURN 需要一台服务器（自建 coturn，或按流量付费的托管服务），并且要解决前端暴露凭据的问题，通常需要一个签发临时凭据的接口；这和"room.php 不改"的约定冲突。
   - 引擎侧 `BR.config.iceServers` 已预留，接入只要一个小改动。
   - （默认：不架，维持现状。）

2. **真机测试**（建议 M1 发布后第一次测）
   - 至今所有性能预算都只在桌面浏览器模拟里验证过。
   - 需要你决定：用哪几台手机（iOS Safari、中端安卓 Chrome、微信内置浏览器），由谁来测。
   - 最需要真机看的节点：M1 基线、M3 天气粒子填充率、M7 手电 SpotLight、M13 / M15 多层面数、M14 水体。
   - 我这边只能跑 iOS 模拟器，代替不了真机性能测试。

3. **猎犬的形态**（M2 前）
   - 现在是犬形四足。选中的 fandom 版本写的是"人被咬、感染后变形而成，背上一长条黑色蓬乱毛发，双眼发白光"；社区经典形象是四肢着地的人形。
   - 选项：保持犬形只加细节；或者改成四肢着地的人形。
   - （默认：没答复前不改形态，猎犬挪到后面的批次。）

4. **状态效果的时间换算**（M4 前）。项目现有约定 `LORE_HOUR`：设定 1 小时 = 游戏 60 秒。三种方案的具体数字：

   | 方案 | 猎犬咬伤冲洗窗口 / 变异 | 印记昏迷（设定 3–4 小时） | PTG-A 转化（设定 24 小时） |
   |---|---|---|---|
   | A 全部按 LORE_HOUR | 5 秒 / 20–30 秒 | 3–4 分钟 | 24 分钟 |
   | B 全部现实时间 1:1 | 5 分钟 / 20–30 分钟 | 3–4 小时 | 24 小时（一局里永远触发不了） |
   | C 小时级用 LORE_HOUR，分钟级用现实分钟 | 5 分钟 / 20–30 分钟 | 3–4 分钟 | 24 分钟 |

   （我倾向 C，可玩性最好，但换算规则在 1 小时处不连续；请你选。）

5. **L0 的联机孤立效应**（M6 前）
   - 原文：两人同层却互相找不到、沟通无效，只有一个小房间例外。
   - L0 是默认出生层，照做的话，联机开局两个人几乎马上就看不见、听不见对方。
   - 选项：照原文做（例外区只限原文那个小房间）；或者 L0 不做孤立。
   - 开工前我会先确认调研 JSON 里选中版本确实写了这条。

6. **手电**（M7 前）
   - 开局自带，还是要在层里捡？item-spawn.json 里没有手电和电池。
   - 电量是否只在噩梦生存消耗？
   - 另外说明：笑魇的选中版本怕光，手电会明显削弱 L1–L3 的恐怖感。
   - （默认：开局自带；只有噩梦耗电；笑魇被照到会退缩，但有冷却，过后会回来。）

7. **"进去出不来"的两处**（M12 前）
   - L0 红房间：原文"完全进入后无法突破"。真封闭的话，游玩模式进去只能返回主页。选项：照原文做成真封闭（入口前明显提示、保持稀有）；或者维持现状（极曲折但能出来）。
   - L15 / L16 按选中版本没有通往已开放层级的出口。选项：保持死路，加进入前确认和暂停菜单说明；或者加一个兜底出口（这会违背选中版本）。
   - （默认：红房间照原文；L15 / L16 保持死路 + 确认框。）

8. **M17 运行时布局变化要不要做**（M16 完成后再问）：只服务 L0 走廊变形和 L2 强震封路，风险高。

---

## 6. 推迟 / 不做

| 项 | 处理 | 理由 |
|---|---|---|
| G 运行时布局变化（L0 Peripheral Shift、L2 强震永久封闭） | 推迟到 M17，可选 | 只有两层需要；在玩家附近重建区块，联机和工坊冲突风险高；依赖 B 和稳定的区块重建流程 |
| 载具（L11 换了喷嘴和油泵的车能开、L7 乘船） | 本阶段不做 | 驾驶物理加联机同步的量级接近一个新系统，只有两层用到 |
| 运气属性 `BR.player.luck`（幸运纸鹤"被幸运的人吸引"） | 不做 | 选中版本没有定义"幸运"怎么产生，做了就是编造 |
| 相机道具（观察者"无法被拍照"） | 推迟到 M.E.G. 之后的物品批次 | 需要拍照 UI 和新物品，只服务一只实体 |
| 猎手实时指挥感染体 | 不做 | 原文没有可执行的机制描述 |
| L8 穴顶重力反转 | 不做 | 用 M14 的 ceiling 模式让尸鼠倒挂栖息代替，不改玩家重力 |
| L9 房屋内部 | 不做 | 选中版本规则③，房屋只做外立面和碰撞 |
| 真正的贴墙行走 | 不做 | 统一做成 burrow 式穿越（从墙一侧消失、另一侧出现） |
| 跨楼层追击寻路 | 不做 | 实体只找同层目标，写进各实体的 notImplemented |
| 无面灵记忆亚种 / 进化种、蚁群负反照率 | 维持不做 | 首期已有说明 |
| L2 加雪、L6 暴雪 | 不做 | L2 的 Snow 是物品；L6 暴雪出自附录里的个人叙事 |
| 电梯楼层面板（1–12 / 13+） | 先查出处 | 代码和 lore-choices 里都找不到来源，查不到就从清单删除 |
| M.E.G. 基地与交易 | 放在最后（M18） | 用户决定 |
| NPC 对话 | 不做 | 用户决定 |
| 枪械 / 负重 | 不做 | 选中版本里只是建议性描述，不在补课清单 |

---

## 7. 附：本计划写作时核实过的现状（省得代理重查）

**联机**
- 消息类型现有：hello、world、worldReq、level、exitReq、me、ents、pick、picked、skin。
- 快照行 `[id, type, x, z, yaw, state, hp]`；applySnapshot 只要求 ≥5 列，尾部追加字段对旧客机安全（js/game/entities.js:853–900）。

**效果与物品**
- BR.effects 已有 stages、tags、cause、negative、hostile、lethalAtEnd、onEnd，可按 negative / hostile / tag / key 清除；换层不清，原地重生清负面。
- `LORE_HOUR = 60`，定义在 js/items/_kit.js:14，L12 在用。
- itemKit 已有 throwPoint、burstFx、boltFx、damageEntity、livingEntities。
- item-spawn.json 里没有 flashlight、battery、rope、ladder、sunflower、shovel、camera。

**渲染与输入**
- gfx 灯池：启动时建好 `maxDynamicLights`（默认 6）盏 PointLight，每帧只改强度（js/core/gfx.js:65）。
- san 抖动函数 applyShake / restoreShake 存在，但未公开。
- 按键已占用：E 互动、F 使用、Q 丢弃、V 麦克风、T 测试面板。R、C、G 空闲。

**物理与世界**
- phys：`groundY(x, z)` + `setGroundFn`，没有自动上台阶；moveCircle 支持 yFeet / height。
- world：工坊 envOverride 未激活时返回同一引用，激活时复制一份。L12 为此同时写两份 ENV（L12.js:224–227）。
- kit：出口描述句柄有 setActive；Piece 有 setVisible；有 `BR.kit.handles(filter)`；楼梯 / 电梯实物没有整体可见性开关（L4.js:257）。

**实体**
- `A.playerLooking(e, maxDeg, range)`、hearPlayer、smellPlayer、lightSeek 都在 _archetypes.js。
- smiler 是 `lightBound({ mode: 'avoid', onLight: 'flee' })`。
- 人形模型：hazmat.glb 被 home.js、coop.js（队友）、test_dummy.js 使用；parts.hazmat 被 skin_stealer 伪装使用。
- glb 由 tools/blender_hazmat.py 程序化生成，Blender 已装在 /Applications/Blender.app。

**测试工具**
- tests/preview.mjs 现有参数：--entity --with --level --level-shots --arch --scale --mode --seconds --shots --dist --out。
- 仓库里没有 all / online / golden 脚本。

**选中版本**（data/lore-choices.json）
- hound = fandom、partygoer = wikidot-cn、skin_stealer = wikidot-en、faceling = wikidot-en、clump = wikidot-cn、duller = wikidot-en、deathmoth = wikidot-cn、wretch = wikidot-cn。
- smiler 和 bacteria 有 userOverride。
