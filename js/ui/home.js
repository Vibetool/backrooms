// 后室 · 主页：后室房间一角的 3D 场景 + 穿制服的人（点人换皮肤）+ 模式菜单 + 参数面板
// 经典 <script>，只往 window.BR 上挂东西。接口见 ARCHITECTURE.md 第 12 节 BR.home
// DOM 全部由本文件在 #ui 里创建（class 前缀 home-），样式在 css/home.css
// 渲染由 main 的主循环负责（gfx.render 每帧都要调）；本模块只在显示期间用自己的 rAF 更新动画和镜头
(function () {
'use strict';
const BR = window.BR;
if (!BR || typeof THREE === 'undefined') {
  console.error('[home] 需要先加载 vendor/three.min.js 和 js/core/base.js');
  return;
}
const U = BR.util;
const has = (o, k) => !!o && typeof o[k] === 'function';

const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
const SELF_RE = /js\/ui\/home\.js(\?[^#]*)?(#.*)?$/;
// 按本脚本地址推算站点根目录：tests/ 下的自测页也能找对 css 和 data
const BASE = SELF_RE.test(SCRIPT_SRC) ? SCRIPT_SRC.replace(SELF_RE, '') : '';
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ===================================================================
// 场景常量
// ===================================================================
// 人物站在原点附近面向相机（+Z）。背后是正面墙纸墙，左侧一面墙构成墙角，
// 正面墙右段开一个到顶的豁口通向更深的走廊 —— 远处被雾吞掉，才有后室那种"没有尽头"的感觉
const ROOM = {
  h: 2.6,                 // 层高：后室天花板压得低
  backZ: -1.7, leftX: -2.9, rightX: 8.5, frontZ: 7.5,
  doorX0: 2.1, doorX1: 3.5, corridorZ: -9.0,
};
const WALL_TILE = 1.2, CARPET_TILE = 1.6, CEIL_TILE = 1.2;   // 贴图一张对应的米数
const FIG_POS = new THREE.Vector3(0, 0, 0.1);
const FIG_MID = new THREE.Vector3(0, 0.92, 0.1);             // 取景对准的人物中点
const FACE_TURN = 0.3;                                       // 身体略朝右转，朝向「游玩」按钮那一侧
// 日光灯面板 [x, z, 是否带真实光源]；真光源不超过 gfx 的灯光池（6 盏）
const PANELS = [
  [-1.3, -0.5, true], [1.3, -0.5, true], [5.2, -0.5, true],
  [-1.3, 2.0, true], [1.3, 2.0, true], [5.2, 2.0, false],
  [2.8, -4.0, true], [2.8, -7.4, false],
];
const HOME_ENV = {
  background: 0x5c5024, fogColor: 0x5c5024,
  fogNear: 7, fogFar: 24,
  ambient: { color: 0xfff0c8, intensity: 0.5 },
};

// ===================================================================
// 状态
// ===================================================================
const S = {
  inited: false, shown: false,
  // DOM
  root: null, modal: null, hint: null, skinRoot: null, swatches: [],
  coopBtn: null, coopStatus: null, modalView: null,
  hintW: 0, hintH: 0, hintX: -1, hintY: -1, hintPortrait: null,
  // 弹层栈：'menu' | 'casual' | 'nightmare' | 'test' | 'credits' | 'skin'
  layers: [], hist: 0, expectDepth: null,
  // 3D
  group: null, holder: null, body: null, hit: null,
  figure: null, fallback: null, fallbackMats: [], suitMats: [],
  panels: [], lightList: [],
  frame: { init: false, fov: 50, dist: 3.5, fx: 0.36, fy: 0.55, pitch: 0 },
  snapFrame: true,
  flick: { timer: 5, idx: -1, seq: null, pos: 0, segT: 0 },
  // 循环与输入
  raf: 0, last: 0, t: 0, coopT: 0, hoverT: 0,
  hover: false, ptr: { x: 0, y: 0, ok: false, dirty: false },
  down: null, audioUnlocked: false, startGuard: 0, savedFov: null,
};

function mk(tag, cls, parent, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
function button(cls, parent, text) {
  const b = mk('button', cls, parent, text);
  b.type = 'button';
  return b;
}
function host() { return document.getElementById('ui') || document.body; }
function attached(el) { return !!el && document.documentElement.contains(el); }
function viewW() { return Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1); }
function viewH() { return Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1); }

function ensureStylesheet() {
  const links = document.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    if (/stylesheet/i.test(links[i].rel) && /css\/home\.css(\?.*)?$/.test(links[i].getAttribute('href') || '')) return;
  }
  // index.html 没引 css/home.css 时自己补上
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = BASE + 'css/home.css';
  l.setAttribute('data-owner', 'home');
  (document.head || document.documentElement).appendChild(l);
}

// ===================================================================
// 3D 场景
// ===================================================================
function tex(name) {
  const A = BR.assets;
  if (!has(A, 'texture')) return null;
  try { return A.texture(name); } catch (err) { return null; }
}

// UV 直接按米缩放，一种表面只要一个材质和一张贴图实例，墙再多也能合并成一次 draw call
function planeUV(w, h, tileW, tileH) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tileW, uv.getY(i) * h / tileH);
  return geo;
}

function placed(geo, x, y, z, ry, rx) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, 0, 'YXZ'));
  m.setPosition(x, y, z);
  geo.applyMatrix4(m);
  return geo;
}

function addMerged(group, geos, mat, name) {
  const BGU = THREE.BufferGeometryUtils;
  if (BGU && has(BGU, 'mergeBufferGeometries') && geos.length > 1) {
    const merged = BGU.mergeBufferGeometries(geos, false);
    if (merged) {
      geos.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = name;
      group.add(mesh);
      return;
    }
  }
  geos.forEach(g => { const mesh = new THREE.Mesh(g, mat); mesh.name = name; group.add(mesh); });
}

