// 后室 · FE1P 叉车打磨回归（FE1P-light 那一份：H8 大灯不透墙、H9 藤蔓贴着护顶、H14 联机升降高度不往回掉；
//                          FE1Q-light：J3 藤蔓贴着看得见的护顶、J8 lightAt 和画面一致、J9 货架通道里车灯照得远）
//                          FE1R-light：K1 窄东西照旧亮、K2 车前空地一定亮 / 开车不跳、宽块别的车不漏光、天花板、工坊、F1–F4 升降和后轮碰撞）
//   node tests/forklift_polish.mjs [--group light,k2,k1,smooth,ws,lift,drive,vine,coop] [--verbose] [--old] [--before <目录>] [--head-others]
//   --head-others（开发用）：别的代理正在改的文件按 git HEAD 给，只测这一组（forklift.js / world.js / vehicles_net.js / 本文件）的改动
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
//   FE1R-light 加的组（主会话裁定 K1 / K2 / L-occluders / L-ceiling / L-workshop / F1–F4）：
//   k2     种子 12345 / 16 / 39 各等一次断电、坐上出生车、冻住断电计时，按 15 类（货架通道 / 贴货架 / 通道口 / 货架头 / 墙边 / 正对墙 / 墙角 / 门口 / 空地 /
//          撞车直道 / 树和杆子 / 柱子 / 别的车 / 高堆垛 / 矮货架配电柜）各生成 12 个随机位姿（种子固定，≥150 个）加点名的几处，每个位姿：
//          车前判定区（叉尖前 0.5 m 到 min(3, 车宽带里第一个挡光体 − 0.2)、横向 ±0.5、每 0.25 m，去掉离实体面 <0.3 m、驾驶座看不见的）开关灯渲染差 ≥8、
//          lightAt 亮；墙后（视线被墙 / 货架 / 宽堆垛 / 别的车挡住的地面）≤2，光球里朝着光源被挡住的竖直面 0 个；lightAt 一致。照不全的位姿用同一套界限
//          细网格暴力搜一遍：一盏光源也照不全的算几何例外（≤3%，叉尖前 0.5–1.5 m 仍全亮，截图在 k2-<种子>-<序号>-<类>.png），照得全却没照全的算失败。
//          种子 12345 另量 L-ceiling（前方 ≥6 m 开阔的位姿：光源上方天花板 ≤ 叉尖前 1 m 地面、≤40，车后天花板 ≤2）、K1 (4)（正对门框立柱 / 柱子）、
//          正对 4.46–6 m 外的墙（亮斑没有或 ≥0.6 m、不发白）、正对小屋门（光源不进屋、屋里墙后 ≤2）；种子 16 量 L-occluders #110
//   k1     ⑨ 那棵枯树（种子 12345，不断电）：⑨ 机位树干三点、树前 0.6 m 地面 ≥8，树干那一片平均亮度不比 pre-polish 旧图暗 8 级以上；叉尖离树 0.3–4.0 m
//          每 0.1 m × 横偏 0 / ±0.12 都 ≥8、树干最大通道 <245；真键盘开过去逐帧平滑
//   smooth 排查那 12 条真键盘路线（断电），60 fps 逐帧：叉尖前 0.5 / 1.5 / 3 / 5 m 地面（只比两帧都在车前空地上的点）相邻帧差 ≤8 级、驾驶座画面下半区 ≤4 级
//   ws     工坊地图（基于 L1、种子 12345）全部熄灯 / 闪烁更频繁 / 亮度 ×0.2：大灯不跟着变（灯池里那盏强度 = 大灯自己的）、全部熄灯时车前判定区 ≥8、
//          闪烁时 20 s 内强度逐帧跳变 ≤10%、lightAt 一致
//   lift   F1 门楣挡升货叉（(8, 33.3) 开进门洞按住 R 7 s，再带货；再抽 ≥20 个门楣）、F3 电缆底下带货升
//   drive  F3 举着货开过电缆、叉尖放货顶墙；F2 后轮（小屋西墙外 / 货架旁原地打满、货架通道里贴着转弯、旁边的物资、旁边的测试人）；
//          F4 车轮挡在旧射线中间 / 叉尖 / 叉根 / 货叉侧边下降货叉，排查机位按住 C
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
const ALL_GROUPS = ['light', 'k2', 'k1', 'smooth', 'ws', 'lift', 'drive', 'vine', 'coop'];
const GROUPS = argOf('group') ? argOf('group').split(',').map(s => s.trim()).filter(Boolean) : ALL_GROUPS.slice();
const VERBOSE = argv.includes('--verbose');
// --old（反证）：静态服务给出 FE1 提交（4a4466a）时的 forklift.js / world.js / vehicles_net.js（git show，只读），light、vine 组应该报出 FAIL
const OLD = argv.includes('--old');
const OLD_FILES = ['js/game/forklift.js', 'js/game/world.js', 'js/game/vehicles_net.js'];
// FE1Q（git HEAD 的 forklift.js / world.js / vehicles_net.js）在 L9 / L9c 那三处朝通道的货那一点量出来的开关灯差（返修 FE1R · repair-r4，只记录，见 aisleCheck）
const FE1Q_GOODS = { 'L9-aisle': 48.3, 'L9-aisle134': 86.11, 'L9c-aisle': 78.06 };
// 主会话 L3 的口径（返修 FE1R · repair-r5，验收员 tests / spec / play）：驾驶座截图（960×540，司机眼点往叉尖前 7.1 m 看）左、右两片区域
// （x 0–25% / 75–100%，y 28–72%）开灯减关灯的平均亮度（Rec.601，0–255）。同一个测试、同一套量法拿两份别的代码量的基准
// （tests/output/stage-FE1R/repair-r5/logs/ov-fe1q-light-*.log、ov-prel3-light-*.log）：
//   FE1Q_REG  —— FE1Q（git HEAD 的 forklift.js / world.js / vehicles_net.js），两边货架的货要 ≥ 它的 80%（照得到的那一侧）；
//   PRE_L3_REG —— 加 L3 之前的 forklift.js（repair-r4 改动前），每个位姿照得到的那一侧都要比它亮（L3 没做 / 退回去这一项拦得住）
// 贴柱子那条道、L9c 这两处驾驶座画面两边看到的是车旁边的货（光在车头前面，FE1Q 也照不到，区域差 ≤0.6），按区域比没意义：
// 这两处按测试那一点（叉尖前约 2.4 m、离地 1.2 m 朝通道的货，FE1Q_GOODS 那一点）比 PRE_L3_GOODS
const FE1Q_REG = { 'L9-aisle': { L: 13.82, R: 19.97 } };
const PRE_L3_REG = { 'L9-aisle': { L: 4.66, R: 5.42 } };
const PRE_L3_GOODS = { 'L9-aisle': 17.89, 'L9-aisle134': 51.04, 'L9c-aisle': 45.17 };
const oldSrc = new Map();
if (OLD) {
  const { execFileSync } = require('node:child_process');
  for (const f of OLD_FILES) oldSrc.set(f, execFileSync('git', ['show', '4a4466a:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
} else if (BEFORE) {
  for (const f of OLD_FILES) oldSrc.set(f, fs.readFileSync(path.resolve(BEFORE, path.basename(f)), 'utf8'));
}
// --head-others（FE1R-light 开发用）：别的代理正在改的文件（工作区里改过、又不是本组那四个）一律按 git HEAD 给，只测本组的改动
if (argv.includes('--head-others')) {
  const { execFileSync } = require('node:child_process');
  const mine = new Set(OLD_FILES.concat(['tests/forklift_polish.mjs']));
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split('\n').map(q => q.trim()).filter(q => q && !mine.has(q) && !q.startsWith('tests/') && /\.(js|css|html)$/.test(q));
  for (const f of changed) { try { oldSrc.set(f, execFileSync('git', ['show', 'HEAD:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })); } catch (e) { /* 新文件 */ } }
  console.log('--head-others：按 HEAD 给 ' + changed.length + ' 个文件');
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
  // p.see（FE1R）：先打一条射线，相机看过去第一下打到的不是这一点（被挡住、或者从货架格子的空当里看到了后面别的东西）就记 null，不量
  F.measure = (eye, at, pts) => {
    const cam = BR.gfx.camera, P = cam.position.clone(), Q = cam.quaternion.clone();
    cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(at.x, at.y, at.z); cam.updateMatrixWorld(true);
    const g = F.grab(), w = g.canvas.width, h = g.canvas.height;
    const rc = new THREE.Raycaster(), meshes = [];
    if (pts.some(p => p.see)) BR.gfx.scene.traverseVisible(o => { if (o.isMesh) meshes.push(o); });
    const out = pts.map(p => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
      if (p.see) {
        const e = new THREE.Vector3(eye.x, eye.y, eye.z), d = new THREE.Vector3(p.x - eye.x, p.y - eye.y, p.z - eye.z), L = d.length();
        rc.set(e, d.normalize()); rc.near = 0; rc.far = L + 0.5;
        const hit = rc.intersectObjects(meshes, false)[0];
        if (!hit || Math.abs(hit.distance - L) > 0.06) return null;
      }
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
  // 机器很忙时页面 2 分钟都载不完：最多试三次，每次换一个新的 context / 页面（同一页面上重试会撞上还没完的上一次导航）
  let ctx = null, page = null;
  for (let t = 0; ; t++) {
    ctx = await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 } }, ctxOpts || {}));
    page = await ctx.newPage();
    page.on('console', m => { if (m.type() !== 'error') return; const loc = (m.location() && m.location().url) || ''; errors.push('[' + tag + '] console.error: ' + m.text() + (loc ? ' @ ' + loc : '')); });
    page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
    // 测试绝不连真实联机服务器：api.ovobot.ai 回假响应，其余外部请求一律掐掉
    await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
    try { await page.goto(BASE + 'index.html', { timeout: 120000 }); break; } catch (e) { await ctx.close().catch(() => {}); if (t >= 2) throw e; }
  }
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
// 货架是透的：背面那几点只量相机真打到它的（从格子空当里看到的车那一侧被照亮的东西不算这一侧，see）
const PTS_RACK = [
  { n: '货架背面的货 中', x: 8.0, y: 0.6, z: 25.17, r: 3, see: true }, { n: '货架背面的货 左', x: 6.6, y: 1.5, z: 25.17, r: 3, see: true },
  { n: '货架背面的货 右', x: 9.6, y: 1.0, z: 25.17, r: 3, see: true }, { n: '另一侧通道地面', x: 8.0, y: 0.005, z: 25.8, r: 3 },
  { n: '另一侧通道地面 远', x: 7.0, y: 0.005, z: 26.6, r: 3 },
];
async function gLight(browser) {
  const { ctx, page } = await boot(browser, 'light');
  try {
    await ev(page, installSw);
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
    // 断电计时冻住（L1 的 update 按 dt 0 推），每个位姿瞬移后多推 0.5 s 让大灯落点、光球、强度平滑到位再量（没到位时推那 2 帧
    // 强度还在变，vehicles 会把刚撤掉的灯重新推回灯池，「关灯」那一下量到的其实还开着）
    await ev(page, k => { __sw.init(k); return __sw.freeze(); }, k);
    for (const C of cases) {
      idx++;
      if (!await stillDark(page)) { check('L4.' + idx + ' ' + C.n + '：还在断电里', false); break; }
      const pk = await ev(page, k => __fp.physKey(k), k);
      const free = await ev(page, a => __fp.hitsAt(a.p.x, a.p.z, a.p.yaw, 0, a.pk), { p: C.pose, pk });
      const tp = await ev(page, a => __fp.teleport(a.k, a.p.x, a.p.z, a.p.yaw), { k, p: C.pose });
      await ev(page, () => { __fp.frames(15); return __fp.renderOnly(12); });
      const st = await ev(page, a => {
        const L = __fp.extra[a.owner] && __fp.extra[a.owner][0], inf = BR.forklift.byKey(a.k).lightInfo;
        return { L: L && { x: __fp.r(L.x), y: L.y, z: __fp.r(L.z), range: __fp.r(L.range), I: __fp.r(L.intensity) }, pool: __fp.poolOf(a.owner), inf: inf && { R0: inf.R0, hit: inf.hit && __fp.r(inf.hit), by: inf.by && inf.by.kind + ' ' + inf.by.key } };
      }, { k, owner });
      const on = await ev(page, a => __fp.measure(a.c.eye, a.c.at, a.p), { c: C.cam, p: C.pts });
      await canvasPng(page, 'L4-' + idx + '-on');
      // 亮斑：墙 / 货架朝车这一面、正对光源的那一点（FE1R：光源按判定区放低了，亮斑跟着在光源高度上）
      if (C.spot && st.L) C.spot = Object.assign({}, C.spot, { y: st.L.y });
      // 亮斑用照度计量（__sw.lux：小视角相机贴着那一点、法线朝车，FE1R：斜着从车外看会被车身挡住）
      const spotPt = C.spot ? Object.assign({}, C.spot, { n: C.rack ? [0, 0, -1] : [-1, 0, 0], d: 0.3 }) : null;
      const spotOn = C.spot ? await ev(page, q => __sw.lux([q])[0], spotPt) : null;
      const atOn = await ev(page, p => __fp.lightAt(p), C.pts);
      // 撤灯：推 2 帧让 world.update 把灯池刷一遍（改前的 world.js 要等下一帧的 pushLights），再只渲染不推模拟，等灯池淡出
      await ev(page, o => { window.__fpL = __fp.extra[o]; BR.world.setExtraLights(o, null); __fp.frames(2); BR.world.setExtraLights(o, null); return __fp.renderOnly(13); }, owner);
      const off = await ev(page, a => __fp.measure(a.c.eye, a.c.at, a.p), { c: C.cam, p: C.pts });
      await canvasPng(page, 'L4-' + idx + '-off');
      const spotOff = C.spot ? await ev(page, q => __sw.lux([q])[0], spotPt) : null;
      const atOff = await ev(page, p => __fp.lightAt(p), C.pts);
      await ev(page, o => { BR.world.setExtraLights(o, window.__fpL); __fp.frames(2); return __fp.renderOnly(13); }, owner);
      const diffs = on.map((v, i) => (v == null || off[i] == null ? null : F2(v - off[i])));
      const vis = diffs.filter(d => d != null).length;
      const maxD = Math.max(0, ...diffs.filter(d => d != null).map(Math.abs));
      const atD = Math.max(...atOn.map((v, i) => Math.abs(v - atOff[i])));
      check('L4.' + idx + ' ' + C.n + '：车摆得下（不压碰撞体）、光源 ' + (st.L ? st.L.range : '?') + ' m 光球在灯池里点着，' + (C.rack ? '货架另一侧' : '屋里') + vis + ' 个点开灯和关灯差 ≤2（最大 ' + maxD.toFixed(2) + '）',
        free.length === 0 && !!st.pool && vis >= Math.min(C.pts.length - 1, C.rack ? 2 : 3) && maxD <= 2, { free, tp, st, names: C.pts.map(p => p.n), on, off, diffs });
      check('L4.' + idx + ' ' + C.n + '：lightAt 对' + (C.rack ? '货架另一侧' : '屋里') + '的点和关灯时一样（差 ' + atD.toFixed(4) + '）', atD < 0.005, { atOn, atOff });
      if (C.spot) check('L4.' + idx + ' ' + C.n + '：' + (C.rack ? '货架' : '墙') + '朝车这一面有一块亮斑（' + (spotOff == null ? '?' : spotOff.toFixed(1)) + ' → ' + (spotOn == null ? '?' : spotOn.toFixed(1)) + '）',
        spotOn != null && spotOff != null && spotOn - spotOff >= 10, { spotOn, spotOff });
      // FE1R K2：光源不再一律贴在墙前 0.3 m（车前那段地面要亮），只要求在墙朝车这一侧、离墙 ≥0.2 m（不越过墙放进屋里）
      if (C.gap != null) check('L4.' + idx + ' ' + C.n + '：光源在墙朝车这一侧（离墙 ' + (st.L ? (20.8 - st.L.x).toFixed(2) : '?') + ' m ≥0.2，没越过墙）', !!st.L && 20.8 - st.L.x >= 0.2, st.L);
    }
    await ev(page, () => { const lv = BR.levels.get('1'); if (lv && lv.__swFrozen) { lv.update = lv.__swOrig; lv.__swFrozen = false; } return 0; });
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
        const w = q => {
          // q.ray：从 q.ray.o 沿 q.ray.d 打到的第一个网格面（往回 4 mm），正对着它 0.3 m 量（fe）
          if (q.ray) {
            const ms = []; BR.gfx.scene.traverseVisible(o => { if (o.isMesh) ms.push(o); });
            const o = new THREE.Vector3(q.ray.o[0], q.ray.o[1], q.ray.o[2]), d = new THREE.Vector3(q.ray.d[0], q.ray.d[1], q.ray.d[2]).normalize();
            const h = new THREE.Raycaster(o, d, 0, 3).intersectObjects(ms, false)[0];
            const pt = h ? h.point.clone().addScaledVector(d, -0.004) : o;
            return { x: pt.x, y: pt.y, z: pt.z, r: 2, fe: { x: pt.x - d.x * 0.3, y: pt.y - d.y * 0.3 + 0.01, z: pt.z - d.z * 0.3 } };
          }
          const p0 = q.x != null ? Object.assign({}, q) : Object.assign(__fp.W(a.k, q.lx, q.lz, q.ly), { r: q.r || 3 });
          // q.down：地面点从正上方 0.3 m 往下量（斜着从车上方看远处的地，会被柱子、货架挡住或者看到别的东西）
          if (q.down) p0.fe = { x: p0.x + 0.001, y: p0.y + 0.3, z: p0.z + 0.001 };
          return p0;
        };
        return { pts: a.pts.map(w), eye: w(a.cam.eye), at: w(a.cam.at) };
      }, { k, pts, cam });
      const st = await ev(page, a => {
        const L = __fp.extra[a.owner] && __fp.extra[a.owner][0], sim = BR.forklift.byKey(a.k), inf = sim.lightInfo, e = sim.eyeWorld();
        return { L: L && { x: __fp.r(L.x), y: __fp.r(L.y), z: __fp.r(L.z), range: __fp.r(L.range), I: __fp.r(L.intensity) }, by: inf && inf.by && (inf.by.kind + ' ' + inf.by.key), seat: { x: e.x, z: e.z }, pool: !!__fp.poolOf(a.owner), seated: BR.vehicles.seated };
      }, { k, owner });
      // 带 fe（正对着量的机位）的点单独正对着量：货架上朝通道的货隔着格子从车上方斜着看不一定看得到
      // 正对着量完以后按 eye / at 再画一帧：截图（canvasPng 拷的是最后画的那一帧）是这个机位，不是最后一个正对着量的特写（返修 FE1R · repair-r1）
      const meas = () => ev(page, a => { const r = __fp.measure(a.eye, a.at, a.pts); a.pts.forEach((p, i) => { if (p.fe) r[i] = __fp.measure(p.fe, p, [p])[0]; }); if (a.pts.some(p => p.fe)) __fp.measure(a.eye, a.at, []); return r; }, W);
      // 截图那一帧（eye / at 机位）的左右两片区域平均亮度、发白的像素（返修 FE1R · repair-r5，主会话 L3 的口径：驾驶座画面里两边货架的货）
      const frame = () => ev(page, () => {
        const c = __fp._c2; if (!c || !c.width) return null;
        const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, y0 = Math.floor(0.28 * H), y1 = Math.floor(0.72 * H), xl = Math.floor(0.25 * W), xr = Math.floor(0.75 * W);
        let sL = 0, nL = 0, sR = 0, nR = 0; const white = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (Math.max(d[i], d[i + 1], d[i + 2]) >= 245) white.push(y * W + x);
          if (y < y0 || y >= y1) continue;
          const Y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (x < xl) { sL += Y; nL++; } else if (x >= xr) { sR += Y; nR++; }
        }
        return { L: sL / nL, R: sR / nR, white, W, H };
      });
      const on = await meas();
      const frOn = tag ? await frame() : null;
      if (tag) await canvasPng(page, tag + '-on');
      const atOn = await ev(page, a => __fp.lightAt(a.pts.concat([a.seat])), { pts: W.pts, seat: st.seat });
      await ev(page, o => { window.__fpL = __fp.extra[o]; BR.world.setExtraLights(o, null); return __fp.renderOnly(13); }, owner);
      const off = await meas();
      const frOff = tag ? await frame() : null;
      if (tag) await canvasPng(page, tag + '-off');
      const atOff = await ev(page, a => __fp.lightAt(a.pts.concat([a.seat])), { pts: W.pts, seat: st.seat });
      await ev(page, o => { BR.world.setExtraLights(o, window.__fpL); return __fp.renderOnly(13); }, owner);
      const rows = W.pts.map((p, i) => ({ n: pts[i].n, p: [F2(p.x), F2(p.y), F2(p.z)], h: st.L ? F2(Math.hypot(p.x - st.L.x, p.z - st.L.z)) : null,
        d: on[i] != null && off[i] != null ? F2(on[i] - off[i]) : null, at: Math.round((atOn[i] - atOff[i]) * 10000) / 10000 }));
      let reg = null;
      if (frOn && frOff) { const wOff = new Set(frOff.white); reg = { L: F2(frOn.L - frOff.L), R: F2(frOn.R - frOff.R), newWhite: frOn.white.filter(i => !wOff.has(i)).length, whiteOn: frOn.white.length, whiteOff: frOff.white.length, W: frOn.W, H: frOn.H }; }
      return { st, rows, reg, seat: Math.round((atOn[pts.length] - atOff[pts.length]) * 10000) / 10000, seatOn: atOn[pts.length] };
    };
    const litOk = r => r.d != null && r.d >= 8 && r.at >= 0.01;      // 画面亮了 ≥8 → lightAt 也亮
    const darkOk = r => r.d != null && r.d <= 2 && r.at < 0.005;     // 画面差 ≤2（墙后、货架另一侧、远处）→ lightAt 不亮
    const far2 = rows => rows.map(r => r.d == null ? '?' : r.d).join(' / ');
    const seatVals = [];
    if (!await stillDark(page)) check('L8 J8 / J9 几项：还在断电里', false);
    else {
      // 窄道（左边一排柱子、右边货架 z 6.84–9.16，车中心离货架 1.25 m，车头朝 +x）：原来光球只有 2.5 m（返修 r2 验收员拍的那张）
      const lane = { x: 3.45, z: 5.59, yaw: -Math.PI / 2 };
      const ln = await onOff(lane, [
        { n: '叉尖前 1 m 地面', lx: 0, ly: 0.005, lz: -3.1, down: true }, { n: '叉尖前 3 m 地面', lx: 0, ly: 0.005, lz: -5.1, down: true }, { n: '叉尖前 5 m 地面', lx: 0, ly: 0.005, lz: -7.1, down: true },
        { n: '右边货架朝通道的货 高 1.2（从通道里往货架打到的第一个面）', ray: { o: [7.5, 1.2, 6.2], d: [0, 0, 1] } },
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
      // 宽通道（两排货架 x −17.16…−14.84 / −9.16…−6.84，通道宽 5.68 m，车头朝 −z）。返修 FE1R · repair-r1（验收员 play / tests / spec：J9 不许自己改成「只记录」）：
      //   L9  FE1Q 原来那个位姿（通道正中 (−12, 57.5)）和贴着柱子那条道 (−13.4, 57.5)：叉尖前 3 m 地面一定亮；叉尖前 5 m 那两点要么亮 ≥8，
      //       要么是 K2 的几何例外 —— 通道正中 (−12, 52) 那根 0.7 m 的柱子在叉尖前 3 m（K1：光源不越过正前方的窄东西），光源只能放在货架头那个端面
      //       （z 52.2）的这一侧，货架头背后拐角那片影子把光球收到 3 m 左右：用同一套界限（不越过柱子、货架、墙）细网格暴力搜一遍，没有一个光源位置
      //       能照亮那一点（照度 ≥0.15，和 k2 组「照得全」同一个阈值）才算例外（截图 L9-aisle*-on.png，逐个写进方案 risks）；照得到却没照亮算失败。
      //       朝通道的货在这两处只记录（亮 / 暴力搜照不到 / 照得到却没照亮）：贴着柱子那条道实测 6.39 级、暴力搜照得到 0.357 —— 求解器只给车前判定区和
      //       叉尖前 5 m 打分、不管两边货架的货，是已知差距（方案 risks[30]），改求解器会动 k2 / smooth 全部位姿，这一轮没做
      //   L9c 同一条宽通道里前面 5 m 以内没有柱子、货架头的位姿 (−10.9, 61.1)：货架一节 7 m（z 52.6–59.6，两节之间 1 m 空当里一根柱子），
      //       叉尖 z 59.0、叉尖前 5 m 还在这一节里、柱子在 6.65 m 外而且偏在左边 1.1 m；叉尖前 3 m、5 m 两点、近的那排（右边）朝通道的货都 ≥8（J9 原文；
      //       左边那排离光源 4 m、在光球外，量它没意义）
      // 点可以带 y 和面法线 n（朝通道的货是竖直面）：照度 = I·k²·max(0, n·(光源 − 点))/d²·d，地面点 n = (0, 1, 0)、y = 0 时就是以前的 I·k²·h/d
      const brute5 = (pts) => ev(page, a => {
        const sim = BR.forklift.byKey(a.k), Lh = BR.forklift._light;
        if (!Lh) return { best: a.pts.map(() => null), bestCap: a.pts.map(() => null), ok: null, gN: null };   // 跑 FE1Q 的 forklift.js 量基准时没有 _light
        const ctx = Lh.ctx(sim);
        const near = ctx.zone.filter(q => q.t <= 1.5 + 1e-6), out = a.pts.map(() => 0), outCap = a.pts.map(() => 0);
        let ok = null;
        for (let s = -0.5; s <= 3.2 + 1e-6; s += 0.1) for (let u = -0.55; u <= 0.55 + 1e-6; u += 0.1) for (let h = 0.45; h <= 1.2 + 1e-6; h += 0.075) {
          if (s > Lh.sMaxU(ctx, u) + 1e-6) continue;
          const c = Lh.eval(ctx, s, u, h, false); if (!c) continue;
          const E = q => {
            const y = q.y || 0, n = q.n || [0, 1, 0], dx = c.x - q.x, dy = h - y, dz = c.z - q.z, d = Math.hypot(dx, dy, dz);
            const k = d < c.R ? 1 - d / c.R : 0, cs = Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / d);
            return c.I * k * k * cs;
          };
          if (!near.every(q => E(q) >= 0.15)) continue;
          a.pts.forEach((q, i) => { out[i] = Math.max(out[i], E(q)); outCap[i] = Math.max(outCap[i], E(q) * c.Icap / Math.max(1e-6, c.I)); });
          if (a.pts.every(q => E(q) >= 0.15)) ok = { s: +s.toFixed(2), u: +u.toFixed(2), h: +h.toFixed(3), R: +c.R.toFixed(2) };
        }
        return { best: out.map(v => +v.toFixed(3)), bestCap: outCap.map(v => +v.toFixed(3)), ok, gN: Number.isFinite(ctx.gN) ? +ctx.gN.toFixed(2) : null };
      }, { k, pts });
      // goods：量哪一边货架朝通道的货 —— 通道正中、贴柱子那条道量左边（离光源 2.8 m 上下）；L9c 车靠右边那排（离右边货架 1.7 m、离左边 4 m），量近的右边那排
      const aisleCheck = async (aisle, tag, label, eyeLx, goods = 'L') => {
        const gRow = goods === 'L' ? { n: '左边货架朝通道的货 高 1.2（从通道里往货架打到的第一个面）', ray: { o: [-14.2, 1.2, aisle.z - 4.5], d: [-1, 0, 0] } }
          : { n: '右边货架朝通道的货 高 1.2（从通道里往货架打到的第一个面）', ray: { o: [-9.8, 1.2, aisle.z - 4.5], d: [1, 0, 0] } };
        const ai = await onOff(aisle, [
          { n: '叉尖前 3 m 地面', lx: 0, ly: 0.005, lz: -5.1, down: true }, { n: '叉尖前 5 m 地面', lx: 0, ly: 0.005, lz: -7.1, down: true }, { n: '叉尖前 5 m 地面 偏左 0.6 m', lx: -0.6, ly: 0.005, lz: -7.1, down: true },
          gRow,
        ], { eye: eyeLx != null ? { lx: eyeLx, ly: 2.7, lz: -2.0 } : { lx: 0, ly: 1.8, lz: 0.16 }, at: { lx: 0, ly: 0, lz: -7.1 } }, tag);   // 截图：驾驶座往前看（量的点都从正上方量，和机位无关）
        const pts5 = await ev(page, a => [__fp.W(a.k, 0, -7.1, 0), __fp.W(a.k, -0.6, -7.1, 0)].map(q => ({ x: q.x, z: q.z })), { k });
        // 朝通道的货那一点（射线打到的面往回 4 mm）也进暴力搜：竖直面，法线朝通道（射线反方向）
        const gp = ai.rows[3].p, gd = gRow.ray.d;
        pts5.push({ x: gp[0], y: gp[1], z: gp[2], n: [-gd[0], -gd[1], -gd[2]] });
        const bf = await brute5(pts5);
        // 几何例外（叉尖前 5 m 那两点，J9 / 验收员点名的那一条）：没亮（<8）的每一点，同一套界限下哪个光源位置都照不到它（照度 <0.15）；照得到却没照亮判失败。
        // 朝通道的货单独记：亮 ≥8 / 暴力搜照不到 / 照得到却没照亮（已知差距：求解器只给车前判定区和叉尖前 5 m 打分，不管两边货架的货 —— 写进方案 risks[30]）
        const far = [ai.rows[1], ai.rows[2]], farLit = far.every(litOk);
        const exc = !farLit && far.every((r, i) => litOk(r) || bf.best[i] < 0.15);
        const gSt = litOk(ai.rows[3]) ? 'lit' : bf.best[2] < 0.15 ? 'geo' : 'dim';
        // 返修 FE1R · repair-r4（主会话 L3：两边货架的货要回到 FE1Q 的 ≥80%）：这一点开关灯差和 FE1Q 比。FE1Q 的数是拿 FE1Q 的 forklift.js / world.js /
        // vehicles_net.js（git HEAD）在同一个测试、同一套量法下量的（tests/output/stage-FE1R/repair-r4/logs/polish-light-fe1q2.log）：通道正中 48.3、
        // 贴着柱子那条道 86.11、L9c 78.06。K2 的硬指标优先（裁定：真冲突时 K2 赢）：光源强度已经顶在 K2 的封顶上（离光源最近的面不发白 eSurf、
        // 光源脚下的地面 eFloor、开得快时的 ImaxMove，I ≥ 98% 封顶）还不到 80% 的，算冲突、照记，但不许低于 FE1Q 的 45%（repair-r3 时是 3 成左右）
        const cap = await ev(page, a => { const sim = BR.forklift.byKey(a.k), L = sim.lightInfo, Lh = BR.forklift._light; if (!Lh || !L) return null; const q = Lh.eval(Lh.ctx(sim), L.s, L.u, L.h, true); return { I: +L.intensity.toFixed(3), Icap: +q.Icap.toFixed(3), dsurf: +q.dsurf.toFixed(3), R: +L.range.toFixed(3), gS: q.gS }; }, { k });
        const ref = FE1Q_GOODS[tag], gv = ai.rows[3].d, gk = ref && gv != null ? +(gv / ref).toFixed(3) : null;
        // 主会话 L3（返修 FE1R · repair-r5）：驾驶座画面左右两片区域和 FE1Q、加 L3 之前比（sides = 判哪几侧）；整幅画面开灯后新冒出来的 ≥245 像素为 0（不发白）
        const sides = goods === 'R' ? ['R'] : ['L', 'R'], q = FE1Q_REG[tag], p0 = PRE_L3_REG[tag], rg = ai.reg, pre = PRE_L3_GOODS[tag];
        const regOk = !q || (rg && sides.every(s0 => rg[s0] >= 0.8 * q[s0] && rg[s0] > p0[s0]));
        // 测试那一点没比加 L3 之前亮的，要证明是真冲突（验收员 tests (2)）：同一套界限、同一个不发白的上限（按表面颜色，forklift.js surfCap）下，
        // 暴力搜光源位置（叉尖前 −0.5–3.2 m × 横偏 ±0.55 × 离地 0.45–1.2，车前 1.5 m 以内照得全的才算）能给那一点的最大照度 bf.best[2]，
        // 现在这盏灯给的照度 ≥ 它的 90%（求解器没把照得到的让掉）才算冲突；照得到却没照亮判失败
        const Lnow = ai.st.L, gp2 = ai.rows[3].p, nrm = [-gRow.ray.d[0], -gRow.ray.d[1], -gRow.ray.d[2]];
        let eNow = null;
        if (Lnow && gp2) { const dx = Lnow.x - gp2[0], dy = Lnow.y - gp2[1], dz = Lnow.z - gp2[2], d = Math.hypot(dx, dy, dz), kk = d < Lnow.range ? 1 - d / Lnow.range : 0; eNow = +(Lnow.I * kk * kk * Math.max(0, (nrm[0] * dx + nrm[1] * dy + nrm[2] * dz) / d)).toFixed(3); }
        // bestCap：每个候选把强度开到它的不发白上限（c.Icap）时给那一点的照度 —— 按「最亮能多亮」比，不按求解器自己挑的强度
        const bBest = bf.bestCap && bf.bestCap[2] != null ? bf.bestCap[2] : null, conflict = gv != null && pre != null && !(gv > pre) && eNow != null && bBest != null && eNow >= 0.9 * bBest;
        // 通道正中（L3 点名的那个位姿）：测试那一点也要比加 L3 之前亮；贴柱子那条道、L9c（repair-r4 自己加的两处，驾驶座画面两边看到的是车旁边、FE1Q 也照不到的货）：
        // 测试那一点不比加 L3 之前暗 20% 以上（repair-r5 实测：贴柱子那条道是加 L3 之前的 85%，L9c 125%；暴力搜照度上界只记录，见 conflict）
        const ptMin = q ? pre : 0.8 * pre, ptOk = gv != null && pre != null && (q ? gv > pre : gv >= ptMin);
        const regVs = { reg: rg, fe1q: q || null, preL3: p0 || null, k: q && rg ? Object.fromEntries(sides.map(s0 => [s0, +(rg[s0] / q[s0]).toFixed(3)])) : null,
          pre, ptMin: pre != null ? +ptMin.toFixed(2) : null, eNow, bBest, conflict, ptOk, ok: !!rg && regOk && rg.newWhite === 0 && ptOk };
        const goodsVs = { ref, d: gv, k: gk, cap };
        return { ai, bf, far, farLit, exc, goods: gSt, label, goodsVs, regVs, sides };
      };
      const L9s = [];
      const goodsTxt = r => { const v = r.regVs, g = v.reg; if (!g) return '驾驶座画面没量到';
        return (v.fe1q ? '驾驶座画面' + r.sides.map(s0 => (s0 === 'L' ? '左' : '右') + '边货 ' + g[s0] + '（FE1Q ' + v.fe1q[s0] + '，' + Math.round(v.k[s0] * 100) + '%；加 L3 之前 ' + v.preL3[s0] + '）').join('、') + '，' : '') +
          '测试那一点 ' + r.goodsVs.d + '（FE1Q ' + r.goodsVs.ref + '，' + (r.goodsVs.k == null ? '?' : Math.round(r.goodsVs.k * 100) + '%') + '；加 L3 之前 ' + v.pre +
          (gv0(r) <= v.pre ? '；没比加 L3 之前亮：要求 ≥' + v.ptMin + '；同一套界限和不发白的上限下暴力搜那一点最多照度 ' + v.bBest + '，现在 ' + v.eNow : '') + '），开灯后整幅画面新发白的像素 ' + g.newWhite; };
      const gv0 = r => r.goodsVs.d == null ? -1 : r.goodsVs.d;
      for (const [aisle, tag, label] of [[{ x: -12, z: 57.5, yaw: 0 }, 'L9-aisle', '通道正中 (−12, 57.5)'], [{ x: -13.4, z: 57.5, yaw: 0 }, 'L9-aisle134', '贴着柱子那条道 (−13.4, 57.5)']]) {
        const r = await aisleCheck(aisle, tag, label);
        L9s.push(r);
        if (label.startsWith('通道正中')) seatVals.push(['宽通道', r.ai.seat, r.ai.seatOn]);
        // 返修 FE1R · repair-r2（验收员 spec / play / tests：J9 不许拿 K2 的几何例外顶 —— 货架头端面背后那片影子不再收光球，见 forklift.js occBound）：
        // J9 原文判：叉尖前 3 m、5 m 两点开灯比关灯亮 ≥8、lightAt 算亮；朝通道的货（左边那排）要么亮 ≥8，要么同一套界限暴力搜也照不到（<0.15）
        check('L9 J9 宽货架通道（5.68 m）' + label + '：光球 ' + (r.ai.st.L ? r.ai.st.L.range : '?') + ' m（' + r.ai.st.by + '），叉尖前 3 m 地面、叉尖前 5 m 那两点（' + far2(r.far) + '）开灯比关灯亮都 ≥8、lightAt 算亮（J9 原文）；' +
          '朝通道的货亮 ' + (r.ai.rows[3].d == null ? '?' : r.ai.rows[3].d) + (r.goods === 'lit' ? '（≥8）' : r.goods === 'geo' ? '，暴力搜最高 ' + r.bf.best[2] + '（<0.15，一盏受界的灯照不到）' : '，暴力搜最高 ' + r.bf.best[2] + '：照得到却没照亮') +
          '；' + goodsTxt(r) + '（L3：通道正中驾驶座画面两边的货都 ≥ FE1Q 的 80%、测试那一点比加 L3 之前亮；贴柱子那条道测试那一点 ≥ 加 L3 之前的 80%；不发白）',
          litOk(r.ai.rows[0]) && r.farLit && r.goods !== 'dim' && r.regVs.ok, r);
      }
      {
        const r = await aisleCheck({ x: -10.9, z: 61.1, yaw: 0 }, 'L9c-aisle', '前面 5 m 以内没有柱子、货架头 (−10.9, 61.1)', null, 'R');
        L9s.push(r);
        check('L9c J9 宽货架通道（5.68 m）前面 5 m 以内没有柱子、货架头 (−10.9, 61.1)：光球 ' + (r.ai.st.L ? r.ai.st.L.range : '?') + ' m，叉尖前 3 m、5 m 两点（' + far2(r.far.slice(0, 2)) + '）、近的那排（右边，离车 1.7 m）朝通道的货（' + (r.ai.rows[3].d == null ? '?' : r.ai.rows[3].d) + '）开灯比关灯亮都 ≥8、lightAt 都算亮（J9 原文）；' +
          goodsTxt(r) + '（L3：测试那一点 ≥ 加 L3 之前的 80%；不发白）',
          r.ai.rows.every(litOk) && r.regVs.ok, r);
      }
      const ai = L9s[0].ai, aisle = { x: -12, z: 57.5, yaw: 0 };
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
        !!rem.L && !!rem.P && Array.isArray(rem.lk) && rem.lk.length === 0 && rem.L.x < 20.8 - 0.2 && atD < 0.005 && rem.seat != null && rem.seat - rem.seat0 >= 0.3, rem);
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
    // 护顶架的顶面（纵梁、前后横梁 y 2.10，格栅横条 y 2.085）：FE1R K12 起模型里不画（朝上、离地 ≥1.8 m，谁的眼睛都不比它高），
    // 从下面、旁边看过去它就是那根实心梁的上沿 —— 按它该在的位置补上再量（和门架零件「没画的面按它该在的位置补上」一个道理）
    const cap = (x0, x1, y, z0, z1) => { T.push([[x0, y, z0], [x1, y, z0], [x1, y, z1]]); T.push([[x0, y, z0], [x1, y, z1], [x0, y, z1]]); };
    for (const sx of [-1, 1]) cap(sx > 0 ? 0.40 : -0.46, sx > 0 ? 0.46 : -0.40, 2.10, -0.62, 0.58);
    cap(-0.40, 0.40, 2.10, -0.62, -0.56); cap(-0.40, 0.40, 2.10, 0.48, 0.58);
    const L = BR.L1forklift.lod && BR.L1forklift.lod[tier], zs = L && BR.L1forklift.slatZ ? BR.L1forklift.slatZ(L.slats | 0) : [];
    for (const z of zs) cap(-0.40, 0.40, 2.085, z - 0.025, z + 0.025);
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
const RUN = { light: gLight, k2: gK2, k1: gK1, smooth: gSmooth, ws: gWs, lift: gLift, drive: gDrive, vine: gVine, coop: () => gCoop() };

// =====================================================================
// 页面里的工具（FE1R-light）：window.__sw（摆车、量灯、渲染照度计、地面图、随机位姿生成，排查 sweep-light 那一套）、window.__lt（K2 判定区等）
// =====================================================================
function installSw() {
  const S = window.__sw = {};
  const T = THREE;
  S.rngOf = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  S.r = (v, k) => Math.round(v * (k || 1000)) / (k || 1000);
  S.init = k => { S.k = k; S.owner = 'fk:' + k; S.pk = __fp.physKey(k); S.ign = [S.pk, 'veh|' + k, k]; return S.pk; };
  S.sim = () => BR.forklift.byKey(S.k);
  S.L = () => __fp.extra[S.owner] && __fp.extra[S.owner][0];
  S.pool = () => { const L = S.L(); if (!L) return null; return BR.gfx.scene.children.find(o => o.isPointLight && /^gfx-pool-/.test(o.name) && o.intensity > 0 && Math.abs(o.position.x - L.x) < 0.02 && Math.abs(o.position.z - L.z) < 0.02 && Math.abs(o.position.y - L.y) < 0.02) || null; };
  // 车本地 → 世界（和 __fp.W 一样：本地 −z 是车头）
  S.W = (p, lx, ly, lz) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, y: (p.y || 0) + ly, z: p.z - s * lx + c * lz }; };
  S.Lc = (p, x, z) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return { x: c * dx - s * dz, z: s * dx + c * dz }; };
  S.yawOf = u => Math.atan2(-u.x, -u.z);
  // ---- 冻住 L1 的断电计时（关卡 update 的 dt 改 0：断电一直不结束；dimLights 照旧每帧把新载入的块灯灭掉）----
  S.freeze = () => {
    const lv = BR.levels.get('1');
    if (!lv || lv.__swFrozen) return !!lv;
    const o = lv.update; lv.__swOrig = o; lv.update = function (ctx, dt) { return o.call(this, ctx, 0); }; lv.__swFrozen = true;
    return true;
  };
  S.dark = () => { let n = 0, off = 0; for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l._l1orig !== undefined && l.intensity === 0) off++; } return { n, off }; };
  // ---- 摆车（坐着：模拟是真身）----
  S.place = (x, z, yaw) => {
    const sim = S.sim();
    sim.setPose({ x, z, yaw, steer: 0, lift: 0, spd: 0, lever: 0 });
    __br.step(2 / 30);
    let q = 0;
    for (let i = 0; i < 90; i++) { const d = BR.world.debugInfo(); q = d.queued; if (!q) break; __br.step(1 / 30); }
    __br.step(2 / 30);
    BR.gfx.setSanityEffect && BR.gfx.setSanityEffect(0, true);
    for (let i = 0; i < 3; i++) BR.gfx.render(0.1);   // __br.step 只在最后一小步渲染：灯池的淡入淡出要靠真渲染推进
    return { q, pose: Object.assign({}, BR.vehicles.byKey(S.k).pose) };
  };
  S.hits = (x, z, yaw) => __fp.hitsAt(x, z, yaw, 0, S.pk);
  // ---- 静态碰撞体 ----
  S.solids = () => {
    const out = [];
    for (const c of BR.world.chunks()) {
      const rec = BR.phys.records(c.key);
      for (const s of rec.solids) {
        if (s.key !== c.key) continue;
        const w = s.maxX - s.minX, d = s.maxZ - s.minZ, h = s.maxY - s.minY;
        out.push({ ck: c.key, sector: c.res && c.res.data && c.res.data.sector, minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY, minZ: s.minZ, maxZ: s.maxZ, w, d, h, cls: S.cls(w, d, h, s.minY) });
      }
    }
    return out;
  };
  S.cls = (w, d, h, y0) => {
    const a = Math.max(w, d), b = Math.min(w, d), top = (y0 || 0) + h;
    if (top < 1.6 || (y0 || 0) > 1.6) return 'low';
    if (a > 6.5 && b > 2) return 'rack';
    if (a >= 1.9 && b >= 0.75 && b <= 0.85 && h <= 2.1) return 'toteShelf';
    if (b < 0.25 && a >= 2.5 && h >= 2.8 && h <= 3.0) return 'hutWall';
    if (b > 0.25 && b < 0.35 && a >= 2.5 && h >= 3.4) return 'bearingWall';
    if (Math.abs(b - 0.32) < 0.02 && Math.abs(a - 0.8) < 0.02) return 'cabinet';
    if (a < 0.5 && b < 0.5 && h > 1.5 && h < 2.0 && Math.abs(w - d) < 0.05) return 'tree';
    if (a < 0.25) return 'post';
    if (Math.abs(w - d) < 0.05 && a > 0.6 && a < 1.0 && h >= 3.9) return 'pillar';
    if (Math.abs(w - d) < 0.1 && a > 1.3 && a < 1.6) return 'stack';
    if (a >= 0.4 && a >= 2 * b) return 'wallish';
    return 'other';
  };
  // ---- 灯 ----
  S.lightNow = () => {
    const L = S.L(), sim = S.sim(), inf = sim && sim.lightInfo, P = S.pool();
    return { L: L && { x: S.r(L.x), y: S.r(L.y), z: S.r(L.z), range: S.r(L.range), I: S.r(L.intensity) },
      inf: inf && { range: S.r(inf.range), R0: S.r(inf.R0), bound: S.r(inf.bound), hit: inf.hit == null ? null : S.r(inf.hit), by: inf.by && { kind: inf.by.kind, key: inf.by.key, box: inf.by.box } },
      pool: P && { I: S.r(P.intensity), d: S.r(P.distance), x: S.r(P.position.x), z: S.r(P.position.z) } };
  };
  S._st = null;
  S.capture = () => { const L = S.L(), P = S.pool(); S._st = L && P ? { L, P, I: L.intensity, PI: P.intensity } : null; return !!S._st; };
  S.setOn = on => { const st = S._st; if (!st) return false; if (on) { st.L.intensity = st.I; st.P.intensity = st.PI; } else { st.L.intensity = 0; st.P.intensity = 0; } return true; };
  // ---- 渲染 ----
  const R = () => BR.gfx.renderer;
  const probe = new T.PerspectiveCamera(5, 1, 0.003, 30);
  S.TILE = 6;
  // 「照度计」：每个点 p（世界）、面法线 n：相机放在 p + n·d 看 p（视野 5°，雾几乎为 0），画进画布上一个 6×6 的小格；一次读回
  S.lux = (pts) => {
    const r = R(), cv = r.domElement, W = cv.width, H = cv.height, pr = r.getPixelRatio(), ts = S.TILE, per = Math.floor(W / ts);
    const scene = BR.gfx.scene;
    r.setScissorTest(true);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], tx = (i % per) * ts, ty = Math.floor(i / per) * ts;
      const d = p.d || 0.3, n = p.n || [0, 1, 0];
      probe.position.set(p.x + n[0] * d, p.y + n[1] * d, p.z + n[2] * d);
      if (Math.abs(n[1]) > 0.9) probe.up.set(0, 0, -1); else probe.up.set(0, 1, 0);
      probe.far = d + 0.4; probe.updateProjectionMatrix();
      probe.lookAt(p.x, p.y, p.z); probe.updateMatrixWorld(true);
      r.setViewport(tx / pr, ty / pr, ts / pr, ts / pr); r.setScissor(tx / pr, ty / pr, ts / pr, ts / pr);
      r.render(scene, probe);
    }
    const c2 = S._c2 || (S._c2 = document.createElement('canvas')); c2.width = W; c2.height = H;
    const g = c2.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0);
    const rows = Math.ceil(pts.length / per);
    const img = pts.length ? g.getImageData(0, H - rows * ts, Math.min(W, per * ts), rows * ts) : null;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const tx = (i % per) * ts, ty = Math.floor(i / per) * ts, y0 = rows * ts - ty - ts;
      let s = 0, m = 0;
      for (let yy = 1; yy < ts - 1; yy++) for (let xx = 1; xx < ts - 1; xx++) { const j = ((y0 + yy) * img.width + tx + xx) * 4; s += 0.2126 * img.data[j] + 0.7152 * img.data[j + 1] + 0.0722 * img.data[j + 2]; m++; }
      out.push(S.r(s / m, 100));
    }
    r.setScissorTest(false); r.setViewport(0, 0, W / pr, H / pr); r.setScissor(0, 0, W / pr, H / pr);
    return out;
  };
  // 地面图：正交相机贴地（离地 0.3 m）往下看，一次画出光源周围 2·half 见方的地面（每像素 2·half/N），开 / 关各一张
  const ocam = new T.OrthographicCamera(-1, 1, 1, -1, 0.005, 0.5);
  S.floorMap = (cx, cz, gy, half) => {
    const r = R(), cv = r.domElement, W = cv.width, H = cv.height, pr = r.getPixelRatio(), N = Math.min(W, H);
    ocam.left = -half; ocam.right = half; ocam.top = half; ocam.bottom = -half; ocam.near = 0.005; ocam.far = 0.5; ocam.updateProjectionMatrix();
    ocam.position.set(cx, gy + 0.3, cz); ocam.up.set(0, 0, -1); ocam.lookAt(cx, gy, cz); ocam.updateMatrixWorld(true);
    r.setScissorTest(true); r.setViewport(0, 0, N / pr, N / pr); r.setScissor(0, 0, N / pr, N / pr);
    r.render(BR.gfx.scene, ocam);
    const c2 = S._c2 || (S._c2 = document.createElement('canvas')); c2.width = W; c2.height = H;
    const g = c2.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0);
    const img = g.getImageData(0, H - N, N, N).data;
    const lum = new Float32Array(N * N);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.2126 * img[j] + 0.7152 * img[j + 1] + 0.0722 * img[j + 2];
    r.setScissorTest(false); r.setViewport(0, 0, W / pr, H / pr); r.setScissor(0, 0, W / pr, H / pr);
    return { cx, cz, half, N, lum };
  };
  // 地面图上 (x, z) 周围 rad 像素的平均亮度
  S.fm = (m, x, z, rad) => {
    const u = (x - (m.cx - m.half)) / (2 * m.half) * m.N, v = (z - (m.cz - m.half)) / (2 * m.half) * m.N, R2 = rad == null ? 1 : rad;
    const i0 = Math.round(u), j0 = Math.round(v);
    if (i0 - R2 < 0 || j0 - R2 < 0 || i0 + R2 >= m.N || j0 + R2 >= m.N) return null;
    let s = 0, n = 0;
    for (let j = j0 - R2; j <= j0 + R2; j++) for (let i = i0 - R2; i <= i0 + R2; i++) { s += m.lum[j * m.N + i]; n++; }
    return s / n;
  };
  const vcam = new T.PerspectiveCamera(75, 16 / 9, 0.05, 60);
  S.vcam = vcam;
  S.aim = (eye, at) => {
    const r = R(), cv = r.domElement, gc = BR.gfx.camera;
    vcam.fov = gc.fov; vcam.aspect = cv.width / cv.height; vcam.near = gc.near; vcam.far = Math.max(30, gc.far); vcam.updateProjectionMatrix();
    vcam.position.set(eye.x, eye.y, eye.z); vcam.up.set(0, 1, 0); vcam.lookAt(at.x, at.y, at.z); vcam.updateMatrixWorld(true);
    vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
  };
  // 画一张机位图，返回 2D 画布（拷贝）
  S.view = () => {
    const r = R(), cv = r.domElement, W = cv.width, H = cv.height, pr = r.getPixelRatio();
    r.setScissorTest(false); r.setViewport(0, 0, W / pr, H / pr);
    r.render(BR.gfx.scene, vcam);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0);
    return c;
  };
  S.lumAt = (c, sx, sy, rad) => {
    const g = c.getContext('2d', { willReadFrequently: true }), R2 = rad || 2;
    const x0 = Math.max(0, Math.round(sx) - R2), y0 = Math.max(0, Math.round(sy) - R2), x1 = Math.min(c.width - 1, Math.round(sx) + R2), y1 = Math.min(c.height - 1, Math.round(sy) + R2);
    if (x1 < x0 || y1 < y0) return null;
    const d = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return S.r(s / n, 100);
  };
  S.meanLum = (c, x0, y0, x1, y1) => {
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return S.r(s / n, 100);
  };
  // 投影到当前机位屏幕；看不见（被网格挡住）返回 null
  const ray = new T.Ray(), rc = new T.Raycaster(), tmpB = new T.Box3(), tmpV = new T.Vector3(), hits = [];
  S.markStatic = () => { let n = 0; BR.gfx.scene.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.__swStatic) { let q = o, veh = false; while (q) { if (/veh|fork|vehicle|items|entit|player|coop/i.test(q.name || '')) veh = true; q = q.parent; } if (!veh) { o.geometry.__swStatic = true; n++; } } }); return n; };
  S.occl = () => {
    const list = [];
    BR.gfx.scene.traverseVisible(o => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.every(q => !q || q.visible === false || q.colorWrite === false || (q.transparent && q.opacity < 0.9) || q.depthWrite === false)) return;
      if (!o.geometry) return;
      // 载具网格每帧改顶点：包围盒 / 包围球每个位姿重算（区块网格不变，算一次）
      if (!o.geometry.boundingBox || !o.geometry.__swStatic) { o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere(); }
      list.push(o);
    });
    S._occ = list;
    return list.length;
  };
  S.seen = (p) => {
    const e = vcam.position;
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dist > 0.05)) return false;
    ray.origin.copy(e); ray.direction.set(dx / dist, dy / dist, dz / dist);
    rc.set(e, ray.direction); rc.near = 0; rc.far = dist - 0.03;
    for (const o of S._occ || []) {
      if (o.isInstancedMesh) { hits.length = 0; o.raycast(rc, hits); if (hits.length) return false; continue; }
      tmpB.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (!ray.intersectBox(tmpB, tmpV) && !tmpB.containsPoint(e)) continue;
      if (!tmpB.containsPoint(e) && tmpV.distanceTo(e) > dist - 0.03) continue;
      hits.length = 0; o.raycast(rc, hits);
      if (hits.length) return false;
    }
    return true;
  };
  S.proj = (c, pts) => {
    const W = c.width, H = c.height;
    return pts.map(p => {
      const v = new T.Vector3(p.x, p.y, p.z).project(vcam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return null;
      return { sx: (v.x + 1) / 2 * W, sy: (1 - v.y) / 2 * H };
    });
  };
  // ---- 视线（碰撞体）----
  S.losBlock = (p, L) => {
    const dx = L.x - p.x, dy = L.y - p.y, dz = L.z - p.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let h = null;
    try { h = BR.phys.raycast(p.x, p.y, p.z, dx, dy, dz, d, { ignoreKey: S.ign }); } catch (e) { h = null; }
    if (h && h.dist < d - 0.002) return h;
    return null;
  };
  S.inSolid = (x, y, z, r) => {
    const out = [];
    try { BR.phys.overlapBox(x - (r || 0.01), z - (r || 0.01), x + (r || 0.01), z + (r || 0.01), y - 0.005, 0.01, { out, ignoreKey: S.ign, tol: 1e-6 }); } catch (e) { return false; }
    return out.length > 0;
  };
  S.boxOf = (h) => {
    // 打到的碰撞体：静态 AABB 去 records 里找
    if (!h) return null;
    if (h.obb) return { obb: true, key: h.key, name: h.name };
    let s = null;
    try { for (const q of BR.phys.records(h.key).solids) { if (h.x >= q.minX - 0.002 && h.x <= q.maxX + 0.002 && h.y >= q.minY - 0.002 && h.y <= q.maxY + 0.002 && h.z >= q.minZ - 0.002 && h.z <= q.maxZ + 0.002) { s = q; break; } } } catch (e) { s = null; }
    if (!s) return { key: h.key };
    if (s.obb) return { obb: true, key: s.key, name: s.name, hx: s.hx, hz: s.hz };
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ, hh = s.maxY - s.minY;
    return { key: s.key, minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, minY: s.minY, maxY: s.maxY, w: S.r(w), d: S.r(d), h: S.r(hh), cls: S.cls(w, d, hh, s.minY) };
  };

  // ---- 一个位姿的全套测量 ----
  // ---- 随机位姿（种子固定的 PRNG）----
  S.gen = (seedNum, per) => {
    const rnd = S.rngOf(seedNum), U2 = (a, b) => a + (b - a) * rnd(), pickA = arr => arr[Math.floor(rnd() * arr.length)];
    const sol = S.solids();
    const out = [], cnt = {};
    const rot = (u, a) => ({ x: u.x * Math.cos(a) - u.z * Math.sin(a), z: u.x * Math.sin(a) + u.z * Math.cos(a) });
    const valid = (x, z, yaw) => {
      if (S.hits(x, z, yaw).length) return false;
      if (Math.abs(BR.phys.groundY(x, z)) > 0.02) return false;
      try { if (__fk.exitHit(x, z, yaw, 0, 0.15, 0.3)) return false; } catch (e) { /* 没有就算了 */ }
      return true;
    };
    // 叉尖（本地 z −2.1）离目标点 Q 沿 u 方向 gap、横向偏 lat
    const facePose = (Q, u, gap, lat) => { const px = -u.z, pz = u.x; const tx = Q.x - u.x * gap + px * lat, tz = Q.z - u.z * gap + pz * lat; return { x: tx - u.x * 2.1, z: tz - u.z * 2.1, yaw: S.yawOf(u) }; };
    const push = (cat, pose, meta, cap) => {
      cnt[cat] = cnt[cat] || 0;
      if (cnt[cat] >= (cap || per)) return false;
      if (!valid(pose.x, pose.z, pose.yaw)) return false;
      cnt[cat]++; out.push(Object.assign({ cat, x: S.r(pose.x), z: S.r(pose.z), yaw: S.r(pose.yaw, 10000) }, meta || {})); return true;
    };
    const tries = (cat, n, fn) => { for (let i = 0; i < n && (cnt[cat] || 0) < per; i++) fn(); };
    const racks = sol.filter(q => q.cls === 'rack');
    const longX = q => q.w > q.d;
    // 1/2/4 货架通道：两排同向货架长边之间
    const aisles = [];
    for (const A of racks) for (const B of racks) {
      if (A === B || longX(A) !== longX(B)) continue;
      if (longX(A)) { const g = B.minZ - A.maxZ, o0 = Math.max(A.minX, B.minX), o1 = Math.min(A.maxX, B.maxX); if (g > 2.2 && g < 9 && o1 - o0 > 2) aisles.push({ ax: 'x', c: (A.maxZ + B.minZ) / 2, g, lo: o0, hi: o1, A, B }); }
      else { const g = B.minX - A.maxX, o0 = Math.max(A.minZ, B.minZ), o1 = Math.min(A.maxZ, B.maxZ); if (g > 2.2 && g < 9 && o1 - o0 > 2) aisles.push({ ax: 'z', c: (A.maxX + B.minX) / 2, g, lo: o0, hi: o1, A, B }); }
    }
    const aislePose = (a, s, lat, dirSign, yawJ) => {
      const u0 = a.ax === 'x' ? { x: dirSign, z: 0 } : { x: 0, z: dirSign };
      const u = rot(u0, yawJ || 0);
      const cx = a.ax === 'x' ? s : a.c + lat, cz = a.ax === 'x' ? a.c + lat : s;
      return { x: cx, z: cz, yaw: S.yawOf(u) };
    };
    tries('rackAisle', 400, () => { if (!aisles.length) return; const a = pickA(aisles); push('rackAisle', aislePose(a, U2(a.lo + 1, a.hi - 1), U2(-0.15, 0.15), rnd() < 0.5 ? 1 : -1, U2(-0.05, 0.05)), { aisleW: S.r(a.g, 100) }); });
    tries('rackNear', 400, () => { if (!aisles.length) return; const a = pickA(aisles); const cl = U2(0.12, 0.6), side = rnd() < 0.5 ? -1 : 1, lat = side * (a.g / 2 - 0.62 - cl); push('rackNear', aislePose(a, U2(a.lo + 1, a.hi - 1), lat, rnd() < 0.5 ? 1 : -1, U2(-0.04, 0.04)), { aisleW: S.r(a.g, 100), clear: S.r(cl, 100) }); });
    tries('rackEnd', 600, () => {
      if (!aisles.length) return; const a = pickA(aisles); const dir = rnd() < 0.5 ? 1 : -1;
      // 叉尖在通道口 −2 … +1.5 m（正 = 已经伸出去），朝外开，偏航 ±25°
      const endS = dir > 0 ? a.hi : a.lo, t = U2(-2, 1.5), s0 = endS + dir * t - dir * (-2.1) * -1;
      const sc = endS + dir * t - dir * 2.1;   // 车原点 = 叉尖往回 2.1
      push('rackEnd', aislePose(a, sc, U2(-0.3, 0.3), dir, U2(-0.45, 0.45)), { aisleW: S.r(a.g, 100), tipOut: S.r(t, 100) });
    });
    // 3 货架头：短面
    tries('rackHead', 600, () => {
      if (!racks.length) return; const R = pickA(racks); const sd = rnd() < 0.5 ? -1 : 1;
      const Q = longX(R) ? { x: sd < 0 ? R.minX : R.maxX, z: (R.minZ + R.maxZ) / 2 + U2(-0.9, 0.9) } : { x: (R.minX + R.maxX) / 2 + U2(-0.9, 0.9), z: sd < 0 ? R.minZ : R.maxZ };
      const n = longX(R) ? { x: sd, z: 0 } : { x: 0, z: sd };
      const u = rot({ x: -n.x, z: -n.z }, U2(-0.25, 0.25));
      push('rackHead', facePose(Q, u, U2(0.3, 6), 0), { gap: null, target: 'rack' });
    });
    const walls = sol.filter(q => q.cls === 'hutWall' || q.cls === 'bearingWall');
    const wallFaces = W => { const lx = W.w > W.d; return lx ? [{ n: { x: 0, z: -1 }, c: W.minZ, lo: W.minX, hi: W.maxX, ax: 'x' }, { n: { x: 0, z: 1 }, c: W.maxZ, lo: W.minX, hi: W.maxX, ax: 'x' }] : [{ n: { x: -1, z: 0 }, c: W.minX, lo: W.minZ, hi: W.maxZ, ax: 'z' }, { n: { x: 1, z: 0 }, c: W.maxX, lo: W.minZ, hi: W.maxZ, ax: 'z' }]; };
    // 5 墙边（平行，车侧离墙 0.1–1.5 m）
    tries('wallSide', 800, () => {
      if (!walls.length) return; const W = pickA(walls), F = pickA(wallFaces(W)); const cl = U2(0.1, 1.5), dist = 0.6 + cl;
      const s = U2(F.lo - 1, F.hi + 1), dir = rnd() < 0.5 ? 1 : -1;
      const u = rot(F.ax === 'x' ? { x: dir, z: 0 } : { x: 0, z: dir }, U2(-0.12, 0.12));
      const x = F.ax === 'x' ? s : F.c + F.n.x * dist, z = F.ax === 'x' ? F.c + F.n.z * dist : s;
      push('wallSide', { x, z, yaw: S.yawOf(u) }, { clear: S.r(cl, 100), wall: W.cls, len: S.r(Math.max(W.w, W.d), 100) });
    });
    // 6 车头对着墙（小屋外 / 承重墙），斜 ±35°
    tries('wallFace', 800, () => {
      if (!walls.length) return; const W = pickA(walls), F = pickA(wallFaces(W));
      const s = U2(F.lo + 0.3, F.hi - 0.3), Q = F.ax === 'x' ? { x: s, z: F.c } : { x: F.c, z: s };
      const u = rot({ x: -F.n.x, z: -F.n.z }, U2(-0.6, 0.6)), gap = U2(0.3, 5.5);
      push('wallFace', facePose(Q, u, gap, 0), { gap: S.r(gap, 100), wall: W.cls });
    });
    // 7 墙角：小屋 / 墙段外角附近，车头对着角或从角边擦过
    tries('corner', 800, () => {
      if (!walls.length) return; const W = pickA(walls.filter(q => q.cls === 'hutWall')); if (!W) return;
      const lx = W.w > W.d, end = rnd() < 0.5 ? 0 : 1;
      const E = lx ? { x: end ? W.maxX : W.minX, z: (W.minZ + W.maxZ) / 2 } : { x: (W.minX + W.maxX) / 2, z: end ? W.maxZ : W.minZ };
      const a = U2(0, Math.PI * 2), u = { x: Math.cos(a), z: Math.sin(a) }, gap = U2(0.4, 4), lat = U2(-1.2, 1.2);
      push('corner', facePose(E, u, gap, lat), { gap: S.r(gap, 100), lat: S.r(lat, 100) });
    });
    // 8 门口：同一直线上两段墙中间 1.16 m 的缺口
    const doors = [];
    const hw = sol.filter(q => q.cls === 'hutWall');
    for (const A of hw) for (const B of hw) {
      if (A === B) continue;
      if (A.w > A.d && B.w > B.d && Math.abs(A.minZ - B.minZ) < 0.01) { const g = B.minX - A.maxX; if (g > 0.8 && g < 1.6) doors.push({ x: (A.maxX + B.minX) / 2, z: (A.minZ + A.maxZ) / 2, ax: 'x', g }); }
      if (A.d > A.w && B.d > B.w && Math.abs(A.minX - B.minX) < 0.01) { const g = B.minZ - A.maxZ; if (g > 0.8 && g < 1.6) doors.push({ x: (A.minX + A.maxX) / 2, z: (A.maxZ + B.minZ) / 2, ax: 'z', g }); }
    }
    tries('door', 600, () => {
      if (!doors.length) return; const D = pickA(doors);
      // 屋里那一侧：顺法线方向 6.6 m 内打到另一面小屋墙
      let nOut = null;
      for (const sg of [-1, 1]) { const n = D.ax === 'x' ? { x: 0, z: sg } : { x: sg, z: 0 }; let h = null; try { h = BR.phys.raycast(D.x + n.x * 0.3, 1.0, D.z + n.z * 0.3, n.x, 0, n.z, 6.8, { ignoreKey: S.ign }); } catch (e) { h = null; } const bx = h && S.boxOf(h); if (bx && bx.cls === 'hutWall' && h.dist > 5) nOut = { x: -n.x, z: -n.z }; }
      if (!nOut) return;
      const u = rot({ x: -nOut.x, z: -nOut.z }, U2(-0.2, 0.2)), gap = U2(0.3, 4.5);
      push('door', facePose(D, u, gap, U2(-0.3, 0.3)), { gap: S.r(gap, 100) });
    });
    // 9 空地：前面 7 m 内没东西
    tries('open', 2000, () => {
      const cs = BR.world.chunks(); const c = pickA(cs); const [cx, cz] = c.key.split(',').map(Number);
      const x = cx * 32 + U2(1, 31), z = cz * 32 + U2(1, 31), yaw = U2(-Math.PI, Math.PI);
      if (!valid(x, z, yaw)) return;
      const sw = __fp.sweep(x, z, yaw, 0, 7, S.pk, 0.1); if (sw) return;
      push('open', { x, z, yaw });
    });
    // 10 撞车直道：车轮挡、矮堆垛（光线从上面过去）、施工区矮物
    const lows = sol.filter(q => q.cls === 'low' && q.h > 0.08 && Math.max(q.w, q.d) > 0.9);
    const faceOf = (B) => { const sd = Math.floor(rnd() * 4); if (sd === 0) return [{ x: U2(B.minX, B.maxX), z: B.minZ }, { x: 0, z: -1 }]; if (sd === 1) return [{ x: U2(B.minX, B.maxX), z: B.maxZ }, { x: 0, z: 1 }]; if (sd === 2) return [{ x: B.minX, z: U2(B.minZ, B.maxZ) }, { x: -1, z: 0 }]; return [{ x: B.maxX, z: U2(B.minZ, B.maxZ) }, { x: 1, z: 0 }]; };
    tries('crash', 800, () => { if (!lows.length) return; const B = pickA(lows); const [Q, n] = faceOf(B); const gap = U2(0.05, 3); push('crash', facePose(Q, rot({ x: -n.x, z: -n.z }, U2(-0.2, 0.2)), gap, 0), { gap: S.r(gap, 100), dims: [S.r(B.w, 100), S.r(B.d, 100), S.r(B.h, 100)] }); });
    // 11 树 / 杆子
    const thin = sol.filter(q => q.cls === 'tree' || q.cls === 'post');
    tries('tree', 800, () => { if (!thin.length) return; const B = pickA(thin); const Q = { x: (B.minX + B.maxX) / 2, z: (B.minZ + B.maxZ) / 2 }; const a = U2(0, Math.PI * 2), u = { x: Math.cos(a), z: Math.sin(a) }, gap = U2(0.3, 5.5); push('tree', facePose(Q, u, gap + Math.max(B.w, B.d) / 2, U2(-0.3, 0.3)), { gap: S.r(gap, 100), cls: B.cls, dims: [S.r(B.w, 100), S.r(B.d, 100), S.r(B.h, 100)] }); });
    // 12 柱子
    const pil = sol.filter(q => q.cls === 'pillar');
    tries('pillar', 800, () => { if (!pil.length) return; const B = pickA(pil); const [Q, n] = faceOf(B); const gap = U2(0.2, 6); push('pillar', facePose(Q, rot({ x: -n.x, z: -n.z }, U2(-0.3, 0.3)), gap, U2(-0.5, 0.5)), { gap: S.r(gap, 100), w: S.r(B.w, 100) }); });
    // 13 别的车
    const cars = BR.vehicles.list().filter(v => v.key !== S.k);
    tries('car', 800, () => {
      if (!cars.length) return; const V = pickA(cars), P = V.pose || V; const sd = Math.floor(rnd() * 3);
      let Ql, nl; if (sd === 0) { Ql = { x: 0.6, z: U2(-1, 1.2) }; nl = { x: 1, z: 0 }; } else if (sd === 1) { Ql = { x: -0.6, z: U2(-1, 1.2) }; nl = { x: -1, z: 0 }; } else { Ql = { x: U2(-0.5, 0.5), z: 1.3 }; nl = { x: 0, z: 1 }; }
      const c = Math.cos(P.yaw), sn = Math.sin(P.yaw);
      const Q = { x: P.x + c * Ql.x + sn * Ql.z, z: P.z - sn * Ql.x + c * Ql.z }, n = { x: c * nl.x + sn * nl.z, z: -sn * nl.x + c * nl.z };
      const gap = U2(0.3, 5); push('car', facePose(Q, rot({ x: -n.x, z: -n.z }, U2(-0.3, 0.3)), gap, 0), { gap: S.r(gap, 100), other: V.key, side: ['right', 'left', 'rear'][sd] });
    });
    // 14 高堆垛（宽堆垛 1.44 m，比光源高）
    const stk = sol.filter(q => q.cls === 'stack');
    tries('stack', 800, () => { if (!stk.length) return; const B = pickA(stk); const [Q, n] = faceOf(B); const gap = U2(0.2, 5); push('stack', facePose(Q, rot({ x: -n.x, z: -n.z }, U2(-0.3, 0.3)), gap, U2(-0.4, 0.4)), { gap: S.r(gap, 100), h: S.r(B.h, 100) }); });
    // 15 矮货架（2 m × 0.8 m 周转箱架）、配电柜
    const ts = sol.filter(q => q.cls === 'toteShelf' || q.cls === 'cabinet' || q.cls === 'wallish');
    tries('shelfMisc', 800, () => { if (!ts.length) return; const B = pickA(ts); const [Q, n] = faceOf(B); const gap = U2(0.2, 5); push('shelfMisc', facePose(Q, rot({ x: -n.x, z: -n.z }, U2(-0.35, 0.35)), gap, U2(-0.3, 0.3)), { gap: S.r(gap, 100), cls: B.cls, dims: [S.r(B.w, 100), S.r(B.d, 100), S.r(B.h, 100)] }); });
    return { poses: out, cnt, nAisles: aisles.length, nDoors: doors.length, nWalls: walls.length, nThin: thin.length, nPil: pil.length, nCars: cars.length, nStk: stk.length, nTs: ts.length, nLows: lows.length };
  };

  // ---- 逐帧开车：每帧记录大灯（位置、range、强度、被谁收住）、车本地几处地面的理论照度、驾驶座画面几块区域的平均亮度、灯池里有没有大灯 ----
  S.E = (L, x, y, z) => { const dx = L.x - x, dy = L.y - y, dz = L.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (!(L.range > d)) return 0; const k = 1 - d / L.range; return L.intensity * k * k * Math.max(0, dy / d); };
  S.frame = (cv) => {
    const v = BR.vehicles.byKey(S.k), p = v.pose, L = S.L(), sim = S.sim(), inf = sim && sim.lightInfo;
    const gy = p.y || 0;
    const E = [0.5, 1.5, 3.0, 5.0].map(t => { const q = S.W(p, 0, 0.0, -2.1 - t); return L ? S.r(S.E(L, q.x, gy, q.z), 10000) : 0; });
    const P = BR.gfx.scene.children.find(o => o.isPointLight && /^gfx-pool-/.test(o.name) && L && Math.abs(o.position.x - L.x) < 0.02 && Math.abs(o.position.z - L.z) < 0.02);
    const row = { x: S.r(p.x), z: S.r(p.z), yaw: S.r(p.yaw, 1000), spd: S.r(p.spd, 100), st: S.r(p.steer, 100),
      L: L ? [S.r(L.x), S.r(L.z), S.r(L.range), S.r(L.intensity)] : null, by: inf && inf.by ? inf.by.kind + ':' + (inf.by.box && inf.by.box.maxX != null ? S.r(inf.by.box.maxX - inf.by.box.minX, 100) + 'x' + S.r(inf.by.box.maxZ - inf.by.box.minZ, 100) : inf.by.key) : null,
      hit: inf && inf.hit != null ? S.r(inf.hit, 100) : null, E, pool: P ? S.r(P.intensity, 100) : 0, poolD: P ? S.r(P.distance, 100) : null };
    if (cv) {
      const W = cv.width, H = cv.height;
      row.vb = S.meanLum(cv, Math.round(W * 0.3), Math.round(H * 0.62), Math.round(W * 0.7), Math.round(H * 0.95));   // 下方中间（车前地面）
      row.vc = S.meanLum(cv, Math.round(W * 0.35), Math.round(H * 0.3), Math.round(W * 0.65), Math.round(H * 0.6));    // 正中（前方墙 / 柱）
      row.vf = S.meanLum(cv, 0, 0, W, H);
    }
    return row;
  };
  S.grabMain = () => { const cv = BR.gfx.renderer.domElement; const c = S._c3 || (S._c3 = document.createElement('canvas')); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0); return c; };
}
// FE1R-light 页面工具 window.__lt（依赖 __sw）：K2 判定区 / 墙后暗 / lightAt 一致，一个位姿 2 次渲染
function installLt() {
  const S = window.__sw, T = THREE, L = window.__lt = {};
  // 碰撞体分类（和裁定一致：窄 = 水平两个方向都 ≤ 1.0 m，墙段除外）
  L.kindOf = (w, d, h) => { const a = Math.max(w, d), b = Math.min(w, d), wl = a >= 0.4 && a >= 2 * b; if (a <= 1.0 && !(wl && h >= 2.4)) return 'narrow'; return wl ? (b > 1.0 ? 'rack' : 'wall') : 'wide'; };
  L.boxOfHit = h => {
    if (!h) return null;
    if (h.obb) return { car: true, key: h.key, kind: 'car' };
    let s = null;
    try { for (const q of BR.phys.records(h.key).solids) { if (h.x >= q.minX - 0.002 && h.x <= q.maxX + 0.002 && h.y >= q.minY - 0.002 && h.y <= q.maxY + 0.002 && h.z >= q.minZ - 0.002 && h.z <= q.maxZ + 0.002) { s = q; break; } } } catch (e) { s = null; }
    if (!s) return { key: h.key, kind: '?' };
    if (s.obb) return { car: true, key: s.key, kind: 'car' };
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ, hh = s.maxY - s.minY;
    return { key: s.key, w, d, h: hh, minY: s.minY, maxY: s.maxY, cx: (s.minX + s.maxX) / 2, cz: (s.minZ + s.maxZ) / 2, kind: L.kindOf(w, d, hh) };
  };
  // 叉尖往前、车宽带里第一个挡光体（不窄、高过 0.5 m）：5 条横向 × 3 个高度的水平射线。
  // 返修 FE1R · repair-r1（验收员 tests，K1 / K2 原文）：窄东西（树干、杆子、柱子）不是挡光体，不截断判定区 —— 它周围、后面看得见的地照样是车前的空地
  // （被它挡住、从驾驶座看不见的那几点在判定区里另外去掉）
  L.blockDist = (p) => {
    const gy = p.y || 0; let best = Infinity, who = null;
    for (const lx of [-0.6, -0.3, 0, 0.3, 0.6]) for (const y of [0.6, 1.0, 1.4]) {
      const o = S.W(p, lx, y, -2.1), f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
      let d0 = 0;
      for (let k = 0; k < 6; k++) {
        let h = null; try { h = BR.phys.raycast(o.x + f.x * d0, o.y, o.z + f.z * d0, f.x, 0, f.z, 8 - d0, { ignoreKey: S.ign }); } catch (e) { h = null; }
        if (!h || !(h.dist < 8 - d0)) break;
        const bx = L.boxOfHit(h);
        if (bx && bx.kind !== 'narrow' && !(bx.maxY != null && bx.maxY < gy + 0.5)) { if (d0 + h.dist < best) { best = d0 + h.dist; who = bx; } break; }
        d0 += h.dist + 0.05;
      }
    }
    // 切出墙片（承重墙中间那段 noclip 出口：看得见、没有碰撞体，phys 射线打不到）也是车宽带里的挡光体（整合 FE1R：种子 39 #179 车正对一段
    // 带切出墙片的承重墙，射线从切口穿过去，判定区一直算到墙根，大灯却按墙收住）。按大灯求解器收挡体的结果（forklift.js lightOcc 把切出墙片
    // 按网格包围盒当墙）取车宽带里第一个不窄的挡体
    try { const sim = S.sim(), c = sim && BR.forklift._light && BR.forklift._light.ctx(sim); if (c && Number.isFinite(c.gB) && c.gB < best) { best = c.gB; who = { kind: 'occ', by: c.gBy && c.gBy.t }; } } catch (e) { /* 照射线的 */ }
    return { d: best, who };
  };
  // 离任何实体面的水平距离 < r（静态 AABB、别的车 OBB；高过地面 3 cm 的）
  L.nearSolid = (x, z, gy, r) => { const out = []; try { BR.phys.overlapBox(x - r, z - r, x + r, z + r, gy + 0.03, 2.0, { out, ignoreKey: S.ign, tol: 1e-6 }); } catch (e) { return false; }
    for (const s of out) { if (s.obb) { const c = Math.cos(s.rot), sn = Math.sin(s.rot), dx = x - s.cx, dz = z - s.cz, lx = dx * c - dz * sn, lz = dx * sn + dz * c; if (Math.hypot(Math.max(0, Math.abs(lx) - s.hx), Math.max(0, Math.abs(lz) - s.hz)) < r) return true; }
      else if (Math.hypot(Math.max(0, s.minX - x, x - s.maxX), Math.max(0, s.minZ - z, z - s.maxZ)) < r) return true; }
    return false; };
  // 一个位姿：K2 判定区（叉尖前 0.5 m 到 min(3, 挡光体 − 0.2)，横向 ±0.5，每 0.25 m 一点；去掉离实体面 < 0.3 m、驾驶座看不见的）
  // 开关灯地面亮度差、lightAt；墙后（光源到这一点的视线被不窄的碰撞体挡住、在光球里）的地面点开关灯差、lightAt；竖直面 / 天花板按光球解析算
  L.k2 = (opt) => {
    const o = opt || {};
    const v = BR.vehicles.byKey(S.k), p = Object.assign({}, v.pose), sim = S.sim(), gy = p.y || 0;
    if (!S.capture()) return { err: 'no light' };
    const Lt = S._st.L, inf = sim.lightInfo || {};
    const bd = L.blockDist(p), T = Math.min(3, bd.d - 0.2);
    const eye = sim.eyeWorld();
    S.aim({ x: eye.x, y: eye.y, z: eye.z }, S.W(p, 0, 0, -5));
    S.occl();
    const zone = [];
    // 地上本身不吃光的（出口圈那种自发光的 kit:glow、MeshBasic）不算车前地面：从正上方往下打，第一下打到它就跳过
    const lit0 = []; BR.gfx.scene.traverseVisible(o => { if (o.isMesh) lit0.push(o); });
    const rcD = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0);
    const unlit = q => { rcD.set(new THREE.Vector3(q.x, gy + 0.3, q.z), dn); rcD.near = 0; rcD.far = 0.35; const h = rcD.intersectObjects(lit0, false)[0]; const m = h && h.object.material; return !!m && (m.isMeshBasicMaterial || /glow/.test(h.object.name || '')); };
    for (let t = 0.5; t <= T + 1e-6; t += 0.25) for (const u of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const q = S.W(p, u, 0.002, -2.1 - t);
      if (L.nearSolid(q.x, q.z, gy, 0.3)) continue;
      if (!S.seen(q)) continue;
      if (unlit(q)) continue;
      zone.push({ t, u, x: q.x, y: q.y, z: q.z });
    }
    // 墙后的地面点：光源周围一圈（水平 0.25 … R + 0.6），视线被不窄的碰撞体挡住
    const blk = [];
    const R = Lt.range, hy = Lt.y - gy;
    for (let hh = 0.25; hh <= Math.min(R + 0.6, 8); hh += 0.35) for (let a = 0; a < 20; a++) {
      const ang = a / 20 * Math.PI * 2 + hh * 0.37, q = { x: Lt.x + Math.cos(ang) * hh, y: gy + 0.002, z: Lt.z + Math.sin(ang) * hh };
      if (Math.abs(BR.phys.groundY(q.x, q.z) - gy) > 0.05) continue;
      if (S.inSolid(q.x, gy + 0.05, q.z, 0.02)) continue;
      const lc = S.Lc(p, q.x, q.z); if (Math.abs(lc.x) < 0.7 && lc.z > -2.2 && lc.z < 1.45) continue;
      const bh = S.losBlock({ x: q.x, y: q.y + 0.02, z: q.z }, Lt);
      if (!bh) continue;
      const bx = L.boxOfHit(bh);
      if (!bx || bx.kind === 'narrow' || bx.kind === '?') continue;
      if (bx.maxY != null && bx.maxY < Lt.y) continue;   // 矮于光源的不算（裁定：竖直方向跨过光源高度的）
      // 返修 FE1R · repair-r2（验收员 spec，J9 / FE1Q「货架头那一下漏光接受」）：被货架挡住、但还在这排货架自己那一条里的地（两节之间的空当、
      // 货架头外面的横通道 —— 没越过这排货架远侧长边往里 0.1 m）不算墙后；越过了（另一侧的通道）照旧要黑
      if (bx.kind === 'rack') {
        const thinX = bx.w <= bx.d, c = thinX ? bx.cx : bx.cz, hw = (thinX ? bx.w : bx.d) / 2, qc = thinX ? q.x : q.z, lc = thinX ? Lt.x : Lt.z;
        const far = c - Math.sign(lc - c) * (hw - 0.1);   // 远侧长边往里 0.1 m 那条线
        if ((qc - far) * Math.sign(lc - c) >= 0) continue;
      }
      blk.push({ x: q.x, y: q.y, z: q.z, kind: bx.kind, d3: Math.hypot(q.x - Lt.x, q.y - Lt.y, q.z - Lt.z) });
    }
    const half = 6, cx = (S.W(p, 0, 0, -3.6).x), cz = S.W(p, 0, 0, -3.6).z;
    S.setOn(true); const mOn = S.floorMap(cx, cz, gy, half); const atOn = zone.concat(blk).map(q => BR.world.lightAt(q.x, q.z));
    S.setOn(false); const mOff = S.floorMap(cx, cz, gy, half); const atOff = zone.concat(blk).map(q => BR.world.lightAt(q.x, q.z));
    S.setOn(true);
    let zFail = [], dFail = [], aFail = [];
    zone.forEach((q, i) => { const a = S.fm(mOn, q.x, q.z, 1), b = S.fm(mOff, q.x, q.z, 1); q.d = a != null && b != null ? S.r(a - b, 10) : null; q.at = S.r(atOn[i] - atOff[i], 10000); if (q.d == null || q.d < 8) zFail.push([q.t, q.u, q.d]); if (q.d != null && q.d >= 8 && q.at < 0.01) aFail.push(['zone', q.t, q.u, q.at]); });
    blk.forEach((q, j) => { const i = zone.length + j; const a = S.fm(mOn, q.x, q.z, 1), b = S.fm(mOff, q.x, q.z, 1); q.d = a != null && b != null ? S.r(a - b, 10) : null; q.at = S.r(atOn[i] - atOff[i], 10000); if (q.d != null && q.d > 2) dFail.push([q.kind, q.d, S.r(q.d3, 100)]); if (q.at >= 0.005 && Math.hypot(q.x - Lt.x, q.z - Lt.z) >= R) aFail.push(['blk', q.kind, q.at]); });
    // 竖直面 / 天花板：光球里、朝着光源、视线被不窄的碰撞体挡住的点（解析：光球外就一定不亮）
    const ov = []; try { BR.phys.overlapBox(Lt.x - R, Lt.z - R, Lt.x + R, Lt.z + R, gy + 0.02, 3.0, { out: ov, ignoreKey: S.ign }); } catch (e) { /* 忽略 */ }
    let vLeak = 0; const vEx = [];
    for (const s of ov) {
      if (s.obb) continue;
      const w = s.maxX - s.minX, d = s.maxZ - s.minZ, hh = s.maxY - s.minY;
      if (L.kindOf(w, d, hh) === 'rack') continue;   // 货架面是透的（J9）
      for (const [n, c, ax] of [[[1, 0, 0], s.maxX, 'x'], [[-1, 0, 0], s.minX, 'x'], [[0, 0, 1], s.maxZ, 'z'], [[0, 0, -1], s.minZ, 'z']]) {
        const lo = ax === 'x' ? s.minZ : s.minX, hi = ax === 'x' ? s.maxZ : s.maxX, len = hi - lo, nU = Math.max(1, Math.min(8, Math.round(len / 0.4)));
        for (let i = 0; i < nU; i++) for (const yy of [0.3, 1.0, 1.6, 2.3]) {
          if (gy + yy > s.maxY - 0.03) continue;
          const u = lo + (i + 0.5) * len / nU, q = ax === 'x' ? { x: c + n[0] * 0.003, y: gy + yy, z: u } : { x: u, y: gy + yy, z: c + n[2] * 0.003 };
          const dx = Lt.x - q.x, dy = Lt.y - q.y, dz = Lt.z - q.z, d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d3 >= R || dx * n[0] + dz * n[2] <= 0) continue;
          if (S.inSolid(q.x, q.y, q.z, 0.001)) continue;
          const bh = S.losBlock(q, Lt); if (!bh) continue;
          const bx = L.boxOfHit(bh); if (!bx || bx.kind === 'narrow' || bx.kind === '?') continue;
          if (bx.maxY != null && bx.maxY < Lt.y) continue;
          const k = 1 - d3 / R, E = Lt.intensity * k * k * (dx * n[0] + dz * n[2]) / d3;
          if (E > 0.004) { vLeak++; if (vEx.length < 4) vEx.push([bx.kind, S.r(E, 1000), S.r(d3, 100)]); }
        }
      }
    }
    return { pose: { x: S.r(p.x), z: S.r(p.z), yaw: S.r(p.yaw, 10000) }, L: { x: S.r(Lt.x), y: S.r(Lt.y), z: S.r(Lt.z), R: S.r(R, 100), I: S.r(Lt.intensity, 100) },
      inf: { s: S.r(inf.s, 100), u: S.r(inf.u, 100), h: S.r(inf.h, 100), by: inf.by && inf.by.kind, cov: inf.zoneCov && S.r(inf.zoneCov, 100) },
      block: S.r(bd.d, 100), blockBy: bd.who && bd.who.kind, T: S.r(T, 100), nZone: zone.length, zFail, zMin: zone.length ? Math.min(...zone.map(q => q.d == null ? -1 : q.d)) : null,
      near15: zone.filter(q => q.t <= 1.5 + 1e-6).every(q => q.d != null && q.d >= 8), nBlk: blk.length, dFail, vLeak, vEx, aFail };
  };
}
// ---- 追加（polish 用）：单盏光源暴力搜、竖直面亮度带最大通道、天花板、车模型顶点 ----
function installLt2() {
  const S = window.__sw, L = window.__lt;
  // 这个位姿下，单盏受界点光源（大灯同一套界限）在细网格上最多能把测试口径的判定区照亮多少点（E ≥ thr）
  L.brute = (thr, noK1) => {
    const T0 = thr || 0.15, sim = S.sim(), Lh = BR.forklift._light, ctx = Lh.ctx(sim);
    const p = BR.vehicles.byKey(S.k).pose, gy = p.y || 0, bd = L.blockDist(p), T = Math.min(3, bd.d - 0.2);
    const eye = sim.eyeWorld(); S.aim({ x: eye.x, y: eye.y, z: eye.z }, S.W(p, 0, 0, -5)); S.occl();
    const zone = [];
    const lit0 = []; BR.gfx.scene.traverseVisible(o => { if (o.isMesh) lit0.push(o); });
    const rcD = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0);
    const unlit = q => { rcD.set(new THREE.Vector3(q.x, gy + 0.3, q.z), dn); rcD.near = 0; rcD.far = 0.35; const h = rcD.intersectObjects(lit0, false)[0]; const m = h && h.object.material; return !!m && (m.isMeshBasicMaterial || /glow/.test(h.object.name || '')); };
    for (let t = 0.5; t <= T + 1e-6; t += 0.25) for (const u of [-0.5, -0.25, 0, 0.25, 0.5]) { const q = S.W(p, u, 0.002, -2.1 - t); if (L.nearSolid(q.x, q.z, gy, 0.3)) continue; if (!S.seen(q)) continue; if (unlit(q)) continue; zone.push({ x: q.x, z: q.z, t, u }); }
    ctx.zone = zone; ctx.z1i = -1;
    let best = null;
    // 和大灯同一套限制：不越过车宽带里的挡光体、不越过挡在前面的窄东西（K1，Lh.sMaxU）
    for (let s = -0.5; s <= Math.min(3, ctx.sMax) + 1e-6; s += 0.1) for (let u = -0.5; u <= 0.5 + 1e-6; u += 0.1) for (let h = 0.45; h <= 1.2 + 1e-6; h += 0.075) {
      if (!noK1 && Lh.sMaxU && s > Lh.sMaxU(ctx, u) + 1e-6) continue;
      const c = Lh.eval(ctx, s, u, h, false); if (!c) continue;
      let ok = 0, near = 0, nn = 0;
      for (const q of zone) { const d = Math.hypot(q.x - c.x, h, q.z - c.z); const k = d < c.R ? 1 - d / c.R : 0; const e = c.I * k * k * h / d; if (e >= T0) ok++; if (q.t <= 1.5 + 1e-6) { nn++; if (e >= T0) near++; } }
      const sc = ok + (near === nn ? 1000 : 0);
      if (!best || sc > best.sc) best = { sc, ok, n: zone.length, near: near === nn, s: S.r(s, 100), u: S.r(u, 100), h: S.r(h, 100), R: S.r(c.R, 100), I: S.r(c.I, 100) };
    }
    return best || { ok: 0, n: zone.length, near: false };
  };
  // 照度计小格的平均亮度和最大通道
  L.luxMax = (pts) => {
    const r = BR.gfx.renderer, cv = r.domElement, W = cv.width, H = cv.height, pr = r.getPixelRatio(), ts = 6, per = Math.floor(W / ts);
    const lum = S.lux(pts);
    const c2 = S._c2, g = c2.getContext('2d', { willReadFrequently: true }), rows = Math.ceil(pts.length / per);
    const img = pts.length ? g.getImageData(0, H - rows * ts, Math.min(W, per * ts), rows * ts) : null;
    return pts.map((p, i) => {
      const tx = (i % per) * ts, ty = Math.floor(i / per) * ts, y0 = rows * ts - ty - ts; let mx = 0;
      for (let yy = 1; yy < ts - 1; yy++) for (let xx = 1; xx < ts - 1; xx++) { const j = ((y0 + yy) * img.width + tx + xx) * 4; mx = Math.max(mx, img.data[j], img.data[j + 1], img.data[j + 2]); }
      return [lum[i], mx];
    });
  };
  // 车模型（载具网格那一档，开过的车 drive: true）在给定 steer / lift 时的车本地顶点
  L.modelVerts = (k, steer, lift) => {
    const v = BR.vehicles.byKey(k), det = (v && v.tier) || 'mid';
    const b = BR.kit.builder({}, 0, 0, () => 0, { height: 4 });
    BR.L1forklift.model(b, { detail: det, drive: true, lift: lift || 0, steer: steer || 0, number: 88 });
    const V = [];
    b._accs.forEach(a => { if (a && a.pos) for (let i = 0; i < a.n; i++) V.push([a.pos[i * 3], a.pos[i * 3 + 1], a.pos[i * 3 + 2]]); });
    return V;
  };
  // 车本地顶点按位姿换到世界，插进 AABB box（世界）多深、几个；sel(lx, ly, lz) 只看一部分顶点
  L.penBox = (V, P, box, tol, sel) => {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), t = tol || 0;
    let worst = 0, n = 0, wv = null;
    for (const [lx, ly, lz] of V) {
      if (sel && !sel(lx, ly, lz)) continue;
      const x = P.x + c * lx + s * lz, y = (P.y || 0) + ly, z = P.z - s * lx + c * lz;
      if (x > box.minX && x < box.maxX && y > box.minY && y < box.maxY && z > box.minZ && z < box.maxZ) {
        const d = Math.min(x - box.minX, box.maxX - x, y - box.minY, box.maxY - y, z - box.minZ, box.maxZ - z);
        if (d > t) { n++; if (d > worst) { worst = d; wv = [S.r(lx), S.r(ly), S.r(lz)]; } }
      }
    }
    return { n, depth: S.r(worst, 10000), local: wv };
  };
  // 物资网格的世界顶点
  L.itemVerts = (id) => {
    const it = BR.items.find(id); if (!it || !it.obj) return [];
    const V = [], v3 = new THREE.Vector3();
    it.obj.updateMatrixWorld(true);
    it.obj.traverse(o => { if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return; const m = o.material; if (m && (m.transparent && m.opacity < 0.9)) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v3.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); V.push([v3.x, v3.y, v3.z]); } });
    return V;
  };
  L.penW = (V, box, tol) => { let n = 0, worst = 0; for (const [x, y, z] of V) if (x > box.minX && x < box.maxX && y > box.minY && y < box.maxY && z > box.minZ && z < box.maxZ) { const d = Math.min(x - box.minX, box.maxX - x, y - box.minY, box.maxY - y, z - box.minZ, box.maxZ - z); if (d > (tol || 0)) { n++; worst = Math.max(worst, d); } } return { n, depth: S.r(worst, 10000) }; };
}

