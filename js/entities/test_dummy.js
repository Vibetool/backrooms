// 测试人：测试模式里召唤的假人。阵营 dummy —— 有害实体会打它，友善实体不理它，它从不还手。
// 穿玩家当前皮肤的后室制服（hazmat.glb + BR.skin.apply）；没有模型时用程序化胶囊体兜底
// 感染症状（2026-09-14，纯表现）：被悲尸划伤后按 e.infection 的阶段画——胸口划痕渗棕色淤泥 + 间歇抽搐、制服往红褐色变、
// 冒脓疱、头部乱晃，感染中倒地后尸体抽搐再挣扎着爬起来。计时和转化归 entities.js（只在房主跑），这里只读阶段号，房主和联机客机画法一样。
// 症状只改本实例自己的材质（ownMaterials 拷的那份），不碰共享材质，别的测试人和玩家皮肤不受影响
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

// ---------- 感染症状（观感调出来的数，可调；时间线本身在 wretch.js 的 CYCLE 里） ----------
const INFECT_HEX = 0x7a4a34;     // 目标色：和悲尸皮肤同色（wretch.js colors.body），看得出是在往悲尸变
const SUIT_RAMP_SEC = 12;        // 第二阶段开始后多久过渡到最终色：一点点变，不是一下子换色
const SUIT_MAX = 0.85;           // 最终色占比：留一点原制服色，还认得出是测试人
const PUS_HEX = 0xb49a5c;        // 脓疱：发黄的脓色，和红褐色的制服拉开
const PUS_GROW_SEC = 1.6;        // 脓疱从皮下顶出来的时长
const PUS_SEG = [7, 5];          // 每颗脓疱的分段
// 脓疱位置：[离地高度 m, 绕身体的方位角（0 = 正前方，正值偏 +X）, 半径 m]；贴到模型表面的深度由射线决定，GLB 和兜底胶囊体都能贴上
const PUSTULES = [[1.24, 0.35, 0.045], [1.04, -0.55, 0.038], [0.9, 0.12, 0.05], [1.3, 2.75, 0.042], [1.12, -1.75, 0.036]];
// 第一阶段一眼能认出来的记号：胸口三道斜爪痕在渗棕色淤泥、下面淌下两道，右臂侧面再抹一块（侧面看过去也有）。
// 为什么要有：只靠抽搐的话，第一阶段九成时间和健康测试人一模一样（验收实测），而用户最初的抱怨正是"咬到测试人后没反应"。
// 依据：选中版本"棕色淤泥，接触后使人开始转变"，第一阶段玩家提示也写"伤口在渗棕色淤泥"，画面和文字对得上；深棕压在黄制服上隔几米也看得清
const SLIME_HEX = 0x3a2313;
const SLIME_GROW_SEC = 1.2;      // 划伤后淤泥从伤口洇开的时长
const SLIME_SEG = [6, 4];
// [离地高度 m, 方位角, 长半轴 m, 短半轴 m, 厚度半轴 m, 倾角（0 = 水平，π/2 = 竖直，正值往 +X 抬）]
const SLIME = [
  [1.21, -0.34, 0.085, 0.014, 0.012, 1.0], [1.17, -0.12, 0.09, 0.015, 0.012, 1.0], [1.13, 0.1, 0.08, 0.013, 0.012, 1.0],   // 三道爪痕
  [1.05, -0.24, 0.05, 0.011, 0.01, 1.52], [1.01, -0.02, 0.045, 0.01, 0.01, 1.52],                                          // 往下淌
  [1.2, 1.5, 0.06, 0.04, 0.012, 0.35],                                                                                     // 右臂侧面
];
// 淤泥划痕和脓疱合成一个网格（只多 1 个 draw call，GLB 测试人本来就有 10 个网格，不能再加）。
// 各块的"长出来"用两组相对形变目标：基础位置是每块的中心点（退化成一个点，画不出东西），
// 形变 0 把淤泥撑到全尺寸、形变 1 把脓疱撑到全尺寸，影响度是每个实例自己的，共享几何不用拷
const SORE_SLIME = 0, SORE_PUS = 1;
// 抽搐：时间切成槽，每槽按 (实体 id, 槽号) 的确定性哈希决定抽不抽、什么时候抽、往哪边抽。
// 不用 Math.random：同一只在房主和客机上抽法一样；也不耗 entities 的 aiRng，不会打乱任何需要同步的随机流。
// 第一阶段的幅度按验收意见加大（原来 0.2 s、约 7° 的小抽动几乎看不出来）：侧倾约 15°、持续近半秒、带一下侧向踉跄
const TWITCH_MILD = { slot: 1.3, chance: 0.9, dur: 0.45, roll: 0.26, pitch: 0.12, lift: 0.03, head: 0.26, sway: 0.05 };   // 第一、二阶段：间歇抽搐
const TWITCH_HARD = { slot: 0.55, chance: 1, dur: 0.32, roll: 0.36, pitch: 0.2, lift: 0.05, head: 0.35, sway: 0.08 };     // 第三阶段：更剧烈、更频繁
const TWITCH_CORPSE = { slot: 0.6, chance: 0.9, dur: 0.16, roll: 0.2, pitch: 0.1, lift: 0.03, head: 0.35, sway: 0 };      // 感染尸体
const HEAD_WOBBLE = 0.32;        // 第三阶段头部持续乱晃的幅度（弧度）
// 感染尸体爬起来：只有房主知道爬起时刻（riseAt 不进快照），客机只看得到抽搐。整件防化服是一个没有骨骼的网格，弯不了腰，
// 只能靠节奏读出"挣扎着起身"：先撑起一半、使不上劲塌回去，再猛地立起来往前冲过头弓着背，最后抖着稳住——
// 替掉原来"整块木板绕脚匀速立起"（验收说像吸血鬼从棺材里立起来）
const RISE_ANIM_SEC = 1.6;
const RISE_KEYS = [[0, Math.PI / 2], [0.3, 1.0], [0.48, 1.32], [0.8, -0.24], [1, -0.1]];   // [进度, 倾角：π/2 仰面躺平、0 站直、负值往前弓]
// 头部零件：GLB 的面罩/面镜/滤毒罐，兜底模型的面具网格（userData.head）。整件防化服是一个网格、没有骨骼，
// 头罩分不出来，只能让面罩这几件绕脖子晃，配合身体抽搐看起来就是在甩头
const HEAD_RE = /(^|_)(mask|visor|filter)$/i;
const SUIT_RE = /^Suit(\.\d+)?$/;

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
  for (const x of g.mask) { const m = new T.Mesh(x, maskMat); m.userData.head = true; root.add(m); }
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

