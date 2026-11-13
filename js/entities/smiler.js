// 笑魇 Smiler（Entity III: Smilers）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_3  许可：CC BY-SA 3.0
// 阵营/数值/攻击/怕光逻辑仍只按 fandom 版本实现，不从 wikidot-en/cn（「驱笑剂退散」「身体肉眼不可见」
// 「Smiling Room 基地」等）借细节（WAVE2.md 第1节）。
// 外观与移动方式改按用户指定覆盖 fandom 原文的「无定形类人黑焰剪影 + 群猎巡逻」：
// 见 data/lore-choices.json → entities.smiler.userOverride，用户原话（2026-09-13）：
// 「笑脸不是他真正的样子。笑脸真正的样子就是一个漂浮的白色的笑脸，在道路中间穿梭，
//   他背后都黑黑的，什么也看不清。」
// 下面 build() 的模型、brain 的巡逻部分按这段原话实现；faction/hp/speed/perception/attack/sounds
// 与惧光的 lightBound 修饰（fandom「可见光照到会像疼痛般退缩」）维持不变，因为新形象不影响这些数值。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

function has(o, k) { return !!o && typeof o[k] === 'function'; }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const TAU = Math.PI * 2;

// ---------- 巡逻：沿走廊/通道中线穿梭 ----------
// 用户原话「在道路中间穿梭」：普通巡逻骨架（A.stalker/A.pack 的 patrol='wander'|'home'）只会在
// 出生点附近随机漫走，不管墙在哪，所以这里自己写巡逻部分：环视一圈找最开阔的方向（多数情况下就是
// 走廊延伸的方向），给「跟上次方向接近」加分以避免路口反复掉头；再往左右探墙，把落点拉回两侧墙的
// 正中间，让实体贴着中线走而不是贴墙蹭。发现目标/追击/攻击/丢失后搜索仍是常见的追猎者流程
// （抄 A.stalker 的状态机结构，只是把它的 patrol() 换成下面这个）。
const SCAN_N = 10;          // 环视采样方向数
const SCAN_RANGE = 15;      // 每个方向探多远算「开阔」（米）
const SIDE_RANGE = 5;       // 探测左右墙距离的上限（米）
const WP_MIN = 2.2, WP_MAX = 4.2;   // 每次落点放在前方多远（米），按探到的开阔距离裁剪
const REDECIDE = 3.5;       // 到点或超时后最快多久重新环视一次（秒），避免每帧都做射线，也避免走一步拐一次

function probe(e, y, dx, dz, max) {
  if (!has(BR.phys, 'raycast')) return max;
  const hit = BR.phys.raycast(e.x, y, e.z, dx, 0, dz, max);
  return hit ? hit.dist : max;
}

function corridorPatrol(e, api, a, o) {
  const now = api.time;
  if (a.homeX === undefined) { a.homeX = e.x; a.homeZ = e.z; }
  const sp = A.speedOf(e, 'walk', o.patrolSpeed);
  const y = e.y + 1.2;   // 走廊墙从地面到天花板都是墙，探测高度只要不贴地/贴顶就行
  const arrived = a.wpX === undefined || Math.hypot(e.x - a.wpX, e.z - a.wpZ) < 0.5;
  if (arrived || now > (a.wpUntil || 0)) {
    let bestAng = a.headAng != null ? a.headAng : api.rng() * TAU;
    let bestScore = -Infinity, bestOpen = SCAN_RANGE;
    const off = api.rng() * (TAU / SCAN_N);
    for (let i = 0; i < SCAN_N; i++) {
      const ang = off + i / SCAN_N * TAU;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const open = probe(e, y, dx, dz, SCAN_RANGE);
      // 继续同方向的加分：没有这一项，在十字路口每次都会挑到分数并列的不同方向，来回抖头
      const cont = a.headAng != null ? Math.cos(ang - a.headAng) * 3 : 0;
      const score = open + cont;
      if (score > bestScore) { bestScore = score; bestAng = ang; bestOpen = open; }
    }
    a.headAng = bestAng;
    const fx = Math.cos(bestAng), fz = Math.sin(bestAng);
    const rx = -fz, rz = fx;   // 前进方向的右手法线
    const dl = probe(e, y, -rx, -rz, SIDE_RANGE);
    const dr = probe(e, y, rx, rz, SIDE_RANGE);
    const center = clamp((dr - dl) * 0.5, -1.3, 1.3);   // 往窄的一侧的反方向修正，拉回正中
    const step = clamp(bestOpen - 1, WP_MIN, WP_MAX);
    let tx = e.x + fx * step + rx * center, tz = e.z + fz * step + rz * center;
    if (o.patrolRadius > 0 && Math.hypot(tx - a.homeX, tz - a.homeZ) > o.patrolRadius * 1.6) {
      tx = a.homeX; tz = a.homeZ; a.headAng = null;   // 飘太远了，找个方向往回收
    }
    a.wpX = tx; a.wpZ = tz;
    a.wpUntil = now + REDECIDE + api.rng() * 1.5;
  }
  api.moveToward(e, a.wpX, a.wpZ, sp);
  e.state = 'patrol';
}

