// 毛绒恐龙 Plush Dinosaur（Entity 198）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-198  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 说明：sanityEffect/relations 两个字段里，wikidot-cn 的实体页原文明确写了"未描述"/没有这段内容，
// 调研时额外记了"中文站 Level 18 页面"的补充说法（会诱发情感、孩子们厌恶它、通常带食物水送人、
// 跟随可到达想去的层级）——这些仍然是 wikidot-cn 这一个 source 自己记录下来的补充材料，不是从
// fandom/wikidot-en 借的细节，可以用；但 sanityEffect 具体是"变好还是变坏"没有明确方向，按"没写清楚
// 的不编造具体数值"处理，不做专门的理智增减效果（见下方 notImplemented）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

const TOY_COLOR = 0x8fb9a0;    // 休眠时的玩偶颜色：appearance 原文没写颜色，取常见毛绒恐龙的浅绿色调，非设定
const ACTIVE_COLOR = 0xef9dc4; // 依据："活跃状态下纺织『皮肤』变成粉红色"
const EYE_COLOR = 0x2a2118;    // 依据：appearance 没写五官，只为满足"视觉要认得出"加最基础的深色纽扣眼，非设定

const LORE_HOUR = (BR.itemKit && BR.itemKit.LORE_HOUR) || 60;   // 设定 1 小时 = 游戏 60 秒（用户规则⑨换算约定）
const WAKE_SEC = 20;          // 依据："转换到活跃状态约需 20 秒"
const SENSE_RADIUS = 20;      // "陷入困境"的判定半径，原文没给具体范围/条件，见下方 think 注释，非设定
const TROUBLE_HP = 55;        // 玩家血量低于此视为"陷入困境"之一，原文没给数字阈值，非设定
const TROUBLE_SANITY = 50;    // 理智偏低也算"陷入困境"信号之一，原文没给数字阈值，非设定
const TROUBLE_HUNGER = 35;    // 饥饿偏低（快饿死）也算"陷入困境"信号之一，原文没给数字阈值，非设定
const TROUBLE_STUCK_SEC = LORE_HOUR;
// 兜底信号：验收指出游玩/测试模式下 hp、理智、饥饿多数时候都不会掉到上面几个阈值以下（游玩模式不打玩家、
// 环境伤害也只在噩梦模式生效），导致它按原判定条件几乎永远醒不过来。原文没给"困境"的完整判定条件，
// 补一条"在本层待够一个设定小时，也当作陷入困境"的兜底，保证正常游玩节奏里它终究会醒，不是真正的
// 全层级感知或"迷路"判定，只是一个时间上限的近似

// 判断"是否有人陷入困境"：原文只写"能感觉到 Level 18 里有人陷入困境"，没给可执行的具体判定条件。
// 取几个能落地验证的近似信号：①玩家血量偏低；②玩家理智偏低；③玩家饥饿偏低；④玩家附近出现有害实体
// （正被追猎/威胁）；⑤待够一个设定小时的兜底（见上方 TROUBLE_STUCK_SEC）。引擎没有"全层级感知"的接口
// （同 light_guide.js 的类似限制，见 apiRequests），这里按"玩家附近"判定，不是真正的全层级感知。
function playerInTrouble(api, P, sinceSeen) {
  if (sinceSeen >= TROUBLE_STUCK_SEC) return true;
  if (!P) return false;
  const ref = P.ref;
  if (ref) {
    if (typeof ref.hp === 'number' && ref.hp < TROUBLE_HP) return true;
    if (typeof ref.sanity === 'number' && ref.sanity < TROUBLE_SANITY) return true;
    if (typeof ref.hunger === 'number' && ref.hunger < TROUBLE_HUNGER) return true;
  }
  const list = api.list, R2 = SENSE_RADIUS * SENSE_RADIUS;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || o.dead || o.removed || !o.def || o.def.faction !== 'hostile') continue;
    const dx = o.x - P.x, dz = o.z - P.z;
    if (dx * dx + dz * dz <= R2) return true;
  }
  return false;
}

