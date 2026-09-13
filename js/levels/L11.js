// Level 11 - "The City That Never Sleeps"（城市层，M.E.G. 编号 Level 11，绰号 the city level）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-11  许可：CC BY-SA 3.0
// 抓取：2026-09-12；作者 Stretchsterz 原作、Boring Talking 重写
// 只按这一个版本实现：中文站的「重力对建筑无效/漂浮叠放」「无面灵与猎犬能说话」「核电站辐射」，
// fandom 的「无生命/无实体/迷宫窄缝」等 conflicts 里列出的细节一律不借；本层的天空、声音细节、气候
// 选中版本本就没写（unverified），不从别的版本补、不凭记忆编造
// （data/lore-choices.json levels["11"].source = "wikidot-en"）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// layout「开阔城市，不是迷宫，道路按街区网格排列」——不用 kit.grid（_TEMPLATE.md 7.4 节：城市这类开阔层直接
// b.box/b.plane 搭，自己撒刷新点）；scale 说地铁/出口无限延伸，用较大 chunkSize 让一个街区对应一个区块
const SIZE = 44;                 // chunkSize：40-48 档里取中间偏大，一个区块=一个街区（建筑+周边道路）
const M = 4;                     // 街道半宽：每个区块从边缘往里 4 米是道路，相邻区块拼起来正好 8 米宽的街道
const SIDEWALK = 1.5;            // 人行道宽度（贴着建筑那一侧）
const ASPHALT = M - SIDEWALK;    // 车行道宽度（拼上邻块得到完整路面）
const BL = SIZE - 2 * M;         // 地块（建筑用地）边长
const STORY = 3.2;               // 建筑每层高度：原文没给数字，参考常见办公/公寓层高，非设定
const ROOM_H = 2.8;              // 底层可进入房间的净高，与 kit.builder 缺省层高一致
const FOG_FAR = Math.min(SIZE * 2, 80);

// ---------- 材质 ----------
function defineMaterials() {
  // 人行道/车行道同一种材质用顶点色区分深浅，省一个 mesh（性能约束：draw call 预算）
  kit.mat('L11:pavement', { tex: 'concrete', repeatMeters: 3, roughness: 0.9, vertexColors: true });
  // architecture「灰色公寓楼布满小窗」——公寓/办公楼外立面主材质，自制贴图 l11_apartment_windows
  kit.mat('L11:facade', { tex: 'l11_apartment_windows', repeatMeters: [11, 19], roughness: 0.85 });
  // architecture「约1/3的建筑不可破坏不可进入，窗户像暗淡的黑色镜面」——不开贴图，纯色仿镜面
  kit.mat('L11:blackglass', { color: 0x0b0d10, roughness: 0.25, metalness: 0.4 });
  // architecture「未完工办公室：裸露混凝土墙」+ 低密度区住宅/商铺：沿用引擎自带 concrete，不额外起贴图
  kit.mat('L11:concrete', { tex: 'concrete', repeatMeters: 3.5, roughness: 0.9 });
  // materials「黑色老旧砖立面（I.M.B.H.）」+「新新阿姆斯特丹两层英式砖砌商铺」：复用 Level 3 的棕砖贴图，
  // 用 color 把它压成更接近「黑色老旧」的暗灰棕（其余场景直接用原色代表红棕砖）
  kit.mat('L11:brick', { tex: 'l3_brick_brown', repeatMeters: 2.2, roughness: 0.9 });
  kit.mat('L11:brick_dark', { tex: 'l3_brick_brown', repeatMeters: 2.2, roughness: 0.85, color: 0x6a625a });
}
// file:// 兜底（双击 index.html 时读不到 jpg）：简单画一片灰墙 + 规律小窗
BR.assets.registerProcedural('l11_apartment_windows', 256, (g, s) => {
  g.fillStyle = '#928e86'; g.fillRect(0, 0, s, s);
  const cols = 6, rows = 10, cw = s / cols, rh = s / rows;
  const r = U.rng('l11_apartment_windows');
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const lit = r() < 0.12;
    g.fillStyle = lit ? '#e8c878' : '#2c2c30';
    g.fillRect(i * cw + cw * 0.28, j * rh + rh * 0.22, cw * 0.44, rh * 0.56);
  }
});

// ---------- 密度场：建筑密度逐区渐变 ----------
// layout「建筑密度逐区变化：有的区全是摩天楼，有的区楼高不过三层……再逐渐过渡」——用宏格四角哈希值做双线性
// 插值，得到一个在整数区块坐标上连续变化的场，纯函数、不吃 rng，两端联机算出来完全一样
const DFIELD_MACRO = 4;
function densityField(seed, cx, cz) {
  const mx = Math.floor(cx / DFIELD_MACRO), mz = Math.floor(cz / DFIELD_MACRO);
  const fx = U.smoothstep(0, 1, (cx - mx * DFIELD_MACRO) / DFIELD_MACRO);
  const fz = U.smoothstep(0, 1, (cz - mz * DFIELD_MACRO) / DFIELD_MACRO);
  const corner = (ix, iz) => (U.hashInts(seed, 'L11-density', ix, iz) >>> 0) / 4294967296;
  const a = U.lerp(corner(mx, mz), corner(mx + 1, mz), fx);
  const b2 = U.lerp(corner(mx, mz + 1), corner(mx + 1, mz + 1), fx);
  return U.lerp(a, b2, fz);
}
function tierOf(d) { return d < 0.42 ? 'low' : d < 0.78 ? 'mid' : 'high'; }

// ---------- 街道（每块统一，四边同宽，边界不会出现半堵墙的问题） ----------
function frameRect(b, d0, d1, matKey, color) {
  const w = d1 - d0, mid = (d0 + d1) / 2;
  b.plane(SIZE / 2, 0, mid, SIZE, w, matKey, { facing: 'up', solid: false, color });
  b.plane(SIZE / 2, 0, SIZE - mid, SIZE, w, matKey, { facing: 'up', solid: false, color });
  b.plane(mid, 0, SIZE / 2, w, SIZE - 2 * d1, matKey, { facing: 'up', solid: false, color });
  b.plane(SIZE - mid, 0, SIZE / 2, w, SIZE - 2 * d1, matKey, { facing: 'up', solid: false, color });
}
function buildStreets(b, rng) {
  frameRect(b, 0, ASPHALT, 'L11:pavement', 0x2c2c2e);        // 车行道（深）
  frameRect(b, ASPHALT, M, 'L11:pavement', 0xb7b6ac);        // 人行道（浅）
  // 路灯：四条人行道中点各一盏，白天不点亮（lighting 全篇 unverified，只作为街道家具，不占灯光预算）
  const mids = [[SIZE / 2, ASPHALT + SIDEWALK / 2], [SIZE / 2, SIZE - ASPHALT - SIDEWALK / 2],
                [ASPHALT + SIDEWALK / 2, SIZE / 2], [SIZE - ASPHALT - SIDEWALK / 2, SIZE / 2]];
  for (const [x, z] of mids) if (rng() < 0.85) kit.prop.streetlight(b, x, z, 0, { h: 5.5, state: 'off', light: false });
  // other「无人观察时车辆会在停车场和路边挪位」——引擎没有可见性判定（见 apiRequests），只放静止停靠的车做装饰
  if (rng() < 0.6) {
    const s = mids[Math.floor(rng() * 4)];
    b.box(s[0] + (rng() - 0.5) * 2, 0.35, s[1] + (rng() - 0.5) * 2, 1.7, 0.55, 3.6, 'kit:prop', { color: 0x596273 + Math.floor(rng() * 4) * 0x030303 });
  }
}

