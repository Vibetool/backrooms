// 示范实体（友善）：BR.arch 向导骨架 + 发光球构件的标准写法。不对应任何设定版本，只给实体代理照着抄结构；上线前删除（同 _dev_*）。
// 演示：跟着玩家、带去最近的补给、主动攻击玩家附近的有害实体（游玩模式里的"守护者"观感）、按状态换颜色（每实例材质）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

const CALM = 0x9ff0e0, ANGRY = 0xffc46b;

A.register({
  type: '_demo_guide', en: 'Demo Guide', zh: '示范·向导', version: 'demo',
  faction: 'friendly',

  hp: A.HP.sturdy,                                    // 100：和测试人一样经打
  radius: 0.25, height: 1.5,                          // 碰撞按小球算；height 决定视线起点（e.y + 0.9h），和飞行高度大致对齐
  speed: { walk: A.SPEED.brisk, run: A.SPEED.run },   // 带路比玩家步行略慢，玩家跟得上
  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.normal, fov: 360 },
  // 友善实体从不打玩家和测试人（entities.js 阵营规则），hp 只是占位；打实体用 entityHp
  attack: { hp: 0, entityHp: A.DAMAGE.medium, range: 1.3, cooldown: A.COOLDOWN.normal },
  sounds: { attack: 'buzz' },
  corpseSec: 1.2,

  brain: A.guide({ followDist: 2.5, leadDist: 4, leadTo: 'items', engage: true, leash: 12 }),
  anim: {
    gait: 'none',
    fly: { cruise: 1.5, low: 1.15, bob: 0.12, clearance: 0.3 },   // 飘在胸口高度，扑向敌人时稍微降低
    fall: 'drop', pulse: 0.12,
    stateSounds: { guard: 'click' },
    // onFrame 跟着降频走；按状态换色 —— 客机也有 e.state，所以两端颜色一致
    onFrame(e, dt, api, u) {
      const orb = u.orb;
      if (!orb) return;
      const want = e.state === 'guard' || e.state === 'attack' ? ANGRY : CALM;
      if (orb.coreMat.color.getHex() !== want) { orb.coreMat.color.setHex(want); orb.haloMat.color.setHex(want); }
    },
  },

  build(ctx) {
    // own: true —— 每实例一份材质（标 entityOwned，移除时释放），换色才不会把所有向导一起染了
    return A.wrap(A.parts.orb({ radius: 0.09, color: CALM, halo: 0.8, own: true }), { label: '_demo_guide' });
  },
});
})();
