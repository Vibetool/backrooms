// Level 13 "The Boiling Frogs"
// 来源版本：wikidot-en   URL：https://backrooms-wiki.wikidot.com/level-13   许可：CC BY-SA 3.0
// 抓取：page revision 26（2026-08-22 编辑），backrooms-research/levels/level-13.json 的 wikidot-en 项
// 只按这个版本实现；wikidot-cn 是同一篇的译文（未采用其措辞差异），fandom 版《Vitrum Madness》是完全不同的设定
// （温室走廊、有毒植物、Phyllodoce vitrum 实体），conflicts 里列明，一律不借（WAVE2.md 第 1 节、用户规则：冲突只用选中版本）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- file:// 兜底（第 15 节）：双击打开 index.html 时贴图走程序化占位，避免洋红 ----------
BR.assets.registerProcedural('l13_wall_plaster', 256, (g, s) => {
  g.fillStyle = '#c6bca5'; g.fillRect(0, 0, s, s);
  const r = U.rng('l13_wall_plaster');
  for (let k = 0; k < 500; k++) {
    const v = 168 + (r() * 42 | 0);
    g.fillStyle = `rgba(${v},${v - 8},${v - 22},0.14)`;
    g.fillRect(r() * s, r() * s, 3, 3);
  }
});
BR.assets.registerProcedural('l13_floor_linoleum', 256, (g, s) => {
  g.fillStyle = '#8d7856'; g.fillRect(0, 0, s, s);
  const r = U.rng('l13_floor_linoleum');
  for (let k = 0; k < 420; k++) {
    const v = 108 + (r() * 50 | 0);
    g.fillStyle = `rgba(${v},${v - 16},${v - 36},0.16)`;
    g.fillRect(r() * s, r() * s, 4, 2);
  }
});

// ---------- 尺寸 ----------
// 依据：layout「迷宫式长走廊，两侧串联公寓单元」；scale 未给每层户数，取和 L0/L1 同级的紧凑公寓尺度
const SIZE = 24, N = 8, CELL = SIZE / N;
const H = 2.8;                         // 版本未给层高（unverified），用 kit 默认

// ---------- 布局 ----------
// 依据：architecture「布局完全杂乱无章」「走廊极其单调」；全层边界参数一致（第 7.2 节），公寓房间由 grid 的 room 机制承担
const EDGE = { salt: 'L13', boundaryDensity: 0.42, straightness: 0.74, minOpenings: 2 };
// pillarChance 改成 0（验收 medium：柱子立在走廊中间挡路，也让整层更像 Level 0 办公迷宫而不是公寓楼）
const MAZE = Object.assign({ wallDensity: 0.42, roomChance: 0.42, maxRooms: 2, roomSize: [2, 3], loopChance: 0.5, pillarChance: 0 }, EDGE);
const SPAWN_I = 3, SPAWN_J = 3;
// 墙厚：kit.gridWalls 不传 thickness 时的默认值 0.2×4/3（用户规则：墙厚全局已是原来的 4/3，本文件没有覆盖这个默认值）。
// 门脸贴面/门把手要知道墙面实际在哪（±T/2）才能贴到墙外面，而不是嵌进墙体看不见（验收 high①）
const WALL_HALF_T = 0.2 * 4 / 3 / 2;

function defineMaterials() {
  // 依据：materials「石膏以及层压木或油毡…墙面有涂漆，也有贴墙纸」；colors「暗淡的白色或米色」
  kit.mat('L13:wall', { tex: 'l13_wall_plaster', repeatMeters: 1.6, roughness: 0.92 });
  // 依据：exits[5]「切入漆色或墙纸比别处更深的黄色墙面到 Level 289」——同一张墙纸贴图整体调深黄，作为该特殊墙的材质
  kit.mat('L13:wall_yellow', { tex: 'l13_wall_plaster', repeatMeters: 1.6, roughness: 0.92, color: 0xc9a227 });
  kit.mat('L13:floor', { tex: 'l13_floor_linoleum', repeatMeters: 2.2, roughness: 0.85 });
  // 天花板未特别描述（unverified），复用现成吊顶纹理，不新开一张贴图（第 15 节预算）；
  // 套用 colors 已引用的墙面米白色调（0xd8cdb0 附近）给它上色，避免和 Level 0 灰色吊顶撞脸（验收 high②的次要证据之一）
  kit.mat('L13:ceil', { tex: 'ceiling_tile', repeatMeters: 1.3, roughness: 1, color: 0xdccdae });
}

// ---------- 小工具 ----------
// 房间四条边界上的格线（不管当前是墙还是开口），供 sealApartmentUnit 统一处理
function roomBoundaryEdges(g, room) {
  const { i, j, w, d } = room;
  return g.edges({ interior: true }).filter(e => {
    if (e.axis === 'h') return e.i >= i && e.i < i + w && (e.j === j || e.j === j + d);
    return e.j >= j && e.j < j + d && (e.i === i || e.i === i + w);
  });
}