// ---------- 通用：临街小房子（商铺/工厂/医院……大多数具名出口共用这一个函数） ----------
// (x,z) 是地块局部坐标下建筑正面墙的中心，正面朝 +Z（局部南）
function buildStorefront(b, x, z, opts) {
  const w = opts.w || 7, d = opts.d || 6, h = opts.h || STORY;
  const matKey = opts.matKey || 'L11:concrete';
  b.box(x, 0, z - d / 2, 0.25, h, d, matKey, { faces: 'sides' });                 // 左墙
  b.box(x + w, 0, z - d / 2, 0.25, h, d, matKey, { faces: 'sides' });             // 右墙
  b.box(x + w / 2, 0, z - d, w, h, 0.25, matKey, { faces: 'sides' });             // 背墙
  b.plane(x + w / 2, h, z - d / 2, w, d, matKey, { facing: 'down' });             // 屋顶底
  b.plane(x + w / 2, h, z - d / 2, w, d, 'kit:prop', { facing: 'up', color: opts.roofColor || 0x3a3a3a, solid: false });
  b.plane(x + w / 2, 0.01, z - d / 2, w - 0.5, d - 0.5, 'kit:prop', { facing: 'up', color: opts.floorColor || 0x8a8378, solid: false });
  if (opts.furnish) { kit.prop.desk(b, x + w * 0.3, z - d * 0.6, Math.PI, { color: 0x3c2e1e }); kit.prop.chair(b, x + w * 0.3, z - d * 0.4, 0, {}); }
  kit.prop.lightPanel(b, x + w / 2, z - d / 2, 0, { y: h - 0.05, w: 0.9, d: 0.5, state: 'on', color: 0xeef1ee, intensity: 0.7, range: 5 });
  const doorOpts = {
    style: opts.doorStyle || 'metal', w: opts.doorW || 1.3, h: Math.min(h - 0.3, 2.3),
    wall: { matKey, w, h }, sign: opts.sign !== false ? (opts.accent || 0x9fd6ff) : false, solid: true,
  };
  // 前墙+门：有出口目标时交给 kit.exit 一次建好（它自己会摆门、算触发点），没有目标就只当装饰门——
  // 避免"手摆一扇门 + kit.exit 又摆一扇门"重复建两扇门（kind:'door' 的 kit.exit 内部本来就会调 prop.door）
  let handle = null;
  if (opts.toLevel) {
    handle = kit.exit(b, { to: opts.toLevel, kind: 'door', x: x + w / 2, z, rot: 0, label: opts.label, door: doorOpts });
  } else {
    kit.prop.door(b, x + w / 2, z, 0, doorOpts);
  }
  return { cx: x + w / 2, cz: z, w, d, h, exitHandle: handle };
}

// ---------- 具名商铺表（16 家共用 buildStorefront；全部指向首期范围外的层级，kit 自动 sealed） ----------
const SHOPS = [
  { name: 'bakery', toLevel: '304', accent: 0xe0c49a, w: 6, d: 5.5, note: '随机面包房（exits：随机面包房）' },
  { name: 'bakery_scented', toLevel: '67', accent: 0xf2d9a8, w: 6, d: 5.5, note: '飘着香味的面包房（exits：循着面包房的香味走）' },
  { name: 'flower_shop', toLevel: '214', accent: 0x8fae6b, w: 5.5, d: 5, note: '随机花店' },
  { name: 'bar', toLevel: '370', accent: 0x6b4a2e, w: 7, d: 6, note: '酒吧（entrances 也提到从 Level 370 的发光门廊来这边）' },
  { name: 'mattress_store', toLevel: '900', accent: 0xb6b0c8, w: 7, d: 6, note: '床垫店' },
  { name: 'thrift_store', toLevel: '179', accent: 0x9a8f74, w: 6.5, d: 5.5, note: '慈善/二手店（entrances 也提到 Level 179 的出口门通到这类店）' },
  { name: 'water_store', toLevel: '119', accent: 0x6fa8c9, w: 5.5, d: 5, note: '供水店' },
  { name: 'boiler_building', toLevel: '141', accent: 0x8a7a5a, w: 7, d: 6.5, matKey: 'L11:concrete', note: '内部有旧锅炉的建筑，探索足够久随机到达（简化成直接开门）' },
  { name: 'antiques_shop', toLevel: '232', accent: 0x9a7a4a, w: 6, d: 5.5, note: "Caspian's Antiques（招牌名，用发光牌代替文字招牌）" },
  { name: 'pizza_palace', toLevel: '458', accent: 0xc23b2e, w: 6.5, d: 6, note: "Papa Pedro's Pizza Palace of Pleasantries" },
  { name: 'exhibit_hall', toLevel: '126', accent: 0x8a6a9a, w: 9, d: 7, note: "Mr. Holloway's Grand Exhibit，比普通商铺大一号" },
  { name: 'frozen_food_market', toLevel: '55', accent: 0x9fd3e0, w: 8, d: 6.5, note: "Frivolous Frank's Fabulous Frozen Food，原文「很少见」" },
  { name: 'restaurant_random', toLevel: '213', accent: 0xd98040, w: 6.5, d: 6, note: '随机餐厅（entrances 里 Level 6.1 的玻璃推拉门对应款式，简化为普通门）' },
  { name: 'modern_door_old', toLevel: '247', accent: 0x8fd0e0, matKey: 'L11:brick', w: 6, d: 5.5, note: '历史风格建筑上的现代门' },
  { name: 'cinema', toLevel: '68', accent: 0xffe27a, w: 8, d: 7, note: '电影院（原文「有一定概率」，简化为进门必达）' },
  { name: 'arcade_building', toLevel: '808', accent: 0x38e8ff, w: 7, d: 6.5, note: '街机厅建筑' },
];
function buildShopLot(b, rng) {
  const s = U.weighted(rng, SHOPS.map((s2, i) => [i, s2.name === 'frozen_food_market' ? 0.12 : s2.name === 'bakery_scented' || s2.name === 'exhibit_hall' ? 0.35 : 1]));
  const shop = SHOPS[s];
  const w = shop.w, d = shop.d;
  const info = buildStorefront(b, (BL - w) / 2, (BL - d) / 2 + d, {
    w, d, h: STORY * (shop.name === 'exhibit_hall' ? 1.6 : 1), matKey: shop.matKey || 'L11:concrete',
    accent: shop.accent, furnish: rng() < 0.4, toLevel: shop.toLevel, label: shop.note,
  });
  let toasted = false;
  b.update(() => {
    const P = BR.player, dx = P.x - (b.ox + info.cx), dz = P.z - (b.oz + info.cz);
    if (!toasted && dx * dx + dz * dz < 9 * 9) { toasted = true; BR.hud.toast('路边的招牌：' + shop.note, 2200); }
  });
}

