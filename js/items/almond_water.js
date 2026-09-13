// 杏仁水 Almond Water（Object 1）
// 来源版本：fandom（data/lore-choices.json 里随机选中）
// URL：https://web.archive.org/web/20251210135726/https://backrooms.fandom.com/wiki/Object_1
// 许可：CC BY-SA 3.0。注释只用自己的话转述设定，不照抄原文。
// 只用这一版（别的版本的保温瓶、灰色款、600 卡、氰化物毒性等细节一律不借）：
//   · 外观：多数是前厅 Victoria's Kitchen 杏仁水瓶的复刻（塑料瓶）；少数瓶子是特殊配色，目前只见过蓝、绿、红三种
//   · 标准款：后室最主要的补水来源；治好轻微病症、状态略好转；完全抵消敌对实体造成的效果；喝完更专注；营养很少
//   · 蓝：清掉大部分精神失常的迹象（类似苯二氮䓬），增强肌肉、耐力、免疫
//   · 绿：酶含量与蓝色相近，另含高剂量咖啡因和钙，喝完对周围更警觉
//   · 红：促进血液循环、大幅加快伤口愈合；彩色瓶都有增加肌肉和耐力的效果
//   · 过期后长白/蓝/绿霉，有毒：虚弱、疲劳、痴呆、失眠、内出血、动脉瘤，放很久的曾喝死过人
// 注册 5 个类型：almond_water（标准款，层级表都引用它）、almond_water_blue / _green / _red、almond_water_expired。
// 不依赖 _kit.js / _effects.js（index.html 直接加载本文件），时效效果只在 BR.effects 存在时才加。
// 另外在标准款定义上暴露 bottle(ctx, opts) / drawIcon(g, opts)：液态痛苦"装在普通杏仁水瓶里"，直接复用这只瓶子。
(function () {
'use strict';
const BR = window.BR;

// 与 _kit.js 同一换算：设定里 1 小时 → 游戏 60 秒
const LORE_HOUR = 60;
const SEG = 12;
const SCALE = 1.2;             // 比真实 500ml 瓶大一点，放在地上远处也认得出

// 瓶身轮廓 [半径, 高度]（米），原点在瓶底中心
const SHELL = [[0, 0.002], [0.027, 0], [0.034, 0.008], [0.034, 0.150], [0.029, 0.172], [0.017, 0.192], [0.0125, 0.199], [0.0125, 0.212]];
const LIQ_R = 0.0305, LIQ_Y0 = 0.004, LIQ_Y1 = 0.152;
const LABEL_R = 0.0352, LABEL_Y0 = 0.058, LABEL_Y1 = 0.128;
const CAP_R = 0.0148, CAP_Y = 0.212, CAP_H = 0.018;
const DENT_ANGLE = 0.6;

// 配色是画面取舍（页面没写标准款标签颜色）；彩色款按"特殊配色"把瓶身、瓶盖、标签色条都染成对应颜色
const THEMES = {
  standard: { band: '#9b88cf', text: '#56469a', cap: 0x8f7cc8, capCss: '#8f7cc8', shell: 0xdfe9f2, shellOp: 0.28, tintCss: 'rgba(223,233,242,0.35)' },
  blue:     { band: '#2f6fd6', text: '#1b4b98', cap: 0x2f6fd6, capCss: '#2f6fd6', shell: 0x6f9fe8, shellOp: 0.45, tintCss: 'rgba(80,140,230,0.55)' },
  green:    { band: '#3d9a4a', text: '#23672d', cap: 0x3d9a4a, capCss: '#3d9a4a', shell: 0x73c07c, shellOp: 0.45, tintCss: 'rgba(90,180,100,0.55)' },
  red:      { band: '#c9312b', text: '#8a1d19', cap: 0xc9312b, capCss: '#c9312b', shell: 0xe26a63, shellOp: 0.45, tintCss: 'rgba(220,80,70,0.55)' },
};
const LIQUID = 0xdfe9ee;              // 页面没写液体颜色：按"补水用的水"画成清水色
const LIQUID_EXPIRED = 0xc2b68c;      // 过期：浑浊发黄
const MOLD = [0xf3f1e8, 0x7fa4c8, 0x8db374];   // 白、蓝、绿三种霉

function hexCss(h) { return '#' + (h >>> 0 & 0xffffff).toString(16).padStart(6, '0'); }
function col(THREE, hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function sound(name) { if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play(name); }
function toast(t) { if (t && BR.hud && typeof BR.hud.toast === 'function') BR.hud.toast(t, 2200); }

function material(key, factory) {
  if (BR.assets && typeof BR.assets.material === 'function') {
    const m = BR.assets.material(key, factory);
    if (m) return m;
  }
  return factory();
}

// ---------- 几何 ----------
function paint(THREE, geo, hex) {
  const c = col(THREE, hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(THREE, geos) {
  const nonIndexed = geos.some(g => !g.index);
  const ready = geos.map(g => (nonIndexed && g.index ? g.toNonIndexed() : g));
  const out = THREE.BufferGeometryUtils.mergeBufferGeometries(ready, false);
  ready.forEach(g => g.dispose());
  geos.forEach(g => g.dispose());
  if (!out) throw new Error('杏仁水几何合并失败');
  return out;
}

// 瓶身凹一块：液态痛苦"瓶身可能有凹痕"
function dent(geo, depth) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-5) continue;
    const a = Math.atan2(z, x);
    const w = Math.pow(Math.max(0, Math.cos(a - DENT_ANGLE)), 3) * smooth(0.035, 0.075, y) * (1 - smooth(0.115, 0.148, y));
    if (w <= 0) continue;
    const k = 1 - depth * w;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- 材质（全走 BR.assets.material 缓存） ----------
function vcMaterial(THREE) {
  return material('item:aw:vc', () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2e2e2e });
    // 自发光乘顶点色：暗层级里瓶子按自己的颜色微亮
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif');
    };
    m.customProgramCacheKey = () => 'item-aw-vc';
    return m;
  });
}

