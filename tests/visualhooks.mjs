// 后室 · 构件视觉钩子测试：node tests/visualhooks.mjs
// ENGINE_PLAN M1「顶点色 tint」「S」「AA」三段：
//   tint：上色图元顶点色正确、未上色图元纯白；只有用了 tint 的槽位换 vc 材质（缓存键加 /vc），共享材质本身不改；
//         可选参数省略中间位置参数时几何和不带 tint 的逐元素相同；现有实体除白名单（TINTED_FORMS）里已回填 tint 的形态外，
//         骨架一个都不带 color 属性、不开 vertexColors，白名单形态只有 tint 槽位开 vertexColors
//   slotMat：懒克隆、同类型另一只不受影响、实体移除后克隆材质被 dispose（挂着的和远处换下来的都算）；
//            低画质 / 远于 28 m 返回共享材质，写入不生效
//   fx：粒子池上限（高 200 / 低 100）、全场只有 1 个 Points、1 个 draw call、burst 复用 itemKit.burstFx、寿命到了清空；
//       vanish / appear 状态切换（房主写 e.state；客机按快照淡出淡回；低画质不克隆材质）
//   decal：上限（高 64 / 低 32）、1 个 InstancedMesh（1 个 draw call）、区块卸载后该块清空、ttl 到期消失、换层全清
//   全程测试模式，玩家血量不变
// 不截图（tests/all.mjs --quick 照跑）。任一检查失败或页面出现 console.error / 未捕获异常时退出码为 1。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/xuanjiang/Downloads/project/ESP-S3/rocket-launch-3d/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 20260915;

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
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text() + ' @ ' + (m.location().url || ''));
  });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  // 联机信令服务器绝不能打线上
  await page.route(/https?:\/\/api\.ovobot\.ai\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"offline_in_test"}' }));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => window.BR && window.__br && BR.home && BR.home.shown, null, { timeout: 30000 });
  await page.evaluate(() => BR.assets.init());
  await page.waitForTimeout(500);
  return { ctx, page };
}

// 页面里的小工具：进测试模式、注册探针实体、在玩家身边放实体
function setup(page) {
  return ev(page, seed => {
    __br.setAuto(false);
    __br.start({ mode: 'test', seed, levelId: 'dev', settings: { visibility: 1, quality: 'high' } });
    __br.step(0.3);
    const A = BR.arch;
    // 探针：一个骨架两个槽位（body 普通材质、glow 发光），没有行为，只给视觉钩子用
    if (!BR.entityTypes.get('_vh_probe')) {
      A.register({
        type: '_vh_probe', en: 'Visual Hook Probe', zh: '视觉钩子探针', version: 'test', faction: 'neutral',
        hp: 100, radius: 0.3, height: 1.6, speed: { walk: 0, run: 0 }, perception: { sight: 0, hearing: 0, fov: 360 },
        build() {
          return A.wrap(A.parts.rig('vh_probe', b => {
            b.bone('root', null, [0, 0, 0]);
            b.box('root', 'body', [0.5, 1.2, 0.3], [0, 0.6, 0]);
            b.sphere('root', 'glow', 0.08, [0, 1.4, -0.16]);
          }, { colors: { body: 0x808080, glow: 0xffffff } }), { label: '_vh_probe' });
        },
        think() {},
        anim: { breathe: 0 },
      });
    }
    const P = BR.player;
    window.__vh = {
      hp0: P.hp,
      put(dx, dz, id) {
        return BR.entities.spawn('_vh_probe', P.x + dx, P.feetY != null ? P.feetY : 0, P.z + dz, { force: true, id });
      },
      shared() { return A.mat.lambert(0x808080); },
      bodyIndex(e) { return e.obj.userData.arch.rig.slots.indexOf('body'); },
    };
    return { level: BR.game.levelId, mode: BR.game.mode, hp: P.hp, probe: !!BR.entityTypes.get('_vh_probe') };
  }, SEED);
}