// ---------- 普通建筑：按密度场取层数/材质，约 1/3 高层不可进入（黑色镜面窗） ----------
function buildPlainLot(b, rng, cx, cz, ctx) {
  const d = densityField(ctx.levelSeed, cx, cz);
  const tier = tierOf(d);
  const frac = 0.72 + rng() * 0.2;
  const w = BL * frac, dep = BL * frac, x0 = (BL - w) / 2, z0 = (BL - dep) / 2;
  let floors, matKey, sealed = false;
  if (tier === 'low') { floors = 1 + Math.floor(rng() * 3); matKey = 'L11:concrete'; }
  else if (tier === 'mid') { floors = 4 + Math.floor(rng() * 7); matKey = 'L11:facade'; sealed = rng() < 0.33; }
  else { floors = 15 + Math.floor(rng() * 26); matKey = 'L11:facade'; sealed = rng() < 0.33; }
  const h = floors * STORY;
  const mk = sealed ? 'L11:blackglass' : matKey;
  if (sealed) {
    // architecture「约1/3的建筑……窗户像暗淡的黑色镜面，门锁死」——整体一个盒子，纯碰撞、无法进入
    b.box(x0 + w / 2, 0, z0 + dep / 2, w, h, dep, mk, { faces: 'sides' });
    b.plane(x0 + w / 2, h, z0 + dep / 2, w, dep, mk, { facing: 'up' });
    // hazards「靠近体量很大的朴素建筑时可能随机切出到 Level 164」——高层里偶尔一栋兼作这个出口，不做成每栋都有
    if (tier === 'high' && rng() < 0.15) {
      kit.exit(b, { to: '164', kind: 'zone', x: x0 + w / 2, z: z0 + dep / 2, radius: Math.max(w, dep) * 0.6, label: '巨大朴素的建筑', marker: { color: [0.2, 0.2, 0.22], pulse: false } });
    }
    return;
  }
  // 底层可进入，楼上不可达（引擎没有多层楼——见 apiRequests）：底层单独砌墙+门，二层以上是一整块实体量体
  const doorSide = Math.floor(rng() * 4);
  const rot = doorSide * Math.PI / 2;
  b.push(x0 + w / 2, z0 + dep / 2, rot);
  const hw = w / 2, hd = dep / 2;
  kit.prop.door(b, 0, hd, 0, { style: 'metal', w: 1.3, h: ROOM_H - 0.3, wall: { matKey: mk, w, h: ROOM_H }, sign: false, solid: true });
  b.box(0, 0, -hd, w, ROOM_H, 0.2, mk, { faces: 'sides' });
  b.box(-hw, 0, 0, 0.2, ROOM_H, dep, mk, { faces: 'sides' });
  b.box(hw, 0, 0, 0.2, ROOM_H, dep, mk, { faces: 'sides' });
  b.plane(0, 0.01, 0, w - 0.4, dep - 0.4, 'kit:prop', { facing: 'up', color: 0x8c8578, solid: false });
  kit.prop.lightPanel(b, 0, 0, 0, { y: ROOM_H - 0.05, state: rng() < 0.08 ? 'flicker' : 'on', color: 0xeef1ee, intensity: 0.75, range: 5.5 });
  // materials「开放建筑内家具总是稀少」——最多摆一件
  if (rng() < 0.5) kit.prop.cubicle(b, 0, hd * 0.3, Math.PI, { w: 1.8, d: 1.6, desk: rng() < 0.7, chair: true, monitor: false });
  if (floors > 1) {
    b.box(0, ROOM_H + 0.2, 0, w, h - ROOM_H - 0.2, dep, mk, { faces: 'sides' });
    b.plane(0, h + 0.2, 0, w, dep, mk, { facing: 'up' });
  } else {
    b.plane(0, ROOM_H + 0.2, 0, w, dep, mk, { facing: 'up' });
  }
  b.pop();
}

// ---------- 公园（出生块也是一种公园，见 buildSpawnPlaza）----------
function buildPark(b, rng) {
  b.plane(BL / 2, 0.01, BL / 2, BL - 2, BL - 2, 'kit:prop', { facing: 'up', color: 0x4f7a45, solid: false });
  for (let k = 0; k < 5; k++) {
    const x = 3 + rng() * (BL - 6), z = 3 + rng() * (BL - 6);
    b.cylinder(x, 0, z, 0.22, 1.6, 'kit:prop', { color: 0x4a3a26, segments: 6 });
    b.box(x, 1.6, z, 1.8, 1.4, 1.8, 'kit:prop', { color: 0x2e5a2a });
  }
  b.box(BL / 2, 0.22, BL * 0.25, 1.4, 0.42, 0.4, 'kit:prop', { color: 0x3a3226 });   // 长椅
  // landmarks「没有成片森林或平原，只有公园」+ exits「绊倒摔进灌木丛时切出到 Level 63」
  if (rng() < 0.35) {
    const bx = BL * 0.7, bz = BL * 0.7;
    b.box(bx, 0.35, bz, 1.6, 0.7, 1.6, 'kit:prop', { color: 0x355c30 });
    kit.exit(b, { to: '63', kind: 'zone', x: bx, z: bz, radius: 1.2, label: '灌木丛' });
  }
}
function buildSpawnPlaza(b, rng) { buildPark(b, rng); }

// ---------- 近出生点、必须能找到的两个首期出口 ----------
function buildFunZone(b, rng) {
  // exits「标着 Fun Zone 的建筑，必定生效」→ Level 20 在首期范围内，规则②要求离出生点很近就能找到
  const info = buildStorefront(b, (BL - 9) / 2, BL - 1, {
    w: 9, d: 7.5, h: STORY * 1.3, matKey: 'L11:concrete', accent: 0xff5fb0, sign: true, furnish: false,
    toLevel: '20', label: 'Fun Zone',
  });
  kit.prop.sign(b, info.cx, info.cz - 0.05, 0, { y: info.h + 0.3, w: 2.2, h: 0.5, color: 0xff5fb0 });
}
function buildWindowBuilding(b, rng) {
  // hazards「长得像窗户实体（Entity 2 The Windows）的窗户，切进去到 Level 12，原文称危险」——
  // Entity 2 不在本批实体清单里（entity-index.json 里本层没有登记它），这里只做窗户本身与出口，不做会动的实体
  const w = 8, d = 6, h = STORY * 3;
  const x0 = (BL - w) / 2, z0 = BL - d - 1;
  b.box(x0 + w / 2, 0, z0, w, h, 0.25, 'L11:concrete', { faces: 'sides' });
  b.box(x0, 0, z0 + d / 2, 0.25, h, d, 'L11:concrete', { faces: 'sides' });
  b.box(x0 + w, 0, z0 + d / 2, 0.25, h, d, 'L11:concrete', { faces: 'sides' });
  b.plane(x0 + w / 2, h, z0 + d / 2, w, d, 'L11:concrete', { facing: 'up' });
  // 那扇「像实体」的窗户：颜色比普通窗户深一分、边框不对称，暗示不对劲
  kit.prop.window(b, x0 + w / 2, z0 + d - 0.02, 0, { w: 1.6, h: 1.9, y: 1.0, tint: 0x0a0604, glow: 0x241a14, wall: { matKey: 'L11:concrete', w, h } });
  kit.exit(b, { to: '12', kind: 'noclip', x: x0 + w / 2, z: z0 + d - 0.1, radius: 1.1, w: 1.8, h: 2.2, matKey: 'L11:concrete', label: '窗户——原文提醒这样切进 Level 12 很危险' });
  let toasted = false;
  b.update(() => {
    const P = BR.player, dx = P.x - (b.ox + x0 + w / 2), dz = P.z - (b.oz + z0 + d);
    if (!toasted && dx * dx + dz * dz < 6 * 6) { toasted = true; BR.hud.toast('这扇窗户……看起来不太对劲', 2200); }
  });
}

