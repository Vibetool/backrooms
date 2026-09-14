// 观察者 The Observer（Entity 161）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_161  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）。
// 调研只能靠 WebSearch 摘要拼出内容（直连 402、镜像站要人机验证，backrooms-research/entities/observer.json
// 的 note 有记录），下面每条依据都基于这份摘要，没有逐字核对原文。
// 注意：这个 key 和已有的 js/entities/watcher.js（Entity 5923 "Watchers"，进房间会心脏病发作那个）是
// 完全不同的实体，两者互不通用设定，本文件没有借用 watcher.js 的任何数值/机制。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'observer', en: 'The Observer', zh: '观察者', version: 'fandom',
  faction: 'neutral',
  // 依据：调研里 hostility 填的是 neutral，注明是按"不靠近、不触碰、不攻击"归的（页面正式分级 unverified）；
  // 没有 varies，直接按这个值给，不额外判断

  hp: A.HP.average,
  // 依据：它的存在本身都没被证实，原文没写血量/是否能被杀死，取中档占位值，非设定
  radius: 0.3, height: 1.7,
  // 依据：size unverified（没有外形数据）；"本能地知道有东西在远处盯着"暗示是一个大致人形的存在感，
  // 按普通成年人体型给默认碰撞体积，非设定

  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.poor, fov: 360 },
  // 依据："警觉性极高"——sight 取较高档；纯粹是视觉/直觉层面的监视，原文没写听觉，给较低默认值；
  // fov 给 360——它一直"从远处"观察，不需要正对目标才能看见

  aura: { radius: 14, sanityPerSec: A.AURA.mild },
  // 依据："流浪者唯一能感到的是强烈而清晰的被注视感"——用持续小幅掉 san 表现这种无形的压迫感；
  // 具体数值原文 unverified，取温和档（它本身不靠近、不接触，不该是重度掉 san），非设定精确值
  // 没有 attack 字段：原文明确"不靠近、不触碰、不攻击"，致死性也 unverified，不给攻击能力

  brain: A.wanderer({ speed: A.SPEED.slow, shyRadius: 12 }),
  // 依据："始终保持距离、从不靠近"——用 shyRadius 让它在玩家进入这个范围时主动拉开距离；
  // 没有 def.attack，wanderer 内部的 melee/acquire 会安全地什么都找不到，retaliate 选项实际不会触发

  think(e, dt, api, brain) {
    const now = api.time;
    const d = e.data.obs || (e.data.obs = {});
    // 依据：自己的状态放 e.data 的独立键（不是 A.state(e) 用的 e.data.arch），避免和骨架自身的字段混用
    // 消失/出现改走 A.fx.vanish / A.fx.appear（ENGINE_PLAN M1 AA）：隐身期间不用自己每帧改 e.state，
    // 淡出淡入由 animate 工厂按 e.state === 'vanish' 自动接管，房主和客机都跑
    if (d.hideUntil && now < d.hideUntil) return;
    if (d.hideUntil) { d.hideUntil = 0; A.fx.appear(e); }   // 隐藏期刚结束，显式转回"现身"，交回骨架 think 继续游荡/保持距离
    const looked = A.playerLooking(e, 40, 20);
    // 依据："流浪者一旦清楚察觉它（凭直觉感到、眼角余光瞥见，或者转身去找视线来源）……它就瞬间彻底消失"——
    // 用 A.playerLooking 判定"正在看向它"；角度/范围原文没给数字，取比常规索敌更宽的角度，因为原文说
    // 连"眼角余光瞥见"都算察觉，不是要求精确瞄准
    d.gazeSec = looked ? (d.gazeSec || 0) + dt : 0;
    if (d.gazeSec > 1.4) {
      // 依据：原文没给"看多久算察觉"，要求连续一段时间的注视才触发，而不是单帧扫过就消失，
      // 一是更接近"清楚察觉"这个措辞（不是无意扫过），二是避免它前脚刚出现后脚就消失、根本看不清长相
      d.gazeSec = 0;
      d.hideUntil = now + 3 + api.rng() * 3;
      // 依据：原文没给"消失多久"，取 3~6 秒的占位区间，够角色转回头时它已经不见了，非设定精确值
      const dark = A.lightSeek(e, api, 16, 'dark');
      if (dark) { e.x = dark.x; e.z = dark.z; }
      else {
        const P = A.nearestPlayer(e);
        if (P) { const ang = api.rng() * Math.PI * 2; e.x = P.x + Math.cos(ang) * 12; e.z = P.z + Math.sin(ang) * 12; }
      }
      // 依据："瞬间彻底消失"——直接把它挪到别处（优先挑暗处，呼应"几乎只出现在极其昏暗的地方"），
      // 比"转身慢慢跑开"更接近"消失"这个措辞；坐标瞬移仍是近似（引擎没有真正的相位/传送接口，见 apiRequests），
      // 但"消失"本身现在用 A.fx.vanish 做成淡出＋隐藏，不再是整只模型瞬间切可见性
      A.fx.vanish(e);
      return;
    }
    brain.think(e, dt, api);
  },

  anim: {
    gait: 'none', breathe: 0.01, sway: 0,
    // 依据："察觉瞬间彻底消失"——消失/出现不再自己切 pivot.visible，改成 A.fx.vanish/appear 驱动的淡出淡入
    // （animate 工厂在 onFrame 之后自动按 e.state === 'vanish' 接管，见 think 里的调用）
  },

  build(ctx) {
    return A.wrap(A.parts.silhouette({
      height: 1.7, thin: 0.55, head: 'faceless', hands: true, feet: true, claws: 0, hair: 0,
      opacity: 0.22, rimOpacity: 0.08,
      // 依据：原文强调"没有任何清晰影像、连模糊轮廓都没有""从未被清晰拍到"——选中版本没给出可建模的
      // 具体外观，但游戏里必须有个能被感知到的最低限度呈现，所以做成极低不透明度、边缘更淡的模糊人形
      // 暗影，对应"本能地知道有东西在盯着、却分辨不出任何形状"这句描述，而不是凭空编造它的真实长相；
      // 这一处理写进返回值 notes
      colors: { body: 0x020203 },
      look: { body: 'shadow', head: 'shadow' },
      key: 'observer_v1',
    }), { label: 'observer' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "彻底消失"里"挪到别处"仍是瞬移近似（引擎没有真正的相位/传送接口，见 apiRequests）；消失/重新出现
//   本身已经用 A.fx.vanish / A.fx.appear 做成淡出淡入（ENGINE_PLAN M1 AA），不再是整只模型瞬间切可见性。
// - 它的存在本身是否真实（研究界的集体幻觉/心理投射争议）：这是背景设定层面的争议描述，不是可执行的
//   游戏机制，不实现；游戏里仍然把它具体化成一个可交互的实体，因为需要一个可见/可测试的对象。
// - 具体外观、感官、消失时长、理智数值：选中版本大量字段是 unverified，均取游戏性占位值，已在各字段
//   依据注释里说明。