// 把 grid.carve() 挖出来的开阔房间收成"四面有墙、只留一扇门"的公寓单元。
// 依据：architecture「20 世纪风格公寓楼」——公寓应该是独立房间而不是敞开的隔间；
// 验收 high②指出原来的房间是敞开区域、边界上多处豁口没有门，看起来像办公室隔断而不是公寓
function sealApartmentUnit(g, room, rng) {
  const bounds = roomBoundaryEdges(g, room);
  if (!bounds.length) return null;   // 房间贴住区块边界、没有可控的内部边界线（罕见），放弃处理，退化为原来的敞开房间
  const open = bounds.filter(e => !e.wall);
  let door;
  if (open.length) {
    door = open[Math.floor(rng() * open.length)];
  } else {
    // 极少数情况房间四周恰好全是墙：强行打开一条当门，否则房间进不去
    door = bounds[Math.floor(rng() * bounds.length)];
    g.setWall(door.axis, door.i, door.j, false);
  }
  for (const e of bounds) {
    if (e === door) continue;
    if (!e.wall) g.setWall(e.axis, e.i, e.j, true);   // 其余豁口补墙锁定，只留这一扇门（问题②"散落墙桩"的根因）
  }
  return door;
}

// 死胡同格子（三面墙、一面开口）的开口位置与朝向：局部 -Z 方向伸进死胡同内部。
// 用来摆楼梯间/电梯，让它们贴着这一个已经天然打通的口子放，不用另开墙、也不会探出这个格子的范围（验收 medium③④）
function deadEndDoorway(g, cell) {
  const w = g.walls(cell.i, cell.j), cw = g.cellW, cd = g.cellD;
  if (!w.n) return { x: (cell.i + 0.5) * cw, z: cell.j * cd, rot: Math.PI };
  if (!w.s) return { x: (cell.i + 0.5) * cw, z: (cell.j + 1) * cd, rot: 0 };
  if (!w.w) return { x: cell.i * cw, z: (cell.j + 0.5) * cd, rot: -Math.PI / 2 };
  return { x: (cell.i + 1) * cw, z: (cell.j + 0.5) * cd, rot: Math.PI / 2 };
}

// 走廊墙上的门脸贴面（大多数门背后没有真实房间，纯视觉——landmarks「两侧排列公寓门」）。
// 验收 high①：原来贴在墙的中轴面(z=0.011)上，被 0.267m 厚的墙体整个盖住看不见；
// 改成贴在墙面外侧两边（±(T/2+0.02)），两面都画，不管玩家在走廊哪一侧都看得到"这是一扇门"
function doorFace(b, ed) {
  const off = WALL_HALF_T + 0.02;
  b.push(ed.x, ed.z, ed.rot);
  for (const side of [1, -1]) {
    const face = side > 0 ? '+z' : '-z';
    b.plane(0, 0, off * side, 0.85, 2.02, 'kit:prop', { facing: face, color: 0x5c4c34 });   // 门板：y=0 贴地，高 2.02m 到顶
    b.box(0.32, 0.95, off * side + 0.03 * side, 0.05, 0.06, 0.05, 'kit:prop', { color: 0xb7a15a });   // 门把手，比门板再往外凸一点
  }
  b.pop();
}

// 房间几何中心（本地坐标），room 可以是 2×2 或 2×3（roomSize 配置）
function roomCenter(g, room) {
  return { x: (room.i + room.w / 2) * g.cellW, z: (room.j + room.d / 2) * g.cellD };
}

// 单人小沙发（kit 没有对应构件，照第 8 节末尾说明自己拼，走 'kit:prop' 顶点色）
// 依据：materials「一张略显破旧的单人小沙发」
function couch(b, x, z, rot, color) {
  b.push(x, z, rot);
  b.box(0, 0, 0, 0.75, 0.34, 0.68, 'kit:prop', { color });
  b.box(0, 0.34, -0.26, 0.75, 0.42, 0.14, 'kit:prop', { color: (color & 0xfefefe) - 0x080808 });
  b.pop();
}

// 老式电视（materials/mechanics「电视播放复古媒体流」）：机身 + 一块常亮的屏幕发光面
function television(b, x, z, rot) {
  b.push(x, z, rot);
  // 矮柜/支架：b.box 的 y 是底面高度（_TEMPLATE.md 第 8 节），原来写成 0.55 只垫出 0.55~0.69m 一小截，
  // 机身底部(0.62m)以下全空着，电视整个悬空（验收 medium）。改成从地面(0)一路顶到机身底部
  b.box(0, 0, 0, 0.2, 0.62, 0.2, 'kit:prop', { color: 0x2a2620 });
  const body = b.box(0, 0.62, 0, 0.58, 0.4, 0.42, 'kit:prop', { color: 0x1c1a17 });
  const screen = b.plane(0, 0.62, 0.211, 0.42, 0.28, 'kit:glow', { facing: '+z', uv: 'solid', color: [0.55, 0.68, 0.62], glow: 1.3 });
  b.pop();
  return { body, screen };
}

