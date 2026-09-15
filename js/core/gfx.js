// 后室 · 渲染：renderer / scene / camera / 雾 / 灯光预算 / 低 san 屏幕效果 / 淡入淡出
// 经典 <script>，只往 window.BR 上挂东西。接口见 ARCHITECTURE.md 第 12 节 BR.gfx
(function () {
'use strict';
const BR = window.BR;
if (!BR || typeof THREE === 'undefined') {
  console.error('[gfx] 需要先加载 vendor/three.min.js 和 js/core/base.js');
  return;
}
const U = BR.util;

// ===================================================================
// 色调映射
// ===================================================================
// 不用 ACES / Reinhard / Cineon：它们都是逐通道压缩。后室墙纸是 R > G >> B 的黄，
// 灯下 R 先进入肩部、被压得比 G 狠 → G/R 变大、色相往绿走，再叠上去饱和，就成了"灰绿"。
// 这里只让三通道最大值过曲线，三个通道按同一比例缩放：色相、饱和度不变，只压亮度。
// 峰值低于 0.75 原样输出，绝大多数墙面完全不受影响；
// 极亮处（灯管面片）才向同亮度的白色靠拢，否则灯管中心是刺眼的纯饱和黄，像塑料。
// r147 的 fog_fragment 在色调映射和 sRGB 编码之后才混雾，所以雾色、背景色在屏幕上就是原 hex。
const TONE_STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const TONE_GLSL = [
  'vec3 CustomToneMapping( vec3 color ) {',
  '\tcolor *= toneMappingExposure;',
  '\tfloat peak = max( max( color.r, color.g ), color.b );',
  '\tfloat over = max( peak - 0.75, 0.0 );',
  '\tfloat mapped = min( peak, 0.75 ) + 0.25 * over / ( over + 0.25 );',
  '\tvec3 c = color * ( mapped / max( peak, 0.00001 ) );',
  '\treturn mix( c, vec3( mapped ), smoothstep( 1.5, 6.0, peak ) * 0.6 );',
  '}',
].join('\n');
let customTone = false;
{
  const chunk = THREE.ShaderChunk && THREE.ShaderChunk.tonemapping_pars_fragment;
  if (typeof chunk === 'string' && chunk.indexOf(TONE_STUB) !== -1) {
    // 必须赶在任何材质编译之前改：shader 在首次 render 时才拼装，gfx.js 又先于所有游戏模块加载
    THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(TONE_STUB, TONE_GLSL);
    customTone = true;
  } else {
    console.warn('[gfx] 找不到 three 的 CustomToneMapping 占位，退回不做色调映射');
  }
}

// ===================================================================
// 场景对象：脚本加载时就建好，不依赖 GL 上下文，其他模块在 init 之前也能往 scene 里加东西
// ===================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
// 雾对象始终存在：scene.fog 在 null 和 Fog 之间切换会改 shader define，全场景材质重编译
scene.fog = new THREE.Fog(0x000000, 2, 40);

const camera = new THREE.PerspectiveCamera(75, viewW() / viewH(), 0.05, 60);
// 相机挂进场景：玩家模块把手电、手持物挂在相机下时才会被渲染
scene.add(camera);

// 环境光固定一盏 HemisphereLight，类型和数量永不变，换层不重编译。
// 天空色照地板、地面色照天花板，墙面取两者平均：地面色偏暗 = 地毯反弹比顶灯弱，天花板比地板暗更像真实室内；
// 平均值正好等于 env.ambient，层级作者照 AmbientLight 的直觉填强度即可
const HEMI_SKY = 1.15, HEMI_GROUND = 0.85;
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.4);
scene.add(hemi);

// 固定数量的 PointLight 池：three 按光源个数拼 shader，灯数一变全场景重编译（手机上卡顿半秒以上），
// 所以池子常驻场景、永远 visible，不用的灯只把 intensity 置 0
const POOL = Math.max(1, (BR.config && BR.config.world && BR.config.world.maxDynamicLights | 0) || 6);
const slots = [];
for (let i = 0; i < POOL; i++) {
  const light = new THREE.PointLight(0xffffff, 0, 10, 2);
  light.castShadow = false;
  light.name = 'gfx-pool-' + i;
  scene.add(light);
  // src：当前照着的光源描述；next：淡出结束后接手的光源；level：0..1 交叉淡化进度
  slots.push({ light, src: null, next: null, want: false, level: 0 });
}

// ===================================================================
// 状态
// ===================================================================
let renderer = null;
let quality = 'high';
let clock = 0;               // gfx 内部时钟（秒）：闪烁、抖动共用，层级调 flickerAt 时默认用它才能和真光对齐
const envState = { env: null, visibility: 1, follow: true };
const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function viewW() { return Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1)); }
function viewH() { return Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1)); }

