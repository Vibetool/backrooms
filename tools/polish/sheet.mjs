// 后室 · 打磨联系表与前后对照（由 tools/polish/sheet.sh 调用，用法见那里）
//
// 联系表：一行一个类型，前 6 列依次是 1-front34 3/4 正面、2-side 正侧、3-back 背面、4-head 头部特写、5-low 低画质正面、6-level 首个出场层级；
//   这一页里有多形态实体时往后补 7-form-<形态名> 列（没有的格子留空）。
//   每格标注「类型名 | 机位」和 high 档三角面 / draw call（低画质格同时标 low 档，群体实体追加 +实例数x单只面数），状态不是 PASS 的加 [FAIL] / [KNOWN] / [ERROR]。
//   标注只用 ASCII：Arial 没有中文字形，写中文会变方块。
// 对照：magick compare -metric AE（fuzz 0）逐张比，像素完全相同计 0；只比两个 tag 都有的文件，单边才有的列进 onlyBefore / onlyAfter。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY = process.env.SHEET_IM_LEGACY === '1';
const VIEWS = [
  { n: 1, view: 'front34' }, { n: 2, view: 'side' }, { n: 3, view: 'back' },
  { n: 4, view: 'head' }, { n: 5, view: 'low' }, { n: 6, view: 'level' },
];
// 类型名里没有连字符，机位名里可以有（form-true）：第一个 -数字- 就是分界
const SHOT_RE = /^([A-Za-z0-9_]+)-(\d+)-([a-z0-9_-]+)\.png$/;
const FONT = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(f => fs.existsSync(f));
const FONT_ARGS = FONT ? ['-font', FONT] : [];
const BG = '#1c1c1c';

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('用法：tools/polish/sheet.sh <tag> [--out tests/output/gallery] [--per 8] [--thumb 220]\n' +
    '      tools/polish/sheet.sh --compare <before> <after> [--out tests/output/gallery] [--changed-only] [--jobs 8] [--thumb 220]');
  process.exit(code);
}

const opts = { out: 'tests/output/gallery', per: 8, thumb: 220, jobs: 8, changedOnly: false, compare: null };
const pos = [];
{
  const a = process.argv.slice(2);
  const need = (i, name) => { if (a[i] === undefined || a[i].startsWith('--')) usage(2, name + ' 缺参数'); return a[i]; };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '--compare') { opts.compare = [need(i + 1, '--compare'), need(i + 2, '--compare')]; i += 2; }
    else if (x === '--out') opts.out = need(++i, '--out');
    else if (x === '--per') opts.per = Math.max(1, +need(++i, '--per') | 0);
    else if (x === '--thumb') opts.thumb = Math.max(64, +need(++i, '--thumb') | 0);
    else if (x === '--jobs') opts.jobs = Math.max(1, +need(++i, '--jobs') | 0);
    else if (x === '--changed-only') opts.changedOnly = true;
    else if (x === '-h' || x === '--help') usage(0);
    else if (x.startsWith('--')) usage(2, '未知参数 ' + x);
    else pos.push(x);
  }
}
const OUT = path.resolve(ROOT, opts.out);

