// 八层之蛛 / 蛛形纲生物 The Arachnids（旧编号 Entity 39）
// 来源版本：wikidot-cn（旧版）  URL：https://backrooms-wiki-cn.wikidot.com/old:entity-39  许可：CC BY-SA 3.0
// 只按这个旧版页面实现；不采用现行 entity-39（已改写成"生物枪"）、wikidot-en 的"帷幕教会引入/跳水可躲"、
// Fandom 的 Troglosidae 等其他站点/版本细节（WAVE2.md 第 1 节）。
// 选中版本写了三类蜘蛛（形蛛/皇后蛛/弗兰肯蜘蛛），外形量级和敌意都不同 → 按第 1 节拆成三个 type，
// 用同一套蛛形骨架构件（本文件自建，_archetypes.js 的 quadruped/insect 都不是蜘蛛站姿，改用 A.parts.rig 自定义）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// ---------- 共用蛛形骨架：头胸部 + 腹部 + 螯肢 + 8 条带膝弯的腿 ----------
// 8 条腿是"蛛形纲"分类本身的解剖学基本特征（跟"哺乳动物 4 条腿"一样，不是从别的版本借用的设定细节）；
// 选中版本没写颜色/眼睛/发光，材质给中性偏暗的甲壳色，不加眼睛/发光槽位。
function buildSpider(b, o) {
  const R = o.bodyR, hR = o.headR, y = o.legDrop;
  const abdomenC = [0, y + R * 0.08, R * 0.55];
  const headC = [0, y + hR * 0.05, -hR * 0.85];
  b.meta.dims = { y, bodyR: R, headR: hR, legReach: o.legReach };
  b.bone('body', null, [0, y, 0]);
  b.bone('head', 'body', headC);
  b.bone('jaw', 'head', [0, headC[1] - hR * 0.35, headC[2] - hR * 0.85]);
  b.sphere('body', 'body', R, abdomenC, [1, 0.9, 1.2], [10, 8]);                 // 腹部（大）
  b.limb('body', 'body', [0, y + R * 0.02, R * 0.05], [0, y + hR * 0.05, -hR * 0.35], R * 0.42, hR * 0.55, 6); // 细腰连接
  b.sphere('head', 'body', hR, headC, [1, 0.92, 1.05], [8, 6]);                  // 头胸部（小）
  // 螯肢/毒牙：两版都提到"毒咬"，蛛形纲用螯肢咬合是基本特征，做成一对小尖牙
  for (const s of [-1, 1]) {
    b.cone('jaw', 'body', [s * hR * 0.18, headC[1] - hR * 0.3, headC[2] - hR * 0.8],
      [s * hR * 0.22, headC[1] - hR * 0.55, headC[2] - hR * 1.05], hR * 0.06, 4);
  }
  // 8 条腿，4 对，从头胸部两侧向外辐射，每条一个膝弯（关节球 + 脚端两根趾爪，呼应画质要求多加的结构细节）
  const pairs = 4;
  for (let i = 0; i < pairs; i++) {
    const tt = (i - (pairs - 1) / 2) / (pairs - 1);
    const hipZ = headC[2] - tt * hR * 1.4;
    const legLen = o.legReach;
    for (const s of [-1, 1]) {
      const nm = 'leg' + i + (s < 0 ? 'L' : 'R');
      const hip = [s * hR * 0.7, y + R * 0.12, hipZ];
      const knee = [s * legLen * 0.6, y + R * 0.42, hipZ - tt * legLen * 0.15];
      const foot = [s * legLen, 0.02, hipZ - tt * legLen * 0.5];
      b.bone(nm, 'head', hip);
      b.bone(nm + 'k', nm, knee);
      b.limb(nm, 'body', hip, knee, o.legThick * 0.05, o.legThick * 0.036, 5);
      b.sphere(nm + 'k', 'body', o.legThick * 0.04, knee, [1, 0.85, 1], [5, 4]);      // 膝关节球
      b.limb(nm + 'k', 'body', knee, foot, o.legThick * 0.036, o.legThick * 0.012, 5);
      for (const c of [-1, 1]) {
        b.cone(nm + 'k', 'body', foot, [foot[0] + s * legLen * 0.04, foot[1] + 0.015, foot[2] + c * legLen * 0.03], o.legThick * 0.01, 4);
      }
    }
  }
  if (o.gland) {
    // 弗兰肯蜘蛛："胸腔有腺体，能以难以置信的速度愈合" —— 头胸部背上明显的一颗腺体肉瘤，与形蛛区分
    b.sphere('head', 'gland', hR * 0.42, [0, headC[1] + hR * 0.75, headC[2] + hR * 0.15], [1, 0.8, 0.95], [6, 5]);
  }
}
function spiderRig(o) {
  return A.parts.rig(o.key, b => buildSpider(b, o), {
    colors: Object.assign({ body: 0x2a2118, gland: 0x6e8a3a }, o.colors),   // 非设定：选中版本没写颜色，取不抢眼的中性甲壳色；gland 取病态暗绿，仅弗兰肯型用到
    look: Object.assign({ body: 'chitin', gland: 'lambert' }, o.look),
  });
}
// 走路时 8 条腿交替摆动（相邻两对反相、左右再错开半拍），三个亚型共用
function spiderWalkFrame(e, dt, api, u) {
  const rig = u.rig;
  if (!rig || e.dead) return;
  const amt = Math.min(1.2, (u.sp || 0) / 1.5);
  if (amt < 0.03) return;
  const ph = u.phase;
  for (let i = 0; i < 4; i++) {
    const off = (i % 2 === 0) ? 0 : Math.PI;
    for (const s of [-1, 1]) {
      const nm = 'leg' + i + (s < 0 ? 'L' : 'R');
      const p = ph + off + (s < 0 ? 0 : Math.PI);
      A.anim.addRot(rig, nm, 0, Math.sin(p) * 0.32 * amt, 0);
      A.anim.addRot(rig, nm + 'k', Math.max(0, Math.cos(p)) * 0.55 * amt, 0, 0);
    }
  }
}
const SPIDER_ANIM_BASE = {
  gait: 'none',            // 自定义骨架，走位用 onFrame 自己算（内置 quad/biped 骨骼名对不上）
  breathe: 0.02,            // 非设定：纯粹表现，让静止时不完全僵硬
  strike: 'bite',           // 复用内置 bite 动画：张合 jaw + 略低头，正好对上"头胸部前端咬合"
  recoil: 0.22,
  fall: 'back',             // 死亡仰面朝天、腿蜷起——经典"死虫"姿势，非设定但符合直觉
  onFrame: spiderWalkFrame,
};

