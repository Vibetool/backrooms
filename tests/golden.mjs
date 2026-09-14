// 后室 · 世界生成金样（golden）回归：node tests/golden.mjs [--update] [--levels 0,1,fun] [--out dir] [--shard k/n] [--dump dir]
//
// 为什么要有它：后面每个里程碑都会动 kit / 层级 / 实体表，肉眼看截图发现不了"某块少了一堵墙、出口挪了 3 cm、
// 实体落点变了"。这里把每个首期层级固定种子、固定 5×5 区块（cx、cz ∈ -2..2）的生成结果规范化成 JSON 再算哈希，
// 改动前后一比就知道哪一层哪一块变了、变的是哪类数据。
//
// 规范化的内容（坐标一律四舍五入到 1 mm，±Infinity 记成字符串 "Inf"/"-Inf"）：
//   verts / mats / meshes  区块 group 里每个带几何的对象：[材质 key, 顶点数]（InstancedMesh 追加 'inst', 实例数；非 Mesh 追加类型名）
//                          材质 key 取 BR.assets.material 的缓存 key（kit 的是 "kit|<key>"），不经缓存的材质退回 name / 类型+颜色
//   solids                 [minX, minY, minZ, maxX, maxY, maxZ]，有额外的标量字段时追加一个对象
//   spawnPoints            [x, y, z]（有 safe 等额外字段时追加对象）；只收 world 认可的合法点
//   exits                  { x, y, z, to, kind, sealed, radius, active }；只收 world 认可的（坐标合法且 to 不为空）
//   entities               固定 rng（U.rng(levelSeed, cx, cz, 'entities')）、spawnFactor = 1 下 spawnForChunk 放出的 [type, x, z]
//
// 确定性约定：
//   - 测试模式、种子 12345、画质固定 high（L10 等层级和 assets 会读 BR.game.settings.quality）
//   - 区块直接调层级的 buildChunk(ctx, cx, cz, U.rng(levelSeed, cx, cz))，和 js/game/world.js buildChunk 同一入口；
//     ctx 用 world.start 时真正传进去的那个对象（先挂钩抓下来），层级 enter 里算好的全层数据照常生效
//   - 实体落点只由这 25 块自己的碰撞体决定：world 围着出生点建的块的碰撞体先摘掉，出生点挪动不会牵连金样
//   - 实体表用原始层级（不走出生安全区的 safeLevel），每块单独清场再放，块与块之间互不影响、也不撞 28 只上限
//
// 模式：
//   默认     和 <out>/<levelId>.json 比对，逐层 PASS/FAIL + 差异摘要；本次结果另写到 --dump（缺省 tests/output/golden-current/）方便 diff
//   --update 重写基线（可配 --levels 只写白名单里的层）
//   --out    基线目录，缺省 tests/golden/
//   --tag <名> / --against <名>  改动前拍快照到 tests/output/golden-tags/<名>/，改动后拿它比对（流水线第 1 步 golden --tag before）
//   --shard  k/n 只跑层级列表里下标 % n == k-1 的层，SwiftShader 慢时多开几个进程并行
// 退出码：有 FAIL / 生成异常 / 页面报错为 1；比对模式下选中的层全都没有基线为 3（tests/all.mjs 据此标"无基线跳过"）；否则 0。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 1;
const SEED = 12345;
const RADIUS = 2;          // 5×5：cx、cz ∈ -2..2
const SPAWN_FACTOR = 1;    // "正常后室"满额：表里每种实体都尽量刷得出来，落点覆盖面最大
const QUALITY = 'high';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
// --tag <名>：流水线第 1 步"改动前跑 golden --tag before"——把当前结果拍成快照写到 tests/output/golden-tags/<名>/，不碰入库基线；
// --against <名>：改完代码后拿这份快照当基线比对，看白名单外的层是不是逐字节没变。两者只是 --update --out / --out 的简写
const TAG = arg('tag', null);
const AGAINST = arg('against', null);
if (TAG === true || AGAINST === true || (TAG && AGAINST)) { console.log('--tag / --against 后面要跟快照名，且两者不能同时给'); process.exit(2); }
const tagDir = n => path.join(ROOT, 'tests', 'output', 'golden-tags', String(n));
const UPDATE = !!arg('update', false) || !!TAG;
const OUT_DIR = TAG ? tagDir(TAG) : AGAINST ? tagDir(AGAINST) : path.resolve(ROOT, String(arg('out', 'tests/golden')));
const DUMP_DIR = path.resolve(ROOT, String(arg('dump', 'tests/output/golden-current')));
const LEVELS_ARG = arg('levels', null);
const SHARD = (() => {
  const s = arg('shard', null);
  if (!s || s === true) return null;
  const m = /^(\d+)\/(\d+)$/.exec(String(s));
  if (!m || +m[1] < 1 || +m[1] > +m[2]) { console.log('--shard 格式是 k/n（1 ≤ k ≤ n）'); process.exit(2); }
  return { k: +m[1], n: +m[2] };
})();

