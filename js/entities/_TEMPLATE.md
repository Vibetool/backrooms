# 实体文件写法（js/entities/&lt;type&gt;.js）

给实现第二波实体的代理看。接口实现在 `js/entities/_archetypes.js`（`BR.arch`），示范在 `_demo_stalker.js`（有害）和 `_demo_guide.js`（友善）。
**不许修改** `_archetypes.js`、`index.html`、引擎文件；缺能力写进返回值 `apiRequests`，局部工具函数写在自己文件里。

## 0. 先读什么

- `ARCHITECTURE.md` 第 0、6 节（实体接口、阵营规则）；`WAVE2.md` 第 1、4、5 节。
- 本文档全文（尤其第 2、3、4、11、12 节）。
- 选中版本的调研（第 2 节的脚本），**只读这一项**。

## 1. 文件骨架

```js
// 猎犬 Hound（Entity 8）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_8  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'hound', en: 'Hound', zh: '猎犬', version: 'fandom',      // version 必须等于 lore-choices 的 source
  faction: 'hostile',                                             // 依据：hostility = hostile（第 3 节）

  hp: A.HP.average,          // 依据：「四肢细瘦嶙峋」「耐力差」→ 不耐打，average
  radius: 0.4, height: 0.9,  // 四足，肩高按常见大型犬（选中版本无尺寸，游戏性默认值，非设定）
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },   // 依据：「变形导致跛行，许多个体不能跑」→ 奔跑只到 jog
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.acute, fov: 270 },   // 依据：「听觉极敏锐」
  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal },   // 依据：「直接撕下大块肉」
  // 选中版本没写理智影响 → 不写 aura
  sounds: { alert: 'growl', attack: 'hit' },

  brain: A.stalker({ patrol: 'wander', patrolRadius: 14, smell: false }),
  anim: { gait: 'quad', stride: 1.1, strike: 'bite', stateSounds: { chase: 'growl' } },

  build(ctx) {
    return A.wrap(A.parts.quadruped({
      length: 1.0, height: 0.5, thin: 0.8,                        // 依据：「四肢细瘦嶙峋」
      eyes: { size: 0.035 },                                      // 依据：「眼睛闪着醒目的白光」→ glow 槽位白色
      mane: 0.14,                                                 // 依据：「背上有一长条黑色蓬乱的毛」
      colors: { body: 0x6b5d50, fur: 0x0d0b09, glow: 0xffffff },
      look: { body: 'skin', fur: 'fur' },
    }), { label: 'hound' });
  },
});
})();
```

- 文件头三行必写：中文名 + 英文名（编号）/ 来源版本 + URL + 许可 / "只按此版本实现"。
- 数值、外形、行为、声音每一项旁边写**依据**（用自己的话转述选中版本的哪句描述 → 取哪一档/哪个参数）。选中版本没写的写"选中版本未写，游戏性默认值，非设定"。
- 同一选中版本里描述了多个形态/亚种、而且外形或敌意不同 → 注册多个 type：`<key>_<形态>`（如 `deathmoth_female`），共用的数值/构件写成文件内函数。

## 2. 取选中版本

```bash
python3 - <<'EOF'
import json
k = 'hound'   # entity-index.json 里的 key，也是文件名和 type
lc = json.load(open('/Users/xuanjiang/Downloads/project/backrooms/data/lore-choices.json'))['entities'][k]
d = json.load(open(f'/Users/xuanjiang/Downloads/project/backrooms-research/entities/{k}.json'))
v = next(x for x in d['versions'] if x['source'] == lc['source'])
print('source', lc['source'], 'url', lc['url'])
print(json.dumps(v, ensure_ascii=False, indent=1))
EOF
```

- `lc.source` → 写进 `version`；`lc.url`（或 `v.url`）→ 写进文件头。`lc.conflicts` 只用来知道"别的版本有什么"，**不许**拿来补细节。
- 版本字段：`appearance` 外形、`size` 尺寸、`locomotion` 移动方式、`speed`、`senses` 感官、`behavior` 行为、`attack` 攻击、`weaknesses` 弱点/应对、`sanityEffect` 理智影响、`hostility` 敌意、`relations` 与其他实体关系、`spawnLevels`、`density`、`note`。
- 值里写着 `unverified` / "页面未提" / "未记载" 的 = 选中版本没写。
- 出现在哪些层级、每层密度由**层级文件**决定（`entities` 表），实体文件不管生成。

## 3. faction 映射（WAVE2.md 第 4 节）

| 选中版本 `hostility` | faction |
|---|---|
| `hostile` | `hostile` |
| `friendly` | `friendly` |
| `neutral` / `unknown` / 缺省 | `neutral` |
| `varies` | 读选中版本 `behavior` + `attack` 原文判断，并在注释里引出依据 |

`varies` 判断规则：常态下（饥饿、领地、看见人）就会主动伤人 → `hostile`；只在被激怒/被攻击时才动手 → `neutral`；描述为帮助流浪者 → `friendly`。亚种敌意不同（如"雄性温顺、雌性极具攻击性"）→ 按第 1 节拆成多个 type。
可以用 `A.faction(v.hostility, 'hostile')` 做映射，`varies` 必须给第二个参数。

