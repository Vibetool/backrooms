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
//
// ---- M2 打磨第 1 批（ENGINE_PLAN 第 4 节）：只动 build / extend / 模型辅助函数，行为与数值字段一字未改 ----
// M1 打分员在基线截图上指出的问题，逐条对应下面的改动：
// ①「手端七鳃鳗齿口……是贴在手上的圆片，不是从手臂延伸出的管状口」「远处看像飞镖靶」
//    → mouthFunnel()：从前臂末端顺着一条前倾的轴线长出一截漏斗形口管，五段粗细交替的环节（依据
//      「类似红虫或七鳃鳗的嘴」——红虫/七鳃鳗都是环节状的身体），末端外翻成唇缘。
// ②「嘴里有几排锋利牙齿」原来只有两圈、而且是从球面朝四周辐射（看着像手指）
//    → 改成三圈同心齿列，由外到内一圈比一圈小、齿尖一律朝开口中心收拢（七鳃鳗口盘的排法）。
// ③「笑脸只是一条很细的红弧线、远处看不见」「偏在头侧」（平面弧片贴在球面前方，3/4 视角会浮在脸外）
//    → smileArc()：笑脸改成贴着头部椭球表面走的一条有厚度的红色弧管，中间粗、嘴角收细，正脸和 3/4
//      视角都读得出来。依据「脸上是一个由红色物质构成的卡通笑脸」——红色物质堆在脸上，本来就该有厚度。
//      仍然不画眼睛（原文「未描述眼睛」）。
// ④「身体是分节木人偶，没有光滑革质的连续体表」
//    → addSkinSmoothing()：髋部方块外面罩一层圆滑外壳，腰、颈根、肩头、脚踝加过渡肉块，把构件之间的
//      硬接缝盖掉。依据「皮肤光滑呈革质」。
// ⑤「圆台底座是一根窄锥、不像跳棋棋子那种宽扁圆台，胯部方盒子悬在锥顶衔接生硬」（侧面截图里被圆台
//    盖住的那两条腿还会从底座前面露出来）
//    → addPedestalBase()：底座改成宽扁的多级圆台——外张的底盘、收腰、中段凸出的棱环、收进去接住髋部的
//      顶盖，宽度顶到实体自己的碰撞半径附近，腿完全藏进去。依据「有时像跳棋棋子的底座，呈圆台形」。
// ⑥ 任务点名的「圆台底座形态看不出在走路」
//    → 底座分成三节骨骼（hips / pedA / pedB），配 anim.onFrame 的 pedestalGait()：走起来时下节左右摆、
//      上节反向补偿，躯干随步伐起伏、手臂轻微前后摆；站住不动时完全按原来的样子。这一段是纯表现
//      （只读 u.sp / u.phase，只叠加骨骼旋转位移），speed、brain 和其余行为数值一律没碰。
// 顶点色 tint 只用在"底座棱环凹槽"一处，而且只给中性灰（把这一块压暗），不引入原文没写的新色相；
// 不新增材质槽位，draw call 仍然是 body/head/claw/glow/mouth 五个。
//
// ---- 复评返修（第 2 轮）----
// 复评在 before/after 局部放大和 6 m 层级灯光截图上指出：口管的形态是改对了，但整根管子和身体同为亮黄、
// 开口又小又侧对镜头，6 m 外整只读成一个没有特征的黄色剪影——而基线那两枚"深色圆盘 + 白色放射状牙"
// 虽然形状不对（打分员说"像飞镖靶"），却是这只知名实体在远处唯一认得出的特征，等于用对的形态换掉了
// 辨识度。这一轮只动 mouthFunnel：① 前倾角 50°→66°，开口正对前方并抬回大腿中段；② 口腔从"细圆盘 +
// 顶点色压暗的内唇"换成 mouth 槽位（basic 不受光照）的深色喉管，封口盘半径 0.4hr→0.5hr 并缩进唇缘里
// 0.07L，任何距离都是一块黑；③ 三圈齿列全部移到封口盘前面，白牙直接衬在黑洞上。牙本身仍是细牙。
// 缓存键随模型改动升到 _v4（同一页面里不会复用旧几何）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---------------- 共用数值（appearance/behavior/attack 段没有按下肢形态拆开）----------------

