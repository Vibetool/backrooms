// 磨损者 The Frayed（Entity 21，backrooms-arch.wikidot.com 的存档页）
// 来源版本：wikidot-en  URL：http://backrooms-arch.wikidot.com/entity-21-1  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）。
// 备注：这个版本是英文站已废弃/存档的旧页面（现行 entity-21 已被另一个实体"Anna"占用），调研只拿到
// WebSearch 摘要、没能读到全文（见 backrooms-research/entities/frayed.json 的 loadedVia），
// 下面每条依据都基于这份摘要；conflicts 里提到的"黑色黏稠物、白色微光小眼"来自未鉴别来源，不采用。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 移动路径上的墨色腐蚀痕迹（ENGINE_PLAN M1 回填，见 anim.onFrame）：数值是任务给定的参考值，非设定精确数字
const TRAIL_STEP = 0.8;    // 每移动约 0.8 m 落一块
const TRAIL_RADIUS = 0.32; // 比脚下常驻的印记（原 0.4）略小，多块连起来才像脚印链而不是一整滩
const TRAIL_TTL = 60;      // 依据：任务给的参考时长约 60 s
const TRAIL_COLOR = 0x08070a;   // 沿用原来脚下印记的墨黑色，色调一致

A.register({
  type: 'frayed', en: 'The Frayed', zh: '磨损者', version: 'wikidot-en',
  faction: 'neutral',
  // 依据：hostility 字段直接给的就是 neutral（"被认为无害或温顺、不追人"）。阵营规则（entities.js
  // canAttack）里 neutral 只有先被打过才会反击，"靠近后会主动接触开始转化"这条主动伤人的描述没法在
  // 不绕开阵营系统的前提下实现，退化成被攻击后反击，见文件末 notImplemented / 返回值 apiRequests。

  hp: A.HP.average,
  // 依据：体力/是否易被打死 unverified，按人形非战斗单位取中档，非设定精确值
  radius: 0.35, height: 1.8,
  // 依据：size unverified，按"人形"给常见人类体型的游戏性默认碰撞体积，非设定

  speed: { walk: A.SPEED.slow, run: A.SPEED.slow },
  // 依据：速度本身 unverified，但"以未知方式漂浮""不追人"说明它本来就不主动追逐目标，
  // 取慢速档表现"不慌不忙地漂"，非设定精确值；反击时也不给它突然变快

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据：感官 unverified，取默认档；它没有主动索敌/追逐行为，fov 给多宽都不影响什么，给 360 省事

  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 1.0, cooldown: A.COOLDOWN.slow },
  // 依据：接触它的墨色物质"造成严重烧伤"——取 severe；理智影响 unverified，不填 sanity；
  // "转化需要长时间暴露在大量液态磨损者物质中"——转化机制没法在单次命中里实现，只保留灼烧伤害这部分，
  // 转化本身见 notImplemented；cooldown 取慢档，呼应它"温和、不慌张"的形象

  // 没写任何叫声/音效，不编造 sounds 字段

  brain: A.wanderer({ speed: A.SPEED.slow, retaliate: 'fight' }),
  // 依据：不追人、也没写它会主动躲避谁——用中立游荡骨架；retaliate:'fight' 近似"被激怒会伤人"，
  // 但受阵营规则限制，只有先攻击它的对象才会被反击，见 notImplemented

  anim: {
    gait: 'none', breathe: 0, sway: 0,
    fly: { cruise: 0.1, rest: 0.1, bob: 0.05, bobHz: 0.5, ceiling: false },
    // 依据："以未知方式漂浮（一条摘要称略微离地）"——用极低的悬浮高度做出脚不沾地的漂浮感；
    // gait:'none' 让双腿保持直立、不做正常人的迈步动作，呼应"靠未知力量维持成形"这种不自然的移动方式
    strike: 'grab', recoil: 0.15, fall: 'fade',
    // 依据：攻击是"试图接触"，用 grab 近似；死亡表现原文 unverified，按"身体大部分是液体"选择淡出
    // 消散而不是倒地不起，非设定
    onFrame(e, dt, api, u) {
      // 依据："移动时留下墨色的腐蚀性痕迹"——按移动距离每隔约 0.8 m 在脚下贴一块地面痕迹，纯表现、
      // 不同步（各端各自按本地位置生成），ttl ≈60 s 到期自然消失（ENGINE_PLAN M1 回填）
      if (e.dead) { u.trailAcc = 0; u.trailX = u.trailZ = null; return; }
      if (u.trailX == null) { u.trailX = e.x; u.trailZ = e.z; u.trailAcc = 0; return; }   // 首帧只记位置，不落痕
      u.trailAcc = (u.trailAcc || 0) + Math.hypot(e.x - u.trailX, e.z - u.trailZ);
      u.trailX = e.x; u.trailZ = e.z;
      if (u.trailAcc >= TRAIL_STEP) {
        u.trailAcc = 0;
        if (BR.world && typeof BR.world.decal === 'function') {
          BR.world.decal(e.x, e.z, { color: TRAIL_COLOR, radius: TRAIL_RADIUS, ttl: TRAIL_TTL });
        }
      }
    },
  },

  build(ctx) {
    const group = new THREE.Group();
    const body = A.parts.humanoid({
      height: 1.8, thin: 0.25, hunch: 0.1, head: 'faceless', hands: true, feet: true, claws: 0, hair: 0,
      // 依据："人形"——无面（faceless）表现"液体维持成形、没有五官"；其余尺寸原文没写，按人形常规比例给
      colors: { body: 0x0c0b0a, head: 0x0c0b0a },
      look: { body: 'skin', head: 'skin' },
      // 依据：本体颜色 unverified，取接近黑色的暗色调表现"墨色液体"，非设定精确色值；
      // 不加发光部位——眼睛/是否发光 unverified，conflicts 里的"白色微光小眼"出处不明，不采用
      key: 'frayed_v1',
      extend(b, d) {
        // 依据：身体是"被未知力量维持成形的液体"——在肩部和胯部各加两处下垂的滴状凸起，做出黏液
        // 欲滴的质感；沿用 body 槽位，不新增材质、不增加 draw call
        const drips = [
          ['spine', d.shoulderW * 0.85, d.shoulderY - d.H * 0.05],
          ['spine', -d.shoulderW * 0.85, d.shoulderY - d.H * 0.08],
          ['hips', d.hipW * 0.7, d.hipY - d.H * 0.03],
          ['hips', -d.hipW * 0.7, d.hipY - d.H * 0.06],
        ];
        for (const [bone, x, y] of drips) b.cone(bone, 'body', [x, y + 0.06, 0.02], [x, y - 0.08, 0.02], 0.026, 5);
      },
    });
    group.add(body);
    // 依据："移动时留下墨色（inky）的腐蚀性痕迹"——真正留在途经路径上的轨迹用 BR.world.decal 做
    // （见下方 anim.onFrame，ENGINE_PLAN M1 回填：区块级环形缓冲、全场只占 1 个 draw call，不在这里
    // 每帧 new 网格对象）
    return A.wrap(group, { label: 'frayed' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "靠近后会试图接触你、开始转化"：hostility=neutral 时阵营规则（entities.js canAttack）只允许被攻击后
//   反击，无法让它主动伤人；attack 字段保留了灼烧伤害数值，但触发条件退化成"反击"而不是"主动靠近就摸你"。
// - 转化成新的磨损者（需要长时间暴露在大量液态物质里）：没有"感染/转化"机制，引擎也没有动态生成新
//   实体类型的接口。
// - 已实现（2026-09-14，ENGINE_PLAN M1 回填）："身后留下墨色腐蚀性痕迹"：anim.onFrame 按移动距离每
//   ~0.8 m 调一次 BR.world.decal，在途经路径上真正留下会随时间消失（ttl≈60 s）的墨色痕迹；用的是区块级
//   环形缓冲（InstancedMesh），不是每帧 new 网格对象，符合性能规则。原来"跟随脚下一小滩印记"的近似写法
//   已删除。纯表现、不联机同步，各端按自己看到的位置各自生成。
// - 具体体型、颜色、眼睛、感官、速度：选中版本大量字段是 unverified，均取游戏性默认值，已在各字段
//   依据注释里说明。
