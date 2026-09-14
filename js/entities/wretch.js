// 悲尸 Wretches（Entity 15）——标准型 + 畸形肉块变体（外形差异很大，按 _TEMPLATE.md 第 1 节拆成两个 type）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-15  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 感染（2026-09-14）：被悲尸划伤的人类目标（测试人、噩梦生存里的玩家）走悲尸循环三阶段，45 秒没治好就变成悲尸。
//   依据：选中版本"第三阶段产生的棕色淤泥，接触后几分钟内使人开始转变" + 用户指定"划伤即感染"（data/lore-choices.json userOverride）。
//   两种形态都会感染，转化结果统一是标准型 wretch。机制在 BR.entities.infect（实体侧）和 BR.effects（玩家侧），本文件只声明规格。
//   悲尸挠上感染后就放过那个测试人（CYCLE.sparesInfected），测试模式里才看得到三阶段症状和 45 秒原地转化；噩梦里的玩家照常被追杀
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---- 数值：两个形态共用（版本原文没有分别给两种形态的耐久/攻击力，只有外观差异） ----
const SPEED = { walk: A.SPEED.slow, run: A.SPEED.sprint };
// 依据："速度从缓慢蹒跚到超越人类的短跑，无数字"——蹒跚取 slow，"超越人类"对应 SPEED 表里明确标注
// "比人快、跑不掉"的 sprint 档，两端都覆盖了原文描述的区间
const ATTACK = { hp: A.DAMAGE.severe, range: 0.9, cooldown: A.COOLDOWN.normal };
// 依据："力量超强，可破墙而入"+"已知最可怕的实体之一，绝不要互动"→ 高致死取 severe；
// 攻击频率原文没写，按同类近战掠食者取中档 normal，非设定精确值
const HP = A.HP.sturdy;
// 依据：没有明确耐久描述，"骨瘦如柴的外表掩盖了强大力量"只说明力气大不说明多经打；
// 异化后的躯体按常理应比普通人耐打，取比测试人略高一档的 sturdy，非设定精确值
const SOUNDS = { idle: 'growl', alert: 'giggle', attack: 'growl' };
// 依据："咯咯声和咆哮；低音调表示没有智慧，高音调表示有智慧或是速度型"——两种音色都在允许的音效表里：
// growl（咆哮，低音调/迟钝个体）用作日常和攻击时的声音，giggle（咯咯声，高音调/机敏个体）用作发现目标时的叫声

