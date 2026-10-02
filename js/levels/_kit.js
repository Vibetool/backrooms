// 后室 · 层级搭建工具库 BR.kit：区块几何累积与按材质合并、材质缓存、跨区块无缝格子迷宫、常用构件、出口、高度场
// 给层级代理看的写法说明在 js/levels/_TEMPLATE.md —— 改这里的接口必须同步改那份文档（几十个层级文件照着它写）
// 经典 <script>，只往 window.BR 上挂东西；必须排在 js/levels/L*.js 之前加载
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const U = BR.util;

const KIT_VERSION = 1;
const DEFAULT_HEIGHT = 2.8;          // 与 Ldev 一致的层高：比眼高 1.62 高出一截，天花板不压头
// 纯色发光件（指示灯、黑洞、窗外亮光）复用灯盘材质，不多一个 draw call：所有顶点 UV 相同 → 屏幕导数为 0 → 永远采最清晰那级 mip，
// 取到的就是这一个纹素。选第 2 行第 2 格格栅的中心：生成的 jpg 和程序化兜底在这里都接近纯白（jpg 256² 上 (96,96) 周围 3×3 全是 255）。
// 原来取白边框 (0.03, 0.5) —— 程序化兜底那里是白的，但 jpg 没有白边框（≈138 灰），所有发光件在正式贴图下暗到 1/4。
// 换 light_panel 贴图后跑 node tests/kit.mjs，里面会检查这个纹素还够不够白
const WHITE_UV = [96.5 / 256, 1 - 96.5 / 256];   // v 翻转：three 贴图默认 flipY
const TAU = Math.PI * 2;

const warned = new Set();
function warnOnce(key, msg, extra) {
  if (warned.has(key)) return;
  warned.add(key);
  if (extra !== undefined) console.warn('[kit]', msg, extra); else console.warn('[kit]', msg);
}
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

// 颜色统一走 THREE.Color：顶点色和 material.color = hex 的换算规则一致，层级里写的 hex 两处看起来一样
const tmpColor = new THREE.Color();
function rgb(c, mul) {
  const m = mul == null ? 1 : mul;
  if (Array.isArray(c)) return [c[0] * m, c[1] * m, c[2] * m];
  if (c == null) return [m, m, m];
  tmpColor.set(c);
  return [tmpColor.r * m, tmpColor.g * m, tmpColor.b * m];
}

// =====================================================================
// 材质
// =====================================================================
// 同 key 全局只建一次（BR.assets.material 缓存）；world 卸区块时不 dispose 共享材质，所以每块都能放心复用
const matDefs = new Map();
// 道具表面纹理（用户 2026-10-01："材质也得跟随着细化"）：'kit:prop' 叠一张很淡的灰度纹理（明暗起伏、细划痕、磨损），
// 只调亮度不调色相。贴图按线性值读（不做 sRGB 解码），均值归一到 PROP_TEX_MEAN；材质底色除以这个均值补回来 ——
// 原来没贴图时底色是 0xcccccc（legacyMode 下 = 0.8），所以平均亮度和改之前完全一样，顶点色的整体颜色不变。
// UV 一律按世界米数平铺（uvAll: 'world'，见 fillUV），1 张贴图铺 PROP_TEX_METERS 米：大柜子、细压条的纹理颗粒一样大，不拉伸
const PROP_TEX = 'kit_prop_grain';
const PROP_TEX_MEAN = 226 / 255;
const PROP_TEX_METERS = 0.9;
const PROP_BASE = 0.8;
const DECAL_TEX = 'kit_decal_atlas';
const BUILTIN = {
  // 构件统一用顶点色材质：一块里所有桌椅柜子合成一个 mesh，draw call 不随构件种类增长
  'kit:prop':  { type: 'phong', vertexColors: true, shininess: 12, specular: 0x1a1a1a,
                 tex: PROP_TEX, linear: true, repeatMeters: PROP_TEX_METERS, uvAll: 'world',
                 color: [PROP_BASE / PROP_TEX_MEAN, PROP_BASE / PROP_TEX_MEAN, PROP_BASE / PROP_TEX_MEAN] },
  // 软边贴花（刮痕、污渍、水渍、锈迹、鞋印……）：kit.decal 往墙/地/道具表面贴一片。
  // 颜色来自顶点色（kit.decal 把 hex 当屏幕色做 sRGB 解码）、透明度 = 顶点 alpha × 图集灰度（alphaMap 读 g 通道，图集不透明，
  // mipmap 平均不会出黑边）。Phong 受光：法线和底下的面一样，灯下明暗与墙面一致；不写深度 + 往前挤，贴花之间、贴花和墙都不闪。
  // renderOrder 1：先于玻璃、水面（2）画，水坑盖在地上的污渍上面是对的
  'kit:decal': { type: 'phong', alphaTex: DECAL_TEX, vertexColors: true, vertexAlphas: true, transparent: true,
                 depthWrite: false, polygonOffset: -2, shininess: 6, specular: 0x060606, color: 0xffffff, renderOrder: 1 },
  // 发光件（灯盘、指示灯、黑洞）：Basic 不吃光照；顶点色 >1 过色调映射后接近白色。黑色 = 纯黑空洞（仍受雾）
  'kit:glow':  { type: 'basic', tex: 'light_panel', vertexColors: true, polygonOffset: -1 },
  'kit:glass': { type: 'phong', vertexColors: true, transparent: true, opacity: 0.3, shininess: 90,
                 specular: 0x777777, depthWrite: false, side: 'double' },
  // 水坑：半透明 + 高光，灯在水面上拉出亮斑就是"反光"；不写深度，免得挡住下面的地毯
  'kit:water': { type: 'phong', vertexColors: true, transparent: true, opacity: 0.55, shininess: 140,
                 specular: 0xaaaaaa, depthWrite: false, polygonOffset: -1 },
};

function sideOf(s) {
  if (s === 'double' || s === THREE.DoubleSide) return THREE.DoubleSide;
  if (s === 'back' || s === THREE.BackSide) return THREE.BackSide;
  return THREE.FrontSide;
}

function repeatOf(def) {
  const r = def && def.repeatMeters;
  if (Array.isArray(r)) return [num(r[0], 1) || 1, num(r[1], r[0]) || 1];
  const n = num(r, 1) || 1;
  return [n, n];
}

function defOf(key) {
  if (key && key.isMaterial) return { repeatMeters: (key.userData && key.userData.kitRepeat) || 1 };
  const k = String(key);
  if (matDefs.has(k)) return matDefs.get(k);
  if (BUILTIN[k]) return BUILTIN[k];
  return null;
}

function createMaterial(key, def) {
  const type = def.type || 'phong';
  let map = def.map || null;
  if (!map && def.tex && BR.assets && typeof BR.assets.texture === 'function') {
    try { map = BR.assets.texture(def.tex, { linear: !!def.linear }); } catch (err) { map = null; }
  }
  // 数组底色 [r,g,b] 可以 > 1 或不是整 hex（kit:prop 的均值补偿就是这样）
  const col = def.color != null ? def.color : (map ? 0xffffff : 0xcccccc);
  const p = {
    color: Array.isArray(col) ? new THREE.Color(num(col[0], 1), num(col[1], 1), num(col[2], 1)) : col,
    vertexColors: !!def.vertexColors,
    transparent: !!def.transparent,
    opacity: num(def.opacity, 1),
    side: sideOf(def.side),
    fog: def.fog !== false,
  };
  if (map) p.map = map;
  // 透明度贴图（three 读 g 通道、不做颜色解码）：贴花图集用它，贴图本身不透明，mipmap 不会把透明处的黑色混进来
  if (def.alphaTex && BR.assets && typeof BR.assets.texture === 'function') {
    try { p.alphaMap = BR.assets.texture(def.alphaTex, { linear: true }); } catch (err) { /* 没有就不透明 */ }
  }
  if (def.alphaTest != null) p.alphaTest = def.alphaTest;
  if (def.depthWrite != null) p.depthWrite = !!def.depthWrite;
  if (def.polygonOffset) {
    p.polygonOffset = true;
    p.polygonOffsetFactor = def.polygonOffset;
    p.polygonOffsetUnits = def.polygonOffset * 2;
  }
  let m;
  if (type === 'basic') {
    m = new THREE.MeshBasicMaterial(p);
  } else if (type === 'standard') {
    // 手机上 Standard 明显更贵，只有层级明确要求才用
    p.roughness = num(def.roughness, 0.9); p.metalness = num(def.metalness, 0);
    if (def.emissive != null) { p.emissive = def.emissive; p.emissiveIntensity = num(def.emissiveIntensity, 1); }
    m = new THREE.MeshStandardMaterial(p);
  } else if (type === 'lambert') {
    if (def.emissive != null) { p.emissive = def.emissive; p.emissiveIntensity = num(def.emissiveIntensity, 1); }
    m = new THREE.MeshLambertMaterial(p);
  } else {
    // 默认 Phong：r147 的 Lambert 是逐顶点光照，几米见方的大墙面上灯光会被插值抹平（Ldev 踩过）。
    // roughness/metalness 换算成 Phong 的高光，层级按 PBR 直觉写数就行
    const r = U.clamp(num(def.roughness, 0.85), 0, 1), mt = U.clamp(num(def.metalness, 0), 0, 1);
    p.shininess = def.shininess != null ? def.shininess : Math.round(2 + (1 - r) * (1 - r) * 98);
    if (def.specular != null) p.specular = def.specular;
    else { const s = 0.02 + (1 - r) * (0.1 + 0.5 * mt); p.specular = new THREE.Color(s, s, s); }
    if (def.emissive != null) { p.emissive = def.emissive; p.emissiveIntensity = num(def.emissiveIntensity, 1); }
    if (def.emissiveTex && BR.assets) p.emissiveMap = BR.assets.texture(def.emissiveTex);
    if (def.flatShading) p.flatShading = true;
    m = new THREE.MeshPhongMaterial(p);
  }
  m.name = 'kit:' + key;
  m.userData.kitKey = key;
  m.userData.kitRepeat = repeatOf(def);
  return m;
}

const localMats = new Map();
function mat(key, opts) {
  if (key && key.isMaterial) return key;
  key = String(key);
  if (opts) {
    const prev = matDefs.get(key);
    if (prev && JSON.stringify(prev) !== JSON.stringify(opts)) {
      warnOnce('redef:' + key, '材质 "' + key + '" 被用不同参数重复定义，沿用第一次创建的材质（key 请带层级前缀）');
    }
    if (!prev) matDefs.set(key, Object.assign({}, opts));
  }
  let def = defOf(key);
  if (!def) {
    warnOnce('undef:' + key, '材质 "' + key + '" 没有用 BR.kit.mat 定义，先用洋红色占位');
    def = { color: 0xff00ff };
    matDefs.set(key, def);
  }
  const factory = () => createMaterial(key, def);
  const A = BR.assets;
  if (A && typeof A.material === 'function') return A.material('kit|' + key, factory);
  if (!localMats.has(key)) localMats.set(key, factory());
  return localMats.get(key);
}

function mats(table) {
  const out = {};
  for (const k in table) out[k] = mat(k, table[k]);
  return out;
}

// =====================================================================
// 几何累积
// =====================================================================
// 每个材质一只累加器，直接往数组里追加顶点；finish 时一次性建 BufferGeometry。
// 效果与"每件一个 geometry 再 mergeBufferGeometries(useGroups=false)"完全相同，
// 但不产生成百上千个临时 geometry，也没有"属性集合不一致合并失败"的坑
function Acc(key) {
  this.key = key;
  this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
  // 顶点 alpha（材质定义里 vertexAlphas: true 才有，贴花用）：和 col 分开存，col 仍是 3 个一组，老代码直接改 col 不受影响
  const def = defOf(key);
  this.alp = def && def.vertexAlphas ? [] : null;
  // 铺 kit:prop 表面纹理的材质：每件记下本地包围盒，判断要不要整件退回纯色（见 grainFlat）
  this.grainTex = !!(def && def.tex === PROP_TEX);
  this.n = 0;
  this.pieces = [];
}

// 'kit:prop' 表面纹理按件退回纯色（验收 2026-10-02：L18 吊顶/墙/地、L4 白板一类大面和白色件铺纹理像脏大理石、看得出 0.9 m 一格的重复）。
// opts.grain === false 或 0 → 退回纯色；true（或 > 0 的数）→ 保留纹理；缺省按件的本地包围盒自动判断：
// 最大一面 ≥ 3 m²，或最长边 ≥ 2.4 m 且次长边 ≥ 0.45 m（顶天立地的墙段、整栋房子、集装箱、长条大桌）→ 退回纯色。
// 衣柜（1.0×1.9）、售货机、门扇、床、隔断（2×1.4）这类道具都留着纹理。退回纯色 = UV 钉在纹理里精确等于均值的那一片 → 和没贴图之前一模一样
const GRAIN_FLAT_AREA = 3.0, GRAIN_FLAT_LONG = 2.4, GRAIN_FLAT_SECOND = 0.45;
function grainFlat(g, ex, ey, ez) {
  if (g === false || g === 0) return true;
  if (g === true || (typeof g === 'number' && g > 0)) return false;
  let a = ex, b = ey, c = ez, t;
  if (a < b) { t = a; a = b; b = t; }
  if (b < c) { t = b; b = c; c = t; }
  if (a < b) { t = a; a = b; b = t; }
  return a * b >= GRAIN_FLAT_AREA || (a >= GRAIN_FLAT_LONG && b >= GRAIN_FLAT_SECOND);
}
// 浅色件也整件退回纯色（上线前复查 2026-10-02：L17 被子枕头、L18 白柜黄桌面、L22 白桌板、L13 奶油色柜子、L4 米白门框 ——
// 纹理是乘在顶点色上的，浅色、低饱和的面上那点明暗起伏读出来就是"发灰发花"，像脏了；深色木头、金属、石头上读作材质，留着）。
// 只管缺省（opts.grain 没传）的件：false / true 显式要的照旧。判断在 finish 里做（fillUV 之前），用的是这件最终的顶点色
// （_piece 之后、finish 之前 setColor 改过的也算）：各顶点相对亮度（kit:prop 顶点色是线性值，Y = 0.2126R + 0.7152G + 0.0722B）的平均
// > GRAIN_FLAT_LUMA 就整件钉在均值纹素上。纹理只能整件开关（一张贴图、UV 要么铺开要么钉死），所以是阈值，不是按亮度渐变。
// 阈值 0.75（屏幕上约 88% 亮）：复查点名的浅色件最暗的是 L17 灰蓝被子 0xb7c2cc（0.754），其余被褥/白柜/黄桌面/白纸/门框都在 0.78 以上；
// 复查看过没点名的中浅色件留着纹理 —— kit 桌面层压板 0xc9b99b（0.73）、L4 桌面 0xc3b69b（0.72）、电梯门不锈钢 0xb9bdc1（0.74）、
// L2 镀锌线槽/穿线管（0.63/0.74）、L1 镀锌件（0.68）和黄色警示漆（0.67）。注意：亮度只看顶点色，灯光照得很亮的深色件（L8 M.E.G. 据点
// 0x3a5a3a 的储物柜，0.32）这条规则管不到（kit.prop.* 目前也不把 opts.grain 转给零件，要另想办法）
const GRAIN_FLAT_LUMA = 0.75;
function grainBright(col, start, count) {
  if (!col || !(count > 0)) return false;
  let sum = 0;
  for (let i = start; i < start + count; i++) sum += 0.2126 * col[i * 3] + 0.7152 * col[i * 3 + 1] + 0.0722 * col[i * 3 + 2];
  return sum / count > GRAIN_FLAT_LUMA;
}

// 盒子六个面：法线、"上"方向、面中心相对盒子中心的偏移轴、面在"右/上"方向上的半尺寸取哪两个轴
// right = up × normal，四个角 BL→BR→TR→TL 按这个顺序对外是逆时针（正面）
const BOX_FACES = {
  px: { n: [1, 0, 0],  u: [0, 1, 0],  r: [0, 0, -1], c: [1, 0, 0],  hr: 'd', hu: 'h' },
  nx: { n: [-1, 0, 0], u: [0, 1, 0],  r: [0, 0, 1],  c: [-1, 0, 0], hr: 'd', hu: 'h' },
  py: { n: [0, 1, 0],  u: [0, 0, -1], r: [1, 0, 0],  c: [0, 1, 0],  hr: 'w', hu: 'd' },
  ny: { n: [0, -1, 0], u: [0, 0, 1],  r: [1, 0, 0],  c: [0, -1, 0], hr: 'w', hu: 'd' },
  pz: { n: [0, 0, 1],  u: [0, 1, 0],  r: [1, 0, 0],  c: [0, 0, 1],  hr: 'w', hu: 'h' },
  nz: { n: [0, 0, -1], u: [0, 1, 0],  r: [-1, 0, 0], c: [0, 0, -1], hr: 'w', hu: 'h' },
};
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const FACE_PRESETS = {
  all: FACE_ORDER,
  sides: ['px', 'nx', 'pz', 'nz'],                 // 顶天立地的墙：顶面底面永远看不见，省三分之一三角形
  noBottom: ['px', 'nx', 'py', 'pz', 'nz'],        // 放在地上的东西：底面看不见
  noTop: ['px', 'nx', 'ny', 'pz', 'nz'],
};
function faceList(f) {
  if (!f) return FACE_ORDER;
  if (Array.isArray(f)) return f;
  if (FACE_PRESETS[f]) return FACE_PRESETS[f];
  return String(f).split(/[\s,]+/).filter(k => BOX_FACES[k]);
}

// =====================================================================
// Builder
// =====================================================================
class Builder {
  constructor(ctx, cx, cz, rng, opts) {
    const o = opts || {};
    this.ctx = ctx || {};
    this.level = this.ctx.level || null;
    this.cx = cx | 0;
    this.cz = cz | 0;
    const lvSize = this.level && this.level.chunkSize > 0 ? +this.level.chunkSize : 0;
    this.size = lvSize || (BR.world && BR.world.chunkSize) || 24;
    this.ox = this.cx * this.size;
    this.oz = this.cz * this.size;
    this.seed = (this.ctx.levelSeed != null ? this.ctx.levelSeed : (BR.world && BR.world.levelSeed) || 0) >>> 0;
    this.rng = typeof rng === 'function' ? rng : U.rng(this.seed, this.cx, this.cz);
    this.height = num(o.height, DEFAULT_HEIGHT);
    this.data = {};                      // 层级自由存放，finish 后原样挂到 ChunkResult.data
    this._accs = new Map();
    this._solids = [];
    this._lights = [];
    this._spawns = [];
    this._exits = [];                    // 出口句柄
    this._updates = [];
    this._objects = [];
    this._glowLinks = [];                // 发光面片 ↔ 灯光描述：闪烁/关灯时面片跟着明灭
    this._stack = [];
    this._T = { x: 0, y: 0, z: 0, rot: 0, c: 1, s: 0 };
    this._done = false;
  }

  // ---------- 局部坐标系 ----------
  // push 之后所有坐标都相对 (x, y, z)、绕 Y 转 rot；构件函数用它在"自己的"坐标系里摆零件
  push(x, z, rot, y) {
    const T = this._T;
    this._stack.push(T);
    const p = this.point(num(x, 0), num(z, 0));
    const r = T.rot + num(rot, 0);
    this._T = { x: p.x, y: T.y + num(y, 0), z: p.z, rot: r, c: Math.cos(r), s: Math.sin(r) };
    return this;
  }
  pop() {
    if (this._stack.length) this._T = this._stack.pop();
    return this;
  }
  // 当前坐标系下的点 → 区块本地坐标（绕 Y 旋转与 three.js rotation.y 同向：x' = c·x + s·z，z' = −s·x + c·z）
  point(x, z) {
    const T = this._T;
    return { x: T.x + T.c * x + T.s * z, z: T.z - T.s * x + T.c * z };
  }
  // 当前坐标系下的点 → 世界坐标
  world(x, z) {
    const p = this.point(x, z);
    return { x: this.ox + p.x, z: this.oz + p.z };
  }
  // 当前坐标系下某点的地面高度（层级在 enter 里装了高度场才有意义）
  groundY(x, z) {
    const w = this.world(num(x, 0), num(z, 0));
    return BR.phys && typeof BR.phys.groundY === 'function' ? +BR.phys.groundY(w.x, w.z) || 0 : 0;
  }

  _acc(matKey) {
    const k = matKey && matKey.isMaterial ? matKey : String(matKey || 'kit:prop');
    let a = this._accs.get(k);
    if (!a) { a = new Acc(k); this._accs.set(k, a); }
    return a;
  }

  // 追加一块几何：verts 为 [x,y,z, nx,ny,nz, u,v] 平铺数组（构件本地坐标，已含 rotY 前的形状）
  // base = 当前坐标系里的放置点，ang = 额外绕 Y 旋转
  _piece(matKey, x, y, z, ang, fill, opts) {
    const o = opts || {};
    const T = this._T;
    const a = this._acc(matKey);
    const p = this.point(x, z);
    const bx = p.x, by = T.y + y, bz = p.z;
    const th = T.rot + ang;
    const c = Math.cos(th), s = Math.sin(th);
    const start = a.n;
    const col = rgb(o.color, o.glow);
    const alp = a.alp, al = U.clamp(num(o.alpha, 1), 0, 1);
    const self = this;
    // 本地包围盒（旋转前的件坐标）：只有铺 kit:prop 纹理的材质要，判断整件退不退回纯色
    const gb = a.grainTex && o.grain == null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    // fill 回调里调 v(x,y,z,nx,ny,nz,u,v) 追加顶点、t(a,b,c) 追加三角形（索引相对本件）
    fill(function v(px, py, pz, nx, ny, nz, uu, vv) {
      a.pos.push(bx + c * px + s * pz, by + py, bz - s * px + c * pz);
      a.nor.push(c * nx + s * nz, ny, -s * nx + c * nz);
      a.uv.push(uu, vv);
      a.col.push(col[0], col[1], col[2]);
      if (alp) alp.push(al);
      a.n++;
      if (gb) {
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
      }
    }, function t(i0, i1, i2) {
      a.idx.push(start + i0, start + i1, start + i2);
    });
    const piece = new Piece(a, start, a.n - start, o.uv || 'world', o.uvScale, o.uvRepeat);
    if (o.uvMetric) piece.uvMetric = o.uvMetric;
    if (a.grainTex && a.n > start) {
      piece.flat = grainFlat(o.grain, x1 - x0, y1 - y0, z1 - z0);
      if (gb) piece.grainAuto = true;   // 缺省按自动规则：finish 时还要按颜色再判一次（浅色件退回纯色，见 grainBright）
    }
    a.pieces.push(piece);
    if (o.solid) self._solidFromRange(a, start, a.n);
    return piece;
  }

