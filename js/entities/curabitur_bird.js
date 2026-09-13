// 受眷鸟 Curabitur Bird（Entity 37）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-37  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

const H = 0.81;   // 依据：size"已知最大雌性高 81 cm"，取这个代表尺寸做建模比例（未单独实现更小的雄性体型，见 notes）

const BODY_COLOR = 0x6b4a34;   // 依据："棕色羽毛"
const HEAD_COLOR = 0x5a3d2a;   // 依据：同上，头部取略深的棕色做区分，具体色号未记载，非设定
const GLOW_COLOR = 0x9dff4a;   // 依据：浮囊"发出明亮的青柠色(lime)光"，舌头凝胶囊同属发光胶质，同色
const CLAW_COLOR = 0x2a241d;   // 依据：钩爪未记载颜色，取不抢眼的深色角质，非设定
const EYE_COLOR = 0xe7e2d6;    // 依据："两只大眼睛(但视力差)"——不发光，取暗淡的浅色，非设定

function buildBird() {
  // 坐标约定（读 _archetypes.js 的 RigBuilder 源码确认，不是猜的）：b.bone/b.sphere/b.box/b.limb/b.cone
  // 的每一个位置参数都是模型空间的绝对坐标（原点=脚下中心，Y 向上，面朝 -Z）；bone 参数只决定"动画时跟哪根
  // 骨骼一起动"，跟绑定姿势下的位置无关——所以下面全部写成绝对坐标，不写小增量偏移。
  const bodyY = H * 0.52, bodyZ = 0;
  const sacY = bodyY + H * 0.12, sacZ = H * 0.14;
  const neckY = bodyY + H * 0.06, neckZ = -H * 0.1;
  const headY = H * 0.72, headZ = -H * 0.22;
  const beakY = headY - H * 0.03, beakZ = headZ - H * 0.13;
  const eyeY = headY + H * 0.02, eyeZ = headZ - H * 0.07, eyeX = H * 0.085;
  const tongueBaseY = headY - H * 0.08, tongueBaseZ = headZ - H * 0.17;
  const tongueTipY = headY - H * 0.11, tongueTipZ = headZ - H * 0.26;
  const armY = H * 0.42, armZ = H * 0.03;
  const legTopY = H * 0.32, legBotY = H * 0.1;

  return A.parts.rig('curabitur_bird_v1', (b) => {
    // 依据：appearance"身体比地球鸟类简化很多"——只用简单的椭圆躯干+小头+细腿+短小前肢拼出轮廓
    b.bone('body', null, [0, bodyY, bodyZ]);
    b.sphere('body', 'body', H * 0.2, [0, bodyY, bodyZ], [1.05, 0.85, 1.2]);

    // 依据："背上有一个醒目的半透明驼峰'浮囊'（floatsac），里面装着发光的半固态凝胶，发出明亮的青柠色光"
    // 背后 = +Z（模型面朝 -Z），驼峰鼓包放在躯干后上方
    b.bone('sac', 'body', [0, sacY, sacZ]);
    b.sphere('sac', 'glow', H * 0.15, [0, sacY, sacZ], [0.9, 0.7, 1]);

    // 依据："水平方向的喙，无法完全合拢"+"两只大眼睛"——小头前伸，扁平喙，大眼睛
    b.bone('neck', 'body', [0, neckY, neckZ]);
    b.bone('head', 'neck', [0, headY, headZ]);
    b.sphere('head', 'head', H * 0.1, [0, headY, headZ]);
    b.box('head', 'head', [H * 0.13, H * 0.03, H * 0.15], [0, beakY, beakZ]);
    // "无法完全合拢"的喙：没有做张合动作，只用略微错开的两片扁喙近似留缝的样子，非精确设定
    for (const s of [-1, 1]) {
      b.sphere('head', 'eye', H * 0.042, [s * eyeX, eyeY, eyeZ]);
    }

    // 依据："特化的可抓握舌头，内有一个生物发光凝胶囊(舌头会发光)"——从喙下探出一小截，末端发光
    b.bone('tongue', 'head', [0, tongueBaseY, tongueBaseZ]);
    b.limb('tongue', 'body', [0, tongueBaseY, tongueBaseZ], [0, tongueTipY, tongueTipZ], H * 0.018, H * 0.012, 4);
    b.sphere('tongue', 'glow', H * 0.022, [0, tongueTipY, tongueTipZ]);

    // 依据："短小无羽的前肢(小手臂)"——贴身的小桨状短臂，非精确设定
    for (const s of [-1, 1]) {
      const arm = 'arm' + (s < 0 ? 'L' : 'R');
      const ax = s * H * 0.22;
      b.bone(arm, 'body', [ax, armY, armZ]);
      b.limb(arm, 'body', [ax, armY, armZ], [ax * 1.6, armY - H * 0.06, armZ + H * 0.1], H * 0.03, H * 0.018, 4);
    }

    // 依据："细长的腿，每只脚一个大钩爪加两个退化小爪"
    for (const s of [-1, 1]) {
      const leg = 'leg' + (s < 0 ? 'L' : 'R'), foot = 'foot' + (s < 0 ? 'L' : 'R');
      const lx = s * H * 0.09;
      b.bone(leg, 'body', [lx, legTopY, 0]);
      b.limb(leg, 'body', [lx, legTopY, 0], [lx, legBotY, 0], H * 0.028, H * 0.016, 5);
      b.bone(foot, leg, [lx, legBotY, 0]);
      b.cone(foot, 'claw', [lx, legBotY, 0], [lx, legBotY - H * 0.05, -H * 0.14], H * 0.022, 5);        // 大钩爪
      b.cone(foot, 'claw', [lx, legBotY, 0], [lx + H * 0.05, legBotY - H * 0.03, H * 0.05], H * 0.012, 4);  // 退化小爪
      b.cone(foot, 'claw', [lx, legBotY, 0], [lx - H * 0.05, legBotY - H * 0.03, H * 0.05], H * 0.012, 4);  // 退化小爪
    }
  }, {
    colors: { body: BODY_COLOR, head: HEAD_COLOR, glow: GLOW_COLOR, claw: CLAW_COLOR, eye: EYE_COLOR },
    // 依据：body/head → 棕色羽毛，用 fur 程序化纹理近似羽毛笔触（没有专门的羽毛材质，非设定选择）；
    // glow 显式给 'glow' 自发光材质（浮囊/舌头凝胶发光）；claw 用角质纹理；eye 用普通受光材质（视力差，不发光）
    look: { body: 'fur', head: 'fur', glow: 'glow', claw: 'chitin', eye: 'lambert' },
  });
}

