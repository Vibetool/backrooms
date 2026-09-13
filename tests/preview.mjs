// 后室 · 实体预览与验收（给实体代理用：代理不能开 Browser pane，靠这个脚本截图 + 打印行为日志）
//
//   node tests/preview.mjs --entity <type>[,<type>...] [--with test_dummy,_dev_friendly] [--seconds 15] [--dist 5]
//                          [--mode test|nightmare] [--level dev] [--out tests/output/preview]
//   node tests/preview.mjs --arch      BR.arch 地基自检：十个骨架各跑一场 + 全部构件三角面/外观 + 噩梦模式打玩家 + 28 只实体的 AI/动画耗时
//   node tests/preview.mjs --level-shots <id> [--mode test|casual|nightmare] [--shots N] [--out dir]
//                          进层看关：出生点四个朝向 + N 个 spawnPoints/出口附近各一张，打印 draw call/三角面/区块/实体/物品/出口/env
//   node tests/preview.mjs --scale <id>        数量比例自检：游玩满格与噩梦四档的期望实体总数比值应为 0.5:0.2:0.4:0.6:0.9
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
const OUT = path.resolve(ROOT, String(arg('out', 'tests/output/preview')));
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
      const rec = { name, tris: A.trisOf(obj) };
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

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
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
async function bootHome(browser, base) {
  const page = await newPage(browser);
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(400);
  const archOk = await page.evaluate(() => !!(BR.arch && BR.arch.version));
  if (!archOk) throw new Error('BR.arch 没有加载（index.html 里 js/entities/_archetypes.js 报错或缺失）');
  await page.evaluate(installHelpers);
  await injectMissingScripts(page);
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
      const ok = p.unitTris != null ? p.unitTris < 300 && p.tris < 3000 : p.tris < 3000;
      check('构件 ' + p.name + ' 三角面在预算内', ok, p);
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
  const want = { casual: 0.5, easy: 0.2, medium: 0.4, hard: 0.6, hell: 0.9 };
  const base0 = r.totals[0].total || 0;
  // 期望总数正比于 spawnFactor（同一份 entities 表、同一批区块），比值该和 spawnFactor 本身一致
  const ok = r.entities.length === 0 || r.totals.every(t => Math.abs((t.total / base0) - (want[t.key] / want.casual)) < 1e-6);
  check('--scale ' + levelId + '：实体总数比值 = spawnFactor 比值（0.5:0.2:0.4:0.6:0.9）', ok, r.totals.map(t => t.key + '=' + t.total));
  console.log('PREVIEW_JSON ' + JSON.stringify({ scale: r }));
  process.exitCode = ok ? 0 : 1;
}

// ---------- 入口 ----------
if (!arg('entity') && !arg('arch') && !arg('level-shots') && !arg('scale')) {
  console.log('用法：node tests/preview.mjs --entity <type>[,<type>] [--with test_dummy,_dev_friendly] [--seconds 15] [--dist 5] [--mode test|nightmare] [--level dev] [--out dir]\n' +
    '      node tests/preview.mjs --arch\n' +
    '      node tests/preview.mjs --level-shots <id> [--mode test|casual|nightmare] [--shots N] [--out dir]\n' +
    '      node tests/preview.mjs --scale <id>');
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
  else await runEntities(browser, base);
} catch (err) {
  console.log('FAIL 预览流程中断：' + (err && err.stack || err));
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.close();
}
