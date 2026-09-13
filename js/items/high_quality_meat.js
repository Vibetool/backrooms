// 优质的肉 High-quality meat
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki-cn.wikidot.com/level-5 （同站 Entity 26：https://backrooms-wiki-cn.wikidot.com/entity-26）
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · Level 5 页没写外观和来源；同站 Entity 26 页说萨曼莎喜欢牛排、优质鱼肉、鸡肉
//   · 用途：想接近萨曼莎要带着；她用肉换"读灵术"服务，不喂的话会变暴力（抓挠撕咬，锯齿牙能轻易撕开皮肉，目前没有致死记录）
//   · 人吃了会怎样页面没写；来源和出现频率页面没说
// 外观取舍：按萨曼莎喜欢的第一样"牛排"画一块生牛排（红肉面、白色脂肪边、大理石纹）。
// 游戏里：它是给萨曼莎的交易品，不是给人吃的——使用时不消耗，只提示用途（萨曼莎实体可用 BR.player.countOf('high_quality_meat') 判断玩家带没带肉）。
// 无 hp/饥饿/san 数值（人吃的效果没写）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] high_quality_meat 需要先加载 js/items/_kit.js'); return; }

const PTS = [[0.055, 0.004], [0.048, 0.026], [0.024, 0.038], [-0.006, 0.036], [-0.034, 0.03], [-0.054, 0.012],
  [-0.05, -0.014], [-0.03, -0.03], [0, -0.034], [0.028, -0.03], [0.05, -0.018]];
const THICK = 0.02;

function drawMarble(g, w, h) {
  g.fillStyle = '#f1dccb';
  g.fillRect(0, 0, w, h);
  // 肉面在形状里缩一圈，外圈留出脂肪边
  g.fillStyle = '#b3262e';
  g.beginPath();
  g.ellipse(w / 2, h / 2, w * 0.43, h * 0.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(245,225,215,0.75)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const x = w * 0.2 + (i * 37) % (w * 0.6), y = h * 0.22 + (i * 23) % (h * 0.56);
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + 8, y - 6, x + 14, y + 8, x + 24, y + 2);
    g.stroke();
  }
}

BR.itemTypes.register({
  type: 'high_quality_meat', en: 'High-quality Meat', zh: '优质的肉', version: 'wikidot-cn',
  category: 'food',
  stack: 3,
  desc: '一块上好的生牛排。Level 5 的萨曼莎用读灵术换这种肉。',
  icon: K.icon((g, h) => {
    g.save();
    g.translate(32, 34);
    g.rotate(-0.25);
    h.ell(g, 0, 4, 27, 18, '#d9bba6');
    h.ell(g, 0, 0, 27, 18, '#f1dccb', 'rgba(120,60,50,0.7)');
    h.ell(g, -1, 0, 22, 14, '#b3262e');
    g.strokeStyle = 'rgba(245,225,215,0.8)';
    g.lineWidth = 1.3;
    [[-12, -4], [-2, 3], [6, -6], [10, 5], [-8, 7]].forEach(p => {
      g.beginPath(); g.moveTo(p[0], p[1]); g.bezierCurveTo(p[0] + 3, p[1] - 3, p[0] + 5, p[1] + 3, p[0] + 9, p[1] + 1); g.stroke();
    });
    g.restore();
  }),
  effect: {},
  build() {
    const T = window.THREE;
    const shape = new T.Shape();
    shape.moveTo(PTS[0][0], PTS[0][1]);
    for (let i = 1; i < PTS.length; i++) shape.lineTo(PTS[i][0], PTS[i][1]);
    shape.closePath();
    const body = new T.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 1 })
      .rotateX(-Math.PI / 2);
    K.paintByNormal(body, 0xb3262e, 0xf1dccb, 0x8f1f25);
    // 顶面单独一片带大理石纹的贴图，UV 按形状包围盒归一化
    const top = new T.ShapeGeometry(shape, 1);
    const pos = top.attributes.position, uv = top.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 0.055) / 0.11, (pos.getY(i) + 0.038) / 0.076);
    top.rotateX(-Math.PI / 2).translate(0, THICK + 0.0008, 0);
    return K.assemble({
      name: 'high_quality_meat', scale: 2.1,
      solid: [body],
      labels: [[top, K.labelMat('high_quality_meat', 128, 96, drawMarble)]],
    });
  },
  use() {
    K.toast('这块肉是带去 Level 5 跟萨曼莎换读灵术的，留着吧', 2600);
    return false;
  },
});
})();