// =====================================================================
// 1. 顶点色 tint
// =====================================================================
async function tint(page) {
  const r = await ev(page, () => {
    const A = BR.arch, T = THREE;
    const T1 = 0xff0000, T2 = 0x336699, T3 = 0x00ff80;
    // 每个图元摆在 x = 10·k 处，按 x 坐标就能认出顶点属于哪个图元；opts 为 null 时就是不带 tint 的同一套调用
    const build = tinted => b => {
      const o = c => (tinted ? [{ tint: c }] : []);
      b.bone('root', null, [0, 0, 0]);
      b.box('root', 'body', [1, 1, 1], [0, 0.5, 0], [0, 0.3, 0], ...o(T1));                    // 0 box 带 rot
      b.box('root', 'body', [1, 1, 1], [10, 0.5, 0], ...o(T2));                                // 1 box 省略 rot
      b.box('root', 'body', [1, 1, 1], [20, 0.5, 0]);                                          // 2 不上色
      b.sphere('root', 'body', 0.5, [30, 0.5, 0], [1, 2, 1], [12, 6], ...o(T3));               // 3 sphere 带 scale/seg
      b.sphere('root', 'body', 0.5, [40, 0.5, 0], ...o(T1));                                   // 4 sphere 省略 scale/seg
      b.limb('root', 'body', [50, 0, 0], [50, 1, 0], 0.3, 0.2, 9, 0.5, ...o(T2));              // 5 limb 带 seg/flat
      b.limb('root', 'body', [60, 0, 0], [60, 1, 0], 0.3, 0.2, ...o(T3));                      // 6 limb 省略 seg/flat
      b.cone('root', 'body', [70, 0, 0], [70, 1, 0], 0.3, 6, ...o(T1));                        // 7 cone 带 seg
      b.cone('root', 'body', [80, 0, 0], [80, 1, 0], 0.3, ...o(T2));                           // 8 cone 省略 seg
      b.chain('ch', 'root', [90, 0, 0], [0, 1, 0], 3, 1.5, 0.2, 0.05, 'body', 5, ...o(T3));    // 9 chain 带 seg
      b.chain('ck', 'root', [100, 0, 0], [0, 1, 0], 3, 1.5, 0.2, 0.05, 'body', ...o(T1));      // 10 chain 省略 seg
      b.geo('root', 'body', new T.BoxGeometry(1, 1, 1).translate(110, 0.5, 0), ...o(T2));      // 11 geo
      b.sphere('root', 'glow', 0.3, [120, 0.5, 0]);                                            // 12 glow 槽位不上色
      b.box('root', 'eye', [0.2, 0.2, 0.2], [130, 0.5, 0]);                                    // 13 eye 槽位不上色
    };
    const expectHex = [T1, T2, null, T3, T1, T2, T3, T1, T2, T3, T1, T2, null, null];
    const colors = { body: 0x808080, glow: 0xffffff };
    const mt = A.parts.rig('vh_tint_on', build(true), { colors });
    const mp = A.parts.rig('vh_tint_off', build(false), { colors });
    const gt = mt.geometry, gp = mp.geometry;
    const pos = gt.attributes.position, col = gt.attributes.color;
    const out = { hasColorOn: !!col, hasColorOff: !!gp.attributes.color, itemSize: col ? col.itemSize : null };

    // 顶点色逐个比
    let bad = 0, checked = 0, badSample = null;
    const perPart = new Array(expectHex.length).fill(0);
    if (col) {
      for (let i = 0; i < pos.count; i++) {
        const k = Math.round(pos.getX(i) / 10);
        const hex = expectHex[k];
        const want = hex == null ? [1, 1, 1] : (c => [c.r, c.g, c.b])(new T.Color(hex));
        const got = [col.getX(i), col.getY(i), col.getZ(i)];
        checked++; perPart[k]++;
        if (Math.abs(got[0] - want[0]) > 1e-6 || Math.abs(got[1] - want[1]) > 1e-6 || Math.abs(got[2] - want[2]) > 1e-6) {
          bad++;
          if (!badSample) badSample = { i, k, got, want };
        }
      }
    }
    out.colors = { checked, bad, badSample, perPart };

    // 位置 / 索引 / 分组：带 tint 与不带 tint 逐元素一致（可选参数没把 rot/scale/seg/flat 解析错）
    const same = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    out.samePosition = same(pos.array, gp.attributes.position.array);
    out.sameNormal = same(gt.attributes.normal.array, gp.attributes.normal.array);
    out.sameIndex = same(gt.index && gt.index.array, gp.index && gp.index.array);
    out.sameGroups = JSON.stringify(gt.groups) === JSON.stringify(gp.groups);
    out.bones = [mt.skeleton.bones.length, mp.skeleton.bones.length];

    // 材质：只有 body 槽位（出现过 tint）换成 vc 版本；glow / eye 槽位保持共享材质
    const slots = mt.userData.rig.slots;
    const bi = slots.indexOf('body'), gi = slots.indexOf('glow'), ei = slots.indexOf('eye');
    const shared = A.mat.lambert(0x808080), glow = A.mat.glow(0xffffff);
    const mb = mt.material[bi];
    out.mats = {
      slots,
      tintedVC: mb.vertexColors === true,
      tintedNotShared: mb !== shared,
      tintedKey: A.mat.keyOf(mb), sharedKey: A.mat.keyOf(shared),
      cacheHit: BR.assets.material(A.mat.keyOf(mb)) === mb,
      sharedUntouched: shared.vertexColors === false,
      sameColor: mb.color.getHex() === shared.color.getHex(),
      glowShared: mt.material[gi] === glow && glow.vertexColors === false,
      eyeShared: mt.material[ei] === glow,
      plainShared: mp.material[mp.userData.rig.slots.indexOf('body')] === shared,
      secondInstanceSame: A.parts.rig('vh_tint_on', build(true), { colors }).material[bi] === mb,
    };
    // o.mats 直接给的非缓存材质：按对象派生一份 vc 版本，原材质不改，第二只拿到同一份
    const own = new T.MeshLambertMaterial({ color: 0x445566 });
    const m1 = A.parts.rig('vh_tint_on', build(true), { mats: { body: own } });
    const m2 = A.parts.rig('vh_tint_on', build(true), { mats: { body: own } });
    out.ownMats = {
      derived: m1.material[bi] !== own && m1.material[bi].vertexColors === true,
      origUntouched: own.vertexColors === false,
      reused: m1.material[bi] === m2.material[bi],
      keyNull: A.mat.keyOf(own) === null,
    };
    return out;
  });
  check('tint：带 tint 的骨架几何有 3 分量 color 属性，不带 tint 的同形骨架没有', r.hasColorOn && r.itemSize === 3 && !r.hasColorOff, { on: r.hasColorOn, off: r.hasColorOff, itemSize: r.itemSize });
  check('tint：box/sphere/limb/cone/chain/geo 上色图元顶点色等于 tint，未上色图元（含其他槽位）纯白 1,1,1', r.colors.checked > 0 && r.colors.bad === 0 && r.colors.perPart.every(n => n > 0), r.colors);
  check('tint：可选参数接在后面、省略中间位置参数时，位置/法线/索引/分组与不带 tint 的逐元素相同', r.samePosition && r.sameNormal && r.sameIndex && r.sameGroups && r.bones[0] === r.bones[1],
    { pos: r.samePosition, normal: r.sameNormal, index: r.sameIndex, groups: r.sameGroups, bones: r.bones });
  check('tint：出现 tint 的槽位材质开 vertexColors、缓存键 = 原键 + /vc 且命中缓存；共享材质本身不改', r.mats.tintedVC && r.mats.tintedNotShared && r.mats.sharedKey && r.mats.tintedKey === r.mats.sharedKey + '/vc' &&
    r.mats.cacheHit && r.mats.sharedUntouched && r.mats.sameColor && r.mats.secondInstanceSame, r.mats);
  check('tint：没出现 tint 的槽位（glow/eye）和不带 tint 的骨架仍用原共享材质', r.mats.glowShared && r.mats.eyeShared && r.mats.plainShared, r.mats);
  check('tint：o.mats 直接给的材质派生 vc 版本（原材质不改、同一材质只派生一份）', r.ownMats.derived && r.ownMats.origUntouched && r.ownMats.reused && r.ownMats.keyNull, r.ownMats);
}

