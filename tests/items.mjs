// 后室 · 物品测试：node tests/items.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader）。页面加载后注入 js/items/_kit.js、_effects.js 和 index.html 里还没有的物品文件，
// 然后依次：注册/模型/图标/生成表检查 → 噩梦生存 dev 层逐个物品 生成→拾取→使用（数值、时效、背包数量）
// → 游玩模式同样使用、数值不变 → 所有物品排成一排截图 + 图标总览。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。截图写 tests/output/items-*.png
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

const LORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lore-choices.json'), 'utf8')).items;
const SPAWN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/item-spawn.json'), 'utf8'));
const KEYS = Object.keys(LORE);
// 同一个设定物品拆出来的变种：父 key → 变种 type
const VARIANTS = {
  almond_water: ['almond_water_blue', 'almond_water_green', 'almond_water_red', 'almond_water_expired'],
  lightning_in_a_bottle: ['lightning_in_a_bottle_artificial', 'lightning_in_a_bottle_black'],
};
const PARENT = {};
for (const [p, list] of Object.entries(VARIANTS)) for (const v of list) PARENT[v] = p;
const ALL_TYPES = KEYS.concat(...Object.values(VARIANTS));
const SEED = 20260913;

// ---------- 注入顺序：kit / effects 先，其余物品文件按名字排序；index.html 里已有的跳过 ----------
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inIndex = new Set([...indexHtml.matchAll(/src="(js\/items\/[^"]+)"/g)].map(m => m[1]));
const FIRST = ['js/items/_kit.js', 'js/items/_effects.js'];
const itemFiles = fs.readdirSync(path.join(ROOT, 'js/items')).filter(f => f.endsWith('.js')).map(f => 'js/items/' + f);
const INJECT = FIRST.filter(f => !inIndex.has(f)).concat(itemFiles.filter(f => !FIRST.includes(f) && !inIndex.has(f)).sort());

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
const shots = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const d = detail === undefined ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok && d.length > 160 ? '' : d));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function step(page, seconds) {
  let left = seconds;
  while (left > 1e-6) {
    const s = Math.min(20, left);
    await ev(page, x => __it.fastStep(x), s);
    left -= s;
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const statsNear = (a, b, tol) => near(a.hp, b.hp, tol) && near(a.hunger, b.hunger, tol) && near(a.sanity, b.sanity, tol);
const round = s => ({ hp: +s.hp.toFixed(3), hunger: +s.hunger.toFixed(3), sanity: +s.sanity.toFixed(3) });

// 与 _kit.js apply 同一顺序：hungerSet → hunger → hp → sanity → sanityFill
function expectInstant(b, s) {
  let { hp, hunger, sanity } = b;
  if (s.hungerSet != null) hunger = Math.max(hunger, s.hungerSet);
  if (s.hunger) hunger = clamp(hunger + s.hunger, 0, 100);
  if (s.hp) hp = clamp(hp + s.hp, 0, 100);
  if (s.sanity) sanity = clamp(sanity + s.sanity, 0, 100);
  if (s.sanityFill) sanity = clamp(sanity + (100 - sanity) * s.sanityFill, 0, 100);
  return { hp, hunger, sanity };
}
// 时效数值：每个效果只作用自己的时长；本测试里每项数值只有一个方向，结尾夹一次就等于逐帧夹
function expectTimed(a, timed, secs) {
  let { hp, hunger, sanity } = a;
  for (const t of timed || []) {
    const d = Math.min(secs, t.seconds);
    if (t.hpPerSec) hp += t.hpPerSec * d;
    if (t.sanityPerSec) sanity += t.sanityPerSec * d;
    if (t.hungerPerSec) hunger += t.hungerPerSec * d;
  }
  return { hp: clamp(hp, 0, 100), hunger: clamp(hunger, 0, 100), sanity: clamp(sanity, 0, 100) };
}

// ---------- 页面 ----------
async function openPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  for (const f of INJECT) await page.addScriptTag({ url: base + f });
  return { ctx, page };
}

// 页面里的测试小工具
function installHelpers(page) {
  return ev(page, () => {
    window.__deaths = window.__deaths || [];
    if (!window.__deathHooked) { window.__deathHooked = true; BR.bus.on('player:death', p => window.__deaths.push(p)); }
    window.__it = {
      n: 0,
      // 长时间推进：只测物品效果，世界流式加载、实体、HUD、测试面板、联机这些每帧开销大的模块先停掉
      // （玩家 update → BR.effects.update 这条链路照常走）
      fastStep(x) {
        const saved = [];
        for (const m of ['world', 'entities', 'hud', 'test', 'coop']) {
          if (BR[m] && typeof BR[m].update === 'function') { saved.push([m, BR[m].update]); BR[m].update = () => {}; }
        }
        try { __br.step(x); } finally { for (const s of saved) BR[s[0]].update = s[1]; }
        return 0;
      },
      // 找一块开阔地：16 个方向里前方最空的那个
      findHome() {
        const P = BR.player;
        let best = { yaw: P.yaw, d: -1 };
        for (let i = 0; i < 16; i++) {
          const yaw = -Math.PI + i * Math.PI / 8;
          const h = BR.phys.raycast(P.x, P.y - 0.6, P.z, -Math.sin(yaw), 0, -Math.cos(yaw), 30);
          const d = h ? h.dist : 30;
          if (d > best.d) best = { yaw, d };
        }
        window.__home = { x: P.x, z: P.z, yaw: best.yaw, free: best.d };
        return window.__home;
      },
      reset(s) {
        const p = BR.player;
        if (p.dead) BR.bus.emit('death:continue');
        BR.effects.clear();
        BR.items.clear();
        BR.entities.clear();
        for (let i = 0; i < p.inventory.length; i++) p.inventory[i] = null;
        p.selected = 0;
        const h = window.__home;
        p.reset({ x: h.x, y: 0, z: h.z, yaw: h.yaw }, { full: false });
        p.hp = s.hp; p.hunger = s.hunger; p.sanity = s.sanity;
        BR.itemKit.rand = () => 0.5;
        return true;
      },
      seq(arr) { let i = 0; BR.itemKit.rand = () => arr[Math.min(i++, arr.length - 1)]; },
      pickup(type) {
        const p = BR.player;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const it = BR.items.spawn(type, p.x + fx * 0.3, undefined, p.z + fz * 0.3, { id: 'test/' + type + '/' + (++this.n) });
        const picked = p.interact();
        return { spawned: !!it, picked, count: p.countOf(type), itemsLeft: BR.items.list.length };
      },
      use(type) {
        const p = BR.player;
        const idx = p.inventory.findIndex(s => s && s.type === type);
        if (idx >= 0) p.selected = idx;
        const def = BR.itemTypes.get(type);
        const before = { hp: p.hp, hunger: p.hunger, sanity: p.sanity };
        const consumed = p.useSelected();
        const slot = p.inventory[idx];
        return {
          before, after: { hp: p.hp, hunger: p.hunger, sanity: p.sanity }, consumed, count: p.countOf(type),
          slotLeft: slot ? slot.left : null, dead: p.dead, x: p.x, z: p.z,
          fx: BR.effects.list.map(e => ({ key: e.key, left: e.left, total: e.total, stage: e.stage, speedMul: e.speedMul, negative: e.negative })),
          speedMul: BR.effects.speedMul(), effect: JSON.parse(JSON.stringify(def.effect || {})),
        };
      },
      state() {
        const p = BR.player;
        return {
          hp: p.hp, hunger: p.hunger, sanity: p.sanity, dead: p.dead, x: p.x, z: p.z,
          fxKeys: BR.effects.list.map(e => e.key), speedMul: BR.effects.speedMul(),
          fx: BR.effects.list.map(e => ({ key: e.key, left: e.left, stage: e.stage, speedMul: e.speedMul, negative: e.negative })),
          camY: BR.gfx.camera.scale.y, fogFar: BR.gfx.scene.fog ? BR.gfx.scene.fog.far : null,
        };
      },
      forceEnd(keys) { for (const k of keys) { const e = BR.effects.get(k); if (e) e.left = 0.05; } },
      spawnTarget(dist) {
        const p = BR.player;
        const pt = BR.itemKit.throwPoint(p, dist);
        const e = BR.entities.spawn('_dev_hostile', pt.x, pt.y, pt.z, {});
        return { id: e && e.id, hp: e && e.hp, pt };
      },
      entity(id) { const e = BR.entities.get(id); return e ? { hp: e.hp, dead: !!e.dead, removed: !!e.removed } : { gone: true }; },
    };
    return true;
  });
}

// =====================================================================
// 1. 注册、模型、图标、生成表
// =====================================================================
async function staticChecks(page) {
  const info = await ev(page, (all) => {
    const K = BR.itemKit;
    const out = {};
    for (const t of all) {
      const d = BR.itemTypes.get(t);
      if (!d) { out[t] = { missing: true }; continue; }
      let tris = -1, err = null, sameMat = false, meshes = 0;
      try {
        const ctx = { THREE, BR, assets: BR.assets, game: BR.game };
        const a = d.build(ctx), b = d.build(ctx);
        tris = K.tris(a);
        const ma = [], mb = [];
        a.traverse(o => { if (o.isMesh) { ma.push(o.material); meshes++; } });
        b.traverse(o => { if (o.isMesh) mb.push(o.material); });
        sameMat = ma.length === mb.length && ma.every((m, i) => m === mb[i]);
      } catch (e) { err = String(e && e.stack || e); }
      const icon = d.icon;
      out[t] = {
        version: d.version, zh: d.zh, en: d.en, category: d.category, stack: d.stack, hasUse: typeof d.use === 'function',
        iconOk: typeof icon === 'string' && icon.indexOf('data:image/png') === 0, icon, tris, meshes, sameMat, err,
      };
    }
    return out;
  }, ALL_TYPES);

  const missing = ALL_TYPES.filter(t => info[t].missing);
  check('25 个设定物品 + 变种全部注册', missing.length === 0 && KEYS.length === 25, { total: ALL_TYPES.length, missing });
  const badVer = ALL_TYPES.filter(t => !info[t].missing && info[t].version !== LORE[PARENT[t] || t].source)
    .map(t => ({ t, got: info[t].version, want: LORE[PARENT[t] || t].source }));
  check('每个物品的 version 与 lore-choices 选中的 source 一致', badVer.length === 0, badVer);
  const badBuild = ALL_TYPES.filter(t => info[t].err || !(info[t].tris > 0 && info[t].tris < 400)).map(t => ({ t, tris: info[t].tris, err: info[t].err }));
  check('模型都能 build，三角面 < 400', badBuild.length === 0, badBuild.length ? badBuild : ALL_TYPES.map(t => t + ':' + info[t].tris).join(' '));
  const badMat = ALL_TYPES.filter(t => !info[t].sameMat);
  check('两次 build 的材质是同一对象（走 BR.assets.material 缓存）', badMat.length === 0, badMat);
  const badIcon = ALL_TYPES.filter(t => !info[t].iconOk);
  check('图标都是 64px canvas 画的 data URL', badIcon.length === 0, badIcon);
  const iconSet = new Set(ALL_TYPES.map(t => info[t].icon));
  check('图标彼此不同', iconSet.size === ALL_TYPES.length, { unique: iconSet.size, total: ALL_TYPES.length });
  const badSpawn = ALL_TYPES.filter(t => !SPAWN[t] || typeof SPAWN[t].per1000m2 !== 'number' || !Array.isArray(SPAWN[t].levels) || !SPAWN[t].basis);
  check('data/item-spawn.json 覆盖所有物品且字段齐全', badSpawn.length === 0, badSpawn);
  const allLevels = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', 'fun', 'run'];
  const foods = ['canned_food', 'canned_tuna', 'microwave_meal', 'royal_rations', 'moth_jelly', 'food_ration'];
  const lacking = allLevels.filter(l => {
    const aw = SPAWN.almond_water.levels.includes(l) && SPAWN.almond_water.per1000m2 >= 0.5;
    const food = foods.some(f => SPAWN[f] && SPAWN[f].levels.includes(l) && ((SPAWN[f].perLevel && SPAWN[f].perLevel[l]) || SPAWN[f].per1000m2) >= 0.3);
    return !(aw && food);
  });
  check('每层都有足量杏仁水（≥0.5/1000㎡）和能回饥饿的食物（≥0.3/1000㎡）', lacking.length === 0, lacking);
  return info;
}

// =====================================================================
// 2. 噩梦生存：逐个物品
// =====================================================================
async function generic(page, type, opt) {
  const o = opt || {};
  const start = o.stats || { hp: 50, hunger: 50, sanity: 50 };
  await ev(page, s => __it.reset(s), start);
  if (o.pre) await ev(page, o.pre);
  const pk = await ev(page, t => __it.pickup(t), type);
  check(`[噩梦] ${type} 脚边生成 → 拾取进背包`, pk.spawned && pk.picked && pk.count === 1 && pk.itemsLeft === 0, pk);
  const r = await ev(page, t => __it.use(t), type);
  const spec = r.effect || {};
  const exp = expectInstant(r.before, spec);
  check(`[噩梦] ${type} 使用后 hp/饥饿/san 与声明一致`, statsNear(r.after, exp, 0.01), { before: round(r.before), after: round(r.after), expected: round(exp) });
  const wantConsumed = o.consumed !== undefined ? o.consumed : true;
  check(`[噩梦] ${type} 背包数量正确`, r.consumed === wantConsumed && r.count === (wantConsumed ? 0 : 1), { consumed: r.consumed, count: r.count });
  const timed = spec.timed || [];
  if (timed.length) {
    const expMul = timed.reduce((m, t) => m * (t.speedMul == null ? 1 : t.speedMul), 1);
    const hung = timed.every(t => r.fx.some(e => e.key === t.key && near(e.total, t.seconds, 1e-6)));
    check(`[噩梦] ${type} 时效效果挂上、移速倍率 ×${+expMul.toFixed(3)}`, hung && near(r.speedMul, expMul, 1e-9), { fx: r.fx.map(e => e.key + ':' + e.total), speedMul: r.speedMul });
    const dur = Math.max(...timed.map(t => t.seconds));
    if (dur <= 200) {
      await step(page, dur - 0.5);
      const mid = await ev(page, () => __it.state());
      const longest = timed.filter(t => t.seconds === dur).map(t => t.key);
      await step(page, 0.8);
      const s = await ev(page, () => __it.state());
      const expEnd = expectTimed(r.after, timed, dur);
      check(`[噩梦] ${type} 每秒数值累计正确（${dur}s）`, statsNear(s, expEnd, 0.35), { got: round(s), expected: round(expEnd) });
      check(`[噩梦] ${type} 时效效果 ${dur}s 按时结束`, longest.every(k => mid.fxKeys.includes(k)) && timed.every(t => !s.fxKeys.includes(t.key)) && s.speedMul === 1,
        { before: mid.fxKeys, after: s.fxKeys, speedMul: s.speedMul });
    } else {
      await step(page, 2);
      const s = await ev(page, () => __it.state());
      const exp2 = expectTimed(r.after, timed, 2);
      check(`[噩梦] ${type} 长效效果每秒数值正确（取 2s）`, statsNear(s, exp2, 0.05), { got: round(s), expected: round(exp2) });
      const lefts = timed.map(t => ({ key: t.key, left: (s.fx.find(e => e.key === t.key) || {}).left, want: t.seconds - 2 }));
      check(`[噩梦] ${type} 长效效果剩余时长与声明一致`, lefts.every(l => l.left == null ? l.want <= 0 : near(l.left, l.want, 0.05)), lefts);
      await ev(page, keys => __it.forceEnd(keys), timed.map(t => t.key));
      await step(page, 0.2);
      const s2 = await ev(page, () => __it.state());
      check(`[噩梦] ${type} 长效效果到点移除`, timed.every(t => !s2.fxKeys.includes(t.key)) && s2.speedMul === 1, { fxKeys: s2.fxKeys, speedMul: s2.speedMul });
    }
  }
  if (o.post) await o.post(r);
  return r;
}

async function nightmare(page) {
  await ev(page, (seed) => { __br.start({ mode: 'nightmare', difficulty: 'easy', levelId: 'dev', seed }); return 0; }, SEED);
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000, polling: 200 });
  await installHelpers(page);
  const home = await ev(page, () => {
    __br.setAuto(false);
    BR.config.stats.hungerDrainPerSec = 0;     // 关掉基础消耗，只看物品带来的变化
    BR.config.stats.sanityDrainPerSec = 0;
    BR.game.spawnFactor = 0;
    BR.entities.clear();
    BR.items.clear();
    return __it.findHome();
  });
  check('[噩梦] dev 层开局、有饥饿和 san', await ev(page, () => BR.game.mode === 'nightmare' && BR.game.statsEnabled && BR.game.levelId === 'dev'), home);
  check('[噩梦] 找到前方 ≥9m 的开阔方向（投掷测试用）', home.free >= 9, home);

  const done = new Set();
  const run = async (type, fn) => { done.add(type); await fn(); };

  // --- 杏仁水四款 + 过期 ---
  await run('almond_water', () => generic(page, 'almond_water', {
    pre: () => BR.effects.add({ key: 'test_hostile_drain', seconds: 100, sanityPerSec: -0.5, hostile: true }),
    post: async (r) => check('[噩梦] almond_water 抵消敌对实体造成的时效效果', !r.fx.some(e => e.key === 'test_hostile_drain'), r.fx.map(e => e.key)),
  }));
  await run('almond_water_blue', () => generic(page, 'almond_water_blue', {
    stats: { hp: 50, hunger: 50, sanity: 20 },
    pre: () => BR.effects.add({ key: 'test_mental', seconds: 100, tags: ['mental'], visual: { distort: 0.3 } }),
    post: async (r) => check('[噩梦] almond_water_blue 清掉精神类效果', !r.fx.some(e => e.key === 'test_mental'), r.fx.map(e => e.key)),
  }));
  {
    done.add('almond_water_green');
    const fog0 = await ev(page, () => { __it.reset({ hp: 50, hunger: 50, sanity: 50 }); __br.step(0.1); return BR.gfx.scene.fog.far; });
    await generic(page, 'almond_water_green', {
      post: async () => {
        // generic 已经走完 120s，效果结束；重新喝一瓶看雾
        await ev(page, () => { BR.player.addItem('almond_water_green', 1); return 0; });
        const fogOn = await ev(page, () => { __it.use('almond_water_green'); __br.step(0.1); return BR.gfx.scene.fog.far; });
        check('[噩梦] almond_water_green "更警觉"：能见度（雾远端）变远', fogOn > fog0 + 1, { before: fog0, after: fogOn });
        await ev(page, () => { __it.forceEnd(['almond_water_alert']); __br.step(0.3); return 0; });
        const fogOff = await ev(page, () => BR.gfx.scene.fog.far);
        check('[噩梦] almond_water_green 效果结束后能见度还原', near(fogOff, fog0, 0.01), { fog0, fogOff });
      },
    });
  }
  await run('almond_water_red', () => generic(page, 'almond_water_red', { stats: { hp: 20, hunger: 50, sanity: 50 } }));
  await run('almond_water_expired', () => generic(page, 'almond_water_expired'));

  // --- 液态痛苦：伪装、分阶段毒发、必死、重生清掉 ---
  {
    done.add('liquid_pain');
    await ev(page, () => __it.reset({ hp: 100, hunger: 50, sanity: 50 }));
    const prompt = await ev(page, () => {
      const p = BR.player;
      BR.items.spawn('liquid_pain', p.x - Math.sin(p.yaw) * 0.3, undefined, p.z - Math.cos(p.yaw) * 0.3, { id: 'test/lp' });
      __br.step(0.4);
      const el = document.querySelector('.hud-prompt-text');
      return el ? el.textContent : '';
    });
    check('[噩梦] liquid_pain 拾取提示不剧透（显示杏仁水外观名）', /杏仁水/.test(prompt) && !/液态|痛苦|Liquid/i.test(prompt), prompt);
    const pk = await ev(page, () => ({ picked: BR.player.interact(), count: BR.player.countOf('liquid_pain') }));
    check('[噩梦] liquid_pain 拾取进背包', pk.picked && pk.count === 1, pk);
    const r = await ev(page, () => __it.use('liquid_pain'));
    check('[噩梦] liquid_pain 喝下时数值不变、开始毒发', statsNear(r.after, r.before, 1e-9) && r.count === 0 && r.fx.some(e => e.key === 'liquid_pain' && e.stage === 0 && near(e.total, 180, 1e-6)), r);
    await step(page, 36.2);
    let s = await ev(page, () => __it.state());
    check('[噩梦] liquid_pain 36s 烧心阶段掉 3.6 血', near(s.hp, 96.4, 0.1) && s.fx.find(e => e.key === 'liquid_pain').stage === 1, { hp: s.hp, fx: s.fx });
    await step(page, 120 - 36.2);
    s = await ev(page, () => __it.state());
    check('[噩梦] liquid_pain 120s 疲劳阶段：hp≈75.4、移速 ×0.6', near(s.hp, 75.4, 0.15) && s.speedMul === 0.6, { hp: s.hp, speedMul: s.speedMul });
    await step(page, 50);
    s = await ev(page, () => __it.state());
    check('[噩梦] liquid_pain 170s 大出血阶段：hp≈4.4、移速 ×0.5', near(s.hp, 4.4, 0.3) && !s.dead && s.speedMul === 0.5, { hp: s.hp, dead: s.dead, speedMul: s.speedMul });
    // 就算把血补满，走完 180s 也必死（页面没有任何治疗方法）
    await ev(page, () => { BR.player.hp = 100; return 0; });
    await step(page, 10.5);
    s = await ev(page, () => ({ st: __it.state(), death: window.__deaths[window.__deaths.length - 1] || null, screen: BR.game.screen }));
    check('[噩梦] liquid_pain 180s 必死，死因记在液态痛苦上', s.st.dead && s.death && /液态痛苦/.test(s.death.cause), { dead: s.st.dead, cause: s.death && s.death.cause, screen: s.screen });
    s = await ev(page, () => {
      BR.effects.add({ key: 'test_buff', seconds: 50, speedMul: 1.2 });
      BR.effects.add({ key: 'test_debuff', seconds: 50, hpPerSec: -1 });
      BR.bus.emit('death:continue');
      return { dead: BR.player.dead, keys: BR.effects.list.map(e => e.key), neg: BR.effects.list.filter(e => e.negative).length, screen: BR.game.screen };
    });
    check('[噩梦] 原地重生清掉负面效果、保留增益', !s.dead && s.neg === 0 && s.keys.includes('test_buff') && !s.keys.includes('liquid_pain'), s);
  }

  // --- 糖果：七个品种 ---
  {
    done.add('candy');
    const vars = await ev(page, () => BR.itemTypes.get('candy').varieties.map(v => ({ key: v.key, timed: v.timed })));
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      await ev(page, () => __it.reset({ hp: 50, hunger: 50, sanity: 50 }));
      const pk = i === 0 ? await ev(page, () => __it.pickup('candy')) : await ev(page, () => ({ picked: BR.player.addItem('candy', 1) === 1, count: BR.player.countOf('candy'), spawned: true, itemsLeft: 0 }));
      await ev(page, (x) => { BR.itemKit.rand = () => x; return 0; }, (i + 0.5) / vars.length);
      const r = await ev(page, () => Object.assign(__it.use('candy'), { variety: BR.itemTypes.get('candy').lastVariety, speed: BR.player.speed() }));
      const hasKey = !v.timed || r.fx.some(e => e.key === v.timed.key);
      check(`[噩梦] candy/${v.key} 拾取、吃掉、数值不变、效果挂上`, pk.picked && r.variety === v.key && r.consumed && r.count === 0 && statsNear(r.after, r.before, 1e-9) && hasKey,
        { variety: r.variety, fx: r.fx.map(e => e.key), count: r.count });
      if (v.key === 'paper_man') {
        await step(page, 1);
        const s = await ev(page, () => Object.assign(__it.state(), { speed: BR.player.speed() }));
        check('[噩梦] candy/paper_man 贴在地上动不了（移速 0）、画面压扁', s.speed === 0 && s.speedMul === 0 && s.camY > 1.3, { speed: s.speed, camY: s.camY });
        await ev(page, () => __it.forceEnd(['candy_paper_man']));
        await step(page, 2);
        const s2 = await ev(page, () => Object.assign(__it.state(), { speed: BR.player.speed() }));
        check('[噩梦] candy/paper_man 结束后移速和画面恢复', s2.speedMul === 1 && s2.speed > 0 && near(s2.camY, 1, 0.01), { speed: s2.speed, camY: s2.camY });
      } else if (v.key === 'hazardous_waste') {
        await step(page, v.timed.seconds - 0.5);
        const mid = await ev(page, () => __it.state());
        await step(page, 0.8);
        const s = await ev(page, () => __it.state());
        check('[噩梦] candy/hazardous_waste 180s 口水腐蚀掉 18 血后按时结束', near(s.hp, 32, 0.2) && mid.fxKeys.includes(v.timed.key) && !s.fxKeys.includes(v.timed.key), { hp: s.hp });
      } else if (v.timed) {
        check(`[噩梦] candy/${v.key} 标记持续设定 3 小时 = 180s`, r.fx.some(e => e.key === v.timed.key && near(e.total, 180, 1e-6)), r.fx);
      }
    }
  }

  // --- 皇家口粮：一口吃满、欣快、分 90 口、成瘾让别的食物减半 ---
  {
    done.add('royal_rations');
    await ev(page, () => __it.reset({ hp: 50, hunger: 20, sanity: 50 }));
    const pk = await ev(page, () => __it.pickup('royal_rations'));
    const r = await ev(page, () => __it.use('royal_rations'));
    const exp = expectInstant(r.before, r.effect);
    check('[噩梦] royal_rations 拾取 → 咬一口：饥饿吃满、san +40', pk.picked && statsNear(r.after, exp, 1e-9) && r.after.hunger === 100, { after: r.after, exp });
    check('[噩梦] royal_rations 一块分 90 口，第一口不消耗', r.consumed === false && r.count === 1 && r.slotLeft === 89, { consumed: r.consumed, count: r.count, left: r.slotLeft });
    check('[噩梦] royal_rations 成瘾标记挂上（设定 2 年）', r.fx.some(e => e.key === 'royal_craving' && e.total >= 1e6), r.fx);
    const c = await ev(page, () => { BR.player.hunger = 20; BR.player.addItem('canned_food', 1); return __it.use('canned_food'); });
    check('[噩梦] royal_rations 成瘾期间别的食物回的饥饿打五折（罐头 30 → 15）', near(c.after.hunger, 35, 1e-9), c.after);
    const last = await ev(page, () => {
      const p = BR.player;
      const slot = p.inventory.find(s => s && s.type === 'royal_rations');
      slot.left = 1;
      return __it.use('royal_rations');
    });
    check('[噩梦] royal_rations 最后一口吃完才消耗', last.consumed === true && last.count === 0, { consumed: last.consumed, count: last.count });
  }

  // --- 迁跃浆果：捡到的地方记下来，吃了传送回去 ---
  {
    done.add('warpberries');
    await ev(page, () => __it.reset({ hp: 50, hunger: 50, sanity: 50 }));
    const pk = await ev(page, () => {
      const r = __it.pickup('warpberries');
      const slot = BR.player.inventory.find(s => s && s.type === 'warpberries');
      return Object.assign(r, { origin: slot && slot.origin, at: { x: BR.player.x, z: BR.player.z } });
    });
    check('[噩梦] warpberries 拾取时记下最初发现的层级和位置', pk.picked && pk.origin && pk.origin.levelId === 'dev' && near(pk.origin.x, pk.at.x, 1e-6), pk);
    const moved = await ev(page, () => {
      const p = BR.player, h = window.__home;
      p.reset({ x: h.x - Math.sin(h.yaw) * 4, y: 0, z: h.z - Math.cos(h.yaw) * 4, yaw: h.yaw }, { full: false });
      return { x: p.x, z: p.z };
    });
    const r = await ev(page, () => __it.use('warpberries'));
    check('[噩梦] warpberries 吃一颗 → 穿过地板回到发现地点', Math.hypot(r.x - pk.origin.x, r.z - pk.origin.z) < 0.05 && Math.hypot(moved.x - pk.origin.x, moved.z - pk.origin.z) > 3.5, { moved, now: { x: r.x, z: r.z }, origin: pk.origin });
    check('[噩梦] warpberries 数值不变、一盒 7 颗（第一颗不消耗整盒）', statsNear(r.after, r.before, 1e-9) && r.consumed === false && r.count === 1 && r.slotLeft === 6, { consumed: r.consumed, count: r.count, left: r.slotLeft });
  }

  // --- 飞蛾果冻：营养、心情、当天体力、信息素、过量 ---
  await run('moth_jelly', () => generic(page, 'moth_jelly', {
    stats: { hp: 50, hunger: 30, sanity: 30 },
    post: async () => {
      await ev(page, () => { __it.reset({ hp: 50, hunger: 30, sanity: 30 }); BR.player.addItem('moth_jelly', 3); return 0; });
      const r1 = await ev(page, () => __it.use('moth_jelly'));
      check('[噩梦] moth_jelly 信息素标记 5.5s', r1.fx.some(e => e.key === 'moth_pheromone' && near(e.total, 5.5, 1e-6)), r1.fx);
      await step(page, 6);
      const s = await ev(page, () => __it.state());
      check('[噩梦] moth_jelly 信息素 5.5s 后消失，体力提升还在', !s.fxKeys.includes('moth_pheromone') && s.fxKeys.includes('moth_jelly_energy'), s.fxKeys);
      const r2 = await ev(page, () => { __it.use('moth_jelly'); return __it.use('moth_jelly'); });
      check('[噩梦] moth_jelly 一天内第 3 份算过量（视线模糊）', r2.fx.some(e => e.key === 'moth_jelly_overdose'), r2.fx.map(e => e.key));
    },
  }));

  // --- 火盐：扔出去炸 ---
  {
    done.add('firesalt');
    await ev(page, () => __it.reset({ hp: 100, hunger: 50, sanity: 50 }));
    const tgt = await ev(page, () => __it.spawnTarget(BR.itemTypes.get('firesalt').blast.throw));
    const pk = await ev(page, () => __it.pickup('firesalt'));
    const r = await ev(page, () => __it.use('firesalt'));
    const e = await ev(page, id => __it.entity(id), tgt.id);
    check('[噩梦] firesalt 拾取 → 扔出去在落点爆炸，炸死落点的实体', pk.picked && tgt.id && (e.dead || e.gone || e.hp <= 0) && r.consumed && r.count === 0, { tgt, e });
    check('[噩梦] firesalt 落点在 5m 爆炸半径外，自己不受伤', r.after.hp === 100, r.after);
    // 贴着墙扔：自己在爆炸半径内
    const wall = await ev(page, () => {
      const P = BR.player;
      let best = null;
      for (let i = 0; i < 32; i++) {
        const yaw = -Math.PI + i * Math.PI / 16;
        const h = BR.phys.raycast(P.x, P.y - 0.5, P.z, -Math.sin(yaw), 0, -Math.cos(yaw), 30);
        if (h && h.dist > 1.2 && h.dist < 4.5 && (!best || h.dist < best.d)) best = { yaw, d: h.dist };
      }
      if (!best) return null;
      P.yaw = best.yaw;
      P.hp = 100;
      P.addItem('firesalt', 1);
      const pt = BR.itemKit.throwPoint(P, 8);
      const u = __it.use('firesalt');
      return { d: best.d, pd: Math.hypot(pt.x - P.x, pt.z - P.z), hp: u.after.hp };
    });
    if (wall) {
      const blast = await ev(page, () => BR.itemTypes.get('firesalt').blast);
      const want = 100 - blast.playerDamage * (1 - wall.pd / blast.radius);
      check('[噩梦] firesalt 砸在近处墙上会连自己一起炸（伤害按距离衰减）', near(wall.hp, want, 0.5), { wall, want });
    } else {
      check('[噩梦] firesalt 近墙自伤（没找到 1.2–4.5m 的墙，跳过）', true);
    }
  }

  // --- 瓶装闪电：三种 ---
  {
    for (const t of ['lightning_in_a_bottle', 'lightning_in_a_bottle_artificial', 'lightning_in_a_bottle_black']) done.add(t);
    // 蓝色：落点有实体 → 打实体
    await ev(page, () => __it.reset({ hp: 100, hunger: 50, sanity: 50 }));
    let tgt = await ev(page, () => __it.spawnTarget(8));
    let pk = await ev(page, () => __it.pickup('lightning_in_a_bottle'));
    let r = await ev(page, () => __it.use('lightning_in_a_bottle'));
    let e = await ev(page, id => __it.entity(id), tgt.id);
    check('[噩梦] lightning 蓝色：拾取 → 摔开，电流打最近的导体（落点的实体）', pk.picked && (e.dead || e.gone) && r.after.hp === 100 && r.count === 0, { e, hp: r.after.hp });
    // 蓝色：附近没有实体 → 自己是最近的导体；掷骰没中致命 → 掉 90
    r = await ev(page, () => { BR.player.addItem('lightning_in_a_bottle', 1); BR.itemKit.rand = () => 0.99; return __it.use('lightning_in_a_bottle'); });
    check('[噩梦] lightning 蓝色：没有更近的导体就打自己，偶尔活下来（-90）', near(r.after.hp, 10, 1e-9) && !r.dead, r.after);
    // 蓝色：致命
    r = await ev(page, () => { BR.player.hp = 100; BR.player.addItem('lightning_in_a_bottle', 1); BR.itemKit.rand = () => 0; return __it.use('lightning_in_a_bottle'); });
    check('[噩梦] lightning 蓝色：打到人通常致命', r.dead, { dead: r.dead, hp: r.after.hp });
    // 人工：约蓝色的十分之一
    await ev(page, () => __it.reset({ hp: 100, hunger: 50, sanity: 50 }));
    pk = await ev(page, () => __it.pickup('lightning_in_a_bottle_artificial'));
    r = await ev(page, () => __it.use('lightning_in_a_bottle_artificial'));
    check('[噩梦] lightning 人工：威力约蓝色的十分之一（打自己 -9）', pk.picked && near(r.after.hp, 91, 1e-9) && r.count === 0, r.after);
    // 黑色：不爆炸、随机挑中实体
    await ev(page, () => __it.reset({ hp: 100, hunger: 50, sanity: 50 }));
    tgt = await ev(page, () => __it.spawnTarget(8));
    pk = await ev(page, () => __it.pickup('lightning_in_a_bottle_black'));
    r = await ev(page, () => { __it.seq([0.9, 0]); return __it.use('lightning_in_a_bottle_black'); });
    e = await ev(page, id => __it.entity(id), tgt.id);
    check('[噩梦] lightning 黑色：优先打活物（落点实体被打死），这次没爆炸', pk.picked && (e.dead || e.gone) && r.after.hp === 100, { e, hp: r.after.hp });
    // 黑色：随机挑到自己 → 必死
    r = await ev(page, () => { BR.player.addItem('lightning_in_a_bottle_black', 1); __it.seq([0.9, 0.99]); return __it.use('lightning_in_a_bottle_black'); });
    check('[噩梦] lightning 黑色：行为反常，挑到自己就必死', r.dead, { dead: r.dead });
  }

  // --- PTG-B ---
  {
    done.add('ptg_b');
    await ev(page, () => __it.reset({ hp: 50, hunger: 50, sanity: 50 }));
    const pk = await ev(page, () => __it.pickup('ptg_b'));
    const r = await ev(page, () => { BR.effects.add({ key: 'ptg_a', seconds: 1440, negative: true }); return __it.use('ptg_b'); });
    check('[噩梦] ptg_b 刚被咬就注射：逆转转化（移除 ptg_a），数值不变', pk.picked && !r.fx.some(e => e.key === 'ptg_a') && statsNear(r.after, r.before, 1e-9) && r.count === 0, r.fx);
    const r2 = await ev(page, () => {
      BR.player.addItem('ptg_b', 1);
      const e = BR.effects.add({ key: 'ptg_a', seconds: 1440, negative: true });
      e.elapsed = 1440 * 0.9;
      return __it.use('ptg_b');
    });
    check('[噩梦] ptg_b 转化时间越长越难逆转（进度 90% 时 0.5 的掷骰失败）', r2.fx.some(e => e.key === 'ptg_a'), r2.fx);
  }

  // --- 消毒剂 ---
  await run('antiseptics', () => generic(page, 'antiseptics', {
    pre: () => BR.effects.add({ key: 'test_infection', seconds: 100, hpPerSec: -0.2, tags: ['infection'] }),
    post: async (r) => check('[噩梦] antiseptics 清掉感染类效果', !r.fx.some(e => e.key === 'test_infection'), r.fx.map(e => e.key)),
  }));

  // --- 会在层外腐烂的 Level 19 物资 ---
  for (const t of ['water_bottle', 'canned_tuna']) {
    await run(t, () => generic(page, t, {
      post: async () => {
        const r = await ev(page, (type) => { __it.reset({ hp: 50, hunger: 50, sanity: 50 }); BR.player.addItem(type, 1); BR.itemKit.rand = () => 0; return __it.use(type); }, t);
        check(`[噩梦] ${t} 带出 Level 19 后 1% 腐烂：数值不变但照样消耗`, statsNear(r.after, r.before, 1e-9) && r.consumed && r.count === 0, r.after);
      },
    }));
  }

  // --- 优质的肉：交易品，不消耗 ---
  await run('high_quality_meat', () => generic(page, 'high_quality_meat', { consumed: false }));

  // --- 其余：按声明的通用流程 ---
  for (const t of ALL_TYPES) {
    if (done.has(t)) continue;
    await generic(page, t);
  }
}

