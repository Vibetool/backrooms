// 猎犬 Hound（Entity 8: Hounds // Egremond Syndrome）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_8  许可：CC BY-SA 3.0
// 只按 fandom 版本实现；wikidot-en/cn 的「蜂巢卵孵化起源」「巨口遮毛」「直视死盯可吓退」等细节属于其他版本，不借用（WAVE2.md 第1节）
//
// 形态（用户 2026-09-16 拍板，见 data/lore-choices.json 的 entities.hound.userOverride）：
//   由犬形四足改成「四肢着地的人形」——人被咬、感染 Egremond 综合征后约 20–30 分钟变形而成。
//   原文依据（fandom appearance）：「由人变形而来：人牙和指甲被獠牙与爪取代，手脚重构为四足，
//   全身毛发快速生长，眼睛失去色素，头骨与四肢周围的皮肤肌肉变薄」。
//   **只重做模型**：radius / height / speed / perception / attack / brain / hp / faction / sounds 全部照旧。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 画质档位：构件的 detail 缺省跟 BR.game.settings.quality 走。extend 里也要按同一档位决定加不加细节，
// 所以自己先解析一次再显式传给构件（detail 会进几何缓存键，两档画质各自缓存，不会互相顶掉）
function highDetail() {
  const s = BR.game && BR.game.settings;
  return !(s && s.quality === 'low');
}

// 变形前那个人的骨架名义身高（站立姿态）。四肢着地后肩高约 0.68 m、头顶约 0.95 m，和注册的碰撞体
// height 0.9 相符，也明显低于站立人形。选中版本 size 标 unverified，这是游戏性取值，非设定
const H = 1.42;

// 顶点色 tint：全部叠在已有的 body / head / fur / glow 四个槽位里，不新增材质槽位、不增加 draw call
const BONE = [1.45, 1.40, 1.32];    // 薄皮下顶出来的骨头，比皮色亮一档（「皮肤肌肉变薄」）
const TOOTH = [2.10, 2.35, 2.50];   // 牙：把皮革色提到骨白（tint 允许 >1）
const CLAW = [0.50, 0.48, 0.45];    // 爪：比皮色暗；选中版本没写爪的颜色，取角质深色，非设定

