// 后室 · 音频：全部 WebAudio 程序化合成，不加载任何音频文件
// 接口见 ARCHITECTURE.md 第 12 节 BR.audio。
// 图：环境层/单次音效 → 低 san 低通 → 压缩器 → 主音量 → 扬声器；幻听总线绕过低通（"声音在脑子里"）
(function () {
'use strict';
const BR = window.BR;

const TICK_MS = 50;          // 调度器周期
const LOOKAHEAD = 0.25;      // 事件提前排进音频时钟，定时器抖动不影响节奏
const MAX_VOICES = 40;       // 单次音效同时发声上限，超出先丢低优先级
const SOFT_VOICES = 26;
const MAX_HRTF = 10;         // HRTF 每个声源都是一次卷积，太多会拖垮桌面低端机
const MAX_3D_DIST = 45;      // 更远的 3D 声源直接不发声，省节点

// ---------- 状态（unlock 之前只记状态，不碰音频） ----------
let ctx = null;
let bus = null;
let timer = 0;
let suspendedByUs = false;
const S = {
  master: 1,
  sanity: 1,
  ambientName: null,         // 期望的环境预设
  layer: null,               // 当前环境层
  listener: { x: 0, y: 1.62, z: 0, yaw: 0, set: false },
  appliedSanity: -1,         // 上次真正写进滤波器的 san，变化够大才重写
  halluNext: 0,              // 下一次幻听的音频时刻，0 = 还没排
  tinnitusEnd: 0,            // 耳鸣不叠加
};
const voices = new Set();
const lastPlay = new Map();  // 同名音效极短时间内重复触发 → 合并，防止叠加爆音
const warned = new Set();

// ---------- 小工具 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const chance = p => Math.random() < p;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[audio]', msg);
}

// 起音线性上升、指数衰减到几乎为 0。exponentialRamp 不接受 0，所以落到 1e-4 再线性归零
function ad(p, t, peak, a, d) {
  peak = Math.max(peak, 2e-4);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(1e-4, t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.01);
  return t + a + d + 0.01;
}
// 频率指数滑动（起止都必须 > 0）
function sweep(p, t, f0, f1, d) {
  p.setValueAtTime(Math.max(f0, 1), t);
  p.exponentialRampToValueAtTime(Math.max(f1, 1), t + d);
}

// ---------- 噪声与波形缓存 ----------
const noiseCache = {};
function crossfadeLoop(d, n) {
  // 首尾交叉淡化再截掉尾巴，循环接缝不出"咔"
  const len = d.length - n;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] = d[i] * k + d[len + i] * (1 - k);
  }
  return d.subarray(0, len);
}
function noiseBuf(kind) {
  if (noiseCache[kind]) return noiseCache[kind];
  const sr = ctx.sampleRate;
  const raw = new Float32Array(Math.floor(sr * 3.2));
  const N = raw.length;
  if (kind === 'white') {
    for (let i = 0; i < N; i++) raw[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet 的粉噪声近似
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < N; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    // 积分白噪声 + 隔直，否则直流漂移会在循环点跳变
    let last = 0, hp = 0, prev = 0;
    for (let i = 0; i < N; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      const x = last * 3.5;
      hp = 0.998 * (hp + x - prev); prev = x;
      raw[i] = hp;
    }
  } else if (kind === 'crackle') {
    // 稀疏随机脉冲：嚼饼干、电火花、静电噼啪共用
    let env = 0, sign = 1, amp = 0;
    for (let i = 0; i < N; i++) {
      if (Math.random() < 260 / sr) { amp = Math.pow(Math.random(), 2); env = 1; sign = Math.random() < 0.5 ? -1 : 1; }
      raw[i] = sign * amp * env * (Math.random() * 0.6 + 0.4);
      env *= 0.93;
    }
  }
  const d = crossfadeLoop(raw, Math.floor(sr * 0.05));
  const buf = ctx.createBuffer(1, d.length, sr);
  buf.getChannelData(0).set(d);
  noiseCache[kind] = buf;
  return buf;
}

// 周期波：一个振荡器给出整列谐波，比叠十几个正弦省得多。系数用固定种子，每次打开音色一致
const waveCache = {};
function harmonicWave(key, count, ampFn, seed) {
  if (waveCache[key]) return waveCache[key];
  const rng = BR.util.mulberry32(seed);
  const real = new Float32Array(count + 1), imag = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) {
    const a = ampFn(n, rng);
    const ph = rng() * Math.PI * 2;   // 随机相位 → 波峰因数低，同样峰值听起来更"满"
    real[n] = a * Math.cos(ph);
    imag[n] = a * Math.sin(ph);
  }
  waveCache[key] = ctx.createPeriodicWave(real, imag);
  return waveCache[key];
}
// 日光灯镇流器（基频按 60Hz 电网算）：磁致伸缩让偶次谐波（120/240/360Hz…）占绝对主导，奇次只剩一点
function ballastWave(variant) {
  return harmonicWave('ballast' + variant, 64, (n, rng) => {
    const jitter = 0.6 + rng() * 0.8;
    if (n % 2) return n === 1 ? 0.05 : 0.025 / n * jitter;
    const k = n / 2;   // 120Hz 的第 k 次
    const table = [1, 0.55, 0.42, 0.22, 0.3, 0.12, 0.15, 0.08, 0.1];
    if (k <= table.length) return table[k - 1] * (variant === 1 ? 1 : jitter);
    return 0.6 / Math.pow(k, 1.05) * jitter;
  }, 0xB411A57 + variant);
}
// 变压器（50Hz 电网）：100Hz 为主、奇次谐波多，听感比日光灯更粗更硬
function transformerWave() {
  return harmonicWave('transformer', 48, (n, rng) => {
    const j = 0.7 + rng() * 0.6;
    if (n === 2) return 1;
    if (n === 1) return 0.2;
    return (n % 2 ? 0.5 : 0.35) / Math.pow(n / 2, 0.8) * j;
  }, 0x7EA45F0);
}
function motorWave() {
  return harmonicWave('motor', 12, n => [0, 1, 0.5, 0.3, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01, 0.005, 0.005][n], 0x3070);
}

// 削波曲线
const curveCache = {};
function driveCurve(amount) {
  const key = 'd' + amount;
  if (curveCache[key]) return curveCache[key];
  const n = 1024, c = new Float32Array(n);
  const k = Math.tanh(amount);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * amount) / k; }
  return (curveCache[key] = c);
}
// 半波整流再取高次幂：正弦 → 尖脉冲，用来把 120Hz 调制变成"滋滋"的颗粒
function pulseCurve(power) {
  const key = 'p' + power;
  if (curveCache[key]) return curveCache[key];
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.pow(Math.max(0, x), power); }
  return (curveCache[key] = c);
}

// ---------- 离线烘焙（纯 JS DSP）：脚步/咔哒/打击这类高频短音，一次只用 1 个 BufferSource ----------
function jsBiquad(type, freq, Q, sr) {
  const w = 2 * Math.PI * Math.min(freq, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
// 包络：起音 a 秒线性上升，之后按时间常数 tau 指数衰减
const envAt = (t, t0, a, tau) => t < t0 ? 0 : t < t0 + a ? (t - t0) / a : Math.exp(-(t - t0 - a) / tau);
function bakeBuffer(seconds, fn) {
  const sr = ctx.sampleRate;
  const d = new Float32Array(Math.ceil(seconds * sr));
  fn(d, sr);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.floor(sr * 0.01);
  for (let i = 0; i < d.length; i++) {
    d[i] *= k;
    const tail = d.length - i;
    if (tail < fade) d[i] *= tail / fade;
  }
  const buf = ctx.createBuffer(1, d.length, sr);
  buf.getChannelData(0).set(d);
  return buf;
}
const BAKERS = {
  // 干脚步：脚跟闷响（低通噪声 + 一点低频体感）+ 前掌蹭地
  step() {
    return bakeBuffer(0.3, (d, sr) => {
      const lp = jsBiquad('lowpass', rand(150, 230), 0.9, sr);
      const bp = jsBiquad('bandpass', rand(700, 1500), 0.8, sr);
      const soft = jsBiquad('lowpass', rand(2800, 4200), 0.7, sr);
      const toe = rand(0.04, 0.075), bodyF = rand(62, 88), scuff = rand(0.35, 0.8);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        const heel = envAt(t, 0, 0.002, 0.024);
        const toeE = envAt(t, toe, 0.008, 0.035);
        const x = lp(w) * heel * 5 + Math.sin(2 * Math.PI * bodyF * t) * heel * 0.35
          + bp(w) * (toeE * scuff + heel * 0.25);
        d[i] = soft(x);
      }
    });
  },
  // 湿脚步：脚跟变轻，多了水花（带通噪声）和几颗上扬的小水滴
  stepWet() {
    return bakeBuffer(0.42, (d, sr) => {
      const lp = jsBiquad('lowpass', rand(260, 420), 0.8, sr);
      const splash = jsBiquad('bandpass', rand(1500, 2800), 0.9, sr);
      const squish = jsBiquad('lowpass', 700, 0.7, sr);
      const drops = [];
      for (let k = randInt(3, 7); k > 0; k--) drops.push({ t: rand(0.02, 0.28), f: rand(800, 1700), a: rand(0.15, 0.45), ph: 0 });
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        let x = lp(w) * envAt(t, 0, 0.003, 0.03) * 2.5
          + splash(w) * envAt(t, 0.004, 0.004, 0.07) * 1.4
          + squish(w) * envAt(t, 0.02, 0.02, 0.09) * 0.8;
        for (const dr of drops) {
          if (t < dr.t) continue;
          const u = t - dr.t;
          if (u > 0.08) continue;
          const f = dr.f * Math.min(2.4, Math.exp(u * 60));
          dr.ph += 2 * Math.PI * f / sr;
          x += Math.sin(dr.ph) * dr.a * Math.exp(-u / 0.014);
        }
        d[i] = x;
      }
    });
  },
  // 机械咔哒：按下 + 松开两个瞬态，外加一点塑料壳共振
  click() {
    return bakeBuffer(0.09, (d, sr) => {
      const bp = jsBiquad('bandpass', rand(2200, 3600), 1.1, sr);
      const ping = jsBiquad('bandpass', rand(3200, 5200), 14, sr);
      const rel = rand(0.022, 0.04);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        const x = w * (envAt(t, 0, 0.0005, 0.0025) + envAt(t, rel, 0.0005, 0.002) * 0.6);
        d[i] = bp(x) + ping(x) * 3;
      }
    });
  },
  // 灯管闪烁的"叮/咔"：更尖、更短，偶尔带启辉器一声低"哒"
  tink() {
    return bakeBuffer(0.12, (d, sr) => {
      const hp = jsBiquad('highpass', 2600, 0.7, sr);
      const ping = jsBiquad('bandpass', rand(3600, 6200), 22, sr);
      const tockF = rand(150, 230), tock = chance(0.4) ? rand(0.2, 0.5) : 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        const x = w * envAt(t, 0, 0.0003, 0.0018);
        d[i] = hp(x) + ping(x) * 4 + Math.sin(2 * Math.PI * tockF * t) * envAt(t, 0, 0.001, 0.012) * tock;
      }
    });
  },
  // 打击：低频扫降的"咚" + 高频脆响 + 中频拍打，再过一点饱和
  hit() {
    return bakeBuffer(0.35, (d, sr) => {
      const crack = jsBiquad('bandpass', rand(1400, 2400), 0.9, sr);
      const slap = jsBiquad('bandpass', rand(350, 550), 1.2, sr);
      const f0 = rand(120, 160), f1 = rand(45, 60);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, w = Math.random() * 2 - 1;
        const f = f1 + (f0 - f1) * Math.exp(-t / 0.03);
        ph += 2 * Math.PI * f / sr;
        const x = Math.sin(ph) * envAt(t, 0, 0.002, 0.06)
          + crack(w) * envAt(t, 0, 0.001, 0.014) * 1.6
          + slap(w) * envAt(t, 0, 0.002, 0.04) * 2.2;
        d[i] = Math.tanh(x * 1.6);
      }
    });
  },
};
const bakedSets = {};
const lastBaked = {};
function baked(name) {
  if (!bakedSets[name]) {
    const n = name === 'step' || name === 'stepWet' ? 6 : 4;
    bakedSets[name] = [];
    for (let i = 0; i < n; i++) bakedSets[name].push(BAKERS[name]());
  }
  const set = bakedSets[name];
  let i = Math.floor(Math.random() * set.length);
  if (i === lastBaked[name]) i = (i + 1) % set.length;   // 不连续两次同一个样本，避免机关枪感
  lastBaked[name] = i;
  return set[i];
}

// ---------- 总线 ----------
function buildBuses(c) {
  const b = {};
  b.ambient = c.createGain();
  b.sfx = c.createGain();
  b.hallu = c.createGain();
  // 低 san 闷声：只作用于"外界"的声音，幻听不经过它，反差才明显
  b.lp = c.createBiquadFilter();
  b.lp.type = 'lowpass';
  b.lp.frequency.value = Math.min(20000, c.sampleRate * 0.45);
  b.lp.Q.value = 0.707;
  b.comp = c.createDynamicsCompressor();
  b.comp.threshold.value = -16;
  b.comp.knee.value = 10;
  b.comp.ratio.value = 4;
  b.comp.attack.value = 0.004;
  b.comp.release.value = 0.25;
  // 主音量放在压缩器之后：调音量不改变压缩手感
  b.master = c.createGain();
  b.master.gain.value = S.master;
  b.ambient.connect(b.lp);
  b.sfx.connect(b.lp);
  b.lp.connect(b.comp);
  b.hallu.connect(b.comp);
  b.comp.connect(b.master);
  b.master.connect(c.destination);
  return b;
}

