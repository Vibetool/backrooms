// 后室 · 悲尸感染与转化测试：node tests/infection.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），__br.setAuto(false) 后用 __br.step 精确推进。
// 覆盖：测试人被划伤感染 → 45 s 原地变悲尸；感染中被打死 → 约 4 s 尸体爬起；两种形态都感染、非人类不感染；
// 悲尸放过已感染的测试人（自然流程能走完三阶段）；噩梦玩家三阶段的治愈规则、提示时长与死亡结算；Level 8 旧感染持续伤害不再叠加；
// 游玩/测试模式玩家不受伤不感染；症状只改实例材质；快照新旧格式互通；客机回单机后感染记录不卡死。
// 近战出手时机（FE1P H11，h 段）：扣血 / 感染挪到胳膊抡到最前的那一刻（起手后 0.38 个冷却周期，和动画同一处），那一刻目标出了
// 攻击距离 + 0.15 m 就算没打中；坐在叉车上的人攻击距离量到司机身体（座椅上的人），扣血那一帧怪的手离司机身体包围盒 ≤ 0.15 m，
// 车外 1 m 的怪打不到司机，游玩模式坐在车上照样不挨打。返修 r1：抡的这一下里怪接着往前扑（h2b），人一直往前走甩不掉悲尸（h6）。
// FE1Q J1：笑魇也同一个出手时刻（h7：60 fps 推 8 s，每次扣血那一帧脸正好鼓到最大，±1 帧）。
// FE1R K6（k 段）：怪打坐在叉车上的人 —— 所有会近战的怪 × 车的前 / 左 / 后 / 右 × 高 / 低画质 × 噩梦，逐帧（1/30 s）顶点级：
//   走近、抬手、抡、收手的整个过程，怪的任何顶点压进叉车实心部件（14 个部件盒 + 斜立柱、靠背棱柱 + 坐垫、减震底座）≤1 cm，脚（离地 0.25 m 以下）
//   不进底盘碰撞盒；所有会近战的怪（返修 FE1R · repair-r1：车的 8 个方向；胳膊、整张脸、整只扑上去、伸一条肢体，BR.arch.seatReach 都给得出）
//   10 s 内出手，扣血那一帧手（脸 / 嘴 / 肢体梢）离司机身体（coop.seatBody 同一套坐姿人形的三角形）≤2 cm、插进去 ≤1 cm（叉车不是安全屋）。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20260914;
const KEY = 'wretch_cycle';
// 调试用（返修 FE1R · repair-r1）：--only k 只跑坐车那一段；--types a,b 只跑这几种怪；--dirs …；--q high|low
const argOf = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = argOf('only') ? new Set(argOf('only').split(',')) : null;
const K_TYPES = argOf('types') ? argOf('types').split(',') : null;
const K_DIRS_ARG = argOf('dirs') ? argOf('dirs').split(',') : null;
const K_QS = argOf('q') ? [argOf('q')] : ['high', 'low'];
// 有链的怪额外强制的摆动相位（返修 FE1R · repair-r2）：--phases 1.9,4.4（缺省这两个，加上按实体 id 定的那个一共 3 个）
const K_PHASES = argOf('phases') ? argOf('phases').split(',').map(Number) : [1.9, 4.4];

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};
function startServer() {
  const srv = http.createServer((req, res) => {
    let u;
    try { u = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- 记录 ----------
const results = [];
const errors = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function newPage(browser, base, tag) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
  // 联机信令服务器绝不能打线上
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(800);   // 等 hazmat.glb 载入：测试人用 GLB 模型，伤口和脓疱贴法走真实路径
  await installHelpers(page);
  return { ctx, page };
}

// 页面里的测试小工具
function installHelpers(page) {
  return ev(page, () => {
    const H = window.__inf = {
      ev: { transform: [], kill: [], infect: [], damage: [], deaths: [] },
      toasts: [],
      toastMs: [],
      base: null,
      spec() { return BR.entityTypes.get('wretch').infection; },
      // 长时间推进时先停掉渲染（SwiftShader 纯 CPU，渲染最贵）；实体 animate 属于 entities.update，照常跑
      step(sec) {
        const r = BR.gfx.render;
        BR.gfx.render = () => {};
        try { __br.step(sec); } finally { BR.gfx.render = r; }
      },
      time() { return BR.entities.debugInfo().time; },
      // 找玩家周围最开阔的方向，之后都在这条线上摆实体
      home() {
        const P = BR.player;
        let best = { yaw: P.yaw, d: -1 };
        for (let i = 0; i < 16; i++) {
          const yaw = -Math.PI + i * Math.PI / 8;
          const h = BR.phys.raycast(P.x, P.y - 0.6, P.z, -Math.sin(yaw), 0, -Math.cos(yaw), 30);
          const d = h ? h.dist : 30;
          if (d > best.d) best = { yaw, d };
        }
        this.base = { x: P.x, z: P.z, yaw: best.yaw, free: best.d };
        this.reset();
        return this.base;
      },
      reset() {
        const P = BR.player, b = this.base;
        P.x = b.x; P.z = b.z; P.yaw = b.yaw; P.pitch = 0; P.vx = 0; P.vz = 0;
      },
      // 在玩家正前方 dist 米、右侧 lateral 米处放实体；faceBack = 面朝玩家
      put(type, dist, lateral, faceBack) {
        const P = BR.player, b = this.base;
        const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
        const x = b.x + fx * dist + rx * (lateral || 0), z = b.z + fz * dist + rz * (lateral || 0);
        return BR.entities.spawn(type, x, P.feetY, z, { yaw: faceBack ? b.yaw + Math.PI : b.yaw, from: { x: P.x, y: P.y, z: P.z } });
      },
      suitHex(e) { return e.obj.userData.dummy.mats.filter(m => m.userData.suit).map(m => m.color.getHex()); },
      sores(e) {
        const s = e.obj.userData.dummy.sores;
        return s ? { visible: s.visible, slime: +s.morphTargetInfluences[0].toFixed(3), pus: +s.morphTargetInfluences[1].toFixed(3) } : null;
      },
      use(type) {
        const P = BR.player;
        if (P.countOf(type) <= 0) P.addItem(type, 1);
        const idx = P.inventory.findIndex(s => s && s.type === type);
        P.selected = idx;
        const slot = P.inventory[idx];
        const consumed = P.useSelected();
        return { consumed, left: slot ? slot.left : null };
      },
      // 等到 cond() 为真或超时，每次推进 dt
      until(cond, maxSec, dt) {
        const d = dt || 0.1;
        let t = 0;
        while (t < maxSec && !cond()) { this.step(d); t += d; }
        return +t.toFixed(3);
      },
      fx() {
        const e = BR.effects.get('wretch_cycle');
        return e ? { stage: e.stage, elapsed: +e.elapsed.toFixed(3), cureTags: e.cureTags, onExpire: e.onExpire, negative: e.negative, hostile: e.hostile, tags: e.tags } : null;
      },
    };
    // 新实体生成后同一帧就开始思考、会转身走动：原位/朝向要在事件发出的那一刻记下来
    BR.bus.on('entity:transform', p => {
      const ne = BR.entities.get(p.to);
      H.ev.transform.push(Object.assign({ at: H.time(), spawnX: ne ? ne.x : null, spawnZ: ne ? ne.z : null, spawnYaw: ne ? ne.yaw : null }, p));
    });
    BR.bus.on('entity:kill', p => H.ev.kill.push(p));
    BR.bus.on('entity:infect', p => H.ev.infect.push(Object.assign({ at: H.time() }, p)));
    BR.bus.on('player:damage', p => H.ev.damage.push({ hp: p.hp, src: p.source && p.source.type ? p.source.type : String(p.source) }));
    BR.bus.on('player:death', p => H.ev.deaths.push(p));
    const ot = BR.hud.toast;
    BR.hud.toast = function (t, ms) { H.toasts.push(String(t)); H.toastMs.push([String(t), ms]); return ot.apply(this, arguments); };
    // 层级名大字挡画面，关掉
    const css = document.createElement('style');
    css.textContent = '.hud-title{display:none!important}';
    document.head.appendChild(css);
    return true;
  });
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let hostRows = null;
  try {
    if (ONLY && !ONLY.has('base') && !ONLY.has('nightmare') && !ONLY.has('strike')) {
      // 只跑 k 段（返修 FE1R · repair-r1：调没有胳膊的怪打坐车的人时用）
      const C = await newPage(browser, base, 'strike');
      for (const q of K_QS) await seatedMelee(C.page, q);
      await C.ctx.close();
    } else {
    const A = await newPage(browser, base, 'test');
    hostRows = await testMode(A.page);
    await naturalFlow(A.page);
    await noHarm(A.page, 'test');
    await ev(A.page, seed => {
      __br.start({ mode: 'casual', seed, levelId: 'dev', settings: { visibility: 1, spawnSlider: 0 } });
      __br.setAuto(false);
      __inf.step(0.5);
      __inf.home();
    }, SEED);
    await noHarm(A.page, 'casual');
    await A.ctx.close();

    const B = await newPage(browser, base, 'nightmare');
    await nightmare(B.page);
    await snapshotGuest(B.page, hostRows);
    await level8(B.page);
    await B.ctx.close();

    const C = await newPage(browser, base, 'strike');
    await strike(C.page);
    // k：坐车顶点级（FE1R K6），同一个页面先高后低画质（各重新开一局）
    for (const q of K_QS) await seatedMelee(C.page, q);
    await C.ctx.close();
    }
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = failed.length || errors.length ? 1 : 0;
  // 先打汇总再关浏览器（FE1 返修 r5，照 interact.mjs）：Chrome 退出后遗留的进程会占着管道，browser.close() 有时好几分钟都不返回，
  // 以前汇总排在它后面，检查全过了也一直不打印（tests/all.mjs 只能等到超时判失败）。close 最多等 10 s
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  srv.close();
  process.exit(process.exitCode);
}

// =====================================================================
// 测试模式：a 转化、b 尸体爬起、c 两种形态 / 非人类、f 实例材质、快照（房主侧）
// =====================================================================
async function testMode(page) {
  const st = await ev(page, seed => {
    __br.start({ mode: 'test', seed, levelId: 'dev', settings: { visibility: 1 } });
    __br.setAuto(false);
    __inf.step(0.5);
    const h = __inf.home();
    const S = __inf.spec();
    return { mode: BR.game.mode, atk: BR.game.attackPlayers, free: h.free, spec: { key: S.key, toType: S.toType, at: S.stages.map(s => s.at), transformAt: S.transformAt, rise: S.deathRiseSec, spares: S.sparesInfected },
      lumpSame: BR.entityTypes.get('wretch_lump').infection === S, human: BR.entityTypes.get('test_dummy').human };
  }, SEED);
  check('测试模式开局、找到开阔方向', st.mode === 'test' && !st.atk && st.free >= 4, st);
  check('悲尸时间线：0/15/30 s 三阶段、45 s 转化、尸体 4 s 爬起、挠上就放过，两种形态共用', st.spec.key === KEY && st.spec.toType === 'wretch' &&
    JSON.stringify(st.spec.at) === '[0,15,30]' && st.spec.transformAt === 45 && st.spec.rise === 4 && st.spec.spares === true && st.lumpSame && st.human === true, st);

  // ---------- a：命中 → 感染 ----------
  const a1 = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 2.2, 0, false);
    const w = __inf.put('wretch', 3.2, 0, true);
    if (!d || !w) return { ok: false, d: !!d, w: !!w };
    const hp0 = d.hp;
    const t = __inf.until(() => !!d.infection || d.dead, 15);
    BR.entities.remove(w);
    const inf = d.infection;
    return {
      ok: true, id: d.id, t, hp0, hp: d.hp, dead: d.dead,
      inf: inf && { key: inf.key, stage: inf.stage, toType: inf.toType, since: inf.since },
      ev: __inf.ev.infect.filter(x => x.id === d.id),
    };
  });
  check('a 悲尸命中测试人 → 测试人进入感染（阶段 0，只掉了一刀的血）', a1.ok && !!a1.inf && a1.inf.key === KEY && a1.inf.stage === 0 && a1.hp < a1.hp0 && !a1.dead, a1);
  check('a 发 entity:infect，来源是悲尸', a1.ok && a1.ev.length === 1 && a1.ev[0].sourceType === 'wretch' && a1.ev[0].toType === 'wretch', a1.ev);
  if (!a1.ok || !a1.inf) return null;

  // 悲尸放过已感染的测试人；再感染不重置计时（总共推进 10 s，阶段 0 还没过完，a3 要从阶段 0 开始记）
  const a2 = await ev(page, (id) => {
    const d = BR.entities.get(id);
    const since = d.infection.since;
    __inf.step(2);
    const hp1 = d.hp;
    const w = BR.entities.spawn('wretch', d.x + 1.05, d.y, d.z, { yaw: Math.PI / 2 });
    let everTarget = false, attackState = 0;
    for (let i = 0; i < 80; i++) {
      __inf.step(0.1);
      if (w && w.target && w.target.ref === d) everTarget = true;
      if (w && w.state === 'attack') attackState++;
    }
    const spared = { spawned: !!w, hp1, hp2: d.hp, everTarget, attackState, canAttack: w ? BR.entities.canAttack(w, d) : null };
    // 对照：同一只悲尸对没感染的测试人照样能打
    const fresh = __inf.put('test_dummy', 6, 0, false);
    spared.canAttackFresh = w && fresh ? BR.entities.canAttack(w, fresh) : null;
    if (fresh) BR.entities.remove(fresh);
    if (w) BR.entities.remove(w);
    const again = BR.entities.infect(d, __inf.spec(), null);
    d.hp = d.maxHp;
    return { since, spared, after: d.infection && { since: d.infection.since, elapsed: +d.infection.elapsed.toFixed(2), stage: d.infection.stage }, again, events: __inf.ev.infect.filter(x => x.id === id).length };
  }, a1.id);
  check('a 悲尸不再攻击已感染的测试人（贴身 8 s 不掉血、不当目标），没感染的照样能打', a2.spared.spawned && a2.spared.hp2 === a2.spared.hp1 && !a2.spared.everTarget &&
    a2.spared.attackState === 0 && a2.spared.canAttack === false && a2.spared.canAttackFresh === true, a2.spared);
  check('a 已感染的测试人再被感染（API）返回 false、不重置计时', !!a2.after && a2.after.since === a2.since && a2.after.elapsed >= 10 && a2.after.stage === 0 && a2.again === false && a2.events === 1, a2);

  // 阶段推进 + 45 s 转化
  const a3 = await ev(page, (id) => {
    const ref = BR.entities.get(id);
    const first = {};
    const n0 = __inf.ev.transform.length;
    const since = ref.infection.since;
    for (let i = 0; i < 700 && !ref.removed; i++) {
      const inf = ref.infection;
      if (inf && first[inf.stage] == null) first[inf.stage] = +(__inf.time() - since).toFixed(2);
      ref.hp = ref.maxHp;
      __inf.step(0.1);
    }
    const tr = __inf.ev.transform.slice(n0);
    const ne = tr.length ? BR.entities.get(tr[0].to) : null;
    return {
      removed: ref.removed, first, tr, since,
      took: tr.length ? +(tr[0].at - since).toFixed(3) : null,
      old: { x: ref.x, z: ref.z, yaw: ref.yaw },
      ne: ne && { type: ne.type, x: ne.x, z: ne.z, yaw: ne.yaw, manual: ne.manual, chunkKey: ne.chunkKey, dead: ne.dead, infection: ne.infection },
      dummies: BR.entities.list.filter(e => !e.removed && e.type === 'test_dummy').length,
      kills: __inf.ev.kill.filter(k => k.victim === id).length,
    };
  }, a1.id);
  check('a 感染阶段按 0 / 15 / 30 s 推进', a3.first[0] != null && a3.first[1] >= 15 && a3.first[1] < 15.15 && a3.first[2] >= 30 && a3.first[2] < 30.15, a3.first);
  check('a 45 s 后测试人消失、原位出现标准型悲尸、发 entity:transform', a3.removed && a3.tr.length === 1 && a3.took >= 45 && a3.took < 45.1 &&
    a3.tr[0].from === a1.id && a3.tr[0].toType === 'wretch' && a3.tr[0].cause === 'infection' && !!a3.ne && a3.ne.type === 'wretch' && !a3.ne.dead &&
    Math.hypot(a3.tr[0].spawnX - a3.old.x, a3.tr[0].spawnZ - a3.old.z) < 0.3 && Math.abs(a3.tr[0].spawnYaw - a3.old.yaw) < 1e-6 && a3.dummies === 0,
  { took: a3.took, tr: a3.tr, old: a3.old, ne: a3.ne, dummies: a3.dummies });
  check('a 转化出的悲尸继承 manual（不被自动清理）、自己不带感染、活着转化不算击杀', !!a3.ne && a3.ne.manual === true && a3.ne.chunkKey === null && !a3.ne.infection && a3.kills === 0, a3.ne);

  // ---------- b：感染后被打死 → 约 4 s 尸体爬起 ----------
  const b = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 2.2, 0, false);
    const w = __inf.put('wretch', 3.2, 0, true);
    __inf.until(() => !!d.infection || d.dead, 15);
    BR.entities.remove(w);
    if (!d.infection || d.dead) return { ok: false, inf: !!d.infection, dead: d.dead };
    __inf.step(2);
    const n0t = __inf.ev.transform.length, n0k = __inf.ev.kill.length;
    const tKill = __inf.time();
    BR.entities.kill(d, 'player');
    const riseIn = +(d.infection.riseAt - tKill).toFixed(3);
    __inf.step(3.5);
    const at35 = { inList: BR.entities.get(d.id) === d, dead: d.dead, removed: d.removed, state: d.state, lean: +d.obj.userData.dummy.pivot.rotation.x.toFixed(2) };
    __inf.until(() => d.removed, 3, 1 / 30);
    const tr = __inf.ev.transform.slice(n0t), kills = __inf.ev.kill.slice(n0k);
    const ne = tr.length ? BR.entities.get(tr[0].to) : null;
    return {
      ok: true, id: d.id, riseIn, at35, tr, kills,
      took: tr.length ? +(tr[0].at - tKill).toFixed(3) : null,
      corpse: { x: d.x, z: d.z }, ne: ne && { type: ne.type, x: ne.x, z: ne.z, dead: ne.dead, manual: ne.manual },
    };
  });
  check('b 感染中被打死：3.5 s 时尸体还躺在原地（没按普通 3 s 移除）', b.ok && b.at35.inList && b.at35.dead && !b.at35.removed && b.riseIn === 4, b.ok ? { riseIn: b.riseIn, at35: b.at35 } : b);
  check('b 约 4 s 后尸体原地变成悲尸（cause rise，补发测试人的 entity:kill）', b.ok && b.tr.length === 1 && b.took >= 4 && b.took < 4.1 && b.tr[0].cause === 'rise' &&
    !!b.ne && b.ne.type === 'wretch' && !b.ne.dead && b.ne.manual === true && Math.hypot(b.ne.x - b.corpse.x, b.ne.z - b.corpse.z) < 0.3 &&
    b.kills.some(k => k.victim === b.id && k.victimType === 'test_dummy'), b.ok ? { took: b.took, tr: b.tr, ne: b.ne, corpse: b.corpse, kills: b.kills } : b);

  // 爬起动作：挣扎着起身（撑起 → 塌回去 → 立起往前冲过头），不是一块板匀速立起
  const bRise = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 2.6, 0, false);
    BR.entities.infect(d, __inf.spec(), null);
    __inf.step(1);
    BR.entities.kill(d, 'player');
    const u = d.obj.userData.dummy;
    const leans = [];
    __inf.until(() => d.infection.riseAt - __inf.time() <= 1.6, 5, 1 / 30);
    while (!d.removed && leans.length < 80) { leans.push(+u.pivot.rotation.x.toFixed(3)); __inf.step(1 / 30); }
    let dips = 0;   // 倾角由减变增 = 撑起来又塌回去
    for (let i = 2; i < leans.length; i++) if (leans[i - 1] < leans[i - 2] - 1e-3 && leans[i] > leans[i - 1] + 1e-3) dips++;
    return { n: leans.length, min: Math.min(...leans), maxAfterStart: Math.max(...leans.slice(5)), dips, removed: d.removed };
  });
  check('b 爬起动作分几拍：中途塌回去一次、最后往前冲过头（倾角到负值）', bRise.removed && bRise.dips >= 1 && bRise.min < -0.1, bRise);

  // 致命的第一刀也算划伤：残血测试人被悲尸一刀砍死 → 尸体照样爬起
  const b2 = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 2.2, 0, false);
    d.hp = 30;
    const w = __inf.put('wretch', 3.2, 0, true);
    __inf.until(() => d.dead, 15);
    BR.entities.remove(w);
    const r = { dead: d.dead, inf: !!d.infection, riseAt: d.infection ? d.infection.riseAt : null };
    const n0 = __inf.ev.transform.length;
    __inf.step(4.3);
    r.rose = __inf.ev.transform.slice(n0).filter(x => x.from === d.id && x.cause === 'rise').length;
    return r;
  });
  check('b 残血测试人被悲尸一刀砍死：同样感染、尸体爬起', b2.dead && b2.inf && b2.rose === 1, b2);

  // ---------- c：畸形肉块变体也感染；非人类实体不感染；悲尸本身不感染 ----------
  const c1 = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 2.2, 0, false);
    const w = __inf.put('wretch_lump', 3.1, 0, true);
    if (!d || !w) return { ok: false };
    const hp0 = d.hp;
    const t = __inf.until(() => !!d.infection || d.dead, 15);
    const hpHit = d.hp;
    __inf.step(6);   // 肉块变体同样放过已感染的测试人
    const hpLater = d.hp;
    BR.entities.remove(w);
    const src = __inf.ev.infect.filter(x => x.id === d.id).map(x => x.sourceType);
    return { ok: true, t, hit: hpHit < hp0, hpHit, hpLater, dead: d.dead, inf: d.infection && { key: d.infection.key, toType: d.infection.toType }, src };
  });
  check('c 畸形肉块变体命中测试人也感染（转化目标仍是标准型 wretch），之后放过它', c1.ok && c1.hit && !!c1.inf && c1.inf.key === KEY && c1.inf.toType === 'wretch' && c1.src[0] === 'wretch_lump' &&
    c1.hpLater === c1.hpHit && !c1.dead, c1);

  const c2 = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const f = __inf.put('_dev_friendly', 2.2, 0, false);
    const w = __inf.put('wretch', 3.2, 0, true);
    if (!f || !w) return { ok: false };
    const hp0 = f.hp;
    let minHp = hp0, everInf = false;
    const n0 = __inf.ev.transform.length, n1 = __inf.ev.infect.length;
    for (let i = 0; i < 100; i++) {
      __inf.step(0.1);
      if (f.infection) everInf = true;
      minHp = Math.min(minHp, f.hp);
      if (f.dead) break;
    }
    __inf.step(6);
    return {
      ok: true, hp0, minHp, dead: f.dead, everInf, isHuman: BR.entities.isHuman(f),
      transforms: __inf.ev.transform.slice(n0).length, infects: __inf.ev.infect.slice(n1).length,
      wretchSelf: w.removed ? 'removed' : BR.entities.infect(w, __inf.spec(), null),
    };
  });
  check('c 友善实体（_dev_friendly）被悲尸打：掉血但不感染、不转化', c2.ok && c2.minHp < c2.hp0 && !c2.everInf && !c2.isHuman && c2.transforms === 0 && c2.infects === 0, c2);
  const c3 = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const w = __inf.put('wretch', 3, 0, true);
    const r = { api: BR.entities.infect(w, __inf.spec(), null), inf: !!w.infection };
    BR.entities.remove(w);
    return r;
  });
  check('c 目标本身就是悲尸：infect 返回 false', c3.api === false && !c3.inf, c3);

  // ---------- f：症状只改实例材质 ----------
  const f = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const sharedSuit = () => {
      const m = BR.assets.modelSync('hazmat');
      let c = null;
      if (m) m.traverse(o => { if (o.isMesh && /^Suit/.test(o.material.name || '')) c = o.material.color.getHex(); });
      return c;
    };
    const A = __inf.put('test_dummy', 2.4, -0.9, false);
    const B = __inf.put('test_dummy', 2.4, 0.9, false);
    if (!A || !B) return { ok: false };
    const kind = A.obj.userData.dummy.kind;
    const shared0 = sharedSuit(), a0 = __inf.suitHex(A), b0 = __inf.suitHex(B);
    const infected = BR.entities.infect(A, __inf.spec(), null);
    // 第一阶段：抽搐（测 12 秒里枢轴的侧倾和抽动时间占比），没感染的那个不抽
    let rollA = 0, rollB = 0, activeA = 0, frames = 0;
    for (let i = 0; i < 360; i++) {
      __inf.step(1 / 30);
      const r = Math.abs(A.obj.userData.dummy.pivot.rotation.z);
      rollA = Math.max(rollA, r);
      if (r > 0.02) activeA++;
      frames++;
      rollB = Math.max(rollB, Math.abs(B.obj.userData.dummy.pivot.rotation.z));
    }
    const early = { a: __inf.suitHex(A), sores: __inf.sores(A), soresB: __inf.sores(B), activeFrac: +(activeA / frames).toFixed(3), stage: A.infection.stage };
    __inf.step(15);   // 到 27 s：第二阶段，变色走完
    const uA = A.obj.userData.dummy, uB = B.obj.userData.dummy;
    const mid = {
      stage: A.infection && A.infection.stage, a: __inf.suitHex(A), b: __inf.suitHex(B), tint: +uA.tint.toFixed(3),
      sores: __inf.sores(A), soresB: __inf.sores(B), bInf: B.infection, shared: sharedSuit(),
    };
    const C = __inf.put('test_dummy', 2.4, 0, false);
    const c1 = C ? __inf.suitHex(C) : null;
    // 第三阶段：头部乱晃
    __inf.step(4);
    let head = 0;
    for (let i = 0; i < 30; i++) {
      __inf.step(1 / 30);
      head = Math.max(head, Math.abs(uA.head ? uA.head.rotation.x : 0) + Math.abs(uA.head ? uA.head.rotation.z : 0));
    }
    let meshesA = 0, meshesB = 0, tris = 0;
    A.obj.traverse(o => { if (o.isMesh && o.visible) meshesA++; });
    B.obj.traverse(o => { if (o.isMesh && o.visible) meshesB++; });
    if (uA.sores) tris = uA.sores.geometry.index.count / 3;
    // 移除时实例材质（含伤口/脓疱材质）要被释放，共享几何不释放
    let disposed = 0;
    const owned = uA.mats.slice();
    owned.forEach(m => { const od = m.dispose.bind(m); m.dispose = () => { disposed++; od(); }; });
    let geoDisposed = 0;
    if (uA.sores) { const g = uA.sores.geometry, od = g.dispose.bind(g); g.dispose = () => { geoDisposed++; od(); }; }
    __inf.step(15);   // 过 45 s，A 转化被移除
    return {
      ok: true, kind, infected, shared0, a0, b0, rollA: +rollA.toFixed(3), rollB, early, mid, c1, head: +head.toFixed(3), hasHead: !!uA.head,
      aRemoved: A.removed, disposed, owned: owned.length, geoDisposed, meshesA, meshesB, soresTris: tris,
      bAfter: B.removed ? null : __inf.suitHex(B),
    };
  });
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  check('f 感染后第一阶段：胸口伤口渗淤泥（脓疱还没长），间歇抽搐（侧倾 ≥ 0.2 rad、抽动时间占比 ≥ 20%）；没感染的测试人不抽、没有伤口',
    f.ok && f.infected && f.early.stage === 0 && f.rollA >= 0.2 && f.early.activeFrac >= 0.2 && f.rollB === 0 && same(f.early.a, f.a0) &&
    !!f.early.sores && f.early.sores.visible && f.early.sores.slime === 1 && f.early.sores.pus === 0 && f.early.soresB === null,
  f.ok ? { kind: f.kind, rollA: f.rollA, activeFrac: f.early.activeFrac, rollB: f.rollB, sores: f.early.sores, soresB: f.early.soresB } : f);
  check('f 第二阶段：感染的测试人制服往红褐色变、冒出脓疱', f.ok && f.mid.stage === 1 && f.mid.tint > 0.8 && !same(f.mid.a, f.a0) && !!f.mid.sores && f.mid.sores.visible && f.mid.sores.pus > 0.9,
    f.ok ? { a0: f.a0, a: f.mid.a, tint: f.mid.tint, sores: f.mid.sores } : f);
  check('f 没感染的测试人制服颜色不变、没有伤口脓疱；共享材质和新召唤的测试人不受影响', f.ok && f.a0.length > 0 && same(f.mid.b, f.b0) && same(f.bAfter, f.b0) && f.mid.soresB === null && !f.mid.bInf &&
    f.mid.shared === f.shared0 && same(f.c1, f.b0), f.ok ? { b0: f.b0, b: f.mid.b, bAfter: f.bAfter, c: f.c1, shared0: f.shared0, shared: f.mid.shared } : f);
  check('f 第三阶段头部乱晃', f.ok && f.hasHead && f.head > 0.15, f.ok ? { head: f.head, hasHead: f.hasHead } : f);
  check('f 移除时释放实例材质（含伤口/脓疱材质），共享的几何不释放', f.ok && f.aRemoved && f.disposed >= f.owned && f.owned > 0 && f.geoDisposed === 0, f.ok ? { disposed: f.disposed, owned: f.owned, geoDisposed: f.geoDisposed } : f);
  check('f 伤口和脓疱合成一个网格（只多 1 个 draw call，≤ 600 面）', f.ok && f.soresTris > 0 && f.soresTris <= 600 && f.meshesA === f.meshesB + 1,
    f.ok ? { soresTris: f.soresTris, meshesA: f.meshesA, meshesB: f.meshesB } : f);

  // ---------- 快照：房主侧行格式 ----------
  const g = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const A = __inf.put('test_dummy', 2.4, -0.9, false);
    const B = __inf.put('test_dummy', 2.4, 0.9, false);
    BR.entities.infect(A, __inf.spec(), null);
    __inf.step(16);
    const rows = BR.entities.snapshot();
    return { rows, a: A.id, b: B.id, flag: BR.entities.SNAP_FLAGS.infected };
  });
  const ra = g.rows.find(r => r[0] === g.a), rb = g.rows.find(r => r[0] === g.b);
  check('快照：感染中的实体行尾追加 [null, flags(bit3), 阶段号]，前 7 列格式不变；没感染的仍是 7 列',
    !!ra && ra.length === 10 && ra[7] === null && g.flag === 8 && (ra[8] & 8) === 8 && ra[9] === 1 && ra[1] === 'test_dummy' &&
    typeof ra[2] === 'number' && typeof ra[5] === 'string' && typeof ra[6] === 'number' && !!rb && rb.length === 7, { ra, rb });
  return g;
}

