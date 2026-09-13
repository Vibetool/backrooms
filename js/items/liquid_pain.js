// 液态痛苦 Liquid Pain（Object 48）
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/object-48
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（Fandom 的毒烟、接触几秒溶皮肤、火盐合成，wikidot-cn 的浅红果汁色等一律不借）：
//   · 外观：红色液体，装在普通杏仁水瓶里，几乎分不出真假；瓶封可能破损、瓶身可能有凹痕；比杏仁水苦；很容易被当成安全的水
//   · 效果：喝下去烧伤体内、腐蚀胃、器官衰竭；症状依次是烧心、腹痛、口干、疲劳，然后大出血，几小时内死亡；
//     成分据称是盐酸加氰化钾；页面没提治疗方法
// 伪装：模型直接用本游戏标准款杏仁水瓶（almond_water.js 的 bottle），只按本版本写的改——红色液体、凹痕、瓶封破损。
// 拾取提示不剧透：显示名按外观叫"杏仁水（封口破损）"，喝下去才揭晓。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] liquid_pain 需要先加载 js/items/_kit.js'); return; }

const H = K.LORE_HOUR;
const LIQUID = 0xb8141b;
const MODEL = { theme: 'standard', liquid: LIQUID, dent: true, brokenSeal: true, name: 'liquid_pain' };

// "几小时内死亡"：取设定 3 小时 = 180 秒，按页面列的症状顺序分五段，每段 36 秒。
// 走完最后一段还活着就判死（lethalAtEnd）——页面没有任何治疗方法，喝下去就是死。只在噩梦生存扣血/致死。
const POISON = {
  key: 'liquid_pain', cause: '喝下了液态痛苦，器官衰竭而死', tags: ['poison'], lethalAtEnd: true,
  stages: [
    // 烧心：体内开始被烧，轻微掉血
    { seconds: H * 0.6, hpPerSec: -0.1, visual: { flash: '#7a1410', peak: 0.2 }, toast: '胸口一阵烧灼' },
    // 腹痛：胃被腐蚀
    { seconds: H * 0.6, hpPerSec: -0.25, visual: { distort: 0.12 }, toast: '肚子绞痛起来' },
    // 口干
    { seconds: H * 0.6, hpPerSec: -0.25, visual: { distort: 0.18 }, toast: '嘴里干得发苦' },
    // 疲劳：走不动（移速减慢，非数值效果，所有模式生效）
    { seconds: H * 0.6, hpPerSec: -0.25, speedMul: 0.6, visual: { distort: 0.25 }, toast: '浑身发软，几乎走不动' },
    // 大出血：器官衰竭前的最后阶段，36 秒内掉 90 血
    { seconds: H * 0.6, hpPerSec: -2.5, speedMul: 0.5, visual: { distort: 0.45, flash: '#b00000', peak: 0.3, pulse: 2.5 }, toast: '开始大量出血……' },
  ],
};

let iconUrl;

BR.itemTypes.register({
  type: 'liquid_pain', en: 'Almond Water (broken seal)', zh: '杏仁水（封口破损）', version: 'wikidot-en',
  trueEn: 'Liquid Pain (Object 48)', trueZh: '液态痛苦',
  category: 'hazard',
  stack: 5,
  desc: '一瓶杏仁水，瓶封好像被打开过，瓶身有点凹。液体颜色偏红。',
  // 图标在第一次读取时才画：要借杏仁水的画法，而加载顺序里杏仁水不一定在前面
  get icon() {
    if (iconUrl === undefined) {
      const aw = BR.itemTypes.get('almond_water');
      iconUrl = aw && typeof aw.drawIcon === 'function' ? K.icon(g => aw.drawIcon(g, MODEL)) : K.icon((g, h) => {
        h.fillRR(g, 19, 14, 26, 47, 6, '#b8141b', 'rgba(40,40,60,0.55)');
        g.fillStyle = '#8f7cc8';
        g.fillRect(26, 5, 12, 8);
      });
    }
    return iconUrl;
  },
  effect: { timed: [POISON] },
  build(ctx) {
    const aw = BR.itemTypes.get('almond_water');
    if (aw && typeof aw.bottle === 'function') return aw.bottle(ctx, MODEL);
    // 杏仁水没注册时的兜底：同尺寸的红色瓶
    return K.assemble({
      name: 'liquid_pain', scale: 1.2,
      solid: [K.paint(K.cyl(0.03, 0.03, 0.148, 12, 0.004), LIQUID), K.paint(K.cyl(0.0148, 0.0148, 0.018, 10, 0.212), 0x8f7cc8)],
      glass: [[K.cyl(0.034, 0.034, 0.21, 12, 0), 0xdfe9f2, 0.28]],
    });
  },
  use(player) {
    K.apply(player, this);
    K.sound('drink');
    K.toast('味道比平常的杏仁水苦……');
    return true;
  },
});
})();
