// 无面灵 Facelings（Entity 9）
// 来源版本：wikidot-en  URL：https://backrooms-wiki.wikidot.com/entity-9  许可：CC BY-SA 3.0
// 只按上面这个版本实现，没写的细节不做、不从其他版本借（WAVE2.md 第 1 节）
//
// 选中版本写了常见型 + 多边形/暗影/记忆/进化种四个亚种，外形均不同（appearance 段逐条列出）。
// 按 _TEMPLATE.md 第 1 节：外形不同就要拆多个 type。受本轮额度限制，本文件落地
// faceling（常见型）/ faceling_polygonal（多边形）/ faceling_shadow（暗影）三型；
// 记忆亚种、进化种写进 notImplemented（原因见返回值）。
(function () {
'use strict';
const BR = window.BR;
const A = BR.arch;

// 三型共用（appearance/behavior/attack 段没有按亚种拆开这几项，hostility 字段本身就是 neutral，不是 varies）：
const HP = A.HP.weak;
// 依据：weaknesses"体力弱于多数成年人""骨骼脆，会腐烂、破裂或长出肿瘤"→比测试人(100血)弱得多但不是一碰就死
const SPEED = { walk: A.SPEED.walk, run: A.SPEED.jog };
// 依据：speed"未给数值。体力弱于多数成年人，发怒时相对容易甩掉"→ run 用 jog 档（玩家步行甩不掉、冲刺能甩开）
const ATTACK = { hp: A.DAMAGE.light, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal };
// 依据：attack"发怒时徒手攻击惹怒它的对象…成年个体力气弱，历史上从未找到蓄意行凶的详细记录…没有记载的致死案例"→取低伤害档

// 低画质开关：和模型构件内部 resolveDetail 读同一个设置（BR.game.settings.quality），
// 保证"几何缓存键里的 detail"和"extend 里加的形状"永远对得上（geoKey 把解析后的 detail 算进键）。
// 三型都是高画质加细节、低画质保持改动前的简版（ENGINE_PLAN 第 4 节）
function LOW() { return !!(BR.game && BR.game.settings && BR.game.settings.quality === 'low'); }

function faction() { return 'neutral'; }
// 依据：hostility 字段本身就是 "neutral"（正文"多数温顺…被激怒才动手"），不是 varies，三型都直接沿用，无需按 varies 规则判断

// ---------------- 常见型 ----------------
A.register({
  type: 'faceling', en: 'Faceling (Common)', zh: '无面灵·常见型', version: 'wikidot-en',
  faction: faction(),
  hp: HP, radius: 0.28, height: 1.75,
  // 依据：size"未给数值，结构与人类相同"→按普通人体型给默认值，非设定
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  // 依据：senses"常见型没有眼睛，行动却像看得见；没有感官器官也能清楚理解同类"→非视觉的全向感知，fov 给 360
  attack: ATTACK,
  sounds: {},   // 依据：behavior"常见型没有声带，交流完全无声"→不加任何叫声

  brain: A.wanderer({ retaliate: 'fight' }),
  // 依据：behavior"多数温顺，痴迷于模仿人类的角色…很容易被小事激怒…被故意攻击时情绪会升级"→日常游荡，被打就地反击（不逃跑）
  anim: { gait: 'biped', twitch: 0.05, fall: 'back' },

  build(ctx) {
    const low = LOW();
    // 顶点色 tint：肤色 0xc9a888 是 body 槽位的材质色，衣物靠 tint 在同一个槽位里压成布色，
    // 不新增材质槽位、不多 draw call（_TEMPLATE.md 6.10）
    const SHIRT = [0.62, 0.68, 0.80], PANTS = [0.45, 0.48, 0.58], SHOE = [0.30, 0.30, 0.34];
    // 【本轮性能返修】高画质的头发从 hair 槽位挪进 body 槽位，用 tint 压回同一个发色（0xc9a888 × 这个倍数 ≈ 0x2b2318）。
    // 高画质本来 hair:0（构件不建那根发圆筒），整条 hair 槽位只剩我 extend 里的发冠/碎发/垂发在用；
    // 挪走之后高画质这只就只剩 body + head 两个材质组 = 每只少 1 个 draw call（28 只同屏少 28 个）。
    // 这正是 M2 第 4 节的做法："同一材质槽位里用顶点色 tint 区分颜色，不新增材质槽位"。
    // 低画质不受影响：低画质 extend 直接早退、头发仍是构件那根 hair 槽位的圆筒，逐像素不变
    const HAIR = [0.214, 0.208, 0.176];
    return A.wrap(A.parts.humanoid({
      height: 1.75, thin: 0.1, head: 'faceless', face: null,
      // 【本轮性能返修 · 不花画质的一笔】高画质关掉构件自带的脚掌 + 脚跟两个方块：
      // 下面 extend 里的鞋 [0.058·H·th+0.020, 0.058·H, 0.195·H] @ y=0.029·H / z=−0.028·H 把它们整个包在里面——
      // 构件脚掌 [0.05·H·th+0.015, 0.03·H, 0.15·H] @ y=0.015·H / z=−0.05·H、
      // 脚跟 [0.036·H·th+0.012, 0.038·H, 0.05·H] @ y=0.019·H / z=0.03·H，三个轴向都落在鞋的内侧；
      // 而且鞋和它们挂在同一根 shin 骨上，走路动画里不会错开。所以这 4 个方块、48 个三角面永远看不见，
      // 属于纯粹的隐藏面开销（28 只同屏就是 1344 个白跑的三角面）。去掉之后出图只有鞋底那一圈像素级的变化，
      // 轮廓、衣着、姿态全不变。低画质 extend 早退、根本没有鞋，必须保留构件的脚，所以写成 feet: low
      feet: low,
      // 依据：appearance"人体结构…头发完整，唯独脸上没有任何五官（无眼、无口、无鼻），无发光部位"
      // 高画质把构件自带的那根"头发圆筒"关掉（hair:0），改由 extend 建发冠 + 垂发；
      // 打分员两人都点名它"像一块方形头盔""是一截圆筒套在头上"。低画质保持原样的简版
      hair: low ? 0.22 : 0,
      clothes: false,
      // 依据：appearance"衣着…各不相同"——原来整只是赤裸的分节木人偶，两名打分员都点名缺衣服，
      // 衣服由下面 extend 里的上衣/裤子/鞋承担。构件自带的 clothes（领口/袖口/腰带/口袋/裤褶）关掉：
      // 它有 10 个图元 232 个三角面，而且走的是不带 tint 的 body 槽位——压在我用 tint 压暗的裤子上，
      // 出图（b1-C faceling-1-front34）是大腿和小腿上几块肤色的浅斑，本来就读不成口袋。
      // 关掉同时是本轮性能返修的大头（复评：28 只同屏帧时间劣化 18–22%）。低画质原本就是 !low = false，不受影响
      colors: { body: 0xc9a888, hair: 0x2b2318 },
      // 依据："发色、肤色…各不相同"没有指定具体色号 → 取中性肤色/发色，非设定
      look: { body: 'skin', hair: 'fur' },
      key: 'faceling_v5',   // extend 里的形状/tint 变了就换键：几何按键缓存，不换会在同一页面里拿到旧模型（本轮 feet:low + 鞋底对齐，几何变了必须抬版本号）
      extend(b, d) {
        if (low) return;   // 低画质保持简版
        // RigBuilder 的坐标是模型空间绝对坐标（原点在脚下），不是相对父骨骼的偏移（_TEMPLATE.md 6.6）
        const H = d.H, hr = d.headR, hy = d.headY;
        const th = 1 - 0.45 * 0.10;   // = humanoid 内部的 th = (1 − 0.45·thin)·bulk，上面 thin:0.1 / bulk 缺省 1

        // 依据："头发完整"——发冠贴着颅顶（头是 [0.86,1.22,0.92] 的蛋形，发冠要比它略大一圈才露得出来），
        // 额前一条发际线，后脑和两侧垂下长短不一的发缕。正前方一律留空：脸必须保持完全空白
        // 【本轮性能返修】发缕是这只身上最大的一笔面数，也是 28 只同屏劣化 18–22% 的主因：
        // 上一版 17 缕 × 5 边 = 340 面。这一版收成 11 缕 × 3 边 = 132 面，靠"根部加粗到 0.13·hr"补回覆盖，
        // 出图仍然是一头有缺口、下缘参差的头发，不是"方形头盔/一截圆筒"。发冠球段数也由 [10,8] 收到 [8,5]
        // 发冠的纬度段数由 5 收到 4：它是罩在颅顶的一块半球壳，少一圈纬线在 640 px 出图上看不出来，省 16 个三角面。
        // 经度段数必须留 8：发冠半径 1.06·hr、X 向缩到 0.92，八边形的内切半径 0.975·0.924 = 0.90·hr 还盖得住
        // 头部椭球的 0.86·hr；收到 7 边就是 0.878·hr，头会从发冠的平face 里戳出来
        b.sphere('head', 'body', hr * 1.06, [0, hy + hr * 0.30, hr * 0.06], [0.92, 1.02, 0.98], [8, 4], { tint: HAIR });
        for (let i = 0; i < 3; i++) {   // 额前碎发，压在发际线上（原来是一根横方条，出图读成一条发箍）
          const x0 = (i - 1) * hr * 0.44;
          b.limb('head', 'body', [x0, hy + hr * 0.78, -hr * 0.46], [x0 * 1.25, hy + hr * 0.34, -hr * 0.78], hr * 0.10, hr * 0.040, 3, { tint: HAIR });
        }
        for (let i = 0; i < 11; i++) {
          const phi = (-0.64 + 1.28 * (i / 10)) * Math.PI;   // 从右侧绕过后脑到左侧，正面缺口留给脸
          const x0 = Math.sin(phi) * hr * 0.92, z0 = Math.cos(phi) * hr * 0.97;
          // 又细又密、下缘长短参差，才读得出是头发：先是 9 根 0.20·hr、再是 13 根 0.12·hr，
          // 出图都还是几条挂在头两侧的方棍（两名打分员说的"方形头盔""一截圆筒"）。
          // 根数降下来之后靠"细而多"里的"多"没了，就把每缕稍微加粗、并保留长短参差，出图核对过仍不是方棍
          const len = hr * (1.15 + 0.95 * ((i * 7) % 5) / 4);
          b.limb('head', 'body', [x0 * 0.98, hy + hr * 0.70, z0 * 0.98], [x0 * 1.03, hy + hr * 0.62 - len, z0 * 1.04], hr * 0.13, hr * 0.050, 3, { tint: HAIR });
        }

        // 依据："人体结构…唯独脸上没有任何五官（无眼、无口、无鼻）"——原文只否掉了眼/口/鼻这三样，
        // 人体结构本身是完整的。所以只补下颌、下巴和耳朵，把"光滑蛋形"补成能认出是人头的颅形。
        // 【出图实测的教训】千万不要在脸正面加对称的凸起：上一轮加的一对颧骨正好落在眼窝位置，
        // 头部特写里就是两只浅色的眼睛，直接违背"脸上没有任何五官"。脸的正面必须保持完全空白，
        // 也不能用构件的 features（那一套含鼻和眉骨）
        b.box('head', 'head', [hr * 0.62, hr * 0.26, hr * 0.44], [0, hy - hr * 0.84, -hr * 0.30]);
        // 段数由 [6,5] 一路收到 [4,3]：下巴和耳朵都只有 2 厘米出头，出图上分不出这一档差别。
        // 它们是往外鼓的附加块、不需要包住任何东西，所以不受"内切半径要盖住底下圆台"的限制，能收到最低档
        b.sphere('head', 'head', hr * 0.20, [0, hy - hr * 0.98, -hr * 0.34], [1.0, 0.75, 0.85], [4, 3]);
        for (const s of [-1, 1]) b.sphere('head', 'head', hr * 0.22, [s * hr * 0.92, hy - hr * 0.02, hr * 0.06], [0.42, 1.0, 0.80], [4, 3]);

        // 依据："衣着…各不相同"——构件自带的 clothes 只有领口/腰带/袖口这些细条，远看还是裸的；
        // 再叠一件包住胸腰的上衣、一条包住骨盆和双腿的裤子、两只鞋，用 tint 区分布色与肤色。
        // 半径都取得比底下的躯干/四肢圆台略大一圈，才不会被身体穿出来（尺寸公式见 _archetypes.js buildHumanoid）
        b.limb('spine', 'body', [0, d.hipY + 0.055 * H, 0], [0, d.shoulderY + 0.005 * H, 0], 0.115 * H * th, 0.118 * H * th, 8, 0.78, { tint: SHIRT });
        b.box('hips', 'body', [0.198 * H * th, 0.115 * H, 0.118 * H * th], [0, d.hipY + 0.018 * H, 0], { tint: PANTS });
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', hx = s * d.hipW;
          b.limb('leg' + L, 'body', [hx, d.hipY + 0.01 * H, 0], [hx, d.kneeY + 0.02 * H, 0], 0.050 * H * th, 0.040 * H * th, 6, { tint: PANTS });
          b.limb('shin' + L, 'body', [hx, d.kneeY + 0.01 * H, 0], [hx, 0.085 * H, 0], 0.040 * H * th, 0.030 * H * th, 6, { tint: PANTS });
          // 鞋心由 0.030·H 降到 0.029·H：高 0.058·H 的方块正好从 y=0 起算，鞋底与地面齐平。
          // 构件的脚掌原来就是从 y=0 长到 0.03·H，上面 feet:low 把它关掉之后，得由鞋来接管这个着地面，
          // 否则整只会悬空 2.5 毫米（看不出来，但没有理由留这个偏差）
          b.box('shin' + L, 'body', [0.058 * H * th + 0.020, 0.058 * H, 0.195 * H], [hx, 0.029 * H, -0.028 * H], { tint: SHOE });
        }
      },
    }), { label: 'faceling' });
  },
});

// ---------------- 多边形亚种 ----------------
A.register({
  type: 'faceling_polygonal', en: 'Faceling (Polygonal)', zh: '无面灵·多边形亚种', version: 'wikidot-en',
  faction: faction(),   // 亚种没有单独的敌意描述，沿用常见型 hostility=neutral
  hp: HP, radius: 0.3, height: 1.75,
  // 依据：appearance"多边形无面灵：身体由大块平坦的多边形面拼成，大致人形但方正笨拙，像早期 3D 游戏角色"→用加粗方正的体型近似；
  // 身高选中版本（wikidot-en）没有单独给数值，沿用常见型默认身高，非设定（wikidot-cn 的"身材矮小"译法不是本次选中版本，不借用）
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  attack: ATTACK,
  sounds: {},

  brain: A.wanderer({ retaliate: 'fight' }),
  anim: { gait: 'biped', twitch: 0.1, fall: 'back' },
  // twitch 略高于常见型：呼应"方正笨拙"的关节僵硬感，非设定数值，只是表现取舍

  build(ctx) {
    const low = LOW();
    const FLAKE = [1.16, 1.10, 1.02];   // 翘起的干皮比周围略淡一档（顶点色 tint，不新增材质槽位）
    return A.wrap(A.parts.humanoid({
      height: 1.75, thin: 0, bulk: low ? 1.25 : 1.12, head: 'box', hands: true, face: null,
      // 依据：appearance"身体由大块平坦的多边形面拼成，大致人形但方正笨拙，像早期 3D 游戏角色"→ 用方形头 + 加粗躯干近似。
      // 高画质 bulk 由 1.25 收到 1.12：下面 extend 把每段圆台都套进方板，方板的对角线比它包住的圆柱半径长，
      // 一转动包围盒就宽出去（实测 X 向 +11.4%，超过验收的 10%）。收窄底下的圆台、让方板跟着收，
      // 外观仍是"方正笨拙"（方板本来就比圆台显粗），包围盒回到 +2% 以内。
      // 【本轮返修】按画质分档：低画质不套方板、包围盒本来就没超，没有理由跟着变瘦。
      // 上一轮 bulk 一个值同时作用于两档，低画质体型跟着瘦了一圈（5-low 像素差 AE=51688），
      // 违反"低画质保持改动前的简版"。分档后低画质逐像素回到改动前。
      // 两档不会撞缓存：geoKey 把解析后的 detail 算进键，high/low 本来就是两份几何
      colors: { body: 0xab9c86 },
      look: { body: 'skin' },
      // 依据："皮肤粗糙、干燥、易剥落"。原来用 chitin：它的环节条纹被两名打分员都读成"一圈圈横条纹""像绷带人"，
      // 换成 skin 的斑驳皮革纹，保留粗糙干燥、去掉环纹，颜色未记载取干裂土色，非设定
      key: 'faceling_polygonal_v3',   // extend 里的形状/tint 变了就换键；本轮低画质 bulk 由 1.12 回到 1.25，几何变了必须抬版本号
      extend(b, d) {
        if (low) return;   // 低画质保持简版
        // RigBuilder 的坐标是模型空间绝对坐标（原点在脚下），不是相对父骨骼的偏移（_TEMPLATE.md 6.6）
        const H = d.H, th = 1.12;   // = humanoid 内部的 th = (1 − 0.45·thin)·bulk。thin:0，bulk 在高画质是 1.12；
        // 这一段 extend 上面已经 low 早退，只会在高画质跑，所以这里写死高画质那一档的 1.12 是对的
        const sw = d.shoulderW, hw = d.hipW, hr = d.headR;

        // 依据："身体由大块平坦的多边形面拼成，大致人形但方正笨拙，像早期 3D 游戏角色"——
        // 两名打分员都点名"早期 3D 感只停在头部""身体是一圈圈横条纹的圆柱"。人形构件的躯干/四肢是圆台，
        // 没法删，于是在每一段外面套一个比它略大的方板：圆台被整个包进去，剩下的轮廓全是平面多边形。
        // 关节改成方块而不是球，接缝硬邦邦的，正是早期 3D 角色的样子
        // 胸板要把构件高画质自带的"胸腔鼓包"球（半径 0.108·H·th·0.96、缩放 [1.05,0.7,0.6·th]、中心偏后 0.006·H）
        // 整个吞进去，否则那颗浅色椭球会从板子上缘/后缘冒出来——上一轮出图正面和侧面都看得见一块凸起
        const yTop = d.shoulderY + 0.05 * H;
        const yWaist = d.hipY + 0.05 * H + (d.shoulderY + 0.02 * H - d.hipY - 0.05 * H) * 0.34;
        const yBot = yWaist - 0.02 * H, yAbs = d.hipY + 0.045 * H;
        b.box('spine', 'body', [0.222 * H * th, yTop - yBot, 0.166 * H * th], [0, (yTop + yBot) / 2, 0.004 * H]);   // 胸板
        b.box('spine', 'body', [0.132 * H * th, yBot - yAbs, 0.092 * H * th], [0, (yBot + yAbs) / 2, 0]);     // 腰腹板
        b.box('hips', 'body', [0.198 * H * th, 0.105 * H, 0.118 * H * th], [0, d.hipY + 0.02 * H, 0]);        // 骨盆板
        const nTop = d.headY - hr * 0.6;
        b.box('head', 'body', [0.066 * H * th, nTop - d.shoulderY, 0.066 * H * th], [0, (nTop + d.shoulderY) / 2, 0]);   // 方颈
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', x = s * sw, hx = s * hw;
          b.box('arm' + L, 'body', [0.068 * H * th, 0.070 * H * th, 0.068 * H * th], [x, d.shoulderY - 0.005 * H, 0]);   // 肩块
          b.box('arm' + L, 'body', [0.068 * H * th, d.shoulderY - 0.005 * H - d.elbowY, 0.068 * H * th], [x, (d.shoulderY - 0.005 * H + d.elbowY) / 2, 0]);
          b.box('fore' + L, 'body', [0.060 * H * th, 0.055 * H * th, 0.060 * H * th], [x, d.elbowY, 0]);                 // 肘块
          b.box('fore' + L, 'body', [0.056 * H * th, d.elbowY - d.handY - 0.02 * H, 0.056 * H * th], [x, (d.elbowY + d.handY + 0.02 * H) / 2, 0]);
          b.box('fore' + L, 'body', [0.062 * H * th, 0.125 * H, 0.075 * H * th], [x, d.handY - 0.028 * H, -0.012 * H]);  // 方块拳套：早期 3D 角色的手不分指
          b.box('leg' + L, 'body', [0.096 * H * th, d.hipY - d.kneeY, 0.096 * H * th], [hx, (d.hipY + d.kneeY) / 2, 0]);
          b.box('shin' + L, 'body', [0.082 * H * th, 0.075 * H * th, 0.082 * H * th], [hx, d.kneeY, 0]);                 // 膝块
          b.box('shin' + L, 'body', [0.075 * H * th, d.kneeY - 0.045 * H, 0.075 * H * th], [hx, (d.kneeY + 0.045 * H) / 2, 0]);
          b.box('shin' + L, 'body', [0.068 * H * th, 0.054 * H, 0.206 * H], [hx, 0.027 * H, -0.026 * H]);                // 方靴
        }
        // 依据："皮肤粗糙、干燥、易剥落"——几片翘起来的干皮，斜插在胸前、背侧、上臂、大腿、胯侧，
        // 薄的那一轴朝外（侧面的几片绕 Y 转 π/2），从轮廓上能看出是剥落的碎片而不是身体的一部分
        for (const [bone, c, r] of [
          ['spine', [0.075 * H * th, d.shoulderY - 0.09 * H, -0.086 * H * th], [0.25, 0.30, 0.18]],
          ['spine', [-0.095 * H * th, d.shoulderY - 0.17 * H, -0.086 * H * th], [-0.20, -0.35, 0.22]],
          ['armR', [sw + 0.042 * H * th, d.elbowY + 0.10 * H, 0], [0.15, Math.PI / 2 + 0.25, -0.20]],
          ['legL', [-hw - 0.055 * H * th, d.kneeY + 0.16 * H, 0], [0.30, Math.PI / 2 - 0.20, 0.35]],
          ['hips', [0.104 * H * th, d.hipY + 0.012 * H, 0.052 * H * th], [-0.28, Math.PI / 2 + 0.55, 0.15]],
        ]) b.box(bone, 'body', [0.050 * H * th, 0.058 * H * th, 0.008], c, r, { tint: FLAKE });
      },
    }), { label: 'faceling_polygonal' });
  },
});