// ---------- 声部：收集节点，所有源结束后统一断开 ----------
class Voice {
  constructor(dest, pri) {
    this.nodes = [];
    this.live = 0;
    this.dead = false;
    this.pri = pri || 0;
    this.end = 0;
    this.out = this.keep(ctx.createGain());
    if (dest) this.out.connect(dest);
    voices.add(this);
  }
  keep(n) { this.nodes.push(n); return n; }
  g(v) { const n = this.keep(ctx.createGain()); n.gain.value = v; return n; }
  f(type, freq, Q) {
    const n = this.keep(ctx.createBiquadFilter());
    n.type = type; n.frequency.value = freq; if (Q !== undefined) n.Q.value = Q;
    return n;
  }
  shaper(curve) { const n = this.keep(ctx.createWaveShaper()); n.curve = curve; return n; }
  pan(v) {
    if (!ctx.createStereoPanner) return this.g(1);   // 老 Safari 没有立体声声像，退化成直通
    const n = this.keep(ctx.createStereoPanner()); n.pan.value = clamp(v, -1, 1); return n;
  }
  delay(sec, max) { const n = this.keep(ctx.createDelay(max || 1)); n.delayTime.value = sec; return n; }
  osc(type, freq, t0, t1) {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = Math.max(1, freq);
    return this.src(o, t0, t1);
  }
  noise(kind, t0, t1, rate) {
    const s = ctx.createBufferSource();
    const buf = noiseBuf(kind);
    s.buffer = buf; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    return this.src(s, t0, t1, Math.random() * (buf.duration - 0.2));
  }
  // 烘焙样本直接接到 dest（缺省 v.out）；其他源由调用方自己串
  buf(buffer, t0, rate, dest) {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate || 1;
    s.connect(dest || this.out);
    return this.src(s, t0, t0 + buffer.duration / (rate || 1) + 0.02);
  }
  src(s, t0, t1, offset) {
    this.keep(s);
    this.live++;
    s.onended = () => { if (--this.live <= 0) this.dispose(); };
    s.start(Math.max(0, t0), offset || 0);
    s.stop(Math.max(t0 + 0.01, t1));
    if (t1 > this.end) this.end = t1;
    return s;
  }
  // 兜底：万一某个源的 onended 没触发（异常中断），过期后强制回收
  arm() {
    const c = ctx;   // 离线渲染会临时换掉 ctx，回收判断要看声部自己所属的上下文
    const check = () => {
      if (this.dead || !c) return;
      if (c.state === 'closed' || c.currentTime > this.end + 1) this.dispose();
      else setTimeout(check, 2000);
    };
    setTimeout(check, Math.max(500, (this.end - c.currentTime) * 1000 + 3000));
    return this;
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    if (this.hrtf) hrtfCount--;
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* 已断开 */ } }
    this.nodes.length = 0;
    voices.delete(this);
  }
}
// 声部内串联，返回最后一个节点
function chain() {
  for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
  return arguments[arguments.length - 1];
}