// ---------- 静态服务（照 tests/smoke.mjs） ----------
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
let curTag = 'boot';
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) console.log('FAIL ' + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}

// ---------- 页面内：进层级 ----------
// 挂钩抓 world 传给 buildChunk 的 ctx：world 的 S.ctx 不公开，而层级 enter 可能把全层预算数据挂在闭包/ctx 上，
// 自己拼一个字段相同的 ctx 在今天等价，但抓真的才能保证以后 world 往 ctx 里加字段时金样仍然走同一条路
function pageEnter({ id, seed, quality }) {
  const lv = BR.levels.get(id);
  if (!lv) return { ok: false, error: '没有注册层级 ' + id };
  const G = window.__golden;
  G.ctx = null;
  G.orig = lv.buildChunk;
  lv.buildChunk = function (ctx) { if (!G.ctx) G.ctx = ctx; return G.orig.apply(this, arguments); };
  __br.setAuto(false);
  __br.start({ mode: 'test', levelId: id, seed, settings: { quality, visibility: 1 } });
  return { ok: true };
}

// ---------- 页面内：直接生成 5×5 区块并规范化 ----------
function pageExtract({ id, radius, spawnFactor, quality }) {
  const G = window.__golden;
  const lv = BR.levels.get(id);
  if (G.orig) { lv.buildChunk = G.orig; G.orig = null; }
  const U = BR.util;
  if (BR.game.levelId !== id || !BR.world.current) return { ok: false, error: '没能进入层级 ' + id + '（当前 ' + BR.game.levelId + '）' };
  if (!BR.game.settings || BR.game.settings.quality !== quality) return { ok: false, error: '画质不是 ' + quality + '：' + JSON.stringify(BR.game.settings) };
  const levelSeed = BR.world.levelSeed;
  const ctx = G.ctx || { THREE, BR, level: BR.world.current, levelSeed, assets: BR.assets, game: BR.game, scene: BR.gfx && BR.gfx.scene };

  const num = v => typeof v === 'number';
  const r3 = v => {
    if (!num(v)) return v;
    if (Number.isFinite(v)) { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }   // -0 与 0 统一
    return v > 0 ? 'Inf' : v < 0 ? '-Inf' : 'NaN';
  };
  const validPoint = o => !!o && Number.isFinite(o.x) && Number.isFinite(o.z);
  // 除已知字段外的标量字段按 key 排序附上：以后 kit 给碰撞体/出生点加标记（比如 safe、noLos）也会被金样看到
  const extras = (o, skip) => {
    const ks = Object.keys(o).filter(k => !skip.has(k) && o[k] != null && typeof o[k] !== 'object' && typeof o[k] !== 'function').sort();
    if (!ks.length) return null;
    const e = {};
    for (const k of ks) e[k] = r3(o[k]);
    return e;
  };
  const SOLID_KEYS = new Set(['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ']);
  const POINT_KEYS = new Set(['x', 'y', 'z']);
  const matKey = m => {
    if (!m) return '(none)';
    const k = G.matKeys.get(m);
    if (k) return k;
    if (m.name) return 'name:' + m.name;
    return m.type + (m.color ? '#' + m.color.getHexString() : '');
  };
  // 与 world.js disposeGroup 相同：只释放区块独有几何，共享材质不动
  const disposeGroup = root => {
    const geos = new Set(), mats = new Set();
    root.traverse(o => {
      const g = o.geometry;
      if (g && typeof g.dispose === 'function' && !(g.userData && g.userData.shared)) geos.add(g);
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mm of list) if (mm && mm.userData && mm.userData.chunkOwned) mats.add(mm);
    });
    geos.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
  };

  // world 围着出生点建好的块：碰撞体先摘掉（最后原样挂回），实体落点只看这 25 块
  const worldChunks = BR.world.chunks();
  for (const c of worldChunks) BR.phys.removeSolids(c.key);

  const built = [];
  try {
    for (let cz = -radius; cz <= radius; cz++) {
      for (let cx = -radius; cx <= radius; cx++) {
        const key = cx + ',' + cz;
        const rec = { cx, cz };
        let res = null;
        try { res = lv.buildChunk(ctx, cx, cz, U.rng(levelSeed, cx, cz)); }
        catch (err) { rec.error = String((err && err.stack) || err).split('\n').slice(0, 2).join(' | '); }
        res = res || {};

        const group = res.group && res.group.isObject3D ? res.group : null;
        const meshes = [];
        let verts = 0;
        const matSet = new Set();
        if (group) {
          group.updateMatrixWorld(true);
          group.traverse(o => {
            if (!o.geometry) return;
            const pos = o.geometry.attributes && o.geometry.attributes.position;
            const v = pos ? pos.count : 0;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            const keys = list.map(matKey);
            keys.forEach(k => matSet.add(k));
            const row = [keys.join('+'), v];
            if (o.isInstancedMesh) row.push('inst', o.count);
            else if (!o.isMesh) row.push(o.type);
            meshes.push(row);
            verts += v;
          });
        }
        rec.verts = verts;
        rec.mats = Array.from(matSet).sort();
        rec.meshes = meshes;

        const solidsRaw = Array.isArray(res.solids) ? res.solids : [];
        rec.solids = solidsRaw.filter(Boolean).map(s => {
          const row = [r3(s.minX), r3(s.minY), r3(s.minZ), r3(s.maxX), r3(s.maxY), r3(s.maxZ)];
          const e = extras(s, SOLID_KEYS);
          if (e) row.push(e);
          return row;
        });

        const pts = (Array.isArray(res.spawnPoints) ? res.spawnPoints : []).filter(validPoint);
        rec.spawnPoints = pts.map(p => {
          const row = [r3(p.x), r3(p.y), r3(p.z)];
          const e = extras(p, POINT_KEYS);
          if (e) row.push(e);
          return row;
        });

        const exits = (Array.isArray(res.exits) ? res.exits : []).filter(e => validPoint(e) && e.to != null);
        rec.exits = exits.map(e => {
          const o = { x: r3(e.x) };
          if (num(e.y)) o.y = r3(e.y);
          o.z = r3(e.z);
          o.to = String(e.to);
          o.kind = e.kind || 'zone';
          o.sealed = e.sealed === true;
          if (num(e.radius)) o.radius = r3(e.radius);
          if (e.active !== undefined) o.active = !!e.active;
          return o;
        });

        if (solidsRaw.length) BR.phys.addSolids('golden|' + key, solidsRaw);
        built.push({ key, cx, cz, res, group, pts, rec });
      }
    }

    // 实体：全部 25 块碰撞体都登记后再放，块边上的落点和游戏里邻块已载入时一致
    const sf0 = BR.game.spawnFactor;
    BR.game.spawnFactor = spawnFactor;
    try {
      for (const b of built) {
        BR.entities.clear();
        let list = [];
        if (b.pts.length) {
          try { list = BR.entities.spawnForChunk(lv, b.key, b.pts, U.rng(levelSeed, b.cx, b.cz, 'entities')) || []; }
          catch (err) { b.rec.entityError = String((err && err.message) || err); }
        }
        b.rec.entities = list.map(e => [e.type, r3(e.x), r3(e.z)]);
      }
    } finally {
      BR.entities.clear();
      BR.game.spawnFactor = sf0;
    }
  } finally {
    for (const b of built) {
      BR.phys.removeSolids('golden|' + b.key);
      if (b.group) { try { disposeGroup(b.group); } catch (e) { /* 释放失败不影响数据 */ } }
      if (typeof b.res.dispose === 'function') { try { b.res.dispose(); } catch (e) { /* 同上 */ } }
    }
    for (const c of worldChunks) if (c.solids && c.solids.length) BR.phys.addSolids(c.key, c.solids);
  }

  // entityError 只在出错时才有：放在最后，平时不出现在 JSON 里
  const chunks = built.map(b => {
    const r = b.rec;
    const o = { cx: r.cx, cz: r.cz, verts: r.verts, mats: r.mats, meshes: r.meshes, solids: r.solids, spawnPoints: r.spawnPoints, exits: r.exits, entities: r.entities || [] };
    if (r.error) o.error = r.error;
    if (r.entityError) o.entityError = r.entityError;
    return o;
  });
  return { ok: true, id, levelSeed, chunkSize: BR.world.chunkSize, ctxCaptured: !!G.ctx, chunks };
}

