// 糖果 Candy（Object 5）
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/object-5
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（wikidot-cn 的"手臂变枪"、噎住风险、Level 3 储量丰富等不借）：
//   · 外观：B.N.T.G. 批量生产，一磅一袋，袋里每颗单独包装；页面有包装图但没写颜色尺寸
//   · 品种（各自形状包装不同）和效果，都持续几个小时：
//     银舌头——说服力变强；子弹巧克力——暂时没有触觉；小金属枪——手指变成能射巧克力子弹的枪；
//     纸片人——人和随身物品变成二维，贴到最近的平面上；有害废料——口水带腐蚀性，严重伤牙齿牙龈；
//     天才糖——只是让人以为自己变聪明；杏仁薄荷——只能清新口气
//   · 页面没提对饥饿或伤病的作用；主要危险是会成瘾
//   · 在 Level 11 初生城和商人之家的 B.N.T.G. 市场有卖，5 学分一磅
// 游戏里：一袋是一种品种（拆开才知道是哪种，随机），使用 = 吃掉这袋里的糖，效果持续设定 3 小时 = 180 秒。
// 本游戏没有说服、触觉、射击系统：银舌头/子弹巧克力/小金属枪/天才糖只挂一个标记效果（给以后的交易/战斗系统读），不改任何数值。
// 未实现：成瘾（页面没写成瘾的具体表现）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] candy 需要先加载 js/items/_kit.js'); return; }

// "效果持续几小时"：取设定 3 小时
const HOURS = 3 * K.LORE_HOUR;

const VARIETIES = [
  { key: 'silver_tongue', zh: '银舌头', toast: '是银舌头糖：说起话来格外有说服力',
    timed: { key: 'candy_silver_tongue', seconds: HOURS, negative: false, tags: ['candy'] } },
  { key: 'bullet_chocolate', zh: '子弹巧克力', toast: '是子弹巧克力：手上什么都摸不出来了',
    timed: { key: 'candy_numb', seconds: HOURS, negative: false, tags: ['candy'] } },
  { key: 'little_metal_gun', zh: '小金属枪', toast: '是小金属枪：手指变成了能射巧克力子弹的枪',
    timed: { key: 'candy_finger_gun', seconds: HOURS, negative: false, tags: ['candy'] } },
  // "变成二维、贴到最近的平面上"：贴在地面上动不了（移速 ×0，所有模式生效），画面被压扁
  { key: 'paper_man', zh: '纸片人', toast: '是纸片人糖：整个人变成了二维，贴在地面上动不了',
    timed: { key: 'candy_paper_man', seconds: HOURS, speedMul: 0, visual: { flatten: 0.6 }, tags: ['candy'] } },
  // "口水带腐蚀性，严重伤牙齿牙龈"：每秒掉 0.1 血，180 秒共 18 点（噩梦生存才掉）
  { key: 'hazardous_waste', zh: '有害废料', toast: '是有害废料糖：口水开始腐蚀牙齿和牙龈',
    timed: { key: 'candy_hazardous_waste', seconds: HOURS, hpPerSec: -0.1, cause: '有害废料糖的口水烂穿了口腔', tags: ['candy'] } },
  { key: 'genius', zh: '天才糖', toast: '是天才糖：你觉得自己聪明多了（其实没有）',
    timed: { key: 'candy_genius', seconds: HOURS, negative: false, tags: ['candy'] } },
  // "只能清新口气"：没有任何效果
  { key: 'almond_mint', zh: '杏仁薄荷糖', toast: '是杏仁薄荷糖：口气清新', timed: null },
];

function drawBag(g, w, h) {
  g.fillStyle = '#f7f1e3';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f4e5f';
  g.fillRect(0, 0, w, 64);
  g.fillRect(0, h - 40, w, 40);
  g.fillStyle = '#f4c542';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 34px "Arial Black", Arial, sans-serif';
  g.fillText('B.N.T.G.', w / 2, 34);
  g.fillStyle = '#ffffff';
  g.font = 'bold 20px "Arial Black", Arial, sans-serif';
  g.fillText('CANDY · 1 LB', w / 2, h - 20);
  // 袋面上画几种糖：银色、子弹、小枪、纸片人、辐射标、灯泡、薄荷
  const wrap = (x, y, c) => {
    g.fillStyle = c;
    g.beginPath(); g.ellipse(x, y, 16, 11, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x - 28, y - 9); g.lineTo(x - 28, y + 9); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 14, y); g.lineTo(x + 28, y - 9); g.lineTo(x + 28, y + 9); g.closePath(); g.fill();
  };
  wrap(60, 100, '#c0c4cc');
  wrap(190, 96, '#8fd6b0');
  g.fillStyle = '#6b3a1a';
  g.beginPath(); g.moveTo(112, 150); g.lineTo(112, 122); g.quadraticCurveTo(122, 104, 132, 122); g.lineTo(132, 150); g.closePath(); g.fill();
  g.fillStyle = '#5a5f66';
  g.fillRect(40, 150, 40, 12); g.fillRect(40, 150, 12, 26);
  g.strokeStyle = '#333333'; g.lineWidth = 4;
  g.beginPath(); g.arc(196, 150, 8, 0, Math.PI * 2); g.moveTo(196, 158); g.lineTo(196, 182); g.moveTo(182, 168); g.lineTo(210, 168); g.stroke();
  g.fillStyle = '#e3c21a';
  g.beginPath(); g.arc(72, 215, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222222';
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; g.beginPath(); g.moveTo(72, 215); g.arc(72, 215, 15, a, a + 0.7); g.closePath(); g.fill(); }
  g.fillStyle = '#fff3a0';
  g.beginPath(); g.arc(180, 212, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9a9a9a'; g.fillRect(173, 226, 14, 10);
  g.fillStyle = '#1f4e5f';
  g.font = 'bold 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('糖果', w / 2, 262);
}