  _solidFromRange(a, i0, i1) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = i0; i < i1; i++) {
      const x = a.pos[i * 3], y = a.pos[i * 3 + 1], z = a.pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (minX <= maxX) this._pushSolid(minX, minY, minZ, maxX, maxY, maxZ);
  }

  _pushSolid(minX, minY, minZ, maxX, maxY, maxZ) {
    this._solids.push({
      minX: this.ox + minX, minY, minZ: this.oz + minZ,
      maxX: this.ox + maxX, maxY, maxZ: this.oz + maxZ,
    });
  }

  // ---------- 几何原语 ----------
  // 盒子：(x, z) 是底面中心，y 是底面高度；w 沿 x、h 沿 y、d 沿 z
  // opts: { solid=true, uv='world'|'stretch', faces='all'|'sides'|'noBottom'|'noTop'|['px',...], color, glow, rotY }
  // 倒角（用户 2026-10-01："一些方块的角不能太尖锐"）：opts.bevel = 半径（米）切出 45° 斜面、角上补三角，法线分面，斜面接光。
  // opts.bevelEdges：'all'（缺省，12 条棱）| 'vertical'（只倒 4 条竖棱：柱子、柜体）| 'top'（只倒顶面 4 条棱：桌面、箱子）| 'horizontal'（顶面+底面 8 条）。
  // 少画的面（faces 里没有的）旁边那几条棱不倒（贴地/贴墙那一面本来看不见）。半径超过所涉边长的一半自动收小；
  // 低画质、opts.detail === false、本块已到 DETAIL_TRI_CAP 时退回普通盒（碰撞体、占地完全一样）
  // opts.grain（只对 'kit:prop' 有意义，box/aabb/plane/quad/cylinder/mesh 通用）：false 或 0 = 这件不铺表面纹理（白板、白漆面、整面墙），
  // true = 一定铺；缺省按大小自动（最大一面 ≥ 3 m² 或细长大件不铺，见 grainFlat），浅色件（顶点色平均相对亮度 > 0.75）也不铺（见 grainBright）。两档画质一样
  box(x, y, z, w, h, d, matKey, opts) {
    const o = opts || {};
    if (o.bevel > 0 && hiDetail(this, o)) {
      const bp = this._bevelBox(x, y, z, w, h, d, matKey, o);
      if (bp) return bp;
    }
    const half = { w: w / 2, h: h / 2, d: d / 2 };
    const faces = faceList(o.faces);
    const piece = this._piece(matKey, x, y, z, num(o.rotY, 0), (v, t) => {
      let k = 0;
      for (let fi = 0; fi < faces.length; fi++) {
        const F = BOX_FACES[faces[fi]];
        if (!F) continue;
        const cxp = F.c[0] * half.w, cyp = half.h + F.c[1] * half.h, czp = F.c[2] * half.d;
        const hr = half[F.hr], hu = half[F.hu];
        const rx = F.r[0] * hr, ry = F.r[1] * hr, rz = F.r[2] * hr;
        const ux = F.u[0] * hu, uy = F.u[1] * hu, uz = F.u[2] * hu;
        const n = F.n;
        v(cxp - rx - ux, cyp - ry - uy, czp - rz - uz, n[0], n[1], n[2], 0, 0);
        v(cxp + rx - ux, cyp + ry - uy, czp + rz - uz, n[0], n[1], n[2], 1, 0);
        v(cxp + rx + ux, cyp + ry + uy, czp + rz + uz, n[0], n[1], n[2], 1, 1);
        v(cxp - rx + ux, cyp - ry + uy, czp - rz + uz, n[0], n[1], n[2], 0, 1);
        t(k, k + 1, k + 2); t(k, k + 2, k + 3);
        k += 4;
      }
    }, Object.assign({}, o, { solid: o.solid !== false }));
    return piece;
  }

  // 切角盒（box 的 bevel 分支）。每个面是一块凸多边形（四角按相邻棱倒没倒内缩，竖棱倒了而上下棱没倒时顶面是八边形），
  // 每条倒了的棱一条斜面带（两头按端部另两条棱倒没倒决定缩不缩，只倒上棱时四角是斜接），三条棱都倒了的角补一个三角。
  // 全部顶点按面各自独立（法线分面）。返回 null = 没有要倒的棱或半径太小，调用方画普通盒
  _bevelBox(x, y, z, w, h, d, matKey, o) {
    const H = [w / 2, h / 2, d / 2];
    if (!(H[0] > 0 && H[1] > 0 && H[2] > 0)) return null;
    const present = {};
    for (const f of faceList(o.faces)) if (BOX_FACES[f]) present[f] = true;
    const mode = o.bevelEdges || 'all';
    const FK = [['nx', 'px'], ['ny', 'py'], ['nz', 'pz']];
    const fk = (ax, s) => FK[ax][s > 0 ? 1 : 0];
    const want = (a, sa, b, sb) => {
      if (mode === 'vertical') return a !== 1 && b !== 1;
      if (mode === 'top') return (a === 1 && sa > 0) || (b === 1 && sb > 0);
      if (mode === 'horizontal') return a === 1 || b === 1;
      return true;
    };
    // 面 (a, sa) 与面 (b, sb) 之间那条棱倒不倒：模式要、两个面都画
    const ch = (a, sa, b, sb) => a !== b && want(a, sa, b, sb) && !!present[fk(a, sa)] && !!present[fk(b, sb)];
    let rmax = Infinity;
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (let k = 0; k < 4; k++) {
      if (ch(a, k & 1 ? 1 : -1, b, k & 2 ? 1 : -1)) rmax = Math.min(rmax, H[a], H[b]);
    }
    if (rmax === Infinity) return null;
    const r = Math.min(num(o.bevel, 0), rmax);
    if (!(r > 0.0015)) return null;
    const axisOf = vec => (vec[0] !== 0 ? 0 : vec[1] !== 0 ? 1 : 2);
    const uvOn = (fkey, p) => {
      const F = BOX_FACES[fkey], ra = axisOf(F.r), ua = axisOf(F.u);
      const x2 = p[0] * F.r[0] + p[1] * F.r[1] + p[2] * F.r[2], y2 = p[0] * F.u[0] + p[1] * F.u[1] + p[2] * F.u[2];
      return [(x2 + H[ra]) / (2 * H[ra]), (y2 + H[ua]) / (2 * H[ua])];
    };
    // 碰撞体按没倒角的盒子算（斜着放时切掉的角会让顶点包围盒小一圈）：倒不倒角、高低画质，碰撞完全一样
    if (o.solid !== false) {
      const T = this._T, p = this.point(x, z), th = T.rot + num(o.rotY, 0), c = Math.cos(th), s = Math.sin(th);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const X = p.x + c * sx * H[0] + s * sz * H[2], Z = p.z - s * sx * H[0] + c * sz * H[2];
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
      }
      this._pushSolid(x0, T.y + y, z0, x1, T.y + y + h, z1);
    }
    return this._piece(matKey, x, y, z, num(o.rotY, 0), (v, t) => {
      let k = 0;
      // 凸多边形（逆时针 = 正面朝 n；方向不对自动翻）扇形三角化；相邻重合点去掉
      const poly = (pts, n, uvs) => {
        const P = [], T = [];
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i], l = P[P.length - 1];
          if (l && Math.abs(l[0] - q[0]) + Math.abs(l[1] - q[1]) + Math.abs(l[2] - q[2]) < 1e-7) continue;
          P.push(q); T.push(uvs[i]);
        }
        while (P.length > 1) {
          const l = P[P.length - 1], f = P[0];
          if (Math.abs(l[0] - f[0]) + Math.abs(l[1] - f[1]) + Math.abs(l[2] - f[2]) < 1e-7) { P.pop(); T.pop(); } else break;
        }
        if (P.length < 3) return;
        let gx = 0, gy = 0, gz = 0;   // Newell 法线：判断绕向
        for (let i = 0; i < P.length; i++) {
          const p0 = P[i], p1 = P[(i + 1) % P.length];
          gx += (p0[1] - p1[1]) * (p0[2] + p1[2]); gy += (p0[2] - p1[2]) * (p0[0] + p1[0]); gz += (p0[0] - p1[0]) * (p0[1] + p1[1]);
        }
        const dot = gx * n[0] + gy * n[1] + gz * n[2];
        if (Math.abs(dot) < 1e-12) return;
        if (dot < 0) { P.reverse(); T.reverse(); }
        for (let i = 0; i < P.length; i++) v(P[i][0], P[i][1] + H[1], P[i][2], n[0], n[1], n[2], T[i][0], T[i][1]);
        for (let i = 1; i + 1 < P.length; i++) t(k, k + i, k + i + 1);
        k += P.length;
      };
      const unit = (a, b2, c) => { const l = Math.hypot(a, b2, c) || 1; return [a / l, b2 / l, c / l]; };
      // ① 六个面
      const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const fkey of FACE_ORDER) {
        if (!present[fkey]) continue;
        const F = BOX_FACES[fkey], a = axisOf(F.n), sa = F.n[a];
        const ra = axisOf(F.r), rs = F.r[ra], ua = axisOf(F.u), us = F.u[ua];
        const hr = H[ra], hu = H[ua];
        const pts2 = [];
        for (const [sr, su] of CORNERS) {
          const wr = sr * rs, wu = su * us;
          const cR = ch(a, sa, ra, wr), cU = ch(a, sa, ua, wu);
          if (cR && cU) pts2.push([sr * (hr - r), su * (hu - r)]);
          else if (cR) pts2.push([sr * (hr - r), su * hu]);
          else if (cU) pts2.push([sr * hr, su * (hu - r)]);
          else if (ch(ra, wr, ua, wu)) {
            // 这个角上只有不在本面上的那条棱倒了（竖棱倒、顶棱不倒时的顶面）：本面在角上切掉一个三角
            if (sr * su < 0) pts2.push([sr * (hr - r), su * hu], [sr * hr, su * (hu - r)]);
            else pts2.push([sr * hr, su * (hu - r)], [sr * (hr - r), su * hu]);
          } else pts2.push([sr * hr, su * hu]);
        }
        const pts = [], uvs = [];
        for (const q of pts2) {
          const p = [F.n[0] * H[a] + q[0] * F.r[0] + q[1] * F.u[0], F.n[1] * H[a] + q[0] * F.r[1] + q[1] * F.u[1], F.n[2] * H[a] + q[0] * F.r[2] + q[1] * F.u[2]];
          pts.push(p); uvs.push([(q[0] + hr) / (2 * hr), (q[1] + hu) / (2 * hu)]);
        }
        poly(pts, F.n, uvs);
      }
      // ② 倒了的棱：45° 斜面带。两头：面 A 那条边在端部另一条棱（A 与端面之间）倒了就缩 r，B 同理（两条都倒 = 角上有三角，只倒一条 = 斜接）
      for (let a = 0; a < 3; a++) for (let b2 = a + 1; b2 < 3; b2++) {
        const c = 3 - a - b2;
        for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
          if (!ch(a, sa, b2, sb)) continue;
          const end = (s, A) => {
            const p = [0, 0, 0];
            if (A) { p[a] = sa * H[a]; p[b2] = sb * (H[b2] - r); p[c] = s * (ch(a, sa, c, s) ? H[c] - r : H[c]); }
            else { p[a] = sa * (H[a] - r); p[b2] = sb * H[b2]; p[c] = s * (ch(b2, sb, c, s) ? H[c] - r : H[c]); }
            return p;
          };
          const n = [0, 0, 0]; n[a] = sa; n[b2] = sb;
          const pts = [end(-1, true), end(1, true), end(1, false), end(-1, false)];
          const fa = fk(a, sa);
          poly(pts, unit(n[0], n[1], n[2]), pts.map(p => uvOn(fa, p)));
        }
      }
      // ③ 三条棱都倒了的角：补一个三角
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        if (!(ch(0, sx, 1, sy) && ch(0, sx, 2, sz) && ch(1, sy, 2, sz))) continue;
        const pts = [[sx * H[0], sy * (H[1] - r), sz * (H[2] - r)], [sx * (H[0] - r), sy * H[1], sz * (H[2] - r)], [sx * (H[0] - r), sy * (H[1] - r), sz * H[2]]];
        const fa = fk(0, sx);
        poly(pts, unit(sx, sy, sz), pts.map(p => uvOn(fa, p)));
      }
    }, Object.assign({}, o, { solid: false }));
  }

  // 用最小/最大角点给盒子（当前坐标系下），墙体最常用
  aabb(minX, minY, minZ, maxX, maxY, maxZ, matKey, opts) {
    return this.box((minX + maxX) / 2, minY, (minZ + maxZ) / 2, maxX - minX, maxY - minY, maxZ - minZ, matKey, opts);
  }

  // 平面：facing 'up'（地板，默认）/'down'（天花板）时 (x,y,z) 是面中心，w 沿 x、h 沿 z；
  // facing '+z' '-z' '+x' '-x'（立面）时 (x,z) 是底边中点、y 是底边高度，w 沿水平方向、h 沿 y
  // opts: { facing, solid=false, uv='world', color, glow, rotY, uvRepeat:[u,v]（stretch 时每面贴几遍） }
  plane(x, y, z, w, h, matKey, opts) {
    const o = opts || {};
    const f = o.facing || 'up';
    const hw = w / 2, hh = h / 2;
    return this._piece(matKey, x, y, z, num(o.rotY, 0), (v, t) => {
      if (f === 'up' || f === 'down') {
        const up = f === 'up';
        const ny = up ? 1 : -1, uz = up ? -1 : 1;
        v(-hw, 0, -uz * hh, 0, ny, 0, 0, 0);
        v(hw, 0, -uz * hh, 0, ny, 0, 1, 0);
        v(hw, 0, uz * hh, 0, ny, 0, 1, 1);
        v(-hw, 0, uz * hh, 0, ny, 0, 0, 1);
      } else {
        // 立面：n 为法线，r = up × n
        const n = f === '+x' ? [1, 0, 0] : f === '-x' ? [-1, 0, 0] : f === '-z' ? [0, 0, -1] : [0, 0, 1];
        const r = [n[2], 0, -n[0]];
        v(-r[0] * hw, 0, -r[2] * hw, n[0], 0, n[2], 0, 0);
        v(r[0] * hw, 0, r[2] * hw, n[0], 0, n[2], 1, 0);
        v(r[0] * hw, h, r[2] * hw, n[0], 0, n[2], 1, 1);
        v(-r[0] * hw, h, -r[2] * hw, n[0], 0, n[2], 0, 1);
      }
      t(0, 1, 2); t(0, 2, 3);
    }, Object.assign({}, o, { solid: !!o.solid }));
  }

  // 任意四边形（当前坐标系下的 4 个 [x,y,z]，逆时针为正面）：坡道、斜顶、异形墙
  quad(p0, p1, p2, p3, matKey, opts) {
    const o = opts || {};
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return this._piece(matKey, 0, 0, 0, 0, (v, t) => {
      v(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
      v(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0);
      v(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1);
      v(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1);
      t(0, 1, 2); t(0, 2, 3);
    }, Object.assign({}, o, { solid: !!o.solid }));
  }

  // 圆柱：axis 'y'（默认）时 (x,z) 是底面圆心、y 是底面高度；axis 'x'/'z' 时 (x,y,z) 是轴线中点
  // opts: { rTop（默认同 r）, segments=8, axis, caps=true, solid（默认 axis==='y'）, uv='world', color, glow }
  cylinder(x, y, z, r, h, matKey, opts) {
    const o = opts || {};
    const g = new THREE.CylinderGeometry(num(o.rTop, r), r, h, Math.max(3, o.segments | 0 || 8), 1, o.caps === false);
    const axis = o.axis || 'y';
    const uvScale = [TAU * r, h];
    // 'kit:prop' 这类"一律按米数平铺"的材质：stretch 对它没意义，侧面按周长×高度、端盖按半径换成米（不然端盖被拉成 π 倍）
    const dm = defOf(matKey);
    let uvm = o.uv || 'world';
    if (dm && dm.uvAll === 'world' && (uvm === 'stretch' || uvm === 'world')) uvm = 'world';
    if (uvm === 'world' && o.caps !== false && h > 1e-6) {
      const T = g.attributes.uv, NN = g.attributes.normal;
      for (let i = 0; i < T.count; i++) {
        const ny = NN.getY(i);
        if (Math.abs(ny) < 0.999) continue;
        const rc = ny > 0 ? num(o.rTop, r) : r;
        T.setXY(i, (T.getX(i) - 0.5) * 2 * rc / uvScale[0], (T.getY(i) - 0.5) * 2 * rc / h);
      }
    }
    if (axis === 'y') g.translate(0, h / 2, 0);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    else g.rotateX(Math.PI / 2);
    const piece = this.mesh(g, matKey, Object.assign({}, o, {
      x, y, z, solid: o.solid != null ? o.solid : axis === 'y',
      uv: uvm === 'world' ? 'scaled' : uvm, uvScale,
    }));
    g.dispose();
    return piece;
  }

  // 任意 BufferGeometry（构件本地坐标；只读 position/normal/uv，没有 index 也行）
  // opts: { x, y, z, rotY, solid=false, uv='keep'|'world'|'stretch', color, glow }；几何只被读取，调用方可自行 dispose
  mesh(geometry, matKey, opts) {
    const o = opts || {};
    const P = geometry.attributes.position, N = geometry.attributes.normal, T = geometry.attributes.uv;
    if (!N) geometry.computeVertexNormals();
    const NN = geometry.attributes.normal;
    const index = geometry.index;
    const uvMode = o.uv === 'keep' || !o.uv ? 'stretch' : o.uv;
    // 'kit:prop' 这类按米数平铺的材质：光滑几何（球、环、自带 UV 的圆管）不能逐顶点按法线投影（相邻顶点法线不同，UV 会乱），
    // 改为保留几何自带 UV、再按"每单位 UV 对应多少米"放大 —— 从光滑棱上量出来（沿 u 走的边、沿 v 走的边分别统计）
    let metric = null;
    const dm = defOf(matKey);
    if (dm && dm.uvAll === 'world' && T && (uvMode === 'stretch' || uvMode === 'world')) metric = uvMetricOf(P, NN, T, index);
    return this._piece(matKey, num(o.x, 0), num(o.y, 0), num(o.z, 0), num(o.rotY, 0), (v, t) => {
      for (let i = 0; i < P.count; i++) {
        v(P.getX(i), P.getY(i), P.getZ(i), NN.getX(i), NN.getY(i), NN.getZ(i), T ? T.getX(i) : 0, T ? T.getY(i) : 0);
      }
      if (index) for (let i = 0; i < index.count; i += 3) t(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      else for (let i = 0; i + 2 < P.count; i += 3) t(i, i + 1, i + 2);
    }, Object.assign({}, o, { uv: uvMode, solid: !!o.solid, uvMetric: metric }));
  }

  // 不合并的独立物体（会动的门、错位的墙）：每个多 1 个 draw call，少用。
  // obj 的坐标按当前坐标系放置（obj.position 视为本地偏移），solid 时按包围盒出碰撞体
  object(obj, opts) {
    const o = opts || {};
    const T = this._T;
    const p = this.point(obj.position.x, obj.position.z);
    obj.position.set(p.x, T.y + obj.position.y, p.z);
    obj.rotation.y += T.rot;
    if (o.solid) {
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj);
      if (!bb.isEmpty()) this._pushSolid(bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z);
    }
    this._objects.push(obj);
    return obj;
  }

  // 纯碰撞体（当前坐标系下的最小/最大角点；有旋转时取旋转后的外接 AABB）
  solid(minX, minY, minZ, maxX, maxY, maxZ) {
    const T = this._T;
    const pts = [this.point(minX, minZ), this.point(maxX, minZ), this.point(maxX, maxZ), this.point(minX, maxZ)];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of pts) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
    this._pushSolid(x0, T.y + minY, z0, x1, T.y + maxY, z1);
    return this;
  }

  // ---------- 灯、刷新点、出口、动画 ----------
  // 返回推给 world/gfx 的那份描述（世界坐标）：层级之后改它的 intensity/color，真光和发光面片都会跟着变
  light(desc) {
    const d = desc || {};
    const p = this.point(num(d.x, 0), num(d.z, 0));
    const L = Object.assign({}, d, {
      x: this.ox + p.x, y: this._T.y + num(d.y, this.height - 0.35), z: this.oz + p.z,
      color: d.color != null ? d.color : 0xfff1d0,
      intensity: num(d.intensity, 1),
      range: num(d.range, 9),
      flicker: U.clamp(num(d.flicker, 0), 0, 1),
    });
    this._lights.push(L);
    return L;
  }

  // 物品/实体刷新点。y 缺省取高度场；finish 时剔掉卡在碰撞体里或压在出口圈上的点
  // tag: 'floor' | 'room' | 'dark' | 层级自定义；opts.safe = true 时不刷有害实体（安全屋）
  spawn(x, z, tag, opts) {
    const o = opts || {};
    const w = this.world(num(x, 0), num(z, 0));
    const y = o.y != null ? this._T.y + o.y : (BR.phys && BR.phys.groundY ? +BR.phys.groundY(w.x, w.z) || 0 : 0);
    const sp = { x: w.x, y, z: w.z, tag: tag || 'floor' };
    if (o.safe) sp.safe = true;
    this._spawns.push(sp);
    return sp;
  }

  // 出口描述（不摆实物；要实物用 BR.kit.exit）。返回句柄 { desc, setActive(bool), active, sealed, to, kind }
  exit(desc) {
    const d = desc || {};
    const p = this.point(num(d.x, 0), num(d.z, 0));
    const to = normId(d.to);
    const sealed = d.sealed != null ? !!d.sealed : !inRange(to);
    const kind = d.kind || 'zone';
    const ex = {
      x: this.ox + p.x, y: this._T.y + num(d.y, 0), z: this.oz + p.z,
      radius: sealed ? Math.max(num(d.radius, 1), SEALED_MIN_RADIUS) : num(d.radius, 1),
      to, kind,
      label: d.label || (sealed ? levelName(to) + ' 尚未开放' : '前往 ' + levelName(to)),
      sealed,
      active: d.active != null ? !!d.active : kind !== 'event',
    };
    if (sealed) ex.sealedText = d.sealedText || levelName(to) + ' 尚未开放';
    if (d.tag != null) ex.tag = d.tag;
    const h = new ExitHandle(ex);
    this._exits.push(h);
    return h;
  }

  // 区块级每帧回调 fn(dt, t, res)：t 是本区块载入后累计秒数；区块卸载后不再调用
  update(fn) {
    if (typeof fn === 'function') this._updates.push(fn);
    return this;
  }

  // 发光面片跟随灯光描述明灭（gfx.flickerAt 同一纯函数，面片与真光逐帧对齐）
  linkGlow(piece, src, base, offRatio) {
    if (piece && src) this._glowLinks.push({ piece, src, base: base || [1, 1, 1], off: num(offRatio, 0.06), last: -1 });
    return this;
  }
}

// ---------- 已合并几何里的一件：之后可以改颜色、隐藏 ----------
// 发光件的闪烁、事件门的出现/消失都靠它，不用为一扇门单独建 mesh
class Piece {
  constructor(acc, start, count, uv, uvScale, uvRepeat) {
    this.acc = acc;
    this.start = start;
    this.count = count;
    this.uv = uv;
    this.uvScale = uvScale || null;
    this.uvRepeat = uvRepeat || null;
    this.mesh = null;            // finish 后才有
    this._saved = null;
    this._pendingVisible = null;
  }
  // c: hex 或 [r,g,b]（可 >1），mul 乘系数；材质不带 vertexColors 时无效
  setColor(c, mul) {
    const col = rgb(c, mul);
    if (!this.mesh) {
      const a = this.acc.col;
      if (!a) return this;
      for (let i = this.start; i < this.start + this.count; i++) { a[i * 3] = col[0]; a[i * 3 + 1] = col[1]; a[i * 3 + 2] = col[2]; }
      return this;
    }
    const attr = this.mesh.geometry.attributes.color;
    if (!attr) { warnOnce('nocolor:' + this.mesh.name, '材质 "' + this.mesh.name + '" 没开 vertexColors，setColor 无效'); return this; }
    const arr = attr.array, st = attr.itemSize;   // 贴花是 RGBA（4 个一组），只改 RGB
    for (let i = this.start; i < this.start + this.count; i++) { arr[i * st] = col[0]; arr[i * st + 1] = col[1]; arr[i * st + 2] = col[2]; }
    markRange(attr, this.start, this.count);
    return this;
  }
  // 透明度 0..1（只对 vertexAlphas 的材质有效，即 'kit:decal'）：事件里"慢慢显出来的血迹/水渍"用它，每帧只改这几个顶点
  setOpacity(a) {
    const v = U.clamp(num(a, 1), 0, 1);
    if (!this.mesh) {
      const al = this.acc.alp;
      if (al) for (let i = this.start; i < this.start + this.count; i++) al[i] = v;
      return this;
    }
    const attr = this.mesh.geometry.attributes.color;
    if (!attr || attr.itemSize !== 4) { warnOnce('noalpha:' + this.mesh.name, '材质 "' + this.mesh.name + '" 没有顶点 alpha，setOpacity 无效'); return this; }
    const arr = attr.array;
    for (let i = this.start; i < this.start + this.count; i++) arr[i * 4 + 3] = v;
    markRange(attr, this.start, this.count);
    return this;
  }
  // 隐藏 = 把这件的顶点全部叠到第一个顶点上（零面积三角形不出像素），显示时从备份恢复
  setVisible(on) {
    on = !!on;
    if (!this.mesh) { this._pendingVisible = on; return this; }
    const attr = this.mesh.geometry.attributes.position;
    const arr = attr.array;
    const s = this.start * 3, e = (this.start + this.count) * 3;
    if (!on) {
      if (this._saved) return this;
      this._saved = arr.slice(s, e);
      const x = arr[s], y = arr[s + 1], z = arr[s + 2];
      for (let i = s; i < e; i += 3) { arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; }
    } else {
      if (!this._saved) return this;
      arr.set(this._saved, s);
      this._saved = null;
    }
    markRange(attr, this.start, this.count);
    return this;
  }
  get visible() { return this.mesh ? !this._saved : this._pendingVisible !== false; }
}

// 局部上传：一帧里多件变化时取并集。three 上传后会把 updateRange.count 置回 -1，下一帧重新开始累积
function markRange(attr, start, count) {
  const r = attr.updateRange;
  const s = start * attr.itemSize, e = (start + count) * attr.itemSize;
  if (r.count === -1) { r.offset = s; r.count = e - s; }
  else { const end = Math.max(r.offset + r.count, e); r.offset = Math.min(r.offset, s); r.count = end - r.offset; }
  attr.needsUpdate = true;
}

// ---------- 出口句柄 ----------
class ExitHandle {
  constructor(desc) { this.desc = desc; this.parts = null; }
  get active() { return this.desc.active !== false; }
  // 事件型出口由层级决定何时生效；world 跳过 active === false 的出口
  setActive(v) { this.desc.active = !!v; return this; }
  get sealed() { return !!this.desc.sealed; }
  get to() { return this.desc.to; }
  get kind() { return this.desc.kind; }
  get x() { return this.desc.x; }
  get z() { return this.desc.z; }
}

const SEALED_MIN_RADIUS = 1.4;     // 未开放出口的提示圈放大一点："靠近就提示"，不用贴脸

// 'Level 7' → '7'，'Level !' / '!' → 'run'，'Level Fun' → 'fun'；其他原样（'The Void'）
function normId(to) {
  if (to == null) return '';
  let s = String(to).trim();
  const m = /^level\s+(.+)$/i.exec(s);
  if (m) s = m[1].trim();
  const low = s.toLowerCase();
  if (low === '!' || low === 'run') return 'run';
  if (low === 'fun') return 'fun';
  if (low === 'dev') return 'dev';
  return s;
}
// 首期范围：LEVEL_ORDER（0–20、fun、run）；dev 是开发层，不在顺序表里但要能真换层
function inRange(id) {
  id = String(id);
  return (BR.LEVEL_ORDER || []).indexOf(id) >= 0 || id === 'dev';
}
function levelName(id) {
  id = String(id);
  if (id === 'run') return 'Level !';
  if (id === 'fun') return 'Level Fun';
  if (id === 'dev') return 'Level Dev';
  if (/^-?\d+(\.\d+)?$/.test(id) || inRange(id)) return 'Level ' + id;
  return id;
}

// ---------- finish ----------
const SPAWN_CLEAR = 0.45;          // 刷新点离碰撞体至少这么远：实体半径 0.4 左右，放下去不会卡墙
function frac(a) { return a - Math.floor(a); }

// 光滑几何每单位 UV 对应多少米：只统计两端法线不同的棱（光滑面上的棱；端盖这类平面上的棱 UV 往往是另一套投影），
// 沿 u 走的棱、沿 v 走的棱分别求 米数 / UV 差。全是平面（法线逐面一致）返回 null —— 平面按法线投影更准
function uvMetricOf(P, N, T, index) {
  const cnt = index ? index.count : P.count - P.count % 3;
  let Lu = 0, Uu = 0, Lv = 0, Vv = 0, smooth = false;
  const edge = (i, j) => {
    if (N.getX(i) * N.getX(j) + N.getY(i) * N.getY(j) + N.getZ(i) * N.getZ(j) > 0.9999) return;
    smooth = true;
    const du = Math.abs(T.getX(i) - T.getX(j)), dv = Math.abs(T.getY(i) - T.getY(j));
    const L = Math.hypot(P.getX(i) - P.getX(j), P.getY(i) - P.getY(j), P.getZ(i) - P.getZ(j));
    if (du > 1e-6 && du > dv * 4) { Lu += L; Uu += du; } else if (dv > 1e-6 && dv > du * 4) { Lv += L; Vv += dv; }
  };
  for (let k = 0; k + 2 < cnt; k += 3) {
    const a = index ? index.getX(k) : k, b = index ? index.getX(k + 1) : k + 1, c = index ? index.getX(k + 2) : k + 2;
    edge(a, b); edge(b, c); edge(c, a);
  }
  if (!smooth) return null;
  const su = Uu > 0 ? Lu / Uu : 0, sv = Vv > 0 ? Lv / Vv : 0, s0 = su || sv || 1;
  return [su || s0, sv || s0];
}

// uvAll === 'world'（'kit:prop'）：不管件是用什么 uv 方式加进来的，一律换成按米数平铺 ——
// 平面件按法线投影（与 'world' 相同），光滑件用 uvMetric 放大自带 UV，圆柱（'scaled'）本来就是米数，'solid' 不动
function fillUV(a, pc, rep, off, ox, oz, uvAll) {
  const ru = rep[0], rv = rep[1];
  const i0 = pc.start, i1 = pc.start + pc.count;
  const P = a.pos, N = a.nor, T = a.uv;
  let mode = pc.uv;
  if (uvAll === 'world' && mode !== 'solid' && mode !== 'scaled') mode = pc.uvMetric ? 'metric' : 'world';
  // pc.flat：kit:prop 整件退回纯色（opts.grain === false、大面自动判断 grainFlat、浅色件 grainBright）—— 和 'solid' 一样钉在均值纹素上
  if (mode === 'solid' || pc.flat) {
    for (let i = i0; i < i1; i++) { T[i * 2] = WHITE_UV[0]; T[i * 2 + 1] = WHITE_UV[1]; }
    return;
  }
  if (mode === 'metric') {
    const su = pc.uvMetric[0] / ru, sv = pc.uvMetric[1] / rv;
    for (let i = i0; i < i1; i++) { T[i * 2] *= su; T[i * 2 + 1] *= sv; }
    return;
  }
  if (mode === 'stretch') {
    if (pc.uvRepeat) for (let i = i0; i < i1; i++) { T[i * 2] *= pc.uvRepeat[0]; T[i * 2 + 1] *= pc.uvRepeat[1]; }
    return;
  }
  if (mode === 'scaled') {
    const su = pc.uvScale ? pc.uvScale[0] / ru : 1, sv = pc.uvScale ? pc.uvScale[1] / rv : 1;
    for (let i = i0; i < i1; i++) { T[i * 2] *= su; T[i * 2 + 1] *= sv; }
    return;
  }
  // world：按法线挑投影面，用"区块本地米数 + 区块原点的小数部分"——相邻区块贴图无缝，UV 数值又不会随走远变大丢精度
  const fxU = frac(ox / ru), fzU = frac(oz / ru), fzV = frac(oz / rv);
  const ou = off ? num(off[0], 0) / ru : 0, ov = off ? num(off[1], 0) / rv : 0;
  for (let i = i0; i < i1; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    if (ny > 0.5 || ny < -0.5) {
      const vz = z / rv + fzV;
      T[i * 2] = x / ru + fxU - ou;
      T[i * 2 + 1] = (ny > 0 ? -vz : vz) - ov;
    } else {
      // 立面：u 取"站在面前的人的右手方向"，贴图不镜像
      const l = Math.hypot(nx, nz) || 1;
      const tx = nz / l, tz = -nx / l;
      T[i * 2] = (x * tx + z * tz) / ru + fxU * tx + fzU * tz - ou;
      T[i * 2 + 1] = y / rv - ov;
    }
  }
}

function spawnBlocked(sp, solids) {
  const r2 = SPAWN_CLEAR * SPAWN_CLEAR;
  const y0 = sp.y + 0.05, y1 = sp.y + 1.7;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.maxY <= y0 || s.minY >= y1) continue;
    const dx = Math.max(s.minX - sp.x, 0, sp.x - s.maxX);
    const dz = Math.max(s.minZ - sp.z, 0, sp.z - s.maxZ);
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

function flickerOf(src) {
  const g = BR.gfx;
  return g && typeof g.flickerAt === 'function' ? g.flickerAt(src) : 1;
}

Builder.prototype.finish = function () {
  if (this._done) throw new Error('[kit] 同一个 builder 只能 finish 一次');
  this._done = true;
  // 工坊钩子：合并几何前让工坊把新增出口、自由墙摆进去；_wsHelper 标记的内部一次性 builder（noclipPatch 那种）跳过
  if (!this._wsHelper && BR.workshop && typeof BR.workshop.decorate === 'function') BR.workshop.decorate(this);
  const group = new THREE.Group();
  group.name = 'chunk ' + (this.level ? this.level.id : '?') + ' ' + this.cx + ',' + this.cz;
  let tris = 0;
  this._accs.forEach(a => {
    if (!a.n || !a.idx.length) return;
    const m = mat(a.key);
    const def = defOf(a.key) || {};
    const rep = (m.userData && m.userData.kitRepeat) || repeatOf(def);
    for (let i = 0; i < a.pieces.length; i++) {
      const pc = a.pieces[i];
      if (pc.grainAuto && !pc.flat && grainBright(a.col, pc.start, pc.count)) pc.flat = true;
      fillUV(a, pc, rep, def.uvOffset, this.ox, this.oz, def.uvAll);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    if (m.vertexColors && a.alp) {
      // RGBA 顶点色：three 看到 itemSize 4 自动开 vertexAlphas
      const c4 = new Float32Array(a.n * 4);
      for (let i = 0; i < a.n; i++) { c4[i * 4] = a.col[i * 3]; c4[i * 4 + 1] = a.col[i * 3 + 1]; c4[i * 4 + 2] = a.col[i * 3 + 2]; c4[i * 4 + 3] = a.alp[i]; }
      geo.setAttribute('color', new THREE.BufferAttribute(c4, 4));
    } else if (m.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    geo.setIndex(a.n > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
    geo.computeBoundingSphere();
    tris += a.idx.length / 3;
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = a.key && a.key.isMaterial ? (a.key.name || 'material') : String(a.key);
    mesh.matrixAutoUpdate = false;   // 静态几何：省掉每帧重算本地矩阵
    if (m.transparent) mesh.renderOrder = def.renderOrder != null ? def.renderOrder : 2;
    group.add(mesh);
    // 数组已经拷进 typed array，释放掉；Piece 之后改的是 attribute
    a.pos = a.nor = a.uv = a.col = a.idx = a.alp = null;
    for (let i = 0; i < a.pieces.length; i++) {
      const pc = a.pieces[i];
      pc.mesh = mesh;
      if (pc._pendingVisible === false) pc.setVisible(false);
    }
  });
  for (let i = 0; i < this._objects.length; i++) group.add(this._objects[i]);
  // 几何按区块本地坐标建、整组平移：顶点坐标小，走到几公里外也不丢精度
  group.position.set(this.ox, 0, this.oz);
  group.updateMatrix();
  group.matrixAutoUpdate = false;

  const solids = this._solids;
  const exits = this._exits.map(h => h.desc);
  const spawnPoints = [];
  let dropped = 0;
  for (let i = 0; i < this._spawns.length; i++) {
    const sp = this._spawns[i];
    let bad = spawnBlocked(sp, solids);
    for (let k = 0; !bad && k < exits.length; k++) {
      const ex = exits[k];
      const r = ex.radius + 0.4;
      if (U.dist2(sp.x, sp.z, ex.x, ex.z) < r * r) bad = true;   // 物品别刷在出口圈上：一弯腰就被传走
    }
    if (bad) dropped++; else spawnPoints.push(sp);
  }

  const res = {
    group, solids, lights: this._lights, spawnPoints, exits,
    data: this.data,
    kit: { exits: this._exits, stats: { meshes: group.children.length, triangles: tris, solids: solids.length, lights: this._lights.length, spawnPoints: spawnPoints.length, spawnDropped: dropped } },
  };
  const links = this._glowLinks, ups = this._updates;
  if (links.length || ups.length) {
    let t = 0;
    res.update = function (dt) {
      t += dt;
      for (let i = 0; i < links.length; i++) {
        const L = links[i], src = L.src;
        const k = !(src.intensity > 0) ? L.off : src.flicker > 0 ? flickerOf(src) : 1;
        if (Math.abs(k - L.last) < 0.02) continue;   // 没变就不重传顶点色
        L.last = k;
        L.piece.setColor(L.base, k);
      }
      for (let i = 0; i < ups.length; i++) ups[i](dt, t, res);
    };
  }
  return res;
};

// =====================================================================
// 格子布局（跨区块无缝）
// =====================================================================
// 墙在格线上：v[i*rows + j] 是 x = i*cellW 这条竖线上第 j 行的墙段，h[j*cols + i] 是 z = j*cellD 这条横线上第 i 列的墙段。
// i = 0 / cols、j = 0 / rows 是区块边界线：只由"层级种子 + salt + 这条线的全局坐标"哈希决定，
// 相邻两块各自算出来完全一样，所以两边都能各画半堵墙、各出碰撞体，邻块还没载入时边界也挡得住。
// 后室不是完美迷宫：先按马尔可夫链撒长段墙，再掏房间、并查集打通孤岛、给死胡同开洞形成回路、在四面空旷的格点立柱子

function markovFill(rng, arr, off, n, dens, stay) {
  // 稳态墙占比 = dens：P(有墙→有墙) = stay，P(无墙→有墙) = dens·(1−stay)/(1−dens)
  const start = Math.min(1, dens * (1 - stay) / Math.max(1e-6, 1 - dens));
  let on = rng() < dens;
  for (let k = 0; k < n; k++) {
    on = rng() < (on ? stay : start);
    arr[off + k] = on ? 1 : 0;
  }
}

function boundaryLine(seed, salt, axis, lx, lz, n, dens, stay, minOpen) {
  const r = U.rng(seed, salt, 'kit-edge', axis, lx, lz);
  const out = new Uint8Array(n);
  markovFill(r, out, 0, n, dens, stay);
  const need = Math.min(n, minOpen == null ? Math.max(1, Math.floor(n / 4)) : Math.max(0, minOpen | 0));
  let open = 0;
  for (let k = 0; k < n; k++) if (!out[k]) open++;
  for (let guard = 0; open < need && guard < n * 8; guard++) {
    const k = Math.floor(r() * n);
    if (out[k]) { out[k] = 0; open++; }
  }
  return out;
}

class Grid {
  constructor(b, cols, rows, o) {
    this.cols = cols;
    this.rows = rows;
    this.size = b.size;
    this.cellW = b.size / cols;
    this.cellD = b.size / rows;
    this.v = new Uint8Array((cols + 1) * rows);
    this.h = new Uint8Array((rows + 1) * cols);
    this.lockV = new Uint8Array(this.v.length);
    this.lockH = new Uint8Array(this.h.length);
    this.room = new Uint8Array(cols * rows);
    this.reserved = new Uint8Array(cols * rows);
    this.pillars = [];
    this.rooms = [];
    this._dirty = false;                  // setWall 加过墙：gridWalls 之前要再打通一次，否则可能把格子围死
    this._wsEdited = false;               // BR.workshop.applyGrid 编辑过：gridWalls 整个跳过 reconnect
    this._rr = [b.seed, b.cx, b.cz];      // reconnect 默认随机流的种子：不碰层级的 rng，加一堵墙不会让后面的灯/地标全挪位
    this._gen(b, o);
  }

  _gen(b, o) {
    const cols = this.cols, rows = this.rows;
    const rng = typeof o.rng === 'function' ? o.rng : b.rng;
    const salt = o.salt != null ? String(o.salt) : 'grid';
    this._salt = salt;
    const dens = U.clamp(num(o.wallDensity, 0.4), 0, 0.95);
    const stay = U.clamp(num(o.straightness, 0.7), 0, 0.98);
    const bDens = U.clamp(num(o.boundaryDensity, dens), 0, 0.95);
    const minOpen = o.minOpenings;
    const seed = b.seed;

    // 边界：西/东竖线，北/南横线（东线 = 东邻块的西线，南线 = 南邻块的北线）
    const west = boundaryLine(seed, salt, 'v', b.cx, b.cz, rows, bDens, stay, minOpen);
    const east = boundaryLine(seed, salt, 'v', b.cx + 1, b.cz, rows, bDens, stay, minOpen);
    const north = boundaryLine(seed, salt, 'h', b.cx, b.cz, cols, bDens, stay, minOpen);
    const south = boundaryLine(seed, salt, 'h', b.cx, b.cz + 1, cols, bDens, stay, minOpen);
    this.v.set(west, 0);
    this.v.set(east, cols * rows);
    this.h.set(north, 0);
    this.h.set(south, rows * cols);

    // 内部墙：只吃 rng，消耗顺序固定
    for (let i = 1; i < cols; i++) markovFill(rng, this.v, i * rows, rows, dens, stay);
    for (let j = 1; j < rows; j++) markovFill(rng, this.h, j * cols, cols, dens, stay);

    // 开阔房间
    const roomChance = U.clamp(num(o.roomChance, 0.3), 0, 1);
    const maxRooms = o.maxRooms != null ? o.maxRooms | 0 : 2;
    const rs = Array.isArray(o.roomSize) ? o.roomSize : [2, 4];
    for (let r = 0; r < maxRooms; r++) {
      if (!(rng() < roomChance)) break;
      const w = Math.min(cols, U.randInt(rng, rs[0] | 0, rs[1] | 0));
      const d = Math.min(rows, U.randInt(rng, rs[0] | 0, rs[1] | 0));
      const i0 = U.randInt(rng, 0, cols - w), j0 = U.randInt(rng, 0, rows - d);
      this.carve(i0, j0, w, d, { room: true });
      this.rooms.push({ i: i0, j: j0, w, d });
    }

    this.reconnect(rng);

    // 回路：死胡同（三面墙）按概率再打通一面内部墙
    const loopChance = U.clamp(num(o.loopChance, 0.5), 0, 1);
    if (loopChance > 0) {
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (this.wallCount(i, j) < 3) continue;
          if (!(rng() < loopChance)) continue;
          const opts = [];
          if (j > 0 && this.h[j * cols + i] && !this.lockH[j * cols + i]) opts.push(['h', i, j]);
          if (j < rows - 1 && this.h[(j + 1) * cols + i] && !this.lockH[(j + 1) * cols + i]) opts.push(['h', i, j + 1]);
          if (i > 0 && this.v[i * rows + j] && !this.lockV[i * rows + j]) opts.push(['v', i, j]);
          if (i < cols - 1 && this.v[(i + 1) * rows + j] && !this.lockV[(i + 1) * rows + j]) opts.push(['v', i + 1, j]);
          if (!opts.length) continue;
          const e = opts[Math.floor(rng() * opts.length)];
          if (e[0] === 'h') this.h[e[2] * cols + e[1]] = 0; else this.v[e[1] * rows + e[2]] = 0;
        }
      }
    }

    // 柱子：四条相连墙段都不存在的内部格点（开阔区里就会连成柱厅）
    const pillarChance = U.clamp(num(o.pillarChance, 0), 0, 1);
    if (pillarChance > 0) {
      for (let j = 1; j < rows; j++) {
        for (let i = 1; i < cols; i++) {
          if (!this.vertexFree(i, j)) continue;
          if (rng() < pillarChance) this.pillars.push({ i, j });
        }
      }
    }
  }

  // ---------- 查询 ----------
  isWall(axis, i, j) {
    if (axis === 'v') return i >= 0 && i <= this.cols && j >= 0 && j < this.rows && !!this.v[i * this.rows + j];
    return j >= 0 && j <= this.rows && i >= 0 && i < this.cols && !!this.h[j * this.cols + i];
  }
  // 格子四面：n = 北（−z）、s = 南（+z）、w = 西（−x）、e = 东（+x）
  walls(i, j) {
    return {
      n: this.isWall('h', i, j), s: this.isWall('h', i, j + 1),
      w: this.isWall('v', i, j), e: this.isWall('v', i + 1, j),
    };
  }
  wallCount(i, j) {
    const w = this.walls(i, j);
    return (w.n ? 1 : 0) + (w.s ? 1 : 0) + (w.w ? 1 : 0) + (w.e ? 1 : 0);
  }
  vertexFree(i, j) {
    return !this.isWall('v', i, j - 1) && !this.isWall('v', i, j) && !this.isWall('h', i - 1, j) && !this.isWall('h', i, j);
  }
  center(i, j) { return { x: (i + 0.5) * this.cellW, z: (j + 0.5) * this.cellD }; }
  cellAt(x, z) {
    return {
      i: U.clamp(Math.floor(x / this.cellW), 0, this.cols - 1),
      j: U.clamp(Math.floor(z / this.cellD), 0, this.rows - 1),
    };
  }
  isRoom(i, j) { return !!this.room[j * this.cols + i]; }
  isReserved(i, j) { return !!this.reserved[j * this.cols + i]; }
  reserve(i, j) {
    if (i >= 0 && i < this.cols && j >= 0 && j < this.rows) this.reserved[j * this.cols + i] = 1;
    return this;
  }
  // filter 可选：({ i, j, x, z, room, reserved, walls }) => bool
  cells(filter) {
    const out = [];
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const c = this.center(i, j);
        const cell = { i, j, x: c.x, z: c.z, room: this.isRoom(i, j), reserved: this.isReserved(i, j), walls: this.wallCount(i, j) };
        if (!filter || filter(cell)) out.push(cell);
      }
    }
    return out;
  }
  deadEnds() { return this.cells(c => c.walls === 3 && !c.reserved); }

  // 墙段/开口列表。{ wall: true 只要有墙的 | false 只要开口 | 省略全要, interior: true 排除区块边界线, unlocked }
  // 每项 { axis, i, j, x, z, rot, len }：rot 让"正面朝 +Z 的构件"正对格子 (i, j)；翻面加 Math.PI
  edges(filter) {
    const f = filter || {};
    const out = [];
    const cols = this.cols, rows = this.rows;
    for (let i = 0; i <= cols; i++) {
      if (f.interior && (i === 0 || i === cols)) continue;
      for (let j = 0; j < rows; j++) {
        const wall = !!this.v[i * rows + j];
        if (f.wall != null && wall !== !!f.wall) continue;
        if (f.unlocked && this.lockV[i * rows + j]) continue;
        out.push({ axis: 'v', i, j, x: i * this.cellW, z: (j + 0.5) * this.cellD, rot: Math.PI / 2, len: this.cellD, wall });
      }
    }
    for (let j = 0; j <= rows; j++) {
      if (f.interior && (j === 0 || j === rows)) continue;
      for (let i = 0; i < cols; i++) {
        const wall = !!this.h[j * cols + i];
        if (f.wall != null && wall !== !!f.wall) continue;
        if (f.unlocked && this.lockH[j * cols + i]) continue;
        out.push({ axis: 'h', i, j, x: (i + 0.5) * this.cellW, z: j * this.cellD, rot: 0, len: this.cellW, wall });
      }
    }
    return out;
  }
  pickEdge(rng, filter) {
    const list = this.edges(filter);
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  }

  // ---------- 修改 ----------
  // 清掉矩形 [i0, i0+w) × [j0, j0+d) 内部的墙（四周与区块边界不动），默认连带清掉里面的柱子
  carve(i0, j0, w, d, opts) {
    const o = opts || {};
    const cols = this.cols, rows = this.rows;
    i0 = Math.max(0, i0 | 0); j0 = Math.max(0, j0 | 0);
    const i1 = Math.min(cols, i0 + (w | 0)), j1 = Math.min(rows, j0 + (d | 0));
    for (let i = i0 + 1; i < i1; i++) for (let j = j0; j < j1; j++) { this.v[i * rows + j] = 0; this.lockV[i * rows + j] = 0; }
    for (let j = j0 + 1; j < j1; j++) for (let i = i0; i < i1; i++) { this.h[j * cols + i] = 0; this.lockH[j * cols + i] = 0; }
    if (o.room) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this.room[j * cols + i] = 1;
    if (!o.keepPillars) this.pillars = this.pillars.filter(p => !(p.i > i0 && p.i < i1 && p.j > j0 && p.j < j1));
    return this;
  }

  // 手动加/拆内部墙，并锁定（reconnect 不会再拆它）。区块边界线不许改：改了相邻块就对不上
  setWall(axis, i, j, on) {
    const cols = this.cols, rows = this.rows;
    if (axis === 'v') {
      if (!(i > 0 && i < cols && j >= 0 && j < rows)) { warnOnce('setWall-edge', 'grid.setWall 不能改区块边界线上的墙（i=0/cols），已忽略'); return false; }
      this.v[i * rows + j] = on ? 1 : 0; this.lockV[i * rows + j] = 1;
    } else {
      if (!(j > 0 && j < rows && i >= 0 && i < cols)) { warnOnce('setWall-edge', 'grid.setWall 不能改区块边界线上的墙（j=0/rows），已忽略'); return false; }
      this.h[j * cols + i] = on ? 1 : 0; this.lockH[j * cols + i] = 1;
    }
    if (on) {
      this.pillars = this.pillars.filter(p => this.vertexFree(p.i, p.j));
      this._dirty = true;
    }
    return true;
  }

  // 工坊专用：绕过 setWall 的边界保护（区块交界线上的边也允许改，两侧区块各自应用同一个 key）。
  // 只供 BR.workshop.applyGrid 调用；标记 _wsEdited 让 gridWalls 跳过自动 reconnect——创作者故意封路是合法的
  _wsSetWall(axis, i, j, on) {
    const cols = this.cols, rows = this.rows;
    if (axis === 'v') {
      if (!(i >= 0 && i <= cols && j >= 0 && j < rows)) return false;
      this.v[i * rows + j] = on ? 1 : 0; this.lockV[i * rows + j] = 1;
    } else {
      if (!(j >= 0 && j <= rows && i >= 0 && i < cols)) return false;
      this.h[j * cols + i] = on ? 1 : 0; this.lockH[j * cols + i] = 1;
    }
    if (on) this.pillars = this.pillars.filter(p => this.vertexFree(p.i, p.j));
    this._wsEdited = true;
    return true;
  }

  // 并查集：按随机顺序拆掉连接不同连通块的未锁定内部墙，直到整块格子互通。
  // 每条边界至少有开口 + 块内全连通 ⇒ 整个无限世界连通，玩家不会被关死
  reconnect(rng) {
    const cols = this.cols, rows = this.rows;
    const parent = new Int32Array(cols * rows);
    for (let k = 0; k < parent.length; k++) parent[k] = k;
    const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const union = (a, b) => { a = find(a); b = find(b); if (a === b) return false; parent[a] = b; return true; };
    const cand = [];
    for (let i = 1; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = j * cols + i - 1, b2 = j * cols + i;
        if (!this.v[i * rows + j]) union(a, b2);
        else if (!this.lockV[i * rows + j]) cand.push(0, i, j);
      }
    }
    for (let j = 1; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = (j - 1) * cols + i, b2 = j * cols + i;
        if (!this.h[j * cols + i]) union(a, b2);
        else if (!this.lockH[j * cols + i]) cand.push(1, i, j);
      }
    }
    const n = cand.length / 3;
    // 不传 rng 时用由层级种子+区块坐标派生的独立流：绝不能用 Math.random，联机两边的墙会不一样
    const r = typeof rng === 'function' ? rng : U.rng(this._rr[0], this._salt, 'kit-reconnect', this._rr[1], this._rr[2]);
    this._dirty = false;
    for (let k = n - 1; k > 0; k--) {
      const m = Math.floor(r() * (k + 1));
      for (let q = 0; q < 3; q++) { const t = cand[k * 3 + q]; cand[k * 3 + q] = cand[m * 3 + q]; cand[m * 3 + q] = t; }
    }
    for (let k = 0; k < n; k++) {
      const ax = cand[k * 3], i = cand[k * 3 + 1], j = cand[k * 3 + 2];
      if (ax === 0) { if (union(j * cols + i - 1, j * cols + i)) this.v[i * rows + j] = 0; }
      else if (union((j - 1) * cols + i, j * cols + i)) this.h[j * cols + i] = 0;
    }
    const root = find(0);
    for (let k = 1; k < parent.length; k++) {
      if (find(k) !== root) { warnOnce('reconnect', 'grid.reconnect：锁定的墙把一部分格子围死了，检查 setWall'); break; }
    }
    return this;
  }
}

