// 瓶装水 Water bottles
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki-cn.wikidot.com/level-19
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 叙事部分（版本 4–6）在箱子里找到水瓶，可以喝；外观没写
//   · 据已落盘的层级调研：从本层带出去后可能很快腐烂（约百分之一）
// 外观取舍：外观没写 → 画最普通的无标签透明塑料水瓶（几道加强筋、浅色瓶盖），不加任何品牌。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] water_bottle 需要先加载 js/items/_kit.js'); return; }

const SEG = 8;
// 带加强筋的瓶身：每隔一段收进去一圈
const SHELL = [[0, 0.003], [0.024, 0], [0.031, 0.008], [0.031, 0.03], [0.028, 0.036], [0.031, 0.042], [0.031, 0.07],
  [0.028, 0.076], [0.031, 0.082], [0.031, 0.11], [0.028, 0.116], [0.031, 0.122], [0.031, 0.14], [0.022, 0.165],
  [0.012, 0.178], [0.012, 0.188]];
// "带出本层后可能很快腐烂（约 1/100 概率）"：不在 Level 19 喝时有 1% 已经坏了
const ROT_CHANCE = 0.01;
const HOME_LEVEL = '19';

BR.itemTypes.register({
  type: 'water_bottle', en: 'Water Bottle', zh: '瓶装水', version: 'wikidot-cn',
  category: 'drink',
  stack: 5,
  desc: '箱子里翻出来的一瓶水。',
  icon: K.icon((g) => {
    g.fillStyle = '#6fb3e8';
    g.fillRect(27, 4, 10, 9);
    const body = () => {
      g.beginPath();
      g.moveTo(28, 12); g.lineTo(36, 12); g.lineTo(36, 17);
      g.quadraticCurveTo(45, 20, 45, 28); g.lineTo(45, 57);
      g.quadraticCurveTo(45, 61, 41, 61); g.lineTo(23, 61);
      g.quadraticCurveTo(19, 61, 19, 57); g.lineTo(19, 28);
      g.quadraticCurveTo(19, 20, 28, 17); g.closePath();
    };
    g.save();
    body();
    g.clip();
    g.fillStyle = 'rgba(225,238,247,0.6)';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#bcd9ee';
    g.fillRect(0, 25, 64, 40);
    g.strokeStyle = 'rgba(90,130,160,0.55)';
    g.lineWidth = 1.5;
    [33, 42, 51].forEach(y => { g.beginPath(); g.moveTo(19, y); g.lineTo(45, y); g.stroke(); });
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(23, 27, 2, 26);
    g.restore();
    body();
    g.strokeStyle = 'rgba(60,90,120,0.6)';
    g.lineWidth = 1.5;
    g.stroke();
  }),
  // hunger +5 —— 页面只说"可以喝"：按普通一瓶水算（本游戏没有口渴值，补水并进饥饿条），取最小的饮料量
  effect: { hunger: 5 },
  build() {
    return K.assemble({
      name: 'water_bottle', scale: 1.25,
      solid: [
        K.paint(K.cyl(0.027, 0.027, 0.139, SEG, 0.006), 0xc6deee),
        K.paint(K.cyl(0.0128, 0.0128, 0.016, SEG, 0.188), 0x6fb3e8),
        K.paint(K.cyl(0.0138, 0.0138, 0.003, SEG, 0.184, true), 0x6fb3e8),
      ],
      glass: [[K.lathe(SHELL, SEG), 0xe3eef6, 0.32]],
    });
  },
  use(player) {
    K.sound('drink');
    if (BR.game.levelId !== HOME_LEVEL && K.rand() < ROT_CHANCE) {
      K.toast('这瓶水离开 Level 19 之后已经坏了，只能倒掉');
      return true;
    }
    K.apply(player, this);
    return true;
  },
});
})();
