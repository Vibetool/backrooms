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
    return A.wrap(A.parts.humanoid({
      height: 2.5, thin: 0.95, hunch: 0.3, armLen: 1.7, legLen: 1.12, headSize: 0.85, neck: 1.6, shoulders: 0.85,
      head: 'none', hands: true, feet: true, claws: 3,
      // 瘦长、手臂垂过膝盖、长脖子、细长指尖；头不用内置的，下面用两半蛋壳自己拼，才能整颗从中间裂开
      colors: { body: 0x111113, head: 0x131316, claw: 0x1c1c1e, hair: 0x3b0c0c, glow: 0xd8d0bc },
      look: { body: 'skin', head: 'skin', claw: 'lambert', hair: 'lambert', glow: 'lambert' },
      // 通体近黑；hair 槽位借来画裂开后露出的暗红切面，glow 槽位画牙（显式 lambert：它的牙不发光）
      key: 'bacteria_kane_v2',
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
      },
    }), { label: 'bacteria' });
  },
});
})();