// ---------- 静态据点/地标（用户规则：只摆建筑与标记，不做交易与 NPC 对话） ----------
function toastNear(b, x, z, r, text) {
  let done = false;
  b.update(() => {
    const P = BR.player, dx = P.x - (b.ox + x), dz = P.z - (b.oz + z);
    if (!done && dx * dx + dz * dz < r * r) { done = true; BR.hud.toast(text, 2600); }
  });
}
function buildBaseBeta(b, rng) {
  // bases「M.E.G. Base Beta：唯一不在室内层级的主要基地」；landmarks「侧面挂着 Level 115 入口」（不在首期范围，sealed）
  const info = buildStorefront(b, (BL - 10) / 2, BL * 0.6, { w: 10, d: 8, h: STORY * 2, matKey: 'L11:concrete', accent: 0x6fae6f, sign: true, toLevel: '115', label: 'M.E.G. Base Beta 側面标示的 Level 115 入口' });
  kit.prop.fence(b, info.cx - 6, 4, Math.PI / 2, { length: 8, h: 1.6, kind: 'chain', color: 0x777d78 });
  kit.prop.fence(b, info.cx + 6, 4, Math.PI / 2, { length: 8, h: 1.6, kind: 'chain', color: 0x777d78 });
  // bases「Camp Amber：离 Base Beta 不远，两地间有常用的高架人行桥」——用一段抬高的天桥暗示方向，不单独建区块
  b.push(info.cx, 2, 0);
  for (let k = 0; k < 6; k++) b.box(-2.5 + k, 2.6, 0, 0.9, 0.15, 1.4, 'kit:prop', { color: 0x5a5650 });
  b.pop();
  toastNear(b, info.cx, info.cz, 10, 'M.E.G. Base Beta——通往 Camp Amber 的高架人行桥就在附近');
}
function buildNewTimesSquare(b, rng) {
  // bases「B.N.T.G. 新时代广场：围墙社区，两个有人把守登记来客的入口，中心是市场摊位」——只摆围墙+摊位外观
  kit.prop.fence(b, 2, BL / 2, Math.PI / 2, { length: BL - 4, h: 2, kind: 'rail', color: 0x8a7a5a });
  kit.prop.fence(b, BL - 2, BL / 2, Math.PI / 2, { length: BL - 4, h: 2, kind: 'rail', color: 0x8a7a5a });
  kit.prop.fence(b, BL / 2, 2, 0, { length: BL - 4, h: 2, kind: 'rail', color: 0x8a7a5a });
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, r = BL * 0.28;
    b.box(BL / 2 + Math.cos(a) * r, 0.5, BL / 2 + Math.sin(a) * r, 1.4, 1, 1.2, 'kit:prop', { color: 0x9a6a3a });
  }
  toastNear(b, BL / 2, BL / 2, 14, 'B.N.T.G. 新时代广场——围墙社区，登记来客才能进');
}
function buildThebes(b, rng) {
  // bases「U.E.C. 底比斯：唯一入口重兵把守，可移动铁丝网围栏后堆着家具杂物」；hazards「实体不论敌友一律当场击杀」
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    b.push(BL / 2, BL / 2, a);
    kit.prop.fence(b, 0, BL * 0.32, 0, { length: BL * 0.55, h: 1.8, kind: 'chain', color: 0x59544c });
    b.pop();
  }
  for (let k = 0; k < 8; k++) {
    const a = rng() * Math.PI * 2, r = BL * 0.3 + rng() * 3;
    b.box(BL / 2 + Math.cos(a) * r, 0.4, BL / 2 + Math.sin(a) * r, 0.9, 0.8 + rng() * 0.8, 0.7, 'kit:prop', { color: 0x453a2e, rotY: a });
  }
  toastNear(b, BL / 2, BL / 2, 16, 'U.E.C. 底比斯——敌视外人的围墙社区，最好绕开');
}
function buildGpdTower(b, rng) {
  // landmarks「G.P.D. B-Team 大楼：几乎触到云层的玻璃摩天楼，周围没有其他高楼入镜」——本层最高的一栋
  const w = BL * 0.55, floors = 46, h = floors * STORY;
  b.box(BL / 2, 0, BL / 2, w, h, w, 'L11:facade', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, w, 'L11:facade', { facing: 'up' });
  kit.prop.door(b, BL / 2, BL / 2 - w / 2, 0, { style: 'metal', w: 1.6, h: 2.4, wall: false, solid: true });
  toastNear(b, BL / 2, BL / 2, 18, 'G.P.D. B-Team 大楼——玻璃幕墙一直插进云层里');
}
function buildImbh(b, rng) {
  // landmarks「I.M.B.H. Charles Darwin Research Centre：狭长砖楼，黑色老旧砖立面……贴着 KEEP OUT 告示」
  const w = BL * 0.8, d = BL * 0.35, h = STORY * 2;
  b.box(BL / 2, 0, BL / 2, w, h, d, 'L11:brick_dark', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, d, 'L11:brick_dark', { facing: 'up' });
  kit.prop.sign(b, BL / 2, BL / 2 - d / 2 - 0.05, 0, { y: 1.6, w: 1.2, h: 0.35, color: 0xff4030, backColor: 0x1a1a1a });
  toastNear(b, BL / 2, BL / 2, 12, 'I.M.B.H. 研究中心——到处贴着 KEEP OUT，不对外开放');
}
function buildCapitalMarket(b, rng) {
  // landmarks「首都：中心有摆满食品摊、人流拥挤的集市」——只做市集外观，不做交易
  b.plane(BL / 2, 0.01, BL / 2, BL - 2, BL - 2, 'L11:pavement', { facing: 'up', solid: false, color: 0xc7c4b8 });
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const x = 6 + i * (BL - 12) / 3, z = 6 + j * (BL - 12) / 2;
    b.box(x, 0.5, z, 1.6, 1, 1.4, 'kit:prop', { color: 0x7a5a3a + (i + j) * 0x000202 });
    b.box(x, 1.6, z, 1.8, 0.06, 1.6, 'kit:prop', { color: 0xb04040 });
  }
  toastNear(b, BL / 2, BL / 2, 16, '首都的集市——宽 5.5 英里的居住中心，这里只是边缘的一角');
}
function buildCanalSegment(b, rng, cx, cz) {
  // landmarks「宽阔运河，两岸是矮胖现代摩天楼，多座桥横跨」——沿整行区块延伸的一条水道，东西贯通
  const cz0 = BL * 0.35, cz1 = BL * 0.65;
  b.plane(BL / 2, 0.02, (cz0 + cz1) / 2, BL, cz1 - cz0, 'kit:water', { facing: 'up', solid: false });
  const hasBridge = ((cx % 3) + 3) % 3 === 0;
  if (hasBridge) {
    b.box(BL / 2, (cz1 - cz0) * 0.28, (cz0 + cz1) / 2, 3.2, 0.25, cz1 - cz0 + 2, 'kit:prop', { color: 0x5a5650 });
  }
  for (const zc of [cz0 - BL * 0.18, cz1 + BL * 0.18]) {
    for (let k = 0; k < 3; k++) {
      const x = 4 + k * (BL - 8) / 2;
      b.box(x, 0, zc, 6, STORY * (6 + Math.floor(rng() * 5)), 5, 'L11:facade', { faces: 'sides' });
      b.plane(x, STORY * 8, zc, 6, 5, 'L11:facade', { facing: 'up' });
    }
  }
}
// old_quarter：environment.other「少数区域外观比别处更老」+ bases「New New Amsterdam：鹅卵石路、单轨电车、两层英式砖商铺」
// 用一个可反复出现的“老城区”区块变体代表这条规则，不单独占用一个固定坐标
function buildOldQuarter(b, rng) {
  b.plane(BL / 2, 0.01, BL / 2, BL, BL, 'L11:pavement', { facing: 'up', solid: false, color: 0x9a9488 });
  b.box(BL / 2, 0.04, BL / 2, BL - 4, 0.35, 1.4, 'kit:prop', { color: 0x2e2c2a });   // 电车轨道基座
  for (let i = 0; i < 2; i++) b.box(BL / 2, 0.1, BL / 2 + (i - 0.5) * 0.9, BL - 4, 0.06, 0.12, 'kit:prop', { color: 0x151515 });
  for (let k = 0; k < 3; k++) {
    const x = 6 + k * (BL - 12) / 2;
    buildStorefront(b, x, BL - 3, { w: 5, d: 4.5, h: STORY * 2, matKey: 'L11:brick', accent: 0xd0a860, furnish: false, sign: false });
  }
  toastNear(b, BL / 2, BL / 2, 14, '这片街区看起来比周围老得多——鹅卵石路面、砖砌商铺，像是有人一直住在这里');
}

// ---------- 交通枢纽 ----------
function buildSubway(b, rng) {
  // 手摆楼梯间做视觉，出口用 zone（kit.exit 的 kind:'stairs' 自己也会摆一次楼梯间，两个一起用会重复建两份）
  kit.prop.stairwell(b, BL / 2, BL / 2, 0, { down: true, w: 2, depth: 3, steps: 8, sign: true });
  kit.exit(b, { to: '158', kind: 'zone', x: BL / 2, z: BL / 2 - 0.9, radius: 1.2, label: '地铁——exits「乘坐地铁或地上铁路的列车」' });
  toastNear(b, BL / 2, BL / 2, 8, '地铁入口——地铁沿地面道路的布局无限延伸');
}
function buildBusStop(b, rng) {
  b.box(BL / 2 - 1.2, 0, BL * 0.4, 0.15, 2.2, 2.6, 'kit:prop', { color: 0x6a6a6a, faces: 'sides' });
  b.plane(BL / 2 - 1.2, 2.2, BL * 0.4, 0.9, 2.6, 'kit:prop', { facing: 'down', color: 0x6a6a6a });
  b.box(BL / 2 + 2, 0.9, BL * 0.4, 6.5, 1.4, 2.2, 'kit:prop', { color: 0x8a3a3a });   // 停靠的巴士
  kit.exit(b, { to: '147', kind: 'zone', x: BL / 2 + 2, z: BL * 0.4, radius: 1.6, label: '巴士——entrances 提到「乘坐巴士」能到本层，反过来也能坐走' });
  toastNear(b, BL / 2, BL * 0.4, 8, '停在路边的巴士——车门是开的，但没人知道它到底通向哪');
}
function buildAirport(b, rng) {
  kit.prop.fence(b, BL / 2, 3, 0, { length: BL - 6, h: 2.2, kind: 'chain', color: 0x8a8a8a });
  b.plane(BL / 2, 0.02, BL / 2, BL - 8, BL - 8, 'L11:pavement', { facing: 'up', solid: false, color: 0x2c2c2e });
  b.box(BL / 2, 1.1, BL * 0.4, 10, 2.2, 2.2, 'kit:prop', { color: 0xd8d8d0 });          // 简化机身
  b.box(BL / 2, 1.3, BL * 0.4, 0.5, 0.3, 9, 'kit:prop', { color: 0xc8c8c0 });          // 机翼
  kit.exit(b, { to: '212', kind: 'zone', x: BL / 2, z: BL * 0.4 + 2, radius: 1.8, label: '机场——原文「罕见」' });
  toastNear(b, BL / 2, BL / 2, 12, '一座机场——原文说这在本层很罕见');
}

