// 联机营地 coopcamp —— Level 1 某处一间四面封死的仓库间（隐藏层：不在 BR.LEVEL_ORDER，只能由联机流程点名开）
// 2026-10-03 N1，孩子原话：「找人联机后，两人会在一个营地，周围是 level1，被彻底围在一个房间里，会有个帐篷，
// 点进去后即可选择模式和层级，然后就能进去。」
//
// 布局（区块 (0,0)，区块本地坐标 = 世界坐标）：24×24 m 的房间（x、z 都在 4..28），3×3 个 8 m 柱间，用的全是 L1 自己的构件
// （BR.L1room：灰混凝土方柱、蓝立柱橙横梁的托盘货架、双管冷白吊灯、带墙裙和水渍的承重墙）。
//          西           北（窗）            东
//   北排： 堆垛        沿 x 的货架（帐篷后）  堆垛
//   中排： 沿 z 货架    营地（帐篷）          沿 z 货架
//   南排： 沿 z 货架    出生区（空着）         空地（两块空托盘 + 一摊水）
// 北、东、西三面墙各开两扇铁丝玻璃窗（1.6×1.0 m，窗台 2.3 m），抬头能看到墙外 Level 1 的柱子、货架和冷白灯；
// 窗外那三块（(-1,0)、(1,0)、(0,-1)）用 L1room walls:'none' 建离墙最近的一排柱、梁、吊灯、管道、货架，每块 ≤ 4000 面，
// 没有刷新点、实体、物资、出口；其余区块空着（b.finish()）。
// 营地中间一顶墙式帆布帐篷（BR.camp.tent，3.2×4.0 m，中心 (16, 15)，门朝南 z = 17）：里面两侧帆布墙边各铺一张防潮垫和睡袋、
// 后部一张地图桌（纸面留空，字和图由 js/game/coopcamp.js 贴 canvas）、屋脊下挂一盏马灯；门右边的前墙上夹一块小黑板（同上）。
// 门前留一条直通道（x 15.3..16.7、z 17..21.5，keepClear），通道西边两把折叠椅；出生点东北那根柱子 (20, 20) 朝西那面钉一排挂钩，
// 挂六件制服（颜色按 BR.SKINS 的顺序，从北往南）。不放水桶、背包、门前桌子和露营灯。
// 布局和游戏种子、画质都无关：builder 一律用固定的 CAMP_SEED；家具按固定面数入账（PRE_NOMINAL），货架额度只由种子决定。
// 没有 update：没有 L1 的断电、闪灯；环境 = L1 的（雾、冷白环境光、管道声），不掉 san、不饿。
// 交互（进帐篷、看地图、换制服）、小黑板和桌面纸的 canvas、倒数时马灯变暗，都在 js/game/coopcamp.js（BR.coopCamp），这里只出几何和数据：
//   b.data.coopcamp（世界坐标）= {
//     tent: { inside: {x0,z0,x1,z1}, door: {x, z, w, h}（门洞底边中点）, stand: [{x, z, yaw} ×2]（地图桌前两个站位，玩家 yaw 约定，面朝桌子）,
//             map: {x, y, z, w, d}（桌面纸的位置，y 已抬高 3 mm）, lantern: {x, y, z, li}（li = 这块 res.lights 里马灯的下标）},
//     board: {x, y, z, yaw, w, h}（小黑板板面中心，已在板面前 3 mm；yaw = PlaneGeometry 的 rotation.y，0 = 正面朝 +Z（南））,
//     hooks: {x, y, z, yaw, box: {x0,y0,z0,x1,y1,z1}, at: [z ×6]}（挂钩那排制服的中心；yaw 同上，−π/2 = 朝西；box 是准心射线用的包围盒；
//            at 是每件制服中心沿这一排的世界坐标，顺序同 skins，准心对准哪件换哪件）,
//     corridor: {x0, z0, x1, z1}, skins: [皮肤 key ×6]（挂钩从北往南的顺序）,
//     windows: [{side, at, w, y0, y1, line}]（墙上的窗：side 'n'|'e'|'w'，at 沿墙坐标，line 墙所在的 z（n）或 x（e/w））}
// 经典 <script>，只往 window.BR 上挂东西；依赖 _kit.js、_camp.js、L1.js（BR.L1room），排在 L1.js 之后。
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;
const R = BR.L1room;
const HALF_PI = Math.PI / 2;
if (!kit || !R || !BR.camp) { console.error('[coopcamp] 需要先加载 js/levels/_kit.js、_camp.js、L1.js'); return; }

