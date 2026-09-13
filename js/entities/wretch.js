// 悲尸 Wretches（Entity 15）——标准型 + 畸形肉块变体（外形差异很大，按 _TEMPLATE.md 第 1 节拆成两个 type）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-15  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
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
  brain: A.pack({ patrolRadius: 16, howl: 'growl' }),
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
  brain: A.stalker({ patrol: 'wander', patrolRadius: 10 }),
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
// - "第三阶段产生的棕色淤泥，接触后几分钟内使人开始转变"（把玩家/测试人感染成悲尸）未实现：这需要把
//   目标转化成新的敌对实体，超出实体文件能表达的范围，见 apiRequests。
// - "少数表现出人类行为""会用简单武器"未实现：没有具体行为描述（用什么武器、怎么用），无法落实成动作。
// - "皇家口粮、墙壁面具、现实清新剂"等可以治疗/预防的道具不在本文件职责范围内（属于物品系统），未实现。
// - "常保留衣服等人类遗物"的残留衣物细节未做在模型上：human 骨架的槽位固定是 body/head/hair/claw/glow，
//   没有额外的"衣物"槽位，为避免用未文档化的槽位名引入材质风险，这个纯装饰细节没有实现。