// =====================================================================
// 3. 游玩模式：物品照样能捡能用，hp/饥饿/san 一律不变；非数值效果照常
// =====================================================================
async function casual(page) {
  // 直接换局，不经过主页：主页自带 rAF 动画在 SwiftShader 下很慢，会把 rAF 轮询饿死
  await ev(page, (seed) => { __br.start({ mode: 'casual', levelId: 'dev', seed }); return 0; }, SEED);
  await page.waitForFunction(() => BR.game.screen === 'playing' && BR.game.mode === 'casual', null, { timeout: 20000, polling: 200 });
  await installHelpers(page);
  await ev(page, () => { __br.setAuto(false); BR.game.spawnFactor = 0; BR.entities.clear(); BR.items.clear(); __it.findHome(); return 0; });
  check('[游玩] dev 层开局、没有饥饿和 san', await ev(page, () => BR.game.mode === 'casual' && !BR.game.statsEnabled));
  const bad = [];
  const nonNumeric = {};
  for (const type of ALL_TYPES) {
    const r = await ev(page, (t) => {
      __it.reset({ hp: 70, hunger: 60, sanity: 40 });
      const pk = __it.pickup(t);
      const u = __it.use(t);
      const mul = BR.effects.speedMul();
      __it.fastStep(3);
      const p = BR.player;
      return { pk, u, mul, later: { hp: p.hp, hunger: p.hunger, sanity: p.sanity }, keys: BR.effects.list.map(e => e.key) };
    }, type);
    nonNumeric[type] = { speedMul: r.mul, fx: r.keys };
    const same = statsNear(r.u.after, r.u.before, 0) && statsNear(r.later, r.u.before, 0);
    const wantConsumed = !['high_quality_meat', 'royal_rations', 'warpberries'].includes(type);
    if (!(r.pk.picked && same && r.u.consumed === wantConsumed && !r.u.dead)) bad.push({ type, pk: r.pk, before: r.u.before, after: r.u.after, later: r.later, consumed: r.u.consumed });
  }
  check('[游玩] 全部物品：拾取、使用后与 3 秒后 hp/饥饿/san 都不变、背包照常扣', bad.length === 0, bad);
  check('[游玩] 非数值效果照常：蓝色杏仁水加速 ×1.1、纸片人糖定身、液态痛苦照样毒发（不掉血）',
    near(nonNumeric.almond_water_blue.speedMul, 1.1, 1e-9) && nonNumeric.candy.speedMul === 0 && nonNumeric.liquid_pain.fx.includes('liquid_pain'),
    { blue: nonNumeric.almond_water_blue, candy: nonNumeric.candy, lp: nonNumeric.liquid_pain });
  const home = await ev(page, () => {
    BR.effects.add({ key: 'test_flat', seconds: 30, visual: { flatten: 0.6 } });
    __br.step(1);
    BR.bus.emit('game:home');
    return { n: BR.effects.list.length, camY: BR.gfx.camera.scale.y, screen: BR.game.screen };
  });
  check('[游玩] 回主页清空所有时效效果、画面压扁复原', home.n === 0 && home.camY === 1, home);
}