// ---- 悲尸循环：划伤感染 → 三阶段 → 转化（用户 2026-09-14 指定"被悲尸划伤会变成悲尸"） ----
// 时长：原文只说"接触后几分钟内使人开始转变"，没给三个阶段各多久、全程多久。下面是按游戏节奏压缩的可调常数，不是设定数值：
//   第一阶段要留够玩家翻背包吃东西的时间，全程又不能长到测试模式里等不到结果
const STAGE2_AT = 15;    // 可调：进入第二阶段（皮肤干裂、冒脓疱）
const STAGE3_AT = 30;    // 可调：进入第三阶段（眼睛乱转、无药可救）
const TURN_AT = 45;      // 可调：转化成悲尸
const RISE_SEC = 4;      // 可调：感染中被打死后尸体抽搐多久爬起来。原文没写死后转变，按"几分钟内开始转变"延伸，非设定数值
const CYCLE = {
  key: 'wretch_cycle', toType: 'wretch',
  // 每阶段的解药按选中版本弱点："第一阶段靠正常饮食休息可逆转；第二阶段只有杏仁水和清新剂有效；第三阶段无药可救"
  //   'food' = 任何食物、'almond_water' = 杏仁水及彩色瓶（BR.effects.itemCureTags）；游戏里没有现实清新剂，第二阶段只剩杏仁水
  // toast / visual 只作用于玩家：原文没给这几个阶段掉血掉 san 的数字，所以只做提示和画面反馈，不凭空加数值伤害
  stages: [
    { at: 0, cureTags: ['food', 'almond_water'], visual: { flash: '#5a3420', peak: 0.35 },
      toast: '被悲尸划伤了——伤口在渗棕色淤泥，手脚开始抽搐。趁早吃点东西或喝杏仁水' },
    { at: STAGE2_AT, cureTags: ['almond_water'], visual: { flash: '#6b2c16', peak: 0.3, pulse: 6 },
      toast: '皮肤发干开裂、冒出脓疱……普通食物已经压不住，只有杏仁水还有用' },
    { at: STAGE3_AT, cureTags: [], visual: { flash: '#3d140a', peak: 0.4, pulse: 3, distort: 0.25 },
      toast: '眼睛不受控制地乱转，身体不再听使唤……已经无药可救了' },
  ],
  transformAt: TURN_AT,
  deathRiseSec: RISE_SEC,
  // 挠上就放过（2026-09-14 验收后定，可调：改成 false 就恢复"一直打到死"）。依据"群体像蜂巢社会一样运作"——
  // 被感染的人正在变成群体的一员，悲尸传上感染就去找下一个，不把它撕碎。实际原因：悲尸一下 severe 伤害，测试人 100 血
  // 挨两下就死，自然流程里永远只能看到"挠一下→倒地→爬起"，三阶段症状和 45 秒原地转化根本出不来。
  // 只放过实体目标（测试人）：噩梦里的玩家照常被追杀，用户定死"噩梦生存实体正常攻击人类"，这里不替用户放水
  sparesInfected: true,
  cause: '你变成了悲尸',
  cureToast: '抽搐停了——悲尸感染被压了下去',
};
// 两种形态的 onAttack：只感染人类目标（玩家和 def.human 的实体，目前是测试人），友善实体等被挠了照常只掉血。
// 玩家是否真的会被感染由 infect 再按模式把关（只有噩梦生存），这里不用重复判断
function scratch(e, t, api) {
  if (api.isHuman(t)) api.infect(t, CYCLE, e);
}

A.register({
  type: 'wretch', en: 'Wretch', zh: '悲尸', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility 字段直接给了 hostile
  hp: HP,
  radius: 0.35, height: 1.78,   // 依据：没给具体尺寸数字，但"常保留衣服等人类遗物"说明体型接近普通人，按人形常见值取，非设定精确数字
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150, needsLight: false, avoidsLight: false },
  // 依据：感官"未提及具体感官"，全部用默认值；人形前向视野取 120–160 档区间里的 150，非设定精确数字
  attack: ATTACK,
  sounds: SOUNDS,
  infection: CYCLE,   // 只读，给测试和别的模块查时间线；改数值请改上面的常数
  brain: A.pack({ patrolRadius: 16, howl: 'growl', onAttack: scratch }),
  // 依据："群体像蜂巢社会一样运作"——用群猎骨架体现协同索敌/包抄，而不是各自为战的追猎者；
  // howl 沿用 growl（没有专门的"蜂群警报"音效，见 apiRequests）
  anim: {
    gait: 'biped', stride: 1.5, twitch: 0.08, strike: 'swipe',
    // 依据：twitch 呼应"变异常见：眼睛错位、四肢增生"带来的不安感，幅度给小值，非设定精确数字；
    // strike:'swipe' 对应"力量超强，可破墙而入"的抡砸式攻击
    onFrame(e, dt, api, u) {
      if (!u.rig || !u.rig.bones.eyeL) return;
      const spin = api.time * 9;   // 依据："第三阶段眼睛疯狂转动"——持续快速自转，两只眼睛反向转更显得癫狂
      A.anim.addRot(u.rig, 'eyeL', 0, 0, spin);
      A.anim.addRot(u.rig, 'eyeR', 0, 0, -spin);
    },
  },
  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.78, thin: 0.75, hunch: 0.2, armLen: 1.1, head: 'round',
      // 依据："骨瘦如柴的外表""四肢增生"类变异——用偏瘦、佝偻、手臂略长来体现异化的人形；armLen 加长
      // 也呼应"力量超强、可破墙而入"给人的怪力联想，非设定精确数字
      colors: { body: 0x7a4a34, head: 0x7a4a34, glow: 0xcabba3 },
      // 依据："红褐色干燥皮肤"——身体/头部取红褐色；glow 槽位（眼球）取苍白的巩膜色，见下方 look 覆盖为非发光
      look: { body: 'skin', head: 'skin', glow: 'lambert' },
      // 依据：look.glow 显式覆盖成 'lambert'（不发光）——原文只说眼睛"疯狂转动"，没说会发光，不能想当然加发光效果
      key: 'wretch_v1',
      extend(b, d) {
        // 依据："第三阶段眼睛疯狂转动"——独立骨骼便于旋转动画（见上方 anim.onFrame）
        b.bone('eyeL', 'head', [-d.headR * 0.35, d.headY + d.headR * 0.1, -d.headR * 0.85]);
        b.sphere('eyeL', 'glow', d.headR * 0.16, [0, 0, 0]);
        b.bone('eyeR', 'head', [d.headR * 0.35, d.headY + d.headR * 0.1, -d.headR * 0.85]);
        b.sphere('eyeR', 'glow', d.headR * 0.16, [0, 0, 0]);
        // 依据："覆盖孔洞和脓疱"——躯干上加两个凸起的脓疱，颜色沿用 body 材质（没有单独的脓疱颜色描述）
        b.sphere('spine', 'body', 0.05, [0.12, d.shoulderY * 0.6, 0.1]);
        b.sphere('spine', 'body', 0.045, [-0.1, d.shoulderY * 0.75, -0.08]);
      },
    }), { label: 'wretch' });
  },
});