// ---------- 形蛛 arachnid_common：数量最多的普通个体，被动、不惹不理 ----------
A.register({
  type: 'arachnid_common', en: 'The Arachnids (Common Spider)', zh: '形蛛', version: 'wikidot-cn',
  faction: 'neutral',
  // 依据：hostility=varies；"形蛛表面上没有敌意，不理会它们就可能不会被攻击" → 常态不主动伤人，按 varies 判断规则取 neutral

  hp: A.HP.weak,             // 依据：普通蜘蛛体型 2 厘米至 2 米、描述里没有额外强调耐打，取脆弱档，非精确设定
  radius: 0.55, height: 0.38,
  // 依据：size 给的是 2cm–2m 的极宽区间；取一个能在游戏里看清楚的"较大个体"代表值（腿展约 1.1 米），
  // 并在 build 里用确定性伪随机给每只个体 0.75–1.6 倍缩放，模拟"大小不一"，仍不是覆盖整个区间的精确设定
  speed: { walk: A.SPEED.slow, run: A.SPEED.walk },
  // 依据：locomotion/speed 选中版本完全未写 → 按"表面没有敌意、不主动出击"的性格给保守默认值，非设定
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 260 },
  // 依据：感官选中版本未写 → 按多足生物没有单一正脸给默认值+偏宽视野，非设定
  attack: { hp: A.DAMAGE.light, sanity: 0, range: 0.75, cooldown: A.COOLDOWN.fast },
  // 依据："部分形蛛毒性较高" → 有毒但不致命，取轻伤档；没写攻击频率，蜘蛛连续快速咬取 fast；没写理智影响 → 不写 aura
  sounds: { attack: 'hit' },   // 依据：选中版本没写任何叫声，蜘蛛本就不发声，只给通用咬击命中音

  brain: A.wanderer({ retaliate: 'fight' }),
  // 依据："不理会它们就可能不会被攻击"= 被惹到才动手 → wanderer + fight（阵营规则本身已保证它不会主动打测试人/友善实体）

  anim: SPIDER_ANIM_BASE,

  build(ctx) {
    const rnd = BR.util.rng(ctx && ctx.entity ? ctx.entity.id : 'arachnid_common', 'scale');
    const scale = 0.75 + rnd() * 0.85;   // 依据：size "2 厘米至 2 米"跨度极大，无法逐个体精确复刻，用随机缩放近似"大小不一"
    const model = spiderRig({
      bodyR: 0.20, headR: 0.15, legDrop: 0.22, legReach: 0.55, legThick: 1,
      key: 'arachnid_spider_v1',
    });
    model.scale.setScalar(scale);
    return A.wrap(model, { label: 'arachnid_common' });
  },
});

