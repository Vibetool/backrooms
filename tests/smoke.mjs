// 后室 · 冒烟测试：node tests/smoke.mjs
// 起本地静态服务（随机端口）+ 无头 Chrome（SwiftShader），按用户定死的规则逐项验证，截图写 tests/output/。
// 任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
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
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
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
  // 机器忙时 SwiftShader 一帧很慢，截图偶尔超过默认 30 s（2026-10-05 返修 r2）：放宽到 60 s 再试一次，还不行只记一笔，不中断流程
  for (let i = 0; i < 2; i++) {
    try {
      await page.screenshot({ path: f, timeout: 60000 });
      shots.push(f);
      console.log('     shot ' + path.relative(ROOT, f));
      return;
    } catch (err) {
      console.log('     shot ' + name + ' 第 ' + (i + 1) + ' 次超时：' + String(err && err.message || err).slice(0, 120));
    }
  }
}

async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  watch(page, tag);
  // 联机信令服务器绝不能打线上
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  return page;
}
async function boot(page, base) {
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);   // 等 GLB 替换兜底人形、主页镜头摆好
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
async function visible(page, sel) { return page.locator(sel).first().isVisible().catch(() => false); }

// 联机面板（N1）：开没开、第一屏有哪些看得见的按钮、有没有模式 / 层级 / 难度这类选项
function lobbyState() {
  const vis = el => {
    if (!el || !el.isConnected) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.hidden) return false;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const l = document.querySelector('.coop-lobby');
  const open = vis(l);
  const t = l && l.querySelector('.coop-title'), sub = l && l.querySelector('.coop-sub');
  return {
    open,
    title: t ? t.textContent.trim() : null,
    sub: sub && vis(sub) ? sub.textContent.trim() : null,
    btns: open ? Array.from(l.querySelectorAll('button')).filter(vis).map(b => b.textContent.trim()) : [],
    inputs: open ? Array.from(l.querySelectorAll('input, select')).filter(vis).map(i => i.type || i.tagName) : [],
    view: BR.coop && BR.coop.debugInfo ? BR.coop.debugInfo().lobby.view : null,
    modal: !!document.querySelector('.home-modal:not([hidden])'),
    state: history.state,
  };
}
// 记下 BR.hud.toast 发出的文字（只装一次）
function hookToasts() {
  if (!window.__smokeToasts) {
    window.__smokeToasts = [];
    const o = BR.hud.toast;
    BR.hud.toast = function (t) { window.__smokeToasts.push(String(t)); return o.apply(this, arguments); };
  }
  window.__smokeToasts.length = 0;
  return 0;
}

