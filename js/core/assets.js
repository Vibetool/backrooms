// 后室 · 素材：贴图 / 材质 / 模型缓存。缺贴图文件时用 canvas 程序化兜底
// 经典 <script>，只往 window.BR 上挂东西。接口说明见 ARCHITECTURE.md 第 12 节
(function () {
'use strict';
const BR = window.BR;

const TEX_DIR = 'assets/tex/';
const MODEL_DIR = 'assets/models/';
const IS_FILE = location.protocol === 'file:';

// 预载清单：init() 里并行探测这些贴图，之后同步 texture() 就不会先闪一帧占位色。
// 不在清单里的名字照样能用，只是第一次 texture() 时才去探测文件。
const MANIFEST = {
  textures: [
    'wallpaper_l0', 'carpet_l0', 'carpet_light', 'ceiling_tile', 'ceiling_light',
    'light_panel', 'concrete', 'concrete_wet', 'metal', 'noise', 'baseboard_wood',
  ],
  models: ['hazmat'],   // 主页人物 / 测试人 / 联机对方共用（tools/blender_hazmat.py 生成）
};

// 只有程序化画法、仓库里没有 jpg 的贴图：跳过文件探测。
// 否则每次启动都会用 Image 去请求一个必然 404 的文件，浏览器把它记成 console error。
const NO_FILE = new Set(['metal', 'noise']);

// ---------- 状态 ----------
// 同一个名字的所有 repeat 变体共享一个 THREE.Source，GPU 上只传一份
const records = new Map();   // name -> { name, state, source, textures:Set, ready:Promise }
const texCache = new Map();  // name|u,v|enc -> Texture
const procs = new Map();     // name -> { size, draw }
const matCache = new Map();
const modelCache = new Map();
let initPromise = null;
let taintedSeen = false;
const warned = new Set();

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[assets]', msg);
}

// ---------- 图片加载 ----------
let probeCtx = null;
// file:// 下浏览器把本地图片当跨域：<img> 能显示，但 WebGL texImage2D 会直接抛安全错误、贴图变黑。
// 所以加载成功后再用 1×1 getImageData 验一次，被污染就当文件不存在走兜底。
function usable(img) {
  if (!img.naturalWidth) return false;
  try {
    if (!probeCtx) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probeCtx = c.getContext('2d', { willReadFrequently: true });
    }
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.drawImage(img, 0, 0, 1, 1);
    probeCtx.getImageData(0, 0, 1, 1);
    return true;
  } catch (err) {
    taintedSeen = true;
    return false;
  }
}

// 不用 fetch/HEAD 探测：file:// 下 fetch 本地文件会被拒，Image 的 onerror 两种协议都可靠
function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    // http 下带 CORS 请求，素材以后挪到 CDN 也能进 WebGL；file:// 带了反而必定失败
    if (!IS_FILE) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(usable(img) ? img : null);
    img.onerror = () => resolve(null);
    img.src = IS_FILE ? url : url + '?v=' + encodeURIComponent(BR.config.version);
  });
}

// ---------- 贴图记录 ----------
let placeholderCanvas = null;
function placeholder() {
  // 探测期间先用中灰顶上，避免材质拿到 null 图报错
  if (!placeholderCanvas) {
    placeholderCanvas = document.createElement('canvas');
    placeholderCanvas.width = placeholderCanvas.height = 2;
    const g = placeholderCanvas.getContext('2d');
    g.fillStyle = '#8a8474';
    g.fillRect(0, 0, 2, 2);
  }
  return placeholderCanvas;
}

function missingCanvas() {
  // 既没文件也没兜底画法：灰格子，一眼能看出缺素材
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#6d6d6d'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  return c;
}

// 换图：r147 用 texStorage2D 分配不可变存储，图片尺寸一变就不能原地重传，
// 所以先 dispose 释放 GPU 端，再换一个新的 Source，下一帧渲染器会按新尺寸重新分配
function setSource(rec, image, state) {
  rec.state = state;
  rec.source = new THREE.Source(image);
  rec.textures.forEach(t => {
    t.dispose();
    t.source = rec.source;
    t.needsUpdate = true;
  });
}

function drawProcedural(name) {
  const p = procs.get(name);
  const c = document.createElement('canvas');
  c.width = c.height = p.size;
  const g = c.getContext('2d', { willReadFrequently: true });
  try {
    p.draw(g, p.size);
  } catch (err) {
    console.error('[assets] 程序化贴图绘制失败', name, err);
    return missingCanvas();
  }
  return c;
}

