// 后室 · 测试模式面板：手动放出实体、召唤测试人、清除全部
// 接口见 ARCHITECTURE.md 第 2、12 节 BR.test。DOM 在 #ui 里自建（class 前缀 test-），样式由本文件注入 <style class="test-style">
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 常量 ----------
const RAY_MAX = 6;            // 沿视线最远找 6 m
const RAY_BACK = 0.8;         // 命中墙面后往回退，别把实体塞进墙里
const MISS_DIST = 4;          // 视线没打到东西就放前方 4 m
const MIN_AHEAD = 1.2;        // 离玩家的水平距离下限：低头看地时视线点就在自己脚下
const PAD = 0.15;             // 实体和玩家之间至少留的空隙
const RING_STEP = 0.6;        // 落点被挡时一圈圈往外找空位
const RING_COUNT = 5;         // 最远找到 3 m 外
const CHEST = 1.0;            // 查"隔没隔墙"用的高度：高过矮箱子、低于门框
const DEF_RADIUS = 0.4;
const DEF_HEIGHT = 1.8;
const COUNT_MS = 250;
const HINT_MS = 500;
const POLL_MS = 250;          // main 暂停/结算时可能不调 update，靠轮询兜底收起入口和面板
const OPEN_GUARD_MS = 400;    // 触屏按下就开面板，同一下手指抬起可能在刚出现的列表项上补一个 click
const EDGE_DEDUP_MS = 200;    // 自己的 T 键监听和 input 的 'testmenu' 边沿是同一次按键，别开了又关
const DUMMY = 'test_dummy';
const DEV_PREFIX = '_dev_';

// 阵营 → [标签, 样式后缀]；dummy 不会出现在列表里
const FACTION = {
  hostile: ['有害', 'hostile'],
  friendly: ['友善', 'friendly'],
  neutral: ['中立', 'neutral'],
};

const FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';

