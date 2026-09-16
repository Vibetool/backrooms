// 窃皮者 Skin-Stealer（Entity-10）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-10  许可：CC BY-SA 3.0
// 只按 wikidot-en 版本实现；fandom 的「继承宿主记忆」「尖爪附肢」「深米色」等细节属于其他版本，不借用（WAVE2.md 第1节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 真身头部 head 槽位的基色（build() 的 colors.head 用它）。"深陷白眼"的白眼珠和暗色眼窝都靠 tint 从这个浅黄色
// 精确换算到目标色（tint = 目标分量 / 基色分量），不新增材质槽位；共用同一个常量，改肤色时眼睛跟着换算，不会脱节
const HEAD_HEX = 0xe6d6a3;
function tintTo(base, target) {
  const c = (hex, shift) => (hex >> shift & 255) / 255;
  return [c(target, 16) / c(base, 16), c(target, 8) / c(base, 8), c(target, 0) / c(base, 0)];
}
const EYE_WHITE = tintTo(HEAD_HEX, 0xffffff);
const EYE_SOCKET = tintTo(HEAD_HEX, 0x3a3024);   // 眼窝：暗灰褐，读作"凹进去的阴影"，不用纯黑，免得像贴了块黑片

// ---------- M2 打磨第 1 批（2026-09-16）：吸盘状凸起 + 眼窝骨脊 ----------
// 依据（选中版本 appearance 原文）：「外层皮肉布满微小凸起，类似章鱼触手上的吸盘」。
// M1 只用 skin 材质的斑驳纹理近似这句话，出图上完全看不出有凸起（两名打分员都写"看不到吸盘状凸起"），
// 所以这次按"章鱼触手上的吸盘"的排列方式把凸起建成形状：前臂沿肢体成两列（触手上的吸盘就是成列排布），
// 上臂 / 肩 / 胸腹 / 背 / 大腿 / 小腿 / 手背 / 颈 / 脸颊各一小片，说明凸起是"布满"外层皮肉、不只长在手臂上。
// 全部叠在人形已有的 body / head 槽位上，用顶点色 tint 分色，不新增材质槽位、不多 draw call。
// 明暗差（2026-09-16 返修）：吸盘只有 1.5 cm，原尺寸下靠轮廓根本读不出来（复评实测整张图只差 0.28% 像素），
// 加大半径又会把"微小凸起"做成瘤子，所以改成靠明暗读——亮边和吸孔的对比从 2.2 倍拉到 3.8 倍
const SUCK_RIM = [1.30, 1.26, 1.14];   // 吸盘鼓起的边缘：比皮肤明显提亮，侧光下一颗颗读得出来
const SUCK_PIT = [0.34, 0.30, 0.26];   // 吸盘中央的吸孔：压到近乎暗点，几米外也是皮肤上的一粒粒暗心
const BROW = [1.09, 1.07, 1.01];       // 眉弓 / 下眼睑骨脊：提亮，和暗色眼窝拉出明暗差
// 人形构件里算肢体半径用的 th（_archetypes.js buildHumanoid：th = (1 - 0.45·thin)·bulk），
// 吸盘要贴在肢体表面上，必须用同一套参数算半径，所以 thin / bulk 提成常量，下面 humanoid() 也用它们
const BULK = 1.2, THIN = 0.15;
const TH = (1 - 0.45 * THIN) * BULK;
const AX = 0.92, AY = 1.08, AZ = 0.98;   // humanoid 圆头椭球的三轴缩放（head:'round'）

const lerp = (a, b, t) => a + (b - a) * t;

