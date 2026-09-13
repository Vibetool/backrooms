// Level 15 "未来走廊"（Future Corridors）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-15  许可：CC BY-SA 3.0
// 原作者：由 Ross Dear 重写（原作者 Reddit 用户 u/Hugorrr、u/incomplete-sentanc、KingSheep17），OSKlalala 翻译；
// 进出信息截至 2021-12-14（页面标注）；抓取：2026-09-13
// 只按选中的 wikidot-cn 版本实现，conflicts 里列出的 wikidot-en / fandom 细节一律不做（尤其：fandom 版没有尸体/Enric/据点/
// I.L.N. 通讯，且有隔离效应——本层完全不做隔离，因为选中版本没有这条）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
const SIZE = 24, N = 8, CELL = SIZE / N;   // 区块 24 m、8×8 格，3 m 一格；原文只说「走廊+房间串联、理论无限」没给具体尺度数字
const H = BR.kit.DEFAULT_HEIGHT || 2.8;    // 层高原文未给出，用 kit 默认值

// ---------- 布局 ----------
// 边界参数全层所有区块必须完全一样（_TEMPLATE 第 7.2 节），特殊区块只改内部
const EDGE = { salt: 'L15', boundaryDensity: 0.4, straightness: 0.65, minOpenings: 2 };
const GRID = Object.assign({ wallDensity: 0.38, roomChance: 0.42, maxRooms: 2, roomSize: [2, 4], loopChance: 0.5, pillarChance: 0.04 }, EDGE);
const SPAWN_I = 3, SPAWN_J = 3;

// 每个小房间抽一种类型（architecture「房间类型：引擎室、实验室、宿舍、厨房、控制室、储藏室」+「没有照明的漆黑房间」；
// 「控制室」单独作为稀有地标处理，这里的权重列表不含它，避免和 Enric 基地重复）
const ROOM_TYPES = [['lab', 0.17], ['dorm', 0.15], ['kitchen', 0.13], ['storage', 0.17], ['engine', 0.16], ['dark', 0.12], ['plain', 0.10]];

// 稀有地标：按宏格抽取，间隔拉大到「一片区域只出现一次」的量级（第③条：原文「距基地约两公里」这种真实尺度在区块化世界里
// 不现实，这里近似成「宏格罕见出现」，量级取几百米级而不是逐块出现）
const MACRO = 6;                                                                    // 宏格边长（区块数）≈144 m
// 传送门（唯一出口）从这张表里摘出去，改成 pickPortal 里独立必然刷新，见下方注释；
// 其余四种地标权重原样保留比例，'none' 补足到 1（原表 0.28+0.18+0.14+0.10+0.26=0.96，去掉 portal 的 0.04 后原样即可）
const RARE_TABLE = [['control', 0.28], ['theater', 0.18], ['cremation', 0.14], ['broken', 0.10], ['none', 0.30]];

// ---------- 材质 ----------
function defineMaterials() {
  // materials「房间与走廊为白色或灰色混凝土」：墙/地/顶都用现有 concrete 贴图，靠颜色叠色压到白/灰区间，不新开贴图
  kit.mat('L15:wall', { tex: 'concrete', repeatMeters: 2.6, color: 0xdad7cd, roughness: 0.85 });
  kit.mat('L15:floor', { tex: 'concrete', repeatMeters: 2.2, color: 0xc4c1b6, roughness: 0.9 });
  kit.mat('L15:ceil', { tex: 'concrete', repeatMeters: 3.0, color: 0xf0efe9, roughness: 0.9 });
  // materials「白色钢管，部分钢管上有看起来像蔓藤花纹的符号」：花纹烧进贴图，世界 UV 平铺后自然只在部分管段露出
  kit.mat('L15:pipe', { tex: 'l15_pipe_glyph', repeatMeters: 1.4, roughness: 0.45 });
  // 验收②：焚化室原来是纯色方块地面痕迹，改成镂空贴图的不规则烧痕（做法同 L10 麦穗/L16 树叶：canvas + alphaTest 镂空）
  kit.mat('L15:scorch', { type: 'lambert', map: scorchTexture(), alphaTest: 0.3, color: 0xffffff });
}

// 焚化室地面的不规则烧痕：若干柔边深褐色圆斑叠加，背景透明，配合 alphaTest 镂空（固定种子，贴图本身不必每关不同）
let scorchTex = null;
function scorchTexture() {
  if (scorchTex) return scorchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = U.rng('l15_scorch');
  for (let k = 0; k < 10; k++) {
    const cx = 128 + (r() - 0.5) * 150, cy = 128 + (r() - 0.5) * 150, rad = 38 + r() * 66;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, 'rgba(14,10,7,0.88)');
    grad.addColorStop(0.55, 'rgba(22,16,12,0.5)');
    grad.addColorStop(1, 'rgba(22,16,12,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
  scorchTex = new THREE.CanvasTexture(c);
  return scorchTex;
}

// file:// 双击打开时贴图读不了盘，注册一个简单的程序化兜底（_TEMPLATE 第 15 节步骤 7）
BR.assets.registerProcedural('l15_pipe_glyph', 256, (g, s) => {
  g.fillStyle = '#e1e0da'; g.fillRect(0, 0, s, s);
  const r = U.rng('l15_pipe_glyph');
  g.strokeStyle = 'rgba(150,148,140,0.35)'; g.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    let x = r() * s, y = (k + 0.5) * s / 3;
    g.moveTo(x, y);
    for (let t = 0; t < 6; t++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 16; g.lineTo(x, y); }
    g.stroke();
  }
});