function grid(b, cols, rows, opts) {
  if (!(b instanceof Builder)) throw new Error('[kit] BR.kit.grid 第一个参数要传 builder（跨区块无缝需要区块坐标和层级种子）');
  cols = Math.max(1, cols | 0 || 8);
  rows = Math.max(1, rows | 0 || cols);
  return new Grid(b, cols, rows, opts || {});
}

function eachRun(arr, off, n, fn) {
  let k = 0;
  while (k < n) {
    if (!arr[off + k]) { k++; continue; }
    let e = k + 1;
    while (e < n && arr[off + e]) e++;
    fn(k, e);
    k = e;
  }
}

// 墙体、踢脚线、柱子。连续墙段合并成一个盒子，端头各多出半个墙厚，L 形拐角不留缝；
// 边界线上只画朝向本块的半堵墙（邻块画另一半），两半贴合处的面互相挡住，看不见
function gridWalls(b, g, opts) {
  const o = opts || {};
  // 工坊钩子：不在工坊地图里（BR.workshop.active 为空）时什么都不做，现有层级行为不变
  if (BR.workshop && typeof BR.workshop.applyGrid === 'function') BR.workshop.applyGrid(b, g);
  // 层级用 setWall 加过墙（门洞旁补墙、围地标）：生成时的连通性可能被破坏，画墙前自动再打通一次（锁定的墙不拆）。
  // 工坊编辑过这块 grid 时整个跳过：创作者故意封路是合法的，编辑器负责在出生点被围死时警告
  if (g._dirty && !g._wsEdited) g.reconnect();
  const H = num(o.height, b.height);
  const T = num(o.thickness, 0.2 * 4 / 3), ht = T / 2;   // 用户要求墙在原 0.2m 基础上加厚 1/3
  const key = o.matKey || 'kit:prop';
  let trim = null;
  if (o.trim !== false) {
    trim = Object.assign({ h: 0.1, t: 0.015, color: 0x5a4a32, matKey: o.trimMatKey || 'kit:prop' },
      o.trim && typeof o.trim === 'object' ? o.trim : {});
  }
  // 矮墙（隔断）要顶面；顶天立地的墙省掉
  const top = o.top != null ? !!o.top : H < b.height - 0.01;
  const cols = g.cols, rows = g.rows, cw = g.cellW, cd = g.cellD, size = g.size;
  const color = o.color;
  // 墙段和柱子是结构面：用 kit:prop 时缺省不铺表面纹理（整面墙看得出 0.9 m 一格的云斑重复）；opts.grain: true 要回来。踢脚线照常（自动判断）
  const grain = o.grain != null ? o.grain : false;
  let walls = 0;
  // 每段墙朝外的立面（贴花、墙上挂件定位用）：{ x, y, z = 面中心（区块本地，就在墙面上）, facing, w = 沿墙长度, h = 高, axis, line, a, e }
  const wallFaces = [];

  const addTrim = (x0, z0, x1, z1) => {
    b.aabb(x0, 0, z0, x1, trim.h, z1, trim.matKey, { faces: 'noBottom', solid: false, color: trim.color });
  };

  for (let i = 0; i <= cols; i++) {
    const x = i * cw;
    let x0 = x - ht, x1 = x + ht, faces = ['px', 'nx', 'pz', 'nz'], sides = [-1, 1];
    if (i === 0) { x0 = 0; x1 = ht; faces = ['px', 'pz', 'nz']; sides = [1]; }
    else if (i === cols) { x0 = size - ht; x1 = size; faces = ['nx', 'pz', 'nz']; sides = [-1]; }
    if (top) faces = faces.concat('py');
    eachRun(g.v, i * rows, rows, (a, e) => {
      const z0 = a * cd - ht, z1 = e * cd + ht;
      b.aabb(x0, 0, z0, x1, H, z1, key, { faces, solid: true, color, grain });
      walls++;
      for (const sd of sides) wallFaces.push({ x: sd > 0 ? x1 : x0, y: H / 2, z: (z0 + z1) / 2, facing: sd > 0 ? '+x' : '-x', w: z1 - z0, h: H, axis: 'v', line: i, a, e });
      if (trim) for (const sd of sides) {
        if (sd > 0) addTrim(x1, z0, x1 + trim.t, z1); else addTrim(x0 - trim.t, z0, x0, z1);
      }
    });
  }
  for (let j = 0; j <= rows; j++) {
    const z = j * cd;
    let z0 = z - ht, z1 = z + ht, faces = ['px', 'nx', 'pz', 'nz'], sides = [-1, 1];
    if (j === 0) { z0 = 0; z1 = ht; faces = ['px', 'nx', 'pz']; sides = [1]; }
    else if (j === rows) { z0 = size - ht; z1 = size; faces = ['px', 'nx', 'nz']; sides = [-1]; }
    if (top) faces = faces.concat('py');
    eachRun(g.h, j * cols, cols, (a, e) => {
      const xa = a * cw - ht, xb = e * cw + ht;
      b.aabb(xa, 0, z0, xb, H, z1, key, { faces, solid: true, color, grain });
      walls++;
      for (const sd of sides) wallFaces.push({ x: (xa + xb) / 2, y: H / 2, z: sd > 0 ? z1 : z0, facing: sd > 0 ? '+z' : '-z', w: xb - xa, h: H, axis: 'h', line: j, a, e });
      if (trim) for (const sd of sides) {
        if (sd > 0) addTrim(xa, z1, xb, z1 + trim.t); else addTrim(xa, z0 - trim.t, xb, z0);
      }
    });
  }

  const ps = num(o.pillarSize, 0.5);
  const pkey = o.pillarMatKey || key;
  for (const p of g.pillars) {
    const px = p.i * cw, pz = p.j * cd;
    b.box(px, 0, pz, ps, H, ps, pkey, { faces: top ? 'noBottom' : 'sides', solid: true, color, grain });
    if (trim) b.box(px, 0, pz, ps + trim.t * 2, trim.h, ps + trim.t * 2, trim.matKey, { faces: 'noBottom', solid: false, color: trim.color });
  }
  return { walls, pillars: g.pillars.length, faces: wallFaces };
}

// 每个未保留格子的中心放一个刷新点（房间格 tag 'room'，其余 'floor'）；every = N 时隔格取点
function gridSpawns(b, g, opts) {
  const o = opts || {};
  const every = Math.max(1, o.every | 0 || 1);
  let n = 0;
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      if (g.isReserved(i, j)) continue;
      if (every > 1 && (i + j) % every) continue;
      const c = g.center(i, j);
      b.spawn(c.x, c.z, g.isRoom(i, j) ? (o.roomTag || 'room') : (o.tag || 'floor'), { safe: !!o.safe });
      n++;
    }
  }
  return n;
}

// =====================================================================
// 常用构件：BR.kit.prop.<name>(b, x, z, rot, opts)
// =====================================================================
// 约定：(x, z) 是构件在地面上的中心（当前坐标系），rot 绕 Y 旋转；rot = 0 时构件正面朝 +Z
// （站在 +Z 一侧、yaw = 0 面朝 −Z 的玩家看到的是正面）。零件全进 'kit:prop' / 'kit:glow' / 'kit:glass'，
// 一块区块里摆多少种构件都只多这几个 draw call；碰撞体按整体外形给一两个 AABB，不逐零件出
const PC = {
  frame: 0xd9d4c7, metal: 0x8f9499, steel: 0xb9bdc1, dark: 0x3c3f43, wood: 0x7a5536, woodDark: 0x5c3f28,
  cardboard: 0xb08a5a, tape: 0xcdb98e, laminate: 0xc9b99b, fabric: 0x4a505c, rail: 0x6a6e72,
};
const EXIT_GREEN = [0.25, 1.5, 0.55];

function part(b, x, y, z, w, h, d, color, o) {
  const key = (o && o.matKey) || 'kit:prop';
  return b.box(x, y, z, w, h, d, key, {
    color, solid: false, faces: (o && o.faces) || 'all', rotY: o && o.rotY,
    uv: (o && o.uv) || (key === 'kit:prop' ? 'stretch' : 'world'),
    bevel: o && o.bevel, bevelEdges: o && o.bevelEdges,
  });
}
function glowBox(b, x, y, z, w, h, d, color) {
  return b.box(x, y, z, w, h, d, 'kit:glow', { color, solid: false, uv: 'solid' });
}
function hash01(a, b2, c) { return U.hashInts(a, b2, c) / 4294967296; }
function posHash(b, k) { const p = b.point(0, 0); return hash01(Math.round((b.ox + p.x) * 100), Math.round((b.oz + p.z) * 100), k | 0); }

// ---------- 细节档（用户 2026-09-24：除了墙壁、人物和实体，所有道具都要做得更细） ----------
// 高画质：在原构件上加缝线、把手、合页、横撑、螺栓、脚轮之类能在画面上认出来的小零件；
// 低画质（设置里选"低"）保持原来的简版，一个三角形都不多。
// 两档只差可见几何：碰撞体（b.solid 的调用）、灯、刷新点、rng 消耗、占地尺寸完全一致，
// 所以联机两边画质不同也不影响同步（画质本来就按本机，不跟房主）。
// 细节零件只进这个构件原来就用的材质槽位（绝大多数是 'kit:prop' 顶点色）：不新增材质，
// 也不给原来没用 'kit:glow'/'kit:glass' 的构件加这两种 —— 否则一块区块会多出一个 mesh / draw call。
// 叠放的零件各自错开 ≥ 2 mm，不和底下的面共面（共面会 z-fighting 闪杂纹，玩具箱顶面踩过）
// 三种情况退回简版：① 低画质；② 调用时传了 opts.detail = false / 'low'（层级成片摆的小件想省面时用）；
// ③ 这一块已经累积到 DETAIL_TRI_CAP 个三角面 —— 每块预算高画质 10000 / 低画质 8000（2026-10-01 起），墙和层级自己的几何已经很满的块，
// 后面的构件、倒角、贴花不再加细节，免得把一块顶破预算。只看本块已建的几何（与建块顺序有关、与 rng 无关），同一画质下结果确定。
// 低画质整个细节档都关（倒角、贴花也关），所以这个上限只影响高画质
const DETAIL_TRI_CAP = 9000;
function hiDetail(b, o) {
  if (o && (o.detail === false || o.detail === 'low')) return false;
  const s = BR.game && BR.game.settings;
  if (s && s.quality === 'low') return false;
  if (b && b._accs) {
    let n = 0;
    b._accs.forEach(a => { if (a.idx) n += a.idx.length; });
    if (n / 3 >= DETAIL_TRI_CAP) return false;
  }
  return true;
}
// 贴面薄片（缝线、标签、面板线、按钮）：2 个三角形，不出碰撞体。
// facing 'up'/'down'：(x,y,z) 是面中心、w 沿 x、h 沿 z；'+z' '-z' '+x' '-x'：(x,z) 是底边中点、y 是底边高度、w 水平、h 竖直
function face(b, x, y, z, w, h, facing, color, key) {
  const k = key || 'kit:prop';
  return b.plane(x, y, z, w, h, k, { facing, color, solid: false, uv: k === 'kit:glow' ? 'solid' : k === 'kit:prop' ? 'stretch' : 'world' });
}
// 两点之间的方梁（斜撑、斜扶手、斜拉杆）：A、B 是当前坐标系下的 [x, y, z]；
// 截面 w 沿侧向 s（= 梁向 × 竖直，梁接近竖直时取本地 x）、t 沿 s × 梁向。o.ends === false 省掉两个端面（两头插进别的零件里时）
function beam(b, A, B, w, t, color, o) {
  const oo = o || {};
  let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz);
  if (!(L > 1e-6)) return null;
  dx /= L; dy /= L; dz /= L;
  let sx = -dz, sz = dx;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-4) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  const ux = -sz * dy, uy = sz * dx - sx * dz, uz = sx * dy;     // u = s × d（s.y = 0）
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, mz = (A[2] + B[2]) / 2;
  const hw = w / 2, ht = t / 2, hl = L / 2;
  const D = [dx, dy, dz], S = [sx, 0, sz], Uv = [ux, uy, uz];
  const neg = a => [-a[0], -a[1], -a[2]];
  // 每个面：[法线 n, 面内"上"方向 q, 沿 r = q × n 的半宽, 沿 q 的半长, 面中心离梁轴的距离]
  const faces = [[S, D, ht, hl, hw], [neg(S), D, ht, hl, hw], [Uv, D, hw, hl, ht], [neg(Uv), D, hw, hl, ht]];
  if (oo.ends !== false) faces.push([neg(D), Uv, hw, ht, hl], [D, Uv, hw, ht, hl]);
  return b._piece(oo.matKey || 'kit:prop', 0, 0, 0, 0, (v, t) => {
    let k = 0;
    for (const f of faces) {
      const n = f[0], q = f[1], a = f[2], c = f[3];
      const rx = q[1] * n[2] - q[2] * n[1], ry = q[2] * n[0] - q[0] * n[2], rz = q[0] * n[1] - q[1] * n[0];
      const cx = mx + n[0] * f[4], cy = my + n[1] * f[4], cz = mz + n[2] * f[4];
      v(cx - rx * a - q[0] * c, cy - ry * a - q[1] * c, cz - rz * a - q[2] * c, n[0], n[1], n[2], 0, 0);
      v(cx + rx * a - q[0] * c, cy + ry * a - q[1] * c, cz + rz * a - q[2] * c, n[0], n[1], n[2], 1, 0);
      v(cx + rx * a + q[0] * c, cy + ry * a + q[1] * c, cz + rz * a + q[2] * c, n[0], n[1], n[2], 1, 1);
      v(cx - rx * a + q[0] * c, cy - ry * a + q[1] * c, cz - rz * a + q[2] * c, n[0], n[1], n[2], 0, 1);
      t(k, k + 1, k + 2); t(k, k + 2, k + 3);
      k += 4;
    }
  }, { color, uv: 'stretch', solid: false });
}
// 本地坐标系下的 3D 点 → 顶点列表里的扁平三角形（碎石、尖顶这类不规则小件）：tris = [[p0,p1,p2], ...]，法线按每个三角形算
function tris3(b, list, color, key) {
  return b._piece(key || 'kit:prop', 0, 0, 0, 0, (v, t) => {
    let k = 0;
    for (const tr of list) {
      const a = tr[0], p1 = tr[1], p2 = tr[2];
      const ex = p1[0] - a[0], ey = p1[1] - a[1], ez = p1[2] - a[2], fx = p2[0] - a[0], fy = p2[1] - a[1], fz = p2[2] - a[2];
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      v(a[0], a[1], a[2], nx, ny, nz, 0, 0); v(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0); v(p2[0], p2[1], p2[2], nx, ny, nz, 0, 1);
      t(k, k + 1, k + 2);
      k += 3;
    }
  }, { color, uv: key === 'kit:glow' ? 'solid' : 'stretch', solid: false });
}
// 颜色乘系数（细节件用底色深一点/浅一点，跟着层级传进来的颜色走）
function shade(c, m) { return rgb(c, m); }
// 挂在某件上的零件跟着它一起显隐：层级会把门扇、地上的坑、水坑藏起来再放出来（事件门、塌陷坑、时有时无的水坑），
// 把手、合页、坑边碎石这些不能留在原地飘着。只改这一件实例的 setVisible，Piece 类本身不动
function linkVisible(primary, extras) {
  const list = (extras || []).filter(p => p && p !== primary);
  if (!primary || !list.length) return primary;
  const base = primary.setVisible;
  primary.setVisible = function (on) {
    base.call(this, on);
    for (let i = 0; i < list.length; i++) list[i].setVisible(on);
    return this;
  };
  return primary;
}

// ---------- 倒角与磨损（用户 2026-10-01："一些方块的角不能太尖锐""材质也得跟随着细化"） ----------
// 构件里玩家走近能看到的大件（桌面、柜体、箱子、床、门框门扇、灯具外壳、柱子）在细节档里切角（5.4 节），
// 小零件、细杆、贴面薄片不倒。hi 为 false（低画质、detail: false、本块到 DETAIL_TRI_CAP）时一个字段都不加，
// 零件和以前一模一样；box 自己在到了上限时也会退回普通盒。碰撞体不受影响（构件的碰撞体本来就是另给的 b.solid）。
// bv(hi, r, edges, o)：给 part 的 opts 补上 bevel / bevelEdges
function bv(hi, r, edges, o) {
  const out = Object.assign({}, o);
  if (hi && r > 0) { out.bevel = r; out.bevelEdges = edges || 'all'; }
  return out;
}
// 痕迹颜色（都是 'kit:prop' 那套不解码的原始顶点色，和零件颜色同一套）：
// tone(c, k)：零件颜色在屏幕上暗到 k 倍（原始值乘 k^2.2 —— 直接乘 k 在屏幕上只暗一点点）；
// mix(c, t, k)：往目标色插值（k = 0 原色 .. 1 目标色），刮掉漆露出来的浅色
function tone(c, k) { return rgb(c, Math.pow(k, 2.2)); }
// 磨损用的位置哈希 0..1：posHash 对相邻的 k 几乎给同一个数（FNV 末轮只乘一次，k 差 1 结果只差 1/256），
// 这里再过一遍 mulberry32 打散，几个"要不要贴、贴哪面、偏多少"才互不相关。只看构件原点的世界位置，不吃 rng
function wh(b, k) {
  const p = b.point(0, 0);
  return U.mulberry32(U.hashInts(Math.round((b.ox + p.x) * 100), Math.round((b.oz + p.z) * 100), k | 0, 'kit-wear'))();
}
function mix(c, t, k) {
  const a = rgb(c), d = rgb(t);
  return [a[0] + (d[0] - a[0]) * k, a[1] + (d[1] - a[1]) * k, a[2] + (d[2] - a[2]) * k];
}
// 磨损贴花（擦痕、刮痕、杯印、水渍圈……，软边，5.5 节）：先记账，等这块 finish 时再贴 ——
//   ① 贴花排在一块的最后：三角面到了 DETAIL_TRI_CAP，先截掉的是它，层级自己的几何和构件本体不受影响；
//   ② 不把这块顶破"每块 ≤ 8 个 mesh"：这块已经有贴花 mesh（层级自己贴过）就并进去，一个 mesh / draw call 都不多；
//      没有的话，只在其余 mesh（含独立物体）≤ WEAR_MESH_ROOM 个时才新开一个（再留一个给 finish 里工坊才加进来的东西）。
// 只在高画质画（低画质 kit.decal 本来就返回 null，这里连账都不记）；不消耗任何 rng，变体、位置都按 posHash。
// 颜色缺省 srgb: false（和 'kit:prop' 顶点色同一套）：痕迹取所在零件颜色的深一号/浅一号（tone / mix），两者对得上；
// 和零件无关的固定颜色（鞋底蹭的黑印）写屏幕色 hex 并传 srgb: true。
// follow：贴在层级会藏起来/放出来的件上（门扇、水坑）时，跟着它一起显隐
const WEAR_MESH_ROOM = 6;
function wear(b, hi, o, follow) {
  if (!hi || !o) return;
  let q = b._kitWear;
  if (!q) {
    q = b._kitWear = [];
    const fin = b.finish;
    b.finish = function () { flushWear(this); return fin.apply(this, arguments); };   // 只包这一个 builder 实例，Builder 本身不动
  }
  q.push({ T: b._T, o: Object.assign({ srgb: false }, o), follow: follow || null });
}
function flushWear(b) {
  const q = b._kitWear;
  b._kitWear = null;
  if (!q || !q.length) return;
  let n = b._objects.length, has = false;
  b._accs.forEach((a, k) => { if (a.n && a.idx && a.idx.length) { n++; if (k === 'kit:decal') has = true; } });
  if (!has && n > WEAR_MESH_ROOM) return;
  const T0 = b._T;
  for (let i = 0; i < q.length; i++) {
    b._T = q[i].T;                      // 记账时的坐标系（构件 push 进去的那一层）
    const p = decal(b, q[i].o);
    const f = q[i].follow;
    if (p && f) {
      linkVisible(f, [p]);
      if (!f.visible) p.setVisible(false);
    }
  }
  b._T = T0;
}

// 墙上开洞：总宽 w、总高 h、厚 t 的墙，中间留出 x∈[−ow/2, ow/2]、y∈[oy0, oy1] 的洞（门、电梯、窗户嵌进格子开口用）
function wallWithOpening(b, x, z, rot, o) {
  const tw = num(o.w, 3), th = num(o.h, b.height), t = num(o.t, 0.2);
  const ow = Math.min(tw, num(o.openW, 1)), oy0 = num(o.openY0, 0), oy1 = Math.min(th, num(o.openY1, 2.1));
  const key = o.matKey || 'kit:prop', color = o.color;
  b.push(x, z, rot);
  if (tw - ow > 0.001) {
    b.aabb(-tw / 2, 0, -t / 2, -ow / 2, th, t / 2, key, { faces: 'sides', solid: true, color });
    b.aabb(ow / 2, 0, -t / 2, tw / 2, th, t / 2, key, { faces: 'sides', solid: true, color });
  }
  if (oy0 > 0.001) b.aabb(-ow / 2, 0, -t / 2, ow / 2, oy0, t / 2, key, { faces: 'noBottom', solid: true, color });
  if (th - oy1 > 0.001) b.aabb(-ow / 2, oy1, -t / 2, ow / 2, th, t / 2, key, { faces: 'noTop', solid: true, color });
  b.pop();
}

// 日光灯格栅面板：state 'on' | 'flicker' | 'broken'（灰面板不发光）| 'off'（暗面板，灯光描述 intensity 0，之后可点亮）
function lightPanel(b, x, z, rot, opts) {
  const o = opts || {};
  const y = num(o.y, b.height), w = num(o.w, 1.2), d = num(o.d, 0.6);
  const state = o.state || 'on';
  const gl = num(o.glow, 1.8);
  const lit = state === 'on' || state === 'flicker';
  const base = rgb(o.panelColor != null ? o.panelColor : 0xffffff, gl);
  const off = 0.06;
  b.push(x, z, rot);
  const initial = state === 'broken' ? 0.28 / gl : lit ? 1 : off;
  const piece = b.plane(0, y - 0.02, 0, w, d, 'kit:glow', {
    facing: 'down', uv: 'stretch', uvRepeat: [Math.max(1, Math.round(w / d)), 1], color: base, glow: initial,
  });
  if (o.frame !== false) {
    const fc = o.frameColor != null ? o.frameColor : PC.frame, ft = 0.035;
    part(b, 0, y - 0.03, -d / 2 - ft / 2, w + ft * 2, 0.03, ft, fc);
    part(b, 0, y - 0.03, d / 2 + ft / 2, w + ft * 2, 0.03, ft, fc);
    part(b, -w / 2 - ft / 2, y - 0.03, 0, ft, 0.03, d, fc);
    part(b, w / 2 + ft / 2, y - 0.03, 0, ft, 0.03, d, fc);
    if (hiDetail(b, o)) {
      // ① 吊顶压边：灯框外一圈更宽更薄的扣边贴着天花板（看得出灯盘是嵌进吊顶里的）。顶面贴天花板看不见，只画底面和朝外的侧面
      const fl = 0.025, fh = 0.008, fd = shade(fc, 0.86), X = w / 2 + ft + fl / 2, Z = d / 2 + ft + fl / 2;
      part(b, 0, y - fh, -Z, w + (ft + fl) * 2, fh, fl, fd, { faces: ['ny', 'nz'] });
      part(b, 0, y - fh, Z, w + (ft + fl) * 2, fh, fl, fd, { faces: ['ny', 'pz'] });
      part(b, -X, y - fh, 0, fl, fh, d + ft * 2, fd, { faces: ['ny', 'nx'] });
      part(b, X, y - fh, 0, fl, fh, d + ft * 2, fd, { faces: ['ny', 'px'] });
      // ② 中间纵向龙骨、③ 横档：压在贴图格栅的分界线上（uvRepeat 让面板中线正好是贴图接缝），两根底面错开 2 mm，端头插进灯框不画
      part(b, 0, y - 0.032, 0, w, 0.011, 0.02, fc, { faces: ['ny', 'pz', 'nz'] });
      part(b, 0, y - 0.03, 0, 0.02, 0.009, d, fc, { faces: ['ny', 'px', 'nx'] });
    }
  }
  let src = null;
  if (state !== 'broken' && o.light !== false) {
    src = b.light({
      x: 0, z: 0, y: y - 0.35,
      color: o.color != null ? o.color : 0xfff1d0,
      intensity: lit ? num(o.intensity, 1.1) : 0,
      range: num(o.range, 9),
      flicker: state === 'flicker' ? num(o.flicker, 0.6) : num(o.flickerLater, 0),
    });
    if (!lit) src.onIntensity = num(o.intensity, 1.1);   // 层级点亮时可用：src.intensity = src.onIntensity
    b.linkGlow(piece, src, base, off);
  }
  b.pop();
  return { piece, src };
}

function surface(b, x, z, rot, o, facing, defY) {
  const w = num(o.w, b.size), d = num(o.d, b.size);
  b.push(x == null ? w / 2 : x, z == null ? d / 2 : z, rot);
  // 用 kit:prop 铺的整片地板/吊顶是结构面：缺省不铺表面纹理（验收 2026-10-02：L18 吊顶一格格云斑）；opts.grain: true 要回来
  const piece = b.plane(0, num(o.y, defY), 0, w, d, o.matKey || 'kit:prop', { facing, uv: o.uv || 'world', color: o.color, solid: false, grain: o.grain != null ? o.grain : false });
  b.pop();
  return piece;
}
// 吊顶/地板：x、z 传 null 时铺满整块（w、d 缺省 = 区块边长）
function ceiling(b, x, z, rot, opts) { return surface(b, x, z, rot, opts || {}, 'down', b.height); }
function floor(b, x, z, rot, opts) { return surface(b, x, z, rot, opts || {}, 'up', 0); }