// ---------- 3D 声源 ----------
function isTouch() {
  if (BR.input && typeof BR.input.isTouch === 'boolean') return BR.input.isTouch;
  try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { return false; }
}
let hrtfCount = 0;
function readPos(pos) {
  if (!pos) return null;
  if (Array.isArray(pos)) return { x: +pos[0] || 0, y: pos[1] === undefined ? S.listener.y : +pos[1], z: +pos[2] || 0 };
  if (typeof pos.x !== 'number' || typeof pos.z !== 'number') return null;
  return { x: pos.x, y: typeof pos.y === 'number' ? pos.y : S.listener.y, z: pos.z };
}
// 在声部里插一个 PannerNode（和可选的隔墙低通），返回声部应该接入的节点
function makeSpatial(v, p, dest) {
  const pn = v.keep(ctx.createPanner());
  const useHrtf = !isTouch() && hrtfCount < MAX_HRTF;
  pn.panningModel = useHrtf ? 'HRTF' : 'equalpower';
  if (useHrtf) { hrtfCount++; v.hrtf = true; }
  pn.distanceModel = 'inverse';
  pn.refDistance = 1.6;
  pn.rolloffFactor = 1.1;
  pn.maxDistance = 60;
  if (pn.positionX) {
    pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z;
  } else {
    pn.setPosition(p.x, p.y, p.z);
  }
  let head = pn;
  // 隔墙：视线被挡就削高频、压音量。只在发声那一刻判断一次，单次音效很短，够用
  if (BR.phys && typeof BR.phys.los === 'function' && S.listener.set) {
    let clear = true;
    try { clear = BR.phys.los(S.listener.x, S.listener.y, S.listener.z, p.x, p.y, p.z); } catch (e) { clear = true; }
    if (clear === false) {
      const lp = v.f('lowpass', 750, 0.6);
      const g = v.g(0.6);
      chain(lp, g, pn);
      head = lp;
    }
  }
  pn.connect(dest);
  return head;
}
function applyListener() {
  if (!ctx) return;
  const L = ctx.listener, s = S.listener;
  // yaw = 0 面朝 -Z：前方 = (-sin, 0, -cos)，与 player.js / 相机 'YXZ' 约定一致
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  if (L.positionX) {
    L.positionX.value = s.x; L.positionY.value = s.y; L.positionZ.value = s.z;
    L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(s.x, s.y, s.z);
    L.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

// ---------- 单次音效 ----------
// fn(v, t, r)：往 v.out 里合成；t 为开始时刻，r 为速率（>1 更快更高）
// level 为该音效基础响度，pri 为优先级（发声数超限时先丢低的）
const SFX = {};

SFX.step = { level: 0.42, pri: 0, fn(v, t, r) { v.buf(baked('step'), t, r); } };
SFX['step-wet'] = { level: 0.45, pri: 0, fn(v, t, r) { v.buf(baked('stepWet'), t, r); } };
SFX.click = { level: 0.45, pri: 0, fn(v, t, r) { v.buf(baked('click'), t, r); } };
SFX.hit = { level: 0.8, pri: 1, fn(v, t, r) { v.buf(baked('hit'), t, r); } };

SFX.pickup = { level: 0.42, pri: 2, fn(v, t, r) {
  // 上行五度的两个柔和音头 + 一点摩擦声：有反馈感，但别像金币声那样出戏
  const lp = v.f('lowpass', 2600, 0.7);
  lp.connect(v.out);
  const f0 = pick([523.25, 587.33]);
  [f0, f0 * 1.4983].forEach((f, i) => {
    const tt = t + i * 0.075 / r;
    const o = v.osc('triangle', f * r, tt, tt + 0.35 / r);
    const g = v.g(0);
    ad(g.gain, tt, 0.5, 0.006, 0.25 / r);
    chain(o, g, lp);
  });
  const n = v.noise('white', t, t + 0.14 / r);
  const g = v.g(0);
  ad(g.gain, t, 0.2, 0.01, 0.11 / r);
  chain(n, v.f('bandpass', 2400, 0.8), g, v.out);
} };

SFX.drink = { level: 0.6, pri: 1, fn(v, t, r) {
  // 2–3 口吞咽：每口 = 下滑的喉部共鸣"咕" + 液体带通噪声 + 两颗上扬的小气泡
  const n = randInt(2, 3);
  for (let i = 0; i < n; i++) {
    const tt = t + (0.06 + i * rand(0.34, 0.42)) / r;
    const o = v.osc('sine', 400, tt, tt + 0.2 / r);
    sweep(o.frequency, tt, rand(360, 440) * r, rand(140, 180) * r, 0.11 / r);
    const g = v.g(0);
    ad(g.gain, tt, 0.6, 0.012, 0.13 / r);
    chain(o, v.f('lowpass', 800, 1.2), g, v.out);
    const nz = v.noise('white', tt - 0.03 / r, tt + 0.16 / r);
    const gn = v.g(0);
    ad(gn.gain, tt - 0.03 / r, 1.2, 0.02, 0.11 / r);
    chain(nz, v.f('bandpass', rand(800, 1300) * r, 2.5), gn, v.out);
    for (let k = 0; k < 2; k++) {
      const tb = tt + rand(0.02, 0.12) / r;
      const b = v.osc('sine', 700, tb, tb + 0.06 / r);
      sweep(b.frequency, tb, rand(600, 900) * r, rand(1300, 1900) * r, 0.02 / r);
      const gb = v.g(0);
      ad(gb.gain, tb, 0.18, 0.002, 0.035 / r);
      chain(b, gb, v.out);
    }
  }
} };

SFX.eat = { level: 0.55, pri: 1, fn(v, t, r) {
  // 3–4 下咀嚼：稀疏脉冲噪声 → 脆响；带通噪声 → 口腔里的闷声
  const n = randInt(3, 4);
  const len = (n * 0.27 + 0.25) / r;
  const hp = v.f('highpass', 1300, 0.7);
  const bp = v.f('bandpass', 520, 0.9);
  const gc = v.g(0), gm = v.g(0);
  chain(v.noise('crackle', t, t + len, rand(0.8, 1.2) * r), gc, hp, v.out);
  chain(v.noise('white', t, t + len), gm, bp, v.out);
  let tt = t;
  for (let i = 0; i < n; i++) {
    const d = rand(0.07, 0.11) / r;
    ad(gc.gain, tt, rand(3, 4.5), 0.006, d);
    ad(gm.gain, tt, 1.4, 0.015, d * 1.3);
    tt += rand(0.2, 0.27) / r;
  }
} };

SFX.hurt = { level: 0.8, pri: 2, fn(v, t, r) {
  // 钝击 + 倒吸一口气 + 短暂耳鸣。不合成"啊"的人声：合成人声很容易出戏
  const o = v.osc('sine', 120, t, t + 0.35 / r);
  sweep(o.frequency, t, 130 * r, 42 * r, 0.14 / r);
  const g = v.g(0);
  ad(g.gain, t, 1, 0.002, 0.26 / r);
  chain(o, v.shaper(driveCurve(2)), g, v.out);
  const n = v.noise('white', t, t + 0.6 / r);
  const gc = v.g(0);
  ad(gc.gain, t, 0.9, 0.001, 0.06 / r);
  chain(n, v.f('bandpass', 1500, 0.7), gc, v.out);
  const tg = t + 0.07 / r;
  const gg = v.g(0);
  gg.gain.setValueAtTime(0, tg);
  gg.gain.linearRampToValueAtTime(1.6, tg + 0.06 / r);
  gg.gain.exponentialRampToValueAtTime(1e-3, tg + 0.32 / r);
  gg.gain.linearRampToValueAtTime(0, tg + 0.34 / r);
  const f1 = v.f('bandpass', 1100 * r, 3), f2 = v.f('bandpass', 2500 * r, 4);
  n.connect(f1); n.connect(f2); f1.connect(gg); f2.connect(gg); gg.connect(v.out);
  const ring = v.osc('sine', rand(3000, 3600), t + 0.02, t + 1.2 / r);
  const gr = v.g(0);
  ad(gr.gain, t + 0.02, 0.025, 0.05, 0.9 / r);
  chain(ring, gr, v.out);
} };

SFX.death = { level: 0.9, pri: 3, fn(v, t, r) {
  const T = x => t + x / r;
  // 沉到次声的轰鸣
  const boom = v.osc('sine', 70, t, T(3));
  sweep(boom.frequency, t, 75 * r, 22 * r, 1.8 / r);
  const gb = v.g(0);
  ad(gb.gain, t, 1, 0.006, 2.4 / r);
  chain(boom, gb, v.out);
  const gbr = v.g(0);
  ad(gbr.gain, t, 0.9, 0.01, 1.5 / r);
  chain(v.noise('brown', t, T(2)), v.f('lowpass', 220, 0.7), gbr, v.out);
  // 呼啸：带通噪声从高扫到低
  const bp = v.f('bandpass', 3500, 4);
  sweep(bp.frequency, t, 3600 * r, 180 * r, 1.7 / r);
  const gw = v.g(0);
  ad(gw.gain, t, 1.6, 0.08 / r, 1.9 / r);
  chain(v.noise('white', t, T(2.2)), bp, gw, v.out);
  // 不协和音簇一起往下滑，低通越收越紧
  const lp = v.f('lowpass', 2200, 1.5);
  sweep(lp.frequency, t, 2200, 260, 2.6 / r);
  const gc = v.g(0);
  ad(gc.gain, t, 0.22, 0.12 / r, 2.8 / r);
  chain(lp, v.shaper(driveCurve(3)), gc, v.out);
  [1, 1.059, 1.189].forEach(k => {
    const o = v.osc('sawtooth', 220 * k * r, t, T(3.1));
    sweep(o.frequency, t, 220 * k * r, 80 * k * r, 2.8 / r);
    o.connect(lp);
  });
  // 最后只剩耳鸣
  const gt = v.g(0);
  gt.gain.setValueAtTime(0, T(0.3));
  gt.gain.linearRampToValueAtTime(0.03, T(1.0));
  gt.gain.setValueAtTime(0.03, T(2.4));
  gt.gain.linearRampToValueAtTime(0, T(4.3));
  chain(v.osc('sine', 6800, T(0.3), T(4.4)), gt, v.out);
} };

// 耳语 = 声带不振动的语音：白噪声过两组共振峰，每个音节换一个元音；辅音用高通噪声的短促嘶声
const VOWELS = [[800, 1200], [400, 2000], [300, 2300], [500, 900], [350, 700], [600, 1700]];
function synthWhisper(v, t, r, dur) {
  const src = v.noise('white', t, t + dur + 0.15);
  const f1 = v.f('bandpass', 700, 4), f2 = v.f('bandpass', 1800, 5), sib = v.f('highpass', 4500, 0.7);
  const g1 = v.g(3.2), g2 = v.g(2.6), env = v.g(0), gs = v.g(0);
  src.connect(f1); src.connect(f2); src.connect(sib);
  chain(f1, g1, env); chain(f2, g2, env); env.connect(v.out);
  chain(sib, gs, v.out);
  let tt = t;
  while (tt < t + dur) {
    const syl = rand(0.08, 0.2) / r;
    const vw = pick(VOWELS), k = r * rand(1.05, 1.3);
    f1.frequency.setTargetAtTime(vw[0] * k, tt, 0.012);
    f2.frequency.setTargetAtTime(vw[1] * k, tt, 0.012);
    if (chance(0.45)) {
      const c = rand(0.03, 0.07) / r;
      gs.gain.setValueAtTime(0, tt);
      gs.gain.linearRampToValueAtTime(rand(0.08, 0.22), tt + c * 0.3);
      gs.gain.linearRampToValueAtTime(0, tt + c);
      tt += c * 0.7;
    }
    env.gain.setValueAtTime(0, tt);
    env.gain.linearRampToValueAtTime(rand(0.5, 1), tt + syl * 0.35);
    env.gain.linearRampToValueAtTime(0, tt + syl);
    tt += syl + (chance(0.22) ? rand(0.1, 0.3) : rand(0.005, 0.03)) / r;
  }
}
SFX.whisper = { level: 0.5, pri: 1, fn(v, t, r) { synthWhisper(v, t, r, rand(1.0, 2.2) / r); } };

// 心音 lub-dub：手机喇叭放不出 50Hz，所以从 100Hz 往下扫，并叠一点低通噪声让小喇叭也"听得见"
function synthBeat(v, t, r, amp) {
  [[0, 1, 105, 48], [0.27, 0.72, 95, 52]].forEach(b => {
    const tt = t + b[0] / r;
    const o = v.osc('sine', b[2], tt, tt + 0.22 / r);
    sweep(o.frequency, tt, b[2] * r, b[3] * r, 0.08 / r);
    const g = v.g(0);
    ad(g.gain, tt, amp * b[1], 0.006, 0.15 / r);
    chain(o, g, v.out);
  });
  const gn = v.g(0);
  ad(gn.gain, t, 1.2 * amp, 0.004, 0.07 / r);
  ad(gn.gain, t + 0.27 / r, 0.8 * amp, 0.004, 0.06 / r);
  chain(v.noise('brown', t, t + 0.45 / r), v.f('lowpass', 260, 0.8), gn, v.out);
}
SFX.heartbeat = { level: 0.85, pri: 1, fn(v, t, r) { synthBeat(v, t, r, 1); } };

SFX.giggle = { level: 0.5, pri: 1, fn(v, t, r) {
  // "嘻嘻嘻"：每个音节先一口气声 h，再一小段高音锯齿过元音共振峰，音高逐个下行。
  // 合成味重一点反而更瘆人——笑魇那种"不像人"的笑
  const n = randInt(4, 8);
  let f = rand(420, 560) * r;
  const end = t + (n * 0.16 + 0.6) / r;
  const src = v.osc('sawtooth', f, t, end);
  const vg = v.g(f * 0.025);
  chain(v.osc('sine', rand(5, 7), t, end), vg);
  vg.connect(src.frequency);
  const venv = v.g(0), bg = v.g(0);
  src.connect(venv);
  // 一点回声，像在空房间里笑
  const echo = v.delay(0.11), fb = v.g(0.28), wet = v.g(0.35);
  chain(echo, v.f('lowpass', 3000, 0.7), fb, echo);
  chain(fb, wet, v.out);
  [[700, 3, 2.2], [2800, 5, 1.6]].forEach(p => {
    const g = v.g(p[2]);
    chain(venv, v.f('bandpass', p[0], p[1]), g, v.out);
    g.connect(echo);
  });
  chain(v.noise('white', t, end), v.f('bandpass', 2200, 1), bg, v.out);
  bg.connect(echo);
  let tt = t;
  for (let i = 0; i < n; i++) {
    ad(bg.gain, tt, 0.6, 0.012, 0.03 / r);
    const tv = tt + 0.03 / r;
    src.frequency.setValueAtTime(f, tv);
    src.frequency.exponentialRampToValueAtTime(f * 0.9, tv + 0.08 / r);
    venv.gain.setValueAtTime(0, tv);
    venv.gain.linearRampToValueAtTime(0.7, tv + 0.012);
    venv.gain.linearRampToValueAtTime(0.45, tv + 0.05 / r);
    venv.gain.linearRampToValueAtTime(0, tv + 0.085 / r);
    f *= rand(0.93, 0.985);
    tt += rand(0.11, 0.16) / r;
  }
} };

SFX.growl = { level: 0.75, pri: 1, fn(v, t, r) {
  // 低吼：低频锯齿 + 噪声抖音高 + 30Hz 左右调幅（喉部颤动的"咕噜噜"）+ 会张合的共振低通
  const dur = rand(0.9, 1.6) / r, end = t + dur + 0.1;
  const f = rand(55, 80) * r;
  const o1 = v.osc('sawtooth', f, t, end);
  const o2 = v.osc('square', f * 0.5, t, end);   // 次谐波让体型听起来更大
  const jit = v.g(f * 0.18);
  chain(v.noise('brown', t, end, 0.5), jit);
  jit.connect(o1.frequency);
  const mix = v.g(1), g2 = v.g(0.35);
  o1.connect(mix);
  chain(o2, g2, mix);
  const trem = v.g(0.6), lg = v.g(0.4);
  chain(v.osc('sine', rand(22, 34), t, end), lg);
  lg.connect(trem.gain);
  const lp = v.f('lowpass', 300 * r, 5);
  lp.frequency.setValueAtTime(300 * r, t);
  lp.frequency.linearRampToValueAtTime(900 * r, t + dur * 0.4);
  lp.frequency.linearRampToValueAtTime(380 * r, t + dur);
  const env = v.g(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.9, t + dur * 0.25);
  env.gain.linearRampToValueAtTime(0.7, t + dur * 0.75);
  env.gain.linearRampToValueAtTime(0, t + dur);
  chain(mix, v.shaper(driveCurve(2.5)), trem, lp, env, v.out);
  const be = v.g(0);
  be.gain.setValueAtTime(0, t);
  be.gain.linearRampToValueAtTime(0.8, t + dur * 0.3);
  be.gain.linearRampToValueAtTime(0, t + dur);
  chain(v.noise('white', t, end), v.f('bandpass', 700, 0.8), be, v.out);
} };

SFX.screech = { level: 0.5, pri: 2, fn(v, t, r) {
  // 尖啸：两路失谐锯齿 + 快速颤音 + 环形调制（金属感，明显"不是人"）→ 硬削波
  const dur = rand(0.7, 1.2) / r, end = t + dur + 0.05;
  const base = rand(1000, 1400) * r;
  const o1 = v.osc('sawtooth', base, t, end), o2 = v.osc('sawtooth', base * 1.07, t, end);
  [o1, o2].forEach((o, i) => {
    const k = i ? 1.07 : 1;
    o.frequency.setValueAtTime(base * k * 0.7, t);
    o.frequency.exponentialRampToValueAtTime(base * k * 1.15, t + 0.12 / r);
    o.frequency.exponentialRampToValueAtTime(base * k * 0.78, t + dur);
  });
  const vg = v.g(base * 0.05);
  chain(v.osc('sine', rand(9, 13), t, end), vg);
  vg.connect(o1.frequency); vg.connect(o2.frequency);
  const ring = v.g(0), dry = v.g(0.5), sum = v.g(1);
  v.osc('sine', rand(170, 260) * r, t, end).connect(ring.gain);   // gain 在 ±1 之间摆 = 环形调制
  o1.connect(ring); o2.connect(ring); o1.connect(dry); o2.connect(dry);
  ring.connect(sum); dry.connect(sum);
  const env = v.g(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.03);
  env.gain.linearRampToValueAtTime(0.6, t + dur * 0.7);
  env.gain.linearRampToValueAtTime(0, t + dur);
  chain(sum, v.shaper(driveCurve(4)), v.f('highpass', 600, 0.7), v.f('lowpass', 7000, 0.7), env, v.out);
  const he = v.g(0);
  he.gain.setValueAtTime(0, t);
  he.gain.linearRampToValueAtTime(0.6, t + 0.05);
  he.gain.linearRampToValueAtTime(0, t + dur);
  chain(v.noise('white', t, end), v.f('bandpass', 4500, 1), he, v.out);
} };

SFX.door = { level: 0.6, pri: 1, fn(v, t, r) {
  // 门轴吱呀：粘滑摩擦 = 不规则的低频脉冲串，敲在几个木头共振峰上；最后门板合上"咚"+锁舌"咔"
  const cd = rand(0.5, 1.0) / r;
  const saw = v.osc('sawtooth', rand(35, 60) * r, t, t + cd + 0.05);
  for (let tt = t; tt < t + cd; tt += rand(0.03, 0.07) / r) saw.frequency.setTargetAtTime(rand(22, 95) * r, tt, 0.02);
  const env = v.g(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.9, t + 0.08 / r);
  env.gain.setValueAtTime(0.9, t + cd - 0.1 / r);
  env.gain.linearRampToValueAtTime(0, t + cd);
  saw.connect(env);
  [[650, 12, 5], [1450, 14, 4], [2300, 10, 2.5]].forEach(p => {
    const g = v.g(p[2]);
    chain(env, v.f('bandpass', p[0] * r * rand(0.9, 1.1), p[1]), g, v.out);
  });
  const tc = t + cd + rand(0.05, 0.2) / r;
  const th = v.osc('sine', 90, tc, tc + 0.3);
  sweep(th.frequency, tc, 95 * r, 45 * r, 0.1);
  const gt = v.g(0);
  ad(gt.gain, tc, 0.9, 0.003, 0.18);
  chain(th, gt, v.out);
  const gn = v.g(0);
  ad(gn.gain, tc, 2, 0.002, 0.08);
  chain(v.noise('white', tc, tc + 0.2), v.f('lowpass', 380, 0.7), gn, v.out);
  const gk = v.g(0.5);
  gk.connect(v.out);
  v.buf(baked('click'), tc + 0.025, 0.7 * r, gk);
} };

SFX.noclip = { level: 0.8, pri: 3, fn(v, t, r) {
  const T = 1.6 / r, te = t + T;
  // ① 被拉扯：带通噪声从低扫到高、Q 越来越尖、音量指数上升，然后突然掐断——"没了"的那一下就是穿出去的瞬间
  const bp = v.f('bandpass', 180, 0.7);
  sweep(bp.frequency, t, 180, 6500, T);
  bp.Q.setValueAtTime(0.7, t);
  bp.Q.linearRampToValueAtTime(9, te);
  const gs = v.g(0);
  gs.gain.setValueAtTime(0.001, t);
  gs.gain.exponentialRampToValueAtTime(2.2, te - 0.03);
  gs.gain.linearRampToValueAtTime(0, te);
  chain(v.noise('white', t, te + 0.02), bp, gs, v.out);
  // ② 撕裂：两路锯齿反向滑开，硬削波
  const sh = v.shaper(driveCurve(5)), gr = v.g(0);
  gr.gain.setValueAtTime(0, t + T * 0.35);
  gr.gain.linearRampToValueAtTime(0.35, te - 0.03);
  gr.gain.linearRampToValueAtTime(0, te);
  chain(sh, v.f('lowpass', 5000, 0.7), gr, v.out);
  [[220, 2400], [210, 38]].forEach(p => {
    const o = v.osc('sawtooth', p[0] * r, t + T * 0.35, te + 0.02);
    sweep(o.frequency, t + T * 0.35, p[0] * r, p[1] * r, T * 0.65);
    o.connect(sh);
  });
  // ③ 数字故障：方波随机跳频、随机开关
  const sq = v.osc('square', 400, t + T * 0.3, te);
  const gq = v.g(0);
  for (let tt = t + T * 0.3; tt < te - 0.03; tt += rand(0.025, 0.05)) {
    sq.frequency.setValueAtTime(rand(150, 3200), tt);
    gq.gain.setValueAtTime(chance(0.6) ? rand(0.04, 0.12) : 0, tt);
  }
  gq.gain.setValueAtTime(0, te - 0.02);
  chain(sq, gq, v.out);
  // ④ 落地：低沉的"嗡"和气压变化
  const boom = v.osc('sine', 80, te, te + 1.2);
  sweep(boom.frequency, te, 85, 28, 0.9);
  const gb = v.g(0);
  ad(gb.gain, te, 1, 0.004, 0.95);
  chain(boom, gb, v.out);
  const gn = v.g(0);
  ad(gn.gain, te, 1.6, 0.005, 0.6);
  chain(v.noise('brown', te, te + 0.8), v.f('lowpass', 200, 0.7), gn, v.out);
} };

SFX.buzz = { level: 0.4, pri: 1, fn(v, t, r) {
  // 短路/电击：富谐波的工频嗡 + 随机断续 + 噼啪
  const dur = rand(0.35, 0.7) / r, te = t + dur;
  const mix = v.g(1), g2 = v.g(0.25), gate = v.g(0);
  v.osc(ballastWave(2), 60 * r, t, te + 0.02).connect(mix);
  chain(v.osc('square', 120 * r, t, te + 0.02), g2, mix);
  for (let tt = t; tt < te; tt += rand(0.015, 0.045) / r) gate.gain.setValueAtTime(chance(0.75) ? rand(0.5, 1) : 0.05, tt);
  gate.gain.setValueAtTime(0, te);
  chain(mix, v.shaper(driveCurve(3)), v.f('bandpass', 1600, 0.6), gate, v.out);
  const gc = v.g(0);
  gc.gain.setValueAtTime(4, t);
  gc.gain.setValueAtTime(0, te);
  chain(v.noise('crackle', t, te + 0.02, rand(1, 1.6)), v.f('highpass', 2000, 0.7), gc, v.out);
} };

SFX.static = { level: 0.35, pri: 1, fn(v, t, r) {
  // 无线电雪花：宽带噪声 + 随机颤动的包络 + 噼啪 + 一丝跑调的载波哨音
  const dur = rand(0.5, 0.9) / r, te = t + dur;
  const gate = v.g(0);
  gate.gain.setValueAtTime(0, t);
  for (let tt = t + 0.01; tt < te - 0.05; tt += rand(0.01, 0.035)) gate.gain.setValueAtTime(rand(0.25, 1), tt);
  gate.gain.linearRampToValueAtTime(0, te);
  chain(v.noise('white', t, te + 0.02), v.f('bandpass', 2800 * r, 0.5), gate, v.out);
  const gc = v.g(3);
  chain(v.noise('crackle', t, te, 1.3), v.f('highpass', 1500, 0.7), gc, gate);
  const wh = v.osc('sine', rand(900, 2400), t, te);
  wh.frequency.linearRampToValueAtTime(rand(900, 2400), te);
  const gw = v.g(0.04);
  chain(wh, gw, gate);
} };

SFX.breath = { level: 0.35, pri: 0, fn(v, t, r) {
  // 慢吸慢呼：吸气更亮更窄，呼气更闷更长
  const ti = 0.9 / r, tp = 0.15 / r, tx = 1.2 / r;
  const bp = v.f('bandpass', 1000 * r, 1.5), env = v.g(0);
  bp.frequency.setValueAtTime(1000 * r, t);
  bp.frequency.linearRampToValueAtTime(1600 * r, t + ti);
  bp.frequency.setValueAtTime(900 * r, t + ti + tp);
  bp.frequency.linearRampToValueAtTime(600 * r, t + ti + tp + tx);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1.2, t + ti * 0.85);
  env.gain.linearRampToValueAtTime(0, t + ti);
  env.gain.setValueAtTime(0, t + ti + tp);
  env.gain.linearRampToValueAtTime(1.6, t + ti + tp + 0.2 / r);
  env.gain.linearRampToValueAtTime(0, t + ti + tp + tx);
  chain(v.noise('white', t, t + ti + tp + tx + 0.05), bp, env, v.out);
} };

// 实体/层级定义里常见的别名（ARCHITECTURE 第 6 节示例就写了 breath / scream）
const SFX_ALIAS = {
  scream: 'screech', shriek: 'screech', laugh: 'giggle', roar: 'growl', footstep: 'step', splash: 'step-wet',
  zap: 'buzz', shock: 'buzz', attack: 'hit', punch: 'hit', heart: 'heartbeat', exit: 'noclip',
};

// ---------- 环境层 ----------
// 每个预设 = 少量长期运行的节点 + 调度器按时间随机触发的小瞬态（咔哒、滴水……）
class Layer {
  constructor(name, dest, now) {
    this.name = name;
    this.now = now;
    this.nodes = [];
    this.sources = [];
    this.events = [];
    this.dead = false;
    this.out = this.keep(ctx.createGain());
    this.out.gain.value = 0;
    this.out.connect(dest);
  }
  keep(n) { this.nodes.push(n); return n; }
  gain(v) { const n = this.keep(ctx.createGain()); n.gain.value = v; return n; }
  filter(type, freq, Q) {
    const n = this.keep(ctx.createBiquadFilter());
    n.type = type; n.frequency.value = freq; if (Q !== undefined) n.Q.value = Q;
    return n;
  }
  pan(v) {
    if (!ctx.createStereoPanner) return this.gain(1);
    const n = this.keep(ctx.createStereoPanner()); n.pan.value = v; return n;
  }
  delay(sec, max) { const n = this.keep(ctx.createDelay(max || 1)); n.delayTime.value = sec; return n; }
  shaper(curve) { const n = this.keep(ctx.createWaveShaper()); n.curve = curve; return n; }
  osc(type, freq) {
    const o = this.keep(ctx.createOscillator());
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq;
    o.start(this.now);
    this.sources.push(o);
    return o;
  }
  loop(buf, rate) {
    const s = this.keep(ctx.createBufferSource());
    s.buffer = buf; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(this.now, Math.random() * (buf.duration - 0.2));
    this.sources.push(s);
    return s;
  }
  noise(kind, rate) { return this.loop(noiseBuf(kind), rate); }
  // 两路不同起点的同一种噪声并成立体声：环境床不会"缩在脑袋正中"
  wide(kind) {
    const buf = typeof kind === 'string' ? noiseBuf(kind) : kind;
    if (!ctx.createChannelMerger) return this.loop(buf);
    const m = this.keep(ctx.createChannelMerger(2));
    this.loop(buf).connect(m, 0, 0);
    this.loop(buf).connect(m, 0, 1);
    return m;
  }
  // 周期事件：fn(t) 可返回下一次间隔（秒），否则在 [min, max] 里随机
  every(min, max, fn, first) {
    this.events.push({ next: this.now + (first !== undefined ? first : rand(min, max)), min, max, fn });
  }
  // 环境里的瞬态声部：不计入单次音效的发声上限（数量由预设自己控制）
  // dest 缺省接 L.out；传层内节点（隔墙低通、留声机喇叭）时只走那条路
  spawn(fn, panV, dest) {
    const v = new Voice(null, -1);
    let tail = v.out;
    if (panV !== undefined) { tail = v.pan(panV); v.out.connect(tail); }
    tail.connect(dest || this.out);
    v.tail = tail;
    fn(v);
    return v.arm();
  }
  tick(now, ahead) {
    for (const ev of this.events) {
      if (ev.next < now - 1) ev.next = now + 0.05;   // 挂起/切后台回来：丢掉错过的事件，别一口气全补上
      let guard = 0;
      while (ev.next < ahead && guard++ < 64) {
        const t = Math.max(ev.next, now);
        let ret;
        try { ret = ev.fn(t); } catch (e) { console.error('[audio] 环境事件出错', this.name, e); ret = 5; }
        ev.next = t + (typeof ret === 'number' ? ret : rand(ev.min, ev.max));
      }
    }
  }
  stop(t, sec) {
    if (this.dead) return;
    this.dead = true;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + sec);
    for (const s of this.sources) { try { s.stop(t + sec + 0.05); } catch (e) { /* 已停 */ } }
    setTimeout(() => this.dispose(), (sec + 0.5) * 1000);
  }
  dispose() {
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* 已断开 */ } }
    this.nodes.length = 0;
    this.sources.length = 0;
    this.events.length = 0;
  }
}

