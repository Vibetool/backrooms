// Level 12 - "矩阵"（The Matrix）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-12  许可：CC BY-SA 3.0
// 原作 Reddit 用户 u/JonasCBaldi3、u/Smbfanexe；Stretchsterz 重写；Azamo 重新编排；译者 thisuserdoesntexist
// （data/lore-choices.json levels["12"].source = "wikidot-cn"；抓取方式与作者见调研 JSON 的 fetchNote，
// 页面本身没有给出具体版本号/抓取日期，不编造）
// 只按这一个版本实现：wikidot-en 的「随机去 8 个层级」细节两个 wikidot 版本一致，照做；
// fandom 版本的「7 段线性路线」「Seers 实体」「医疗包/菜刀/轿车」「电视雪花+男声」「按错数字进 The Void」
// 等 conflicts 里列出的细节一律不借；本层大量字段选中版本原文标了 unverified（尺寸、灯光色温、声音、气味、
// 温度、天气、门/地板/天花板材质），一律不从别的版本补、不凭记忆编造，只用能撑起玩法的最小合理近似，并在
// 注释里写明是近似
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;
const U = BR.util;

// ---------- 尺寸 ----------
// layout「单个主房间 + 无限开阔的白色区域（不是迷宫）」——不用 kit.grid（_TEMPLATE.md 7.4 节：开阔层直接
// b.box/b.plane 搭）；scale 原文只写主房间「小」、白色区域「无限」，没有任何数字（unverified），
// chunkSize 取开阔层常用档位，房间尺寸按「小」取一个明显小于区块的房间
const SIZE = 32;                 // chunkSize：开阔层 32-48 档取下限，区块够大装得下"房间+大片空地"
const H = 2.8;                   // 层高：原文没给数字，用 kit 缺省层高（DEFAULT_HEIGHT）
const WALL_T = 0.2 * 4 / 3;      // 手砌墙沿用 kit.gridWalls 现在的默认厚度（用户 2026-09-13：原厚度 ×4/3）

// ---------- 主房间几何（世界坐标，chunk (0,0) 内固定的唯一房间）----------
// architecture「一个小的、明亮的、刷白色油漆的房间，里面只有一张桌子、一把椅子，旁边一扇锁着的门」
// + 附录「从房间中央能找到通向白色开放区域的『角落』」：三面墙 + 北墙留门洞，东墙只砌一半，
// 空出的东南角就是「角落」，直接连去区块里的白色空地（同一个 chunk 内，出了房间几步就是空地）
const ROOM_X0 = 12, ROOM_Z0 = 12, ROOM_X1 = 20, ROOM_Z1 = 20;      // 房间范围（8m×8m，明显小于 32m 的区块）
const ROOM_CX = (ROOM_X0 + ROOM_X1) / 2;                            // 16
const DOOR = { x: ROOM_CX, z: ROOM_Z0 };                            // 锁着的门（北墙）
const DOOR_TRIGGER = { x: ROOM_CX, z: ROOM_Z0 + 0.8 };              // 房间内侧、门跟前的判定点
const DESK = { x: 14, z: 14.5 };
const CHAIR = { x: 14, z: 16 };
const NOOK = { x: ROOM_X1 + 0.6, z: 18.5 };                         // 东南角缺口外一点，走出去就是空地
const SPAWN_PT = { x: 18, z: 16.5, yaw: 0 };                        // 出生/循环门返回点：房间里空地一侧
const ANCHOR = { x: (DESK.x + CHAIR.x) / 2, z: (DESK.z + CHAIR.z) / 2 };   // 「离桌椅越远情况越糟」的参照点

function insideRoomPad(x, z) { return x > ROOM_X0 - 1.5 && x < ROOM_X1 + 1.5 && z > ROOM_Z0 - 1.5 && z < ROOM_Z1 + 1.5; }

// ---------- 出口目的地（原文 exits 章节按顺序列出的 8 个，无触发条件区分）----------
const DEST = ['1', '4', '10', '19', '23', '25', '34', '287'];