// ---------- 工业/医疗 ----------
function buildFactory(b, rng, broken) {
  const w = BL * 0.75, d = BL * 0.6, h = STORY * 2.4;
  b.box(BL / 2, 0, BL / 2, w, h, d, 'L11:concrete', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, d, 'L11:concrete', { facing: 'up' });
  kit.prop.pipe(b, BL / 2 + w * 0.3, BL / 2 - d * 0.3, 0, { axis: 'y', r: 0.5, length: h * 1.4, color: broken ? 0x554a3e : 0x6a6a6a });
  const info = { cx: BL / 2, cz: BL / 2 - d / 2 };
  // 门只当装饰摆出来（大楼是整块实体量体，没有真正掏洞），出口用 zone 摆在门前，避免 kit.exit(kind:'door') 再摆一扇重复的门
  kit.prop.door(b, info.cx, info.cz, 0, { style: 'metal', w: 1.8, h: 2.4, wall: false, solid: true });
  if (broken) {
    kit.prop.window(b, BL / 2 - w * 0.25, info.cz + 0.01, 0, { blackout: true, w: 1.4, h: 1.2 });
    kit.exit(b, { to: '603', kind: 'zone', x: info.cx, z: info.cz + 0.8, radius: 1.2, label: '外观破败的工厂（exits「通常如此」）' });
  } else {
    kit.exit(b, { to: '901', kind: 'zone', x: info.cx, z: info.cz + 0.8, radius: 1.2, label: '完好运转的工厂（exits：穿过机器切出）' });
  }
}
function buildPowerPlant(b, rng) {
  const w = BL * 0.7, d = BL * 0.7, h = STORY * 3;
  b.box(BL / 2, 0, BL / 2, w, h, d, 'L11:concrete', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, d, 'L11:concrete', { facing: 'up' });
  for (let k = 0; k < 2; k++) kit.prop.pipe(b, BL / 2 - w * 0.25 + k * w * 0.5, BL / 2, 0, { axis: 'y', r: 0.9, length: h * 1.6, color: 0x7a7a78 });
  kit.prop.door(b, BL / 2, BL / 2 - d / 2, 0, { style: 'metal', w: 1.8, h: 2.4, wall: false, solid: true });
  kit.exit(b, { to: '740', kind: 'zone', x: BL / 2, z: BL / 2 - d / 2 + 0.8, radius: 1.3, label: '运转中的发电厂（exits「经常发生」）' });
}
function buildHospital(b, rng, glitched) {
  const w = BL * 0.7, d = BL * 0.55, h = STORY * 4;
  b.push(BL / 2, BL / 2, glitched ? 0.08 : 0);   // hazards「外形扭曲、像故障了的医院」——整体轻微歪一点角度
  b.box(0, 0, 0, w, h, d, 'L11:concrete', { faces: 'sides', rotY: glitched ? -0.05 : 0 });
  b.plane(0, h, 0, w, d, 'L11:concrete', { facing: 'up' });
  kit.prop.sign(b, 0, -d / 2 - 0.05, 0, { y: 2, w: 0.6, h: 0.6, color: 0xff3030 });
  kit.prop.door(b, 0, -d / 2, 0, { style: 'metal', w: 1.6, h: 2.4, wall: false, solid: true });
  b.pop();
  kit.exit(b, { to: glitched ? '109' : '511', kind: 'zone', x: BL / 2, z: BL / 2 - d / 2 + 0.9, radius: 1.3, label: glitched ? '外形扭曲的「故障」医院' : '外观正常的医院，探索足够久（exits「概率低于109」，简化为直接开门）' });
}
function buildMall(b, rng) {
  // exits「特定商场通 Level 33/122/159」——原文说三家各自对应，本层用一栋商场并排三个入口代表
  const w = BL * 0.8, d = BL * 0.55, h = STORY * 1.6;
  const targets = ['33', '122', '159'];
  b.box(BL / 2, 0, BL / 2, w, h, d, 'L11:concrete', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, d, 'L11:concrete', { facing: 'up' });
  for (let k = 0; k < 3; k++) {
    const x = BL / 2 + (k - 1) * w * 0.28;
    kit.prop.door(b, x, BL / 2 - d / 2, 0, { style: 'metal', w: 1.4, h: 2.3, wall: false, sign: [0xffa030, 0x30c0ff, 0x60ff80][k] });
    kit.exit(b, { to: targets[k], kind: 'zone', x, z: BL / 2 - d / 2 + 0.8, radius: 1.1, label: '商场入口 → Level ' + targets[k] });
  }
  toastNear(b, BL / 2, BL / 2, 12, '一座商场——好几个入口，通向不同的地方');
}

