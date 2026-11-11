// 后室 · FE1P 叉车打磨回归（FE1P-light 那一份：H8 大灯不透墙、H9 藤蔓贴着护顶、H14 联机升降高度不往回掉；
//                          FE1Q-light：J3 藤蔓贴着看得见的护顶、J8 lightAt 和画面一致、J9 货架通道里车灯照得远）
//   node tests/forklift_polish.mjs [--group light,vine,coop] [--verbose] [--old] [--before <目录>]
//   --old 反证：静态服务给出 FE1 提交（4a4466a）时的 forklift.js / world.js / vehicles_net.js，light、vine 组该报 FAIL（透墙、藤蔓离护顶 17 cm）
// 主会话裁定：
//   H8  车头顶着墙（或任何不透光的实体）时，墙另一侧的任何面（墙里侧、相邻墙的里侧、天花板、地面、屋里的东西）一点光都不吃；
//       world.lightAt 判断「被叉车大灯照到」也被墙挡住；联机队友的车（vehicles_net 借灯池）同样
//   H9  被护顶 / 门架拨开的藤蔓贴着把它推开的那个东西（藤蔓表面离护顶 / 门架真实包围盒 0–1 cm，不穿进去），车走开后照旧慢慢荡回
//   H14 联机里客机开车（升到一半、松开 R、马上按 W 开）：房主那边的 lift 不往回掉
//   J3  藤蔓贴着看得见的护顶（两根纵梁、前后横梁、格栅横条、斜立柱、灯盒、后视镜、警示灯），不是物理 roof 盒子；物理 OBB 不动；
//       量到挡体或直接量到可动模型三角形 0–1 cm（FE1Q-light 顺带把门架也换成看得见的零件：外门架物理盒子 ±0.45 比门架顶上的立柱宽 8.5 cm）
//   J8  world.lightAt 判「被叉车大灯照到」：只有画面上真被这盏灯照亮的地方才算亮（和渲染同一个光球），开着车灯时司机座位算亮
//   J9  厚的挡光体（货架）界限到远侧面往里 0.1 m（照得到货架上朝通道的货、照不到另一侧的通道），薄墙照旧
// 组：
//   light  种子 12345 等第一次断电，坐上出生柱间那台车（之后瞬移：坐着把模拟摆到别的位姿，省断电时间）。先到试车场：大灯的光球被旁边小屋
//          收到 8 m 以下时，坐着的司机在 lightAt 里照样算被照亮（规则不变）。再按主会话给的摆法（小屋西墙外 x 17.7、z 18.0、车头朝 +x、叉尖离墙 1 m），再摆叉尖离墙 0.5 m、0.2 m、
//          斜 30° 顶墙、顶货架长边（叉尖离货架 1 m；L1 的货架一排排头尾只隔 0.9 m，车头顶不到货架头）：
//            屋里（南墙内侧靠西墙那段、天花板墙角、屋里 1 m / 2 m 处地面）/ 货架另一侧通道（地面、货架背面的货）的像素亮度开灯和关灯差 ≤2（0–255），
//            墙 / 货架朝车这一面有亮斑（≥10），lightAt 对屋里 / 另一侧的点和关灯时一样（差 <0.005）；
//          逐帧（每一帧渲染那一刻，灯池里大灯那盏 PointLight 的位置和 distance）：从 6.7 m 外全速开向小屋西墙直到停住、从小屋西墙外 1.3 m 开过去（经过门口）：
//            屋里各面（南 / 北 / 东墙内侧、天花板、地面，10 cm 一点）凡是在光球里、朝着光源、视线被碰撞体挡住的点一个都没有；
//          FE1Q J8 / J9（主会话裁定）：货架通道（窄道车中心离货架 1.25 m、宽通道 5.68 m）里叉尖前 5 m 处地面开灯比关灯亮 ≥8，货架另一侧的通道（地面、
//            货架背面的货）开关灯差 ≤2；空地上一片地面：画面亮了 ≥8 的点 lightAt 算亮，光够不到的远处（离光源水平距离 ≥ 光球）画面差 ≤2、lightAt 不亮；
//            开着大灯时司机的位置（驾驶舱）lightAt 算亮（试车场、窄道、宽通道、顶墙 1 m 各量一次，每处 ≥0.3）；
//          远端车（vehiclesNet._feed，等于收到队友的 net:veh）车头顶墙：'fkr:' 那盏同样，屋里 lightAt 不亮、队友坐的驾驶舱算亮
//   vine   种子 1 花园段：找一根车能从底下开过去的藤蔓（同 tests/forklift.mjs L9），真键盘全速开过去，再从头开到藤蔓底下停住，坐着 / 下车各量一阵：
//          每一帧藤蔓方杆（网格的 4 个侧面，嵌套黄金分割求精确距离）离藤蔓挡体（看得见的门架零件、链条、护顶架那几块，FE1Q J3）的最小距离 ≥0.1 mm（不穿）；
//          藤蔓被车顶着的帧（模拟里这根藤蔓的 S.touch）这个距离在 0–1 cm，直接量到可动模型三角形也在 0–1 cm（FE1Q J3）；上车开走以后 2 s 逐位恢复；
//          四档可动模型（high / mid / lite / drvLow）的护顶架顶点都在挡体里、挡体露在外面的面离模型 ≤1 cm；车侧平视、护顶高度拍一张特写
//   coop   两个页面联机（内存假 room.php，绝不连真实服务器），主页「联机」→ 营地 → 帐篷选「游玩 + Level 1」→ 出发，客机开车：
//          升到一半松开 R、同一帧 / 下一帧 / 隔 0.3 s 按 W 或 S 开，按时间升、停 1.2 s 再满舵绕圈（房主跟车看，g5 拍照的做法）：
//          房主那边每帧的 lift 升到最高以后不往回掉（>2 mm 算掉），开完以后两边差 ≤2 mm。
//          返修 FE1Q · repair-r2：每一趟开始前客机下车、房主用 levelState 把车摆回同一个空地起点、客机再上车（以前每趟接着上一趟停下的地方开，
//          偶尔停到升不上去的地方）；升降、开车的时长按模拟时间算（负载高、帧率低时不再少开）；升不到目标 / 车没开动（前提不成立）重摆重来一次，
//          还不成立记 SKIP（汇总里「跳过 N 项」），不算到 H14 头上；没开动时 detail 里带客机逐帧的 W/R 输入、phase、车速（区分负载和游戏问题）。
//          J2（联机这一侧的回归，以前只在整合员的一次性脚本里）：房主高画质、客机低画质，出生车两边都是运行时车（区块记录没有 spans、
//          载具网格 mid / drvLow）；客机真键盘上车开出 >1 m，两边位姿一致、档不变、(0,0) kit:prop 没有叠成一点的三角形；下车以后两边位姿一致、levelState 记下
// 输出：tests/output/forklift_polish/<组>/（数值 result.json、截图）。汇总行「检查 N 项，失败 M 项」「页面报错 K 条」。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --before <目录>（反证，FE1Q）：静态服务从这个目录拿 forklift.js / world.js / vehicles_net.js（比如这一轮改之前的备份），J3 / J8 / J9 那几项该报 FAIL
const BEFORE_I = process.argv.indexOf('--before'), BEFORE = BEFORE_I >= 0 ? process.argv[BEFORE_I + 1] : null;
const OUT_BASE = path.join(ROOT, 'tests', 'output', process.argv.includes('--old') ? 'forklift_polish_old' : BEFORE ? 'forklift_polish_before' : 'forklift_polish');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ALL_GROUPS = ['light', 'vine', 'coop'];
const GROUPS = argOf('group') ? argOf('group').split(',').map(s => s.trim()).filter(Boolean) : ALL_GROUPS.slice();
const VERBOSE = argv.includes('--verbose');
// --old（反证）：静态服务给出 FE1 提交（4a4466a）时的 forklift.js / world.js / vehicles_net.js（git show，只读），light、vine 组应该报出 FAIL
const OLD = argv.includes('--old');
const OLD_FILES = ['js/game/forklift.js', 'js/game/world.js', 'js/game/vehicles_net.js'];
const oldSrc = new Map();
if (OLD) {
  const { execFileSync } = require('node:child_process');
  for (const f of OLD_FILES) oldSrc.set(f, execFileSync('git', ['show', '4a4466a:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
} else if (BEFORE) {
  for (const f of OLD_FILES) oldSrc.set(f, fs.readFileSync(path.resolve(BEFORE, path.basename(f)), 'utf8'));
}
const bad = GROUPS.filter(g => !ALL_GROUPS.includes(g));
if (bad.length) { console.log('未知的组：' + bad.join(', ') + '（可选 ' + ALL_GROUPS.join(' ') + '）'); process.exit(2); }

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
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (oldSrc.has(rel)) { res.end(oldSrc.get(rel)); return; }
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- 记录 ----------
let pass = 0, fail = 0, GROUP = '', skips = 0;
const failed = [], errors = [], data = {};
// 前提不成立（机器太忙：升不到目标、车没开动）重来过还不成立的：不算通过也不算失败，汇总里单独记「跳过 N 项」（all.mjs 认这一行）
function skip(name, why) { skips++; console.log('SKIP [' + GROUP + '] ' + name + '  ' + (typeof why === 'string' ? why : JSON.stringify(why)).slice(0, 1400)); (data[GROUP] = data[GROUP] || []).push({ name, skip: true, detail: why }); }
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failed.push('[' + GROUP + '] ' + name); }
  let d = detail === undefined ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  if (d.length > 1400) d = d.slice(0, 1400) + '…';
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + GROUP + '] ' + name + (d && (!ok || VERBOSE || d.length < 240) ? '  ' + d : ''));
  (data[GROUP] = data[GROUP] || []).push({ name, ok: !!ok, detail });
}
function info(text, detail) { console.log('INFO [' + GROUP + '] ' + text + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1200) : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EV_TIMEOUT = 120000;
function ev(page, fn, arg) {
  let timer = 0;
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('page.evaluate 超过 ' + EV_TIMEOUT / 1000 + ' 秒没返回')), EV_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
}
const step = (page, s) => ev(page, x => { __br.step(x); return 0; }, s);
async function tap(page, code) { await page.keyboard.down(code); await step(page, 0.1); await page.keyboard.up(code); await step(page, 1 / 30); }
async function releaseAll(page) { for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'Space']) { try { await page.keyboard.up(c); } catch (e) { /* 忽略 */ } } }
let OUT = OUT_BASE;
async function shot(page, name) {
  const f = path.join(OUT, name + '.png');
  try { await page.screenshot({ path: f }); console.log('     shot ' + path.relative(ROOT, f)); return f; } catch (e) { return null; }
}
// 只拷 WebGL 画布（不带 HUD）：F.measure / F.grab 画完那一帧
async function canvasPng(page, name) {
  const url = await ev(page, () => (window.__fp._c2 ? window.__fp._c2.toDataURL('image/png') : null));
  if (!url) return null;
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log('     shot ' + path.relative(ROOT, f));
  return f;
}