// 棋盘（exits[2] 专用，只出现在"自然生成、无人居住"的房间，人为摆放无效——这里就是层级自然生成，游戏里没有"人为摆放"的另一条路径，
// 因此天然满足"只有自然生成才触发"）：小方桌 8×8 黑白格贴面 + 两把椅子
function chessTable(b, x, z) {
  b.push(x, z, 0);
  b.box(0, 0, 0, 0.7, 0.68, 0.7, 'kit:prop', { color: 0x6a5638 });           // 桌腿/桌身
  const tile = 0.7 / 8;
  for (let ti = 0; ti < 8; ti++) for (let tj = 0; tj < 8; tj++) {
    const dark = (ti + tj) % 2 === 0;
    b.plane(-0.35 + tile * (ti + 0.5), 0.681, -0.35 + tile * (tj + 0.5), tile, tile, 'kit:prop',
      { facing: 'up', color: dark ? 0x2a2a2a : 0xd8d4c8 });
  }
  b.pop();
  kit.prop.chair(b, x - 0.55, z, Math.PI / 2, { color: 0x4a4438 });
  kit.prop.chair(b, x + 0.55, z, -Math.PI / 2, { color: 0x4a4438 });
}

// Level 283「Free Home Project」被摧毁后的残迹（hazards 附录「12% 被摧毁、41% 受损」；bases「已被摧毁」）
// 只摆静态废墟标记，不做交易/交互（用户规则：M.E.G./据点类只摆外观）
function ruin283(b, g, room) {
  const c = roomCenter(g, room);
  const rng2 = U.rng('L13-283-detail', room.i, room.j);   // 只用于摆放细节的位置抖动，不影响层级主流程 rng
  for (let k = 0; k < 4; k++) {
    const ang = rng2() * Math.PI * 2, rad = 0.4 + rng2() * 0.9;
    kit.prop.box(b, c.x + Math.cos(ang) * rad, c.z + Math.sin(ang) * rad, rng2() * Math.PI, { color: 0x3a352c, stack: rng2() < 0.4 ? 2 : 1 });
  }
  // 裂缝/烧痕近似：几块深色顶点色贴面覆盖在原墙面上（kit 没有裂纹贴图，用不规则暗斑近似"受损"）
  b.plane(c.x - 0.9, 1.1, c.z - 1.4, 1.1, 1.6, 'kit:prop', { facing: '+z', color: 0x1c1a16, glow: 0.6 });
  kit.prop.sign(b, c.x, c.z - 1.35, 0, { color: 0x805030, backColor: 0x1a1a1a });   // 无文字渲染能力，只能放一块牌子近似"283 号残迹标记"（见 apiRequests）
}

// =====================================================================
// 「补入口」批次新增（用户 2026-09-19）：Level ! 的感叹号门 + Level 21 的 Warp Tear。
// 两条都走独立派生流、只从上面没被用掉的 plain 墙段里挑位置，本层原有的出口/门脸/黄墙一条没动。
// =====================================================================
// 依据：level-run.json 的 wikidot-cn「尘封已久的感叹号…」entrances[1]「走进一扇画有感叹号符号的门，
//      资料说这是『进入该走廊最常规的方式之一』」——原文写任意层级都可能出现，本层照摆；罕见
const RUN_DOOR_CHANCE = 0.04;
// 依据：level-21.json 的 wikidot-en 版 entrances[0]「进入 Level 13 墙壁上的各种裂口（Warp Tears）」，
//      备注写明「Level 13 与本层之间的 Warp Tears 最稳定，且会发出高音尖啸」「这是本层的主要入口」。
//      既然是 Level 21 的主入口、原文又说是「各种裂口」（复数），按周期性可遇到的密度摆：
//      每块最多一处、约五分之一的区块有一处，出生点周围 3×3 块里基本找得到（硬规则：出口 3–5 块内可达）
const WARP_TEAR_CHANCE = 0.2;
const WHINE_RANGE = 20;               // 尖啸的出声半径（m）：更远处音量已经衰减到听不见，见 warpTear 里的说明
// 一块里独立的切出墙 mesh 到了这个数就不再摆裂隙（验收 minor）：本层每处黄墙 289 与每处裂隙各占一个独立 mesh
// （kit 的切出墙不进合并几何），基础 5 个 + 切出墙数 = 每块 mesh 数。黄墙本来就让少数区块到了 9–10 个、
// 超过模板建议的 ≤8，裂隙不该再往这些块上加——挑 ≤2 处黄墙的区块摆，裂隙块封顶 8 个 mesh，
// 9–10 个的区块回到加裂隙之前的样子。±8 共 289 块实测：闸上之前 mesh 分布 {5:59,6:80,7:77,8:48,9:17,10:8}、
// 超过 8 个的有 25 块，闸上之后 {5:59,6:80,7:77,8:54,9:14,10:5}、超过 8 个的 19 块，正好等于没有裂隙时的 HEAD 水平；
// 代价只是裂隙密度从 18.0% 的区块降到 14.9%，出生点 5×5 块内仍有 5 处，照样找得到
const TEAR_PATCH_BUDGET = 2;
const RUN_DOOR_COLOR = 0x23262a;      // 深炭灰铁门：本层墙是暗白/米色、公寓门是木色，这扇一眼就和周围不一样