// 竖直肢体（手臂 / 腿 / 颈）表面上的一点：轴心 (x0, z0)、该高度的半径 r、方位角 az（0 = 正前方，正值偏 +X）
function limbPt(x0, z0, y, r, az) {
  const nx = Math.sin(az), nz = -Math.cos(az);
  return { p: [x0 + nx * r, y, z0 + nz * r], n: [nx, 0, nz] };
}
// 躯干椭圆截面（x 半轴 a、z 半轴 c）上的一点：side = -1 正面、+1 背面
function ovalPt(x, y, a, c, side) {
  const t = Math.min(1, Math.abs(x) / a);
  const z = side * c * Math.sqrt(Math.max(0, 1 - t * t));
  const n = [x / (a * a), 0, z / (c * c)];
  const L = Math.hypot(n[0], n[2]) || 1;
  return { p: [x, y, z], n: [n[0] / L, 0, n[2] / L] };
}
// 头部椭球（中心 [0, headY, 0]、半轴 [AX, AY, AZ]·hr）表面上的一点：ux / uy 是头部局部坐标（按 hr 计），脸朝 -z
function headPt(hr, headY, ux, uy) {
  const ez = AZ * Math.sqrt(Math.max(0, 1 - (ux / AX) ** 2 - (uy / AY) ** 2));
  const n = [ux / (AX * AX), uy / (AY * AY), -ez / (AZ * AZ)];
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return { p: [ux * hr, headY + uy * hr, -ez * hr], n: [n[0] / L, n[1] / L, n[2] / L] };
}
// 一颗吸盘：球心沿外法线往皮肉里埋 0.55r，只露出一个小圆顶（不是整颗球贴在外面）；
// pit 为真时中央再顶出一颗更小的暗色球，就是吸盘中间那个孔
function sucker(b, bone, slot, q, r, seg, pit) {
  const p = q.p, n = q.n;
  const cx = p[0] - n[0] * r * 0.48, cy = p[1] - n[1] * r * 0.48, cz = p[2] - n[2] * r * 0.48;
  b.sphere(bone, slot, r, [cx, cy, cz], null, seg, { tint: SUCK_RIM });
  // 吸孔往外再顶一点（0.2r → 0.26r）：埋得浅一点，正面看得到的是暗心而不是被亮边挡住的一圈影子
  if (pit) b.sphere(bone, slot, r * 0.42, [cx + n[0] * r * 0.26, cy + n[1] * r * 0.26, cz + n[2] * r * 0.26], null, [4, 2], { tint: SUCK_PIT });
}