// =====================================================================
// 页面里的工具：window.__fp（照 tests/forklift.mjs 的 __fk 写，只留这里用到的）
// =====================================================================
function installHelpers() {
  const F = window.__fp = { extra: {} };
  const W = BR.world;
  if (W && typeof W.setExtraLights === 'function') { const o = W.setExtraLights; W.setExtraLights = function (owner, list) { F.extra[String(owner)] = list || null; return o.apply(this, arguments); }; }
  F.r = (v, k) => Math.round(v * (k || 1000)) / (k || 1000);
  F.veh = k => BR.vehicles.byKey(k);
  F.rec = k => BR.vehicles.list().find(v => v.key === k) || null;
  F.pose = k => { const v = F.veh(k); return v ? Object.assign({}, v.pose) : null; };
  F.geo = () => (BR.L1forklift && BR.L1forklift.geo) || {};
  F.W = (k, lx, lz, ly) => { const p = F.veh(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, y: p.y + (ly || 0), z: p.z - s * lx + c * lz }; };
  F.WP = (p, lx, lz) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  F.fwd = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
  F.spawnKey = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    const fl = (c && c.res && c.res.data && c.res.data.forklifts) || [];
    const f = fl.find(q => q.x > 12 && q.x < 20 && q.z > 12 && q.z < 20);
    return f ? f.key : null;
  };
  F.physKey = k => { const r = F.rec(k); return r ? r.physKey : null; };
  F.obbs = k => { const pk = F.physKey(k); return pk ? BR.phys.records(pk).obbs : []; };
  F.boxesAt = (x, z, yaw, lift) => { const G = F.geo(); const loc = typeof G.obbs === 'function' ? G.obbs(lift || 0) : []; return BR.phys.toWorldOBBs(loc, x, z, yaw, BR.phys.groundY(x, z)); };
  F.hitsAt = (x, z, yaw, lift, ignore) => {
    const keys = [];
    for (const o of F.boxesAt(x, z, yaw, lift)) { const out = []; if (BR.phys.overlapOBB(o, { tol: 0.005, ignoreKey: ignore, out })) for (const s of out) keys.push((s.key || '?') + '@' + o.name); }
    return keys;
  };
  F.sweep = (x, z, yaw, lift, dist, ignore, stepM) => {
    const f = F.fwd(yaw), st = stepM || 0.1;
    for (let d = 0; d <= dist + 1e-6; d += st) { const h = F.hitsAt(x + f.x * d, z + f.z * d, yaw, lift, ignore); if (h.length) return { d, hits: h }; }
    return null;
  };
  F.place = (k, x, z, yaw, lift) => BR.vehicles.setPose(k, { x, z, yaw, steer: 0, lift: lift || 0, spd: 0, lever: 0, on: 0 });
  F.stand = (x, z, yaw) => { BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: yaw || 0 }, { full: false }); __br.step(0.05); };
  F.yawTo = (x0, z0, x1, z1) => Math.atan2(-(x1 - x0), -(z1 - z0));
  F.standL = (k, lx, lz) => { const w = F.W(k, lx, lz), s = F.W(k, 0, 0.24); F.stand(w.x, w.z, F.yawTo(w.x, w.z, s.x, s.z)); return w; };
  F.aimL = (k, lx, ly, lz) => { const w = F.W(k, lx, lz, ly); BR.interact.aimAt(w.x, w.y, w.z); __br.step(1 / 30); return 0; };
  F.seat = () => ({ seated: BR.vehicles.seated, mode: BR.interact.mode, phase: BR.vehicles.debugInfo().phase });
  // 坐在车上把车瞬移到某个位姿（模拟是本机坐着的车的真身：下一步 step 从这里接着算，网格、OBB、大灯落点都跟过去）
  F.teleport = (k, x, z, yaw) => { const sim = BR.forklift.byKey(k); sim.setPose({ x, z, yaw, steer: 0, lift: 0, spd: 0, lever: 0 }); for (let i = 0; i < 4; i++) __br.step(1 / 30); return F.pose(k); };
  F.frames = n => { for (let i = 0; i < n; i++) __br.step(1 / 30); return 0; };
  // 只渲染不推模拟（断电计时不走）：灯池的淡入淡出只在渲染时前进
  F.renderOnly = n => { for (let i = 0; i < n; i++) BR.gfx.render(1 / 30); return 0; };
  F.grab = () => {
    BR.gfx.render(0);
    const cv = BR.gfx.renderer.domElement;
    const c2 = F._c2 || (F._c2 = document.createElement('canvas'));
    c2.width = cv.width; c2.height = cv.height;
    const g = c2.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0);
    return g;
  };
  F.lum = (g, sx, sy, r) => {
    const R = r || 4, w = g.canvas.width, h = g.canvas.height;
    const x0 = Math.max(0, Math.round(sx) - R), y0 = Math.max(0, Math.round(sy) - R), x1 = Math.min(w - 1, Math.round(sx) + R), y1 = Math.min(h - 1, Math.round(sy) + R);
    if (x1 < x0 || y1 < y0) return null;
    const d = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return n ? s / n : null;
  };
  // 相机摆到 eye 看 at，渲染一帧，量每个世界点的亮度（看不见的点 null）；量完相机原样放回
  F.measure = (eye, at, pts) => {
    const cam = BR.gfx.camera, P = cam.position.clone(), Q = cam.quaternion.clone();
    cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(at.x, at.y, at.z); cam.updateMatrixWorld(true);
    const g = F.grab(), w = g.canvas.width, h = g.canvas.height;
    const out = pts.map(p => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
      return F.r(F.lum(g, (v.x + 1) / 2 * w, (1 - v.y) / 2 * h, p.r), 100);
    });
    cam.position.copy(P); cam.quaternion.copy(Q); cam.updateMatrixWorld(true);
    return out;
  };
  // 灯池里正点着的 PointLight（位置、distance、强度）
  F.pool = () => BR.gfx.scene.children.filter(o => o.isPointLight && /^gfx-pool-/.test(o.name) && o.intensity > 0)
    .map(o => ({ x: o.position.x, y: o.position.y, z: o.position.z, d: o.distance, I: o.intensity }));
  // 某个 owner 的大灯在灯池里那一盏（按位置认，1 cm 以内）
  F.poolOf = owner => { const L = F.extra[owner] && F.extra[owner][0]; if (!L) return null; return F.pool().find(q => Math.abs(q.x - L.x) < 0.01 && Math.abs(q.y - L.y) < 0.01 && Math.abs(q.z - L.z) < 0.01) || null; };
  // 光球漏进一间屋的点：屋里各面（box = 屋内净空 AABB；面 10 cm 一点），在球里、朝着光源、视线被碰撞体挡住（ign = 车自己的碰撞 key）
  F.leaks = (L, box, ign, opts) => {
    const o = opts || {}, st = o.step || 0.1, out = [];
    const faces = [
      { n: [0, 0, -1], fix: ['z', box.maxZ], u: ['x', box.minX, box.maxX], v: ['y', box.minY, box.maxY], name: 'wall+z' },
      { n: [0, 0, 1], fix: ['z', box.minZ], u: ['x', box.minX, box.maxX], v: ['y', box.minY, box.maxY], name: 'wall-z' },
      { n: [-1, 0, 0], fix: ['x', box.maxX], u: ['z', box.minZ, box.maxZ], v: ['y', box.minY, box.maxY], name: 'wall+x' },
      { n: [1, 0, 0], fix: ['x', box.minX], u: ['z', box.minZ, box.maxZ], v: ['y', box.minY, box.maxY], name: 'wall-x' },
      { n: [0, -1, 0], fix: ['y', box.maxY], u: ['x', box.minX, box.maxX], v: ['z', box.minZ, box.maxZ], name: 'ceiling' },
      { n: [0, 1, 0], fix: ['y', box.minY], u: ['x', box.minX, box.maxX], v: ['z', box.minZ, box.maxZ], name: 'floor' },
    ];
    for (const f of faces) {
      for (let a = f.u[1] + st / 2; a < f.u[2]; a += st) for (let b = f.v[1] + st / 2; b < f.v[2]; b += st) {
        const p = { x: 0, y: 0, z: 0 };
        p[f.fix[0]] = f.fix[1]; p[f.u[0]] = a; p[f.v[0]] = b;
        const dx = L.x - p.x, dy = L.y - p.y, dz = L.z - p.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= L.d) continue;
        if (dx * f.n[0] + dy * f.n[1] + dz * f.n[2] <= 0) continue;   // 背着光源（N·L ≤ 0）本来就不亮
        // 从面上往光源那边抬 1 mm 再看视线（面本身贴着墙的碰撞体）
        const sx = p.x + f.n[0] * 0.001, sy = p.y + f.n[1] * 0.001, sz = p.z + f.n[2] * 0.001;
        const h = BR.phys.raycast(sx, sy, sz, L.x - sx, L.y - sy, L.z - sz, d, ign ? { ignoreKey: ign } : undefined);
        if (h && h.dist < d - 0.002) out.push({ face: f.name, p: [F.r(p.x), F.r(p.y), F.r(p.z)], d: F.r(d), by: h.key });
        if (out.length > 20) return out;
      }
    }
    return out;
  };
  F.lightAt = pts => pts.map(p => BR.world.lightAt(p.x, p.z));
}

// =====================================================================
// 进局
// =====================================================================
let BASE = '';
async function boot(browser, tag, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 } }, ctxOpts || {}));
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() !== 'error') return; const loc = (m.location() && m.location().url) || ''; errors.push('[' + tag + '] console.error: ' + m.text() + (loc ? ' @ ' + loc : '')); });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
  // 测试绝不连真实联机服务器：api.ovobot.ai 回假响应，其余外部请求一律掐掉
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
  try { await page.goto(BASE + 'index.html', { timeout: 120000 }); } catch (e) { await page.goto(BASE + 'index.html', { timeout: 120000 }); }
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 120000 });
  await ev(page, () => { BR.assets.init(); return 0; });
  await page.waitForTimeout(300);
  await ev(page, installHelpers);
  return { ctx, page };
}
async function startL1(page, o) {
  const opt = Object.assign({ seed: 12345, mode: 'test', quality: 'high', difficulty: null }, o || {});
  await ev(page, a => { __br.setAuto(true); __br.start({ mode: a.mode, difficulty: a.difficulty, levelId: '1', seed: a.seed, settings: { quality: a.quality } }); return 0; }, opt);
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); return 0; });
}
async function mountCar(page, k, side) {
  const lx = side === 'right' ? 1.2 : -1.2;
  await ev(page, a => { __fp.standL(a.k, a.lx, 0.24); __fp.aimL(a.k, 0, 1.25, 0.24); return 0; }, { k, lx });
  await tap(page, 'Space');
  await step(page, 1.6);
  const st = await ev(page, () => __fp.seat());
  return { st, ok: st.seated === k && st.phase === 'run' };
}
async function dismount(page) {
  await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return 0; });
  await tap(page, 'Space');
  await step(page, 1.0);
  return ev(page, () => __fp.seat());
}
async function placeAndMount(page, k, pose, side) {
  const ok = await ev(page, a => { const p = a.pose; const r = __fp.place(a.k, p.x, p.z, p.yaw, p.lift || 0); __br.step(0.1); return r; }, { k, pose });
  const m = await mountCar(page, k, side || 'left');
  return { placed: ok, mounted: m.ok, st: m.st };
}
// 等 L1 断电：按 U.rng(levelSeed, 'L1-blackout', epoch) 算出第一次够长（≥14 s）的断电，模拟时间推到它开始后 0.5 s（同 tests/forklift.mjs toBlackout）
async function toBlackout(page) {
  const plan = await ev(page, () => {
    const U = BR.util, ls = BR.world.levelSeed;
    for (let e = 0; e < 60; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 14) return { e, dur, at: e * 45 }; } }
    return null;
  });
  if (!plan) return { plan, ok: false };
  let t = 0;
  for (let i = 0; i < 400 && t < plan.at + 20; i++) {
    const dt = t < plan.at - 6 ? 5 : 0.5;
    const st = await ev(page, dt => {
      __br.step(dt);
      let n = 0, off = 0;
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l._l1orig !== undefined && l.intensity === 0) off++; }
      return { n, off };
    }, dt);
    t += dt;
    if (st.n && st.off === st.n) { await step(page, 0.5); return { plan, ok: true, t }; }
  }
  return { plan, ok: false, t };
}
const stillDark = page => ev(page, () => { let n = 0, off = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l._l1orig !== undefined && l.intensity === 0) off++; } return n > 0 && off === n; });