A.register({
  type: 'wretch_lump', en: 'Wretch (flesh lump variant)', zh: '悲尸·畸形肉块变体', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：仍属于悲尸整体的 hostile 判定，原文没有为这个变体单独给敌意
  hp: HP,
  radius: 0.5, height: 0.55,
  // 依据："畸形肉块变体几乎全由眼球和口器组成"——没有四肢的团块状躯体，给较矮较宽的碰撞体，非设定精确数字
  speed: { walk: A.SPEED.slow, run: A.SPEED.jog },
  // 依据：同标准型的整体速度区间描述，但没有四肢的团块不可能达到"超越人类"的短跑，run 取偏低档 jog，非设定精确数字
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: false },
  // 依据："几乎全由眼球组成"——不止一双眼睛，判定为全向感知，fov 给 360，非设定精确数字
  attack: ATTACK,
  sounds: SOUNDS,
  infection: CYCLE,   // 同标准型：畸形肉块变体挠到人一样会让人变成（标准型）悲尸
  brain: A.stalker({ patrol: 'wander', patrolRadius: 10, onAttack: scratch }),
  // 依据：这是"变异常见"里提到的一种罕见变体，不是蜂巢群体的常态个体，用单体追猎者骨架而不是群猎
  anim: {
    gait: 'none', twitch: 0.3, strike: 'grab', fall: 'crumple',
    // 依据：没有四肢，没有标准步态；twitch 加大表现团块蠕动的不安感；strike:'grab' 对应没有利爪只能扑抓；
    // fall:'crumple' 让团块死亡后瘫软收缩，比人形的向后倒更符合肉块形态
    onFrame(e, dt, api, u) {
      if (!u.rig) return;
      for (let i = 0; i < 6; i++) {
        const name = 'eye' + i;
        if (u.rig.bones[name]) A.anim.addRot(u.rig, name, 0, api.time * (3 + i * 0.6), 0);
      }
      // 依据："几乎全由眼球组成"——让每颗眼球各自缓慢转动，呼应"眼睛疯狂转动"这一变异特征在整个悲尸家族里的延伸
    },
  },
  build(ctx) {
    const rig = A.parts.rig('wretch_lump_v1', b => {
      b.bone('core', null, [0, 0.28, 0]);
      b.sphere('core', 'body', 0.28, [0, 0, 0], [1, 0.85, 1], [10, 8]);
      // 依据：团块状主体，压扁一点更像一坨肉团而不是规整的球
      const eyeSpots = [
        [0.18, 0.08, 0.2], [-0.2, 0.05, 0.18], [0.05, 0.22, -0.22],
        [-0.15, 0.2, -0.15], [0.22, -0.05, -0.1], [-0.1, -0.08, 0.24],
      ];
      eyeSpots.forEach((p, i) => {
        b.bone('eye' + i, 'core', p);
        b.sphere('eye' + i, 'glow', 0.045 + (i % 2) * 0.015, [0, 0, 0]);
      });
      // 依据："几乎全由眼球和口器组成"——散布六颗大小不一的眼球
      b.geo('core', 'glow', A.geo.glowFace({ width: 0.22, eyes: 0, teeth: 10, smile: true, smileWidth: 1.1 })
        .translate(0, -0.05, -0.26));
      b.geo('core', 'glow', A.geo.glowFace({ width: 0.16, eyes: 0, teeth: 8, smile: true, smileWidth: 1.0 })
        .rotateY(Math.PI / 2).translate(0.24, 0.05, 0));
      // 依据：口器不止一处，正面和侧面各加一张牙床
    }, {
      colors: { body: 0x7a4a34, glow: 0xcabba3 },   // 沿用标准型的红褐色皮肤和苍白眼球色
      look: { body: 'skin', glow: 'lambert' },      // glow 槽位同样显式设为不发光——原文没说这个变体的眼睛/口器发光
    });
    return A.wrap(rig, { label: 'wretch_lump' });
  },
});
})();

