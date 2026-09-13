// 飞蛾果冻 Moth Jelly（Object 6，别名 Queen Moth Jelly / Royal Jelly）
// 来源版本：fandom（only-source：wikidot 两站都没有这个物品；中文译名 unverified）
// URL：https://web.archive.org/web/20260117131606/https://backrooms.fandom.com/wiki/Object_6
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
//   · 外观：紫色胶状物，稠度像稍稀的蜂蜜；散落在各层的是瓶装或罐装，常贴着「Property of Royal Jelly Farms™」贴纸和紫色皇冠标志
//   · 效果：营养数一数二（高蛋白、营养素、天然糖），饱腹时间长，当天力气、精力、耐力都明显提升；一杯能一整天不渴；
//     大幅改善心情、重燃求生欲，常被当抗抑郁药；吃下约 5–6 分钟内雄性死亡飞蛾会被吸引并保护你，雌性完全无视你
//   · 过量：超过每日建议量（1–2 杯）就上瘾；还会视线模糊、强烈欣快、止不住傻笑，可能长畸胎瘤
//   · 极其稀有、价值极高（一罐约值 4 瓶杏仁水）；死亡飞蛾多的层级都有；瓶罐装的也少量散落在没有死亡飞蛾的层级；
//     同站 Level 17 页：偶尔出现在装修更奢华的舱室里
// 未实现：死亡飞蛾的保护/无视（死亡飞蛾实体还没做——这里只挂 'moth_pheromone' 标记给实体作者读）；
//   成瘾后冒险去巢里找、畸胎瘤、做菜和飞蛾蜡烛（本游戏没有这些系统）；"饱腹时间长""一整天不渴"没给出可换算的量，只体现在饥饿回复量上。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] moth_jelly 需要先加载 js/items/_kit.js'); return; }

const DAY = 24 * K.LORE_HOUR;
// "当天力气、精力、耐力都明显提升"：移速 ×1.15，持续设定一天
const ENERGY = { key: 'moth_jelly_energy', seconds: DAY, speedMul: 1.15 };
// "吃下后约 5–6 分钟内"雄性死亡飞蛾保护、雌性无视：设定 5.5 分钟 = 5.5 秒的信息素标记
const PHEROMONE = { key: 'moth_pheromone', seconds: 5.5 / 60 * K.LORE_HOUR, negative: false, tags: ['pheromone'] };
// "每日建议量 1–2 杯"：设定一天内吃第 3 份起算过量
const DAILY_LIMIT = 2;
// 过量："视线模糊、强烈欣快、止不住傻笑" → 画面扭曲，持续设定 1 小时（页面没写多久）
const OVERDOSE = { key: 'moth_jelly_overdose', seconds: K.LORE_HOUR, negative: true, visual: { distort: 0.35 }, tags: ['mental'] };

function drawSticker(g, w, h) {
  g.fillStyle = '#fbf8ff';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#6b2fa0';
  g.lineWidth = 6;
  g.strokeRect(6, 6, w - 12, h - 12);
  // 紫色皇冠
  g.fillStyle = '#6b2fa0';
  g.beginPath();
  g.moveTo(w / 2 - 34, 62); g.lineTo(w / 2 - 34, 26); g.lineTo(w / 2 - 17, 44); g.lineTo(w / 2, 18);
  g.lineTo(w / 2 + 17, 44); g.lineTo(w / 2 + 34, 26); g.lineTo(w / 2 + 34, 62);
  g.closePath();
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 15px Georgia, serif';
  g.fillText('Property of', w / 2, 82);
  g.font = 'bold 22px Georgia, serif';
  g.fillText('Royal Jelly', w / 2, 104);
  g.font = 'bold 17px Georgia, serif';
  g.fillText('Farms™', w / 2, 124);
}

BR.itemTypes.register({
  type: 'moth_jelly', en: 'Moth Jelly', zh: '飞蛾果冻', version: 'fandom',
  category: 'food',
  stack: 3,
  desc: '一罐紫色的胶状物，像稍稀一点的蜂蜜。罐子上贴着 Royal Jelly Farms 的皇冠贴纸。',
  dailyLimit: DAILY_LIMIT,
  icon: K.icon((g, h) => {
    h.fillRR(g, 14, 8, 36, 10, 3, h.cylGrad(g, 14, 36, '#d8dbe2', '#9ea3ab'), 'rgba(60,60,70,0.6)');
    h.fillRR(g, 12, 17, 40, 44, 7, 'rgba(210,225,235,0.5)', 'rgba(60,60,80,0.6)');
    h.fillRR(g, 14, 22, 36, 37, 5, '#6b2fa0');
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(17, 25, 3, 28);
    h.fillRR(g, 21, 30, 22, 20, 3, '#fbf8ff', '#6b2fa0');
    h.poly(g, [[25, 44], [25, 34], [29, 38], [32, 32], [35, 38], [39, 34], [39, 44]], '#6b2fa0');
  }),
  // hunger +60  —— "营养在后室数一数二、饱腹时间长"
  // sanity +40  —— "大幅改善心情、重新燃起求生欲，常被当抗抑郁药"
  // ENERGY / PHEROMONE 见上
  effect: { hunger: 60, sanity: 40, timed: [ENERGY, PHEROMONE] },
  build() {
    const T = window.THREE;
    const SEG = 12;
    const sticker = new T.CylinderGeometry(0.0405, 0.0405, 0.036, SEG, 1, true, -0.8, 1.6).translate(0, 0.04, 0);
    return K.assemble({
      name: 'moth_jelly', scale: 1.4,
      solid: [K.paint(K.cyl(0.037, 0.037, 0.066, SEG, 0.003), 0x6b2fa0)],
      shiny: [K.paint(K.cyl(0.0375, 0.0375, 0.014, SEG, 0.082), 0xbfc3ca)],
      labels: [[sticker, K.labelMat('moth_jelly_sticker', 128, 140, drawSticker)]],
      glass: [[K.lathe([[0, 0], [0.036, 0.002], [0.04, 0.01], [0.04, 0.07], [0.035, 0.08], [0.035, 0.084]], SEG), 0xdce8f0, 0.28]],
    });
  },
  use(player) {
    K.apply(player, this);
    K.sound('eat');
    // 设定一天内吃了几份：记在一个不影响数值的计数效果上，一天后自动清零
    const fx = BR.effects;
    let n = 1;
    if (fx && typeof fx.get === 'function') {
      const day = fx.get('moth_jelly_daily');
      n = day ? (day.data.count | 0) + 1 : 1;
      if (!day) fx.add({ key: 'moth_jelly_daily', seconds: DAY, negative: false, data: { count: n } });
      else day.data.count = n;
      if (n > DAILY_LIMIT) fx.add(Object.assign({}, OVERDOSE));
    }
    K.toast(n > DAILY_LIMIT ? '吃太多了……视线开始模糊，止不住地傻笑' : '甜得像蓝莓拌蜂蜜，后味有薰衣草香。浑身都有劲了', 2600);
    return true;
  },
});
})();
