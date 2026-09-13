// 幸运纸鹤 Lucky Cranes（Entity 46）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-46  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// wikidot-cn 版本的“纸鹤数量超过人口才出事”这条阈值表述不采用，选中版本写的是“群落远多于人口”。
//
// appearance 段写了三种折法：大多数是传统折鹤（orizuru，主形态）、少数扇尾、少数多头变体，外形明显不同，
// 按 _TEMPLATE.md 第 1 节拆成三个 type：lucky_crane（主形态）/ lucky_crane_fantail（扇尾）/
// lucky_crane_multihead（多头）。appearance 还提过“玫瑰结”折法，这是完全不同的球状/结状折纸，不是鸟形骨架
// 能表达的拓扑，本轮篇幅内没有再建一套球状模型，未注册第四个 type，见文件末 notImplemented。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---- 数值：三种折法共用（appearance 段只按折法拆了外观，没有按折法拆行为/数值） ----

// 依据 size："1 到 5 英寸（约 2.5 到 12.7 厘米）"——这是本文件唯一有精确数字的尺寸描述。
// 整体可视长度（喙尖到尾尖）按下面 build 里的坐标量出来接近 12 厘米，取在原文区间的上段而不是中段：
// 折纸本身只有几厘米高，若取区间下限，在正常游戏摄像机距离和碰撞体判定下会小到接近不可见/不可拾取判定，
// 这里在“不超出原文给出的区间”的前提下，选偏大值换取可见度和攻击距离判定的可用性，仍是原文数字，不是编造。
const RADIUS = 0.06, HEIGHT = 0.08;

const HP = A.HP.fragile;
// 依据：weaknesses"千万别伤害纸鹤，否则可能触发群攻""可以把纸鹤一只只轻轻拿起挪走来清理"——通篇把它当作
// 极易破坏的脆弱物件处理；appearance 提到内部管状液体结构"比普通纸结实"只是相对普通纸张而言，纸鹤本身仍然
// 只有几厘米大，不足以拉到更高档，取数值表最低档 fragile。

const SPEED = { walk: A.SPEED.still, run: A.SPEED.sprint };
// walk 依据 locomotion："单独或不受威胁时基本静止，任人拿起摆弄"——没有主动游荡的移动速度，取 0；
// run 依据 attack："极快地在目标身体里切进切出……一两分钟内让受害者倒地"，且没有"能被甩掉"的描述——
// 取持续速度最高档 sprint（比人快、跑不掉，只能躲）。这个数值只是骨架内部判断"追没追上"的参照速度，
// 真正的"clip 穿梭"观感由下面 craneThink 里的短距离瞬移实现，不是靠这个速度走过去。

const PERCEPTION = { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 };
// 依据 senses："被'幸运'的人吸引……尸检没发现中枢神经系统，但有初级智能。具体感官 unverified"——
// 原文没给可用的具体感知数值（“被幸运的人吸引”这个机制见 apiRequests，感知表给中性默认值只是让引擎
// 索敌能正常工作，非设定精确值）；fov 给 360，因为折纸没有靠"脸的朝向"判断正面的意义。

const ATTACK = { hp: A.DAMAGE.graze, sanity: 0, range: 0.6, cooldown: A.COOLDOWN.flurry };
// 依据 attack："只有群落受到物理威胁（纸鹤被伤害）时才群起攻击：极快地在目标身体里切进切出，留下纸割伤般
// 的伤口，累积起来造成极度痛苦的失血或窒息死亡……高度致命"——单次是"纸割伤"的小伤（取最低档 graze），
// 但配合最快的出手节奏（flurry）让很多下叠加起来符合"高度致命"的整体结果；range 0.6 满足贴身近战判定
// （数值表"爪/咬 0.8–1.0"区间下限再收一点，因为体型远小于人形），本体半径只有 0.06，不会触发
// range<radius 的注册警告；sanity 原文没写命中理智效果，给 0。

const SOUNDS = { attack: 'noclip' };
// 依据 sounds："从火边切走时有一阵呼的气流声，像书页沙沙翻动"——这是原文唯一描述的声音，而且和 attack 段
// "极快地在目标身体里切进切出"是同一种穿梭动作，所以攻击音效复用 noclip（气流声，别名 exit→noclip）；
// 没有待机/警觉叫声的描述，不加 idle/alert（个体平时无敌意也不该有警觉音效）。

// 群落彼此感知半径：behavior"人类聚居地附近的群落……离聚居地从不超过 1 英里"说的是群落相对聚居地的范围，
// 不是纸鹤彼此的感知距离，原文没给这个数字。这里取一个关卡尺度下的游戏性数值，表示"同一片藏身处"的邻居
// 会一起对威胁作出反应，不是设定精确值。
const COLONY_RADIUS = 6;