// 闪红、感染变色都要改材质，每个测试人各拷一份（标 entityOwned，移除时由 entities.js 释放）；
// 必须在 skin.apply 之后拷，拷的是已经上好色的防化服。suit 标记给感染变色认制服用
function ownMaterials(root) {
  const map = new Map();
  const list = [];
  const one = (m, suitMesh) => {
    if (!map.has(m)) {
      const c = m.clone();
      c.userData = Object.assign({}, c.userData, {
        entityOwned: true,
        em0: c.emissive ? c.emissive.getHex() : null,
        col0: c.color ? c.color.getHex() : null,
        colNow: null,
        suit: suitMesh || SUIT_RE.test(c.name || '') || !!(c.userData && c.userData.brSuit),
      });
      map.set(m, c);
      list.push(c);
    }
    return map.get(m);
  };
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const suitMesh = !!(o.userData && o.userData.suit === true);
    o.material = Array.isArray(o.material) ? o.material.map(m => one(m, suitMesh)) : one(o.material, suitMesh);
  });
  return list;
}

// 把面罩这几件挂到脖子处的枢轴下，第三阶段才能单独甩头。原点在零件包围盒底部中心、略靠后（脖子的位置）
function makeHead(T, model, pivot) {
  const parts = [];
  model.traverse(o => { if (o.isMesh && (o.userData.head === true || HEAD_RE.test(o.name || ''))) parts.push(o); });
  if (!parts.length) return null;
  pivot.updateMatrixWorld(true);
  const box = new T.Box3();
  for (const m of parts) box.expandByObject(m);
  if (box.isEmpty()) return null;
  const neck = new T.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2 + 0.04);
  const head = new T.Group();
  head.name = 'dummy-head';
  model.add(head);
  model.updateMatrixWorld(true);
  head.position.copy(model.worldToLocal(neck));
  head.updateMatrixWorld(true);
  for (const m of parts) head.attach(m);
  return head;
}