// 真渲染一遍：vc 材质 + 骨骼蒙皮在 basic / lambert / 贴图三种材质上都能编过着色器，颜色也真的上到画面里。
// 画到私有场景的离屏缓冲里读像素（离屏缓冲不做 sRGB 输出编码和色调映射，读到的就是着色结果）
async function tintRender(page) {
  const r = await ev(page, () => {
    const A = BR.arch, T = THREE, R = BR.gfx.renderer;
    const scene = new T.Scene();
    scene.add(new T.AmbientLight(0xffffff, 1));
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const build = b => {
      b.bone('root', null, [0, 0, 0]);
      b.box('root', 'body', [0.9, 1.8, 0.2], [-0.5, 0, 0], { tint: 0xff0000 });   // 左半边上红色
      b.box('root', 'body', [0.9, 1.8, 0.2], [0.5, 0, 0]);                         // 右半边不上色
    };
    const rt = new T.WebGLRenderTarget(64, 64);
    const px = new Uint8Array(4);
    const read = (x, y) => { R.readRenderTargetPixels(rt, x, y, 1, 1, px); return [px[0], px[1], px[2]]; };
    const shoot = mesh => {
      scene.add(mesh);
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt);
      R.clear();
      R.render(scene, cam);
      const res = { left: read(16, 32), right: read(48, 32), vc: mesh.material[0].vertexColors === true };
      R.setRenderTarget(prev);
      scene.remove(mesh);
      return res;
    };
    const out = {
      basic: shoot(A.parts.rig('vh_tint_render', build, { colors: { body: 0xffffff }, look: { body: 'basic' } })),
      lambert: shoot(A.parts.rig('vh_tint_render', build, { colors: { body: 0xffffff } })),
      skin: shoot(A.parts.rig('vh_tint_render', build, { colors: { body: 0xffffff }, look: { body: 'skin' } })),
    };
    rt.dispose();
    return out;
  });
  const red = p => p[0] > 150 && p[1] < 40 && p[2] < 40;
  const neutral = p => p[0] > 150 && Math.abs(p[0] - p[1]) < 30 && Math.abs(p[0] - p[2]) < 30;
  const ok = ['basic', 'lambert', 'skin'].every(k => r[k] && r[k].vc && red(r[k].left) && neutral(r[k].right));
  check('tint 实际渲染：basic / lambert / 贴图（skin）三种 vc 材质配骨骼蒙皮都能编译，上色那半边画出来是红色、未上色那半边保持材质原色', ok, r);
}

// 已经用了 tint 的实体形态 → 该形态里出现 tint 的槽位（M1 回填：skin_stealer 真身的白眼和眼窝、wretch 的残留衣物）。
// 写到"形态 + 槽位"这么细，而不是整个类型放行：伪装形态、同一骨架里其他槽位仍要逐字节保持原样；
// 以后哪个实体新用了 tint，这里会报出来，逼着改的人确认并补进白名单，而不是悄悄放行。形态名 '' = 单一模型（没有多形态）
const TINTED_FORMS = {
  skin_stealer: { true: ['head'] },
  wretch: { '': ['body'] },
};