// ---------- 规范化 / 哈希 / 格式 ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function makeDoc(r) {
  const chunks = r.chunks.map(c => {
    const { cx, cz, ...rest } = c;
    return Object.assign({ cx, cz, hash: sha(JSON.stringify(c)).slice(0, 16) }, rest);
  });
  const doc = {
    schema: SCHEMA, level: r.id, seed: SEED, quality: QUALITY, spawnFactor: SPAWN_FACTOR,
    radius: RADIUS, chunkSize: r.chunkSize, hash: '', chunks,
  };
  doc.hash = docHash(doc);
  return doc;
}
// 哈希覆盖生成参数 + 全部区块数据（不含每块的 hash 字段本身）
function docHash(doc) {
  const body = {
    schema: doc.schema, level: doc.level, seed: doc.seed, quality: doc.quality, spawnFactor: doc.spawnFactor,
    radius: doc.radius, chunkSize: doc.chunkSize,
    chunks: doc.chunks.map(c => { const { hash, ...rest } = c; return rest; }),
  };
  return sha(JSON.stringify(body));
}

// 每块一个对象、长列表一行一项：基线进 git 后 diff 能直接看出哪块哪一项变了
function formatDoc(doc) {
  const L = [];
  L.push('{');
  for (const k of ['schema', 'level', 'seed', 'quality', 'spawnFactor', 'radius', 'chunkSize', 'hash']) L.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(doc[k]) + ',');
  L.push('  "chunks": [');
  doc.chunks.forEach((c, ci) => {
    L.push('    {');
    const keys = Object.keys(c);
    keys.forEach((k, ki) => {
      const comma = ki < keys.length - 1 ? ',' : '';
      const v = c[k];
      if (Array.isArray(v) && v.length && ['meshes', 'solids', 'spawnPoints', 'exits', 'entities'].includes(k)) {
        L.push('      ' + JSON.stringify(k) + ': [');
        v.forEach((it, i) => L.push('        ' + JSON.stringify(it) + (i < v.length - 1 ? ',' : '')));
        L.push('      ]' + comma);
      } else {
        L.push('      ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + comma);
      }
    });
    L.push('    }' + (ci < doc.chunks.length - 1 ? ',' : ''));
  });
  L.push('  ]');
  L.push('}');
  return L.join('\n') + '\n';
}

