// 钝人 Duller（Entity 6）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-6  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'duller', en: 'Duller', zh: '钝人', version: 'wikidot-en',
  faction: 'hostile',   // 依据：hostility = hostile

  // 依据："身体比外表看起来强壮得多"（即使扛着两倍自重的物品也能全速奔跑）→ 耐久按"强壮"给，
  // "骨架脆弱"是 appearance 一段对外观（体型观感）的描述，放进外形而非 HP
  hp: A.HP.sturdy,
  radius: 0.4, height: 2.3,   // 依据：appearance/size 只写"高大(tall)"，无具体数字，取比玩家更高一截的游戏性数值，非设定
  speed: {
    walk: A.SPEED.walk,     // 未被发现时的日常游荡速度，选中版本未写，游戏性默认值
    run: A.SPEED.sprint,    // 依据："能以极高速度奔跑，即使拿着两倍于自身体重的物品也一样"→ 对应"比人快、跑不掉"档
  },
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150, needsLight: false, avoidsLight: false }, // 依据：senses 标注 unverified，感知给默认值
  attack: {
    hp: A.DAMAGE.medium,     // 依据："怎样杀死猎物并不完全清楚（因为它们通常逃离威胁）"——杀死方式未记载，取中等伤害作为游戏性默认值，非设定
    sanity: 0,                 // 依据：sanityEffect 标注 unverified，不填
    range: 1.6,                  // 依据："手臂很长，可以伸到很远"→ 长臂抓取，取长臂档上限
    cooldown: A.COOLDOWN.slow,  // 依据："抓住另一侧的猎物，拖进自己所在的走廊"——抓、拖两段过程，对应"抓住后撕扯→slow"
  },
  // 选中版本没写 sanityEffect（unverified）→ 不加 aura
  // 选中版本没写具体叫声（appearance/behavior 均未提声音）→ 不加 sounds

  // 行为：巡逻游荡；发现目标后追击、够得着就抓。
  // 说明：原文另有"隔墙伸手拽人"的穿墙抓取战术，以及"非狩猎状态下被目击会无声逃走"/"故意冲向它会把它吓退"两条回避行为，
  // 均未实现，原因见下方 notImplemented——不用骨架的 gaze（玩家直视）机制近似，是因为预览/游玩相机通常正对着实体以便看清画面，
  // 套用 gaze 会让它在验收测试里持续处于"被注视→后退"，导致永远追不上测试人，不满足"有害实体必须能攻击测试人"的硬性验收要求。
  brain: A.stalker({ patrol: 'wander', patrolRadius: 16, alertSec: 0.4, searchSec: 8 }),
  anim: {
    gait: 'biped',
    twitch: 0.16,     // 依据："站姿摇晃，走路动作不自然"
    strike: 'grab',    // 依据：攻击是"抓住猎物"
    recoil: 0.2,
  },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 2.3, thin: 0.85, hunch: 0.25,   // 依据："骨架脆弱"→ 用较高的 thin 表现外观上的瘦削感（HP 另按体格强壮给，二者互不冲突）
      armLen: 1.9,                              // 依据："手臂很长，可以伸到很远"
      head: 'faceless',                          // 依据："没有脸和耳朵等显著特征"；构件的人形头部本就不带耳朵几何，无需额外处理
      hands: true, feet: true, claws: 0, hair: 0,
      colors: { body: 0x3a3a3d },   // 依据："深灰色的人形"；appearance 未提发光部位，不加 glow
      look: { body: 'skin' },
    }), { label: 'duller' });
  },
});
})();
