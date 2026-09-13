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
const BUILTIN = {
  // 构件统一用顶点色的无贴图材质：一块里所有桌椅柜子合成一个 mesh，draw call 不随构件种类增长
  'kit:prop':  { type: 'phong', vertexColors: true, shininess: 12, specular: 0x1a1a1a },
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
  const p = {
    color: def.color != null ? def.color : (map ? 0xffffff : 0xcccccc),
    vertexColors: !!def.vertexColors,
    transparent: !!def.transparent,
    opacity: num(def.opacity, 1),
    side: sideOf(def.side),
    fog: def.fog !== false,
  };
  if (map) p.map = map;
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
  this.n = 0;
  this.pieces = [];
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
    const self = this;
    // fill 回调里调 v(x,y,z,nx,ny,nz,u,v) 追加顶点、t(a,b,c) 追加三角形（索引相对本件）
    fill(function v(px, py, pz, nx, ny, nz, uu, vv) {
      a.pos.push(bx + c * px + s * pz, by + py, bz - s * px + c * pz);
      a.nor.push(c * nx + s * nz, ny, -s * nx + c * nz);
      a.uv.push(uu, vv);
      a.col.push(col[0], col[1], col[2]);
      a.n++;
    }, function t(i0, i1, i2) {
      a.idx.push(start + i0, start + i1, start + i2);
    });
    const piece = new Piece(a, start, a.n - start, o.uv || 'world', o.uvScale, o.uvRepeat);
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
  box(x, y, z, w, h, d, matKey, opts) {
    const o = opts || {};
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
    if (axis === 'y') g.translate(0, h / 2, 0);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    else g.rotateX(Math.PI / 2);
    const uvScale = [TAU * r, h];
    const piece = this.mesh(g, matKey, Object.assign({}, o, {
      x, y, z, solid: o.solid != null ? o.solid : axis === 'y',
      uv: (o.uv || 'world') === 'world' ? 'scaled' : o.uv, uvScale,
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
    return this._piece(matKey, num(o.x, 0), num(o.y, 0), num(o.z, 0), num(o.rotY, 0), (v, t) => {
      for (let i = 0; i < P.count; i++) {
        v(P.getX(i), P.getY(i), P.getZ(i), NN.getX(i), NN.getY(i), NN.getZ(i), T ? T.getX(i) : 0, T ? T.getY(i) : 0);
      }
      if (index) for (let i = 0; i < index.count; i += 3) t(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      else for (let i = 0; i + 2 < P.count; i += 3) t(i, i + 1, i + 2);
    }, Object.assign({}, o, { uv: uvMode, solid: !!o.solid }));
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
    const arr = attr.array;
    for (let i = this.start; i < this.start + this.count; i++) { arr[i * 3] = col[0]; arr[i * 3 + 1] = col[1]; arr[i * 3 + 2] = col[2]; }
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

function fillUV(a, pc, rep, off, ox, oz) {
  const ru = rep[0], rv = rep[1];
  const i0 = pc.start, i1 = pc.start + pc.count;
  const P = a.pos, N = a.nor, T = a.uv;
  if (pc.uv === 'solid') {
    for (let i = i0; i < i1; i++) { T[i * 2] = WHITE_UV[0]; T[i * 2 + 1] = WHITE_UV[1]; }
    return;
  }
  if (pc.uv === 'stretch') {
    if (pc.uvRepeat) for (let i = i0; i < i1; i++) { T[i * 2] *= pc.uvRepeat[0]; T[i * 2 + 1] *= pc.uvRepeat[1]; }
    return;
  }
  if (pc.uv === 'scaled') {
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
  const group = new THREE.Group();
  group.name = 'chunk ' + (this.level ? this.level.id : '?') + ' ' + this.cx + ',' + this.cz;
  let tris = 0;
  this._accs.forEach(a => {
    if (!a.n || !a.idx.length) return;
    const m = mat(a.key);
    const def = defOf(a.key) || {};
    const rep = (m.userData && m.userData.kitRepeat) || repeatOf(def);
    for (let i = 0; i < a.pieces.length; i++) fillUV(a, a.pieces[i], rep, def.uvOffset, this.ox, this.oz);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
    if (m.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
    geo.setIndex(a.n > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
    geo.computeBoundingSphere();
    tris += a.idx.length / 3;
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = a.key && a.key.isMaterial ? (a.key.name || 'material') : String(a.key);
    mesh.matrixAutoUpdate = false;   // 静态几何：省掉每帧重算本地矩阵
    if (m.transparent) mesh.renderOrder = 2;
    group.add(mesh);
    // 数组已经拷进 typed array，释放掉；Piece 之后改的是 attribute
    a.pos = a.nor = a.uv = a.col = a.idx = null;
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
  // 层级用 setWall 加过墙（门洞旁补墙、围地标）：生成时的连通性可能被破坏，画墙前自动再打通一次（锁定的墙不拆）
  if (g._dirty) g.reconnect();
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
  let walls = 0;

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
      b.aabb(x0, 0, z0, x1, H, z1, key, { faces, solid: true, color });
      walls++;
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
      b.aabb(xa, 0, z0, xb, H, z1, key, { faces, solid: true, color });
      walls++;
      if (trim) for (const sd of sides) {
        if (sd > 0) addTrim(xa, z1, xb, z1 + trim.t); else addTrim(xa, z0 - trim.t, xb, z0);
      }
    });
  }

  const ps = num(o.pillarSize, 0.5);
  const pkey = o.pillarMatKey || key;
  for (const p of g.pillars) {
    const px = p.i * cw, pz = p.j * cd;
    b.box(px, 0, pz, ps, H, ps, pkey, { faces: top ? 'noBottom' : 'sides', solid: true, color });
    if (trim) b.box(px, 0, pz, ps + trim.t * 2, trim.h, ps + trim.t * 2, trim.matKey, { faces: 'noBottom', solid: false, color: trim.color });
  }
  return { walls, pillars: g.pillars.length };
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
  });
}
function glowBox(b, x, y, z, w, h, d, color) {
  return b.box(x, y, z, w, h, d, 'kit:glow', { color, solid: false, uv: 'solid' });
}
function hash01(a, b2, c) { return U.hashInts(a, b2, c) / 4294967296; }
function posHash(b, k) { const p = b.point(0, 0); return hash01(Math.round((b.ox + p.x) * 100), Math.round((b.oz + p.z) * 100), k | 0); }

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
  const piece = b.plane(0, num(o.y, defY), 0, w, d, o.matKey || 'kit:prop', { facing, uv: o.uv || 'world', color: o.color, solid: false });
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
  const p = part(b, 0, 0, t / 2, L, h, t, o.color != null ? o.color : 0x5a4a32, { matKey: o.matKey, faces: 'noBottom' });
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
  b.push(x, z, rot);
  part(b, -W / 2 - jw / 2, 0, 0, jw, H + jw, jd, frameC, { faces: 'noBottom' });
  part(b, W / 2 + jw / 2, 0, 0, jw, H + jw, jd, frameC, { faces: 'noBottom' });
  part(b, 0, H, 0, W, jw, jd, frameC);
  if (o.solid !== false) {
    b.solid(-W / 2 - jw, 0, -jd / 2, -W / 2, H, jd / 2);
    b.solid(W / 2, 0, -jd / 2, W / 2 + jw, H, jd / 2);
  }
  b.push(-W / 2, 0, open * Math.PI / 2);
  const leaf = part(b, W / 2, 0, 0, W - 0.01, H - 0.01, lt, leafC);
  const knob = style === 'wood' ? 0xc9b27a : 0xc2c5c8;
  for (const sz of [1, -1]) part(b, W - 0.1, 0.98, sz * (lt / 2 + 0.02), 0.13, 0.03, 0.04, knob);
  if (style === 'wood') {
    const dk = 0x654329;
    for (const sz of [1, -1]) {
      part(b, W / 2, 0.22, sz * (lt / 2 + 0.004), W - 0.26, 0.72, 0.008, dk);
      part(b, W / 2, 1.14, sz * (lt / 2 + 0.004), W - 0.26, 0.72, 0.008, dk);
    }
  } else if (style === 'metal') {
    for (const sz of [1, -1]) part(b, W / 2, 0.02, sz * (lt / 2 + 0.004), W - 0.06, 0.25, 0.008, 0x6d7278);
  } else {
    for (const sz of [1, -1]) {
      part(b, W / 2, 1.3, sz * (lt / 2 + 0.004), 0.22, 0.5, 0.008, 0x273034);          // 夹丝玻璃小窗
      part(b, W / 2, 0.98, sz * (lt / 2 + 0.05), W - 0.2, 0.05, 0.05, 0xb8bcc0);         // 推杠
    }
  }
  b.pop();
  if (open < 0.35 && o.solid !== false) b.solid(-W / 2, 0, -0.05, W / 2, H, 0.05);
  if (o.sign) glowBox(b, 0, H + jw + 0.1, jd / 2 + 0.02, 0.36, 0.14, 0.04, o.sign === true ? EXIT_GREEN : rgb(o.sign));
  if (o.wall) wallWithOpening(b, 0, 0, 0, Object.assign({ openW: W + jw * 2, openY0: 0, openY1: H + jw }, o.wall));
  b.pop();
  return { leaf };
}

// 楼梯间入口：down（默认）= 地上一个黑洞 + 三面栏杆 + 隐约的台阶边；down: false = 往 −Z 升起的台阶通进黑暗门洞
function stairwell(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.3), D = num(o.depth, 2.6), down = o.down !== false;
  const rc = o.railColor != null ? o.railColor : PC.rail;
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
  } else {
    const n = Math.max(3, num(o.steps, 6) | 0), rise = 0.18, run = 0.3;
    const sc = o.stepColor != null ? o.stepColor : 0x8a8680;
    const H = num(o.h, b.height);
    for (let k = 0; k < n; k++) part(b, 0, 0, -(k + 0.5) * run, W, (k + 1) * rise, run, sc, { faces: 'noBottom' });
    b.plane(0, 0, -n * run, W, H, 'kit:glow', { facing: '+z', uv: 'solid', color: 0 });
    const wc = o.wallColor != null ? o.wallColor : 0x9c968a;
    for (const sx of [-1, 1]) part(b, sx * (W / 2 + 0.05), 0, -n * run / 2, 0.1, H, n * run, wc, { faces: 'noBottom', matKey: o.matKey });
    b.solid(-W / 2 - 0.1, 0, -n * run, W / 2 + 0.1, 0.5, -run * 0.8);
    b.solid(-W / 2 - 0.1, 0, -n * run, -W / 2, H, 0);
    b.solid(W / 2, 0, -n * run, W / 2 + 0.1, H, 0);
  }
  if (o.sign) glowBox(b, 0, down ? 2.3 : num(o.h, b.height) - 0.3, 0.02, 0.4, 0.15, 0.03, o.sign === true ? EXIT_GREEN : rgb(o.sign));
  b.pop();
  return {};
}

// 电梯门：金属门框 + 两扇滑门（open 0..1 向两侧滑开，露出黑色轿厢）+ 楼层指示灯 + 呼叫按钮
function elevator(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.1), H = num(o.h, 2.1), open = U.clamp(num(o.open, 0), 0, 1);
  const fc = o.frameColor != null ? o.frameColor : 0x8e9398, dc = o.doorColor != null ? o.doorColor : PC.steel;
  const jw = 0.15, jd = 0.22, hd = 0.35;
  b.push(x, z, rot);
  part(b, -W / 2 - jw / 2, 0, 0, jw, H + hd, jd, fc, { faces: 'noBottom' });
  part(b, W / 2 + jw / 2, 0, 0, jw, H + hd, jd, fc, { faces: 'noBottom' });
  part(b, 0, H, 0, W, hd, jd, fc);
  glowBox(b, 0, H + 0.12, jd / 2 + 0.006, 0.34, 0.1, 0.012, o.indicator != null ? rgb(o.indicator) : [1.5, 0.75, 0.2]);
  const pw = W / 2, shift = open * (pw - 0.04);
  const left = part(b, -pw / 2 - shift, 0, 0.02, pw, H, 0.04, dc, { faces: 'noBottom' });
  const right = part(b, pw / 2 + shift, 0, 0.02, pw, H, 0.04, dc, { faces: 'noBottom' });
  if (open < 0.02) part(b, 0, 0, 0.041, 0.008, H, 0.004, 0x3a3d40);
  b.plane(0, 0, -0.04, W, H, 'kit:glow', { facing: '+z', uv: 'solid', color: o.interior != null ? rgb(o.interior) : 0 });
  const bx = W / 2 + jw + 0.16;
  part(b, bx, 0.95, 0.015, 0.12, 0.3, 0.03, 0x7b8085);
  glowBox(b, bx, 1.1, 0.035, 0.05, 0.05, 0.02, [1.4, 1.2, 0.7]);
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
  } else {
    const y = num(o.y, 2.3);
    b.plane(0, y - Hh / 2, 0.004, W, Hh, 'kit:glow', { facing: '+z', uv: 'solid', color: 0.02 });
    part(b, 0, y - Hh / 2 - 0.03, 0.015, W + 0.06, 0.03, 0.03, c);
    part(b, 0, y + Hh / 2, 0.015, W + 0.06, 0.03, 0.03, c);
    part(b, -W / 2 - 0.015, y - Hh / 2, 0.015, 0.03, Hh, 0.03, c);
    part(b, W / 2 + 0.015, y - Hh / 2, 0.015, 0.03, Hh, 0.03, c);
    const n = Math.max(3, Math.round(Hh / 0.07));
    for (let k = 0; k < n; k++) part(b, 0, y - Hh / 2 + (k + 0.5) * Hh / n - 0.008, 0.014, W, 0.016, 0.02, c);
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
  b.pop();
  return {};
}

// 水坑：不规则半透明水面（形状按位置哈希，不消耗 rng），不挡路
function puddle(b, x, z, rot, opts) {
  const o = opts || {};
  const rx = num(o.rx, 0.8), rz = num(o.rz, 0.5), seg = 14;
  b.push(x, z, rot);
  const radii = [];
  for (let k = 0; k < seg; k++) radii.push(0.72 + 0.4 * posHash(b, k + 11));
  const piece = b._piece('kit:water', 0, num(o.y, 0.006), 0, 0, (v, t) => {
    v(0, 0, 0, 0, 1, 0, 0, 0);
    for (let k = 0; k < seg; k++) {
      const a = k / seg * TAU;
      v(Math.cos(a) * rx * radii[k], 0, Math.sin(a) * rz * radii[k], 0, 1, 0, 0, 0);
    }
    for (let k = 0; k < seg; k++) t(0, 1 + (k + 1) % seg, 1 + k);
    // 深灰偏冷：半透明叠在地毯上是"湿的一滩发暗"，高光由灯打出来；浅色会像地毯褪色的一块
  }, { uv: 'world', color: o.color != null ? o.color : [0.2, 0.22, 0.23], solid: false });
  b.pop();
  return { piece };
}

// 纸箱（可叠 stack 个，每层按位置哈希轻微错角）
function box(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.5), Hh = num(o.h, 0.38), D = num(o.d, 0.4);
  const c = o.color != null ? o.color : PC.cardboard;
  const stack = Math.max(1, o.stack | 0 || 1);
  b.push(x, z, rot);
  for (let k = 0; k < stack; k++) {
    b.push(0, 0, (posHash(b, k) - 0.5) * 0.35, k * Hh);
    part(b, 0, 0, 0, W, Hh, D, c, { faces: 'noBottom' });
    part(b, 0, Hh, 0, 0.07, 0.004, D + 0.004, PC.tape);
    part(b, 0, Hh, 0, W + 0.002, 0.003, 0.006, 0x7d6140);
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
  b.push(x, z, rot);
  part(b, 0, 0, 0, S, S, S, c, { faces: 'noBottom' });
  const h = S / 2 + 0.005;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(b, sx * (h - t / 2), 0, sz * (h - t / 2), t, S, t, e, { faces: 'noBottom' });
  for (const y of [0, S - t]) {
    for (const s of [-1, 1]) {
      part(b, 0, y, s * (h - t / 2), S + 0.01, t, t, e);
      part(b, s * (h - t / 2), y, 0, t, t, S + 0.01, e);
    }
  }
  for (const s of [-1, 1]) part(b, 0, S / 2 - 0.035, s * h, S * 0.9, 0.07, 0.012, e, { rotY: 0 });
  if (o.solid !== false) b.solid(-S / 2, 0, -S / 2, S / 2, S, S / 2);
  b.pop();
  return {};
}

// 办公桌：桌面 + 四腿 + 挡板 + 右侧抽屉柜；monitor: true 放一台 CRT
function desk(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.4), D = num(o.d, 0.7), Hh = num(o.h, 0.75);
  b.push(x, z, rot);
  part(b, 0, Hh - 0.03, 0, W, 0.03, D, o.color != null ? o.color : PC.laminate);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(b, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), 0.04, Hh - 0.03, 0.04, 0x55585c, { faces: 'noBottom' });
  part(b, 0, 0.25, -D / 2 + 0.03, W - 0.1, Hh - 0.3, 0.015, 0x8c8272);
  const dx = W / 2 - 0.24;
  part(b, dx, 0, 0, 0.4, Hh - 0.03, D - 0.06, 0xb3a78e, { faces: 'noBottom' });
  for (let k = 1; k <= 2; k++) part(b, dx, k * (Hh - 0.03) / 3, D / 2 - 0.03, 0.38, 0.008, 0.006, 0x6e6658);
  for (let k = 0; k < 3; k++) part(b, dx, (k + 0.6) * (Hh - 0.03) / 3, D / 2 - 0.02, 0.1, 0.02, 0.02, 0x3d4044);
  if (o.monitor) {
    part(b, -0.15, Hh, -0.08, 0.42, 0.36, 0.4, 0xd8d0bd);
    b.plane(-0.15, Hh + 0.05, 0.121, 0.32, 0.25, 'kit:glow', { facing: '+z', uv: 'solid', color: o.screen != null ? rgb(o.screen) : 0.03 });
  }
  if (o.solid !== false) b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
  return {};
}