function stats(doc) {
  let verts = 0, solids = 0, exits = 0, ents = 0, pts = 0;
  for (const c of doc.chunks) { verts += c.verts; solids += c.solids.length; exits += c.exits.length; ents += c.entities.length; pts += c.spawnPoints.length; }
  return `${doc.chunks.length} 块，顶点 ${verts}，碰撞体 ${solids}，出生点 ${pts}，出口 ${exits}，实体 ${ents}`;
}

// ---------- 差异摘要 ----------
const short = v => { const s = JSON.stringify(v); return s.length > 110 ? s.slice(0, 107) + '…' : s; };
// 列表按多重集合比：数出多了哪些、少了哪些，各给第一条样例
function listDiff(a, b) {
  const count = new Map();
  for (const x of a) { const k = JSON.stringify(x); count.set(k, (count.get(k) || 0) + 1); }
  const added = [];
  for (const x of b) {
    const k = JSON.stringify(x);
    const n = count.get(k) || 0;
    if (n > 0) count.set(k, n - 1); else added.push(x);
  }
  const removed = [];
  count.forEach((n, k) => { for (let i = 0; i < n; i++) removed.push(JSON.parse(k)); });
  return { added, removed };
}
function chunkDiff(o, n) {
  const out = [];
  if (o.error !== n.error) out.push(`生成异常 ${short(o.error || null)} → ${short(n.error || null)}`);
  if (o.entityError !== n.entityError) out.push(`实体异常 ${short(o.entityError || null)} → ${short(n.entityError || null)}`);
  if (o.verts !== n.verts) out.push(`顶点 ${o.verts} → ${n.verts}`);
  if (JSON.stringify(o.mats) !== JSON.stringify(n.mats)) {
    const d = listDiff(o.mats, n.mats);
    out.push(`材质 +${short(d.added)} -${short(d.removed)}`);
  }
  for (const k of ['meshes', 'solids', 'spawnPoints', 'exits', 'entities']) {
    const a = o[k] || [], b = n[k] || [];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const d = listDiff(a, b);
    let s = `${k} ${a.length} → ${b.length}`;
    if (!d.added.length && !d.removed.length) s += '（内容相同、顺序变了）';
    else {
      s += `（+${d.added.length} -${d.removed.length}）`;
      if (d.removed.length) s += ' 少了 ' + short(d.removed[0]);
      if (d.added.length) s += ' 多了 ' + short(d.added[0]);
    }
    out.push(s);
  }
  return out;
}
function docDiff(base, cur) {
  const lines = [];
  for (const k of ['schema', 'seed', 'quality', 'spawnFactor', 'radius', 'chunkSize']) {
    if (base[k] !== cur[k]) lines.push(`参数 ${k}：${JSON.stringify(base[k])} → ${JSON.stringify(cur[k])}`);
  }
  const bm = new Map(base.chunks.map(c => [c.cx + ',' + c.cz, c]));
  const cm = new Map(cur.chunks.map(c => [c.cx + ',' + c.cz, c]));
  const changed = [];
  // 按内容比，不信基线里存的每块 hash：基线被手改过时存的 hash 是旧的，会把改动藏起来
  const body = c => { const { hash, ...rest } = c; return JSON.stringify(rest); };
  for (const [k, c] of cm) {
    const b = bm.get(k);
    if (!b) { changed.push(`块 ${k}：基线里没有`); continue; }
    if (body(b) === body(c)) continue;
    changed.push(`块 ${k}：` + (chunkDiff(b, c).join('；') || '哈希不同（字段级比较未发现差异，可能是基线被手改）'));
  }
  for (const k of bm.keys()) if (!cm.has(k)) changed.push(`块 ${k}：本次没有生成`);
  const MAX = 8;
  lines.push(...changed.slice(0, MAX));
  if (changed.length > MAX) lines.push(`…另有 ${changed.length - MAX} 块不同`);
  lines.unshift(`${changed.length}/${cur.chunks.length} 块不同`);
  return lines;
}

