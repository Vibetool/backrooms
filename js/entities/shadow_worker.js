// 影子工人 Shadowy Workers (Backrooms Remodeling Co / 后室装修公司)
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/level-1（Level 1 衔尾段一节）
//           及其超链接目标 https://backrooms-wiki-cn.wikidot.com/backrooms-remodeling-co（团体页，同属选中版本一并抓取）
// 许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
//
// 选中版本里团体页写了两个外形/移动方式明显不同的具名个体（Penelope 六腿、Grunt 指关节走路），
// 按 _TEMPLATE.md 第 1 节注册三个 type：shadow_worker（一般工人）/ shadow_worker_penelope / shadow_worker_grunt。
// 团体页还提到 Cap'n、Toaster 等名字，但没有给出他们的外形或移动方式描述，选中版本没写的不做，故不单独建模。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 统一的"工装"配色：槽位预算 ≤4（性能底线第 10 节），按显著程度取舍：
//   body（淡蓝风衣，覆盖躯干/手臂/腿部）——依据"淡蓝色风衣"，最大面积的外层单品
//   head（漆黑，仅头部）——依据"浑身漆黑的人形实体"
//   apron（白色，胸腹一块 + 复用给白色圆眼）——依据"白色围裙"与"眼睛是白色圆圈"（两者原文都是白色，同色复用不是编造）
//   trim（红色，双肩两小块）——依据"红色肩甲"
// 取舍并省略（选中版本写了但槽位预算放不下，记入 notImplemented，不是没看见）：
//   棕色羊毛裤——并入淡蓝风衣同色（风衣够长，游戏性简化）；深灰贝雷帽、铜/银/金徽章——不建模，只是小面积装饰。
const WORKER_COLORS = { body: 0x9fc4d8, head: 0x0a0a0a, apron: 0xf0f0ec, trim: 0xb0271e };

// 共用外形细节：白围裙 + 白圆眼（无发光——选中版本原文写"无发光部位描述"，眼睛用平光材质而非 glow）+ 红色肩甲
function addUniformDetails(b, d) {
  // 白色围裙：胸腹一块平板，位置按躯干中段估算（选中版本没给数字尺寸，形状比例为游戏性默认值，非设定）
  const apronW = d.shoulderW * 0.62, apronH = (d.shoulderY - d.hipY) * 0.6;
  b.box('spine', 'apron', [apronW, apronH, 0.03], [0, (d.shoulderY + d.hipY) / 2, -d.headR * 0.85]);
  // 无面：脸部由 head:'faceless' 提供光滑蛋形，这里只加两个白色圆眼，不加牙/嘴——依据"没有可见的嘴或鼻子"
  b.geo('head', 'apron', A.geo.glowFace({ width: d.headR * 1.5, eyes: 2, eyeShape: 'round', smile: false })
    .translate(0, d.headY - d.headR * 0.08, -d.headR * 0.92));
  // 红色肩甲：贴在双臂顶端（肩部）各一小块——依据"红色肩甲"
  // 注意：b.box 的中心坐标是模型空间绑定姿势坐标，要对齐 armL/armR 骨骼自身的位置（±shoulderW），
  // 不能用小比例系数，否则会缩到躯干中心里被身体挡住看不见（踩过的坑，第一版预览截图肩甲是隐形的）
  for (const s of [-1, 1]) {
    b.box(s < 0 ? 'armL' : 'armR', 'trim', [d.shoulderW * 0.32, d.shoulderW * 0.22, d.shoulderW * 0.34],
      [s * d.shoulderW * 0.98, d.shoulderY + d.shoulderW * 0.08, 0]);
  }
}

// Penelope 专属：额外两对（4 条）触手状腿，加上人形本身的 legL/legR 共六条——依据"六条腿，像蜘蛛或蚂蚁一样走"
// 用 b.chain 实现（会自动带 anim.sway 摆动），没有精确的六足步态可参照，用摆动近似"多腿蠕动感"
function addSpiderLegs(b, d) {
  const legLen = d.hipY * 0.95, r0 = 0.03 * d.H, r1 = 0.01 * d.H;
  for (const s of [-1, 1]) {
    for (const row of [-1, 1]) {
      const from = [s * d.hipW * 0.55, d.hipY, row * d.hipW * 0.75];
      const dir = [s * 0.55, -1, row * 0.4];
      b.chain('spleg' + (s < 0 ? 'L' : 'R') + (row < 0 ? 'F' : 'B'), 'hips', from, dir, 3, legLen, r0, r1, 'body', 5);
    }
  }
}

// 共用建模函数：height/bulk/hunch/pose 由各 type 各自传入，颜色与围裙/眼睛/肩甲细节共用
// key 必须按 type 区分——extend 闭包里读了外部变量（extraLegs），几何缓存按函数源码文本哈希，
// 同名闭包文本一样会撞缓存（_TEMPLATE.md 第 1 节"用了 extend 且闭包里有变量时必须给不同的 key"）
function buildWorker(o) {
  return A.parts.humanoid({
    height: o.height, thin: o.thin || 0, bulk: o.bulk || 1, hunch: o.hunch || 0, pose: o.pose || 'upright',
    head: 'faceless', hands: true, claws: 0, hair: 0,          // 无面无发（贝雷帽盖住头发，选中版本没写头发本身）
    colors: WORKER_COLORS,
    key: o.key,
    extend(b, d) { addUniformDetails(b, d); if (o.extraLegs) addSpiderLegs(b, d); },
  });
}

