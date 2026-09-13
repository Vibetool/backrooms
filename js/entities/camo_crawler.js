// 迷彩爬行者 Camo Crawler（Entity 31）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-31  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 说明：选中版本的实体页写的是"伏击方式：保持完全静止，外表纹理与环境一致"，同版本的 Level 8 补充叙事
// 又写它"一边嗅探一边发出咔嗒声四处搜寻"——两段都属于选中版本自己的材料，不冲突：前者是它的核心捕食
// 手段（本文件用来选主行为骨架），后者是狩猎时的伴随细节（用来配声音），见下方各处注释。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 灰褐色（依据：appearance"常态灰褐色(grayish-brown)"）
const BODY_COLOR = 0x7d6a56;
// 巨大白色盲眼的颜色（依据："巨大的白色盲眼(不起作用)"）——用普通材质而不是发光材质，
// 强调"不起作用/不发光"，不是笑魇那种发光恐怖眼睛，见下方 mats 覆盖
const EYE_COLOR = 0xece7dc;
const CLAW_COLOR = 0x2c2620;   // 钳状口器/爪的深色角质，选中版本未写具体颜色，取不抢眼的深色，非设定

function buildCrawler() {
  return A.wrap(A.parts.humanoid({
    height: 1.78, thin: 0.15, bulk: 1.05, hunch: 0.12,
    // 依据：size 原文未写(unverified)，按人形常见比例取默认体型，非设定精确数字；hunch 给一点点佝偻，
    // 呼应"社会性强、成群狩猎"的野兽感而非笔直站立的人类姿态
    head: 'round', armLen: 1, legLen: 1,
    claws: 0, hair: 0,   // 依据：appearance 只写手臂数量和嘴部钳状口器，没写手上有爪或体毛，不加
    // 依据："巨大的白色盲眼(不起作用)"——用 glowFace 的 eyes 部分做两只眼睛，关掉 smile/teeth
    // （嘴部的钳状口器另外用 extend 做，不用 glowFace 自带的牙齿嘴形）；eyeSize/eyeGap 用构件缺省值
    // （缺省按头宽比例给，实测比手动给绝对米数更贴合头部表面，不会飘到头顶上方）
    face: { eyes: 2, eyeShape: 'round', smile: false, teeth: 0 },
    colors: { body: BODY_COLOR, glow: EYE_COLOR, claw: CLAW_COLOR },
    // 依据："皮肤干燥、结痂般粗糙" → 用 skin 程序化纹理（斑驳质感）近似，没有专门的"干裂"材质，非设定
    look: { body: 'skin' },
    // 眼睛不发光："不起作用"的盲眼用普通受光材质，而不是 glowFace 默认的自发光材质，
    // 这样黑暗里不会像笑魇那样显眼发光，更贴近"眼睛失效"的描述
    mats: { glow: A.mat.lambert(EYE_COLOR) },
    key: 'camo_crawler_v1',
    extend(b, d) {
      // 依据："四条手臂"——构件本身只有一对手臂骨骼(armL/armR)，用 chain 在下方（躯干下半）
      // 加第二对手臂，自动带 sway 摆动；角度/长度未记载，取贴着身侧下垂的造型，非设定精确数字
      const lowY = d.hipY + (d.shoulderY - d.hipY) * 0.45;
      for (const s of [-1, 1]) {
        b.chain('arm2' + (s < 0 ? 'L' : 'R'), 'spine', [s * d.shoulderW * 0.5, lowY, 0.03],
          [s * 0.45, -0.75, 0.2], 3, d.H * 0.34, d.headR * 0.5, d.headR * 0.18, 'body', 6);
      }
      // 依据："嘴周围有像昆虫一样的钳状口器(pincers)"——头部前方加两个小尖钳，slot 用 claw
      // （复用手爪材质的深色角质槽位，不新增材质槽位/draw call）
      const mouthY = d.headY - d.headR * 0.25, mouthZ = -d.headR * 0.9;
      for (const s of [-1, 1]) {
        b.cone('head', 'claw', [s * d.headR * 0.3, mouthY, mouthZ],
          [s * d.headR * 0.72, mouthY - d.headR * 0.18, mouthZ - d.headR * 0.5], d.headR * 0.12, 5);
      }
    },
  }), { label: 'camo_crawler' });
}

A.register({
  type: 'camo_crawler', en: 'Camo Crawler', zh: '迷彩爬行者', version: 'wikidot-en',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.sturdy,   // 依据："非常强壮"，选中版本没给具体耐久数字，取偏高档非设定精确值
  radius: 0.42, height: 1.78,   // 依据：size 未记载(unverified)，人形常见比例的游戏性默认值
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：locomotion/speed 均未记载数字；它靠伏击而不是追速取胜（见下方 brain），给中等档非设定精确数字
  perception: { sight: A.SIGHT.blind, hearing: A.HEARING.acute, fov: 360, needsLight: false, avoidsLight: false },
  // 依据：senses"眼睛失明，只能感知声音，靠听觉狩猎"→ sight 取 blind(0)，hearing 取最高档；
  // fov 给 360——失明生物没有"正面视野"这个概念，靠全方位听觉感知，非设定精确数字
  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 1.0, cooldown: A.COOLDOWN.normal },
  // 依据：attack 段"没有写具体攻击方式和致死性(unverified)，只有钳状口器、力大、成群狩猎三点可作参考"→
  // 取偏高伤害档（力大+钳状口器）但不给 lethal（没有"一击致命"的明确描述）；range 按贴身钳咬距离给；
  // 攻击频率未记载，用默认冷却档
  sounds: { idle: 'click' },
  // 依据：Level 8 叙事"一边嗅探一边发出咔嗒声四处搜寻"——用 idle 咔嗒声表现它在附近搜索猎物；
  // 没写发现目标/攻击时的专门叫声，不加 alert/attack

  // 依据：behavior"伏击方式：保持完全静止，外表纹理与周围环境一致"→ 用伏击/静态陷阱骨架；
  // 因为失明（perception.sight=blind），骨架默认的索敌半径会退化成 0（缺省取 perception.sight），
  // 这里显式把 brain 的 sight 选项设成听觉档位，代表"靠声音感知猎物"的索敌范围（骨架的 sight 选项本来就是
  // 通用的"索敌半径"，不专指视觉，符合 _TEMPLATE.md 第 5 节说明）；triggerRange 是真正扑上去的距离，
  // 比索敌范围小，代表"保持静止直到猎物靠得足够近才突袭"
  brain: A.ambush({
    sight: A.HEARING.acute, triggerRange: 3.5, revealRange: 0,
    strikeSec: 4, returnHome: true, fixed: false,
  }),
  anim: {
    gait: 'biped', strike: 'bite', recoil: 0.22, fall: 'crumple',
    // 依据：Level 8 叙事"嗅探、咔嗒搜寻无果后愤怒尖叫……同时嚎叫"——骨架没有单独区分"扑空/扑中"，
    // 用 return（扑击结束回原位）状态统一播一声嚎叫(growl，别名 roar) 近似这段"无果后愤怒"的情绪，
    // 会比原文略频繁（扑中也会叫一次），是骨架限制下的简化，写进返回值 notImplemented
    stateSounds: { return: 'growl' },
  },

  build() { return buildCrawler(); },
});
})();
