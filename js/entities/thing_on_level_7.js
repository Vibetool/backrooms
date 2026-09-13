// 七层之物 The Thing On Level 7
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/level-7  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）。
// 重要提醒（用户规则“例外提醒”）：wikidot-en 没有它的独立实体页（旧编号 Entity 20 现在是别的实体 Scits），
// 以下全部来自 Level 7 “Thalassophobia” 页里提到它的段落。这一页对它的**外形和体型完全没有描述**（appearance/size
// 都标 unverified）。社区里流传的经典形象——wikidot-cn 旧版“黑色蛇形身体、约 11000 米长、口能吞下小型旅馆、
// 排焦油”，以及 Fandom 版“鲸类生理+鳗形身体、头尾从未被看到、天体/行星轨道级”——都来自**未选中**的版本，
// 本文件明确不采用；因此下面的模型只按选中版本里唯一写实的几句（顶级掠食者、活动于午夜带/深渊上层、
// 眼睛因常年生活在黑暗中而对光更敏感、怕光可被暂时制服）拼出一个不具体成型的“巨大暗影躯体”，
// 不代表这个实体的真实外形，只是选中版本没写外形时的游戏性占位。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'thing_on_level_7', en: 'The Thing On Level 7', zh: '七层之物', version: 'wikidot-en',
  faction: A.faction('hostile'),   // 依据：原文 hostility 明确写 hostile

  hp: A.HP.titan,
  // 依据：原文没有直接的耐打描述，只按“Level 7 的顶级掠食者，似乎已经消灭了海里其他所有生命”
  // “速度、力量、侦测能力只有 Tiny 能与之相当”这类定性描述，给常规档位里最高一档（titan）表示极难消灭；
  // 不是“杀不死/immortal”这种原文没写的断言
  radius: 2.4, height: 3.2,
  // 依据：体型原文完全没写（unverified）。只按“唯一统治整片深海、只有传说级的 Tiny 能与之相提并论”
  // 这个定性推断出“明显大于人”，给一个游戏性默认的大尺寸，非设定精确数值；
  // 不采用未选中版本里“11000 米”“星体/行星轨道级”等具体数字
  speed: { walk: A.SPEED.jog, run: A.SPEED.sprint },
  // 依据：“速度……只有 Tiny 能与之相当”→ 按“比玩家快很多、几乎追不掉”取次高档 sprint；
  // 原文没给具体数字，非设定；jog 作为平时巡游速度的游戏性默认值
  perception: { sight: A.SIGHT.hawk, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: true },
  // 依据：“侦测能力与 Tiny 相当”→ 给最高感知档 hawk、360° 全向；“因长期生活在永久黑暗中，眼睛对光更敏感”
  // → needsLight:false（黑暗里正常感知，不依赖光）、avoidsLight:true（标记怕光，行为见下面 lightBound）；
  // 听觉原文未写，给默认值 normal
  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 3.2, cooldown: A.COOLDOWN.heavy },
  // 依据：攻击方式原文写“unverified”（页面没写具体怎么攻击）。这里只按“顶级掠食者、消灭了海洋里其他所有
  // 生命”的定性给一个保底的高伤害/长冷却，让它能在阵营战斗系统里正常发挥作用；不臆造具体招式——
  // 不是未选中版本里“像鲨鱼绕圈整口吞掉”，也不是“巨浪/肠胃爆炸冲击波”那些说法
  // 原文未提理智影响 → 不写 aura；原文完全没提任何叫声/声音 → 不加 sounds

  // 依据：“与 Tiny 划区而治、互不进入对方区域、不交流”——两者按选中版本都不主动招惹对方，这里不需要
  // canTarget 特殊处理：hostile 阵营之间本来就不互相攻击（entities.js 的阵营规则），天然满足“不交流”；
  // 具体谁出现在哪个深度/哪个区域是层级生成决定的，不是实体文件的职责（WAVE2.md 第 2 节）
  brain: A.lightBound(A.stalker({
    patrol: 'wander', patrolRadius: 30, patrolSpeed: 'jog', chaseSpeed: 'sprint', searchSpeed: 'jog',
    alertSec: 0.3, searchSec: 8,
    // 巡游/警觉/搜索的具体时长原文未写，给游戏性默认值，非设定
  }), { mode: 'avoid', threshold: A.LIGHT.lit, onLight: 'freeze', ignoreLitTargets: true }),
  // 依据：“眼睛怕光，页面称可以利用这点暂时制服它以便探索”→ 站在真正明亮处时定住（freeze），
  // 近似“暂时制服”；阈值取较高的 lit（而不是默认的 dim），因为它常年生活在深海永久黑暗里，
  // 普通的昏暗环境光不足以让它畏惧，只有真正明亮才触发，原文没给数字，非设定；
  // ignoreLitTargets 表示"猎物躲进亮处它就不追"，同样是"怕光"这条弱点的延伸，不是原文另外写的细节；
  // 引擎按实体所在位置的光照判断，没有专门的"手电筒照射目标"判定，写进 apiRequests

  anim: {
    gait: 'none',   // 自定义骨架没有肢体/翅膀，不用步态
    fly: { cruise: 2.2, low: 0.6, bob: 0.25, bobHz: 0.3, bank: 0.05, ceiling: true, clearance: 0.6 },
    // 依据：“在深海中游动”，引擎没有游泳/水体物理（写进 apiRequests），借用飞行高度机制模拟“悬在水中/
    // 俯冲逼近”的沉浮感：cruise 是平时巡游高度，low 是扑击时贴近目标的高度，具体数值非设定，只求肉眼可见
    recoil: 0.15, fall: 'fade',
    onFrame(e, dt, api, u) {
      if (!u.rig) return;
      const t = api.time;
      A.anim.addRot(u.rig, 'core', Math.sin(t * 0.5 + u.seed) * 0.06, Math.sin(t * 0.35 + u.seed) * 0.1, 0);
      // 没有肢体可做步态动画，用整个躯体缓慢左右摆动表示巨大身躯游动转向时的“活着在动”
      if (e.state === 'attack') A.anim.addRot(u.rig, 'core', Math.sin(t * 10) * 0.18, 0, 0);
      // 攻击时叠加更快的前后点头式抖动，只是让攻击状态肉眼可辨，不代表具体咬合/冲撞招式（原文未写）
    },
  },

  build(ctx) {
    return A.wrap(A.parts.limbCluster({
      key: 'thing_l7_v1',
      count: 0,   // 外形原文完全没写，不构造触手/肢体等具体形态，只用一团轮廓表示“看不清全貌的巨大暗影躯体”
      core: 1.3, coreScale: [0.95, 0.85, 2.0],
      // 依据：只按“体型远大于人、统治整片深海”这类定性推断出的大致轮廓（前后拉长的团块），非设定精确形状
      colors: { body: 0x05060b, glow: 0xdcefff },
      // 依据：常年生活在永久黑暗的午夜带/深渊上层 → 取不抢眼的近黑色躯体，颜色本身原文未写，非设定；
      // 眼睛用冷白光的 glow 槽位（对应“眼睛对光敏感”这一确认细节），发光颜色本身非设定
      extend(b, d) {
        const cy = d.center[1], cz = d.center[2];
        for (const s of [-1, 1]) b.sphere('core', 'glow', 0.12, [s * 0.4, cy + 0.15, cz - 2.1], [1, 1, 1], [8, 6]);
        // 依据：选中版本里唯一明确提到的身体部位就是“眼睛”（对光敏感、怕光）→ 只加这一个确认过的细节，
        // 不臆造嘴、鳍、鳞片等未选中版本才有的部位
      },
    }, ctx), { label: 'thing-l7' });
  },
});
})();
