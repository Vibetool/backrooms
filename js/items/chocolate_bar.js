// 巧克力棒 Chocolate bars
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://backrooms.fandom.com/wiki/Level_20
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：调研结论是 Fandom 的 Level 20 页没提到巧克力棒（只说很多板条箱和纸箱里有工具和普通食物），外观、效果、稀有度都没有（unverified）。
//   → 按规则"选中版本没写的就不做"：不加任何数值效果、不在任何层级随机刷（data/item-spawn.json 里 per1000m2 = 0）。
//   模型只按物品名画成"一根巧克力棒"：纸包装撕开一头，露出锡纸和分格的巧克力。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] chocolate_bar 需要先加载 js/items/_kit.js'); return; }

const L = 0.1, TH = 0.012, W = 0.045;

function drawWrapper(g, w, h) {
  g.fillStyle = '#7a1c24';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8c46a';
  g.fillRect(0, 8, w, 4);
  g.fillRect(0, h - 12, w, 4);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 30px "Arial Black", Arial, sans-serif';
  g.fillStyle = '#f6e7c1';
  g.fillText('CHOCOLATE', w / 2, h / 2 - 6, w - 20);
  g.font = 'bold 16px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('巧克力', w / 2, h / 2 + 20);
}

BR.itemTypes.register({
  type: 'chocolate_bar', en: 'Chocolate Bar', zh: '巧克力棒', version: 'fandom',
  category: 'food',
  stack: 5,
  desc: '一根撕开了一头的巧克力棒。',
  icon: K.icon((g, h) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.6);
    h.fillRR(g, -28, -10, 20, 20, 2, '#5a3218', 'rgba(40,20,10,0.8)');
    g.strokeStyle = '#3e2210';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-18, -10); g.lineTo(-18, 10); g.moveTo(-28, 0); g.lineTo(-8, 0); g.stroke();
    h.poly(g, [[-10, -11], [-4, -12], [-2, 12], [-10, 11]], '#d6d9de', 'rgba(90,90,90,0.8)');
    h.fillRR(g, -4, -11, 32, 22, 2, '#7a1c24', 'rgba(50,10,10,0.8)');
    g.fillStyle = '#e8c46a';
    g.fillRect(-4, -8, 32, 2);
    g.fillRect(-4, 6, 32, 2);
    h.text(g, 'CHOC', 12, 0, 7, '#f6e7c1');
    g.restore();
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    const Th = window.THREE;
    const wrapLen = L * 0.62;
    const wrapper = new Th.BoxGeometry(wrapLen, TH, W).translate(L / 2 - wrapLen / 2, TH / 2, 0);
    const choc = L - wrapLen;
    const solid = [
      K.paint(K.box(choc, TH * 0.85, W * 0.94, -L / 2 + choc / 2, 0, 0), 0x5a3218),
      K.paint(K.box(0.002, 0.002, W * 0.94, -L / 2 + choc / 2, TH * 0.85, 0), 0x3e2210),
      K.paint(K.box(choc, 0.002, 0.002, -L / 2 + choc / 2, TH * 0.85, 0), 0x3e2210),
      // 撕开处翻出来的锡纸
      K.paint(K.box(0.008, TH * 1.15, W * 1.04, L / 2 - wrapLen - 0.002, 0, 0), 0xd6d9de),
    ];
    return K.assemble({
      name: 'chocolate_bar', scale: 1.6,
      solid,
      labels: [[wrapper, K.labelMat('chocolate_bar', 256, 96, drawWrapper)]],
    });
  },
  use: K.simpleUse('eat', '吃掉了巧克力棒'),
});
})();