const FACE_RED = 0xd42a20;     // 依据："脸上是一个由红色物质构成的卡通笑脸"
const TEETH_COLOR = 0xf2ede0;  // 依据：手臂末端嘴"里有几排锋利牙齿"——原文没给牙齿颜色，取普通牙齿浅色，非设定
const MOUTH_DARK = 0x160a0a;   // 手臂末端嘴的口腔开口色：原文没写颜色，取深色让"嘴"读起来是个洞而不是一颗球，非设定

// 顶点色 tint：只是把同一块皮肤压暗，让凹进去的地方读得出是凹的（底座棱环下的凹槽）。
// 纯中性灰乘数，不带色相，等于给这一块打阴影，不是新颜色，非设定。
// （口腔内壁本来也用 tint 压暗，复评返修后整个换成 mouth 槽位的深色喉管，原来的 SHADE_DEEP 随之删掉）
const SHADE_SOFT = 0xc2c2c2;   // ×0.76：底座凹槽

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

// 画质分档：extend 只拿得到 dims，拿不到 humanoid 解析后的 detail，按 _archetypes.js resolveDetail 的同一条
// 规则自己再算一次（hazmat 构件也是这么做的）。humanoid 的几何缓存键里带着解析后的 detail，两边同一时刻
// 读同一个设置，高低画质各自缓存各自的几何，不会互相顶掉
function isHigh() {
  const s = BR.game && BR.game.settings;
  return !(s && s.quality === 'low');
}

// 笑脸尺寸换算：A.parts.humanoid 的 face 选项内部把 glowFaceGeo 的 width 设成 headR×1.5（_archetypes.js
// buildFace 调用处）。早期版本借用 glowFaceGeo 的 teeth 型笑脸（一排离散的牙齿方块拼成弧线）来表现
// "卡通笑脸"，验收截图发现牙齿方块之间天然留有间隙，远看是一串分开的红色小点，不是原文要的一条连续弧线；
// 后来改成一片 ShapeGeometry 月牙（连续了，但太薄、而且是一片平面贴在球形脸前面，3/4 视角会浮在脸侧边，
// 就是 M1 两名打分员同时点名的"笑脸过细、偏在头侧"）。现在改成沿着头部椭球表面走的一条弧管，见 smileArc()。
const HEAD_R = 0.068 * 1.72;          // 依据：两个下肢型 height 都是 1.72，套用 _archetypes.js 的头部半径公式反推
const FACE_W = HEAD_R * 1.5;          // 依据：buildFace 里 face 选项的 glowFaceGeo width 固定传 headR*1.5
// 依据："未描述眼睛"——不画眼睛。
// 之前给 humanoid() 传 face:{eyes:0,smile:false} 想借这组参数关掉内置五官，结果 eyes=0 且 smile=false
// 时 glowFaceGeo() 内部 list 为空，返回一个没有 position 属性的空 BufferGeometry，_archetypes.js
// finishRig 合并几何时读它的 attributes.position.count 直接崩溃——humanoid() 的 face 选项默认就是
// null（不画），这里干脆不传 face 字段，完全跳过内置五官逻辑，笑脸由 extend 里的 smileArc() 自己画