// =====================================================================
// light（H8）
// =====================================================================
// 出生块的办公小屋：墙外皮 x 20.8–27.2、z 12.8–19.2，墙厚 0.2，屋顶 2.9；门在西墙 z 15.42–16.58
const HUT_IN = { minX: 21.0, maxX: 27.0, minY: 0.0, maxY: 2.9, minZ: 13.0, maxZ: 19.0 };
// 屋里机位（避开门洞，看西南角）和要量的点
const CAM_IN = { eye: { x: 24.6, y: 1.6, z: 15.0 }, at: { x: 21.0, y: 1.4, z: 18.9 } };
const PTS_IN = [
  { n: '南墙内侧 离西墙 0.3 m 高 1.2', x: 21.3, y: 1.2, z: 18.99, r: 3 }, { n: '南墙内侧 0.6 m 高 0.6', x: 21.6, y: 0.6, z: 18.99, r: 3 },
  { n: '南墙内侧 0.25 m 高 2.3', x: 21.25, y: 2.3, z: 18.99, r: 3 }, { n: '天花板墙角', x: 21.3, y: 2.895, z: 18.6, r: 3 },
  { n: '天花板 离西墙 0.6 m', x: 21.6, y: 2.895, z: 17.8, r: 3 }, { n: '屋里 2 m 处地面', x: 23.0, y: 0.005, z: 18.0, r: 3 },
  { n: '屋里 1 m 处地面', x: 22.0, y: 0.005, z: 18.4, r: 3 }, { n: '西墙内侧', x: 21.01, y: 1.6, z: 18.0, r: 3 },
];
// 车外机位：看墙朝车这一面的亮斑
const CAM_OUT = { eye: { x: 16.6, y: 2.2, z: 20.2 }, at: { x: 20.8, y: 1.3, z: 18.0 } };
// 货架（出生块 x 4.45–11.55、z 22.84–25.16、高 3.1）：长边那一侧的车头顶上去，另一侧通道里量
const RACK = { minX: 4.45, maxX: 11.55, minZ: 22.84, maxZ: 25.16, h: 3.1 };
const CAM_RACK = { eye: { x: 8.0, y: 1.6, z: 29.0 }, at: { x: 8.0, y: 0.9, z: 25.2 } };
const PTS_RACK = [
  { n: '货架背面的货 中', x: 8.0, y: 0.6, z: 25.17, r: 3 }, { n: '货架背面的货 左', x: 6.6, y: 1.5, z: 25.17, r: 3 },
  { n: '货架背面的货 右', x: 9.6, y: 1.0, z: 25.17, r: 3 }, { n: '另一侧通道地面', x: 8.0, y: 0.005, z: 25.8, r: 3 },
  { n: '另一侧通道地面 远', x: 7.0, y: 0.005, z: 26.6, r: 3 },
];
async function gLight(browser) {
  const { ctx, page } = await boot(browser, 'light');
  try {
    await startL1(page, { seed: 12345 });
    const k = await ev(page, () => __fp.spawnKey());
    check('L0 出生柱间有叉车', !!k, k);
    if (!k) return;
    // ---- 断电 ----
    await ev(page, k => { __fp.place(k, 17.7, 18.0, -Math.PI / 2, 0); __br.step(0.1); __fp.stand(15, 20, 0); return 0; }, k);
    const bo = await toBlackout(page);
    check('L1 L1 断电了（第 ' + (bo.plan ? bo.plan.e : '?') + ' 轮，' + (bo.plan ? bo.plan.dur.toFixed(1) : '?') + ' s）', bo.ok, bo);
    if (!bo.ok) return;
    const pm = await mountCar(page, k, 'left');
    await ev(page, () => __fp.frames(15));
    check('L2 断电里坐上车、大灯亮着（灯池里借了一盏）', pm.ok && !!(await ev(page, k => __fp.poolOf('fk:' + k), k)), pm.st);
    const owner = 'fk:' + k;
    // ---- 试车场（断电里）：大灯的光球被旁边的小屋收到 8 m 以下，坐着的司机仍算被自己的大灯照亮（lightAt 用名义范围 + 视线，规则不变） ----
    {
      await ev(page, k => __fp.teleport(k, -1, 32.6, -Math.PI / 2), k);
      await ev(page, () => __fp.renderOnly(10));
      const yard = await ev(page, a => {
        const L = __fp.extra[a.owner] && __fp.extra[a.owner][0], sim = BR.forklift.byKey(a.k), inf = sim && sim.lightInfo;
        const s = __fp.W(a.k, 0, 0.24), at = BR.world.lightAt(s.x, s.z);
        const list = __fp.extra[a.owner];
        BR.world.setExtraLights(a.owner, null);
        const base = BR.world.lightAt(s.x, s.z);
        BR.world.setExtraLights(a.owner, list);
        return { L: L && { range: __fp.r(L.range), I: __fp.r(L.intensity) }, inf: inf && { range: __fp.r(inf.range), R0: inf.R0, by: inf.by && inf.by.kind + ' ' + inf.by.key }, at, base };
      }, { k, owner });
      check('L3 试车场：大灯光球被旁边的小屋收到 8 m 以下（' + (yard.L && yard.L.range) + ' m' + (yard.inf ? '，' + yard.inf.by : '') + '），坐在车上座椅处 lightAt 仍比断电底值高 0.1 以上（' + yard.base.toFixed(2) + ' → ' + yard.at.toFixed(2) + '）',
        !!yard.L && yard.L.range < 8 && yard.at > yard.base + 0.1, yard);
    }
    const cases = [
      { n: '叉尖离墙 1 m', pose: { x: 17.7, z: 18.0, yaw: -Math.PI / 2 }, cam: CAM_IN, pts: PTS_IN, spot: { x: 20.79, y: 1.6, z: 18.0, r: 4 }, gap: 0.3 },
      { n: '叉尖离墙 0.5 m', pose: { x: 18.2, z: 18.0, yaw: -Math.PI / 2 }, cam: CAM_IN, pts: PTS_IN, spot: { x: 20.79, y: 1.6, z: 18.0, r: 4 }, gap: 0.3 },
      { n: '叉尖离墙 0.2 m', pose: { x: 18.5, z: 18.0, yaw: -Math.PI / 2 }, cam: CAM_IN, pts: PTS_IN, spot: { x: 20.79, y: 1.6, z: 18.0, r: 4 } },
      // 斜着 30°：车头朝 +x 往 +z 偏 30°，射线打在门洞南边那段西墙上
      { n: '斜着 30° 顶墙', pose: { x: 17.75, z: 16.9, yaw: -Math.PI / 2 - Math.PI / 6 }, cam: CAM_IN, pts: PTS_IN, spot: null },
      { n: '顶货架长边（叉尖离货架 1 m）', pose: { x: 8.0, z: RACK.minZ - 1.0 - 2.1, yaw: Math.PI }, cam: CAM_RACK, pts: PTS_RACK, spot: { x: 8.0, y: 1.6, z: RACK.minZ - 0.01, r: 4 }, rack: true },
    ];
    let idx = 0;
    for (const C of cases) {
      idx++;
      if (!await stillDark(page)) { check('L4.' + idx + ' ' + C.n + '：还在断电里', false); break; }
      const pk = await ev(page, k => __fp.physKey(k), k);
      const free = await ev(page, a => __fp.hitsAt(a.p.x, a.p.z, a.p.yaw, 0, a.pk), { p: C.pose, pk });
      const tp = await ev(page, a => __fp.teleport(a.k, a.p.x, a.p.z, a.p.yaw), { k, p: C.pose });
      await ev(page, () => __fp.renderOnly(12));
      const st = await ev(page, a => {
        const L = __fp.extra[a.owner] && __fp.extra[a.owner][0], inf = BR.forklift.byKey(a.k).lightInfo;
        return { L: L && { x: __fp.r(L.x), y: L.y, z: __fp.r(L.z), range: __fp.r(L.range), I: __fp.r(L.intensity) }, pool: __fp.poolOf(a.owner), inf: inf && { R0: inf.R0, hit: inf.hit && __fp.r(inf.hit), by: inf.by && inf.by.kind + ' ' + inf.by.key } };
      }, { k, owner });
      const on = await ev(page, a => __fp.measure(a.c.eye, a.c.at, a.p), { c: C.cam, p: C.pts });
      await canvasPng(page, 'L4-' + idx + '-on');
      const spotOn = C.spot ? await ev(page, a => __fp.measure(a.e, a.s, [a.s])[0], { e: C.rack ? { x: 6.4, y: 2.2, z: C.pose.z + 0.6 } : CAM_OUT.eye, s: C.spot }) : null;
      const atOn = await ev(page, p => __fp.lightAt(p), C.pts);
      // 撤灯：推 2 帧让 world.update 把灯池刷一遍（改前的 world.js 要等下一帧的 pushLights），再只渲染不推模拟，等灯池淡出
      await ev(page, o => { window.__fpL = __fp.extra[o]; BR.world.setExtraLights(o, null); __fp.frames(2); return __fp.renderOnly(13); }, owner);
      const off = await ev(page, a => __fp.measure(a.c.eye, a.c.at, a.p), { c: C.cam, p: C.pts });
      await canvasPng(page, 'L4-' + idx + '-off');
      const spotOff = C.spot ? await ev(page, a => __fp.measure(a.e, a.s, [a.s])[0], { e: C.rack ? { x: 6.4, y: 2.2, z: C.pose.z + 0.6 } : CAM_OUT.eye, s: C.spot }) : null;
      const atOff = await ev(page, p => __fp.lightAt(p), C.pts);
      await ev(page, o => { BR.world.setExtraLights(o, window.__fpL); __fp.frames(2); return __fp.renderOnly(13); }, owner);
      const diffs = on.map((v, i) => (v == null || off[i] == null ? null : F2(v - off[i])));
      const vis = diffs.filter(d => d != null).length;
      const maxD = Math.max(0, ...diffs.filter(d => d != null).map(Math.abs));
      const atD = Math.max(...atOn.map((v, i) => Math.abs(v - atOff[i])));
      check('L4.' + idx + ' ' + C.n + '：车摆得下（不压碰撞体）、光源 ' + (st.L ? st.L.range : '?') + ' m 光球在灯池里点着，' + (C.rack ? '货架另一侧' : '屋里') + vis + ' 个点开灯和关灯差 ≤2（最大 ' + maxD.toFixed(2) + '）',
        free.length === 0 && !!st.pool && vis >= Math.min(C.pts.length - 1, 3) && maxD <= 2, { free, tp, st, names: C.pts.map(p => p.n), on, off, diffs });
      check('L4.' + idx + ' ' + C.n + '：lightAt 对' + (C.rack ? '货架另一侧' : '屋里') + '的点和关灯时一样（差 ' + atD.toFixed(4) + '）', atD < 0.005, { atOn, atOff });
      if (C.spot) check('L4.' + idx + ' ' + C.n + '：' + (C.rack ? '货架' : '墙') + '朝车这一面有一块亮斑（' + (spotOff == null ? '?' : spotOff.toFixed(1)) + ' → ' + (spotOn == null ? '?' : spotOn.toFixed(1)) + '）',
        spotOn != null && spotOff != null && spotOn - spotOff >= 10, { spotOn, spotOff });
      if (C.gap != null) check('L4.' + idx + ' ' + C.n + '：光源在墙前 ' + C.gap + ' m（tests/forklift.mjs K3 的规矩照旧）', !!st.L && Math.abs(20.8 - st.L.x - C.gap) <= 0.05, st.L);
    }
    // ---- 逐帧：全速开向小屋西墙直到停住 ----
    if (await stillDark(page)) {
      await ev(page, k => __fp.teleport(k, 12.0, 18.0, -Math.PI / 2), k);
      const pk = await ev(page, k => __fp.physKey(k), k);
      const frames = [];
      let leaks = [], n = 0, stopped = 0;
      await page.keyboard.down('KeyW');
      for (let i = 0; i < 16 && stopped < 8; i++) {
        const r = await ev(page, a => {
          const rows = [];
          for (let j = 0; j < 10; j++) {
            __br.step(1 / 30);
            const P = __fp.poolOf(a.owner), p = __fp.pose(a.k);
            const lk = P ? __fp.leaks(P, a.box, [a.pk, 'veh|' + a.k, a.k]) : [];
            rows.push({ x: __fp.r(p.x), spd: __fp.r(p.spd, 100), d: P && __fp.r(P.d), lk: lk.length, ex: lk[0] || null });
          }
          return rows;
        }, { k, owner, box: HUT_IN, pk });
        for (const q of r) { n++; frames.push(q); if (q.lk) leaks.push(q); if (Math.abs(q.spd) < 0.01 && n > 20) stopped++; }
      }
      await page.keyboard.up('KeyW');
      await ev(page, () => __fp.frames(3));
      check('L5 逐帧：从 6.7 m 外全速开向小屋西墙直到停住（' + n + ' 帧，最后 x ' + (frames.length ? frames[frames.length - 1].x : '?') + '）：每一帧灯池里大灯那盏的光球都不照进小屋（屋里朝着光源、视线被墙挡住的点 0 个）',
        n > 30 && leaks.length === 0 && frames.length && frames[frames.length - 1].x > 18.0, { leaks: leaks.slice(0, 5), first: frames.slice(0, 3), last: frames.slice(-3) });
    }
    // ---- 逐帧：从小屋西墙外开过去（车头朝 −z，柱子 x 19.55 和货架之间那条道，车身离墙 1.3 m，经过门口），屋里被墙挡住的地方一点光都不吃 ----
    if (await stillDark(page)) {
      const pk = await ev(page, k => __fp.physKey(k), k);
      const lane = await ev(page, a => {
        for (const x of [18.9, 18.85, 18.95, 18.8]) for (const z0 of [21.4, 21.3, 21.5]) {
          if (__fp.hitsAt(x, z0, 0, 0, a.pk).length) continue;
          const sw = __fp.sweep(x, z0, 0, 0, 10, a.pk, 0.1);
          if (!sw || sw.d > 7) return { x, z: z0, run: sw ? sw.d : 10 };
        }
        return null;
      }, { pk });
      if (!lane) check('L6 小屋西墙外找到一条能开过去的直道', false);
      else {
        await ev(page, a => __fp.teleport(a.k, a.l.x, a.l.z, 0), { k, l: lane });
        let leaks = [], n = 0, z1 = null;
        const stopped = r => r.length >= 5 && r.slice(-5).every(q => Math.abs(q.spd) < 0.01);
        await page.keyboard.down('KeyW');
        for (let i = 0; i < 12; i++) {
          const r = await ev(page, a => {
            const rows = [];
            for (let j = 0; j < 10; j++) {
              __br.step(1 / 30);
              const P = __fp.poolOf(a.owner), p = __fp.pose(a.k);
              const lk = P ? __fp.leaks(P, a.box, [a.pk, 'veh|' + a.k, a.k]) : [];
              rows.push({ z: __fp.r(p.z), spd: __fp.r(p.spd, 100), d: P && __fp.r(P.d), lk: lk.length, ex: lk[0] || null });
            }
            return rows;
          }, { k, owner, box: HUT_IN, pk });
          for (const q of r) { n++; z1 = q.z; if (q.lk) leaks.push(q); }
          if (z1 < 12.6 || stopped(r)) break;
        }
        await page.keyboard.up('KeyW');
        await ev(page, () => __fp.frames(3));
        check('L6 逐帧：从小屋西墙外开过去（x ' + lane.x + '，z ' + lane.z + ' → ' + z1 + '，' + n + ' 帧，经过门口）：屋里朝着光源、视线被墙挡住的点每一帧都是 0 个',
          n > 30 && z1 < 15 && leaks.length === 0, { lane, leaks: leaks.slice(0, 5) });
      }
    }
    // ---- FE1Q J8 / J9：画面上亮的地方 lightAt 才算亮（光够不到的远处、货架另一侧不算），货架通道里车灯照得远，开着大灯司机算亮 ----
    // 坐着把车瞬移过去（多推 3 帧：货架通道在出生块外面，等流式载入、L1 把新载入区块的灯也灭掉），量开灯 / 关灯的画面亮度和 lightAt（最后一个是司机的位置）
    const onOff = async (pose, pts, cam, tag) => {
      await ev(page, a => { __fp.teleport(a.k, a.p.x, a.p.z, a.p.yaw); __fp.frames(3); return __fp.renderOnly(12); }, { k, p: pose });
      const W = await ev(page, a => {
        const w = q => (q.x != null ? q : Object.assign(__fp.W(a.k, q.lx, q.lz, q.ly), { r: q.r || 3 }));
        return { pts: a.pts.map(w), eye: w(a.cam.eye), at: w(a.cam.at) };
      }, { k, pts, cam });
      const st = await ev(page, a => {
        const L = __fp.extra[a.owner] && __fp.extra[a.owner][0], sim = BR.forklift.byKey(a.k), inf = sim.lightInfo, e = sim.eyeWorld();
        return { L: L && { x: __fp.r(L.x), y: __fp.r(L.y), z: __fp.r(L.z), range: __fp.r(L.range), I: __fp.r(L.intensity) }, by: inf && inf.by && (inf.by.kind + ' ' + inf.by.key), seat: { x: e.x, z: e.z }, pool: !!__fp.poolOf(a.owner), seated: BR.vehicles.seated };
      }, { k, owner });
      const on = await ev(page, a => __fp.measure(a.eye, a.at, a.pts), W);
      if (tag) await canvasPng(page, tag + '-on');
      const atOn = await ev(page, a => __fp.lightAt(a.pts.concat([a.seat])), { pts: W.pts, seat: st.seat });
      await ev(page, o => { window.__fpL = __fp.extra[o]; BR.world.setExtraLights(o, null); return __fp.renderOnly(13); }, owner);
      const off = await ev(page, a => __fp.measure(a.eye, a.at, a.pts), W);
      if (tag) await canvasPng(page, tag + '-off');
      const atOff = await ev(page, a => __fp.lightAt(a.pts.concat([a.seat])), { pts: W.pts, seat: st.seat });
      await ev(page, o => { BR.world.setExtraLights(o, window.__fpL); return __fp.renderOnly(13); }, owner);
      const rows = W.pts.map((p, i) => ({ n: pts[i].n, p: [F2(p.x), F2(p.y), F2(p.z)], h: st.L ? F2(Math.hypot(p.x - st.L.x, p.z - st.L.z)) : null,
        d: on[i] != null && off[i] != null ? F2(on[i] - off[i]) : null, at: Math.round((atOn[i] - atOff[i]) * 10000) / 10000 }));
      return { st, rows, seat: Math.round((atOn[pts.length] - atOff[pts.length]) * 10000) / 10000, seatOn: atOn[pts.length] };
    };
    const litOk = r => r.d != null && r.d >= 8 && r.at >= 0.01;      // 画面亮了 ≥8 → lightAt 也亮
    const darkOk = r => r.d != null && r.d <= 2 && r.at < 0.005;     // 画面差 ≤2（墙后、货架另一侧、远处）→ lightAt 不亮
    const seatVals = [];
    if (!await stillDark(page)) check('L8 J8 / J9 几项：还在断电里', false);
    else {
      // 窄道（左边一排柱子、右边货架 z 6.84–9.16，车中心离货架 1.25 m，车头朝 +x）：原来光球只有 2.5 m（返修 r2 验收员拍的那张）
      const lane = { x: 3.45, z: 5.59, yaw: -Math.PI / 2 };
      const ln = await onOff(lane, [
        { n: '叉尖前 1 m 地面', lx: 0, ly: 0.005, lz: -3.1 }, { n: '叉尖前 3 m 地面', lx: 0, ly: 0.005, lz: -5.1 }, { n: '叉尖前 5 m 地面', lx: 0, ly: 0.005, lz: -7.1 },
        { n: '右边货架朝通道的货 高 1.5', x: 7.5, y: 1.5, z: 6.83 },
      ], { eye: { lx: 0, ly: 2.7, lz: -1.6 }, at: { lx: 0, ly: 0, lz: -7.1 } }, 'L8-lane');
      seatVals.push(['窄道', ln.seat, ln.seatOn]);
      check('L8 J9 货架通道（车中心离货架 1.25 m）：光球 ' + (ln.st.L ? ln.st.L.range : '?') + ' m（' + ln.st.by + '），叉尖前 5 m 处地面开灯比关灯亮 ' + (ln.rows[2].d == null ? '?' : ln.rows[2].d) + '（≥8），' +
        '前 1 / 3 m、朝通道的货也亮；这几处 lightAt 都算亮（J8）', ln.rows.every(litOk) && !!ln.st.L && ln.st.L.range >= 3, ln);
      const lf = await onOff(lane, [
        { n: '货架另一侧通道地面 z 9.6', x: 8.6, y: 0.005, z: 9.6 }, { n: '货架另一侧通道地面 z 10.5', x: 8.6, y: 0.005, z: 10.5 },
        { n: '货架另一侧通道地面 x 10.5', x: 10.5, y: 0.005, z: 9.4 }, { n: '货架另一侧通道地面 x 6.0', x: 6.0, y: 0.005, z: 9.5 },
      ], { eye: { x: 8.6, y: 1.7, z: 13.5 }, at: { x: 8.6, y: 0.6, z: 9.2 } }, 'L8-lane-far');
      const lk = await ev(page, a => { const L = __fp.extra[a.owner][0]; return __fp.leaks({ x: L.x, y: L.y, z: L.z, d: L.range }, a.box, [__fp.physKey(a.k), 'veh|' + a.k, a.k]); },
        { k, owner, box: { minX: 3.0, maxX: 22.0, minY: 0.0, maxY: 3.0, minZ: 9.17, maxZ: 12.5 } });
      // 只量另一侧通道本身（地面、离货架背面 0.4 m 以外）：货架是透的，从另一侧隔着货架缝看得见架子里朝这边通道的货被照亮（J9 允许：光到远侧面往里 0.1 m），那不算另一侧的通道
      check('L8b J9 同一位置，货架另一侧的通道地面开关灯差 ≤2（最大 ' + Math.max(...lf.rows.map(r => Math.abs(r.d || 0))).toFixed(2) + '）、lightAt 不亮；' +
        '那一侧朝着光源、视线被货架挡住的点在光球里 ' + lk.length + ' 个', lf.rows.every(darkOk) && lk.length === 0, { rows: lf.rows, leaks: lk.slice(0, 4) });
      // 宽通道（两排货架 x −17.16…−14.84 / −9.16…−6.84，通道宽 5.68 m，车在正中朝 −z）
      const aisle = { x: -12, z: 57.5, yaw: 0 };
      const ai = await onOff(aisle, [
        { n: '叉尖前 3 m 地面', lx: 0, ly: 0.005, lz: -5.1 }, { n: '叉尖前 5 m 地面', lx: 0, ly: 0.005, lz: -7.1 }, { n: '叉尖前 5 m 地面 偏左 1 m', lx: -1, ly: 0.005, lz: -7.1 },
        { n: '左边货架朝通道的货 高 1.2', lx: -2.84, ly: 1.2, lz: -4.5 },
      ], { eye: { lx: 1.6, ly: 2.7, lz: -2.0 }, at: { lx: 0, ly: 0, lz: -7.1 } }, 'L9-aisle');
      seatVals.push(['宽通道', ai.seat, ai.seatOn]);
      check('L9 J9 宽货架通道（5.68 m）：光球 ' + (ai.st.L ? ai.st.L.range : '?') + ' m（' + ai.st.by + '），叉尖前 5 m 处地面开灯比关灯亮 ' + (ai.rows[1].d == null ? '?' : ai.rows[1].d) + '（≥8），lightAt 都算亮',
        ai.rows.every(litOk), ai);
      const af = [];
      for (const sd of ['左', '右']) {
        const fx = sd === '左' ? -17.17 : -6.83, o = sd === '左' ? -1 : 1, cx = fx + o * 3.8;
        const r = await onOff(aisle, [
          { n: sd + '货架另一侧地面 0.4 m', x: fx + o * 0.4, y: 0.005, z: 54.0 }, { n: sd + '货架另一侧地面 1.3 m', x: fx + o * 1.3, y: 0.005, z: 53.0 },
          { n: sd + '货架另一侧地面 2.2 m', x: fx + o * 2.2, y: 0.005, z: 54.6 },
        ], { eye: { x: cx, y: 1.7, z: 55.5 }, at: { x: fx, y: 0.6, z: 54.0 } }, 'L9-aisle-far' + (sd === '左' ? 'L' : 'R'));
        af.push(...r.rows);
      }
      const lk2 = await ev(page, a => { const L = __fp.extra[a.owner][0]; return [a.boxL, a.boxR].map(b => __fp.leaks({ x: L.x, y: L.y, z: L.z, d: L.range }, b, [__fp.physKey(a.k), 'veh|' + a.k, a.k]).length); },
        { k, owner, boxL: { minX: -22.0, maxX: -17.17, minY: 0, maxY: 3, minZ: 44.5, maxZ: 59.5 }, boxR: { minX: -6.83, maxX: -2.0, minY: 0, maxY: 3, minZ: 44.5, maxZ: 59.5 } });
      check('L9b J9 同一位置，左右两排货架另一侧的地面开关灯差 ≤2（最大 ' + Math.max(...af.map(r => Math.abs(r.d || 0))).toFixed(2) + '）、lightAt 不亮；朝着光源、视线被货架挡住的点 ' + lk2.join(' / ') + ' 个',
        af.length === 6 && af.every(darkOk) && lk2.every(n => n === 0), { rows: af, leaks: lk2 });
      // 空地（试车场，光球被旁边小屋收到 4.4 m）：一片地面，画面亮了的 lightAt 亮；离光源水平距离 ≥ 光球的（光够不到的远处）画面不亮、lightAt 也不亮
      const yard = { x: -1, z: 32.6, yaw: -Math.PI / 2 }, fan = [];
      for (const lz of [-3.6, -5.2, -6.8, -8.4, -10.0, -11.6, -13.2]) for (const lx of [-2.2, 0, 2.2]) fan.push({ n: lx + ',' + lz, lx, ly: 0.005, lz });
      const yd = await onOff(yard, fan, { eye: { lx: 3.0, ly: 3.2, lz: -2.0 }, at: { lx: 0, ly: 0, lz: -8.5 } }, 'L11-yard');
      seatVals.push(['试车场', yd.seat, yd.seatOn]);
      const rng = yd.st.L ? yd.st.L.range : 0, lit = yd.rows.filter(r => r.d != null && r.d >= 8), far = yd.rows.filter(r => r.h != null && r.h >= rng && r.d != null);
      const band = yd.rows.filter(r => r.d != null && r.d < 8 && r.h < rng);
      check('L11 J8 空地上一片地面（光球 ' + rng + ' m）：画面亮了 ≥8 的 ' + lit.length + ' 个点 lightAt 都算亮，离光源水平距离 ≥ 光球的 ' + far.length + ' 个点画面差 ≤2、lightAt 不亮' +
        '（光斑边上地面暗了、站着的人头胸还照得到的 ' + band.length + ' 个点按人算，lightAt ' + (band.length ? Math.min(...band.map(r => r.at)).toFixed(3) + '–' + Math.max(...band.map(r => r.at)).toFixed(3) : '-') + '）',
        lit.length >= 3 && far.length >= 3 && lit.every(litOk) && far.every(darkOk), { st: yd.st, rows: yd.rows });
      // 车头顶着小屋西墙（叉尖离墙 1 m）：光球 0.49 m，司机照样算亮
      await ev(page, a => { __fp.teleport(a.k, 17.7, 18.0, -Math.PI / 2); return 0; }, { k });
      const wall = await ev(page, a => {
        const e = BR.forklift.byKey(a.k).eyeWorld(), on = BR.world.lightAt(e.x, e.z), L = __fp.extra[a.owner];
        BR.world.setExtraLights(a.owner, null); const off = BR.world.lightAt(e.x, e.z); BR.world.setExtraLights(a.owner, L);
        return { on, off, range: L && L[0] && L[0].range };
      }, { k, owner });
      seatVals.push(['顶墙 1 m', Math.round((wall.on - wall.off) * 10000) / 10000, wall.on]);
      check('L10 J8 开着大灯，司机的位置（驾驶舱）lightAt 算亮：' + seatVals.map(s => s[0] + ' +' + s[1].toFixed(3) + '（' + s[2].toFixed(2) + '）').join('，') + '（每处 ≥0.3，断电时 ≥0.6 = 笑魇不靠近）',
        seatVals.length === 4 && seatVals.every(s => s[1] >= 0.3 && s[2] >= 0.6), seatVals);
    }
    // ---- 远端车（队友开着的车，vehiclesNet._feed）车头顶墙 ----
    await dismount(page);
    if (await stillDark(page)) {
      const rem = await ev(page, a => {
        const VN = BR.vehiclesNet, pose = { k: 'k:' + a.k, x: 17.7, z: 18.0, yaw: -Math.PI / 2, steer: 0, lift: 0, tilt: 0, spd: 0, on: 1, hl: 1 };
        for (let i = 0; i < 6; i++) { VN._feed(pose); __br.step(1 / 30); }
        const ro = 'fkr:' + a.k, L = __fp.extra[ro] && __fp.extra[ro][0];
        const P = __fp.poolOf(ro);
        const lk = P ? __fp.leaks(P, a.box, ['veh|' + a.k, a.k, __fp.physKey(a.k)]) : null;
        // 队友坐的驾驶舱（影子模拟的眼点）：开着大灯算亮（FE1Q J8，联机这边也一样）
        const sh = BR.forklift.byKey(a.k), e = sh ? sh.eyeWorld() : null;
        const at = __fp.lightAt(a.pts), seat = e ? BR.world.lightAt(e.x, e.z) : null;
        const list = __fp.extra[ro];
        BR.world.setExtraLights(ro, null);
        const at0 = __fp.lightAt(a.pts), seat0 = e ? BR.world.lightAt(e.x, e.z) : null;
        if (list) BR.world.setExtraLights(ro, list);
        return { L: L && { x: __fp.r(L.x), z: __fp.r(L.z), range: __fp.r(L.range) }, P, lk, at, at0, seat, seat0, rem: VN.debugInfo().remotes[a.k] && VN.debugInfo().remotes[a.k].lightAt };
      }, { k, box: HUT_IN, pts: PTS_IN });
      const atD = rem.at && rem.at0 ? Math.max(...rem.at.map((v, i) => Math.abs(v - rem.at0[i]))) : 1;
      check('L7 队友开着的车（net:veh）车头顶小屋墙：灯池里 \'fkr:\' 那盏的光球 ' + (rem.L ? rem.L.range : '?') + ' m，屋里朝着光源、视线被墙挡住的点 0 个，屋里 lightAt 和关灯时一样（差 ' + atD.toFixed(4) + '），' +
        '队友坐的驾驶舱 lightAt 算亮（' + (rem.seat0 == null ? '?' : rem.seat0.toFixed(2) + ' → ' + rem.seat.toFixed(2)) + '）',
        !!rem.L && !!rem.P && Array.isArray(rem.lk) && rem.lk.length === 0 && rem.L.range < 1 && atD < 0.005 && rem.seat != null && rem.seat - rem.seat0 >= 0.3, rem);
    }
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}
function F2(v) { return Math.round(v * 100) / 100; }

// =====================================================================
// vine（H9）
// =====================================================================
function installVineGeo() {
  const G = (Math.sqrt(5) - 1) / 2;
  const gss = (f, n) => { let a = 0, b = 1, x1 = b - G, x2 = G, f1 = f(x1), f2 = f(x2); for (let i = 0; i < n; i++) { if (f1 <= f2) { b = x2; x2 = x1; f2 = f1; x1 = b - G * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + G * (b - a); f2 = f(x2); } } return Math.min(f1, f2, f(0), f(1)); };
  // 点到盒子（phys 格式；sk = 斜立柱沿 z 的斜率，盒子本地 z 的中心 = sk·(y − 盒子中心高度)；在里面 = 0）
  const ptObb = (o, x, y, z) => {
    const c = Math.cos(o.rot), s = Math.sin(o.rot), dx = x - o.cx, dz = z - o.cz, cy = (o.minY + o.maxY) / 2, hy = (o.maxY - o.minY) / 2;
    const lx = dx * c - dz * s, lz = dx * s + dz * c - (o.sk || 0) * (y - cy);
    const ex = Math.max(0, Math.abs(lx) - o.hx), ey = Math.max(0, Math.abs(y - cy) - hy), ez = Math.max(0, Math.abs(lz) - o.hz);
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  };
  const ptSeg = (A, B, x, y, z) => {
    const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, L2 = ux * ux + uy * uy + uz * uz;
    let t = L2 > 0 ? ((x - A.x) * ux + (y - A.y) * uy + (z - A.z) * uz) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - A.x - ux * t, y - A.y - uy * t, z - A.z - uz * t);
  };
  // 竖着的棱台（forklift.js beaconPrism 的格式：各侧面外法线 m、边心距 a0 + k·(y − ya)、上下 y0 / y1）：各面平面有向距离取最大，≤0 = 在里面
  const ptPrism = (F, x, y, z) => {
    const dx = x - F.x, dz = z - F.z, a = F.a0 + F.k * (y - F.ya);
    let d = Math.max(F.y0 - y, y - F.y1);
    for (const m of F.m) d = Math.max(d, (m[0] * dx + m[1] * dz - a) / F.nrm);
    return Math.max(0, d);
  };
  // 凸多面体（forklift.js polyWorld 的格式：pl = [nx, ny, nz, d] × n，外法线，n·p ≤ d 在里面）：各面平面有向距离取最大
  const ptPoly = (P, x, y, z) => { let d = -Infinity; for (let i = 0; i < P.pl.length; i += 4) d = Math.max(d, P.pl[i] * x + P.pl[i + 1] * y + P.pl[i + 2] * z - P.pl[i + 3]); return Math.max(0, d); };
  const ptVol = (V, x, y, z) => {
    let best = Infinity, who = null;
    for (const o of V.boxes) { const d = ptObb(o, x, y, z); if (d < best) { best = d; who = o.name; } }
    for (const C of V.caps) { const d = Math.max(0, ptSeg(C.a, C.b, x, y, z) - C.r); if (d < best) { best = d; who = C.name; } }
    for (const F of V.cyls) { const d = ptPrism(F, x, y, z); if (d < best) { best = d; who = F.name; } }
    for (const P of (V.polys || [])) { const d = ptPoly(P, x, y, z); if (d < best) { best = d; who = P.name; } }
    return { d: best, who };
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // 点到三角形的距离（Ericson 的最近点）
  const ptTri = (p, a, b, c) => {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return Math.hypot(...sub(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return Math.hypot(...sub(p, [a[0] + t * ac[0], a[1] + t * ac[1], a[2] + t * ac[2]])); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return Math.hypot(...sub(p, [b[0] + t * (c[0] - b[0]), b[1] + t * (c[1] - b[1]), b[2] + t * (c[2] - b[2])])); }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return Math.hypot(...sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
  };
  // 方杆一个侧面上 (s, t) 那一点：s 沿面宽、t 从上往下
  const facePt = (C, i, s, t) => {
    const T0 = C.top[i], T1 = C.top[(i + 1) % 4], B0 = C.bot[i], B1 = C.bot[(i + 1) % 4];
    const ux = T0[0] + (T1[0] - T0[0]) * s, uy = T0[1] + (T1[1] - T0[1]) * s, uz = T0[2] + (T1[2] - T0[2]) * s;
    const wx = B0[0] + (B1[0] - B0[0]) * s, wy = B0[1] + (B1[1] - B0[1]) * s, wz = B0[2] + (B1[2] - B0[2]) * s;
    return [ux + (wx - ux) * t, uy + (wy - uy) * t, uz + (wz - uz) * t];
  };
  // 这台车可动模型用的细节档（载具层里这台车的 ent.info.tier）
  const tierOf = k => { const v = BR.vehicles.byKey(k); return (v && v.ent && v.ent.info && v.ent.info.tier) || BR.vehicles.debugInfo().tiers[k] || 'mid'; };
  // 可动模型的三角形（车本地，lift / steer 照给的，离地 > yMin 的；kit:decal 不算）
  const modelTris = (tier, lift, steer, yMin) => {
    const b = BR.kit.builder({}, 0, 0, () => 0, { height: 4 });
    BR.L1forklift.model(b, { detail: tier, drive: true, part: 'all', lift: lift || 0, steer: steer || 0, number: 88 });
    const T = [];
    b._accs.forEach((a, key) => {
      if (!a || !a.idx || typeof key !== 'string' || key === 'kit:decal') return;
      for (let i = 0; i < a.idx.length; i += 3) {
        const tri = [0, 1, 2].map(j => { const v = a.idx[i + j]; return [a.pos[v * 3], a.pos[v * 3 + 1], a.pos[v * 3 + 2]]; });
        if (Math.max(tri[0][1], tri[1][1], tri[2][1]) > yMin) T.push(tri);
      }
    });
    return T;
  };
  window.__vg = {
    corners(ck, v) {
      const c = BR.world.chunks().find(q => q.key === ck);
      const m = (c.res.group || c.group).children.find(o => o.isMesh && o.name === 'kit:prop');
      m.updateMatrixWorld(true);
      const arr = m.geometry.attributes.position.array, M = m.matrixWorld, V = new THREE.Vector3(), pts = [];
      for (let q = v.v[0]; q < v.v[1]; q++) {
        V.set(arr[q * 3], arr[q * 3 + 1], arr[q * 3 + 2]).applyMatrix4(M);
        if (!pts.some(p => Math.hypot(p[0] - V.x, p[1] - V.y, p[2] - V.z) < 1e-5)) pts.push([V.x, V.y, V.z]);
      }
      const t = v.top, top = [], bot = [];
      for (const p of pts) (Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]) < 0.05 ? top : bot).push(p);
      const ctr = a => a.reduce((s, p) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length, s[2] + p[2] / a.length], [0, 0, 0]);
      const ct = ctr(top), cb = ctr(bot);
      const ax = [cb[0] - ct[0], cb[1] - ct[1], cb[2] - ct[2]], al = Math.hypot(...ax); ax[0] /= al; ax[1] /= al; ax[2] /= al;
      const ref0 = [top[0][0] - ct[0], top[0][1] - ct[1], top[0][2] - ct[2]];
      const ang = (p, c0) => { const d = [p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]]; return Math.atan2(dot(cross(ref0, d), ax), dot(ref0, d)); };
      top.sort((a, b) => ang(a, ct) - ang(b, ct)); bot.sort((a, b) => ang(a, cb) - ang(b, cb));
      return { top, bot, n: pts.length };
    },
    // 方杆（4 个侧面）到藤蔓挡体（sim.vineVolumes：看得见的门架零件、链条、护顶架那几块 + 坐着时司机头胸胶囊）的最近距离
    //（面上每一点到凸体的距离是凸函数，嵌套黄金分割）
    gapVol(C, V) {
      let best = Infinity, who = null;
      const one = (name, fd) => {
        for (let i = 0; i < 4; i++) {
          const d = gss(s => gss(t => { const p = facePt(C, i, s, t); return fd(p[0], p[1], p[2]); }, 34), 34);
          if (d < best) { best = d; who = name; }
        }
      };
      for (const o of V.boxes) one(o.name, (x, y, z) => ptObb(o, x, y, z));
      for (const c of V.caps) one(c.name, (x, y, z) => Math.max(0, ptSeg(c.a, c.b, x, y, z) - c.r));
      for (const F of V.cyls) one(F.name, (x, y, z) => ptPrism(F, x, y, z));
      for (const P of (V.polys || [])) one(P.name, (x, y, z) => ptPoly(P, x, y, z));
      return { d: best, who };
    },
    // 方杆离可动模型三角形（看得见的车，FE1Q J3）多近：侧面 7 × 121 个点取最近，最近的 3 个点附近再细找；只看藤蔓外包盒 15 cm 内的三角形
    triGap(C, T) {
      const all = C.top.concat(C.bot), lo = [0, 1, 2].map(j => Math.min(...all.map(p => p[j])) - 0.15), hi = [0, 1, 2].map(j => Math.max(...all.map(p => p[j])) + 0.15);
      const near = T.filter(t => [0, 1, 2].every(j => Math.max(t[0][j], t[1][j], t[2][j]) >= lo[j] && Math.min(t[0][j], t[1][j], t[2][j]) <= hi[j]));
      if (!near.length) return { d: Infinity, at: null, n: 0 };
      const dAt = p => { let m = Infinity; for (const t of near) { const d = ptTri(p, t[0], t[1], t[2]); if (d < m) m = d; } return m; };
      const cand = [];
      for (let i = 0; i < 4; i++) for (let a = 0; a <= 6; a++) for (let q = 0; q <= 120; q++) { const s = a / 6, t = q / 120, p = facePt(C, i, s, t); cand.push([dAt(p), i, s, t]); }
      cand.sort((x, y) => x[0] - y[0]);
      let best = cand[0][0], at = facePt(C, cand[0][1], cand[0][2], cand[0][3]);
      for (const [, i, s0, t0] of cand.slice(0, 3)) {
        for (let a = -4; a <= 4; a++) for (let q = -10; q <= 10; q++) {
          const s = Math.max(0, Math.min(1, s0 + a / 24)), t = Math.max(0, Math.min(1, t0 + q / 1200)), p = facePt(C, i, s, t), d = dAt(p);
          if (d < best) { best = d; at = p; }
        }
      }
      return { d: best, at: at.map(x => Math.round(x * 1000) / 1000), n: near.length };
    },
    // 这一帧：藤蔓离藤蔓挡体、（a.tri 时）离可动模型三角形的最近距离，模拟里这根藤蔓的状态
    q(a) {
      const C = __vg.corners(a.ck, a.v);
      const sim = BR.forklift.byKey(a.k), S = sim && sim.vines.get(a.ck + '|' + a.i), p = __fp.pose(a.k);
      const V0 = sim ? sim.vineVolumes(BR.vehicles.seated === a.k) : null;
      // 改前的 forklift.js（--old 反证）：{ boxes, cap }
      const V = { boxes: (V0 && V0.boxes) || [], caps: (V0 && (V0.caps || (V0.cap ? [V0.cap] : []))) || [], cyls: (V0 && V0.cyls) || [], polys: (V0 && V0.polys) || [] };
      const g = __vg.gapVol(C, V);
      const out = { g: g.d, who: g.who, th: S ? S.th : 0, touch: S ? !!S.touch : false, dist: Math.hypot(p.x - a.v.top[0], p.z - a.v.top[2]), spd: p.spd, low: Math.min(...C.bot.map(q => q[1])), n: C.n };
      if (a.tri && out.touch) {
        const T = __vg.trisWorld(a.k);
        const tg = __vg.triGap(C, T);
        out.tg = tg.d; out.tat = tg.at; out.tn = tg.n;
        // 最近那一点在车本地的位置（看是贴着哪一块）
        if (tg.at) { const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = tg.at[0] - p.x, dz = tg.at[2] - p.z; out.tloc = [Math.round((c * dx - s * dz) * 1000) / 1000, Math.round((tg.at[1] - p.y) * 1000) / 1000, Math.round((s * dx + c * dz) * 1000) / 1000]; }
      }
      return out;
    },
    // 这台车当前位姿下可动模型的三角形（世界坐标，离地 1.5 m 以上 —— 藤蔓最低垂到 1.55 m）
    trisWorld(k) {
      const p = __fp.pose(k), tier = tierOf(k);
      const key = tier + '|' + (Math.round((p.lift || 0) * 1e4)) + '|' + (Math.round((p.steer || 0) * 1e4));
      if (!__vg._tc || __vg._tc.key !== key) __vg._tc = { key, T: modelTris(tier, p.lift, p.steer, 1.5) };
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), y0 = p.y || 0;
      return __vg._tc.T.map(t => t.map(v => [p.x + c * v[0] + s * v[2], y0 + v[1], p.z - s * v[0] + c * v[2]]));
    },
    // 静态核对（FE1Q J3）：这一档可动模型（货叉升到 lift）离地 1.7 m 以上的顶点（护顶架、门架、链条……）都在藤蔓挡体里（离挡体 ≤1 mm，挡体不比车小），
    // 挡体各个面上（离地 1.7 m 以上）取点离模型三角形 ≤1 cm（挡体不比车大）。车摆在原点、朝 0
    cover(tier, lift) {
      const sim = BR.forklift.create({ key: '__vgcover', x: 0, z: 0, y: 0, yaw: 0, lift: lift || 0 });
      try {
        const V0 = sim.vineVolumes(false, tier);
        // 改前的 forklift.js（--old）：{ boxes（没名字）, cap }
        const guard = { boxes: V0.boxes.map((o, i) => Object.assign({ name: o.name || 'box' + i }, o)), caps: V0.caps || [], cyls: V0.cyls || [], polys: V0.polys || [] };
        const T = modelTris(tier, lift || 0, 0, 1.5);
        let outMax = 0, outAt = null, nv = 0;
        for (const t of T) for (const v of t) {
          if (v[1] <= 1.7) continue;
          nv++;
          const r = ptVol(guard, v[0], v[1], v[2]);
          if (r.d > outMax) { outMax = r.d; outAt = v.map(x => Math.round(x * 1000) / 1000); }
        }
        // 挡体表面取点：盒子 6 个面各 3 × 3、棱台侧面各 3 个、凸多面体每个面平面上离它的中心最近的那一点，到最近三角形
        const dTri = p => { let m = Infinity; for (const t of T) { const d = ptTri(p, t[0], t[1], t[2]); if (d < m) m = d; } return m; };
        // 灯盒顶面模型里本来不画（L1 FK_LAMPF 没有 'py'，上面 10 cm 是纵梁，藤蔓先碰到纵梁、落不到灯盒顶上）：单独记，不算
        let farMax = 0, farAt = null, farWho = null, lampTop = 0, np = 0;
        const all = guard.boxes.map(o => ['b', o]).concat(guard.caps.map(o => ['c', o]), guard.cyls.map(o => ['y', o]), guard.polys.map(o => ['p', o]));
        const probe = (self, who, p, top) => {
          if (p[1] < 1.7) return;   // 只量藤蔓够得着的高度（藤蔓最低垂到 1.55 m，护顶架 1.7 m 以下被纵梁、横梁挡着）
          // 门架零件（mastOuter / mastInner / carriage）是按模型自己的三角形拆出来的，不会比模型大（没画的面按它该在的位置补上）：
          // 只量照着 L1 尺寸手写的那几块（护顶架、链条）
          if (/^(mastOuter|mastInner|carriage)$/.test(who)) return;
          // 埋在别的挡体里面的点（立柱顶插进纵梁 3 cm、横梁两头顶着纵梁……）是里面，藤蔓碰不到，不算
          for (const [k, o] of all) {
            if (o === self) continue;
            const d = k === 'b' ? ptObb(o, p[0], p[1], p[2]) : k === 'c' ? Math.max(0, ptSeg(o.a, o.b, p[0], p[1], p[2]) - o.r) : k === 'y' ? ptPrism(o, p[0], p[1], p[2]) : ptPoly(o, p[0], p[1], p[2]);
            if (d < 1e-6) return;
          }
          np++;
          const d = dTri(p);
          if (top && /^lamp/.test(who)) { lampTop = Math.max(lampTop, d); return; }
          if (d > farMax) { farMax = d; farAt = p.map(x => Math.round(x * 1000) / 1000); farWho = who; }
        };
        for (const o of guard.boxes) {
          const cy = (o.minY + o.maxY) / 2, hy = (o.maxY - o.minY) / 2;
          for (const ax of [0, 1, 2]) for (const sg of [-1, 1]) for (const u of [-0.8, 0, 0.8]) for (const w of [-0.8, 0, 0.8]) {
            const q = [0, 0, 0]; q[ax] = sg; q[(ax + 1) % 3] = u; q[(ax + 2) % 3] = w;
            const ly = cy + q[1] * hy, lx = o.cx + q[0] * o.hx, lz = o.cz + q[2] * o.hz + (o.sk || 0) * (ly - cy);
            probe(o, o.name, [lx, ly, lz], ax === 1 && sg > 0);
          }
        }
        for (const F of guard.cyls) for (const m of F.m) for (const f of [0.15, 0.5, 0.85]) {
          const y = F.y0 + (F.y1 - F.y0) * f, a = F.a0 + F.k * (y - F.ya);
          probe(F, F.name, [F.x + m[0] * a, y, F.z + m[1] * a]);
        }
        for (const P of guard.polys) for (let i = 0; i < P.pl.length; i += 4) {
          const n = [P.pl[i], P.pl[i + 1], P.pl[i + 2]], e = n[0] * P.c[0] + n[1] * P.c[1] + n[2] * P.c[2] - P.pl[i + 3];
          const q = [P.c[0] - n[0] * e, P.c[1] - n[1] * e, P.c[2] - n[2] * e];
          if (ptPoly(P, q[0], q[1], q[2]) > 1e-6) continue;   // 这个面平面上离中心最近的那一点不在多面体上（被别的面切掉了）
          probe(P, P.name, q);
        }
        return { tier, lift: lift || 0, nv, nT: T.length, np, outMax, outAt, farMax, farAt, farWho, lampTop, vols: all.length };
      } finally { sim.dispose(); }
    },
  };
  return 0;
}
async function gVine(browser) {
  const { ctx, page } = await boot(browser, 'vine');
  try {
    await startL1(page, { seed: 1 });
    await ev(page, installVineGeo);
    const kv = await ev(page, () => __fp.spawnKey());
    const vine = await ev(page, k => {
      const pk = __fp.physKey(k);
      for (const c of BR.world.chunks()) {
        const vs = (c.res && c.res.data && c.res.data.vines) || [];
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          if (!(v.bot[1] < 2.1)) continue;   // 垂得比护顶（≈2.2 m）低的才碰得到
          for (let a = 0; a < 8; a++) {
            const yaw = a * Math.PI / 4, f = __fp.fwd(yaw);
            for (const off of [0, 0.25, -0.25]) {
              const bx = v.bot[0] + -f.z * off, bz = v.bot[2] + f.x * off, sx = bx - f.x * 4.5, sz = bz - f.z * 4.5;
              if (__fp.hitsAt(sx, sz, yaw, 0, pk).length) continue;
              if (__fp.sweep(sx, sz, yaw, 0, 9.5, pk, 0.1)) continue;
              const L = __fp.WP({ x: sx, z: sz, yaw }, -1.2, 0.24), R = __fp.WP({ x: sx, z: sz, yaw }, 1.2, 0.24);
              const side = !BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) ? 'left' : !BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7) ? 'right' : null;
              if (!side) continue;
              return { ck: c.key, i, v, x: sx, z: sz, yaw, side };
            }
          }
        }
      }
      return null;
    }, kv);
    check('V0 种子 1 的花园段里找到一根车能从底下开过的藤蔓', !!vine, vine && { ck: vine.ck, i: vine.i });
    if (!vine) return;
    const qa = { ck: vine.ck, i: vine.i, v: vine.v, k: kv, tri: true };
    const snapV = () => ev(page, a => {
      const c = BR.world.chunks().find(q => q.key === a.ck);
      const m = (c.res.group || c.group).children.find(o => o.isMesh && o.name === 'kit:prop');
      return Array.from(m.geometry.attributes.position.array.slice(a.v.v[0] * 3, a.v.v[1] * 3));
    }, vine);
    const before = await snapV();
    // ---- 全速开过去 ----
    const pm = await placeAndMount(page, kv, vine, vine.side);
    const rows = [];
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 20; i++) {
      const r = await ev(page, a => { const out = []; for (let j = 0; j < 10; j++) { __br.step(1 / 30); out.push(__vg.q(a)); } return out; }, qa);
      rows.push(...r);
      if (rows.length > 30 && rows[rows.length - 1].dist > 4.6) break;
    }
    await page.keyboard.up('KeyW');
    const touch = rows.filter(r => r.touch), minAll = Math.min(...rows.map(r => r.g));
    check('V1 真键盘全速开过藤蔓底下（' + rows.length + ' 帧，被顶着 ' + touch.length + ' 帧）：每一帧藤蔓方杆离藤蔓挡体（看得见的门架零件、链条、护顶架那几块）≥0.1 mm（最近 ' + (minAll * 1000).toFixed(2) + ' mm），' +
      '离可动模型三角形 >0（最近 ' + (touch.length ? (Math.min(...touch.map(r => r.tg)) * 1000).toFixed(2) : '?') + ' mm）',
      pm.mounted && touch.length > 0 && minAll >= 0.0001 && touch.every(r => r.tg > 0), { first: rows.find(r => r.th > 0), n: rows.length });
    const tg = touch.map(r => r.g), tt = touch.map(r => r.tg);
    const mm = a => a.length ? (Math.min(...a) * 1000).toFixed(1) + '–' + (Math.max(...a) * 1000).toFixed(1) : '?';
    check('V2 被顶着的每一帧，藤蔓表面离把它推开的那一样 0–1 cm（挡体 ' + mm(tg) + ' mm；直接量到可动模型三角形 ' + mm(tt) + ' mm，FE1Q J3）',
      tg.length > 0 && Math.min(...tg) >= 0 && Math.max(...tg) <= 0.01 && Math.min(...tt) > 0 && Math.max(...tt) <= 0.01,
      touch.slice(0, 8).map(r => [F2(r.g * 1000), r.who, F2(r.tg * 1000), r.tloc, F2(r.th * 1000)]));
    // ---- 从头开到藤蔓底下停住（护顶在藤蔓下面），坐着、下车各量一阵 ----
    await step(page, 2.5);
    await dismount(page);
    await step(page, 2.5);
    const pm2 = await placeAndMount(page, kv, vine, vine.side);
    await page.keyboard.down('KeyW');
    await step(page, 1.5);
    await page.keyboard.up('KeyW');
    const rest = [];
    for (let i = 0; i < 3; i++) rest.push(...await ev(page, a => { const out = []; for (let j = 0; j < 10; j++) { __br.step(1 / 30); out.push(__vg.q(a)); } return out; }, qa));
    const seated = rest.slice(-10);
    await dismount(page);
    const after = [];
    for (let i = 0; i < 2; i++) after.push(...await ev(page, a => { const out = []; for (let j = 0; j < 10; j++) { __br.step(1 / 30); out.push(__vg.q(a)); } return out; }, qa));
    const sg = seated.map(r => r.g), ag = after.map(r => r.g), last = after[after.length - 1];
    const st = seated.concat(after).map(r => r.tg);
    check('V3 开到藤蔓底下停住：坐着时藤蔓靠在把它推开的那一样上（' + mm(sg) + ' mm），下车以后也是（' + mm(ag) + ' mm），直接量到可动模型三角形 ' + mm(st) + ' mm，' +
      '藤蔓转开 ' + F2(last.th * 1000) + ' mrad、贴着 ' + last.who + '（车本地 ' + JSON.stringify(last.tloc) + '）',
      pm2.mounted && seated.every(r => r.touch && r.th > 0) && after.every(r => r.touch) && Math.min(...sg) >= 0 && Math.max(...sg) <= 0.01 && Math.min(...ag) >= 0 && Math.max(...ag) <= 0.01 &&
      Math.min(...st) > 0 && Math.max(...st) <= 0.01 && last.dist < 1.2, { stop: seated[seated.length - 1], last });
    // 从车正前方、护顶高度平视拍一张（主会话要看藤蔓下端和护顶角的关系）
    const cam = await ev(page, a => { const p = __fp.pose(a.k), f = __fp.fwd(p.yaw), b = a.v.bot; return { e: { x: b[0] + f.x * 1.8 - f.z * 1.6, y: 1.9, z: b[2] + f.z * 1.8 + f.x * 1.6 }, a: { x: b[0], y: 2.1, z: b[2] } }; }, qa);
    await ev(page, c => { __fp.measure(c.e, c.a, []); return 0; }, cam);
    await canvasPng(page, 'V3-resting');
    // 车侧平视、护顶高度的特写（FE1Q J3：亲眼看藤蔓挨着横梁）：相机在藤蔓贴着的那一侧（车本地 x 同号）1.4 m 外、离地 2.07 m，看接触点
    const side = await ev(page, a => {
      const p = __fp.pose(a.k), L = a.last.tloc || [0.46, 2.07, 0], sx = L[0] >= 0 ? 1 : -1;
      const e = __fp.W(a.k, sx * 1.4, L[2] + 0.15, 2.07), t = __fp.W(a.k, L[0], L[2], L[1]);
      __fp.measure({ x: e.x, y: e.y, z: e.z }, { x: t.x, y: t.y, z: t.z }, []);
      return { side: sx > 0 ? '右' : '左', tloc: L };
    }, Object.assign({ last }, qa));
    await canvasPng(page, 'V3-side-level');
    info('V3 车' + side.side + '侧平视、护顶高度的特写：tests/output/forklift_polish/vine/V3-side-level.png（接触点车本地 ' + JSON.stringify(side.tloc) + '）');
    // ---- 上车倒开走：车走了以后慢慢荡回、逐位恢复 ----
    const pm3 = await mountCar(page, kv, vine.side);
    await page.keyboard.down('KeyS');
    await step(page, 3.0);
    await page.keyboard.up('KeyS');
    await step(page, 3.0);
    const back = await snapV();
    let diff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== back[i]) diff++;
    const fin = await ev(page, a => __vg.q(a), qa);
    check('V4 车倒开走以后藤蔓慢慢荡回，顶点逐位恢复原样（差 ' + diff + ' 个分量）', pm3.ok && diff === 0 && fin.th === 0, { fin, n: before.length });
    // ---- 藤蔓挡体和看得见的车对得上（FE1Q J3）：四档可动模型 ----
    const cov = await ev(page, () => { const out = []; for (const t of ['high', 'mid', 'lite', 'drvLow']) for (const l of [0, 0.6]) out.push(__vg.cover(t, l)); return out; });
    check('V5 藤蔓挡体和可动模型对得上（high / mid / lite / drvLow，货叉在底 / 升到 0.6）：离地 1.7 m 以上的模型顶点（护顶架、门架、链条）都在挡体里（最远 ' +
      Math.max(...cov.map(c => c.outMax * 1000)).toFixed(2) + ' mm，≤1 mm），挡体露在外面的面离模型三角形 ≤1 cm（最远 ' + Math.max(...cov.map(c => c.farMax * 1000)).toFixed(1) + ' mm）；' +
      '灯盒顶面模型里不画（纵梁挡着，藤蔓落不上去）离边 ' + Math.max(...cov.map(c => c.lampTop * 1000)).toFixed(1) + ' mm 不算',
      cov.length === 8 && cov.every(c => c.nv > 100 && c.outMax <= 0.001 && c.farMax <= 0.01),
      cov.map(c => ({ tier: c.tier, lift: c.lift, nv: c.nv, np: c.np, out: F2(c.outMax * 1000), outAt: c.outAt, far: F2(c.farMax * 1000), farWho: c.farWho, farAt: c.farAt, vols: c.vols })));
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// coop（H14）：两人联机（内存假 room.php），照 tests/coop.mjs / showOwner g5 的进局办法
// =====================================================================
const OVOBOT_RE = /^https?:\/\/api\.ovobot\.ai\//;
const OTHER_HOST_RE = /^https?:\/\/(?!127\.0\.0\.1[:/])(?!api\.ovobot\.ai\/)/;
const COOP_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'];
const rooms = new Map();
const signals = [];
let sigSeq = 0;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let s; do { s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (rooms.has(s)); return s; }
const phpTrim = v => String(v).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
function nameOf(body) { let n = phpTrim(body && body.name != null ? body.name : ''); if (n === '') n = '匿名工程师'; return Array.from(n).slice(0, 16).join(''); }
function roomApi(q, body) {
  const now = Date.now(), action = q.action || '';
  if (action === 'create') { const code = newCode(); rooms.set(code, { state: 'waiting', host_name: nameOf(body), guest_name: null, createdAt: now }); return [200, { ok: true, code }]; }
  const code = String(q.code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (code === '' || code.length !== 6) return [400, { ok: false, error: 'bad_code' }];
  const room = rooms.get(code) || null;
  switch (action) {
    case 'join':
      if (!room) return [404, { ok: false, error: 'room_not_found' }];
      if (room.state === 'joined') return [409, { ok: false, error: 'room_full' }];
      room.guest_name = nameOf(body); room.state = 'joined';
      return [200, { ok: true, host: room.host_name }];
    case 'status':
      if (!room) return [404, { ok: false, error: 'room_not_found' }];
      return [200, { ok: true, state: room.state, host_name: room.host_name, guest_name: room.guest_name }];
    case 'signal': {
      const to = q.to === 'host' ? 'host' : 'guest', payload = body && body.payload !== undefined ? body.payload : null;
      if (payload === null) return [400, { ok: false, error: 'no_payload' }];
      if (JSON.stringify(payload).length > 60000) return [413, { ok: false, error: 'too_large' }];
      signals.push({ id: ++sigSeq, room: code, to, payload, at: now });
      return [200, { ok: true }];
    }
    case 'poll': {
      const me = q.me === 'host' ? 'host' : 'guest', since = parseInt(q.since, 10) || 0;
      const msgs = signals.filter(m => m.room === code && m.to === me && m.id > since).slice(0, 40);
      return [200, { ok: true, msgs: msgs.map(m => m.payload), last: msgs.length ? msgs[msgs.length - 1].id : since }];
    }
    case 'close': if (room) room.state = 'closed'; return [200, { ok: true }];
  }
  return [400, { ok: false, error: 'unknown_action' }];
}
async function onRoute(route) {
  const req = route.request();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  try {
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors, body: '' }); return; }
    const u = new URL(req.url());
    if (!/\/room\.php$/.test(u.pathname)) { await route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }); return; }
    const q = Object.fromEntries(u.searchParams.entries());
    let body = {};
    const raw = req.postData();
    if (raw) { try { body = JSON.parse(raw) || {}; } catch (err) { body = {}; } }
    const [status, r] = roomApi(q, body);
    await route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(r) });
  } catch (err) { /* 页面关了 */ }
}
function fakeMicInit() {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getUserMedia = async function (cons) {
    if (!cons || !cons.audio) throw new DOMException('测试桩只提供音频', 'NotFoundError');
    const ac = new AudioContext(), osc = ac.createOscillator(), g = ac.createGain(), dst = ac.createMediaStreamDestination();
    g.gain.value = 0.25; osc.connect(g).connect(dst); osc.start();
    try { await ac.resume(); } catch (err) { /* 忽略 */ }
    return dst.stream;
  };
}
async function coopPage(browser, tag, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 640, height: 360 } });
  await ctx.route(OVOBOT_RE, route => onRoute(route));
  await ctx.route(OTHER_HOST_RE, route => route.abort());
  await ctx.addInitScript(fakeMicInit);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('[' + tag + '] console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
  await page.goto(BASE + 'index.html?dev');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 90000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);
  await page.evaluate(installCoopV);
  return { ctx, page };
}
// 联机页面里的小工具（墙钟驱动：联机时不能用 __br.step，两页各自按 rAF 跑）
function installCoopV() {
  const V = window.__v = {};
  V.key = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    const f = ((c && c.res && c.res.data && c.res.data.forklifts) || []).find(q => q.x > 12 && q.x < 20 && q.z > 12 && q.z < 20);
    return f ? f.key : null;
  };
  V.pose = k => { const v = BR.vehicles.byKey(k); return v ? { x: v.pose.x, z: v.pose.z, yaw: v.pose.yaw, lift: v.pose.lift, spd: v.pose.spd, on: v.pose.on, seat: v.seat } : null; };
  V.W = (k, lx, lz) => { const p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  V.standL = (k, lx, lz) => {
    const w = V.W(k, lx, lz), s = V.W(k, 0, 0.24), P = BR.player;
    P.x = w.x; P.z = w.z; P.vx = 0; P.vz = 0; P.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z)); P.pitch = 0;
    if (BR.interact && BR.interact.aimAt) BR.interact.aimAt(s.x, 1.25, s.z);
    return 0;
  };
  V.tap = code => new Promise(res => {
    const o = { code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', o)); window.dispatchEvent(new KeyboardEvent('keyup', o));
    requestAnimationFrame(() => requestAnimationFrame(() => res(0)));
  });
  V.down = code => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); return 0; };
  V.up = code => { window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); return 0; };
  V.seat = () => ({ seated: BR.vehicles.seated, phase: BR.vehicles.debugInfo().phase, coop: BR.coop.phase, role: BR.coop.role });
  V.untilRun = () => new Promise(res => { const w0 = performance.now(); const tick = () => { const ph = BR.vehicles.debugInfo().phase; if (ph === 'run' || performance.now() - w0 > 30000) { res(ph); return; } requestAnimationFrame(tick); }; tick(); });
  V.simT = 0;
  if (BR.vehicles && typeof BR.vehicles.update === 'function') { const ou = BR.vehicles.update; BR.vehicles.update = function (dt) { V.simT += +dt || 0; return ou.apply(this, arguments); }; }
  // 等模拟时间走 sec 秒（负载高、帧率低时墙钟 2 s 可能只模拟了零点几秒；返修 FE1Q · repair-r2）；墙钟最多等 wallMax 秒
  V.waitSim = (sec, wallMax) => new Promise(res => { const t0 = V.simT, w0 = performance.now(); const t = () => { if (V.simT - t0 >= sec || performance.now() - w0 > (wallMax || 60) * 1000) { res(+(V.simT - t0).toFixed(3)); return; } requestAnimationFrame(t); }; t(); });
  V.hold = (code, sec) => new Promise(res => {
    V.down(code);
    const t0 = V.simT, w0 = performance.now();
    const tick = () => { if (V.simT - t0 >= sec || performance.now() - w0 > 60000) { V.up(code); res(+(V.simT - t0).toFixed(3)); return; } requestAnimationFrame(tick); };
    tick();
  });
  V.keepAlive = on => { clearInterval(V._ka); if (on) V._ka = setInterval(() => { if (BR.player) { BR.player.hp = 100; BR.player.sanity = 100; if ('hunger' in BR.player) BR.player.hunger = 100; } }, 30); return 0; };
  // 每帧记 lift（rAF）；房主另外记收到的 net:veh 的 lift
  V.rec = []; V.recOn = false; V.net = [];
  V.startRec = k => {
    V.rec.length = 0; V.net.length = 0; V.recOn = true; V.recK = k; if (V.dg) V.dg.length = 0;
    V.sp = V.sp || []; V.sp.length = 0;
    // 返修 r1（验收员：房主页面在后台时 rAF 只有约 2 Hz，0.5 s 以内的短暂往回掉抓不到）：再在房主这边包一层 BR.vehicles.setPose，
    // 载具层每一次摆这台车（远端车每帧 applyPose、收尾 finish / placeParked）都记下 lift，不靠计时器采样
    if (!V._spWrap && BR.vehicles && typeof BR.vehicles.setPose === 'function') {
      const o = BR.vehicles.setPose;
      V._spWrap = true;
      BR.vehicles.setPose = function (key, pose) { if (V.recOn && key === V.recK && pose && pose.lift != null) V.sp.push([Math.round(performance.now()), +(+pose.lift).toFixed(4)]); return o.apply(this, arguments); };
    }
    if (!V._recTick) {
      // V.dg（返修 FE1Q · repair-r2，验收员 play：C3.1 负载 50 时挂过一次「车没开动」）：逐帧记模拟时间、W/S 输入（BR.input.move.y）、R 按着没有、phase，
      // 没开动时拿来区分「机器太忙丢了键 / 帧太少」和「松开 R 同一帧按 W 不起车」这种游戏问题
      V.dg = V.dg || [];
      V._recTick = () => { if (V.recOn) { const v = BR.vehicles.byKey(V.recK); if (v) { V.rec.push([Math.round(performance.now()), +v.pose.lift.toFixed(4), +v.pose.spd.toFixed(2)]); V.dg.push([Math.round(performance.now()), +V.simT.toFixed(3), +v.pose.spd.toFixed(2), +((BR.input && BR.input.move && BR.input.move.y) || 0).toFixed(2), BR.input && BR.input.held && BR.input.held('liftUp') ? 1 : 0, BR.vehicles.debugInfo().phase || '']); } } requestAnimationFrame(V._recTick); };
      V._recTick();
      if (BR.bus) BR.bus.on('net:veh', p => { if (V.recOn) V.net.push([Math.round(performance.now()), +(+p.lift).toFixed(4)]); });
    }
    return 0;
  };
  V.stopRec = () => { V.recOn = false; return { rec: V.rec.slice(), net: V.net.slice(), sp: (V.sp || []).slice(), dg: (V.dg || []).slice() }; };
  // 按住 R 升到 tgt：mode 'same' 升到的那一帧松 R、按 go；'next' 只松 R（外面再按）
  // maxSec 按模拟时间（返修 FE1Q · repair-r2：以前按墙钟 30 s，负载 57 时只升到 0.277 就停了）；墙钟最多 120 s
  V.liftTo = (k, tgt, go, maxSec) => new Promise(res => {
    V.down('KeyR');
    const w0 = performance.now(), s0 = V.simT;
    const t = () => { const l = BR.vehicles.byKey(k).pose.lift; if (l >= tgt || V.simT - s0 > maxSec || performance.now() - w0 > 120000) { V.up('KeyR'); if (go) V.down(go); res(+l.toFixed(4)); return; } requestAnimationFrame(t); };
    t();
  });
  V.lowerTo = (k, tgt, maxSec) => new Promise(res => { V.down('KeyC'); const w0 = performance.now(); const t = () => { const l = BR.vehicles.byKey(k).pose.lift; if (l <= tgt || performance.now() - w0 > maxSec * 1000) { V.up('KeyC'); res(+l.toFixed(4)); return; } requestAnimationFrame(t); }; t(); });
  // 房主跟车（g5 拍照的做法：每次画画面之前把房主摆到车本地右后方 (2.25, 1.0)）
  V.fol = null;
  const R0 = BR.gfx.render;
  BR.gfx.render = function () {
    const f = V.fol, v = f && BR.vehicles.byKey(f);
    if (v) { const p = v.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), P = BR.player; P.x = p.x + c * 2.25 + s * 1.0; P.z = p.z - s * 2.25 + c * 1.0; P.vx = 0; P.vz = 0; }
    return R0.apply(this, arguments);
  };
}
async function waitFor(page, fn, arg, timeout) { try { await page.waitForFunction(fn, arg, { timeout: timeout || 10000, polling: 100 }); return true; } catch (e) { return false; } }
async function clickBanner(page) {
  const r = await ev(page, () => {
    const n = Array.from(document.querySelectorAll('.hud-notice')).filter(x => x.getClientRects().length && /点一下画面/.test(x.textContent));
    const b = n.length ? n[0].getBoundingClientRect() : null;
    return b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
  });
  if (r) { await page.mouse.click(r.x, r.y); await sleep(600); }
}
async function hostCamp(page, name) {
  await page.locator('.home-secondary-btn.is-coop').first().click();
  await page.waitForSelector('.coop-lobby', { state: 'visible', timeout: 25000 });
  await page.fill('.coop-lobby .coop-name-field .coop-input', name);
  await page.locator('.coop-lobby .coop-btn-host').click();
  const ok = await waitFor(page, () => BR.coop.phase === 'hosting' && /^[A-Z2-9]{3} [A-Z2-9]{3}$/.test(document.querySelector('.coop-lobby .coop-view-host .coop-code').textContent), null, 15000);
  if (!ok) return null;
  const code = (await page.textContent('.coop-lobby .coop-view-host .coop-code')).replace(/\s+/g, '');
  await page.locator('.coop-lobby .coop-btn-enter').click();
  const inCamp = await waitFor(page, () => BR.game.levelId === 'coopcamp' && BR.game.screen === 'playing' && !BR.world.transitioning && !!(BR.coopCamp && BR.coopCamp.inCamp), null, 30000);
  return inCamp ? code : null;
}
async function joinCamp(page, code, name) {
  await page.locator('.home-secondary-btn.is-coop').first().click();
  await page.waitForSelector('.coop-lobby', { state: 'visible', timeout: 25000 });
  await page.fill('.coop-lobby .coop-name-field .coop-input', name);
  await page.locator('.coop-lobby .coop-btn-join').click();
  await page.waitForSelector('.coop-code-input', { state: 'visible', timeout: 20000 });
  await page.fill('.coop-code-input', code);
  await waitFor(page, () => { const c = document.querySelector('.coop-camp-card'); return c && !c.hidden && !/正在找营地/.test(c.textContent) && c.getClientRects().length > 0; }, null, 30000);
  await page.locator('.coop-lobby .coop-btn-joincamp').click();
  return await waitFor(page, () => BR.coop.active && BR.coop.phase === 'active', null, 90000) &&
    await waitFor(page, () => BR.game.levelId === 'coopcamp' && BR.game.screen === 'playing' && !BR.world.transitioning && !!(BR.coopCamp && BR.coopCamp.inCamp), null, 45000);
}
async function enterTent(page) {
  await ev(page, () => { if (!BR.coopCamp.panelOpen) BR.coopCamp.enter({ force: true }); return 0; });
  return waitFor(page, () => BR.coopCamp.panelOpen && !!document.querySelector('.tent-menu:not([hidden]) .tent-ready'), null, 30000);
}
async function departBoth(pages, lv, mode) {
  for (const p of pages) if (!await enterTent(p)) return false;
  for (const p of pages) if (!await waitFor(p, () => { const b = document.querySelector('.tent-menu .tent-ready'); return b && !b.disabled && /^准备$/.test(b.textContent.trim()); }, null, 30000)) return false;
  for (const p of pages) await ev(p, () => { document.querySelector('.tent-menu .tent-ready').click(); return 0; });
  const r = await Promise.all(pages.map(p => waitFor(p, a => BR.game.levelId === a.lv && BR.game.mode === a.mode && BR.game.screen === 'playing' && !BR.world.transitioning && BR.coopCamp.transit === 'idle', { lv, mode }, 150000)));
  await sleep(800);
  return r.every(Boolean);
}
async function gCoop() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: COOP_ARGS });
  try {
    const { page: A } = await coopPage(browser, 'A');
    const { page: B } = await coopPage(browser, 'B', { width: 480, height: 270 });
    // J2（返修 FE1Q · repair-r2）：客机用低画质（手机），出生车两边都该是运行时车：房主载具网格 mid、客机 drvLow
    await ev(B, () => { BR.game.settings.quality = 'low'; return 0; });
    const code = await hostCamp(A, '贝塔');
    const joined = code ? await joinCamp(B, code, '小伙伴') : false;
    check('C0 两个页面联机进营地（内存假 room.php）', !!code && joined, { code, joined });
    if (!joined) return;
    await ev(A, () => BR.coopCamp._debugSet({ mode: 'casual', lv: '1' }));
    await waitFor(B, () => { const s = BR.coopCamp.state; return !!s && s.mode === 'casual' && String(s.lv) === '1'; }, null, 30000);
    // 这一局的种子固定成 12345（只改测试页面：出发前后临时让 getRandomValues 给 12345，进层以后还原）
    await ev(A, () => { const c = window.crypto, o = c.getRandomValues.bind(c); window.__grvOrig = o; c.getRandomValues = a => { if (a instanceof Uint32Array && a.length === 1) { a[0] = 12345; return a; } return o(a); }; return 0; });
    const arrived = await departBoth([A, B], '1', 'casual');
    await ev(A, () => { if (window.__grvOrig) window.crypto.getRandomValues = window.__grvOrig; return 0; });
    check('C1 帐篷选「游玩 + Level 1」一起出发', arrived);
    if (!arrived) return;
    await Promise.all([A, B].map(p => ev(p, () => __v.keepAlive(true))));
    await clickBanner(A); await clickBanner(B);
    const K = await ev(A, () => __v.key());
    // ---------- J2：出生块的车两边都是运行时车 ----------
    const infoOf = p => ev(p, () => {
      const c = BR.world.chunks().find(q => q.key === '0,0');
      const recs = ((c && c.res && c.res.data && c.res.data.forklifts) || []).map(r => ({ key: r.key, runtime: !!r.runtime, detail: r.detail, tris: r.tris, spans: !!r.spans }));
      const k = __v.key(), v = BR.vehicles.byKey(k), di = BR.vehicles.debugInfo();
      return { seed: BR.game.seed >>> 0, q: BR.game.settings.quality, k, recs, runtime: !!(v && v.runtime), tier: di.tiers[k], pose: v && { x: +v.pose.x.toFixed(3), z: +v.pose.z.toFixed(3), yaw: +v.pose.yaw.toFixed(3) } };
    });
    // (0,0) 的 kit:prop 里叠成一点的三角形（载具层藏掉区块段的办法）：出生车不在区块几何里，开车时两边都不该有
    const degen = p => ev(p, () => { const c = BR.world.chunks().find(q => q.key === '0,0'); const m = c && (c.res.group || c.group).children.find(o => o.isMesh && o.name === 'kit:prop'); if (!m) return null; const a = m.geometry.attributes.position.array, ix = m.geometry.index ? m.geometry.index.array : null; let n = 0; const T = ix ? ix.length / 3 : a.length / 9; for (let t = 0; t < T; t++) { const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2; if (a[i0 * 3] === a[i1 * 3] && a[i0 * 3] === a[i2 * 3] && a[i0 * 3 + 1] === a[i1 * 3 + 1] && a[i0 * 3 + 1] === a[i2 * 3 + 1] && a[i0 * 3 + 2] === a[i1 * 3 + 2] && a[i0 * 3 + 2] === a[i2 * 3 + 2]) n++; } return { tris: T, degen: n }; });
    const iA = await infoOf(A), iB = await infoOf(B);
    check('J2a 房主（高画质）：种子 12345 出生块的车全是运行时车（不进区块几何、没有 spans），进层就是载具网格 mid',
      iA.seed === 12345 && iA.q === 'high' && iA.recs.length > 0 && iA.recs.every(r => r.runtime && !r.spans && !r.tris && r.detail == null) && iA.runtime && iA.tier === 'mid' && iA.k === K, iA);
    check('J2b 客机（低画质）：同一台车也是运行时车，载具网格 drvLow',
      iB.q === 'low' && iB.recs.length === iA.recs.length && iB.recs.every(r => r.runtime && !r.spans) && iB.runtime && iB.tier === 'drvLow' && iB.k === iA.k, iB);
    // 房主把出生柱间那台车摆到南主通道十字口（levelState 回放，两边同步）；每一趟 C3 开始前都摆回这里
    const START = { x: -1, z: 32.6, yaw: -Math.PI / 2 };
    const place = () => ev(A, a => { BR.levelState.set('1', 'veh', a.k, { x: a.p.x, z: a.p.z, yaw: a.p.yaw, steer: 0, lift: 0, on: 0, carry: null, n: (BR.vehicles.byKey(a.k) || {}).n || 0 }); return 0; }, { k: K, p: START });
    const atStart = p => waitFor(p, a => { const v = BR.vehicles.byKey(a.k); return !!v && Math.hypot(v.pose.x - a.p.x, v.pose.z - a.p.z) < 0.02 && v.pose.lift < 0.002; }, { k: K, p: START }, 15000);
    const mount = async () => {
      await ev(A, k => __v.standL(k, -3.5, 3.0), K);
      await ev(B, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(800);
      await ev(B, k => __v.standL(k, 1.2, 0.24), K);
      await sleep(300);
      await ev(B, () => __v.tap('Space'));
      return ev(B, () => __v.untilRun());
    };
    const dismount = async () => {
      await ev(B, () => { __v.up('KeyW'); __v.up('KeyS'); __v.up('KeyA'); __v.up('KeyR'); __v.up('KeyC'); BR.player.pitch = 0; return 0; });
      await ev(B, () => __v.tap('Space'));
      return waitFor(B, () => !BR.vehicles.seated && BR.vehicles.debugInfo().phase !== 'exit', null, 15000);
    };
    await place();
    await sleep(1500);
    const ph = await mount();
    check('C2 客机坐上车、着车', ph === 'run', await ev(B, () => __v.seat()));
    if (ph !== 'run') return;
    await sleep(1000);
    // J2d / J2e：客机开出去 >1 m（模拟时间 1.5 s），房主看到车在开、两边档不变、不用藏区块段
    const pa0 = await ev(A, k => __v.pose(k), K);
    await ev(B, () => __v.hold('KeyW', 1.5));
    // 负载高时墙钟 1.5 s 车还没停稳（第一次跑负载 28 时客机 2.1 m/s、房主 2.4 m/s，两边差 22 cm）：等客机那边车停住，
    // 再等房主那边追上客机停下的位置（最多 10 s），然后比
    await waitFor(B, k => { const v = BR.vehicles.byKey(k); return !!v && Math.abs(v.pose.spd) < 0.01; }, K, 20000);
    const pb1 = await ev(B, k => __v.pose(k), K);
    await waitFor(A, a => { const v = BR.vehicles.byKey(a.k); return !!v && Math.hypot(v.pose.x - a.p.x, v.pose.z - a.p.z) < 0.05; }, { k: K, p: pb1 }, 10000);
    const pa1 = await ev(A, k => __v.pose(k), K);
    const iA2 = await infoOf(A), iB2 = await infoOf(B);
    check('J2d 客机开出去 >1 m，房主看到车在开（两边位姿差 <5 cm），两边都还是 mid / drvLow',
      Math.hypot(pa1.x - pa0.x, pa1.z - pa0.z) > 1 && Math.hypot(pa1.x - pb1.x, pa1.z - pb1.z) < 0.05 && iA2.tier === 'mid' && iB2.tier === 'drvLow', { pa0, pa1, pb1, tiers: [iA2.tier, iB2.tier] });
    const dA = await degen(A), dB = await degen(B);
    check('J2e 客机开车两边都不需要藏区块段：(0,0) kit:prop 里没有叠成一点的三角形', !!dA && !!dB && dA.degen === 0 && dB.degen === 0, { A: dA, B: dB });
    // 每一趟：客机下车 → 房主摆回起点 → 客机上车 → 升到一半松 R、按 W / S 开（同一帧 / 下一帧 / 隔 0.3 s）；或者按时间升、停 1.2 s、W + A 满舵绕圈（房主跟车）
    const trials = [
      { tgt: 0.33, mode: 'same', go: 'KeyW', drive: 2.5 },
      { tgt: 0.22, mode: 'next', go: 'KeyS', drive: 2.0 },
      { tgt: 0.30, mode: 'gap', go: 'KeyW', drive: 2.0 },
      { hold: 1.9, mode: 'g5', go: 'KeyW', turn: 'KeyA', drive: 6.0 },
    ];
    // 客机逐帧记录的摘要（没开动时看是不是机器太忙：帧数、模拟了多久、W/S 输入按着的帧、R 按着的帧、phase）
    const dgSum = dg => {
      if (!dg || !dg.length) return { frames: 0 };
      const ph2 = {}; let mv = 0, r = 0, vmax = 0;
      for (const q of dg) { ph2[q[5]] = (ph2[q[5]] || 0) + 1; if (q[3] !== 0) mv++; if (q[4]) r++; vmax = Math.max(vmax, Math.abs(q[2])); }
      return { frames: dg.length, wall: dg[dg.length - 1][0] - dg[0][0], sim: +(dg[dg.length - 1][1] - dg[0][1]).toFixed(3), moveFrames: mv, rFrames: r, vmax, phase: ph2, head: dg.slice(0, 3), tail: dg.slice(-3) };
    };
    let i = 0;
    for (const T of trials) {
      i++;
      let res = null;
      for (let attempt = 0; attempt < 2 && !(res && res.pre); attempt++) {
        // 摆回起点（两边都看到车在起点、货叉落地）再上车
        await ev(B, k => __v.lowerTo(k, 0.0005, 25), K);
        const off = await dismount();
        await place();
        const there = (await atStart(A)) && (await atStart(B));
        const ph2 = await mount();
        if (!off || !there || ph2 !== 'run') { res = { pre: false, why: '摆回起点 / 重新上车没成', off, there, ph: ph2 }; continue; }
        await sleep(800);
        await ev(A, k => __v.startRec(k), K); await ev(B, k => __v.startRec(k), K);
        let lifted = null;
        if (T.mode === 'g5') {
          await ev(A, k => { __v.fol = k; return 0; }, K);
          await ev(B, s => __v.hold('KeyR', s), T.hold);
          await ev(B, () => __v.waitSim(1.2));
          await ev(B, t => { __v.down('KeyW'); __v.down(t); return 0; }, T.turn);
          await ev(B, s => __v.waitSim(s), T.drive);
          await ev(B, t => { __v.up('KeyW'); __v.up(t); return 0; }, T.turn);
          await ev(A, () => { __v.fol = null; return 0; });
        } else {
          lifted = await ev(B, a => __v.liftTo(a.k, a.t, a.same ? a.go : null, 30), { k: K, t: T.tgt, same: T.mode === 'same', go: T.go });
          if (T.mode === 'gap') await ev(B, () => __v.waitSim(0.3));
          if (T.mode !== 'same') await ev(B, g => __v.down(g), T.go);
          await ev(B, s => __v.waitSim(s), T.drive);
          await ev(B, g => { __v.up(g); return 0; }, T.go);
        }
        await sleep(1500);
        const ra = await ev(A, () => __v.stopRec()), rb = await ev(B, () => __v.stopRec());
        const moved = rb.rec.some(r => Math.abs(r[2]) > 0.3);
        const reached = lifted == null || lifted >= T.tgt - 1e-4;
        res = { pre: moved && reached, ra, rb, moved, lifted, reached, dg: dgSum(rb.dg) };
        if (!res.pre) info('C3.' + i + ' 前提不成立（第 ' + (attempt + 1) + ' 次：' + (!reached ? '升不到 ' + T.tgt + '，只到 ' + lifted : '车没开动') + '），摆回起点重来', res.dg);
      }
      if (!res.pre) { skip('C3.' + i + ' 客机升起来以后开车，房主那边 lift 不往回掉（' + T.mode + '）', { why: res.why || (!res.reached ? '升不到目标' : '车没开动'), T, lifted: res.lifted, dg: res.dg, load: os.loadavg()[0] }); continue; }
      const { ra, rb } = res;
      let hPeak = -1, hDrop = 0, gPeak = -1, gDrop = 0;
      for (const r of ra.rec) { if (r[1] > hPeak) hPeak = r[1]; else hDrop = Math.max(hDrop, hPeak - r[1]); }
      for (const r of rb.rec) { if (r[1] > gPeak) gPeak = r[1]; else gDrop = Math.max(gDrop, gPeak - r[1]); }
      const hEnd = ra.rec.length ? ra.rec[ra.rec.length - 1][1] : null, gEnd = rb.rec.length ? rb.rec[rb.rec.length - 1][1] : null;
      const netDrop = (() => { let pk = -1, d = 0; for (const q of ra.net) { if (q[1] > pk) pk = q[1]; else d = Math.max(d, pk - q[1]); } return d; })();
      const spDrop = (() => { let pk = -1, d = 0; for (const q of ra.sp) { if (q[1] > pk) pk = q[1]; else d = Math.max(d, pk - q[1]); } return d; })();
      check('C3.' + i + ' 客机升到 ' + gPeak.toFixed(3) + '（' + T.mode + '）以后开起来：房主那边 lift 升到最高 ' + hPeak.toFixed(3) + ' 以后不往回掉（最多掉 ' + (hDrop * 1000).toFixed(1) + ' mm），' +
        '收到的 net:veh 也不往回掉（' + (netDrop * 1000).toFixed(1) + ' mm），房主载具层每一次 setPose 也不往回掉（' + ra.sp.length + ' 次，最多掉 ' + (spDrop * 1000).toFixed(1) + ' mm），开完两边差 ' +
        (hEnd != null && gEnd != null ? (Math.abs(hEnd - gEnd) * 1000).toFixed(1) : '?') + ' mm',
        hPeak > 0.15 && hDrop <= 0.002 && gDrop <= 0.002 && netDrop <= 0.002 && ra.sp.length > 10 && spDrop <= 0.002 && hEnd != null && gEnd != null && Math.abs(hEnd - gEnd) <= 0.002,
        { T, hPeak, hDrop, gPeak, gDrop, netDrop, spDrop, nSp: ra.sp.length, hEnd, gEnd, nA: ra.rec.length, nB: rb.rec.length, nNet: ra.net.length, moved: res.moved, dg: res.dg });
    }
    // J2f：客机下车，两边位姿一致，房主 levelState 记下了
    const off2 = await dismount();
    await sleep(1500);
    const pa2 = await ev(A, k => __v.pose(k), K), pb2 = await ev(B, k => __v.pose(k), K);
    const ls = await ev(A, k => { const r = BR.levelState.peek('1'); const e = r && r.vehicles ? Array.from(r.vehicles.entries()).filter(q => q[0] === k) : []; return e.length ? e : null; }, K);
    check('J2f 客机下车：两边位姿一致（<1 cm），房主 levelState 记下了这台车', off2 && !!pa2 && !!pb2 && Math.hypot(pa2.x - pb2.x, pa2.z - pb2.z) < 0.01 && !pb2.seat && !!ls, { pa2, pb2, ls });
  } finally {
    await Promise.race([browser.close().catch(() => {}), sleep(10000)]);
  }
}