// =====================================================================
// 自然流程：不写脚本干预，悲尸自己走过去挠测试人（用户实际会遇到的场景）
// =====================================================================
async function naturalFlow(page) {
  const n = await ev(page, () => {
    BR.entities.clear(); __inf.reset();
    const d = __inf.put('test_dummy', 3, 0, false);
    const w = __inf.put('wretch', 7, 0, false);
    if (!d || !w) return { ok: false };
    const t0 = __inf.time(), hp0 = d.hp;
    const n0i = __inf.ev.infect.length, n0t = __inf.ev.transform.length;
    let maxStage = -1, hits = 0, lastHp = hp0, infAt = null, hpAfterHit = null;
    for (let i = 0; i < 700 && !d.removed; i++) {
      __inf.reset();
      __inf.step(0.1);
      if (d.removed) break;
      if (d.hp < lastHp - 1e-6) { hits++; if (hpAfterHit === null) hpAfterHit = d.hp; }
      lastHp = d.hp;
      if (d.infection) { maxStage = Math.max(maxStage, d.infection.stage); if (infAt === null) infAt = __inf.time(); }
    }
    const infects = __inf.ev.infect.slice(n0i).filter(x => x.id === d.id);
    const tr = __inf.ev.transform.slice(n0t).filter(x => x.from === d.id);
    return {
      ok: true, hits, hpAfterHit, maxStage, removed: d.removed,
      infectAt: infAt !== null ? +(infAt - t0).toFixed(2) : null,
      infects: infects.length, tr: tr.map(x => ({ cause: x.cause, toType: x.toType, after: +(x.at - (infects[0] ? infects[0].at : 0)).toFixed(2) })),
      wretchAlive: !w.removed && !w.dead,
    };
  });
  check('自然流程（测试人 3 m、悲尸 7 m）：悲尸挠一下就感染，之后不再攻击，测试人只挨一刀、活着', n.ok && n.infects === 1 && n.hits === 1 && n.hpAfterHit > 0 && n.infectAt !== null && n.infectAt < 15, n);
  check('自然流程：测试人活着走完 0 / 15 / 30 s 三个阶段，感染后 45 s 原地变成悲尸（不是被打死后爬起）', n.ok && n.maxStage === 2 && n.removed && n.tr.length === 1 &&
    n.tr[0].cause === 'infection' && n.tr[0].toType === 'wretch' && n.tr[0].after >= 45 && n.tr[0].after < 45.2, n);
}

