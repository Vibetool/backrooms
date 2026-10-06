// 后室 · 联机营地（隐藏层 coopcamp）单页检查：node tests/camp.mjs
// 方案 2026-10-02 联机营地 N1：营地是 Level 1 里一间 24×24 m、四面封死的仓库间，布局固定（和游戏种子、画质都无关），
// 不在 LEVEL_ORDER、不进入库 golden —— 布局固定性在这里单独查（第 L 节：两个种子 × 高低画质 4 次建块逐字节比）。
// 单页、不联机：用 __br.start({ levelId:'coopcamp' }) 直接开局。测试绝不连真实联机服务器：api.ovobot.ai 一律回假响应。
// 检查（编号和输出一致）：
//   A 层级定义：hidden、lobby、不在 LEVEL_ORDER、没有出口 / 实体 / 物资表、两个出生格、两块 keepClear
//   B 营地不在主页、测试模式、工坊的层级列表里
//   C 封闭：3 个站点 × 120 个方向 × 3 个高度（0.5 / 1.6 / 2.8 m）= 1080 条射线 0 漏；四面墙沿墙线每 0.25 m 往外打，墙后没有缺口
//   D 没有出口；120 s 里实体 0、物资 0
//   E 30 s 里所有灯描述亮度不变、flicker 全 0
//   F 窗外：三块窗外带在、有柱子和灯、没有刷新点；从屋里透过窗看得到窗外的柱子和灯（几何视线 + three 射线不被不透明面挡住）；
//     两个出生格各自抬头看得到 ≥ 2 根不同的柱子、≥ 2 盏不同的亮灯（灯沿 1.2 m 灯管取点，柱子沿柱面取点）
//   G 预算：营地块高画质 ≤ 9600 面 / 低画质 ≤ 7800 面、mesh ≤ 7、灯描述 ≤ 16；窗外带每块 ≤ 4000 面；每块 ≤ 10000 / 8000 面、mesh ≤ 8；
//     draw call ≤ 120，营地出生点一帧 ≤ 60
//   H 门前通道、自动走路径 overlapCircle 全空；BR.coopCamp.enter() 走进帐篷站到地图桌前、选单打开；onBack() 走出来
//   I 截图：出生点全景、贴西墙 / 北墙抬头看窗、帐篷门口小黑板、帐篷里地图桌（看图必须亲眼看）
//   J 出生两格：在房间里、不压碰撞体、地面高度对、相隔 ≥ 1 m、面朝帐篷；spawn() = 第 0 格
//   K 拖动：把椅子拖向门前通道、把睡垫拖向帐篷中间过道，都停在 keepClear 外；world.blockers() 带着两块 keepClear
//   L 布局固定：两个种子 × 高低画质 4 次直接建 (0,0) 和三块窗外带，布局签名逐字节一样，同画质几何签名逐字节一样，flicker 全 0
//   M 低画质：桌面纸（CanvasTexture）在、可见，从站位看过去第一眼就是它
// 截图和日志写 tests/output/camp/。任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
// 营地不进入库 golden；之后改 L1 构件的阶段（A2、D1、B1、F1、D3、C2）要看营地变没变，用快照：
//   node tests/camp.mjs --tag <名>      改动前把布局、几何签名拍到 tests/output/golden-tags/<名>/coopcamp.json
//   node tests/camp.mjs --against <名>  改动后和那份比（L5：布局签名、几何签名逐块对比，变了的块列出来）
// 调试：CAMP_ONLY=F,L 只跑这几节（「进营地」总会跑）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output', 'camp');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|json|log)$/.test(f)) fs.unlinkSync(path.join(OUT, f));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEW = { width: 960, height: 540 };
const CAMP = 'coopcamp';
const SEEDS = [111, 98765];
// 营地预算（方案 N1-camp）：营地块高画质 ≤ 9600 / 低画质 ≤ 7800 面、mesh ≤ 7、灯描述 ≤ 16；窗外带每块 ≤ 4000 面
const CAMP_TRIS = { high: 9600, low: 7800 };
const CAMP_MESHES = 7;
const CAMP_LIGHTS = 16;
const BAND_TRIS = 4000;
const CAMP_CALLS = 60;          // 「特别合理」清单：营地一帧 draw call ≤ 60
const BANDS = ['-1,0', '1,0', '0,-1'];
const ROOM = { x0: 4, z0: 4, x1: 28, z1: 28 };
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const TAG = argOf('tag'), AGAINST = argOf('against');
const tagFile = n => path.join(ROOT, 'tests', 'output', 'golden-tags', n, 'coopcamp.json');