// IM7：magick <子命令>；IM6：子命令本身就是可执行文件（sub 为 null 表示直接生成图片，IM6 对应 convert）
function imCmd(sub, args) {
  if (sub === null) return LEGACY ? ['convert', args] : ['magick', args];
  return LEGACY ? [sub, args] : ['magick', [sub, ...args]];
}
function runIm(sub, args) {
  const [cmd, a] = imCmd(sub, args);
  const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${sub || ''} 退出码 ${r.status}：${String(r.stderr || '').slice(0, 800)}`);
  return r;
}
// ImageMagick 会展开标注里的 % 转义
const esc = s => String(s).replace(/%/g, '%%');
const fmt = v => (v == null || Number.isNaN(v) ? '?' : String(v));
const dcOf = s => (s && (s.drawCalls != null || s.drawCallsStatic != null) ? Math.max(s.drawCalls || 0, s.drawCallsStatic || 0) : null);
const swarmOf = s => (s && Array.isArray(s.swarm) && s.swarm.length ? ' +' + s.swarm.map(x => `${x.instances}x${x.unitTris}`).join('+') : '');
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

function placeholder(dir) {
  const f = path.join(dir, '.missing.png');
  if (!fs.existsSync(f)) runIm(null, ['-size', '640x640', 'xc:#2b2b2b', ...FONT_ARGS, '-fill', '#8a8a8a', '-pointsize', '44', '-gravity', 'center', '-annotate', '+0+0', 'no image', f]);
  return f;
}
// 补齐列用的空格子：和背景同色，看起来就是没有
function blank(dir) {
  const f = path.join(dir, '.blank.png');
  if (!fs.existsSync(f)) runIm(null, ['-size', '640x640', 'xc:' + BG, f]);
  return f;
}
function shotsIn(dir) {
  const m = new Map();
  for (const f of fs.readdirSync(dir)) {
    const x = SHOT_RE.exec(f);
    if (x) m.set(f, { type: x[1], n: +x[2], view: x[3] });
  }
  return m;
}
const byShot = (p, q) => p.n - q.n || p.view.localeCompare(q.view);

// ---------- 联系表 ----------
function sheets(tag) {
  const dir = path.join(OUT, tag);
  if (!fs.existsSync(dir)) usage(2, '没有这个 tag 目录：' + dir);
  const doc = readJson(path.join(dir, 'gallery.json'));
  const all = shotsIn(dir);
  const types = doc && doc.types && Object.keys(doc.types).length
    ? Object.keys(doc.types).sort()
    : [...new Set([...all.values()].map(x => x.type))].sort();   // 没有 gallery.json（跑到一半崩了）也能按文件名拼
  if (!types.length) usage(2, '目录里没有出图：' + dir);
  const extraOf = t => [...all.entries()].filter(([, x]) => x.type === t && x.n >= 7).map(([f, x]) => ({ f, ...x })).sort(byShot);
  const sdir = path.join(dir, 'sheets');
  fs.mkdirSync(sdir, { recursive: true });
  for (const f of fs.readdirSync(sdir)) if (/^sheet-\d+\.png$/.test(f)) fs.unlinkSync(path.join(sdir, f));   // 类型变少时别留下旧页
  const ph = placeholder(sdir), bl = blank(sdir);
  const pages = [];
  for (let i = 0; i < types.length; i += opts.per) pages.push(types.slice(i, i + opts.per));
  const outs = [];
  pages.forEach((pg, pi) => {
    const extra = Math.max(0, ...pg.map(t => extraOf(t).length));
    const args = [...FONT_ARGS, '-pointsize', '12', '-fill', '#e8e8e8', '-background', BG];
    for (const t of pg) {
      const rec = (doc && doc.types && doc.types[t]) || {};
      const hi = rec.high || null, lo = rec.low || null;
      const mark = rec.status && rec.status !== 'PASS' ? ` [${rec.status}]` : '';
      const hiTxt = `HI ${fmt(hi && hi.tris)} tri${swarmOf(hi)} | ${fmt(dcOf(hi))} dc`;
      for (const v of VIEWS) {
        const f = path.join(dir, `${t}-${v.n}-${v.view}.png`);
        const line2 = v.view === 'low' ? `LOW ${fmt(lo && lo.tris)} tri${swarmOf(lo)} | ${fmt(dcOf(lo))} dc  (${hiTxt})` : hiTxt;
        args.push('-label', esc(`${t} | ${v.view}${mark}\n${line2}`), fs.existsSync(f) ? f : ph);
      }
      const ex = extraOf(t);
      for (let j = 0; j < extra; j++) {
        if (ex[j]) args.push('-label', esc(`${t} | ${ex[j].view}${mark}\n${hiTxt} (base pose)`), path.join(dir, ex[j].f));
        else args.push('-label', ' ', bl);
      }
    }
    const out = path.join(sdir, `sheet-${String(pi + 1).padStart(2, '0')}.png`);
    args.push('-tile', `${VIEWS.length + extra}x${pg.length}`, '-geometry', `${opts.thumb}x${opts.thumb}+3+3`,
      '-title', esc(`${tag}   sheet ${pi + 1}/${pages.length}   ${pg[0]} .. ${pg[pg.length - 1]}`), out);
    runIm('montage', args);
    outs.push(out);
    console.log(path.relative(ROOT, out) + '  ' + pg.join(' '));
  });
  console.log(`联系表 ${outs.length} 张（${types.length} 种，每张 ${opts.per} 种）`);
}

// ---------- 前后对照 ----------
function aeOf(a, b) {
  return new Promise(resolve => {
    const [cmd, args] = imCmd('compare', ['-metric', 'AE', a, b, 'null:']);
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      // IM7 输出形如 "64 (1)"；退出码 0 = 相同、1 = 不同、2 = 出错（尺寸不一致等）
      const txt = String(stderr || stdout || '').trim();
      const code = err ? err.code : 0;
      const v = parseFloat(txt);
      if ((code === 0 || code === 1) && Number.isFinite(v)) resolve({ ae: Math.round(v) });
      else resolve({ error: (txt || String(err && err.message)).slice(0, 300) });
    });
  });
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, Math.max(1, items.length)) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

async function compare(before, after) {
  const bd = path.join(OUT, before), ad = path.join(OUT, after);
  for (const d of [bd, ad]) if (!fs.existsSync(d)) usage(2, '没有这个 tag 目录：' + d);
  const B = shotsIn(bd), A = shotsIn(ad);
  const common = [...B.keys()].filter(f => A.has(f)).sort();
  const aes = new Map();
  const t0 = Date.now();
  await pool(common, opts.jobs, async f => { aes.set(f, await aeOf(path.join(bd, f), path.join(ad, f))); });
  const typesB = new Set([...B.values()].map(x => x.type)), typesA = new Set([...A.values()].map(x => x.type));
  const types = {}, columns = {};
  let shots = 0, changedShots = 0, errorsN = 0;
  for (const t of [...typesB].filter(x => typesA.has(x)).sort()) {
    const keys = new Map();
    for (const x of [...B.values(), ...A.values()]) if (x.type === t) keys.set(`${x.n}-${x.view}`, x);
    const cols = [...keys.values()].sort(byShot);
    const rec = { ae: 0, changed: false, changedShots: 0, shots: {}, onlyBefore: [], onlyAfter: [] };
    for (const x of cols) {
      const key = `${x.n}-${x.view}`, f = `${t}-${key}.png`;
      if (!A.has(f)) { rec.onlyBefore.push(key); continue; }
      if (!B.has(f)) { rec.onlyAfter.push(key); continue; }
      const r = aes.get(f);
      shots++;
      if (r.error) { rec.shots[key] = null; (rec.errors = rec.errors || {})[key] = r.error; rec.changedShots++; errorsN++; continue; }
      rec.shots[key] = r.ae;
      rec.ae += r.ae;
      if (r.ae > 0) rec.changedShots++;
    }
    rec.changed = rec.changedShots > 0 || rec.onlyBefore.length > 0 || rec.onlyAfter.length > 0;
    changedShots += rec.changedShots;
    types[t] = rec;
    columns[t] = cols;
  }
  const doc = {
    before, after, generatedAt: new Date().toISOString(),
    method: 'magick compare -metric AE（fuzz 0）：不同像素个数，像素完全相同 = 0；null = 比较出错（见 errors，常见是尺寸不一致）',
    totals: {
      types: Object.keys(types).length, shots, changedShots, errors: errorsN,
      changedTypes: Object.keys(types).filter(t => types[t].changed),
      ms: Date.now() - t0,
    },
    onlyBefore: [...typesB].filter(x => !typesA.has(x)).sort(),
    onlyAfter: [...typesA].filter(x => !typesB.has(x)).sort(),
    types,
  };
  const jsonFile = path.join(OUT, `compare-${before}-${after}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(doc, null, 2));

  const cdir = path.join(OUT, `compare-${before}-${after}`);
  fs.mkdirSync(cdir, { recursive: true });
  for (const f of fs.readdirSync(cdir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(cdir, f));
  const ph = placeholder(cdir);
  let made = 0;
  for (const t of Object.keys(types)) {
    const rec = types[t];
    if (opts.changedOnly && !rec.changed) continue;
    const args = [...FONT_ARGS, '-pointsize', '13', '-fill', '#e8e8e8', '-background', BG];
    for (const row of ['before', 'after']) {
      for (const x of columns[t]) {
        const key = `${x.n}-${x.view}`;
        const src = path.join(row === 'before' ? bd : ad, `${t}-${key}.png`);
        const aeTxt = rec.shots[key] != null ? String(rec.shots[key]) : rec.errors && rec.errors[key] ? 'ERR' : '-';
        const lab = row === 'before' ? `${before} | ${x.view}` : `${after} | ${x.view} | AE ${aeTxt}`;
        args.push('-label', esc(lab), fs.existsSync(src) ? src : ph);
      }
    }
    args.push('-tile', `${columns[t].length}x2`, '-geometry', `${opts.thumb}x${opts.thumb}+3+3`,
      '-title', esc(`${t}   ${before} -> ${after}   AE ${rec.ae}${rec.changed ? '' : '   identical'}`), path.join(cdir, t + '.png'));
    runIm('montage', args);
    made++;
  }
  console.log(`对照 ${before} → ${after}：${doc.totals.types} 种、${shots} 张，有差异 ${changedShots} 张（${doc.totals.changedTypes.length} 种：${doc.totals.changedTypes.join(' ') || '无'}），比较出错 ${errorsN} 张`);
  if (doc.onlyBefore.length || doc.onlyAfter.length) console.log(`  只在 ${before}：${doc.onlyBefore.join(' ') || '无'}；只在 ${after}：${doc.onlyAfter.join(' ') || '无'}`);
  console.log(`写入 ${path.relative(ROOT, jsonFile)}；并排图 ${made} 张 → ${path.relative(ROOT, cdir)}/`);
  if (errorsN) process.exitCode = 1;
}

if (opts.compare) await compare(opts.compare[0], opts.compare[1]);
else if (pos.length === 1) sheets(pos[0]);
else usage(2);
