// 后室 · 线上实测：node tests/online.mjs [--url https://vibetool.github.io/backrooms/] [--levels 0,1,..] [--entities hound,wretch,..]
//                                        [--seconds 3] [--entity-seconds 2] [--local] [--no-refresh]
//
// 为什么要有它：本地全绿不代表线上好——GitHub Pages 漏传文件、大小写路径、CDN 旧缓存，只有打线上才看得出来。
// 流程：
//   1. 打开页面，把页面引用的全部脚本、样式（按服务器最新 index.html 和当前文档两份清单取并集），
//      以及已加载过的同源资源（贴图、模型、data/*.json），逐个 fetch({ cache: 'reload' }) 刷掉浏览器缓存，再 reload。
//      同时拿"带时间戳查询参数"的副本对照：两份内容不同 = CDN 还在回旧文件（Pages 缓存约 10 分钟），只提示不判失败；
//      和本地工作区逐个比 SHA-256，列出不同的文件（本地可能有未推送的改动，也只提示）。
//   2. reload 之后才开始计数：console.error / 未捕获异常、资源非 200（performance resource 的 responseStatus + response 事件）。
//   3. 统计已注册层级数 / 实体类型数 / 物品类型数；LEVEL_ORDER 里的层必须都注册，层级 entities / items 表里的 type 必须都注册。
//   4. 测试模式逐层进入（默认 BR.LEVEL_ORDER 全部），推进 --seconds 秒；再用 BR.entities.spawn 在玩家前方逐个放出
//      --entities 指定的实体（缺省 = 该层 entities 表里的全部 type），每只推进 --entity-seconds 秒后清场。
//      测试模式下玩家不能受伤：监听 player:damage，挨一下就判失败。
//   5. 打印逐层汇总表。有页面报错、资源非 200 或检查失败时退出码 1。
// --local：不打线上，起本地静态服务测当前工作区（调这个脚本本身用）。--no-refresh：跳过第 1 步。
// 联机信令 api.ovobot.ai 一律在浏览器里拦截，不会打到线上信令服务器。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 12345;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const list = v => (v && v !== true ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
const LOCAL = !!arg('local', false);
const REFRESH = !arg('no-refresh', false);
const LEVELS = list(arg('levels', null));
const ENTITIES = list(arg('entities', null));
const SECONDS = Math.max(0, +arg('seconds', 3) || 0);
const ENTITY_SECONDS = Math.max(0, +arg('entity-seconds', 2) || 0);

// ---------- 本地静态服务（--local 用，照 tests/smoke.mjs） ----------
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
let phase = 'stale';            // 'stale'：首次加载与刷新缓存阶段，报错只提示；'run'：reload 之后，计入结果
let curTag = 'boot';
const errors = [];              // { phase, tag, text }
const badResponses = [];        // response 事件里 status ≥ 400 / 请求失败
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const isSignal = u => /^https?:\/\/api\.ovobot\.ai\//.test(u);

// 推进逻辑时间：每次 evaluate 最多 1 秒，SwiftShader 下一次 evaluate 太长会拖慢 Playwright 心跳
async function stepFor(page, seconds) {
  let left = seconds;
  while (left > 1e-6) {
    const dt = Math.min(1, left);
    await page.evaluate(d => __br.step(d), dt);
    left -= dt;
  }
}

async function waitReady(page) {
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 90000 });
  await page.evaluate(() => { if (BR.assets && typeof BR.assets.init === 'function') BR.assets.init(); });
  await page.waitForTimeout(800);
}