// 营地布局和游戏种子无关：每一块都用这个固定种子建（L1 的私有函数照用 b.seed）
const CAMP_SEED = 20261002;
const SECTOR = 'yuejin';   // 「跃金段：更像仓库、照明更充足、板条箱数量远超其他地点」；柱子下段刷各色漆

const TENT = { x: 16, z: 15 };
const TENT_OPTS = { w: 3.2, d: 4.0, wall: 1.8, ridge: 2.7, doorW: 1.2, doorH: 2.0, cot: false, mapTable: true, lantern: true, flapRolled: true, board: 'right' };
const CORRIDOR = { x0: 15.3, z0: 17, x1: 16.7, z1: 21.5 };   // 门前通道
const AISLE = { x0: 15.2, z0: 13.1, x1: 16.8, z1: 17 };      // 帐篷中间过道（两张睡垫之间）
const SPAWN_SLOTS = [{ x: 15, y: 0, z: 21.2, yaw: 0 }, { x: 17, y: 0, z: 21.2, yaw: 0 }];
const SPAWN_KEEP_R = 0.55;   // 出生格周围拖东西不许停的半径（椅子外沿离格心 ≥ 0.55，人半径 0.3，回营地时不会落进椅子里）
const MATS = [{ x: 14.85, z: 14.6 }, { x: 17.15, z: 14.6 }];    // 防潮垫 + 睡袋（贴着两侧帆布墙，床头朝里面的地图桌那头）
const BAG_COL = [[0.16, 0.22, 0.4], [0.46, 0.17, 0.1]];         // 两只睡袋：藏青、铁锈红
const CHAIRS = [{ x: 13.5, z: 18.8 }, { x: 13.5, z: 19.8 }];    // 通道西边两把折叠椅，朝东
const HOOK_PILLAR = { x: 20, z: 20 };                           // 出生点东北那根柱子，挂钩钉在朝西那面
// 家具的账面面数（两种画质一样，实测见 tests/output/stage-N1/N1-camp）：帐篷 + 2 睡袋 + 2 椅子 + 挂钩
const PRE_NOMINAL = 1500;

