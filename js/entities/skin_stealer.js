// 窃皮者 Skin-Stealer（Entity-10）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-10  许可：CC BY-SA 3.0
// 只按 wikidot-en 版本实现；fandom 的「继承宿主记忆」「尖爪附肢」「深米色」等细节属于其他版本，不借用（WAVE2.md 第1节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 真身头部 head 槽位的基色（build() 的 colors.head 用它）。"深陷白眼"的白眼珠和暗色眼窝都靠 tint 从这个浅黄色
// 精确换算到目标色（tint = 目标分量 / 基色分量），不新增材质槽位；共用同一个常量，改肤色时眼睛跟着换算，不会脱节
const HEAD_HEX = 0xe6d6a3;
function tintTo(base, target) {
  const c = (hex, shift) => (hex >> shift & 255) / 255;
  return [c(target, 16) / c(base, 16), c(target, 8) / c(base, 8), c(target, 0) / c(base, 0)];
}
const EYE_WHITE = tintTo(HEAD_HEX, 0xffffff);
const EYE_SOCKET = tintTo(HEAD_HEX, 0x3a3024);   // 眼窝：暗灰褐，读作"凹进去的阴影"，不用纯黑，免得像贴了块黑片

A.register({
  type: 'skin_stealer', en: 'Skin-Stealer', zh: '窃皮者', version: 'wikidot-en',
  // hostility = varies。依据 _TEMPLATE.md 第3节判断规则：「常态下(饥饿、领地、看见人)就会主动伤人→hostile」，
  // 选中版本原文「饥饿时会寻找落单的人」正属于「饥饿」这一列举情形 → 取 hostile；
  // 「通常温顺，不需进食时漫无目的地游荡，此阶段除非被激怒否则不敌对」这段温顺期不靠改 faction 表达，
  // 而是用下面拟态骨架的伪装/现形状态来体现（不为此改 faction，第3节末尾原则的同理应用）
  faction: A.faction('varies', 'hostile'),

  hp: A.HP.average,          // 选中版本未提自身耐久，非设定默认值
  radius: 0.4, height: 2.0,  // 依据：「高大(tall)」，size 无具体数字(unverified)，取比人略高的默认值，非设定精确数字
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },   // locomotion/speed 均 unverified（页面无数据），取默认值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150 },
  // senses:unverified（页面未描述感官）→ 人形默认档，非设定
  attack: { hp: A.DAMAGE.lethal, sanity: 0, range: 1.0, cooldown: A.COOLDOWN.slow },
  // 依据：「饥饿状态下…用力量徒手将其撕碎」→「撕碎」对应数值表「一击致命/撕碎→lethal」；
  // 徒手抓撕后收势较慢 → cooldown 取 slow；sanityEffect: unverified，不写理智伤害
  sounds: { attack: 'hit' },
  // 依据：徒手撕碎用通用命中音；拟态实体不写 sounds.alert（第5.5节：锁定目标那一刻播放会当场穿帮伪装）

  brain: A.mimic({
    revealRange: 3, revealOnHit: true, disguise: 'wander', redisguiseSec: 15,
    talk: { sound: 'whisper', range: 10, cooldown: 7 },
  }),
  // 依据：「伪装方式：将撕下的人皮吸附贴合…看起来和真人一模一样」→ 拟态骨架；
  // 「通常温顺，不需进食时漫无目的游荡，此阶段除非被激怒否则不敌对」→ disguise:'wander'（只有目标自己走近才现形，不会主动接近），revealOnHit:true（被激怒后反击）；
  // 「饥饿时会寻找落单的人」用 revealRange 近似"遇到落单的人就现形猎杀"——选中版本没给具体的温顺期/饥饿期时长数字，无法做真实的周期性计时状态机；
  // 现形后按追猎者状态追杀，丢失目标 redisguiseSec 秒后恢复伪装，相当于自然循环回"温顺游荡"，非精确还原饥饿周期；
  // 「智力有限，不理解语言，只会重复听到的话（常为多种语言）来引诱猎物」→ 用 whisper 预设声音近似"低语学舌"，
  // 引擎没有真正的语音复读/多语言台词系统，只能用固定音效代替，写进 apiRequests
  anim: { gait: 'biped', strike: 'grab' },
  // 依据：「用力量徒手将其撕碎」→ strike 用 grab(抓取撕扯)而非 swipe/bite

  build(ctx) {
    return A.wrap({
      disguise: A.parts.hazmat(ctx),
      // 依据：「看起来和真人一模一样」→ 直接用测试人/玩家外形构件（第6.5节：拟态成人的标准做法）
      true: A.parts.humanoid({
        height: 2.0, bulk: 1.2, thin: 0.15, head: 'round', claws: 0, hair: 0,
        // 依据：「用力量徒手撕碎」→ 略偏壮(bulk)；未提爪子/毛发 → claws:0, hair:0；
        // 只说眼窝深陷、发白，不是无脸，头部仍用普通 head:'round'
        colors: { body: 0xdcc478, head: HEAD_HEX, glow: 0xffffff },
        // 依据：「高大、淡黄色(pale yellow)的人形」→ body 取淡黄色；头部略调浅表现「眼睛深陷、白色」的苍白感
        look: { body: 'skin', head: 'skin' },
        // 依据：「外层皮肉布满微小凸起，类似章鱼触手上的吸盘」→ 用 skin 材质的斑驳纹理近似凹凸质感，非精确建模
        key: 'skin_stealer_true_v2',   // extend 的形状 / tint 变了就换键：几何缓存按键取，不换会拿到旧眼睛
        extend(b, d) {
          // 深陷的非发光白眼——依据（wikidot-en/cn）：「眼睛深陷、白色」／「深深凹陷的白色眼睛」；原文没提发光，
          // 复用 head 槽位（skin 材质受场景光照，天然"非发光"，不新增材质槽位 / draw call）。
          // 这套构件是形状互相叠加，挖不了洞，"深陷"用颜色表现：脸上先贴一片压扁的暗色眼窝（EYE_SOCKET），中间再嵌一颗
          // 压扁的白眼珠（EYE_WHITE），两片都顺着脸部曲面的法线摆、只探出表面一点点，看起来是阴影里的一颗白眼，而不是凸出来的眼珠。
          // 第一版（半径 0.1·hr 的小白球大半埋进头里）全身出图只差 63 个像素，6 m 外看不见，所以放大并加了眼窝
          const T = window.THREE, hr = d.headR;
          // humanoid 圆头：半径 hr、缩放 [0.92, 1.08, 0.98]、中心 headY，脸朝 -z。眼睛在头部局部 (±0.32, +0.05)·hr，
          // 在理想椭球上算出这里的表面点和法线，眼窝 / 眼珠的压扁轴对准法线，贴合脸侧往后弯的曲面
          const EX = 0.32, EY = 0.05, AX = 0.92, AY = 1.08, AZ = 0.98;
          const ez = AZ * Math.sqrt(1 - (EX / AX) ** 2 - (EY / AY) ** 2);
          for (const s of [-1, 1]) {
            const p = new T.Vector3(s * EX * hr, d.headY + EY * hr, -ez * hr);
            const n = new T.Vector3(s * EX / (AX * AX), EY / (AY * AY), -ez / (AZ * AZ)).normalize();
            const yaw = Math.atan2(-n.x, -n.z);   // 绕 y 转 yaw 后，局部 -z 轴对准法线的水平分量
            // r：沿脸面的半径；sy：竖向压扁；depth：沿法线的半厚；proud：最前端探出理想表面多少（都按 hr 计）
            const disc = (r, sy, depth, proud) => new T.SphereGeometry(r * hr, 8, 5).scale(1, sy, depth / r).rotateY(yaw)
              .translate(p.x + n.x * (proud - depth) * hr, p.y + n.y * (proud - depth) * hr, p.z + n.z * (proud - depth) * hr);
            b.geo('head', 'head', disc(0.24, 0.8, 0.07, 0.01), { tint: EYE_SOCKET });
            b.geo('head', 'head', disc(0.14, 0.8, 0.06, 0.025), { tint: EYE_WHITE });
          }
        },
      }),
    }, { form: 'disguise', label: 'skin_stealer' });
  },
});
})();