// ---------- 材质 ----------
function defineMaterials() {
  // colors「主色调白色」，architecture「白色油漆」；门/地板/天花板材质原文没写（unverified），
  // 索性全层地板、天花板、墙统一用同一种白漆材质——反正原文就是要让人分不清房间和外面的白色区域
  kit.mat('L12:white', { color: 0xfbfbf7, roughness: 0.92, vertexColors: true });
}

// ---------- 旧家具（landmarks「旧的、被打坏的家具：灯具、椅子、桌子、抽屉，有的穿到地板一半以下」）----------
function oldLamp(b, x, z, rot, color) {
  // kit.prop 没有落地灯构件，自己用圆柱拼一个简易台灯（灯杆+倒锥灯罩），颜色用 kit:prop 顶点色，不建新材质
  b.push(x, z, rot);
  b.cylinder(0, 0, 0, 0.045, 1.05, 'kit:prop', { color, solid: true });
  b.cylinder(0, 1.05, 0, 0.2, 0.22, 'kit:prop', { rTop: 0.09, color, solid: false });
  b.pop();
}

// 验收修正（medium #3）：旧家具原来直接调完整的 kit.prop.desk/chair/cabinet 只改颜色，看不出「被打坏」——
// 改成不调用 kit.prop，自己拼一个明显残破的样子：主体用 THREE.BoxGeometry 手动 translate 再 rotateZ/rotateX
// 把倾角"烤"进顶点，再交给 b.mesh() 只叠加 builder 的偏航角——同一个支点的几块几何共享同一个倾角，
// 倒下后仍是一个整体（不是零件各转各的），而不是简单改色
function tiltGeo(geo, dx, dy, dz, tiltX, tiltZ) {
  geo.translate(dx, dy, dz);
  if (tiltZ) geo.rotateZ(tiltZ);
  if (tiltX) geo.rotateX(tiltX);
  return geo;
}
function meshPiece(b, geo, color) {
  b.mesh(geo, 'kit:prop', { color, solid: false });   // 残骸不挡路，solid:false（倾斜包围盒会比实际形状大一圈）
  geo.dispose();
}
function brokenDesk(b, rng, color) {
  // 桌腿断了一两条，桌面歪斜地耷拉着；尺寸对齐 kit.prop.desk 缺省值（W1.4×D0.7×H0.75）
  const W = 1.4, D = 0.7, Hh = 0.75;
  const tiltZ = 0.35 + rng() * 0.35, tiltX = (rng() - 0.5) * 0.3;   // 明显倾斜但没整个塌平（design 近似）
  meshPiece(b, tiltGeo(new THREE.BoxGeometry(W, 0.05, D), 0, Hh * 0.5, 0, tiltX, tiltZ), color);
  b.box(W / 2 - 0.07, 0, D / 2 - 0.07, 0.05, Hh * 0.55, 0.05, 'kit:prop', { color: 0x55585c });   // 唯一还立着的桌腿
}
function brokenChair(b, rng, color) {
  // 整把翻倒在地：座面+靠背当一块整体倾斜约 90°，五爪脚只剩一根断腿支棱着
  const tiltX = Math.PI / 2 + (rng() - 0.5) * 0.5, tiltZ = (rng() - 0.5) * 0.6;
  meshPiece(b, tiltGeo(new THREE.BoxGeometry(0.46, 0.62, 0.08), 0, 0.31, -0.19, tiltX, tiltZ), color);
  b.cylinder(0.15, 0.03, 0.15, 0.025, 0.3, 'kit:prop', { color: 0x2a2a26, axis: 'z', solid: false });
}
function brokenCabinet(b, rng, color) {
  // 柜体整体前倾倒地，4 层抽屉面板只画 2 层——少一两块板
  const H = 1.3, W = 0.9, D = 0.45;
  const tiltX = 0.9 + rng() * 0.5;
  meshPiece(b, tiltGeo(new THREE.BoxGeometry(W, H, D), 0, H / 2, 0, tiltX, 0), color);
  for (let k = 0; k < 2; k++) meshPiece(b, tiltGeo(new THREE.BoxGeometry(W - 0.14, 0.12, 0.02), 0, 0.2 + k * 0.32, D / 2 + 0.01, tiltX, 0), 0x55585c);
}