function settingsVisibility() {
  const s = BR.game && BR.game.settings;
  return s && typeof s.visibility === 'number' ? U.clamp(s.visibility, 0, 1) : 1;
}

// ===================================================================
// init / 画质 / 尺寸
// ===================================================================
function init(canvas) {
  if (renderer) { console.warn('[gfx] 重复 init，已忽略'); return renderer; }
  const el = canvas || document.getElementById('gl');
  if (!el) throw new Error('[gfx] 找不到 <canvas id="gl">');

  const s = BR.game && BR.game.settings;
  quality = s && s.quality === 'low' ? 'low' : 'high';
  const antialias = quality === 'high';
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: el,
      antialias,
      alpha: false,
      stencil: false,                      // 没有用到模板缓冲，省一份显存
      powerPreference: 'high-performance',
    });
  } catch (err) {
    throw new Error('[gfx] 无法创建 WebGL：' + ((err && err.message) || err));
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = customTone ? THREE.CustomToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(scene.background, 1);

  BR.gfx.renderer = renderer;
  BR.gfx.quality = quality;
  BR.gfx.antialias = antialias;
  BR.gfx.qualityNeedsReload = false;

  // 上下文丢失 / 恢复：three 自己已在 lost 里 preventDefault 并在 restored 里重建 GL 资源，这里只通知 main 暂停、挂提示
  el.addEventListener('webglcontextlost', () => { BR.bus.emit('gfx:contextlost'); }, false);
  el.addEventListener('webglcontextrestored', () => { resize(); BR.bus.emit('gfx:contextrestored'); }, false);

  window.addEventListener('resize', requestResize, { passive: true });
  window.addEventListener('orientationchange', onOrientation, { passive: true });
  // iOS Safari 地址栏伸缩时 window 不一定发 resize，visualViewport 会
  if (window.visualViewport) window.visualViewport.addEventListener('resize', requestResize, { passive: true });
  resize();
  return renderer;
}

function isTouchDevice() {
  if (BR.input && BR.input.isTouch) return true;
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// 触屏高画质每帧像素上限：手机横竖屏（≤0.8MP）碰不到，只压平板——iPad Air 横屏 1.5 倍是 2.2MP + MSAA，帧缓冲约 75MB
const TOUCH_MAX_PX = 1.2e6;

function pixelRatioFor(w, h) {
  if (quality === 'low') return 1;
  const dpr = window.devicePixelRatio || 1;
  const touch = isTouchDevice();
  let pr = Math.min(dpr, touch ? 1.5 : 2);
  if (touch && w * h * pr * pr > TOUCH_MAX_PX) pr = Math.max(Math.min(pr, 1), Math.sqrt(TOUCH_MAX_PX / (w * h)));
  // 4K 屏再乘 2 倍像素比是每帧 3000 万像素，填充率扛不住：总像素封顶约一块 4K，但不低于 1 倍
  const MAX_PX = 3840 * 2160;
  if (w * h * pr * pr > MAX_PX) pr = Math.max(Math.min(dpr, 1), Math.sqrt(MAX_PX / (w * h)));
  return pr;
}

function setQuality(q) {
  quality = q === 'low' ? 'low' : 'high';
  BR.gfx.quality = quality;
  if (!renderer) return;
  // 抗锯齿是 WebGL 上下文的创建参数，同一个 canvas 建好上下文后改不了；
  // 换新 canvas 又会让 input.js 绑在旧 canvas 上的监听失效，所以只能刷新后生效
  BR.gfx.qualityNeedsReload = BR.gfx.antialias !== (quality === 'high');
  if (BR.gfx.qualityNeedsReload) console.info('[gfx] 抗锯齿开关需要刷新页面后生效');
  resize();
}

let resizeRaf = 0;
function requestResize() {
  if (resizeRaf) return;
  // 同一次变化里 window 和 visualViewport 往往各发一次，合并到下一帧只做一次 setSize
  resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; resize(); });
}
function onOrientation() {
  requestResize();
  // 部分 iOS 版本转屏事件先到、innerWidth 稍后才更新，补一次
  setTimeout(requestResize, 350);
}