阵营效果全部由 `entities.js` 实现，实体代码不要自己判断谁能打谁：
- `hostile` 攻击 `friendly` 实体和测试人 `dummy`；噩梦模式（`BR.game.attackPlayers`）才攻击玩家。游玩/测试模式里 `findTarget` 根本不会返回玩家。
- `friendly` 只攻击 `hostile`，从不打玩家和测试人。
- `neutral` 只攻击打过它的对象（打它的是玩家时，也只有噩梦模式才还手）。
- 选中版本写了"与某实体敌对/合作"（`relations`），用骨架的 `canTarget` 过滤或自己在 `think` 里处理，写清依据；**不要**为此改 faction。

## 4. 数值推导

描述里有数字：直接换算成米/秒/米每秒（英尺 ×0.3048，英里每小时 ×0.447），注释写原文数字。只有定性词才查档位：

| 档位 | 值 | 什么时候用（参照玩家步行 3.0、冲刺 5.2 m/s，满血 100） |
|---|---|---|
| `A.SPEED` | still 0 · crawl 0.6 · slow 1.2 · walk 1.8 · brisk 2.6 · jog 3.4 · run 4.4 · fast 5.0 · sprint 6.2 · dash 8.5 | walk=普通游荡；jog=步行甩不掉、冲刺能甩；run=冲刺才甩得掉；sprint="比人快、跑不掉"；dash 只给 1–2 秒扑击/俯冲 |
| `A.HP` | fragile 10 · weak 30 · average 60 · sturdy 100 · tough 180 · brute 350 · titan 800 · immortal 1e9 | 测试人 100。"杀不死/不可能杀死" → immortal |
| `A.DAMAGE`（attack.hp） | none 0 · graze 5 · light 10 · medium 20 · heavy 35 · severe 55 · lethal 100 | "一击致命/撕碎" → lethal；"高致死" → severe |
| `A.COOLDOWN` | flurry 0.45 · fast 0.8 · normal 1.2 · slow 2.0 · heavy 3.0 | 连咬连抓 → fast/flurry；抓住后撕扯 → slow |
| `A.SIGHT` | blind 0 · poor 6 · dim 10 · normal 16 · keen 24 · hawk 40 | "视力差" → poor；没写 → normal（注释标默认值） |
| `A.HEARING` | deaf 0 · poor 5 · normal 12 · keen 22 · acute 40 | 这是玩家**全力冲刺**时的听见半径；走路噪音小，实际半径自动缩小 |
| `A.AURA`（aura.sanityPerSec） | faint 0.08 · mild 0.25 · strong 0.6 · severe 1.2 · crushing 2.5 | 只有选中版本写了理智/精神影响才加；基础掉速 0.083/s |
| `A.LIGHT`（lightAt 阈值） | dark 0.2 · dim 0.35 · lit 0.6 | 惧光/需光判断 |

其他字段：
- `radius`（碰撞半径）/ `height`（视线起点 = `e.y + 0.9*height`，也用来找落脚空位）按 `size` 换算；没写就按外形给合理值并标"非设定"。
- `perception.fov`：人形前向视野 120–160；"周围都能看见/多只眼" 360；`needsLight: true` = 暗处（lightAt < 0.2）看不见目标（引擎实现）；`avoidsLight` 仅作标记，惧光行为用 `A.lightBound`；`smell`（米）给有嗅觉描述的实体，配合骨架的 `smell: true`。
- `attack.range`：够得着的距离（引擎再加目标半径）。爪/咬 0.8–1.0，长臂 1.3–1.6。**必须 ≥ `radius`**：实体之间有软分离，贴身时中心相距 radius + 目标半径，range 比 radius 小就永远打不到测试人和其他实体（`A.register` 会 console.warn）。远程攻击（喷射、投掷）引擎没有，用 `range` 放大近似并注释，或写进 `apiRequests`。
- `attack.entityHp`：打实体的伤害（缺省用 `hp`）。友善实体 `hp` 写 0、`entityHp` 写实际值。
- `attack.sanity`：命中掉 san，只有选中版本写了才填。
- `corpseSec`：尸体保留秒数（默认 2.5，倒地动画要 0.6 秒）。

## 5. 行为骨架

`A.register(def)` 在 `BR.entityTypes.register` 外包了一层：

```
def.brain      骨架片段（下面十个函数的返回值）；think/init/onHit/dispose 由它提供
def.anim       动画配置（第 7 节）；自动生成带远处降频的 animate
def.think(e, dt, api, brain)   可选：替代骨架 think，自己决定何时调 brain.think(e, dt, api)
def.init(e, api) / def.onHit(e, amount, attacker, api) / def.dispose(e)   可选：在骨架同名钩子之后调用
def.onDeath(e, api) → 秒      可选：返回值优先；缺省保留尸体 corpseSec 秒
def.animate(e, dt, api, u)     可选：每帧（不降频）在自动动画之后调用；u = e.obj.userData.arch
```

`e` 与 `api` 见 ARCHITECTURE.md 第 6 节，附加：`e.maxHp`、`e.r`、`e.h`、`e.dead`、`e.hitAt`（最近挨打的 api.time）；`api.faceToward(e,x,z)`、`api.canAttack(e,t)`、`api.damage(e|id, amount, source)`、`api.player`、`api.list`。
`findTarget` 返回 `{ kind:'player'|'entity', ref, x, z, dist, seen }`，`seen=false` 时 x/z 是最后看见的位置（记忆 3 秒）。