// 现有实体：白名单以外的骨架一个都不带 color 属性、不开 vertexColors；白名单里的形态只有 tint 槽位换 vc 材质（键以 /vc 结尾），
// 同一骨架的其余槽位不开 vertexColors；白名单里写到的形态必须真的出现过（防止白名单过期）；默认不克隆材质
async function existing(page) {
  const r = await ev(page, tintedForms => {
    const P = BR.player, S = BR.game.settings, q0 = S.quality, A = BR.arch;
    const out = { types: 0, rigs: 0, colorAttr: [], vcMats: [], tintBad: [], tintSeen: [], tintMissing: [], cloned: [], noSlotMat: [], errors: [] };
    const types = BR.entityTypes.all().map(d => d.type).filter(t => t !== '_vh_probe');
    try {
      for (const q of ['high', 'low']) {
        S.quality = q;
        for (const type of types) {
          let e = null;
          try { e = BR.entities.spawn(type, P.x + 3000, 0, P.z + 3000, { force: true, id: 'vh-exist-' + q + '-' + type }); }
          catch (err) { out.errors.push(type + ': ' + err); continue; }
          if (!e || !e.obj) continue;
          if (q === 'high') out.types++;
          const u = e.obj.userData.arch;
          if (u && typeof u.slotMat !== 'function') out.noSlotMat.push(type);
          if (u && u.own && u.own.size) out.cloned.push(type);
          // 网格 → 所属形态名：多形态实体各形态挂在 pivot 下，按子树归属；不在任何形态子树里的（单一模型）记 ''
          const formOf = new Map();
          if (u && u.forms) for (const k in u.forms) u.forms[k].traverse(o => formOf.set(o, k));
          e.obj.traverse(o => {
            if (!o.userData || !o.userData.rig) return;
            out.rigs++;
            const form = formOf.has(o) ? formOf.get(o) : '';
            const tag = q + ':' + type + (form ? '/' + form : '');
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            const want = tintedForms[type] && tintedForms[type][form];
            if (!want) {
              if (o.geometry.attributes.color) out.colorAttr.push(tag);
              if (ms.some(m => m && m.vertexColors)) out.vcMats.push(tag);
              return;
            }
            out.tintSeen.push(tag);
            const slots = o.userData.rig.slots || [], bad = [];
            if (!o.geometry.attributes.color) bad.push('几何没有 color 属性');
            for (const s of want) if (slots.indexOf(s) < 0) bad.push('骨架里没有槽位 ' + s);
            slots.forEach((s, i) => {
              const m = ms[i], vc = !!(m && m.vertexColors), key = (m && A.mat.keyOf(m)) || '';
              if (want.indexOf(s) >= 0) { if (!vc || !/\/vc$/.test(key)) bad.push(s + ' 应开 vertexColors 且键以 /vc 结尾：vc=' + vc + ' key=' + key); }
              else if (vc) bad.push(s + ' 没用 tint 却开了 vertexColors');
            });
            if (bad.length) out.tintBad.push(tag + '：' + bad.join('；'));
          });
          BR.entities.remove(e);
        }
        for (const type in tintedForms) for (const form in tintedForms[type]) {
          const tag = q + ':' + type + (form ? '/' + form : '');
          if (out.tintSeen.indexOf(tag) < 0) out.tintMissing.push(tag);
        }
      }
    } finally { S.quality = q0; BR.entities.clear(); }
    return out;
  }, TINTED_FORMS);
  check('现有实体（高低两档）：白名单外骨架都没有 color 属性、材质都没开 vertexColors；白名单形态（skin_stealer 真身 head、wretch body）只有 tint 槽位开 vc（键 /vc）；默认不克隆材质',
    r.types > 50 && r.rigs > 50 && !r.colorAttr.length && !r.vcMats.length && !r.tintBad.length && !r.tintMissing.length && !r.cloned.length && !r.noSlotMat.length && !r.errors.length,
    { types: r.types, rigs: r.rigs, colorAttr: r.colorAttr, vcMats: r.vcMats, tintSeen: r.tintSeen, tintBad: r.tintBad, tintMissing: r.tintMissing, cloned: r.cloned, noSlotMat: r.noSlotMat, errors: r.errors });
}