// 卡通笑脸：一条贴着头部椭球表面走的实心红色弧管。取样点先按抛物线定出正面的 x / y，再解椭球方程求这一点
// 的表面 z，所以嘴角会自然绕到脸的侧面上去，不会像平面弧片那样在 3/4 视角浮在脸外面。中间最粗、嘴角收细，
// 是"卡通笑脸"的形状取舍；半宽/下垂弧度/粗细原文没给具体数字，非设定
function smileArc(b, d, hi) {
  const hr = d.headR;
  const ra = hr * 0.92, rb = hr * 1.08, rc = hr * 0.98;   // 头部椭球三个半轴（同 _archetypes.js head:'round' 的 scale）
  const halfW = FACE_W * 0.5, yTop = -hr * 0.1, dip = hr * 0.36;
  const n = hi ? 8 : 4;
  const pt = function (u) {
    const px = halfW * u, py = yTop - dip * (1 - u * u);
    const k = Math.max(0.05, 1 - (px / ra) * (px / ra) - (py / rb) * (py / rb));
    return [px, d.headY + py, -rc * Math.sqrt(k) * 1.01];   // ×1.01：贴在表面上，有一半埋进脸里，像糊上去的一团红色物质
  };
  const rad = function (u) { return Math.max(0.0016, hr * 0.115 * (1 - 0.55 * u * u)); };
  for (let i = 0; i < n; i++) {
    const u0 = -1 + (2 * i) / n, u1 = -1 + (2 * (i + 1)) / n;
    b.limb('head', 'glow', pt(u0), pt(u1), rad(u0), rad(u1), hi ? 5 : 4);
  }
}

// 手臂末端的七鳃鳗状嘴：从前臂末端顺着一条前倾的轴线伸出的一截漏斗形口管——粗细交替的环节肉管 + 外翻唇缘
// + 压暗的内壁 + 深色口腔开口 + 三圈朝开口中心收拢的尖牙。依据「手臂末端长着类似红虫或七鳃鳗的嘴，嘴里有
// 几排锋利牙齿」。轴线前倾（而不是笔直朝下或笔直朝前）是为了让垂在身侧的手臂末端从正面和侧面都看得见这是
// 一张开着的嘴——前倾角度原文没写，非设定
// 前倾角：复评指出 50° 时开口几乎是侧对镜头，6 m 外整只读成一根黄色袖口（见下方 mouthFunnel 注释），
// 改成 ≈66°（离水平只差 24°），开口正对前方——正面和 3/4 视角看到的是洞口本身而不是洞口的侧棱；
// 同时轴线的下垂分量从 0.645L 减到 0.409L，开口自然抬回大腿中段。角度原文没写，非设定
const TILT = 1.15;                       // ≈66°，相对"手臂垂下"方向的前倾
const AXY = -Math.cos(TILT), AXZ = -Math.sin(TILT);   // 轴线单位向量（面朝 -Z，向下偏前）