function drawBlossom(g, x, y, r) {
  g.fillStyle = '#f3c1cf';
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#b0476a';
  g.beginPath();
  g.arc(x, y, r * 0.24, 0, Math.PI * 2);
  g.fill();
}

// 标签：奶白底、上下色条、一枝杏花、"Almond Water"。一圈重复两份，瓶子转到哪面都看得到字
function drawLabel(g, x, w, h, th) {
  g.fillStyle = '#fbf8f0';
  g.fillRect(x, 0, w, h);
  g.fillStyle = th.band;
  g.fillRect(x, 0, w, 16);
  g.fillRect(x, h - 16, w, 16);
  g.strokeStyle = '#8a6a4a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x + 10, h - 26);
  g.quadraticCurveTo(x + 30, h / 2, x + 58, 28);
  g.stroke();
  drawBlossom(g, x + 24, 44, 13);
  drawBlossom(g, x + 50, 70, 11);
  drawBlossom(g, x + 30, 88, 9);
  g.fillStyle = th.text;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic bold 36px Georgia, "Times New Roman", serif';
  g.fillText('Almond', x + w / 2 + 30, h / 2 - 16, w - 90);
  g.font = 'italic bold 30px Georgia, "Times New Roman", serif';
  g.fillText('Water', x + w / 2 + 30, h / 2 + 16, w - 90);
  g.font = 'bold 15px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('杏仁水', x + w / 2 + 30, h - 26, w - 90);
}

function labelMaterial(THREE, themeKey) {
  const th = THEMES[themeKey] || THEMES.standard;
  return material('item:aw:label:' + themeKey, () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    drawLabel(g, 0, 256, 128, th);
    drawLabel(g, 256, 256, 128, th);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return new THREE.MeshLambertMaterial({ map: tex, emissive: 0x333333, emissiveMap: tex });
  });
}