// 每组里前一条声明是不认 env() 的老内核的兜底，认的会被后一条覆盖
const CSS = [
  '.test-root,.test-entry,.test-hint{font-family:' + FONT + ';-webkit-tap-highlight-color:transparent}',
  // 列表项、按钮自带 display，不写 !important 的话 hidden 属性压不住
  '.test-root[hidden],.test-root [hidden],.test-entry[hidden],.test-hint[hidden]{display:none!important}',
  '.test-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:52;color:#fff5cc}',
  '.test-backdrop{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.28)}',
  // 右侧抽屉：左边留出准星和场景，放出来的实体看得见
  '.test-sheet{position:absolute;top:0;right:0;bottom:0;width:400px;max-width:100%;box-sizing:border-box;display:flex;flex-direction:column;' +
    'padding:12px 14px 10px 14px;' +
    'padding:calc(12px + env(safe-area-inset-top, 0px)) calc(14px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) 14px;' +
    'background:rgba(26,22,9,.95);border-left:1px solid rgba(255,240,170,.22);box-shadow:-10px 0 32px rgba(0,0,0,.45)}',
  '.test-head{display:flex;align-items:center;gap:10px;flex:none}',
  '.test-titles{flex:1;min-width:0}',
  '.test-title{font-size:17px;font-weight:700;letter-spacing:1px;line-height:1.3}',
  '.test-count{margin-top:2px;font-size:12px;color:rgba(255,245,204,.68);font-variant-numeric:tabular-nums}',
  '.test-close{flex:none;width:44px;height:44px;padding:0;border-radius:12px;border:1px solid rgba(255,240,170,.35);' +
    'background:rgba(255,240,170,.08);color:#fff5cc;font-size:26px;line-height:1;font-family:inherit;cursor:pointer}',
  '.test-actions{display:flex;gap:8px;margin-top:10px;flex:none}',
  '.test-btn{flex:1;min-height:44px;padding:0 10px;border-radius:10px;border:1px solid rgba(255,240,170,.45);' +
    'background:rgba(255,236,150,.14);color:#fff5cc;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer}',
  '.test-btn:active{background:rgba(255,236,150,.3)}',
  '.test-btn-clear{border-color:rgba(232,112,92,.6);background:rgba(200,62,55,.2);color:#ffd9d0}',
  '.test-btn-clear:active{background:rgba(200,62,55,.38)}',
  // 16px：iOS 聚焦小于 16px 的输入框会自动放大整页
  '.test-search{display:block;flex:none;width:100%;height:44px;box-sizing:border-box;margin-top:10px;padding:0 12px;border-radius:10px;' +
    'border:1px solid rgba(255,240,170,.3);background:rgba(0,0,0,.35);color:#fff5cc;font-size:16px;font-family:inherit;' +
    'outline:none;-webkit-appearance:none;appearance:none}',
  '.test-search::placeholder{color:rgba(255,245,204,.42)}',
  '.test-search:focus{border-color:rgba(255,236,150,.85)}',
  '.test-search:disabled{opacity:.45}',
  '.test-list{flex:1;min-height:0;margin-top:8px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}',
  '.test-group-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:baseline;gap:8px;' +
    'padding:8px 2px 6px;background:#1a1609;color:#e9d27a;font-size:12px;font-weight:600;letter-spacing:.5px}',
  '.test-group-n{flex:none;color:rgba(255,245,204,.45);font-weight:400}',
  '.test-item{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;box-sizing:border-box;margin:0 0 6px;padding:6px 10px;' +
    'border-radius:10px;border:1px solid rgba(255,240,170,.16);background:rgba(255,240,170,.05);color:#fff5cc;' +
    'text-align:left;font-family:inherit;cursor:pointer}',
  '.test-item:active{background:rgba(255,236,150,.24)}',
  '@media (hover:hover){.test-item:hover,.test-close:hover{background:rgba(255,236,150,.14)}}',
  '.test-item-names{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
  '.test-item-zh{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.test-item-en{font-size:12px;color:rgba(255,245,204,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.test-tag{flex:none;padding:3px 8px;border-radius:999px;border:1px solid;font-size:12px;font-weight:600;line-height:1.2}',
  '.test-tag-hostile{color:#ffb4a8;border-color:rgba(232,98,78,.75);background:rgba(200,62,55,.24)}',
  '.test-tag-friendly{color:#b9f0c2;border-color:rgba(92,190,112,.75);background:rgba(78,166,90,.24)}',
  '.test-tag-neutral{color:#ddd7c2;border-color:rgba(200,195,170,.5);background:rgba(200,195,170,.12)}',
  '.test-empty{padding:24px 10px;text-align:center;font-size:13px;line-height:1.65;color:rgba(255,245,204,.7)}',
  '.test-empty b{display:block;margin-bottom:6px;font-size:15px;color:#fff5cc}',
  '.test-foot{flex:none;margin-top:6px;font-size:12px;color:rgba(255,245,204,.45)}',
  // 窄屏铺满；横屏手机太矮时整张面板一起滚，别让列表只剩一条缝
  '@media (max-width:440px){.test-sheet{width:100%;border-left:0;padding-left:14px;padding-left:calc(14px + env(safe-area-inset-left, 0px))}}',
  '@media (max-height:520px){.test-sheet{display:block;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
    '.test-list{overflow:visible;margin-bottom:6px}}',
  // 触屏入口：竖直居中在暂停键（右上 12+48px）和冲刺键（右下 116+62px）之间的空档，横屏矮屏也压不到它们
  '.test-entry{position:fixed;z-index:31;width:52px;height:52px;padding:0;box-sizing:border-box;' +
    'right:12px;right:calc(12px + env(safe-area-inset-right, 0px));' +
    'top:calc(50% - 59px);top:calc(50% - 59px + (env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) / 2);' +
    'transform:translateY(-50%);border-radius:14px;border:2px solid rgba(255,240,170,.55);background:rgba(22,19,8,.42);' +
    'color:#fff5cc;font-size:14px;font-weight:600;letter-spacing:1px;text-shadow:0 1px 2px rgba(0,0,0,.7);' +
    'touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:pointer}',
  '.test-entry:active{background:rgba(255,236,150,.62);color:#211d0c;text-shadow:none}',
  '.test-hint{position:fixed;z-index:31;left:16px;left:calc(16px + env(safe-area-inset-left, 0px));' +
    'top:12px;top:calc(12px + env(safe-area-inset-top, 0px));font-size:12px;line-height:1.4;color:rgba(255,245,204,.75);' +
    'text-shadow:0 1px 2px rgba(0,0,0,.85);pointer-events:none;white-space:nowrap}',
  '.test-key{display:inline-block;min-width:16px;margin-right:5px;padding:0 4px;border:1px solid rgba(255,245,204,.55);' +
    'border-radius:4px;text-align:center;font-weight:700}',
].join('\n');

