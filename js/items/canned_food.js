// 罐装 / 瓶装食物 Canned / jarred food
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-1
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（Fandom 的"板条箱可能整箱是液态痛苦"不借）：
//   · 外观：页面只说是装在罐子或瓶子里的食物，没写外观和品种
//   · 效果：密封的食物不会被污染、不会变质，是能放心吃的；小径里带家具的房间偶尔有补给，但大多已经变质或被疫病污染，只有瓶装罐装的安全
//   · Level 1 板条箱里有；带家具的房间偶尔有
// 外观取舍：没写外观和品种 → 画一只没有纸标签的素铁皮罐头（罐身几道加强筋、顶盖同心圈），不编品牌和内容物。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] canned_food 需要先加载 js/items/_kit.js'); return; }

const R = 0.038, H = 0.1, SEG = 14;
const TIN = 0xc5c9ce, TIN_DARK = 0x8f949a;

BR.itemTypes.register({
  type: 'canned_food', en: 'Canned Food', zh: '罐头食品', version: 'wikidot-en',
  category: 'food',
  stack: 5,
  desc: '密封的铁皮罐头，没有标签。封得好好的，能放心吃。',
  icon: K.icon((g, h) => {
    g.fillStyle = h.cylGrad(g, 13, 38, '#e2e5e9', '#8f949a');
    g.fillRect(13, 16, 38, 38);
    h.ell(g, 32, 54, 19, 5, '#8f949a');
    g.fillStyle = h.cylGrad(g, 13, 38, '#e2e5e9', '#8f949a');
    g.fillRect(13, 16, 38, 38);
    g.strokeStyle = 'rgba(90,95,100,0.7)';
    g.lineWidth = 1.5;
    [26, 35, 44].forEach(y => { g.beginPath(); g.moveTo(13, y); g.lineTo(51, y); g.stroke(); });
    h.ell(g, 32, 16, 19, 5.5, '#d3d7dc', 'rgba(90,95,100,0.8)');
    h.ell(g, 32, 16, 13, 3.6, null, 'rgba(120,125,130,0.8)');
    h.ell(g, 32, 16, 7, 2, null, 'rgba(120,125,130,0.8)');
  }),
  // hunger +30 —— 页面说这是能放心吃的密封食物，没给分量：按一罐普通罐头算中等的一顿
  effect: { hunger: 30 },
  build() {
    const T = window.THREE;
    const rib = y => K.paint(K.cyl(R + 0.0012, R + 0.0012, 0.004, SEG, y, true), TIN_DARK);
    return K.assemble({
      name: 'canned_food', scale: 1.2,
      shiny: [
        K.paint(K.cyl(R, R, H, SEG, 0, true), TIN),
        rib(0.028), rib(0.048), rib(0.068),
        K.paint(K.cyl(R + 0.0015, R + 0.0015, 0.007, SEG, H - 0.007, true), TIN_DARK),
        K.paint(K.cyl(R + 0.0015, R + 0.0015, 0.007, SEG, 0, true), TIN_DARK),
        K.paint(new T.CircleGeometry(R, SEG).rotateX(-Math.PI / 2).translate(0, H - 0.002, 0), TIN),
        K.paint(new T.RingGeometry(R * 0.6, R * 0.64, SEG, 1).rotateX(-Math.PI / 2).translate(0, H - 0.0015, 0), TIN_DARK),
        K.paint(new T.CircleGeometry(R, SEG).rotateX(Math.PI / 2).translate(0, 0.001, 0), TIN_DARK),
      ],
    });
  },
  use: K.simpleUse('eat', '吃掉了一罐罐头'),
});
})();
