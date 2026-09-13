// 死亡飞蛾 Deathmoths（Entity 4）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-4  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
//
// 选中版本把种群分成 卵/幼虫/普通雄性/普通雌性/禁卫级/女皇 六个阶级，外形与敌意都不同（hostility=varies，
// hostilityNote："雄性温顺；雌性高度敌意；禁卫级极端敌意"）。按 _TEMPLATE.md 第 1 节拆分多个 type。
// 受本轮额度限制，本文件落地 deathmoth_male / deathmoth_female / deathmoth_guard 三型；
// 卵、幼虫、女皇写进 notImplemented（原因见返回值）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 三型共用感官/弱点依据：
// "复眼、单眼、羽状触角；趋光性强"（senses）+ S.W.A.R.M.S. 弱点"避开强光（会吸引飞蛾）"
// → 三型都用 A.flyer({ light: 'attract' })，被光吸引会飞过去绕圈。
// 颜色未记载（appearance 原文明确"页面没有颜色、声音或发光的描述"）→ 统一取不抢眼的昆虫灰褐色，非设定。
const MOTH_COLORS = { body: 0x59503f, wing: 0x7d7160, eye: 0x141210 };

function buildMoth(opts, label) {
  return A.wrap(A.parts.insect(Object.assign({ wings: 2, legs: 6, colors: MOTH_COLORS }, opts)), { label });
  // wings 用构件默认值 2（一对大翅）：选中版本没写翅膀数量，不凭空加成两对，非设定。
}

// ---------------- 普通雄性：温顺食腐者 ----------------
A.register({
  type: 'deathmoth_male', en: 'Deathmoth (Male)', zh: '死亡飞蛾·雄性', version: 'wikidot-cn',
  faction: 'neutral',
  // 依据：hostility=varies；hostilityNote"雄性温顺"+behavior"温顺的食腐者，缺乏有效的捕猎工具，可被驯化"
  // → 常态不主动伤人，按 varies 判断规则记 neutral（只在被攻击后反击）。

  hp: A.HP.fragile,                 // 依据：同上"温顺""缺乏有效捕猎工具"→ 种群里最不禁打的一档
  radius: 0.16, height: 0.32,       // 依据：size"普通雄性：翼展 30–35 cm（取 32.5 cm 半展开半径≈0.16 m）、体长 40–50 mm"
  speed: { walk: A.SPEED.slow, run: A.SPEED.walk },
  // 依据：speed 字段"无数字"；按"温顺、缺乏捕猎工具"给弱档，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 300 },
  // 依据：fov 放宽——senses"复眼、单眼、羽状触角"复眼视野广；具体角度未写，300° 非设定
  attack: { hp: A.DAMAGE.graze, sanity: 0, range: 0.5, cooldown: A.COOLDOWN.slow },
  // 依据：appearance"普通雄性：…针状口器"是吸食失能猎物体液的工具而非战斗武器，attack 段也只写雄性"吸干丧失行动能力的人类"，
  // 不是主动出手攻击 → 给最低伤害档、慢冷却，只作被激怒时的象征性还手
  sounds: {},                       // 依据：sounds 字段"未提及"，不加任何叫声

  brain: A.flyer({ light: 'attract', lightRadius: 12, diveRange: 1.2, orbitRadius: 1.1, erratic: 0.4 }),
  // diveRange 给很小：雄性"缺乏有效的捕猎工具"，不会像雌性/禁卫级那样主动扑击目标
  anim: { gait: 'flyer', flapHz: 9, strike: 'sting', fly: { cruise: 0.9, low: 0.6, bob: 0.15, bobHz: 2 } },

  build(ctx) {
    return buildMoth({
      span: 0.325, bodyLen: 0.045, bodyR: 0.012, antennae: 0.07,
      // 依据："普通雄性：发达的感知触角" → 触角比其他型给长
      eyes: { size: 0.01, glow: false },   // 依据：复眼，未记载发光 → glow:false
    }, 'deathmoth_male');
  },
});

