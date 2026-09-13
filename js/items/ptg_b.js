// PTG-B（派对客转化逆转液）
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中；只有中文站原创 Entity C-233 有 PTG-A/PTG-B 设定）
// URL：https://backrooms-wiki-cn.wikidot.com/entity-c-233
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 外观没写（只说咬人时注入的 PTG-A 是棕黄色液体）；PTG-B 是派对客分泌的另一种液体，按疫苗注射使用
//   · 效果：唯一能逆转派对客转化的液体。被咬后 PTG-A 进入血管、侵入中枢神经，心智一般半小时内被同化，
//     24 小时内身体完全变成派对客；转化时间越长，PTG-B 逆转效果越有限
//   · 在医疗站点注射；野外能不能捡到页面没说
// 外观取舍：按"疫苗注射"画成一支注射器，针筒上印 PTG-B；液体颜色没写，画成近乎无色。
// 与实体作者的约定：派对客咬到玩家时 BR.effects.add({ key: 'ptg_a', seconds: 设定 24 小时 = 1440, ... })。
//   本物品检查 'ptg_a'：逆转成功率 = 1 − 转化进度（elapsed / total），成功就移除该效果。无 hp/饥饿/san 数值。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] ptg_b 需要先加载 js/items/_kit.js'); return; }

const PTG_A_KEY = 'ptg_a';
const SEG = 10;

function drawLabel(g, w, h) {
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#333333';
  g.lineWidth = 2;
  for (let x = 8; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, x % 64 === 8 ? 22 : 12); g.stroke(); }
  g.fillStyle = '#b3261e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 30px "Arial Black", Arial, sans-serif';
  g.fillText('PTG-B', w * 0.25, h * 0.66);
  g.fillText('PTG-B', w * 0.75, h * 0.66);
}

BR.itemTypes.register({
  type: 'ptg_b', en: 'PTG-B', zh: 'PTG-B', version: 'wikidot-cn',
  category: 'medical',
  stack: 3,
  desc: '一支注射器，针筒上印着 PTG-B。',
  icon: K.icon((g, h) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    g.fillStyle = '#9aa0a6';
    g.fillRect(-1, -31, 2, 12);             // 针
    g.fillStyle = '#c9ced4';
    g.fillRect(-3, -20, 6, 4);              // 针座
    h.fillRR(g, -7, -16, 14, 30, 2, 'rgba(225,238,245,0.9)', 'rgba(60,70,80,0.8)');
    g.fillStyle = '#eef4f8';
    g.fillRect(-6, -8, 12, 21);
    h.text(g, 'PTG-B', 0, 2, 5, '#b3261e');
    g.fillStyle = '#f2f2f2';
    g.fillRect(-11, 13, 22, 3);             // 指托
    g.fillStyle = '#e6e6e6';
    g.fillRect(-2, 16, 4, 10);              // 推杆
    g.fillRect(-7, 26, 14, 3);
    g.restore();
  }),
  effect: {},
  build() {
    const T = window.THREE;
    // 先竖着搭（针朝上），最后整体放倒躺在地上
    const solid = [
      K.paint(K.cyl(0.0068, 0.0068, 0.056, SEG, 0.012), 0xeef4f8),                        // 药液
      K.paint(K.cyl(0.0074, 0.0074, 0.004, SEG, 0.064), 0x2a2a2a),                        // 活塞胶头
      K.paint(new T.BoxGeometry(0.003, 0.05, 0.003).translate(0, 0.093, 0), 0xf2f2f2),     // 推杆
      K.paint(K.cyl(0.011, 0.011, 0.003, SEG, 0.118), 0xf2f2f2),                          // 推杆按压盘
      K.paint(new T.BoxGeometry(0.036, 0.003, 0.012).translate(0, 0.079, 0), 0xf2f2f2),    // 指托
      K.paint(K.cyl(0.002, 0.0055, 0.01, 8, 0.001), 0xc9ced4),                            // 针座
      K.paint(K.cyl(0.0007, 0.0007, 0.032, 6, -0.03, true), 0x9aa0a6),                    // 针头
    ];
    const barrel = K.cyl(0.0085, 0.0085, 0.078, SEG, 0.0, true);
    const label = K.cyl(0.0087, 0.0087, 0.03, SEG, 0.03, true);
    const root = K.assemble({
      name: 'ptg_b', scale: 2.8,   // 真实注射器十来厘米，放大才看得出是针筒
      solid,
      labels: [[label, K.labelMat('ptg_b', 256, 64, drawLabel)]],
      glass: [[barrel, 0xe1eef5, 0.35]],
    });
    // 放倒：针筒轴线转到水平，抬高一个针筒半径贴地
    root.children.forEach(m => {
      m.geometry.rotateZ(Math.PI / 2);
      m.geometry.translate(0.045, 0.012, 0);
    });
    return root;
  },
  use(player) {
    K.sound('click');
    const fx = BR.effects;
    const conv = fx && typeof fx.get === 'function' ? fx.get(PTG_A_KEY) : null;
    if (!conv) {
      K.toast('注射了 PTG-B。身上没有派对客转化，什么也没发生');
      return true;
    }
    // "转化时间越长，PTG-B 逆转效果越有限"：逆转成功率 = 1 − 转化进度
    const progress = conv.total > 0 ? Math.min(1, conv.elapsed / conv.total) : 1;
    if (K.rand() < 1 - progress) {
      fx.remove(PTG_A_KEY);
      K.toast('PTG-B 起效了，转化被逆转');
    } else {
      K.toast('太晚了，PTG-B 没能逆转转化');
    }
    return true;
  },
});
})();