// =====================================================================
// e：游玩 / 测试模式，悲尸和玩家同处 60 s
// =====================================================================
async function noHarm(page, label) {
  const e = await ev(page, () => {
    const P = BR.player;
    BR.entities.clear(); BR.effects.clear(); __inf.reset();
    const S = __inf.spec();
    const hp0 = P.hp, nd = __inf.ev.damage.length;
    let w = __inf.put('wretch', 1.1, 0, true);
    const apiInfect = BR.entities.infect(BR.player, S, w);
    let minD = Infinity, spawned = w ? 1 : 0;
    for (let i = 0; i < 60; i++) {
      __inf.reset();
      const b = __inf.base;
      if (!w || w.removed) { w = __inf.put('wretch', 1.1, 0, true); spawned++; }
      else { w.x = b.x - Math.sin(b.yaw) * 1.1; w.z = b.z - Math.cos(b.yaw) * 1.1; w.yaw = b.yaw + Math.PI; }
      if (w) minD = Math.min(minD, Math.hypot(w.x - P.x, w.z - P.z));
      __inf.step(1);
    }
    return { mode: BR.game.mode, atk: BR.game.attackPlayers, hp0, hp: P.hp, dead: P.dead, dmg: __inf.ev.damage.length - nd, fx: BR.effects.has('wretch_cycle'), apiInfect, minD: +minD.toFixed(2), spawned };
  });
  check('e ' + (label === 'test' ? '测试' : '游玩') + '模式：悲尸贴着玩家 60 s，玩家不掉血、不感染（直接调 infect 也拒绝）',
    e.mode === label && !e.atk && e.hp === e.hp0 && !e.dead && e.dmg === 0 && !e.fx && e.apiInfect === false && e.minD < 1.3, e);
}