// =====================================================================
// 2. slotMat
// =====================================================================
async function slotMat(page) {
  const r = await ev(page, () => {
    const A = BR.arch, H = __vh, P = BR.player;
    BR.game.settings.quality = 'high';
    const shared = H.shared();
    const out = {};
    let sharedDisposed = 0;
    const onShared = () => sharedDisposed++;
    shared.addEventListener('dispose', onShared);
    try {
      // --- 克隆隔离 ---
      const e1 = H.put(2, 0, 'vh-s1'), e2 = H.put(-2, 0, 'vh-s2');
      __br.step(0.05);
      const u1 = e1.obj.userData.arch, u2 = e2.obj.userData.arch, bi = H.bodyIndex(e1);
      const live0 = A.fx.debugInfo().clones;
      const before = { m1: u1.rig.mesh.material[bi] === shared, m2: u2.rig.mesh.material[bi] === shared };
      const c1 = u1.slotMat('body');
      const again = u1.slotMat('body');
      c1.color.setHex(0xff0000);
      __br.step(0.05);
      out.iso = {
        before, isClone: !!c1 && c1.isMaterial && c1 !== shared && c1.uuid !== shared.uuid, attached: u1.rig.mesh.material[bi] === c1, lazySame: again === c1,
        cloneHex: c1.color.getHex(), sharedHex: shared.color.getHex(),
        otherShared: u2.rig.mesh.material[bi] === shared, otherHex: u2.rig.mesh.material[bi].color.getHex(),
        live: A.fx.debugInfo().clones - live0, missing: u1.slotMat('nope'),
      };
      // 同类型新放一只：还是共享材质、原色
      const e5 = H.put(0, 2, 'vh-s5');
      out.iso.newOneShared = e5.obj.userData.arch.rig.mesh.material[bi] === shared;
      BR.entities.remove(e5);

      // --- 移除时释放（挂在网格上的那份） ---
      let d1 = 0;
      c1.addEventListener('dispose', () => d1++);
      BR.entities.remove(e1);
      out.dispose = { disposed: d1, live: A.fx.debugInfo().clones - live0, removed: e1.removed };

      // --- 低画质：返回共享材质、写入不生效、不克隆 ---
      BR.game.settings.quality = 'low';
      const liveLow = A.fx.debugInfo().clones;
      const ro = u2.slotMat('body');
      let threw = null;
      try {
        ro.color.setHex(0x00ff00);
        ro.color.r = 0;
        ro.opacity = 0.2;
        ro.transparent = true;
        ro.setValues({ opacity: 0.1 });
        ro.dispose();
      } catch (err) { threw = String(err); }
      out.low = {
        threw, uuid: ro.uuid === shared.uuid, isMaterial: ro.isMaterial === true,
        attachedShared: u2.rig.mesh.material[bi] === shared,
        sharedHex: shared.color.getHex(), sharedOpacity: shared.opacity, sharedTransparent: shared.transparent,
        readsShared: ro.color.getHex() === 0x808080 && ro.opacity === 1 && ro.transparent === false,
        cloned: A.fx.debugInfo().clones - liveLow, sharedDisposed,
      };
      BR.game.settings.quality = 'high';

      // --- 远距离：近处克隆、挪到 40 m 外换回共享材质且写入不生效、回到近处沿用原副本 ---
      const c2 = u2.slotMat('body');
      c2.color.setHex(0x0000ff);
      const nearAttached = u2.rig.mesh.material[bi] === c2;
      e2.x = P.x + 40; e2.obj.position.x = e2.x;
      const far = u2.slotMat('body');
      far.color.setHex(0xffff00);
      far.opacity = 0.3;
      out.far = {
        nearAttached, sameAsShared: far.uuid === shared.uuid, reverted: u2.rig.mesh.material[bi] === shared,
        sharedHex: shared.color.getHex(), sharedOpacity: shared.opacity, cloneKeptColor: c2.color.getHex(),
      };
      e2.x = P.x - 2; e2.obj.position.x = e2.x;
      const back = u2.slotMat('body');
      out.far.backSame = back === c2 && u2.rig.mesh.material[bi] === c2 && c2.color.getHex() === 0x0000ff;
      // 再挪远：副本从网格上摘下，移除实体时也要释放
      e2.x = P.x + 40; e2.obj.position.x = e2.x;
      u2.slotMat('body');
      let d2 = 0;
      c2.addEventListener('dispose', () => d2++);
      const detached = u2.rig.mesh.material[bi] !== c2;
      BR.entities.remove(e2);
      out.far.detachedDispose = { detached, disposed: d2, live: A.fx.debugInfo().clones - live0 };
    } finally {
      shared.removeEventListener('dispose', onShared);
      BR.game.settings.quality = 'high';
      BR.entities.clear();
    }
    out.sharedDisposed = sharedDisposed;
    out.sharedFinal = { hex: shared.color.getHex(), opacity: shared.opacity, transparent: shared.transparent };
    return out;
  });
  const i = r.iso;
  check('slotMat：懒克隆（同一只再调返回同一份）、挂到本实例网格上，改色不影响同类型另一只和新放的一只', i.before.m1 && i.before.m2 && i.isClone && i.attached && i.lazySame && i.cloneHex === 0xff0000 &&
    i.sharedHex === 0x808080 && i.otherShared && i.otherHex === 0x808080 && i.newOneShared && i.live === 1 && i.missing === null, i);
  check('slotMat：实体移除后克隆材质被 dispose，实例材质计数归零', r.dispose.disposed >= 1 && r.dispose.live === 0 && r.dispose.removed, r.dispose);
  check('slotMat：低画质返回共享材质（只读视图），赋值和调方法都不生效、不报错、不克隆、不释放共享材质', !r.low.threw && r.low.uuid && r.low.isMaterial && r.low.attachedShared &&
    r.low.sharedHex === 0x808080 && r.low.sharedOpacity === 1 && r.low.sharedTransparent === false && r.low.readsShared && r.low.cloned === 0 && r.low.sharedDisposed === 0, r.low);
  check('slotMat：远于 28 m 返回共享材质、网格换回共享材质、写入不生效；回到近处沿用原来那份副本', r.far.nearAttached && r.far.sameAsShared && r.far.reverted && r.far.sharedHex === 0x808080 &&
    r.far.sharedOpacity === 1 && r.far.cloneKeptColor === 0x0000ff && r.far.backSame, r.far);
  check('slotMat：远处已从网格摘下的副本在实体移除时也被 dispose', r.far.detachedDispose.detached && r.far.detachedDispose.disposed >= 1 && r.far.detachedDispose.live === 0, r.far.detachedDispose);
  check('slotMat：全程共享材质没被 dispose、颜色/透明度原样', r.sharedDisposed === 0 && r.sharedFinal.hex === 0x808080 && r.sharedFinal.opacity === 1 && r.sharedFinal.transparent === false, r.sharedFinal);
}