// ---------- 郊区/施工/废弃 ----------
function buildSuburb(b, rng) {
  // landmarks「低密度区：后花园带泳池的别墅」→ exits「试图进入后院时切出到 Level 353」
  const w = 8, d = 7;
  const x0 = (BL - w) / 2, z0 = 2;
  b.box(x0 + w / 2, 0, z0, w, STORY * 1.3, d, 'L11:concrete', { faces: 'sides' });
  b.plane(x0 + w / 2, STORY * 1.3, z0, w + 0.6, d + 0.6, 'kit:prop', { facing: 'up', color: 0x7a4a34 });
  kit.prop.door(b, x0 + w / 2, z0 + d / 2, 0, { style: 'wood', w: 1.1, h: 2.1, wall: false, solid: true });
  const pz = z0 + d + 4;
  b.plane(x0 + w / 2, 0.02, pz, w * 0.7, 3.5, 'kit:water', { facing: 'up', solid: false });
  kit.exit(b, { to: '353', kind: 'zone', x: x0 + w / 2, z: pz, radius: 2.2, label: '后花园的泳池——试图进院子时触发' });
}
function buildConstruction(b, rng) {
  // other「道路施工、脚手架会凭空出现……配图称施工现场是模拟出来的布景」；hazards「工地有大量随机切出区到 Level 325」
  for (let k = 0; k < 4; k++) {
    const x = 6 + rng() * (BL - 12), z = 6 + rng() * (BL - 12);
    b.box(x, 0.4, z, 0.8, 0.8, 0.8, 'kit:prop', { color: 0xd08a2a });
  }
  b.box(BL * 0.3, 3, BL * 0.5, 4, 5.5, 4, 'kit:prop', { color: 0x8a8a8a, solid: false });   // 脚手架示意，不挡路
  kit.exit(b, { to: '325', kind: 'zone', x: BL / 2, z: BL / 2, radius: BL * 0.35, label: '施工现场——大量随机切出区' });
}
function buildAbandoned(b, rng, overgrown) {
  const w = BL * 0.65, d = BL * 0.55, h = STORY * (2 + Math.floor(rng() * 3));
  b.box(BL / 2, 0, BL / 2, w, h, d, 'L11:concrete', { faces: 'sides' });
  b.plane(BL / 2, h, BL / 2, w, d, 'L11:concrete', { facing: 'up' });
  kit.prop.window(b, BL / 2 - w * 0.2, BL / 2 - d / 2 + 0.01, 0, { blackout: true, w: 1.2, h: 1.3 });
  kit.prop.door(b, BL / 2, BL / 2 - d / 2, 0, { style: 'wood', w: 1.2, h: 2.2, wall: false, solid: true, open: 0.3 });
  if (overgrown) {
    for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2, r = w * 0.3 + rng() * 2;
      b.box(BL / 2 + Math.cos(a) * r, 0.6, BL / 2 + Math.sin(a) * r, 0.5, 1.2, 0.5, 'kit:prop', { color: 0x3a5a30 });
    }
  }
  kit.exit(b, {
    to: overgrown ? '990' : '713', kind: 'zone', x: BL / 2, z: BL / 2 - d / 2 + 0.8, radius: 1.2,
    label: overgrown ? '被植物覆盖的废弃建筑（取代713）' : '任何废弃建筑',
  });
}
function buildSandRoom(b, rng) {
  // items「铺满沙子的房间，找到或自己铺，在里面睡觉醒来就在 Level 48」——没有睡眠机制，简化为进入触发
  const w = 5, d = 5;
  b.box(BL / 2, 0, BL / 2, w, STORY, d, 'L11:concrete', { faces: 'sides' });
  b.plane(BL / 2, STORY, BL / 2, w, d, 'L11:concrete', { facing: 'up' });
  b.plane(BL / 2, 0.01, BL / 2, w - 0.6, d - 0.6, 'kit:prop', { facing: 'up', color: 0xd8c48a, solid: false });
  kit.prop.door(b, BL / 2, BL / 2 - d / 2, 0, { style: 'wood', w: 1.1, h: 2.1, wall: false, solid: true });
  // 出口摆在门口而不是房间正中心：房间是整块实体量体没有真正掏空，摆在中心会被墙挡住够不到（radius 够不到 d/2）
  kit.exit(b, { to: '48', kind: 'zone', x: BL / 2, z: BL / 2 - d / 2 + 0.8, radius: 1.4, label: '铺满沙子的房间——原文是躺下睡觉才触发，这里简化为进屋触发' });
}
function buildAlley(b, rng, neon) {
  // landmarks「布满霓虹灯和招牌、带东方工业风脏乱感的小巷」/「没有霓虹灯的脏乱小巷」——两栋楼夹出一条窄巷
  const gap = 3;
  const hw = (BL - gap) / 2;
  b.box(hw / 2, 0, BL / 2, hw, STORY * 4, BL, 'L11:concrete', { faces: 'sides' });
  b.box(BL - hw / 2, 0, BL / 2, hw, STORY * 4, BL, 'L11:concrete', { faces: 'sides' });
  for (let k = 0; k < 4; k++) {
    b.box(BL / 2, 0.3, 4 + k * (BL - 8) / 3, 0.5, 0.9, 0.5, 'kit:prop', { color: 0x3a3a3a });   // 垃圾桶/杂物
    if (neon) b.plane(hw + 0.02, 1.6 + k * 0.4, 4 + k * (BL - 8) / 3, 0.9, 0.35, 'kit:glow', { facing: '+x', uv: 'solid', color: [2, 0.4 + k * 0.3, 2 - k * 0.3], solid: false });
  }
  kit.exit(b, {
    to: neon ? '138' : '215', kind: 'zone', x: BL / 2, z: BL / 2, radius: BL * 0.4,
    label: neon ? '霓虹灯招牌林立的小巷' : '没有霓虹灯的脏乱小巷',
  });
}

// ---------- 人行道边小物件（不占用整块地皮，附加在普通建筑区块上） ----------
function addSidewalkOddities(b, rng) {
  const slots = [
    [SIZE / 2, ASPHALT + SIDEWALK / 2], [SIZE / 2, SIZE - ASPHALT - SIDEWALK / 2],
    [ASPHALT + SIDEWALK / 2, SIZE / 2], [SIZE - ASPHALT - SIDEWALK / 2, SIZE / 2],
  ];
  const rGrate = rng(), rPoster = rng(), rCabinet = rng(), rElevator = rng(), rCrack = rng();
  if (rGrate < 0.045) {
    // exits「从松动或敞开的下水道格栅掉下去到 Level 34 或 218」
    const [x, z] = slots[0]; const to = rng() < 0.5 ? '34' : '218';
    kit.prop.hole(b, x, z, 0, { r: 0.55, rimColor: 0x2c2c28 });
    kit.exit(b, { to, kind: 'zone', x, z, radius: 0.7, label: '松动的下水道格栅' });
  }
  if (rPoster < 0.04) {
    // items/exits「触摸征兵海报会被送到 Level 49」——立一块小告示牌代表贴在墙上的海报
    const [x, z] = slots[1];
    b.box(x, 1.1, z, 0.7, 1, 0.06, 'kit:prop', { color: 0x3a4a2c });
    kit.exit(b, { to: '49', kind: 'zone', x, z: z + 0.15, radius: 0.6, label: '征兵海报——碰一下就会被送走' });
  }
  if (rCabinet < 0.035) {
    // exits「与位置古怪的街机以任何方式互动到 Level 25」
    const [x, z] = slots[2];
    b.box(x, 0.6, z, 0.7, 1.2, 0.7, 'kit:prop', { color: 0x241c3a });
    kit.exit(b, { to: '25', kind: 'zone', x, z, radius: 0.7, label: '位置古怪的街机' });
  }
  if (rElevator < 0.02) {
    // hazards「出现在奇怪位置的电梯，按下按钮必去 Level 998，原文强烈不建议」
    const [x, z] = slots[3];
    kit.prop.elevator(b, x, z, 0, { w: 1.1, h: 2.1, indicator: 0xff3030, wall: false, solid: true });
    kit.exit(b, { to: '998', kind: 'zone', x, z: z + 0.85, radius: 1, label: '出现在街边的电梯——强烈不建议按下按钮' });
  }
  if (rCrack < 0.03) {
    // exits「穿过地面切出到 Level 178」
    const x = ASPHALT + SIDEWALK + rng() * (SIZE - 2 * (ASPHALT + SIDEWALK));
    const z = ASPHALT + SIDEWALK + rng() * (SIZE - 2 * (ASPHALT + SIDEWALK));
    kit.prop.hole(b, x, z, 0, { r: 0.5, irregular: true, rimColor: 0x38352c });
    kit.exit(b, { to: '178', kind: 'zone', x, z, radius: 0.65, label: '地面上的裂缝' });
  }
}

// ---------- 地块变体权重表 ----------
const LOT_TABLE = [
  ['plain', 58], ['park', 2.2], ['suburb', 2], ['construction', 1.4],
  ['factory_broken', 1.4], ['factory_running', 0.9], ['power_plant', 0.7],
  ['alley_neon', 1.1], ['alley_plain', 1.1], ['hospital_normal', 0.45], ['hospital_glitch', 0.75],
  ['mall', 0.35], ['subway', 1.1], ['bus', 1.1], ['airport', 0.12],
  ['abandoned', 1.4], ['abandoned_overgrown', 0.9], ['old_quarter', 1.8], ['shop', 7.5], ['sand_room', 0.25],
];
function buildLot(b, rng, cx, cz, ctx) {
  const kind = U.weighted(rng, LOT_TABLE);
  switch (kind) {
    case 'park': buildPark(b, rng); break;
    case 'suburb': buildSuburb(b, rng); break;
    case 'construction': buildConstruction(b, rng); break;
    case 'factory_broken': buildFactory(b, rng, true); break;
    case 'factory_running': buildFactory(b, rng, false); break;
    case 'power_plant': buildPowerPlant(b, rng); break;
    case 'alley_neon': buildAlley(b, rng, true); break;
    case 'alley_plain': buildAlley(b, rng, false); break;
    case 'hospital_normal': buildHospital(b, rng, false); break;
    case 'hospital_glitch': buildHospital(b, rng, true); break;
    case 'mall': buildMall(b, rng); break;
    case 'subway': buildSubway(b, rng); break;
    case 'bus': buildBusStop(b, rng); break;
    case 'airport': buildAirport(b, rng); break;
    case 'abandoned': buildAbandoned(b, rng, false); break;
    case 'abandoned_overgrown': buildAbandoned(b, rng, true); break;
    case 'old_quarter': buildOldQuarter(b, rng); break;
    case 'shop': buildShopLot(b, rng); break;
    case 'sand_room': buildSandRoom(b, rng); break;
    default: buildPlainLot(b, rng, cx, cz, ctx);
  }
}