// 踢脚线：沿本地 x 方向长 length，背面贴 z = 0，向 +Z 凸出 t
function baseboard(b, x, z, rot, opts) {
  const o = opts || {};
  const L = num(o.length, 1), h = num(o.h, 0.1), t = num(o.t, 0.015);
  b.push(x, z, rot);
  const bc = o.color != null ? o.color : 0x5a4a32;
  const p = part(b, 0, 0, t / 2, L, h, t, bc, { matKey: o.matKey, faces: 'noBottom' });
  if (hiDetail(b, o)) {
    // ① 上沿压线：比板身高 2 mm、凸出 3 mm 的一道窄条；② 底部护脚条：贴地凸出 4 mm；③ 两条之间板面上一道浅凹线。
    // 都用同一个材质槽位（层级给的木纹贴图或顶点色），深浅靠顶点色（贴图材质不开顶点色时靠侧面受光区分）
    // 两条压线两头各比板身长 2 mm：端面不和板身端面共面（首尾相接的几段踢脚线，压线在接缝处重叠 4 mm、同色不闪）
    part(b, 0, h - 0.012, (t + 0.003) / 2, L + 0.004, 0.014, t + 0.003, shade(bc, 0.82), { matKey: o.matKey, faces: ['py', 'pz', 'px', 'nx'] });
    part(b, 0, 0, t + 0.002, L + 0.004, 0.018, 0.004, shade(bc, 0.7), { matKey: o.matKey, faces: ['py', 'pz', 'px', 'nx'] });
    if (h > 0.06) face(b, 0, h * 0.55, t + 0.002, L, 0.004, '+z', shade(bc, 0.6), o.matKey);
  }
  b.pop();
  return p;
}

// 门：style 'wood' | 'metal' | 'fire'；门扇绕左侧合页转 open（0 关 .. 1 开 90°，向 −Z 推开）
// opts: { w, h, open, color, frameColor, sign（true 或颜色：门上的绿色出口灯箱）, wall: { matKey, w, h, t }, solid }
function door(b, x, z, rot, opts) {
  const o = opts || {};
  const style = o.style || 'wood';
  const W = num(o.w, style === 'fire' ? 1.0 : 0.9), H = num(o.h, 2.05), open = U.clamp(num(o.open, 0), 0, 1);
  const leafC = o.color != null ? o.color : style === 'metal' ? 0x8c9197 : style === 'fire' ? 0x9e2f26 : PC.wood;
  const frameC = o.frameColor != null ? o.frameColor : style === 'wood' ? PC.woodDark : 0x6e7378;
  const jw = 0.08, jd = 0.16, lt = 0.045;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  // 门框两根立框倒 4 条竖棱（1.2 cm），上框不倒（在头顶上，倒了也看不出来，省面）
  part(b, -W / 2 - jw / 2, 0, 0, jw, H + jw, jd, frameC, bv(hi, 0.012, 'vertical', { faces: 'noBottom' }));
  part(b, W / 2 + jw / 2, 0, 0, jw, H + jw, jd, frameC, bv(hi, 0.012, 'vertical', { faces: 'noBottom' }));
  part(b, 0, H, 0, W, jw, jd, frameC);
  if (o.solid !== false) {
    b.solid(-W / 2 - jw, 0, -jd / 2, -W / 2, H, jd / 2);
    b.solid(W / 2, 0, -jd / 2, W / 2 + jw, H, jd / 2);
  }
  if (hi) {
    // 门框线：门框正反两面各一道倒 U 形深色细线（离框面 2 mm）
    const lc = shade(frameC, 0.62);
    for (const sz of [1, -1]) {
      const zf = sz * (jd / 2 + 0.002), fcg = sz > 0 ? '+z' : '-z';
      face(b, -W / 2 - jw / 2, 0, zf, 0.012, H + jw / 2 + 0.006, fcg, lc);
      face(b, W / 2 + jw / 2, 0, zf, 0.012, H + jw / 2 + 0.006, fcg, lc);
      face(b, 0, H + jw / 2 - 0.006, zf, W + jw - 0.012, 0.012, fcg, lc);
    }
    // 门槛：两框之间一条压条（门扇底 12 mm 藏进门槛里）
    part(b, 0, 0, 0, W + 0.01, 0.012, jd - 0.02, style === 'wood' ? shade(frameC, 0.8) : 0x8a8d90, { faces: ['py', 'pz', 'nz'] });
  }
  b.push(-W / 2, 0, open * Math.PI / 2);
  const pa = b._acc('kit:prop'), n0 = pa.pieces.length;   // 门扇坐标系里摆的所有零件都跟门扇一起显隐（见 linkVisible）
  const leaf = part(b, W / 2, 0, 0, W - 0.01, H - 0.01, lt, leafC, bv(hi, 0.01, 'vertical'));   // 门扇两条竖边倒 1 cm（合页包着的那条也倒，合页比它宽）
  const knob = style === 'wood' ? 0xc9b27a : 0xc2c5c8;
  if (!hi) {
    for (const sz of [1, -1]) part(b, W - 0.1, 0.98, sz * (lt / 2 + 0.02), 0.13, 0.03, 0.04, knob);
  } else if (style !== 'fire') {
    // 执手：两面各一块竖长的门锁面板 + 压把（脖子 + 朝合页一侧伸出的把手）+ 面板下方的锁孔（防火门用推杠，不装）
    const hx = W - 0.085;
    for (const sz of [1, -1]) {
      const zf = sz * lt / 2, fz = sz > 0 ? 'nz' : 'pz';
      part(b, hx, 0.86, zf + sz * 0.004, 0.05, 0.2, 0.008, knob, { faces: ['pz', 'nz', 'py', 'ny', 'px', 'nx'].filter(f => f !== fz) });
      part(b, hx, 0.975, zf + sz * 0.024, 0.024, 0.024, 0.034, knob, { faces: ['py', 'ny', 'px', 'nx', sz > 0 ? 'pz' : 'nz'] });
      part(b, hx - 0.05, 0.977, zf + sz * 0.043, 0.13, 0.02, 0.02, knob);
      face(b, hx, 0.895, zf + sz * 0.0105, 0.012, 0.022, sz > 0 ? '+z' : '-z', 0x1c1c1c);
    }
  }
  if (hi) {
    // 合页：门扇合页边上三片，包住门扇边缘、两面各露 5 mm
    const hc = style === 'wood' ? 0xb59a5a : 0x9a9ea3;
    for (const hy of [0.2, H / 2 - 0.05, H - 0.32]) part(b, 0.006, hy, 0, 0.024, 0.11, lt + 0.01, hc, { faces: ['pz', 'nz', 'py', 'ny'] });
  }
  if (style === 'wood') {
    const dk = 0x654329;
    for (const sz of [1, -1]) {
      part(b, W / 2, 0.22, sz * (lt / 2 + 0.004), W - 0.26, 0.72, 0.008, dk);
      part(b, W / 2, 1.14, sz * (lt / 2 + 0.004), W - 0.26, 0.72, 0.008, dk);
      if (hi) {
        // 凸起的门芯板：两块门板中间再浅一层（离门板面 2.5 mm），一深一浅看出斜面层次
        const zf = sz * (lt / 2 + 0.0105), fcg = sz > 0 ? '+z' : '-z', lc2 = shade(leafC, 0.93);
        face(b, W / 2, 0.29, zf, W - 0.4, 0.58, fcg, lc2);
        face(b, W / 2, 1.21, zf, W - 0.4, 0.58, fcg, lc2);
      }
    }
  } else if (style === 'metal') {
    for (const sz of [1, -1]) part(b, W / 2, 0.02, sz * (lt / 2 + 0.004), W - 0.06, 0.25, 0.008, 0x6d7278);
    if (hi) {
      // 压筋：门扇两面各两道横向浅线；闭门器：推开一侧（−Z）顶上的方盒 + 连杆
      for (const sz of [1, -1]) for (const yy of [0.72, 1.52]) face(b, W / 2, yy, sz * (lt / 2 + 0.002), W - 0.12, 0.01, sz > 0 ? '+z' : '-z', shade(leafC, 0.8));
      part(b, W - 0.3, H - 0.2, -lt / 2 - 0.03, 0.3, 0.07, 0.06, 0x4a4d52);
      part(b, W - 0.52, H - 0.14, -lt / 2 - 0.035, 0.22, 0.018, 0.018, 0x5c6066);
    }
  } else {
    for (const sz of [1, -1]) {
      part(b, W / 2, 1.3, sz * (lt / 2 + 0.004), 0.22, 0.5, 0.008, 0x273034);          // 夹丝玻璃小窗
      part(b, W / 2, 0.98, sz * (lt / 2 + 0.05), W - 0.2, 0.05, 0.05, 0xb8bcc0);         // 推杠
      if (hi) {
        const zf = sz * (lt / 2 + 0.0105), fcg = sz > 0 ? '+z' : '-z', bc = 0xb9bdc1;
        // 小窗压条（窗四周一圈亮色边）+ 夹丝（一竖两横）
        face(b, W / 2, 1.28, zf, 0.26, 0.02, fcg, bc);
        face(b, W / 2, 1.8, zf, 0.26, 0.02, fcg, bc);
        face(b, W / 2 - 0.12, 1.3, zf, 0.02, 0.5, fcg, bc);
        face(b, W / 2 + 0.12, 1.3, zf, 0.02, 0.5, fcg, bc);
        face(b, W / 2, 1.3, zf, 0.004, 0.5, fcg, 0x8a9296);
        for (const wy of [1.46, 1.63]) face(b, W / 2, wy, zf, 0.22, 0.004, fcg, 0x8a9296);
        // 推杠两端的支座
        for (const ex of [0.12, W - 0.12]) part(b, ex, 0.955, sz * (lt / 2 + 0.03), 0.05, 0.1, 0.06, 0x7d8286, { faces: ['py', 'ny', 'px', 'nx', sz > 0 ? 'pz' : 'nz'] });
      }
    }
    if (hi) part(b, W - 0.3, H - 0.2, -lt / 2 - 0.03, 0.3, 0.07, 0.06, 0x4a4d52);   // 闭门器
  }
  if (hi) {
    // 磨损（软边贴花，跟着门扇显隐）：两面门脚的黑色踢痕（金属门踢在踢脚板上）；锁下面几道钥匙划出来的浅色细痕（防火门是推杠，没有锁）
    const kz = style === 'metal' ? lt / 2 + 0.008 : lt / 2;
    for (const sz of [1, -1]) {
      const k = sz > 0 ? 0 : 1;
      if (wh(b, 70 + k) < 0.25) continue;
      wear(b, hi, {
        kind: 'scuff', x: W * (0.3 + 0.4 * wh(b, 72 + k)), y: 0.1 + 0.07 * wh(b, 74 + k), z: sz * kz, facing: sz > 0 ? '+z' : '-z',
        w: 0.26 + 0.16 * wh(b, 76 + k), rot: (wh(b, 78 + k) - 0.5) * 0.5, color: 0x1e1c1a, srgb: true, opacity: 0.4 + 0.2 * wh(b, 80 + k),
      }, leaf);
    }
    if (style !== 'fire' && wh(b, 82) < 0.7) {
      const sc = style === 'wood' ? mix(leafC, 0xf0e6d0, 0.45) : mix(leafC, 0xe8eaec, 0.6), hx = W - 0.085;
      wear(b, hi, { kind: 'hairline', x: hx - 0.012, y: 0.835, z: lt / 2, facing: '+z', w: 0.08, h: 0.009, rot: 0.5 + 0.5 * wh(b, 84), color: sc, opacity: 0.6 }, leaf);
      wear(b, hi, { kind: 'scratch', x: hx + 0.006, y: 0.82, z: lt / 2, facing: '+z', w: 0.065, h: 0.01, rot: -0.4 - 0.6 * wh(b, 85), color: sc, opacity: 0.5 }, leaf);
    }
  }
  b.pop();
  linkVisible(leaf, pa.pieces.slice(n0));
  if (open < 0.35 && o.solid !== false) b.solid(-W / 2, 0, -0.05, W / 2, H, 0.05);
  if (o.sign) {
    glowBox(b, 0, H + jw + 0.1, jd / 2 + 0.02, 0.36, 0.14, 0.04, o.sign === true ? EXIT_GREEN : rgb(o.sign));
    // 灯箱外壳：比发光面大一圈、往后多 2 mm（背面不和发光盒共面），正面比发光面退后 4 mm（发光面凸出来、四周一圈白边）
    if (hi) part(b, 0, H + jw + 0.08, jd / 2 + 0.017, 0.4, 0.18, 0.038, 0xe4e4dc);
  }
  if (o.wall) wallWithOpening(b, 0, 0, 0, Object.assign({ openW: W + jw * 2, openY0: 0, openY1: H + jw }, o.wall));
  b.pop();
  return { leaf };
}

// 楼梯间入口：down（默认）= 地上一个黑洞 + 三面栏杆 + 隐约的台阶边；down: false = 往 −Z 升起的台阶通进黑暗门洞
function stairwell(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.3), D = num(o.depth, 2.6), down = o.down !== false;
  const rc = o.railColor != null ? o.railColor : PC.rail;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  if (down) {
    b.plane(0, 0.004, -D / 2, W, D, 'kit:glow', { facing: 'up', uv: 'solid', color: 0 });
    const n = 7;
    for (let k = 1; k <= n; k++) {
      const s = k / (n + 1), sh = 0.14 * (1 - s);
      b.plane(0, 0.006, -D * s * 0.92, W - 0.12, 0.05, 'kit:glow', { facing: 'up', uv: 'solid', color: [sh, sh * 0.95, sh * 0.85] });
    }
    const rh = 1.0;
    for (const sx of [-1, 1]) {
      part(b, sx * (W / 2 + 0.03), rh, -D / 2, 0.05, 0.05, D + 0.06, rc);
      part(b, sx * (W / 2 + 0.03), 0.5, -D / 2, 0.03, 0.03, D, rc);
      for (const pz of [0, -D / 2, -D]) part(b, sx * (W / 2 + 0.03), 0, pz, 0.05, rh, 0.05, rc, { faces: 'noBottom' });
      b.solid(sx > 0 ? W / 2 : -W / 2 - 0.06, 0, -D - 0.03, sx > 0 ? W / 2 + 0.06 : -W / 2, rh, 0.03);
    }
    part(b, 0, rh, -D - 0.03, W + 0.1, 0.05, 0.05, rc);
    part(b, 0, 0.5, -D - 0.03, W, 0.03, 0.03, rc);
    b.solid(-W / 2 - 0.06, 0, -D - 0.06, W / 2 + 0.06, rh, -D);
    if (hi) {
      // ① 洞口一圈 2 cm 高的护沿：入口那条是深色防滑踏口，另外三面是水泥色（各段首尾相接不重叠，顶面不共面）
      const lip = shade(rc, 0.78), z0 = -0.05, z1 = -D + 0.04;
      part(b, 0, 0, -0.025, W, 0.02, 0.05, 0x3e3c38, { faces: ['py', 'pz', 'nz'] });
      for (const sx of [-1, 1]) part(b, sx * (W / 2 - 0.022), 0, (z0 + z1) / 2, 0.044, 0.02, z0 - z1, lip, { faces: ['py', sx > 0 ? 'nx' : 'px'] });
      part(b, 0, 0, -D + 0.02, W - 0.088, 0.02, 0.04, lip, { faces: ['py', 'pz'] });
      // ② 三面栏杆底部 10 cm 高的踢脚挡板（在原碰撞体范围内）
      for (const sx of [-1, 1]) part(b, sx * (W / 2 + 0.03), 0, -D / 2, 0.016, 0.1, D - 0.04, rc, { faces: ['py', 'px', 'nx'] });
      part(b, 0, 0, -D - 0.03, W + 0.02, 0.1, 0.016, rc, { faces: ['py', 'pz', 'nz'] });
      // ③ 四根角柱的底座法兰
      for (const sx of [-1, 1]) for (const pz of [0, -D]) part(b, sx * (W / 2 + 0.03), 0, pz, 0.1, 0.012, 0.1, shade(rc, 0.85), { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
    }
  } else {
    const n = Math.max(3, num(o.steps, 6) | 0), rise = 0.18, run = 0.3;
    const sc = o.stepColor != null ? o.stepColor : 0x8a8680;
    const H = num(o.h, b.height);
    for (let k = 0; k < n; k++) part(b, 0, 0, -(k + 0.5) * run, W, (k + 1) * rise, run, sc, { faces: 'noBottom' });
    b.plane(0, 0, -n * run, W, H, 'kit:glow', { facing: '+z', uv: 'solid', color: 0 });
    const wc = o.wallColor != null ? o.wallColor : 0x9c968a;
    // 两侧墙：高画质四条竖棱倒 1.2 cm（走到楼梯口迎面就是这两道墙头）
    for (const sx of [-1, 1]) part(b, sx * (W / 2 + 0.05), 0, -n * run / 2, 0.1, H, n * run, wc, bv(hi, 0.012, 'vertical', { faces: 'noBottom', matKey: o.matKey }));
    b.solid(-W / 2 - 0.1, 0, -n * run, W / 2 + 0.1, 0.5, -run * 0.8);
    b.solid(-W / 2 - 0.1, 0, -n * run, -W / 2, H, 0);
    b.solid(W / 2, 0, -n * run, W / 2 + 0.1, H, 0);
    if (hi) {
      // ① 每级踏口一条深色防滑条（高出踏面 3 mm、凸出立面 4 mm）
      const nc = shade(sc, 0.6), kc = shade(wc, 0.72), hc = 0x6a6e72;
      for (let k = 0; k < n; k++) part(b, 0, (k + 1) * rise - 0.022, -k * run - 0.013, W - 0.004, 0.025, 0.034, nc, { faces: ['py', 'pz'] });
      // 踏口连线：z = 0 处高 rise，每往 −Z 走 run 升 rise
      const nose = zz => rise * (1 - zz / run);
      for (const sx of [-1, 1]) {
        // ② 两侧墙根顺着台阶斜下来的踢脚板（贴墙那面朝墙里，看不见，不和墙面共面）
        const xk = sx * (W / 2 - 0.006);
        beam(b, [xk, nose(0) + 0.02, 0], [xk, nose(-n * run) + 0.02, -n * run], 0.012, 0.13, kc, { ends: false });
        // ③ 两侧墙上的斜扶手（踏口线上 0.9 m）+ 两个墙托
        const xr = sx * (W / 2 - 0.06), za = -0.1, zb = -(n - 0.6) * run;
        beam(b, [xr, nose(za) + 0.9, za], [xr, nose(zb) + 0.9, zb], 0.04, 0.04, hc);
        for (const f of [0.2, 0.8]) {
          const bz = za + f * (zb - za), ry = nose(bz) + 0.9;
          part(b, sx * (W / 2 - 0.03), ry - 0.09, bz, 0.06, 0.075, 0.02, hc, { faces: ['py', 'pz', 'nz', sx > 0 ? 'nx' : 'px'] });
        }
      }
    }
  }
  if (o.sign) {
    const sy = down ? 2.3 : num(o.h, b.height) - 0.3;
    glowBox(b, 0, sy, 0.02, 0.4, 0.15, 0.03, o.sign === true ? EXIT_GREEN : rgb(o.sign));
    if (hi) part(b, 0, sy - 0.02, 0.018, 0.44, 0.19, 0.03, 0xe4e4dc);   // 灯箱外壳：正面比发光面退后 2 mm、背面往后 2 mm
  }
  b.pop();
  return {};
}

// 电梯门：金属门框 + 两扇滑门（open 0..1 向两侧滑开，露出黑色轿厢）+ 楼层指示灯 + 呼叫按钮
function elevator(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.1), H = num(o.h, 2.1), open = U.clamp(num(o.open, 0), 0, 1);
  const fc = o.frameColor != null ? o.frameColor : 0x8e9398, dc = o.doorColor != null ? o.doorColor : PC.steel;
  const jw = 0.15, jd = 0.22, hd = 0.35;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  // 高画质：门套两根立柱倒竖棱（1.6 cm），两扇滑门的竖边倒 5 mm（合拢时中间是一道 V 形缝）
  part(b, -W / 2 - jw / 2, 0, 0, jw, H + hd, jd, fc, bv(hi, 0.016, 'vertical', { faces: 'noBottom' }));
  part(b, W / 2 + jw / 2, 0, 0, jw, H + hd, jd, fc, bv(hi, 0.016, 'vertical', { faces: 'noBottom' }));
  part(b, 0, H, 0, W, hd, jd, fc);
  glowBox(b, 0, H + 0.12, jd / 2 + 0.006, 0.34, 0.1, 0.012, o.indicator != null ? rgb(o.indicator) : [1.5, 0.75, 0.2]);
  const pw = W / 2, shift = open * (pw - 0.04);
  const left = part(b, -pw / 2 - shift, 0, 0.02, pw, H, 0.04, dc, bv(hi, 0.005, 'vertical', { faces: 'noBottom' }));
  const right = part(b, pw / 2 + shift, 0, 0.02, pw, H, 0.04, dc, bv(hi, 0.005, 'vertical', { faces: 'noBottom' }));
  if (open < 0.02) part(b, 0, 0, 0.041, 0.008, H, 0.004, 0x3a3d40);
  b.plane(0, 0, -0.04, W, H, 'kit:glow', { facing: '+z', uv: 'solid', color: o.interior != null ? rgb(o.interior) : 0 });
  const bx = W / 2 + jw + 0.16;
  part(b, bx, 0.95, 0.015, 0.12, 0.3, 0.03, 0x7b8085);
  glowBox(b, bx, 1.1, 0.035, 0.05, 0.05, 0.02, [1.4, 1.2, 0.7]);
  if (hi) {
    const zf = jd / 2 + 0.002, lc = shade(fc, 0.66);
    // ① 地坎：门前一条金属地坎（顶面 8 mm）+ 中间一道导轨槽
    part(b, 0, 0, 0.055, W + 0.06, 0.008, 0.11, 0x9a9ea2, { faces: ['py', 'pz'] });
    face(b, 0, 0.0105, 0.06, W, 0.008, 'up', 0x2c2e30);
    // ② 楼层显示外框（深色）+ 右侧上下行箭头（上行亮、下行暗）
    part(b, 0, H + 0.1, jd / 2 + 0.002, 0.42, 0.14, 0.006, 0x2a2c2e, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    const ax = 0.3, ay = H + 0.12, az = jd / 2 + 0.003;
    tris3(b, [[[ax - 0.03, ay + 0.06, az], [ax + 0.03, ay + 0.06, az], [ax, ay + 0.105, az]]], o.indicator != null ? rgb(o.indicator) : [1.5, 0.75, 0.2], 'kit:glow');
    tris3(b, [[[ax - 0.03, ay + 0.045, az], [ax, ay, az], [ax + 0.03, ay + 0.045, az]]], [0.22, 0.14, 0.06], 'kit:glow');
    // ③ 呼梯盒：深色底座一圈边 + 下行按钮（不亮）
    part(b, bx, 0.94, 0.012, 0.135, 0.32, 0.024, 0x5d6166, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    glowBox(b, bx, 1.02, 0.035, 0.05, 0.05, 0.02, [0.24, 0.21, 0.15]);
    // ④ 门框线、⑤ 两扇门底部的踢脚深色带（跟着门扇一起滑）
    for (const sx of [-1, 1]) face(b, sx * (W / 2 + jw / 2), 0, zf, 0.01, H + 0.03, '+z', lc);
    face(b, 0, H + 0.03, zf, W + jw + 0.01, 0.01, '+z', lc);
    linkVisible(left, [face(b, -(pw / 2 + shift), 0.012, 0.0425, pw - 0.03, 0.1, '+z', shade(dc, 0.78))]);
    linkVisible(right, [face(b, pw / 2 + shift, 0.012, 0.0425, pw - 0.03, 0.1, '+z', shade(dc, 0.78))]);
  }
  if (o.solid !== false) {
    if (open < 0.3) b.solid(-W / 2 - jw, 0, -jd / 2, W / 2 + jw, H + hd, jd / 2);
    else { b.solid(-W / 2 - jw, 0, -jd / 2, -W / 2, H + hd, jd / 2); b.solid(W / 2, 0, -jd / 2, W / 2 + jw, H + hd, jd / 2); }
  }
  if (o.wall) wallWithOpening(b, 0, 0, 0, Object.assign({ openW: W + jw * 2, openY0: 0, openY1: H + hd }, o.wall));
  b.pop();
  return { left, right };
}

// 通风口：墙上（y = 中心高度，默认 2.3）或 ceiling: true 时贴天花板朝下
function vent(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.6), Hh = num(o.h, 0.35), c = o.color != null ? o.color : 0xcfcac0;
  b.push(x, z, rot);
  if (o.ceiling) {
    const y = num(o.y, b.height);
    b.plane(0, y - 0.004, 0, W, Hh, 'kit:glow', { facing: 'down', uv: 'solid', color: 0.02 });
    part(b, 0, y - 0.03, -Hh / 2 - 0.02, W + 0.08, 0.03, 0.04, c);
    part(b, 0, y - 0.03, Hh / 2 + 0.02, W + 0.08, 0.03, 0.04, c);
    part(b, -W / 2 - 0.02, y - 0.03, 0, 0.04, 0.03, Hh, c);
    part(b, W / 2 + 0.02, y - 0.03, 0, 0.04, 0.03, Hh, c);
    const n = Math.max(3, Math.round(Hh / 0.07));
    for (let k = 0; k < n; k++) part(b, 0, y - 0.025, -Hh / 2 + (k + 0.5) * Hh / n, W, 0.02, 0.014, c);
    if (hiDetail(b, o)) {
      // ① 贴天花板的外法兰（比框大一圈、6 mm 厚、颜色深一点）；② 中间一根加强筋（底面比框低 2 mm）；③ 四角螺钉
      const sc = shade(c, 0.55);
      const fl = shade(c, 0.86), X0 = W / 2 + 0.04, Z0 = Hh / 2 + 0.04, e = 0.02;   // 法兰是框外一圈 2 cm 的环，不盖住洞口
      for (const sz of [-1, 1]) part(b, 0, y - 0.006, sz * (Z0 + e / 2), (X0 + e) * 2, 0.006, e, fl, { faces: ['ny', sz > 0 ? 'pz' : 'nz'] });
      for (const sx of [-1, 1]) part(b, sx * (X0 + e / 2), y - 0.006, 0, e, 0.006, Z0 * 2, fl, { faces: ['ny', sx > 0 ? 'px' : 'nx'] });
      part(b, 0, y - 0.032, 0, 0.022, 0.012, Hh, c, { faces: ['ny', 'px', 'nx'] });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) face(b, sx * (W / 2 + 0.02), y - 0.0325, sz * (Hh / 2 + 0.02), 0.012, 0.012, 'down', sc);
    }
  } else {
    const y = num(o.y, 2.3);
    b.plane(0, y - Hh / 2, 0.004, W, Hh, 'kit:glow', { facing: '+z', uv: 'solid', color: 0.02 });
    part(b, 0, y - Hh / 2 - 0.03, 0.015, W + 0.06, 0.03, 0.03, c);
    part(b, 0, y + Hh / 2, 0.015, W + 0.06, 0.03, 0.03, c);
    part(b, -W / 2 - 0.015, y - Hh / 2, 0.015, 0.03, Hh, 0.03, c);
    part(b, W / 2 + 0.015, y - Hh / 2, 0.015, 0.03, Hh, 0.03, c);
    const n = Math.max(3, Math.round(Hh / 0.07));
    for (let k = 0; k < n; k++) part(b, 0, y - Hh / 2 + (k + 0.5) * Hh / n - 0.008, 0.014, W, 0.016, 0.02, c);
    if (hiDetail(b, o)) {
      // ① 贴墙的外法兰（比框大一圈、6 mm 厚、颜色深一点，背面朝墙里看不见）；② 中间一根竖向加强筋；③ 四角螺钉
      const sc = shade(c, 0.55);
      const fl = shade(c, 0.86), X0 = W / 2 + 0.03, Y0 = Hh / 2 + 0.03, e = 0.03, ey = 0.015;   // 法兰是框外一圈的环，不盖住洞口
      for (const sy of [-1, 1]) part(b, 0, y + (sy > 0 ? Y0 : -Y0 - ey), 0.003, (X0 + e) * 2, ey, 0.006, fl, { faces: ['pz', sy > 0 ? 'py' : 'ny'] });
      for (const sx of [-1, 1]) part(b, sx * (X0 + e / 2), y - Y0, 0.003, e, Y0 * 2, 0.006, fl, { faces: ['pz', sx > 0 ? 'px' : 'nx'] });
      part(b, 0, y - Hh / 2, 0.022, 0.022, Hh, 0.012, c, { faces: ['pz', 'px', 'nx'] });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) face(b, sx * (W / 2 + 0.015), y + sy * (Hh / 2 + 0.015) - 0.006, 0.0325, 0.012, 0.012, '+z', sc);
    }
  }
  b.pop();
  return {};
}

// 管道：axis 'x'（默认，沿本地 x，y = 轴线高度）| 'z' | 'y'（竖管，y = 底部高度）；两端法兰
function pipe(b, x, z, rot, opts) {
  const o = opts || {};
  const L = num(o.length, 3), r = num(o.r, 0.06), axis = o.axis || 'x';
  const c = o.color != null ? o.color : 0x7f837e;
  const y = num(o.y, axis === 'y' ? 0 : 2.5);
  b.push(x, z, rot);
  const po = { color: c, uv: 'stretch', segments: 8 };
  if (axis === 'y') {
    b.cylinder(0, y, 0, r, L, 'kit:prop', Object.assign({}, po, { solid: o.solid !== false }));
    b.cylinder(0, y, 0, r * 1.6, 0.05, 'kit:prop', Object.assign({}, po, { solid: false }));
    b.cylinder(0, y + L - 0.05, 0, r * 1.6, 0.05, 'kit:prop', Object.assign({}, po, { solid: false }));
  } else {
    b.cylinder(0, y, 0, r, L, 'kit:prop', Object.assign({}, po, { axis, solid: !!o.solid }));
    for (const s of [-1, 1]) {
      const px = axis === 'x' ? s * (L / 2 - 0.025) : 0, pz = axis === 'z' ? s * (L / 2 - 0.025) : 0;
      b.cylinder(px, y, pz, r * 1.6, 0.05, 'kit:prop', Object.assign({}, po, { axis, solid: false }));
    }
  }
  if (hiDetail(b, o)) {
    // u = 从管子起点量的轴向距离（竖管从底往上，横管从 −x/−z 端开始）
    const cyl = (u, rr, len, cc, caps) => {
      const q = Object.assign({}, po, { color: cc, solid: false, caps });
      if (axis === 'y') b.cylinder(0, y + u - len / 2, 0, rr, len, 'kit:prop', q);
      else b.cylinder(axis === 'x' ? u - L / 2 : 0, y, axis === 'z' ? u - L / 2 : 0, rr, len, 'kit:prop', Object.assign(q, { axis }));
    };
    // ① 管卡/管接头：每 3 m 左右一个加粗的环（颜色深一点），一根最多 6 个（贯穿整块的长管不至于堆几百个面）；电线那么细的不加
    const nR = r >= 0.025 ? Math.min(6, Math.floor(L / 3)) : 0;
    for (let k = 0; k < nR; k++) cyl(L * (k + 1) / (nR + 1), r * 1.22, 0.06, shade(c, 0.82), true);
    // ② 靠起点一段浅色色环（管道标识带），和管卡错开
    if (L >= 0.8 && r >= 0.025) {
      const bc = rgb(c), m = 0.55;
      cyl(nR ? L / (nR + 1) * 0.5 : L * 0.3, r * 1.03, 0.16, [bc[0] + (0.85 - bc[0]) * m, bc[1] + (0.82 - bc[1]) * m, bc[2] + (0.74 - bc[2]) * m], false);
    }
    // ③ 两端法兰内侧各 4 颗螺栓头（细管子看不见，不加）
    if (r >= 0.035) {
      const R = r * 1.3, bs = Math.max(0.012, r * 0.28), bh = 0.018, bcol = shade(c, 0.62);
      for (let k = 0; k < 4; k++) {
        const th = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(th) * R, sa = Math.sin(th) * R;
        for (const s of [-1, 1]) {
          if (axis === 'y') {
            const by = s < 0 ? y + 0.05 : y + L - 0.05 - bh;
            part(b, ca, by, sa, bs, bh, bs, bcol, { faces: ['px', 'nx', 'pz', 'nz', s < 0 ? 'py' : 'ny'] });
          } else {
            const a = s * (L / 2 - 0.05 - bh / 2);
            if (axis === 'x') part(b, a, y + sa - bs / 2, ca, bh, bs, bs, bcol, { faces: ['py', 'ny', 'pz', 'nz', s < 0 ? 'px' : 'nx'] });
            else part(b, ca, y + sa - bs / 2, a, bs, bs, bh, bcol, { faces: ['py', 'ny', 'px', 'nx', s < 0 ? 'pz' : 'nz'] });
          }
        }
      }
    }
  }
  b.pop();
  return {};
}