// =====================================================================
// 3. 共享粒子池
// =====================================================================
async function particles(page) {
  const r = await ev(page, () => {
    const A = BR.arch, P = BR.player, K = BR.itemKit, R = BR.gfx.renderer;
    const orig = K.burstFx;
    let flashes = 0;
    K.burstFx = function () { flashes++; return orig.apply(this, arguments); };
    const out = {};
    const findPoints = () => { const l = []; BR.gfx.scene.traverse(o => { if (o.isPoints && o.name === 'arch fx particles') l.push(o); }); return l; };
    try {
      BR.game.settings.quality = 'high';
      A.fx.clear();
      const x = P.x, y = P.y - 0.4, z = P.z - 2;
      const n1 = A.fx.burst(x, y, z, { color: 0xff00ff, count: 500 });
      const d1 = A.fx.debugInfo();
      const n2 = A.fx.burst(x, y, z, { color: [0xff0000, 0x00ff00], count: 150 });
      const d2 = A.fx.debugInfo();
      const pts = findPoints();
      out.high = { n1, n2, d1, d2, points: pts.length, capacity: pts[0] ? pts[0].geometry.attributes.position.count : null, colorItem: pts[0] ? pts[0].geometry.attributes.color.itemSize : null, flashes };
      // draw call：只画粒子池那一个 Points
      const calls = () => { R.info.reset(); R.render(BR.gfx.scene, BR.gfx.camera); return R.info.render.calls; };
      const on = calls();
      pts[0].visible = false;
      const off = calls();
      pts[0].visible = true;
      out.high.drawCalls = on - off;
      __br.step(0.1);
      out.high.afterStep = A.fx.debugInfo().particles;

      BR.game.settings.quality = 'low';
      const n3 = A.fx.burst(x, y, z, { color: 0x00ffff, count: 500 });
      const d3 = A.fx.debugInfo();
      out.low = { n3, d3, points: findPoints().length };
      __br.step(3);
      const d4 = A.fx.debugInfo();
      out.expire = { particles: d4.particles, visible: pts[0].visible };
      BR.game.settings.quality = 'high';
      // 换层清空
      A.fx.burst(x, y, z, { count: 20, flash: false });
      const before = A.fx.debugInfo().particles;
      BR.bus.emit('level:leave', { id: BR.game.levelId });
      out.leave = { before, after: A.fx.debugInfo().particles, flashes };
    } finally {
      K.burstFx = orig;
      BR.game.settings.quality = 'high';
    }
    return out;
  });
  check('粒子池（高画质）：一次要 500 粒只给 200，再来 150 仍是 200；全场只有 1 个 Points，缓冲 200 粒、颜色 4 分量（带透明度）', r.high.n1 === 200 && r.high.d1.particles === 200 && r.high.d1.particleCap === 200 &&
    r.high.d2.particles === 200 && r.high.points === 1 && r.high.capacity === 200 && r.high.colorItem === 4, r.high);
  check('粒子池：画出来只多 1 个 draw call', r.high.drawCalls === 1, { drawCalls: r.high.drawCalls });
  check('粒子池：burst 复用 itemKit.burstFx 画中心光球（每次 burst 调一次，flash:false 不调）', r.high.flashes === 2 && r.leave.flashes === 3, { afterTwo: r.high.flashes, afterAll: r.leave.flashes });
  check('粒子池（低画质）：上限减半为 100，仍只有 1 个 Points', r.low.n3 === 100 && r.low.d3.particles === 100 && r.low.d3.particleCap === 100 && r.low.points === 1, r.low);
  check('粒子池：寿命到了全部清空、Points 隐藏；换层时清空', r.expire.particles === 0 && r.expire.visible === false && r.leave.before === 20 && r.leave.after === 0, { expire: r.expire, leave: r.leave });
}