// ---------- 行为：巡逻中线 → 发现（停顿）→ 追击 → 近战；丢失目标去最后位置搜索 ----------
// 结构照抄 A.stalker，只把 patrol 换成 corridorPatrol；其余（索敌/近战/搜索/被打记仇）用 5.11 的公共
// 小工具，跟 A.stalker 内部用的是同一套，行为不变。
const DRIFT = {
  sight: null, patrolRadius: 16, patrolSpeed: null, chaseSpeed: null, searchSpeed: null,
  alertSec: 0.5, searchSec: 6, investigate: true, canTarget: null, onAttack: null, alertCry: null,
};
function smilerDrift(opts) {
  const o = Object.assign({}, DRIFT, opts);
  function think(e, dt, api) {
    const a = A.state(e), now = api.time;
    const t = A.acquire(e, api, o);
    if (t) {
      if (a.mode !== 'chase' && a.mode !== 'alert') {
        a.mode = 'alert'; a.until = now + o.alertSec;
        if (o.alertCry) A.cry(e, o.alertCry, { cooldown: 4 });
      }
      a.lastX = t.x; a.lastZ = t.z; a.reached = false;
      if (a.mode === 'alert') {
        if (now < a.until && t.dist > A.reach(e, t)) { e.state = 'alert'; api.faceToward(e, t.x, t.z); return; }
        a.mode = 'chase';
      }
      // onAttack 作为 onLand 交给 A.melee：胳膊（脸）扑到最前、真打中那一刻才调（FE1P H11，entities.js「近战出手时机」）
      const m = A.melee(e, api, t, o.onAttack);
      if (m) return;
      e.state = 'chase';   // 用户原话「发现目标后逼近」
      api.moveToward(e, t.x, t.z, A.speedOf(e, 'run', o.chaseSpeed));
      return;
    }
    if (a.mode === 'chase' || a.mode === 'alert') { a.mode = 'search'; a.until = now + o.searchSec; a.reached = false; }
    if (a.hitFromAt != null && now - a.hitFromAt < 1) {
      a.hitFromAt = null; a.mode = 'search'; a.until = now + o.searchSec;
      a.lastX = a.hitFromX; a.lastZ = a.hitFromZ; a.reached = false;
    }
    if (a.mode === 'search') {
      if (now < a.until) { A.search(e, api, a, o); return; }
      a.mode = 'patrol';
    }
    if (api.game.attackPlayers && e.def.faction === 'hostile' && o.investigate) {
      const cue = A.hearPlayer(e, api);
      if (cue) { a.mode = 'search'; a.until = now + o.searchSec; a.lastX = cue.x; a.lastZ = cue.z; a.reached = false; A.search(e, api, a, o); return; }
    }
    corridorPatrol(e, api, a, o);   // 用户原话「巡逻时平滑漂移」
  }
  return {
    init(e) { const a = A.state(e); a.homeX = e.x; a.homeZ = e.z; a.mode = 'patrol'; },
    think,
    onHit(e, amount, attacker, api) {
      const a = A.state(e);
      const src = attacker === 'player' ? BR.player : attacker;
      if (src && Number.isFinite(src.x)) { a.hitFromX = src.x; a.hitFromZ = src.z; a.hitFromAt = api.time; }
    },
    dispose: A.disposeObj,
  };
}