function fallback(rec) {
  if (procs.has(rec.name)) {
    setSource(rec, drawProcedural(rec.name), 'procedural');
  } else {
    warnOnce('missing:' + rec.name, `贴图 "${rec.name}" 既没有 ${TEX_DIR}${rec.name}.jpg 也没有 registerProcedural 兜底`);
    setSource(rec, missingCanvas(), 'missing');
  }
}

function record(name) {
  let rec = records.get(name);
  if (rec) return rec;
  rec = { name, state: 'pending', source: new THREE.Source(placeholder()), textures: new Set(), ready: null };
  records.set(name, rec);
  const probe = NO_FILE.has(name) ? Promise.resolve(null) : loadImage(TEX_DIR + name + '.jpg');
  rec.ready = probe.then(img => {
    if (img) setSource(rec, img, 'file');
    else fallback(rec);
  });
  return rec;
}

function anisotropy() {
  const low = BR.game && BR.game.settings && BR.game.settings.quality === 'low';
  let a = low ? 2 : 8;
  const r = BR.gfx && BR.gfx.renderer;
  if (r && r.capabilities) a = Math.min(a, r.capabilities.getMaxAnisotropy());
  return Math.max(1, a);
}

// ---------- 模型 ----------
// 普通 clone() 会让 SkinnedMesh 继续绑在原骨架上（动画全挤在一处），这里照 SkeletonUtils.clone 重绑
function cloneModel(src) {
  const srcToClone = new Map();
  const cloneToSrc = new Map();
  const out = src.clone();
  (function pair(a, b) {
    srcToClone.set(a, b); cloneToSrc.set(b, a);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
  })(src, out);
  out.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const from = cloneToSrc.get(node);
    node.skeleton = from.skeleton.clone();
    node.bindMatrix.copy(from.bindMatrix);
    node.skeleton.bones = from.skeleton.bones.map(b => srcToClone.get(b));
    node.bind(node.skeleton, node.bindMatrix);
  });
  out.animations = src.animations;
  return out;
}

function loadModel(name) {
  let rec = modelCache.get(name);
  if (rec) return rec.promise;
  rec = { root: null, promise: null };
  rec.promise = new Promise((resolve, reject) => {
    if (!THREE.GLTFLoader) { reject(new Error('GLTFLoader 未加载')); return; }
    new THREE.GLTFLoader().load(MODEL_DIR + name + '.glb', gltf => {
      const root = gltf.scene || gltf.scenes[0];
      root.animations = gltf.animations || [];
      rec.root = root;
      resolve(root);
    }, undefined, err => {
      // 失败也缓存，避免每帧重复请求一个不存在的文件
      reject(new Error(`模型 ${name} 加载失败：${err && err.message || err}`));
    });
  });
  modelCache.set(name, rec);
  return rec.promise;
}