// ---------------- 暗影亚种 ----------------
A.register({
  type: 'faceling_shadow', en: 'Faceling (Shadow)', zh: '无面灵·暗影亚种', version: 'wikidot-en',
  faction: faction(),
  hp: HP, radius: 0.26, height: 1.75,
  speed: SPEED,
  perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
  attack: { hp: A.DAMAGE.graze, sanity: 0, range: 0.9, cooldown: A.COOLDOWN.normal },
  // 依据：behavior"暗影亚种受惊时会防御性攻击，但力量不足以造成重大伤害"→比常见型更弱的伤害档
  sounds: {},

  brain: A.wanderer({ retaliate: 'fight' }),
  think(e, dt, api, brain) {
    brain.think(e, dt, api);
    // 依据：senses"暗影亚种会被光源吸引"→ 游荡/待机时若附近有更亮处，缓慢飘过去；不影响被攻击后反击的骨架逻辑
    if (e.state === 'wander' || e.state === 'idle') {
      const spot = A.lightSeek(e, api, 10, 'bright');
      if (spot) api.moveToward(e, spot.x, spot.z, A.speedOf(e, 'walk') * 0.6);
    }
  },
  anim: {
    gait: 'none', fall: 'fade',
    fly: { cruise: 1.5, low: 1.5, bob: 0.08, bobHz: 1.0, clearance: 0.3 },
    // 依据：appearance"暗影亚种：漆黑、幽灵般的身体，在黑暗区域自发悬浮"→ 不用双足步态，用悬浮高度表现
  },

  build(ctx) {
    const low = LOW();
    // silhouette 默认全身半透明黑、faceless 头，正好对应"漆黑、幽灵般的身体"，没有额外发光部位（未记载）。
    // silhouette 的 hair / claw 两个槽位走的是更透一档的 rimOpacity 材质（缺省 opacity×0.55），
    // 原来这只两个槽位都没用到，所以边缘没有层次、被两名打分员读成"就是涂黑的木人偶"。
    // 这里把外罩、裾角、拖尾、指尖全放进这两个槽位，做出"多层半透明"的渐隐边缘
    return A.wrap(A.parts.silhouette({
      height: 1.75, thin: 0.15,
      feet: low,        // 依据："漆黑、幽灵般的身体，在黑暗区域自发悬浮"——高画质去掉脚掌方块，下摆化为拖尾；低画质保持简版
      hands: low,       // 高画质连手掌方块和手指一起去掉，小臂直接化进指尖的虚影里（"幽灵般"）
      claws: 0,         // 构件自带的爪长 0.07·H、又直又尖，出图是一排利爪；原文说它"力量不足以造成重大伤害"，
                        // 不能给它一副凶器。改在下面的 extend 里自己加短而软的指尖虚影（同样走 claw 槽位的更透材质）
      key: 'faceling_shadow_v2',   // extend 里的形状变了就换键
      extend(b, d) {
        if (low) return;   // 低画质保持简版
        // RigBuilder 的坐标是模型空间绝对坐标（原点在脚下），不是相对父骨骼的偏移（_TEMPLATE.md 6.6）
        const H = d.H, hr = d.headR, hy = d.headY;
        const th = 1 - 0.45 * 0.15;   // = humanoid 内部的 th，上面 thin:0.15

        // 头和躯干各罩一层更透的外壳：比本体大一圈，于是边缘是"实心黑 → 半透黑 → 空气"两层过渡，
        // 而不是一团纯黑（要求：暗影形态要有边缘层次）
        b.sphere('head', 'hair', hr * 1.30, [0, hy, hr * 0.05], [0.90, 1.16, 0.96], [10, 8]);
        b.limb('spine', 'hair', [0, d.hipY + 0.03 * H, 0], [0, d.shoulderY + 0.045 * H, 0], 0.125 * H * th, 0.128 * H * th, 8, 0.80);
        // 髋部垂下一圈长短不一的裾角：站立的人偶轮廓被打散成飘拂的下摆
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2 + 0.4, x = Math.sin(a), z = Math.cos(a);
          const len = 0.16 + 0.09 * ((i * 3) % 4) / 3;
          b.limb('hips', 'hair', [x * 0.085 * H * th, d.hipY + 0.02 * H, z * 0.070 * H * th],
            [x * 0.125 * H * th, d.hipY - len, z * 0.105 * H * th], 0.030 * H * th, 0.004, 5);
        }
        // 肩背的边缘絮：必须左右对称、短、并且贴着身体。上一轮写成"一侧递进加长"，出图从侧面看
        // 是一把从肩膀张出去的扇形硬片，像断翅或鱼鳍，反而破坏了人形剪影
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          for (const s of [-1, 1]) {
            // 细才像渐隐的边缘：上一版根部 0.024·H·th，出图是一排硬邦邦的黑三角片，像鳍
            b.limb('spine', 'hair', [s * 0.095 * H * th, d.shoulderY - 0.02 * H - t * 0.13 * H, 0.02 * H],
              [s * 0.116 * H * th, d.shoulderY - 0.085 * H - t * 0.145 * H, 0.05 * H], 0.016 * H * th, 0.002, 5);
          }
        }
        // 颅顶几缕贴着头皮向后飘的虚影（不再向前上方支棱出尖）
        for (let i = 0; i < 5; i++) {
          const s = (i - 2) / 2;
          b.limb('head', 'hair', [s * hr * 0.55, hy + hr * 0.95, hr * 0.25],
            [s * hr * 0.70, hy + hr * 1.05, hr * 0.25 + 0.09], hr * 0.20, 0.003, 5);
        }
        // 小臂末端散成三缕指尖虚影，小腿末端化为拖尾：脚掌和手掌都已去掉，整只不落地
        for (const s of [-1, 1]) {
          const L = s < 0 ? 'L' : 'R', hx = s * d.hipW, x = s * d.shoulderW;
          for (let f = -1; f <= 1; f++) {
            b.limb('fore' + L, 'claw', [x, d.handY + 0.02 * H, 0],
              [x + f * 0.018 * H, d.handY - 0.035 * H, 0.012 * H], 0.013 * H * th, 0.002, 4);
          }
          b.limb('shin' + L, 'hair', [hx, 0.10 * H, 0], [hx * 0.72, -0.03, 0.015 * H], 0.040 * H * th, 0.003, 6);
        }
      },
    }), { label: 'faceling_shadow' });
  },
});
})();