// ---------- 固定坐标的据点/地标（唯一存在，不参与概率表） ----------
const FIXED = {
  '0,0': (b, rng) => buildSpawnPlaza(b, rng),
  '1,0': (b, rng) => buildFunZone(b, rng),
  '-1,0': (b, rng) => buildWindowBuilding(b, rng),
  '0,-1': (b, rng) => buildBaseBeta(b, rng),
  '2,0': (b, rng) => buildNewTimesSquare(b, rng),
  '-2,0': (b, rng) => buildThebes(b, rng),
  '0,2': (b, rng) => buildGpdTower(b, rng),
  '0,-2': (b, rng) => buildImbh(b, rng),
  '-3,0': (b, rng) => buildCapitalMarket(b, rng),
};

function scatterSpawns(b, rng) {
  // n=8：约1/3的高层建筑是填满整块地皮的黑色镜面实体，格点稀了容易被 finish() 的"离碰撞体<0.45m"过滤到
  // 不够第16节要求的每块≥20个，加密到 8x8 留足余量（人行道/车行道那一圈points 永远不会被建筑挡住）
  const n = 8, step = SIZE / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const jx = (rng() - 0.5) * (step - 1), jz = (rng() - 0.5) * (step - 1);
    b.spawn((i + 0.5) * step + jx, (j + 0.5) * step + jz, 'floor');
  }
}

function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: ROOM_H });
  buildStreets(b, rng);
  const key = cx + ',' + cz;
  const isCanalRow = ((cz % 7) + 7) % 7 === 4;
  // 通往首期范围内 Level 20 的 Fun Zone、通往 Level 12 的窗户楼：原先只在出生点东西各一个街区有一栋，无限城市里走远就再也找不到；
  // 现在每 6 个街区重复一栋（出生点旁那两栋仍走 FIXED），不和固定地标、运河行抢位置
  const m6 = v => ((v % 6) + 6) % 6;
  const periodicExit = (!FIXED[key] && !isCanalRow && m6(cz) === 0) ? (m6(cx) === 1 ? buildFunZone : m6(cx) === 5 ? buildWindowBuilding : null) : null;
  b.push(M, M, 0);
  if (FIXED[key]) FIXED[key](b, rng, cx, cz);
  else if (periodicExit) periodicExit(b, rng);
  else if (isCanalRow) buildCanalSegment(b, rng, cx, cz);
  else buildLot(b, rng, cx, cz, ctx);
  b.pop();
  if (!FIXED[key] && !isCanalRow) addSidewalkOddities(b, rng);
  scatterSpawns(b, rng);
  return b.finish();
}

// ---------- 层级环境：白天、开阔、克制的不安感 ----------
// survivalClass「Safety class 2：Safe / Unsecure / Low Entity Count」——三段渲染框都不算危险，只是「不设防」；
// lighting「配图 G.P.D. 大楼背景是蓝天薄云，街景照片均为白天」——不是暗层，不能把 ambient 调成近黑色（上批 L6 的教训）
const LEVEL_ENV = {
  background: 0x9fb0bd, fogColor: 0x9fb0bd, fogNear: 14, fogFar: FOG_FAR,
  ambient: { color: 0xe4edf3, intensity: 0.85 },
  sanityDrainMul: 0.6, hungerDrainMul: 1, audio: 'city', darkness: false,
};

const S = { toastT: 0 };
function enter(ctx) { S.toastT = 0; }
function update(ctx, dt) {
  // hazards 全篇都是「迷路/走错路」类风险，没有直接扣血的环境伤害（Safety class 2「Safe」也支持这个判断），
  // 所以本层 update 不做 attackPlayers 伤害结算，只留一次性的氛围提示
  S.toastT += dt;
  if (S.toastT > 3 && S.toastT < 3 + dt) {
    BR.hud.toast('外表安静的城市——背后据说一直有automated的产业链在运转', 2600);
  }
}
function leave() { BR.hud.prompt(null); }