// =====================================================================
// 4. 贴花
// =====================================================================
async function decals(page) {
  const r = await ev(page, () => {
    const W = BR.world, P = BR.player, R = BR.gfx.renderer, S = W.chunkSize;
    const LR = Math.max(1, (BR.config.world && BR.config.world.loadRadius) | 0 || 2);
    BR.game.settings.quality = 'high';
    const pc = W.chunkCoordsAt(P.x, P.z);
    const cA = { cx: pc.cx, cz: pc.cz }, cB = { cx: pc.cx + Math.min(LR, 2), cz: pc.cz };
    const keyA = cA.cx + ',' + cA.cz, keyB = cB.cx + ',' + cB.cz;
    const at = (c, i) => ({ x: (c.cx + 0.1 + 0.8 * ((i * 37 % 97) / 97)) * S, z: (c.cz + 0.1 + 0.8 * ((i * 53 % 89) / 89)) * S });
    const out = { keyA, keyB, loadRadius: LR };
    let okA = 0;
    for (let i = 0; i < 100; i++) { const p = at(cA, i); if (W.decal(p.x, p.z, { color: 0x221a12, radius: 0.5, ttl: 600 })) okA++; }
    out.a = { ok: okA, info: W.decalInfo() };
    let okB = 0;
    for (let i = 0; i < 20; i++) { const p = at(cB, i); if (W.decal(p.x, p.z, { color: 0x331100, radius: 0.4, ttl: 600 })) okB++; }
    out.b = { ok: okB, info: W.decalInfo() };
    const meshes = [];
    BR.gfx.scene.traverse(o => { if (o.isInstancedMesh && o.name === 'world decals') meshes.push(o); });
    out.meshes = meshes.length;
    out.notLoaded = W.decal((pc.cx + 50) * S + 1, pc.cz * S + 1, {});
    const calls = () => { R.info.reset(); R.render(BR.gfx.scene, BR.gfx.camera); return R.info.render.calls; };
    if (meshes[0]) {
      const on = calls();
      meshes[0].visible = false;
      const off = calls();
      meshes[0].visible = true;
      out.drawCalls = on - off;
      out.instanceCount = meshes[0].count;
      out.inChunkGroup = !!(W.chunkAt(P.x, P.z).res.group && meshes[0].parent === W.chunkAt(P.x, P.z).res.group);
    }

    BR.game.settings.quality = 'low';
    for (let i = 0; i < 10; i++) { const p = at(cB, 100 + i); W.decal(p.x, p.z, { color: 0x440000, radius: 0.3, ttl: 600 }); }
    out.low = W.decalInfo();
    BR.game.settings.quality = 'high';

    // 往东挪 LR+2 块：A（出生块）出了 R+1 圈被卸载，B 还在
    const shift = LR + 2;
    P.x += shift * S;
    __br.step(0.2);
    const cA2 = { x: (cA.cx + 0.5) * S, z: (cA.cz + 0.5) * S }, cB2 = { x: (cB.cx + 0.5) * S, z: (cB.cz + 0.5) * S };
    out.unload = { aLoaded: !!W.chunkAt(cA2.x, cA2.z), bLoaded: !!W.chunkAt(cB2.x, cB2.z), info: W.decalInfo() };

    // ttl：1 s 的那块，0.7 s 还在（在缩小），1.2 s 后没了
    const p = at(cB, 300);
    const placed = W.decal(p.x, p.z, { ttl: 1 });
    const c0 = W.decalInfo().count;
    __br.step(0.7);
    const c1 = W.decalInfo().count;
    __br.step(0.5);
    const c2 = W.decalInfo().count;
    out.ttl = { placed, c0, c1, c2 };

    // 重新开局（换层）全清、网格摘出场景
    __br.start({ mode: 'test', seed: 7, levelId: 'dev', settings: { visibility: 1, quality: 'high' } });
    __br.step(0.1);
    out.restart = W.decalInfo();
    return out;
  });
  check('贴花（高画质）：贴 100 块只留最新 64 块，再贴 20 块仍是 64 块（最老的被挤掉）', r.a.ok === 100 && r.a.info.count === 64 && r.a.info.cap === 64 && r.a.info.byChunk[r.keyA] === 64 &&
    r.b.ok === 20 && r.b.info.count === 64 && r.b.info.byChunk[r.keyA] === 44 && r.b.info.byChunk[r.keyB] === 20, { a: r.a, b: r.b });
  check('贴花：全场 1 个 InstancedMesh、实例数 = 块数、只多 1 个 draw call、不挂在区块 group 里；没载入的区块不贴', r.meshes === 1 && r.instanceCount === 64 && r.drawCalls === 1 && r.inChunkGroup === false && r.notLoaded === false,
    { meshes: r.meshes, instances: r.instanceCount, drawCalls: r.drawCalls, inChunkGroup: r.inChunkGroup, notLoaded: r.notLoaded });
  check('贴花（低画质）：上限减半为 32', r.low.count === 32 && r.low.cap === 32 && r.low.instances === 32, r.low);
  const u = r.unload;
  check('贴花：区块卸载后该块的贴花清空，仍载入的区块保留', !u.aLoaded && u.bLoaded && !u.info.byChunk[r.keyA] && u.info.byChunk[r.keyB] === r.low.byChunk[r.keyB] &&
    u.info.count === r.low.byChunk[r.keyB] && u.info.instances === u.info.count, { unload: u, lowByChunk: r.low.byChunk });
  check('贴花：ttl 到期消失（1 s 的那块 0.7 s 时还在、1.2 s 时没了）', r.ttl.placed && r.ttl.c1 === r.ttl.c0 && r.ttl.c2 === r.ttl.c0 - 1, r.ttl);
  check('贴花：重新开局全清、网格摘出场景', r.restart.count === 0 && !r.restart.inScene && !r.restart.visible, r.restart);
}