// ---------- 公开 API ----------
BR.assets = {
  // opts 可选：{ textures: [...], models: [...] } 追加到预载清单
  init(opts) {
    if (initPromise) return initPromise;
    const texNames = MANIFEST.textures.concat((opts && opts.textures) || []);
    const modelNames = MANIFEST.models.concat((opts && opts.models) || []);
    const jobs = texNames.map(n => record(n).ready)
      .concat(modelNames.map(n => loadModel(n).catch(err => console.warn('[assets]', err.message))));
    initPromise = Promise.all(jobs).then(() => {
      const count = { file: 0, procedural: 0, missing: 0 };
      records.forEach(r => { if (count[r.state] !== undefined) count[r.state]++; });
      console.info(`[assets] 贴图：文件 ${count.file} 张，程序化兜底 ${count.procedural} 张，缺失 ${count.missing} 张`);
      // 有的浏览器直接拒载本地图片（onerror），有的能载入但被污染，两种都提示一次
      if (IS_FILE && (taintedSeen || count.file < texNames.length)) {
        console.info('[assets] file:// 打开时浏览器通常禁止 WebGL 读取本地图片，已改用程序化贴图；用 http 服务打开可看到真实贴图');
      }
    });
    return initPromise;
  },

  // opts: { repeat: [u, v] | n, linear: bool }
  // linear=true 用于噪声/粗糙度这类数据贴图，不做 sRGB 解码
  // 返回的实例按 名字+repeat 共享：别直接改它的 repeat/offset，要不同平铺就换个 repeat 参数再拿一个
  texture(name, opts) {
    let rep = opts && opts.repeat;
    if (rep === undefined || rep === null) rep = [1, 1];
    else if (typeof rep === 'number') rep = [rep, rep];
    const linear = !!(opts && opts.linear);
    const key = name + '|' + rep[0] + ',' + rep[1] + (linear ? '|lin' : '');
    let tex = texCache.get(key);
    if (tex) return tex;

    const rec = record(name);
    tex = new THREE.Texture();
    tex.name = name;
    tex.source = rec.source;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rep[0], rep[1]);
    tex.encoding = linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
    tex.anisotropy = anisotropy();
    tex.needsUpdate = true;
    rec.textures.add(tex);
    texCache.set(key, tex);
    return tex;
  },

  // draw(ctx2d, size)。size 用 2 的幂，WebGL1 下重复平铺和 mipmap 才正常。
  // 重复注册会覆盖：如果当前正显示旧兜底，立刻重画替换
  // opts.noFile：仓库里本来就没有这张 jpg、只用程序化画法（层级文件里自带的贴图常这样）——加进 NO_FILE 跳过文件探测，
  // 否则浏览器会把那次必然 404 的请求记成 console error（Level 14 彩绘玻璃就踩过）
  registerProcedural(name, size, draw, opts) {
    if (opts && opts.noFile) NO_FILE.add(name);
    procs.set(name, { size: size | 0 || 256, draw });
    const rec = records.get(name);
    if (rec && (rec.state === 'procedural' || rec.state === 'missing')) fallback(rec);
  },

  material(key, factory) {
    if (!matCache.has(key)) {
      if (typeof factory !== 'function') return null;
      matCache.set(key, factory());
    }
    return matCache.get(key);
  },

  // 返回克隆：几何体和材质与缓存共享，调用方要改材质请先 clone 材质
  // 文件不存在时 Promise 被 reject（file:// 下 GLTFLoader 用 fetch，一定失败），调用方要准备兜底模型
  model(name) {
    return loadModel(name).then(cloneModel);
  },

  modelSync(name) {
    const rec = modelCache.get(name);
    return rec && rec.root ? cloneModel(rec.root) : null;
  },

  // 调试用：'pending' | 'file' | 'procedural' | 'missing' | undefined（从没请求过）
  sourceOf(name) {
    const rec = records.get(name);
    return rec ? rec.state : undefined;
  },
};

// =====================================================================
// 程序化兜底贴图
// 全部可无缝平铺：噪声在格点上取模回绕，图形元素跨边时在对边补画一份
// 用固定种子，联机双方看到的兜底图完全一样
// =====================================================================

function seeded(name) { return BR.util.mulberry32(BR.util.hashStr('tex:' + name)); }

// 周期值噪声：cells 必须是整数，这样第 size 个像素正好回到第 0 个格点
function periodicNoise(size, cells, rng) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const r0 = (iy % cells) * cells, r1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const c0 = ix % cells, c1 = (ix + 1) % cells;
      const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
      const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

// 分形噪声，结果约 0..1
function fbm(size, baseCells, octaves, rng, gain) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves && cells <= size; o++) {
    const n = periodicNoise(size, cells, rng);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp; amp *= gain; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// 逐像素改色：fn(i, x, y) 返回亮度倍数或 [r,g,b]；在已有画面上乘/替换
function shadePixels(g, size, fn) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i++) {
      const v = fn(i, x, y, d, i * 4);
      if (typeof v === 'number') {
        const p = i * 4;
        d[p] = d[p] * v; d[p + 1] = d[p + 1] * v; d[p + 2] = d[p + 2] * v;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

// 跨边补画：在 9 个错位位置各画一次，靠边的形状在对边也有一份
function wrapDraw(size, x, y, r, fn) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx * size, py = y + dy * size;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      fn(px, py);
    }
  }
}

function rgba(r, g, b, a) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }

