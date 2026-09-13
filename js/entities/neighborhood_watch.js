// 邻里守望 The Neighborhood Watch（Entity 96：守望者 Watcher / 挺进者 Strider / 水泳者 Swimmer）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-96  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）。
// 三种形态外观、攻击方式都不同，按 _TEMPLATE.md 第 1 节拆成三个 type：
//   neighborhood_watch_watcher / neighborhood_watch_strider / neighborhood_watch_swimmer
// 用户备注（例外提醒）：这是本批里社区比较有名的实体；选中版本（wikidot-en Entity 96）的三形态设定——
// 都源自"眼球状结构"、Watcher 悬浮放光束秒杀且常规武器无效、Strider 六肢快速抓人摔死、Swimmer 缠溺
// 猎物——和社区里常见的认知基本一致，没发现选中版本与"经典形象"明显冲突的地方，因此按原样实现，
// 不换版本（这条也写进了返回值 notes）。
// 三种形态选中版本都没写叫声/音效（"Watcher 无声滑翔；页面没描述三类的叫声"），三个 type 都不加 sounds。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 三种形态共用的"眼球主体 + 辐射状附肢"构件：中心一颗大眼球（core），周围伸出 count 条附肢/血管/触手，
// 正前方贴一片暗色虹膜和一颗发光瞳孔（依据：三者都是"眼球结构"，只有 Watcher 明确写了瞳孔会放光束，
// 但共享同一套眼球构造是这个实体家族的共同标志；Strider/Swimmer 的瞳孔只是安静地带一点自发光，
// 不会真的射光——只有 Watcher 的 anim 里播放光束特效）。
// 附肢数量/长度/粗细精确对应各形态描述；颜色三者都 unverified，非设定。
function buildEyeBody(cfg) {
  return A.parts.limbCluster({
    key: cfg.key,
    count: cfg.count, segments: cfg.segments, length: cfg.legLen, radius: cfg.legRadius, tip: cfg.legTip,
    spread: cfg.spread, center: [0, cfg.coreR, 0], core: cfg.coreR,
    colors: { body: cfg.bodyColor, glow: cfg.glowColor },
    look: { body: 'skin' },
    extend(b) {
      const r = cfg.coreR;
      b.sphere('core', 'body', r * 0.6, [0, cfg.coreR, -r * 0.85], [1, 1, 0.4], [10, 8]);   // 虹膜：压扁贴在眼球前表面的暗色盘
      b.sphere('core', 'glow', r * 0.22, [0, cfg.coreR, -r * 1.02], [1, 1, 0.5], [8, 6]);   // 瞳孔：glow 槽位，自带一点自发光
    },
  });
}

// Watcher 的光束：从瞳孔位置沿本地 -Z 延伸的发光锥体，只在 attack 状态显示；模块级只建一次几何，
// 全部 Watcher 实例共享（性能规则：不在 build 里为每个实例 new 独立几何/材质）
const WATCHER_BEAM_GEO = (function () {
  const g = new THREE.ConeGeometry(0.5, 6, 12, 1, true);   // 默认沿 Y 轴，apex 在 +Y 一端
  g.translate(0, -3, 0);   // apex 移到局部原点 (0,0,0)，底面在 (0,-6,0)
  g.rotateX(Math.PI / 2);  // 把 -Y 方向转成 -Z 方向：apex 仍在原点，锥体朝 -Z 展开
  return g;
})();

const WATCHER_CORE_R = 0.85;