**骨架状态存 `e.data.arch`**（`A.state(e)` 取），实体自己的状态放 `e.data` 的其他键。所有骨架共有选项：`sight`（索敌半径，缺省 perception.sight）、`canTarget(e, t, api) → bool`（过滤目标，处理 relations）、`onAttack(e, t, api)`（打中一次后回调）。速度选项可填数字或档位名（`'run'`），缺省取 `def.speed.walk/run`。

### 5.1 `A.stalker(opts)` 追猎者
巡逻 → 发现（`alert` 停顿）→ `chase` → `attack`；丢失目标后去最后位置 `search`；被打后去打人者的位置搜索；噩梦模式下还会去查看听见/闻到的玩家。
```
patrol: 'wander' | 'home' | 'still'   patrolRadius: 12   patrolSpeed   chaseSpeed   searchSpeed
alertSec: 0.5   searchSec: 6   investigate: true（听见玩家就去查看）   smell: false（跟玩家足迹，要 perception.smell）
gaze: { maxDeg: 15, range: 12, sec: 1.5, effect: 'freeze' | 'retreat', speed }   被玩家盯住就定住/后退（"直视可吓退"）
alertCry: 声音名   onAlert(e, t, api)   onAttack   canTarget   sight
状态：patrol idle alert chase attack search frozen deterred
```

### 5.2 `A.pack(opts)` 群猎
附近同类（`joinRadius` 内、不超过 `maxPack`）自动成群；头领游荡、其余排在头领身后；任一只发现目标就嚎叫（`howl`，群内共享冷却）并广播集结点，发现目标的成员按扇区包抄。
```
joinRadius: 14   maxPack: 6   spacing: 1.6   flank: true   flankRadius: 3.5   flankSpread: 0.9（弧度）
rallySec: 8   howl: 'growl'   howlCooldown: 8   patrolRadius: 16   patrolSpeed   chaseSpeed
状态：patrol idle follow rally search flank chase attack
```

### 5.3 `A.flyer(opts)` 飞行
水平移动照常碰撞，飞行高度只是表现（第 7 节 `anim.fly`）。
```
light: null | 'attract'（飞到附近最亮处绕圈）| 'avoid'（往暗处躲）   lightRadius: 10   orbitRadius: 1.8
diveRange: 5（进入就俯冲）   diveSpeed（缺省 run×1.4）   climbSec: 1.0（打中后拉起）   erratic: 0.5（逼近时左右飘）
状态：fly hover circle dive attack climb
```

### 5.4 `A.ambush(opts)` 伏击 / 静态陷阱
```
triggerRange: 4（进入就突袭）   revealRange: 0（>0：进入这个距离先 lurk，用来露出眼睛/笑脸）
strikeSpeed（缺省 run×1.3）   strikeSec: 3   returnHome: true（突袭完回原位）
lurkDark: false（原位变亮就挪到附近暗处）   darkThreshold: 0.35   relocateRadius: 10
fixed: false（true = 完全不动的陷阱：窗户、墙上的东西；只在够得着时攻击；被别的实体挤开会拉回原位）
lure: { sound, range: 12, cooldown: 8, chance }（附近有玩家时发出诱饵声）   onStrike(e, t, api)
状态：hide lurk strike attack return
```

### 5.5 `A.mimic(opts)` 拟态
伪装态 `disguise` 不出手；靠近到 `revealRange`、被打、或（`revealOnLook > 0`）被玩家盯着看 → `reveal` 停顿 `revealSec` → 按追猎者行为追杀；丢失目标 `redisguiseSec` 秒后恢复伪装。模型用两个形态：`A.wrap({ disguise: 伪装模型, true: 真身 }, { form: 'disguise' })`，动画按 `e.state` 自动切换。
```
revealRange: 2.5   revealOnHit: true   revealOnLook: 0（度）   revealSec: 0.8
disguise: 'wander' | 'idle' | 'approach'（慢慢靠近目标）| 'follow-player'   disguiseSpeed
          （wander/idle 只有目标自己走进 revealRange 才现形；描述里会主动接近人的用 approach / follow-player）
redisguiseSec: 15   talk: { sound: 'whisper', range: 10, cooldown: 7 }（伪装时对玩家说话/学舌）
chase: { ...stalker 选项 }   onReveal(e, t, api)
状态：disguise reveal + stalker 的状态
```
伪装成测试人/玩家外形：`A.parts.hazmat(ctx)`（直接用测试人的模型，穿玩家当前皮肤色）。
**拟态实体不要写 `sounds.alert`**：引擎在第一次锁定目标时播 alert，伪装会当场穿帮；现形叫声用 `anim.stateSounds.reveal`。

### 5.6 `A.lightBound(brain, opts)` 光敏修饰
包在任意骨架外面：`brain: A.lightBound(A.stalker({...}), { mode: 'avoid' })`。
```
mode: 'avoid' | 'need'   threshold（缺省 avoid 0.35 / need 0.2）   checkSec: 0.25   fleeRadius: 10
avoid：站在亮处 → state 'recoil'，onLight: 'flee'（往暗处躲）| 'freeze'；painPerSec: 0（亮处每秒掉血）；
       ignoreLitTargets: true（站在亮处的目标不追 —— "躲进亮着灯的房间"）
need： 暗处 → onDark: 'freeze'（state 'dormant'）| 'seek'（去找光，state 'seek'）
```
亮度来自 `api.lightAt(x, z)`（层级灯光按距离衰减累加 + 环境光，不含闪烁）。**实体不能提供真实光源**（灯光预算归层级），发光只用自发光材质和光晕精灵；玩家手电等需要引擎支持的写进 `apiRequests`。