// ---------- 模型：只有一张脸，没有身体 ----------
// 「没有可见身体：只有一张漂浮的白色笑脸」→ 不用 A.parts.humanoid/silhouette 等任何身体构件，
// 只放一个 A.parts.glowFace（发光眼+牙）和一个自制的黑色软边遮罩精灵（Sprite 自动一直面朝相机，
// 天然满足「从正面、侧面、背面看都黑黑的」，不需要额外写朝向相机的代码）。
const FACE_W = 0.62;   // 比正常人脸略大，撑出「大笑脸」的压迫感；用户没给具体尺寸，非设定精确数字

// 黑色径向渐变纹理：中心到约 60% 半径全不透明，往外软化到全透明。跟 A.mat.halo 用的是同一种画法，
// 只是颜色和混合方式反过来——halo 是「加法混合的白光」，这里要「正常混合的黑影」，halo 那份材质
// 用不了（加法混合的黑色等于什么都不画），自己起一张贴图、一份材质，仍然全走 BR.assets.material 缓存。
let shroudTex = null;
function shroudTexture() {
  if (shroudTex) return shroudTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.92)');
  grd.addColorStop(0.85, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  shroudTex = new THREE.CanvasTexture(c);
  shroudTex.needsUpdate = true;
  return shroudTex;
}
// M2 打磨新增：外面再罩一层更宽、落得更慢的黑 —— 打分员两人都写「黑色躯体是边缘规整的渐变椭圆」，
// 单层径向渐变收得太齐，两层叠起来边缘才有「由浓到无」的过渡层次。仍然只是黑影，不加任何身体轮廓
let shroudTexOuter = null;
function shroudTextureOuter() {
  if (shroudTexOuter) return shroudTexOuter;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  grd.addColorStop(0.75, 'rgba(0,0,0,0.26)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  shroudTexOuter = new THREE.CanvasTexture(c);
  shroudTexOuter.needsUpdate = true;
  return shroudTexOuter;
}
function spriteMaterial(key, texFn) {
  const make = () => new THREE.SpriteMaterial({
    map: texFn(), color: 0x000000, transparent: true, depthWrite: false, opacity: 1,
  });
  return BR.assets && typeof BR.assets.material === 'function' ? BR.assets.material(key, make) : make();
}
function shroudMaterial() { return spriteMaterial('smiler:shroud', shroudTexture); }
function shroudMaterialOuter() { return spriteMaterial('smiler:shroud2', shroudTextureOuter); }

// ---------- high 档的脸 ----------
// 打磨范围严格限制在用户指定的「漂浮的白色笑脸」之内：只加牙列厚度与牙缝、牙龈脊、眼窝层次，
// 不加任何身体、四肢或人形轮廓。几何按模块级缓存，全体笑魇共享一份（不在 build 里 new 材质）
let faceGeoHi = null, socketGeoHi = null;
// glowFace 的坑：smileWidth / curve / toothH / smileY 是米制绝对值，不是按 width 的倍数，
// 所以这里一律写成「FACE_W × 系数」算出来的绝对米数，和打磨前那次调用的写法保持一致
function faceGeometryHigh() {
  if (faceGeoHi) return faceGeoHi;
  const T = THREE, W = FACE_W, list = [];
  // 眼睛沿用 glowFace 的布局（外加眼角高光），牙不要它的——下面自己画才控制得了厚度和牙缝
  list.push(A.geo.glowFace({ width: W, eyes: 2, eyeShape: 'round', eyeSize: W * 0.1, eyeHighlight: true, smile: false }));
  const sw = W * 0.8, sy = -W * 0.14, cv = W * 0.16, th = W * 0.16, n = 16, tw = sw / n;
  const bow = u => -W * 0.07 * (1 - 4 * u * u);      // 齿列沿一条浅弧往前凸，侧面 / 三分面才看得出这是一排有厚度的牙
  const lipY = u => sy + cv * (4 * u * u - 0.5);     // 和打磨前 glowFace 的嘴角弧度公式一致
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    // 牙宽从占满 0.78 收到 0.66 → 牙缝明显变宽；Z 方向厚度从 W*0.02 加到 W*0.05 → 牙有实体感。
    // rotateY 只给很小的角度：第一轮用 atan(u*0.9)（嘴角快 42°）把角上几颗转成侧对镜头，
    // 加上厚度后互相叠在一起糊成一坨白，牙缝全没了，比打磨前还差
    const g = new T.BoxGeometry(tw * 0.66, th * (1 - 0.45 * Math.abs(2 * u)), W * 0.05);
    g.rotateZ(Math.atan(8 * cv * u / sw));
    g.rotateY(Math.atan(u * 0.3));                   // 跟着弧面微微转，够看出厚度又不会糊成一片
    list.push(g.translate(u * sw, lipY(u), bow(u)));
  }
  for (let k = 0; k < 7; k++) {                      // 牙龈脊：贴着牙齿上缘、跟着同一条弧走
    const u = (k + 0.5) / 7 - 0.5;
    const g = new T.BoxGeometry(sw / 7 * 1.04, th * 0.17, W * 0.04);
    g.rotateZ(Math.atan(8 * cv * u / sw));
    g.rotateY(Math.atan(u * 0.3));
    list.push(g.translate(u * sw, lipY(u) + th * 0.52, bow(u)));
  }
  faceGeoHi = T.BufferGeometryUtils.mergeBufferGeometries(list, false);
  return faceGeoHi;
}
// 眼窝：每只眼上方一道很淡的暗弧，退在脸后面一点 —— 做出「眼睛是凹进去的洞」的第二层次。
// 第一轮做成两圈同心的粗环，出图是一副圆眼镜；第二轮收成单圈仍然是一副圆眼镜（复评在 b1-after 的
// smiler-4-head 上又点了一次，确实还在）。根因不是粗细而是「闭合」：脸是纯黑底，mat.glow 是不受光的
// basic 材质，画上去的灰是比背景亮的描边，一旦闭合成圈，人眼先读到的就是镜框而不是眼眶。
// 所以这一轮改成开口弧：只留眼睛上缘那段（约 120°），宽度再砍一半，灰度从 0x53535a 压到接近背景，
// 只剩一道眉骨般的暗部暗示，凑不成环就不会再读成眼镜
function socketGeometryHigh() {
  if (socketGeoHi) return socketGeoHi;
  const T = THREE, W = FACE_W, list = [];
  const es = W * 0.1, gap = W * 0.42, ey = W * 0.18;   // 和 glowFace 缺省的眼间距 / 眼高一致
  for (const s of [-1, 1]) {
    list.push(new T.RingGeometry(es * 1.16, es * 1.27, 10, 1, Math.PI * 0.17, Math.PI * 0.66)
      .rotateY(Math.PI).translate(s * gap * 0.5, ey, 0.006));
  }
  socketGeoHi = T.BufferGeometryUtils.mergeBufferGeometries(list, false);
  return socketGeoHi;
}

