// Level 19 "阁楼"（标题/别称见选中版本 title/nickname）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-19  许可：CC BY-SA 3.0
// 抓取：2026-09-12（WebFetch 两次 + curl 下载原始 HTML 全文核对）
// 只按 wikidot-cn 这个版本实现：不做 wikidot-en 的 Level 289 破门目标、也不做 fandom 的《The Abyss Inn》
//   90 年代郊区酒店走廊迷宫（生存等级/危险分级、编号实体、缺补给设定统统不用）——两者都不是选中版本
//   （data/lore-choices.json levels["19"].conflicts）。
// 页面本身是 12 版 M.E.O.D. 修订记录，选中版本内部就混有"正式条目"与多版"叙事修订"，
//   本文件按选中版本调研文件（backrooms-research/levels/level-19.json）里合并好的 environment/landmarks/
//   hazards/mechanics/items/exits 字段实现，不再区分这些细节各自出自哪一版修订。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// 依据：scale「没有尺寸数字（unverified）」——沿用室内迷宫默认尺度；房间用格子当"隔间"单元
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.9;          // 天花板脊线附近的名义高度（无实测数字，取室内默认层高附近）
// 本轮验收 low#4：这里原来引的"这地方让我很难站直"其实是 wikidot-en 的意思，cn 版 scale 字段明确说
//   这句英文原文 cn 版 7 译成"这地方让我很难受"（不是"站不直"）——不能借用别版本的措辞，改引 cn 版
//   architecture 里真正支撑"低矮斜顶"设计的那句话
// 依据：architecture「叙事版本 7/8：每个房间的天花板是从最高点斜到地板的三角形斜坡」——本想做
//   "矮墙可以看过去"的膝墙，但引擎没有下蹲/低头，矮于玩家视高（BR.config.player.eyeHeight 1.62）
//   的斜顶会让镜头直接怼进斜面网格（近裁剪穿模）。
//   退一步：斜顶最低处仍定在明显矮于房间整体高度的 2.05（比 1.8 的玩家身高稍高一点点，不会穿模），
//   脊线抬到 2.4–2.9，坡度仍然清楚可见，只是不做"能看穿隔间"的效果——写进 apiRequests。
const WALL_H = 2.05;
const RIDGE_BASE = 2.4, RIDGE_VAR = 0.5;   // 每个格子的斜顶脊线高度随机落在 [2.4, 2.9]
const SPAWN_I = 3, SPAWN_J = 3;
const SPAWN_X = (SPAWN_I + 1) * CELL, SPAWN_Z = (SPAWN_J + 1) * CELL;

// ---------- 布局：房间串联的阁楼隔间，格线当"斜顶落地"的边界，不是常规意义的墙 ----------
// 依据：layout「房间串联（不规则阁楼隔间，由门框相连）」；architecture「房间不完全是方形，有的带突出部分」
//   —— 用标准格子迷宫的房间+走廊生成天然做出"矩形房间带走廊凸出"的不规则感，走廊/房间之间的格线
//   即"斜顶落地"的位置（矮墙+斜顶，不是齐顶的实墙，见下方 gridWalls 的 height/top 设置）
const EDGE = { salt: 'L19', boundaryDensity: 0.34, straightness: 0.55, minOpenings: 2 };
const ATTIC = Object.assign({ wallDensity: 0.4, roomChance: 0.42, maxRooms: 3, roomSize: [2, 4], loopChance: 0.55, pillarChance: 0 }, EDGE);

// 依据：exits[1]「偶尔一些破损或被毁坏的门」→ Level -2/5/12/20；-2 不在首期范围（kit 自动 sealed），
//   5/12/20 已开放，按规则②要求"3-5 块内能找到"，用较高概率保证密度（原文没给具体比例，三个已开放目标
//   权重明显高于范围外的 -2，让玩家大概率摸到真出口）
const BROKEN_DOOR_CHANCE = 0.32;
const DOOR_TARGETS = [['-2', 0.15], ['5', 0.283], ['12', 0.283], ['20', 0.283]];

// 依据：exits[0]「掉进任何一个没有发光的地板或裂缝」→ Level 38/202/432/654（原文："这四个只是例子"，
//   四个目标本身都不在首期范围，sealed 提示即可，此处只做"踩到会提示尚未开放的地板裂缝"这个体验）
const CRACK_CHANCE = 0.07;
const CRACK_TARGETS = [['38', 0.25], ['202', 0.25], ['432', 0.25], ['654', 0.25]];

// 依据：exits[3]「在 Level 19 的边界中经历强烈模糊与衰败」→ Level 140（不在首期范围）；层级本身是
//   "被假定的边缘"而非明确无限，用规则②"走得够远就离开"的写法：离出生块够远后，大整块 zone
const EDGE_MIN_DIST = 9, EDGE_CHANCE = 0.3;