// 水坑：不规则半透明水面（形状按位置哈希，不消耗 rng），不挡路
// opts.ringColor / opts.ringOpacity：外面那圈干掉的水渍印（高画质、rx·rz ≤ 0.7）的颜色（屏幕色 hex）和浓淡；缺省 = 水色深一号、0.42。
// 水色很深（近黑的污水、地漏积水）时缺省那圈也近黑，像马克笔描了一圈 —— 这种传一个浅一点的 ringColor，或者干脆 ring: false
// （上线前复查 2026-10-02：L3 地漏积水先试了 ringColor 0x2a3028 + 0.25，仍是挂在水坑外的一圈，最后用 ring: false）。
// opts.ring === false：不画这圈
function puddle(b, x, z, rot, opts) {
  const o = opts || {};
  const rx = num(o.rx, 0.8), rz = num(o.rz, 0.5), seg = 14;
  const hi = hiDetail(b, o);
  const py = num(o.y, 0.006);
  b.push(x, z, rot);
  const radii = [];
  for (let k = 0; k < seg; k++) radii.push(0.72 + 0.4 * posHash(b, k + 11));
  // 高画质：水面缩到 0.9，外面 0.9–1.0 那圈是一道更淡的湿边 —— 总轮廓（占地）和低画质一样
  const inner = hi ? 0.9 : 1;
  // 轮廓点：低画质就是原来那 14 个点（逐位一样）；高画质每段中间再插一个点（Catmull-Rom 插半径，曲线仍过原来 14 个点），
  // 14 边形的折角磨圆成 28 边的圆滑边（2026-10-01 "角不能太尖锐"）。水面 +14、湿边 +28 个三角形
  const sub = hi ? 2 : 1, ns = seg * sub, ol = [];
  for (let i = 0; i < ns; i++) {
    const k = Math.floor(i / sub), f = (i % sub) / sub;
    let r = radii[k];
    if (f > 0) {
      const p0 = radii[(k + seg - 1) % seg], p1 = r, p2 = radii[(k + 1) % seg], p3 = radii[(k + 2) % seg];
      r = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
    }
    const a = i / ns * TAU;
    ol.push([Math.cos(a) * rx * r, Math.sin(a) * rz * r]);
  }
  const piece = b._piece('kit:water', 0, py, 0, 0, (v, t) => {
    v(0, 0, 0, 0, 1, 0, 0, 0);
    for (let k = 0; k < ns; k++) v(ol[k][0] * inner, 0, ol[k][1] * inner, 0, 1, 0, 0, 0);
    for (let k = 0; k < ns; k++) t(0, 1 + (k + 1) % ns, 1 + k);
    // 深灰偏冷：半透明叠在地毯上是"湿的一滩发暗"，高光由灯打出来；浅色会像地毯褪色的一块
  }, { uv: 'world', color: o.color != null ? o.color : [0.2, 0.22, 0.23], solid: false });
  if (hi) {
    const base = rgb(o.color != null ? o.color : [0.2, 0.22, 0.23]);
    const wa = b._acc('kit:water'), n0 = wa.pieces.length;
    // ① 湿边：水面外一圈更浅更薄的一环（和水面首尾相接不重叠，透明件不写深度，不会闪）
    b._piece('kit:water', 0, py - 0.001, 0, 0, (v, t) => {
      for (let k = 0; k < ns; k++) {
        const ca = ol[k][0], sa = ol[k][1];
        v(ca * 0.9, 0, sa * 0.9, 0, 1, 0, 0, 0);
        v(ca, 0, sa, 0, 1, 0, 0, 0);
      }
      for (let k = 0; k < ns; k++) { const k2 = (k + 1) % ns; t(k * 2, k2 * 2, k * 2 + 1); t(k2 * 2, k2 * 2 + 1, k * 2 + 1); }
    }, { uv: 'world', color: [base[0] * 1.5, base[1] * 1.5, base[2] * 1.5], solid: false });   // 2026-10-01 从 1.9 调到 1.5：外面有了软边水渍圈，湿边不用再是一道发白的硬边
    // ② 水面上一道斜的亮反光条；③ 旁边两三个小水点（都在原轮廓内）
    const ang = posHash(b, 3) * Math.PI;
    b._piece('kit:water', 0, py + 0.0005, 0, ang, (v, t) => {
      const l = Math.min(rx, rz) * 0.55, wd = Math.min(rx, rz) * 0.07;
      v(-l, 0, -wd, 0, 1, 0, 0, 0); v(l, 0, -wd * 0.4, 0, 1, 0, 0, 0); v(l * 0.8, 0, wd * 0.6, 0, 1, 0, 0, 0); v(-l * 0.9, 0, wd, 0, 1, 0, 0, 0);
      t(0, 3, 2); t(0, 2, 1);
    }, { uv: 'world', color: [0.62, 0.66, 0.7], solid: false });
    for (let d = 0; d < 3; d++) {
      const k = Math.floor(posHash(b, 40 + d) * seg), a = k / seg * TAU, rr = 0.03 + 0.03 * posHash(b, 50 + d);
      const cx = Math.cos(a) * rx * radii[k] * 0.78, cz = Math.sin(a) * rz * radii[k] * 0.78;
      if (posHash(b, 60 + d) < 0.35) continue;
      b._piece('kit:water', cx, py + 0.001, cz, 0, (v, t) => {
        v(0, 0, 0, 0, 1, 0, 0, 0);
        for (let m = 0; m < 6; m++) { const q = m / 6 * TAU; v(Math.cos(q) * rr, 0, Math.sin(q) * rr, 0, 1, 0, 0, 0); }
        for (let m = 0; m < 6; m++) t(0, 1 + (m + 1) % 6, 1 + m);
      }, { uv: 'world', color: base, solid: false });
    }
    linkVisible(piece, wa.pieces.slice(n0));
    // ④ 水渍圈：水坑外面一圈干了的水印（软边环线，环比水坑轮廓大一成左右；环内很淡）。跟着水面一起显隐；
    //    贴在地面上、水面下面 2–3.5 mm（透明件都不写深度，不会和水面互相闪）。大水坑不加（整片透明贴花太大，费填充率）
    if (rx * rz <= 0.7 && o.ring !== false) {
      const dy = Math.min(0.0035, py * 0.6), rc = o.ringColor != null;
      wear(b, hi, {
        kind: 'water', x: 0, y: py - dy, z: 0, facing: 'up', offset: 0, w: rx * 2.6, h: rz * 2.6, rot: wh(b, 5) < 0.5 ? 0 : Math.PI,
        flip: wh(b, 6) < 0.5, color: rc ? o.ringColor : o.color != null ? tone(o.color, 0.8) : 0x5c5546, srgb: rc || o.color == null,
        opacity: o.ringOpacity != null ? o.ringOpacity : 0.42,
      }, piece);
    }
  }
  b.pop();
  return { piece };
}

// 纸箱（可叠 stack 个，每层按位置哈希轻微错角）
function box(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.5), Hh = num(o.h, 0.38), D = num(o.d, 0.4);
  const c = o.color != null ? o.color : PC.cardboard;
  const stack = Math.max(1, o.stack | 0 || 1);
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  for (let k = 0; k < stack; k++) {
    b.push(0, 0, (posHash(b, k) - 0.5) * 0.35, k * Hh);
    // 高画质：四条竖棱倒 1.4 cm（纸箱的折角是圆的）；上棱不倒 —— 封箱胶带和中缝是横跨顶面的，倒了会悬在斜面外面
    part(b, 0, 0, 0, W, Hh, D, c, bv(hi, Math.min(0.014, W * 0.05, D * 0.05), 'vertical', { faces: 'noBottom' }));
    part(b, 0, Hh, 0, 0.07, 0.004, D + 0.004, PC.tape);
    part(b, 0, Hh, 0, W + 0.002, 0.003, 0.006, 0x7d6140);
    if (hi) {
      // ① 封箱胶带顺着前后两面往下折 10 cm；② 正面一张白色快递单（带一道条码）；③ 左右两侧的提手孔
      const tl = Math.min(0.1, Hh * 0.35);
      for (const sz of [1, -1]) face(b, 0, Hh - tl, sz * (D / 2 + 0.003), 0.07, tl, sz > 0 ? '+z' : '-z', PC.tape);
      if (W > 0.25 && Hh > 0.28) {
        // 快递单顶边比折下来的胶带底边低 1 cm 以上：两者不重叠，免得前后只差 0.5 mm 闪烁
        const lx = (posHash(b, 7) - 0.5) * (W - 0.24), ly = Math.min(Hh * (0.3 + 0.15 * posHash(b, 8)), Hh - tl - 0.1);
        face(b, lx, ly, D / 2 + 0.0025, 0.14, 0.09, '+z', 0xe9e6dc);
        face(b, lx, ly + 0.012, D / 2 + 0.0045, 0.1, 0.022, '+z', 0x2a2a2a);
        for (const sx of [-1, 1]) face(b, sx * (W / 2 + 0.002), Hh * 0.68, 0, Math.min(0.11, D * 0.3), 0.035, sx > 0 ? '+x' : '-x', shade(c, 0.35));
      }
      // ④ 磨损：最底下那只箱子一侧贴地吸了水的一圈潮印（软边、上沿淡出），或正面下沿一道蹭黑的擦痕
      if (k === 0 && W > 0.2 && D > 0.2 && Hh > 0.15) {
        const pk = wh(b, 100);
        if (pk < 0.45) {
          const sx = wh(b, 101) < 0.5 ? 1 : -1, w = (D - 0.06) * (0.6 + 0.3 * wh(b, 102));
          wear(b, hi, {
            kind: 'stain', x: sx * W / 2, y: 0.055, z: (wh(b, 103) - 0.5) * (D - 0.06 - w), facing: sx > 0 ? '+x' : '-x',
            w, h: Math.min(0.13, Hh * 0.35), variant: 0, color: tone(c, 0.6), opacity: 0.55,
          });
        } else if (pk < 0.75) {
          const sz = wh(b, 104) < 0.5 ? 1 : -1, w = Math.min(W - 0.08, 0.26);
          wear(b, hi, {
            kind: 'scuff', x: (wh(b, 105) - 0.5) * (W - 0.06 - w), y: 0.05 + 0.04 * wh(b, 106), z: sz * D / 2, facing: sz > 0 ? '+z' : '-z',
            w, rot: (wh(b, 107) - 0.5) * 0.3, color: tone(c, 0.4), opacity: 0.5,
          });
        }
      }
    }
    b.pop();
  }
  if (o.solid !== false) b.solid(-W / 2 - 0.06, 0, -D / 2 - 0.06, W / 2 + 0.06, Hh * stack, D / 2 + 0.06);
  b.pop();
  return {};
}

// 木箱：箱体 + 12 条包边木条
function crate(b, x, z, rot, opts) {
  const o = opts || {};
  const S = num(o.size, 0.8), c = o.color != null ? o.color : 0x8a6a42, e = 0x6a4f30, t = 0.07;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  part(b, 0, 0, 0, S, S, S, c, { faces: 'noBottom' });
  const h = S / 2 + 0.005;
  // 角柱和上压边比箱顶高出一点：原来这三者的顶面都落在 y=S 同一个平面上，深度缓冲分不出先后，
  // 顶面会出现闪烁的杂纹（Level 18 幼儿园那个粉色玩具箱最明显）。错开之后不再共面，也更像真木箱的护边
  const LIP = 0.004;
  // 高画质倒角：四根角柱倒竖棱（箱子的四个角不再是刀切的直角）、上一圈压边倒上棱；
  // 压边两头各缩进 r，端面整个藏进切了角的角柱里（不缩的话方头会从斜面上支出来一小块）
  const r = hi ? Math.min(0.018, t * 0.26) : 0, rl = S + 0.01 - 2 * r;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(b, sx * (h - t / 2), 0, sz * (h - t / 2), t, S + LIP * 2, t, e, bv(hi, r, 'vertical', { faces: 'noBottom' }));
  for (const y of [0, S - t + LIP]) {
    const top = y > 0;
    for (const s of [-1, 1]) {
      part(b, 0, y, s * (h - t / 2), rl, t, t, e, bv(hi && top, r, 'top'));
      part(b, s * (h - t / 2), y, 0, t, t, rl, e, bv(hi && top, r, 'top'));
    }
  }
  for (const s of [-1, 1]) part(b, 0, S / 2 - 0.035, s * h, S * 0.9, 0.07, 0.012, e, { rotY: 0 });
  if (hi && S >= 0.35) {
    const seam = shade(c, 0.5), inW = S - 2 * t, y0 = t, y1 = S - t;
    // ① 木板缝：左右两面三道、前后两面（中间横带下方）一道、箱盖两道，离板面 2 mm
    for (const sx of [-1, 1]) for (let k = 1; k <= 3; k++) face(b, sx * (S / 2 + 0.002), y0 + (y1 - y0) * k / 4 - 0.004, 0, inW, 0.008, sx > 0 ? '+x' : '-x', seam);
    for (const sz of [-1, 1]) face(b, 0, y0 + (y1 - y0) / 4 - 0.004, sz * (S / 2 + 0.002), inW, 0.008, sz > 0 ? '+z' : '-z', seam);
    for (const k of [-1, 1]) face(b, 0, S + 0.002, k * inW / 6, inW, 0.008, 'up', seam);
    // ② 左右两面各一根斜撑（从左下角斜到右上角）
    const hd = inW / 2 - 0.02;
    for (const sx of [-1, 1]) beam(b, [sx * (S / 2 + 0.007), y0 + 0.03, -hd], [sx * (S / 2 + 0.007), y1 - 0.03, hd], 0.012, 0.06, e);
    // ③ 前后两面上半块的深色喷印标记
    for (const sz of [-1, 1]) face(b, 0, S / 2 + 0.07, sz * (S / 2 + 0.0035), inW * 0.5, Math.min(0.1, (y1 - S / 2 - 0.07) * 0.7), sz > 0 ? '+z' : '-z', shade(c, 0.35));
    // ④ 磨损：前/后一面下半块一道露出浅色木头的刮痕；左/右一面贴地的一道深色擦痕（拖过、撞过）。都在压边和角柱围出来的板面里
    const k = S / 0.8, fw = S / 2 - t - 0.02;
    if (wh(b, 90) < 0.7) {
      const sz = wh(b, 91) < 0.5 ? 1 : -1, w = Math.min(fw * 1.6, (0.22 + 0.12 * wh(b, 92)) * k);
      wear(b, hi, {
        kind: 'scratch', x: (wh(b, 93) - 0.5) * (fw * 2 - w), y: t + 0.04 + (S / 2 - t - 0.12) * wh(b, 94), z: sz * S / 2, facing: sz > 0 ? '+z' : '-z',
        w, rot: (wh(b, 95) - 0.5) * 0.7, color: mix(c, 0xeedcb8, 0.5), opacity: 0.6,
      });
    }
    if (wh(b, 96) < 0.7) {
      const sx = wh(b, 97) < 0.5 ? 1 : -1, w = Math.min(fw * 1.6, 0.3 * k);
      wear(b, hi, {
        kind: 'scuff', x: sx * S / 2, y: t + 0.035, z: (wh(b, 98) - 0.5) * (fw * 2 - w), facing: sx > 0 ? '+x' : '-x',
        w, rot: (wh(b, 99) - 0.5) * 0.2, color: tone(c, 0.4), opacity: 0.55,
      });
    }
  }
  if (o.solid !== false) b.solid(-S / 2, 0, -S / 2, S / 2, S, S / 2);
  b.pop();
  return {};
}

// 办公桌：桌面 + 四腿 + 挡板 + 右侧抽屉柜；monitor: true 放一台 CRT
function desk(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.4), D = num(o.d, 0.7), Hh = num(o.h, 0.75);
  const hi = hiDetail(b, o);
  const topC = o.color != null ? o.color : PC.laminate;
  b.push(x, z, rot);
  // 高画质：桌面上一圈棱倒 1 cm（斜面接灯光，远看一道亮边），抽屉柜四条竖棱倒 8 mm
  const tr = hi ? 0.01 : 0;
  part(b, 0, Hh - 0.03, 0, W, 0.03, D, topC, bv(hi, tr, 'top'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(b, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), 0.04, Hh - 0.03, 0.04, 0x55585c, { faces: 'noBottom' });
  part(b, 0, 0.25, -D / 2 + 0.03, W - 0.1, Hh - 0.3, 0.015, 0x8c8272);
  const dx = W / 2 - 0.24, dh = (Hh - 0.03) / 3;
  part(b, dx, 0, 0, 0.4, Hh - 0.03, D - 0.06, 0xb3a78e, bv(hi, 0.008, 'vertical', { faces: 'noBottom' }));
  for (let k = 1; k <= 2; k++) part(b, dx, k * (Hh - 0.03) / 3, D / 2 - 0.03, 0.38, 0.008, 0.006, 0x6e6658);
  if (!hi) {
    for (let k = 0; k < 3; k++) part(b, dx, (k + 0.6) * (Hh - 0.03) / 3, D / 2 - 0.02, 0.1, 0.02, 0.02, 0x3d4044);
  } else {
    // ① 抽屉：三块独立的抽屉面板（缝里露出原来那两道深色线）+ 贴在面板上的拉手 + 顶层抽屉右上角的锁芯
    const fz = D / 2 - 0.03;
    for (let k = 0; k < 3; k++) {
      part(b, dx, k * dh + 0.006, fz + 0.006, 0.376, dh - 0.012, 0.012, 0xc1b59b, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });   // 比缝里的深色线窄 4 mm，侧面不共面
      part(b, dx, k * dh + dh * 0.62, fz + 0.02, 0.12, 0.022, 0.016, 0x3d4044, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    }
    face(b, dx + 0.15, 2 * dh + dh * 0.7, fz + 0.014, 0.018, 0.018, '+z', 0xb9bcbf);
    // ② 桌沿封边：桌面四周一圈深色封边条（凸出 1.5 mm），只包到桌面侧面倒角斜面的下沿 —— 上面那道斜面露出桌面本色，是一道亮边
    const eb = shade(topC, 0.55), ey = Hh - 0.0305, eh = 0.0305 - tr;
    for (const sz of [-1, 1]) part(b, 0, ey, sz * (D / 2 + 0.0015), W + 0.006, eh, 0.003, eb, { faces: [sz > 0 ? 'pz' : 'nz', 'py'] });
    for (const sx of [-1, 1]) part(b, sx * (W / 2 + 0.0015), ey, 0, 0.003, eh, D, eb, { faces: [sx > 0 ? 'px' : 'nx', 'py'] });
    // ③ 左侧两条腿之间的横撑（右边是抽屉柜）
    part(b, -(W / 2 - 0.04), 0.1, 0, 0.022, 0.035, D - 0.12, 0x55585c, { faces: ['py', 'ny', 'px', 'nx'] });
  }
  if (o.monitor) {
    const my = hi ? Hh + 0.025 : Hh;
    part(b, -0.15, my, -0.08, 0.42, 0.36, 0.4, 0xd8d0bd, bv(hi, 0.012, 'all'));   // CRT 机身 12 条棱倒 1.2 cm（塑料外壳是圆角的）
    b.plane(-0.15, my + 0.05, 0.121, 0.32, 0.25, 'kit:glow', { facing: '+z', uv: 'solid', color: o.screen != null ? rgb(o.screen) : 0.03 });
    if (hi) {
      // 显示器：底座（把机身垫高 2.5 cm）、后壳凸起、屏幕四周深一圈的边框、电源灯和按钮；桌上一副键盘 + 鼠标
      part(b, -0.15, Hh, -0.06, 0.26, 0.025, 0.24, 0xc8c0ab, { faces: 'noBottom' });
      part(b, -0.15, my + 0.05, -0.3, 0.3, 0.25, 0.04, 0xcdc5b1, { faces: ['nz', 'py', 'ny', 'px', 'nx'] });
      const bz = 0.1225, bc = 0xb4ac98;
      face(b, -0.15, my + 0.03, bz, 0.36, 0.02, '+z', bc);
      face(b, -0.15, my + 0.30, bz, 0.36, 0.02, '+z', bc);
      face(b, -0.32, my + 0.05, bz, 0.02, 0.25, '+z', bc);
      face(b, 0.02, my + 0.05, bz, 0.02, 0.25, '+z', bc);
      // 电源灯、按钮在机身正面倒角斜面之上、下边框之下（离斜面上沿 ≥ 3 mm，不悬在斜面外）
      face(b, 0.01, my + 0.016, bz, 0.012, 0.008, '+z', [0.3, 1.4, 0.4], 'kit:glow');
      face(b, -0.02, my + 0.0155, bz, 0.02, 0.012, '+z', 0x6f6a5e);
      part(b, -0.15, Hh, 0.215, 0.44, 0.022, 0.15, 0xcfc6b0, bv(hi, 0.006, 'top', { faces: 'noBottom' }));
      face(b, -0.15, Hh + 0.024, 0.22, 0.41, 0.11, 'up', 0xa39b88);
      for (let r = 0; r < 3; r++) face(b, -0.15, Hh + 0.026, 0.186 + r * 0.03, 0.4, 0.004, 'up', 0x6f6a5e);
      part(b, 0.2, Hh, 0.2, 0.06, 0.028, 0.1, 0xcfc6b0, bv(hi, 0.008, 'top', { faces: 'noBottom' }));
    }
  }
  if (hi) {
    // 磨损：桌面上一两圈杯印（有显示器时放在显示器、键盘、鼠标右边的空处），有时再加几道浅色细划痕
    const x0 = o.monitor ? 0.3 : -W / 2 + 0.1, x1 = W / 2 - 0.08, zr = D / 2 - 0.1;
    if (x1 > x0 && zr > 0.02 && wh(b, 110) < 0.75) {
      const cx = x0 + (x1 - x0) * wh(b, 111), cz = (wh(b, 112) - 0.5) * 2 * zr, ring = tone(topC, 0.5);
      wear(b, hi, { kind: 'water', x: cx, y: Hh, z: cz, facing: 'up', w: 0.095, rot: wh(b, 113) * TAU, color: ring, opacity: 0.5 });
      if (wh(b, 114) < 0.4) {
        const a = wh(b, 115) * TAU;
        wear(b, hi, { kind: 'water', x: U.clamp(cx + Math.cos(a) * 0.04, x0, x1), y: Hh, z: U.clamp(cz + Math.sin(a) * 0.04, -zr, zr), facing: 'up', w: 0.09, rot: a, color: ring, opacity: 0.35 });
      }
    }
    if (wh(b, 116) < 0.5 && W > 0.6) {
      wear(b, hi, {
        kind: 'hairline', x: (wh(b, 117) - 0.5) * (W - 0.5), y: Hh, z: (wh(b, 118) - 0.5) * (D - 0.3), facing: 'up',
        w: 0.22 + 0.12 * wh(b, 119), rot: wh(b, 120) * Math.PI, color: mix(topC, 0xffffff, 0.35), opacity: 0.45,
      });
    }
  }
  if (o.solid !== false) b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
  return {};
}

// 办公椅：座面、靠背（在 −Z）、气压杆、五爪脚
function chair(b, x, z, rot, opts) {
  const o = opts || {};
  const c = o.color != null ? o.color : PC.fabric;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  // 高画质：坐垫、靠背 12 条棱都倒 2 cm（软包的边是鼓起来的圆边）
  part(b, 0, 0.42, 0, 0.46, 0.08, 0.46, c, bv(hi, 0.02));
  part(b, 0, 0.56, -0.22, 0.44, 0.48, 0.06, c, bv(hi, 0.02));
  part(b, 0, 0.44, -0.26, 0.05, 0.2, 0.03, PC.dark);
  b.cylinder(0, 0.08, 0, 0.03, 0.34, 'kit:prop', { color: PC.dark, uv: 'stretch', solid: false, segments: 6 });
  for (let k = 0; k < 5; k++) {
    b.push(0, 0, k * TAU / 5);
    part(b, 0, 0.03, 0.15, 0.05, 0.04, 0.3, PC.dark);
    if (hi) part(b, 0, 0, 0.275, 0.03, 0.032, 0.05, 0x1a1a1c, { faces: 'noBottom' });   // ① 五爪脚末端的脚轮
    b.pop();
  }
  if (hi) {
    // ② 坐垫、靠背上浅一号的软包面（四周一圈原色就是缝线边）
    const pc = shade(c, 1.2);
    face(b, 0, 0.502, 0.01, 0.38, 0.38, 'up', pc);
    face(b, 0, 0.63, -0.188, 0.36, 0.34, '+z', pc);
    // ③ 靠背后面的横档（腰托）、座板下的调节机构
    part(b, 0, 0.6, -0.262, 0.4, 0.035, 0.022, PC.dark, { faces: ['nz', 'py', 'ny', 'px', 'nx'] });
    part(b, 0, 0.38, 0, 0.2, 0.04, 0.22, 0x2e3034, { faces: 'noTop' });
    // ④ 扶手：贴着座板两侧的立柱 + 扶手垫
    for (const sx of [-1, 1]) {
      part(b, sx * 0.245, 0.43, -0.04, 0.03, 0.23, 0.04, PC.dark, { faces: ['px', 'nx', 'pz', 'nz'] });
      part(b, sx * 0.245, 0.66, -0.02, 0.06, 0.025, 0.24, 0x2a2c2f);
    }
  }
  if (o.solid !== false) b.solid(-0.28, 0, -0.28, 0.28, 1.0, 0.28);
  b.pop();
  return {};
}

// 隔间：背板 + 左右隔板（正面 +Z 敞开），默认带桌椅
function cubicle(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 2), D = num(o.d, 2), Hh = num(o.h, 1.4), t = 0.06;
  const c = o.color != null ? o.color : 0x7a8390, tc = 0x9aa0a6;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  part(b, 0, 0, -D / 2 + t / 2, W, Hh, t, c, { faces: 'noBottom' });
  part(b, -W / 2 + t / 2, 0, 0, t, Hh, D, c, { faces: 'noBottom' });
  part(b, W / 2 - t / 2, 0, 0, t, Hh, D, c, { faces: 'noBottom' });
  // 隔板顶上的压顶条：高画质上棱倒 6 mm（站着往下看正好看到这一圈）
  part(b, 0, Hh, -D / 2 + t / 2, W, 0.025, t + 0.01, tc, bv(hi, 0.006, 'top'));
  part(b, -W / 2 + t / 2, Hh, 0, t + 0.01, 0.025, D, tc, bv(hi, 0.006, 'top'));
  part(b, W / 2 - t / 2, Hh, 0, t + 0.01, 0.025, D, tc, bv(hi, 0.006, 'top'));
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, -D / 2 + t);
  b.solid(-W / 2, 0, -D / 2, -W / 2 + t, Hh, D / 2);
  b.solid(W / 2 - t, 0, -D / 2, W / 2, Hh, D / 2);
  if (hi) {
    // ① 三块隔板底部的深色踢脚条（两侧比后面高 2 mm，拐角处不共面）；② 两侧隔板敞口端的铝包边；③ 后板内侧钉着的便条、纸、日历
    const kc = shade(c, 0.5);
    part(b, 0, 0, -D / 2 + t / 2, W - 2 * t, 0.08, t + 0.006, kc, { faces: ['py', 'pz', 'nz'] });
    for (const sx of [-1, 1]) {
      part(b, sx * (W / 2 - t / 2), 0, -0.002, t + 0.006, 0.082, D - 0.004, kc, { faces: ['py', 'px', 'nx', 'pz'] });
      part(b, sx * (W / 2 - t / 2), 0, D / 2 + 0.004, t + 0.008, Hh + 0.02, 0.01, tc, { faces: ['pz', 'px', 'nx', 'py'] });
    }
    const pz = -D / 2 + t + 0.002;
    face(b, -W / 2 + t + 0.25, Hh * 0.66, pz, 0.21, 0.28, '+z', 0xeeebe2);
    face(b, W / 2 - t - 0.6, Hh * 0.78, pz, 0.1, 0.1, '+z', 0xe8d66a);
    face(b, W / 2 - t - 0.2, Hh * 0.68, pz, 0.26, 0.2, '+z', 0xbcd0e0);
  }
  if (o.desk !== false) desk(b, 0, -D / 2 + t + 0.36, 0, { w: W - t * 2 - 0.1, d: 0.7, monitor: o.monitor !== false, detail: o.detail });
  if (o.chair !== false) chair(b, 0.15, -D / 2 + t + 1.0, Math.PI, { detail: o.detail });
  b.pop();
  return {};
}

// 窗户：y = 窗台高度；blackout: true 涂黑，glow: true|颜色 = 外面很亮（发光面），否则半透明玻璃
function windowProp(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.2), Hh = num(o.h, 1.2), y = num(o.y, 0.9);
  const fc = o.frameColor != null ? o.frameColor : 0xd8d4cc, ft = 0.06, fd = 0.12;
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  part(b, 0, y - ft, 0.02, W + ft * 2, ft, fd + 0.04, fc, bv(hi, 0.01, 'top'));   // 窗台：高画质上棱倒 1 cm
  part(b, 0, y + Hh, 0, W + ft * 2, ft, fd, fc);
  part(b, -W / 2 - ft / 2, y, 0, ft, Hh, fd, fc);
  part(b, W / 2 + ft / 2, y, 0, ft, Hh, fd, fc);
  if (o.mullions !== false) {
    part(b, 0, y, 0, 0.03, Hh, 0.04, fc);
    part(b, 0, y + Hh / 2 - 0.015, 0, W, 0.03, 0.04, fc);
  }
  let pane;
  if (o.blackout) {
    const pc = o.paint != null ? o.paint : 0x0b0b0b;
    pane = b.plane(0, y, 0.005, W, Hh, 'kit:prop', { facing: '+z', color: pc, uv: 'stretch' });
    b.plane(0, y, -0.005, W, Hh, 'kit:prop', { facing: '-z', color: pc, uv: 'stretch' });
  } else if (o.glow) {
    const gc = o.glow === true ? [1.1, 1.15, 1.2] : rgb(o.glow);
    pane = b.plane(0, y, 0.005, W, Hh, 'kit:glow', { facing: '+z', uv: 'solid', color: gc });
    b.plane(0, y, -0.005, W, Hh, 'kit:glow', { facing: '-z', uv: 'solid', color: gc });
  } else {
    pane = b.box(0, y, 0, W, Hh, 0.01, 'kit:glass', { color: o.tint != null ? o.tint : 0xa9c4cc, uv: 'stretch', solid: false });
  }
  if (hi) {
    // ① 窗框内侧两面各一圈压条（比外框细、凸出玻璃 2 cm，看得出玻璃是嵌在框里的）
    const bc = shade(fc, 0.9), bw = 0.02;
    for (const sz of [1, -1]) {
      const zc = sz * 0.015, fz = sz > 0 ? 'pz' : 'nz';
      part(b, -W / 2 + bw / 2, y, zc, bw, Hh, 0.02, bc, { faces: [fz, 'px'] });
      part(b, W / 2 - bw / 2, y, zc, bw, Hh, 0.02, bc, { faces: [fz, 'nx'] });
      part(b, 0, y + Hh - bw, zc, W - bw * 2, bw, 0.02, bc, { faces: [fz, 'ny'] });
      part(b, 0, y, zc, W - bw * 2, bw, 0.02, bc, { faces: [fz, 'py'] });
    }
    // ② 中横档上的月牙锁（正面一侧）
    if (o.mullions !== false) part(b, 0.07, y + Hh / 2 + 0.015, 0.03, 0.07, 0.016, 0.02, 0xb9bcbf, { faces: ['pz', 'py', 'px', 'nx'] });
    // ③ 按窗型：涂黑窗两面各三道竖向刷痕；发光窗拉下一截卷帘；玻璃窗两道斜的反光条（玻璃材质，不写深度不会闪）
    if (o.blackout) {
      const pc = rgb(o.paint != null ? o.paint : 0x0b0b0b);
      const sc = [pc[0] * 1.9 + 0.02, pc[1] * 1.9 + 0.02, pc[2] * 1.9 + 0.02];
      for (const sz of [1, -1]) for (let k = 0; k < 3; k++) {
        const sx = (posHash(b, 20 + k) - 0.5) * (W - 0.2), sh = Hh * (0.35 + 0.4 * posHash(b, 30 + k));
        face(b, sx * sz, y + Hh - sh - 0.03, sz * 0.0075, 0.03 + 0.04 * posHash(b, 40 + k), sh, sz > 0 ? '+z' : '-z', sc);
      }
    } else if (o.glow) {
      // 外面很亮的窗：正面拉下来一截卷帘（遮住顶上两成）+ 卷帘底杆
      const hb = Hh * 0.2, yb = y + Hh - bw - hb;
      face(b, 0, yb, 0.009, W - bw * 2, hb, '+z', 0xd8d2c4);
      part(b, 0, yb - 0.012, 0.012, W - bw * 2, 0.014, 0.008, 0x9a948a, { faces: ['pz', 'py', 'ny'] });
    } else {
      for (const [f0, bw2] of [[0.12, 0.12], [0.36, 0.05]]) {
        const x0 = -W / 2 + W * f0, x1 = x0 + W * 0.28, yb = y + Hh * 0.12, yt = y + Hh * 0.88, zz = 0.0065;
        b.quad([x0, yb, zz], [x0 + bw2, yb, zz], [x1 + bw2, yt, zz], [x1, yt, zz], 'kit:glass', { color: [0.92, 0.96, 1.0], uv: 'stretch' });
      }
    }
  }
  if (o.solid !== false) b.solid(-W / 2 - ft, y - ft, -fd / 2, W / 2 + ft, y + Hh + ft, fd / 2);
  if (o.wall) wallWithOpening(b, 0, 0, 0, Object.assign({ openW: W + ft * 2, openY0: y - ft, openY1: y + Hh + ft }, o.wall));
  b.pop();
  return { pane };
}

