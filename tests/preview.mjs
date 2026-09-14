// 后室 · 实体预览与验收（给实体代理用：代理不能开 Browser pane，靠这个脚本截图 + 打印行为日志）
//
//   node tests/preview.mjs --entity <type>[,<type>...] [--with test_dummy,_dev_friendly] [--seconds 15] [--dist 5]
//                          [--mode test|nightmare] [--level dev] [--out tests/output/preview]
//   node tests/preview.mjs --arch      BR.arch 地基自检：十个骨架各跑一场 + 全部构件三角面/外观 + 噩梦模式打玩家 + 28 只实体的 AI/动画耗时
//   node tests/preview.mjs --level-shots <id> [--mode test|casual|nightmare] [--shots N] [--out dir]
//                          进层看关：出生点四个朝向 + N 个 spawnPoints/出口附近各一张，打印 draw call/三角面/区块/实体/物品/出口/env
//   node tests/preview.mjs --scale <id>        数量比例自检：游玩满格与噩梦四档的期望实体总数比值应为 0.5:0:0.2:0.4:0.6
//   node tests/preview.mjs --gallery all|<type,type..> --tag <name> [--quality high,low] [--shard k/n] [--resume] [--size 640]
//                          [--out tests/output/gallery]
//                          打磨出图：摄影棚（中性灰、关雾、环境光 0.55、一盏固定主光）里每类型 6 张 + gallery.json（三角面/draw call/
//                          材质/bbox/图元/tint，high 超 4000 面或 5 个 draw call 判 FAIL，tools/polish/budget-exceptions.json 里的判 KNOWN）
//                          输出 <out>/<tag>/<type>-<n>-<view>.png；分片并行时各进程加锁合并同一份 gallery.json；--resume 跳过已齐的类型
//   node tests/preview.mjs --stress <type> [--count 28] [--level 3] [--frames 60] [--tag <name>] [--out tests/output/gallery]
//                          同屏放 count 只，固定步进测 renderer.info.render.calls 与平均帧时间（先测空场基线再测满载），写 json + 一张截图
//
// 所有模式启动时都会自动扫描 js/levels/L*.js、js/entities/*.js、js/items/*.js，把 index.html 里还没登记的脚本
// 按"层级工具库之后 / 实体骨架之后 / js/items/_effects.js 之后"的顺序注入（下划线开头的支持文件在同组里排最前）：
// 这批脚本文件在写完之后、进 index.html 之前，都要靠这个自动注入才能被预览测到。
//
// 流程：本地静态服务 + 无头 Chrome（SwiftShader）→ __br.start 进测试模式（缺省 dev 层）→ __br.setAuto(false)，用 __br.step 精确推进。
//   1) 单独放出实体：正面 / 侧面 / 背面特写，再等它走起来截一张侧面（看步态）；
//   2) 在它周围 --dist 米、有视线的空位放出 --with 的实体，跑 --seconds 秒：它第一次出手、第一次挨打、打死对方、自己倒地各截一张，最后一张收尾；
//   3) 打印 JSON 汇总（行首 PREVIEW_JSON）：各方状态停留秒数与序列、血量、击杀、玩家是否挨打、三角面 / draw call / 材质数、console 报错与 [arch] 警告。
// 截图写到 --out（缺省 tests/output/preview/<type>-N-<镜头>.png），直接用 Read 看。退出码：页面报错或 --arch 有失败项时为 1。
// 为什么要 setAuto(false)：无头浏览器 rAF 很慢且会被节流，按真实时间推进时同一段脚本每次跑出来的战斗都不一样，没法对照截图
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
// 打磨出图（--gallery / --stress）缺省输出到 tests/output/gallery，tools/polish/sheet.sh 也按这个目录找图
const GALLERY_MODE = !!(arg('gallery') || arg('stress'));
const OUT = path.resolve(ROOT, String(arg('out', GALLERY_MODE ? 'tests/output/gallery' : 'tests/output/preview')));
const LEVEL = String(arg('level', 'dev'));
const VIEW = { width: 960, height: 640 };   // SwiftShader 软渲染，分辨率大了每一步都慢
fs.mkdirSync(OUT, { recursive: true });

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

// ---------- 自动注入还没进 index.html 的脚本 ----------
// 每批实体/物品/层级文件写完、还没手工加进 index.html 之前，靠这个扫描 + addScriptTag 让预览能测到。
// 三组各自的"工具库"（_kit.js / _archetypes.js / _effects.js）已经在 index.html 里；
// 组内如果工具库本身也缺（比如 js/items/_kit.js、_effects.js 目前都还没登记），下划线开头的文件在同组里排最前，
// 保证 canned_food.js 这类"需要先加载 _kit.js"的文件不会抢在前面执行。
const SCRIPT_GROUPS = [
  { dir: 'js/levels', match: /^L.*\.js$/ },     // 只扫真正的层级文件（L0.js/Ldev.js…），不碰 _kit.js
  { dir: 'js/entities', match: /\.js$/ },
  { dir: 'js/items', match: /\.js$/ },
];
function scanMissingScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const already = new Set();
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) already.add(m[1]);
  const groups = SCRIPT_GROUPS.map(({ dir, match }) => {
    const abs = path.join(ROOT, dir);
    const files = fs.existsSync(abs) ? fs.readdirSync(abs) : [];
    const rel = files.filter(f => match.test(f)).map(f => dir + '/' + f).filter(p => !already.has(p));
    rel.sort((a, b) => {
      const ba = path.basename(a), bb = path.basename(b);
      const ua = ba.startsWith('_') ? 0 : 1, ub = bb.startsWith('_') ? 0 : 1;
      return ua - ub || ba.localeCompare(bb);
    });
    return rel;
  });
  return groups.flat();
}
async function injectMissingScripts(page) {
  const files = scanMissingScripts();
  for (const rel of files) await page.addScriptTag({ path: path.join(ROOT, rel) });
  if (files.length) console.log('[preview] 自动注入 ' + files.length + ' 个脚本：' + files.join('、'));
  return files;
}

// ---------- 记录 ----------
const errors = [];
const warns = [];
const shots = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}