// =====================================================================
// 4. 截图：所有物品排成一排（每张 8 个）+ 图标总览
// =====================================================================
async function screenshots(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  // game:start 从任何界面都能开局；等待用定时轮询，不依赖 rAF（主页自己的动画会占着帧）
  await ev(page, (seed) => { __br.start({ mode: 'test', levelId: 'dev', seed }); return 0; }, SEED);
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000, polling: 200 });
  await installHelpers(page);
  const spot = await ev(page, () => {
    __br.setAuto(false);
    BR.entities.clear();
    BR.items.clear();
    BR.hud.show(false);
    const P = BR.player;
    const cast = (x, z, yaw) => { const h = BR.phys.raycast(x, 0.5, z, -Math.sin(yaw), 0, -Math.cos(yaw), 20); return h ? h.dist : 20; };
    // 找一个前方 ≥2.2m、排物品的那条线左右各 ≥1.4m 都空着的位置
    let best = null;
    for (let i = 0; i < 16 && !best; i++) {
      const yaw = -Math.PI + i * Math.PI / 8;
      for (let back = 0; back <= 6 && !best; back += 1) {
        const x = P.x - Math.sin(yaw) * back, z = P.z - Math.cos(yaw) * back;
        if (cast(P.x, P.z, yaw) < back + 2.4) continue;
        const cx = x - Math.sin(yaw) * 1.0, cz = z - Math.cos(yaw) * 1.0;
        if (cast(cx, cz, yaw + Math.PI / 2) >= 1.4 && cast(cx, cz, yaw - Math.PI / 2) >= 1.4 && cast(x, z, yaw) >= 2.2) best = { x, z, yaw };
      }
    }
    if (!best) best = { x: P.x, z: P.z, yaw: window.__home.yaw };
    const light = new THREE.Group();
    light.name = 'test-shot-light';
    light.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(best.x + Math.sin(best.yaw) * 1.5, 3, best.z + Math.cos(best.yaw) * 1.5);
    dl.target.position.set(best.x - Math.sin(best.yaw), 0, best.z - Math.cos(best.yaw));
    light.add(dl, dl.target);
    BR.gfx.scene.add(light);
    window.__shot = best;
    return best;
  });
  const PER = 8;
  for (let g = 0; g * PER < ALL_TYPES.length; g++) {
    const group = ALL_TYPES.slice(g * PER, (g + 1) * PER);
    await ev(page, (types) => {
      const s = window.__shot;
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      BR.items.clear();
      const cx = s.x + fx * 1.0, cz = s.z + fz * 1.0;
      types.forEach((t, j) => {
        const off = (j - (types.length - 1) / 2) * 0.27;
        BR.items.spawn(t, cx + rx * off, undefined, cz + rz * off, { id: 'shot/' + t });
      });
      BR.items.update(0.35);   // 转一点角度，标签朝向镜头
      const gy = BR.phys.groundY(s.x, s.z) || 0;
      const cam = BR.gfx.camera;
      cam.position.set(s.x - fx * 0.05, gy + 0.62, s.z - fz * 0.05);
      cam.lookAt(cx, gy + 0.2, cz);
      cam.updateMatrixWorld();
      let bar = document.getElementById('test-item-names');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'test-item-names';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,.72);color:#fff;font:13px/1.4 sans-serif;padding:6px 10px;display:flex;justify-content:space-around;';
        document.body.appendChild(bar);
      }
      bar.innerHTML = types.map((t, j) => '<span>' + (j + 1) + '. ' + BR.itemTypes.get(t).zh + '</span>').join('');
      BR.gfx.render(0);
      return 0;
    }, group);
    const f = path.join(OUT, 'items-row-' + (g + 1) + '.png');
    await page.screenshot({ path: f });
    shots.push(f);
    console.log('     shot ' + path.relative(ROOT, f) + '  ' + group.join(', '));
  }
  // 图标总览：背包里能不能区分
  await ev(page, (types) => {
    const bar = document.getElementById('test-item-names');
    if (bar) bar.remove();
    const sheet = document.createElement('div');
    sheet.id = 'test-icon-sheet';
    sheet.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#2a2620;padding:10px;display:grid;grid-template-columns:repeat(8,150px);gap:6px;';
    sheet.innerHTML = types.map(t => {
      const d = BR.itemTypes.get(t);
      return '<div style="background:#3b352b;border:1px solid #6b5f4a;border-radius:6px;padding:4px;text-align:center;color:#f3e9c6;font:12px sans-serif">'
        + '<img src="' + d.icon + '" width="96" height="96" style="image-rendering:pixelated;display:block;margin:0 auto"><div>' + d.zh + '</div></div>';
    }).join('');
    document.body.appendChild(sheet);
    return 0;
  }, ALL_TYPES);
  const sheet = await page.$('#test-icon-sheet');
  const f = path.join(OUT, 'items-icons.png');
  await sheet.screenshot({ path: f });
  shots.push(f);
  console.log('     shot ' + path.relative(ROOT, f));
  await ev(page, () => {
    document.getElementById('test-icon-sheet').remove();
    const l = BR.gfx.scene.getObjectByName('test-shot-light');
    if (l) BR.gfx.scene.remove(l);
    BR.items.clear();
    return 0;
  });
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  console.log('inject ' + INJECT.length + ' files: ' + INJECT.join(' '));
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const { page } = await openPage(browser, base);
    const t0 = Date.now();
    const lap = name => console.log('---- ' + name + ' 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    // 逻辑测试阶段用小窗口：SwiftShader 软件渲染的开销跟像素数成正比；截图前再放大
    await page.setViewportSize({ width: 480, height: 270 });
    await staticChecks(page);
    lap('注册检查');
    await nightmare(page);
    lap('噩梦生存');
    await casual(page);
    lap('游玩模式');
    await screenshots(page);
    lap('截图');
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    const tc = Date.now();
    await browser.close();
    console.log('---- 关闭浏览器用时 ' + ((Date.now() - tc) / 1000).toFixed(1) + 's');
    // keep-alive 连接不断开的话 close() 会一直等，进程退不出去
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
  check('零 console.error / 未捕获异常', errors.length === 0, errors.slice(0, 10));

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT));
  process.exit(failed.length || errors.length ? 1 : 0);
}

main();