// 竖屏视野下限：竖直视野固定 75° 时，手机竖屏水平视野只剩约 39°，整屏只看得到正前方一面墙。
// 水平视野不足 60° 时改成保住水平 60°，竖直最多放到 100°（再大边缘拉伸太狠）；
// 横屏照旧固定竖直视野（Hor+），超宽屏水平视野变宽是正常结果，不设上限
function gameFov(aspect) {
  const base = BR.gfx && +BR.gfx.baseFov > 0 ? +BR.gfx.baseFov : 75;
  const a = aspect > 0 ? aspect : camera.aspect;
  const h = 2 * Math.atan(Math.tan(base * Math.PI / 360) * a) * 180 / Math.PI;
  if (!(h < 60)) return base;
  return Math.min(100, 2 * Math.atan(Math.tan(Math.PI / 6) / a) * 180 / Math.PI);
}

function resize() {
  const w = viewW(), h = viewH();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!renderer) return;
  const pr = pixelRatioFor(w, h);
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(w, h, true);
}

// ===================================================================
// 环境：背景、雾、环境光
// ===================================================================
function applyEnv(env, visibility) {
  if (!env) return;
  const vis = visibility == null ? settingsVisibility() : U.clamp(+visibility || 0, 0, 1);
  envState.env = env;
  envState.visibility = vis;
  // 没传或传的就是设置值 → 之后暂停菜单改能见度时 render 里自动重算；传了别的值（如主页固定 1）就不跟随
  envState.follow = visibility == null || vis === settingsVisibility();

  const fogColor = env.fogColor != null ? env.fogColor : (env.background != null ? env.background : 0x000000);
  const bg = env.background != null ? env.background : fogColor;
  if (!(scene.background && scene.background.isColor)) scene.background = new THREE.Color();
  scene.background.set(bg);
  if (renderer) renderer.setClearColor(scene.background, 1);

  // 能见度 0..1 线性映射到 fogFar 的 0.25..1 倍：滑条全程都有效，不会有一段拖了没反应
  const far = (env.fogFar > 0 ? env.fogFar : 40) * U.lerp(0.25, 1, vis);
  // 近端不缩放，但不能追上远端，否则雾反向
  const near = Math.min(env.fogNear > 0 ? env.fogNear : 0, far * 0.6);
  if (!(scene.fog && scene.fog.isFog)) scene.fog = new THREE.Fog(fogColor, near, far);
  scene.fog.color.set(fogColor);
  scene.fog.near = near;
  scene.fog.far = far;

  // 雾远端之外只剩雾色，画了也看不见：远裁剪面放在雾远端外一点，顺手省掉远处的 draw call
  const camFar = far * 1.05 + 1;
  if (Math.abs(camera.far - camFar) > 1e-3) { camera.far = camFar; camera.updateProjectionMatrix(); }

  const amb = env.ambient || {};
  const ac = amb.color != null ? amb.color : 0xffffff;
  if (amb.groundColor != null) {
    hemi.color.set(ac);
    hemi.groundColor.set(amb.groundColor);
  } else {
    hemi.color.set(ac).multiplyScalar(HEMI_SKY);
    hemi.groundColor.set(ac).multiplyScalar(HEMI_GROUND);
  }
  hemi.intensity = amb.intensity != null ? amb.intensity : 0.4;
}

// ===================================================================
// 灯光预算
// ===================================================================
const LIGHT_INTERVAL = 0.2;  // 选灯周期：几百个候选 × 5Hz 远比每帧便宜，人走 0.2 秒不到 1 米，看不出滞后
const LIGHT_FADE = 0.25;     // 换灯交叉淡化时长，避免最远那盏换人时"啪"一下
const JUMP2 = 8 * 8;         // 一次选灯间隔里移动超过 8 米 = 传送/重生/换层，直接到位不淡化

let lightList = [];
let lightTimer = 0;
let lightDirty = true;
const camPos = new THREE.Vector3();
const lastSelPos = new THREE.Vector3(1e9, 1e9, 1e9);
const bestSrc = new Array(POOL).fill(null);
const bestD = new Float64Array(POOL);
const chosenSet = new Set();
const placedSet = new Set();

function setLightSources(list) {
  lightList = Array.isArray(list) ? list : [];
  lightDirty = true;
  if (lightList.length === 0) {
    // 空列表 = 清场/换层：立即全灭，别让旧层的灯在新层里淡出
    for (const sl of slots) { sl.src = null; sl.next = null; sl.want = false; sl.level = 0; sl.light.intensity = 0; }
  }
}

