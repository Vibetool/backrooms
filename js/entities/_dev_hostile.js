// 开发测试用：有害色块实体（红方块 + 发光眼睛），用来测阵营战斗、索敌、追击。上线前删除
(function () {
'use strict';
const BR = window.BR;

// 几何和材质全体实例共用：entities.js 移除实体时不释放没标 entityOwned 的资源
let parts = null;
function getParts(T) {
  if (parts) return parts;
  const body = new T.BoxGeometry(0.8, 1.6, 0.8).translate(0, 0.8, 0);
  const eyeL = new T.BoxGeometry(0.16, 0.08, 0.04).translate(-0.18, 1.32, -0.42);
  const eyeR = new T.BoxGeometry(0.16, 0.08, 0.04).translate(0.18, 1.32, -0.42);
  const merge = T.BufferGeometryUtils && T.BufferGeometryUtils.mergeBufferGeometries;
  const eyes = merge ? merge([eyeL, eyeR]) : null;   // 两只眼合成一个几何，少一次 draw call
  const mat = (key, make) => (BR.assets && typeof BR.assets.material === 'function' ? BR.assets.material(key, make) : make());
  parts = {
    body,
    eyes: eyes ? [eyes] : [eyeL, eyeR],
    bodyMat: mat('_dev_hostile/body', () => new T.MeshLambertMaterial({ color: 0xa31a1a })),
    // 不受光照、不吃雾：暗处和雾里也能先看见两点黄光
    eyeMat: mat('_dev_hostile/eye', () => new T.MeshBasicMaterial({ color: 0xfff27a, fog: false })),
  };
  return parts;
}

BR.entityTypes.register({
  type: '_dev_hostile', en: 'Dev Hostile', zh: '测试红块', version: 'dev',
  faction: 'hostile',
  hp: 60, radius: 0.4, height: 1.6,
  speed: { walk: 1.2, run: 3.2 },
  perception: { sight: 16, hearing: 10, fov: 360, needsLight: false, avoidsLight: false },
  attack: { hp: 15, sanity: 5, range: 1.1, cooldown: 1.2 },
  aura: { radius: 6, sanityPerSec: 0.3 },
  sounds: { alert: 'growl', attack: 'hit' },

  build(ctx) {
    const T = ctx.THREE;
    const p = getParts(T);
    const root = new T.Group();
    root.add(new T.Mesh(p.body, p.bodyMat));
    for (const g of p.eyes) root.add(new T.Mesh(g, p.eyeMat));
    return root;
  },

  // 追最近的可攻击目标近战；没有目标就游荡
  think(e, dt, api) {
    const def = e.def;
    const t = api.findTarget(e);
    if (!t) {
      e.state = 'wander';
      api.wander(e, def.speed.walk);
      return;
    }
    const reach = def.attack.range + (t.kind === 'player' ? BR.config.player.radius : t.ref.r || 0.4);
    // 够得着：冷却中就原地等；出手失败（隔着墙）就继续往前挤
    if (t.dist <= reach && (e.cooldown > 0 || api.attack(e, t))) {
      e.state = 'attack';
      api.faceToward(e, t.ref.x, t.ref.z);
      return;
    }
    e.state = 'chase';
    api.moveToward(e, t.x, t.z, def.speed.run);
  },
});
})();