function placeOldFurniture(b, x, z, rot, kind, sunk, rng) {
  // 「有的穿到地板一半以下」没给具体深度，按家具腿部高度的一半估算做下沉量（design 近似）
  const sinkY = sunk ? -0.22 : 0;
  const color = 0x8f897c;   // 旧家具统一暗灰褐色，和房间里干净的桌椅拉开对比
  b.push(x, z, rot, sinkY);
  if (kind === 'desk') brokenDesk(b, rng, color);
  else if (kind === 'chair') brokenChair(b, rng, color);
  else if (kind === 'cabinet') brokenCabinet(b, rng, color);
  else oldLamp(b, 0, 0, 0, color);
  b.pop();
}

function scatterOldFurniture(b, rng, isSpawnChunk) {
  const count = 2 + Math.floor(rng() * 4);   // 每块 2-5 件，数量原文没给，按「landmark 常见但不铺满」估
  for (let k = 0; k < count; k++) {
    const fx = rng() * SIZE, fz = rng() * SIZE, rot = rng() * Math.PI * 2;
    const kind = U.weighted(rng, [['desk', 0.28], ['chair', 0.32], ['cabinet', 0.24], ['lamp', 0.16]]);
    const sunk = rng() < 0.3;
    if (isSpawnChunk && insideRoomPad(fx, fz)) continue;   // 房间内部保持干净，旧家具只出现在房间外的空地上
    placeOldFurniture(b, fx, fz, rot, kind, sunk, rng);
  }
}

// ---------- 白色区域里「和主房间门长得一样的门」（mechanics「穿过去会回到主房间」）----------
function placeLoopDoor(b, x, z, rot) {
  // solid:false：这扇门不是物理意义上锁着的门，走近就直接把人送回房间，不需要真的推开
  kit.prop.door(b, x, z, rot, { style: 'wood', open: 0, solid: false });
  const w = b.world(x, z);
  (b.data.loopDoors || (b.data.loopDoors = [])).push({ x: w.x, z: w.z });
}

