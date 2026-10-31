// 后室 · L1 叉车驾驶回归（方案 2026-10-06「叉车驾驶提前版」FE1）：
//   node tests/forklift.mjs [--group data,mount,…] [--shots] [--verbose]
// 起本地静态服务（随机端口）+ 系统 Chrome（SwiftShader），page.route 拦截 api.ovobot.ai 回假响应、其余外站一律掐掉
// （测试绝不连真实联机服务器）。单机进 L1：__br.start + __br.setAuto(false) + __br.step 精确推进模拟时间，键盘走 page.keyboard
// （和 tests/interact.mjs 一样），测试口只用 BR.vehicles._step / debugInfo / list / setPose、BR.forklift.state 和现有的 __br 钩子。
//
// 按组拆，每组一个新的浏览器上下文，组和组之间没有依赖；可以开几个进程分组并行跑（输出各写各的目录）：
//   data       种子 12345：出生柱间叉车 (16.4, 16.91)、停着是 14 个 OBB（原外接 AABB 不在了）、四周 24 个方向走过去被挡时离模型表面 ≤7 cm、
//              货叉前方走过去被货叉挡住、货叉范围里的物资重载区块后 1 帧内推出；保底种子（取 tests/forklift_l1.mjs 的 HIGH_TRI）
//              出生柱间有车，tiers 高画质 'mid'、低画质 'drvLow'
//   mount      上车提示（侧面「空格 上车」、货叉前 / 车尾「绕到侧面上车」、2 m「再走近一点」）、长按「叉车太重，拖不动」车不动、
//              短按 0.6 s 内进 drive、眼点误差 <2 cm、插值途中相机不进车身 OBB、起动 0.8 s 内按 W 不动、常驻提示行逐字、整页不出现 E
//   drive      W 2 s 到 4.5±0.2、松开 2 s 内停、倒车 2.5±0.1 且 fk_reverse 在播、满舵绕圈车尾外角半径和理论值差 ≤10%、
//              按 A 车头往左、满舵限速 ≤1.4、货叉 0.6 m 限 ≤1.05 / 1.6 m 限 ≤0.65、细节档（高画质 high/mid/lite，低停放档 → lite；低画质 drvLow）
//   crash      柱子 / 货架 / 小屋墙 / 门框各撞 5 次（重叠 <1 cm、fk_bang）、小屋门开不进去、车轮挡开不过去、雷达 1.4 m 刹 / 1.6 m 能走、
//              推开地上瓶子且瓶子不进 OBB、贴墙：车尾外甩提示 / 打方向倒车 3 s 离墙 ≥0.3 m / 直开沿墙 ≥2 m；
//              C10 右叉推着地上的蛾子果冻全速撞小屋墙：「哐」不是「咚」、镜头抖，果冻夹在叉尖和墙之间、贴着墙（≤2 cm，车一路推到墙跟前才停），
//              叉上两只罐头照撞车掉货的规则甩出去，每一帧不穿货叉、车身、墙和别的物资（果冻）
//   side       车身高度上伸出来、没有碰撞体的东西（b.data.sideObs：柱脚、护角、消火栓箱、纸箱、地牛、灭火器、门扇、路锥、砂堆、走廊口管排 / 笼罩灯）：
//              出生块柱子都有柱脚 / 护角、条目合法；全速撞上去停在跟前、OBB 压进去 <1 cm、有「咚 / 哐」；贴墙开过消火栓箱被挡住；货叉在箱底下升不上去
//              （「上面有消火栓箱，升不上去」）；货叉在路锥上方降不下去（「货叉下面有东西」）；走廊口沿中线开到出口圈前、偏管排 / 偏灯被挡住；
//              S12 / S12b 斜放的地牛、纸箱和路锥、砂堆按真实形状挡车：偏心 0.3–0.6 m 开过去，被挡住时离真实形状 ≤5 cm、不停在空地上；
//              S12c 斜放的地牛：4 个方向、正对和偏心全速开过去，都贴着地牛的真实形状停下（那块 1 m 老碰撞体不再挡车）；
//              S12d 叉上两只罐头全速撞斜放的地牛：没有一只落进那块老碰撞体（人和准心照旧被它挡），落地的都能「空格 拾取」
//   lift       R 1 s 升 0.45±0.03、inner = carriage/2、杆 >0.3、松开即停、C 到底 fk_end；管子下升不上去（离管底 1–3 cm、提示、fk_strain）、
//              举着往管子底下开会停；货叉下有人 / 有瓶子停在上面并提示；花园段藤蔓每帧不进护顶 / 门架 / 胸口 +0.1 m、离开 2 s 逐位恢复
//   items      单机货叉上丢罐头：叉面 ±1 cm、跟着升 0.45、开 3 m 相对误差 <1 cm、降到底还在叉面上；两叉中间、叉面 1.6 m 时落地；
//              走开 4 块、离开这一层再回来还在；降到底能捡；I17 站在原地往同一根货叉上连丢：沿货叉排开不叠（两两隔两件模型半径之和），
//              离瞄准点都不超过 15 cm；那附近放不下了再丢：东西落在这根货叉旁边的地上（返修 r5 裁定 ③），这根货叉别处还空着提示
//              「这一段叉面满了，东西放到旁边地上了，叉尖 / 靠车那头还空着」（不出现「放不下」）；I17d 对着叉尖连丢，第三只「…，靠车那头还空着」；
//              I17c 整根货叉摆满再丢「这根货叉摆满了，东西放到旁边地上了」，两边地上也满了「这根货叉摆满了，旁边地上也放不下」、留在手里
//              （返修 r6 裁定 ⑤：只在真的放不下时才说放不下；都查显示时长 ≥ 每秒 6 个字、≥3 s）；
//              全速撞车掉货（家长定的规则，返修 r5 裁定 ①：一件不留）：I12 撞前 ≥2 m/s 的「哐」甩到叉尖前方 0.2–0.5 m 落地、写进本层状态，逐帧不穿东西、在叉面高度时
//              不悬在叉尖外面（圆心过叉尖 ≤0.3 个模型半径）、不往回退、横着不越过叉沿 0.3 个模型半径，落地 still 不弹；I12b 换层回来还在、还躺着；
//              I12c 叉面 0.5 m 撞同一个车轮挡（叉面最高的一档，落点只看车速）；I12d 真开边开边升，撞上时叉面 ≥0.62 m、≥2 m/s 照样往前甩（裁定 ②）；
//              I12e 同一根货叉前后两件、另一根一件：三件都往前落在 0.2–0.5 m、两两不叠；I12f 撞上那一刻起一直按住「升」：甩出去的还在叉面上时货叉不动，
//              都落地以后按 S 照常倒出来；
//              I12g 撞上那一刻起按住 S / S + A、I12h 真键盘撞上就倒车：还有东西在叉面上时车刹住不动（「货叉上的东西还在往下掉」），都离开叉面才倒出去（返修 r6）；
//              I19 同一根货叉 2 / 4 / 8 件全速、I19 低速（撞前 2.05 和 2.1 m/s）4 / 8 件撞向空地：一件不留、往前落的一件比一件近、左右错开、两两不叠不穿、算轨迹 ≤20 ms
//              （返修 r7：全速 8 件的最后两件、低速 4 件以后可以从自己旁边的叉边下去，照样不比前一件远）；
//              I19b 两根货叉各 10 瓶水：一件不留、throws 记 20 件（返修 r6）；I19c 同样 20 瓶水、撞前 2.5 m/s（返修 r7）；
//              I12e / I12g / I14d / I19 / I19b / I19c 还查每件一路匀速滑出叉尖（不停下再冲出去），翻下去以后的水平速度是在叉面上的 0.6–1.5 倍、哪一帧都不突然跳一下（返修 r7 裁定 ②），
//              和这一批的总时长 throws[i].dur ≤2.5 s（返修 r6 裁定 ①），撞向空地的 I19 / I19 低速 / I19b / I19c ≤1.5 s（返修 r7：裁定 ① 的目标）；
//              I17b 站在原地连丢三次再撞：一件不留；I13 慢慢碰上（「咚」）、I13b 1.5 m/s 的「哐」不掉；I14 货叉顶着柱子全速撞：落在柱子跟前、不穿柱子不进车、逐帧查；
//              I14b 叉尖顶着带柱础的方柱（验收员 pillarR1）：地上落不了，罐头、水瓶都整个稳稳落在柱础顶上（how 带 '-top'，返修 r6 裁定 ④），一件不留；
//              I14c 叉尖上只有一只蛾子果冻再撞：哪儿都放不稳，一件都没甩出去，throws 照样记一条（list 空、how 写明原因）；
//              I14d 同一根柱子，右叉按往货叉上丢时的间隔前后两瓶水、再来一趟左 4 罐右 4 瓶：一件不留（返修 r7，验收员 spec 的 pscan）；I15 倒车撞上不掉；
//              I16 叉面 0.5 m 真开撞小屋墙（叉尖顶墙：从叉边滑下去贴着墙落地，同一根货叉上后面那件不比前一件远）、I16b 叉面 1.2 m 和满升真开（限速到不了 2 m/s，不甩）、
//              I16c 1.2 m 和满升把撞前车速设成 3.9 m/s 查轨迹；I18 叉面 0.5 m 用车头撞纸箱、叉尖离货架 20–30 cm：三件一件不留，逐帧不穿东西。
//              I12 系列、I14、I16 / I16c、I17b、I18、I19、C10 每帧都查 __fk.hover（返修 r5 加了横着越过叉沿那条；返修 r7：圆心过了 0.3 个模型半径以后
//              「翻下去」那一小段允许走到模型半径 + 2.4 cm，每帧都要接着往外走、最多 9 帧）
//   exits      朝出口开：OBB 不进出口圈 +0.4、「前面是出口」、3 s 不换层；看哪边从哪边下、一边挡住换边、两边挡住车尾、三面挡住提示并留在车上；
//              三面挡住时死亡：人落在空地（不在 OBB、出口圈）；下车落点不在出口圈；3 m/s 按空格 0.6 s 内停住下车
//   life       下车写 levelState.vehicles（没有 d、w）、货叉高度保留、「货叉还举着」只说一次；走开 4 块网格段释放、'veh|' OBB 还在；
//              回来 / 换层回来位姿 <1 mm、原位置网格段藏掉、原位置没碰撞；死在车上回到 walk；回主页车回原位；工坊编辑态没有 vehicle 候选
//   pause      单机暂停 2 s 车和货叉不动；输入被关掉（联机暂停 / 结算 / 切后台走的同一条 null 输入路径）3 m/s 0.6 s 内停住、
//              货叉不动、雷达照常；单机切后台（visibilitychange）时整局暂停、车不动
//   nightmare  噪音（怠速 ≈0.25、行驶 ≥0.6、倒车 ≥0.8）、车侧 6 m 的敌对 3 s 内发现坐着的人、车尾 1 m 打得到、货叉尖外 0.3 m 打不到且 10 s 内绕到车侧、
//              开过未密封水坑不掉理智
//   dark       L1 断电：车前 4 m 地面亮度 ≥ 断电环境 3 倍（灯池里有大灯）、车尾 2 m ≤1.5 倍、顶墙时光源在墙前 0.3 m 且墙另一侧 2 m ≤1.2 倍；
//              下车大灯撤掉、灯罩是暗色不开洞；仪表台大灯开关（家长定的规则，在下一次断电里试）：K9 点火默认开、司机在 lightAt 里被照亮；
//              K8 断电途中上车提示叉车那句（K8b 断电开始时就坐在开着大灯的车上也是那句）；K7 准心对准开关「空格 关大灯」，按了撤灯、lightAt 回到底值、人还在车上，
//              再按打开；K10 关着下车、换层回来还关着，点火也不亮；K11 手机「下车」键对着开关时写「关大灯 / 开大灯」，移开恢复；
//              K11b 手机上坐在亮灯的车上断电：提示是手机那句（点「关大灯」键，不出现「空格」），按每秒 6 字给时长，只说一次；
//              K11c 360×640 竖屏上这句里的「关大灯」整个在一行里（不拆成「关 / 大灯」）
//   perf       每台可动叉车 ≤2000 面；载具网格 calls 高 ≤3 / 低 ≤2（1 台、6 台一样）；停放档 high/mid/lite 停着和升格（熄火）同机位像素差 <2；
//              开着车 + 5 台开过的车 calls ≤120（高低画质）；_step 1000 步平均 ≤0.6 ms；新音效离线渲染无 NaN、峰值 <0 dBFS
//   --shots    各组额外存几张佐证截图（dark、perf 本来就要截图量像素，不受影响）
// 每个 page.evaluate 记下用了多久，汇总前打一行「最慢的 page.evaluate」（返修 r6 裁定 ⑥：单次不超过 60 s；撞车那几段用 __fk.crashGen 每次最多推 30 帧）
//   --sub      items 组只跑其中几段：stack（I17 系列）、field（I12d–I12h、I19、I19b、I19c、I17b、I14b / I14c / I14d）、throw（I12–I15 和 field）、high（I16 系列）、carton（I18）
// 每组的数值和截图写 tests/output/forklift/<组>/；汇总行「检查 N 项，失败 M 项」「页面报错 K 条」（tests/all.mjs 按它判定）。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_BASE = path.join(ROOT, 'tests', 'output', 'forklift');
const argv = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ALL_GROUPS = ['data', 'mount', 'drive', 'crash', 'side', 'lift', 'items', 'exits', 'life', 'pause', 'nightmare', 'dark', 'perf'];
const GROUPS = argOf('group') ? argOf('group').split(',').map(s => s.trim()).filter(Boolean) : ALL_GROUPS.slice();
const SHOTS = argv.includes('--shots');
// --sub stack,field,throw,high,carton：items 组只跑这几段（调试用，自动跑全套时不带）。field = I12d–I12h、I19、I19b、I17b、I14b / I14c（撞车轮挡那条直道上的甩货，加柱础那根柱子）
const SUB = argOf('sub') ? argOf('sub').split(',').map(x => x.trim()).filter(Boolean) : null;
const VERBOSE = argv.includes('--verbose');
const SEED = 12345;
const SPEC_DRIVE_DESK = 'W/S 前进后退 · A/D 打方向 · R 升货叉 · C 降货叉 · 空格 下车 · F 吃喝';
const NO_E = s => !/(^|[^A-Za-z])E([^A-Za-z]|$)/.test(String(s || ''));
// 保底种子：tests/forklift_l1.mjs 的 HIGH_TRI（「进柱间时 triCount ≥7300」，出生柱间一定是保底车）。读不到就用 85
function fallbackSeeds() {
  try {
    const s = fs.readFileSync(path.join(ROOT, 'tests', 'forklift_l1.mjs'), 'utf8');
    const m = /const HIGH_TRI\s*=\s*\[([^\]]*)\]/.exec(s);
    const a = m ? m[1].split(',').map(x => +x.trim()).filter(x => x > 0) : [];
    if (a.length) return a;
  } catch (e) { /* 用缺省 */ }
  return [85];
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
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- 记录 ----------
let pass = 0, fail = 0, GROUP = '';
const failed = [];
const errors = [];
const data = {};
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failed.push('[' + GROUP + '] ' + name); }
  let d = detail === undefined ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  if (d.length > 1400) d = d.slice(0, 1400) + '…';
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + GROUP + '] ' + name + (d && (!ok || VERBOSE || d.length < 240) ? '  ' + d : ''));
  (data[GROUP] = data[GROUP] || []).push({ name, ok: !!ok, detail });
}
function info(text, detail) {
  console.log('INFO [' + GROUP + '] ' + text + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1200) : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EV_TIMEOUT = 120000;
// 每个 page.evaluate 用了多久（返修 r6 裁定 ⑥：过大的拆成每次最多推 30 帧，单次不超过 60 s）：记下最慢的 8 个，汇总前打出来
const EV_SLOW = [];
function evNote(fn, ms) {
  if (EV_SLOW.length >= 8 && ms <= EV_SLOW[EV_SLOW.length - 1].ms) return;
  EV_SLOW.push({ ms, group: GROUP, fn: String(fn).replace(/\s+/g, ' ').slice(0, 90) });
  EV_SLOW.sort((a, b) => b.ms - a.ms);
  if (EV_SLOW.length > 8) EV_SLOW.length = 8;
}
// page.evaluate 本身没有超时：页面卡死时整个测试会无限挂住，这里超时就抛错，让这一组记 FAIL 继续往下
function ev(page, fn, arg) {
  let timer = 0;
  const t0 = Date.now();
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('page.evaluate 超过 ' + EV_TIMEOUT / 1000 + ' 秒没返回')), EV_TIMEOUT); }),
  ]).finally(() => { clearTimeout(timer); evNote(fn, Date.now() - t0); });
}
const step = (page, s) => ev(page, x => { __br.step(x); return 0; }, s);
// 全速撞一次（__fk.crashGen）：start 是页面里调 __fk.crashStart(…) 的函数（o.liftAt 这种回调只能在页面里写），之后每次 __fk.crashMore() 最多推 30 帧，
// 一个 page.evaluate 不会因为机器忙推几百帧超过 EV_TIMEOUT（返修 r6）
async function crashRun(page, start, arg) {
  let r = await ev(page, start, arg);
  while (!r.done) r = await ev(page, () => __fk.crashMore());
  return r.value;
}
// 按住一个键 sec 秒（模拟时间），松开后再走一小步让 input 看到松开
async function hold(page, code, sec) { await page.keyboard.down(code); await step(page, sec); await page.keyboard.up(code); await step(page, 1 / 30); }
async function holdKeys(page, codes, sec) { for (const c of codes) await page.keyboard.down(c); await step(page, sec); for (const c of codes) await page.keyboard.up(c); await step(page, 1 / 30); }
async function tap(page, code) { await page.keyboard.down(code); await step(page, 0.1); await page.keyboard.up(code); await step(page, 1 / 30); }
async function releaseAll(page) { for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'Space', 'ShiftLeft', 'KeyQ']) { try { await page.keyboard.up(c); } catch (e) { /* 忽略 */ } } }
let OUT = OUT_BASE;
async function shot(page, name, force) {
  if (!SHOTS && !force) return null;
  const f = path.join(OUT, name + '.png');
  try { await page.screenshot({ path: f }); console.log('     shot ' + path.relative(ROOT, f)); return f; }
  catch (e) { console.log('     shot 失败 ' + name + ' ' + e.message); return null; }
}

// =====================================================================
// 页面里的工具（每个页面装一次）：window.__fk
// =====================================================================
function installHelpers() {
  const F = window.__fk = { notes: [], toasts: [], toastMs: [], sounds: [], loopLog: [], loopsOn: {}, extra: {}, dmg: [], ev: [] };
  const H = BR.hud, A = BR.audio, W = BR.world;
  // 提示：toast 和开车状态行（driveNote）都记下来
  if (H && typeof H.toast === 'function') { const o = H.toast; H.toast = function (t, ms) { F.toasts.push(String(t)); F.toastMs.push([String(t), ms]); F.notes.push(String(t)); return o.apply(this, arguments); }; }
  if (H && typeof H.driveNote === 'function') { const o = H.driveNote; H.driveNote = function (t) { if (t) F.notes.push(String(t)); return o.apply(this, arguments); }; }
  // 音效：单次音效记名字；循环音效记开着几个
  if (A && typeof A.play === 'function') { const o = A.play; A.play = function (name) { F.sounds.push(String(name)); return o.apply(this, arguments); }; }
  if (A && typeof A.loop === 'function') {
    const o = A.loop;
    A.loop = function (name) {
      const h = o.apply(this, arguments);
      const n = String(name);
      F.loopsOn[n] = (F.loopsOn[n] || 0) + 1;
      F.loopLog.push('+' + n);
      if (h && typeof h.stop === 'function') {
        const os = h.stop; let done = false;
        h.stop = function () { if (!done) { done = true; F.loopsOn[n]--; F.loopLog.push('-' + n); } return os.apply(this, arguments); };
      }
      return h;
    };
  }
  F.looping = n => (F.loopsOn[n] || 0) > 0;
  if (W && typeof W.setExtraLights === 'function') { const o = W.setExtraLights; W.setExtraLights = function (owner, list) { F.extra[String(owner)] = list || null; return o.apply(this, arguments); }; }
  BR.bus.on('player:damage', p => F.dmg.push({ hp: p && p.hp, sanity: p && p.sanity, src: p && p.source ? (typeof p.source === 'object' ? (p.source.id || p.source.type || 'obj') : String(p.source)) : null, x: BR.player.x, z: BR.player.z }));
  ['vehicle:mount', 'vehicle:dismount', 'vehicle:promote', 'interact:deny', 'interact:short'].forEach(n => BR.bus.on(n, p => { try { F.ev.push([n, p ? JSON.parse(JSON.stringify(p)) : null]); } catch (e) { F.ev.push([n, null]); } }));
  F.clear = () => { F.notes.length = 0; F.toasts.length = 0; F.toastMs.length = 0; F.sounds.length = 0; F.ev.length = 0; F.dmg.length = 0; };
  F.evs = n => F.ev.filter(e => e[0] === n).map(e => e[1]);
  F.r = (v, k) => Math.round(v * (k || 1000)) / (k || 1000);

  // ---- 车和坐标 ----
  F.veh = k => BR.vehicles.byKey(k);
  F.rec = k => BR.vehicles.list().find(v => v.key === k) || null;
  F.pose = k => { const v = F.veh(k); return v ? Object.assign({}, v.pose) : null; };
  F.state = k => (BR.forklift && typeof BR.forklift.state === 'function' ? BR.forklift.state(k) : null);
  F.geo = () => (BR.L1forklift && BR.L1forklift.geo) || {};
  F.W = (k, lx, lz, ly) => { const p = F.veh(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, y: p.y + (ly || 0), z: p.z - s * lx + c * lz }; };
  F.L = (k, x, z) => { const p = F.veh(k).pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return { x: c * dx - s * dz, z: s * dx + c * dz }; };
  F.WP = (p, lx, lz) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return { x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz }; };
  F.fwd = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
  // 出生块 (0,0) 中间柱间（x、z 都在 12..20）里的那台车
  F.spawnKey = () => {
    const c = BR.world.chunks().find(q => q.key === '0,0');
    const fl = (c && c.res && c.res.data && c.res.data.forklifts) || [];
    const f = fl.find(q => q.x > 12 && q.x < 20 && q.z > 12 && q.z < 20);
    return f ? f.key : null;
  };
  F.fkData = k => { for (const c of BR.world.chunks()) for (const f of ((c.res && c.res.data && c.res.data.forklifts) || [])) if (f.key === k) return Object.assign({ chunk: c.key }, f); return null; };
  F.physKey = k => { const r = F.rec(k); return r ? r.physKey : null; };
  F.obbs = k => { const pk = F.physKey(k); return pk ? BR.phys.records(pk).obbs : []; };
  // 车（不管停着还是开过）在 phys 里的盒子，世界坐标；ext 往外扩
  F.inCar = (k, x, y, z, ext) => {
    const e = ext || 0;
    for (const o of F.obbs(k)) {
      const q = Object.assign({}, o, { hx: o.hx + e, hz: o.hz + e, minY: o.minY - e, maxY: o.maxY + e });
      if (BR.phys.pointInObb(q, x, y, z)) return o.name;
    }
    return null;
  };
  // 一件物资（按它模型的水平半径 F.foot、高 2hh 的圆柱）压没压进车的某个 OBB（深 >5 mm）
  F.itemInCar = (k, id) => {
    const p = BR.items.find(id);
    if (!p) return null;
    const r = F.foot(p), h = Math.max(0.05, 2 * (p.hh || 0.1));
    for (const o of F.obbs(k)) { const d = BR.phys.circleVsObb(p.x, p.z, r, o, p.y, h); if (d && d.depth > 0.005) return o.name; }
    return null;
  };
  // 车的每个 OBB 和静态碰撞体压进去多深：tol（缺省 1 cm）以上的列出来
  F.pen = (k, tol) => {
    const pk = F.physKey(k), out = [], res = [];
    for (const o of F.obbs(k)) {
      const n = BR.phys.overlapOBB(o, { tol: tol == null ? 0.01 : tol, ignoreKey: pk, out });
      if (n) res.push(o.name + '→' + out.map(s => s.key + (s.obb ? ':' + s.name : '')).join('|'));
    }
    return res;
  };
  // 某个位姿下 14 个盒子（世界坐标）和哪些碰撞体重叠
  F.boxesAt = (x, z, yaw, lift) => {
    const G = F.geo();
    const loc = typeof G.obbs === 'function' ? G.obbs(lift || 0) : [];
    return BR.phys.toWorldOBBs(loc, x, z, yaw, BR.phys.groundY(x, z));
  };
  F.hitsAt = (x, z, yaw, lift, ignore, tol) => {
    const keys = [];
    for (const o of F.boxesAt(x, z, yaw, lift)) {
      const out = [];
      if (BR.phys.overlapOBB(o, { tol: tol == null ? 0.005 : tol, ignoreKey: ignore, out })) for (const s of out) keys.push((s.key || '?') + (s.obb ? ':' + s.name : '') + '@' + o.name);
    }
    return keys;
  };
  // 沿车头方向走 dist 米，第一下撞到什么（每 step 米查一次）
  F.sweep = (x, z, yaw, lift, dist, ignore, stepM) => {
    const f = F.fwd(yaw), st = stepM || 0.1;
    for (let d = 0; d <= dist + 1e-6; d += st) {
      const h = F.hitsAt(x + f.x * d, z + f.z * d, yaw, lift, ignore, 0.005);
      if (h.length) return { d, hits: h };
    }
    return null;
  };
  // 车身高度上伸出来、没有碰撞体的东西（b.data.sideObs，车开过去会被它挡住）：沿车头方向走 dist 米，第一下压上哪个条目的距离 | null
  F.sideList = (x, z, R) => {
    const out = [];
    for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.sideObs) || [])) if (e.maxX > x - R && e.minX < x + R && e.maxZ > z - R && e.minZ < z + R) out.push(e);
    return out;
  };
  F.sideHit = (o, e) => {
    if (Math.min(o.maxY, e.maxY) - Math.max(o.minY, e.minY) <= 0.01) return false;
    if (e.round) { const d = BR.phys.circleVsObb(e.cx, e.cz, e.r, o, e.minY, e.maxY - e.minY); return !!d && d.depth > 0.005; }
    const ca = Math.cos(o.rot), sa = Math.sin(o.rot), rb = e.rot || 0, cb = Math.cos(rb), sb = Math.sin(rb), dx = e.cx - o.cx, dz = e.cz - o.cz;
    for (const [ux, uz] of [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]]) {
      const ra = o.hx * Math.abs(ca * ux - sa * uz) + o.hz * Math.abs(sa * ux + ca * uz), rr = e.hx * Math.abs(cb * ux - sb * uz) + e.hz * Math.abs(sb * ux + cb * uz);
      if (ra + rr - Math.abs(dx * ux + dz * uz) <= 0.005) return false;
    }
    return true;
  };
  F.sideSweep = (x, z, yaw, lift, dist, stepM) => {
    const f = F.fwd(yaw), st = stepM || 0.05, L = F.sideList(x + f.x * dist / 2, z + f.z * dist / 2, dist / 2 + 4);
    if (!L.length) return null;
    for (let d = 0; d <= dist + 1e-6; d += st) {
      for (const o of F.boxesAt(x + f.x * d, z + f.z * d, yaw, lift)) for (const e of L) if (F.sideHit(o, e)) return { d, kind: e.kind };
    }
    return null;
  };
  // ---- 撞车甩货（FE1 返修 r3）：一件物资这一帧有没有穿过东西 ----
  // 压进车的 OBB（>5 mm）、压进别的碰撞体（墙、货架，>5 mm；斜放地牛那块老碰撞体车和货都不理，不算）、压进 sideObs（柱础、护角……）、
  // 整个在举起来的货叉正下方（叉子投影里、比叉底还低：只能是穿过货叉掉下去的）
  // 物资模型的水平半径：模型所有顶点离它竖直转轴（原点）最远的水平距离，按类型量一次（转多少都一样）。
  // 返修 r4 以前按包围球半径 × 0.8，细高的瓶子大了 2.5 倍（水瓶 0.111，模型 0.044）
  F._foot = {};
  F.foot = p => {
    const ty = String(p.type);
    if (F._foot[ty] == null && p.obj) {
      p.obj.updateMatrixWorld(true);
      const o = p.obj.matrixWorld.elements;
      let m = 0;
      p.obj.traverse(n => {
        const pos = n.isMesh && n.geometry && n.geometry.attributes.position;
        if (!pos) return;
        const e = n.matrixWorld.elements;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const dx = e[0] * x + e[4] * y + e[8] * z + e[12] - o[12], dz = e[2] * x + e[6] * y + e[10] * z + e[14] - o[14];
          m = Math.max(m, dx * dx + dz * dz);
        }
      });
      if (m > 0) F._foot[ty] = Math.sqrt(m);
    }
    return F._foot[ty] != null ? F._foot[ty] : Math.max(0.03, (p.r || 0.08) * 0.8);
  };
  F.tall = p => Math.max(0.05, 2 * (p.hh || 0.06));
  F.vy = p => (p.obj ? p.obj.position.y : p.y);   // 模型此刻的底面高度（浮着的物资比记录的 y 高）
  F.sideAll = () => { const out = []; for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.sideObs) || [])) out.push(e); return out; };
  F.fallBad = (k, ids) => {
    const G = F.geo(), pose = F.pose(k), pk = F.physKey(k), tip = Math.min(G.forkZ[0], G.forkZ[1]), heel = Math.max(G.forkZ[0], G.forkZ[1]);
    const tx = Math.abs(Array.isArray(G.tineX) ? G.tineX[0] : 0.28), half = (G.forkW || 0.1) / 2;
    const fb = pose.y + (G.forkY || 0.015) + (G.carriageTravel || 2.6) * pose.lift;   // 叉底
    const side = F.sideAll(), skip = side.filter(e => Array.isArray(e.solid)).map(e => e.solid);
    const out = [];
    for (const id of ids) {
      const p = BR.items.find(id);
      if (!p) continue;
      const r = F.foot(p), h = F.tall(p), l = F.L(k, p.x, p.z);
      const o = { cx: p.x, cz: p.z, hx: r * 0.85, hz: r * 0.85, rot: pose.yaw, minY: p.y + 0.005, maxY: p.y + h - 0.005 };
      const car = F.itemInCar(k, id);
      if (car) out.push(id + ':car:' + car);
      const so = [];
      if (BR.phys.overlapOBB(o, { tol: 0.005, ignoreKey: pk, out: so, skipBoxes: skip.length ? skip : undefined })) out.push(id + ':solid:' + so.map(q => q.key + (q.obb ? ':' + q.name : '')).join('|'));
      for (const e of side) {
        if (e.maxX < p.x - 1 || e.minX > p.x + 1 || e.maxZ < p.z - 1 || e.minZ > p.z + 1) continue;
        if (F.sideHit(o, e)) { out.push(id + ':side:' + e.kind); break; }
      }
      const overTine = l.z > tip - r + 0.005 && l.z < heel + r - 0.005 && [tx, -tx].some(c => Math.abs(l.x - c) < half + r - 0.005);
      if (overTine && p.y + h < fb - 0.005) out.push(id + ':underFork');
      // 别的物资（地上的、留在叉上的、被推着的果冻，还有同一趟甩出去的另几件）：模型半径的竖圆柱，横着压进去 >5 mm、竖着重叠 >5 mm 算穿过（返修 r4）
      const y0 = F.vy(p);
      for (const q of BR.items.list) {
        if (!q || q === p || q.owner || Math.abs(q.x - p.x) > 0.6 || Math.abs(q.z - p.z) > 0.6) continue;
        if (ids.includes(q.id) && String(q.id) < String(id)) continue;   // 同一趟的两两只报一次
        const qy = F.vy(q);
        if (Math.min(y0 + h, qy + F.tall(q)) - Math.max(y0, qy) <= 0.005) continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) < r + F.foot(q) - 0.005) out.push(id + ':item:' + q.id);
      }
    }
    return out;
  };
  // 撞车甩货时一件还在叉面高度（底面 ≥ 叉面 − 2 mm）的时候：圆心不越过叉尖 0.3 个模型半径以上（不悬在叉尖外面）、
  // 不往车这边退（车本地 z 只减不增）、横着不越过叉沿 0.3 个模型半径以上（|lx − 起点那根货叉的中线| ≤ 叉宽/2 + 0.3 r + 2 mm：
  // 从叉边滑下去时不在叉面高度悬空横走，返修 r5）。货叉按 hoverReset 后第一帧的 lx 判断是哪一根。
  // 返修 r7：过了 0.3 个模型半径以后是「翻下去」那一小段 —— 按在叉面上的速度接着走到整个离开叉尖 / 叉沿（离它模型半径 + 2.1 cm）再往下掉
  // （r6 是一帧跳过去，圆心一下子跳 4–8 cm）。这一段允许，但每帧都要接着往外走（不停在叉尖外面）、最多 9 帧（0.3 s），走不到更远
  // （超出 模型半径 + 2.1 cm + 3 mm 算悬空；走完以后从静止起竖直往下掉，头一两帧还在叉面高度，只要一直往下掉、不超过 2 帧也不算）。
  // 每趟开始前 F.hoverReset()，之后每帧 F.hover(k, ids) 返回这一帧的问题（返修 r4）
  F.hoverReset = () => { F._hov = {}; };
  F.hoverReset();
  F.hover = (k, ids) => {
    const G = F.geo(), pose = F.pose(k), tip = Math.min(G.forkZ[0], G.forkZ[1]);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    const tx = Math.abs(Array.isArray(G.tineX) ? G.tineX[0] : 0.28), half = (G.forkW || 0.1) / 2;
    const out = [];
    for (const id of ids) {
      const p = BR.items.find(id);
      if (!p) continue;
      const y = F.vy(p), l = F.L(k, p.x, p.z), r = F.foot(p);
      const h = F._hov[id] || (F._hov[id] = { lz: l.z, lx: l.x, y, tx: l.x < 0 ? -tx : tx, left: false, n: 0, tipN: 0, fallN: 0 });
      if (h.left || y < surf - 0.002) { h.left = true; continue; }
      h.n++;
      const past = tip - l.z, beyond = Math.abs(l.x - h.tx) - half, zone = r + 0.017 + 0.004 + 0.003;
      if (past > 0.3 * r + 0.002 || beyond > 0.3 * r + 0.002) {
        const moving = h.lz - l.z > 0.0008 || Math.abs(l.x - h.lx) > 0.0008;
        h.tipN++;
        if (past > zone || beyond > zone) {
          // 走完那一小段、刚开始竖直往下掉（从静止起掉，头 0.02 s 才掉 2 mm）：还在叉面高度，但一直在往下掉、最多 2 帧
          h.fallN++;
          if (!(y < h.y - 0.0002) || h.fallN > 2) out.push(id + (past > zone ? ':hover:' : ':sidehover:') + F.r(Math.max(past, beyond)));
        } else if (!moving) out.push(id + ':linger:' + F.r(Math.max(past, beyond)));
        else if (h.tipN > 9) out.push(id + ':tipslow:' + h.tipN);
      }
      if (l.z > h.lz + 0.001) out.push(id + ':back:' + F.r(l.z - h.lz));
      h.lz = Math.min(h.lz, l.z); h.lx = l.x; h.y = y;
    }
    return out;
  };
  // 全速撞一次（返修 r5）：不上车，直接给停着的车喂油门（照 __fk.drive 的规矩一帧一帧推），撞上以后一帧一帧推到甩出去的都落地；每帧查 fallBad + hover。
  // o.liftAt(pose, 走了多远) 返回 true 的那一帧开始按住「升」（边开边升），撞上以后松开。返回过程和每件最后的样子（lieState），
  // gap：同一次甩出去的两两之间模型边到边最近多远；surfAt：撞上那一刻的叉面高度。
  // 返修 r6：o.inject = 撞前车速（开车前直接把车速设成它，I16c 那样，撞前约 2.1 m/s 用）；
  // o.after = { throttle, steer, sec }：撞上那一刻起这样开 sec 秒（倒车 / 倒车打方向，孩子撞完马上往回开），车和世界一帧一起走。
  // 撞上以后每帧还记：busyMoved（这台车还有甩出去的没离开叉面 —— debugInfo().throwBusy —— 时车挪了的帧）、lockT（撞上到都离开叉面多久）、
  // movedAfter（最后车离撞停的地方多远）；lock（o.liftAfter：还有甩出去的在撞上那一刻的叉面高度时，货叉动了的帧 —— 撞上那一帧起逐帧比）；
  // 每件的水平速度（世界坐标、每帧）：kick（在叉面上停了 ≥3 帧又动起来）、forkAccel（在叉面上越滑越快：比上一帧快 15% + 3 cm/s 以上；
  // 拐弯那一帧 —— 先往前滑再横着滑向叉沿，这一帧的位移切了个角、量出来偏慢 —— 和它后面一帧不算；圆心过了叉尖 / 叉沿 0.3 个模型半径以后的「翻下去」那一小段不算）、
  // speedup（翻下去以后的水平速度 > 在叉面上最后的速度 × 1.55 + 3 cm/s）、jump（返修 r7：某一帧的位移比前后两帧都大出 1.2 cm 以上 —— r6 翻下叉尖那一帧跳 4–8 cm）、
  // wu（返修 r7 裁定 ②：throws 里每件的 w / u 不在 0.6–1.5 之间 —— 翻下去以后突然慢下来或者突然快很多）。
  // 写成生成器（返修 r6，验收员：机器一忙一个 page.evaluate 推几百帧会超过 120 s）：F.crashStart 开始、F.crashMore 每次最多推 30 帧，
  // 测试那边用 crashRun(page, …) 一段一段调；F.crashRun 是页面里一次推完的老写法（探针用）
  F.crashGen = function* (k, ids, o) {
    o = o || {};
    F.clear(); F.hoverReset();
    const G = F.geo(), base = (G.forkY || 0.015) + (G.forkT || 0.04), trav = G.carriageTravel || 2.6;
    const n0 = BR.vehicles.debugInfo().throws.length, bad = [], hov = [], inp = { throttle: 1, steer: 0, lift: 0 }, p0 = F.pose(k);
    let surfAt = null, pressed = null;
    let liftAt = null;
    const lock = [];   // o.liftAfter：撞上那一刻起一直按住「升」—— 还有甩出去的在（撞上那一刻的）叉面高度时货叉动了的帧
    const onForkH = () => ids.some(id => { const p = BR.items.find(id); return !!p && F.vy(p) >= surfAt - 0.002; });
    if (o.inject) {
      BR.vehicles._step(1 / 60, { throttle: 0, steer: 0, lift: 0 }, k);
      const v = BR.vehicles.byKey(k); v.sim.spd = o.inject; v.pose.spd = o.inject;
    }
    // ① 开过去撞上（__fk.drive 的规矩：untilStop 停稳 0.2 s 才算停；o.after 时撞上那一帧就转到 ②）
    const dt = 1 / 30, maxSec = o.maxSec || 8;
    let t = 0, vmax = 0, stopT = 0, fr = 0;
    while (t < maxSec) {
      const p = BR.vehicles._step(dt, inp, k);
      t += dt;
      if (!p) break;
      vmax = Math.max(vmax, Math.abs(p.spd));
      if (o.liftAt && !pressed && o.liftAt(p, Math.hypot(p.x - p0.x, p.z - p0.z))) { inp.lift = 1; pressed = { d: F.r(Math.hypot(p.x - p0.x, p.z - p0.z)), v: F.r(p.spd), surf: F.r(base + trav * p.lift) }; }
      if (surfAt == null && BR.vehicles.debugInfo().throws.length > n0) { surfAt = F.r(base + trav * p.lift); liftAt = p.lift; inp.lift = o.liftAfter ? 1 : 0; }
      bad.push(...F.fallBad(k, ids)); hov.push(...F.hover(k, ids));
      if (liftAt != null && o.liftAfter && Math.abs(p.lift - liftAt) > 1e-4 && onForkH()) lock.push('d' + F.r(p.lift - liftAt));
      if (o.after && surfAt != null) break;
      if (!o.after && t > 0.3 && Math.abs(p.spd) < 0.02) { stopT += dt; if (stopT > 0.2) break; } else stopT = 0;
      if (++fr % 30 === 0) yield fr;
    }
    // ② 撞上以后：车（o.after / o.liftAfter 时照样给输入）和世界一帧一起走
    const crash = F.pose(k), busyMoved = [], busySteer = [], sp = {};
    let n = 0, lockT = null;
    const vxz = p => (p.obj ? [p.obj.position.x, p.obj.position.y, p.obj.position.z] : [p.x, p.y, p.z]);
    for (const id of ids) { const p = BR.items.find(id); if (p) sp[id] = { prev: vxz(p), pd: null, fork: [], air: [], steps: [], still: 0, kick: null, accel: null, wasFork: true, first: true, tx: null }; }
    const tipZ = Math.min(G.forkZ[0], G.forkZ[1]), tineX = Math.abs(Array.isArray(G.tineX) ? G.tineX[0] : 0.28), halfW = (G.forkW || 0.1) / 2;
    const afterN = o.after ? Math.round((o.after.sec || 2) * 30) : 0;
    for (let i = 0; i < 170; i++) {
      if (surfAt != null && (o.liftAfter || i < afterN)) {
        BR.vehicles._step(1 / 30, { throttle: i < afterN ? o.after.throttle || 0 : 0, steer: i < afterN ? o.after.steer || 0 : 0, lift: o.liftAfter ? 1 : 0 }, k);
      }
      __br.step(1 / 30); n++; bad.push(...F.fallBad(k, ids)); hov.push(...F.hover(k, ids));
      const pose = F.pose(k), busy = (BR.vehicles.debugInfo().throwBusy || []).includes(k);
      if (o.liftAfter && liftAt != null && Math.abs(pose.lift - liftAt) > 1e-4 && onForkH()) lock.push(i + ':' + F.r(pose.lift - liftAt));
      if (busy && Math.hypot(pose.x - crash.x, pose.z - crash.z) > 0.002) busyMoved.push(i + ':' + F.r(Math.hypot(pose.x - crash.x, pose.z - crash.z)));
      // 方向也锁着（返修 r6 裁定 ①）：后轮停在撞上那一刻的角度
      if (busy && Math.abs((pose.steer || 0) - (crash.steer || 0)) > 1e-3) busySteer.push(i + ':' + F.r((pose.steer || 0) - (crash.steer || 0), 1000));
      if (!busy && lockT == null) lockT = F.r(i / 30);
      for (const id in sp) {
        const p = BR.items.find(id), S = sp[id];
        if (!p) continue;
        const q = vxz(p), dx = q[0] - S.prev[0], dz = q[2] - S.prev[2], v = Math.hypot(dx, dz) * 30;
        const turn = !!S.pd && v > 0.02 && Math.hypot(S.pd[0], S.pd[1]) > 1e-5 && dx * S.pd[0] + dz * S.pd[1] < 0.94 * Math.hypot(dx, dz) * Math.hypot(S.pd[0], S.pd[1]);
        const atH = surfAt != null && q[1] >= surfAt - 0.002, g = BR.phys.groundY(q[0], q[2]);
        // 还在叉面上（没过叉尖 / 叉沿 0.3 个模型半径）：叉面高度、按这一帧的车位姿（锁车时车不动）
        const lq = F.L(k, q[0], q[2]), rr = F.foot(p);
        if (S.tx == null) S.tx = lq.x < 0 ? -tineX : tineX;
        const onFork = atH && tipZ - lq.z <= 0.3 * rr + 0.003 && Math.abs(lq.x - S.tx) - halfW <= 0.3 * rr + 0.003;
        if (q[1] - g > 0.003 || atH) S.steps.push(Math.hypot(dx, dz));
        if (onFork && S.wasFork) {
          if (v < 0.02) S.still++;
          else {
            if (S.still >= 3 && !S.kick) S.kick = { frame: i, still: S.still, v: F.r(v) };
            const last = S.fork.length ? S.fork[S.fork.length - 1] : null;
            if (last != null && !turn && !S.turned && v > last * 1.15 + 0.03 && !S.accel) S.accel = { frame: i, from: F.r(last), to: F.r(v) };
            S.fork.push(v); S.still = 0;
          }
        } else if (!atH && q[1] - g > 0.003) {
          if (S.first) S.first = false;   // 刚开始往下掉的那一帧（一部分还在翻下去那一小段里）不算
          else S.air.push(v);
        }
        S.turned = turn;
        if (v > 0.02) S.pd = [dx, dz];
        S.wasFork = onFork; S.prev = q;
      }
      if (i > 10 && !BR.vehicles.debugInfo().falls && i >= afterN) break;
      if ((i + 1) % 30 === 0) yield fr + i + 1;
    }
    F.frames(10);
    const tt = BR.vehicles.debugInfo().throws, last = tt.length > n0 ? tt[tt.length - 1] : null;
    let gap = Infinity;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = BR.items.find(ids[i]), q = BR.items.find(ids[j]);
      if (p && q) gap = Math.min(gap, Math.hypot(p.x - q.x, p.z - q.z) - F.foot(p) - F.foot(q));
    }
    const kicks = [], accel = [], speedups = [], speeds = {}, jumps = [], wu = [];
    for (const id in sp) {
      const st = sp[id].steps;
      for (let i = 1; i < st.length - 1; i++) { const j = st[i] - Math.max(st[i - 1], st[i + 1]); if (j > 0.012) { jumps.push(id + ':' + i + ':' + F.r(j * 100, 10) + 'cm'); break; } }
      const S = sp[id], fv = S.fork.length ? S.fork[S.fork.length - 1] : null, av = S.air.length ? S.air.reduce((a, b) => a + b, 0) / S.air.length : null;
      speeds[id] = [fv == null ? null : F.r(fv), av == null ? null : F.r(av)];
      if (S.kick) kicks.push(id + ':' + JSON.stringify(S.kick));
      if (S.accel) accel.push(id + ':' + JSON.stringify(S.accel));
      if (fv != null && av != null && av > fv * 1.55 + 0.03) speedups.push(id + ':' + F.r(fv) + '→' + F.r(av));
    }
    for (const h of (last && Array.isArray(last.how) ? last.how : [])) if (h.length >= 4 && h[2] > 0 && !(h[3] >= 0.6 * h[2] - 0.005 && h[3] <= 1.5 * h[2] + 0.005)) wu.push(h[0] + ':' + h[2] + '→' + h[3]);
    const pe = F.pose(k);
    return { vmax: F.r(vmax), thrown: tt.length - n0, last, jumps, wu, sounds: F.sounds.filter(s => /^fk_b/.test(s)), bad: bad.slice(0, 8), nbad: bad.length, hov: hov.slice(0, 8), nhov: hov.length,
      frames: n, falls: BR.vehicles.debugInfo().falls, st: F.lieState(k, ids), surfAt, pressed, gap: F.r(gap), throwMs: F.r(BR.vehicles.debugInfo().throwMs, 10),
      riders: BR.vehicles.debugInfo().riders[k] || [], lock: lock.slice(0, 8), liftRose: liftAt == null ? null : F.r(F.pose(k).lift - liftAt, 10000),
      busyMoved: busyMoved.slice(0, 8), nBusyMoved: busyMoved.length, busySteer: busySteer.slice(0, 8), nBusySteer: busySteer.length, lockT, movedAfter: F.r(Math.hypot(pe.x - crash.x, pe.z - crash.z)), notes: F.notes.slice(0, 6),
      kicks, accel, speedups, speeds, crash: { x: F.r(crash.x), z: F.r(crash.z), yaw: crash.yaw } };
  };
  F.crashStart = (k, ids, o) => { F._cr = F.crashGen(k, ids, o); return F.crashMore(); };
  F.crashMore = () => { const r = F._cr.next(); if (r.done) { F._cr = null; return { done: true, value: r.value }; } return { done: false, frames: r.value }; };
  F.crashRun = (k, ids, o) => { const g = F.crashGen(k, ids, o); let r = g.next(); while (!r.done) r = g.next(); return r.value; };
  // 几件物资此刻：车本地坐标、离叉尖往前多远（past）、在不在叉上、静不静止、模型离记录的高度差（浮动时 ≥ 0.08）
  F.lieState = (k, ids) => {
    const G = F.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]), riders = BR.vehicles.debugInfo().riders[k] || [];
    return ids.map(id => {
      const p = BR.items.find(id);
      if (!p) return { id, gone: true };
      const l = F.L(k, p.x, p.z);
      return { id, x: F.r(p.x), y: F.r(p.y), z: F.r(p.z), lx: F.r(l.x), lz: F.r(l.z), past: F.r(tip - l.z), ground: F.r(BR.phys.groundY(p.x, p.z)), r: F.r(F.foot(p)),
        onFork: riders.includes(id), held: !!p.held, still: !!p.still, objDy: p.obj ? F.r(p.obj.position.y - p.y, 10000) : null };
    });
  };
  // 把一件物资直接摆到货叉面上（叉面高过 1.4 m 时人丢不上去，测试直接摆）
  F.putOnFork = (k, id, type, lx, lz) => {
    const G = F.geo(), pose = F.pose(k), w = F.W(k, lx, lz);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    if (BR.items.find(id)) BR.items.remove(id);
    const p = BR.items.spawn(type, w.x, surf, w.z, { id, dropped: true, still: true });
    return !!p && BR.vehicles.attachItem(id, k);
  };
  // 某个位姿、某个 lift 下车的盒子有没有碰到头顶条目（b.data.overhead：梁、吊灯、管子……底面 y）
  F.ohHit = (x, z, yaw, lift) => {
    const boxes = F.boxesAt(x, z, yaw, lift);
    for (const c of BR.world.chunks()) for (const e of ((c.res && c.res.data && c.res.data.overhead) || [])) {
      for (const o of boxes) if (o.maxY > e.y - 0.02 && F.obbHitsBox(o, { minX: e.minX, maxX: e.maxX, minZ: e.minZ, maxZ: e.maxZ }, 0.02)) return e.kind;
    }
    return null;
  };
  // 截图用：人站到车本地 (lx, lz)、看向车本地 (tlx, tly, tlz)（相机跟着人走，渲染一帧）
  // 同上，但按给定的车位姿 p（{ x, z, yaw }，比如撞停那一刻的）取车本地坐标：车倒开以后还能对着落点截图（返修 r6）
  F.viewP = (p, lx, lz, tlx, tly, tlz) => {
    const w = F.WP(p, lx, lz), t = F.WP(p, tlx, tlz);
    F.stand(w.x, w.z, F.yawTo(w.x, w.z, t.x, t.z));
    const eye = BR.player.y, d = Math.hypot(t.x - w.x, t.z - w.z);
    BR.player.pitch = Math.atan2(tly - eye, d);
    __br.step(1 / 30);
    return { eye, pitch: BR.player.pitch };
  };
  F.viewL = (k, lx, lz, tlx, tly, tlz) => {
    const w = F.W(k, lx, lz), t = F.W(k, tlx, tlz);
    F.stand(w.x, w.z, F.yawTo(w.x, w.z, t.x, t.z));
    const eye = BR.player.y, d = Math.hypot(t.x - w.x, t.z - w.z);
    BR.player.pitch = Math.atan2(tly - eye, d);
    __br.step(1 / 30);
    return { eye, pitch: BR.player.pitch };
  };
  // 停着、没人坐的车摆到某个位姿（BR.vehicles.setPose 不带 remote = levelState 回放，会顺手升格）
  F.place = (k, x, z, yaw, lift) => BR.vehicles.setPose(k, { x, z, yaw, steer: 0, lift: lift || 0, spd: 0, lever: 0, on: 0 });

  // ---- 人 ----
  F.stand = (x, z, yaw) => { BR.player.reset({ x, y: BR.phys.groundY(x, z), z, yaw: yaw || 0 }, { full: false }); __br.step(0.05); };
  F.yawTo = (x0, z0, x1, z1) => Math.atan2(-(x1 - x0), -(z1 - z0));
  // 站到车的本地坐标 (lx, lz)，面朝座椅
  F.standL = (k, lx, lz) => {
    const w = F.W(k, lx, lz), s = F.W(k, 0, 0.24);
    F.stand(w.x, w.z, F.yawTo(w.x, w.z, s.x, s.z));
    return w;
  };
  F.aimL = (k, lx, ly, lz) => { const w = F.W(k, lx, lz, ly); BR.interact.aimAt(w.x, w.y, w.z); __br.step(1 / 30); return F.cur(); };
  F.cur = () => {
    const c = BR.interact.current;
    return c ? { kind: c.kind, key: c.key, label: c.label, short: c.short ? { verb: c.short.verb, ok: c.short.ok !== false, why: c.short.why || null } : null, dragWhy: c.dragWhy || null } : null;
  };
  F.prompt = () => { const el = document.querySelector('.hud-prompt'); return !el || el.hidden || !el.getClientRects().length ? '' : el.innerText.replace(/\s+/g, ' ').trim(); };
  F.cam = () => { const c = BR.gfx.camera.position; return { x: c.x, y: c.y, z: c.z }; };
  F.seat = () => ({ seated: BR.vehicles.seated, mode: BR.interact.mode, ctx: BR.input.context, pose: BR.player.pose, ms: BR.player.mountState, phase: BR.vehicles.debugInfo().phase });
  // 常驻开车提示行：.hud-drive（hud.js），或者整页里文字正好是它的那个可见元素
  F.driveLine = () => {
    const vis = e => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05;
    const el = Array.from(document.querySelectorAll('.hud-drive')).find(vis);
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
  };
  F.hudText = () => { const r = document.getElementById('ui') || document.body; return r.innerText.replace(/\s+/g, ' '); };
  F.touchBtn = n => { const b = document.querySelector('.touch-btn-' + n); return b ? { text: b.textContent.trim(), hidden: b.hidden, off: b.classList.contains('touch-off') } : null; };

  // ---- 测试人、实体、物资 ----
  // 测试人会自己溜达：钉住的实体每次 entities.update 之后摆回原处（车的模拟在下一帧 player.update 里看到的就是钉住的位置）
  F.pins = new Map();
  if (BR.entities && typeof BR.entities.update === 'function') {
    const ou = BR.entities.update;
    BR.entities.update = function () { const r = ou.apply(this, arguments); F.pins.forEach((p, id) => { if (!F.moveEnt(id, p.x, p.z)) F.pins.delete(id); }); return r; };
  }
  F.dummy = (x, z, id, free) => {
    const e = BR.entities.spawn('test_dummy', x, undefined, z, { id: id || undefined, force: true, yaw: 0 });
    if (!e) return null;
    if (!free) F.pins.set(e.id, { x, z });
    F.moveEnt(e.id, x, z);
    return e.id;
  };
  F.unpin = id => { F.pins.delete(id); };
  F.dropEnt = id => { F.pins.delete(id); if (typeof BR.entities.remove === 'function') BR.entities.remove(id); };
  F.ent = (type, x, z, id) => { const e = BR.entities.spawn(type, x, undefined, z, { id: id || undefined, force: true, yaw: 0 }); return e ? e.id : null; };
  F.moveEnt = (id, x, z) => { const e = BR.entities.get(id); if (!e || e.removed) return false; e.x = x; e.z = z; if (e.obj) { e.obj.position.x = x; e.obj.position.z = z; } if (F.pins.has(id)) F.pins.set(id, { x, z }); return true; };
  F.killEnts = () => { for (const e of BR.entities.list.slice()) if (!e.removed && typeof BR.entities.remove === 'function') BR.entities.remove(e.id); };
  F.item = (type, x, z, id, y) => { const p = BR.items.spawn(type, x, y, z, { id }); return p ? p.id : null; };
  F.it = id => { const p = BR.items.find(id); return p ? { x: p.x, y: p.y, z: p.z, r: p.r, hh: p.hh, still: p.still, dropped: p.dropped, held: p.held } : null; };

  // 一帧一帧地推（每帧都渲染）：gfx 灯池的淡入淡出只在渲染时前进，__br.step(1) 只在最后渲染一次
  F.frames = n => { for (let i = 0; i < n; i++) __br.step(1 / 30); return 0; };
  // ---- 像素：画完一帧立刻拷到 2D 画布（不需要 preserveDrawingBuffer）；pts 投到屏幕取 9×9 平均亮度（0..255） ----
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
    const x0 = Math.max(0, Math.round(sx) - R), y0 = Math.max(0, Math.round(sy) - R);
    const x1 = Math.min(w - 1, Math.round(sx) + R), y1 = Math.min(h - 1, Math.round(sy) + R);
    if (x1 < x0 || y1 < y0) return null;
    const d = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return n ? s / n : null;
  };
  // 相机摆到 eye 看 at，渲染一帧，量每个世界点的亮度；量完相机原样放回
  F.measure = (eye, at, pts) => {
    const cam = BR.gfx.camera, P = cam.position.clone(), Q = cam.quaternion.clone();
    cam.position.set(eye.x, eye.y, eye.z);
    cam.lookAt(at.x, at.y, at.z);
    cam.updateMatrixWorld(true);
    const g = F.grab(), w = g.canvas.width, h = g.canvas.height;
    const out = pts.map(p => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
      return F.r(F.lum(g, (v.x + 1) / 2 * w, (1 - v.y) / 2 * h, p.r), 100);
    });
    cam.position.copy(P); cam.quaternion.copy(Q); cam.updateMatrixWorld(true);
    return out;
  };
  // 整屏两次渲染的平均像素差（0..255），第一次存起来
  F.snap = (eye, at) => {
    const cam = BR.gfx.camera, P = cam.position.clone(), Q = cam.quaternion.clone();
    cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(at.x, at.y, at.z); cam.updateMatrixWorld(true);
    const g = F.grab();
    const d = g.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    cam.position.copy(P); cam.quaternion.copy(Q); cam.updateMatrixWorld(true);
    return d;
  };
  F.diff = (a, b) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) { s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; } return n ? s / n : 0; };

  // ---- 场地 ----
  // 出生块南边主通道和 x=0 那条主通道的十字口（区块边界两侧各 4 m，永远畅通）：试车场
  F.YARD = { x: -1, z: 32.6, yaw: -Math.PI / 2 };
  // 找静态碰撞体：区块 key 下的 AABB（不含道具、固定设备、车）
  F.solids = (ck, pred) => BR.phys.records(ck).solids.filter(s => s.key === ck).map(s => ({ minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY, minZ: s.minZ, maxZ: s.maxZ, w: s.maxX - s.minX, d: s.maxZ - s.minZ, h: s.maxY - s.minY })).filter(pred || (() => true));
  F.allSolids = pred => {
    const out = [];
    for (const c of BR.world.chunks()) for (const s of F.solids(c.key, pred)) out.push(Object.assign(s, { ck: c.key }));
    return out;
  };
  // 找一条直道：车头朝 yaw，车沿车头方向从 (x, z) 开出去 run 米之内不碰任何东西，run 米之后（+0.5 以内）第一下撞到 target 盒子
  F.laneTo = (k, box, opts) => {
    const o = opts || {}, pk = F.physKey(k);
    const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
    const G = F.geo(), tip = Array.isArray(G.forkZ) ? Math.min(G.forkZ[0], G.forkZ[1]) : -2.1;
    const front = o.frontZ != null ? o.frontZ : tip;   // 车上最靠前的本地 z（叉尖）
    const runs = o.runs || [5, 4.5, 4, 3.5, 3, 2.5, 2];
    const dirs = o.dirs || [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const offs = o.offs || [0, 0.15, -0.15, 0.3, -0.3];
    const near = (h) => h.some(s => { const m = /^(.*?)(:|@)/.exec(s); return true; });
    for (const run of runs) for (const yaw of dirs) for (const off of offs) {
      const f = F.fwd(yaw), lx = -f.z, lz = f.x;   // 车头方向和横向
      // 目标盒子沿车头方向的近面
      let face;
      if (Math.abs(f.x) > 0.5) face = f.x > 0 ? box.minX - cx : cx - box.maxX; else face = f.z > 0 ? box.minZ - cz : cz - box.maxZ;
      const tx = cx + f.x * face, tz = cz + f.z * face;     // 近面中心
      const sx = tx - f.x * (run - front) + lx * off, sz = tz - f.z * (run - front) + lz * off;   // 叉尖离近面 run 米
      if (F.hitsAt(sx, sz, yaw, o.lift || 0, pk).length) continue;
      const sw = F.sweep(sx, sz, yaw, o.lift || 0, run + 0.6, pk, 0.05);
      if (!sw || sw.d < run - 0.6) continue;
      // 半路上有车身高度伸出来的东西（通道里的纸箱、地牛……）会先把车挡住：换一条。贴着目标的（柱脚比柱身宽 8 cm）不算
      const sd = F.sideSweep(sx, sz, yaw, o.lift || 0, sw.d, 0.05);
      if (sd && sd.d < sw.d - 0.2) continue;
      // 第一下撞到的盒子要在目标盒子上（撞到的位置往前探 3 cm 看是不是 target）
      const px = sx + f.x * (sw.d + 0.03), pz = sz + f.z * (sw.d + 0.03);
      const boxes = F.boxesAt(px, pz, yaw, o.lift || 0);
      const inT = boxes.some(b => BR.phys.overlapOBB(b, { tol: 0, ignoreKey: pk }) && obbHitsBox(b, box));
      if (!inT) continue;
      return { x: sx, z: sz, yaw, run, off, contact: sw.d, hits: sw.hits };
    }
    return null;
  };
  function obbHitsBox(o, b, padArg) {
    // 2D：OBB 四个角在不在盒子里，或者盒子四个角在不在 OBB 里（够用：都是凸的，接触时至少一个角在里面）；pad 往外扩（缺省 4 cm）
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => ({ x: o.cx + c * a * o.hx + s * bb * o.hz, z: o.cz - s * a * o.hx + c * bb * o.hz }));
    const pad = padArg == null ? 0.04 : padArg;
    if (corners.some(p => p.x >= b.minX - pad && p.x <= b.maxX + pad && p.z >= b.minZ - pad && p.z <= b.maxZ + pad)) return true;
    const bc = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];
    if (bc.some(([x, z]) => BR.phys.pointInObb(Object.assign({}, o, { hx: o.hx + pad, hz: o.hz + pad }), x, z))) return true;
    // 边穿过：采样 OBB 的边
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4];
      for (let t = 0; t <= 1; t += 0.1) { const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t; if (x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad) return true; }
    }
    return false;
  }
  F.obbHitsBox = obbHitsBox;
  // 一直踩着某个输入走 _step（不上车：给停着的车直接喂模拟），直到停下或超时；返回过程
  F.drive = (k, inp, maxSec, opts) => {
    const o = opts || {}, dt = 1 / 30;
    let t = 0, vmax = 0, stopT = 0, frames = [];
    const p0 = F.pose(k);
    while (t < maxSec) {
      const p = BR.vehicles._step(dt, inp, k);
      t += dt;
      if (!p) break;
      vmax = Math.max(vmax, Math.abs(p.spd));
      if (o.each) { const r = o.each(p, t); if (r) frames.push(r); }
      if (o.until && o.until(p, t)) break;
      if (o.untilStop && t > 0.3 && Math.abs(p.spd) < 0.02) { stopT += dt; if (stopT > 0.2) break; } else stopT = 0;
    }
    const p1 = F.pose(k);
    return { t: F.r(t), vmax: F.r(vmax), moved: F.r(Math.hypot(p1.x - p0.x, p1.z - p0.z)), p0, p1, frames };
  };
}

// =====================================================================
// 进局
// =====================================================================
let BASE = '';
async function boot(browser, tag, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 } }, ctxOpts || {}));
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) || '';
    errors.push('[' + tag + '] console.error: ' + m.text() + (loc ? ' @ ' + loc : ''));
  });
  page.on('pageerror', e => errors.push('[' + tag + '] pageerror: ' + (e.stack || e.message)));
  // 测试绝不连真实联机服务器：api.ovobot.ai 回假响应，其余外部请求一律掐掉
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, r => r.abort());
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 60000 });
  await ev(page, () => { BR.assets.init(); return 0; });
  await page.waitForTimeout(300);
  await ev(page, installHelpers);
  return { ctx, page };
}
// 进 L1（单机）。o = { seed, mode, quality, difficulty }
async function startL1(page, o) {
  const opt = Object.assign({ seed: SEED, mode: 'test', quality: 'high', difficulty: null }, o || {});
  await ev(page, a => {
    __br.setAuto(true);
    __br.start({ mode: a.mode, difficulty: a.difficulty, levelId: '1', seed: a.seed, settings: { quality: a.quality } });
    return 0;
  }, opt);
  await page.waitForFunction(() => BR.game.screen === 'playing' && !BR.world.transitioning && String(BR.game.levelId) === '1', null, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); __fk.clear(); return 0; });
}
async function goHome(page) {
  await releaseAll(page);
  await ev(page, () => { if (BR.hud.paused) BR.hud.pause(false); BR.bus.emit('game:home'); return 0; });
  await page.waitForFunction(() => BR.game.screen === 'home', null, { timeout: 30000 });
  await ev(page, () => { __br.setAuto(false); return 0; });
}
// 站到车左侧（或右侧）1.2 m、对准车身短按空格上车，走完起动（0.5 s 落座 + 0.1 s + 0.8 s 起动）
async function mountCar(page, k, side, opts) {
  const o = opts || {};
  const lx = side === 'right' ? 1.2 : -1.2;
  await ev(page, a => { __fk.standL(a.k, a.lx, 0.24); __fk.aimL(a.k, 0, 1.25, 0.24); return 0; }, { k, lx });
  const cur = await ev(page, () => __fk.cur());
  await tap(page, 'Space');
  if (o.noWait) return { cur };
  await step(page, 1.6);
  const st = await ev(page, () => __fk.seat());
  return { cur, st, ok: st.seated === k && st.phase === 'run' };
}
async function dismount(page) {
  await tap(page, 'Space');
  await step(page, 1.0);
  return ev(page, () => __fk.seat());
}
// 坐在车上按住 R，直到货叉底（geo.forkY + lift × carriageTravel）≥ bottom；返回实际货叉底高度
async function liftTo(page, k, bottom, maxSec) {
  let fb = null;
  await page.keyboard.down('KeyR');
  for (let i = 0; i < Math.round((maxSec || 8) * 30); i++) {
    fb = await ev(page, k => { const G = __fk.geo(); const p = __fk.pose(k); return (G.forkY || 0.015) + p.lift * (G.carriageTravel || 2.6); }, k);
    if (fb >= bottom) break;
    await step(page, 1 / 30);
  }
  await page.keyboard.up('KeyR');
  await step(page, 1 / 30);
  return fb != null && fb >= bottom ? fb : null;
}
// 把车摆到试车场（或别的位姿），再上车
async function placeAndMount(page, k, pose, side) {
  const ok = await ev(page, a => { const p = a.pose; const r = __fk.place(a.k, p.x, p.z, p.yaw, p.lift || 0); __br.step(0.1); return r; }, { k, pose });
  const m = await mountCar(page, k, side || 'left');
  return { placed: ok, mounted: m.ok, st: m.st, cur: m.cur };
}

// =====================================================================
// data
// =====================================================================
async function gData(browser) {
  // 不用正则后行断言 (?<= / (?<!（返修 r7，验收员 spec：hud.js 用过一次，iOS / iPadOS Safari 16.4 以下解析就报错，整个经典 script 不执行）：
  // js/ 下所有 .js 文件、注释以外的行
  {
    const hits = [];
    const walk = d => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else if (/\.js$/.test(f)) {
      fs.readFileSync(q, 'utf8').split('\n').forEach((l, i) => { if (!/^\s*(\/\/|\*)/.test(l) && /\(\?<[=!]/.test(l)) hits.push(path.relative(ROOT, q) + ':' + (i + 1)); }); } } };
    walk(path.join(ROOT, 'js'));
    GROUP = 'data';
    check('D0 js/ 里没有正则后行断言（(?<= / (?<!，iOS Safari 16.4 以下不认，整个文件加载不了）', hits.length === 0, hits);
  }
  const { ctx, page } = await boot(browser, 'data');
  try {
    await startL1(page, { seed: SEED });
    const r0 = await ev(page, () => {
      const k = __fk.spawnKey(), f = k && __fk.fkData(k), rec = k && __fk.rec(k);
      const pk = rec && rec.physKey;
      const R = pk ? BR.phys.records(pk) : { solids: [], obbs: [] };
      return { k, f: f && { x: f.x, z: f.z, rot: f.rot, i: f.i, runtime: f.runtime, detail: f.detail, solid: f.solid }, rec, pk,
        solids: R.solids.length, obbs: R.obbs.length, names: R.obbs.map(o => o.name), keys: Array.from(new Set(R.obbs.map(o => o.key))).slice(0, 3) };
    });
    const k = r0.k;
    check('D1 种子 12345：出生柱间叉车在 (16.4, 16.91)，key 1@0,0#v<i>', !!k && /^1@0,0#v\d+$/.test(k) && Math.abs(r0.f.x - 16.4) < 0.05 && Math.abs(r0.f.z - 16.91) < 0.05 && !r0.f.runtime, r0);
    if (!k) return;
    check('D2 停着时 phys 里是 14 个 OBB（' + (r0.pk || '?') + '#<部件>），原来的外接 AABB 已经不在', r0.obbs === 14 && r0.solids === 0 && r0.names.includes('forkL') && r0.names.includes('roof'), r0);

    // D3：四周 24 个方向走过去（真走：按住 W），被挡时离模型表面 ≤7 cm（水平射线打区块网格里这台车的三角形）
    const rows = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const st = await ev(page, a2 => {
        const { k, a } = a2;
        const v = __fk.veh(k), p = v.pose;
        // 起点：沿方向 a（车本地）离车身外接矩形 1.2 m 的地方，朝车中心（本地 (0, -0.4)）走
        const dx = Math.sin(a), dz = Math.cos(a);
        let lx = 0, lz = -0.4, t = 0;
        while (t < 4) { t += 0.05; const x = lx + dx * t, z = lz + dz * t; if (Math.abs(x) > 0.62 + 1.2 || z < -2.1 - 1.2 || z > 1.35 + 1.2) break; }
        const sx = lx + dx * t, sz = lz + dz * t;
        const w = __fk.W(k, sx, sz), c = __fk.W(k, 0, -0.4);
        const yaw = __fk.yawTo(w.x, w.z, c.x, c.z);
        // 起点被别的东西占着（贴着墙、货架）就跳过这个方向
        if (BR.phys.overlapCircle(w.x, w.z, 0.3, 0.02, 1.7)) return { skip: true, w };
        __fk.stand(w.x, w.z, yaw);
        return { skip: false, w, yaw };
      }, { k, a });
      if (st.skip) { rows.push({ i, skip: true }); continue; }
      // 按住 W 往车走，第一次「沿走的方向前进不到正常的一半」那一帧就是被挡住了（不再继续按，免得贴着车身滑到别处）
      await page.keyboard.down('KeyW');
      let nominal = 0, blockedAt = null;
      for (let f = 0; f < 120; f++) {
        const mv = await ev(page, a2 => {
          const x0 = BR.player.x, z0 = BR.player.z;
          __br.step(1 / 30);
          return (BR.player.x - x0) * -Math.sin(BR.player.yaw) + (BR.player.z - z0) * -Math.cos(BR.player.yaw);
        }, { dir: 0 });
        if (f >= 3) nominal = Math.max(nominal, mv);
        if (f >= 6 && nominal > 0.01 && mv < nominal * 0.5) { blockedAt = f; break; }
      }
      await page.keyboard.up('KeyW');
      await step(page, 1 / 30);
      const m = await ev(page, a2 => {
        const { k } = a2;
        const P = BR.player, r = (BR.config.player && BR.config.player.radius) || 0.3;
        const loc = __fk.L(k, P.x, P.z);
        // 挡住人的是不是这台车：人这个圆（外扩 4 cm）碰得到车的 OBB
        const byCar = __fk.obbs(k).some(o => BR.phys.circleVsObb(P.x, P.z, r + 0.04, o, P.feetY, 1.7));
        // 到车实际网格表面的最近距离：从人的位置朝车打一扇水平射线（±60°，3° 一根），离地 0.035 m 和 0.1–1.8 m 每 0.1 m 一层
        const v = __fk.veh(k), c = v.chunk || BR.world.chunks().find(q => q.key === '0,0');
        const meshes = [];
        (c.res.group || c.group).traverse(o => { if (o.isMesh) meshes.push(o); });
        const rc = new THREE.Raycaster();
        const toC = __fk.W(k, 0, -0.4);
        const base = Math.atan2(toC.x - P.x, toC.z - P.z);
        let best = Infinity, at = null;
        const hs = [0.035]; for (let h = 0.1; h <= 1.8; h += 0.1) hs.push(h);
        for (const hgt of hs) {
          for (let d = -60; d <= 60; d += 3) {
            const ang = base + d * Math.PI / 180;
            rc.set(new THREE.Vector3(P.x, BR.player.feetY + hgt, P.z), new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)));
            rc.far = 3;
            const hits = rc.intersectObjects(meshes, false);
            for (const h of hits) {
              const l = __fk.L(k, h.point.x, h.point.z);
              if (Math.abs(l.x) > 0.75 || l.z < -2.2 || l.z > 1.45) continue;   // 只认这台车的三角形
              if (h.distance < best) { best = h.distance; at = { hgt, d, lx: __fk.r(l.x), lz: __fk.r(l.z) }; }
              break;
            }
          }
        }
        return { lx: __fk.r(loc.x), lz: __fk.r(loc.z), gap: Number.isFinite(best) ? __fk.r(best - r) : null, at, feet: __fk.r(BR.player.feetY), byCar };
      }, { k });
      rows.push(Object.assign({ i, blockedAt }, m));
    }
    // 被别的东西（货架、墙）先挡住的方向不算：只看挡住人的是这台车的那些
    const done = rows.filter(r => !r.skip && r.byCar && r.blockedAt != null);
    const badRows = done.filter(r => r.gap == null || r.gap > 0.07 || r.gap < -0.02 || Math.abs(r.feet) > 0.02);
    const skippedDirs = rows.filter(r => !done.includes(r)).map(r => r.i);
    check('D3 车四周 24 个方向走过去，被挡时离模型表面 ≤7 cm（实测 ' + done.length + ' 个方向，至少 22 个；跳过的方向 [' + skippedDirs.join(',') + ']：起点被占、先被别的东西挡住）', done.length >= 22 && badRows.length === 0,
      { bad: badRows, skipped: rows.filter(r => !done.includes(r)).map(r => ({ i: r.i, skip: !!r.skip, byCar: r.byCar, blockedAt: r.blockedAt })), max: Math.max(...done.map(r => r.gap || 0)) });
    data.dataGaps = rows;

    // D4：从货叉前方沿右货叉走过去，被货叉挡住（不踩上去、不穿过去）
    await ev(page, k => { const w = __fk.W(k, 0.28, -3.2), c = __fk.W(k, 0.28, 0); __fk.stand(w.x, w.z, __fk.yawTo(w.x, w.z, c.x, c.z)); return 0; }, k);
    await hold(page, 'KeyW', 2.5);
    const d4 = await ev(page, k => { const l = __fk.L(k, BR.player.x, BR.player.z); return { lx: __fk.r(l.x), lz: __fk.r(l.z), feet: __fk.r(BR.player.feetY) }; }, k);
    check('D4 从货叉前方沿货叉走过去被货叉挡住（停在叉尖 -2.1 前，人没踩上货叉）', d4.lz < -2.1 - 0.25 && d4.lz > -2.1 - 0.3 - 0.1 && Math.abs(d4.feet) < 0.02, d4);

    // D5：人为在货叉范围里放一个物资（这一块的地上物资，挪过去写进 levelState）后重载区块：1 帧内被推到所有 OBB 外面
    const d5a = await ev(page, k => {
      const it = BR.items.list.find(p => p.chunkKey === '0,0' && !p.owner && !p.dropped && !p.still) || BR.items.list.find(p => p.chunkKey === '0,0' && !p.owner && !p.dropped);
      if (!it) return { none: true };
      const w = __fk.W(k, -0.28, -1.6);   // 压在左货叉上
      BR.items.hold(it.id, true); BR.items.move(it.id, w.x, BR.phys.groundY(w.x, w.z), w.z); BR.items.hold(it.id, false);
      __br.step(1 / 30);
      const ls = BR.levelState.getItem ? BR.levelState.getItem('1', it.id) : null;
      return { id: it.id, type: it.type, w, ls, inside: __fk.itemInCar(k, it.id) };
    }, k);
    if (d5a.none) check('D5 出生块里有一件地上物资可以挪', false, d5a);
    else {
      // 走远到 0,0 卸载，再回来
      await ev(page, () => { __fk.stand(16 + 32 * 7, 30, 0); __br.step(1.5); return 0; });
      const unl = await ev(page, () => !BR.world.chunks().some(c => c.key === '0,0'));
      await ev(page, () => { __fk.stand(16, 30, 0); return 0; });
      let frames = 0, res = null;
      for (let i = 0; i < 300 && !res; i++) {
        const r = await ev(page, a => {
          __br.step(1 / 30);
          const c = BR.world.chunks().find(q => q.key === '0,0');
          const p = BR.items.find(a.id);
          if (!c || !p) return null;
          return { x: p.x, y: p.y, z: p.z, inside: __fk.itemInCar(a.k, a.id), r: p.r };
        }, { id: d5a.id, k });
        frames++;
        if (r) {
          // 刚载入的这一帧已经推出来了，或者再过 1 帧推出来
          if (r.inside) { const r2 = await ev(page, a => { __br.step(1 / 30); const p = BR.items.find(a.id); return p ? { x: p.x, y: p.y, z: p.z, inside: __fk.itemInCar(a.k, a.id) } : null; }, { id: d5a.id, k }); res = { first: r, second: r2, ok: !!r2 && !r2.inside }; }
          else res = { first: r, ok: true };
        }
      }
      check('D5 货叉范围里放一件物资、区块卸掉再载回来：1 帧内被推到所有 OBB 外面', d5a.inside && unl && !!res && res.ok, { d5a, unl, frames, res });
    }

    // 保底种子：出生柱间有车（runtime），debugInfo().tiers 高画质 'mid'、低画质 'drvLow'
    const fseeds = fallbackSeeds();
    const fseed = fseeds[0];
    for (const q of ['high', 'low']) {
      await startL1(page, { seed: fseed, quality: q });
      await step(page, 0.5);
      const r = await ev(page, () => {
        const k = __fk.spawnKey(), f = k && __fk.fkData(k), di = BR.vehicles.debugInfo();
        return { k, runtime: f && f.runtime, spans: f && f.spans, x: f && f.x, z: f && f.z, tier: k ? di.tiers[k] : null, promoted: di.promoted, obbs: k ? __fk.obbs(k).length : 0 };
      });
      const want = q === 'high' ? 'mid' : 'drvLow';
      check('D6 保底种子 ' + fseed + '（' + (q === 'high' ? '高' : '低') + '画质）：出生柱间有车（runtime、没有 spans）、14 个 OBB、debugInfo().tiers = ' + want, !!r.k && r.runtime === true && !r.spans && r.obbs === 14 && r.tier === want, r);
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// mount
// =====================================================================
async function gMount(browser) {
  const { ctx, page } = await boot(browser, 'mount');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    if (!k) { check('M0 出生柱间有车', false); return; }
    // 侧面 1.2 m 对准：「空格 上车」
    let c = await ev(page, k => { __fk.standL(k, -1.2, 0.24); const cur = __fk.aimL(k, 0, 1.25, 0.24); return { cur, p: __fk.prompt() }; }, k);
    check('M1 左侧 1.2 m 对准车身：提示「空格 上车」（候选 kind vehicle、label 叉车）', !!c.cur && c.cur.kind === 'vehicle' && c.cur.label === '叉车' && c.cur.short && c.cur.short.ok && c.cur.short.verb === '上车' && /^空格 ?上车/.test(c.p) && NO_E(c.p), c);
    await shot(page, 'm1-side');
    c = await ev(page, k => { __fk.standL(k, 1.2, 0.24); const cur = __fk.aimL(k, 0, 1.25, 0.24); return { cur, p: __fk.prompt() }; }, k);
    check('M1b 右侧 1.2 m 对准车身：也是「空格 上车」', !!c.cur && c.cur.kind === 'vehicle' && c.cur.short && c.cur.short.ok && /^空格 ?上车/.test(c.p), c);
    // 货叉前方 / 车尾：「绕到侧面上车」
    c = await ev(page, k => { __fk.standL(k, 0, -3.0); const cur = __fk.aimL(k, 0, 1.3, -0.95); return { cur, p: __fk.prompt() }; }, k);
    check('M2 站在货叉前方对准门架：灰字「绕到侧面上车」', !!c.cur && c.cur.kind === 'vehicle' && c.cur.short && !c.cur.short.ok && c.cur.short.why === '绕到侧面上车' && c.p === '绕到侧面上车', c);
    await shot(page, 'm2-front');
    c = await ev(page, k => { __fk.standL(k, 0, 2.5); const cur = __fk.aimL(k, 0, 1.0, 1.0); return { cur, p: __fk.prompt() }; }, k);
    check('M2b 站在车尾后面对准配重：灰字「绕到侧面上车」', !!c.cur && c.cur.kind === 'vehicle' && c.cur.short && !c.cur.short.ok && c.p === '绕到侧面上车', c);
    // 侧面 2.0 m：「再走近一点」
    c = await ev(page, k => { __fk.standL(k, -2.0, 0.24); const cur = __fk.aimL(k, 0, 1.25, 0.24); return { cur, p: __fk.prompt() }; }, k);
    check('M3 侧面 2.0 m 对准：灰字「再走近一点」', !!c.cur && c.cur.kind === 'vehicle' && c.cur.short && !c.cur.short.ok && c.p === '再走近一点', c);
    // 长按：「叉车太重，拖不动」，车一点不动
    const p0 = await ev(page, k => { __fk.standL(k, -1.2, 0.24); __fk.aimL(k, 0, 1.25, 0.24); __fk.clear(); return __fk.pose(k); }, k);
    await hold(page, 'Space', 0.7);
    await step(page, 0.3);
    const lp = await ev(page, k => ({ pose: __fk.pose(k), toasts: __fk.toasts.slice(), st: BR.interact.state, seat: __fk.seat(), deny: __fk.evs('interact:deny') }), k);
    const still = Math.abs(lp.pose.x - p0.x) + Math.abs(lp.pose.z - p0.z) + Math.abs(lp.pose.yaw - p0.yaw) < 1e-9;
    check('M4 长按空格：提示「叉车太重，拖不动」，车一点不动，没上车', still && lp.toasts.some(t => t === '叉车太重，拖不动') && !lp.seat.seated && lp.seat.mode === 'walk', lp);

    // 短按上车：0.6 s 内 drive；插值途中相机不进车身 OBB；落座后眼点和 geo.eye 差 <2 cm
    await ev(page, k => { __fk.standL(k, -1.2, 0.24); __fk.aimL(k, 0, 1.25, 0.24); __fk.clear(); return 0; }, k);
    await page.keyboard.down('Space'); await step(page, 0.1); await page.keyboard.up('Space');
    const path1 = [];
    let first = null;
    for (let i = 0; i < 18; i++) {
      const f = await ev(page, k => {
        __br.step(1 / 30);
        const c = __fk.cam();
        return { c, inObb: __fk.inCar(k, c.x, c.y, c.z, 0), st: __fk.seat() };
      }, k);
      path1.push(f);
      if (!first && f.st.mode === 'drive') first = i;
    }
    const m5 = await ev(page, k => {
      const G = __fk.geo(), e = G.eye || { x: 0, y: 1.8, z: 0.16 }, w = __fk.W(k, e.x, e.z, e.y), c = __fk.cam();
      return { seat: __fk.seat(), eye: w, cam: c, P: { x: BR.player.x, y: BR.player.y, z: BR.player.z }, d: Math.hypot(c.x - w.x, c.y - w.y, c.z - w.z), touch: __fk.touchBtn('interact') };
    }, k);
    const t5 = 0.1 + (path1.length) / 30;
    check('M5 短按空格：0.6 s 内 interact.mode drive、input 情境 drive', m5.seat.mode === 'drive' && m5.seat.ctx === 'drive' && m5.seat.seated === k && first != null && first <= 14, { first, t5, seat: m5.seat });
    if (m5.touch) check('M5b 触屏「互动」键文字变成「下车」', m5.touch.text === '下车', m5.touch);
    check('M6 落座后眼点和 geo.eye 的世界坐标相差 <2 cm', m5.d < 0.02, m5);
    const inside = path1.filter(f => f.inObb);
    check('M7 上车插值途中每一帧相机点都不在任何车身 OBB 里', inside.length === 0, inside.slice(0, 3));
    // 起动：0.6 s 起 0.8 s 不让走
    const pre = await ev(page, k => ({ pose: __fk.pose(k), t: BR.vehicles.debugInfo().phase }), k);
    await page.keyboard.down('KeyW');
    let maxPhase = pre.t;
    for (let i = 0; i < 6; i++) { await step(page, 0.1); const ph = await ev(page, () => BR.vehicles.debugInfo().phase); if (ph === 'run') break; maxPhase = ph; }
    const mid = await ev(page, k => ({ pose: __fk.pose(k), phase: BR.vehicles.debugInfo().phase, notes: __fk.notes.slice() }), k);
    await page.keyboard.up('KeyW');
    await step(page, 0.6);
    const dmove = Math.hypot(mid.pose.x - pre.pose.x, mid.pose.z - pre.pose.z);
    check('M8 起动的 0.8 s 里按 W：位移 <1 cm，提示「发动中」', dmove < 0.01 && mid.notes.includes('发动中') && (mid.phase === 'start' || mid.phase === 'seat'), { dmove, mid: { phase: mid.phase, notes: mid.notes }, prePhase: pre.t });
    const s9 = await ev(page, k => ({ sounds: __fk.sounds.slice(), loops: Object.assign({}, __fk.loopsOn), phase: BR.vehicles.debugInfo().phase, light: BR.vehicles.debugInfo().light, on: __fk.pose(k).on }), k);
    check('M9 落座「吱」fk_seat、点火 fk_ignite、着车后 fk_engine 循环在播、大灯借了灯池', s9.sounds.includes('fk_seat') && s9.sounds.includes('fk_ignite') && (s9.loops.fk_engine || 0) > 0 && s9.phase === 'run' && !!s9.light && s9.on === 1, s9);
    // 常驻提示行、中间提示、整页没有 E
    const t10 = await ev(page, () => ({ line: __fk.driveLine(), p: __fk.prompt(), hud: __fk.hudText() }));
    check('M10 常驻开车提示行逐字等于「' + SPEC_DRIVE_DESK + '」', t10.line === SPEC_DRIVE_DESK, { line: t10.line });
    check('M11 中间提示「空格 下车」', /^空格 ?下车$/.test(t10.p), t10.p);
    check('M12 整页 HUD 文字不出现字母 E', NO_E(t10.hud), t10.hud.slice(0, 300));
    await shot(page, 'm10-seated', true);
    // 准心对着哪里都是「空格 下车」：抬头、低头、回头
    const views = [];
    for (const [dy, dp] of [[0, 0.9], [0, -1.0], [Math.PI, 0], [1.2, 0.3]]) {
      views.push(await ev(page, a => { BR.player.yaw += a[0]; BR.player.pitch = a[1]; __br.step(1 / 30); return __fk.prompt(); }, [dy, dp]));
    }
    check('M13 抬头、低头、回头、侧看：中间提示都是「空格 下车」', views.every(v => /^空格 ?下车$/.test(v)), views);
    // 坐在车上丢不了东西
    const q0 = await ev(page, () => { BR.player.addItem('canned_food', 1); const i = BR.player.inventory.findIndex(s => s && s.type === 'canned_food'); BR.player.select(i); __br.step(0.05); return { n: BR.player.countOf('canned_food'), drops: BR.items.list.filter(p => p.dropped).length }; });
    await tap(page, 'KeyQ');
    const q1 = await ev(page, () => ({ n: BR.player.countOf('canned_food'), drops: BR.items.list.filter(p => p.dropped).length }));
    check('M14 坐在车上按 Q 丢不了东西', q1.n === q0.n && q1.drops === q0.drops, { q0, q1 });
    await ev(page, () => { BR.player.removeItem && BR.player.removeItem('canned_food', 9); return 0; });
    // 下车后恢复
    const out = await dismount(page);
    const o2 = await ev(page, () => ({ seat: __fk.seat(), line: __fk.driveLine(), p: __fk.prompt(), loops: Object.assign({}, __fk.loopsOn), light: BR.vehicles.debugInfo().light, sounds: __fk.sounds.slice(-6) }));
    check('M15 短按空格下车：回到 walk、提示行收起、发动机熄火（fk_off，循环停，大灯撤掉）', o2.seat.mode === 'walk' && o2.seat.ctx === 'walk' && !o2.seat.seated && !o2.line && !o2.light && !(o2.loops.fk_engine > 0) && o2.sounds.includes('fk_off'), { out, o2 });
    // 站在车身侧面（配重、后轮旁边 / 门架、前轮旁边）：离座椅 1.5 m 以内「空格 上车」，远了「再走近一点」，都不说「绕到侧面上车」
    const sideP = await ev(page, k => {
      const out = {};
      for (const [n, lx, lz, alz] of [['配重旁 1.0 m', -1.0, 1.15, 0.9], ['门架旁 1.0 m', -1.0, -1.0, -0.6], ['配重旁 1.6 m', -1.6, 1.2, 0.9], ['货叉旁', -1.0, -1.9, -1.0]]) {
        __fk.standL(k, lx, lz); const cur = __fk.aimL(k, -0.5, 1.0, alz);
        out[n] = { why: cur && cur.short ? (cur.short.ok ? 'ok' : cur.short.why) : null, p: __fk.prompt() };
      }
      return out;
    }, k);
    check('M16 站在车身侧面：配重旁 1.0 m「空格 上车」、门架旁 1.0 m（离座椅 1.6 m）「再走近一点」、配重旁 1.6 m「再走近一点」；货叉旁边才「绕到侧面上车」',
      sideP['配重旁 1.0 m'].why === 'ok' && sideP['门架旁 1.0 m'].why === '再走近一点' && sideP['配重旁 1.6 m'].why === '再走近一点' && sideP['货叉旁'].why === '绕到侧面上车', sideP);
    // 下车动画（0.5 s）里：准心下不闪「绕到侧面上车」，连按的第二下空格不当成「上车」（没有灰字 toast、没有拒绝的咔哒声）
    await mountCar(page, k, 'left');
    await ev(page, () => { __fk.clear(); return 0; });
    await tap(page, 'Space');
    const flash = [];
    for (let i = 0; i < 3; i++) flash.push(await ev(page, () => { __br.step(1 / 30); return { p: __fk.prompt(), ms: BR.player.mountState.phase }; }));
    // 第二下：还在下车插值里，准心对着车
    const second = await ev(page, k => { __fk.aimL(k, 0, 1.25, 0.24); return { ms: BR.player.mountState.phase, p: __fk.prompt() }; }, k);
    await page.keyboard.down('Space');
    for (let i = 0; i < 3; i++) flash.push(await ev(page, () => { __br.step(1 / 30); return { p: __fk.prompt(), ms: BR.player.mountState.phase }; }));
    await page.keyboard.up('Space');
    for (let i = 0; i < 9; i++) flash.push(await ev(page, () => { __br.step(1 / 30); return { p: __fk.prompt(), ms: BR.player.mountState.phase }; }));
    await step(page, 0.3);
    const dbl = await ev(page, () => ({ toasts: __fk.toasts.slice(), sounds: __fk.sounds.slice(), seat: __fk.seat() }));
    const outFrames = flash.filter(f => f.ms === 'out');
    check('M17 下车插值那 0.5 s：准心提示不出现「绕到侧面上车」，这时再按一下空格不弹灰字、不响拒绝声，人好好站在地上',
      second.ms === 'out' && outFrames.length > 0 && outFrames.every(f => f.p !== '绕到侧面上车') && !dbl.toasts.includes('绕到侧面上车') && !dbl.sounds.includes('click') && !dbl.seat.seated && dbl.seat.mode === 'walk', { second, outFrames: outFrames.slice(0, 4), dbl });
    // 上车插值那 0.5 s 里按空格：一落座就下车（不点火），不是没反应
    await ev(page, k => { __fk.standL(k, -1.2, 0.24); __fk.aimL(k, 0, 1.25, 0.24); __fk.clear(); return 0; }, k);
    await tap(page, 'Space');
    await step(page, 0.15);
    const midIn = await ev(page, () => ({ ms: BR.player.mountState.phase, seat: __fk.seat() }));
    await tap(page, 'Space');
    await step(page, 1.4);
    const after = await ev(page, () => ({ seat: __fk.seat(), sounds: __fk.sounds.slice(), ms: BR.player.mountState.phase }));
    check('M18 上车插值途中按空格：落座后马上下车，不点火（没有 fk_ignite），1.5 s 内回到 walk', midIn.ms === 'in' && after.seat.mode === 'walk' && !after.seat.seated && after.sounds.includes('fk_seat') && !after.sounds.includes('fk_ignite'), { midIn, after });
  } finally {
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// drive
// =====================================================================
async function gDrive(browser) {
  const { ctx, page } = await boot(browser, 'drive');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    // 试车场：南边主通道往东，先看直道畅通
    const lane = await ev(page, k => { const Y = __fk.YARD; return { sw: __fk.sweep(Y.x, Y.z, Y.yaw, 0, 30, __fk.physKey(k), 0.2), start: __fk.hitsAt(Y.x, Y.z, Y.yaw, 0, __fk.physKey(k)) }; }, k);
    info('试车场直道（往东 30 m 第一下碰到什么）', lane);
    const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    check('V0 把车摆到试车场（南主通道十字口）并上车着车', pm.placed && pm.mounted, pm);
    if (!pm.mounted) return;
    // W 2 s → 4.5 ± 0.2
    await page.keyboard.down('KeyW'); await step(page, 2.0);
    const v1 = await ev(page, k => __fk.state(k) || __fk.pose(k), k);
    await page.keyboard.up('KeyW');
    let tStop = null;
    for (let i = 0; i < 70; i++) { await step(page, 1 / 30); const s = await ev(page, k => __fk.pose(k).spd, k); if (Math.abs(s) < 0.02) { tStop = (i + 1) / 30; break; } }
    check('V1 按住 W 2.0 s 车速 4.5±0.2 m/s', Math.abs(v1.spd - 4.5) <= 0.2, { spd: v1.spd });
    check('V2 松开 W 2 s 内自己刹停', tStop != null && tStop <= 2.0, { tStop });
    // 倒车：S 先刹再倒，最快 2.5 ± 0.1，fk_reverse 在播
    await page.keyboard.down('KeyS'); await step(page, 2.0);
    const v3 = await ev(page, k => ({ spd: __fk.pose(k).spd, rev: __fk.looping('fk_reverse'), dbg: BR.vehicles.debugInfo().loops }), k);
    await page.keyboard.up('KeyS'); await step(page, 1.5);
    const v3b = await ev(page, () => __fk.looping('fk_reverse'));
    check('V3 倒车最快 2.5±0.1 m/s，倒车时 fk_reverse 在播，停下后停', Math.abs(v3.spd + 2.5) <= 0.1 && v3.rev && !v3b, { v3, after: v3b });
    // 按 A 车头往左
    await ev(page, k => { __br.step(0.1); return 0; }, k);
    const a0 = await ev(page, k => __fk.pose(k), k);
    await holdKeys(page, ['KeyW', 'KeyA'], 0.8);
    const a1 = await ev(page, k => __fk.pose(k), k);
    const f0 = { x: -Math.sin(a0.yaw), z: -Math.cos(a0.yaw) }, f1 = { x: -Math.sin(a1.yaw), z: -Math.cos(a1.yaw) };
    const L0 = { x: -Math.cos(a0.yaw), z: Math.sin(a0.yaw) };   // 本地 −x（司机左手）在世界里 = (−cos, +sin)
    const turnedLeft = f1.x * L0.x + f1.z * L0.z;
    check('V4 前进时按 A：车头往左转（后轮转向）', turnedLeft > 0.05, { turnedLeft, yaw0: a0.yaw, yaw1: a1.yaw, steer: a1.steer });
    await step(page, 1.5);
    // 低速打满方向绕一圈：车尾外角扫过的半径
    const geo = await ev(page, () => { const G = __fk.geo(); return { maxSteer: G.maxSteer, wb: BR.forklift && BR.forklift.geo && BR.forklift.geo.wheelbase }; });
    const maxSteer = geo.maxSteer || 1.13;
    const theory = Math.sqrt(Math.pow(1.42 / Math.tan(maxSteer) + 0.6, 2) + 1.92 * 1.92);
    await ev(page, () => { __br.step(0.1); return 0; });
    const circ0 = await ev(page, k => { const p = __fk.pose(k); return p; }, k);
    // 摆回十字口正中（下车、摆好、再上车）
    await dismount(page);
    const pm2 = await placeAndMount(page, k, { x: 0, z: 32.6, yaw: -Math.PI / 2 });
    await page.keyboard.down('KeyA'); await step(page, 0.7);
    await page.keyboard.down('KeyW');
    const trail = [];
    let yawAcc = 0, lastYaw = null;
    for (let i = 0; i < 160; i++) {
      const p = await ev(page, k => { __br.step(1 / 30); const p = __fk.pose(k); const a = __fk.WP(p, -0.6, 1.3), b = __fk.WP(p, 0.6, 1.3); return { x: p.x, z: p.z, yaw: p.yaw, spd: p.spd, steer: p.steer, a, b }; }, k);
      trail.push(p);
      if (lastYaw != null) { let d = p.yaw - lastYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yawAcc += d; }
      lastYaw = p.yaw;
      if (Math.abs(yawAcc) > 2 * Math.PI + 0.2) break;
    }
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await step(page, 1.0);
    // 圆心：最小二乘拟合两个后角的轨迹，取大的那个半径
    const fit = pts => {
      const n = pts.length; let sx = 0, sz = 0; for (const p of pts) { sx += p.x; sz += p.z; } const mx = sx / n, mz = sz / n;
      let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
      for (const p of pts) { const u = p.x - mx, v = p.z - mz; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
      const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-9) return null;
      const uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det, vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det;
      return { cx: uc + mx, cz: vc + mz, r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / n) };
    };
    const run = trail.filter(p => Math.abs(p.steer) > maxSteer - 0.02 && Math.abs(p.spd) > 0.2);
    const fa = run.length > 20 ? fit(run.map(p => p.a)) : null, fb = run.length > 20 ? fit(run.map(p => p.b)) : null;
    const R = fa && fb ? Math.max(fa.r, fb.r) : null;
    check('V5 低速打满方向绕一圈：车尾外角半径和理论值 ' + theory.toFixed(3) + ' m 相差 ≤10%', R != null && Math.abs(R - theory) / theory <= 0.1 && Math.abs(yawAcc) > 2 * Math.PI - 0.3, { R, theory, yawAcc, n: run.length, fa, fb, maxSpd: Math.max(...trail.map(p => Math.abs(p.spd))), placed: pm2.placed && pm2.mounted });
    // V5b：同一个圈只走模拟（测试口 _step，steer=1 = 往左打满），把「模拟本身的转弯半径」和「键盘输入」分开看
    await dismount(page);
    await ev(page, k => { __fk.place(k, 0, 32.6, -Math.PI / 2); __br.step(0.1); __fk.stand(-12, 30, 0); return 0; }, k);
    const sim5 = await ev(page, k => {
      const pts = { a: [], b: [] };
      let acc = 0, last = null, maxS = 0;
      for (let i = 0; i < 900 && Math.abs(acc) < 2 * Math.PI + 0.1; i++) {
        const p = BR.vehicles._step(1 / 30, { throttle: i < 20 ? 0 : 0.4, steer: 1, lift: 0 }, k);
        if (!p) break;
        maxS = Math.max(maxS, Math.abs(p.steer));
        if (last != null) { let d = p.yaw - last; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; acc += d; }
        last = p.yaw;
        if (Math.abs(p.steer) > 1.1 && Math.abs(p.spd) > 0.2) { pts.a.push(__fk.WP(p, -0.6, 1.3)); pts.b.push(__fk.WP(p, 0.6, 1.3)); }
      }
      return { pts, acc, maxS };
    }, k);
    const fa5 = sim5.pts.a.length > 20 ? fit(sim5.pts.a) : null, fb5 = sim5.pts.b.length > 20 ? fit(sim5.pts.b) : null;
    const R5 = fa5 && fb5 ? Math.max(fa5.r, fb5.r) : null;
    check('V5b （只走模拟 _step，steer=1）满舵绕一圈：车尾外角半径和理论值 ' + theory.toFixed(3) + ' m 相差 ≤10%', R5 != null && Math.abs(R5 - theory) / theory <= 0.1 && Math.abs(sim5.acc) > 2 * Math.PI - 0.3, { R5, theory, acc: sim5.acc, maxSteer: sim5.maxS, n: sim5.pts.a.length });
    // 全速打满方向：车速降到 ≤1.4
    await placeAndMount(page, k, { x: -26, z: 33.4, yaw: -Math.PI / 2 });
    await page.keyboard.down('KeyW'); await step(page, 2.1);
    const sp0 = await ev(page, k => __fk.pose(k).spd, k);
    await page.keyboard.down('KeyA'); await step(page, 1.1);
    const sp1 = await ev(page, k => ({ spd: __fk.pose(k).spd, steer: __fk.pose(k).steer }), k);
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW'); await step(page, 1.5);
    check('V6 全速（' + sp0.toFixed(2) + ' m/s）打满方向：车速降到 ≤1.4（不翻车）', sp0 > 4.2 && Math.abs(sp1.spd) <= 1.4 && Math.abs(sp1.spd) > 0.5 && Math.abs(sp1.steer) > maxSteer - 0.05, { sp0, sp1 });
    // 货叉底 0.6 m 时最快 ≤1.05，1.6 m 时 ≤0.65
    await dismount(page);
    await placeAndMount(page, k, { x: -30, z: 32.6, yaw: -Math.PI / 2 });
    const fb1 = await liftTo(page, k, 0.6);
    await page.keyboard.down('KeyW'); await step(page, 2.0);
    const s1 = await ev(page, k => __fk.pose(k).spd, k);
    await page.keyboard.up('KeyW'); await step(page, 1.0);
    const fb2 = await liftTo(page, k, 1.6);
    await page.keyboard.down('KeyW'); await step(page, 2.0);
    const s2 = await ev(page, k => __fk.pose(k).spd, k);
    await page.keyboard.up('KeyW'); await step(page, 1.0);
    check('V7 货叉底 0.6 m 时最快 ≤1.05 m/s', fb1 != null && s1 <= 1.05 && s1 > 0.8, { fb1, s1 });
    check('V8 货叉底 1.6 m 时最快 ≤0.65 m/s', fb2 != null && s2 <= 0.65 && s2 > 0.4, { fb2, s2 });
    await holdKeys(page, ['KeyC'], 4.0);
    // 细节档：高画质停放档 mid 的车开起来是 mid（∈ high/mid/lite）
    const t1 = await ev(page, k => ({ tier: BR.vehicles.debugInfo().tiers[k], parked: (__fk.fkData(k) || {}).detail }), k);
    check('V9 高画质：停放档 ' + t1.parked + ' 的车开起来 tier ∈ {high, mid, lite}（同档）', ['high', 'mid', 'lite'].includes(t1.tier) && (['high', 'mid', 'lite'].includes(t1.parked) ? t1.tier === t1.parked : true), t1);
    await dismount(page);
    // 停放档 low / lowb / min 的车（种子 12345 在 (2,-2) 块有两台 low）开起来是 lite。先回出生点，让出生点周围 5×5 块都载入
    await ev(page, () => { __fk.stand(16, 30, 0); __br.step(1.5); return 0; });
    const lowKey = await ev(page, () => { const v = BR.vehicles.list().find(r => { const f = __fk.fkData(r.key); return f && ['low', 'lowb', 'min'].includes(f.detail); }); return v ? v.key : null; });
    if (!lowKey) info('V10 已载入的块里没有停放档 low/lowb/min 的车，跳过');
    else {
      const pm3 = await placeAndMount(page, lowKey, { x: 8, z: 32.6, yaw: -Math.PI / 2 });
      const t2 = await ev(page, k => ({ tier: BR.vehicles.debugInfo().tiers[k], parked: (__fk.fkData(k) || {}).detail }), lowKey);
      check('V10 高画质：停放档 ' + t2.parked + ' 的车（' + lowKey + '）上车后是 lite', pm3.mounted && t2.tier === 'lite', { t2, pm3: pm3.mounted });
      await dismount(page);
    }
    // 低画质：drvLow
    await startL1(page, { seed: SEED, quality: 'low' });
    const k2 = await ev(page, () => __fk.spawnKey());
    const pm4 = await placeAndMount(page, k2, await ev(page, () => __fk.YARD));
    const t3 = await ev(page, k => ({ tier: BR.vehicles.debugInfo().tiers[k], q: BR.game.settings.quality }), k2);
    check('V11 低画质：上车后 tier === drvLow', pm4.mounted && t3.tier === 'drvLow', t3);
    await shot(page, 'v11-lowq-seat');
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// crash
// =====================================================================
// 把人挪到车起点正后方没人的地方（雷达只看行进方向，车后面的人不挡路）
async function parkPlayerBehind(page, lane) {
  return ev(page, L => {
    const f = __fk.fwd(L.yaw);
    for (const d of [6, 7, 8, 9, 10, 12, 14]) for (const side of [0, 1.5, -1.5, 3, -3]) {
      const x = L.x - f.x * d + -f.z * side, z = L.z - f.z * d + f.x * side;
      if (!BR.phys.overlapCircle(x, z, 0.3, BR.phys.groundY(x, z) + 0.02, 1.7)) { __fk.stand(x, z, L.yaw); return { x, z }; }
    }
    return null;
  }, lane);
}
async function gCrash(browser) {
  const { ctx, page } = await boot(browser, 'crash');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    // 先把车升格（摆回原位）：之后的每一圈都用 setPose 摆到起点、_step 全油门开过去
    await ev(page, k => { const p = __fk.pose(k); __fk.place(k, p.x, p.z, p.yaw, 0); __br.step(0.1); return 0; }, k);
    // 出生块 (0,0) 的格局对任何种子都一样：柱子 0.9×0.9×4、货架 7.1×2.32×3.1、小屋（中心 24,16，门朝西 x=20.8）
    const targets = await ev(page, () => {
      const S = __fk.solids('0,0');
      const pillar = S.filter(b => Math.abs(b.w - b.d) < 0.05 && b.w > 0.6 && b.w < 1.0 && b.h > 3.4);
      const rack = S.filter(b => Math.abs(b.h - 3.1) < 0.05 && Math.min(b.w, b.d) > 2.2 && Math.min(b.w, b.d) < 2.45);
      const wall = S.filter(b => Math.abs(b.h - 2.9) < 0.05 && Math.min(b.w, b.d) < 0.25 && Math.max(b.w, b.d) > 5.5);
      const seg = S.filter(b => Math.abs(b.h - 2.9) < 0.05 && Math.min(b.w, b.d) < 0.25 && Math.max(b.w, b.d) > 2 && Math.max(b.w, b.d) < 3);
      // 门洞：两段共线的墙中间空 1.16 m
      let door = null;
      for (const a of seg) for (const b of seg) {
        if (a === b) continue;
        if (a.w < 0.25 && b.w < 0.25 && Math.abs(a.minX - b.minX) < 0.01 && b.minZ > a.maxZ && Math.abs(b.minZ - a.maxZ - 1.16) < 0.05) door = { minX: a.minX, maxX: a.maxX, minZ: a.maxZ, maxZ: b.minZ, minY: 0, maxY: 2.13, w: a.w, d: 1.16, h: 2.13 };
        if (a.d < 0.25 && b.d < 0.25 && Math.abs(a.minZ - b.minZ) < 0.01 && b.minX > a.maxX && Math.abs(b.minX - a.maxX - 1.16) < 0.05) door = { minX: a.maxX, maxX: b.minX, minZ: a.minZ, maxZ: a.maxZ, minY: 0, maxY: 2.13, w: 1.16, d: a.d, h: 2.13 };
      }
      return { pillar, rack, wall, door, nSeg: seg.length };
    });
    info('出生块里认出的目标：柱子 ' + targets.pillar.length + '、货架 ' + targets.rack.length + '、小屋墙 ' + targets.wall.length + '、门洞 ' + (targets.door ? 1 : 0));
    const kinds = [['柱子', targets.pillar], ['货架', targets.rack], ['小屋墙', targets.wall], ['门框', targets.door ? [targets.door] : []]];
    let doorLane = null;
    for (const [name, list] of kinds) {
      let lane = null, box = null;
      for (const b of list) {
        lane = await ev(page, a => __fk.laneTo(a.k, a.b, { runs: [5, 4.5, 4, 3.5, 3, 2.5] }), { k, b });
        if (lane) { box = b; break; }
      }
      if (!lane) { check('C1 ' + name + '：找到一条能全速撞上去的直道', false, { n: list.length }); continue; }
      if (name === '门框') doorLane = { lane, box };
      const rows = [];
      for (let i = 0; i < 5; i++) {
        await ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(1 / 30); return 0; }, { k, l: lane });
        await parkPlayerBehind(page, lane);
        const r = await ev(page, a => {
          __fk.clear();
          const res = __fk.drive(a.k, { throttle: 1, steer: 0, lift: 0 }, 6, { untilStop: true });
          const pen = __fk.pen(a.k, 0.01);
          return { t: res.t, vmax: res.vmax, moved: res.moved, pen, bang: __fk.sounds.includes('fk_bang'), sounds: __fk.sounds.slice(0, 6) };
        }, { k, l: lane });
        rows.push(r);
      }
      const okAll = rows.every(r => r.pen.length === 0 && r.bang && r.moved > lane.run - 0.35);
      check('C1 全速撞' + name + ' 5 次：每次停下后 14 个 OBB 和静态碰撞体重叠 <1 cm，fk_bang 在播（直道 ' + lane.run + ' m）', okAll, { lane: { x: +lane.x.toFixed(2), z: +lane.z.toFixed(2), yaw: +lane.yaw.toFixed(2), run: lane.run }, box, rows });
    }
    await shot(page, 'c1-after');
    // 小屋门开不进去：车身（底盘、引擎盖、配重、护顶立柱）没越过门洞所在的墙面
    if (doorLane) {
      const r = await ev(page, a => {
        const { k, d } = a;
        const p = __fk.pose(k), f = __fk.fwd(p.yaw);
        // 门洞墙面（车来的那一面）：沿车头方向的近面
        const near = Math.abs(f.x) > 0.5 ? (f.x > 0 ? d.minX : d.maxX) : (f.z > 0 ? d.minZ : d.maxZ);
        const deep = [];
        for (const o of __fk.obbs(k)) {
          if (!/chassis|hood|counterweight|dash|post|roof/.test(o.name)) continue;
          const c = Math.cos(o.rot), s = Math.sin(o.rot);
          for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = o.cx + c * u * o.hx + s * w * o.hz, z = o.cz - s * u * o.hx + c * w * o.hz;
            const past = Math.abs(f.x) > 0.5 ? (x - near) * Math.sign(f.x) : (z - near) * Math.sign(f.z);
            if (past > 0.01) deep.push(o.name + ':' + past.toFixed(3));
          }
        }
        return { deep, pose: { x: p.x, z: p.z }, near };
      }, { k, d: doorLane.box });
      check('C2 小屋门（1.16 m）比车窄，开不进去：车身没越过门洞那面墙', r.deep.length === 0, r);
    }
    // 车轮挡（12 cm）：开不过去。出生点周围找一个（种子 12345 在 (1,0) 块）
    const stops = await ev(page, () => __fk.allSolids(b => Math.abs(b.h - 0.12) < 0.01 && Math.max(b.w, b.d) > 1.4 && Math.min(b.w, b.d) < 0.25));
    let stopDone = false;
    for (const b of stops) {
      const lane = await ev(page, a => __fk.laneTo(a.k, a.b, { runs: [3.5, 3, 2.5, 2], offs: [0] }), { k, b });
      if (!lane) continue;
      await ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(1 / 30); return 0; }, { k, l: lane });
      await parkPlayerBehind(page, lane);
      const r = await ev(page, a => {
        __fk.clear();
        const res = __fk.drive(a.k, { throttle: 1, steer: 0, lift: 0 }, 6, { untilStop: true });
        const p = __fk.pose(a.k), f = __fk.fwd(p.yaw), b = a.b;
        // 车的中心没越过车轮挡；所有 OBB 都在车轮挡来的这一侧
        const far = Math.abs(f.x) > 0.5 ? (f.x > 0 ? b.maxX : b.minX) : (f.z > 0 ? b.maxZ : b.minZ);
        const past = [];
        for (const o of __fk.obbs(a.k)) {
          const c = Math.cos(o.rot), s = Math.sin(o.rot);
          for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = o.cx + c * u * o.hx + s * w * o.hz, z = o.cz - s * u * o.hx + c * w * o.hz;
            const d = Math.abs(f.x) > 0.5 ? (x - far) * Math.sign(f.x) : (z - far) * Math.sign(f.z);
            const lat = Math.abs(f.x) > 0.5 ? (z >= b.minZ - 0.05 && z <= b.maxZ + 0.05) : (x >= b.minX - 0.05 && x <= b.maxX + 0.05);
            if (d > 0.01 && lat) past.push(o.name);
          }
        }
        return { res: { t: res.t, vmax: res.vmax, moved: res.moved }, pen: __fk.pen(a.k, 0.01), past, y: p.y };
      }, { k, l: lane, b });
      check('C3 地上 12 cm 高的车轮挡开不上去：车停在它跟前、没有越过、没压进去', r.pen.length === 0 && r.past.length === 0 && Math.abs(r.y) < 0.01 && r.res.moved > lane.run - 0.4, { stop: b, lane: { run: lane.run, yaw: lane.yaw }, r });
      stopDone = true;
      break;
    }
    if (!stopDone) check('C3 出生点周围找到一个能开过去撞的车轮挡', false, { n: stops.length });

    // C10 货叉推着地上的东西全速撞墙（FE1 返修 r3 裁定 ②）：算「哐」（声音、镜头抖），叉上的罐头照 ① 甩出去；
    // 被推的东西停在车和墙之间，不穿墙、不压进货叉；车一路推着它开到墙跟前才停（不是推着东西一帧停死、只「咚」一声）
    {
      let lane = null;
      for (const b of targets.wall) { lane = await ev(page, a => __fk.laneTo(a.k, a.b, { runs: [5, 4.5, 4], offs: [0, 0.3, -0.3] }), { k, b }); if (lane) { lane.box = b; break; } }
      if (!lane) check('C10 找到一条能全速撞上小屋墙的直道', false, { n: targets.wall.length });
      else {
        // 车摆到起点；右叉正前方、离墙 0.6 m 放一份蛾子果冻（地上的物资）；两根货叉上各放一只罐头
        const set = await ev(page, a => {
          __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.1);
          const G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]);
          const w = __fk.W(a.k, 0.28, tip - (a.l.contact - 0.6));
          if (BR.items.find('c10jelly')) BR.items.remove('c10jelly');
          const id = __fk.item('moth_jelly', w.x, w.z, 'c10jelly');
          const ok = [__fk.putOnFork(a.k, 'c10a', 'canned_food', -0.28, -1.8), __fk.putOnFork(a.k, 'c10b', 'canned_food', 0.28, -1.8)];
          __br.step(0.1);
          return { id, ok, it: __fk.it('c10jelly'), riders: BR.vehicles.debugInfo().riders[a.k] || [] };
        }, { k, l: lane });
        const pm = await mountCar(page, k, 'left');
        // 镜头抖：记下 handle.update 交给 player 的 shake（米）最大值
        await ev(page, () => {
          const H = BR.vehicles.handle;
          if (!H.__fkWrap) { const o = H.update; H.update = function () { const r = o.apply(this, arguments); if (r && r.shake > (window.__fkShake || 0)) window.__fkShake = r.shake; return r; }; H.__fkWrap = 1; }
          window.__fkShake = 0; __fk.clear(); __fk.hoverReset(); return 0;
        });
        const ids = ['c10a', 'c10b'];
        await page.keyboard.down('KeyW');
        let vmax = 0, inCar = [];
        const bad = [];
        for (let i = 0; i < 200; i++) {
          const r = await ev(page, a => { __br.step(1 / 30); return { v: __fk.pose(a.k).spd, bad: __fk.fallBad(a.k, a.ids).concat(__fk.hover(a.k, a.ids)), jc: __fk.itemInCar(a.k, 'c10jelly') }; }, { k, ids });
          vmax = Math.max(vmax, r.v); bad.push(...r.bad); if (r.jc) inCar.push(i + ':' + r.jc);
          if (i > 20 && Math.abs(r.v) < 0.02) break;
        }
        await page.keyboard.up('KeyW');
        for (let i = 0; i < 45; i++) { const r = await ev(page, a => { __br.step(1 / 30); return __fk.fallBad(a.k, a.ids).concat(__fk.hover(a.k, a.ids)); }, { k, ids }); bad.push(...r); }
        const res = await ev(page, a => {
          const p = __fk.pose(a.k), f = __fk.fwd(p.yaw), b = a.b, G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]);
          const near = Math.abs(f.x) > 0.5 ? (f.x > 0 ? b.minX : b.maxX) : (f.z > 0 ? b.minZ : b.maxZ);
          const along = (x, z) => Math.abs(f.x) > 0.5 ? (x - p.x) * Math.sign(f.x) : (z - p.z) * Math.sign(f.z);
          // r：推东西时车按的半径（forklift.js itemR：包围球半径 × 0.8，不小于 4 cm）—— 被推的东西离车、离墙都按它算
          const j = BR.items.find('c10jelly'), r = j ? Math.max(0.04, (j.r || 0.1) * 0.8) : 0;
          const wallAt = along(Math.abs(f.x) > 0.5 ? near : p.x, Math.abs(f.x) > 0.5 ? p.z : near), tipAt = -tip, jAt = j ? along(j.x, j.z) : null;
          const jo = j ? { cx: j.x, cz: j.z, hx: r * 0.85, hz: r * 0.85, rot: p.yaw, minY: j.y + 0.005, maxY: j.y + __fk.tall(j) - 0.005 } : null;
          const t = BR.vehicles.debugInfo().throws;
          return { shake: window.__fkShake, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)), throws: t.slice(-1), wallAt: __fk.r(wallAt), tipAt: __fk.r(tipAt), jAt: jAt == null ? null : __fk.r(jAt), r: __fk.r(r),
            jInWall: jo ? BR.phys.overlapOBB(jo, { tol: 0.005, ignoreKey: __fk.physKey(a.k) }) : null, jInCar: __fk.itemInCar(a.k, 'c10jelly'), pen: __fk.pen(a.k, 0.01),
            reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), st: __fk.lieState(a.k, a.ids) };
        }, { k, b: lane.box, ids });
        check('C10 右叉推着地上的蛾子果冻全速（' + vmax.toFixed(2) + ' m/s）撞上小屋墙：「哐」不是「咚」，镜头抖了一下（' + (res.shake * 100).toFixed(1) + ' cm）',
          pm.ok && set.ok.every(Boolean) && vmax >= 3 && res.sounds.includes('fk_bang') && !res.sounds.includes('fk_bump') && (res.shake > 0 || res.reduced), { pm: pm.st, set, vmax, res: { shake: res.shake, sounds: res.sounds, reduced: res.reduced } });
        check('C10 果冻停在叉尖和墙之间（叉尖 ' + res.tipAt + '、果冻 ' + res.jAt + '、墙面 ' + res.wallAt + '，半径 ' + res.r + '），不穿墙、一路都没压进货叉；车没压进墙',
          res.jAt != null && res.jAt >= res.tipAt + res.r - 0.01 && res.jAt <= res.wallAt - res.r + 0.01 && !res.jInWall && !res.jInCar && inCar.length === 0 && res.pen.length === 0, { res, inCar: inCar.slice(0, 5) });
        // 车一路推着它开到墙跟前才停（不是推着东西一帧停死）：果冻贴着墙（离墙 ≤2 cm），叉尖离墙不超过果冻直径 + 2 cm（返修 r4 补的断言）
        check('C10 车一路把果冻推到墙跟前才停：果冻离墙 ' + ((res.wallAt - res.jAt - res.r) * 100).toFixed(1) + ' cm（≤2）、叉尖离墙 ' + ((res.wallAt - res.tipAt) * 100).toFixed(1) + ' cm（≤ 果冻直径 + 2 = ' + ((2 * res.r + 0.02) * 100).toFixed(1) + '）',
          res.jAt != null && res.wallAt - res.jAt - res.r <= 0.02 && res.wallAt - res.tipAt <= 2 * res.r + 0.02, res);
        const t = res.throws[0];
        check('C10 叉上的两只罐头照 ① 甩出去（撞前 ' + (t ? t.v0 : '?') + ' m/s，' + (t && t.how ? t.how.map(h => h[1]).join(' / ') : '?') + '）：落在地上静静躺着，每一帧都没穿过货叉、车身、墙和果冻，' +
          '还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退',
          !!t && t.v0 >= 2 && t.list.length === 2 && res.st.every(c => !c.gone && !c.onFork && !c.held && c.still && Math.abs(c.y - c.ground) < 0.01) && bad.length === 0, { t, st: res.st, bad: bad.slice(0, 6) });
        await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return 0; });
        await dismount(page);
        // 截图：下车后站到车右前方，看叉尖、果冻和墙跟
        await ev(page, k => __fk.viewL(k, 1.9, -1.2, 0.2, 0.1, -2.25), k);
        await shot(page, 'c10-pushed-into-wall');
        await ev(page, () => { for (const id of ['c10a', 'c10b', 'c10jelly']) if (BR.items.find(id)) BR.items.remove(id); return 0; });
      }
    }


    // 雷达：坐上车，测试人在叉尖前 1.4 m，按 W 车不动；挪到 1.6 m 能开
    const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    const dum = await ev(page, k => { const w = __fk.W(k, 0, -2.1 - 1.4); const id = __fk.dummy(w.x, w.z, 'fkdummy'); __br.step(0.1); __fk.clear(); return { id, w, p0: __fk.pose(k) }; }, k);
    await hold(page, 'KeyW', 1.5);
    const r4 = await ev(page, a => ({ p: __fk.pose(a.k), sounds: __fk.sounds.slice(), notes: __fk.notes.slice() }), { k });
    const mv4 = Math.hypot(r4.p.x - dum.p0.x, r4.p.z - dum.p0.z);
    check('C4 测试人站在车前 1.4 m：按 W 车不动，fk_radar 在播，提示「雷达自动刹车」', pm.mounted && !!dum.id && mv4 < 0.01 && r4.sounds.includes('fk_radar') && r4.notes.includes('雷达自动刹车'), { mv4, sounds: r4.sounds, notes: r4.notes, dum });
    const p5 = await ev(page, a => { const w = __fk.W(a.k, 0, -2.1 - 1.6); __fk.moveEnt(a.id, w.x, w.z); __br.step(0.1); return __fk.pose(a.k); }, { k, id: dum.id });
    await hold(page, 'KeyW', 0.8);
    const p6 = await ev(page, k => __fk.pose(k), k);
    const mv5 = Math.hypot(p6.x - p5.x, p6.z - p5.z);
    check('C5 测试人挪到 1.6 m：按 W 车能开', mv5 > 0.05, { mv5 });
    await ev(page, id => { __fk.dropEnt(id); __br.step(0.1); return 0; }, dum.id);
    // 地上的瓶子：开过去被推开，始终不在车的 OBB 里
    await dismount(page);
    await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    const bot = await ev(page, k => { const w = __fk.W(k, 0.28, -4.0); const id = __fk.item('almond_water', w.x, w.z, 'fkbottle'); __br.step(0.1); const p = __fk.it(id); return { id, p }; }, k);
    const inside = [];
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 75; i++) {
      const r = await ev(page, a => { __br.step(1 / 30); return __fk.itemInCar(a.k, a.id); }, { k, id: bot.id });
      if (r) inside.push(i + ':' + r);
    }
    await page.keyboard.up('KeyW'); await step(page, 1.0);
    const bot2 = await ev(page, id => __fk.it(id), bot.id);
    const pushed = bot.p && bot2 ? Math.hypot(bot2.x - bot.p.x, bot2.z - bot.p.z) : 0;
    check('C6 地上的瓶子：车开过去被推开（挪了 ' + pushed.toFixed(2) + ' m），始终不在车的 OBB 里', !!bot.id && pushed > 0.3 && inside.length === 0, { inside: inside.slice(0, 5), bot, bot2 });
    await dismount(page);

    // 贴墙：一堵测试墙（phys 里加一块 12 m 长的 AABB），车和墙平行、相距 2 cm
    const WALL = { minX: -3, maxX: 9, minY: 0, maxY: 3, minZ: 29.9, maxZ: 30.1 };
    const wz = WALL.maxZ + 0.02 + 0.595;
    await ev(page, W => { BR.phys.addSolids('fktest|wall', [W]); return 0; }, WALL);
    const gapOf = () => ev(page, a => {
      let minZ = Infinity;
      for (const o of __fk.obbs(a.k)) {
        const c = Math.cos(o.rot), s = Math.sin(o.rot);
        for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) minZ = Math.min(minZ, o.cz - s * u * o.hx + c * w * o.hz);
      }
      return { gap: minZ - a.W.maxZ, p: __fk.pose(a.k), pen: __fk.pen(a.k, 0.01) };
    }, { k, W: WALL });
    const pmw = await placeAndMount(page, k, { x: -1, z: wz, yaw: -Math.PI / 2 }, 'right');
    const g0 = await gapOf();
    await ev(page, () => { __fk.clear(); return 0; });
    await holdKeys(page, ['KeyD', 'KeyW'], 1.5);
    const g1 = await gapOf();
    const n1 = await ev(page, () => __fk.notes.slice());
    check('C7 贴墙（相距 ' + (g0.gap * 100).toFixed(1) + ' cm）往离墙方向打方向加 W：车停住，提示「车尾会往外甩，先倒车带出来」', pmw.mounted && Math.abs(g0.gap - 0.02) < 0.01 && n1.includes('车尾会往外甩，先倒车带出来') && g1.pen.length === 0 && Math.hypot(g1.p.x - g0.p.x, g1.p.z - g0.p.z) < 0.3, { g0, g1, notes: n1 });
    await holdKeys(page, ['KeyD', 'KeyS'], 3.0);
    const g2 = await gapOf();
    check('C8 改成打着方向加 S：3 s 内车身离墙 ≥0.3 m', g2.gap >= 0.3 && g2.pen.length === 0, g2);
    await dismount(page);
    await placeAndMount(page, k, { x: -1, z: wz, yaw: -Math.PI / 2 }, 'right');
    const g3 = await gapOf();
    await hold(page, 'KeyW', 2.0);
    const g4 = await gapOf();
    const along = g4.p.x - g3.p.x;
    check('C9 不打方向加 W：能沿墙开走 ≥2 m', along >= 2 && g4.pen.length === 0, { along, g3, g4 });
    await dismount(page);
    await ev(page, () => { BR.phys.removeSolids('fktest|wall'); return 0; });
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// lift
// =====================================================================
// 车某个部件 OBB 的世界顶 / 底（phys 里登记的那份）
function partsOf(page, k) {
  return ev(page, k => { const o = {}; for (const b of __fk.obbs(k)) o[b.name] = { minY: b.minY, maxY: b.maxY, cx: b.cx, cz: b.cz, hx: b.hx, hz: b.hz, rot: b.rot }; return o; }, k);
}
async function gLift(browser) {
  const { ctx, page } = await boot(browser, 'lift');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    if (!pm.mounted) { check('L0 上车', false, pm); return; }
    // R 1 s
    const s0 = await ev(page, k => { __fk.clear(); return __fk.state(k); }, k);
    await page.keyboard.down('KeyR'); await step(page, 1.0);
    const s1 = await ev(page, k => ({ st: __fk.state(k), hyd: __fk.looping('fk_hydraulic') }), k);
    await page.keyboard.up('KeyR'); await step(page, 1 / 30);
    const s2 = await ev(page, k => __fk.state(k), k);
    await step(page, 0.3);
    const s3 = await ev(page, k => __fk.state(k), k);
    const rise = s1.st.carriage - s0.carriage;
    check('L1 按住 R 1.0 s：货叉架升高 0.45±0.03 m，内门架 = 货叉架 / 2，升降杆 >0.3 rad，液压泵在响', Math.abs(rise - 0.45) <= 0.03 && Math.abs(s1.st.inner - s1.st.carriage / 2) < 1e-3 && s1.st.lever > 0.3 && s1.hyd, { rise, s1 });
    check('L2 松开 R 当帧就停（之后不再升），杆子回中', Math.abs(s2.carriage - s1.st.carriage) < 1e-6 && Math.abs(s3.carriage - s1.st.carriage) < 1e-6 && Math.abs(s3.lever) < 0.05, { s1: s1.st.carriage, s2: s2.carriage, s3: { c: s3.carriage, lever: s3.lever } });
    await shot(page, 'l1-raised');
    await ev(page, () => { __fk.clear(); return 0; });
    await hold(page, 'KeyC', 2.0);
    const s4 = await ev(page, k => ({ st: __fk.state(k), sounds: __fk.sounds.slice() }), k);
    check('L3 按住 C 降到底：货叉架 0，fk_end 「咔」', s4.st.carriage < 1e-6 && s4.sounds.includes('fk_end'), s4);

    // 管子正下方按住 R：停在管子底面以下 1–3 cm，提示「上面有管子，升不上去」，fk_strain
    await dismount(page);
    const spot = await ev(page, k => {
      // 出生块 (0,0) 的 overhead 里沿 z 的管子（管底低于满升时的门架顶），车横过来、门架（本地 z ≈ −1.05）正好在管子下面
      const c = BR.world.chunks().find(q => q.key === '0,0');
      const oh = (c.res.data.overhead || []).filter(o => o.kind === 'pipe' && (o.sub === 'main' || !o.sub) && o.y < 3.4);
      const pk = __fk.physKey(k);
      for (const o of oh) {
        const alongZ = (o.maxZ - o.minZ) > (o.maxX - o.minX);
        const pc = alongZ ? (o.minX + o.maxX) / 2 : (o.minZ + o.maxZ) / 2;
        for (const yaw of alongZ ? [-Math.PI / 2, Math.PI / 2] : [0, Math.PI]) {
          const f = __fk.fwd(yaw);
          for (let t = 0.5; t < 31.5; t += 0.5) {
            // 门架在本地 z −1.05：车中心 = 管子中线 − 车头方向 × 1.05
            const x = alongZ ? pc - f.x * 1.05 : (o.minX + t), z = alongZ ? (o.minZ + t) : pc - f.z * 1.05;
            if (alongZ && (z < o.minZ + 1 || z > o.maxZ - 1)) continue;
            if (!alongZ && (x < o.minX + 1 || x > o.maxX - 1)) continue;
            if (__fk.hitsAt(x, z, yaw, 0, pk).length) continue;
            // 车后面留 1.5 m 能倒出来
            if (__fk.hitsAt(x - f.x * 1.5, z - f.z * 1.5, yaw, 0, pk).length) continue;
            // 两侧至少一边站得下人上车
            const L = __fk.WP({ x, z, yaw }, -1.2, 0.24), R = __fk.WP({ x, z, yaw }, 1.2, 0.24);
            if (BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) && BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7)) continue;
            return { x, z, yaw, pipe: o };
          }
        }
      }
      return null;
    }, k);
    if (!spot) check('L4 出生块里找到一根车能停到下面的管子', false);
    else {
      const side = await ev(page, a => { const L = __fk.WP(a, -1.2, 0.24); return BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) ? 'right' : 'left'; }, spot);
      const pm2 = await placeAndMount(page, k, spot, side);
      await ev(page, () => { __fk.clear(); return 0; });
      await hold(page, 'KeyR', 6.5);   // 满升要 2.6 / 0.45 ≈ 5.8 s
      const r = await ev(page, a => {
        const P = a.spot.pipe, pk = __fk.physKey(a.k);
        const under = [];
        for (const b of __fk.obbs(a.k)) {
          if (!/mastInner|carriage|mastOuter/.test(b.name)) continue;
          const box = { minX: P.minX, maxX: P.maxX, minZ: P.minZ, maxZ: P.maxZ };
          if (__fk.obbHitsBox(b, box, 0)) under.push({ name: b.name, top: b.maxY, gap: +(P.y - b.maxY).toFixed(4) });
        }
        return { under, notes: __fk.notes.slice(), sounds: __fk.sounds.slice(), st: __fk.state(a.k), pipeY: P.y };
      }, { k, spot });
      const top = r.under.length ? Math.min(...r.under.map(u => u.gap)) : null;
      check('L4 管子正下方按住 R：门架 / 挡货架顶停在管子底面以下 1–3 cm（最近的 ' + (top == null ? '—' : (top * 100).toFixed(1) + ' cm') + '，别的更低）', pm2.mounted && top != null && top >= 0.01 - 1e-6 && top <= 0.03 + 1e-6 && r.under.every(u => u.gap >= 0.01 - 1e-6), r);
      check('L5 提示「上面有管子，升不上去」，液压憋压 fk_strain', r.notes.includes('上面有管子，升不上去') && r.sounds.includes('fk_strain'), { notes: r.notes, sounds: r.sounds });
      await shot(page, 'l4-pipe');
      // 举着货叉往管子底下开会停：先倒出来 1.2 m，升高（门架顶高过管底），再往前开
      await hold(page, 'KeyS', 1.6);
      await hold(page, 'KeyR', 1.6);
      const hi = await ev(page, k => __fk.state(k), k);
      await ev(page, () => { __fk.clear(); return 0; });
      await hold(page, 'KeyW', 4.0);
      const r6 = await ev(page, a => {
        const P = a.spot.pipe, box = { minX: P.minX, maxX: P.maxX, minZ: P.minZ, maxZ: P.maxZ };
        const into = [];
        for (const b of __fk.obbs(a.k)) if (b.maxY > P.y + 0.005 && __fk.obbHitsBox(b, box, 0)) into.push(b.name + ' top ' + b.maxY.toFixed(3));
        return { into, notes: __fk.notes.slice(), p: __fk.pose(a.k), st: __fk.state(a.k) };
      }, { k, spot });
      check('L6 举着货叉（挡货架顶 ' + (1.24 + 2.6 * hi.lift).toFixed(2) + ' m）往管子底下开：停住、门架不钻到管子底下，提示一样', hi.lift > 0.75 && r6.into.length === 0 && r6.notes.includes('上面有管子，升不上去'), { r6, hi: hi.lift });
      await hold(page, 'KeyS', 1.0);
      await hold(page, 'KeyC', 6.0);
      await dismount(page);
    }

    // 货叉升到 2.0 m，测试人站在货叉正下方，按 C：停在他头顶以上，提示「货叉下面有人」
    const pm3 = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    const fb = await liftTo(page, k, 2.0);
    const dm = await ev(page, k => { const w = __fk.W(k, 0, -1.63); const id = __fk.dummy(w.x, w.z, 'fkunder'); __br.step(0.1); const e = BR.entities.get(id); __fk.clear(); return { id, top: e ? e.y + (e.h || e.def.height || 1.8) : null }; }, k);
    await hold(page, 'KeyC', 3.0);
    const r7 = await ev(page, k => { const ps = {}; for (const b of __fk.obbs(k)) ps[b.name] = b.minY; return { forkBottom: Math.min(ps.forkL, ps.forkR), carriage: ps.carriage, notes: __fk.notes.slice() }; }, k);
    check('L7 货叉升到 ' + (fb || 0).toFixed(2) + ' m、测试人站在正下方按 C：货叉停在他头顶以上（离头顶 ' + (dm.top != null ? ((r7.forkBottom - dm.top) * 100).toFixed(1) : '?') + ' cm），提示「货叉下面有人」',
      pm3.mounted && fb != null && dm.top != null && r7.forkBottom >= dm.top - 0.005 && r7.forkBottom <= dm.top + 0.06 && r7.notes.includes('货叉下面有人'), { dm, r7 });
    await ev(page, id => { __fk.dropEnt(id); __br.step(0.1); return 0; }, dm.id);
    await hold(page, 'KeyC', 4.0);
    // 货叉升到 0.5 m 开过一只地上的瓶子，再按 C：停在瓶子上面，提示「货叉下面有东西」
    const fb5 = await liftTo(page, k, 0.5);
    const bt = await ev(page, k => { const w = __fk.W(k, 0.28, -3.6); const id = __fk.item('almond_water', w.x, w.z, 'fkunderbottle'); __br.step(0.1); return id; }, k);
    await page.keyboard.down('KeyW');
    let lz = null;
    for (let i = 0; i < 150; i++) {
      lz = await ev(page, a => { __br.step(1 / 30); const p = BR.items.find(a.id); return p ? __fk.L(a.k, p.x, p.z).z : null; }, { k, id: bt });
      if (lz == null || lz > -1.75) break;
    }
    await page.keyboard.up('KeyW'); await step(page, 1.0);
    await ev(page, () => { __fk.clear(); return 0; });
    await hold(page, 'KeyC', 2.5);
    const r8 = await ev(page, a => {
      const p = BR.items.find(a.id), l = p && __fk.L(a.k, p.x, p.z);
      const ps = {}; for (const b of __fk.obbs(a.k)) ps[b.name] = b.minY;
      return { item: p && { y: p.y, top: p.y + 2 * (p.hh || 0.1), lx: l.x, lz: l.z }, forkBottom: Math.min(ps.forkL, ps.forkR), forkR: ps.forkR, notes: __fk.notes.slice() };
    }, { k, id: bt });
    check('L8 货叉 0.5 m 开过地上的瓶子再按 C：停在瓶子上面，提示「货叉下面有东西」', fb5 != null && !!r8.item && r8.forkR >= r8.item.top - 0.005 && r8.forkR <= r8.item.top + 0.05 && r8.notes.includes('货叉下面有东西'), { lz, r8 });
    await dismount(page);

    // 花园段藤蔓（种子 1：(-1,0)、(-1,1)、(-2,0) 是花园段）：每一帧藤蔓顶点不进护顶、门架、司机胸口外扩 0.1 m；车走开 2 s 后逐位恢复
    await startL1(page, { seed: 1 });
    const kv = await ev(page, () => __fk.spawnKey());
    const vine = await ev(page, k => {
      const pk = __fk.physKey(k);
      for (const c of BR.world.chunks()) {
        const vs = (c.res && c.res.data && c.res.data.vines) || [];
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          if (!(v.bot[1] < 2.1)) continue;   // 垂得比护顶（≈2.2 m）低的才碰得到
          for (let a = 0; a < 8; a++) {
            const yaw = a * Math.PI / 4, f = __fk.fwd(yaw);
            for (const off of [0, 0.25, -0.25]) {
              // 车从藤蔓前 4.5 m 开到藤蔓后 4.5 m，车中线（偏 off）正好从藤蔓底下过
              const bx = v.bot[0] + -f.z * off, bz = v.bot[2] + f.x * off;
              const sx = bx - f.x * 4.5, sz = bz - f.z * 4.5;
              if (__fk.hitsAt(sx, sz, yaw, 0, pk).length) continue;
              const sw = __fk.sweep(sx, sz, yaw, 0, 9.5, pk, 0.1);
              if (sw) continue;
              const L = __fk.WP({ x: sx, z: sz, yaw }, -1.2, 0.24), R = __fk.WP({ x: sx, z: sz, yaw }, 1.2, 0.24);
              const side = !BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) ? 'left' : !BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7) ? 'right' : null;
              if (!side) continue;
              return { ck: c.key, i, v, x: sx, z: sz, yaw, side };
            }
          }
        }
      }
      return null;
    }, kv);
    if (!vine) check('L9 种子 1 的花园段里找到一根车能从底下开过的藤蔓', false);
    else {
      const snapV = () => ev(page, a => {
        const c = BR.world.chunks().find(q => q.key === a.ck);
        const g = c.res.group || c.group;
        const m = g.children.find(o => o.isMesh && o.name === 'kit:prop');
        const arr = m.geometry.attributes.position.array;
        return Array.from(arr.slice(a.v.v[0] * 3, a.v.v[1] * 3));
      }, vine);
      const before = await snapV();
      const pmv = await placeAndMount(page, kv, vine, vine.side);
      const badF = [];
      let frames = 0, moved = 0;
      await page.keyboard.down('KeyW');
      for (let i = 0; i < 160; i++) {
        const r = await ev(page, a => {
          __br.step(1 / 30);
          const c = BR.world.chunks().find(q => q.key === a.ck);
          const m = (c.res.group || c.group).children.find(o => o.isMesh && o.name === 'kit:prop');
          m.updateMatrixWorld(true);
          const arr = m.geometry.attributes.position.array, M = m.matrixWorld;
          const top = a.v.top, len = Math.hypot(a.v.bot[0] - top[0], a.v.bot[1] - top[1], a.v.bot[2] - top[2]);
          const vols = __fk.obbs(a.k).filter(b => /roof|post|mast|carriage/.test(b.name)).map(b => Object.assign({}, b, { hx: b.hx + 0.1, hz: b.hz + 0.1, minY: b.minY - 0.1, maxY: b.maxY + 0.1 }));
          const ch = BR.vehicles.chestOf(BR.player), G = __fk.geo(), e = G.eye || { x: 0, y: 1.8, z: 0.16 }, ew = __fk.W(a.k, e.x, e.z, e.y);
          const hits = [];
          const v3 = new THREE.Vector3();
          let near = false;
          for (let q = a.v.v[0]; q < a.v.v[1]; q++) {
            v3.set(arr[q * 3], arr[q * 3 + 1], arr[q * 3 + 2]).applyMatrix4(M);
            if (top[1] - v3.y < 0.05 * len) continue;   // 只看下段（离挂点 5% 以下）
            for (const b of vols) if (BR.phys.pointInObb(b, v3.x, v3.y, v3.z)) { hits.push(b.name); break; }
            if (ch) {
              // 胸口到头顶这一段外扩 0.1 m
              const ax = ch.x, ay = ch.y, az = ch.z, bx = ew.x, by = ew.y + 0.12, bz = ew.z;
              const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
              let t = L2 > 0 ? ((v3.x - ax) * dx + (v3.y - ay) * dy + (v3.z - az) * dz) / L2 : 0; t = Math.max(0, Math.min(1, t));
              const d = Math.hypot(v3.x - (ax + dx * t), v3.y - (ay + dy * t), v3.z - (az + dz * t));
              if (d < 0.1) hits.push('chest');
            }
          }
          const p = __fk.pose(a.k);
          return { hits: hits.slice(0, 3), dist: Math.hypot(p.x - top[0], p.z - top[2]), x: p.x, z: p.z };
        }, { ck: vine.ck, v: vine.v, k: kv });
        frames++;
        if (r.hits.length) badF.push(i + ':' + r.hits.join(','));
        if (r.dist < 1.2) moved = Math.max(moved, 1);
        if (i > 30 && r.dist > 4.6) break;
      }
      await page.keyboard.up('KeyW');
      const during = await snapV();
      let changed = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== during[i]) changed++;
      await step(page, 2.0);
      const after = await snapV();
      let diff = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diff++;
      check('L9 花园段开到藤蔓底下：藤蔓下段的顶点每一帧都不在护顶、门架、司机胸口外扩 0.1 m 的范围里（' + frames + ' 帧）', pmv.mounted && moved && badF.length === 0, { bad: badF.slice(0, 8), vine: { ck: vine.ck, i: vine.i, bot: vine.v.bot, top: vine.v.top }, changedWhileNear: changed });
      check('L10 车离开 2 s 后藤蔓顶点逐位恢复原样', diff === 0, { diff, n: before.length });
    }
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// items（单机）
// =====================================================================
async function goTo(page, lv) {
  await ev(page, () => { __br.setAuto(true); return 0; });
  await ev(page, lv => { BR.world.goTo(lv); return 0; }, lv);
  await page.waitForFunction(lv => String(BR.game.levelId) === lv && !BR.world.transitioning && BR.game.screen === 'playing', lv, { timeout: 90000 });
  await ev(page, () => { __br.setAuto(false); __br.step(0.5); return 0; });
}
// 站在车前、对着车，丢弃键丢一件 type 到 (lx, aimLz)（缺省 −1.65；丢弃距离 0.8 m：人站在 aimLz − 0.8）
async function dropAt(page, k, lx, type, aimLz) {
  await ev(page, a => {
    const w = __fk.W(a.k, a.lx, a.aim - 0.8), t = __fk.W(a.k, a.lx, 0);
    __fk.stand(w.x, w.z, __fk.yawTo(w.x, w.z, t.x, t.z));
    BR.player.pitch = -0.4;
    BR.player.addItem(a.type, 1);
    const i = BR.player.inventory.findIndex(q => q && q.type === a.type);
    BR.player.select(i);
    __br.step(0.05);
    window.__fkDrops0 = new Set(BR.items.list.filter(p => p.dropped).map(p => p.id));
    return 0;
  }, { k, lx, type: type || 'canned_food', aim: aimLz == null ? -1.65 : aimLz });
  await tap(page, 'KeyQ');
  return ev(page, a => {
    const p = BR.items.list.find(q => q.dropped && !window.__fkDrops0.has(q.id));
    if (!p) return null;
    const l = __fk.L(a.k, p.x, p.z), G = __fk.geo(), pose = __fk.pose(a.k);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    const riders = BR.vehicles.debugInfo().riders[a.k] || [];
    return { id: p.id, y: p.y, still: p.still, lx: l.x, lz: l.z, surf, onFork: riders.includes(p.id), ground: BR.phys.groundY(p.x, p.z) };
  }, { k });
}
async function canOnFork(page, k, id) {
  return ev(page, a => {
    const p = BR.items.find(a.id);
    if (!p) return null;
    const l = __fk.L(a.k, p.x, p.z), G = __fk.geo(), pose = __fk.pose(a.k);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    const riders = BR.vehicles.debugInfo().riders[a.k] || [];
    return { y: p.y, lx: l.x, lz: l.z, surf, dy: p.y - surf, onFork: riders.includes(p.id), lift: pose.lift };
  }, { k, id });
}
async function gItems(browser) {
  const { ctx, page } = await boot(browser, 'items');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    await ev(page, k => { const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.1); return 0; }, k);
    if (SUB) {
      if (SUB.includes('stack')) await stackChecks(page, k);
      if (SUB.includes('field')) { const lane = await chockLane(page, k); if (lane) await throwFieldChecks(page, k, lane); else check('I12 找到一条能全速撞上车轮挡的直道（货叉抬过车轮挡）', false); }
      if (SUB.includes('throw')) await throwChecks(page, k);
      if (SUB.includes('high')) await throwHighChecks(page, k);
      if (SUB.includes('carton')) await throwCartonCheck(page, k);
      return;
    }
    // I1 左货叉中线上丢一只罐头：落在叉面上
    const d1 = await dropAt(page, k, -0.28);
    check('I1 在左货叉中线上丢一只罐头：y = 叉面 ±1 cm，挂在这台车的货叉上', !!d1 && Math.abs(d1.y - d1.surf) <= 0.01 && d1.onFork && Math.abs(d1.lx + 0.28) < 0.05, d1);
    if (!d1) return;
    const can = d1.id;
    await shot(page, 'i1-can-on-fork');
    // I2 上车按住 R 1 s：罐头升高 0.45 ± 0.03
    const pm = await mountCar(page, k, 'left');
    const c0 = await canOnFork(page, k, can);
    await hold(page, 'KeyR', 1.0);
    const c1 = await canOnFork(page, k, can);
    check('I2 上车按住 R 1 s：罐头跟着货叉升高 0.45±0.03 m', pm.ok && !!c1 && Math.abs((c1.y - c0.y) - 0.45) <= 0.03 && Math.abs(c1.dy - c0.dy) < 0.01, { c0, c1 });
    // I3 开 3 m：罐头跟着车走，相对货叉的位置误差 <1 cm
    const p0 = await ev(page, k => __fk.pose(k), k);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 150; i++) { const d = await ev(page, a => { __br.step(1 / 30); const p = __fk.pose(a.k); return Math.hypot(p.x - a.p0.x, p.z - a.p0.z); }, { k, p0 }); if (d >= 3) break; }
    await page.keyboard.up('KeyW'); await step(page, 1.5);
    const c2 = await canOnFork(page, k, can);
    const p1 = await ev(page, k => __fk.pose(k), k);
    const err = c2 ? Math.hypot(c2.lx - c1.lx, c2.lz - c1.lz, c2.dy - c1.dy) : null;
    check('I3 开 ' + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) + ' m：罐头跟着车走，相对货叉的位置误差 <1 cm', err != null && err < 0.01 && Math.hypot(p1.x - p0.x, p1.z - p0.z) >= 2.9, { err, c1, c2 });
    // I4 按 C 降到底：罐头在叉面上（≈0.055），不在地上
    await hold(page, 'KeyC', 2.0);
    const c3 = await canOnFork(page, k, can);
    check('I4 按 C 降到底：罐头还在叉面上（y ≈ 0.055），不掉进货叉、不穿到地上', !!c3 && Math.abs(c3.y - c3.surf) <= 0.01 && Math.abs(c3.surf - 0.055) < 0.005 && c3.onFork, c3);
    await dismount(page);
    // I5 下车、走开 4 块再回来：还在叉面上
    const base = await canOnFork(page, k, can);
    await ev(page, () => { __fk.stand(16 + 32 * 4, 30, 0); __br.step(1.5); return 0; });
    const away = await ev(page, k => ({ meshed: BR.vehicles.debugInfo().promoted.includes(k) }), k);
    await ev(page, k => { const w = __fk.W(k, -1.6, 0.24); __fk.stand(w.x, w.z, 0); __br.step(1.5); return 0; }, k);
    const c4 = await canOnFork(page, k, can);
    check('I5 下车、走开 4 块再回来：罐头还在叉面上（位置不变）', !!c4 && c4.onFork && Math.abs(c4.dy) <= 0.01 && Math.hypot(c4.lx - base.lx, c4.lz - base.lz) < 0.01, { base, c4, away });
    // I6 离开这一层再回来：还在叉面上
    await goTo(page, '0');
    await goTo(page, '1');
    await ev(page, k => { const w = __fk.W(k, -1.6, 0.24); __fk.stand(w.x, w.z, 0); __br.step(1.0); return 0; }, k);
    const c5 = await canOnFork(page, k, can);
    check('I6 离开这一层再回来：罐头还在叉面上', !!c5 && c5.onFork && Math.abs(c5.dy) <= 0.01 && Math.hypot(c5.lx - base.lx, c5.lz - base.lz) < 0.01, { base, c5 });
    // I7 货叉降到底后准心对准罐头能捡
    const pick = await ev(page, a => {
      const p = BR.items.find(a.id);
      const w = __fk.W(a.k, -0.28, -2.5);
      __fk.stand(w.x, w.z, __fk.yawTo(w.x, w.z, p.x, p.z));
      BR.interact.aimAt(p.x, p.y + (p.hh || 0.05), p.z); __br.step(1 / 30);
      return { cur: __fk.cur(), n: BR.player.countOf('canned_food'), p: __fk.prompt() };
    }, { k, id: can });
    await tap(page, 'Space');
    const pick2 = await ev(page, id => ({ n: BR.player.countOf('canned_food'), gone: !BR.items.find(id) }), can);
    check('I7 货叉降到底后准心对准罐头短按空格能捡起来', !!pick.cur && pick.cur.key === can && pick2.gone && pick2.n === pick.n + 1, { pick, pick2 });
    // I8 丢在两根货叉正中间：掉到地上
    const d8 = await dropAt(page, k, 0);
    check('I8 丢在两根货叉正中间的空当：掉到地上', !!d8 && !d8.onFork && Math.abs(d8.y - d8.ground) < 0.02, d8);
    // I9 右货叉上再放一只，升到叉面 1.6 m：够不着（灰字），这时往左货叉丢：落在地上；之后降货叉停在它上面
    const d9 = await dropAt(page, k, 0.28);
    await mountCar(page, k, 'left');
    await liftTo(page, k, 1.6 - 0.04);
    await dismount(page);
    const hi = await ev(page, a => {
      const p = BR.items.find(a.id);
      const w = __fk.W(a.k, 0.28, -2.6);
      __fk.stand(w.x, w.z, __fk.yawTo(w.x, w.z, p.x, p.z));
      BR.interact.aimAt(p.x, p.y + (p.hh || 0.05), p.z); __br.step(1 / 30);
      return { cur: __fk.cur(), p: __fk.prompt(), y: p.y };
    }, { k, id: d9 && d9.id });
    check('I9 叉面举到 1.6 m：准心对准上面的罐头只给灰字「货叉举得太高，够不着」', !!d9 && d9.onFork && !!hi.cur && hi.cur.short && !hi.cur.short.ok && /够不着/.test(hi.p), { d9, hi });
    const d10 = await dropAt(page, k, -0.28);
    check('I10 叉面高过 1.4 m 时往货叉上丢：落在地上', !!d10 && !d10.onFork && Math.abs(d10.y - d10.ground) < 0.02 && d10.surf > 1.4, d10);
    await mountCar(page, k, 'left');
    await ev(page, () => { __fk.clear(); return 0; });
    await hold(page, 'KeyC', 4.0);
    const r11 = await ev(page, a => { const p = BR.items.find(a.id); const ps = {}; for (const b of __fk.obbs(a.k)) ps[b.name] = b.minY; return { top: p ? p.y + 2 * (p.hh || 0.05) : null, forkL: ps.forkL, notes: __fk.notes.slice() }; }, { k, id: d10 && d10.id });
    check('I11 之后降货叉：停在地上那只罐头上面，提示「货叉下面有东西」', r11.top != null && r11.forkL >= r11.top - 0.005 && r11.forkL <= r11.top + 0.05 && r11.notes.includes('货叉下面有东西'), r11);
    await dismount(page);
    await stackChecks(page, k);
    await throwChecks(page, k);
    await throwHighChecks(page, k);
    await throwCartonCheck(page, k);
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// ---- I17 站在原地连着往同一根货叉上丢（FE1 返修 r4）：沿货叉排开、不叠在一起（两件中心至少隔两件模型半径之和）；
// 瞄准点附近 15 cm 摆满了再丢（返修 r5 裁定 ③）：东西落在这根货叉旁边的地上；提示（返修 r6 裁定 ⑤：只在真的放不下时才说放不下，说清楚、不歧义）：
// 这根货叉别处还空着「这一段叉面满了，东西放到旁边地上了，叉尖那头还空着 / 靠车那头还空着」，整根货叉都摆满了「这根货叉摆满了，东西放到旁边地上了」，
// 旁边地上也没地方（东西留在手里）「这根货叉摆满了，旁边地上也放不下」（I17c）；都按每秒 6 个字、不少于 3 s 显示；
// I17d 对着叉尖连丢：第三件提示「这一段叉面满了，东西放到旁边地上了，靠车那头还空着」 ----
// 往货叉上丢的提示该显示多久（返修 r6 裁定 ⑤）：按每秒 6 个字算、不少于 3 s
const readMs = t => Math.max(3000, Math.ceil(Array.from(String(t)).length * 1000 / 6));
async function stackChecks(page, k) {
  await ev(page, k => {
    for (const id of (BR.vehicles.debugInfo().riders[k] || [])) BR.items.remove(id);
    const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.2);
    __fk.clear();
    return 0;
  }, k);
  const ds = [];
  for (const type of ['canned_food', 'canned_food', 'water_bottle']) ds.push(await dropAt(page, k, -0.28, type));
  const pair = await ev(page, a => {
    const out = [];
    for (let i = 0; i < a.ids.length; i++) for (let j = i + 1; j < a.ids.length; j++) {
      const p = BR.items.find(a.ids[i]), q = BR.items.find(a.ids[j]);
      if (!p || !q) { out.push({ i, j, gone: true }); continue; }
      out.push({ i, j, d: __fk.r(Math.hypot(p.x - q.x, p.z - q.z)), need: __fk.r(__fk.foot(p) + __fk.foot(q)) });
    }
    return out;
  }, { ids: ds.map(d => d && d.id) });
  check('I17 站在同一个地方往左货叉上连丢三次（罐头、罐头、水瓶）：都在叉面上，沿货叉排开，两两中心距离 ≥ 两件模型半径之和（' + pair.map(q => q.d != null ? (q.d * 100).toFixed(1) + '/' + (q.need * 100).toFixed(1) : '?').join('、') + ' cm）',
    ds.every(d => d && d.onFork && Math.abs(d.y - d.surf) <= 0.01 && Math.abs(d.lx + 0.28) < 0.02) && pair.every(q => !q.gone && q.d >= q.need), { ds, pair });
  // 接着在同一个地方丢罐头，直到瞄准点附近（沿货叉 15 cm 以内）放不下（返修 r5 裁定 ③）：罐头落在这根货叉旁边的地上
  // （瞄准点附近，不挪到远处的叉根、不留在手里）；这根货叉别处还空着，提示「这一段叉面满了，东西放到旁边地上了，叉尖 / 靠车那头还空着」
  // （返修 r6 裁定 ⑤：不说「放不下」），显示时长按每秒 6 个字、不少于 3 s
  const AIM = -1.65;
  let full = null, n = 0;
  for (let i = 0; i < 14 && !full; i++) {
    const before = await ev(page, () => ({ n: BR.player.countOf('canned_food'), t: __fk.toasts.length }));
    const d = await dropAt(page, k, -0.28, 'canned_food');
    const after = await ev(page, b => ({ n: BR.player.countOf('canned_food'), toasts: __fk.toasts.slice(b.t), ms: __fk.toastMs.slice(b.t) }), before);
    if (d && d.onFork) { n++; continue; }
    full = { before, after, d };
  }
  const all = await ev(page, a => {
    const k = a.k, ids = (BR.vehicles.debugInfo().riders[k] || []).filter(id => Math.abs(__fk.L(k, BR.items.find(id).x, BR.items.find(id).z).x + 0.28) < 0.12);
    let worst = Infinity, shift = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = BR.items.find(ids[i]), q = BR.items.find(ids[j]);
      worst = Math.min(worst, Math.hypot(p.x - q.x, p.z - q.z) - __fk.foot(p) - __fk.foot(q));
    }
    const G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]), heel = Math.max(G.forkZ[0], G.forkZ[1]), half = (G.forkW || 0.1) / 2;
    const ends = ids.map(id => { const p = BR.items.find(id), l = __fk.L(k, p.x, p.z), r = __fk.foot(p); shift = Math.max(shift, Math.abs(l.z - a.aim)); return l.z - r >= tip - 0.005 && l.z + r <= heel + 0.005; });
    // 掉在地上的那一件：在这根货叉旁边（模型整个在叉沿外面、离叉沿不到 4 cm）、瞄准点附近，不压车、不压别的物资
    let side = null;
    if (a.id) {
      const p = BR.items.find(a.id);
      if (p) {
        const l = __fk.L(k, p.x, p.z), r = __fk.foot(p), off = Math.abs(l.x + 0.28) - half - r;
        let near = Infinity;
        for (const q of BR.items.list) if (q !== p && !q.owner && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.z - p.z) < 0.5) near = Math.min(near, Math.hypot(q.x - p.x, q.z - p.z) - r - __fk.foot(q));
        side = { lx: __fk.r(l.x), lz: __fk.r(l.z), off: __fk.r(off), dz: __fk.r(Math.abs(l.z - a.aim)), y: __fk.r(p.y), ground: __fk.r(BR.phys.groundY(p.x, p.z)), inCar: __fk.itemInCar(k, a.id), near: __fk.r(near) };
      }
    }
    return { n: ids.length, worst: __fk.r(worst), inside: ends.every(Boolean), shift: __fk.r(shift), side };
  }, { k, aim: AIM, id: full && full.d && full.d.id });
  check('I17 同一个地方接着丢：叉上摆了 ' + all.n + ' 件（离瞄准点沿货叉最远 ' + (all.shift * 100).toFixed(1) + ' cm ≤15，不挪到远处的叉根），两两都不叠（最近的两件模型之间还空 ' + (all.worst * 100).toFixed(1) + ' cm），都整个在叉面上',
    all.n >= 3 && all.shift <= 0.15 + 0.002 && all.worst >= -0.001 && all.inside, { n, all });
  const sd = all.side;
  const NEAR_RE = /^这一段叉面满了，东西放到旁边地上了，(叉尖|靠车)那头还空着$/;
  const nearMsg = full && full.after.toasts.find(t => NEAR_RE.test(t));
  const nearMs = full && (full.after.ms.find(q => NEAR_RE.test(q[0])) || [])[1];
  check('I17 瞄准点附近放不下了再丢：这根货叉别处还空着，提示「' + (nearMsg || (full ? full.after.toasts.join('|') : '?')) + '」（不说「放不下」，显示 ' + nearMs + ' ms ≥ ' + (nearMsg ? readMs(nearMsg) : '?') + '：每秒 6 个字、不少于 3 s），罐头落在这根货叉旁边的地上（离叉沿 ' + (sd ? (sd.off * 100).toFixed(1) : '?') + ' cm、离瞄准点沿货叉 ' + (sd ? (sd.dz * 100).toFixed(1) : '?') + ' cm），不在叉上、不在手里，不压车、不压别的物资',
    !!full && !!full.d && !full.d.onFork && full.after.n === full.before.n && !!nearMsg && nearMs >= readMs(nearMsg) && !full.after.toasts.some(t => /放不下/.test(t)) && !!sd &&
    sd.off >= -0.002 && sd.off <= 0.04 && sd.dz <= 0.15 + 0.01 && Math.abs(sd.y - sd.ground) < 0.02 && !sd.inCar && sd.near >= 0, { full, sd });
  await ev(page, a => { if (a.id && BR.items.find(a.id)) BR.items.remove(a.id); return 0; }, { id: full && full.d && full.d.id });
  await ev(page, k => { for (const id of (BR.vehicles.debugInfo().riders[k] || [])) BR.items.remove(id); __br.step(0.05); return 0; }, k);

  // I17d 站在左货叉叉尖前面、对着叉尖（lz −1.95）连丢罐头（验收员 r6 的 fulltip 场景）：前两只摆在叉尖那头；第三只瞄准点附近放不下，
  // 叉根那边还空着一大截 —— 提示「这一段叉面满了，东西放到旁边地上了，靠车那头还空着」（不说「放不下」），显示 ≥4 s（24 个字），
  // 罐头落在货叉旁边的地上（不留在手里）。
  // dropAt 先往背包里加一只再按 Q：丢出去以后手里的数量回到丢之前（before.n），留在手里会多一只（返修 r6 验收员：以前按 used = 1 判，必然失败）
  const tipDrops = [];
  for (let i = 0; i < 3; i++) {
    const before = await ev(page, () => ({ n: BR.player.countOf('canned_food'), t: __fk.toasts.length }));
    const d = await dropAt(page, k, -0.28, 'canned_food', -1.95);
    const after = await ev(page, b => ({ n: BR.player.countOf('canned_food'), toasts: __fk.toasts.slice(b.t), ms: __fk.toastMs.slice(b.t) }), before);
    tipDrops.push({ d, toasts: after.toasts, ms: after.ms, inHand: after.n - before.n });
  }
  const T17D = '这一段叉面满了，东西放到旁边地上了，靠车那头还空着';
  const t3 = tipDrops[2], t3ms = (t3.ms.find(q => q[0] === T17D) || [])[1];
  check('I17d 对着叉尖连丢三只罐头：前两只在叉面上（' + tipDrops.slice(0, 2).map(q => q.d ? q.d.lz.toFixed(3) : '?').join(' / ') + '），第三只提示「' + (t3.toasts.join('|') || '无') + '」（显示 ' + t3ms + ' ms ≥ ' + readMs(T17D) + '），落在货叉旁边的地上（叉根那边还空着），不留在手里；前两只没有提示',
    tipDrops[0].d && tipDrops[0].d.onFork && tipDrops[1].d && tipDrops[1].d.onFork && !!t3.d && !t3.d.onFork && t3.inHand === 0 &&
    t3.toasts.includes(T17D) && t3ms >= readMs(T17D) && !t3.toasts.some(t => /放不下/.test(t)) && Math.abs(t3.d.y - t3.d.ground) < 0.02 &&
    !tipDrops[0].toasts.length && !tipDrops[1].toasts.length, tipDrops);
  await ev(page, a => { for (const q of a.ids) if (q && BR.items.find(q)) BR.items.remove(q); for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id); __br.step(0.05); return 0; },
    { k, ids: tipDrops.map(q => q.d && q.d.id) });

  // I17c 整根左货叉摆满（叉尖到叉根 8 只罐头）再往左货叉上丢：先是货叉旁边的地上还空着 —— 提示「这根货叉摆满了，东西放到旁边地上了」，
  // 罐头落在那里；再把货叉两边的地上也摆满（瞄准点附近没有空地）再丢 —— 真的放不下了：提示「这根货叉摆满了，旁边地上也放不下」，
  // 罐头留在手里（没有多出一件、不在叉上也不在地上）。两句都按每秒 6 个字、不少于 3 s 显示（返修 r6 裁定 ⑤）
  const fillF = await ev(page, k => {
    const G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]), heel = Math.max(G.forkZ[0], G.forkZ[1]);
    const ids = [];
    for (let i = 0; tip + 0.0675 + 0.105 * i <= heel - 0.0675 + 1e-6; i++) { const id = 'i17c-f' + i; if (__fk.putOnFork(k, id, 'canned_food', -0.28, tip + 0.0675 + 0.105 * i)) ids.push(id); }
    __br.step(0.05);
    return ids;
  }, k);
  const T17C1 = '这根货叉摆满了，东西放到旁边地上了', T17C2 = '这根货叉摆满了，旁边地上也放不下';
  const b0 = await ev(page, () => ({ n: BR.player.countOf('canned_food'), t: __fk.toasts.length }));
  const db = await dropAt(page, k, -0.28, 'canned_food');
  const b1 = await ev(page, b => ({ n: BR.player.countOf('canned_food'), toasts: __fk.toasts.slice(b.t), ms: __fk.toastMs.slice(b.t) }), b0);
  const b1ms = (b1.ms.find(q => q[0] === T17C1) || [])[1];
  check('I17c 整根左货叉摆满（' + fillF.length + ' 只）再丢、货叉旁边的地上还空着：提示「' + (b1.toasts.join('|') || '无') + '」（显示 ' + b1ms + ' ms ≥ ' + readMs(T17C1) + '），罐头落在货叉旁边的地上，不在手里',
    fillF.length >= 7 && !!db && !db.onFork && Math.abs(db.y - db.ground) < 0.02 && b1.n === b0.n && b1.toasts.includes(T17C1) && b1ms >= readMs(T17C1), { fillF, db, b0, b1 });
  await ev(page, a => { if (a.id && BR.items.find(a.id)) BR.items.remove(a.id); __br.step(0.05); return 0; }, { id: db && db.id });
  const fill = await ev(page, a => {
    const k = a.k, ids = a.ids;
    // 货叉两边（叉沿外 / 两叉中间）瞄准点前后 ±20 cm 每 10 cm 一只
    const floor = [];
    for (const lx of [-0.28 - 0.1225, -0.28 + 0.1225]) for (const dz of [-0.2, -0.1, 0, 0.1, 0.2]) {
      const w = __fk.W(k, lx, -1.65 + dz), id = 'i17c-g' + floor.length;
      if (BR.items.spawn('canned_food', w.x, BR.phys.groundY(w.x, w.z), w.z, { id, dropped: true, still: true })) floor.push(id);
    }
    __br.step(0.05);
    return { ids, floor, riders: (BR.vehicles.debugInfo().riders[k] || []).length };
  }, { k, ids: fillF });
  const c0 = await ev(page, () => ({ n: BR.player.countOf('canned_food'), t: __fk.toasts.length, items: BR.items.list.length }));
  const dc = await dropAt(page, k, -0.28, 'canned_food');
  const c1 = await ev(page, b => ({ n: BR.player.countOf('canned_food'), toasts: __fk.toasts.slice(b.t), ms: __fk.toastMs.slice(b.t), items: BR.items.list.length }), c0);
  const c1ms = (c1.ms.find(q => q[0] === T17C2) || [])[1];
  check('I17c 整根左货叉摆满（' + fill.ids.length + ' 只）、货叉两边的地上也摆满再丢：提示「' + (c1.toasts.join('|') || '无') + '」（显示 ' + c1ms + ' ms ≥ ' + readMs(T17C2) + '），罐头留在手里（手里 ' + c0.n + ' → ' + c1.n + '，地上叉上没有多出一件）',
    fill.ids.length >= 7 && fill.floor.length === 10 && !dc && c1.n === c0.n + 1 && c1.items === c0.items && c1.toasts.includes(T17C2) && c1ms >= readMs(T17C2), { fill, c0, c1, dc });
  await ev(page, a => { for (const id of a.ids.concat(a.floor)) if (BR.items.find(id)) BR.items.remove(id); BR.player.removeItem && BR.player.removeItem('canned_food', 1); __br.step(0.05); return 0; }, fill);
}

// ---- 全速撞车掉货（家长定的规则，FE1 返修 r2）：撞前车速 ≥2 m/s 的「哐」把货叉上的瓶罐甩到叉尖前方 0.2–0.5 m 落地、写进本层状态；
// 慢慢碰上（「咚」）、1.5 m/s 的「哐」、倒车撞上都不掉 ----
// 几只罐头此刻的样子：车本地坐标、离叉尖往前多远（past）、在不在叉上、本层状态 drops 里那条、有没有压进碰撞体 / 车
async function canState(page, k, ids) {
  return ev(page, a => {
    const G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]);
    const riders = BR.vehicles.debugInfo().riders[a.k] || [];
    const st = BR.levelState.peek('1');
    const pose = __fk.pose(a.k);
    const surf = pose.y + (G.forkY || 0.015) + (G.forkT || 0.04) + (G.carriageTravel || 2.6) * pose.lift;
    return a.ids.map(id => {
      const p = BR.items.find(id);
      if (!p) return { id, gone: true };
      const l = __fk.L(a.k, p.x, p.z), d = st && st.drops && st.drops.get(id);
      const r = Math.max(0.03, (p.r || 0.1) * 0.6), h = Math.max(0.05, 2 * (p.hh || 0.1));
      return { id, x: __fk.r(p.x), y: __fk.r(p.y), z: __fk.r(p.z), lx: __fk.r(l.x), lz: __fk.r(l.z), past: __fk.r(tip - l.z), ground: __fk.r(BR.phys.groundY(p.x, p.z)),
        surf: __fk.r(surf), onFork: riders.includes(id), held: !!p.held, ls: d ? d.slice(0, 3) : null,
        inSolid: BR.phys.overlapCircle(p.x, p.z, r, p.y + 0.02, h - 0.03), inCar: __fk.itemInCar(a.k, id) };
    });
  }, { k, ids });
}
const onGround = c => !!c && !c.gone && !c.onFork && !c.held && Math.abs(c.y - c.ground) < 0.02;
const onForkStill = c => !!c && !c.gone && c.onFork && Math.abs(c.y - c.surf) < 0.012;
const lsSame = c => !!c && !!c.ls && Math.hypot(c.ls[0] - c.x, c.ls[2] - c.z) < 0.01 && Math.abs(c.ls[1] - c.y) < 0.01;
// 场地：车轮挡（12 cm 高）。货叉抬到底面离地约 0.3 m（lift 0.11，低于限速高度 0.5 m）：车身（外门架底座、底盘）撞上车轮挡、
// 货叉从挡上面伸过去，叉尖前面是空地，看得出罐头往前飞了多远
function chockLane(page, k) {
  return ev(page, a => {
    const G = __fk.geo();
    let front = 0;
    for (const o of G.obbs(a.L)) if (o.cy - o.hy < 0.12) front = Math.min(front, o.cz - Math.abs(o.hz));
    const stops = __fk.allSolids(b => Math.abs(b.h - 0.12) < 0.01 && Math.max(b.w, b.d) > 1.4 && Math.min(b.w, b.d) < 0.25);
    for (const b of stops) {
      const l = __fk.laneTo(a.k, b, { runs: [3.5, 3, 2.5], offs: [0, 0.15, -0.15], lift: a.L, frontZ: front });
      if (l) return Object.assign(l, { box: b, front });
    }
    return null;
  }, { k, L: 0.11 });
}
async function throwChecks(page, k) {
  const LIFT = 0.11;
  const lane = await chockLane(page, k);
  if (!lane) { check('I12 找到一条能全速撞上车轮挡的直道（货叉抬过车轮挡）', false); return; }
  info('撞车掉货的直道：车轮挡 ' + lane.box.ck + '，叉根前面最低的部件在本地 z ' + lane.front + '，起点离挡 ' + lane.run + ' m');
  const placeLane = () => ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, a.L); __br.step(0.2); return 0; }, { k, l: lane, L: LIFT });
  await placeLane();
  // 前面 I9 留在右货叉上的那只罐头先拿走（不然右叉上会叠着两只，第二只落点被第一只占了只能从叉边滑下去）
  await ev(page, k => { for (const id of (BR.vehicles.debugInfo().riders[k] || [])) BR.items.remove(id); __br.step(0.05); return 0; }, k);
  const d1 = await dropAt(page, k, -0.28), d2 = await dropAt(page, k, 0.28);
  if (!d1 || !d2 || !d1.onFork || !d2.onFork) { check('I12 两只罐头丢在抬起来的货叉上', false, { d1, d2 }); return; }
  const ids = [d1.id, d2.id];
  // I13 慢慢碰上（≈0.5 m/s，「咚」）：不掉
  await parkPlayerBehind(page, lane);
  const runSlow = thr => ev(page, a => {
    __fk.clear();
    const n0 = BR.vehicles.debugInfo().throws.length;
    const r = __fk.drive(a.k, { throttle: a.thr, steer: 0, lift: 0 }, 14, { untilStop: true });
    __br.step(1.0);
    return { vmax: r.vmax, moved: r.moved, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)), throws: BR.vehicles.debugInfo().throws.length - n0 };
  }, { k, thr });
  const s13 = await runSlow(0.11);
  const c13 = await canState(page, k, ids);
  check('I13 慢慢碰上车轮挡（' + s13.vmax.toFixed(2) + ' m/s，「咚」）：两只罐头都还在叉面上（±1 cm）', s13.sounds.includes('fk_bump') && !s13.sounds.includes('fk_bang') && s13.throws === 0 && c13.every(onForkStill), { s13, c13 });
  // I13b 1.5 m/s 撞上（「哐」，但没到 2 m/s）：也不掉
  await placeLane();
  await parkPlayerBehind(page, lane);
  const s13b = await runSlow(0.33);
  const c13b = await canState(page, k, ids);
  check('I13b 1.5 m/s 撞上（' + s13b.vmax.toFixed(2) + ' m/s，「哐」，不到 2 m/s）：罐头还在叉面上', s13b.sounds.includes('fk_bang') && s13b.vmax < 2 && s13b.throws === 0 && c13b.every(onForkStill), { s13b, c13b });
  // I12 坐上车按住 W 全速撞上：两只罐头甩到叉尖前方 0.2–0.5 m 落在地上，横向不变（各在自己那根货叉的延长线上），写进本层状态
  await placeLane();
  const pm = await mountCar(page, k, 'left');
  const before = await canState(page, k, ids);
  await ev(page, () => { __fk.clear(); return 0; });
  await page.keyboard.down('KeyW');
  let vmax = 0;
  const bad12 = [], ys12 = [];
  await ev(page, () => { __fk.hoverReset(); return 0; });
  for (let i = 0; i < 200; i++) {
    const r = await ev(page, a => { __br.step(1 / 30); return { v: __fk.pose(a.k).spd, bad: __fk.fallBad(a.k, a.ids).concat(__fk.hover(a.k, a.ids)), y: a.ids.map(id => { const p = BR.items.find(id); return p ? __fk.r(p.obj ? p.obj.position.y : p.y) : null; }) }; }, { k, ids });
    vmax = Math.max(vmax, r.v);
    bad12.push(...r.bad); ys12.push(r.y);
    if (i > 20 && Math.abs(r.v) < 0.02) break;
  }
  await page.keyboard.up('KeyW');
  for (let i = 0; i < 30; i++) {
    const r = await ev(page, a => { __br.step(1 / 30); return { bad: __fk.fallBad(a.k, a.ids).concat(__fk.hover(a.k, a.ids)), y: a.ids.map(id => { const p = BR.items.find(id); return p ? __fk.r(p.obj ? p.obj.position.y : p.y) : null; }) }; }, { k, ids });
    bad12.push(...r.bad); ys12.push(r.y);
  }
  const c12 = await canState(page, k, ids);
  const lie12 = await ev(page, a => { __fk.frames(15); return __fk.lieState(a.k, a.ids); }, { k, ids });
  const dbg = await ev(page, () => ({ throws: BR.vehicles.debugInfo().throws.slice(-1), falls: BR.vehicles.debugInfo().falls, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)) }));
  const t12 = dbg.throws[0];
  check('I12 坐在车上全速撞上车轮挡（撞前 ' + (t12 ? t12.v0 : '?') + ' m/s，「哐」）：两只罐头甩出去，落在地上', pm.ok && !!t12 && t12.v0 >= 2 && t12.by === 'me' && dbg.sounds.includes('fk_bang') && dbg.falls === 0 && c12.every(onGround), { pm: pm.st, vmax, t12, c12 });
  check('I12 落点在叉尖前方 0.2–0.5 m（' + c12.map(c => c.past && c.past.toFixed(2)).join(' / ') + ' m），横向还在各自那根货叉的延长线上（±3 cm）',
    c12.every((c, i) => c.past >= 0.2 - 0.015 && c.past <= 0.5 + 0.015 && Math.abs(c.lx - before[i].lx) < 0.03 && !c.inSolid && !c.inCar), { before, c12 });
  check('I12 落点写进本层状态（levelState drops 和落点差 <1 cm）', c12.every(lsSame), c12.map(c => ({ id: c.id, ls: c.ls, at: [c.x, c.y, c.z] })));
  check('I12 甩出去的每一帧：没压进车身 / 货叉、墙、柱础这些东西和别的物资，也没有从举着的货叉下面穿下去；还在叉面高度时不悬在叉尖外面、不往回退（逐帧查 ' + ys12.length + ' 帧）', bad12.length === 0, { bad: bad12.slice(0, 8) });
  // ③ 落地以后像别的东西一样静静躺着：不浮动、不转圈，落地那一下不往上弹（模型高度一直等于落点高度）
  const ysFlat = ys12.map(r => r.map(y => y == null ? 0 : y));
  const bounce = ids.map((id, j) => { let lo = Infinity, up = 0; for (const r of ysFlat) { lo = Math.min(lo, r[j]); up = Math.max(up, r[j] - lo); } return up; });
  check('I12 落地以后静静躺着：still，模型离地 0（不浮不转），落地那一下没有往上弹（弹起 ' + bounce.map(b => (b * 100).toFixed(1)).join(' / ') + ' cm）',
    lie12.every(c => c.still && !c.held && Math.abs(c.objDy) < 1e-4) && bounce.every(b => b < 0.005), { lie12, bounce });
  await shot(page, 'i12-thrown');
  // I12b 下车、离开这一层再回来：罐头还在落点（地上，不在货叉上）
  await dismount(page);
  await goTo(page, '0');
  await goTo(page, '1');
  await ev(page, k => { const w = __fk.W(k, -1.6, 0.24); __fk.stand(w.x, w.z, 0); __br.step(1.0); return 0; }, k);
  const c12b = await canState(page, k, ids);
  const lie12b = await ev(page, a => __fk.lieState(a.k, a.ids), { k, ids });
  check('I12b 离开这一层再回来：甩出去的罐头还在落点（差 <1 cm），不在货叉上，照样静静躺着（不浮不转）', c12b.every((c, i) => onGround(c) && Math.hypot(c.x - c12[i].x, c.z - c12[i].z) < 0.01) &&
    lie12b.every(c => c.still && Math.abs(c.objDy) < 1e-4), { c12, c12b, lie12b });
  // I12c 叉面 0.5 m（叉底 0.465 m，还没到限速高度）在同一条车轮挡直道上全速撞上（FE1 返修 r4）：叉面 0.5 m 一档（不限速时最高；落点只看车速，
  // 竖直往下掉、水平匀速）—— 两只罐头从叉面高度往前甩出，落在叉尖前方 0.2–0.5 m 的地上；每一帧都不穿（货叉、车身、碰撞体、sideObs、别的物资），
  // 还在叉面高度时圆心不越过叉尖 0.3 个模型半径以上、不往车这边退；落地静静躺着
  {
    const ids12c = ['i12c-a', 'i12c-b'];
    const set12c = await ev(page, a => {
      const G = __fk.geo(), base = (G.forkY || 0.015) + (G.forkT || 0.04), lift = (0.505 - base) / (G.carriageTravel || 2.6);
      // 前面 I12 甩在这条直道上的两只罐头先拿走（不然落点被它们占了，只能从叉边滑下去）
      for (const id of (BR.vehicles.debugInfo().riders[a.k] || []).concat(a.ids, a.old)) if (BR.items.find(id)) BR.items.remove(id);
      __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, lift); __br.step(0.2);
      const ok = [__fk.putOnFork(a.k, a.ids[0], 'canned_food', -0.28, -1.95), __fk.putOnFork(a.k, a.ids[1], 'canned_food', 0.28, -1.95)];
      __br.step(0.1);
      return { ok, lift: __fk.r(lift), before: __fk.lieState(a.k, a.ids) };
    }, { k, l: lane, ids: ids12c, old: ids });
    await parkPlayerBehind(page, lane);
    const s12c = await ev(page, a => {
      __fk.clear(); __fk.hoverReset();
      const n0 = BR.vehicles.debugInfo().throws.length, bad = [], hov = [];
      const r = __fk.drive(a.k, { throttle: 1, steer: 0, lift: 0 }, 6, { untilStop: true, each: () => { hov.push(...__fk.hover(a.k, a.ids)); return null; } });
      let n = 0;
      for (let i = 0; i < 45; i++) { __br.step(1 / 30); n++; bad.push(...__fk.fallBad(a.k, a.ids)); hov.push(...__fk.hover(a.k, a.ids)); }
      const t = BR.vehicles.debugInfo().throws;
      return { vmax: __fk.r(r.vmax), thrown: t.length - n0, last: t.length > n0 ? t[t.length - 1] : null, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)), bad: bad.slice(0, 8), nbad: bad.length, hov: hov.slice(0, 8), frames: n,
        falls: BR.vehicles.debugInfo().falls, st: __fk.lieState(a.k, a.ids) };
    }, { k, ids: ids12c });
    const t12c = s12c.last;
    check('I12c 叉面 0.5 m 全速撞车轮挡（' + s12c.vmax.toFixed(2) + ' m/s，「哐」）：两只罐头从叉面高度往前甩出，落在叉尖前方 0.2–0.5 m（' + s12c.st.map(c => c.past != null ? c.past.toFixed(2) : '?').join(' / ') + ' m）的地上，横向还在各自那根货叉的延长线上，落地静静躺着',
      set12c.ok.every(Boolean) && s12c.thrown === 1 && !!t12c && t12c.v0 >= 2 && t12c.list.length === 2 && s12c.sounds.includes('fk_bang') && s12c.falls === 0 &&
      s12c.st.every((c, i) => !c.gone && !c.onFork && !c.held && c.still && Math.abs(c.objDy) < 1e-4 && Math.abs(c.y - c.ground) < 0.01 && c.past >= 0.2 - 0.015 && c.past <= 0.5 + 0.015 && Math.abs(c.lx - set12c.before[i].lx) < 0.03),
      { set12c, s12c: Object.assign({}, s12c, { bad: undefined, hov: undefined }) });
    check('I12c 甩出去的每一帧（' + s12c.frames + ' 帧）：不穿货叉、车身、碰撞体、柱础这些东西和别的物资；还在叉面高度时不悬在叉尖外面（圆心过叉尖 ≤0.3 个模型半径）、不往回退',
      s12c.nbad === 0 && s12c.hov.length === 0, { bad: s12c.bad, hov: s12c.hov });
    // 截图：人站在车右前方，看叉尖和叉尖前面落地的两只罐头
    await ev(page, k => __fk.viewL(k, 1.5, -1.6, 0, 0.1, -2.6), k);
    await shot(page, 'i12c-thrown-05');
    await ev(page, a => { for (const id of a.ids) if (BR.items.find(id)) BR.items.remove(id); __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.1); return 0; }, { k, l: lane, ids: ids12c });
  }
  // I12d / I12e / I19 / I17b：同一条直道上撞车甩货一件不留（返修 r5）
  await throwFieldChecks(page, k, lane);
  // I14 最常见的撞法：货叉放到底、全速撞柱子（叉尖顶着柱子，前面没地方飞）。罐头往前冲，撞上柱子掉下来：不穿进柱子、不进车、不悬空
  const P14 = await ev(page, a => {
    const S = __fk.solids('0,0').filter(b => Math.abs(b.w - b.d) < 0.05 && b.w > 0.6 && b.w < 1.0 && b.h > 3.4);
    for (const b of S) { const l = __fk.laneTo(a.k, b, { runs: [4, 3.5, 3] }); if (l) return Object.assign(l, { box: b }); }
    return null;
  }, { k });
  if (!P14) { check('I14 找到一条能全速撞柱子的直道', false); return; }
  await ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.2); return 0; }, { k, l: P14 });
  const e1 = await dropAt(page, k, -0.28), e2 = await dropAt(page, k, 0.28);
  const ids14 = [e1 && e1.id, e2 && e2.id].filter(Boolean);
  const b14 = await canState(page, k, ids14);
  await parkPlayerBehind(page, P14);
  const s14 = await ev(page, a => {
    __fk.clear(); __fk.hoverReset();
    const n0 = BR.vehicles.debugInfo().throws.length;
    const hov = [];
    const r = __fk.drive(a.k, { throttle: 1, steer: 0, lift: 0 }, 6, { untilStop: true, each: () => { hov.push(...__fk.hover(a.k, a.ids)); return null; } });
    const bad = [];
    for (let i = 0; i < 45; i++) { __br.step(1 / 30); bad.push(...__fk.fallBad(a.k, a.ids)); hov.push(...__fk.hover(a.k, a.ids)); }
    const t = BR.vehicles.debugInfo().throws;
    return { vmax: r.vmax, thrown: t.length - n0, last: t[t.length - 1] || null, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)), bad, hov: hov.slice(0, 8) };
  }, { k, ids: ids14 });
  const c14 = await canState(page, k, ids14);
  const face = await ev(page, a => {
    const f = __fk.fwd(a.l.yaw), b = a.l.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const near = Math.abs(f.x) > 0.5 ? (f.x > 0 ? b.minX : b.maxX) : (f.z > 0 ? b.minZ : b.maxZ);
    return a.c.map(c => Math.abs(f.x) > 0.5 ? (near - c.x) * Math.sign(f.x) : (near - c.z) * Math.sign(f.z));
  }, { l: P14, c: c14 });
  check('I14 货叉放到底全速撞柱子（' + s14.vmax.toFixed(2) + ' m/s）：罐头甩出去落在地上，往前挪了（没留在原处），没穿进柱子、没压进车，在柱子跟前（不在柱子另一边）；' +
    '每一帧不穿东西，还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退（' + (s14.last && s14.last.how ? s14.last.how.map(h => h[1]).join(' / ') : '?') + '）',
    ids14.length === 2 && s14.thrown === 1 && c14.every(onGround) && c14.every((c, i) => c.lz < b14[i].lz - 0.1 && !c.inSolid && !c.inCar && face[i] > 0) && c14.every(lsSame) && s14.bad.length === 0 && s14.hov.length === 0, { s14, b14, c14, face });
  await shot(page, 'i14-pillar');
  // I15 倒车（2.5 m/s）撞上：罐头往车这边冲、被挡货架挡住，不掉
  const P15 = await ev(page, a => {
    // 倒着开：车尾朝着柱子。沿车尾方向找一条 3 m 的空路
    const S = __fk.allSolids(b => Math.abs(b.w - b.d) < 0.05 && b.w > 0.6 && b.w < 1.0 && b.h > 3.4);
    const pk = __fk.physKey(a.k);
    // 倒着开时车身先压上哪个 sideObs 条目（柱脚这种贴着目标的不算）：车头朝 yaw、沿 −f 走 dist 米
    const sideBack = (x, z, yaw, dist) => {
      const f = __fk.fwd(yaw), L = __fk.sideList(x - f.x * dist / 2, z - f.z * dist / 2, dist / 2 + 4);
      for (let d = 0; d <= dist + 1e-6; d += 0.05) for (const o of __fk.boxesAt(x - f.x * d, z - f.z * d, yaw, 0)) for (const e of L) if (__fk.sideHit(o, e)) return d;
      return null;
    };
    for (const b of S) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const off of [0, 0.2, -0.2]) {
      const f = __fk.fwd(yaw), cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      // 车尾（本地 z 1.276）朝着柱子：车头方向 f 背对柱子，柱子在 −f 那边
      const half = Math.abs(f.x) > 0.5 ? (b.maxX - b.minX) / 2 : (b.maxZ - b.minZ) / 2;
      const d0 = half + 1.276 + 3.2;
      const x = cx + f.x * d0 + -f.z * off, z = cz + f.z * d0 + f.x * off;
      if (__fk.hitsAt(x, z, yaw, 0, pk).length) continue;
      let hit = null;
      for (let d = 0.05; d <= 3.6; d += 0.05) { const h = __fk.hitsAt(x - f.x * d, z - f.z * d, yaw, 0, pk); if (h.length) { hit = { d, h }; break; } }
      if (!hit || hit.d < 2.8) continue;
      const sd = sideBack(x, z, yaw, hit.d);
      if (sd != null && sd < hit.d - 0.2) continue;
      return { x, z, yaw, d: hit.d, hits: hit.h };
    }
    return null;
  }, { k });
  if (!P15) { check('I15 找到一条能倒车撞柱子的直道', false); return; }
  await ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.2); return 0; }, { k, l: P15 });
  const g1 = await dropAt(page, k, -0.28), g2 = await dropAt(page, k, 0.28);
  const ids15 = [g1 && g1.id, g2 && g2.id].filter(Boolean);
  await ev(page, a => { const f = __fk.fwd(a.l.yaw); const x = a.l.x + f.x * 4.5, z = a.l.z + f.z * 4.5; __fk.stand(x, z, a.l.yaw); return 0; }, { l: P15 });
  const s15 = await ev(page, a => {
    __fk.clear();
    const n0 = BR.vehicles.debugInfo().throws.length;
    const r = __fk.drive(a.k, { throttle: -1, steer: 0, lift: 0 }, 6, { untilStop: true });
    __br.step(1.0);
    return { vmax: r.vmax, moved: r.moved, thrown: BR.vehicles.debugInfo().throws.length - n0, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)) };
  }, { k, l: P15 });
  const c15 = await canState(page, k, ids15);
  check('I15 倒车 ' + s15.vmax.toFixed(2) + ' m/s 撞上柱子（「哐」）：罐头不甩，还在叉面上', ids15.length === 2 && s15.vmax >= 2 && s15.sounds.includes('fk_bang') && s15.thrown === 0 && c15.every(onForkStill), { P15, s15, c15 });
}

// ---- 撞车甩货一件不留（返修 r5，主会话裁定 ①②④）：都在 I12 那条车轮挡直道上（叉尖前面是空地）----
// 甩出去的一件：落在地上、不在叉上、不在手里、still、模型离地 0
const lying = c => !!c && !c.gone && !c.onFork && !c.held && c.still && Math.abs(c.objDy) < 1e-4 && Math.abs(c.y - c.ground) < 0.01;
const howsOf = s => (s && s.last && Array.isArray(s.last.how) ? s.last.how.map(h => h[1]) : []);
// 甩出去的每件（返修 r6 / r7）：撞上那一刻起在叉面上一路滑（不停下又动起来、不越滑越快），翻下去以后的水平速度在叉面上的 0.6–1.5 倍之间
// （throws 里记的 u、w，和逐帧量的「翻下去变快」都查），哪一帧都不突然跳一下（翻下叉尖那一帧也是）
const motionOk = s => !!s && s.kicks.length === 0 && s.accel.length === 0 && s.speedups.length === 0 && (s.jumps || []).length === 0 && (s.wu || []).length === 0;
const motionTxt = s => 'kick ' + (s.kicks.length ? s.kicks.join(' ') : '无') + '，越滑越快 ' + (s.accel.length ? s.accel.join(' ') : '无') + '，翻下去变快 ' + (s.speedups.length ? s.speedups.join(' ') : '无') +
  '，w/u 不在 0.6–1.5 ' + ((s.wu || []).length ? s.wu.join(' ') : '无') + '，某一帧突然跳 ' + ((s.jumps || []).length ? s.jumps.join(' ') : '无');
// 同一根货叉上甩出去的几件（st 按货叉上从叉尖往叉根的顺序，tine 这根货叉中线的 lx）：裁定 ①「后面的件依次落得近一点并左右错开」——
// farther：比前一件远的（past > 前一件 + 1 mm）；inline：和前一件横着隔不到两件模型半径之和的 0.45 倍（一前一后排在同一条线上，没错开）；
// sides：3 件以上时延长线两边（±2 cm 以外）都有（返修 r6）
// 「左右错开」只查前后两件都往前落（落在叉尖前方）的：从叉边下去的落在自己原来的位置旁边，前后本来就隔着一件（返修 r7）
const orderOf = (st, tine) => {
  const farther = [], inline = [];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    if (!(b.past <= a.past + 0.001)) farther.push(b.id + ' ' + b.past + '>' + a.past);
    if (a.past > 0 && b.past > 0 && Math.abs(b.lx - a.lx) < 0.45 * (a.r + b.r)) inline.push(b.id + ' dlx ' + (b.lx - a.lx).toFixed(3));
  }
  const sides = st.length < 3 || (st.some(c => c.lx < tine - 0.02) && st.some(c => c.lx > tine + 0.02));
  return { farther, inline, sides, ok: !farther.length && !inline.length && sides };
};
const orderTxt = o => (o.farther.length ? '比前一件远：' + o.farther.join('，') : '一件比一件近或一样') + '；' + (o.inline.length ? '没错开：' + o.inline.join('，') : '和前一件左右错开') + (o.sides ? '' : '；全在延长线一边');
// 撞一次车算轨迹的上限（返修 r6，验收员：车速刚过 2 m/s、一根货叉 8 件时算了 34–42 ms，撞上那一下卡 2–3 帧）。
// I19 / I19 低速（一根货叉 2–8 件，机器空闲时 1–2.5 ms）按 20 ms；I19b 两根货叉 20 瓶水空闲时约 5 ms，负载 25–30 时实测 8–23 ms，按 40 ms
const THROW_MS_MAX = 20, THROW_MS_MAX_BIG = 40;
// 同一批甩货的总时长（撞上到最后一件落地，debugInfo().throws[i].dur；返修 r6 裁定 ①：目标 ≤1.5 s、最多 2.5 s）
const THROW_DUR_MAX = 2.5;
const durTxt = s => '总时长 ' + (s && s.last && s.last.dur != null ? s.last.dur.toFixed(2) : '?') + ' s（≤' + THROW_DUR_MAX + '，车锁 ' + (s && s.last && s.last.off != null ? s.last.off.toFixed(2) : '?') + ' s）';
const durOk = s => !!s && !!s.last && s.last.dur > 0 && s.last.dur <= THROW_DUR_MAX && s.last.off <= s.last.dur;
// 撞向空地（叉尖前方没东西挡着）时这一批要在目标 1.5 s 内落完（返修 r7：先按 1.5 s 找落点，往前落要更久的从自己旁边的叉边下去）
const THROW_DUR_GOAL = 1.5;
const durGoalOk = s => durOk(s) && s.last.dur <= THROW_DUR_GOAL + 0.02;
async function throwFieldChecks(page, k, lane) {
  const G = await ev(page, () => { const G = __fk.geo(); return { travel: G.carriageTravel || 2.6, base: (G.forkY || 0.015) + (G.forkT || 0.04) }; });
  const L05 = (0.505 - G.base) / G.travel;
  // 摆车、清掉货叉上的和这几项之前甩下来的，按 list 往货叉上摆：[id, 类型, lx, lz]
  const setup = (lift, list, l) => ev(page, a => {
    for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id);
    for (const p of BR.items.list.slice()) if (/^(i12[d-h]|i14b|i19[lb]?)-/.test(p.id)) BR.items.remove(p.id);
    __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, a.lift); __br.step(0.2);
    const ok = a.list.map(q => __fk.putOnFork(a.k, q[0], q[1], q[2], q[3]));
    __br.step(0.1);
    return { ok, before: __fk.lieState(a.k, a.list.map(q => q[0])) };
  }, { k, l: l || lane, lift, list });

  // I12e 同一根货叉上前后两件（隔 38 cm）、另一根一件，叉面 0.5 m 全速撞：三件都往前甩出（不从叉边掉），都落在叉尖前方 0.2–0.5 m，两两不叠
  {
    const ids = ['i12e-a', 'i12e-b', 'i12e-c'];
    const set = await setup(L05, [[ids[0], 'canned_food', -0.28, -2.033], [ids[1], 'canned_food', -0.28, -1.65], [ids[2], 'water_bottle', 0.28, -2.033]]);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s);
    check('I12e 叉面 0.5 m，左叉前后两只罐头（隔 38 cm）、右叉一瓶水，全速（' + s.vmax.toFixed(2) + ' m/s）撞车轮挡：三件都往前甩出（' + how.join(' / ') + '），' +
      '都落在叉尖前方 0.2–0.5 m（' + s.st.map(c => c.past != null ? c.past.toFixed(2) : '?').join(' / ') + ' m）的地上静静躺着，两两不叠（模型之间最近 ' + (s.gap * 100).toFixed(1) + ' cm）；' + durTxt(s),
      set.ok.every(Boolean) && s.thrown === 1 && !!s.last && s.last.v0 >= 2 && s.last.list.length === 3 && how.length === 3 && how.every(h => /^fwd/.test(h)) && s.falls === 0 &&
      s.st.every(c => lying(c) && c.past >= 0.2 - 0.015 && c.past <= 0.5 + 0.015) && s.gap >= 0 && durOk(s), { set, s: Object.assign({}, s, { bad: undefined, hov: undefined }) });
    check('I12e 甩出去的每一帧（' + s.frames + ' 帧）：不穿货叉、车身、碰撞体和别的物资（同一趟的两两也查）；还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退',
      s.nbad === 0 && s.nhov === 0, { bad: s.bad, hov: s.hov });
    check('I12e 三件撞上那一刻起就在叉面上一路往前滑（不停下再动、不越滑越快），翻下叉尖以后水平速度不超过在叉面上的 1.5 倍（' + motionTxt(s) + '）', motionOk(s), { speeds: s.speeds });
    await ev(page, k => __fk.viewL(k, 1.5, -1.6, 0, 0.1, -2.6), k);
    await shot(page, 'i12e-two-on-one-tine', true);
  }
  // I12f 同样三件，撞上那一刻起一直按住「升」（返修 r5）：甩出去的还在叉面上滑的时候货叉不动（轨迹按撞上那一刻的叉面算，
  // 叉面升起来会穿过它），都离开叉面以后才接着升；每一帧不穿、不悬空
  {
    const ids = ['i12e-a', 'i12e-b', 'i12e-c'];
    const set = await setup(L05, [[ids[0], 'canned_food', -0.28, -2.033], [ids[1], 'canned_food', -0.28, -1.65], [ids[2], 'water_bottle', 0.28, -2.033]]);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { liftAfter: true }), { k, ids });
    check('I12f 撞上那一刻起一直按住「升」：甩出去的还在叉面上的时候货叉一点没动（' + (s.lock.length ? s.lock.join(' ') : '没动') + '），都离开叉面以后才接着升（升了 ' + (s.liftRose != null ? (s.liftRose * 2.6 * 100).toFixed(1) : '?') + ' cm）；' +
      '三件都落在地上，每一帧（' + s.frames + ' 帧）不穿、不悬空、不往回退',
      set.ok.every(Boolean) && s.thrown === 1 && !!s.last && s.last.list.length === 3 && s.lock.length === 0 && s.liftRose > 0.004 && s.st.every(c => lying(c)) && s.nbad === 0 && s.nhov === 0,
      { s: Object.assign({}, s, { st: undefined }), st: s.st });
    // 东西都落了地以后照常能倒出来（返修 r6 裁定 ①）：按住 S 1 s，车往后退了、没压着地上那三件、车已经不锁了
    const back = await ev(page, a => {
      const r = __fk.drive(a.k, { throttle: -1, steer: 0, lift: 0 }, 1.0);
      __br.step(1 / 30);
      return { moved: r.moved, bad: __fk.fallBad(a.k, a.ids), busy: (BR.vehicles.debugInfo().throwBusy || []).includes(a.k) };
    }, { k, ids });
    check('I12f 按住「升」撞完、东西都落了地以后，按住 S 车照常倒出来（1 s 退了 ' + back.moved.toFixed(2) + ' m），没压着地上那三件，车已经不锁了',
      back.moved >= 0.3 && back.bad.length === 0 && !back.busy, back);
    await ev(page, a => { __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.1); return 0; }, { k, l: lane });
  }
  // I12g 撞上那一刻起马上倒车（按住 S；再来一趟 S + A，倒车打方向）（返修 r6，验收员 r6 的场景：孩子撞完马上往回开）：
  // 甩出去的轨迹是按撞上那一刻的车位姿算的，还有东西没离开叉面（翻下叉尖 / 叉沿）的时候车刹住不动（货叉也不动），
  // 都离开叉面以后车才照常倒出去。I12e 那三件（叉面 0.5 m）和左叉 8 只罐头（叉底 0.3 m）各两趟；每一帧不穿、不悬在叉尖 / 叉沿外面、不往回退
  for (const [what, lift, list] of [
    ['I12e 那三件（叉面 0.5 m，左叉前后两只罐头、右叉一瓶水）', L05, [['i12g-a', 'canned_food', -0.28, -2.033], ['i12g-b', 'canned_food', -0.28, -1.65], ['i12g-c', 'water_bottle', 0.28, -2.033]]],
    ['左叉 8 只罐头（叉底 0.3 m）', 0.11, Array.from({ length: 8 }, (_, i) => ['i12g-' + i, 'canned_food', -0.28, -2.033 + 0.105 * i])],
  ]) {
    for (const steer of [0, 1]) {
      const ids = list.map(q => q[0]);
      const set = await setup(lift, list);
      await parkPlayerBehind(page, lane);
      const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { after: { throttle: -1, steer: a.steer, sec: 2.5 } }), { k, ids, steer });
      const keys = steer ? 'S 和 A（倒车打方向）' : 'S（倒车）';
      check('I12g ' + what + '全速（' + s.vmax.toFixed(2) + ' m/s）撞车轮挡，撞上那一刻起按住 ' + keys + '：还有东西没离开叉面时车刹住不动（这时车动了 ' + s.nBusyMoved + ' 帧、后轮转了 ' + s.nBusySteer + ' 帧），' +
        (s.lockT != null ? s.lockT.toFixed(2) : '?') + ' s 后都离开叉面、车才倒出去（离撞停的地方 ' + s.movedAfter.toFixed(2) + ' m）；一件不留，都落在地上静静躺着（' + howsOf(s).join(' / ') + '）；' + durTxt(s),
        set.ok.every(Boolean) && s.thrown === 1 && !!s.last && s.last.list.length === ids.length && howsOf(s).every(h => /^fwd/.test(h)) && s.riders.length === 0 &&
        s.nBusyMoved === 0 && s.nBusySteer === 0 && s.lockT != null && s.lockT <= s.last.off + 0.05 && s.movedAfter >= 0.3 && s.st.every(c => lying(c)) && durOk(s),
        { s: Object.assign({}, s, { bad: undefined, hov: undefined, st: undefined }), st: s.st });
      check('I12g ' + what + '撞上就按住 ' + keys + '：甩出去的每一帧（' + s.frames + ' 帧）不穿货叉、车身、碰撞体和别的物资；还在叉面高度时不悬在叉尖 / 叉沿外面（按车此刻的位姿查）、不往回退；' + motionTxt(s),
        s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
      // 截图按撞停那一刻的车位姿取景（车已经倒开、打过方向，按车现在的位姿取景画面里只有货叉和地面，验收员 r6）
      if (steer && ids.length === 8) { await ev(page, p => __fk.viewP(p, 1.2, -1.5, -0.28, 0.0, -2.4), s.crash); await shot(page, 'i12g-reverse-steer-8', true); }
    }
  }
  // I12h 真键盘（返修 r6）：坐上车（空格），按住 W 全速撞车轮挡，撞上那一帧松开 W、按住 S 2.5 s：车先刹住不动、提示
  // 「货叉上的东西还在往下掉」，8 只罐头都离开叉面以后才倒出去；每一帧不穿、不悬空
  {
    const ids = Array.from({ length: 8 }, (_, i) => 'i12h-' + i);
    const set = await setup(0.11, ids.map((id, i) => [id, 'canned_food', -0.28, -2.033 + 0.105 * i]));
    const m = await mountCar(page, k, 'left');
    await ev(page, () => { __fk.clear(); __fk.hoverReset(); return 0; });
    const n0 = await ev(page, () => BR.vehicles.debugInfo().throws.length);
    const bad = [], hov = [], moved = [];
    let crash = null, vmax = 0, lockT = null, frames = 0;
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 240; i++) {
      const r = await ev(page, a => {
        __br.step(1 / 30);
        const p = __fk.pose(a.k), d = BR.vehicles.debugInfo();
        return { p: { x: p.x, z: p.z, spd: p.spd }, thr: d.throws.length, busy: (d.throwBusy || []).includes(a.k), falls: d.falls, bad: __fk.fallBad(a.k, a.ids), hov: __fk.hover(a.k, a.ids) };
      }, { k, ids });
      vmax = Math.max(vmax, Math.abs(r.p.spd));
      bad.push(...r.bad); hov.push(...r.hov);
      if (!crash && r.thr > n0) { crash = { x: r.p.x, z: r.p.z, i }; await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS'); continue; }
      if (!crash) { if (i > 150) break; continue; }
      frames++;
      if (r.busy && Math.hypot(r.p.x - crash.x, r.p.z - crash.z) > 0.002) moved.push(frames);
      if (!r.busy && lockT == null) lockT = frames / 30;
      if (frames >= 75) break;
    }
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS'); await step(page, 1 / 30);
    for (let i = 0; i < 60; i++) {
      const r = await ev(page, a => { __br.step(1 / 30); return { falls: BR.vehicles.debugInfo().falls, bad: __fk.fallBad(a.k, a.ids), hov: __fk.hover(a.k, a.ids) }; }, { k, ids });
      bad.push(...r.bad); hov.push(...r.hov);
      if (!r.falls) break;
    }
    const res = await ev(page, a => {
      const t = BR.vehicles.debugInfo().throws, p = __fk.pose(a.k);
      return { last: t.length > a.n0 ? t[t.length - 1] : null, notes: __fk.notes.slice(), st: __fk.lieState(a.k, a.ids), riders: BR.vehicles.debugInfo().riders[a.k] || [], p: { x: p.x, z: p.z } };
    }, { k, ids, n0 });
    const back = crash ? Math.hypot(res.p.x - crash.x, res.p.z - crash.z) : 0;
    check('I12h 真键盘：坐上车按住 W 全速（' + vmax.toFixed(2) + ' m/s）撞车轮挡，撞上那一帧松开 W、按住 S：8 只罐头还在叉面上时车刹住不动（动了 ' + moved.length + ' 帧）、提示「货叉上的东西还在往下掉」，' +
      (lockT != null ? lockT.toFixed(2) : '?') + ' s 后车才倒出去（' + back.toFixed(2) + ' m）；一件不留，都落在地上',
      set.ok.every(Boolean) && m.ok && !!crash && !!res.last && res.last.list.length === 8 && moved.length === 0 && lockT != null && lockT <= 2.0 && back >= 0.3 &&
      res.notes.includes('货叉上的东西还在往下掉') && res.riders.length === 0 && res.st.every(c => lying(c)),
      { m: m.ok, crash, lockT, back, notes: res.notes.slice(0, 6), how: res.last && res.last.how, st: res.st });
    check('I12h 真键盘撞上就倒车：甩出去的每一帧不穿货叉、车身、碰撞体和别的物资；还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退', bad.length === 0 && hov.length === 0, { bad: bad.slice(0, 8), hov: hov.slice(0, 8) });
    await dismount(page);
  }

  // I19 同一根货叉上 2 件、4 件、8 件（按往货叉上丢时排开的间隔：两件模型半径之和 + 1 cm），叉底 0.3 m 全速撞向空地：
  // 一件不留，都往前落在叉尖前方的地上（最前面那件在这根货叉的延长线上 0.2–0.5 m，后面的依次近一点、左右错开），两两不叠、不穿，逐帧查。
  // 返修 r7：这一批 1.5 s 内落完；8 件时最靠车的一两件往前落要更久，允许它们从自己旁边的叉边下去（落在叉尖后面，照样不比前一件远）
  for (const N of [2, 4, 8]) {
    const ids = Array.from({ length: N }, (_, i) => 'i19-' + N + '-' + i);
    const set = await setup(0.11, ids.map((id, i) => [id, 'canned_food', -0.28, -2.033 + 0.105 * i]));
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s), front = s.st[0], ord = orderOf(s.st, -0.28);
    check('I19 左叉上 ' + N + ' 只罐头全速（' + s.vmax.toFixed(2) + ' m/s）撞向空地：一件不留，都往前落在叉尖前方的地上静静躺着（离叉尖 ' + s.st.map(c => c.past != null ? c.past.toFixed(3) : '?').join(' / ') + ' m，' +
      '横着 ' + s.st.map(c => (c.lx + 0.28).toFixed(2)).join(' / ') + ' m）—— ' + orderTxt(ord) + '；最前面那只在延长线上 0.2–0.5 m，两两不叠（模型之间最近 ' + (s.gap * 100).toFixed(1) + ' cm），算轨迹 ' + s.throwMs + ' ms（≤' + THROW_MS_MAX + '），' + durTxt(s),
      set.ok.every(Boolean) && s.thrown === 1 && !!s.last && s.last.v0 >= 2 && s.last.list.length === N && how.length === N && s.falls === 0 && s.riders.length === 0 &&
      (N < 8 ? how.every(h => /^fwd/.test(h)) : how.slice(0, 6).every(h => /^fwd/.test(h)) && how.every(h => /^(fwd|side)/.test(h))) &&
      s.st.every((c, i) => lying(c) && (/^side/.test(how[i]) || (c.past > 0.05 && c.past <= 0.5 + 0.015))) && !!front && front.past >= 0.2 - 0.015 && Math.abs(front.lx + 0.28) < 0.03 && s.gap >= 0.005 && ord.ok && s.throwMs <= THROW_MS_MAX && durGoalOk(s),
      { set: set.ok, ord, s: Object.assign({}, s, { bad: undefined, hov: undefined }) });
    check('I19 ' + N + ' 只：甩出去的每一帧（' + s.frames + ' 帧）不穿货叉、车身、碰撞体，两两不穿；还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退；' + motionTxt(s),
      s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
    if (N === 8) { await ev(page, k => __fk.viewL(k, 0.9, -1.2, -0.28, 0.0, -2.5), k); await shot(page, 'i19-eight-on-one-tine', true); }
  }
  // I19 低速档（返修 r6，验收员 r6 的 slow 场景）：车停在离车轮挡十来厘米的地方、车速直接设成 2.05 m/s 再踩油门，撞前约 2.1 m/s（刚过 2 m/s 的门槛，
  // 叉尖前方只有十几厘米深）。同一根货叉 4 只、8 只罐头：最前面那只在延长线上 0.2 m 左右，后面的一只比一只近（最多同一排往旁边放），
  // 没有一只比前一只远；往前落的横向离这根货叉 ≤26 cm；两两不叠，逐帧不穿、不悬空。
  // 返修 r7：这一批 1.5 s 内落完。翻下去以后的水平速度要和在叉面上的接得上（≥0.6 倍），叉尖前方这十几厘米只排得下前面几只，
  // 8 只时后面两三只从自己旁边的叉边滑下去（落在叉尖后面，不比前一只远），不在叉面上慢慢挪两秒多
  const laneLow = await ev(page, a => { const f = __fk.fwd(a.l.yaw), d = Math.max(0, a.l.contact - 0.12); return { x: a.l.x + f.x * d, z: a.l.z + f.z * d, yaw: a.l.yaw }; }, { l: lane });
  // 撞前车速两档：直接设成 2.05 和 2.1 m/s（裁定 ②「I19 加 2.1 m/s 的情况并检查顺序」）
  for (const [N, V0] of [[4, 2.05], [8, 2.05], [4, 2.1], [8, 2.1]]) {
    const ids = Array.from({ length: N }, (_, i) => 'i19l-' + N + '-' + i);
    const set = await setup(0.11, ids.map((id, i) => [id, 'canned_food', -0.28, -2.033 + 0.105 * i]), laneLow);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { inject: a.v }), { k, ids, v: V0 });
    const how = howsOf(s), front = s.st[0], past = s.st.map(c => c.past), ord = orderOf(s.st, -0.28);
    const wide = s.st.filter((c, i) => /^fwd/.test(how[i]) && !(Math.abs(c.lx + 0.28) <= 0.26 + 0.005)).map(c => c.id + ' ' + c.lx);
    const nf = how.filter(h => /^fwd/.test(h)).length;
    check('I19 低速：左叉 ' + N + ' 只罐头、车速设成 ' + V0 + '、撞前 ' + (s.last ? s.last.v0 : '?') + ' m/s（2.0–2.4）撞向空地：一件不留，' + nf + ' 只往前落、其余从叉边下去（' + how.join(' / ') + '）；离叉尖 ' + past.map(p => p != null ? p.toFixed(3) : '?').join(' / ') +
      ' m、横着 ' + s.st.map(c => (c.lx + 0.28).toFixed(2)).join(' / ') + ' m —— ' + orderTxt(ord) + '，最前面那只 0.2 m 左右、在延长线上；横向都在这根货叉 ±26 cm 以内（' + (wide.length ? wide.join('，') : '是') + '）；' +
      '两两不叠（模型之间最近 ' + (s.gap * 100).toFixed(1) + ' cm），算轨迹 ' + s.throwMs + ' ms（≤' + THROW_MS_MAX + '），' + durTxt(s),
      set.ok.every(Boolean) && durGoalOk(s) && s.thrown === 1 && !!s.last && s.last.v0 >= 2 && s.last.v0 <= 2.4 && s.last.list.length === N && how.every(h => /^(fwd|side)/.test(h)) && nf >= Math.min(N, 4) && s.riders.length === 0 &&
      s.st.every(c => lying(c)) && ord.ok && !!front && front.past >= 0.2 - 0.015 && front.past <= 0.26 && Math.abs(front.lx + 0.28) < 0.03 && wide.length === 0 && s.gap >= 0.005 && s.throwMs <= THROW_MS_MAX,
      { set: set.ok, ord, s: Object.assign({}, s, { bad: undefined, hov: undefined }) });
    check('I19 低速 ' + N + ' 只（' + V0 + ' m/s）：甩出去的每一帧（' + s.frames + ' 帧）不穿、不悬空、不往回退；' + motionTxt(s), s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
    if (N === 8) { await ev(page, k => __fk.viewL(k, 0.9, -1.2, -0.28, 0.0, -2.4), k); await shot(page, 'i19-low-speed-eight-' + String(V0).replace('.', ''), true); }
  }

  // I19b 两根货叉各摆 10 瓶水（按往货叉上丢时排开的间隔：两件模型半径之和 + 1 cm，叉尖到叉根摆满），叉底 0.3 m 全速撞向空地（返修 r6，验收员 spec 的 cap 场景：
  // 以前一次只摆前 16 件，多出来的 4 瓶留在叉上、throws 里却写着甩出去了）：一件不留，throws 那一条的 list 是 20 件、how 都是往前或从叉边下去，
  // riders 空了，都落在地上静静躺着，每根货叉上的依次近一点、左右错开，两两不叠；逐帧不穿、不悬空
  {
    const fr = 0.0388, pitch = 2 * fr + 0.01;
    const list = [];
    for (const [tag, lx] of [['L', -0.28], ['R', 0.28]]) for (let i = 0; i < 10; i++) list.push(['i19b-' + tag + i, 'water_bottle', lx, -2.1 + fr + 0.02 + pitch * i]);
    const ids = list.map(q => q[0]);
    const set = await setup(0.11, list);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s);
    const oL = orderOf(s.st.slice(0, 10), -0.28), oR = orderOf(s.st.slice(10), 0.28);
    check('I19b 两根货叉各摆 10 瓶水（' + set.ok.filter(Boolean).length + ' 瓶摆上去），叉底 0.3 m 全速（' + s.vmax.toFixed(2) + ' m/s）撞向空地：一件不留（throws 那一条 ' + (s.last ? s.last.list.length : '?') + ' 件，叉上还剩 ' + s.riders.length + ' 件），' +
      '都落在地上静静躺着（' + how.filter(h => /^side/.test(h)).length + ' 件从叉边下去，' + how.filter(h => /^stay/.test(h)).length + ' 件留在叉上，其余往前）；左叉 ' + orderTxt(oL) + '，右叉 ' + orderTxt(oR) + '；两两不叠（模型之间最近 ' + (s.gap * 100).toFixed(1) + ' cm），算轨迹 ' + s.throwMs + ' ms（≤' + THROW_MS_MAX_BIG + '），' + durTxt(s),
      set.ok.every(Boolean) && durGoalOk(s) && s.thrown === 1 && !!s.last && s.last.list.length === 20 && how.length === 20 && how.every(h => /^(fwd|side)/.test(h)) && s.riders.length === 0 &&
      s.st.every(c => lying(c)) && oL.farther.length === 0 && oR.farther.length === 0 && s.gap >= 0.005 && s.throwMs <= THROW_MS_MAX_BIG,
      { set: set.ok, oL, oR, s: Object.assign({}, s, { bad: undefined, hov: undefined, st: undefined }), st: s.st });
    check('I19b 20 瓶水：甩出去的每一帧（' + s.frames + ' 帧）不穿、不悬空、不往回退；' + motionTxt(s), s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
    await ev(page, k => __fk.viewL(k, 0.0, -3.6, 0.0, 0.0, -2.3), k);
    await shot(page, 'i19b-twenty-bottles', true);
  }

  // I19c 同样两根货叉各 10 瓶水，撞前 2.5 m/s（返修 r7，验收员 r7 的 sweep：r6 这时总时长 1.92 s、车锁 1.66 s，是最长的一种）：
  // 一件不留，这一批 1.5 s 内落完（裁定 ① 的目标），每根货叉上不比前一件远，逐帧不穿、不悬空，动作接得上
  {
    const fr = 0.0388, pitch = 2 * fr + 0.01;
    const list = [];
    for (const [tag, lx] of [['L', -0.28], ['R', 0.28]]) for (let i = 0; i < 10; i++) list.push(['i19b-' + tag + i, 'water_bottle', lx, -2.1 + fr + 0.02 + pitch * i]);
    const ids = list.map(q => q[0]);
    const set = await setup(0.11, list, laneLow);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { inject: 2.5 }), { k, ids });
    const how = howsOf(s);
    const oL = orderOf(s.st.slice(0, 10), -0.28), oR = orderOf(s.st.slice(10), 0.28);
    check('I19c 两根货叉各 10 瓶水、撞前 ' + (s.last ? s.last.v0 : '?') + ' m/s 撞向空地：一件不留（' + (s.last ? s.last.list.length : '?') + ' 件，叉上剩 ' + s.riders.length + ' 件；' +
      how.filter(h => /^side/.test(h)).length + ' 件从叉边下去），都落在地上静静躺着；左叉 ' + orderTxt(oL) + '，右叉 ' + orderTxt(oR) + '；算轨迹 ' + s.throwMs + ' ms（≤' + THROW_MS_MAX_BIG + '），' + durTxt(s) + '（目标 ≤' + THROW_DUR_GOAL + ' s）',
      set.ok.every(Boolean) && durGoalOk(s) && s.thrown === 1 && !!s.last && s.last.v0 >= 2.3 && s.last.list.length === 20 && how.every(h => /^(fwd|side)/.test(h)) && s.riders.length === 0 &&
      s.st.every(c => lying(c)) && oL.farther.length === 0 && oR.farther.length === 0 && s.gap >= 0.005 && s.throwMs <= THROW_MS_MAX_BIG,
      { set: set.ok, oL, oR, s: Object.assign({}, s, { bad: undefined, hov: undefined, st: undefined }), st: s.st });
    check('I19c 20 瓶水（2.5 m/s）：甩出去的每一帧（' + s.frames + ' 帧）不穿、不悬空、不往回退；' + motionTxt(s), s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
  }

  // I17b 站在同一个地方往左货叉上连丢三次（返修 r4 验收员的场景：排开的间隔 1 cm），右货叉丢一只，叉面 0.5 m 全速撞向空地：一件不留，都往前落、两两不叠
  {
    await ev(page, a => {
      for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id);
      for (const p of BR.items.list.slice()) if (/^(i12[d-h]|i14b|i19[lb]?)-/.test(p.id)) BR.items.remove(p.id);
      __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, a.lift); __br.step(0.2); return 0;
    }, { k, l: lane, lift: L05 });
    const ds = [];
    for (let i = 0; i < 3; i++) ds.push(await dropAt(page, k, -0.28, 'canned_food'));
    ds.push(await dropAt(page, k, 0.28, 'canned_food'));
    const ids = ds.map(d => d && d.id);
    await parkPlayerBehind(page, lane);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s);
    check('I17b 站在原地往左货叉上连丢三次（叉上 ' + ds.slice(0, 3).map(d => d ? d.lz.toFixed(3) : '?').join(' / ') + '）、右货叉一只，叉面 0.5 m 全速（' + s.vmax.toFixed(2) + ' m/s）撞向空地：' +
      '一件不留（' + how.join(' / ') + '），都往前落在叉尖前方的地上静静躺着，两两不叠（模型之间最近 ' + (s.gap * 100).toFixed(1) + ' cm），每一帧不穿、不悬空、不往回退',
      ds.every(d => d && d.onFork) && s.thrown === 1 && !!s.last && s.last.list.length === 4 && how.length === 4 && how.every(h => /^fwd/.test(h)) && s.riders.length === 0 &&
      s.st.every(c => lying(c) && c.past > 0.05 && c.past <= 0.5 + 0.015) && s.gap >= 0.005 && s.nbad === 0 && s.nhov === 0,
      { ds, s: Object.assign({}, s, { bad: s.bad, hov: s.hov }) });
    await ev(page, a => { for (const id of a.ids) if (id && BR.items.find(id)) BR.items.remove(id); return 0; }, { ids });
  }

  // I12d 真开、边开边升（裁定 ②：举高了限速，叉底过 0.5 m 以后按 6 m/s² 减到 1.0 m/s；全速时按住「升」，减到 2 m/s 之前叉面还能升到约 0.7 m）：
  // 真开能达到的最高「往前甩」—— 撞上那一刻叉面 ≥0.62 m、撞前 ≥2 m/s，两只罐头往前甩出、落在叉尖前方 0.2–0.5 m，逐帧不穿、不悬空
  {
    const lane2 = await ev(page, a => {
      const G = __fk.geo();
      let front = 0;
      for (const o of G.obbs(a.L)) if (o.cy - o.hy < 0.12) front = Math.min(front, o.cz - Math.abs(o.hz));
      const stops = __fk.allSolids(b => Math.abs(b.h - 0.12) < 0.01 && Math.max(b.w, b.d) > 1.4 && Math.min(b.w, b.d) < 0.25);
      for (const b of stops) {
        const l = __fk.laneTo(a.k, b, { runs: [7, 6.5, 6, 5.5], offs: [0, 0.15, -0.15], lift: a.L, frontZ: front });
        if (!l) continue;
        const f = __fk.fwd(l.yaw);
        if (__fk.ohHit(l.x, l.z, l.yaw, a.L2) || __fk.ohHit(l.x + f.x * l.contact, l.z + f.z * l.contact, l.yaw, a.L2)) continue;
        return Object.assign(l, { box: b, front });
      }
      return null;
    }, { k, L: L05, L2: 0.3 });
    if (!lane2) check('I12d 找到一条 5.5 m 以上、能全速撞上车轮挡的直道（边开边升用）', false);
    else {
      const ids = ['i12d-a', 'i12d-b'];
      const set = await setup(L05, [[ids[0], 'canned_food', -0.28, -1.95], [ids[1], 'canned_food', 0.28, -1.95]], lane2);
      await parkPlayerBehind(page, lane2);
      // 全速（≥4 m/s）时，算好离撞上还有多远按住「升」：叉底 0.078 s 后过 0.5 m，之后按 6 m/s² 减速；挑撞上时车速约 2.35 m/s 的那一刻
      const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { liftAt: (p, d) => {
        const v = p.spd;
        if (v < 4) return false;
        const T = 0.078 + (v - 2.35) / 6, D = v * T - 3 * Math.pow(T - 0.078, 2);
        return a.contact - d <= D;
      } }), { k, ids, contact: lane2.contact });
      const how = howsOf(s);
      check('I12d 真开边开边升（' + (s.pressed ? s.pressed.v.toFixed(2) + ' m/s、离撞上 ' + (lane2.contact - s.pressed.d).toFixed(2) + ' m 时按住「升」' : '没按到「升」') + '）：撞上那一刻叉面 ' + (s.surfAt != null ? s.surfAt.toFixed(2) : '?') +
        ' m（≥0.62）、撞前 ' + (s.last ? s.last.v0 : '?') + ' m/s（≥2）；两只罐头往前甩出（' + how.join(' / ') + '），落在叉尖前方 0.2–0.5 m（' + s.st.map(c => c.past != null ? c.past.toFixed(2) : '?').join(' / ') + ' m）、各在自己那根货叉的延长线上，静静躺着',
        set.ok.every(Boolean) && !!s.pressed && s.surfAt != null && s.surfAt >= 0.62 && s.thrown === 1 && !!s.last && s.last.v0 >= 2 && s.last.list.length === 2 && how.every(h => /^fwd/.test(h)) &&
        s.st.every((c, i) => lying(c) && c.past >= 0.2 - 0.015 && c.past <= 0.5 + 0.015 && Math.abs(c.lx - set.before[i].lx) < 0.03), { lane2: { run: lane2.run, contact: lane2.contact }, s: Object.assign({}, s, { bad: undefined, hov: undefined }) });
      check('I12d 甩出去的每一帧（' + s.frames + ' 帧）：不穿货叉、车身、碰撞体和别的物资；还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退', s.nbad === 0 && s.nhov === 0, { bad: s.bad, hov: s.hov });
      await ev(page, k => __fk.viewL(k, 1.5, -1.6, 0, 0.1, -2.6), k);
      await shot(page, 'i12d-lift-while-driving', true);
    }
  }
  // I14b 叉尖顶着带柱础的柱子、叉面 0.5 m 全速撞上（验收员 pillarR1 场景，种子 12345 的方柱 (12, 28)，车从 (6, 28) 朝 +x 开过去），只放最前面那两件
  // （左叉罐头、右叉水瓶）：叉尖前面是柱子、底下是柱础（比柱身每边宽 8 cm、高 22 cm），左叉外侧是柱础角上的护角，地上哪儿都落不了。
  // 返修 r6 裁定 ④：最后一档允许整个稳稳落在离地 ≤0.3 m 的矮东西顶上（落稳的标准和地面一样：圆心和周围 0.35 个模型半径底下是同一个面）——
  // 罐头和水瓶都从两叉中间翻下去，落在柱础顶上（how 带 '-top'），一件不留，静静立着。每一帧不穿、不悬空
  {
    const ids = ['i14b-a', 'i14b-c'];
    const PL = { x: 6.0, z: 28.0, yaw: -Math.PI / 2 };
    const set = await setup(L05, [[ids[0], 'canned_food', -0.28, -2.033], [ids[1], 'water_bottle', 0.28, -2.025]], PL);
    await parkPlayerBehind(page, PL);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s), hw = s.last && Array.isArray(s.last.how) ? s.last.how : [];
    const howOf = id => (hw.find(h => h[0] === id) || [])[1] || '';
    // 柱础顶面多高（sideObs 'plinth' 条目的 maxY）、两件在不在它上面
    const top = await ev(page, a => a.ids.map(id => {
      const p = BR.items.find(id);
      if (!p) return null;
      let pl = null;
      for (const e of __fk.sideAll()) if (e.kind === 'plinth' && p.x >= e.minX - 1e-3 && p.x <= e.maxX + 1e-3 && p.z >= e.minZ - 1e-3 && p.z <= e.maxZ + 1e-3) pl = Math.max(+e.minY, +e.maxY);
      return { id, y: __fk.r(p.y), plinth: pl, still: !!p.still, held: !!p.held, objDy: p.obj ? __fk.r(p.obj.position.y - p.y, 10000) : null };
    }), { ids });
    const onTop = q => !!q && q.plinth != null && Math.abs(q.y - q.plinth) < 0.006 && q.still && !q.held && Math.abs(q.objDy) < 1e-4;
    check('I14b 叉面 0.5 m 全速（' + s.vmax.toFixed(2) + ' m/s）撞带柱础的方柱、叉尖前面是柱子、两边和底下只有柱础和护角：罐头、水瓶都落在柱础顶上（' + how.join(' / ') + '，y ' +
      top.map(q => q ? q.y + ' = 柱础顶 ' + q.plinth : '?').join('、') + '），一件不留，静静立着；throws 记了这一次（list ' + (s.last ? s.last.list.length : '?') + ' 件）；每一帧不穿、不悬空',
      set.ok.every(Boolean) && s.sounds.includes('fk_bang') && s.thrown === 1 && !!s.last && s.last.v0 >= 2 && s.last.list.length === 2 && how.length === 2 &&
      ids.every(id => /^side-.*-top/.test(howOf(id))) && top.every(onTop) && s.riders.length === 0 && s.nbad === 0 && s.nhov === 0,
      { set: set.ok, top, s: Object.assign({}, s, { st: undefined }), st: s.st });
    await ev(page, a => __fk.viewP(a.p, 0.9, -1.25, 0.0, 0.2, -2.25), { p: s.crash });
    await shot(page, 'i14b-can-and-bottle-on-plinth', true);
  }
  // I14c 实在没处落（裁定 ①「全部留下时也要有记录」）：左叉尖上只放一只蛾子果冻（模型半径 5.7 cm），再全速撞同一根柱子 ——
  // 前面是柱子，外侧是护角，两叉中间和底下的柱础顶离柱身留够 1.7 cm 以后，果冻的重心离柱础外沿不到 0.35 个半径（放不稳），
  // 地上又够不着（不往车这边退）：一件都没甩出去、留在叉上，throws 照样多一条（list 空、how 写 'stay (…)' 说明每一步为什么不行）
  {
    const PL = { x: 6.0, z: 28.0, yaw: -Math.PI / 2 };
    const ids = ['i14b-j'];
    const set2 = await setup(L05, [[ids[0], 'moth_jelly', -0.28, -2.03]], PL);
    await parkPlayerBehind(page, PL);
    const s2 = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how2 = howsOf(s2);
    check('I14c 叉尖上只有一只蛾子果冻、全速撞同一根柱子：没有一处放得稳，一件都没甩出去（留在叉上），throws 照样多一条（list ' + (s2.last ? s2.last.list.length : '?') + ' 件），how 写着为什么留下（' + how2.join(' / ') + '）',
      set2.ok.every(Boolean) && s2.sounds.includes('fk_bang') && s2.thrown === 1 && !!s2.last && s2.last.list.length === 0 && how2.length === 1 && /^stay \(.*S:.+T:.+\)$/.test(how2[0]) && s2.riders.includes(ids[0]) && s2.nbad === 0 && s2.nhov === 0,
      { s2: Object.assign({}, s2, { st: undefined }) });
  }
  // I14d 同一根柱子（返修 r7，验收员 spec 的 pscan）：右叉按往货叉上丢时的间隔（两件模型半径之和 + 1 cm）前后摆两瓶水，再来一趟左叉 4 只罐头、右叉 4 瓶水。
  // r6 时后面那瓶水从叉边下去的候选每 2 cm 一格、走过它自己原来的位置就停，差 1.3 cm 的那一格压着柱础，它自己旁边的空地没试，留在了叉上；
  // 现在最后一格就是它自己原来的位置：一件不留（how 里没有 stay），都静静落在地上或柱础顶上，每一帧不穿、不悬空，动作接得上
  for (const [tag, list] of [
    ['右叉两瓶水', [['i14b-r0', 'water_bottle', 0.28, -2.0407], ['i14b-r1', 'water_bottle', 0.28, -2.0407 + 0.0876]]],
    ['左叉 4 罐 + 右叉 4 瓶水', [0, 1, 2, 3].map(i => ['i14b-l' + i, 'canned_food', -0.28, -2.033 + 0.105 * i]).concat([0, 1, 2, 3].map(i => ['i14b-w' + i, 'water_bottle', 0.28, -2.0407 + 0.0876 * i]))],
  ]) {
    const PL = { x: 6.0, z: 28.0, yaw: -Math.PI / 2 };
    const ids = list.map(q => q[0]);
    const set = await setup(L05, list, PL);
    await parkPlayerBehind(page, PL);
    const s = await crashRun(page, a => __fk.crashStart(a.k, a.ids), { k, ids });
    const how = howsOf(s);
    const rest = await ev(page, a => a.ids.map(id => {
      const p = BR.items.find(id);
      if (!p) return { id, gone: true };
      let top = BR.phys.groundY(p.x, p.z);
      for (const e of __fk.sideAll()) if (e.kind === 'plinth' && p.x >= e.minX - 1e-3 && p.x <= e.maxX + 1e-3 && p.z >= e.minZ - 1e-3 && p.z <= e.maxZ + 1e-3) top = Math.max(top, +e.minY, +e.maxY);
      return { id, y: __fk.r(p.y), top: __fk.r(top), still: !!p.still, held: !!p.held, objDy: p.obj ? __fk.r(p.obj.position.y - p.y, 10000) : null };
    }), { ids });
    const restOk = q => !!q && !q.gone && Math.abs(q.y - q.top) < 0.008 && q.still && !q.held && Math.abs(q.objDy) < 1e-4;
    check('I14d ' + tag + '（按往货叉上丢时的间隔摆）、叉面 0.5 m 全速（' + s.vmax.toFixed(2) + ' m/s）撞带柱础的方柱：一件不留（' + how.join(' / ') + '），都静静落在地上或柱础顶上（' +
      rest.map(q => q.id.replace('i14b-', '') + ' ' + q.y).join('、') + '）；' + durTxt(s),
      set.ok.every(Boolean) && s.thrown === 1 && !!s.last && s.last.list.length === ids.length && how.length === ids.length && how.every(h => !/^stay/.test(h)) && s.riders.length === 0 && rest.every(restOk) && durOk(s),
      { set: set.ok, rest, how: s.last && s.last.how });
    check('I14d ' + tag + '：甩出去的每一帧（' + s.frames + ' 帧）不穿货叉、车身、柱子、柱础和别的物资；还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退；' + motionTxt(s),
      s.nbad === 0 && s.nhov === 0 && motionOk(s), { bad: s.bad, hov: s.hov, speeds: s.speeds });
  }
  await ev(page, a => { for (const p of BR.items.list.slice()) if (/^(i12[d-h]|i14b|i19[lb]?)-/.test(p.id)) BR.items.remove(p.id); __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.1); return 0; }, { k, l: lane });
}

// ---- 举着货叉全速撞墙（FE1 返修 r3 裁定 ①）：叉面 0.5 m、1.2 m、满升各撞一次 ----
// 墙：出生块小屋的长墙（高 2.9 m，满升叉面 2.66 m 也撞得上）。叉尖顶着墙、前面没地方：瓶罐沿货叉滑到墙跟前，从叉边滑下去，
// 竖直掉到地上（贴着墙）；任何一帧都不穿过货叉、车身、墙，不会落在举着的货叉正下方。
// 车速：货叉底高过 0.5 m 限速 1.0 m/s、高过 1.5 m 限速 0.6 m/s（方案 drive），叉面 1.2 m 和满升真开过去到不了 2 m/s 的甩货门槛：
// 只「哐」/「咚」、东西留在叉上（I16b 照这个查）；这两个高度另外把撞前车速直接设成 3.9 m/s（I16c：模拟举着货叉还没减下速来的那一下）查甩出去的轨迹
async function throwHighChecks(page, k) {
  await ev(page, installSide);
  const G = await ev(page, () => { const G = __fk.geo(); return { travel: G.carriageTravel || 2.6, base: (G.forkY || 0.015) + (G.forkT || 0.04) }; });
  const walls = await ev(page, () => __fk.solids('0,0').filter(b => Math.abs(b.h - 2.9) < 0.05 && Math.min(b.w, b.d) < 0.25 && Math.max(b.w, b.d) > 5.5));
  const CASES = [{ name: '0.5 m', surf: 0.505, modes: ['real'] }, { name: '1.2 m', surf: 1.2, modes: ['real', 'inject'] }, { name: '满升', surf: null, modes: ['real', 'inject'] }];
  for (const C of CASES) {
    const lift = C.surf == null ? 1 : (C.surf - G.base) / G.travel;
    const surf = G.base + lift * G.travel;
    for (const mode of C.modes) {
      const tag = mode === 'inject' ? 'I16c' : C.surf === 0.505 ? 'I16' : 'I16b';
      const what = '叉面 ' + C.name + '（' + surf.toFixed(2) + ' m）' + (mode === 'inject' ? '、撞前车速直接设成 3.9 m/s' : '、真开（按住油门）');
      // 直道：正对着墙，第一下撞的是这面墙；起点和撞上那一刻，门架、挡货架都不碰头顶的梁、灯、管子
      const lane = await ev(page, a => {
        for (const b of a.walls) {
          const l = __fk.laneTo(a.k, b, { runs: a.runs, lift: a.lift, offs: [0, 0.3, -0.3, 0.6, -0.6] });
          if (!l) continue;
          const f = __fk.fwd(l.yaw);
          if (__fk.ohHit(l.x, l.z, l.yaw, a.lift) || __fk.ohHit(l.x + f.x * l.contact, l.z + f.z * l.contact, l.yaw, a.lift)) continue;
          return Object.assign(l, { box: b });
        }
        return null;
      }, { k, walls, lift, runs: mode === 'inject' ? [0.8, 1.0, 1.2] : C.surf === 0.505 ? [4.5, 4, 3.5] : [1.5, 1.2, 1.0] });
      if (!lane) { check(tag + ' ' + what + '：找到一条能撞上小屋墙的直道（头顶不碰东西）', false, { walls: walls.length }); continue; }
      const ids = ['t16' + mode[0] + Math.round(surf * 100) + 'a', 't16' + mode[0] + Math.round(surf * 100) + 'b', 't16' + mode[0] + Math.round(surf * 100) + 'c'];
      const setup = await ev(page, a => {
        const f = __fk.fwd(a.l.yaw), d = a.mode === 'inject' ? Math.max(0, a.l.contact - 0.25) : 0;
        // 前面几项留在货叉上的东西、上一趟甩在墙跟前的东西先拿走（只看这三件；地上的东西本来就会挡住后甩下来的）
        for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id);
        for (const p of BR.items.list.slice()) if (/^t16/.test(p.id)) BR.items.remove(p.id);
        __fk.place(a.k, a.l.x + f.x * d, a.l.z + f.z * d, a.l.yaw, a.lift); __br.step(0.1);
        // 左叉尖一只罐头、右叉尖一只罐头、左叉中段一瓶水（同一根货叉上前后两件）
        const ok = [__fk.putOnFork(a.k, a.ids[0], 'canned_food', -0.28, -1.95), __fk.putOnFork(a.k, a.ids[1], 'canned_food', 0.28, -1.95), __fk.putOnFork(a.k, a.ids[2], 'water_bottle', -0.28, -1.5)];
        __br.step(0.1);
        return { ok, riders: BR.vehicles.debugInfo().riders[a.k] || [], st: __fk.lieState(a.k, a.ids) };
      }, { k, l: lane, lift, mode, ids });
      if (!setup.ok.every(Boolean) || !ids.every(id => setup.riders.includes(id))) { check(tag + ' ' + what + '：三件东西摆上货叉', false, setup); continue; }
      await parkPlayerBehind(page, lane);
      // 开过去撞墙、一帧一帧推到甩出去的都落地（__fk.crashGen，每个 page.evaluate 最多推 30 帧：原来一整段 drive 8 s + 150 帧，
      // 机器一忙会超过 60 s，返修 r6 裁定 ⑥）；每帧查 fallBad + hover
      const cr = await crashRun(page, a => __fk.crashStart(a.k, a.ids, { inject: a.mode === 'inject' ? 3.9 : 0, maxSec: 8 }), { k, mode, ids });
      const run = await ev(page, a => ({ pen: __fk.pen(a.k, 0.01), spd: __fk.pose(a.k).spd }), { k });
      Object.assign(run, { vmax: cr.vmax, thrown: cr.thrown, last: cr.last, sounds: cr.sounds, bad: cr.bad, nbad: cr.nbad, frames: cr.frames, hov: cr.hov, nhov: cr.nhov, falls: cr.falls });
      const fin = await ev(page, a => { __fk.frames(10); return __fk.lieState(a.k, a.ids); }, { k, ids });
      // 每件离墙面多远（物资外沿到墙面，沿车头方向）
      const gap = await ev(page, a => {
        const p = __fk.pose(a.k), f = __fk.fwd(p.yaw), b = a.b;
        const near = Math.abs(f.x) > 0.5 ? (f.x > 0 ? b.minX : b.maxX) : (f.z > 0 ? b.minZ : b.maxZ);
        return a.ids.map(id => { const q = BR.items.find(id); if (!q) return null; const c = Math.abs(f.x) > 0.5 ? (near - q.x) * Math.sign(f.x) : (near - q.z) * Math.sign(f.z); return __fk.r(c - __fk.foot(q)); });
      }, { k, ids, b: lane.box });
      if (mode === 'real' && C.surf !== 0.505) {
        const cap = surf - 0.04 > 1.5 ? 0.6 : 1.0;
        check(tag + ' ' + what + '：举高了限速（最快 ' + run.vmax.toFixed(2) + ' m/s ≤ ' + cap + '），撞上墙停住；到不了 2 m/s，东西都留在叉面上没动、没有一件甩出去；车没压进墙',
          run.vmax <= cap + 0.05 && run.vmax > 0.3 && run.thrown === 0 && run.nbad === 0 && run.nhov === 0 && run.pen.length === 0 && Math.abs(run.spd) < 0.05 &&
          fin.every(c => c.onFork && Math.abs(c.y - surf) < 0.012), { lane: { run: lane.run, off: lane.off, contact: lane.contact }, run, fin });
        continue;
      }
      const list = run.last ? run.last.list : [];
      check(tag + ' ' + what + '：「哐」一声（撞前 ' + (run.last ? run.last.v0 : '?') + ' m/s），三件都甩下货叉（' + list.length + ' 件：' + (run.last && run.last.how ? run.last.how.map(h => h[1]).join(' / ') : '?') + '），' +
        '每一帧都没穿过货叉、车身、墙，还在叉面高度时不悬在叉尖 / 叉沿外面、不往回退（逐帧查 ' + run.frames + ' 帧）',
        run.thrown === 1 && !!run.last && run.last.v0 >= 2 && run.sounds.includes('fk_bang') && list.length === 3 && run.nbad === 0 && run.nhov === 0 && run.falls === 0 && run.pen.length === 0,
        { lane: { run: lane.run, off: lane.off, contact: lane.contact }, run: Object.assign({}, run, { bad: run.bad.slice(0, 8) }) });
      check(tag + ' ' + what + '：叉尖顶着墙、前面没地方，三件都贴着墙落在地上（离墙 ' + gap.map(g => g == null ? '?' : (g * 100).toFixed(1)).join(' / ') + ' cm），没有一件落在举着的货叉正下方，落地后静静躺着（不浮不转）',
        fin.every(c => !c.gone && !c.onFork && !c.held && c.still && Math.abs(c.objDy) < 1e-4 && Math.abs(c.y - c.ground) < 0.01) && gap.every(g => g != null && g > -0.005 && g < 0.06) && run.nbad === 0,
        { fin, gap });
      // 同一根左货叉上的两件（罐头在前 lz −1.95、水瓶在后 lz −1.5）：后面那件不比前一件落得远（返修 r6 裁定 ②；
      // 水瓶细，贴着墙时圆心能比罐头往前 0.9 cm —— 量圆心离叉尖往前多远 past）
      check(tag + ' ' + what + '：同一根左货叉上后面那只水瓶不比前面那只罐头落得远（离叉尖 ' + (fin[0] ? fin[0].past : '?') + ' / ' + (fin[2] ? fin[2].past : '?') + ' m）',
        !!fin[0] && !!fin[2] && fin[2].past <= fin[0].past + 0.001, { a: fin[0], c: fin[2] });
      // 截图：人站在车右前方，看货叉尖和墙跟（举着的货叉和落在墙跟的东西都在画面里）
      await ev(page, a => __fk.viewL(a.k, 3.2, -0.6, 0, a.s > 1.5 ? 1.3 : 0.6, -2.0), { k, s: surf });
      await shot(page, 'i16-' + (mode === 'inject' ? 'inject-' : '') + String(Math.round(surf * 100)));
    }
  }
}

// ---- I18 撞车时前面不远处有东西（FE1 返修 r4，验收员 r4 的 cartonR1 场景）：种子 12345，车 (16.21, 16.0) 朝 −z，正前方一只 0.4 m 高的纸箱，
// 纸箱后面是货架。左货叉前后两只罐头、右货叉一瓶水，按住 R 1 s（叉面 0.5 m）、按住 W 全速用车头撞上纸箱（货叉从箱顶上伸过去，叉尖离货架 20–30 cm）。
// 前面那几件飞出去碰上货架、贴着货架掉下来；后面那只罐头往前落不下（前面那只占了地方），就从它还在叉面上的地方横着滑下叉边 ——
// 每一帧：不穿东西（含别的物资）；还在叉面高度时圆心不越过叉尖 0.3 个模型半径以上、不往车这边退（以前会先滑出叉尖悬在半空、再倒着滑回叉面）----
async function throwCartonCheck(page, k) {
  const ids = ['i18-a', 'i18-b', 'i18-c'];
  const set = await ev(page, a => {
    const c = __fk.sideAll().filter(e => e.kind === 'carton' && Math.hypot(e.cx - 16.21, e.cz - 10.1) < 0.4)[0];
    const rack = BR.phys.raycast(16.21, 0.6, 10.1, 0, 0, -1, 2);
    if (!c || !rack) return { carton: !!c, rack: !!rack };
    for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id);
    for (const id of a.ids) if (BR.items.find(id)) BR.items.remove(id);
    __fk.place(a.k, 16.21, 16.0, 0, 0); __br.step(0.2);
    const ok = [__fk.putOnFork(a.k, a.ids[0], 'canned_food', -0.28, -2.0), __fk.putOnFork(a.k, a.ids[1], 'water_bottle', 0.28, -2.0), __fk.putOnFork(a.k, a.ids[2], 'canned_food', -0.28, -1.65)];
    __br.step(0.1);
    return { carton: true, rack: true, cartonTop: __fk.r(Math.max(c.minY, c.maxY)), rackZ: __fk.r(10.1 - rack.dist), ok };
  }, { k, ids });
  if (!set.carton || !set.rack || !set.ok.every(Boolean)) { check('I18 种子 ' + SEED + '：车正前方找到 0.4 m 高的纸箱和它后面的货架，三件摆上货叉', false, set); return; }
  const pm = await mountCar(page, k, 'left');
  await hold(page, 'KeyR', 1.0);
  const lift = await ev(page, a => { __fk.clear(); __fk.hoverReset(); const p = __fk.pose(a.k); return __fk.r(p.lift); }, { k });
  await page.keyboard.down('KeyW');
  let vmax = 0;
  const bad = [], hov = [];
  for (let i = 0; i < 200; i++) {
    const r = await ev(page, a => { __br.step(1 / 30); return { v: __fk.pose(a.k).spd, bad: __fk.fallBad(a.k, a.ids), hov: __fk.hover(a.k, a.ids) }; }, { k, ids });
    vmax = Math.max(vmax, r.v); bad.push(...r.bad); hov.push(...r.hov);
    if (i > 20 && Math.abs(r.v) < 0.02) break;
  }
  await page.keyboard.up('KeyW');
  for (let i = 0; i < 150; i++) {
    const r = await ev(page, a => { __br.step(1 / 30); return { bad: __fk.fallBad(a.k, a.ids), hov: __fk.hover(a.k, a.ids), falls: BR.vehicles.debugInfo().falls }; }, { k, ids });
    bad.push(...r.bad); hov.push(...r.hov);
    if (i > 30 && !r.falls) break;
  }
  const res = await ev(page, a => {
    const t = BR.vehicles.debugInfo().throws, G = __fk.geo(), tip = Math.min(G.forkZ[0], G.forkZ[1]);
    return { last: t[t.length - 1] || null, falls: BR.vehicles.debugInfo().falls, sounds: __fk.sounds.filter(s => /^fk_b/.test(s)), st: __fk.lieState(a.k, a.ids), pose: __fk.pose(a.k),
      tipAt: __fk.r(__fk.W(a.k, 0, tip).z) };
  }, { k, ids });
  const thrown = res.last ? res.last.list.map(e => e[0]) : [];
  check('I18 叉面 ' + (0.055 + lift * 2.6).toFixed(2) + ' m 全速（' + vmax.toFixed(2) + ' m/s）用车头撞上纸箱（叉尖停在货架前 ' + (res.tipAt - set.rackZ).toFixed(2) + ' m）：「哐」，三件一件不留（返修 r5 裁定 ①），都落在地上静静躺着（' + (res.last ? res.last.how.map(h => h[1]).join(' / ') : '?') + '）',
    pm.ok && vmax >= 3 && res.sounds.includes('fk_bang') && !!res.last && res.last.v0 >= 2 && thrown.length === 3 && res.falls === 0 &&
    res.st.every(c => !c.gone && !c.held && !c.onFork && c.still && Math.abs(c.objDy) < 1e-4 && Math.abs(c.y - c.ground) < 0.01),
    { set, lift, vmax, last: res.last, st: res.st, tipAt: res.tipAt });
  check('I18 每一帧都不穿货叉、车身、货架、纸箱和别的物资；还在叉面高度时圆心不越过叉尖 0.3 个模型半径以上、不往车这边退（不会先滑出叉尖悬着再倒着滑回来）',
    bad.length === 0 && hov.length === 0, { bad: bad.slice(0, 8), hov: hov.slice(0, 8) });
  await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return 0; });
  await dismount(page);
  await ev(page, k => __fk.viewL(k, 1.6, -1.0, -0.1, 0.2, -2.3), k);
  await shot(page, 'i18-carton-rack');
  await ev(page, a => { for (const id of a.ids) if (BR.items.find(id)) BR.items.remove(id); return 0; }, { k, ids });
}

// =====================================================================
// exits
// =====================================================================
async function gExits(browser) {
  const { ctx, page } = await boot(browser, 'exits');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    await ev(page, k => { const p = __fk.pose(k); __fk.place(k, p.x, p.z, p.yaw, 0); __br.step(0.1); return 0; }, k);
    // E1 朝一个地上的出口圈开过去
    const lane = await ev(page, k => {
      const pk = __fk.physKey(k), out = [];
      for (const c of BR.world.chunks()) for (const e of (c.exits || [])) if (e.active !== false && e.kind === 'zone') out.push({ x: +e.x, z: +e.z, r: +e.radius || 1, to: e.to, ck: c.key });
      out.sort((a, b) => Math.hypot(a.x - 16, a.z - 30) - Math.hypot(b.x - 16, b.z - 30));
      for (const e of out) {
        for (let a = 0; a < 8; a++) {
          const yaw = a * Math.PI / 4, f = __fk.fwd(yaw);
          const D = e.r + 0.4 + 2.5;   // 叉尖离出口圈中心
          const sx = e.x - f.x * (D + 2.1), sz = e.z - f.z * (D + 2.1);
          if (__fk.hitsAt(sx, sz, yaw, 0, pk).length) continue;
          if (__fk.sweep(sx, sz, yaw, 0, D + 0.5, pk, 0.1)) continue;
          const L = __fk.WP({ x: sx, z: sz, yaw }, -1.2, 0.24), R = __fk.WP({ x: sx, z: sz, yaw }, 1.2, 0.24);
          const side = !BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) ? 'left' : !BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7) ? 'right' : null;
          if (!side) continue;
          return { e, x: sx, z: sz, yaw, side };
        }
      }
      return null;
    }, k);
    if (!lane) check('E1 出生点周围找到一个车开得过去的地上出口圈', false);
    else {
      const pm = await placeAndMount(page, k, lane, lane.side);
      await ev(page, () => { __fk.clear(); return 0; });
      await hold(page, 'KeyW', 3.5);
      const r1 = await ev(page, a => {
        const e = a.e, R = e.r + 0.4;
        let worst = null;
        for (const o of __fk.obbs(a.k)) { const d = BR.phys.circleVsObb(e.x, e.z, R, o); if (d && d.depth > 0.01 && (!worst || d.depth > worst.depth)) worst = { name: o.name, depth: d.depth }; }
        return { worst, notes: __fk.notes.slice(), lv: String(BR.game.levelId), p: __fk.pose(a.k) };
      }, { k, e: lane.e });
      check('E1 朝出口（去 ' + lane.e.to + '）开：车的 OBB 都不进出口圈 +0.4，提示「前面是出口」', pm.mounted && !r1.worst && r1.notes.includes('前面是出口'), { r1, e: lane.e });
      await step(page, 3.0);
      const r2 = await ev(page, () => ({ lv: String(BR.game.levelId), tr: BR.world.transitioning, seated: BR.vehicles.seated }));
      check('E2 停在出口旁 3 s：不换层（坐在车上不会被出口带走）', r2.lv === '1' && !r2.tr && !!r2.seated, r2);
      // 下车：落点不在出口圈里
      await dismount(page);
      const r3 = await ev(page, a => ({ d: Math.hypot(BR.player.x - a.e.x, BR.player.z - a.e.z), r: a.e.r, lv: String(BR.game.levelId), seat: __fk.seat() }), { e: lane.e });
      check('E3 在出口旁下车：落点不在出口圈里、没换层', r3.d > r3.r && r3.lv === '1' && !r3.seat.seated, r3);
      // E4 左边下车的落点压在出口圈里：自动从别的边下
      const pose4 = await ev(page, a => {
        const pk = __fk.physKey(a.k), e = a.e;
        for (let i = 0; i < 16; i++) {
          const yaw = i * Math.PI / 8;
          // 左侧落点（本地 −1.0, 0.24）放到出口圈中心
          const c = Math.cos(yaw), s = Math.sin(yaw);
          const x = e.x - (c * -1.0 + s * 0.24), z = e.z - (-s * -1.0 + c * 0.24);
          if (__fk.hitsAt(x, z, yaw, 0, pk).length) continue;
          const R = __fk.WP({ x, z, yaw }, 1.2, 0.24);
          if (BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7)) continue;
          return { x, z, yaw };
        }
        return null;
      }, { k, e: lane.e });
      if (!pose4) check('E4 能把车停成左侧落点压在出口圈上', false);
      else {
        await placeAndMount(page, k, pose4, 'right');
        await ev(page, k => { BR.player.yaw = __fk.pose(k).yaw + 0.8; __br.step(1 / 30); __fk.clear(); return 0; }, k);
        await dismount(page);
        const r4 = await ev(page, a => { const ev1 = __fk.evs('vehicle:dismount').pop(); return { ev: ev1, d: Math.hypot(BR.player.x - a.e.x, BR.player.z - a.e.z), r: a.e.r, lv: String(BR.game.levelId), seat: __fk.seat() }; }, { e: lane.e });
        check('E4 往左看下车、左边落点在出口圈里：改从别的边下，落点不在出口圈里', !!r4.ev && r4.ev.side !== 'left' && r4.d > r4.r && r4.lv === '1' && !r4.seat.seated, r4);
      }
    }
    // 选边：在试车场
    const Y = await ev(page, () => __fk.YARD);
    const side = async (blocks, look, label) => {
      const pm = await placeAndMount(page, k, Y);
      const ids = await ev(page, a => {
        const ids = [];
        for (const [lx, lz] of a.blocks) { const w = __fk.W(a.k, lx, lz); ids.push(__fk.dummy(w.x, w.z, 'blk' + ids.length + '_' + Math.random().toString(36).slice(2, 6))); }
        __br.step(0.1);
        BR.player.yaw = __fk.pose(a.k).yaw + a.look;
        __br.step(1 / 30);
        __fk.clear();
        return ids;
      }, { k, blocks, look });
      await tap(page, 'Space');
      await step(page, 1.0);
      const r = await ev(page, a => {
        const l = __fk.L(a.k, BR.player.x, BR.player.z);
        return { seat: __fk.seat(), lx: l.x, lz: l.z, ev: __fk.evs('vehicle:dismount').pop() || null, notes: __fk.notes.slice() };
      }, { k });
      return { pm, ids, r };
    };
    const clearIds = ids => ev(page, ids => { for (const id of ids) __fk.dropEnt(id); __br.step(0.1); return 0; }, ids);
    let s1 = await side([], 0.6, 'left');
    check('E5 往左看下车：从左边下', !s1.r.seat.seated && s1.r.ev && s1.r.ev.side === 'left' && s1.r.lx < -0.6, s1.r);
    let s2 = await side([], -0.6, 'right');
    check('E6 往右看下车：从右边下', !s2.r.seat.seated && s2.r.ev && s2.r.ev.side === 'right' && s2.r.lx > 0.6, s2.r);
    let s0 = await side([], 0, 'front');
    check('E7 看正前方下车：从左边下', !s0.r.seat.seated && s0.r.ev && s0.r.ev.side === 'left', s0.r);
    let s3 = await side([[-1.0, 0.24]], 0.6, 'left blocked');
    check('E8 左边站着测试人，往左看下车：从右边下', !s3.r.seat.seated && s3.r.ev && s3.r.ev.side === 'right' && s3.r.lx > 0.6, s3.r);
    await clearIds(s3.ids);
    let s4 = await side([[-1.0, 0.24], [1.0, 0.24]], 0.6, 'both');
    check('E9 两边都堵住：从车尾下', !s4.r.seat.seated && s4.r.ev && s4.r.ev.side === 'rear' && s4.r.lz > 1.3, s4.r);
    await clearIds(s4.ids);
    let s5 = await side([[-1.0, 0.24], [1.0, 0.24], [0, 1.75]], 0.6, 'all');
    check('E10 三面都堵住：提示「两边都被挡住，开出来再下车」，留在车上', !!s5.r.seat.seated && s5.r.seat.mode === 'drive' && s5.r.notes.includes('两边都被挡住，开出来再下车'), s5.r);
    // E11 三面都堵住时扣血死亡：人落在车旁空地上，不在任何 OBB、出口圈里
    const dz = await ev(page, () => { __fk.clear(); BR.player.damage({ hp: 9999 }); __br.step(0.6); return 0; });
    const r11 = await ev(page, a => {
      const P = BR.player, r = 0.3;
      const inObb = __fk.obbs(a.k).filter(o => { const d = BR.phys.circleVsObb(P.x, P.z, r, o, P.feetY, 1.7); return d && d.depth > 0.01; }).map(o => o.name);
      const inExit = BR.world.blockers({ x: P.x, z: P.z, r: 0.01, margin: 0 }).filter(b => b.kind === 'exit').length;
      const ent = BR.entities.list.filter(e => !e.removed && Math.hypot(e.x - P.x, e.z - P.z) < (e.r || 0.3) + r - 0.02).map(e => e.id);
      return { dead: P.dead, screen: BR.game.screen, inObb, inExit, ent, solid: BR.phys.overlapCircle(P.x, P.z, r, P.feetY + 0.02, 1.7), seat: __fk.seat(), ev: __fk.evs('vehicle:dismount').pop() || null };
    }, { k });
    check('E11 三面都堵住时扣血死亡：人落在车旁空地上（不在车的 OBB、出口圈、测试人里，也没压着墙）', r11.dead && !r11.seat.seated && r11.inObb.length === 0 && r11.inExit === 0 && r11.ent.length === 0 && !r11.solid && !!r11.ev, r11);
    await clearIds(s5.ids);
    await ev(page, () => { BR.bus.emit('death:continue'); __br.step(1.0); return 0; });
    await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 30000 }).catch(() => {});
    await ev(page, () => { __br.step(0.5); return 0; });
    // E12 车在 3 m/s 时按空格：0.6 s 内停住并下车
    const pm12 = await placeAndMount(page, k, Y);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 90; i++) { const v = await ev(page, k => { __br.step(1 / 30); return __fk.pose(k).spd; }, k); if (v >= 3.0) break; }
    const v12 = await ev(page, k => __fk.pose(k).spd, k);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('Space');
    let tStop = null, tOff = null;
    for (let i = 1; i <= 40; i++) {
      const r = await ev(page, k => { __br.step(1 / 30); return { spd: __fk.pose(k).spd, seated: BR.vehicles.seated }; }, k);
      if (i === 3) await page.keyboard.up('Space');
      if (tStop == null && Math.abs(r.spd) < 0.05) tStop = i / 30;
      if (tOff == null && !r.seated) { tOff = i / 30; break; }
    }
    if (tOff == null) await page.keyboard.up('Space');
    check('E12 车在 ' + v12.toFixed(2) + ' m/s 时按空格：0.6 s 内停住并下车', pm12.mounted && v12 >= 3.0 && tStop != null && tStop <= 0.6 + 1e-6 && tOff != null && tOff <= 0.6 + 1 / 30 + 1e-6, { v12, tStop, tOff });
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// life
// =====================================================================
async function gLife(browser) {
  const { ctx, page } = await boot(browser, 'life');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    const orig = await ev(page, k => { const f = __fk.fkData(k); return { x: f.x, z: f.z, rot: f.rot, spans: f.spans, pk: __fk.physKey(k) }; }, k);
    // 原地上车，倒车 2 s 开出原来的车位，升一点货叉，下车
    const pm = await mountCar(page, k, 'left');
    await hold(page, 'KeyS', 2.0);
    await step(page, 1.0);
    await hold(page, 'KeyR', 1.0);
    const before = await ev(page, k => __fk.pose(k), k);
    await ev(page, () => { __fk.clear(); return 0; });
    await dismount(page);
    const r1 = await ev(page, k => ({ ls: BR.levelState.getv('1', 'veh', k), pose: __fk.pose(k), toasts: __fk.toasts.slice() }), k);
    const lsOk = !!r1.ls && ['x', 'z', 'yaw', 'steer', 'lift', 'on', 'carry', 'n'].every(f => f in r1.ls) && !('d' in r1.ls) && !('w' in r1.ls) && r1.ls.on === 0;
    check('F1 下车后 levelState.vehicles 有记录（x z yaw steer lift on carry n，on=0），里面没有 d、w 字段', pm.ok && lsOk && Math.abs(r1.ls.x - r1.pose.x) < 1e-3, r1.ls);
    check('F2 货叉高度保留（' + before.lift.toFixed(3) + '），提示「货叉还举着」', Math.abs(r1.pose.lift - before.lift) < 1e-6 && before.lift > 0.1 && r1.toasts.filter(t => t === '货叉还举着').length === 1, { lift: r1.pose.lift, toasts: r1.toasts });
    await mountCar(page, k, 'left');
    await ev(page, () => { __fk.clear(); return 0; });
    await dismount(page);
    const t2 = await ev(page, () => __fk.toasts.filter(t => t === '货叉还举着').length);
    check('F3 再上车、举着货叉再下车：「货叉还举着」不再说（只出现一次）', t2 === 0, { t2 });
    const saved = await ev(page, k => __fk.pose(k), k);
    // 走开 4 块
    await ev(page, () => { __fk.stand(16 + 32 * 4, 30, 0); __br.step(1.5); return 0; });
    const r4 = await ev(page, k => ({ promoted: BR.vehicles.debugInfo().promoted, obbs: BR.phys.records('veh|' + k).obbs.length, loaded00: BR.world.chunks().some(c => c.key === '0,0') }), k);
    check('F4 走开 4 块：载具网格里这台车那段已释放（promoted 不含它），phys 里 veh| 的 14 个 OBB 还在', !r4.promoted.includes(k) && r4.obbs === 14, r4);
    // 回来
    const checkBack = async tag => {
      await ev(page, () => { __fk.stand(16, 30, 0); __br.step(1.5); return 0; });
      return ev(page, a => {
        const p = __fk.pose(a.k);
        const c = BR.world.chunks().find(q => q.key === '0,0');
        const g = c.res.group || c.group;
        const collapsed = (mk, r) => {
          const m = g.children.find(o => o.isMesh && o.name === mk);
          if (!m || !r) return null;
          const A = m.geometry.attributes.position.array;
          const x = A[r[0] * 3], y = A[r[0] * 3 + 1], z = A[r[0] * 3 + 2];
          for (let i = r[0]; i < r[1]; i++) if (A[i * 3] !== x || A[i * 3 + 1] !== y || A[i * 3 + 2] !== z) return false;
          return true;
        };
        const sp = a.orig.spans || {};
        const wearOk = (sp.wear || []).every(r => collapsed('kit:decal', r) !== false);
        const R = BR.phys.records(a.orig.pk);
        const fw = { x: a.orig.x + Math.cos(a.orig.rot) * 0 + Math.sin(a.orig.rot) * -1.6, z: a.orig.z - Math.sin(a.orig.rot) * 0 + Math.cos(a.orig.rot) * -1.6 };
        return {
          d: Math.hypot(p.x - a.saved.x, p.z - a.saved.z), dyaw: Math.abs(p.yaw - a.saved.yaw), dlift: Math.abs(p.lift - a.saved.lift),
          prop: collapsed('kit:prop', sp.prop), wearOk, parked: R.solids.length + R.obbs.length,
          origHit: BR.phys.overlapCircle(fw.x, fw.z, 0.3, 0.02, 1.7),
        };
      }, { k, saved, orig });
    };
    const b1 = await checkBack('back');
    check('F5 走远回来：车的位姿和货叉高度误差 <1 mm，原位置的区块网格那段已藏掉（顶点叠成一点），原位置没有碰撞', b1.d < 1e-3 && b1.dyaw < 1e-3 && b1.dlift < 1e-3 && b1.prop === true && b1.wearOk && b1.parked === 0 && !b1.origHit, b1);
    await goTo(page, '0');
    await goTo(page, '1');
    const b2 = await checkBack('level');
    check('F6 离开这一层再回来：位姿和货叉高度误差 <1 mm，原位置网格段藏掉、没有碰撞', b2.d < 1e-3 && b2.dyaw < 1e-3 && b2.dlift < 1e-3 && b2.prop === true && b2.wearOk && b2.parked === 0 && !b2.origHit, b2);
    // 死在车上：回到 walk，人在落点上
    await mountCar(page, k, 'left');
    await ev(page, () => { __fk.clear(); BR.player.damage({ hp: 9999 }); __br.step(0.8); return 0; });
    const r7 = await ev(page, k => { const e = __fk.evs('vehicle:dismount').pop() || null; return { ev: e, mode: BR.interact.mode, ctx: BR.input.context, P: { x: BR.player.x, z: BR.player.z }, dead: BR.player.dead, seated: BR.vehicles.seated, on: __fk.pose(k).on }; }, k);
    check('F7 死在车上：interact.mode walk、input 情境 walk、人在下车落点上、车熄火', r7.dead && !r7.seated && r7.mode === 'walk' && r7.ctx === 'walk' && !!r7.ev && Math.hypot(r7.P.x - r7.ev.x, r7.P.z - r7.ev.z) < 0.05 && r7.on === 0, r7);
    // 回主页再开始：车回到原位
    await goHome(page);
    await startL1(page, { seed: SEED });
    const r8 = await ev(page, k => { const r = __fk.rec(k); return { r: r && { x: r.x, z: r.z, driven: r.driven, lift: r.lift }, ls: BR.levelState.getv('1', 'veh', k) || null, k2: __fk.spawnKey() }; }, k);
    check('F8 回主页再开始：车回到原位（没开过、货叉落地）', !!r8.r && Math.abs(r8.r.x - orig.x) < 1e-3 && Math.abs(r8.r.z - orig.z) < 1e-3 && !r8.r.driven && r8.r.lift === 0 && !r8.ls, r8);
    // 工坊编辑态：没有 vehicle 候选
    await goHome(page);
    const r9 = await ev(page, () => {
      const m = BR.workshop.create('1', 'fktest');
      m.seed = 12345;
      BR.workshop.activate(m, { editing: true });
      BR.world.start('1', 12345);
      const prev = BR.game.screen;
      BR.game.screen = 'playing';
      __br.step(0.3);
      const c = BR.world.chunks().find(q => q.key === '0,0');
      const f = c && c.res.data.forklifts && c.res.data.forklifts[0];
      let cur = null;
      if (f) {
        const x = f.x - Math.cos(f.rot) * 1.2 + Math.sin(f.rot) * 0.24, z = f.z + Math.sin(f.rot) * 1.2 + Math.cos(f.rot) * 0.24;
        BR.player.reset({ x, y: 0, z, yaw: 0 }, { full: false });
        BR.interact.aimAt(f.x, 1.25, f.z);
        __br.step(1 / 30);
        cur = __fk.cur();
      }
      const out = { editing: BR.workshop.editing, f: !!f, cur, list: BR.vehicles.list().length };
      BR.game.screen = prev;
      BR.workshop.deactivate();
      BR.bus.emit('game:home');
      return out;
    });
    check('F9 工坊编辑态：准心对准叉车没有 vehicle 候选（BR.vehicles 里也没有登记）', r9.editing && r9.f && (!r9.cur || r9.cur.kind !== 'vehicle') && r9.list === 0, r9);
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// pause
// =====================================================================
async function gPause(browser) {
  const { ctx, page } = await boot(browser, 'pause');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    // P1 单机暂停 2 s：位置、货叉高度变化 0；声音停；继续以后接着开
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyR');
    await step(page, 0.6);
    const a0 = await ev(page, k => ({ p: __fk.pose(k), loops: Object.assign({}, __fk.loopsOn) }), k);
    await ev(page, () => { BR.hud.pause(true); return 0; });
    await step(page, 2.0);
    const a1 = await ev(page, k => ({ p: __fk.pose(k), screen: BR.game.screen, loops: Object.assign({}, __fk.loopsOn) }), k);
    check('P1 单机按暂停 2 s：车的位置、货叉高度变化 0，发动机声停', pm.mounted && a1.screen === 'paused' && Math.hypot(a1.p.x - a0.p.x, a1.p.z - a0.p.z) === 0 && a1.p.lift === a0.p.lift && !(a1.loops.fk_engine > 0), { a0: a0.p, a1 });
    await ev(page, () => { BR.hud.pause(false); return 0; });
    await step(page, 0.5);
    const a2 = await ev(page, k => ({ p: __fk.pose(k), loops: Object.assign({}, __fk.loopsOn) }), k);
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyR');
    check('P2 继续以后接着开（车在走、发动机声回来）', Math.hypot(a2.p.x - a1.p.x, a2.p.z - a1.p.z) > 0.2 && (a2.loops.fk_engine || 0) > 0, { a1: a1.p, a2 });
    await hold(page, 'KeyS', 1.0);
    await hold(page, 'KeyC', 2.0);
    // P3 输入被关掉（联机暂停 / 结算 / 切后台走的同一条 null 输入路径）：3 m/s 的车 0.6 s 内停住，货叉不动，雷达照常
    await dismount(page);
    await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    await hold(page, 'KeyR', 0.4);   // 货叉底 ≈0.2 m（不到 0.5 m，不限速）
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 90; i++) { const v = await ev(page, k => { __br.step(1 / 30); return __fk.pose(k).spd; }, k); if (v >= 3.0) break; }
    // 一边开一边按着 R（货叉正在升）的时候输入被关掉
    await page.keyboard.down('KeyR'); await step(page, 2 / 30);
    const b0 = await ev(page, k => { const p = __fk.pose(k); BR.input.enabled = false; return p; }, k);
    let tStop = null;
    for (let i = 1; i <= 30; i++) { const v = await ev(page, k => { __br.step(1 / 30); return __fk.pose(k).spd; }, k); if (Math.abs(v) < 0.05) { tStop = i / 30; break; } }
    const b1 = await ev(page, k => __fk.pose(k), k);
    check('P3 输入关掉时（' + b0.spd.toFixed(2) + ' m/s）：0.6 s 内自己刹住，货叉高度不变', b0.spd >= 3 && tStop != null && tStop <= 0.6 + 1e-6 && Math.abs(b1.lift - b0.lift) < 1e-6, { tStop, lift0: b0.lift, lift1: b1.lift });
    const rd = await ev(page, k => { const w = __fk.W(k, 0, -2.1 - 1.4); const id = __fk.dummy(w.x, w.z, 'pdummy'); __fk.clear(); __br.step(1.5); return { id, sounds: __fk.sounds.slice(), seated: BR.vehicles.seated }; }, k);
    check('P4 输入关着时测试人走到车前 1.4 m：fk_radar 照常在播', rd.sounds.includes('fk_radar') && !!rd.seated, rd);
    await ev(page, id => { __fk.dropEnt(id); BR.input.enabled = true; __br.step(0.1); return 0; }, rd.id);
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyR');
    // P5 单机切后台（visibilitychange hidden）：整局暂停，车不动
    await page.keyboard.down('KeyW');
    await step(page, 0.5);
    const c0 = await ev(page, k => {
      const p = __fk.pose(k);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      return p;
    }, k);
    await step(page, 2.0);
    const c1 = await ev(page, k => ({ p: __fk.pose(k), screen: BR.game.screen }), k);
    await page.keyboard.up('KeyW');
    await ev(page, () => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); BR.hud.pause(false); __br.step(0.1); return 0; });
    check('P5 单机切后台（visibilitychange）：整局暂停，车和货叉 2 s 不动', c1.screen === 'paused' && Math.hypot(c1.p.x - c0.x, c1.p.z - c0.z) === 0 && c1.p.lift === c0.lift, { c0, c1 });
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// nightmare
// =====================================================================
async function gNightmare(browser) {
  const { ctx, page } = await boot(browser, 'nightmare');
  try {
    // 噩梦「简单」：自动刷怪 0%，只有测试自己放的敌对实体
    await startL1(page, { seed: SEED, mode: 'nightmare', difficulty: 'easy' });
    const k = await ev(page, () => __fk.spawnKey());
    const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
    const keepAlive = () => ev(page, () => { BR.player.hp = 100; BR.player.sanity = 100; BR.player.hunger = 100; return 0; });
    await step(page, 0.5);
    const n0 = await ev(page, () => ({ noise: BR.player.noise, ent: BR.entities.noise }));
    await page.keyboard.down('KeyW'); await step(page, 1.0);
    const n1 = await ev(page, () => ({ noise: BR.player.noise, ent: BR.entities.noise }));
    await page.keyboard.up('KeyW'); await step(page, 1.5);
    await page.keyboard.down('KeyS'); await step(page, 1.0);
    const n2 = await ev(page, () => ({ noise: BR.player.noise, ent: BR.entities.noise }));
    await page.keyboard.up('KeyS'); await step(page, 1.5);
    check('N1 噪音：怠速 ≈0.25、行驶 ≥0.6、倒车 ≥0.8（都大于走路的 0.4），怪听得见', pm.mounted && Math.abs(n0.noise - 0.25) <= 0.05 && n1.noise >= 0.6 && n2.noise >= 0.8 && n0.ent >= 0.25 - 1e-6 && n2.ent >= 0.8 - 1e-6, { n0, n1, n2 });
    await keepAlive();
    // N2 车侧 6 m、视线畅通的敌对实体：3 s 内发现坐着的人
    const side = await ev(page, k => {
      for (const lx of [-6, 6]) {
        const w = __fk.W(k, lx, 0.24), ch = BR.vehicles.chestOf(BR.player);
        if (BR.phys.overlapCircle(w.x, w.z, 0.45, 0.02, 1.6)) continue;
        if (!BR.phys.los(w.x, 1.3, w.z, ch.x, ch.y, ch.z)) continue;
        return { lx, id: __fk.ent('_dev_hostile', w.x, w.z, 'nside') };
      }
      return null;
    }, k);
    let seenAt = null;
    if (side && side.id) for (let i = 1; i <= 90; i++) {
      const r = await ev(page, id => { __br.step(1 / 30); BR.player.hp = 100; const e = BR.entities.get(id); return e && e.target ? e.target.kind : null; }, side.id);
      if (r === 'player') { seenAt = i / 30; break; }
    }
    check('N2 测试敌对实体放在车侧 6 m、视线畅通：按它自己的感知周期 3 s 内发现坐着的人', !!side && seenAt != null && seenAt <= 3.0, { side, seenAt });
    if (side && side.id) await ev(page, id => { __fk.dropEnt(id); __br.step(0.1); return 0; }, side.id);
    await keepAlive();
    // N3 车尾 1.0 m：打得到坐着的人
    const rear = await ev(page, k => { const w = __fk.W(k, 0, 1.295 + 1.0 + 0.4); __fk.dmg.length = 0; return __fk.ent('_dev_hostile', w.x, w.z, 'nrear'); }, k);
    let hitRear = null;
    for (let i = 1; i <= 180 && !hitRear; i++) {
      const r = await ev(page, a => { __br.step(1 / 30); const d = __fk.dmg.filter(x => x.hp > 0 && x.src && String(x.src).indexOf(a.id) >= 0); const e = BR.entities.get(a.id); const l = e ? __fk.L(a.k, e.x, e.z) : null; if (BR.player.hp < 60) BR.player.hp = 100; return d.length ? { t: a.i / 30, l } : null; }, { id: rear, k, i });
      if (r) hitRear = r;
    }
    check('N3 敌对实体放在车尾外 1.0 m：打得到坐在车上的人（叉车不是安全屋）', !!rear && !!hitRear, { hitRear, dmg: await ev(page, () => __fk.dmg.slice(0, 3)) });
    await ev(page, id => { __fk.dropEnt(id); __br.step(0.2); BR.player.hp = 100; return 0; }, rear);
    // N4 货叉尖外 0.3 m：打不到；10 s 内绕到车侧
    const front = await ev(page, k => { const w = __fk.W(k, 0, -2.1 - 0.3 - 0.4); __fk.dmg.length = 0; return __fk.ent('_dev_hostile', w.x, w.z, 'nfront'); }, k);
    let sideAt = null;
    const frontHits = [];
    for (let i = 1; i <= 300; i++) {
      const r = await ev(page, a => {
        const n0 = __fk.dmg.length;
        __br.step(1 / 30);
        const e = BR.entities.get(a.id);
        const l = e ? __fk.L(a.k, e.x, e.z) : null;
        const hit = __fk.dmg.length > n0 && __fk.dmg.slice(n0).some(x => x.hp > 0);
        if (BR.player.hp < 60) BR.player.hp = 100;
        return { l, hit };
      }, { id: front, k });
      // 「在车前」= 还在叉尖前面，或者在车宽以内、驾驶舱前面（门架 / 货叉那一截）；绕到车侧 = 出了车宽、过了叉尖
      const ahead = r.l && (r.l.z < -2.1 || (Math.abs(r.l.x) < 0.75 && r.l.z < -0.5));
      if (r.hit && ahead) frontHits.push({ t: i / 30, l: r.l });
      if (sideAt == null && r.l && Math.abs(r.l.x) >= 0.8 && r.l.z > -2.1 && r.l.z < 1.6) sideAt = i / 30;
    }
    check('N4 敌对实体放在货叉尖外 0.3 m：在车前时打不到人，10 s 内绕到车侧', !!front && frontHits.length === 0 && sideAt != null && sideAt <= 10, { sideAt, frontHits: frontHits.slice(0, 3) });
    await ev(page, id => { __fk.dropEnt(id); __br.step(0.2); BR.player.hp = 100; return 0; }, front);
    await dismount(page);
    // N5 开过未密封水坑：坐在车上，座椅压在水坑上 40 s，理智不因接触水坑下降（对照：人站在同一个水坑上）
    const pud = await ev(page, k => {
      const pk = __fk.physKey(k);
      for (const c of BR.world.chunks()) for (const p of ((c.res.data && c.res.data.puddles) || [])) {
        for (let a = 0; a < 8; a++) {
          const yaw = a * Math.PI / 4, s = Math.sin(yaw), cc = Math.cos(yaw);
          // 眼点（本地 0, 0.16）压在水坑中心：车中心 = 水坑 − 眼点偏移
          const x = p.x - s * 0.16, z = p.z - cc * 0.16;
          if (__fk.hitsAt(x, z, yaw, 0, pk).length) continue;
          const L = __fk.WP({ x, z, yaw }, -1.2, 0.24), R = __fk.WP({ x, z, yaw }, 1.2, 0.24);
          const side = !BR.phys.overlapCircle(L.x, L.z, 0.3, 0.02, 1.7) ? 'left' : !BR.phys.overlapCircle(R.x, R.z, 0.3, 0.02, 1.7) ? 'right' : null;
          if (side) return { p, x, z, yaw, side };
        }
      }
      return null;
    }, k);
    if (!pud) check('N5 找到一个车能压上去的水坑', false);
    else {
      const pm5 = await placeAndMount(page, k, pud, pud.side);
      const r5 = await ev(page, a => {
        __fk.dmg.length = 0;
        const d0 = Math.hypot(BR.player.x - a.p.x, BR.player.z - a.p.z);
        for (let i = 0; i < 40; i++) { __br.step(1); BR.player.hp = 100; BR.player.sanity = 100; }
        return { d0, crawler: __fk.dmg.filter(x => x.src === 'hazard:crawler').length };
      }, pud);
      await dismount(page);
      const ctl = await ev(page, a => {
        __fk.stand(a.p.x, a.p.z, 0);
        __fk.dmg.length = 0;
        for (let i = 0; i < 40; i++) { __br.step(1); BR.player.hp = 100; BR.player.sanity = 100; __fk.stand(a.p.x, a.p.z, 0); }
        return { crawler: __fk.dmg.filter(x => x.src === 'hazard:crawler').length };
      }, pud);
      check('N5 开到未密封水坑上（座椅离水坑中心 ' + (r5.d0 * 100).toFixed(0) + ' cm）坐 40 s：没有一次「接触水坑」掉理智', pm5.mounted && r5.d0 < 0.6 && r5.crawler === 0, { r5, control: ctl });
      if (!ctl.crawler) info('N5 对照：人站在同一个水坑上 40 s 也没触发接触（随机 5%/0.5 s），对照没起作用', ctl);
    }
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// dark
// =====================================================================
// 等到 L1 断电：按 U.rng(levelSeed, 'L1-blackout', epoch) 算出第一次够长（≥ 14 s）的断电，模拟时间推到它开始后 0.5 s
async function toBlackout(page) {
  const plan = await ev(page, () => {
    const U = BR.util, ls = BR.world.levelSeed;
    for (let e = 0; e < 60; e++) { const r = U.rng(ls, 'L1-blackout', e); if (r() < 0.3) { const dur = 8 + r() * 20; if (dur >= 14) return { e, dur, at: e * 45 }; } }
    return null;
  });
  if (!plan) return { plan, ok: false };
  // L1 自己的计时从进层开始；进层后已经走了多少说不准，一路推到断电开始（灯描述强度变 0）：离开始还远时一次推 5 s
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
// 等下一次断电开始（先等这次断电结束、整层灯亮着，再等灯全灭）：1 s 一步，灭灯那一刻最多晚 1 s 发现
async function nextBlackout(page, maxSec) {
  let t = 0, sawOn = false;
  for (let i = 0; i < 1200 && t < (maxSec || 900); i++) {
    const st = await ev(page, () => {
      __br.step(1);
      let n = 0, off = 0;
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { n++; if (l._l1orig !== undefined && l.intensity === 0) off++; }
      return { n, off };
    });
    t += 1;
    const allOff = st.n > 0 && st.off === st.n;
    if (!allOff) sawOn = true;
    else if (sawOn) return { ok: true, t };
  }
  return { ok: false, t };
}
async function gDark(browser) {
  const { ctx, page } = await boot(browser, 'dark');
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    await ev(page, k => { const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.1); __fk.stand(Y.x - 3, Y.z + 2.4, 0); return 0; }, k);
    const bo = await toBlackout(page);
    check('K0 L1 断电了（按种子算出第 ' + (bo.plan ? bo.plan.e : '?') + ' 轮，' + (bo.plan ? bo.plan.dur.toFixed(1) : '?') + ' s）', bo.ok, bo);
    if (!bo.ok) return;
    // 固定机位：车右侧 6 m、高 3 m 看车；量车前 4 m 和车尾后 2 m 的地面。「车头」按 forklift.js 的说法是门架前脸 / 叉根
    // （geo.forkZ 靠后那个，−1.16），大灯就放在它前面 3 m；车尾是配重后面（1.295）
    const cam = () => ev(page, k => {
      const G = __fk.geo(), heel = Array.isArray(G.forkZ) ? Math.max(G.forkZ[0], G.forkZ[1]) : -1.16;
      return { eye: Object.assign(__fk.W(k, 6, -1.4), { y: 3.0 }), at: Object.assign(__fk.W(k, 0, -1.4), { y: 0 }), pts: [Object.assign(__fk.W(k, 0, heel - 4.0), { y: 0.01, r: 4 }), Object.assign(__fk.W(k, 0, 1.295 + 2.0), { y: 0.01, r: 4 })] };
    }, k);
    const c0 = await cam();
    const base = await ev(page, c => __fk.measure(c.eye, c.at, c.pts), c0);
    await shot(page, 'k1-base', true);
    await ev(page, () => __fk.frames(45));
    const base2 = await ev(page, c => __fk.measure(c.eye, c.at, c.pts), c0);
    const pm = await mountCar(page, k, 'left');
    await ev(page, () => __fk.frames(60));
    const lit = await ev(page, a => {
      const owner = 'fk:' + a.k, L = __fk.extra[owner] && __fk.extra[owner][0];
      const g = BR.gfx.debugInfo();
      // 灯池里点着的光源（world 可能拷一份再交给 gfx）：按位置认
      const inPool = !!L && g.lit.some(s => s && (s === L || (Math.abs(s.x - L.x) < 0.05 && Math.abs(s.y - L.y) < 0.05 && Math.abs(s.z - L.z) < 0.05)));
      window.__fkLastLight = L ? { x: L.x, y: L.y, z: L.z } : null;
      let chunkOn = 0, chunkAll = 0;
      for (const c of BR.world.chunks()) for (const l of (c.lights || [])) { chunkAll++; if (l.intensity > 0) chunkOn++; }
      return { has: !!L, inPool, nLit: g.lit.length, litSrc: g.lit.map(q => [Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10, q.intensity]), chunkOn, chunkAll,
        L: L && { x: L.x, y: L.y, z: L.z, range: L.range, intensity: L.intensity }, lum: __fk.measure(a.c.eye, a.c.at, a.c.pts) };
    }, { k, c: c0 });
    await shot(page, 'k1-on', true);
    for (let i = 0; i < 2; i++) if (base2[i] != null && (base[i] == null || base2[i] > base[i])) base[i] = base2[i];   // 断电环境取两次里亮的那次（保守）
    const fr = base[0] > 0 ? lit.lum[0] / base[0] : Infinity, rr = base[1] > 0 ? lit.lum[1] / base[1] : Infinity;
    check('K1 断电时开着的车：前大灯借了灯池（gfx 里点着），车头（叉根）前 4 m 地面亮度 ≥ 断电环境 3 倍（' + (base[0] || 0).toFixed(1) + ' → ' + (lit.lum[0] || 0).toFixed(1) + '）', pm.ok && lit.has && lit.inPool && base[0] != null && lit.lum[0] != null && fr >= 3, { base, lit });
    check('K2 车尾后 2 m 的亮度 ≤ 断电环境 1.5 倍（' + (base[1] || 0).toFixed(1) + ' → ' + (lit.lum[1] || 0).toFixed(1) + '）', base[1] != null && lit.lum[1] != null && rr <= 1.5, { base, lum: lit.lum, rr });
    // 车头顶墙：出生块小屋西墙（x 20.8，门洞 z 15.42–16.58 以外那段），叉尖离墙 1 m
    await dismount(page);
    const wallPose = { x: 20.8 - 1.0 - 2.1, z: 18.0, yaw: -Math.PI / 2 };
    const pm2 = await placeAndMount(page, k, wallPose, 'left');
    // 拆成几段 page.evaluate（每段最多推 30 帧、量一次）：机器一忙，原来一整段（60 帧 + 3 次量 + 90 帧）会超过 EV_TIMEOUT（返修 r6）
    for (let i = 0; i < 2; i++) await ev(page, () => __fk.frames(30));
    const KW = { eye: { x: 25.6, y: 2.0, z: 18.0 }, at: { x: 23.0, y: 0, z: 18.0 }, pts: [{ x: 23.0, y: 0.01, z: 18.0, r: 4 }] };
    const w = await ev(page, a => {
      const owner = 'fk:' + a.k, list = __fk.extra[owner], L = list && list[0];
      window.__fkK3 = { owner, list };
      return { L: L && { x: L.x, y: L.y, z: L.z, range: L.range }, wallGap: L ? 20.8 - L.x : null, lit0: BR.gfx.debugInfo().lit.length, on: __fk.measure(a.w.eye, a.w.at, a.w.pts) };
    }, { k, w: KW });
    await ev(page, () => { BR.world.setExtraLights(window.__fkK3.owner, null); return __fk.frames(30); });
    await ev(page, () => __fk.frames(15));
    w.off = await ev(page, a => __fk.measure(a.eye, a.at, a.pts), KW);
    await ev(page, () => { const q = window.__fkK3; if (q.list) BR.world.setExtraLights(q.owner, q.list); return __fk.frames(30); });
    await ev(page, () => __fk.frames(15));
    w.on2 = await ev(page, a => __fk.measure(a.eye, a.at, a.pts), KW);
    await ev(page, () => { const L = window.__fkK3.list && window.__fkK3.list[0]; window.__fkWallLight = L ? { x: L.x, y: L.y, z: L.z } : null; return 0; });
    check('K3 车头顶着墙（叉尖离墙 1 m）：大灯光源在墙前 0.3 m', pm2.mounted && w.wallGap != null && Math.abs(w.wallGap - 0.3) <= 0.05, w);
    const wr = w.off[0] > 0 ? Math.max(w.on[0], w.on2[0]) / w.off[0] : Infinity;
    check('K4 墙另一侧（小屋里）2 m 处的亮度 ≤ 断电环境 1.2 倍（' + (w.off[0] || 0).toFixed(1) + ' → ' + Math.max(w.on[0] || 0, w.on2[0] || 0).toFixed(1) + '）', w.off[0] != null && w.on[0] != null && wr <= 1.2, { w, wr });
    // 下车：大灯光源撤掉；灯罩是暗色灯罩，不是开洞
    const lens = () => ev(page, a => {
      const eye = Object.assign(__fk.W(a.k, 1.6, -2.0), { y: 2.0 }), lz = Object.assign(__fk.W(a.k, 0.43, -0.688), { y: 1.87, r: 2 });
      const glow = BR.gfx.scene.children.find(o => o.isMesh && o.name === 'vehicles kit:glow');
      const vis = __fk.measure(eye, lz, [lz])[0];
      let hid = null;
      if (glow) { glow.visible = false; hid = __fk.measure(eye, lz, [lz])[0]; glow.visible = true; }
      return { vis, hid, glow: !!glow };
    }, { k });
    const lOn = await lens();
    await dismount(page);
    await ev(page, () => __fk.frames(45));
    const off = await ev(page, k => {
      const L = __fk.extra['fk:' + k];
      const last = L && L[0] ? L[0] : null;
      const P = window.__fkWallLight;
      const lit = BR.gfx.debugInfo().lit.some(s => s && P && Math.abs(s.x - P.x) < 0.05 && Math.abs(s.y - P.y) < 0.05 && Math.abs(s.z - P.z) < 0.05);
      return { extra: last ? { x: last.x, z: last.z } : null, light: BR.vehicles.debugInfo().light, lit };
    }, k);
    const lOff = await lens();
    await shot(page, 'k5-off', true);
    check('K5 下车后大灯光源撤掉（灯池里没有它）', !off.extra && !off.light && !off.lit, off);
    check('K6 熄火后灯罩是暗色灯罩：比点着时暗，而且和把灯罩藏掉（开洞）时不一样', lOn.glow && lOff.vis != null && lOn.vis != null && lOff.vis < lOn.vis - 5 && lOff.hid != null && Math.abs(lOff.vis - lOff.hid) > 3, { lOn, lOff });
    // 仪表台大灯开关：在下一次断电里试（上面 K1–K6 已经用掉了这次断电的大半，断电结束后整层灯亮了 lightAt 就比不出来了）。
    // 车摆回试车场，人站在车旁；断电一开始马上量座椅处的底值、上车
    await ev(page, k => { const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.1); __fk.stand(Y.x - 3, Y.z + 2.4, 0); return 0; }, k);
    const first = await ev(page, () => { const t = __fk.toasts.slice(); __fk.toasts.length = 0; __fk.toastMs.length = 0; return t; });
    const bo2 = await nextBlackout(page);
    if (!bo2.ok) { check('K7 等到下一次断电', false, bo2); return; }
    const seatAt0 = await ev(page, k => { const w = __fk.W(k, 0, 0.24); return BR.world.lightAt(w.x, w.z); }, k);
    const pm3 = await mountCar(page, k, 'left');
    await ev(page, () => __fk.frames(30));
    if (!pm3.ok) { check('K7 断电时坐上车', false, pm3); return; }
    await switchChecks(page, k, seatAt0, first);
    await dismount(page);
    await switchPersist(page, k);
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
  await switchTouch(browser);
}

// ---- 仪表台大灯开关（家长 2026-10 拍板，FE1 返修 r2）----
const FK_DARK_TIP = '闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关按空格可以关掉，或者下车找亮着绿色应急灯的门躲进小屋';
// 手机版（主会话 r3 裁定 ④：手机上没有空格，说点那个临时写成「关大灯」的键）；两句都按每秒 6 个字给显示时长、不少于 6 秒
const FK_DARK_TIP_TOUCH = '闪烁：叉车大灯会把你照亮，对准仪表台的大灯开关点「关大灯」键可以关掉，或者下车找亮着绿色应急灯的门躲进小屋';
const tipMsOk = (list, text) => { const r = (list || []).filter(q => q[0] === text); return r.length > 0 && r.every(q => q[1] >= Math.max(6000, Array.from(text).length * 1000 / 6) - 1); };
// 准心对准开关（底板中心），看候选、中间提示、触屏「互动」键现在写的字
const aimSwitch = (page, k) => ev(page, k => {
  const s = BR.vehicles.lightSwitch(k);
  if (!s) return null;
  BR.interact.aimAt(s.x, s.y, s.z); __br.step(1 / 30);
  return { s, cur: __fk.cur(), prompt: __fk.prompt(), btn: BR.input.buttonLabel('interact'), touch: __fk.touchBtn('interact') };
}, k);
// 座椅那一点的 lightAt、灯池里有没有这台车的大灯、开关状态
const seatLight = (page, k) => ev(page, k => {
  const w = __fk.W(k, 0, 0.24), d = BR.vehicles.debugInfo();
  return { at: BR.world.lightAt(w.x, w.z), extra: !!__fk.extra['fk:' + k], light: d.light, lit: BR.vehicles.headlightLit(), hl: __fk.pose(k).hl, on: __fk.pose(k).on };
}, k);
async function switchChecks(page, k, seatAt0, first) {
  const t0 = await ev(page, () => __fk.toasts.slice());   // 这次断电开始以后的提示
  const tm0 = await ev(page, () => __fk.toastMs.slice());
  const l0 = await seatLight(page, k);
  check('K9 点火时大灯默认开着：开关 hl 1，灯池里借了这台车的大灯，座椅处 lightAt ' + seatAt0.toFixed(2) + ' → ' + l0.at.toFixed(2) + '（被照亮）',
    l0.hl === 1 && l0.on === 1 && l0.extra && l0.light === 'fk:' + k && l0.lit && l0.at > seatAt0 + 0.1, l0);
  check('K8 断电途中坐上车、大灯亮了：提示正好是「' + FK_DARK_TIP + '」，这次断电只说一次（第一次断电时人站在车外，说的是「别开灯」那句）',
    t0.includes(FK_DARK_TIP) && t0.filter(t => t === FK_DARK_TIP).length === 1 && (first || []).some(t => /^闪烁：别开灯/.test(t)) && NO_E(FK_DARK_TIP), { t0, first });
  check('K8 电脑上这句写「按空格」（不是手机那句），显示 ' + ((tm0.find(q => q[0] === FK_DARK_TIP) || [])[1] / 1000).toFixed(1) + ' s：按每秒 6 个字算（' + Array.from(FK_DARK_TIP).length + ' 字），不少于 6 s',
    tipMsOk(tm0, FK_DARK_TIP) && !t0.includes(FK_DARK_TIP_TOUCH), tm0);
  const a0 = await aimSwitch(page, k);
  check('K7 坐在车上准心对准仪表台的大灯开关：候选是这台车的开关，中间提示「空格 关大灯」', !!a0 && !!a0.cur && a0.cur.key === 'fkhl:' + k && a0.cur.kind === 'button' && a0.prompt === '空格 关大灯' && a0.btn === '关大灯', a0);
  await shot(page, 'k7-switch-on', true);
  await tap(page, 'Space');
  await ev(page, () => __fk.frames(20));
  const a1 = await aimSwitch(page, k), l1 = await seatLight(page, k), st1 = await ev(page, () => __fk.seat());
  check('K7 短按空格关掉：还坐在车上（drive）、开关 hl 0，灯池里这盏撤掉，座椅处 lightAt 回到断电底值（' + seatAt0.toFixed(2) + ' → ' + l1.at.toFixed(2) + '），提示变成「空格 开大灯」',
    st1.seated === k && st1.mode === 'drive' && l1.hl === 0 && l1.on === 1 && !l1.extra && !l1.light && !l1.lit && Math.abs(l1.at - seatAt0) < 0.01 && !!a1 && a1.prompt === '空格 开大灯', { st1, l1, a1 });
  await shot(page, 'k7-switch-off', true);
  await tap(page, 'Space');
  await ev(page, () => __fk.frames(20));
  const a2 = await aimSwitch(page, k), l2 = await seatLight(page, k), t2 = await ev(page, () => __fk.toasts.slice());
  check('K7 再按一下打开：大灯回到灯池，lightAt 回到 ' + l2.at.toFixed(2) + '（和关之前差 <0.02），提示「空格 关大灯」；同一次断电里叉车那句不再重复',
    l2.hl === 1 && l2.extra && l2.light === 'fk:' + k && l2.lit && Math.abs(l2.at - l0.at) < 0.02 && !!a2 && a2.prompt === '空格 关大灯' && t2.filter(t => t === FK_DARK_TIP).length === 1, { l2, a2 });
  // 准心移开：中间提示恢复「空格 下车」
  const away = await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return { cur: __fk.cur(), prompt: __fk.prompt(), btn: BR.input.buttonLabel('interact') }; });
  check('K7 准心移开开关：中间提示恢复「空格 下车」', away.prompt === '空格 下车' && away.btn === '下车', away);
}
// 开关状态离开再回来保留；断电开始时坐在开着大灯的车上，开头就说叉车那句
async function switchPersist(page, k) {
  const m = await mountCar(page, k, 'left');
  await aimSwitch(page, k);
  await tap(page, 'Space');
  await ev(page, () => __fk.frames(10));
  const off = await seatLight(page, k);
  // 准心还对着开关时按空格是再拨一下开关：先把视线移开，再按空格下车
  await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return 0; });
  await dismount(page);
  const ls0 = await ev(page, k => BR.levelState.getv('1', 'veh', k), k);
  await goTo(page, '0');
  await goTo(page, '1');
  const ls1 = await ev(page, k => ({ ls: BR.levelState.getv('1', 'veh', k), hl: (__fk.pose(k) || {}).hl }), k);
  const m2 = await mountCar(page, k, 'left');
  await ev(page, () => __fk.frames(30));
  const on2 = await seatLight(page, k), a3 = await aimSwitch(page, k);
  check('K10 关掉大灯下车、离开这一层再回来：开关还是关着（levelState hl 0），再上车点着火大灯也不亮，开关提示「空格 开大灯」',
    m.ok && off.hl === 0 && !!ls0 && ls0.hl === 0 && !!ls1.ls && ls1.ls.hl === 0 && ls1.hl === 0 && m2.ok && on2.on === 1 && on2.hl === 0 && !on2.extra && !on2.light && !!a3 && a3.prompt === '空格 开大灯',
    { m: m.st, off, ls0, ls1, m2: m2.st, on2, a3 });
  await tap(page, 'Space');
  await ev(page, () => { BR.player.pitch = 0; __fk.frames(10); return 0; });
  const on3 = await seatLight(page, k);
  check('K10 再按一下开关打开：大灯亮了（hl 1，灯池里有它）', on3.hl === 1 && on3.extra && on3.lit, on3);
  // 坐着、开着大灯，一直等到下一次断电开始（重新进层后 L1 的计时从 0 起）：开头那条提示就是叉车那句
  const wait = await ev(page, () => { __fk.toasts.length = 0; __fk.toastMs.length = 0; return 0; });
  let hit = null, t = 0;
  for (let i = 0; i < 400 && t < 900; i++) {
    const r = await ev(page, () => { __br.step(2); return __fk.toasts.slice(); });
    t += 2;
    if (r.includes('灯光闪了一下……万籁俱寂')) { hit = r; break; }
  }
  const tm3 = await ev(page, () => __fk.toastMs.slice());
  check('K8b 坐在开着大灯的车上时断电开始（等了 ' + t + ' s）：提示是叉车那句（电脑版，按每秒 6 字给时长），不是「别开灯」', on3.lit && !!hit && hit.includes(FK_DARK_TIP) && !hit.some(x => /^闪烁：别开灯/.test(x)) && tipMsOk(tm3, FK_DARK_TIP), { on3, hit, wait, tm3 });
  await dismount(page);
}
// 手机：准心对着开关时「下车」键临时写成「开大灯 / 关大灯」，移开恢复「下车」；点它开关大灯
async function switchTouch(browser) {
  const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
  const { ctx, page } = await boot(browser, 'dark-touch', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA_ANDROID });
  try {
    await startL1(page, { seed: SEED });
    const k = await ev(page, () => __fk.spawnKey());
    await ev(page, k => { const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.1); return 0; }, k);
    const m = await mountCar(page, k, 'left');
    const look0 = await ev(page, () => ({ touch: BR.input.isTouch, btn: __fk.touchBtn('interact'), prompt: __fk.prompt() }));
    const a0 = await aimSwitch(page, k);
    await shot(page, 'k11-touch-switch', true);
    await page.tap('.touch-btn-interact');
    await ev(page, () => __fk.frames(10));
    const a1 = await aimSwitch(page, k), l1 = await seatLight(page, k), st1 = await ev(page, () => __fk.seat());
    const away = await ev(page, () => { BR.player.pitch = 0; __br.step(1 / 30); return { btn: __fk.touchBtn('interact'), prompt: __fk.prompt() }; });
    check('K11 手机：坐上车「互动」键是「下车」；准心对准开关变成「关大灯」，点它关掉后变成「开大灯」（人还在车上），移开准心恢复「下车」',
      m.ok && look0.touch && look0.btn && look0.btn.text === '下车' && !!a0 && a0.touch && a0.touch.text === '关大灯' && !!a1 && a1.touch && a1.touch.text === '开大灯' &&
      l1.hl === 0 && !l1.extra && st1.seated === k && away.btn && away.btn.text === '下车' && NO_E(a0.prompt) && NO_E(a1.prompt),
      { m: m.st, look0, a0, a1, l1, st1, away });
    // 再点一下打开（准心还对着开关）
    await aimSwitch(page, k);
    await page.tap('.touch-btn-interact');
    await ev(page, () => __fk.frames(10));
    const l2 = await seatLight(page, k);
    check('K11 手机：再点「开大灯」打开，大灯回到灯池', l2.hl === 1 && l2.extra, l2);
    // K11b 手机上坐在亮着大灯的车上断电：提示是手机版（「点「关大灯」键」，不说「按空格」），按每秒 6 个字给时长、不少于 6 s，这次断电只说一次
    await ev(page, () => { BR.player.pitch = 0; __fk.toasts.length = 0; __fk.toastMs.length = 0; __br.step(1 / 30); return 0; });
    const bo = await toBlackout(page);
    await ev(page, () => __fk.frames(30));
    const tt = await ev(page, () => ({ toasts: __fk.toasts.slice(), ms: __fk.toastMs.slice(), lit: BR.vehicles.headlightLit() }));
    await shot(page, 'k11b-touch-dark-tip', true);
    check('K11b 手机：坐在亮着大灯的车上断电，提示是「' + FK_DARK_TIP_TOUCH + '」（不出现「空格」），显示 ' + ((tt.ms.find(q => q[0] === FK_DARK_TIP_TOUCH) || [])[1] / 1000).toFixed(1) + ' s，只说一次',
      bo.ok && tt.toasts.filter(x => x === FK_DARK_TIP_TOUCH).length === 1 && !tt.toasts.includes(FK_DARK_TIP) && !tt.toasts.some(x => /空格/.test(x)) && tipMsOk(tt.ms, FK_DARK_TIP_TOUCH) && NO_E(FK_DARK_TIP_TOUCH), { bo, tt });
    // K11c 360×640 竖屏（最窄的手机）：这句提示里的按钮名「关大灯」整个在一行里，不拆成「关 / 大灯」（FE1 返修 r4：toast 里「…」包一层不换行的 span）
    await page.setViewportSize({ width: 360, height: 640 });
    await ev(page, t => { BR.hud.toast(t, 4000); __fk.frames(3); return 0; }, FK_DARK_TIP_TOUCH);
    const nb = await ev(page, t => {
      const el = Array.from(document.querySelectorAll('.hud-toast')).find(e => e.innerText.replace(/\s+/g, '') === t.replace(/\s+/g, ''));
      if (!el) return null;
      const sp = Array.from(el.querySelectorAll('.hud-nobr')).map(e => ({ text: e.textContent, rects: e.getClientRects().length }));
      return { lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20')), sp, text: el.innerText.replace(/\s+/g, '') === t, w: Math.round(el.getBoundingClientRect().width) };
    }, FK_DARK_TIP_TOUCH);
    await shot(page, 'k11c-360-tip', true);
    check('K11c 360×640 竖屏：断电提示里的按钮名「关大灯」整个在一行里（不拆成「关 / 大灯」），文字和原句一字不差',
      !!nb && nb.text && nb.sp.some(q => q.text === '「关大灯」' && q.rects === 1) && nb.sp.every(q => q.rects === 1), nb);
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// perf
// =====================================================================
async function gPerf(browser) {
  const { ctx, page } = await boot(browser, 'perf');
  try {
    for (const q of ['high', 'low']) {
      await startL1(page, { seed: SEED, quality: q });
      const k = await ev(page, () => __fk.spawnKey());
      const pm = await placeAndMount(page, k, await ev(page, () => __fk.YARD));
      const d1 = await ev(page, k => { const d = BR.vehicles.debugInfo(); return { per: d.perVehicle[k], calls: d.calls, tier: d.tiers[k] }; }, k);
      check('G1 ' + q + ' 画质：可动叉车 ' + d1.tier + ' 档 ' + d1.per + ' 面 ≤2000', pm.mounted && d1.per > 0 && d1.per <= 2000, d1);
      // 其余 5 台开过的车：已载入的车都摆到出生点旁边的主通道上，不够 6 台就补一台回放记录（levelState 里来的车）
      const others = await ev(page, k => {
        const keys = BR.vehicles.list().map(v => v.key).filter(x => x !== k);
        for (let i = 0; keys.length < 5; i++) keys.push('1@0,0#v' + (7 + i));
        const out = [];
        keys.slice(0, 5).forEach((key, i) => { BR.vehicles.setPose(key, { x: 3 + i * 4, z: 35.0, yaw: -Math.PI / 2, steer: 0, lift: 0, on: 0 }); out.push(key); });
        __br.step(0.5);
        return out;
      }, k);
      const d6 = await ev(page, () => { const d = BR.vehicles.debugInfo(); return { calls: d.calls, promoted: d.promoted.length, meshes: d.meshes, per: d.perVehicle }; });
      const lim = q === 'high' ? 3 : 2;
      check('G2 ' + q + ' 画质：载具网格 draw call 1 台 ' + d1.calls + '、6 台 ' + d6.calls + '（≤' + lim + '，一样多）', d1.calls <= lim && d6.calls <= lim && d6.calls === d1.calls && d6.promoted >= 6, { d1, d6, others });
      // 出生点：开着车、旁边 5 台开过的车，整帧 calls ≤120（朝东看整条主通道，再朝西看）
      const calls = [];
      for (const yaw of [-Math.PI / 2, Math.PI / 2, 0]) calls.push(await ev(page, y => { BR.player.yaw = y; BR.player.pitch = 0; __br.step(1 / 30); return BR.gfx.debugInfo().calls; }, yaw));
      check('G3 ' + q + ' 画质：出生点开着车 + 旁边 5 台开过的车，整帧 draw call ≤120', Math.max(...calls) <= 120, { calls });
      await shot(page, 'g3-' + q);
      // _step 1000 步平均 ≤0.6 ms
      if (q === 'high') {
        await dismount(page);
        await ev(page, k => { const Y = __fk.YARD; __fk.place(k, Y.x, Y.z, Y.yaw, 0); __br.step(0.1); __fk.stand(16, 30, 0); return 0; }, k);
        const t = await ev(page, k => {
          for (let i = 0; i < 30; i++) BR.vehicles._step(1 / 60, { throttle: 0.5, steer: 0.3, lift: 0 }, k);
          const t0 = performance.now();
          for (let i = 0; i < 1000; i++) BR.vehicles._step(1 / 60, { throttle: i % 400 < 200 ? 0.6 : -0.5, steer: Math.sin(i / 50), lift: i % 300 < 150 ? 1 : -1 }, k);
          return (performance.now() - t0) / 1000;
        }, k);
        check('G4 BR.vehicles._step 1000 步平均 ' + t.toFixed(3) + ' ms ≤0.6 ms', t <= 0.6, { avgMs: t });
      }
    }
    // 停放档 high / mid / lite：停着和升格（熄火）同一机位的平均像素差 <2
    const want = { high: null, mid: null, lite: null };
    for (const seed of [SEED, 8, 3, 6, 1, 2, 4, 5, 7]) {
      if (Object.values(want).every(Boolean)) break;
      await startL1(page, { seed, quality: 'high' });
      const found = await ev(page, () => BR.vehicles.list().filter(v => !v.driven && !v.runtime).map(v => ({ key: v.key, detail: (__fk.fkData(v.key) || {}).detail, x: v.x, z: v.z, yaw: v.yaw })));
      for (const f of found) {
        {
          if (want[f.detail] === null) {
            const r = await ev(page, f => {
              // 站到车旁边（让这块和它周围都载入着）；相机在车的一侧 3.6 m（或车头前、车尾后）、高 1.7 m 看车中心：
              // 挑一个相机不在墙里、到车中心视线不被挡的机位
              __fk.stand(f.x + Math.cos(f.yaw) * 4, f.z - Math.sin(f.yaw) * 4, 0);
              __br.step(1.0);
              const at = Object.assign(__fk.W(f.key, 0, -0.4), { y: 0.9 });
              let eye = null, view = null;
              for (const [lx, lz, nm] of [[3.6, -0.4, 'right'], [-3.6, -0.4, 'left'], [2.6, -3.6, 'front-right'], [-2.6, -3.6, 'front-left'], [2.6, 3.0, 'rear-right'], [-2.6, 3.0, 'rear-left']]) {
                const e = Object.assign(__fk.W(f.key, lx, lz), { y: 1.7 });
                if (BR.phys.overlapCircle(e.x, e.z, 0.2, 1.5, 0.4)) continue;
                const pk = __fk.physKey(f.key);
                // 视线：相机到车中心（车自己的盒子不算）
                const h = BR.phys.raycast(e.x, e.y, e.z, at.x - e.x, at.y - e.y, at.z - e.z, Math.hypot(at.x - e.x, at.y - e.y, at.z - e.z), { ignoreKey: pk });
                if (h) continue;
                eye = e; view = nm; break;
              }
              if (!eye) return { noView: true };
              const png = () => { const c = __fk._c2; return c ? c.toDataURL('image/png') : null; };
              const a = __fk.snap(eye, at), pa = png();
              const p = __fk.pose(f.key);
              BR.vehicles.setPose(f.key, { x: p.x, z: p.z, yaw: p.yaw, steer: 0, lift: 0, on: 0 });
              BR.vehicles.update(0.3); BR.vehicles.update(0.01);
              const b = __fk.snap(eye, at), pb = png();
              const d = BR.vehicles.debugInfo();
              // 车在画面里的范围（14 个盒子的角投到屏幕）里的平均像素差，只做参考
              const cam = BR.gfx.camera, P0 = cam.position.clone(), Q0 = cam.quaternion.clone();
              cam.position.set(eye.x, eye.y, eye.z); cam.lookAt(at.x, at.y, at.z); cam.updateMatrixWorld(true);
              const W = __fk._c2.width, H = __fk._c2.height;
              let x0 = W, y0 = H, x1 = 0, y1 = 0;
              for (const o of __fk.obbs(f.key)) for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (const y of [o.minY, o.maxY]) {
                const c = Math.cos(o.rot), sn = Math.sin(o.rot);
                const v = new THREE.Vector3(o.cx + c * u * o.hx + sn * w * o.hz, y, o.cz - sn * u * o.hx + c * w * o.hz).project(cam);
                const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
                x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
              }
              cam.position.copy(P0); cam.quaternion.copy(Q0); cam.updateMatrixWorld(true);
              x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
              let sd = 0, n = 0;
              for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { const i = (yy * W + xx) * 4; sd += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
              return { view, diff: __fk.diff(a, b), carDiff: n ? sd / n : null, carBox: [x0, y0, x1, y1], frac: n / 3 / (W * H), meshed: d.promoted.includes(f.key), tier: d.tiers[f.key], pa, pb };
            }, f);
            for (const [nm, u] of [['parked', r.pa], ['promoted', r.pb]]) if (u) fs.writeFileSync(path.join(OUT, 'g5-' + f.detail + '-' + nm + '.png'), Buffer.from(u.split(',')[1], 'base64'));
            delete r.pa; delete r.pb;
            want[f.detail] = Object.assign({ seed, key: f.key }, r);
          }
        }
      }
    }
    for (const t of ['high', 'mid', 'lite']) {
      const r = want[t];
      check('G5 停放档 ' + t + ' 的车：停着和升格（熄火）两张同机位截图平均像素差 <2（车占画面 ' + (r && r.frac != null ? (100 * r.frac).toFixed(0) : '?') + '%）', !!r && !r.noView && r.meshed && r.diff < 2 && r.frac > 0.05, r || '没找到这一档的车');
    }
    // 新音效离线渲染：没有 NaN、峰值 <0 dBFS
    const names = ['fk_ignite', 'fk_engine', 'fk_hydraulic', 'fk_reverse', 'fk_end', 'fk_strain', 'fk_bang', 'fk_bump', 'fk_seat', 'fk_radar', 'fk_off'];
    const au = await ev(page, async names => {
      const out = {};
      for (const n of names) {
        let r = null;
        for (const kind of ['sfx', 'loop']) {
          try { r = await BR.audio._renderOffline(kind, n, 3); break; } catch (e) { r = { error: String(e && e.message || e) }; }
        }
        out[n] = r;
      }
      return out;
    }, names);
    const badA = names.filter(n => !au[n] || au[n].error || au[n].nan > 0 || !(au[n].peakDb < 0) || au[n].rmsDb <= -100);
    check('G6 叉车新音效 11 个离线渲染：没有 NaN、峰值 <0 dBFS、不是静音', badA.length === 0, { bad: badA, au });
  } finally {
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

// =====================================================================
// main
// =====================================================================
// =====================================================================
// side：车身高度上伸出来、却没有碰撞体的东西（b.data.sideObs）
// =====================================================================
// 页面里的小工具：sideObs 列表、车的 14 个 OBB 压进这些盒子多深、找一条全速撞上去的直道、用一台独立的模拟车开过去
function installSide() {
  const S = window.__side = {};
  S.list = kinds => {
    const out = [];
    for (const c of BR.world.chunks()) {
      const so = c.res && c.res.data && c.res.data.sideObs;
      if (Array.isArray(so)) for (const e of so) if (!kinds || kinds.includes(e.kind)) out.push(Object.assign({ ck: c.key }, e));
    }
    return out;
  };
  // OBB {cx,cz,hx,hz,rot,minY,maxY} 压进 sideObs 条目 e 多深（m）；竖直重叠 ≤1 cm 不算
  S.depth = (o, e, pad) => {
    const p = pad || 0;
    if (Math.min(o.maxY, e.maxY + p) - Math.max(o.minY, e.minY - p) <= 0.01) return 0;
    if (e.round) { const d = BR.phys.circleVsObb(e.cx, e.cz, e.r + p, o, e.minY - p, e.maxY - e.minY + 2 * p); return d && d.depth > 0 ? d.depth : 0; }
    const ca = Math.cos(o.rot), sa = Math.sin(o.rot), rb = e.rot || 0, cb = Math.cos(rb), sb = Math.sin(rb);
    const dx = e.cx - o.cx, dz = e.cz - o.cz;
    let m = Infinity;
    for (const [ux, uz] of [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]]) {
      const ra = o.hx * Math.abs(ca * ux - sa * uz) + o.hz * Math.abs(sa * ux + ca * uz);
      const rr = (e.hx + p) * Math.abs(cb * ux - sb * uz) + (e.hz + p) * Math.abs(sb * ux + cb * uz);
      const ov = ra + rr - Math.abs(dx * ux + dz * uz);
      if (ov <= 0) return 0;
      m = Math.min(m, ov);
    }
    return m;
  };
  S.boxes = (x, z, yaw, lift) => {
    const G = BR.L1forklift.geo, loc = G.obbs(lift || 0);
    return BR.phys.toWorldOBBs(loc, x, z, yaw, BR.phys.groundY(x, z));
  };
  // 一组 OBB 压进任何 sideObs 超过 tol 的：[部件→种类:深度]
  S.pen = (boxes, tol, list) => {
    const L = list || S.list(), out = [];
    for (const o of boxes) for (const e of L) {
      if (e.maxX < o.cx - 3 || e.minX > o.cx + 3 || e.maxZ < o.cz - 3 || e.minZ > o.cz + 3) continue;
      const d = S.depth(o, e);
      if (d > tol) out.push(o.name + '→' + e.kind + ':' + d.toFixed(3));
    }
    return out;
  };
  S.physPen = (boxes, tol, skip) => {
    const res = [];
    for (const o of boxes) { const out = []; if (BR.phys.overlapOBB(o, { tol: tol == null ? 0.01 : tol, out, skipBoxes: skip })) res.push(o.name + '→' + out.map(s => s.key).join('|')); }
    return res;
  };
  // 离 e 多近（m）：把 e 往外扩 pad 还压不压得上
  S.near = (boxes, e, pad) => boxes.some(o => S.depth(o, e, pad) > 0);
  S.sim = null;
  S.make = (x, z, yaw, lift) => {
    if (S.sim) S.sim.dispose();
    S.sim = BR.forklift.create({ key: 'fkside', x, z, yaw, lift: lift || 0, on: 1 });
    return S.sim;
  };
  S.drop = () => { if (S.sim) S.sim.dispose(); S.sim = null; };
  // 独立的模拟车按固定输入开 maxSec 秒（或停住），返回位移、最快、事件、状态行
  S.run = (inp, maxSec, untilStop) => {
    const sim = S.sim, dt = 1 / 30, ev = [], notes = [];
    const x0 = sim.x, z0 = sim.z;
    let t = 0, vmax = 0, stopT = 0;
    while (t < maxSec) {
      const r = sim.step(dt, inp, { phase: 'run', local: true, vines: false });
      t += dt;
      for (const e of r.events || []) ev.push(e);
      if (r.note && notes[notes.length - 1] !== r.note) notes.push(r.note);
      vmax = Math.max(vmax, Math.abs(sim.spd));
      if (untilStop && t > 0.3 && Math.abs(sim.spd) < 0.02) { stopT += dt; if (stopT > 0.2) break; } else stopT = 0;
    }
    return { t: Math.round(t * 100) / 100, moved: Math.hypot(sim.x - x0, sim.z - z0), vmax, ev, notes, spd: sim.spd };
  };
  // 贴着走：车和一个面平行（车身最宽处离面 clear 米），车头方向 alongX ? ±X : ±Z，从 target 前面 5 m 开过去；停住时要贴着 target（5 cm 内）。
  // face = 面所在的坐标（alongX 时是 z 值，否则是 x 值），side = 车在面的哪一侧（+1 / −1）
  S.scrape = (target, face, side, alongX, clear) => {
    const G = BR.L1forklift.geo, half = Math.max(...G.obbs(0).map(o => Math.abs(o.cx) + o.hx));
    const L = S.list(), tries = [];
    for (const run of [5, 3.5, 2.5]) for (const dir of [1, -1]) {
      const yaw = alongX ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI : 0);
      const lat = face + side * (half + clear);
      const tc = alongX ? target.cx : target.cz;
      const x = alongX ? tc - dir * run : lat, z = alongX ? lat : tc - dir * run;
      const b0 = S.boxes(x, z, yaw, 0);
      const p0 = S.physPen(b0, 0.005), s0 = S.pen(b0, 0.001, L);
      if (p0.length || s0.length) { tries.push({ run, dir, start: p0.concat(s0).slice(0, 3) }); continue; }
      S.make(x, z, yaw, 0);
      const r = S.run({ throttle: 1, steer: 0, lift: 0 }, 6, true);
      const b1 = S.sim.obbsWorld();
      if (!S.near(b1, target, 0.05)) { tries.push({ run, dir, moved: +r.moved.toFixed(2), ev: r.ev.slice(0, 3), notNear: true }); continue; }
      return { ok: true, x, z, yaw, r, pen: S.pen(b1, 0.01, L), phys: S.physPen(b1, 0.01), tries };
    }
    return { ok: false, tries };
  };
  // 倒车撞：车尾离 e 的近面 run 米、车尾正对着它，油门 −1 倒过去。返回停住时的状态行
  S.laneRev = (e, opts) => {
    const o = opts || {};
    const G = BR.L1forklift.geo, rear = Math.max(...G.obbs(0).map(q => q.cz + q.hz));
    const L = S.list(), tries = [];
    for (const run of o.runs || [3, 2.2]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const off of [0, 0.2, -0.2]) {
      const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, lx = -f.z, lz = f.x;
      const ex = e.round ? e.r : Math.abs(f.x) > 0.5 ? (e.maxX - e.minX) / 2 : (e.maxZ - e.minZ) / 2;
      const sx = e.cx + f.x * (ex + run + rear) + lx * off, sz = e.cz + f.z * (ex + run + rear) + lz * off;
      const b0 = S.boxes(sx, sz, yaw, 0);
      if (S.physPen(b0, 0.005).length || S.pen(b0, 0.001, L).length) continue;
      if (o.clear && !o.clear(b0)) continue;
      S.make(sx, sz, yaw, 0);
      const r = S.run({ throttle: -1, steer: 0, lift: 0 }, 6, true);
      const b1 = S.sim.obbsWorld();
      if (!S.near(b1, e, 0.06)) { tries.push({ run, yaw, off, moved: +r.moved.toFixed(2), notes: r.notes }); continue; }
      return { x: sx, z: sz, yaw, run, off, r, pen: S.pen(b1, 0.01, L), phys: S.physPen(b1, 0.01) };
    }
    return { fail: true, tries: tries.slice(0, 4) };
  };
  // 按真实形状挡车（FE1 返修 r2：以前一律按外接矩形，开向斜放的地牛、纸箱会在离它 20–30 cm 的空地上停住）：
  // 对着每个目标从 4 个方向、偏心 offs 米全速开过去（叉尖离它的外接框近面 2.5 m）。被挡住（「咚 / 哐」）时：
  // 离它的真实形状 ≤5 cm 记 contact；离别的 sideObs / 碰撞体 ≤5 cm 记 other；离谁都超过 5 cm（停在空地上）记进 air（带离 e 多远）。
  // 地牛（FE1 返修 r3）：它的两个条目带同一个 solid（那块 1 m 见方的老碰撞体，车跳过它）—— 两个条目都算「它的真实形状」，
  // 那块老碰撞体不算「别的碰撞体」（不然车停在离地牛一拃远的地方，碰到的正是它，也会被记成 other、测不出来）
  S.sameSolid = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length >= 6 && b.length >= 6 && a.every((v, i) => i > 5 || Math.abs(v - b[i]) < 1e-3);
  S.skips = L => { const out = []; for (const q of L) if (Array.isArray(q.solid) && !out.some(b => S.sameSolid(b, q.solid))) out.push(q.solid); return out; };
  S.shapeRuns = (targets, offs) => {
    const L = S.list(), G = BR.L1forklift.geo, tip = Math.min(G.forkZ[0], G.forkZ[1]), skip = S.skips(L);
    const rows = [];
    for (const e of targets) {
      const row = { kind: e.kind, ck: e.ck, cx: +e.cx.toFixed(2), cz: +e.cz.toFixed(2), rot: +(+e.rot || 0).toFixed(3), round: !!e.round, tries: 0, contact: 0, other: 0, air: [], pen: [] };
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const off of (typeof offs === 'function' ? offs(e) : offs)) {
        const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, lx = -f.z, lz = f.x;
        const face = Math.abs(f.x) > 0.5 ? (e.maxX - e.minX) / 2 : (e.maxZ - e.minZ) / 2;
        const sx = e.cx - f.x * face - f.x * (2.5 - tip) + lx * off, sz = e.cz - f.z * face - f.z * (2.5 - tip) + lz * off;
        const b0 = S.boxes(sx, sz, yaw, 0);
        if (S.physPen(b0, 0.005).length || S.pen(b0, 0.001, L).length) continue;
        S.make(sx, sz, yaw, 0);
        const r = S.run({ throttle: 1, steer: 0, lift: 0 }, 5, true);
        if (r.notes.some(n => /出口|雷达/.test(n))) continue;
        row.tries++;
        if (!(r.ev.includes('bang') || r.ev.includes('bump'))) continue;
        const b1 = S.sim.obbsWorld();
        const pen = S.pen(b1, 0.01, L).concat(S.physPen(b1, 0.01, skip.length ? skip : undefined));
        if (pen.length) row.pen.push(pen.slice(0, 2));
        const mine = q => q === e || (e.solid && S.sameSolid(q.solid, e.solid));
        const sib = L.filter(mine).concat([e]);
        if (sib.some(q => S.near(b1, q, 0.05))) { row.contact++; continue; }
        if (L.some(q => !mine(q) && S.near(b1, q, 0.05))) { row.other++; continue; }
        if (b1.some(o => BR.phys.overlapOBB(Object.assign({}, o, { hx: o.hx + 0.05, hz: o.hz + 0.05 }), { tol: 0, skipBoxes: skip.length ? skip : undefined }))) { row.other++; continue; }
        let gap = null;
        for (let pd = 0.05; pd <= 0.6; pd += 0.01) if (sib.some(q => S.near(b1, q, pd))) { gap = +pd.toFixed(2); break; }
        row.air.push({ yaw: +yaw.toFixed(2), off, gap, moved: +r.moved.toFixed(2) });
      }
      rows.push(row);
    }
    S.drop();
    return rows;
  };
  // 斜着放的（rot 离 90° 的倍数超过 0.12 rad）
  S.tilted = e => { const q = (((+e.rot || 0) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); return Math.min(q, Math.PI / 2 - q) > 0.12; };
  // 找一条直道：叉尖离 e 的近面 run 米、正对着它；起点不压任何碰撞体 / sideObs；开过去停住时贴着 e（5 cm 内）
  S.lane = (e, opts) => {
    const o = opts || {}, lift = o.lift || 0;
    const G = BR.L1forklift.geo, tip = Math.min(G.forkZ[0], G.forkZ[1]);
    const L = S.list();
    for (const run of o.runs || [4, 3, 2.5]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const off of o.offs || [0, 0.2, -0.2, 0.4, -0.4]) {
      const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, lx = -f.z, lz = f.x;
      const cx = (e.minX + e.maxX) / 2, cz = (e.minZ + e.maxZ) / 2;
      const face = Math.abs(f.x) > 0.5 ? (e.maxX - e.minX) / 2 : (e.maxZ - e.minZ) / 2;
      const tx = cx - f.x * face, tz = cz - f.z * face;
      const sx = tx - f.x * (run - tip) + lx * off, sz = tz - f.z * (run - tip) + lz * off;
      const b0 = S.boxes(sx, sz, yaw, lift);
      if (S.physPen(b0, 0.005).length || S.pen(b0, 0.001, L).length) continue;
      S.make(sx, sz, yaw, lift);
      const r = S.run({ throttle: 1, steer: 0, lift: 0 }, 6, true);
      const b1 = S.sim.obbsWorld();
      if (!S.near(b1, e, 0.05)) continue;
      return { x: sx, z: sz, yaw, run, off, r, pen: S.pen(b1, 0.01, L), phys: S.physPen(b1, 0.01) };
    }
    return null;
  };
}

async function gSide(browser) {
  const { ctx, page } = await boot(browser, 'side');
  try {
    await startL1(page, { seed: SEED });
    await ev(page, installSide);
    // ① 数据：出生块的每根柱子都记了柱脚，主通道边的柱子记了护角；所有条目数值合法
    const d = await ev(page, () => {
      const all = __side.list(), byKind = {};
      for (const e of all) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      const badE = all.filter(e => !['cx', 'cz', 'hx', 'hz', 'rot', 'minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY'].every(k => Number.isFinite(e[k])) || !(e.maxY > e.minY) || !(e.hx > 0 && e.hz > 0) || e.minX > e.cx || e.maxX < e.cx);
      const c00 = all.filter(e => e.ck === '0,0');
      return { n: all.length, byKind, bad: badE.slice(0, 3), plinth00: c00.filter(e => e.kind === 'plinth').length, guard00: c00.filter(e => e.kind === 'guard').length };
    });
    check('S1 sideObs：出生块 16 根柱子都有柱脚（' + d.plinth00 + '）、主通道边的柱子有护角（' + d.guard00 + '），全部条目数值合法（共 ' + d.n + ' 条）', d.plinth00 === 16 && d.guard00 >= 16 && d.bad.length === 0, d);

    // ② 出生点附近：全速撞柱脚、护角、消火栓箱、通道里的纸箱、地牛、小屋的灭火器 / 门扇
    const near = async kinds => {
      const tried = [];
      for (const kind of kinds) {
        const list = await ev(page, k => __side.list([k]).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 30) - Math.hypot(b.cx - 16, b.cz - 30)).slice(0, 12), kind);
        let res = null, tgt = null;
        for (const e of list) {
          // 消火栓箱离地 0.8 m：货叉在地上时叉尖先碰到墙，得把货叉升到箱子的高度（叉底 1.0 m）正着撞
          res = await ev(page, a => __side.lane(a.e, { lift: a.k === 'cabinet' ? (1.0 - (BR.L1forklift.geo.forkY || 0.015)) / BR.L1forklift.geo.carriageTravel : 0 }), { e, k: kind });
          if (res) { tgt = e; break; }
        }
        tried.push([kind, list.length]);
        // 柱脚、护角、消火栓箱出生点附近一定有，必须撞得上；别的（纸箱、地牛、灭火器、门扇、开关盒）看种子，附近没有或摆得开不过去就记一笔跳过
        if (!tgt) {
          if (['plinth', 'cabinet'].includes(kind)) check('S2 ' + kind + '：找到一条能全速撞上去的直道', false, { n: list.length });
          else info(kind + '：出生点附近 ' + list.length + ' 个，没有能全速直着撞上去的，跳过');
          continue;
        }
        const hit = res.r.ev.includes('bang') || res.r.ev.includes('bump');
        check('S2 全速撞' + kind + '（' + tgt.ck + '，直道 ' + res.run + ' m、最快 ' + res.r.vmax.toFixed(2) + ' m/s）：停在它跟前（5 cm 内），14 个 OBB 压进 sideObs 和碰撞体都 <1 cm，有「咚 / 哐」',
          res.pen.length === 0 && res.phys.length === 0 && hit && Math.abs(res.r.spd) < 0.05 && res.r.moved > 0.5,
          { tgt: { kind: tgt.kind, cx: tgt.cx, cz: tgt.cz, minY: tgt.minY, maxY: tgt.maxY }, lane: { x: +res.x.toFixed(2), z: +res.z.toFixed(2), yaw: res.yaw, off: res.off }, r: res.r, pen: res.pen, phys: res.phys });
      }
      return tried;
    };
    // 护角在柱角上、正着撞总是先碰到柱脚（地上 22 cm 凸出 8 cm），护角放到 ③ 贴着柱子开
    info('出生点附近试过的种类', await near(['plinth', 'cabinet', 'carton', 'jack', 'extinguisher', 'door', 'switch']));
    await ev(page, () => { __side.drop(); return 0; });

    // ③ 贴着走：车身离墙 10 cm 沿挂消火栓箱的墙开过去，被箱子挡住；车身离柱面 2 cm 沿主通道边的柱子开过去，被柱脚 / 护角挡住
    const cab = await ev(page, () => {
      const L = __side.list(['cabinet']).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 30) - Math.hypot(b.cx - 16, b.cz - 30));
      const all = [];
      for (const e of L) {
        // 箱子薄的那个方向就是离墙的方向：墙在箱子背面（背面那一侧有碰撞体）
        const alongX = (e.maxX - e.minX) > (e.maxZ - e.minZ);
        for (const s of [1, -1]) {
          const back = alongX ? { x: e.cx, z: s > 0 ? e.maxZ + 0.05 : e.minZ - 0.05 } : { x: s > 0 ? e.maxX + 0.05 : e.minX - 0.05, z: e.cz };
          if (!BR.phys.overlapBox(back.x - 0.02, back.z - 0.02, back.x + 0.02, back.z + 0.02, 1.0, 0.3, { tol: 1e-6 })) continue;
          // 墙面 = 箱子贴墙的背面
          const wall = alongX ? (s > 0 ? e.maxZ : e.minZ) : (s > 0 ? e.maxX : e.minX);
          const r = __side.scrape(e, wall, -s, alongX, 0.1);
          if (r.ok) { __side.drop(); return Object.assign({ ck: e.ck }, r); }
          all.push({ ck: e.ck, tries: r.tries });
        }
      }
      __side.drop();
      return { ok: false, all: all.slice(0, 6) };
    });
    check('S3 贴着挂消火栓箱的墙（车身离墙 10 cm）开过去：被箱子挡住，OBB 压进去 <1 cm，有「咚 / 哐」', cab.ok && cab.pen.length === 0 && cab.phys.length === 0 && Math.abs(cab.r.spd) < 0.05 && (cab.r.ev.includes('bang') || cab.r.ev.includes('bump')), cab);
    const pil = await ev(page, () => {
      // 主通道边的柱子（有护角的）：柱脚条目给出柱子中心和柱身半宽（柱脚每边宽 8 cm）
      const P = __side.list(['plinth']).filter(p => __side.list(['guard']).some(g => Math.abs(g.cx - p.cx) < 1 && Math.abs(g.cz - p.cz) < 1))
        .sort((a, b) => Math.hypot(a.cx - 16, a.cz - 30) - Math.hypot(b.cx - 16, b.cz - 30));
      const all = [];
      for (const p of P.slice(0, 8)) {
        const shaft = p.hx - 0.08;
        for (const alongX of [true, false]) for (const s of [1, -1]) {
          const face = (alongX ? p.cz : p.cx) + s * shaft;
          const r = __side.scrape(p, face, s, alongX, 0.02);
          if (r.ok) { __side.drop(); return Object.assign({ ck: p.ck, at: [p.cx, p.cz] }, r); }
          all.push({ at: [p.cx, p.cz], alongX, s, tries: r.tries });
        }
      }
      __side.drop();
      return { ok: false, all: all.slice(0, 6) };
    });
    check('S3b 贴着主通道边的柱子（车身离柱面 2 cm）开过去：被柱脚 / 护角挡住，OBB 压进去 <1 cm', pil.ok && pil.pen.length === 0 && pil.phys.length === 0 && Math.abs(pil.r.spd) < 0.05, pil);

    // ④ 货叉伸到消火栓箱底下按住 R：升到箱底下面停住，提示「上面有消火栓箱，升不上去」
    const lift = await ev(page, () => {
      const L = __side.list(['cabinet']).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 30) - Math.hypot(b.cx - 16, b.cz - 30));
      const G = BR.L1forklift.geo, tip = Math.min(G.forkZ[0], G.forkZ[1]), heel = Math.max(G.forkZ[0], G.forkZ[1]);
      for (const e of L) {
        const alongX = (e.maxX - e.minX) > (e.maxZ - e.minZ);
        for (const s of [1, -1]) {
          const back = alongX ? { x: e.cx, z: s > 0 ? e.maxZ + 0.05 : e.minZ - 0.05 } : { x: s > 0 ? e.maxX + 0.05 : e.minX - 0.05, z: e.cz };
          if (!BR.phys.overlapBox(back.x - 0.02, back.z - 0.02, back.x + 0.02, back.z + 0.02, 1.0, 0.3, { tol: 1e-6 })) continue;
          const wall = alongX ? (s > 0 ? e.maxZ : e.minZ) : (s > 0 ? e.maxX : e.minX);
          // 车头朝墙，叉尖离墙 3 cm（货叉在箱子底下，货叉架离箱子正面还有 0.7 m）
          const yaw = alongX ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2);
          const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
          const dist = -tip + 0.03;
          const x = alongX ? e.cx : wall - f.x * dist, z = alongX ? wall - f.z * dist : e.cz;
          const b0 = __side.boxes(x, z, yaw, 0);
          if (__side.physPen(b0, 0.005).length || __side.pen(b0, 0.001).length) continue;
          __side.make(x, z, yaw, 0);
          const r = __side.run({ throttle: 0, steer: 0, lift: 1 }, 4, false);
          const st = __side.sim.poseObj();
          const forkTop = (G.forkY || 0.015) + (G.forkT || 0.04) + st.lift * G.carriageTravel;
          const b1 = __side.sim.obbsWorld();
          const out = { ck: e.ck, forkTop, cabBottom: e.minY, notes: r.notes, ev: r.ev.slice(0, 6), pen: __side.pen(b1, 0.005), heel };
          __side.drop();
          return out;
        }
      }
      return null;
    });
    check('S4 货叉伸到消火栓箱底下按住 R：叉面停在箱底下面 1–3 cm，提示「上面有消火栓箱，升不上去」，有憋压声', !!lift && lift.forkTop < lift.cabBottom - 0.005 && lift.forkTop > lift.cabBottom - 0.04 && lift.notes.includes('上面有消火栓箱，升不上去') && lift.ev.includes('strain') && lift.pen.length === 0, lift);

    // ③c 倒车撞：车尾朝着出口圈倒过去，提示「后面是出口」（不是「前面是出口」）；车尾朝着能拖的家具倒过去，提示「后面有东西挡着，下车把它拖开」，
    //     车头朝着它开过去还是「前面有东西挡着，下车把它拖开」
    const rev = await ev(page, () => {
      const out = {};
      const ex = [];
      for (const c of BR.world.chunks()) for (const e of (c.exits || [])) if (e.active !== false && e.kind === 'zone') ex.push(e);
      ex.sort((a, b) => Math.hypot(a.x - 16, a.z - 30) - Math.hypot(b.x - 16, b.z - 30));
      for (const e of ex) {
        const R = (+e.radius || 1) + 0.4, y = Number.isFinite(+e.y) ? +e.y : 0;
        const t = { round: true, cx: +e.x, cz: +e.z, r: R, minX: e.x - R, maxX: e.x + R, minZ: e.z - R, maxZ: e.z + R, minY: y - 1, maxY: y + 3 };
        const r = __side.laneRev(t);
        if (r.fail) continue;
        out.exit = { to: e.to, notes: r.r.notes, moved: +r.r.moved.toFixed(2), deep: __side.sim.obbsWorld().map(o => { const d = BR.phys.circleVsObb(e.x, e.z, R, o); return d ? d.depth : 0; }).reduce((a, b) => Math.max(a, b), 0) };
        break;
      }
      // 「拖出来的家具」：把一件能拖的道具（文件柜 / 办公桌 / 椅子）挪到主通道上的空地（world.movePropTo + commitProp，和拖动松手同一条路）
      const cand = BR.world.propsNear(16, 30, 60).filter(P => P.draggable !== false && P.box && P.box.maxY - P.box.minY > 0.4);
      const moved = [];
      for (const P of cand.slice(0, 3)) {
        for (let k = 0; k < 40; k++) {
          const x = -6 + (k % 10) * 1.6, z = 31 + Math.floor(k / 10) * 1.2;
          const hx = (P.box.maxX - P.box.minX) / 2 + 3, hz = (P.box.maxZ - P.box.minZ) / 2 + 3;
          if (BR.phys.overlapBox(x - hx, z - hz, x + hx, z + hz, 0.05, 2.0, { tol: 1e-6 })) continue;
          if (moved.some(m => Math.hypot(m[0] - x, m[1] - z) < 7)) continue;
          const cx0 = (P.box.minX + P.box.maxX) / 2, cz0 = (P.box.minZ + P.box.maxZ) / 2;
          if (!BR.world.movePropTo(P.key, { dx: P.dx + (x - cx0), dz: P.dz + (z - cz0) })) break;
          BR.world.commitProp(P.key);
          __br.step(1 / 30);
          moved.push([x, z, P.key]);
          break;
        }
      }
      const props = moved.map(m => BR.world.propByKey(m[2])).filter(Boolean);
      out.movedProps = moved;
      for (const P of props) {
        const b = P.box, t = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2, rot: 0, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, minY: b.minY, maxY: b.maxY };
        const r = __side.laneRev(t);
        if (r.fail) continue;
        out.prop = { label: P.label || P.kind, notes: r.r.notes, moved: +r.r.moved.toFixed(2), phys: r.phys };
        const f = __side.lane(t, { runs: [3, 2.2] });
        if (f) out.propFwd = { notes: f.r.notes, moved: +f.r.moved.toFixed(2), phys: f.phys };
        break;
      }
      __side.drop();
      return out;
    });
    check('S10 车尾朝着出口圈倒过去：停在圈外（OBB 压进出口圈 +0.4 <1 cm），提示「后面是出口」、没说「前面是出口」', !!rev.exit && rev.exit.notes.includes('后面是出口') && !rev.exit.notes.includes('前面是出口') && rev.exit.deep < 0.01, rev.exit);
    check('S11 车尾朝着能拖的家具倒过去：提示「后面有东西挡着，下车把它拖开」；车头朝着它开过去提示「前面有东西挡着，下车把它拖开」',
      !!rev.prop && rev.prop.notes.includes('后面有东西挡着，下车把它拖开') && !rev.prop.notes.includes('前面有东西挡着，下车把它拖开') && (!rev.propFwd || rev.propFwd.notes.includes('前面有东西挡着，下车把它拖开')), rev);

    // ⑫ 斜放的地牛、通道里歪着的纸箱：按真实形状（OBB）挡车，偏心 0.3–0.6 m 开过去，被挡住时离真实形状 ≤5 cm、不停在空地上
    const tiltRows = await ev(page, () => {
      const T = __side.list(['jack', 'carton']).filter(__side.tilted).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 16) - Math.hypot(b.cx - 16, b.cz - 16)).slice(0, 6);
      return __side.shapeRuns(T, [0.3, -0.3, 0.45, -0.45, 0.6, -0.6]);
    });
    if (!tiltRows.length) info('S12 出生点附近没有斜放的地牛 / 纸箱，跳过');
    else {
      const cT = tiltRows.reduce((s, r) => s + r.contact, 0);
      check('S12 斜放的地牛 / 纸箱（' + tiltRows.length + ' 个，' + tiltRows.reduce((s, r) => s + r.tries, 0) + ' 趟）：偏心 0.3–0.6 m 全速开过去，被挡住时都贴着真实形状或别的东西（≤5 cm），没有停在空地上；压进去都 <1 cm；贴着真实形状停下 ' + cT + ' 次',
        tiltRows.every(r => r.air.length === 0 && r.pen.length === 0) && cT >= 2, tiltRows);
    }
    // ⑫c 斜放的地牛（FE1 返修 r3 裁定 ⑦）：地牛脚下那块 1 m 见方、轴对齐的老碰撞体（人照旧被它挡）车不再理，按地牛的真实形状挡 ——
    // 正对、偏心 0.3 / 0.6 m 从 4 个方向全速开过去，停下时都贴着地牛（它的叉腿或泵体，≤5 cm），没有一趟停在离地牛一拃远的空地上；
    // 压进地牛的真实形状都 <1 cm（那块老碰撞体车会压进去，不算）
    const jackRows = await ev(page, () => {
      const seen = [], T = [];
      const all = __side.list(['jack']).filter(__side.tilted).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 16) - Math.hypot(b.cx - 16, b.cz - 16));
      for (const e of all) { if (!Array.isArray(e.solid) || seen.some(s => __side.sameSolid(s, e.solid))) continue; seen.push(e.solid); T.push(e); if (T.length >= 4) break; }
      return __side.shapeRuns(T, [0, 0.3, -0.3, 0.6, -0.6]);
    });
    if (!jackRows.length) check('S12c 出生点周围找到斜放的地牛（种子 ' + SEED + '）', false);
    else {
      const cJ = jackRows.reduce((s, r) => s + r.contact, 0), tJ = jackRows.reduce((s, r) => s + r.tries, 0);
      check('S12c 斜放的地牛（' + jackRows.length + ' 台，' + tJ + ' 趟）：撞上时都贴着地牛的真实形状（≤5 cm）停下 ' + cJ + ' 次，没有停在离它 5 cm 以外的空地上（老碰撞体不再挡车）；压进地牛 <1 cm',
        jackRows.every(r => r.air.length === 0 && r.pen.length === 0 && r.contact >= 1) && cJ >= jackRows.length * 4, jackRows);
    }
    // ⑫d 货叉放到底、叉上两只罐头，全速撞斜放的地牛（FE1 返修 r4）：车和甩出去的罐头都按地牛的真实形状挡，可地牛脚下那块 1 m 老碰撞体
    // 人和准心照旧被它挡 —— 罐头不许落进那块老碰撞体（落进去人走不过去、准心也够不着）。每只罐头：要么还在叉上，要么落在老碰撞体外面的地上，
    // 而且站在它 1.1 m 外准心对准它能「空格 拾取」；甩出去的每一帧不穿东西
    {
      const k = await ev(page, () => __fk.spawnKey());
      const jt = await ev(page, () => {
        const seen = [], T = [];
        const all = __side.list(['jack']).filter(__side.tilted).sort((a, b) => Math.hypot(a.cx - 16, a.cz - 16) - Math.hypot(b.cx - 16, b.cz - 16));
        for (const e of all) { if (!Array.isArray(e.solid) || seen.some(s => __side.sameSolid(s, e.solid))) continue; seen.push(e.solid); T.push(e); if (T.length >= 2) break; }
        return T;
      });
      const rows = [];
      let n = 0;
      for (const J of jt) {
        const sib = await ev(page, J => __side.list(['jack']).filter(q => __side.sameSolid(q.solid, J.solid)), J);
        for (const tgt of sib) {
          const lane = await ev(page, e => { const l = __side.lane(e, { runs: [3, 2.5], offs: [0, 0.2, -0.2, 0.35, -0.35] }); __side.drop(); return l ? { x: l.x, z: l.z, yaw: l.yaw, off: l.off } : null; }, tgt);
          if (!lane) { rows.push({ jack: J.solid, entry: [tgt.minY, tgt.maxY], lane: null }); continue; }
          const ids = ['s12d-' + n + 'a', 's12d-' + n + 'b']; n++;
          const run = await ev(page, a => {
            for (const id of (BR.vehicles.debugInfo().riders[a.k] || [])) BR.items.remove(id);
            for (const p of BR.items.list.slice()) if (/^s12d-/.test(p.id)) BR.items.remove(p.id);
            __fk.place(a.k, a.l.x, a.l.z, a.l.yaw, 0); __br.step(0.1);
            const ok = [__fk.putOnFork(a.k, a.ids[0], 'canned_food', -0.28, -1.95), __fk.putOnFork(a.k, a.ids[1], 'canned_food', 0.28, -1.95)];
            __br.step(0.1);
            const f = __fk.fwd(a.l.yaw);
            BR.player.reset({ x: a.l.x - f.x * 7, y: 0, z: a.l.z - f.z * 7, yaw: a.l.yaw }, { full: false });
            __fk.clear();
            const n0 = BR.vehicles.debugInfo().throws.length;
            const d = __fk.drive(a.k, { throttle: 1, steer: 0, lift: 0 }, 6, { untilStop: true });
            const bad = [];
            for (let i = 0; i < 50; i++) { __br.step(1 / 30); bad.push(...__fk.fallBad(a.k, a.ids)); }
            const t = BR.vehicles.debugInfo().throws, last = t.length > n0 ? t[t.length - 1] : null, S = a.S;
            const riders = BR.vehicles.debugInfo().riders[a.k] || [];
            const st = a.ids.map(id => {
              const p = BR.items.find(id);
              if (!p) return { id, gone: true };
              const r = __fk.foot(p), qx = Math.max(S[0], Math.min(S[3], p.x)), qz = Math.max(S[2], Math.min(S[5], p.z));
              return { id, x: __fk.r(p.x), y: __fk.r(p.y), z: __fk.r(p.z), onFork: riders.includes(id), still: !!p.still, ground: __fk.r(BR.phys.groundY(p.x, p.z)),
                inSolid: Math.hypot(p.x - qx, p.z - qz) < r };
            });
            return { ok, vmax: __fk.r(d.vmax), v0: last && last.v0, how: last && last.how, bad: bad.slice(0, 6), nbad: bad.length, st };
          }, { k, l: lane, ids, S: J.solid });
          // 能不能捡：在罐头周围 1.1 m 找 16 个方向里人站得下的地方，准心对准它
          for (const c of run.st) {
            if (c.gone || c.onFork) continue;
            c.pick = await ev(page, a => {
              const c = a.c;
              for (let i = 0; i < 16; i++) {
                const ang = i * Math.PI / 8, px = c.x + Math.cos(ang) * 1.1, pz = c.z + Math.sin(ang) * 1.1;
                if (BR.phys.overlapCircle(px, pz, 0.3, BR.phys.groundY(px, pz) + 0.05, 1.6)) continue;
                if (__fk.inCar(a.k, px, 0.5, pz, 0.35)) continue;
                __fk.stand(px, pz, __fk.yawTo(px, pz, c.x, c.z));
                BR.interact.aimAt(c.x, c.y + 0.05, c.z); __br.step(1 / 30); __br.step(1 / 30);
                const cur = __fk.cur(), pr = __fk.prompt();
                if (cur && cur.key === c.id && /拾取/.test(pr)) return { from: [__fk.r(px), __fk.r(pz)], prompt: pr };
              }
              return null;
            }, { k, c });
          }
          rows.push({ jack: J.solid, entry: [tgt.minY, tgt.maxY], lane, run });
        }
      }
      const ran = rows.filter(r => r.run);
      const cans = ran.reduce((a, r) => a.concat(r.run.st), []);
      const thrown = cans.filter(c => !c.gone && !c.onFork);
      check('S12d 货叉放到底、叉上两只罐头，全速撞斜放的地牛（' + jt.length + ' 台，' + ran.length + ' 趟，甩出去 ' + thrown.length + ' 只）：没有一只落进地牛脚下那块老碰撞体，' +
        '落在地上的都能站在 1.1 m 外准心对准「空格 拾取」；甩出去的每一帧不穿东西',
        jt.length >= 1 && ran.length >= 2 && thrown.length >= 2 && ran.every(r => r.run.ok.every(Boolean) && r.run.vmax >= 3 && r.run.nbad === 0) &&
        cans.every(c => !c.gone && (c.onFork || (!c.inSolid && c.still && Math.abs(c.y - c.ground) < 0.01 && !!c.pick))), rows);
      await ev(page, () => { for (const p of BR.items.list.slice()) if (/^s12d-/.test(p.id)) BR.items.remove(p.id); return 0; });
    }
    // ⑤ 远处的区段：施工区（路锥、砂堆）、Level 2 走廊口（管排、笼罩灯）。人挪过去让区块载进来，用独立的模拟车试
    const visit = async (cx, cz) => { await ev(page, a => { BR.player.reset({ x: a.x, y: 0, z: a.z, yaw: 0 }, { full: false }); for (let i = 0; i < 6; i++) __br.step(0.2); return 0; }, { x: cx * 24 + 12, z: cz * 24 + 12 }); };
    // 种子 12345：(3,-2) 一带是衔尾段施工区，(3,1) 有 Level 2 走廊口（找不到就在附近几块里再找）
    let coneDone = false;
    for (const [cx, cz] of [[3, -2], [4, -2], [3, -3], [-5, -5]]) {
      await visit(cx, cz);
      const has = await ev(page, () => __side.list(['cone']).length);
      if (!has) continue;
      for (const kind of ['cone', 'sand']) {
        const list = await ev(page, a => __side.list([a.k]).sort((p, q) => Math.hypot(p.cx - a.x, p.cz - a.z) - Math.hypot(q.cx - a.x, q.cz - a.z)).slice(0, 12), { k: kind, x: cx * 24 + 12, z: cz * 24 + 12 });
        let res = null, tgt = null;
        for (const e of list) { res = await ev(page, e => __side.lane(e), e); if (res) { tgt = e; break; } }
        if (!tgt) { check('S5 ' + kind + '：找到一条能全速撞上去的直道', false, { n: list.length }); continue; }
        const hit = res.r.ev.includes('bang') || res.r.ev.includes('bump');
        check('S5 全速撞' + kind + '（' + tgt.ck + '）：停在它跟前，OBB 压进 sideObs 和碰撞体都 <1 cm，有「咚 / 哐」', res.pen.length === 0 && res.phys.length === 0 && hit && res.r.moved > 0.5,
          { tgt: { kind: tgt.kind, cx: tgt.cx, cz: tgt.cz, r: tgt.r }, lane: { x: res.x, z: res.z, yaw: res.yaw, off: res.off }, r: res.r, pen: res.pen, phys: res.phys });
      }
      // 货叉举在路锥上方（叉底 0.8 m），按住 C：停在锥顶上面，提示「货叉下面有东西」
      const low = await ev(page, () => {
        const G = BR.L1forklift.geo;
        for (const e of __side.list(['cone']).filter(q => q.round)) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const c = Math.cos(yaw), s = Math.sin(yaw), lx = G.tineX[0], lz = (G.forkZ[0] + G.forkZ[1]) / 2;
          // 车放在让左叉中点正好在锥顶上方的位置
          const x = e.cx - (c * lx + s * lz), z = e.cz - (-s * lx + c * lz);
          const lift = (0.8 - (G.forkY || 0.015)) / G.carriageTravel;
          const b0 = __side.boxes(x, z, yaw, lift);
          if (__side.physPen(b0, 0.005).length || __side.pen(b0, 0.001).length) continue;
          __side.make(x, z, yaw, lift);
          const r = __side.run({ throttle: 0, steer: 0, lift: -1 }, 3, false);
          const st = __side.sim.poseObj(), b1 = __side.sim.obbsWorld();
          const out = { ck: e.ck, forkBottom: (G.forkY || 0.015) + st.lift * G.carriageTravel, coneTop: e.maxY, notes: r.notes, pen: __side.pen(b1, 0.005) };
          __side.drop();
          return out;
        }
        return null;
      });
      check('S6 货叉举在路锥上方按住 C：叉底停在锥顶上面（0–2 cm），提示「货叉下面有东西」', !!low && low.forkBottom >= low.coneTop - 0.002 && low.forkBottom < low.coneTop + 0.02 && low.notes.includes('货叉下面有东西') && low.pen.length === 0, low);
      // ⑫b 竖圆柱（路锥、砂堆）：按圆挡车，偏心开过去也是贴着圆停下，不在外接方框的角上停住
      const roundRows = await ev(page, a => {
        // 砂堆（r 0.87，没有方底座）最能看出按圆还是按方框挡：先挑它，再挑两个路锥（路锥有方底座，多半是底座先碰上）
        const byD = (p, q) => Math.hypot(p.cx - a.x, p.cz - a.z) - Math.hypot(q.cx - a.x, q.cz - a.z);
        const T = __side.list(['sand', 'shrub']).filter(e => e.round).sort(byD).slice(0, 4).concat(__side.list(['cone']).filter(e => e.round).sort(byD).slice(0, 2));
        // 车身半宽约 0.6：偏心 0.3 m 时车头正面先碰到圆最靠前那一点（圆和外接方框一样）；偏心 半宽 + 0.5r / 0.8r 时是车头的角去碰圆的侧面，
        // 按外接方框算会在离圆 2–35 cm 的地方停住，按圆才贴得上
        const half = Math.max(...BR.L1forklift.geo.obbs(0).map(o => Math.abs(o.cx) + o.hx));
        return __side.shapeRuns(T, e => [0.3, -0.3, half + 0.5 * e.r, -(half + 0.5 * e.r), half + 0.8 * e.r, -(half + 0.8 * e.r)]);
      }, { x: cx * 24 + 12, z: cz * 24 + 12 });
      const cR = roundRows.reduce((s, r) => s + r.contact, 0), cSand = roundRows.filter(r => r.kind !== 'cone').reduce((s, r) => s + r.contact, 0);
      check('S12b 砂堆 / 路锥（' + roundRows.length + ' 个，' + roundRows.reduce((s, r) => s + r.tries, 0) + ' 趟）：正着偏心 0.3 m、车头的角去碰圆的侧面（偏心 半宽 + 0.5r / 0.8r）全速开过去，被挡住时贴着圆（≤5 cm），没有停在空地上；贴着圆停下 ' + cR + ' 次（砂堆 ' + cSand + ' 次）',
        roundRows.length > 0 && roundRows.every(r => r.air.length === 0 && r.pen.length === 0) && cR >= 2 && cSand >= 2, roundRows);
      coneDone = true;
      break;
    }
    if (!coneDone) check('S5 种子 ' + SEED + ' 找到施工区（路锥）', false);
    // Level 2 走廊口：沿走廊中线开进去停在出口圈前（不碰管子），往管子那边偏 0.4 m、往灯那边偏 0.4 m 都被挡住、压进去 <1 cm
    let portalDone = false;
    for (const [cx, cz] of [[3, 1], [-5, -5], [4, 1], [3, 2]]) {
      await visit(cx, cz);
      const P = await ev(page, () => {
        const lamps = __side.list(['lamp']);
        if (!lamps.length) return null;
        const lamp = lamps[0];
        const pipes = __side.list(['pipe']).filter(p => p.ck === lamp.ck && Math.max(p.hx, p.hz) > 3);
        if (!pipes.length) return null;
        const pipe = pipes[0], alongZ = pipe.hz > pipe.hx;
        // 两面墙：管排靠墙那面、笼罩灯靠墙那面
        const pw = alongZ ? (pipe.cx > lamp.cx ? Math.max(...pipes.map(p => p.maxX)) : Math.min(...pipes.map(p => p.minX))) : (pipe.cz > lamp.cz ? Math.max(...pipes.map(p => p.maxZ)) : Math.min(...pipes.map(p => p.minZ)));
        const lw = alongZ ? (pipe.cx > lamp.cx ? lamp.minX : lamp.maxX) : (pipe.cz > lamp.cz ? lamp.minZ : lamp.maxZ);
        const mid = (pw + lw) / 2, toPipe = Math.sign(pw - lw);
        // 走廊里面的方向：出口圈（去 Level 2）在哪头
        const ex = BR.world.chunks().find(c => c.key === lamp.ck).exits.find(e => String(e.to) === '2');
        if (!ex) return null;
        const dirIn = alongZ ? Math.sign(ex.z - pipe.cz) : Math.sign(ex.x - pipe.cx);
        const mouth = alongZ ? (dirIn > 0 ? pipe.minZ + 0.5 : pipe.maxZ - 0.5) : (dirIn > 0 ? pipe.minX + 0.5 : pipe.maxX - 0.5);
        const yaw = alongZ ? (dirIn > 0 ? Math.PI : 0) : (dirIn > 0 ? -Math.PI / 2 : Math.PI / 2);
        const G = BR.L1forklift.geo, tip = Math.min(G.forkZ[0], G.forkZ[1]);
        const runs = [];
        for (const [name, off] of [['中线', 0], ['偏管排 0.4 m', 0.4 * toPipe], ['偏灯 0.4 m', -0.4 * toPipe]]) {
          // 叉尖在走廊口外 2.5 m
          const back = 2.5 - tip;
          const x = alongZ ? mid + off : mouth - dirIn * back, z = alongZ ? mouth - dirIn * back : mid + off;
          const b0 = __side.boxes(x, z, yaw, 0);
          const blocked0 = __side.physPen(b0, 0.005).concat(__side.pen(b0, 0.001));
          if (blocked0.length) { runs.push({ name, start: 'blocked', blocked0 }); continue; }
          __side.make(x, z, yaw, 0);
          const r = __side.run({ throttle: 1, steer: 0, lift: 0 }, 8, true);
          const b1 = __side.sim.obbsWorld();
          const inside = alongZ ? (__side.sim.z - z) * dirIn : (__side.sim.x - x) * dirIn;
          runs.push({ name, moved: +r.moved.toFixed(2), inside: +inside.toFixed(2), notes: r.notes, ev: r.ev.slice(0, 4), pen: __side.pen(b1, 0.01), phys: __side.physPen(b1, 0.01) });
          __side.drop();
        }
        return { ck: lamp.ck, runs };
      });
      if (!P) continue;
      const [c0, cP, cL] = P.runs;
      check('S7 Level 2 走廊口（' + P.ck + '）沿中线开进去：停在出口圈前（「前面是出口」），不碰管子和灯', c0 && c0.pen && c0.pen.length === 0 && c0.phys.length === 0 && c0.notes.includes('前面是出口'), c0);
      check('S8 往管排那边偏 0.4 m 开进去：被管子挡住，OBB 压进管排 <1 cm', cP && cP.pen && cP.pen.length === 0 && cP.phys.length === 0 && cP.moved > 0.3, cP);
      // 笼罩灯在走廊口里 0.3 m、离地 2.05：车头先碰到出口圈（+0.4），护顶到不了灯底下；这里只看不穿进去
      check('S9 往笼罩灯那边偏 0.4 m 开进去：OBB 不压进灯和墙（<1 cm）', cL && cL.pen && cL.pen.length === 0 && cL.phys.length === 0 && cL.moved > 0.3, cL);
      portalDone = true;
      break;
    }
    if (!portalDone) check('S7 种子 ' + SEED + ' 找到 Level 2 走廊口', false);
  } finally {
    await ev(page, () => { if (window.__side) __side.drop(); return 0; }).catch(() => {});
    await releaseAll(page).catch(() => {});
    await ctx.close().catch(() => {});
  }
}

const RUN = { side: gSide, data: gData, mount: gMount, drive: gDrive, crash: gCrash, lift: gLift, items: gItems, exits: gExits, life: gLife, pause: gPause, nightmare: gNightmare, dark: gDark, perf: gPerf };
async function main() {
  const t0 = Date.now();
  const srv = await startServer();
  BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + BASE + '  组：' + GROUPS.join(','));
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    for (const g of GROUPS) {
      GROUP = g;
      OUT = path.join(OUT_BASE, g);
      fs.mkdirSync(OUT, { recursive: true });
      const fn = RUN[g];
      const tg = Date.now();
      console.log('\n----- ' + g + ' -----');
      if (!fn) { check('这一组还没实现', false); continue; }
      try { await fn(browser); }
      catch (err) { check(g + ' 流程没有中断', false, String(err && err.stack || err).slice(0, 1500)); }
      console.log('  (' + g + ' ' + ((Date.now() - tg) / 1000).toFixed(1) + 's)');
      try { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ group: g, ms: Date.now() - tg, checks: data[g] || [], extra: g === 'data' ? data.dataGaps : undefined }, null, 1) + '\n'); } catch (e) { /* 忽略 */ }
    }
  } catch (err) {
    check('测试流程没有中断', false, String(err && err.stack || err).slice(0, 1500));
  }
  // 先出汇总再关浏览器：Chrome 退出后遗留的 crashpad 进程会占着管道，browser.close() 有时要等好几分钟（见 tests/all.mjs）
  for (const e of errors.slice(0, 40)) console.log('ERR ' + e.slice(0, 800));
  console.log('INFO 最慢的 page.evaluate（单次，返修 r6 裁定 ⑥ 要求不超过 60 s）：' + EV_SLOW.map(q => (q.ms / 1000).toFixed(1) + ' s [' + q.group + '] ' + q.fn).join(' ｜ '));
  console.log('\n===== 汇总 =====');
  console.log('检查 ' + (pass + fail) + ' 项，失败 ' + fail + ' 项');
  for (const f of failed) console.log('  FAIL ' + f);
  console.log('页面报错 ' + errors.length + ' 条');
  console.log('耗时 ' + Math.round((Date.now() - t0) / 1000) + 's；数值结果：tests/output/forklift/<组>/result.json');
  const code = fail || errors.length ? 1 : 0;
  await Promise.race([browser.close().catch(() => {}), sleep(10000)]);
  srv.close();
  process.exit(code);
}
main();