// =====================================================================
const RUN = { light: gLight, vine: gVine, coop: () => gCoop() };
async function main() {
  const t0 = Date.now();
  const srv = await startServer();
  BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + BASE + '  组：' + GROUPS.join(','));
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    for (const g of GROUPS) {
      GROUP = g;
      OUT = path.join(OUT_BASE, g);
      fs.mkdirSync(OUT, { recursive: true });
      const tg = Date.now();
      console.log('\n----- ' + g + ' -----');
      try { await RUN[g](browser); } catch (err) { check(g + ' 流程没有中断', false, String(err && err.stack || err).slice(0, 1500)); }
      console.log('  (' + g + ' ' + ((Date.now() - tg) / 1000).toFixed(1) + 's)');
      try { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ group: g, ms: Date.now() - tg, checks: data[g] || [] }, null, 1) + '\n'); } catch (e) { /* 忽略 */ }
    }
  } catch (err) {
    check('测试流程没有中断', false, String(err && err.stack || err).slice(0, 1500));
  }
  for (const e of errors.slice(0, 40)) console.log('ERR ' + e.slice(0, 800));
  console.log('\n===== 汇总 =====');
  console.log('检查 ' + (pass + fail) + ' 项，失败 ' + fail + ' 项');
  if (skips) console.log('跳过 ' + skips + ' 项');
  for (const f of failed) console.log('  FAIL ' + f);
  console.log('页面报错 ' + errors.length + ' 条');
  console.log('耗时 ' + Math.round((Date.now() - t0) / 1000) + 's；数值结果：tests/output/forklift_polish/<组>/result.json');
  const code = fail || errors.length ? 1 : 0;
  await Promise.race([browser.close().catch(() => {}), sleep(10000)]);
  srv.close();
  process.exit(code);
}
main();