A.register({
  type: 'neighborhood_watch_watcher', en: 'Neighborhood Watch: Watcher', zh: '邻里守望：守望者', version: 'wikidot-en',
  faction: 'hostile',
  // 依据：整篇 hostility = hostile（"中等智力，主动猎杀活物"），Watcher 只是三种形态之一，不单独判定

  hp: A.HP.titan,
  // 依据："表面非常坚韧，常规武器无效，没有被人造工具或武器摧毁的记录"——按几乎打不烂取高档；
  // 原文没有明确说"不可能杀死"，所以不用 immortal，取次高档 titan

  radius: WATCHER_CORE_R, height: WATCHER_CORE_R * 2,
  // 依据：size 给了"约汽车大小"，没给精确数字；取车宽量级（直径≈1.7m）换算成半径/身高，非设定

  speed: { walk: A.SPEED.walk, run: A.SPEED.walk },
  // 依据：locomotion 明确写"步行速度"，是定性描述不是数字，直接取 walk 档，不拔高

  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.deaf, fov: 360 },
  // 依据："视觉敏锐，没有听觉和嗅觉"；fov 给 360——巨大眼球状结构没有明确的正面朝向

  attack: { hp: A.DAMAGE.lethal, sanity: 0, range: 8, cooldown: A.COOLDOWN.slow },
  // 依据：光束"被光完全照到的活物瞬间化为细细的灰色粉尘"——一击必死取 lethal；理智影响原文没写，
  // 不填 sanity；range 用来近似"瞳孔远程光束"这种引擎没有的远程/范围攻击（见 apiRequests），
  // cooldown 取慢档表现光束扫视/蓄力的间隔，原文没给具体数字，非设定

  brain: A.stalker({ patrol: 'wander', patrolRadius: 18, patrolSpeed: A.SPEED.walk, chaseSpeed: A.SPEED.walk, alertSec: 1.0, searchSec: 8 }),
  // 依据："中等智力，主动猎杀活物……会追踪流浪者"；因为攻击靠远距离光束，range 已经很大，
  // 不需要真正贴身也能触发攻击

  anim: {
    gait: 'none', breathe: 0.02, sway: 0.15, swaySpeed: 0.8,
    fly: { cruise: 1.7, low: 1.3, rest: 0.9, bob: 0.1, bobHz: 0.35, bank: 0.03, ceiling: true, clearance: 0.3 },
    // 依据："在郊区上空无声滑翔/悬浮"——用 fly 表现常年悬在半空，没写具体高度，非设定；取比人略高的
    // 悬浮高度而不是拉到很高，是因为室内测试房间天花板普遍较低，飞太高会穿出天花板挡板、整只从画面里
    // 消失（实测发现的问题，见 apiRequests）；真正的郊区露天场景由层级文件决定，那边空间够高时看起来
    // 会更贴近"半空悬浮"，这里只保证在普通室内房间里也能稳定看见它
    strike: 'none', recoil: 0.1, fall: 'drop',
    onFrame(e, dt, api, u) {
      if (!u.pivot) return;
      if (u._beam === undefined) u._beam = u.pivot.getObjectByName('nwWatcherBeam') || null;
      if (!u._beam) return;
      const attacking = e.state === 'attack' && !e.dead;
      u._beam.visible = attacking;
      if (attacking) { const k = 0.85 + Math.sin(api.time * 14) * 0.15; u._beam.scale.set(k, 1, k); }
      // 依据："瞳孔会射出光束"——攻击时显示一条从瞳孔沿 -Z 延伸的发光锥体，加一点高频缩放表现光束的
      // 能量闪烁；原文没写光束粗细/是否闪烁，这属于表现层面的合理演绎，不是编造设定
    },
  },

  build(ctx) {
    const group = new THREE.Group();
    group.add(buildEyeBody({
      key: 'nw_watcher_v1', coreR: WATCHER_CORE_R, count: 10, segments: 2, legLen: 0.3, legRadius: 0.05, legTip: 0.015,
      spread: 1, bodyColor: 0xcac7bd, glowColor: 0xffffff,
    }));
    // 依据：表面"突出多条视神经/眼静脉"——用短小的辐射状肢体（limbCluster）表现血管/神经贴着球面
    // 凸起，不是真正能动的肢体；体表颜色原文没写，取不刺眼的灰白色（巩膜常见色调），非设定
    const beam = new THREE.Mesh(WATCHER_BEAM_GEO, A.mat.glow(0xffffff));
    beam.name = 'nwWatcherBeam';
    beam.visible = false;
    beam.position.set(0, WATCHER_CORE_R, -WATCHER_CORE_R * 1.02);
    group.add(beam);
    return A.wrap(group, { label: 'neighborhood_watch_watcher' });
  },
});