// ---------- 营地家具 ----------
function sleepingBag(b, x, z, k) {
  const pad = [0.24, 0.3, 0.2], bag = BAG_COL[k % BAG_COL.length];
  const lining = [0.62, 0.6, 0.52], L = 2.0, Wd = 0.6;
  b.push(x, z, 0);
  b.prop({ kind: 'sleepingBag', label: '睡袋', draggable: true }, () => {
    // 防潮垫（2 cm 厚，比地布高 1 mm 起）
    b.box(0, 0.006, 0, Wd, 0.02, L, 'kit:prop', { color: pad, solid: false, faces: 'noBottom', uv: 'stretch' });
    // 睡袋：鼓起来的一长条，床头那端拉开一角、翻出浅色内衬
    const bw = Wd - 0.06, bl = L - 0.16, bh = 0.1, bz = 0.05;
    b.box(0, 0.026, bz, bw, bh, bl, 'kit:prop', { color: bag, solid: false, faces: 'noBottom', uv: 'stretch' });
    b.quad([-bw / 2 + 0.02, 0.026 + bh + 0.004, bz - bl / 2 + 0.05], [bw / 2 - 0.02, 0.026 + bh + 0.004, bz - bl / 2 + 0.05],
      [bw / 2 - 0.02, 0.026 + bh + 0.004, bz - bl / 2 + 0.3], [-bw / 2 + 0.02, 0.026 + bh + 0.004, bz - bl / 2 + 0.55], 'kit:prop', { color: lining });
    b.plane(bw / 2 + 0.002, 0.03, bz + 0.15, bl - 0.5, 0.012, 'kit:prop', { facing: '+x', color: [0.1, 0.1, 0.1], uv: 'stretch' });   // 侧面拉链
    // 床头一团卷起来的衣服当枕头
    b.box(0, 0.026 + bh, -L / 2 + 0.2, 0.36, 0.08, 0.22, 'kit:prop', { color: [0.42, 0.44, 0.38], solid: false, faces: 'noBottom', uv: 'stretch' });
    b.bedSpot({ x: 0, z: 0.05, yaw: Math.PI, h: 0.14, w: Wd - 0.06, l: L - 0.15, head: [0, -L / 2 + 0.25] });
    b.solid(-Wd / 2, 0, -L / 2, Wd / 2, 0.14, L / 2);   // 睡垫把人挡在离帆布墙 0.6 m 以外（侧墙只有 1.8 m 高，贴墙站镜头会穿出去）
  });
  b.pop();
}
function foldingChair(b, x, z, rot) {
  const frame = [0.2, 0.21, 0.22], seat = [0.3, 0.33, 0.28];
  b.push(x, z, rot);
  b.prop({ kind: 'chair', label: '折叠椅', draggable: true }, () => {
    b.box(0, 0.43, 0.02, 0.42, 0.03, 0.4, 'kit:prop', { color: seat, solid: false, uv: 'stretch' });
    b.box(0, 0.6, -0.205, 0.4, 0.24, 0.025, 'kit:prop', { color: seat, solid: false, uv: 'stretch' });
    for (const s of [-1, 1]) {
      BR.camp.rod(b, [s * 0.2, 0, -0.17], [s * 0.2, 0.86, -0.215], 0.012, frame);   // 后腿一直伸上去当靠背立杆
      BR.camp.rod(b, [s * 0.19, 0, 0.21], [s * 0.19, 0.43, 0.15], 0.012, frame);    // 前腿
    }
    b.box(0, 0.12, 0.19, 0.38, 0.018, 0.018, 'kit:prop', { color: frame, solid: false, uv: 'stretch', faces: ['py', 'ny', 'pz', 'nz'] });
    b.box(0, 0.12, -0.175, 0.4, 0.018, 0.018, 'kit:prop', { color: frame, solid: false, uv: 'stretch', faces: ['py', 'ny', 'pz', 'nz'] });
    b.seat({ x: 0, z: 0.02, yaw: Math.PI, h: 0.46 });
    b.solid(-0.23, 0, -0.24, 0.23, 0.88, 0.24);
  });
  b.pop();
}
function srgbLin(hex, k) {
  const ch = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [ch((hex >> 16) & 255) * k, ch((hex >> 8) & 255) * k, ch(hex & 255) * k];
}
// 制服挂钩：一条木挂板横钉在柱子朝西那面（比柱面宽，两头各伸出去 0.35 m），6 个钩子各挂一件叠好的防化服
function uniformHooks(b, pw) {
  const skins = (BR.SKINS || []).slice(0, 6);
  const fx = HOOK_PILLAR.x - pw / 2;
  const n = skins.length, sp = 0.22, half = (n - 1) * sp / 2;
  const uni = {};
  b.push(fx, HOOK_PILLAR.z, -HALF_PI);   // 本地 +z = 朝西（离开柱面），本地 +x = 朝南
  b.fixture({ kind: 'hooks', label: '制服挂钩' }, () => {
    b.box(0, 1.72, 0.0155, 2 * half + 0.3, 0.09, 0.025, 'kit:prop', { color: [0.46, 0.33, 0.2], solid: false, uv: 'stretch', faces: ['py', 'ny', 'px', 'nx', 'pz'] });
    for (const sx of [-1, 1]) b.box(sx * (2 * half + 0.3) / 2 * 0.86, 1.755, 0.029, 0.03, 0.03, 0.004, 'kit:prop', { color: [0.25, 0.25, 0.25], solid: false, uv: 'stretch', faces: ['pz'] });   // 两颗膨胀螺栓头
    skins.forEach((s, i) => {
      const hx = -half + i * sp, col = srgbLin(s.color, 1.15), dark = srgbLin(s.color, 0.75);
      b.box(hx, 1.728, 0.048, 0.014, 0.014, 0.04, 'kit:prop', { color: [0.2, 0.2, 0.2], solid: false, uv: 'stretch', faces: ['py', 'ny', 'px', 'nx', 'pz'] });   // 钩子
      // 这一件制服的几何件（钩子不算）：有人穿上这种颜色时 BR.coopCamp 把它们藏起来（Piece.setVisible），换下来再挂回去
      uni[s.key] = [
        b.box(hx, 1.02, 0.085, 0.2, 0.7, 0.056, 'kit:prop', { color: col, solid: false, uv: 'stretch', faces: ['py', 'px', 'nx', 'pz'] }),                   // 叠好的衣身
        b.box(hx, 1.72, 0.085, 0.13, 0.075, 0.052, 'kit:prop', { color: col, solid: false, uv: 'stretch', faces: ['py', 'px', 'nx', 'pz'] }),               // 兜帽（挂在钩上）
        b.plane(hx, 1.735, 0.1135, 0.08, 0.035, 'kit:prop', { facing: '+z', color: [0.08, 0.09, 0.1], uv: 'stretch' }),                                      // 面罩窗
        b.box(hx + 0.035, 1.24, 0.12, 0.075, 0.38, 0.012, 'kit:prop', { color: dark, solid: false, uv: 'stretch', faces: ['py', 'px', 'nx', 'pz'] }),       // 折过来的袖子
        b.plane(hx, 1.33, 0.1135, 0.2, 0.03, 'kit:prop', { facing: '+z', color: [0.1, 0.1, 0.1], uv: 'stretch' }),                                          // 腰上一道胶带
      ].filter(Boolean);
    });
    b.solid(-half - 0.16, 0.95, 0, half + 0.16, 1.85, 0.13);
  });
  b.pop();
  const c = b.world(fx - 0.085, HOOK_PILLAR.z), x0 = fx - 0.14 + b.ox, z0 = HOOK_PILLAR.z - half - 0.16 + b.oz;
  return {
    x: c.x, y: 1.4, z: c.z, yaw: -HALF_PI,
    box: { x0, y0: 0.95, z0, x1: fx + b.ox, y1: 1.85, z1: HOOK_PILLAR.z + half + 0.16 + b.oz },
    // 每件制服中心沿这一排的世界坐标（本地 +x = 朝南 = 世界 +z）：准心对准的是哪一件，就换哪一件（2026-10-05 返修 r2）
    at: skins.map((s, i) => HOOK_PILLAR.z + (-half + i * sp) + b.oz),
    skins: skins.map(s => s.key),
    pieces: uni,
  };
}