### 5.7 `A.wanderer(opts)` 中立游荡
```
speed   retaliate: 'fight' | 'flee' | 'mixed'（血量低于 fleeHp 才逃）   fleeHp: 0.35   fleeSec: 5
shyRadius: 0（>0：玩家靠近就走开）   homeRadius: 0（>0：不离出生点太远）
状态：wander idle flee chase attack shy
```

### 5.8 `A.guide(opts)` 友善向导
在玩家附近徘徊、带路；离玩家 `leash` 内出现有害实体就先去打（`engage`，需要 `def.attack`）。游玩模式里友善实体照样打有害实体，所以看起来就是玩家的守护者。
```
followDist: 3   leadDist: 4.5（在玩家前方多远带路）   waitDist: 9（玩家落后就等）   noticeDist: 25   leash: 12
engage: true   leadTo: 'items'（最近的补给）| null | (e, api, P) => ({ x, z } | null)   seekRadius: 35   goalSec: 2
idle: 'face' | 'orbit'   onLead(e, goal, api)
状态：idle wander follow lead wait guard attack
```
选中版本说它"不会还手/不攻击" → `engage: false` 且不写 `attack`。

### 5.9 `A.swarm(opts)` 小型群体
一群 = 一个逻辑实体（`hp` 是整群血量，个体数随 hp 比例减少，客机一致）。模型必须用 `A.parts.swarm`（一个 InstancedMesh，一个 draw call）。
```
move: 'flyer' | 'ground'   light / lightRadius / diveRange: 3 / erratic: 0.8（flyer）   patrolRadius: 10（ground）
```
伤害按"很多小口"写：`attack.hp` 小、`cooldown` 短（flurry/fast）。

### 5.10 `A.hazardEntity(opts)` 环境型
地面/墙面的一片东西，贴上就挨打，阵营照常生效（游玩模式不伤玩家）。
```
creep: 0（>0：以这个速度蔓延/爬向目标）   seekRange: 0   patch: 0（斑块半径，米）
sanityRadius / sanityPerSec（只在范围内按秒扣 san，噩梦模式才生效）
状态：idle creep attack
```
- `radius` 给小（0.2–0.3，只管实体之间推挤；大了别的实体被推开、走不到斑块上）；斑块多大写 `patch`，和 `A.parts.decal({ radius })` 一致。
- 接触距离 = max(`attack.range`, `patch`) + 目标半径（骨架注册时自动把 range 抬到 patch）。
- 模型用 `A.parts.decal`；`perception.sight` 给小一点。

### 5.11 行为小工具（写自定义 think 时用）

```
A.state(e)                               e.data.arch
A.acquire(e, api, { sight, canTarget })  findTarget + 过滤
A.melee(e, api, t) → 'hit' | 'wait' | false   够得着就出手/等冷却（并写 e.state='attack'）；false = 继续靠近
A.reach(e, t)                            attack.range + 目标半径
A.speedOf(e, 'walk'|'run', 覆盖值)
A.patrol(e, api, A.state(e), { patrol, patrolRadius, patrolSpeed })
A.search(e, api, A.state(e), opts)       先设 state.lastX/lastZ/reached=false
A.nearestPlayer(e) → { ref, x, z, dist, peer } | null     本机玩家或联机对方
A.playerLooking(e, maxDeg, range) → bool                 本机玩家正看着它（含视线检测，0.2 s 缓存）
A.hearPlayer(e, api, hearing?) → { x, z, dist } | null   与攻击许可无关，只管听见
A.smellPlayer(e, api, radius?) → { x, z, dist, age } | null
A.lightSeek(e, api, radius, 'bright'|'dark') → { x, z, light } | null   1 s 缓存
A.nearby(api, e, radius, 'type' | ['hostile'] | fn) → [e]
A.cry(e, name, { cooldown: 3, chance, volume, rate, hear: 35 }) → bool   每实例每种声音独立冷却
A.sanityPulse(e, api, radius, perSec, interval=1)        状态相关的掉 san（常驻的写 def.aura）
```

组合示例（自定义弱点：被火把照到就逃，其他时候照常追猎）：
```js
brain: A.stalker({ patrol: 'home' }),
think(e, dt, api, brain) {
  const P = A.nearestPlayer(e);
  if (P && P.dist < 6 && hasTorch(P)) { e.state = 'flee'; api.flee(e, P.x, P.z, A.speedOf(e, 'run')); return; }
  brain.think(e, dt, api);
},
```

## 6. 模型构件

`build(ctx)` 必须返回 `A.wrap(...)` 的结果。坐标：米，原点在脚底中心，**面朝 -Z**，Y 向上。

```
A.wrap(model, { label, budget: 3000, form })   → root（entities.js 写位置/朝向）→ pivot（arch 动画写倒地/后仰/飞行高度）→ model
A.wrap({ disguise: objA, true: objB }, { form: 'disguise' })   多形态，按 e.state 切换（第 7 节）
```

所有人形/四足/昆虫/肢团都是**一个 SkinnedMesh，按材质槽位分组**：一个槽位一个 draw call，几何按参数缓存、全体实例共享，骨骼每实例一份。颜色和质感用 `colors` / `look` 按槽位给：