// =====================================================================
// FE1R-light：大灯落点（K1 窄东西照旧亮、K2 车前空地一定亮、宽块 / 别的车不漏光、天花板、工坊）、升货叉被门楣挡（F1）、后轮打方向（F2）、
// 叉上的货参加碰撞（F3）、降货叉盒子往下扫（F4）
// =====================================================================
// 断电（或不断电）坐上出生车、冻住断电计时（层级 update 的 dt 改 0）、停 rAF、清掉怪：之后全靠 __br.step 和手动渲染
async function ltSession(browser, seed, o) {
  const opt = o || {};
  const { ctx, page } = await boot(browser, 'lt' + seed + (opt.tag || ''), opt.vp ? { viewport: opt.vp } : undefined);
  await ev(page, installSw); await ev(page, installLt); await ev(page, installLt2);
  if (opt.workshop) {
    await ev(page, a => { const m = BR.workshop.create('1', 'fe1r-ws'); m.seed = a.seed; Object.assign(m.settings, a.ws); __br.setAuto(true); BR.bus.emit('game:start', { mode: 'test', difficulty: null, settings: Object.assign({}, BR.game.settings, { quality: 'high' }), seed: a.seed, levelId: '1', coop: null, workshop: m }); return 0; }, { seed, ws: opt.workshop });
    await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
    await ev(page, () => { __br.setAuto(false); __br.step(0.5); return 0; });
  } else await startL1(page, { seed, quality: opt.quality || 'high' });
  const k = await ev(page, () => __fp.spawnKey() || (BR.vehicles.list()[0] || {}).key);
  let dark = null;
  if (!opt.lit && !opt.workshop) {
    const plan = await ev(page, () => { const U = BR.util, ls = BR.world.levelSeed; for (let e = 0; e < 60; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 6) return { e, dur, at: e * 45 }; } } return null; });
    let t = 0;
    for (let i = 0; plan && i < 500 && t < plan.at + 30; i++) {
      const dt = t < plan.at - 6 ? 5 : 0.5;
      const st = await ev(page, dt => { __br.step(dt); return __sw.dark(); }, dt);
      t += dt;
      if (st.n && st.off === st.n) { dark = { plan, t }; break; }
    }
  }
  if (opt.place !== false) await ev(page, a => { __fp.place(a.k, a.p[0], a.p[1], a.p[2], 0); __br.step(0.2); return 0; }, { k, p: opt.place || [0.5, 14, 0] });
  let seat = null;
  for (const side of ['left', 'right']) {
    await ev(page, a => { __fp.standL(a.k, a.side === 'right' ? 1.2 : -1.2, 0.24); __fp.aimL(a.k, 0, 1.25, 0.24); return 0; }, { k, side });
    await tap(page, 'Space'); await step(page, 1.6);
    seat = await ev(page, () => __fp.seat());
    if (seat.seated === k) break;
  }
  await ev(page, a => { __sw.init(a.k); if (!a.lit) __sw.freeze(); window.requestAnimationFrame = () => 0; __br.step(0.2); if (BR.entities && BR.entities.clear) { try { BR.entities.clear(); } catch (e) { /* 忽略 */ } } return __sw.markStatic(); }, { k, lit: !!opt.lit });
  return { ctx, page, k, dark, mounted: !!seat && seat.seated === k };
}
// 瞬移到位姿、等大灯平滑收敛 0.6 s
// （__br.step 每次调用只在最后一小步渲染一帧：一次推 0.6 s 只渲染一次，比 18 次 1/30 s 省很多渲染）
// 摆好以后推 0.6 s，再等大灯落定（整合 FE1R：光球放大按 3 m/s、强度按 2.4/s 限速，挨得近的两个位姿之间不算跳变、从上一个位姿的状态接着平滑，
// 0.6 s 里光球可能还没长到位 —— 停着的车灯落定以后孩子看到的才是这一位姿的光）：每 0.1 s 看一次，位置差 <5 mm、光球差 <1 cm、强度差 <0.5% 就算落定，最多再等 3 s
const ltPlace = (page, P) => ev(page, a => {
  __sw.place(a.x, a.z, a.yaw); __br.step(0.6);
  const cur = () => { const L = __sw.L(); return L ? [L.x, L.y, L.z, L.range, L.intensity] : null; };
  let prev = cur(), k = 0;
  for (; k < 30; k++) {
    __br.step(0.1);
    const c = cur();
    if (prev && c && Math.abs(c[0] - prev[0]) < 0.005 && Math.abs(c[1] - prev[1]) < 0.005 && Math.abs(c[2] - prev[2]) < 0.005 && Math.abs(c[3] - prev[3]) < 0.01 && Math.abs(c[4] - prev[4]) <= 0.005 * Math.max(1e-6, prev[4])) break;
    prev = c;
  }
  for (let j = 0; j < 2; j++) BR.gfx.render(0.1);
  return Object.assign(__sw.lightNow(), { settle: k });
}, P);
// 驾驶座画面开 / 关灯两张拼一张存 PNG
async function ltShot(page, name) {
  const url = await ev(page, () => {
    const S = __sw, sim = S.sim(), e = sim.eyeWorld(), p = BR.vehicles.byKey(S.k).pose;
    S.aim({ x: e.x, y: e.y, z: e.z }, S.W(p, 0, 0.2, -6));
    if (!S.capture()) return null;
    S.setOn(true); const a = S.view(); S.setOn(false); const b = S.view(); S.setOn(true);
    const c = document.createElement('canvas'); c.width = a.width * 2; c.height = a.height; const g = c.getContext('2d');
    g.drawImage(a, 0, 0); g.drawImage(b, a.width, 0); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, 150, 22); g.fillRect(a.width, 0, 150, 22);
    g.fillStyle = '#ff0'; g.font = '15px sans-serif'; g.fillText('驾驶座 开灯', 6, 16); g.fillText('驾驶座 关灯', a.width + 6, 16);
    return c.toDataURL('image/png');
  });
  if (!url) return null;
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  return path.relative(ROOT, f);
}