function shellMaterial(THREE, themeKey) {
  const th = THEMES[themeKey] || THEMES.standard;
  return material('item:aw:shell:' + themeKey, () => new THREE.MeshPhongMaterial({
    color: col(THREE, th.shell), specular: 0xffffff, shininess: 90,
    transparent: true, opacity: th.shellOp, depthWrite: false,
  }));
}

// opts: { theme, liquid, mold, dent, brokenSeal, name }；三角面约 300（带霉 360）
function makeBottle(THREE, opts) {
  const o = opts || {};
  const themeKey = THEMES[o.theme] ? o.theme : 'standard';
  const th = THEMES[themeKey];
  const inner = [];
  const liquid = paint(THREE, new THREE.CylinderGeometry(LIQ_R, LIQ_R, LIQ_Y1 - LIQ_Y0, SEG, 1, false)
    .translate(0, (LIQ_Y0 + LIQ_Y1) / 2, 0), o.liquid != null ? o.liquid : LIQUID);
  if (o.dent) dent(liquid, 0.24);
  inner.push(liquid);
  const cap = new THREE.CylinderGeometry(CAP_R, CAP_R, CAP_H, 10, 1, false);
  if (o.brokenSeal) {
    // 瓶封破了：防盗环没了，盖子歪着没拧到底
    cap.rotateZ(0.45).translate(0.005, CAP_Y + CAP_H / 2 + 0.005, 0);
  } else {
    cap.translate(0, CAP_Y + CAP_H / 2, 0);
    inner.push(paint(THREE, new THREE.CylinderGeometry(0.0163, 0.0163, 0.004, 10, 1, true).translate(0, 0.207, 0), th.cap));
  }
  inner.push(paint(THREE, cap, th.cap));
  if (o.mold) {
    // 霉斑浮在液面上，隔着透明瓶肩看得见
    MOLD.forEach((c, i) => {
      const a = i * 2.1;
      inner.push(paint(THREE, new THREE.IcosahedronGeometry(0.0085, 0)
        .translate(Math.cos(a) * 0.015, LIQ_Y1 + 0.002, Math.sin(a) * 0.015), c));
    });
  }
  const shell = new THREE.LatheGeometry(SHELL.map(p => new THREE.Vector2(p[0], p[1])), SEG);
  if (!shell.attributes.normal) shell.computeVertexNormals();
  if (o.dent) dent(shell, 0.2);
  const label = new THREE.CylinderGeometry(LABEL_R, LABEL_R, LABEL_Y1 - LABEL_Y0, SEG, 1, true)
    .translate(0, (LABEL_Y0 + LABEL_Y1) / 2, 0);
  if (o.dent) dent(label, 0.2);

  const root = new THREE.Group();
  root.name = o.name || 'almond_water';
  root.add(new THREE.Mesh(merge(THREE, inner), vcMaterial(THREE)));
  root.add(new THREE.Mesh(label, labelMaterial(THREE, themeKey)));
  const sm = new THREE.Mesh(shell, shellMaterial(THREE, themeKey));
  sm.renderOrder = 2;   // 透明瓶身最后画
  root.add(sm);
  root.scale.setScalar(SCALE);
  return root;
}

// ---------- 图标 ----------
function bottlePath(g, dented) {
  g.beginPath();
  g.moveTo(27, 12);
  g.lineTo(37, 12);
  g.lineTo(37, 17);
  g.quadraticCurveTo(45, 19, 45, 27);
  if (dented) { g.lineTo(45, 33); g.quadraticCurveTo(38, 40, 45, 47); }
  g.lineTo(45, 56);
  g.quadraticCurveTo(45, 61, 40, 61);
  g.lineTo(24, 61);
  g.quadraticCurveTo(19, 61, 19, 56);
  g.lineTo(19, 27);
  g.quadraticCurveTo(19, 19, 27, 17);
  g.closePath();
}

