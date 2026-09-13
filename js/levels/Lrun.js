// Level !「尘封已久的感叹号…」（Run For Your Life 只出现在配图文件名里，正文没有这个说法）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/long-forgotten-exclamation  许可：CC BY-SA 3.0
// 抓取：2026-09-12。lore-choices.json 里 Level ! 的键是 "!"，随机选中 wikidot-cn（用户 2026-09-13 亲自确认保留这个荒废版，
// 不用 Fandom 的追逐版：这里满地骨头、墙上抓痕、地面坑洞、微弱红光，没有追逐、没有活着的实体）
// 只按这一个版本实现，wikidot-en/fandom 的细节（血红病房、锁链门、警报、死亡飞蛾追猎、假出口、蓝色安全区……）一律不借
// 经典 <script>，只往 window.BR 上挂东西；依赖 js/levels/_kit.js
(function () {
'use strict';
const BR = window.BR;
const kit = BR.kit;

// ---------- 文件协议兜底：双击 index.html 打开时读不到 jpg，先注册一版简单画法（15 节步骤 7） ----------
BR.assets.registerProcedural('lrun_wall_scratched', 256, (g, s) => {
  g.fillStyle = '#948a78'; g.fillRect(0, 0, s, s);
  const r = BR.util.rng('lrun_wall_scratched-fallback');
  for (let k = 0; k < 500; k++) { const v = 130 + r() * 40 | 0; g.fillStyle = `rgba(${v},${v - 6},${v - 16},0.25)`; g.fillRect(r() * s, r() * s, 2, 2); }
  g.strokeStyle = 'rgba(210,204,190,0.35)'; g.lineWidth = 1.4;
  for (let k = 0; k < 10; k++) { const x = r() * s, y = r() * s, len = s * (0.15 + r() * 0.25), a = -0.7 + r() * 0.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); }
});

// ---------- 尺寸 ----------
// 单线路层：一条路走到底，没有格子迷宫（layout「单线路：门→第一个房间→实体聚集的房间→通向走廊的门→长走廊→尽头的光」）。
// chunkSize 用比常规迷宫小的 16m，方便按区块下标 cx 摆放固定的房间/走廊顺序
const S = 16, H = 2.8;                    // 层高原文未给数字（unverified），用 kit.DEFAULT_HEIGHT 同值
const WALL_T = 0.2 * 4 / 3;               // 手砌墙沿用 kit.gridWalls 现在的默认厚度（用户 2026-09-13：原厚度 ×4/3）
const ROOM_W = 4.4, RZ0 = 8 - ROOM_W / 2, RZ1 = 8 + ROOM_W / 2;     // 第一个房间/实体聚集房间的宽度：原文未给尺寸（unverified），取比走廊宽一些的房间感
const PATH_W = 3.2, PZ0 = 8 - PATH_W / 2, PZ1 = 8 + PATH_W / 2;     // 走廊宽度：原文只说「不算长」「够两人互相搀扶绕过坑洞」，unverified，取常规走廊宽
const DOOR_HALF = 0.53;                   // 门框实际宽度（缺省 0.9）+ 门套一半，缺口比门略宽一点点（同 L12 做法）
const DOOR_TOP = 2.13;                    // 门框高度（门高 2.05 + 门套 0.08），过梁从这往上砌，避免和门框 z-fighting

// ---------- 单线路各站的区块下标（cx），cz 恒为 0 ----------
const ROOM1_CX = 0;      // 第一个房间：反光金属、微弱红光（landmarks「完全包覆反光金属，微弱红光」）
const ROOM2_CX = 1;      // 实体聚集的房间：现在空了，满地骨头（landmarks「满是骨头，闻着像死过东西」）
const CORR_START = 2;    // 走廊起点：骨头比上一个房间还多（landmarks「走廊：骨头比上一个房间还多」）
const CORR_TAPER_END = 7;// 走廊后段：残骸清理干净（layout「后段的残骸译文说已经被清理干净」），f 在这里降到 0
const LAST_CX = 8;       // 走廊尽头：看到光，就是出口（layout「尽头看到光，到达终点」）
const ENTRANCE_X = 1.4;  // 入口门（画着褪色感叹号，entrances[0]：Level 109 的那扇门），关闭、不可互动
const ROOM1_DOOR_X = 15.5;  // 传说里锁着、现在已经空了的那扇门（mechanics「起始之室有两扇门，一扇锁着」+ 现状「已经空了」）
const ROOM2_DOOR_X = 15.5;  // 通向走廊的门（landmarks「通向走廊的门」）
const END_DOOR_X = 13.5;    // 走廊尽头的门：故事在推门前结束，门后是什么没有写（exits[0]「实际结果 unknown」）
const BONE_COLOR = 0xdcd0b6;

// ---------- 材质 ----------
function defineMaterials() {
  // 第一个房间：完全包覆反光金属（materials「传说资料：流浪者进入的第一个房间四周全是反光金属」）；
  // metalness 不能给太高——Phong 材质换算后金属感强会把漫反射压得很低，红光基本照不亮房间，只留一点镜面高光，
  // 这里取低一点的 metalness，既有金属光泽、又能被灯光照出「微弱红光」的效果
  kit.mat('Lrun:metal', { tex: 'metal', repeatMeters: 2.2, roughness: 0.4, metalness: 0.15, color: 0xaab0b4 });
  // 实体聚集的房间往后：老旧积灰、布满抓痕（materials「灰尘多得像很老的建筑」「墙上有划痕」）
  kit.mat('Lrun:wall', { tex: 'lrun_wall_scratched', repeatMeters: 2.4, roughness: 0.97, vertexColors: true });
  // 地面：灰尘覆盖（materials 同上），没有专门的地面描述，借用已有 concrete 压成灰褐色
  kit.mat('Lrun:floor', { tex: 'concrete', repeatMeters: 2.6, roughness: 1, color: 0x928a76 });
  // 天花板：原文没写颜色（unverified），与地面同源压更暗，呼应「那些灯呢」的死寂昏暗
  kit.mat('Lrun:ceiling', { tex: 'concrete', repeatMeters: 2.6, roughness: 1, color: 0x585247 });
}

// ---------- 手砌墙：沿 x 走向的两侧长墙（走廊/房间的左右边界，全程不开豁口） ----------
function longWalls(b, wZ0, wZ1, matKey) {
  b.box(8, 0, wZ0, S, H, WALL_T, matKey, { faces: 'sides' });
  b.box(8, 0, wZ1, S, H, WALL_T, matKey, { faces: 'sides' });
}

// ---------- 手砌墙：垂直于走向、中间留门洞的横墙（房间/走廊分段处的门） ----------
function crossWallGap(b, x, wZ0, wZ1, matKey) {
  const gZ0 = 8 - DOOR_HALF, gZ1 = 8 + DOOR_HALF;
  b.box(x, 0, (wZ0 + gZ0) / 2, WALL_T, H, gZ0 - wZ0, matKey, { faces: 'sides' });
  b.box(x, 0, (gZ1 + wZ1) / 2, WALL_T, H, wZ1 - gZ1, matKey, { faces: 'sides' });
  // 门洞上方的过梁：验收②发现只给 sides（无顶无底）会露出过梁下表面的黑缝——过梁顶面贴着上方墙体看不见，
  // 但底面正对着门洞下方的玩家视线，必须补回来，改用 noTop（留底面、去顶面）
  b.box(x, DOOR_TOP, 8, WALL_T, H - DOOR_TOP, gZ1 - gZ0, matKey, { faces: 'noTop' });
}

// ---------- 刷新点：非格子层手动撒点（7.4 节：规则网格 + rng 抖动，每块 ≥20 个） ----------
function scatterSpawns(b, rng, zLo, zHi) {
  const margin = 0.35, spacing = 1.3;
  for (let x = margin; x <= S - margin; x += spacing) {
    for (let z = zLo + margin; z <= zHi - margin; z += spacing) {
      b.spawn(x + (rng() - 0.5) * 0.4, z + (rng() - 0.5) * 0.4, 'floor');
    }
  }
}

// ---------- 骨头/碎屑：贴近形状的小几何堆叠，不用纯色方块凑数（规则⑤） ----------
// density「原文没有数字：实体聚集的房间有骨头，走廊比这个房间还多，越往后碎屑越少」——数量按 factor 线性换算，过程写在调用处
function scatterBones(b, rng, x0, x1, factor, zLo, zHi, maxClusters) {
  const n = Math.round(factor * maxClusters);
  for (let k = 0; k < n; k++) {
    const x = x0 + rng() * (x1 - x0);
    const z = zLo + rng() * (zHi - zLo);
    b.push(x, z, rng() * Math.PI * 2);
    // 验收②：原来 2~3 根、每根只有 2.6~3.8cm 粗，隔远看就是零星几根白棍，撑不起"满地骨头"——
    // 加到 3~5 根、加粗加长一点，三角面仍然很省（每根圆柱只有 5 段），单块的面数远没到 8000 的预算
    const pieces = 3 + Math.floor(rng() * 3);   // 3~5 根长骨一堆，一小截骨架残骸
    for (let p = 0; p < pieces; p++) {
      b.push((rng() - 0.5) * 0.55, (rng() - 0.5) * 0.55, rng() * Math.PI * 2);
      b.cylinder(0, 0.03, 0, 0.03 + rng() * 0.014, 0.24 + rng() * 0.18, 'kit:prop', { axis: 'x', segments: 5, color: BONE_COLOR, solid: false });
      b.pop();
    }
    if (rng() < 0.7) {   // 头骨状的圆坨（landmarks「有些骨头已经裂开」），概率和尺寸都提高，验收②之前太小太少见
      b.cylinder((rng() - 0.5) * 0.35, 0, (rng() - 0.5) * 0.35, 0.1 + rng() * 0.03, 0.12, 'kit:prop', { rTop: 0.05, segments: 6, color: BONE_COLOR, solid: false });
    }
    b.pop();
  }
}

// ---------- 地面坑洞（landmarks「坑洞陷阱区：落差很大」；hazards「走廊地面的坑洞陷阱」） ----------
function scatterPits(b, rng, x0, x1, factor, zLo, zHi, maxCount) {
  const n = Math.round(factor * maxCount);
  for (let k = 0; k < n; k++) {
    const x = x0 + rng() * (x1 - x0);
    const z = zLo + rng() * (zHi - zLo);
    const r = 0.45 + rng() * 0.3;
    kit.prop.hole(b, x, z, 0, { r, irregular: true, rimColor: 0x1c1712 });
    const w = b.world(x, z), rr = r * 0.7;
    let hit = false;
    b.update(() => {
      const P = BR.player, dx = P.x - w.x, dz = P.z - w.z;
      const inside = dx * dx + dz * dz < rr * rr;
      if (inside && !hit) {
        hit = true;
        BR.hud.toast('脚下一空，你一脚踩进了坑洞里！', 1800);
        // 环境伤害约定（14 节）：只在 attackPlayers 为真时扣血，游玩/测试模式只给提示
        if (BR.game.attackPlayers) BR.player.damage({ hp: 6, sanity: 1, source: 'hazard:pit' });
      } else if (!inside) {
        hit = false;   // 验收④：走出坑洞范围就重新武装，允许再次踩中同一个坑——不是真的会掉下去，只是不永久失效
      }
    });
  }
}

// ---------- 区块 1：第一个房间（反光金属、微弱红光） ----------
function buildRoom1(b, rng) {
  longWalls(b, RZ0, RZ1, 'Lrun:metal');
  kit.prop.floor(b, 8, 8, 0, { matKey: 'Lrun:metal', w: S, d: ROOM_W });
  kit.prop.ceiling(b, 8, 8, 0, { matKey: 'Lrun:metal', w: S, d: ROOM_W, y: H });
  // 入口：画着褪色、刮花感叹号的门（entrances[0]「Level 109 的那扇门」）。Level 109 不在首期范围，
  // 这扇门只做背景交代，不做可互动的反向出口——关闭、上碰撞
  crossWallGap(b, ENTRANCE_X, RZ0, RZ1, 'Lrun:metal');
  kit.prop.door(b, ENTRANCE_X, 8, -Math.PI / 2, { style: 'metal', open: 0, solid: true, color: 0x726f66 });
  // 验收①：这层的名字和地标就是门上那个褪色、刮花的感叹号（landmarks[0]/entrances[0]「门上画着感叹号」），
  // 之前只砌了素面门，漏了这个定名地标。感叹号是图形不是文字，不算规则⑥"模型上文字"的限制；
  // 用同一个 push 系（与 door() 内部关门时 leaf 的落点一致：open=0 时铰链位移和 part 的 W/2 抵消，
  // 门扇正好落在这次 push 的原点上）在房间一侧（+X，玩家进门后回头能看到的那面）贴两块薄块拼出竖杠+小方块；
  // 门扇厚 0.045（半厚 0.0225），块中心离门扇局部 z=-0.075、块厚 0.02，最近面离门扇表面约 4.25cm，够规则⑦的 ≥3cm 间隙
  b.push(ENTRANCE_X, 8, -Math.PI / 2);
  const markColor = 0xcdc6b0;   // 旧白漆褪色后偏灰米色（materials「褪色」）
  b.box(0, 1.05, -0.075, 0.09, 0.58, 0.02, 'kit:prop', { color: markColor, solid: false });   // 感叹号竖杠
  b.box(0, 0.78, -0.075, 0.11, 0.13, 0.02, 'kit:prop', { color: markColor, solid: false });   // 感叹号下面的小方块
  b.pop();
  // 通往下一个房间的门：传说里锁着、现在已经空了（mechanics「起始之室有两扇门，一扇锁着」+「现在已经空了」），做成开着的门
  crossWallGap(b, ROOM1_DOOR_X, RZ0, RZ1, 'Lrun:metal');
  kit.prop.door(b, ROOM1_DOOR_X, 8, -Math.PI / 2, { style: 'metal', open: 1, solid: false, color: 0x63615a });
  // 微弱红光（environment.lighting「传说资料：第一个房间被微弱红光照亮」），没有闪烁描述，稳定不闪
  // 注意：b.light 的 x/z 是当前坐标系（本块局部），内部自己会加 this.ox/this.oz——不能像 b.world() 那样先转世界坐标再传，否则会被加两次偏移
  b.light({ x: 8, y: H - 0.4, z: 8, color: 0xff4a38, intensity: 0.8, range: 8 });
  scatterSpawns(b, rng, RZ0, RZ1);
}

// ---------- 区块 2：实体聚集的房间（现在空了，满地骨头，恶臭） ----------
function buildRoom2(b, rng) {
  longWalls(b, RZ0, RZ1, 'Lrun:wall');
  kit.prop.floor(b, 8, 8, 0, { matKey: 'Lrun:floor', w: S, d: ROOM_W });
  kit.prop.ceiling(b, 8, 8, 0, { matKey: 'Lrun:ceiling', w: S, d: ROOM_W, y: H });
  // 西侧不砌墙：紧接 Room1 东侧的门洞（同一处豁口，两块各建一半没必要，Room1 已经建好那扇门）
  // 通向走廊的门（landmarks「通向走廊的门」）
  crossWallGap(b, ROOM2_DOOR_X, RZ0, RZ1, 'Lrun:wall');
  kit.prop.door(b, ROOM2_DOOR_X, 8, -Math.PI / 2, { style: 'metal', open: 1, solid: false, color: 0x55524a });
  // 满地骨头（landmarks「满是骨头，闻着像死过东西」）；density 原文说走廊比这个房间还多，这里按中等密度给
  // 验收②：maxClusters 从 10 提到 28（factor 0.65 下即 7→18 簇），撑满约 50m² 的房间才读得出"满地"
  scatterBones(b, rng, 0.6, ROOM1_DOOR_X - 2, 0.65, RZ0 + 0.3, RZ1 - 0.3, 28);
  // 恶臭：environment.smells「实体聚集的房间闻起来像有东西死在里面，让人作呕」，只做一次性提示，不做持续扣血（原文没写会造成伤害）
  const w0 = b.world(8, 8);
  let stenchShown = false;
  b.update(() => {
    if (stenchShown) return;
    const P = BR.player, dx = P.x - w0.x, dz = P.z - w0.z;
    if (dx * dx + dz * dz < 36) { stenchShown = true; BR.hud.toast('浓重的腐臭味扑面而来，你差点吐出来', 2200); }
  });
  scatterSpawns(b, rng, RZ0, RZ1);
}

// ---------- 区块 3+：走廊（骨头/坑洞随 cx 递减，尽头有光和出口） ----------
function buildCorridor(b, cx, rng) {
  // f：1 在走廊起点（骨头最多），线性降到 0（CORR_TAPER_END 及以后已经被清理干净）——换算依据 layout「越往后碎屑越少」
  const f = Math.max(0, 1 - (cx - CORR_START) / (CORR_TAPER_END - CORR_START));
  longWalls(b, PZ0, PZ1, 'Lrun:wall');
  kit.prop.floor(b, 8, 8, 0, { matKey: 'Lrun:floor', w: S, d: PATH_W });
  kit.prop.ceiling(b, 8, 8, 0, { matKey: 'Lrun:ceiling', w: S, d: PATH_W, y: H });
  // 验收②：走廊起点（f=1）maxClusters 从 8 提到 34，比 Room2 更多（landmarks「走廊：骨头比上一个房间还多」），
  // f 沿走廊线性衰减，后段自然稀疏到 0，不需要单独再调
  scatterBones(b, rng, 0.4, S - 0.4, f, PZ0 + 0.25, PZ1 - 0.25, 34);
  scatterPits(b, rng, 1.5, S - 1, f, PZ0 + 0.4, PZ1 - 0.4, 2);
  if (cx === LAST_CX) {
    // 走廊尽头：看到光，就是出口（layout「尽头看到光，到达终点」）。exits[0] 的去向原文没写死——
    // 传说说随机层级，但角色认为现在的状态大概传送不了随机层级；故事在推门前结束，没写门后是什么，
    // 也不是首期范围内任何一个已开放层级，按规则⑫不编造目的地，照原文做成 sealed
    crossWallGap(b, END_DOOR_X, PZ0, PZ1, 'Lrun:wall');
    kit.exit(b, {
      to: '?', kind: 'door', x: END_DOOR_X, z: 8, rot: -Math.PI / 2, style: 'metal',
      sealed: true, sealedText: '门后是什么，没有人知道——想离开可以从暂停菜单返回主页',
      label: '走廊尽头的门', door: { solid: true, color: 0x4a4640 },   // 验收⑤：label 会透传到创意工坊编辑器 UI，调研标签不能带过去
    });
    // 「看到光」：暖白光源，和全程的死寂昏暗、房间一的冷红光都不一样，作为终点的视觉标记
    // b.light 用当前坐标系（局部），不要先 b.world() 转换（否则区块原点会被加两次，见 buildRoom1 的注释）
    b.light({ x: END_DOOR_X - 3, y: H - 0.4, z: 8, color: 0xfff0c0, intensity: 1.15, range: 9 });
  }
  scatterSpawns(b, rng, PZ0, PZ1);
}

// ---------- 单线路之外：玩家到不了的地方（两侧长墙已经把路封死），用一块实心占位，便宜且不会露馅 ----------
function buildFiller(ctx, cx, cz, rng) {
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  b.box(S / 2, -1, S / 2, S, H + 2, S, 'kit:prop', { color: 0x0a0806 });
  return b.finish();
}

// ---------- 区块分发 ----------
function buildChunk(ctx, cx, cz, rng) {
  if (cz !== 0 || cx < 0 || cx > LAST_CX) return buildFiller(ctx, cx, cz, rng);
  defineMaterials();
  const b = kit.builder(ctx, cx, cz, rng, { height: H });
  if (cx === ROOM1_CX) buildRoom1(b, rng);
  else if (cx === ROOM2_CX) buildRoom2(b, rng);
  else buildCorridor(b, cx, rng);
  return b.finish();
}

BR.levels.register({
  id: 'run', name: 'Level !', title: '尘封已久的感叹号…', nickname: '',
  version: 'wikidot-cn',                 // = lore-choices.levels['!'].source
  survivalClass: '生存难度：其他（隐秘层级，没有具体等级）',
  chunkSize: S,
  env: {
    // 全程死寂昏暗（sounds「莫名地死气沉沉」，lighting「一进门就问那些灯呢」），
    // 但按规则①：ambient 要用正常亮度的色调、只靠 intensity 调暗，不能直接给近黑色，否则会整屏纯黑
    background: 0x120e0b, fogColor: 0x120e0b, fogNear: 2.5, fogFar: 20,
    ambient: { color: 0xfff2e6, intensity: 0.13 },
    // 荒废、恶臭带来的不安，但没有活体威胁，够不上"压抑/危险"档，只给轻微加成
    sanityDrainMul: 1.1, hungerDrainMul: 1, audio: 'silence', darkness: false,
  },
  spawn() { return { x: 2.8, y: 0, z: 8, yaw: -Math.PI / 2 }; },   // 刚走进感叹号门，面朝走廊方向（+X），离入口留够距离免得回头贴脸看门
  buildChunk,
  // entities：entityDensityOverall「none：全程没遇到任何活着的实体，只有骨头和抓痕」——版本明确说没有活的实体，
  // 不为热闹加实体；骨头/抓痕已经用几何和贴图表现，笑魇只是角色闲聊里的推测（notes），不算本层设定，不刷
  entities: [],
  items: [
    // 选中版本 items 是空的，但用户规则要求所有模式都刷杏仁水和食物，照刷、依据写"用户规则"
    { type: 'almond_water', per1000m2: 1.2 },              // 用户规则：所有模式都刷杏仁水
    { type: 'almond_water_blue', per1000m2: 0.06 },        // data/item-spawn.json：fandom 稀有彩瓶，蓝色最常见
    { type: 'almond_water_green', per1000m2: 0.04 },       // data/item-spawn.json：稀有彩瓶，绿色次之
    { type: 'almond_water_red', per1000m2: 0.002 },        // data/item-spawn.json：稀有彩瓶，红色至今只发现过 5 瓶
    { type: 'royal_rations', per1000m2: 0.01 },            // data/item-spawn.json：wikidot-cn 稀有物资，位置没有规律
    { type: 'lightning_in_a_bottle', per1000m2: 0.03 },    // data/item-spawn.json：稀有度 7/10，大多数层级都有但很少
    { type: 'lightning_in_a_bottle_artificial', per1000m2: 0.01 },
    { type: 'lightning_in_a_bottle_black', per1000m2: 0.005 },
    { type: 'moth_jelly', per1000m2: 0.003 },              // data/item-spawn.json：极其稀有，零散分布在没有死亡飞蛾的层级
    { type: 'food_ration', per1000m2: 0.6 },               // 用户规则兜底：所有模式都刷至少一种食物
  ],
  exits: [
    // exits[0]：走到走廊尽头，看到光就是出口；去向原文没写死（传说说随机层级，但角色认为现在传送不了），
    // 也不是首期范围内任何一个已开放层级——不编造目的地，照原文做成 sealed 门
    { to: '?', kind: 'door', note: '走廊尽头的门：故事在推门前结束，没写门后是什么，照原文做 sealed（exits[0]）' },
  ],
  enter(ctx) {
    // 灰尘一进门就呛得咳嗽（smells「一进门就呛得咳嗽」）；这里没有通往已开放层级的路，按规则⑫顺带告诉玩家怎么离开
    BR.hud.toast('浓重的灰尘呛得你剧烈咳嗽起来……这里早已荒废，记录里出口的去向没有写清楚，想离开可以从暂停菜单返回主页', 5400);
  },
  update() {}, leave() {},
});
})();

// ============================================================
// 没有实现/做了简化的细节及原因：
// 1) 坑洞陷阱区的"落差很大"（landmarks「坑洞陷阱区：落差很大」）：引擎没有坠落/摔落判定（单层 XZ 网格，见下方
//    apiRequests），近似成踩进坑洞范围触发一次 toast + 6 点 HP（仅 attackPlayers 为真时扣），走出范围后重新
//    武装、可以再次触发，不是真的会掉下去或困住。
//
// apiRequests（引擎/kit 目前缺、只能近似实现的能力）：
// - 玩家坠落/大落差物理（掉进深坑、跌落高台）：当前只能用"触碰圆形范围→一次性提示+扣血"近似，不会真的让
//   玩家掉下去、也没有摔落后的处境（困在坑底、需要爬出等）。