// 水渍：中间淡、边缘一圈更深的褐色环，这是纸/砖受潮干掉后最典型的样子。
// 用几团错开的圆叠出不规则轮廓 —— 单个正圆一看就是假的。种子取自位置，调用方不用传 rng
function stain(g, size, x, y, r, col, alpha) {
  const rng = BR.util.rng('stain', Math.floor(x * 16), Math.floor(y * 16));
  const a = alpha * 0.55;
  for (let k = 0; k < 4; k++) {
    const bx = x + (rng() - 0.5) * r * 0.9, by = y + (rng() - 0.5) * r * 0.9;
    const br = r * (0.45 + rng() * 0.4);
    wrapDraw(size, bx, by, br, (px, py) => {
      const grad = g.createRadialGradient(px, py, br * 0.1, px, py, br);
      grad.addColorStop(0, rgba(col[0], col[1], col[2], a * 0.3));
      grad.addColorStop(0.75, rgba(col[0], col[1], col[2], a * 0.55));
      grad.addColorStop(0.92, rgba(col[0], col[1], col[2], a));
      grad.addColorStop(1, rgba(col[0], col[1], col[2], 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(px, py, br, 0, Math.PI * 2); g.fill();
    });
  }
}

// ---- Level 0 墙纸：芥末黄底 + 细竖条 + 小菱形暗纹 + 水渍 ----
// ---- 黄色松木纹：踢脚线（baseboard_wood.jpg 缺失或 file:// 打开时的兜底）----
BR.assets.registerProcedural('baseboard_wood', 256, (g, s) => {
  const rng = seeded('baseboard_wood');
  g.fillStyle = 'rgb(214,176,92)';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    const y = rng() * s, amp = 1 + rng() * 3, ph = rng() * 6.283, k = 1 + Math.floor(rng() * 3);
    const sh = 0.78 + rng() * 0.15;
    g.strokeStyle = `rgb(${Math.round(214 * sh)},${Math.round(176 * sh)},${Math.round(92 * sh)})`;
    g.lineWidth = rng() < 0.7 ? 1 : 2;
    g.beginPath();
    // 整数个正弦周期，左右边缘对得上，沿长度平铺不出接缝
    for (let x = 0; x <= s; x += 4) {
      const yy = y + amp * Math.sin(2 * Math.PI * k * x / s + ph);
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
});

BR.assets.registerProcedural('wallpaper_l0', 512, (g, s) => {
  const rng = seeded('wallpaper_l0');
  g.fillStyle = 'rgb(185,166,88)';   // 与压暗 10% 后的 wallpaper_l0.jpg 一致
  g.fillRect(0, 0, s, s);

  // 竖条：24 条正好整除，平铺不断
  const stripe = s / 24;
  for (let i = 0; i < 24; i++) {
    g.fillStyle = 'rgba(150,125,50,0.10)';
    g.fillRect(i * stripe, 0, Math.max(1, s / 256), s);
    g.fillStyle = 'rgba(235,215,130,0.10)';
    g.fillRect(i * stripe + stripe * 0.5, 0, Math.max(1, s / 512), s);
  }

  // 菱形暗纹：6×6 格，隔行错半格
  const cell = s / 6, dr = cell * 0.16;
  g.lineWidth = Math.max(1, s / 400);
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 6; i++) {
      const cx = (i + (j % 2 ? 1 : 0.5)) * cell, cy = (j + 0.5) * cell;
      wrapDraw(s, cx, cy, dr * 1.4, (px, py) => {
        g.beginPath();
        g.moveTo(px, py - dr * 1.35); g.lineTo(px + dr, py);
        g.lineTo(px, py + dr * 1.35); g.lineTo(px - dr, py); g.closePath();
        g.fillStyle = 'rgba(160,135,55,0.09)'; g.fill();
        g.strokeStyle = 'rgba(140,115,45,0.16)'; g.stroke();
      });
    }
  }

  for (let k = 0; k < 3; k++) {
    stain(g, s, rng() * s, rng() * s, s * (0.06 + rng() * 0.08), [120, 90, 40], 0.10 + rng() * 0.06);
  }

  // 大块明暗起伏 + 纸纹颗粒
  const low = fbm(s, 4, 3, rng, 0.5);
  shadePixels(g, s, i => 0.93 + low[i] * 0.12 + (rng() - 0.5) * 0.05);
});

// ---- Level 0 地毯：米褐色 Berber 圈绒 + 潮湿深色斑 ----
BR.assets.registerProcedural('carpet_l0', 512, (g, s) => {
  const rng = seeded('carpet_l0');
  g.fillStyle = 'rgb(146,125,88)';
  g.fillRect(0, 0, s, s);
  const damp = fbm(s, 4, 4, rng, 0.55);
  const mid = fbm(s, 32, 2, rng, 0.5);
  const loops = s / 4;   // 圈绒周期：整数个周期才能平铺
  shadePixels(g, s, (i, x, y) => {
    const nub = Math.sin(x / s * Math.PI * 2 * loops) * Math.sin(y / s * Math.PI * 2 * loops);
    let v = 0.9 + nub * 0.06 + (mid[i] - 0.5) * 0.14 + (rng() - 0.5) * 0.22;
    // 潮湿区：过渡带放宽、压暗收敛，太黑会像一滩滩油污而不是受潮
    const wet = BR.util.smoothstep(0.5, 0.72, damp[i]);
    return v * (1 - wet * 0.17);
  });
  for (let k = 0; k < 40; k++) {
    const x = rng() * s, y = rng() * s, r = s * (0.002 + rng() * 0.004);
    wrapDraw(s, x, y, r, (px, py) => {
      g.fillStyle = 'rgba(60,55,35,0.25)';
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    });
  }
});

// ---- 浅黄色地毯（主页地板）：必须一眼是"浅黄"，不能发白也不能发褐 ----
BR.assets.registerProcedural('carpet_light', 512, (g, s) => {
  const rng = seeded('carpet_light');
  g.fillStyle = 'rgb(236,218,146)';
  g.fillRect(0, 0, s, s);
  const low = fbm(s, 4, 3, rng, 0.5);
  const loops = s / 4;
  shadePixels(g, s, (i, x, y) => {
    const nub = Math.sin(x / s * Math.PI * 2 * loops) * Math.sin(y / s * Math.PI * 2 * loops);
    return 0.95 + nub * 0.03 + (low[i] - 0.5) * 0.06 + (rng() - 0.5) * 0.08;
  });
});

// ---- 吸音天花板砖：一张图 = 2×2 块砖，T 型龙骨压在砖缝上 ----
function drawCeiling(g, s, base, bar, name) {
  const rng = seeded(name);
  g.fillStyle = rgba(base[0], base[1], base[2], 1);
  g.fillRect(0, 0, s, s);

  // 每块砖旧化程度不同，亮度略有差别
  const half = s / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      g.fillStyle = rng() < 0.5 ? `rgba(0,0,0,${rng() * 0.04})` : `rgba(255,255,240,${rng() * 0.05})`;
      g.fillRect(tx * half, ty * half, half, half);
    }
  }

  // 矿棉板上的虫蛀状小孔和短裂纹
  const pits = Math.round(s * s / 350);
  for (let k = 0; k < pits; k++) {
    const x = rng() * s, y = rng() * s;
    g.fillStyle = `rgba(90,85,70,${0.10 + rng() * 0.18})`;
    if (rng() < 0.7) {
      const r = s * (0.0015 + rng() * 0.002);
      g.fillRect(x, y, r * 2, r * 2);
    } else {
      g.save(); g.translate(x, y); g.rotate(rng() * Math.PI);
      g.fillRect(0, 0, s * (0.006 + rng() * 0.01), Math.max(1, s / 512));
      g.restore();
    }
  }

  stain(g, s, half * (0.3 + rng() * 0.4), half * (1.3 + rng() * 0.4), s * 0.09, [150, 120, 50], 0.14);

  const low = fbm(s, 8, 3, rng, 0.5);
  shadePixels(g, s, i => 0.96 + low[i] * 0.06 + (rng() - 0.5) * 0.04);

  // 龙骨：中心在 0 和 s/2，宽度两侧对称，跨边那半截在对边补上
  const w = Math.max(3, Math.round(s / 56));
  const shadow = Math.max(1, Math.round(s / 256));
  const lines = [0, half, s];
  for (const p of lines) {
    g.fillStyle = 'rgba(40,35,20,0.16)';
    g.fillRect(p - w / 2 - shadow, 0, w + shadow * 2, s);
    g.fillRect(0, p - w / 2 - shadow, s, w + shadow * 2);
  }
  for (const p of lines) {
    g.fillStyle = rgba(bar[0], bar[1], bar[2], 1);
    g.fillRect(p - w / 2, 0, w, s);
    g.fillRect(0, p - w / 2, s, w);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(p - 0.5, 0, 1, s);
    g.fillRect(0, p - 0.5, s, 1);
  }
}
BR.assets.registerProcedural('ceiling_tile', 512, (g, s) => drawCeiling(g, s, [224, 217, 196], [236, 233, 224], 'ceiling_tile'));
// 主页天花板用：用户要求"浅黄色"
BR.assets.registerProcedural('ceiling_light', 512, (g, s) => drawCeiling(g, s, [240, 226, 166], [244, 236, 204], 'ceiling_light'));

