// Level 21 - "Numbered Doors"（编号门）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-21  许可：CC BY-SA 3.0
// sourceMeta：作者 Stretchsterz；页面顶部挂着 "This article is outdated!" 告示（environment.other），
//             按现行写作标准被判定为过时条目 —— 但 data/lore-choices.json 选中的就是它，照它实现。
// 只按这个版本实现。data/lore-choices 的 conflicts 里属于其他版本的细节一律不做，包括：
//   不做 fandom 的「规模未定的巨大迷宫式建筑群」（本版本是四条走廊十字交汇）、Threat Index Class 0 / Safe / Stable /
//   Devoid of Entities、非欧几里得的 The Lobby Room、通风空调与 18°C、白/灰/棕褐地毯 + 石膏混凝土墙 + 不发声荧光灯 +
//   墙上电灯开关、7 英尺高 40 英寸宽的标准金属框门与永远在右侧的发亮门把手、「门上是随机三位数、每 2 小时到 2 天变一次」、
//   被石墙包围的门通向 Level 898、主入口改成 Level 20 的 Warp Tears、破开发霉木门去 Level 0、Level 216 楼梯间入口、
//   门后会自行上锁并由墙内机器清洁换陈设的隐藏房间、Shifting Area（高压电线 + 不明液体管道 + 无实体）、
//   protection 现象维持走廊洁净稳定、墙内低沉机器声、M.E.G. Failure Plan 前哨、食物与武器补给、
//   Level 483 镜像 / The Void 在天花板之上这类跨层理论、以及「层内流浪者可信、M.E.G. 把这里当休息站」。
//   wikidot-cn 的门径列表里没有「砂岩门 → Level 46」，本版本（en）有，照本版本做。
// 墙面/地面/天花板/照明在本版本里全是 unverified（页面一个字都没写），总得选一套 —— 选的是最通用的
//   「混凝土走廊 + 明装裸灯管」，并且是刻意绕开 fandom 那份清单选的：fandom 详写的地毯配色、办公室方格吊顶、
//   不发声的荧光吊灯、墙上电灯开关、18°C 通风空调、7 英尺 × 40 英寸的标准金属框门一律不做。
//   第一版用过 ceiling_tile 方格吊顶 + 嵌入式灯盘，那正好落进 fandom 的清单里（验收提的第 1 条），已改掉。
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// =====================================================================
// 贴图：门牌 / 霓虹字图集（程序化，不占 assets/tex 的 jpg 包体预算）
// =====================================================================
// 原文的招牌机制就是「门上有编号」。引擎还没有场景文字系统，但门牌本身只是一小块贴图 ——
// 这里用一张 512² 程序化图集（4 列 × 8 行、每格 128×64）把要用到的编号一次画完，
// 所有门牌共用同一个材质、各自改写 geometry 的 UV 取自己那一格，因此一块区块里十几块门牌只占 1 个 draw call。
// 仓库里没有对应 jpg，必须 noFile: true，否则每次启动都会去请求一个必然 404 的文件（硬规则）。
const PLATE_COLS = 4, PLATE_ROWS = 8;
// 下标即图集格号：0..13 是对照表里的编号，14/15 是两个通向范围外层级的编号，
// 16 = 笑脸标签（原文 "Doors labelled with a smiley face"），17 = 霓虹 EXIT，18 = 编号被刮花看不清的旧门牌
const PLATE_TEXT = ['105', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '356', '34', '', 'EXIT', ''];
const PLATE_SMILEY = 16, PLATE_NEON = 17, PLATE_WORN = 18;

BR.assets.registerProcedural('l21_door_plates', 512, (g, s) => {
  const cw = s / PLATE_COLS, ch = s / PLATE_ROWS;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, s, s);
  const r = U.rng('l21_door_plates');
  for (let idx = 0; idx < PLATE_TEXT.length; idx++) {
    const col = idx % PLATE_COLS, row = (idx / PLATE_COLS) | 0;
    const x = col * cw, y = row * ch;
    const neon = idx === PLATE_NEON;
    g.fillStyle = neon ? '#050302' : '#22201b';          // 霓虹格底色要够黑：basic 材质整体染红后只剩字在发光
    g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    if (!neon) {
      g.strokeStyle = '#584f42'; g.lineWidth = 2;
      g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);        // 门牌的金属边框
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = neon ? '#ffffff' : '#ded6c2';
    if (idx === PLATE_SMILEY) {                          // 笑脸标签：画出来，不写字
      const px = x + cw / 2, py = y + ch / 2, rr = ch * 0.3;
      g.strokeStyle = '#ded6c2'; g.lineWidth = 3;
      g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(px - rr * 0.36, py - rr * 0.3, 2.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px + rr * 0.36, py - rr * 0.3, 2.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, py + rr * 0.05, rr * 0.55, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke();
      continue;
    }
    if (idx === PLATE_WORN) {                            // 刮花的门牌：编号已经认不出来
      g.strokeStyle = 'rgba(190,182,164,0.5)'; g.lineWidth = 2;
      for (let k = 0; k < 16; k++) {
        g.beginPath();
        g.moveTo(x + 14 + r() * (cw - 28), y + 10 + r() * (ch - 20));
        g.lineTo(x + 14 + r() * (cw - 28), y + 10 + r() * (ch - 20));
        g.stroke();
      }
      continue;
    }
    const txt = PLATE_TEXT[idx];
    if (!txt) continue;
    g.font = 'bold ' + Math.round(ch * (neon ? 0.66 : 0.6)) + 'px monospace';
    g.fillText(txt, x + cw / 2, y + ch / 2 + 2);
  }
}, { noFile: true });

// 取图集第 idx 格的平面（正面朝 +Z）。b.mesh 的 uv: 'stretch' 原样保留这里改好的 UV（_kit fillUV），
// 所以一个材质能画出十几种不同的门牌
function plateGeom(idx, w, h) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  const col = idx % PLATE_COLS, row = (idx / PLATE_COLS) | 0;
  const pad = 0.006;                                     // 内缩一点，双线性过滤时不吃到隔壁格
  const u0 = col / PLATE_COLS + pad, u1 = (col + 1) / PLATE_COLS - pad;
  const v1 = 1 - row / PLATE_ROWS - pad, v0 = 1 - (row + 1) / PLATE_ROWS + pad;
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
  return geo;
}

// =====================================================================
// 尺寸与布局
// =====================================================================
// environment.architecture「由四条长走廊组成的大型层级，四条走廊在层级正中交汇；走廊两侧重复排列着随机放置的门」
//   → 区块 (0,0) 是中央广场，四条臂沿 ±X / ±Z 无限延伸（cz === 0 是东西臂，cx === 0 是南北臂），
//     其余区块是实心夹层（不建几何，玩家永远进不去，也省 draw call）。
// environment.scale「四条走廊每条估计约 26 miles」→ 引擎做不了 42 km 的有限长度，
//   用「走很久也走不到头」的无限延伸近似，写进 notImplemented。
const SIZE = 24;
// 层高：原文的 scale 只给了走廊长度，没写层高（unverified）。取 3.2 m —— 比 kit 默认的 2.8 高一截，
// 一是原文反复强调走廊的尺度，二是要在 "Exit" 门上方留出「巨大的红色霓虹标志」的位置
const H = 3.2;
const WT = 0.267, HWT = WT / 2;          // 墙厚 = kit.gridWalls 的默认值 0.2×4/3（用户 2026-09-13 指定），没依据就别改薄

