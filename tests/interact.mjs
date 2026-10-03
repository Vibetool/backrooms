// 后室 · 准心交互回归（交互方案 A1）：node tests/interact.mjs [--only desk,touch]
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），拦截 api.ovobot.ai 和一切外部请求。
// 测试模式、__br.setAuto(false) 用 step 精确推进模拟时间（interact.js 这时只看模拟时间判短按 / 长按）。
//
// desk（桌面 1280×720，真键盘空格 / E / WASD）：
//   - 三个候选来源都注册了；准心对准地上的物资才出提示，界面文字只写「空格」、不出现 E
//   - 同一个候选既能短按又能拖：100 ms = 短按（拾取 / 打开），500 ms = 拖动（物资自己、容器拖父道具）
//   - pickSlop 只对物资：没挪就松手算拾取；拖着走了一段不算；拖道具松手永远不算拾取
//   - short.ok=false：短按只出原因（interact:deny + toast），长按照样拖父道具
//   - 拖动限速 v = 1.8/(1+0.6·体积)；拖动中不能冲刺；松手写 levelState；暂停时原地放下
//   - 遮挡：货架（整块碰撞盒，合成场景；A2 加了 Ldev 真货架后换成真的）里的箱子对得准，墙在货架前面时不行；
//     储物柜里的瓶子对得准，长按拖柜子、瓶子跟着走（D27–D30 是临时的：D1 让关着的柜子里的东西对不上之后要改写）
//   - 换层回来：捡过的物资不复活、拖过的木箱还在新位置、Q 丢下的东西还在原处；回主页重开全部复原
//   - 情境：drive 里 R 是升、空格短按下车；seat 里不能冲刺；view 隐藏准心
//   - 压着出口圈的道具（L17 去 Level 18 的床）和出口一样：不出任何提示，长按也拖不动
//   - 返修 r1：拖动不悬空（L7 门廊推不出去、人工坑推不进去）、出口圈拖动中就挡住、木箱把地上的瓶子推开、
//     拖动有声音、甩头掉了提示「手滑了」、售货机给出拖不动的原因、座位候选长按拖的是椅子
// touch（手机横屏 844×390，CDP 触摸）：点「互动」拾取；按住「互动」拖木箱、另一指推摇杆后退；drive 里多出「升」「降」、点「互动」下车
// 截图写 tests/output/interact-*.png。任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only') >= 0 ? String(argv[argv.indexOf('--only') + 1] || '') : '';
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;
const want = name => !ONLY || ONLY.has(name);

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
let pass = 0, fail = 0;
const errors = [];
const shots = [];
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  const d = detail === undefined ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok && d.length > 200 ? '' : d));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const step = (page, s) => ev(page, x => { __br.step(x); }, s);
const NO_E = s => !/(^|[^A-Za-z])E([^A-Za-z]|$)/.test(String(s || ''));
async function shot(page, name) {
  const f = path.join(OUT, 'interact-' + name + '.png');
  await page.screenshot({ path: f });
  shots.push(path.relative(ROOT, f));
}

// 页面里的辅助：瞄准物资 / 道具、读提示文字、记事件和 toast
function installHelpers() {
  const T = window.__ti = {
    ev: [], toasts: [], opened: 0,
    log(name) { BR.bus.on(name, p => T.ev.push([name, p ? JSON.parse(JSON.stringify(p)) : null])); },
    evs(name) { return T.ev.filter(e => e[0] === name).map(e => e[1]); },
    clear() { T.ev.length = 0; T.toasts.length = 0; if (T.sounds) T.sounds.length = 0; },
    prompt() {
      const el = document.querySelector('.hud-prompt');
      if (!el || el.hidden) return '';
      return el.innerText.replace(/\s+/g, ' ').trim();
    },
    cross() { const c = document.querySelector('.hud-cross'); return c ? c.className : ''; },
    // 站到 (x, z)，面朝 (tx, tz)
    stand(x, z, tx, tz) {
      BR.player.reset({ x, y: 0, z, yaw: Math.atan2(-(tx - x), -(tz - z)) }, { full: false });
      __br.step(0.05);
    },
    aimItem(id) {
      const r = BR.items.find(id);
      if (!r) return null;
      const inf = BR.items.info ? BR.items.info(r.type) : null;
      const o = r.obj ? r.obj.position : r;
      const cy = inf && typeof inf.cy === 'number' ? inf.cy : (r.hh || 0.1);
      BR.interact.aimAt(o.x, o.y + cy, o.z);
      return T.cur();
    },
    aimProp(key) {
      const P = BR.world.propByKey(key);
      if (!P) return null;
      BR.interact.aimAt(P.hx, P.hy, P.hz);
      return T.cur();
    },
    cur() {
      const c = BR.interact.current;
      return c ? {
        kind: c.kind, key: c.key, label: c.label, t: +(+c.t).toFixed(3), canDrag: c.canDrag, vol: +(+c.vol).toFixed(3),
        short: c.short ? { verb: c.short.verb, ok: c.short.ok !== false, why: c.short.why || null } : null,
        dragKind: c.dragKind, dragKey: c.dragKey, dragLabel: c.dragLabel, mode: c.mode || null,
      } : null;
    },
    prop(key) {
      const P = BR.world.propByKey(key);
      return P ? { x: +P.x.toFixed(3), z: +P.z.toFixed(3), dx: +P.dx.toFixed(3), dz: +P.dz.toFixed(3),
        box: { minX: +P.box.minX.toFixed(3), maxX: +P.box.maxX.toFixed(3), minZ: +P.box.minZ.toFixed(3), maxZ: +P.box.maxZ.toFixed(3) } } : null;
    },
    spawnFront(type, id, d) {
      const P = BR.player;
      const x = P.x - Math.sin(P.yaw) * d, z = P.z - Math.cos(P.yaw) * d;
      const r = BR.items.spawn(type, x, undefined, z, { id });
      __br.step(0.05);
      return r ? T.aimItem(id) : null;
    },
  };
  for (const n of ['interact:short', 'interact:hold', 'interact:deny', 'interact:pick', 'interact:grab', 'interact:release', 'interact:cancel', 'interact:mode']) T.log(n);
  // 音效：记下名字和 rate（拖动的闷响 / 摩擦是压低音调的 step，rate < 0.8；走路的脚步 rate ≈ 1）
  T.sounds = [];
  if (BR.audio && typeof BR.audio.play === 'function') {
    const pl = BR.audio.play;
    BR.audio.play = function (name, pos, opts) { T.sounds.push([String(name), opts && opts.rate || 1]); return pl.apply(this, arguments); };
  }
  const orig = BR.hud.toast;
  BR.hud.toast = function (text, ms) { T.toasts.push(String(text)); return orig.apply(this, arguments); };
}

