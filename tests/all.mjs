// 后室 · 全量回归：node tests/all.mjs [--quick] [--only a,b] [--skip a,b] [--jobs N] [--timeout-min N] [--verbose] [--list]
//
// 为什么要有它：后面每个里程碑发布前都要"全量测试"，十几个脚本一个个手敲、再逐个翻日志看过没过太费额度。
// 缺省串行跑完全部回归（SwiftShader 很吃 CPU，并行跑会让 coop 握手、计时类检查互相拖垮），每个子进程输出写进
// tests/output/all/<名称>.log，最后打印一张汇总表，并写 tests/output/all/summary.txt / summary.json。
// --jobs N：同时跑 N 项（缺省 1）。叉车测试（forklift-<组>）全靠 __br.step 推模拟时间、不看墙钟，分组并行不影响结果；
//   coop / camp 这类真等计时的，机器忙时可能偶发超时（coop 照旧失败重跑一次），要稳就别和它们一起开太多。
// 叉车（FE1，2026-10-06）：tests/forklift.mjs 按组拆成 forklift-data、forklift-mount … forklift-perf 十三项（含 side）（每项 --group <组>），
//   dark、perf 两组要截图量像素，算截图类（--quick 跳过）；tests/forklift_probe.mjs 是只读探针（出表给主会话和家长看），不自动跑。
//
// 跑哪些（按这个顺序）：
//   1. tests/ 下的回归脚本：phys.test.js、smoke、kit、items、coop、camp、settings、workshop、workshop_core、workshop_ui、infection、visualhooks，
//      以及以后新加的其他 *.mjs / *.test.js（自动发现，文件名以 _ 开头的当辅助模块跳过；all / online / golden / preview 单独处理）
//   2. golden.mjs 比对模式（tests/golden/ 下还没有任何基线 JSON 时标"无基线跳过"，不算失败）
//   3. preview.mjs --arch
//   4. preview.mjs --scale <id>：id 取 js/core/base.js 里的 BR.LEVEL_ORDER（首期 23 层，不含 dev）
// 规则：
//   - coop 失败自动重跑一次（大厅握手在机器高负载时偶发超时），表里标"重试"；首次日志留在 coop.try1.log
//   - 叉车各组（forklift-<组>）超时放宽到 45 分钟；失败 / 超时先不判，等这一轮别的项都跑完、机器空下来以后单独重跑一次再判
//     （FE1 返修 r3：几个代理同时跑、负载 70–115 时，能过的组会撞上 25 分钟上限被判超时）。--jobs 1 时就是紧接着重跑
//   - --quick：跳过源码里调用了 .screenshot( 的截图类脚本；golden、--arch、--scale 始终保留
//   - 单项超时（缺省 25 分钟；coop 40 分钟——联机营地起每一步都多进一次营地、还有冻结 45 s、断网 10 s、等重连超时这些真等的步骤；
//     --scale 5 分钟；--timeout-min 统一改）先 SIGTERM 让 Playwright 关掉浏览器，10 秒后 SIGKILL
//   - 子进程打印完自己的汇总后 20 秒还没退出，就结束它、按汇总行判定结果：Chrome 退出后遗留的 crashpad 进程会占着
//     stdio 管道，Playwright 的 browser.close() 要等管道关上才返回，实测能把 18 秒的脚本拖到 5 分钟（表里记"退出拖延"）
//   - 任何一项失败 / 超时，退出码 1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const LOG_DIR = path.join(TESTS, 'output', 'all');
const EXIT_GRACE_MS = 20000;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const csv = v => (v && v !== true ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
const QUICK = !!arg('quick', false);
const VERBOSE = !!arg('verbose', false);
const ONLY = csv(arg('only', null));
const SKIP = csv(arg('skip', null)) || [];
const TIMEOUT_MIN = arg('timeout-min', null) && arg('timeout-min') !== true ? +arg('timeout-min') : null;
const JOBS = Math.max(1, Math.min(8, arg('jobs', null) && arg('jobs') !== true ? (+arg('jobs') | 0) || 1 : 1));

// ---------- 层级顺序：直接跑 base.js 读 BR.LEVEL_ORDER，和游戏里同一份来源，以后加层不用改这里 ----------
function levelOrder() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'core', 'base.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'js/core/base.js' });
  const order = sandbox.window.BR && sandbox.window.BR.LEVEL_ORDER;
  if (!Array.isArray(order) || !order.length) throw new Error('js/core/base.js 里读不到 BR.LEVEL_ORDER');
  return order.map(String);
}