// 主走廊净宽 5.2 m。不是随手取的：kit 会把未开放出口的提示圈撑到至少 1.4 m（SEALED_MIN_RADIUS），
// 门前触发点在墙面外 0.7 m —— 走廊半宽必须 > 0.7 + 1.4 + 半个墙厚，沿中线走才不会被两侧每一扇
// 「尚未开放」的门一路刷提示，刷新点也才不会被出口圈成片剔掉（验收第一轮实测：4 m 时每块掉 11 个点）
const COR_W = 5.2;
const C0 = 12 - COR_W / 2, C1 = 12 + COR_W / 2;    // 9.4 / 14.6，两侧墙的中心线
const SQ0 = 6, SQ1 = 18;                           // 中央小广场 12×12 m（environment.layout 只说 small，没给尺寸）

// "Exit" 门后的三条黑暗走廊。宽度同样被 SEALED_MIN_RADIUS 顶着：两侧重复出现的侧门全是未开放出口，
// 走廊窄了就会一路刷「子层级 尚未开放」的提示（验收第一轮 3.6 m / 4.2 m 时中线都在提示圈里）
const DARK_W = 5.0;
const D0 = 12 - DARK_W / 2, D1 = 12 + DARK_W / 2;  // 9.5 / 14.5
const DARK_COLS = [1, 2, 3];                       // 三条走廊各占一列区块（cz ≤ −1），横向连廊打通
const EXIT_CX = 2;                                 // "Exit" 门所在的东走廊区块：中央广场往东两块
const VEST_Z0 = 17, VEST_Z1 = 21;                  // 门后前厅（只在 cz === −1 那一排）
const RUNG_Z0 = 12 - DARK_W / 2, RUNG_Z1 = 12 + DARK_W / 2;   // 三条黑暗走廊之间的横向连廊，宽度同竖廊

const DOOR_SLOTS = [2.4, 6.4, 10.4, 14.4, 18.4, 22.4];   // 每面墙 6 个门位、4 m 一扇：「重复排列的门」
const DOOR_GAP = 1.6;                    // 一扇门占的墙洞宽度（门构件自带这一段带洞的墙）
const DOOR_R = 0.55;                     // 能走通的门的触发半径。触发点在墙心外 0.7 m，走廊中线离它 1.9 m：
                                         // 沿中线走碰不到任何一扇门，必须主动凑到门前才算「打开」它
const DARK_DOOR_R = 0.5;                 // 黑暗走廊的侧门全是未开放出口，kit 会把提示圈撑到 1.4 m，这里给的值只在将来接通时生效
const SPAWN_X = 12, SPAWN_Z = 14.5;      // 出生点：站在前台南侧面朝北（正对前台），右手边就是挂 Exit 标志的东走廊

// 楼板上的垮塌洞口（→ Level 22）。依据不在本层的选中版本里 —— wikidot-en 是 Level 22 垮塌之前的旧稿，
// 整份 exits 里没有 Level 22（fandom 版同样没有，所以这不是混版）。依据在对方层级：level-22.json 的
// wikidot-cn（用户给 22 定死的版本）entrances[0]「由掉落的碎石和结构完整性丧失在 Level 21 的地板上形成的洞口」、
// exits[0]「沿同一处垮塌洞口离开」；L22.js 已经照做（爬上碎石堆钻过天花板的洞回 21），这里补上另一半，
// 否则 21↔22 只出不进。判据和「补入口」批次给 Level Fun / Level ! 接线时用的是同一条：
// 本层选中版本的 exits 里没有、依据在对方层级的 entrances。
const HOLE_EVERY = 3;                    // 每条走廊每 3 块一处（dist 3/6/9…）：出生点往任意一个方向走 3 块就有一处（硬规则：3–5 块内找得到）
const HOLE_US = [8.4, 12.4, 16.4];       // 只落在两个门位正中间：到最近一扇门的触发点 2.76 m（沿走廊 2.0 + 横向 1.9），
                                         // 减掉两边半径后还剩 0.81 m（门 sealed 时圈被撑到 1.4 m 的最坏情况），出口圈不会叠在一起
const HOLE_R = 1.25;                     // 洞口实物半径
const HOLE_TRIG = 1.0;                   // 触发半径：贴着洞口本身（踩上那块黑就掉下去），两侧仍各留 1.6 m 干净地面绕过去
                                         //（现在 '22' 还不在 LEVEL_ORDER 里，kit 会按 sealed 把提示圈撑到 1.4 m；接上之后就回到 1.0）

// =====================================================================
// 编号门对照表（mechanics「编号门按标签对应固定层级」）
// =====================================================================
// 原文：105 → Level 0；356 → Level 356；34 → Level 669；8-20 → 各自对应层级；
//       无标签 → Level 1.5；砂岩材质的门 → Level 46；笑脸标签 → 一场 party! =)
// 本作已有 Level 0 与 8–20，这些门真的能走通；其余 kit 按 LEVEL_ORDER 自动 sealed、只提示「尚未开放」，
// 绝不改成通往别的层（用户规则 5）。
// 34 → Level 669 编号对不上号，是原文自己的异常，原样保留。
// 笑脸门原文只写 "lead to a party! =)"，没有点名 Level Fun。用户 2026-09-19 要求给享乐层补入口，主会话拍板按
// 「a party! =)」= 享乐层 =) 这个推断接上（享乐层的别称就是 =)），是取舍不是原文，可随时改回范围外目标。
const D_WOOD = 0x8d6a45, D_WOOD2 = 0x7b5b3c;
const D_PAINT = [0x6d7f6a, 0x6a7482, 0x82706a, 0x7a6a80, 0x6f7f80, 0x857a5e];
const DOORS = [
  { tag: '105', plate: 0, to: '0', color: D_WOOD, style: 'wood' },
  { tag: '8', plate: 1, to: '8', color: D_PAINT[0], style: 'wood' },
  { tag: '9', plate: 2, to: '9', color: D_PAINT[1], style: 'wood' },
  { tag: '10', plate: 3, to: '10', color: D_PAINT[2], style: 'wood' },
  { tag: '11', plate: 4, to: '11', color: D_PAINT[3], style: 'wood' },
  { tag: '12', plate: 5, to: '12', color: D_PAINT[4], style: 'wood' },
  { tag: '13', plate: 6, to: '13', color: D_PAINT[5], style: 'wood' },
  { tag: '14', plate: 7, to: '14', color: D_WOOD2, style: 'wood' },
  { tag: '15', plate: 8, to: '15', color: D_PAINT[0], style: 'metal' },
  { tag: '16', plate: 9, to: '16', color: D_PAINT[1], style: 'metal' },
  { tag: '17', plate: 10, to: '17', color: D_PAINT[2], style: 'metal' },
  { tag: '18', plate: 11, to: '18', color: D_PAINT[3], style: 'wood' },
  { tag: '19', plate: 12, to: '19', color: D_PAINT[4], style: 'wood' },
  { tag: '20', plate: 13, to: '20', color: D_PAINT[5], style: 'metal' },
  // ↓ 范围外：实物照摆，kit 自动 sealed，只提示「尚未开放」
  { tag: '356', plate: 14, to: '356', color: 0x767c83, style: 'metal',
    seal: '编号 356 的门：Level 356 尚未开放' },
  { tag: '34', plate: 15, to: '669', color: 0x6b7178, style: 'metal',
    seal: '编号 34 的门：通向 Level 669（原文的编号就对不上号），尚未开放' },
  { tag: '无标签', plate: -1, to: '1.5', color: 0x8b8578, style: 'wood',
    seal: '没有标签的门：通向 Level 1.5，尚未开放' },
  { tag: '砂岩', plate: -1, to: '46', color: 0xc6a97c, frameColor: 0xa78c63, style: 'wood', sandstone: true,
    seal: '砂岩砌成的门：通向 Level 46，尚未开放' },
  { tag: '笑脸', plate: PLATE_SMILEY, to: 'fun', color: 0xd3b845, style: 'wood',
    seal: '笑脸标签的门：通向一场 party! =)' },
];
// 编号被刮花、不在对照表里的门。exits「打开任意不在对照表里的门 → Level 21 自身的其他位置（more often than not）」
const DOOR_WORN = {
  tag: '刮花', plate: PLATE_WORN, to: '21', color: 0x80796c, style: 'wood',
  label: '编号被刮花的门 —— 更多时候只是把你丢回 Level 21 的别处',
  seal: '编号被刮花的门：更多时候只是把你丢回 Level 21 的别处',
};
// hazards「"Exit" 门后走廊里重复出现的那些门不含资源，只通向子层级和无编号层级」——两者都没有具体层号，
// 原样写成范围外目标，kit 自动 sealed
const DARK_DOORS = [
  { tag: null, plate: -1, to: '子层级', color: 0x5d564b, style: 'metal',
    seal: '这扇门通向某个子层级（Sub-section），尚未开放' },
  { tag: null, plate: -1, to: '无编号层级', color: 0x55504a, style: 'metal',
    seal: '这扇门通向某个无编号层级（Unnumbered Level），尚未开放' },
];

