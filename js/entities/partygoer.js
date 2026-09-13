// 派对客 Partygoer（Entity C-233）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-c-233  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
//
// 选中版本写了"下肢形态不固定：有时像人类一样有明确的腿，有时像跳棋棋子的底座（圆台形）"两种下肢，
// 外形以外的字段（数值/行为/攻击）原文没有按下肢形态拆开描述，按 _TEMPLATE.md 第 1 节拆成
// partygoer_biped（人腿型）/ partygoer_pedestal（圆台底座型）两个 type，共用同一套数值与行为。
// 用户特别提醒：这是社区最知名实体之一（俗称"黄色笑脸派对客"），本文件严格只做选中版本写到的样子——
// 光滑革质亮黄色皮肤（变种暗黄/棕黄/橙/白）、脸上纯红色卡通笑脸（原文没提眼睛，不画）、手臂末端是
// 长满牙的七鳃鳗状嘴——不额外加同人形象里常见但原文没写的派对帽或衣物。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---------------- 共用数值（appearance/behavior/attack 段没有按下肢形态拆开）----------------

const FACE_RED = 0xd42a20;     // 依据："脸上是一个由红色物质构成的卡通笑脸"
const TEETH_COLOR = 0xf2ede0;  // 依据：手臂末端嘴"里有几排锋利牙齿"——原文没给牙齿颜色，取普通牙齿浅色，非设定
const MOUTH_DARK = 0x160a0a;   // 手臂末端嘴的口腔开口色：原文没写颜色，取深色让"嘴"读起来是个洞而不是一颗球，非设定

// 依据："皮肤光滑呈革质，通常亮黄色，变种可为暗黄、棕黄、橙色或白色"——亮黄色权重更高（呼应"通常"），
// 其余四种变种各占一份；具体比例原文没给，非设定，只保证亮黄仍是抽到最多的颜色
const PALETTE = [0xf5d21f, 0xf5d21f, 0xf5d21f, 0xc9a227, 0xa9762f, 0xe8792a, 0xece6d8];

function pickBodyColor(ctx) {
  // 用实体 id 哈希取色而不是 Math.random()：build() 在房主和客机两端各跑一次，必须选出同一个颜色，
  // 否则联机时同一只派对客在两台机器上会显示成不同颜色
  const id = (ctx && ctx.entity && ctx.entity.id) || 'partygoer';
  const h = BR.util.hashStr(String(id));
  return PALETTE[h % PALETTE.length];
}

// 笑脸尺寸换算：A.parts.humanoid 的 face 选项内部把 glowFaceGeo 的 width 设成 headR×1.5（_archetypes.js
// buildFace 调用处）。早期版本借用 glowFaceGeo 的 teeth 型笑脸（一排离散的牙齿方块拼成弧线）来表现
// "卡通笑脸"，验收截图发现牙齿方块之间天然留有间隙（glowFaceGeo 里 tw = sw/n*0.78，无论 n 给多大都
// 留约两三成缝隙——这套公式是为了露出"一颗颗牙"设计的，不是为了拼出一条实心弧线），远看是一串分开的
// 红色小点/十字，不是原文"由红色物质构成的卡通笑脸"要的一条连续弧线。这里不再用 humanoid 的内置 smile，
// 改在 addFaceSmile() 里用 ShapeGeometry 直接画一条连续的实心笑弧（见下方）。
const HEAD_R = 0.068 * 1.72;          // 依据：两个下肢型 height 都是 1.72，套用 _archetypes.js 的头部半径公式反推
const FACE_W = HEAD_R * 1.5;          // 依据：buildFace 里 face 选项的 glowFaceGeo width 固定传 headR*1.5
// 依据："未描述眼睛"——不画眼睛；"红色物质构成的卡通笑脸"由下方 addFaceSmile() 画一条连续实心弧线
// （见上方换算说明），不用 humanoid 内置的离散牙齿笑脸。
// 之前给 humanoid() 传 face:{eyes:0,smile:false} 想借这组参数关掉内置五官，结果 eyes=0 且 smile=false
// 时 glowFaceGeo() 内部 list 为空，返回一个没有 position 属性的空 BufferGeometry，_archetypes.js
// finishRig 合并几何时读它的 attributes.position.count 直接崩溃（用品红占位块兜底，整个模型建不出来，
// 预览报错确认过）——humanoid() 的 face 选项默认就是 null（不画），这里干脆不传 face 字段，
// 完全跳过内置五官逻辑，眼睛和笑脸都由 extend 里的 addLampreyMouths/addFaceSmile 自己画

