// 后室 · 悲尸感染与转化测试：node tests/infection.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），__br.setAuto(false) 后用 __br.step 精确推进。
// 覆盖：测试人被划伤感染 → 45 s 原地变悲尸；感染中被打死 → 约 4 s 尸体爬起；两种形态都感染、非人类不感染；
// 悲尸放过已感染的测试人（自然流程能走完三阶段）；噩梦玩家三阶段的治愈规则、提示时长与死亡结算；Level 8 旧感染持续伤害不再叠加；
// 游玩/测试模式玩家不受伤不感染；症状只改实例材质；快照新旧格式互通；客机回单机后感染记录不卡死。
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
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = failed.length || errors.length ? 1 : 0;
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
// 快照：客机侧（新房主 → 新客机、旧房主 → 新客机、新房主 → 旧客机）；客机回单机
// =====================================================================
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
