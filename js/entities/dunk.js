// 灌篮崽（亚种） Dunk / Dunk (sub-species)（Entity 12）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-12  许可：CC BY-SA 3.0
// lore-choices 里选中的是"Level 8 亚种"，但两版实体页 + Level 8 页都没给这个亚种自己的外形/颜色/行为——
// 只写了"巨臂林地里有一种灌篮崽的亚种"，没有更多细节（conflicts 里也确认 unverified）。
// 按 WAVE2.md 第 1 节"选中版本没写的细节不做、不许凭记忆/别的形态编造"，本文件只实现基础型灌篮崽的通用描述
// （颜色、行为、攻击、体型换算全部来自条目正文，不特定于任何一个命名变种）；
// 选中版本里另外列出的雪地/田野/岩石/街机/沙滩/游乐园等命名变种，颜色和第三代加速数字都各不相同，且没有任一处
// 说明 Level 8 亚种到底对应哪一种——为了不臆造归属，这里不采用任何命名变种的专属颜色/速度，只用基础型数据。
// 不采用 wikidot-en 的"PlayHouse Dunks 耐噪音"、Fandom 不存在该实体等其他版本细节。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'dunk', en: 'Dunk (sub-species)', zh: '灌篮崽（亚种）', version: 'wikidot-cn',
  faction: 'neutral',
  // 依据：hostility=varies；"野生：爱冒险、中立、回避人类""除非直接受到威胁，否则对其他实体漠不关心"
  // → 常态不主动伤人，按 varies 判断规则取 neutral

  hp: A.HP.weak,   // 依据："身体素质比多数实体弱，攻击容易被躲开"→ 不只是攻击弱，通篇给它的定位就是体质弱
  radius: 0.42, height: 0.78,
  // 依据：size "平均长 3.5 ft、宽 2.4 ft、高 2.5 ft"（3.5×0.3048=1.07m 长，2.4×0.3048=0.73m 宽，
  // 2.5×0.3048=0.76m 高）；radius 按宽度一半估算并留一点鼻子/角的余量，height 取原文高度
  speed: { walk: A.SPEED.crawl, run: A.SPEED.brisk },
  // 依据：speed "步行 2 mph、奔跑最高 5 mph"（基础型数字，不用任何命名变种的第三代加速数值）；
  // 2mph=0.894 m/s，最接近档位 crawl(0.6)；5mph=2.235 m/s，最接近档位 brisk(2.6)——按 WAVE2 代理任务要求，
  // 真实数值换算成最接近的档位而不是照搬原始 m/s，避免和游戏速度体系脱节
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 200 },
  // 依据：感官原文只写"鼻端有特殊感觉神经，对轻敲有反应"（触觉，非视听），常规视觉/听觉数据未提供 → 给默认值，非设定;
  // "似乎能以心灵感应理解命令"是驯服机制的一部分，不在感知字段体现（见下方 notImplemented）
  attack: { hp: A.DAMAGE.medium, sanity: 0, range: 1.1, cooldown: A.COOLDOWN.slow },
  // 依据："用鼻子抓住受害者拉近，用身体冲撞，再用锋利的角刺击"→ 抓+撞+刺的组合技，冷却给 slow；
  // "身体素质比多数实体弱，攻击容易躲开"→ 不给高伤害档，取 medium；
  // "若被压在身下可致死"没有对应的擒抱/压制机制，engine 没有这类状态，取通用命中伤害近似，见 notImplemented；
  // range 按鼻子(约人类手臂长)+身位估算，必须 ≥ radius
  // 没有嘴、没有消化系统 → 发不出声音，不写 sounds（含 idle/alert/attack 全部不写）

  brain: A.wanderer({ retaliate: 'fight', shyRadius: 6 }),
  // 依据：shyRadius 对应"回避人类"——玩家靠近就主动走开；"除非直接受到威胁，否则对其他实体漠不关心"→ 被攻击才反击(fight)

  anim: { gait: 'quad', stride: 0.9, strike: 'grab', recoil: 0.2, breathe: 0.02 },
  // 依据：短圆腿四足移动 → gait:'quad'；"用鼻子抓住受害者拉近"→ 复用内置 grab 抓取动作近似（身体冲撞+角刺没有单独动作，简化）

  build() {
    // 依据：appearance"矮胖的小象状生物，长鼻像人类手臂、末端为手形；头顶两根扭转的角；没有嘴、没有消化系统"
    // 颜色：appearance 明确写"颜色随变种"，但选中版本没定 Level 8 亚种是哪个命名变种，不能挑一个变种颜色顶上，
    // 取不对应任何命名变种的中性灰褐色，非设定
    const HEAD = 0.34;   // 与下面 headSize 保持一致；buildQuad 的 meta.dims 只给 headC（头部中心），没有单独的头部半径字段，这里自己留一份给 extend 用
    return A.wrap(A.parts.quadruped({
      length: 0.55, height: 0.28, girth: 0.34, thin: 0,   // 依据："矮胖"→ thin 取 0（不瘦），girth 给大；"短圆腿"→ height 矮
      legThick: 1.4, neckLen: 0.12, headSize: HEAD,        // 依据：短脖子+偏大的象型头
      snout: 0, jaw: false,                                 // 依据："没有嘴、没有消化系统"→ 不做口鼻/下颌
      ears: 0, tail: 0, mane: 0,                            // 选中版本未提，不加
      colors: { body: 0x7a7468, fur: 0x7a7468 },
      look: { body: 'skin' },
      extend(b, d) {
        // 长鼻：像人类手臂，末端为手形——用链式骨骼做一条能摆动的鼻子，末端叉开三根手指状小锥近似"手形"；
        // 方向以下垂为主、略带前伸，让鼻子看起来是从嘴部下方"垂下来"（更贴近描述里的长鼻观感）而不是甩到身体以外；
        // 长度没有直接照搬成人手臂的真实尺寸(~0.6米)——这只生物自身躯干才 0.55 米，直接套用真实臂长会显得比例失调、
        // 视觉上像凭空多出一截甩在身体外面，这里按"垂下来大致够到地面"定长度，是游戏性近似不是精确复刻
        const from = [0, d.headC[1] - HEAD * 0.25, d.headC[2] - HEAD * 0.55];
        const dir = [0, -1, -0.25], len = 0.4;
        const L = Math.hypot(dir[0], dir[1], dir[2]), ux = dir[0] / L, uy = dir[1] / L, uz = dir[2] / L;
        const tip = [from[0] + ux * len, from[1] + uy * len, from[2] + uz * len];
        const names = b.chain('trunk', 'head', from, dir, 3, len, HEAD * 0.16, HEAD * 0.05, 'body', 6);
        const tipBone = names[names.length - 1];
        for (const s of [-1, 0, 1]) {
          b.cone(tipBone, 'body', tip, [tip[0] + s * 0.045, tip[1] - 0.07, tip[2] - 0.03], 0.018, 4);
        }
        // 头顶两根扭转的角（CN 抽取称蛋白质构成，几何构件不支持螺旋，用左右倾斜的直锥近似"扭转"轮廓）
        for (const s of [-1, 1]) {
          b.cone('head', 'head', [s * HEAD * 0.35, d.headC[1] + HEAD * 0.55, d.headC[2]],
            [s * HEAD * 0.75, d.headC[1] + HEAD * 1.15, d.headC[2] + HEAD * 0.2], HEAD * 0.09, 5);
        }
      },
    }), { label: 'dunk' });
  },
});
})();