// ---------- 测试清单 ----------
// camp.mjs：联机营地（隐藏层 coopcamp）的单页检查，紧跟 coop；营地不在 LEVEL_ORDER，不跑 --scale、不进入库 golden
const KNOWN = ['phys.test.js', 'smoke.mjs', 'mobile.mjs', 'kit.mjs', 'items.mjs', 'coop.mjs', 'camp.mjs', 'forklift_l1.mjs', 'forklift.mjs', 'settings.mjs', 'workshop.mjs', 'workshop_core.mjs', 'workshop_ui.mjs', 'infection.mjs', 'visualhooks.mjs'];
const TIMEOUT_OF = { 'coop.mjs': 50 };   // 分钟；没列的按 25。coop 从 FE1 起最后多一段叉车联机（再进一次营地、出发进 L1）
// forklift_probe.mjs：叉车只读探针（第三层货架头顶遮挡比例、出生车附近能叉的货的可达性），只出表、不判过不过，不自动跑
const SPECIAL = new Set(['all.mjs', 'online.mjs', 'golden.mjs', 'preview.mjs', 'forklift_probe.mjs']);
// tests/forklift.mjs 按组拆开登记（每组一个新浏览器上下文、互不依赖）；SHOT 里的组要截图量像素，算截图类
const FORKLIFT_GROUPS = ['data', 'mount', 'drive', 'crash', 'side', 'lift', 'items', 'exits', 'life', 'pause', 'nightmare', 'dark', 'perf'];
const FORKLIFT_SHOT = new Set(['dark', 'perf']);
// "汇总已打印"的标志：各脚本只在最后的汇总段里打印这些行。preview 单独给，因为 --arch 中途也会打 PASS/FAIL
const DONE_DEFAULT = /页面报错 \d+ 条|\d+ 条页面错误|^phys: \d+ 通过/m;

function buildItems() {
  const files = fs.readdirSync(TESTS).filter(f => /(\.mjs|\.test\.js)$/.test(f) && !SPECIAL.has(f) && !f.startsWith('_') && fs.statSync(path.join(TESTS, f)).isFile());
  const ordered = KNOWN.filter(f => files.includes(f)).concat(files.filter(f => !KNOWN.includes(f)).sort());
  const items = [];
  for (const f of ordered) {
    if (f === 'forklift.mjs') {
      for (const g of FORKLIFT_GROUPS) items.push({ name: 'forklift-' + g, args: ['tests/forklift.mjs', '--group', g], shots: FORKLIFT_SHOT.has(g), retry: 0, retryAlone: 1, timeoutMin: 45, doneMark: DONE_DEFAULT });
      continue;
    }
    if (f === 'forklift_l1.mjs') {
      // L1 叉车数据与可动模型：--quick 只跑 10 个种子；本机有开工前的快照（tests/output/golden-tags/FE1-before/forklift_l1.json，gitignore）
      // 就带 --against FE1-before 逐项比对，没有就只跑不依赖快照的检查（快照怎么重拍见 forklift_l1.mjs 文件头）
      const args = ['tests/forklift_l1.mjs'];
      if (QUICK) args.push('--quick');
      if (fs.existsSync(path.join(TESTS, 'output', 'golden-tags', 'FE1-before', 'forklift_l1.json'))) args.push('--against', 'FE1-before');
      items.push({ name: 'forklift_l1', args, shots: false, retry: 0, timeoutMin: 25, doneMark: DONE_DEFAULT });
      continue;
    }
    const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
    items.push({
      name: f.replace(/\.test\.js$|\.mjs$/, ''),
      args: ['tests/' + f],
      shots: /\.screenshot\(/.test(src),
      retry: f === 'coop.mjs' ? 1 : 0,
      timeoutMin: TIMEOUT_OF[f] || 25,
      doneMark: DONE_DEFAULT,
    });
  }
  items.push({
    name: 'golden', args: ['tests/golden.mjs'], shots: false, retry: 0, timeoutMin: 25, doneMark: DONE_DEFAULT,
    // 基线要等出图工具拍完 base 图后统一入库；没有基线时跑了也只能全 SKIP，直接标出来省一次浏览器启动
    noBaseline: () => {
      const dir = path.join(TESTS, 'golden');
      return !fs.existsSync(dir) || !fs.readdirSync(dir).some(f => f.endsWith('.json'));
    },
  });
  items.push({ name: 'arch', args: ['tests/preview.mjs', '--arch'], shots: false, retry: 0, timeoutMin: 25, doneMark: /===== BR\.arch 自检：\d+ 项，失败 \d+ 项/ });
  for (const id of levelOrder()) {
    items.push({ name: 'scale-' + id, args: ['tests/preview.mjs', '--scale', id], shots: false, retry: 0, timeoutMin: 5, doneMark: /^PREVIEW_JSON /m });
  }
  return items;
}

// ---------- 子进程 ----------
const running = new Set();   // 正在跑的子进程（--jobs 时可能有好几个）
function killTree(child) {
  // detached 让子进程自成进程组：SIGTERM 发给整组，Playwright 收到后会关掉自己拉起的 Chrome
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { /* 已退出 */ }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* 已退出 */ } }, 10000).unref();
}