// ---------- 状态 ----------
const S = {
  inited: false,
  session: false,         // game:start 是测试模式、还没 game:home
  open: false,
  restoreInput: false,    // 输入是面板关掉的，收面板时才归还
  guardUntil: 0,
  lastToggle: -1e9,
  entryTouchAt: -1e9,
  nextCount: 0,
  nextHint: 0,
  poll: 0,
  listSig: '',
  query: '',
  groups: [],             // [{ node, countEl, items: [{ node, hay }] }]
  countText: '',
};
const dom = { ready: false };

// ---------- 小工具 ----------
function has(o, k) { return !!o && typeof o[k] === 'function'; }
function nowMs() {
  const p = window.performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
}
function usable() {
  const g = BR.game;
  return !!g && g.mode === 'test' && g.screen === 'playing';
}
function uiUsable() { return S.session && usable(); }
function notify(text) {
  if (has(BR.hud, 'toast')) BR.hud.toast(text);
  else console.log('[test]', text);
}
function sfx(name) {
  if (!has(BR.audio, 'play')) return;
  try { BR.audio.play(name); } catch (err) { /* 音频模块还在补，失败不影响放实体 */ }
}
function nameOf(def) { return (def && (def.zh || def.en || def.type)) || '实体'; }
// 下划线开头的都是开发/示范/自检类型（_dev_、_demo_、_probe_），不进给玩家看的列表
function isDevType(type) { return type === DUMMY || String(type).charAt(0) === '_'; }
function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !/^(button|checkbox|radio|range|color|file|image|reset|submit)$/i.test(el.type || '');
}
function groundAt(x, z) { return has(BR.phys, 'groundY') ? BR.phys.groundY(x, z) : 0; }

// ---------- 落点 ----------
// 视线：优先读相机（与画面一致），相机还没摆好时退回玩家姿态
function viewRay() {
  const p = BR.player;
  const pOk = !!p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
  const cam = BR.gfx && BR.gfx.camera;
  let ox, oy, oz, dx, dy, dz;
  let fromCam = false;
  if (cam && cam.matrixWorld && typeof cam.updateMatrixWorld === 'function') {
    // 两帧之间相机 position/rotation 是没抖的姿态（gfx 渲染完会还原），重算一次拿到 player.update 刚写进去的朝向
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    ox = m[12]; oy = m[13]; oz = m[14];
    dx = -m[8]; dy = -m[9]; dz = -m[10];   // 相机看向本地 -Z
    // 离玩家太远说明相机还没被 player 摆过（开局第一帧），不可信
    fromCam = isFinite(ox + oy + oz) && (!pOk || U.dist2(ox, oz, p.x, p.z) < 4);
  }
  if (!fromCam) {
    if (!pOk) return null;
    const pitch = p.pitch || 0, yaw = p.yaw || 0, cp = Math.cos(pitch);
    ox = p.x; oy = p.y; oz = p.z;
    dx = -Math.sin(yaw) * cp; dy = Math.sin(pitch); dz = -Math.cos(yaw) * cp;
  }
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(L > 1e-9)) return null;
  dx /= L; dy /= L; dz /= L;
  // 水平朝向：几乎垂直看天/看地时视线的水平分量不可靠，退回玩家 yaw
  let hx = dx, hz = dz, hl = Math.sqrt(hx * hx + hz * hz);
  if (hl < 0.15) {
    const yaw = pOk ? (p.yaw || 0) : 0;
    hx = -Math.sin(yaw); hz = -Math.cos(yaw); hl = 1;
  }
  hx /= hl; hz /= hl;
  const px = pOk ? p.x : ox, pz = pOk ? p.z : oz;
  const feet = pOk ? p.y - BR.config.player.eyeHeight : groundAt(px, pz);
  return { ox, oy, oz, dx, dy, dz, hx, hz, px, pz, feet };
}

function spotFree(ray, x, z, r, h) {
  if (!isFinite(x) || !isFinite(z)) return null;
  const P = BR.phys;
  const minD = BR.config.player.radius + r + PAD;
  if (U.dist2(x, z, ray.px, ray.pz) < minD * minD) return null;   // 别放到玩家身上
  const gy = groundAt(x, z);
  if (has(P, 'overlapCircle') && P.overlapCircle(x, z, r, gy, h)) return null;
  // 隔着墙的空位不算：放到墙后玩家看不见，还可能是隔壁封死的房间
  if (has(P, 'los') && !P.los(ray.px, ray.feet + CHEST, ray.pz, x, gy + CHEST, z)) return null;
  return { x, y: gy, z };
}

