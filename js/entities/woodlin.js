// 木灵 Woodlin（旧 Entity 45）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/old:entity-45  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 注：中文站现行 /entity-45 已改名"汲碌焰灵"，与木灵无关；本文件只按 old:entity-45（木灵旧页面）实现，
// 编号沿用页面自身的 Entity 45（原文标题），不代表这是当前站点的 Entity 45。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 依据："目标一直没有失去理智时……跟踪；目标进入理想精神状态（例如偏执）后……试图抓住流浪者"——
// 原文没有给"偏执"对应的具体理智数值，取中低理智档作为游戏内"偏执"的数值化界线，非设定精确值
const PARANOID_SANITY = 40;

function buildHidden() {
  // 依据："没有实质身体，只以二维图案出现在木板上、原木内或其他看似木制的材料上……大体是人面、人像、
  // 花纹或雕刻品"——潜伏形态做成一块贴着木面的薄板，board 表面用几处浅浮雕做出人脸轮廓，颜色和发光部位
  // 原文都没写，取不抢眼的木色，非设定精确值
  return A.parts.rig('woodlin_plank_v1', b => {
    b.bone('plank', null, [0, 0.9, 0]);
    b.box('plank', 'body', [0.46, 1.5, 0.05], [0, 0.9, 0]);      // 木板本体
    b.box('plank', 'body', [0.09, 0.05, 0.02], [-0.11, 1.24, -0.03]); // 浮雕：左眼凹纹
    b.box('plank', 'body', [0.09, 0.05, 0.02], [0.11, 1.24, -0.03]);  // 浮雕：右眼凹纹
    b.box('plank', 'body', [0.2, 0.035, 0.02], [0, 1.04, -0.03]);     // 浮雕：嘴纹
  }, {
    colors: { body: 0x6b4a30 },
    look: { body: 'lambert' },
  });
}

function buildBurst() {
  // 依据："部分身体从木面伸出，试图抓住流浪者""碎片扎进身体""一只死亡飞蛾被 30 多根等长木刺刺穿成球"——
  // 现形/攻击形态做成一束从原地喷出的木刺（用 limbCluster 表现成百上千小碎片里的可见一批），
  // 数量/长度是游戏可视化的取值，不是设定精确数字；颜色未写，取比薄板更深的木色，非设定精确值
  return A.parts.limbCluster({
    count: 9, segments: 2, length: 0.55, radius: 0.035, tip: 0.006, spread: 0.85,
    center: [0, 1.1, 0], core: 0.16,
    colors: { body: 0x5a3c26 },
    look: { body: 'skin' },   // 构件没有"木刺"材质选项，取带纹理的 skin 质感近似粗糙木刺表面，非设定
    key: 'woodlin_burst_v1',
  });
}

A.register({
  type: 'woodlin', en: 'Woodlin', zh: '木灵', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.immortal,
  // 依据："没有实质身体，只以二维图案出现"，只有从木面切出时才短暂拥有实体；原文的"应当/不应当"弱点部分
  // 只讲了怎么避开它（远离木面、离开区域），没有写任何"如何伤害/杀死它"的方法，按无法被常规攻击杀死处理
  radius: 0.3, height: 1.8,
  // 依据：size unverified；现形抓人时呈人形抓取姿态，radius/height 按人形尺度给游戏性默认值，非设定精确数字
  speed: { walk: A.SPEED.still, run: A.SPEED.still },
  // 依据：固定在木质表面，不会真的移动位置（见下面 brain 的 fixed:true），此为占位值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据：原文只说它能"沿木制表面跟踪数英里"、"判断目标精神状态"，没有解释具体感知方式（视觉/听觉/其他）；
  // 给中性默认值只是为了让引擎的索敌逻辑能正常工作，不代表设定数字
  attack: { hp: A.DAMAGE.severe, range: 1.3, cooldown: A.COOLDOWN.heavy },
  // 依据："碎片扎入肺、心、脑或眼球必然致命；拔出全部或大部分碎片仍可能存活"——高致死但不是每次必定即死，
  // 取 severe 而非 lethal；"部分身体从木面伸出，试图抓住流浪者"——比贴身近战稍远的抓取距离；
  // "反复拉入……"是一个持续数小时的过程，单次抓取取最长的冷却档，非精确数字
  sounds: {},   // 依据：原文没有描述任何声音效果（没有尖叫、低语等描述），不加入未记载的声音

  // 行为：固定伏击陷阱（依据：见上方 hp 注释里的"没有实质身体……固定在木质表面"）。canTarget 复刻
  // "只对精神不稳定（偏执）的流浪者下手"这一条：对玩家目标要求 BR.player.sanity 低于阈值才判定可攻击；
  // 对其他实体没有这个限制（依据：案例里提到杀死过一只死亡飞蛾，没有"实体也要精神不稳定"这种条件）。
  brain: A.ambush({
    fixed: true,
    revealRange: 5,   // 非设定：只控制"lurk"预警可见状态的展示距离，fixed 分支下真正能否出手只看是否够得着
    canTarget(e, t, api) {
      if (t.kind !== 'player') return true;
      const P = BR.player;
      return !!(P && typeof P.sanity === 'number' && P.sanity <= PARANOID_SANITY);
    },
  }),
  anim: {
    gait: 'none',        // 依据：固定不动，没有步态
    strike: 'grab', fall: 'none',
    // 依据："试图抓住流浪者"→ grab；hp 为 immortal 不会真正死亡倒地，fall 给 none
    formOf(state) { return (state === 'strike' || state === 'attack') ? 'true' : 'hidden'; },
  },

  build(ctx) {
    return A.wrap({ hidden: buildHidden(), true: buildBurst() }, { form: 'hidden', label: 'woodlin' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "沿木制表面跟踪数英里"：无法在引擎里实现让一个固定实体跨越关卡范围移动/重新出现在玩家附近的木面上，
//   这里退而求其次做成"固定在初始位置的伏击陷阱"（fixed:true），只有玩家自己靠近到攻击范围内才会被抓，
//   技术妥协，非设定精确还原，感知范围/跟踪方式见上方 perception 注释。
// - "被抓住后有 2-3 小时内反复拉入插刺、最终因脑干下部囊肿破裂死亡"这个延时结局：引擎战斗是即时伤害，
//   没有"表面痊愈、数小时后暴毙"的延时死亡机制，用一次性的高伤害（attack.hp: severe）近似代替。
// - "有人认为被木灵杀死的人会变成新的木灵，尚未证实"：原文自己也说未证实，不实现。
// - "格外注意木头表面的特殊纹理""随身带镊子"：这些是提示玩家肉眼观察/使用道具的建议，游戏里没有对应的
//   探索/道具机制，未实现。
