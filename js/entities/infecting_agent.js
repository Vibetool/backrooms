// 感染体 Infecting Agents（fandom Level 14 "Inhospitality" 页面里猎手的附属实体，无独立编号）
// 来源版本：fandom  URL：https://backrooms.fandom.com/wiki/Level_14  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（wikidot-en/wikidot-cn 的 Level 14 是完全不同的
// "Paradise/天堂" 森林层级，没有这个实体，见 backrooms-research/entities/infecting_agent.json 的 conflicts）
// 调研摘要来自 WebSearch 对该页面的多次总结，没有逐字核对原文。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

A.register({
  type: 'infecting_agent', en: 'Infecting Agents', zh: '感染体', version: 'fandom',
  faction: 'hostile',   // 依据：hostility = hostile

  hp: A.HP.fragile,            // 非设定：原文只写"小型"，没给耐久数值；体型小取最低档
  radius: 0.22, height: 0.2,   // 非设定：size 只写"小型（没有数字）"，按贴地小型蠕虫/水蛭估算。
  // 验收发现原来 0.16/0.14 太小，几米外就只是地上一个灰点；仍在"小型"范围内适当放大（约放大 1.4 倍），
  // 不算脱离原文数字（本来就没有数字）
  speed: { walk: A.SPEED.jog, run: A.SPEED.sprint },
  // 依据："速度极快（没有数字）"→ 明显比人快，取比人步行快很多、冲刺也追不上的 sprint 档；
  // 平时游荡速度原文没写，非设定给 jog

  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 200 },
  // 非设定默认值：感官(senses)原文没写；有无眼睛也 unverified，fov 只是行为判定用的抽象索敌角度，不代表真的有眼睛

  attack: { hp: A.DAMAGE.heavy, sanity: 0, range: 0.45, cooldown: A.COOLDOWN.flurry },
  // 依据："满口剃刀牙；会用从腐蚀性酸液到致命毒素不等的物质来捕获猎物"——手段不定、原文没给单次杀伤力的确切数字，
  // 只明确出现"致命"字样；小型多齿生物快速啃咬 → 攻击频率取最快档 flurry（原文没给攻击频率，非设定）。
  // 验收发现原来配的 severe(55) + flurry(0.45s) 两下（0.45s 内）就打满 100 血玩家/测试人，等于单只就秒杀，
  // 跟本行原本"severe 比 lethal 低一档、不一定打死"的理由对不上；改成 heavy(35)，单只三下、约 1.2~1.4s
  // 才能打满，符合"不一定致命"，同时猎手一次放出的最多 3 只叠加咬同一目标时仍然很快致命，
  // 呼应"考察队 20 人只 4 人活着逃出"这句描述的整体杀伤力

  // 依据："从猎手触手上的开口里被放出来……主要目的是猎杀所有进入本层的流浪者"（层级行为段落）——
  // 一旦出现就主动搜寻猎物，没有固定巢穴描述，用 wander 巡逻 + 很短的警觉时间体现"被放出来就立刻扑上去"
  brain: A.stalker({ patrol: 'wander', patrolRadius: 6, alertSec: 0.2, searchSec: 4 }),

  anim: {
    gait: 'none',              // 没有腿，靠身体链的 sway 表现蠕动
    sway: 0.45, swaySpeed: 3.2,   // 依据："贴着地面蠕动爬行""速度极快"——摆动幅度大、频率高，体现快速蠕动感
    strike: 'bite', recoil: 0.12, fall: 'fade',   // 非设定：小型生物挨打幅度小，死亡直接消融比倒地动画更贴近"小虫"体量
  },
  // 选中版本没有 sounds 字段（连 unverified 都没标注，字段本身缺失）→ 不加任何音效，避免编造

  build() {
    const rig = A.parts.rig('infecting_agent_v2', b => {
      // 验收发现原尺寸（len 0.34）离远几米就只是地上一个灰点；整体放大约 1.4 倍（跟上面 radius/height 一致），
      // 仍在"小型"范围内，只是从几乎看不见改成勉强看得清形状
      const segN = 4, len = 0.48, rTail = 0.03, rHead = 0.085, startZ = 0.24, H = 0.085;
      // 依据："贴着地面蠕动爬行"——没有腿，用一条由细到粗的骨骼链表示水蛭/蠕虫状身体，
      // 头端（-Z，朝向前方）略粗一圈，尾端（+Z）细尖；H 取接近粗端半径，让身体贴地
      const segs = b.chain('seg', null, [0, H, startZ], [0, 0, -1], segN, len, rTail, rHead, 'body', 6);
      const head = segs[segN - 1];
      const tipZ = startZ - len;   // 链条末端（头部）的绝对 Z 坐标
      b.sphere(head, 'body', rHead * 1.05, [0, H, tipZ], null, [6, 5]);
      // 依据："嘴里长满一排排锋利的剃刀状牙齿"——头部前端贴一排不发光的牙齿（复用 glowFace 的牙齿几何，
      // eyes:0 因为"有无眼睛 unverified"不做眼睛；look 覆盖成 lambert 不发光）
      const g = A.geo.glowFace({ width: 0.22, eyes: 0, teeth: 8, rows: 2, smile: true, toothShape: 'fang', toothH: 0.04 });
      // 注意：smileWidth/toothH 是绝对米数，不是相对 width 的倍数——这里都不传/给小值，避免嘴巴比头还宽
      g.translate(0, H, tipZ - 0.04);   // glowFace 默认面朝 -Z，正好对着身体前进方向，不需要额外旋转
      b.geo(head, 'teeth', g);
    }, {
      colors: { body: 0x2e2419, teeth: 0xdedad0 },
      // 依据：appearance 明确写"颜色、质感、有无眼睛 unverified"——颜色本身非设定；验收发现原来的
      // 0x453a34 配 skin 材质在关卡灯光下偏灰、跟地面分不出来，改深一档并换 chitin 材质
      // （环节状明暗横纹，见 A.mat.chitin）：横纹里较亮的高光条带一点湿润感，比纯 skin 的柔和斑驳更容易认出轮廓
      look: { body: 'chitin', teeth: 'lambert' },
    });
    return A.wrap(rig, { label: 'infecting_agent', budget: 4000 });
  },
});
})();

// notImplemented（返回值里会再列一遍）：
// - "受猎手控制，猎手下的任何命令都不假思索地执行"：引擎没有实体间的实时指挥/远程控制系统，
//   本文件只让猎手在追击/攻击时把它生成在自己身边（见 hunter.js），生成后按独立的追猎 AI 行动，
//   不是真正被猎手逐帧操控。
// - 具体致死细节（酸液/毒素怎么造成伤害）：原文本身标 unverified，按直接接触伤害处理。
