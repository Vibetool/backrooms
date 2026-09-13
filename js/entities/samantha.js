// 萨曼莎 Samantha（Entity 26）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-26  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）；
// 不采用英文 Fandom 的 Entity 26（Mercies，蚊状掠食者，是完全不同的实体，未加载）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'samantha', en: 'Samantha', zh: '萨曼莎', version: 'wikidot-cn',
  // hostility 原文是 varies：“主要消极被动……用肉换取她的读灵术服务”，但“不喂食时会变得暴力”。
  // 按 WAVE2.md 第 3 节的判定规则：常态被动、只在被怠慢/攻击时才动手 → neutral。
  // “用肉交易读灵术”属于 M.E.G. 交易/NPC 对话，本项目范围决定不做（见 WAVE2.md 附：范围决定），
  // 所以“不喂食就暴力”这个触发条件没法实现，落地成“平时不主动攻击人，被攻击才反击”。
  faction: A.faction('varies', 'neutral'),

  hp: A.HP.weak,                // 依据：“体型较小，可能是幼猫或矮种猫”，原文没写耐打程度，按体型给较低档，非精确数值
  radius: 0.22, height: 0.32,   // 依据：小型猫科体型换算，原文没给具体数字，非设定
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：原文没写具体移动速度，按小型猫科给游戏性默认值，非设定；她真正写明的移动方式是瞬移，见下面 think
  perception: { sight: A.SIGHT.keen, hearing: A.HEARING.keen, fov: 360, needsLight: false },
  // 依据：“具有透视、读心术等通灵能力”→ 不靠肉眼直视，给较高感知 + 360° 全向、不需要光照也能感知
  attack: { hp: A.DAMAGE.medium, sanity: 0, range: 0.8, cooldown: A.COOLDOWN.fast },
  // 依据：“抓挠、咬人；锯齿状牙齿能轻松撕破皮和肉，会致伤”，但“目前没有由她造成的死亡记录”
  // → 有实感伤害但非致命，取中档 medium；抓+咬两种连续动作 → cooldown 给 fast；
  // range 按小型猫科爪牙可及距离取模板建议的 0.8（“爪/咬 0.8–1.0”），原文未给数字，非设定
  // 原文未提理智影响 → 不写 aura

  sounds: { idle: 'whisper' },
  // 依据：“能用至少 3 种人类语言流利交流，口齿伶俐”——NPC 对话/台词本项目不做（见范围决定），
  // 用已有的 whisper 音效表示“她在说话/交流”；原文没写吼叫尖叫等战斗音效 → 不加 alert/attack

  brain: A.wanderer({ retaliate: 'fight' }),
  // 依据：“主要消极被动”→ 用游荡型而不是主动追猎；她确实有抓咬反击能力 → retaliate:'fight'（被攻击才还手）

  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    if (e.dead) return;
    // 依据：原文 locomotion “未具体说明；具有瞬移能力”——除了反击外，明确写了她的移动方式是瞬移，
    // 用定时随机短距离闪现表示，只在游荡/待机时触发（战斗中不瞬移，避免打不到她）；
    // 候选点复用 A.lightSeek 的视线校验（不在意亮暗，只借它筛掉隔墙/不可达的点）
    const s = e.data.samantha || (e.data.samantha = { at: api.time + 5 + api.rng() * 6 });
    if ((e.state === 'wander' || e.state === 'idle') && api.time >= s.at) {
      const spot = A.lightSeek(e, api, 5, api.rng() < 0.5 ? 'dark' : 'bright');
      if (spot) { e.x = spot.x; e.z = spot.z; A.cry(e, 'noclip', { cooldown: 1, hear: 20 }); }
      // 瞬移消失/重现没有额外的隐没特效（预算限制），用 noclip 音效（本来就是“穿墙/相位”音效）示意
      s.at = api.time + 6 + api.rng() * 8;
    }
  },

  anim: { gait: 'quad', stride: 0.5, strike: 'bite', fall: 'side', recoil: 0.18 },

  build(ctx) {
    return A.wrap(A.parts.quadruped({
      length: 0.55, height: 0.26, girth: 0.13, thin: 0.25,   // 依据：“体型较小，幼猫或矮种猫”级别，具体数值原文未写，非设定
      headSize: 0.17, snout: 0.05, jaw: true,                // 依据：猫科头部比例；“锯齿状牙齿”靠 jaw + 高画质自动牙列表现
      ears: 0.07, tail: 0.32,                                // 依据：“猫科哺乳动物”隐含的常见体态特征，原文没给尺寸，非设定
      eyes: { size: 0.028, glow: false },                    // 依据：“绿色眼睛”，没写发光 → 用普通颜色的 eye 槽位而非发光
      colors: { body: 0x1b1a19, head: 0xe9e2d1, eye: 0x4c8c3c },
      // 依据：“黑白相间皮毛”——引擎材质是纯色槽位，没有花斑贴图能力，用 body（深）/head（浅）两个槽位
      // 的深浅对比近似“黑白相间”，不是精确花纹，这是游戏性近似（在返回值里说明）
      look: { body: 'fur', head: 'fur' },
    }), { label: 'samantha' });
  },
});
})();
