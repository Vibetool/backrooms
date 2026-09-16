// 钝人 Duller（Entity 6）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-6  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
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

const HEIGHT = 2.3;
const THIN = 0.85;
const HUNCH = 0.25;

// 顶点色 tint：全部叠在已有的 body / head 两个槽位里，不新增材质槽位、不增加 draw call
const BONE = [1.45, 1.42, 1.38];     // 薄皮下顶出来的骨头：深灰提亮一档（「骨架脆弱」）；再亮就成了白瓷娃娃的球关节
const HOLLOW = [0.70, 0.70, 0.74];   // 凹陷处的阴影：比体色暗一点点就够，压太黑会在无面头上读出一张脸

A.register({
  type: 'duller', en: 'Duller', zh: '钝人', version: 'wikidot-en',
  faction: 'hostile',   // 依据：hostility = hostile

  // 依据："身体比外表看起来强壮得多"（即使扛着两倍自重的物品也能全速奔跑）→ 耐久按"强壮"给，
  // "骨架脆弱"是 appearance 一段对外观（体型观感）的描述，放进外形而非 HP
  hp: A.HP.sturdy,
  radius: 0.4, height: 2.3,   // 依据：appearance/size 只写"高大(tall)"，无具体数字，取比玩家更高一截的游戏性数值，非设定
  speed: {
    walk: A.SPEED.walk,     // 未被发现时的日常游荡速度，选中版本未写，游戏性默认值
    run: A.SPEED.sprint,    // 依据："能以极高速度奔跑，即使拿着两倍于自身体重的物品也一样"→ 对应"比人快、跑不掉"档
  },
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 150, needsLight: false, avoidsLight: false }, // 依据：senses 标注 unverified，感知给默认值
  attack: {
    hp: A.DAMAGE.medium,     // 依据："怎样杀死猎物并不完全清楚（因为它们通常逃离威胁）"——杀死方式未记载，取中等伤害作为游戏性默认值，非设定
    sanity: 0,                 // 依据：sanityEffect 标注 unverified，不填
    range: 1.6,                  // 依据："手臂很长，可以伸到很远"→ 长臂抓取，取长臂档上限
    cooldown: A.COOLDOWN.slow,  // 依据："抓住另一侧的猎物，拖进自己所在的走廊"——抓、拖两段过程，对应"抓住后撕扯→slow"
  },
  // 选中版本没写 sanityEffect（unverified）→ 不加 aura
  // 选中版本没写具体叫声（appearance/behavior 均未提声音）→ 不加 sounds

  // 行为：巡逻游荡；发现目标后追击、够得着就抓。
  // 说明：原文另有"隔墙伸手拽人"的穿墙抓取战术，以及"非狩猎状态下被目击会无声逃走"/"故意冲向它会把它吓退"两条回避行为，
  // 均未实现，原因见下方 notImplemented——不用骨架的 gaze（玩家直视）机制近似，是因为预览/游玩相机通常正对着实体以便看清画面，
  // 套用 gaze 会让它在验收测试里持续处于"被注视→后退"，导致永远追不上测试人，不满足"有害实体必须能攻击测试人"的硬性验收要求。
  brain: A.stalker({ patrol: 'wander', patrolRadius: 16, alertSec: 0.4, searchSec: 8 }),
  anim: {
    gait: 'biped',
    twitch: 0.16,     // 依据："站姿摇晃，走路动作不自然"
    strike: 'grab',    // 依据：攻击是"抓住猎物"
    recoil: 0.2,
  },

  build(ctx) {
    const hi = highDetail();
    return A.wrap(A.parts.humanoid({
      height: HEIGHT, thin: THIN, hunch: HUNCH,   // 依据："骨架脆弱"→ 用较高的 thin 表现外观上的瘦削感（HP 另按体格强壮给，二者互不冲突）
      armLen: 1.9,                                 // 依据："手臂很长，可以伸到很远"
      head: 'faceless',                            // 依据："没有脸和耳朵等显著特征"；构件的人形头部本就不带耳朵几何，无需额外处理
      hands: true, feet: true, claws: 0, hair: 0,
      detail: hi ? 'high' : 'low',
      colors: { body: 0x3a3a3d },   // 依据："深灰色的人形"；appearance 未提发光部位，不加 glow
      look: { body: 'skin', head: 'skin' },
      // look.head 显式给 'skin'：改前头部走默认的 lambert（光滑蛋壳），和躯干的皮肤质感对不上，
      // 两名打分员都写「头是光滑蛋」。质感统一后，无面头才读得出是同一层皮包着骨头
      key: 'duller_v3',   // 加了 extend 的形状 → 新缓存键；以后再改形状继续往上加版本号
      // v2 → v3：返修改了末节指骨的方向（收回 Z）和整个低画质分支（3 段锥换 [3,2] 椭球），形状变了必须换键
      extend(b, d) {
        const H = d.H, hr = d.headR, shY = d.shoulderY, sw = d.shoulderW;

        // ---- 1. 摇晃不自然的站姿（locomotion「站姿摇晃，走路动作不自然」）----
        // 构件的 hunch:0.25 给 spine 的基础姿势是 (-0.8*h, 0, 0)、head 是 (0.6*h, 0, 0)、armR 是 (0.55*h, 0, 0)；
        // 这里保留原来的 x 分量（佝偻不变），只补上左右不对称的侧倾／歪头／单侧垂臂，静止画面里也看得出站不稳
        b.setBase('spine', -0.8 * HUNCH, 0, 0.015);
        b.setBase('head', 0.6 * HUNCH, 0.08, -0.060);
        b.setBase('armR', 0.55 * HUNCH + 0.09);

        if (!hi) {
          // 低画质：全部改用 [3, 2] 分段的椭球。这是 RigBuilder 里最省面的图元，每个只有 6 面
          //（上下两圈各 3 面，极点那一圈退化掉了），比 3 段锥的 12 面（侧面 6 + 两端封盖各 3）省一半，
          // 同样的面数余量能摆下两倍的形状。两条硬指标：low 面数 ≤ 改前 ×1.1 = 576（改前 524 面），
          // 图元数 ≥ 改前 ×1.4 = 22.4。8 个椭球 = 48 面 / +8 图元 → 572 面、24 图元，两条同时满足
          //（上一版 4 根 3 段锥同样是 48 面，但只有 20 图元，差在 ×1.4 那条上）。
          // 形状沿用高画质版同一套「骨架脆弱」的读法：锁骨 + 肩峰给肩部轮廓，肘 / 膝的骨节给
          //「细棍上串着骨节」，剪影上都看得出来
          for (const s of [-1, 1]) {
            const L = s < 0 ? 'L' : 'R';
            // 锁骨：沿肩线拉长的椭球，从胸口顶到肩峰
            b.sphere('spine', 'body', 0.010 * H, [s * sw * 0.52, shY - 0.008 * H, -0.020 * H], [4.2, 0.85, 1.25], [3, 2], { tint: BONE });
            // 肩峰：肩头顶出来的一颗骨节
            b.sphere('arm' + L, 'body', 0.020 * H, [s * sw * 0.95, shY + 0.004 * H, 0], [1.15, 0.80, 1], [3, 2], { tint: BONE });
            // 肘、膝：比四肢本身还粗的关节球（构件只在 detail:'high' 给关节球，低画质原本是光秃的圆柱）。
            // 肘的 x 半径取 0.020H×1.10，和上一版 3 段锥的最宽处一样，低画质包围盒宽度不变
            b.sphere('fore' + L, 'body', 0.020 * H, [s * sw, d.elbowY, 0], [1.10, 0.80, 1.05], [3, 2], { tint: BONE });
            b.sphere('shin' + L, 'body', 0.026 * H, [s * d.hipW, d.kneeY, 0], [1.10, 0.85, 1], [3, 2], { tint: BONE });
          }
          return;
        }

        // ---- 2. 无脸头部的平滑凹陷（appearance「没有脸和耳朵等显著特征」）----
        // 选中版本只说没有脸，没有描述任何五官，所以不加眼睛和嘴：只在该长脸的那一面压出一块平滑的暗凹陷，
        // 上下各一道略亮的骨脊框住它——亮脊 + 暗碟读作「脸整个塌进去了」，而不会读成一张脸
        // 只留这一块平滑的暗凹陷，不加任何框边：出图实测过，凹陷上下再各加一道亮骨脊，
        // 立刻被读成「眉骨 + 嘴」，等于给无面的头安了一张脸，和选中版本「没有脸」冲突
        b.sphere('head', 'head', hr * 0.86, [0, d.headY - hr * 0.02, -hr * 0.60], [1.00, 1.30, 0.42], [10, 8], { tint: HOLLOW });

        // ---- 3. 脖颈与肩的骨感起伏（appearance「骨架脆弱」）----
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R';
          // 锁骨：从胸口斜拉到肩峰
          b.limb('spine', 'body', [s * 0.012 * H, shY - 0.012 * H, -0.030 * H], [s * sw * 0.92, shY - 0.004 * H, -0.012 * H],
            0.012 * H, 0.009 * H, 5, { tint: BONE });
          // 肩峰：肩头顶出来的一颗骨节，比构件自带的肩关节球更高更靠外
          b.sphere('arm' + L, 'body', 0.022 * H, [s * sw * 0.90, shY + 0.006 * H, 0], [1, 0.72, 0.95], [6, 5], { tint: BONE });
          // 颈侧凹沟：斜方肌塌下去的一条暗沟，把细脖子和骨感的肩连起来
          b.limb('head', 'body', [s * 0.022 * H, shY + 0.022 * H, 0.008 * H], [s * 0.034 * H, shY - 0.030 * H, 0.012 * H],
            0.010 * H, 0.016 * H, 5, { tint: HOLLOW });
        }

        // ---- 4. 肋骨与髂嵴（appearance「骨架脆弱」）----
        for (const s of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const y = shY - (0.055 + i * 0.045) * H;
            b.limb('spine', 'body', [s * 0.014 * H, y + 0.010 * H, -0.035 * H], [s * 0.072 * H, y - 0.014 * H, 0.012 * H],
              0.010 * H, 0.007 * H, 5, { tint: BONE });
          }
          b.sphere('hips', 'body', 0.028 * H, [s * d.hipW * 1.35, d.hipY + 0.045 * H, 0], [0.70, 1, 1.10], [6, 5], { tint: BONE });
        }

        // ---- 5. 脆弱的关节（appearance「骨架脆弱」）----
        // 关节球比四肢本身还粗，读作「细棍上串着一串骨节」，这是「脆弱」在静止画面里最直接的表现
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * sw, hx = s * d.hipW;
          b.sphere('fore' + L, 'body', 0.026 * H, [x, d.elbowY, 0], [1.15, 0.80, 1.05], [6, 5], { tint: BONE });          // 肘
          b.sphere('fore' + L, 'body', 0.020 * H, [x, d.handY + 0.030 * H, 0], [1.10, 0.75, 1], [6, 4], { tint: BONE });  // 腕
          b.sphere('shin' + L, 'body', 0.030 * H, [hx, d.kneeY, 0], [1.10, 0.85, 1], [6, 5], { tint: BONE });             // 膝
          b.sphere('shin' + L, 'body', 0.022 * H, [hx, 0.075 * H, -0.008 * H], [1, 0.80, 1], [6, 4], { tint: BONE });     // 踝
        }

        // ---- 6. 过长手臂末端的细长手指（appearance「手臂很长，可以伸到很远」）----
        // 构件在 detail:'high' 自带的四根手指从 handY-0.085H 长到 handY-0.035H；这里给每根再接一节更细的指骨，
        // 交界处加一颗指节骨球。手指跟着超长的手臂一起拉长，"伸到很远"才有着落。
        // 接出去的方向是**向掌心内扣**、不是继续向下、也不是向前伸：
        // - 向下接会整段扎进地板：armLen 1.9 已经让手垂到脚边（改前包围盒 miny 就是 -0.027），出图实测 miny -0.178。
        // - 向前伸（上一版末节前伸 0.038H）会把整个模型的 Z 撑出去：包围盒 Z 0.491 → 0.564（+14.9%），
        //   超出「包围盒偏差 ≤10%」。指尖伸到身体前方，侧视图上指认得出来。
        // 现在末节前伸减半到 0.019H，剩下的长度改成朝掌心（身体内侧）扣，指尖收回到大腿外侧、不再探到身前，
        // 既保住「手指跟着长手臂一起拉长」的第二节指骨和指节骨球（图元数不变），又把 Z 收回到 +10% 以内。
        // 不动 armLen——那是「手臂很长，可以伸到很远」这条设定依据本身
        const th = 1 - 0.45 * THIN, fw = 0.011 * H * th;
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * sw;
          for (let i = 0; i < 4; i++) {
            const fz = (i - 1.5) * 0.017 * H - 0.020 * H;
            b.limb('fore' + L, 'body', [x, d.handY - 0.085 * H, fz], [x - s * 0.009 * H, d.handY - 0.094 * H, fz - 0.019 * H], fw * 0.52, fw * 0.34, 4);
            b.sphere('fore' + L, 'body', fw * 0.62, [x, d.handY - 0.085 * H, fz], null, [5, 4], { tint: BONE });
          }
          // 拇指：也接一节，朝身体内侧
          b.limb('fore' + L, 'body', [x + s * 0.020 * H, d.handY - 0.020 * H, 0.025 * H], [x + s * 0.032 * H, d.handY - 0.058 * H, -0.006 * H], fw * 0.50, fw * 0.32, 4);
        }
      },
    }), { label: 'duller' });
  },
});
})();

// notImplemented（返回值里会再列一遍）：
// - "手臂 no-clip 穿过墙壁、抓住另一侧的猎物拖进自己的走廊"：引擎没有穿墙攻击，近战照常要够得着；
//   只用加长的 attack.range 近似长臂抓取。
// - "非狩猎状态被目击就无声逃走""故意冲向它会把它吓退"：见上方 brain 注释里的验收冲突，未实现。
// - "回避杏仁水喷泉及杏仁水相关物品"：实体侧没有对物品／场景物的回避机制，未实现。
// - "有时会拿走看似随机的物品"：没有实体拾取／携带物品的机制，未实现。
// - 外形上未做：appearance 没写手指数量、皮肤质感、发光部位，本文件只按"深灰色、无脸无耳、骨架脆弱、
//   手臂很长"四条落实形状，不从 fandom 版（皱皮、紫色血肉、融化的脸）借任何细节。
