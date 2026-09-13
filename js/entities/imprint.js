// 印记 Imprint（Level 17 页面里描述的本层常驻实体，没有独立编号/独立实体页）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/trimmed:level-17  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）。
// 说明：backrooms-research/entities/imprint.json 的 wikidot-en 条目取自 Level 17 页面正文里唯一一段
// 关于"印记"的描述（该页原地址已 404，被 trim 到 trimmed:level-17，标题《The Carrier》），
// 没有独立的实体编号页，故本文件不写 en/Entity 编号。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'imprint', en: 'Imprint', zh: '印记', version: 'wikidot-en',
  faction: 'neutral',   // 依据：hostility = neutral，直接取值，不判断 varies

  hp: A.HP.average,     // 依据：size/耐久选中版本完全没写，作为中立占位实体套用中档默认值，非设定
  radius: 0.32, height: 1.75,
  // 依据：外形只写"是以前探索过本层的流浪者的分身（doppelganger）"、"有眼睛"，没写体型数字——
  // 按常见成年人体型给默认碰撞体积/身高，非设定精确数字

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 140 },
  // 依据：感官（senses）原文完全未写，套用人形默认档位（非设定）；它本身不索敌也不追人，
  // 这组感官只用来在下面的 A.wanderer 巡逻里避障/找路，不影响"直视致命"机制（那个机制看的是
  // 玩家有没有正对着它看，不是它有没有看见玩家）

  aura: { radius: 10, sanityPerSec: A.AURA.mild },
  // 依据："看见印记会因不明原因产生巨大的痛苦"——用持续小幅掉 san（噩梦模式生效，player.js 结算）
  // 表现"看见就难受"；具体半径/数值原文没给，取和 observer.js 同档的温和范围，非设定精确值。
  // 注：player.js 的光环判定只按距离，不做视线遮挡检测（跟 observer.js/wrangler.js 的现有实现一致），
  // 这是当前引擎光环原语的通用限制，不是本文件单独引入的偏差

  // 没有 attack 字段：选中版本原文写"没有物理危险"，印记不会主动伤人
  brain: A.wanderer({ speed: A.SPEED.walk, retaliate: 'flee' }),
  // 依据："以前探索过 Level 17 的流浪者的分身"——给它普通行走速度到处游荡，模拟一个人在层里走动；
  // 原文没写它是否躲避/靠近玩家，不加 shyRadius/homeRadius，任其自由巡游；
  // retaliate 显式给 'flee'：wanderer 默认 retaliate:'fight'，但它没有 attack 字段，被打后 melee 直接
  // 返回 false，会卡在 chase 状态用 run 速度永远追不上人（见 _archetypes.js WANDERER 默认值 + melee 实现），
  // 和原文"没有物理危险、中立"的气质不符，改成被打后躲开，不再纠缠

  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    if (e.dead) return;
    // 依据："直视它眼睛的极端情况会导致脑死亡……通常会让流浪者昏迷 3 到 4 小时"——引擎没有"看一眼就
    // 昏迷/必死"的钩子（见 apiRequests），和 hunter.js 的"对视没法得救"用同一个近似手法：玩家正对着
    // 它的眼睛时，按秒重扣理智（A.AURA.crushing，比上面常驻的 mild 光环猛得多），只在噩梦模式真正生效，
    // 用理智崩溃/濒死的压迫感近似"直视致命"，不是真正的昏迷计时或必死判定
    if (A.playerLooking(e, 15, 12)) A.sanityPulse(e, api, 12, A.AURA.crushing, 1);
  },

  anim: {
    gait: 'biped', breathe: 0.02, twitch: 0,
    // 依据：原文没写它的动作举止是否异常（是否模仿动作、是否有诡异抽搐），不额外加抽搐，走路用普通人形步态
  },

  build() {
    return A.wrap(A.parts.humanoid({
      height: 1.75, thin: 0, bulk: 1, head: 'round',
      hands: true, feet: true, claws: 0, hair: 0,
      // 依据：appearance 只提到它是人形分身、有眼睛，没写体毛/爪/发型，不额外添加
      face: { eyes: 2, eyeShape: 'round', smile: false, teeth: 0 },
      // 依据："提到它有眼睛"——只做眼睛，没写嘴/表情，smile 关掉、不加牙齿
      colors: { body: 0x8d8578, glow: 0xcfc9bd },
      // 依据：appearance 明确没写颜色/是否半透明——不编造肤色或透明效果，取一个不抢眼、略发灰的
      // 中性肤色，呼应"分身/拷贝"而非真人的观感，非设定精确颜色；眼睛颜色同理取自然色，不用鲜艳色
      look: { body: 'skin' },
      mats: { glow: A.mat.lambert(0xcfc9bd) },
      // 依据：原文只说"有眼睛"，没写发光——用普通受光材质而不是 glowFace 默认的自发光材质，
      // 避免把它做成笑魇那种"黑暗里发光的眼睛"，那是没写过的细节
      key: 'imprint_v1',
    }), { label: 'imprint' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "直视眼睛的极端情况会导致脑死亡"、"通常昏迷 3~4 小时"：引擎没有"看一眼触发必死/长时间昏迷状态"的
//   钩子，也没有"冻结玩家若干分钟"的机制；用 A.sanityPulse(crushing) 在玩家正视它时按秒重扣理智近似
//   其致命性/压迫感（噩梦模式生效），不是真正的昏迷计时或死亡判定，与 hunter.js 的同类近似手法一致，
//   已写进 apiRequests。
// - 它是否模仿流浪者的动作、能否与流浪者互动、消失/重现的规则：选中版本原文完全没写，按"没写的细节不做"
//   处理，不额外编造行为。
// - 是否半透明、具体颜色、衣着：选中版本明确未提，不编造，取中性灰调肤色并在颜色注释里说明非设定。