// 自动售货机：机身 + 发光展示窗 + 一排排饮料 + 投币面板；light: false 可去掉那盏小灯
function vending(b, x, z, rot, opts) {
  const o = opts || {};
  const W = 0.9, Hh = 1.8, D = 0.8, c = o.color != null ? o.color : 0xb3202a;
  const pal = [0xd23b2f, 0x2f6fd2, 0xe0c341, 0x3fa34d, 0xeeeeee, 0x7b3fa0];
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  // 机身：高画质四条竖棱倒 1 cm（正面展示窗外框贴边到 ±0.44，倒角再大框就悬在斜面外了）
  part(b, 0, 0, 0, W, Hh, D, c, bv(hi, 0.01, 'vertical', { faces: 'noBottom' }));
  const gx = -0.12, gw = 0.58;
  b.plane(gx, 0.55, D / 2 + 0.004, gw, 1.15, 'kit:glow', { facing: '+z', uv: 'solid', color: o.glow != null ? rgb(o.glow) : [1.25, 1.25, 1.1] });
  for (let r = 0; r < 5; r++) {
    part(b, gx, 0.6 + r * 0.22, D / 2 + 0.012, gw, 0.012, 0.02, 0x333333);
    for (let k = 0; k < 4; k++) part(b, gx + (k - 1.5) * 0.13, 0.62 + r * 0.22, D / 2 + 0.024, 0.07, 0.14, 0.03, pal[(r * 4 + k * 3) % pal.length]);
  }
  part(b, 0.33, 0.9, D / 2 + 0.01, 0.16, 0.5, 0.02, 0x2b2b2b);
  glowBox(b, 0.33, 1.25, D / 2 + 0.025, 0.06, 0.04, 0.01, [1.4, 0.4, 0.3]);
  b.plane(gx, 0.12, D / 2 + 0.004, gw, 0.28, 'kit:glow', { facing: '+z', uv: 'solid', color: 0.01 });
  if (hi) {
    const fz = D / 2, dk = 0x2a2a2c;
    // ① 展示窗一圈深色窗框（比饮料罐还凸出一点）
    const X0 = gx - gw / 2, X1 = gx + gw / 2, e = 0.03, fd = 0.045;
    part(b, gx, 0.55 - e, fz + fd / 2, gw + e * 2, e, fd, dk, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    part(b, gx, 1.7, fz + fd / 2, gw + e * 2, e, fd, dk, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    part(b, X0 - e / 2, 0.55, fz + fd / 2, e, 1.15, fd, dk, { faces: ['pz', 'px', 'nx'] });
    part(b, X1 + e / 2, 0.55, fz + fd / 2, e, 1.15, fd, dk, { faces: ['pz', 'px', 'nx'] });
    // ② 顶上一条亮的招牌灯带（机身颜色调亮）
    const cc = rgb(c);
    face(b, 0, 1.738, fz + 0.004, W - 0.06, 0.048, '+z', [cc[0] * 1.5 + 0.15, cc[1] * 1.5 + 0.15, cc[2] * 1.5 + 0.15], 'kit:glow');
    // ③ 投币面板：3×4 选货按键、纸币口、退币口
    const kz = fz + 0.0225;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) face(b, 0.295 + i * 0.035, 1.0 + j * 0.03, kz, 0.026, 0.018, '+z', 0xb8bcc0);
    face(b, 0.33, 1.14, kz, 0.09, 0.05, '+z', 0x121212);
    face(b, 0.33, 0.93, kz, 0.06, 0.04, '+z', 0x121212);
    // ④ 取货口上半截的翻板 + 把手；⑤ 底部深色踢脚板
    part(b, gx, 0.26, fz + 0.006, gw - 0.02, 0.13, 0.008, 0x3a3a3a, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    face(b, gx, 0.36, fz + 0.0125, 0.12, 0.015, '+z', 0x7a7a7a);
    face(b, 0, 0.02, fz + 0.003, W - 0.04, 0.08, '+z', shade(c, 0.45));
    // ⑥ 磨损：投币面板下方被踢出来的黑色鞋痕；一侧机身上一道刮掉漆的浅色长刮痕
    if (wh(b, 130) < 0.75) {
      wear(b, hi, { kind: 'scuff', x: 0.31 + (wh(b, 131) - 0.5) * 0.04, y: 0.17 + 0.12 * wh(b, 132), z: fz, facing: '+z', w: 0.17, rot: (wh(b, 133) - 0.5) * 0.6, color: 0x1e1c1a, srgb: true, opacity: 0.55 });
    }
    if (wh(b, 134) < 0.6) {
      const sx = wh(b, 135) < 0.5 ? 1 : -1;
      wear(b, hi, {
        kind: 'scratch', x: sx * W / 2, y: 0.6 + 0.8 * wh(b, 136), z: (wh(b, 137) - 0.5) * (D - 0.5), facing: sx > 0 ? '+x' : '-x',
        w: 0.3 + 0.15 * wh(b, 138), rot: (wh(b, 139) - 0.5) * 0.5, color: mix(c, 0xdcdcdc, 0.6), opacity: 0.6,
      });
    }
  }
  let src = null;
  if (o.light !== false) src = b.light({ x: 0, z: D / 2 + 0.6, y: 1.1, color: 0xdfe8ff, intensity: num(o.intensity, 0.35), range: num(o.range, 3.5) });
  if (o.solid !== false) b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
  return { src };
}

// 床：床头在 −Z，床尾朝 +Z
function bed(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.0), L = num(o.l, 2.0), wood = o.frameColor != null ? o.frameColor : 0x6d4c33;
  const hi = hiDetail(b, o), blanket = o.color != null ? o.color : 0x5a6f8a;
  b.push(x, z, rot);
  // 高画质倒角：床架上棱 1.2 cm；床垫、被子上棱 3 cm、枕头 12 条棱 3.5 cm（软的东西边是鼓起来的圆边）；床头板不倒（高画质有立柱和压顶包着）
  part(b, 0, 0, 0, W + 0.06, 0.3, L + 0.06, wood, bv(hi, 0.012, 'top', { faces: 'noBottom' }));
  part(b, 0, 0.3, 0.02, W - 0.02, 0.18, L - 0.06, 0xe8e3d6, bv(hi, 0.03, 'top'));
  part(b, 0, 0.3, L * 0.18, W + 0.02, 0.2, L * 0.62, blanket, bv(hi, 0.03, 'top'));
  part(b, 0, 0.48, -L / 2 + 0.25, W * 0.6, 0.1, 0.32, 0xf2efe6, bv(hi, 0.035));
  part(b, 0, 0, -L / 2 - 0.03, W + 0.1, 0.95, 0.06, wood, { faces: 'noBottom' });
  if (hi) {
    const wd = shade(wood, 0.8);
    // ① 床头两根立柱（比床头板高 7 cm）+ 床头板顶上的压顶木条
    for (const sx of [-1, 1]) part(b, sx * (W / 2 + 0.02), 0, -L / 2 - 0.03, 0.07, 1.02, 0.08, shade(wood, 0.88), { faces: 'noBottom' });
    part(b, 0, 0.95, -L / 2 - 0.03, W + 0.04, 0.03, 0.076, wd, bv(hi, 0.008, 'top', { faces: 'noBottom' }));   // 比立柱薄 4 mm：前后面不和立柱共面
    // ② 矮床尾板 + 压顶（在原碰撞体里，只往外多 2 mm）
    part(b, 0, 0, L / 2 + 0.0085, W + 0.064, 0.55, 0.047, wood, { faces: 'noBottom' });
    part(b, 0, 0.55, L / 2 + 0.0085, W + 0.08, 0.025, 0.065, wd, bv(hi, 0.008, 'top', { faces: 'noBottom' }));
    // ③ 被子床头那端翻出来的一截白被单（上棱和被子一样倒 3 cm，叠在被子斜面外面 ≥ 5 mm）
    part(b, 0, 0.3, L * 0.18 - L * 0.31 + 0.069, W + 0.03, 0.206, 0.142, 0xf0ede4, bv(hi, 0.03, 'top', { faces: 'noBottom' }));   // 头端比被子多出 2 mm
    // ④ 磨损：被子上一块很淡的旧水渍（被子颜色深一点点，软边，单团不带小尾巴的那个变体）。
    //    上线前复查 2026-10-02：原来 tone 0.55、opacity 0.35 + 带尾巴的变体，浅色被子上像烧焦/破了个洞 → tone 0.8、opacity 0.2、variant 0
    if (wh(b, 140) < 0.5 && W > 0.5) {
      wear(b, hi, {
        kind: 'stain', variant: 0, x: (wh(b, 141) - 0.5) * (W - 0.5), y: 0.5, z: L * (0.05 + 0.3 * wh(b, 142)), facing: 'up',
        w: 0.32 + 0.14 * wh(b, 143), rot: wh(b, 144) * TAU, color: tone(blanket, 0.8), opacity: 0.2,
      });
    }
  }
  if (o.solid !== false) b.solid(-W / 2 - 0.05, 0, -L / 2 - 0.06, W / 2 + 0.05, 0.6, L / 2 + 0.03);
  b.pop();
  return {};
}

// 柜子：kind 'file'（四层金属文件柜，默认）| 'wardrobe'（木衣柜）| 'locker'（储物柜）
function cabinet(b, x, z, rot, opts) {
  const o = opts || {};
  const kind = o.kind || 'file';
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  let W, H, D;
  // 高画质：柜体四条竖棱倒角（衣柜 1.6 cm、储物柜 8 mm、文件柜 1.6 cm；正面的门缝、合页、标签、踢脚都在斜面以内），衣柜顶上的檐板上下沿倒 1 cm，文件柜顶盖上沿倒 5 mm
  if (kind === 'wardrobe') {
    W = num(o.w, 1.0); H = num(o.h, 1.9); D = num(o.d, 0.55);
    const c = o.color != null ? o.color : 0x7b5a3c;
    part(b, 0, 0, 0, W, H, D, c, bv(hi, 0.016, 'vertical', { faces: 'noBottom' }));
    part(b, 0, H, 0, W + 0.06, 0.05, D + 0.04, 0x5f432b, bv(hi, 0.01, 'horizontal'));
    part(b, 0, 0.06, D / 2 + 0.003, 0.01, H - 0.12, 0.006, 0x3e2b1b);
    for (const s of [-1, 1]) part(b, s * 0.06, H * 0.5, D / 2 + 0.02, 0.02, 0.16, 0.03, 0xc9b27a);
    if (hi) {
      // ① 两扇门各上下两块凸起的门板；② 底部深色踢脚；③ 外侧边上的合页、右门把手下的锁孔
      const pw = W / 2 - 0.14, pc = shade(c, 1.1);
      for (const sx of [-1, 1]) {
        part(b, sx * W / 4, H * 0.52, D / 2 + 0.004, pw, H - 0.16 - H * 0.52, 0.008, pc, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
        part(b, sx * W / 4, 0.14, D / 2 + 0.004, pw, H * 0.46 - 0.14, 0.008, pc, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
        for (const hy of [0.3, H - 0.4]) face(b, sx * (W / 2 - 0.028), hy, D / 2 + 0.003, 0.02, 0.08, '+z', 0xb59a5a);   // 外沿离柜体竖棱 1.8 cm，在倒角斜面以内
      }
      face(b, 0, 0.005, D / 2 + 0.003, W - 0.036, 0.05, '+z', shade(c, 0.5));
      face(b, 0.06, H * 0.5 - 0.05, D / 2 + 0.003, 0.012, 0.02, '+z', 0x1c140c);
      // ④ 磨损：一扇门的下门板上一道露出浅色木头的刮痕（贴在凸起的门板面上）
      const ly0 = 0.2, ly1 = H * 0.46 - 0.06;
      if (wh(b, 150) < 0.6 && ly1 > ly0 && pw > 0.12) {
        const sx = wh(b, 151) < 0.5 ? 1 : -1, sw = Math.min(pw * 0.75, 0.26);
        wear(b, hi, {
          kind: 'scratch', x: sx * W / 4 + (wh(b, 152) - 0.5) * (pw - sw) * 0.8, y: ly0 + (ly1 - ly0) * wh(b, 153), z: D / 2 + 0.008, facing: '+z',
          w: sw, rot: (wh(b, 154) - 0.5) * 0.5, color: mix(c, 0xead6b0, 0.5), opacity: 0.55,
        });
      }
    }
  } else if (kind === 'locker') {
    W = num(o.w, 0.4); H = num(o.h, 1.8); D = num(o.d, 0.5);
    const c = o.color != null ? o.color : 0x5b6f86;
    part(b, 0, 0, 0, W, H, D, c, bv(hi, 0.008, 'vertical', { faces: 'noBottom' }));
    for (let k = 0; k < 3; k++) part(b, 0, H - 0.25 - k * 0.05, D / 2 + 0.002, W * 0.6, 0.015, 0.004, 0x1f2833);
    part(b, W / 2 - 0.07, H * 0.5, D / 2 + 0.015, 0.03, 0.12, 0.03, 0xb8bcc0);
    if (hi) {
      const lz = D / 2 + 0.003, lc = shade(c, 0.55);
      // ① 柜门轮廓线（门缝）；② 底部再三道通风百叶；③ 顶上的号码牌、把手上方的挂锁扣、左边两片合页
      face(b, -W / 2 + 0.02, 0.05, lz, 0.006, H - 0.08, '+z', lc);
      face(b, W / 2 - 0.02, 0.05, lz, 0.006, H - 0.08, '+z', lc);
      face(b, 0, H - 0.03, lz, W - 0.034, 0.006, '+z', lc);
      face(b, 0, 0.05, lz, W - 0.034, 0.006, '+z', lc);
      for (let k = 0; k < 3; k++) face(b, 0, 0.15 + k * 0.05, lz, W * 0.6, 0.015, '+z', 0x1f2833);
      face(b, 0, H - 0.11, lz, 0.1, 0.045, '+z', 0xd9d6cc);
      face(b, 0, H - 0.1, lz + 0.002, 0.035, 0.025, '+z', 0x2a2a2a);
      part(b, W / 2 - 0.07, H * 0.5 + 0.13, D / 2 + 0.012, 0.035, 0.03, 0.024, 0x9a9ea3, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
      // 合页贴着门缝线外侧（9 mm 宽，左沿正好落在柜体竖棱倒角的斜面上沿，不悬在斜面外）
      for (const hy of [0.3, H - 0.35]) face(b, -W / 2 + 0.0125, hy, lz, 0.009, 0.07, '+z', 0x9a9ea3);
      // ④ 磨损：门上半截一两道钥匙/硬物划出来的露底漆浅色细痕，门脚一道踢出来的黑擦痕
      const bare = mix(c, 0xd8dadc, 0.65);
      if (wh(b, 155) < 0.65) {
        wear(b, hi, { kind: 'hairline', x: (wh(b, 156) - 0.5) * (W - 0.2), y: H * (0.45 + 0.25 * wh(b, 157)), z: D / 2, facing: '+z', w: Math.min(W - 0.12, 0.2), h: 0.01, rot: (wh(b, 158) - 0.5) * 1.2, color: bare, opacity: 0.6 });
        if (wh(b, 159) < 0.5) wear(b, hi, { kind: 'scratch', x: (wh(b, 160) - 0.5) * (W - 0.2), y: H * (0.35 + 0.2 * wh(b, 161)), z: D / 2, facing: '+z', w: Math.min(W - 0.12, 0.16), h: 0.011, rot: (wh(b, 162) - 0.5) * 1.4, color: bare, opacity: 0.5 });
      }
      if (wh(b, 163) < 0.6) wear(b, hi, { kind: 'scuff', x: (wh(b, 164) - 0.5) * (W - 0.24), y: 0.09, z: D / 2, facing: '+z', w: Math.min(W - 0.08, 0.2), rot: (wh(b, 165) - 0.5) * 0.4, color: 0x1c1c1c, srgb: true, opacity: 0.45 });
    }
  } else {
    W = num(o.w, 0.46); H = num(o.h, 1.32); D = num(o.d, 0.62);
    const c = o.color != null ? o.color : PC.metal;
    part(b, 0, 0, 0, W, H, D, c, bv(hi, 0.016, 'vertical', { faces: 'noBottom' }));
    const dh = (H - 0.06) / 4;
    for (let k = 0; k < 4; k++) {
      part(b, 0, 0.04 + k * dh, D / 2 + 0.005, W - 0.04, dh - 0.02, 0.01, 0xa2a7ac);
      part(b, 0, 0.04 + k * dh + dh * 0.62, D / 2 + 0.02, 0.12, 0.025, 0.02, PC.dark);
    }
    if (hi) {
      // ① 每个抽屉拉手上方的标签框；② 顶层抽屉右上角的锁芯；③ 顶面压边、底部深色踢脚
      for (let k = 0; k < 4; k++) if (dh > 0.12) face(b, 0, 0.04 + k * dh + dh * 0.78, D / 2 + 0.0125, 0.1, Math.min(0.035, dh * 0.12), '+z', 0xe6e2d6);
      face(b, W / 2 - 0.06, 0.04 + 3 * dh + dh * 0.72, D / 2 + 0.0125, 0.02, 0.02, '+z', 0xc7cacd);
      part(b, 0, H, 0, W + 0.01, 0.012, D + 0.01, shade(c, 0.85), bv(hi, 0.005, 'top', { faces: 'noBottom' }));
      face(b, 0, 0.004, D / 2 + 0.003, W - 0.036, 0.03, '+z', PC.dark);
      // ④ 磨损：一侧柜身下半截一道刮掉漆的浅色刮痕（拉抽屉时被蹭的那一侧）
      if (wh(b, 166) < 0.55) {
        const sx = wh(b, 167) < 0.5 ? 1 : -1;
        wear(b, hi, {
          kind: 'scratch', x: sx * W / 2, y: 0.25 + 0.5 * wh(b, 168), z: (wh(b, 169) - 0.5) * (D - 0.4), facing: sx > 0 ? '+x' : '-x',
          w: 0.26, rot: (wh(b, 170) - 0.5) * 0.5, color: mix(c, 0xe6e8ea, 0.6), opacity: 0.55,
        });
      }
    }
  }
  if (o.solid !== false) b.solid(-W / 2, 0, -D / 2, W / 2, H, D / 2);
  b.pop();
  return {};
}

// 路灯：灯杆在原点，灯臂伸向 +Z；state 同灯盘
function streetlight(b, x, z, rot, opts) {
  const o = opts || {};
  const Hh = num(o.h, 6), c = o.poleColor != null ? o.poleColor : 0x4a4d50;
  const state = o.state || 'on';
  const lit = state === 'on' || state === 'flicker';
  const base = rgb(o.lampColor != null ? o.lampColor : [1.6, 1.3, 0.85]);
  const hi = hiDetail(b, o);
  b.push(x, z, rot);
  b.cylinder(0, 0, 0, 0.09, Hh, 'kit:prop', { rTop: 0.06, color: c, uv: 'stretch', solid: true, segments: 8 });
  // 高画质：灯座、灯罩外壳的棱倒 1.5 cm（铸件外壳本来就是圆角的）
  part(b, 0, 0, 0, 0.3, 0.4, 0.3, c, bv(hi, 0.015, 'all', { faces: 'noBottom' }));
  part(b, 0, Hh - 0.1, 0.6, 0.06, 0.06, 1.2, c);
  part(b, 0, Hh - 0.22, 1.25, 0.28, 0.14, 0.5, 0x3a3c3e, bv(hi, 0.015));
  const lens = b.plane(0, Hh - 0.225, 1.25, 0.22, 0.42, 'kit:glow', { facing: 'down', uv: 'solid', color: base, glow: state === 'broken' ? 0.15 : lit ? 1 : 0.06 });
  if (hi) {
    // ① 灯座：底板 + 灯座顶上收一圈的台阶 + 正面的检修小门
    part(b, 0, 0, 0, 0.32, 0.02, 0.32, shade(c, 0.8), { faces: 'noBottom' });
    part(b, 0, 0.4, 0, 0.2, 0.05, 0.2, shade(c, 0.9), { faces: 'noBottom' });
    face(b, 0, 0.1, 0.152, 0.14, 0.2, '+z', shade(c, 0.7));
    // ② 灯杆上的编号牌（杆子 40% 高处，朝灯臂那面）
    const ty = Hh * 0.4, tr = 0.09 - 0.03 * 0.4;
    part(b, 0, ty, tr - 0.006, 0.06, 0.13, 0.018, 0xd8d4c8, { faces: ['pz', 'py', 'ny', 'px', 'nx'] });
    face(b, 0, ty + 0.04, tr + 0.0055, 0.04, 0.05, '+z', 0x2a2c2e);
    // ③ 灯臂下的斜撑；④ 灯罩顶上的遮檐 + 光控探头
    beam(b, [0, Hh - 0.75, 0.05], [0, Hh - 0.1, 0.55], 0.035, 0.035, c);
    part(b, 0, Hh - 0.08, 1.25, 0.3, 0.025, 0.54, shade(0x3a3c3e, 1.25));
    part(b, 0, Hh - 0.055, 1.42, 0.05, 0.03, 0.05, 0x8a8d90, { faces: 'noBottom' });
  }
  let src = null;
  if (state !== 'broken' && o.light !== false) {
    src = b.light({
      x: 0, z: 1.25, y: Hh - 0.5, color: o.color != null ? o.color : 0xffc98a,
      intensity: lit ? num(o.intensity, 1.4) : 0, range: num(o.range, 14),
      flicker: state === 'flicker' ? num(o.flicker, 0.5) : 0,
    });
    if (!lit) src.onIntensity = num(o.intensity, 1.4);
    b.linkGlow(lens, src, base, 0.06);
  }
  b.pop();
  return { src, lens };
}

// 栅栏：沿本地 x 长 length；kind 'chain'（铁丝网，默认）| 'picket'（木栅栏）| 'rail'（金属护栏）
function fence(b, x, z, rot, opts) {
  const o = opts || {};
  const L = num(o.length, 4), Hh = num(o.h, o.kind === 'rail' ? 1.1 : 1.8), kind = o.kind || 'chain';
  const n = Math.max(2, Math.ceil(L / 2.5) + 1), sp = L / (n - 1);
  b.push(x, z, rot);
  if (kind === 'picket') {
    const c = o.color != null ? o.color : 0xe6e0d2;
    const hi = hiDetail(b, o);
    // 立柱：高画质四条竖棱倒 1.5 cm（尖桩成排上百根，太细，不倒）
    for (let k = 0; k < n; k++) part(b, -L / 2 + k * sp, 0, 0, 0.09, Hh + 0.05, 0.09, c, bv(hi, 0.015, 'vertical', { faces: 'noBottom' }));
    for (const y of [0.3, Hh - 0.35]) part(b, 0, y, -0.06, L, 0.08, 0.03, c);
    const m = Math.max(2, Math.floor(L / 0.14));
    for (let k = 0; k < m; k++) part(b, -L / 2 + (k + 0.5) * L / m, 0.05, 0.0, 0.08, Hh - 0.1, 0.02, c, { faces: 'noBottom' });
    if (hi) {
      // ① 每根尖桩顶上的尖头（前后两个三角 + 两个斜面）；② 立柱顶的方帽；③ 尖桩后面贴地的一条踢脚板
      const yb = Hh - 0.05, yt = yb + 0.055, tl = [];
      for (let k = 0; k < m; k++) {
        const px = -L / 2 + (k + 0.5) * L / m, l = px - 0.04, r = px + 0.04, f = 0.01, bk = -0.01;
        tl.push([[l, yb, f], [r, yb, f], [px, yt, f]], [[r, yb, bk], [l, yb, bk], [px, yt, bk]]);
        tl.push([[l, yb, bk], [l, yb, f], [px, yt, f]], [[l, yb, bk], [px, yt, f], [px, yt, bk]]);
        tl.push([[r, yb, f], [r, yb, bk], [px, yt, bk]], [[r, yb, f], [px, yt, bk], [px, yt, f]]);
      }
      tris3(b, tl, c);
      for (let k = 0; k < n; k++) part(b, -L / 2 + k * sp, Hh + 0.05, 0, 0.11, 0.025, 0.11, shade(c, 0.92), { faces: 'noBottom' });
      part(b, 0, 0, -0.035, L, 0.12, 0.02, shade(c, 0.85), { faces: ['py', 'pz', 'nz'] });
    }
  } else {
    const c = o.color != null ? o.color : 0x8a8e91;
    for (let k = 0; k < n; k++) b.cylinder(-L / 2 + k * sp, 0, 0, 0.035, Hh, 'kit:prop', { color: c, uv: 'stretch', solid: false, segments: 6 });
    const hi = hiDetail(b, o), cd = shade(c, 0.82);
    if (kind === 'rail') {
      for (const y of [Hh - 0.05, Hh * 0.55, Hh * 0.15]) part(b, 0, y, 0, L, 0.06, 0.05, c);
      if (hi) {
        // ① 立柱顶的小帽（压在顶横杆上）；② 顶横杆和立柱交接处的抱箍；③ 立柱底的方形法兰（不比立柱宽，不扩大占地）
        for (let k = 0; k < n; k++) {
          const px = -L / 2 + k * sp;
          part(b, px, Hh + 0.01, 0, 0.06, 0.015, 0.06, cd, { faces: 'noBottom' });
          part(b, px, Hh - 0.058, 0, 0.09, 0.076, 0.062, cd);
          part(b, px, 0, 0, 0.07, 0.015, 0.07, cd, { faces: 'noBottom' });
        }
      }
    } else {
      b.cylinder(0, Hh - 0.02, 0, 0.025, L, 'kit:prop', { axis: 'x', color: c, uv: 'stretch', solid: false, segments: 6 });
      b.box(0, 0.05, 0, L, Hh - 0.1, 0.01, 'kit:glass', { color: o.meshColor != null ? o.meshColor : 0x6f7478, uv: 'stretch', solid: false });
      if (hi) {
        // ① 立柱顶帽；② 贴地的一根拉紧横杆；③ 两头第一格的中横撑 + 斜拉杆（铁丝网围栏端柱的标准加固）
        for (let k = 0; k < n; k++) part(b, -L / 2 + k * sp, Hh - 0.005, 0, 0.074, 0.035, 0.074, cd, { faces: 'noBottom' });
        part(b, 0, 0.045, 0, L, 0.018, 0.018, c, { faces: ['py', 'ny', 'pz', 'nz'] });
        for (const s2 of n > 2 ? [-1, 1] : [-1]) {
          const x0 = s2 * L / 2, x1 = s2 * (L / 2 - sp);
          part(b, (x0 + x1) / 2, Hh * 0.5, 0, sp - 0.05, 0.03, 0.03, c, { faces: ['py', 'ny', 'pz', 'nz'] });
          beam(b, [x0 - s2 * 0.03, Hh * 0.5, 0], [x1 + s2 * 0.03, 0.12, 0], 0.012, 0.012, c);
        }
      }
    }
  }
  if (o.solid !== false) b.solid(-L / 2, 0, -0.07, L / 2, Hh, 0.07);
  b.pop();
  return {};
}

// 柱子：textured 时传 matKey（按世界尺寸平铺），否则顶点色
function pillar(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.6), Hh = num(o.h, b.height), key = o.matKey || 'kit:prop';
  const hi = hiDetail(b, o), D0 = num(o.d, W);
  b.push(x, z, rot);
  // 高画质：柱身四条竖棱倒角（短边的 6%，最多 3.6 cm；天然材质的岩柱、树干也倒 —— 方方正正的石头更假）
  const pb = hi ? Math.min(0.036, Math.min(W, D0) * 0.06) : 0;
  const p = b.box(0, 0, 0, W, Hh, D0, key, bv(hi, pb, 'vertical', { faces: Hh >= b.height - 0.01 ? 'sides' : 'noBottom', color: o.color, solid: o.solid !== false, uv: key === 'kit:prop' ? 'stretch' : 'world' }));
  // 天然材质（岩柱、石笋、树干之类）的柱子不加人造细节
  const natural = !!o.matKey && /rock|cave|stone|boulder|cliff|ice|tree|trunk|root|moss|crystal|coral|flesh|soil|dirt/i.test(String(o.matKey));
  if (hi && !natural) {
    const D = D0, full = Hh >= b.height - 0.01, m = Math.min(0.044, Math.min(W, D) * 0.09);
    const kc = shade(o.color, 0.82), mo = { matKey: key };
    // ① 柱脚：比柱身宽一圈、12 cm 高的底座（同一种材质，上沿倒角）；② 柱头：顶天的柱子在顶上收一圈 10 cm 的柱帽（下沿倒角），矮柱子顶上压一块盖板（上沿倒角）
    part(b, 0, 0, 0, W + m, 0.12, D + m, kc, bv(hi, 0.012, 'top', Object.assign({ faces: ['py', 'px', 'nx', 'pz', 'nz'] }, mo)));
    if (full) part(b, 0, Hh - 0.1, 0, W + m, 0.1, D + m, kc, bv(hi, 0.012, 'horizontal', Object.assign({ faces: ['ny', 'px', 'nx', 'pz', 'nz'] }, mo)));
    else part(b, 0, Hh, 0, W + m, 0.03, D + m, kc, bv(hi, 0.01, 'top', Object.assign({ faces: 'noBottom' }, mo)));
    // ③ 四条竖棱上的钢护角（柱脚往上 1 m，只画朝外的两面和顶面）；④ 两面齐眼高的白色编号牌
    const gh = Math.min(1.0, Hh - 0.3);
    if (gh > 0.2) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      part(b, sx * (W / 2 - 0.019), 0.12, sz * (D / 2 - 0.019), 0.05, gh, 0.05, 0x8f9499, { faces: [sx > 0 ? 'px' : 'nx', sz > 0 ? 'pz' : 'nz', 'py'] });
    }
    if (Hh > 1.8 && W > 0.3) for (const sz of [-1, 1]) {
      const zf = sz * (D / 2 + 0.003), fc = sz > 0 ? '+z' : '-z';
      face(b, 0, 1.5, zf, 0.16, 0.1, fc, 0xe8e6de);
      face(b, 0, 1.525, sz * (D / 2 + 0.005), 0.08, 0.05, fc, 0x2a2c2e);
    }
    // ⑤ 磨损：一面柱脚上方一道推车、拖把蹭出来的黑擦痕（在两根护角之间）
    const fw = Math.min(W, D) - 0.1;
    if (wh(b, 180) < 0.6 && fw > 0.16 && Hh > 0.6) {
      const f = Math.floor(wh(b, 181) * 4) & 3, sw = Math.min(fw * 0.8, 0.3);
      const FC = ['+z', '-z', '+x', '-x'][f], along = (wh(b, 182) - 0.5) * (fw - sw), half = f < 2 ? D / 2 : W / 2;
      const px = f < 2 ? along : (f === 2 ? half : -half), pz = f < 2 ? (f === 0 ? half : -half) : along;
      wear(b, hi, { kind: 'scuff', x: px, y: 0.22 + 0.3 * wh(b, 183), z: pz, facing: FC, w: sw, rot: (wh(b, 184) - 0.5) * 0.3, color: 0x2a2725, srgb: true, opacity: 0.45 });
    }
  }
  b.pop();
  return { piece: p };
}

// 发光指示牌（出口绿灯箱之类）：y = 底边高度
function sign(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.4), Hh = num(o.h, 0.15), y = num(o.y, 2.2);
  b.push(x, z, rot);
  const bk = o.backColor != null ? o.backColor : 0xe8e8e0;
  part(b, 0, y - 0.02, 0, W + 0.04, Hh + 0.04, 0.04, bk);
  const piece = b.plane(0, y, 0.021, W, Hh, 'kit:glow', { facing: '+z', uv: 'solid', color: o.color != null ? rgb(o.color) : EXIT_GREEN });
  if (hiDetail(b, o)) {
    // ① 发光面四周一圈深色压框（紧贴发光面外沿，不盖住它；比发光面凸出 4 mm）
    const bz = shade(bk, 0.62), e = 0.018, zc = 0.022, dz = 0.006;
    part(b, 0, y + Hh, zc, W + e * 2, e, dz, bz, { faces: ['pz', 'py'] });
    part(b, 0, y - e, zc, W + e * 2, e, dz, bz, { faces: ['pz', 'ny'] });
    for (const sx of [-1, 1]) part(b, sx * (W / 2 + e / 2), y, zc, e, Hh, dz, bz, { faces: ['pz', sx > 0 ? 'px' : 'nx'] });
    // ② 外壳侧面一圈合缝线；③ 顶上两只安装耳
    const sc = shade(bk, 0.45), hw = W / 2 + 0.0225, t2 = 0.004;
    face(b, 0, y + Hh + 0.0225, 0, W + 0.04, t2, 'up', sc);
    face(b, 0, y - 0.0225, 0, W + 0.04, t2, 'down', sc);
    face(b, hw, y - 0.02, 0, t2, Hh + 0.04, '+x', sc);
    face(b, -hw, y - 0.02, 0, t2, Hh + 0.04, '-x', sc);
    for (const sx of [-1, 1]) part(b, sx * W * 0.3, y + Hh + 0.02, 0, 0.03, 0.015, 0.016, shade(bk, 0.8), { faces: 'noBottom' });
  }
  b.pop();
  return { piece };
}

// 地上的坑：黑色不规则圆盘 + 脏边，不挡路（掉下去的效果由出口/层级处理）
function hole(b, x, z, rot, opts) {
  const o = opts || {};
  const r = num(o.r, 1.1), seg = 20;
  b.push(x, z, rot);
  const radii = [];
  for (let k = 0; k < seg; k++) radii.push(o.irregular === false ? 1 : 0.82 + 0.3 * posHash(b, k + 101));
  const fan = (key, y, scale, color, uvm) => b._piece(key, 0, y, 0, 0, (v, t) => {
    v(0, 0, 0, 0, 1, 0, 0, 0);
    for (let k = 0; k < seg; k++) {
      const a = k / seg * TAU;
      v(Math.cos(a) * r * radii[k] * scale, 0, Math.sin(a) * r * radii[k] * scale, 0, 1, 0, 0, 0);
    }
    for (let k = 0; k < seg; k++) t(0, 1 + (k + 1) % seg, 1 + k);
  }, { uv: uvm, color, solid: false });
  const rimC = o.rimColor != null ? o.rimColor : 0x2a261d;
  const hi = hiDetail(b, o);
  const rim = fan('kit:prop', 0.003, 1.12, rimC, 'stretch');
  // 高画质：黑洞缩到 0.86，外面 0.86–1.0 是坑壁顶端那圈往下暗过去的斜坡 —— 黑洞 + 斜坡的总轮廓和低画质的黑洞一样大
  const disc = fan('kit:glow', 0.006, hi ? 0.86 : 1, 0, 'solid');
  if (hi) {
    // ① 洞口内沿：外圈是脏边的颜色，往里逐顶点暗到接近黑（顶点色渐变，一圈只要 40 个三角形）
    const lip = b._piece('kit:prop', 0, 0.005, 0, 0, (v, t) => {
      for (let k = 0; k < seg; k++) {
        const a = k / seg * TAU, ca = Math.cos(a) * r * radii[k], sa = Math.sin(a) * r * radii[k];
        v(ca * 0.86, 0, sa * 0.86, 0, 1, 0, 0, 0);
        v(ca, 0, sa, 0, 1, 0, 0, 0);
      }
      for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; t(k * 2, k2 * 2, k * 2 + 1); t(k2 * 2, k2 * 2 + 1, k * 2 + 1); }
    }, { uv: 'stretch', color: shade(rimC, 0.8), solid: false });
    const col = lip.acc.col, dk = shade(rimC, 0.12);
    for (let k = 0; k < seg; k++) { const i = lip.start + k * 2; col[i * 3] = dk[0]; col[i * 3 + 1] = dk[1]; col[i * 3 + 2] = dk[2]; }
    linkVisible(disc, [lip]);
    // ② 洞边五块碎石（四面体，不挡路）；③ 从坑边往外裂开的四道裂缝（都在原来的脏边范围内）
    const rubble = [], cracks = [];
    for (let k = 0; k < 5; k++) {
      const i = Math.floor(posHash(b, 200 + k) * seg), a = i / seg * TAU + 0.1;
      const rr = r * radii[i] * (1.02 + 0.06 * posHash(b, 210 + k)), sz = 0.03 + 0.035 * posHash(b, 220 + k);
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, h = sz * (0.4 + 0.3 * posHash(b, 230 + k));   // 碎块压得很扁，最高 4.5 cm
      const p0 = [cx + sz, 0, cz], p1 = [cx - sz * 0.5, 0, cz + sz * 0.87], p2 = [cx - sz * 0.5, 0, cz - sz * 0.87], ap = [cx + sz * 0.1, h, cz];
      rubble.push([p0, p2, ap], [p2, p1, ap], [p1, p0, ap]);
    }
    const rb = tris3(b, rubble, shade(rimC, 1.6));
    // 裂缝从坑边一直裂到脏边外面的地上（深色细楔形），最远不超过原来最大外沿的 8%
    let rMax = 0;
    for (let k = 0; k < seg; k++) rMax = Math.max(rMax, radii[k]);
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(posHash(b, 240 + k) * seg), a = i / seg * TAU, ri = r * radii[i];
      const ro = Math.min(r * rMax * 1.12 * 1.08, ri * 1.12 + 0.08 + 0.14 * posHash(b, 250 + k)), w = 0.02;
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa * w, nz = ca * w, y = 0.007;   // 比内沿斜坡（0.005）高 2 mm
      cracks.push([[ca * ri * 0.98 + nx, y, sa * ri * 0.98 + nz], [ca * ro, y, sa * ro], [ca * ri * 0.98 - nx, y, sa * ri * 0.98 - nz]]);
    }
    linkVisible(rim, [rb, tris3(b, cracks, shade(rimC, 0.55))]);
  }
  b.pop();
  return { disc, rim };
}

