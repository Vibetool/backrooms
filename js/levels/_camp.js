// 营地构件 BR.camp：墙式帆布帐篷 tent、行军床 cot、营地范围 zone（2026-10-03 N1 联机营地先做；C1 的 NPC 营地直接沿用）
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js（BR.kit），排在 _kit.js 之后、各层级之前。
//
// 约定（和 kit 构件一样）：(x, z) 是构件在地面上的中心（调用时的当前坐标系），零件只进 'kit:prop' / 'kit:glow'，不新增材质；
// 只用 b.quad / b.box / b.plane / b.cylinder / b._piece 拼，不倒角、不贴花、不调 kit.prop.* —— 高低画质面数完全一样
// （联机两边画质可以不同，营地的货架额度要和画质无关，见 L1.js 的 BR.L1room）。
//
// tent(b, x, z, rot90, opts) → 局部坐标（调用时的当前坐标系）
//   { mouth: { x, z, yaw }（门外 0.6 m、面朝帐篷里，玩家 yaw 约定）, bed: { x, z, yaw } | null（有 cot 时）,
//     inside: { x0, z0, x1, z1 }（帆布墙以内）, stand: [{ x, z, yaw }, …]（mapTable 时：桌前左右两个站位，相隔 1.0 m，面朝桌子）,
//     table: { x, y, z, w, d } | null（桌面上留空的纸面矩形；y 已经比桌面高 3 mm，运行时纸面直接放在这）,
//     board: { x, y, z, rot, w, h } | null（门边小黑板的板面中心；rot 是 PlaneGeometry 的 rotation.y，0 = 正面朝 +Z；z 已在板面前 3 mm）,
//     lantern: { x, y, z, src } | null（马灯灯描述 src 的位置；src 是 b.light 返回的那份描述，改 intensity 灯和灯罩一起变暗），
//     door: { x, z, w, h, rot }（门洞底边中点；rot 同 board） }
//   rot90：转几个 90°（只能是整数倍：碰撞体全是轴对齐的），0 = 门朝 +Z。
//   opts 缺省是 C1 那顶小军帐：w 2.4（沿 x）、d 3.0（沿 z）、wall 1.4（侧墙高）、ridge 2.25（屋脊高）、doorW 1.1、doorH 1.75、
//   cot: true（里面一张 solid:false 的行军床）、glow: true（床头一个小电池灯，发光件不带灯描述）、
//   mapTable: false、lantern: false、flapRolled: false（门帘向两边掀开挂着；true = 卷成卷绑在门两边）、board: null（'right' | 'left'）。
//   结构：帆布用 b.quad 正反各画一遍（外面卡其、里面暗一档，里面那层往里错 4 mm，不共面）；四角立杆、两侧檐杆、
//   两头山墙用 A 字架（椽子）撑屋脊杆，门口不立中柱；地上铺地布；四角和拉绳压编织沙袋，不画地钉。
//   侧墙、后墙、门两边的前墙给轴对齐 b.solid（帆布 6 cm 厚），屋顶不给碰撞；沙袋有碰撞，拉绳没有。
//   帐篷本身不登记（结构，和墙一样拖不动）；地图桌是 b.fixture（kind 'mapTable'，没写 why：准心交互由层级自己出候选），
//   行军床是 b.prop（能拖，里面登记躺位）。
// cot(b, x, z, rot, opts) → { rec, bed: { x, z, yaw } }：行军床（铝管架 + 绷紧的帆布床面），solid:false（opts.solid: true 才给碰撞），
//   登记成道具「行军床」+ 一个躺位（床头在本地 −Z）。opts: { l = 1.9, w = 0.66, h = 0.42, color, frameColor }
// zone(b, spec) → 营地记录：按 C1 的营地数据格式写进 b.data.camps（坐标换成世界坐标，换算和 b.spawn 一样）。
//   spec: { shape: 'circle'|'rect', x, z, r | x0, z0, x1, z1, hub: { x, z }, rest: [{ x, z, yaw, pose: 'lie'|'sit', y, via: { x, z } }],
//           stroll: [{ x, z }], strollR, npcs: [1, 2], spawnBuffer = 8 }
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;
const HALF_PI = Math.PI / 2;