// ---------- 区块 ----------
// rng 消耗顺序固定：出生块/空地块各自走各自固定的一套（是否出生块由 cx,cz 决定，不吃 rng）
function buildChunk(ctx, cx, cz, rng) {
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  const isSpawn = cx === 0 && cz === 0;

  // 地板铺满整块（房间和外面空地用同一种白漆，呼应「分不清房间边界」）
  kit.prop.floor(b, null, null, 0, { matKey: 'L12:white' });

  if (isSpawn) {
    // 三面墙 + 北墙门洞 + 东墙只砌一半（东南角空出来就是通往白色区域的「角落」）
    const doorHalf = 0.53;   // 门框实际宽度（style:'wood' 缺省 w=0.9）+ 门套一半，缺口比门略宽一点点
    const doorTop = 2.15;    // 门框高度（door() 内部 H+jw=2.05+0.08=2.13），过梁从这往上砌，避免和门框 z-fighting
    b.box(ROOM_X0 + (ROOM_CX - doorHalf - ROOM_X0) / 2, 0, ROOM_Z0, ROOM_CX - doorHalf - ROOM_X0, H, WALL_T, 'L12:white', { faces: 'sides' });
    b.box(ROOM_CX + doorHalf + (ROOM_X1 - ROOM_CX - doorHalf) / 2, 0, ROOM_Z0, ROOM_X1 - ROOM_CX - doorHalf, H, WALL_T, 'L12:white', { faces: 'sides' });
    b.box(ROOM_CX, doorTop, ROOM_Z0, doorHalf * 2, H - doorTop, WALL_T, 'L12:white', { faces: 'sides' });   // 门洞上方的过梁，补上两段墙之间的豁口
    b.box(ROOM_X0, 0, (ROOM_Z0 + ROOM_Z1) / 2, WALL_T, H, ROOM_Z1 - ROOM_Z0, 'L12:white', { faces: 'sides' });   // 西墙，整面
    b.box((ROOM_X0 + ROOM_X1) / 2, 0, ROOM_Z1, ROOM_X1 - ROOM_X0, H, WALL_T, 'L12:white', { faces: 'sides' });   // 南墙，整面
    b.box(ROOM_X1, 0, ROOM_Z0 + 2.5 / 2, WALL_T, H, 2.5, 'L12:white', { faces: 'sides' });   // 东墙只砌北边一段
    // 东墙南边 (ROOM_Z0+2.5)..ROOM_Z1 不砌墙：就是「角落」缺口，直接连到区块里的空地
    kit.prop.ceiling(b, ROOM_CX, (ROOM_Z0 + ROOM_Z1) / 2, 0, { matKey: 'L12:white', w: ROOM_X1 - ROOM_X0, d: ROOM_Z1 - ROOM_Z0, y: H });

    // 锁着的门：solid 缺省 true，open:0 时 kit 会在门洞中央再加一块挡板，整个洞完全堵死——正好是「锁着」
    kit.prop.door(b, DOOR.x, DOOR.z, 0, { style: 'wood', open: 0 });

    // 桌子（推不动、桌下有洞——两者都是静态摆件，天然「推不动」，洞本身不可进入、不挡路）
    kit.prop.desk(b, DESK.x, DESK.z, 0, { color: 0xb9925a });
    kit.prop.hole(b, DESK.x, DESK.z, 0, { r: 0.55, irregular: true, rimColor: 0x2a2a26 });
    kit.prop.chair(b, CHAIR.x, CHAIR.z, Math.PI, { color: 0x8a6a3c });   // 面朝北对着桌子/门

    // 8 个叠放在同一位置的「事件型」出口：仪式成功后只激活随机选中的那一个，其余保持 inactive
    for (const to of DEST) {
      kit.exit(b, { to, kind: 'event', x: DOOR_TRIGGER.x, z: DOOR_TRIGGER.z, radius: 1.0, tag: 'l12-main-door' });
    }
  } else {
    // 每个非出生块保证有且只有一扇循环门：不管玩家往哪走，进到当前这块地就已经站在「可以离开」的门跟前，
    // 满足「首期范围内出口 3-5 区块内可达」——这里比 3-5 块更严格，做到「所到之处即达」
    const dx = 8 + rng() * 16, dz = 8 + rng() * 16, drot = Math.floor(rng() * 4) * (Math.PI / 2);
    placeLoopDoor(b, dx, dz, drot);
  }

  scatterOldFurniture(b, rng, isSpawn);

  // 刷新点：5×5 网格 + 抖动，够“食物/杏仁水”这类稀疏物品用（第 16 节要求每块 ≥ 20 个）
  const DIV = 5, cell = SIZE / DIV;
  for (let j = 0; j < DIV; j++) for (let i = 0; i < DIV; i++) {
    const x = (i + 0.5) * cell + (rng() - 0.5) * cell * 0.7;
    const z = (j + 0.5) * cell + (rng() - 0.5) * cell * 0.7;
    b.spawn(x, z, 'floor');
  }

  return b.finish();
}

// ---------- 仪式与危害状态（enter 里重置）----------
// 验收修正（high #1）：这两步原文给的是「游戏世界里过去的时长」（十五分钟、一小时），不是要求玩家真的等
// 15/60 现实分钟——按 ARCHITECTURE.md「设定 1 小时 = 游戏 60 秒」换算（BR.itemKit.LORE_HOUR，用法参照
// L1.js 的 GARDEN_HOUR）：15 分钟 = 0.25 小时 → 0.25×60 = 15 秒；1 小时 → 60 秒
const LORE_HOUR = (BR.itemKit && BR.itemKit.LORE_HOUR) || 60;
const SEAT_SECONDS = 0.25 * LORE_HOUR;         // mechanics 步骤1「平均停留十五分钟」
const WAIT_SECONDS = LORE_HOUR;                // mechanics 步骤5「等待恰好一个小时」
const WAIT_WINDOW = 45 * (LORE_HOUR / 3600);   // 容差按同一个换算比例缩小，不再是脱离时间尺度的 45 现实秒
const CHAIR_R = 0.9, DOOR_R = 1.3, NOOK_R = 1.8, LOOP_R = 0.9;
const NEAR = 6, FAR = 40, MIN_MUL = 0.6, MAX_MUL = 2.0;   // 「离桌椅越远越糟」san 掉率线性插值的两端（design 近似）