- `colors: { body: 0x..., head: 0x..., glow: 0x... }`（head 缺省同 body）
- `look: { body: 'lambert' | 'skin' | 'fur' | 'cloth' | 'chitin' | 'basic' | 'glow' | 'shadow' | 'wing' }`
- `mats: { slot: Material }` 直接给材质（覆盖上面两项）

### 6.1 `A.parts.humanoid(opts)` 人形
```
height: 1.8   thin: 0..1（瘦长）   bulk: 1（粗壮）   hunch: 0..1（佝偻）   pose: 'upright' | 'crawl'（四肢着地）
armLen: 1   legLen: 1   headSize: 1   shoulders: 1   neck: 1
head: 'round' | 'faceless'（无面：光滑拉长的蛋形）| 'box' | 'none'   hands: true   feet: true
claws: 0（每只手几根爪，槽位 claw）   hair: 0（头发下垂长度，占身高比例，槽位 hair）
face: null | glowFace 选项（贴在脸上的发光眼/牙，槽位 glow）
detail: null | 'high' | 'low'（缺省按 BR.game.settings.quality，规则见 6.9）
    'high'：躯干加胸廓/腰臀起伏（分段体，不是单段直筒）、肩颈过渡、肩/肘/膝关节球、手指（claws:0 且 hands 时；
            claws>0 仍然只出爪不叠手指）、脚掌+脚跟分开两块
    'low'：等同旧版本——单段直筒躯干、单块脚掌，没有关节球/手指，外观和性能都跟改动前一致
features: false | true | { brow, nose, ears, jaw }（仅 head:'round' 且 detail:'high' 时生效，缺省关闭）
    眉骨/鼻/耳/下颌，都挂在 head 骨骼、head 槽位，不占用额外 draw call
clothes: false | true | { collar, cuffs, belt, pockets, creases }（仅 detail:'high' 时生效，缺省关闭）
    领口/袖口/腰带/口袋/裤腿褶，都叠在躯干/四肢已有骨骼上、body 槽位
extend(b, dims)：往骨架里加东西（见 6.6），dims = { H, hipY, kneeY, shoulderY, headY, headR, shoulderW, hipW, elbowY, handY }
    （detail/features/clothes 只加形状，不改这些字段的公式和数值，已有 extend 不用因为这次改动调整坐标）
key：用了 extend 且闭包里有变量时必须给不同的 key（几何按 key 缓存；detail 解析出的 'high'/'low' 也算进缓存键，
    两档画质不会互相顶掉缓存几何）
骨骼：hips spine head armL foreL armR foreR legL shinL legR shinR     槽位：body head hair claw glow
```

### 6.2 `A.parts.quadruped(opts)` 四足兽
```
length: 1.1   height: 0.6（腿长）   girth: 0.2（躯干半径）   thin: 0..1   legThick: 1
neckLen: 0.28   headSize: 0.2   snout: 0.12（口鼻长，0 = 扁脸）   jaw: true   tail: 0.4（长度，0 = 无尾）
ears: 0（耳朵长度）   mane: 0（背上一排毛刺的长度，槽位 fur）
eyes: null | { size, glow: true }（glow:false 用 eye 槽位的普通颜色）   face: glowFace 选项
detail: null | 'high' | 'low'（规则同 6.1）
    'high'：脊背加肋骨起伏（胸腔与骨盆之间两个交替鼓包）、腿部关节球、脚掌前缘趾爪、jaw:true 时嘴里加一圈小尖牙、
            尾巴分节数从 3 增到 4
    'low'：等同旧版本，没有以上细节
骨骼：hips chest neck head jaw tail0..2 legFL shinFL legFR shinFR legBL shinBL legBR shinBR     槽位：body head fur eye glow
```

### 6.3 `A.parts.insect(opts)` 飞蛾/昆虫
```
span: 0.5（翼展）   bodyLen: 0.28   bodyR: 0.045   wings: 0 | 2 | 4   wingChord: 0.6   legs: 6   antennae: 0.12
eyes: null | { size, glow }
detail: null | 'high' | 'low'（规则同 6.1）
    'high'：胸腹之间加一段细腰（分节感）、触角改成两节链条（antennae>0 时，自动随 anim.sway 摆动）、
            每条腿改成两段带一个弯折点（比直棍更像虫腿）、翅面加三条翅脉
    'low'：等同旧版本——单节触角、直腿、无翅脉
骨骼：body head wingL wingR wingL2 wingR2     槽位：body wing eye glow（wing 缺省双面半透明）
```
大型飞行实体（女皇、禁卫级）用它放大；成群的小个体用 6.5 的 `swarm`。

### 6.4 `A.parts.limbCluster(opts)` 触手/肢团，`A.parts.silhouette(opts)` 影子剪影
```
limbCluster：count: 6   segments: 4   length: 1.0   radius: 0.06   tip: 0.012   spread: 0..1（0 竖直一束，1 向四周摊开）
             center: [0, 0.6, 0]   core: 0.22（中心肉团半径，0 = 无）   coreScale: [1,1,1]
             detail: null | 'high' | 'low'（规则同 6.1）：'high' 在每节交界加一颗指节小球，
                     每三条触手里有一条末端从光滑尖细收口换成三根小趾/爪叉开（肢体末端变化）
             骨骼：core t<i>_<k>（每条触手 k 节，自动随 anim.sway 摆动）
silhouette： humanoid 的全部选项（含 detail/features/clothes）+ opacity: 0.82
             rimOpacity: opacity*0.55（新增可选，缺省即此值）：hair/claw 槽位单独换成更透的材质，边缘（发梢/爪尖）
             比核心躯干更淡一层，做出"多层半透明"的渐隐边缘；不用 hair/claws 的调用外观不受影响
             所有槽位默认半透明黑（glow 槽位仍发光，可以只露眼睛）
```