// ---------- 颜色（kit:prop 顶点色，线性值；有效底色 = 顶点色 × 0.8）----------
const COL = {
  canvas: [0.58, 0.5, 0.33],      // 卡其帆布外面
  canvasIn: [0.4, 0.35, 0.24],    // 里面暗一档（背光那面）
  seam: [0.44, 0.38, 0.25],       // 墙脚裙边、屋脊加强布、转角包边
  roll: [0.5, 0.43, 0.29],        // 卷起来的门帘（卷里是背面）
  ground: [0.17, 0.19, 0.15],     // 地布（深橄榄）
  pole: [0.48, 0.5, 0.5],         // 镀锌钢管
  rope: [0.64, 0.58, 0.44],
  bag: [0.74, 0.71, 0.6],         // 编织袋
  bagTie: [0.48, 0.43, 0.32],
  strap: [0.2, 0.2, 0.18],
  table: [0.3, 0.33, 0.22],       // 橄榄绿折叠桌面（纸面贴上去对比清楚）
  tableLeg: [0.26, 0.27, 0.27],
  lash: [0.56, 0.49, 0.33],
  lantern: [0.5, 0.1, 0.07],      // 红漆马灯
  lanternTop: [0.22, 0.22, 0.22],
  flame: [1.7, 1.3, 0.72],        // 灯罩（kit:glow：不吃光，亮度跟灯描述走）
  slate: [0.07, 0.1, 0.085],      // 小黑板
  frame: [0.5, 0.36, 0.22],
  clip: [0.16, 0.16, 0.17],
  cotFrame: [0.62, 0.64, 0.65],
  cotBed: [0.32, 0.36, 0.22],
  battery: [1.6, 1.5, 1.2],
};
const LANTERN = { color: 0xffd9a0, intensity: 0.7, range: 4 };