function runOne(item, logFile) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const out = fs.createWriteStream(logFile);
    out.write(`# node ${item.args.join(' ')}\n# ${new Date().toISOString()}\n\n`);
    let text = '';
    let settled = false;
    let timedOut = false;
    let afterSummary = false;
    let graceTimer = null;
    const child = spawn(process.execPath, item.args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    running.add(child);
    const onData = d => {
      const s = d.toString();
      text += s;
      out.write(s);
      if (VERBOSE && JOBS === 1) process.stdout.write(s);
      // 只看尾部：日志可能几百 KB，每块数据都全文匹配没必要
      if (!graceTimer && item.doneMark && item.doneMark.test(text.slice(-8000))) {
        graceTimer = setTimeout(() => { afterSummary = true; killTree(child); }, EXIT_GRACE_MS);
        graceTimer.unref();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const limit = (TIMEOUT_MIN || item.timeoutMin) * 60000;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, limit);
    const finish = (code, signal, spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      running.delete(child);
      const ms = Date.now() - t0;
      if (spawnErr) text += '\n' + spawnErr;
      const note = timedOut ? ' 超时' : afterSummary ? ' 汇总后 ' + EXIT_GRACE_MS / 1000 + 's 仍未退出，已结束进程' : '';
      out.end(`\n# exit ${code}${signal ? ' ' + signal : ''}${note}  ${(ms / 1000).toFixed(1)}s\n`, () => resolve({ code, signal, timedOut, afterSummary, text, ms }));
    };
    child.on('error', err => finish(-1, null, String(err)));
    // 等 close（stdio 读完）；万一孙进程占着管道不放，exit 之后最多再等 3 秒
    child.on('exit', (code, signal) => setTimeout(() => finish(code, signal), 3000).unref());
    child.on('close', (code, signal) => finish(code, signal));
  });
}

// ---------- 解析各脚本自己的汇总行 ----------
function lastMatch(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');   // 保留 m 这类标志（「跳过 N 项」按行首行尾匹配）
  let m, r = null;
  while ((m = g.exec(text))) r = m;
  return r;
}
function parse(text) {
  let total = null, failed = null, errs = null, m;
  if ((m = lastMatch(text, /检查 (\d+) 项，(?:通过 \d+ 项，)?失败 (\d+) 项/))) { total = +m[1]; failed = +m[2]; }
  else if ((m = lastMatch(text, /BR\.arch 自检：(\d+) 项，失败 (\d+) 项/))) { total = +m[1]; failed = +m[2]; }
  else if ((m = lastMatch(text, /phys: (\d+) 通过, (\d+) 失败/))) { total = +m[1] + +m[2]; failed = +m[2]; }
  else if ((m = lastMatch(text, /(?:(\d+) 项失败|全部通过)，共 (\d+) 项检查；(\d+) 条页面错误/))) { total = +m[2]; failed = m[1] ? +m[1] : 0; errs = +m[3]; }
  else {
    // 没有汇总行（preview --scale 这类）：数行首的 PASS / FAIL
    const pass = (text.match(/^\s*PASS\b/gm) || []).length;
    const fail = (text.match(/^\s*FAIL\b/gm) || []).length;
    if (pass + fail) { total = pass + fail; failed = fail; }
  }
  if ((m = lastMatch(text, /页面报错 (\d+) 条/))) errs = +m[1];
  // 前提不成立（机器太忙）记了 SKIP 的检查：脚本汇总里「跳过 N 项」那一行（mobile、coop）。不算失败，表里单独一列，免得全过却实际没测到
  const skips = (m = lastMatch(text, /^跳过 (\d+) 项$/m)) ? +m[1] : 0;
  return { total, failed, errs, skips };
}