// =====================================================================
// 页面里的帮助函数（整段序列化进页面执行，不能引用 node 这边的变量）
// =====================================================================
function installHelpers() {
  const H = window.__pv = {};
  const TAU = Math.PI * 2;
  const get = id => (id && typeof id === 'object') ? id : BR.entities.get(id);

  H.hideUi = () => {
    if (document.getElementById('pv-style')) return;
    const s = document.createElement('style');
    s.id = 'pv-style';
    s.textContent = '#ui{display:none!important}';   // 截图只看实体，HUD / toast / 准星都挡画面
    document.head.appendChild(s);
  };
  H.ground = (x, z) => (BR.phys && typeof BR.phys.groundY === 'function' ? BR.phys.groundY(x, z) : 0);
  H.free = (x, z, r, h) => !BR.phys.overlapCircle(x, z, r, H.ground(x, z), h || 1.8);
  // 离已有实体够远（放两只叠在一起，分离力会把它们弹开，第一帧的截图就乱了）
  H.clearOf = (x, z, r) => BR.entities.list.every(o => o.removed || Math.hypot(o.x - x, o.z - z) > r + (o.r || 0.4) + 0.3);
  // 以 (cx, cz) 为中心螺旋找一块 clear 半径内没有墙的空地
  H.openSpot = (cx, cz, clear, maxR) => {
    for (let rad = 0; rad <= maxR; rad += 0.6) {
      const n = rad === 0 ? 1 : Math.max(8, Math.round(rad * 5));
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
        if (H.free(x, z, clear, 2)) return { x, z, y: H.ground(x, z) };
      }
    }
    return null;
  };
  // 离 (cx, cz) 约 dist 米、和中心之间有视线、不压着别的实体的落脚点
  H.ringSpot = (cx, cz, dist, r, h, a0) => {
    const gy0 = H.ground(cx, cz);
    for (const k of [1, 0.8, 1.25, 0.6, 1.6, 0.45, 2]) {
      const d = dist * k;
      for (let i = 0; i < 24; i++) {
        const a = (a0 || 0) + i / 24 * TAU;
        const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
        if (!H.free(x, z, r + 0.1, h)) continue;
        if (!H.clearOf(x, z, r)) continue;
        if (!BR.phys.los(cx, gy0 + 1, cz, x, H.ground(x, z) + 1, z)) continue;
        return { x, z, y: H.ground(x, z) };
      }
    }
    return null;
  };
  H.spots = (cx, cz, n, r, maxR) => {
    const out = [];
    for (let rad = 1.5; rad <= maxR && out.length < n; rad += 1.2) {
      const k = Math.max(6, Math.round(rad * 3));
      for (let i = 0; i < k && out.length < n; i++) {
        const a = i / k * TAU + rad;
        const x = cx + Math.sin(a) * rad, z = cz + Math.cos(a) * rad;
        if (H.free(x, z, r, 1.8)) out.push({ x, z, y: H.ground(x, z) });
      }
    }
    return out;
  };

  H.defSummary = d => {
    const pick = o => (o == null ? null : JSON.parse(JSON.stringify(o)));
    return {
      type: d.type, zh: d.zh, version: d.version, faction: d.faction, hp: d.hp, radius: d.radius, height: d.height,
      speed: pick(d.speed), perception: pick(d.perception), attack: pick(d.attack), aura: pick(d.aura), sounds: pick(d.sounds),
      corpseSec: d.corpseSec, archBrain: !!d.archBrain, anim: d.anim ? Object.keys(d.anim) : null,
    };
  };
  H.modelStats = obj => {
    let meshes = 0, draws = 0;
    const mats = new Set();
    obj.updateMatrixWorld(true);
    obj.traverse(o => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      for (let p = o; p; p = p.parent) { if (!p.visible) return; if (p === obj) break; }
      meshes++;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => m && mats.add(m.uuid));
      draws += Array.isArray(o.material) && o.geometry && o.geometry.groups.length ? o.geometry.groups.length : 1;
    });
    const tris = BR.arch && typeof BR.arch.trisOf === 'function' ? BR.arch.trisOf(obj) : null;
    return { tris, visibleMeshes: meshes, drawCalls: draws, materials: mats.size };
  };

  // ---------- 机位 ----------
  // 相机直接摆（不动玩家）：setAuto(false) 后 rAF 只渲染不跑逻辑，摆好的相机会一直保持到下一次 step
  H.look = (px, py, pz, tx, ty, tz) => {
    const cam = BR.gfx.camera;
    const dx = tx - px, dy = ty - py, dz = tz - pz;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
    cam.position.set(px, py, pz);
    cam.updateMatrixWorld();
    BR.gfx.render(0);
    return true;
  };
  H.bounds = e => {
    const box = new THREE.Box3();
    if (e.obj) { e.obj.updateMatrixWorld(true); box.setFromObject(e.obj); }
    if (!e.obj || box.isEmpty()) {
      const h = e.h || 1.6;
      box.min.set(e.x - 0.4, e.y, e.z - 0.4); box.max.set(e.x + 0.4, e.y + h, e.z + 0.4);
    }
    return { c: box.getCenter(new THREE.Vector3()), s: box.getSize(new THREE.Vector3()) };
  };
  // angle 以实体朝向为基准：0 正面、π/2 侧面、π 背面（本项目模型面朝 -Z，yaw 方向的前方 = (-sin, -cos)）
  H.orbit = (id, angle, distMul) => {
    const e = get(id);
    if (!e) return { ok: false, error: 'gone' };
    const { c, s } = H.bounds(e);
    const dim = Math.max(s.x, s.y, s.z, 0.3);
    const flat = s.y < 0.35;
    const yaw = e.yaw + (angle || 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const base = Math.max(1.3, Math.min(7, dim * 1.7 + 0.5)) * (distMul || 1);
    const camY = flat ? e.y + 1.6 : Math.min(e.y + 2.3, Math.max(e.y + 0.3, c.y + s.y * 0.12));
    for (const k of [1, 0.8, 0.62, 0.48, 0.36]) {
      const d = base * k, px = c.x + fx * d, pz = c.z + fz * d;
      if (BR.phys.overlapCircle(px, pz, 0.15, H.ground(px, pz) + 0.05, 2.2)) continue;
      if (!BR.phys.los(px, camY, pz, c.x, c.y, c.z)) continue;
      H.look(px, camY, pz, c.x, c.y, c.z);
      return { ok: true, dist: +d.toFixed(2) };
    }
    const d = base * 0.36;
    H.look(c.x + fx * d, camY, c.z + fz * d, c.x, c.y, c.z);
    return { ok: false, dist: +d.toFixed(2), note: '四周被墙挡，机位贴得很近' };
  };
  // 把两只实体同时框进画面：机位在两者连线的垂直方向，找看得见两边的位置
  H.frame = (a, b) => {
    const ca = H.bounds(a).c, cb = H.bounds(b).c;
    const mx = (ca.x + cb.x) / 2, mz = (ca.z + cb.z) / 2, ty = (ca.y + cb.y) / 2;
    const span = Math.hypot(ca.x - cb.x, ca.z - cb.z);
    const perp = Math.atan2(cb.x - ca.x, cb.z - ca.z) + Math.PI / 2;
    const base = Math.max(2.6, span * 0.85 + 2.2);
    for (const k of [1, 0.78, 0.6, 0.45]) {
      for (let i = 0; i < 13; i++) {
        const aa = perp + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 7;
        const d = base * k, px = mx + Math.sin(aa) * d, pz = mz + Math.cos(aa) * d;
        const gy = H.ground(px, pz), py = gy + 1.85;
        if (BR.phys.overlapCircle(px, pz, 0.15, gy + 0.05, 2.2)) continue;
        if (!BR.phys.los(px, py, pz, ca.x, ca.y, ca.z) || !BR.phys.los(px, py, pz, cb.x, cb.y, cb.z)) continue;
        H.look(px, py, pz, mx, ty, mz);
        return { ok: true };
      }
    }
    return H.orbit(a, 0.6, 1.3);
  };
  H.frameNearest = id => {
    const S = H.sim, e = BR.entities.get(id);
    let best = null, bd = Infinity;
    for (const o of (S ? S.ids : [])) {
      if (o === id) continue;
      const p = BR.entities.get(o);
      if (!p) continue;
      const d = e ? Math.hypot(p.x - e.x, p.z - e.z) : 0;
      if (d < bd) { bd = d; best = p; }
    }
    if (e && best) return H.frame(e, best);
    if (e) return H.orbit(e, 0.7, 1.2);
    if (best) return H.orbit(best, 0.7, 1.2);
    return { ok: false };
  };

  // ---------- 放置 ----------
  H.reset = () => { H.untrack(); BR.entities.clear(); __br.step(0.05); return true; };
  H.place = type => {
    const def = BR.entityTypes.get(type);
    if (!def) return { ok: false, error: '没有注册实体 ' + type + '：index.html 加 script 标签了吗？文件加载时报错了吗（看 errors）？' };
    const P = BR.player;
    const r = def.radius || 0.4;
    const ax = P.x - Math.sin(P.yaw) * 4, az = P.z - Math.cos(P.yaw) * 4;
    let spot = null;
    for (const clear of [2.6, 2, 1.5, 1.1]) { spot = H.openSpot(ax, az, Math.max(clear, r + 0.2), 26); if (spot) break; }
    if (!spot) return { ok: false, error: '找不到空地' };
    let e = null;
    try { e = BR.entities.spawn(type, spot.x, spot.y, spot.z, { manual: true }); }
    catch (err) { return { ok: false, error: 'spawn 抛异常：' + (err && err.stack || err) }; }
    if (!e) return { ok: false, error: 'BR.entities.spawn 返回空（build 抛异常？看 errors）' };
    __br.step(0.05);
    return { ok: true, id: e.id, def: H.defSummary(def), model: e.obj ? H.modelStats(e.obj) : null };
  };
  H.addPartners = (id, types, dists) => {
    const e = get(id), out = [];
    types.forEach((t, i) => {
      const def = BR.entityTypes.get(t);
      if (!def) { out.push({ type: t, error: '没有注册' }); return; }
      const s = H.ringSpot(e.x, e.z, dists[i] || 5, def.radius || 0.4, def.height || 1.8, i * 2.4);
      if (!s) { out.push({ type: t, error: '周围没有有视线的空位' }); return; }
      const p = BR.entities.spawn(t, s.x, s.y, s.z, { manual: true });
      out.push(p ? { type: t, id: p.id, dist: +Math.hypot(p.x - e.x, p.z - e.z).toFixed(2) } : { type: t, error: 'spawn 返回空' });
    });
    __br.step(0.02);
    return out;
  };
  // 玩家站到实体旁边：向导跟人、噩梦模式打人都要玩家在场
  H.playerNear = (id, dist) => {
    const e = get(id), P = BR.player;
    if (!e) return false;
    const s = H.ringSpot(e.x, e.z, dist, 0.35, 1.8, 2.6);
    if (!s) return false;
    P.x = s.x; P.z = s.z; P.yaw = Math.atan2(-(e.x - s.x), -(e.z - s.z)); P.pitch = 0;
    if ('vx' in P) { P.vx = 0; P.vz = 0; }
    __br.step(0.02);
    return { x: +s.x.toFixed(2), z: +s.z.toFixed(2) };
  };
  H.hit = (targetId, amount, sourceId, fraction) => {
    const e = get(targetId);
    if (!e) return false;
    const src = sourceId ? get(sourceId) : null;
    BR.entities.damage(e, fraction ? e.maxHp * amount : amount, src);
    return { hp: e.hp };
  };
  // 把 id 硬塞到 toId 身边 d 米（测"被挤也不挪窝"的陷阱）
  H.moveNear = (id, toId, d) => {
    const e = get(id), t = get(toId);
    if (!e || !t) return false;
    e.x = t.x + d; e.z = t.z;
    __br.step(0.02);
    return true;
  };

  // ---------- 跟踪 ----------
  H.untrack = () => { if (H.sim) { H.sim.offs.forEach(f => f()); H.sim.offs = []; } };
  H.track = ids => {
    H.untrack();
    const S = H.sim = { ids: ids.slice(), rec: {}, kills: [], playerDamage: 0, dmgSources: {}, t: 0, offs: [] };
    for (const id of ids) {
      const e = BR.entities.get(id);
      if (!e) continue;
      const u = e.obj && e.obj.userData.arch;
      S.rec[id] = {
        id, type: e.type, faction: e.def.faction, hp0: e.hp, minHp: e.hp, hp: e.hp, time: {}, seq: [],
        moved: 0, lx: e.x, lz: e.z, x0: e.x, z0: e.z, maxLift: 0, forms: [], boneMin: Infinity, boneMax: -Infinity,
        swarm0: u && u.swarm ? u.swarm.mesh.count : null, swarmCount: null, removedAt: null,
      };
    }
    S.offs.push(BR.bus.on('entity:kill', p => {
      S.kills.push({ t: +S.t.toFixed(2), killerId: p.killer, killer: p.killerType || String(p.killer), victim: p.victimType || String(p.victim) });
    }));
    S.offs.push(BR.bus.on('player:damage', p => {
      S.playerDamage++;
      const s = p && p.source;
      const k = s == null ? 'null' : typeof s === 'object' ? String(s.type || (s.def && s.def.type) || s.id || 'object') : String(s);
      S.dmgSources[k] = (S.dmgSources[k] || 0) + 1;
    }));
    H.sample(0);
    return Object.keys(S.rec).length;
  };
  H.sample = dt => {
    const S = H.sim;
    if (!S) return;
    for (const id of S.ids) {
      const r = S.rec[id];
      if (!r) continue;
      const e = BR.entities.get(id);
      if (!e || e.removed) { if (r.removedAt == null) r.removedAt = +S.t.toFixed(2); continue; }
      const st = String(e.state);
      if (dt > 0) r.time[st] = +((r.time[st] || 0) + dt).toFixed(2);
      if (r.seq[r.seq.length - 1] !== st && r.seq.length < 60) r.seq.push(st);
      r.moved += Math.hypot(e.x - r.lx, e.z - r.lz); r.lx = e.x; r.lz = e.z;
      r.hp = e.hp; if (e.hp < r.minHp) r.minHp = e.hp;
      const u = e.obj && e.obj.userData && e.obj.userData.arch;
      if (u) {
        if (u.pivot) r.maxLift = Math.max(r.maxLift, u.pivot.position.y);
        if (u.formKey && r.forms.indexOf(u.formKey) < 0) r.forms.push(u.formKey);
        const bones = u.rig && u.rig.bones;
        const b = bones && (bones.legL || bones.legFL || bones.wingL || bones.spine || bones.core);
        if (b) { const v = b.rotation.x + b.rotation.z; if (v < r.boneMin) r.boneMin = v; if (v > r.boneMax) r.boneMax = v; }
        if (u.swarm) r.swarmCount = u.swarm.mesh.count;
      }
    }
  };
  H.summary = () => {
    const S = H.sim;
    const out = { t: +S.t.toFixed(2), playerDamage: S.playerDamage, dmgSources: S.dmgSources, playerHp: +BR.player.hp.toFixed(1), playerDead: !!BR.player.dead, kills: S.kills, ents: [] };
    for (const id of S.ids) {
      const r = S.rec[id];
      if (!r) continue;
      out.ents.push({
        id, type: r.type, faction: r.faction, hp0: r.hp0, minHp: +r.minHp.toFixed(1), hp: +r.hp.toFixed(1), removedAt: r.removedAt,
        moved: +r.moved.toFixed(2), displacement: +Math.hypot(r.lx - r.x0, r.lz - r.z0).toFixed(2), maxLift: +r.maxLift.toFixed(2),
        forms: r.forms, boneRange: r.boneMax > r.boneMin ? +(r.boneMax - r.boneMin).toFixed(3) : 0,
        swarm0: r.swarm0, swarmCount: r.swarmCount, seq: r.seq, time: r.time,
      });
    }
    return out;
  };
  // 推进 seconds 秒；watchId 出现 allow 里的事件（且不在 seen 里）就多走一小段让动作做到位，然后返回给 node 截图
  H.run = (seconds, watchId, seen, allow) => {
    const S = H.sim;
    let t = 0;
    const want = k => (!allow || allow.indexOf(k) >= 0) && seen.indexOf(k) < 0;
    while (t < seconds - 1e-6) {
      const dt = Math.min(0.1, seconds - t);
      const b = BR.entities.get(watchId), hpB = b && !b.dead ? b.hp : null;
      const killsB = S.kills.length;
      __br.step(dt); t += dt; S.t += dt; H.sample(dt);
      const e = BR.entities.get(watchId);
      let ev = null;
      if (want('dead') && hpB != null && (!e || e.dead || e.state === 'dead')) ev = 'dead';
      else if (e && want('attack') && e.state === 'attack') ev = 'attack';
      else if (e && want('hurt') && hpB != null && e.hp < hpB) ev = 'hurt';
      else if (want('kill') && S.kills.slice(killsB).some(k => k.killerId === watchId)) ev = 'kill';
      else if (e && allow) {
        // 'state:reveal' 这类：第一次进入某个状态（拟态现形、伏击潜伏）时截图
        for (const k of allow) { if (k.indexOf('state:') === 0 && want(k) && e.state === k.slice(6)) { ev = k; break; } }
      }
      if (ev) {
        const extra = { dead: 0.6, attack: 0.25, hurt: 0.05, kill: 0.4 }[ev] || 0.3;   // 倒地动画 0.6 s；出手动作的挥到位约在 0.25 s
        __br.step(extra); t += extra; S.t += extra; H.sample(extra);
        return { elapsed: +t.toFixed(3), event: ev };
      }
    }
    return { elapsed: +t.toFixed(3), event: null };
  };
  H.runUntilMove = (id, maxSec) => {
    const S = H.sim, e0 = get(id);
    if (!e0) return { moved: false };
    const x0 = e0.x, z0 = e0.z;
    let t = 0;
    while (t < maxSec) {
      __br.step(0.1); t += 0.1; S.t += 0.1; H.sample(0.1);
      const e = get(id);
      if (!e) return { moved: false, gone: true };
      const u = e.obj && e.obj.userData.arch;
      if ((u && u.sp > 0.35) || Math.hypot(e.x - x0, e.z - z0) > 0.6) {
        __br.step(0.15); S.t += 0.15; H.sample(0.15);
        return { moved: true, t: +t.toFixed(2), sp: u ? +(u.sp || 0).toFixed(2) : null };
      }
    }
    return { moved: false, t: +t.toFixed(2) };
  };
  H.perf = (type, n, dummies, frames) => {
    H.reset();
    const P = BR.player;
    let placed = 0;
    H.spots(P.x, P.z, n + dummies, 0.6, 24).forEach((s, i) => {
      if (BR.entities.spawn(i < n ? type : 'test_dummy', s.x, s.y, s.z, { manual: true })) placed++;
    });
    __br.step(0.5);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) BR.entities.update(1 / 30);
    const ms = (performance.now() - t0) / frames;
    return { placed, count: BR.entities.list.filter(e => !e.removed).length, msPerUpdate: +ms.toFixed(3) };
  };

  // ---------- 构件陈列（--arch） ----------
  // 放在关卡地面下 60 m：四周没有墙挡，临时补一盏半球光 + 平行光、关雾，看的是构件本身的外形
  H.gallery = row => {
    H.clearGallery();
    const A = BR.arch, T = THREE, P = BR.player, scene = BR.gfx.scene;
    const ctx = { THREE: T, BR, assets: BR.assets, game: BR.game, scene };
    const lift = (o, y) => { o.position.y = y; return o; };
    const rows = [
      [
        ['humanoid', () => A.parts.humanoid({})],
        ['thin+hunch+claws', () => A.parts.humanoid({ height: 2.2, thin: 0.9, hunch: 0.5, armLen: 1.35, head: 'faceless', claws: 3, face: { eyes: 2, smile: false, eyeShape: 'slit' } })],
        ['crawl+hair', () => A.parts.humanoid({ pose: 'crawl', hair: 0.35, claws: 2, face: { eyes: 2, smile: true } })],
        ['silhouette', () => A.parts.silhouette({ face: { eyes: 2, smile: false } })],
        ['hazmat', () => A.parts.hazmat(ctx)],
        ['rig', () => A.parts.rig('pv_totem', b => {
          b.bone('root', null, [0, 0, 0]);
          b.limb('root', 'body', [0, 0, 0], [0, 1.2, 0], 0.18, 0.1);
          b.sphere('root', 'glow', 0.08, [0, 1.3, -0.05]);
          b.chain('arm', 'root', [0, 1.0, 0], [1, 0.2, 0], 4, 0.8, 0.05, 0.01, 'body');
        }, { colors: { body: 0x6a5a48, glow: 0xff5533 } })],
      ],
      [
        ['quadruped', () => A.parts.quadruped({ mane: 0.12, ears: 0.08, eyes: { size: 0.03 } })],
        ['insect 4 wings', () => lift(A.parts.insect({ span: 1.1, wings: 4, eyes: { size: 0.04 } }), 1.0)],
        ['limbCluster', () => A.parts.limbCluster({ spread: 0.6 })],
        ['glowFace', () => lift(A.parts.glowFace({ width: 0.5 }), 1.4)],
        ['orb', () => A.parts.orb({ radius: 0.12, y: 1.2 })],
        ['decal wall', () => lift(A.parts.decal({ radius: 0.6, wall: true }), 0.9)],
        ['swarm', () => A.parts.swarm({ unit: 'moth', count: 40 }, ctx)],
      ],
    ];
    const items = rows[row] || [];
    const g = new T.Group();
    g.name = 'pv gallery';
    const bx = P.x, by = -60, bz = P.z, gap = 1.2;
    const out = [];
    const m4 = new T.Matrix4();
    items.forEach(([name, make], i) => {
      let obj = null;
      try { obj = make(); } catch (err) { out.push({ name, error: String(err && err.stack || err).slice(0, 500) }); return; }
      if (!obj || !obj.isObject3D) { out.push({ name, error: '没有返回 Object3D' }); return; }
      const holder = new T.Group();
      holder.position.set(bx + (i - (items.length - 1) / 2) * gap, by, bz);
      holder.add(obj);
      g.add(holder);
      // 佝偻、四肢着地这些是骨骼的基础姿势，由动画每帧 pose 回去；陈列没有 animate，手动摆一次
      obj.traverse(o => { if (o.userData && o.userData.rig) A.anim.pose(o.userData.rig); });
      const rec = { name, tris: A.trisOf(obj), draws: 0 };
      obj.traverse(o => {
        if (o.isInstancedMesh) { rec.draws++; return; }
        if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry) return;
        const gg = o.geometry;
        rec.draws += gg.groups && gg.groups.length ? gg.groups.length : 1;
      });
      obj.traverse(o => {
        if (!o.isInstancedMesh) return;
        const gg = o.geometry;
        rec.unitTris = gg.index ? gg.index.count / 3 : gg.attributes.position.count / 3;
        rec.instances = o.count;
        // 不是实体就没有 animate 摆位，陈列时手动散开，否则全部叠在原点
        for (let k = 0; k < o.count; k++) { m4.makeTranslation(Math.sin(k * 2.4) * 0.45, 0.4 + (k % 8) * 0.12, Math.cos(k * 2.4) * 0.45); o.setMatrixAt(k, m4); }
        o.instanceMatrix.needsUpdate = true;
      });
      out.push(rec);
    });
    const back = new T.Mesh(new T.PlaneGeometry(16, 6), new T.MeshBasicMaterial({ color: 0x8d8a80 }));
    back.position.set(bx, by + 2.4, bz + 1.6); back.rotation.y = Math.PI;
    const floor = new T.Mesh(new T.PlaneGeometry(16, 8), new T.MeshLambertMaterial({ color: 0x5b574e }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(bx, by - 0.001, bz);
    const hemi = new T.HemisphereLight(0xfff6e0, 0x3a3630, 1.1);
    const dir = new T.DirectionalLight(0xffffff, 0.7);
    dir.position.set(bx - 3, by + 5, bz - 6); dir.target.position.set(bx, by, bz);
    g.add(back, floor, hemi, dir, dir.target);
    g.userData.temp = [back, floor];
    scene.add(g);
    H._gallery = g; H._fog = scene.fog; scene.fog = null;
    H.look(bx, by + 1.3, bz - 4.6, bx, by + 0.9, bz);
    return out;
  };
  H.clearGallery = () => {
    const g = H._gallery;
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.traverse(o => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
    for (const m of g.userData.temp) { m.geometry.dispose(); m.material.dispose(); }
    BR.gfx.scene.fog = H._fog;
    H._gallery = null;
  };

  // ---------- 层级预览（--level-shots） ----------
  // 只转朝向不挪位置：出生点四个朝向那组截图用
  H.lookYaw = yaw => {
    const P = BR.player;
    P.yaw = yaw; P.pitch = 0;
    if ('vx' in P) { P.vx = 0; P.vz = 0; }
    __br.step(0.05);
    return { yaw: +P.yaw.toFixed(2) };
  };
  // 硬传送到 (x, z)，yFeet 是脚底高度（spawnPoints / 出口记录里的 y 就是脚底，不是眼高）
  H.standAt = (x, z, yFeet, yaw) => {
    const P = BR.player;
    const gy = (yFeet != null && isFinite(yFeet)) ? yFeet : H.ground(x, z);
    P.x = x; P.z = z; P.y = gy + (BR.config.player.eyeHeight || 1.6);
    P.yaw = yaw || 0; P.pitch = 0;
    if ('vx' in P) { P.vx = 0; P.vz = 0; }
    __br.step(0.05);
    return { x: +x.toFixed(2), z: +z.toFixed(2), yaw: +P.yaw.toFixed(2) };
  };
  H.playerPose = () => { const P = BR.player; return { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(2) }; };
  // 已载入区块里所有 spawnPoints + 出口，给 node 侧挑 N 个传送点用
  H.levelPoints = () => {
    const out = [];
    BR.world.chunks().forEach(c => c.spawnPoints.forEach(p => out.push({ x: p.x, y: p.y, z: p.z, tag: p.tag || null, kind: 'spawn' })));
    // sealed 判定抄 js/game/world.js 的 isSealed：sealed:true 或者目标层没注册，都算未开放
    BR.world.exits().forEach(e => out.push({ x: e.x, y: e.y, z: e.z, tag: e.kind, to: e.to, sealed: e.sealed === true || !BR.levels.has(String(e.to)), kind: 'exit' }));
    return out;
  };
  H.levelStats = () => {
    const g = BR.gfx.debugInfo(), w = BR.world.debugInfo();
    const items = {};
    BR.items.list.forEach(it => { items[it.type] = (items[it.type] || 0) + 1; });
    const exits = BR.world.exits().map(e => ({ to: e.to, kind: e.kind, sealed: e.sealed === true || !BR.levels.has(String(e.to)) }));
    const lvl = BR.world.current;
    return {
      drawCalls: g.calls, triangles: g.triangles, chunksLoaded: w.loaded,
      entities: BR.entities.list.filter(e => !e.removed).length,
      items, exits, env: lvl ? lvl.env : null,
    };
  };

  // ---------- 数量比例（--scale） ----------
  // 直接用公式汇总，不生成实体：400 个区块坐标（20×20）× 该层 entities 表，游玩满格 + 噩梦四档
  H.scaleReport = levelId => {
    const lvl = BR.levels.get(levelId);
    if (!lvl) return { ok: false, error: '没有注册层级 ' + levelId + '（js/levels/L' + levelId + '.js 加载了吗？）' };
    const area = (lvl.chunkSize > 0 ? lvl.chunkSize : 24) ** 2;
    const modes = [
      { key: 'casual', label: '游玩(滑条满)', factor: BR.computeSpawnFactor('casual', null, 1) },
      { key: 'easy', label: '噩梦-简单', factor: BR.computeSpawnFactor('nightmare', 'easy', null) },
      { key: 'medium', label: '噩梦-中等', factor: BR.computeSpawnFactor('nightmare', 'medium', null) },
      { key: 'hard', label: '噩梦-困难', factor: BR.computeSpawnFactor('nightmare', 'hard', null) },
      { key: 'hell', label: '噩梦-地狱', factor: BR.computeSpawnFactor('nightmare', 'hell', null) },
    ];
    const entities = lvl.entities || [];
    const coords = [];
    for (let cx = -10; cx < 10; cx++) for (let cz = -10; cz < 10; cz++) coords.push([cx, cz]);   // 20×20 = 400 个区块坐标
    const totals = modes.map(m => {
      let total = 0;
      for (const [cx, cz] of coords) {
        for (const e of entities) total += BR.expectedEntityCount(e.officialPer1000m2 || 0, area, m.factor);
      }
      return { key: m.key, label: m.label, factor: m.factor, total: +total.toFixed(4) };
    });
    return { ok: true, level: levelId, chunkArea: area, chunks: coords.length, entities: entities.map(e => e.type), totals };
  };
  return true;
}

// --arch 用的探针实体：每个骨架一种，数值只求把行为跑出来，不对应任何设定
function registerProbes() {
  const A = BR.arch;
  const errs = [], types = [];
  const base = (type, faction, extra) => Object.assign({
    type, en: type, zh: '探针·' + type.replace('_probe_', ''), version: 'probe', faction,
    hp: A.HP.average, radius: 0.35, height: 1.8,
    speed: { walk: A.SPEED.walk, run: A.SPEED.run },
    perception: { sight: A.SIGHT.normal, hearing: A.HEARING.normal, fov: 360 },
    attack: { hp: A.DAMAGE.light, range: 1.0, cooldown: A.COOLDOWN.normal },
    corpseSec: 1,
  }, extra);
  const R = make => {
    let d = null;
    try { d = make(); A.register(d); types.push(d.type); }
    catch (err) { errs.push((d && d.type || '?') + ': ' + (err && err.stack || err)); }
  };
  const wrap = (o, label) => A.wrap(o, { label });
  R(() => base('_probe_stalker', 'hostile', {
    brain: A.stalker({ patrol: 'wander' }), anim: { gait: 'biped', strike: 'swipe' },
    build: () => wrap(A.parts.humanoid({ height: 1.9, thin: 0.6, head: 'faceless', claws: 3 }), 'probe stalker'),
  }));
  R(() => base('_probe_pack', 'hostile', {
    radius: 0.4, height: 0.9, speed: { walk: A.SPEED.walk, run: A.SPEED.jog },
    brain: A.pack({}), anim: { gait: 'quad', strike: 'bite' },
    build: () => wrap(A.parts.quadruped({ mane: 0.1, eyes: { size: 0.03 } }), 'probe pack'),
  }));
  R(() => base('_probe_flyer', 'hostile', {
    radius: 0.3, height: 0.5,
    brain: A.flyer({ light: 'attract' }), anim: { gait: 'flyer', fly: { cruise: 1.8, low: 0.9 }, strike: 'sting' },
    build: () => wrap(A.parts.insect({ span: 1.0, wings: 4, eyes: { size: 0.03 } }), 'probe flyer'),
  }));
  R(() => base('_probe_ambush', 'hostile', {
    brain: A.ambush({ triggerRange: 4, revealRange: 7 }), anim: { gait: 'crawl', strike: 'lunge' },
    build: () => wrap(A.parts.silhouette({ height: 1.7, pose: 'crawl', face: { eyes: 2, smile: true } }), 'probe ambush'),
  }));
  R(() => base('_probe_trap', 'hostile', {
    hp: A.HP.immortal, speed: { walk: 0, run: 0 }, attack: { hp: A.DAMAGE.light, range: 1.6, cooldown: A.COOLDOWN.normal },
    brain: A.ambush({ fixed: true }), anim: { gait: 'none', strike: 'grab' },
    build: () => wrap(A.parts.limbCluster({ count: 4, length: 0.9, center: [0, 1.2, 0] }), 'probe trap'),
  }));
  R(() => base('_probe_mimic', 'hostile', {
    brain: A.mimic({ revealRange: 3, disguise: 'approach' }), anim: { gait: 'biped', strike: 'grab', stateSounds: { reveal: 'screech' } },
    build: ctx => A.wrap({
      disguise: A.parts.hazmat(ctx),
      true: A.parts.humanoid({ height: 2.0, thin: 0.9, head: 'faceless', face: { eyes: 0, teeth: 16 } }),
    }, { form: 'disguise', label: 'probe mimic' }),
  }));
  R(() => base('_probe_shy', 'hostile', {
    brain: A.lightBound(A.stalker({}), { mode: 'avoid', threshold: 0.05 }), anim: { gait: 'biped' },
    build: () => wrap(A.parts.silhouette({}), 'probe shy'),
  }));
  R(() => base('_probe_need', 'hostile', {
    brain: A.lightBound(A.stalker({}), { mode: 'need', threshold: 1.01 }), anim: { gait: 'biped' },
    build: () => wrap(A.parts.humanoid({ thin: 0.3 }), 'probe need'),
  }));
  R(() => base('_probe_wanderer', 'neutral', {
    radius: 0.4, height: 0.9, attack: { hp: A.DAMAGE.light, range: 1.0, cooldown: A.COOLDOWN.fast },
    brain: A.wanderer({ retaliate: 'fight' }), anim: { gait: 'quad', strike: 'bite' },
    build: () => wrap(A.parts.quadruped({}), 'probe wanderer'),
  }));
  R(() => base('_probe_coward', 'neutral', {
    brain: A.wanderer({ retaliate: 'flee' }), anim: { gait: 'biped' },
    build: () => wrap(A.parts.humanoid({ bulk: 0.8 }), 'probe coward'),
  }));
  R(() => base('_probe_guide', 'friendly', {
    radius: 0.25, height: 1.5, speed: { walk: A.SPEED.brisk, run: A.SPEED.run },
    attack: { hp: 0, entityHp: A.DAMAGE.medium, range: 1.3, cooldown: A.COOLDOWN.normal },
    brain: A.guide({}), anim: { gait: 'none', fly: { cruise: 1.5, low: 1.15 } },
    build: () => wrap(A.parts.orb({ radius: 0.09, halo: 0.8 }), 'probe guide'),
  }));
  R(() => base('_probe_swarm', 'hostile', {
    hp: A.HP.weak, radius: 0.6, height: 1.2, attack: { hp: A.DAMAGE.graze, range: 1.2, cooldown: A.COOLDOWN.flurry },
    brain: A.swarm({ move: 'flyer' }), anim: { gait: 'none' },
    build: ctx => wrap(A.parts.swarm({ unit: 'moth', count: 40 }, ctx), 'probe swarm'),
  }));
  R(() => base('_probe_hazard', 'hostile', {
    hp: A.HP.immortal, radius: 0.25, height: 0.2, speed: { walk: A.SPEED.crawl, run: A.SPEED.crawl },
    perception: { sight: 8, hearing: 0, fov: 360 }, attack: { hp: A.DAMAGE.graze, range: 0.3, cooldown: A.COOLDOWN.fast },
    brain: A.hazardEntity({ creep: 0.5, seekRange: 6, patch: 0.9 }), anim: { gait: 'none' },
    build: () => wrap(A.parts.decal({ radius: 0.9, color: 0x3a2f20 }), 'probe hazard'),
  }));
  return { ok: errs.length === 0, types, errs };
}

// =====================================================================
// --gallery / --stress 页面帮助函数（整段序列化进页面，不能引用 node 这边的变量）
// =====================================================================
// 图元计数钩子：用 addInitScript 在任何页面脚本之前挂上 load 监听，js/entities/_archetypes.js 一执行完就给 RigBuilder 装上。
// 为什么这么早：骨架几何按 key 全局缓存，主页兜底人形这类启动时就建好的骨架，晚装钩子就再也数不到了
function primHookInit() {
  const install = source => {
    const A = window.BR && window.BR.arch;
    if (!A || !A.RigBuilder) return false;
    if (A.RigBuilder.__pvHooked) return true;
    const P = A.RigBuilder.prototype;
    const book = window.__pvPrims = window.__pvPrims || {};
    const rec = key => book[key] || (book[key] = { prims: 0, tints: 0 });
    // box / sphere / limb / cone 最后都走 geo()，chain 每一节走一次 limb：parts.length 就是图元数
    const geo0 = P.geo;
    P.geo = function () { const r = geo0.apply(this, arguments); rec(this.key).prims = this.parts.length; return r; };
    // tint 只数最外层调用：chain 内部再调 limb / geo 时不重复计
    let depth = 0;
    ['box', 'sphere', 'limb', 'cone', 'chain', 'geo'].forEach(name => {
      const f = P[name];
      if (typeof f !== 'function') return;
      P[name] = function () {
        if (depth === 0) {
          for (let i = 0; i < arguments.length; i++) {
            const a = arguments[i];
            if (a && typeof a === 'object' && !Array.isArray(a) && !a.isBufferGeometry && a.tint != null) {
              this.__pvTints = (this.__pvTints || 0) + 1;   // 按构建器实例计：build 抛异常后重建同一个 key 不会累加
              rec(this.key).tints = this.__pvTints;
              break;
            }
          }
        }
        depth++;
        try { return f.apply(this, arguments); } finally { depth--; }
      };
    });
    A.RigBuilder.__pvHooked = true;
    if (!window.__pvPrimHookAt) window.__pvPrimHookAt = source || 'unknown';
    return true;
  };
  window.__pvInstallPrimHook = install;
  document.addEventListener('load', ev => {
    const t = ev.target;
    if (t && t.tagName === 'SCRIPT' && /\/_archetypes\.js(\?|$)/.test(t.src || '')) install('script-load');
  }, true);
}

function installGalleryHelpers() {
  const H = window.__pv;
  const T = THREE, U = BR.util;
  const G = H.gal = {};
  // 摄影棚摆在离层级内容几千米外：没有墙和天花板（飞行实体的天花板射线打空，按巡航高度摆），主相机远裁剪面也够不到任何区块
  const X0 = 4000, Z0 = 4000;
  // idle 相位：api.time 从 T0 起按 DT 走 POSE_FRAMES 帧（1 s），群体散开度、现形缩放这类阻尼量都收敛到位
  const T0 = 3, DT = 1 / 30, POSE_FRAMES = 30;
  // 背景是清屏色、原 hex 直出；地板和网格线走 sRGB 输出编码会被提亮一大截（0x6b 的地板实拍接近 0xbf，浅色实体贴地就没对比了），
  // 所以材质色给得很暗，实拍地板 ≈0x89、网格线 ≈0x78，和背景 0x7a 同一档中性灰
  const BG = 0x7a7a7a, FLOOR = 0x333333;
  // az 以实体正前方为 0（模型面朝 -Z），90 = 实体左侧；fill = 包围盒在画面里占的比例
  const VIEWS = {
    front34: { az: 35, el: 12, fill: 0.84 },
    side: { az: 90, el: 6, fill: 0.84 },
    back: { az: 180, el: 12, fill: 0.84 },
    head: { az: 20, el: 6, fill: 0.5, head: true },
    low: { az: 0, el: 10, fill: 0.84 },
  };
  // 贴地斑块（高 < 水平尺寸的 1/4）平视只剩一条线，改成俯拍
  const FLAT_EL = { front34: 50, side: 32, back: 50, head: 60, low: 50 };
  const hook = typeof window.__pvInstallPrimHook === 'function' ? window.__pvInstallPrimHook('gallery-late') : false;
  G.meta = {
    origin: [X0, 0, Z0], poseTime: T0, poseDt: +DT.toFixed(6), poseFrames: POSE_FRAMES,
    background: '#' + BG.toString(16), floor: '#' + FLOOR.toString(16) + '（0.5 m 网格）', fog: false,
    ambient: { type: 'AmbientLight', intensity: 0.55 },
    keyLight: { type: 'DirectionalLight', intensity: 0.85, offsetFromEntity: [-2.2, 4.5, -3.4] },
    fov: 30, views: VIEWS, flatElevation: FLAT_EL,
    primHook: window.__pvPrimHookAt || (hook ? 'gallery-late' : 'none'),
    determinism: '建模和摆姿势期间 Math.random 换成按类型名播种的 mulberry32；实体 id 固定为 gallery-<type>；A.wrap 的动画种子 u.seed 置 0；' +
      'api.time 固定从 ' + T0 + ' s 走 ' + POSE_FRAMES + ' 帧；层级镜头冻结灯光闪烁、重置灯池槽位后再渲染',
  };

  G.withSeed = (key, fn) => {
    const orig = Math.random;
    Math.random = U.mulberry32(U.hashStr('pv-gallery:' + key));
    try { return fn(); } finally { Math.random = orig; }
  };
  const visibleIn = (o, root) => { for (let p = o; p; p = p.parent) { if (p.visible === false) return false; if (p === root) break; } return true; };
  const trisOfGeo = g => !g ? 0 : (g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0)) / 3;
  const r3 = v => Math.round(v * 1000) / 1000;

  // 全部注册类型 + 首个出场层级（BR.LEVEL_ORDER 顺序反查各层 entities 表；dev 等不在顺序表里的层排最后）
  G.catalog = () => {
    const levels = (BR.LEVEL_ORDER || []).map(String).filter(id => BR.levels.has(id));
    BR.levels.all().forEach(l => { const id = String(l.id); if (levels.indexOf(id) < 0) levels.push(id); });
    const first = {};
    levels.forEach(id => {
      const lv = BR.levels.get(id);
      (Array.isArray(lv.entities) ? lv.entities : []).forEach(en => { if (en && en.type && first[en.type] == null) first[en.type] = id; });
    });
    const types = BR.entityTypes.all().map(d => ({
      type: String(d.type), zh: d.zh, en: d.en || null, faction: d.faction, version: d.version,
      firstLevel: first[d.type] != null ? first[d.type] : null,
    }));
    return { levels, types, primHook: G.meta.primHook };
  };

  // 灯光闪烁由 gfx 内部时钟决定，而这个时钟跟着之前 step 过多少次走：不冻结的话，同一层的镜头换个出图顺序就可能正赶上灯管熄灭。
  // 只改本页里的灯光描述对象（发光面片 linkGlow 读的是同一份），不碰任何文件
  G.freezeFlicker = () => {
    let n = 0;
    BR.world.chunks().forEach(c => (c.lights || []).forEach(L => { if (L && L.flicker > 0) { L.flicker = 0; n++; } }));
    return n;
  };
  // 灯池槽位按"历史上谁先占的"分配，槽位顺序不同 shader 里累加顺序就不同，可能差 1 个色阶：
  // 先清空再重推，全部按离相机远近重新入槽，结果只取决于相机位置
  G.resetLightPool = () => {
    const list = [];
    BR.world.chunks().forEach(c => (c.lights || []).forEach(L => list.push(L)));
    const out = BR.workshop && typeof BR.workshop.lightTransform === 'function' ? BR.workshop.lightTransform(list) : list;
    BR.gfx.setLightSources([]);
    BR.gfx.setLightSources(out);
    return list.length;
  };
  G.enterLevel = level => {
    const id = String(level);
    if (!BR.levels.has(id)) return { ok: false, error: '没有注册层级 ' + id };
    let info = null;
    // 层级 update 里偶发现象用的 Math.random 也按层级 id 播种，进同一层的状态和之前拍过什么无关
    G.withSeed('level:' + id, () => {
      __br.setAuto(false);
      __br.start({ mode: 'test', levelId: id, seed: 12345, settings: { visibility: 1, quality: 'high' } });
      if (BR.game.screen !== 'playing' || !BR.world.current) { info = { ok: false, error: '没能进入层级 ' + id }; return; }
      const frozen = G.freezeFlicker();
      __br.step(1);
      BR.game.autoSpawn = false;
      BR.entities.clear();
      G.freezeFlicker();
      __br.step(0.05);
      BR.gfx.setSanityEffect(0, true);   // 低 san 的相机抖动是直接加在渲染相机上的，出图时必须为 0
      H.hideUi();
      const P = BR.player;
      info = { ok: true, level: BR.game.levelId, mode: BR.game.mode, flickerFrozen: frozen, spawn: { x: r3(P.x), y: r3(P.y), z: r3(P.z), yaw: +P.yaw.toFixed(4) } };
    });
    return info;
  };

  // ---------- 摄影棚 ----------
  // 独立的 scene + 两个离屏渲染器（高画质开 MSAA、低画质关 MSAA，和游戏两档的抗锯齿一致），不进任何层级、不受雾和灯池影响
  G.initStudio = size => {
    if (G.studio) return G.meta;
    const main = BR.gfx.renderer;
    const mk = aa => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const rd = new T.WebGLRenderer({ canvas: cv, antialias: aa, alpha: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      rd.setPixelRatio(1);
      rd.setSize(size, size, false);
      // 输出编码和色调映射照抄游戏渲染器：gfx.js 改写过的 CustomToneMapping 是全局 shader 片段，这里拿到的是同一套
      rd.outputEncoding = main.outputEncoding;
      rd.toneMapping = main.toneMapping;
      rd.toneMappingExposure = main.toneMappingExposure;
      rd.shadowMap.enabled = false;
      return rd;
    };
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    scene.fog = null;
    const amb = new T.AmbientLight(0xffffff, 0.55);
    const key = new T.DirectionalLight(0xffffff, 0.85);
    key.position.set(X0 - 2.2, 4.5, Z0 - 3.4);   // 固定在实体左前上方：3/4 正面和正侧受光，背面只剩环境光
    key.target.position.set(X0, 0.8, Z0);
    const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshLambertMaterial({ color: FLOOR }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(X0, -0.003, Z0);
    const grid = new T.GridHelper(8, 16, 0x262626, 0x2e2e2e);   // 0.5 m 一格：打"比例与姿态"分时有尺度参照；线色同样会被 sRGB 编码提亮
    grid.position.set(X0, -0.0015, Z0);
    scene.add(amb, key, key.target, floor, grid);
    const cam = new T.PerspectiveCamera(30, 1, 0.01, 120);
    G.studio = { size, scene, cam, floor, grid, hi: mk(true), lo: mk(false) };
    G.meta.size = size;
    return G.meta;
  };

  // 放一只实体并摆到 idle 同一相位。id 固定：partygoer 这类按 id 哈希取色的实体两次出图才一样
  G.spawnPosed = (type, quality, x, y, z, yaw) => {
    const def = BR.entityTypes.get(type);
    if (!def) return { error: '没有注册实体 ' + type };
    const S = BR.game.settings, q0 = S.quality, api = BR.entities.api;
    let e = null, error = null;
    // clear 顺带按游戏种子重置 entities 的 aiRng：makeEntity / init 里抽的随机数与出图顺序无关
    BR.entities.clear();
    S.quality = quality;   // 构件的 detail 缺省跟 settings.quality 走，建模那一刻生效
    try {
      G.withSeed(type, () => {
        api.time = T0; api.dt = DT;   // init 里记下的时间戳也固定
        try { e = BR.entities.spawn(type, x, y, z, { force: true, yaw, id: 'gallery-' + type }); }
        catch (err) { error = 'spawn 抛异常：' + String(err && err.stack || err).slice(0, 600); return; }
        if (!e) { error = 'BR.entities.spawn 返回空'; return; }
        if (!e.obj) { error = '没有模型（build 抛异常？看 errors）'; return; }
        e.spawnedAt = T0;
        e.hitAt = -1e9;
        const u = e.obj.userData && e.obj.userData.arch;
        if (u) u.seed = 0;   // A.wrap 里是 Math.random()*100：呼吸、抽搐、飞行起伏、光晕脉动的相位全看它
        try { G.pose(e); } catch (err) { error = 'animate 抛异常：' + String(err && err.stack || err).slice(0, 600); }
      });
    } finally { S.quality = q0; }
    if (error && e) { BR.entities.remove(e); e = null; }
    return error ? { error } : { e };
  };
  // 不跑 AI（think 会让它走开、换状态），只按固定时间轴调 animate
  G.pose = e => {
    const cam = BR.gfx.camera, api = BR.entities.api;
    // A.anim 的 lodStep 按主相机距离降频（>14 m 隔帧、>80 m 一帧都不动）：摆姿势期间主相机放到实体正前方 4 m
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    cam.position.set(e.x + fx * 4, e.y + 1.4, e.z + fz * 4);
    cam.lookAt(e.x, e.y + 0.8, e.z);
    cam.updateMatrixWorld(true);
    if (typeof e.def.animate === 'function') {
      for (let k = 1; k <= POSE_FRAMES; k++) {
        api.time = T0 + k * DT; api.dt = DT;
        e.def.animate(e, DT, api);
      }
    }
    e.obj.position.set(e.x, e.y, e.z);
    e.obj.rotation.y = e.yaw;
    e.obj.updateMatrixWorld(true);
  };

  // 摆好姿势后的包围盒：蒙皮网格逐顶点做骨骼变换（佝偻、爬行姿势的绑定姿势包围盒差得很远），Sprite 按世界缩放，实例化个体按实例矩阵
  G.bounds = (root, e) => {
    root.updateMatrixWorld(true);
    const box = new T.Box3(), head = new T.Box3(), headOwn = new T.Box3();
    // 头部：优先骨架里叫 head 的骨骼连同子骨骼（下颌、眼睛、耳朵都挂在它下面）；没有骨架就找名字带 head/face/skull 的节点。
    // headOwn 只收直接绑在 head 骨骼上的顶点：子树大到占了大半个身体时（蜘蛛头胸部挂着腿、眼睛骨骼绑错位置甩出去）改用它
    let headBones = null, headBone = null, headObj = null, headSource = null;
    root.traverse(o => {
      if (headBones || !o.isSkinnedMesh || !o.skeleton || !visibleIn(o, root)) return;
      const bs = o.skeleton.bones;
      const hb = bs.find(b => /^head$/i.test(b.name)) || bs.find(b => /head|skull/i.test(b.name));
      if (hb) { headBones = new Set(); headBone = hb; hb.traverse(b => { if (b.isBone) headBones.add(b); }); headSource = 'bone:' + hb.name; }
    });
    if (!headBones) root.traverse(o => { if (!headObj && o !== root && !o.isBone && /head|face|skull/i.test(o.name || '') && visibleIn(o, root)) { headObj = o; headSource = 'node:' + o.name; } });
    const underHead = o => { for (let p = o; p; p = p.parent) { if (p === headObj || (headBones && headBones.has(p))) return true; if (p === root) break; } return false; };
    const v = new T.Vector3(), s = new T.Vector3(), m4 = new T.Matrix4(), si = new T.Vector4(), sw = new T.Vector4();
    root.traverse(o => {
      if (!visibleIn(o, root)) return;
      const inHead = underHead(o);
      if (o.isSprite) {
        o.getWorldPosition(v); o.getWorldScale(s);
        const hx = Math.abs(s.x) / 2, hy = Math.abs(s.y) / 2;
        const bb = new T.Box3(new T.Vector3(v.x - hx, v.y - hy, v.z - hx), new T.Vector3(v.x + hx, v.y + hy, v.z + hx));
        box.union(bb); if (inHead) head.union(bb);
        return;
      }
      if (!(o.isMesh || o.isPoints || o.isLine)) return;
      const g = o.geometry, pos = g && g.attributes && g.attributes.position;
      if (!pos) return;
      if (o.isInstancedMesh) {
        if (!g.boundingBox) g.computeBoundingBox();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld);
          const bb = g.boundingBox.clone().applyMatrix4(m4);
          box.union(bb); if (inHead) head.union(bb);
        }
        return;
      }
      const skinned = o.isSkinnedMesh && o.skeleton && g.attributes.skinIndex && g.attributes.skinWeight;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let hv = inHead, own = false;
        if (skinned) {
          if (headBones) {
            si.fromBufferAttribute(g.attributes.skinIndex, i); sw.fromBufferAttribute(g.attributes.skinWeight, i);
            let best = 0;
            for (let k = 1; k < 4; k++) if (sw.getComponent(k) > sw.getComponent(best)) best = k;
            const bn = o.skeleton.bones[si.getComponent(best)];
            own = bn === headBone;
            hv = hv || headBones.has(bn);
          }
          o.boneTransform(i, v);
        }
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
        if (hv) head.expandByPoint(v);
        if (own) headOwn.expandByPoint(v);
      }
    });
    if (box.isEmpty()) {
      const r = e && e.r || 0.4, h = e && e.h || 1.6, ex = e ? e.x : X0, ey = e ? e.y : 0, ez = e ? e.z : Z0;
      box.set(new T.Vector3(ex - r, ey, ez - r), new T.Vector3(ex + r, ey + h, ez + r));
    }
    const size = box.getSize(new T.Vector3());
    const flat = size.y < 0.25 * Math.max(size.x, size.z);
    const bodyMax = Math.max(size.x, size.y, size.z, 1e-3);
    const maxDim = b => { const q = b.getSize(new T.Vector3()); return Math.max(q.x, q.y, q.z); };
    if (headBones && !head.isEmpty() && !headOwn.isEmpty() && maxDim(head) > 0.6 * bodyMax) { head.copy(headOwn); headSource += '(own)'; }
    if (head.isEmpty()) {
      const mn = box.min, mx = box.max;
      if (flat || Math.max(size.x, size.y, size.z) < 0.35) { head.copy(box); headSource = 'whole'; }
      else if (size.y >= Math.max(size.x, size.z) * 0.8) { head.set(new T.Vector3(mn.x, mx.y - size.y * 0.28, mn.z), mx.clone()); headSource = 'top28%'; }
      else { head.set(mn.clone(), new T.Vector3(mx.x, mx.y, mn.z + size.z * 0.35)); headSource = 'front35%'; }   // 面朝 -Z：前段在 z 小的一头
    }
    const hs = head.getSize(new T.Vector3());
    head.expandByVector(new T.Vector3(Math.max(0, 0.08 - hs.x) / 2, Math.max(0, 0.08 - hs.y) / 2, Math.max(0, 0.08 - hs.z) / 2));
    // 头本身就占了大半个身体（光球、蜘蛛）：特写按全身取景比例拍，免得"特写"反而比 3/4 正面还远
    return { box, head, headSource, flat, size, headWide: maxDim(head) > 0.6 * bodyMax };
  };

  // 让 box 的 8 个角都落在画面 fill 比例以内：逐角算需要的距离取最大
  G.fit = (box, azDeg, elDeg, fill, cam) => {
    const c = box.getCenter(new T.Vector3());
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    const dir = new T.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));   // 中心指向相机
    const fwd = dir.clone().negate();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    const up = new T.Vector3().crossVectors(right, fwd).normalize();
    const tanV = Math.tan(cam.fov * Math.PI / 360) * fill, tanH = tanV * cam.aspect;
    const q = new T.Vector3();
    let d = 0.05;
    for (let i = 0; i < 8; i++) {
      q.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const x = Math.abs(q.dot(right)), y = Math.abs(q.dot(up)), z = q.dot(dir);
      d = Math.max(d, z + x / tanH, z + y / tanV);
    }
    const rad = box.getSize(q).length() / 2;
    cam.position.copy(c).addScaledVector(dir, d);
    cam.up.set(0, 1, 0);
    cam.lookAt(c);
    cam.near = Math.max(0.003, (d - rad) * 0.5);
    cam.far = 120;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return { az: azDeg, el: elDeg, fill, dist: r3(d), target: [r3(c.x - X0), r3(c.y), r3(c.z - Z0)] };
  };
  G.aim = (B, view) => {
    const cfg = VIEWS[view];
    const whole = cfg.head && (B.headSource === 'whole' || B.headWide);
    return G.fit(cfg.head ? B.head : B.box, cfg.az, B.flat ? FLAT_EL[view] : cfg.el, whole ? VIEWS.front34.fill : cfg.fill, G.studio.cam);
  };

  // 非骨架网格（glowFace 合并几何、GLB、Sprite 以外的网格）的图元数近似：顶点按坐标焊接后数三角形连通块
  const compCache = new WeakMap();
  const components = g => {
    const pos = g && g.attributes && g.attributes.position;
    if (!pos) return 0;
    if (compCache.has(g)) return compCache.get(g);
    const n = pos.count, id = new Int32Array(n), keys = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
      let x = keys.get(k);
      if (x === undefined) { x = keys.size; keys.set(k, x); }
      id[i] = x;
    }
    const m = keys.size, parent = new Int32Array(m), used = new Uint8Array(m);
    for (let i = 0; i < m; i++) parent[i] = i;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const idx = g.index, cnt = idx ? idx.count : n;
    for (let t = 0; t + 2 < cnt; t += 3) {
      const a = id[idx ? idx.getX(t) : t], b = id[idx ? idx.getX(t + 1) : t + 1], c = id[idx ? idx.getX(t + 2) : t + 2];
      used[a] = used[b] = used[c] = 1;
      let ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb;
      rb = find(b); const rc = find(c); if (rb !== rc) parent[rb] = rc;
    }
    let comps = 0;
    for (let i = 0; i < m; i++) if (used[i] && find(i) === i) comps++;
    compCache.set(g, comps);
    return comps;
  };
  G.stats = root => {
    let meshes = 0, tris = 0, drawStatic = 0, prims = 0, tints = 0, fromHook = 0, fromWeld = 0;
    const geos = new Set(), mats = new Set(), matsVis = new Set(), swarm = [];
    root.traverse(o => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      meshes++;
      const g = o.geometry, vis = visibleIn(o, root);
      if (g) geos.add(g.uuid);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!m) return; mats.add(m.uuid); if (vis) matsVis.add(m.uuid); });
      if (o.isInstancedMesh) {
        // 群体个体有自己的预算（TRIS.swarmUnit），不计入 4k 面；图元按"一种个体"算 1
        swarm.push({ unitTris: Math.round(trisOfGeo(g)), instances: o.count });
        if (vis) drawStatic++;
        prims++; fromWeld++;
        return;
      }
      if (o.isMesh) tris += trisOfGeo(g);
      if (vis) drawStatic += o.isMesh && g && g.groups && g.groups.length ? g.groups.length : 1;
      const rig = o.userData && o.userData.rig;
      const rec = rig && window.__pvPrims && window.__pvPrims[rig.key];
      if (rec && rec.prims > 0) { prims += rec.prims; tints += rec.tints || 0; fromHook += rec.prims; }
      else if (o.isSprite || o.isPoints || o.isLine) { prims++; fromWeld++; }
      else { const c = components(g); prims += c; fromWeld += c; }
    });
    let source = fromWeld === 0 ? 'rigbuilder' : fromHook === 0 ? 'weld' : 'rigbuilder+weld';
    const ud = root.userData || {};
    if (typeof ud.primitives === 'number') { prims = ud.primitives; source = 'root.userData.primitives'; }
    if (typeof ud.tints === 'number') tints = ud.tints;
    else if (Array.isArray(ud.tints)) tints = ud.tints.length;
    return {
      tris: Math.round(tris), drawCallsStatic: drawStatic, materials: mats.size, materialsVisible: matsVis.size,
      meshes, geometries: geos.size, primitives: prims, primitivesSource: source, tint: tints, swarm: swarm.length ? swarm : null,
    };
  };

  // 摄影棚出图：一次放一只、一个画质；返回数据 + 各机位 PNG（dataURL）
  G.studioShoot = (type, quality, views) => {
    const st = G.studio;
    if (!st) return { ok: false, error: '摄影棚没初始化' };
    const r = G.spawnPosed(type, quality, X0, 0, Z0, 0);
    if (r.error) return { ok: false, error: r.error };
    const e = r.e, root = e.obj;
    try {
      st.scene.add(root);   // Object3D 只能有一个父节点：add 会把它从游戏场景里摘下来
      const B = G.bounds(root, e);
      const u = root.userData.arch || null;
      const stats = G.stats(root);
      stats.bbox = {
        min: [r3(B.box.min.x - e.x), r3(B.box.min.y - e.y), r3(B.box.min.z - e.z)],
        max: [r3(B.box.max.x - e.x), r3(B.box.max.y - e.y), r3(B.box.max.z - e.z)],
        size: [r3(B.size.x), r3(B.size.y), r3(B.size.z)],
      };
      stats.flat = B.flat;
      stats.head = B.headSource;
      stats.state = String(e.state);
      stats.form = u && u.formKey || null;
      stats.forms = u && u.forms ? Object.keys(u.forms) : null;
      const rd = quality === 'low' ? st.lo : st.hi;
      // draw call / 渲染三角面实测：藏掉地板和网格只画实体（high 取 3/4 正面机位，low 取正面机位）
      G.aim(B, quality === 'low' ? 'low' : 'front34');
      st.floor.visible = st.grid.visible = false;
      rd.render(st.scene, st.cam);
      stats.drawCalls = rd.info.render.calls;
      stats.trisRendered = rd.info.render.triangles;
      st.floor.visible = st.grid.visible = true;
      const shots = [];
      for (const v of views) {
        const cam = G.aim(B, v);
        rd.render(st.scene, st.cam);
        shots.push({ view: v, camera: cam, png: rd.domElement.toDataURL('image/png') });
      }
      // 多形态（窃皮者伪装/真身、woodlin 隐藏/现形、plush_dino 休眠/活动）：idle 只显示一个形态，打磨真身时前后对照会是 AE 0 看不出改动。
      // 其余形态各补一张 3/4 正面 7-form-<形态名>：强制切显示、只摆骨架基础姿势——再跑 animate 的话状态机会把形态切回去
      if (views.indexOf('front34') >= 0 && u && u.forms) {
        for (const k of Object.keys(u.forms)) {
          if (k === u.formKey) continue;
          for (const kk in u.forms) u.forms[kk].visible = kk === k;
          u.forms[k].scale.setScalar(1);
          if (u.rigs && u.rigs[k]) BR.arch.anim.pose(u.rigs[k]);
          root.updateMatrixWorld(true);
          const FB = G.bounds(root, e);
          const cam = Object.assign(G.aim(FB, 'front34'), { form: k, pose: 'base' });
          rd.render(st.scene, st.cam);
          shots.push({ view: 'form-' + String(k).toLowerCase().replace(/[^a-z0-9_]/g, '_'), camera: cam, png: rd.domElement.toDataURL('image/png') });
        }
      }
      const d = e.def;
      return { ok: true, stats, shots, def: { type: d.type, zh: d.zh, en: d.en || null, faction: d.faction, version: d.version, radius: d.radius, height: d.height } };
    } catch (err) {
      return { ok: false, error: '出图抛异常：' + String(err && err.stack || err).slice(0, 600) };
    } finally {
      BR.entities.remove(e);
    }
  };

  // 首个出场层级：玩家站在出生点，实体放在视线方向约 6 m、有视线且放得下的空位，面朝玩家，用游戏渲染器拍
  G.levelShot = (type, quality) => {
    const def = BR.entityTypes.get(type);
    if (!def) return { ok: false, error: '没有注册实体 ' + type };
    const P = BR.player, eyeH = (BR.config.player && BR.config.player.eyeHeight) || 1.6;
    const px = P.x, pz = P.z, eyeY = P.y, feetY = eyeY - eyeH, yaw0 = P.yaw;
    BR.entities.clear();
    const r = def.radius > 0 ? def.radius : 0.4, h = def.height > 0 ? def.height : 1.8;
    const search = collide => {
      for (const d of [6, 5.5, 6.5, 5, 7, 4.5, 7.5, 4, 3.5, 3, 2.5]) {
        for (let i = 0; i <= 24; i++) {
          const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);   // 正前方起左右交替 15° 一档
          const a = yaw0 + off;
          const x = px - Math.sin(a) * d, z = pz - Math.cos(a) * d;
          const gy = H.ground(x, z);
          if (Math.abs(gy - feetY) > 1.2) continue;   // 不跨楼层
          if (collide && BR.phys.overlapCircle(x, z, r + 0.05, gy + 0.02, h)) continue;
          if (!BR.phys.los(px, eyeY, pz, x, gy + Math.min(h * 0.6, 1.2), z)) continue;
          return { x, z, y: gy, dist: d, offDeg: Math.round(off * 180 / Math.PI) };
        }
      }
      return null;
    };
    let note = null;
    let spot = search(true);
    // 大体型（thing_on_level_7 半径 2.4 m）在出生点附近放不下：退一步只要视线、不查碰撞；再不行直接放正前方 6 m。
    // 这张图看的是层级灯光下的样子，嵌进墙里也比缺图强，note 里写明
    if (!spot) { spot = search(false); if (spot) note = '半径 ' + r + ' m 在出生点附近放不下，忽略碰撞摆放'; }
    if (!spot) {
      const x = px - Math.sin(yaw0) * 6, z = pz - Math.cos(yaw0) * 6;
      spot = { x, z, y: H.ground(x, z), dist: 6, offDeg: 0 };
      note = '出生点周围 2.5–7.5 m 找不到有视线的位置，直接放正前方 6 m（可能被墙挡住）';
    }
    const res = G.spawnPosed(type, quality, spot.x, spot.y, spot.z, Math.atan2(-(px - spot.x), -(pz - spot.z)));
    if (res.error) return { ok: false, error: res.error };
    const e = res.e;
    try {
      const B = G.bounds(e.obj, e);
      const c = B.box.getCenter(new T.Vector3());
      const cam = BR.gfx.camera;
      const dx = c.x - px, dy = c.y - eyeY, dz = c.z - pz;
      cam.rotation.order = 'YXZ';
      cam.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
      cam.position.set(px, eyeY, pz);
      cam.updateMatrixWorld(true);
      BR.gfx.setSanityEffect(0, true);
      G.freezeFlicker();
      const lights = G.resetLightPool();
      BR.gfx.render(0);
      const info = BR.gfx.renderer.info.render;
      const out = {
        ok: true, png: BR.gfx.renderer.domElement.toDataURL('image/png'),
        dist: r3(Math.hypot(spot.x - px, spot.z - pz)), wantDist: spot.dist, offDeg: spot.offDeg, note,
        lightAt: r3(BR.world.lightAt(spot.x, spot.z)), lightSources: lights,
        sceneDrawCalls: info.calls, sceneTriangles: info.triangles,
        eye: [r3(px), r3(eyeY), r3(pz)], entityAt: [r3(spot.x), r3(spot.y), r3(spot.z)],
      };
      return out;
    } catch (err) {
      return { ok: false, error: '层级镜头抛异常：' + String(err && err.stack || err).slice(0, 600) };
    } finally {
      BR.entities.remove(e);
    }
  };

  // ---------- --stress ----------
  G.stress = (type, count, frames) => {
    const def = BR.entityTypes.get(type);
    if (!def) return { ok: false, error: '没有注册实体 ' + type };
    const P = BR.player, eyeH = (BR.config.player && BR.config.player.eyeHeight) || 1.6, feetY = P.y - eyeH;
    const gl = BR.gfx.renderer.getContext(), px = new Uint8Array(4);
    BR.entities.clear();
    G.freezeFlicker();
    BR.gfx.setSanityEffect(0, true);
    // 按事件数玩家挨打（不看 hp：测试模式的满血值不一定是 100）
    let playerDamage = 0;
    const offDamage = BR.bus.on('player:damage', () => { playerDamage++; });
    const r = def.radius > 0 ? def.radius : 0.4, h = def.height > 0 ? def.height : 1.8;
    // 落点：先在视野中心 ±35° 扇面内由近到远排，排不满再放宽到 ±55°、最后全周；要有视线、互不重叠、不跨楼层
    const spots = [];
    const ok = (x, z) => {
      const gy = H.ground(x, z);
      if (Math.abs(gy - feetY) > 1.2) return null;
      if (BR.phys.overlapCircle(x, z, r + 0.05, gy + 0.02, h)) return null;
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < 2 * r + 0.3)) return null;
      if (!BR.phys.los(P.x, P.y, P.z, x, gy + Math.min(h * 0.6, 1.2), z)) return null;
      return gy;
    };
    const dists = [];
    for (let d = 2.5; d <= 22; d += Math.max(0.8, 2 * r + 0.35)) dists.push(d);
    for (const maxA of [35, 55, 180]) {
      for (const d of dists) {
        const nA = Math.max(3, Math.round((2 * maxA * Math.PI / 180) * d / (2 * r + 0.45)));
        for (let i = 0; i < nA && spots.length < count; i++) {
          const a = P.yaw + (-maxA + 2 * maxA * (i + 0.5) / nA) * Math.PI / 180;
          const x = P.x - Math.sin(a) * d, z = P.z - Math.cos(a) * d;
          const gy = ok(x, z);
          if (gy != null) spots.push({ x, z, y: gy, d: r3(d), cone: maxA });
        }
        if (spots.length >= count) break;
      }
      if (spots.length >= count) break;
    }
    const step = () => __br.step(1 / 30);
    const measure = n => {
      const ms = [];
      let calls = 0, maxCalls = 0, minCalls = Infinity, triSum = 0, entMs = 0;
      const E = BR.entities, upd = E.update;
      E.update = function (dt) { const t0 = performance.now(); try { return upd.call(E, dt); } finally { entMs += performance.now() - t0; } };
      try {
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          step();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // 逼 GPU 进程把这一帧画完：帧时间里才包含 SwiftShader 光栅化
          ms.push(performance.now() - t0);
          const inf = BR.gfx.renderer.info.render;
          calls += inf.calls; triSum += inf.triangles;
          if (inf.calls > maxCalls) maxCalls = inf.calls;
          if (inf.calls < minCalls) minCalls = inf.calls;
        }
      } finally { E.update = upd; }
      const sorted = ms.slice().sort((a, b) => a - b);
      const avg = ms.reduce((a, b) => a + b, 0) / n;
      return {
        frames: n, avgFrameMs: r3(avg), medianFrameMs: r3(sorted[n >> 1]), p90FrameMs: r3(sorted[Math.min(n - 1, Math.floor(n * 0.9))]),
        avgDrawCalls: +(calls / n).toFixed(2), maxDrawCalls: maxCalls, minDrawCalls: minCalls, avgTriangles: Math.round(triSum / n),
        avgEntitiesUpdateMs: r3(entMs / n),
      };
    };
    const inView = () => {
      const cam = BR.gfx.camera;
      cam.updateMatrixWorld(true);
      const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let n = 0;
      BR.entities.list.forEach(x => { if (x.removed || !x.obj) return; const b = new T.Box3().setFromObject(x.obj); if (!b.isEmpty() && fr.intersectsBox(b)) n++; });
      return n;
    };
    for (let i = 0; i < 10; i++) step();   // 预热：层级 shader 编译不算进基线
    const baseline = measure(frames);
    let placed = 0;
    G.withSeed('stress:' + type, () => {
      spots.forEach((s, i) => {
        const e = BR.entities.spawn(type, s.x, s.y, s.z, { force: true, id: 'stress-' + type + '-' + i, yaw: Math.atan2(-(P.x - s.x), -(P.z - s.z)) });
        if (e) placed++;
      });
    });
    for (let i = 0; i < 10; i++) step();   // 预热：实体材质 shader 编译
    const inViewStart = inView();
    const loaded = measure(frames);
    const inViewEnd = inView();
    BR.gfx.render(0);
    const png = BR.gfx.renderer.domElement.toDataURL('image/png');
    const alive = BR.entities.list.filter(x => !x.removed && x.type === type).length;
    offDamage();
    BR.entities.clear();
    return {
      ok: true, type, count, placed, alive, inViewStart, inViewEnd, playerDamage,
      spots: { found: spots.length, minDist: spots.length ? Math.min(...spots.map(s => s.d)) : null, maxDist: spots.length ? Math.max(...spots.map(s => s.d)) : null, widestCone: spots.length ? Math.max(...spots.map(s => s.cone)) : null },
      baseline, loaded,
      delta: {
        frameMs: r3(loaded.avgFrameMs - baseline.avgFrameMs), frameRatio: baseline.avgFrameMs > 0 ? r3(loaded.avgFrameMs / baseline.avgFrameMs) : null,
        drawCalls: +(loaded.avgDrawCalls - baseline.avgDrawCalls).toFixed(2),
      },
      png,
    };
  };
  return true;
}

