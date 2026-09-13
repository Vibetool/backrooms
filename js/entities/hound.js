// 猎犬 Hound（Entity 8: Hounds // Egremond Syndrome）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_8  许可：CC BY-SA 3.0
// 只按 fandom 版本实现；wikidot-en/cn 的「蜂巢卵孵化起源」「巨口遮毛」「直视死盯可吓退」等细节属于其他版本，不借用（WAVE2.md 第1节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'hound', en: 'Hound', zh: '猎犬', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile；「对大多数生命极具攻击性」

  hp: A.HP.average,            // 依据：「爪子磨钝、耐力差」「攻击性不稳定导致体力消耗很快」→ 不算耐打
  radius: 0.4, height: 0.9,    // 依据：犬形四足，肩高按常见大型犬估算；size:unverified（条目未给尺寸），游戏性默认值，非设定
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：「变形导致跛行，许多个体有永久行动障碍甚至完全不能跑」→ 冲刺上限只给到 jog，不给 run/sprint
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.acute, fov: 260 },
  // 依据：「听觉极敏锐，比犬类更强，可轻松听到约两英里外的声音」→ hearing 取最高档 acute；
  // 视力选中版本未写，按 normal 默认；fov 按四足动物双眼分布更靠两侧、视野天生更广给宽一些，非设定精确值
  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal },
  // 依据：「靠强力颌部和利齿迅速制服猎物…攻击时通常直接撕下大块肉，而不是先把目标制服」→ 单次重伤(heavy)；
  // 「爪子在战斗中基本无效」→ 不额外做爪击手段；sanityEffect 描述的是感染症状（不是理智值），选中版本没写 san 数值 → sanity 填 0，不写 aura
  sounds: { alert: 'growl', attack: 'hit' },
  // 依据：条目未给拟声词，growl(低吼/咆哮) 是猎犬类最贴近的预设音；attack 用通用撕咬命中音 hit

  brain: A.stalker({ patrol: 'wander', patrolRadius: 14, searchSec: 6, smell: false }),
  // 依据：「能记住环境、在脑中绘制地图、能认脸」→ 有游荡巡逻而非固定原地；
  // 「成群狩猎」只见于未计入的论坛帖，density 里明确写 unverified → 不用群猎骨架(A.pack)，用单体追猎者；嗅觉选中版本未提，smell:false
  anim: { gait: 'quad', stride: 1.1, strike: 'bite', stateSounds: { chase: 'growl' } },
  // 依据：四足移动(locomotion)；attack 描述为颌部撕咬 → strike:'bite'

  build(ctx) {
    return A.wrap(A.parts.quadruped({
      length: 1.0, height: 0.5, thin: 0.8,   // 依据：「四肢细瘦嶙峋」→ thin 取高值
      jaw: true, snout: 0.14,                // 依据：「巨大张开的口腔内有多排牙齿」→ 保留口鼻/下颌骨骼供张口撕咬动画，长度非精确设定
      eyes: { size: 0.035 },                 // 依据：「眼睛闪着醒目的白光，在黑暗中远远就能认出」→ 走 glow 槽位
      mane: 0.14,                            // 依据：「背上有一长条黑色蓬乱的毛，远处易辨认、易与人区分」
      colors: { body: 0x6b5d50, fur: 0x0d0b09, glow: 0xffffff },
      // body：犬科皮革色，选中版本未写体色，非设定；fur：黑色鬃毛；glow：白色发光眼
      look: { body: 'skin', fur: 'fur' },
    }), { label: 'hound' });
  },
});
})();