// 三个 type 共用的行为：完全无视一切生命——依据 Level 1 页原文"完全无视其他生命的存在，既不回应任何问题，
// 也不会意识到有人类存在"。这句话比引擎对 neutral 的通用默认（"被攻击后反击"）更明确，选中版本怎么写就怎么做，
// 所以用 canTarget 恒 false 覆盖默认反击：无论谁打它，它都不会去追打、也不会逃跑，只会继续漫无目的地游荡/施工。
// 挨打后骨架仍会有本能的转身动作（provokedTurn，肌肉反射，不代表"注意到"），符合"完全无视"但仍是活物会挨打掉血。
function workerBrain() {
  return A.wanderer({
    speed: null,                 // 用 def.speed.walk（下方按类型给）
    canTarget: () => false,      // 依据："完全无视其他生命的存在……也不会意识到有人类存在"
    homeRadius: 0,                 // 依据："漫无目的地"——不设归巢范围，任其游荡
    shyRadius: 0,
  });
}

// 无武器、不主动攻击——依据团体页"不携带也不存放武器"+ Level 1 页"不主动攻击"，
// 因此不写 def.attack；他们造成的意外伤害来自"其使用的各类装置"而非工人本体的主动攻击，
// 装置属于场景摆件，是层级文件（js/levels/L1.js）的职责，不在实体文件范围内（notImplemented）。

// ---------------------------------------------------------------------------
// 1) shadow_worker —— 一般工人（未具名个体，Level 1 衔尾段最常见的形态）
// ---------------------------------------------------------------------------
A.register({
  type: 'shadow_worker', en: 'Shadowy Worker (Backrooms Remodeling Co.)', zh: '影子工人（后室装修公司）', version: 'wikidot-cn',
  faction: 'neutral',                                    // 依据：hostility = neutral
  hp: A.HP.average,                                       // 选中版本未写体型强度数据，游戏性默认值，非设定
  radius: 0.35, height: 1.8,                              // 选中版本未给数字尺寸，按常人体型给默认值，非设定
  speed: { walk: A.SPEED.slow, run: A.SPEED.slow },       // 依据："漫无目的地游荡"——不疾不徐；从未描述奔跑/追逐，run 字段仅骨架必填，取同值
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 180 },   // 选中版本未写感官，此值也不影响行为（canTarget 恒 false），游戏性默认值
  sounds: { idle: 'click' },   // 依据："漫无目的地修补建筑结构"——持续的小声敲打/修理声；没有专门工具音效，用 click 近似
  brain: workerBrain(),
  anim: { gait: 'biped', breathe: 0.025, strike: 'none', recoil: 0.15, fall: 'crumple' },   // 死亡姿态选中版本未写，取默认 crumple，非设定

  build() {
    return A.wrap(buildWorker({ height: 1.8, key: 'shadow_worker' }), { label: 'shadow_worker' });
  },
});

// ---------------------------------------------------------------------------
// 2) shadow_worker_penelope —— Penelope（六腿，像蜘蛛/蚂蚁一样走）
// ---------------------------------------------------------------------------
A.register({
  type: 'shadow_worker_penelope', en: 'Penelope (Backrooms Remodeling Co.)', zh: '佩内洛普（后室装修公司）', version: 'wikidot-cn',
  faction: 'neutral',
  hp: A.HP.average,                                       // 同上，选中版本未写体型强度
  radius: 0.5, height: 1.6,                               // 六腿分摊体重、姿态更低更宽——依据"六条腿……走路"；具体数字非设定
  speed: { walk: A.SPEED.slow, run: A.SPEED.slow },
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 180 },
  sounds: { idle: 'click' },
  brain: workerBrain(),
  anim: { gait: 'biped', breathe: 0.02, sway: 0.4, swaySpeed: 2.4, strike: 'none', recoil: 0.15, fall: 'crumple' },   // sway 调高，六条腿摆动更明显——依据"像蜘蛛或蚂蚁一样走"

  build() {
    return A.wrap(buildWorker({ height: 1.6, key: 'shadow_worker_penelope', extraLegs: true }), { label: 'shadow_worker_penelope' });
  },
});

// ---------------------------------------------------------------------------
// 3) shadow_worker_grunt —— Grunt（高大肌肉，用指关节走路）
// ---------------------------------------------------------------------------
A.register({
  type: 'shadow_worker_grunt', en: 'Grunt (Backrooms Remodeling Co.)', zh: '格朗特（后室装修公司）', version: 'wikidot-cn',
  faction: 'neutral',
  hp: A.HP.sturdy,                                        // 依据："高大肌肉"——比普通工人更结实一档；具体数字选中版本未给，游戏性档位非设定
  radius: 0.5, height: 2.1,                               // 依据："高大肌肉"——身高体型明显超过常人，数字非设定
  speed: { walk: A.SPEED.slow, run: A.SPEED.slow },
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 180 },
  sounds: { idle: 'click' },
  brain: workerBrain(),
  // pose:'crawl' 是骨架里最接近"用指关节走路"的内置姿态（四肢着地）；引擎没有专门的"直立+指关节触地"姿态，
  // 这是能拼出的最近似形态，不是精确复刻，记入 notImplemented
  anim: { gait: 'crawl', breathe: 0.03, strike: 'none', recoil: 0.15, fall: 'crumple' },

  build() {
    return A.wrap(buildWorker({ height: 2.1, bulk: 1.4, pose: 'crawl', key: 'shadow_worker_grunt' }), { label: 'shadow_worker_grunt' });
  },
});
})();