function isCrane(o) { return !!(o && typeof o.type === 'string' && o.type.indexOf('lucky_crane') === 0); }

// 依据 attack："极快地在目标身体里切进切出"+ locomotion："靠 no-clip 移动"——报复时不是慢慢跑过去贴身，
// 而是每隔一小段时间直接闪现到目标附近（写法参考 samantha.js 的短距离瞬移），比骨架默认的"跑步接近"更贴合
// "clip in/out" 的穿梭观感；骨架本身的追击位移仍然会跑（没有办法从外部关掉私有的 chase 位移），
// 瞬移只是叠加在上面，让它看起来"一下子就贴到身上了"。
function craneThink(e, dt, api, brain) {
  brain.think(e, dt, api);
  if (e.dead) return;
  const c = e.data.crane || (e.data.crane = { blinkAt: 0 });
  if ((e.state === 'chase' || e.state === 'attack') && api.time >= c.blinkAt) {
    const t = A.acquire(e, api, {});
    if (t) {
      const ang = api.rng() * Math.PI * 2, r = 0.12 + api.rng() * 0.22;
      e.x = t.x + Math.cos(ang) * r;
      e.z = t.z + Math.sin(ang) * r;
      A.cry(e, 'noclip', { cooldown: 0.25, hear: 14 });
    }
    c.blinkAt = api.time + 0.3 + api.rng() * 0.25;
  }
}

// 依据 attack："只有群落受到物理威胁（纸鹤被伤害）时才群起攻击"——一只被打不应该只有它自己反击，附近同类
// （不分折法，因为原文没有按折法区分行为）也要把打人者记成"仇人"。阵营规则规定 neutral 只能打"打过自己的
// 对象"，这个记仇状态（provoker）统一由 entities.js 的 api.damage 设置，实体文件不能绕过；这里用公开的
// api.damage 给附近同类一个象征性的 0.01 点伤害（HP 10 点几乎看不出掉血），顺带把攻击者正式记成它们的仇人，
// 而不是私自改内部字段。
function craneOnHit(e, amount, attacker, api) {
  if (e.dead || !attacker) return;
  const mates = A.nearby(api, e, COLONY_RADIUS, isCrane);
  for (const m of mates) api.damage(m, 0.01, attacker);
}

const DEAD_COLOR = 0x746024;
// 依据：死后"金色液体变硬、变暗成脏黄色，把身体'粘'住，相当于尸僵"——用一次性变色代替，非精确色号。

const CRANE_ANIM = {
  gait: 'none',      // 依据：折纸没有腿，不用步行/四足步态，移动全靠滑行+瞬移
  breathe: 0, twitch: 0,
  strike: 'sting',    // 依据："切进切出留下纸割伤般的伤口"——尖锐细小的刺击动作，比 swipe/bite 更贴合没有肢体的纸鹤
  recoil: 0.1,        // 依据：体型极小、材质是纸，被打后只有很轻的震颤后仰，非设定精确弧度
  fall: 'crumple',    // 依据："尸僵……把身体粘住"——瞬间僵住蜷缩倒地，比 back/side 的整体倒伏更贴合"僵住"的观感
  onFrame(e, dt, api, u) {
    if (!u.rig || !u.rig.userData) return;
    const ud = u.rig.userData;
    if (e.dead) {
      if (!ud.craneDead && ud.craneBody) { ud.craneBody.color.setHex(DEAD_COLOR); ud.craneDead = true; }
      return;
    }
    // 待机颤抖：翅膀轻微抖动，呼应 sounds"呼的气流声，像书页沙沙翻动"——纸很薄，随时会被气流带得轻轻发颤，
    // 不对应某一句具体描述，纯粹是给"多加一点细节"的表现取舍
    const wob = Math.sin(api.time * 8 + (ud.craneOff || 0)) * 0.06;
    A.anim.addRot(u.rig, 'wingL', 0, 0, wob);
    A.anim.addRot(u.rig, 'wingR', 0, 0, -wob);
  },
};

// ---- 模型：三种折法共用的部件函数（坐标是模型空间绝对坐标，不是相对骨骼原点的偏移——本项目自定义骨架的
// 约定，box/sphere/limb/cone 的位置参数最终按绝对坐标渲染，bone 的父子关系只影响动画怎么带动它） ----