// ---------- K2：随机位姿（种子 12345 / 16 / 39，每个 ≥150 个）----------
// 判定区 = 叉尖前 0.5 m 到 min(3, 车宽带里第一个挡光体 − 0.2)，横向 ±0.5，每 0.25 m 一点，去掉离实体面 < 0.3 m、驾驶座看不见的；断电时开关灯渲染差全部 ≥8、lightAt 都亮。
// 墙后（光源到地面点的视线被不窄、跨过光源高度的碰撞体挡住）开关灯差 ≤2；竖直面按光球解析算（光球里、朝着光源、视线被挡的面点 0 个）；lightAt 和画面一致。
// 例外：单盏受界点光源在几何上照不到（同一套界限、细网格暴力搜也照不全判定区）的位姿 ≤3%，这些位姿叉尖前 0.5–1.5 m 仍须全亮，逐个截图
const K2_SEEDS = [12345, 16, 39];
const K2_NAMED = {
  12345: [
    { cat: 'named', name: 'H8 叉尖离小屋西墙 1 m', x: 17.7, z: 18.0, yaw: -Math.PI / 2 }, { cat: 'named', name: 'J9 窄道', x: 3.45, z: 5.59, yaw: -Math.PI / 2 },
    { cat: 'named', name: 'J9 宽通道', x: -12, z: 57.5, yaw: 0 }, { cat: 'named', name: '撞车直道', x: 37.5, z: 14.6, yaw: 0 },
    { cat: 'named', name: '贴着承重墙开 0.5 m（#54）', x: -14.5, z: 2.75, yaw: -Math.PI / 2 }, { cat: 'named', name: '贴着承重墙开 0.7 m', x: -14.5, z: 2.55, yaw: -Math.PI / 2 },
    { cat: 'occ', name: '#121 撞宽堆垛', x: 17.661, z: -61.487, yaw: 3.1083 }, { cat: 'occ', name: '#25 高堆垛 4 m', x: -81.97, z: 31.563, yaw: -3.1161 },
    { cat: 'occ', name: '#73 别的车右侧', x: -55.616, z: 86.276, yaw: 0.1279 }, { cat: 'occ', name: '#203 别的车车尾', x: 81.937, z: -34.766, yaw: 0.2777 },
  ],
  16: [{ cat: 'occ', name: '#110 宽堆垛', x: -31.615, z: -49.037, yaw: -1.4191 }],
  39: [],
};
async function gK2(browser) {
  const tot = { n: 0, lit: 0, exc: [], bad: [], dark: [], at: [], v: [] };
  for (const seed of K2_SEEDS) {
    const S = await ltSession(browser, seed);
    const { page } = S;
    try {
      check('K2.' + seed + ' 断电了、坐上了出生车', !!S.dark && S.mounted, S.dark);
      if (!S.dark || !S.mounted) continue;
      const g = await ev(page, a => __sw.gen(a.seed, a.per), { seed, per: 12 });
      const poses = (K2_NAMED[seed] || []).concat(g.poses);
      poses.sort((a, b) => { const ax = Math.floor(a.x / 32), bx = Math.floor(b.x / 32); if (ax !== bx) return ax - bx; const az = Math.floor(a.z / 32), bz = Math.floor(b.z / 32); return (ax % 2 ? -1 : 1) * (az - bz); });
      const rows = [];
      let i = 0;
      for (const P of poses) {
        i++;
        await ltPlace(page, P);
        const m = await ev(page, () => __lt.k2());
        if (m.err) { rows.push({ P, err: m.err }); continue; }
        m.P = P; m.i = i;
        if (m.zFail.length) {
          m.brute = await ev(page, () => __lt.brute(0.15));
          m.geo = !!m.brute && m.brute.ok < m.brute.n;
          // 例外的原因：不管「光源不越过正前方的窄东西」（K1）这一条就照得全的，记成 K1；还照不全的是墙 / 货架 / 宽块的影子界限
          if (m.geo) { const b2 = await ev(page, () => __lt.brute(0.15, true)); m.cause = b2 && b2.ok >= b2.n ? 'K1 窄东西挡在前面' : '影子界限'; }
          m.shot = await ltShot(page, 'k2-' + seed + '-' + String(i).padStart(3, '0') + '-' + P.cat);
        }
        rows.push(m);
      }
      fs.writeFileSync(path.join(OUT, 'k2-' + seed + '.json'), JSON.stringify(rows.map(r => Object.assign({}, r)), null, 0));
      const ok = rows.filter(r => !r.err);
      const lit = ok.filter(r => !r.zFail.length), exc = ok.filter(r => r.zFail.length && r.geo), bad = ok.filter(r => r.zFail.length && !r.geo);
      const dark = ok.filter(r => r.dFail.length || r.vLeak), at = ok.filter(r => r.aFail.length);
      const brief = r => ({ i: r.i, cat: r.P.cat, name: r.P.name, pose: r.pose, L: r.L, fail: r.zFail.slice(0, 4), brute: r.brute, cause: r.cause, near15: r.near15, shot: r.shot });
      tot.n += ok.length; tot.lit += lit.length; tot.exc.push(...exc.map(r => Object.assign({ seed }, brief(r)))); tot.bad.push(...bad.map(r => Object.assign({ seed }, brief(r))));
      tot.dark.push(...dark.map(r => ({ seed, i: r.i, cat: r.P.cat, dFail: r.dFail.slice(0, 3), vLeak: r.vLeak, vEx: r.vEx })));
      tot.at.push(...at.map(r => ({ seed, i: r.i, cat: r.P.cat, aFail: r.aFail.slice(0, 3) })));
      check('K2.' + seed + ' 随机位姿 ' + g.poses.length + ' 个（15 类：' + Object.entries(g.cnt).map(([a, b]) => a + ' ' + b).join('，') + '）+ 点名 ' + (K2_NAMED[seed] || []).length + ' 个，量完 ' + ok.length + ' 个',
        g.poses.length >= 150 && ok.length === poses.length, { cnt: g.cnt, err: rows.filter(r => r.err).slice(0, 3) });
      check('K2.' + seed + ' 车前地面亮：判定区每一点断电时开关灯差 ≥8 的 ' + lit.length + ' 个；单盏受界光源几何上照不全的例外 ' + exc.length + ' 个（' + (100 * exc.length / Math.max(1, ok.length)).toFixed(1) + '%，≤3%），这些叉尖前 0.5–1.5 m 全亮；' +
        '光源本来照得全却没照全的 ' + bad.length + ' 个', bad.length === 0 && exc.length <= 0.03 * ok.length && exc.every(r => r.near15), { exc: exc.map(brief), bad: bad.map(brief) });
      check('K2.' + seed + ' 墙后暗：被墙 / 货架 / 宽堆垛 / 别的车挡住的地面开关灯差 ≤2、光球里朝着光源被挡住的竖直面 0 个（超标位姿 ' + dark.length + ' 个）', dark.length === 0, dark.slice(0, 6).map(r => ({ i: r.i, cat: r.P.cat, d: r.dFail.slice(0, 3), v: r.vLeak, vEx: r.vEx })));
      check('K2.' + seed + ' lightAt 一致：画面亮了 ≥8 的点 lightAt 都亮、墙后光够不到的点 lightAt 不亮（不一致的位姿 ' + at.length + ' 个）', at.length === 0, at.slice(0, 6).map(r => ({ i: r.i, a: r.aFail.slice(0, 3) })));
      if (seed === 12345) {
        // L-occluders 点名的几处、K2 点名的几处，单独列一行
        const nm = ok.filter(r => r.P.cat === 'named' || r.P.cat === 'occ');
        info('K2 点名位姿', nm.map(r => [r.P.name, r.zFail.length ? 'zone✗' : 'zone✓', r.dFail.length || r.vLeak ? 'leak✗' : 'dark✓', r.L.R, r.inf.by]));
        await ceilChecks(page);
        await narrowChecks(page);
        await wallSpotChecks(page);
        await doorChecks(page);
      }
      if (seed === 16) {
        const nm = ok.filter(r => r.P.cat === 'occ');
        check('L-occ 种子 16 #110 宽堆垛：挡住的地面、竖直面开关灯差 ≤2，车前地面照旧亮', nm.length === 1 && !nm[0].dFail.length && !nm[0].vLeak && !nm[0].zFail.length, nm);
      }
    } finally { await S.ctx.close().catch(() => {}); }
  }
  check('K2 三个种子合计 ' + tot.n + ' 个位姿：车前地面亮 ' + tot.lit + '、几何例外 ' + tot.exc.length + '（' + (100 * tot.exc.length / Math.max(1, tot.n)).toFixed(1) + '%）、该亮没亮 ' + tot.bad.length + '；墙后漏光 ' + tot.dark.length + '；lightAt 不一致 ' + tot.at.length,
    tot.n >= 450 && tot.bad.length === 0 && tot.exc.length <= 0.03 * tot.n && tot.dark.length === 0 && tot.at.length === 0, { exc: tot.exc, bad: tot.bad.slice(0, 8) });
  fs.writeFileSync(path.join(OUT, 'k2-exceptions.json'), JSON.stringify(tot.exc, null, 1) + '\n');
}
// L-ceiling：前方 ≥6 m 开阔的位姿（种子 12345 的随机空地），光源上方天花板开关灯差 ≤ 叉尖前 1 m 地面的差、≤40；车后（驾驶座上方往后）天花板 0
async function ceilChecks(page) {
  const list = await ev(page, () => { const g = __sw.gen(12345, 30); return g.poses.filter(q => q.cat === 'open'); });
  const rows = [];
  for (const P of list) {
    if (rows.length >= 12) break;
    const free = await ev(page, a => !__fp.sweep(a.x, a.z, a.yaw, 0, 6, __sw.pk, 0.1), P);
    if (!free) continue;
    await ltPlace(page, P);
    rows.push(await ev(page, () => {
      const S = __sw, p = BR.vehicles.byKey(S.k).pose, gy = p.y || 0;
      if (!S.capture()) return null;
      const L = S._st.L;
      const pts = [{ x: L.x, y: gy + 3.997, z: L.z, n: [0, -1, 0], d: 0.25, tag: 'ceilAbove' }, Object.assign(S.W(p, 0, gy + 3.997, 0.2), { n: [0, -1, 0], d: 0.25, tag: 'ceilSeat' }), Object.assign(S.W(p, 0, gy + 3.997, 1.5), { n: [0, -1, 0], d: 0.25, tag: 'ceilRear' }), Object.assign(S.W(p, 0, gy + 0.002, -3.1), { n: [0, 1, 0], d: 0.3, tag: 'ground1m' })];
      S.setOn(true); const on = S.lux(pts); S.setOn(false); const off = S.lux(pts); S.setOn(true);
      const d = pts.map((q, i) => S.r(on[i] - off[i], 100));
      return { pose: { x: S.r(p.x), z: S.r(p.z) }, L: { y: S.r(L.y, 100), R: S.r(L.range, 100), I: S.r(L.intensity, 100) }, ceil: d[0], seat: d[1], rear: d[2], ground: d[3] };
    }));
  }
  const ok = rows.filter(Boolean);
  check('L-ceiling 前方 ≥6 m 开阔的 ' + ok.length + ' 个位姿：光源上方天花板开关灯差 ≤ 叉尖前 1 m 地面的差、≤40（最大 ' + Math.max(0, ...ok.map(r => r.ceil)).toFixed(1) + '）；驾驶座上方、车后天花板 ≤2',
    ok.length >= 9 && ok.every(r => r.ceil <= r.ground && r.ceil <= 40 && r.seat <= 2 && r.rear <= 2), ok);
}