A.register({
  type: 'neighborhood_watch_strider', en: 'Neighborhood Watch: Strider', zh: '邻里守望：挺进者', version: 'wikidot-en',
  faction: 'hostile',
  // 依据：与 Watcher 共享同一个 hostility = hostile

  hp: A.HP.tough,
  // 依据："主体抗性较低"（相对 Watcher 的常规武器无效），但仍是能被远程武器杀死的实体，取比 Watcher 低一档

  radius: 0.4, height: 0.8,
  // 依据：主体眼球尺寸原文未写，取比 Watcher 小的中型体型，非设定；height 按核心球体直径估算

  speed: { walk: A.SPEED.jog, run: A.SPEED.sprint },
  // 依据：巡游速度原文没写，取中等 jog；"最高 90 mph（≈145 km/h）"——原文给了具体极端数字，按数值
  // 推导规则①换算成最接近的档位而不是原样使用（145 km/h 一帧能穿好几米、直接穿模，上一批就吃过这个亏），
  // 取"比人快、几乎跑不掉"的 sprint 档，对应原文"跑不过"的语气

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 300 },
  // 依据：Strider 感官原文 unverified，取默认档；fov 给较宽的 300——辐射状肢体主体没有明确正脸方向

  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 2.0, cooldown: A.COOLDOWN.fast },
  // 依据："用附肢抓住猎物，反复砸向物体表面直到死亡"——多次重击取 severe + fast 冷却而不是一击必杀；
  // range 用附肢的部分伸展距离近似（原文单条附肢全长 8 英尺≈2.44m，攻击判定给更保守的有效范围）

  brain: A.stalker({ patrol: 'wander', patrolRadius: 20, patrolSpeed: A.SPEED.jog, chaseSpeed: A.SPEED.sprint, alertSec: 0.4, searchSec: 8 }),
  // 依据："主动猎杀活物，会追踪流浪者"

  anim: {
    gait: 'none', breathe: 0, sway: 0.4, swaySpeed: 2.6, twitch: 0.1,
    strike: 'grab', recoil: 0.2, fall: 'crumple',
    // 依据：六条附肢没有对应的四足/两足步态，用较快的摆动表现"体型虽大却非常灵活"地挪动；
    // 攻击用 grab（抓取）对应"用附肢抓住猎物"；死亡用 crumple（蜷缩）而不是仰面倒地，更像多足生物瘫软
  },

  build(ctx) {
    return A.wrap(buildEyeBody({
      key: 'nw_strider_v1', coreR: 0.4, count: 6, segments: 4, legLen: 2.44, legRadius: 0.06, legTip: 0.02,
      spread: 0.9, bodyColor: 0x8a6a62, glowColor: 0xffffff,
    }), { label: 'neighborhood_watch_strider' });
    // 依据：六条附肢——数量精确对应"六条附肢"；每条 2.44m（8 英尺原文数字直接换算成米，不用速度档位，
    // 因为这是明确给出的实际长度，不是需要"就近取档"的速度类数值）；附肢"由脉络膜、神经和血管构成"，
    // 取偏红棕的血管组织色调，颜色本身 unverified，非设定；limbCluster 是辐射状触手设计，做不出"六足
    // 弯折站立支撑在地面"的姿态，这里退而求其次做成从眼球主体向外辐射的长附肢轮廓，没有真正落地支撑的
    // 腿部站姿，见 notes
  },
});