function buildScene() {
  const g = S.group = new THREE.Group();
  g.name = 'home-scene';
  const R = ROOM, H = R.h, HALF = Math.PI / 2;

  // Phong 与 Ldev 一致：r147 的 Lambert 是逐顶点光照，大面片上的点光会被抹平；同类材质也少编译 shader
  const wallMap = tex('wallpaper_l0');
  // 兜底色和墙纸贴图一样压暗 10%（用户要求墙色略深一点）
  const wallMat = new THREE.MeshPhongMaterial({ map: wallMap, color: wallMap ? 0xffffff : 0xc1a74d, specular: 0x14120a, shininess: 6 });
  const floorMap = tex('carpet_light');
  const floorMat = new THREE.MeshPhongMaterial({ map: floorMap, color: floorMap ? 0xfffaf0 : 0xecdb96, specular: 0x000000, shininess: 2 });
  // ceiling_tile 原图偏灰白，乘一层浅黄，天花板和地板一样是浅黄色
  const ceilMap = tex('ceiling_tile');
  const ceilMat = new THREE.MeshPhongMaterial({ map: ceilMap, color: ceilMap ? 0xfff0b4 : 0xeadca0, specular: 0x000000, shininess: 2 });
  // 踢脚线：黄色木质（用户指定），和层级里 BR.kit.trims.yellowWood 用同一张木纹
  const trimMap = tex('baseboard_wood');
  const trimMat = new THREE.MeshPhongMaterial({ map: trimMap, color: trimMap ? 0xffffff : 0xd6b05c, specular: 0x14100a, shininess: 10 });

  const walls = [];
  const wall = (x0, x1, z, ry) => {   // 沿本地 X 的一段墙
    const w = Math.abs(x1 - x0);
    return planeUV(w, H, WALL_TILE, WALL_TILE);
  };
  // 正面墙（朝 +Z），豁口两侧各一段
  walls.push(placed(wall(R.leftX, R.doorX0), (R.leftX + R.doorX0) / 2, H / 2, R.backZ, 0));
  walls.push(placed(wall(R.doorX1, R.rightX), (R.doorX1 + R.rightX) / 2, H / 2, R.backZ, 0));
  // 左墙（朝 +X）
  walls.push(placed(planeUV(R.frontZ - R.backZ, H, WALL_TILE, WALL_TILE), R.leftX, H / 2, (R.frontZ + R.backZ) / 2, HALF));
  // 走廊两侧和尽头
  const cl = R.backZ - R.corridorZ, cz = (R.backZ + R.corridorZ) / 2;
  walls.push(placed(planeUV(cl, H, WALL_TILE, WALL_TILE), R.doorX0, H / 2, cz, HALF));
  walls.push(placed(planeUV(cl, H, WALL_TILE, WALL_TILE), R.doorX1, H / 2, cz, -HALF));
  walls.push(placed(planeUV(R.doorX1 - R.doorX0, H, WALL_TILE, WALL_TILE), (R.doorX0 + R.doorX1) / 2, H / 2, R.corridorZ, 0));
  addMerged(g, walls, wallMat, 'home-walls');

  const fw = R.rightX - R.leftX, fd = R.frontZ - R.corridorZ;
  const fx = (R.rightX + R.leftX) / 2, fz = (R.frontZ + R.corridorZ) / 2;
  addMerged(g, [placed(planeUV(fw, fd, CARPET_TILE, CARPET_TILE), fx, 0, fz, 0, -HALF)], floorMat, 'home-floor');
  addMerged(g, [placed(planeUV(fw, fd, CEIL_TILE, CEIL_TILE), fx, H, fz, 0, HALF)], ceilMat, 'home-ceiling');

  // 踢脚线：黄色木质矮条（高 7cm、厚 1.8cm，用户要求矮一点），墙角的空间感一下子就出来了
  const TH = 0.07, TT = 0.018;
  const trimBox = (w, d) => {   // 木纹沿长边平铺：u 按长度 / 0.9m 放大，v 按条高占整张纹理高度（0.225m）的比例
    const geo = new THREE.BoxGeometry(w, TH, d);
    const uv = geo.attributes.uv, len = Math.max(w, d);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.9, uv.getY(i) * TH / 0.225);
    return geo;
  };
  const trims = [];
  trims.push(placed(trimBox(R.doorX0 - R.leftX, TT), (R.leftX + R.doorX0) / 2, TH / 2, R.backZ + TT / 2, 0));
  trims.push(placed(trimBox(R.rightX - R.doorX1, TT), (R.doorX1 + R.rightX) / 2, TH / 2, R.backZ + TT / 2, 0));
  trims.push(placed(trimBox(TT, R.frontZ - R.backZ), R.leftX + TT / 2, TH / 2, (R.frontZ + R.backZ) / 2, 0));
  trims.push(placed(trimBox(TT, cl), R.doorX0 + TT / 2, TH / 2, cz, 0));
  trims.push(placed(trimBox(TT, cl), R.doorX1 - TT / 2, TH / 2, cz, 0));
  addMerged(g, trims, trimMat, 'home-trim');

  // 日光灯面板：每块独立材质，闪烁时只动一块
  const panelMap = tex('light_panel');
  const panelGeo = new THREE.PlaneGeometry(0.62, 1.22);
  S.panels = [];
  S.lightList = [];
  for (const [x, z, real] of PANELS) {
    const mat = new THREE.MeshBasicMaterial({ map: panelMap, color: panelMap ? 0xffffff : 0xfff8e0 });
    const mesh = new THREE.Mesh(panelGeo, mat);
    mesh.position.set(x, H - 0.004, z);
    mesh.rotation.x = HALF;   // 朝下
    mesh.name = 'home-panel';
    g.add(mesh);
    const light = real ? { x, y: H - 0.3, z, color: 0xfff0cc, intensity: 0.95, range: 7.5, flicker: 0 } : null;
    S.panels.push({ mesh, mat, light, level: 1 });
  }

  // 人物：holder 负责站位朝向，body 负责呼吸起伏，figure 是 GLB 或兜底人形
  const holder = S.holder = new THREE.Group();
  holder.name = 'home-figure';
  holder.position.copy(FIG_POS);
  holder.rotation.y = Math.PI + FACE_TURN;   // 模型朝 -Z，转 180° 面向相机
  const body = S.body = new THREE.Group();
  holder.add(body);
  // 略大的不可见碰撞体：手机上手指粗，点到人附近就算
  const hit = S.hit = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.95, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.975;
  hit.name = 'home-figure-hit';
  holder.add(hit);
  g.add(holder);
}

