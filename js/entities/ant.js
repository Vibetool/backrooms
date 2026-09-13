// 蚂蚁 Ants（曾编号 Entity 89；页面已被 Mass Trimming Project 归档，现行 entity-89 已换成另一实体 Fleshborn/肉蜕）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/trimmed:entity-89  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）；
// 不采用 Fleshborn（现行 entity-89）、也不采用 wikidot-cn/Fandom 里任何“蚂蚁”版本的设定。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'ant', en: 'Ants', zh: '蚂蚁', version: 'wikidot-en',
  faction: A.faction('neutral'),   // 依据：原文 hostility 明确写 neutral（“平时回避人类，只有被激怒或有人靠得很近才行动”）

  hp: A.HP.weak,               // 依据：“用手就能轻松摘掉”→ 不耐打，一整团很容易被清空，非精确数值
  radius: 0.4, height: 0.15,   // 依据：单只体宽 2–6 厘米，成团挤在角落里横向占地更宽、矮团状；原文没给整团尺寸，非设定
  speed: { walk: A.SPEED.crawl, run: A.SPEED.crawl },
  // 依据：locomotion 原文只写“爬行”，没有奔跑速度 → 都取最慢档 crawl（蚂蚁本来就跑不快，反击时也一样慢）
  perception: { sight: A.SIGHT.poor, hearing: A.HEARING.poor, fov: 360 },
  // 依据：感官原文未描述（unverified）→ 按小型爬虫给保守默认值，非设定；一团聚在一起没有明确朝向 → 360°
  attack: { hp: A.DAMAGE.graze, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.fast },
  // 依据：“人进入约三英尺（约0.9米）范围内，它们爬到人身上像水蛭一样咬住”→ range = 0.9m（3 英尺 ×0.3048）；
  // “最严重也只是轻微淤青，低威胁，未记录死亡”→ 伤害取最低档 graze；持续叮咬 → cooldown 给 fast
  // 原文未提理智影响 → 不写 aura；原文没写任何叫声/声音 → 不加 sounds

  brain: A.swarm({ move: 'ground', patrolRadius: 3.5 }),
  // 依据：“成群挤在角落里”“没有明确迁徙规律”→ 用小范围原地游荡（收窄 patrolRadius）而不是大范围巡逻表示“扎堆”；
  // neutral 阵营下只有被攻击才会反击，这是 entities.js 的阵营规则（不允许实体代码自己判断谁能打谁），
  // 所以“有人靠得很近就主动爬上去咬”这条没有在 think 里额外实现，见返回值“没实现的细节”

  anim: { gait: 'none' },   // 群体用 parts.swarm 自带的环绕蠕动动画（swarmAnim），不需要骨架步态

  build(ctx) {
    return A.wrap(A.parts.swarm({
      unit: 'mote', count: 80, radius: 0.4, flying: false, scale: 1,
      material: A.mat.lambert(0x050505),
      // 依据：“毛茸茸的圆球状小生物，通体漆黑，会吸收光线”→ mote 是圆球状个体几何，比 bug/moth/rat
      // 更贴近“圆球状、没写腿/眼睛/口器”的描述；用极暗的哑光黑材质近似“吸光”，
      // 引擎没有真正的负反照率/吸光着色器，这里只是游戏性近似，明确不发光（mote 默认材质是发光，这里用
      // material 覆盖成不发光的暗黑 lambert，避免变成反而“发光”的反效果）
    }, ctx), { label: 'ant-swarm' });
  },
});
})();