// 水滴声主要来自落水瞬间的小气泡共振：正弦在十几毫秒内快速上扬，再指数衰减
function synthDrip(v, t, amp, pitch) {
  const f0 = pitch * rand(0.85, 1.2);
  const o = v.osc('sine', f0, t, t + 0.14);
  sweep(o.frequency, t, f0, f0 * rand(1.8, 2.6), rand(0.015, 0.03));
  const g = v.g(0);
  ad(g.gain, t, amp, 0.002, rand(0.06, 0.11));
  chain(o, g, v.out);
}
// 金属管敲击：几条不成谐波比例的衰减正弦（圆管弯曲振动模态），越高的模态衰减越快
function synthMetal(v, t, f, amp, decay) {
  [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]].forEach((p, i) => {
    const o = v.osc('sine', f * p[0], t, t + decay + 0.05);
    const g = v.g(0);
    ad(g.gain, t, amp * p[1], 0.002, decay / (1 + i));
    chain(o, g, v.out);
  });
  const gn = v.g(0);
  ad(gn.gain, t, amp * 2, 0.001, 0.02);
  chain(v.noise('white', t, t + 0.06), v.f('bandpass', f * 4, 1), gn, v.out);
}
// 打在窗上的雨点：预先算一段稀疏的"嗒嗒"循环播放，比每滴都建节点省得多
function rainDropsBuf() {
  if (noiseCache.rain) return noiseCache.rain;
  const sr = ctx.sampleRate, N = Math.floor(sr * 4.2);
  const d = new Float32Array(N);
  for (let k = Math.floor(4.2 * 55); k > 0; k--) {
    const i0 = Math.floor(Math.random() * N);
    const amp = Math.pow(Math.random(), 2.5);
    const f = rand(1800, 5000), tau = rand(0.002, 0.008);
    const len = Math.floor(tau * 6 * sr);
    for (let j = 0; j < len && i0 + j < N; j++) {
      const t = j / sr;
      d[i0 + j] += (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau) + (Math.random() * 2 - 1) * Math.exp(-t / (tau * 0.4)) * 0.5) * amp;
    }
  }
  const out = crossfadeLoop(d, Math.floor(sr * 0.05));
  const buf = ctx.createBuffer(1, out.length, sr);
  buf.getChannelData(0).set(out);
  return (noiseCache.rain = buf);
}

const AMB = {};
// 各预设整体增益：用自测页离线渲染的 RMS 对齐，切层级时音量不会忽大忽小
const AMB_LEVEL = {
  fluorescent: 0.8, pipes: 0.8, electrical: 0.7, 'office-rain': 0.8, hotel: 0.8, dark: 1, ocean: 0.8,
  cave: 0.9, 'suburb-night': 0.8, 'wind-field': 0.8, city: 0.8, party: 0.7, chase: 0.7,
};

AMB.fluorescent = L => {
  // 原始后室是北美办公室：60Hz 电网 → 镇流器以 120Hz 为主。
  // 两支"灯管"谐波表略不同并失谐 0.04Hz：第 n 次谐波以 n×0.04Hz 拍频起伏，就是多盏灯叠在一起时那种缓慢"滚动"的嗡声
  const humLP = L.filter('lowpass', 2200, 0.5);
  const drift = L.gain(1), flick = L.gain(1);
  chain(humLP, drift, flick, L.out);
  const gA = L.gain(0.5), gB = L.gain(0.32);
  chain(L.osc(ballastWave(1), 60), gA, L.pan(-0.25), humLP);
  chain(L.osc(ballastWave(2), 60.04), gB, L.pan(0.3), humLP);
  // 滋滋颗粒：带通噪声被 120Hz 尖脉冲调制——放电跟着电流过零点一顿一顿
  const white = L.noise('white');
  const am = L.gain(0), buzzG = L.gain(0.5);
  chain(L.osc('sine', 120), L.shaper(pulseCurve(6))).connect(am.gain);
  chain(white, L.filter('bandpass', 3200, 0.9), am, buzzG, flick);
  // 高频电流声：一根很细的啸叫 + 高通嘶声
  const whine = L.gain(0.005);
  chain(L.osc('sine', rand(11200, 12400)), whine, L.out);
  const hiss = L.gain(0.02);
  chain(white, L.filter('highpass', 7500, 0.7), hiss, flick);
  // 天花板夹层里的空气底噪
  const room = L.gain(0.12);
  chain(L.wide('brown'), L.filter('lowpass', 180, 0.7), room, L.out);

  // 随机轻微起伏：只用 setTargetAtTime，并且和闪烁各用各的 gain，自动化事件互不打架
  L.every(0.4, 1.4, t => {
    drift.gain.setTargetAtTime(rand(0.86, 1.05), t, rand(0.2, 0.7));
    humLP.frequency.setTargetAtTime(rand(1500, 2900), t, 0.5);
    buzzG.gain.setTargetAtTime(rand(0.25, 0.8), t, 0.3);
    whine.gain.setTargetAtTime(rand(0.002, 0.007), t, 0.8);
  }, 0.1);
  // 闪烁：灯管掉电几十毫秒，重新点亮时略冲高，伴随"叮/咔"
  L.every(6, 24, t => {
    const n = chance(0.3) ? 1 : randInt(2, 5);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const dip = rand(0.05, 0.45), dur = rand(0.025, 0.09);
      flick.gain.setValueAtTime(1, tt);
      flick.gain.linearRampToValueAtTime(dip, tt + 0.004);
      flick.gain.setValueAtTime(dip, tt + dur);
      flick.gain.linearRampToValueAtTime(1.18, tt + dur + 0.006);
      flick.gain.linearRampToValueAtTime(1, tt + dur + 0.08);
      const at = tt;
      L.spawn(v => { v.out.gain.value = rand(0.05, 0.14); v.buf(baked('tink'), at, rand(0.85, 1.2)); }, rand(-0.5, 0.5));
      tt += dur + 0.08 + rand(0.02, 0.2);
    }
    return (tt - t) + rand(6, 24);
  }, rand(3, 10));
};

AMB.pipes = L => {
  // 锅炉房：棕噪声的低频轰 + 水泵的慢脉动
  const rum = L.gain(0.6);
  chain(L.wide('brown'), L.filter('lowpass', 110, 0.7), rum, L.out);
  const pumpAM = L.gain(0.5), pumpG = L.gain(0.16), lfo = L.gain(0.5);
  chain(L.osc('sine', 1.1), lfo);
  lfo.connect(pumpAM.gain);
  chain(L.osc(motorWave(), 42), L.filter('lowpass', 200, 0.7), pumpAM, pumpG, L.out);
  // 蒸汽：持续的细嘶声 + 偶尔一次泄压喷发
  const steam = L.filter('bandpass', 5200, 0.9);
  L.wide('white').connect(steam);
  const hiss = L.gain(0.05), burst = L.gain(0);
  chain(steam, hiss, L.out);
  chain(steam, burst, L.out);
  L.every(10, 30, t => {
    const a = rand(0.1, 0.25), hold = rand(0.3, 1.5), rel = rand(0.8, 2.5);
    burst.gain.setValueAtTime(0, t);
    burst.gain.linearRampToValueAtTime(a, t + 0.08);
    burst.gain.linearRampToValueAtTime(a * 0.8, t + 0.08 + hold);
    burst.gain.linearRampToValueAtTime(0, t + 0.08 + hold + rel);
    return 0.08 + hold + rel + rand(8, 25);
  }, rand(4, 12));
  // 铁管之间的短回声：滴水和敲击都送进来
  const echo = L.delay(0.19), fb = L.gain(0.38), wet = L.gain(0.6);
  chain(echo, L.filter('bandpass', 1800, 0.6), fb, echo);
  chain(fb, wet, L.out);
  L.every(0.5, 2.8, t => {
    L.spawn(v => { synthDrip(v, t, rand(0.08, 0.25), rand(1100, 1800)); v.tail.connect(echo); }, rand(-0.9, 0.9));
  });
  L.every(8, 28, t => {
    const f = rand(120, 380);
    L.spawn(v => {
      let tt = t;
      for (let k = randInt(1, 3); k > 0; k--) { synthMetal(v, tt, f * rand(0.97, 1.03), rand(0.05, 0.12), rand(0.3, 0.8)); tt += rand(0.15, 0.5); }
      v.tail.connect(echo);
    }, rand(-0.8, 0.8));
  }, rand(3, 10));
  // 管道呻吟：水压变化时整根管子低低地"呜"一声
  L.every(20, 50, t => {
    L.spawn(v => {
      const d = rand(2, 4), f = rand(70, 110);
      const o = v.osc('sawtooth', f, t, t + d + 0.1);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * rand(0.88, 1.12), t + d);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + d * 0.4);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('bandpass', rand(300, 500), 6), g, v.out);
      v.tail.connect(echo);
    }, rand(-0.7, 0.7));
  }, rand(8, 20));
};

