// 抗生素 Antibiotics
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-14
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：调研结论是 wikidot-en 的 Level 14 页根本没提到抗生素（unverified），外观、效果、稀有度都没有。
//   → 按规则"选中版本没写的就不做"：不加任何数值效果、不在任何层级随机刷（data/item-spawn.json 里 per1000m2 = 0）。
//   模型只按物品名画成"一瓶抗生素胶囊"：琥珀色药瓶、白盖、白标签红字，瓶里看得见红白胶囊。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] antibiotics 需要先加载 js/items/_kit.js'); return; }

const SEG = 12;

// 胶囊两半两种颜色：按局部 y 的正负分色，再摆位置
function capsule(x, y, z, rotZ, rotY) {
  const T = window.THREE;
  const g = new T.CapsuleGeometry(0.0055, 0.014, 1, 6);
  const pos = g.attributes.position;
  const a = K.col(0xc8322c), b = K.col(0xf2f2f2);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) >= 0 ? a : b;
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(arr, 3));
  g.rotateZ(rotZ);
  g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    g.fillStyle = '#fbfbf7';
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#c8322c';
    g.fillRect(x + 10, 12, 26, 26);
    g.fillStyle = '#ffffff';
    g.fillRect(x + 20, 16, 6, 18);
    g.fillRect(x + 14, 22, 18, 6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 28px "Arial Black", Arial, sans-serif';
    g.fillStyle = '#b02a24';
    g.fillText('ANTIBIOTICS', x + lw / 2 + 14, 28, lw - 60);
    g.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = '#333333';
    g.fillText('抗生素 · 胶囊', x + lw / 2, h * 0.72, lw - 20);
  }
}

BR.itemTypes.register({
  type: 'antibiotics', en: 'Antibiotics', zh: '抗生素', version: 'wikidot-en',
  category: 'medical',
  stack: 5,
  desc: '一瓶抗生素胶囊。',
  icon: K.icon((g, h) => {
    h.fillRR(g, 17, 6, 30, 12, 3, '#f4f4f4', 'rgba(80,80,80,0.6)');
    h.fillRR(g, 18, 17, 28, 44, 4, h.cylGrad(g, 18, 28, '#d98f35', '#a45f16'), 'rgba(90,50,10,0.7)');
    // 瓶里的胶囊
    [[24, 21, 0.5], [36, 22, -0.4], [26, 56, -0.3], [38, 55, 0.6]].forEach(c => {
      g.save(); g.translate(c[0], c[1]); g.rotate(c[2]);
      h.fillRR(g, -5, -2.5, 5, 5, 2.5, '#c8322c'); h.fillRR(g, 0, -2.5, 5, 5, 2.5, '#f2f2f2');
      g.restore();
    });
    g.fillStyle = '#fbfbf7';
    g.fillRect(18, 28, 28, 22);
    g.fillStyle = '#c8322c';
    g.fillRect(21, 31, 7, 7);
    h.text(g, 'ABX', 36, 43, 8, '#b02a24');
  }),
  // 选中版本没写效果 → 无数值
  effect: {},
  build() {
    return K.assemble({
      name: 'antibiotics', scale: 1.5,
      solid: [
        K.paint(K.cyl(0.0305, 0.0305, 0.022, SEG, 0.075), 0xf4f4f4),
        capsule(0.01, 0.012, 0.004, 1.2, 0.3),
        capsule(-0.011, 0.012, -0.006, 1.4, 1.9),
        capsule(0.004, 0.064, 0.012, 1.1, 2.6),
        capsule(-0.008, 0.066, -0.01, 0.4, 0.8),
      ],
      labels: [[K.cyl(0.0286, 0.0286, 0.04, SEG, 0.02, true), K.labelMat('antibiotics', 512, 128, drawLabel)]],
      glass: [[K.cyl(0.028, 0.028, 0.075, SEG, 0, true), 0xc9822a, 0.6], [new window.THREE.CircleGeometry(0.028, SEG).rotateX(Math.PI / 2).translate(0, 0.001, 0), 0x8a5418, 0.8]],
    });
  },
  use: K.simpleUse('click', '吞了一粒抗生素'),
});
})();