const TENT_DEF = {
  w: 2.4, d: 3.0, wall: 1.4, ridge: 2.25, doorW: 1.1, doorH: 1.75,
  cot: true, glow: true, mapTable: false, lantern: false, flapRolled: false, board: null,
};

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function sub(a, c) { return [a[0] - c[0], a[1] - c[1], a[2] - c[2]]; }
function cross(a, c) { return [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]]; }
function dot(a, c) { return a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ---------- 小零件 ----------
// 一块帆布：pts 四个角（当前坐标系 [x,y,z]），out 朝外方向。外面一层正面朝外，里面一层倒过来、往里错 4 mm
function cloth(b, pts, out, cOut, cIn) {
  const o = norm(out);
  let P = pts;
  if (dot(cross(sub(P[1], P[0]), sub(P[2], P[0])), o) < 0) P = P.slice().reverse();
  b.quad(P[0], P[1], P[2], P[3], 'kit:prop', { color: cOut });
  const k = 0.004, I = P.map(p => [p[0] - o[0] * k, p[1] - o[1] * k, p[2] - o[2] * k]).reverse();
  b.quad(I[0], I[1], I[2], I[3], 'kit:prop', { color: cIn });
}
// 贴在帆布外面的一条（裙边、加强布）：只画外面，往外错 3 mm
function patch(b, pts, out, col) {
  const o = norm(out);
  let P = pts.map(p => [p[0] + o[0] * 0.003, p[1] + o[1] * 0.003, p[2] + o[2] * 0.003]);
  if (dot(cross(sub(P[1], P[0]), sub(P[2], P[0])), o) < 0) P = P.reverse();
  b.quad(P[0], P[1], P[2], P[3], 'kit:prop', { color: col });
}
// 两点间的方截面细杆（帐篷杆、拉绳、马灯提梁）：4 个侧面 8 个三角形
function rod(b, p0, p1, r, color, key) {
  const d = norm(sub(p1, p0));
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = norm(cross(d, up)), c = cross(a, d);
  const P = (p, s, q) => [p[0] + (a[0] * s + c[0] * q) * r, p[1] + (a[1] * s + c[1] * q) * r, p[2] + (a[2] * s + c[2] * q) * r];
  const O = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  return b._piece(key || 'kit:prop', 0, 0, 0, 0, (v, t) => {
    for (let k = 0; k < 4; k++) {
      const s0 = O[k], s1 = O[(k + 1) % 4];
      const f = [P(p0, s0[0], s0[1]), P(p0, s1[0], s1[1]), P(p1, s1[0], s1[1]), P(p1, s0[0], s0[1])];
      let n = norm(cross(sub(f[1], f[0]), sub(f[2], f[0])));
      const mid = [(f[0][0] + f[2][0]) / 2, (f[0][1] + f[2][1]) / 2, (f[0][2] + f[2][2]) / 2];
      const ax = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      let F = f;
      if (dot(n, sub(mid, ax)) < 0) { F = f.slice().reverse(); n = [-n[0], -n[1], -n[2]]; }
      const b0 = k * 4;
      for (const p of F) v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
      t(b0, b0 + 1, b0 + 2); t(b0, b0 + 2, b0 + 3);
    }
  }, { color, uv: 'stretch', solid: false });
}
function dbox(b, x, y, z, w, h, d, color, faces, key) {
  return b.box(x, y, z, w, h, d, key || 'kit:prop', { color, solid: false, faces: faces || 'all', uv: 'stretch' });
}
// 编织沙袋：四周鼓出、顶上隆起的枕头形（12 个三角形）+ 扎口那头一圈绳。(x, z) 中心，长边沿本地 z
function sandbag(b, x, z, rot, solid) {
  const w = 0.3, d = 0.5, h = 0.15;
  b.push(x, z, rot || 0);
  const hw = w / 2, hd = d / 2, iw = hw * 0.8, id = hd * 0.82, hm = h * 0.62;
  const B = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  const T = [[-iw, hm, -id], [iw, hm, -id], [iw, hm, id], [-iw, hm, id]];
  const A = [[0, h, -hd * 0.45], [0, h, hd * 0.45]];
  b._piece('kit:prop', 0, 0, 0, 0, (v, t) => {
    let k = 0;
    const face = f => {
      let n = norm(cross(sub(f[1], f[0]), sub(f[2], f[0])));
      const c = f.reduce((s, p) => [s[0] + p[0] / f.length, s[1] + p[1] / f.length, s[2] + p[2] / f.length], [0, 0, 0]);
      let F = f;
      if (dot(n, sub(c, [0, h * 0.3, 0])) < 0) { F = f.slice().reverse(); n = [-n[0], -n[1], -n[2]]; }
      for (const p of F) v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
      for (let i = 1; i + 1 < F.length; i++) t(k, k + i, k + i + 1);
      k += F.length;
    };
    for (let q = 0; q < 4; q++) face([B[q], B[(q + 1) % 4], T[(q + 1) % 4], T[q]]);
    face([T[0], T[1], A[0]]); face([T[2], T[3], A[1]]);
    face([T[1], T[2], A[1], A[0]]); face([T[3], T[0], A[0], A[1]]);
  }, { color: COL.bag, uv: 'stretch', solid: false });
  dbox(b, 0, 0.012, hd - 0.06, w * 0.72, 0.075, 0.025, COL.bagTie, ['py', 'px', 'nx', 'pz', 'nz']);   // 扎口
  if (solid) b.solid(-hw, 0, -hd, hw, h, hd);
  b.pop();
}

// ---------- 帐篷 ----------
const ROT4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // cos、sin（rot = q·90°），避免三角函数的 1e-17 误差进返回值
function tent(b, x, z, rot90, opts) {
  const o = Object.assign({}, TENT_DEF, opts || {});
  const q = (((rot90 | 0) % 4) + 4) % 4, rot = q * HALF_PI, cs = ROT4[q][0], sn = ROT4[q][1];
  const W = Math.max(1.6, num(o.w, 2.4)), D = Math.max(1.6, num(o.d, 3.0));
  const hw = W / 2, hd = D / 2, EH = Math.max(1, num(o.wall, 1.4)), RH = Math.max(EH + 0.2, num(o.ridge, 2.25));
  const gy = ax => EH + (RH - EH) * (1 - Math.min(1, Math.abs(ax) / hw));   // 山墙顶边在本地 x 处的高度
  const dw = Math.max(0.6, Math.min(num(o.doorW, 1.1), W - 0.8)), dx = dw / 2;
  const dh = Math.max(1.2, Math.min(num(o.doorH, 1.75), gy(dx) - 0.12));
  const cO = o.color != null ? o.color : COL.canvas, cI = o.colorIn != null ? o.colorIn : COL.canvasIn;
  const out = { mouth: null, bed: null, inside: null, stand: [], table: null, board: null, lantern: null, door: null };
  b.push(x, z, rot);

  // ① 帆布：两侧墙、后山墙（中线两块，顶边就是屋面）、前山墙（门洞两边 + 门洞上面）、两坡屋面（四周出檐）
  for (const s of [-1, 1]) cloth(b, [[s * hw, 0, -hd], [s * hw, 0, hd], [s * hw, EH, hd], [s * hw, EH, -hd]], [s, 0, 0], cO, cI);
  cloth(b, [[-hw, 0, -hd], [0, 0, -hd], [0, RH, -hd], [-hw, EH, -hd]], [0, 0, -1], cO, cI);
  cloth(b, [[0, 0, -hd], [hw, 0, -hd], [hw, EH, -hd], [0, RH, -hd]], [0, 0, -1], cO, cI);
  cloth(b, [[-hw, 0, hd], [-dx, 0, hd], [-dx, gy(dx), hd], [-hw, EH, hd]], [0, 0, 1], cO, cI);
  cloth(b, [[dx, 0, hd], [hw, 0, hd], [hw, EH, hd], [dx, gy(dx), hd]], [0, 0, 1], cO, cI);
  cloth(b, [[-dx, dh, hd], [0, dh, hd], [0, RH, hd], [-dx, gy(dx), hd]], [0, 0, 1], cO, cI);
  cloth(b, [[0, dh, hd], [dx, dh, hd], [dx, gy(dx), hd], [0, RH, hd]], [0, 0, 1], cO, cI);
  const ov = 0.1, go = 0.06, ey = EH - ov * (RH - EH) / hw;
  for (const s of [-1, 1]) {
    cloth(b, [[s * (hw + ov), ey, -hd - go], [0, RH, -hd - go], [0, RH, hd + go], [s * (hw + ov), ey, hd + go]], [s * (RH - EH), hw, 0], cO, cI);
    // 屋脊加强布（顺坡 12 cm）
    const L = Math.hypot(hw, RH - EH), t = 0.12 / L;
    patch(b, [[0, RH, -hd - go], [s * hw * t, RH - (RH - EH) * t, -hd - go], [s * hw * t, RH - (RH - EH) * t, hd + go], [0, RH, hd + go]], [s * (RH - EH), hw, 0], COL.seam);
  }
  // 墙脚裙边（16 cm）、侧墙四个转角包边
  const SK = 0.16;
  for (const s of [-1, 1]) {
    patch(b, [[s * hw, 0.005, -hd], [s * hw, 0.005, hd], [s * hw, SK, hd], [s * hw, SK, -hd]], [s, 0, 0], COL.seam);
    for (const e of [-1, 1]) patch(b, [[s * hw, SK, e * hd], [s * hw, SK, e * (hd - 0.07)], [s * hw, EH, e * (hd - 0.07)], [s * hw, EH, e * hd]], [s, 0, 0], COL.seam);
  }
  // 帆布是一幅幅缝起来的：两侧墙和屋面每隔约 1 m 一道竖缝（缝线比帆布暗一点、2.5 cm 宽），后山墙中间一道
  // （屋面的缝停在屋脊加强布下沿：两层贴片不叠在同一平面上）
  const nSeam = Math.max(1, Math.round(D / 1.0)), sw = 0.0125, tr = 0.12 / Math.hypot(hw, RH - EH);
  for (let k = 1; k < nSeam; k++) {
    const zz = -hd + D * k / nSeam;
    for (const s of [-1, 1]) {
      const rx = s * hw * tr, ry = RH - (RH - EH) * tr;
      patch(b, [[s * hw, SK, zz - sw], [s * hw, SK, zz + sw], [s * hw, EH, zz + sw], [s * hw, EH, zz - sw]], [s, 0, 0], COL.seam);
      patch(b, [[s * (hw + ov), ey, zz - sw], [s * (hw + ov), ey, zz + sw], [rx, ry, zz + sw], [rx, ry, zz - sw]], [s * (RH - EH), hw, 0], COL.seam);
    }
  }
  patch(b, [[-sw, SK, -hd], [sw, SK, -hd], [sw, RH - 0.02, -hd], [-sw, RH - 0.02, -hd]], [0, 0, -1], COL.seam);
  patch(b, [[-hw, 0.005, -hd], [hw, 0.005, -hd], [hw, SK, -hd], [-hw, SK, -hd]], [0, 0, -1], COL.seam);
  for (const s of [-1, 1]) patch(b, [[s * hw, 0.005, hd], [s * dx, 0.005, hd], [s * dx, SK, hd], [s * hw, SK, hd]], [0, 0, 1], COL.seam);
  // 地布
  b.plane(0, 0.005, 0, W - 0.06, D - 0.06, 'kit:prop', { color: COL.ground, uv: 'world' });

  // ② 门帘：卷成卷绑在门两边（flapRolled），或者向两边掀开、斜挂在前墙上
  for (const s of [-1, 1]) {
    if (o.flapRolled) {
      const rx = s * (dx + 0.085), rz = hd + 0.08;
      b.cylinder(rx, 0.06, rz, 0.075, dh - 0.02, 'kit:prop', { segments: 8, color: COL.roll, solid: false, uv: 'stretch' });
      for (const ty of [0.5, dh - 0.4]) b.cylinder(rx, ty, rz, 0.083, 0.03, 'kit:prop', { segments: 8, caps: false, color: COL.strap, solid: false, uv: 'stretch' });
    } else {
      // 掀开的门帘：从门洞上沿垂到地、外沿斜到前墙外 0.35 m 处（正反两面）
      cloth(b, [[s * dx, dh, hd + 0.01], [s * (dx + 0.45), dh * 0.92, hd + 0.01], [s * (dx + 0.5), 0.02, hd + 0.12], [s * dx, 0.02, hd + 0.03]], [0, 0, 1], COL.roll, cI);
    }
  }

  // ③ 骨架：四角立杆、两侧檐杆、两头 A 字椽子（d ≥ 3.5 时中间再一对）、屋脊杆；门口不立中柱
  const pr = 0.022, ins = 0.04;
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) rod(b, [s * (hw - ins), 0, e * (hd - ins)], [s * (hw - ins), EH - 0.02, e * (hd - ins)], pr, COL.pole);
    rod(b, [s * (hw - ins), EH - 0.04, -hd + ins], [s * (hw - ins), EH - 0.04, hd - ins], pr, COL.pole);
    const rz = D >= 3.5 ? [-hd + ins, 0, hd - ins] : [-hd + ins, hd - ins];
    for (const zz of rz) rod(b, [s * (hw - ins), EH - 0.04, zz], [0, RH - 0.06, zz], pr, COL.pole);
  }
  rod(b, [0, RH - 0.06, -hd + ins], [0, RH - 0.06, hd - ins], pr * 1.15, COL.pole);

  // ④ 沙袋：四角压墙脚，两侧拉绳（每侧两根）拴在沙袋上
  for (const s of [-1, 1]) for (const e of [-1, 1]) sandbag(b, s * (hw + 0.17), e * (hd - 0.22), 0, true);
  const gz = [-hd * 0.6, hd * 0.6];
  for (const s of [-1, 1]) {
    for (const zz of gz) {
      rod(b, [s * (hw + ov - 0.015), ey - 0.01, zz], [s * (hw + 0.92), 0.11, zz], 0.005, COL.rope);
      sandbag(b, s * (hw + 1.02), zz, HALF_PI, true);
    }
  }

  // ⑤ 碰撞：两侧墙、后墙、门两边的前墙（帆布 6 cm 厚）；屋顶不给
  b.solid(-hw - 0.03, 0, -hd, -hw + 0.03, EH, hd);
  b.solid(hw - 0.03, 0, -hd, hw + 0.03, EH, hd);
  b.solid(-hw, 0, -hd - 0.03, hw, RH, -hd + 0.03);
  b.solid(-hw, 0, hd - 0.03, -dx, gy(dx), hd + (o.flapRolled ? 0.16 : 0.03));
  b.solid(dx, 0, hd - 0.03, hw, gy(dx), hd + (o.flapRolled ? 0.16 : 0.03));

  // ⑥ 地图桌（后部，1.4 × 0.6；两条后腿绑在后墙的两根立杆上）+ 桌前两个站位
  let tableZ = null;
  if (o.mapTable) {
    const TW = 1.4, TD = 0.6, TH = 0.74, tz = -hd + 0.06 + TD / 2;
    tableZ = tz;
    const ux = TW / 2 + 0.06;
    for (const s of [-1, 1]) rod(b, [s * ux, 0, -hd + ins], [s * ux, gy(ux) - 0.07, -hd + ins], pr, COL.pole);   // 后墙立杆（顶着椽子）
    b.fixture({ kind: 'mapTable', label: '地图桌' }, () => {
      dbox(b, 0, TH, tz, TW, 0.03, TD, COL.table);
      dbox(b, 0, TH - 0.07, tz, TW - 0.08, 0.07, TD - 0.06, COL.tableLeg, ['ny', 'px', 'nx', 'pz', 'nz']);   // 桌裙（折叠桌的钢框）
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * (TW / 2 - 0.05), lz = tz + sz * (TD / 2 - 0.05);
          dbox(b, lx, 0, lz, 0.03, TH - 0.07, 0.03, COL.tableLeg, 'sides');
          dbox(b, lx, 0, lz, 0.045, 0.012, 0.045, COL.tableLeg, ['py', 'px', 'nx', 'pz', 'nz']);   // 脚垫
        }
        rod(b, [sx * (TW / 2 - 0.05), 0.15, tz - TD / 2 + 0.05], [sx * (TW / 2 - 0.05), 0.15, tz + TD / 2 - 0.05], 0.009, COL.tableLeg);   // 两腿间横撑
        // 后腿和立杆用麻绳捆两道
        for (const ly of [0.28, 0.58]) dbox(b, sx * (TW / 2 + 0.005), ly, -hd + 0.07, 0.13, 0.03, 0.08, COL.lash, ['py', 'ny', 'px', 'nx', 'pz', 'nz']);
      }
      b.solid(-TW / 2, 0, tz - TD / 2, TW / 2, TH + 0.03, tz + TD / 2);
    });
    out.table = { x: 0, y: TH + 0.03 + 0.003, z: tz, w: TW - 0.1, d: TD - 0.1 };
    const sz = tz + TD / 2 + 0.42;
    out.stand = [{ x: -0.5, z: sz, yaw: 0 }, { x: 0.5, z: sz, yaw: 0 }];
  }

  // ⑦ 马灯：屋脊下、地图桌正上方（没有桌就在中间），一根细绳挂在屋脊杆上
  if (o.lantern) {
    const lz = tableZ != null ? tableZ : 0, yc = Math.min(RH - 0.75, 1.95), ytop = RH - 0.06 - pr * 1.15;
    b.cylinder(0, yc - 0.13, lz, 0.072, 0.07, 'kit:prop', { segments: 8, color: COL.lantern, solid: false, uv: 'stretch' });     // 油壶
    const globe = b.cylinder(0, yc - 0.06, lz, 0.05, 0.13, 'kit:glow', { segments: 8, caps: false, color: COL.flame, solid: false, uv: 'solid' });
    for (let k = 0; k < 4; k++) {
      const a = (k + 0.5) / 4 * Math.PI * 2;
      rod(b, [Math.sin(a) * 0.066, yc - 0.06, lz + Math.cos(a) * 0.066], [Math.sin(a) * 0.058, yc + 0.07, lz + Math.cos(a) * 0.058], 0.004, COL.lantern);   // 护丝
    }
    b.cylinder(0, yc + 0.07, lz, 0.065, 0.06, 'kit:prop', { rTop: 0.03, segments: 8, color: COL.lantern, solid: false, uv: 'stretch' });   // 顶罩
    for (const s of [-1, 1]) rod(b, [s * 0.065, yc + 0.06, lz], [0, yc + 0.21, lz], 0.004, COL.lanternTop);   // 提梁
    rod(b, [0, yc + 0.21, lz], [0, ytop, lz], 0.004, COL.rope);
    const src = b.light({ x: 0, z: lz, y: yc, color: LANTERN.color, intensity: LANTERN.intensity, range: LANTERN.range });
    src.onIntensity = LANTERN.intensity;
    // 灯罩亮度跟着灯描述的 intensity 成比例变（倒数时一拍暗一下、出发时熄灭）；linkGlow 只认开 / 关，所以自己跟
    let last = -1;
    b.update(() => {
      const k = Math.max(0.06, Math.min(1, (src.intensity > 0 ? src.intensity : 0) / LANTERN.intensity));
      if (Math.abs(k - last) < 0.02) return;
      last = k;
      globe.setColor(COL.flame, k);
    });
    out.lantern = { x: 0, y: yc, z: lz, src };
  }

  // ⑧ 门边小黑板（夹在门右边 / 左边的前墙上，0.8 × 0.6 的板框；字由运行时的 canvas 贴图画）
  if (o.board === 'right' || o.board === 'left') {
    const s = o.board === 'right' ? 1 : -1;
    const BW = 0.8, BH = 0.6, FW = 0.04, T = 0.018;
    // 板框离门边 ≥ 0.17 m（让开卷起来的门帘），离帐篷转角 ≥ 2 cm
    const bx = s * Math.min(dx + 0.17 + BW / 2, hw - 0.02 - BW / 2), by = Math.min(1.3, gy(Math.abs(bx) + BW / 2) - BH / 2 - 0.05), bz = hd + 0.012;
    dbox(b, bx, by - (BH - 2 * FW) / 2 - 0.005, bz + 0.004, BW - 2 * FW + 0.01, BH - 2 * FW + 0.01, 0.008, COL.slate, ['pz']);
    dbox(b, bx, by + BH / 2 - FW, bz + T / 2, BW, FW, T, COL.frame, ['py', 'ny', 'px', 'nx', 'pz']);
    dbox(b, bx, by - BH / 2, bz + T / 2, BW, FW, T, COL.frame, ['py', 'ny', 'px', 'nx', 'pz']);
    for (const e of [-1, 1]) dbox(b, bx + e * (BW / 2 - FW / 2), by - BH / 2 + FW, bz + T / 2, FW, BH - 2 * FW, T, COL.frame, ['px', 'nx', 'pz']);
    for (const e of [-1, 1]) dbox(b, bx + e * 0.25, by + BH / 2 - 0.05, bz + T - 0.004, 0.05, 0.09, 0.012, COL.clip, ['py', 'px', 'nx', 'pz']);   // 夹子
    out.board = { x: bx, y: by, z: bz + 0.008 + 0.003, rot: 0, w: BW - 2 * FW, h: BH - 2 * FW };
  }

  // ⑨ 行军床 + 床头小电池灯（C1 那顶）
  if (o.cot) {
    const cx = -(hw - 0.5), cz = -0.1;
    const c = cot(b, cx, cz, 0, { l: Math.min(1.9, D - 0.4) });
    out.bed = c.bed;
    if (o.glow) {
      dbox(b, cx + 0.42, 0.005, -hd + 0.35, 0.09, 0.12, 0.09, COL.tableLeg, ['py', 'px', 'nx', 'pz', 'nz']);
      dbox(b, cx + 0.42, 0.125, -hd + 0.35, 0.07, 0.05, 0.07, COL.battery, ['py', 'px', 'nx', 'pz', 'nz'], 'kit:glow');
    }
  }
  b.pop();

  // ---------- 返回值：换回调用时的坐标系 ----------
  const P = (lx, lz) => ({ x: x + cs * lx + sn * lz, z: z - sn * lx + cs * lz });
  const PY = (a, yaw) => { const p = P(a.x, a.z); return { x: p.x, z: p.z, yaw: yaw + rot }; };
  const R = (a0, b0, a1, b1) => {
    const p = P(a0, b0), r2 = P(a1, b1);
    return { x0: Math.min(p.x, r2.x), z0: Math.min(p.z, r2.z), x1: Math.max(p.x, r2.x), z1: Math.max(p.z, r2.z) };
  };
  const res = {
    mouth: PY({ x: 0, z: hd + 0.6 }, 0),
    bed: out.bed ? PY(out.bed, out.bed.yaw) : null,
    inside: R(-hw + 0.05, -hd + 0.05, hw - 0.05, hd - 0.05),
    stand: out.stand.map(s => PY(s, s.yaw)),
    table: null, board: null, lantern: null,
    door: Object.assign(P(0, hd), { w: dw, h: dh, rot }),
  };
  if (out.table) { const p = P(out.table.x, out.table.z); res.table = { x: p.x, y: out.table.y, z: p.z, w: q % 2 ? out.table.d : out.table.w, d: q % 2 ? out.table.w : out.table.d }; }
  if (out.board) { const p = P(out.board.x, out.board.z); res.board = { x: p.x, y: out.board.y, z: p.z, rot, w: out.board.w, h: out.board.h }; }
  if (out.lantern) { const p = P(out.lantern.x, out.lantern.z); res.lantern = { x: p.x, y: out.lantern.y, z: p.z, src: out.lantern.src }; }
  return res;
}