// 感叹号门的门板标记：引擎没有文字渲染/贴花能力（见 apiRequests），用两块褪色小面片拼出 "!" 的形状。
// 坐标系与 kit.exit 建门时一致（门板中心在本地 x=0，板厚 0.045）；门嵌在打通的墙洞里，两面都画
function exclamationGlyph(b, x, z, rot) {
  const OFF = 0.045 / 2 + 0.008;
  const FADED = [0.55, 0.53, 0.47];
  b.push(x, z, rot);
  for (const s of [1, -1]) {
    b.box(0, 1.00, OFF * s, 0.085, 0.54, 0.006, 'kit:prop', { color: FADED });   // 竖杠
    b.box(0, 0.82, OFF * s, 0.085, 0.085, 0.006, 'kit:prop', { color: FADED });  // 点
  }
  b.pop();
}

// Warp Tear（空间裂隙）：拆掉一段墙，原位放一段会错位闪烁的切出墙（kind:'noclip'），
// 再在墙面两侧各画一道上下收窄的黑缝 + 冷白的边，看着像墙被撕开了一道口子。
// 面片全进已有的 kit:glow，不新建材质/mesh
function warpTear(b, g, ed) {
  g.setWall(ed.axis, ed.i, ed.j, false);   // 先拆真墙，否则切出墙背后还有一堵实心墙（第 9 节）
  const h = kit.exit(b, {
    to: '21', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H,
    // thickness 跟着本层墙厚（默认 0.2 会比两边的墙薄一截，裂口贴面也就贴不到墙面上）
    matKey: 'L13:wall', thickness: WALL_HALF_T * 2, glitch: 1.8, radius: 1.0,
    label: '墙上一道撕开的裂口，靠近时有高音尖啸 (level-21.json wikidot-en entrances[0]：Level 13 墙上的 Warp Tear)',
  });
  const off = WALL_HALF_T + 0.02;
  // [底边高, 高, 宽, 横向偏移]：宽窄不一、左右错开，看着像撕裂而不是一条灯管
  const SEGS = [[0.20, 0.44, 0.05, -0.04], [0.60, 0.42, 0.11, 0.01], [0.98, 0.48, 0.17, -0.02], [1.42, 0.40, 0.09, 0.04], [1.78, 0.34, 0.04, 0.01]];
  b.push(ed.x, ed.z, ed.rot);
  for (const s of [1, -1]) {
    const face = s > 0 ? '+z' : '-z';
    for (const seg of SEGS) {
      b.plane(seg[3], seg[0] - 0.015, off * s, seg[2] + 0.05, seg[1] + 0.03, 'kit:glow', { facing: face, uv: 'solid', color: [0.42, 0.66, 0.9] });   // 冷白的边
      b.plane(seg[3], seg[0], (off + 0.008) * s, seg[2], seg[1], 'kit:glow', { facing: face, uv: 'solid', color: 0 });                               // 裂口本身：全黑
    }
  }
  b.pop();
  // 依据：同一条 notes「会发出高音尖啸（high-pitched whine）」——用现有 'screech' 提高音调、压低音量间歇播放。
  // 频次（验收 minor）：改之前裂隙占 17% 的区块、游玩时同时载入 25 块 → 场上常有 4 处，每处 12–19 s 响一次，
  // 合起来平均 3.6 s 一声，太吵。两道闸一起收：
  //   ①间隔拉到 18–30 s；②只有玩家在 20 m 内才出声——音效是 inverse 距离模型（refDistance 1.6、rolloff 1.1、
  //     js/core/audio.js），20 m 外增益只剩 0.073×0.22 ≈ 0.016，本来就听不见，白占一条音轨。
  // 收完之后（并上 TEAR_PATCH_BUDGET 把密度压到 14.9%/块）：站在裂隙边上约 24 s 一声，
  // 在走廊里晃悠时 20 m 内平均只有 0.32 处裂隙 → 约 74 s 才听到一声
  const wp = b.world(ed.x, ed.z);
  const phase = (U.hashInts(b.seed, 'L13-whine', b.cx, b.cz) % 101) / 101;
  let next = 2 + phase * 7;
  b.update((dt, t) => {
    if (t < next) return;
    next = t + 18 + phase * 12;
    const p = BR.player;
    if (!p || U.dist2(p.x, p.z, wp.x, wp.z) > WHINE_RANGE * WHINE_RANGE) return;
    BR.audio.play('screech', { x: wp.x, y: 1.5, z: wp.z }, { volume: 0.22, rate: 1.7 });
  });
  return h;
}