function mouthFunnel(b, bone, x, y0, hr, hi) {
  const L = hr * 1.15;
  // 轴线上距离 t 处的点
  const P = function (t) { return [x, y0 + AXY * t, AXZ * t]; };
  // 轴线上距离 t 处、绕轴半径 r、角度 a 的点（轴线躺在 YZ 平面里，所以横向基向量就是 X 轴）
  const ring = function (a, r, t) {
    return [x + Math.cos(a) * r, y0 + AXY * t + Math.sin(a) * r * AXZ, AXZ * t - Math.sin(a) * r * AXY];
  };
  // 环节状肉管：粗细交替，读起来像红虫/七鳃鳗那种一节一节的身体；末端一段猛地外张成唇缘
  const cut = hi ? [0, 0.3, 0.5, 0.72, 0.88, 1] : [0, 0.34, 0.66, 0.88, 1];
  const rad = hi ? [0.26, 0.36, 0.3, 0.4, 0.42, 0.66] : [0.26, 0.36, 0.32, 0.44, 0.66];
  const seg = hi ? 8 : 6;
  for (let i = 0; i + 1 < cut.length; i++) {
    b.limb(bone, 'body', P(cut[i] * L), P(cut[i + 1] * L), rad[i] * hr, rad[i + 1] * hr, seg);
  }
  // 口腔：一截朝里收窄的深色喉管。mouth 槽位是 basic 材质（不受光照影响），所以不管场景多亮、离多远，
  // 这一块都是接近纯黑的。
  // ★ 这里有个 RigBuilder 的坑，也是"远看读不出那是嘴"的真正原因（不是开口太小）：b.limb 内部用的是
  //   CylinderGeometry 且 openEnded 默认 false，两端各带一张端盖。喇叭口最后一节在 t=1.0 有一整张
  //   半径 0.66hr、和身体同色的黄色端盖，等于给这张嘴盖了个盖子——任何缩在它里面的深色盘（改前的
  //   0.4hr、本轮先试的 0.5hr）都会被它整个挡住，只有极斜的角度能从边上瞄到一条缝。
  //   所以喉管末端要探到 t=1.01（黄端盖 t=1.0 的前面）才挡得住它；半径 0.56hr 比唇缘 0.66hr 小一圈，
  //   黄色唇缘仍然露成一环，读起来就是"外翻的唇 + 里面一个黑洞"
  b.limb(bone, 'mouth', P(0.72 * L), P(1.01 * L), 0.1 * hr, 0.56 * hr, seg);
  // 「几排锋利牙齿」：三圈同心齿列，由外到内一圈比一圈小，齿尖一律朝开口中心收拢。三圈的齿根全部排在
  // 黑色封口盘（t=1.01）前面、半径都小于封口盘的 0.56hr，所以白牙是直接衬在黑洞上的——高对比度的
  // 「黑洞 + 白牙」正是基线截图里唯一能在 6 m 外认出这只实体的特征，复评要求保留细牙，所以牙本身仍然细，
  // 靠对比度而不是靠体积来读。圈数/每圈颗数原文没给，取三圈近似，非设定
  const rows = hi
    ? [{ n: 9, r: 0.54, t0: 1.012, t1: 1.10, r1: 0.42, w: 0.075, off: 0 },
       { n: 7, r: 0.42, t0: 1.016, t1: 1.08, r1: 0.27, w: 0.065, off: Math.PI / 7 },
       { n: 5, r: 0.30, t0: 1.020, t1: 1.06, r1: 0.15, w: 0.055, off: Math.PI / 5 }]
    : [{ n: 10, r: 0.5, t0: 1.012, t1: 1.09, r1: 0.35, w: 0.075, off: 0 }];
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    for (let i = 0; i < row.n; i++) {
      const a = (i / row.n) * Math.PI * 2 + row.off;
      b.cone(bone, 'claw', ring(a, row.r * hr, row.t0 * L), ring(a, row.r1 * hr, row.t1 * L), row.w * hr, 4);
    }
  }
}

// 两条手臂完全一致；笑脸也在这里一起加，两个下肢形态共用这个入口
function addMouthsAndFace(b, d, hi) {
  const y0 = d.handY + 0.035;   // 前臂几何到 handY + 0.02*H 收口，从这里接上口管，不留断茬
  mouthFunnel(b, 'foreL', -d.shoulderW, y0, d.headR, hi);
  mouthFunnel(b, 'foreR', d.shoulderW, y0, d.headR, hi);
  smileArc(b, d, hi);
}

// 「皮肤光滑呈革质」：把构件之间的硬接缝盖掉——髋部方块罩一层圆壳、腰和颈根加过渡肉块、肩头加圆帽、
// 脚踝加袖口。全部叠在已有骨骼和 body 槽位上，不新增槽位；低画质不加（保持简版）
function addSkinSmoothing(b, d, hi, ankles) {
  if (!hi) return;
  const H = d.H;
  b.sphere('hips', 'body', 0.1 * H, [0, d.hipY + 0.022 * H, 0], [0.95, 0.52, 0.58], [8, 6]);          // 髋部圆壳
  b.limb('spine', 'body', [0, d.hipY + 0.05 * H, 0], [0, d.hipY + 0.115 * H, 0], 0.083 * H, 0.072 * H, 8);   // 腰部过渡
  b.limb('head', 'body', [0, d.shoulderY - 0.012 * H, 0], [0, d.shoulderY + 0.03 * H, 0], 0.043 * H, 0.03 * H, 8);   // 颈根过渡
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    b.sphere('arm' + L, 'body', 0.042 * H, [s * d.shoulderW, d.shoulderY - 0.005 * H, 0], [1.02, 0.95, 1], [8, 6]);   // 肩头圆帽
    if (ankles) b.limb('shin' + L, 'body', [s * d.hipW, 0.078 * H, 0], [s * d.hipW, 0.043 * H, 0], 0.03 * H, 0.035 * H, 6);
  }
}