AMB.electrical = L => {
  // 配电室：50Hz 电网的变压器（刻意和日光灯的 60/120Hz 错开）——100Hz 为主、奇次谐波多，更粗更"硬"
  const lp = L.filter('lowpass', 3000, 0.6), drift = L.gain(1);
  chain(lp, L.shaper(driveCurve(1.5)), drift, L.out);
  chain(L.osc(transformerWave(), 50), L.gain(0.45), L.pan(-0.2), lp);
  chain(L.osc(transformerWave(), 50.07), L.gain(0.3), L.pan(0.3), lp);
  chain(L.osc('sine', 100), L.gain(0.18), drift);
  // 电感啸叫，音高慢慢游移
  const wh = L.osc('sine', 7600), whg = L.gain(0.004), vib = L.gain(30);
  chain(L.osc('sine', 0.23), vib);
  vib.connect(wh.frequency);
  chain(wh, whg, L.out);
  L.every(0.5, 2, t => {
    drift.gain.setTargetAtTime(rand(0.85, 1.08), t, 0.4);
    whg.gain.setTargetAtTime(rand(0.001, 0.006), t, 0.6);
  }, 0.1);
  // 噼啪放电
  L.every(0.6, 4.5, t => {
    L.spawn(v => {
      const d = rand(0.02, 0.4), g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(1.5, 4), t + 0.005);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(v.noise('crackle', t, t + d + 0.02, rand(0.7, 1.5)), v.f('highpass', 1500, 0.7), g, v.out);
    }, rand(-0.9, 0.9));
  });
  // 偶尔一次强电弧：100Hz 方波调制的扫频噪声"滋——"，结尾"啪"
  L.every(12, 35, t => {
    L.spawn(v => {
      const d = rand(0.2, 0.6);
      const bp = v.f('bandpass', 700, 3);
      sweep(bp.frequency, t, 700, rand(2500, 4500), d);
      const am = v.g(0.5);
      chain(v.osc('square', 100, t, t + d), v.g(0.5)).connect(am.gain);
      const env = v.g(0);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.9, t + 0.02);
      env.gain.linearRampToValueAtTime(0.6, t + d * 0.8);
      env.gain.linearRampToValueAtTime(0, t + d);
      chain(v.noise('white', t, t + d + 0.02), bp, am, env, v.out);
      const gp = v.g(0.35);
      gp.connect(v.out);
      v.buf(baked('tink'), t + d, 0.6, gp);
    }, rand(-0.6, 0.6));
  }, rand(5, 12));
};

AMB['office-rain'] = L => {
  // 隔着玻璃的雨：粉噪声去掉低频，再被玻璃吃掉一部分高频；雨势慢慢变化
  const rainLP = L.filter('lowpass', 3500, 0.5), gust = L.gain(0.5);
  chain(L.wide('pink'), L.filter('highpass', 300, 0.7), rainLP, gust, L.out);
  const dg = L.gain(0.5);
  chain(L.wide(rainDropsBuf()), L.filter('bandpass', 2600, 0.6), dg, L.out);
  L.every(2, 6, t => {
    const k = Math.random();
    gust.gain.setTargetAtTime(0.35 + k * 0.4, t, rand(1, 3));
    rainLP.frequency.setTargetAtTime(2500 + k * 2500, t, 2);
    dg.gain.setTargetAtTime(0.3 + k * 0.5, t, 1.5);
  }, 0.1);
  // 室内空调的低底噪
  chain(L.wide('brown'), L.filter('lowpass', 250, 0.7), L.gain(0.1), L.out);
  // 远处闷雷：几次起伏的滚动
  L.every(25, 60, t => {
    L.spawn(v => {
      const d = rand(3, 6), g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.8, 1.4), t + rand(0.2, 0.6));
      for (let tt = t + 0.7; tt < t + d * 0.6; tt += rand(0.3, 0.8)) g.gain.linearRampToValueAtTime(rand(0.4, 1.2), tt);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(v.noise('brown', t, t + d + 0.1, 0.6), v.f('lowpass', 160, 0.8), g, v.out);
    }, rand(-0.5, 0.5));
  }, rand(8, 20));
};

// 电梯到层的铃音：几条整数比的正弦，高次衰减更快，比管子敲击"圆"得多
function synthChime(v, t, f, amp, decay) {
  [[1, 1], [2, 0.3], [3.01, 0.12]].forEach((p, i) => {
    const o = v.osc('sine', f * p[0], t, t + decay + 0.05);
    const g = v.g(0);
    ad(g.gain, t, amp * p[1], 0.004, decay / (1 + i * 1.5));
    chain(o, g, v.out);
  });
}
// 狗叫：锯齿波音高先冲高再掉下来，过两个共振峰；再叠一口气声。dest 缺省 v.out
function synthBark(v, t, amp, dest) {
  const f = rand(280, 420), d = rand(0.12, 0.2), out = dest || v.out;
  const o = v.osc('sawtooth', f, t, t + d + 0.05);
  o.frequency.setValueAtTime(f * 0.8, t);
  o.frequency.linearRampToValueAtTime(f * 1.15, t + 0.03);
  o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d);
  const g = v.g(0);
  ad(g.gain, t, amp, 0.008, d);
  const f1 = v.f('bandpass', rand(800, 1000), 2.5), f2 = v.f('bandpass', rand(1600, 2000), 3);
  o.connect(f1); o.connect(f2);
  f1.connect(g);
  chain(f2, v.g(0.6), g);
  g.connect(out);
  const gn = v.g(0);
  ad(gn.gain, t, amp * 0.5, 0.005, d * 0.6);
  chain(v.noise('white', t, t + d + 0.05), v.f('bandpass', 1200, 1), gn, out);
}
// 虫鸣循环：三只蟋蟀预先烘焙。一只 = 4~5kHz 音高 × 每秒几十下翅膀摩擦脉冲 × 每秒两三声的鸣叫包络，
// 实时用振荡器调制要 9 个节点一只，烘焙后整片虫鸣只要 2 个 BufferSource
function cricketsBuf() {
  if (noiseCache.crickets) return noiseCache.crickets;
  const sr = ctx.sampleRate, N = Math.floor(sr * 5.3);
  const d = new Float32Array(N);
  for (let c = 0; c < 3; c++) {
    const f = rand(3900, 5200), plen = Math.floor(sr / rand(28, 44)), on = Math.floor(plen * 0.6);
    const per = rand(0.33, 0.6), np = randInt(3, 6), amp = c === 2 ? 0.35 : rand(0.7, 1);
    for (let tc = rand(0, per); tc < N / sr; tc += per * rand(0.9, 1.1)) {
      const i0 = Math.floor(tc * sr);
      for (let p = 0; p < np; p++) {
        const a = amp * Math.sin(Math.PI * (p + 0.5) / np) * rand(0.7, 1);   // 一声里中间几下最响
        for (let j = 0; j < on; j++) {
          const i = i0 + p * plen + j;
          if (i >= N) break;
          const e = Math.sin(Math.PI * j / on);
          d[i] += Math.sin(2 * Math.PI * f * i / sr) * e * e * a;
        }
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < N; i++) d[i] *= 0.9 / peak;
  const out = crossfadeLoop(d, Math.floor(sr * 0.05));
  const buf = ctx.createBuffer(1, out.length, sr);
  buf.getChannelData(0).set(out);
  return (noiseCache.crickets = buf);
}

AMB.hotel = L => {
  // 老式大酒店：厚地毯、墙纸、软包门把高频吃光，房间底噪又低又暖
  chain(L.wide('brown'), L.filter('lowpass', 220, 0.7), L.gain(0.45), L.out);
  // "别的房间"的声音都先过走廊：低通 + 一条短回声
  const far = L.filter('lowpass', 1100, 0.6), hall = L.delay(0.23), hfb = L.gain(0.32);
  chain(far, L.out);
  far.connect(hall);
  chain(hall, L.filter('lowpass', 900, 0.5), hfb, hall);
  chain(hfb, L.gain(0.6), L.out);
  // 不知哪个房间的留声机在放 20 年代舞曲：窄带通模拟喇叭，一阵有一阵没有
  const horn = L.filter('bandpass', 1000, 0.9), music = L.gain(0);
  chain(horn, music, far);
  chain(L.noise('crackle'), L.filter('highpass', 1800, 0.7), L.gain(0.3), horn);   // 唱针噼啪跟着音乐一起淡入淡出
  const PROG = [[43, 58, 62, 65], [36, 55, 58, 64], [41, 57, 60, 64], [38, 57, 60, 65]];   // Gm7 C7 Fmaj7 Dm7：[低音, 和弦音…]
  const beat = 0.6;
  let on = false, until = 0, offAt = -99, step = 0;
  const wow = t => Math.sin(t * 3.1) * 9 + Math.sin(t * 0.41) * 14;   // 唱盘偏心：整体音高慢慢摇（音分）
  L.every(beat, beat, t => {
    if (t >= until) {
      on = !on;
      until = t + (on ? rand(30, 70) : rand(20, 50));
      if (on) { step = 0; music.gain.setTargetAtTime(rand(0.9, 1.4), t, 1.2); }   // 喇叭带通 + 走廊低通吃掉很多能量，这里补回来
      else { offAt = t; music.gain.setTargetAtTime(0, t, 1.8); }
    }
    if (!on && t > offAt + 6) return 1;   // 淡出期间继续弹，之后空转降频
    const ch = PROG[Math.floor(step / 4) % PROG.length], b = step % 4;
    step++;
    L.spawn(v => {
      const det = wow(t);
      const note = (type, m, t0, dur, amp) => {
        const o = v.osc(type, mtof(m), t0, t0 + dur + 0.05);
        o.detune.value = det;
        const g = v.g(0);
        ad(g.gain, t0, amp, 0.008, dur);
        chain(o, g, v.out);
      };
      if (b % 2 === 0) note('triangle', ch[0] + (b === 2 ? 7 : 0), t, beat * 0.8, 0.9);   // 低音：根音、五音交替
      else for (let i = 1; i < 4; i++) note('square', ch[i], t, beat * 0.3, 0.08);        // 反拍和弦
      if (chance(0.5)) note('sawtooth', ch[randInt(1, 3)] + 12, t + (chance(0.5) ? 0 : beat * 0.66), beat * rand(0.4, 1.1), 0.12);   // 摇摆八分的即兴
    }, undefined, horn);
  }, 0.5);
  // 电梯到层"叮——咚"
  L.every(40, 100, t => {
    L.spawn(v => {
      v.out.gain.value = rand(0.15, 0.3);
      synthChime(v, t, 1319, 1, 1.6);
      synthChime(v, t + 0.45, 1047, 1, 2.2);
    }, rand(-0.8, 0.8), far);
  }, rand(15, 40));
  // 暖气片热胀冷缩
  L.every(15, 45, t => {
    L.spawn(v => {
      let tt = t;
      for (let k = randInt(1, 4); k > 0; k--) { synthMetal(v, tt, rand(70, 130), rand(0.1, 0.25), rand(0.3, 0.6)); tt += rand(0.2, 0.9); }
    }, rand(-0.9, 0.9), far);
  }, rand(5, 15));
  // 远处一扇门被关上
  L.every(30, 80, t => {
    L.spawn(v => { v.out.gain.value = rand(0.3, 0.6); v.buf(baked('hit'), t, rand(0.45, 0.6)); }, rand(-0.9, 0.9), far);
  }, rand(10, 30));
};

AMB.dark = L => {
  // 无光的层级：耳朵会把一切放大，所以只留次声般的低频轰鸣和偶尔很远、分不清方向的动静
  const swell = L.gain(1);
  swell.connect(L.out);
  // 次低频的 RMS 很大但听感很轻：按离线 RMS 压到比日光灯低约 4dB，耳机上才不会变成"轰"
  chain(L.wide('brown'), L.filter('lowpass', 85, 0.8), L.gain(0.38), swell);
  // 41Hz 和 41.3Hz 拍出很慢的"呼吸"；手机喇叭放不出这么低，叠一点二倍频让它至少感觉得到
  chain(L.osc('sine', 41), L.gain(0.065), swell);
  chain(L.osc('sine', 41.3), L.gain(0.065), swell);
  chain(L.osc('sine', 82.6), L.gain(0.03), swell);
  chain(L.wide('pink'), L.filter('bandpass', 5000, 0.5), L.gain(0.01), L.out);
  L.every(3, 8, t => { swell.gain.setTargetAtTime(rand(0.6, 1.15), t, rand(1.5, 4)); }, 0.1);
  // 远处：重低通 + 长回声，听得出"有东西"但判断不了在哪
  const far = L.filter('lowpass', 520, 0.6), echo = L.delay(0.41), fb = L.gain(0.45);
  chain(far, L.out);
  far.connect(echo);
  chain(echo, L.filter('lowpass', 700, 0.5), fb, echo);
  chain(fb, L.gain(0.55), L.out);
  // 敲击
  L.every(14, 40, t => {
    L.spawn(v => {
      v.out.gain.value = rand(0.25, 0.5);
      let tt = t;
      for (let k = randInt(1, 3); k > 0; k--) { v.buf(baked('hit'), tt, rand(0.45, 0.7)); tt += rand(0.25, 0.8); }
    }, rand(-1, 1), far);
  }, rand(6, 15));
  // 走几步又停下的脚步
  L.every(25, 70, t => {
    L.spawn(v => {
      v.out.gain.value = rand(0.2, 0.4);
      const gap = rand(0.45, 0.7);
      let tt = t;
      for (let k = randInt(3, 7); k > 0; k--) { v.buf(baked('step'), tt, rand(0.8, 0.95)); tt += gap * rand(0.9, 1.1); }
    }, rand(-1, 1), far);
  }, rand(12, 30));
  // 吱呀：极低的锯齿波只留几十次谐波附近那一段，听起来像木头或铁门被慢慢压弯
  L.every(20, 55, t => {
    L.spawn(v => {
      const d = rand(0.8, 2), f = rand(30, 55);
      const o = v.osc('sawtooth', f, t, t + d + 0.05);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * rand(1.3, 2), t + d);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.25, 0.5), t + d * 0.3);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('bandpass', rand(600, 1200), 5), g, v.out);
    }, rand(-1, 1), far);
  }, rand(8, 20));
};