// =====================================================================
// node 侧
// =====================================================================
const call = (page, name, ...args) => page.evaluate(([n, a]) => {
  const f = window.__pv && window.__pv[n];
  if (!f) throw new Error('__pv.' + n + ' 不存在');
  return f.apply(null, a);
}, [name, args]);

async function snap(page, name, fnName, ...args) {
  const r = await call(page, fnName, ...args);
  await page.waitForTimeout(80);   // 让 rAF 用摆好的相机再画一帧
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f });
  shots.push(path.relative(ROOT, f));
  return r;
}

// opts（--gallery / --stress 用，其他模式不传，行为不变）：viewport 覆盖默认尺寸；primHook 在页面脚本之前装图元计数钩子
async function newPage(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: o.viewport || VIEW });
  const page = await ctx.newPage();
  if (o.primHook) await page.addInitScript(primHookInit);
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errors.push('console.error: ' + t);
    else if (m.type() === 'warning' && t.indexOf('[arch]') >= 0) warns.push(t);
  });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  // 联机信令服务器绝不能打线上
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  return page;
}

// sandbox=true（--entity/--arch 用）：清空自动生成的实体，后面全靠手动 place；
// sandbox=false（--level-shots/--scale 用）：保留层级按当前模式真实刷出来的实体/物品，看的就是这份真实数量
async function startMode(page, mode, level, opts) {
  const lvl = level || LEVEL;
  const sandbox = !opts || opts.sandbox !== false;
  const screen = await page.evaluate(() => BR.game.screen);
  if (screen !== 'home') {
    await page.evaluate(() => BR.bus.emit('game:home'));
    await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 15000 });
  }
  await page.evaluate(({ mode, level }) => {
    __br.setAuto(false);
    __br.start({ mode, difficulty: mode === 'nightmare' ? 'hell' : null, levelId: level, seed: 12345, settings: { visibility: 1 } });
  }, { mode, level: lvl });
  await page.waitForFunction(() => BR.game.screen === 'playing' && BR.world && BR.world.current, null, { timeout: 30000 });
  if (sandbox) {
    await page.evaluate(() => {
      __br.step(1);
      // 预览只看手动放出的实体：噩梦模式也关掉自动生成，免得层级刷的实体搅局、打玩家的来源说不清
      BR.game.autoSpawn = false;
      BR.entities.clear();
      __br.step(0.05);
      __pv.hideUi();
    });
  } else {
    await page.evaluate(() => { __br.step(1); __pv.hideUi(); });
  }
  const info = await page.evaluate(() => ({ mode: BR.game.mode, level: BR.game.levelId, attackPlayers: BR.game.attackPlayers }));
  if (info.mode !== mode) throw new Error('没能进入 ' + mode + ' 模式：' + JSON.stringify(info));
  return info;
}