function campPre(b) {
  const L0 = b._lights.length;
  const t = BR.camp.tent(b, TENT.x, TENT.z, 0, TENT_OPTS);
  MATS.forEach((m, i) => sleepingBag(b, m.x, m.z, i));
  CHAIRS.forEach(c => foldingChair(b, c.x, c.z, HALF_PI));
  const hooks = uniformHooks(b, R.pillarW(SECTOR));
  const W = (x, z) => b.world(x, z);
  const rect = r => { const a = W(r.x0, r.z0), c = W(r.x1, r.z1); return { x0: a.x, z0: a.z, x1: c.x, z1: c.z }; };
  const li = t.lantern ? b._lights.indexOf(t.lantern.src) : -1;
  const door = W(t.door.x, t.door.z), map = W(t.table.x, t.table.z), lan = W(t.lantern.x, t.lantern.z), bd = W(t.board.x, t.board.z);
  // 每件制服的几何件（Piece，带 three 网格引用）：下划线开头、不进 coopcamp 数据，布局签名和 JSON 都不碰它
  b.data._uniforms = hooks.pieces;
  b.data.coopcamp = tidy({
    tent: {
      inside: rect(t.inside),
      door: { x: door.x, z: door.z, w: t.door.w, h: t.door.h },
      stand: t.stand.map(s => { const p = W(s.x, s.z); return { x: p.x, z: p.z, yaw: s.yaw }; }),
      map: { x: map.x, y: t.table.y, z: map.z, w: t.table.w, d: t.table.d },
      lantern: { x: lan.x, y: t.lantern.y, z: lan.z, li: li >= L0 ? li : -1 },
    },
    board: { x: bd.x, y: t.board.y, z: bd.z, yaw: t.board.rot, w: t.board.w, h: t.board.h },
    hooks: { x: hooks.x, y: hooks.y, z: hooks.z, yaw: hooks.yaw, box: hooks.box, at: hooks.at },
    corridor: rect(CORRIDOR),
    skins: hooks.skins,
    // 墙上的窗（玻璃 = at ± (w/2 − 0.05)，y0 + 0.05 .. y1 − 0.05，中间一根 4 cm 中挺；n/s 墙沿 x、e/w 墙沿 z）
    windows: CAMP_SPEC.windows.map(w => ({ side: w.side, at: w.at, w: w.w, y0: w.y0, y1: w.y1, line: { n: CAMP_SPEC.z0, s: CAMP_SPEC.z0 + 24, w: CAMP_SPEC.x0, e: CAMP_SPEC.x0 + 24 }[w.side] })),
  });
}
// 数据里的数字收到 0.1 mm（yaw 收到 1e-6）：JSON 干净，两端逐字节一样
function tidy(v, key) {
  if (typeof v === 'number') { const m = key === 'yaw' ? 1e6 : 1e4, r = Math.round(v * m) / m; return r === 0 ? 0 : r; }
  if (Array.isArray(v)) return v.map(x => tidy(x));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = tidy(v[k], k); return o; }
  return v;
}