### 6.5 其他构件
```
A.parts.glowFace(opts) → Mesh      黑暗里只有眼和牙的笑脸（笑魇）；面朝 -Z，中心在原点，自己设 position
    width: 0.3   eyes: 2   eyeSize / eyeGap / eyeY（缺省按 width 比例）   eyeShape: 'round' | 'slit' | 'tall'
    eyeHighlight: false（新增可选）：每只眼加一颗偏眼角的小高光点，单独成形，凸出主眼轮廓
    smile: true   teeth: 12   rows: 2   smileWidth / smileY / curve / toothH   color: 0xffffff
    toothShape: 'block' | 'fang'（新增可选）：'fang' 用小圆锥代替方块，牙齿变尖
    gumLine: false（新增可选）：牙齿上缘贴一条薄牙龈脊
    （以上四个新增参数缺省值等于旧行为，不传就和改动前长得一样）
A.geo.glowFace(opts) → BufferGeometry   同上的几何，给自定义骨架 b.geo(...) 用（translate 到脸的位置）
A.parts.orb({ radius: 0.08, color, halo: 0.7, own: false, y: 0 }) → Group   发光球 + 光晕；userData.orb = { core, halo, coreMat, haloMat }
A.parts.halo({ size: 0.8, color, own, y }) → Sprite    加法混合光晕（代替真光源）
A.parts.decal({ radius: 1, color, opacity: 0.9, wall: false, lumps: 9, seed: 1, look: 'lambert'|'glow' }) → Mesh   地面/墙面不规则斑块
A.parts.swarm({ unit: 'bug'|'moth'|'rat'|'mote', geometry, material, count: 24（≤120）, radius: 1.4, height: 1.3, flying: true, scale: 1, color, flap, flapHz }, ctx) → Group
    一个 InstancedMesh；个体围着实体中心绕、攻击时收拢、数量随 hp 比例减少
A.parts.hazmat(ctx, { full: false, detail: null }) → Object3D   测试人/玩家外形（防化服 + 玩家当前皮肤色），拟态用
    缺省是程序化仿制品（约 1k 面，detail:'high' 时另加兜帽轮廓/目镜/两侧滤罐/胸前拉链条/腕踝胶带环/腰带小包/靴底，约 1.6k 面）；
    full: true 直接用测试人的 hazmat.glb（约 1.8 万面，超预算，只适合同屏最多一两只的实体）
    制服颜色槽位（body/head）保持可被 BR.skin 改色；面罩/滤罐/手套/靴子/腰带/胶带环固定在 gear 槽位，颜色不随皮肤变
A.parts.rig(key, fn(b), { colors, look, mats }) → SkinnedMesh   完全自定义骨架（6.6）
```

### 6.6 自定义骨架（`extend` 或 `A.parts.rig`）
`b` 是 `A.RigBuilder`，所有坐标都是**模型空间的绑定姿势**（直立、展开，不带旋转）：
```
b.bone(name, parentName | null, [x, y, z])            加骨骼（关节位置）
b.box(bone, slot, [sx, sy, sz], [cx, cy, cz], [rx, ry, rz]?)
b.sphere(bone, slot, r, [cx, cy, cz], [sx, sy, sz]?, [wSeg, hSeg]?)
b.limb(bone, slot, from, to, r0, r1, seg=7, flat=1)   两点间圆台（四肢、脖子、躯干）
b.cone(bone, slot, from, to, r, seg=5)                尖刺、爪、角
b.chain(name, parent, from, dir, n, length, r0, r1, slot, seg=6) → [骨骼名]   触手/尾巴/长脖子，自动加入 sway
b.geo(bone, slot, bufferGeometry)                     任意几何（先 translate 到位）
b.setBase(name, rx, ry, rz, px, py, pz)               基础姿势（佝偻、张开的翅膀、歪头都靠它）
b.pos(name) → [x, y, z]
```
例：给人形加一张嘴里满是牙的脸和背上两条触手
```js
A.parts.humanoid({ height: 1.9, head: 'round', key: 'mything_v1',
  extend(b, d) {
    b.geo('head', 'glow', A.geo.glowFace({ width: d.headR * 1.6, eyes: 0, teeth: 14 }).translate(0, d.headY - d.headR * 0.3, -d.headR * 0.95));
    for (const s of [-1, 1]) b.chain('tent' + (s < 0 ? 'L' : 'R'), 'spine', [s * 0.1, d.shoulderY - 0.1, 0.1], [s * 0.4, 0.3, 1], 4, 0.9, 0.05, 0.01, 'body');
  },
});
```

### 6.7 材质 `A.mat`（全部经 `BR.assets.material` 缓存、全体共享）
```
A.mat.lambert(color, { side, emissive, opacity })    A.mat.basic(color, { fog, side, opacity })
A.mat.glow(color)          自发光：不受光照、不吃雾（暗处和雾里先看见它）
A.mat.shadow(opacity)      半透明黑
A.mat.skin / fur / cloth / chitin(color, repeat=2)   程序化灰度纹理 × 颜色（皮革斑驳 / 毛绒笔触 / 布料经纬 / 甲壳环节）
A.mat.wing(color, opacity)  A.mat.halo(color)（SpriteMaterial）
A.mat.own(material)        克隆一份并标 entityOwned —— 只有需要每实例单独改色/闪烁时才用（示范向导按状态换色）
```