// ---------- 房间几何 ----------
function roomBounds(g, room) {
  const x0 = room.i * g.cellW, z0 = room.j * g.cellD;
  const x1 = x0 + room.w * g.cellW, z1 = z0 + room.d * g.cellD;
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

// 靠近某点时提示一次（做法照抄 L11.js 的 toastNear 闭包写法）
function toastNear(b, x, z, r, text, ms) {
  let done = false;
  b.update((dt, t) => {
    if (done) return;
    const w = b.world(x, z);
    const dx = BR.player.x - w.x, dz = BR.player.z - w.z;
    if (dx * dx + dz * dz < r * r) { done = true; BR.hud.toast(text, ms || 2600); }
  });
}

// ---------- 常规小房间装饰（每种走「有代表性的几件家具」，不追求塞满） ----------
function decorLab(b, bnd) {
  kit.prop.desk(b, bnd.cx - 1.2, bnd.cz - 1.0, 0, { monitor: true, screen: 0x2be8a0 });
  kit.prop.chair(b, bnd.cx - 1.2, bnd.cz - 0.05, Math.PI, {});
  kit.prop.cabinet(b, bnd.cx + 1.3, bnd.cz - 1.0, -Math.PI / 2, { kind: 'file' });
}
function decorDorm(b, bnd) {
  kit.prop.bed(b, bnd.cx - 0.7, bnd.cz - 0.5, 0, {});
  kit.prop.cabinet(b, bnd.cx + 1.2, bnd.cz + 0.8, Math.PI, { kind: 'wardrobe' });
}
function decorKitchen(b, bnd) {
  kit.prop.cabinet(b, bnd.cx - 1.2, bnd.cz - 1.0, Math.PI / 2, { kind: 'locker' });
  kit.prop.crate(b, bnd.cx + 0.6, bnd.cz - 0.7, 0.2, {});
  kit.prop.box(b, bnd.cx + 1.1, bnd.cz + 0.6, 0, { stack: 2 });
}
function decorStorage(b, bnd) {
  // 储藏室囤了很多食物（landmarks「包含很多食物的储藏室」）
  for (let k = 0; k < 5; k++) {
    const a = k * 1.31, r = 0.55 + (k % 2) * 0.45;
    kit.prop.box(b, bnd.cx + Math.cos(a) * r, bnd.cz + Math.sin(a) * r, a, { stack: 1 + (k % 3) });
  }
}
function decorPlain(b, bnd, rng) {
  if (rng() < 0.5) kit.prop.crate(b, bnd.cx + (rng() - 0.5) * 1.4, bnd.cz + (rng() - 0.5) * 1.4, rng() * Math.PI, {});
}

// 机器主体：低多边形近似，部分在运作、大部分空转（other「有些有明确任务（如生产钢棒），绝大部分没有任务」）
// 验收⑤：原来半径 0.55 只离外墙 0.3m，一半探进墙里；这版整体放大一档、并由调用方放到隔断后方留够净空
function buildEngineMachine(b, x, z, rng) {
  b.cylinder(x, 0, z, 0.75, 1.7, 'kit:prop', { segments: 10, color: 0x6c6a63 });
  b.cylinder(x, 1.7, z, 0.48, 0.3, 'kit:prop', { segments: 10, rTop: 0.28, color: 0x4b4a45 });
  kit.prop.pipe(b, x + 0.82, z, 0, { axis: 'y', length: 1.4, r: 0.06, color: 0xd8d8d2 });
  kit.prop.pipe(b, x - 0.82, z, 0, { axis: 'y', length: 1.4, r: 0.06, color: 0xd8d8d2 });
  const rWork = rng();   // 先无条件取：是否属于「有明确任务」的少数机器
  b.light({ x, y: 1.9, z, color: rWork < 0.6 ? 0xbfe6ff : 0xff8a50, intensity: 0.65, range: 5.5, flicker: rWork < 0.6 ? 0.1 : 0.5 });
}
// 一整段隔断墙上镂空两个矩形洞（门 + 玻璃），保证隔断连续不断裂——
// 验收⑤：原实现是门墙、窗墙各建各的、中间留了 0.4m 空隙，机器从缝里露出来
function wallOpenings(b, x0, x1, wallH, t, matKey, openings) {
  let cursor = x0;
  for (const op of openings) {
    if (op.x0 - cursor > 0.001) b.aabb(cursor, 0, -t / 2, op.x0, wallH, t / 2, matKey, { faces: 'sides', solid: true });
    if (op.y0 > 0.001) b.aabb(op.x0, 0, -t / 2, op.x1, op.y0, t / 2, matKey, { faces: 'noBottom', solid: true });
    if (wallH - op.y1 > 0.001) b.aabb(op.x0, op.y1, -t / 2, op.x1, wallH, t / 2, matKey, { faces: 'noTop', solid: true });
    cursor = op.x1;
  }
  if (x1 - cursor > 0.001) b.aabb(cursor, 0, -t / 2, x1, wallH, t / 2, matKey, { faces: 'sides', solid: true });
}
function decorEngine(b, bnd, rng) {
  // 大型机器房间一角用金属加固门 + 厚玻璃墙隔出一整段连续隔断（materials「机房为金属加固门」「机房玻璃墙…
  // 可能是夹层玻璃」；「看起来碎了」的裂纹细节太细，这版仍只做完好的厚玻璃，不做裂纹贴图，详见返回值说明）
  const wallZ = bnd.z0 + 1.0, half = bnd.w / 2 - 0.25;
  const doorW = 0.9, jw = 0.08, doorHalf = doorW / 2 + jw + 0.05;             // +0.05 余量，避免刚好卡住门框
  const glassW = Math.max(1.6, half * 2 - doorW - 1.0), glassH = b.height - 0.6, glassY = glassH / 2 + 0.3;
  const glassFt = 0.06 + 0.05;
  const doorX = -half + doorHalf, glassX = doorX + doorHalf + 0.15 + glassW / 2;
  b.push(bnd.cx, wallZ, 0);
  wallOpenings(b, -half, half, b.height, 0.2, 'L15:wall', [
    { x0: doorX - doorHalf, x1: doorX + doorHalf, y0: 0, y1: 2.05 + jw + 0.05 },
    { x0: glassX - glassW / 2 - glassFt, x1: glassX + glassW / 2 + glassFt, y0: glassY - glassH / 2 - glassFt, y1: glassY + glassH / 2 + glassFt },
  ]);
  kit.prop.door(b, doorX, 0, 0, { style: 'metal' });                                                    // 墙已建好，这里只放门扇+门框
  kit.prop.window(b, glassX, 0, 0, { w: glassW, h: glassH, y: glassY, mullions: false, tint: 0x89a49c }); // 无棂大玻璃，近似「厚玻璃墙」
  b.pop();
  // 机器挪到隔断后方房间纵深的中点，离隔断和后墙都留够（半径 0.75 + 半墙厚）以上的净空，不再探进墙体
  buildEngineMachine(b, bnd.cx, wallZ + Math.max(1.6, (bnd.z1 - wallZ) * 0.55), rng);
}

// ---------- 稀有地标（宏格抽取，见 RARE_TABLE） ----------
function buildControlRoom(b, bnd) {
  // 大型控制室：Enric 进入后的落脚处与基地；也代表其他被遗弃者留下的据点痕迹（landmarks/bases）
  kit.prop.desk(b, bnd.cx - 2.2, bnd.cz - 2, 0, { monitor: true, screen: 0x2be8a0 });   // 屏幕常显扫描仪式图像，见 mechanics
  kit.prop.chair(b, bnd.cx - 2.2, bnd.cz - 0.9, Math.PI, {});
  kit.prop.bed(b, bnd.cx + 2, bnd.cz - 2.2, Math.PI / 2, {});
  kit.prop.crate(b, bnd.cx + 1.1, bnd.cz + 1.4, 0.2, {});
  kit.prop.crate(b, bnd.cx + 2.0, bnd.cz + 1.8, -0.3, {});
  kit.prop.cabinet(b, bnd.cx - 0.4, bnd.cz + 2.1, 0, { kind: 'locker' });
  kit.prop.box(b, bnd.cx + 2.6, bnd.cz + 0.9, 0.1, { stack: 2 });
  // landmarks「大型控制室」、bases「Enric 的基地」
  toastNear(b, bnd.cx, bnd.cz, 3.2, '一张床垫、几箱物资，电脑还亮着——这里显然有人长期驻扎过', 3000);
}
// 猎犬尸堆：借用 js/entities/hound.js 里「猎犬」（Entity-8，本层唯一提到的实体，只以尸体形式出现）的四足骨架参数，
// 改成烧黑配色、关掉发光眼，整只翻倒摆几只——验收②：原来是 7 个同色方块堆在纯色方块地面上，认不出是猎犬
function buildHoundCorpseModel() {
  return BR.arch.parts.quadruped({
    length: 1.0, height: 0.5, thin: 0.8, jaw: true, snout: 0.14, mane: 0.12, eyes: null,
    colors: { body: 0x231a14, fur: 0x0d0b09 },   // 烧黑的躯干 + 本来就近黑的鬃毛，呼应"焚烧未知物体的房间"
  });
}
function buildCremationRoom(b, bnd, rng) {
  // 被用来火化未知物体的房间：内有一大堆猎犬尸体（entities[0].behavior「本层没有活体，仅有尸体…一大堆猎犬的尸体」）
  // 地面烧痕换成镂空贴图（见 defineMaterials 的 L15:scorch），不再是纯色方块
  b.plane(bnd.cx, 0.012, bnd.cz, 4.6, 4.6, 'L15:scorch', { facing: 'up', uv: 'stretch', solid: false });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng() * 0.4, r = 0.55 + (k % 2) * 0.4;
    const x = bnd.cx + Math.cos(a) * r, z = bnd.cz + Math.sin(a) * r;
    const model = buildHoundCorpseModel();
    const tip = (rng() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rng() - 0.5) * 0.6);   // 侧躺/翻扣，quadruped 没有现成倒地骨骼姿势，靠整体旋转近似
    model.rotation.z = tip;
    model.position.set(0, 0.16, 0);
    b.push(x, z, a);
    b.object(model, { solid: false });
    b.pop();
  }
  kit.prop.puddle(b, bnd.cx + 0.4, bnd.cz - 0.6, 0, { rx: 0.9, rz: 0.6, color: 0x2c0d0d });
  // landmarks：焚烧未知物体的房间
  toastNear(b, bnd.cx, bnd.cz, 3.2, '墙角一堆烧过的痕迹里全是猎犬的尸骸——这里曾被用来焚烧不知名的东西', 3000);
}
function buildTheaterRoom(b, bnd) {
  // 像剧场一样、有很多设施的房间：几排座椅面朝一块发光屏幕（landmarks）
  for (let row = 0; row < 3; row++) {
    for (let seat = 0; seat < 5; seat++) {
      kit.prop.chair(b, bnd.cx - 4 + seat * 2, bnd.z0 + 2.2 + row * 1.6, Math.PI, {});
    }
  }
  kit.prop.window(b, bnd.cx, bnd.z0 + 0.5, Math.PI, { w: 3.4, h: 2, y: 0.2, glow: 0x9fd6ff, wall: { matKey: 'L15:wall', w: 4, h: 2.4 } });
  // landmarks：像剧场一样、有很多设施的房间
  toastNear(b, bnd.cx, bnd.cz, 3.2, '一排排座椅对着前方的屏幕，这里看上去很像剧场——没人知道它本该用来做什么', 3000);
}
function buildBrokenMachineRoom(b, bnd, rng) {
  // 存放损坏机器的房间：原文特别强调「极少见」（landmarks），外壳凹陷、偶发电火花，理论上长期没人维护但修不好
  for (let k = 0; k < 4; k++) {
    const x = bnd.cx + (k - 1.5) * 2.2, z = bnd.cz + (k % 2 === 0 ? -1 : 1) * 1.2;
    b.box(x, 0, z, 1.1, 1.3, 1.1, 'kit:prop', { color: 0x55524c });
    b.box(x + 0.3, 0.9, z + 0.2, 0.5, 0.3, 0.5, 'kit:prop', { color: 0x2a2824, rotY: 0.3 });   // 凹陷烧黑的顶盖
    b.light({ x, y: 1.1, z, color: 0xff8850, intensity: 0.5, range: 4, flicker: 0.9 });          // 偶发电火花：高 flicker 模拟不稳定放电
  }
  // landmarks：存放损坏机器的房间（极少见）
  toastNear(b, bnd.cx, bnd.cz, 3.5, '这几台机器再也修不好了——外壳凹陷、内部烧黑，没人知道它们本该做什么', 3000);
}
function buildPortalRoom(b, bnd, rng) {
  // 无引擎的机房：外观与引擎室相同但里面没有任何引擎，后部一个门框散发白色光线，
  // 里面像夜空、中心一颗透亮的蓝色光球（landmarks）。这条是原文标注的「理论出口，未验证」，游戏里按 sealed 处理
  kit.prop.door(b, bnd.cx - 1.6, bnd.z0 + 1.0, 0, { style: 'metal', wall: { matKey: 'L15:wall', w: 2.2, h: b.height } });
  kit.prop.window(b, bnd.cx + 1.0, bnd.z0 + 1.0, 0, { w: 1.3, h: 1.5, y: 0.5, wall: { matKey: 'L15:wall', w: 1.8, h: b.height } });
  const frameZ = bnd.z1 - 1.2;
  kit.prop.wallWithOpening(b, bnd.cx, frameZ, 0, { w: 3.4, h: b.height, openW: 1.7, openY0: 0, openY1: 2.3, matKey: 'L15:wall' });
  b.light({ x: bnd.cx, y: 1.4, z: frameZ + 0.3, color: 0xeaf6ff, intensity: 1.2, range: 6 });
  b.plane(bnd.cx, 0, frameZ + 0.12, 1.7, 2.3, 'kit:glow', { facing: '-z', uv: 'solid', color: [0.03, 0.04, 0.07] });
  const stars = [[-0.5, 1.6], [0.3, 1.9], [-0.2, 0.9], [0.55, 0.6], [-0.6, 0.4], [0.1, 2.05]];
  for (const [dx, dy] of stars) b.box(bnd.cx + dx, dy, frameZ + 0.14, 0.03, 0.03, 0.02, 'kit:glow', { uv: 'solid', color: [2, 2, 2.2] });
  const orb = new THREE.SphereGeometry(0.35, 8, 6);
  b.mesh(orb, 'kit:glow', { x: bnd.cx, y: 1.15, z: frameZ + 0.22, uv: 'solid', color: [0.5, 1.7, 2.6] });
  orb.dispose();
  // landmarks：无引擎的机房，门框对面像夜空
  toastNear(b, bnd.cx, frameZ - 1.0, 3.2, '门框对面像是夜空——中央一颗透亮的蓝色光球，安静得让人不安', 3000);
  // hazards：Enric 被要求离开该区域，原文没写原因，这里不替它编一个
  toastNear(b, bnd.cx, frameZ - 0.5, 1.7, '有种说不清的直觉在催你离这片区域远一点', 2600);
  kit.exit(b, {
    to: 'Unknown', kind: 'zone', x: bnd.cx, z: frameZ - 0.4, radius: 1.0,
    marker: { color: [0.4, 1.4, 2.2], pulse: true },
    label: '门框对面——未知区域',
    // 验收④：自定义 sealedText 会整句覆盖 kit 默认的"尚未开放"提示，之前这句里完全没有这四个字，
    // 违反用户规则"超出首期范围的出口要提示尚未开放"；这里把提示词补进这句自定义文案里
    sealedText: '通向未知区域的门框——从未有人验证能否通行，尚未开放',
  });
}
function buildRareLandmark(b, g, kind, rng) {
  // 注意：g.carve 只清墙、标记 room 网格，并不会把这块地方追加进 g.rooms（那是迷宫算法自动掏出的房间列表）；
  // 所以这里手写 room 描述符传给 roomBounds，不能像 244 行那样从 g.rooms 里找
  const room = { i: 1, j: 1, w: 6, d: 6 };
  g.carve(room.i, room.j, room.w, room.d, { room: true });
  const bnd = roomBounds(g, room);
  if (kind === 'control') buildControlRoom(b, bnd);
  else if (kind === 'cremation') buildCremationRoom(b, bnd, rng);
  else if (kind === 'theater') buildTheaterRoom(b, bnd);
  else if (kind === 'broken') buildBrokenMachineRoom(b, bnd, rng);
  else if (kind === 'portal') buildPortalRoom(b, bnd, rng);
}