// =====================================================================
// 软边画笔 BR.kit.paint：程序贴图里画刮痕、擦痕、污渍、水渍圈、滴流、锈迹、鞋印、拖痕、飞溅（贴花图集也是它画的）
// =====================================================================
// 用户 2026-10-01："刮痕两边就需要细一点的过渡"。痕迹一律从中间往两边慢慢淡出、两头收尖，不许 fillRect 画实心条。
// 软边只用 渐变 / 多层半透明叠画 / 两头收尖的路径 —— 不用 ctx.filter（老 iOS Safari 不支持，会悄悄退化成硬边）。
// 单位全是像素；color = [r,g,b]（0..255）或 '#rrggbb'；alpha = 最浓处的不透明度。
// opts.wrap：贴图边长（数字 = 四向无缝；[w, 0] = 只横向无缝）—— 跨边的部分在对边补画一份。
// 随机只用 opts.seed（数字/字符串）派生的流，缺省按位置派生：同样的参数永远画出同样的东西，联机两边一致，绝不碰 Math.random
function c3(c) {
  if (Array.isArray(c)) return [c[0] | 0, c[1] | 0, c[2] | 0];
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return [40, 38, 34];
}
function rgbaS(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(4) + ')'; }
function seedOf(o, tag, x, y) { return o && o.seed != null ? U.rng('kit-paint', tag, String(o.seed)) : U.rng('kit-paint', tag, Math.round(x * 8), Math.round(y * 8)); }
function wrapEach(o, x, y, R, fn) {
  const w = o && o.wrap;
  const sx = Array.isArray(w) ? +w[0] || 0 : +w || 0, sy = Array.isArray(w) ? +w[1] || 0 : +w || 0;
  for (let dy = sy ? -1 : 0; dy <= (sy ? 1 : 0); dy++) {
    for (let dx = sx ? -1 : 0; dx <= (sx ? 1 : 0); dx++) {
      const px = x + dx * sx, py = y + dy * sy;
      if (sx && (px + R < 0 || px - R > sx)) continue;
      if (sy && (py + R < 0 || py - R > sy)) continue;
      fn(dx * sx, dy * sy);
    }
  }
}
// 横截面"钟形"的每层 alpha：K 层由外到内宽度 1, (K-1)/K, …, 1/K，叠起来在离中心 d（0..1）处的浓度 ≈ A·(1 − d²)^p ——
// 中心浓、往两侧一路平滑淡到 0（不是"平台 + 一圈窄边"）。p 越大越软（核心越细、过渡越宽）
function bellAlphas(K, A, p) {
  const out = [];
  const a = Math.min(0.995, Math.max(0, A));
  let prev = 0;
  for (let k = 0; k < K; k++) {
    const d = 1 - (k + 0.5) / K;
    const F = a * Math.pow(Math.max(0, 1 - d * d), p);
    out.push(Math.max(0, Math.min(1, 1 - (1 - F) / (1 - prev))));
    prev = Math.max(prev, F);
  }
  return out;
}
// 一条带宽度的中心线按 K 层画：最外层最宽，越往里越窄，叠起来中心最浓、两侧淡出；
// fill(k) 返回第 k 层的 fillStyle（纯色或渐变）。层宽 sc = 1 - k/K
function layered(g, L, ox, oy, K, fill) {
  const cx = L.cx, cy = L.cy, hw = L.hw, nx = L.nx, ny = L.ny, n = cx.length - 1;
  for (let k = 0; k < K; k++) {
    const sc = 1 - k / K;
    g.beginPath();
    for (let i = 0; i <= n; i++) { const X = cx[i] + ox + nx[i] * hw[i] * sc, Y = cy[i] + oy + ny[i] * hw[i] * sc; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    for (let i = n; i >= 0; i--) g.lineTo(cx[i] + ox - nx[i] * hw[i] * sc, cy[i] + oy - ny[i] * hw[i] * sc);
    g.closePath();
    g.fillStyle = fill(k);
    g.fill();
  }
}
// 中心线采样：中点 (x, y)、沿 ang 方向长 len，弓高 bend，轻微抖动 wob；hwOf(t) 给半宽
function centerline(x, y, len, ang, bend, wob, r, hwOf) {
  const n = Math.max(8, Math.min(64, Math.round(len / 4)));
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ph1 = r() * TAU, ph2 = r() * TAU;
  const cx = [], cy = [], hw = [], nx = [], ny = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = (t - 0.5) * len;
    const off = bend * 4 * t * (1 - t) + wob * (Math.sin(t * 7 + ph1) * 0.6 + Math.sin(t * 17 + ph2) * 0.4);
    cx.push(x + ca * s - sa * off); cy.push(y + sa * s + ca * off);
    hw.push(hwOf(t));
  }
  // 法线按相邻点算：弯的划痕两侧宽度也不走样
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 1), b2 = Math.min(n, i + 1);
    const dx = cx[b2] - cx[a], dy = cy[b2] - cy[a], l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l); ny.push(dx / l);
  }
  return { cx, cy, hw, nx, ny };
}
const paint = {
  // 刮痕：细长、中间深两侧淡出、两头收尖。opts: { width = 2（最宽处的全宽，含两侧淡出）, color, alpha = 0.5（中心浓度）,
  //   soft = 2（横截面 (1−d²)^soft：1 = 核心粗过渡窄，3 = 核心细过渡宽）, bend（弓高，缺省随机 ±4% 长度）, wobble（中心线抖动，缺省 0.15×width）,
  //   taper = 0.6（两头收尖的指数，越小越钝）, skew = 1（≠1 时最宽处往一头偏）, lip: { color, alpha }（一侧浅色翻边）, wrap, seed }
  scratch(g, x, y, len, ang, opts) {
    const o = opts || {};
    const r = seedOf(o, 'scratch', x, y);
    const wid = Math.max(0.3, num(o.width, 2)), A = U.clamp(num(o.alpha, 0.5), 0, 1), col = c3(o.color != null ? o.color : [40, 38, 34]);
    const bend = num(o.bend, (r() - 0.5) * len * 0.08), taper = num(o.taper, 0.6), skew = num(o.skew, 1);
    const ph = r() * TAU, soft = Math.max(0.3, num(o.soft, 2));
    const L = centerline(x, y, len, ang, bend, num(o.wobble, wid * 0.15), r, t => {
      const tt = skew === 1 ? t : Math.pow(t, skew);
      return wid / 2 * Math.pow(Math.max(0, Math.sin(Math.PI * tt)), taper) * (0.85 + 0.15 * Math.sin(t * 11 + ph));
    });
    const K = Math.max(4, Math.min(16, Math.round(wid * 1.2 + 3)));
    const al = bellAlphas(K, A, soft);
    wrapEach(o, x, y, len / 2 + Math.abs(bend) + wid * 2, (ox, oy) => {
      layered(g, L, ox, oy, K, k => rgbaS(col, al[k]));
      if (o.lip) {
        // 翻边：贴着一侧、离中心约 1.55 倍半宽的一道很淡的亮边（刮开的漆皮边缘反光），同样两头收尖、三层叠出软边
        const lc = c3(o.lip.color || [255, 255, 250]), la = num(o.lip.alpha, A * 0.35);
        const S = { cx: L.cx.map((v, i) => v + L.nx[i] * L.hw[i] * 1.55), cy: L.cy.map((v, i) => v + L.ny[i] * L.hw[i] * 1.55), hw: L.hw.map(h => h * 0.45), nx: L.nx, ny: L.ny };
        const lal = bellAlphas(4, la, 1.5);
        layered(g, S, ox, oy, 4, k => rgbaS(lc, lal[k]));
      }
    });
  },
  // 擦痕：一束平行细刮痕（家具蹭墙、拖椅子）。opts: { spread = 长度×0.08（成束的总宽）, count = 7, width = 1.4, color, alpha = 0.45, wrap, seed }
  scuff(g, x, y, len, ang, opts) {
    const o = opts || {};
    const r = seedOf(o, 'scuff', x, y);
    const n = Math.max(2, num(o.count, 7) | 0), sp = num(o.spread, len * 0.08), wid = num(o.width, 1.4), A = num(o.alpha, 0.45);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let k = 0; k < n; k++) {
      const off = (k / (n - 1) - 0.5) * sp + (r() - 0.5) * sp / n, along = (r() - 0.5) * len * 0.22;
      const l2 = len * (0.45 + 0.55 * r());
      paint.scratch(g, x + ca * along - sa * off, y + sa * along + ca * off, l2, ang + (r() - 0.5) * 0.04, {
        width: wid * (0.6 + 0.7 * r()), alpha: A * (0.45 + 0.55 * r()), color: o.color, taper: 0.5, bend: (r() - 0.5) * l2 * 0.03, wrap: o.wrap, seed: [o.seed, k, x, y].join(':'),
      });
    }
  },
  // 污渍斑：几团错开的径向渐变叠出不规则轮廓，中间浓、往外淡出。
  // opts: { lobes = 5, squash = 1（纵向压扁）, ring = 0（0..1：边缘一圈更深 —— 干掉的水渍、油渍）, color, alpha = 0.4, wrap, seed }
  stain(g, x, y, rad, opts) {
    const o = opts || {};
    const r = seedOf(o, 'stain', x, y);
    const A = U.clamp(num(o.alpha, 0.4), 0, 1), col = c3(o.color != null ? o.color : [70, 62, 48]);
    const lobes = Math.max(1, num(o.lobes, 5) | 0), sq = num(o.squash, 1), ring = U.clamp(num(o.ring, 0), 0, 1);
    const B = [];
    for (let k = 0; k < lobes; k++) {
      const a = r() * TAU, d = k === 0 ? 0 : rad * (0.2 + r() * 0.38);
      B.push([x + Math.cos(a) * d, y + Math.sin(a) * d * sq, rad * (k === 0 ? 0.68 : 0.32 + r() * 0.36)]);
    }
    const per = 1 - Math.pow(1 - A, 1 / Math.min(3, lobes));   // 中心大约叠 2–3 团到目标浓度
    wrapEach(o, x, y, rad * 1.7, (ox, oy) => {
      for (const q of B) {
        const X = q[0] + ox, Y = q[1] + oy, R = q[2];
        // 压扁时连渐变一起压（在变换里建渐变、填充），边缘照样一路淡到 0，不会被椭圆轮廓切出硬边
        g.save(); g.translate(X, Y); g.scale(1, sq);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
        if (ring > 0) {
          gr.addColorStop(0, rgbaS(col, per * (1 - ring * 0.75)));
          gr.addColorStop(0.62, rgbaS(col, per * (1 - ring * 0.55)));
          gr.addColorStop(0.86, rgbaS(col, per));
          gr.addColorStop(0.95, rgbaS(col, per * 0.45));
        } else {
          gr.addColorStop(0, rgbaS(col, per));
          gr.addColorStop(0.45, rgbaS(col, per * 0.72));
          gr.addColorStop(0.8, rgbaS(col, per * 0.25));
        }
        gr.addColorStop(1, rgbaS(col, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        g.restore();
      }
    });
  },
  // 水渍圈：几道错开的环，环线浓、环内很淡、环外淡出（杯底、漏水干掉的圈）。opts: { color, alpha = 0.4, rings = 3, width = 0.14（环宽占半径比例）, wrap, seed }
  ring(g, x, y, rad, opts) {
    const o = opts || {};
    const r = seedOf(o, 'ring', x, y);
    const A = U.clamp(num(o.alpha, 0.4), 0, 1), col = c3(o.color != null ? o.color : [90, 76, 52]);
    const n = Math.max(1, num(o.rings, 3) | 0), wf = U.clamp(num(o.width, 0.14), 0.04, 0.4);
    const per = 1 - Math.pow(1 - A, 1 / Math.min(2, n));
    wrapEach(o, x, y, rad * 1.3, (ox, oy) => {
      for (let k = 0; k < n; k++) {
        const R = rad * (k === 0 ? 1 : 0.7 + r() * 0.35), X = x + ox + (r() - 0.5) * rad * 0.25, Y = y + oy + (r() - 0.5) * rad * 0.25;
        const a = k === 0 ? per : per * (0.35 + 0.4 * r());
        const gr = g.createRadialGradient(X, Y, 0, X, Y, R);
        gr.addColorStop(0, rgbaS(col, a * 0.1));
        gr.addColorStop(Math.max(0.05, 1 - wf * 2.2), rgbaS(col, a * 0.18));
        gr.addColorStop(1 - wf * 0.9, rgbaS(col, a * 0.7));
        gr.addColorStop(1 - wf * 0.45, rgbaS(col, a));
        gr.addColorStop(1, rgbaS(col, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(X, Y, R, 0, TAU); g.fill();
      }
    });
  },
  // 干水印（潮痕）：不规则的一圈 —— 不是正圆。轮廓按 2/3/4/7 次谐波起伏、再叠 11/17 次的小抖（干掉的水边不是光滑曲线）；
  // 环线拆成几段弧，每段两头收尖、粗细浓淡差得多（有的段几乎看不见），各段半径也略有出入（接头处错开成两道，像几次干出来的潮线），
  // 有一两处断口；环线外沿收得快、往里化开；环里几团很淡的湿印（不匀）；里面再偏心地带一小段更淡的第二道（不是同心圆）。
  // 读起来是"一摊干掉的水"，不是"画了一圈线"，两个叠在一起也不会像气泡/玻璃片。
  // rad = 环线中心线的最大半径（整圈都在 rad + 半个线宽以内）。2026-10-02 验收：原来的 'water' 格是两道近乎正圆的同心环
  // opts: { color, alpha = 0.45, lobes = 0.07（轮廓起伏，占半径比例）, width = 0.2（环线全宽占半径比例）, breaks = 2（断口最多几处）,
  //         inner = true（里面的第二道）, fill = 0.22（环内湿印浓度，占 alpha 比例）, squash = 1, wrap, seed }
  tide(g, x, y, rad, opts) {
    const o = opts || {};
    const r = seedOf(o, 'tide', x, y);
    const A = U.clamp(num(o.alpha, 0.45), 0, 1), col = c3(o.color != null ? o.color : [90, 76, 52]);
    const lob = U.clamp(num(o.lobes, 0.07), 0, 0.3), wf = U.clamp(num(o.width, 0.2), 0.04, 0.5), sq = num(o.squash, 1);
    const H = [];
    for (const [h, k] of [[2, 1], [3, 0.7], [4, 0.42], [7, 0.2], [11, 0.1], [17, 0.05]]) H.push([h, lob * (0.4 + 0.6 * r()) * k, r() * TAU]);
    const shape = (th, ph) => { let v = 1; for (const q of H) v += q[1] * Math.sin(q[0] * th + q[2] + ph * q[0]); return v; };
    let smax = 0;
    for (let i = 0; i < 512; i++) smax = Math.max(smax, shape(i / 512 * TAU, 0));
    const FMAX = 1.015;                          // 各段半径系数最大值：整圈仍在 rad 以内
    const R0 = rad / ((smax || 1) * FMAX);
    const at = (th, f, ph) => { const R = R0 * f * shape(th, ph); return [x + Math.cos(th) * R, y + Math.sin(th) * R * sq]; };
    // 一段弧：a0..a1（弧度），半径系数 f，全宽 wid，浓度 al；两头收尖、宽度沿弧在 35%–100% 之间慢慢变
    const arc = (ox, oy, a0, a1, f, ph, wid, al, q1, q2) => {
      const m = Math.max(10, Math.min(96, Math.round(Math.abs(a1 - a0) * R0 / 2.5)));
      const cx = [], cy = [], hw = [], nx = [], ny = [];
      for (let i = 0; i <= m; i++) {
        const t = i / m, p = at(a0 + (a1 - a0) * t, f, ph);
        cx.push(p[0]); cy.push(p[1]);
        hw.push(wid / 2 * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * q1 + q2))) * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.45));
      }
      for (let i = 0; i <= m; i++) {
        const a = Math.max(0, i - 1), b2 = Math.min(m, i + 1);
        const dx = cx[b2] - cx[a], dy = cy[b2] - cy[a], l = Math.hypot(dx, dy) || 1;
        nx.push(-dy / l); ny.push(dx / l);
      }
      const K = Math.max(4, Math.min(14, Math.round(wid * 0.8 + 3)));
      const als = bellAlphas(K, al, 1.6);
      layered(g, { cx, cy, hw, nx, ny }, ox, oy, K, k => rgbaS(col, als[k]));
    };
    // 先把随机数全取好（每个 wrap 副本画的一样）
    const n = 5 + Math.floor(r() * 3), th0 = r() * TAU, bd = [];
    for (let i = 0; i <= n; i++) bd.push(th0 + (i + (i % n ? (r() - 0.5) * 0.5 : 0)) / n * TAU);
    const nb = Math.min(Math.max(0, num(o.breaks, 2) | 0), 1 + (r() < 0.6 ? 1 : 0));
    const gapAt = new Set();   // 有断口的接头
    while (gapAt.size < nb) gapAt.add(Math.floor(r() * n));
    // 第 j 个接头（bd[j]）：相邻两段的收尖端头重叠 ov[j]（够长，接头处不缩成一个细腰）；有断口的接头两段各退 gp[j] / 2，中间真空出一截
    const ov = [], gp = [];
    for (let j = 0; j < n; j++) { ov.push(0.3 + r() * 0.14); gp.push(0.35 + r() * 0.4); }
    const segs = [];
    for (let i = 0; i < n; i++) {
      const j0 = i, j1 = (i + 1) % n;
      const a0 = gapAt.has(j0) ? bd[i] + gp[j0] / 2 : bd[i] - ov[j0];
      const a1 = gapAt.has(j1) ? bd[i + 1] - gp[j1] / 2 : bd[i + 1] + ov[j1];
      segs.push([a0, a1, wf * rad * (0.55 + 0.75 * r()), A * (0.3 + 0.7 * r()), 1 + r() * 2.5, r() * TAU, FMAX - r() * 0.045]);
    }
    const inner = o.inner !== false, ia = r() * TAU, il = 1.4 + r() * 1.8, ifr = 0.74 + r() * 0.1, iph = r() * TAU, iq1 = 1 + r() * 2, iq2 = r() * TAU;
    const fillA = U.clamp(num(o.fill, 0.22), 0, 1) * A;
    const blobs = [];
    for (let k = 0; k < 4; k++) { const a = r() * TAU, d = R0 * (0.15 + r() * 0.35); blobs.push([Math.cos(a) * d, Math.sin(a) * d * sq, R0 * (0.3 + r() * 0.22), 0.5 + r() * 0.5]); }
    wrapEach(o, x, y, rad * 1.3, (ox, oy) => {
      if (fillA > 0) {
        // 环内湿印：按同一轮廓缩小的 10 层极淡的填充叠出来（每层约 1% 不透明度，台阶看不出来），边上自然淡到 0；
        // 再几团径向淡出的湿斑，让里面不是一片匀的灰
        const L = 10, per = 1 - Math.pow(1 - fillA * 0.6, 1 / L);
        for (let k = 0; k < L; k++) {
          const f = 0.97 - k * 0.045;
          g.beginPath();
          for (let i = 0; i < 128; i++) { const p = at(i / 128 * TAU, f, 0); if (i) g.lineTo(p[0] + ox, p[1] + oy); else g.moveTo(p[0] + ox, p[1] + oy); }
          g.closePath();
          g.fillStyle = rgbaS(col, per);
          g.fill();
        }
        for (const q of blobs) {
          const X = x + ox + q[0], Y = y + oy + q[1], gr = g.createRadialGradient(X, Y, 0, X, Y, q[2]);
          gr.addColorStop(0, rgbaS(col, fillA * 0.5 * q[3]));
          gr.addColorStop(0.5, rgbaS(col, fillA * 0.3 * q[3]));
          gr.addColorStop(1, rgbaS(col, 0));
          g.fillStyle = gr;
          g.beginPath(); g.arc(X, Y, q[2], 0, TAU); g.fill();
        }
      }
      for (const q of segs) {
        // 环线：外沿收得快、往里化开 —— 往里挪的一道宽而淡的晕 + 一道窄而浓的核心
        arc(ox, oy, q[0], q[1], q[6] - q[2] / R0 * 0.4, 0, q[2] * 2, q[3] * 0.28, q[4], q[5]);
        arc(ox, oy, q[0], q[1], q[6], 0, q[2], q[3], q[4], q[5]);
      }
      if (inner) arc(ox, oy, ia, ia + il, ifr, iph, wf * rad * 0.5, A * 0.24, iq1, iq2);
    });
  },
  // 滴流水痕：从 (x, y) 往下（+y）流 len 像素，源头最浓，往下越来越细越淡，末端收尖。
  // opts: { width = len×0.07, color, alpha = 0.45, head = true（源头一小团）, wrap, seed }
  drip(g, x, y, len, opts) {
    const o = opts || {};
    const r = seedOf(o, 'drip', x, y);
    const wid = num(o.width, len * 0.07), A = U.clamp(num(o.alpha, 0.45), 0, 1), col = c3(o.color != null ? o.color : [80, 70, 50]);
    const L = centerline(x, y + len / 2, len, Math.PI / 2, (r() - 0.5) * wid * 0.8, wid * 0.12, r, t => {
      const head = Math.min(1, t / 0.06);                       // 顶上圆头
      const tail = t > 0.8 ? Math.pow((1 - t) / 0.2, 0.7) : 1;  // 末端收尖
      return wid / 2 * (1 - 0.5 * t) * Math.sqrt(head) * tail;
    });
    const K = Math.max(4, Math.min(12, Math.round(wid * 0.8 + 3)));
    const al = bellAlphas(K, A, num(o.soft, 1.5));
    wrapEach(o, x, y + len / 2, len / 2 + wid * 2, (ox, oy) => {
      // 每层都是自上而下的线性渐变：上浓下淡（越往下水越少）；横截面钟形
      layered(g, L, ox, oy, K, k => {
        const gr = g.createLinearGradient(0, y + oy, 0, y + oy + len);
        gr.addColorStop(0, rgbaS(col, al[k]));
        gr.addColorStop(0.45, rgbaS(col, al[k] * 0.7));
        gr.addColorStop(1, rgbaS(col, al[k] * 0.08));
        return gr;
      });
    });
    if (o.head !== false) paint.stain(g, x, y + wid * 0.6, wid * 1.3, { color: col, alpha: A * 0.55, lobes: 3, wrap: o.wrap, seed: [o.seed, 'h', x, y].join(':') });
  },
  // 锈迹流痕：源头一块锈斑（螺栓孔、管卡）+ 几道往下流的锈水，宽窄长短不一。opts: { width = len×0.12（源头宽）, count = 4, color, alpha = 0.55, wrap, seed }
  rust(g, x, y, len, opts) {
    const o = opts || {};
    const r = seedOf(o, 'rust', x, y);
    const wid = num(o.width, len * 0.12), A = num(o.alpha, 0.55), col = o.color != null ? o.color : [122, 64, 30];
    paint.stain(g, x, y + wid * 0.3, wid * 0.75, { color: col, alpha: A * 0.8, lobes: 4, squash: 0.8, wrap: o.wrap, seed: [o.seed, 's', x, y].join(':') });
    const n = Math.max(1, num(o.count, 4) | 0);
    for (let k = 0; k < n; k++) {
      const dx = (r() - 0.5) * wid * 0.9, l2 = len * (k === 0 ? 1 : 0.35 + 0.6 * r());
      paint.drip(g, x + dx, y + wid * 0.2, l2, { width: wid * (k === 0 ? 0.55 : 0.2 + 0.25 * r()), color: col, alpha: A * (k === 0 ? 0.85 : 0.5 + 0.4 * r()), head: false, wrap: o.wrap, seed: [o.seed, k, x, y].join(':') });
    }
  },
  // 拖痕：一道宽而淡的抹痕（重物拖过、湿拖把）+ 里面几道顺着方向的细划线。opts: { width = len×0.08, color, alpha = 0.4, streaks = 8, wrap, seed }
  drag(g, x, y, len, ang, opts) {
    const o = opts || {};
    const r = seedOf(o, 'drag', x, y);
    const wid = num(o.width, len * 0.08), A = num(o.alpha, 0.4);
    paint.scratch(g, x, y, len, ang, { width: wid, alpha: A * 0.55, color: o.color, taper: 0.35, bend: (r() - 0.5) * wid * 0.4, wrap: o.wrap, seed: [o.seed, 'b', x, y].join(':') });
    const ca = Math.cos(ang), sa = Math.sin(ang), n = Math.max(0, num(o.streaks, 8) | 0);
    for (let k = 0; k < n; k++) {
      const off = (r() - 0.5) * wid * 0.7, along = (r() - 0.5) * len * 0.25, l2 = len * (0.35 + 0.5 * r());
      paint.scratch(g, x + ca * along - sa * off, y + sa * along + ca * off, l2, ang + (r() - 0.5) * 0.02, {
        width: 1 + r() * 1.6, alpha: A * (0.35 + 0.5 * r()), color: o.color, taper: 0.45, bend: 0, wrap: o.wrap, seed: [o.seed, k, x, y].join(':'),
      });
    }
  },
  // 鞋印：鞋尖朝 −y（图的上方），(x, y) 是鞋印中心，len = 鞋长（像素）。
  // opts: { color, alpha = 0.5, width = 0.38（鞋宽 / 鞋长）, groove（鞋底花纹缝用什么颜色往回盖，缺省不画花纹 —— 一般传底色）, grooveAlpha = 0.6,
  //         tread = 'bars'（横条）| 'chevron'（人字纹，靴子）, wrap, seed }
  footprint(g, x, y, len, opts) {
    const o = opts || {};
    const r = seedOf(o, 'foot', x, y);
    const A = U.clamp(num(o.alpha, 0.5), 0, 1), col = c3(o.color != null ? o.color : [50, 44, 36]);
    const W = len * num(o.width, 0.38), K = 6, al = bellAlphas(K, A, 0.6);   // 外圈几层淡、里面很快到满：边缘软、鞋底实
    // 外轮廓：前掌宽、腰窄、后跟圆；每层往里缩一点 → 边缘软
    const outline = s => {
      const top = y - len / 2, hx = W / 2 * s, ins = (1 - s) * len * 0.12;
      g.beginPath();
      g.moveTo(x, top + ins);
      g.bezierCurveTo(x + hx * 1.05, top + ins, x + hx * 1.1, top + len * 0.32, x + hx * 0.92, top + len * 0.5);
      g.bezierCurveTo(x + hx * 0.7, top + len * 0.62, x + hx * 0.78, top + len * 0.72, x + hx * 0.8, top + len * 0.8);
      g.bezierCurveTo(x + hx * 0.82, y + len / 2 - ins, x - hx * 0.82, y + len / 2 - ins, x - hx * 0.8, top + len * 0.8);
      g.bezierCurveTo(x - hx * 0.72, top + len * 0.7, x - hx * 0.55, top + len * 0.6, x - hx * 0.8, top + len * 0.48);
      g.bezierCurveTo(x - hx * 1.05, top + len * 0.3, x - hx * 0.9, top + ins, x, top + ins);
      g.closePath();
    };
    wrapEach(o, x, y, len * 0.6, (ox, oy) => {
      g.save(); g.translate(ox, oy);
      for (let k = 0; k < K; k++) { outline(1 - k * 0.06); g.fillStyle = rgbaS(col, al[k]); g.fill(); }
      if (o.groove != null) {
        // 鞋底花纹：软缝（两头收尖、横截面钟形），前掌密、后跟疏，足弓那段没有；chevron = 每行一对斜纹拼成人字
        const gc = c3(o.groove), ga = num(o.grooveAlpha, 0.6), chev = o.tread === 'chevron';
        for (let yy = y - len * 0.41; yy < y + len * 0.45; yy += len * (yy < y + len * 0.08 ? 0.078 : 0.1)) {
          if (yy > y + len * 0.1 && yy < y + len * 0.22) continue;
          const sd = [o.seed, yy.toFixed(1), x].join(':');
          if (chev) for (const sx of [-1, 1]) paint.scratch(g, x + sx * W * 0.22, yy, W * 0.46, sx * 0.42, { width: len * 0.04, alpha: ga, color: gc, taper: 0.4, bend: 0, wobble: 0, soft: 1.6, seed: sd + sx });
          else paint.scratch(g, x + (r() - 0.5) * 2, yy, W * 0.95, (r() - 0.5) * 0.12, { width: len * 0.035, alpha: ga, color: gc, taper: 0.35, bend: 0, wobble: 0, soft: 1.6, seed: sd });
        }
      }
      g.restore();
    });
  },
  // 飞溅：中间一团 + 四周大小不一的点和往外甩的短尾巴。opts: { color, alpha = 0.6, drops = 14, wrap, seed }
  splash(g, x, y, rad, opts) {
    const o = opts || {};
    const r = seedOf(o, 'splash', x, y);
    const A = num(o.alpha, 0.6), col = o.color != null ? o.color : [60, 30, 24];
    paint.stain(g, x, y, rad * 0.45, { color: col, alpha: A, lobes: 6, wrap: o.wrap, seed: [o.seed, 'c', x, y].join(':') });
    const n = Math.max(0, num(o.drops, 14) | 0);
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = rad * (0.45 + 0.5 * r()), s = rad * (0.03 + 0.06 * r());
      const X = x + Math.cos(a) * d, Y = y + Math.sin(a) * d;
      if (r() < 0.45) paint.scratch(g, X - Math.cos(a) * s * 2, Y - Math.sin(a) * s * 2, s * 6, a, { width: s * 1.6, alpha: A * 0.8, color: col, taper: 0.8, skew: 1.6, bend: 0, wrap: o.wrap, seed: [o.seed, 't', k].join(':') });
      else paint.stain(g, X, Y, s * 1.4, { color: col, alpha: A * (0.6 + 0.4 * r()), lobes: 1, wrap: o.wrap, seed: [o.seed, 'd', k].join(':') });
    }
  },
};

// 周期值噪声（四向无缝），结果约 0..1。cells 必须整除 size
function pnoise(size, cells, octaves, r, gain) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0, c = cells;
  for (let o = 0; o < octaves && c <= size; o++, c *= 2, amp *= (gain || 0.5)) {
    const G = new Float32Array(c * c);
    for (let i = 0; i < G.length; i++) G[i] = r();
    const k = c / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), r0 = (iy % c) * c, r1 = ((iy + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), c0 = ix % c, c1 = (ix + 1) % c;
        const a = G[r0 + c0] + (G[r0 + c1] - G[r0 + c0]) * sx, b2 = G[r1 + c0] + (G[r1 + c1] - G[r1 + c0]) * sx;
        out[y * size + x] += (a + (b2 - a) * sy) * amp;
      }
    }
    tot += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// 'kit:prop' 的表面纹理（灰度、四向无缝、线性值）：大块明暗起伏 + 细颗粒 + 细划痕（深浅都有）+ 几块磨损 + 麻点，最后把均值平移到 PROP_TEX_MEAN