function applyLightStatic(light, s) {
  light.color.set(s.color != null ? s.color : 0xffffff);
  light.distance = s.range > 0 ? s.range : 10;
  // 默认 decay 2：r147 旧光照模型下衰减是 (1 - d/range)^decay，二次方在 range 边缘平滑归零，墙上看不到光圈边
  light.decay = s.decay > 0 ? s.decay : 2;
}

function selectLights(jumped) {
  // 维护 K 个最近的有序小数组，O(N·K) 且不分配内存
  let n = 0;
  const px = camPos.x, py = camPos.y, pz = camPos.z;
  for (let i = 0; i < lightList.length; i++) {
    const s = lightList[i];
    if (!s || (s.intensity != null && !(s.intensity > 0))) continue;
    const dx = s.x - px, dy = (s.y || 0) - py, dz = s.z - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (!(d >= 0)) continue;                       // 坐标缺失（NaN）的跳过
    if (n === POOL && d >= bestD[POOL - 1]) continue;
    let j = n < POOL ? n : POOL - 1;
    while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; bestSrc[j] = bestSrc[j - 1]; j--; }
    bestD[j] = d; bestSrc[j] = s;
    if (n < POOL) n++;
  }

  let anyActive = false;
  for (const sl of slots) if (sl.src) { anyActive = true; break; }
  // 池子全空时也直接到位：没有旧灯可交叉淡化，淡入只会让出生点黑 0.25 秒
  const snap = jumped || !anyActive;

  chosenSet.clear(); placedSet.clear();
  for (let i = 0; i < n; i++) chosenSet.add(bestSrc[i]);
  // 已经在亮的灯留在原槽位，只有被挤出去的槽才换人，槽位不来回洗牌
  for (const sl of slots) {
    sl.next = null;
    sl.want = !!sl.src && chosenSet.has(sl.src);
    if (sl.want) placedSet.add(sl.src);
  }
  for (let i = 0; i < n; i++) {
    const s = bestSrc[i];
    if (placedSet.has(s)) continue;
    let target = null;
    for (const sl of slots) if (!sl.src) { target = sl; break; }
    if (target) {
      target.src = s; target.want = true; target.level = snap ? 1 : 0;
    } else {
      for (const sl of slots) if (!sl.want && !sl.next) { target = sl; break; }
      if (!target) break;                          // 被选中的不超过池大小，理论上到不了这里
      if (snap) { target.src = s; target.want = true; target.level = 1; }
      else target.next = s;                        // 等旧灯淡出后接手
    }
    placedSet.add(s);
  }
  for (const sl of slots) {
    if (snap && sl.src && !sl.want) { sl.src = null; sl.level = 0; sl.light.intensity = 0; }
    // 每轮都重读颜色/范围：层级事件可能改灯色（比如变红）
    if (sl.src) applyLightStatic(sl.light, sl.src);
  }
  for (let i = 0; i < POOL; i++) bestSrc[i] = null;   // 不替已卸载的区块留引用
}

function ensureInScene() {
  // 有模块整个清空过 scene 时把常驻对象补回：光源数一变会重编译，而且灯会全灭
  if (hemi.parent !== scene) scene.add(hemi);
  for (const sl of slots) if (sl.light.parent !== scene) scene.add(sl.light);
  if (camera.parent === null) scene.add(camera);
}

function updateLights(dt) {
  // 取世界坐标而不是 position：相机可能被挂在玩家节点下
  camera.updateWorldMatrix(true, false);
  camPos.setFromMatrixPosition(camera.matrixWorld);
  lightTimer -= dt;
  const jumped = camPos.distanceToSquared(lastSelPos) > JUMP2;
  if (lightDirty || jumped || lightTimer <= 0) {
    selectLights(jumped);
    lightTimer = LIGHT_INTERVAL;
    lightDirty = false;
    lastSelPos.copy(camPos);
    ensureInScene();
  }

  const step = dt / LIGHT_FADE;
  for (const sl of slots) {
    const L = sl.light;
    if (!sl.src) { if (L.intensity !== 0) L.intensity = 0; continue; }
    if (sl.want) {
      sl.level = Math.min(1, sl.level + step);
    } else {
      sl.level = Math.max(0, sl.level - step);
      if (sl.level <= 0) {
        if (sl.next) { sl.src = sl.next; sl.next = null; sl.want = true; applyLightStatic(L, sl.src); }
        else { sl.src = null; L.intensity = 0; continue; }
      }
    }
    const s = sl.src;
    L.position.set(s.x, s.y || 0, s.z);            // 每帧跟随，允许层级移动光源
    L.intensity = (s.intensity != null ? s.intensity : 1) * sl.level * flickerAt(s, clock);
  }
}