async function boot(browser, ctxOpts, tag) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
  // 测试绝不连真实联机服务器：api.ovobot.ai 回假响应，其余外部请求一律掐掉
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await ev(page, () => BR.assets.init());
  await page.waitForTimeout(300);
  await ev(page, installHelpers);
  return { ctx, page };
}
async function startLevel(page, lv, seed) {
  await ev(page, ([lv, seed]) => { __br.setAuto(true); __br.start({ mode: 'test', levelId: lv, seed }); }, [lv, seed || 4242]);
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning, null, { timeout: 30000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); });
}
async function goTo(page, lv) {
  await ev(page, () => __br.setAuto(true));
  await ev(page, lv => BR.world.goTo(lv), lv);
  await page.waitForFunction(lv => BR.game.levelId === lv && !BR.world.transitioning, lv, { timeout: 30000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); });
}
async function tap(page, key, sec) { await page.keyboard.down(key); await step(page, sec); await page.keyboard.up(key); await step(page, 0.05); }

const CRATE = 'dev@-1,0#p2';      // Ldev 陈列块（-1,0）的木箱：(-20, 4)，0.8 m³
const LOCKER = 'dev@-1,0#p6';     // 储物柜：(-9, 4)
const FOOD = 'dev/0,0/food_ration/0';   // 出生房间里 3 m 外地上的罐头口粮

