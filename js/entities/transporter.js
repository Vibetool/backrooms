// 传送者 Transporter（Entity 13）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-13  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 注：wikidot-en 现行新版把它写成"安全的摆渡服务、无致死记录"，是玩家最熟悉的经典印象；选中的
// wikidot-cn（译自英文旧版）本身就写"切出对其他生物可能致命、死因不明"，敌意也更暧昧。下面完全按
// wikidot-cn 原文判断，不借用新版"绝对安全"的说法，这一判断依据见下方 faction 注释，并在返回值 notes 提醒。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'transporter', en: 'Transporter', zh: '传送者', version: 'wikidot-cn',
  // hostility = varies。按 _TEMPLATE.md 第 3 节的判断规则读选中版本 behavior 原文：
  // "以快速增加的速度接近引起它注意的流浪者"——不需要被激怒/攻击就会主动靠近陌生人，属于"看见人就……"
  // 这一档；"没有协议时投送到生存难度不超过 3 的随机层级"——未经同意也会强行带走，带有胁迫性质；
  // 同时 hostilityNote 里"同页旧版称切出可能致命"也支持不当它是纯粹无害的角色。综合取 hostile。
  // 下方 attack.hp 仍然给 0，不会对任何目标造成血量伤害——hostile 只是让引擎的主动索敌成立，
  // 用来驱动它"主动靠近陌生人、随后切出离场"这个行为，不代表它会真的打人。
  faction: A.faction('varies', 'hostile'),

  hp: A.HP.average,   // 选中版本没写自身耐久，人形默认值，非设定精确数字
  radius: 0.4, height: 1.9,
  // 依据："离地约 1.5 米飘浮"是飘浮高度（用 anim.fly.cruise 表现），没有给身体本身的尺寸；
  // height 按人形默认给，非设定精确数字
  speed: { walk: A.SPEED.slow, run: A.SPEED.sprint },
  // 依据："以快速增加的速度接近引起它注意的流浪者"——起步给慢速漂移（slow），锁定目标后给 sprint
  // （比人快、跑不掉），用下方 stalker 的 alert 停顿近似表现这个"从慢到快"的过程，不是逐帧连续加速，
  // 不是对原文数字的精确物理还原（原文本来就没有具体数字）
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.acute, fov: 150, needsLight: false, avoidsLight: false },
  // 依据："对声音敏感（噪音、说话、奔跑会引起注意）"→ hearing 取最高档 acute；sight 没有特别描述，给默认值
  attack: { hp: 0, sanity: 0, range: 1.8, cooldown: A.COOLDOWN.heavy },
  // 依据："没有主动攻击描述"——hp/sanity 都给 0，不造成实际伤害；这个字段只是用来让引擎的接近/接触判定
  // （reach、冷却、e.state 变成 'attack'）跑起来，下方 think 里靠 e.state==='attack' 识别"够到了"，
  // 不靠命中伤害触发（0 伤害会导致引擎认定"没打中"，见硬规则②的说明）；
  // range 参照"手臂长达 3 米"这种夸张的伸展能力给一个比常规长臂档位（1.3-1.6）更大的接触距离，
  // 但没有照抄 3 米——3 米会让它隔着半个房间就"摸到"目标，明显破坏游戏手感（硬规则①同理用在攻击距离上），
  // 取 1.8 作为游戏性折衷，非设定精确数字；cooldown 取最长档，呼应"运送一次要 3-5 分钟"这种慢节奏
  sounds: {},
  // 依据：没有描述任何声音——它靠"混合手语"交流，是视觉不是听觉；"切入墙体"这个动作用 noclip 音效表现，
  // 在下方 think 里用 A.cry 精确控制播放时机，不写进 sounds 字段

  brain: A.stalker({
    patrol: 'wander', patrolRadius: 22, patrolSpeed: A.SPEED.slow,
    alertSec: 1.3, searchSec: 12, investigate: true, searchSpeed: A.SPEED.walk,
    // 依据："漂浮时目光定格在环境里的某处"→ patrol 用 wander 表现漫无目的的漂浮；
    // alertSec 给一个短暂的"注意到你"停顿，配合上面 speed 注释里"从慢到快"的两段式近似；
    // investigate:true 对应"对声音敏感"（听见玩家会去查看，只在噩梦模式对玩家生效，见 _archetypes.js 的
    // 阵营规则；对测试人/友善实体则是下面 findTarget 的常规索敌，不需要 investigate）
  }),
  think(e, dt, api, brain) {
    const d = e.data.tr || (e.data.tr = { next: 0, departUntil: 0 });
    const now = api.time;
    if (now < d.departUntil) {
      // 依据："随后切入墙体进入未知层级，3-5 分钟后把流浪者投送到目的地"——引擎不能把目标换到别的层级
      // （换层必须走层级出口，硬规则②），这里只做视觉/音效近似：自己往反方向飘走几秒，代表"带人离场办事"，
      // 不改动目标（测试人/玩家）的任何数据，几秒后回来继续游荡，象征"办完事回来找下一个人"，
      // 不是真实的分钟级传送时长，非精确还原
      e.state = 'depart';
      const tx = e.x + Math.sin(d.awayYaw) * 5, tz = e.z + Math.cos(d.awayYaw) * 5;
      api.moveToward(e, tx, tz, A.speedOf(e, 'run'));
      return;
    }
    brain.think(e, dt, api);
    // 接管一次性的"够到了"判定：attack.hp=0 会导致 melee() 的命中永远算失败、onAttack 回调永远不触发
    // （damageEntity 对 0 伤害直接返回 false），所以不依赖 onAttack，改成直接看 stalker 是否已经把
    // e.state 打成 'attack'（够得着且不在冷却里就会进入这个状态）来触发上面的离场演出
    if (e.state === 'attack' && now >= d.next) {
      d.next = now + 6;
      d.departUntil = now + 2.2;
      d.awayYaw = api.rng() * Math.PI * 2;
      A.cry(e, 'noclip', { cooldown: 4 });
    }
  },
  anim: {
    gait: 'none', recoil: 0.15, fall: 'fade',
    // 依据：没有实质身体/行走描述，"飘浮移动"——不走标准步态，靠平移和 fly 的悬停表现；
    // fall 用 fade（没有"死亡"的具体描述，只有"切出可能致命、死因不明"这种含糊的说法，
    // 用渐隐代替倒地摔落，非精确还原）
    fly: { cruise: 1.5, bob: 0.05, bobHz: 0.9, bank: 0.05, ceiling: true, clearance: 0.3 },
    // 依据："离地约 1.5 米飘浮"——唯一给出的具体数字，直接用作悬停高度
  },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.9, thin: 0.55, hunch: 0, pose: 'upright', legLen: 0.35, armLen: 1.3, headSize: 0.95,
      // 依据：size 没给身高数字；armLen 适度放大表现"手臂长达 3 米"，但没有照搬 3 米——人形骨架只有
      // 上臂+前臂两段，legLen 又被压得很短（下面这条），两者叠加时 armLen 稍微给大一点手就会插进地面，
      // 试算后取 1.3（比常人略长，指尖接近垂到地面，呼应"长臂"这个特征），非精确数字，见 notImplemented；
      // legLen 给得很短——依据："无腿、无骨盆"，人形骨架结构上必须保留腿骨骼，这里用很短的腿把身体
      // 压低，靠下方 extend 里的大衣下摆盖住大部分腿部几何，做出"看不出腿"的视觉效果，见 notImplemented
      head: 'faceless', hands: true, feet: false, claws: 0, hair: 0, detail: 'high',
      // 依据：faceless——原文只说"唯一可见的器官是一只漆黑的独眼"，没有其他五官；
      // feet:false 配合"无腿"；detail:'high' 在高画质下给手指分节，近似"手指至少分七节"，非精确关节数复刻
      key: 'transporter_v1',
      colors: { body: 0x040404, head: 0x040404, hair: 0x2c2c2c, claw: 0xd8b23a },
      look: { body: 'basic', head: 'basic', hair: 'lambert', claw: 'lambert' },
      // 依据："皮肤吸光性极强，在明亮环境里也照不亮"——body/head 用不受光照影响的 basic 材质，
      // 颜色给接近纯黑，不会因为场景变亮而变亮；hair 槽位借来画唯一的独眼（比躯干浅一点，否则纯黑
      // 贴纯黑完全看不见，原文说它"唯一可见"，说明它确实和周围有可辨识的反差）；
      // claw 槽位借来画帽子上的黄黑方格布带（黄色部分，见下方 extend）
      extend(b, d) {
        // 唯一可见的独眼——依据："唯一可见的器官是一只漆黑的独眼"，只画一只，居中
        b.sphere('head', 'hair', d.headR * 0.16, [0, d.headY + d.headR * 0.04, -d.headR * 0.92], null, [8, 6]);

        // 黑色宽沿平顶帽：平顶帽冠 + 更宽的平边帽檐，颜色同大衣（都在 body 槽位）
        const hatY = d.headY + d.headR * 1.05;
        b.limb('head', 'body', [0, hatY, 0], [0, hatY + d.headR * 0.55, 0], d.headR * 1.08, d.headR * 0.98, 10);
        b.limb('head', 'body', [0, hatY, 0], [0, hatY + d.headR * 0.06, 0], d.headR * 1.85, d.headR * 1.85, 14);

        // 帽子中央的黄黑方格布带——只画黄色格子，黑色格子和帽身本来就同色，省一半的块
        for (let i = 0; i < 8; i += 2) {
          const ang = (i / 8) * Math.PI * 2;
          const cx = Math.sin(ang) * d.headR * 1.1, cz = -Math.cos(ang) * d.headR * 1.1;
          b.box('head', 'claw', [d.headR * 0.3, d.headR * 0.24, d.headR * 0.12], [cx, hatY + d.headR * 0.12, cz], [0, ang, 0]);
        }

        // 无腿无骨盆：胯部往下收成一段垂到地面的大衣下摆，尽量盖住被压得很短的腿部骨骼
        // （下摆按人形自身比例放宽到 2 倍胯宽，实测能包住大部分小腿几何，脚踝以下如果仍有一点探出
        // 属于程序化近似的取舍，非精确遮挡）
        b.cone('hips', 'body', [0, d.hipY, 0], [0, 0, 0], d.hipW * 2.0, 10);
      },
    }), { label: 'transporter' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "能自主增生额外的手臂与手指"：静态程序化骨架不能动态增删骨骼/肢体，未实现。
// - "手臂 4 个关节、手指至少分 7 节"：人形骨架只有肩+肘两段（1 个可动关节），手指细节靠 detail:'high'
//   的通用指节几何近似，不是精确的 4 关节/7 节复刻。
// - "尝试用混合手语交流，展示'出租车服务'牌子；点头/竖大拇指表示同意"：没有 NPC 对话/手势交互系统
//   （硬规则：NPC 对话不做），完全没有实现这套"协商"机制，也没有实现"有协议 vs 无协议"两种不同的
//   投送结果分支。
// - "3-5 分钟后把流浪者投送到目的地（无协议则投送到生存难度≤3 的随机层级）"：引擎里实体不能把目标换到
//   别的层级（硬规则②，换层必须走层级出口），完全没有实现真实的传送效果，只用上方 think 里的"自己飘开
//   几秒再回来"做象征性的离场表现，写进 apiRequests。
// - "缓慢安静地从背后远离可以避免被盯上""不要在它听力范围内说话/奔跑""黑暗里不要向它打光"：
//   前两条部分靠 perception.hearing + stalker 的 investigate 间接体现（噪音、跑动会被听到），
//   但没有"从背后接近更容易被发现""说话/奔跑之后额外增加危险"这类专门规则；
//   "打光"完全没做——引擎没有玩家手电这个道具/机制（硬规则②），写进 apiRequests。
// - "已有超过 20 名流浪者证实其存在""采访中它自称提供服务、被拒时表现失望"：这些是背景叙事和 NPC 对话，
//   没有对应的可执行游戏规则（硬规则：NPC 对话不做），未实现。