const BODY_Y = 0.02, BODY_R = 0.018, NOSE_Z = -0.026, TAIL_BASE_Z = 0.024;
// 依据 appearance："像用高质量纸折的千纸鹤……大多是传统折鹤（orizuru）折法"——用两个共享最宽处的圆锥
// 拼出折纸对称菱形（kite）轮廓的躯干：从中段最宽处分别收窄到前面的脖子根、后面的尾羽根。

function addNeck(b, suffix, xOff) {
  // 依据 appearance："纸层之间夹着……闪光的金色液体"——脖子到喙做成一根连续变细的锥体，头部单独鼓一个小球，
  // 喙再单独出一小截尖锥，呼应"长颈+细尖喙"的鹤形轮廓；xOff 给多头变体用来把左右两个头分开
  const nx0 = xOff, nx1 = xOff * 1.7;
  b.bone('neck' + suffix, 'body', [nx0, BODY_Y, NOSE_Z]);
  b.cone('neck' + suffix, 'body', [nx0, BODY_Y, NOSE_Z], [nx1, 0.05, -0.048], 0.007, 5);
  b.bone('head' + suffix, 'neck' + suffix, [nx1, 0.05, -0.048]);
  b.sphere('head' + suffix, 'body', 0.009, [nx1, 0.05, -0.048], null, [6, 5]);
  b.cone('head' + suffix, 'body', [nx1, 0.05, -0.048], [nx1 * 1.25, 0.056, -0.064], 0.0035, 4);
}

function addTail(b, style) {
  b.bone('tail', 'body', [0, BODY_Y, TAIL_BASE_Z]);
  if (style === 'fan') {
    // 依据 appearance："也有扇尾……变体"——尾羽从单一尖角改成三片呈扇形展开
    for (let i = -1; i <= 1; i++) {
      b.cone('tail', 'body', [0, BODY_Y, TAIL_BASE_Z], [i * 0.02, 0.045, TAIL_BASE_Z + 0.045], 0.007, 4);
    }
  } else {
    b.cone('tail', 'body', [0, BODY_Y, TAIL_BASE_Z], [0, 0.05, TAIL_BASE_Z + 0.032], 0.012, 5);
  }
}

function addWings(b) {
  // 依据 appearance 隐含的"折鹤"整体形态——传统折鹤两侧有一对折起的翼片，原文没有单独描写翅膀角度，
  // 按常见折法给一对斜向后上方展开的扁平翼片，非设定精确角度
  b.bone('wingL', 'body', [0, BODY_Y + BODY_R * 0.6, 0]);
  b.box('wingL', 'body', [0.05, 0.003, 0.022], [-0.03, BODY_Y + 0.012, 0.012], [0.2, 0, 0.35]);
  b.bone('wingR', 'body', [0, BODY_Y + BODY_R * 0.6, 0]);
  b.box('wingR', 'body', [0.05, 0.003, 0.022], [0.03, BODY_Y + 0.012, 0.012], [0.2, 0, -0.35]);
}

function craneRig(b, opts) {
  b.bone('body', null, [0, BODY_Y, 0]);
  b.cone('body', 'body', [0, BODY_Y, 0], [0, BODY_Y, NOSE_Z], BODY_R, 6);
  b.cone('body', 'body', [0, BODY_Y, 0], [0, BODY_Y, TAIL_BASE_Z], BODY_R, 6);
  if (opts.heads === 2) {
    // 依据 appearance："……以及多头变体"——两个脖子从躯干前端左右分开，不是一分为二共用一根脖子
    addNeck(b, 'L', -0.011);
    addNeck(b, 'R', 0.011);
  } else {
    addNeck(b, '', 0);
  }
  addTail(b, opts.tail);
  addWings(b);
}

function buildCrane(ctx, key, tail, heads) {
  const T = ctx.THREE;
  // 依据 appearance："图案、颜色、大小各不相同，没有指定颜色"——原文明确说颜色不统一，这里按每只实体的 id
  // 播种一个随机柔和色相，而不是所有个体共用同一个写死的颜色；颜色本身不是设定精确色号
  const rnd = BR.util.mulberry32(BR.util.hashStr(String((ctx && ctx.entity && ctx.entity.id) || key)));
  const col = new T.Color().setHSL(rnd(), 0.35, 0.8);
  const bodyMat = A.mat.own(A.mat.lambert(col.getHex()));
  const mesh = A.parts.rig(key, b => craneRig(b, { tail, heads }), { mats: { body: bodyMat } });
  mesh.userData.craneBody = bodyMat;
  mesh.userData.craneOff = (BR.util.hashStr(String((ctx && ctx.entity && ctx.entity.id) || key)) % 628) / 100;
  return mesh;
}