// =====================================================================
async function desk(browser) {
  const { ctx, page } = await boot(browser, { viewport: { width: 1280, height: 720 } }, 'desk');
  const prompts = [];
  const rec = async () => { const p = await ev(page, () => __ti.prompt()); prompts.push(p); return p; };
  try {
    await startLevel(page, 'dev');
    const src = await ev(page, () => BR.interact.debugInfo().sources);
    check('D1 三个候选来源都注册了（items、props、entities）', ['items', 'props', 'entities'].every(s => src.includes(s)), src);

    // ---------- 地上的物资：准心对准才有提示；100 ms 拾取 ----------
    let c = await ev(page, id => { __ti.stand(13.5, 13.5, 13.5, 0); __br.step(0.2); return { cur: __ti.cur(), p: __ti.prompt() }; }, FOOD);
    check('D2 准心没对准（平视远处）时不出拾取提示', !c.cur || c.cur.key !== FOOD, c);
    c = await ev(page, id => { __ti.stand(13.5, 12.2, 13.5, 10.5); const cur = __ti.aimItem(id); __br.step(0.1); return { cur, p: __ti.prompt(), cross: __ti.cross() }; }, FOOD);
    prompts.push(c.p);
    check('D3 准心对准地上的罐头口粮：候选 item、短按拾取、能拖', c.cur && c.cur.kind === 'item' && c.cur.key === FOOD && c.cur.short && c.cur.short.verb === '拾取' && c.cur.canDrag, c.cur);
    check('D4 提示「空格 拾取 …」+「· 长按拖动」，准星是圈', /^空格 ?拾取/.test(c.p) && /长按拖动/.test(c.p) && /hud-cross-on/.test(c.cross), c);
    await shot(page, 'desk-item');
    await ev(page, () => __ti.clear());
    await page.keyboard.down('Space'); await step(page, 0.06);
    const ring60 = await ev(page, () => ({ st: BR.interact.state, prog: BR.interact.holdProgress(), cross: __ti.cross() }));
    await step(page, 0.04); await page.keyboard.up('Space'); await step(page, 0.05);
    const r1 = await ev(page, id => ({ n: BR.player.countOf('food_ration'), gone: !BR.items.find(id), taken: BR.levelState.isTaken('dev', id), picks: __ti.evs('interact:pick').length, grabs: __ti.evs('interact:grab').length }), FOOD);
    check('D5 空格按 100 ms 松开 = 短按拾取（60 ms 时进度环还没出现、没进拖动）', ring60.st === 'pressed' && ring60.prog === 0 && !/hud-cross-hold/.test(ring60.cross) && r1.n === 1 && r1.gone && r1.picks === 1 && r1.grabs === 0, { ring60, r1 });
    check('D6 拾取地上的物资写进 levelState.taken', r1.taken === true, r1);

    // E 只是隐藏别名
    c = await ev(page, () => __ti.spawnFront('almond_water', 't/e', 1.4));
    await page.keyboard.press('KeyE'); await step(page, 0.05);
    check('D7 E 隐藏别名短按也能拾取', await ev(page, () => BR.player.countOf('almond_water') === 1 && !BR.items.find('t/e')), c);

    // 500 ms：进拖动；没挪就松手 = 拾取（pickSlop 只对物资）
    c = await ev(page, () => __ti.spawnFront('almond_water', 't/slop', 1.4));
    await page.keyboard.down('Space'); await step(page, 0.2);
    const ring200 = await ev(page, () => ({ prog: BR.interact.holdProgress(), cross: __ti.cross() }));
    await step(page, 0.3);
    const s500 = await ev(page, () => ({ st: BR.interact.state, p: __ti.prompt(), cross: __ti.cross() }));
    prompts.push(s500.p);
    await shot(page, 'desk-item-drag');
    await page.keyboard.up('Space'); await step(page, 0.05);
    const slop = await ev(page, () => ({ n: BR.player.countOf('almond_water'), gone: !BR.items.find('t/slop') }));
    check('D8 按到 200 ms 时进度环出来（holdProgress>0、准星 hud-cross-hold）', ring200.prog > 0 && ring200.prog < 1 && /hud-cross-hold/.test(ring200.cross), ring200);
    check('D9 按满 500 ms 进拖动，提示「松开 空格 放下」', s500.st === 'drag' && /松开 ?空格 ?放下/.test(s500.p) && /hud-cross-drag/.test(s500.cross), s500);
    check('D10 拖着没挪就松手：按拾取算（pickSlop）', slop.n === 2 && slop.gone, slop);

    // 拖着走一段再松手：不拾取，物资挪了
    c = await ev(page, () => { const r = __ti.spawnFront('almond_water', 't/walk', 1.4); const it = BR.items.find('t/walk'); return { cur: r, x: it.x, z: it.z }; });
    await page.keyboard.down('Space'); await step(page, 0.45);
    await page.keyboard.down('KeyD'); await step(page, 0.6); await page.keyboard.up('KeyD');
    await page.keyboard.up('Space'); await step(page, 0.05);
    const walked = await ev(page, () => { const it = BR.items.find('t/walk'); return { n: BR.player.countOf('almond_water'), at: it && { x: it.x, z: it.z }, st: BR.levelState.getItem('dev', 't/walk') }; });
    check('D11 拖着物资走了一段再松手：没拾取、物资挪了', walked.n === 2 && walked.at && Math.hypot(walked.at.x - c.x, walked.at.z - c.z) > 0.3, { c, walked });

    // ---------- 木箱：只能拖（一按就拖），限速按体积；拖动中不能冲刺；松手写 levelState、不算拾取 ----------
    c = await ev(page, k => { __ti.stand(-20, 6.2, -20, 4); __br.step(0.2); const cur = __ti.aimProp(k); __br.step(0.05); return { cur, p: __ti.prompt(), cross: __ti.cross(), P: __ti.prop(k) }; }, CRATE);
    prompts.push(c.p);
    check('D12 准心对准木箱：候选 prop、没有短按、能拖，提示「按住 空格 拖动 木箱」、准星四角框', c.cur && c.cur.kind === 'prop' && c.cur.key === CRATE && !c.cur.short && c.cur.canDrag && /按住 ?空格 ?拖动 ?木箱/.test(c.p) && /hud-cross-grab/.test(c.cross), c);
    const inv0 = await ev(page, () => BR.player.inventory.map(s => s ? s.type + ':' + s.count : '-').join(','));
    await ev(page, () => __ti.clear());
    await page.keyboard.down('Space'); await step(page, 0.05);
    const g1 = await ev(page, () => ({ st: BR.interact.state, d: BR.interact.debugInfo().drag }));
    check('D13 木箱一按就拖', g1.st === 'drag' && g1.d && g1.d.key === CRATE, g1);
    const b0 = await ev(page, k => __ti.prop(k), CRATE);
    await page.keyboard.down('KeyS'); await step(page, 1.0);
    await shot(page, 'desk-crate-drag');
    await page.keyboard.down('ShiftLeft'); await step(page, 0.2);
    const sp = await ev(page, () => ({ spr: BR.player.sprinting, speed: BR.player.speed(), cap: BR.interact.speedCap(), v: BR.interact.debugInfo().drag.v }));
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyS');
    const b1 = await ev(page, k => __ti.prop(k), CRATE);
    await page.keyboard.up('Space'); await step(page, 0.05);
    const after = await ev(page, k => ({ st: BR.interact.state, P: __ti.prop(k), ls: BR.levelState.getProp('dev', k), inv: BR.player.inventory.map(s => s ? s.type + ':' + s.count : '-').join(','), picks: __ti.evs('interact:pick').length }), CRATE);
    const vExp = Math.max(0.25, 1.8 / (1 + 0.6 * 0.801));
    const moved = Math.hypot(b1.x - b0.x, b1.z - b0.z);
    check('D14 拖动限速按体积：v=1.8/(1+0.6·0.8)≈1.22 m/s，后退 1.2 s 木箱跟着走', Math.abs(sp.v - vExp) < 0.01 && moved > 0.9 * vExp && moved < 1.3 * vExp * 1.2, { v: sp.v, vExp, moved });
    check('D15 拖动中按 Shift 不冲刺，人的速度被限到拖动速度', sp.spr === false && sp.speed <= sp.v + 0.01 && sp.cap < 1, sp);
    check('D16 松手：写进 levelState.props，背包没变、没有 interact:pick（拖道具松手不算拾取）', after.st === 'idle' && after.ls && Math.abs(after.ls.dz - after.P.dz) < 1e-3 && Math.abs(after.ls.dz) > 0.8 && after.inv === inv0 && after.picks === 0, after);

    // ---------- 同一个候选既能短按又能拖：模拟「木箱里的容器」（D1 才有真的），短按打开、长按拖父道具木箱 ----------
    await ev(page, k => {
      const cand = window.__ti.box = { kind: 'container', key: 'test@crate#c1', label: '木箱', t: 0, small: false,
        short: { verb: '打开', ok: true, why: null }, hold: null, canDrag: true, vol: 0, ref: null, parentKeys: [k] };
      BR.interact.addSource('test-box', (ray, reach, out) => {
        const P = BR.world.propByKey(k);
        if (!P || !P.obb) return;
        const t = BR.interact.hit.obb(ray, { x: P.x, y: P.y, z: P.z, rot: P.orot }, P.obb.min, P.obb.max, false);
        if (t < 0) return;
        cand.t = t + 0.001;
        out.push(cand);
      });
      BR.interact.handle('container', { short() { window.__ti.opened++; return true; } });
      const P = BR.world.propByKey(k);
      __ti.stand(P.x, P.z + 1.9, P.x, P.z);
      __br.step(0.1);
      __ti.aimProp(k);
      __br.step(0.05);
      __ti.clear();
    }, CRATE);
    c = await ev(page, () => ({ cur: __ti.cur(), p: __ti.prompt() }));
    prompts.push(c.p);
    check('D17 容器候选压过父道具：「空格 打开 木箱」+「· 长按拖动」，长按拖的是父道具', c.cur && c.cur.kind === 'container' && c.cur.dragKind === 'prop' && c.cur.dragKey === CRATE && /^空格 ?打开 ?木箱/.test(c.p) && /长按拖动/.test(c.p), c);
    let p0 = await ev(page, k => __ti.prop(k), CRATE);
    await tap(page, 'Space', 0.1);
    let r = await ev(page, k => ({ opened: __ti.opened, P: __ti.prop(k), st: BR.interact.state, grabs: __ti.evs('interact:grab').length }), CRATE);
    check('D18 同一个候选：100 ms = 短按（打开一次），木箱没动、没进拖动', r.opened === 1 && r.P.x === p0.x && r.P.z === p0.z && r.st === 'idle' && r.grabs === 0, { p0, r });
    await page.keyboard.down('Space'); await step(page, 0.5);
    r = await ev(page, () => ({ st: BR.interact.state, d: BR.interact.debugInfo().drag }));
    await page.keyboard.down('KeyS'); await step(page, 0.5); await page.keyboard.up('KeyS');
    await page.keyboard.up('Space'); await step(page, 0.05);
    let r2 = await ev(page, k => ({ opened: __ti.opened, P: __ti.prop(k), picks: __ti.evs('interact:pick').length }), CRATE);
    check('D19 同一个候选：500 ms = 拖动父道具木箱（不打开），松手不算拾取', r.st === 'drag' && r.d && r.d.key === CRATE && r2.opened === 1 && Math.hypot(r2.P.x - p0.x, r2.P.z - p0.z) > 0.3 && r2.picks === 0, { r, r2 });
    // short.ok=false：短按只出原因，长按照样拖父道具
    await ev(page, k => { __ti.box.short = { verb: '打开', ok: false, why: '锁着' }; __ti.aimProp(k); __br.step(0.05); __ti.clear(); }, CRATE);
    c = await ev(page, () => ({ cur: __ti.cur(), p: __ti.prompt(), cross: __ti.cross() }));
    prompts.push(c.p);
    p0 = await ev(page, k => __ti.prop(k), CRATE);
    await tap(page, 'Space', 0.1);
    r = await ev(page, k => ({ opened: __ti.opened, deny: __ti.evs('interact:deny'), toasts: __ti.toasts.slice(), P: __ti.prop(k) }), CRATE);
    check('D20 short.ok=false：提示是灰字原因「锁着」+「· 长按拖动」，没有键帽', /^锁着/.test(c.p) && /长按拖动/.test(c.p) && !/空格 ?打开/.test(c.p), c);
    check('D21 short.ok=false：短按只出原因（interact:deny why=锁着、toast），不打开、木箱不动', r.opened === 1 && r.deny.length === 1 && r.deny[0].why === '锁着' && r.toasts.includes('锁着') && r.P.x === p0.x && r.P.z === p0.z, r);
    await page.keyboard.down('Space'); await step(page, 0.5);
    r = await ev(page, () => ({ st: BR.interact.state, d: BR.interact.debugInfo().drag }));
    await page.keyboard.up('Space'); await step(page, 0.05);
    check('D22 short.ok=false：长按照样拖父道具', r.st === 'drag' && r.d && r.d.key === CRATE, r);
    await ev(page, () => { BR.interact.removeSource('test-box'); BR.interact.handle('container', null); });

    // ---------- 暂停：拖动中原地放下 ----------
    await ev(page, k => { __ti.aimProp(k); __ti.clear(); }, CRATE);
    await page.keyboard.down('Space'); await step(page, 0.1);
    const pz = await ev(page, () => { BR.hud.pause(true); __br.step(0.1); return { st: BR.interact.state, cancel: __ti.evs('interact:cancel') }; });
    await page.keyboard.up('Space');
    await ev(page, () => { BR.hud.pause(false); __br.step(0.1); });
    check('D23 拖动中暂停：原地放下（interact:cancel pause）', pz.st === 'idle' && pz.cancel.some(e => e.reason === 'pause'), pz);

    // ---------- 遮挡：货架那一整块碰撞盒里的箱子（父链）对得准；墙挡在货架前面就不行 ----------
    const occ = await ev(page, () => {
      __ti.stand(13.5, 13.5, 13.5, 0);
      const B = { minX: 13.3, minY: 1.0, minZ: 12.0, maxX: 13.7, maxY: 1.4, maxZ: 12.4 };
      // 货架：一整块碰撞盒（A2 的 L1 货架就是这样登记的），箱子在它里面
      BR.phys.addSolids('zz9,9#p1', [{ minX: 12.9, minY: 0, minZ: 11.9, maxX: 14.1, maxY: 2, maxZ: 12.5 }]);
      const box = { kind: 'container', key: 'test@zz9,9#c1', label: '木箱', t: 0, small: false, short: { verb: '打开', ok: true, why: null },
        hold: null, canDrag: false, vol: 0, ref: null, parentKeys: ['test@zz9,9#p1'] };
      BR.interact.addSource('test-shelf', (ray, reach, out) => {
        const t = BR.interact.hit.box(ray, B.minX, B.minY, B.minZ, B.maxX, B.maxY, B.maxZ, false);
        if (t >= 0) { box.t = t; out.push(box); }
      });
      const res = {};
      BR.interact.aimAt(13.5, 1.2, 12.2);
      res.inShelf = __ti.cur();
      res.wall0 = { t: +BR.interact.ray.wallT.toFixed(3), key: BR.interact.ray.wallKey };
      box.parentKeys = [];
      BR.interact.aimAt(13.5, 1.2, 12.2);
      res.noChain = __ti.cur();
      box.parentKeys = ['test@zz9,9#p1'];
      BR.phys.addSolids('zzwall', [{ minX: 12.5, minY: 0, minZ: 12.8, maxX: 14.5, maxY: 3, maxZ: 12.85 }]);
      BR.interact.aimAt(13.5, 1.2, 12.2);
      res.behindWall = __ti.cur();
      BR.phys.removeSolids('zzwall');
      BR.phys.removeSolids('zz9,9#p1');
      BR.interact.removeSource('test-shelf');
      return res;
    });
    check('D24 遮挡：货架整块碰撞盒里的箱子准心对得准（父链里的碰撞盒不挡）', occ.inShelf && occ.inShelf.key === 'test@zz9,9#c1' && occ.wall0.key === 'zz9,9#p1' && occ.inShelf.t > occ.wall0.t, occ);
    check('D25 遮挡对照：同一位置不带父链的箱子被货架碰撞盒挡住', !occ.noChain || occ.noChain.key !== 'test@zz9,9#c1', occ.noChain);
    check('D26 遮挡：墙挡在货架前面时，货架里的箱子对不上', !occ.behindWall || occ.behindWall.key !== 'test@zz9,9#c1', occ.behindWall);

    // ---------- 储物柜里的瓶子（owner = 容器）：准心对得准；短按拾取；长按拖储物柜，瓶子跟着走 ----------
    const lk = await ev(page, k => {
      let ck = null;
      for (const ch of BR.world.chunks()) {
        const cs = ch.res && ch.res.kit && ch.res.kit.containers;
        if (cs) for (const c of cs) if (c.parentKey === k) ck = c.key;
      }
      return ck;
    }, LOCKER);
    const spawnIn = id => ev(page, ([ck, id]) => {
      __ti.stand(-7.75, 4, -9, 4);
      BR.items.spawn('almond_water', -9, 1.2, 4, { id, owner: ck, still: true });
      __br.step(0.05);
      return { cur: __ti.aimItem(id), wall: BR.interact.ray.wallKey, p: __ti.prompt() };
    }, [lk, id]);
    c = await spawnIn('t/inbox1');
    await step(page, 0.05);
    c.p = await rec();
    check('D27 （临时，D1 改写）储物柜里的瓶子准心对得准（射线先打到柜子碰撞盒），长按要拖的是储物柜', !!lk && c.cur && c.cur.key === 't/inbox1' && c.wall === '-1,0#p6' && c.cur.dragKind === 'prop' && c.cur.dragKey === LOCKER && c.cur.canDrag, { lk, c });
    check('D28 （临时，D1 改写）提示「空格 拾取 杏仁水」+「· 长按拖动 储物柜」', /^空格 ?拾取 ?杏仁水/.test(c.p) && /长按拖动 ?储物柜/.test(c.p), c.p);
    await shot(page, 'desk-locker-bottle');
    const nAw = await ev(page, () => BR.player.countOf('almond_water'));
    await tap(page, 'Space', 0.1);
    r = await ev(page, () => ({ n: BR.player.countOf('almond_water'), gone: !BR.items.find('t/inbox1') }));
    check('D29 （临时，D1 改写）柜子里的瓶子短按拾取', r.n === nAw + 1 && r.gone, { nAw, r });
    c = await spawnIn('t/inbox2');
    const l0 = await ev(page, k => ({ P: __ti.prop(k), it: (() => { const i = BR.items.find('t/inbox2'); return { x: i.x, z: i.z }; })() }), LOCKER);
    await page.keyboard.down('Space'); await step(page, 0.45);
    r = await ev(page, () => ({ st: BR.interact.state, d: BR.interact.debugInfo().drag }));
    await page.keyboard.down('KeyS'); await step(page, 0.5); await page.keyboard.up('KeyS');
    await page.keyboard.up('Space'); await step(page, 0.05);
    r2 = await ev(page, k => ({ P: __ti.prop(k), it: (() => { const i = BR.items.find('t/inbox2'); return i && { x: i.x, z: i.z }; })(), n: BR.player.countOf('almond_water') }), LOCKER);
    const ldx = r2.P.x - l0.P.x, idx = r2.it ? r2.it.x - l0.it.x : NaN;
    check('D30 （临时，D1 改写）柜子里的瓶子长按：拖的是储物柜，瓶子跟着走，松手不拾取', r.st === 'drag' && r.d && r.d.key === LOCKER && Math.abs(ldx) > 0.2 && Math.abs(idx - ldx) < 0.01 && r2.n === nAw + 1, { r, l0, r2 });

    // ---------- 情境：drive / seat / view ----------
    await ev(page, () => { __ti.stand(13.5, 13.5, 13.5, 0); __ti.clear(); });
    c = await ev(page, () => {
      BR.interact.setMode('drive', { key: 'test@veh', label: '叉车', onShort() { BR.interact.setMode('walk'); return true; } });
      __br.step(0.05);
      return { ctx: BR.input.context, cur: __ti.cur(), p: __ti.prompt() };
    });
    prompts.push(c.p);
    check('D31 drive：输入情境同步成 drive，提示「空格 下车」', c.ctx === 'drive' && c.cur && c.cur.short && c.cur.short.verb === '下车' && /^空格 ?下车/.test(c.p), c);
    await shot(page, 'desk-drive');
    await page.keyboard.down('KeyR'); await step(page, 0.05);
    const lift = await ev(page, () => ({ up: BR.input.held('liftUp'), down: BR.input.held('liftDown') }));
    await page.keyboard.up('KeyR'); await step(page, 0.05);
    await tap(page, 'Space', 0.1);
    r = await ev(page, () => ({ mode: BR.interact.mode, ctx: BR.input.context }));
    check('D32 drive：R 是「升」；空格短按下车回到 walk', lift.up && !lift.down && r.mode === 'walk' && r.ctx === 'walk', { lift, r });
    await page.keyboard.down('KeyR'); await step(page, 0.05);
    const liftWalk = await ev(page, () => BR.input.held('liftUp'));
    await page.keyboard.up('KeyR'); await step(page, 0.05);
    check('D33 walk 里 R 不起作用', liftWalk === false, liftWalk);
    await ev(page, () => { BR.interact.setMode('seat', { key: 'test@seat', onShort() { BR.interact.setMode('walk'); return true; } }); __br.step(0.05); });
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await step(page, 0.3);
    const seat = await ev(page, () => ({ ctx: BR.input.context, spr: BR.player.sprinting, p: __ti.prompt() }));
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); await step(page, 0.05);
    prompts.push(seat.p);
    await tap(page, 'Space', 0.1);
    r = await ev(page, () => BR.interact.mode);
    check('D34 seat：不能冲刺，提示「空格 起身」，短按起身', seat.ctx === 'seat' && seat.spr === false && /^空格 ?起身/.test(seat.p) && r === 'walk', { seat, r });
    c = await ev(page, () => { BR.interact.setMode('view', 'test@tv'); __br.step(0.05); const x = { hidden: BR.interact.crossHidden, cross: __ti.cross(), ctx: BR.input.context }; BR.interact.setMode('walk'); __br.step(0.05); x.after = __ti.cross(); return x; });
    check('D35 view：准心隐藏（hud-cross-hide），退出后恢复', c.hidden && /hud-cross-hide/.test(c.cross) && c.ctx === 'view' && !/hud-cross-hide/.test(c.after), c);

    // ---------- 换层回来：捡过的不复活、拖过的还在、Q 丢下的还在原处；回主页重开全部复原 ----------
    const crateMoved = await ev(page, k => __ti.prop(k), CRATE);
    await ev(page, () => {
      __ti.stand(13.5, 13.5, 13.5, 10);
      BR.player.addItem('almond_water', 1);
      BR.player.select(BR.player.inventory.findIndex(x => x && x.type === 'almond_water'));
      __br.step(0.05);
    });
    await tap(page, 'KeyQ', 0.05);
    const drop = await ev(page, () => BR.items.list.filter(x => x.dropped).map(x => ({ id: x.id, x: x.x, z: x.z }))[0] || null);
    await goTo(page, '0');
    await goTo(page, 'dev');
    r = await ev(page, ([k, f, d]) => ({ food: !!BR.items.find(f), taken: BR.levelState.isTaken('dev', f), P: __ti.prop(k), wt: !!BR.items.find('t/walk'),
      drop: d && BR.items.find(d.id) ? { x: BR.items.find(d.id).x, z: BR.items.find(d.id).z } : null }), [CRATE, FOOD, drop]);
    check('D36 去 Level 0 再回来：捡过的罐头口粮没有复活', r.food === false && r.taken === true, r);
    check('D37 去 Level 0 再回来：拖过的木箱还在新位置', r.P && Math.abs(r.P.x - crateMoved.x) < 1e-3 && Math.abs(r.P.z - crateMoved.z) < 1e-3 && Math.abs(r.P.dz) > 0.5, { crateMoved, now: r.P });
    check('D49 按 Q 丢在地上的杏仁水：去 Level 0 再回来还在原处（放下的留在原处）', !!drop && r.drop && Math.abs(r.drop.x - drop.x) < 1e-3 && Math.abs(r.drop.z - drop.z) < 1e-3, { drop, now: r.drop });
    if (drop && r.drop) {
      const n0 = await ev(page, id => { const it = BR.items.find(id); __ti.stand(it.x + 1.2, it.z, it.x, it.z); __ti.aimItem(id); return BR.player.countOf('almond_water'); }, drop.id);
      await tap(page, 'Space', 0.1);
      const n1 = await ev(page, () => BR.player.countOf('almond_water'));
      await goTo(page, '0');
      await goTo(page, 'dev');
      const again = await ev(page, id => ({ here: !!BR.items.find(id), rec: BR.levelState.getDrop('dev', id) || null }), drop.id);
      check('D50 丢下的东西捡回来以后，换层回来不会再出现（拿走的不复活、不刷物资）', n1 === n0 + 1 && !again.here && !again.rec, { n0, n1, again });
    }
    await ev(page, () => { __br.setAuto(true); BR.bus.emit('game:home'); });
    await page.waitForFunction(() => BR.home && BR.home.shown, null, { timeout: 15000 });
    await startLevel(page, 'dev');
    r = await ev(page, ([k, f]) => ({ food: !!BR.items.find(f), P: __ti.prop(k), ls: BR.levelState.getProp('dev', k), drops: BR.items.list.filter(x => x.dropped).length }), [CRATE, FOOD]);
    check('D38 回主页重开：罐头口粮复活、木箱回原位、丢下的东西不在了', r.food === true && r.P && Math.abs(r.P.dx) < 1e-6 && Math.abs(r.P.dz) < 1e-6 && r.ls == null && r.drops === 0, r);

    // ---------- 返修 r1：拖动不悬空、出口圈当障碍、推开地上的瓶子、声音、手滑、售货机原因、座位拖椅子 ----------
    // 人工坑：木箱南边 0.8 m 外的高度场是 -1（L22 弹坑、楼板洞那种），往坑那边推
    const hole = await ev(page, k => {
      const P = BR.world.propByKey(k), h = P.box.maxZ + 0.8;
      BR.phys.setGroundFn((x, z) => (z > h && x > -23 && x < -17) ? -1 : NaN);
      __ti.stand(P.x, P.box.minZ - 1.5, P.x, P.z); __ti.aimProp(k); __br.step(0.05); __ti.clear();
      return { h, maxZ0: P.box.maxZ };
    }, CRATE);
    await page.keyboard.down('Space'); await step(page, 0.05);
    await page.keyboard.down('KeyW'); await step(page, 2.5); await page.keyboard.up('KeyW');
    await page.keyboard.up('Space'); await step(page, 0.1);
    r = await ev(page, k => { const P = BR.world.propByKey(k); BR.phys.setGroundFn(null); return { maxZ: P.box.maxZ, y: P.y }; }, CRATE);
    check('D43 木箱推不进坑：占地停在坑沿（外伸 ≤2.5 cm），y 不变', r.maxZ <= hole.h + 0.025 && r.maxZ > hole.maxZ0 + 0.3 && r.y === 0, { hole, r });
    // 出口圈：在木箱南边摆一个（未开放的）出口圈，往那边推——拖动中就挡住，松手不跳
    await ev(page, k => BR.world.applyProp(k, null), CRATE);
    const ex = await ev(page, k => {
      const P = BR.world.propByKey(k), c = BR.world.chunkAt(P.x, P.z);
      const e = { x: P.x, z: P.box.maxZ + 1.8, radius: 0.8, to: '999', kind: 'zone', active: true, sealed: true, sealedText: 'test', label: 'test' };
      c.exits.push(e); window.__tex = { c, e };
      __ti.stand(P.x, P.box.minZ - 1.5, P.x, P.z); __ti.aimProp(k); __br.step(0.05); __ti.clear();
      return { z: e.z, R: e.radius + 0.4 };
    }, CRATE);
    await page.keyboard.down('Space'); await step(page, 0.05);
    await page.keyboard.down('KeyW'); await step(page, 2.0); await page.keyboard.up('KeyW');
    const exA = await ev(page, k => __ti.prop(k), CRATE);
    await page.keyboard.up('Space'); await step(page, 0.1);
    const exB = await ev(page, k => { const t = window.__tex; t.c.exits.splice(t.c.exits.indexOf(t.e), 1); return __ti.prop(k); }, CRATE);
    check('D44 道具拖到出口圈（+0.4 m）边上就停住，松手不跳回去', exA.box.maxZ <= ex.z - ex.R + 0.01 && exA.box.maxZ > ex.z - ex.R - 0.3 && Math.abs(exB.x - exA.x) < 1e-3 && Math.abs(exB.z - exA.z) < 1e-3, { ex, exA: exA.box, exB: exB.box });
    // 物资拖进 Ldev 出生房间的切出墙出口圈
    const nc = await ev(page, () => (BR.world.exits() || []).filter(e => e.kind === 'noclip').map(e => ({ x: e.x, z: e.z, r: e.radius }))[0] || null);
    if (nc) {
      await ev(page, e => { BR.items.spawn('almond_water', e.x + 1.9, undefined, e.z, { id: 't/exit' }); __ti.stand(e.x + 3.4, e.z, e.x, e.z); __ti.aimItem('t/exit'); }, nc);
      await page.keyboard.down('Space'); await step(page, 0.5);
      await page.keyboard.down('KeyW');
      let minD = 99;
      for (let i = 0; i < 30; i++) {
        await step(page, 0.1);
        const q = await ev(page, () => ({ it: BR.items.find('t/exit') && { x: BR.items.find('t/exit').x, z: BR.items.find('t/exit').z }, px: BR.player.x }));
        if (q.it) minD = Math.min(minD, Math.hypot(q.it.x - nc.x, q.it.z - nc.z));
        if (q.px < nc.x + 1.5) break;
      }
      await page.keyboard.up('KeyW');
      await page.keyboard.up('Space'); await step(page, 0.1);
      const lvNow = await ev(page, () => BR.game.levelId);
      check('D45 物资拖到切出墙的出口圈外就停住（离圈心 ≥ 半径 + 0.4 m）', minD >= nc.r + 0.4 - 0.02 && minD < 9 && lvNow === 'dev', { minD, need: nc.r + 0.4 });
    } else check('D45 Ldev 出生房间有切出墙出口', false, nc);
    // 木箱推过地上的瓶子：瓶子被顺着推开，松手写 levelState；拖动有闷响 / 摩擦 / 放下的声音
    await ev(page, k => {
      BR.world.applyProp(k, null);
      const P = BR.world.propByKey(k);
      BR.items.spawn('almond_water', P.x, undefined, P.z + 1.2, { id: 't/under' });
      __ti.stand(P.x, P.box.minZ - 1.5, P.x, P.z); __ti.aimProp(k); __br.step(0.05); __ti.clear();
    }, CRATE);
    const pc0 = await ev(page, k => __ti.prop(k), CRATE);
    await page.keyboard.down('Space'); await step(page, 0.05);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 40; i++) { await step(page, 0.1); const q = await ev(page, k => __ti.prop(k), CRATE); if (q.z > pc0.z + 1.6) break; }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space'); await step(page, 0.1);
    r = await ev(page, k => {
      const P = BR.world.propByKey(k), it = BR.items.find('t/under'), b = P.box;
      const r0 = it ? Math.max(0.04, it.r * 0.8) * 0.75 : 0;
      const qx = it && Math.min(Math.max(it.x, b.minX), b.maxX), qz = it && Math.min(Math.max(it.z, b.minZ), b.maxZ);
      return { box: { minZ: b.minZ, maxZ: b.maxZ }, it: it && { x: it.x, z: it.z, held: it.held }, inside: !!it && Math.hypot(qx - it.x, qz - it.z) < r0,
        ls: BR.levelState.getItem('dev', 't/under') || null, sounds: __ti.sounds.slice() };
    }, CRATE);
    check('D46 木箱推过地上的瓶子：瓶子被推开（不在占地里、没被吞掉），松手写 levelState', r.it && !r.inside && !r.it.held && r.ls && Math.abs(r.ls[2] - r.it.z) < 1e-3 && r.box.minZ > pc0.box.minZ + 1.0, r);
    // 从侧面看：瓶子在木箱前面（被推开了），不在箱子里
    await ev(page, k => { const P = BR.world.propByKey(k); __ti.stand(P.x + 2.2, P.box.maxZ - 0.2, P.x, P.box.maxZ - 0.2); BR.player.pitch = -0.42; __br.step(0.1); }, CRATE);
    await shot(page, 'desk-crate-push-bottle');
    const lows = r.sounds.filter(x => x[0] === 'step' && x[1] < 0.8).length;
    check('D47 拖木箱有声音：抓起闷响、拖着走的摩擦、放下的「咚」（压低音调，至少 3 声）', lows >= 3, r.sounds);
    // 甩头：手和箱子离太远，箱子掉在原地，提示「手滑了」
    await ev(page, k => { const P = BR.world.propByKey(k); __ti.stand(P.x, P.box.minZ - 1.5, P.x, P.z); __ti.aimProp(k); __br.step(0.05); __ti.clear(); }, CRATE);
    await page.keyboard.down('Space'); await step(page, 0.05);
    r = await ev(page, () => { BR.player.yaw += Math.PI; __br.step(0.1); return { st: BR.interact.state, cancel: __ti.evs('interact:cancel'), toasts: __ti.toasts.slice() }; });
    await page.keyboard.up('Space'); await step(page, 0.05);
    check('D48 拖着木箱一下子转身 180°：原地放下，提示「手滑了」', r.st === 'idle' && r.cancel.some(e => e.reason === 'far') && r.toasts.includes('手滑了'), r);
    // 售货机：A1 还不能取货，准心对准给出拖不动的原因；短按一声轻响，长按 toast 原因
    c = await ev(page, () => { __ti.stand(-6, 5.7, -6, 4); BR.interact.aimAt(-6, 1.2, 4); __br.step(0.05); __ti.clear(); return { cur: __ti.cur(), p: __ti.prompt(), cross: __ti.cross() }; });
    prompts.push(c.p);
    await tap(page, 'Space', 0.1);
    await page.keyboard.down('Space'); await step(page, 0.5); await page.keyboard.up('Space'); await step(page, 0.05);
    r = await ev(page, () => ({ deny: __ti.evs('interact:deny').map(d => d.why), toasts: __ti.toasts.slice(), st: BR.interact.state }));
    // Ldev 的售货机立在屋子中间、没画电线插座（kit 没登记 cord），所以原因里不说「插着电」（world.js fixtureWhy，2026-10-02 返修）
    check('D51 对准售货机：灰字「三百多公斤，拖不动」（没画电线就不说插着电），不能拖；短按只一声轻响，长按 toast 原因', c.cur && c.cur.kind === 'fixture' && !c.cur.canDrag &&
      /^三百多公斤，拖不动/.test(c.p) && /hud-cross-dim/.test(c.cross) && r.deny.length === 2 && r.deny[0] === '' && /三百多公斤/.test(r.deny[1]) && !/插着电/.test(r.deny[1]) && r.toasts.some(t => /三百多公斤/.test(t)), { c, r });
    await shot(page, 'desk-vending-why');
    // 座位候选（D2 才有真的）：带 parentKeys:[椅子]，长按拖的是椅子
    c = await ev(page, () => {
      const ch = BR.world.propsNear(-16.5, 5.1, 0.8, []).find(P => P.label === '椅子');
      if (!ch) return null;
      const seat = { kind: 'seat', key: 'test@seat1', label: '椅子', t: 0, small: false, short: { verb: '坐下', ok: true, why: null }, hold: null,
        canDrag: true, vol: 0, ref: null, parentKeys: [ch.key] };
      BR.interact.addSource('test-seat', (ray, reach, out) => {
        const t = BR.interact.hit.obb(ray, { x: ch.x, y: ch.y, z: ch.z, rot: ch.orot }, ch.obb.min, ch.obb.max, false);
        if (t >= 0) { seat.t = t; out.push(seat); }
      });
      __ti.stand(ch.x, ch.z + 1.6, ch.x, ch.z);
      BR.interact.aimAt(ch.hx, ch.hy, ch.hz);
      __br.step(0.05);
      const out = { chair: ch.key, cur: __ti.cur(), p: __ti.prompt() };
      BR.interact.removeSource('test-seat');
      return out;
    });
    if (c) prompts.push(c.p);
    check('D52 座位候选（parentKeys:[椅子]）：「空格 坐下」+「· 长按拖动」，长按拖的是椅子', c && c.cur && c.cur.kind === 'seat' && c.cur.canDrag && c.cur.dragKind === 'prop' && c.cur.dragKey === c.chair && /^空格 ?坐下/.test(c.p) && /长按拖动/.test(c.p), c);

    // L7 门廊：人留在房间里，把杏仁水从门廊缺口推出去——推到地板边上就停住，不会悬在海面上空
    await startLevel(page, '7', 777);
    await ev(page, () => { __ti.stand(19.5, 16.6, 19.5, 18.3); BR.items.spawn('almond_water', 19.5, undefined, 18.3, { id: 't/porch' }); __br.step(0.05); __ti.aimItem('t/porch'); });
    await page.keyboard.down('Space'); await step(page, 0.5);
    await page.keyboard.down('KeyW');
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      await step(page, 0.1);
      const q = await ev(page, () => { const it = BR.items.find('t/porch'); return { pz: BR.player.z, d: it ? Math.abs(it.y - BR.phys.groundY(it.x, it.z)) : 0 }; });
      worst = Math.max(worst, q.d);
      if (q.pz > 17.7) break;
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space'); await step(page, 0.1);
    r = await ev(page, () => { const it = BR.items.find('t/porch'); return it && { z: it.z, y: it.y, g: BR.phys.groundY(it.x, it.z) }; });
    check('D42 L7 门廊：杏仁水推不出门廊（停在房间地板上，拖动中离地从不超过 5 cm）', r && r.g > 4 && Math.abs(r.y - r.g) < 0.05 && worst < 0.05 && r.z < 19, { r, worst });

    // ---------- 压着出口圈的道具（L17 去 Level 18 的床，它自己就是出口）：和出口一样不出提示，长按也拖不动 ----------
    await startLevel(page, '17');
    const bed = '17@1,0#p1';
    c = await ev(page, k => {
      const P = BR.world.propByKey(k);
      if (!P) return null;
      __ti.stand(P.x, P.box.minZ - 1.6, P.x, P.z);   // 床头一侧是墙，从床尾那边看
      __br.step(0.1);
      const cur = __ti.aimProp(k);
      __br.step(0.05);
      __ti.clear();
      return { cur, p: __ti.prompt(), exit: P.exitOverlap, drag: P.draggable, P: __ti.prop(k) };
    }, bed);
    if (c && c.p) prompts.push(c.p);
    check('D39 L17 压着出口圈的床：不出任何候选和提示（出口不能拖）', c && c.exit && !c.drag && !c.cur && c.p === '', c);
    if (c) await shot(page, 'desk-bed-exit');
    await page.keyboard.down('Space'); await step(page, 0.6);
    r = await ev(page, k => ({ st: BR.interact.state, P: __ti.prop(k), deny: __ti.evs('interact:deny').length }), bed);
    await page.keyboard.up('Space'); await step(page, 0.05);
    check('D40 压着出口圈的床：长按也拖不动（不进拖动、不挪）', c && r.st !== 'drag' && r.P && r.P.x === c.P.x && r.P.z === c.P.z, r);

    const bad = prompts.filter(p => !NO_E(p));
    check('D41 一路上的提示文字里没有出现 E', bad.length === 0 && prompts.length >= 6, { n: prompts.length, bad });
  } finally {
    await ctx.close();
  }
}

