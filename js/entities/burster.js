// 爆酸者 Burster（Entity 11）
// 来源版本：wikidot-cn  URL：https://backrooms-wiki-cn.wikidot.com/entity-11  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'burster', en: 'Burster', zh: '爆酸者', version: 'wikidot-cn',
  faction: 'hostile',
  // 依据：选中版本 hostility 字段已给出 "hostile"（研究文件 note 说明：页面标签写"中立"，但正文按玩法记为敌对）

  hp: A.HP.average,
  // 依据：size/speed 都标 unverified，没有耐久数据；按"会结茧、需要足够力量才能打破致死"的持续威胁定位取中档，非设定
  radius: 0.4, height: 0.75,
  // 依据：appearance"靠四肢爬动；后腿更长"是趴伏体态，没有具体尺寸 → 按四足爬行姿态给贴地默认值，非设定
  speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
  // 依据：speed 字段 unverified；按"四肢爬动"取中档，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据：senses"未单独描述；活物接近时触发"→没有方向性描述，给 360° 全向感知
  attack: { hp: A.DAMAGE.medium, sanity: 0, range: 1.3, cooldown: A.COOLDOWN.fast },
  // 依据：attack"胼胝爆裂，把类酸性物质喷到受害者脸上…幸存者被持续喷酸至休克"→取中等伤害配合快冷却，
  // 模拟"持续喷酸直到休克"而不是一击致命；range 放大近似喷酸距离（引擎没有真正的远程抛射，见返回值 apiRequests）
  sounds: {},   // 依据：选中版本没有写声音描述，不加

  brain: A.ambush({ triggerRange: 4, revealRange: 0, fixed: false, returnHome: true }),
  // 依据：behavior"多数时候以胎儿般的姿势保持温顺…活物接近时…爆裂喷酸"→伏击型；
  // 触发距离选中版本只写"接近"没给数字，用骨架默认 4 m，非设定；fixed:false 因为 locomotion 写"穿行在后室的门厅之中"，不是固定不动的陷阱
  anim: { gait: 'crawl', stride: 1.0, strike: 'sting', fall: 'crumple' },
  // 依据：gait 'crawl' 对应"靠四肢爬动"；strike 'sting' 近似胼胝爆裂喷酸的瞬时突刺动作；
  // fall 'crumple' 近似"受伤后表皮硬化成茧"的蜷缩死亡姿态（结茧后仍可被打破致死的两段式状态见 notImplemented）

  build(ctx) {
    return A.wrap(A.parts.humanoid({
      height: 1.5, pose: 'crawl', legLen: 1.35, armLen: 0.85, thin: 0.3, hunch: 0.2,
      // 依据：appearance"模糊的人形，靠四肢爬动；后腿更长，腿部结构更接近犬科"
      // → pose:'crawl' 四肢着地；legLen>armLen 让后腿明显长于前肢；身高无数据，按人形默认给 1.5 m，非设定
      head: 'faceless', hands: true, feet: true,
      // 依据：appearance 没有写头部/脸部特征，也没写颜色和发光部位；用无面头形只是几何上的默认造型，不代表设定，非设定
      colors: { body: 0x59544a },
      look: { body: 'skin' },
      key: 'burster_v1',
      extend(b, d) {
        // 依据：appearance"背上长着许多胼胝，狩猎或激动时胼胝会爆出小股酸性流体"→沿脊柱加几颗凸起疣状物；
        // 颜色沿用 body 槽位（选中版本没有写胼胝颜色），非独立材质，避免超材质槽位预算
        const n = 5;
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / (n + 1);
          const y = d.hipY + (d.shoulderY - d.hipY) * t;
          b.sphere('spine', 'body', d.headR * 0.32, [0, y, d.headR * 0.5], [1, 0.7, 0.9]);
        }
      },
    }), { label: 'burster' });
  },
});
})();
