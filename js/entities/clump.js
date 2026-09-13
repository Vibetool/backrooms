// 肢团 Clump（Entity 5）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-5  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'clump', en: 'Clump', zh: '肢团', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.weak,          // 依据："骨骼极其脆弱"（weaknesses 一段原文）→ 不耐打
  // 依据：size 字段页面自相矛盾（一处最大约3英尺样本，一处记录最大约4米）——同一版本内部矛盾，
  // 不借用其他来源，取较常见的"最大约3英尺"样本换算成直径约0.91米，半径按一半估算；
  // 它不是直立生物而是贴地的一团肢体，height 只用来定视线起点，按矮团的比例给一个游戏性数值，非设定精确值
  radius: 0.45, height: 0.75,
  speed: {
    walk: A.SPEED.walk,     // 依据："在各层游荡寻找猎物"——日常游荡速度无数字，取通用巡游档，非设定
    run: A.SPEED.sprint,    // 依据："进入运动状态后展现极高速度和力量……行动灵活"→ 定性"极高"，对应"比人快、跑不掉"档
  },
  // 依据：感官机制原文"未明写"（部分报告称肢体团中有眼睛耳朵，但不确定、不普遍）→ 感知用默认值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 200, needsLight: false, avoidsLight: false },
  attack: {
    hp: A.DAMAGE.severe,     // 依据："高致死"
    sanity: 0,                // 依据：sanityEffect 标注 unverified，不填
    range: 2.4,                // 依据："与猎物距离缩短到8英尺内……伸出最长肢体抓住猎物"，8ft × 0.3048 ≈ 2.4384m
    cooldown: A.COOLDOWN.heavy, // 依据："拖入中心，露出装满锋利牙齿的嘴吞食"——抓、拖、吞三段过程，比单纯撕扯更慢
  },
  // 选中版本没写 sanityEffect（unverified）→ 不加 aura
  // 选中版本没写具体叫声（appearance/behavior 均未提声音）→ 不加 sounds

  // 行为：巡逻游荡找猎物；命中一次后进入短暂"进食后蛰伏"（依据：behavior "满足食欲后……在地面挖掘把自己埋进去"）。
  // 引擎没有饱食度概念，用"最近一次命中"代替"进食"信号，命中 2 秒后蛰伏 8 秒，时长为游戏性数值、非设定。
  brain: A.stalker({
    patrol: 'wander', patrolRadius: 16, alertSec: 0.4, searchSec: 10,
    onAttack(e, t, api) { e.data.lastFeedAt = api.time; },   // 依据：命中后记为"进食"信号，供下方 think 判断蛰伏
  }),
  think(e, dt, api, brain) {
    const d = e.data, now = api.time;
    if (d.dormantUntil != null) {
      if (now < d.dormantUntil) { e.state = 'dormant'; return; }   // 蛰伏期间原地不动、不索敌，对应"埋进地面休眠"
      d.dormantUntil = null; d.lastFeedAt = null;                   // 苏醒，恢复正常游荡/狩猎
    } else if (d.lastFeedAt != null && now - d.lastFeedAt > 2) {
      d.dormantUntil = now + 8;
      e.state = 'dormant';
      return;
    }
    brain.think(e, dt, api);
  },

  anim: {
    gait: 'none',              // 不是双足/四足步态，构件本身没有对应的"甩肢体"步态选项
    sway: 0.6, swaySpeed: 2.2,  // 依据："倾向于把肢体甩向地板来移动"→ 加大肢体摆动幅度模拟甩动
    strike: 'grab',              // 依据：攻击是"伸出肢体抓住猎物"
    recoil: 0.18,
    fall: 'crumple',
    onFrame(e, dt, api, u) {
      // 蛰伏时把模型下沉模拟"埋进地面"；animate 只能读 e.state、不能改 e.x/y/z，故用 pivot 高度表现（同飞行实体用 pivot.y 表现飞行高度的做法）
      const target = e.state === 'dormant' ? -0.35 : 0;
      if (u.pivot) u.pivot.position.y += (target - u.pivot.position.y) * Math.min(1, dt * 4);
    },
  },

  build(ctx) {
    return A.wrap(A.parts.limbCluster({
      count: 7, segments: 5,        // 依据："由长度、力量各不相同的多条肢体组成"——数量未记载，取比构件默认(6)略多的游戏性数值
      length: 1.6,                    // 依据："最长肢体在8–10英尺之间"（约2.4–3米）；受限于室内走廊尺度与碰撞体积做等比缩短，方向依据不变
      radius: 0.07, tip: 0.012,       // 依据："力量各不相同"→ 略调粗一点表现有力的肢体，非精确设定
      spread: 0.85,                    // 依据："展现极高速度和力量、行动灵活"→ 肢体向四周张开甩动的姿态
      core: 0.32,                       // 依据："中心有装满锋利牙齿的嘴"——中心肉团需要足够大小容纳嘴部
      colors: { body: 0x5a3226, glow: 0xffffff },   // 依据："皮肤黏糊糊、近乎湿漉"，气味类似"烧焦血肉和红色大丽花"→ 取暗红棕色湿肉色；无发光部位描述
      look: { body: 'skin' },   // 构件没有"湿滑"材质选项，取最接近的皮肤纹理近似，非设定
    }), { label: 'clump' });
  },
});
})();