A.register({
  type: 'curabitur_bird', en: 'Curabitur Bird', zh: '受眷鸟', version: 'wikidot-en',
  faction: 'neutral',   // 依据：hostility = neutral；"对流浪者通常无害；只在受威胁或被挑衅时攻击人"

  hp: A.HP.weak,   // 依据：未记载 HP；"极度久坐不动"+"视力差"+"主动避开人类聚居地"→ 不是能打的生物，取偏低档非设定
  radius: 0.28, height: H,   // 依据：size"已知最大雌性高 81 cm"，radius 按体宽估算，非设定精确数字
  speed: { walk: A.SPEED.crawl, run: A.SPEED.crawl },
  // 依据："靠浮囊的浮力悬浮在空中；向后划动小手臂推进，每划一下只前进几厘米。极度久坐不动"→
  // 取现有档位里最慢的一档；原文实际速度比这个档位还慢得多，但没有更低的可用档位，非设定精确数字
  perception: { sight: A.SIGHT.poor, hearing: A.HEARING.normal, fov: 200 },
  // 依据：senses"眼睛大但视力差"→ sight 取 poor；主要感知手段是"口腔中的化学感受器"（识别死亡飞蛾信息素），
  // 引擎没有嗅觉/化学感知接口，只能用默认听觉档位占位，非设定；fov 未记载，取默认值
  attack: { hp: A.DAMAGE.light, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.slow },
  // 依据：attack"对人的攻击方式和伤害原文没写(unverified)，只在受威胁或被挑衅时攻击"→ 取低伤害、慢冷却，
  // 象征性的自卫反击，不是主动猎杀人类的手段（它的杀伤手段——黏液舌+钩爪刺穿——原文写明只用于捕食雄性死亡飞蛾）
  sounds: {},   // 依据：全篇未记载任何声音描述，不加叫声

  // 依据：behavior"独居，只为繁殖或进食而移动；主动避开人类聚居地"→ 中立游荡骨架；
  // retaliate:'fight' 对应"只在受威胁或被挑衅时攻击人"（引擎的 neutral 阵营规则本身就是"被打后反击"，
  // 这里不用额外写自定义 think）；shyRadius 近似"主动避开人类聚居地"；homeRadius 近似"极度久坐不动"
  brain: A.wanderer({ retaliate: 'fight', shyRadius: 8, homeRadius: 5 }),
  anim: {
    gait: 'none',   // 依据：没有真正的行走步态——靠浮力+划水移动，不是走/跑
    breathe: 0.02, twitch: 0.05,   // 依据："极度久坐不动"→ 只给很轻的呼吸和偶尔的小动作，非精确设定
    fly: { cruise: 0.2, low: 0.2, rest: 0.15, bob: 0.04, bobHz: 0.35, ceiling: true, clearance: 0.2 },
    // 依据："靠浮囊的浮力悬浮在空中"→ 常年离地飘浮；起伏给很小的幅度，呼应"极度久坐不动"
    strike: 'bite', recoil: 0.15, fall: 'drop',
    // 依据：反击时的具体动作原文未写，用喙/爪的意思象征一下即可，非设定
  },

  build() { return buildBird(); },
});
})();