// 宏格判定：与区块 rng 完全独立的派生流，不占用、不打乱本区块自己的随机顺序（_TEMPLATE 第 4.2 节）
function pickRare(ctx, cx, cz) {
  const mx = Math.floor(cx / MACRO), mz = Math.floor(cz / MACRO);
  const mr = U.rng(ctx.levelSeed, 'L15-rare', mx, mz);
  const kind = U.weighted(mr, RARE_TABLE);
  if (kind === 'none') return null;
  const li = Math.floor(mr() * MACRO), lj = Math.floor(mr() * MACRO);
  const tx = mx * MACRO + li, tz = mz * MACRO + lj;
  if (tx === 0 && tz === 0) return null;      // 出生块不放稀有地标
  if (tx !== cx || tz !== cz) return null;    // 这块不是宏格里被选中的那一块
  return kind;
}

// 验收③：唯一出口原来挂在 RARE_TABLE 里、4%/宏格才抽到，最近一次实测要 20 个区块开外，等于找不到（违反规则②
// 「出口要能在合理范围内找到」）。原文「距 Enric 基地差不多两公里」这种真实尺度在区块世界里没法照搬（同③号规则），
// 这里改成独立于其他地标、每个宏格必定出现一次（约 144 m 见方内一定有），在「找得到」和「保留稀有感」之间取近似；
// 该门框本身仍是 sealed（见 buildPortalRoom），这条只解决「连它都找不到」的问题，不代表关卡因此有了能走通的出口——
// 这层是否需要一个能真正带玩家离开的兜底方案，属于跨层级的产品决策，已写进返回的 apiRequests
function pickPortal(ctx, cx, cz) {
  const mx = Math.floor(cx / MACRO), mz = Math.floor(cz / MACRO);
  if (mx === 0 && mz === 0) return false;     // 出生宏格不放传送门，跟其他稀有地标处理一致
  const mr = U.rng(ctx.levelSeed, 'L15-portal', mx, mz);   // 独立派生流，salt 与 L15-rare 不同，互不干扰
  const li = Math.floor(mr() * MACRO), lj = Math.floor(mr() * MACRO);
  return mx * MACRO + li === cx && mz * MACRO + lj === cz;
}