function buildFallback() {
  const g = new THREE.Group();
  g.name = 'home-fallback';
  const suit = new THREE.MeshStandardMaterial({ color: 0xd8b21f, roughness: 0.5, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: 0.1, metalness: 0.3 });
  S.fallbackMats = [suit, dark, visor];
  const add = (geo, mat, x, y, z, isSuit) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (isSuit) m.userData.suit = true;   // skin.apply 找不到 Suit 材质时按这个标记换色
    g.add(m);
    return m;
  };
  // 朝 -Z 搭，和 GLB 同一朝向
  add(new THREE.CapsuleGeometry(0.2, 0.42, 6, 16), suit, 0, 1.18, 0, true);
  add(new THREE.SphereGeometry(0.135, 20, 14), suit, 0, 1.64, 0.01, true);
  add(new THREE.SphereGeometry(0.1, 18, 12), dark, 0, 1.61, -0.07).scale.set(1, 1.15, 0.8);
  add(new THREE.BoxGeometry(0.15, 0.05, 0.03), visor, 0, 1.66, -0.145);
  for (const sx of [1, -1]) {
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 14), dark, sx * 0.11, 1.57, -0.1).rotation.z = Math.PI / 2;
    const arm = add(new THREE.CapsuleGeometry(0.062, 0.46, 4, 12), suit, sx * 0.27, 1.13, 0, true);
    arm.rotation.z = sx * 0.1;
    add(new THREE.SphereGeometry(0.055, 12, 10), dark, sx * 0.31, 0.8, -0.02);
    add(new THREE.CapsuleGeometry(0.09, 0.5, 4, 12), suit, sx * 0.13, 0.64, 0, true);
    add(new THREE.BoxGeometry(0.13, 0.34, 0.27), dark, sx * 0.15, 0.17, -0.04);
  }
  add(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 20), dark, 0, 1.0, 0);
  return g;
}

function disposeTree(obj, extraMats) {
  const mats = new Set(extraMats || []);
  obj.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && mats.add(m));
  });
  mats.forEach(m => m.dispose());
}

// GLB 按约定是原点在脚底、身高 1.8 m；万一换了模型不守约定，这里量一下纠正，免得人飘在半空或钻进地板
function normalizeModel(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0.1 && Math.abs(size.y - 1.8) > 0.05) {
    obj.scale.multiplyScalar(1.8 / size.y);
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
  }
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
}

function setModel(obj) {
  if (S.figure) {
    S.body.remove(S.figure);
    if (S.figure === S.fallback) { disposeTree(S.fallback, S.fallbackMats); S.fallback = null; S.fallbackMats = []; }
  }
  if (obj) {
    normalizeModel(obj);
  } else {
    obj = S.fallback = buildFallback();
  }
  S.figure = obj;
  S.body.add(obj);
  applySkin();
}

function loadFigure() {
  const A = BR.assets;
  const ready = has(A, 'modelSync') ? A.modelSync('hazmat') : null;
  if (ready) { setModel(ready); return; }
  setModel(null);   // 先放兜底人形，GLB 到了再换
  if (!has(A, 'model')) return;
  A.model('hazmat').then(m => {
    if (S.figure !== S.fallback) return;
    setModel(m);
  }).catch(err => {
    console.info('[home] hazmat.glb 未加载，主页用简单几何人形兜底：', err && err.message);
  });
}

// ===================================================================
// 皮肤
// ===================================================================
function applySkin() {
  if (!S.figure) return;
  if (BR.skin && has(BR.skin, 'apply')) BR.skin.apply(S.figure);
  // 悬停高亮只动 skin.apply 克隆出来的私有材质，不碰 GLB 缓存里共享的原型
  S.suitMats = [];
  S.figure.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m && m.emissive && m.userData && m.userData.brSkinOwner === o.uuid) S.suitMats.push(m);
    });
  });
  setSuitGlow(S.hover);
  updateSwatches();
}

function setSuitGlow(on) {
  for (const m of S.suitMats) {
    if (on) m.emissive.copy(m.color).multiplyScalar(0.28);
    else m.emissive.setRGB(0, 0, 0);
  }
}

function currentSkin() {
  return BR.skin ? BR.skin.current : (BR.game.skin || BR.DEFAULT_SKIN);
}