function buildModel() {
  // 画质在建模这一刻定下来：low 档完全保持打磨前的构造（同一份 glowFace 缓存几何，面数逐字节不变）
  const hi = !(BR.game && BR.game.settings && BR.game.settings.quality === 'low');
  const group = new THREE.Group();

  // 外层软边（只有 high）：比内层大一圈、落得更慢，给「一团化不开的黑」加一层渐隐过渡
  if (hi) {
    const outer = new THREE.Sprite(shroudMaterialOuter());
    outer.scale.set(2.46, 3.4, 1);
    outer.position.set(0, -0.6, 0.1);
    outer.renderOrder = -1;
    outer.name = 'smilerShroudOuter';
    group.add(outer);
  }

  // 「笑脸周围和身后是一团浓黑」：软边黑精灵，比脸大一圈并往下拖一点（隐约像拖着一团影子），
  // renderOrder 排在脸之前，脸（不透明发光材质）会在它之上正常画出来，其余方向只看得到这团黑。
  // position.z 特意放在脸的正后方（局部 +Z，脸朝 -Z）：牙齿是有厚度的实心盒子，从正后方看会露出它背面
  // 那一点点厚度；把遮罩摆在比牙齿背面更靠后的位置，就能在不影响正面显示牙齿的前提下，把这点背面漏光也挡住
  const shroud = new THREE.Sprite(shroudMaterial());
  shroud.scale.set(2.3, 3.2, 1);
  shroud.position.set(0, -0.55, 0.06);
  shroud.renderOrder = 0;
  shroud.name = 'smilerShroud';
  group.add(shroud);

  // 「一排发光的白牙组成的大笑嘴 + 两只发光白眼」：用户说的是「一排」，取单排咧嘴（rows:1）比常见的
  // 上下两排牙更贴用户描述，也更像典型的"漂浮笑脸"形象。
  // anim.onFrame 靠名字 smilerFace 找这一坨做攻击时的放大，所以名字挂在整组上（high 档是两块网格）
  const face = new THREE.Group();
  face.name = 'smilerFace';
  if (hi) {
    const socket = new THREE.Mesh(socketGeometryHigh(), A.mat.glow(0x2b2b31));   // 压到接近背景黑，只当眼眶上缘的暗部暗示
    socket.renderOrder = 1;
    face.add(socket);
    const teeth = new THREE.Mesh(faceGeometryHigh(), A.mat.glow(0xffffff));
    teeth.renderOrder = 2;
    face.add(teeth);
  } else {
    const flat = A.parts.glowFace({
      width: FACE_W, eyes: 2, eyeShape: 'round', eyeSize: FACE_W * 0.1,
      smile: true, teeth: 16, rows: 1, toothH: FACE_W * 0.16, curve: FACE_W * 0.16,
      color: 0xffffff,
    });
    flat.renderOrder = 1;
    face.add(flat);
  }
  group.add(face);

  return A.wrap(group, { label: 'smiler', budget: A.TRIS.normal });
}