// =====================================================================
// 材质
// =====================================================================
// environment.materials / colors 在选中版本里是 unverified（页面只描述了「部分门由砂岩构成」和那块红色霓虹标志）。
// 所以这里不编造花色，用最中性的一套：灰白混凝土墙 + 灰褐地面 + 素混凝土顶，全部复用仓库已有 jpg，不新增贴图。
// 三样都刻意避开 conflicts 里点名属于 fandom 版的那份清单（地毯、办公室方格吊顶、嵌在吊顶里的荧光灯盘、
// 墙上电灯开关）——那一版整版不做，材质这种 unverified 项也不能挑着它的描述来填（验收第 1 条）。
// 黑暗走廊只是把同一套材质压暗（landmarks「门后的三条黑暗走廊」）。
function defineMaterials() {
  kit.mats({
    'L21:wall': { tex: 'concrete', repeatMeters: 2.6, color: 0xbab3a4, roughness: 0.95 },
    // 地面刻意不用 carpet_l0 / carpet_light：那是 Level 0 的黄地毯，本层的 colors 是 unverified，
    // 套上去会让这一层看起来就是 Level 0。改成平铺尺度更大的同款水泥、压成中性灰褐（验收第一轮改）
    'L21:floor': { tex: 'concrete', repeatMeters: 3.4, color: 0x8a8580, roughness: 1 },
    // 顶：素混凝土楼板（大平铺、没有格线），不是办公室方格吊顶 —— 方格吊顶是 fandom 版的描述，本层不做。
    // 颜色仍取偏亮的一档：抬头时顶面占半个屏幕，压暗了整条走廊都跟着闷
    'L21:ceil': { tex: 'concrete', repeatMeters: 4.6, color: 0xbab5a9, roughness: 1 },
    // 黑暗走廊的墙/地：颜色压暗，但不能压到近黑 —— 这一带只有零星几盏将熄的灯，
    // 其余全靠 env.ambient 打底，材质再暗就整屏纯黑、连走廊形状都看不出来（验收第一轮踩到）
    'L21:wallDark': { tex: 'concrete', repeatMeters: 2.6, color: 0x635d53, roughness: 1 },
    'L21:floorDark': { tex: 'concrete', repeatMeters: 3.4, color: 0x514c45, roughness: 1 },
    // 门牌：和霓虹共用一张图集贴图，phong（吃灯光）。uv: 'stretch' 下 repeatMeters 不参与计算
    'L21:plate': { tex: 'l21_door_plates', roughness: 0.75 },
    // 霓虹 "Exit"：basic 不吃光、整体染红 —— 白字变红字、黑底仍是黑（landmarks「巨大的红色霓虹 Exit 标志」）
    'L21:neon': { type: 'basic', tex: 'l21_door_plates', color: 0xff3524 },
  });
}
const TRIM = { color: 0x4a453c, h: 0.09, t: 0.018 };   // 踢脚线：原文没写，取和墙同色系深一档（不是黄木踢脚线，本层不是黄墙纸房间）

// 灯具：一条 1.5 m 的裸日光灯管卡在深色明装槽里，直接吊在素混凝土顶上。
// 照明在本版本里是 unverified；之所以不用 kit 默认那种 1.2×0.6 的嵌入式灯盘，是因为「办公室吊顶 + 嵌在里面的
// 荧光灯」正是 conflicts 里点名属于 fandom 版的描述（那一版整版不做）。明装裸灯管是最通用的走廊照明，
// 和 fandom 的清单没有一项重合；env.audio 留 'fluorescent'（灯管嗡嗡声），恰好也是 fandom「灯不发声」的反面。
// 灯光强度、range、坏灯比例一概照旧 —— 只换外观，不动亮度（暗不暗是验收过的，别回退）
function tube(b, x, z, rot, opts) {
  return kit.prop.lightPanel(b, x, z, rot, Object.assign({ w: 1.5, d: 0.18, frameColor: 0x57534c }, opts));
}

// =====================================================================
// 几何小工具（本层不用 kit.grid：结构是四条固定走廊，不是迷宫）
// =====================================================================
// axis 'x'：墙沿 X 方向延伸、位置在 z = fixed；axis 'z'：墙沿 Z 延伸、位置在 x = fixed
// trimSide：踢脚线贴在墙的哪一侧（+1 = +Z / +X，−1 = 反向，0/缺省 = 不加）
function seg(b, axis, fixed, a0, a1, key, trimSide) {
  if (a1 - a0 < 0.03) return;
  const mid = (a0 + a1) / 2, len = a1 - a0;
  if (axis === 'x') b.box(mid, 0, fixed, len, H, WT, key, { faces: 'sides' });
  else b.box(fixed, 0, mid, WT, H, len, key, { faces: 'sides' });
  if (!trimSide) return;
  const o = { length: len, h: TRIM.h, t: TRIM.t, color: TRIM.color };
  if (axis === 'x') kit.prop.baseboard(b, mid, fixed + trimSide * HWT, trimSide > 0 ? 0 : Math.PI, o);
  else kit.prop.baseboard(b, fixed + trimSide * HWT, mid, trimSide > 0 ? Math.PI / 2 : -Math.PI / 2, o);
}