// 卡通笑脸：一条连续的实心红色弧带，避免上面提到的"离散牙齿拼不成一条线"的问题。用 Shape 画一片
// 中间厚、两端收尖的月牙形（外缘/内缘两条抛物线共享同一对端点，端点处自然收尖，形状不会露洞），
// 半宽/下垂弧度/粗细都是"卡通笑脸"的形状取舍，原文没给具体曲率数字，非设定
function addFaceSmile(b, d) {
  const T = THREE, hr = d.headR, W = FACE_W;
  const halfW = W * 0.42, dip = halfW * 0.85, thCtl = halfW * 0.32;
  const shape = new T.Shape();
  shape.moveTo(-halfW, 0);
  shape.quadraticCurveTo(0, -dip, halfW, 0);
  shape.quadraticCurveTo(0, -dip + thCtl, -halfW, 0);
  const geo = new T.ShapeGeometry(shape, 24).rotateY(Math.PI);   // 翻面朝 -Z，同 glowFaceGeo 里眼睛的处理
  b.geo('head', 'glow', geo.translate(0, d.headY - hr * 0.28, -hr * 0.95));
  // 位置：头部前方（-Z），竖直方向放在鼻子和下颌之间，约等于人脸嘴的位置，非设定精确坐标
}

const PERCEPTION = { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150 };
// 依据：senses"拥有一般人类的智力……具体感官 unverified"——没有特殊感官描述，按人形默认档给，
// fov 取人类前向视野，不做 360 全向感知（没写"能感觉到全层"这类描述）

const ATTACK = { hp: A.DAMAGE.medium, sanity: 0, range: 1.0, cooldown: A.COOLDOWN.normal };
// 依据：attack"用手臂末端的嘴咬人……不会使用精密武器，会盲目攻击视线内的所有人类"——没给单次伤害数字，
// 参照"首次大规模袭击约 20 只造成 50 人死亡、121 人感染"的比例（约三成当场死亡，多数是被感染而非
// 当场死亡）取中档伤害，不当成一击致命；没写攻击频率，冷却取默认档；range 按贴身咬合给，不做远程
// （原文"不会使用精密武器"本身就排除了远程攻击，天然满足，不需要额外处理）

const SOUNDS = { idle: 'giggle', alert: 'giggle', attack: 'hit' };
// 依据：behavior"用彩色气球、儿童笑声、生日蛋糕等特征作为诱饵"——本文件只做实体自身能表现的部分：
// 用巡逻/待机时的 giggle 声模拟"儿童笑声诱饵"（idle 音效引擎自带"玩家 25 m 内每 6~14 秒随机播"的
// 判定，玩家会先听到笑声再看到它，效果上就是诱饵）；发现目标时的 howl 也用 giggle（见下方 makeBrain），
// 呼应主题。彩色气球、生日蛋糕是场景装饰物，不是实体自身的一部分，见下方 notImplemented

function makeBrain() {
  return A.pack({
    joinRadius: 14, maxPack: 5, flank: true, flankRadius: 3.5,
    howl: 'giggle', howlCooldown: 8, patrolRadius: 16,
  });
  // 依据：behavior"流浪者人数少于派对客时，通常先包围再动手""一个派对客小组通常有一名队长"——
  // 用群猎骨架天然的"发现目标后按扇区包抄"实现"先包围再动手"；maxPack 给较小值呼应"小组"规模，
  // 具体人数原文没给，非设定；howl 用 giggle 而不是骨架默认的吼叫音效，呼应"儿童笑声"的诱饵主题——
  // 派对客发现猎物那一刻发出的也是笑声，而不是威吓的咆哮
}

// 手臂末端的七鳃鳗状嘴：拉长的肉管 + 深色口腔开口 + 两圈朝开口中心排列的尖牙——依据"手臂末端长着
// 类似红虫或七鳃鳗的嘴，嘴里有几排锋利牙齿"；两条手臂完全一致，写成公用函数供两个下肢形态共用。
// 验收截图指出原版本只是一颗和身体同色的小球、周围几根很短的白刺，正常距离看不出是"嘴"：这里把肉团
// 放大约 1.8 倍并沿手臂悬垂方向拉长成管状（原尺寸 mr = headR*0.42 太小，且没有沿手臂方向拉伸），
// 前端嵌一枚深色圆盘当口腔开口，牙齿改成沿开口边缘、尖端指向开口中心排列（原来是从球面朝四周辐射，
// 看着像手指/尖刺而不是嘴里的牙）
function addLampreyMouths(b, d) {
  const mr = d.headR * 0.75;
  const openR = mr * 0.7;                 // 口腔开口半径，比肉管本身略窄，露出一圈"唇"
  const rows = [
    { r: openR, n: 7, off: 0 },
    { r: openR * 0.6, n: 6, off: Math.PI / 7 },
  ];
  // 两圈交错排列的牙齿模拟"几排锋利牙齿"——原文没给具体排数/形状，取两圈近似，非设定
  for (const s of [-1, 1]) {
    const bone = s < 0 ? 'foreL' : 'foreR';
    const x = s * d.shoulderW, y = d.handY;
    b.sphere(bone, 'body', mr, [x, y, 0], [0.82, 1.7, 0.82], [8, 6]);
    // 唇部肉团：沿 Y（手臂悬垂方向）拉长成管状，看起来像从手臂末端伸出的一截肉管而不是一颗球
    const disc = new THREE.CircleGeometry(openR, 14).rotateY(Math.PI).translate(x, y, -mr * 0.95);
    b.geo(bone, 'mouth', disc);
    // 深色口腔开口：嵌在肉管前端（面朝 -Z，同头部正面朝向）的一枚扁圆盘，给"嘴"一个看得见的洞
    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        const a = (i / row.n) * Math.PI * 2 + row.off;
        const ox = Math.cos(a) * row.r, oy = Math.sin(a) * row.r * 0.85;
        b.cone(bone, 'claw',
          [x + ox, y + oy, -mr * 0.88],
          [x + ox * 0.3, y + oy * 0.3, -mr * 0.98],
          mr * 0.12, 4);
        // 牙齿贴着开口边缘、尖端朝口腔中心收拢——依据"嘴里有几排锋利牙齿"，原文没给具体排列方式
      }
    }
  }
  addFaceSmile(b, d);   // 脸上的红色卡通笑脸，两个下肢形态共用这个入口一起加（见上方 addFaceSmile 说明）
}