// ---------- 打坐在叉车上的人：脸扑过去（FE1R K6） ----------
// 脸（smilerFace 那一组）从悬浮的位置沿直线扑到落点：蓄力时往后缩 8 cm → 脸鼓到最大那一刻（STRIKE_PEAK）脸最前面的牙正好贴到
// 司机近侧身上最凸出来的那一点（entities.js 的 tf，已经往外让出 1.4 cm；脸朝 −z，最前面的牙在脸中心前 FACE_FRONT × 缩放）→ 收回来。落点是 entities.js 给的世界坐标。
// 扑的这条线在前后立柱之间的开口里、发动机盖上方、护顶下方（脸宽 0.62 × 1.22，悬浮高度 1.7，落点离地 1.6 m 多）
// 脸（这一组网格，脸的本地坐标）最前面的那些顶点：往前伸出多远（z）、在多高（y）—— 高画质的牙有厚度、沿弧往前凸 6 cm，
// 低画质是一张平脸（牙只有 1 cm 厚）；按实际几何量一次
function faceFront(u, face) {
  if (u._faceFront) return u._faceFront;
  let minZ = Infinity;
  const pts = [], v = new THREE.Vector3();
  face.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(face.matrixWorld).invert();
  face.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); pts.push(v.x, v.y, v.z); if (v.z < minZ) minZ = v.z; }
  });
  let y = 0, n = 0;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] < minZ + 0.005) { y += pts[i + 1]; n++; }
  u._faceFront = { z: Number.isFinite(minZ) ? -minZ : 0.06, y: n ? y / n : 0 };
  return u._faceFront;
}
const LT = { m: null, inv: null, v: null };
function lunTmp() { if (!LT.m) { LT.m = new THREE.Matrix4(); LT.inv = new THREE.Matrix4(); LT.root = new THREE.Matrix4(); LT.v = new THREE.Vector3(); } return LT; }
function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
function faceLunge(e, u, face, k, tg) {
  const L = lunTmp(), par = face.parent;
  if (!par) return;
  // 世界 → 脸的父节点坐标：根节点按 e 的位置 / 朝向，往下乘 pivot、模型组
  L.root.makeRotationY(e.yaw).setPosition(e.x, e.y, e.z);
  L.m.identity();
  for (let o = par; o && o !== e.obj; o = o.parent) { o.updateMatrix(); L.m.premultiply(o.matrix); }
  L.m.premultiply(L.root);
  L.inv.copy(L.m).invert();
  const tf = tg.tf || tg.t1, P = L.v.set(tf.x, tf.y, tf.z).applyMatrix4(L.inv);
  const PK = A.anim.STRIKE_PEAK, sc = face.scale.x;
  const fr = faceFront(u, face);
  P.z += fr.z * sc - 0.004;   // 脸中心停在落点后面（脸朝 −z）：最前面的牙正好碰到（落点本来往外让了 8 mm，牙再往前 4 mm，离人 1–1.5 cm）
  P.y -= fr.y * sc;   // 最前面的是嘴（一排牙在脸中心下面）：嘴对准落点，不是脸中心
  let w;
  if (k < 0.22) w = -0.12 * ease(k / 0.22);
  else if (k < PK) w = -0.12 + 1.12 * ease((k - 0.22) / (PK - 0.22));
  else if (k < PK + 0.36) w = 1 - ease((k - PK) / 0.36);
  else w = 0;
  if (w >= 0) face.position.set(P.x * w, P.y * w, P.z * w);
  else face.position.set(0, 0, -w * 0.08 / 0.12);   // 蓄力：往后缩
}