// 到主页、装好 __pv 帮助函数、注入还没登记进 index.html 的脚本；不进任何关卡（--scale 用这个就够）
async function bootHome(browser, base, opts) {
  const o = opts || {};
  const page = await newPage(browser, { viewport: o.viewport, primHook: !!o.gallery });
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(400);
  const archOk = await page.evaluate(() => !!(BR.arch && BR.arch.version));
  if (!archOk) throw new Error('BR.arch 没有加载（index.html 里 js/entities/_archetypes.js 报错或缺失）');
  await page.evaluate(installHelpers);
  await injectMissingScripts(page);
  // 出图帮助函数装在注入之后：catalog 要看到自动注入的实体类型
  if (o.gallery) await page.evaluate(installGalleryHelpers);
  return page;
}

async function boot(browser, base, mode, level, opts) {
  const page = await bootHome(browser, base);
  await startMode(page, mode, level, opts);
  return page;
}

// 跑一段战斗，allow 里的事件出现时截图；endShot 为真时最后再截一张
async function simulate(page, prefix, id, seconds, n, allow, endShot) {
  const seen = [];
  let left = seconds, k = n;
  while (left > 0.05) {
    const r = await call(page, 'run', left, id, seen, allow);
    left -= r.elapsed;
    if (!r.event) break;
    seen.push(r.event);
    await snap(page, `${prefix}-${k++}-${r.event.replace(':', '-')}`, 'frameNearest', id);
  }
  if (endShot) await snap(page, `${prefix}-${k++}-end`, 'frameNearest', id);
  return call(page, 'summary');
}

