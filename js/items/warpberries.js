// 迁跃浆果 Warpberries（Object 74）
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/object-74
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（wikidot-cn 的普通纸箱、分布在 Level 1/2 不借）：
//   · 外观：看起来吃起来都像前厅的草莓，带籽；装在盒子里，一盒原本 7 颗；颜色大小没另外写；永远不会烂
//   · 效果：吃下立刻穿过地板，被传送回这批浆果最初被发现的地方（在 Level 2 以外吃，会被拉回 Level 2）；
//     页面没提传送持续多久，也没提对饥饿、精神、身体的影响或副作用
//   · 同站 Level 1 页：可以用来逃出必死的局面，但里面的化学物质会让人在新到的层级困很久，只能当最后手段
// 游戏里："最初被发现的地方" = 拾取时所在的层级和位置，记在背包格上（同一格里合并的盒子沿用第一盒的地点）。
// 无 hp/饥饿/san 数值（页面明确没提）。
// 未实现：Level 1 页说的"在新层级被困很久"——需要层级出口配合封锁，world.js 不归本文件管；且与物品页本身的描述不一致。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] warpberries 需要先加载 js/items/_kit.js'); return; }

// "一盒原本有 7 颗"：一盒分 7 次吃完
const PER_BOX = 7;

function berry(x, z, tilt, rotY) {
  const T = window.THREE;
  const body = new T.ConeGeometry(0.011, 0.022, 6).rotateX(Math.PI);   // 尖朝下的草莓
  const calyx = new T.CircleGeometry(0.009, 5).rotateX(-Math.PI / 2).translate(0, 0.0112, 0);
  return [K.paint(body, 0xd62a2a), K.paint(calyx, 0x3f8f3a)].map(g => g.rotateZ(tilt).rotateY(rotY).translate(x, 0.028, z));
}

// 捡起来时记下"最初被发现的地方"
BR.bus.on('item:pickup', (p) => {
  const pl = BR.player;
  if (!p || p.type !== 'warpberries' || !pl || !pl.inventory) return;
  const here = { levelId: String(BR.game.levelId), x: pl.x, z: pl.z };
  for (const s of pl.inventory) if (s && s.type === 'warpberries' && !s.origin) s.origin = here;
});

function warp(player, o) {
  // "吃下后立刻穿过地板"：眼前一黑
  if (BR.gfx && typeof BR.gfx.flash === 'function') BR.gfx.flash('#000000', 0.9, 1);
  const yaw = player.yaw;
  if (String(BR.game.levelId) === o.levelId || !BR.world || typeof BR.world.goTo !== 'function') {
    player.reset({ x: o.x, y: 0, z: o.z, yaw }, { full: false });
    K.toast('脚下一空，你穿过地板，回到了发现这盒浆果的地方', 2600);
    return;
  }
  K.toast('脚下一空，你穿过了地板……', 2600);
  BR.world.goTo(o.levelId, { kind: 'noclip' }).then((ok) => {
    if (ok && BR.player) BR.player.reset({ x: o.x, y: 0, z: o.z, yaw }, { full: false });
  });
}

BR.itemTypes.register({
  type: 'warpberries', en: 'Warpberries', zh: '迁跃浆果', version: 'wikidot-en',
  category: 'food',
  stack: 5,
  desc: '一盒像草莓的浆果，一直很新鲜。',
  perBox: PER_BOX,
  icon: K.icon((g, h) => {
    h.poly(g, [[6, 34], [58, 34], [54, 60], [10, 60]], '#c9a46a', 'rgba(90,60,30,0.8)');
    const b = (x, y, r) => {
      h.poly(g, [[x - r, y - r * 0.4], [x + r, y - r * 0.4], [x, y + r * 1.3]], '#d62a2a', 'rgba(110,10,10,0.6)');
      g.fillStyle = '#ffe27a';
      [[-0.4, 0.1], [0.35, 0.05], [0, 0.55], [-0.15, -0.1], [0.2, 0.4]].forEach(s => g.fillRect(x + s[0] * r, y + s[1] * r, 1.4, 1.4));
      h.poly(g, [[x - r * 0.8, y - r * 0.45], [x, y - r * 1.05], [x + r * 0.8, y - r * 0.45]], '#3f8f3a');
    };
    b(18, 26, 8); b(34, 22, 9); b(48, 27, 8); b(26, 36, 7); b(42, 37, 7);
    g.fillStyle = '#b48c52';
    g.fillRect(8, 40, 48, 3);
  }),
  effect: {},
  build() {
    const W = 0.09, D = 0.06, H = 0.032, t = 0.003;
    const kraft = 0xc9a46a;
    const solid = [
      K.paint(K.box(W, t, D, 0, 0), 0xb48c52),
      K.paint(K.box(W, H, t, 0, 0, D / 2), kraft), K.paint(K.box(W, H, t, 0, 0, -D / 2), kraft),
      K.paint(K.box(t, H, D, W / 2, 0, 0), kraft), K.paint(K.box(t, H, D, -W / 2, 0, 0), kraft),
    ];
    const spots = [[-0.03, -0.014, 0.3, 0.2], [-0.01, -0.016, -0.2, 1.3], [0.011, -0.013, 0.25, 2.2], [0.031, -0.015, -0.3, 0.7],
      [-0.02, 0.014, 0.2, 1.8], [0, 0.016, -0.25, 2.9], [0.021, 0.013, 0.3, 0.4]];
    for (const s of spots) solid.push(...berry(s[0], s[1], s[2], s[3]));
    return K.assemble({ name: 'warpberries', scale: 2.0, solid });
  },
  use(player) {
    const slot = player.inventory[player.selected];
    const origin = slot && slot.origin ? Object.assign({}, slot.origin) : null;
    K.sound('eat');
    const done = K.portion(player, 'warpberries', PER_BOX);
    if (!origin) {
      K.toast('吃了一颗浆果，什么也没发生');
      return done;
    }
    warp(player, origin);
    return done;
  },
});
})();
