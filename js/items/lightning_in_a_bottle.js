// 瓶装闪电 Lightning In a Bottle（Object 42）
// 来源版本：wikidot-en（data/lore-choices.json 里随机选中）
// URL：https://backrooms-wiki.wikidot.com/object-42
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定。
// 只用这一版（wikidot-cn Level 3 的"储量丰富"、约 10 万焦耳等不借）：
//   · 外观：玻璃容器（烧瓶、葡萄酒瓶等）+ 软木塞；普通玻璃却能装住能量不碎；瓶里的闪电高速流动、很亮
//   · 三种：蓝色（最常见，亮蓝、最亮）；人工闪电（较暗、颜色偏暗）；黑色闪电（黑色，只有一点微光）
//   · 效果：不是喝的。打开后电流会去找最近的导体。蓝色打到人通常致命、偶尔有人活下来，常被当武器；
//     人工闪电威力弱、很少当武器（约为蓝色的十分之一）；黑色估计是蓝色的十倍，优先打活物、行为反常、会随机爆炸，不建议用
//   · 稀有度 7/10，大多数层级都有但很少
// 注册 3 个类型：lightning_in_a_bottle（蓝色，最常见的标准款）、lightning_in_a_bottle_artificial、lightning_in_a_bottle_black。
// 游戏里的用法：使用 = 朝前方扔出去摔开 → 闪电从落点去找目标。玩家自己也是导体：附近没有比你更近的实体，就打你（噩梦生存才扣血）。
// 随机数调用顺序（测试依赖）：黑色先掷"是否爆炸"再掷"打谁"；蓝色打到玩家时掷"是否致命"。
(function () {
'use strict';
const BR = window.BR;
const K = BR.itemKit;
if (!K) { console.error('[items] lightning_in_a_bottle 需要先加载 js/items/_kit.js'); return; }

const THROW = 8;              // 扔出去的最远距离（米）
// 蓝色 = 基准威力：打实体 1000 点（"打到人通常致命"，大多数实体一下就死）
const BLUE_ENTITY = 1000;
// 蓝色打到玩家："通常致命、偶尔有人活下来" → 85% 当场打死，否则掉 90 血
const BLUE_PLAYER = 90;
const BLUE_LETHAL_CHANCE = 0.85;
// 黑色："优先打活物" → 在落点 12 米内的活物里挑；"行为反常" → 随机挑一个而不是最近的；"会随机爆炸" → 35% 顺带在落点炸开
const BLACK_SEEK = 12;
const BLACK_EXPLODE_CHANCE = 0.35;
const BLACK_EXPLODE_RADIUS = 4;

const SEG = 12;
const FLASK = [[0, 0], [0.03, 0.006], [0.045, 0.03], [0.048, 0.055], [0.042, 0.08], [0.026, 0.1], [0.013, 0.112], [0.013, 0.17], [0.016, 0.175]];
const ZIG = [[-0.02, 0.088], [0.012, 0.07], [-0.01, 0.054], [0.018, 0.036], [-0.004, 0.016]];

const VARIANTS = [
  {
    type: 'lightning_in_a_bottle', en: 'Lightning In a Bottle (Blue)', zh: '瓶装闪电（蓝色）',
    bolt: 0xbff4ff, halo: 0x3fb8ff, haloOp: 0.4, boltCss: '#9eeaff', haloCss: 'rgba(63,184,255,0.55)', flash: '#bfefff', peak: 0.55,
    desc: '软木塞封着的烧瓶，里面一道亮蓝色的闪电在飞快地乱窜。',
    // 蓝色是基准：打实体 1000，打玩家 85% 致命否则 90
    strike: { kind: 'blue', entityDamage: BLUE_ENTITY, playerDamage: BLUE_PLAYER, playerLethalChance: BLUE_LETHAL_CHANCE },
  },
  {
    type: 'lightning_in_a_bottle_artificial', en: 'Lightning In a Bottle (Artificial)', zh: '瓶装闪电（人工）',
    bolt: 0x7d88a8, halo: 0x4a5270, haloOp: 0.3, boltCss: '#8793b5', haloCss: 'rgba(74,82,112,0.45)', flash: '#8a94b0', peak: 0.3,
    desc: '烧瓶里的闪电颜色发暗，亮度也差一些。',
    // "约为蓝色的十分之一"：实体 100，玩家 9，打到人不会当场致命
    strike: { kind: 'artificial', entityDamage: BLUE_ENTITY / 10, playerDamage: BLUE_PLAYER / 10, playerLethalChance: 0 },
  },
  {
    type: 'lightning_in_a_bottle_black', en: 'Lightning In a Bottle (Black)', zh: '瓶装闪电（黑色）',
    bolt: 0x07070b, halo: 0x3b2f66, haloOp: 0.3, boltCss: '#0b0b10', haloCss: 'rgba(70,55,120,0.4)', flash: '#000000', peak: 0.7,
    desc: '烧瓶里是一道黑色的闪电，只透出一点点微光。',
    // "估计是蓝色的十倍"：实体 10000，打到玩家必死
    strike: { kind: 'black', entityDamage: BLUE_ENTITY * 10, playerDamage: BLUE_PLAYER * 10, playerLethalChance: 1,
      seek: BLACK_SEEK, explodeChance: BLACK_EXPLODE_CHANCE, explodeRadius: BLACK_EXPLODE_RADIUS },
  },
];

function boltGeo(rotY) {
  const T = window.THREE;
  const parts = [];
  for (let i = 0; i < ZIG.length - 1; i++) {
    const a = ZIG[i], b = ZIG[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const g = new T.BoxGeometry(0.006, len + 0.004, 0.006);
    g.rotateZ(Math.atan2(-dx, dy));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    g.rotateY(rotY);
    parts.push(g);
  }
  return parts;
}

function hitPlayer(player, v) {
  const s = v.strike;
  let dmg = s.playerDamage;
  if (s.playerLethalChance > 0 && K.rand() < s.playerLethalChance) dmg = Math.max(dmg, player.hp + 1);
  K.hurt(player, dmg, '被瓶装闪电电死', 'item:' + v.type);
}

function strike(player, v) {
  const s = v.strike;
  const pt = K.throwPoint(player, THROW);
  const from = { x: pt.x, y: pt.y + 0.3, z: pt.z };
  const pd = Math.hypot(player.x - pt.x, player.z - pt.z);
  const ents = K.livingEntities()
    .map(e => ({ e, d: Math.hypot(e.x - pt.x, e.z - pt.z) }))
    .sort((a, b) => a.d - b.d);
  let target = null;   // { e } 或 { player: true }
  if (s.kind === 'black') {
    if (K.rand() < s.explodeChance) {
      for (const it of ents) if (it.d < s.explodeRadius) K.damageEntity(it.e, s.entityDamage);
      if (pd < s.explodeRadius) K.hurt(player, s.playerDamage, '被黑色瓶装闪电的爆炸炸死', 'item:' + v.type);
      K.burstFx(pt.x, pt.y, pt.z, 0x2a2244, s.explodeRadius, 0.6);
    }
    const pool = ents.filter(it => it.d <= s.seek && !it.e.dead && !it.e.removed).map(it => ({ e: it.e }));
    if (pd <= s.seek && !player.dead) pool.push({ player: true });
    if (pool.length) target = pool[Math.min(pool.length - 1, Math.floor(K.rand() * pool.length))];
  } else {
    // 电流去找离落点最近的导体：实体或者玩家自己
    const near = ents.find(it => !it.e.dead && !it.e.removed);
    target = near && near.d < pd ? { e: near.e } : { player: true };
  }
  if (target && target.e) {
    K.damageEntity(target.e, s.entityDamage);
    K.boltFx(from, { x: target.e.x, y: K.num(target.e.y, pt.y) + 1, z: target.e.z }, v.bolt === 0x07070b ? 0x1a1a24 : v.bolt, 0.35);
  } else if (target && target.player) {
    hitPlayer(player, v);
    K.boltFx(from, { x: player.x, y: player.y - 0.5, z: player.z }, v.bolt === 0x07070b ? 0x1a1a24 : v.bolt, 0.35);
  }
  if (BR.gfx && typeof BR.gfx.flash === 'function') BR.gfx.flash(v.flash, 0.5, v.peak);
  K.sound('hit');
  return target;
}

VARIANTS.forEach((v) => {
  BR.itemTypes.register({
    type: v.type, en: v.en, zh: v.zh, version: 'wikidot-en',
    category: 'hazard',
    stack: 3,
    desc: v.desc,
    strike: v.strike,
    icon: K.icon((g, h) => {
      g.fillStyle = '#b98a55';
      g.fillRect(28, 3, 9, 9);
      const body = () => {
        g.beginPath();
        g.moveTo(28, 11); g.lineTo(36, 11); g.lineTo(36, 26);
        g.bezierCurveTo(56, 32, 56, 61, 32, 61);
        g.bezierCurveTo(8, 61, 8, 32, 28, 26);
        g.closePath();
      };
      g.save();
      body();
      g.clip();
      g.fillStyle = 'rgba(215,235,245,0.35)';
      g.fillRect(0, 0, 64, 64);
      const halo = g.createRadialGradient(32, 45, 1, 32, 45, 18);
      halo.addColorStop(0, v.haloCss);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = v.boltCss;
      g.lineWidth = 3;
      g.lineJoin = 'miter';
      g.beginPath();
      g.moveTo(26, 30); g.lineTo(37, 40); g.lineTo(27, 46); g.lineTo(39, 57);
      g.stroke();
      g.restore();
      body();
      g.strokeStyle = 'rgba(60,80,100,0.7)';
      g.lineWidth = 1.5;
      g.stroke();
    }),
    effect: {},
    build() {
      const T = window.THREE;
      const root = K.assemble({
        name: v.type, scale: 1.6,
        solid: [K.paint(K.cyl(0.0145, 0.0125, 0.025, 8, 0.162), 0xb98a55)],
        glow: [
          [K.merge(boltGeo(0).concat(boltGeo(Math.PI / 2))), v.bolt],
          [new T.IcosahedronGeometry(0.03, 0).translate(0, 0.05, 0), v.halo, v.haloOp],
        ],
        glass: [[K.lathe(FLASK, SEG), 0xd7ebf5, 0.3]],
      });
      return root;
    },
    use(player) {
      const t = strike(player, v);
      K.toast(t && t.player ? '瓶子摔开，闪电朝你打了过来！' : '瓶子摔开，闪电劈了出去');
      return true;
    },
  });
});
})();