let flashColor = null;
function setFlash(T, mats, k) {
  if (!flashColor) flashColor = new T.Color(FLASH_HEX);
  for (const m of mats) {
    const u = m.userData;
    if (m.emissive && u.em0 !== null) m.emissive.setHex(u.em0).lerp(flashColor, k * 0.85);
    // MeshBasic 没有 emissive：从当前底色（可能已被感染染过）闪，闪完回到染过的颜色而不是原色
    else if (m.color && u.col0 !== null) m.color.setHex(u.colNow !== null ? u.colNow : u.col0).lerp(flashColor, k * 0.6);
  }
}

// ---------- 感染症状 ----------
// 手写的 sRGB 色值：r147 默认不做颜色管理（legacyMode），要先转线性，屏幕上才是本来的颜色（同 skin.js / itemKit）
function linColor(T, hex) {
  const c = new T.Color(hex);
  const cm = T.ColorManagement;
  if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
  return c;
}
let infectColor = null;

function tintSuit(T, u, k) {
  if (!infectColor) infectColor = linColor(T, INFECT_HEX);
  for (const m of u.mats) {
    const d = m.userData;
    if (!d.suit || !m.color || d.col0 === null) continue;
    m.color.setHex(d.col0).lerp(infectColor, k);
    d.colNow = k > 0 ? m.color.getHex() : null;
  }
  u.tint = k;
}