// ---- 日光灯格栅面板：高亮，4×4 抛物面铝格栅 + 白色边框 ----
BR.assets.registerProcedural('light_panel', 256, (g, s) => {
  const frame = Math.round(s * 0.06);
  g.fillStyle = 'rgb(238,238,232)';
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgb(200,200,194)';
  g.fillRect(frame - 2, frame - 2, s - frame * 2 + 4, s - frame * 2 + 4);

  const inner = s - frame * 2, n = 4, cell = inner / n, wall = Math.max(2, s / 96);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = frame + i * cell, y = frame + j * cell, cx = x + cell / 2, cy = y + cell / 2;
      // 抛物面反光：格子中心最亮，往四壁发灰
      const grad = g.createRadialGradient(cx, cy, cell * 0.08, cx, cy, cell * 0.72);
      grad.addColorStop(0, 'rgb(255,255,252)');
      grad.addColorStop(0.55, 'rgb(250,250,244)');
      grad.addColorStop(1, 'rgb(212,214,212)');
      g.fillStyle = grad;
      g.fillRect(x + wall / 2, y + wall / 2, cell - wall, cell - wall);
    }
  }
  g.fillStyle = 'rgb(186,188,188)';
  for (let k = 0; k <= n; k++) {
    g.fillRect(frame + k * cell - wall / 2, frame, wall, inner);
    g.fillRect(frame, frame + k * cell - wall / 2, inner, wall);
  }
});