A.register({
  type: 'hound', en: 'Hound', zh: '猎犬', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile；「对大多数生命极具攻击性」

  hp: A.HP.average,            // 依据：「爪子磨钝、耐力差」「攻击性不稳定导致体力消耗很快」→ 不算耐打
  radius: 0.4, height: 0.9,    // 依据：四肢着地姿态的肩高；size:unverified（条目未给尺寸），游戏性默认值，非设定
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：「变形导致跛行，许多个体有永久行动障碍甚至完全不能跑」→ 冲刺上限只给到 jog，不给 run/sprint
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.acute, fov: 260 },
  // 依据：「听觉极敏锐，比犬类更强，可轻松听到约两英里外的声音」→ hearing 取最高档 acute；
  // 视力选中版本未写，按 normal 默认；fov 数值不改（用户只改形态，不改行为与数值字段）
  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal },
  // 依据：「靠强力颌部和利齿迅速制服猎物…攻击时通常直接撕下大块肉，而不是先把目标制服」→ 单次重伤(heavy)；
  // 「爪子在战斗中基本无效」→ 不额外做爪击手段；sanityEffect 描述的是感染症状（不是理智值），选中版本没写 san 数值 → sanity 填 0，不写 aura
  sounds: { alert: 'growl', attack: 'hit' },
  // 依据：条目未给拟声词，growl(低吼/咆哮) 是猎犬类最贴近的预设音；attack 用通用撕咬命中音 hit

  brain: A.stalker({ patrol: 'wander', patrolRadius: 14, searchSec: 6, smell: false }),
  // 依据：「能记住环境、在脑中绘制地图、能认脸」→ 有游荡巡逻而非固定原地；
  // 「成群狩猎」只见于未计入的论坛帖，density 里明确写 unverified → 不用群猎骨架(A.pack)，用单体追猎者；嗅觉选中版本未提，smell:false
  anim: { gait: 'crawl', stride: 1.1, strike: 'bite', stateSounds: { chase: 'growl' } },
  // 依据：「四足行走；后腿结构使其无法直立」。形态改成四肢着地的人形后骨骼名也跟着换了（人形骨架是
  // armL/foreL/legL/shinL，四足骨架才是 legFL/shinFL…），所以 gait 由 'quad' 改成同样是四肢着地、
  // 但驱动人形骨骼名的 'crawl'——不改就会四条腿都不动。这是模型骨骼绑定的配套改动，不是行为/数值改动：
  // 两种 gait 的倒地方式同为 'side'，速度、索敌、攻击判定都不经过 anim。
  // attack 描述为颌部撕咬 → strike:'bite'（A.anim.strike 的 bite 分支转 'jaw' 骨骼，下面 extend 里加了这根骨骼）

  build(ctx) {
    const hi = highDetail();
    return A.wrap(A.parts.humanoid({
      // 人的骨架比例：四肢细瘦嶙峋（thin 取高值），手臂略长于常人以便撑地（userOverride「长臂撑地」）
      height: H, pose: 'crawl', thin: 0.72, armLen: 1.08, headSize: 1.12,
      head: 'round', hands: true, feet: true, claws: 0, hair: 0,
      // head:'round' + hands + claws:0：保留「由人变形而来」的人头轮廓和五指手掌（detail:'high' 时构件自带手指）；
      // 爪子另在 extend 里按「磨钝」的形状加，不用构件那种细长尖爪
      detail: hi ? 'high' : 'low',
      colors: { body: 0x6b5d50, head: 0x6b5d50, fur: 0x0d0b09, glow: 0xffffff },
      // body/head：皮革色，选中版本未写体色，非设定（「其毛皮是后室里少数皮革来源之一」）；
      // fur：背上那条黑色蓬乱的毛；glow：白色发光眼
      look: { body: 'skin', head: 'skin', fur: 'fur' },
      key: 'hound_crawler_v2',   // 模型重做 → 换缓存键，否则同一页面里会复用旧的四足几何
      extend(b, d) {
        const hr = d.headR, hy = d.headY;
        const backZ = 0.055 * d.H;   // 躯干背面：绑定姿势下 +Z 是背，四肢着地姿势里转成朝上

        // ---- 1. 四肢着地的基础姿势（userOverride：长臂撑地、脊柱拱起、膝盖反向蜷曲着地）----
        // 构件自带的 pose:'crawl' 是「人跪爬」的近似，手脚都够不到地；这里把六组骨骼的基础姿势重写一遍
        // （extend 在构件的 crawl 姿势之后执行，setBase 覆盖它）。数值按「手掌与后足都落在 y≈0、肩高≈0.68」推出
        b.setBase('hips', 0, 0, 0, 0, -(d.hipY - 0.375 * d.H), 0);  // 髋落到爬行高度
        b.setBase('spine', -1.35);                                   // 躯干压到接近水平 → 脊柱拱起、肩胛顶出来
        b.setBase('head', 0.42);                                     // 头颈从躯干前端向前探出并低头（净 -0.93）：压低头顶、拉长前后身长
        b.setBase('armL', 1.35); b.setBase('armR', 1.35);            // 抵消躯干前倾 → 长臂垂直撑地，手掌落在 y≈0
        b.setBase('legL', -0.85); b.setBase('legR', -0.85);          // 大腿向后下，后半身拖在身后
        b.setBase('shinL', 1.55); b.setBase('shinR', 1.55);          // 小腿反折向前下、足尖点地 → 膝盖反向蜷曲着地（出图核对过足底不穿地板）

        // ---- 2. 肩胛突出（userOverride「肩胛突出」；fandom「四肢周围的皮肤肌肉变薄」）----
        // 躯干压平后两块肩胛从背上顶起来，是「四肢着地的人」最好认的一处剪影
        for (const s of [-1, 1]) {
          b.box('spine', 'body', [0.042 * d.H, 0.082 * d.H, 0.016 * d.H],
            [s * d.shoulderW * 0.58, d.shoulderY - 0.070 * d.H, backZ * 0.70], [0.20, 0, s * 0.24], { tint: BONE });
        }

        // ---- 3. 拱起的脊柱棘突（userOverride「脊柱拱起」）----
        // 一串沿脊柱顶出皮肤的小骨节，让拱背在侧面读得出来（上背被鬃毛盖住，所以只做到肩胛前）
        const spineA = d.hipY + 0.06 * d.H, spineB = d.shoulderY - 0.02 * d.H;
        const nv = hi ? 5 : 4;
        for (let i = 0; i < nv; i++) {
          const t = (i + 0.5) / nv, y = spineA + (spineB - spineA) * t * 0.78;
          b.cone('spine', 'body', [0, y, backZ * 0.70], [0, y + 0.010 * d.H, backZ * 1.02], 0.011 * d.H * (1 - 0.22 * t), 4, { tint: BONE });
        }

        // ---- 4. 肋骨（fandom「四肢细瘦嶙峋」「皮肤肌肉变薄」）----
        if (hi) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
          const y = d.shoulderY - (0.10 + i * 0.055) * d.H;
          b.limb('spine', 'body', [s * 0.012 * d.H, y + 0.012 * d.H, backZ * 0.75], [s * 0.075 * d.H, y - 0.018 * d.H, -0.03 * d.H],
            0.011 * d.H, 0.007 * d.H, 5, { tint: BONE });
        }

        // ---- 5. 背上一长条黑色蓬乱的毛（fandom「背上有一长条黑色蓬乱的毛，远处易辨认、易与人区分」）----
        // 改前是一排等距等长的硬尖锥，两名打分员都写「像恐龙背板 / 硬尖刺不像蓬乱毛发」：
        // 这里改成一簇一簇、长短角度都不一样的毛丛——中段最长两头收窄（「一长条」），左右外撇、向后倒伏
        const nm = 9, tuft = hi ? 4 : 1;
        for (let i = 0; i < nm; i++) {
          const t = i / (nm - 1);
          const y = d.hipY + 0.02 * d.H + (d.shoulderY + 0.05 * d.H - d.hipY - 0.02 * d.H) * t;
          const bone = t < 0.18 ? 'hips' : 'spine';
          // 毛比改前细一半、短一半：粗而等长的锥子读作「背板」，细而长短不一的才读作「蓬乱的毛」
          const len = (0.040 + 0.036 * Math.sin(t * 3.1)) * d.H;
          for (let k = 0; k < tuft; k++) {
            // 确定性的左右外撇与长短差（不用随机数：几何要按缓存键在所有实例间复用）
            const sx = (k - (tuft - 1) / 2) * 0.62 + (((i * 7) % 3) - 1) * 0.26;
            const ext = len * (0.62 + 0.38 * (((i * 5 + k * 3) % 4) / 3));
            // 毛梢主要沿脊柱向后倒（-Y），只稍微立起来（+Z）：出图实测竖着长就还是一排「背板」，
            // 倒伏着长才读成贴在背上的一长条毛
            b.cone(bone, 'fur', [sx * 0.020 * d.H, y, backZ * 0.9],
              [sx * 0.090 * d.H, y - ext * 0.95, backZ * 0.9 + ext * 0.52], 0.0072 * d.H, 4);
          }
        }

        // ---- 6. 满是尖牙的大张口腔（fandom「巨大张开的口腔内有多排牙齿，能撕开、锯开血肉和无机物」）----
        // 改前是一个闭合的方盒子只插 3 颗牙。这里加一根 jaw 骨骼：A.anim.strike 的 'bite' 分支专门转 'jaw'，
        // 平时用基础姿势让嘴常张着，咬下去的时候合上
        b.bone('jaw', 'head', [0, hy - hr * 0.28, hr * 0.32]);
        b.setBase('jaw', 0.34);
        // 上颚：人的头骨被獠牙撑长的一截口鼻（「人牙被獠牙取代」「头骨周围的皮肤肌肉变薄」）
        b.box('head', 'head', [hr * 0.74, hr * 0.42, hr * 1.25], [0, hy - hr * 0.26, -hr * 1.10]);
        // 下颌：挂在 jaw 骨骼上，比上颚略窄
        b.box('jaw', 'head', [hr * 0.64, hr * 0.26, hr * 1.18], [0, hy - hr * 0.64, -hr * 1.06]);
        // 多排牙齿：上下颚各 1–2 排，排成弧形，后排更靠里
        const rows = hi ? 2 : 1, perRow = hi ? 5 : 6;
        for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) {
          const u = i / (perRow - 1) - 0.5, tx = u * hr * 0.58;
          const tz = -hr * (1.52 - r * 0.50) + Math.abs(u) * hr * 0.42;
          // 牙比改前粗一半、长一半：改前 hr*0.09 粗 hr*0.34 长的小尖齿，出图上只是嘴下一排细密的梳齿
          const th = hr * (0.52 - r * 0.12) * (1 - 0.28 * Math.abs(2 * u));
          b.cone('head', 'head', [tx, hy - hr * 0.46, tz], [tx, hy - hr * 0.46 - th, tz], hr * 0.135, 3, { tint: TOOTH });
          b.cone('jaw', 'head', [tx, hy - hr * 0.78, tz], [tx, hy - hr * 0.78 + th * 0.92, tz], hr * 0.125, 3, { tint: TOOTH });
        }

        // ---- 7. 双眼白光 + 眼窝骨脊（fandom「眼睛闪着醒目的白光，在黑暗中远远就能认出」「眼睛失去色素」）----
        for (const s of [-1, 1]) {
          const ex = s * hr * 0.42;
          b.sphere('head', 'glow', 0.035, [ex, hy + hr * 0.16, -hr * 0.72], null, [6, 4]);   // 尺寸沿用改前的 0.035
          // 眼窝上缘的骨脊：把发光的眼睛压进眼窝里，不再是贴在光滑蛋壳上的两块白斑
          if (hi) b.box('head', 'head', [hr * 0.46, hr * 0.14, hr * 0.30], [ex, hy + hr * 0.40, -hr * 0.70], [0.25, 0, s * 0.18], { tint: BONE });
        }

        // ---- 8. 磨钝的爪（fandom「爪子通常因抓挠自己的脸而磨钝，严重的会露出周围骨头」）----
        // 末端不收成尖：用带粗头的圆台接在构件自带的手指末端，读作磨秃的指爪
        if (hi) for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * d.shoulderW;
          for (let c = 0; c < 3; c++) {
            const cz = (c - 1) * 0.019 * d.H - 0.020 * d.H;
            // 向前趴伏、几乎不再向下：手掌已经贴在地面上，爪子再往下扎就穿到地板底下去了
            b.limb('fore' + L, 'body', [x + s * 0.004 * d.H, d.handY - 0.082 * d.H, cz],
              [x + s * 0.010 * d.H, d.handY - 0.100 * d.H, cz - 0.026 * d.H], 0.009 * d.H, 0.007 * d.H, 4, { tint: CLAW });
          }
        }
      },
    }), { label: 'hound' });
  },
});
})();

// notImplemented（返回值里会再列一遍）：
// - 「许多个体跛行甚至完全不能跑」：速度上已用 run 只给到 jog 近似，但没做左右不对称的跛行步态——
//   基础姿势做成左右不对称会让某一只手/脚离地，四肢着地的贴地感比跛行更重要，留给后续动画能力。
// - 「爪子磨钝，严重的会露出周围骨头」只做了磨钝的钝爪，没做爪根外露的白骨。
// - 尾巴：改前用的四足构件带一条默认尾巴；本形态由人变形而来，fandom 的 appearance 也没有提尾巴，去掉了。