const ENV = {
  background: 0xffffff, fogColor: 0xffffff,               // colors「主色调白色」——雾色=背景色，远处自然融成一片白，
  fogNear: 12, fogFar: 58,                                  // 就是「无限的白色深渊」，不用另建远景几何
  ambient: { color: 0xffffff, intensity: 1.05 },            // lighting 原文只写「明亮」，没提灯具/色温/闪烁：
                                                             // 不摆灯盘构件，只用环境光模拟这种没有明确光源、整体
                                                             // 雪亮到快看不出墙在哪的效果；intensity > 1 让材质本色
                                                             // (0xfbfbf7) 顶到接近死白，和雾色/背景连成一片（不生编灯具细节）
  sanityDrainMul: MIN_MUL, hungerDrainMul: 1,               // temperature/weather 原文 unverified，用默认饥饿掉率
  audio: 'silence',                                         // sounds 原文「unverified——环境声音未提及」，选最不生编的档
  darkness: false,
};

// dest：仪式抽中的目的地（不管是否已注册/是否首期范围内），配合 reassertMainDoor 每帧对齐句柄激活状态
const S = { clock: 0, seatTimer: 0, seated: false, doorTried: false, atCorner: false, loopUsed: false, waitStart: -1, exitOpened: false, dest: null };

function enter() {
  Object.assign(S, { clock: 0, seatTimer: 0, seated: false, doorTried: false, atCorner: false, loopUsed: false, waitStart: -1, exitOpened: false, dest: null });
  ENV.sanityDrainMul = MIN_MUL;
  // 验收修正（high #1 第三条）：第 1 步开始前游戏里完全没有提示，玩家不可能知道要去坐那把椅子——
  // 进层就给一句引导，指向房间里唯一能坐的东西
  BR.hud.toast('桌子上蒙着一层灰，那把转椅看起来还能坐——不如先坐下来歇一会儿', 4200);
}

// hazards「离桌子和椅子越远，情况越糟」：没给具体倍率，按距离线性插值 san 掉率（design 近似，写清楚两端取值依据）
function updateSanityByDistance() {
  const P = BR.player;
  const d = Math.sqrt(U.dist2(P.x, P.z, ANCHOR.x, ANCHOR.z));
  const t = U.clamp((d - NEAR) / (FAR - NEAR), 0, 1);
  const mul = MIN_MUL + t * (MAX_MUL - MIN_MUL);
  ENV.sanityDrainMul = mul;
  // 验收修正（low #5）：工坊地图激活 envOverride 时，world.js 的 envWrappedLevel 会把 env 拷成一份新对象
  // （Object.assign({}, base)），之后改 ENV 传不到玩家实际读的那份（BR.world.current.env）——同时写一次
  // 这份引用兼容两种情况；根治需要 env 支持函数式取值，已写进 apiRequests，这里先做近似
  const cur = BR.world && BR.world.current;
  if (cur && cur.env && cur.env !== ENV) cur.env.sanityDrainMul = mul;
}

// 验收修正（medium #2）：事件型出口默认不激活，之前只在仪式成功那一帧调一次 setActive(true)；
// 如果玩家之后走远到 chunk(0,0) 卸载的距离再回来，区块重建后出口又是关的，但 S.exitOpened 已经是
// true，updateRitual 直接 return，玩家再也出不去。改成把选中的目的地存进 S.dest，每帧都重新对齐一次
// 句柄激活状态（句柄本身在区块卸载后失效，_TEMPLATE.md 要求「每次用时重新取」，所以必须用 kit.handles
// 现取而不是缓存旧句柄）
function reassertMainDoor() {
  if (!S.dest) return;
  const list = kit.handles({ tag: 'l12-main-door' });
  for (let i = 0; i < list.length; i++) list[i].setActive(list[i].to === S.dest);
}