// ---------- 材质 ----------
function defineMaterials() {
  // 依据：materials「地面由粉色绝缘材料和地板组合而成，地板嘎嘎作响」——木地板用贴图，
  //   粉色绝缘材料是散落的小色块（下方用 kit:prop 顶点色画，不占贴图预算）
  kit.mat('L19:floor', { tex: 'l19_floor_attic', repeatMeters: 2.2, roughness: 1 });
  // 依据：architecture「潮湿、破旧且杂乱」——原来无贴图纯色墙验收 medium#4 指出像"灰白隔板"，
  //   改成旧木板贴图（阁楼隔间常见材料，跟地板同一套调子）
  kit.mat('L19:wall', { tex: 'l19_wall_attic', repeatMeters: 2.4, roughness: 0.95 });
  // 斜顶天花板：vertexColors 开着才能让每个格子的脊线颜色有细微差别（不吃贴图预算）
  kit.mat('L19:ceil', { color: 0x372c22, roughness: 1, side: 'double', vertexColors: true });
  // 本轮验收 medium#3：粉色绝缘材料原来只贴几个看不清的小色块，改成有撕裂边缘的贴图色块盖住半个地板格；
  // 蜘蛛网原来完全没做——都用 canvas 现画、alphaTest 镂空（同 L15 焚化室烧痕/L10 麦穗的做法），
  // 不经过 assets/tex 的 404 兜底那一套，因为这两张本来就不打算做成外部 jpg
  kit.mat('L19:insulation', { type: 'lambert', map: insulationTexture(), alphaTest: 0.4, side: 'double', color: 0xffffff });
  kit.mat('L19:cobweb', { type: 'lambert', map: cobwebTexture(), alphaTest: 0.12, side: 'double', color: 0xffffff, transparent: false });
}

// 粉色绝缘材料贴图：撕裂状的不规则色块（露出的填充棉+两根深色木龙骨），四周透明露出下面的地板贴图
// 依据：materials「地面由粉色绝缘材料和地板组合而成」
let l19InsulTex = null;
function insulationTexture() {
  if (l19InsulTex) return l19InsulTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = U.rng('l19_insulation');
  g.save();
  g.beginPath();
  const steps = 14;
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const rad = 96 + (r() - 0.5) * 40;
    const px = 128 + Math.cos(a) * rad, py = 128 + Math.sin(a) * rad;
    if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath(); g.clip();
  g.fillStyle = '#d79cb3'; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 900; k++) {
    const v = 190 + (r() * 55 | 0);
    g.fillStyle = `rgba(${v},${(v * 0.56) | 0},${(v * 0.68) | 0},0.35)`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 3);
  }
  g.fillStyle = '#3a2c1c';                     // 木龙骨（絮状棉夹在两根龙骨之间露出来）
  g.fillRect(38, 0, 24, 256);
  g.fillRect(192, 0, 24, 256);
  g.restore();
  l19InsulTex = new THREE.CanvasTexture(c);
  return l19InsulTex;
}

// 蜘蛛网贴图：从贴图 (0,0) 角向外辐射的丝线，配合 quad() 摆在墙角，(0,0) 对应墙角顶点
// 依据：materials「蜘蛛网常见」
let l19CobwebTex = null;
function cobwebTexture() {
  if (l19CobwebTex) return l19CobwebTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = U.rng('l19_cobweb');
  g.strokeStyle = 'rgba(214,210,198,0.55)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 7; k++) {                // 辐射丝
    const a = (k / 6) * Math.PI / 2 + (r() - 0.5) * 0.1;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 190, Math.sin(a) * 190); g.stroke();
  }
  for (let ring = 1; ring <= 5; ring++) {      // 同心圆弧
    const rad = ring * 24 + (r() - 0.5) * 6;
    g.beginPath(); g.arc(0, 0, rad, 0, Math.PI / 2); g.stroke();
  }
  l19CobwebTex = new THREE.CanvasTexture(c);
  return l19CobwebTex;
}

// file:// 双击打开时的贴图兜底（没有 assets/tex 时才会用到，见第 15 节）
BR.assets.registerProcedural('l19_floor_attic', 256, (g, s) => {
  g.fillStyle = '#584a3a'; g.fillRect(0, 0, s, s);
  const r = U.rng('l19_floor_attic');
  for (let x = 0; x < s; x += s / 10) {
    g.strokeStyle = 'rgba(30,22,14,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke();
  }
  for (let k = 0; k < 400; k++) { const v = 60 + (r() * 40 | 0); g.fillStyle = `rgba(${v},${v - 10},${v - 22},0.3)`; g.fillRect(r() * s, r() * s, 3, 1); }
  // 本轮验收 medium#3（地面部分）：materials「到处发霉」——原来地板贴图完全没画发霉痕迹，补几团暗绿色霉斑
  for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(24,30,14,0.22)'; g.beginPath(); g.arc(r() * s, r() * s, 6 + r() * 14, 0, Math.PI * 2); g.fill(); }
});

