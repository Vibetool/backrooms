// 牧蛇 Wranglers（Entity 75）——雌雄二态，外形与敌意都不同，按 _TEMPLATE.md 第 1 节拆成两个 type
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-75  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 幼体的透明皮肤/物理钻地移动只有外观和移动方式的差异，没有单独的敌意/攻击方式，没有注册第三个 type（见文件末 notImplemented 说明）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---- 数值：两个形态共用（版本原文没有按性别区分体型/攻击力，只区分了脸部形态和敌意） ----
// 体长原文写 10–90 英里，死亡个体占约 2 立方英里空间——真实尺度远超引擎/关卡能承载的范围，
// 无法按字面实现；这里退而求其次做成"游戏可用的巨蛇可见片段"，radius/height 是技术妥协，非设定精确值，
// 已写进 notImplemented。
const RADIUS = 0.9, HEIGHT = 1.6;
const BODY_LEN = 6.0;             // 可见身体长度（米），非设定：真实体长无法渲染，只做出"巨蛇"的观感
const ATTACK = { hp: A.DAMAGE.severe, range: 2.0, cooldown: A.COOLDOWN.heavy };
// 依据：
// - "以流浪者为食，页面称其危险、高度致命"→ 高致死，取 severe（原文没有"一击必杀"的说法，不用 lethal）
// - range=2.0：巨蛇体型远超人类，咬合范围按体型放大，非精确数字
// - cooldown=heavy：巨物的进食/吞噬动作不会连续快速出手，取最长档，非精确数字
const AURA = { radius: 14, sanityPerSec: A.AURA.mild };
// 依据："用身体分散猎物注意力、让它们困惑，进入近乎催眠的状态（页面没有解释机制）"——这是移动/靠近时的持续效果，
// 不是单次命中的效果，所以做成 aura 而不是 attack.sanity；机制未说明、没给强度，取较低档 mild，非设定精确值
const SOUNDS = { alert: 'growl' };
// 依据："物理钻地时非常响，能听见它们靠近；伴随隆隆的振动"——没有专门的"钻地轰鸣"音效可用（见 apiRequests），
// 用现有的 growl（吼叫）近似一个警示性的低沉声响；没有攻击音效描述，不额外加 sounds.attack

function wranglerBody(b, male) {
  // 依据："蛇形生物"——用一条长长的锥形链条模拟蛇身，从躯干（靠近实体原点）延伸到头部（朝 -Z，游戏面朝方向）
  const bones = b.chain('tail', null, [0, HEIGHT * 0.5, 0.05], [0, 0, -1], 7, BODY_LEN,
    male ? 0.85 : 0.75, 0.2, 'body', 8);
  const head = bones[bones.length - 1];
  // 依据："眼睛发出明亮的白光"——两个种性共有，独立做成 glow 槽位的球体
  b.bone('eyeL', head, [-0.22, 0.12, -0.2]); b.sphere('eyeL', 'glow', 0.06, [0, 0, 0]);
  b.bone('eyeR', head, [0.22, 0.12, -0.2]); b.sphere('eyeR', 'glow', 0.06, [0, 0, 0]);
  if (male) {
    // 依据："雄性脸更像人，带着大大的笑容"——用发光笑脸几何贴到头部前方，只要笑容不要眼睛（眼睛已经单独做了）
    b.geo(head, 'glow', A.geo.glowFace({ width: 0.85, eyes: 0, smile: true, smileWidth: 1.3, teeth: 16, curve: 0.6, toothH: 0.05 })
      .translate(0, -0.05, -0.55));
  } else {
    // 依据："雌性更像蠕虫，嘴的位置是一对钳子"——用两段圆台在嘴部位置摆出一对钳子
    b.cone(head, 'body', [-0.12, 0, -0.35], [-0.4, 0, -0.6], 0.05, 4);
    b.cone(head, 'body', [0.12, 0, -0.35], [0.4, 0, -0.6], 0.05, 4);
  }
}

function buildWrangler(male) {
  return A.wrap(A.parts.rig('wrangler_' + (male ? 'male' : 'female') + '_v1', b => wranglerBody(b, male), {
    // 依据："皮肤湿润、黏滑""随年龄增长变得更灰、更不透明"——没有精确颜色，取灰绿/灰褐的湿滑色调，非设定精确值；
    // 雄性"皮肤较粗糙"取带纹理的 chitin 质感，雌性保留更光滑的 skin 质感
    colors: { body: male ? 0x6f6a5d : 0x8f9a86, glow: 0xffffff },
    look: { body: male ? 'chitin' : 'skin' },
  }), { label: 'wrangler_' + (male ? 'male' : 'female') });
}