// =====================================================================
function btnRects() {
  return Array.from(document.querySelectorAll('.touch-root .touch-btn')).map(b => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return { n: b.dataset.touch, hidden: b.hidden || cs.display === 'none', off: b.classList.contains('touch-off'), text: b.textContent.trim(),
      cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
}
async function touch(browser) {
  const { ctx, page } = await boot(browser, { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'touch');
  try {
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id || 1, radiusX: 2, radiusY: 2, force: 1 })) });
    await startLevel(page, 'dev');
    check('T1 识别为触屏', await ev(page, () => BR.input.isTouch === true));
    let b = await ev(page, btnRects);
    const by = n => b.find(x => x.n === n);
    check('T2 walk：「升」「降」隐藏，互动键显示', by('liftUp') && by('liftUp').hidden && by('liftDown').hidden && by('interact') && !by('interact').hidden, b.map(x => x.n + (x.hidden ? ' hidden' : '') + (x.off ? ' off' : '')));

    // 点「互动」拾取
    let c = await ev(page, id => { __ti.stand(13.5, 12.2, 13.5, 10.5); const cur = __ti.aimItem(id); __br.step(0.1); return { cur, p: __ti.prompt() }; }, FOOD);
    check('T3 触屏提示「点「互动」拾取 …」，不出现「空格」和 E', /^点「互动」 ?拾取/.test(c.p) && !/空格/.test(c.p) && NO_E(c.p), c);
    await shot(page, 'touch-item');
    let ib = by('interact');
    await T('touchStart', [{ x: ib.cx, y: ib.cy }]); await step(page, 0.1);
    await T('touchEnd', []); await step(page, 0.05);
    let r = await ev(page, id => ({ n: BR.player.countOf('food_ration'), gone: !BR.items.find(id) }), FOOD);
    check('T4 点「互动」= 短按拾取', r.n === 1 && r.gone, r);

    // 按住「互动」拖木箱，另一只手指推左半屏摇杆往后退
    c = await ev(page, k => { __ti.stand(-20, 6.2, -20, 4); __br.step(0.1); const cur = __ti.aimProp(k); __br.step(0.05); return { cur, p: __ti.prompt(), P: __ti.prop(k) }; }, CRATE);
    check('T5 触屏对准木箱：「按住「互动」拖动 木箱」', /^按住「互动」 ?拖动 ?木箱/.test(c.p), c.p);
    await T('touchStart', [{ id: 1, x: ib.cx, y: ib.cy }]); await step(page, 0.05);
    const st1 = await ev(page, () => BR.interact.state);
    await T('touchStart', [{ id: 1, x: ib.cx, y: ib.cy }, { id: 2, x: 170, y: 190 }]); await step(page, 0.05);
    await T('touchMove', [{ id: 1, x: ib.cx, y: ib.cy }, { id: 2, x: 170, y: 260 }]); await step(page, 1.0);
    const mid = await ev(page, k => ({ st: BR.interact.state, P: __ti.prop(k), p: __ti.prompt() }), CRATE);
    await shot(page, 'touch-crate-drag');
    await T('touchEnd', [{ id: 1, x: ib.cx, y: ib.cy }]); await step(page, 0.05);
    await T('touchEnd', []); await step(page, 0.05);
    r = await ev(page, k => ({ st: BR.interact.state, P: __ti.prop(k), ls: BR.levelState.getProp('dev', k) }), CRATE);
    check('T6 按住「互动」一按就拖，另一指推摇杆后退时木箱跟着走，提示「松开「互动」放下」', st1 === 'drag' && mid.st === 'drag' && Math.hypot(mid.P.x - c.P.x, mid.P.z - c.P.z) > 0.4 && /^松开「互动」 ?放下/.test(mid.p), { st1, mid, c: c.P });
    check('T7 松开「互动」放下，写进 levelState', r.st === 'idle' && r.ls && Math.abs(r.ls.dz - r.P.dz) < 1e-3, r);

    // drive：多出「升」「降」，冲刺和丢弃灰掉；点「互动」下车
    c = await ev(page, () => {
      __ti.stand(13.5, 13.5, 13.5, 0);
      BR.interact.setMode('drive', { key: 'test@veh', label: '叉车', onShort() { BR.interact.setMode('walk'); return true; } });
      __br.step(0.1);
      return { p: __ti.prompt(), ctx: BR.input.context };
    });
    b = await ev(page, btnRects);
    check('T8 drive：「升」「降」出现，冲刺、丢弃灰掉，提示「点「互动」下车」', c.ctx === 'drive' && !by('liftUp').hidden && !by('liftDown').hidden && by('sprint').off && by('drop').off && /^点「互动」 ?下车/.test(c.p), { c, b: b.map(x => x.n + ':' + x.text + (x.hidden ? ' hidden' : '') + (x.off ? ' off' : '')) });
    await shot(page, 'touch-drive');
    const up = by('liftUp');
    await T('touchStart', [{ x: up.cx, y: up.cy }]); await step(page, 0.05);
    const held = await ev(page, () => BR.input.held('liftUp'));
    await T('touchEnd', []); await step(page, 0.05);
    ib = by('interact');
    await T('touchStart', [{ x: ib.cx, y: ib.cy }]); await step(page, 0.1);
    await T('touchEnd', []); await step(page, 0.05);
    r = await ev(page, () => ({ mode: BR.interact.mode, ctx: BR.input.context }));
    b = await ev(page, btnRects);
    check('T9 按住「升」= liftUp；点「互动」下车，「升」「降」又藏起来', held === true && r.mode === 'walk' && r.ctx === 'walk' && by('liftUp').hidden && by('liftDown').hidden, { held, r });
  } finally {
    await ctx.close();
  }
}

// =====================================================================
const srv = await startServer();
const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const [name, fn] of [['desk', desk], ['touch', touch]]) {
    if (!want(name)) continue;
    try { await fn(browser); }
    catch (err) { check(name + ' 流程没有中断', false, String(err && err.stack || err).slice(0, 1500)); }
  }
} finally {
  await browser.close();
  srv.close();
}
for (const e of errors) console.log('ERR ' + e);
console.log('\n===== 汇总 =====');
console.log('检查 ' + (pass + fail) + ' 项，失败 ' + fail + ' 项');
console.log('页面报错 ' + errors.length + ' 条');
if (shots.length) console.log('截图 ' + shots.length + ' 张：' + shots.join('、'));
process.exit(fail || errors.length ? 1 : 0);