function updateSwatches() {
  const cur = currentSkin();
  for (const b of S.swatches) {
    const on = b.dataset.key === cur;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function chooseSkin(key) {
  if (BR.skin && has(BR.skin, 'set')) BR.skin.set(key);
  applySkin();
}

// ===================================================================
// 灯光闪烁、呼吸、镜头
// ===================================================================
function makeFlickSeq() {
  // [时长, 亮度]：启辉器接触不良 —— 几下快速明灭再稳住
  const seq = [];
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    seq.push([0.03 + Math.random() * 0.07, Math.random() * 0.2]);
    seq.push([0.04 + Math.random() * 0.12, 0.7 + Math.random() * 0.3]);
  }
  seq.push([0.25, 1]);
  return seq;
}

function animateLights(dt) {
  const F = S.flick;
  let level = 1;
  if (F.idx < 0) {
    F.timer -= dt;
    if (F.timer <= 0 && S.panels.length) {
      // 优先挑镜头里看得见的前排灯，闪了才看得到
      F.idx = Math.floor(Math.random() * Math.min(3, S.panels.length));
      F.seq = makeFlickSeq();
      F.pos = 0;
      F.segT = 0;
      if (S.audioUnlocked && has(BR.audio, 'play')) {
        try { BR.audio.play('buzz', null, { volume: 0.35 }); } catch (err) { /* 音效缺失不影响画面 */ }
      }
    }
  }
  if (F.idx >= 0) {
    F.segT += dt;
    while (F.idx >= 0 && F.segT >= F.seq[F.pos][0]) {
      F.segT -= F.seq[F.pos][0];
      if (++F.pos >= F.seq.length) {
        F.idx = -1;
        F.timer = 6 + Math.random() * 9;
      }
    }
    if (F.idx >= 0) level = F.seq[F.pos][1];
  }
  for (let i = 0; i < S.panels.length; i++) {
    const p = S.panels[i];
    const lv = i === F.idx ? level : 1;
    if (lv === p.level) continue;
    p.level = lv;
    p.mat.color.setScalar(0.1 + 0.9 * lv);
    // 不降到 0：gfx 选灯时会跳过强度为 0 的光源，恢复时还要淡入 0.25 秒
    if (p.light) p.light.intensity = 0.95 * Math.max(0.06, lv);
  }
}

function animateFigure() {
  const t = S.t;
  const s = Math.sin(t * Math.PI * 2 / 4.2);   // 4.2 秒一次呼吸
  S.body.scale.set(1 + 0.006 * s, 1 + 0.008 * s, 1 + 0.014 * s);
  S.body.rotation.z = Math.sin(t * 0.37) * 0.006;
  S.body.rotation.x = Math.sin(t * 0.29 + 1) * 0.004;
}

// 取景：让人物中点落在屏幕 (fx, fy)（0..1，左上为原点），距离 dist，俯角 pitch
// 竖屏人物在上半屏，弹层（底部抽屉）打开时再往上让；横屏人物在左侧，弹窗在右侧打开时再往左让
function framing(aspect, open) {
  if (aspect < 0.85) {
    return open ? { fov: 58, dist: 4.8, fx: 0.5, fy: 0.24, pitch: 0.16 }
                : { fov: 56, dist: 3.9, fx: 0.5, fy: 0.45, pitch: 0.06 };
  }
  return open ? { fov: 50, dist: 3.8, fx: 0.25, fy: 0.54, pitch: 0.02 }
              : { fov: 50, dist: 3.5, fx: 0.36, fy: 0.55, pitch: 0.0 };
}

function updateCamera(dt) {
  const cam = BR.gfx.camera;
  const aspect = cam.aspect || viewW() / viewH();
  const T = framing(aspect, S.layers.length > 0);
  const F = S.frame;
  if (S.snapFrame || !F.init) {
    F.fov = T.fov; F.dist = T.dist; F.fx = T.fx; F.fy = T.fy; F.pitch = T.pitch;
    F.init = true;
    S.snapFrame = false;
  } else {
    const k = 3.2;
    F.fov = U.damp(F.fov, T.fov, k, dt);
    F.dist = U.damp(F.dist, T.dist, k, dt);
    F.fx = U.damp(F.fx, T.fx, k, dt);
    F.fy = U.damp(F.fy, T.fy, k, dt);
    F.pitch = U.damp(F.pitch, T.pitch, k, dt);
  }
  if (Math.abs(cam.fov - F.fov) > 1e-3) { cam.fov = F.fov; cam.updateProjectionMatrix(); }

  // 固定朝向（只俯仰）下反解相机位置：C = M - (右·xr + 上·yu + 前·dist)，比 lookAt 后再估算偏移准确
  const tanV = Math.tan(F.fov * Math.PI / 360), tanH = tanV * aspect;
  const sp = Math.sin(F.pitch), cp = Math.cos(F.pitch);
  const xr = (F.fx * 2 - 1) * F.dist * tanH;
  const yu = (1 - F.fy * 2) * F.dist * tanV;
  let cx = FIG_MID.x - xr;
  let cy = FIG_MID.y - cp * yu + sp * F.dist;
  let cz = FIG_MID.z + sp * yu + cp * F.dist;

  // 缓慢漂移：几个互质周期叠加，不会看出循环
  const m = reduceMotion ? 0.3 : 1, t = S.t;
  cx += Math.sin(t * 0.21) * 0.08 * m;
  cy += Math.sin(t * 0.17 + 1.3) * 0.035 * m;
  cz += Math.sin(t * 0.13 + 2.1) * 0.10 * m;
  cy = U.clamp(cy, 0.25, ROOM.h - 0.3);
  cam.position.set(cx, cy, cz);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(-F.pitch + Math.sin(t * 0.15 + 0.4) * 0.005 * m, Math.sin(t * 0.11) * 0.01 * m, 0);
  cam.updateMatrixWorld();
}

const _v = new THREE.Vector3();
function updateHint() {
  const el = S.hint;
  if (!el) return;
  const cam = BR.gfx.camera;
  const w = viewW(), h = viewH();
  const portrait = w / h < 0.85;
  if (!S.hintW || S.hintPortrait !== portrait) {
    S.hintW = el.offsetWidth || 160;
    S.hintH = el.offsetHeight || 28;
    S.hintPortrait = portrait;
  }
  let x, y;
  if (portrait) {
    // 竖屏：人物居中，提示放脚下（下面是按钮区之上的空地）
    _v.set(FIG_POS.x, -0.04, FIG_POS.z).project(cam);
    x = (_v.x + 1) / 2 * w - S.hintW / 2;
    y = (1 - _v.y) / 2 * h + 10;
  } else {
    // 横屏：放在人物右侧胸口高度，避开左下署名和右下按钮
    _v.set(FIG_POS.x + 0.36, 1.2, FIG_POS.z).project(cam);
    x = (_v.x + 1) / 2 * w + 14;
    y = (1 - _v.y) / 2 * h - S.hintH / 2;
  }
  x = U.clamp(x, 8, w - S.hintW - 8);
  y = U.clamp(y, 8, h - S.hintH - 8);
  if (Math.abs(x - S.hintX) < 0.5 && Math.abs(y - S.hintY) < 0.5) return;
  S.hintX = x; S.hintY = y;
  el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
}

// ===================================================================
// 点击 / 悬停人物
// ===================================================================
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function sceneTarget(el) {
  if (!el) return false;
  const canvas = BR.gfx && BR.gfx.renderer && BR.gfx.renderer.domElement;
  return el === canvas || el === document.body || el === document.documentElement || el.id === 'ui' || el === S.root;
}

// coarse（触屏）用放大的碰撞体；鼠标精确，直接打模型
function pickFigure(clientX, clientY, coarse) {
  if (!S.shown || !S.figure || !BR.gfx || !BR.gfx.camera) return false;
  const canvas = BR.gfx.renderer && BR.gfx.renderer.domElement;
  const r = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: viewW(), height: viewH() };
  if (!r.width || !r.height) return false;
  ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  BR.gfx.camera.updateMatrixWorld();
  ray.setFromCamera(ndc, BR.gfx.camera);
  S.group.updateMatrixWorld(true);
  return ray.intersectObject(coarse ? S.hit : S.figure, true).length > 0;
}