// 办公椅：座面、靠背（在 −Z）、气压杆、五爪脚
function chair(b, x, z, rot, opts) {
  const o = opts || {};
  const c = o.color != null ? o.color : PC.fabric;
  b.push(x, z, rot);
  part(b, 0, 0.42, 0, 0.46, 0.08, 0.46, c);
  part(b, 0, 0.56, -0.22, 0.44, 0.48, 0.06, c);
  part(b, 0, 0.44, -0.26, 0.05, 0.2, 0.03, PC.dark);
  b.cylinder(0, 0.08, 0, 0.03, 0.34, 'kit:prop', { color: PC.dark, uv: 'stretch', solid: false, segments: 6 });
  for (let k = 0; k < 5; k++) {
    b.push(0, 0, k * TAU / 5);
    part(b, 0, 0.03, 0.15, 0.05, 0.04, 0.3, PC.dark);
    b.pop();
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
  b.push(x, z, rot);
  part(b, 0, 0, -D / 2 + t / 2, W, Hh, t, c, { faces: 'noBottom' });
  part(b, -W / 2 + t / 2, 0, 0, t, Hh, D, c, { faces: 'noBottom' });
  part(b, W / 2 - t / 2, 0, 0, t, Hh, D, c, { faces: 'noBottom' });
  part(b, 0, Hh, -D / 2 + t / 2, W, 0.025, t + 0.01, tc);
  part(b, -W / 2 + t / 2, Hh, 0, t + 0.01, 0.025, D, tc);
  part(b, W / 2 - t / 2, Hh, 0, t + 0.01, 0.025, D, tc);
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, -D / 2 + t);
  b.solid(-W / 2, 0, -D / 2, -W / 2 + t, Hh, D / 2);
  b.solid(W / 2 - t, 0, -D / 2, W / 2, Hh, D / 2);
  if (o.desk !== false) desk(b, 0, -D / 2 + t + 0.36, 0, { w: W - t * 2 - 0.1, d: 0.7, monitor: o.monitor !== false });
  if (o.chair !== false) chair(b, 0.15, -D / 2 + t + 1.0, Math.PI, {});
  b.pop();
  return {};
}