// =====================================================================
// 5. vanish / appear
// =====================================================================
async function fade(page) {
  const r = await ev(page, () => {
    const A = BR.arch, H = __vh, P = BR.player;
    const shared = H.shared(), glow = A.mat.glow(0xffffff);
    const out = {};
    const snap = (e, u, bi, gi) => ({
      state: e.state, visible: u.pivot.visible, a: u.fade ? +u.fade.a.toFixed(3) : null,
      bodyShared: u.rig.mesh.material[bi] === shared, glowShared: u.rig.mesh.material[gi] === glow,
      opacity: +u.rig.mesh.material[bi].opacity.toFixed(3), transparent: u.rig.mesh.material[bi].transparent,
      glowOpacity: +u.rig.mesh.material[gi].opacity.toFixed(3), scale: +u.pivot.scale.x.toFixed(3),
    });
    try {
      // --- 房主，高画质：透明度淡出 → 隐藏 → 淡回 → 换回共享材质 ---
      BR.game.settings.quality = 'high';
      const e = H.put(2, 0, 'vh-f1'), o = H.put(-2, 0, 'vh-f2');
      __br.step(0.05);
      const u = e.obj.userData.arch, bi = H.bodyIndex(e), gi = u.rig.slots.indexOf('glow');
      const live0 = A.fx.debugInfo().clones;
      const ret = A.fx.vanish(e, { sec: 0.5 });
      out.host = { ret, state0: e.state };
      __br.step(0.25);
      out.host.mid = snap(e, u, bi, gi);
      out.host.other = { bodyShared: o.obj.userData.arch.rig.mesh.material[bi] === shared, visible: o.obj.userData.arch.pivot.visible };
      out.host.sharedMid = { opacity: shared.opacity, transparent: shared.transparent, glowOpacity: glow.opacity };
      __br.step(0.4);
      out.host.gone = snap(e, u, bi, gi);
      A.fx.appear(e, { sec: 0.5 });
      out.host.state1 = e.state;
      __br.step(0.25);
      out.host.back = snap(e, u, bi, gi);
      __br.step(0.4);
      out.host.done = snap(e, u, bi, gi);
      out.host.done.fade = u.fade;
      out.host.clonesKept = A.fx.debugInfo().clones - live0;
      BR.entities.remove(e);
      BR.entities.remove(o);
      out.host.clonesAfterRemove = A.fx.debugInfo().clones - live0;

      // --- 客机：只收快照里的 state，animate 照样淡出淡回 ---
      BR.entities.clear();
      BR.entities.authoritative = false;
      const row = st => [['vh-g', '_vh_probe', +(P.x + 2).toFixed(2), +P.z.toFixed(2), 0, st, 100]];
      BR.entities.applySnapshot(row('idle'));
      __br.step(0.2);
      const g = BR.entities.get('vh-g');
      const gu = g && g.obj.userData.arch;
      out.guest = { created: !!g, remote: !!(g && g.remote), authoritative: BR.entities.authoritative };
      if (g) {
        BR.entities.applySnapshot(row('vanish'));
        __br.step(0.25);
        out.guest.mid = snap(g, gu, bi, gi);
        __br.step(0.6);
        out.guest.gone = snap(g, gu, bi, gi);
        BR.entities.applySnapshot(row('idle'));
        __br.step(0.8);
        out.guest.back = snap(g, gu, bi, gi);
        out.guest.back.fade = gu.fade;
      }
      BR.entities.authoritative = null;
      BR.entities.clear();

      // --- 低画质：不克隆材质，按比例缩小，最后隐藏 ---
      BR.game.settings.quality = 'low';
      const l = H.put(2, 0, 'vh-f3');
      __br.step(0.05);
      const lu = l.obj.userData.arch;
      const liveLow = A.fx.debugInfo().clones;
      A.fx.vanish(l, { sec: 0.4 });
      __br.step(0.2);
      out.low = { mid: snap(l, lu, bi, gi) };
      __br.step(0.4);
      out.low.gone = snap(l, lu, bi, gi);
      A.fx.appear(l, { sec: 0.4 });
      __br.step(0.8);
      out.low.back = snap(l, lu, bi, gi);
      out.low.back.fade = lu.fade;
      out.low.cloned = A.fx.debugInfo().clones - liveLow;
      BR.entities.remove(l);
    } finally {
      BR.game.settings.quality = 'high';
      BR.entities.authoritative = null;
      BR.entities.clear();
    }
    out.shared = { opacity: shared.opacity, transparent: shared.transparent, glowOpacity: glow.opacity, glowTransparent: glow.transparent };
    out.hp = { start: H.hp0, now: P.hp, dead: !!P.dead };
    return out;
  });
  const h = r.host;
  check('vanish：房主调用把 e.state 设成 vanish；淡到一半本实例换成副本材质、透明度约 0.5、仍可见，另一只和共享材质不受影响',
    h.ret === true && h.state0 === 'vanish' && h.mid.state === 'vanish' && !h.mid.bodyShared && !h.mid.glowShared && h.mid.transparent && h.mid.opacity > 0.3 && h.mid.opacity < 0.7 &&
    h.mid.glowOpacity > 0.3 && h.mid.glowOpacity < 0.7 && h.mid.visible && h.other.bodyShared && h.other.visible && h.sharedMid.opacity === 1 && h.sharedMid.transparent === false && h.sharedMid.glowOpacity === 1, h);
  check('vanish：淡完隐藏（pivot 不可见）', h.gone.visible === false && h.gone.a === 0, h.gone);
  check('appear：e.state 设成 appear，淡回途中可见、透明度约 0.5；淡完换回共享材质、状态记录清掉', h.state1 === 'appear' && h.back.visible && h.back.opacity > 0.3 && h.back.opacity < 0.7 &&
    h.done.visible && h.done.bodyShared && h.done.glowShared && h.done.fade === null && h.done.state === 'appear', { back: h.back, done: h.done });
  check('vanish/appear：副本留到实体移除时一起 dispose', h.clonesKept === 2 && h.clonesAfterRemove === 0, { kept: h.clonesKept, afterRemove: h.clonesAfterRemove });
  const g = r.guest;
  check('客机：快照 state=vanish 时 animate 照样淡出并隐藏，state 变回 idle 后淡回、换回共享材质', g.created && g.remote && g.authoritative === false && g.mid && g.mid.opacity > 0.3 && g.mid.opacity < 0.9 &&
    g.gone.visible === false && g.back.visible && g.back.bodyShared && g.back.fade === null, g);
  const l = r.low;
  check('低画质 vanish/appear：不克隆材质，按比例缩小、淡完隐藏，淡回后比例复原', l.cloned === 0 && l.mid.bodyShared && l.mid.scale > 0.3 && l.mid.scale < 0.7 && l.mid.visible &&
    l.gone.visible === false && l.back.visible && l.back.scale === 1 && l.back.fade === null, l);
  check('共享材质全程没被改：透明度 1、不透明', r.shared.opacity === 1 && r.shared.transparent === false && r.shared.glowOpacity === 1 && r.shared.glowTransparent === false, r.shared);
  check('测试模式：视觉钩子全程玩家不受伤', r.hp.now === r.hp.start && !r.hp.dead, r.hp);
}

async function main() {
  const srv = await startServer();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  console.log('static server ' + base);
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const { ctx, page } = await newPage(browser, base);
    const st = await setup(page);
    check('进入测试模式并注册探针实体', st.mode === 'test' && st.level === 'dev' && st.probe, st);
    await tint(page);
    await tintRender(page);
    await existing(page);
    await slotMat(page);
    await particles(page);
    await fade(page);
    await decals(page);   // 最后跑：里面会挪玩家、重新开局
    await ctx.close();
  } catch (err) {
    check('测试流程未中断', false, String(err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter(r => !r.ok);
  console.log('检查 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  for (const f of failed) console.log('  FAIL ' + f.name + '  ' + JSON.stringify(f.detail));
  console.log('页面报错 ' + errors.length + ' 条');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

main();