// ---------- --entity ----------
async function runEntities(browser, base) {
  const mode = String(arg('mode', 'test'));
  const page = await boot(browser, base, mode);
  const types = String(arg('entity')).split(',').filter(Boolean);
  const withTypes = arg('with') ? String(arg('with')).split(',').filter(Boolean) : [];
  const seconds = +arg('seconds', 15);
  const dist = +arg('dist', 5);
  const report = [];
  for (const type of types) {
    await call(page, 'reset');
    const placed = await call(page, 'place', type);
    if (!placed.ok) { report.push({ type, error: placed.error }); console.log('FAIL ' + type + '：' + placed.error); continue; }
    const id = placed.id;
    await call(page, 'playerNear', id, 4);
    await call(page, 'track', [id]);
    const s0 = shots.length;
    await snap(page, `${type}-1-front`, 'orbit', id, 0, 1);
    await snap(page, `${type}-2-side`, 'orbit', id, Math.PI / 2, 1);
    await snap(page, `${type}-3-back`, 'orbit', id, Math.PI, 1);
    const move = await call(page, 'runUntilMove', id, 4);
    await snap(page, `${type}-4-move`, 'orbit', id, Math.PI / 2, 1.2);
    const solo = await call(page, 'summary');
    let partners = [], together = null;
    if (withTypes.length) {
      partners = await call(page, 'addPartners', id, withTypes, withTypes.map(() => dist));
      await call(page, 'track', [id, ...partners.filter(p => p.id).map(p => p.id)]);
      await snap(page, `${type}-5-together`, 'frameNearest', id);
      together = await simulate(page, type, id, seconds, 6, ['attack', 'hurt', 'kill', 'dead'], true);
    }
    report.push({ type, def: placed.def, model: placed.model, move, solo, partners, together, shots: shots.slice(s0) });
  }
  for (const r of report) {
    if (r.error) continue;
    console.log(`\n== ${r.type}（${r.def.faction}，${r.def.version}）三角面 ${r.model && r.model.tris}，draw call ${r.model && r.model.drawCalls}，材质 ${r.model && r.model.materials}`);
    console.log('   单独：走起来 ' + JSON.stringify(r.move) + '，状态 ' + r.solo.ents[0].seq.join('→'));
    if (r.together) {
      for (const x of r.together.ents) console.log(`   ${x.type}：hp ${x.hp0}→最低 ${x.minHp}${x.removedAt != null ? '（' + x.removedAt + 's 移除）' : ''}，走了 ${x.moved} m，状态 ${x.seq.join('→')}`);
      console.log('   击杀 ' + JSON.stringify(r.together.kills) + '；玩家挨打 ' + r.together.playerDamage + ' 次，hp ' + r.together.playerHp);
    }
    console.log('   截图 ' + r.shots.join(' '));
  }
  console.log('\n页面报错 ' + errors.length + ' 条'); for (const e of errors) console.log('  ' + e);
  console.log('[arch] 警告 ' + warns.length + ' 条'); for (const w of warns) console.log('  ' + w);
  console.log('PREVIEW_JSON ' + JSON.stringify({ mode, report, errors, warns }));
  process.exitCode = errors.length || report.some(r => r.error) ? 1 : 0;
}