// 窗户：y = 窗台高度；blackout: true 涂黑，glow: true|颜色 = 外面很亮（发光面），否则半透明玻璃
function windowProp(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 1.2), Hh = num(o.h, 1.2), y = num(o.y, 0.9);
  const fc = o.frameColor != null ? o.frameColor : 0xd8d4cc, ft = 0.06, fd = 0.12;
  b.push(x, z, rot);
  part(b, 0, y - ft, 0.02, W + ft * 2, ft, fd + 0.04, fc);
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
  b.push(x, z, rot);
  part(b, 0, 0, 0, W, Hh, D, c, { faces: 'noBottom' });
  const gx = -0.12, gw = 0.58;
  b.plane(gx, 0.55, D / 2 + 0.004, gw, 1.15, 'kit:glow', { facing: '+z', uv: 'solid', color: o.glow != null ? rgb(o.glow) : [1.25, 1.25, 1.1] });
  for (let r = 0; r < 5; r++) {
    part(b, gx, 0.6 + r * 0.22, D / 2 + 0.012, gw, 0.012, 0.02, 0x333333);
    for (let k = 0; k < 4; k++) part(b, gx + (k - 1.5) * 0.13, 0.62 + r * 0.22, D / 2 + 0.024, 0.07, 0.14, 0.03, pal[(r * 4 + k * 3) % pal.length]);
  }
  part(b, 0.33, 0.9, D / 2 + 0.01, 0.16, 0.5, 0.02, 0x2b2b2b);
  glowBox(b, 0.33, 1.25, D / 2 + 0.025, 0.06, 0.04, 0.01, [1.4, 0.4, 0.3]);
  b.plane(gx, 0.12, D / 2 + 0.004, gw, 0.28, 'kit:glow', { facing: '+z', uv: 'solid', color: 0.01 });
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
  b.push(x, z, rot);
  part(b, 0, 0, 0, W + 0.06, 0.3, L + 0.06, wood, { faces: 'noBottom' });
  part(b, 0, 0.3, 0.02, W - 0.02, 0.18, L - 0.06, 0xe8e3d6);
  part(b, 0, 0.3, L * 0.18, W + 0.02, 0.2, L * 0.62, o.color != null ? o.color : 0x5a6f8a);
  part(b, 0, 0.48, -L / 2 + 0.25, W * 0.6, 0.1, 0.32, 0xf2efe6);
  part(b, 0, 0, -L / 2 - 0.03, W + 0.1, 0.95, 0.06, wood, { faces: 'noBottom' });
  if (o.solid !== false) b.solid(-W / 2 - 0.05, 0, -L / 2 - 0.06, W / 2 + 0.05, 0.6, L / 2 + 0.03);
  b.pop();
  return {};
}