function setHover(on) {
  if (S.hover === on) return;
  S.hover = on;
  document.documentElement.classList.toggle('home-cursor-fig', on);
  if (S.hint) S.hint.classList.toggle('is-hover', on);
  setSuitGlow(on);
}

function updateHover(dt) {
  S.hoverT -= dt;
  // 镜头在漂移，指针不动时人物也可能移进移出，定期重测
  if (S.ptr.ok && S.hoverT <= 0) { S.hoverT = 0.15; S.ptr.dirty = true; }
  if (!S.ptr.dirty) return;
  S.ptr.dirty = false;
  setHover(S.ptr.ok && S.layers.length === 0 && pickFigure(S.ptr.x, S.ptr.y, false));
}

function onPointerMove(e) {
  if (!S.shown || e.pointerType === 'touch') return;
  S.ptr.x = e.clientX;
  S.ptr.y = e.clientY;
  S.ptr.ok = sceneTarget(e.target);
  S.ptr.dirty = true;
}

function onPointerDown(e) {
  tryUnlockAudio(false);
  if (!S.shown || S.layers.length || (e.button != null && e.button > 0) || !sceneTarget(e.target)) { S.down = null; return; }
  S.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
}

// 用 click 而不是 pointerup 打开色板：pointerup 时就弹出的话，随后合成的 click 会落在色板遮罩上把它立刻关掉
function onClick(e) {
  tryUnlockAudio(true);
  const d = S.down;
  S.down = null;
  if (!d || !S.shown || S.layers.length || !sceneTarget(e.target)) return;
  if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 14 || performance.now() - d.t > 800) return;
  if (pickFigure(e.clientX, e.clientY, d.type !== 'mouse')) openLayer('skin');
}

function onKeyDown(e) {
  tryUnlockAudio(true);
  if (e.key === 'Escape' && S.shown && S.layers.length) {
    e.preventDefault();
    closeTop();
  }
}

// ===================================================================
// 音频解锁
// ===================================================================
// pointerdown 在部分 iOS 版本上不算用户激活，所以 click / touchend / keydown 之前每次手势都再调一次 unlock
function tryUnlockAudio(reliable) {
  if (S.audioUnlocked) return;
  const A = BR.audio;
  if (!has(A, 'unlock')) return;          // audio.js 还没导出：下次手势再试
  try {
    const p = A.unlock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) {
    console.warn('[home] 音频解锁失败', err);
    return;
  }
  if (!reliable) return;
  S.audioUnlocked = true;
  if (S.shown && has(A, 'setAmbient')) A.setAmbient('fluorescent');
  window.removeEventListener('touchend', onTouchEndUnlock, true);
}
function onTouchEndUnlock() { tryUnlockAudio(true); }

// ===================================================================
// 弹层栈 + 安卓返回键
// ===================================================================
// 每打开一层 pushState 一次；返回键触发 popstate 时关掉顶层。
// 界面上主动关闭时同步收起弹层，再 history.go(-n) 把多出来的历史记录退掉，popstate 回来时认出来忽略
function openLayer(name) {
  if (!S.shown) return;
  if (S.layers[S.layers.length - 1] === name) return;
  S.layers.push(name);
  try {
    history.pushState({ brHome: S.layers.length }, '');
    S.hist = S.layers.length;
  } catch (err) { /* file:// 或沙箱环境可能不让改历史，弹层照常工作 */ }
  renderLayers();
}

function closeTop() {
  if (!S.layers.length) return;
  S.layers.pop();
  renderLayers();
  syncHistory();
}

function closeAll() {
  if (!S.layers.length) return;
  S.layers.length = 0;
  renderLayers();
  syncHistory();
}

function syncHistory() {
  const diff = S.hist - S.layers.length;
  if (diff <= 0) return;
  S.hist = S.layers.length;
  S.expectDepth = S.layers.length;
  try { history.go(-diff); } catch (err) { S.expectDepth = null; }
}

function onPopState(e) {
  const st = e.state;
  const d = st && typeof st.brHome === 'number' ? st.brHome : 0;
  if (S.expectDepth !== null) {
    const exp = S.expectDepth;
    S.expectDepth = null;
    if (d === exp) return;
  }
  S.hist = d;
  if (!S.shown) return;
  if (S.layers.length > d) {
    S.layers.length = Math.max(0, d);
    renderLayers();
  }
}

function renderLayers() {
  if (!S.root) return;
  const top = S.layers[S.layers.length - 1] || null;
  const modalTop = top && top !== 'skin' ? top : null;
  if (modalTop !== S.modalView) {
    S.modal.textContent = '';
    S.coopBtn = null;
    S.coopStatus = null;
    if (modalTop) buildDialog(modalTop);
    S.modalView = modalTop;
  }
  S.modal.hidden = !modalTop;
  S.skinRoot.hidden = top !== 'skin';
  S.root.classList.toggle('is-open', !!top);
  if (top) setHover(false);
  if (top === 'skin') updateSwatches();
}

// ===================================================================
// 弹窗内容
// ===================================================================
const ATTRIBUTION = '本游戏的层级与实体设定改编自 Backrooms Wiki（英文 Wikidot、中文 Wikidot、Fandom）的社区创作，依照 CC BY-SA 3.0 协议使用。';
const LEVEL_NAMES = { fun: 'Level Fun =)', run: 'Level ! · Run For Your Life' };