// 一条直墙按 gaps（[a0, a1] 数组）挖洞后分段建
function wallSegs(b, axis, fixed, a0, a1, gaps, key, trimSide) {
  const cuts = (gaps || []).slice().sort(function (p, q) { return p[0] - q[0]; });
  let s = a0;
  for (let i = 0; i < cuts.length; i++) {
    const g0 = cuts[i][0], g1 = cuts[i][1];
    if (g1 <= a0 || g0 >= a1) continue;
    if (g0 > s) seg(b, axis, fixed, s, Math.min(g0, a1), key, trimSide);
    if (g1 > s) s = g1;
  }
  if (s < a1) seg(b, axis, fixed, s, a1, key, trimSide);
}

// 地板 + 顶板
function slab(b, x0, z0, x1, z1, floorKey, ceilKey) {
  if (x1 - x0 < 0.03 || z1 - z0 < 0.03) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  b.plane(cx, 0, cz, w, d, floorKey, { facing: 'up' });
  b.plane(cx, H, cz, w, d, ceilKey, { facing: 'down' });
}

// =====================================================================
// 一扇编号门（门 + 带洞的墙 + 门牌）
// =====================================================================
// def.to 在 LEVEL_ORDER 里 → 真能走通；不在 → kit 自动 sealed，实物照摆（用户规则 5）
function numberedDoor(b, def, x, z, rot, key, radius) {
  const doorOpts = {
    w: 0.95, color: def.color, style: def.style,
    wall: { matKey: key, w: DOOR_GAP, h: H, t: WT },
  };
  if (def.frameColor != null) doorOpts.frameColor = def.frameColor;
  const label = def.label || (def.tag ? '编号 ' + def.tag + ' 的门 —— 前往 Level ' + def.to : undefined);
  kit.exit(b, {
    to: def.to, kind: 'door', x: x, z: z, rot: rot, radius: radius,
    style: def.style, door: doorOpts, label: label, sealedText: def.seal,
  });
  if (def.sandstone) {                       // 砂岩门：门扇上压几道砂岩砌缝，一眼能认出材质不一样
    b.push(x, z, rot);
    for (let k = 0; k < 3; k++) {
      b.box(0, 0.45 + k * 0.55, 0.095, 0.9, 0.035, 0.02, 'kit:prop', { color: 0x9c8258, solid: false });
    }
    b.pop();
  }
  if (def.plate >= 0) {                      // 门牌：门框上方
    b.push(x, z, rot);
    const geo = plateGeom(def.plate, 0.46, 0.23);
    b.mesh(geo, 'L21:plate', { y: 2.33, z: 0.152 });
    geo.dispose();
    b.pop();
  }
}

// 推不开的门：同样是「重复排列的门」的一部分，但不在对照表里、也没做成出口
function stuckDoor(b, x, z, rot, key, color) {
  kit.prop.door(b, x, z, rot, {
    style: 'wood', w: 0.95, color: color, wall: { matKey: key, w: DOOR_GAP, h: H, t: WT },
  });
}

// 楼板塌出来的洞：黑洞口 + 一圈断茬碎石 + 几根翘起来的钢筋。
// 实物全部走已有的 kit:prop / kit:glow，不新增材质（"Exit" 门那一块已经用满 8 种）
function collapseHole(b, rng, axis, u) {
  const x = axis === 'x' ? u : 12, z = axis === 'x' ? 12 : u;
  kit.exit(b, {
    to: '22', kind: 'hole', x: x, z: z, radius: HOLE_TRIG,
    hole: { r: HOLE_R, rimColor: 0x3d382f },     // 断茬边沿：比地面暗一大截，否则灯一照就成了一圈白塑料
    label: '楼板塌穿的洞口 —— 下面是 Level 22 的停车场 (level-22.json wikidot-cn entrances[0] / exits[0])',
    sealedText: '楼板塌穿的洞口：下面是 Level 22，尚未开放',
  });
  // 碎石：边沿一圈掉下来的混凝土块。颜色要压到明显比地面暗 —— 上面 6 m 一盏灯，取地面色会被照成一堆白盒子
  for (let k = 0; k < 9; k++) {
    const a = rng() * Math.PI * 2;
    const d = HOLE_R * (1.02 + rng() * 0.62);
    const w = 0.16 + rng() * 0.3, h = 0.07 + rng() * 0.22;   // 有厚度才像混凝土块，压扁了看着像掉了一地瓷砖
    b.box(x + Math.cos(a) * d, 0, z + Math.sin(a) * d, w, h, w * (0.5 + rng() * 0.5), 'kit:prop',
      { color: k % 3 === 0 ? 0x565045 : k % 3 === 1 ? 0x46413a : 0x625b4e, solid: false, rotY: a });
  }
  for (let k = 0; k < 4; k++) {                       // 钢筋：从断茬上翘起来，一眼看得出是塌的不是挖的
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.box(x + Math.cos(a) * HOLE_R * 0.97, 0, z + Math.sin(a) * HOLE_R * 0.97, 0.022, 0.26 + k * 0.08, 0.022,
      'kit:prop', { color: 0x3f3226, solid: false, rotY: a });
  }
}

// =====================================================================
// 区块分区
// =====================================================================
function regionOf(cx, cz) {
  if (cx === 0 && cz === 0) return 'center';
  if (cz === 0) return 'ew';                                  // 东西臂
  if (cx === 0) return 'ns';                                  // 南北臂
  if (cz <= -1 && DARK_COLS.indexOf(cx) >= 0) return 'dark';  // "Exit" 门后的三条黑暗走廊
  return 'void';                                              // 四条走廊之间的实心夹层：不建几何
}