function findSpot(r, h) {
  const ray = viewRay();
  if (!ray) return null;
  const P = BR.phys;
  const canRay = has(P, 'raycast');
  const hit = canRay ? P.raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, RAY_MAX) : null;
  const along = hit ? Math.max(0, hit.dist - RAY_BACK) : MISS_DIST;
  let cx = ray.ox + ray.dx * along, cz = ray.oz + ray.dz * along;
  const near = Math.max(MIN_AHEAD, BR.config.player.radius + r + PAD);
  if (U.dist2(cx, cz, ray.px, ray.pz) < near * near - 1e-6) {
    // 低头看地（地面不是盒子，射线打不到）或脸贴着墙：改沿水平朝向在胸口高度量前方还有多少空间
    const h2 = canRay ? P.raycast(ray.px, ray.feet + CHEST, ray.pz, ray.hx, 0, ray.hz, near + RAY_BACK + 0.05) : null;
    const ahead = h2 ? Math.max(0, Math.min(near, h2.dist - RAY_BACK)) : near;
    cx = ray.px + ray.hx * ahead;
    cz = ray.pz + ray.hz * ahead;
  }
  let s = spotFree(ray, cx, cz, r, h);
  if (s) return s;
  // 被挡：从朝向玩家的那一侧开始左右交替，一圈圈往外找，先找玩家看得见的位置
  const a0 = Math.atan2(ray.pz - cz, ray.px - cx);
  for (let k = 1; k <= RING_COUNT; k++) {
    const rad = k * RING_STEP;
    const n = Math.min(8 * k, 24);
    const step = Math.PI * 2 / n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) >> 1;
      const a = a0 + (i % 2 ? j : -j) * step;
      s = spotFree(ray, cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, r, h);
      if (s) return s;
    }
  }
  return null;
}

function sizeOf(def, type) {
  const fallbackR = type === DUMMY ? BR.config.player.radius : DEF_RADIUS;
  const r = def && Number(def.radius) > 0 ? Math.min(Number(def.radius), 2) : fallbackR;
  const h = def && Number(def.height) > 0 ? Math.min(Number(def.height), 6) : DEF_HEIGHT;
  return { r, h };
}

// ---------- 放出 / 清除 ----------
function counts() {
  const out = { ents: 0, dummies: 0 };
  const E = BR.entities;
  let L = E && E.list;
  if (typeof L === 'function') { try { L = L.call(E); } catch (err) { L = null; } }
  if (!L || typeof L !== 'object') return out;
  const each = (e) => {
    // 倒地等待消失的不算：面板上的数字应该是"还在场上活动的"
    if (!e || typeof e !== 'object' || e.dead || e.removed || (typeof e.hp === 'number' && e.hp <= 0)) return;
    const def = e.def;
    if (e.type === DUMMY || (def && (def.type === DUMMY || def.faction === 'dummy'))) out.dummies++;
    else out.ents++;
  };
  if (typeof L.forEach === 'function') L.forEach(each);
  else for (const k in L) each(L[k]);
  return out;
}

function spawnOf(type, kind) {
  type = String(type || '');
  if (!usable()) { console.warn('[test] 只有测试模式游玩中才能放出实体'); return null; }
  if (!has(BR.entities, 'spawn')) { notify('实体模块还没载入，放不出来'); return null; }
  const def = BR.entityTypes.get(type);
  if (!def) {
    notify(kind === 'dummy' ? '测试人（test_dummy）还没载入' : '没有这种实体：' + type);
    return null;
  }
  const size = sizeOf(def, type);
  const spot = findSpot(size.r, size.h);
  if (!spot) { notify('附近没有能落脚的空位，换个开阔的地方再试'); return null; }
  let e = null;
  try {
    e = BR.entities.spawn(type, spot.x, spot.y, spot.z, { manual: true });
  } catch (err) {
    console.error('[test] 放出失败', type, err);
  }
  if (!e) {
    const c = counts(), max = BR.config.world.maxActiveEntities;
    notify(c.ents + c.dummies >= max ? '场上实体已达上限 ' + max : '放出失败：' + nameOf(def));
    return null;
  }
  BR.bus.emit('test:spawned', { kind, id: e.id, type });
  notify(kind === 'dummy' ? '已召唤测试人' : '已放出 ' + nameOf(def));
  sfx('click');
  refreshCount();
  return e;
}