// 在没被门脸/黄墙/保底门用掉的墙段里挑位置，摆这一批新增入口。
// 全程只用 levelSeed 派生流，不动本块 rng，原有内容逐字节不变
// patchWalls = 本块这一趟已经摆了几处黄墙 289（每处一个独立的切出墙 mesh），用来给裂隙让出 mesh 预算
function placeWiredEntrances(b, g, ctx, cx, cz, plainEdges, isSpawn, patchWalls) {
  if (isSpawn) return;
  // 楼梯/电梯占掉的死胡同格（已 reserve）两侧的墙段不碰：拆了会把它们那一格开成通路，改到已有地标的样子
  const edges = plainEdges.filter(e => e.axis === 'v'
    ? !g.isReserved(e.i - 1, e.j) && !g.isReserved(e.i, e.j)
    : !g.isReserved(e.i, e.j - 1) && !g.isReserved(e.i, e.j));
  if (!edges.length) return;
  let usedIdx = -1;
  const rr = U.rng(ctx.levelSeed, 'L13-run-door', cx, cz);
  if (rr() < RUN_DOOR_CHANCE) {
    usedIdx = Math.floor(rr() * edges.length);
    const ed = edges[usedIdx];
    g.setWall(ed.axis, ed.i, ed.j, false);   // 门要看得见就得先把这段墙拆掉（和本层保底门 exits[0] 同一套做法）
    kit.exit(b, {
      to: 'run', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal',
      label: '一扇和公寓门格格不入的深色铁门，门板上有个褪色、刮花的感叹号 (level-run.json wikidot-cn entrances[1])',
      door: { color: RUN_DOOR_COLOR, frameColor: 0x3a3e42, solid: false },
    });
    exclamationGlyph(b, ed.x, ed.z, ed.rot);
  }
  // mesh 预算闸（验收 minor）：黄墙已经占掉 >TEAR_PATCH_BUDGET 个独立切出墙 mesh 的区块不再摆裂隙，
  // 这些块本来就是 9–10 个 mesh 的那一小撮，加了裂隙只会更重。先抽数再判断，保持派生流的消耗次序稳定
  const wr = U.rng(ctx.levelSeed, 'L13-warp-tear', cx, cz);
  if (wr() < WARP_TEAR_CHANCE && patchWalls <= TEAR_PATCH_BUDGET) {
    const avail = edges.filter((e, i) => i !== usedIdx);
    if (avail.length) warpTear(b, g, avail[Math.floor(wr() * avail.length)]);
  }
}

// Michael Corvette 访谈彩蛋（他把玻璃杯砸向采访组）：门口散落的玻璃碎片，纯装饰，不做对话
function corvetteGlass(b, x, z, rot) {
  b.push(x, z, rot);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 0.6 - 0.3, r = 0.15 + (k % 3) * 0.1;
    b.box(Math.cos(a) * r, 0.01, 0.5 + Math.sin(a) * r * 0.4, 0.05, 0.01, 0.05, 'kit:prop', { color: 0xaeded4, rotY: a });
  }
  b.pop();
}

