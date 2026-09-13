// 尸鼠 Death Rat（Entity 24）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-24  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// Level 2 无毛种群、Level 3 水豚状高智尸鼠等其他层级专属亚种未实现，见文件末 notImplemented
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'death_rat', en: 'Death Rat', zh: '尸鼠', version: 'wikidot-cn',
  // 依据：hostility = varies。原文"大多数无害，甚至可以在某种程度上当食物"+ 弱点"不要试图激怒它们，
  // 下一步行动无法预料"——对应模板 varies 判定表里"只在被激怒/被攻击时才动手 → neutral"这一档；
  // 没有"见人/饥饿就主动攻击"或"帮助流浪者"的描述，排除 hostile/friendly。
  // "有些种类非常危险、会设陷阱"没有给出具体外形差异或触发机制，信息量不足以拆成单独 type，见 notImplemented。
  faction: 'neutral',

  hp: A.HP.fragile,          // 依据："最常见的品种像普通家鼠"——体型和普通老鼠一样单薄，不耐打
  radius: 0.12, height: 0.14, // 依据：实体页无数值（size unverified），按现实家鼠体型给游戏性数值，非设定精确值
  speed: { walk: A.SPEED.brisk, run: A.SPEED.jog },
  // 依据：实体页未写速度（unverified）；啮齿类窜动给比普通游荡略快的默认档，非设定精确值
  perception: { sight: A.SIGHT.dim, hearing: A.HEARING.normal, fov: 160 },
  // 依据：实体页未写感官（unverified）；体型小、视力给弱一档，其余取中性默认值，非设定
  // 不写 attack —— 依据：大多数无害，采用下面 wanderer 的 retaliate:'flee'，一挨打就跑、不还手，
  // 不会真正出手攻击任何目标，因此不需要给出攻击数值
  sounds: { idle: 'click' },
  // 依据：实体页没有描述具体叫声；用现有的"click"表现啃咬/穿行时的细碎声响，非设定精确音色

  // 行为：中立游荡，被攻击就跑不还手（依据：见上方 faction 注释）。原文提到的"尖叫事件"（追杀死亡飞蛾等其他实体时
  // 尖叫、灯光闪烁）和"设陷阱"未实现：前者需要让本实体主动猎杀别的实体类型并触发关卡灯光闪烁，
  // 灯光预算归层级、行为代码只能调 findTarget 不能自行判断猎杀关系，超出实体文件权限，见 apiRequests；
  // 后者原文没有给出陷阱的具体机制，不能凭空编造。
  brain: A.wanderer({ speed: 'walk', retaliate: 'flee', fleeSec: 4 }),
  anim: { gait: 'quad', stride: 0.3, twitch: 0.12, recoil: 0.15, fall: 'crumple' },
  // twitch：非设定，纯粹让小动物看起来更"躁动"，不对应描述里的任何一句话

  build(ctx) {
    const headSize = 0.07;   // 与下面 quadruped 的 headSize 保持一致，extend 里算角的位置要用到
    return A.wrap(A.parts.quadruped({
      length: 0.16, height: 0.05, girth: 0.045, thin: 0.1, legThick: 0.8,
      // 依据："身体长、黑色皮毛"——整体比例参照普通家鼠，body 取黑色
      neckLen: 0.05, headSize, snout: 0.045, jaw: true,
      ears: 0.025, tail: 0.14,
      // 依据："像普通家鼠"——普通家鼠的尖口鼻、小耳朵、细长尾巴，是这句比较本身直接带出的外观，非额外编造
      eyes: { size: 0.006, glow: false },   // 依据：原文没提眼睛发光，给普通不发光的小黑眼
      colors: { body: 0x111111, fur: 0x6b4a2f, eye: 0x050505, glow: 0xff3320 },
      // fur 槽位本来给"背部鬃毛"用，这里没有鬃毛（mane:0），改用来承载棕色的角；
      // 依据颜色："黑色皮毛"→ body 近黑；"棕色的角"→ fur 取棕色；"角尖发红光"→ glow 取红色
      look: { body: 'fur', fur: 'lambert' },
      key: 'death_rat_v1',
      extend(b, d) {
        // 依据："头上长着奇怪的棕色角，角尖发红光"——角座（棕色、fur 槽位）+ 角尖发光球（红色、glow 槽位）
        const hs = headSize, hc = d.headC;
        for (const s of [-1, 1]) {
          const base = [hc[0] + s * hs * 0.32, hc[1] + hs * 0.42, hc[2] + hs * 0.15];
          const tip = [hc[0] + s * hs * 0.42, hc[1] + hs * 1.05, hc[2] - hs * 0.05];
          b.cone('head', 'fur', base, tip, hs * 0.07, 4);
          b.sphere('head', 'glow', hs * 0.05, tip, null, [5, 4]);
        }
      },
    }), { label: 'death_rat' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "尖叫事件"（追猎其他实体时尖叫、灯光随之闪烁）：需要本实体主动猎杀别的实体类型并触发关卡灯光闪烁，
//   两者都超出实体文件权限（阵营/索敌规则统一由 entities.js 处理，灯光预算归层级），未实现，见 apiRequests。
// - "有些种类非常危险、会设陷阱，比想象中聪明"：原文没有给出这批"危险种类"的外形差异或具体陷阱机制，
//   信息不足，无法拆成单独 type 或写出具体行为，未实现。
// - Level 2 的无毛种群（"褪去了毛发以应对高温"）：只是该层级的局部外观变体，且该层不在本批次范围内，未注册第三个 type。
// - "有人类水平智力、会读写英语"（wikidot-en Level 3 页面的水豚状尸鼠）：属于其他候选版本，选中的 wikidot-cn
//   版本没有这个设定，不借用。