function hash01(a, b) { return U.hashInts(a, b) / 4294967296; }

// 返回 0..1 亮度系数。只由灯的坐标和时间决定（纯函数）：
// 区块卸载重载后同一盏灯闪法不变；层级给自发光面片调同样的参数就能和真光同步明灭
function flickerAt(src, t) {
  const f = src && src.flicker > 0 ? Math.min(1, src.flicker) : 0;
  if (f === 0) return 1;
  if (t == null) t = clock;
  const seed = U.hashInts(Math.round(src.x * 4), Math.round((src.y || 0) * 4), Math.round(src.z * 4));
  const phase = (seed & 1023) / 1024;              // 每盏灯错开时段边界，整排灯不会同一帧一起坏
  const e = hash01(seed, Math.floor(t / 1.3 + phase));
  const pBad = f * (0.15 + 0.25 * f);              // flicker=1 时约 40% 的时段在故障
  if (e < pBad * 0.2) return 0.03;                 // 整段熄灭
  if (e < pBad) {
    // 故障段：约 16Hz 的随机明灭，日光灯启辉器接触不良就是这个节奏
    const tick = Math.floor(t / 0.06 + phase * 7);
    return hash01(seed ^ 0x5bd1e995, tick) < 0.45 ? 0.05 + 0.3 * hash01(seed + 7, tick) : 1;
  }
  // 正常时段只有很轻的起伏，老化灯管的"呼吸"
  return 1 - 0.05 * f * (0.5 + 0.5 * Math.sin(t * 9 + phase * 6.2832));
}

// ===================================================================
// 屏幕覆盖层（低 san / 闪屏 / 淡入淡出）
// ===================================================================
// z-index：低 san 10 —— 画布之上、触屏控件 20 和 HUD 30 之下，不挡按钮也不糊状态条
//          闪屏 40   —— 压过 HUD，受击/穿墙的冲击感要盖住 UI；在主页 50 之下
//          淡入淡出 55 —— 盖住 HUD 和主页做整屏过渡；结算/暂停 60 及以上的弹窗仍在上面可操作
const CSS = [
  '.gfx-layer{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;}',
  '.gfx-sanity{z-index:10;overflow:hidden;contain:strict;}',
  '.gfx-sanity>div{position:absolute;pointer-events:none;will-change:transform,opacity;opacity:0;}',
  // 边缘色偏：红、青两圈错开的径向渐变来回平移，模拟色差但不需要后处理 pass
  '.gfx-sanity-fringe{left:-3%;top:-3%;width:106%;height:106%;',
  'background:radial-gradient(ellipse at 47% 50%,rgba(255,0,70,0) 50%,rgba(255,0,70,.30) 100%),',
  'radial-gradient(ellipse at 53% 50%,rgba(0,220,255,0) 50%,rgba(0,220,255,.24) 100%);',
  'animation:gfx-fringe 3.1s ease-in-out infinite alternate;}',
  '.gfx-sanity-vignette{left:0;top:0;width:100%;height:100%;',
  'background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 36%,rgba(0,0,0,.55) 70%,rgba(0,0,0,.93) 100%);',
  'animation:gfx-breathe 2.4s ease-in-out infinite;}',
  // 噪点层只比屏幕四周各大 64px，用 transform 跳位（只走合成器，不重绘）；关键帧位移都在 ±60px 内，边缘不会露底。
  // 颗粒图 128px 平铺，跳位幅度够看不出重复
  '.gfx-sanity-noise{left:-64px;top:-64px;width:calc(100% + 128px);height:calc(100% + 128px);',
  'background-repeat:repeat;animation:gfx-grain .5s steps(1) infinite;}',
  '@keyframes gfx-grain{0%{transform:translate3d(0,0,0)}12%{transform:translate3d(-20px,-34px,0)}',
  '25%{transform:translate3d(-49px,13px,0)}37%{transform:translate3d(23px,-53px,0)}',
  '50%{transform:translate3d(-9px,46px,0)}62%{transform:translate3d(-56px,26px,0)}',
  '75%{transform:translate3d(39px,3px,0)}87%{transform:translate3d(7px,59px,0)}100%{transform:translate3d(0,0,0)}}',
  '@keyframes gfx-fringe{from{transform:translate3d(-.8%,0,0) scale(1.01)}to{transform:translate3d(.8%,.3%,0) scale(1.03)}}',
  '@keyframes gfx-breathe{0%,100%{transform:scale(1.08)}50%{transform:scale(1)}}',
  '@media (prefers-reduced-motion:reduce){.gfx-sanity>div{animation:none!important}}',
  '.gfx-flash{z-index:40;opacity:0;}',
  '.gfx-fade{z-index:55;background:#000;opacity:0;}',
].join('\n');

