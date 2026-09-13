// 旱虾 Scit（Entity 20）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-20  许可：CC BY-SA 3.0
// 只按这个版本实现；wikidot-en 的"第三种捕食者叫 Reviooks"、EN 版游泳能力矛盾等细节不借用（WAVE2.md 第 1 节）。
// 补充参考 https://backrooms-wiki-cn.wikidot.com/level-8（同一 CN 站点，Level 8 页提到巨臂林地里有旱虾）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'scit', en: 'Scit', zh: '旱虾', version: 'wikidot-cn',
  faction: 'neutral',   // 依据：hostility = neutral，"对其他实体完全无害，对流浪者毫无威胁"

  hp: A.HP.fragile,     // 依据："无自卫手段""会被部分实体吞噬"→ 极不耐打，取最低档
  radius: 0.25, height: 0.18,
  // 依据：只写"小型甲壳类动物"，没有具体尺寸（unverified）→ 按小型虾类比例给保守游戏性数值，非设定
  speed: { walk: A.SPEED.crawl, run: A.SPEED.crawl },
  // 依据："缓慢爬行"，没写更快的速度（unverified）→ 走/逃都只有最慢档，符合"常被捕食、跑不掉"的弱势设定
  perception: { sight: A.SIGHT.poor, hearing: A.HEARING.poor, fov: 300 },
  // 依据：感官原文未详述（unverified）→ 按低等节肢动物给保守默认值，非设定；没有明确朝向 → 视野给宽
  // 不写 attack：原文"无自卫手段"，参照 _TEMPLATE.md 第 5.8 节"不会还手就不写 attack"的做法
  // 不写 aura：sanityEffect 原文未写

  brain: A.wanderer({ retaliate: 'flee', fleeSec: 4 }),
  // 依据："漫无目的地游荡于后室各处，似乎没有目标"→ 用普通游荡；被攻击时"无自卫手段"→ 只能逃(flee)，不会反击

  anim: {
    gait: 'none',   // 用 insect() 构件但不是飞虫，内置 flyer/quad 步态骨骼名都对不上，走位靠 onFrame 自己做蠕动
    breathe: 0,
    fall: 'crumple',   // 依据：外壳软体("像虾")，死亡瘫软比较合适，非设定精确姿态
    onFrame(e, dt, api, u) {
      // 依据："缓慢爬行"——insect() 的默认腿是静态几何（没有独立步肢骨骼可动），用身体左右蠕动 + 轻微起伏
      // 近似"爬行"的观感，纯表现手法，不代表设定细节
      const rig = u.rig;
      if (!rig || e.dead) return;
      const amt = Math.min(1, (u.sp || 0) / 1.2);
      if (amt < 0.03) return;
      const w = api.time * 4 + (u.seed || 0);
      A.anim.addRot(rig, 'body', 0, Math.sin(w) * 0.14 * amt, 0);
      A.anim.addRot(rig, 'head', 0, -Math.sin(w) * 0.1 * amt, 0);
      A.anim.addPos(rig, 'body', 0, Math.abs(Math.sin(w * 2)) * 0.012 * amt, 0);
    },
  },

  build(ctx) {
    // 依据："外观像……奇虾科动物；看起来像某种虾，两侧长着一些鳞片"——虫形构件的分节躯干+触角接近"虾状"轮廓，
    // 两侧鳞片用 extend 加一排小扁平薄片；触角/6 条步足是甲壳类/节肢动物的基本解剖特征（不是借用其他版本细节）。
    // 颜色未写，取不抢眼的浅褐灰色（非设定）。
    const model = A.parts.insect({
      bodyLen: 0.34, bodyR: 0.07, wings: 0, legs: 6, antennae: 0.06,
      colors: { body: 0x8a7a62 },
      look: { body: 'chitin' },
      key: 'scit_v1',
      extend(b, d) {
        for (let i = 0; i < 4; i++) {
          const z = d.bodyLen * (0.35 - i * 0.28);
          for (const s of [-1, 1]) {
            b.box('body', 'body', [0.012, d.bodyR * 0.55, d.bodyR * 0.5], [s * (d.bodyR * 1.05), d.y, z]);
          }
        }
      },
    });
    return A.wrap(model, { label: 'scit' });
  },
});
})();