// ---------- 表格 ----------
const cw = s => { let w = 0; for (const ch of String(s)) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1; return w; };
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - cw(s)));
function table(head, rows) {
  const w = head.map((h, i) => Math.max(cw(h), ...rows.map(r => cw(r[i]))));
  const line = r => r.map((c, i) => pad(c, w[i])).join('  ').replace(/\s+$/, '');
  return [line(head), w.map(x => '-'.repeat(x)).join('  '), ...rows.map(line)].join('\n');
}
const fmtMs = ms => {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
};
const LABEL = { pass: '通过', fail: '失败', timeout: '超时', quick: '跳过(--quick)', nobase: '无基线跳过' };

// ---------- 主流程 ----------
const summary = [];
const t0 = Date.now();

function report() {
  const rows = summary.map(r => [
    r.name, LABEL[r.status] || r.status,
    r.total != null ? (r.total - (r.failed || 0)) + '/' + r.total : '—',
    r.failed != null ? r.failed : '—',
    r.errs != null ? r.errs : '—',
    fmtMs(r.ms) + (r.afterSummary ? '*' : ''),
    r.retried ? '重试' : '',
    r.skips ? String(r.skips) : '',
  ]);
  const bad = summary.filter(r => r.status === 'fail' || r.status === 'timeout');
  const lagged = summary.filter(r => r.afterSummary).length;
  const head = ['名称', '结果', '通过/总数', '失败', '页面报错', '耗时', '是否重试', '记 SKIP'];
  const lines = [
    '',
    `===== tests/all.mjs 汇总${QUICK ? '（--quick）' : ''} =====`,
    table(head, rows),
    '',
    `共 ${summary.length} 项：通过 ${summary.filter(r => r.status === 'pass').length}，失败 ${bad.length}，跳过 ${summary.filter(r => r.status === 'quick' || r.status === 'nobase').length}；总耗时 ${fmtMs(Date.now() - t0)}`,
  ];
  if (lagged) lines.push(`* ${lagged} 项打印完汇总后 ${EXIT_GRACE_MS / 1000}s 仍未退出（浏览器关闭被拖住），已结束进程、按汇总行判定`);
  const sk = summary.filter(r => r.skips > 0);
  if (sk.length) lines.push(`记 SKIP 的检查（前提不成立，没真测到，见各自日志里的 SKIP 行）：${sk.map(r => r.name + ' ' + r.skips + ' 项').join('，')}`);
  lines.push(bad.length ? '失败项日志：' + bad.map(r => path.relative(ROOT, r.log)).join('  ') : '全部通过');
  const txt = lines.join('\n');
  console.log(txt);
  try {
    fs.writeFileSync(path.join(LOG_DIR, 'summary.txt'), txt.trimStart() + '\n');
    fs.writeFileSync(path.join(LOG_DIR, 'summary.json'), JSON.stringify({ quick: QUICK, finishedAt: new Date().toISOString(), ms: Date.now() - t0, items: summary.map(r => ({ ...r, log: r.log ? path.relative(ROOT, r.log) : null })) }, null, 2) + '\n');
  } catch (e) { /* 汇总写盘失败不影响退出码 */ }
  return bad.length;
}