AMB.ocean = L => {
  // 一望无际的水：浪一阵阵涌上来又退下去。浪 = 低通粉噪声，涌起时滤波器同时打开，浪头更"亮"
  const surf = L.filter('lowpass', 400, 0.6), swell = L.gain(0.2);
  chain(L.wide('pink'), surf, swell, L.out);
  chain(L.wide('brown'), L.filter('lowpass', 120, 0.7), L.gain(0.5), L.out);
  // 浪退时的泡沫"沙沙"，比浪头慢半拍
  const foam = L.gain(0);
  chain(L.noise('white'), L.filter('highpass', 3500, 0.7), foam, L.pan(rand(-0.3, 0.3)), L.out);
  L.every(6, 12, t => {
    const up = rand(2, 3.5), down = rand(3, 5.5), peak = rand(0.5, 0.95);
    swell.gain.setTargetAtTime(peak, t, up / 3);
    surf.frequency.setTargetAtTime(rand(1100, 1800), t, up / 3);
    swell.gain.setTargetAtTime(rand(0.12, 0.22), t + up, down / 3);
    surf.frequency.setTargetAtTime(rand(300, 450), t + up, down / 3);
    foam.gain.setTargetAtTime(peak * 0.06, t + up * 0.8, 0.5);
    foam.gain.setTargetAtTime(0, t + up + down * 0.4, down / 4);
    return up + down + rand(0, 2);
  }, 0.2);
  // 水拍在柱子和墙上
  L.every(1.5, 5, t => {
    L.spawn(v => {
      const d = rand(0.15, 0.35), g = v.g(0);
      ad(g.gain, t, rand(0.1, 0.25), 0.01, d);
      chain(v.noise('pink', t, t + d + 0.1), v.f('bandpass', rand(400, 900), 1.2), g, v.out);
      if (chance(0.5)) synthDrip(v, t + rand(0.05, 0.2), rand(0.03, 0.08), rand(700, 1100));
    }, rand(-0.9, 0.9));
  });
  // 深水里有什么东西：极低的长鸣，音高慢慢往下沉
  L.every(40, 100, t => {
    L.spawn(v => {
      const d = rand(4, 7), f = rand(55, 90), k = rand(0.6, 0.8);
      const o1 = v.osc('sine', f, t, t + d + 0.1), o2 = v.osc('triangle', f * 1.5, t, t + d + 0.1);
      sweep(o1.frequency, t + d * 0.3, f, f * k, d * 0.7);
      sweep(o2.frequency, t + d * 0.3, f * 1.5, f * 1.5 * k, d * 0.7);
      const lp = v.f('lowpass', 260, 2), g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.35, 0.6), t + d * 0.35);
      g.gain.linearRampToValueAtTime(0, t + d);
      o1.connect(lp);
      chain(o2, v.g(0.3), lp);
      chain(lp, g, v.out);
    }, rand(-0.6, 0.6));
  }, rand(20, 45));
};

AMB.cave = L => {
  // 岩洞：风从洞口灌进来，被洞体共振成低沉的"呜——"；滴水、落石都带很长的回声
  const wind = L.filter('bandpass', 180, 3), wg = L.gain(0.9);
  chain(L.wide('pink'), wind, wg, L.out);
  const res = L.filter('bandpass', 95, 8), rg = L.gain(1.2);
  chain(L.noise('brown'), res, rg, L.out);
  L.every(3, 9, t => {
    wind.frequency.setTargetAtTime(rand(140, 260), t, 2);
    wg.gain.setTargetAtTime(rand(0.5, 1.1), t, 2.5);
    rg.gain.setTargetAtTime(rand(0.6, 1.5), t, 3);
  }, 0.1);
  // 石壁乱反射：两条互质延迟交叉反馈（环路增益 0.33 < 1），比单条延迟更像大空间，尾巴约 5 秒
  const verb = L.gain(1), dA = L.delay(0.37), dB = L.delay(0.53);
  const fA = L.gain(0.6), fB = L.gain(0.55), wet = L.gain(0.7);
  verb.connect(dA); verb.connect(dB);
  chain(dA, L.filter('lowpass', 2500, 0.5), fA, dB);
  chain(dB, L.filter('lowpass', 1800, 0.5), fB, dA);
  fA.connect(wet); fB.connect(wet); wet.connect(L.out);
  L.every(0.8, 3.5, t => {
    L.spawn(v => { synthDrip(v, t, rand(0.06, 0.2), rand(900, 2000)); v.tail.connect(verb); }, rand(-1, 1));
  });
  // 碎石滚落，最后一块大的落地
  L.every(25, 70, t => {
    L.spawn(v => {
      const d = rand(0.6, 1.8), g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.6, 1.2), t + 0.05);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(v.noise('crackle', t, t + d + 0.05, rand(0.4, 0.8)), v.f('lowpass', rand(900, 1800), 0.7), g, v.out);
      const gh = v.g(rand(0.3, 0.5));
      gh.connect(v.out);
      v.buf(baked('hit'), t + d * rand(0.5, 0.9), rand(0.4, 0.6), gh);
      v.tail.connect(verb);
    }, rand(-0.8, 0.8));
  }, rand(10, 30));
  // 山体深处的隆隆
  L.every(30, 80, t => {
    L.spawn(v => {
      const d = rand(3, 6), g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.6, 1), t + d * 0.4);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(v.noise('brown', t, t + d + 0.1, 0.5), v.f('lowpass', 90, 1), g, v.out);
    }, rand(-0.4, 0.4));
  }, rand(15, 30));
};

AMB['suburb-night'] = L => {
  // 夜里的郊区：虫鸣铺底，偶尔远处狗叫、车开过，路灯低低地嗡
  const bugs = L.gain(0.6);
  chain(L.wide(cricketsBuf()), bugs, L.out);
  // 虫子会一阵一阵集体停下来
  L.every(4, 12, t => { bugs.gain.setTargetAtTime(chance(0.8) ? rand(0.45, 0.75) : 0.04, t, rand(0.3, 1)); }, rand(3, 8));
  // 树叶里的微风
  const leaves = L.filter('bandpass', 900, 0.6), lg = L.gain(0.18);
  chain(L.wide('pink'), leaves, lg, L.out);
  L.every(2, 6, t => {
    lg.gain.setTargetAtTime(rand(0.08, 0.28), t, rand(0.8, 2));
    leaves.frequency.setTargetAtTime(rand(700, 1400), t, 1.5);
  }, 0.1);
  // 路灯镇流器
  chain(L.osc('sine', 120), L.gain(0.01), L.pan(rand(-0.5, 0.5)), L.out);
  // 房子之间的回声
  const echo = L.delay(0.28), fb = L.gain(0.28);
  chain(echo, L.filter('lowpass', 1400, 0.5), fb, echo);
  chain(fb, L.gain(0.6), L.out);
  L.every(30, 90, t => {
    L.spawn(v => {
      const lp = v.f('lowpass', 1500, 0.6);
      lp.connect(v.out);
      let tt = t;
      for (let k = randInt(2, 4); k > 0; k--) { synthBark(v, tt, rand(0.3, 0.6), lp); tt += rand(0.35, 0.7); }
      v.tail.connect(echo);
    }, rand(-0.9, 0.9));
  }, rand(10, 30));
  // 远处一辆车驶过：轮胎噪声从一侧滑到另一侧，中间最亮
  L.every(45, 120, t => {
    L.spawn(v => {
      const d = rand(5, 9), dir = chance(0.5) ? 1 : -1;
      const lp = v.f('lowpass', 350, 0.7), g = v.g(0), p = v.pan(0);
      lp.frequency.setValueAtTime(350, t);
      lp.frequency.linearRampToValueAtTime(900, t + d * 0.5);
      lp.frequency.linearRampToValueAtTime(300, t + d);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.25, 0.45), t + d * 0.5);
      g.gain.linearRampToValueAtTime(0, t + d);
      if (p.pan) { p.pan.setValueAtTime(-0.9 * dir, t); p.pan.linearRampToValueAtTime(0.9 * dir, t + d); }
      chain(v.noise('pink', t, t + d + 0.1), lp, g, p, v.out);
    });
  }, rand(15, 40));
};

AMB['wind-field'] = L => {
  // 空旷原野：没有东西挡风，只有风本身。主体是带通粉噪声，阵风来时中心频率升高、音量变大
  const body = L.filter('bandpass', 400, 0.8), bg = L.gain(0.6);
  chain(L.wide('pink'), body, bg, L.out);
  chain(L.wide('brown'), L.filter('lowpass', 150, 0.7), L.gain(0.4), L.out);
  // 风哨：窄带噪声，音高随风速滑动（风掠过草茎、铁丝网）
  const white = L.noise('white');
  const whistle = L.filter('bandpass', 900, 14), wsg = L.gain(0);
  chain(white, whistle, wsg, L.pan(rand(-0.5, 0.5)), L.out);
  // 草叶沙沙
  const grass = L.gain(0.02);
  chain(white, L.filter('highpass', 4000, 0.6), grass, L.out);
  L.every(1.5, 5, t => {
    const k = Math.pow(Math.random(), 1.5);   // 大部分时间是平稳的风，偶尔来一阵强的
    const tau = rand(0.8, 2.2);
    body.frequency.setTargetAtTime(300 + k * 700, t, tau);
    bg.gain.setTargetAtTime(0.35 + k * 0.8, t, tau);
    whistle.frequency.setTargetAtTime(rand(600, 900) + k * 900, t, tau);
    wsg.gain.setTargetAtTime(k > 0.4 ? (k - 0.4) * 6 : 0, t, tau);
    grass.gain.setTargetAtTime(0.01 + k * 0.05, t, tau * 0.7);
  }, 0.1);
  // 远处电线被风吹得"嗡"一声
  L.every(20, 50, t => {
    L.spawn(v => {
      const d = rand(2, 4), f = rand(180, 320);
      const o = v.osc('triangle', f, t, t + d + 0.1);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * rand(0.97, 1.05), t + d);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.03, 0.06), t + d * 0.4);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('lowpass', 900, 1), g, v.out);
    }, rand(-0.9, 0.9));
  }, rand(8, 20));
};

AMB.city = L => {
  // 空荡的城市：听得到车流却从来看不到车。远处交通的低频轰鸣 + 楼宇间反射出来的中频"沙"
  const traffic = L.gain(0.5);
  chain(L.wide('brown'), L.filter('lowpass', 220, 0.6), traffic, L.out);
  const hush = L.filter('bandpass', 600, 0.5), hg = L.gain(0.2);
  chain(L.wide('pink'), hush, hg, L.out);
  L.every(4, 10, t => {
    traffic.gain.setTargetAtTime(rand(0.35, 0.65), t, 3);
    hg.gain.setTargetAtTime(rand(0.12, 0.28), t, 3);
    hush.frequency.setTargetAtTime(rand(450, 800), t, 3);
  }, 0.1);
  // 楼宇间的回声
  const echo = L.delay(0.31), fb = L.gain(0.3);
  chain(echo, L.filter('lowpass', 1500, 0.5), fb, echo);
  chain(fb, L.gain(0.5), L.out);
  // 楼顶空调外机
  chain(L.osc(motorWave(), 29.5), L.filter('lowpass', 300, 0.7), L.gain(0.05), L.pan(rand(-0.6, 0.6)), L.out);
  // 一辆车驶过：发动机音高过身时从高滑到低（多普勒），轮胎噪声跟着亮起来再暗下去
  L.every(12, 35, t => {
    L.spawn(v => {
      const d = rand(4, 8), dir = chance(0.5) ? 1 : -1, f = rand(38, 60);
      const lp = v.f('lowpass', 300, 0.7), g = v.g(0), p = v.pan(0);
      const eng = v.osc(motorWave(), f * 1.06, t, t + d + 0.1);
      eng.frequency.setValueAtTime(f * 1.06, t + d * 0.45);
      eng.frequency.linearRampToValueAtTime(f * 0.94, t + d * 0.55);
      chain(eng, v.g(0.5), lp);
      chain(v.noise('pink', t, t + d + 0.1), v.f('bandpass', 700, 0.6), v.g(0.8), lp);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.linearRampToValueAtTime(1400, t + d * 0.5);
      lp.frequency.linearRampToValueAtTime(300, t + d);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.2, 0.4), t + d * 0.5);
      g.gain.linearRampToValueAtTime(0, t + d);
      if (p.pan) { p.pan.setValueAtTime(-0.8 * dir, t); p.pan.linearRampToValueAtTime(0.8 * dir, t + d); }
      chain(lp, g, p, v.out);
      v.tail.connect(echo);
    });
  }, rand(4, 12));
  // 远处喇叭：双音（大三度），在楼间来回弹
  L.every(25, 70, t => {
    L.spawn(v => {
      const d = rand(0.25, 0.9), f = pick([392, 415, 440, 466]), a = rand(0.06, 0.12);
      const lp = v.f('lowpass', 1400, 0.7), g = v.g(0);
      v.osc('square', f, t, t + d + 0.1).connect(lp);
      v.osc('square', f * 1.26, t, t + d + 0.1).connect(lp);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.03);
      g.gain.setValueAtTime(a, t + d);
      g.gain.linearRampToValueAtTime(0, t + d + 0.05);
      chain(lp, g, v.out);
      v.tail.connect(echo);
    }, rand(-0.9, 0.9));
  }, rand(8, 25));
  // 很远的警笛
  L.every(60, 150, t => {
    L.spawn(v => {
      const d = rand(6, 12);
      const o = v.osc('triangle', 700, t, t + d + 0.1), dep = v.g(220);
      chain(v.osc('sine', rand(0.18, 0.3), t, t + d + 0.1), dep);
      dep.connect(o.frequency);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.03, 0.06), t + d * 0.4);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('lowpass', 1100, 0.6), g, v.out);
      v.tail.connect(echo);
    }, rand(-0.8, 0.8));
  }, rand(20, 50));
};