// 验收 medium#4：墙原来是无贴图纯色，改用竖排旧木板贴图；仓库里没有 l19_wall_attic.jpg，
// noFile 跳过文件探测，免得每次进层都报 404（同 L14/L20 的兜底写法）
BR.assets.registerProcedural('l19_wall_attic', 256, (g, s) => {
  g.fillStyle = '#493c2c'; g.fillRect(0, 0, s, s);
  const r = U.rng('l19_wall_attic');
  const planks = 7;
  for (let k = 0; k <= planks; k++) {
    const x = Math.round(k * s / planks);
    g.strokeStyle = 'rgba(20,14,8,0.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke();
  }
  for (let k = 0; k < planks; k++) {
    const x0 = (k * s / planks) | 0, x1 = ((k + 1) * s / planks) | 0;
    const tint = 0.85 + r() * 0.3;
    g.fillStyle = `rgba(${(60 * tint) | 0},${(48 * tint) | 0},${(34 * tint) | 0},0.5)`;
    g.fillRect(x0, 0, x1 - x0, s);
  }
  for (let k = 0; k < 220; k++) { const v = 40 + (r() * 30 | 0); g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.25)`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 6 + r() * 18); }
  // 潮斑/霉斑：依据 architecture「潮湿、破旧且杂乱」+ materials「到处发霉（版本 7）」——
  // 本轮验收 medium#3 指出发霉完全没做，原来 5 团太少太淡，数量翻倍、加深一档更看得出是霉斑
  for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(18,24,13,0.26)'; g.beginPath(); g.arc(r() * s, r() * s, 9 + r() * 22, 0, Math.PI * 2); g.fill(); }
}, { noFile: true });

// ---------- 家具/杂物：简易沙发（构件表没有 couch，自己用 kit:prop 拼，参照 _kit.js 里 desk/vending 的写法）----------
// 依据：materials「箱式凳、书架、沙发（疗养院的感觉）」
function couch(b, x, z, rot, color) {
  // 验收 low#5：b.box 的 y 是底边不是中心，原来三块的 y 分别是 0.18/0.5/0.36，
  // 下面没有腿/底座，整张沙发悬空——三块都改成从地面（y=0）起立
  b.push(x, z, rot);
  b.box(0, 0, 0, 1.5, 0.45, 0.68, 'kit:prop', { color });                              // 坐垫
  b.box(0, 0, -0.3, 1.5, 0.95, 0.12, 'kit:prop', { color: (color & 0xfefefe) >> 1 });   // 靠背
  for (const sx of [-1, 1]) b.box(sx * 0.71, 0, 0.02, 0.12, 0.65, 0.68, 'kit:prop', { color });  // 扶手
  b.pop();
}

// 简易书架：构件表没有 bookshelf，自己拼（底/顶/两侧板+两层隔板+几本歪插的书，靠书脊颜色区分让人一眼认出是书架而非柜子）
// 依据：materials「箱式凳、书架、沙发」
function bookshelf(b, x, z, rot, color) {
  // 局部高度用 Hh（跟 _kit.js 里 desk() 的命名习惯一致），避免跟本文件顶部的天花板名义高度常量 H 混淆
  const W = 1.0, D = 0.32, Hh = 1.7, t = 0.03;
  const dark = (color & 0xfefefe) >> 1;
  const bookColors = [0x6e2f2f, 0x304a5c, 0x555a2f, 0x3c3450, 0x5c4426];
  b.push(x, z, rot);
  b.box(0, 0, 0, W, t, D, 'kit:prop', { color });                                    // 底板
  b.box(0, Hh - t, 0, W, t, D, 'kit:prop', { color });                               // 顶板
  for (const sx of [-1, 1]) b.box(sx * (W / 2 - t / 2), 0, 0, t, Hh, D, 'kit:prop', { color });  // 两侧板
  b.box(0, 0, -D / 2 + t / 2, W - t * 2, Hh, t, 'kit:prop', { color: dark });         // 背板（暗一点，做出进深感）
  for (const fy of [Hh * 0.35, Hh * 0.68]) b.box(0, fy, 0, W - t * 2, t, D - t, 'kit:prop', { color });  // 两层隔板
  for (const baseY of [t, Hh * 0.35 + t]) {
    let bx = -W / 2 + t * 1.6;
    for (let k = 0; k < 5 && bx < W / 2 - t; k++) {
      const bw = 0.05 + (k % 3) * 0.015, bh = 0.26 + (k % 2) * 0.08;
      b.box(bx + bw / 2, baseY, 0, bw, bh, D - t * 2 - 0.02, 'kit:prop', { color: bookColors[k % bookColors.length] });
      bx += bw + 0.012;
    }
  }
  b.solid(-W / 2, 0, -D / 2, W / 2, Hh, D / 2);
  b.pop();
}

// 门框（无墙、只做装饰用的两根门柱+过梁，不带碰撞——格线本身已由膝墙/格子生成来保证连通与碰撞）
// 依据：architecture「区域之间只有门框」
// 本轮验收 medium#2：原来用 kit:prop 纯色（0x3c3226 深棕）+ 无贴图，在暗环境光下反而显灰白——
// kit:prop 材质无贴图时基色是 0xcccccc（浅灰），顶点色再深也会被这层浅灰"提亮"，跟旁边有贴图纹理
// 的深色木墙一比就很扎眼。改用墙本身的 L19:wall 贴图材质（有木纹明暗细节，基色是贴图不是浅灰），
// 门框看起来就是"墙上凿出来的木框"，不再是浮在空气里的浅色柱子
function frame(b, x, z, rot, w) {
  const jw = 0.09, h = 2.05;
  b.push(x, z, rot);
  for (const sx of [-1, 1]) b.box(sx * (w / 2), 0, 0, jw, h, jw, 'L19:wall', { faces: 'noBottom', solid: false });
  b.box(0, h, 0, w + jw, jw, jw, 'L19:wall', { solid: false });
  b.pop();
}

// 门框边是否"两端都挨着别的墙"：像真的墙上开了个门口，而不是空地里插两根柱子
// 依据：architecture「区域之间只有门框」隐含"门框标记的是墙的断口"，不是随便哪块空地
function edgeFlanked(g, e) {
  function vertexWalled(i, j, skipAxis, skipI, skipJ) {
    const near = [['v', i, j - 1], ['v', i, j], ['h', i - 1, j], ['h', i, j]];
    for (const [ax, ci, cj] of near) {
      if (ax === skipAxis && ci === skipI && cj === skipJ) continue;
      if (g.isWall(ax, ci, cj)) return true;
    }
    return false;
  }
  if (e.axis === 'v') return vertexWalled(e.i, e.j, 'v', e.i, e.j) && vertexWalled(e.i, e.j + 1, 'v', e.i, e.j);
  return vertexWalled(e.i, e.j, 'h', e.i, e.j) && vertexWalled(e.i + 1, e.j, 'h', e.i, e.j);
}

// ---------- 区块 ----------
// rng 消耗顺序固定：格子 → 破损门 → 斜顶天花板（按房间/单格）→ 门框装饰 → 地板异象（发光/裂缝）
//   → 粉色绝缘材料 → 蜘蛛网 → 家具杂物 → 边缘 zone
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  const g = kit.grid(b, N, N, ATTIC);
  if (isSpawn) { g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true }); g.reserve(SPAWN_I, SPAWN_J); g.reserve(SPAWN_I + 1, SPAWN_J); g.reserve(SPAWN_I, SPAWN_J + 1); g.reserve(SPAWN_I + 1, SPAWN_J + 1); }

  // 破损/毁坏的门：拆一段内部墙，原位放一扇不带墙的门（规则⑧：先拆墙，kit.exit(door) 自己建门）
  const rDoor = rng();
  const edDoor = g.pickEdge(rng, { wall: true, interior: true, unlocked: true });
  if (!isSpawn && rDoor < BROKEN_DOOR_CHANCE && edDoor) {
    g.setWall(edDoor.axis, edDoor.i, edDoor.j, false);
    const target = U.weighted(rng, DOOR_TARGETS);
    const doorW = 0.95;
    // 验收 low#6：门默认高 2.05 + 过梁 0.08 = 2.13，而这条格线的斜顶最低点正是 WALL_H=2.05，
    // 过梁会穿进天花板——传 h=1.9，2.9+0.08=1.98 < 2.05 留出余量
    // （kit.exit 的 door 内部把 open 强制写死成 0——不能改 _kit.js，"门扇留缝"的破损感做不出来，
    //   只修可控的两处：高度穿模、门两侧悬空）
    kit.exit(b, {
      to: target, kind: 'door', x: edDoor.x, z: edDoor.z, rot: edDoor.rot,
      style: 'wood', door: { color: 0x362c1f, frameColor: 0x211a12, w: doorW, h: 1.9 },
      label: '一扇破损的门',
    });
    // 本轮验收 medium#1：kit.exit(door) 自带的触发点在门前方 0.7 m（沿 rot 的 +Z），门扇关着有实体
    // 碰撞，玩家从门背面靠近最近只能站到门缝外约 0.35–0.4 m 处，够不到前方那个触发圈，等于
    // "背面走不出去"。这里不碰 _kit.js，另外叠一个 kind:'zone' 的纯触发（不建任何实体，parts 为
    // 空），圆心直接落在门缝本身的世界坐标、半径 0.8——门缝两侧的碰撞体外沿都在这个半径以内，
    // 两个方向靠近都能碰到同一个出口（sealed/label 由 kit.exit 内部按 to 是否在首期范围自动算，
    // 跟前面那扇门一致，不用重复传）
    kit.exit(b, { to: target, kind: 'zone', x: edDoor.x, z: edDoor.z, radius: 0.8, label: '一扇破损的门' });
    // 拆的是整段格线（3 m），门只占中间不到 1 m，两侧本来完全空着像"门孤零零立在空地上"——
    // 用同款墙材质补两截矮墙塞满缺口，门变成夹在墙里的唯一通道
    const stubLen = Math.max(0, (edDoor.len - doorW - 0.3) / 2);
    if (stubLen > 0.1) {
      b.push(edDoor.x, edDoor.z, edDoor.rot);
      const wt = 0.267;
      for (const s of [-1, 1]) b.box(s * (doorW / 2 + 0.15 + stubLen / 2), 0, 0, stubLen, WALL_H, wt, 'L19:wall', {});
      b.pop();
    }
    g.reserve(edDoor.i, edDoor.j);
  }

  kit.gridWalls(b, g, { matKey: 'L19:wall', height: WALL_H, thickness: 0.267, trim: false, top: false });
  kit.prop.floor(b, null, null, 0, { matKey: 'L19:floor' });

  // 斜顶天花板：整间房间起一个"帐篷"（而不是每格一个），脊线朝向和高度随机，拼出参差不齐的阁楼顶
  // 依据：architecture「每个房间的天花板是从最高点斜到地板的三角形斜坡」——"每个房间"一个斜顶
  // 本轮验收 low#6：原来按 3 m 格子逐格拆分，房间内部每跨一格屋脊就断一次，不像"一间房一个坡"；
  // 本轮验收 low#3：出生点 (12,12) 正好卡在 2×2 出生间内部的格线交叉点上，两片相邻格子各自的"人字山墙"
  //   补丁（见下方退化 quad）恰好在这一点撞在镜头近裁剪面上，屏幕正中裂出一道竖线/色块。
  //   改成按房间整体（g.rooms 的矩形 + 出生间）起一个大斜顶：房间内部不再有中途断层，
  //   出生点也不会卡在两个独立屋顶的接缝上（零散走廊格子没编进房间，退化成 1×1 的"房间"照旧处理）
  const tentCovered = new Uint8Array(N * N);
  const tentRegions = [];
  function markTent(i0, j0, w, d) {
    for (let jj = j0; jj < j0 + d; jj++) for (let ii = i0; ii < i0 + w; ii++) tentCovered[jj * N + ii] = 1;
    tentRegions.push({ i0, j0, w, d });
  }
  for (const room of g.rooms) markTent(room.i, room.j, room.w, room.d);
  if (isSpawn) markTent(SPAWN_I, SPAWN_J, 2, 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (!tentCovered[j * N + i]) markTent(i, j, 1, 1);

  for (const rg of tentRegions) {
    const axisRoll = rng(), ridgeRoll = rng();
    const x0 = rg.i0 * CELL, x1 = x0 + rg.w * CELL, z0 = rg.j0 * CELL, z1 = z0 + rg.d * CELL;
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    const ridgeY = RIDGE_BASE + ridgeRoll * RIDGE_VAR;
    const tint = 0.85 + ridgeRoll * 0.3;
    const c = [tint, tint * 0.92, tint * 0.8];
    if (axisRoll < 0.5) {
      // 脊线沿本地 x：z0..zm 一面斜坡，zm..z1 另一面
      b.quad([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, ridgeY, zm], [x0, ridgeY, zm], 'L19:ceil', { color: c });
      b.quad([x0, ridgeY, zm], [x1, ridgeY, zm], [x1, WALL_H, z1], [x0, WALL_H, z1], 'L19:ceil', { color: c });
      // 验收 high#1：每块只建了两片斜坡，x0/x1 两端的三角山墙没封口，露黑洞。
      // 用退化 quad（p2=p3 同点）补成三角形，把"帐篷"两端撑起来
      b.quad([x0, WALL_H, z0], [x0, WALL_H, z1], [x0, ridgeY, zm], [x0, ridgeY, zm], 'L19:ceil', { color: c });
      b.quad([x1, WALL_H, z1], [x1, WALL_H, z0], [x1, ridgeY, zm], [x1, ridgeY, zm], 'L19:ceil', { color: c });
    } else {
      // 脊线沿本地 z：x0..xm 一面斜坡，xm..x1 另一面
      b.quad([x0, WALL_H, z0], [x0, WALL_H, z1], [xm, ridgeY, z1], [xm, ridgeY, z0], 'L19:ceil', { color: c });
      b.quad([xm, ridgeY, z0], [xm, ridgeY, z1], [x1, WALL_H, z1], [x1, WALL_H, z0], 'L19:ceil', { color: c });
      // 同上：z0/z1 两端补三角山墙
      b.quad([x0, WALL_H, z0], [x1, WALL_H, z0], [xm, ridgeY, z0], [xm, ridgeY, z0], 'L19:ceil', { color: c });
      b.quad([x1, WALL_H, z1], [x0, WALL_H, z1], [xm, ridgeY, z1], [xm, ridgeY, z1], 'L19:ceil', { color: c });
    }
  }

  // 门框装饰：部分内部开口（非边界）放一个无墙门框，呼应"区域之间只有门框相连"
  // （跳过刚拆出来给破损门用的那一段，避免两套装饰叠在同一个洞口；概率取样，避免长走廊里排成一排"栅栏柱"）
  for (const e of g.edges({ wall: false, interior: true })) {
    if (edDoor && e.axis === edDoor.axis && e.i === edDoor.i && e.j === edDoor.j) continue;
    // 验收 medium#3：两侧格子都属于同一个 room（含出生房间）时，这条边是房间内部的空地，
    // 不是"走廊/房间交界"或"墙段窄口"——放门框会在房间中间立成一排柱子，出生点四向都挡屏幕正中
    const sameRoom = e.axis === 'v'
      ? (g.isRoom(e.i - 1, e.j) && g.isRoom(e.i, e.j))
      : (g.isRoom(e.i, e.j - 1) && g.isRoom(e.i, e.j));
    if (sameRoom) continue;
    // 本轮验收 medium#2：原来任何开口都能放门框，很多开口两侧根本没有墙（一整段格线都是空的），
    // 门框柱子就孤零零立在开阔地上、还常常几个连号的开口排成一排，看着像一排栅栏柱而不是门框。
    // 用 edgeFlanked 只在"这个口子两端确实各接着一段墙"（真正的墙体断口）时才放
    if (!edgeFlanked(g, e)) continue;
    if (rng() >= 0.5) continue;
    frame(b, e.x, e.z, e.rot, Math.min(e.len - 0.15, 1.1));
  }

  // 地板异象：发光地板 / 不发光的裂缝（隔格取，够密又不至于每步都踩到；粉色绝缘材料挪到下面单独一段，
  // 那种"地面材质"该占的是看得见的一片，不该跟这两种"踩上去有效果"的异象抢同一个采样点）
  // 依据：landmarks「发出橙色光芒的地板」「没有发光的地板或裂缝（出口）」
  for (let j = 0; j < N; j += 2) {
    for (let i = 0; i < N; i += 2) {
      if (g.isReserved(i, j)) continue;
      const c = g.center(i, j);
      const roll = rng();
      if (roll < 0.10) {
        // 橙色的光芒：微弱、温暖、如火焰——依据 lighting「一些地板下面会发出温暖、如火焰一般的光芒」
        const glowSize = 0.9 + rng() * 0.6;
        const piece = b.plane(c.x, 0.015, c.z, glowSize, glowSize, 'kit:glow', { facing: 'up', uv: 'solid', color: [1.5, 0.85, 0.32] });
        const light = b.light({ x: c.x, y: 0.3, z: c.z, color: 0xff8a3c, intensity: 1.0, range: 6.5, flicker: 0.22 });
        b.linkGlow(piece, light, [1.5, 0.85, 0.32], 0.15);
        // 依据：entities[0]「灌输舒适平和感来吸引流浪者」——靠近时给一次提示，不做数值效果（无编号实体、非战斗）
        const gw = b.world(c.x, c.z);
        let told = false;
        b.update((dt, t) => {
          if (told || t < 0.4) return;
          const dx = BR.player.x - gw.x, dz = BR.player.z - gw.z;
          if (dx * dx + dz * dz < 2.6 * 2.6) {
            told = true;
            BR.hud.toast('地板下的暖光让人很想靠近，你却说不清那到底是什么', 3200);
            BR.audio.play('whisper', gw);
          }
        });
      } else if (roll < 0.10 + CRACK_CHANCE && !isSpawn) {
        // 没有发光的裂缝：踩空掉到别的层级，四个目标都在首期范围外，统一按 sealed 提示处理
        const target = U.weighted(rng, CRACK_TARGETS);
        kit.exit(b, { to: target, kind: 'hole', x: c.x, z: c.z, hole: { r: 0.85, irregular: true, rimColor: 0x241d16 }, label: '不发光的裂缝' });
      }
    }
  }

  // 粉色绝缘材料：地板破了个洞、露出中间隔栅的絮状填充棉，用有撕裂边缘的贴图盖住半个地板格，
  // 而不是几个看不清的小色块（本轮验收 medium#3：原来的实现在 6 张截图里一块都看不见）
  // 依据：materials「地面由粉色绝缘材料和地板组合而成」——CELL 正好是 3 m，按格判定
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (g.isReserved(i, j)) continue;
      if (rng() >= 0.15) continue;
      const c = g.center(i, j);
      const sz = CELL * (0.55 + rng() * 0.3);
      b.plane(c.x + (rng() - 0.5) * 0.4, 0.013, c.z + (rng() - 0.5) * 0.4, sz, sz, 'L19:insulation', { facing: 'up', uv: 'stretch' });
    }
  }

  // 蜘蛛网：挂在真正的墙角上部（跟门框装饰用同一套"这一角两面都有墙"的判断），常见但不刷屏
  // 依据：materials「蜘蛛网常见」
  for (const cell of g.cells(c => !c.reserved)) {
    const w = g.walls(cell.i, cell.j);
    const corners = [];
    if (w.n && w.w) corners.push('nw'); if (w.n && w.e) corners.push('ne');
    if (w.s && w.w) corners.push('sw'); if (w.s && w.e) corners.push('se');
    for (const cn of corners) {
      if (rng() >= 0.12) continue;
      const x0 = cell.i * CELL, x1 = x0 + CELL, z0 = cell.j * CELL, z1 = z0 + CELL;
      const size = 0.7 + rng() * 0.5, yTop = WALL_H - 0.04;
      let p0, p1, p3;
      if (cn === 'nw') { p0 = [x0, yTop, z0]; p1 = [x0 + size, yTop, z0]; p3 = [x0, yTop, z0 + size]; }
      else if (cn === 'ne') { p0 = [x1, yTop, z0]; p1 = [x1 - size, yTop, z0]; p3 = [x1, yTop, z0 + size]; }
      else if (cn === 'sw') { p0 = [x0, yTop, z1]; p1 = [x0 + size, yTop, z1]; p3 = [x0, yTop, z1 - size]; }
      else { p0 = [x1, yTop, z1]; p1 = [x1 - size, yTop, z1]; p3 = [x1, yTop, z1 - size]; }
      const p2 = [(p1[0] + p3[0]) / 2, yTop - size * 0.55, (p1[2] + p3[2]) / 2];
      b.quad(p0, p1, p2, p3, 'L19:cobweb', { uv: 'stretch' });
    }
  }

  // 堆满箱子和老式家具的杂物区
  // 依据：landmarks「堆满箱子和老式家具的杂物区」；materials「箱子、桌子、箱式凳、书架、沙发」
  // 验收 medium#4：原来每房间 55% 概率只放一组，4 张 spot 截图一件家具都没有——房间按面积放多组，
  // 走廊格子也贴墙角点缀（避免堵路），让"堆满杂物"名副其实
  // 本轮验收 low#5：原来缺 materials 明确点名的"桌子"和"书架"，clutter 池里补上（桌子借用 kit.prop.desk，
  // 关掉 monitor 只留桌面+抽屉当老式木桌；书架自己拼，见上面 bookshelf()）
  // 本轮验收 medium#2（家具部分）：原来的颜色在暗环境光下偏浅灰白，统一调深一档，跟阴暗潮湿的老阁楼更配
  function placeClutter(x, z, rot) {
    const pick = U.weighted(rng, [['crate', 0.22], ['boxes', 0.22], ['cabinet', 0.16], ['couch', 0.16], ['desk', 0.12], ['bookshelf', 0.12]]);
    if (pick === 'crate') { kit.prop.crate(b, x, z, rot, { size: 0.75, color: 0x4a3f2e }); kit.prop.box(b, x + 0.6, z + 0.3, rot, { stack: 2, color: 0x544a37 }); }
    else if (pick === 'boxes') { kit.prop.box(b, x, z, rot, { stack: 3, color: 0x544a37 }); kit.prop.box(b, x - 0.55, z + 0.2, rot + 0.3, { stack: 1, color: 0x463c2b }); }
    else if (pick === 'cabinet') { kit.prop.cabinet(b, x, z, rot, { kind: 'wardrobe', color: 0x362b1e }); }
    else if (pick === 'desk') { kit.prop.desk(b, x, z, rot, { w: 1.3, d: 0.65, h: 0.72, color: 0x3e3222, monitor: false }); }
    else if (pick === 'bookshelf') { bookshelf(b, x, z, rot, 0x352a1c); }
    else { couch(b, x, z, rot, 0x374031); kit.prop.crate(b, x + 0.9 * Math.cos(rot), z + 0.9 * Math.sin(rot), rot, { size: 0.4, color: 0x4a3f2e }); }   // 沙发旁的箱式凳
  }
  for (const room of g.rooms) {
    // 面积越大摆的组数越多（原来固定一组，房间大了显得空）
    const groups = 1 + (room.w * room.d >= 6 ? 1 : 0) + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < groups; k++) {
      if (rng() >= 0.75) continue;
      const ci = U.randInt(rng, room.i, room.i + room.w - 1), cj = U.randInt(rng, room.j, room.j + room.d - 1);
      const rc = g.center(ci, cj);
      const corner = { x: rc.x + (rng() - 0.5) * (CELL - 0.9), z: rc.z + (rng() - 0.5) * (CELL - 0.9) };
      placeClutter(corner.x, corner.z, rng() * Math.PI * 2);
    }
  }
  // 走廊格子：只在有夹角的墙角摆（两面都有墙才放），不会立在过道正中间挡路
  for (const cell of g.cells(c => !c.room && !c.reserved)) {
    if (rng() >= 0.22) continue;
    const w = g.walls(cell.i, cell.j);
    const corners = [];
    if (w.n && w.w) corners.push([-1, -1]); if (w.n && w.e) corners.push([1, -1]);
    if (w.s && w.w) corners.push([-1, 1]); if (w.s && w.e) corners.push([1, 1]);
    if (!corners.length) continue;
    const [sx, sz] = corners[(rng() * corners.length) | 0];
    const inset = CELL * 0.32;
    placeClutter(cell.x + sx * inset, cell.z + sz * inset, rng() * Math.PI * 2);
  }

  // 被假定的边缘：离出生点足够远才可能出现，整块铺一个大 zone（规则②"走得够远就离开"）
  // 依据：other「被假定的边缘处会出现强烈模糊感和整体衰败效果」；exits[3]→Level 140（不在首期范围）
  const dist = Math.max(Math.abs(cx), Math.abs(cz));
  const rEdge = rng();
  if (!isSpawn && dist >= EDGE_MIN_DIST && rEdge < EDGE_CHANCE) {
    const zoneRadius = SIZE * 0.75;
    kit.exit(b, { to: '140', kind: 'zone', x: SIZE / 2, z: SIZE / 2, radius: zoneRadius, label: '模糊而衰败的边界' });
    // 验收 medium#2：原来只按区块加载时长（0.6s）弹 toast，不管玩家在不在——loadRadius=2 时
    // 玩家离这块还有约 2 个区块就会看到"走到了尽头"，而且区块反复加载/卸载会重复弹。
    // 改成跟地板暖光提示一样，判断玩家与 zone 中心的实际距离，走进半径内才弹一次
    const zc = b.world(SIZE / 2, SIZE / 2);
    let told = false;
    b.update((dt, t) => {
      if (told) return;
      const dx = BR.player.x - zc.x, dz = BR.player.z - zc.z;
      if (dx * dx + dz * dz < zoneRadius * zoneRadius) {
        told = true;
        BR.hud.toast('四周的轮廓开始变得模糊，像是走到了这里的尽头', 3000);
      }
    });
  }

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: '19', name: 'Level 19', title: '阁楼', nickname: '阁楼',
  version: 'wikidot-cn',                 // = lore-choices.levels['19'].source
  survivalClass: '2',
  chunkSize: SIZE,
  env: {
    // 依据：colors「明确写出的只有地板下的橙色光芒和粉色绝缘材料」——环境本身没有颜色描述，
    //   用接近橙光色调的暗色打底，让远处雾色和唯一的光源色调统一
    background: 0x120d08, fogColor: 0x120d08, fogNear: 2.4, fogFar: 19,
    // 依据：lighting「没有'自然'光源……只有地板下面在发光，所以很难看清东西」——按规则①，
    //   color 用正常亮度色调、intensity 压低到 0.14（最暗但能看清脚下路的下限）
    ambient: { color: 0xffdcb0, intensity: 0.14 },
    // 依据：hazards「恶心、偏执、头昏目眩、幻觉甚至昏迷」——持续性的精神侵蚀描述，参照"压抑"区间取 1.4
    sanityDrainMul: 1.4, hungerDrainMul: 1, audio: 'dark', darkness: true,
  },
  spawn() { return { x: SPAWN_X, y: 0, z: SPAWN_Z, yaw: Math.PI }; },   // 依据：entrances[0] 从 Level 1 的洞爬入，面朝房间深处
  buildChunk,
  // 依据：entityDensityOverall「none —— 正式条目没有任何实体」；entities[0]"橙色的光芒"页面明说
  //   "不是编号实体"、有无知觉都不清楚，不当作可刷的活体实体（已在地板异象里用灯光+提示表现）
  entities: [],
  items: [
    // 数值取自 data/item-spawn.json（levels 含 '19' 的条目）；cooked_gammon 该文件明确标了
    // levels: [] 不刷（备注：选中版本没提这道菜，未收录），因此不放进本表
    { type: 'almond_water', per1000m2: 1.2 },              // 用户规则：所有模式都刷杏仁水
    { type: 'almond_water_blue', per1000m2: 0.06 },
    { type: 'almond_water_green', per1000m2: 0.04 },
    { type: 'almond_water_red', per1000m2: 0.002 },
    { type: 'royal_rations', per1000m2: 0.01 },            // wikidot-cn：极稀有，随处可能出现
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },
    { type: 'canned_tuna', per1000m2: 0.6 },               // items[]「箱子里经常有可使用的食物」——满足用户"必刷食物"规则
    { type: 'water_bottle', per1000m2: 0.4 },              // items[]「叙事版本 4-6 在箱子里找到水瓶」
  ],
  exits: [
    { to: '38 / 202 / 432 / 654', kind: 'hole', note: '踩到不发光的裂缝地板随机掉落；四个目标都不在首期范围，做成 sealed 提示（exits[0]）' },
    { to: '-2 / 5 / 12 / 20', kind: 'door', note: '偶尔出现的破损/被毁坏的门，随机指向其一；-2 不在首期范围 sealed，5/12/20 是真实可用出口（exits[1]）' },
    { to: '40 / 212', kind: 'event', note: '箱子里的手持游戏机/小型街机会把人传送走（exits[2]）——未实现，见 apiRequests：物品系统没有"拾取后跨层传送"的钩子' },
    { to: '140', kind: 'zone', note: '在层级"被假定的边缘"经历强烈模糊与衰败（exits[3]）；140 不在首期范围，做成远离出生点的 sealed 大区（规则②）' },
  ],
  enter(ctx) {}, update(ctx, dt) {}, leave(ctx) {},
});
})();