// =====================================================================
// d：噩梦生存，玩家三阶段
// =====================================================================
async function nightmare(page) {
  const st = await ev(page, seed => {
    __br.start({ mode: 'nightmare', difficulty: 'easy', seed, levelId: 'dev', settings: { visibility: 1 } });
    __br.setAuto(false);
    __inf.step(0.5);
    const h = __inf.home();
    BR.entities.clear();
    return { mode: BR.game.mode, atk: BR.game.attackPlayers, stats: BR.game.statsEnabled, sf: BR.game.spawnFactor, free: h.free };
  }, SEED);
  check('噩梦生存（简单：不刷实体）开局', st.mode === 'nightmare' && st.atk && st.stats && st.sf === 0 && st.free >= 3, st);
  const S = await ev(page, () => { const s = __inf.spec(); return { stages: s.stages.map(x => x.toast), cause: s.cause, cure: s.cureToast }; });

  // 真实划伤
  const d1 = await ev(page, () => {
    const P = BR.player;
    P.hp = 100; P.hunger = 100; P.sanity = 100;
    __inf.reset();
    const n0 = __inf.toasts.length, nd = __inf.ev.damage.length;
    const w = __inf.put('wretch', 1.3, 0, true);
    const t = __inf.until(() => BR.effects.has('wretch_cycle') || P.dead, 15);
    // 噩梦里的玩家不在"放过"之列：感染上之后悲尸照样把玩家当目标
    const stillHunts = !!w && BR.entities.canAttack(w, P);
    BR.entities.remove(w);
    return { t, hp: P.hp, dead: P.dead, fx: __inf.fx(), toasts: __inf.toasts.slice(n0), toastMs: __inf.toastMs.slice(n0), dmg: __inf.ev.damage.slice(nd), stillHunts };
  });
  check('d 噩梦：玩家被悲尸划伤 → 感染（阶段 0，第一次感染弹提示）', !!d1.fx && d1.fx.stage === 0 && d1.hp < 100 && !d1.dead && d1.dmg.length === 1 && d1.dmg[0].src === 'wretch' &&
    d1.toasts.includes(S.stages[0]), d1);
  const ms0 = (d1.toastMs.find(x => x[0] === S.stages[0]) || [])[1];
  check('d 阶段提示停留时间按字数加长（第一阶段那句 36 字 ≥ 4 s，不再是 2.2 s）', ms0 >= 4000 && ms0 <= 6000, { ms0, len: S.stages[0].length });
  check('d 噩梦里感染上的玩家悲尸照样追杀（只放过实体目标）', d1.stillHunts === true, d1.stillHunts);
  check('d 玩家侧效果：负面、不标 hostile、不带 infection 标签、到期 transform:wretch', !!d1.fx && d1.fx.negative && !d1.fx.hostile && !d1.fx.tags.includes('infection') && d1.fx.onExpire === 'transform:wretch' &&
    JSON.stringify(d1.fx.cureTags) === '["food","almond_water"]', d1.fx);

  const d1b = await ev(page, () => {
    const P = BR.player;
    P.hp = 100;
    __inf.step(5);
    const e0 = BR.effects.get('wretch_cycle').elapsed;
    const nd = __inf.ev.damage.length, nt = __inf.toasts.length;
    const w = __inf.put('wretch', 1.3, 0, true);
    __inf.until(() => __inf.ev.damage.length > nd || P.dead, 15);
    BR.entities.remove(w);
    P.hp = 100;
    const fx = BR.effects.get('wretch_cycle');
    return { hit: __inf.ev.damage.length > nd, e0: +e0.toFixed(2), e1: fx ? +fx.elapsed.toFixed(2) : null, repeatToast: __inf.toasts.slice(nt).filter(x => x === __inf.spec().stages[0].toast).length };
  });
  check('d 已感染的玩家再被划伤不重置计时、不重复弹第一次感染提示', d1b.hit && d1b.e1 !== null && d1b.e1 >= d1b.e0 && d1b.repeatToast === 0, d1b);

  // 第一阶段：食物治愈
  const d2 = await ev(page, () => {
    const n0 = __inf.toasts.length;
    const u = __inf.use('canned_food');
    const r = { consumed: u.consumed, cured: !BR.effects.has('wretch_cycle'), toasts: __inf.toasts.slice(n0), toastMs: __inf.toastMs.slice(n0) };
    // 杏仁水在第一阶段也行
    BR.entities.infect(BR.player, __inf.spec(), null);
    __inf.step(3);
    r.aw = __inf.use('almond_water').consumed;
    r.curedAW = !BR.effects.has('wretch_cycle');
    // 分几次吃完的食物：吃一口（不消耗整件）也算吃过
    BR.entities.infect(BR.player, __inf.spec(), null);
    __inf.step(2);
    const berry = __inf.use('warpberries');
    r.berry = berry;
    r.curedBerry = !BR.effects.has('wretch_cycle');
    return r;
  });
  const cureMs = (d2.toastMs.find(x => x[0] === S.cure) || [])[1];
  check('d 第一阶段吃食物（罐头）治愈，弹治好提示', d2.consumed && d2.cured && d2.toasts.includes(S.cure) && cureMs >= 2200, { consumed: d2.consumed, cured: d2.cured, cureMs });
  check('d 第一阶段喝杏仁水治愈；分次吃的浆果吃一口也算', d2.aw && d2.curedAW && d2.berry.consumed === false && d2.berry.left > 0 && d2.curedBerry, d2);

  // 第二阶段：食物不行、消毒剂不行、杏仁水（含彩色瓶）行
  const d3 = await ev(page, () => {
    const P = BR.player;
    P.hp = 100; P.hunger = 100; P.sanity = 100;
    BR.effects.clear();
    const n0 = __inf.toasts.length;
    const ok = BR.entities.infect(BR.player, __inf.spec(), null);
    __inf.step(15.3);
    const r = { ok, stage: __inf.fx() && __inf.fx().stage, toasts: __inf.toasts.slice(n0) };
    __inf.use('canned_food');
    r.afterFood = BR.effects.has('wretch_cycle');
    __inf.use('antiseptics');
    r.afterAntiseptic = BR.effects.has('wretch_cycle');
    __inf.use('almond_water');
    r.afterAW = BR.effects.has('wretch_cycle');
    BR.entities.infect(BR.player, __inf.spec(), null);
    __inf.step(15.3);
    r.stage2 = __inf.fx() && __inf.fx().stage;
    __inf.use('almond_water_blue');
    r.afterBlue = BR.effects.has('wretch_cycle');
    r.hp = P.hp; r.dead = P.dead;
    return r;
  });
  check('d 第二阶段：进入时弹提示；吃食物不治愈、消毒剂不治愈', d3.ok && d3.stage === 1 && d3.toasts.includes(S.stages[1]) && d3.afterFood && d3.afterAntiseptic, d3);
  check('d 第二阶段：喝杏仁水治愈，彩色瓶（蓝）也算', !d3.afterAW && d3.stage2 === 1 && !d3.afterBlue && !d3.dead, d3);

  // 第三阶段：杏仁水也不行 → 45 s 死亡结算
  const d4 = await ev(page, () => {
    const P = BR.player;
    P.hp = 100; P.hunger = 100; P.sanity = 100;
    BR.effects.clear();
    const n0 = __inf.toasts.length, nD = __inf.ev.deaths.length;
    const t0 = __inf.time();
    BR.entities.infect(BR.player, __inf.spec(), null);
    __inf.step(30.3);
    const r = { stage: __inf.fx() && __inf.fx().stage, toasts: __inf.toasts.slice(n0) };
    __inf.use('almond_water');
    r.afterAW = BR.effects.has('wretch_cycle');
    __inf.use('canned_food');
    r.afterFood = BR.effects.has('wretch_cycle');
    let t = 30.3;
    while (t < 50 && !P.dead) { __inf.step(1 / 30); t += 1 / 30; }
    r.t = +(__inf.time() - t0).toFixed(3);
    r.dead = P.dead;
    r.death = __inf.ev.deaths.slice(nD)[0] || null;
    __br.step(0);   // 渲染一帧
    r.screen = BR.game.screen;
    r.visible = BR.death.visible;
    const el = document.querySelector('.death-cause-text');
    r.causeText = el ? el.textContent : null;
    r.wretches = BR.entities.list.filter(e => !e.removed && (e.type === 'wretch' || e.type === 'wretch_lump')).length;
    return r;
  });
  check('d 第三阶段：进入时弹提示；喝杏仁水、吃食物都不治愈', d4.stage === 2 && d4.toasts.includes(S.stages[2]) && d4.afterAW && d4.afterFood, d4);
  check('d 45 s 未治愈 → 死亡结算，原因文字含"悲尸"', d4.dead && d4.t >= 45 && d4.t < 45.1 && !!d4.death && d4.death.cause.includes('悲尸') &&
    d4.death.causeKey === 'transform:wretch' && d4.screen === 'dead' && d4.visible && (d4.causeText || '').includes('悲尸'), d4);
  check('d 玩家变成悲尸不额外生成悲尸', d4.wretches === 0, d4.wretches);

  const d5 = await ev(page, () => {
    const P = BR.player;
    BR.bus.emit('death:continue');
    __inf.step(0.2);
    const r = { dead: P.dead, hp: P.hp, fx: BR.effects.has('wretch_cycle'), screen: BR.game.screen, visible: BR.death.visible };
    __inf.step(50);
    r.later = { dead: P.dead, fx: BR.effects.has('wretch_cycle'), deaths: __inf.ev.deaths.length };
    return r;
  });
  check('d 继续：原地重生后没有感染，之后也不会再"变成悲尸"', !d5.dead && d5.hp === 100 && !d5.fx && d5.screen === 'playing' && !d5.visible && !d5.later.dead && !d5.later.fx, d5);
}

// =====================================================================
// Level 8：层级自己的旧"悲尸感染"持续伤害不再和 wretch_cycle 叠加
// =====================================================================
async function level8(page) {
  const r = await ev(page, seed => {
    __br.start({ mode: 'nightmare', difficulty: 'easy', seed, levelId: '8', settings: { visibility: 1 } });
    __br.setAuto(false);
    __inf.step(0.5);
    __inf.home();
    BR.entities.clear();
    const P = BR.player;
    P.hp = 100; P.hunger = 100; P.sanity = 100;
    const nd = __inf.ev.damage.length;
    const w = __inf.put('wretch', 1.3, 0, true) || BR.entities.spawn('wretch', P.x - Math.sin(__inf.base.yaw) * 1.3, P.feetY, P.z - Math.cos(__inf.base.yaw) * 1.3, { yaw: __inf.base.yaw + Math.PI, force: true });
    const t = __inf.until(() => { __inf.reset(); return BR.effects.has('wretch_cycle') || P.dead; }, 15, 0.05);
    if (w) BR.entities.remove(w);
    const out = { level: BR.game.levelId, spawned: !!w, t, infected: BR.effects.has('wretch_cycle'), hpHit: P.hp };
    P.hunger = 50;
    __inf.use('canned_food');
    out.cured = !BR.effects.has('wretch_cycle');
    const hpCure = P.hp;
    const n1 = __inf.ev.damage.length;
    for (let i = 0; i < 100; i++) { P.hunger = 100; P.sanity = 100; __inf.step(0.2); }
    const all = __inf.ev.damage.slice(nd);
    out.legacyDmg = all.filter(x => x.src === 'hazard:wretch-infection').length;
    out.afterCure = __inf.ev.damage.slice(n1);
    out.hpCure = hpCure;
    out.hpLater = +P.hp.toFixed(2);
    // L8.js 旧的"被悲尸打中叠 20 s 持续伤害"订阅已经删掉（统一走 wretch_cycle），这个旧来源不会再出现，
    // 所以不再检查 player.js 是否屏蔽它（那段临时屏蔽也已随旧代码一起删了）
    return out;
  }, SEED);
  check('Level 8 噩梦：被悲尸划伤感染，吃罐头治好后 20 s 内不再有旧的悲尸感染持续伤害、血量不降', r.level === '8' && r.spawned && r.infected && r.cured &&
    r.legacyDmg === 0 && r.afterCure.length === 0 && r.hpLater >= r.hpCure, r);
}