// ---------- --arch ----------
const ent = (sum, type, i) => sum && sum.ents.filter(x => x.type === type)[i || 0];
const hurt = x => !!x && (x.minHp < x.hp0 || x.removedAt != null);
const visited = (x, ...st) => !!x && st.some(s => (x.time[s] || 0) > 0 || x.seq.indexOf(s) >= 0);

async function scenario(page, name, spec) {
  await call(page, 'reset');
  const placed = await call(page, 'place', spec.main);
  if (!placed.ok) return { name, error: placed.error };
  const partners = spec.partners ? await call(page, 'addPartners', placed.id, spec.partners.map(p => p[0]), spec.partners.map(p => p[1])) : [];
  if (spec.player != null) await call(page, 'playerNear', placed.id, spec.player);
  const ids = [placed.id, ...partners.filter(p => p.id).map(p => p.id)];
  for (const i of spec.overlap || []) await call(page, 'moveNear', ids[i], ids[0], 0.2);
  await call(page, 'track', ids);
  const hitArgs = h => [ids[h[0]], h[1], h[2] == null ? null : ids[h[2]], !!h[3]];
  for (const h of spec.pre || []) await call(page, 'hit', ...hitArgs(h));
  // 截图文件名只取场景名第一个词（stalker / mimic ...），中文和冒号放进路径不好引用
  let sum = await simulate(page, 'arch-' + name.split(/[ ：:]/)[0], placed.id, spec.seconds, 1, spec.shot || [], false);
  if (spec.post) {
    for (const h of spec.post) await call(page, 'hit', ...hitArgs(h));
    await call(page, 'run', 0.6, placed.id, [], []);
    sum = await call(page, 'summary');
  }
  const missing = partners.filter(p => p.error);
  return { name, placed, partners, missing, sum };
}

async function runArch(browser, base) {
  const page = await boot(browser, base, 'test');
  const reg = await page.evaluate(registerProbes);
  check('探针实体全部通过 A.register', reg.ok, reg.ok ? reg.types.length + ' 种' : reg.errs);

  // 构件：外观截图 + 三角面预算
  for (const row of [0, 1]) {
    const parts = await call(page, 'gallery', row);
    await page.waitForTimeout(120);
    const f = path.join(OUT, `arch-parts-row${row}.png`);
    await page.screenshot({ path: f });
    shots.push(path.relative(ROOT, f));
    await call(page, 'clearGallery');
    for (const p of parts) {
      if (p.error) { check('构件 ' + p.name + ' 能构建', false, p.error); continue; }
      const ok = p.unitTris != null ? p.unitTris < 120 && p.tris < 4000 : p.tris < 4000;
      check('构件 ' + p.name + ' 三角面在预算内', ok, p);
      check('构件 ' + p.name + ' draw call ≤ 5', p.draws <= 5, p);
    }
  }

  const S = {};
  const run = async (name, spec, verdict) => {
    const r = await scenario(page, name, spec);
    S[name] = r;
    if (r.error) { check(name, false, r.error); return; }
    if (r.missing.length) { check(name + '：伙伴全部放出', false, r.missing); return; }
    let v;
    try { v = verdict(r.sum, r); } catch (err) { v = { ok: false, why: String(err) }; }
    const brief = r.sum.ents.map(x => ({ type: x.type, hp: x.hp0 + '→' + x.minHp, moved: x.moved, seq: x.seq.slice(0, 12).join('→'), lift: x.maxLift || undefined, forms: x.forms.length > 1 ? x.forms : undefined, bone: x.boneRange || undefined, swarm: x.swarm0 != null ? x.swarm0 + '→' + x.swarmCount : undefined }));
    check(name, v.ok, { ...(v.why ? { why: v.why } : {}), ents: brief, kills: r.sum.kills.length, model: r.placed.model });
  };

  await run('stalker 追猎者：巡逻→追击→近战打测试人，走路有步态', { main: '_probe_stalker', partners: [['test_dummy', 6]], seconds: 12, shot: ['attack'] },
    s => { const m = ent(s, '_probe_stalker'); return { ok: hurt(ent(s, 'test_dummy')) && visited(m, 'chase') && visited(m, 'attack') && m.boneRange > 0.15 }; });
  await run('pack 群猎：三只成群，发现测试人后包抄咬伤', { main: '_probe_pack', partners: [['_probe_pack', 1.8], ['_probe_pack', 2.2], ['test_dummy', 8]], seconds: 14, shot: ['attack'] },
    s => {
      const packs = s.ents.filter(x => x.type === '_probe_pack');
      return { ok: hurt(ent(s, 'test_dummy')) && packs.some(x => visited(x, 'follow', 'rally', 'flank')) && packs.filter(x => visited(x, 'chase', 'flank', 'attack')).length >= 2 };
    });
  await run('flyer 飞行：离地飞行、俯冲打测试人', { main: '_probe_flyer', partners: [['test_dummy', 6]], seconds: 12, shot: ['attack'] },
    s => { const m = ent(s, '_probe_flyer'); return { ok: hurt(ent(s, 'test_dummy')) && visited(m, 'dive', 'attack') && m.maxLift > 0.8 }; });
  await run('ambush 伏击：藏着不动，测试人进范围突袭', { main: '_probe_ambush', partners: [['test_dummy', 3]], seconds: 10, shot: ['attack'] },
    s => { const m = ent(s, '_probe_ambush'); return { ok: hurt(ent(s, 'test_dummy')) && visited(m, 'hide', 'lurk') && visited(m, 'strike', 'attack') }; });
  await run('ambush fixed 静态陷阱：测试人硬挤上来也不挪窝，够得着就打', { main: '_probe_trap', partners: [['test_dummy', 1.2]], overlap: [1], seconds: 6 },
    s => { const m = ent(s, '_probe_trap'); return { ok: m.displacement < 0.05 && (hurt(ent(s, 'test_dummy')) || visited(m, 'attack')) }; });
  await run('mimic 拟态：伪装（防化服外形）→ 靠近现形换真身 → 追杀', { main: '_probe_mimic', partners: [['test_dummy', 6]], seconds: 14, shot: ['state:reveal', 'attack'] },
    s => {
      const m = ent(s, '_probe_mimic');
      const iD = m.seq.indexOf('disguise'), iR = m.seq.indexOf('reveal');
      return { ok: iD >= 0 && iR > iD && m.forms.indexOf('disguise') >= 0 && m.forms.indexOf('true') >= 0 && hurt(ent(s, 'test_dummy')) };
    });
  await run('lightBound avoid 惧光：亮处退缩', { main: '_probe_shy', partners: [['test_dummy', 5]], seconds: 5 },
    s => ({ ok: visited(ent(s, '_probe_shy'), 'recoil') }));
  await run('lightBound need 需光：暗处休眠、不打人', { main: '_probe_need', partners: [['test_dummy', 3]], seconds: 5 },
    s => ({ ok: visited(ent(s, '_probe_need'), 'dormant') && !hurt(ent(s, 'test_dummy')) }));
  await run('wanderer 中立：被有害实体打了才反击', { main: '_probe_wanderer', partners: [['_probe_stalker', 2.5]], seconds: 10, pre: [[0, 5, 1]] },
    s => ({ ok: hurt(ent(s, '_probe_stalker')) && visited(ent(s, '_probe_wanderer'), 'chase', 'attack') }));
  await run('wanderer flee：被打就逃', { main: '_probe_coward', partners: [['_probe_stalker', 2.5]], seconds: 5, pre: [[0, 5, 1]] },
    s => ({ ok: visited(ent(s, '_probe_coward'), 'flee') }));
  await run('guide 友善：守在玩家附近，主动去打有害实体', { main: '_probe_guide', partners: [['_probe_stalker', 6]], player: 3, seconds: 12, shot: ['attack'] },
    s => ({ ok: hurt(ent(s, '_probe_stalker')) && visited(ent(s, '_probe_guide'), 'guard', 'attack') }));
  await run('guide 友善：从不打测试人，跟着玩家', { main: '_probe_guide', partners: [['test_dummy', 3]], player: 3, seconds: 8 },
    s => { const g = ent(s, '_probe_guide'); return { ok: !hurt(ent(s, 'test_dummy')) && !visited(g, 'attack') && visited(g, 'follow', 'lead', 'wait', 'idle', 'wander') }; });
  await run('swarm 群体：一个逻辑实体打测试人，掉血后个体变少', { main: '_probe_swarm', partners: [['test_dummy', 5]], seconds: 10, shot: ['attack'], post: [[0, 0.6, null, true]] },
    s => { const m = ent(s, '_probe_swarm'); return { ok: hurt(ent(s, 'test_dummy')) && m.swarm0 > 0 && m.swarmCount < m.swarm0 }; });
  await run('hazardEntity 环境型：蔓延过去，接触伤害测试人', { main: '_probe_hazard', partners: [['test_dummy', 2.2]], seconds: 12, shot: ['attack'] },
    s => ({ ok: hurt(ent(s, 'test_dummy')) && ent(s, '_probe_hazard').moved > 0.2 }));

  const testDmg = Object.values(S).reduce((n, r) => n + (r.sum ? r.sum.playerDamage : 0), 0);
  check('测试模式：所有场景里实体都没打玩家', testDmg === 0, { playerDamage: testDmg });

  // 性能：28 只（maxActiveEntities）同时在 24 m 内，AI + 动画每帧耗时
  const perf = await call(page, 'perf', '_probe_stalker', 20, 8, 150);
  check('性能：20 追猎者 + 8 测试人，entities.update 每帧 < 3 ms（桌面 CPU，手机约慢 4–5 倍）', perf.msPerUpdate < 3 && perf.count >= 20, perf);

  // 噩梦模式：有害骨架会打玩家，友善骨架不会
  await startMode(page, 'nightmare');
  await page.evaluate(registerProbes);
  await run('噩梦模式：stalker 追打玩家', { main: '_probe_stalker', player: 5, seconds: 6 },
    s => ({ ok: s.playerDamage > 0 || s.playerHp < 100, why: JSON.stringify(s.dmgSources) }));
  await page.evaluate(() => { if (BR.player.hp < 100) BR.player.hp = 100; });
  await run('噩梦模式：guide 不打玩家', { main: '_probe_guide', player: 3, seconds: 6 },
    s => ({ ok: s.playerDamage === 0 }));

  check('页面没有 console.error / 未捕获异常', errors.length === 0, errors.slice(0, 8));
  console.log('\n[arch] 警告 ' + warns.length + ' 条'); for (const w of warns) console.log('  ' + w);
  const failed = results.filter(r => !r.ok);
  console.log('\n===== BR.arch 自检：' + results.length + ' 项，失败 ' + failed.length + ' 项 =====');
  for (const f of failed) console.log('  FAIL ' + f.name);
  console.log('截图 ' + shots.join(' '));
  process.exitCode = failed.length ? 1 : 0;
}