const dom = { sanity: null, fringe: null, vignette: null, noise: null, noiseReady: false, flash: null, fade: null };

function mkLayer(cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.setAttribute('aria-hidden', 'true');
  return d;
}

// 懒创建：#ui 在脚本加载时可能还不存在，第一次用到才建
function ensureDom() {
  if (dom.fade) return;
  const host = document.getElementById('ui') || document.body;
  const style = document.createElement('style');
  style.className = 'gfx-style';
  style.textContent = CSS;
  host.appendChild(style);

  dom.sanity = mkLayer('gfx-layer gfx-sanity');
  dom.fringe = mkLayer('gfx-sanity-fringe');
  dom.vignette = mkLayer('gfx-sanity-vignette');
  dom.noise = mkLayer('gfx-sanity-noise');
  dom.sanity.appendChild(dom.fringe);
  dom.sanity.appendChild(dom.vignette);
  dom.sanity.appendChild(dom.noise);                 // 噪点在最上层：暗角里也有颗粒，像录像带
  dom.sanity.style.display = 'none';
  host.appendChild(dom.sanity);

  dom.flash = mkLayer('gfx-layer gfx-flash');
  dom.flash.style.display = 'none';
  host.appendChild(dom.flash);

  dom.fade = mkLayer('gfx-layer gfx-fade');
  dom.fade.style.display = 'none';
  host.appendChild(dom.fade);
}

function ensureNoise() {
  if (dom.noiseReady) return;
  dom.noiseReady = true;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return;
  const img = g.createImageData(size, size);
  const d = img.data;
  // 黑白两色的稀疏颗粒：只有灰色的话整层会变成一层雾，而不是噪点
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = (Math.random() * 110) | 0;
  }
  g.putImageData(img, 0, 0);
  // 高 DPR 屏上按设备像素铺，颗粒才细
  const px = Math.round(size / Math.min(2, window.devicePixelRatio || 1));
  dom.noise.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
  dom.noise.style.backgroundSize = px + 'px ' + px + 'px';
}

// ---------- 低 san ----------
let sanTarget = 0, sanCur = 0, sanShown = false;
const sanOp = { fringe: -1, vignette: -1, noise: -1 };
// 每层自己是否参与合成：噩梦模式 san 一掉就开覆盖层，但刚开始三层不透明度都在 0.4% 以下，肉眼看不出却各占一个全屏合成层
const SAN_LAYER_MIN = 0.004;
const sanVis = { fringe: null, vignette: null, noise: null };

function setSanityEffect(v, immediate) {
  sanTarget = U.clamp(+v || 0, 0, 1);
  if (immediate) sanCur = sanTarget;
}

function setLayerOpacity(key, o) {
  // 跨过阈值时一定写 display，并顺带把不透明度写准（下面的差值门槛可能拦住这次写入）
  const vis = o >= SAN_LAYER_MIN;
  if (sanVis[key] !== vis) {
    sanVis[key] = vis;
    dom[key].style.display = vis ? '' : 'none';
    sanOp[key] = o;
    dom[key].style.opacity = o.toFixed(3);
    return;
  }
  // 只在变化明显时写 style：稳定状态下每帧零 DOM 写入
  if (Math.abs(sanOp[key] - o) < 0.004) return;
  sanOp[key] = o;
  dom[key].style.opacity = o.toFixed(3);
}

function updateSanity(dt) {
  if (sanCur === 0 && sanTarget === 0) {
    if (sanShown) hideSanity();
    return;                                          // v=0：无 DOM、无动画、无抖动
  }
  // 平滑追目标：喝杏仁水 san 突然回升时效果渐隐而不是闪断
  sanCur = U.damp(sanCur, sanTarget, 4, dt);
  if (Math.abs(sanCur - sanTarget) < 0.002) sanCur = sanTarget;
  if (sanCur <= 0.001) { sanCur = 0; if (sanShown) hideSanity(); return; }

  if (!sanShown) {
    ensureDom();
    ensureNoise();
    dom.sanity.style.display = 'block';
    sanShown = true;
  }
  const v = sanCur;
  setLayerOpacity('vignette', Math.min(1, v * 1.25));
  setLayerOpacity('noise', 0.45 * v);
  setLayerOpacity('fringe', v * v);                // 色偏最晚出现，san 很低才明显
}

