// 示范实体（有害）：BR.arch 追猎者骨架 + 人形构件的标准写法。不对应任何设定版本，只给实体代理照着抄结构；上线前删除（同 _dev_*）。
// 正式实体文件头必须写：来源版本 source、URL、许可 CC BY-SA 3.0 —— 见 js/entities/_TEMPLATE.md 第 1 节
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: '_demo_stalker', en: 'Demo Stalker', zh: '示范·追猎者', version: 'demo',
  faction: 'hostile',

  // 正式实体每个数值都要写"依据：选中版本哪句话 → 哪一档"；示范里写的是档位含义
  hp: A.HP.average,                                   // 60：测试人（100 血）挨 5 下倒，友善示范向导打 3 下能打死它
  radius: 0.35, height: 2.1,                          // 瘦高人形，比玩家高一头
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },    // 追击 4.4 m/s：玩家步行 3.0 甩不掉，冲刺 5.2 才甩得掉
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150, needsLight: false, avoidsLight: false },
  attack: { hp: A.DAMAGE.medium, sanity: 5, range: 1.0, cooldown: A.COOLDOWN.normal },
  aura: { radius: 8, sanityPerSec: A.AURA.faint },   // 噩梦模式靠近掉 san（player.js 结算）
  sounds: { alert: 'screech', attack: 'hit', idle: 'breath' },

  // 行为：出生点 8 m 内取航点巡逻；丢失目标后在最后位置搜 6 秒
  brain: A.stalker({ patrol: 'home', patrolRadius: 8, searchSec: 6 }),
  // 动画：双足步态；步幅 1.6 m（腿长）；轻微抽搐；右臂抡击；进入搜索状态时低语（两端都听得见）
  anim: { gait: 'biped', stride: 1.6, twitch: 0.12, strike: 'swipe', stateSounds: { search: 'whisper' } },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 2.1, thin: 0.75, hunch: 0.35, armLen: 1.3, head: 'faceless', claws: 3,
      face: { eyes: 2, smile: false, eyeShape: 'slit' },           // 无面头上只有两道发光细缝
      colors: { body: 0x2b2723, head: 0xcbbfae, claw: 0x16130f, glow: 0xfff2c4 },
      look: { body: 'skin' },
    }), { label: '_demo_stalker' });
  },
});
})();