// ---------- 页面内工具 ----------
function suitColors() {
  const out = { suit: [], other: {} };
  BR.gfx.scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of arr) {
      if (!m || !m.color) continue;
      const n = m.name || '';
      if (/^Suit(\.\d+)?$/.test(n)) out.suit.push(m.color.getHex());
      else if (n) out.other[n] = m.color.getHex();
    }
  });
  return out;
}
// 程序化防化服（BR.arch.parts.hazmat：坐车队友、窃皮者伪装）和 hazmat.glb 的手套 / 靴子 / 面罩对一对（FE1P H10）。
// 顶点级：制服色（body / head 槽位）的顶点在手套顶面以下的必须都在手套方块里面，在靴口（0.365 m）以下的必须都在靴筒里面；
// 颜色：最终颜色 = 槽位材质色 × 顶点色（线性），换成 sRGB 色阶和 glb 的 Gloves / Boots / Mask 比。
// 形状（返修 FE1Q · repair-r1，用户原话「面具和靴子不能换」）：面罩脸罩（落在脸罩椭球面上的面罩色顶点）、一侧滤罐、一只靴子的包围盒，
// 和 glb 同样取法量出来的比，每一边相差 ≤15%（程序化人形的兜帽大一圈，脸罩整体往前挪了，所以比尺寸不比位置）
function hazmatParity() {
  const A = BR.arch, T = THREE;
  const toS = v => { v = Math.max(0, v); const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(s * 255); };
  const glbM = {};
  const g = BR.assets.modelSync('hazmat');
  if (g) g.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.name && m.color) glbM[m.name.replace(/\.\d+$/, '')] = [m.color.r, m.color.g, m.color.b]; });
  const glbS = {};
  for (const k in glbM) glbS[k] = glbM[k].map(toS);
  const dS = (rgb, name) => (glbS[name] ? Math.max.apply(null, rgb.map((v, i) => Math.abs(toS(v) - glbS[name][i]))) : 99);
  // glb 同样取法：面罩脸罩 = Mask 材质里落在脸罩椭球面上（tools/blender_hazmat.py：中心 (0, 1.615, −0.078)、半径 0.098 / 0.118 / 0.075，±4%）的顶点
  // （头带、镜框胶条、呼气阀不在椭球面上，不算）；一侧滤罐 = Filter 材质 x > 0.03（下巴呼气阀上那片不算）；
  // 一只靴子 = Boots 材质 x > 0（模型根坐标，高 1.8 m、面朝 −z，和程序化人形一样）
  const glbShape = { mask: null, filter: null, boot: null };
  if (g) {
    g.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(g.matrixWorld).invert(), q = new T.Vector3();
    const B = { Mask: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], Filter: null, Boots: null };
    B.Filter = B.Mask.slice(); B.Boots = B.Mask.slice();
    g.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material], P2 = o.geometry.attributes.position, I2 = o.geometry.index;
      const grs = o.geometry.groups && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: I2 ? I2.count : P2.count, materialIndex: 0 }];
      for (const gr of grs) {
        const nm = (mats[gr.materialIndex] && mats[gr.materialIndex].name || '').replace(/\.\d+$/, '');
        if (!B[nm]) continue;
        for (let i = gr.start; i < gr.start + gr.count; i++) {
          q.fromBufferAttribute(P2, I2 ? I2.getX(i) : i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          if (nm === 'Mask' && !(Math.abs(Math.hypot(q.x / 0.098, (q.y - 1.615) / 0.118, (q.z + 0.078) / 0.075) - 1) < 0.04)) continue;
          if (nm === 'Filter' && !(q.x > 0.03)) continue;
          if (nm === 'Boots' && !(q.x > 0)) continue;
          const b2 = B[nm]; for (let a = 0; a < 3; a++) { b2[a] = Math.min(b2[a], q.getComponent(a)); b2[a + 3] = Math.max(b2[a + 3], q.getComponent(a)); }
        }
      }
    });
    const sz = b2 => (b2[0] === Infinity ? null : [0, 1, 2].map(a => +(b2[a + 3] - b2[a]).toFixed(4)));
    glbShape.mask = sz(B.Mask); glbShape.filter = sz(B.Filter); glbShape.boot = sz(B.Boots);
  }
  const lin = h => { const c = new T.Color().setHex(h); const cm = T.ColorManagement; if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear(); return c; };
  const rows = [];
  const look = (mesh, who, detail) => {
    const rig = mesh.userData.rig, d = rig.meta.dims, H = d.H, geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index, col = geo.attributes.color, si = geo.attributes.skinIndex;
    // 面罩椭球中心：程序化面罩挪到兜帽前面 (0, 1.6, −0.135)；坐车的（glb 那版，repair-r4 起兜帽、面罩都是 glb 原样）在 glb 的位置 (0, 1.615, −0.078)
    const gi0 = A.hzGlbInfo ? A.hzGlbInfo() : null, MC = /hazmat_seat_v9g$/.test(String(rig.key || '')) ? [0, 1.615 + (gi0 ? gi0.headDy || 0 : 0), -0.078] : [0, 1.6, -0.135];
    const slotOf = new Array(pos.count).fill(null), matOf = new Array(pos.count).fill(null);
    for (const gr of geo.groups) for (let i = gr.start; i < gr.start + gr.count; i++) { const v = idx ? idx.getX(i) : i; slotOf[v] = rig.slots[gr.materialIndex]; matOf[v] = mesh.material[gr.materialIndex]; }
    const name = i => rig.list[si.getX(i)].name;
    const gw = (0.035 * H * 1.35 + 0.01) / 2, gh = 0.03 * H, gd = (0.05 * H * 1.35 + 0.01) / 2, gy = d.handY - 0.005 * H;
    const inGlove = v => Math.abs(Math.abs(v.x) - d.shoulderW) <= gw + 1e-4 && Math.abs(v.y - gy) <= gh + 1e-4 && Math.abs(v.z) <= gd + 1e-4;
    // 靴筒：小腿中线上 y 0.05 → 0.365 的圆台（半径 6.6 → 8 cm，中心 z −0.005 → 0），按 8 段的边心距算（低画质 8 段、高画质 10 段）
    const BOOT_TOP = 0.365, inBoot = v => {
      if (v.y > BOOT_TOP + 1e-4 || v.y < -1e-4) return false;
      const k = Math.max(0, Math.min(1, (v.y - 0.05) / 0.315)), r = (0.066 + 0.014 * k) * Math.cos(Math.PI / 8), zc = -0.005 * (1 - k);
      return Math.hypot(Math.abs(v.x) - d.hipW, v.z - zc) <= r + 1e-4;
    };
    const fin = i => { const c = matOf[i].color; const t = col ? [col.getX(i), col.getY(i), col.getZ(i)] : [1, 1, 1]; return [c.r * t[0], c.g * t[1], c.b * t[2]]; };
    let suitOutGlove = 0, suitOutBoot = 0, gloveN = 0, bootN = 0, glove = null, boot = null, mask = null;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const s = slotOf[i], b = name(i);
      if (s === 'body' || s === 'head') {
        if (/^fore/.test(b) && v.y < gy + gh - 1e-4 && !inGlove(v)) suitOutGlove++;
        if (/^shin/.test(b) && v.y < BOOT_TOP - 1e-4 && !inBoot(v)) suitOutBoot++;
        continue;
      }
      if (s !== 'gear') continue;
      // 手套：前臂骨骼上、手套方块里（含手指：手套方块下面那一截）；靴子：小腿骨骼上、离地 6 cm 以下
      if (/^fore/.test(b) && v.y < gy - gh * 0.5) { gloveN++; glove = glove || fin(i); }
      if (/^shin/.test(b) && v.y < 0.06) { bootN++; boot = boot || fin(i); }
    }
    // 面罩（repair-r1 起是照 glb 的椭球脸罩）：头骨骼、gear 槽位里脸罩椭球的底极点（中心 (0, 1.6, −0.135)、竖半径 0.118）
    {
      let best = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (slotOf[i] !== 'gear' || name(i) !== 'head') continue;
        v.fromBufferAttribute(pos, i);
        const dd = Math.hypot(v.x, v.y - (MC[1] - 0.118), v.z - MC[2]);
        if (dd < best) { best = dd; mask = fin(i); }
      }
    }
    // 滤罐（FE1Q J7；repair-r1 起高低画质都是两侧各一个圆滤罐）：滤罐圆柱外端端盖的圆心顶点（头骨骼、gear 槽位，离那一点 <0.1 mm）——
    // 椭球（半径 0.098 / 0.118 / 0.075）上方位 1.2、仰角 −0.3 那一点顺着外法线往外 5 cm
    let filter = null, filterAt = null;
    {
      const R = [0.098, 0.118, 0.075], th = 1.2, ph = -0.3, dv = [Math.sin(th) * Math.cos(ph), Math.sin(ph), -Math.cos(th) * Math.cos(ph)];
      const nn = [dv[0] / R[0], dv[1] / R[1], dv[2] / R[2]], nl = Math.hypot(nn[0], nn[1], nn[2]);
      const tip = [R[0] * dv[0] + nn[0] / nl * 0.05, MC[1] + R[1] * dv[1] + nn[1] / nl * 0.05, MC[2] + R[2] * dv[2] + nn[2] / nl * 0.05];
      let best = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (slotOf[i] !== 'gear' || name(i) !== 'head') continue;
        v.fromBufferAttribute(pos, i);
        const dd = Math.hypot(Math.abs(v.x) - tip[0], v.y - tip[1], v.z - tip[2]);
        if (dd < best) { best = dd; if (dd < 1e-4) filter = fin(i); }
      }
      filterAt = +best.toFixed(6);
      // 坐车的面罩 repair-r3 起直接用 glb 的面罩件（滤罐是 glb 那只又短又粗、带加强筋的罐子，外端是金属端盖，没有程序化那个端面圆心顶点）：
      // 改量罐身侧面 —— 轴上往外 3.7 cm 那一点再往上 4.4 cm（glb 罐身半径 4.3 cm、加强筋 4.6 cm），离它 ≤1 cm 最近的那个顶点
      if (!filter) {
        const nx = nn[0] / nl, ny = nn[1] / nl, nz = nn[2] / nl, ux0 = -ny * nx, uy0 = 1 - ny * ny, uz0 = -ny * nz, ul = Math.hypot(ux0, uy0, uz0);
        const side = [R[0] * dv[0] + nx * 0.037 + ux0 / ul * 0.044, MC[1] + R[1] * dv[1] + ny * 0.037 + uy0 / ul * 0.044, MC[2] + R[2] * dv[2] + nz * 0.037 + uz0 / ul * 0.044];
        let b2 = 0.01;
        for (let i = 0; i < pos.count; i++) {
          if (slotOf[i] !== 'gear' || name(i) !== 'head') continue;
          v.fromBufferAttribute(pos, i);
          const dd = Math.hypot(Math.abs(v.x) - side[0], v.y - side[1], v.z - side[2]);
          if (dd < b2) { b2 = dd; filter = fin(i); filterAt = 'side ' + dd.toFixed(4); }
        }
      }
    }
    // 形状（repair-r1）：按最终颜色认件（离 glb 的 Mask / Filter / Boots 色 sRGB ≤2 色阶），量包围盒
    const shape = { mask: null, filter: null, boot: null };
    {
      const bb = () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], add = (b2, p) => { for (let a = 0; a < 3; a++) { b2[a] = Math.min(b2[a], p[a]); b2[a + 3] = Math.max(b2[a + 3], p[a]); } };
      const M = bb(), Fi = bb(), Bo = bb();
      for (let i = 0; i < pos.count; i++) {
        if (slotOf[i] !== 'gear') continue;
        v.fromBufferAttribute(pos, i);
        const b = name(i), c = fin(i), p = [v.x, v.y, v.z];
        if (b === 'head' && dS(c, 'Mask') <= 2 && Math.abs(Math.hypot(v.x / 0.098, (v.y - MC[1]) / 0.118, (v.z - MC[2]) / 0.075) - 1) < 0.04) add(M, p);
        if (b === 'head' && v.x > 0.03 && dS(c, 'Filter') <= 2) add(Fi, p);
        if (b === 'shinR' && dS(c, 'Boots') <= 2) add(Bo, p);
      }
      const sz = b2 => (b2[0] === Infinity ? null : [0, 1, 2].map(a => +(b2[a + 3] - b2[a]).toFixed(4)));
      shape.mask = sz(M); shape.filter = sz(Fi); shape.boot = sz(Bo);
    }
    const r3 = a => a && a.map(x => +x.toFixed(5));
    rows.push({ who, detail, tris: Math.round((idx ? idx.count : pos.count) / 3), suitOutGlove, suitOutBoot, gloveN, bootN, glove: r3(glove), boot: r3(boot), mask: r3(mask), filter: r3(filter), filterAt, shape,
      gloveD: glove ? dS(glove, 'Gloves') : 99, bootD: boot ? dS(boot, 'Boots') : 99, maskD: mask ? dS(mask, 'Mask') : 99, filterD: filter ? dS(filter, 'Filter') : 99 });
  };
  // ---------- 坐车人形和 hazmat.glb 比（FE1R repair-r4 主会话 L2：以前只拿 HAZ_SRGB 自己的颜色比自己，退回程序化面罩、靴口白条都测不出来）----------
  // (a) glb 已载入时坐车人形必须用 glb 那一版：几何缓存键 hazmat_seat_v9g，BR.arch.hzGlbInfo() 给得出从 glb 挑的顶点；
  // (b) 形状（头骨骼上的件，基础姿势 = 站姿，模型坐标）：一侧滤罐（Filter 色、x > 0.03）的轴（拟合：使各顶点到轴的距离方差最小的方向）和 glb 夹角 ≤10°；
  //     目镜（Visor 色）三角形正面投影（x, y，各自按脸罩椭球那一圈的包围盒中心对齐，1 mm 一格）和 glb 的 IoU ≥0.9；
  // (c) 颜色和位置：上臂 / 前臂 / 小腿反光带（四肢骨骼上的浅色顶点）和 glb 的 Metal 色差 ≤6、中心高度差 ≤2 cm；
  //     靴口胶带（小腿骨骼、0.33–0.41 m、离小腿中线 ≥7.5 cm 的顶点）和 glb 的 Tape 色差 ≤6、中心高度差 ≤2 cm；兜帽（头骨骼上 head 槽位的顶点）宽和 glb 兜帽差 ≤1 cm；
  //     四肢外侧的黑压胶条（胳膊、腿骨骼上 Tape 色的顶点）有
  const seatVsGlb = (mesh) => {
    const out = { key: String(mesh.userData.rig.key || ''), info: A.hzGlbInfo ? A.hzGlbInfo() : null };
    if (!g) return out;
    // glb：按材质收顶点（模型坐标）和三角形
    const GV = {}, GT = {};
    const inv = new T.Matrix4().copy(g.matrixWorld).invert(), q = new T.Vector3();
    g.traverse(o => {
      if (!o.isMesh) return;
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material, nm = String(m0 && m0.name || '').replace(/\.\d+$/, '');
      const P2 = o.geometry.attributes.position, I2 = o.geometry.index, n = I2 ? I2.count : P2.count, M = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const vs = GV[nm] = GV[nm] || [], ts = GT[nm] = GT[nm] || [], seen = new Set();
      for (let i = 0; i < n; i += 3) {
        const t = [];
        for (let j = 0; j < 3; j++) {
          q.fromBufferAttribute(P2, I2 ? I2.getX(i + j) : i + j).applyMatrix4(M); t.push([q.x, q.y, q.z]);
          const k = Math.round(q.x * 1e4) + ',' + Math.round(q.y * 1e4) + ',' + Math.round(q.z * 1e4);   // 顶点去重（和坐车人形的顶点一样一个位置算一次）
          if (!seen.has(k)) { seen.add(k); vs.push([q.x, q.y, q.z]); }
        }
        ts.push(t);
      }
    });
    // 坐车人形：每个顶点的槽位、骨骼、最终颜色
    const rig = mesh.userData.rig, d = rig.meta.dims, geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index, col = geo.attributes.color, si = geo.attributes.skinIndex;
    const slotOf = new Array(pos.count).fill(null), matOf = new Array(pos.count).fill(null);
    for (const gr of geo.groups) for (let i = gr.start; i < gr.start + gr.count; i++) { const v = idx ? idx.getX(i) : i; slotOf[v] = rig.slots[gr.materialIndex]; matOf[v] = mesh.material[gr.materialIndex]; }
    const fin = i => { const c = matOf[i].color; const t = col ? [col.getX(i), col.getY(i), col.getZ(i)] : [1, 1, 1]; return [c.r * t[0], c.g * t[1], c.b * t[2]]; };
    const bone = i => rig.list[si.getX(i)].name, P = i => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const SV = []; for (let i = 0; i < pos.count; i++) SV.push({ i, p: P(i), slot: slotOf[i], bone: bone(i), c: slotOf[i] === 'gear' ? fin(i) : null });
    const gearOf = (bn, test) => SV.filter(v => v.slot === 'gear' && (!bn || bn.test(v.bone)) && test(v));
    // (b) 滤罐轴：滤罐是又短又粗的圆罐（直径 9 cm、长 4–6 cm），顶点沿轴向散得最开的那个方向最窄 —— 取投影方差最小的方向（半球上 4000 个方向里挑）
    const axisFit = pts => {
      if (pts.length < 8) return null;
      const c = [0, 1, 2].map(a => pts.reduce((s2, p) => s2 + p[a], 0) / pts.length);
      let best = null, bv = Infinity;
      for (let i = 0; i < 4000; i++) {
        const zz = 1 - (i + 0.5) / 4000, rr = Math.sqrt(1 - zz * zz), ph = i * 2.399963229728653, dv = [rr * Math.cos(ph), rr * Math.sin(ph), zz];   // 半球上均匀撒点（斐波那契）
        let s2 = 0;
        for (const p of pts) { const t = (p[0] - c[0]) * dv[0] + (p[1] - c[1]) * dv[1] + (p[2] - c[2]) * dv[2]; s2 += t * t; }
        if (s2 < bv) { bv = s2; best = dv; }
      }
      return best;
    };
    const gFil = (GV.Filter || []).filter(p => p[0] > 0.03 && p[1] > 1.45);
    const uniq = pts => { const m2 = new Map(); for (const p of pts) m2.set(p.map(x => Math.round(x * 1e4)).join(','), p); return Array.from(m2.values()); };
    const sFil = uniq(gearOf(/^head$/, v => v.p[0] > 0.03 && dS(v.c, 'Filter') <= 2).map(v => v.p));
    const ag = axisFit(gFil), as = axisFit(sFil);
    out.filterAxisDeg = ag && as ? +(Math.acos(Math.min(1, Math.abs(ag[0] * as[0] + ag[1] * as[1] + ag[2] * as[2]))) * 180 / Math.PI).toFixed(2) : null;
    out.filterN = [gFil.length, sFil.length];
    // (b) 目镜正面投影 IoU（各自按脸罩椭球那一圈的包围盒中心对齐）
    const faceCtr = (pts, mc) => { const b2 = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) if (Math.abs(Math.hypot(p[0] / 0.098, (p[1] - mc[1]) / 0.118, (p[2] - mc[2]) / 0.075) - 1) < 0.04) { b2[0] = Math.min(b2[0], p[0]); b2[1] = Math.min(b2[1], p[1]); b2[2] = Math.max(b2[2], p[0]); b2[3] = Math.max(b2[3], p[1]); } return b2[0] === Infinity ? null : [(b2[0] + b2[2]) / 2, (b2[1] + b2[3]) / 2]; };
    const sMC = /hazmat_seat_v9g$/.test(out.key) ? [0, 1.615 + (out.info ? out.info.headDy || 0 : 0), -0.078] : [0, 1.6, -0.135];
    const gC = faceCtr(GV.Mask || [], [0, 1.615, -0.078]), sC = faceCtr(gearOf(/^head$/, v => dS(v.c, 'Mask') <= 2).map(v => v.p), sMC);
    const sVisT = [];
    if (idx) for (let t = 0; t < idx.count; t += 3) { const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]; if (a.every(k => SV[k].slot === 'gear' && SV[k].bone === 'head' && dS(SV[k].c, 'Visor') <= 2)) sVisT.push(a.map(k => SV[k].p)); }
    const raster = (tris, c0) => {
      const S2 = new Set();
      for (const t of tris) {
        const p = t.map(v => [Math.round((v[0] - c0[0]) * 1000), Math.round((v[1] - c0[1]) * 1000)]);
        const x0 = Math.min(p[0][0], p[1][0], p[2][0]), x1 = Math.max(p[0][0], p[1][0], p[2][0]), y0 = Math.min(p[0][1], p[1][1], p[2][1]), y1 = Math.max(p[0][1], p[1][1], p[2][1]);
        const ar = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
        if (Math.abs(ar) < 1e-9) continue;
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const w0 = ((p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y)) / ar, w1 = ((p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y)) / ar;
          if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) S2.add(x + ',' + y);
        }
      }
      return S2;
    };
    if (gC && sC && sVisT.length) {
      const A2 = raster(GT.Visor || [], gC), B2 = raster(sVisT, sC); let inter = 0; for (const k of A2) if (B2.has(k)) inter++;
      out.visorIoU = +(inter / (A2.size + B2.size - inter)).toFixed(3);
    } else out.visorIoU = null;
    // (c) 反光带：颜色、中心高度（模型坐标，基础姿势）
    const bandG = (x0, y0, y1) => { const b2 = [Infinity, -Infinity]; for (const p of GV.Metal || []) if (p[0] > x0 && p[1] > y0 && p[1] < y1) { b2[0] = Math.min(b2[0], p[1]); b2[1] = Math.max(b2[1], p[1]); } return b2[0] === Infinity ? null : (b2[0] + b2[1]) / 2; };
    const lum = c => Math.max(toS(c[0]), toS(c[1]), toS(c[2]));
    const bandS = (bn, y0, y1) => { const vs = gearOf(bn, v => v.p[1] > y0 && v.p[1] < y1 && lum(v.c) > 120); if (!vs.length) return null; let lo = Infinity, hi2 = -Infinity, dmax = 0; for (const v of vs) { lo = Math.min(lo, v.p[1]); hi2 = Math.max(hi2, v.p[1]); dmax = Math.max(dmax, dS(v.c, 'Metal')); } return { y: (lo + hi2) / 2, d: dmax, n: vs.length }; };
    out.bands = {};
    for (const [k, bn, x0, y0, y1] of [['arm', /^armR$/, 0.15, 1.15, 1.4], ['fore', /^foreR$/, 0.2, 0.95, 1.12], ['shin', /^shinR$/, 0.03, 0.4, 0.56]]) {
      const gy = bandG(x0, y0, y1), sb2 = bandS(bn, y0, y1);
      out.bands[k] = { glbY: gy == null ? null : +gy.toFixed(4), seatY: sb2 ? +sb2.y.toFixed(4) : null, dy: gy != null && sb2 ? +Math.abs(gy - sb2.y).toFixed(4) : null, colorD: sb2 ? sb2.d : 99, n: sb2 ? sb2.n : 0 };
    }
    // (c) 靴口胶带
    {
      const gb = [Infinity, -Infinity]; for (const p of GV.Tape || []) if (p[0] > 0 && p[1] > 0.33 && p[1] < 0.41) { gb[0] = Math.min(gb[0], p[1]); gb[1] = Math.max(gb[1], p[1]); }
      const vs = gearOf(/^shinR$/, v => v.p[1] > 0.33 && v.p[1] < 0.41 && Math.hypot(v.p[0] - d.hipW, v.p[2]) >= 0.075);
      let lo = Infinity, hi2 = -Infinity, dmax = 0; for (const v of vs) { lo = Math.min(lo, v.p[1]); hi2 = Math.max(hi2, v.p[1]); dmax = Math.max(dmax, dS(v.c, 'Tape')); }
      out.cuff = { glbY: +((gb[0] + gb[1]) / 2).toFixed(4), seatY: vs.length ? +((lo + hi2) / 2).toFixed(4) : null, colorD: vs.length ? dmax : 99, n: vs.length };
      out.cuff.dy = out.cuff.seatY == null ? null : +Math.abs(out.cuff.glbY - out.cuff.seatY).toFixed(4);
    }
    // (c) 兜帽宽
    {
      // 兜帽 = 1.55 m 以上的制服色（glb 躯干顶到 1.517，肩膀、胳膊更低）
      const gw = [Infinity, -Infinity]; for (const p of GV.Suit || []) if (p[1] > 1.55) { gw[0] = Math.min(gw[0], p[0]); gw[1] = Math.max(gw[1], p[0]); }
      const sw2 = [Infinity, -Infinity]; for (const v of SV) if ((v.slot === 'head' || v.slot === 'body') && v.bone === 'head' && v.p[1] > 1.55) { sw2[0] = Math.min(sw2[0], v.p[0]); sw2[1] = Math.max(sw2[1], v.p[0]); }
      out.hood = { glbW: +(gw[1] - gw[0]).toFixed(4), seatW: +(sw2[1] - sw2[0]).toFixed(4) }; out.hood.dw = +Math.abs(out.hood.glbW - out.hood.seatW).toFixed(4);
    }
    // 四肢外侧的黑压胶条
    out.seams = { arm: gearOf(/^(arm|fore)R$/, v => dS(v.c, 'Tape') <= 3 && v.p[0] > d.shoulderW + 0.03).length, leg: gearOf(/^(leg|shin)R$/, v => dS(v.c, 'Tape') <= 3 && v.p[0] > d.hipW + 0.05 && v.p[1] > 0.42).length };
    // 躯干不拆两截（返修 FE1R · repair-r5，验收员 play：repair-r4 在脊柱转轴处拆成上下两截、叠 11 cm，坐着前倾后后腰露出一个平顶台阶）：
    // 跟着胯 / 脊柱的顶点里，同一个位置（0.1 mm）上的顶点蒙皮权重都一样（拆两截时同一处有一份挂胯、一份挂脊柱）；腰带上沿到胸口之间有按高度渐变的权重
    {
      const sw = geo.attributes.skinWeight, bi = n => rig.list.findIndex(b => b.name === n), hI = bi('hips'), sI = bi('spine'), byPos = new Map();
      let blended = 0, dup = 0, n = 0;
      const wOf = i => { let w = 0; for (let j = 0; j < 4; j++) { const b = j === 0 ? si.getX(i) : j === 1 ? si.getY(i) : j === 2 ? si.getZ(i) : si.getW(i), ww = j === 0 ? sw.getX(i) : j === 1 ? sw.getY(i) : j === 2 ? sw.getZ(i) : sw.getW(i); if (b === sI) w += ww; } return w; };
      for (let i = 0; i < pos.count; i++) {
        const b0 = si.getX(i); if (b0 !== hI && b0 !== sI) continue;
        if (slotOf[i] !== 'body' && slotOf[i] !== 'gear') continue;
        n++;
        const w = wOf(i); if (w > 0.02 && w < 0.98) blended++;
        const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
        const prev = byPos.get(k);
        if (prev == null) byPos.set(k, w); else if (Math.abs(prev - w) > 1e-3) dup++;
      }
      out.torsoSeam = { n, blended, splitDup: dup };
    }
    return out;
  };
  const linSkin = k => lin(BR.skin.color(k)).getHex();
  const seatGlb = seatVsGlb(A.parts.hazmat(null, { color: linSkin('blue'), seat: true }));
  // 坐车人形（FE1R K7）不分画质，一律是 seat 版（高画质那一套细节、更圆的段数）；伪装照旧分高低两档
  look(A.parts.hazmat(null, { color: linSkin('blue'), seat: true }), 'seat', 'seat');
  for (const detail of ['high', 'low']) look(A.parts.hazmat(null, { detail }), 'mimic', detail);
  // 换皮肤只换制服：坐车版、低档各比一次（低档 FE1Q J7 起也带顶点色，gear 槽位同一份 vc 材质、同一份几何的颜色）
  const skinSwap = {};
  for (const detail of ['seat', 'low']) {
    const o = c => (detail === 'seat' ? { color: c, seat: true } : { color: c, detail });
    const p = A.parts.hazmat(null, o(linSkin('pink'))), b = A.parts.hazmat(null, o(linSkin('blue')));
    const gi = p.userData.rig.slots.indexOf('gear'), bi = p.userData.rig.slots.indexOf('body');
    skinSwap[detail] = { gearSame: p.material[gi] === b.material[gi] && p.geometry === b.geometry, suitDiff: p.material[bi].color.getHex() !== b.material[bi].color.getHex(),
      pink: p.material[bi].color.getHexString(), blue: b.material[bi].color.getHexString(), gearVc: !!p.material[gi].vertexColors, suitVc: !!p.material[bi].vertexColors };
  }
  skinSwap.gearSame = skinSwap.seat.gearSame && skinSwap.low.gearSame;
  skinSwap.suitDiff = skinSwap.seat.suitDiff && skinSwap.low.suitDiff;
  // 坐车人形的细节件（FE1R K7，用户原话「面具和靴子不能换」：低画质坐车以前换成简版，面罩没有呼气阀、滤罐没有端盖、身上没有反光条、拉链、
  // 腰带、小包）：seat 版不分画质（coop.seatBody 高 / 低两档面数一样），按顶点色认出银色反光条、金属件（滤罐端盖、腰带扣、拉链头），
  // 头骨骼上面罩色的件（脸罩、呼气阀、头带）比低档伪装多；面数不少于高档伪装
  const seatParts = (() => {
    const tintCount = (mesh, want) => {
      const rig = mesh.userData.rig, geo = mesh.geometry, col = geo.attributes.color, si = geo.attributes.skinIndex, idx = geo.index, gi = rig.slots.indexOf('gear');
      const slotOf = new Array(geo.attributes.position.count).fill(-1);
      for (const gr of geo.groups) for (let i = gr.start; i < gr.start + gr.count; i++) slotOf[idx ? idx.getX(i) : i] = gr.materialIndex;
      const out = {}; for (const k in want) out[k] = 0;
      if (!col) return out;
      const mc = mesh.material[gi].color;
      for (let i = 0; i < geo.attributes.position.count; i++) {
        if (slotOf[i] !== gi) continue;
        const c = [mc.r * col.getX(i), mc.g * col.getY(i), mc.b * col.getZ(i)];
        for (const k in want) {
          const near = sr => Math.max.apply(null, c.map((x, j) => Math.abs(toS(x) - sr[j]))) <= 6;
          const ok = want[k].glb ? dS(c, want[k].glb) <= 3 : want[k].any ? want[k].any.some(near) : near(want[k].srgb);
          const bn = rig.list[si.getX(i)].name;
          if (ok && (!want[k].bone || bn === want[k].bone) && (!want[k].boneRe || want[k].boneRe.test(bn))) out[k]++;
        }
      }
      return out;
    };
    // 反光条、金属件按程序化防化服自己的颜色认（_archetypes.js HAZ_SRGB：反光条 #d8dce2、金属 #9aa0a6，sRGB 色阶差 ≤6）；面罩色件按 glb 的 Mask。
    // repair-r3 起坐车的面罩直接用 glb 的面罩件，上面的金属件（滤罐端盖、接嘴、目镜螺钉）是 glb 的 Metal 色 #b9bec4，也算金属件
    // repair-r4（主会话 L1）起坐车人形四肢上的反光带是 glb 的 Metal 色（伪装照旧银白）：refl = 四肢骨骼上银白或 glb Metal 色的顶点
    const want = { tape: { srgb: [0xd8, 0xdc, 0xe2] }, metal: { srgb: [0x9a, 0xa0, 0xa6] }, metalG: { srgb: [0xb9, 0xbe, 0xc4] }, maskHead: { glb: 'Mask', bone: 'head' },
      refl: { any: [[0xd8, 0xdc, 0xe2], [0xb9, 0xbe, 0xc4]], boneRe: /^(arm|fore|shin)[LR]$/ } };
    const seat = A.parts.hazmat(null, { color: linSkin('blue'), seat: true }), hi = A.parts.hazmat(null, { detail: 'high' }), lo = A.parts.hazmat(null, { detail: 'low' });
    const sb = BR.coop && typeof BR.coop.seatBody === 'function' ? [BR.coop.seatBody({ detail: 'high' }), BR.coop.seatBody({ detail: 'low' })] : [null, null];
    const cnt = m2 => { const c = tintCount(m2, want); c.metal += c.metalG; delete c.metalG; return c; };
    return { seat: cnt(seat), high: cnt(hi), low: cnt(lo), tris: { seat: A.trisOf(seat), high: A.trisOf(hi), low: A.trisOf(lo) },
      seatBody: sb.map(x => x && x.tris), glbHas: ['Tape', 'Metal', 'Mask'].every(n => !!glbS[n]) };
  })();
  const m = A.parts.hazmat(null, { detail: 'high' }), mc = m.material[m.userData.rig.slots.indexOf('body')].color, want = lin(BR.skin.color());
  const mimicSuit = { got: mc.getHexString(), want: want.getHexString(), d: Math.max(Math.abs(mc.r - want.r), Math.abs(mc.g - want.g), Math.abs(mc.b - want.b)) * 255 };
  return { glb: glbS, glbS, glbShape, rows, skinSwap, mimicSuit, seatParts, seatGlb };
}
// 坐在叉车驾驶座上的人（coop.seatBody，联机队友坐车同一套摆法，FE1R ACT-seat）：
//   ① 头顶：转头 ±1.5、抬头低头 ±0.6 的整个范围，所有顶点离护顶各件 ≥1 cm —— 横条底面 2.07（|x| ≤ 0.40、z −0.56…0.48）、
//      两侧纵梁和前后横梁底面 2.04（|x| > 0.39 或 z 在横条外）；压进坐垫顶面（1.16）≤1 cm；
//   ② 手握方向盘：后轮转角 0、±0.15、±0.3、±0.5、±0.8、±1.13，手套（前臂骨骼、握拳骨骼上的 gear 顶点）离轮缘中心线 1.5–2.6 cm（贴着轮缘管）、轮缘被手套包着
//      （轮缘最近那一点上下、内外两侧都有手套顶点），三根辐条（3、6、9 点钟）和中心盖插进手套 ≤0.5 cm
function seatPose() {
  const C = BR.coop, G = BR.L1forklift && BR.L1forklift.geo;
  if (!C || typeof C.seatBody !== 'function' || !G) return { ok: false, why: 'no coop / geo' };
  const SW = G.steerWheel, out = { roof: [], cushion: 0, hands: {} };
  for (const hy of [-1.5, -0.75, 0, 0.75, 1.5]) for (const pi of [-0.6, 0, 0.6]) {
    const V = C.seatBody({ headYaw: hy, pitch: pi }).verts;
    let worst = -Infinity, at = null;
    for (let i = 0; i < V.length; i += 3) {
      const x = V[i], y = V[i + 1], z = V[i + 2];
      if (Math.abs(x) > 0.47 || z < -0.63 || z > 0.59) continue;
      const under = Math.abs(x) <= 0.39 && z >= -0.56 && z <= 0.48 ? 2.07 : 2.04;
      if (y - under > worst) { worst = y - under; at = [x, y, z].map(v => +v.toFixed(3)); }
    }
    out.roof.push({ hy, pi, gap: +(-worst).toFixed(4), at });
  }
  const sb0 = C.seatBody({ parts: true });
  for (let i = 0; i < sb0.verts.length; i += 3) { const x = sb0.verts[i], y = sb0.verts[i + 1], z = sb0.verts[i + 2]; if (Math.abs(x) <= 0.25 && z >= 0.02 && z <= 0.46 && y < 1.16 && y > 1.06) out.cushion = Math.max(out.cushion, +(1.16 - y).toFixed(4)); }
  const ca = Math.cos(SW.tilt), sa = Math.sin(SW.tilt), ax = [0, ca, sa], e2 = [0, sa, -ca], rr = SW.r || 0.16, C0 = [SW.x, SW.y, SW.z];
  const segD = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L; t = Math.max(0, Math.min(1, t)); return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]); };
  for (const steer of [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.8, -0.8, 1.13, -1.13]) {
    const sb = C.seatBody({ parts: true, steer }), V = sb.verts, gi = sb.slotNames.indexOf('gear');
    const turn = -steer * (G.steerRatio || 6);
    const dir = a => { const c = Math.cos(a + turn), s = Math.sin(a + turn); return [c, e2[1] * s, e2[2] * s]; };
    const at = (a, r, up) => { const q = dir(a); return [C0[0] + q[0] * r + ax[0] * up, C0[1] + q[1] * r + ax[1] * up, C0[2] + q[2] * r + ax[2] * up]; };
    const spokes = [0, Math.PI, -Math.PI / 2].map(a => [at(a, 0.035, -0.012), at(a, rr - 0.01, 0)]);
    const row = {};
    for (const L of ['L', 'R']) {
      // 手套 = 前臂骨骼和握拳骨骼（grip，repair-r5：手指、拇指挂在它上面）上的 gear 顶点
      const fi = sb.boneNames.indexOf('fore' + L), gi2 = sb.boneNames.indexOf('grip' + L), gl = [];
      for (let i = 0; i < V.length / 3; i++) if (sb.slot[i] === gi && (sb.bone[i] === fi || (gi2 >= 0 && sb.bone[i] === gi2))) gl.push([V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]);
      let best = Infinity, bestA = 0;
      for (let k = 0; k < 360; k++) { const p = at(k * Math.PI / 180, rr, 0); for (const q of gl) { const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < best) { best = d; bestA = k; } } }
      let spk = 0, hub = 0;
      for (const q of gl) {
        for (const [a, b] of spokes) spk = Math.max(spk, 0.009 - segD(q, a, b));
        const rel = [q[0] - C0[0], q[1] - C0[1], q[2] - C0[2]], h = rel[0] * ax[0] + rel[1] * ax[1] + rel[2] * ax[2];
        const rad = Math.hypot(rel[0] - h * ax[0], rel[1] - h * ax[1], rel[2] - h * ax[2]);
        if (h > -0.035 && h < 0.004 && rad < 0.04) hub = Math.max(hub, Math.min(0.04 - rad, h + 0.035, 0.004 - h));
      }
      const p = at(bestA * Math.PI / 180, rr, 0), radial = dir(bestA * Math.PI / 180), tang = [ax[1] * radial[2] - ax[2] * radial[1], ax[2] * radial[0] - ax[0] * radial[2], ax[0] * radial[1] - ax[1] * radial[0]];
      const wrapped = [ax, radial].every(n => { let pos = false, neg = false; for (const q of gl) { const r2 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; if (Math.abs(r2[0] * tang[0] + r2[1] * tang[1] + r2[2] * tang[2]) > 0.03) continue; const sd = r2[0] * n[0] + r2[1] * n[1] + r2[2] * n[2]; if (sd > 0.004) pos = true; if (sd < -0.004) neg = true; } return pos && neg; });
      row[L] = { rim: +best.toFixed(4), wrapped, spoke: +Math.max(0, spk).toFixed(4), hub: +hub.toFixed(4) };
    }
    out.hands[steer] = row;
  }
  out.ok = true;
  return out;
}
function expectedHex(key) {
  const c = new THREE.Color().setHex(BR.skin.color(key));
  const cm = THREE.ColorManagement;
  if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
  return c.getHex();
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  try {
    await desktop(browser, base);
    await mobile(browser, base);
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  console.log('截图 ' + shots.length + ' 张：' + path.relative(ROOT, OUT));
  process.exitCode = failed.length || errors.length ? 1 : 0;
  // 先打汇总再关浏览器（FE1 返修 r5，照 interact.mjs）：Chrome 退出后遗留的进程会占着管道，browser.close() 有时好几分钟都不返回，
  // 以前汇总排在它后面，检查全过了也一直不打印（tests/all.mjs 只能等到超时判失败）。close 最多等 10 s
  await Promise.race([browser.close().catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
  srv.close();
  process.exit(process.exitCode);
}

// =====================================================================
// 桌面 1280×720
// =====================================================================
async function desktop(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await newPage(ctx, 'desktop');
  await boot(page, base);

  // ---------- 主页 ----------
  // ---------- 层级实体/物品表里的 type 都要已注册 ----------
  // 实体代理常把一个实体拆成多个形态 type（arachnid_common、neighborhood_watch_strider……），层级表里还写总名的话
  // world 会静默跳过、一只都不刷，截图和报错里都看不出来，只能在这里逐个对名字
  const tableIssues = await ev(page, () => {
    const out = [];
    for (const lv of BR.levels.all()) {
      for (const e of lv.entities || []) if (e && !BR.entityTypes.has(e.type)) out.push('L' + lv.id + ' 实体 ' + e.type);
      for (const it of lv.items || []) if (it && !BR.itemTypes.has(it.type)) out.push('L' + lv.id + ' 物品 ' + it.type);
    }
    return out;
  });
  check('每个层级 entities / items 表里的 type 都已注册', tableIssues.length === 0, tableIssues);

  // ---------- 程序化防化服（联机队友坐车、窃皮者伪装）和测试人的 hazmat.glb 对齐（FE1P H10） ----------
  const hz = await ev(page, hazmatParity);
  check('防化服 glb 已载入，量得到 Gloves / Boots / Mask / Filter / Suit 五个材质', !!hz.glb && ['Gloves', 'Boots', 'Mask', 'Filter', 'Suit'].every(n => !!hz.glb[n]), hz.glb);
  for (const r of hz.rows || []) {
    // 低画质（FE1Q J7）：gear 槽位材质是手套色，面罩框、滤罐、手套、靴子各按 glb 的颜色上 tint（visualhooks 低档白名单放开了这一项），按裁定色阶差 ≤6
    check('防化服（' + r.who + ' · ' + r.detail + '）：制服色的手掌、手指不包住手套，脚掌不从靴子里伸出来（制服色顶点在手套 / 靴子高度以下的都藏在里面）',
      r.suitOutGlove === 0 && r.suitOutBoot === 0 && r.gloveN > 0 && r.bootN > 0, r);
    const tol = r.detail === 'low' ? 6 : 1;
    check('防化服（' + r.who + ' · ' + r.detail + '）：手套、靴子、面罩、滤罐的颜色和 glb 一样（sRGB 色阶差 ≤' + tol + '）',
      r.gloveD <= tol && r.bootD <= tol && r.maskD <= tol && r.filterD <= tol,
      { glove: r.glove, boot: r.boot, mask: r.mask, filter: r.filter, filterAt: r.filterAt, glb: hz.glbS, gloveD: r.gloveD, bootD: r.bootD, maskD: r.maskD, filterD: r.filterD });
  }
  check('换皮肤只换制服（坐车版、低档）：粉色、蓝色两个人形的手套 / 靴子 / 面罩 / 滤罐材质和几何一模一样，制服色不同', hz.skinSwap && hz.skinSwap.gearSame && hz.skinSwap.suitDiff, hz.skinSwap);
  {
    const sp = hz.seatParts || {}, s = sp.seat || {}, h = sp.high || {}, l = sp.low || {};
    check('坐车的防化服不分画质（FE1R K7，面具和靴子不能换）：coop.seatBody 高 / 低画质面数一样；反光条、金属件（滤罐端盖、腰带扣、拉链头）、头上面罩色的件（呼气阀、头带）都有，不比高档伪装少、比低档伪装多；面数不少于高档伪装',
      !!sp.glbHas && sp.seatBody && sp.seatBody[0] > 0 && sp.seatBody[0] === sp.seatBody[1] && s.refl > 0 && s.metal > 0 && s.refl >= h.refl && s.metal >= h.metal && s.maskHead >= h.maskHead &&
      s.refl > l.refl && s.metal > l.metal && s.maskHead > l.maskHead && sp.tris.seat >= sp.tris.high, sp);
  }
  // 返修 FE1R · repair-r4（主会话 L2）：坐车人形拿 hazmat.glb 当基准比，不再拿 HAZ_SRGB 自己比自己
  {
    const q = hz.seatGlb || {}, B = q.bands || {};
    check('坐车人形（L2 a）：glb 已载入时用 glb 那一版（几何缓存键 hazmat_seat_v9g，BR.arch.hzGlbInfo() 从 glb 挑了头、躯干、靴子的顶点）——退回程序化面罩判失败',
      /hazmat_seat_v9g$/.test(q.key || '') && !!q.info && q.info.head > 0 && q.info.torso > 0 && q.info.boot > 0, { key: q.key, info: q.info });
    // IoU 收到 ≥0.97（裁定原文 ≥0.9）：负对照（hzGlbParts 返回 null，退回照 glb 拼的程序化面罩）量出来是 0.948，0.9 拦不住它
    check('坐车人形（L2 b）：滤罐的轴和 glb 夹角 ≤10°，目镜正面投影（按脸罩对齐）和 glb 的 IoU ≥0.97',
      q.filterAxisDeg != null && q.filterAxisDeg <= 10 && q.visorIoU != null && q.visorIoU >= 0.97, { filterAxisDeg: q.filterAxisDeg, filterN: q.filterN, visorIoU: q.visorIoU });
    const bb = ['arm', 'fore', 'shin'].filter(k => !(B[k] && B[k].n > 0 && B[k].colorD <= 6 && B[k].dy != null && B[k].dy <= 0.02));
    check('坐车人形（L2 c）：上臂、前臂、小腿反光带和 glb 的 Metal 色差 ≤6、中心高度差 ≤2 cm；靴口胶带和 glb 的 Tape 色差 ≤6、高度差 ≤2 cm；兜帽宽和 glb 差 ≤1 cm；四肢外侧有黑压胶条',
      bb.length === 0 && q.cuff && q.cuff.n > 0 && q.cuff.colorD <= 6 && q.cuff.dy <= 0.02 && q.hood && q.hood.dw <= 0.01 && q.seams && q.seams.arm > 0 && q.seams.leg > 0,
      { bad: bb, bands: B, cuff: q.cuff, hood: q.hood, seams: q.seams });
  }
  {
    const q = hz.seatGlb || {}, ts = q.torsoSeam;
    check('坐车人形躯干（repair-r5）：不在会弯的腰上拆成两截 —— 胯 / 脊柱骨骼上同一个位置的顶点蒙皮权重一样（拆两截时同一处挂两根骨骼），腰带上沿到胸口之间按高度渐变',
      !!ts && ts.n > 0 && ts.splitDup === 0 && ts.blended > 50, ts);
  }
  // 返修 FE1Q · repair-r1（验收员 play：队友一坐上车，面罩就从圆脸罩 + 两个圆滤罐变成方块、靴子从圆头高筒靴变成方块）
  {
    const G2 = hz.glbShape || {}, bad = [];
    const near = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 0.15 * b[i]);
    for (const r of hz.rows || []) for (const k of ['mask', 'filter', 'boot']) if (!near(r.shape && r.shape[k], G2[k])) bad.push([r.who + '·' + r.detail, k, r.shape && r.shape[k], G2[k]]);
    check('防化服（坐车 / 伪装 × 高 / 低画质）的面罩脸罩宽高、一侧滤罐、一只靴子的包围盒和 hazmat.glb 每一边相差 ≤15%（面具和靴子不能换）',
      !!G2.mask && !!G2.filter && !!G2.boot && bad.length === 0, bad.length ? bad.slice(0, 6) : { glb: G2, got: (hz.rows || []).map(r => [r.who, r.detail, r.shape]) });
  }
  check('窃皮者伪装（不指定制服色）：制服色 = 当前皮肤按 skin.apply 一样转线性（和测试人 glb 的制服一个颜色）', hz.mimicSuit && hz.mimicSuit.d <= 1, hz.mimicSuit);
  // ---------- 坐在叉车驾驶座上的人（FE1R ACT-seat） ----------
  {
    const sp = await ev(page, seatPose);
    const roofBad = (sp.roof || []).filter(r => !(r.gap >= 0.01));
    check('坐在驾驶座上的人（FE1R ACT-seat）：转头 ±1.5、抬头低头 ±0.6，头顶离护顶横条（底 2.07）、纵梁和前后横梁（底 2.04）都 ≥1 cm；压进坐垫 ≤1 cm',
      !!sp.ok && sp.roof.length === 15 && roofBad.length === 0 && sp.cushion <= 0.01, { roofBad, minGap: sp.roof && Math.min(...sp.roof.map(r => r.gap)), cushion: sp.cushion });
    const hb = [];
    // 返修 FE1R · repair-r5（手套换成握拳、四指绕着轮缘，不再是插进轮缘里的方块）：「包着轮缘」= 轮缘截面四个方向都有手套（wrapped），
    // 手套离轮缘中心线最近的那一点在 1.5–2.6 cm（轮缘管半径 1.6 cm：插进去 ≤1 mm、离开 ≤1 cm）
    for (const st in (sp.hands || {})) for (const L of ['L', 'R']) { const h = sp.hands[st][L]; if (!(h && h.rim >= 0.015 && h.rim <= 0.026 && h.wrapped && h.spoke <= 0.005 && h.hub <= 0.005)) hb.push([st, L, h]); }
    check('坐在驾驶座上的人（FE1R ACT-seat）：双手跟着方向盘转（每 90° 倒一次手），后轮转角 0、±0.15、±0.3、±0.5、±0.8、±1.13 时手套都握着轮缘（四面包住，贴着轮缘管：离中心线 1.5–2.6 cm），辐条、中心盖插进手套 ≤0.5 cm',
      !!sp.ok && Object.keys(sp.hands).length === 11 && hb.length === 0, hb.length ? hb : sp.hands[0]);
  }

  const home0 = await ev(page, () => ({ screen: BR.game.screen, shown: BR.home.shown, skin: BR.skin.current, inputOn: BR.input.enabled }));
  check('主页：启动后停在主页、输入关闭', home0.screen === 'home' && home0.shown && !home0.inputOn, home0);
  check('主页：「游玩」按钮在右下角', await ev(page, () => {
    const r = document.querySelector('.home-play').getBoundingClientRect();
    return r.right > innerWidth * 0.75 && r.bottom > innerHeight * 0.75;
  }));
  await shot(page, 'home');

  // ---------- 点人物 → 色板 → 粉色 ----------
  const before = await ev(page, suitColors);
  check('主页人物有独立的 Suit 材质和其他材质', before.suit.length > 0 && Object.keys(before.other).length >= 3, { suit: before.suit.length, other: Object.keys(before.other) });
  const pt = await ev(page, () => {
    const v = new THREE.Vector3(0, 1.15, 0.1).project(BR.gfx.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  check('点人物弹出色板', await visible(page, '.home-skin'), pt);
  const swatches = await page.$$eval('.home-swatch', els => els.map(e => e.dataset.key));
  check('色板六色：粉蓝黄紫绿红', JSON.stringify(swatches) === JSON.stringify(['pink', 'blue', 'yellow', 'purple', 'green', 'red']), swatches);
  await shot(page, 'skin-panel');
  await page.click('.home-swatch[data-key="pink"]');
  await page.waitForTimeout(150);
  const after = await ev(page, suitColors);
  const pinkHex = await ev(page, expectedHex, 'pink');
  const otherSame = Object.keys(before.other).every(k => before.other[k] === after.other[k]);
  check('换粉色：Suit 材质变成粉色', after.suit.length > 0 && after.suit.every(h => h === pinkHex), { suit: after.suit.map(h => h.toString(16)), want: pinkHex.toString(16) });
  check('换粉色：面具/靴子/手套/胶带等其他材质不变', otherSame, { before: before.other, after: after.other });
  check('换粉色：BR.skin.current / BR.game.skin 同步', await ev(page, () => BR.skin.current === 'pink' && BR.game.skin === 'pink'));
  await shot(page, 'skin-pink');
  await page.click('.home-skin .home-close');
  await page.waitForTimeout(150);

  // ---------- 主页「联机」（N1）：点了出联机面板，第一屏只有昵称框和两个大按钮 ----------
  const net0 = await ev(page, () => {
    const b = document.querySelector('.home-secondary-btn.is-coop');
    return b ? { text: b.textContent.trim(), disabled: b.disabled, title: b.title } : null;
  });
  check('主页有「联机」按钮（可点、不灰）', !!net0 && net0.text === '联机' && !net0.disabled && !net0.title, net0);
  await page.click('.home-secondary-btn.is-coop');
  await page.waitForFunction(() => { const l = document.querySelector('.coop-lobby'); return !!l && !l.hidden; }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const lob = await ev(page, lobbyState);
  check('点「联机」打开联机面板：标题「联机」、副标题「2 人 · 语音默认闭麦」，第一屏是「开一个营地」「加入朋友的营地」',
    lob.open && lob.title === '联机' && lob.sub === '2 人 · 语音默认闭麦' && lob.view === 'start' &&
    lob.btns.includes('开一个营地') && lob.btns.includes('加入朋友的营地'), lob);
  check('联机面板第一屏只有昵称框，没有模式、层级、难度', JSON.stringify(lob.inputs) === '["text"]' && !lob.btns.some(t => /游玩|噩梦|测试|Level|难度/.test(t)), lob);
  await shot(page, 'coop-lobby');
  await page.click('.coop-lobby .coop-close');
  await page.waitForTimeout(400);
  const lob1 = await ev(page, lobbyState);
  check('关掉联机面板回到没有弹层的主页', !lob1.open && !lob1.modal && !(lob1.state && lob1.state.brPanel) && await ev(page, () => BR.home.shown && BR.game.screen === 'home'), lob1);

  // 新旧文件混着用（缓存里还是旧 coop.js）：BR.coop 在、缺营地那一套 → toast「页面没更新完整，请刷新」，不开面板
  await ev(page, hookToasts);
  await ev(page, () => { window.__smokeStartRun = BR.coop.startRun; delete BR.coop.startRun; return 0; });
  let stale;
  try {
    await page.click('.home-secondary-btn.is-coop');
    await page.waitForTimeout(300);
    stale = await ev(page, () => Object.assign({ toasts: window.__smokeToasts.slice(), startRun: typeof BR.coop.startRun }, (() => { const l = document.querySelector('.coop-lobby'); return { lobby: !!l && !l.hidden }; })()));
  } finally {
    await ev(page, () => { if (window.__smokeStartRun) BR.coop.startRun = window.__smokeStartRun; window.__smokeStartRun = null; return 0; });
  }
  check('删掉 BR.coop.startRun 后点「联机」：toast「页面没更新完整，请刷新」，不开联机面板', stale.startRun === 'undefined' && stale.toasts.includes('页面没更新完整，请刷新') && !stale.lobby, stale);
  // 联机模块根本没加载：按钮灰掉，title「联机模块未加载」，点了不报错（随后的 reload 复原）
  await ev(page, () => { window.__smokeCoop = BR.coop; BR.coop = undefined; return 0; });
  let missing;
  try {
    await page.click('.home-secondary-btn.is-coop');
    await page.waitForTimeout(200);
    missing = await ev(page, () => { const b = document.querySelector('.home-secondary-btn.is-coop'); const l = document.querySelector('.coop-lobby'); return { disabled: b.disabled, title: b.title, lobby: !!l && !l.hidden }; });
  } finally {
    await ev(page, () => { BR.coop = window.__smokeCoop; window.__smokeCoop = null; return 0; });
  }
  check('BR.coop 没加载时点「联机」：按钮灰掉、title「联机模块未加载」，不开面板', missing.disabled && missing.title === '联机模块未加载' && !missing.lobby, missing);

  await page.reload();
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(600);
  const reloaded = await ev(page, suitColors);
  const pinkHex2 = await ev(page, expectedHex, 'pink');
  check('刷新后仍是粉色（localStorage + 模型颜色）',
    (await ev(page, () => BR.skin.current === 'pink' && localStorage.getItem('backrooms_skin') === 'pink')) &&
    reloaded.suit.length > 0 && reloaded.suit.every(h => h === pinkHex2), reloaded.suit.map(h => h.toString(16)));
  await shot(page, 'home-after-reload-pink');

  // ---------- 「游玩」弹窗 ----------
  await page.click('.home-play');
  await page.waitForTimeout(200);
  const menu = await page.$$eval('.home-menu-btn .home-menu-name', els => els.map(e => e.textContent.trim()));
  check('弹窗按钮自上而下：游玩 / 噩梦生存 / 测试模式', JSON.stringify(menu) === JSON.stringify(['游玩', '噩梦生存', '测试模式']), menu);
  const tops = await page.$$eval('.home-menu-btn', els => els.map(e => e.getBoundingClientRect().top));
  check('三个按钮纵向排列', tops.length === 3 && tops[0] < tops[1] && tops[1] < tops[2], tops);
  const subs = await page.$$eval('.home-menu-btn .home-menu-sub', els => els.map(e => e.textContent.trim()));
  check('菜单说明里不再写「可联机」：游玩写「实体不攻击你，可调能见度和实体数量」', subs[0] === '实体不攻击你，可调能见度和实体数量' && !subs.some(t => /联机/.test(t)), subs);
  await shot(page, 'menu');

  await page.click('.home-menu-btn.is-casual');
  await page.waitForTimeout(200);
  // 两人一起玩只走主页「联机」→ 营地 → 帐篷：「游玩」弹窗里的联机按钮、开麦按钮、联机状态行都拿掉了
  const casCoop = await ev(page, () => {
    const d = document.querySelector('.home-dialog-casual');
    const texts = Array.from(d.querySelectorAll('button')).map(b => b.textContent.trim());
    // 按 class 片段找（mic / coop），不写死旧的类名：旧入口的类名在 tests/ 里一处不留
    return { texts, coopEls: Array.from(d.querySelectorAll('[class*="mic"], [class*="coop"]')).map(e => e.className), text: d.textContent.replace(/\s+/g, '') };
  });
  check('「游玩」弹窗里没有「联机」和开麦按钮，也没有联机状态行', casCoop.coopEls.length === 0 && !casCoop.texts.some(t => /联机|开麦|闭麦/.test(t)) && !/联机/.test(casCoop.text), casCoop);
  await ev(page, () => {
    const r = document.querySelectorAll('.home-dialog-casual .home-range')[1];
    r.value = '100';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const spawnTxt = await page.locator('.home-dialog-casual .home-field-value').nth(1).textContent();
  check('游玩参数：生成量滑条满 = 正常后室的 50%', /正常后室的\s*50%/.test(spawnTxt), spawnTxt);
  await shot(page, 'casual-panel');

  // ---------- 游玩开局 ----------
  await page.click('.home-dialog-casual .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.setAuto(false));
  const cas = await ev(page, () => ({
    mode: BR.game.mode, lv: BR.game.levelId, sf: BR.game.spawnFactor, atk: BR.game.attackPlayers, stats: BR.game.statsEnabled,
    auto: BR.game.autoSpawn, skin: BR.game.skin, homeShown: BR.home.shown, inputOn: BR.input.enabled, hud: BR.hud.visible,
  }));
  check('游玩开局：默认 Level 0、spawnFactor 0.5、不打玩家、无饥饿 san', cas.mode === 'casual' && cas.lv === '0' && cas.sf === 0.5 && !cas.atk && !cas.stats && cas.auto, cas);
  check('游玩开局：主页隐藏、HUD 显示、输入打开、皮肤带进 BR.game', !cas.homeShown && cas.hud && cas.inputOn && cas.skin === 'pink', cas);
  await ev(page, () => __br.step(1));
  // Level 0 选中的是 wikidot-en「Threshold」，那一版没有确认的实体，只有用户指定必须出现的细菌（rare 档，多数开局一只都刷不出来），
  // 所以出生块周围一只实体都没有时换到实体多的 Level 1 验证自动刷怪
  const casEnts = await ev(page, async () => {
    if (BR.entities.count() === 0 && BR.levels.has('1')) await BR.world.goTo('1');
    // Level 1 平均每块约 0.23 只实体：只推进 1 秒时建好的区块不多，偶尔一只都没刷到。多推进几步（最多 6 秒）让出生点周围区块建完再数
    if (window.__br && __br.step) {
      __br.step(1); for (let i = 0; i < 25 && BR.entities.count() === 0; i++) __br.step(0.2);
      // 有的种子下出生点附近几块刚好一只没刷（本地新代码与线上旧版本同种子逐个核对过数量一致，是随机性不是回归）：
      // 换到几块外再数，最多 3 次；仍然检验"自动生成实体"这件事本身
      for (let k = 0; k < 3 && BR.entities.count() === 0; k++) {
        const size = (BR.levels.get(BR.game.levelId) || {}).chunkSize || 24;
        BR.player.x += 3 * size;
        for (let i = 0; i < 20 && BR.entities.count() === 0; i++) __br.step(0.2);
      }
    }
    return { lv: BR.game.levelId, n: BR.entities.count(), items: BR.items.list.length, statsHidden: document.querySelector('.hud-stats').hidden };
  });
  check('游玩：自动生成了实体，也刷了食物/杏仁水', casEnts.n > 0 && casEnts.items > 0, casEnts);
  check('游玩：顶部没有 san/饥饿状态条', casEnts.statsHidden, casEnts);
  await shot(page, 'casual-playing');

  const p0 = await ev(page, () => ({ x: BR.player.x, z: BR.player.z }));
  await page.keyboard.down('KeyW');
  await ev(page, () => __br.step(2));
  await page.keyboard.up('KeyW');
  const p1 = await ev(page, () => ({ x: BR.player.x, z: BR.player.z }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('按住 W 2 秒位置改变', moved > 1, { moved: +moved.toFixed(2), p0, p1 });
  await shot(page, 'casual-after-walk');

  // 暂停菜单 → 返回主页（要点两次确认）
  await page.keyboard.press('Escape');
  await ev(page, () => __br.step(0.05));
  check('Esc 打开暂停菜单', (await visible(page, '.hud-pause')) && (await ev(page, () => BR.game.screen === 'paused' && !BR.input.enabled)));
  await shot(page, 'pause');
  await page.waitForTimeout(700);
  await page.click('.hud-btn-home');
  // 第二下要在 HOME_CONFIRM_MS（2.5 s）内点到。机器负载高时 page.click 的可点检查能拖过这个窗口，第二下反而重新进了「再点一次」
  // （2026-10-02 验收复现，改前的 HEAD 一样）：等「再点一次」出来就直接在页面里点
  await page.waitForFunction(() => /再点一次/.test((document.querySelector('.hud-btn-home') || {}).textContent || ''), null, { timeout: 10000 });
  await page.$eval('.hud-btn-home', b => b.click());
  await page.waitForFunction(() => BR.game.screen === 'home' && BR.home.shown, null, { timeout: 10000 });
  const backHome = await ev(page, () => ({ lv: BR.world.current, ents: BR.entities.list.length, items: BR.items.list.length, hud: BR.hud.visible, inputOn: BR.input.enabled }));
  check('返回主页：世界/实体/物品清空、HUD 收起、输入关闭', !backHome.lv && backHome.ents === 0 && backHome.items === 0 && !backHome.hud && !backHome.inputOn, backHome);
  await page.waitForTimeout(300);
  await shot(page, 'home-again');

  // ---------- 噩梦·地狱 ----------
  await page.click('.home-play');
  await page.waitForTimeout(150);
  await page.click('.home-menu-btn.is-nightmare');
  await page.waitForTimeout(150);
  const cards = await page.$$eval('.home-card .home-card-desc', els => els.map(e => e.textContent));
  check('噩梦难度卡片 0/20/40/60%', / 0%$/.test(cards[0]) && / 20%$/.test(cards[1]) && / 40%$/.test(cards[2]) && / 60%$/.test(cards[3]), cards);
  // 主页一个人玩噩梦照旧从 Level 0 开始（孩子没提要改；帐篷里两个人玩才能选层），弹窗里没有起始层级下拉
  const nmDlg = await ev(page, () => {
    const d = document.querySelector('.home-dialog-nightmare');
    return { notes: Array.from(d.querySelectorAll('.home-note')).map(e => e.textContent.trim()), select: !!d.querySelector('select'), coop: /联机/.test(d.textContent) };
  });
  check('噩梦弹窗照旧写「从 Level 0 … 开始」，没有起始层级下拉、没有联机', nmDlg.notes.some(t => /从 Level 0[^0-9].*开始/.test(t)) && !nmDlg.select && !nmDlg.coop, nmDlg);
  await shot(page, 'nightmare-cards');
  await page.click('.home-card-hell');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.step(0.5));
  const nm = await ev(page, () => ({
    mode: BR.game.mode, diff: BR.game.difficulty, sf: BR.game.spawnFactor, atk: BR.game.attackPlayers, stats: BR.game.statsEnabled,
    hp: BR.player.hp, hunger: BR.player.hunger, inv: BR.player.inventory.filter(Boolean).length, lv: String(BR.game.levelId), coop: !!(BR.coop && BR.coop.active),
  }));
  check('噩梦地狱：spawnFactor 0.6、实体攻击玩家、有饥饿 san，从 Level 0 开始、单人', nm.mode === 'nightmare' && nm.diff === 'hell' && nm.sf === 0.6 && nm.atk && nm.stats && nm.lv === '0' && !nm.coop, nm);
  check('噩梦开局：新一局满血、背包清空', nm.hp === 100 && nm.inv === 0, nm);
  const statBar = await ev(page, () => {
    const el = document.querySelector('.hud-stats');
    const r = el.getBoundingClientRect();
    const names = Array.from(el.querySelectorAll('[class*="hud-stat-"]')).map(n => n.className);
    return { hidden: el.hidden, top: r.top, h: r.height, w: r.width, names };
  });
  check('噩梦：顶部状态条可见（san / 饥饿）', !statBar.hidden && statBar.h > 0 && statBar.top < 120, statBar);
  await shot(page, 'nightmare-hell');

  // 饥饿减速：找开阔方向，分别在饥饿 100 / 10 / 0 下按 W 走 1 秒
  const dir = await ev(page, () => {
    BR.entities.clear();   // 测速时别被咬
    const P = BR.player;
    let best = { yaw: P.yaw, d: -1 };
    for (let i = 0; i < 16; i++) {
      const yaw = -Math.PI + i * Math.PI / 8;
      const h = BR.phys.raycast(P.x, P.feetY + 1.0, P.z, -Math.sin(yaw), 0, -Math.cos(yaw), 30);
      const d = h ? h.dist : 30;
      if (d > best.d) best = { yaw, d };
    }
    return { x: P.x, z: P.z, yaw: best.yaw, free: best.d };
  });
  async function walk(hunger) {
    await ev(page, ({ d, hunger }) => {
      const P = BR.player;
      P.x = d.x; P.z = d.z; P.yaw = d.yaw; P.pitch = 0; P.vx = 0; P.vz = 0;
      P.hunger = hunger; P.sanity = 100; P.hp = 100;
    }, { d: dir, hunger });
    await page.keyboard.down('KeyW');
    const r = await ev(page, () => { const a = { x: BR.player.x, z: BR.player.z }; __br.step(1); return { a, b: { x: BR.player.x, z: BR.player.z }, speed: BR.player.speed() }; });
    await page.keyboard.up('KeyW');
    await ev(page, () => __br.step(0.3));
    return { dist: Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z), speed: r.speed };
  }
  const w100 = await walk(100), w10 = await walk(10), w0 = await walk(0);
  const walkCfg = await ev(page, () => BR.config.player.walk);
  check('饥饿 10：移速减半（speed()）', Math.abs(w10.speed - walkCfg * 0.5) < 1e-6, { speed: w10.speed, walk: walkCfg });
  check('饥饿 0：移速为 1/3（speed()）', Math.abs(w0.speed - walkCfg / 3) < 1e-6, { speed: w0.speed });
  check('饥饿 10：实际位移约为饱腹时的一半', Math.abs(w10.dist / w100.dist - 0.5) < 0.06, { d100: +w100.dist.toFixed(3), d10: +w10.dist.toFixed(3), ratio: +(w10.dist / w100.dist).toFixed(3), free: dir.free });
  check('饥饿 0：实际位移约为饱腹时的 1/3', Math.abs(w0.dist / w100.dist - 1 / 3) < 0.05, { d0: +w0.dist.toFixed(3), ratio: +(w0.dist / w100.dist).toFixed(3) });

  // 死亡 → 结算 → 继续（原地重生、背包保留、附近非友善实体被清）
  const setup = await ev(page, () => {
    const P = BR.player;
    P.hunger = 60; P.sanity = 80;
    P.addItem('almond_water', 2);
    P.addItem('food_ration', 1);
    const fy = P.feetY, from = { x: P.x, y: P.y, z: P.z };
    const near = [
      BR.entities.spawn('_dev_hostile', P.x + 2.5, fy, P.z, { from }),
      BR.entities.spawn('_dev_friendly', P.x - 2.5, fy, P.z, { from }),
      BR.entities.spawn('test_dummy', P.x, fy, P.z + 2.5, { from }),
    ].filter(Boolean);
    return { x: P.x, z: P.z, yaw: P.yaw, near: near.map(e => ({ id: e.id, type: e.type, d: Math.hypot(e.x - P.x, e.z - P.z) })), inv: JSON.stringify(P.inventory) };
  });
  check('死亡前布置：身边放了有害/友善/测试人', setup.near.length === 3, setup.near);
  await ev(page, () => { BR.player.hp = 0; __br.step(0.05); });
  await page.waitForTimeout(200);
  const dead = await ev(page, () => ({ dead: BR.player.dead, screen: BR.game.screen, deaths: BR.game.deaths, inputOn: BR.input.enabled, vis: BR.death.visible }));
  check('hp 设 0 触发死亡 → 结算界面', dead.dead && dead.screen === 'dead' && dead.deaths === 1 && !dead.inputOn && dead.vis && await visible(page, '.death-root'), dead);
  const deathBtns = await page.$$eval('.death-btn .death-btn-main', els => els.map(e => e.textContent.trim()));
  check('结算界面两个按钮：继续 / 返回主页', JSON.stringify(deathBtns) === JSON.stringify(['继续', '返回主页']), deathBtns);
  await page.waitForTimeout(900);   // 结算按钮 800ms 内不响应，防止死亡瞬间误点
  await shot(page, 'death');
  await page.click('.death-btn-continue');
  await ev(page, () => __br.step(0.1));
  const resp = await ev(page, (s) => {
    const P = BR.player;
    const alive = s.near.map(n => ({ type: n.type, alive: !!BR.entities.get(n.id) }));
    return {
      dead: P.dead, hp: P.hp, screen: BR.game.screen, inputOn: BR.input.enabled, vis: BR.death.visible,
      dx: Math.hypot(P.x - s.x, P.z - s.z), inv: JSON.stringify(P.inventory), hunger: P.hunger, sanity: P.sanity, alive,
    };
  }, setup);
  check('继续：原地重生（位置不变、满血、回到游玩、输入打开）', !resp.dead && resp.hp === 100 && resp.dx < 0.05 && resp.screen === 'playing' && resp.inputOn && !resp.vis, resp);
  check('继续：背包保留', resp.inv === setup.inv, { before: setup.inv, after: resp.inv });
  check('继续：饥饿/san 回到 50 以上', resp.hunger >= 50 && resp.sanity >= 50, resp);
  const aliveOf = t => (resp.alive.find(a => a.type === t) || {}).alive;
  check('继续：附近有害实体和测试人被清掉、友善实体保留', aliveOf('_dev_hostile') === false && aliveOf('test_dummy') === false && aliveOf('_dev_friendly') === true, resp.alive);
  await shot(page, 'respawned');

  // 再死一次，走「返回主页」
  await ev(page, () => { BR.player.hp = 0; __br.step(0.05); });
  await page.waitForTimeout(950);
  await page.click('.death-btn-home');
  await page.waitForFunction(() => BR.game.screen === 'home' && BR.home.shown, null, { timeout: 10000 });
  check('结算「返回主页」回到主页', await ev(page, () => !BR.death.visible && !BR.world.current && !BR.hud.visible));

  // ---------- 测试模式 ----------
  await page.click('.home-play');
  await page.waitForTimeout(150);
  await page.click('.home-menu-btn.is-test');
  await page.waitForTimeout(150);
  await shot(page, 'test-panel-home');
  await page.click('.home-dialog-test .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => __br.step(3));
  const tm = await ev(page, () => ({ mode: BR.game.mode, auto: BR.game.autoSpawn, sf: BR.game.spawnFactor, ents: BR.entities.list.length, items: BR.items.list.length, atk: BR.game.attackPlayers }));
  check('测试模式：不自动生成实体，但照常刷物品', tm.mode === 'test' && !tm.auto && tm.ents === 0 && tm.items > 0 && !tm.atk, tm);
  await shot(page, 'test-playing');

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(150);
  const panel = await ev(page, () => ({ open: BR.test.isOpen, inputOn: BR.input.enabled }));
  check('按 T 打开实体面板，输入关闭', panel.open && !panel.inputOn && await visible(page, '.test-root'), panel);
  await shot(page, 'test-entity-list');
  await page.waitForTimeout(450);   // 面板打开后 400ms 内的点击被忽略
  await page.click('.test-btn-dummy');
  await ev(page, () => __br.step(0.05));
  const dummy0 = await ev(page, () => {
    const d = BR.entities.list.find(e => e.type === 'test_dummy');
    return d ? { id: d.id, x: d.x, z: d.z, hp: d.hp, speed: d.def.speed, faction: d.def.faction } : null;
  });
  check('召唤测试人', !!dummy0 && dummy0.faction === 'dummy', dummy0);
  await page.click('.test-close');
  await ev(page, () => __br.step(0.05));
  check('关闭面板后输入恢复', await ev(page, () => !BR.test.isOpen && BR.input.enabled));

  // 测试人移速：3 秒里每 0.1 秒采样，取移动中的速度
  const dSpeed = await ev(page, (id) => {
    const out = [];
    let e = BR.entities.get(id);
    let px = e.x, pz = e.z;
    for (let i = 0; i < 40; i++) {
      __br.step(0.1);
      e = BR.entities.get(id);
      if (!e) break;
      out.push(Math.hypot(e.x - px, e.z - pz) / 0.1);
      px = e.x; pz = e.z;
    }
    const moving = out.filter(v => v > 0.3).sort((a, b) => a - b);
    return { max: moving.length ? moving[moving.length - 1] : 0, median: moving.length ? moving[moving.length >> 1] : 0,
      p75: moving.length ? moving[Math.floor(moving.length * 0.75)] : 0, samples: out.length, moving: moving.length, walk: BR.config.player.walk };
  }, dummy0.id);
  // 巡航速度看最大值（没被挡时正好是步行的一半）；中位数会被贴墙滑行、转身拖低——每次种子随机、布局不同，按中位数判定会偶发失败。
  // 再要求 75 分位不低于 0.35 倍，防止测试人大部分时间卡住不动也算过
  const ratio = dSpeed.max / dSpeed.walk;
  check('测试人移速约为玩家步行一半', dSpeed.moving >= 5 && ratio > 0.45 && ratio < 0.56 && dSpeed.p75 / dSpeed.walk > 0.35, { ...dSpeed, ratio: +ratio.toFixed(3) });

  // 场景一：只放有害实体 + 测试人（测试人拉回原位），推进 10 秒，验证测试人掉血。
  // 以前和友善实体放在同一场，有害实体常先被友善实体打死、来不及打测试人，所以拆成两个独立场景。
  const scene1 = await ev(page, (d0) => {
    const d = BR.entities.get(d0.id);
    if (d) { d.x = d0.x; d.z = d0.z; }
    __br.step(0.05);
    const h = BR.test.spawnEntity('_dev_hostile');
    if (!h || !d) return { ok: false, h: !!h, d: !!d };
    const log = { playerDamage: 0, kills: [] };
    const off1 = BR.bus.on('player:damage', () => { log.playerDamage++; });
    const off2 = BR.bus.on('entity:kill', p => { log.kills.push({ killerType: p.killerType, victimType: p.victimType }); });
    const hp0 = { h: h.hp, d: d.hp };
    const min = { h: h.hp, d: d.hp };
    const dist = Math.hypot(h.x - d.x, h.z - d.z);
    const types = BR.entities.list.filter(e => !e.removed).map(e => e.type);
    for (let i = 0; i < 100; i++) {
      __br.step(0.1);
      const H = BR.entities.get(h.id), D = BR.entities.get(d0.id);
      if (H) min.h = Math.min(min.h, H.hp);
      if (D) min.d = Math.min(min.d, D.hp);
    }
    off1(); off2();
    return { ok: true, hp0, min, dist, types, log, playerHp: BR.player.hp, playerDead: BR.player.dead };
  }, dummy0);
  check('场景一：只放 _dev_hostile + 测试人', scene1.ok && scene1.types.length === 2 && !scene1.types.includes('_dev_friendly'), scene1.ok ? scene1.types : scene1);
  if (scene1.ok) {
    const killedDummy = scene1.log.kills.some(k => k.victimType === 'test_dummy' && k.killerType === '_dev_hostile');
    check('有害实体攻击测试人（测试人掉血）', scene1.min.d < scene1.hp0.d || killedDummy, { min: scene1.min, hp0: scene1.hp0, kills: scene1.log.kills, dist: +scene1.dist.toFixed(2) });
  }
  await shot(page, 'test-hostile-vs-dummy');

  // 场景二：清场后放 _dev_hostile + _dev_friendly，推进 10 秒，验证互打
  const scene2 = await ev(page, () => {
    BR.test.clearAll();
    __br.step(0.1);
    const left = BR.entities.list.filter(e => !e.removed).length;
    const h = BR.test.spawnEntity('_dev_hostile');
    const f = BR.test.spawnEntity('_dev_friendly');
    if (!h || !f) return { ok: false, left, h: !!h, f: !!f };
    const log = { playerDamage: 0, kills: [] };
    const off1 = BR.bus.on('player:damage', () => { log.playerDamage++; });
    const off2 = BR.bus.on('entity:kill', p => { log.kills.push({ killerType: p.killerType, victimType: p.victimType }); });
    const hp0 = { h: h.hp, f: f.hp };
    const min = { h: h.hp, f: f.hp };
    const dist = Math.hypot(h.x - f.x, h.z - f.z);
    for (let i = 0; i < 100; i++) {
      __br.step(0.1);
      const H = BR.entities.get(h.id), F = BR.entities.get(f.id);
      if (H) min.h = Math.min(min.h, H.hp);
      if (F) min.f = Math.min(min.f, F.hp);
    }
    off1(); off2();
    return { ok: true, left, hp0, min, dist, log, playerHp: BR.player.hp, playerDead: BR.player.dead };
  });
  check('场景二：清场后放出 _dev_hostile 与 _dev_friendly', scene2.ok && scene2.left === 0, scene2.ok ? { left: scene2.left, dist: +scene2.dist.toFixed(2) } : scene2);
  if (scene2.ok) {
    const killedFriendly = scene2.log.kills.some(k => k.victimType === '_dev_friendly' && k.killerType === '_dev_hostile');
    check('有害实体攻击友善实体', scene2.min.f < scene2.hp0.f || killedFriendly, { min: scene2.min, hp0: scene2.hp0, kills: scene2.log.kills });
    check('友善实体攻击有害实体', scene2.min.h < scene2.hp0.h || scene2.log.kills.some(k => k.victimType === '_dev_hostile'), { min: scene2.min, kills: scene2.log.kills });
  }
  check('测试模式实体不攻击玩家（两个场景）', scene1.ok && scene2.ok && scene1.log.playerDamage === 0 && scene2.log.playerDamage === 0 && scene2.playerHp === 100 && !scene2.playerDead,
    { s1: scene1.log && scene1.log.playerDamage, s2: scene2.log && scene2.log.playerDamage, hp: scene2.playerHp, dead: scene2.playerDead });
  await shot(page, 'test-fight');

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(500);
  await page.click('.test-btn-clear');
  await ev(page, () => __br.step(0.1));
  const cleared = await ev(page, () => BR.entities.list.length);
  check('「清除全部」后场上没有实体', cleared === 0, cleared);
  await shot(page, 'test-cleared');
  await page.click('.test-close');
  await ev(page, () => __br.setAuto(true));
  await ctx.close();
}

// =====================================================================
// 手机竖屏 390×844 触屏
// =====================================================================
async function mobile(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await newPage(ctx, 'mobile');
  await boot(page, base);
  check('手机：识别为触屏', await ev(page, () => BR.input.isTouch === true));
  const play = await ev(page, () => {
    const r = document.querySelector('.home-play').getBoundingClientRect();
    return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, inView: r.right <= innerWidth && r.bottom <= innerHeight };
  });
  check('手机：「游玩」按钮在右下且点击目标 ≥ 44px', play.inView && play.h >= 44 && play.w >= 44 && play.right < 120 && play.bottom < 160, play);
  const mNet = await ev(page, () => {
    const b = document.querySelector('.home-secondary-btn.is-coop');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  check('手机：主页有「联机」按钮，在视口内且点击目标 ≥ 44px', !!mNet && mNet.inView && mNet.w >= 44 && mNet.h >= 44, mNet);
  await shot(page, 'mobile-home');
  await page.tap('.home-secondary-btn.is-coop');
  await page.waitForTimeout(400);
  const mLob = await ev(page, lobbyState);
  check('手机：点「联机」打开联机面板第一屏，不自动聚焦输入框（不弹键盘）', mLob.open && mLob.view === 'start' && mLob.btns.includes('开一个营地') &&
    await ev(page, () => { const a = document.activeElement; return !a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }), mLob);
  await shot(page, 'mobile-coop-lobby');
  await page.tap('.coop-lobby .coop-close');
  await page.waitForTimeout(400);
  await page.tap('.home-play');
  await page.waitForTimeout(250);
  const menu = await page.$$eval('.home-menu-btn .home-menu-name', els => els.map(e => e.textContent.trim()));
  check('手机：弹窗按钮顺序', JSON.stringify(menu) === JSON.stringify(['游玩', '噩梦生存', '测试模式']), menu);
  await shot(page, 'mobile-menu');
  await page.tap('.home-menu-btn.is-casual');
  await page.waitForTimeout(250);
  await shot(page, 'mobile-casual-panel');
  await page.tap('.home-dialog-casual .home-btn-primary');
  await page.waitForFunction(() => BR.game.screen === 'playing', null, { timeout: 20000 });
  await ev(page, () => { __br.setAuto(false); __br.step(1); });
  const m = await ev(page, () => {
    const t = document.querySelector('.touch-root');
    return { lv: BR.game.levelId, touch: !!t && !t.hidden && getComputedStyle(t).display !== 'none', hud: BR.hud.visible, inputOn: BR.input.enabled };
  });
  check('手机：游玩开局，触屏摇杆/按钮显示', m.lv === '0' && m.touch && m.hud && m.inputOn, m);
  await ev(page, () => __br.setAuto(true));
  await page.waitForTimeout(400);
  await shot(page, 'mobile-playing');
  await ctx.close();
}

main();