// K2 (3)：正对 4.46–6 m 外的墙（光线起点到墙；叉尖离小屋西墙 3.06–4.6 m）：不再有贴着墙的发白小点 —— 墙上 Δ≥8 的亮斑直径 ≥0.6 m、亮斑里开灯像素最大通道 <245；
// 车前判定区照旧亮
async function wallSpotChecks(page) {
  const res = [];
  for (const g of [3.1, 3.5, 4.0, 4.5]) {
    await ltPlace(page, { x: 20.8 - g - 2.1, z: 18.0, yaw: -Math.PI / 2 });
    res.push(Object.assign({ g }, await ev(page, () => {
      const S = __sw; if (!S.capture()) return null;
      const L = S._st.L, pts = [];
      for (let y = 0.1; y <= 2.5 + 1e-6; y += 0.1) for (let dz = -1.2; dz <= 1.2 + 1e-6; dz += 0.1) pts.push({ x: 20.797, y, z: 18.0 + dz, n: [-1, 0, 0], d: 0.3 });
      S.setOn(true); const on = __lt.luxMax(pts); S.setOn(false); const off = S.lux(pts); S.setOn(true);
      const lit = pts.filter((q, i) => on[i][0] - off[i] >= 8);
      let y0 = 9, y1 = -9, z0 = 99, z1 = -99, mx = 0;
      pts.forEach((q, i) => { if (on[i][0] - off[i] >= 8) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); } mx = Math.max(mx, on[i][1]); });
      const k2 = __lt.k2();
      return { L: { x: S.r(L.x), y: S.r(L.y), R: S.r(L.range, 100), I: S.r(L.intensity, 100) }, n: lit.length, dia: lit.length ? S.r(Math.min(y1 - y0, z1 - z0) + 0.1, 100) : 0, maxCh: mx, zone: k2.nZone, zFail: k2.zFail.slice(0, 3) };
    })));
  }
  check('K2 正对 4.46–6 m 外的墙（叉尖离小屋西墙 3.1 / 3.5 / 4.0 / 4.5 m）：墙上 Δ≥8 的亮斑要么没有、要么直径 ≥0.6 m，亮斑里开灯像素最大通道 <245（' + res.map(r => r.g + ' m：' + (r.n ? '直径 ' + r.dia + '、最大通道 ' + r.maxCh : '无亮斑')).join('；') + '），车前判定区照旧亮',
    res.every(r => r && (r.n === 0 || r.dia >= 0.6) && r.maxCh < 245 && !r.zFail.length), res);
}
// K2 (3)：正对小屋门（种子 12345，门洞 x 7.42–8.58、z 36.8–37.0，屋在 +z）：光源不穿过门洞放进屋里，门外地面照判定区亮，屋里墙后（门两边那两段墙后面）开关灯差 ≤2
async function doorChecks(page) {
  const res = [];
  for (const g of [0.6, 1.5, 3.0]) {
    await ltPlace(page, { x: 8.0, z: 36.8 - g - 2.1, yaw: Math.PI });
    res.push(Object.assign({ g }, await ev(page, () => {
      const S = __sw; if (!S.capture()) return null;
      const L = S._st.L, pts = [];
      // 门两边那两段墙后面（屋里离墙 0.3–1.5 m，离门洞边 ≥0.4 m）：地面、离地 0.5 / 1.0 m 朝 −z 的面（屋里别的东西）
      for (const x of [5.8, 6.3, 9.7, 10.2]) for (const dz of [0.3, 0.8, 1.5]) pts.push({ x, y: 0.002, z: 37.0 + dz, n: [0, 1, 0], d: 0.3 });
      S.setOn(true); const on = S.lux(pts); S.setOn(false); const off = S.lux(pts); S.setOn(true);
      const k2 = __lt.k2();
      return { L: { x: S.r(L.x), y: S.r(L.y), z: S.r(L.z), R: S.r(L.range, 100) }, maxIn: Math.max(...pts.map((q, i) => S.r(on[i] - off[i], 100))), zone: k2.nZone, zFail: k2.zFail.slice(0, 3), dFail: k2.dFail.slice(0, 3) };
    })));
  }
  check('K2 正对小屋门（叉尖离门 0.6 / 1.5 / 3 m）：光源在门外（z < 36.8）、门外判定区亮、屋里门两边墙后的地面开关灯差 ≤2（' + res.map(r => r.g + ' m：光源 z ' + (r.L && r.L.z) + '、屋里最大 ' + r.maxIn).join('；') + '）',
    res.every(r => r && r.L.z < 36.8 && r.maxIn <= 2 && !r.zFail.length && !r.dFail.length), res);
}
// K1 (4)：正对独立立着的细杆 / 树干、正对柱子（断电）：朝车那一面 0.5 / 1.0 / 1.6 m 开关灯差 ≥8，判定区照旧亮
async function narrowChecks(page) {
  // 独立立着的（离别的碰撞体 ≥0.4 m：门框立柱嵌在墙的门洞边上，正对它就是正对墙，不算）细杆 / 树干，和柱子
  const targets = await ev(page, () => {
    const sol = __sw.solids(), P0 = BR.vehicles.byKey(__sw.k).pose;
    const near = q => Math.hypot((q.minX + q.maxX) / 2 - P0.x, (q.minZ + q.maxZ) / 2 - P0.z);
    const alone = q => { const out = []; BR.phys.overlapBox(q.minX - 0.4, q.minZ - 0.4, q.maxX + 0.4, q.maxZ + 0.4, 0.05, 1.8, { out, ignoreKey: __sw.ign }); return out.every(s => !s.obb && Math.abs(s.minX - q.minX) < 1e-6 && Math.abs(s.maxX - q.maxX) < 1e-6 && Math.abs(s.minZ - q.minZ) < 1e-6 && Math.abs(s.maxZ - q.maxZ) < 1e-6); };
    const post = sol.filter(q => (q.cls === 'post' || q.cls === 'tree') && q.h > 1.5 && alone(q)).sort((a, b) => near(a) - near(b));
    const pil = sol.filter(q => q.cls === 'pillar').sort((a, b) => near(a) - near(b));
    return { post: post.slice(0, 6), pil: pil.slice(0, 6) };
  });
  // 附近没有独立的细杆就用 ⑨ 那棵枯树（种子 12345，(8, −16)，碰撞盒 0.34 见方、高 1.7）
  if (!targets.post.length) targets.post = [{ minX: 7.83, maxX: 8.17, minZ: -16.17, maxZ: -15.83, minY: 0, maxY: 1.7, w: 0.34, d: 0.34, h: 1.7 }];
  const res = [];
  for (const [kind, list] of [['细杆 / 树干', targets.post], ['柱子', targets.pil]]) {
    let done = 0;
    for (const B of list) {
      if (done >= 2) break;
      const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
      for (const [nx, nz, face] of [[0, -1, B.minZ], [0, 1, B.maxZ], [-1, 0, B.minX], [1, 0, B.maxX]]) {
        let got = false;
        for (const gap of [0.6, 1.5, 3.0]) {
          // 车头朝 −n，叉尖离那一面 gap
          const fx = -nx, fz = -nz, yaw = Math.atan2(-fx, -fz);
          const tx = nx ? face + nx * gap : cx, tz = nz ? face + nz * gap : cz;
          const P = { x: tx - fx * 2.1, z: tz - fz * 2.1, yaw };
          const ok = await ev(page, a => !__sw.hits(a.x, a.z, a.yaw).length && Math.abs(BR.phys.groundY(a.x, a.z)) < 0.02, P);
          if (!ok) continue;
          await ltPlace(page, P);
          const r = await ev(page, a => {
            const S = __sw; if (!S.capture()) return null;
            // 朝车那一面（法线 n 朝车）正中、离地 0.5 / 1.0 / 1.6 m
            const cx = (a.B.minX + a.B.maxX) / 2, cz = (a.B.minZ + a.B.maxZ) / 2;
            const pts = [0.5, 1.0, 1.6].filter(y => y < a.B.maxY - 0.05).map(y => ({ x: a.nx ? a.face + a.nx * 0.003 : cx, y, z: a.nz ? a.face + a.nz * 0.003 : cz, n: [a.nx, 0, a.nz], d: 0.3 }));
            S.setOn(true); const on = S.lux(pts); S.setOn(false); const off = S.lux(pts); S.setOn(true);
            const k2 = __lt.k2();
            return { d: pts.map((q, i) => S.r(on[i] - off[i], 100)), zone: k2.nZone, zFail: k2.zFail.slice(0, 3), L: k2.L };
          }, { B, tx, tz, nx, nz, face });
          if (r) { res.push({ kind, gap, B: [S2(B.w), S2(B.d), S2(B.h)], r }); got = true; }
        }
        if (got) { done++; break; }
      }
    }
  }
  check('K1 (4) 正对独立立着的细杆 / 树干、正对柱子（断电，叉尖离它 0.6 / 1.5 / 3 m；门框立柱嵌在墙边，正对它就是正对墙，按 H8 / 墙的规矩）：朝车那一面 0.5 / 1.0 / 1.6 m 开关灯差都 ≥8，车前判定区照旧亮（' + res.length + ' 个位姿）',
    res.length >= 6 && res.every(q => q.r.d.every(d => d >= 8) && !q.r.zFail.length) && res.some(q => q.kind === '细杆 / 树干') && res.some(q => q.kind === '柱子'), res);
}
function S2(v) { return Math.round(v * 100) / 100; }