AMB.party = L => {
  // Level Fun =)：隔壁永远在开派对，推开门却一个人都没有。音乐隔着墙（重低通），调子随时间慢慢跑偏
  const wall = L.filter('lowpass', 650, 1.2);
  chain(wall, L.gain(1.5), L.out);
  const e8 = 60 / 120 / 2;
  const ROOTS = [45, 45, 41, 43];   // A A F G：最普通的流行进行，越普通越诡异
  let bar = 0, det = 0;
  // 一小节一个声部：比每个八分音符建一个声部少很多节点抖动
  L.every(e8 * 8, e8 * 8, t => {
    const root = ROOTS[bar++ % ROOTS.length];
    det = clamp(det + rand(-10, 10), -45, 45);
    L.spawn(v => {
      for (let s = 0; s < 8; s++) {
        const ts = t + s * e8;
        if (s % 2 === 0) {   // 底鼓
          const k = v.osc('sine', 120, ts, ts + 0.25);
          sweep(k.frequency, ts, 120, 45, 0.08);
          const gk = v.g(0);
          ad(gk.gain, ts, 0.75, 0.002, 0.18);   // 离线峰值曾到 -0.6dBFS，留点余量给同时响的音效
          chain(k, gk, v.out);
        } else {             // 反拍贝斯
          const bs = v.osc('sawtooth', mtof(root + (s === 5 ? 12 : 0)), ts, ts + e8 + 0.02);
          bs.detune.value = det;
          const gb = v.g(0);
          ad(gb.gain, ts, 0.4, 0.005, e8 * 0.6);
          chain(bs, gb, v.out);
        }
        if (s === 2 || s === 6) {   // 拍手
          const gc = v.g(0);
          ad(gc.gain, ts, 0.7, 0.002, 0.07);
          chain(v.noise('white', ts, ts + 0.12), v.f('bandpass', 1100, 1), gc, v.out);
        }
      }
    }, undefined, wall);
    return e8 * 8;
  }, 0.3);
  // 气球被蹭得"吱吱"响：方波快速调频，在两个音之间抖
  L.every(12, 35, t => {
    L.spawn(v => {
      const d = rand(0.25, 0.7), f = rand(700, 1300);
      const o = v.osc('sine', f, t, t + d + 0.05), jit = v.g(f * 0.15);
      chain(v.osc('square', rand(18, 30), t, t + d + 0.05), jit);
      jit.connect(o.frequency);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.04, 0.09), t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('bandpass', f * 1.2, 1.5), g, v.out);
    }, rand(-0.8, 0.8));
  }, rand(4, 12));
  // 气球爆掉
  L.every(30, 90, t => {
    L.spawn(v => {
      const gn = v.g(0);
      ad(gn.gain, t, rand(0.25, 0.45), 0.001, 0.05);
      chain(v.noise('white', t, t + 0.12), v.f('highpass', 900, 0.7), gn, v.out);
      const gh = v.g(0.25);
      gh.connect(v.out);
      v.buf(baked('hit'), t, rand(1.6, 2.2), gh);
    }, rand(-0.9, 0.9));
  }, rand(10, 30));
  // 派对喇叭"嘟——"
  L.every(25, 60, t => {
    L.spawn(v => {
      const d = rand(0.5, 1.1), f = rand(280, 380), a = rand(0.05, 0.1);
      const o = v.osc('sawtooth', f * 0.9, t, t + d + 0.05);
      o.frequency.setValueAtTime(f * 0.9, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.08);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.05);
      g.gain.setValueAtTime(a, t + d - 0.05);
      g.gain.linearRampToValueAtTime(0, t + d);
      chain(o, v.f('bandpass', 1400, 1.2), g, v.out);
    }, rand(-0.9, 0.9));
  }, rand(8, 25));
  // 隔壁传来笑声——但那边没有人
  L.every(40, 100, t => {
    L.spawn(v => { v.out.gain.value = SFX.giggle.level * rand(0.4, 0.7); SFX.giggle.fn(v, t, rand(0.85, 1.05)); }, rand(-0.8, 0.8), wall);
  }, rand(15, 40));
};

AMB.chase = L => {
  // Level !（Run For Your Life）：警报、红灯、身后一大群东西在追。不做旋律，只做停不下来的脉动和越绷越紧的不协和长音
  // 脉动 150bpm：比静息心率快一倍，身体会本能跟着紧张。刻意不用心跳音色，免得和玩家低血量的心跳提示混淆
  const beat = 0.4;
  const pulse = L.gain(0.9), far = L.filter('lowpass', 1200, 0.6);
  pulse.connect(L.out);
  far.connect(L.out);
  L.every(beat * 4, beat * 4, t => {
    L.spawn(v => {
      for (let i = 0; i < 4; i++) {
        const tt = t + i * beat;
        const o = v.osc('sine', 95, tt, tt + 0.3);
        sweep(o.frequency, tt, 95, 40, 0.14);
        const g = v.g(0);
        ad(g.gain, tt, i % 2 ? 0.55 : 0.9, 0.003, 0.2);
        chain(o, g, v.out);
        // 反拍一声压低的金属"嗒"，节奏更硬
        const gt = v.g(i % 2 ? 0.22 : 0.1);
        gt.connect(v.out);
        v.buf(baked('tink'), tt + beat / 2, rand(0.5, 0.7), gt);
      }
    }, undefined, pulse);
    return beat * 4;
  }, 0.05);
  // 不协和长音：A1 + 小二度 + 三全音，谐振低通忽开忽合
  const dlp = L.filter('lowpass', 500, 3), dg = L.gain(0.12);
  [[55, 1], [58.27, 1], [77.78, 0.5]].forEach(p => chain(L.osc('sawtooth', p[0]), L.gain(p[1]), dlp));
  chain(dlp, dg, L.out);
  // 追兵的脚步隆隆：低通棕噪声被 5.5Hz 脉冲调制，很多只脚乱踩在一起
  const stampede = L.gain(0), st = L.gain(0.5);
  chain(L.osc('sine', 5.5), L.shaper(pulseCurve(2))).connect(stampede.gain);
  chain(L.wide('brown'), L.filter('lowpass', 180, 0.8), stampede, st, L.out);
  // 警报：550/770Hz 交替的方波，隔着走廊，一阵一阵
  const al = L.osc('square', 660), alg = L.gain(0);
  chain(L.osc('square', 0.8), L.gain(110)).connect(al.frequency);
  chain(al, L.filter('bandpass', 900, 1.5), L.filter('lowpass', 1600, 0.7), alg, L.pan(0.3), L.out);
  L.every(2, 5, t => {
    dlp.frequency.setTargetAtTime(rand(260, 1100), t, rand(0.6, 1.8));
    dg.gain.setTargetAtTime(rand(0.07, 0.15), t, 1);
    st.gain.setTargetAtTime(rand(0.3, 0.8), t, 1.2);
  }, 0.1);
  L.every(10, 22, t => {
    const d = rand(3, 7);
    alg.gain.setTargetAtTime(rand(0.04, 0.08), t, 0.05);
    alg.gain.setTargetAtTime(0, t + d, 0.3);
    return d + rand(6, 16);
  }, rand(1, 4));
  // 蓄力的"呼——"越来越亮，然后砸下来一声
  L.every(8, 16, t => {
    L.spawn(v => {
      const d = rand(1.5, 3);
      const bp = v.f('bandpass', 300, 2);
      sweep(bp.frequency, t, 300, rand(2500, 4000), d);
      const g = v.g(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.25, 0.45), t + d);
      g.gain.linearRampToValueAtTime(0, t + d + 0.03);
      chain(v.noise('white', t, t + d + 0.1), bp, g, v.out);
      const gh = v.g(rand(0.5, 0.8));
      gh.connect(v.out);
      v.buf(baked('hit'), t + d, rand(0.5, 0.7), gh);
    }, rand(-0.3, 0.3));
  }, rand(5, 10));
  // 身后远远的咆哮 / 尖啸
  L.every(6, 14, t => {
    L.spawn(v => {
      if (chance(0.6)) { v.out.gain.value = SFX.growl.level * rand(0.3, 0.5); SFX.growl.fn(v, t, rand(0.7, 0.9)); }
      else { v.out.gain.value = SFX.screech.level * rand(0.15, 0.3); SFX.screech.fn(v, t, rand(0.8, 1)); }
    }, rand(-0.9, 0.9), far);
  }, rand(3, 8));
};

// 什么都不建：切到它只会把上一层淡出
AMB.silence = () => {};

// ---------- 环境切换 ----------
const XFADE = 2.5;
const ambLevel = name => AMB_LEVEL[name] !== undefined ? AMB_LEVEL[name] : 0.8;
function startAmbient(name, sec) {
  const now = ctx.currentTime;
  if (S.layer) { S.layer.stop(now, sec); S.layer = null; }
  if (name === 'silence') return;
  const L = new Layer(name, bus.ambient, now);
  try {
    AMB[name](L);
  } catch (e) {
    console.error('[audio] 环境预设出错', name, e);
    L.stop(now, 0.05);
    return;
  }
  // 新旧两层叠着交叉淡化，换层时环境声不会突然断掉
  L.out.gain.setValueAtTime(0, now);
  L.out.gain.linearRampToValueAtTime(ambLevel(name), now + sec);
  S.layer = L;
  L.tick(now, now + LOOKAHEAD);
}

