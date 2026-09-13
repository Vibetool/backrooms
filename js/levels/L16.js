// Level 16 - "地形转变"（Altered Topography）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-16  许可：CC BY-SA 3.0
// 中文站译自英文站 DrBobtail 的原页面，译者 Lambda Core。data/lore-choices.json levels["16"].source = "wikidot-cn"
// 只按这一个版本实现：不借 fandom 完全不同的主题（无限重复的废弃精神病院、Wretches/Facelings/Windows、
// M.E.G. 前哨 Asylum Archivers、Level 0.7/3/4/14/17 出口等）——这些都在 conflicts 列表里，全部不做。
// 选中版本本身分两份"文件"：文件1 = 雨林形态（生存等级 0），文件2 = 冰原形态（生存等级 unknown）。
// 页面反复强调"整层地形会隔一段未知时间整体改变"——这是本层唯一的核心机制，本文件把它做成两套完整地形
// 同时建好、按全层共享的计时器切换可见性（第 14 节 update 里的 syncChunkVisibility），而不是各区块各转各的。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// file:// 双击兜底：贴图文件读不到时的程序化画法（TEMPLATE 15 节步骤 7）
BR.assets.registerProcedural('l16_moss_ground', 256, (g, s) => {
  g.fillStyle = '#3a4028'; g.fillRect(0, 0, s, s);
  const r = U.rng('l16_moss_ground');
  for (let k = 0; k < 900; k++) {
    const v = 30 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v + 20},${v + 30},${v},0.4)`;
    g.fillRect(r() * s, r() * s, 2 + r() * 3, 2 + r() * 3);
  }
});
BR.assets.registerProcedural('l16_ice_surface', 256, (g, s) => {
  g.fillStyle = '#cfe0ea'; g.fillRect(0, 0, s, s);
  const r = U.rng('l16_ice_surface');
  for (let k = 0; k < 260; k++) {
    const v = 190 + (r() * 40 | 0);
    g.fillStyle = `rgba(${v},${v + 8},${v + 16},0.3)`;
    g.fillRect(r() * s, r() * s, 1, 16 + r() * 40);   // 细长条近似冰面裂纹
  }
});

// ---------- 尺寸 ----------
// 依据 layout「开阔的户外自然地形（不是迷宫也不是房间串联）」——本层完全不用格子迷宫，
// 取开阔层区间（TEMPLATE 16 节 32–48）里的中间值
const SIZE = 40;
const H = 6;   // 只是名义"天空高度"，本层没有天花板，不影响玩法

// ---------- 地形转变节奏 ----------
// 依据 mechanics「层级每隔未知的时间改变地形」——原文没给周期数字，自定一个够玩家在单次改变前
// 充分探索一种形态、又能在一次游玩里真的看到转变发生的节奏：300 秒一轮，雨林/冰原各占一半
const CYCLE = 300, STABLE = 150;
// 依据 lighting「地形变化前会有小型球状物围在身边，像是警告」——原文写在文件2字段里但措辞是
// "地形变化前"，没有限定只朝哪个方向变，这里对两个方向的转变都生效
const WARN = 15;
// 依据 lighting「文件2：约 13 小时一次昼夜循环」——13 小时真实时长在一局游戏里几乎感受不到变化，
// 压缩成 80 秒一轮（TEMPLATE③：真实数值换算成游戏可行档位并注释），只在冰原形态生效（文件1明确没有昼夜循环）
const ICE_DAY_PERIOD = 80;

function isLandmarkChunk(cx, cz) {
  // 依据 landmarks「覆盖着沙子的树/冰层」——出口地标按周期重复出现（规则②），
  // 用 (2,2) 而不是 (0,0) 起步，让出生区块保持普通地形、不和出口地标重叠；
  // 4 格周期下任意区块到最近地标区块的切比雪夫距离 ≤ 2，远小于"3–5 块内找得到"的要求
  const mx = ((cx % 4) + 4) % 4, mz = ((cz % 4) + 4) % 4;
  return mx === 2 && mz === 2;
}

function phaseAt(t) {
  const tm = ((t % CYCLE) + CYCLE) % CYCLE;
  if (tm < STABLE) return { form: 'jungle', warning: tm >= STABLE - WARN };
  const ti = tm - STABLE;
  return { form: 'ice', warning: ti >= STABLE - WARN };
}

// ---------- 材质 ----------
function defineMaterials() {
  kit.mats({
    'L16:groundJungle': { tex: 'l16_moss_ground', repeatMeters: 6, roughness: 1 },
    // 依据 materials「冰（表面发光且反射率高）」——issue①验收指出原版哑光发灰认不出是冰：
    // 直接给 shininess/specular 而不是走 roughness 自动换算，保证有明显高光；emissive 加一点自身冷光
    'L16:groundIce':    { tex: 'l16_ice_surface', repeatMeters: 7, shininess: 130, specular: 0xffffff,
                          emissive: 0x24435c, emissiveIntensity: 0.12 },
    // 树冠/林下镂空叶片卡片：lambert + alphaTest 镂空（同 L10 麦穗贴图的手法），双面可见，顶点色染深浅绿
    'L16:foliage': { type: 'lambert', map: leafCardTexture(), alphaTest: 0.35, side: 'double', vertexColors: true, color: 0xffffff },
    // 冰川/巨石本体：同一份高反射材质，靠 vertexColors 区分冰的蓝白与石的灰蓝
    'L16:ice': { type: 'phong', vertexColors: true, color: 0xffffff, shininess: 130, specular: 0xffffff,
                 emissive: 0x1c3550, emissiveIntensity: 0.16 },
  });
}

// ---------- 雨林树冠"多团"几何池：小型二十面体按顶点外扩抖动，做出不规则团块轮廓 ----------
// issue①证据：原版是 2-3 个纯色圆锥叠起来，近看是"平的七边形锥面"，像圣诞树。改成多个扰动过的球状团块
// 拼在一起（阔叶树冠常见的"一团团"轮廓），比单一圆锥更接近"茂密雨林"的阔叶树形态
let canopyGeos = null;
function canopyBlobGeometries() {
  if (canopyGeos) return canopyGeos;
  const r = U.rng('L16-canopy-blobs');
  canopyGeos = [0.62, 0.78, 0.92, 1.05, 1.18].map(size => {
    const g = new THREE.IcosahedronGeometry(size, 0);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v), vy = pos.getY(v), vz = pos.getZ(v);
      const len = Math.hypot(vx, vy, vz) || 1;
      const k = 0.7 + r() * 0.55;   // 半径抖动，避免正圆球
      pos.setXYZ(v, (vx / len) * size * k, (vy / len) * size * k * 0.82, (vz / len) * size * k);
    }
    g.computeVertexNormals();
    return g;
  });
  return canopyGeos;
}

// 阔叶镂空卡片贴图：随机画若干片叶形（尖椭圆+主脉），背景透明，配合 alphaTest 镂空（同 L10 麦穗贴图手法）
let leafTex = null;
function leafCardTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = U.rng('L16-leaf-card');
  for (let k = 0; k < 12; k++) {
    const cx0 = 30 + r() * 196, cy0 = 30 + r() * 196;
    const w = 26 + r() * 34, h = 54 + r() * 70, rot = r() * Math.PI * 2;
    const v = 60 + (r() * 70 | 0);
    g.save(); g.translate(cx0, cy0); g.rotate(rot);
    g.fillStyle = `rgb(${v - 10},${v + 55},${v - 20})`;
    g.beginPath();
    g.moveTo(0, -h / 2);
    g.quadraticCurveTo(w / 2, -h * 0.08, 0, h / 2);
    g.quadraticCurveTo(-w / 2, -h * 0.08, 0, -h / 2);
    g.fill();
    g.strokeStyle = 'rgba(20,45,20,0.55)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -h / 2); g.lineTo(0, h / 2); g.stroke();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.encoding = THREE.sRGBEncoding;
  return leafTex;
}
// 一张叶片贴图立成十字交叉的两片四边形（同 L10 crop 的十字卡片手法），底边在原点
let leafGeo = null;
function leafCardGeometry() {
  if (leafGeo) return leafGeo;
  const merge = THREE.BufferGeometryUtils.mergeBufferGeometries;
  const a = new THREE.PlaneGeometry(1.5, 1.5).translate(0, 0.75, 0);
  const b2 = a.clone().rotateY(Math.PI / 2);
  leafGeo = merge([a, b2]);
  a.dispose(); b2.dispose();
  return leafGeo;
}
// 林下蕨类/灌木：同一张叶片卡片缩小当灌木用，纯粹为了让地面不再空荡（materials 没细分林下植被种类，unverified，
// 不代表设定认定有具体物种，只是给"茂密"补一层视觉层次）
let fernGeo = null;
function fernGeometry() {
  if (fernGeo) return fernGeo;
  fernGeo = leafCardGeometry().clone();
  fernGeo.scale(0.55, 0.55, 0.55);
  return fernGeo;
}

// ---------- 冰原"冰川/巨石"几何池：正二十面体/十二面体按顶点外扩抖动，做出参差尖锐的多面体 ----------
// issue①(冰原部分)证据：原版是 2-3 个小号纯色长方块叠起来，像灰色水泥块。改成扰动顶点的多面体，
// 尺度做到数米高（依据 hazards「冰川从地面拔起」），顶点始终 y>=0 让"根"落在地面、往上扬起
let iceGeos = null;
function iceBlobGeometries() {
  if (iceGeos) return iceGeos;
  const r = U.rng('L16-ice-blobs');
  iceGeos = [1.2, 2.0, 3.0, 4.4].map(size => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v), vy = pos.getY(v), vz = pos.getZ(v);
      const len = Math.hypot(vx, vy, vz) || 1;
      const spike = (0.65 + r() * 0.65) * size;
      pos.setXYZ(v, (vx / len) * spike, Math.abs(vy / len) * spike * 1.7, (vz / len) * spike);
    }
    g.computeVertexNormals();
    return g;
  });
  return iceGeos;
}
let boulderGeos = null;
function iceBoulderGeometries() {
  if (boulderGeos) return boulderGeos;
  const r = U.rng('L16-ice-boulders');
  boulderGeos = [0.9, 1.4, 2.1].map(size => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v), vy = pos.getY(v), vz = pos.getZ(v);
      const len = Math.hypot(vx, vy, vz) || 1;
      const jitter = (0.82 + r() * 0.32) * size;
      pos.setXYZ(v, (vx / len) * jitter, Math.abs(vy / len) * jitter, (vz / len) * jitter);
    }
    g.computeVertexNormals();
    return g;
  });
  return boulderGeos;
}

// ---------- 雨林形态装饰：树（依据 materials「树木…雾…本地原生生物」）----------
function buildJungleTree(b, x, z, rng, out) {
  const trunkH = 2.4 + rng() * 2.0;
  // medium issue③：树干打开碰撞（原来显式 solid:false，玩家能直接穿过树干）
  out.push(b.cylinder(x, 0, z, 0.16 + rng() * 0.07, trunkH, 'kit:prop', { segments: 6, color: 0x4a3524, solid: true }));

  // 树冠：4-6 团扰动几何拼成不规则轮廓，替换原来的圆锥叠罗汉（issue①）；树冠本身不参与碰撞（可以从枝叶间穿过）
  const blobs = canopyBlobGeometries();
  const canopyY = trunkH * 0.82;
  const lobes = 4 + (rng() < 0.5 ? 0 : 2);
  for (let i = 0; i < lobes; i++) {
    const geo = blobs[(rng() * blobs.length) | 0];
    const ang = rng() * Math.PI * 2, rad = rng() * 0.85;
    const hue = rng();
    const green = hue < 0.35 ? 0x2f6a1e : hue < 0.7 ? 0x3f8028 : 0x5a9a34;
    out.push(b.mesh(geo, 'kit:prop', {
      x: x + Math.cos(ang) * rad, y: canopyY + (rng() - 0.3) * 0.8, z: z + Math.sin(ang) * rad,
      rotY: rng() * Math.PI * 2, color: green, solid: false,
    }));
  }

  // 镂空叶片卡片贴在树冠外沿：近看能看出阔叶形状，不再是"平的锥面"（issue①证据）
  const leaf = leafCardGeometry();
  const cards = 3 + (rng() < 0.5 ? 0 : 2);
  for (let i = 0; i < cards; i++) {
    const ang = rng() * Math.PI * 2, rad = 0.5 + rng() * 0.75;
    const green = rng() < 0.5 ? 0x3f8028 : 0x5a9a34;
    out.push(b.mesh(leaf, 'L16:foliage', {
      x: x + Math.cos(ang) * rad, y: canopyY + (rng() - 0.2) * 0.9, z: z + Math.sin(ang) * rad,
      rotY: rng() * Math.PI * 2, color: green, solid: false, uv: 'stretch',
    }));
  }

  // 依据 other「微弱重力，只影响外来的物体和实体」——引擎没有可调重力（apiRequests），
  // 只做一片静止悬浮在半空的落叶做视觉暗示，不真的改变下落速度
  if (rng() < 0.3) {
    const fy = 1.0 + rng() * 1.5;
    out.push(b.plane(x + (rng() - 0.5) * 1.5, fy, z + (rng() - 0.5) * 1.5, 0.3, 0.3, 'L16:foliage',
      { facing: '+z', color: 0x5a7a3a, rotY: rng() * Math.PI * 2, solid: false, uv: 'stretch' }));
  }

  // 藤蔓：树冠边缘垂下的细枝（materials 没细分具体植被种类，unverified，只是给"茂密"添一点层次）
  if (rng() < 0.35) {
    const vineH = 1.2 + rng() * 1.6, ang = rng() * Math.PI * 2, rad = 0.55 + rng() * 0.5;
    const vx = x + Math.cos(ang) * rad, vz = z + Math.sin(ang) * rad;
    out.push(b.cylinder(vx, Math.max(0, canopyY - vineH), vz, 0.025, vineH, 'kit:prop',
      { segments: 4, color: 0x33531f, solid: false }));
  }
}

// 林下蕨类/灌木：纯视觉、不参与碰撞，用独立随机流（同 L10 buildCrops 的做法），不影响 CLUSTERS/刷新点主序列
function scatterFerns(b, ctx, cx, cz, isSpawn, landmark) {
  const r = U.rng(ctx.levelSeed, 'L16-fern', cx, cz);
  const geo = fernGeometry();
  const out = [];
  for (let k = 0; k < 34; k++) {
    const x = r() * SIZE, z = r() * SIZE;
    if (isSpawn && Math.hypot(x - SIZE / 2, z - SIZE / 2) < 3.4) continue;
    if (landmark && Math.hypot(x - SIZE / 2, z - SIZE / 2) < 3.2) continue;
    const green = r() < 0.5 ? 0x2f6a24 : 0x4a8a2e;
    out.push(b.mesh(geo, 'L16:foliage', { x, y: 0, z, rotY: r() * Math.PI * 2, color: green, solid: false, uv: 'stretch' }));
  }
  return out;
}

// ---------- 冰原形态装饰：冰川/巨石（依据 materials「冰川、巨石、河水」）----------
function buildIceFeature(b, x, z, rng, out) {
  const blobs = iceBlobGeometries(), boulders = iceBoulderGeometries();
  const hueRoll = rng();
  const col = hueRoll < 0.4 ? 0xd7e6ee : hueRoll < 0.75 ? 0xc3d8e2 : 0xeaf3f8;
  const isGlacier = rng() < 0.6;
  if (isGlacier) {
    out.push(b.mesh(blobs[(rng() * blobs.length) | 0], 'L16:ice',
      { x, y: 0, z, rotY: rng() * Math.PI * 2, color: col, solid: false }));
    if (rng() < 0.4) {
      // 偶尔紧挨着再来一座小一点的，形成参差的冰川群，而不是单独一块（issue①证据：原版孤零零的单个方块）
      const ang = rng() * Math.PI * 2, dist = 0.9 + rng() * 0.6;
      out.push(b.mesh(blobs[(rng() * blobs.length) | 0], 'L16:ice', {
        x: x + Math.cos(ang) * dist, y: 0, z: z + Math.sin(ang) * dist,
        rotY: rng() * Math.PI * 2, color: col, solid: false,
      }));
    }
  } else {
    out.push(b.mesh(boulders[(rng() * boulders.length) | 0], 'L16:ice',
      { x, y: 0, z, rotY: rng() * Math.PI * 2, color: 0x9fb2bd, solid: false }));
  }
  // medium issue③：冰川/巨石打开碰撞。但不直接把 solid 挂在数米高的锯齿几何上——_kit.js 的 Piece.setVisible
  // 只改渲染顶点，不会撤回已经登记的 solid（_kit.js:543 起的 setVisible 只碰 mesh 顶点），雨林/冰原共用
  // 同一批 (x,z)（第 140 行注释），如果碰撞体跟着尖角外接盒走，另一形态里就会在这个位置留下一块和外接盒
  // 等大的隐形墙。这里单独给一个和树干同量级的小方块碰撞体，两种形态叠在同一地点时都只多一个不起眼的小块
  const cw = 0.55 + rng() * 0.3;
  b.solid(x - cw, 0, z - cw, x + cw, 2.4, z + cw);
  // 依据 landmarks「巨石中喷出河水」——只能表现成常驻的融水痕迹，做不出"地形变化瞬间喷涌"的动画
  // （Piece 不能改变形/位置，见 apiRequests）；改成一条细长带状水面，比原来的小方块水洼更像"河水"
  if (rng() < 0.4) {
    const ang2 = rng() * Math.PI * 2;
    out.push(b.plane(x + Math.cos(ang2) * 0.9, 0.02, z + Math.sin(ang2) * 0.9, 0.9, 3.4, 'kit:water',
      { facing: 'up', rotY: rng() * Math.PI * 2 }));
  }
}

// ---------- 出口地标：文件1「覆盖沙子的树」/文件2「覆盖沙子的冰层」→ Level 46（范围外，kit 自动 sealed）----------
function buildSandTree(b, x, z, out) {
  const trunkH = 2.6;
  out.push(b.cylinder(x, 0, z, 0.26, trunkH, 'kit:prop', { segments: 7, color: 0xcdb37a, solid: false }));
  out.push(b.cylinder(x, trunkH * 0.4, z, 1.1, 1.0, 'kit:prop', { rTop: 0.15, segments: 8, color: 0x3f6b2c, solid: false }));
  out.push(b.cylinder(x, trunkH * 0.75, z, 0.8, 0.8, 'kit:prop', { rTop: 0.1, segments: 8, color: 0x4a7a34, solid: false }));
}
function buildSandIce(b, x, z, out) {
  out.push(b.plane(x, 0.02, z, 2.6, 2.6, 'kit:prop', { facing: 'up', color: 0xcdb37a }));
}

function scatterSpawnPoints(b, rng, isSpawn) {
  // 依据 TEMPLATE 7.4「不用格子的层…规则网格 + rng 抖动，每块 ≥ 20 个」——6×6=36 个，出生块附近留出空地
  const n = 6;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const bx = (i + 0.5) * (SIZE / n) + (rng() - 0.5) * 2.4;
      const bz = (j + 0.5) * (SIZE / n) + (rng() - 0.5) * 2.4;
      if (isSpawn && Math.hypot(bx - SIZE / 2, bz - SIZE / 2) < 3) continue;
      b.spawn(bx, bz, 'floor', { safe: isSpawn });
    }
  }
}

// ---------- 区块 ----------
// rng 消耗顺序固定：地标（不吃 rng）→ 装饰簇位置与内容 → 刷新点。只用传进来的 rng；
// 林下蕨类是纯视觉、不参与碰撞，走独立的 ctx.levelSeed 派生流（同 L10 buildCrops），不占用这条主序列
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const isSpawn = cx === 0 && cz === 0;
  const landmark = isLandmarkChunk(cx, cz);
  const b = kit.builder(ctx, cx, cz, rng, { height: H });

  const jungle = [], ice = [];
  jungle.push(kit.prop.floor(b, null, null, 0, { matKey: 'L16:groundJungle' }));
  ice.push(kit.prop.floor(b, null, null, 0, { matKey: 'L16:groundIce' }));

  if (landmark) {
    const lx = SIZE / 2, lz = SIZE / 2;
    buildSandTree(b, lx, lz, jungle);
    buildSandIce(b, lx, lz, ice);
    kit.exit(b, {
      to: '46', kind: 'zone', x: lx, z: lz, radius: 2.4, marker: true,
      label: '被沙覆盖的树 / 被沙覆盖的冰层，隐约能感觉到别处的引力 (exits[0]/[1])',
    });
  }

  // issue①：原来每块只有 5 棵，稀疏得像空地。提到几十棵量级（依据 architecture「茂密的雨林生态系统」）；
  // 雨林树与冰原冰川/巨石共用同一批 (x,z)（medium issue③的碰撞近似依赖这一点），边界留宽一点给更大的形体
  const CLUSTERS = 32;
  for (let k = 0; k < CLUSTERS; k++) {
    const x = 4 + rng() * (SIZE - 8);
    const z = 4 + rng() * (SIZE - 8);
    const nearSpawn = isSpawn && Math.hypot(x - SIZE / 2, z - SIZE / 2) < 7;
    const nearLandmark = landmark && Math.hypot(x - SIZE / 2, z - SIZE / 2) < 6;
    if (nearSpawn || nearLandmark) continue;
    buildJungleTree(b, x, z, rng, jungle);
    buildIceFeature(b, x, z, rng, ice);
  }
  // 林下蕨类/灌木（只在雨林形态出现，issue①里"没有灌木、蕨类"的部分）
  for (const p of scatterFerns(b, ctx, cx, cz, isSpawn, landmark)) jungle.push(p);

  scatterSpawnPoints(b, rng, isSpawn);

  // 初始显隐按当前全层形态给一次（第 14 节 update 每帧还会再校正一遍，避免刚建好的区块两种地形都可见）
  const wantJungle = S.form === 'jungle';
  for (const p of jungle) if (p) p.setVisible(wantJungle);
  for (const p of ice) if (p) p.setVisible(!wantJungle);

  b.data.formPieces = { jungle, ice };
  return b.finish();
}

// ============================================================
// 层级状态：地形形态、警告倒计时、冰原昼夜、环境热更新（第 14 节）
// ============================================================
const S = { timer: 0, form: 'jungle', warning: false, shiftCount: 0, warnPulseAt: 0 };

// 依据 environment.lighting：文件1「永远停在黎明」（暖），文件2「冰面高反射」（冷白）；
// 两份文件都没写具体光源类型/颜色（unverified），按各自描述的色温取值，intensity 保持在能看清路的亮度之上
const ENV_JUNGLE = {
  background: 0xd9c2a0, fogColor: 0xd9c2a0, fogNear: 5, fogFar: 30,
  ambient: { color: 0xffdcb0, intensity: 0.55 },
  // 依据 survivalClass「文件1 等级 0」+ hazards「文件1 没有给出具体危险」——按最安全档取，
  // 略高于 TEMPLATE 参考的纯安全屋 0.5，因为雾气蒙蒙、方向感弱，不算完全无压力
  sanityDrainMul: 0.6,
  // 依据 temperature「文件1：21°C」——温和，不加成
  hungerDrainMul: 1.0,
  audio: 'silence',   // 依据 sounds「未提及」——不编造声音
  darkness: false,
};
const ENV_ICE = {
  background: 0xc7d8e6, fogColor: 0xc7d8e6, fogNear: 9, fogFar: 56,
  ambient: { color: 0xe6f0ff, intensity: 0.55 },
  // 依据 survivalClass「文件2 等级 unknown」+ hazards「地形突变可能把人困住…其他人没那么幸运」——
  // 有真实的环境风险，取比雨林明显高的档
  sanityDrainMul: 1.3,
  // 依据 temperature「文件2：6–10°C」——偏冷但不是极端严寒，取比 TEMPLATE 参考的酷热/严寒 1.3 更低的档
  hungerDrainMul: 1.15,
  audio: 'silence',
  darkness: false,
};

function iceAmbientIntensity(t) {
  const day = 0.5 + 0.5 * Math.sin((t / ICE_DAY_PERIOD) * Math.PI * 2);
  // 夜晚 0.32、白天 0.58：都在"最暗也能看路"之上，冰面高反射不做到真的天黑（issue① 教训）
  return U.lerp(0.32, 0.58, day);
}

// register 用的是这个独立对象，绝不能直接把 ENV_JUNGLE/ENV_ICE 本身注册上去：setEnv 会原地改 ctx.level.env
// 的字段，如果 env 和某个预设是同一个引用，第一次切到另一种形态就会把这份预设自己的数值改掉，
// 之后再"切回去"只是把已经被污染的预设抄回来，两种形态会一起坏掉
const env = Object.assign({}, ENV_JUNGLE, { ambient: Object.assign({}, ENV_JUNGLE.ambient) });

function setEnv(ctx, target) {
  const env = ctx.level.env;
  env.background = target.background; env.fogColor = target.fogColor;
  env.fogNear = target.fogNear; env.fogFar = target.fogFar;
  env.ambient.color = target.ambient.color; env.ambient.intensity = target.ambient.intensity;
  env.sanityDrainMul = target.sanityDrainMul; env.hungerDrainMul = target.hungerDrainMul;
  env.audio = target.audio; env.darkness = target.darkness;
  if (BR.gfx && BR.gfx.applyEnv) BR.gfx.applyEnv(env);
  if (BR.audio && BR.audio.setAmbient) BR.audio.setAmbient(env.audio);
}

function syncChunkVisibility(form) {
  const chunks = BR.world.chunks ? BR.world.chunks() : [];
  const wantJ = form === 'jungle', wantI = !wantJ;
  for (const c of chunks) {
    const fp = c.res && c.res.data && c.res.data.formPieces;
    if (!fp) continue;
    for (const p of fp.jungle) if (p && p.visible !== wantJ) p.setVisible(wantJ);
    for (const p of fp.ice) if (p && p.visible !== wantI) p.setVisible(wantI);
  }
}

BR.levels.register({
  id: '16', name: 'Level 16', title: '地形转变', nickname: '地形转变',
  version: 'wikidot-cn',
  // 依据 survivalClass 原文：两份文件各自的等级框下方三个描述栏都是没填的模板占位符，照抄原样保留这个空白事实
  survivalClass: '文件1（雨林形态）：0；文件2（冰原形态）：unknown（两份文件的等级标签都是未填的模板占位符）',
  chunkSize: SIZE,
  env,
  // 依据 entrances「入口都在 Level 75」——Level 75 不在首期范围、未实现，本层选中版本自己的入口没有
  // 对应的已完成层级可以呼应；L14（fandom「Inhospitality」，与本层完全不同的源）另有一条走深了触发的
  // zone 出口指向这里（grep "to: '16'" js/levels/L*.js），但每层的 spawn() 是全局唯一的一个函数、不分
  // 来源区分落点（ChunkResult/世界接口没有"按入口层给不同出生点"的能力，见 apiRequests），所以不为它
  // 单独处理；出生点仍取这片均匀地形里的任意一点，区块(0,0)中心
  spawn() { return { x: SIZE / 2, y: 0, z: SIZE / 2, yaw: 0 }; },
  buildChunk,
  entities: [
    // 依据 entities[Light Guides]「文件2：能观察到'大量'微光向导，页面说这很反常」+ entityDensityOverall
    // 「文件2 = high」——取 high；文件1 没有实体，但世界按 officialPer1000m2 全程投放、无法只在冰原形态
    // 单独生效（apiRequests：没有"按层级运行时状态动态增减已注册密度"的接口），这里按官方(冰原)密度
    // 持续投放，属于已知近似，返回里会说明
    { type: 'light_guide', officialPer1000m2: BR.config.densityWords.high },
  ],
  items: [
    // 用户规则：所有模式都刷杏仁水和食物；本层页面本身没有可拾取的补给条目（items 只提到探险者随身携带、
    // 本层找不到的层级密钥），下面全部走 data/item-spawn.json 里"levels 含 16"的通用条目
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    { type: 'food_ration', per1000m2: 0.6 },   // 用户规则兜底：本层没有专门的食物条目
  ],
  exits: [
    { to: '46', kind: 'zone', note: '文件1：爬上覆盖沙子的树；文件2：站上覆盖沙子的冰层；范围外自动 sealed，' +
      '实物按当前地形形态显示，按 4 格周期摆在 (cx%4,cz%4)===(2,2) 的区块中心 (exits[0]/[1])' },
  ],
  enter(ctx) {
    S.timer = 0; S.form = 'jungle'; S.warning = false; S.shiftCount = 0; S.warnPulseAt = 0;
    setEnv(ctx, ENV_JUNGLE);
    // 选中版本的两条出口都通往 Level 46（不在首期范围，sealed）：照原文不编造出口，进层时顺带告诉玩家怎么离开
    BR.hud.toast('浓雾笼罩着一片开阔的雨林……这里的地形好像会自己改变。记录里的出口都通往尚未开放的 Level 46，想离开可以从暂停菜单返回主页', 5600);
  },
  update(ctx, dt) {
    S.timer += dt;
    const ph = phaseAt(S.timer);

    if (ph.form !== S.form) {
      S.form = ph.form;
      if (S.form === 'ice') {
        S.shiftCount++;
        setEnv(ctx, Object.assign({}, ENV_ICE, { ambient: { color: ENV_ICE.ambient.color, intensity: iceAmbientIntensity(S.timer) } }));
        // 依据 lighting「地形变化时冰川从地面拔起、巨石中喷出河水、空气骤冷、迅速结冰」——
        // 只能做成瞬间的画面/音效冲击，做不出真的地形隆起动画（apiRequests：Piece 不能变形/移动）
        BR.gfx.flash(0xbfe3ff, 0.5, 0.55);
        BR.hud.toast('地面猛地一震——冰川从土里拔起，空气瞬间冻僵了', 3200);
        // 依据 hazards「幸存者说其他人没那么逃出来」——不是每次都致命，用派生流按转变次数取一个确定性的
        // 命中判定（不用 Math.random，联机双方结果一致）
        const roll = U.rng(ctx.levelSeed, 'L16-shift', S.shiftCount)();
        if (roll < 0.4 && BR.game.attackPlayers) {
          // low issue：BR.player.damage() 自己已经会在 dh>0 时播 'hurt'（js/game/player.js:337），
          // 这里不再手动重复播放一遍，否则同一次伤害会响两次
          BR.player.damage({ hp: 10, sanity: 4, source: 'hazard:terrain-shift' });
        }
      } else {
        setEnv(ctx, ENV_JUNGLE);
        BR.gfx.flash(0xcdead0, 0.4, 0.3);
        BR.hud.toast('雾气重新漫开，脚下的冰在一瞬间化成了泥土', 3000);
      }
      // low issue：只在形态真的切换时才校正一次已加载区块的显隐；平时每帧调用其实是白跑循环——
      // Piece 本身有 get visible()（_kit.js:562），刚建好的区块在 buildChunk 里已按当时的 S.form 设过初始
      // 显隐，唯一需要补一次的时刻就是这里的形态切换瞬间，其余帧不用再遍历所有区块的所有件
      syncChunkVisibility(S.form);
    } else if (S.form === 'ice') {
      // 冰原形态昼夜循环：只改环境光强度，不重复整套 setEnv（省调用）
      const env = ctx.level.env;
      const target = iceAmbientIntensity(S.timer);
      if (Math.abs(target - env.ambient.intensity) > 0.01) {
        env.ambient.intensity = target;
        if (BR.gfx && BR.gfx.applyEnv) BR.gfx.applyEnv(env);
      }
    }

    if (ph.warning && !S.warning) {
      BR.hud.toast('一些细小的发光球体聚到了身边，像是某种警告', 2600);
      S.warnPulseAt = 0;
    }
    S.warning = ph.warning;
    if (S.warning) {
      S.warnPulseAt -= dt;
      if (S.warnPulseAt <= 0) { BR.gfx.flash(0xeaf6ff, 0.18, 0.12); S.warnPulseAt = 2.2; }
    }
  },
  leave(ctx) { void ctx; },
});
})();
