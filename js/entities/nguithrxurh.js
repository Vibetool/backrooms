// Nguithr'xurh（Entity 16，未译名——页面注明这名字是把 "The Sleeper Spider" 打错了字保留下来的）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-16  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'nguithrxurh', en: "Nguithr'xurh", zh: "Nguithr'xurh（未译）", version: 'wikidot-en',
  // 依据：版本自带的 hostilityNote——"它捕食人类，近距离接触被描述为非常危险；但不主动追击，避开陷阱就'基本无害'。
  // 此处 hostile 是根据捕食行为的推断"——这个推断是选中版本自己给出的，不是我们从别的来源借的
  faction: 'hostile',

  // 体型：平均约 4 英寸宽（4×0.0254=0.1016 m）、7 英寸长（7×0.0254≈0.178 m），一只趴在天花板上的小型伏击者
  hp: A.HP.weak,                        // 依据：没写耐久，按"体型只有 10cm 级别"给偏低档，非设定精确值
  radius: 0.09, height: 0.05,           // 依据：4 英寸宽≈0.1 m → 半径取一半；扁平贴地（贴天花板）躯体，高度给低值，非设定精确数字
  speed: { walk: A.SPEED.crawl, run: A.SPEED.slow },
  // 依据："慢，而且没观察到它们追逐猎物"——全部取最低两档；brain 里 fixed:true 使它实际上完全不会位移，这两个值只是骨架要求填的占位
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360, needsLight: false, avoidsLight: false },
  // 依据：感官"未提及" → sight/hearing 用默认值（非设定）；辐射状 16 腿身形没有正面朝向 → fov 给 360，非设定精确值，按体型推断
  attack: { hp: A.DAMAGE.severe, sanity: 12, range: 1.0, cooldown: A.COOLDOWN.heavy },
  // 依据：
  // - "网球落到目标身上，镇静剂无法完全麻痹受害者，但会逐步大幅削弱思考能力，最终让人失去反应"→ 判给 attack.sanity（选中版本没给数字，取中等偏低值，非设定精确数字）
  // - "近距离接触被认为非常危险""首次记录一支探索队有 2 人受了致命伤"→ 高致死但不是"一击必杀"，取 severe（不是 lethal）
  // - range=1.0：网球是从天花板正上方落下命中，引擎只有水平距离判定，这里用水平范围近似"够得着正下方目标"（真正的"从高处坠落命中"能力见 apiRequests）
  // - "进食后进入休眠，然后重新布置陷阱"→ 得手一次要很久才能再次得手，cooldown 取最长档 heavy

  brain: A.ambush({
    fixed: true,          // 依据："躲在天花板上……一动不动地等猎物正好从下面经过"——完全静止的陷阱，不会为了追猎物挪动
    triggerRange: 1.2,    // 依据：猎物"正好从下面经过"才触发，给一个人体宽度左右的判定范围，非设定精确数字
    revealRange: 0,       // 依据：没有伪装/现形机制——网囊本来就明晃晃挂在天花板上，不是伏击者的隐蔽把戏
    strikeSec: 4,         // 依据："落下来把猎物活活吃掉"，进食动作给较长演出时长，非精确设定
    returnHome: true,     // 依据："进食后进入休眠，然后重新布置陷阱"——吃完之后回到原来的位置
  }),
  anim: {
    gait: 'none',                       // 16 条腿是肢团式辐射结构，靠 sway 自动摆动，没有标准步态骨骼
    sway: 0.14, swaySpeed: 3.2,          // 非设定：只是让腿部有轻微抖动，暗示"活的"，选中版本没写腿部动作细节
    fly: { rest: 2.6, cruise: 2.6, low: 0.12, clearance: 0.3, bob: 0.02, bobHz: 0.7 },
    // 依据："躲在天花板上"——用飞行高度机制把模型贴在天花板下方；rest/cruise 取常见房间层高 2.6 m 作为
    // 兜底值（大多数层级房间够不到这个高度时，fly.ceiling 的射线检测会自动把它截断到真实天花板下方，
    // 房间比这个高时才会用到 2.6 这个兜底值），只有 state==='attack'（落下取食）时才降到 low
    strike: 'grab',                     // 依据："把装有镇静剂的网球落到目标身上"，是缠住猎物而不是撕咬/蜇刺
  },

  build(ctx) {
    const spider = A.parts.limbCluster({
      count: 16, segments: 2, length: 0.075, radius: 0.012, tip: 0.003, spread: 1, center: [0, 0.05, 0], core: 0.045,
      // 依据："类似蜘蛛的生物，有 16 条附肢，形态被描述为接近避日目（骆驼蜘蛛/风蝎）"——16 条腿从核心向四周辐射摊开
      colors: { body: 0x8a7355 },       // 依据：页面完全没提到身体颜色，取避日目常见的中性棕黄色，非设定
      look: { body: 'chitin' },         // 依据：节肢动物外骨骼质感
    });
    const sac = A.parts.decal({
      radius: 0.08, color: 0x8f8a4e, opacity: 0.85, lumps: 8, seed: 3, look: 'lambert',
      // 依据："蛛网是挂在天花板上的球状网囊，里面灌满镇静剂"——用不规则斑块近似鼓起的球状网袋；
      // 颜色页面没写，取浑浊药液色，非设定。**不发光**：调研记录明确写"wikidot-en/cn 实体页都没有写蛛网发光"，
      // 所以这里绝不给发光材质（游戏层级简介里的"发光球状蛛网"来自别的来源，不能借用）
    });
    sac.rotation.x = Math.PI;           // decal 默认贴地朝上，翻转 180° 让它朝下贴在"天花板"上
    sac.position.set(0.12, 0.01, -0.02);
    const group = new THREE.Group();
    group.add(spider, sac);
    return A.wrap(group, { label: 'nguithrxurh' });
  },
});
})();