// notImplemented（返回值里会再列一遍）：
// - 三阶段悲尸循环（第一阶段可逆、第二阶段只有杏仁水/清新剂有效、第三阶段无药可救）是关于"一个人如何
//   变成悲尸"的渐进过程，不是三种可切换的实体形态，本文件按最终形态（红褐色皮肤+脓疱+第三阶段眼睛乱转）
//   实现一个可遭遇的"悲尸"，不单独做阶段一/二的"半人"形态。
// - 已实现（2026-09-14）："第三阶段产生的棕色淤泥，接触后几分钟内使人开始转变"——按用户指定改成"被悲尸划伤即感染"：
//   测试人 45 秒后原地变成悲尸（感染中被打死 4 秒后尸体爬起来），噩梦生存里的玩家 45 秒没治好死亡结算"你变成了悲尸"。
//   依据是选中版本的淤泥转变描述 + 用户指定的划伤感染；15/30/45/4 秒是游戏压缩后的可调常数（上方 CYCLE），
//   原文只说"几分钟内开始转变"，没给总时长。悲尸挠上就放过被感染的测试人（sparesInfected，依据"蜂巢社会"，
//   不然测试人挨两下就死、看不到后面的阶段），噩梦里的玩家不放过。仍未实现的部分：淤泥本身作为地面残留物（接触途径只做了划伤）、
//   玩家转化后不在原地生成悲尸（用户定：避免和"继续时清掉附近实体"冲突）、联机客机玩家（联机只有游玩模式，实体不打玩家）。
// - "少数表现出人类行为""会用简单武器"未实现：没有具体行为描述（用什么武器、怎么用），无法落实成动作。
// - "皇家口粮、墙壁面具、现实清新剂"等可以治疗/预防的道具不在本文件职责范围内（属于物品系统），未实现。
// - "常保留衣服等人类遗物"的残留衣物细节未做在模型上：human 骨架的槽位固定是 body/head/hair/claw/glow，
//   没有额外的"衣物"槽位，为避免用未文档化的槽位名引入材质风险，这个纯装饰细节没有实现。