// ---------- 主流程 ----------
async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let noBaseline = 0, compared = 0;
  const t0 = Date.now();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('console', m => { if (m.type() === 'error') errors.push('[' + curTag + '] console.error: ' + m.text()); });
    page.on('pageerror', e => errors.push('[' + curTag + '] pageerror: ' + (e.stack || e.message)));
    // 联机信令服务器绝不能打线上
    await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
    await page.goto(base + 'index.html');
    await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
    await page.evaluate(() => BR.assets.init());
    await page.waitForTimeout(400);
    // 材质 key 登记：包一层 BR.assets.material，缓存命中也记（同一个材质对象不管谁先建都能查到 key）
    await page.evaluate(() => {
      const G = window.__golden = { matKeys: new WeakMap(), ctx: null, orig: null };
      const A = BR.assets;
      const orig = A.material;
      A.material = function (key, factory) {
        const m = orig.call(this, key, factory);
        if (m && typeof m === 'object' && !G.matKeys.has(m)) G.matKeys.set(m, String(key));
        return m;
      };
    });

    const order = await page.evaluate(() => (BR.LEVEL_ORDER || []).map(String));
    let levels = LEVELS_ARG && LEVELS_ARG !== true ? String(LEVELS_ARG).split(',').map(s => s.trim()).filter(Boolean) : order;
    if (SHARD) levels = levels.filter((_, i) => i % SHARD.n === SHARD.k - 1);
    console.log(`golden ${UPDATE ? '更新基线' : '比对'}：${levels.length} 层 [${levels.join(', ')}]，种子 ${SEED}，画质 ${QUALITY}，区块 ${-RADIUS}..${RADIUS}，基线目录 ${path.relative(ROOT, OUT_DIR) || '.'}`);
    fs.mkdirSync(UPDATE ? OUT_DIR : DUMP_DIR, { recursive: true });

    for (const id of levels) {
      curTag = 'L' + id;
      const lt = Date.now();
      const errBefore = errors.length;
      if (await page.evaluate(() => BR.game.screen !== 'home')) {
        await page.evaluate(() => BR.bus.emit('game:home'));
        await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 15000 });
      }
      const enter = await page.evaluate(pageEnter, { id, seed: SEED, quality: QUALITY });
      if (!enter.ok) { check('golden ' + id + '：进入层级', false, enter.error); continue; }
      try {
        await page.waitForFunction(lid => BR.game.screen === 'playing' && BR.game.levelId === lid && BR.world && BR.world.current, id, { timeout: 60000 });
      } catch (err) {
        await page.evaluate(lid => { const G = window.__golden, lv = BR.levels.get(lid); if (G.orig && lv) { lv.buildChunk = G.orig; G.orig = null; } }, id).catch(() => {});
        check('golden ' + id + '：进入层级', false, String(err.message || err));
        continue;
      }
      const r = await page.evaluate(pageExtract, { id, radius: RADIUS, spawnFactor: SPAWN_FACTOR, quality: QUALITY });
      if (!r.ok) { check('golden ' + id + '：生成', false, r.error); continue; }
      if (!r.ctxCaptured) console.log(`  注意 L${id}：没抓到 world 的 ctx，改用同字段自拼 ctx`);
      const doc = makeDoc(r);
      const genErrs = doc.chunks.filter(c => c.error || c.entityError).map(c => `${c.cx},${c.cz}: ${c.error || c.entityError}`);
      check('golden ' + id + '：区块生成与实体投放没有异常', genErrs.length === 0, genErrs.slice(0, 3));
      const newErrs = errors.length - errBefore;
      const secs = ((Date.now() - lt) / 1000).toFixed(1);
      const file = path.join(OUT_DIR, id + '.json');

      if (UPDATE) {
        const text = formatDoc(doc);
        const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        fs.writeFileSync(file, text);
        const what = prev == null ? '新建' : prev === text ? '未变' : '已更新';
        check('golden ' + id + '：写入基线', true);
        console.log(`UPDATE L${id}  ${what} ${path.relative(ROOT, file)}  hash ${doc.hash.slice(0, 16)}  (${stats(doc)}，${(text.length / 1024).toFixed(0)} KB，${secs}s${newErrs ? '，页面报错 ' + newErrs : ''})`);
        continue;
      }

      fs.writeFileSync(path.join(DUMP_DIR, id + '.json'), formatDoc(doc));
      if (!fs.existsSync(file)) {
        noBaseline++;
        console.log(`SKIP L${id}  无基线 ${path.relative(ROOT, file)}  hash ${doc.hash.slice(0, 16)}  (${stats(doc)}，${secs}s)`);
        continue;
      }
      compared++;
      let baseDoc = null;
      try { baseDoc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { check('golden ' + id + '：基线可读', false, String(err.message)); continue; }
      if (baseDoc.hash !== docHash(baseDoc)) console.log(`  注意 L${id}：基线文件的 hash 与内容对不上（被手改过？），按内容比对`);
      const same = baseDoc.schema === SCHEMA && docHash(baseDoc) === doc.hash;
      results.push({ name: 'golden ' + id, ok: same });
      if (same) {
        console.log(`PASS L${id}  hash ${doc.hash.slice(0, 16)}  (${stats(doc)}，${secs}s)`);
      } else {
        console.log(`FAIL L${id}  hash ${docHash(baseDoc).slice(0, 16)} → ${doc.hash.slice(0, 16)}  (${stats(doc)}，${secs}s)`);
        if (baseDoc.schema !== SCHEMA) console.log(`    基线格式版本 ${baseDoc.schema}，当前 ${SCHEMA}：需要 --update 重建`);
        else for (const line of docDiff(baseDoc, doc)) console.log('    ' + line);
      }
    }
    if (await page.evaluate(() => BR.game.screen !== 'home')) await page.evaluate(() => BR.bus.emit('game:home'));
  } catch (err) {
    check('golden 流程未中断', false, String((err && err.stack) || err));
  }

  // 先出汇总、再关浏览器：Chrome 退出后遗留的 chrome_crashpad_handler 会占着它的 stdio 管道，
  // Playwright 的 browser.close() 要等管道关上才返回——实测 18 s 能跑完的比对被拖到 312 s。
  // 所以汇总先打印，关浏览器最多等 15 s，然后显式 process.exit（Playwright 的 exit 钩子会同步删临时 profile）
  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  if (!UPDATE) console.log(`比对 ${compared} 层，无基线 ${noBaseline} 层${compared === 0 && noBaseline > 0 ? '（无基线）' : ''}；当前结果写在 ${path.relative(ROOT, DUMP_DIR)}`);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + (f.detail !== undefined ? '  ' + JSON.stringify(f.detail) : ''));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors.slice(0, 30)) console.log('  ' + e);
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const code = failed.length || errors.length ? 1 : (!UPDATE && compared === 0 && noBaseline > 0) ? 3 : 0;
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 15000))]);
  srv.close();
  process.exit(code);
}

main();