function buildDialog(view) {
  const titles = { menu: '选择模式', casual: '游玩', nightmare: '噩梦生存', test: '测试模式', credits: '设定来源与授权' };
  const dlg = mk('div', 'home-dialog home-dialog-' + view, S.modal);
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-label', titles[view] || '');
  const head = mk('div', 'home-dialog-head', dlg);
  const back = button('home-back', head, '‹ 返回');
  back.hidden = S.layers.length < 2;
  back.addEventListener('click', closeTop);
  mk('div', 'home-dialog-title', head, titles[view] || '');
  const close = button('home-close', head, '×');
  close.setAttribute('aria-label', '关闭');
  close.addEventListener('click', closeAll);
  const body = mk('div', 'home-dialog-body', dlg);

  if (view === 'menu') buildMenu(body);
  else if (view === 'casual') buildCasual(body);
  else if (view === 'nightmare') buildNightmare(body);
  else if (view === 'test') buildTest(body);
  else if (view === 'credits') buildCredits(body);

  // 键盘用户直接落到第一个控件；触屏不抢焦点，免得弹出焦点框或滚动
  if (!(BR.input && BR.input.isTouch)) {
    const f = body.querySelector('button:not(:disabled), input, select');
    if (f) { try { f.focus({ preventScroll: true }); } catch (err) { /* 老浏览器不支持参数 */ } }
  }
}

function buildMenu(body) {
  const list = mk('div', 'home-menu', body);
  // 顺序是用户定的：游玩、噩梦生存、测试模式
  const items = [
    ['casual', '游玩', '实体不攻击你，可调能见度和实体数量，可联机'],
    ['nightmare', '噩梦生存', '有饥饿值和 san 值，实体会攻击你'],
    ['test', '测试模式', '不自动生成实体，自己放出实体或召唤测试人'],
  ];
  for (const [key, name, sub] of items) {
    const b = button('home-menu-btn is-' + key, list);
    mk('span', 'home-menu-name', b, name);
    mk('span', 'home-menu-sub', b, sub);
    b.addEventListener('click', () => openLayer(key));
  }
}

function fmtPct(x) {
  const r = Math.round(x * 10) / 10;
  return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + '%';
}

function slider(body, label, value01, fmt, onChange) {
  const f = mk('div', 'home-field', body);
  const row = mk('div', 'home-field-row', f);
  const id = U.uid('home-range-');
  const lab = mk('label', 'home-field-label', row, label);
  lab.htmlFor = id;
  const val = mk('span', 'home-field-value', row);
  const inp = mk('input', 'home-range', f);
  inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.step = '1'; inp.id = id;
  inp.value = String(Math.round(U.clamp(+value01 || 0, 0, 1) * 100));
  const upd = () => {
    const v = +inp.value;
    val.textContent = fmt(v);
    onChange(v / 100);
  };
  inp.addEventListener('input', upd);
  upd();
  return inp;
}

function visibilitySlider(body) {
  const s = BR.game.settings;
  slider(body, '能见度', s.visibility, v => v + '%', x => { s.visibility = x; });
}

function levelLabel(id) {
  const def = BR.levels && BR.levels.get(id);
  if (def) return def.name + (def.title ? ' · ' + def.title : '');
  return LEVEL_NAMES[id] || ('Level ' + id);
}

function levelOptions() {
  const list = (BR.LEVEL_ORDER || []).map(id => ({ id: String(id), label: levelLabel(id), ok: !!(BR.levels && BR.levels.has(id)) }));
  // 一个正式层级都没注册（开发期）时额外给出开发测试层，保证能进游戏
  if (!list.some(x => x.ok)) list.push({ id: 'dev', label: BR.levels && BR.levels.has('dev') ? levelLabel('dev') : 'Level Dev · 开发测试层', ok: true });
  return list;
}

function levelSelect(body) {
  const s = BR.game.settings;
  const f = mk('div', 'home-field', body);
  const row = mk('div', 'home-field-row', f);
  const id = U.uid('home-level-');
  const lab = mk('label', 'home-field-label', row, '起始层级');
  lab.htmlFor = id;
  const sel = mk('select', 'home-select', f);
  sel.id = id;
  const list = levelOptions();
  for (const it of list) {
    const o = mk('option', null, sel, it.ok ? it.label : it.label + ' (制作中)');
    o.value = it.id;
    o.disabled = !it.ok;
  }
  const cur = list.find(x => x.ok && x.id === String(s.startLevel));
  sel.value = cur ? cur.id : (list.find(x => x.ok) || { id: 'dev' }).id;
  s.startLevel = sel.value;
  sel.addEventListener('change', () => { s.startLevel = sel.value; });
  return sel;
}

function buildCasual(body) {
  const s = BR.game.settings;
  mk('p', 'home-note', body, '实体不会攻击你，但友善实体和有害实体仍会互相作战。没有饥饿值和 san 值。');
  visibilitySlider(body);
  const maxF = (BR.MODES.casual && BR.MODES.casual.maxSpawnFactor) || 0.5;
  slider(body, '实体生成量', s.spawnSlider, v => v + '%　= 正常后室的 ' + fmtPct(v * maxF), x => { s.spawnSlider = x; });
  levelSelect(body);
  const actions = mk('div', 'home-actions', body);
  S.coopBtn = button('home-btn', actions, '联机');
  S.coopBtn.addEventListener('click', () => { if (BR.coop && has(BR.coop, 'openLobby')) BR.coop.openLobby(); });
  const start = button('home-btn home-btn-primary', actions, '开始');
  start.addEventListener('click', () => startGame('casual', null));
  S.coopStatus = mk('div', 'home-coop-status', actions);
  S.coopT = 0;
  updateCoop();
}

function updateCoop() {
  if (!S.coopBtn) return;
  const ok = !!(BR.coop && has(BR.coop, 'openLobby'));
  S.coopBtn.disabled = !ok;
  S.coopBtn.title = ok ? '' : '联机模块未加载';
  const txt = ok && BR.coop.active ? ('已联机 · ' + (BR.coop.role === 'host' ? '你是房主' : '你是客机')) : '';
  if (S.coopStatus.textContent !== txt) S.coopStatus.textContent = txt;
}

function nightmareLevel() {
  return BR.levels && BR.levels.has('0') ? '0' : 'dev';
}

function buildNightmare(body) {
  mk('p', 'home-note home-note-warn', body, '有饥饿值和 san 值，实体会攻击你');
  const grid = mk('div', 'home-cards', body);
  for (const d of BR.MODES.nightmare.difficulties) {
    const b = button('home-card home-card-' + d.key, grid);
    mk('span', 'home-card-name', b, d.zh);
    mk('span', 'home-card-desc', b, '正常后室实体数量的 ' + Math.round(d.spawnFactor * 100) + '%');
    b.addEventListener('click', () => startGame('nightmare', d.key));
  }
  mk('p', 'home-note', body, '饥饿低于 20% 时移速减半，饿空时只剩三分之一。选好难度后从 ' + levelLabel(nightmareLevel()) + ' 开始。');
}