function spawnEntity(type) { return spawnOf(type, type === DUMMY ? 'dummy' : 'entity'); }
function spawnDummy() { return spawnOf(DUMMY, 'dummy'); }

function clearAll() {
  if (!BR.game || BR.game.mode !== 'test') { console.warn('[test] 只有测试模式能清除全部实体'); return false; }
  if (!has(BR.entities, 'clear')) { notify('实体模块还没载入'); return false; }
  const c = counts();
  try {
    BR.entities.clear();
  } catch (err) {
    console.error('[test] 清除失败', err);
    notify('清除失败');
    return false;
  }
  notify(c.ents + c.dummies > 0 ? '已清除全部实体和测试人' : '场上本来就没有实体');
  sfx('click');
  refreshCount();
  return true;
}

// ---------- 列表 ----------
function levelLabel(lv) {
  const name = lv.name ? String(lv.name) : 'Level ' + lv.id;
  return lv.title ? name + ' · ' + lv.title : name;
}

function sortedLevels() {
  const order = BR.LEVEL_ORDER || [];
  const rank = (lv) => { const i = order.indexOf(String(lv.id)); return i < 0 ? order.length : i; };
  // 按 LEVEL_ORDER 排；不在顺序表里的（dev 等）按注册顺序排在后面
  return BR.levels.all().map((lv, i) => ({ lv, i }))
    .sort((a, b) => rank(a.lv) - rank(b.lv) || a.i - b.i)
    .map(x => x.lv);
}

function buildGroups() {
  const byType = new Map();
  for (const d of BR.entityTypes.all()) {
    if (d && d.type != null && !isDevType(d.type)) byType.set(String(d.type), d);
  }
  const used = new Set();
  const groups = [];
  for (const lv of sortedLevels()) {
    const defs = [], seen = new Set();
    for (const ent of (Array.isArray(lv.entities) ? lv.entities : [])) {
      const t = String(ent && typeof ent === 'object' ? ent.type : ent);
      const d = byType.get(t);
      if (!d || seen.has(t)) continue;   // 层级表里写了但实体脚本没载入的，放不出来，不列
      seen.add(t);
      used.add(t);
      defs.push(d);
    }
    if (defs.length) groups.push({ label: levelLabel(lv), defs });
  }
  const rest = [];
  for (const d of byType.values()) if (!used.has(String(d.type))) rest.push(d);
  if (rest.length) groups.push({ label: '其他', defs: rest });
  return groups;
}

function signature() {
  return BR.entityTypes.all().map(d => d && d.type).join(',') + '|' + BR.levels.all().map(l => l.id).join(',');
}

function refreshList() {
  const sig = signature();
  if (sig !== S.listSig) {
    // 实体脚本可能晚于面板第一次打开才载入，每次打开对一下注册表有没有变
    S.listSig = sig;
    rebuildList();
  }
  applyFilter();
}

function rebuildList() {
  const list = dom.list;
  list.textContent = '';
  list.scrollTop = 0;
  S.groups = [];
  const groups = buildGroups();
  dom.search.disabled = groups.length === 0;
  if (!groups.length) {
    const box = mk('div', 'test-empty', list);
    mk('b', null, box, '还没有可放出的实体');
    mk('span', null, box, '实体定义（js/entities/*.js）载入后会按层级列在这里。' +
      '开发用的 _dev_* 色块实体和测试人不进列表，测试人用上方的「召唤测试人」。');
    dom.noMatch = null;
    return;
  }
  for (const g of groups) {
    const sec = mk('section', 'test-group', list);
    const head = mk('div', 'test-group-head', sec);
    mk('span', 'test-group-name', head, g.label);
    const countEl = mk('span', 'test-group-n', head, String(g.defs.length));
    const items = [];
    for (const d of g.defs) {
      const f = FACTION[d.faction] || [String(d.faction || '未知'), 'neutral'];
      const zh = String(d.zh || d.type), en = String(d.en || d.type);
      const b = mk('button', 'test-item', sec);
      b.type = 'button';
      b.dataset.type = String(d.type);
      b.setAttribute('aria-label', '放出 ' + zh + '（' + f[0] + '）');
      const names = mk('span', 'test-item-names', b);
      mk('span', 'test-item-zh', names, zh);
      mk('span', 'test-item-en', names, en);
      mk('span', 'test-tag test-tag-' + f[1], b, f[0]);
      items.push({ node: b, hay: (zh + ' ' + en + ' ' + d.type + ' ' + f[0]).toLowerCase() });
    }
    S.groups.push({ node: sec, countEl, items });
  }
  dom.noMatch = mk('div', 'test-empty test-nomatch', list);
  dom.noMatch.hidden = true;
}