### 6.8 外形规则
- 外形从选中版本的 `appearance` + `size` 逐条落实：体型比例、颜色、发光部位（只有写了发光才用 glow）、肢体数量、特征（毛、牙、无面、爪、翅膀数）。没写颜色 → 取不抢眼的中性色并注释"非设定"。
- 描述可变形/无定形：挑选中版本**明确列出的**一种形态做主模型，其他形态写进 notImplemented 或做成多形态（`wrap({...})`）。
- 不要在 `build` 里 `new THREE.Mesh*Material`（每只一份材质，几十只就是几十份）；用 `A.mat` 或模块级缓存。实例独有的几何/材质把 `userData.entityOwned = true`。
- 不要为每个关节挂单独的 Mesh；刚体附件确实需要时（如手里拿的东西）挂到 `rig.bones.<名字>` 下，每个多一个 draw call。
- 重要实体可以走 Blender 出 GLB（`BR.assets.modelSync`），但 GLB 不能直接用 arch 的程序化动画；没有必要就用构件。

### 6.9 精细度与性能预算（新增；这里给的数字是 6.1–6.5 构件的当前值，比第 10 节写的旧数字更新）
- `detail: null | 'high' | 'low'`：6.1–6.4 的构件都支持这个可选参数。显式给 `'high'`/`'low'` 就直接用；缺省时
  取 `BR.game.settings.quality`（设置里的画质开关，`'low'`/`'high'`），`'low'` 画质自动退回接近旧版本的简版
  （单段直筒躯干、单块脚掌、单节触角/直腿、没有关节球/牙列/指节/手指）。不传 `detail` 的旧实体文件不用改代码：
  桌面/`'high'` 画质下自动变精细，`'low'` 画质下和这次改动前长得一样、面数也基本一样。
- 三角面预算：普通实体（`A.wrap` 默认 `budget`）≤ 4000（原 3000，`TRIS.normal`）；群体个体（`parts.swarm` 的
  单个实例几何）≤ 120 三角面（原 300，`TRIS.swarmUnit`）。
- draw call 预算：每只实体 ≤ 5（按材质槽位分组算，`TRIS.drawCalls`）；`A.wrap` 现在会在超过时打
  `[arch] 模型 draw call … 超过 5` 的警告，和三角面超预算的警告一样，靠 `node tests/preview.mjs --arch` 的
  构件陈列自检发现。这次新增的关节球/手指/衣着/五官/牙列/触角链/指节/翅脉等细节全部叠在人形/四足/昆虫/肢团
  已有的 `body`/`head`（hazmat 是 `gear`）槽位上，不新增材质槽位，不会让 draw call 变多。

## 7. 动画（`def.anim`）

```
gait: 'biped' | 'crawl' | 'quad' | 'flyer' | 'none'   缺省按骨骼自动判断
stride: 步幅米数（一整个步态周期走多远，缺省 0.8×height）   breathe: 0.03（0 关闭）   twitch: 0（抽搐幅度，0.1–0.3）
sway: 0.25（触手/尾巴摆幅）   swaySpeed: 1.6   flapHz: 6（扇翅频率）
strike: 'swipe' | 'bite' | 'lunge' | 'grab' | 'sting' | 'none'   攻击状态下每个冷却周期播一遍
recoil: 0.22（挨打后仰弧度）   fall: 'back' | 'side' | 'crumple' | 'fade' | 'drop' | 'none'
fly: { cruise: 2.0, low: 1.0（俯冲/攻击高度）, rest: 0（hide/land 状态高度）, bob: 0.1, bobHz: 1.3, bank: 0.08, ceiling: true, clearance: 0.35 }
     飞行高度是 pivot 的 y（e.y 永远是地面）；自动避开天花板（clearance = 模型原点到天花板留的空）
pulse: 0.08（orb 光晕呼吸幅度）
stateSounds: { 状态名: 声音名 }   进入该状态时播放（房主和客机都会播）   stateSoundCooldown: 2
formOf(state, e) → 形态名   多形态切换；缺省：有同名形态就用它，否则 'main' / 'true'
lod: true   onFrame(e, dt, api, u)   跟着降频调用的自定义动画；u.rig 是当前骨架，u.pivot、u.orb、u.swarm、u.sp（当前速度）
```

- **animate 只能读** `e.state`、位移、`e.hitAt`、`e.dead`、`e.hp/maxHp`；**不能读 `e.data`**（联机客机上是空的），**不能改** `e.x/y/z/yaw`。
- `onFrame` 里做额外骨骼动作：`A.anim.addRot(u.rig, 'head', x, y, z)`、`A.anim.addPos(...)`（自动动画每帧先回到基础姿势，所以只管叠加）。也可调用 `A.anim.biped/crawl/quad/flap/sway/breathe/twitch/strike(rig, ...)`。
- 远处降频：< 14 m 每帧，14–28 m 20 Hz，28–50 m 8 Hz，50–80 m 3 Hz，> 80 m 不动；背对相机最多 6 Hz。

## 8. 声音

`BR.audio.play` 可用名：`step step-wet pickup drink eat hurt death whisper giggle growl screech door noclip heartbeat buzz static click hit breath`；
别名：`scream/shriek→screech`、`laugh→giggle`、`roar→growl`、`footstep→step`、`splash→step-wet`、`zap/shock→buzz`、`attack/punch→hit`、`heart→heartbeat`、`exit→noclip`。