// =====================================================================
// 中央小广场（区块 0,0）
// =====================================================================
// environment.layout「层级中央是一个开放的小型广场，摆着椅子和一张桌子（正文后段称其为 front desk 前台）。
//                    实体永远不会出现在中央区域，只出现在走廊里。」
function buildCenter(b, rng) {
  const W = 'L21:wall', F = 'L21:floor', CE = 'L21:ceil';
  slab(b, SQ0 - HWT, SQ0 - HWT, SQ1 + HWT, SQ1 + HWT, F, CE);   // 广场
  slab(b, SQ1 + HWT, C0 - HWT, SIZE, C1 + HWT, F, CE);          // 东臂接口段
  slab(b, 0, C0 - HWT, SQ0 - HWT, C1 + HWT, F, CE);             // 西
  slab(b, C0 - HWT, SQ1 + HWT, C1 + HWT, SIZE, F, CE);          // 南
  slab(b, C0 - HWT, 0, C1 + HWT, SQ0 - HWT, F, CE);             // 北

  // 广场四面墙，中间让出走廊口
  const open = [[C0 + HWT, C1 - HWT]];
  wallSegs(b, 'x', SQ0, SQ0 - HWT, SQ1 + HWT, open, W, 1);      // 北墙，内侧朝 +Z
  wallSegs(b, 'x', SQ1, SQ0 - HWT, SQ1 + HWT, open, W, -1);     // 南墙
  wallSegs(b, 'z', SQ0, SQ0 - HWT, SQ1 + HWT, open, W, 1);      // 西墙
  wallSegs(b, 'z', SQ1, SQ0 - HWT, SQ1 + HWT, open, W, -1);     // 东墙

  // 四条臂的接口段侧墙：各摆 2 扇对照表里的门，一出广场就能找到真的能走通的出口
  const stubs = [
    { axis: 'x', a0: SQ1 + HWT, a1: SIZE, u: 21, doors: [0, 1] },   // 东
    { axis: 'x', a0: 0, a1: SQ0 - HWT, u: 3, doors: [2, 3] },       // 西
    { axis: 'z', a0: SQ1 + HWT, a1: SIZE, u: 21, doors: [4, 5] },   // 南
    { axis: 'z', a0: 0, a1: SQ0 - HWT, u: 3, doors: [6, 7] },       // 北
  ];
  for (let s = 0; s < stubs.length; s++) {
    const st = stubs[s];
    const gap = [[st.u - DOOR_GAP / 2, st.u + DOOR_GAP / 2]];
    wallSegs(b, st.axis, C0, st.a0, st.a1, gap, W, 1);
    wallSegs(b, st.axis, C1, st.a0, st.a1, gap, W, -1);
    for (let k = 0; k < 2; k++) {
      const def = DOORS[st.doors[k]];
      const near = k === 0;                                    // 0 → C0 那面墙，1 → C1 那面墙
      let x, z, rot;
      if (st.axis === 'x') { x = st.u; z = near ? C0 : C1; rot = near ? 0 : Math.PI; }
      else { x = near ? C0 : C1; z = st.u; rot = near ? Math.PI / 2 : -Math.PI / 2; }
      numberedDoor(b, def, x, z, rot, W, DOOR_R);
    }
  }

  // 前台：一张桌子 + 若干椅子（原文只给了这两样）。台面朝 +Z，玩家出生在它南侧正对着它
  kit.prop.desk(b, 12, 10.75, 0, { w: 2.6, d: 0.9, color: 0x6f5b43, monitor: false });
  b.box(12, 0.76, 10.2, 2.9, 0.08, 1.25, 'kit:prop', { color: 0x7d6849, solid: false });    // 前台台面
  b.box(12, 0, 10.78, 2.9, 0.76, 0.06, 'kit:prop', { color: 0x63523c });                    // 台面前挡板：看着才像前台而不是飘着一块板
  kit.prop.chair(b, 11.1, 9.4, 0, { color: 0x4f4a42 });
  kit.prop.chair(b, 12.9, 9.4, 0, { color: 0x4f4a42 });
  kit.prop.chair(b, 9.3, 13.2, Math.PI * 0.75, { color: 0x4f4a42 });
  kit.prop.chair(b, 14.7, 13.2, -Math.PI * 0.75, { color: 0x4f4a42 });
  kit.prop.chair(b, 8.8, 16.4, Math.PI, { color: 0x4f4a42 });
  kit.prop.chair(b, 15.2, 16.4, Math.PI, { color: 0x4f4a42 });

  // 灯：广场四角 + 前台上方；四条臂接口段各一盏。lighting = unverified，取最通用的明装裸灯管（见 tube()）
  const spots = [[8.5, 8.5], [15.5, 8.5], [8.5, 15.5], [15.5, 15.5], [12, 12], [21, 12], [3, 12], [12, 21], [12, 3]];
  for (let i = 0; i < spots.length; i++) {
    const r = rng();
    const state = r < 0.04 ? 'broken' : r < 0.14 ? 'flicker' : 'on';
    tube(b, spots[i][0], spots[i][1], 0, {
      y: H, state: state, flicker: 0.3 + rng() * 0.4, intensity: 1.05, range: 9,
    });
  }

  // 刷新点：广场里全部 safe —— 原文「实体永远不会出现在中央区域」
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 6; i++) b.spawn(7 + i * 2, 7 + j * 2, 'room', { safe: true });
  }
  for (let k = 0; k < 4; k++) {
    b.spawn(1.5 + k * 1.5, 12, 'floor', { safe: true });
    b.spawn(SIZE - 1.5 - k * 1.5, 12, 'floor', { safe: true });
    b.spawn(12, 1.5 + k * 1.5, 'floor', { safe: true });
    b.spawn(12, SIZE - 1.5 - k * 1.5, 'floor', { safe: true });
  }
}

// =====================================================================
// 四条长走廊（东西臂 / 南北臂）
// =====================================================================
// environment.architecture「走廊两侧重复排列着随机放置的门」
// exits「打开任意不在对照表里的门 → 更多时候把人送到 Level 21 的其他地方」
function buildArm(b, rng, cx, cz, region) {
  const W = 'L21:wall', F = 'L21:floor', CE = 'L21:ceil';
  const axis = region === 'ew' ? 'x' : 'z';                   // 走廊延伸方向
  const dist = region === 'ew' ? Math.abs(cx) : Math.abs(cz); // 离中央广场几块
  const armIdx = region === 'ew' ? (cx > 0 ? 0 : 1) : (cz > 0 ? 2 : 3);
  const isExitChunk = region === 'ew' && cx === EXIT_CX && cz === 0;

  // 门位洗牌：固定消耗 11 次 rng（先无条件取，别写成「满足条件才取」）
  const order = [];
  for (let s = 0; s < 2; s++) for (let k = 0; k < DOOR_SLOTS.length; k++) order.push({ side: s, u: DOOR_SLOTS[k] });
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  // 前 4 个门位摆对照表里的门（按离中心的块数循环取：沿一条走廊走 5 块就能把 19 种门见全），
  // 第 5 个摆「编号被刮花」的门，剩下 7 个是推不开的门
  const base = ((dist - 1) * 4 + armIdx * 5) % DOORS.length;
  const gaps = [[], []];
  const placed = [];
  for (let i = 0; i < order.length; i++) {
    const o = order[i];
    gaps[o.side].push([o.u - DOOR_GAP / 2, o.u + DOOR_GAP / 2]);
    placed.push({ u: o.u, side: o.side, def: i < 4 ? DOORS[(base + i) % DOORS.length] : i === 4 ? DOOR_WORN : null });
  }
  if (isExitChunk) gaps[0].push([12 - DOOR_GAP / 2, 12 + DOOR_GAP / 2]);   // "Exit" 门的墙洞

  if (axis === 'x') {
    slab(b, 0, C0 - HWT, SIZE, C1 + HWT, F, CE);
    wallSegs(b, 'x', C0, 0, SIZE, gaps[0], W, 1);
    wallSegs(b, 'x', C1, 0, SIZE, gaps[1], W, -1);
  } else {
    slab(b, C0 - HWT, 0, C1 + HWT, SIZE, F, CE);
    wallSegs(b, 'z', C0, 0, SIZE, gaps[0], W, 1);
    wallSegs(b, 'z', C1, 0, SIZE, gaps[1], W, -1);
  }

  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    const near = p.side === 0;
    let x, z, rot;
    if (axis === 'x') { x = p.u; z = near ? C0 : C1; rot = near ? 0 : Math.PI; }
    else { x = near ? C0 : C1; z = p.u; rot = near ? Math.PI / 2 : -Math.PI / 2; }
    if (p.def) numberedDoor(b, p.def, x, z, rot, W, DOOR_R);
    else stuckDoor(b, x, z, rot, W, 0x7a6f5e);
  }

  // 灯：6 m 一盏。lighting = unverified，用最通用的明装裸灯管（见 tube()），坏灯/闪灯比例压低
  for (let k = 0; k < 4; k++) {
    const u = 3 + k * 6;
    const r = rng();
    const state = r < 0.07 ? 'broken' : r < 0.2 ? 'flicker' : 'on';
    const flicker = 0.3 + rng() * 0.5;
    if (axis === 'x') tube(b, u, 12, 0, { y: H, state: state, flicker: flicker, intensity: 1.0, range: 9 });
    else tube(b, 12, u, Math.PI / 2, { y: H, state: state, flicker: flicker, intensity: 1.0, range: 9 });
  }

  if (isExitChunk) buildExitDoor(b);

  // 楼板垮塌的洞口 → Level 22：每条走廊每 3 块一处（dist 3/6/9…），落在两个门位正中间。
  // rng 在这里固定消耗 1 + 9×4 = 37 次；要不要摆只看区块坐标（dist），不看 rng 值，所以序列仍然是确定的
  if (dist % HOLE_EVERY === 0) collapseHole(b, rng, axis, HOLE_US[Math.floor(rng() * HOLE_US.length)]);

  // 刷新点：中线一排 + 门位之间空档上的两排（离任何一扇门的出口圈都有 1.8 m 以上，不会被 finish 剔掉）
  for (let k = 0; k < 20; k++) {
    const u = 0.6 + k * 1.2;
    if (axis === 'x') b.spawn(u, 12, 'floor'); else b.spawn(12, u, 'floor');
  }
  for (let k = 0; k < 5; k++) {
    const u = 4.4 + k * 4;                                  // 两个门位正中间，离左右两扇门都有 2 m
    if (axis === 'x') { b.spawn(u, 10.5, 'floor'); b.spawn(u, 13.5, 'floor'); }
    else { b.spawn(10.5, u, 'floor'); b.spawn(13.5, u, 'floor'); }
  }
}