// ---------- 尸体与血迹：全层散落，衣着为实验室制服（environment.other） ----------
// 验收①：原来只是 3 个纯色方块、看不出人形；这版改用 BR.arch 的人形骨架（同一套构件，entities 已在用），
// 站姿骨架整体绕 X 转 90° 放倒在地，hunch 弯一点肢体避免像立正的人偶那样僵直
function buildCorpseModel(rng) {
  const model = BR.arch.parts.humanoid({
    height: 1.6 + rng() * 0.25, thin: 0.2, hunch: 0.25 + rng() * 0.2, head: 'round',
    clothes: { collar: true, cuffs: true },                 // 实验室制服的领口/袖口轮廓（clothes 开关见 _TEMPLATE 6.9）
    colors: { body: 0xd9d3bd, head: 0xc7a483 },              // 米白制服 + 皮肤色头部，跟白灰墙地拉开一点区分
  });
  BR.arch.anim.pose(model.userData.rig);   // 把 hunch 从骨骼"基准姿势"烘焙进当前变换：这是静态尸体，不会再逐帧更新
  return model;
}
// 简易刀/矛（items「有些尸体旁有刀或长矛」，原文没给具体形状）：木柄+金属刃/尖两截拼、颜色区分，别再是同色方块
function buildKnife(b, x, z) {
  b.cylinder(x, 0.02, z, 0.013, 0.1, 'kit:prop', { axis: 'z', segments: 6, color: 0x6b4a2c });        // 木柄
  b.box(x, 0.02, z - 0.13, 0.03, 0.008, 0.16, 'kit:prop', { color: 0xb9c0c4 });                        // 扁平刀刃
}
function buildSpear(b, x, z) {
  b.cylinder(x, 0.02, z, 0.016, 1.1, 'kit:prop', { axis: 'z', segments: 6, color: 0x6b4a2c });        // 长木柄
  b.cylinder(x, 0.02, z - 0.66, 0.032, 0.22, 'kit:prop', { axis: 'z', segments: 5, rTop: 0, color: 0x9aa0a6 });   // 锥形矛尖
}
function buildCorpse(b, x, z, rot, rWeapon, rng) {
  const model = buildCorpseModel(rng);
  model.rotation.x = -Math.PI / 2;      // 站立骨架放倒：局部 -Z 方向变成"头顶方向"，双脚留在推入点上
  model.position.set(0, 0.16, 0);       // 抬离地面一点，避开躯干厚度部分穿模
  b.push(x, z, rot);
  b.object(model, { solid: false });    // 不参与碰撞，避免整具人形骨架的粗略包围盒挡住狭窄走廊
  // 有些尸体旁有刀或长矛（items）：knife/spear 没有对应的可拾取物品文件，这里只做场景装饰，不进 items 表
  if (rWeapon < 0.22) buildKnife(b, 0.4, -0.85);
  else if (rWeapon < 0.4) buildSpear(b, 0.42, -0.9);
  b.pop();
  kit.prop.puddle(b, x + 0.5, z + 0.2, 0, { rx: 0.5, rz: 0.35, color: 0x3d1210 });   // 唯一不同于白/灰配色的干涸血液（colors）
}