// 柜子：kind 'file'（四层金属文件柜，默认）| 'wardrobe'（木衣柜）| 'locker'（储物柜）
function cabinet(b, x, z, rot, opts) {
  const o = opts || {};
  const kind = o.kind || 'file';
  b.push(x, z, rot);
  let W, H, D;
  if (kind === 'wardrobe') {
    W = num(o.w, 1.0); H = num(o.h, 1.9); D = num(o.d, 0.55);
    const c = o.color != null ? o.color : 0x7b5a3c;
    part(b, 0, 0, 0, W, H, D, c, { faces: 'noBottom' });
    part(b, 0, H, 0, W + 0.06, 0.05, D + 0.04, 0x5f432b);
    part(b, 0, 0.06, D / 2 + 0.003, 0.01, H - 0.12, 0.006, 0x3e2b1b);
    for (const s of [-1, 1]) part(b, s * 0.06, H * 0.5, D / 2 + 0.02, 0.02, 0.16, 0.03, 0xc9b27a);
  } else if (kind === 'locker') {
    W = num(o.w, 0.4); H = num(o.h, 1.8); D = num(o.d, 0.5);
    const c = o.color != null ? o.color : 0x5b6f86;
    part(b, 0, 0, 0, W, H, D, c, { faces: 'noBottom' });
    for (let k = 0; k < 3; k++) part(b, 0, H - 0.25 - k * 0.05, D / 2 + 0.002, W * 0.6, 0.015, 0.004, 0x1f2833);
    part(b, W / 2 - 0.07, H * 0.5, D / 2 + 0.015, 0.03, 0.12, 0.03, 0xb8bcc0);
  } else {
    W = num(o.w, 0.46); H = num(o.h, 1.32); D = num(o.d, 0.62);
    const c = o.color != null ? o.color : PC.metal;
    part(b, 0, 0, 0, W, H, D, c, { faces: 'noBottom' });
    const dh = (H - 0.06) / 4;
    for (let k = 0; k < 4; k++) {
      part(b, 0, 0.04 + k * dh, D / 2 + 0.005, W - 0.04, dh - 0.02, 0.01, 0xa2a7ac);
      part(b, 0, 0.04 + k * dh + dh * 0.62, D / 2 + 0.02, 0.12, 0.025, 0.02, PC.dark);
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
  b.push(x, z, rot);
  b.cylinder(0, 0, 0, 0.09, Hh, 'kit:prop', { rTop: 0.06, color: c, uv: 'stretch', solid: true, segments: 8 });
  part(b, 0, 0, 0, 0.3, 0.4, 0.3, c, { faces: 'noBottom' });
  part(b, 0, Hh - 0.1, 0.6, 0.06, 0.06, 1.2, c);
  part(b, 0, Hh - 0.22, 1.25, 0.28, 0.14, 0.5, 0x3a3c3e);
  const lens = b.plane(0, Hh - 0.225, 1.25, 0.22, 0.42, 'kit:glow', { facing: 'down', uv: 'solid', color: base, glow: state === 'broken' ? 0.15 : lit ? 1 : 0.06 });
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
    for (let k = 0; k < n; k++) part(b, -L / 2 + k * sp, 0, 0, 0.09, Hh + 0.05, 0.09, c, { faces: 'noBottom' });
    for (const y of [0.3, Hh - 0.35]) part(b, 0, y, -0.06, L, 0.08, 0.03, c);
    const m = Math.max(2, Math.floor(L / 0.14));
    for (let k = 0; k < m; k++) part(b, -L / 2 + (k + 0.5) * L / m, 0.05, 0.0, 0.08, Hh - 0.1, 0.02, c, { faces: 'noBottom' });
  } else {
    const c = o.color != null ? o.color : 0x8a8e91;
    for (let k = 0; k < n; k++) b.cylinder(-L / 2 + k * sp, 0, 0, 0.035, Hh, 'kit:prop', { color: c, uv: 'stretch', solid: false, segments: 6 });
    if (kind === 'rail') {
      for (const y of [Hh - 0.05, Hh * 0.55, Hh * 0.15]) part(b, 0, y, 0, L, 0.06, 0.05, c);
    } else {
      b.cylinder(0, Hh - 0.02, 0, 0.025, L, 'kit:prop', { axis: 'x', color: c, uv: 'stretch', solid: false, segments: 6 });
      b.box(0, 0.05, 0, L, Hh - 0.1, 0.01, 'kit:glass', { color: o.meshColor != null ? o.meshColor : 0x6f7478, uv: 'stretch', solid: false });
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
  b.push(x, z, rot);
  const p = b.box(0, 0, 0, W, Hh, num(o.d, W), key, { faces: Hh >= b.height - 0.01 ? 'sides' : 'noBottom', color: o.color, solid: o.solid !== false, uv: key === 'kit:prop' ? 'stretch' : 'world' });
  b.pop();
  return { piece: p };
}

// 发光指示牌（出口绿灯箱之类）：y = 底边高度
function sign(b, x, z, rot, opts) {
  const o = opts || {};
  const W = num(o.w, 0.4), Hh = num(o.h, 0.15), y = num(o.y, 2.2);
  b.push(x, z, rot);
  part(b, 0, y - 0.02, 0, W + 0.04, Hh + 0.04, 0.04, o.backColor != null ? o.backColor : 0xe8e8e0);
  const piece = b.plane(0, y, 0.021, W, Hh, 'kit:glow', { facing: '+z', uv: 'solid', color: o.color != null ? rgb(o.color) : EXIT_GREEN });
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
  const rim = fan('kit:prop', 0.003, 1.12, o.rimColor != null ? o.rimColor : 0x2a261d, 'stretch');
  const disc = fan('kit:glow', 0.006, 1, 0, 'solid');
  b.pop();
  return { disc, rim };
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
  const o = opts || {};
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
  rgb,
  levelId: normId,
  levelName,
  inRange,
  // 层级 id → data/lore-choices.json 里 levels 的键（Level ! 在代码里叫 'run'，调研里叫 '!'）
  loreKey: id => (String(id) === 'run' ? '!' : String(id)),
};
})();
