// 蛋糕（派对客的蛋糕）Cake —— Royal Velvet Cake 与 Royal Icing
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/entity-67 （Level Fun 页 https://backrooms-wiki.wikidot.com/level-fun 本身没直接提蛋糕）
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 外观：派对客做的 Royal Velvet 蛋糕和 Royal 糖霜；派对客用带牙的手臂从人类受害者骨架上刮下肌肉，反刍成红色肉浆做成蛋糕和糖霜，
//     Royal Velvet 这款要用活人；档案配图上标着「DO NOT EAT」；据称比红丝绒蛋糕稍甜
//   · 效果：吃了会怎样页面没写；本质是人肉做的、伪装成食物的东西，档案明确警告不要吃
//   · 由派对客在它们的地盘做出来，数量没写
// 伪装与不剧透：拾取提示用它自己的名字"皇家丝绒蛋糕"，看起来就是一只切掉一块的红丝绒蛋糕，吃下去才揭晓。
// 数值：页面没写吃了的后果 → 按规则不加 hp/饥饿/san 变化，只在吃完时揭晓真相。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] partygoer_cake 需要先加载 js/items/_kit.js'); return; }

const R = 0.065, SEG = 14, GAP = 0.9;
const RED = 0x9e1626, ICING = 0xf6f1ea;
// 自下而上：蛋糕胚、夹层糖霜、蛋糕胚、顶层糖霜
const LAYERS = [[0, 0.03, RED], [0.03, 0.008, ICING], [0.038, 0.03, RED], [0.068, 0.01, ICING]];
const TOTAL_H = 0.078;

// 切面贴图：红白分层
function drawCut(g, w, h) {
  for (const l of LAYERS) {
    g.fillStyle = l[2] === RED ? '#9e1626' : '#f6f1ea';
    const y0 = h - (l[0] + l[1]) / TOTAL_H * h;
    g.fillRect(0, y0, w, l[1] / TOTAL_H * h + 1);
  }
  g.fillStyle = 'rgba(60,0,10,0.25)';
  for (let i = 0; i < 40; i++) g.fillRect((i * 29) % w, (i * 17) % h, 2, 2);
}

BR.itemTypes.register({
  type: 'partygoer_cake', en: 'Royal Velvet Cake', zh: '皇家丝绒蛋糕', version: 'wikidot-en',
  trueEn: 'Partygoer Cake', trueZh: '派对客的蛋糕（人肉做的）',
  category: 'hazard',
  stack: 3,
  desc: '一只红色的丝绒蛋糕，抹着白色糖霜，被切走了一块。',
  icon: K.icon((g, h) => {
    const cx = 30, top = 22, bot = 50, rx = 24, ry = 8;
    g.fillStyle = '#9e1626';
    g.fillRect(cx - rx, top, rx * 2, bot - top);
    h.ell(g, cx, bot, rx, ry, '#9e1626');
    g.fillStyle = '#f6f1ea';
    g.fillRect(cx - rx, 34, rx * 2, 3);
    h.ell(g, cx, top, rx, ry, '#f6f1ea', 'rgba(150,130,120,0.6)');
    // 切掉一块：露出红白分层的切面
    h.poly(g, [[cx, top], [cx + 20, top + 4.5], [cx + 20, bot + 4.5], [cx, bot]], '#b3243a');
    g.fillStyle = '#f6f1ea';
    h.poly(g, [[cx, 34], [cx + 20, 38.5], [cx + 20, 41.5], [cx, 37]], '#f6f1ea');
    h.poly(g, [[cx, top - 1], [cx + 20, top + 3.5], [cx + 20, top + 6.5], [cx, top + 2]], '#f6f1ea');
    [[16, 20], [24, 16], [34, 15], [44, 18], [20, 26], [12, 22]].forEach(p => h.ell(g, p[0], p[1], 3, 2.2, '#ffffff', 'rgba(150,130,120,0.5)'));
  }),
  effect: {},
  build() {
    const T = window.THREE;
    const solid = LAYERS.map(l => K.paint(
      new T.CylinderGeometry(R, R, l[1], SEG, 1, false, GAP / 2, Math.PI * 2 - GAP).translate(0, l[0] + l[1] / 2, 0), l[2]));
    // 顶上一圈糖霜挤花
    for (let i = 0; i < 6; i++) {
      const a = GAP / 2 + 0.35 + i * (Math.PI * 2 - GAP - 0.7) / 5;
      solid.push(K.paint(new T.IcosahedronGeometry(0.009, 0).translate(Math.sin(a) * R * 0.78, TOTAL_H + 0.004, Math.cos(a) * R * 0.78), ICING));
    }
    // 两个切面：从圆心到边缘的竖直面，双面材质
    const cutMat = K.mat('partygoer_cake:cut', () => {
      const tex = K.texture('partygoer_cake:cut', 64, 64, drawCut);
      return new T.MeshLambertMaterial({ map: tex, emissive: 0x333333, emissiveMap: tex, side: T.DoubleSide });
    });
    const cut = a => new T.PlaneGeometry(R, TOTAL_H).translate(R / 2, TOTAL_H / 2, 0).rotateY(a - Math.PI / 2);
    return K.assemble({
      name: 'partygoer_cake', scale: 1.5,
      solid,
      labels: [[cut(GAP / 2), cutMat], [cut(-GAP / 2), cutMat]],
    });
  },
  use() {
    K.sound('eat');
    K.toast('比红丝绒蛋糕稍微甜一点……红色的部分是肉浆。这是用人做的', 3200);
    return true;
  },
});
})();