// 尾巴 + 圆润口鼻：appearance 没写恐龙具体长什么样（只说"像一只毛绒恐龙玩偶"），
// 加这两个部件纯粹是为了让轮廓能被认成"恐龙"而不是普通人形（第⑤条硬性要求），非设定精确形状
function addDinoBits(b, d, active) {
  // 模型按 _archetypes.js 的约定面朝 -Z，尾巴要长在背后：起点和延伸方向都要用 +Z。
  // 之前写成 -Z（和口鼻同一侧），导致尾巴从两腿之间往前戳出来，验收截图确认过这个问题
  b.chain('tail', 'hips', [0, d.hipY + 0.02 * d.H, d.headR * 0.8], [0, -0.15, 1], 3, d.H * 0.34, d.headR * 0.55, d.headR * 0.12, 'body');
  // 圆润口鼻保持 -Z（正面），没有问题
  b.sphere('head', 'body', d.headR * 0.55, [0, d.headY - d.headR * 0.15, -d.headR * 0.95], [1.25, 0.7, 1], [8, 6]);
  if (!active) {
    // 休眠态额外叠一颗球盖住 humanoid 骨架自带的躯干分段（腰部收窄 + 胸腔鼓起两段 + 肩颈关节球），
    // 蜷起来后原本那套分段轮廓会显得像分节人偶而不是毛绒玩具；appearance 原文没写具体体型，这颗覆盖球
    // 的大小纯粹是"看起来圆鼓鼓像毛绒玩具"的取舍，非设定精确数字。
    // 第一版半径给到 d.H*0.4（约头部半径的 4 倍），验收截图发现整只模型被这一颗球完全吞掉，变成一颗
    // 光秃秃的蛋形，头、口鼻、尾巴全部看不见，比"分节人偶"更认不出是恐龙——缩到和头部同量级
    // （headR*1.4），只够盖住肩/胸分段，头顶得出来、尾巴露在外面
    b.sphere('spine', 'body', d.headR * 1.4, [0, d.hipY + d.H * 0.05, d.headR * 0.05], [1.15, 0.9, 1.05], [10, 8]);
  }
}

function buildForm(active, color, key) {
  // 两个形态都用 pose:'upright'（这套骨架的 pose:'crawl' 在 0.62 m 这么矮的身高下经验证会让模型悬空，
  // 见预览截图排查记录；upright 在各文件里都验证过贴地）。休眠态靠极短的 legLen（几乎没有腿）+ 大 hunch
  // （整只蜷起来）表现"玩偶，还没长腿"；活跃态给正常腿长、hunch 归零，表现"长出一双腿站起来走"
  return A.parts.humanoid({
    height: 0.62, thin: active ? 0.05 : 0, bulk: active ? 1.15 : 1.75,
    pose: 'upright', hunch: active ? 0 : 0.68,
    // 依据：size unverified，取"地面小伙伴"的玩偶尺寸，非设定；休眠态 bulk 明显加大、hunch 加深——
    // 验收截图指出原参数蜷起来后像分节人偶而不是圆鼓鼓的毛绒玩具，这里加大蓬松感、加深蜷缩幅度
    headSize: active ? 1 : 1.5, shoulders: active ? 1 : 0.6, neck: active ? 1 : 0.3,
    // 依据：appearance 没写头身比例——休眠态头做大、肩变窄、脖子缩短，让 humanoid 骨架自带的分段躯干
    // 轮廓尽量被大头和短脖子盖住，更贴近毛绒玩偶常见的"大头小身子"比例，非设定精确数字
    head: 'round', armLen: 0.7, legLen: active ? 0.85 : 0.05, hands: false, feet: active, claws: 0, hair: 0,
    // 依据：appearance"活跃状态下……长出一双……腿"——休眠态 legLen 给到近乎 0（还没长腿），活跃态正常腿长；
    // 没写手脚细节，关掉爪子/毛发；休眠态没有腿，脚掌几何也一并关掉
    face: { eyes: 2, eyeShape: 'round', smile: false, teeth: 0 },
    colors: { body: color, glow: EYE_COLOR },
    look: { body: 'cloth' },
    // 依据："纺织『皮肤』" → 用 cloth 程序化材质表现布料质感
    mats: { glow: A.mat.lambert(EYE_COLOR) },
    // 依据：appearance 没提发光，纽扣眼用不发光材质，而不是 glowFace 默认的自发光材质
    key,
    extend: (b, d) => addDinoBits(b, d, active),
  });
}

