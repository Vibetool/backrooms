// 皇家口粮 Royal Rations（Object 16）
// 来源版本：wikidot-cn（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki-cn.wikidot.com/object-16
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（Fandom 的白灰明胶、一天一茶匙，wikidot-en Level 3 的"稀有报酬"不借）：
//   · 外观：石蜡块状，软、胶状，表面光滑有棱角；固定 9 × 6 × 3 cm，正好握在手心；无味，室温下微凉；包装和标志页面没提
//   · 效果：任何分量都能完全满足营养需求，一整份省着吃能撑几个月；吃下有强烈欣快感，被说成神仙吃的东西；
//     极易成瘾，尝过一次的人几年后还会想吃；会让人对别的食物没兴趣，长期列入口粮会让配给失控、引发争执和暴力；对伤病的作用没提
//   · 极其稀有，出现地点没规律，常在很不起眼的角落；同站 Level 3 页称储量丰富
// 未实现：配给失控引发的争执和暴力（本游戏没有 NPC 群体/配给系统）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] royal_rations 需要先加载 js/items/_kit.js'); return; }

// "一整份省着吃能撑几个月"：一块分 90 口，按设定里一天吃一口算正好 3 个月
const BITES = 90;
// "只尝过一次的人几年后还会想吃"：成瘾标记持续设定 2 年（本局内等于一直在）；
// 期间"对别的食物没兴趣"——其他食物回的饥饿打五折（_kit.js apply 里按这个 key 处理）
const CRAVING = { key: K.CRAVING_KEY, seconds: K.LORE_HOUR * 24 * 365 * 2, negative: false, tags: ['addiction'] };

BR.itemTypes.register({
  type: 'royal_rations', en: 'Royal Rations', zh: '皇家口粮', version: 'wikidot-cn',
  category: 'food',
  stack: 3,
  desc: '一块 9×6×3 厘米、像石蜡一样的软胶块，没有气味，摸着微凉。',
  bites: BITES,
  icon: K.icon((g, h) => {
    // 斜 45° 看的一块长方体：顶面、正面、侧面三种明暗
    h.poly(g, [[8, 30], [34, 18], [58, 28], [32, 40]], '#fbf5e2', 'rgba(120,110,80,0.6)');
    h.poly(g, [[8, 30], [32, 40], [32, 54], [8, 44]], '#e6dcbc', 'rgba(120,110,80,0.6)');
    h.poly(g, [[32, 40], [58, 28], [58, 42], [32, 54]], '#d4c8a2', 'rgba(120,110,80,0.6)');
    g.fillStyle = 'rgba(255,255,255,0.7)';
    h.poly(g, [[18, 29], [34, 22], [42, 25], [26, 32]], 'rgba(255,255,255,0.55)');
  }),
  // hungerSet 100 —— "任何分量都能完全满足营养需求"：一口就把饥饿吃满
  // sanity +40   —— "吃下有强烈的欣快感，被形容为神仙吃的东西"
  // timed CRAVING —— 见上
  effect: { hungerSet: 100, sanity: 40, timed: [CRAVING] },
  build() {
    const T = window.THREE;
    // 9 × 3 × 6 cm 平放；石蜡般的哑光实体 + 一层很淡的半透明外壳做出"软胶"的润感
    return K.assemble({
      name: 'royal_rations', scale: 1.8,
      shiny: [K.paint(K.box(0.09, 0.03, 0.06, 0, 0), 0xeee4c4)],
      glass: [[new T.BoxGeometry(0.093, 0.033, 0.063).translate(0, 0.015, 0), 0xfff8e0, 0.25]],
    });
  },
  use(player) {
    K.apply(player, this);
    K.sound('eat');
    const done = K.portion(player, 'royal_rations', BITES);
    const slot = player.inventory[player.selected];
    const left = !done && slot && slot.left > 0 ? slot.left : 0;
    K.toast(left ? '咬了一小口，一股说不出的幸福感涌上来（这块还能吃 ' + left + ' 口）' : '吃完了最后一口。已经开始想念它了', 2600);
    return done;
  },
});
})();