// ---------- K1：⑨ 那棵枯树（种子 12345，不断电，和 showOwner 那张同样亮着灯）----------
const TREE = { x: 8, z: -16, face: -16.17 };
async function gK1(browser) {
  const S = await ltSession(browser, 12345, { lit: true, vp: { width: 1280, height: 720 }, place: [8, -24.4, Math.PI], tag: 'k1' });
  const { page } = S;
  try {
    check('K1.0 坐上出生车（不断电）', S.mounted);
    const meas = async (g, lat) => {
      await ltPlace(page, { x: TREE.x + lat, z: TREE.face - g - 2.1, yaw: Math.PI });
      return ev(page, a => {
        const S = __sw; S.occl();
        const rc = new THREE.Raycaster(), pts = [];
        for (const y of [1.6, 1.0, 0.5]) {
          rc.set(new THREE.Vector3(a.x, y, a.face - 1.3), new THREE.Vector3(0, 0, 1)); rc.near = 0; rc.far = 2;
          const h = rc.intersectObjects(S._occ, false).filter(q => Math.hypot(q.point.x - a.x, q.point.z - a.z) < 0.25)[0];
          if (h) pts.push({ x: h.point.x, y: h.point.y, z: h.point.z - 0.004, n: [0, 0, -1], d: 0.3, tag: 'trunk' + y });
        }
        pts.push({ x: a.x, y: 0.002, z: a.face - 0.6, n: [0, 1, 0], d: 0.3, tag: 'ground0.6' });
        // 树干朝车那一面 0.3–1.6 m 每 0.1 m：最大通道（不发白）
        const wp = [];
        for (let y = 0.3; y <= 1.6 + 1e-6; y += 0.1) { rc.set(new THREE.Vector3(a.x, y, a.face - 1.3), new THREE.Vector3(0, 0, 1)); const h = rc.intersectObjects(S._occ, false).filter(q => Math.hypot(q.point.x - a.x, q.point.z - a.z) < 0.25)[0]; if (h) wp.push({ x: h.point.x, y: h.point.y, z: h.point.z - 0.004, n: [0, 0, -1], d: 0.3 }); }
        if (!S.capture()) return null;
        S.setOn(true); const on = S.lux(pts); const mx = __lt.luxMax(wp); const atOn = pts.map(q => BR.world.lightAt(q.x, q.z));
        S.setOn(false); const off = S.lux(pts); const atOff = pts.map(q => BR.world.lightAt(q.x, q.z)); S.setOn(true);
        const inf = S.sim().lightInfo;
        return { pts: pts.map((q, i) => [q.tag, S.r(on[i] - off[i], 100), S.r(atOn[i] - atOff[i], 1000)]), maxCh: Math.max(0, ...mx.map(m => m[1])), n: pts.length, L: S.lightNow().L, s: S.r(inf.s, 100) };
      }, { x: TREE.x, z: TREE.z, face: TREE.face });
    };
    // ⑨ 机位（车开到出口圈停住的地方：叉尖离树干 1.62 m）：驾驶座画面里树干那一片平均亮度和 pre-polish 旧图同一片比
    const r9 = await meas(1.62, 0);
    const cmp = await ev(page, async () => {
      BR.player.yaw = Math.PI; BR.player.pitch = -0.22; __br.step(1 / 60);
      const cv = __sw.grabMain(), W = cv.width, H = cv.height;
      // 旧图在 tests/output（gitignore）里：新克隆 / 换机器没有它 —— 读不到就用当时量下来的那个数（返修 FE1R · repair-r1，验收员 tests：以前 404 整组中断）
      const OLD_REF = 143.9;
      const img = new Image(); img.src = '/tests/output/showOwner-FE1/pre-polish/g1/09-exit-ahead.png';
      const okImg = await new Promise(res => { img.onload = () => res(true); img.onerror = () => res(false); });
      const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const g2 = c2.getContext('2d'); if (okImg) g2.drawImage(img, 0, 0, W, H);
      const a = cv.getContext('2d').getImageData(0, 0, W, H).data, b = g2.getImageData(0, 0, W, H).data, sx = W / 1280, sy = H / 720;
      let sa = 0, sb = 0, n = 0;
      // 树干那一列（旧图 x 630–650、y 270–440），避开旧图上的提示框和准心（HUD 那几行）
      for (let y = 270; y < 440; y++) { if ((y >= 296 && y <= 334) || (y >= 346 && y <= 374) || (y >= 384 && y <= 422)) continue; for (let x = 630; x <= 650; x++) { const i = (Math.round(y * sy) * W + Math.round(x * sx)) * 4; sa += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; sb += 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]; n++; } }
      return { now: Math.round(sa / n * 10) / 10, old: okImg ? Math.round(sb / n * 10) / 10 : OLD_REF, oldFrom: okImg ? 'pre-polish 旧图' : '记下的数（旧图不在）', n, png: cv.toDataURL('image/png') };
    });
    if (cmp.png) { fs.writeFileSync(path.join(OUT, 'k1-09-driver.png'), Buffer.from(cmp.png.split(',')[1], 'base64')); delete cmp.png; }
    check('K1.1 ⑨ 机位（叉尖离树干 1.62 m，不断电）：树干朝车那面 1.6 / 1.0 / 0.5 m、树前 0.6 m 地面开关灯差都 ≥8（' + (r9 ? r9.pts.map(q => q[0] + ' ' + q[1]).join('，') : '?') + '），lightAt 都算亮',
      !!r9 && r9.n === 4 && r9.pts.every(q => q[1] >= 8 && q[2] >= 0.01), r9);
    check('K1.2 ⑨ 机位驾驶座画面里树干那一片平均亮度 ' + cmp.now + '，pre-polish 旧图 ' + cmp.old + '（最多暗 8 级）', cmp.now >= cmp.old - 8, cmp);
    const rows = [];
    for (const lat of [0, 0.12, -0.12]) for (let g = 0.3; g <= 4.0 + 1e-6; g += 0.1) rows.push(Object.assign({ g: S2(g), lat }, await meas(g, lat)));
    const bad = rows.filter(r => !r.pts || r.n < 4 || r.pts.some(q => q[1] < 8)), white = rows.filter(r => !(r.maxCh < 245));
    check('K1.3 开车靠近枯树：叉尖离树 0.3–4.0 m 每 0.1 m、横偏 0 / ±0.12（' + rows.length + ' 个位姿），树干三点和树前地面都 ≥8（不达标 ' + bad.length + ' 个）', rows.length >= 110 && bad.length === 0, bad.slice(0, 8));
    check('K1.4 同上，树干上开灯后的像素最大通道 <245（最大 ' + Math.max(...rows.map(r => r.maxCh || 0)) + '，超标 ' + white.length + ' 个）', white.length === 0, white.slice(0, 6).map(r => [r.g, r.lat, r.maxCh, r.L]));
    fs.writeFileSync(path.join(OUT, 'k1-scan.json'), JSON.stringify(rows) + '\n');
    // 真键盘开过去（60 fps）：叉尖前地面相邻帧 ≤8 级、驾驶座画面下半区 ≤4 级
    const sm = await driveRoute(page, { id: 'tree', x: TREE.x, z: TREE.face - 5 - 2.1, yaw: Math.PI, sec: 3.0, keys: [[0, 3.0, ['KeyW']]] });
    check('K1.5 真键盘开向枯树（' + sm.n + ' 帧，60 fps，停在出口圈前）：叉尖前地面相邻帧差最大 ' + sm.maxGround + ' 级（≤8），驾驶座画面下半区 ' + sm.maxView + ' 级（≤4）', sm.n > 100 && sm.maxGround <= 8 && sm.maxView <= 4, sm);
  } finally { await S.ctx.close().catch(() => {}); }
}