// ---------- 低 san：闷声 + 幻听 ----------
// 0.6 以上不幻听；越低越频繁
const halluLevel = s => clamp((0.6 - s) / 0.6, 0, 1);
const halluGap = k => (40 - 36.5 * Math.pow(k, 0.8)) * rand(0.6, 1.4);
const hallu = new Set();
function applySanity(now, instant) {
  const s = S.sanity;
  if (!instant && Math.abs(s - S.appliedSanity) < 0.005) return;
  S.appliedSanity = s;
  // 0.85 以下开始闷；按对数插值截止频率，听感上是均匀变闷
  const m = clamp((0.85 - s) / 0.85, 0, 1);
  const top = Math.min(20000, ctx.sampleRate * 0.45);
  const f = top * Math.pow(420 / top, Math.pow(m, 0.85));
  const q = 0.707 + m * 0.5;   // 截止处一点共振，像耳朵里进了水
  if (instant) {
    bus.lp.frequency.setValueAtTime(f, now);
    bus.lp.Q.setValueAtTime(q, now);
    bus.hallu.gain.setValueAtTime(halluLevel(s) > 0 ? 1 : 0, now);
  } else {
    bus.lp.frequency.setTargetAtTime(f, now, 0.3);
    bus.lp.Q.setTargetAtTime(q, now, 0.3);
    // 回满 san 时把还没放完的幻听一起收掉
    bus.hallu.gain.setTargetAtTime(halluLevel(s) > 0 ? 1 : 0, now, 0.6);
  }
}
function halluVoice(panV) {
  const v = new Voice(null, -1);
  const p = v.pan(panV);
  v.out.connect(p);
  p.connect(bus.hallu);
  v.panNode = p;
  hallu.add(v);
  return v;
}
function whisperHallu(t, k) {
  const side = chance(0.5) ? -1 : 1;
  const v = halluVoice(side * rand(0.5, 1));
  v.out.gain.value = SFX.whisper.level * (0.35 + 0.65 * k);
  const dur = rand(0.8, 1.6 + k * 1.5);
  synthWhisper(v, t, rand(0.85, 1.15), dur);
  // 一半的耳语会从一侧耳朵慢慢绕到另一侧
  const pp = v.panNode.pan;
  if (pp && chance(0.5)) { pp.setValueAtTime(pp.value, t); pp.linearRampToValueAtTime(-side * rand(0.3, 0.9), t + dur); }
  v.arm();
  // 很低 san 时偶尔两个声音同时在说
  if (k > 0.55 && chance(0.3)) {
    const v2 = halluVoice(-side * rand(0.4, 0.9));
    v2.out.gain.value = v.out.gain.value * 0.7;
    synthWhisper(v2, t + rand(0.15, 0.5), rand(0.8, 1.1), dur * rand(0.6, 1));
    v2.arm();
  }
}
function tinnitus(t, k) {
  // 两根差几赫兹的高频正弦：拍频让耳鸣听起来"在耳朵里面"，而不是一个外面的音
  const v = halluVoice(rand(-0.2, 0.2));
  const f = rand(3800, 8500), a = rand(0.6, 2), hold = rand(1.5, 4) * (0.6 + k), rel = rand(1.5, 3.5);
  const te = t + a + hold + rel, peak = rand(0.02, 0.045) * (0.6 + 0.8 * k);
  const g = v.g(0);
  v.osc('sine', f, t, te + 0.05).connect(g);
  chain(v.osc('sine', f * rand(1.002, 1.006), t, te + 0.05), v.g(0.5), g);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.linearRampToValueAtTime(0, te);
  g.connect(v.out);
  S.tinnitusEnd = te;
  v.arm();
}
function phantom(t, k) {
  // 极低 san：身后的脚步、敲门、远处的笑声——明知道没有东西
  const v = halluVoice(chance(0.5) ? rand(-1, -0.6) : rand(0.6, 1));
  const lp = v.f('lowpass', 1600, 0.7);
  lp.connect(v.out);
  const r = Math.random();
  if (r < 0.5) {
    v.out.gain.value = 0.3 * k;
    const gap = rand(0.45, 0.6);
    let tt = t;
    for (let i = randInt(3, 5); i > 0; i--) { v.buf(baked('step'), tt, rand(0.9, 1.05), lp); tt += gap * rand(0.92, 1.08); }
  } else if (r < 0.8) {
    v.out.gain.value = 0.35 * k;
    let tt = t;
    for (let i = randInt(2, 4); i > 0; i--) { v.buf(baked('hit'), tt, rand(0.9, 1.2), lp); tt += rand(0.18, 0.3); }
  } else {
    v.out.gain.value = SFX.giggle.level * 0.35 * k;
    SFX.giggle.fn(v, t, rand(0.85, 1));
  }
  v.arm();
}
// 调度器每拍调一次；时间都用传入的音频时刻，离线渲染也能直接复用
function halluTick(now, ahead) {
  const k = halluLevel(S.sanity);
  if (k <= 0) { S.halluNext = 0; return; }
  if (!S.halluNext) { S.halluNext = now + halluGap(k) * 0.5; return; }   // 刚掉到阈值下不立刻出声
  if (S.halluNext < now - 1) S.halluNext = now + 0.1;                    // 挂起回来别补一堆
  if (S.halluNext >= ahead) return;
  const t = Math.max(S.halluNext, now);
  S.halluNext = t + halluGap(k);
  // 按音频时刻判断是否还在响：离线渲染时 onended 不会在排程期间触发
  let alive = 0;
  for (const v of hallu) { if (v.dead || v.end < t) hallu.delete(v); else alive++; }
  if (alive >= 3) return;
  const r = Math.random();
  if (t >= S.tinnitusEnd && r < 0.22 + k * 0.15) tinnitus(t, k);
  else if (k > 0.6 && r > 0.88) phantom(t, k);
  else whisperHallu(t, k);
}

// ---------- 调度器 ----------
function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime, ahead = now + LOOKAHEAD;
  if (S.layer) S.layer.tick(now, ahead);
  applySanity(now, false);
  halluTick(now, ahead);
  if (lastPlay.size > 64) for (const [key, t] of lastPlay) if (now - t > 1) lastPlay.delete(key);
}

// ---------- 单次音效调度 ----------
function fadeKill(v, sec) {
  if (v.dead || v.stolen || !ctx) return;
  v.stolen = true;
  const t = ctx.currentTime, g = v.out.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + sec);
  setTimeout(() => v.dispose(), sec * 1000 + 60);
}
// 发声数：到软上限先不发最低优先级（脚步、咔哒）；到硬上限抢最低优先级里最老的
function makeRoom(pri) {
  let n = 0, victim = null;
  for (const v of voices) {
    if (v.pri < 0 || v.dead || v.stolen) continue;
    n++;
    if (!victim || v.pri < victim.pri || (v.pri === victim.pri && v.born < victim.born)) victim = v;
  }
  if (n >= SOFT_VOICES && pri <= 0) return false;
  if (n < MAX_VOICES) return true;
  if (!victim || victim.pri > pri) return false;
  fadeKill(victim, 0.04);
  return true;
}
const quiet = p => { if (p && typeof p.catch === 'function') p.catch(() => {}); };
const num = v => typeof v === 'number' && isFinite(v);

// ---------- 公开 API ----------
function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { warnOnce('noac', '浏览器不支持 WebAudio，静音运行'); return false; }
  if (!ctx) {
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try { ctx = new AC(); } catch (e2) { warnOnce('acfail', '创建 AudioContext 失败：' + e2); ctx = null; return false; }
    }
    bus = buildBuses(ctx);
    applySanity(ctx.currentTime, true);
    if (S.listener.set) applyListener();
    // 老 iOS 要在手势里真正放出一个声音才算解锁：放 1 个采样的静音
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.onended = () => s.disconnect();
      s.start(0);
    } catch (e) { /* 不影响后续 */ }
    // 自动播放策略没放行、iOS 来电打断（state = interrupted）后，下一次任何点击/按键再试一次
    const kick = () => {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) { suspendedByUs = false; quiet(ctx.resume()); }
    };
    ['pointerdown', 'touchend', 'keydown'].forEach(n => window.addEventListener(n, kick, { capture: true, passive: true }));
    timer = setInterval(tick, TICK_MS);
    if (S.ambientName) startAmbient(S.ambientName, 1);
  }
  if (!document.hidden) {
    suspendedByUs = false;
    if (ctx.state !== 'running') quiet(ctx.resume());
  }
  return true;
}

function setAmbient(name, fadeSec) {
  name = typeof name === 'string' && name ? name : 'silence';
  if (!Object.prototype.hasOwnProperty.call(AMB, name)) {
    warnOnce('amb:' + name, '未知环境预设 "' + name + '"，按 silence 处理');
    name = 'silence';
  }
  const same = name === S.ambientName;
  S.ambientName = name;
  if (!ctx) return;                                       // 解锁时按 S.ambientName 再真正建
  if (same && (S.layer || name === 'silence')) return;    // 同名重复调用不重启，否则每次进层都会断一下
  startAmbient(name, num(fadeSec) && fadeSec >= 0 ? Math.max(0.05, fadeSec) : XFADE);
}

// 返回 { name, stop(秒?) } 或 null（未解锁 / 太远 / 被合并 / 发声数满）
function play(name, pos, opts) {
  if (!ctx || !bus || ctx.state !== 'running') return null;   // 挂起时排进去的音效会在恢复瞬间一起炸出来
  const key = SFX[name] ? name : SFX_ALIAS[name];
  const def = key && SFX[key];
  if (!def) { warnOnce('sfx:' + name, '未知音效 "' + name + '"'); return null; }
  opts = opts || {};
  const vol = num(opts.volume) ? clamp(opts.volume, 0, 4) : 1;
  const rate = num(opts.rate) && opts.rate > 0 ? clamp(opts.rate, 0.25, 4) : 1;
  if (vol < 0.001) return null;
  const p = readPos(pos);
  const now = ctx.currentTime;
  if (p && S.listener.set) {
    const dx = p.x - S.listener.x, dy = p.y - S.listener.y, dz = p.z - S.listener.z;
    if (dx * dx + dy * dy + dz * dz > MAX_3D_DIST * MAX_3D_DIST) return null;
  }
  // 30ms 内同名、同一处的重复触发合并成一次（多个实体同帧挨打、脚步抖动）
  const mk = p ? key + '@' + Math.round(p.x / 2) + ',' + Math.round(p.z / 2) : key;
  const last = lastPlay.get(mk);
  if (last !== undefined && now - last < 0.03) return null;
  if (!makeRoom(def.pri)) return null;
  lastPlay.set(mk, now);
  const v = new Voice(null, def.pri);
  v.born = now;
  v.out.gain.value = def.level * vol;
  if (p) v.out.connect(makeSpatial(v, p, bus.sfx));
  else v.out.connect(bus.sfx);
  try {
    def.fn(v, now + 0.01, rate);
  } catch (e) {
    console.error('[audio] 音效出错', key, e);
    v.dispose();
    return null;
  }
  if (v.live <= 0) { v.dispose(); return null; }
  v.arm();
  return { name: key, stop(sec) { fadeKill(v, num(sec) && sec > 0 ? sec : 0.05); } };
}

function setListener(x, y, z, yaw) {
  if (!num(x) || !num(z)) return;
  const s = S.listener;
  if (!num(y)) y = s.y;
  if (!num(yaw)) yaw = s.yaw;
  if (s.set && s.x === x && s.y === y && s.z === z && s.yaw === yaw) return;   // 站着不动时不刷 AudioParam
  s.x = x; s.y = y; s.z = z; s.yaw = yaw; s.set = true;
  applyListener();
}

function setMaster(v) {
  v = +v;
  if (!(v >= 0)) return;
  S.master = clamp(v, 0, 1);
  if (bus) bus.master.gain.setTargetAtTime(S.master, ctx.currentTime, 0.04);
}

// player 每帧都调：这里只记值，滤波器和幻听在调度器里按变化量更新，免得每帧往 AudioParam 塞自动化事件
function setSanity(v) {
  v = +v;
  S.sanity = v >= 0 ? clamp(v, 0, 1) : 1;
}

// ---------- 切后台挂起 ----------
function onHide() {
  if (!ctx || ctx.state !== 'running') return;
  suspendedByUs = true;
  quiet(ctx.suspend());
}
function onShow() {
  if (!ctx || document.hidden) return;
  if (suspendedByUs || ctx.state === 'interrupted') {
    suspendedByUs = false;
    quiet(ctx.resume());
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
window.addEventListener('pagehide', onHide);
window.addEventListener('pageshow', onShow);

// ---------- 离线渲染（自测页用）：kind = 'ambient' | 'sfx' | 'hallu'，返回响度统计 ----------
const CTX_CACHES = [noiseCache, waveCache, bakedSets, lastBaked];
function stashObj(o) { const c = Object.assign({}, o); for (const k in o) delete o[k]; return c; }
function unstashObj(o, c) { for (const k in o) delete o[k]; Object.assign(o, c); }
async function renderOffline(kind, name, seconds) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('浏览器没有 OfflineAudioContext');
  seconds = clamp(+seconds || 5, 0.5, 120);
  const sr = 44100;
  const oc = new OAC(2, Math.ceil(sr * seconds), sr);
  // 缓冲、PeriodicWave 都绑在创建它的上下文上：临时换一套，结束后原样还回去
  const saved = { ctx, bus, sanity: S.sanity, applied: S.appliedSanity, next: S.halluNext, tin: S.tinnitusEnd, lset: S.listener.set };
  const caches = CTX_CACHES.map(stashObj);
  const oldHallu = [...hallu];
  hallu.clear();
  let layer = null;
  ctx = oc;
  bus = buildBuses(oc);
  bus.master.gain.value = 1;
  S.listener.set = false;
  try {
    if (kind === 'ambient') {
      if (!Object.prototype.hasOwnProperty.call(AMB, name)) throw new Error('没有环境预设 ' + name);
      if (name !== 'silence') {
        layer = new Layer(name, bus.ambient, 0);
        AMB[name](layer);
        layer.out.gain.value = ambLevel(name);
        for (let t = 0; t < seconds; t += LOOKAHEAD) layer.tick(t, t + LOOKAHEAD);
      }
    } else if (kind === 'sfx') {
      const key = SFX[name] ? name : SFX_ALIAS[name];
      if (!key || !SFX[key]) throw new Error('没有音效 ' + name);
      const v = new Voice(bus.sfx, -1);   // pri -1：不占实时音效的发声名额
      v.out.gain.value = SFX[key].level;
      SFX[key].fn(v, 0.02, 1);
      v.arm();
    } else if (kind === 'hallu') {
      const m = /^sanity([\d.]+)$/.exec(String(name));
      S.sanity = m ? clamp(+m[1], 0, 1) : 0;
      S.appliedSanity = -1; S.halluNext = 0; S.tinnitusEnd = 0;
      applySanity(0, true);
      for (let t = 0; t < seconds; t += LOOKAHEAD) halluTick(t, t + LOOKAHEAD);
    } else {
      throw new Error('kind 只能是 ambient / sfx / hallu');
    }
  } finally {
    ctx = saved.ctx; bus = saved.bus;
    S.sanity = saved.sanity; S.appliedSanity = saved.applied; S.halluNext = saved.next; S.tinnitusEnd = saved.tin;
    S.listener.set = saved.lset;
    CTX_CACHES.forEach((o, i) => unstashObj(o, caches[i]));
    hallu.clear();
    oldHallu.forEach(v => hallu.add(v));
  }
  const t0 = performance.now();
  const ret = oc.startRendering();
  const buf = ret && typeof ret.then === 'function' ? await ret : await new Promise(res => { oc.oncomplete = e => res(e.renderedBuffer); });
  const ms = Math.round(performance.now() - t0);
  if (layer) layer.dispose();
  let sum = 0, peak = 0, n = 0, bad = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (x !== x) { bad++; continue; }
      sum += x * x;
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
    }
    n += d.length;
  }
  const db = x => x > 1e-6 ? Math.round(200 * Math.log10(x)) / 10 : -120;
  return { rmsDb: db(Math.sqrt(sum / Math.max(1, n))), peakDb: db(peak), nan: bad, renderMs: ms };
}

// ---------- 导出 ----------
BR.audio = {
  unlock, setAmbient, play, setListener, setMaster, setSanity,
  get unlocked() { return !!ctx && ctx.state === 'running'; },
  get ctx() { return ctx; },               // 解锁前为 null；联机语音的 AnalyserNode 可复用同一个上下文
  presets: Object.keys(AMB),
  sounds: Object.keys(SFX),
  _renderOffline: renderOffline,
};
})();