A.register({
  type: 'plush_dino', en: 'Plush Dinosaur', zh: '毛绒恐龙', version: 'wikidot-cn',
  faction: 'friendly',   // 依据：hostility = friendly；attack 段"无（未描述攻击）"

  hp: A.HP.average,      // 依据：size/耐久 unverified，没有"杀不死"之类的描述，取中档默认值，非设定
  radius: 0.28, height: 0.62,
  // 依据：外形是"玩偶"，按地面小型伙伴给碰撞体积，非设定精确数字

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据："能感觉到 Level 18 里有人陷入困境"——不需要面朝目标才能察觉，给 360 视野；
  // 感官细节 unverified，sight/hearing 取默认档

  // 没有 attack 字段：选中版本明确"无（未描述攻击）"，也不会主动伤人

  brain: A.guide({
    followDist: 2.2, leadDist: 3.5, waitDist: 8, noticeDist: 40, leash: 20,
    engage: false, leadTo: null, idle: 'orbit',
  }),
  // 依据："找到后帮助并引导他们"→ 用向导骨架；engage:false 对应"无描述攻击"（不参战）；
  // leadTo:null——原文没写它带人去补给点还是去出口/安全处，不编造具体目标，只做"陪着走、带路"的
  // 基础向导行为；idle:'orbit' 对应"轻快漫步"，无事可做时绕着玩家小步游荡而不是呆立

  think(e, dt, api, brain) {
    const d = e.data.dino || (e.data.dino = { phase: 'dormant', wakeUntil: 0, firstSeen: null });
    // 依据："通常处于休眠状态……感觉到有人陷入困境时进入活跃状态（约 20 秒）"——三段式状态机：
    // 休眠（原地不动，对任何动作都没有反应）→ 转换中（原地播放"长腿"动画，20 秒）→ 活跃（向导骨架接管）
    if (d.phase === 'dormant') {
      e.state = 'dormant';
      if (d.firstSeen == null) d.firstSeen = api.time;   // 记录本只从休眠开始经过的时间，供兜底判定用
      const P = A.nearestPlayer(e);
      if (playerInTrouble(api, P, api.time - d.firstSeen)) { d.phase = 'waking'; d.wakeUntil = api.time + WAKE_SEC; }
      return;   // 依据："休眠时对任何动作都没有反应"——休眠阶段完全不调用 brain.think，原地静止
    }
    if (d.phase === 'waking') {
      e.state = 'waking';
      if (api.time >= d.wakeUntil) d.phase = 'active';
      return;   // 转换期间原地不动，20 秒后才真正开始寻人带路
    }
    brain.think(e, dt, api);
  },

  anim: {
    gait: 'biped', stride: 0.55, breathe: 0.03, twitch: 0,
    formOf(state) { return (state === 'dormant' || state === 'waking') ? state : 'active'; },
    // 依据：休眠/转换两个状态各自对应专属模型（无腿蜷缩 / 已长腿站立），guide 骨架自己产生的其余
    // 状态名（idle/wander/follow/lead/wait...）统一用"active"（已长腿的站立形态）
    onFrame(e, dt, api, u) {
      if (e.state === 'waking' && u.pivot) {
        // 依据："转换到活跃状态约需 20 秒"——用轻微的整体缩放起伏表现"正在长腿/变身"的过渡感；
        // 只读 api.time（不读 e.data），客机上也能同步播出同样的效果
        u.pivot.scale.setScalar(1 + 0.05 * Math.sin(api.time * 6));
        return;
      }
      if ((e.state === 'idle' || e.state === 'wait') && u.rig) {
        // 依据："有时会乞求别人拥抱它"——原地等待/无事可做时，周期性举起双臂讨抱抱；
        // 具体触发节奏原文没给，用固定周期近似，非设定精确数字
        const cyc = api.time % 6;
        if (cyc < 0.9) {
          const k = Math.sin(cyc / 0.9 * Math.PI);
          A.anim.addRot(u.rig, 'armL', 0, 0, -1.6 * k);
          A.anim.addRot(u.rig, 'armR', 0, 0, 1.6 * k);
        }
      }
    },
  },

  build() {
    return A.wrap({
      dormant: buildForm(false, TOY_COLOR, 'plush_dino_dormant_v2'),
      active: buildForm(true, ACTIVE_COLOR, 'plush_dino_active_v2'),
    }, { form: 'dormant', label: 'plush_dino', budget: 4000 });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "能感觉到 Level 18 里（全层级）有人陷入困境"：引擎没有全层级感知接口（同 light_guide.js 的
//   同类限制），用"玩家附近 20 m 内是否有有害实体 / 玩家血量-理智-饥饿是否偏低 / 待够一个设定小时的
//   兜底"近似判定，不是真正的全层级感知，写进 apiRequests。
// - "给食物会吃"：引擎没有向实体投喂物品的交互接口，不实现，写进 apiRequests。
// - "跟随一段时间可到达想去的层级"（带玩家去它们自己想去的层级/出口）：leadTo 只支持"最近补给"或
//   自定义坐标函数，没有"读取玩家目标层级"这个信息源，不编造具体去向，只做基础的陪伴/带路。
// - "孩子们（The Children）厌恶它"：这批任务范围内没有对应的"孩子们"实体类型可供关联，不实现双方互动。
// - sanityEffect 里"能诱发情感"的具体方向和数值：原文没写清楚是安抚还是扰乱理智，不编造具体效果，
//   只保留引擎对所有 friendly 实体统一生效的靠近回复理智效果（player.js FRIENDLY_REGEN，非本文件实现）。
