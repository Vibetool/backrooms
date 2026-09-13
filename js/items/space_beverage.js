// 太空主题饮料瓶 Space-themed beverage bottles
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://backrooms.fandom.com/wiki/Level_20
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：调研结论是 Fandom 的 Level 20 页根本没提到这种饮料（unverified），外观、效果、稀有度都没有。
//   → 按规则"选中版本没写的就不做"：不加任何数值效果、不在任何层级随机刷（data/item-spawn.json 里 per1000m2 = 0）。
//   模型只按物品名本身画成"太空主题的饮料瓶"：深蓝星空标签 + 带环行星，其余不发挥。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] space_beverage 需要先加载 js/items/_kit.js'); return; }

const SEG = 12;
const BODY = [[0, 0.002], [0.028, 0], [0.032, 0.006], [0.032, 0.14], [0.026, 0.165], [0.015, 0.18], [0.013, 0.195]];

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0d1238');
    gr.addColorStop(1, '#23306e');
    g.fillStyle = gr;
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) {
      const sx = x + ((i * 97) % lw), sy = (i * 53) % h, r = (i % 3) * 0.6 + 0.8;
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    }
    // 带环行星
    g.fillStyle = '#e8883a';
    g.beginPath(); g.arc(x + lw / 2, h * 0.36, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f5d28a';
    g.lineWidth = 6;
    g.beginPath(); g.ellipse(x + lw / 2, h * 0.36, 52, 12, -0.25, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#8fe3ff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 34px "Arial Black", Arial, sans-serif';
    g.fillText('SPACE', x + lw / 2, h * 0.74);
    g.font = 'bold 16px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = '#d8e6ff';
    g.fillText('太空饮料', x + lw / 2, h * 0.9);
  }
}

BR.itemTypes.register({
  type: 'space_beverage', en: 'Space-themed Beverage', zh: '太空主题饮料', version: 'fandom',
  category: 'drink',
  stack: 5,
  desc: '瓶身印着星空和行星的饮料。',
  icon: K.icon((g, h) => {
    g.fillStyle = '#c9ced6';
    g.fillRect(26, 3, 12, 9);
    h.fillRR(g, 18, 16, 28, 45, 7, '#141a48', 'rgba(10,10,30,0.7)');
    g.fillStyle = '#ffffff';
    [[23, 22], [40, 26], [26, 52], [41, 55], [34, 20], [21, 44]].forEach(p => g.fillRect(p[0], p[1], 1.6, 1.6));
    h.ell(g, 32, 35, 7, 7, '#e8883a');
    g.strokeStyle = '#f5d28a';
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(32, 35, 13, 3.2, -0.25, 0, Math.PI * 2); g.stroke();
    h.text(g, 'SPACE', 32, 49, 7, '#8fe3ff');
  }),
  // 选中版本没写任何效果 → 无数值
  effect: {},
  build() {
    return K.assemble({
      name: 'space_beverage', scale: 1.2,
      shiny: [
        K.paint(K.lathe(BODY, SEG), 0x1b2450),
        K.paint(K.cyl(0.0142, 0.0142, 0.02, SEG, 0.192), 0xc9ced6),
      ],
      labels: [[K.cyl(0.0326, 0.0326, 0.11, SEG, 0.022, true), K.labelMat('space_beverage', 512, 256, drawLabel)]],
    });
  },
  use: K.simpleUse('drink', '喝完了一瓶太空主题的饮料'),
});
})();