// ---------- 区块 ----------
const CAMP_SPEC = {
  x0: 4, z0: 4, nx: 3, nz: 3, sector: SECTOR, orient: 'x', walls: 'ring',
  windows: [
    { side: 'n', at: 8, w: 1.6, y0: 2.3, y1: 3.3 }, { side: 'n', at: 24, w: 1.6, y0: 2.3, y1: 3.3 },
    { side: 'e', at: 8, w: 1.6, y0: 2.3, y1: 3.3 }, { side: 'e', at: 24.5, w: 1.6, y0: 2.3, y1: 3.3 },
    { side: 'w', at: 8, w: 1.6, y0: 2.3, y1: 3.3 }, { side: 'w', at: 24.5, w: 1.6, y0: 2.3, y1: 3.3 },
  ],
  bays: [
    { i: 0, j: 0, kind: 'stack' }, { i: 1, j: 0, kind: 'rack', orient: 'x' }, { i: 2, j: 0, kind: 'stack' },
    { i: 0, j: 1, kind: 'rack', orient: 'z' }, { i: 1, j: 1, kind: 'keep' }, { i: 2, j: 1, kind: 'rack', orient: 'z' },
    { i: 0, j: 2, kind: 'rack', orient: 'z' }, { i: 1, j: 2, kind: 'keep' }, { i: 2, j: 2, kind: 'open' },
  ],
  noLoot: true,
  keep: [{ x0: 12, z0: 12, x1: 20, z1: 28 }, CORRIDOR, AISLE],
  pre: campPre, preNominal: PRE_NOMINAL,
  budget: 7600,
};
// 窗外带：离墙最近的一排柱间（柱线离墙 8 m，正好是窗里抬头看得到的范围）。
// 北边那块：货架沿 z，吊灯挂在 x = 4 / 12 / 20 / 28 的柱线上（z = −8）；东西两块：货架沿 x（和墙垂直，从窗里看得到货架头），
// 吊灯挂在 z = 4 / 12 / 20 / 28 的梁下（x = 40 / −8）。东南、西南那两扇窗比墙段中点往南挪 0.5 m。
// 这样从两个出生格抬头，透过窗都看得到 ≥ 2 根柱子、≥ 2 盏亮着的灯（three 射线实测，tests/output/stage-N1/N1-camp/probe.mjs）：
//   (15, 21.2)：柱子 (4, −4)、(−4, 28)，灯 (4, −8)、(−8, 28)、(40, 28)
//   (17, 21.2)：柱子 (28, −4)、(−4, 28)、(36, 28)，灯 (28, −8)、(−8, 28)、(40, 28)
const BAND = { sector: SECTOR, walls: 'none', noLoot: true, budget: 3300, extra: 450 };
const COL3 = o => [0, 1, 2].map(j => ({ i: 0, j, kind: 'rack', orient: o }));   // 一列三个柱间（东西两块）
const BANDS = {
  '-1,0': Object.assign({ x0: 20, z0: 4, nx: 1, nz: 3, orient: 'x', bays: COL3('x') }, BAND),
  '1,0': Object.assign({ x0: 4, z0: 4, nx: 1, nz: 3, orient: 'x', bays: COL3('x') }, BAND),
  '0,-1': Object.assign({ x0: 4, z0: 20, nx: 3, nz: 1, orient: 'z', bays: [0, 1, 2].map(i => ({ i, j: 0, kind: 'rack', orient: 'z' })) }, BAND),
};

