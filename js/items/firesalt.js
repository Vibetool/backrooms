// 火盐 Firesalt（Object 15），别名余烬晶体 Cinder Crystal
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://web.archive.org/web/20251116092928/https://backrooms.fandom.com/wiki/Object_15
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（wikidot 的"小晶体只烧伤、100 g 以上才爆"、层级角落自然生长等一律不借）：
//   · 外观：一直发光的异常晶体，恒温约 500°C，非常脆；本页没写颜色，同站 Liquid Pain 页说是红橙色、高度易燃
//   · 效果：受钝击裂开时撞击点冒火花、连锁反应，剧烈爆炸，多数小晶体威力相当于一颗手雷；
//     对笑魇和大多数实体都是非常有效的武器；还能取暖、快速煮熟食物、做火盐手电、磨粉炼火钢
//   · 评级：实用 3/5，风险 3/5；高温又易燃易爆，拿着就有风险
// 游戏里的用法：使用 = 朝前方扔出去砸碎 → 落点爆炸（撞墙就在墙前炸）。离得太近连自己一起炸（只在噩梦生存扣血）。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] firesalt 需要先加载 js/items/_kit.js'); return; }

// "威力相当于一颗手雷"：手雷的杀伤半径按 5 米算，伤害从中心线性衰减到边缘为 0
const RADIUS = 5;
// 扔出去的最远距离（米）：比爆炸半径远一截，空旷处正常投掷不会炸到自己
const THROW = 8;
// "对笑魇和大多数实体都是非常有效的武器"：中心 150 点，足够炸死大多数实体
const ENTITY_DAMAGE = 150;
// 手雷级爆炸对人：中心 100 点 = 满血也能炸死
const PLAYER_DAMAGE = 100;

function shard(x, z, h, r, tiltX, tiltZ, rotY) {
  const g = new window.THREE.OctahedronGeometry(1, 0);
  g.scale(r, h / 2, r);
  g.translate(0, h * 0.45, 0);   // 底尖稍微插进"地面"，看起来是一簇立着的晶体
  g.rotateZ(tiltZ);
  g.rotateX(tiltX);
  g.rotateY(rotY);
  g.translate(x, 0, z);
  return g;
}

function explode(player, pt) {
  let hits = 0;
  for (const e of K.livingEntities()) {
    const d = Math.hypot(e.x - pt.x, e.z - pt.z);
    if (d >= RADIUS) continue;
    if (K.damageEntity(e, ENTITY_DAMAGE * (1 - d / RADIUS))) hits++;
  }
  const pd = Math.hypot(player.x - pt.x, player.z - pt.z);
  if (pd < RADIUS) K.hurt(player, PLAYER_DAMAGE * (1 - pd / RADIUS), '被火盐爆炸炸死', 'item:firesalt');
  K.burstFx(pt.x, pt.y, pt.z, 0xff7a1a, RADIUS, 0.5);
  if (BR.gfx && typeof BR.gfx.flash === 'function') BR.gfx.flash('#ff8a2a', 0.5, 0.35);
  K.sound('hit');
  return hits;
}

BR.itemTypes.register({
  type: 'firesalt', en: 'Firesalt', zh: '火盐', version: 'fandom',
  category: 'hazard',
  stack: 5,
  desc: '一直在发光、摸着滚烫的红橙色晶体，很脆。砸碎会炸。',
  blast: { radius: RADIUS, throw: THROW, entityDamage: ENTITY_DAMAGE, playerDamage: PLAYER_DAMAGE },
  icon: K.icon((g, h) => {
    const glow = g.createRadialGradient(32, 38, 2, 32, 38, 28);
    glow.addColorStop(0, 'rgba(255,170,60,0.75)');
    glow.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 64, 64);
    h.poly(g, [[30, 58], [22, 30], [30, 8], [38, 30]], '#ff5a1a', '#8a2006');
    h.poly(g, [[24, 58], [12, 40], [14, 26], [26, 44]], '#e8481a', '#8a2006');
    h.poly(g, [[38, 58], [40, 36], [52, 22], [50, 44]], '#ff6a24', '#8a2006');
    h.poly(g, [[30, 50], [27, 32], [31, 16], [34, 32]], '#ffc466');
    h.poly(g, [[42, 52], [44, 38], [48, 32], [47, 44]], '#ffb347');
  }),
  effect: {},
  build() {
    const T = window.THREE;
    const outer = K.merge([
      shard(0.012, 0.006, 0.12, 0.022, 0.25, -0.35, 0.3),
      shard(-0.024, 0.01, 0.09, 0.02, -0.2, 0.55, 1.1),
      shard(0.004, -0.026, 0.1, 0.019, 0.5, 0.1, 2.0),
      shard(0.028, 0.024, 0.07, 0.016, -0.4, -0.6, 0.7),
    ]);
    const core = K.merge([
      shard(0, 0, 0.15, 0.018, 0, 0, 0.5),
      shard(-0.012, -0.012, 0.06, 0.012, 0.3, 0.3, 1.4),
    ]);
    const outerMat = K.mat('firesalt:outer', () => new T.MeshPhongMaterial({
      color: K.col(0xff5a1a), emissive: K.col(0xb8330a), specular: 0xffd0a0, shininess: 80, flatShading: true,
    }));
    const coreMat = K.mat('firesalt:core', () => new T.MeshPhongMaterial({
      color: K.col(0xffb347), emissive: K.col(0xff8c1a), specular: 0xffffff, shininess: 90, flatShading: true,
    }));
    const root = new T.Group();
    root.name = 'firesalt';
    root.add(new T.Mesh(outer, outerMat));
    root.add(new T.Mesh(core, coreMat));
    // "一直在发光"：一圈半透明的暖光
    root.add(new T.Mesh(new T.IcosahedronGeometry(0.075, 1).translate(0, 0.06, 0), K.glowMat(0xff7a2a, 0.16)));
    root.scale.setScalar(1.3);
    return root;
  },
  use(player) {
    const pt = K.throwPoint(player, THROW);
    explode(player, pt);
    K.toast('火盐砸碎了，炸开一团火花');
    return true;
  },
});
})();