// ---------- 行军床：铝管架 + 绷紧的帆布床面 + 两对 X 形折叠腿（solid:false：人可以从旁边挤过去、也能躺上去）----------
function cot(b, x, z, rot, opts) {
  const o = opts || {};
  const L = num(o.l, 1.9), Wd = num(o.w, 0.66), Hh = num(o.h, 0.42);
  const fc = o.frameColor != null ? o.frameColor : COL.cotFrame, bc = o.color != null ? o.color : COL.cotBed;
  b.push(x, z, rot || 0);
  let bed = null;
  const rec = b.prop({ kind: 'cot', label: '行军床' }, () => {
    for (const s of [-1, 1]) rod(b, [s * Wd / 2, Hh, -L / 2], [s * Wd / 2, Hh, L / 2], 0.014, fc);         // 两根边管
    for (const e of [-1, 1]) rod(b, [-Wd / 2, Hh, e * L / 2], [Wd / 2, Hh, e * L / 2], 0.012, fc);         // 两头横管
    // 床面：中间微微下垂（两块斜面）
    const sag = 0.025;
    b.quad([-Wd / 2 + 0.01, Hh + 0.004, -L / 2 + 0.02], [0, Hh - sag, -L / 2 + 0.02], [0, Hh - sag, L / 2 - 0.02], [-Wd / 2 + 0.01, Hh + 0.004, L / 2 - 0.02], 'kit:prop', { color: bc });
    b.quad([0, Hh - sag, -L / 2 + 0.02], [Wd / 2 - 0.01, Hh + 0.004, -L / 2 + 0.02], [Wd / 2 - 0.01, Hh + 0.004, L / 2 - 0.02], [0, Hh - sag, L / 2 - 0.02], 'kit:prop', { color: bc });
    b.quad([-Wd / 2 + 0.01, Hh - 0.002, L / 2 - 0.02], [0, Hh - sag - 0.006, L / 2 - 0.02], [0, Hh - sag - 0.006, -L / 2 + 0.02], [-Wd / 2 + 0.01, Hh - 0.002, -L / 2 + 0.02], 'kit:prop', { color: [bc[0] * 0.6, bc[1] * 0.6, bc[2] * 0.6] });
    b.quad([0, Hh - sag - 0.006, L / 2 - 0.02], [Wd / 2 - 0.01, Hh - 0.002, L / 2 - 0.02], [Wd / 2 - 0.01, Hh - 0.002, -L / 2 + 0.02], [0, Hh - sag - 0.006, -L / 2 + 0.02], 'kit:prop', { color: [bc[0] * 0.6, bc[1] * 0.6, bc[2] * 0.6] });
    for (const e of [-0.36, 0.36]) {
      for (const s of [-1, 1]) rod(b, [s * (Wd / 2 - 0.02), 0, e * L - 0.18], [s * (Wd / 2 - 0.02), Hh - 0.01, e * L + 0.18], 0.011, fc);
      for (const s of [-1, 1]) rod(b, [s * (Wd / 2 - 0.02), 0, e * L + 0.18], [s * (Wd / 2 - 0.02), Hh - 0.01, e * L - 0.18], 0.011, fc);
    }
    bed = { x: 0, z: 0, yaw: Math.PI };
    b.bedSpot({ x: 0, z: 0, yaw: Math.PI, h: Hh, w: Wd - 0.06, l: L - 0.1, head: [0, -L / 2 + 0.25] });
    if (o.solid === true) b.solid(-Wd / 2, 0, -L / 2, Wd / 2, Hh + 0.02, L / 2);
  });
  b.pop();
  const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  return { rec, bed: { x: x + c * bed.x + s * bed.z, z: z - s * bed.x + c * bed.z, yaw: bed.yaw + (rot || 0) } };
}