// 2026-10-02 验收返修：原来的起伏（低频 ±9 级、磨损斑 0.2、90 灰的深划痕）在白板、白暖气片、浅色桌柜上像脏大理石/水泥，
// 整面墙顶用 kit:prop 的层（L18 吊顶、记忆场景的墙和地）还看得出 0.9 m 一格的云斑重复 —— 各层幅度压到原来的 3–4 成，
// 只留"近看不是死板纯色"的细颗粒和很淡的细划痕；大面另外整件退回纯色（见 Builder._piece 的 grain、fillUV）。
// 'solid' 纹素（WHITE_UV，512² 上约 (193, 193)）周围半径 22 px 内精确等于均值，22–48 px 平滑过渡回纹理：
// uv:'solid' 和退回纯色的件采到的就是均值 → 和没贴图之前的底色完全一样（不会随机偏亮偏暗）
const GRAIN_FLAT_R0 = 22 / 512, GRAIN_FLAT_R1 = 48 / 512;
function drawPropGrain(g, s) {
  const r = U.rng('kit-prop-grain');
  // 噪声先归一到 0 均值、单位标准差，幅度直接按"灰度级"给（远处 mipmap 平均后还剩得下来的是低频那层，所以低频给得最多）
  const norm = a => {
    let m = 0, v = 0;
    for (let i = 0; i < a.length; i++) m += a[i];
    m /= a.length;
    for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    const sd = Math.sqrt(v / a.length) || 1;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / sd;
    return a;
  };
  const low = norm(pnoise(s, 4, 3, r, 0.55)), mid = norm(pnoise(s, 32, 2, r, 0.5));
  const img = g.createImageData(s, s), d = img.data, base = PROP_TEX_MEAN * 255;
  // 随机数的取用顺序和次数与改之前一样（只改幅度、少画一半划痕），图案位置不变
  for (let i = 0; i < s * s; i++) {
    const v = base + low[i] * 3.5 + mid[i] * 2.6 + (r() - 0.5) * 6;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const k = s / 512;
  // 磨损斑：手常摸的地方发亮、积灰的地方发暗（软边径向渐变）—— 很淡，只让大块面不那么"塑料"
  for (let n = 0; n < 18; n++) {
    const light = r() < 0.45;
    paint.stain(g, r() * s, r() * s, (26 + r() * 64) * k, { color: light ? [255, 255, 255] : [170, 170, 170], alpha: light ? 0.07 : 0.06, lobes: 4, wrap: s, seed: 'pw' + n });
  }
  // 细划痕：深浅都有，两头尖、横截面钟形。只画一半；深色的不再是 90 灰（白色件上那是一道道脏线）
  for (let n = 0; n < 110; n++) {
    const light = r() < 0.35;
    const x = r() * s, y = r() * s, len = (10 + r() * 80) * k, ang = r() * TAU;
    const wid = (1.2 + r() * 2) * k, al = light ? 0.3 + r() * 0.25 : 0.16 + r() * 0.18;
    if (n % 2) continue;
    paint.scratch(g, x, y, len, ang, { width: wid, alpha: al * (light ? 0.45 : 0.4), color: light ? [255, 255, 255] : [140, 140, 140], wrap: s, seed: 'ps' + n });
  }
  // 麻点
  for (let n = 0; n < 700; n++) {
    const x = r() * s, y = r() * s, rr = (0.7 + r() * 1.3) * k;
    g.fillStyle = 'rgba(140,140,140,' + ((0.1 + r() * 0.14) * 0.6).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  // 'solid' 纹素周围压平到均值（权重 w：r0 内 = 1，r0–r1 smoothstep 到 0），再做均值归一：
  // 只平移不缩放，平移量按 (1 − w) 分摊 —— 压平区精确等于 base，整张的均值也精确等于 base
  const im = g.getImageData(0, 0, s, s), q = im.data;
  const fx = WHITE_UV[0] * s, fy = (1 - WHITE_UV[1]) * s, r0 = GRAIN_FLAT_R0 * s, r1 = GRAIN_FLAT_R1 * s;
  const wt = new Float32Array(s * s), val = new Float32Array(s * s);
  let sum = 0, free = 0;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x, dd = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
    const t = U.clamp((dd - r0) / (r1 - r0), 0, 1), w = 1 - t * t * (3 - 2 * t);
    val[i] = q[i * 4] * (1 - w) + base * w; wt[i] = w;
    sum += val[i]; free += 1 - w;
  }
  const off = (base * s * s - sum) / (free || 1);
  for (let i = 0; i < s * s; i++) {
    const v = Math.max(0, Math.min(255, Math.round(val[i] + off * (1 - wt[i]))));
    q[i * 4] = q[i * 4 + 1] = q[i * 4 + 2] = v; q[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}

// ---------- 贴花图集（512²，白 = 不透明、黑 = 透明；alphaMap 读 g 通道）----------
// 每格四周留 ≥ 4 px 黑边，mipmap 往下几级才会和邻格混（那时贴花只剩几个像素）。
// 长条格（刮痕类）横放：贴到面上 w 沿长度、h 沿宽度。竖条格（滴流、锈迹）源头在上
const DECAL_ATLAS = 512;
const DECAL_KINDS = {
  // cells: 格子 [x, y, w, h]（像素，多个 = 变体）；size: 缺省尺寸 [w, h] 米；color: 缺省颜色（屏幕色）；opacity: 缺省不透明度；upright: 撒在立面上时保持竖直
  scratch:   { cells: [[0, 0, 512, 32], [0, 32, 512, 32], [0, 64, 512, 32]], size: [0.6, 0.026], color: 0x3b3833, opacity: 0.6 },
  hairline:  { cells: [[0, 96, 512, 32]], size: [0.5, 0.02], color: 0x34312c, opacity: 0.5 },
  scuff:     { cells: [[0, 128, 512, 64]], size: [0.45, 0.056], color: 0x3b3833, opacity: 0.55 },
  drag:      { cells: [[0, 192, 512, 64]], size: [1.2, 0.15], color: 0x35302a, opacity: 0.45 },
  drip:      { cells: [[0, 256, 64, 256]], size: [0.15, 0.6], color: 0x4e4434, opacity: 0.5, upright: true },
  rust:      { cells: [[64, 256, 64, 256]], size: [0.18, 0.72], color: 0x7a4322, opacity: 0.65, upright: true },
  footprint: { cells: [[128, 256, 64, 128], [192, 256, 64, 128]], size: [0.12, 0.24], color: 0x2e2a24, opacity: 0.5 },
  splash:    { cells: [[128, 384, 128, 128]], size: [0.5, 0.5], color: 0x3c2a22, opacity: 0.6 },
  stain:     { cells: [[256, 256, 128, 128], [384, 256, 128, 128]], size: [0.5, 0.5], color: 0x4e4636, opacity: 0.45 },
  // 第 2 个变体是同一格"转置"采样（格子第 5 项 = 1：沿对角线镜像 = 转 90° 再左右翻）：图集已经排满，不多占显存；
  // 潮痕本身不对称（轮廓起伏、断口、偏心的第二道都不在对称位置），转置后是另一个形状 —— 两圈叠在一起不会是同一个轮廓平移
  water:     { cells: [[256, 384, 128, 128], [256, 384, 128, 128, 1]], size: [0.6, 0.6], color: 0x5c5546, opacity: 0.5 },
  oil:       { cells: [[384, 384, 128, 128]], size: [0.5, 0.5], color: 0x161412, opacity: 0.6 },
};
function drawDecalAtlas(g, S) {
  const k = S / DECAL_ATLAS;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const W = [255, 255, 255];
  const cell = (rect, fn) => {
    const x = rect[0] * k, y = rect[1] * k, w = rect[2] * k, h = rect[3] * k;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    fn(x, y, w, h);
    g.restore();
  };
  const C = DECAL_KINDS;
  // 刮痕三种：微弯两头尖 / 一头粗一头细 / 断成两截
  // 横截面都是钟形（soft 2）：格子 32 px 高、刮痕全宽 22 px，核心约 12 px、两侧各 5 px 一路淡到 0
  cell(C.scratch.cells[0], (x, y, w, h) => paint.scratch(g, x + w / 2, y + h / 2, w - 20 * k, 0, { width: 22 * k, alpha: 0.97, color: W, bend: 1.5 * k, wobble: 0.8 * k, taper: 0.6, seed: 'a0' }));
  cell(C.scratch.cells[1], (x, y, w, h) => paint.scratch(g, x + w / 2, y + h / 2, w - 20 * k, 0.008, { width: 22 * k, alpha: 0.97, color: W, bend: -2 * k, wobble: 0.8 * k, taper: 0.55, skew: 0.7, seed: 'a1' }));
  cell(C.scratch.cells[2], (x, y, w, h) => {
    paint.scratch(g, x + w * 0.3, y + h / 2 + 1 * k, w * 0.54, -0.008, { width: 20 * k, alpha: 0.95, color: W, bend: 1.5 * k, wobble: 0.8 * k, seed: 'a2' });
    paint.scratch(g, x + w * 0.76, y + h / 2 - 1 * k, w * 0.4, 0.012, { width: 16 * k, alpha: 0.85, color: W, bend: -1 * k, wobble: 0.6 * k, seed: 'a3' });
  });
  cell(C.hairline.cells[0], (x, y, w, h) => paint.scratch(g, x + w / 2, y + h / 2, w - 16 * k, 0.006, { width: 10 * k, alpha: 0.95, color: W, bend: 3 * k, wobble: 0.6 * k, taper: 0.5, seed: 'h0' }));
  cell(C.scuff.cells[0], (x, y, w, h) => paint.scuff(g, x + w / 2, y + h / 2, w - 70 * k, 0, { spread: 34 * k, count: 8, width: 7 * k, alpha: 0.95, color: W, seed: 's0' }));
  cell(C.drag.cells[0], (x, y, w, h) => paint.drag(g, x + w / 2, y + h / 2, w - 24 * k, 0, { width: 46 * k, alpha: 0.95, color: W, streaks: 10, seed: 'd0' }));
  cell(C.drip.cells[0], (x, y, w, h) => {
    paint.drip(g, x + w / 2, y + 8 * k, h - 16 * k, { width: 20 * k, alpha: 0.95, color: W, seed: 'p0' });
    paint.drip(g, x + w / 2 + 12 * k, y + 14 * k, (h - 16 * k) * 0.55, { width: 9 * k, alpha: 0.75, color: W, head: false, seed: 'p1' });
  });
  cell(C.rust.cells[0], (x, y, w, h) => paint.rust(g, x + w / 2, y + 10 * k, h - 20 * k, { width: 34 * k, count: 5, alpha: 0.97, color: W, seed: 'r0' }));
  cell(C.footprint.cells[0], (x, y, w, h) => paint.footprint(g, x + w / 2, y + h / 2, h - 12 * k, { alpha: 0.95, color: W, groove: [0, 0, 0], grooveAlpha: 0.6, seed: 'f0' }));
  // 第二种：靴子印 —— 更宽、人字纹
  cell(C.footprint.cells[1], (x, y, w, h) => paint.footprint(g, x + w / 2, y + h / 2, h - 12 * k, { alpha: 0.95, color: W, width: 0.42, groove: [0, 0, 0], grooveAlpha: 0.65, tread: 'chevron', seed: 'f1' }));
  cell(C.splash.cells[0], (x, y, w, h) => paint.splash(g, x + w / 2, y + h / 2, w * 0.44, { alpha: 0.97, color: W, drops: 16, seed: 'x0' }));
  cell(C.stain.cells[0], (x, y, w, h) => paint.stain(g, x + w / 2, y + h / 2, w * 0.36, { alpha: 0.95, color: W, lobes: 6, seed: 'st0' }));
  cell(C.stain.cells[1], (x, y, w, h) => {
    paint.stain(g, x + w * 0.46, y + h * 0.5, w * 0.3, { alpha: 0.85, color: W, lobes: 7, squash: 0.8, seed: 'st1' });
    paint.stain(g, x + w * 0.68, y + h * 0.62, w * 0.14, { alpha: 0.7, color: W, lobes: 3, seed: 'st2' });
  });
  // 水渍：不规则潮痕（2026-10-02 验收：原来 3 道近乎正圆的同心环，地漏一圈和水坑外圈叠在一起像两个气泡）。
  // 中心线最大半径 0.41 格宽 + 半个线宽 ≤ 0.46 格宽，四周留 ≥ 5 px 黑边
  cell(C.water.cells[0], (x, y, w, h) => paint.tide(g, x + w / 2, y + h / 2, w * 0.41, { alpha: 0.97, color: W, lobes: 0.075, width: 0.19, seed: 'w0' }));
  // 油渍：一大团实心的软斑 + 外面一圈很淡的晕（油往外渗）
  cell(C.oil.cells[0], (x, y, w, h) => {
    paint.ring(g, x + w / 2, y + h / 2, w * 0.45, { alpha: 0.3, color: W, rings: 1, width: 0.3, seed: 'o1' });
    paint.stain(g, x + w / 2, y + h / 2, w * 0.36, { alpha: 0.97, color: W, lobes: 6, seed: 'o0' });
  });
}

if (BR.assets && typeof BR.assets.registerProcedural === 'function') {
  BR.assets.registerProcedural(PROP_TEX, 512, drawPropGrain, { noFile: true });
  BR.assets.registerProcedural(DECAL_TEX, DECAL_ATLAS, drawDecalAtlas, { noFile: true });
}

// =====================================================================
// 贴花 BR.kit.decal(b, opts) → Piece | null
// =====================================================================
// 往墙面/地面/天花板/道具表面贴一片软边印记。一块区块里所有贴花合成 1 个 mesh（'kit:decal'），每片 2 个三角形。
// opts: { kind, x, y, z（当前坐标系下贴花中心，就在表面上）, facing: '+z'|'-z'|'+x'|'-x'|'up'|'down' 或 normal: [nx,ny,nz],
//         w, h（米；只给一个就按格子比例算另一个；scale 乘缺省尺寸）, rot（面内旋转，弧度，正 = 从正面看逆时针）,
//         color（屏幕色 hex，按 sRGB 解码；srgb: false 时和 kit:prop 一样直接当顶点色）, opacity, variant, flip（左右镜像）, flipV,
//         offset = 0.004（离表面多远，米）, essential（低画质也画，低画质每块最多 8 片）, detail }
// 低画质、detail === false、本块到了 DETAIL_TRI_CAP：返回 null 不画（essential 除外）。不消耗任何 rng：变体缺省按位置哈希挑
const DECAL_CAP = 120, DECAL_CAP_LOW = 8;
const DECAL_FRAMES = {
  '+z': [[0, 0, 1], [1, 0, 0], [0, 1, 0]], '-z': [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  '+x': [[1, 0, 0], [0, 0, -1], [0, 1, 0]], '-x': [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  up: [[0, 1, 0], [1, 0, 0], [0, 0, -1]], down: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
};
function srgbLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function decal(b, opts) {
  const o = opts || {};
  const kind = o.kind || 'stain';
  const K = DECAL_KINDS[kind];
  if (!K) { warnOnce('decal-kind:' + kind, '贴花种类 "' + kind + '" 不存在，可用：' + Object.keys(DECAL_KINDS).join(' ')); return null; }
  const low = !!(BR.game && BR.game.settings && BR.game.settings.quality === 'low');
  if (o.essential) {
    if (o.detail === false || o.detail === 'low') return null;
    b._decalE = (b._decalE || 0) + 1;
    if (low && b._decalE > DECAL_CAP_LOW) return null;
  } else if (!hiDetail(b, o)) return null;
  b._decalN = (b._decalN || 0) + 1;
  if (b._decalN > DECAL_CAP && !o.essential) { warnOnce('decal-cap', '一块区块贴花超过 ' + DECAL_CAP + ' 片，后面的不画了'); return null; }
  // 朝向：表 + 面内旋转
  let n, rt, up;
  if (Array.isArray(o.normal)) {
    const l = Math.hypot(o.normal[0], o.normal[1], o.normal[2]) || 1;
    n = [o.normal[0] / l, o.normal[1] / l, o.normal[2] / l];
    if (Math.abs(n[1]) > 0.95) { rt = [1, 0, 0]; up = n[1] > 0 ? [0, 0, -1] : [0, 0, 1]; }
    else {
      const rl = Math.hypot(n[2], n[0]) || 1;
      rt = [n[2] / rl, 0, -n[0] / rl];                                                                // 世界上方 × n
      up = [n[1] * rt[2] - n[2] * rt[1], n[2] * rt[0] - n[0] * rt[2], n[0] * rt[1] - n[1] * rt[0]];   // n × rt
    }
  } else {
    const F = DECAL_FRAMES[o.facing || '+z'] || DECAL_FRAMES['+z'];
    n = F[0]; rt = F[1]; up = F[2];
  }
  const rot = num(o.rot, 0), cr = Math.cos(rot), sr = Math.sin(rot);
  const R = [cr * rt[0] + sr * up[0], cr * rt[1] + sr * up[1], cr * rt[2] + sr * up[2]];
  const V = [-sr * rt[0] + cr * up[0], -sr * rt[1] + cr * up[1], -sr * rt[2] + cr * up[2]];
  // 尺寸
  const sc = num(o.scale, 1), ratio = K.size[1] / K.size[0];
  let w = num(o.w, NaN), h = num(o.h, NaN);
  if (!(w > 0) && !(h > 0)) { w = K.size[0] * sc; h = K.size[1] * sc; }
  else if (!(h > 0)) h = w * ratio;
  else if (!(w > 0)) w = h / ratio;
  // 变体：缺省按位置哈希（不吃 rng）
  const p0 = b.point(num(o.x, 0), num(o.z, 0));
  const vi = o.variant != null ? Math.abs(o.variant | 0) % K.cells.length
    : Math.floor(hash01(Math.round((b.ox + p0.x) * 100), Math.round((b.oz + p0.z) * 100), Math.round(num(o.y, 0) * 100) + 777) * K.cells.length) % K.cells.length;
  const cellR = K.cells[vi], S = DECAL_ATLAS, e = 0.5;   // 往里缩半个纹素，不采到邻格
  let u0 = (cellR[0] + e) / S, u1 = (cellR[0] + cellR[2] - e) / S, vT = 1 - (cellR[1] + e) / S, vB = 1 - (cellR[1] + cellR[3] - e) / S;
  if (o.flip) { const t0 = u0; u0 = u1; u1 = t0; }
  if (o.flipV) { const t0 = vT; vT = vB; vB = t0; }
  // 颜色：屏幕色 → 线性（和贴图一样），写的 hex 就是灯下看到的颜色
  const c0 = rgb(o.color != null ? o.color : K.color);
  const col = o.srgb === false ? c0 : [srgbLin(c0[0]), srgbLin(c0[1]), srgbLin(c0[2])];
  const off = num(o.offset, 0.004);
  const cx = num(o.x, 0) + n[0] * off, cy = num(o.y, 0) + n[1] * off, cz = num(o.z, 0) + n[2] * off;
  const hw = w / 2, hh = h / 2;
  return b._piece('kit:decal', 0, 0, 0, 0, (v, t) => {
    const P = (a, c) => [cx + R[0] * a + V[0] * c, cy + R[1] * a + V[1] * c, cz + R[2] * a + V[2] * c];
    // 格子第 5 项 = 1（只给正方形格用）：转置采样，u 沿贴花的"上"、v 沿"右"
    const q = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
    const uv = cellR[4] ? [[u0, vB], [u0, vT], [u1, vT], [u1, vB]] : [[u0, vB], [u1, vB], [u1, vT], [u0, vT]];
    for (let i = 0; i < 4; i++) v(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1]);
    t(0, 1, 2); t(0, 2, 3);
  }, { uv: 'stretch', color: col, alpha: U.clamp(num(o.opacity, K.opacity), 0, 1), solid: false });
}

// 在一组矩形面上按密度撒贴花（墙面、地面、天花板都行）。随机数只用派生流 U.rng(b.seed, salt, b.cx, b.cz)：
// 不吃区块 rng（加贴花不会让后面的灯/地标挪位）；低画质照样把随机数算一遍（只是 decal 不画），两种画质的流消耗完全一样。
// surfaces: [{ x, y, z, facing, w, h }]（面中心 + 沿贴花 right/up 的宽高，当前坐标系）—— kit.gridWalls(...).faces 直接能用。
// opts: { salt（必填，带层级前缀）, kinds: ['scratch'] 或 [['scratch', 3], ['stain', 1]]（权重）, per = 0.2（每平方米几片）, max = 40（这次最多几片）,
//         y: [y0, y1]（立面上贴花中心的绝对高度范围）, margin = 0.2（离面边缘）, size: [0.7, 1.3]（尺寸倍率范围）,
//         rot（立面缺省 ±0.3 弧度抖动、upright 类不转；地面/天花板缺省任意角；数字 = ±rot，[lo, hi] = 范围）,
//         color, opacity（数字或 [lo, hi]）, flip（缺省随机）, essential }
// 返回实际画了几片
function scatterDecals(b, surfaces, opts) {
  const o = opts || {};
  const r = U.rng(b.seed, String(o.salt || 'kit-decal'), b.cx, b.cz);
  const kinds = (o.kinds || ['stain']).map(k => (Array.isArray(k) ? k : [k, 1]));
  const tot = kinds.reduce((s, k) => s + Math.max(0, +k[1] || 0), 0) || 1;
  const pick = x => { let a = x * tot; for (const k of kinds) { a -= Math.max(0, +k[1] || 0); if (a < 0) return k[0]; } return kinds[kinds.length - 1][0]; };
  const per = num(o.per, 0.2), max = num(o.max, 40) | 0, margin = num(o.margin, 0.2);
  const sz = Array.isArray(o.size) ? o.size : [0.7, 1.3];
  let made = 0, tried = 0;
  for (const s of surfaces || []) {
    const vertical = s.facing !== 'up' && s.facing !== 'down';
    let lo = -s.h / 2 + margin, hi = s.h / 2 - margin;   // 沿面 up 方向的范围（相对面中心）
    if (vertical && Array.isArray(o.y)) { lo = Math.max(lo, o.y[0] - s.y); hi = Math.min(hi, o.y[1] - s.y); }
    const area = Math.max(0, s.w - margin * 2) * Math.max(0, hi - lo);
    const want = area * per, frac0 = r(), cnt = Math.floor(want) + (frac0 < want - Math.floor(want) ? 1 : 0);
    const F = DECAL_FRAMES[s.facing] || DECAL_FRAMES['+z'];
    for (let k = 0; k < cnt && tried < max; k++) {
      const kind = pick(r());
      const K = DECAL_KINDS[kind] || DECAL_KINDS.stain;
      const m = sz[0] + (sz[1] - sz[0]) * r();
      const dw = K.size[0] * m, dh = K.size[1] * m;
      const a = (r() - 0.5) * Math.max(0, s.w - margin * 2 - dw), c = lo + dh / 2 + r() * Math.max(0, hi - lo - dh);
      const rr = r(), fl = r() < 0.5, op = r();
      const rot = o.rot != null ? (Array.isArray(o.rot) ? o.rot[0] + (o.rot[1] - o.rot[0]) * rr : (rr - 0.5) * 2 * o.rot)
        : vertical ? (K.upright ? 0 : (rr - 0.5) * 0.6) : rr * TAU;
      const opacity = Array.isArray(o.opacity) ? o.opacity[0] + (o.opacity[1] - o.opacity[0]) * op : o.opacity;
      tried++;
      const x = s.x + F[1][0] * a + F[2][0] * c, y = s.y + F[1][1] * a + F[2][1] * c, z = s.z + F[1][2] * a + F[2][2] * c;
      if (decal(b, { kind, x, y, z, facing: s.facing, w: dw, h: dh, rot, flip: o.flip != null ? o.flip : fl, color: o.color, opacity, essential: o.essential })) made++;
    }
    if (tried >= max) break;
  }
  return made;
}

const prop = {
  lightPanel, ceiling, floor, baseboard, door, stairwell, elevator, vent, pipe, puddle,
  box, crate, desk, chair, cubicle, window: windowProp, vending, bed, cabinet, streetlight, fence,
  pillar, sign, hole, wallWithOpening,
};

// =====================================================================
// 出口（实物 + 描述）
// =====================================================================
// 范围外（不在 LEVEL_ORDER、也不是 dev）自动 sealed：实物照摆，world 只提示"Level X 尚未开放"，绝不改道
function exit(b, opts) {
  let o = opts || {};
  // 工坊钩子：每次调用按顺序编个稳定 key（区块生成只吃 rng，调用顺序固定，联机两边算出的 key 一样）。
  // exitOverride 返回 null → 这个出口整个不建；返回新 opts → 按新的建；返回 undefined（含未激活工坊地图）→ 不变
  const wsN = (b._wsExitN = (b._wsExitN || 0) + 1);
  const wsKey = (b.level ? b.level.id : '') + '@' + b.cx + ',' + b.cz + '#' + wsN;
  if (BR.workshop && typeof BR.workshop.exitOverride === 'function') {
    const ov = BR.workshop.exitOverride(b, wsKey, o);
    if (ov === null) return null;
    if (ov !== undefined) o = ov;
  }
  const kind = o.kind || 'zone';
  const x = num(o.x, 0), z = num(o.z, 0), rot = num(o.rot, 0);
  const parts = {};
  let tx = 0, tz = 0, radius = num(o.radius, 1);   // 触发点（构件本地坐标，正面朝 +Z）

  b.push(x, z, rot);
  if (kind === 'door') {
    Object.assign(parts, prop.door(b, 0, 0, 0, Object.assign({}, o.door, { style: o.style || (o.door && o.door.style), open: 0 })));
    tz = 0.7; radius = num(o.radius, 0.8);
  } else if (kind === 'stairs') {
    const down = !(o.stairs && o.stairs.down === false);
    Object.assign(parts, prop.stairwell(b, 0, 0, 0, o.stairs));
    tz = down ? -0.9 : -0.4; radius = num(o.radius, 0.8);
  } else if (kind === 'elevator') {
    Object.assign(parts, prop.elevator(b, 0, 0, 0, o.elevator));
    tz = 0.75; radius = num(o.radius, 0.85);
  } else if (kind === 'noclip') {
    Object.assign(parts, noclipPatch(b, o));
    radius = num(o.radius, 0.9);
  } else if (kind === 'hole') {
    const r = num(o.hole && o.hole.r, 1.1);
    Object.assign(parts, prop.hole(b, 0, 0, 0, Object.assign({ r }, o.hole)));
    radius = num(o.radius, r * 0.75);
  } else if (kind === 'zone') {
    if (o.marker) parts.marker = zoneMarker(b, radius, o.marker);
  }
  // 'event'：只有描述，实物由层级自己搭（可配合 piece.setVisible）
  const h = b.exit({
    x: tx, z: tz, y: o.y, radius, to: o.to, kind, label: o.label, sealed: o.sealed,
    sealedText: o.sealedText, active: o.active, tag: o.tag,
  });
  b.pop();
  h.parts = parts;
  h.desc.key = wsKey;   // 出口描述带上 key（第 4 节）：工坊靠它认哪个出口被移动/删除/是自己加的
  return h;
}

// 地上的发光圈：{ color: [r,g,b], pulse: true }，脉动走顶点色，不多 mesh
function zoneMarker(b, radius, m) {
  const cfg = m === true ? {} : m;
  const base = rgb(cfg.color != null ? cfg.color : [0.35, 1.5, 1.25]);
  const rin = radius * 0.83, rout = radius * 1.05;
  const g = new THREE.RingGeometry(rin, rout, 32, 1);
  g.rotateX(-Math.PI / 2);
  const piece = b.mesh(g, 'kit:glow', { y: 0.02, uv: 'solid', color: base });
  g.dispose();
  if (cfg.pulse !== false) {
    b.update((dt, t) => piece.setColor(base, 0.7 + 0.3 * Math.sin(t * 3.2)));
  }
  return piece;
}

// 切出墙：一段不带碰撞体的墙，独立 mesh 按时间哈希轻微错位、偶尔闪没，玩家贴上去就触发。
// 放在格子的开口上（grid.setWall(axis, i, j, false) 先拆掉那段墙），外观用层级的墙材质才像"墙在闪"
function noclipPatch(b, o) {
  const w = num(o.w, 1.4), h = num(o.h, b.height), t = num(o.thickness, 0.2);
  const key = o.matKey || 'kit:prop';
  // 先按区块本地坐标算好顶点（world UV 与真墙对齐），再搬进独立 mesh
  const tmp = new Builder(b.ctx, b.cx, b.cz, b.rng, { height: b.height });
  tmp._T = b._T;
  tmp._wsHelper = true;   // 内部一次性小 builder，不是这块区块真正的 builder：finish() 时不重复跑工坊 decorate
  tmp.box(0, 0, 0, w, h, t, key, { faces: 'all', solid: false, color: o.color });
  const r = tmp.finish();
  const mesh = r.group.children[0];
  if (!mesh) return {};
  r.group.remove(mesh);
  mesh.matrixAutoUpdate = true;
  mesh.name = 'noclip';
  // tmp 的 group 在 (ox,0,oz)，mesh 自身坐标就是区块本地坐标；object() 会再做一次坐标系变换，这里绕开直接登记
  b._objects.push(mesh);
  const nrm = { x: b._T.s, z: b._T.c };                          // 当前坐标系 +Z 在区块里的方向
  const tan = { x: b._T.c, z: -b._T.s };
  const seed = U.hashInts(b.seed, 'noclip', b.cx, b.cz, Math.round(b._T.x * 10), Math.round(b._T.z * 10));
  const glitch = num(o.glitch, 1);
  b.update((dt, time) => {
    const slot = Math.floor(time * 12);
    const e = U.hashInts(seed, slot) / 4294967296;
    // 大部分时间几乎静止，偶尔抽一下：越像真墙，越像"墙有问题"
    const burst = e < 0.18 * glitch;
    const a = burst ? 0.05 : 0.008;
    const du = (U.hashInts(seed, slot, 1) / 4294967296 - 0.5) * 2 * a;
    const dn = (U.hashInts(seed, slot, 2) / 4294967296 - 0.5) * 2 * a * 0.6;
    mesh.position.set(tan.x * du + nrm.x * dn, 0, tan.z * du + nrm.z * dn);
    mesh.visible = !(burst && e < 0.03 * glitch);
  });
  return { mesh };
}

// =====================================================================
// 高度场
// =====================================================================
// 多层结构/坡道：层级在 enter 里 BR.kit.heightField(fn).install()；phys/玩家/实体/物品都读 BR.phys.groundY
function heightField(fn) {
  const f = function (x, z) {
    const y = fn(x, z);
    return typeof y === 'number' && isFinite(y) ? y : NaN;   // NaN → phys 退回 0
  };
  f.at = (x, z) => { const y = f(x, z); return y === y ? y : 0; };
  f.install = () => { if (BR.phys && typeof BR.phys.setGroundFn === 'function') BR.phys.setGroundFn(f); return f; };
  return f;
}
// 矩形坡道：axis 方向从 y0 线性升到 y1；矩形外返回 undefined（交给下一个）
heightField.ramp = function (r) {
  return (x, z) => {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return undefined;
    const t = r.axis === 'z' ? (z - r.minZ) / ((r.maxZ - r.minZ) || 1) : (x - r.minX) / ((r.maxX - r.minX) || 1);
    return r.y0 + (r.y1 - r.y0) * t;
  };
};
heightField.flat = function (r) {
  return (x, z) => (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) ? undefined : r.y;
};
// 依次尝试，第一个给出有限数的生效
heightField.stack = function () {
  const fns = Array.prototype.slice.call(arguments);
  return (x, z) => {
    for (let i = 0; i < fns.length; i++) {
      const y = fns[i](x, z);
      if (typeof y === 'number' && isFinite(y)) return y;
    }
    return undefined;
  };
};

// 已载入区块里的出口句柄（事件型出口在 level.update 里找它们）。filter: { kind, to, tag }
function handles(filter) {
  const f = filter || {};
  const out = [];
  const list = BR.world && typeof BR.world.chunks === 'function' ? BR.world.chunks() : [];
  for (let i = 0; i < list.length; i++) {
    const k = list[i].res && list[i].res.kit;
    if (!k || !k.exits) continue;
    for (const h of k.exits) {
      if (f.kind && h.kind !== f.kind) continue;
      if (f.to != null && h.to !== normId(f.to)) continue;
      if (f.tag != null && h.desc.tag !== f.tag) continue;
      out.push(h);
    }
  }
  return out;
}

// 踢脚线预设。yellowWood：黄色墙纸房间用的黄色木质矮踢脚线（用户指定：黄色、木质、矮一点）。
// 用 getter 是为了第一次取用时才建材质 —— 脚本加载时贴图系统可能还没初始化
const TRIMS = {
  get yellowWood() {
    mat('kit:trim_wood_yellow', { tex: 'baseboard_wood', repeatMeters: 0.9, roughness: 0.65 });
    return { h: 0.07, t: 0.018, color: 0xffffff, matKey: 'kit:trim_wood_yellow' };
  },
};

BR.kit = {
  version: KIT_VERSION,
  DEFAULT_HEIGHT,
  WHITE_UV,                      // 只读：tests/kit.mjs 检查这个纹素够白

  builder: (ctx, cx, cz, rng, opts) => new Builder(ctx, cx, cz, rng, opts),
  Builder,
  mat, mats,
  grid, gridWalls, gridSpawns,
  prop,
  trims: TRIMS,
  exit,
  handles,
  heightField,
  // 2026-10-01 材质细化：软边贴花、程序贴图画笔、预算常量（写法见 _TEMPLATE.md 第 5.4 / 8 / 15 / 16 节）
  decal,
  scatterDecals,
  paint,
  decalKinds: Object.keys(DECAL_KINDS),
  decalInfo: kind => { const K = DECAL_KINDS[kind]; return K ? { variants: K.cells.length, size: K.size.slice(), color: K.color, opacity: K.opacity, upright: !!K.upright } : null; },
  budget: { trisHigh: 10000, trisLow: 8000, detailCap: DETAIL_TRI_CAP, meshes: 8, drawCalls: 120, decalsPerChunk: DECAL_CAP, decalsLowEssential: DECAL_CAP_LOW },
  PROP_TEX, DECAL_TEX,
  rgb,
  levelId: normId,
  levelName,
  inRange,
  // 层级 id → data/lore-choices.json 里 levels 的键（Level ! 在代码里叫 'run'，调研里叫 '!'）
  loreKey: id => (String(id) === 'run' ? '!' : String(id)),
};
})();