// ---------- 区块 ----------
// rng 消耗顺序固定：grid 内部生成 → 每个非出生间房间先固定抽 4 次、再由 sealApartmentUnit 固定抽 1 次选门 →
// 每段内部墙 1 次固定抽取 → 灯 → 楼梯/电梯一组固定抽取
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  const g = kit.grid(b, N, N, MAZE);
  if (isSpawn) { g.carve(SPAWN_I, SPAWN_J, 2, 2, { room: true }); g.reserve(SPAWN_I, SPAWN_J); }

  // ---------- 283 号残迹：宏格定位（不吃层级 rng，跨区块协调用派生流，第 4.2 节）----------
  const MX = 5;
  const mx = Math.floor(cx / MX), mz = Math.floor(cz / MX);
  const m283 = U.rng(ctx.levelSeed, 'L13-283', mx, mz);
  const has283 = m283() < 0.35;
  const h283x = mx * MX + Math.floor(m283() * MX), h283z = mz * MX + Math.floor(m283() * MX);
  const is283Chunk = has283 && cx === h283x && cz === h283z && !isSpawn;

  // Corvette 彩蛋：另一条独立派生流，出现概率更低
  const m277 = U.rng(ctx.levelSeed, 'L13-277', mx, mz);
  const has277 = m277() < 0.12;
  const h277x = mx * MX + Math.floor(m277() * MX), h277z = mz * MX + Math.floor(m277() * MX);
  const is277Chunk = has277 && cx === h277x && cz === h277z && !isSpawn;

  // ---------- 逐房间：家具 / 棋盘事件 / 公寓门（含隐藏在"普通门"里的出口）----------
  let usedChess = false, doorCount = 0;
  for (const room of g.rooms) {
    const isSpawnRoom = isSpawn && room.i === SPAWN_I && room.j === SPAWN_J;
    const c = roomCenter(g, room);

    // 固定顺序抽 4 个数，不管走哪条分支都要抽（第 4.2 节：先无条件取）
    const chessRoll = rng();
    const furnish = U.weighted(rng, [['living', 0.40], ['bedroom', 0.28], ['bathroom', 0.14], ['vacant', 0.18]]);
    const doorCat = U.weighted(rng, [['plain', 0.935], ['red275', 0.025], ['marked235', 0.02], ['group0', 0.015], ['group387', 0.005]]);
    const target0 = U.weighted(rng, [['0', 0.2], ['114', 0.2], ['327', 0.2], ['395', 0.2], ['410', 0.2]]);

    if (isSpawnRoom) continue;   // 出生间保持空旷，不额外摆家具/触发

    // 把这个房间收成"四面有墙、只留一扇门"的公寓单元，返回的门边全程复用（验收 high②）
    const doorEdge = sealApartmentUnit(g, room, rng);

    const isChess = !usedChess && chessRoll < 0.05;
    if (is283Chunk && room === g.rooms[0]) {
      ruin283(b, g, room);
    } else if (isChess) {
      usedChess = true;
      // 依据：mechanics「棋盘触发只对层级自然生成的布局有效…这种家具组合不会出现在已有人住的房间」——这里就是自然生成，房间不再放其他家具
      chessTable(b, c.x, c.z);
      if (doorEdge) kit.prop.door(b, doorEdge.x, doorEdge.z, doorEdge.rot, { style: 'wood', solid: false });
      kit.exit(b, { to: '157', kind: 'zone', x: c.x, z: c.z, radius: 0.6, marker: true, label: '房间自然生成了棋盘和两把椅子 (exits[2])' });
    } else if (furnish === 'living') {
      // 依据：architecture「最小户型是厨房与客厅合一的主房间」；items「电视」「厨房用具」；materials「圆桌配两把椅子」
      couch(b, c.x - 0.9, c.z + 0.9, Math.PI, 0x5a6a55);
      const tv = television(b, c.x - 0.9, c.z - 0.9, 0);
      kit.prop.cabinet(b, c.x + 1.0, c.z - 0.9, -Math.PI / 2, { kind: 'locker', w: 0.6, h: 1.5, d: 0.55, color: 0xdcdcd2 });   // 白色冰箱近似（kit 没有专门的冰箱构件）
      b.cylinder(c.x + 0.9, 0.7, c.z + 1.0, 0.42, 0.04, 'kit:prop', { segments: 10, color: 0x8a7350 });
      b.cylinder(c.x + 0.9, 0, c.z + 1.0, 0.05, 0.7, 'kit:prop', { segments: 6, color: 0x4a3f2c });
      kit.prop.chair(b, c.x + 0.4, c.z + 1.0, Math.PI / 2, {});
      kit.prop.chair(b, c.x + 1.4, c.z + 1.0, -Math.PI / 2, {});
      void tv;
      const wp = b.world(c.x - 0.9, c.z - 0.9);
      let tvPlayed = false;
      const phase = ((cx * 131 + cz * 977) >>> 0) % 23;
      b.update((dt, t) => { if (!tvPlayed && t > 2 + phase * 0.2) { BR.audio.play('static', { x: wp.x, y: 0.6, z: wp.z }, { volume: 0.3 }); tvPlayed = true; } });
    } else if (furnish === 'bedroom') {
      kit.prop.bed(b, c.x - 0.4, c.z + 0.6, 0, {});
      kit.prop.cabinet(b, c.x + 1.0, c.z - 0.8, -Math.PI / 2, { kind: 'wardrobe', w: 0.7, h: 1.9, d: 0.55 });
    } else if (furnish === 'bathroom') {
      kit.prop.cabinet(b, c.x - 0.9, c.z - 0.9, Math.PI / 2, { kind: 'file', w: 0.5, h: 0.9, d: 0.4, color: 0xe8e6de });
      kit.prop.puddle(b, c.x + 0.3, c.z + 0.4, 0, { rx: 0.4, rz: 0.3 });
    }
    // 'vacant'：依据 hazards「住满十年以上的长期住户有时会消失，房间随后空出」——刻意什么都不放

    if (doorEdge && !isChess) {
      const ed = doorEdge;
      doorCount++;
      // 门与出口以前各建一次（kit.exit(kind:'door') 内部会再建一扇默认木色实心门，_kit.js:1755-1756）：
      // 两扇门重叠 z-fight、颜色/sign 也套不上去，而且默认门带碰撞会把开口重新堵死（验收 high③）。
      // 改成只调用 kit.exit 一次，外观通过 o.door 子对象传进去，不再单独调 kit.prop.door
      if (doorCat === 'red275') {
        // 依据：colors「红色的门（通往 Level 275）」
        kit.exit(b, { to: '275', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, label: '红色的门 (exits[4])', door: { color: 0xb0302a, solid: false } });
      } else if (doorCat === 'marked235') {
        // 依据：landmarks「标有『235』的门」——kit 没有文字渲染能力，只能用 label 提示文字代替门上的字样（见 apiRequests）
        kit.exit(b, { to: '235', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, label: '门上刻着「235」(exits[3])', door: { solid: false, sign: 0xffcf4a } });
      } else if (doorCat === 'group0') {
        // 依据：exits[0] 备注「和通往普通走廊/房间的门样式不同，但同样毫不起眼」——同一批门(0/114/327/395/410)一律用金属门（用户规则同批已有 L1.js 的先例：
        // 沉闷但和木门区分开），不加发光牌，保持"毫不起眼"（验收 medium：这批门和普通公寓门长得一模一样，玩家找不到出口）
        kit.exit(b, { to: target0, kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '单调、不起眼的门 (exits[0])', door: { solid: false } });
      } else if (doorCat === 'group387') {
        kit.exit(b, { to: '387', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, label: '一扇普通公寓门 (exits[6]，几乎没有记录)', door: { solid: false } });
      } else {
        kit.prop.door(b, ed.x, ed.z, ed.rot, { style: 'wood', solid: false });   // 普通公寓门，不通向任何地方，纯装饰
      }
      if (is277Chunk && doorCount === 1) corvetteGlass(b, ed.x, ed.z, ed.rot);
    }
  }

  // ---------- 每三块一次的保底出口：保证范围内出口 (exits[0]→Level 0) 在任意位置 3 块以内可达（用户规则②）----------
  const forceDoorExit = ((cx % 3) + 3) % 3 === 1 && ((cz % 3) + 3) % 3 === 1 && !isSpawn;

  // ---------- 墙面：黄色特殊墙（切入到 289）与门脸装饰（走廊两侧排门的视觉，第 5 条问题）----------
  const wallEdges = g.edges({ wall: true, interior: true, unlocked: true });
  const plainEdges = [];   // 这一趟没被门脸/黄墙/保底门用掉的墙段，留给下面新增的感叹号门与 Warp Tear
  let patchWalls = 0;      // 本块摆了几处黄墙 289：每处一个独立的切出墙 mesh，下面的裂隙按它让预算
  wallEdges.forEach((ed, idx) => {
    const cat = U.weighted(rng, [['plain', 0.61], ['doorface', 0.35], ['yellow289', 0.04]]);
    const forced = forceDoorExit && idx === 0;
    if (forced) {
      // 覆盖为保底门（仍先正常抽数保持顺序，只是结果被覆盖，第 4.2 节允许——不影响其它 chunk 的抽取次数）
      // 同样只调一次 kit.exit（见上面 high③ 的说明），style 用 metal 和 group0 保持一致，方便玩家认出这批门
      g.setWall(ed.axis, ed.i, ed.j, false);
      kit.exit(b, { to: '0', kind: 'door', x: ed.x, z: ed.z, rot: ed.rot, style: 'metal', label: '单调、不起眼的门 (exits[0]，保底可达)', door: { solid: false } });
    } else if (cat === 'yellow289') {
      g.setWall(ed.axis, ed.i, ed.j, false);
      kit.exit(b, { to: '289', kind: 'noclip', x: ed.x, z: ed.z, rot: ed.rot, w: ed.len - 0.22, h: H, matKey: 'L13:wall_yellow', label: '颜色比别处更深黄的墙 (exits[5])' });
      patchWalls++;
    } else if (cat === 'doorface') {
      // 依据：landmarks「米色长走廊，两侧排列公寓门」——大多数门背后不建真实房间，画一块门脸贴面近似
      doorFace(b, ed);
    } else {
      plainEdges.push(ed);   // 'plain'：原来什么都不做，这里只是记下来，不改任何既有行为
    }
  });

  // ---------- 灯：稀疏荧光灯（image alt「sparse fluorescent lights」+ 正文「dimly lit」）----------
  for (let j = 0; j < N; j += 3) {
    for (let i = 0; i < N; i += 3) {
      const r = rng();
      const state = r < 0.12 ? 'broken' : r < 0.35 ? 'flicker' : 'on';
      const c = g.center(i, j);
      kit.prop.lightPanel(b, c.x, c.z, 0, { y: H, state, flicker: 0.3 + rng() * 0.4, intensity: 0.75, range: 6, color: 0xfff1d0 });
    }
  }

  // ---------- 楼梯/电梯地标 + 底层向下（Level 70/208）与罕见无止境向上（Level 280）----------
  // 依据：landmarks「楼梯很多，附近通常有电梯」；exits[1]「底层继续沿楼梯或电梯向下」；exits[7]「楼梯罕见地开始无止境向上」
  // 验收 medium③④：原来在任意非房间格子的正中央摆楼梯/电梯，不看该格子四面是否有墙——2.6m 深的楼梯间比 3m 的格子中心到边界(1.5m)还长，
  // 会穿墙探进相邻格子/区块；电梯又整体偏移 1.6m，越过格线卡进墙里。改成只挑"死胡同"格（三面墙、一面口）、贴着那唯一的开口摆，
  // -Z 方向正好扎进死胡同内部，既不用另开墙也不会探出这一个格子的范围；kind:'stairs' 的出口也不再重复建一次楼梯（同 high③ 的重复门问题）
  const stairsHas = rng() < 0.55;
  const stairsCat = U.weighted(rng, [['deco', 0.72], ['down', 0.22], ['endlessUp', 0.06]]);
  const downTarget = U.weighted(rng, [['70', 0.5], ['208', 0.5]]);
  const posRoll = rng();
  if (stairsHas && !isSpawn) {
    const deads = g.deadEnds();
    const cell = deads.length ? deads[Math.floor(posRoll * deads.length)] : null;
    if (cell) {
      const dw = deadEndDoorway(g, cell);
      g.reserve(cell.i, cell.j);
      if (stairsCat === 'down') {
        kit.exit(b, { to: downTarget, kind: 'stairs', x: dw.x, z: dw.z, rot: dw.rot, stairs: { down: true }, label: '楼梯继续向下 (exits[1])' });
      } else if (stairsCat === 'endlessUp') {
        kit.exit(b, { to: '280', kind: 'stairs', x: dw.x, z: dw.z, rot: dw.rot, stairs: { down: false }, label: '楼梯开始无止境地向上延伸 (exits[7])' });
      } else {
        const down = ((cx + cz) & 1) === 0;
        kit.prop.stairwell(b, dw.x, dw.z, dw.rot, { down });
        // 依据：landmarks「附近通常有电梯」——挑另一个死胡同格放电梯，同样贴着它自己的开口摆（不再用固定 1.6m 偏移越过墙）；
        // 只有一个死胡同可用时就不放电梯了，宁可缺一个地标也不要穿墙
        const other = deads.find(c2 => c2 !== cell);
        if (other) {
          const ew = deadEndDoorway(g, other);
          g.reserve(other.i, other.j);
          // 依据：hazards「电梯以及层内几乎所有东西运作都不稳定」——指示灯给红色暗示"不可用"，不接任何交互（引擎也没有电梯交互）
          kit.prop.elevator(b, ew.x, ew.z, ew.rot, { indicator: 0xff3020 });
        }
      }
    }
  }

  // ---------- 新增入口：Level ! 的感叹号门、Level 21 的 Warp Tear ----------
  // 放在最后、gridWalls 之前：只用 levelSeed 派生流不吃本块 rng，又排在楼梯/电梯挑死胡同之后，
  // 拆墙不会改变上面 g.deadEnds() 的结果，原有内容一字不变（第 9 节：gridWalls 之前必须做完 setWall）
  placeWiredEntrances(b, g, ctx, cx, cz, plainEdges, isSpawn, patchWalls);

  kit.gridWalls(b, g, { matKey: 'L13:wall', trim: { color: 0x6b5f48 } });
  kit.prop.floor(b, null, null, 0, { matKey: 'L13:floor' });
  kit.prop.ceiling(b, null, null, 0, { matKey: 'L13:ceil', y: H });

  kit.gridSpawns(b, g);
  return b.finish();
}

