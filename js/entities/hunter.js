// 猎手（零号病人）The Hunter / Patient Zero（fandom Level 14 "Inhospitality" 页面里的常驻实体，无独立编号）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Level_14  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（wikidot-en/wikidot-cn 的 Level 14 是完全不同的
// "Paradise/天堂" 森林层级，没有这个实体，见 backrooms-research/entities/hunter.json 的 conflicts）
// 调研摘要来自 WebSearch 对该页面的多次总结（站点直连/API/镜像全部 402 或需要人机验证），没有逐字核对原文，
// 摘要里明确没找到"靠近时突然恐惧、气温骤降、空气浓稠有毒"这条，按规则视为未写，不实现。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 触手布局参数：build() 和 extend() 共用，改这里两处都会同步
const T_COUNT = 8;      // 依据："向四面八方伸出许多扭动的章鱼状触手"——数量原文没给，取一个视觉上"许多"的档，非设定
const T_SEG = 4;        // 触手分节数，纯建模参数，非设定

A.register({
  type: 'hunter', en: 'The Hunter', zh: '猎手（零号病人）', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile；行为里也写"主要目的是猎杀所有进入本层的流浪者"

  hp: A.HP.tough,               // 非设定：原文没给耐久数值；作为 Level 14 深处常驻的主要威胁（考察队 20 人只 4 人生还），取偏高档
  radius: 0.5, height: 1.6,     // 非设定：size unverified。之前按"变异前是成年研究员"直接套用人类身高 1.9m，
  // 但外观原文写的是"身体不定形"，核心团块 + 触手撑不出人类身高的轮廓（验收发现实际模型只有约 1m、
  // 核心悬在半空更像蜘蛛/海星）；改为按下面实际建出的模型量：核心抬高、触手加长上扬，用测试人（1.8m）
  // 同框截图核对像素高度，量出来约 1.6m（含向上探的触手顶端），不再强行对齐原人类身高
  speed: { walk: A.SPEED.walk, run: A.SPEED.run },
  // 非设定：本体移动速度没写，原文只写触手"动作快而精准"；给一档冲刺才能甩掉的速度维持"猎手"的压迫感

  perception: {
    sight: A.SIGHT.normal, hearing: A.HEARING.normal,   // 非设定默认值：感官(senses)原文没写
    fov: 360,   // 依据（间接）："身体不定形，向四面八方伸出许多触手"——外观上没有正面/背面之分，推断没有明显视野盲区
  },

  attack: { hp: A.DAMAGE.severe, sanity: 0, range: 1.5, cooldown: A.COOLDOWN.fast },
  // 依据："用触手攻击；能从触手开口放出感染体并指挥它们……考察队 20 人只 4 人活着逃出"→高致死取 severe；
  // 多条触手当手臂、动作快而精准 → 攻击频率取 fast；触手比人类手臂更修长灵活 → range 给长臂档（覆盖 radius 1.5 倍）
  // 选中版本没写命中直接扣多少理智（见下方"对视没法得救"用 sanityPulse 单独实现，不写进 attack.sanity）

  // 行为：住在本层深处、主要目的是猎杀所有进入本层的流浪者 → home 巡逻骨架；丢失目标后原地搜索一阵再回巢
  brain: A.stalker({ patrol: 'home', patrolRadius: 10, alertSec: 0.6, searchSec: 8 }),

  // 自定义 think：骨架追猎行为之外，叠加两条选中版本明确写了、但骨架小工具够用的机制
  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    if (e.dead) return;
    const hs = e.data.hunter || (e.data.hunter = { nextSpawnAt: 0, agents: [] });

    // 依据："一旦和它对视，就没救了"——引擎没有"看一眼就必死"的钩子（见 apiRequests），
    // 用玩家正视 Hunter 时按秒重扣理智近似其致命性；A.sanityPulse 内部调用玩家 damage，
    // 游玩/测试模式下理智改动会被 player.js 忽略，只在噩梦模式真正生效
    if (A.playerLooking(e, 20, 14)) A.sanityPulse(e, api, 14, A.AURA.crushing, 1);

    // 依据："能从触手开口放出感染体并指挥它们"——正在追击/攻击时，从身边"触手开口"处放出感染体一并围攻；
    // 数量上限和冷却原文没给，为避免无限刷怪按游戏性节流（非设定）
    if ((e.state === 'chase' || e.state === 'attack') && api.time >= hs.nextSpawnAt) {
      hs.agents = hs.agents.filter(id => { const a = BR.entities.get(id); return a && !a.dead; });
      if (hs.agents.length < 3) {
        const ang = api.rng() * Math.PI * 2, rad = 0.6 + api.rng() * 0.9;
        // 传 chunkKey 让感染体跟猎手所在区块一起卸载/清理，避免验收发现的"手动生成的实体永远不清"——
        // 猎手自己是区块生成就带 chunkKey，是手动放置（预览等）就是 null，跟着传递即可
        const agent = BR.entities.spawn('infecting_agent', e.x + Math.cos(ang) * rad, null, e.z + Math.sin(ang) * rad, { chunkKey: e.chunkKey });
        if (agent) hs.agents.push(agent.id);
      }
      hs.nextSpawnAt = api.time + 14;
    }
  },

  anim: {
    gait: 'none',            // 没有腿/手臂骨骼，触手摆动完全靠 sway（骨架有 meta.chains 时自动叠加，与 gait 无关）
    sway: 0.32, swaySpeed: 2.0,   // 依据："触手非常灵活，动作快而精准"——比默认摆动更快更明显
    strike: 'grab',           // 依据：触手当"手臂"攻击，抓握比挥砍/撕咬更贴近章鱼触手的攻击方式
    recoil: 0.2, fall: 'crumple',   // 非设定：无定形躯体挨打/死亡用整体塌陷而不是人形后仰/倒地
  },
  // 选中版本 sounds 字段整体标 unverified（层级本身有远处脚步声和低语，但明确写"是否来自猎手没有说明"）
  // → 不加 idle/alert/attack 音效，避免编造未确认的归属

  build() {
    const rig = A.parts.limbCluster({
      count: T_COUNT, segments: T_SEG, length: 1.0, radius: 0.12, tip: 0.025, spread: 0.42,
      // spread 从 0.85 降到 0.42：验收发现旧值几乎把所有触手摊平在同一水平面，读出来像蜘蛛/海星的直腿，
      // 不是原文"向四面八方伸出"的章鱼触手；调低后仰角范围变大，一部分触手明显朝上/朝前探，另一部分贴平，
      // 立体感更接近"到处扭动伸出"的描述（spread 越低越竖直分散，见 _TEMPLATE.md 6.4 节参数说明）
      core: 0.38, coreScale: [1.1, 0.9, 1.05], center: [0, 0.42, 0],
      // 依据："身体不定形"——核心团块压扁拉长，避免看起来像规整的球；center 比旧版本（0.3）抬高到 0.42，
      // 配合下面加长的触手把整体轮廓抬起来（验收发现旧模型实际高度约 1m、核心几乎贴地，比声明的身高矮一半）
      detail: 'low',
      // 依据：验收发现 detail:'high' 加的关节小球和分叉爪尖，在这个构件上读出来像蜘蛛的膝关节和爪子，
      // 而不是原文描述的"扭动的章鱼状触手"；改用 low 挡去掉这些凸起，配合下面的卷曲让触手轮廓更连续光滑，
      // 属于对本实体的针对性例外（不是全局跟着画质走），因为触手本体的卷曲/开口才是外观依据里明确写的细节
      colors: { body: 0x0a0a09, teeth: 0xd9d3c2 },
      // 依据："完全漆黑，笼罩着一层仿佛会吸收所有光源的黑暗"→ 取近黑色（引擎没有吸光特效，用低亮度材质近似，见 apiRequests）；
      // 牙齿颜色原文没给，取苍白色非设定
      look: { body: 'skin', teeth: 'lambert' },
      // 依据："皮肤湿润"→ skin 材质自带斑驳质感更像湿润皮肤；牙齿不发光（原文没提发光，且警告"不要和它对视"更像是视觉/心理暗示而非发光提示）
      key: 'hunter_v2',   // extend 闭包用了 T_COUNT/T_SEG，按第 6.6 节要求给独立缓存 key；改过卷曲逻辑，换新 key 避免撞旧缓存几何

      // 依据："每条触手上都有像嘴一样的小开口，里面长着锋利危险的牙齿，感染体就从这些开口里放出来"
      // 每条触手末端贴一张不发光的牙床（复用 glowFace 的牙齿几何，look 覆盖成 lambert 不发光）
      extend(b) {
        const core = b.pos('core');

        // 让触手真正"卷起来"而不是像蜘蛛腿一样从核心笔直伸出（验收截图里 8 条腿又直又平是本次主要问题）：
        // 给每条触手从第 2 节骨骼开始设一个持续的基础旋转，绕"垂直于该触手水平朝向"的水平轴转一个角度。
        // 因为链条上每节父子关系都是同一根骨骼链（见 buildCluster/b.chain），对同一根轴反复叠加同样大小的
        // 旋转在数学上等价于把整条链弯成一段圆弧，且弯曲平面正好包含这条触手自己伸出的方向——不会因为
        // 各条触手朝向不同而扭到别的方向去。曲率大小本身没有设定依据，纯粹是让"扭动感"读得出来，非设定。
        for (let i = 0; i < T_COUNT; i++) {
          const az = i / T_COUNT * Math.PI * 2 + 0.3;   // 必须和 buildCluster 内部方位角公式一致，否则弯曲方向和触手实际朝向对不上
          const axis = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
          const sign = (i % 2 === 0) ? 1 : -1;           // 一半往外卷、一半往回卷，8 条腕不会长成同一个姿势
          const step = (0.32 + (i % 3) * 0.07) * sign;   // 幅度错开三档，进一步避免看起来整齐划一
          const eu = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, step), 'XYZ');
          for (let k = 1; k < T_SEG; k++) b.setBase('t' + i + '_' + k, eu.x, eu.y, eu.z);

          const tipBone = 't' + i + '_' + (T_SEG - 1);
          const p = b.pos(tipBone);
          const ox = p[0] - core[0], oz = p[2] - core[2];
          const yaw = Math.atan2(-ox, -oz);   // 面朝 -Z 的朝向公式：朝向核心指向触手尖端的方向（见 _TEMPLATE.md 第 13 节坑）
          const g = A.geo.glowFace({ width: 0.22, eyes: 0, teeth: 6, rows: 1, smile: true, toothShape: 'fang', toothH: 0.035 });
          // 注意：smileWidth/toothH 是绝对米数，不是相对 width 的倍数——这里不传 smileWidth（缺省 width*0.8），toothH 给小值
          g.rotateY(yaw).translate(p[0], p[1], p[2]);
          // 贴到 tipBone 的几何按骨骼绑定关系跟着卷曲一起转，牙床仍然朝着触手末梢当前指向的方向，不用额外处理
          b.geo(tipBone, 'teeth', g);
        }
      },
    });
    return A.wrap(rig, { label: 'hunter', budget: 4000 });
  },
});
})();

// notImplemented（返回值里会再列一遍）：
// - "和它对视就没救了"的确定性致死效果：引擎没有"玩家看向某实体触发必死/特殊状态"的钩子，
//   用 A.sanityPulse 在玩家正视它时按秒重扣理智（噩梦模式生效）近似其致命性，不是真正的必死判定。
// - "把人拖进刑讯室慢慢折磨致死"：来源本身标注"未证实的报告"，且引擎没有抓取/拖拽玩家离开当前位置的能力，不实现。
// - "完全吸收光源的黑暗"：引擎没有吸光特效，只用近黑色材质近似。
// - 眼睛具体样子：原文明确说"没有发光部位"且警告不要对视但没写眼睛长什么样，本文件没有做眼睛（faceless）。