// ---------- 静态服务（同 smoke.mjs） ----------
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
const shots = [];
const T0 = Date.now();
const secs = () => '[' + Math.round((Date.now() - T0) / 1000) + 's] ';
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const d = detail === undefined ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  console.log(secs() + (ok ? 'PASS ' : 'FAIL ') + name + (ok && d.length > 400 ? d.slice(0, 400) + '…' : d));
}
function info(text, detail) {
  console.log(secs() + 'INFO ' + text + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function watch(page, tag) {
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[' + tag + '] console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
}
let shotN = 0;
async function shot(page, name) {
  const f = path.join(OUT, String(++shotN).padStart(2, '0') + '-' + name + '.png');
  try {
    await page.screenshot({ path: f });
    shots.push(f);
    console.log('     shot ' + path.relative(ROOT, f));
  } catch (err) {
    console.log('     shot 失败 ' + name + ' ' + err.message);
  }
}
const EV_TIMEOUT = 90000;
// page.evaluate 没有超时：页面卡死时让这一步记 FAIL 继续往下
function ev(page, fn, arg) {
  let timer = 0;
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('page.evaluate 超过 ' + EV_TIMEOUT / 1000 + ' 秒没返回')), EV_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
}
const ONLY = process.env.CAMP_ONLY ? new Set(process.env.CAMP_ONLY.split(',').map(s => s.trim().toUpperCase())) : null;
async function section(title, fn) {
  if (ONLY && !/^进营地/.test(title) && !ONLY.has(title.charAt(0))) return;
  console.log('\n----- ' + title + ' -----');
  try { await fn(); } catch (err) { check(title + '：流程未中断', false, String(err && err.stack || err).split('\n').slice(0, 4).join(' | ')); }
}
const stepS = (page, s) => ev(page, x => { __br.step(x); }, s);

// =====================================================================
// 页面内工具
// =====================================================================
function installHelpers() {
  const T = window.__tc = { toasts: [] };
  const ot = BR.hud.toast;
  BR.hud.toast = function (t) { T.toasts.push(String(t)); return ot.apply(this, arguments); };
  T.chunk = key => BR.world.chunks().find(c => c.key === key) || null;
  T.campData = () => { const c = T.chunk('0,0'); return c && c.res && c.res.data ? c.res.data.coopcamp || null : null; };
  T.eye = () => (BR.config.player && BR.config.player.eyeHeight) || 1.62;
  // 站到 (x, z)，朝向 yaw（玩家约定：前方 = (-sin yaw, -cos yaw)），俯仰 pitch
  T.stand = (x, z, yaw, pitch) => {
    BR.player.reset({ x, y: 0, z, yaw }, { full: false });
    BR.player.pitch = pitch || 0;
    __br.step(0.05);
    return { x: BR.player.x, z: BR.player.z, y: BR.player.y };
  };
  T.yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  // three 射线：从 o 朝 d 打，返回按距离排好的命中 [{ dist, transparent, chunk, name, isPaper }]
  T.rayHits = (o, d, far) => {
    const R = new THREE.Raycaster(new THREE.Vector3(o.x, o.y, o.z), new THREE.Vector3(d.x, d.y, d.z).normalize(), 0.01, far || 60);
    const objs = [];
    for (const c of BR.world.chunks()) if (c.group) objs.push(c.group);
    if (T.extra) objs.push(...T.extra);
    const hits = R.intersectObjects(objs, true);
    return hits.map(h => {
      const m = Array.isArray(h.object.material) ? h.object.material[h.face ? h.face.materialIndex : 0] : h.object.material;
      let chunk = null;
      for (let p = h.object; p; p = p.parent) { const c = BR.world.chunks().find(q => q.group === p); if (c) { chunk = c.key; break; } }
      return {
        dist: h.distance, chunk, name: h.object.name || '', p: [h.point.x, h.point.y, h.point.z],
        transparent: !!(m && (m.transparent || m.opacity < 1 || m.alphaTest > 0)),
        canvas: !!(m && m.map && m.map.isCanvasTexture),
      };
    });
  };
}

// 页面内：直接建 (0,0) 和三块窗外带，规范化成两个签名（布局 / 几何）
function pageBuildSig(arg) {
  const lv = BR.levels.get(arg.id);
  const G = window.__campCap;
  if (!G || !G.ctx) return { ok: false, error: '没抓到 world 传给 buildChunk 的 ctx' };
  const r3 = v => { if (typeof v !== 'number') return v; if (!Number.isFinite(v)) return v > 0 ? 'Inf' : v < 0 ? '-Inf' : 'NaN'; const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
  // 通用规范化：只收纯数据（跳过函数、three 对象、循环引用），数字收到 1 mm
  const plain = (v, seen, depth) => {
    if (v == null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return r3(v);
    if (typeof v === 'function' || depth > 8) return undefined;
    if (typeof v !== 'object') return undefined;
    if (v.isObject3D || v.isMaterial || v.isBufferGeometry || v.isTexture) return undefined;
    if (v.isColor) return [r3(v.r), r3(v.g), r3(v.b)];
    if (seen.has(v)) return '#cycle';
    seen.add(v);
    let out;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      out = Array.from(v, x => plain(x, seen, depth + 1));
    } else {
      out = {};
      for (const k of Object.keys(v).sort()) {
        if (k === 'mesh' || k === 'piece' || k === 'src' || k === 'obj' || k.charAt(0) === '_') continue;
        const x = plain(v[k], seen, depth + 1);
        if (x !== undefined) out[k] = x;
      }
    }
    seen.delete(v);
    return out;
  };
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16).padStart(8, '0'); };
  const out = { layout: {}, geom: {}, flicker: [], stats: {} };
  for (const key of ['0,0'].concat(arg.bands)) {
    const [cx, cz] = key.split(',').map(Number);
    const res = lv.buildChunk(G.ctx, cx, cz, BR.util.rng(BR.world.levelSeed, cx, cz));
    const K = res.kit || {};
    const regs = list => (Array.isArray(list) ? list : []).map(r => plain(r, new Set(), 0));
    const layout = {
      solids: (res.solids || []).map(s => [r3(s.minX), r3(s.minY), r3(s.minZ), r3(s.maxX), r3(s.maxY), r3(s.maxZ)]),
      spawnPoints: (res.spawnPoints || []).map(p => [r3(p.x), r3(p.y), r3(p.z)]),
      exits: (res.exits || []).map(e => plain(e, new Set(), 0)),
      lights: (res.lights || []).map(l => [r3(l.x), r3(l.y), r3(l.z), r3(l.intensity), r3(l.flicker || 0), r3(l.flickerLater || 0), l.color != null ? l.color : null, r3(l.range || l.distance || 0)]),
      // b.data.tri 是面数账（高画质的倒角、贴花另记 extra / decals / by），按画质本来就不同，不算布局；只留账面面数 nominal
      data: plain(Object.assign({}, res.data || {}, { tri: res.data && res.data.tri ? { nominal: res.data.tri.nominal } : undefined }), new Set(), 0),
      props: regs(K.props), fixtures: regs(K.fixtures), containers: regs(K.containers),
    };
    // 画质会改面数（倒角、贴花），所以几何只在同画质之间比
    const geom = [];
    if (res.group) {
      res.group.updateMatrixWorld(true);
      res.group.traverse(o => {
        if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const pa = o.geometry.attributes.position.array;
        let s = 0, s2 = 0;
        for (let i = 0; i < pa.length; i++) { const v = Math.round(pa[i] * 1000); s = (s + v) | 0; s2 = (s2 + Math.imul(v, (i % 7) + 1)) | 0; }
        const m = Array.isArray(o.material) ? o.material.map(x => x && x.name).join('+') : (o.material && o.material.name) || '';
        geom.push([o.name || '', m, o.geometry.attributes.position.count, o.geometry.index ? o.geometry.index.count : 0, s, s2]);
      });
    }
    for (const l of (res.lights || [])) out.flicker.push(r3(l.flicker || 0), r3(l.flickerLater || 0));
    out.stats[key] = K.stats ? { tris: K.stats.triangles, meshes: K.stats.meshes, lights: K.stats.lights, spawnPoints: K.stats.spawnPoints } : null;
    const ls = JSON.stringify(layout), gs = JSON.stringify(geom);
    out.layout[key] = { hash: hash(ls), len: ls.length };
    out.geom[key] = { hash: hash(gs), len: gs.length };
    if (arg.dump) out['dump_' + key] = ls;
    // 直接建出来的几何不进场景：用完就释放
    if (res.group) res.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  return { ok: true, ...out };
}

async function bootPage(browser, base) {
  const ctx = await browser.newContext({ viewport: VIEW });
  // 测试绝不连真实联机服务器；其余外站请求一律掐掉
  await ctx.route(/^https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
  const page = await ctx.newPage();
  watch(page, 'camp');
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
  await ev(page, () => BR.assets.init());
  await page.waitForTimeout(400);
  await ev(page, installHelpers);
  return { ctx, page };
}

// 开局进营地：先挂钩抓 world 传给 buildChunk 的 ctx（L 节直接建块用）
async function startCamp(page, seed, quality) {
  // 已经在局里：先回主页，等 home.show / hide 的历史退栈落地再开局（同一个任务里回主页又开局，退栈的 popstate 迟到，
  // main 会当成返回键直接进暂停——真玩家不会这么快，是测试自己的问题）
  if (await ev(page, () => BR.game.screen !== 'home')) {
    await ev(page, () => BR.bus.emit('game:home'));
    await page.waitForTimeout(800);
  }
  await ev(page, a => {
    const lv = BR.levels.get(a.id);
    const G = window.__campCap = window.__campCap || {};
    if (G.orig) lv.buildChunk = G.orig;
    G.ctx = null;
    G.orig = lv.buildChunk;
    lv.buildChunk = function (ctx) { if (!G.ctx) G.ctx = ctx; return G.orig.apply(this, arguments); };
    __br.setAuto(false);
    const mode = (BR.config.coop && BR.config.coop.campMode) || 'casual';
    __br.start({ mode, levelId: a.id, seed: a.seed, settings: { quality: a.quality, visibility: 1 } });
    __br.step(0.5);
  }, { id: CAMP, seed, quality });
  const ok = await page.waitForFunction(id => (BR.game.screen === 'playing' || BR.game.screen === 'paused') && BR.game.levelId === id && !BR.world.transitioning, CAMP, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(800);
  const paused = await ev(page, () => { const p = BR.game.screen === 'paused'; if (p) BR.hud.pause(false); return p; });
  if (paused) info('开局后进了暂停（历史退栈迟到），已继续');
  await ev(page, () => {
    const css = document.getElementById('camp-test-css') || document.createElement('style');
    css.id = 'camp-test-css';
    css.textContent = '.hud-title{display:none!important}';   // 层级名大字会挡住截图
    document.head.appendChild(css);
    __br.step(0.5);
  });
  return ok;
}

// =====================================================================
async function run(browser, base) {
  const { page } = await bootPage(browser, base);

  // ------------------------------------------------------------------
  await section('A 层级定义', async () => {
    const d = await ev(page, id => {
      const lv = BR.levels.get(id);
      if (!lv) return null;
      return {
        hidden: lv.hidden, lobby: lv.lobby, inOrder: (BR.LEVEL_ORDER || []).map(String).includes(id),
        exits: lv.exits, entities: lv.entities, items: lv.items, slots: lv.spawnSlots, keep: lv.keepClear,
        spawn: typeof lv.spawn === 'function' ? lv.spawn() : lv.spawn, hasUpdate: typeof lv.update === 'function',
        cfg: BR.config.coop || null,
      };
    }, CAMP);
    check('A1 注册了隐藏层 coopcamp：hidden、lobby，不在 LEVEL_ORDER', !!d && d.hidden === true && d.lobby === true && !d.inOrder, d && { hidden: d.hidden, lobby: d.lobby, inOrder: d.inOrder });
    check('A2 层级表：exits / entities / items 都是空数组，没有 update（不断电、不闪灯）', !!d && Array.isArray(d.exits) && !d.exits.length &&
      Array.isArray(d.entities) && !d.entities.length && Array.isArray(d.items) && !d.items.length && !d.hasUpdate, d && { exits: d.exits, entities: d.entities, items: d.items, hasUpdate: d.hasUpdate });
    // keepClear：门前通道、帐篷中间过道两块矩形 + 两个出生格各一个圆（2026-10-05 返修：椅子不能拖到出生格上）
    const keepRects = d && Array.isArray(d.keep) ? d.keep.filter(k => k.x0 != null) : [];
    const keepCircles = d && Array.isArray(d.keep) ? d.keep.filter(k => k.r > 0) : [];
    check('A3 两个出生格、两块 keepClear 矩形 + 每个出生格一个 keepClear 圆（r ≥ 0.5）；spawn() 就是第 0 格', !!d && Array.isArray(d.slots) && d.slots.length === 2 && keepRects.length === 2 &&
      keepCircles.length === 2 && d.slots.every(s => keepCircles.some(c => Math.hypot(c.x - s.x, c.z - s.z) < 1e-6 && c.r >= 0.5)) &&
      !!d.spawn && Math.abs(d.spawn.x - d.slots[0].x) < 1e-6 && Math.abs(d.spawn.z - d.slots[0].z) < 1e-6, d && { slots: d.slots, keep: d.keep, spawn: d.spawn });
    check('A4 BR.config.coop.campLevel = coopcamp', !!d && !!d.cfg && d.cfg.campLevel === CAMP, d && d.cfg);
  });

  // ------------------------------------------------------------------
  await section('B 营地不在三处层级列表里', async () => {
    const home = await ev(page, id => {
      const ids = o => (BR.home && typeof BR.home.levelOptions === 'function' ? BR.home.levelOptions(o) : []).map(x => String(x.id));
      return { plain: ids(), dev: ids({ dev: true }), has: typeof (BR.home && BR.home.levelOptions) === 'function', id };
    }, CAMP);
    check('B1 BR.home.levelOptions()（含 dev:true）里没有 coopcamp', home.has && home.plain.length > 0 && !home.plain.includes(CAMP) && !home.dev.includes(CAMP), { n: home.plain.length, dev: home.dev.slice(-3) });
    // 主页「游玩」「测试模式」弹窗里的起始层级下拉
    const dlg = [];
    for (const kind of ['casual', 'test']) {
      try {
        await page.click('.home-play', { timeout: 20000 });
        await page.waitForTimeout(150);
        await page.click('.home-menu-btn.is-' + kind, { timeout: 20000 });
        await page.waitForTimeout(250);
        const r = await ev(page, () => {
          const opts = Array.from(document.querySelectorAll('.home-modal select option, .home-dialog select option'));
          return { n: opts.length, vals: opts.map(o => o.value + '|' + o.textContent) };
        });
        dlg.push({ kind, ...r });
      } catch (err) {
        dlg.push({ kind, err: String(err.message || err).slice(0, 120) });
      }
      await ev(page, () => { BR.bus.emit('game:home'); });
      await page.keyboard.press('Escape').catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
    const bad = dlg.filter(x => !x.n || x.vals.some(v => /coopcamp|联机营地/.test(v)));
    check('B2 主页「游玩」「测试模式」弹窗的起始层级下拉里没有营地', bad.length === 0, dlg.map(x => ({ kind: x.kind, n: x.n, err: x.err, bad: (x.vals || []).filter(v => /coopcamp|联机营地/.test(v)) })));
    // 工坊：新建地图选底层
    let ws = null;
    try {
      ws = await ev(page, () => {
        if (!BR.workshopUI || typeof BR.workshopUI.open !== 'function') return { err: '没有 BR.workshopUI' };
        BR.workshopUI.open();
        const btn = Array.from(document.querySelectorAll('.ws-root button')).find(b => /新建地图/.test(b.textContent));
        if (btn) btn.click();
        const radios = Array.from(document.querySelectorAll('input[name="ws-new-level"]'));
        const text = (document.querySelector('.ws-root') || document.body).innerText;
        const r = { n: radios.length, vals: radios.map(x => x.value), camp: /联机营地/.test(text) };
        if (typeof BR.workshopUI.close === 'function') BR.workshopUI.close();
        return r;
      });
    } catch (err) { ws = { err: String(err.message || err).slice(0, 120) }; }
    check('B3 创意工坊「新建地图」的层级里没有营地', !!ws && ws.n > 0 && !ws.vals.includes(CAMP) && !ws.camp, ws && { n: ws.n, err: ws.err, camp: ws.camp });
    await page.keyboard.press('Escape').catch(() => {});
    // 测试模式局内的实体列表（按层级分组）
    const tm = await ev(page, () => {
      __br.setAuto(false);
      __br.start({ mode: 'test', levelId: 'dev', seed: 4242 });
      __br.step(0.3);
      if (!BR.test || typeof BR.test.open !== 'function') return { err: '没有 BR.test' };
      BR.test.open();
      const root = document.querySelector('.test-root');
      const text = root ? root.innerText : '';
      BR.test.close();
      BR.bus.emit('game:home');
      return { len: text.length, camp: /联机营地|coopcamp/.test(text), notHidden: BR.levels.all().filter(l => l && !l.hidden).map(l => String(l.id)).includes('coopcamp') };
    });
    check('B4 测试模式的实体列表里没有营地分组；BR.levels.all() 里过滤 hidden 后没有 coopcamp', !!tm && !tm.err && tm.len > 0 && !tm.camp && !tm.notHidden, tm);
  });

  // ------------------------------------------------------------------
  let started = false;
  await section('进营地（高画质，种子 ' + SEEDS[0] + '）', async () => {
    started = await startCamp(page, SEEDS[0], 'high');
    const st = await ev(page, () => ({ lv: BR.game.levelId, mode: BR.game.mode, screen: BR.game.screen, chunks: BR.world.chunks().map(c => c.key), x: BR.player.x, z: BR.player.z, data: !!__tc.campData() }));
    check('进营地：__br.start({levelId:"coopcamp"}) 开局成功，出生在第 0 格，营地数据 b.data.coopcamp 在', started && st.lv === CAMP && st.data && Math.hypot(st.x - 15, st.z - 21.2) < 0.3, st);
  });
  if (!started) return;

  // ------------------------------------------------------------------
  await section('J 出生两格', async () => {
    const r = await ev(page, id => {
      const lv = BR.levels.get(id);
      const d = __tc.campData();
      const tent = d && d.tent && d.tent.inside ? { x: (d.tent.inside.x0 + d.tent.inside.x1) / 2, z: (d.tent.inside.z0 + d.tent.inside.z1) / 2 } : { x: 16, z: 15 };
      return lv.spawnSlots.map(s => {
        const g = BR.phys.groundY(s.x, s.z);
        const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
        const tx = tent.x - s.x, tz = tent.z - s.z, tl = Math.hypot(tx, tz);
        return {
          x: s.x, z: s.z, yaw: s.yaw, ground: +g.toFixed(3),
          blocked: BR.phys.overlapCircle(s.x, s.z, 0.35, g + 0.05, 1.6),
          inRoom: s.x > 4.5 && s.x < 27.5 && s.z > 4.5 && s.z < 27.5,
          faceDeg: +(Math.acos(Math.max(-1, Math.min(1, (fx * tx + fz * tz) / tl))) * 180 / Math.PI).toFixed(1),
        };
      });
    }, CAMP);
    const gap = Math.hypot(r[0].x - r[1].x, r[0].z - r[1].z);
    check('J1 两个出生格都在房间里、半径 0.35 m 不压碰撞体、地面在 0 附近', r.every(s => s.inRoom && !s.blocked && Math.abs(s.ground) < 0.05), r);
    check('J2 两格相隔 ≥ 1 m，都面朝帐篷（偏差 < 30°）', gap >= 1 && r.every(s => s.faceDeg < 30), { gap: +gap.toFixed(2), face: r.map(s => s.faceDeg) });
  });

  // ------------------------------------------------------------------
  await section('C 封闭射线', async () => {
    const r = await ev(page, room => {
      const origins = [[15, 21.2], [17, 21.2], [16, 19.5]];
      const H = [0.5, 1.6, 2.8];
      const N = 120;
      const leaks = [];
      let n = 0;
      for (const [ox, oz] of origins) {
        for (const h of H) {
          for (let i = 0; i < N; i++) {
            const a = i * 2 * Math.PI / N, dx = Math.cos(a), dz = Math.sin(a);
            const hit = BR.phys.raycast(ox, h, oz, dx, 0, dz, 60);
            n++;
            const px = hit ? ox + dx * hit.dist : NaN, pz = hit ? oz + dz * hit.dist : NaN;
            if (!hit || px < room.x0 - 1 || px > room.x1 + 1 || pz < room.z0 - 1 || pz > room.z1 + 1) leaks.push([ox, h, oz, +a.toFixed(3), hit ? +hit.dist.toFixed(2) : null]);
          }
        }
      }
      // 四面墙：沿墙线每 0.25 m、三个高度，从墙里 1 m 往外打，1.6 m 内必须打到东西（墙后有缺口就打不到）
      const gaps = [];
      let m = 0;
      const sides = [
        { n: 'n', p: t => [t, room.z0 + 1], d: [0, -1] }, { n: 's', p: t => [t, room.z1 - 1], d: [0, 1] },
        { n: 'w', p: t => [room.x0 + 1, t], d: [-1, 0] }, { n: 'e', p: t => [room.x1 - 1, t], d: [1, 0] },
      ];
      for (const s of sides) {
        for (let t = (s.n === 'n' || s.n === 's' ? room.x0 : room.z0) + 0.125; t < (s.n === 'n' || s.n === 's' ? room.x1 : room.z1); t += 0.25) {
          for (const h of H) {
            const [x, z] = s.p(t);
            // 起点本身在柱子、货架里时往里退一点再打
            let sx = x, sz = z, k = 0;
            while (k < 6 && BR.phys.overlapCircle(sx, sz, 0.02, h - 0.01, 0.02)) { sx -= s.d[0] * 0.25; sz -= s.d[1] * 0.25; k++; }
            const back = Math.hypot(sx - x, sz - z);
            const hit = BR.phys.raycast(sx, h, sz, s.d[0], 0, s.d[1], 1.6 + back + 0.6);
            m++;
            if (!hit) gaps.push([s.n, +t.toFixed(2), h]);
          }
        }
      }
      return { n, leaks: leaks.length, leakList: leaks.slice(0, 8), m, gaps: gaps.length, gapList: gaps.slice(0, 8) };
    }, ROOM);
    check('C1 3 个站点 × 120 方向 × 3 高度（0.5 / 1.6 / 2.8 m）= ' + r.n + ' 条射线 0 漏（都打在房间里）', r.n === 1080 && r.leaks === 0, r);
    check('C2 四面墙沿墙线每 0.25 m 往外打（' + r.m + ' 条），墙后没有缺口', r.gaps === 0, { m: r.m, gaps: r.gaps, list: r.gapList });
  });

  // ------------------------------------------------------------------
  await section('D 没有出口、没有实体和物资', async () => {
    const ex = await ev(page, () => ({ exits: BR.world.exits().length, blockersExit: BR.world.blockers().filter(b => b.kind === 'exit').length }));
    check('D1 已载入区块里没有出口（world.exits 0、blockers 里没有出口圈）', ex.exits === 0 && ex.blockersExit === 0, ex);
    let maxE = 0, maxI = 0, sp = 0;
    const tl = [];
    for (let k = 0; k < 12; k++) {
      const r = await ev(page, () => {
        __br.step(10);
        return {
          ents: BR.entities.list.filter(e => !e.removed).length, items: BR.items.list.length,
          spawnPts: BR.world.chunks().reduce((s, c) => s + (c.spawnPoints ? c.spawnPoints.length : 0), 0), lv: BR.game.levelId, t: BR.game.time,
        };
      });
      maxE = Math.max(maxE, r.ents); maxI = Math.max(maxI, r.items); sp = r.spawnPts;
      tl.push([Math.round(r.t), r.ents, r.items]);
    }
    check('D2 120 s 里实体始终 0、物资始终 0', maxE === 0 && maxI === 0, { maxE, maxI, timeline: tl.filter((x, i) => i % 3 === 0) });
    info('已载入区块的刷新点合计 ' + sp + ' 个（营地层没有实体表和物资表，刷新点不会被用到）');
    const hud = await ev(page, () => { const e = document.querySelector('.hud-mode, .hud-info-mode'); return e ? e.textContent : null; });
    info('HUD 模式标签', hud);
  });

  // ------------------------------------------------------------------
  await section('E 灯稳定', async () => {
    const r = await ev(page, () => {
      const all = () => { const out = []; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) out.push(l); return out; };
      const L = all();
      const base = L.map(l => l.intensity);
      let maxD = 0, changed = 0;
      for (let k = 0; k < 30; k++) {
        __br.step(1);
        const now = all();
        if (now.length !== L.length) changed++;
        L.forEach((l, i) => { const d = Math.abs(l.intensity - base[i]); if (d > 1e-9) changed++; maxD = Math.max(maxD, d); });
      }
      const flick = L.filter(l => (l.flicker || 0) !== 0 || (l.flickerLater || 0) !== 0).length;
      const off = L.filter(l => !(l.intensity > 0)).length;
      return { n: L.length, maxD, changed, flick, off };
    });
    check('E1 30 s 里所有灯描述亮度不变（' + r.n + ' 盏）', r.n > 0 && r.changed === 0 && r.maxD === 0, r);
    check('E2 flicker 全 0、没有不亮的灯', r.flick === 0 && r.off === 0, r);
  });

  // ------------------------------------------------------------------
  await section('F 窗外看得到 Level 1', async () => {
    const r = await ev(page, a => {
      const out = { bands: {}, seen: { n: { pillar: 0, light: 0 }, e: { pillar: 0, light: 0 }, w: { pillar: 0, light: 0 } }, samples: [], blocked: [], spawn: [{ pillar: 0, light: 0 }, { pillar: 0, light: 0 }] };
      for (const key of a.bands) {
        const c = __tc.chunk(key);
        if (!c) { out.bands[key] = null; continue; }
        const pillars = (c.solids || []).filter(s => s.maxY - s.minY > 3 && s.maxX - s.minX < 1.4 && s.maxZ - s.minZ < 1.4 && s.maxX - s.minX > 0.25 && s.maxZ - s.minZ > 0.25);
        out.bands[key] = { solids: (c.solids || []).length, pillars: pillars.length, lights: (c.lights || []).filter(l => l.intensity > 0).length, spawnPoints: (c.spawnPoints || []).length, exits: (c.exits || []).length };
      }
      // 窗洞（世界坐标）一律读层级数据 b.data.coopcamp.windows {side, at, w, y0, y1, line}，不写死：
      // 北墙 x=8/24，东西墙 z=8/24.5（南边那扇偏 0.5 m，从出生点看得更清楚）
      const d = __tc.campData();
      const wins = ((d && d.windows) || []).filter(w => w.side === 'n' || w.side === 'e' || w.side === 'w').map(w => ({
        side: w.side, axis: w.side === 'n' ? 'z' : 'x', line: w.line, along: w.side === 'n' ? 'x' : 'z', at: w.at,
        half: (w.w || 1.6) / 2 - 0.1, y0: (w.y0 || 2.3) + 0.05, y1: (w.y1 || 3.3) - 0.05,
      }));
      out.wins = wins.map(w => [w.side, w.at, w.line]);
      const bandOf = { n: '0,-1', e: '1,0', w: '-1,0' };
      const eye = __tc.eye();
      // 看的人：出生两格、房间中间几处、离每面墙 2.5 m 正对每扇窗的地方
      const near = wins.map(w => w.side === 'n' ? [w.at, w.line + 2.5] : w.side === 'e' ? [w.line - 2.5, w.at] : [w.line + 2.5, w.at]);
      const viewers = [[15, 21.2], [17, 21.2], [16, 25], [10, 22], [22, 22], [10, 12], [22, 12]].concat(near)
        .filter(([x, z]) => !BR.phys.overlapCircle(x, z, 0.3, 0.05, 1.6)).map(([x, z]) => ({ x, y: eye, z }));
      const throughWindow = (o, p) => {
        for (const w of wins) {
          const oa = w.axis === 'z' ? o.z : o.x, pa = w.axis === 'z' ? p.z : p.x;
          if ((oa - w.line) * (pa - w.line) >= 0) continue;
          const t = (w.line - oa) / (pa - oa);
          const al = w.along === 'x' ? o.x + (p.x - o.x) * t : o.z + (p.z - o.z) * t;
          const y = o.y + (p.y - o.y) * t;
          if (Math.abs(al - w.at) < w.half && y > w.y0 && y < w.y1) return w;
        }
        return null;
      };
      const visible = (o, p, slack) => {
        const d = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z };
        const L = Math.hypot(d.x, d.y, d.z);
        const hits = __tc.rayHits(o, d, L);
        const block = hits.find(h => !h.transparent && h.dist < L - slack);
        return { ok: !block, block: block ? { dist: +block.dist.toFixed(2), chunk: block.chunk, name: block.name, p: block.p.map(v => +v.toFixed(2)) } : null, L };
      };
      // 出生两格各自看到的「不同的」柱子 / 灯（一根柱子、一盏灯取好几个采样点，看到其中一个就算这一根 / 这一盏）
      const spawnSeen = [{ pillar: new Set(), light: new Set() }, { pillar: new Set(), light: new Set() }];
      for (const side of ['n', 'e', 'w']) {
        const c = __tc.chunk(bandOf[side]);
        if (!c) continue;
        const targets = [];
        // 灯：双管吊灯的灯管 1.2 m 长（北边那块沿 z、东西两块沿 x，同 N1-camp 的实测探针），沿灯管取 5 个点，看到一截就算
        (c.lights || []).forEach((l, li) => {
          if (!(l.intensity > 0)) return;
          for (const k of [0, -0.5, -0.25, 0.25, 0.5]) {
            targets.push({ kind: 'light', id: side + 'L' + li, x: l.x + (side === 'n' ? 0 : k), y: l.y, z: l.z + (side === 'n' ? k : 0), slack: 0.45 });
          }
        });
        (c.solids || []).forEach((s, pi) => {
          if (!(s.maxY - s.minY > 3 && s.maxX - s.minX < 1.4 && s.maxZ - s.minZ < 1.4 && s.maxX - s.minX > 0.25 && s.maxZ - s.minZ > 0.25)) return;
          const cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2;
          // 柱面朝营地那一面：中线和左右各 0.25 m，高度取 2.5 / 3.2 / 4 m（远处的柱子从出生点只能透过高窗看到上半截）
          // 柱子的可见网格比碰撞体胖一圈（倒角、护角、漆层）：第一个不透明命中离目标点 0.3 m 以内就是打在柱子本身上
          for (const y of [2.5, 3.2, 4.0]) for (const k of [0, -0.25, 0.25]) {
            const p = { kind: 'pillar', id: side + 'P' + pi, x: cx, y, z: cz, slack: 0.3 };
            if (side === 'n') { p.z = s.maxZ + 0.02; p.x = cx + k; } else if (side === 'e') { p.x = s.minX - 0.02; p.z = cz + k; } else { p.x = s.maxX + 0.02; p.z = cz + k; }
            targets.push(p);
          }
        });
        for (const t of targets) {
          // 出生两格各自单独数：站在出生点抬头就该看得到窗外（给孩子看的第 ⑤ 张图）
          for (let si = 0; si < 2; si++) {
            if (spawnSeen[si][t.kind].has(t.id)) continue;
            const o = viewers.find(v => v.x === [15, 17][si] && v.z === 21.2);
            if (!o) continue;
            const w = throughWindow(o, t);
            if (w && w.side === side && visible(o, t, t.slack).ok) spawnSeen[si][t.kind].add(t.id);
          }
          for (const o of viewers) {
            const w = throughWindow(o, t);
            if (!w || w.side !== side) continue;
            const v = visible(o, t, t.slack);
            if (!v.ok && t.kind === 'pillar' && out.blocked.length < 8) out.blocked.push({ side, to: [+t.x.toFixed(2), t.y, +t.z.toFixed(2)], from: [o.x, o.z], L: +v.L.toFixed(2), block: v.block });
            if (v.ok) {
              out.seen[side][t.kind]++;
              if (out.samples.length < 12) out.samples.push({ side, kind: t.kind, from: [o.x, o.z], to: [+t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)], win: w.at });
              break;
            }
          }
        }
      }
      out.spawn = spawnSeen.map(q => ({ pillar: q.pillar.size, light: q.light.size, ids: [...q.pillar, ...q.light] }));
      return out;
    }, { bands: BANDS, room: ROOM });
    const bandsOk = BANDS.every(k => r.bands[k] && r.bands[k].pillars > 0 && r.bands[k].lights > 0);
    check('F1 三块窗外带都在，每块有柱子、有亮着的灯', bandsOk, r.bands);
    check('F2 窗外带没有刷新点、没有出口', BANDS.every(k => r.bands[k] && r.bands[k].spawnPoints === 0 && r.bands[k].exits === 0), r.bands);
    check('F2b 窗的位置从层级数据读：北、东、西各 2 扇', r.wins.length === 6 && ['n', 'e', 'w'].every(s => r.wins.filter(w => w[0] === s).length === 2), r.wins);
    const tot = ['n', 'e', 'w'].reduce((s, k) => ({ pillar: s.pillar + r.seen[k].pillar, light: s.light + r.seen[k].light }), { pillar: 0, light: 0 });
    check('F3 从屋里透过窗看得到窗外的柱子和灯（视线穿过窗洞、没被不透明面挡住）', tot.pillar > 0 && tot.light > 0, { tot, seen: r.seen });
    check('F4 北、东、西三面的窗外各看得到 Level 1 的东西（柱子或灯）', ['n', 'e', 'w'].every(k => r.seen[k].pillar + r.seen[k].light > 0), r.seen);
    // 「特别合理」清单：出生点抬头，透过窗看得到 ≥ 2 根柱子、≥ 2 盏亮着的灯（2026-10-05 返修 r2：原来只要求 ≥ 1，按采样点数）
    check('F5 两个出生格各自抬头，透过窗看得到窗外 ≥ 2 根柱子、≥ 2 盏亮着的灯（不同的柱子 / 灯）', r.spawn.every(c => c.pillar >= 2 && c.light >= 2), r.spawn);
    info('看得到的样例', r.samples);
    if (tot.pillar === 0) info('柱子被挡住的样例', r.blocked);
  });

  // ------------------------------------------------------------------
  const budgetCheck = async (q) => {
    const r = await ev(page, () => {
      const out = {};
      for (const c of BR.world.chunks()) {
        const s = c.res && c.res.kit && c.res.kit.stats;
        out[c.key] = s ? { tris: s.triangles, meshes: s.meshes, lights: s.lights } : { tris: 0, meshes: c.group ? c.group.children.length : 0, lights: (c.lights || []).length, nokit: true };
      }
      // draw call：出生点朝四个方向各渲染一帧
      let maxCalls = 0;
      const calls = [];
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        __tc.stand(15, 21.2, yaw, 0.1);
        __br.step(0);
        const c = BR.gfx.renderer.info.render.calls;
        calls.push(c); maxCalls = Math.max(maxCalls, c);
      }
      __tc.stand(15, 21.2, 0, 0);
      return { chunks: out, calls, maxCalls, cap: BR.kit.budget };
    });
    const camp = r.chunks['0,0'];
    const triCap = q === 'high' ? r.cap.trisHigh : r.cap.trisLow;
    check('G-' + q + ' 营地块 ≤ ' + CAMP_TRIS[q] + ' 面、mesh ≤ ' + CAMP_MESHES + '、灯描述 ≤ ' + CAMP_LIGHTS, !!camp && camp.tris <= CAMP_TRIS[q] && camp.meshes <= CAMP_MESHES && camp.lights <= CAMP_LIGHTS, camp);
    check('G-' + q + ' 窗外带每块 ≤ ' + BAND_TRIS + ' 面', BANDS.every(k => r.chunks[k] && r.chunks[k].tris <= BAND_TRIS), BANDS.map(k => [k, r.chunks[k]]));
    const over = Object.entries(r.chunks).filter(([k, s]) => s.tris > triCap || s.meshes > r.cap.meshes);
    check('G-' + q + ' 每块 ≤ ' + triCap + ' 面、mesh ≤ ' + r.cap.meshes + '；draw call ≤ ' + r.cap.drawCalls, over.length === 0 && r.maxCalls <= r.cap.drawCalls, { over, calls: r.calls });
    // 「特别合理」清单：营地一帧 draw call ≤ 60（比全局上限 120 严）
    check('G-' + q + ' 营地出生点四个方向各一帧 draw call ≤ ' + CAMP_CALLS, r.maxCalls <= CAMP_CALLS, { calls: r.calls });
    return r;
  };
  await section('G 预算（高画质）', async () => { await budgetCheck('high'); });

  // ------------------------------------------------------------------
  await section('I 截图（看图必须亲眼看）', async () => {
    await ev(page, () => __tc.stand(15, 21.2, 0, 0.12));
    await stepS(page, 0.1);
    await shot(page, 'spawn-overview');
    await ev(page, () => __tc.stand(16, 22.6, 0, 0.32));
    await shot(page, 'tent-door-board');
    // 贴西墙、北墙、东墙抬头看窗
    await ev(page, () => __tc.stand(5.6, 8, Math.PI / 2, 0.55));
    await shot(page, 'west-wall-look-up');
    await ev(page, () => __tc.stand(8, 5.6, 0, 0.55));
    await shot(page, 'north-wall-look-up');
    await ev(page, () => __tc.stand(26.4, 24, -Math.PI / 2, 0.55));
    await shot(page, 'east-wall-look-up');
    // 从出生点抬头看北墙的窗
    await ev(page, () => __tc.stand(15, 21.2, 0.25, 0.32));
    await shot(page, 'spawn-look-up-window');
    await ev(page, () => __tc.stand(15, 21.2, 0, 0));
  });

  // ------------------------------------------------------------------
  await section('H 门前通道与自动走', async () => {
    const r = await ev(page, () => {
      const d = __tc.campData();
      if (!d) return { err: '没有 b.data.coopcamp' };
      const R = 0.3;
      const free = (x, z) => !BR.phys.overlapCircle(x, z, R, BR.phys.groundY(x, z) + 0.05, 1.6);
      const c = d.corridor;
      const x0 = Math.min(c.x0, c.x1) + R + 0.05, x1 = Math.max(c.x0, c.x1) - R - 0.05;
      const z0 = Math.min(c.z0, c.z1) + R + 0.1, z1 = Math.max(c.z0, c.z1);
      const bad = [];
      let n = 0;
      for (let x = x0; x <= x1 + 1e-6; x += 0.1) for (let z = z0; z <= z1 + 1e-6; z += 0.1) { n++; if (!free(x, z)) bad.push([+x.toFixed(2), +z.toFixed(2)]); }
      // 自动走：出生两格 / 通道里 → 门外 0.6 m → 门洞中线 → 两个站位（和 coopcamp.js 一样每 0.15 m 采样）
      const door = d.tent.door;
      const out = { x: 0, z: 1 };
      const A = { x: door.x + out.x * 0.6, z: door.z + out.z * 0.6 }, B = { x: door.x, z: door.z };
      const pathBad = [];
      let m = 0;
      const seg = (a, b) => {
        const L = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(1, Math.ceil(L / 0.15));
        for (let i = 0; i <= k; i++) { const x = a.x + (b.x - a.x) * i / k, z = a.z + (b.z - a.z) * i / k; m++; if (!free(x, z)) pathBad.push([+x.toFixed(2), +z.toFixed(2)]); }
      };
      const starts = [{ x: 15, z: 21.2 }, { x: 17, z: 21.2 }, { x: 16, z: 19.5 }];
      for (const s of starts) for (const st of d.tent.stand) { seg(s, A); seg(A, B); seg(B, st); }
      return { n, bad: bad.length, badList: bad.slice(0, 6), m, pathBad: pathBad.length, pathList: pathBad.slice(0, 6), door, stand: d.tent.stand, corridor: c };
    });
    check('H1 门前通道（缩进人身半径）每 0.1 m 采样 overlapCircle(0.3) 全空', !r.err && r.n > 0 && r.bad === 0, r);
    check('H2 自动走路径（出生两格 / 通道 → 门外 → 门洞中线 → 两个站位）每 0.15 m 采样全空', !r.err && r.m > 0 && r.pathBad === 0, { m: r.m, pathBad: r.pathBad, list: r.pathList });
    // 真走一遍
    const w = await ev(page, () => {
      __tc.stand(16, 19.5, 0, 0);
      const ok = BR.coopCamp && typeof BR.coopCamp.enter === 'function' ? BR.coopCamp.enter() : null;
      const t0 = BR.coopCamp.debugInfo ? BR.coopCamp.debugInfo().walking : null;
      __br.step(1.3);
      const d = __tc.campData();
      const st = d.tent.stand.map(s => Math.hypot(BR.player.x - s.x, BR.player.z - s.z));
      const menu = document.querySelector('.tent-menu, .tent-root, [class^="tent-"]');
      return { ok, walking0: t0, panel: BR.coopCamp.panelOpen, nearStand: Math.min(...st), input: BR.input.enabled, x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), menu: !!(menu && menu.getBoundingClientRect().height > 0) };
    });
    check('H3 BR.coopCamp.enter()：0.9 s 自己走进帐篷站到地图桌前（离站位 < 0.15 m）、选单打开、输入关掉', w.ok === true && w.panel === true && w.nearStand < 0.15 && w.input === false, w);
    await shot(page, 'tent-menu-open');
    const o = await ev(page, () => {
      const handled = BR.coopCamp.onBack();
      __br.step(1.0);
      const d = __tc.campData();
      return { handled, panel: BR.coopCamp.panelOpen, x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), outside: BR.player.z > d.tent.door.z + 0.8, input: BR.input.enabled, screen: BR.game.screen };
    });
    check('H4 onBack()（Esc / 返回键）关选单、0.7 s 走出帐篷到门外、还回输入，不进暂停', o.handled === true && o.panel === false && o.outside && o.input === true && o.screen === 'playing', o);
    // 站在帐篷里地图桌前截图（选单关着）
    await ev(page, () => {
      const d = __tc.campData();
      const s = d.tent.stand[0], m = d.tent.map;
      __tc.stand(s.x, s.z, __tc.yawTo(m.x - s.x, m.z - s.z), -0.45);
    });
    await shot(page, 'tent-inside-desk');
    await ev(page, () => __tc.stand(15, 21.2, 0, 0));
  });

  // ------------------------------------------------------------------
  await section('K 拖动停在 keepClear 外', async () => {
    const bl = await ev(page, id => ({ keep: BR.world.blockers().filter(b => b.kind === 'keep'), def: BR.levels.get(id).keepClear }), CAMP);
    const rects = bl.keep.filter(b => b.x0 != null);
    const defRects = bl.def.filter(k => k.x0 != null), defCircles = bl.def.filter(k => k.r > 0);
    check('K1 world.blockers() 带着营地的两块 keepClear 矩形（门前通道、帐篷中间过道）', rects.length >= 2 && defRects.length === 2 && defRects.every(k => rects.some(b => Math.abs(b.x0 - Math.min(k.x0, k.x1)) < 1e-3 && Math.abs(b.z1 - Math.max(k.z0, k.z1)) < 1e-3)), bl);
    check('K1b world.blockers() 带着两个出生格的 keepClear 圆', defCircles.length === 2 && defCircles.every(k => bl.keep.some(b => b.r > 0 && Math.abs(b.x - k.x) < 1e-3 && Math.abs(b.z - k.z) < 1e-3 && Math.abs(b.r - k.r) < 1e-6)), bl);
    // kind → 起点、朝向、往哪走：椅子往东推进通道；睡垫往东拖进过道（人站在过道里倒着走）
    const cases = [
      { kind: 'chair', near: [13.5, 18.8], stand: [12.4, 18.8], yaw: -Math.PI / 2, key: 'KeyW', sec: 2.4, rect: 0 },
      { kind: 'chair', near: [13.5, 19.8], stand: [12.4, 19.8], yaw: -Math.PI / 2, key: 'KeyW', sec: 2.4, rect: 0 },
      { kind: 'sleepingBag', near: [14.85, 14.6], stand: [16, 14.6], yaw: Math.PI / 2, key: 'KeyS', sec: 1.6, rect: 1 },
      { kind: 'sleepingBag', near: [17.15, 14.6], stand: [16, 14.6], yaw: -Math.PI / 2, key: 'KeyS', sec: 1.6, rect: 1 },
    ];
    for (const cs of cases) {
      const prep = await ev(page, a => {
        const P = BR.world.propsNear(a.near[0], a.near[1], 0.5).find(p => p.kind === a.kind || (p.rec && p.rec.kind === a.kind));
        if (!P) return { err: '找不到 ' + a.kind + ' @' + a.near };
        __tc.stand(a.stand[0], a.stand[1], a.yaw, -0.5);
        BR.interact.aimAt(P.hx, P.hy, P.hz);
        __br.step(0.05);
        const c = BR.interact.current;
        return { key: P.key, draggable: P.draggable, cur: c ? { key: c.key, dragKey: c.dragKey, canDrag: c.canDrag } : null, box0: { minX: P.box.minX, maxX: P.box.maxX, minZ: P.box.minZ, maxZ: P.box.maxZ } };
      }, cs);
      if (prep.err) { check('K ' + cs.kind + ' 拖动', false, prep); continue; }
      await page.keyboard.down('Space');
      await stepS(page, 0.7);
      const st = await ev(page, () => BR.interact.state);
      await page.keyboard.down(cs.key);
      // 拖的过程中每 0.1 s 记一次：道具外接盒有没有进 keepClear
      let worst = 0;
      for (let t = 0; t < cs.sec; t += 0.2) {
        const w = await ev(page, a => {
          __br.step(0.2);
          const P = BR.world.propByKey(a.key);
          const k = a.r;
          const ox = Math.min(P.box.maxX, k.x1) - Math.max(P.box.minX, k.x0), oz = Math.min(P.box.maxZ, k.z1) - Math.max(P.box.minZ, k.z0);
          return ox > 0 && oz > 0 ? Math.min(ox, oz) : 0;
        }, { key: prep.key, r: rects[cs.rect] || rects[0] });
        worst = Math.max(worst, w);
      }
      await page.keyboard.up(cs.key);
      await page.keyboard.up('Space');
      await stepS(page, 0.3);
      const end = await ev(page, a => {
        const P = BR.world.propByKey(a.key);
        const k = a.r;
        const ox = Math.min(P.box.maxX, k.x1) - Math.max(P.box.minX, k.x0), oz = Math.min(P.box.maxZ, k.z1) - Math.max(P.box.minZ, k.z0);
        return { box: { minX: +P.box.minX.toFixed(3), maxX: +P.box.maxX.toFixed(3), minZ: +P.box.minZ.toFixed(3), maxZ: +P.box.maxZ.toFixed(3) }, overlap: ox > 0 && oz > 0 ? +Math.min(ox, oz).toFixed(3) : 0, state: BR.interact.state, moved: P.moved, toasts: __tc.toasts.slice(-2) };
      }, { key: prep.key, r: rects[cs.rect] || rects[0] });
      const movedBy = Math.max(Math.abs(end.box.minX - prep.box0.minX), Math.abs(end.box.minZ - prep.box0.minZ));
      check('K ' + cs.kind + '（' + cs.near + '）长按拖向' + (cs.rect === 0 ? '门前通道' : '帐篷中间过道') + '：进了拖动，拖的过程和松手后都停在 keepClear 外（容差 1 cm）',
        st === 'drag' && worst <= 0.01 && end.overlap <= 0.01 && end.state !== 'drag',
        { key: prep.key, state: st, cur: prep.cur, worst: +worst.toFixed(3), end, movedBy: +movedBy.toFixed(3) });
      cs.key0 = prep.key;
    }
    // 出生格：刚才推到通道边上的第二把椅子，再从北边往南推向第 0 格 (15, 21.2)：停在出生格的 keepClear 圆外，格子上站得下人
    {
      const k2 = cases[1].key0;
      const circ = bl.keep.find(b => b.r > 0 && Math.hypot(b.x - 15, b.z - 21.2) < 1e-3);
      const c0 = k2 ? await ev(page, k => { const P = BR.world.propByKey(k); return P ? { x: (P.box.minX + P.box.maxX) / 2, z: (P.box.minZ + P.box.maxZ) / 2, hy: (P.box.minY + P.box.maxY) / 2 } : null; }, k2) : null;
      if (!c0 || !circ) check('K 出生格：找到第二把椅子和第 0 格的 keepClear 圆', false, { k2, circ, c0 });
      else {
        // 第一把椅子放回原处（别挡着站人的地方）；第二把挪到出生格正北边（x 和格心对齐）再推，免得从旁边擦过去测不到
        if (cases[0].key0) await ev(page, a => { BR.world.movePropTo(a.k, a.x, a.z); BR.world.commitProp(a.k); }, { k: cases[0].key0, x: 13.5, z: 18.8 });
        await ev(page, a => { BR.world.movePropTo(a.k, a.x, a.z); BR.world.commitProp(a.k); }, { k: k2, x: 15, z: 19.6 });
        const c1 = await ev(page, k => { const P = BR.world.propByKey(k); return { x: (P.box.minX + P.box.maxX) / 2, z: (P.box.minZ + P.box.maxZ) / 2, hy: (P.box.minY + P.box.maxY) / 2 }; }, k2);
        await ev(page, a => { __tc.stand(a.x, a.z - 1.2, Math.PI, -0.5); BR.interact.aimAt(a.x, a.hy, a.z); __br.step(0.05); }, c1);
        const n0 = await ev(page, () => __tc.toasts.length);
        await page.keyboard.down('Space');
        await stepS(page, 0.7);
        const st = await ev(page, () => BR.interact.state);
        await page.keyboard.down('KeyW');
        let worst = 0;
        for (let t = 0; t < 2.0; t += 0.2) {
          const w = await ev(page, a => { __br.step(0.2); const P = BR.world.propByKey(a.k), b = P.box; const qx = Math.min(Math.max(a.c.x, b.minX), b.maxX), qz = Math.min(Math.max(a.c.z, b.minZ), b.maxZ); return Math.max(0, a.c.r - Math.hypot(qx - a.c.x, qz - a.c.z)); }, { k: k2, c: circ });
          worst = Math.max(worst, w);
        }
        await page.keyboard.up('KeyW');
        await page.keyboard.up('Space');
        await stepS(page, 0.3);
        const end = await ev(page, a => {
          const P = BR.world.propByKey(a.k), b = P.box;
          const qx = Math.min(Math.max(a.c.x, b.minX), b.maxX), qz = Math.min(Math.max(a.c.z, b.minZ), b.maxZ);
          return { box: [b.minX, b.minZ, b.maxX, b.maxZ].map(v => +v.toFixed(3)), overlap: +Math.max(0, a.c.r - Math.hypot(qx - a.c.x, qz - a.c.z)).toFixed(3),
            moved: +Math.hypot((b.minX + b.maxX) / 2 - a.s.x, (b.minZ + b.maxZ) / 2 - a.s.z).toFixed(3),
            slot0Busy: !!BR.phys.overlapCircle(15, 21.2, 0.3, 0.05, 1.6), state: BR.interact.state, toasts: __tc.toasts.slice(a.n0) };
        }, { k: k2, c: circ, s: c1, n0 });
        check('K 椅子从北边往南推向出生格 0：进了拖动、推动了，拖的过程和松手后都停在出生格的 keepClear 圆外（容差 1 cm），格子上站得下人',
          st === 'drag' && end.moved > 0.3 && worst <= 0.01 && end.overlap <= 0.01 && !end.slot0Busy && end.state !== 'drag', { state: st, worst: +worst.toFixed(3), end, from: c1 });
        // 圆形禁区以前由 moveBox 静悄悄挡住、什么原因都不说（2026-10-05 返修 r2）：顶着圈推 0.3 s 以上要说「出生的地方得空着」
        check('K2 椅子顶着出生格的圈推不过去：说原因「出生的地方得空着」', end.toasts.includes('出生的地方得空着'), end.toasts);
        await shot(page, 'chair-near-spawn');
        // 房主进营地落在第 0 格；那里万一被东西占着（老的营地布置，levelState 记着的椅子位置），换到另一格（coopcamp hostSpawnFree）
        const sf = await ev(page, a => {
          BR.world.movePropTo(a.k, 15, 21.2); BR.world.commitProp(a.k);
          __tc.stand(15, 21.2, 0, 0);
          const busy0 = !!BR.phys.overlapCircle(15, 21.2, 0.3, 0.05, 1.6);
          BR.bus.emit('level:enter', { id: 'coopcamp' });
          __br.step(0.05);
          const r = { busy0, x: +BR.player.x.toFixed(2), z: +BR.player.z.toFixed(2), here: !!BR.phys.overlapCircle(BR.player.x, BR.player.z, 0.3, 0.05, 1.6) };
          BR.world.movePropTo(a.k, 13.5, 19.8); BR.world.commitProp(a.k);
          __tc.stand(15, 21.2, 0, 0);
          return r;
        }, { k: k2 });
        check('K3 第 0 格被椅子占着时进营地：房主换到第 1 格 (17, 21.2)，不站在椅子里', sf.busy0 && Math.hypot(sf.x - 17, sf.z - 21.2) < 0.05 && !sf.here, sf);
      }
    }
    await shot(page, 'after-drag');
  });

  // ------------------------------------------------------------------
  await section('M 低画质：预算、桌面纸', async () => {
    const ok = await startCamp(page, SEEDS[0], 'low');
    check('M0 低画质重新进营地', ok, await ev(page, () => ({ q: BR.game.settings.quality, lv: BR.game.levelId })));
    await budgetCheck('low');
    const p = await ev(page, () => {
      __br.step(0.3);
      const d = __tc.campData();
      const s = d.tent.stand[0], m = d.tent.map;
      __tc.stand(s.x, s.z, __tc.yawTo(m.x - s.x, m.z - s.z), -0.6);
      // coopcamp.js 的桌面纸是场景里直接挂的网格（CanvasTexture），不在区块组里：找 map 位置附近带 canvas 贴图的网格
      const papers = [];
      BR.gfx.scene.traverse(o => {
        const mt = o.material;
        if (o.isMesh && mt && mt.map && mt.map.isCanvasTexture) {
          const wp = new THREE.Vector3(); o.getWorldPosition(wp);
          if (Math.hypot(wp.x - m.x, wp.z - m.z) < 1.2 && Math.abs(wp.y - m.y) < 0.3) papers.push(o);
        }
      });
      __tc.extra = papers;
      const eye = { x: BR.player.x, y: BR.player.y, z: BR.player.z };
      const hits = __tc.rayHits(eye, { x: m.x - eye.x, y: m.y - eye.y, z: m.z - eye.z }, 5);
      __tc.extra = null;
      const first = hits.find(h => !h.transparent || h.canvas);
      let vis = papers.length > 0;
      for (const o of papers) for (let q = o; q; q = q.parent) if (q.visible === false) vis = false;
      return { dbg: BR.coopCamp.debugInfo ? BR.coopCamp.debugInfo().meshes : null, papers: papers.length, visible: vis, first: first ? { canvas: first.canvas, name: first.name, dist: +first.dist.toFixed(2) } : null, decal: BR.kit && BR.kit.decal ? 'has' : null };
    });
    check('M1 低画质也有桌面纸（CanvasTexture 网格，coopCamp.debugInfo().meshes.paper），而且可见', p.papers > 0 && p.visible && (!p.dbg || p.dbg.paper), p);
    check('M2 从站位看桌面中心，第一眼打到的是桌面纸（没被桌面盖住）', !!p.first && p.first.canvas, p.first);
    await shot(page, 'low-tent-desk-paper');
    await ev(page, () => __tc.stand(15, 21.2, 0, 0.12));
    await shot(page, 'low-spawn-overview');
  });

  // ------------------------------------------------------------------
  await section('L 布局固定（两个种子 × 高低画质）', async () => {
    const runs = [];
    for (const q of ['high', 'low']) {
      for (const seed of SEEDS) {
        const ok = await startCamp(page, seed, q);
        const r = ok ? await ev(page, pageBuildSig, { id: CAMP, bands: BANDS, dump: true }) : { ok: false, error: '开局失败' };
        r.seed = seed; r.q = q;
        r.levelSeed = await ev(page, () => BR.world.levelSeed);
        // 再拿 world 真正建好的那一块和直接建的比：同一条路径
        r.live = await ev(page, () => { const c = __tc.chunk('0,0'); const s = c && c.res && c.res.kit && c.res.kit.stats; return s ? { tris: s.triangles, meshes: s.meshes, lights: s.lights } : null; });
        runs.push(r);
        // 每次的布局原文都留一份：签名对不上时 diff 这几个文件就知道差在哪
        for (const k of Object.keys(r)) if (k.startsWith('dump_')) { fs.writeFileSync(path.join(OUT, 'layout-' + q + '-' + seed + '-' + k.slice(5) + '.json'), r[k]); delete r[k]; }
      }
    }
    fs.writeFileSync(path.join(OUT, 'layout-sig.json'), JSON.stringify(runs, null, 1));
    const okAll = runs.every(r => r.ok);
    check('L0 4 次建块都成功（两个种子的 levelSeed 不同）', okAll && runs[0].levelSeed !== runs[1].levelSeed, runs.map(r => ({ seed: r.seed, q: r.q, ok: r.ok, err: r.error, levelSeed: r.levelSeed })));
    if (!okAll) return;
    const sig = r => JSON.stringify(r.layout);
    check('L1 布局签名（碰撞体、道具登记、灯描述、刷新点、出口、b.data 除面数账）4 次逐字节一样：和种子、画质都无关', runs.every(r => sig(r) === sig(runs[0])), runs.map(r => ({ seed: r.seed, q: r.q, layout: r.layout })));
    const gsig = r => JSON.stringify(r.geom);
    check('L2 同画质下两个种子的几何签名逐字节一样', gsig(runs[0]) === gsig(runs[1]) && gsig(runs[2]) === gsig(runs[3]), runs.map(r => ({ seed: r.seed, q: r.q, geom: r.geom })));
    check('L3 4 次建块所有灯描述 flicker 全 0', runs.every(r => r.flicker.length > 0 && r.flicker.every(v => v === 0)), runs.map(r => ({ seed: r.seed, q: r.q, n: r.flicker.length / 2, nonzero: r.flicker.filter(v => v !== 0).length })));
    check('L4 直接建的块和 world 载入的那一块面数一样（同一条建块路径）', runs.every(r => r.live && r.stats['0,0'] && r.live.tris === r.stats['0,0'].tris && r.live.meshes === r.stats['0,0'].meshes), runs.map(r => ({ seed: r.seed, q: r.q, live: r.live, direct: r.stats['0,0'] })));
    info('各块面数', runs.map(r => ({ seed: r.seed, q: r.q, stats: r.stats })));
    // 快照：两种画质各取第一个种子的签名
    const snap = { schema: 1, at: new Date().toISOString(), high: { layout: runs[0].layout, geom: runs[0].geom, stats: runs[0].stats }, low: { layout: runs[2].layout, geom: runs[2].geom, stats: runs[2].stats } };
    if (TAG) {
      fs.mkdirSync(path.dirname(tagFile(TAG)), { recursive: true });
      fs.writeFileSync(tagFile(TAG), JSON.stringify(snap, null, 1));
      info('营地签名快照写到 ' + path.relative(ROOT, tagFile(TAG)));
    }
    if (AGAINST) {
      let base = null;
      try { base = JSON.parse(fs.readFileSync(tagFile(AGAINST), 'utf8')); } catch (err) { base = null; }
      if (!base) check('L5 和快照 ' + AGAINST + ' 比对：快照文件在', false, path.relative(ROOT, tagFile(AGAINST)));
      else {
        const diff = [];
        for (const q of ['high', 'low']) for (const kind of ['layout', 'geom']) for (const k of Object.keys(snap[q][kind])) {
          const a = base[q] && base[q][kind] && base[q][kind][k], b = snap[q][kind][k];
          if (!a || a.hash !== b.hash) diff.push({ q, kind, chunk: k, was: a && a.hash, now: b.hash, tris: [base[q] && base[q].stats && base[q].stats[k] && base[q].stats[k].tris, snap[q].stats[k] && snap[q].stats[k].tris] });
        }
        check('L5 和快照 ' + AGAINST + ' 比：营地布局、几何逐块不变', diff.length === 0, diff);
      }
    }
  });
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  try {
    await run(browser, base);
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail).slice(0, 600));
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT) + '/');
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
  process.exitCode = failed.length || errors.length ? 1 : 0;
}
main();