// ---------------- 普通雌性：集群猎手 ----------------
A.register({
  type: 'deathmoth_female', en: 'Deathmoth (Female)', zh: '死亡飞蛾·雌性', version: 'wikidot-cn',
  faction: 'hostile',
  // 依据：hostilityNote"雌性高度敌意"+behavior"雌性极具攻击性；集群狩猎，剥离组织，喷射腐蚀液，释放信息素召集支援"

  hp: A.HP.weak,                    // 依据：appearance"普通雌性：胸腹粗壮，颚部发达"，比雄性更耐打但仍是昆虫躯体
  radius: 0.21, height: 0.4,        // 依据：size"翼展 40–45 cm（取 42.5 cm）、体长 60–70 mm（取 65 mm）"
  speed: { walk: A.SPEED.brisk, run: A.SPEED.jog },
  // 依据：speed 未给数字；按"集群狩猎"敏捷度取中档，非设定
  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.normal, fov: 300 },
  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 1.3, cooldown: A.COOLDOWN.fast },
  // 依据：attack"雌性集群剥离组织"→伤害取高档；range 放大近似"喷射腐蚀液"的喷射距离
  // （引擎没有真正的远程抛射，只能用 range 近似，见返回值 apiRequests）；冷却短对应集群连续撕咬
  sounds: {},                       // 依据：同上，未记载声音

  brain: A.flyer({ light: 'attract', lightRadius: 12, diveRange: 6, orbitRadius: 2, erratic: 0.6 }),
  anim: { gait: 'flyer', flapHz: 12, strike: 'sting', fly: { cruise: 1.8, low: 0.9, bob: 0.15, bobHz: 2.4 } },

  build(ctx) {
    return buildMoth({
      span: 0.425, bodyLen: 0.065, bodyR: 0.018, antennae: 0.05,
      eyes: { size: 0.014, glow: false },
    }, 'deathmoth_female');
  },
});

// ---------------- 禁卫级：护卫女皇的精英个体 ----------------
A.register({
  type: 'deathmoth_guard', en: 'Deathmoth (Elite Guard)', zh: '死亡飞蛾·禁卫级', version: 'wikidot-cn',
  faction: 'hostile',                // 依据：hostilityNote"禁卫级极端敌意"
  hp: A.HP.sturdy,
  // 依据：size 里体型远超雌雄成虫（直立近 1 m），behavior"护卫女皇""肢解猎物"→种群里最耐打的一档
  radius: 0.3, height: 1.0,
  // 依据：size"禁卫级：直立高近 1 m，体径 15–20 cm（半径≈0.09 m），附肢长 70–75 cm"，
  // 长附肢会扩大有效碰撞/攻击范围，radius 略放大到 0.3
  speed: { walk: A.SPEED.jog, run: A.SPEED.run },
  // 依据：behavior"敏捷迅速"；数值未给，取高档非设定
  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.normal, fov: 300 },
  attack: { hp: A.DAMAGE.lethal, sanity: 0, range: 1.6, cooldown: A.COOLDOWN.fast },
  // 依据：attack"禁卫级附肢毒液浓度比幼虫更高"+behavior"攻击脆弱部位，喷射腐蚀液，肢解猎物"→取最高伤害档；
  // range 按附肢长 70–75 cm 加喷酸距离放大近似；冷却短对应"敏捷迅速"
  sounds: {},

  brain: A.flyer({ light: 'attract', lightRadius: 14, diveRange: 8, orbitRadius: 2.4, erratic: 0.3, climbSec: 0.6 }),
  anim: { gait: 'flyer', flapHz: 8, strike: 'grab', fly: { cruise: 2.2, low: 1.0, bob: 0.1, bobHz: 1.6 } },
  // strike 'grab' 近似"攻击脆弱部位，肢解猎物"用长附肢抓扯的动作

  build(ctx) {
    return buildMoth({
      span: 0.6, bodyLen: 0.2, bodyR: 0.09, legs: 8, antennae: 0.08,
      // 依据："禁卫级：八条长附肢" → legs:8；其余尺寸见 size 段
      eyes: { size: 0.03, glow: false },
    }, 'deathmoth_guard');
  },
});
})();