function applyFilter() {
  if (!dom.ready) return;
  // 空格分词、全部命中才显示："有害 smi" 这种组合也能搜
  const words = S.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const g of S.groups) {
    let n = 0;
    for (const it of g.items) {
      const ok = words.every(w => it.hay.indexOf(w) >= 0);
      setHidden(it.node, !ok);
      if (ok) n++;
    }
    setHidden(g.node, n === 0);
    g.countEl.textContent = String(n);
    shown += n;
  }
  if (dom.noMatch) {
    const none = S.groups.length > 0 && shown === 0;
    setHidden(dom.noMatch, !none);
    if (none) dom.noMatch.textContent = '没有匹配「' + S.query.trim() + '」的实体';
  }
}

function refreshCount() {
  if (!dom.ready) return;
  const c = counts();
  const text = '场上实体 ' + c.ents + ' · 测试人 ' + c.dummies;
  if (text !== S.countText) { S.countText = text; dom.count.textContent = text; }
}

// ---------- DOM ----------
function mk(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function setHidden(n, v) { if (n && n.hidden !== v) n.hidden = v; }
function host() { return document.getElementById('ui') || document.body; }
function attached(n) {
  return n.isConnected !== undefined ? n.isConnected : document.documentElement.contains(n);
}

function itemOf(el) {
  for (; el && el !== dom.list; el = el.parentNode) {
    if (el.dataset && el.dataset.type) return el;
  }
  return null;
}

function build() {
  dom.style = document.createElement('style');
  dom.style.className = 'test-style';
  dom.style.textContent = CSS;

  const root = dom.root = mk('div', 'test-root');
  root.hidden = true;
  const backdrop = mk('div', 'test-backdrop', root);
  const sheet = mk('div', 'test-sheet', root);
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '测试模式 · 实体列表');

  const head = mk('div', 'test-head', sheet);
  const titles = mk('div', 'test-titles', head);
  mk('div', 'test-title', titles, '实体列表');
  dom.count = mk('div', 'test-count', titles, '');
  const closeBtn = dom.close = mk('button', 'test-close', head, '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '关闭实体列表');

  const actions = mk('div', 'test-actions', sheet);
  const dummyBtn = dom.dummy = mk('button', 'test-btn test-btn-dummy', actions, '召唤测试人');
  const clearBtn = dom.clear = mk('button', 'test-btn test-btn-clear', actions, '清除全部');
  dummyBtn.type = 'button';
  clearBtn.type = 'button';

  const search = dom.search = mk('input', 'test-search', sheet);
  search.type = 'search';
  search.placeholder = '搜索：中文名 / 英文名 / 阵营';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('aria-label', '搜索实体');
  search.setAttribute('enterkeyhint', 'search');

  dom.list = mk('div', 'test-list', sheet);
  dom.foot = mk('div', 'test-foot', sheet, '');

  const entry = dom.entry = mk('button', 'test-entry', null, '实体');
  entry.type = 'button';
  entry.hidden = true;
  entry.setAttribute('aria-label', '打开实体列表');

  const hint = dom.hint = mk('div', 'test-hint');
  hint.hidden = true;
  mk('span', 'test-key', hint, 'T');
  mk('span', null, hint, '打开实体列表');

  const guarded = (fn) => (e) => { if (nowMs() >= S.guardUntil) fn(e); };
  // 关闭必须在点击回调里同步请求指针锁定，浏览器才认用户手势
  backdrop.addEventListener('click', guarded(() => close({ relock: true })));
  closeBtn.addEventListener('click', guarded(() => close({ relock: true })));
  dummyBtn.addEventListener('click', guarded(() => spawnDummy()));
  clearBtn.addEventListener('click', guarded(() => clearAll()));
  dom.list.addEventListener('click', guarded((e) => {
    const b = itemOf(e.target);
    if (b) spawnEntity(b.dataset.type);
  }));
  search.addEventListener('input', () => { S.query = String(search.value || ''); applyFilter(); });
  // 手机上回车收起键盘，别挡住列表
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typeof search.blur === 'function') search.blur(); });
  // 鼠标点按钮不抢焦点：焦点留在按钮上，回到游戏后空格会再点它一次
  root.addEventListener('mousedown', (e) => {
    if (e.target !== search && e.cancelable) e.preventDefault();
  });

  // 触屏入口用 touchstart 并 preventDefault：既不等 click 的延迟，也吞掉那次合成 click，免得落在刚弹出的列表项上
  entry.addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault();
    S.entryTouchAt = nowMs();
    open();
  }, { passive: false });
  entry.addEventListener('click', () => {
    if (nowMs() - S.entryTouchAt < 800) return;
    open();
  });
  entry.addEventListener('mousedown', (e) => { if (e.cancelable) e.preventDefault(); });

  dom.ready = true;
}