process.on('SIGINT', () => {
  console.log('\n收到 Ctrl-C，停止正在跑的子进程');
  for (const c of running) killTree(c);
  report();
  process.exit(130);
});

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  let items = buildItems();
  if (arg('list', false)) {
    for (const it of items) console.log(pad(it.name, 16) + ' node ' + it.args.join(' ') + (it.shots ? '   [截图类，--quick 跳过]' : '') + (it.retry ? '   [失败重跑 ' + it.retry + ' 次]' : '') + (it.retryAlone ? '   [失败等别的跑完单独重跑 ' + it.retryAlone + ' 次]' : ''));
    return;
  }
  const all = items.length;
  const hit = (list, name) => list.some(o => name === o || (o.endsWith('*') && name.startsWith(o.slice(0, -1))));
  if (ONLY) items = items.filter(it => hit(ONLY, it.name));
  if (SKIP.length) items = items.filter(it => !hit(SKIP, it.name));
  if (items.length < all) console.log(`（--only / --skip 过滤掉 ${all - items.length} 项）`);

  // 每一项：跑、按汇总行判定、失败按 retry 重跑；结果按清单顺序写进 summary（并行时也是这个顺序）
  const recs = new Array(items.length);
  const deferred = [];   // 失败 / 超时、等这一轮别的都跑完再单独重跑的（retryAlone）
  async function runItem(i, alone) {
    const it = items[i];
    const tag = `[${String(i + 1).padStart(2)}/${items.length}] ${it.name}`;
    const log = path.join(LOG_DIR, it.name + '.log');
    if (!alone && QUICK && it.shots) { recs[i] = { name: it.name, status: 'quick' }; console.log(`${tag}  跳过（截图类，--quick）`); return; }
    if (!alone && it.noBaseline && it.noBaseline()) { recs[i] = { name: it.name, status: 'nobase' }; console.log(`${tag}  无基线跳过（tests/golden/ 下没有 JSON）`); return; }
    // 机器空下来以后单独重跑（alone）：允许的重跑次数就是 retryAlone；--jobs 1 时本来就是单独跑，失败了紧接着重跑
    const maxRetry = alone ? 0 : it.retry + (JOBS === 1 ? (it.retryAlone || 0) : 0);

    let attempt = alone ? 1 : 0, rec;
    while (true) {
      if (JOBS === 1) process.stdout.write(`${tag}  运行中${attempt ? '（重试）' : ''}… `);
      else console.log(`${tag}  开始${attempt ? '（重试）' : ''}`);
      const r = await runOne(it, log);
      const p = parse(r.text);
      let status;
      if (r.timedOut) status = 'timeout';
      else if (it.name === 'golden' && r.code === 3) status = 'nobase';
      // 汇总后被结束的进程拿不到脚本自己的退出码：按汇总行判，和各脚本 exitCode = 失败项 || 页面报错 的规则一致
      else if (r.afterSummary) status = p.total != null && !(p.failed > 0) && !(p.errs > 0) ? 'pass' : 'fail';
      else if (r.code === 0 && !(p.failed > 0)) status = 'pass';
      else status = 'fail';
      rec = { name: it.name, status, code: r.code, ...p, ms: r.ms, retried: attempt > 0, afterSummary: r.afterSummary, log };
      console.log(`${JOBS === 1 ? '' : tag + '  '}${LABEL[status]}  ${p.total != null ? (p.total - (p.failed || 0)) + '/' + p.total : ''}${p.errs ? '  页面报错 ' + p.errs : ''}${p.skips ? '  记 SKIP ' + p.skips + ' 项' : ''}  ${fmtMs(r.ms)}${r.afterSummary ? '（退出拖延，已结束进程）' : ''}  → ${path.relative(ROOT, log)}`);
      if ((status === 'fail' || status === 'timeout') && !alone && JOBS > 1 && it.retryAlone && attempt >= it.retry) {
        // 并行跑时失败：先不判，日志留档，等这一轮别的都跑完单独重跑
        fs.renameSync(log, path.join(LOG_DIR, it.name + '.try' + (attempt + 1) + '.log'));
        console.log(`${tag}  先记下，等别的项跑完单独重跑一次`);
        deferred.push(i);
        break;
      }
      if ((status === 'fail' || status === 'timeout') && attempt < maxRetry) {
        // 首次失败的日志留档：重试过了也要能回头查是哪一步超时
        fs.renameSync(log, path.join(LOG_DIR, it.name + '.try' + (attempt + 1) + '.log'));
        attempt++;
        continue;
      }
      break;
    }
    recs[i] = rec;
  }
  if (JOBS > 1) console.log(`（--jobs ${JOBS}：同时跑 ${JOBS} 项）`);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await runItem(i); } };
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, worker));
  if (deferred.length) console.log(`（单独重跑 ${deferred.length} 项：${deferred.map(i => items[i].name).join(' ')}）`);
  for (const i of deferred) await runItem(i, true);
  for (const r of recs) if (r) summary.push(r);
  process.exitCode = report() ? 1 : 0;
}

main().catch(err => {
  console.log('tests/all.mjs 自身出错：' + ((err && err.stack) || err));
  process.exitCode = 1;
});