A.register({
  type: 'skin_stealer', en: 'Skin-Stealer', zh: '窃皮者', version: 'wikidot-en',
  // hostility = varies。依据 _TEMPLATE.md 第3节判断规则：「常态下(饥饿、领地、看见人)就会主动伤人→hostile」，
  // 选中版本原文「饥饿时会寻找落单的人」正属于「饥饿」这一列举情形 → 取 hostile；
  // 「通常温顺，不需进食时漫无目的地游荡，此阶段除非被激怒否则不敌对」这段温顺期不靠改 faction 表达，
  // 而是用下面拟态骨架的伪装/现形状态来体现（不为此改 faction，第3节末尾原则的同理应用）
  faction: A.faction('varies', 'hostile'),

  hp: A.HP.average,          // 选中版本未提自身耐久，非设定默认值
  radius: 0.4, height: 2.0,  // 依据：「高大(tall)」，size 无具体数字(unverified)，取比人略高的默认值，非设定精确数字
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },   // locomotion/speed 均 unverified（页面无数据），取默认值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150 },
  // senses:unverified（页面未描述感官）→ 人形默认档，非设定
  attack: { hp: A.DAMAGE.lethal, sanity: 0, range: 1.0, cooldown: A.COOLDOWN.slow },
  // 依据：「饥饿状态下…用力量徒手将其撕碎」→「撕碎」对应数值表「一击致命/撕碎→lethal」；
  // 徒手抓撕后收势较慢 → cooldown 取 slow；sanityEffect: unverified，不写理智伤害
  sounds: { attack: 'hit' },
  // 依据：徒手撕碎用通用命中音；拟态实体不写 sounds.alert（第5.5节：锁定目标那一刻播放会当场穿帮伪装）

  brain: A.mimic({
    revealRange: 3, revealOnHit: true, disguise: 'wander', redisguiseSec: 15,
    talk: { sound: 'whisper', range: 10, cooldown: 7 },
  }),
  // 依据：「伪装方式：将撕下的人皮吸附贴合…看起来和真人一模一样」→ 拟态骨架；
  // 「通常温顺，不需进食时漫无目的游荡，此阶段除非被激怒否则不敌对」→ disguise:'wander'（只有目标自己走近才现形，不会主动接近），revealOnHit:true（被激怒后反击）；
  // 「饥饿时会寻找落单的人」用 revealRange 近似"遇到落单的人就现形猎杀"——选中版本没给具体的温顺期/饥饿期时长数字，无法做真实的周期性计时状态机；
  // 现形后按追猎者状态追杀，丢失目标 redisguiseSec 秒后恢复伪装，相当于自然循环回"温顺游荡"，非精确还原饥饿周期；
  // 「智力有限，不理解语言，只会重复听到的话（常为多种语言）来引诱猎物」→ 用 whisper 预设声音近似"低语学舌"，
  // 引擎没有真正的语音复读/多语言台词系统，只能用固定音效代替，写进 apiRequests
  anim: { gait: 'biped', strike: 'grab' },
  // 依据：「用力量徒手将其撕碎」→ strike 用 grab(抓取撕扯)而非 swipe/bite

  build(ctx) {
    // detail 与 _archetypes.js 的 resolveDetail 同一口径、同一时刻解析（humanoid() 也在这一刻按 settings.quality 解析），
    // 所以下面的 hi 和构件自己解析出来的 detail 一定一致；detail 本身进几何缓存键，高低画质不会互相顶掉缓存
    const hi = !(BR.game && BR.game.settings && BR.game.settings.quality === 'low');
    return A.wrap({
      disguise: A.parts.hazmat(ctx),
      // 依据：「看起来和真人一模一样」→ 直接用测试人/玩家外形构件（第6.5节：拟态成人的标准做法）
      true: A.parts.humanoid({
        height: 2.0, bulk: BULK, thin: THIN, head: 'round', claws: 0, hair: 0,
        // 依据：「用力量徒手撕碎」→ 略偏壮(bulk)；未提爪子/毛发 → claws:0, hair:0；
        // 只说眼窝深陷、发白，不是无脸，头部仍用普通 head:'round'
        colors: { body: 0xdcc478, head: HEAD_HEX, glow: 0xffffff },
        // 依据：「高大、淡黄色(pale yellow)的人形」→ body 取淡黄色；头部略调浅表现「眼睛深陷、白色」的苍白感
        look: { body: 'skin', head: 'skin' },
        // 依据：「外层皮肉布满微小凸起，类似章鱼触手上的吸盘」→ skin 材质的斑驳纹理打底，凸起本身在 extend 里建成形状
        key: 'skin_stealer_true_v4',   // extend 的形状 / tint 变了就换键：几何缓存按键取，不换会拿到旧模型（v2 = M1 的眼睛，v3 = M2 加吸盘与眼窝骨脊，v4 = 吸盘明暗加大）
        extend(b, d) {
          const T = window.THREE, hr = d.headR, H = d.H;
          // ---------- 深陷的非发光白眼 ----------
          // 依据（wikidot-en/cn）：「眼睛深陷、白色」／「深深凹陷的白色眼睛」；原文没提发光，
          // 复用 head 槽位（skin 材质受场景光照，天然"非发光"，不新增材质槽位 / draw call）。
          // 这套构件是形状互相叠加，挖不了洞，"深陷"用颜色表现：脸上先贴一片压扁的暗色眼窝（EYE_SOCKET），中间再嵌一颗
          // 压扁的白眼珠（EYE_WHITE），两片都顺着脸部曲面的法线摆、只探出表面一点点，看起来是阴影里的一颗白眼，而不是凸出来的眼珠。
          // 第一版（半径 0.1·hr 的小白球大半埋进头里）全身出图只差 63 个像素，6 m 外看不见，所以放大并加了眼窝
          const EX = 0.32, EY = 0.05;
          const ES = hi ? [8, 5] : [6, 4];   // 低画质把两片眼睛的分段降一档：40 px 见方的小片看不出差别，省下的面数留给吸盘
          const ez = AZ * Math.sqrt(1 - (EX / AX) ** 2 - (EY / AY) ** 2);
          for (const s of [-1, 1]) {
            const p = new T.Vector3(s * EX * hr, d.headY + EY * hr, -ez * hr);
            const n = new T.Vector3(s * EX / (AX * AX), EY / (AY * AY), -ez / (AZ * AZ)).normalize();
            const yaw = Math.atan2(-n.x, -n.z);   // 绕 y 转 yaw 后，局部 -z 轴对准法线的水平分量
            // r：沿脸面的半径；sy：竖向压扁；depth：沿法线的半厚；proud：最前端探出理想表面多少（都按 hr 计）
            const disc = (r, sy, depth, proud) => new T.SphereGeometry(r * hr, ES[0], ES[1]).scale(1, sy, depth / r).rotateY(yaw)
              .translate(p.x + n.x * (proud - depth) * hr, p.y + n.y * (proud - depth) * hr, p.z + n.z * (proud - depth) * hr);
            b.geo('head', 'head', disc(0.24, 0.8, 0.07, 0.01), { tint: EYE_SOCKET });
            b.geo('head', 'head', disc(0.14, 0.8, 0.06, 0.025), { tint: EYE_WHITE });
            // 眉弓与下眼睑的骨脊（high）：光靠颜色只有正脸特写看得出"深陷"，加两道骨脊之后，
            // 侧面轮廓上眼窝也是一道凹槽，正面被上下两条亮边夹着，暗色眼窝读起来就是陷进去的
            if (hi) {
              const brow0 = headPt(hr, d.headY, s * 0.12, 0.36), brow1 = headPt(hr, d.headY, s * 0.55, 0.26);
              const lid0 = headPt(hr, d.headY, s * 0.14, -0.2), lid1 = headPt(hr, d.headY, s * 0.5, -0.12);
              const out = (q, k) => [q.p[0] + q.n[0] * k, q.p[1] + q.n[1] * k, q.p[2] + q.n[2] * k];
              b.limb('head', 'head', out(brow0, hr * 0.03), out(brow1, hr * 0.03), hr * 0.075, hr * 0.055, 5, { tint: BROW });
              b.limb('head', 'head', out(lid0, hr * 0.02), out(lid1, hr * 0.02), hr * 0.055, hr * 0.04, 5, { tint: BROW });
            }
          }

          // ---------- 吸盘状凸起 ----------
          // 依据：「外层皮肉布满微小凸起，类似章鱼触手上的吸盘」。半径按身高缩放，低画质只留前臂两列（最像触手的位置）
          const SEG = [4, 2];   // 一颗吸盘 8 个三角面：3 m 内也就十来个像素宽，再细分纯属浪费预算
          const rFore = 0.0078 * H, rArm = 0.0085 * H, rBody = 0.009 * H, rHead = 0.006 * H;
          // 手臂：上臂 [shoulderY-0.005H → elbowY] 半径 0.03·H·th → 0.024·H·th；前臂 [elbowY → handY+0.02H] 0.024 → 0.018
          const armTopY = d.shoulderY - 0.005 * H, foreBotY = d.handY + 0.02 * H;
          const rA0 = 0.03 * H * TH, rA1 = 0.024 * H * TH, rF1 = 0.018 * H * TH;
          for (const s of [-1, 1]) {
            const L = s < 0 ? 'L' : 'R', x = s * d.shoulderW;
            // 前臂两列吸盘：章鱼触手上的吸盘就是顺着肢体成列排布，这是全身最像"章鱼吸盘"的一处
            for (const c of [-1, 1]) for (let i = 0; i < (hi ? 3 : 2); i++) {
              const t = hi ? 0.18 + i * 0.3 : 0.28 + i * 0.36;
              const y = lerp(d.elbowY, foreBotY, t), r = lerp(rA1, rF1, t);
              sucker(b, 'fore' + L, 'body', limbPt(x, 0, y, r, c * 0.55), rFore, SEG, hi);
            }
            if (!hi) {
              // 低画质只再补上臂两颗，够看出"手臂上一串疙瘩"就行
              for (const c of [-1, 1]) sucker(b, 'arm' + L, 'body', limbPt(x, 0, lerp(armTopY, d.elbowY, 0.55), lerp(rA0, rA1, 0.55), c * 0.5), rArm, SEG, false);
              continue;
            }
            for (const c of [-1, 1]) for (let i = 0; i < 2; i++) {
              const t = 0.3 + i * 0.36;
              const y = lerp(armTopY, d.elbowY, t), r = lerp(rA0, rA1, t);
              sucker(b, 'arm' + L, 'body', limbPt(x, 0, y, r, c * 0.5), rArm, SEG, false);
            }
            // 肩头一颗（肩关节球半径 0.031·H·th）
            sucker(b, 'arm' + L, 'body', limbPt(x, 0, armTopY + 0.008 * H, 0.031 * H * TH, s * 0.45), rArm, SEG, false);
            // 手背两颗：徒手撕碎猎物的那只手上也有凸起（手套状的手是 0.035·H·th+0.01 宽的方块）
            for (let i = 0; i < 2; i++) {
              const hy = d.handY - 0.005 * H + (i ? 0.022 * H : -0.012 * H);
              sucker(b, 'fore' + L, 'body', { p: [x + s * 0.004 * H, hy, -(0.025 * H * TH + 0.005)], n: [0, 0, -1] }, rFore * 0.85, SEG, false);
            }
            // 大腿两颗 + 小腿一颗（大腿 0.042→0.033·H·th，小腿 0.032→0.022·H·th）
            const hx = s * d.hipW;
            for (let i = 0; i < 2; i++) {
              const t = 0.25 + i * 0.4;
              sucker(b, 'leg' + L, 'body', limbPt(hx, 0, lerp(d.hipY, d.kneeY, t), lerp(0.042, 0.033, t) * H * TH, s * 0.55), rBody * 0.9, SEG, false);
            }
            sucker(b, 'shin' + L, 'body', limbPt(hx, 0, lerp(d.kneeY, 0.045 * H, 0.35), lerp(0.032, 0.022, 0.35) * H * TH, s * 0.5), rBody * 0.8, SEG, false);
          }
          // 躯干：胸腹一片、背上一片。躯干中段是 waistY→chestY 的圆台，截面按 flat=0.72 压扁
          const waistY = lerp(d.hipY + 0.05 * H, d.shoulderY + 0.02 * H, 0.34);
          const chestY = lerp(d.hipY + 0.05 * H, d.shoulderY + 0.02 * H, 0.8);
          const waistR = 0.062 * H * TH, chestR = 0.108 * H * TH;
          const bodyAt = y => { const t = Math.min(1, Math.max(0, (y - waistY) / (chestY - waistY))); return lerp(waistR, chestR, t); };
          const FRONT = [[-0.035 * H, 0.75], [0.035 * H, 0.66], [0, 0.5], [-0.05 * H, 0.38], [0.045 * H, 0.3]];
          for (const f of FRONT) {
            const y = lerp(waistY, chestY, f[1]), a = bodyAt(y);
            if (!hi && FRONT.indexOf(f) > 2) break;
            b.sphere('spine', 'body', rBody, (q => [q.p[0] - q.n[0] * rBody * 0.55, q.p[1], q.p[2] - q.n[2] * rBody * 0.55])(ovalPt(f[0], y, a, a * 0.72, -1)), null, SEG, { tint: SUCK_RIM });
          }
          if (hi) {
            for (const f of [[-0.04 * H, 0.72], [0.04 * H, 0.6], [-0.02 * H, 0.44], [0.05 * H, 0.34]]) {
              const y = lerp(waistY, chestY, f[1]), a = bodyAt(y);
              const q = ovalPt(f[0], y, a, a * 0.72, 1);
              b.sphere('spine', 'body', rBody * 0.9, [q.p[0] - q.n[0] * rBody * 0.5, q.p[1], q.p[2] - q.n[2] * rBody * 0.5], null, SEG, { tint: SUCK_RIM });
            }
            // 颈两侧各一颗（脖子是 0.028·H·th 的细圆台）
            for (const s of [-1, 1]) sucker(b, 'head', 'body', limbPt(0, 0, d.shoulderY + 0.02 * H, 0.027 * H * TH, s * 1.15), rHead, SEG, false);
          }
          // 脸颊 / 太阳穴：说明凸起"布满"外层皮肉，连脸上都有，头部特写镜头里看得见
          const CHEEK = hi ? [[0.52, -0.42], [0.66, -0.06]] : [[0.56, -0.3]];
          for (const s of [-1, 1]) for (const c of CHEEK) sucker(b, 'head', 'head', headPt(hr, d.headY, s * c[0], c[1]), rHead, SEG, false);
        },
      }),
    }, { form: 'disguise', label: 'skin_stealer' });
  },
});
})();