// ---------- 营地范围（C1 的营地数据，写进 b.data.camps；坐标全换成世界坐标）----------
function zone(b, spec) {
  const s = spec || {};
  const list = b.data.camps || (b.data.camps = []);
  const k = list.length;
  const lv = b.level && b.level.id != null ? String(b.level.id) : '';
  const chunkKey = b.cx + ',' + b.cz;
  const W = (px, pz) => b.world(num(px, 0), num(pz, 0));
  const rot = b._T ? b._T.rot : 0;
  const camp = {
    id: lv + '/' + chunkKey + '#' + k, chunkKey,
    shape: s.shape === 'rect' ? 'rect' : 'circle',
    spawnBuffer: num(s.spawnBuffer, 8),
    npcs: Array.isArray(s.npcs) ? [num(s.npcs[0], 1), num(s.npcs[1], num(s.npcs[0], 1))] : [1, 2],
  };
  if (camp.shape === 'rect') {
    const pts = [W(s.x0, s.z0), W(s.x1, s.z0), W(s.x1, s.z1), W(s.x0, s.z1)];
    camp.minX = Math.min(...pts.map(p => p.x)); camp.maxX = Math.max(...pts.map(p => p.x));
    camp.minZ = Math.min(...pts.map(p => p.z)); camp.maxZ = Math.max(...pts.map(p => p.z));
    camp.x = (camp.minX + camp.maxX) / 2; camp.z = (camp.minZ + camp.maxZ) / 2;
  } else {
    const c = W(s.x, s.z);
    camp.x = c.x; camp.z = c.z; camp.r = num(s.r, 5);
  }
  camp.hub = s.hub ? W(s.hub.x, s.hub.z) : { x: camp.x, z: camp.z };
  camp.rest = (s.rest || []).map(r => {
    const p = W(r.x, r.z);
    const o = { x: p.x, z: p.z, yaw: num(r.yaw, 0) + rot, pose: r.pose === 'sit' ? 'sit' : 'lie', y: num(r.y, 0) + (b._T ? b._T.y : 0) };
    if (r.via) o.via = W(r.via.x, r.via.z);
    return o;
  });
  if (Array.isArray(s.stroll)) camp.stroll = s.stroll.map(p => W(p.x, p.z));
  if (s.strollR != null) camp.strollR = num(s.strollR, 0);
  list.push(camp);
  return camp;
}

// rod：两点间的方截面细杆（层级拼椅腿、栏杆用；不出碰撞体）
BR.camp = Object.freeze({ tent, cot, zone, rod, COLORS: COL, LANTERN });
})();
