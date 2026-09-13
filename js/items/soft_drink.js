// 苏打水 / 软饮料 Soda / soft drinks
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-20 （同站 Level 5：https://backrooms-wiki.wikidot.com/level-5）
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（Fandom Level 14 的发霉变质瓶子不借）：
//   · Level 20 等候厅的储物柜和走廊售货机里都有汽水，离入口越远储物柜里越多；Viridis Red 游戏赢了，房间中央会出现一瓶随机软饮料
//   · Level 5 贝弗莉室的小桌上摆着很多杯饮料（没说是什么）
//   · 瓶型、品牌、颜色页面都没写；页面只把它当普通饮料和奖励，没写具体效果
// 外观取舍：没写瓶型/品牌/颜色 → 画一个认得出是"一瓶汽水"的无品牌通用塑料汽水瓶（收腰瓶身、深色汽水、白底 POP 标签）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] soft_drink 需要先加载 js/items/_kit.js'); return; }

const SEG = 10;
const SHELL = [[0, 0.004], [0.02, 0], [0.031, 0.008], [0.035, 0.026], [0.031, 0.05], [0.035, 0.072],
  [0.035, 0.125], [0.029, 0.152], [0.016, 0.184], [0.0115, 0.192], [0.0115, 0.204]];

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    g.fillStyle = '#f4f4f2';
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#2b2b2b';
    g.fillRect(x, 0, lw, 8);
    g.fillRect(x, h - 8, lw, 8);
    g.strokeStyle = '#9a9a9a';
    g.lineWidth = 2;
    [[30, 30, 7], [44, 58, 5], [214, 34, 6], [226, 62, 4]].forEach(b => { g.beginPath(); g.arc(x + b[0], b[1], b[2], 0, Math.PI * 2); g.stroke(); });
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 44px "Arial Black", Arial, sans-serif';
    g.fillText('POP', x + lw / 2, h / 2 - 6);
    g.font = 'bold 14px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('汽水 · SODA', x + lw / 2, h - 18);
  }
}

BR.itemTypes.register({
  type: 'soft_drink', en: 'Soda', zh: '汽水', version: 'wikidot-en',
  category: 'drink',
  stack: 5,
  desc: '一瓶普通的汽水，储物柜和售货机里常见。',
  icon: K.icon((g, h) => {
    const body = () => {
      g.beginPath();
      g.moveTo(28, 12); g.lineTo(36, 12); g.lineTo(36, 18);
      g.quadraticCurveTo(46, 22, 46, 30); g.lineTo(46, 38);
      g.quadraticCurveTo(42, 42, 46, 46); g.lineTo(46, 56);
      g.quadraticCurveTo(46, 61, 40, 61); g.lineTo(24, 61);
      g.quadraticCurveTo(18, 61, 18, 56); g.lineTo(18, 46);
      g.quadraticCurveTo(22, 42, 18, 38); g.lineTo(18, 30);
      g.quadraticCurveTo(18, 22, 28, 18); g.closePath();
    };
    g.fillStyle = '#1e1e1e';
    g.fillRect(27, 4, 10, 9);
    g.save();
    body();
    g.clip();
    g.fillStyle = 'rgba(230,230,230,0.5)';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4a2812';
    g.fillRect(0, 24, 64, 40);
    g.fillStyle = '#f4f4f2';
    g.fillRect(0, 29, 64, 12);
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, 29, 64, 2);
    g.fillRect(0, 39, 64, 2);
    h.text(g, 'POP', 32, 35.5, 8, '#1a1a1a');
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(22, 44, 2, 12);
    g.restore();
    body();
    g.strokeStyle = 'rgba(30,30,30,0.6)';
    g.lineWidth = 1.5;
    g.stroke();
  }),
  // hunger +5 —— 页面只把它当普通饮料：按喝了一瓶普通饮料算（本游戏没有口渴值，饮料的补水并进饥饿条），取最小的饮料量
  effect: { hunger: 5 },
  build() {
    return K.assemble({
      name: 'soft_drink', scale: 1.2,
      solid: [
        K.paint(K.cyl(0.029, 0.029, 0.122, SEG, 0.008), 0x4a2812),
        K.paint(K.cyl(0.0125, 0.0125, 0.015, SEG, 0.204), 0x1e1e1e),
        K.paint(K.cyl(0.0135, 0.0135, 0.003, SEG, 0.199, true), 0x1e1e1e),
      ],
      labels: [[K.cyl(0.0356, 0.0356, 0.044, SEG, 0.078, true), K.labelMat('soft_drink', 512, 96, drawLabel)]],
      glass: [[K.lathe(SHELL, SEG), 0xe6ecef, 0.3]],
    });
  },
  use: K.simpleUse('drink'),
});
})();
