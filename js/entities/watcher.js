// 观察者 Watcher（Entity 5923 "Watchers"）
// 来源版本：fandom  URL：https://web.archive.org/web/20220708193715/https://backrooms.fandom.com/wiki/Watchers  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）——
// 注：这个页面的编号是 Entity 5923，和常被称作"Entity 38"的观察者不是同一个页面（wikidot 现行 Entity 38
// 已经是"类人"，fandom 的 Entity 38 是 Needlelimbs）；选中版本只是同名，机制与更常见的"怕光消失、
// 吸取理智"版本（wikidot-en）不同，见文件末 notImplemented 的说明。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'watcher', en: 'Watcher', zh: '观察者', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.sturdy,
  // 依据：原文没有写它的体力/是否能被杀死（只写了"无法被拍照"这种和战斗无关的特性），取中性默认值，非设定
  radius: 0.32, height: 1.9,
  // 依据：size unverified；按人形轮廓给游戏性默认尺寸，非设定精确数字
  speed: { walk: A.SPEED.slow, run: A.SPEED.walk },
  // 依据：locomotion 未描述，且它常年待在同一个高层房间里（见下方 brain 的 fixed:true），此为占位值，非设定
  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.normal, fov: 200, avoidsLight: true },
  // 依据："从窗户后面盯着旅人"暗示能看到较远的距离，sight 取较高档；fov 放宽因为它是"盯着"而非追逐；
  // avoidsLight 只作标记，不代表真的实现了怕光行为——见下方 notImplemented
  attack: { hp: A.DAMAGE.lethal, sanity: 20, range: 2.6, cooldown: A.COOLDOWN.heavy },
  // 依据："进入它所在的房间就会心脏病发作""被派去查看房间的人几乎全部死亡"——几乎必死，取 lethal；
  // "引发极度偏执""幸存者留下心理创伤"——命中同时掉 san，数值原文没写，取较高值，非设定精确数字；
  // range 用比贴身近战更大的数值模拟"进入房间"这个触发条件，不是精确的房间边界判定；
  // 冷却取最长档，避免"心脏病发作"这种重大事件被连续触发
  sounds: { alert: 'screech', attack: 'screech' },
  // 依据："尖叫一些随机词语（'HELP!'、'GET ME OUT!!'）……只有你本人能听见"——用现有的 screech（尖叫）近似

  // 行为：固定在原地（依据：见 attack 注释里"待在建筑高层……从窗户后面盯着"，没有 locomotion 描述）。
  // canTarget 复刻"旅人看向它时才开始动作"这条核心机制：对玩家要求正在看着它才算目标；
  // 对其他实体没有这个限制（依据："也会攻击其他实体"，原文没有为这条加"被实体看到"的前提）。
  brain: A.ambush({
    fixed: true,
    revealRange: 6,   // 依据：被看到后"开始猛敲窗户"是靠近之前的预警动作，用于展示 lurk 状态（挥手/尖叫）
    canTarget(e, t, api) {
      if (t.kind !== 'player') return true;
      return A.playerLooking(e, 50, 22);
    },
  }),
  anim: {
    gait: 'biped', strike: 'swipe', recoil: 0.2, fall: 'back',
    stateSounds: { alert: 'door' },   // 依据："猛敲窗户"——用现有的 door（开关门声）近似敲击声，和尖叫同时触发
  },

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.9, thin: 0.35, head: 'faceless', hands: true, feet: true, claws: 0, hair: 0,
      // 依据："暗影般的人形"——高瘦轮廓、无面（faceless），身体细节原文没写，其余按人形默认给
      opacity: 0.85,
      // 依据："暗影般的"取半透明黑的 shadow 材质表现阴影感；原文没写具体透明度，非设定精确数字
      key: 'watcher_v1',
      colors: { body: 0x050506, hair: 0xffffff },
      look: { body: 'shadow', head: 'shadow', hair: 'lambert' },
      // body/head 用 shadow 材质（半透明黑，颜色参数被忽略，靠 opacity 控制深浅）表现"暗影般的人形"；
      // hair 槽位本来没用到（hair:0 不生成头发），这里借用来放白色眼球，look 单独给成不透明的 lambert，
      // 不跟着 body/head 一起变成阴影材质——依据："长着白色眼睛"
      extend(b, d) {
        // 依据："长着白色眼睛"，原文没写眼睛是否发光——不使用 glow 自发光材质，只给不透明白色球体，
        // 避免凭空加上原文没确认的发光效果（见文件头/返回值 notes 的例外提醒）
        const hr = d.headR, hy = d.headY;
        for (const s of [-1, 1]) b.sphere('head', 'hair', hr * 0.14, [s * hr * 0.34, hy + hr * 0.08, -hr * 0.88], null, [6, 5]);
      },
    }), { label: 'watcher' });
  },
});
})();

// notImplemented（返回值里再列一遍）：
// - "用手电筒照它，它可能会离开"：原文只说"可能"，没有给出确定的触发条件或概率，perception.avoidsLight
//   只留作标记，没有接 A.lightBound 之类的确定性怕光行为——那样会把一个不确定的"可能"实现成每次必定生效，
//   偏离原文的措辞。
// - "不攻击儿童"：游戏里没有"儿童"这个目标分类（测试人/玩家都是成年人），无法区分，未实现。
// - "发现者无法拍到它（照片上什么都不显示）"：游戏里没有相机/拍照道具或机制，未实现。
// - "和 Windows 是朋友"：原文未解释这个关系的具体表现，且 Windows 不是本批次实现的实体，未实现。
// - "从不表现情绪"：这是外观/行为基调的描述，没有对应的可执行规则，靠动画和音效的克制表现体现，不单独编码。
