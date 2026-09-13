// 饼干 Cookies
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-fun
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：调研结论是 wikidot-en 的 Level Fun 页根本没提到饼干（本页物品只有派对用品、带诡雷的小物、派对客蛋糕、引燃物），
//   外观、效果、稀有度都没有（unverified）。
//   → 按规则"选中版本没写的就不做"：不加任何数值效果、不在任何层级随机刷（data/item-spawn.json 里 per1000m2 = 0）。
//   模型只按物品名画成"一小摞圆饼干"。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] cookies 需要先加载 js/items/_kit.js'); return; }

const R = 0.035, H = 0.01, SEG = 12;

BR.itemTypes.register({
  type: 'cookies', en: 'Cookies', zh: '饼干', version: 'wikidot-en',
  category: 'food',
  stack: 5,
  desc: '一小摞圆饼干。',
  icon: K.icon((g, h) => {
    [[34, 50], [30, 40], [33, 30]].forEach((p, i) => {
      h.ell(g, p[0], p[1] + 3, 22, 8, '#a86e34');
      h.ell(g, p[0], p[1], 22, 8, i === 2 ? '#d49a58' : '#c98d4a', 'rgba(110,70,30,0.6)');
    });
    [[25, 29], [34, 27], [41, 31], [30, 33], [38, 34]].forEach(c => h.ell(g, c[0], c[1], 2.2, 1.6, '#3e2210'));
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    const T = window.THREE;
    const cookie = (x, y, z, tilt) => K.paint(new T.CylinderGeometry(R, R * 0.97, H, SEG, 1, false)
      .rotateX(tilt).translate(x, y + H / 2, z), 0xc98d4a);
    const solid = [cookie(0, 0, 0, 0), cookie(0.006, H, -0.004, 0.05), cookie(-0.004, H * 2, 0.005, -0.06)];
    [[0.012, 0.008], [-0.014, 0.006], [0.002, -0.016], [-0.008, 0.02], [0.02, -0.01]].forEach(c => {
      solid.push(K.paint(K.box(0.006, 0.004, 0.006, c[0] - 0.004, H * 3 - 0.001, c[1] + 0.005), 0x3e2210));
    });
    return K.assemble({ name: 'cookies', scale: 2.1, solid });
  },
  use: K.simpleUse('eat', '吃掉了几块饼干'),
});
})();