// mechanics「在白色区域穿过与主房间一样的门，会回到主房间」——用 BR.player.reset 做同层内瞬移，
// 不走 kit.exit(to:'12')：那样会整层重建（level.enter 会把下面的仪式进度全部清零），达不到「记得走到哪一步」
function checkLoopDoors() {
  const P = BR.player;
  const list = BR.world.chunks();
  for (let i = 0; i < list.length; i++) {
    const doors = list[i].res && list[i].res.data && list[i].res.data.loopDoors;
    if (!doors) continue;
    for (let k = 0; k < doors.length; k++) {
      const d = doors[k];
      if (U.dist2(P.x, P.z, d.x, d.z) > LOOP_R * LOOP_R) continue;
      const counted = S.atCorner && !S.loopUsed;   // 只有走完前面几步之后，这一下才算进仪式的第 4 步
      if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play('door');
      BR.player.reset({ x: SPAWN_PT.x, y: 0, z: SPAWN_PT.z, yaw: SPAWN_PT.yaw }, { full: false });
      if (counted) { S.loopUsed = true; BR.hud.toast('门在你身后合上——你又站回了那间白房间', 3200); }
      return;
    }
  }
}

// 离开仪式：1 坐椅子 → 2 试锁着的门 → 3 走到角落 → 4（循环门，checkLoopDoors 负责）→ 5 等满一小时再回门口
function updateRitual(ctx, dt) {
  if (S.exitOpened) return;
  const P = BR.player;
  const atChair = U.dist2(P.x, P.z, CHAIR.x, CHAIR.z) <= CHAIR_R * CHAIR_R;
  if (!S.seated) {
    S.seatTimer = atChair ? S.seatTimer + dt : 0;   // 中途起身重新计时——原文「停留」理解为连续坐着（design 近似）
    if (S.seatTimer >= SEAT_SECONDS) { S.seated = true; BR.hud.toast('你坐够了大概十五分钟，该起来看看那扇门了', 3600); }
    return;
  }
  const atDoor = U.dist2(P.x, P.z, DOOR_TRIGGER.x, DOOR_TRIGGER.z) <= DOOR_R * DOOR_R;
  if (!S.doorTried) {
    if (atDoor) { S.doorTried = true; BR.hud.toast('门锁着，和探险记录里写的一样——但这一步必须走一遍', 3200); }
    return;
  }
  const atNook = U.dist2(P.x, P.z, NOOK.x, NOOK.z) <= NOOK_R * NOOK_R;
  if (!S.atCorner) {
    if (atNook) { S.atCorner = true; BR.hud.toast('房间的边界毫无征兆地断了，脚下连着看不到头的白色空间', 3200); }
    return;
  }
  if (!S.loopUsed) return;
  if (S.waitStart < 0) { S.waitStart = S.clock; BR.hud.toast('该做的都做完了，剩下的只有等——原文说要等恰好一小时', 3600); return; }
  if (!atDoor) return;
  const elapsed = S.clock - S.waitStart;
  if (elapsed < WAIT_SECONDS - WAIT_WINDOW) { BR.hud.toast('还没到时候，得等满一整个小时', 1600); return; }
  if (elapsed > WAIT_SECONDS + WAIT_WINDOW) {
    BR.hud.toast('好像已经错过了那个点，只能从头再来一遍', 3200);
    Object.assign(S, { seated: false, doorTried: false, atCorner: false, loopUsed: false, waitStart: -1, seatTimer: 0 });
    return;
  }
  // 卡在整点前后：转动把手，随机去 8 个目的地之一（原文出口章节按顺序列出，没写触发条件区分）
  const pick = U.rng(ctx.levelSeed, 'L12-ritual-exit', Math.floor(S.waitStart * 1000) >>> 0);
  const dest = DEST[Math.floor(pick() * DEST.length)];
  S.dest = dest;   // reassertMainDoor 每帧按这个值对齐句柄，句柄本身照常激活（low #4：让 world 走标准的"尚未开放"提示）
  if (!BR.levels.has(dest)) {
    // 验收修正（high #1 + low #4）：抽到首期范围内还没注册 / 范围外的层，不再整套清零仪式（那样期望要
    // 200 分钟现实时间）——句柄仍然激活，world.js 的 isSealed()/collectInside() 会自己判出「尚未开放」
    // 并显示 kit 标准的 sealedText 提示；这里只重置第 5 步（重新等一轮），前 4 步的进度保留，
    // 保证正常游玩能在合理时间内抽中 1/4/10 这三个已注册的目的地离开
    BR.hud.toast('把手转开的一瞬间又合上了——那扇门通向的地方还没准备好，得重新等一轮', 3600);
    S.waitStart = -1;
    return;
  }
  S.exitOpened = true;
  BR.hud.toast('把手在恰好的时刻转开了', 2600);
}