function smooth(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

// 32 位整数哈希 → [0, 1)
function hash01(a, b) {
  let h = Math.imul(a ^ Math.imul(b | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 抽搐量写进 tw（模块级复用对象，每帧不 new）：v 0..1 的抽动强度，sr/sp 侧倾和前后的方向，sh 甩头方向
const tw = { v: 0, sr: 1, sp: 1, sh: 0 };
function twitchAt(seed, cfg, t) {
  tw.v = 0;
  const k = Math.floor(t / cfg.slot);
  if (hash01(seed, k) >= cfg.chance) return tw;
  const start = k * cfg.slot + hash01(seed + 1, k) * (cfg.slot - cfg.dur);
  const x = (t - start) / cfg.dur;
  if (x < 0 || x > 1) return tw;
  // 正弦包络上叠一点高频颤动：像肌肉痉挛那样一抽一抖，而不是平滑地晃一下
  tw.v = Math.sin(Math.PI * x) * (0.75 + 0.25 * Math.sin(x * 38));
  tw.sr = hash01(seed + 2, k) < 0.5 ? -1 : 1;
  tw.sp = hash01(seed + 3, k) < 0.5 ? -1 : 1;
  tw.sh = hash01(seed + 4, k) * 2 - 1;
  return tw;
}

// 爬起动作的倾角：关键帧之间用 smoothstep，每一段都是"蓄力—到位"，比线性插值更像使劲
function riseLean(r) {
  for (let i = 1; i < RISE_KEYS.length; i++) {
    const a = RISE_KEYS[i - 1], b = RISE_KEYS[i];
    if (r <= b[0]) return a[1] + (b[1] - a[1]) * smooth((r - a[0]) / (b[0] - a[0]));
  }
  return RISE_KEYS[RISE_KEYS.length - 1][1];
}

// 同一种模型（GLB / 兜底）的测试人伤口和脓疱贴法一样：几何按模型种类缓存共享，不随实例释放；第一次有测试人被感染时才算
const soresGeoCache = new Map();

// 把各块（完整形状 + 中心点 + 颜色 + 属于哪组）合成一个带顶点色和两组相对形变的几何，见 SORE_SLIME / SORE_PUS 的说明
function mergeSores(T, parts) {
  const base = [], nor = [], col = [], dSlime = [], dPus = [], idx = [];
  for (const s of parts) {
    const p = s.g.attributes.position, n = s.g.attributes.normal, off = base.length / 3;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - s.c.x, dy = p.getY(i) - s.c.y, dz = p.getZ(i) - s.c.z;
      base.push(s.c.x, s.c.y, s.c.z);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(s.col.r, s.col.g, s.col.b);
      if (s.group === SORE_SLIME) { dSlime.push(dx, dy, dz); dPus.push(0, 0, 0); }
      else { dSlime.push(0, 0, 0); dPus.push(dx, dy, dz); }
    }
    for (let i = 0; i < s.g.index.count; i++) idx.push(s.g.index.getX(i) + off);
    s.g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(base, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.morphAttributes.position = [];
  out.morphAttributes.position[SORE_SLIME] = new T.Float32BufferAttribute(dSlime, 3);
  out.morphAttributes.position[SORE_PUS] = new T.Float32BufferAttribute(dPus, 3);
  out.morphTargetsRelative = true;
  out.computeBoundingSphere();   // r147 会把形变量算进包围球，完全长出来时也不会被视锥剔掉
  return out;
}

function soresGeo(T, u, root) {
  const cached = soresGeoCache.get(u.kind);
  if (cached) return cached;
  // 从身体外面朝中轴打射线找表面：先把枢轴上的后仰/抽搐/踉跄和头的甩动清零，算完再还原（结果按模型种类缓存，不能带上某一帧的姿势）
  const piv = u.pivot, head = u.head;
  const saved = [piv.rotation.x, piv.rotation.y, piv.rotation.z, piv.position.x, piv.position.y];
  const hr = head ? [head.rotation.x, head.rotation.y, head.rotation.z] : null;
  piv.rotation.set(0, 0, 0);
  piv.position.x = 0;
  piv.position.y = 0;
  if (head) head.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  const o = new T.Vector3(), d = new T.Vector3();
  // 高度 h、方位角 az 处的模型表面（枢轴局部坐标）
  const surface = (h, az) => {
    const dx = Math.sin(az), dz = -Math.cos(az);
    o.set(dx * 1.2, h, dz * 1.2);
    piv.localToWorld(o);
    d.set(-dx, 0, -dz).transformDirection(piv.matrixWorld);
    ray.set(o, d);
    ray.far = 1.2;
    const hit = ray.intersectObject(u.model, true)[0];
    if (hit) { const q = piv.worldToLocal(hit.point.clone()); return new T.Vector3(q.x, h, q.z); }
    return new T.Vector3(dx * 0.2, h, dz * 0.2);   // 没打到（模型异常）就贴在 0.2 m 半径上
  };
  const parts = [];
  const slimeCol = linColor(T, SLIME_HEX), pusCol = linColor(T, PUS_HEX);
  const up = new T.Vector3(0, 1, 0), n = new T.Vector3(), t = new T.Vector3(), la = new T.Vector3(), wa = new T.Vector3();
  const M = new T.Matrix4(), sc = new T.Vector3();
  for (const p of SLIME) {
    // 压扁的椭球贴在表面：长轴沿划痕方向、短轴在表面内、最薄的一轴朝外；中心往外挪三成厚度，里面一半藏进衣服，看着是糊在表面的一层
    const c = surface(p[0], p[1]);
    n.set(Math.sin(p[1]), 0, -Math.cos(p[1]));
    t.set(Math.cos(p[1]), 0, Math.sin(p[1]));
    la.copy(t).multiplyScalar(Math.cos(p[5])).addScaledVector(up, Math.sin(p[5]));
    wa.crossVectors(n, la).normalize();   // la × wa = n，基是右手系，面的朝向不会被翻过来
    c.addScaledVector(n, p[4] * 0.3);
    M.makeBasis(la, wa, n).scale(sc.set(p[2], p[3], p[4])).setPosition(c);
    const g = new T.SphereGeometry(1, SLIME_SEG[0], SLIME_SEG[1]);
    g.applyMatrix4(M);
    parts.push({ g, c, col: slimeCol, group: SORE_SLIME });
  }
  for (const p of PUSTULES) {
    const c = surface(p[0], p[1]);
    c.x += Math.sin(p[1]) * p[2] * 0.35;   // 往外露出三分之一多，看得出是鼓包
    c.z += -Math.cos(p[1]) * p[2] * 0.35;
    parts.push({ g: new T.SphereGeometry(p[2], PUS_SEG[0], PUS_SEG[1]).translate(c.x, c.y, c.z), c, col: pusCol, group: SORE_PUS });
  }
  piv.rotation.set(saved[0], saved[1], saved[2]);
  piv.position.x = saved[3];
  piv.position.y = saved[4];
  if (head) head.rotation.set(hr[0], hr[1], hr[2]);
  root.updateMatrixWorld(true);
  const g = mergeSores(T, parts);
  soresGeoCache.set(u.kind, g);
  return g;
}

function ensureSores(T, u, root) {
  if (u.sores) return u.sores;
  // 材质是本实例独有的：挨打闪红要跟着闪（改的是 emissive），移除时由 entities.js 按 entityOwned 释放；颜色走顶点色
  const mat = new T.MeshLambertMaterial({ vertexColors: true });
  mat.userData = { entityOwned: true, em0: mat.emissive.getHex(), col0: mat.color.getHex(), colNow: null, suit: false };
  const mesh = new T.Mesh(soresGeo(T, u, root), mat);   // 构造时按几何的形变组数建好 morphTargetInfluences（本实例独有）
  mesh.name = 'dummy-sores';
  mesh.visible = false;
  u.pivot.add(mesh);
  u.mats.push(mat);
  u.sores = mesh;
  return mesh;
}

function symptoms(T, e, u, inf, now) {
  // 制服变色：第二阶段起逐渐变红褐，第三阶段保持最终色；没感染就是原色
  let k = 0;
  if (inf) {
    if (inf.stage >= 2) k = SUIT_MAX;
    // 先快后慢（ease-out）：进第二阶段一两秒就看得出在变色，后面慢慢沉到最终色；smoothstep 开头太平，头几秒像没变
    else if (inf.stage === 1) { const x = Math.min(1, Math.max(0, (now - inf.stageAt) / SUIT_RAMP_SEC)); k = SUIT_MAX * (1 - (1 - x) * (1 - x)); }
  }
  if (Math.abs(k - u.tint) > 0.002 || (k === 0 && u.tint > 0)) tintSuit(T, u, k);

  // 伤口淤泥：一感染上就从伤口洇开；脓疱：第二阶段从皮下顶出来，长满后跟着微微起伏
  if (inf) {
    const m = ensureSores(T, u, e.obj);
    const w = m.morphTargetInfluences;
    if (u.slimeAt === null) u.slimeAt = now;
    m.visible = true;
    w[SORE_SLIME] = smooth((now - u.slimeAt) / SLIME_GROW_SEC);
    if (inf.stage >= 1) {
      if (u.pusAt === null) u.pusAt = now;
      const g = (now - u.pusAt) / PUS_GROW_SEC;
      w[SORE_PUS] = smooth(g) + (g >= 1 ? 0.05 * Math.sin(now * 2.6 + (u.seed & 63)) : 0);
    } else {
      w[SORE_PUS] = 0;
      u.pusAt = null;
    }
  } else if (u.sores && u.sores.visible) {
    u.sores.visible = false;
    u.slimeAt = null;
    u.pusAt = null;
  }
}

BR.entityTypes.register({
  type: 'test_dummy', en: 'Test Dummy', zh: '测试人', version: 'test',
  faction: 'dummy',
  // 人类目标：悲尸这类"划伤就感染"的攻击只对玩家和 human 实体生效（BR.entities.isHuman）
  human: true,
  hp: 100, radius: 0.3, height: HEIGHT,
  // 玩家步行速度的一半（用户定死）
  speed: { walk: BR.config.player.walk * 0.5, run: BR.config.player.walk * 0.5 },
  perception: { sight: 0, hearing: 0, fov: 360 },

  build(ctx) {
    const T = ctx.THREE;
    let model = BR.assets && typeof BR.assets.modelSync === 'function' ? BR.assets.modelSync('hazmat') : null;
    const kind = model ? 'glb' : 'fallback';
    if (model) fitModel(T, model);
    else model = fallbackModel(T);
    if (BR.skin && typeof BR.skin.apply === 'function') {
      try { BR.skin.apply(model); } catch (err) { console.warn('[test_dummy] 皮肤上色失败', err); }
    }
    const mats = ownMaterials(model);
    // 后仰、倒地转的是这个枢轴（原点在脚底），根节点的位置和 yaw 归 entities.js 管
    const pivot = new T.Group();
    pivot.add(model);
    const head = makeHead(T, model, pivot);
    const root = new T.Group();
    root.add(pivot);
    const id = ctx.entity && ctx.entity.id != null ? String(ctx.entity.id) : 'dummy';
    root.userData.dummy = {
      pivot, model, head, kind, mats, flash: 0, deadAt: null, phase: 0, lx: NaN, lz: NaN,
      seed: BR.util.hashStr(id), tint: 0, sores: null, slimeAt: null, pusAt: null,
    };
    return root;
  },

  // 随机游走：wander 隔几秒换方向、撞墙换向
  think(e, dt, api) {
    e.state = api.wander(e, BR.config.player.walk * 0.5) ? 'walk' : 'idle';
  },

  // 倒地 3 秒后由 entities.js 移除并发 entity:kill（感染中被打死时 entities.js 改成爬起来变悲尸）
  onDeath() { return CORPSE_SEC; },

  animate(e, dt, api) {
    const u = e.obj && e.obj.userData.dummy;
    if (!u) return;
    const T = typeof THREE !== 'undefined' ? THREE : null;
    const now = api.time;
    const inf = e.infection;
    let lean = 0, lift = 0, flash = 0, roll = 0, sway = 0, hx = 0, hy = 0, hz = 0;

    if (e.state === 'dead') {
      if (u.deadAt === null) u.deadAt = now;
      const k = Math.min(1, (now - u.deadAt) / FALL_SEC);
      lean = Math.PI / 2 * k * k;          // 越倒越快，像被推倒而不是慢慢躺下
      lift = LIE_LIFT * k;
      flash = Math.max(0, 1 - (now - u.deadAt) / 0.4);
      if (inf && k >= 1) {
        // 感染尸体：躺平后一阵阵抽搐
        const c = twitchAt(u.seed, TWITCH_CORPSE, now);
        roll = c.v * TWITCH_CORPSE.roll * c.sr;
        lean += c.v * TWITCH_CORPSE.pitch * c.sp;
        lift += c.v * TWITCH_CORPSE.lift;
        hz = c.v * TWITCH_CORPSE.head * c.sh;
        if (inf.riseAt != null && now > inf.riseAt - RISE_ANIM_SEC) {
          // 房主快到爬起时刻：撑起 → 塌回去 → 猛地立起往前冲过头 → 抖着稳住，随后被换成悲尸（"尸体抽搐后爬起来"）
          const r = Math.min(1, 1 - (inf.riseAt - now) / RISE_ANIM_SEC);
          const base = riseLean(r);
          // 撑起、塌回去那两段抖得最凶（使不上劲），立起来之后只剩余颤
          const strain = r < 0.5 ? 1 : Math.max(0, 1 - (r - 0.5) / 0.5);
          const shake = Math.sin(now * 33 + (u.seed & 7)) * strain;
          lean = base + shake * 0.05;
          roll = shake * 0.14 + roll * 0.3;
          lift = LIE_LIFT * Math.max(0, Math.min(1, base / (Math.PI / 2)));
          // 头：撑起时耷拉着往后仰，立起那一下甩到前面，最后低着头
          hx = r < 0.48 ? 0.45 * smooth(r / 0.3) : 0.45 - 0.8 * smooth((r - 0.48) / 0.32);
          hz = shake * 0.2;
        }
      }
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
      if (inf && inf.stage >= 0) {
        // 第一阶段起就间歇抽搐（抽的时候往一边踉跄），第三阶段换成剧烈版并且头部持续乱晃
        const cfg = inf.stage >= 2 ? TWITCH_HARD : TWITCH_MILD;
        const c = twitchAt(u.seed, cfg, now);
        roll = c.v * cfg.roll * c.sr;
        sway = -c.v * cfg.sway * c.sr;   // 上身往哪边歪、脚下就往哪边滑一步，像没站稳
        lean += c.v * cfg.pitch * c.sp;
        lift += c.v * cfg.lift;
        hz = c.v * cfg.head * c.sh;
        hx = c.v * cfg.head * 0.5 * c.sp;
        if (inf.stage >= 2) {
          const p = (u.seed & 1023) / 163;
          hx += HEAD_WOBBLE * (0.6 * Math.sin(now * 7.3 + p) + 0.4 * Math.sin(now * 12.9 + p * 2));
          hz += HEAD_WOBBLE * (0.6 * Math.sin(now * 5.1 + p * 3) + 0.4 * Math.sin(now * 13.7));
          hy = HEAD_WOBBLE * 0.7 * Math.sin(now * 3.9 + p);
        }
      }
    }
    u.lx = e.x; u.lz = e.z;
    u.pivot.rotation.x = lean;
    u.pivot.rotation.z = roll;
    u.pivot.position.x = sway;
    u.pivot.position.y = lift;
    if (u.head) u.head.rotation.set(hx, hy, hz);
    if (!T) return;
    if (inf || u.tint > 0 || u.sores) symptoms(T, e, u, inf, now);
    // 只在闪烁值变化时改材质
    if (flash > 0 || u.flash > 0) { setFlash(T, u.mats, flash); u.flash = flash; }
  },
});
})();
