// 测试人：测试模式里召唤的假人。阵营 dummy —— 有害实体会打它，友善实体不理它，它从不还手。
// 穿玩家当前皮肤的后室制服（hazmat.glb + BR.skin.apply）；没有模型时用程序化胶囊体兜底
(function () {
'use strict';
const BR = window.BR;

const HEIGHT = 1.8;
const LEAN = 0.3;            // 挨打后仰角度（弧度）
const HIT_SEC = 0.35;        // 后仰 + 闪红持续
const FALL_SEC = 0.55;       // 倒地动作时长
const CORPSE_SEC = 3;        // 倒地后保留多久再移除
const LIE_LIFT = 0.2;        // 躺平时抬高一点，别让半个身子陷进地板
const FLASH_HEX = 0xff2a2a;

// ---------- 兜底模型：胶囊体身子 + 头罩 + 防毒面具 + 靴子 ----------
let geo = null;
function fallbackGeo(T) {
  if (geo) return geo;
  const merge = T.BufferGeometryUtils && T.BufferGeometryUtils.mergeBufferGeometries;
  // r139+ 才有 CapsuleGeometry，r147 有；保险起见没有就用圆柱
  const body = T.CapsuleGeometry
    ? new T.CapsuleGeometry(0.25, 0.8, 4, 10).translate(0, 0.77, 0)    // 0.12–1.42 m
    : new T.CylinderGeometry(0.25, 0.25, 1.3, 10).translate(0, 0.77, 0);
  const hood = new T.SphereGeometry(0.19, 12, 8).translate(0, 1.58, 0);  // 顶到 1.77 m
  const mask = new T.BoxGeometry(0.26, 0.2, 0.12).translate(0, 1.55, -0.15);
  const filter = new T.CylinderGeometry(0.06, 0.07, 0.1, 10).rotateX(Math.PI / 2).translate(0, 1.47, -0.25);
  const bootL = new T.BoxGeometry(0.16, 0.14, 0.28).translate(-0.11, 0.07, -0.03);
  const bootR = new T.BoxGeometry(0.16, 0.14, 0.28).translate(0.11, 0.07, -0.03);
  geo = {
    suit: merge ? [merge([body, hood])] : [body, hood],
    mask: merge ? [merge([mask, filter])] : [mask, filter],
    boots: merge ? [merge([bootL, bootR])] : [bootL, bootR],
  };
  return geo;
}

function sharedMat(key, make) {
  return BR.assets && typeof BR.assets.material === 'function' ? BR.assets.material(key, make) : make();
}

function fallbackModel(T) {
  const g = fallbackGeo(T);
  const root = new T.Group();
  // 防化服材质命名 'Suit' 并标 userData.suit，BR.skin.apply 两种查找方式都能命中
  const suitMat = sharedMat('test_dummy/suit', () => {
    const m = new T.MeshLambertMaterial({ color: 0xd8b21f });
    m.name = 'Suit';
    return m;
  });
  const maskMat = sharedMat('test_dummy/mask', () => new T.MeshLambertMaterial({ color: 0x1d1d1f }));
  const bootMat = sharedMat('test_dummy/boot', () => new T.MeshLambertMaterial({ color: 0x141414 }));
  for (const x of g.suit) { const m = new T.Mesh(x, suitMat); m.userData.suit = true; root.add(m); }
  for (const x of g.mask) root.add(new T.Mesh(x, maskMat));
  for (const x of g.boots) root.add(new T.Mesh(x, bootMat));
  return root;
}

// GLB 的尺寸和原点不一定规范：缩放到 1.8 m，脚底放到原点、水平居中
function fitModel(T, model) {
  const box = new T.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (!(h > 0.05) || !isFinite(h)) return;
  if (Math.abs(HEIGHT / h - 1) > 0.03) {
    model.scale.multiplyScalar(HEIGHT / h);
    box.setFromObject(model);
  }
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.y -= box.min.y;
  model.position.z -= (box.min.z + box.max.z) / 2;
}

// 闪红要改材质，每个测试人各拷一份（标 entityOwned，移除时由 entities.js 释放）；
// 必须在 skin.apply 之后拷，拷的是已经上好色的防化服
function ownMaterials(root) {
  const map = new Map();
  const list = [];
  const one = m => {
    if (!map.has(m)) {
      const c = m.clone();
      c.userData = Object.assign({}, c.userData, {
        entityOwned: true,
        em0: c.emissive ? c.emissive.getHex() : null,
        col0: c.color ? c.color.getHex() : null,
      });
      map.set(m, c);
      list.push(c);
    }
    return map.get(m);
  };
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  return list;
}

let flashColor = null;
function setFlash(T, mats, k) {
  if (!flashColor) flashColor = new T.Color(FLASH_HEX);
  for (const m of mats) {
    const u = m.userData;
    if (m.emissive && u.em0 !== null) m.emissive.setHex(u.em0).lerp(flashColor, k * 0.85);
    else if (m.color && u.col0 !== null) m.color.setHex(u.col0).lerp(flashColor, k * 0.6);   // MeshBasic 没有 emissive
  }
}

BR.entityTypes.register({
  type: 'test_dummy', en: 'Test Dummy', zh: '测试人', version: 'test',
  faction: 'dummy',
  hp: 100, radius: 0.3, height: HEIGHT,
  // 玩家步行速度的一半（用户定死）
  speed: { walk: BR.config.player.walk * 0.5, run: BR.config.player.walk * 0.5 },
  perception: { sight: 0, hearing: 0, fov: 360 },

  build(ctx) {
    const T = ctx.THREE;
    let model = BR.assets && typeof BR.assets.modelSync === 'function' ? BR.assets.modelSync('hazmat') : null;
    if (model) fitModel(T, model);
    else model = fallbackModel(T);
    if (BR.skin && typeof BR.skin.apply === 'function') {
      try { BR.skin.apply(model); } catch (err) { console.warn('[test_dummy] 皮肤上色失败', err); }
    }
    const mats = ownMaterials(model);
    // 后仰、倒地转的是这个枢轴（原点在脚底），根节点的位置和 yaw 归 entities.js 管
    const pivot = new T.Group();
    pivot.add(model);
    const root = new T.Group();
    root.add(pivot);
    root.userData.dummy = { pivot, mats, flash: 0, deadAt: null, phase: 0, lx: NaN, lz: NaN };
    return root;
  },

  // 随机游走：wander 隔几秒换方向、撞墙换向
  think(e, dt, api) {
    e.state = api.wander(e, BR.config.player.walk * 0.5) ? 'walk' : 'idle';
  },

  // 倒地 3 秒后由 entities.js 移除并发 entity:kill
  onDeath() { return CORPSE_SEC; },

  animate(e, dt, api) {
    const u = e.obj && e.obj.userData.dummy;
    if (!u) return;
    const T = typeof THREE !== 'undefined' ? THREE : null;
    const now = api.time;
    let lean = 0, lift = 0, flash = 0;

    if (e.state === 'dead') {
      if (u.deadAt === null) u.deadAt = now;
      const k = Math.min(1, (now - u.deadAt) / FALL_SEC);
      lean = Math.PI / 2 * k * k;          // 越倒越快，像被推倒而不是慢慢躺下
      lift = LIE_LIFT * k;
      flash = Math.max(0, 1 - (now - u.deadAt) / 0.4);
    } else {
      const since = now - e.hitAt;
      if (since >= 0 && since < HIT_SEC) {
        const k = since / HIT_SEC;
        lean = LEAN * Math.sin(Math.PI * k);   // 面朝 -Z，绕 X 轴正转 = 头往后仰
        flash = 1 - k;
      }
      // 走动时轻微起伏，客机上靠位置变化判断
      const moved = Number.isFinite(u.lx) ? Math.hypot(e.x - u.lx, e.z - u.lz) : 0;
      if (moved > 1e-4) u.phase += dt * 9;
      lift = Math.abs(Math.sin(u.phase)) * 0.025;
    }
    u.lx = e.x; u.lz = e.z;
    u.pivot.rotation.x = lean;
    u.pivot.position.y = lift;
    // 只在闪烁值变化时改材质
    if (T && (flash > 0 || u.flash > 0)) { setFlash(T, u.mats, flash); u.flash = flash; }
  },
});
})();