// ---------- 黑影不在车身、司机、地面、墙上切出硬边（FE1R A10） ----------
// 两层黑影是面朝相机的平面精灵（渐变边），平面插进车身、坐着的人、地面、墙里的那一条线是直的硬边（孩子挑的：「黑影把车和司机竖着切了一刀」）。
// 每帧按笑魇离周围东西的距离把黑影收小、底边抬高，保证不透明度 >0.05 的那一圈（内层 0.985、外层 0.95 的半径）谁都碰不到：
//   把黑影当成一个绕竖轴转一圈的椭球（水平半径 = 半宽、竖直半径 = 半高；相机从哪个方向看，精灵平面都在这个椭球里）；
//   地面：底边抬到地面上方 3 cm（顶不动，竖直方向收短）；车（14 个部件盒 + 驾驶舱里坐人的那一块）、站着的联机队友、墙（每 0.25 s 打 8 条水平射线）：
//   按椭球尺度量到它们的距离，整体缩到碰不到为止（最小缩到 0.2）。缩小马上生效，放大每秒最多回 1.5 倍 —— 离开车和墙以后慢慢回到原来的大小。
// 只改黑影精灵的大小和位置，不改笑魇的位置、碰撞体、行为
const SHROUD_BASE = { smilerShroud: { sx: 2.3, sy: 3.2, py: -0.55, f: 0.985 }, smilerShroudOuter: { sx: 2.46, sy: 3.4, py: -0.6, f: 0.95 } };
const CAB_BOX = [-0.47, 0.47, 0.6, 2.2, -0.75, 0.65];   // 驾驶舱里坐人的那一块（车本地）
function boxDist(b, x, y, z, ax, ay) {
  // 椭球尺度（水平 / ax、竖直 / ay）下，点 (x, y, z) 到轴对齐盒的距离（0 = 在里面）
  const dx = Math.max(b[0] - x, 0, x - b[1]) / ax, dy = Math.max(b[2] - y, 0, y - b[3]) / ay, dz = Math.max(b[4] - z, 0, z - b[5]) / ax;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function shroudFit(e, u) {
  if (!u._shr) {
    u._shr = [];
    for (const nm in SHROUD_BASE) { const o = u.pivot.getObjectByName(nm); if (o) u._shr.push({ o, b: SHROUD_BASE[nm], s: 1 }); }
    u._wallAt = -1e9; u._walls = null;
  }
  if (!u._shr.length) return;
  const t = A.state ? (BR.entities && BR.entities.api ? BR.entities.api.time : 0) : 0;
  const dtS = Math.max(0, Math.min(0.2, t - (u._shrT == null ? t : u._shrT)));
  u._shrT = t;
  const py = u.pivot.position.y, gY = e.y;
  // 车：附近（6 m 内）的车，部件盒（车本地）
  const cars = [];
  const V = BR.vehicles, G = BR.L1forklift && BR.L1forklift.geo;
  if (V && typeof V.list === 'function' && G && typeof G.obbs === 'function') {
    for (const v of V.list()) {
      if (!Number.isFinite(v.x) || Math.abs(v.x - e.x) > 6 || Math.abs(v.z - e.z) > 6) continue;
      cars.push({ v, boxes: G.obbs(v.lift || 0).map(o => [o.cx - o.hx, o.cx + o.hx, o.cy - o.hy, o.cy + o.hy, o.cz - o.hz, o.cz + o.hz]).concat([CAB_BOX]) });
    }
  }
  // 站着的联机队友（竖直圆柱 r 0.37、高 1.8）
  let peer = null;
  try { const q = BR.coop && BR.coop.active && BR.coop.peer; if (q && Number.isFinite(q.x)) peer = q; } catch (err) { peer = null; }
  // 墙：每 0.25 s 从黑影中心高度打 8 条水平射线
  if (t - u._wallAt > 0.25 && BR.phys && typeof BR.phys.raycast === 'function') {
    u._wallAt = t;
    const y = gY + py - 0.55, out = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
      let h = null;
      try { h = BR.phys.raycast(e.x, y, e.z, dx, 0, dz, 3); } catch (err) { h = null; }
      out.push(h && Number.isFinite(h.dist) ? h.dist : Infinity);
    }
    u._walls = out;
  }
  for (const S of u._shr) {
    const b = S.b, f = b.f;
    let ax = 0.5 * b.sx * f, ay = 0.5 * b.sy * f, cy = gY + py + b.py;
    // 地面：底边抬到地面上方 3 cm，顶不动
    const top = cy + ay, bot = Math.max(cy - ay, gY + 0.03);
    ay = Math.max(0.05, (top - bot) / 2); cy = (top + bot) / 2;
    let want = Infinity;
    for (const c of cars) {
      const p = c.v, co = Math.cos(p.yaw), si = Math.sin(p.yaw), dx = e.x - p.x, dz = e.z - p.z;
      const lx = co * dx - si * dz, lz = si * dx + co * dz, ly = cy - (p.y || 0);
      for (const B of c.boxes) want = Math.min(want, boxDist(B, lx, ly, lz, ax, ay));
    }
    if (peer) {
      const feet = (+peer.y || 1.62) - 1.62, d = Math.max(0, Math.hypot(peer.x - e.x, peer.z - e.z) - 0.37) / ax;
      const dy = Math.max(feet - cy, 0, cy - (feet + 1.8)) / ay;
      want = Math.min(want, Math.hypot(d, dy));
    }
    if (u._walls) for (const d of u._walls) want = Math.min(want, d / ax);
    want = want >= 1.04 ? 1 : Math.max(0.2, Math.min(1, want * 0.96));   // 量出来的距离留 4% 余量；周围空着（≥1.04）就是原来的大小
    // 缩小马上生效，放大慢慢回
    S.s = want < S.s ? want : Math.min(want, S.s * Math.pow(1.5, dtS));
    const sx = b.sx * S.s, sy = (2 * ay / f) * S.s;
    S.o.scale.set(sx, sy, 1);
    S.o.position.y = cy - gY - py;
  }
}