function buildTest(body) {
  mk('p', 'home-note', body, '不会自动生成实体，进游戏后按 T（手机点右侧「实体」按钮）打开实体列表放出实体或召唤测试人');
  visibilitySlider(body);
  levelSelect(body);
  const actions = mk('div', 'home-actions', body);
  const start = button('home-btn home-btn-primary', actions, '开始');
  start.addEventListener('click', () => startGame('test', null));
}

// ---------- 署名 ----------
let creditsPromise = null;
function loadCredits() {
  if (!creditsPromise) {
    // file:// 下 fetch 一定失败，失败也缓存，只显示署名
    creditsPromise = typeof fetch === 'function'
      ? fetch(BASE + 'data/credits.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      : Promise.reject(new Error('fetch 不可用'));
  }
  return creditsPromise;
}

function buildCredits(body) {
  mk('p', 'home-note', body, ATTRIBUTION);
  const list = mk('ul', 'home-credits-list', body);
  loadCredits().then(data => renderCredits(body, list, data)).catch(() => { /* 没有 credits.json 就只显示署名 */ });
}

function linkOrText(parent, text, url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const a = mk('a', null, parent, text || url);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else {
    mk('span', null, parent, text);
  }
}

function short(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(short).join('、');
  if (typeof v === 'object') return v.name || v.title || JSON.stringify(v).slice(0, 200);
  return String(v);
}

// credits.json 的结构由调研模块决定，这里宽松渲染：数组 / 带数组字段的对象 / 普通键值
function renderCredits(body, list, data) {
  if (!attached(list)) return;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of ['attribution', 'note', 'license']) {
      if (typeof data[k] === 'string') list.parentNode.insertBefore(mk('p', 'home-note', null, data[k]), list);
    }
  }
  let items = Array.isArray(data) ? data : null;
  if (!items && data && typeof data === 'object') {
    for (const k of ['entries', 'sources', 'items', 'credits', 'pages', 'works']) if (Array.isArray(data[k])) { items = data[k]; break; }
    if (!items) {
      items = Object.keys(data).filter(k => !['attribution', 'note', 'license'].includes(k)).map(k => ({ _key: k, _val: data[k] }));
    }
  }
  if (!items) return;
  for (const it of items.slice(0, 800)) {
    const li = mk('li', null, list);
    if (typeof it !== 'object' || it === null) { li.textContent = String(it); continue; }
    if ('_key' in it) {
      mk('span', 'home-credits-key', li, it._key + '：');
      if (Array.isArray(it._val)) it._val.forEach((x, i) => { if (i) li.appendChild(document.createTextNode('；')); linkOrText(li, short(x), x && (x.url || x.link)); });
      else linkOrText(li, short(it._val), typeof it._val === 'string' ? it._val : it._val && it._val.url);
      continue;
    }
    const title = it.title || it.name || it.page || it.id || '';
    const url = it.url || it.link || it.href || it.source;
    linkOrText(li, short(title) || (typeof url === 'string' ? url : ''), url);
    const meta = [];
    const by = it.authors || it.author || it.by;
    if (by) meta.push('作者：' + short(by));
    if (it.site || it.wiki || it.origin) meta.push(short(it.site || it.wiki || it.origin));
    if (it.license) meta.push(short(it.license));
    if (meta.length) mk('div', 'home-credits-key', li, meta.join(' · '));
  }
}

// ===================================================================
// 开始游戏
// ===================================================================
function startGame(mode, difficulty) {
  const now = performance.now();
  if (now - S.startGuard < 800) return;   // 连点两下不重复开局
  S.startGuard = now;
  // 指针锁定必须在用户手势的同步调用栈里请求，放到事件回调之后就会被浏览器拒绝
  if (BR.input && has(BR.input, 'lock')) { try { BR.input.lock(); } catch (err) { /* 锁不上 input 会退化成拖动视角 */ } }
  const settings = BR.game.settings;
  if (mode === 'nightmare') settings.startLevel = nightmareLevel();
  // 只有游玩模式能联机（ARCHITECTURE 第 2 节）；噩梦和测试即使大厅里连着人也按单人开
  const coop = mode === 'casual' && BR.coop && BR.coop.active ? { role: BR.coop.role } : null;
  const payload = {
    mode,
    difficulty: difficulty || null,
    settings: Object.assign({}, settings),
    seed: (Math.random() * 2 ** 32) >>> 0,
    coop,
  };
  closeAll();
  BR.bus.emit('game:start', payload);
}