function hideSanity() {
  dom.sanity.style.display = 'none';
  sanShown = false;
  sanOp.fringe = sanOp.vignette = sanOp.noise = -1;
  sanVis.fringe = sanVis.vignette = sanVis.noise = null;   // 下次显示时每层的 display 重新写一遍
}

// 相机抖动只在 renderer.render 前后临时加上再原样还原：不管谁每帧写相机，都不会累积漂移
const shakeSave = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, order: 'XYZ' };
function applyShake(v) {
  const a = v * v * (reduceMotion ? 0.3 : 1);      // 平方：轻度掉 san 几乎察觉不到
  const t = clock;
  // 不可公约频率的正弦叠加 = 平滑但不重复的"手持"晃动，比白噪声抖动更让人不安
  const n1 = Math.sin(t * 1.7) * 0.6 + Math.sin(t * 3.9 + 1.3) * 0.4;
  const n2 = Math.sin(t * 2.3 + 0.7) * 0.6 + Math.sin(t * 5.1 + 2.1) * 0.4;
  const n3 = Math.sin(t * 1.1 + 2.9) * 0.5 + Math.sin(t * 4.3 + 0.4) * 0.5;
  // san 极低时再叠一层高频手抖
  const tremor = v > 0.6 ? ((v - 0.6) / 0.4) * Math.sin(t * 31) * Math.sin(t * 7.7) : 0;

  const p = camera.position, r = camera.rotation;
  shakeSave.px = p.x; shakeSave.py = p.y; shakeSave.pz = p.z;
  shakeSave.rx = r.x; shakeSave.ry = r.y; shakeSave.rz = r.z; shakeSave.order = r.order;
  camera.translateX(a * 0.015 * n2);
  camera.translateY(a * 0.012 * n1);
  camera.rotateY(a * 0.006 * n3);
  camera.rotateX(a * 0.005 * n2 + 0.002 * a * tremor);
  camera.rotateZ(a * 0.014 * n1);
}
function restoreShake() {
  camera.position.set(shakeSave.px, shakeSave.py, shakeSave.pz);
  camera.rotation.set(shakeSave.rx, shakeSave.ry, shakeSave.rz, shakeSave.order);
  // 帧与帧之间读 camera.matrixWorld 的模块（音频听者、射线）拿到的是没抖的姿态
  camera.updateMatrixWorld();
}

// ---------- 淡入淡出 ----------
let fadeToken = 0, fadeResolve = null, fadeTarget = 0, fadeSettled = true;

function fade(toBlack, seconds) {
  ensureDom();
  const el = dom.fade;
  const target = toBlack ? 1 : 0;
  const ms = Math.max(0, (+seconds || 0) * 1000);
  const token = ++fadeToken;
  // 被新的淡入淡出打断时让旧调用的 await 立刻继续，否则调用方会永远挂起
  if (fadeResolve) { const r = fadeResolve; fadeResolve = null; r(); }
  if (fadeSettled && fadeTarget === target) return Promise.resolve();

  fadeTarget = target;
  fadeSettled = false;
  if (target === 1) el.style.display = 'block';
  if (ms === 0) {
    el.style.transition = 'none';
    el.style.opacity = String(target);
    if (target === 0) el.style.display = 'none';
    fadeSettled = true;
    return Promise.resolve();
  }
  // 从当前实际不透明度出发（可能是被打断的半程），先提交起点再开 transition，否则刚切 display 时不会过渡
  const from = window.getComputedStyle(el).opacity;
  el.style.transition = 'none';
  el.style.opacity = from;
  void el.offsetWidth;
  el.style.transition = 'opacity ' + ms + 'ms linear';
  el.style.opacity = String(target);
  return new Promise((resolve) => {
    fadeResolve = resolve;
    // 用定时器而不是 transitionend：起止值相同或标签页在后台时 transitionend 不一定触发
    setTimeout(() => {
      if (token !== fadeToken) return;               // 已被新调用接管，那边已经 resolve 过
      fadeSettled = true;
      if (target === 0) el.style.display = 'none';  // 透明的全屏层也占合成开销，彻底拿掉
      fadeResolve = null;
      resolve();
    }, ms + 30);
  });
}

