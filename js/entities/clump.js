// 肢团 Clump（Entity 5）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-5  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'clump', en: 'Clump', zh: '肢团', version: 'wikidot-cn',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.weak,          // 依据："骨骼极其脆弱"（weaknesses 一段原文）→ 不耐打
  // 依据：size 字段页面自相矛盾（一处最大约3英尺样本，一处记录最大约4米）——同一版本内部矛盾，
  // 不借用其他来源，取较常见的"最大约3英尺"样本换算成直径约0.91米，半径按一半估算；
  // 它不是直立生物而是贴地的一团肢体，height 只用来定视线起点，按矮团的比例给一个游戏性数值，非设定精确值
  radius: 0.45, height: 0.75,
  speed: {
    walk: A.SPEED.walk,     // 依据："在各层游荡寻找猎物"——日常游荡速度无数字，取通用巡游档，非设定
    run: A.SPEED.sprint,    // 依据："进入运动状态后展现极高速度和力量……行动灵活"→ 定性"极高"，对应"比人快、跑不掉"档
  },
  // 依据：感官机制原文"未明写"（部分报告称肢体团中有眼睛耳朵，但不确定、不普遍）→ 感知用默认值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 200, needsLight: false, avoidsLight: false },
  attack: {
    hp: A.DAMAGE.severe,     // 依据："高致死"
    sanity: 0,                // 依据：sanityEffect 标注 unverified，不填
    range: 2.4,                // 依据："与猎物距离缩短到8英尺内……伸出最长肢体抓住猎物"，8ft × 0.3048 ≈ 2.4384m
    cooldown: A.COOLDOWN.heavy, // 依据："拖入中心，露出装满锋利牙齿的嘴吞食"——抓、拖、吞三段过程，比单纯撕扯更慢
  },
  // 选中版本没写 sanityEffect（unverified）→ 不加 aura
  // 选中版本没写具体叫声（appearance/behavior 均未提声音）→ 不加 sounds

  // 行为：巡逻游荡找猎物；命中一次后进入短暂"进食后蛰伏"（依据：behavior "满足食欲后……在地面挖掘把自己埋进去"）。
  // 引擎没有饱食度概念，用"最近一次命中"代替"进食"信号，命中 2 秒后蛰伏 8 秒，时长为游戏性数值、非设定。
  brain: A.stalker({
    patrol: 'wander', patrolRadius: 16, alertSec: 0.4, searchSec: 10,
    onAttack(e, t, api) { e.data.lastFeedAt = api.time; },   // 依据：命中后记为"进食"信号，供下方 think 判断蛰伏
  }),
  think(e, dt, api, brain) {
    const d = e.data, now = api.time;
    if (d.dormantUntil != null) {
      if (now < d.dormantUntil) { e.state = 'dormant'; return; }   // 蛰伏期间原地不动、不索敌，对应"埋进地面休眠"
      d.dormantUntil = null; d.lastFeedAt = null;                   // 苏醒，恢复正常游荡/狩猎
    } else if (d.lastFeedAt != null && now - d.lastFeedAt > 2) {
      d.dormantUntil = now + 8;
      e.state = 'dormant';
      return;
    }
    brain.think(e, dt, api);
  },

  anim: {
    gait: 'none',              // 不是双足/四足步态，构件本身没有对应的"甩肢体"步态选项
    sway: 0.6, swaySpeed: 2.2,  // 依据："倾向于把肢体甩向地板来移动"→ 加大肢体摆动幅度模拟甩动
    strike: 'grab',              // 依据：攻击是"伸出肢体抓住猎物"
    recoil: 0.18,
    fall: 'crumple',
    onFrame(e, dt, api, u) {
      // 蛰伏时把模型下沉模拟"埋进地面"；animate 只能读 e.state、不能改 e.x/y/z，故用 pivot 高度表现（同飞行实体用 pivot.y 表现飞行高度的做法）
      const target = e.state === 'dormant' ? -0.35 : 0;
      if (u.pivot) u.pivot.position.y += (target - u.pivot.position.y) * Math.min(1, dt * 4);
    },
  },

  build(ctx) {
    // 低画质分支：和构件内部 resolveDetail 读同一个开关（BR.game.settings.quality），
    // 保证"几何缓存键里的 detail"和"extend 里加的形状"永远对得上（geoKey 把解析后的 detail 算进键）
    const low = !!(BR.game && BR.game.settings && BR.game.settings.quality === 'low');
    const CORE = 0.32;   // = 下面的 core；dims 只带出 center，改 core 要同步改这里
    // 顶点色 tint：body 槽位是暗红棕湿肉色(0x5a3226)，tint 允许 >1 把某一块提亮到超过槽位材质色，
    // 于是骨白的牙、眼白、深色口腔都能待在同一个材质槽位里，不新增槽位、不多 draw call（_TEMPLATE.md 6.10）
    const BONE = [2.3, 4.0, 4.6];      // → 约 #d3d0b8 骨白
    const PUPIL = [0.12, 0.14, 0.16];  // → 近黑的瞳孔
    const GULLET = [0.09, 0.08, 0.08]; // → 几乎全黑的口腔深处（复评："深色口腔被白牙盖住了"，压到比原来暗一半以上，先读到"暗的洞"）
    const EAR = [1.12, 0.95, 0.92];    // 耳廓比周围肉色略淡一点
    return A.wrap(A.parts.limbCluster({
      count: 7, segments: 5,        // 依据："由长度、力量各不相同的多条肢体组成"——数量未记载，取比构件默认(6)略多的游戏性数值
      length: 1.6,                    // 依据："最长肢体在8–10英尺之间"（约2.4–3米）；受限于室内走廊尺度与碰撞体积做等比缩短，方向依据不变
      radius: 0.07, tip: 0.012,       // 依据："力量各不相同"→ 略调粗一点表现有力的肢体，非精确设定
      spread: 0.85,                    // 依据："展现极高速度和力量、行动灵活"→ 肢体向四周张开甩动的姿态
      core: 0.32,                       // 依据："中心有装满锋利牙齿的嘴"——中心肉团需要足够大小容纳嘴部
      colors: { body: 0x5a3226, glow: 0xffffff },   // 依据："皮肤黏糊糊、近乎湿漉"，气味类似"烧焦血肉和红色大丽花"→ 取暗红棕色湿肉色；无发光部位描述
      look: { body: 'skin' },   // 构件没有"湿滑"材质选项，取最接近的皮肤纹理近似，非设定
      key: 'clump_v3',   // extend 里的形状/tint 变了就换键：几何按键缓存，不换会在同一页面里拿到旧模型
      extend(b, d) {
        // RigBuilder 的坐标是模型空间绝对坐标（原点在脚下），不是相对父骨骼的偏移（_TEMPLATE.md 6.6）
        const cx = d.center[0], cy = d.center[1], cz = d.center[2];
        // 核心球面取点：az 由正前方(-Z)转向 +X，el 为仰角，k 是半径倍数
        const on = (az, el, k) => [
          cx + Math.sin(az) * Math.cos(el) * CORE * k,
          cy + Math.sin(el) * CORE * k,
          cz - Math.cos(az) * Math.cos(el) * CORE * k,
        ];
        // 一圈锥牙：牙根落在核心球面上，牙尖朝口心内收（conv = 牙尖方位角相对牙根的倍数，越小越往口心收）并略微前伸。
        // conv 原来写死 0.42：牙尖全都收到口心一点上，出图（b1-C clump-1-front34）读成一朵白色放射状星芒/海葵，
        // 要凑到 4-head 才认得出是嘴。改成参数，外圈几乎不收、内圈收一半，中间那块黑口腔就露出来了
        const ring = (n, rx, ry, out, rad, seg, conv) => {
          for (let i = 0; i < n; i++) {
            const t = i / n * Math.PI * 2, az = rx * Math.cos(t), el = ry * Math.sin(t);
            b.cone('core', 'body', on(az, el, 1.0), on(az * conv, el * conv, 1.0 + out), rad, seg, { tint: BONE });
          }
        };

        // 依据："中心有装满锋利牙齿的嘴"——两名打分员都点名这是最缺的一处（"设定核心的满口利牙中心嘴没有"）。
        // 正前方(-Z)一张扁圆的深色口腔，外圈一圈锥牙。口腔盘比上一版更大、更靠外、更黑：
        // 远景先读到"一个黑洞"，牙只是洞口一圈白边（复评：3/4 正面读成白色星芒）
        b.sphere('core', 'body', 0.185, on(0, 0, 0.93), [1.0, 0.80, 0.34], low ? [6, 4] : [8, 6], { tint: GULLET });
        if (low) { ring(3, 0.50, 0, 0.11, 0.020, 3, 0.70); return; }   // 低画质只补最能认出它的这一处，其余保持简版
        ring(12, 0.60, 0.44, 0.11, 0.021, 4, 0.74);
        ring(8, 0.34, 0.25, 0.07, 0.013, 4, 0.58);   // 依据："装满"锋利牙齿→ 再加一圈内牙，不是一圈稀疏的尖

        // 依据："部分报告记录会有眼睛和耳朵出现在肢体团中""有人在一只肢团上看到一双或更多眼睛"——
        // 刻意不排成一张脸：正面偏上一对，另外两颗散在侧面和后方。原文未提发光部位，
        // 所以眼白走 body 槽位的亮 tint，不用 glow 槽位（不凭空加自发光）
        // 半径比上一版大 4 成：640 px 出图上原来的 0.022–0.034 眼球只剩一两个像素，复评说"几乎看不见"
        for (const [az, el, r] of [[-0.45, 0.72, 0.043], [0.28, 0.80, 0.038], [-1.75, 0.35, 0.047], [2.30, -0.20, 0.032]]) {
          b.sphere('core', 'body', r, on(az, el, 0.94), null, [6, 5], { tint: BONE });
          b.sphere('core', 'body', r * 0.5, on(az, el, 0.94 + r * 0.75 / CORE), null, [5, 4], { tint: PUPIL });
        }
        // 耳朵：贴着球面的一片薄耳廓 + 一条耳脊。box 的 rot 绕 Y 转 (π/2 − az)，薄的那一轴才会朝向球面外法线
        for (const [az, el, h, w] of [[-1.15, 0.55, 0.135, 0.095], [1.95, 0.12, 0.110, 0.078]]) {
          b.box('core', 'body', [0.020, h, w], on(az, el, 0.93), [0, Math.PI / 2 - az, 0], { tint: EAR });
          b.box('core', 'body', [0.014, h * 0.55, w * 0.42], on(az, el, 0.97), [0, Math.PI / 2 - az, 0], { tint: PUPIL });
        }
        // 依据："皮肤黏糊糊、近乎湿漉"——打分员："中心只是一颗光滑肉球"。
        // 核心外挂一圈大小不一的鼓包，tint 各差一点做出湿肉的斑驳，轮廓不再是标准球
        for (const [az, el, r, tint] of [
          [0.95, 0.55, 0.150, [1.10, 1.02, 0.98]], [2.05, -0.15, 0.170, [0.90, 0.95, 1.00]],
          [3.25, 0.35, 0.130, [1.14, 1.06, 1.00]], [4.35, -0.45, 0.145, [0.94, 0.90, 0.92]],
          [5.30, 0.62, 0.120, [1.06, 1.00, 1.04]], [0.15, -0.70, 0.135, [0.88, 0.94, 0.98]],
        ]) b.sphere('core', 'body', r, on(az, el, 0.80), null, [6, 5], { tint });

        // 依据："由长度、力量各不相同的多条肢体组成"——打分员："肢体全是粗细一致的细棍""读起来像蜘蛛"。
        // 构件自带的 7 条等长等粗之外，再插 3 条长短粗细各异的：一条粗壮、一条细瘦贴地、一条短而上举。
        // 长度都压在自带肢体(1.6)之内，包围盒不变；b.chain 会自动登记进 meta.chains，跟着 anim.sway 一起甩
        [[0.75, 0.62, 1.30, 0.095, 5], [2.54, -0.18, 1.12, 0.055, 4], [4.34, 0.95, 0.95, 0.078, 4]]
          .forEach(([az, el, len, rad, seg], i) => {
            b.chain('x' + i + '_', 'core', on(az, el, 0.80),
              [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)], seg, len, rad, 0.012, 'body', 5);
          });
      },
    }), { label: 'clump' });
  },
});
})();
