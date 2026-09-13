// 绷带 / 纱布 Bandages / gauze
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://web.archive.org/web/2025/https://backrooms.fandom.com/wiki/Level_14
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（wikidot 的"Level 1 板条箱里有"不借）：
//   · 页面没描述外观；和抗生素、止痛药一起放在 Level 14 接待室的椭圆形前台上，经常能找到
//   · 页面没写效果
// 按规则"选中版本没写的就不做"：不加任何数值效果（不回血）。模型只按物品名画成一卷纱布绷带（侧躺的卷 + 一截松开的尾巴）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] bandages 需要先加载 js/items/_kit.js'); return; }

const R = 0.032, W = 0.05, HOLE = 0.012;

// 纱布纹理：浅米白底 + 细密的经纬线
function drawWeave(g, w, h) {
  g.fillStyle = '#f5f2ea';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(170,160,140,0.55)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
  for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
}

BR.itemTypes.register({
  type: 'bandages', en: 'Bandages', zh: '绷带', version: 'fandom',
  category: 'medical',
  stack: 5,
  desc: '一卷纱布绷带。',
  icon: K.icon((g, h) => {
    g.fillStyle = '#f5f2ea';
    g.beginPath();
    g.moveTo(34, 44); g.lineTo(58, 52); g.lineTo(55, 60); g.lineTo(30, 54);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(150,140,120,0.8)';
    g.lineWidth = 1.2;
    g.stroke();
    h.ell(g, 28, 32, 22, 22, '#f5f2ea', 'rgba(140,130,110,0.9)');
    g.strokeStyle = 'rgba(190,180,160,0.9)';
    g.lineWidth = 1;
    [17, 12, 7].forEach(r => { g.beginPath(); g.arc(28, 32, r, 0, Math.PI * 2); g.stroke(); });
    h.ell(g, 28, 32, 6, 6, '#8a8272');
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    const T = window.THREE;
    const weave = K.labelMat('bandage_weave', 64, 64, drawWeave);
    // 卷身侧躺：圆柱轴沿 X，底部贴地
    const roll = new T.CylinderGeometry(R, R, W, 14, 1, true).rotateZ(Math.PI / 2).translate(0, R, 0);
    const tail = new T.BoxGeometry(W * 0.96, 0.002, 0.09).translate(0, 0.001, R + 0.04);
    const ends = [
      K.paint(new T.RingGeometry(HOLE, R, 14, 1).rotateY(Math.PI / 2).translate(W / 2, R, 0), 0xefebe2),
      K.paint(new T.RingGeometry(HOLE, R, 14, 1).rotateY(-Math.PI / 2).translate(-W / 2, R, 0), 0xefebe2),
      K.paint(new T.CylinderGeometry(HOLE, HOLE, W, 10, 1, true).rotateZ(Math.PI / 2).translate(0, R, 0), 0x9c9484),
    ];
    return K.assemble({
      name: 'bandages', scale: 1.4,
      solid: ends,
      labels: [[roll, weave], [tail, weave]],
    });
  },
  use: K.simpleUse('click', '缠上了绷带'),
});
})();