// landmarks「中央前台右侧走廊里的 "Exit" 门，门上方是巨大的红色霓虹 "Exit" 标志」
// 「右侧」的读法：出生点站在前台前面（南侧）面朝前台时，右手边是东走廊 —— 所以 "Exit" 门在东臂上。
// 门后是三条不会移位的黑暗走廊，所以这扇门必须真能穿过去：做成半开、不挡路。
function buildExitDoor(b) {
  const W = 'L21:wall';
  kit.prop.door(b, 12, C0, 0, {
    style: 'metal', w: 1.2, h: 2.1, open: 0.88, color: 0x666c72, frameColor: 0x54595e,
    wall: { matKey: W, w: DOOR_GAP, h: H, t: WT },
  });
  // 巨大的红色霓虹 "Exit"：basic 材质不吃光，远远就能在走廊侧壁上看见一块红
  const geo = plateGeom(PLATE_NEON, 2.4, 0.8);
  b.push(12, C0, 0);
  b.mesh(geo, 'L21:neon', { y: 2.72, z: 0.16 });
  b.box(0, 2.26, 0.13, 2.52, 0.06, 0.07, 'kit:prop', { color: 0x3a2320, solid: false });   // 标志的下框
  b.pop();
  geo.dispose();
  b.light({ x: 12, y: 2.7, z: C0 + 0.55, color: 0xff2a18, intensity: 1.2, range: 8, flicker: 0.12 });
  // 门后的通道：从 z = C0 一直往北，接到 cz = −1 那一排的前厅。
  // 地面也用 wallDark（不再引 floorDark）——这一块已经有 wall/floor/ceil/prop/glow/plate/neon 七种材质，
  // 再加一种就超过「每块 mesh ≤ 8」（验收第一轮实测 9）
  slab(b, D0 - HWT, 0, D1 + HWT, C0 - HWT, 'L21:wallDark', 'L21:wallDark');
  seg(b, 'z', D0, 0, C0 - HWT, 'L21:wallDark', 1);
  seg(b, 'z', D1, 0, C0 - HWT, 'L21:wallDark', -1);
  for (let k = 0; k < 6; k++) b.spawn(12, 1 + k * 1.6, 'dark');
}