// ---------- K2 (5) 平滑：12 条真键盘路线，60 fps 逐帧 ----------
const ROUTES = [
  { id: 'wallHead', name: '全速开向小屋西墙直到停住', x: 12, z: 18, yaw: -Math.PI / 2, sec: 4.5, keys: [[0, 4.5, ['KeyW']]] },
  { id: 'pillarSlalom', name: '主通道柱子间蛇行', x: 0.5, z: 30, yaw: 0, sec: 7, keys: [[0, 7, ['KeyW']], [0.5, 1.3, ['KeyA']], [1.8, 2.6, ['KeyD']], [3.1, 3.9, ['KeyA']], [4.4, 5.2, ['KeyD']], [5.7, 6.5, ['KeyA']]] },
  { id: 'laneExit', name: '窄道开出去', x: 3.45, z: 5.59, yaw: -Math.PI / 2, sec: 5, keys: [[0, 5, ['KeyW']]] },
  { id: 'turnInPlace', name: '柱子旁边打满方向转圈', x: 0.5, z: 14, yaw: 0, sec: 6, keys: [[0, 6, ['KeyW', 'KeyA']]] },
  { id: 'doorPass', name: '从小屋西墙外开过门口', x: 18.9, z: 21.4, yaw: 0, sec: 4, keys: [[0, 4, ['KeyW']]] },
  { id: 'aisle', name: '宽货架通道往前开', x: -12, z: 57.5, yaw: 0, sec: 5, keys: [[0, 5, ['KeyW']]] },
  { id: 'pillarHead', name: '正对柱子开过去', x: -4, z: 37.45, yaw: 0, sec: 3.55, keys: [[0, 3.55, ['KeyW']]] },
  { id: 'stackHead', name: '正对高堆垛开过去', x: 19.52, z: 14.4, yaw: Math.PI / 2, sec: 3.55, keys: [[0, 3.55, ['KeyW']]] },
  { id: 'rackHeadRun', name: '正对货架头开过去', x: 16, z: -2.26, yaw: Math.PI, sec: 3.55, keys: [[0, 3.55, ['KeyW']]] },
  { id: 'postHead', name: '正对门框立柱 / 杆子开过去', x: 11.72, z: 15.61, yaw: -Math.PI / 2, sec: 3.55, keys: [[0, 3.55, ['KeyW']]] },
  { id: 'wallAlong', name: '贴着承重墙外侧开（车侧离墙 0.5 m）', x: -14.5, z: 2.75, yaw: -Math.PI / 2, sec: 3.2, keys: [[0, 3.2, ['KeyW']]] },
  { id: 'wallAlong2', name: '贴着承重墙外侧开（车侧离墙 0.7 m）', x: -14.5, z: 2.55, yaw: -Math.PI / 2, sec: 3.2, keys: [[0, 3.2, ['KeyW']]] },
];
const LEV = [[0, 0], [0.05, 5.9], [0.1, 10.9], [0.2, 21.3], [0.3, 28.9], [0.5, 42.1], [0.75, 55], [1.0, 69.3], [1.5, 84.5], [2.0, 101.8], [3.0, 130], [8.0, 230]];
function levOf(E) { for (let i = 1; i < LEV.length; i++) if (E <= LEV[i][0]) return LEV[i - 1][1] + (LEV[i][1] - LEV[i - 1][1]) * (E - LEV[i - 1][0]) / (LEV[i][0] - LEV[i - 1][0]); return 230; }
// 一条路线：真键盘按 keys（[起, 止, [键…]]）开，60 fps 每帧：叉尖前 0.5 / 1.5 / 3 / 5 m 地面按大灯算的照度换成色阶（同一套 (1 − d/R)²·cosθ，
// 断电时的地面标定：0.1 ≈ 11 级、1 ≈ 69 级），只比两帧都在车前空地上（挡光体前 0.2 m 以内、离实体面 ≥0.3 m）的点；驾驶座画面下半区平均亮度
async function driveRoute(page, rt) {
  await releaseAll(page);
  // 路线开始前清掉怪（雷达见了人和怪会刹车，路线就白开了）
  // 「正对着某样东西开过去」的起点离它太近（排查时正对柱子那条一步都没开）：沿车尾方向退，退到前面有 ≥3 m 能开、起点不压东西
  rt = Object.assign({}, rt, await ev(page, a => {
    const f = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
    for (let back = 0; back <= 4.01; back += 0.5) {
      const x = a.x - f.x * back, z = a.z - f.z * back;
      if (__sw.hits(x, z, a.yaw).length) continue;
      const sw = __fp.sweep(x, z, a.yaw, 0, 3, __sw.pk, 0.1);
      if (!sw || back >= 4) return { x, z, back };
    }
    return { back: 0 };
  }, rt));
  await ev(page, a => { if (BR.entities && BR.entities.clear) { try { BR.entities.clear(); } catch (e) { /* 忽略 */ } } __sw.place(a.x, a.z, a.yaw); BR.player.pitch = -0.1; for (let j = 0; j < 30; j++) __br.step(1 / 60); return 0; }, rt);
  const rows = [], down = new Set(), N = Math.round(rt.sec * 60);
  for (let f = 0; f < N; f++) {
    const t = f / 60, want = new Set();
    for (const seg of rt.keys) if (t >= seg[0] && t < seg[1]) for (const c of seg[2]) want.add(c);
    for (const c of down) if (!want.has(c)) { await page.keyboard.up(c); down.delete(c); }
    for (const c of want) if (!down.has(c)) { await page.keyboard.down(c); down.add(c); }
    const r = await ev(page, () => {
      __br.step(1 / 60);
      const cv = __sw.grabMain(), r = __sw.frame(cv), p = BR.vehicles.byKey(__sw.k).pose, bd = __lt.blockDist(p);
      r.lh = __sw.meanLum(cv, 0, Math.round(cv.height / 2), cv.width, cv.height);
      r.ok = [0.5, 1.5, 3, 5].map(t => { const q = __sw.W(p, 0, 0, -2.1 - t); return t <= bd.d - 0.2 && !__lt.nearSolid(q.x, q.z, p.y || 0, 0.3); });
      return r;
    });
    r.f = f; r.lev = r.E.map(levOf); rows.push(r);
  }
  await releaseAll(page);
  let mg = 0, mh = 0, ex = null, exh = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    for (let j = 0; j < 4; j++) { if (!a.ok[j] || !b.ok[j]) continue; const d = Math.abs(b.lev[j] - a.lev[j]); if (d > mg) { mg = d; ex = { f: b.f, t: [0.5, 1.5, 3, 5][j], a: S2(a.lev[j]), b: S2(b.lev[j]), La: a.L, Lb: b.L } } }
    const dh = Math.abs(b.lh - a.lh); if (dh > mh) { mh = dh; exh = { f: b.f, a: a.lh, b: b.lh, La: a.L, Lb: b.L }; }
  }
  const last = rows[rows.length - 1] || {};
  let path = 0;
  for (let i = 1; i < rows.length; i++) path += Math.hypot(rows[i].x - rows[i - 1].x, rows[i].z - rows[i - 1].z);
  return { id: rt.id, n: rows.length, maxGround: S2(mg), maxView: S2(mh), ex, exh, start: { x: S2(rt.x), z: S2(rt.z), back: rt.back }, end: { x: last.x, z: last.z, spd: last.spd }, moved: S2(path) };
}
async function gSmooth(browser) {
  const S = await ltSession(browser, 12345);
  const { page } = S;
  try {
    check('S0 断电了、坐上了出生车', !!S.dark && S.mounted, S.dark);
    if (!S.dark || !S.mounted) return;
    for (const rt of ROUTES) {
      const r = await driveRoute(page, rt);
      check('S ' + rt.name + '（' + r.n + ' 帧，开了 ' + r.moved + ' m，≥0.8）：叉尖前 0.5 / 1.5 / 3 / 5 m 地面相邻帧差最大 ' + r.maxGround + ' 级（≤8），驾驶座画面下半区 ' + r.maxView + ' 级（≤4）',
        r.n > 100 && r.moved >= 0.8 && r.maxGround <= 8 && r.maxView <= 4, r);
    }
  } finally { await S.ctx.close().catch(() => {}); }
}