// ---------- --level-shots ----------
async function runLevelShots(browser, base) {
  const mode = String(arg('mode', 'test'));
  const levelId = String(arg('level-shots'));
  const n = Math.max(0, +arg('shots', 4));
  const page = await boot(browser, base, mode, levelId, { sandbox: false });
  const spawn = await call(page, 'playerPose');
  const dirNames = ['front', 'right', 'back', 'left'];
  const spawnShots = [];
  for (let k = 0; k < 4; k++) {
    const yaw = spawn.yaw + k * Math.PI / 2;
    await call(page, 'lookYaw', yaw);
    await snap(page, `level-${levelId}-spawn-${dirNames[k]}`, 'lookYaw', yaw);
    spawnShots.push(dirNames[k]);
  }
  // 挑 N 个传送点：spawnPoints + 出口，按到出生点的距离从远到近跨步取样，尽量摊开而不是挤在附近
  const points = await call(page, 'levelPoints');
  const dist = p => Math.hypot(p.x - spawn.x, p.z - spawn.z);
  points.sort((a, b) => dist(b) - dist(a));
  const picks = [];
  const step = points.length > n && n > 0 ? Math.floor(points.length / n) : 1;
  for (let i = 0; i < points.length && picks.length < n; i += step) picks.push(points[i]);
  const spotShots = [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    // 站在点上回头看出生点方向，大概率能看见点周围的地形，比瞎朝一个方向看更有信息量
    const yaw = Math.atan2(-(spawn.x - p.x), -(spawn.z - p.z));
    const name = `level-${levelId}-spot${i + 1}-${p.kind}${p.to != null ? '-to' + p.to : ''}`;
    await snap(page, name, 'standAt', p.x, p.z, p.y, yaw);
    spotShots.push({ ...p, dist: +dist(p).toFixed(2), shot: name });
  }
  const stats = await call(page, 'levelStats');
  console.log(`\n== --level-shots ${levelId}（${mode}）出生点 ${JSON.stringify(spawn)}`);
  console.log('   draw call ' + stats.drawCalls + '，三角面 ' + stats.triangles + '，已载入区块 ' + stats.chunksLoaded);
  console.log('   实体 ' + stats.entities + ' 只，物品 ' + JSON.stringify(stats.items));
  console.log('   出口 ' + JSON.stringify(stats.exits));
  console.log('   传送点（要 ' + n + ' 个，实拿 ' + picks.length + ' 个）：' + spotShots.map(s => s.kind + (s.to != null ? '→' + s.to : '')).join('、'));
  console.log('   截图 ' + [...spawnShots.map(d => `level-${levelId}-spawn-${d}`), ...spotShots.map(s => s.shot)].join(' '));
  console.log('\n页面报错 ' + errors.length + ' 条'); for (const e of errors) console.log('  ' + e);
  console.log('[arch] 警告 ' + warns.length + ' 条'); for (const w of warns) console.log('  ' + w);
  console.log('PREVIEW_JSON ' + JSON.stringify({ mode, level: levelId, spawn, spawnShots, spotShots, stats, errors, warns }));
  process.exitCode = errors.length ? 1 : 0;
}

// ---------- --scale ----------
async function runScale(browser, base) {
  const levelId = String(arg('scale'));
  const page = await bootHome(browser, base);
  const r = await call(page, 'scaleReport', levelId);
  if (!r.ok) { console.log('FAIL --scale：' + r.error); process.exitCode = 1; return; }
  console.log(`\n== --scale ${levelId}：chunkArea ${r.chunkArea} m²，实体类型 [${r.entities.join('、') || '（空）'}]，${r.chunks} 个区块坐标`);
  for (const t of r.totals) console.log(`   ${t.label}（spawnFactor ${t.factor}）：期望实体总数 ${t.total}`);
  const want = { casual: 0.5, easy: 0, medium: 0.2, hard: 0.4, hell: 0.6 };
  const base0 = r.totals[0].total || 0;
  // 期望总数正比于 spawnFactor（同一份 entities 表、同一批区块），比值该和 spawnFactor 本身一致
  // totals 是 toFixed(4) 过的显示值：密度很低的层（期望总数只有个位数）舍入误差会放大到 1e-5 量级，按 1e-3 的相对误差比较
  const ok = r.entities.length === 0 || base0 === 0 || r.totals.every(t => Math.abs((t.total / base0) - (want[t.key] / want.casual)) < 1e-3);
  check('--scale ' + levelId + '：实体总数比值 = spawnFactor 比值（0.5:0:0.2:0.4:0.6）', ok, r.totals.map(t => t.key + '=' + t.total));
  console.log('PREVIEW_JSON ' + JSON.stringify({ scale: r }));
  process.exitCode = ok ? 0 : 1;
}

// ---------- --gallery ----------
const POLISH = path.join(ROOT, 'tools', 'polish');
const SHOT_N = { front34: 1, side: 2, back: 3, head: 4, low: 5, level: 6 };
const BUDGET = { tris: 4000, drawCalls: 5 };
const GALLERY_FIELDS = {
  'types.<type>.status': 'PASS / FAIL（high 档三角面 > 4000 或 draw call > 5）/ KNOWN（超预算但列在 tools/polish/budget-exceptions.json）/ ERROR（high 档没出模型）/ UNCHECKED（没拍 high 档，不判预算）',
  'types.<type>.high|low.tris': '非实例化网格三角面合计，含隐藏形态（与 A.wrap 预算口径一致）；预算判定用它',
  'types.<type>.high|low.trisRendered': '摄影棚实测渲染三角面（renderer.info，只算当前可见形态，含群体实例化个体）',
  'types.<type>.high|low.drawCalls': '摄影棚实测 draw call：藏掉地板网格后 renderer.info.render.calls（high 用 3/4 正面机位，low 用正面机位）；r147 里透明 + 双面材质要画两遍，所以可能比静态估算多（deathmoth 翅膀）',
  'types.<type>.high|low.drawCallsStatic': '按可见网格 geometry.groups 静态估算（A.wrap 口径，另加 Sprite/Points/Line 各 1）；预算判定取实测与静态的较大值',
  'types.<type>.high|low.materials': '模型用到的不同材质数（含隐藏形态）；materialsVisible 只算当前可见形态',
  'types.<type>.high|low.meshes|geometries': '网格节点数 / 不同 BufferGeometry 数',
  'types.<type>.high|low.primitives': '图元数：骨架网格用 RigBuilder 计数钩子（box/sphere/limb/cone/geo 各算 1，chain 每节 1）；非骨架网格（glowFace 合并几何、GLB 等）按顶点焊接后的三角形连通块数近似；Sprite/Points/Line/实例化个体各算 1；root.userData.primitives 存在时直接用它',
  'types.<type>.high|low.primitivesSource': 'rigbuilder / weld（焊接连通块近似）/ rigbuilder+weld / root.userData.primitives',
  'types.<type>.high|low.tint': 'RigBuilder 调用参数里带 { tint } 的图元数（顶点色 tint 落地前恒为 0）；root.userData.tints 存在时用它',
  'types.<type>.high|low.bbox': '摆好 idle 姿势后按蒙皮顶点实算的包围盒，相对实体脚底原点、面朝 -Z，单位 m；flat = 贴地斑块（改俯拍）',
  'types.<type>.high|low.swarm': '群体构件的实例化个体 [{ unitTris, instances }]，不计入 tris',
  'types.<type>.high|low.state|form|forms': 'init 之后的状态、当前显示的形态、全部形态名（多形态实体只拍当前形态）',
  'types.<type>.high|low.head': '头部特写取景来源：bone:<骨骼名>（含子骨骼）/ bone:<骨骼名>(own)（子树占了大半个身体时只取直接绑在头骨骼上的顶点）/ node:<节点名> / top28% / front35% / whole',
  'types.<type>.shots[]': '{ n, view, file, quality, camera }：1-front34 3/4 正面、2-side 正侧、3-back 背面、4-head 头部特写、5-low 低画质正面、6-level 首个出场层级出生点灯光下；多形态实体另有 7-form-<形态名>（非默认形态的 3/4 正面，骨架基础姿势）',
  'types.<type>.def': '实体定义里的 radius / height（对照 bbox 查形体偏差）',
  'types.<type>.level': '{ id, dist, offDeg, lightAt, sceneDrawCalls, spawn, note, error }：首个出场层级（BR.LEVEL_ORDER 顺序反查 entities 表，没有就退回 dev 层）；dist 是实体离玩家眼位的水平距离',
  'types.<type>.file|batch': '注册这个类型的实体文件 / tools/polish/batches.json 里的批次号',
  'types.<type>.errors|warns': '处理这个类型期间页面的 console.error / [arch] 警告',
  'types.<type>.complete': '该出的图和数据都齐了（--resume 据此跳过）',
  'types.<type>.ms': '摄影棚 / 层级镜头各自耗时（毫秒）',
  'summary': '整个 tag 按状态汇总（分片合并后重算）',
  'runs[]': '每次运行（每个分片）的参数、开始时间、耗时',
};

function readJsonSafe(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function writePng(file, dataUrl) { fs.writeFileSync(file, Buffer.from(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1), 'base64')); }
function parseShard(v) {
  if (!v || v === true) return null;
  const m = /^(\d+)\/(\d+)$/.exec(String(v));
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error('--shard 格式是 k/n（1 ≤ k ≤ n），收到 ' + v);
  return { k: +m[1], n: +m[2] };
}
// 类型 → 注册它的实体文件：静态扫 register( 之后最近的 type: '...'（一个文件注册多个变体的也能对上）
function scanEntityFiles() {
  const dir = path.join(ROOT, 'js', 'entities');
  const map = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== '_archetypes.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /register\(/g;
    let m;
    while ((m = re.exec(src))) {
      const t = /type:\s*'([A-Za-z0-9_]+)'/.exec(src.slice(m.index, m.index + 600));
      if (t && !map[t[1]]) map[t[1]] = 'js/entities/' + f;
    }
  }
  return map;
}
function batchOfFile() {
  const doc = readJsonSafe(path.join(POLISH, 'batches.json'), null);
  const out = {};
  for (const b of (doc && doc.batches) || []) for (const f of b.files || []) out[f] = b.id;
  return out;
}
// 分片并行时多个进程写同一份 gallery.json：mkdir 是原子操作，拿它当锁；读-合并-写临时文件-rename
function withLock(dir, fn) {
  const lock = path.join(dir, '.gallery.lock');
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // 分片进程被杀掉时锁会留下：两分钟没动过就当死锁清掉
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 120000) { fs.rmdirSync(lock); continue; } } catch (e) { /* 别人刚删掉 */ }
      if (Date.now() - t0 > 60000) throw new Error('等 gallery.json 锁超时：' + lock);
      sleepSync(40);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch (e) { /* 已清 */ } }
}
function summarize(doc) {
  const s = { types: 0, PASS: 0, KNOWN: 0, FAIL: 0, ERROR: 0, UNCHECKED: 0, fail: [], known: [], error: [], incomplete: [], withPageErrors: [] };
  for (const [t, r] of Object.entries(doc.types || {})) {
    s.types++;
    s[r.status] = (s[r.status] || 0) + 1;
    if (r.status === 'FAIL') s.fail.push(t);
    if (r.status === 'KNOWN') s.known.push(t);
    if (r.status === 'ERROR') s.error.push(t);
    if (!r.complete) s.incomplete.push(t);
    if (r.errors && r.errors.length) s.withPageErrors.push(t);
  }
  return s;
}
function mergeGallery(dir, tag, patch) {
  return withLock(dir, () => {
    const file = path.join(dir, 'gallery.json');
    const doc = readJsonSafe(file, null) || { tag, types: {}, runs: [] };
    doc.tag = tag;
    doc.version = 1;
    doc.tool = 'node tests/preview.mjs --gallery';
    doc.fields = GALLERY_FIELDS;
    doc.budget = { tris: BUDGET.tris, drawCalls: BUDGET.drawCalls, exceptionsFile: 'tools/polish/budget-exceptions.json' };
    if (patch.studio) doc.studio = patch.studio;
    doc.types = doc.types || {};
    if (patch.type) doc.types[patch.type.type] = patch.type;
    if (patch.run) {
      doc.runs = doc.runs || [];
      const i = doc.runs.findIndex(r => r.id === patch.run.id);
      if (i >= 0) doc.runs[i] = patch.run; else doc.runs.push(patch.run);
    }
    doc.types = Object.fromEntries(Object.keys(doc.types).sort().map(k => [k, doc.types[k]]));   // 按类型名排：两个 tag 的 json 能直接 diff
    doc.summary = summarize(doc);
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
    return doc;
  });
}
function judge(rec, exceptions, hasHigh) {
  const hi = rec.high;
  if (!hasHigh) return { status: 'UNCHECKED', statusWhy: '没拍 high 档，不判预算' };
  if (!hi) return { status: 'ERROR', statusWhy: rec.errors[0] ? String(rec.errors[0]).slice(0, 200) : 'high 档没出模型' };
  const dc = Math.max(hi.drawCalls || 0, hi.drawCallsStatic || 0);
  const over = [];
  if (hi.tris > BUDGET.tris) over.push(`三角面 ${hi.tris} > ${BUDGET.tris}`);
  if (dc > BUDGET.drawCalls) over.push(`draw call ${dc} > ${BUDGET.drawCalls}`);
  if (!over.length) return { status: 'PASS', statusWhy: null };
  const ex = exceptions[rec.type];
  if (ex) return { status: 'KNOWN', statusWhy: over.join('，') + '；已知例外：' + (ex.reason || '') };
  return { status: 'FAIL', statusWhy: over.join('，') };
}
async function startForShots(page, level) {
  const screen = await page.evaluate(() => BR.game.screen);
  if (screen !== 'home') {
    await page.evaluate(() => BR.bus.emit('game:home'));
    await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 15000 });
  }
  const info = await page.evaluate(id => __pv.gal.enterLevel(id), String(level));
  if (!info || !info.ok) throw new Error((info && info.error) || '进层失败：' + level);
  return info;
}