BR.levels.register({
  id: '13', name: 'Level 13', title: 'The Boiling Frogs', nickname: 'The Boiling Frogs',
  version: 'wikidot-en',
  survivalClass: '2e - Environmental（Unsafe / Secure / Non-Entity Hazards）',
  chunkSize: SIZE,
  env: {
    // 依据：colors「走廊漆成暗淡的白色或米色」——ambient.color 用正常亮度的暖米色，只靠 intensity 调暗，避免"整屏纯黑"（问题①）
    background: 0x1c1812, fogColor: 0x1c1812, fogNear: 6, fogFar: 40,
    ambient: { color: 0xd8cdb0, intensity: 0.18 },
    // 依据：landmarks 标签 homelike；正文强调「除自杀外死亡风险极低」，不是压抑型层级，san 掉速略低于基线
    sanityDrainMul: 0.9, hungerDrainMul: 1,
    audio: 'fluorescent', darkness: false,
  },
  spawn() { return { x: (SPAWN_I + 1) * CELL, y: 0, z: (SPAWN_J + 1) * CELL, yaw: 0 }; },
  buildChunk,
  // 依据：entities: []，entityDensityOverall「none — 正文未记载任何实体，生存难度标签为 Non-Entity Hazards」
  // 本批新实体 hunter / infecting_agent 在本层选中版本里都不出现，不涉及
  entities: [],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },     // 用户规则：所有模式都刷杏仁水
    // 依据：items「Pre-packaged microwavable meals (fridge restock)」——冰箱定期补给的预包装微波餐，直接对应 microwave_meal
    { type: 'microwave_meal', per1000m2: 0.6 },   // data/item-spawn.json perLevel 无覆盖，用其 per1000m2
  ],
  exits: [
    { to: '0', kind: 'door', note: '单调不起眼的门；同一门类还可能通往 114/327/395/410（都不在首期范围，sealed）(exits[0])，每 3×3 区块保底出现一处 + 房间门里概率出现' },
    { to: '70', kind: 'stairs', note: 'Level 70/208 不在首期范围：底层楼梯/电梯继续向下，只提示尚未开放 (exits[1])' },
    { to: '157', kind: 'zone', note: 'Level 157 不在首期范围：房间自然生成棋盘时触摸棋盘 (exits[2])' },
    { to: '235', kind: 'door', note: 'Level 235 不在首期范围：门上写着「235」(exits[3])，无文字渲染能力，用 label 提示代替' },
    { to: '275', kind: 'door', note: 'Level 275 不在首期范围：红色的门 (exits[4])' },
    { to: '289', kind: 'noclip', note: 'Level 289 不在首期范围：切入颜色更深黄的墙 (exits[5])' },
    { to: '387', kind: 'door', note: 'Level 387 不在首期范围：理论上任何公寓门都可能通往，几乎没有记录 (exits[6])' },
    { to: '280', kind: 'stairs', note: 'Level 280 不在首期范围：楼梯罕见地无止境向上延伸 (exits[7])' },
    // ---------- 「补入口」批次新增（用户 2026-09-19）：本层选中版本的 exits[] 里没有这两条，依据在对方层级的 entrances ----------
    { to: 'run', kind: 'door', note: '罕见（约 4% 的区块）：走廊上一扇深炭灰铁门，门板上有褪色刮花的感叹号；依据 level-run.json wikidot-cn entrances[1]「走进一扇画有感叹号符号的门…进入该走廊最常规的方式之一」（原文写任意层级都可能出现）' },
    { to: '21', kind: 'noclip', note: '约 20% 的区块：墙上一道撕开的裂口（Warp Tear），伴随高音尖啸；依据 level-21.json wikidot-en entrances[0]「进入 Level 13 墙壁上的各种裂口」，备注写明这是 Level 21 最稳定的主入口。Level 21 还没进 BR.LEVEL_ORDER 时 kit 自动 sealed，只提示尚未开放' },
  ],
  enter(ctx) {}, update(ctx, dt) {}, leave(ctx) {},
});
})();
