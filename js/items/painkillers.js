// 止痛药 Painkillers
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://web.archive.org/web/2025/https://backrooms.fandom.com/wiki/Level_14
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 页面没描述外观（没说是药瓶还是药板）；和绷带、抗生素一起放在 Level 14 接待室的椭圆形前台上，经常能找到
//   · 页面没写效果
// 按规则"选中版本没写的就不做"：不加任何数值效果。模型只按物品名画成一只白色药瓶（白瓶、白色安全盖、蓝字标签）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] painkillers 需要先加载 js/items/_kit.js'); return; }

const SEG = 12;

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    g.fillStyle = '#ffffff';
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#1f5fbf';
    g.fillRect(x, 0, lw, 14);
    g.fillRect(x, h - 10, lw, 10);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px "Arial Black", Arial, sans-serif';
    g.fillStyle = '#1f5fbf';
    g.fillText('PAINKILLERS', x + lw / 2, h * 0.45, lw - 20);
    g.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = '#333333';
    g.fillText('止痛药 · 片剂', x + lw / 2, h * 0.72, lw - 20);
  }
}

BR.itemTypes.register({
  type: 'painkillers', en: 'Painkillers', zh: '止痛药', version: 'fandom',
  category: 'medical',
  stack: 5,
  desc: '一瓶止痛药。',
  icon: K.icon((g, h) => {
    h.fillRR(g, 17, 8, 30, 12, 3, '#e6e6e6', 'rgba(80,80,80,0.6)');
    g.strokeStyle = 'rgba(120,120,120,0.7)';
    g.lineWidth = 1;
    for (let x = 20; x < 46; x += 4) { g.beginPath(); g.moveTo(x, 9); g.lineTo(x, 19); g.stroke(); }
    h.fillRR(g, 18, 19, 28, 42, 4, h.cylGrad(g, 18, 28, '#ffffff', '#cfcfcf'), 'rgba(80,80,80,0.6)');
    g.fillStyle = '#ffffff';
    g.fillRect(18, 28, 28, 24);
    g.fillStyle = '#1f5fbf';
    g.fillRect(18, 28, 28, 5);
    g.fillRect(18, 49, 28, 3);
    h.text(g, 'PAIN', 32, 41, 8, '#1f5fbf');
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    return K.assemble({
      name: 'painkillers', scale: 1.5,
      solid: [
        K.paint(K.cyl(0.028, 0.028, 0.075, SEG, 0), 0xf2f2f2),
        K.paint(K.cyl(0.0305, 0.0305, 0.022, SEG, 0.075), 0xdedede),
      ],
      labels: [[K.cyl(0.0286, 0.0286, 0.05, SEG, 0.013, true), K.labelMat('painkillers', 512, 128, drawLabel)]],
    });
  },
  use: K.simpleUse('click', '吞了几片止痛药'),
});
})();