BR.levels.register({
  id: '11', name: 'Level 11', title: 'The City That Never Sleeps', nickname: 'the city level / M.E.G. 编号 Level 11',
  version: 'wikidot-en',
  survivalClass: '2',   // survivalClass「Survival Difficulty 2：Safe / Unsecure / Low Entity Count」
  chunkSize: SIZE,
  env: LEVEL_ENV,
  spawn() { return { x: 22, y: 0, z: 22, yaw: 0 }; },
  buildChunk,

  // entities：entities[]「无面灵与猎犬 most numerous」并列，entityDensityOverall="low"（对应 survivalClass 的
  // Low Entity Count）；两者拆开各给一份 densityWords.low，幸运纸鹤「appear less often」给更低的 rare
  entities: [
    { type: 'hound', officialPer1000m2: BR.config.densityWords.low },
    { type: 'faceling', officialPer1000m2: BR.config.densityWords.low },
    { type: 'lucky_crane', officialPer1000m2: BR.config.densityWords.rare },
    // entities[]「Living Pizzas」只是页面用来说明"连通层专属实体可能流落到本层"的例子，本层没有原生实体、
    // entity-index.json 也没有把它登记进 levels 含 11 的清单，不据此虚构一个实体
  ],

  // items：almond_water/food_ration 是用户规则兜底；candy 是选中版本明确写本层有卖（B.N.T.G. 市场）；
  // 其余 item-spawn.json 里 levels 含 "11" 的条目也都带上（数值取该文件默认值，层级没有更具体的数字可以覆盖）
  items: [
    { type: 'almond_water', per1000m2: 1.2 },        // 用户规则：所有模式都刷
    { type: 'food_ration', per1000m2: 0.6 },         // 用户规则：所有模式都刷食物的兜底
    { type: 'candy', per1000m2: 0.3 },                // items「首都和 B.N.T.G. 市场有卖，5学分一磅」
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'royal_rations', per1000m2: 0.01 },
  ],

  exits: [
    { to: '12', kind: 'noclip', note: 'exits[0]：切进长得像窗户实体的窗户，原文称危险；出生点西侧一个街区起，每 6 个街区重复一栋' },
    { to: '63', kind: 'zone', note: 'exits[1]：绊倒摔进灌木丛（park 变体小概率附带）' },
    { to: '164', kind: 'zone', note: 'exits[2]：靠近体量很大的朴素建筑（高层「黑色镜面」建筑小概率附带）' },
    { to: '178', kind: 'hole', note: 'exits[3]：穿过地面切出（人行道随机裂缝）' },
    { to: '325', kind: 'zone', note: 'exits[4]：工地里的大量随机切出区（construction 变体）' },
    { to: '470', kind: 'door', note: 'exits[5]：在任何室内区域逗留会随机切出——原文没给具体触发条件，简化为未额外建实物，普通建筑内部即代表"室内区域"（见下方"没有实现的细节"）' },
    { to: '740', kind: 'door', note: 'exits[6]：在运转中的发电厂内切出，原文"经常发生"（power_plant 变体）' },
    { to: '33', kind: 'door', note: 'exits[7]：特定商场之一（mall 变体三门之一）' },
    { to: '122', kind: 'door', note: 'exits[7]：特定商场之一（mall 变体三门之一）' },
    { to: '159', kind: 'door', note: 'exits[7]：特定商场之一（mall 变体三门之一）；甜甜圈店的额外机制未做（见notes）' },
    { to: '67', kind: 'door', note: 'exits[8]：循着面包房的香味走（bakery_scented 商铺，简化为直接开门，没有做嗅觉/气味轨迹）' },
    { to: '68', kind: 'door', note: 'exits[9]：走进电影院，原文"有一定概率"，简化为进门必达（cinema 商铺）' },
    { to: '109', kind: 'door', note: 'exits[10]：外形扭曲、像"故障"了的医院（hospital_glitch 变体）' },
    { to: '511', kind: 'door', note: 'exits[11]：外观正常的医院探索足够久，概率低于109（hospital_normal 变体，权重更低）' },
    { to: '808', kind: 'door', note: 'exits[12]：进入街机厅建筑（arcade_building 商铺）' },
    { to: '115', kind: 'door', note: 'exits[13]：Base Beta 侧面标示的入口（固定据点）' },
    { to: '119', kind: 'door', note: 'exits[14]：进入供水店（water_store 商铺）' },
    { to: '126', kind: 'door', note: "exits[15]：Mr. Holloway's Grand Exhibit（exhibit_hall 商铺，横幅文字用发光牌代替）" },
    { to: '55', kind: 'door', note: 'exits[16]：Frivolous Frank\'s Fabulous Frozen Food超市，原文"很少见"（frozen_food_market 商铺，权重很低）' },
    { to: '179', kind: 'door', note: 'exits[17]：进入任何慈善店或二手店（thrift_store 商铺）' },
    { to: '20', kind: 'door', note: 'exits[18]："Fun Zone"建筑，原文"必定生效"；出生点东侧一个街区起，每 6 个街区重复一栋，首期范围内必须找得到' },
    { to: '232', kind: 'door', note: "exits[19]：Caspian's Antiques（antiques_shop 商铺）" },
    { to: '458', kind: 'door', note: "exits[20]：Papa Pedro's Pizza Palace of Pleasantries（pizza_palace 商铺）" },
    { to: '212', kind: 'door', note: 'exits[21]：任何机场，原文"罕见"（airport 变体，权重很低）' },
    { to: '213', kind: 'door', note: 'exits[22]：随机餐厅建筑（restaurant_random 商铺）' },
    { to: '214', kind: 'door', note: 'exits[23]：随机花店（flower_shop 商铺）' },
    { to: '304', kind: 'door', note: 'exits[24]：随机面包房（bakery 商铺）' },
    { to: '370', kind: 'door', note: 'exits[25]：酒吧（bar 商铺）' },
    { to: '900', kind: 'door', note: 'exits[26]：床垫店（mattress_store 商铺）' },
    { to: '247', kind: 'door', note: 'exits[27]：历史风格建筑上的任何现代门（modern_door_old 商铺）' },
    { to: '402', kind: 'door', note: 'exits[28]：几乎任何门，原文"小概率"——未单独实现，普通建筑的门数量巨大，逐个判定概率的开销和收益都不划算，见"没有实现的细节"' },
    { to: '603', kind: 'door', note: 'exits[29]：外观破败或没在生产的工厂，原文"通常如此"（factory_broken 变体）' },
    { to: '713', kind: 'door', note: 'exits[30]：任何废弃建筑（abandoned 变体）' },
    { to: '990', kind: 'door', note: 'exits[31]：被植物覆盖的废弃建筑，取代713（abandoned_overgrown 变体）' },
    { to: '901', kind: 'door', note: 'exits[32]：在完好工厂里穿过机器切出（factory_running 变体，简化为进门直达）' },
    { to: '138', kind: 'zone', note: 'exits[33]：布满霓虹灯招牌的小巷（alley_neon 变体）' },
    { to: '215', kind: 'zone', note: 'exits[34]：没有霓虹灯的脏乱小巷（alley_plain 变体）' },
    { to: '141', kind: 'door', note: 'exits[35]：内部有旧锅炉的建筑，探索足够久（boiler_building 商铺，简化为进门直达）' },
    { to: '147', kind: 'zone', note: 'exits[36]：乘坐本层某些巴士（bus 变体）' },
    { to: '158', kind: 'stairs', note: 'exits[37]：乘坐地铁或地上铁路的列车（subway 变体）' },
    { to: '25', kind: 'zone', note: 'exits[38]：与位置古怪的街机互动（人行道随机小概率摆放）' },
    { to: '48', kind: 'zone', note: 'exits[39]：铺满沙子的房间，原文是睡觉触发，简化为进屋触发（sand_room 变体）' },
    { to: '49', kind: 'zone', note: 'exits[40]：触摸征兵海报（人行道随机小概率摆放）' },
    { to: '34', kind: 'hole', note: 'exits[41]：松动或敞开的下水道格栅之一（人行道随机小概率，34/218 各半概率）' },
    { to: '218', kind: 'hole', note: 'exits[41]：松动或敞开的下水道格栅之一（同上）' },
    { to: '353', kind: 'zone', note: 'exits[42]：低密度区后花园泳池别墅，试图进院子触发（suburb 变体）' },
    { to: '998', kind: 'elevator', note: 'exits[43]：出现在奇怪位置的电梯，原文"必定生效，强烈不建议"（人行道随机小概率摆放）' },
    // 未建实物：Level 201（磁带在本层能买到，但触发进入发生在Level 201自己那边，原文写明"本层不直接使用该入口"）、
    // Level 222（宣传册产自本层，用于跨层交易，页面没说明它如何触发进入11以外的地方），两者都不是"从11出去"的物理出口
  ],
  enter, update, leave,
});
})();

// ==================== 没有实现的细节 ====================
// 1) exits「在任何室内区域逗留会随机切出到 Level 470」：原文没给具体的"多久"或"哪类室内"，本层建筑数量巨大，
//    要给每一栋建的每个房间单独挂一个计时器代价很高、收益很低（反正 470 在首期范围外，玩家只会看到"尚未开放"），
//    简化为不单独建实物，只在上面的返回值里注明；如果之后需要更精确，可以在"普通建筑"里挂一个全局计时器 zone。
// 2) exits「几乎任何门都有小概率通到 Level 402」：同样因为普通建筑的门数量巨大，没有做逐门概率判定。
// 3) exits「Level 33/122/159 各自的商场入口双向对应」+「Level 159 的甜甜圈店双向」：本层只做了单向的"进入通往"，
//    没有做"从对应层级回来会精确落在这一栋"的双向绑定（那需要跨层协调落点，超出层级文件自己的职责范围）。
// 4) mechanics「无人观察时切出：车辆挪位、广告牌更换、施工现场出现/消失」：引擎没有暴露"这一点当前是否在玩家
//    视野/加载范围内"的查询接口，本层的停靠车辆、施工现场都做成静止装饰，不会真的在离开视野后改变，见 apiRequests。
// 5) mechanics「建筑演化：外观比周围新/旧能反推出是否有人长期定居」：只用一个可反复出现的 old_quarter 区块变体
//    表现"少数区域更老"，没有做"越多人定居的区域外观越旧"这种双向反馈（本层没有玩家可以"定居"的系统）。
// 6) hazards「实体：第11效应能降低敌对实体攻击意愿，挑衅会失效，猎犬近看有生命危险」：第11效应属于实体自身的
//    行为规则（是否攻击玩家），按分工应该在 js/entities/hound.js、faceling.js 里实现，层级文件只列密度，不重复实现。
// 7) other「近7000年人类居住史」「近百个出口的封街路障」「以失踪者命名的纪念物/安全路线」：纯氛围性的历史背景，
//    没有可交互的机制，选中版本原文也没具体给出位置或数值，没有对应的实物或系统可做，不据此编造。
// 8) items「Level 201入口磁带」「Level 222宣传册」「B.N.T.G. presses塑料币」「A Different Kind of Urban 新居民
//    指南」：都没有对应的 js/items 文件，且都偏向"交易道具"（用户规则：交易系统等游戏大厅上线后再做），未加入物品表。
// 9) bases「U.B.D.S.总部」「Eternal Repository Database Centre」「Camp Amber」「New New Amsterdam」：受篇幅限制
//    只给最重要的几个据点（Base Beta、新时代广场、底比斯、G.P.D.、I.M.B.H.、首都）做了专属造型；Eternal Repository
//    原文明说"位置刻意保密"，不适合摆出实物；Camp Amber 用 Base Beta 旁的一段天桥代表方向，New New Amsterdam 的
//    视觉特征（鹅卵石+砖商铺+电车轨）折进可反复出现的 old_quarter 变体里，不单独占一个固定坐标。