// ---------- 皇后蛛 arachnid_queen："所有普通蜘蛛的母亲"，极具攻击性 ----------
A.register({
  type: 'arachnid_queen', en: 'The Arachnids (Queen Spider)', zh: '皇后蛛', version: 'wikidot-cn',
  faction: 'hostile',   // 依据："皇后蛛攻击性极高"

  hp: A.HP.tough,        // 依据：巨型体型(7–10米)+"所有普通蜘蛛的母亲"的头目定位，取高血量档；选中版本没写"不朽/杀不死"不用 immortal
  radius: 2.6, height: 2.8,
  // 依据：size "7–10 米"，取区间中段代表值（腿展约 8 米，非精确设定），collision 半径按身体核心估算，
  // 比腿展小很多——腿爪的视觉范围允许超出碰撞体，避免玩家被顶在离得很远的地方就打不到/走不近
  speed: { walk: A.SPEED.jog, run: A.SPEED.run },
  // 依据：speed 选中版本未写 → 按"攻击性极高"的头目定位给中等偏高追击速度，非设定精确数字
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 260 },
  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 4.2, cooldown: A.COOLDOWN.normal },
  // 依据："毒力强大" → 高伤害档(severe)但不到一击必杀(lethal)；攻击频率未写，取常规节奏；
  // range 按巨型腿展的够得着距离估算，必须 ≥ radius，见上面注释
  sounds: { attack: 'hit' },   // 依据：选中版本没写叫声，只给通用咬击命中音

  brain: A.stalker({ patrol: 'wander', patrolRadius: 18 }),
  // 依据：占据 Level 8 全境、攻击性极高 → 主动巡逻搜寻猎物的追猎者，而不是原地蹲守

  anim: SPIDER_ANIM_BASE,

  build() {
    const model = spiderRig({
      bodyR: 1.3, headR: 0.95, legDrop: 1.7, legReach: 4.0, legThick: 6,
      key: 'arachnid_queen_v1',
    });
    return A.wrap(model, { label: 'arachnid_queen', budget: 4000 });
  },
});

// ---------- 弗兰肯蜘蛛 arachnid_franken：胸腔有腺体，愈合速度惊人 ----------
A.register({
  type: 'arachnid_franken', en: 'The Arachnids (Franken Spider)', zh: '弗兰肯蜘蛛', version: 'wikidot-cn',
  faction: 'neutral',
  // 依据：选中版本没有单独写弗兰肯蜘蛛的敌意，只描述了它的再生能力；同属"形蛛"一系，没有额外注明主动伤人，
  // 按和形蛛一致的基线处理（varies → 不主动出击 → neutral），不额外提高敌意（不借用其他版本的设定）

  hp: A.HP.weak,   // 依据：体型和形蛛同源，选中版本没写更耐打的体质，只写了"愈合快"——用持续回血表现，不用更高的基础血量档
  radius: 0.55, height: 0.38,   // 依据：和形蛛同源体型，量级取一致值，非精确设定
  speed: { walk: A.SPEED.slow, run: A.SPEED.walk },
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 260 },
  attack: { hp: A.DAMAGE.light, sanity: 0, range: 0.75, cooldown: A.COOLDOWN.fast },
  // 依据：攻击方式选中版本未单独写，按同科形蛛的"毒咬"处理，不借用其他版本的设定
  sounds: { attack: 'hit' },

  brain: A.wanderer({ retaliate: 'fight' }),

  // 依据："胸腔有腺体，能以难以置信的速度愈合，生物学上不朽" —— "生物学上不朽"通常指不因衰老死亡，不等于
  // 打不死/无敌，选中版本也没写抗打描述，所以不用 A.HP.immortal；改用持续快速回血来表现"愈合速度惊人"，
  // 数值(4 HP/秒，约 7.5 秒回满全部血量)是游戏性近似，不是设定精确数字
  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    if (!e.dead && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 4 * dt);
  },

  anim: SPIDER_ANIM_BASE,

  build() {
    const model = spiderRig({
      bodyR: 0.20, headR: 0.15, legDrop: 0.22, legReach: 0.55, legThick: 1, gland: true,
      key: 'arachnid_franken_v1',
    });
    return A.wrap(model, { label: 'arachnid_franken' });
  },
});
})();
