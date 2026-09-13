// 预包装微波餐 Pre-packaged microwavable meals
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki-cn.wikidot.com/level-13
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 外观：预先包装好的微波餐，放在冰箱里（配图是补货一天后的冰箱门内侧）；访谈里提到剩下来的微波意大利面
//   · 效果：维持基本饮食；理论上靠均衡饮食、良好卫生和还算舒适的条件就能活下去
//   · 冰箱定期补充基本食品，通常就是这种微波餐
// 外观取舍：包装样式没写 → 画成常见的黑色塑料餐盒 + 透明封膜 + 纸质腰封；盒里是访谈提到的意大利面。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] microwave_meal 需要先加载 js/items/_kit.js'); return; }

const W = 0.13, D = 0.09, H = 0.03, T_ = 0.003;

function drawTop(g, w, h) {
  g.fillStyle = '#e9cf8c';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d2b168';
  g.lineWidth = 3;
  for (let i = 0; i < 26; i++) {
    const cx = (i * 37) % w, cy = (i * 23) % h;
    g.beginPath();
    g.arc(cx, cy, 10 + (i % 4) * 5, i, i + 2.4);
    g.stroke();
  }
}

function drawSleeve(g, w, h) {
  g.fillStyle = '#f2ece0';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c0392b';
  g.fillRect(0, 0, w, 20);
  g.fillRect(0, h - 14, w, 14);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = 'bold 14px "Arial Black", Arial, sans-serif';
  g.fillText('MICROWAVE MEAL', w / 2, 10);
  g.fillStyle = '#333333';
  g.font = 'bold 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('微波意大利面', w / 2, h / 2 - 2);
  g.font = 'bold 13px Arial, sans-serif';
  g.fillStyle = '#7a1f16';
  g.fillText('SPAGHETTI · 3 MIN', w / 2, h / 2 + 24);
}

BR.itemTypes.register({
  type: 'microwave_meal', en: 'Microwave Meal', zh: '微波餐', version: 'wikidot-cn',
  category: 'food',
  stack: 3,
  desc: '冰箱里补上的预包装微波餐，这盒是意大利面。',
  icon: K.icon((g, h) => {
    h.poly(g, [[4, 30], [30, 20], [60, 28], [34, 40]], '#e9cf8c', 'rgba(20,20,20,0.9)');
    g.strokeStyle = '#c9a652';
    g.lineWidth = 1.2;
    [[18, 29], [30, 26], [42, 30], [26, 33]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 3, 0, 4); g.stroke(); });
    h.poly(g, [[4, 30], [34, 40], [34, 52], [4, 42]], '#1c1c1c');
    h.poly(g, [[34, 40], [60, 28], [60, 40], [34, 52]], '#2a2a2a');
    h.poly(g, [[14, 26], [36, 18], [44, 21], [22, 30]], 'rgba(255,255,255,0.35)');
    h.poly(g, [[14, 34.5], [24, 38], [50, 26.5], [40, 23]], '#f2ece0');
    h.poly(g, [[14, 34.5], [24, 38], [24, 50], [14, 46.5]], '#f2ece0');
    h.poly(g, [[24, 38], [50, 26.5], [50, 38.5], [24, 50]], '#e6decd');
    g.fillStyle = '#c0392b';
    h.poly(g, [[24, 38], [50, 26.5], [50, 30], [24, 41.5]], '#c0392b');
  }),
  // hunger +35 —— "维持基本饮食"：算一顿基本的饭
  effect: { hunger: 35 },
  build() {
    const Th = window.THREE;
    const black = 0x1c1c1c;
    const solid = [
      K.paint(K.box(W, T_, D, 0, 0), black),
      K.paint(K.box(W, H, T_, 0, 0, D / 2), black), K.paint(K.box(W, H, T_, 0, 0, -D / 2), black),
      K.paint(K.box(T_, H, D, W / 2, 0, 0), black), K.paint(K.box(T_, H, D, -W / 2, 0, 0), black),
    ];
    const top = new Th.PlaneGeometry(W - T_, D - T_).rotateX(-Math.PI / 2).translate(0, H - 0.006, 0);
    const sleeve = new Th.BoxGeometry(W + 0.004, H + 0.004, 0.05).translate(0, H / 2, 0);
    const film = new Th.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(0, H + 0.0005, 0);
    return K.assemble({
      name: 'microwave_meal', scale: 1.2,
      solid,
      labels: [[top, K.labelMat('microwave_meal_pasta', 128, 128, drawTop)], [sleeve, K.labelMat('microwave_meal_sleeve', 256, 128, drawSleeve)]],
      glass: [[film, 0xffffff, 0.22]],
    });
  },
  use: K.simpleUse('eat', '吃掉了一盒微波意大利面（凉的也行）'),
});
})();