// =====================================================================
// h：近战出手时机（FE1P H11）
// =====================================================================
// 页面里：右手（foreR 骨骼上、模型 y 低于 handY + 0.03H 的顶点：手掌和手指）蒙皮后的世界坐标；车本地 ↔ 世界
function strikeHelpers() {
  const H = window.__stk = {};
  H.hand = e => {
    const u = e.obj && e.obj.userData.arch, rig = u && u.rig;
    if (!rig) return [];
    const d = rig.meta.dims, sk = rig.skeleton, b = rig.bones.foreR, bi = sk.bones.indexOf(b), geo = rig.mesh.geometry;
    e.obj.updateMatrixWorld(true);
    const M = new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[bi]);
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, out = [], v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      if (si.getX(i) !== bi) continue;
      v.fromBufferAttribute(pos, i);
      if (v.y > d.handY + 0.03 * d.H) continue;
      out.push(v.clone().applyMatrix4(M));
    }
    return out;
  };
  H.L = (p, x, z) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return { x: c * dx - s * dz, z: s * dx + c * dz }; };
  H.W = (p, lx, lz) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  // 点集到司机身体包围盒（车本地）的最近距离
  H.boxD = (p, box, pts) => {
    let best = Infinity;
    for (const q of pts) {
      const l = H.L(p, q.x, q.z), ly = q.y - p.y;
      const dx = Math.max(box.min[0] - l.x, 0, l.x - box.max[0]), dy = Math.max(box.min[1] - ly, 0, ly - box.max[1]), dz = Math.max(box.min[2] - l.z, 0, l.z - box.max[2]);
      best = Math.min(best, Math.hypot(dx, dy, dz));
    }
    return best;
  };
  // 出生点附近的叉车摆到南主通道十字口（和 tests/forklift.mjs 的 YARD 同一处），站到车左侧上车，等坐稳
  H.seat = () => {
    const P = BR.player;
    const v = BR.vehicles.list().slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
    if (!v) return null;
    BR.vehicles.setPose(v.key, { x: -1, z: 32.6, yaw: -Math.PI / 2, steer: 0, lift: 0, spd: 0, lever: 0, on: 0 });
    __inf.step(0.2);
    const p = BR.vehicles.byKey(v.key).pose, st = H.W(p, -1.2, 0.24), seat = H.W(p, 0, 0.24);
    BR.player.reset({ x: st.x, y: BR.phys.groundY(st.x, st.z), z: st.z, yaw: Math.atan2(-(seat.x - st.x), -(seat.z - st.z)) }, { full: false });
    __inf.step(0.05);
    const ok = BR.vehicles.mount(v.key);
    __inf.step(1.6);
    return { key: v.key, ok, seated: BR.vehicles.seated };
  };
  return 0;
}
// L1（种子 12345）开局：等进到 playing、换层过场走完再关掉自动推进
async function startL1(page, mode) {
  await ev(page, m => {
    __br.setAuto(true);
    __br.start({ mode: m, difficulty: m === 'nightmare' ? 'easy' : null, seed: 12345, levelId: '1', settings: { visibility: 1, spawnSlider: 0 } });
    return 0;
  }, mode);
  await page.waitForFunction(m => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1' && BR.game.mode === m, mode, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __inf.step(0.5); return 0; });
}
async function strike(page) {
  await ev(page, strikeHelpers);
  // h0 扣血时刻和动画峰值是同一个数
  const k0 = await ev(page, () => {
    const A = BR.arch.anim, api = BR.entities.api;
    let peak = 0, pk = -1;
    for (let i = 0; i <= 1000; i++) { const v = A.strikeCurve(i / 1000); if (v > peak) { peak = v; pk = i / 1000; } }
    return { hitK: api.STRIKE_HIT_K, slack: api.STRIKE_SLACK, peakAt: pk, peak, PEAK: A.STRIKE_PEAK };
  });
  check('h0 扣血时刻（entities STRIKE_HIT_K）= 抡胳膊动画到峰值的那一刻（strikeCurve 最大值处 / STRIKE_PEAK），容差 0.15 m', k0.hitK === k0.PEAK && Math.abs(k0.peakAt - k0.hitK) < 0.002 && k0.peak === 1 && k0.slack === 0.15, k0);

  // h1 站着的玩家：悲尸起手以后不马上扣血，等到 0.38 个冷却周期（胳膊抡到最前）才扣，感染同一帧；那一帧右手离玩家最近（±1 帧）
  const h1 = await ev(page, seed => {
    __br.start({ mode: 'nightmare', difficulty: 'easy', seed, levelId: 'dev', settings: { visibility: 1 } });
    __br.setAuto(false);
    __inf.step(0.5);
    __inf.home();
    BR.entities.clear(); BR.effects.clear();
    const P = BR.player, api = BR.entities.api;
    P.hp = 100; P.hunger = 100; P.sanity = 100;
    const w = __inf.put('wretch', 1.3, 0, true);
    if (!w) return { ok: false };
    const cd = Math.max(0.2, w.def.attack.cooldown), dt = 1 / 60;
    const nd = __inf.ev.damage.length, ni = __inf.ev.infect.length;
    let start = null, hitAt = null, infAt = null, startHp = null, dHand = [], hitIdx = -1;
    for (let i = 0; i < 60 * 8 && hitAt == null; i++) {
      __inf.reset();
      __inf.step(dt);
      const t = __inf.time();
      if (start == null && api.swinging(w)) { start = api.attackStart(w); startHp = P.hp; }
      if (start != null) {
        const hs = __stk.hand(w);
        let m = Infinity; for (const q of hs) m = Math.min(m, Math.hypot(q.x - P.x, q.z - P.z));
        dHand.push(+m.toFixed(3));
      }
      if (__inf.ev.damage.length > nd && hitAt == null) { hitAt = t; hitIdx = dHand.length - 1; }
      if (BR.effects.has('wretch_cycle') && infAt == null) infAt = t;
    }
    const k = start != null && hitAt != null ? (hitAt - start) / cd : null;
    const near = dHand.slice(Math.max(0, hitIdx - 30), hitIdx + 31);
    const minNear = Math.min.apply(null, near);
    BR.entities.remove(w);
    return { ok: true, cd, start, hitAt, k: k != null ? +k.toFixed(4) : null, curve: k != null ? +BR.arch.anim.strikeCurve(k).toFixed(3) : null, startHp, hp: P.hp,
      infAt, dmg: __inf.ev.damage.slice(nd).length, infects: __inf.ev.infect.length - ni, handAtHit: dHand[hitIdx], minNear, dHand0: dHand[0], lastSwing: w._m.lastSwing };
  }, SEED);
  check('h1 站着的玩家：悲尸起手那一刻不扣血（起手时血还是满的），抡到最前（起手后 0.38 个冷却周期，逐帧 1/60 s）才扣，那一帧动画在峰值附近（≥0.95）',
    h1.ok && h1.start != null && h1.startHp === 100 && h1.k >= 0.38 - 1e-6 && h1.k <= 0.38 + 1 / 60 / h1.cd + 1e-3 && h1.curve >= 0.95 && h1.dmg === 1, h1);
  check('h1 划伤感染和扣血同一帧（不在起手时就感染上）', h1.ok && h1.infAt != null && Math.abs(h1.infAt - h1.hitAt) < 1e-6, { hitAt: h1.hitAt, infAt: h1.infAt });
  check('h1 扣血那一帧右手离玩家最近（前后各半秒里最近的就是这一帧，±1 帧 1 cm 内），比起手时近', h1.ok && h1.handAtHit != null && h1.handAtHit <= h1.minNear + 0.01 && h1.handAtHit < h1.dHand0,
    { handAtHit: h1.handAtHit, minNear: h1.minNear, dHand0: h1.dHand0 });

  // h2 躲开：起手以后玩家一下子退到「攻击距离 + 0.15 m + 抡这一下能扑过去的距离（追击速度 × 0.38 个冷却周期）+ 0.3 m」以外、钉在那里，
  // 怪扑过去也够不着：抡到的那一刻不扣血、不感染（返修 r1：抡的时候怪接着往前扑，只退出攻击距离 + 0.15 m 会被扑上）
  const h2 = await ev(page, () => {
    BR.entities.clear(); BR.effects.clear(); __inf.reset();
    const P = BR.player, api = BR.entities.api;
    P.hp = 100;
    const nd = __inf.ev.damage.length, ni = __inf.ev.infect.length;
    const w = __inf.put('wretch', 1.3, 0, true);
    if (!w) return { ok: false };
    let started = false;
    for (let i = 0; i < 60 * 8 && !started; i++) { __inf.reset(); __inf.step(1 / 60); started = api.swinging(w); }
    // 往后退：离悲尸 range + 半径 + 0.15 + 扑过去的距离 再多 0.3 m
    const sw = w._m.swing, lungeMax = (sw ? sw.v : 0) * Math.max(0, (sw ? sw.at : 0) - __inf.time());
    const b = __inf.base, need = w.def.attack.range + BR.config.player.radius + 0.15 + lungeMax + 0.3;
    const ux = (P.x - w.x), uz = (P.z - w.z), L = Math.hypot(ux, uz) || 1;
    P.x = w.x + ux / L * need; P.z = w.z + uz / L * need;
    const hold = { x: P.x, z: P.z };
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) { P.x = hold.x; P.z = hold.z; __inf.step(1 / 60); landed = !api.swinging(w); }
    const ls = w._m.lastSwing;
    BR.entities.remove(w);
    __inf.base.x = b.x; __inf.base.z = b.z;
    return { ok: true, started, landed, ls, need: +need.toFixed(3), lungeMax: +lungeMax.toFixed(3), dmg: __inf.ev.damage.length - nd, infects: __inf.ev.infect.length - ni, hp: P.hp, fx: BR.effects.has('wretch_cycle') };
  });
  check('h2 起手以后玩家退到攻击距离 + 0.15 m + 怪能扑过去的距离以外：抡到那一刻算没打中（不扣血、不感染，lastSwing.why = far）', h2.ok && h2.started && h2.landed && h2.dmg === 0 && h2.infects === 0 && h2.hp === 100 && !h2.fx &&
    !!h2.ls && h2.ls.hit === false && h2.ls.why === 'far' && h2.lungeMax > 1, h2);

  // h2b 抡的时候接着扑（返修 r1）：起手以后玩家往后退到攻击距离 + 0.5 m（原来原地抡就够不着），怪抡的这一下往前扑，抡到那一刻打中；
  // 扑完离玩家不近于「攻击距离 − 0.15 m − 1 帧」（不贴到人身上）
  const h2b = await ev(page, () => {
    BR.entities.clear(); BR.effects.clear(); __inf.reset();
    const P = BR.player, api = BR.entities.api;
    P.hp = 100;
    const nd = __inf.ev.damage.length;
    const w = __inf.put('wretch', 1.3, 0, true);
    if (!w) return { ok: false };
    let started = false;
    for (let i = 0; i < 60 * 8 && !started; i++) { __inf.reset(); __inf.step(1 / 60); started = api.swinging(w); }
    const reach = w.def.attack.range + BR.config.player.radius;
    const ux = (P.x - w.x), uz = (P.z - w.z), L = Math.hypot(ux, uz) || 1;
    const b = __inf.base;
    P.x = w.x + ux / L * (reach + 0.5); P.z = w.z + uz / L * (reach + 0.5);
    const hold = { x: P.x, z: P.z }, w0 = { x: w.x, z: w.z };
    let landed = false, minD = Infinity;
    for (let i = 0; i < 60 && !landed; i++) { P.x = hold.x; P.z = hold.z; __inf.step(1 / 60); minD = Math.min(minD, Math.hypot(P.x - w.x, P.z - w.z)); landed = !api.swinging(w); }
    const ls = w._m.lastSwing, moved = Math.hypot(w.x - w0.x, w.z - w0.z), v = w._m.chaseV;
    BR.entities.remove(w);
    __inf.base.x = b.x; __inf.base.z = b.z;
    return { ok: true, started, landed, ls, moved: +moved.toFixed(3), minD: +minD.toFixed(3), reach, v, dmg: __inf.ev.damage.length - nd, hp: P.hp };
  });
  check('h2b 抡的时候怪接着往前扑：起手后玩家退到攻击距离 + 0.5 m，抡到那一刻照样打中（扑了 ≥ 0.3 m），扑完不贴到人身上（离人 ≥ 攻击距离 − 0.15 m − 0.11 m）',
    h2b.ok && h2b.started && h2b.landed && !!h2b.ls && h2b.ls.hit === true && h2b.dmg === 1 && h2b.moved >= 0.3 && h2b.minD >= h2b.reach - 0.15 - 0.11, h2b);

  // h3 坐在叉车上：车右侧 3.2 m 放悲尸，它走到车侧打司机。扣血那一帧手离司机身体包围盒（坐姿人形同一套摆法）≤ 0.15 m，离座椅 ≤ 攻击距离 + 人的半径
  await startL1(page, 'nightmare');
  const h3 = await ev(page, () => {
    BR.entities.clear(); BR.effects.clear();
    const s = __stk.seat();
    if (!s || !s.seated) return { ok: false, s };
    const P = BR.player, k = s.key, pose = () => BR.vehicles.byKey(k).pose;
    P.hp = 100; P.sanity = 100; P.hunger = 100;
    const body = BR.coop.seatBody({ detail: 'high' });
    const w0 = __stk.W(pose(), 3.2, 0.3), st0 = BR.vehicles.seatWorld(k);
    const w = BR.entities.spawn('wretch', w0.x, undefined, w0.z, { force: true, yaw: Math.atan2(-(st0.x - w0.x), -(st0.z - w0.z)) });   // 面朝座椅
    if (!w || !body) return { ok: false, w: !!w, body: !!body };
    const nd = __inf.ev.damage.length;
    let hit = null;
    for (let i = 0; i < 30 * 10 && !hit; i++) {
      __inf.step(1 / 30);
      P.sanity = 100;
      if (__inf.ev.damage.length > nd) {
        const p = pose(), st = BR.vehicles.seatWorld(k);
        hit = { boxD: +__stk.boxD(p, body.box, __stk.hand(w)).toFixed(3), dSeat: +Math.hypot(w.x - st.x, w.z - st.z).toFixed(3), l: __stk.L(p, w.x, w.z), ls: w._m.lastSwing };
      }
    }
    BR.entities.remove(w);
    return { ok: true, hit, reach: w.def.attack.range + BR.config.player.radius, box: body.box, hp: P.hp };
  });
  check('h3 坐在叉车上：车侧的悲尸打到司机，扣血那一帧它的手离司机身体包围盒 ≤ 0.15 m（离座椅 ≤ 攻击距离 + 人的半径）', h3.ok && !!h3.hit && h3.hit.boxD <= 0.15 && h3.hit.dSeat <= h3.reach + 1e-6, h3);

  // h4 车外 1 m：钉在车身侧面外 1 m（左右）和车尾外 1 m 的悲尸 4 s 打不到司机，直接调 attack 也返回 false
  const h4 = await ev(page, () => {
    const P = BR.player, api = BR.entities.api, k = BR.vehicles.seated;
    if (!k) return { ok: false };
    const p = BR.vehicles.byKey(k).pose, G = (BR.L1forklift && BR.L1forklift.geo) || {}, half = G.half || { x: 0.6, z: 1.3 };
    const spots = { left: [-(half.x + 1.0), 0.24], right: [half.x + 1.0, 0.24], rear: [0, half.z + 1.0] };
    const out = {};
    for (const nm in spots) {
      BR.entities.clear();
      P.hp = 100;
      const at = __stk.W(p, spots[nm][0], spots[nm][1]), st = BR.vehicles.seatWorld(k);
      const w = BR.entities.spawn('wretch', at.x, undefined, at.z, { force: true, yaw: Math.atan2(-(st.x - at.x), -(st.z - at.z)) });
      if (!w) { out[nm] = null; continue; }
      const nd = __inf.ev.damage.length;
      let att = 0, swung = 0, tgt = 0;
      for (let i = 0; i < 30 * 4; i++) {
        w.x = at.x; w.z = at.z;
        __inf.step(1 / 30);
        if (api.swinging(w)) swung++;
        if (w.state === 'attack') att++;
        if (w.target && w.target.kind === 'player') tgt++;
      }
      w.x = at.x; w.z = at.z; w.cooldown = 0;
      const direct = api.attack(w, P);
      out[nm] = { dmg: __inf.ev.damage.length - nd, swung, att, tgt, direct, dSeat: +Math.hypot(at.x - st.x, at.z - st.z).toFixed(3) };
      BR.entities.remove(w);
    }
    return { ok: true, out, hp: P.hp };
  });
  check('h4 车外 1 m（车身左右侧面外 1 m、车尾外 1 m）的悲尸盯着坐在车上的人 4 s 也打不到，直接调 attack 也不起手', h4.ok && ['left', 'right', 'rear'].every(n => h4.out[n] && h4.out[n].tgt > 0 && h4.out[n].dmg === 0 && h4.out[n].swung === 0 && h4.out[n].direct === false), h4);

  // h5 游玩模式坐在车上：悲尸贴着车侧 10 s，不起手、不掉血（实体不攻击玩家照旧）
  await startL1(page, 'casual');
  const h5 = await ev(page, () => {
    BR.entities.clear();
    const s = __stk.seat();
    if (!s || !s.seated) return { ok: false, s };
    const P = BR.player, api = BR.entities.api, p = BR.vehicles.byKey(s.key).pose;
    const at = __stk.W(p, 1.0, 0.24), st = BR.vehicles.seatWorld(s.key);
    const w = BR.entities.spawn('wretch', at.x, undefined, at.z, { force: true, yaw: Math.atan2(-(st.x - at.x), -(st.z - at.z)) });
    if (!w) return { ok: false };
    const hp0 = P.hp, nd = __inf.ev.damage.length;
    let swung = 0;
    for (let i = 0; i < 10 * 10; i++) { w.x = at.x; w.z = at.z; __inf.step(0.1); if (api.swinging(w) || w.state === 'attack') swung++; }
    w.cooldown = 0;
    const direct = api.attack(w, P);
    BR.entities.remove(w);
    return { ok: true, mode: BR.game.mode, atk: BR.game.attackPlayers, hp0, hp: P.hp, dmg: __inf.ev.damage.length - nd, swung, direct };
  });
  check('h5 游玩模式坐在叉车上：悲尸贴着车侧 10 s 不起手、不掉血，直接调 attack 也不起手', h5.ok && h5.mode === 'casual' && !h5.atk && h5.hp === h5.hp0 && h5.dmg === 0 && h5.swung === 0 && h5.direct === false, h5);

  // h6 人一直往前走甩不掉悲尸（返修 r1，验收员挑的「扣血挪后以后人一直走，所有近战怪都打不到」）：噩梦·简单，种子 12345，
  // 真键盘按住 W 直着走 12 s（步行 3 m/s，不冲刺），身后 2 m 放一只悲尸。HEAD（扣血在起手那一刻）同一设置挨打 10 次，
  // 现在至少 7 次（差 ≤ 30%）；站着不动同样 ≥ 7 次
  await startL1(page, 'nightmare');
  const lane = await ev(page, () => {
    for (let i = 0; i < 4000; i++) {
      const x = -60 + (i * 37.17) % 120, z = -60 + (i * 53.31) % 120, yaw = (i % 4) * Math.PI / 2;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = fz, sz = -fx;
      let ok = true;
      for (const o of [-0.4, 0, 0.4]) for (const y of [0.3, 1.0]) {
        const h = BR.phys.raycast(x + sx * o - fx * 5, y, z + sz * o - fz * 5, fx, 0, fz, 50, {});
        if (h && h.dist < 50) { ok = false; break; }
      }
      if (ok && Math.abs(BR.phys.groundY(x, z)) < 0.01) return { x, z, yaw };
    }
    return null;
  });
  const walkRun = async walk => {
    await ev(page, l => {
      BR.entities.clear(); BR.effects.clear();
      const P = BR.player;
      P.reset({ x: l.x, y: BR.phys.groundY(l.x, l.z), z: l.z, yaw: l.yaw }, { full: false });
      P.pitch = 0; P.hp = 100; P.sanity = 100; P.hunger = 100;
      __inf.step(0.1);
      const fx = -Math.sin(l.yaw), fz = -Math.cos(l.yaw);
      window.__h6w = BR.entities.spawn('wretch', l.x - fx * 2.0, undefined, l.z - fz * 2.0, { force: true, yaw: l.yaw });
      window.__h6n = __inf.ev.damage.length;
      return 0;
    }, lane);
    if (walk) await page.keyboard.down('KeyW');
    for (let i = 0; i < 36; i++) await ev(page, () => { for (let j = 0; j < 10; j++) { BR.player.hp = 100; BR.player.sanity = 100; __inf.step(1 / 30); } BR.effects.clear(); return 0; });
    if (walk) await page.keyboard.up('KeyW');
    return ev(page, l => {
      const P = BR.player, w = window.__h6w;
      const r = { hits: __inf.ev.damage.length - window.__h6n, moved: +Math.hypot(P.x - l.x, P.z - l.z).toFixed(2), d: w ? +Math.hypot(w.x - P.x, w.z - P.z).toFixed(2) : null, ls: w && w._m.lastSwing };
      if (w) BR.entities.remove(w);
      return r;
    }, lane);
  };
  const h6w = lane ? await walkRun(true) : null, h6s = lane ? await walkRun(false) : null;
  check('h6 真键盘按住 W 一直往前走 12 s（不冲刺），身后的悲尸照样追上来打中 ≥ 7 次（HEAD 同一设置 10 次）；站着不动也 ≥ 7 次',
    !!lane && h6w.moved >= 30 && h6w.hits >= 7 && h6s.hits >= 7, { lane, walk: h6w, still: h6s });

  // h7 笑魇（smiler.js，FE1Q J1）和别的近战怪同一个出手时刻：60 fps 推 8 s，每次扣血那一帧脸正好鼓到最大
  // （前后半秒里脸最大的那一帧离扣血那一帧 ≤1 帧，扣血那一帧 ≥ 最大的 95%），不再是先鼓脸、缩回去才掉血
  await startL1(page, 'nightmare');
  const h7 = await ev(page, () => {
    BR.entities.clear(); BR.effects.clear();
    const l = { x: -31.32, z: 33.24, yaw: 0 }, P = BR.player;
    P.reset({ x: l.x, y: BR.phys.groundY(l.x, l.z), z: l.z, yaw: l.yaw }, { full: false });
    P.hp = 100; P.sanity = 100; __inf.step(0.1);
    const e = BR.entities.spawn('smiler', l.x, undefined, l.z + 2.0, { force: true, yaw: l.yaw });
    if (!e) return { ok: false };
    const nd = __inf.ev.damage.length, rows = [], hitIdx = [];
    for (let i = 0; i < 60 * 8; i++) {
      P.hp = 100; P.sanity = 100;
      const n0 = __inf.ev.damage.length;
      __br.step(1 / 60);
      const f = e.obj && e.obj.getObjectByName('smilerFace');
      rows.push(f ? f.scale.x : 1);
      if (__inf.ev.damage.length > n0) hitIdx.push(i);
    }
    const near = hitIdx.map(i => {
      const a = Math.max(0, i - 30), w = rows.slice(a, i + 31);
      let m = -Infinity, mi = -1;
      for (let j = 0; j < w.length; j++) if (w[j] > m + 1e-9) { m = w[j]; mi = a + j; }
      return { i, atHit: +rows[i].toFixed(4), max: +m.toFixed(4), maxAt: mi, off: mi - i };
    });
    BR.entities.remove(e);
    return { ok: true, hits: hitIdx.length, dmg: __inf.ev.damage.length - nd, src: __inf.ev.damage.slice(nd).map(d => d.src).filter((v, k, a) => a.indexOf(v) === k), near };
  });
  check('h7 笑魇 60 fps 推 8 s：每次扣血那一帧脸正好鼓到最大（前后半秒里最大的那一帧离扣血 ≤1 帧，扣血那一帧 ≥ 最大的 95%），和别的近战怪同一个出手时刻', h7.ok && h7.hits >= 3 &&
    h7.near.every(q => q.max > 1.1 && Math.abs(q.off) <= 1 && (q.atHit - 1) >= 0.95 * (q.max - 1)), h7);
}