// ---------- L-workshop：工坊的全部熄灯 / 闪烁 / 亮度倍率不管大灯 ----------
async function gWs(browser) {
  for (const [name, ws] of [['全部熄灯', { blackout: true }], ['闪烁更频繁', { flicker: 'more' }], ['亮度 ×0.2', { lightMul: 0.2 }]]) {
    const S = await ltSession(browser, 12345, { workshop: ws, lit: true, tag: 'ws' });
    const { page } = S;
    try {
      check('W ' + name + '：工坊地图（基于 L1、种子 12345）开局、坐上车', S.mounted);
      if (!S.mounted) continue;
      await ltPlace(page, { x: -1, z: 32.6, yaw: -Math.PI / 2 });
      const m = await ev(page, () => __lt.k2());
      const L = await ev(page, () => { const L = __sw.L(), P = __sw.pool(); return { I: L && L.intensity, R: L && L.range, pool: P && { I: P.intensity, d: P.distance } }; });
      if (name === '全部熄灯') check('W 全部熄灯：大灯照常亮（灯池里那盏强度 ' + (L.pool ? L.pool.I.toFixed(2) : '?') + '），车前判定区 ' + m.nZone + ' 点开关灯差都 ≥8（最小 ' + m.zMin + '），lightAt 一致',
        !!L.pool && L.pool.I > 1 && Math.abs(L.pool.I - L.I) < 1e-6 && m.nZone > 5 && !m.zFail.length && !m.aFail.length, { L, m: { zFail: m.zFail, aFail: m.aFail } });
      else check('W ' + name + '：大灯照常亮（灯池里那盏强度 = 大灯自己的 ' + (L.I || 0).toFixed(2) + '，不乘倍率），lightAt 一致', !!L.pool && Math.abs(L.pool.I - L.I) < 1e-6 && !m.aFail.length, { L, m: { zFail: m.zFail, aFail: m.aFail } });
      if (name === '闪烁更频繁') {
        // 开 20 s（停着、真推模拟），每帧灯池里大灯那盏的强度
        const r = await ev(page, () => { let mx = 0, n = 0, prev = null; for (let i = 0; i < 600; i++) { __br.step(1 / 30); const P = __sw.pool(); if (!P) continue; n++; if (prev != null && prev > 0) mx = Math.max(mx, Math.abs(P.intensity - prev) / prev); prev = P.intensity; } return { n, mx }; });
        check('W 闪烁更频繁：开着灯停 20 s（' + r.n + ' 帧），大灯强度逐帧最大跳变 ' + (100 * r.mx).toFixed(2) + '%（≤10%）', r.n >= 590 && r.mx <= 0.1, r);
      }
      if (name === '亮度 ×0.2') {
        const base = await ev(page, () => { BR.workshop.deactivate(); const L = __sw.sim().lightSpot(); return L.intensity; });
        check('W 亮度 ×0.2：大灯强度和默认地图一样（' + (L.I || 0).toFixed(3) + ' / ' + base.toFixed(3) + '）', Math.abs(L.I - base) < 0.05 * base, { L, base });
      }
    } finally { await S.ctx.close().catch(() => {}); }
  }
}