// 圆台底座（跳棋棋子型下肢）：依据「下肢……有时像跳棋棋子的底座，呈圆台形」。做成宽扁的多级圆台——
// 外张的底盘、压暗的收腰凹槽、中段凸出的棱环、收进去接住髋部的顶盖；最宽处（0.245 m）压在实体自己的
// 碰撞半径 0.34 以内，视觉宽度和站位对得上，原来那两条"只为骨架能用"的短腿这下完全藏进底座里了。
// 底座分三节骨骼（hips 不动 → pedA → pedB），走动时由 anim.onFrame 的 pedestalGait() 逐节摆
function addPedestalBase(b, d, hi) {
  const H = d.H, topY = d.hipY + 0.06 * H;
  b.bone('pedA', 'hips', [0, 0.04 * H, 0]);
  b.bone('pedB', 'pedA', [0, 0.115 * H, 0]);
  if (hi) {
    b.limb('hips', 'body', [0, 0, 0], [0, 0.022 * H, 0], 0.135 * H, 0.142 * H, 12);                       // 底盘
    b.limb('hips', 'body', [0, 0.022 * H, 0], [0, 0.036 * H, 0], 0.142 * H, 0.129 * H, 12, { tint: SHADE_SOFT });   // 底盘上的收腰凹槽
    b.limb('pedA', 'body', [0, 0.036 * H, 0], [0, 0.102 * H, 0], 0.132 * H, 0.102 * H, 12);               // 主体圆台
    b.limb('pedA', 'body', [0, 0.102 * H, 0], [0, 0.119 * H, 0], 0.102 * H, 0.112 * H, 12);               // 中段外凸的棱环
    b.limb('pedB', 'body', [0, 0.119 * H, 0], [0, 0.189 * H, 0], 0.112 * H, 0.094 * H, 12);               // 上段圆台
    b.limb('pedB', 'body', [0, 0.189 * H, 0], [0, topY, 0], 0.094 * H, 0.072 * H, 10);                    // 接住髋部的顶盖
  } else {
    b.limb('hips', 'body', [0, 0, 0], [0, 0.029 * H, 0], 0.135 * H, 0.142 * H, 8);
    b.limb('pedA', 'body', [0, 0.029 * H, 0], [0, 0.116 * H, 0], 0.142 * H, 0.108 * H, 8);
    b.limb('pedB', 'body', [0, 0.116 * H, 0], [0, topY, 0], 0.108 * H, 0.072 * H, 8);
  }
}

