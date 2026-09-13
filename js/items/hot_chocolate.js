// 热巧克力 Hot chocolate
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki-cn.wikidot.com/level-20
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 一瓶热巧克力，和一些冬装一起生成；外观没写
//   · 只在攀岩胜利时作为奖励生成；失败的话房间会被液态痛苦淹没
//   · 访谈里有人感谢阿尔法基地给的冬装和热巧克力，说寒冷不再是问题；具体效果没写（unverified）
// 外观取舍：只写了"一瓶" → 画一只装着深棕色液体的玻璃瓶，奶油色标签写"热巧克力"。
// 效果：没写具体效果，本游戏也没有寒冷/体温系统 → 按规则不加数值，只给一句提示。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] hot_chocolate 需要先加载 js/items/_kit.js'); return; }

const SEG = 12;
const SHELL = [[0, 0.002], [0.03, 0], [0.036, 0.01], [0.036, 0.11], [0.03, 0.135], [0.016, 0.15], [0.016, 0.166]];

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    g.fillStyle = '#f3e6cf';
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#6b3f1f';
    g.fillRect(x, 0, lw, 10);
    g.fillRect(x, h - 10, lw, 10);
    // 冒热气的杯子
    g.fillStyle = '#6b3f1f';
    g.fillRect(x + 22, 52, 26, 24);
    g.strokeStyle = '#6b3f1f';
    g.lineWidth = 4;
    g.beginPath(); g.arc(x + 50, 64, 7, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.strokeStyle = '#b08a6a';
    g.lineWidth = 3;
    [28, 36, 44].forEach(sx => {
      g.beginPath(); g.moveTo(x + sx, 46); g.bezierCurveTo(x + sx - 5, 38, x + sx + 5, 32, x + sx, 22); g.stroke();
    });
    g.fillStyle = '#5a3217';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 24px "Arial Black", Arial, sans-serif';
    g.fillText('HOT', x + lw / 2 + 32, 36);
    g.font = 'bold 17px "Arial Black", Arial, sans-serif';
    g.fillText('CHOCOLATE', x + lw / 2 + 32, 60, lw - 80);
    g.font = 'bold 16px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('热巧克力', x + lw / 2 + 32, 84);
  }
}

BR.itemTypes.register({
  type: 'hot_chocolate', en: 'Hot Chocolate', zh: '热巧克力', version: 'wikidot-cn',
  category: 'drink',
  stack: 5,
  desc: '和冬装一起出现的一瓶热巧克力。',
  icon: K.icon((g, h) => {
    g.fillStyle = '#7a5230';
    g.fillRect(25, 5, 14, 9);
    const body = () => { h.rr(g, 17, 13, 30, 48, 9); };
    g.save();
    body();
    g.clip();
    g.fillStyle = 'rgba(230,236,240,0.5)';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5b3418';
    g.fillRect(0, 22, 64, 42);
    g.fillStyle = '#f3e6cf';
    g.fillRect(0, 34, 64, 16);
    g.fillStyle = '#6b3f1f';
    g.fillRect(0, 34, 64, 2);
    g.fillRect(0, 48, 64, 2);
    g.fillRect(23, 39, 7, 7);
    h.text(g, 'HOT', 38, 42, 7, '#5a3217');
    g.restore();
    body();
    g.strokeStyle = 'rgba(60,40,30,0.6)';
    g.lineWidth = 1.5;
    g.stroke();
  }),
  // 选中版本没写具体效果，本游戏也没有寒冷系统 → 无数值
  effect: {},
  build() {
    return K.assemble({
      name: 'hot_chocolate', scale: 1.2,
      solid: [
        K.paint(K.cyl(0.032, 0.032, 0.11, SEG, 0.005), 0x5b3418),
        K.paint(K.cyl(0.0175, 0.0175, 0.016, SEG, 0.162), 0x7a5230),
      ],
      labels: [[K.cyl(0.0368, 0.0368, 0.06, SEG, 0.03, true), K.labelMat('hot_chocolate', 512, 96, drawLabel)]],
      glass: [[K.lathe(SHELL, SEG), 0xe6ecf0, 0.3]],
    });
  },
  use: K.simpleUse('drink', '热乎乎的热巧克力，身上暖和了一些'),
});
})();