function drawIcon(g, opts) {
  const o = opts || {};
  const th = THEMES[o.theme] || THEMES.standard;
  // 瓶盖
  g.save();
  if (o.brokenSeal) { g.translate(33, 9); g.rotate(-0.4); g.fillStyle = th.capCss; g.fillRect(-6, -6, 12, 8); }
  else { g.fillStyle = th.capCss; g.fillRect(26, 3, 12, 8); g.fillRect(25, 10, 14, 2); }
  g.restore();
  // 液体 + 标签，裁在瓶身里面
  g.save();
  bottlePath(g, o.dent);
  g.clip();
  g.fillStyle = th.tintCss;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = hexCss(o.liquid != null ? o.liquid : LIQUID);
  g.fillRect(0, 22, 64, 42);
  g.fillStyle = '#fbf8f0';
  g.fillRect(0, 33, 64, 15);
  g.fillStyle = th.band;
  g.fillRect(0, 33, 64, 3);
  g.fillRect(0, 45, 64, 3);
  g.fillStyle = '#e9a3b8';
  g.beginPath();
  g.arc(26, 40.5, 2.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = th.text;
  g.fillRect(31, 39, 11, 3);
  if (o.mold) {
    const dots = [[25, 23, '#f3f1e8'], [33, 24, '#7fa4c8'], [40, 22.5, '#8db374'], [29, 27, '#f3f1e8']];
    for (const d of dots) { g.fillStyle = d[2]; g.beginPath(); g.arc(d[0], d[1], 2.6, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(22, 24, 2, 8);
  g.restore();
  bottlePath(g, o.dent);
  g.strokeStyle = 'rgba(40,40,60,0.55)';
  g.lineWidth = 1.5;
  g.stroke();
}

function makeIcon(opts) {
  if (typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    drawIcon(c.getContext('2d'), opts);
    return c.toDataURL('image/png');
  } catch (err) {
    return undefined;
  }
}

// ---------- 数值 ----------
// 结算顺序与 _kit.js apply 一致：hungerSet → hunger → hp → sanity → sanityFill → timed → clearHostile / clearTags
function applyEffect(player, s) {
  if (!player || !s) return;
  const maxHp = BR.config.player.maxHp;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fx = BR.effects && typeof BR.effects.add === 'function' ? BR.effects : null;
  if (s.hunger) player.hunger = clamp(player.hunger + s.hunger, 0, 100);
  if (s.hp) player.hp = clamp(player.hp + s.hp, 0, maxHp);
  if (s.sanity) player.sanity = clamp(player.sanity + s.sanity, 0, 100);
  if (s.sanityFill) player.sanity = clamp(player.sanity + (100 - player.sanity) * s.sanityFill, 0, 100);
  if (fx && Array.isArray(s.timed)) for (const t of s.timed) fx.add(Object.assign({}, t));
  if (fx && s.clearHostile) fx.clear({ hostile: true });
  if (fx && Array.isArray(s.clearTags)) for (const tag of s.clearTags) fx.clear({ tag });
}

// 标准款（彩色款在此基础上加）：
//   hunger +8  —— "主要作用是补水、只有少量营养"：本游戏没有口渴值，补水并进饥饿条，量取小
//   hp +5      —— "能治好轻微病症、让状态略微好转"
//   sanity +30 —— "喝完更专注"，并且"完全抵消敌对实体造成的效果"：本游戏敌对实体主要磨 san
//   clearHostile —— 同一句：把标记为敌对实体造成的时效效果全部清掉
const BASE = { hunger: 8, hp: 5, sanity: 30, clearHostile: true };
// "彩色瓶整体都有增加肌肉和耐力的效果"：移速 ×1.1，持续设定 2 小时（页面没写幅度和时长，取保守值）
const VIGOR = { key: 'almond_water_vigor', seconds: LORE_HOUR * 2, speedMul: 1.1 };

const VARIANTS = [
  {
    type: 'almond_water', en: 'Almond Water', zh: '杏仁水', theme: 'standard',
    desc: '前厅杏仁水瓶的复刻。甜杏仁混着香草和玫瑰水的味道，后室里最主要的水源。',
    effect: Object.assign({}, BASE),
  },
  {
    type: 'almond_water_blue', en: 'Almond Water (Blue)', zh: '蓝色杏仁水', theme: 'blue',
    desc: '少见的蓝色瓶。能压下大部分精神失常的迹象。',
    // sanityFill 0.8 —— "清除大部分精神失常的迹象"：缺的 san 补回八成
    // clearTags mental —— 同一句，作用像镇静药：把标记为精神类的时效效果（幻觉扭曲等）清掉
    effect: Object.assign({}, BASE, { sanityFill: 0.8, clearTags: ['mental'], timed: [VIGOR] }),
  },
  {
    type: 'almond_water_green', en: 'Almond Water (Green)', zh: '绿色杏仁水', theme: 'green',
    desc: '少见的绿色瓶，咖啡因很高。喝完对周围更警觉。',
    // alert 0.3 —— "高剂量咖啡因，喝后对周围更警觉"：能见度（雾的远端）额外 +30%，持续设定 2 小时
    effect: Object.assign({}, BASE, { timed: [VIGOR, { key: 'almond_water_alert', seconds: LORE_HOUR * 2, visual: { alert: 0.3 } }] }),
  },
  {
    type: 'almond_water_red', en: 'Almond Water (Red)', zh: '红色杏仁水', theme: 'red',
    desc: '最稀有的红色瓶，据说只找到过五瓶。伤口愈合得飞快。',
    // hpPerSec +1 × 60 秒 —— "促进血液循环、大幅加快伤口愈合"：设定 1 小时内回 60 点血
    effect: Object.assign({}, BASE, { timed: [VIGOR, { key: 'almond_water_heal', seconds: LORE_HOUR, hpPerSec: 1 }] }),
  },
  {
    type: 'almond_water_expired', en: 'Almond Water (Expired)', zh: '过期杏仁水', theme: 'standard',
    liquid: LIQUID_EXPIRED, mold: true, sound: 'drink', toast: '一股馊牛奶加奶酪的味道……',
    desc: '放太久了，液体里长着白、蓝、绿色的霉，闻起来像馊掉的牛奶和奶酪。',
    // 过期后没有任何好处，只剩毒性，持续设定 1 小时：
    //   speedMul 0.75     —— "虚弱、疲劳"
    //   hpPerSec -0.5     —— "内出血、动脉瘤"，放很久的曾喝死人：60 秒共掉 30 血，残血时能致死
    //   sanityPerSec -0.3 —— "痴呆"
    //   distort 0.25      —— 同上，画面轻度扭曲
    effect: { timed: [{
      key: 'almond_water_spoiled', seconds: LORE_HOUR, speedMul: 0.75, hpPerSec: -0.5, sanityPerSec: -0.3,
      visual: { distort: 0.25 }, tags: ['poison'], cause: '喝了过期发霉的杏仁水，中毒身亡',
    }] },
  },
];

VARIANTS.forEach((v) => {
  const model = { theme: v.theme, liquid: v.liquid, mold: v.mold, name: v.type };
  const def = {
    type: v.type, en: v.en, zh: v.zh, version: 'fandom',
    category: 'drink',
    stack: 5,
    desc: v.desc,
    icon: makeIcon(model),
    effect: v.effect,
    build(ctx) {
      const THREE = (ctx && ctx.THREE) || window.THREE;
      return makeBottle(THREE, model);
    },
    // 直接改 player 字段；游玩/测试模式下 player.useSelected 会把 hp/饥饿/san 原样还回去
    use(player) {
      applyEffect(player, this.effect);
      sound('drink');
      toast(v.toast);
      return true;
    },
  };
  if (v.type === 'almond_water') {
    def.bottle = (ctx, opts) => makeBottle((ctx && ctx.THREE) || window.THREE, opts);
    def.drawIcon = drawIcon;
  }
  BR.itemTypes.register(def);
});
})();