// ---------- 闪屏 ----------
let flashToken = 0, flashResolve = null;

function cssColor(c) {
  if (c == null) return '#fff';
  if (typeof c === 'number') return '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  if (c.isColor) return '#' + c.getHexString();
  return String(c);                                  // 任意 CSS 颜色，rgba 的 alpha 会和峰值相乘
}

// peak：峰值不透明度，默认 0.6 —— 受击闪红如果整屏实色太刺眼，也会把画面信息全抹掉
function flash(color, seconds, peak) {
  ensureDom();
  const el = dom.flash;
  const ms = Math.max(0, (seconds == null ? 0.3 : +seconds || 0) * 1000);
  const token = ++flashToken;
  if (flashResolve) { const r = flashResolve; flashResolve = null; r(); }
  el.style.transition = 'none';
  el.style.background = cssColor(color);
  if (ms === 0) { el.style.opacity = '0'; el.style.display = 'none'; return Promise.resolve(); }
  el.style.display = 'block';
  el.style.opacity = String(peak == null ? 0.6 : U.clamp(+peak || 0, 0, 1));
  void el.offsetWidth;
  // 先快后慢的衰减：冲击感集中在头几帧
  el.style.transition = 'opacity ' + ms + 'ms cubic-bezier(.15,.7,.35,1)';
  el.style.opacity = '0';
  return new Promise((resolve) => {
    flashResolve = resolve;
    setTimeout(() => {
      if (token !== flashToken) return;
      el.style.display = 'none';
      flashResolve = null;
      resolve();
    }, ms + 30);
  });
}

// ===================================================================
// 每帧
// ===================================================================
let warnedNoInit = false;
function render(dt) {
  if (!renderer) {
    if (!warnedNoInit) { warnedNoInit = true; console.warn('[gfx] render 之前需要先 init(canvas)'); }
    return;
  }
  dt = dt > 0 ? Math.min(dt, 0.1) : 0;             // 切后台回来的超长帧不让闪烁/淡化一步跳完
  clock += dt;

  if (envState.env && envState.follow) {
    const v = settingsVisibility();
    if (v !== envState.visibility) applyEnv(envState.env, v);
  }
  updateLights(dt);
  updateSanity(dt);

  // 游戏内视野每帧对齐 gameFov：开局时 home.hide() 写回的旧 fov、转屏后的新 aspect，都在这里纠正。
  // 主页 / 工坊 / 载入中不管，它们自己摆相机
  const scr = BR.game && BR.game.screen;
  if (scr === 'playing' || scr === 'paused' || scr === 'dead') {
    const f = gameFov(camera.aspect);
    if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); }
  }

  const shake = sanCur > 0.001;
  if (shake) applyShake(sanCur);
  renderer.render(scene, camera);
  if (shake) restoreShake();
}

// 集成阶段自查用：确认灯光预算生效、shader 数量不随走动增长
function debugInfo() {
  const lit = [];
  for (const sl of slots) if (sl.src && sl.light.intensity > 0) lit.push(sl.src);
  const info = renderer && renderer.info;
  return {
    sources: lightList.length, pool: POOL, lit,
    calls: info ? info.render.calls : 0,
    triangles: info ? info.render.triangles : 0,
    programs: info && info.programs ? info.programs.length : 0,
    pixelRatio: renderer ? renderer.getPixelRatio() : 0,
    quality, antialias: BR.gfx.antialias, toneMapping: customTone ? 'custom-hue-preserving' : 'none',
    fog: { near: scene.fog.near, far: scene.fog.far }, cameraFar: camera.far,
    sanity: sanCur,
  };
}

// 回主页时低 san 效果必须立刻消失，不依赖玩家模块记得清
BR.bus.on('game:home', () => setSanityEffect(0, true));

BR.gfx = {
  renderer: null,
  scene,
  camera,
  quality,
  antialias: false,
  qualityNeedsReload: false,   // true = 抗锯齿开关要刷新页面后才生效，设置界面可据此提示
  baseFov: 75,                 // 游戏内竖直视野；竖屏太窄时 gameFov 会放大，见 gameFov
  gameFov,                     // (aspect) → 游戏内应使用的竖直视野（度），render 每帧据此对齐 camera.fov
  init,
  applyEnv,
  setLightSources,
  setSanityEffect,
  fade,
  flash,
  setQuality,
  render,
  resize,
  flickerAt,
  debugInfo,
};
})();