// 圆台底座（跳棋棋子型下肢）：从地面到臀部收窄的圆台，套住极短的隐藏腿骨——依据"下肢...有时像跳棋
// 棋子的底座，呈圆台形"。这一型的移动方式原文完全没写（unverified），保留极短的腿骨骼只是为了让引擎
// 现成的站立/移动骨架能正常工作，视觉上完全被圆台盖住、看不出在"走路"，具体见下方 notImplemented
function addPedestalBase(b, d) {
  b.limb('hips', 'body', [0, 0, 0], [0, d.hipY * 0.95, 0], d.hipW * 1.3, d.hipW * 0.65, 10, 1);
  addLampreyMouths(b, d);
}

// ---------------- 人腿型 ----------------
A.register({
  type: 'partygoer_biped', en: 'Partygoer (Legged)', zh: '派对客·人腿型', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility = hostile（直接取值，不是 varies）

  hp: A.HP.average,     // 依据：size/耐久原文完全没写（unverified），没有"很难杀死"或"一碰就死"的描述，取中档默认值，非设定
  radius: 0.32, height: 1.72,
  // 依据：appearance"有时像人类一样有明确的腿"——按普通成年人体型给碰撞体积/身高，原文没给具体数字，非设定

  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：speed"平时和正常人走路速度一样"→ walk 档；"追人时可达 1 m/s，并能持续相当长时间"——
  // 字面 1 m/s 比它自己"正常走路"还慢，明显是原始资料的数字/单位换算问题，不能照抄字面数值
  // （用户规则③：速度一律用 A.SPEED 档位，不照搬字面数字）；改按定性描述判断档位——
  // "能持续追逐相当长时间、不易被走着甩掉"，取 jog（玩家走着甩不掉、冲刺才能甩开），
  // 比常态走路明显快，但不是"比人快、跑不掉"级别的超自然高速追猎者

  perception: PERCEPTION,
  attack: ATTACK,
  sounds: SOUNDS,
  brain: makeBrain(),
  anim: { gait: 'biped', stride: 0.85, breathe: 0.03, strike: 'bite', recoil: 0.2, fall: 'back' },
  // strike:'bite' 呼应"用手臂末端的嘴咬人"

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.72, thin: 0, bulk: 1.0, pose: 'upright',
      head: 'round', hands: false, feet: true, claws: 0, hair: 0,
      // 依据：手是嘴（hands:false，靠 extend 加嘴部几何代替手掌）；原文没提衣物/派对帽
      // （clothes 不设置=默认关闭，用户特别提醒不要加同人形象常见但原文没写的派对帽）；
      // 没提脚部细节，保留普通脚掌
      // 依据："脸上是一个由红色物质构成的卡通笑脸（未描述眼睛）"——不传 face 字段（humanoid 默认
      // face:null，完全跳过内置五官），不画眼睛，笑脸改由 extend 里的 addFaceSmile() 画一条连续实心弧线；
      // 原因见文件顶部 HEAD_R/FACE_W 下面的注释（曾经用 face:{eyes:0,smile:false} 想关掉内置五官，
      // 结果触发 glowFaceGeo 返回空几何、finishRig 合并崩溃）
      colors: { body: pickBodyColor(ctx), glow: FACE_RED, claw: TEETH_COLOR, mouth: MOUTH_DARK },
      look: { body: 'skin', mouth: 'basic' },
      // 依据："皮肤光滑呈革质"——用 skin 材质预设（程序化皮革斑驳纹理×颜色）；
      // mouth 用 basic（不受光照影响）——保证手臂末端的口腔开口不管场景灯光多亮都读得出是一个深色的洞
      mats: { glow: A.mat.lambert(FACE_RED) },
      // 依据：appearance 没写发光部位——笑脸用普通受光材质而不是 glowFace 默认的自发光材质，避免编造发光效果
      extend: addLampreyMouths,
      key: 'partygoer_biped_v2',
    }), { label: 'partygoer_biped' });
  },
});

