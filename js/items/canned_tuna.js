// 打开的金枪鱼罐头 Canned tuna (opened)
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-19
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 外观：已经打开的金枪鱼罐头，放在箱子里，状态出奇地好（叙事部分 Rev 4–6）
//   · 效果：可以吃，叙述者说很好吃，好久没吃过这么正经的一顿；据已落盘的层级调研：带出本层后可能很快腐烂（约百分之一）
//   · 正式条目只说箱子里经常有必需食物
// 外观取舍：纸标签没写 → 素铁皮扁罐，盖子掀开翘着，露出金枪鱼肉。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] canned_tuna 需要先加载 js/items/_kit.js'); return; }

const R = 0.042, H = 0.04, SEG = 16;
const TIN = 0xc5c9ce, TIN_DARK = 0x8f949a, TUNA = 0xd9b99a;
// "带出本层后可能很快腐烂（约 1/100 概率）"
const ROT_CHANCE = 0.01;
const HOME_LEVEL = '19';

BR.itemTypes.register({
  type: 'canned_tuna', en: 'Canned Tuna (opened)', zh: '打开的金枪鱼罐头', version: 'wikidot-en',
  category: 'food',
  stack: 5,
  desc: '已经打开的金枪鱼罐头，状态好得出奇。',
  icon: K.icon((g, h) => {
    // 翘起的盖子
    g.save();
    g.translate(46, 30);
    g.rotate(-0.9);
    h.ell(g, -18, 0, 18, 5, '#d3d7dc', 'rgba(90,95,100,0.8)');
    g.restore();
    g.fillStyle = h.cylGrad(g, 10, 44, '#e2e5e9', '#8f949a');
    g.fillRect(10, 36, 44, 18);
    h.ell(g, 32, 54, 22, 6, '#8f949a');
    g.fillStyle = h.cylGrad(g, 10, 44, '#e2e5e9', '#8f949a');
    g.fillRect(10, 36, 44, 18);
    h.ell(g, 32, 36, 22, 6.5, '#b9bdc2', 'rgba(90,95,100,0.8)');
    h.ell(g, 32, 36.5, 19, 5, '#d9b99a');
    [[24, 36], [31, 35], [38, 37], [28, 38.5], [36, 34.5]].forEach(p => h.ell(g, p[0], p[1], 3, 1.8, '#c79b78'));
  }),
  // hunger +40 —— "好久没吃过这么正经的一顿"：算一顿正经饭
  // sanity +5  —— "叙述者说很好吃"：吃到好吃的，心情好一点
  effect: { hunger: 40, sanity: 5 },
  build() {
    const T = window.THREE;
    const LID_OPEN = 2.05;   // 盖子掀过头往外翻，不挡住罐里的鱼肉
    const parts = [
      K.paint(K.lathe([[R, 0], [R, H]], SEG), TIN),                                 // 外壁
      K.paint(K.lathe([[R - 0.0015, H], [R - 0.0015, 0.004]], SEG), TIN_DARK),       // 内壁（点序反过来，法线朝里）
      K.paint(new T.RingGeometry(R - 0.0015, R + 0.0008, SEG, 1).rotateX(-Math.PI / 2).translate(0, H, 0), TIN_DARK),
      K.paint(new T.CircleGeometry(R - 0.0015, SEG).rotateX(-Math.PI / 2).translate(0, H - 0.008, 0), TUNA),
      K.paint(new T.CircleGeometry(R, SEG).rotateX(Math.PI / 2), TIN_DARK),
      // 盖子：绕罐口一侧的铰点掀起来，正反两面
      K.paint(new T.CircleGeometry(R - 0.002, SEG).rotateX(-Math.PI / 2).translate(R - 0.002, 0, 0).rotateZ(LID_OPEN).translate(-R, H + 0.001, 0), TIN_DARK),
      K.paint(new T.CircleGeometry(R - 0.002, SEG).rotateX(Math.PI / 2).translate(R - 0.002, 0, 0).rotateZ(LID_OPEN).translate(-R - 0.0008, H + 0.001, 0), 0xb9bec4),
    ];
    // 几块鱼肉
    [[0.012, 0.006, 0], [-0.014, -0.004, 1], [0.002, -0.016, 2], [-0.004, 0.017, 3]].forEach(c => {
      parts.push(K.paint(new T.IcosahedronGeometry(0.0085, 0).scale(1.3, 0.6, 1).rotateY(c[2]).translate(c[0], H - 0.006, c[1]), 0xc79b78));
    });
    return K.assemble({ name: 'canned_tuna', scale: 1.5, shiny: parts });
  },
  use(player) {
    K.sound('eat');
    if (BR.game.levelId !== HOME_LEVEL && K.rand() < ROT_CHANCE) {
      K.toast('离开 Level 19 之后，罐头里的鱼已经烂了，没法吃');
      return true;
    }
    K.apply(player, this);
    K.toast('金枪鱼好吃得出奇');
    return true;
  },
});
})();