// 单颗包装糖：糖身 + 两头拧起来的包装纸
function wrapped(x, z, hex, rotY) {
  const T = window.THREE;
  const body = new T.SphereGeometry(0.012, 6, 4).scale(1.3, 0.8, 1);
  const l = new T.ConeGeometry(0.009, 0.014, 6).rotateZ(Math.PI / 2).translate(0.021, 0, 0);
  const r = new T.ConeGeometry(0.009, 0.014, 6).rotateZ(-Math.PI / 2).translate(-0.021, 0, 0);
  return [body, l, r].map(g => K.paint(g.rotateY(rotY).translate(x, 0.01, z), hex));
}

BR.itemTypes.register({
  type: 'candy', en: 'Candy (1 lb bag)', zh: '糖果（一磅装）', version: 'wikidot-en',
  category: 'food',
  stack: 5,
  desc: 'B.N.T.G. 出的一磅装糖果，每颗单独包装。不拆开不知道是哪一种。',
  varieties: VARIETIES,
  lastVariety: null,
  icon: K.icon((g, h) => {
    h.poly(g, [[14, 12], [50, 12], [52, 58], [12, 58]], '#f7f1e3', 'rgba(40,60,70,0.8)');
    g.fillStyle = '#1f4e5f';
    g.fillRect(14, 12, 36, 12);
    g.fillRect(12.5, 51, 39, 7);
    g.fillStyle = '#9fb3ba';
    for (let x = 15; x < 50; x += 4) g.fillRect(x, 9, 2, 4);
    h.text(g, 'BNTG', 32, 18.5, 8, '#f4c542');
    h.ell(g, 24, 33, 5, 3.5, '#c0c4cc');
    h.ell(g, 39, 31, 5, 3.5, '#8fd6b0');
    h.ell(g, 31, 43, 4, 4, '#e3c21a');
    // 袋外一颗包装糖
    h.ell(g, 50, 55, 6, 4, '#d94f4f', 'rgba(80,20,20,0.7)');
    h.poly(g, [[44, 55], [38, 51], [38, 59]], '#d94f4f');
    h.poly(g, [[56, 55], [62, 51], [62, 59]], '#d94f4f');
  }),
  effect: {},
  build() {
    const T = window.THREE;
    const W = 0.11, HGT = 0.15, D = 0.03;
    // 枕形包装袋：盒子中间一圈顶点往外鼓
    const bag = new T.BoxGeometry(W, HGT, D, 2, 3, 1);
    const pos = bag.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = (1 - Math.abs(x) / (W / 2) * 0.8) * (1 - Math.abs(y) / (HGT / 2) * 0.7);
      pos.setZ(i, z + Math.sign(z) * 0.012 * k);
    }
    bag.computeVertexNormals();
    bag.translate(0, HGT / 2 + 0.006, 0);
    const solid = [
      K.paint(K.box(W + 0.002, 0.012, D * 0.5, 0, HGT + 0.001), 0x9fb3ba),   // 顶部压花封口
      K.paint(K.box(W + 0.002, 0.008, D * 0.5, 0, 0.002), 0x9fb3ba),         // 底部封口
    ].concat(wrapped(0.085, 0.02, 0xd94f4f, 0.4), wrapped(-0.08, -0.015, 0xc0c4cc, -0.9));
    return K.assemble({
      name: 'candy', scale: 1.25,
      solid,
      labels: [[bag, K.labelMat('candy_bag', 256, 288, drawBag)]],
    });
  },
  use() {
    const i = Math.min(VARIETIES.length - 1, Math.floor(K.rand() * VARIETIES.length));
    const v = VARIETIES[i];
    if (v.timed && BR.effects && typeof BR.effects.add === 'function') BR.effects.add(Object.assign({}, v.timed));
    this.lastVariety = v.key;
    K.sound('eat');
    K.toast('拆开袋子吃了几颗——' + v.toast, 2800);
    return true;
  },
});
})();