// =====================================================================
// 快照：客机侧（新房主 → 新客机、旧房主 → 新客机、新房主 → 旧客机）；客机回单机
// =====================================================================
// =====================================================================
// k：怪打坐在叉车上的人（FE1R K6），顶点级
// =====================================================================
function k6Helpers() {
  const K = window.__k6 = {};
  K.toL = (p, x, y, z) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return [c * dx - s * dz, y - (p.y || 0), s * dx + c * dz]; };
  K.W = (p, lx, lz) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  const vis = o => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  // 实体此刻的全部顶点（蒙皮按 CPU 算，世界坐标）；加法混合的光晕、精灵不算
  K.verts = root => {
    const out = [], bones = [], v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
    root.updateMatrixWorld(true);
    const comp = (a, i, j) => (j === 0 ? a.getX(i) : j === 1 ? a.getY(i) : j === 2 ? a.getZ(i) : a.getW(i));
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position || !vis(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent && m.blending === THREE.AdditiveBlending) return;
      const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const sk = o.isSkinnedMesh && o.skeleton && si && sw ? o.skeleton : null;
      const mats = sk ? sk.bones.map((b, q) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[q])) : null;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let bn = '';
        if (sk) {
          v.applyMatrix4(o.bindMatrix); acc.set(0, 0, 0); let bw = -1;
          for (let j = 0; j < 4; j++) { const w = comp(sw, i, j); if (!(w > 0)) continue; const bi = comp(si, i, j); acc.add(tmp.copy(v).applyMatrix4(mats[bi]).multiplyScalar(w)); if (w > bw) { bw = w; bn = sk.bones[bi].name; } }
          v.copy(acc).applyMatrix4(o.bindMatrixInverse);
        }
        v.applyMatrix4(o.matrixWorld);
        out.push(v.x, v.y, v.z); bones.push(bn);
      }
    });
    return { out, bones };
  };
  // 叉车实心部件（车本地）：14 个部件盒（随升降）+ 斜立柱、靠背按真实棱柱 + 坐垫、减震底座
  const PR = [['postFL*', -0.455, -0.405, [[-0.75, 0.99], [-0.69, 0.99], [-0.52, 2.07], [-0.58, 2.07]]], ['postFR*', 0.405, 0.455, [[-0.75, 0.99], [-0.69, 0.99], [-0.52, 2.07], [-0.58, 2.07]]],
    ['postRL*', -0.455, -0.405, [[0.59, 1.08], [0.65, 1.08], [0.56, 2.07], [0.5, 2.07]]], ['postRR*', 0.405, 0.455, [[0.59, 1.08], [0.65, 1.08], [0.56, 2.07], [0.5, 2.07]]],
    ['backrest', -0.25, 0.25, [[0.4, 1.13], [0.5, 1.13], [0.54, 1.63], [0.44, 1.63]]]];
  // 坐垫：FE1R 起各档没有减震底座，坐垫一整块 y 0.998–1.16（S13）；靠背 K9 加宽到 ±0.25（L1.js forkliftModel）
  const BX = [['cushion', -0.25, 0.25, 0.998, 1.16, 0.02, 0.46]];
  K.parts = lift => {
    const ob = BR.L1forklift.geo.obbs(lift || 0).map(o => ({ name: o.name, kind: 'box', x0: o.cx - o.hx, x1: o.cx + o.hx, y0: o.cy - o.hy, y1: o.cy + o.hy, z0: o.cz - o.hz, z1: o.cz + o.hz }));
    for (const b of BX) ob.push({ name: b[0], kind: 'box', x0: b[1], x1: b[2], y0: b[3], y1: b[4], z0: b[5], z1: b[6] });
    for (const p of PR) ob.push({ name: p[0], kind: 'prism', x0: p[1], x1: p[2], poly: p[3] });
    return ob;
  };
  const inPoly = (P, z, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && z < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const segD = (a, b, z, y) => { const dz = b[0] - a[0], dy = b[1] - a[1], L = dz * dz + dy * dy; let t = L > 0 ? ((z - a[0]) * dz + (y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(z - a[0] - t * dz, y - a[1] - t * dy); };
  K.depth = (P, x, y, z) => {
    if (P.kind === 'box') { const d = Math.min(x - P.x0, P.x1 - x, y - P.y0, P.y1 - y, z - P.z0, P.z1 - z); return d > 0 ? d : 0; }
    const dx = Math.min(x - P.x0, P.x1 - x);
    if (dx <= 0 || !inPoly(P.poly, z, y)) return 0;
    let m = Infinity; for (let i = 0; i < P.poly.length; i++) m = Math.min(m, segD(P.poly[i], P.poly[(i + 1) % P.poly.length], z, y));
    return Math.min(dx, m);
  };
  const cp = (px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, o) => {
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { o[0] = ax; o[1] = ay; o[2] = az; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { o[0] = bx; o[1] = by; o[2] = bz; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); o[0] = ax + v * abx; o[1] = ay + v * aby; o[2] = az + v * abz; return; }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { o[0] = cx; o[1] = cy; o[2] = cz; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); o[0] = ax + w * acx; o[1] = ay + w * acy; o[2] = az + w * acz; return; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); o[0] = bx + w * (cx - bx); o[1] = by + w * (cy - by); o[2] = bz + w * (cz - bz); return; }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    o[0] = ax + abx * v + acx * w; o[1] = ay + aby * v + acy * w; o[2] = az + abz * v + acz * w;
  };
  // 怪的顶点（车本地）离坐着的人（三角形）最近多远、插进去最深多深：按最近三角形的法线判里外，但只认最近点落在三角形面里的
  // （最近点在棱上 / 角上时面法线判不准 —— 坐着的人身上的反光条、臂章是薄薄的一圈 / 一块，外面 5 cm 的点会被判成「在里面」）
  K.vsDriver = (L, D, bones) => {
    const V = D.V, I = D.I, bx = D.box, o = [0, 0, 0], gapBy = {};
    let gap = Infinity, inD = 0, inI = -1, inT = -1, inP = null;
    for (let i = 0; i < L.length; i += 3) {
      const x = L[i], y = L[i + 1], z = L[i + 2];
      if (x < bx.min[0] - 0.05 || x > bx.max[0] + 0.05 || y < bx.min[1] - 0.05 || y > bx.max[1] + 0.05 || z < bx.min[2] - 0.05 || z > bx.max[2] + 0.05) continue;
      let dm = Infinity, sg = 0, face = false, tm = -1;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        cp(x, y, z, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2], o);
        const d = (o[0] - x) ** 2 + (o[1] - y) ** 2 + (o[2] - z) ** 2;
        if (d < dm) {
          dm = d; tm = t;
          const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
          const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          sg = (x - o[0]) * nx + (y - o[1]) * ny + (z - o[2]) * nz;
          // 最近点的重心坐标：三个都 > 0 才是落在面里
          const px = o[0] - V[a], py = o[1] - V[a + 1], pz = o[2] - V[a + 2];
          const d00 = ux * ux + uy * uy + uz * uz, d01 = ux * wx + uy * wy + uz * wz, d11 = wx * wx + wy * wy + wz * wz, d20 = px * ux + py * uy + pz * uz, d21 = px * wx + py * wy + pz * wz;
          const den = d00 * d11 - d01 * d01, bv = den ? (d11 * d20 - d01 * d21) / den : 0, bw = den ? (d00 * d21 - d01 * d20) / den : 0;
          face = bv > 1e-4 && bw > 1e-4 && 1 - bv - bw > 1e-4;
        }
      }
      const d = Math.sqrt(dm);
      gap = Math.min(gap, d);
      if (bones) { const bn = bones[i / 3]; if (/^fore/.test(bn) && !(gapBy[bn] <= d)) gapBy[bn] = +d.toFixed(4); }
      if (sg < 0 && face && d > inD) { inD = d; inI = i / 3; inT = tm; inP = [x, y, z].map(v => +v.toFixed(3)); }
    }
    // inT：插得最深的那个顶点离得最近的司机三角形（调用方换成司机身上的骨骼名，失败时好定位）
    return { gap: Number.isFinite(gap) ? +gap.toFixed(4) : null, inD: +inD.toFixed(4), inI, inT, inP, gapBy };
  };
  // 站不站得稳（返修 FE1R · repair-r3）：L = 怪的顶点（车本地，打平）；着力点 = 离地 ≤2 cm 的顶点、部件盒顶面上方 0–1 cm 落在它脚印里的顶点、
  // 部件盒侧面外 ≤1 cm（落在它竖直范围里）的顶点；返回顶点重心（x, z）在着力点凸包里往里多少 m（凸包外为负，围不成一块为 −9）
  K.balance = (L, parts) => {
    const S = [];
    let mx = 0, mz = 0, n = 0;
    for (let j = 0; j < L.length; j += 3) {
      const x = L[j], y = L[j + 1], z = L[j + 2];
      mx += x; mz += z; n++;
      if (y <= 0.02) { S.push([x, z]); continue; }
      for (const B of parts) {
        if (B.kind !== 'box') continue;
        if (B.y1 > 0.3 && x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1 && y >= B.y1 - 0.004 && y <= B.y1 + 0.01) { S.push([x, z]); break; }
        if (y < B.y0 || y > B.y1) continue;
        const ox = x > B.x1 ? x - B.x1 : x < B.x0 ? B.x0 - x : 0, oz = z > B.z1 ? z - B.z1 : z < B.z0 ? B.z0 - z : 0;
        if ((ox > 0 || oz > 0) && ox <= 0.01 && oz <= 0.01) { S.push([x, z]); break; }
      }
    }
    if (!n || S.length < 3) return -9;
    mx /= n; mz /= n;
    S.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of S) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let q = S.length - 1; q >= 0; q--) { const a = S[q]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], a) <= 0) hi.pop(); hi.push(a); }
    const H = lo.slice(0, -1).concat(hi.slice(0, -1));
    if (H.length < 3) return -9;
    let m = Infinity;
    for (let q = 0; q < H.length; q++) { const a = H[q], b = H[(q + 1) % H.length], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]); if (Ln > 1e-9) m = Math.min(m, cr(a, b, [mx, mz]) / Ln); }
    return +m.toFixed(4);
  };
  // 一趟：type 从车本地 dir 方向 3.6 m 处出来，逐帧推 1/30 s，最多 maxF 帧；扣血两次后再推 1 s（收手）
  K.run = (key, type, dir, maxF, phase) => {
    const P = BR.player, veh = BR.vehicles.byKey(key);
    BR.entities.clear(); if (BR.effects.clear) BR.effects.clear();
    P.hp = 100; P.sanity = 100; P.hunger = 100;
    let restore = null;
    if (type === 'smiler') { if (veh.pose.hl !== 0) BR.vehicles.toggleLight(); const o = BR.world.lightAt; BR.world.lightAt = () => 0.05; restore = () => { BR.world.lightAt = o; if (veh.pose.hl === 0) BR.vehicles.toggleLight(); }; }
    const def = BR.entityTypes.get(type), r = +def.radius || 0.4, h = +def.height || 1.8;
    const q2 = Math.SQRT1_2, D = { front: [0, -1], frontLeft: [-q2, -q2], left: [-1, 0], backLeft: [-q2, q2], back: [0, 1], backRight: [q2, q2], right: [1, 0], frontRight: [q2, -q2] }[dir];
    let at = null;
    // 伏击型（返修 FE1R · repair-r1）：啼物 3 m 内才扑（triggerRange 3），放在 2.5 m 左右；Nguithr'xurh 是一动不动挂在天花板上的陷阱（1.2 m 内才落下来），
    // 放在离座椅 1 m 的天花板上（它的碰撞圆柱在地上、和车身重叠也不要紧：fixed，不被推、不挡车）
    const RR = { growler: [2.5, 2.8, 2.2, 2.9], nguithrxurh: [1.0, 1.1, 0.95] }[type] || [3.6, 4.2, 3.2, 4.8, 5.4, 2.8, 6.0, 6.8];
    // 返修 FE1R · repair-r2（验收员 tests：啼物车前 2.5 m 那个出生点前腿第 1 帧就插在货叉里 —— 测试摆错了，不是怪走进去的）：
    // 出生点还要让怪的网格整个在车外（出生那一帧网格顶点压进车的实心部件 = 0），压到了就往两边挪一点（同一个距离左右 0.6 / 0.9 m）再换下一个距离
    const parts0 = K.parts(veh.pose.lift), PX = [-D[1], D[0]];
    let e = null;
    for (const rr of RR) for (const lat of (type === 'nguithrxurh' ? [0] : [0, 0.6, -0.6, 0.9, -0.9])) {
      if (e) break;
      const w = K.W(veh.pose, D[0] * rr + PX[0] * lat, 0.24 + D[1] * rr + PX[1] * lat);
      if (type !== 'nguithrxurh' && BR.phys.overlapCircle(w.x, w.z, r, BR.phys.groundY(w.x, w.z) + 0.02, h)) continue;
      const c = BR.entities.spawn(type, w.x, undefined, w.z, { force: true });
      if (!c) continue;
      if (type !== 'nguithrxurh') {
        c.obj.updateMatrixWorld(true);
        const E0 = K.verts(c.obj); let d0 = 0;
        for (let j = 0; j < E0.out.length; j += 3) { const q = K.toL(veh.pose, E0.out[j], E0.out[j + 1], E0.out[j + 2]); for (const Pt of parts0) d0 = Math.max(d0, K.depth(Pt, q[0], q[1], q[2])); }
        if (d0 > 0) { BR.entities.remove(c); continue; }
      }
      e = c; at = w;
    }
    if (!e) { if (restore) restore(); return { type, dir, error: 'no free spot' }; }
    // 摆动相位（返修 FE1R · repair-r2：按实体 id 定，测试再强制几个相位各跑一遍）
    { const u = e.obj && e.obj.userData && e.obj.userData.arch; if (u && phase != null) { u.seedFor = e.id; u.seed = phase; } }
    // 拟态（窃皮者）伪装着只在目标 3 m 内才现形：这里量的是打坐车的人，直接按现形以后算（伪装、现形的逻辑不在这一项）
    const ar = e.data && e.data.arch;
    if (ar && ar.form === 'disguise') { ar.form = 'true'; ar.lostAt = BR.entities.api.time; e.state = 'chase'; }
    const reach = !!(BR.arch.seatReach && BR.arch.seatReach(e));
    const parts = K.parts(veh.pose.lift);
    const ch = parts.find(o => o.name === 'chassis');
    const ua = e.obj && e.obj.userData && e.obj.userData.arch;
    const ssd = e.def.seatStrike, sup = !!(ssd && (ssd.kind === 'chain' || (ssd.kind === 'leap' && !ssd.fixed)));
    const res = { type, dir, sup: sup ? [] : null, phase: phase == null ? null : phase, chains: !!(ua && ua.rig && ua.rig.meta && ua.rig.meta.chains && ua.rig.meta.chains.length), at: K.toL(veh.pose, at.x, 0, at.z).map(v => +v.toFixed(2)), reach, hits: [], pen: 0, penAt: null, feet: 0, frames: 0 };
    let stopAt = maxF, nd = __inf.ev.damage.length, still = 0, lx0 = e.x, lz0 = e.z;
    for (let i = 0; i < stopAt; i++) {
      __inf.step(1 / 30);
      res.frames = i + 1;
      P.sanity = 100;
      BR.entities.makeNoise(1, 0.2);
      if (e.removed || e.dead) break;
      // 够不着的怪走到车旁守着不动了（1.5 s 挪不到 2 cm）：再看 1 s 就收（省时间，走近那一段已经量过）
      if (!reach) { if (Math.hypot(e.x - lx0, e.z - lz0) < 0.02) still++; else { still = 0; lx0 = e.x; lz0 = e.z; } if (still === 45 && stopAt === maxF) stopAt = Math.min(maxF, i + 30); }
      P.yaw = Math.atan2(-(e.x - P.x), -(e.z - P.z));
      const p = veh.pose, l = K.toL(p, e.x, e.y, e.z);
      // 只算这只怪扣的血（不算光盯着扣理智的、断电的手臂之类）
      const hit = __inf.ev.damage.slice(nd).some(d => d.src === type && d.hp > 0);
      nd = __inf.ev.damage.length;
      if (!(Math.abs(l[0]) < 3.2 && l[2] > -3.6 && l[2] < 3.2) && !hit) continue;
      const E = K.verts(e.obj), L = new Float32Array(E.out.length);
      for (let j = 0; j < E.out.length; j += 3) { const q = K.toL(p, E.out[j], E.out[j + 1], E.out[j + 2]); L[j] = q[0]; L[j + 1] = q[1]; L[j + 2] = q[2]; }
      for (let j = 0; j < L.length; j += 3) {
        const x = L[j], y = L[j + 1], z = L[j + 2];
        if (Math.abs(x) > 0.7 || z < -2.2 || z > 1.4 || y > 2.3 || y < -0.05) continue;
        for (const Pt of parts) { const d = K.depth(Pt, x, y, z); if (d > res.pen) { res.pen = +d.toFixed(4); res.penAt = { part: Pt.name, f: i, bone: E.bones[j / 3], swing: BR.entities.api.swinging(e), vf: ua ? [ua.vfDepth, ua.vfAfter, ua.vfAfterBone, ua._ext] : null, el: K.toL(veh.pose, e.x, e.y, e.z).map(v => +v.toFixed(2)) }; } }
        if (y < 0.25) { const d = K.depth(ch, x, y, z); if (d > res.feet) res.feet = +d.toFixed(4); }
      }
      // 返修 FE1R · repair-r2（验收员 play：猎犬扑坐车的人时整只浮在半空、悬停）：有没有东西托着 —— 最低的顶点离地 ≤2 cm（脚踩在地上），
      // 或者有顶点在车身哪个部件盒顶面上方 0–1 cm、落在它的脚印里（前脚搭在发动机盖顶面上）；pivot 的高度（腾空那几帧看是不是按重力走的抛物线）
      if (sup) {
        let ymin = Infinity, onCar = false;
        for (let j = 0; j < L.length; j += 3) {
          const x = L[j], y = L[j + 1], z = L[j + 2];
          if (y < ymin) ymin = y;
          if (!onCar) for (const Pt of parts) if (Pt.kind === 'box' && Pt.y1 > 0.3 && x >= Pt.x0 && x <= Pt.x1 && z >= Pt.z0 && z <= Pt.z1 && y >= Pt.y1 - 0.004 && y <= Pt.y1 + 0.01) { onCar = true; break; }
        }
        const pw = ua && ua.pivot ? ua.pivot.getWorldPosition(new THREE.Vector3()) : null;
        // 返修 FE1R · repair-r3（验收员 play major：猎犬前爪搭在发动机盖上、后腿离地 0.4 m 吊着，重心在着力线外 26 cm）：扑在车上的那几帧（ua.leap）
        // 站不站得稳 —— 顶点重心（水平投影）在着力点（离地 ≤2 cm、部件盒顶面 0–1 cm、部件盒侧面外 ≤1 cm）凸包里往里多少（口径同物资裁定 B）
        const bal = ua && ua.leap ? K.balance(L, parts) : null;
        res.sup.push([i, ymin <= 0.02 || onCar ? 1 : 0, pw ? +(pw.y - (p.y || 0)).toFixed(5) : null, ua && ua.perch ? ua.perch.phase : null, ua && ua.leap ? 1 : 0, onCar ? 1 : 0, bal]);
      }
      if (hit) {
        let hy = P.yaw - p.yaw; while (hy > Math.PI) hy -= 2 * Math.PI; while (hy < -Math.PI) hy += 2 * Math.PI;
        const sb = BR.coop.seatBody({ headYaw: Math.max(-1.5, Math.min(1.5, hy)), pitch: P.pitch, parts: true });
        const vd = K.vsDriver(L, { V: sb.verts, I: sb.index, box: sb.box }, E.bones);
        if (!(vd.gap > 0.02)) delete vd.gapBy;
        if (vd.inI >= 0) vd.inBone = E.bones[vd.inI];
        if (vd.inT >= 0 && sb.bone) vd.drvBone = sb.boneNames[sb.bone[sb.index[vd.inT]]] + '/' + sb.slotNames[sb.slot[sb.index[vd.inT]]];
        delete vd.inI; delete vd.inT;
        if (!(vd.inD > 0.01)) delete vd.inP;
        res.hits.push(Object.assign({ f: i, el: l.map(v => +v.toFixed(3)) }, vd));
        P.hp = 100;
        if (res.hits.length >= 2 && stopAt === maxF) stopAt = Math.min(maxF, i + 30);
      }
    }
    { const l = K.toL(veh.pose, e.x, e.y, e.z); res.end = { l: l.map(v => +v.toFixed(2)), state: e.state, side: e._m && e._m.seatSide, cd: +(+e.cooldown || 0).toFixed(2)}; }
    // 没东西托着的那几帧：连着的一段一段，每段里 pivot 竖直加速度（二阶差分 × 30²）都在 −g ±25%（按重力走的抛物线，不是匀速平移、悬停）；
    // 第一次扣血以前这样的段最多一段（一次起跳）
    if (res.sup) {
      const S = res.sup, segs = [];
      let cur = null;
      for (let q = 0; q < S.length; q++) {
        const contig = q > 0 && S[q][0] === S[q - 1][0] + 1;
        // 跑起来四脚同时离地那一两帧（步态）不算：只看扑人的动作（seatLeap 摆着 pivot）那几帧
        // 腾空途中擦过车身顶面那一两帧（算「托着」）不把一次起跳拆成几段：隔 ≤2 帧的接起来
        if (!S[q][1] && S[q][4]) { if (!cur || !contig || S[q][0] - cur.f1 > 3) { cur = { f0: S[q][0], ys: [], fs: [] }; segs.push(cur); } cur.ys.push(S[q][2]); cur.fs.push(S[q][0]); cur.f1 = S[q][0]; }
        else if (cur && S[q][0] - cur.f1 > 2) cur = null;
      }
      const hit0 = res.hits.length ? res.hits[0].f : Infinity;
      res.air = segs.map(sg => {
        let worst = 0;
        for (let q = 1; q + 1 < sg.ys.length; q++) { if (sg.fs[q + 1] - sg.fs[q] !== 1 || sg.fs[q] - sg.fs[q - 1] !== 1) continue; const a = (sg.ys[q + 1] - 2 * sg.ys[q] + sg.ys[q - 1]) * 900; worst = Math.max(worst, Math.abs(a / -9.8 - 1)); }
        return { f0: sg.f0, f1: sg.f1, s: +((sg.f1 - sg.f0 + 1) / 30).toFixed(3), gErr: +worst.toFixed(3), beforeHit: sg.f1 < hit0 };
      });
      res.airBad = res.air.filter(a => a.gErr > 0.25).length + Math.max(0, res.air.filter(a => a.beforeHit).length - 1);
      res.airMax = res.air.reduce((m, a) => Math.max(m, a.s), 0);
      // 站稳（repair-r3）：趴在车上不下来的那几帧（perch 'on'）每一帧重心都在凸包里 ≥3 mm；搭在车身上又站不稳的（扑上去前脚落在发动机盖上、
      // 咬一口、一蹬那一下）每次连着最多 9 帧（0.3 s）—— 站不稳的只许扑咬一口就落回去，不许挂在车上（改前猎犬一直挂到不打为止）
      let onMin = Infinity, run = 0;
      res.hang = 0; res.onFrames = 0;
      for (const r of S) {
        if (r[3] === 'on' && r[6] != null) { res.onFrames++; onMin = Math.min(onMin, r[6]); }
        if (r[4] && r[5] && !(r[6] >= 0.003)) { run++; res.hang = Math.max(res.hang, run); } else run = 0;
      }
      res.onBal = res.onFrames ? +onMin.toFixed(4) : null;
      delete res.sup;
    }
    BR.entities.remove(e);
    if (restore) restore();
    return res;
  };
  return 0;
}
async function seatedMelee(page, q) {
  await ev(page, a => {
    __br.setAuto(true);
    __br.start({ mode: 'nightmare', difficulty: 'easy', seed: 12345, levelId: '1', settings: { visibility: 1, spawnSlider: 0, quality: a } });
    return 0;
  }, q);
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __inf.step(0.5); return 0; });
  await ev(page, strikeHelpers);
  await ev(page, k6Helpers);
  const seat = await ev(page, () => __stk.seat());
  if (!seat || !seat.seated) { check('k 坐车顶点级（' + q + '）：坐上叉车', false, seat); return; }
  // 一下打死人的怪（窃皮者 lethal）：这一项只看手碰没碰到、车里穿没穿，扣血封顶 40（照样发 player:damage），人不会死、局不会结束
  await ev(page, () => { const P = BR.player; if (!P.__k6dmg) { const od = P.damage; P.__k6dmg = od; P.damage = function (o) { if (o && o.hp > 40) o = Object.assign({}, o, { hp: 40 }); return od.call(this, o); }; } return 0; });
  // 会近战的怪（照排查 pAB 的口径：敌对、有近战 attack、攻击距离 ≤3.5 m），只有 Level 1 有叉车，所以按 Level 1 的实体表挑
  const types = await ev(page, () => { const lv = BR.levels.get('1'), inL1 = new Set(((lv && lv.entities) || []).map(x => x.type)); return BR.entityTypes.all().filter(d => inL1.has(d.type) && d.faction === 'hostile' && d.attack && +d.attack.range <= 3.5 && d.type[0] !== '_').map(d => d.type); });
  // 返修 FE1R · repair-r1（规则员 K6(3)(5)）：8 个方向（车前、左前、左、左后、后、右后、右、右前）
  const dirs = K_DIRS_ARG || ['front', 'frontLeft', 'left', 'backLeft', 'back', 'backRight', 'right', 'frontRight'];
  const rows = [];
  for (const type of (K_TYPES ? types.filter(t => K_TYPES.includes(t)) : types)) for (const dir of dirs) {
    const r = await ev(page, a => __k6.run(a.key, a.type, a.dir, 300), { key: seat.key, type, dir });
    rows.push(r);
    // 返修 FE1R · repair-r2（验收员 tests：牧蛇 / 肢团的链（尾巴、触手）摆动相位以前每次随机，走近那几帧时好时坏）：
    // 有链的怪每个方向再强制两个相位各跑一遍（加上按 id 定的那个，一共 3 个），每一遍都要 ≤1 cm
    if (r.chains) for (const ph of K_PHASES) rows.push(await ev(page, a => __k6.run(a.key, a.type, a.dir, 300, a.ph), { key: seat.key, type, dir, ph }));
  }
  await ev(page, () => { const P = BR.player; if (P.__k6dmg) { P.damage = P.__k6dmg; delete P.__k6dmg; } return 0; });
  const nT = K_TYPES ? types.filter(t => K_TYPES.includes(t)).length : types.length;
  const reachers = rows.filter(r => r.reach), others = rows.filter(r => !r.reach);
  const bad = rows.filter(r => r.error || r.pen > 0.01 || r.feet > 0.005);
  check('k 坐车（' + q + '画质）：' + nT + ' 种近战怪 × ' + dirs.length + ' 个方向（有链的怪每个方向 3 个摆动相位），走近、抬手、抡、收手整个过程，任何顶点压进叉车实心部件 ≤1 cm、脚不进底盘（逐帧顶点级）',
    rows.filter(r => r.phase == null).length === nT * dirs.length && bad.length === 0, bad.length ? bad.slice(0, 6) : rows.map(r => [r.type, r.dir, r.phase, r.pen, r.feet]));
  // 返修 FE1R · repair-r1（验收员 play / tests：叉车不是安全屋）：所有会近战的怪都打得到坐车的人 —— 胳膊、整张脸（笑魇）、整只扑上去、伸一条肢体
  const slow = rows.filter(r => r.error || !r.reach || !(r.hits && r.hits.length) || r.hits[0].f > 300);
  check('k 坐车（' + q + '画质）：所有会近战的怪（' + [...new Set(rows.map(r => r.type))].join('、') + '）从 ' + dirs.length + ' 个方向过来 10 s 内都出手打中（叉车不是安全屋）',
    rows.length > 0 && others.length === 0 && slow.length === 0, slow.length ? slow.map(r => [r.type, r.dir, r.error || (r.reach ? 'reach' : 'noReach'), r.hits && r.hits.length && r.hits[0].f, r.frames, r.end]) : rows.map(r => [r.type, r.dir, r.hits[0].f]));
  // 返修 FE1R · repair-r2（验收员 play：猎犬扑坐车的人时竖直浮到驾驶舱高度、在半空悬停、后腿吊着底下什么都没有）：
  // 地上的扑人怪（leap，挂天花板的 Nguithr'xurh 除外）和伸肢体的（chain）每一帧都有东西托着 —— 脚踩在地上，或者前脚搭在车身部件顶面上；
  // 没有托着的只许是一次起跳的腾空：竖直按重力走（加速度 −g ±25%），第一次扣血前最多一段
  const unsup = rows.filter(r => r.air && r.airBad > 0);
  const supRows = rows.filter(r => r.air);
  check('k 坐车（' + q + '画质）：扑人 / 伸肢体的怪每一帧都有东西托着（脚踩地或前脚搭在车身顶面上），腾空只许是按重力走的一次起跳（竖直加速度 −g ±25%，第一次扣血前最多一段；最长腾空 ' + supRows.reduce((m, r) => Math.max(m, r.airMax || 0), 0).toFixed(2) + ' s）',
    supRows.length > 0 && unsup.length === 0, unsup.length ? unsup.slice(0, 6).map(r => [r.type, r.dir, r.air]) : supRows.filter(r => r.air.length).map(r => [r.type, r.dir, r.air.map(a => a.s + 's/' + a.gErr)]));
  // 返修 FE1R · repair-r3（验收员 play major：猎犬前爪搭在发动机盖上、后半截身子悬在车侧外面，后腿离地 0.4 m 一直吊着）：
  // 趴在车上不下来的（perch 'on'）每一帧重心都在着力点凸包里往里 ≥3 mm（口径同物资裁定 B）；站不稳的只许扑上去前脚落在车身上咬一口、一蹬
  // 那一下搭着（每次连着 ≤9 帧 = 0.3 s），扑咬一口就按重力落回地上，不许挂在车上
  const hangRows = rows.filter(r => r.air && ((r.onBal != null && r.onBal < 0.003) || r.hang > 9));
  check('k 坐车（' + q + '画质）：扑上车的怪站得稳 —— 趴在车上的每一帧顶点重心都在着力点（脚踩地 / 搭在车身顶面 / 贴着车身侧面）凸包里往里 ≥3 mm；站不稳的扑咬一口就落回地上，搭在车身上又站不稳的每次 ≤0.3 s',
    supRows.length > 0 && hangRows.length === 0, (hangRows.length ? hangRows : supRows).map(r => [r.type, r.dir, r.onFrames, r.onBal, r.hang]));
  const touch = reachers.filter(r => (r.hits || []).some(h => !(h.gap != null && h.gap <= 0.02 && h.inD <= 0.01)));
  check('k 坐车（' + q + '画质）：扣血那一帧手（脸 / 嘴 / 肢体梢）离司机身体（坐姿人形三角形）≤2 cm、插进去 ≤1 cm', reachers.length > 0 && touch.length === 0,
    touch.length ? touch.map(r => [r.type, r.dir, r.hits]) : reachers.map(r => [r.type, r.dir, (r.hits || []).map(h => [h.gap, h.inD])]));
}

