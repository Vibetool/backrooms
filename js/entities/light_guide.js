// 微光向导 Light Guide（Entity 35）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-35  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 冲突提醒（写进 lore-choices 的 conflicts，不采用其他版本的说法）：
// - 稀有度/成群：实体页说很罕见，但选中版本自己的 Level 8/16 补充叙事又写"一群""大量"——两者都算选中版本
//   自己的内容，不冲突；密度/是否成群由层级文件决定，这里不处理生成数量。
// - 颜色：实体页本身没写具体颜色，只说"会变色"；CN Level 8 叙事给出"蓝绿色的辉光"，同属选中版本自己的
//   补充材料，不是从别的 source 借的，采用蓝绿作为基调色，同时保留"会变色"的动态效果。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 基调色：蓝绿（依据：CN Level 8 叙事"蓝绿色的辉光"，选中版本自身的补充材料）
const BASE_COLOR = 0x3fe6c8;
// 附近出现有害实体时的警示色（本文件的近似扩展，见下方 think 与文件末 notes：选中版本没有写"用颜色报警"
// 这个具体机制，只写了"引导流浪者……避开危险"，这里借用它本来就有的"变色交流"能力做一个近似）
const WARN_COLOR = 0xffb347;

// 附近出现有害实体就切换到警示色的判定半径。选中版本没给"避开危险"的具体触发距离，
// 取一个比下面 noticeDist 小一档的数字，非设定精确值。
const DANGER_R = 10;

A.register({
  type: 'light_guide', en: 'Light Guide', zh: '微光向导', version: 'wikidot-cn',
  faction: 'friendly',   // 依据：hostility = friendly；attack 段"无敌对迹象"

  hp: A.HP.immortal,     // 依据：attack 段原话"杀死一个微光向导是不可能的"
  // 依据：size"5–15 厘米"（球形光点直径）。这里给的是碰撞/视线判定用的占位体积，不是最终视觉大小，
  // 实际发光球模型半径更小（见 build），非设定精确数字。
  radius: 0.12, height: 0.3,
  speed: { walk: A.SPEED.walk, run: A.SPEED.brisk },
  // 依据：speed 字段"未记载"。它要能带着流浪者走又不能把人甩掉，取比玩家步行(3.0)稍慢、比玩家冲刺(5.2)
  // 明显慢的中等档位，非设定精确数字。
  perception: { sight: A.SIGHT.hawk, hearing: A.HEARING.acute, fov: 360 },
  // 依据："对自身当前所在层级几乎无所不知，似乎能感知其他实体的位置"——两项都取现有档位里的最高值；
  // fov 给 360（球形光点没有正面朝向的概念，四面都能感知）。
  // 引擎没有"当前层级内全知"的接口（findTarget/lightAt 都是有限半径的局部查询），只能用最高感知档位近似，
  // 写进 apiRequests。
  // 选中版本没写理智影响 → 不写 aura；weaknesses 段只说"物理攻击不会还手，但看上去会让它们困扰"，
  // 没给出可量化的效果，不加数值。
  // 选中版本说它"不会还手"（无敌对迹象、不主动伤人）→ 不写 attack（同 _TEMPLATE.md 5.8 节规则）。
  sounds: {},   // 依据：behavior 只写"用类似跳舞的方式来回移动并改变颜色进行交流"，没有任何声音描述

  // 依据：behavior"温顺；引导流浪者找补给、避开危险"→ 用向导骨架，engage:false（不参战，纯向导）；
  // leadTo:'items' 对应"找补给"；followDist/leadDist 给小一点，配合它本身很小的体型贴身带路；
  // noticeDist 取一个较大值近似"对本层几乎无所不知"（引擎限制见上方 perception 注释）；
  // idle:'orbit' 对应"以类似跳舞的方式来回移动"——玩家没有明确目标时它绕着玩家打转而不是呆立不动。
  brain: A.guide({
    followDist: 1.6, leadDist: 3, waitDist: 6, noticeDist: 36,
    engage: false, leadTo: 'items', idle: 'orbit',
  }),

  // "避开危险"的近似实现：向导骨架本身不认识"危险"这个概念（它只会带路/跟随，不会主动远离威胁）。
  // 完整实现"绕开有害实体带玩家走"需要一套能同时兼顾"去补给"和"绕开威胁"的寻路逻辑，但 leadTo:'items'
  // 内部最近补给点的查找方式没有作为公开 API 暴露给实体文件（见 apiRequests），没法在自定义 leadTo
  // 函数里复用。这里退而求其次：附近出现有害实体时，把 e.state 标成 'danger'，animate 里切换成暖色，
  // 用"变色提醒"模拟向导对危险的示警——这本身也贴合它"变色交流"的设定能力，但不会真的带玩家绕路，
  // 这点写进返回值 notes。
  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    if (e.state === 'idle' || e.state === 'wander' || e.state === 'follow') {
      const near = A.nearby(api, e, DANGER_R, ['hostile']);
      if (near.length) e.state = 'danger';
    }
  },

  anim: {
    gait: 'none',
    fly: { cruise: 1.2, low: 1.1, rest: 1.0, bob: 0.1, bobHz: 1.1, ceiling: true, clearance: 0.15 },
    pulse: 0.05,
    fall: 'fade',   // 依据：没有实体身体，"死亡"（理论上不会发生，hp 为 immortal）用淡出表现，非设定
    onFrame(e, dt, api, u) {
      const orb = u.orb;
      if (!orb) return;
      const t = api.time;
      // 依据："以类似跳舞的方式来回移动并改变颜色进行交流"：颜色持续在蓝绿基调附近缓慢漂移，
      // 表现"会变色"这条能力；附近有威胁时切到暖色示警（见上方 think 注释）。
      const danger = e.state === 'danger';
      const hue = danger ? 0.07 : 0.46 + 0.05 * Math.sin(t * 0.5);
      orb.coreMat.color.setHSL(hue, 0.8, 0.55);
      orb.haloMat.color.setHSL(hue, 0.8, 0.6);
      // 依据："以随机间隔出现和消失，但似乎能控制"：用周期性的大小起伏模拟时隐时现，
      // 不做成真正从场景里移除（避免和碰撞/向导逻辑打架），非设定精确数字。
      const flick = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 0.31);
      u.pivot.scale.setScalar(Math.max(0.15, flick));
      // 依据："跳舞的方式来回移动"：叠加轻微左右/前后漂移，纯表现，不影响实际寻路位置。
      u.pivot.position.x = Math.sin(t * 0.8) * 0.12;
      u.pivot.position.z = Math.cos(t * 0.55) * 0.08;
    },
  },

  build(ctx) {
    // own:true —— 每实例一份材质，颜色动画才不会把所有微光向导一起染了（同 _demo_guide.js 写法）
    return A.wrap(A.parts.orb({ radius: 0.06, color: BASE_COLOR, halo: 0.9, own: true }), { label: 'light_guide' });
  },
});
})();