// =====================================================================
// "Exit" 门后的三条黑暗走廊
// =====================================================================
// landmarks「"Exit" 门后的三条黑暗走廊（不会移位、会生成宝贵资源）」
// hazards「实体会成群结队（in droves）出现」「重复出现的那些门不含资源，只通向子层级和无编号层级」
// 做法：三条走廊各占一列区块（cx = 1/2/3，cz ≤ −1），每隔三块用一条横向连廊互相打通。
// world 是按「每个载入的区块」算实体与物品数量的：同样一段路程，这一带载入的区块数是主走廊的三倍，
// 所以遇到的实体和补给自然就密三倍（层级表里只写「正常后室」的密度，不自己打折 —— 用户规则 2）。
function buildDark(b, rng, cx, cz) {
  const W = 'L21:wallDark', F = 'L21:floorDark';
  const col = DARK_COLS.indexOf(cx);
  const isVest = cz === -1;
  const hallZ1 = isVest ? VEST_Z0 : SIZE;                     // 前厅那排的竖廊到 z = 17 为止
  const rung = !isVest && ((-cz) % 3 === 0);
  const openW = rung && col > 0;                              // 连廊往西通
  const openE = rung && col < DARK_COLS.length - 1;           // 连廊往东通

  slab(b, D0 - HWT, 0, D1 + HWT, hallZ1, F, W);               // 竖廊

  const gapsW = [], gapsE = [];
  // 开口只挖到连廊墙的内侧面为止，竖廊墙一直画到拐角外皮 —— 否则拐角会留一个 0.26×0.13 的窟窿
  if (openW) gapsW.push([RUNG_Z0 + HWT, RUNG_Z1 - HWT]);
  if (openE) gapsE.push([RUNG_Z0 + HWT, RUNG_Z1 - HWT]);

  // 侧门（子层级 / 无编号层级）：前厅那排放 z = 4 / 12，其余放 z = 4 / 20，避开连廊
  const doorZ = isVest ? [4, 12] : [4, 20];
  const picks = [];
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < doorZ.length; k++) {
      const z = doorZ[k];
      const r = rng();                                        // 先无条件取，保持消耗顺序固定
      if (rung && z > RUNG_Z0 - 1.2 && z < RUNG_Z1 + 1.2) continue;
      (s === 0 ? gapsW : gapsE).push([z - DOOR_GAP / 2, z + DOOR_GAP / 2]);
      picks.push({ side: s, z: z, def: DARK_DOORS[r < 0.5 ? 0 : 1] });
    }
  }
  // 竖廊侧墙。前厅那排：只有最西那列的西墙、最东那列的东墙要一直画到 VEST_Z1 去当前厅的端头，
  // 中间列两边都得在 VEST_Z0 处收住，否则前厅会被切成三个互不相通的小盒子（验收第二轮抓到）
  // 收住的那一侧要画到 VEST_Z0 + 半墙厚：正好和前厅北墙的外皮对齐，拐角不留缝
  const wEnd0 = isVest && col === 0 ? VEST_Z1 : isVest ? VEST_Z0 + HWT : hallZ1;
  const wEnd1 = isVest && col === DARK_COLS.length - 1 ? VEST_Z1 : isVest ? VEST_Z0 + HWT : hallZ1;
  wallSegs(b, 'z', D0, 0, wEnd0, gapsW, W, 1);
  wallSegs(b, 'z', D1, 0, wEnd1, gapsE, W, -1);
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    numberedDoor(b, p.def, p.side === 0 ? D0 : D1, p.z, p.side === 0 ? Math.PI / 2 : -Math.PI / 2, W, DARK_DOOR_R);
  }

  // 横向连廊：把三条走廊串起来（col 0 只往东开、col 2 只往西开，最外侧照样是死墙）
  if (rung) {
    const rx0 = openW ? 0 : D0 - HWT, rx1 = openE ? SIZE : D1 + HWT;
    if (openW) slab(b, rx0, RUNG_Z0 - HWT, D0 - HWT, RUNG_Z1 + HWT, F, W);
    if (openE) slab(b, D1 + HWT, RUNG_Z0 - HWT, rx1, RUNG_Z1 + HWT, F, W);
    const hole = [[D0 - HWT, D1 + HWT]];
    wallSegs(b, 'x', RUNG_Z0, rx0, rx1, hole, W, 1);
    wallSegs(b, 'x', RUNG_Z1, rx0, rx1, hole, W, -1);
    if (openW) b.spawn(D0 - 2.2, 12, 'dark');
    if (openE) b.spawn(D1 + 2.2, 12, 'dark');
  }

  // 前厅（cz = −1 那一排）：一条横贯三列的东西向大厅，穿过 "Exit" 门的人从这里分头进三条走廊
  if (isVest) {
    const vx0 = col === 0 ? D0 - HWT : 0;
    const vx1 = col === DARK_COLS.length - 1 ? D1 + HWT : SIZE;
    slab(b, vx0, VEST_Z0, vx1, VEST_Z1 + HWT, F, W);
    wallSegs(b, 'x', VEST_Z0, vx0, vx1, [[D0 - HWT, D1 + HWT]], W, -1);              // 北墙：让出竖廊口
    wallSegs(b, 'x', VEST_Z1, vx0, vx1, cx === EXIT_CX ? [[D0 - HWT, D1 + HWT]] : [], W, 1);
    if (cx === EXIT_CX) {                                                            // 中间那列往南接 "Exit" 门通道
      slab(b, D0 - HWT, VEST_Z1, D1 + HWT, SIZE, F, W);
      seg(b, 'z', D0, VEST_Z1, SIZE, W, 1);
      seg(b, 'z', D1, VEST_Z1, SIZE, W, -1);
      for (let k = 0; k < 2; k++) b.spawn(12, VEST_Z1 + 1 + k * 1.4, 'dark');
    }
    for (let k = 0; k < 8; k++) b.spawn(vx0 + 1.4 + k * ((vx1 - vx0 - 2.8) / 7), 19, 'dark');
    // 前厅不是原文说的那三条黑暗走廊本身，而是门后分头的那个厅：给三盏还亮着的灯，
    // 玩家推开 "Exit" 门后至少能看清有三条路（验收第二轮：只有一盏将熄的灯时这里几乎全黑）
    for (let k = 0; k < 3; k++) {
      tube(b, vx0 + 3 + k * ((vx1 - vx0 - 6) / 2), 19, 0, {
        y: H, state: 'flicker', flicker: 0.3, color: 0xb6c6d4, intensity: 0.55, range: 11,
      });
    }
  }

  // 灯：原文只说这三条走廊是黑暗的（dark hallways），不是「没有光」。
  // 每块一盏将熄未熄的冷白灯管（强度只有主走廊的 1/4、24 m 才一盏，而主走廊是 6 m 一盏 ——
  // 每米光通量差十几倍，一眼就看得出是另一种地方），外加一根彻底坏掉的灰灯管；
  // 连廊交叉口和前厅再补一盏，免得在岔路上彻底找不着北（验收第一轮：原来太暗，整屏纯黑）
  tube(b, 12, isVest ? 8 : 6, Math.PI / 2, {
    y: H, state: 'flicker', flicker: 0.4, color: 0xa8bccc, intensity: 0.3, range: 10,
  });
  tube(b, 12, isVest ? 13 : 18, Math.PI / 2, { y: H, state: 'broken' });
  if (rung) {
    tube(b, 12, 12, Math.PI / 2, {
      y: H, state: 'flicker', flicker: 0.5, color: 0xbfd0e0, intensity: 0.4, range: 10,
    });
  }

  // 刷新点：竖廊中线加密到 0.8 m 一个 —— 侧门都是 sealed、提示圈被 kit 撑到 1.4 m，
  // 每扇门会吃掉附近两三个点（验收第一轮实测每块只剩 14 个，低于每块 ≥ 20 的要求）
  for (let k = 0; k < 29; k++) {
    const z = 0.5 + k * 0.8;
    if (z < hallZ1 - 0.4) b.spawn(12, z, 'dark');
  }
}

// =====================================================================
// 层级状态（mechanics「走廊每隔一段时间自行移位、变形成新形态」）
// =====================================================================
const S = { t: 0, nextShift: 0, told: false, warnedDark: false };
const SHIFT_PERIOD = 95;

function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const region = regionOf(cx, cz);
  if (region === 'center') buildCenter(b, rng);
  else if (region === 'ew' || region === 'ns') buildArm(b, rng, cx, cz, region);
  else if (region === 'dark') buildDark(b, rng, cx, cz);
  // 'void'：四条走廊之间的实心夹层，不建任何几何（玩家进不去，也不占 draw call）
  return b.finish();
}