A.register({
  type: 'neighborhood_watch_swimmer', en: 'Neighborhood Watch: Swimmer', zh: '邻里守望：水泳者', version: 'wikidot-en',
  faction: 'hostile',
  // 依据：同属 hostility = hostile

  hp: A.HP.average,
  // 依据：原文没直接写它的抗性，但"会被 Level 9 的其他实体捕食"暗示它是三者里最弱的一种，取中档

  radius: 0.32, height: 0.65,
  // 依据："狗那么大"——按中型犬的体型量级给碰撞体积，非设定精确数字

  speed: { walk: A.SPEED.crawl, run: A.SPEED.slow },
  // 依据："上岸只能缓慢爬行"——陆地移动明确是慢速，取最低几档；水中速度原文没量化，不夸大；
  // 引擎没有水体/游泳系统，实际效果只会体现成陆地慢速游走，见 apiRequests

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 300 },
  // 依据：感官 unverified，取默认值；fov 同 Strider 的理由

  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 1.1, cooldown: A.COOLDOWN.slow },
  // 依据："以极大力气缠住受害者试图溺死；若淹不死就撕掉暴露的肢体"——引擎没有溺水/致残状态效果，
  // 近似成持续的重击伤害，冷却取慢档表现"缠住+挣扎"这个较长的动作过程，见 apiRequests

  brain: A.stalker({ patrol: 'wander', patrolRadius: 14, patrolSpeed: A.SPEED.crawl, chaseSpeed: A.SPEED.slow, alertSec: 0.5, searchSec: 6 }),
  // 依据：同属"主动猎杀活物、追踪流浪者"这条家族通用描述

  anim: {
    gait: 'none', breathe: 0, sway: 0.3, swaySpeed: 1.3, twitch: 0,
    strike: 'grab', recoil: 0.2, fall: 'crumple',
    // 依据：八条视神经"像章鱼腕一样"排布，用摆动表现腕足式蠕动；grab 对应"缠住"这个攻击方式
  },

  build(ctx) {
    return A.wrap(buildEyeBody({
      key: 'nw_swimmer_v1', coreR: 0.32, count: 8, segments: 4, legLen: 0.55, legRadius: 0.045, legTip: 0.012,
      spread: 1, bodyColor: 0x5d6a6c, glowColor: 0xffffff,
    }), { label: 'neighborhood_watch_swimmer' });
    // 依据：八条视神经——数量对应"八条"；"像章鱼腕一样排布"用 limbCluster 的辐射状触手正合适；
    // 体型按"狗那么大"取比 Strider 主体更小的核心球；颜色 unverified，取偏水色的灰蓝调，非设定
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "每 1 个 Watcher 附近约 3 个 Strider"、"Strider/Swimmer 常三只一组"：是密度/分布，由层级文件的生成器
//   决定，不属于实体文件范围。
// - Strider 抓到猎物后"吊在 Watcher 眼前展示、由 Watcher 接手"：需要跨实体状态传递/协同调度，超出单个
//   实体 think 的范围，未实现。
// - "死亡飞蛾/笑魇/窃皮者/猎犬都怕它们"：需要在那几个实体自己的文件里加规避 canTarget，属于别的实体
//   文件的改动范围，本文件不能碰，写入 apiRequests。
// - 靠近损坏电子设备、携带 Pockets 会立刻暴露位置、被取回放原处：依赖道具/物品系统，不在实体范围内，未实现。
// - Strider "开枪/用火盐会引来其他实体"：这是玩家武器系统的副作用，游戏目前没有近战以外的武器系统，未实现。
// - Swimmer 真正的水体/游泳（钻狭窄管道、水中比陆地快）：引擎没有水体或游泳机制，只实现了陆地缓慢
//   爬行部分，见 apiRequests。
// - 六足/八腕没有专属的行走/游泳步态：limbCluster 构件是辐射状触手设计，不支持"落地弯折支撑行走"的
//   姿态和步态循环，移动时只有摆动动画，没有真正的迈步/划水动作，属于构件能力限制下的近似。
// - Watcher 的 anim.fly 天花板检测（BR.phys.raycast）在本机测试用的通用室内房间里没能把它稳稳挡在
//   吊顶以下——实测把 cruise 设到 3.2m 时它会飞进天花板消失不见，只好把常驻悬浮高度调低到 1.7m 这个
//   在普通房间里都安全的数值；真正露天/挑高场景（层级文件负责）会让它显得没那么"贴着地飞"，这是为了
//   保证在任意房间高度下都能稳定可见做的取舍，写入 apiRequests（希望天花板检测对生成式房间更可靠）。
