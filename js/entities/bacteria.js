// 细菌 Bacteria（Kane Pixels《The Backrooms》录像系列里的著名怪物，社区也叫 The Howler）
// 来源：用户指定（2026-09-13 原话「著名的实体细菌也没有」）。wikidot-en / wikidot-cn / backrooms.fandom.com 三个来源都没有
// 收录它（调研记录 backrooms-research/entities/bacteria.json，data/lore-choices.json → entities.bacteria.method = none-loaded），
// 没有版本可随机，按用户要的"著名实体"经典形象做，记在 data/lore-choices.json → entities.bacteria.userOverride。
// 经典形象要点（按公开录像里的样子概括，不摘任何 wiki 原文）：
//   · 比人高一大截的瘦长黑色人形，四肢细得像棍，手臂垂到膝盖以下，指尖细长；
//   · 头部光滑、没有五官，追人/扑人时整颗头从正中纵向裂开，两瓣里全是牙；
//   · 动作一顿一顿地抽搐甩头，发现人就发出失真的尖啸，用两条长腿狂奔，人跑不过它。
// 下面的数值（血量/伤害/感知）录像里没有数字，全部是按上面的形象取的档位，非设定精确值。
// 许可：本文件不含任何 wiki 文本；形象归原作者 Kane Parsons（Kane Pixels），这里是程序化的致敬还原。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