// ---- 水泥 ----
function drawConcrete(g, s, base, wetAmount, name) {
  const rng = seeded(name);
  g.fillStyle = rgba(base[0], base[1], base[2], 1);
  g.fillRect(0, 0, s, s);
  const low = fbm(s, 4, 5, rng, 0.55);
  const blotch = fbm(s, 8, 3, rng, 0.5);
  const wet = fbm(s, 3, 4, rng, 0.55);
  shadePixels(g, s, (i, x, y, d, p) => {
    let v = 0.86 + low[i] * 0.26 + (rng() - 0.5) * 0.16;
    v *= 1 - BR.util.smoothstep(0.6, 0.8, blotch[i]) * 0.12;
    if (wetAmount > 0) {
      const w = BR.util.smoothstep(0.45, 0.6, wet[i]) * wetAmount;
      v *= 1 - w * 0.35;
      // 湿区略偏冷，干掉的水痕边缘反而发白
      d[p + 2] = Math.min(255, d[p + 2] * (1 + w * 0.06));
      const rim = Math.max(0, 1 - Math.abs(wet[i] - 0.44) * 40) * wetAmount;
      v *= 1 + rim * 0.12;
    }
    return v;
  });
  // 气孔
  const holes = Math.round(s * s / 900);
  for (let k = 0; k < holes; k++) {
    const x = rng() * s, y = rng() * s, r = s * (0.001 + rng() * 0.0025);
    g.fillStyle = `rgba(30,30,30,${0.25 + rng() * 0.3})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}
BR.assets.registerProcedural('concrete', 512, (g, s) => drawConcrete(g, s, [134, 132, 127], 0, 'concrete'));
BR.assets.registerProcedural('concrete_wet', 512, (g, s) => drawConcrete(g, s, [98, 96, 92], 1, 'concrete_wet'));

// ---- 金属：拉丝 + 划痕 ----
BR.assets.registerProcedural('metal', 256, (g, s) => {
  const rng = seeded('metal');
  g.fillStyle = 'rgb(150,152,154)';
  g.fillRect(0, 0, s, s);
  // 拉丝：每行一个亮度，行内再叠一条沿 x 周期的噪声，保证左右能接上
  const rowTone = new Float32Array(s);
  for (let y = 0; y < s; y++) rowTone[y] = (rng() - 0.5) * 0.12;
  const along = periodicNoise(s, 16, rng);
  const low = fbm(s, 4, 3, rng, 0.5);
  shadePixels(g, s, (i, x, y) => 0.94 + rowTone[y] + (along[i] - 0.5) * 0.06 + (low[i] - 0.5) * 0.1);
  g.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    const x = rng() * s, y = rng() * s, len = s * (0.05 + rng() * 0.2), a = (rng() - 0.5) * 0.6;
    wrapDraw(s, x, y, len, (px, py) => {
      g.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(40,40,40,0.18)';
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); g.stroke();
    });
  }
});

// ---- 灰度噪声：给粗糙度/凹凸/闪烁用，建议 texture('noise', { linear: true }) ----
BR.assets.registerProcedural('noise', 256, (g, s) => {
  const rng = seeded('noise');
  const n = fbm(s, 4, 6, rng, 0.55);
  const img = g.createImageData(s, s);
  const d = img.data;
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(0, Math.min(255, (n[i] - 0.5) * 1.8 * 255 + 128));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});
})();