// 圆台底座型的"走路"表现：原文只说下肢有时是圆台，移动方式页面没写（unverified），这里不编造步态细节，
// 只把"在移动"这件事做得看得出来——底座下节左右摆、上节反向补偿（一节一节地挪），躯干随之起伏、手臂
// 轻微前后摆。幅度是表现取舍，非设定。纯表现：只读 u.sp（由位移算出来的速度，房主客机都对得上）和
// u.phase，只往骨骼上叠加旋转/位移，不碰 e.x/y/z/yaw，也不读 e.data；站着不动时（amt < 0.04）完全
// 不介入，和改动前一样只有 breathe/twitch
function pedestalGait(e, dt, api, u) {
  const rig = u.rig;
  if (!rig || e.dead) return;
  const sp = e.def.speed || {};
  const walk = typeof sp.walk === 'number' ? sp.walk : 1.8;
  const amt = Math.min(1, u.sp / Math.max(0.3, walk));
  if (amt < 0.04) return;
  const s = Math.sin(u.phase), ac = Math.abs(Math.cos(u.phase)), an = A.anim;
  an.addRot(rig, 'pedA', 0, 0, s * 0.1 * amt);                  // 下节左右摆
  an.addRot(rig, 'pedB', -ac * 0.05 * amt, 0, -s * 0.05 * amt);  // 上节反向补偿 + 随步伐轻微前后点
  an.addPos(rig, 'spine', 0, ac * 0.025 * amt, 0);               // 身体随步伐起伏
  an.addRot(rig, 'spine', -0.04 * amt, 0, s * 0.045 * amt);
  an.addRot(rig, 'head', 0, 0, -s * 0.03 * amt);
  an.addRot(rig, 'armL', s * 0.26 * amt);
  an.addRot(rig, 'armR', -s * 0.26 * amt);
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
    const hi = isHigh();
    return A.wrap(A.parts.humanoid({
      height: 1.72, thin: 0, bulk: 1.0, pose: 'upright',
      head: 'round', hands: false, feet: true, claws: 0, hair: 0,
      // 依据：手是嘴（hands:false，靠 extend 加嘴部几何代替手掌）；原文没提衣物/派对帽
      // （clothes 不设置=默认关闭，用户特别提醒不要加同人形象常见但原文没写的派对帽）；
      // 没提脚部细节，保留普通脚掌
      // 依据："脸上是一个由红色物质构成的卡通笑脸（未描述眼睛）"——不传 face 字段（humanoid 默认
      // face:null，完全跳过内置五官），不画眼睛，笑脸由 extend 里的 smileArc() 画
      colors: { body: pickBodyColor(ctx), glow: FACE_RED, claw: TEETH_COLOR, mouth: MOUTH_DARK },
      look: { body: 'skin', mouth: 'basic' },
      // 依据："皮肤光滑呈革质"——用 skin 材质预设（程序化皮革斑驳纹理×颜色）；
      // mouth 用 basic（不受光照影响）——保证手臂末端的口腔开口不管场景灯光多亮都读得出是一个深色的洞
      mats: { glow: A.mat.lambert(FACE_RED) },
      // 依据：appearance 没写发光部位——笑脸用普通受光材质而不是 glowFace 默认的自发光材质，避免编造发光效果
      extend(b, d) { addSkinSmoothing(b, d, hi, true); addMouthsAndFace(b, d, hi); },
      key: 'partygoer_biped_v4',
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
  anim: {
    gait: 'none', breathe: 0.02, twitch: 0.04, strike: 'bite', recoil: 0.2, fall: 'crumple',
    onFrame: pedestalGait,
  },
  // 依据：locomotion"圆台底座型的移动方式页面未写(unverified)"——不编造具体步态，gait:'none' 不播双足
  // 步态动画（水平移动仍由骨架/速度正常驱动位置）；但"贴地滑行"在截图和实机里完全看不出它在移动，
  // 所以补一个 onFrame（pedestalGait）让底座逐节摆、躯干随步伐起伏，只是表现，没有改速度和行为；
  // twitch 给很小幅度避免完全静止显得像贴图，非设定精确数值；fall 用 crumple（原地塌陷）而不是"back"，
  // 因为没有腿摔倒的姿势没有意义

  build(ctx) {
    const hi = isHigh();
    return A.wrap(A.parts.humanoid({
      height: 1.72, thin: 0, bulk: 1.0, pose: 'upright', legLen: 0.35,
      // 依据：这一型的"腿"完全没有独立信息——保留很短的腿骨骼只是引擎现成站立骨架需要的最小骨架，
      // 视觉上完全被下面 extend 加的圆台盖住，legLen 数值非设定，纯粹为了让圆台贴地、腿不会露出来
      head: 'round', hands: false, feet: false, claws: 0, hair: 0,
      // 不传 face 字段——原因同人腿型 build() 里的注释
      colors: { body: pickBodyColor(ctx), glow: FACE_RED, claw: TEETH_COLOR, mouth: MOUTH_DARK },
      look: { body: 'skin', mouth: 'basic' },   // mouth 用 basic，保证口腔开口不受光照影响、始终读得出是个洞
      mats: { glow: A.mat.lambert(FACE_RED) },
      extend(b, d) { addPedestalBase(b, d, hi); addSkinSmoothing(b, d, hi, false); addMouthsAndFace(b, d, hi); },
      key: 'partygoer_pedestal_v4',
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
// - 圆台底座型的具体移动方式（unverified）：原文没写，不编造步态；M2 打磨只补了"看得出在移动"的表现
//   （底座逐节摆动 + 躯干起伏，见 pedestalGait），幅度非设定，速度与行为数值未改。