function ensureDom() {
  if (typeof document === 'undefined' || !document.body) return false;
  if (!dom.ready) build();
  // 别的模块清空 #ui 时会把节点一起带走，补挂回去
  const h = host();
  if (!attached(dom.style)) h.appendChild(dom.style);
  if (!attached(dom.root)) h.appendChild(dom.root);
  if (!attached(dom.entry)) h.appendChild(dom.entry);
  if (!attached(dom.hint)) h.appendChild(dom.hint);
  return true;
}

// 桌面提示紧贴 HUD 左上角信息块的下方；HUD 隐藏或样式没载入时用 CSS 默认位置
function layoutHint() {
  let top = '', left = '';
  const info = typeof document.querySelector === 'function' ? document.querySelector('.hud-info') : null;
  if (info && typeof info.getBoundingClientRect === 'function') {
    const r = info.getBoundingClientRect();
    // 只在信息块确实位于左上角时跟随；HUD 以后换位置，提示仍留在左上角默认位
    if (r.width > 0 && r.height > 0 && r.bottom < (window.innerHeight || 800) * 0.5 &&
        r.left < (window.innerWidth || 1280) * 0.5) {
      top = Math.round(r.bottom + 6) + 'px';
      left = Math.round(r.left) + 'px';
    }
  }
  if (dom.hint.style.top !== top) dom.hint.style.top = top;
  if (dom.hint.style.left !== left) dom.hint.style.left = left;
}

function syncChrome(ok) {
  if (ok === undefined) ok = uiUsable();
  if (!dom.ready && !ok) return;
  if (!ensureDom()) return;
  // 暂停菜单、结算、别的弹窗占着输入时，入口也收起
  const idle = ok && !S.open && !(BR.input && BR.input.enabled === false);
  const touch = !!(BR.input && BR.input.isTouch);
  setHidden(dom.entry, !(idle && touch));
  setHidden(dom.hint, !(idle && !touch));
  if (!dom.hint.hidden && nowMs() >= S.nextHint) {
    S.nextHint = nowMs() + HINT_MS;
    layoutHint();
  }
}

function sync() {
  const ok = uiUsable();
  if (S.open) {
    // 暂停、结算、返回主页，或别的模块把输入重新打开了：面板直接收起，不去动输入开关
    if (!ok || (BR.input && BR.input.enabled === true)) close({ silent: true });
    else if (nowMs() >= S.nextCount) { S.nextCount = nowMs() + COUNT_MS; refreshCount(); }
  }
  syncChrome(ok);
}

// ---------- 开关 ----------
function exitLock() {
  // 正常情况 input.enabled = false 已经退出锁定；input 没初始化、或锁在别的元素上时兜底
  if (typeof document.exitPointerLock !== 'function' || !document.pointerLockElement) return;
  if (BR.input && BR.input.locked) return;   // input 刚发出退出请求，locked 要等 pointerlockchange 才变，别重复退
  document.exitPointerLock();
}