A.register({
  type: 'smiler', en: 'Smiler', zh: '笑魇', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile；「对一切生命怀有敌意（anethikas 除外）」——数值不受外观改动影响，维持原判断

  hp: A.HP.sturdy,       // 依据：「被称为迄今记录中最危险的非个体实体之一」「作为顶级掠食者，没有天敌」→ 取偏高档；无具体耐久数字，非设定精确值
  radius: 0.45, height: 2.0,
  // 依据：size:unverified，取跟人差不多的默认碰撞体；height 仍用于 0.9*height≈1.8m 的视线/攻击判定高度，
  // 和下面浮空视觉的 1.6–1.8m 区间吻合，不用改
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },
  // 依据：speed 字段本身 unverified（「远超人类」与「普通人应能跑赢」两条互相矛盾，未计入），取 run 档保证追击有威胁，非设定精确值
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 160, avoidsLight: true },
  // 依据：「发光的眼与齿(Ardenti risu)本身是视听器官」→ 正常视听档；「可见光照到身体时会像疼痛般退缩」→ avoidsLight 标记为真，具体惧光行为见下方 lightBound
  attack: { hp: A.DAMAGE.heavy, sanity: 8, range: 1.1, cooldown: A.COOLDOWN.normal },
  // 打坐在叉车上的人（FE1R K6）：没有胳膊，整张脸扑过去 —— 站在驾驶舱侧面（车身外面），脸鼓到最大那一刻正好贴到司机近侧肩膀
  // （离身体外壳 4 mm）。reach = 脸能扑出去多远（米，从脸的悬浮位置量到落点），y = 脸悬浮的高度（anim.fly.cruise）
  seatStrike: { kind: 'face', reach: 0.95, y: 1.7 },
  // 依据：具体攻击招式 unverified，只有「被称为迄今记录中最危险的非个体实体之一」的定性描述 → 取 heavy（不是明确的"一击致命/撕碎"，不给 lethal）；
  // sanity 依据「夜间猎手…用扭曲多变的声音嘲弄折磨受害者」的精神压迫描述，选中版本未给数字，取小值
  sounds: { alert: 'giggle', attack: 'screech' },
  // 依据：「嘲弄折磨受害者」→ giggle(嘲笑，别名 laugh) 作为发现目标时的叫声；attack 用 screech(别名 scream/shriek)

  brain: A.lightBound(smilerDrift({ patrolRadius: 16, alertCry: 'giggle' }), {
    mode: 'avoid', threshold: A.LIGHT.lit, onLight: 'flee', ignoreLitTargets: true,
  }),
  // 依据：「在夜晚绝对黑暗中…主动追踪人类」→ 发现目标就逼近（smilerDrift 的 chase/attack）；
  // 「可见光…会像疼痛般退缩，通常可用手电筒击退或躲进亮着灯的房间」→ 外层惧光修饰不变：亮处逃离(flee)、
  // 站在亮房间里的目标不追(ignoreLitTargets)，阈值沿用 A.LIGHT.lit(0.6)（原因见下方移动说明）；
  // 用户原话「在道路中间穿梭」「巡逻时平滑漂移」→ 用户明确重定义了移动方式，
  // 原 fandom 版「成群狩猎」的群体巡逻(A.pack)不再贴合，改用上面自写的单体 smilerDrift+corridorPatrol，
  // 索敌/追击/攻击/搜索的判定逻辑（阵营规则、findTarget、惧光）完全不变，只是巡逻时怎么走路变了
  anim: {
    gait: 'none',   // 依据：没有骨骼身体，不走 biped/quad 步态动画
    fly: { cruise: 1.7, low: 1.7, rest: 1.7, bob: 0.09, bobHz: 0.55, bank: 0, ceiling: true, clearance: 0.3 },
    // 依据：用户原话「离地约 1.6–1.8 m 悬浮，轻微上下漂浮」→ 巡逻/追击/攻击都保持同一悬浮高度（cruise=low=rest=1.7），
    // 不像普通飞行实体那样攻击时下潜；bob 给小幅度、bobHz 放慢 → 「轻微」上下漂浮而不是明显起伏；
    // bank 关掉（0）——只是一张脸，没有身体转弯时侧倾会显得不像"飘浮"更像"倾倒"，非设定
    fall: 'fade',   // 依据：无实体身体，死亡不用"倒地"，用缩小淡出表现"消散"，非设定（无形态可倒）
    stateSounds: { chase: 'giggle' },
    onFrame(e, dt, api, u) {
      // 没有骨骼可供 anim.strike 驱动张嘴动作，攻击时改成脸部短促放大一下当出手动作
      if (u._face === undefined) u._face = u.pivot.getObjectByName('smilerFace') || null;
      const face = u._face;
      if (!face) return;
      if ((e.state === 'attack' || A.anim.striking(e, api, api.time)) && !e.dead) {
        // 相位和别的近战怪同一套（A.anim.strikePhase：从这一下起手算，STRIKE_PEAK 处扑到最前，entities.js 就在那一刻扣血）
        const cd = Math.max(0.2, num(e.def.attack && e.def.attack.cooldown, 1));
        const k = A.anim.strikePhase(e, api, api.time, u, cd);
        face.scale.setScalar(1 + 0.22 * Math.max(0, A.anim.strikeCurve(k)));
        const tg = typeof api.seatTarget === 'function' ? api.seatTarget(e) : null;
        if (tg) faceLunge(e, u, face, k, tg);
        else if (face.position.lengthSq() > 0) face.position.set(0, 0, 0);
      } else {
        if (face.scale.x !== 1) face.scale.setScalar(1);
        if (face.position.lengthSq() > 0) face.position.set(0, 0, 0);
      }
      shroudFit(e, u);
    },
  },

  build() { return buildModel(); },
});
})();
