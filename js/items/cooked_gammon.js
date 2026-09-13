// 盘装熟熏肉 Cooked gammon on a plate
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://web.archive.org/web/20260114003328/https://backrooms.fandom.com/wiki/Level_19
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：调研结论是 Fandom 的 Level 19 页根本没提到这道菜（unverified），外观、效果、稀有度都没有。
//   → 按规则"选中版本没写的就不做"：不加任何数值效果、不在任何层级随机刷（data/item-spawn.json 里 per1000m2 = 0）。
//   模型只按物品名画成"放在盘子里的一块熟熏肉"：白瓷盘 + 带脂肪边的粉色熏肉排。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] cooked_gammon 需要先加载 js/items/_kit.js'); return; }

const SEG = 16;

BR.itemTypes.register({
  type: 'cooked_gammon', en: 'Cooked Gammon (plate)', zh: '盘装熟熏肉', version: 'fandom',
  category: 'food',
  stack: 3,
  desc: '一个盘子，上面放着一块煎熟的熏肉排。',
  icon: K.icon((g, h) => {
    h.ell(g, 32, 40, 29, 16, '#f7f7f4', 'rgba(120,120,120,0.6)');
    h.ell(g, 32, 40, 21, 11, '#ecece8');
    g.save();
    g.translate(32, 38);
    g.rotate(-0.15);
    h.ell(g, 0, 0, 17, 9, '#f2dcc0', 'rgba(140,90,60,0.7)');
    h.ell(g, -1, -0.5, 14, 7, '#d9826e');
    g.strokeStyle = 'rgba(120,50,30,0.55)';
    g.lineWidth = 1.6;
    [-7, 0, 7].forEach(x => { g.beginPath(); g.moveTo(x - 3, -5); g.lineTo(x + 3, 5); g.stroke(); });
    g.restore();
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    const T = window.THREE;
    const plateTop = K.paint(K.lathe([[0, 0.004], [0.055, 0.004], [0.08, 0.012], [0.09, 0.016], [0.088, 0.018]], SEG), 0xf7f7f4);
    const plateBottom = K.paint(K.lathe([[0.088, 0.018], [0.06, 0], [0.001, 0]], SEG), 0xdcdcd8);
    // 熏肉排：一块不太规则的椭圆厚片，顶面粉色、侧面是脂肪边
    const shape = new T.Shape();
    const pts = [[0.05, 0], [0.042, 0.022], [0.018, 0.032], [-0.012, 0.03], [-0.04, 0.022], [-0.052, 0.002], [-0.044, -0.02], [-0.016, -0.03], [0.016, -0.029], [0.04, -0.02]];
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const gammon = new T.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 1 })
      .rotateX(-Math.PI / 2).translate(0, 0.007, 0);
    K.paintByNormal(gammon, 0xd9826e, 0xf0d8b8, 0xb8604a);
    // 顶面几道煎痕
    const marks = [-0.022, 0, 0.022].map(x => K.paint(K.box(0.004, 0.001, 0.04, x, 0.019, 0).rotateY(0.5), 0x8a3c26));
    return K.assemble({ name: 'cooked_gammon', scale: 1.2, solid: [plateTop, plateBottom, gammon].concat(marks) });
  },
  use: K.simpleUse('eat', '吃掉了盘子里的熟熏肉'),
});
})();
