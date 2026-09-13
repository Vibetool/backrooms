// 开发测试用：友善色块实体（绿方块），在出生点附近巡逻，看到有害实体就主动去打。上线前删除
(function () {
'use strict';
const BR = window.BR;

const PATROL_MIN = 2, PATROL_MAX = 8;   // 巡逻点离出生点的距离
const WAYPOINT_SEC = 4;                 // 这么久还没走到（被墙挡住）就换下一个点

let parts = null;
function getParts(T) {
  if (parts) return parts;
  const mat = (key, make) => (BR.assets && typeof BR.assets.material === 'function' ? BR.assets.material(key, make) : make());
  parts = {
    body: new T.BoxGeometry(0.7, 1.5, 0.7).translate(0, 0.75, 0),
    // 正面一条浅色横条，看得出朝向
    face: new T.BoxGeometry(0.5, 0.1, 0.04).translate(0, 1.2, -0.37),
    bodyMat: mat('_dev_friendly/body', () => new T.MeshLambertMaterial({ color: 0x2f9e45 })),
    faceMat: mat('_dev_friendly/face', () => new T.MeshLambertMaterial({ color: 0xd8f5d0 })),
  };
  return parts;
}

function pickWaypoint(e, api) {
  const d = e.data;
  const a = api.rng() * Math.PI * 2;
  const r = PATROL_MIN + api.rng() * (PATROL_MAX - PATROL_MIN);
  d.wpX = d.homeX + Math.cos(a) * r;
  d.wpZ = d.homeZ + Math.sin(a) * r;
  d.wpT = WAYPOINT_SEC + api.rng() * 3;
}

BR.entityTypes.register({
  type: '_dev_friendly', en: 'Dev Friendly', zh: '测试绿块', version: 'dev',
  faction: 'friendly',
  hp: 80, radius: 0.35, height: 1.5,
  speed: { walk: 1.4, run: 3.4 },
  perception: { sight: 18, hearing: 12, fov: 360, needsLight: false, avoidsLight: false },
  attack: { hp: 20, sanity: 0, range: 1.2, cooldown: 1.0 },
  sounds: { attack: 'hit' },

  build(ctx) {
    const T = ctx.THREE;
    const p = getParts(T);
    const root = new T.Group();
    root.add(new T.Mesh(p.body, p.bodyMat));
    root.add(new T.Mesh(p.face, p.faceMat));
    return root;
  },

  think(e, dt, api) {
    const def = e.def, d = e.data;
    if (d.homeX === undefined) { d.homeX = e.x; d.homeZ = e.z; pickWaypoint(e, api); }

    // findTarget 对友善实体只会返回有害实体（阵营规则在 entities.js）
    const t = api.findTarget(e);
    if (t) {
      const reach = def.attack.range + (t.ref.r || 0.4);
      if (t.dist <= reach && (e.cooldown > 0 || api.attack(e, t))) {
        e.state = 'attack';
        api.faceToward(e, t.ref.x, t.ref.z);
        return;
      }
      e.state = 'chase';
      api.moveToward(e, t.x, t.z, def.speed.run);
      return;
    }

    e.state = 'patrol';
    d.wpT -= dt;
    if (api.moveToward(e, d.wpX, d.wpZ, def.speed.walk) || d.wpT <= 0) pickWaypoint(e, api);
  },
});
})();
