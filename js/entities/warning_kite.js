// 警告风筝 Warning Kite（Entity 22）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-22  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 注：wikidot-en 写"首次发现于 Level 10（附近有窃皮者）"，选中的 wikidot-cn 这次提取只写"所有室外
// 层级"，没有这条首次发现记录，不借用。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 依据："危险在方圆一英亩内逼近时出现"——把"一英亩"换算成等面积的圆形范围：
// 1 英亩 = 4046.86 m²，半径 = sqrt(4046.86 / π) ≈ 35.9 m，取整 36
const DANGER_RADIUS = 36;
// 依据："超出范围约 60 米时爆炸，释放彩纸"——原文直接给了米数，不用换算
const DESPAWN_RADIUS = 60;

// 附近最近的有害实体（"危险"的近似：引擎没有全局"危险等级"概念，这里用最近的 hostile 阵营实体代替，
// 非设定精确定义，见 notImplemented）
function nearestDanger(e, api) {
  const list = A.nearby(api, e, DANGER_RADIUS, ['hostile']);
  let best = null, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const o = list[i], d2 = (o.x - e.x) * (o.x - e.x) + (o.z - e.z) * (o.z - e.z);
    if (d2 < bd) { bd = d2; best = o; }
  }
  return best;
}

A.register({
  type: 'warning_kite', en: 'Warning Kite', zh: '警告风筝', version: 'wikidot-cn',
  faction: 'neutral',   // 依据：hostility = neutral（原文："完全中立，不伤害人类，只发出警告"）

  hp: A.HP.fragile,
  // 依据：没写自身耐久；"卡通风格的风筝……金属网状骨架+尼龙织物"是轻巧的飞行物，按脆弱的道具类物体
  // 给最低档，非设定精确数字
  radius: 0.35, height: 0.5,
  // 依据：size unverified（没有具体数字），按常见风筝大小给游戏性默认值，非设定精确数字
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：speed unverified；平时随风漂浮给 walk，危险靠近时改变方位给 jog——原文没有"逃跑"的描述，
  // 只是"朝危险相反方向移动"重新指示方向，不用更快的档位，非设定精确数字
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: false },
  // 依据：感官只写了"具有某种形式的神经末梢，能感受疼痛和触摸"，不是视觉/听觉；这里的字段只是满足骨架
  // 要求的占位默认值，真正判断"危险"用下面 think 里的 A.nearby，不依赖 sight/hearing，非设定
  // 完全中立、不主动攻击——依据："完全中立，不伤害人类，只发出警告"，不写 attack 字段（参照向导"不会
  // 还手"时不写 attack 的做法，第 5.8 节）
  sounds: {},
  // 依据：声音（孩子的笑声/欢呼声）不是固定的 idle/alert/attack 触发点，而是随危险远近连续变化的音量/
  // 频率，下面用 A.cry 手动控制播放，不写进 sounds 字段

  brain: A.wanderer({ speed: A.SPEED.walk }),
  // 没有危险时的兜底行为：原地漫游，代表"和同伴风筝一起悬在空中"；wanderer 的"被打反击"逻辑因为没有
  // attack 字段实际不会生效，只借用它的漫游状态机，非设定

  think(e, dt, api, brain) {
    const d = e.data.kite || (e.data.kite = { nextScan: 0, danger: null });
    const now = api.time;
    if (now >= d.nextScan) {
      d.nextScan = now + 0.4;   // 别每帧扫描全部实体（第 10 节），0.4 秒扫一次足够跟上"危险靠近"的节奏
      const found = nearestDanger(e, api);
      if (found) d.danger = found;
      else if (!d.danger || d.danger.dead || d.danger.removed) d.danger = null;
    }
    if (d.danger && !d.danger.dead && !d.danger.removed) {
      const dist = Math.hypot(e.x - d.danger.x, e.z - d.danger.z);
      if (dist > DESPAWN_RADIUS) {
        // 依据："超出范围约 60 米时爆炸，释放彩纸"——危险已经远离，警示任务结束，自我了结
        api.damage(e, e.hp, null);
        d.danger = null;
      } else {
        // 依据："朝危险的相反方向移动，用来指示危险方位"
        e.state = 'warn';
        const ux = (e.x - d.danger.x) / (dist || 1), uz = (e.z - d.danger.z) / (dist || 1);
        api.moveToward(e, e.x + ux * 3, e.z + uz * 3, A.speedOf(e, 'run'));
        api.faceToward(e, d.danger.x, d.danger.z);
        // 依据："孩子的笑声和欢呼声，声音越大危险越近"——距离越近，冷却越短、音量越大
        const loud = 1 - Math.min(1, dist / DANGER_RADIUS);
        A.cry(e, 'giggle', { cooldown: 5 - loud * 3.5, volume: 0.4 + loud * 0.6 });
        return;
      }
    }
    e.state = 'idle';
    A.cry(e, 'giggle', { cooldown: 11, volume: 0.28 });
    // 依据：欢呼声是持续的背景特征而不是"发现玩家才叫"，没有危险时用低音量、长间隔代表远处同伴风筝群
    // 的背景笑声，非设定精确数字
    brain.think(e, dt, api);
  },

  anim: {
    gait: 'none', fall: 'fade', recoil: 0.06,
    // 依据：没有身体/腿部描述，不走标准步态；"爆炸释放彩纸"没有专门的粒子效果预算（见 notImplemented），
    // 用渐隐代替，corpseSec 给得短一些，接近"一下子就没了"的观感
    sway: 0.35, swaySpeed: 2.0,
    // 尾巴/绸带随风摆动，选中版本没写摆动细节，非设定精确数字
    fly: { cruise: 2.4, bob: 0.15, bobHz: 0.8, bank: 0.12, ceiling: true, clearance: 0.3 },
    // 依据：locomotion"成群飞行"，没有具体高度数字，给一个常见的户外飘飞高度，非设定精确数字
  },
  corpseSec: 0.6,

  build(ctx) {
    return A.wrap(A.parts.rig('warning_kite_v1', b => {
      b.bone('body', null, [0, 0, 0]);
      // 主体：金刚石形状的尼龙面——依据："由金属网状骨架和尼龙织物构成"；用旋转 45 度的扁盒子做出
      // 经典菱形风筝轮廓，颜色没写，取不抢眼的中性色，非设定
      b.box('body', 'fabric', [0.5, 0.5, 0.02], [0, 0, 0], [0, 0, Math.PI / 4]);
      // 金属网骨架：横竖两根十字支架，比面料略突出——依据："金属网状骨架"撑起织物
      b.box('body', 'frame', [0.72, 0.02, 0.03], [0, 0, 0.001]);
      b.box('body', 'frame', [0.02, 0.72, 0.03], [0, 0, 0.001]);
      // 尾巴：一串会摆动的绸带，每节上有一个小结扣——依据："底部有绳索连到未知地点"里"绳索"的常见
      // 风筝配件形象，具体样式未写，非设定
      const tail = b.chain('tail', 'body', [0, -0.05, 0.02], [0, -1, 0.15], 4, 0.9, 0.03, 0.008, 'fabric', 5);
      for (let i = 0; i < tail.length - 1; i++) b.sphere(tail[i], 'frame', 0.045, [0, 0, 0.02], null, [6, 5]);
      // 连到未知地点的长绳——依据："底部有绳索连到未知地点"，长度是象征性的，非设定精确数字
      b.limb('body', 'frame', [0, -0.75, 0.14], [0, -3.5, 0.55], 0.012, 0.006, 4);
    }, {
      colors: { frame: 0x8a8a86, fabric: 0xd8cdb0 },
      look: { frame: 'lambert', fabric: 'cloth' },
      key: 'warning_kite_v1',
    }), { label: 'warning_kite' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "数量随危险程度增减":实体文件管不了同屏生成几只（生成数量是层级/密度表的职责，见 _TEMPLATE.md
//   第 2 节"出现在哪些层级、每层密度由层级文件决定"），本文件只让单只风筝在有危险靠近时做出反应。
// - "危险"用最近的 hostile 阵营实体近似：原文没有定义"危险"到底指什么，引擎也没有全局危险等级，
//   这里退而求其次用"附近的有害实体"代替，中立/友善实体不会被当成危险来源，非精确复刻。
// - "爆炸，释放彩纸"：没有做专门的彩纸粒子爆炸效果（预算/时间有限），用现有的渐隐（fall:'fade'）代替，
//   自我了结的时机（超出危险 60 米）按原文实现了，但视觉效果是简化的。
// - "具有某种形式的神经末灈，能感受疼痛和触摸"：没有写 attack，也没有专门的"被拽下来会怎样"效果——
//   原文只说应对方式是"不要拽下风筝"，没写拽下后的后果，不编造。
// - "抬头观察、聆听欢呼声、跟随风筝"这条给玩家的应对建议：没有对应的游戏内提示 UI，未实现。
