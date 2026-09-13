// 啼物 Growlers（Entity 82）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Entity_82  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
// 注：fandom 页面上这只实体编号是 82，不是 wikidot 版本里的 130——只用选中版本自己的编号
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 局部小工具：给每个实例算一个稳定的随机色相（同一 entity id 在房主/客机两端算出的结果一致）。
// 依据："颜色随机，部分由遗传决定，每只个体的配色不同"——不能用 Math.random()（build 两端都跑，两端结果要一致），
// 用 entity id 做种子的确定性哈希代替，纯局部函数，不改 _archetypes.js。
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hslToHex(h, s, l) {
  const k = n => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = x => Math.round(x * 255);
  return (to255(f(0)) << 16) | (to255(f(8)) << 8) | to255(f(4));
}

A.register({
  type: 'growler', en: 'Growlers', zh: '啼物', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.average,       // 依据：选中版本未记载 HP/耐久，取游戏性默认值，非设定
  // 依据：size "大小不一，最常见约2米高"；它是一团没有固定形态的电线，不是直立生物，
  // radius 按"2米"整体团块规模的一半估算，height 参照四足姿态给一个矮团的游戏性数值（同类构型参照猎犬示范 0.4/0.9 的比例）
  radius: 0.5, height: 0.9,
  speed: {
    walk: A.SPEED.slow,   // 依据："移动缓慢（slow-moving）"
    // 依据：核心机制是"声波让猎物像喝醉一样变慢，好让这只慢速生物追上"——引擎没有让目标减速的接口（见 apiRequests），
    // 无法复刻"用减速追上"的效果；为了不让它变成完全追不上任何人的摆设，给突袭冲刺一个仍然低于玩家正常步行(3.0)的速度，
    // 这样"够快够远就能摆脱它"的原文弱点依然成立——这是游戏性折中，不代表设定数字
    run: A.SPEED.walk,
  },
  perception: {
    sight: A.SIGHT.dim,     // 依据：外形描述完全没提眼睛，只说"靠听觉发现附近猎物"→ 视觉给较弱档，非精确设定
    hearing: A.HEARING.acute, // 依据："靠听觉发现附近猎物"是其主要感知手段
    fov: 300, needsLight: false, avoidsLight: false,
  },
  attack: {
    hp: A.DAMAGE.medium,    // 依据："具体击杀方式 unverified"——杀死方式未记载，取中等伤害作为游戏性默认值
    sanity: 8,                // 依据：sanityEffect "声波造成的心灵干扰让猎物动作迟缓、像醉酒"——效果本身(减速)做不到，
                                // 用现有的命中掉 san 字段近似"精神干扰"这一面，数值为游戏性默认值、非设定精确值
    range: 1.0,                 // 依据：外形是一团缠绕的电线触须，够得着距离按贴身缠绕估算，非精确设定
    cooldown: A.COOLDOWN.normal, // 选中版本未记载攻击频率，游戏性默认值
  },
  sounds: {},   // 具体声音效果写进下面的 brain.lure 和 anim.stateSounds（与状态绑定，不是常驻 idle/alert）

  // 行为：伏击型捕食者，不常游荡，偏好黑暗狭窄区域做巢（依据："机会主义且凶猛，但不像其他敌对实体那样常在外游荡……
  // 最适合黑暗、无人的区域；偏好干燥、黑暗、狭窄……的地方做巢"）；lure 对应"先把猎物引到身边再出击"。
  // "每月换一次巢"的长周期在游戏内不体现（时间尺度对局内验收无意义），见 notImplemented。
  brain: A.ambush({
    triggerRange: 3,     // 依据："先把猎物引到身边再出击"——引诱到很近才扑
    strikeSec: 4,
    lurkDark: true, darkThreshold: A.LIGHT.dim,   // 依据：偏好黑暗区域做巢
    lure: { sound: 'static', range: 12, cooldown: 8, chance: 0.6 },  // 依据：诱导声"通常伴有白噪音"
  }),
  anim: {
    gait: 'quad',
    twitch: 0.08,   // 非设定：选中版本没写这个细节，纯粹为了在画面上多一点"电线颤动"的识别度，注明非依据描述
    strike: 'lunge',  // 依据：伏击后"扑向猎物"
    stateSounds: { strike: 'click' },   // 依据：狩猎时"通常伴有……电子咔哒声"
    recoil: 0.2,
  },

  build(ctx) {
    const id = ctx && ctx.entity ? String(ctx.entity.id) : 'growler';
    const rnd = mulberry32(hashStr(id));
    const bodyColor = hslToHex(rnd(), 0.5, 0.3);   // 依据："颜色随机，每只配色不同"，见上方局部工具函数说明
    return A.wrap(A.parts.quadruped({
      length: 1.3, height: 0.5, girth: 0.32, thin: 0.15, legThick: 1.3,   // 依据："常呈无头四足姿态"——用四足构件表现常见姿态
      neckLen: 0.12, headSize: 0.12, snout: 0, jaw: false,                 // 依据："无头"——头部尽量做小，构件没有"完全无头"选项，用极小几何近似
      ears: 0, tail: 0,   // 选中版本未提耳朵/尾巴
      mane: 0.22,          // 依据：背部一排凸起，用来表现"铜线外裹橡胶绝缘层"的裸露线头/线圈质感
      colors: { body: bodyColor, fur: 0xb87333 },   // fur 取裸铜色，body 为每只随机的橡胶绝缘色
      look: { body: 'lambert', fur: 'lambert' },     // 构件没有"橡胶电线"材质选项，取无特殊纹理的 lambert 近似，非设定
      // 依据："由长短差别很大的铜线组成的一团"——四足构件本身是光滑兽形轮廓，光有背脊凸起还不够像"电线团"，
      // 用 extend 在身上加几条会摆动的裸线（chain 自带 sway），从躯干各处支棱出来打破圆润轮廓；
      // 方向/长度未见具体数字，属于游戏性造型取值，不是设定数字
      extend(b, d) {
        const wires = [
          { p: 'hips', from: [0.16, d.bodyY + d.girth * 0.5, d.hipZ - 0.05], dir: [1, 0.6, -0.3] },
          { p: 'hips', from: [-0.16, d.bodyY + d.girth * 0.4, d.hipZ + 0.1], dir: [-1, 0.4, 0.5] },
          { p: 'chest', from: [0.13, d.bodyY + d.girth * 0.6, d.chestZ], dir: [0.8, 0.7, -0.6] },
          { p: 'chest', from: [-0.14, d.bodyY + d.girth * 0.3, d.chestZ - 0.1], dir: [-0.7, -0.3, -0.8] },
          { p: 'hips', from: [0, d.bodyY + d.girth * 0.7, d.hipZ], dir: [0.2, 1, 0.4] },
        ];
        wires.forEach((w, i) => b.chain('wire' + i, w.p, w.from, w.dir, 3, 0.32, 0.022, 0.004, 'fur', 5));
      },
    }), { label: 'growler' });
  },
});
})();