// ---------- 区块 ----------
// 随机数消耗顺序固定：grid → (出生房间 | 稀有地标 | 普通房间类型) → 灯 → 墙面/地面灯 → 尸体 → 蔓藤纹管道。
// 全程只用传进来的 rng；isPortalChunk/pickRare 是独立派生流，不占用这条顺序（_TEMPLATE 4.2 节）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;
  const isPortalChunk = !isSpawn && pickPortal(ctx, cx, cz);      // 见 pickPortal 注释：验收③要求的"保证每宏格一个"
  const rare = isSpawn || isPortalChunk ? null : pickRare(ctx, cx, cz);

  const g = kit.grid(b, N, N, GRID);
  const darkRooms = [];

  if (isSpawn) {
    g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true });
    // 四面各开一个门，出生房间不能是封死的盒子（carve 只清内部，不会自动打通外圈）
    g.setWall('v', SPAWN_I, SPAWN_J, false);
    g.setWall('v', SPAWN_I + 2, SPAWN_J, false);
    g.setWall('h', SPAWN_I, SPAWN_J, false);
    g.setWall('h', SPAWN_I, SPAWN_J + 2, false);
    g.reserve(SPAWN_I, SPAWN_J);
  } else if (isPortalChunk) {
    buildRareLandmark(b, g, 'portal', rng);   // 传送门优先于其他稀有地标，保证宏格判定选中的这一块一定建出来
  } else if (rare) {
    buildRareLandmark(b, g, rare, rng);
  } else {
    for (const room of g.rooms) {
      const kind = U.weighted(rng, ROOM_TYPES);   // 依据：architecture「房间类型：引擎室、实验室、宿舍、厨房、控制室、储藏室」+「漆黑房间」
      const bnd = roomBounds(g, room);
      if (kind === 'lab') decorLab(b, bnd);
      else if (kind === 'dorm') decorDorm(b, bnd);
      else if (kind === 'kitchen') decorKitchen(b, bnd);
      else if (kind === 'storage') decorStorage(b, bnd);
      else if (kind === 'engine') decorEngine(b, bnd, rng);
      else if (kind === 'dark') darkRooms.push(room);
      else decorPlain(b, bnd, rng);
    }
  }

  kit.gridWalls(b, g, { matKey: 'L15:wall', trim: { h: 0.1, t: 0.015, color: 0xb0ada4, matKey: 'kit:prop' } });
  kit.prop.floor(b, null, null, 0, { matKey: 'L15:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L15:ceil', y: H });

  // 验收⑧：暗房间只是自己格子不放灯，但灯盘 range 8.5m 比 2 格(6m)的放灯间距还大，隔壁走廊的灯会漏进最小 6×6m
  // 的暗房间；给暗房间预算一份世界坐标包围盒，靠近它的灯把 range 缩小到刚好不漏进房间，其余地方 range 不变
  const darkBounds = darkRooms.map(rm => roomBounds(g, rm));
  function rangeAwayFromDark(x, z, base) {
    let r = base;
    for (const db of darkBounds) {
      const dx = Math.max(db.x0 - x, 0, x - db.x1), dz = Math.max(db.z0 - z, 0, z - db.z1);
      const d = Math.hypot(dx, dz);
      if (d < r) r = Math.max(2.5, d - 0.4);   // 留 0.4m 余量；下限 2.5m 避免正常区域反而变太暗
    }
    return r;
  }

  // 墙壁、天花板和地板上的大灯，让空荡荡的走廊散发诡异的光芒（environment.lighting）；
  // 色温/亮度/闪烁比例原文没给（研究稿标注 unverified），取冷白偏蓝呼应「未来主义」，跟其余无光层一样先无条件取数再判断
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      const r = rng();
      const dark = darkRooms.some(rm => i >= rm.i && i < rm.i + rm.w && j >= rm.j && j < rm.j + rm.d);
      if (dark) continue;   // 没有照明的漆黑房间：这一格不放灯（environment.lighting「另有没有照明的漆黑房间」）
      const state = r < 0.05 ? 'broken' : r < 0.16 ? 'flicker' : 'on';
      const cc = g.center(i, j);
      kit.prop.lightPanel(b, cc.x, cc.z, 0, {
        y: H, state, flicker: state === 'flicker' ? 0.3 + rng() * 0.5 : 0,
        color: 0xdfe8f5, intensity: 1.05, range: rangeAwayFromDark(cc.x, cc.z, 8.5),
      });
    }
  }

  // 验收⑥：选中版本写"墙壁、天花板和地面上的大灯"，之前只做了天花板灯盘；这里各补几处墙面灯带/地面灯带，
  // 呼应"未来主义走廊"的基调（灯具外观原文没给，只补光源类型，不追加没写过的设定）。抽样几个格子而不是每格都放，
  // 控制额外面数/灯光数量；只贴在 grid 真实存在的墙面上（g.walls 查询），别贴悬空处
  if (!rare && !isPortalChunk) {
    for (let n = 0; n < 3; n++) {
      const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
      if (darkRooms.some(rm => i >= rm.i && i < rm.i + rm.w && j >= rm.j && j < rm.j + rm.d)) continue;
      const walls = g.walls(i, j), sides = Object.keys(walls).filter(k => walls[k]);
      if (!sides.length) continue;
      const side = sides[Math.floor(rng() * sides.length)];
      const cc = g.center(i, j);
      const pos = side === 'n' ? { x: cc.x, z: j * CELL } : side === 's' ? { x: cc.x, z: (j + 1) * CELL }
        : side === 'w' ? { x: i * CELL, z: cc.z } : { x: (i + 1) * CELL, z: cc.z };
      const rotY = side === 'n' ? 0 : side === 's' ? Math.PI : side === 'w' ? Math.PI / 2 : -Math.PI / 2;
      b.push(pos.x, pos.z, rotY);
      b.box(0, H * 0.5, 0.06, 0.5, 1.0, 0.03, 'kit:prop', { color: 0xc7cdd6 });                      // 灯具外壳
      b.plane(0, H * 0.5, 0.075, 0.36, 0.9, 'kit:glow', { facing: '+z', uv: 'solid', color: [0.7, 1.3, 1.8] });
      b.light({ x: 0, y: H * 0.5, z: 0.15, color: 0xbfe6ff, intensity: 0.5, range: rangeAwayFromDark(pos.x, pos.z, 4.5) });
      b.pop();
    }
    for (let n = 0; n < 2; n++) {
      const i = Math.floor(rng() * N), j = Math.floor(rng() * N);
      if (darkRooms.some(rm => i >= rm.i && i < rm.i + rm.w && j >= rm.j && j < rm.j + rm.d)) continue;
      const cc = g.center(i, j);
      b.plane(cc.x, 0.012, cc.z, 0.4, 1.6, 'kit:glow', { facing: 'up', uv: 'solid', color: [0.5, 1.0, 1.5] });
      b.light({ x: cc.x, y: 0.15, z: cc.z, color: 0x8fd0ff, intensity: 0.35, range: rangeAwayFromDark(cc.x, cc.z, 3) });
    }
  }

  // 尸体：environment.other「尸体看起来像人…身穿实验室制服…完全失水」，遍布各处但不是每块都有
  const rCorpse = rng();
  if (!isSpawn && !rare && !isPortalChunk && rCorpse < 0.3) {
    const ci = 1 + Math.floor(rng() * (N - 2)), cj = 1 + Math.floor(rng() * (N - 2));
    const cc = g.center(ci, cj);
    buildCorpse(b, cc.x, cc.z, rng() * Math.PI * 2, rng(), rng);
  }

  // 白色钢管上偶尔出现的蔓藤花纹符号（materials「部分钢管上有看起来像蔓藤花纹的符号」）：独立材质走 world UV，
  // 不同位置自然露出贴图的不同相位，看起来像「只有部分管段有花纹」
  const rGlyph = rng();
  if (!rare && !isPortalChunk && rGlyph < 0.35) {
    const pi = Math.floor(rng() * N), pj = Math.floor(rng() * N);
    const cc = g.center(pi, pj);
    const axis = rng() < 0.5 ? 'x' : 'z';
    b.cylinder(cc.x, H - 0.22, cc.z, 0.06, 2.2, 'L15:pipe', { axis, segments: 8, uv: 'world' });
  }

  // 常设的白色钢管沿天花板贯穿走廊（materials「墙壁和天花板上的白色钢管」），走两条固定路径，不吃 rng
  kit.prop.pipe(b, SIZE / 2, 1.0, 0, { axis: 'x', length: SIZE - 2, y: H - 0.18, r: 0.055, color: 0xe6e6e0 });
  kit.prop.pipe(b, SIZE - 1.0, SIZE / 2, 0, { axis: 'z', length: SIZE - 2, y: H - 0.18, r: 0.055, color: 0xe6e6e0 });

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: '15', name: 'Level 15', title: '未来走廊', nickname: '未来走廊',
  version: 'wikidot-cn',                 // = lore-choices.levels['15'].source
  survivalClass: '生存难度 等级 0（页面标签：生存难度0、切行困难、封闭性层级）',
  chunkSize: SIZE,
  env: {
    background: 0x12161c, fogColor: 0x12161c,
    fogNear: 6, fogFar: 40,                                    // ≤ chunkSize×2=48
    // 灯盘/管道灯让走廊「散发诡异光芒」，但整体色温/亮度原文没给：取冷白偏蓝的「未来主义」基调，
    // intensity 压低到让无灯房间有效亮度 ≈ 0xdfe8f5(≈0.90) × 0.17 ≈ 0.15，符合“最暗但能看清路”的下限
    ambient: { color: 0xdfe8f5, intensity: 0.17 },
    // survivalClass 原文写「生存难度0」（较安全），但满地尸体、干涸血迹、远处发动机声让人不安，
    // 没有直接压到最安全档的 0.5，取 0.8 居中；温度原文未提，hungerDrainMul 用默认 1
    sanityDrainMul: 0.8, hungerDrainMul: 1,
    audio: 'pipes',   // sounds「走廊里能听到远处的发动机声，来自…机器」：现有预设里 pipes 的低频轰鸣+回声最接近，没有专门的“引擎声”预设
    darkness: false,
  },
  spawn() {
    // 出生点是走廊交叉口边上的小房间。entrances[0]「Level 10 突然出现一堵相同材料的墙…两天后墙消失、门关闭」是
    // 历史上仅记录过一次的事件，游戏里不复刻那扇会关闭的门，只把出生点安在这类走廊交叉口，呼应"由此进入"的说法
    return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 };
  },
  buildChunk,
  // entityDensityOverall「none — 原文称目前在此层级中还没有发现任何实体，仅有猎犬尸体」：不为热闹加实体。
  // 猎犬在本层只是尸体道具（entities[0].behavior「本层没有活体，仅有尸体」），entity-index.json 里 hound 的 levels
  // 也确实不含 '15'，尸体已经在 buildChunk 里用普通场景道具做了
  entities: [],
  items: [
    // 用户规则『所有模式都刷杏仁水和食物』：选中版本 hazards/items 都写「整个层级没有任何杏仁水」，这里仍照用户规则刷
    { type: 'almond_water', per1000m2: 1.2 },            // 用户规则覆盖版本设定，原文明确没有
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    // items「包含很多食物的储藏室」但没写具体食物种类；食物类占位用 food_ration（用户规则兜底），storage 房型另有更多食物箱子造型
    { type: 'food_ration', per1000m2: 0.6 },
  ],
  exits: [
    // exits[0]：唯一记录的出口，理论出口未验证，目标层级本身未记录/未知 → kit 按 sealed 处理（'Unknown' 不在 LEVEL_ORDER 里）
    { to: 'Unknown', kind: 'zone', note: '"无引擎机房"地标：后部门框散发白光、里面像夜空；验收③要求可达性，改成每个 144m 见方的宏格必定出现一次（原来是 4% 概率、平均要 20 个区块开外才找得到）；理论出口从未验证，进圈提示"尚未开放"，玩家找到它之后仍然无法真正离开本层，见 apiRequests' },
  ],
  // 选中版本（wikidot-cn）只记录了一个从未验证过的出口（无引擎机房里发白光的门框），游戏里是 sealed：本层进来就没有通往
  // 已开放层级的路。照原文不编造出口，只在进层时把这一点和"从暂停菜单返回主页"告诉玩家，免得一直找出口
  enter(ctx) { BR.hud.toast('这里记录过的唯一出口——机房里发白光的门框——从没被验证过。想离开，可以从暂停菜单返回主页', 5200); },
  update(ctx, dt) {}, leave(ctx) {},
});
})();
