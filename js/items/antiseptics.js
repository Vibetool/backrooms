// 消毒剂、肥皂、手消毒液 Antiseptics, soap, hand sanitizer
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/level-1
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版：
//   · 外观没写，只在 Level 1 板条箱的物资清单里列了消毒剂和其他"清洁"用品（比如肥皂、洗手液）
//   · 用途（据已落盘的层级调研，引自页面脚注）：预防 Staphylococcus liminalis（阈限葡萄球菌）或爬菌感染
// 外观取舍：外观没写 → 按清单里的"洗手液"画成一只按压瓶（半透明浅青色液体、白色压头、写着消毒的标签）。
// 效果：本游戏还没有感染系统。约定——感染类时效效果在 BR.effects 里带 tag 'infection'（由实体/层级作者添加），
//   用消毒剂会把它们清掉，阻止感染发展下去。页面没写防护能维持多久，所以不做持续的"免疫"时间。无 hp/饥饿/san 数值。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] antiseptics 需要先加载 js/items/_kit.js'); return; }

const SEG = 12;
const BODY = [[0, 0.002], [0.026, 0], [0.032, 0.008], [0.032, 0.1], [0.026, 0.118], [0.012, 0.126], [0.012, 0.13]];

function drawLabel(g, w, h) {
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2, lw = w / 2;
    g.fillStyle = '#ffffff';
    g.fillRect(x, 0, lw, h);
    g.fillStyle = '#2e9a5a';
    g.fillRect(x, 0, lw, 12);
    g.fillRect(x + lw / 2 - 9, 22, 18, 50);
    g.fillRect(x + lw / 2 - 25, 38, 50, 18);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 26px "Arial Black", Arial, sans-serif';
    g.fillStyle = '#1f6e40';
    g.fillText('ANTISEPTIC', x + lw / 2, 96, lw - 16);
    g.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = '#333333';
    g.fillText('消毒洗手液', x + lw / 2, 118, lw - 16);
  }
}

BR.itemTypes.register({
  type: 'antiseptics', en: 'Antiseptic', zh: '消毒洗手液', version: 'wikidot-en',
  category: 'medical',
  stack: 5,
  desc: '板条箱里的清洁用品，一瓶按压式消毒洗手液。',
  icon: K.icon((g, h) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(29, 6, 6, 10);
    g.fillRect(24, 3, 22, 5);
    g.fillRect(44, 3, 9, 3);
    h.fillRR(g, 26, 15, 12, 6, 1, '#f4f4f4', 'rgba(80,80,80,0.5)');
    h.fillRR(g, 17, 20, 30, 41, 7, 'rgba(160,220,220,0.95)', 'rgba(40,90,90,0.7)');
    g.fillStyle = '#ffffff';
    g.fillRect(19, 30, 26, 22);
    g.fillStyle = '#2e9a5a';
    g.fillRect(30, 32, 4, 13);
    g.fillRect(26, 36.5, 12, 4);
    h.text(g, '消毒', 32, 49, 6, '#1f6e40');
  }),
  // 无 hp/饥饿/san 数值；clearTags infection —— "预防阈限葡萄球菌或爬菌感染"：清掉身上带感染标记的效果
  effect: { clearTags: ['infection'] },
  build() {
    const T = window.THREE;
    return K.assemble({
      name: 'antiseptics', scale: 1.4,
      solid: [
        K.paint(K.lathe(BODY, SEG), 0xa6dcdc),
        K.paint(K.cyl(0.015, 0.015, 0.012, SEG, 0.13), 0xf4f4f4),
        K.paint(K.cyl(0.0045, 0.0045, 0.02, 8, 0.142, true), 0xf4f4f4),
        K.paint(new T.BoxGeometry(0.034, 0.012, 0.02).translate(0.006, 0.168, 0), 0xf4f4f4),
        K.paint(new T.BoxGeometry(0.02, 0.006, 0.007).translate(0.032, 0.166, 0), 0xf4f4f4),
      ],
      labels: [[K.cyl(0.0326, 0.0326, 0.068, SEG, 0.018, true), K.labelMat('antiseptics', 512, 128, drawLabel)]],
    });
  },
  use: K.simpleUse('click', '用消毒洗手液仔细搓了搓手'),
});
})();