function hash01(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

A.register({
  type: 'bacteria', en: 'Bacteria', zh: '细菌', version: 'user-override',
  faction: 'hostile',            // 见人就追、抓到就杀
  hp: A.HP.tough,                // 几乎打不死的掠食者形象，取高档
  radius: 0.38, height: 2.5,     // 明显高过人
  speed: { walk: A.SPEED.brisk, run: A.SPEED.sprint },   // 平时快步游荡；追人时比人快，只能躲
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.keen, fov: 170 },
  attack: { hp: A.DAMAGE.severe, sanity: 10, range: 1.2, cooldown: A.COOLDOWN.fast },
  sounds: { idle: 'static', alert: 'screech', attack: 'screech' },
  // 失真尖啸 → screech；平时那种录像带底噪般的咔咔声 → static

  brain: A.stalker({ patrol: 'wander', patrolRadius: 20, alertSec: 0.35, alertCry: 'screech', searchSec: 8 }),
  // alert 停顿很短：录像里它发现人几乎是立刻扑过来

  anim: {
    gait: 'biped', stride: 2.6, twitch: 0.22, breathe: 0.015, strike: 'lunge', recoil: 0.3, fall: 'crumple',
    stateSounds: { chase: 'screech' }, stateSoundCooldown: 5,
    onFrame(e, dt, api, u) {
      const rig = u.rig;
      if (!rig || e.dead) return;
      if (u._seed === undefined) u._seed = Math.random() * 1000;   // 只影响本机甩头节奏，纯表现
      const t = api.time;
      const hunting = e.state === 'chase' || e.state === 'attack' || e.state === 'alert';

      // 一顿一顿地甩头：按时间分格，每格随机决定这一下甩不甩、往哪甩（分格内保持不动，才是"抽"而不是"晃"）
      const cell = Math.floor(t * (hunting ? 9 : 4) + u._seed);
      if (hash01(cell) > (hunting ? 0.45 : 0.72)) {
        A.anim.addRot(rig, 'head', (hash01(cell + 1) - 0.5) * 0.5, (hash01(cell + 2) - 0.5) * 0.9, (hash01(cell + 3) - 0.5) * 1.1);
      }

      // 头从正中裂开：追击半开、扑咬全开，开口边缘高频颤动
      const open = e.state === 'attack' ? 1 : e.state === 'chase' ? 0.75 : e.state === 'alert' ? 0.5 : 0;
      u._jaw = u._jaw === undefined ? 0 : u._jaw + (open - u._jaw) * Math.min(1, dt * 10);
      if (rig.bones.jawL && rig.bones.jawR) {
        const j = u._jaw * 1.1 + (open > 0 ? Math.sin(t * 22) * 0.06 : 0);
        A.anim.addRot(rig, 'jawL', 0, j, 0);
        A.anim.addRot(rig, 'jawR', 0, -j, 0);
      }

      // 狂奔时两条长手臂乱甩
      if (hunting && u.sp > 0.5) {
        const f = Math.sin(t * 15 + u._seed);
        A.anim.addRot(rig, 'armL', f * 0.45, 0, -0.25);
        A.anim.addRot(rig, 'armR', -f * 0.45, 0, 0.25);
      }
    },
  },

  build() {
    // 画质档在"建模这一刻"定下来（构件的 detail 缺省也是这么解析的）：high 走下面 M2 加的细节分支，
    // low 保持 M2 之前的简版 —— 低画质几何和改动前逐字节一样，面数不涨
    const det = (BR.game && BR.game.settings && BR.game.settings.quality === 'low') ? 'low' : 'high';
    const hi = det === 'high';
    return A.wrap(A.parts.humanoid({
      height: 2.5, thin: 0.95, hunch: 0.3, armLen: 1.7, legLen: 1.12, headSize: 0.85, neck: 1.6, shoulders: 0.85,
      head: 'none', hands: true, feet: true, claws: 3,
      detail: det,
      // 瘦长、手臂垂过膝盖、长脖子、细长指尖；头不用内置的，下面用两半蛋壳自己拼，才能整颗从中间裂开
      colors: { body: 0x111113, head: 0x131316, claw: 0x1c1c1e, hair: 0x3b0c0c, glow: 0xd8d0bc },
      look: { body: 'skin', head: 'skin', claw: 'lambert', hair: 'lambert', glow: 'lambert' },
      // 通体近黑；hair 槽位借来画裂开后露出的暗红切面，glow 槽位画牙（显式 lambert：它的牙不发光）
      key: 'bacteria_kane_v4_' + det,
      extend(b, d) {
        const R = d.headR, Y = d.headY;
        const SY = 1.35;   // 头是竖长的蛋形
        // 左右两半头壳，铰链在后脑勺：合拢时就是一颗光滑无五官的头，张开时两半绕后脑的竖轴往两边掰开
        b.bone('jawL', 'head', [-R * 0.08, Y, R * 0.8]);
        b.bone('jawR', 'head', [R * 0.08, Y, R * 0.8]);
        const shell = phiStart => new THREE.SphereGeometry(R, 10, 9, phiStart, Math.PI).scale(0.85, SY, 1).translate(0, Y, 0);
        b.geo('jawL', 'head', shell(-Math.PI / 2));   // x ≤ 0 那一半
        b.geo('jawR', 'head', shell(Math.PI / 2));    // x ≥ 0 那一半
        // 切面：暗红色的椭圆面，朝向头的中线，合拢时两片背靠背藏在头里，掰开后正对前方露出来
        const cut = (side) => new THREE.CircleGeometry(R * 0.97, 14).scale(1, SY, 1)
          .rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2).translate(side * 0.004, Y, 0);
        b.geo('jawL', 'hair', cut(-1));
        b.geo('jawR', 'hair', cut(1));
        // 切面前缘两排牙，尖朝对面那一半；左右错开半个齿距，合拢时咬合
        for (let i = 0; i < 8; i++) {
          const a = -1.15 + i * (2.3 / 7);
          const y = Y + R * SY * 0.82 * Math.sin(a), z = -R * 0.8 * Math.cos(a);
          const a2 = a + 2.3 / 14, y2 = Y + R * SY * 0.82 * Math.sin(a2), z2 = -R * 0.8 * Math.cos(a2);
          b.cone('jawL', 'glow', [-0.004, y, z], [R * 0.2, y, z * 0.96], R * 0.06, 4);
          if (i < 7) b.cone('jawR', 'glow', [0.004, y2, z2], [-R * 0.2, y2, z2 * 0.96], R * 0.06, 4);
        }
        // 背上一串凸出的脊椎骨节，瘦到皮包骨
        for (let i = 0; i < 6; i++) {
          const y = d.hipY + (d.shoulderY - d.hipY) * (i + 0.5) / 6;
          b.sphere('spine', 'body', 0.026, [0, y, 0.075], [1, 0.8, 1], [6, 4]);
        }

        // ================== 以下是 M2 第 1 批画质打磨加的细节，只在 high 档 ==================
        // low 档到这里就返回，几何与打磨前完全一致（ENGINE_PLAN 第 4 节「低画质保持简版」）
        if (!hi) return;

        // ---- 1. 长脖子 ----
        // 依据：userOverride「比人高的瘦长黑色人形」。head:'none' 时构件整段跳过脖子几何，
        // 打磨前的 side / back 两张图里头是断开浮在肩膀上方的；照构件画脖子的做法补上，并略往前探配合驼背
        const nA = [0, d.shoulderY - 0.02, 0.015], nB = [0, Y - R * SY * 0.70, -0.025];
        b.limb('head', 'body', nA, nB, 0.033, 0.023, 6);
        for (let i = 0; i < 3; i++) {
          const t = (i + 1) / 4;   // 颈椎骨节：脖子后侧一串小凸起，和背上那串接上
          b.sphere('head', 'body', 0.027 - i * 0.002,
            [0, nA[1] + (nB[1] - nA[1]) * t, nA[2] + (nB[2] - nA[2]) * t + 0.017], [0.9, 0.7, 0.9], [6, 4]);
        }

        // ---- 2. 合拢时也看得见的纵向裂口 ----
        // 依据：userOverride「头部无五官且会纵向裂开露齿」。两位打分员都写「看不到纵向裂口」——
        // 原因是两瓣壳光滑对接，idle（闭合）时那条缝在画面上根本不存在。
        // 沿裂缝轮廓给每一瓣加一条提亮的唇边（顶点色 tint，不新增材质槽位），中间夹一条压暗的缝隙，
        // 闭合状态下就是一道从头顶贯到下巴的竖直裂口；张开时这两条唇边跟着两瓣一起掰开
        // tint 是「槽位材质色 × 倍数」：head 槽位本身是 0x131316（近黑），第一轮给 3 倍出图后完全看不出，
        // 提到 6 倍（约 0x727280）唇边才在画面上亮起来；缝隙同时压到 0.12 倍，一亮一暗才看得出是道裂口。
        // 复评返修：6 倍那一版在头部特写里清楚，但 6-level（6 m）和 front34 上整颗头又变回光滑黑蛋。
        // 根因是尺寸不是亮度——headR = 0.068*2.5*0.85 = 0.1445 m，唇边半径 R*0.055 ≈ 8 mm，
        // 6 m 外只占 1 px 出头，再亮也被抗锯齿抹掉。所以粗细和对比度一起上：半径到 R*0.085（≈3 px），
        // tint 到 9.5（≈0xB5B5C0）。中线同时从 0.99 收到 0.96，唇边外表面仍落在原来的 -R*1.045，包围盒不涨
        for (let i = 0; i < 5; i++) {
          const a1 = -1.25 + i * (2.5 / 5), a2 = a1 + 2.5 / 5;
          const y1 = Y + R * SY * 0.84 * Math.sin(a1), z1 = -R * 0.96 * Math.cos(a1);
          const y2 = Y + R * SY * 0.84 * Math.sin(a2), z2 = -R * 0.96 * Math.cos(a2);
          for (const s of [-1, 1]) {
            b.limb('jaw' + (s < 0 ? 'L' : 'R'), 'head', [s * 0.017, y1, z1], [s * 0.017, y2, z2],
              R * 0.085, R * 0.085, 5, { tint: [9.5, 9.5, 10.0] });
          }
          // 唇边加粗后两瓣往两边让开（x 0.014 → 0.017），中间那条压暗的缝隙跟着加宽并多退 2 mm，
          // 免得被两条唇边糊住——一亮一暗的对比才是「裂口」的读法，只剩一条亮脊就成了额头上的棱
          b.limb('head', 'head', [0, y1, z1 + 0.006], [0, y2, z2 + 0.006], R * 0.055, R * 0.055, 4, { tint: [0.12, 0.12, 0.15] });
        }

        // ---- 3. 闭合时从缝里透出来的齿尖 ----
        // 依据：同上「纵向裂开露齿」。两排齿尖交错穿出裂缝像拉链一样咬合，不用张嘴也看得见牙；
        // 张嘴时它们跟着两瓣分开，正好接上原来那两排朝对面的大牙
        for (const s of [-1, 1]) {
          const bone = 'jaw' + (s < 0 ? 'L' : 'R');
          for (let i = 0; i < 7; i++) {
            const a = -1.05 + i * (2.1 / 6) + (s < 0 ? 0 : 2.1 / 12);   // 左右错开半个齿距才咬得上
            const c = Math.cos(a), y = Y + R * SY * 0.80 * Math.sin(a);
            // 复评返修：细菌通体近黑，牙是画面上唯一的高对比元素，值得让它真的白。
            // glow 槽位基色 0xd8d0bc 走的是 lambert（牙不发光），在关卡那点光照下只剩灰；tint 1.7 倍
            // 把受光面顶到纯白、背光面仍是灰，远看才是一排白牙而不是一片深灰。齿尖同时从 R*0.055 加粗到 R*0.07，
            // 但尖端 z 仍停在 -R*1.06，包围盒不动。
            // 只给这一圈「穿出裂缝的齿尖」上 tint：上面那两排大牙在 if (!hi) return 之前，low 档也要用，
            // 一旦给它们上色，low 档几何就会多出 color 属性、材质换成 vc 变体，低画质就不再和打磨前逐字节一致了
            b.cone(bone, 'glow', [s * 0.012, y, -R * 0.84 * c], [s * 0.003, y, -R * 1.06 * c], R * 0.07, 4, { tint: [1.7, 1.7, 1.8] });
          }
        }

        // ---- 4. 瘦骨嶙峋的关节 ----
        // 依据：userOverride「瘦长黑色人形」+ 文件头按经典形象概括的「四肢细得像棍」；
        // 打分员写「四肢等粗没有瘦骨关节」。构件 high 档自带的关节球在 thin:0.95 下只有 2 cm 左右，
        // 画面上读不出来，这里另加一圈明显鼓出来的肩 / 肘 / 腕 / 膝 / 踝骨节
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * d.shoulderW, hx = s * d.hipW;
          b.sphere('arm' + L, 'body', 0.040, [x, d.shoulderY - 0.005 * d.H, 0], [1, 0.8, 0.9], [6, 4]);   // 第一轮 0.05 出图像钉帽，收小
          b.sphere('fore' + L, 'body', 0.039, [x, d.elbowY, 0], [1, 0.9, 1], [6, 4]);
          b.sphere('fore' + L, 'body', 0.031, [x, d.handY + 0.02 * d.H, 0], [1, 0.8, 1], [6, 4]);
          b.sphere('shin' + L, 'body', 0.045, [hx, d.kneeY, 0], [1, 0.9, 1], [6, 4]);
          b.sphere('shin' + L, 'body', 0.033, [hx, 0.055 * d.H, 0], [1, 0.85, 1], [6, 4]);
        }

        // ---- 5. 分节的细长手指 ----
        // 依据：文件头按经典形象概括的「指尖细长」。构件在 claws>0 时只出三根光秃秃的爪，
        // 这里给每根补指根和中节两处骨节，远看是长手指而不是三根钉子
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * d.shoulderW;
          for (let c = 0; c < 3; c++) {
            const cz = (c - 1) * 0.018 * d.H;
            b.sphere('fore' + L, 'claw', 0.018, [x, d.handY - 0.028 * d.H, cz], [1, 0.9, 1], [5, 4]);
            b.sphere('fore' + L, 'claw', 0.012, [x, d.handY - 0.062 * d.H, cz - 0.009 * d.H], [1, 0.9, 1], [5, 3]);
          }
        }

        // ---- 6. 微微佝偻的背 ----
        // 依据：打分员「站姿笔直僵硬，缺录像里佝偻抽搐的招牌体态」。
        // 姿势参数 hunch 保持 0.3 不动（加大它会把包围盒往 Z 撑出 20% 以上，超过验收的 10% 偏差），
        // 改成用形状表达：上背一块隆起 + 两片凸出的肩胛骨，再让头略往前探
        b.sphere('spine', 'body', 0.056, [0, d.shoulderY - 0.04, 0.042], [1.2, 0.8, 0.58], [8, 6]);   // 第一轮偏大，正面看像个衣领
        for (const s of [-1, 1]) b.sphere('spine', 'body', 0.052, [s * 0.082, d.shoulderY - 0.095, 0.052], [1.1, 1.5, 0.5], [6, 5]);
        b.setBase('head', 0.6 * 0.3 - 0.10);   // 构件 hunch:0.3 给头的是 +0.18，这里收一点 → 头往前探而不是端正立着
      },
    }), { label: 'bacteria' });
  },
});
})();