function update(ctx, dt) {
  S.clock += dt;
  checkLoopDoors();
  updateSanityByDistance();
  updateRitual(ctx, dt);
  reassertMainDoor();
}

BR.levels.register({
  id: '12', name: 'Level 12', title: '矩阵', nickname: '矩阵',
  version: 'wikidot-cn',
  survivalClass: '0',
  chunkSize: SIZE,
  env: ENV,
  spawn() { return { x: SPAWN_PT.x, y: 0, z: SPAWN_PT.z, yaw: SPAWN_PT.yaw }; },
  buildChunk,
  // entityDensityOverall「到目前为止 M.E.G. 数据库中没有 Level 12 实体踪迹的记录」（entities:[] 原文也是空）：
  // 用户规则「版本说没有实体：entities:[]，不为热闹加实体」；entity-index.json 里本批的 hunter/infecting_agent
  // 的 levels 只标了 "14"，和本层无关，因此本层不放
  entities: [],
  items: [
    { type: 'almond_water', per1000m2: 1.2 },                          // 用户规则：所有模式都刷杏仁水
    { type: 'almond_water_blue', per1000m2: 0.06 },                    // item-spawn.json：彩色瓶里蓝色最常见
    { type: 'almond_water_green', per1000m2: 0.04 },                   // item-spawn.json：绿色次之
    { type: 'almond_water_red', per1000m2: 0.002 },                    // item-spawn.json：红色至今只发现过 5 瓶
    { type: 'royal_rations', per1000m2: 0.01 },                        // item-spawn.json：极稀有，出现地点无规律
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },                // item-spawn.json：稀有度 7/10，多数层级都有但很少
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },     // item-spawn.json：人工款比蓝色瓶更少
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },         // item-spawn.json：黑色款最少
    { type: 'moth_jelly', per1000m2: 0.003 },                          // item-spawn.json：极稀有、交易价值高
    { type: 'food_ration', per1000m2: 0.6 },                           // 用户规则：所有模式都刷食物（兜底）
  ],
  exits: [
    { to: '1', kind: 'event', note: 'exits[0]：完成开门仪式后，主房间的门随机通向 8 个目的地之一（唯一有实际记录成功案例：Gav 走通）' },
    { to: '4', kind: 'event', note: 'exits[1]：仪式随机目的地之一，原文未写触发条件' },
    { to: '10', kind: 'event', note: 'exits[2]：仪式随机目的地之一' },
    { to: '19', kind: 'event', note: 'exits[3]：仪式随机目的地之一' },
    { to: '23', kind: 'event', note: 'exits[4]：仪式随机目的地之一，Level 23 不在首期范围，抽中会摆同一扇门但提示尚未开放' },
    { to: '25', kind: 'event', note: 'exits[5]：仪式随机目的地之一，Level 25 不在首期范围' },
    { to: '34', kind: 'event', note: 'exits[6]：仪式随机目的地之一，Level 34 不在首期范围' },
    { to: '287', kind: 'event', note: 'exits[7]：仪式随机目的地之一，Level 287 不在首期范围' },
  ],
  enter, update,
  leave() {},
});
})();