function buildChunk(ctx, cx, cz) {
  const b = kit.builder(Object.assign({}, ctx, { levelSeed: CAMP_SEED }), cx, cz, U.rng(CAMP_SEED, cx, cz), { height: R.height });
  if (cx === 0 && cz === 0) R.build(b, CAMP_SPEC);
  else if (BANDS[cx + ',' + cz]) R.build(b, BANDS[cx + ',' + cz]);
  return b.finish();
}

const rectCopy = r => ({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 });
BR.levels.register({
  id: 'coopcamp', name: '联机营地', title: 'Level 1 某处 · 一间封死的仓库',
  version: 'game',
  hidden: true,     // 不进任何层级列表（主页、帐篷、测试面板、工坊）
  lobby: true,      // 联机大厅：HUD 标签写「联机营地（Level 1 某处）」，不显示饥饿 / san / HP
  chunkSize: 32,
  env: Object.assign({}, R.env, { ambient: Object.assign({}, R.env.ambient), sanityDrainMul: 0, hungerDrainMul: 0 }),
  spawn() { const s = SPAWN_SLOTS[0]; return { x: s.x, y: s.y, z: s.z, yaw: s.yaw }; },
  // 两个出生格（面朝帐篷）：房主在第 0 格；客机落在离房主远、没被占的那格（js/net/coop.js sendWorld 挑）
  spawnSlots: SPAWN_SLOTS.map(s => Object.freeze(Object.assign({}, s))),
  // 拖东西不许停的地方（世界坐标）：门前通道、帐篷中间过道、两个出生格（2026-10-05 返修：椅子能拖到出生格上，
  // 回营地时房主直接出生在椅子里）。BR.world.blockers() 合进出口圈一起用
  keepClear: [rectCopy(CORRIDOR), rectCopy(AISLE)].concat(SPAWN_SLOTS.map(s => ({ x: s.x, z: s.z, r: SPAWN_KEEP_R, why: '出生的地方得空着' }))),
  buildChunk,
  entities: [],
  items: [],
  exits: [],
});
})();