function open() {
  if (!S.inited) init();
  if (S.open || !uiUsable() || !ensureDom()) return false;
  S.open = true;
  S.lastToggle = nowMs();
  S.guardUntil = nowMs() + OPEN_GUARD_MS;
  refreshList();
  S.countText = '';
  refreshCount();
  S.nextCount = nowMs() + COUNT_MS;
  const touch = !!(BR.input && BR.input.isTouch);
  dom.foot.textContent = (touch ? '点 × 关闭' : 'T / Esc 关闭') + ' · 点实体在准星前方放出';
  dom.root.hidden = false;
  const inp = BR.input;
  S.restoreInput = !!inp && inp.enabled !== false;
  // input 关掉时会顺带清边沿、退出指针锁定、收起触屏摇杆
  if (inp) inp.enabled = false;
  exitLock();
  syncChrome(true);
  return true;
}

function close(opts) {
  if (!S.open) return false;
  opts = opts || {};
  S.open = false;
  S.lastToggle = nowMs();
  // 先把焦点从搜索框移走：焦点留在输入框里，input 会把之后的 WASD 全当成打字忽略
  const a = document.activeElement;
  if (a && dom.root.contains(a) && typeof a.blur === 'function') a.blur();
  dom.root.hidden = true;
  const back = S.restoreInput && !opts.silent && uiUsable();
  S.restoreInput = false;
  if (back && BR.input) {
    BR.input.enabled = true;
    if (opts.relock && has(BR.input, 'lock')) BR.input.lock();
  }
  syncChrome();
  return true;
}

// 挂在 document 捕获阶段，必定晚于 input 挂在 window 捕获阶段的监听：
// 这里一改 input.enabled，input 刚记下的边沿（T 的 'testmenu'、Esc 的 'pause'）就被清掉，不会开了又关、关了又暂停
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const id = e.code && e.code !== 'Unidentified' ? e.code : 'key:' + String(e.key || '').toLowerCase();
  const isT = id === 'KeyT' || id === 'key:t';
  const isEsc = id === 'Escape' || id === 'key:escape' || id === 'key:esc';
  if (!isT && !isEsc) return;
  if (S.open) {
    if (isT && isTyping(e.target)) return;   // 搜索框里照常能打字母 t
    if (e.cancelable) e.preventDefault();
    if (e.repeat) return;                    // 按住 T 不要开开关关
    // Esc 不算能请求指针锁定的用户手势，请求了只会累计 input 的锁定失败次数
    close({ relock: isT });
    return;
  }
  if (!isT || e.repeat || isTyping(e.target) || !uiUsable()) return;
  if (BR.input && BR.input.enabled === false) return;   // 别的菜单占着输入时不抢
  if (e.cancelable) e.preventDefault();
  open();
}

function startPoll() {
  if (!S.poll) S.poll = setInterval(sync, POLL_MS);
}
function stopPoll() {
  if (S.poll) { clearInterval(S.poll); S.poll = 0; }
}

function onStart(p) {
  if (S.open) close({ silent: true });
  const mode = (p && p.mode) || (BR.game && BR.game.mode);
  S.session = mode === 'test';
  // 新一局：搜索词清空，列表下次打开时重建
  S.query = '';
  S.listSig = '';
  if (dom.search) dom.search.value = '';
  if (S.session) startPoll(); else stopPoll();
  syncChrome();
}

function onHome() {
  if (S.open) close({ silent: true });
  S.session = false;
  stopPoll();
  if (dom.ready) { setHidden(dom.entry, true); setHidden(dom.hint, true); }
}

// ---------- 公开 ----------
function init() {
  if (S.inited) return;
  S.inited = true;
  document.addEventListener('keydown', onKeyDown, true);
  BR.bus.on('game:start', onStart);
  BR.bus.on('game:home', onHome);
  BR.bus.on('player:death', () => { if (S.open) close({ silent: true }); });
  // init 晚于开局也能用
  if (BR.game && BR.game.mode === 'test' && BR.game.screen !== 'home') {
    S.session = true;
    startPoll();
  }
}

function update(dt) {
  if (!S.inited) init();
  // 以后 input 若给触屏或别的键位也发 'testmenu'，这里接住；同一次 T 键已由 onKeyDown 处理过就跳过
  if (!S.open && uiUsable() && has(BR.input, 'pressed') && BR.input.pressed('testmenu') &&
      nowMs() - S.lastToggle > EDGE_DEDUP_MS) {
    open();
  }
  sync();
}

BR.test = {
  init,
  open,
  close() { return close(); },
  update,
  spawnEntity,
  spawnDummy,
  clearAll,
  get isOpen() { return S.open; },
};
})();
