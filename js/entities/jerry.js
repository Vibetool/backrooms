// 杰瑞 Jerry（Entity 7）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-7  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 注：wikidot-en 的「看到人就追、跑赢者被瞬间切进地面」「驯服几天后飞走」，以及英文旧版存档摘要里
// 「拿着它的人被控制、放下换别人拿一样被控制」「可能去了无出口的 Jerry's Room」，选中版本本次提取都
// 没有对应描述，按规则不借用；下面只按 wikidot-cn 写的做，读者如果记得别的版本细节，这里刻意没做。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'jerry', en: 'Jerry', zh: '杰瑞', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility = hostile（提取器概括为"中等敌意"，原词 unverified，仍按 hostile 取）

  hp: A.HP.weak,
  // 依据："小型鸟类"，没有具体耐久数据；按小型鸟的体型给偏低档，非设定精确数字
  radius: 0.15, height: 0.32,
  // 依据：size unverified（页面未给数字），按小型鹦鹉的常见体型给游戏性默认值，非设定精确数字
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：speed 字段 unverified；本次提取没有"看到人就追"的情节（wikidot-en 才有，不借用），
  // 所以刻意不给 run/sprint 这类暗示"长距离猎杀式追击"的档位，只给 walk/jog——
  // jog 的含义是"步行甩不掉、冲刺能甩"，对应它"徘徊、走近接触"而非扑杀的定位
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 300, needsLight: false, avoidsLight: false },
  // 依据：senses 字段 unverified；fov 按鸟类视野普遍宽阔给较大值，非设定精确数字
  attack: { hp: 0, sanity: 15, range: 0.9, cooldown: A.COOLDOWN.heavy },
  // 依据："接触者会被教化：被迫崇拜杰瑞，进入精神控制状态并诵咏崇拜言辞……未确认致死"——没有物理伤害描述，
  // hp 给 0（对测试人/友善实体不造成血量伤害，符合"不直接攻击"）；教化是精神/理智层面的冲击，sanity 给一个
  // 中等偏高值（原文没有具体数字，非设定精确数字），只在噩梦模式下对玩家生效；
  // range 给贴身接触距离；教化是"数小时后……"的一次性大事件，cooldown 取最长档，不会连续快速重复触发
  sounds: {},
  // 依据：原文没有描述杰瑞自己发出的声音（诵咏崇拜言辞的是被教化的受害者，不是杰瑞本身），不加未记载的声音

  // 行为：wander/perch 用飞行骨架自身的巡逻/悬停状态表现（没有目标时 A.flyer 会 wander 或 hover，
  // 对应"在 Level 1、2 徘徊，或坐在栖木上"）；canTarget 复刻"可用杏仁水驯服，驯服后对驯服者无害"这条弱点——
  // 引擎没有"喂食实体"的通用互动接口（硬规则②），这里用"接触时该玩家随身带着杏仁水"近似"投喂"，
  // 一次接触即视为驯服成功，之后只对这一个玩家失效，其余目标不受影响（原文只说驯服者本人无害）；
  // 原文写的另一种驯服物"向日葵种子"游戏里没有对应道具，只能检查杏仁水，写进 apiRequests
  brain: A.flyer({
    diveRange: 1.6,     // 依据：没有远距离扑击描述，进入比常规更近的距离才会"贴近"目标，非设定精确数字
    climbSec: 1.0,      // 选中版本未写，沿用骨架默认量级的拉起停顿，非设定
    erratic: 0.3,       // 依据：没有具体飞行路径描述，给低幅度随性摆动，避免做成扑食式的凶猛俯冲，非设定精确数字
    canTarget(e, t, api) {
      if (t.kind !== 'player') return true;
      const d = e.data.jerry || (e.data.jerry = {});
      if (d.tamedBy && t.ref === d.tamedBy) return false;   // 依据："驯服后，与驯服者接触不会进行教化"
      const inv = t.ref && t.ref.inventory;
      if (Array.isArray(inv) && inv.some(it => it && typeof it.type === 'string' && it.type.indexOf('almond_water') === 0 && it.count > 0)) {
        d.tamedBy = t.ref;
        return false;
      }
      return true;
    },
  }),
  anim: {
    gait: 'flyer', flapHz: 7, strike: 'none', fall: 'drop', recoil: 0.15,
    // 依据：没有具体攻击动作描述（只是被接触后精神控制，不是啄/抓一类的出手动作），strike 给 none；
    // 摔落用 fly 骨架默认的 'drop'（坠落翻滚），符合被击落的小鸟形象
    fly: { cruise: 1.6, low: 1.0, rest: 1.0, bob: 0.06, bobHz: 1.4, bank: 0.12, ceiling: true, clearance: 0.3 },
    // 依据：没有具体飞行高度数字，cruise 取室内常见的悠闲飞行高度，low 是贴近目标"接触"时的高度，非设定精确数字
  },

  build(ctx) {
    return A.wrap(A.parts.rig('jerry_macaw_v1', b => {
      b.bone('body', null, [0, 0.20, 0]);
      b.bone('head', 'body', [0, 0.27, -0.09]);
      b.bone('beak', 'head', [0, 0.255, -0.135]);
      b.bone('wingL', 'body', [-0.02, 0.225, -0.02]);
      b.bone('wingR', 'body', [0.02, 0.225, -0.02]);
      b.bone('tail', 'body', [0, 0.19, 0.10]);
      b.bone('legL', 'body', [-0.035, 0.20, 0.01]);
      b.bone('legR', 'body', [0.035, 0.20, 0.01]);

      // 躯干：蛋形，前后拉长——依据："金刚鹦鹉"这一物种本身的体型
      b.sphere('body', 'body', 0.095, [0, 0.20, 0], [1, 1, 1.3], [10, 8]);
      // 胸腹白色羽毛——依据："蓝白色"配色
      b.sphere('body', 'belly', 0.07, [0, 0.17, -0.05], [0.9, 0.9, 1.0], [8, 6]);
      // 头部（蓝色）
      b.sphere('head', 'body', 0.055, [0, 0.27, -0.09], [1, 1, 1], [8, 6]);
      // 眼周白色裸皮——金刚鹦鹉常见的面部特征，呼应"蓝白色"配色，颜色本身有依据，具体纹样未写，非设定精确形状
      b.sphere('head', 'belly', 0.032, [0, 0.265, -0.135], [1.3, 1, 0.5], [6, 5]);
      // 钩状鹦鹉喙——依据："金刚鹦鹉"这一物种本身的喙型；颜色未写，取不抢眼的深灰黑，非设定
      b.cone('beak', 'dark', [0, 0.255, -0.135], [0, 0.235, -0.175], 0.02, 5);
      // 双眼
      for (const s of [-1, 1]) b.sphere('head', 'dark', 0.008, [s * 0.026, 0.283, -0.125], null, [5, 4]);
      // 双翼——依据：能飞行（locomotion:"飞行"）
      b.limb('wingL', 'body', [-0.02, 0.225, -0.02], [-0.17, 0.20, 0.0], 0.032, 0.008, 6, 0.4);
      b.limb('wingR', 'body', [0.02, 0.225, -0.02], [0.17, 0.20, 0.0], 0.032, 0.008, 6, 0.4);
      // 长尾羽——依据："金刚鹦鹉"这一物种本身的长尾特征，具体长度未写，非设定精确数字
      b.limb('tail', 'body', [0, 0.19, 0.10], [0, 0.14, 0.32], 0.028, 0.008, 6, 0.45);
      // 细腿与脚爪——依据：小型鸟类栖息在栖木上（原文"坐在杰瑞厅的栖木上"），需要脚部落脚
      b.limb('legL', 'dark', [-0.035, 0.20, 0.01], [-0.035, 0.05, 0.01], 0.009, 0.006, 4);
      b.limb('legR', 'dark', [0.035, 0.20, 0.01], [0.035, 0.05, 0.01], 0.009, 0.006, 4);
      b.box('legL', 'dark', [0.03, 0.008, 0.05], [-0.035, 0.012, -0.015]);
      b.box('legR', 'dark', [0.03, 0.008, 0.05], [0.035, 0.012, -0.015]);
    }, {
      colors: { body: 0x1c5fb8, belly: 0xf4f2ea, dark: 0x2a2622 },
      look: { body: 'lambert', belly: 'lambert', dark: 'lambert' },
      key: 'jerry_macaw_v1',
    }), { label: 'jerry' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "驯服"用"接触时随身携带杏仁水"近似"投喂"，不是真正的喂食互动；"向日葵种子"这一驯服物没有对应道具，
//   无法检测——见 apiRequests。
// - 教化受害者"数小时后进入杰瑞厅并与外界断联"：引擎里实体不能把目标换到别的层级（换层必须走层级出口，
//   硬规则②），也没有"延时后角色状态改变、断开联机"这类玩法系统，这条效果完全没做，只保留了接触瞬间的
//   理智冲击（attack.sanity，只在噩梦模式对玩家生效）。
// - "信众认为杰瑞比 Entity 33 更强大"：这是信众的主观评价，没有可执行的游戏规则，且 Entity 33 不在本批次，未实现。
// - "坐在杰瑞厅的栖木上接受信众朝拜"：本文件只实现"徘徊/悬停"的通用行为（A.flyer 没有目标时自动 wander/hover），
//   没有单独做"杰瑞厅"专属的栖木朝拜场景/信众 NPC——按硬规则，NPC 对话不做，M.E.G./据点类场景另外挂在别处。
