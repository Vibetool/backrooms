// 无面灵 Facelings（Entity 9）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-9  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
//
// 选中版本写了常见型 + 多边形/暗影/记忆/进化种四个亚种，外形均不同（appearance 段逐条列出）。
// 按 _TEMPLATE.md 第 1 节：外形不同就要拆多个 type。受本轮额度限制，本文件落地
// faceling（常见型）/ faceling_polygonal（多边形）/ faceling_shadow（暗影）三型；
// 记忆亚种、进化种写进 notImplemented（原因见返回值）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 三型共用（appearance/behavior/attack 段没有按亚种拆开这几项，hostility 字段本身就是 neutral，不是 varies）：
const HP = A.HP.weak;
// 依据：weaknesses"体力弱于多数成年人""骨骼脆，会腐烂、破裂或长出肿瘤"→比测试人(100血)弱得多但不是一碰就死
const SPEED = { walk: A.SPEED.walk, run: A.SPEED.jog };
// 依据：speed"未给数值。体力弱于多数成年人，发怒时相对容易甩掉"→ run 用 jog 档（玩家步行甩不掉、冲刺能甩开）
const ATTACK = { hp: A.DAMAGE.light, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal };
// 依据：attack"发怒时徒手攻击惹怒它的对象…成年个体力气弱，历史上从未找到蓄意行凶的详细记录…没有记载的致死案例"→取低伤害档

function faction() { return 'neutral'; }
// 依据：hostility 字段本身就是 "neutral"（正文"多数温顺…被激怒才动手"），不是 varies，三型都直接沿用，无需按 varies 规则判断

// ---------------- 常见型 ----------------
A.register({
  type: 'faceling', en: 'Faceling (Common)', zh: '无面灵·常见型', version: 'wikidot-en',
  faction: faction(),
  hp: HP, radius: 0.28, height: 1.75,
  // 依据：size"未给数值，结构与人类相同"→按普通人体型给默认值，非设定
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据：senses"常见型没有眼睛，行动却像看得见；没有感官器官也能清楚理解同类"→非视觉的全向感知，fov 给 360
  attack: ATTACK,
  sounds: {},   // 依据：behavior"常见型没有声带，交流完全无声"→不加任何叫声

  brain: A.wanderer({ retaliate: 'fight' }),
  // 依据：behavior"多数温顺，痴迷于模仿人类的角色…很容易被小事激怒…被故意攻击时情绪会升级"→日常游荡，被打就地反击（不逃跑）
  anim: { gait: 'biped', twitch: 0.05, fall: 'back' },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.75, thin: 0.1, head: 'faceless', hair: 0.22, face: null,
      // 依据：appearance"人体结构…头发完整，唯独脸上没有任何五官（无眼、无口、无鼻），无发光部位"
      colors: { body: 0xc9a888, hair: 0x2b2318 },
      // 依据："发色、肤色…各不相同"没有指定具体色号 → 取中性肤色/发色，非设定
      look: { body: 'skin', hair: 'fur' },
    }), { label: 'faceling' });
  },
});

// ---------------- 多边形亚种 ----------------
A.register({
  type: 'faceling_polygonal', en: 'Faceling (Polygonal)', zh: '无面灵·多边形亚种', version: 'wikidot-en',
  faction: faction(),   // 亚种没有单独的敌意描述，沿用常见型 hostility=neutral
  hp: HP, radius: 0.3, height: 1.75,
  // 依据：appearance"多边形无面灵：身体由大块平坦的多边形面拼成，大致人形但方正笨拙，像早期 3D 游戏角色"→用加粗方正的体型近似；
  // 身高选中版本（wikidot-en）没有单独给数值，沿用常见型默认身高，非设定（wikidot-cn 的"身材矮小"译法不是本次选中版本，不借用）
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  attack: ATTACK,
  sounds: {},

  brain: A.wanderer({ retaliate: 'fight' }),
  anim: { gait: 'biped', twitch: 0.1, fall: 'back' },
  // twitch 略高于常见型：呼应"方正笨拙"的关节僵硬感，非设定数值，只是表现取舍

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.75, thin: 0, bulk: 1.25, head: 'box', hands: true, face: null,
      // 依据：appearance"身体由大块平坦的多边形面拼成，大致人形但方正笨拙，像早期 3D 游戏角色"→ 用方形头 + 加粗躯干近似
      colors: { body: 0xab9c86 },
      look: { body: 'chitin' },
      // 依据："皮肤粗糙、干燥、易剥落"→借用甲壳纹理表现粗糙质感，颜色未记载取干裂土色，非设定
    }), { label: 'faceling_polygonal' });
  },
});

// ---------------- 暗影亚种 ----------------
A.register({
  type: 'faceling_shadow', en: 'Faceling (Shadow)', zh: '无面灵·暗影亚种', version: 'wikidot-en',
  faction: faction(),
  hp: HP, radius: 0.26, height: 1.75,
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  attack: { hp: A.DAMAGE.graze, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal },
  // 依据：behavior"暗影亚种受惊时会防御性攻击，但力量不足以造成重大伤害"→比常见型更弱的伤害档
  sounds: {},

  brain: A.wanderer({ retaliate: 'fight' }),
  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    // 依据：senses"暗影亚种会被光源吸引"→ 游荡/待机时若附近有更亮处，缓慢飘过去；不影响被攻击后反击的骨架逻辑
    if (e.state === 'wander' || e.state === 'idle') {
      const spot = A.lightSeek(e, api, 10, 'bright');
      if (spot) api.moveToward(e, spot.x, spot.z, A.speedOf(e, 'walk') * 0.6);
    }
  },
  anim: {
    gait: 'none', fall: 'fade',
    fly: { cruise: 1.5, low: 1.5, bob: 0.08, bobHz: 1.0, clearance: 0.3 },
    // 依据：appearance"暗影亚种：漆黑、幽灵般的身体，在黑暗区域自发悬浮"→ 不用双足步态，用悬浮高度表现
  },

  build(ctx) {
    return A.wrap(A.parts.silhouette({ height: 1.75, thin: 0.15 }), { label: 'faceling_shadow' });
    // silhouette 默认全身半透明黑、faceless 头，正好对应"漆黑、幽灵般的身体"，没有额外发光部位（未记载）
  },
});
})();