// ---------------- 主形态：传统折鹤 orizuru ----------------
A.register({
  type: 'lucky_crane', en: 'Lucky Crane', zh: '幸运纸鹤', version: 'wikidot-en',
  faction: A.faction('varies', 'neutral'),
  // 依据 hostility=varies，attack："单只被动、无敌意。只有群落受到物理威胁（纸鹤被伤害）时才群起攻击"——
  // 常态完全不主动伤人，只在被打后反击，对应 _TEMPLATE.md 第 3 节 varies 判定表"只在被激怒/被攻击时才动手 → neutral"。

  hp: HP, radius: RADIUS, height: HEIGHT,
  speed: SPEED, perception: PERCEPTION, attack: ATTACK, sounds: SOUNDS,
  corpseSec: 4,
  // 依据：纸鹤死后"液体变硬……相当于尸僵"，是变硬变色而不是腐烂消失，尸体给比默认（2.5s）长一点的停留时间，非精确秒数

  brain: A.wanderer({ retaliate: 'fight' }),
  think: craneThink,
  onHit: craneOnHit,
  anim: CRANE_ANIM,

  build(ctx) { return A.wrap(buildCrane(ctx, 'lucky_crane_orizuru_v1', 'point', 1), { label: 'lucky_crane' }); },
});

// ---------------- 扇尾变体 ----------------
A.register({
  type: 'lucky_crane_fantail', en: 'Lucky Crane (fan-tail)', zh: '幸运纸鹤·扇尾', version: 'wikidot-en',
  faction: A.faction('varies', 'neutral'),
  hp: HP, radius: RADIUS, height: HEIGHT,
  speed: SPEED, perception: PERCEPTION, attack: ATTACK, sounds: SOUNDS,
  corpseSec: 4,
  brain: A.wanderer({ retaliate: 'fight' }),
  think: craneThink,
  onHit: craneOnHit,
  anim: CRANE_ANIM,
  build(ctx) { return A.wrap(buildCrane(ctx, 'lucky_crane_fantail_v1', 'fan', 1), { label: 'lucky_crane_fantail' }); },
});

// ---------------- 多头变体 ----------------
A.register({
  type: 'lucky_crane_multihead', en: 'Lucky Crane (multi-head)', zh: '幸运纸鹤·多头', version: 'wikidot-en',
  faction: A.faction('varies', 'neutral'),
  hp: HP, radius: RADIUS, height: HEIGHT,
  speed: SPEED, perception: PERCEPTION, attack: ATTACK, sounds: SOUNDS,
  corpseSec: 4,
  brain: A.wanderer({ retaliate: 'fight' }),
  think: craneThink,
  onHit: craneOnHit,
  anim: CRANE_ANIM,
  build(ctx) { return A.wrap(buildCrane(ctx, 'lucky_crane_multihead_v1', 'point', 2), { label: 'lucky_crane_multihead' }); },
});
})();

// notImplemented（返回值里再列一遍）：
// - "玫瑰结"折法（第三种提到的形态）没有注册第四个 type：这是球状/结状折纸，不是本文件用的鸟形骨架
//   （躯干+脖子+翅膀+尾）能表达的拓扑，需要另建一套完全不同的模型，本轮篇幅内没有做。
// - senses"被'幸运'的人吸引"：引擎没有玩家"运气值/幸运事件"这类数据，无法让它专门找幸运玩家，
//   只能退化成中性默认感知，见 apiRequests。
// - weaknesses"怕火和水，受到威胁会切走逃到安全处，可以用火/水驱散群落"：引擎没有火源/水域这类危害源的
//   探测接口，无法判断"附近有火"或"附近有水"，未实现，见 apiRequests。
// - behavior"群落远多于人口时聚居地连环倒霉，最终可能崩溃""建议每天驱散 10-25 只"：这是聚居地/据点级别的
//   宏观模拟效果，不是单个实体能表达的行为，超出实体文件范围（据点相关按 WAVE2.md 附录，上线大厅后再做）。
// - sanityEffect"随身带着纸鹤后 no-clip 变难"：本项目玩家没有 no-clip 穿墙移动这个机制，这条减益无所依附，
//   未实现，见 apiRequests。
// - behavior"以前被归为 Object 33，被当护身符交易"：涉及 M.E.G. 交易和物品拾取赋予的编号变更，按用户范围
//   决定（M.E.G. 交易不做），未实现。
// - appearance"死后金色液体变硬变暗成脏黄色，相当于尸僵"：用整只一次性变色（DEAD_COLOR）近似，没有做"透过
//   半透明纸隐约看见变硬的管道网络"这种更精细的效果，材质槽位/贴图预算不支持。