async function runGallery(browser, base) {
  const tag = arg('tag');
  if (!tag || tag === true || !/^[A-Za-z0-9_.-]+$/.test(String(tag))) {
    console.log('FAIL --gallery 需要 --tag <name>（只用字母、数字、_ . -，会拿来当目录名）');
    process.exitCode = 2;
    return;
  }
  const want = String(arg('gallery'));
  const qualities = [...new Set(String(arg('quality', 'high,low')).split(',').map(s => s.trim()))].filter(q => q === 'high' || q === 'low');
  if (!qualities.length) { console.log('FAIL --quality 只认 high、low（逗号分隔）'); process.exitCode = 2; return; }
  const primary = qualities.includes('high') ? 'high' : 'low';
  const size = Math.max(256, Math.min(1600, (+arg('size', 640)) | 0));
  const shard = parseShard(arg('shard'));
  const dir = path.join(OUT, String(tag));
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const exceptions = (readJsonSafe(path.join(POLISH, 'budget-exceptions.json'), {}) || {}).types || {};
  const fileOf = scanEntityFiles();
  const batchOf = batchOfFile();

  // 画幅设成正方形：层级镜头用游戏渲染器直接出图，和摄影棚的图一样大，联系表里对得齐
  const page = await bootHome(browser, base, { gallery: true, viewport: { width: size, height: size } });
  const cat = await page.evaluate(() => __pv.gal.catalog());
  const known = new Map(cat.types.map(t => [t.type, t]));
  // all 不含下划线开头的调试类型（_dev_* / _demo_*），要看就显式点名
  let names = want === 'all' ? cat.types.map(t => t.type).filter(n => !n.startsWith('_')) : want.split(',').map(s => s.trim()).filter(Boolean);
  names = [...new Set(names)].sort();
  const total = names.length;
  if (shard) { const per = Math.ceil(names.length / shard.n); names = names.slice((shard.k - 1) * per, shard.k * per); }
  if (arg('resume')) {
    const prev = readJsonSafe(path.join(dir, 'gallery.json'), null);
    const n0 = names.length;
    names = names.filter(n => {
      const r = prev && prev.types && prev.types[n];
      return !(r && r.complete && (r.shots || []).every(s => fs.existsSync(path.join(dir, s.file))));
    });
    console.log(`[gallery] --resume：跳过已出齐的 ${n0 - names.length} 种`);
  }
  const run = { id: process.pid + '-' + t0, at: new Date(t0).toISOString(), args: argv.join(' '), shard: shard ? shard.k + '/' + shard.n : null, types: names.slice(), ofTotal: total, ms: null, done: false };
  console.log(`[gallery] tag ${tag}：${names.length} 种${shard ? `（分片 ${shard.k}/${shard.n}，全集 ${total} 种）` : ''}，画质 ${qualities.join('+')}，${size}px，图元钩子 ${cat.primHook}`);

  await startForShots(page, 'dev');
  const studio = await page.evaluate(s => __pv.gal.initStudio(s), size);
  studio.levelCamera = '游戏渲染器与相机（fov 75，画幅同 --size），玩家出生点眼位看向实体包围盒中心；冻结灯光闪烁、重排灯池槽位';
  mergeGallery(dir, String(tag), { studio, run });
  if (errors.length) console.log('[gallery] 启动阶段页面报错：' + errors.slice(0, 5).join(' | '));

  const recs = new Map();
  for (const name of names) {
    const info = known.get(name);
    const file = fileOf[name] || null;
    const rec = {
      type: name, zh: info ? info.zh : null, en: info ? info.en : null, faction: info ? info.faction : null, version: info ? info.version : null,
      file, batch: file && batchOf[file] != null ? batchOf[file] : null, firstLevel: info ? info.firstLevel : null, def: null,
      status: 'ERROR', statusWhy: null, complete: false,
      high: null, low: null, shots: [], level: null, errors: [], warns: [], ms: { studio: 0, level: 0 },
    };
    recs.set(name, rec);
    if (!info) {
      rec.errors.push('没有注册实体 ' + name + '（拼错了？index.html 里有 script 吗？）');
      rec.statusWhy = '未注册';
      mergeGallery(dir, String(tag), { type: rec });
      console.log('ERROR ' + name + '：未注册');
      continue;
    }
    // 重拍前删掉这个类型的旧图：形态少了、机位改名之后，旧文件留着会被 --compare 当成还存在的镜头
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.png') && f.split('-')[0] === name && /-\d+-[a-z0-9_-]+\.png$/.test(f)) fs.unlinkSync(path.join(dir, f));
    const ts = Date.now(), e0 = errors.length, w0 = warns.length;
    for (const q of qualities) {
      const views = q === primary ? ['front34', 'side', 'back', 'head'] : [];
      if (q === 'low') views.push('low');
      let r;
      try { r = await page.evaluate(([t, qq, v]) => __pv.gal.studioShoot(t, qq, v), [name, q, views]); }
      catch (err) { r = { ok: false, error: String(err && err.message || err).slice(0, 600) }; }
      if (!r.ok) { rec.errors.push(q + '：' + r.error); continue; }
      rec[q] = r.stats;
      if (!rec.def) rec.def = { radius: r.def.radius, height: r.def.height };
      for (const s of r.shots) {
        const n = SHOT_N[s.view] || 7;   // 7-form-<形态名>：多形态实体的非默认形态
        const f = `${name}-${n}-${s.view}.png`;
        writePng(path.join(dir, f), s.png);
        rec.shots.push({ n, view: s.view, file: f, quality: q, camera: s.camera });
      }
    }
    rec.errors.push(...errors.slice(e0));
    rec.warns.push(...warns.slice(w0));
    rec.ms.studio = Date.now() - ts;
    Object.assign(rec, judge(rec, exceptions, qualities.includes('high')));
    mergeGallery(dir, String(tag), { type: rec });
    const hi = rec.high, lo = rec.low;
    const brief = s => s ? `${s.tris}△/${Math.max(s.drawCalls, s.drawCallsStatic)}dc` : '-';
    console.log(`${rec.status.padEnd(7)} ${name.padEnd(28)} hi ${brief(hi).padEnd(12)} lo ${brief(lo).padEnd(12)} 图元 ${hi ? hi.primitives : lo ? lo.primitives : '-'}  ${(rec.ms.studio / 1000).toFixed(1)} s${rec.statusWhy ? '  ' + rec.statusWhy : ''}`);
  }

  // 层级镜头：按首个出场层级分组，每层只进一次
  const groups = new Map();
  for (const rec of recs.values()) {
    if (!rec.high && !rec.low) continue;
    const L = rec.firstLevel != null ? rec.firstLevel : 'dev';
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(rec);
  }
  const order = cat.levels.filter(id => groups.has(id));
  for (const id of groups.keys()) if (order.indexOf(id) < 0) order.push(id);
  const expected = 4 + (qualities.includes('low') ? 1 : 0) + 1;
  for (const L of order) {
    let entered = null, enterErr = null;
    try { entered = await startForShots(page, L); } catch (err) { enterErr = String(err && err.message || err).slice(0, 600); }
    for (const rec of groups.get(L)) {
      const ts = Date.now(), e0 = errors.length, w0 = warns.length;
      rec.level = { id: L, note: rec.firstLevel == null ? '没有层级的 entities 表收录这个类型，退回 dev 层' : null };
      rec.shots = rec.shots.filter(s => s.view !== 'level');
      if (enterErr) rec.level.error = enterErr;
      else {
        let r;
        try { r = await page.evaluate(([t, q]) => __pv.gal.levelShot(t, q), [rec.type, primary]); }
        catch (err) { r = { ok: false, error: String(err && err.message || err).slice(0, 600) }; }
        if (!r.ok) rec.level.error = r.error;
        else {
          const f = `${rec.type}-6-level.png`;
          writePng(path.join(dir, f), r.png);
          rec.shots.push({ n: 6, view: 'level', file: f, quality: primary, camera: { fov: 75, eye: r.eye, entityAt: r.entityAt } });
          delete r.png; delete r.ok;
          const note = [rec.level.note, r.note].filter(Boolean).join('；') || null;
          Object.assign(rec.level, r, { note, spawn: entered.spawn, flickerFrozen: entered.flickerFrozen });
        }
      }
      rec.errors.push(...errors.slice(e0));
      rec.warns.push(...warns.slice(w0));
      rec.ms.level = Date.now() - ts;
      rec.complete = rec.shots.length >= expected && !rec.level.error;
      mergeGallery(dir, String(tag), { type: rec });
      console.log(`level   ${rec.type.padEnd(28)} L${L}  ${rec.level.error ? 'ERROR ' + rec.level.error : rec.level.dist + ' m，lightAt ' + rec.level.lightAt + '，场景 ' + rec.level.sceneDrawCalls + ' dc'}`);
    }
  }

  run.ms = Date.now() - t0;
  run.done = true;
  const doc = mergeGallery(dir, String(tag), { run });
  const mine = names.map(n => recs.get(n));
  const cnt = k => mine.filter(r => r.status === k).length;
  console.log(`\n===== --gallery ${tag}${shard ? ' 分片 ' + shard.k + '/' + shard.n : ''}：${mine.length} 种，PASS ${cnt('PASS')}，KNOWN ${cnt('KNOWN')}，FAIL ${cnt('FAIL')}，ERROR ${cnt('ERROR')}` +
    `，耗时 ${(run.ms / 1000).toFixed(1)} s（平均每种 ${(run.ms / 1000 / Math.max(1, mine.length)).toFixed(1)} s）`);
  for (const r of mine) if (r.status !== 'PASS') console.log(`  ${r.status} ${r.type}：${r.statusWhy || ''}`);
  const incomplete = mine.filter(r => !r.complete);
  if (incomplete.length) console.log('  没出齐：' + incomplete.map(r => r.type + (r.level && r.level.error ? '（' + r.level.error + '）' : '')).join('、'));
  for (const r of mine.filter(x => x.errors.length)) console.log(`  页面报错 ${r.type}：` + r.errors.slice(0, 3).join(' | '));
  console.log(`输出 ${path.relative(ROOT, dir)}/；gallery.json 全 tag 汇总 ${JSON.stringify({ types: doc.summary.types, PASS: doc.summary.PASS, KNOWN: doc.summary.KNOWN, FAIL: doc.summary.FAIL, ERROR: doc.summary.ERROR, incomplete: doc.summary.incomplete.length })}`);
  process.exitCode = mine.some(r => r.status === 'FAIL' || r.status === 'ERROR' || !r.complete || r.errors.length) ? 1 : 0;
}

// ---------- --stress ----------
async function runStress(browser, base) {
  const type = String(arg('stress'));
  const count = Math.max(1, (+arg('count', 28)) | 0);
  const frames = Math.max(10, (+arg('frames', 60)) | 0);
  const tag = arg('tag') && arg('tag') !== true ? String(arg('tag')) : null;
  const page = await bootHome(browser, base, { gallery: true });
  const cat = await page.evaluate(() => __pv.gal.catalog());
  const info = cat.types.find(t => t.type === type);
  if (!info) { console.log('FAIL --stress：没有注册实体 ' + type); process.exitCode = 1; return; }
  const raw = arg('level') && arg('level') !== true ? String(arg('level')) : (info.firstLevel != null ? info.firstLevel : 'dev');
  // 计划里写的是 --level L3，也认 --level 3
  const level = cat.levels.includes(raw) ? raw : (/^L/i.test(raw) && cat.levels.includes(raw.slice(1)) ? raw.slice(1) : raw);
  const entered = await startForShots(page, level);
  const e0 = errors.length;
  const r = await page.evaluate(([t, n, f]) => __pv.gal.stress(t, n, f), [type, count, frames]);
  if (!r.ok) { console.log('FAIL --stress：' + r.error); process.exitCode = 1; return; }
  const dir = tag ? path.join(OUT, tag) : path.join(OUT, 'stress');
  fs.mkdirSync(dir, { recursive: true });
  const stem = (tag ? 'stress-' : '') + `${type}-x${count}-L${level}`;
  writePng(path.join(dir, stem + '.png'), r.png);
  delete r.png; delete r.ok;
  const report = {
    ...r, level, levelSpawn: entered.spawn, flickerFrozen: entered.flickerFrozen, viewport: VIEW, drawCallBudget: 120,
    errors: errors.slice(e0), at: new Date().toISOString(), shot: stem + '.png',
    note: '帧时间 = __br.step(1/30)（AI + 动画 + 渲染）+ 1 像素 readPixels 同步 GPU；SwiftShader 软渲染，只拿来做同机前后对比',
  };
  fs.writeFileSync(path.join(dir, stem + '.json'), JSON.stringify(report, null, 2));
  console.log(`\n== --stress ${type} ×${count}（L${level}，${VIEW.width}×${VIEW.height}，${frames} 帧）：放下 ${r.placed}，视野内 ${r.inViewStart}→${r.inViewEnd}，落点 ${r.spots.minDist}–${r.spots.maxDist} m（扇面 ±${r.spots.widestCone}°）`);
  console.log(`   空场：平均帧 ${r.baseline.avgFrameMs} ms（中位 ${r.baseline.medianFrameMs}），draw call ${r.baseline.avgDrawCalls}`);
  console.log(`   满载：平均帧 ${r.loaded.avgFrameMs} ms（中位 ${r.loaded.medianFrameMs}，p90 ${r.loaded.p90FrameMs}），draw call 平均 ${r.loaded.avgDrawCalls} 最多 ${r.loaded.maxDrawCalls}，三角面 ${r.loaded.avgTriangles}，entities.update ${r.loaded.avgEntitiesUpdateMs} ms`);
  console.log(`   增量：帧 +${r.delta.frameMs} ms（×${r.delta.frameRatio}），draw call +${r.delta.drawCalls}`);
  check(`--stress ${type}：${count} 只全部放下`, r.placed === count, { placed: r.placed, spots: r.spots.found });
  check('--stress 全场 draw calls ≤ 120', r.loaded.maxDrawCalls <= 120, { max: r.loaded.maxDrawCalls });
  check('--stress 测试模式实体没打玩家', r.playerDamage === 0, { playerDamage: r.playerDamage });
  check('--stress 页面没有 console.error / 未捕获异常', report.errors.length === 0, report.errors.slice(0, 5));
  console.log('写入 ' + path.relative(ROOT, path.join(dir, stem + '.json')) + '，截图 ' + path.relative(ROOT, path.join(dir, stem + '.png')));
  console.log('PREVIEW_JSON ' + JSON.stringify(report));
  process.exitCode = results.some(x => !x.ok) ? 1 : 0;
}

// ---------- 入口 ----------
if (!arg('entity') && !arg('arch') && !arg('level-shots') && !arg('scale') && !arg('gallery') && !arg('stress')) {
  console.log('用法：node tests/preview.mjs --entity <type>[,<type>] [--with test_dummy,_dev_friendly] [--seconds 15] [--dist 5] [--mode test|nightmare] [--level dev] [--out dir]\n' +
    '      node tests/preview.mjs --arch\n' +
    '      node tests/preview.mjs --level-shots <id> [--mode test|casual|nightmare] [--shots N] [--out dir]\n' +
    '      node tests/preview.mjs --scale <id>\n' +
    '      node tests/preview.mjs --gallery all|<type,type..> --tag <name> [--quality high,low] [--shard k/n] [--resume] [--size 640] [--out tests/output/gallery]\n' +
    '      node tests/preview.mjs --stress <type> [--count 28] [--level 3] [--frames 60] [--tag <name>] [--out tests/output/gallery]');
  process.exit(2);
}
const srv = await startServer();
const base = 'http://127.0.0.1:' + srv.address().port + '/';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  if (arg('arch')) await runArch(browser, base);
  else if (arg('level-shots')) await runLevelShots(browser, base);
  else if (arg('scale')) await runScale(browser, base);
  else if (arg('gallery')) await runGallery(browser, base);
  else if (arg('stress')) await runStress(browser, base);
  else await runEntities(browser, base);
} catch (err) {
  console.log('FAIL 预览流程中断：' + (err && err.stack || err));
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
} finally {
  if (GALLERY_MODE) {
    // 出图模式一个页面开三个 WebGL 上下文，分片并行时偶发 browser.close() 在 Chrome 进程已经退掉之后还挂十几分钟不返回，
    // 分片脚本的 wait 就一直等不到：限时 15 s 关浏览器，再强制关掉静态服务的连接并退出
    await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 15000))]);
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
    process.exit(process.exitCode || 0);
  }
  await browser.close();
  srv.close();
}
