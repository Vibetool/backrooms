// 笑魇 Smiler（Entity III: Smilers）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_3  许可：CC BY-SA 3.0
// 只按 fandom 版本实现；wikidot-en/cn 的「驱笑剂退散」「身体肉眼不可见」「Smiling Room 基地」等细节属于其他版本，不借用（WAVE2.md 第1节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'smiler', en: 'Smiler', zh: '笑魇', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile；「对一切生命怀有敌意（anethikas 除外）」

  hp: A.HP.sturdy,       // 依据：「被称为迄今记录中最危险的非个体实体之一」「作为顶级掠食者，没有天敌」→ 取偏高档；无具体耐久数字，非设定精确值
  radius: 0.45, height: 2.0,
  // 依据：size:unverified（有「约3米高」的说法但出处未能确认，未采信），无定形取比人略高的默认体型，非设定
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },
  // 依据：speed 字段本身 unverified（「远超人类」与「普通人应能跑赢」两条互相矛盾，未计入），取 run 档保证追击有威胁，非设定精确值
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 160, avoidsLight: true },
  // 依据：「发光的眼与齿(Ardenti risu)本身是视听器官」→ 正常视听档；「可见光照到身体时会像疼痛般退缩」→ avoidsLight 标记为真，具体惧光行为见下方 lightBound
  attack: { hp: A.DAMAGE.heavy, sanity: 8, range: 1.1, cooldown: A.COOLDOWN.normal },
  // 依据：具体攻击招式 unverified，只有「被称为迄今记录中最危险的非个体实体之一」的定性描述 → 取 heavy（不是明确的"一击致命/撕碎"，不给 lethal）；
  // sanity 依据「夜间猎手…用扭曲多变的声音嘲弄折磨受害者」的精神压迫描述，选中版本未给数字，取小值
  sounds: { alert: 'giggle', attack: 'screech' },
  // 依据：「嘲弄折磨受害者」→ giggle(嘲笑，别名 laugh) 作为发现目标时的叫声；attack 用 screech(别名 scream/shriek)

  brain: A.lightBound(A.pack({ patrol: 'wander', patrolRadius: 16, howl: 'giggle' }), {
    mode: 'avoid', threshold: A.LIGHT.lit, onLight: 'flee', ignoreLitTargets: true,
  }),
  // 依据：「在夜晚绝对黑暗中成群狩猎，主动追踪人类」→ 用群猎骨架(A.pack)而非单体追猎者；群体规模/嚎叫方式选中版本未给数字，joinRadius/maxPack 用骨架默认值；
  // 「可见光…会像疼痛般退缩，通常可用手电筒击退或躲进亮着灯的房间」→ 外层包惧光修饰：亮处逃离(flee)、站在亮房间里的目标不追(ignoreLitTargets)；
  // 阈值取 A.LIGHT.lit(0.6) 而非 avoid 默认的 0.35：原文强调的是"手电筒/亮着灯的房间"这种明亮光源，
  // 普通过道的环境光(dim 档)只是"随光量增加而疼痛"的轻度描述，不应该让它在任何有环境光的地方都无法行动
  // 「部分个体耐痛性更高，在光下也可能继续追」这种个体差异过于细分，本次不实现（notImplemented）
  anim: { gait: 'biped', stride: 1.5, twitch: 0.2, breathe: 0, strike: 'lunge', stateSounds: { chase: 'giggle' } },
  // 依据：「无定形，形态最像火焰」→ 关闭呼吸起伏(breathe:0)，用抽搐(twitch)表现火焰般不稳定的轮廓；
  // 「在黑暗中主动追踪人类」的突袭感 → strike 用扑咬式的 lunge

  build(ctx) {
    return A.wrap(A.parts.silhouette({
      height: 2.0, thin: 0.5, head: 'faceless',
      // 依据：「Nigrum ignem 占身体大部分…纯黑色，形态最像火焰」的无定形躯体 → silhouette 半透明黑剪影；
      // 记录过的形态里"类人形"是选中版本明确列出的一种 → 取它做主模型；类犬形/巨型蜘蛛/鸟形写进 notImplemented（第6.8节规则）
      face: { eyes: 2, smile: true, teeth: 14, rows: 2, eyeShape: 'round' },
      // 依据：「Ardenti risu 是发光物质，通常构成标志性的发光眼睛和牙齿，兼作威吓手段和感觉器官」
      colors: { glow: 0xffffff },
      // 发光颜色选中版本未写明(unverified)，取默认白色，非设定
    }), { label: 'smiler' });
  },
});
})();