// ---------------- 圆台底座型 ----------------
A.register({
  type: 'partygoer_pedestal', en: 'Partygoer (Pedestal)', zh: '派对客·圆台底座型', version: 'wikidot-cn',
  faction: 'hostile',
  hp: A.HP.average, radius: 0.34, height: 1.72,
  // radius 略比人腿型大一点：圆台底座比双腿站姿的水平投影更宽，原文没给具体数字，非设定

  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },   // 依据同人腿型，两种下肢的速度描述没有分开写
  perception: PERCEPTION,
  attack: ATTACK,
  sounds: SOUNDS,
  brain: makeBrain(),
  anim: { gait: 'none', breathe: 0.02, twitch: 0.04, strike: 'bite', recoil: 0.2, fall: 'crumple' },
  // 依据：locomotion"圆台底座型的移动方式页面未写(unverified)"——不编造具体步态，gait:'none' 让它贴地
  // 滑行（水平移动仍由骨架/速度正常驱动位置，只是不播放双足步态动画）；twitch 给很小幅度避免完全静止
  // 显得像贴图，非设定精确数值；fall 用 crumple（原地塌陷）而不是"back"，因为没有腿摔倒的姿势没有意义

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.72, thin: 0, bulk: 1.0, pose: 'upright', legLen: 0.35,
      // 依据：这一型的"腿"完全没有独立信息——保留很短的腿骨骼只是引擎现成站立骨架需要的最小骨架，
      // 视觉上完全被下面 extend 加的圆台盖住，legLen 数值非设定，纯粹为了让圆台贴地、腿不会露出来
      head: 'round', hands: false, feet: false, claws: 0, hair: 0,
      // 不传 face 字段——原因同人腿型 build() 里的注释（humanoid 默认 face:null，完全跳过内置五官，
      // 不画眼睛，笑脸改由 addFaceSmile() 画）
      colors: { body: pickBodyColor(ctx), glow: FACE_RED, claw: TEETH_COLOR, mouth: MOUTH_DARK },
      look: { body: 'skin', mouth: 'basic' },   // mouth 用 basic，保证口腔开口不受光照影响、始终读得出是个洞
      mats: { glow: A.mat.lambert(FACE_RED) },
      extend: addPedestalBase,
      key: 'partygoer_pedestal_v2',
    }), { label: 'partygoer_pedestal' });
  },
});
})();

// notImplemented（返回值里再列一遍，原因见文件内注释）：
// - PTG-A 咬伤感染/24 小时内变成派对客、PTG-B 逆转：引擎没有感染/变异系统（用户规则⑥），
//   攻击按普通 HP 伤害近似，写进 apiRequests。
// - "只要发现流浪者，就会跟着对方切出（追到其他层级）"：引擎没有实体带人/跟人换层的机制
//   （用户规则⑥），不实现，写进 apiRequests。
// - "能操作机械打开大门"："门的运行时开关/上锁"引擎没有（用户规则⑥），不实现。
// - "制作简易陷阱"：原文没给具体陷阱形式，也没有对应的通用行为骨架选项可用，不编造，不实现。
// - "会主动避开炎热气温、陡峭地形和人类伏击"：引擎的实体感知接口没有温度/地形坡度/陷阱识别这些信号，
//   现有行为骨架也没有对应选项，不实现。
// - 彩色气球/儿童笑声/生日蛋糕当诱饵：儿童笑声用 idle/howl 的 giggle 音效实现（见上方 SOUNDS/makeBrain）；
//   彩色气球、生日蛋糕是场景装饰物摆件，属于层级（Level Fun）的场景搭建范围，不是本实体文件能触及的
//   data/*.json 或关卡装饰，本文件不实现，留给 Level Fun 的实现者参考。
// - 派对之主（Entity 167）的思想操纵/教唆关系、少数"中立个体"（如"派对客安迪"）：这批任务范围内
//   没有对应的派对之主实体类型，中立个体是原文点名的特定个体而非"派对客"这个通用类型的常见变体，
//   不在本文件的两个 type 里实现。
// - 与扫兴客（享乐战争历史关系）：扫兴客不在本批实体范围内，不实现关系判定。
// - 圆台底座型的具体移动方式（unverified）：按引擎需要贴地滑行，非设定，见文件内 anim 注释。