A.register({
  type: 'wrangler_male', en: 'Wrangler (male)', zh: '牧蛇·雄性', version: 'wikidot-en',
  faction: 'hostile',   // 依据：hostilityNote"雄性敌对"——varies 里按性别拆开的一支，判定依据是原文这句话
  hp: A.HP.titan,       // 依据：体型达数十英里、死亡个体占约 2 立方英里空间→体型判定为顶级巨物；
                         // 但原文提到过"死亡个体"说明确实可以被杀死，所以不用 immortal，取最高的可杀档 titan
  radius: RADIUS, height: HEIGHT,
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },
  // 依据：版本没给速度数字或定性词；"雄性攻击并吃掉视野里的一切"暗示会主动追猎，给通用的中档追击速度，非设定精确值
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: false },
  // 依据："发光的眼睛让它们能在黑暗中视物"→ needsLight:false（不需要额外光照就能看清目标）；
  // 感官细节没有更多描述，sight/hearing 用默认值；巨蛇没有明确的"正面"，fov 给 360，非设定精确值
  attack: ATTACK,
  aura: AURA,
  sounds: SOUNDS,
  brain: A.stalker({ patrol: 'wander', patrolRadius: 22, searchSec: 8, alertCry: 'growl' }),
  // 依据："雄性攻击并吃掉视野里的一切"——主动追猎的追猎者骨架；栖息范围给得比一般实体大，呼应巨物体型，非设定具体数字
  anim: { gait: 'none', sway: 0.4, swaySpeed: 1.8, breathe: 0, strike: 'bite', fall: 'side' },
  // 依据：链条骨骼自动 sway（模拟蛇身游动摆动，摆幅取偏大值以贴合"巨蛇"体量感，非设定精确数字）；
  // fall:'side' 让长条状蛇身倒下时侧倒，比人形的向后倒更符合蛇的形态
  build(ctx) { return buildWrangler(true); },
});

A.register({
  type: 'wrangler_female', en: 'Wrangler (female)', zh: '牧蛇·雌性', version: 'wikidot-en',
  faction: 'neutral',   // 依据：hostilityNote"雌性通常中立退避"——varies 里按性别拆开的另一支
  hp: A.HP.titan,        // 同雄性，见上方注释
  radius: RADIUS, height: HEIGHT,
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：同样没给速度数字；雌性"遇到流浪者会退避"，不需要雄性那样凶猛的追击速度，run 给低一档，非设定精确值
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: false },
  aura: AURA,
  // 注意：不写 attack —— 依据："雌性遇到流浪者会退避……只有怀孕时才捕食流浪者"，常态下不攻击流浪者；
  // "怀孕"是没法从静态注册的 type 里表达的临时状态，架构规定阵营效果只能由 entities.js 统一实现，
  // 不能在实体文件里让 neutral 实体绕过中央索敌规则主动出手，所以按 _TEMPLATE.md 第 5.8 节"不会还手/不攻击"
  // 的写法处理：不给 attack，等同于向导骨架里 engage:false 的做法（这里用的是 wanderer，本身就不主动出手）
  sounds: SOUNDS,
  brain: A.wanderer({ speed: 'walk', retaliate: 'flee', shyRadius: 10 }),
  // 依据："雌性遇到流浪者会退避"——shyRadius>0 使她在流浪者靠近时主动走开；retaliate:'flee' 表示即使被攻击
  // 也只会躲开而不反击，呼应她整体回避冲突的习性（原文没写"被攻击后反而凶猛"这类描述）
  anim: { gait: 'none', sway: 0.35, swaySpeed: 1.6, breathe: 0, fall: 'side' },
  build(ctx) { return buildWrangler(false); },
});
})();

// notImplemented（写在文件末尾，返回值里会再列一遍）：
// - 幼体形态（"幼体皮肤半透明，能看见体内""物理钻地"）没有注册成第三个 type：版本没有给幼体单独的
//   攻击方式/敌意，只有外观（透明度）和移动方式（钻地 vs 切行）的差异，且没给幼体的体长数字，信息量不足以
//   支撑一个有独立行为的 type，径直做成两个成体形态。
// - 雌性"怀孕时捕食流浪者"的临时状态未实现：faction 是静态注册的，架构规定索敌规则只能由 entities.js
//   统一实现，实体文件不能让 neutral 实体绕过中央规则主动猎杀玩家/测试人。
// - "母体能察觉到有人在接触她的幼体"（护巢反应）、"用身体分散猎物注意力，让它们困惑，进入近乎催眠的状态
//   （机制未解释）"里"催眠"的具体机制、以及跨层级切行移动，都没有可实现的具体机制描述，未实现。
// - 弱点"Pyroil 燃起的火能烧伤它们"：项目里没有 Pyroil 火焰道具/机制，未实现，见 apiRequests。