// ---------- 页面内：刷新缓存 ----------
async function pageRefresh({ limit }) {
  const here = location.href.split('#')[0];
  const origin = location.origin;
  const urls = new Set();
  const cross = new Set();
  const add = u => {
    try {
      const x = new URL(u, here);
      if (!/^https?:$/.test(x.protocol)) return;
      x.hash = '';
      if (x.origin === origin) urls.add(x.href); else cross.add(x.href);
    } catch (e) { /* 非法地址不管 */ }
  };
  let htmlStatus = 0;
  try {
    const r = await fetch(here, { cache: 'reload' });
    htmlStatus = r.status;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    doc.querySelectorAll('script[src]').forEach(s => add(s.getAttribute('src')));
    doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(l => add(l.getAttribute('href')));
  } catch (e) { /* 拿不到最新 html 就只按当前文档的清单刷 */ }
  document.querySelectorAll('script[src]').forEach(s => add(s.src));
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(l => add(l.href));
  performance.getEntriesByType('resource').forEach(e => add(e.name));
  urls.delete(here);

  const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const textLike = u => /\.(js|mjs|css|json|html?)(\?|$)/i.test(u);
  const digest = async buf => (crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', buf)) : null);
  const all = Array.from(urls);
  const out = [];
  let i = 0;
  async function worker() {
    while (i < all.length) {
      const u = all[i++];
      const rec = { url: u, status: 0, sha: null, bustSha: null };
      try {
        const r = await fetch(u, { cache: 'reload' });
        rec.status = r.status;
        const buf = await r.arrayBuffer();
        if (textLike(u)) {
          rec.sha = await digest(buf);
          // 带查询参数的副本绕过 CDN 缓存：和上面那份不同，说明 CDN 还在回旧内容
          const b = await fetch(u + (u.includes('?') ? '&' : '?') + '_bust=' + Date.now(), { cache: 'no-store' });
          if (b.ok) rec.bustSha = await digest(await b.arrayBuffer());
        }
      } catch (err) { rec.error = String((err && err.message) || err); }
      out.push(rec);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return { here, htmlStatus, list: out, cross: Array.from(cross) };
}

// ---------- 页面内：在玩家前方放一只实体 ----------
function pageSpawn(type) {
  if (!BR.entityTypes.has(type)) return { ok: false, fatal: true, reason: '实体类型未注册' };
  const P = BR.player;
  const from = { x: P.x, y: P.y, z: P.z };
  let spot = null;
  // 八个方向里找第一个前方至少 2.5 m 没墙的，放在 4 m 处（或墙前 1 m）：贴脸放会挤进玩家碰撞圈，太远可能隔墙
  for (let i = 0; i < 8 && !spot; i++) {
    const yaw = P.yaw + i * Math.PI / 4;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const hit = BR.phys.raycast(P.x, P.feetY + 1, P.z, dx, 0, dz, 6);
    const free = hit ? hit.dist : 6;
    if (free >= 2.5) { const d = Math.min(4, free - 1); spot = { x: P.x + dx * d, z: P.z + dz * d }; }
  }
  let e = null;
  try {
    if (spot) e = BR.entities.spawn(type, spot.x, P.feetY, spot.z, { from });
    if (!e) e = BR.entities.spawn(type, P.x + 1.5, P.feetY, P.z, {});   // 四周都窄：交给 spawn 自己一圈圈找空位
  } catch (err) {
    return { ok: false, fatal: true, reason: '抛异常 ' + String((err && err.message) || err) };
  }
  if (!e) return { ok: false, reason: '附近找不到落脚点' };
  return { ok: true, id: e.id, d: +Math.hypot(e.x - P.x, e.z - P.z).toFixed(2) };
}

// ---------- 页面内：资源条目 ----------
function pageResources(from) {
  return performance.getEntriesByType('resource').slice(from).map(e => ({ name: e.name, status: e.responseStatus, type: e.initiatorType }));
}

// ---------- 表格 ----------
const cw = s => { let w = 0; for (const ch of String(s)) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1; return w; };
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - cw(s)));
function table(head, rows) {
  const w = head.map((h, i) => Math.max(cw(h), ...rows.map(r => cw(r[i]))));
  const line = r => r.map((c, i) => pad(c, w[i])).join('  ');
  return [line(head), w.map(x => '-'.repeat(x)).join('  '), ...rows.map(line)].join('\n');
}

// ---------- 主流程 ----------
async function main() {
  const t0 = Date.now();
  const srv = LOCAL ? await startServer() : null;
  const url = LOCAL ? 'http://127.0.0.1:' + srv.address().port + '/' : String(arg('url', 'https://vibetool.github.io/backrooms/'));
  console.log('online 实测 ' + url + (LOCAL ? '（--local 本地工作区）' : ''));
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const rows = [];
  let summary = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    // 默认 250 条就满，满了之后的资源不再记，非 200 会漏检
    await ctx.addInitScript(() => { try { performance.setResourceTimingBufferSize(100000); } catch (e) { /* 老浏览器 */ } });
    // 联机信令服务器绝不能打线上
    await ctx.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push({ phase, tag: curTag, text: 'console.error: ' + m.text() + (m.location().url ? ' @ ' + m.location().url : '') }); });
    page.on('pageerror', e => errors.push({ phase, tag: curTag, text: 'pageerror: ' + (e.stack || e.message) }));
    page.on('response', r => { if (r.status() >= 400 && !isSignal(r.url())) badResponses.push({ phase, tag: curTag, url: r.url(), status: r.status() }); });
    page.on('requestfailed', rq => {
      const f = rq.failure();
      if (isSignal(rq.url())) return;
      badResponses.push({ phase, tag: curTag, url: rq.url(), status: 'failed ' + (f ? f.errorText : '') });
    });

    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await waitReady(page);

    // ---------- 1. 刷新缓存 ----------
    if (REFRESH) {
      const r = await page.evaluate(pageRefresh, { limit: 8 });
      const bad = r.list.filter(x => x.status !== 200);
      console.log(`刷新缓存：${r.list.length} 个同源资源（index.html ${r.htmlStatus}），跨域 ${r.cross.length} 个未刷新`);
      check('刷新缓存：index.html 与引用的资源都是 200', r.htmlStatus === 200 && bad.length === 0, bad.slice(0, 10).map(x => x.status + ' ' + x.url + (x.error ? ' ' + x.error : '')));
      const cdnStale = r.list.filter(x => x.sha && x.bustSha && x.sha !== x.bustSha);
      if (cdnStale.length) console.log(`  注意：${cdnStale.length} 个文件 CDN 仍回旧内容（带查询参数的副本不同），结果可能测到旧版本，过几分钟再测：` + cdnStale.slice(0, 5).map(x => x.url.slice(r.here.length)).join('、'));
      // 和本地工作区对照：只看 url 在页面目录下、本地有同名文件的
      const diff = [], same = [];
      for (const x of r.list) {
        if (!x.sha || !x.url.startsWith(r.here)) continue;
        const rel = decodeURIComponent(x.url.slice(r.here.length).split('?')[0]);
        const f = path.join(ROOT, rel);
        if (!rel || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
        const local = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        (local === (x.bustSha || x.sha) ? same : diff).push(rel);
      }
      console.log(`  与本地工作区对照：相同 ${same.length} 个，不同 ${diff.length} 个` + (diff.length ? '：' + diff.slice(0, 12).join('、') + (diff.length > 12 ? '…' : '') : ''));
      const staleErrs = errors.filter(e => e.phase === 'stale');
      if (staleErrs.length) console.log(`  刷新前（可能是旧缓存）的页面报错 ${staleErrs.length} 条，不计入结果；reload 后还在的会再记一次`);
    }

    // ---------- 2. reload 后开始计数 ----------
    phase = 'run';
    curTag = 'reload';
    await page.reload({ waitUntil: 'load', timeout: 90000 });
    await waitReady(page);

    const info = await page.evaluate(() => {
      const tableIssues = [];
      for (const lv of BR.levels.all()) {
        for (const e of lv.entities || []) if (e && !BR.entityTypes.has(e.type)) tableIssues.push('L' + lv.id + ' 实体 ' + e.type);
        for (const it of lv.items || []) if (it && !BR.itemTypes.has(it.type)) tableIssues.push('L' + lv.id + ' 物品 ' + it.type);
      }
      const order = (BR.LEVEL_ORDER || []).map(String);
      return {
        version: BR.config && BR.config.version,
        levels: BR.levels.all().map(l => String(l.id)),
        order,
        missing: order.filter(id => !BR.levels.has(id)),
        entityTypes: BR.entityTypes.all().length,
        itemTypes: BR.itemTypes.all().length,
        tableIssues,
      };
    });
    summary = info;
    console.log(`已注册层级 ${info.levels.length} 个（首期 ${info.order.length - info.missing.length}/${info.order.length}），实体类型 ${info.entityTypes} 种，物品类型 ${info.itemTypes} 种，config.version ${info.version}`);
    check('LEVEL_ORDER 里的层级都已注册', info.missing.length === 0, info.missing);
    check('每个层级 entities / items 表里的 type 都已注册', info.tableIssues.length === 0, info.tableIssues.slice(0, 10));

    const levels = LEVELS || info.order;
    if (ENTITIES) {
      const unknown = await page.evaluate(ts => ts.filter(t => !BR.entityTypes.has(t)), ENTITIES);
      check('--entities 指定的实体类型都已注册', unknown.length === 0, unknown);
    }

    // ---------- 3. 逐层 ----------
    let resFrom = 0;
    for (const id of levels) {
      curTag = 'L' + id;
      const lt = Date.now();
      const e0 = errors.length, b0 = badResponses.length;
      const row = { id, enter: '否', chunks: '-', spawned: '-', errs: 0, non200: 0, dmg: '-', secs: '' };
      rows.push(row);
      try {
        if (!(await page.evaluate(lid => BR.levels.has(lid), id))) { check(`L${id}：已注册`, false); continue; }
        if (await page.evaluate(() => BR.game.screen !== 'home')) {
          await page.evaluate(() => BR.bus.emit('game:home'));
          await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 15000 });
        }
        await page.evaluate(({ lid, seed }) => {
          __br.setAuto(false);
          __br.start({ mode: 'test', levelId: lid, seed, settings: { visibility: 1 } });
          const G = window.__online = window.__online || {};
          if (G.off) G.off();
          G.dmg = 0; G.dmgSources = [];
          G.off = BR.bus.on('player:damage', p => { G.dmg++; if (G.dmgSources.length < 5) G.dmgSources.push(p && p.source != null ? String(p.source.type || p.source) : '?'); });
        }, { lid: id, seed: SEED });
        await page.waitForFunction(lid => BR.game.screen === 'playing' && BR.game.levelId === lid && BR.world && BR.world.current, id, { timeout: 60000 });
        row.enter = '是';
        await stepFor(page, SECONDS);
        const lv = await page.evaluate(() => ({
          mode: BR.game.mode, chunks: BR.world.debugInfo().loaded,
          table: Array.from(new Set((BR.world.current.entities || []).map(e => e && e.type).filter(Boolean))),
        }));
        row.chunks = lv.chunks;
        if (lv.mode !== 'test') check(`L${id}：处于测试模式`, false, lv.mode);

        const types = ENTITIES || lv.table;
        let okN = 0;
        const notes = [];
        for (const t of types) {
          const s = await page.evaluate(pageSpawn, t);
          if (s.ok) {
            okN++;
            await stepFor(page, ENTITY_SECONDS);
          } else {
            notes.push(t + '：' + s.reason);
            if (s.fatal) check(`L${id}：放出 ${t}`, false, s.reason);
          }
          await page.evaluate(() => { BR.entities.clear(); __br.step(0.05); });
        }
        row.spawned = types.length ? okN + '/' + types.length : '（表空）';
        if (notes.length) console.log(`  L${id} 未放出：` + notes.join('；'));

        const hurt = await page.evaluate(() => ({ dmg: window.__online.dmg, src: window.__online.dmgSources, hp: BR.player.hp, dead: BR.player.dead }));
        row.dmg = hurt.dmg ? hurt.dmg + ' 次' : '无';
        if (hurt.dmg || hurt.dead) check(`L${id}：测试模式玩家不受伤`, false, hurt);
      } catch (err) {
        check(`L${id}：流程未中断`, false, String((err && err.message) || err).split('\n')[0]);
      } finally {
        // 本层新增的资源条目：非 200 的算失败（跨域拿不到状态的 0 不算；同源 0 另看 response 事件有没有报错）
        try {
          const res = await page.evaluate(pageResources, resFrom);
          resFrom += res.length;
          const origin = new URL(url).origin;
          for (const x of res) {
            if (isSignal(x.name) || !/^https?:/.test(x.name)) continue;
            if (x.status === 200 || x.status === undefined) continue;
            if (x.status === 0 && !x.name.startsWith(origin)) continue;
            if (x.status === 0) continue;   // 同源 0：内存缓存命中等情况；真失败会在 requestfailed / response 事件里
            badResponses.push({ phase: 'run', tag: curTag, url: x.name, status: x.status });
          }
        } catch (e) { /* 页面崩了：上面已经记了失败 */ }
        row.errs = errors.length - e0;
        row.non200 = badResponses.length - b0;
        row.secs = ((Date.now() - lt) / 1000).toFixed(1) + 's';
        console.log(`L${id}  进入 ${row.enter}  区块 ${row.chunks}  实体 ${row.spawned}  报错 ${row.errs}  非200 ${row.non200}  受伤 ${row.dmg}  ${row.secs}`);
      }
    }
    if (await page.evaluate(() => BR.game.screen !== 'home').catch(() => false)) await page.evaluate(() => BR.bus.emit('game:home')).catch(() => {});
    curTag = 'end';
  } catch (err) {
    check('线上实测流程未中断', false, String((err && err.stack) || err));
  }
  // 浏览器放到汇总之后再关：Chrome 退出后遗留的 crashpad 进程占着 stdio 管道时，browser.close() 会拖好几分钟

  const runErrs = errors.filter(e => e.phase === 'run');
  const runBad = badResponses.filter(b => b.phase === 'run');
  console.log('\n===== 线上实测汇总 =====');
  console.log(url);
  if (summary) console.log(`已注册层级 ${summary.levels.length}（首期 ${summary.order.length - summary.missing.length}/${summary.order.length}），实体类型 ${summary.entityTypes}，物品类型 ${summary.itemTypes}`);
  if (rows.length) console.log(table(['层级', '进入', '区块', '实体放出', '页面报错', '非200', '玩家受伤', '耗时'], rows.map(r => [r.id, r.enter, r.chunks, r.spawned, r.errs, r.non200, r.dmg, r.secs])));
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + (f.detail !== undefined ? '  ' + JSON.stringify(f.detail) : ''));
  console.log('页面报错 ' + runErrs.length + ' 条');
  for (const e of runErrs.slice(0, 30)) console.log('  [' + e.tag + '] ' + e.text);
  console.log('资源非 200 ' + runBad.length + ' 个');
  for (const b of runBad.slice(0, 30)) console.log('  [' + b.tag + '] ' + b.status + ' ' + b.url);
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const code = failed.length || runErrs.length || runBad.length ? 1 : 0;
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 15000))]);
  if (srv) srv.close();
  process.exit(code);
}

main();