// ===================================================================
// DOM
// ===================================================================
function buildDom() {
  ensureStylesheet();
  const root = S.root = mk('div', 'home-root');
  root.hidden = true;

  const title = mk('div', 'home-title', root);
  mk('div', 'home-title-zh', title, '后室');
  mk('div', 'home-title-en', title, 'THE BACKROOMS');

  S.hint = mk('div', 'home-hint', root, '点击人物更换制服颜色');
  S.hint.setAttribute('aria-hidden', 'true');

  const play = button('home-play', root, '游玩');
  play.addEventListener('click', () => { tryUnlockAudio(true); openLayer('menu'); });

  // 「游玩」正上方竖排两个次要按钮：创意工坊、设置（WORKSHOP.md 第 9 节）。
  // 两个模块都是独立文件，可能还没接进 index.html，这里只做存在性判断，不存在就提示"制作中"而不是报错。
  const secondary = mk('div', 'home-secondary-actions', root);
  const workshopBtn = button('home-secondary-btn', secondary, '创意工坊');
  workshopBtn.addEventListener('click', () => {
    if (BR.workshopUI && typeof BR.workshopUI.open === 'function') BR.workshopUI.open();
    else if (BR.hud && typeof BR.hud.toast === 'function') BR.hud.toast('创意工坊制作中', 1600);
  });
  const settingsBtn = button('home-secondary-btn', secondary, '设置');
  settingsBtn.addEventListener('click', () => {
    if (BR.settingsUI && typeof BR.settingsUI.open === 'function') BR.settingsUI.open();
    else if (BR.hud && typeof BR.hud.toast === 'function') BR.hud.toast('设置制作中', 1600);
  });

  const credit = button('home-credit', root, '设定来自 Backrooms Wiki（CC BY-SA 3.0）');
  credit.addEventListener('click', () => openLayer('credits'));

  const modal = S.modal = mk('div', 'home-modal', root);
  modal.hidden = true;
  modal.addEventListener('click', e => { if (e.target === modal) closeAll(); });

  // 色板 z-index 70 高于结算层，必须和主页根节点（50）并列挂在 #ui 下，不能做它的子节点
  const sk = S.skinRoot = mk('div', 'home-skin');
  sk.hidden = true;
  mk('div', 'home-skin-backdrop', sk).addEventListener('click', closeTop);
  const panel = mk('div', 'home-skin-panel', sk);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '制服颜色');
  const head = mk('div', 'home-skin-head', panel);
  mk('div', 'home-skin-title', head, '制服颜色');
  const close = button('home-close', head, '×');
  close.setAttribute('aria-label', '关闭');
  close.addEventListener('click', closeTop);
  const grid = mk('div', 'home-skin-grid', panel);
  S.swatches = BR.SKINS.map(s => {
    const b = button('home-swatch', grid);
    b.dataset.key = s.key;
    mk('span', 'home-swatch-dot', b).style.background = '#' + ('000000' + s.color.toString(16)).slice(-6);
    mk('span', 'home-swatch-name', b, s.zh);
    b.addEventListener('click', () => chooseSkin(s.key));
    return b;
  });
  mk('p', 'home-skin-note', panel, '只换防化服的颜色，防毒面具、手套和靴子不变');
  updateSwatches();
}

function ensureDom() {
  if (!document.body) return false;
  if (!S.root) buildDom();
  // 别的模块清空 #ui 时会把节点一起带走，补挂回去
  const h = host();
  if (!attached(S.root)) h.appendChild(S.root);
  if (!attached(S.skinRoot)) h.appendChild(S.skinRoot);
  return true;
}

// ===================================================================
// 生命周期
// ===================================================================
function enterEnv() {
  const gfx = BR.gfx;
  if (!gfx) return;
  // 主页固定能见度 1：传入非设置值时 gfx 不会跟着能见度滑条改雾
  if (has(gfx, 'applyEnv')) gfx.applyEnv(HOME_ENV, 1);
  if (has(gfx, 'setLightSources')) {
    S.lightList.length = 0;
    for (const p of S.panels) if (p.light) S.lightList.push(p.light);
    gfx.setLightSources(S.lightList);
  }
}

function loop(now) {
  S.raf = requestAnimationFrame(loop);
  const dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0;
  S.last = now;
  update(dt);
}

function update(dt) {
  if (!S.shown || !BR.gfx || !BR.gfx.camera) return;
  // main 已切到加载/游玩时镜头归玩家模块，这里不再抢着写相机
  const screen = BR.game && BR.game.screen;
  if (screen && screen !== 'home') return;
  S.t += dt;
  animateFigure();
  animateLights(dt);
  updateCamera(dt);
  updateHover(dt);
  updateHint();
  if (S.layers[S.layers.length - 1] === 'casual') {
    S.coopT -= dt;
    if (S.coopT <= 0) { S.coopT = 0.5; updateCoop(); }
  }
}

function init() {
  if (S.inited) return;
  S.inited = true;
  buildScene();
  loadFigure();
  if (!ensureDom()) document.addEventListener('DOMContentLoaded', ensureDom, { once: true });

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown);
  document.documentElement.addEventListener('mouseleave', () => { S.ptr.ok = false; S.ptr.dirty = true; });
  window.addEventListener('touchend', onTouchEndUnlock, true);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('resize', () => { S.hintW = 0; });

  BR.bus.on('skin:change', () => applySkin());
  // world.js 在 game:home 里会清空灯光列表；它先于本文件注册，这里补回主页的灯和环境
  BR.bus.on('game:home', () => { if (S.shown) enterEnv(); });

  // 刷新页面时历史里可能残留上次弹层的状态，清掉免得返回键行为错乱
  try { if (history.state && typeof history.state.brHome === 'number') history.replaceState(null, ''); } catch (err) { /* 忽略 */ }
}

function show() {
  if (!S.inited) init();
  ensureDom();
  if (S.shown) return;
  S.shown = true;
  S.root.hidden = false;
  S.startGuard = 0;
  const gfx = BR.gfx;
  if (gfx && gfx.scene && gfx.camera) {
    if (S.group.parent !== gfx.scene) gfx.scene.add(S.group);
    S.savedFov = gfx.camera.fov;
    enterEnv();
  }
  if (BR.input && 'enabled' in BR.input) BR.input.enabled = false;
  if (has(BR.audio, 'setAmbient')) BR.audio.setAmbient('fluorescent');
  applySkin();
  S.snapFrame = true;
  S.hintW = 0;
  S.hintX = S.hintY = -1;
  S.last = 0;
  if (!S.raf) S.raf = requestAnimationFrame(loop);
  // 立即摆好一次镜头：main 可能在下一次 rAF 之前就先渲染一帧
  update(0);
}

function hide() {
  if (!S.shown) return;
  closeAll();
  S.shown = false;
  if (S.root) S.root.hidden = true;
  if (S.skinRoot) S.skinRoot.hidden = true;
  setHover(false);
  S.down = null;
  const gfx = BR.gfx;
  if (S.group && S.group.parent) S.group.parent.remove(S.group);
  if (gfx && gfx.camera && S.savedFov) { gfx.camera.fov = S.savedFov; gfx.camera.updateProjectionMatrix(); }
  // 不调 setLightSources([])：world 可能已经推了新层的灯，这里只清空自己那份数组，gfx 若还引用它会自然淡出
  S.lightList.length = 0;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
}

BR.home = {
  init,
  show,
  hide,
  get shown() { return S.shown; },
  // 额外：直接打开模式菜单（例如结算页"返回主页"后想直接选模式）
  openMenu() { show(); openLayer('menu'); },
};
})();