BR.levels.register({
  id: '21',
  name: 'Level 21',
  title: 'Numbered Doors',
  nickname: '"Numbered Doors"（编号门）',
  version: 'wikidot-en',              // = data/lore-choices.json 的 levels['21'].source
  survivalClass: '4',                 // 页面 SURVIVAL DIFFICULTY 只显示数字 4，三条描述词仍是未填充的模板占位符
  chunkSize: SIZE,
  env: {
    // 颜色 unverified：取中性的灰白灰泥 + 灰褐地面，雾色随之取偏冷的暗灰，远处沉下去而不是发死黑
    background: 0x17161a, fogColor: 0x17161a,
    fogNear: 4, fogFar: 34,           // ≤ chunkSize × 2；长走廊要看得见一段距离，尽头仍化在雾里
    // 主走廊照明 unverified、"Exit" 门后明写 dark。整层只有一份 ambient，取「昏暗」那一档：
    // 有效亮度 ≈ 0.18 / 0.173 / 0.157。本层 darkness: false，不是无光层 ——「黑暗走廊」靠那一带
    // 只有零星几盏弱灯（主走廊是 6 m 一盏 1.0 强度）来体现，而不是把整层的底光压到看不见
    // （验收第一轮 0.17 时门后那一段整屏纯黑，连走廊形状都认不出来）
    ambient: { color: 0xe6ddc8, intensity: 0.2 },
    sanityDrainMul: 1.5,              // hazards「走廊极端危险（extremely dangerous）」+ Class 4
    hungerDrainMul: 1,                // 温度 unverified，不加成
    audio: 'fluorescent',             // 层内环境音 unverified；照明是明装裸灯管，取灯管嗡嗡声的预设
                                      //（fandom 版特地写「荧光灯不发声」，这里正好是它的反面，不会撞版）
    darkness: false,                  // 只有 "Exit" 门后那一段暗，整层不是无光层
  },
  spawn: function () {
    // entrances「主要入口：Level 13 墙上的 Warp Tears」—— 原文没说落点在哪，
    // 放在中央小广场（实体永不进入的唯一安全处），面朝北正对前台，右手边就是挂 Exit 标志的东走廊
    return { x: SPAWN_X, y: 0, z: SPAWN_Z, yaw: 0 };
  },
  buildChunk: buildChunk,
  // ---------- 实体 ----------
  // entityDensityOverall「中央广场为零（实体永远不会出现在该区域）；走廊里 high 且高度不稳定 ——
  //   极端危险，有时会充满实体，数量和类型 inconsistent；Clickers 相对常见」
  // 换算：只有定性描述 → 走廊整体取 BR.config.densityWords.high = 0.9 /1000 m²，按下面五种分摊（0.24+0.20+0.16+0.16+0.14）。
  //   原文点名的 Clickers（咔嗒机）项目里没有这种实体，不硬套（写进 apiRequests）；
  //   原文另外两条是 "Unknown Entities（只说被目击过）" 和 "在本层发现的任何人都不能信任"，
  //   正好对应「数量和类型不一致、无法预估」—— 所以用已注册的常见后室实体凑一份杂色名单，
  //   全部选 hostile：这样 b.spawn(..., { safe: true }) 标过的中央广场才真的一只都不会刷。
  // 「黑暗走廊里成群结队」= 那一带同样路程上载入的区块数是主走廊的三倍（见 buildDark），不靠调密度。
  entities: [
    { type: 'hound', officialPer1000m2: 0.24 },        // 走廊里成群的捕食者
    { type: 'smiler', officialPer1000m2: 0.20 },       // 黑暗走廊里飘着的白色笑脸
    { type: 'skin_stealer', officialPer1000m2: 0.16 }, // entities[3]「在本层发现的任何人都不能信任，避免接触」
    { type: 'bacteria', officialPer1000m2: 0.16 },
    { type: 'duller', officialPer1000m2: 0.14 },       // entities[1]「Unknown Entities，只说被目击过」的杂色补充
  ],
  // ---------- 物品 ----------
  // items「Almond Water、Level Keys、Firesalt、其他随机物体（rarely）」；
  //   landmarks「"Exit" 门后的三条黑暗走廊会生成宝贵资源」→ 靠那一带三倍的区块密度体现。
  // data/item-spawn.json 里没有 '21' 的条目，按原文清单落表：
  //   almond_water 取全局基准 1.2；firesalt 取 item-spawn 的基准值 0.1（原文没给稀有度）；
  //   Level Keys 项目里没有对应物品（写进 apiRequests）；「其他随机物体」原文未列名，不编。
  //   food_ration 是用户规则「所有模式都刷食物」的兜底 —— 本版本清单里没有食物，照刷。
  items: [
    { type: 'almond_water', per1000m2: 1.2 },
    { type: 'food_ration', per1000m2: 0.6 },
    { type: 'firesalt', per1000m2: 0.1 },
  ],
  // ---------- 出口 ----------
  exits: [
    { to: '0', kind: 'door', note: '编号 105 的门（exits[0]）。已有此层，真能走通；中央广场东接口段就有一扇' },
    { to: '8', kind: 'door', note: '编号 8–20 的门各自对应层级（exits[1]），13 扇全部真能走通' },
    { to: '9', kind: 'door', note: '同上（exits[1]）' },
    { to: '10', kind: 'door', note: '同上（exits[1]）' },
    { to: '11', kind: 'door', note: '同上（exits[1]）' },
    { to: '12', kind: 'door', note: '同上（exits[1]）' },
    { to: '13', kind: 'door', note: '同上（exits[1]）' },
    { to: '14', kind: 'door', note: '同上（exits[1]）' },
    { to: '15', kind: 'door', note: '同上（exits[1]）' },
    { to: '16', kind: 'door', note: '同上（exits[1]）' },
    { to: '17', kind: 'door', note: '同上（exits[1]）' },
    { to: '18', kind: 'door', note: '同上（exits[1]）' },
    { to: '19', kind: 'door', note: '同上（exits[1]）' },
    { to: '20', kind: 'door', note: '同上（exits[1]）' },
    { to: '356', kind: 'door', note: '编号 356 的门（exits[2]）。Level 356 不在范围内：门照摆，只提示尚未开放' },
    { to: '669', kind: 'door', note: '编号 34 的门（exits[3]）。编号与目标层号对不上是原文自己的异常，原样保留；Level 669 不在范围内' },
    { to: '46', kind: 'door', note: '砂岩砌成的门（exits[4]）。Level 46 不在范围内；门扇上压了砂岩砌缝，认得出材质不同' },
    { to: 'fun', kind: 'door', note: '笑脸标签的门（exits[5]）。原文只写 "lead to a party! =)" 没点名层级；主会话 2026-09-19 拍板按「= 享乐层 =)」接上，给 Level Fun 补第二条入口' },
    { to: '1.5', kind: 'door', note: '没有标签的门（exits[6]）。Level 1.5 不在本作范围内' },
    { to: '21', kind: 'door', note: '编号被刮花、不在对照表里的门（exits[7]「更多时候把人送到 Level 21 的其他地方」）。每个走廊区块一扇，重进本层' },
    { to: '22', kind: 'hole', note: '走廊楼板塌穿的洞口，每条走廊每 3 块一处。本层选中版本（wikidot-en，成文于 Level 22 垮塌之前）的 exits 里没有这一条，依据在对方层级：level-22.json 的 wikidot-cn entrances[0]「由掉落的碎石和结构完整性丧失在 Level 21 的地板上形成的洞口」与 exits[0]「沿同一处垮塌洞口离开」；L22.js 已实现回程' },
    { to: '子层级', kind: 'door', note: '"Exit" 门后三条黑暗走廊两侧重复出现的门（exits[10]）。原文只说通向 Sub-sections，没给层号' },
    { to: '无编号层级', kind: 'door', note: '同上（exits[10]），通向 Unnumbered Levels，没给层号' },
  ],
  enter: function () {
    S.t = 0; S.nextShift = SHIFT_PERIOD; S.told = false; S.warnedDark = false;
  },
  update: function (ctx, dt) {
    S.t += dt;
    if (!S.told && S.t > 1.2) {
      S.told = true;
      if (BR.hud && BR.hud.toast) BR.hud.toast('四条走廊在这里十字交汇。实体从不进入中央广场。', 3600);
    }
    const P = BR.player;
    if (!P || !BR.world || !BR.world.chunkCoordsAt) return;
    const cc = BR.world.chunkCoordsAt(P.x, P.z);
    if (!cc) return;
    const reg = regionOf(cc.cx, cc.cz);
    // "Exit" 门后那一段（含东臂区块里那条北向通道）
    const inPassage = cc.cx === EXIT_CX && cc.cz === 0 && (P.z - cc.cz * SIZE) < C0;
    const dark = reg === 'dark' || inPassage;
    if (dark && !S.warnedDark) {
      S.warnedDark = true;
      if (BR.hud && BR.hud.toast) BR.hud.toast('这三条走廊不会移位，资源也多 —— 但实体在这里成群结队。', 4200);
    }
    // 走廊移位：引擎不能在运行时重建已经带碰撞体的区块，这里只做表现层
    // （远处一阵重新拼接的动静），真正的地形变形写进 notImplemented
    if (S.t >= S.nextShift) {
      S.nextShift = S.t + SHIFT_PERIOD;
      if (reg === 'ew' || reg === 'ns') {
        if (BR.audio && BR.audio.play) BR.audio.play('static', null, { volume: 0.5, rate: 0.6 });
        if (BR.hud && BR.hud.toast) BR.hud.toast('远处传来走廊移位、重新拼接的动静。只有门还在原地。', 3200);
      }
    }
  },
  leave: function () {
    S.t = 0; S.nextShift = SHIFT_PERIOD;
  },
});
})();