- `def.sounds.idle`：玩家 25 m 内每 6–14 秒随机播；`alert`：第一次锁定目标；`attack`：每次出手。死亡引擎自动播 `hit`。
- 状态相关的叫声用 `anim.stateSounds`（两端都响）；`A.cry` 在 think 里调只有房主听得见。
- 声音要和选中版本对得上（嚎叫、笑声、学舌低语……），没写叫声就不加 alert/idle。需要新音色写进 `apiRequests`。

## 9. 光与发光

- 实体**不能**占用真实灯光（gfx 预算只给层级灯）。发光部位用 `glow` 槽位 / `A.mat.glow`，光晕用 `A.parts.halo`。
- 行为上"被光吸引/惧光/需要光"用 `api.lightAt` —— `A.flyer({ light })`、`A.lightBound`、`A.lightSeek`、`perception.needsLight`。

## 10. 性能底线（中端安卓 30 fps）

- 普通实体 < 3000 三角面（`wrap` 超了会 console.warn；不算 `parts.swarm` 的实例化个体）；群体个体 < 300，个体数 × 个体面数尽量 < 6000（moth 52 面 → 最多约 120 只）。`A.trisOf(obj)` 连实例一起算总面数。
- 材质槽位 ≤ 4（= draw call 数）；群体一律 `parts.swarm`（1 个 draw call）。
- think 里不要每帧打射线/遍历全部实体：`findTarget` 已限频；`lightAt` 用 `A.lightSeek` / `lightBound` 的缓存；自己的扫描加计时器。
- 不在 think/animate 里 `new` 对象、数组（手机 GC 卡顿）。

## 11. 联机

- `think`/`init`/`onHit`/`onDeath` 只在房主跑；`build`/`animate` 两端都跑。
- 同步到客机的只有 `[id, type, x, z, yaw, state, hp]`（10 Hz）。一切表现都要能从这几个字段推出来 —— 需要客机也看到的状态，就编码进 `e.state`（字符串，短一点）。
- 随机数：影响行为的用 `api.rng()`；纯表现可以用 `Math.random()`。计时用 `api.time`，不要 `setTimeout`。

## 12. 验收

1. `node --check js/entities/<type>.js`。
2. `node tests/preview.mjs --entity <type> --with test_dummy`（有害再加 `,_dev_friendly`；友善加 `,_demo_stalker`；想看它打玩家加 `--mode nightmare`；`--seconds 15 --dist 5` 可调）。
   截图在 `tests/output/preview/<type>-N-<镜头>.png`：1 正面 2 侧面 3 背面 4 走动 5 同框，之后按事件 attack / hurt / kill / dead 各一张，最后 end；
   终端打印各方状态序列、血量、击杀、玩家挨打次数、三角面/draw call，行首 `PREVIEW_JSON` 是完整 JSON。改了 `_archetypes.js` 的人跑 `node tests/preview.mjs --arch` 自检。
   Read 截图逐项核对：
   - **外形**：正面/侧面/背面截图能认出是选中版本描述的东西（体型、颜色、发光部位、特征）；
   - **动作**：移动时有步态/扇翅/蠕动，攻击时有出手动作，挨打后仰，死亡倒地；
   - **攻击测试人**：有害实体会追打测试人（测试人 hp 下降/死亡），友善实体不打测试人；
   - **与友善/有害互动**：有害 vs 友善互打；中立只在被打后还手；
   - **不打玩家**：测试模式里玩家 hp 始终 100；
   - 零 console error；三角面不超预算。
3. 返回值：文件、实现了的描述细节（逐条）、没实现的细节 + 原因、截图路径、`apiRequests`。

## 13. 常见坑

- `version` 写成了别的版本，或从 `conflicts` / 其他版本抄了细节。
- 骨架片段 + 自己又写了 `think` 却忘了调 `brain.think`；覆盖 `dispose` 不用担心，`register` 会先调骨架的。
- 朝向搞反：本项目面朝 **-Z**，朝向 (dx, dz) 的 yaw = `Math.atan2(-dx, -dz)`。
- 在 `build` 里读 `e.data`（`init` 还没跑）；在 `think` 里改 `e.obj`（客机不会有这段）。
- 拟态写了 `sounds.alert`（锁定目标时会穿帮）。
- `attack.range` 小于 `radius`：只打得到玩家，测试人和友善/有害实体永远够不着（注册时有 `[arch]` 警告，预览里测试人 hp 不掉）。
- 想让有害实体在游玩模式里追着玩家跑或伤害玩家 —— 用户规则禁止，阵营规则也会拦住。
- 描述里跨层级的行为（跟着切出、把人拖去别的层）实体文件不实现换层，写进 notImplemented。

## 附：范围决定（用户 2026-09-13）

- **M.E.G. 等据点/基地**：挂上游戏大厅之后单独做。现在层级里按选中版本只摆静态建筑、标识、围挡等外观，不做可进入的交互、驻守 NPC 或据点逻辑。
- **交易系统**：同样挂上大厅之后再做。现在不要为交易品设计交互（例如"交给某实体换东西"），物品保持自用。
- **NPC 对话**：不做。实体描述里的说话、交谈、喊话一律不实现，也不要做文字气泡；需要时用已有音效表现"在说话"。