async function snapshotGuest(page, host) {
  if (!host) { check('快照客机测试有房主数据', false); return; }
  const r = await ev(page, (h) => {
    BR.entities.clear();
    BR.entities.authoritative = false;
    let out;
    try {
      BR.entities.applySnapshot(h.rows);
      const A = BR.entities.get(h.a), B = BR.entities.get(h.b);
      __inf.step(1.5);
      const uA = A && A.obj.userData.dummy;
      out = {
        created: !!A && !!B, remote: !!A && A.remote,
        aStage: A && A.infection ? A.infection.stage : null, bInf: B ? B.infection : 'missing',
        tint: uA ? +uA.tint.toFixed(3) : null, sores: A ? __inf.sores(A) : null,
      };
      // 旧房主（只发 7 列）→ 新客机：当作没感染，不报错
      BR.entities.applySnapshot(h.rows.map(row => row.slice(0, 7)));
      __inf.step(0.5);
      const s2 = __inf.sores(A);
      out.oldHost = { aInf: A.infection, tint: +uA.tint.toFixed(3), soresVisible: !!(s2 && s2.visible), alive: !A.removed };
      // 新房主 → 旧客机：旧版 applySnapshot 只按下标读前 7 列，照它的读法走一遍
      out.oldGuest = h.rows.every(row => {
        const x = +row[2], z = +row[3], hp = +row[6];
        return row.length >= 5 && typeof row[0] === 'string' && typeof row[1] === 'string' && Number.isFinite(x) && Number.isFinite(z) && String(row[5]) && Number.isFinite(hp);
      });
      // 客机回单机：本机拿回权威后，快照建的感染记录（没有 spec）清掉，症状收回，之后能被重新感染并正常计时
      BR.entities.applySnapshot(h.rows);
      __inf.step(0.2);
      const had = { inf: !!A.infection, spec: !!(A.infection && A.infection.spec) };
      BR.entities.authoritative = null;
      __inf.step(0.5);
      out.solo = { had, cleared: A.infection === null, tint: +uA.tint.toFixed(3) };
      out.solo.reinfect = BR.entities.infect(A, __inf.spec(), null);
      __inf.step(1);
      out.solo.after = A.infection && { spec: !!A.infection.spec, elapsed: +A.infection.elapsed.toFixed(2) };
    } finally {
      BR.entities.authoritative = null;
      BR.entities.clear();
    }
    return out;
  }, host);
  check('快照新房主 → 新客机：客机按阶段号画症状（阶段 1：开始变色、有伤口、冒脓疱），没感染的不画', r.created && r.remote && r.aStage === 1 && r.bInf === null && r.tint > 0 &&
    !!r.sores && r.sores.visible && r.sores.slime > 0.9 && r.sores.pus > 0.9, r);
  check('快照旧房主（7 列）→ 新客机：当作没感染，症状收回', r.oldHost.aInf === null && r.oldHost.tint === 0 && !r.oldHost.soresVisible && r.oldHost.alive, r.oldHost);
  check('快照新房主 → 旧客机：前 7 列按旧读法都能解析', r.oldGuest === true, r.oldGuest);
  check('客机回单机：快照留下的感染记录被清掉（不会永远挂着症状），可以重新感染并正常计时', r.solo.had.inf && !r.solo.had.spec && r.solo.cleared && r.solo.tint === 0 &&
    r.solo.reinfect === true && !!r.solo.after && r.solo.after.spec && r.solo.after.elapsed > 0.5, r.solo);
}

main();
