// 小小 Tiny（Entity 720）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/trimmed:entity-720  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 备注：候选来源还有 fandom，但该来源没有 Tiny 词条（loaded:false），已排除，不构成"冲突随机选版本"。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 选中版本没给"势力范围"的具体半径数字，用这个值近似两件事：
// 1) "无法在陆地上行走"——离出生点（其领地中心）太远就当作已经游出水域/上了岸，放弃追击；
// 2) relations 提到"与 Entity 20 划分领地、这是两者的契约"——巡逻圈也定在领地中心附近，而不是漫游全图。
const TERRITORY_R = 22;

// 与 build() 的 colors.glow 保持同一个值：眼睛（和焦土荧光斑点共用的 glow 槽位）随光照调亮度时用它做基色，
// 不在两处各写一遍，免得以后改荧光色时漏改一处、眼睛变了别的颜色
const GLOW_HEX = 0x35d9c4;

A.register({
  type: 'tiny', en: 'Tiny', zh: '小小', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility 字段直接给了 hostile

  hp: A.HP.immortal,
  // 依据：weaknesses 原文"尚未找到任何能伤到他的攻击方式"——已知没有任何手段能伤到它，
  // 对应 _TEMPLATE.md 数值表"杀不死/不可能杀死 → immortal"这一档

  radius: 0.45, height: 2.44,
  // height 依据 size"身高 244 厘米"直接换算；radius 选中版本未给体宽数字，按人形常见比例给，非设定

  speed: { walk: A.SPEED.brisk, run: A.SPEED.sprint },
  // walk：选中版本只给了"最高游速"，没给平时巡游速度，取非设定的中等档位 brisk；
  // run：原文"游速最高 80 英里/小时"（≈36 m/s）说的是在水里游的速度；引擎没有水体，实体在地面上移动，照搬这个数会一帧穿过好几米、
  //   直接穿墙，所以取持续速度的最高档 sprint（比人快、跑不掉，只能躲），表达"水里根本甩不掉它"的威胁。等引擎有水域查询后可按水中/岸上分开设

  perception: { sight: A.SIGHT.hawk, hearing: A.HEARING.normal, fov: 360 },
  // sight：依据 senses"感知距离推测至少在 30 千米以上"——原文数字远超关卡尺度（且原文本身写"推测"，
  // 不是确凿数字），取感知表最高档 hawk 表示"在关卡范围内基本无死角"，不字面套用 30000 米；
  // hearing：选中版本未写听觉，非设定默认值；
  // fov：依据"能从远处侦测水面活动"——这不是靠两只眼睛的视线锥，是某种超出常规视觉的感知方式，取 360 全向

  attack: { hp: A.DAMAGE.severe, range: 1.5, cooldown: A.COOLDOWN.normal },
  // hp：依据 attack 原文"高度致命"——对应数值表"高致死 → severe"；
  // range：长矛攻击，比空手够得远，取"长臂"档区间 1.5；
  // cooldown：选中版本没写出手节奏，取默认档 normal，非设定精确值

  sounds: { idle: 'whisper', alert: 'growl', attack: 'hit' },
  // idle：依据 behavior"高度智能，通过某种心灵感应方式对话"——用音效表里最接近的 whisper 表现这种不安的低语，
  // 不做文字对话（用户规则：NPC 对话不做）；
  // alert：依据"充满敌意，性格极端傲慢自信，对恶意完全不加掩饰"——发现目标就是毫不遮掩的威胁咆哮，取 growl（roar 别名）；
  // attack：出手用引擎默认的 hit

  brain: A.stalker({
    patrol: 'home', patrolRadius: TERRITORY_R,
    alertSec: 0.15,   // 依据："性格极端傲慢自信，对恶意完全不加掩饰"——发现即扑，几乎不迟疑
    searchSec: 12,    // 依据："高度智能"——搜寻更执着，非设定精确秒数
    investigate: true, // 依据："能从远处侦测水面活动"——主动查看动静
    smell: false,      // 选中版本只写了视觉/感知距离，没有嗅觉描述
    canTarget(e, t, api) {
      // 依据 relations："与 Entity 20（七层之物）是深海竞争对手……双方约定划分领地……他称这是两者的契约"
      // ——互不侵犯，不把对方当目标（不改 faction，只在这里过滤，见 _TEMPLATE.md 第 3 节最后一条）
      if (t.kind === 'entity' && t.ref && t.ref.type === 'thing_on_level_7') return false;
      // 依据 weaknesses："无法在陆地上行走""流浪者可以离开水面到安全处"——引擎没有水域/陆地的地形查询接口
      // （见 apiRequests），用离开领地范围近似"游出了它能到达的水域"，不再理会
      const hx = e.data.homeX, hz = e.data.homeZ;
      if (hx == null) return true;
      const dx = t.x - hx, dz = t.z - hz;
      return dx * dx + dz * dz <= TERRITORY_R * TERRITORY_R;
    },
  }),

  init(e, api) {
    // 领地中心 = 出生点（层级文件负责把它放在版本描述的"主要领地"——石柱环附近），供上面 canTarget 使用
    e.data.homeX = e.x;
    e.data.homeZ = e.z;
  },

  anim: {
    gait: 'biped', stride: 1.9, breathe: 0.02, twitch: 0, strike: 'lunge', recoil: 0.22, fall: 'back',
    // strike:'lunge' 对应长矛突刺攻击；其余选中版本未写姿态细节的项取默认值，非设定
    stateSounds: { chase: 'growl' },
    onFrame(e, dt, api, u) {
      if (!u.rig || !u.rig.bones.jaw) return;
      // 依据："脸上盖着坚硬甲壳，只露出两只眼睛……甲壳打开会露出尖牙密布的巨大嘴巴"
      // 平时嘴巴收在下巴内侧（build 里 setBase 的收拢角度），只在攻击状态下转出张开，呼应"甲壳打开"这一动作
      const open = e.state === 'attack' ? 1.4 : 0;
      A.anim.addRot(u.rig, 'jaw', open, 0, 0);

      // 依据（wikidot-cn）："眼睛亮度随光照变化，浮出水面时暗淡无光"——眼睛和焦土荧光斑点、獠牙共用同一个
      // glow 槽位（没有单独的眼部插槽，见 build() 里 face/extend 的注释），用 u.slotMat 懒克隆这一只专用的材质，
      // 按当前位置的 api.lightAt 调整整体亮度：暗处（浮出水面前，在深水/暗层里）更亮，亮处（浮出水面）暗淡下来。
      // 系数是非设定的游戏性取值，只保证方向对（暗处更亮），不追求精确数值；远处/低画质时 slotMat 会自动
      // 换回只读的共享材质，写入静默作废，不用额外判断
      const gm = u.slotMat('glow');
      if (gm) gm.color.setHex(GLOW_HEX).multiplyScalar(1.5 - api.lightAt(e.x, e.z));
    },
  },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 2.44, head: 'faceless', hands: true, claws: 3, hair: 0,
      // head:'faceless' 给一个光滑蛋形做"甲壳"底子（look.head 用 chitin 质感覆盖），
      // 而不是普通圆脸——依据"脸上盖着坚硬甲壳"，不是一张露在外面的脸；
      // claws:3——依据"有利爪"，没写具体数量，取默认小数值，非设定
      face: { eyes: 2, eyeShape: 'round', smile: false },
      // 依据："只露出两只眼睛"——用 humanoid 内置 face 只加两只眼睛，不带嘴（嘴巴另见下方 extend 的 jaw）
      colors: { body: 0x141210, head: 0x1c1a17, claw: 0xcac2ab, glow: GLOW_HEX },
      // body：依据"身体大部分包着一层厚焦油"——焦黑色；head：坚硬甲壳，比身体更冷硬深灰；
      // claw：矛/爪推测是"巨大生物的牙齿/骨头"材质——取骨牙的浅米色；
      // glow：荧光斑点"颜色未写（unverified）"，取深海生物常见的青绿色荧光，非设定
      look: { body: 'skin', head: 'chitin', claw: 'chitin' },
      // body：依据"皮肤有橡胶质感但无比坚韧"——用 skin 纹理表现橡胶质感的斑驳；
      // head/claw：依据"坚硬甲壳"和"利爪"都是硬质角质，用 chitin 材质
      key: 'tiny_v1',
      extend(b, d) {
        // 焦土下的荧光斑点——依据："焦土下有散发生物荧光的斑点，看起来有点像两栖动物"；
        // 数量、位置选中版本未给，散布在躯干几处示意，非设定精确坐标
        const spots = [
          [0.14, d.shoulderY * 0.55, d.headR * 0.75],
          [-0.16, d.hipY * 1.35, -d.headR * 0.6],
          [0.10, d.kneeY * 1.05, d.headR * 0.55],
          [-0.12, d.elbowY, -d.headR * 0.5],
        ];
        for (const [x, y, z] of spots) b.sphere('spine', 'glow', d.headR * 0.09, [x, y, z]);

        // 甲壳下的獠牙大嘴——依据："甲壳打开会露出尖牙密布的巨大嘴巴"；用独立骨骼便于攻击时转出张开
        // （见 anim.onFrame），平时用 setBase 收拢角度藏在下巴内侧
        b.bone('jaw', 'head', [0, d.headY - d.headR * 0.6, -d.headR * 0.55]);
        b.geo('jaw', 'glow', A.geo.glowFace({ width: d.headR * 1.4, eyes: 0, smile: true, teeth: 16, rows: 2, toothShape: 'fang' })
          .translate(0, 0, -d.headR * 0.3));
        b.setBase('jaw', -1.4, 0, 0, 0, 0, 0);

        // 长矛——依据："携带长矛（推测用巨大生物的牙齿制成）"；矛身沿用 claw 槽位材质（骨/牙质感一致，
        // 不新增材质槽位/draw call）。握持点对齐 foreR 骨骼自身位置（±shoulderW 附近），参照
        // shadow_worker.js 记录过的坑：不能用小比例系数，否则缩进躯干里看不见
        const gx = d.shoulderW * 1.05, gy = d.handY;
        b.limb('foreR', 'claw', [gx, gy, 0.08], [gx * 1.25, gy + 1.7, -1.4], 0.035, 0.006, 7, 1);
      },
    }), { label: 'tiny' });
    // 材质槽位：body / head / claw / glow，共 4 个 ≤ 预算 5；长矛复用 claw 槽位不新增 draw call
  },
});
})();

// notImplemented（返回值里也会列一遍）：
// - "无法在陆地上行走"没有做成真正的水域/陆地地形限制（引擎没有水体/液面的地形查询接口），
//   用离开出生点 TERRITORY_R 米就不再追击来近似"游出了它能到达的水域"，不是精确复刻。
// - "释放焦油迷惑或减缓猎物"未实现：引擎没有对目标施加减速/致盲一类状态效果的 API，见 apiRequests。
// - "通过某种心灵感应方式对话"未实现：用户规则明确 NPC 对话不做，只用 idle 音效（whisper）表现在"说话"。
// - "已清除 Level 7 其他生物"未实现：这是层级实体生成表的职责（决定 Level 7 刷不刷别的实体），不在实体文件范围内。
// - "只有在 Level 7 入口房间交流相对安全"这类"安全区域"未实现：涉及区域判定和交流系统，交流本身也被
//   用户规则排除（不做 NPC 对话），不落实为行为。