// ---------- F1 / F3 / F4：升降货叉；F2：后轮打方向；F3：叉上的货开车 ----------
// 叉上放一件物资（同 tests/forklift.mjs putOnFork：最低顶点贴着叉面，挂到这台车的 riders 上）
function installFk() {
  const F = window.__lf = {};
  F.restLift = ty => { const r = BR.items.rest ? BR.items.rest(ty) : null; if (r) return -r.bot; const inf = BR.items.info(ty); return inf && typeof inf.bot === 'number' ? Math.max(-0.01, Math.min(0.05, -inf.bot)) : 0; };
  F.put = (k, id, type, lx, lz) => {
    const G = BR.L1forklift.geo, pose = BR.vehicles.byKey(k).pose, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    if (BR.items.find(id)) BR.items.remove(id);
    const p = BR.items.spawn(type, pose.x + c * lx + s * lz, surf + F.restLift(type), pose.z - s * lx + c * lz, { id, dropped: true, still: true });
    return !!p && BR.vehicles.attachItem(id, k);
  };
  F.note = k => { const s = BR.forklift.byKey(k); return s ? s.lastNote : null; };
  // _step 推 sec 秒（60 Hz），返回这段时间里出过的提示
  F.run = (k, inp, sec) => { const notes = new Set(); const s = BR.forklift.byKey(k); if (s) s.lastNote = null; for (let i = 0; i < Math.round(sec * 60); i++) { BR.vehicles._step(1 / 60, inp, k); const n = s && s.lastNote; if (n) notes.add(n); if (s) s.lastNote = null; } return Array.from(notes); };
  F.solidsBox = (pred) => { const L = []; for (const c of BR.world.chunks()) for (const s of (BR.phys.records(c.key).solids || [])) if (s.key === c.key && pred(s)) L.push({ minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY, minZ: s.minZ, maxZ: s.maxZ, ck: c.key }); return L; };
}
// 跟着升降的部件（货叉架、两根货叉、挡货架）和叉上货的顶点在不在 box 里（2 mm 容差）
async function liftPen(page, k, box, tol) {
  return ev(page, a => {
    const v = BR.vehicles.byKey(a.k), p = v.pose, V = __lt.modelVerts(a.k, p.steer, p.lift);
    const G = BR.L1forklift.geo;
    const car = __lt.penBox(V, p, a.box, a.tol, (lx, ly, lz) => lz < -1.0 && ly > (G.forkY || 0.015) - 0.01 + (G.carriageTravel || 2.6) * p.lift - 0.02);
    const items = [];
    for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) { const r = __lt.penW(__lt.itemVerts(id), a.box, a.tol); if (r.n) items.push(Object.assign({ id }, r)); }
    return { car, items, lift: __sw.r(p.lift, 10000) };
  }, { k, box, tol: tol == null ? 0.002 : tol });
}
async function gLift(browser) {
  const S = await ltSession(browser, 12345, { lit: true, tag: 'lift' });
  const { page, k } = S;
  try {
    await ev(page, installFk);
    check('F0 坐上出生车（不断电）', S.mounted);
    // F1：(8, 33.3)、yaw π，开进小屋门洞，按住 R 7 s
    await ev(page, a => { __sw.place(8, 33.3, Math.PI); return 0; }, {});
    await page.keyboard.down('KeyW'); await step(page, 2.5); await page.keyboard.up('KeyW'); await step(page, 0.3);
    const L0 = await ev(page, () => __lf.solidsBox(s => Math.abs(s.minY - 2.13) < 0.01 && Math.abs(s.maxY - 2.9) < 0.01 && s.minX < 8.6 && s.maxX > 7.4 && s.minZ > 36 && s.maxZ < 38)[0] || null);
    const notes = [];
    await page.keyboard.down('KeyR');
    for (let i = 0; i < 14; i++) { const n = await ev(page, () => { __br.step(0.5); const el = document.querySelector('.hud-drive-note'); return el && !el.hidden ? el.innerText : null; }); if (n && !notes.includes(n)) notes.push(n); }
    await page.keyboard.up('KeyR'); await step(page, 0.3);
    const pen1 = L0 ? await liftPen(page, k, L0) : null;
    const pz = await ev(page, () => __sw.r(BR.vehicles.byKey(__sw.k).pose.z, 1000));
    // 从屋里往门那面墙看（截图，看墙上有没有叉尖）
    const inside = await ev(page, () => { const S = __sw; S.aim({ x: 8, y: 1.62, z: 40.2 }, { x: 8, y: 2.2, z: 37 }); BR.gfx.render(0); return S.view().toDataURL('image/png'); });
    fs.writeFileSync(path.join(OUT, 'f1-inside.png'), Buffer.from(inside.split(',')[1], 'base64'));
    check('F1.1 种子 12345：车从 (8, 33.3) 朝 +z 开进小屋门洞（停在 z ' + pz + '），按住 R 7 s：货叉、货叉架顶点 0 个进门楣盒子（' + (pen1 ? pen1.car.n + ' 个，最深 ' + pen1.car.depth : '?') + '），提示「上面有门框，升不上去」',
      !!L0 && !!pen1 && pen1.car.n === 0 && notes.includes('上面有门框，升不上去') && pen1.lift > 0, { L0, pen1, notes, inside: 'f1-inside.png' });
    // 带货：叉尖上放两件，再顶门洞升
    await ev(page, a => { __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 3); __lf.put(a.k, 'f1c0', 'canned_tuna', -0.28, -2.0); __lf.put(a.k, 'f1c1', 'water_bottle', 0.28, -1.9); __br.step(0.2); return 0; }, { k });
    const n1b = await ev(page, a => __lf.run(a.k, { throttle: 0, steer: 0, lift: 1 }, 7), { k });
    const pen1b = L0 ? await liftPen(page, k, L0) : null;
    check('F1.2 叉尖放上两件货再顶着门洞升 7 s：货叉、货叉架、叉上货的顶点 0 个进门楣（车 ' + (pen1b ? pen1b.car.n : '?') + '，货 ' + (pen1b ? pen1b.items.length : '?') + '）', !!pen1b && pen1b.car.n === 0 && pen1b.items.length === 0, { pen1b, n1b });
    // 抽 ≥20 个抬高的静态碰撞体（门楣：y 2.13–2.9、1.16 × 0.2）复测：车身前脸离墙 2 cm 摆在门洞正前方，_step 升 7 s
    const lint = await ev(page, () => __lf.solidsBox(s => s.minY > 1.8 && s.minY < 2.5 && s.maxY - s.minY < 1.2 && Math.min(s.maxX - s.minX, s.maxZ - s.minZ) <= 0.35 && Math.max(s.maxX - s.minX, s.maxZ - s.minZ) <= 1.8));
    const rows = [];
    for (const Lb of lint) {
      if (rows.length >= 24) break;
      const r = await ev(page, a => {
        const L = a.L, alongX = (L.maxX - L.minX) > (L.maxZ - L.minZ), cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2;
        for (const sg of [1, -1]) {
          const nx = alongX ? 0 : sg, nz = alongX ? sg : 0, yaw = Math.atan2(nx, nz);
          const face = alongX ? (sg > 0 ? L.maxZ : L.minZ) : (sg > 0 ? L.maxX : L.minX);
          const d = 0.935 + 0.02, x = alongX ? cx : face + nx * d, z = alongX ? face + nz * d : cz;
          if (__sw.hits(x, z, yaw).length) continue;
          __sw.place(x, z, yaw);
          __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 0.5);
          const notes = __lf.run(a.k, { throttle: 0, steer: 0, lift: 1 }, 7);
          return { x, z, yaw, notes };
        }
        return null;
      }, { k, L: Lb });
      if (!r) continue;
      const pen = await liftPen(page, k, Lb);
      rows.push({ L: [S2(Lb.minX), S2(Lb.minZ)], ck: Lb.ck, pen: pen.car, lift: pen.lift, notes: r.notes });
    }
    const bad = rows.filter(q => q.pen.n > 0 || !q.notes.includes('上面有门框，升不上去'));
    check('F1.3 抽 ' + rows.length + ' 个门楣（抬高的静态碰撞体）：门洞前升 7 s，货叉 / 货叉架顶点都不进门楣、都提示「上面有门框」（不达标 ' + bad.length + ' 个）', rows.length >= 20 && bad.length === 0, { bad: bad.slice(0, 5), n: rows.length });
    // F3 (a)：在电缆底下升（种子 12345，电缆 y 2.28，x −9.22…−7.98、z −3.62…−3.58），叉上两件货
    await ev(page, a => { __sw.place(-8.6, -2, 0); __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 3); __lf.put(a.k, 'f3a0', 'canned_tuna', -0.28, -1.62); __lf.put(a.k, 'f3a1', 'water_bottle', 0.28, -1.62); __br.step(0.2); return 0; }, { k });
    const n3a = await ev(page, a => __lf.run(a.k, { throttle: 0, steer: 0, lift: 1 }, 8), { k });
    const cable = await ev(page, () => { for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.overhead) || [])) if (e.kind === 'cable' && e.minX < -8.6 && e.maxX > -8.6 && e.minZ < -3.5 && e.maxZ > -3.7) return { minX: e.minX, maxX: e.maxX, minZ: e.minZ, maxZ: e.maxZ, minY: e.y, maxY: e.y + 0.1 }; return null; });
    const pen3a = cable ? await liftPen(page, k, cable) : null;
    check('F3.1 电缆底下升货叉，叉上两件货：货、货叉的顶点进电缆 ≤2 mm（货 ' + (pen3a ? pen3a.items.map(q => q.depth).join('/') || 0 : '?') + '），停住并提示', !!cable && !!pen3a && pen3a.car.n === 0 && pen3a.items.length === 0 && n3a.some(t => /升不上去/.test(t)), { cable, pen3a, n3a });
  } finally { await S.ctx.close().catch(() => {}); }
}
async function gDrive(browser) {
  const S = await ltSession(browser, 12345, { lit: true, tag: 'drive' });
  const { page, k } = S;
  try {
    await ev(page, installFk);
    check('D0 坐上出生车（不断电）', S.mounted);
    // F3 (b)：货叉举着货往前开过电缆
    await ev(page, a => { __sw.place(-8.6, -0.6, 0); __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 3); __lf.put(a.k, 'f3b0', 'canned_tuna', -0.28, -1.62); __br.step(0.2); __lf.run(a.k, { throttle: 0, steer: 0, lift: 1 }, 0.1); return 0; }, { k });
    const cable = await ev(page, () => { for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.overhead) || [])) if (e.kind === 'cable' && e.minX < -8.6 && e.maxX > -8.6 && e.minZ < -3.5 && e.maxZ > -3.7) return { minX: e.minX, maxX: e.maxX, minZ: e.minZ, maxZ: e.maxZ, minY: e.y, maxY: e.y + 0.1, y: e.y }; return null; });
    // 举到货顶比电缆底高一点、货叉还在电缆下面（叉面 + 罐头高 > 2.28 > 叉面）
    const prep = await ev(page, a => {
      const G = BR.L1forklift.geo, k = a.k; let lift = 0;
      for (let i = 0; i < 400; i++) { const p = BR.vehicles.byKey(k).pose, surf = (G.forkY || 0.015) + (G.forkT || 0.04) + 2.6 * p.lift; if (surf > a.y - 0.06) break; BR.vehicles._step(1 / 60, { throttle: 0, steer: 0, lift: 1 }, k); }
      return __sw.r(BR.vehicles.byKey(k).pose.lift, 1000);
    }, { k, y: cable ? cable.y : 2.28 });
    const nb = await ev(page, a => __lf.run(a.k, { throttle: 0.6, steer: 0, lift: 0 }, 3), { k });
    const pen3b = cable ? await liftPen(page, k, cable) : null;
    check('F3.2 叉上举着货（货顶高过电缆底）往前开过电缆：货的顶点进电缆 ≤2 mm，车停住（' + (nb.join('；') || '无提示') + '）', !!cable && !!pen3b && pen3b.items.length === 0 && pen3b.car.n === 0, { cable, prep, pen3b, nb });
    // F3 (c)：叉尖放货去顶小屋西墙（种子 12345，x 20.8）
    await ev(page, a => { __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 4); __sw.place(17.2, 18.0, -Math.PI / 2); __lf.run(a.k, { throttle: 0, steer: 0, lift: -1 }, 1); __lf.put(a.k, 'f3c0', 'canned_tuna', -0.28, -2.06); __lf.put(a.k, 'f3c1', 'water_bottle', 0.28, -2.05); __br.step(0.2); return 0; }, { k });
    const nc = await ev(page, a => __lf.run(a.k, { throttle: 0.5, steer: 0, lift: 0 }, 3), { k });
    const wall = await ev(page, () => __lf.solidsBox(s => Math.abs(s.minX - 20.8) < 0.02 && s.minZ < 18 && s.maxZ > 18 && s.maxY > 2)[0] || null);
    const pen3c = wall ? await liftPen(page, k, wall) : null;
    check('F3.3 叉尖放两件货去顶小屋西墙：货的顶点进墙 ≤2 mm（' + (pen3c ? (pen3c.items.map(q => q.depth).join('/') || '0') : '?') + '），车身 / 货叉不进墙', !!wall && !!pen3c && pen3c.items.length === 0 && pen3c.car.n === 0, { wall, pen3c, nc });
    // F2：后轮。① 小屋西墙外 (20.195, 17.84)、yaw 0、离墙 1 cm；② 货架旁 (−25.765, 23.2)、yaw π：原地左右打满各 1.2 s
    for (const [nm, P] of [['小屋西墙外', { x: 20.195, z: 17.84, yaw: 0 }], ['货架旁', { x: -25.765, z: 23.2, yaw: Math.PI }]]) {
      const r = await ev(page, a => {
        const k = a.k; __sw.place(a.P.x, a.P.z, a.P.yaw); __lf.run(k, { throttle: 0, steer: 0, lift: -1 }, 0.5);
        const out = [];
        for (const st of [1, -1]) {
          const notes = __lf.run(k, { throttle: 0, steer: st, lift: 0 }, 1.2);
          const p = BR.vehicles.byKey(k).pose, V = __lt.modelVerts(k, p.steer, p.lift);
          const box = { minX: p.x - 2.5, maxX: p.x + 2.5, minZ: p.z - 2.5, maxZ: p.z + 2.5 };
          let worst = 0, n = 0;
          for (const s of __lf.solidsBox(q => q.maxX > box.minX && q.minX < box.maxX && q.maxZ > box.minZ && q.minZ < box.maxZ && q.minY < 0.5)) {
            const r = __lt.penBox(V, p, s, 0.002, (lx, ly, lz) => lz > 0.4 && ly < 0.5);
            n += r.n; worst = Math.max(worst, r.depth);
          }
          out.push({ steer: __sw.r(p.steer, 1000), notes, n, worst, x: __sw.r(p.x, 1000), z: __sw.r(p.z, 1000) });
          __lf.run(k, { throttle: 0, steer: 0, lift: 0 }, 1.0);
        }
        return out;
      }, { k, P });
      check('F2 ' + nm + '：原地往左 / 往右打满 1.2 s，后轮顶点 0 个进静态碰撞体（2 mm 容差；' + r.map(q => '转到 ' + q.steer + '，' + q.n + ' 个，' + (q.notes.find(t => /后轮/.test(t)) || '无提示')).join('；') + '）', r.every(q => q.n === 0), r);
    }
    // F2：货架通道里贴着货架慢速转弯（种子 12345 窄道，车右侧离货架 0.15 m，前进 0.3、往右打满 3 s）
    const rr = await ev(page, a => {
      // 窄道：货架在 +z 一侧（近面 z 6.84），车头朝 +x、右侧离货架 0.06 m（比后轮打满伸出车身的 8.7 cm 近）；往右打慢慢开（车头往货架那边拐，
      // 两只后轮一转就往两边伸出来，右后轮贴着货架）。往左打车尾往货架甩，模拟本来就不让开（「车尾会往外甩」）
      const k = a.k; __sw.place(3.45, 6.84 - 0.06 - 0.595, -Math.PI / 2);
      const pp = BR.vehicles.byKey(k).pose, P0 = { x: pp.x, z: pp.z }; let n = 0, worst = 0, steps = 0; const notes = new Set();   // pose 是活的，先抄下来
      for (let i = 0; i < 180; i++) {
        BR.vehicles._step(1 / 60, { throttle: 0.3, steer: -1, lift: 0 }, k); const s = BR.forklift.byKey(k); if (s && s.lastNote) notes.add(s.lastNote);
        if (i % 6) continue; steps++;
        const p = BR.vehicles.byKey(k).pose, V = __lt.modelVerts(k, p.steer, p.lift);
        for (const so of __lf.solidsBox(q => q.maxX > p.x - 3 && q.minX < p.x + 3 && q.maxZ > p.z - 3 && q.minZ < p.z + 3 && q.minY < 0.5)) { const r = __lt.penBox(V, p, so, 0.002, (lx, ly, lz) => lz > 0.4 && ly < 0.5); n += r.n; worst = Math.max(worst, r.depth); }
      }
      const p = BR.vehicles.byKey(k).pose;
      return { steps, n, worst, moved: __sw.r(Math.hypot(p.x - P0.x, p.z - P0.z), 100), notes: Array.from(notes) };
    }, { k });
    check('F2 货架通道里贴着货架（车侧离货架 6 cm）往右慢慢拐 3 s（开了 ' + rr.moved + ' m）：后轮顶点 0 个进货架（' + (rr.notes.join('；') || '无提示') + '）', rr.n === 0 && rr.moved > 0.2, rr);
    // F2：后轮旁边地上的物资不被轮胎扫进去
    const ri = await ev(page, a => {
      const k = a.k; __sw.place(0.5, 14, 0); __lf.run(k, { throttle: 0, steer: 0, lift: 0 }, 0.3);
      const p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = 0.69, lz = 0.8;
      if (BR.items.find('f2item')) BR.items.remove('f2item');
      BR.items.spawn('water_bottle', p.x + c * lx + s * lz, 0, p.z - s * lx + c * lz, { id: 'f2item', dropped: true, still: true });
      __br.step(0.2);
      const notes = __lf.run(k, { throttle: 0, steer: -1, lift: 0 }, 1.2);
      const q = BR.vehicles.byKey(k).pose, V = __lt.modelVerts(k, q.steer, q.lift), W = __lt.itemVerts('f2item');
      // 物资顶点在不在后轮那块（车本地 x 0.3–0.75、z 0.5–1.1、y < 0.5）的模型包围里：简单按两两最近距离
      const cc = Math.cos(q.yaw), ss = Math.sin(q.yaw), wheel = V.filter(v => v[2] > 0.4 && v[1] < 0.5 && v[0] > 0.2).map(v => [q.x + cc * v[0] + ss * v[2], v[1], q.z - ss * v[0] + cc * v[2]]);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const w of W) { minX = Math.min(minX, w[0]); maxX = Math.max(maxX, w[0]); minY = Math.min(minY, w[1]); maxY = Math.max(maxY, w[1]); minZ = Math.min(minZ, w[2]); maxZ = Math.max(maxZ, w[2]); }
      const inside = wheel.filter(w => w[0] > minX + 0.002 && w[0] < maxX - 0.002 && w[1] > minY + 0.002 && w[1] < maxY - 0.002 && w[2] > minZ + 0.002 && w[2] < maxZ - 0.002).length;
      return { steer: __sw.r(q.steer, 1000), notes, inside, item: BR.items.find('f2item') && { x: __sw.r(BR.items.find('f2item').x), z: __sw.r(BR.items.find('f2item').z) } };
    }, { k });
    check('F2 右后轮旁边地上放一瓶水（车本地 x 0.69、z 0.8），往右打满 1.2 s：后轮顶点 0 个进物资（' + (ri.notes.find(t => /后轮/.test(t)) || '无提示') + '，转到 ' + ri.steer + '）', ri.inside === 0, ri);
    // F2：站在后轮旁边的人（测试人当队友，钉在原地）：往右打满 1.2 s，后轮不扫进他的身体（竖直圆柱）
    const rp = await ev(page, a => {
      const k = a.k; __sw.place(0.5, 14, 0); __lf.run(k, { throttle: 0, steer: 0, lift: 0 }, 0.3);
      const p = BR.vehicles.byKey(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const e = BR.entities.spawn('test_dummy', p.x, undefined, p.z, { force: true, yaw: 0 });
      if (!e) return null;
      const r = +e.r || 0.4, lx = 0.6 + r + 0.01, lz = 0.8, wx = p.x + c * lx + s * lz, wz = p.z - s * lx + c * lz;
      const notes = new Set(), sim = BR.forklift.byKey(k), G = BR.forklift.geo;
      let worst = 0;
      for (let i = 0; i < 72; i++) {
        e.x = wx; e.z = wz; if (e.obj) e.obj.position.set(wx, e.obj.position.y, wz);
        BR.vehicles._step(1 / 60, { throttle: 0, steer: -1, lift: 0 }, k);
        if (sim.lastNote) notes.add(sim.lastNote);
        // 两只后轮（按此刻的转角转好的轮胎盒）离人的圆心：压进去多深
        const q = BR.vehicles.byKey(k).pose, cc = Math.cos(q.yaw), ss = Math.sin(q.yaw);
        for (const sg of [-1, 1]) {
          const W = G.wheelRear, ox = q.x + cc * sg * W.x + ss * W.z, oz = q.z - ss * sg * W.x + cc * W.z, rot = q.yaw + q.steer;
          const cr = Math.cos(rot), sr = Math.sin(rot), dx = wx - ox, dz = wz - oz, lx2 = dx * cr - dz * sr, lz2 = dx * sr + dz * cr;
          const ex = Math.max(0, Math.abs(lx2) - W.w / 2), ez = Math.max(0, Math.abs(lz2) - W.r), d = Math.hypot(ex, ez);
          worst = Math.max(worst, r - d);
        }
      }
      const out = { r, steer: __sw.r(BR.vehicles.byKey(k).pose.steer, 1000), pen: __sw.r(worst, 10000), notes: Array.from(notes) };
      if (typeof BR.entities.remove === 'function') BR.entities.remove(e.id);
      return out;
    }, { k });
    check('F2 测试人（当队友）站在右后轮旁边，往右打满 1.2 s：后轮不扫进他的腿（压进 ' + (rp ? (rp.pen * 100).toFixed(1) + ' cm' : '?') + '，≤0.2 cm；' + (rp ? (rp.notes.find(t => /后轮/.test(t)) || '无提示') : '') + '）', !!rp && rp.pen <= 0.002, rp);
    // F4：降货叉。车轮挡（种子 12345，0.12 高、0.18 深、1.6 长）放在旧的两条射线中间、叉尖下、叉根下、货叉侧边下：降到底货叉底在车轮挡顶以上 0–2 cm，0 个顶点进车轮挡
    const ch = await ev(page, () => __lf.solidsBox(s => s.minY < 0.01 && Math.abs(s.maxY - 0.12) < 0.005 && Math.abs((s.maxZ - s.minZ) - 0.18) < 0.01 && Math.abs((s.maxX - s.minX) - 1.6) < 0.01).sort((a, b) => Math.hypot(a.minX - 37.5, a.minZ - 13.4) - Math.hypot(b.minX - 37.5, b.minZ - 13.4))[0] || null);
    const rows = [];
    if (ch) {
      const cz = (ch.minZ + ch.maxZ) / 2, cx = (ch.minX + ch.maxX) / 2;
      // 车朝 −z（yaw 0）：货叉本地 z 落在车轮挡中线上的那一点；侧边下：车横过来（yaw π/2）货叉侧边压在车轮挡端头上方
      for (const [nm, lz, yaw, dx] of [['两条射线中间', -1.84, 0, 0], ['叉尖下', -2.08, 0, 0], ['叉根下', -1.2, 0, 0], ['货叉侧边下', -1.6, 0, 0.8 - 0.33 + 0.01]]) {
        const P = { x: cx + dx, z: cz - lz, yaw };
        const r = await ev(page, a => {
          const k = a.k; __sw.place(a.P.x, a.P.z, a.P.yaw);
          __lf.run(k, { throttle: 0, steer: 0, lift: 1 }, 0.6);
          const notes = __lf.run(k, { throttle: 0, steer: 0, lift: -1 }, 3);
          const p = BR.vehicles.byKey(k).pose, G = BR.L1forklift.geo, V = __lt.modelVerts(k, p.steer, p.lift);
          const bottom = (G.forkY || 0.015) + 2.6 * p.lift;
          const pen = __lt.penBox(V, p, a.ch, 0.0005);
          return { lift: __sw.r(p.lift, 10000), forkBottom: __sw.r(bottom, 10000), gap: __sw.r(bottom - a.ch.maxY, 10000), pen, notes };
        }, { k, P, ch });
        rows.push(Object.assign({ nm }, r));
      }
    }
    check('F4 车轮挡在旧的两条射线中间 / 叉尖下 / 叉根下 / 货叉侧边下：降到底货叉底停在车轮挡顶以上 0–2 cm、0 个顶点进车轮挡（' + rows.map(q => q.nm + ' ' + (q.gap * 100).toFixed(1) + ' cm').join('，') + '）',
      rows.length === 4 && rows.every(q => q.gap >= -0.0005 && q.gap <= 0.02 && q.pen.n === 0), { ch, rows });
    // 排查机位复测：(37.5, 15.24)、yaw 0、lift 0.12，按住 C 3 s（真键盘）
    await ev(page, a => { __sw.place(37.5, 15.24, 0); __lf.run(a.k, { throttle: 0, steer: 0, lift: 1 }, 0.12 * 2.6 / 0.45); return 0; }, { k });
    await page.keyboard.down('KeyC'); await step(page, 3); await page.keyboard.up('KeyC'); await step(page, 0.3);
    const r4 = ch ? await ev(page, a => { const p = BR.vehicles.byKey(a.k).pose, G = BR.L1forklift.geo, V = __lt.modelVerts(a.k, p.steer, p.lift); return { lift: __sw.r(p.lift, 10000), gap: __sw.r((G.forkY || 0.015) + 2.6 * p.lift - a.ch.maxY, 10000), pen: __lt.penBox(V, p, a.ch, 0.0005) }; }, { k, ch }) : null;
    check('F4 排查机位 (37.5, 15.24)、yaw 0、按住 C 3 s：货叉停在车轮挡顶以上 0–2 cm（' + (r4 ? (r4.gap * 100).toFixed(1) + ' cm' : '?') + '），0 个顶点进车轮挡', !!r4 && r4.gap >= -0.0005 && r4.gap <= 0.02 && r4.pen.n === 0, r4);
  } finally { await S.ctx.close().catch(() => {}); }
}

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
