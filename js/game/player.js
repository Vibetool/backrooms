// 后室 · 玩家：位置朝向、移动碰撞、HP/饥饿/san、背包、受伤、原地重生
// 接口见 ARCHITECTURE.md 第 8、12 节。读 BR.input / BR.phys / BR.world / BR.entities，写 BR.gfx.camera
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;
const PC = BR.config.player;
const ST = BR.config.stats;

const SLOTS = 5;
const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const PITCH_LIMIT = 85 * DEG;          // 不到 90°：正上/正下时 yaw 退化，视角会乱转
const ACCEL = 14;                      // 速度趋近系数：留一点惯性，键盘和摇杆手感一致，晃动也不突兀
const STEP_UP_LAMBDA = 18;             // 上台阶时视点平滑抬升，而不是一帧跳上去
const STEP_DOWN_SNAP = 0.4;            // 落差小于它直接贴地走下去；大于它才按坠落处理
const GRAVITY = 18;                    // 没有跳跃，只在掉下高处时用；按真实重力反而显得飘
const STRIDE_WALK = 0.72;              // 每步距离（米）：脚步和晃动按实际位移推进，顶着墙原地蹬不会响
const STRIDE_SPRINT = 0.95;
const BOB_Y = 0.03;
const BOB_X = 0.016;
const BOB_SPRINT_MUL = 1.6;
const MOVE_EPS = 0.2;                  // 实际速度低于它视为静止：噪音 0
const NOISE_WALK = 0.4;
const NOISE_SPRINT = 1;
// 下面四个只在没载入 BR.interact 时兜底用（老的「最近物资 + 视线锥」拾取）；正常走准心，见 js/game/interact.js
const INTERACT_DIST = 2;
const INTERACT_COS = Math.cos(30 * DEG);   // 视线前方 60° 锥 = 左右各 30°
const INTERACT_CLOSE = 0.5;            // 物品几乎在脚下时方向角不稳定，不再要求朝向
const INTERACT_DY = 1.4;               // 高度差超过它就是楼上/楼下的东西
const DARK_LIGHT = 0.25;
const LIGHT_SAMPLE_SEC = 0.2;          // lightAt 可能要遍历灯光，没必要每帧算
const AURA_DY = 4;
const FRIENDLY_RADIUS = 8;
const FRIENDLY_REGEN = 0.4;            // san/秒；基础消耗约 0.083/秒，待在友善实体身边能慢慢缓过来
const BREAKDOWN_HP_PER_SEC = 2;
const HEARTBEAT_SEC = 1.1;
const RESPAWN_MIN_STAT = 50;
const RESPAWN_GRACE = 2;               // 清场半径外冲过来的实体，也不能让人刚站起来就再死一次
const SAN_FX_LAMBDA = 2.5;             // 被一口咬掉 15 点 san 时画面渐变，而不是闪一下
const DROP_DIST = 0.8;
const FLASH_HURT = '#b00000';
const FLASH_SANITY = '#3a0018';
// 上下车（FE1 叉车，D2 player.setPose 的最小子集）：眼点按 handle.path(dir) 的三个点走折线
const MOUNT_SEC = 0.5;                 // 上车、下车的眼点插值时长
const SHAKE_MAX = 0.04;                // 镜头抖动的位移上限（米）：撞上东西「轻轻一抖」
// unmount 的这些原因不播 0.5 s 下车插值，直接落到落点（死亡、换层、回主页、复活……）；别的原因（含不传）都播插值
const UNMOUNT_INSTANT = { death: 1, dead: 1, reset: 1, respawn: 1, home: 1, start: 1, level: 1, leave: 1, force: 1, forced: 1, teleport: 1 };

// 非实体伤害来源 → 结算界面文案
const CAUSE_TEXT = {
  sanity: '精神崩溃', starvation: '饿死', hunger: '饿死', fall: '坠落身亡', drown: '溺水',
  fire: '被烧死', electric: '触电身亡', hazard: '死于环境危害', void: '坠入虚空',
};

// ---------- 模块内部状态（不需要别的模块读写的放这里） ----------
let feetY = 0;
let vy = 0;
let bobPhase = 0, bobWeight = 0, bobX = 0, bobY = 0;
let lightTimer = 0, lightCached = 1;
let heartbeatTimer = 0;
let sanFx = 0;
let invuln = 0;
let lastCause = null, lastCauseKey = null, lastSource = null;
// world.js 每次换层都可能调 reset(spawn)。只有新开一局（game:start / game:home 之后）才清背包和数值，
// 否则走个楼梯背包就没了
let fullResetPending = true;
let interactErr = false;               // interact.update 出错只报一次，别每帧刷屏
// 载具（FE1）：handle 由 BR.vehicles 给，见 mount()。phase：'in' 上车插值、'seat' 坐着、'out' 下车插值（这时 handle 已经交还）、null
const M = {
  handle: null, phase: null, t: 0, path: null, len: 0,
  yaw0: 0, yaw1: null, pitch0: 0,
  forcing: false,                      // 正在调 handle.forceExit：期间 handle 回调 unmount 一律直接落地
  err: false,
};
let shX = 0, shY = 0, shZ = 0, shT = 0;  // 镜头抖动偏移（坐车撞上东西）
let reduceMQ;                          // prefers-reduced-motion 的 MediaQueryList（第一次用时取）

const player = BR.player = {
  x: 0, y: PC.eyeHeight, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true,
  hp: PC.maxHp, hunger: 100, sanity: 100,
  // 固定 5 格，空格为 null：格子位置稳定，用完一格不会让后面的物品挪位、选中的东西突然变了
  inventory: new Array(SLOTS).fill(null),
  selected: 0,
  sprinting: false, noise: 0,
  dead: false,
  // 姿势：'stand'（默认）| 'drive'（坐在载具上，含上下车那 0.5 s）。坐 / 躺由 D2 的模块改写；镜头被 BR.view 接管时 applyCamera 不写相机
  pose: 'stand',
  // update 内部处理 use / drop / slot1-5，并驱动 BR.interact（空格短按 / 长按）；集成层若要自己接管这些按键就置 false，避免一次按键用掉两个
  handleActions: true,
  slots: SLOTS,
  get feetY() { return feetY; },
  // 坐着的载具 handle（含上车插值那 0.5 s）；没坐车、或已经开始下车插值时为 null
  get mounted() { return M.handle; },
  // 调试 / 测试：{ phase: 'in'|'seat'|'out'|null, t（插值进度 0..1）, key }
  get mountState() { return { phase: M.phase, t: M.phase === 'in' || M.phase === 'out' ? Math.min(1, M.t / MOUNT_SEC) : M.phase ? 1 : 0, key: M.handle ? M.handle.key : null }; },
  speed, damage, useSelected, respawnInPlace, reset, update,
  interactTarget, interact, select, dropSelected,
  addItem, canAdd, countOf, removeItem,
  mount, unmount,
};

// ---------- 小工具 ----------
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
// pos 必须传 undefined 而不是 null：audio 可能用 pos !== undefined 判断是否 3D 声源
function sound(name, opts) { if (has(BR.audio, 'play')) BR.audio.play(name, undefined, opts); }
function toast(text) { if (has(BR.hud, 'toast')) BR.hud.toast(text, 1500); }

function groundAt(x, z, fallback) {
  if (has(BR.phys, 'groundY')) {
    const g = +BR.phys.groundY(x, z);
    if (isFinite(g)) return g;
  }
  return fallback;
}

function levelEnv() {
  const cur = BR.world && BR.world.current;
  if (cur && cur.env) return cur.env;
  if (cur && cur.def && cur.def.env) return cur.def.env;
  const lv = BR.levels.get(BR.game.levelId);
  return (lv && lv.env) || {};
}

function coop() {
  const c = BR.game.coop;
  if (c && c.active) return c;
  if (BR.coop && BR.coop.active) return { active: true, role: BR.coop.role };
  return null;
}

// entities.list 的具体容器 entities.js 还没定，数组 / Map / Set / 普通对象都兼容
function forEachEntity(fn) {
  const ents = BR.entities && BR.entities.list;
  if (!ents) return;
  if (Array.isArray(ents)) { for (let i = 0; i < ents.length; i++) fn(ents[i]); }
  else if (typeof ents.forEach === 'function') ents.forEach(v => fn(v));
  else for (const k in ents) fn(ents[k]);
}

function findEntity(id) {
  const ents = BR.entities && BR.entities.list;
  if (!ents) return null;
  if (!Array.isArray(ents) && typeof ents.get === 'function') return ents.get(id) || null;
  let hit = null;
  forEachEntity(e => { if (!hit && e && e.id === id) hit = e; });
  return hit;
}

// 伤害来源可能是实体对象、实体 id、实体类型名或 'entity:<type>'，entities.js 传哪种都要认得出
function entityDefOf(src) {
  if (src == null) return null;
  if (typeof src === 'object') {
    if (src.def) return src.def;
    if (src.type && BR.entityTypes.has(src.type)) return BR.entityTypes.get(src.type);
    if (src.kind === 'entity') return (src.ref && src.ref.def) || { zh: '实体' };
    return null;
  }
  const s = String(src);
  if (s.indexOf('entity:') === 0) return BR.entityTypes.get(s.slice(7)) || { zh: '实体' };
  if (BR.entityTypes.has(s)) return BR.entityTypes.get(s);
  const e = findEntity(src);
  return e && e.def ? e.def : null;
}

// 死因在受伤那一刻就定下来：等到结算时实体可能已经被清掉，查不到名字了
function rememberCause(src, def) {
  if (def) {
    lastCause = '被' + (def.zh || '实体') + '杀死';
    lastCauseKey = 'entity:' + (def.type || 'unknown');
  } else if (src != null && typeof src === 'object') {
    lastCause = src.cause || src.zh || '未知原因';
    lastCauseKey = src.key || 'unknown';
  } else if (src != null) {
    lastCause = CAUSE_TEXT[src] || String(src);
    lastCauseKey = String(src);
  } else {
    lastCause = '未知原因';
    lastCauseKey = 'unknown';
  }
  // 事件里不塞实体对象本身，免得被 death/coop 持有或序列化
  lastSource = src != null && typeof src === 'object' ? (src.id != null ? src.id : lastCauseKey) : src;
}

// ---------- 背包 ----------
function stackOf(type) {
  const def = BR.itemTypes.get(type);
  return Math.max(1, (def && def.stack) | 0);
}

function canAdd(type) {
  const max = stackOf(type);
  for (let i = 0; i < SLOTS; i++) {
    const s = player.inventory[i];
    if (!s || (s.type === type && s.count < max)) return true;
  }
  return false;
}

// 返回实际放进去的数量：先补已有的同类堆，再占空格
function addItem(type, count) {
  if (!BR.itemTypes.has(type)) return 0;
  const want = count == null ? 1 : Math.max(0, count | 0);
  const max = stackOf(type);
  const inv = player.inventory;
  let left = want;
  for (let i = 0; i < SLOTS && left > 0; i++) {
    const s = inv[i];
    if (s && s.type === type && s.count < max) {
      const n = Math.min(left, max - s.count);
      s.count += n;
      left -= n;
    }
  }
  for (let i = 0; i < SLOTS && left > 0; i++) {
    if (!inv[i]) {
      const n = Math.min(left, max);
      inv[i] = { type, count: n };
      left -= n;
    }
  }
  return want - left;
}

function removeFromSlot(i, n) {
  const s = player.inventory[i];
  if (!s) return 0;
  const k = Math.min(s.count, Math.max(1, n | 0));
  s.count -= k;
  if (s.count <= 0) player.inventory[i] = null;
  return k;
}

function countOf(type) {
  let c = 0;
  for (let i = 0; i < SLOTS; i++) {
    const s = player.inventory[i];
    if (s && s.type === type) c += s.count;
  }
  return c;
}

function removeItem(type, count) {
  const want = count == null ? 1 : Math.max(0, count | 0);
  let left = want;
  for (let i = 0; i < SLOTS && left > 0; i++) {
    const s = player.inventory[i];
    if (s && s.type === type) left -= removeFromSlot(i, left);
  }
  return want - left;
}

function select(i) {
  i = i | 0;
  if (i >= 0 && i < SLOTS) player.selected = i;
}

function useSelected() {
  if (player.dead) return false;
  const slot = player.inventory[player.selected];
  if (!slot) return false;
  const def = BR.itemTypes.get(slot.type);
  if (!def || typeof def.use !== 'function') return false;
  const before = { hp: player.hp, hunger: player.hunger, sanity: player.sanity };
  const leftBefore = slot.left;
  let consumed = false, used = false;
  try { consumed = def.use(player, BR.game) === true; used = true; }
  catch (err) { console.error('[player] 使用物品出错', slot.type, err); }
  if (BR.game.statsEnabled) {
    player.hp = U.clamp(num(player.hp, before.hp), 0, PC.maxHp);
    player.hunger = U.clamp(num(player.hunger, before.hunger), 0, 100);
    player.sanity = U.clamp(num(player.sanity, before.sanity), 0, 100);
  } else {
    // 游玩模式没有数值系统：物品照常消耗、照常出声，数值原样还回去。
    // 放在这里统一处理，以后别人写的物品直接改 player 字段也不会破坏规则
    player.hp = before.hp;
    player.hunger = before.hunger;
    player.sanity = before.sanity;
  }
  // 吃喝能治分阶段的病（悲尸循环：第一阶段正常饮食可逆转、第二阶段只有杏仁水有效，见 BR.effects.cure）。
  // 分几次吃完的食物前几口 use 返回 false、不发 item:use，所以"这一格剩余口数变了"也算吃过一口
  if (used && (consumed || slot.left !== leftBefore) && has(BR.effects, 'cureByItem')) BR.effects.cureByItem(def);
  if (consumed) {
    // use 里可能动过背包，按引用找回原来那一格再扣
    const idx = player.inventory.indexOf(slot);
    if (idx >= 0) removeFromSlot(idx, 1);
    BR.bus.emit('item:use', { type: slot.type });
  }
  checkDeath();
  return consumed;
}

function dropSelected() {
  if (player.dead) return false;
  if (M.handle || M.phase) return false;   // 坐在车上丢不了东西（drive 情境本来就关掉了丢弃键，脚本直接调也一样）
  const slot = player.inventory[player.selected];
  if (!slot || !has(BR.items, 'spawn')) return false;
  // 第 9 节只约定了拾取同步，丢弃物在对方那边不存在，捡的时候房主也不认这个 id
  if (coop()) { toast('联机时不能丢弃物品'); return false; }
  let px = player.x - Math.sin(player.yaw) * DROP_DIST;
  let pz = player.z - Math.cos(player.yaw) * DROP_DIST;
  // 叉车货叉（FE1）：落点离某根货叉够近、叉面够得着（BR.vehicles.dropSurface 判断）就稳稳放在叉面上，跟着货叉升降、跟着车走。
  // 先问货叉再做「面前是墙」的视线检查：举起来的货叉本身会挡住看向地面那条线，不能因此丢到脚下
  const onFork = forkDrop(slot.type, px, pz);
  if (onFork === FORK_FULL) { toast('货叉上放不下了'); return false; }   // 这根货叉上已经摆满了：东西留在手里
  if (onFork) { removeFromSlot(player.selected, 1); return true; }
  if (has(BR.phys, 'los') && !BR.phys.los(player.x, player.y, player.z, px, feetY + 0.2, pz)) {
    px = player.x;   // 面前是墙就丢在脚下，别丢进墙里
    pz = player.z;
  }
  const p = BR.items.spawn(slot.type, px, groundAt(px, pz, feetY), pz, { id: U.uid('drop'), dropped: true });
  if (!p) return false;
  removeFromSlot(player.selected, 1);
  return true;
}

// 丢在货叉叉面上：dropSurface(x, z, r, type) → { y, veh, tine, x?, z? } | { full } | null（给了 x / z 就按它摆：那根货叉的中线上、
// 不和这根货叉上已经有的东西叠在一起）。叉面和人眼之间被墙挡住就不算（隔着墙丢不上去），退回地面的老规则；
// 这根货叉上摆满了返回 FORK_FULL（不丢，提示「货叉上放不下了」）
const FORK_FULL = 'full';
function forkDrop(type, px, pz) {
  const V = BR.vehicles;
  if (!has(V, 'dropSurface') || !has(V, 'attachItem')) return null;
  const inf = has(BR.items, 'info') ? BR.items.info(type) : null;
  const r = inf ? Math.max(0.03, num(inf.r, 0.1)) : 0.1;
  let s = null;
  try { s = V.dropSurface(px, pz, r, type); } catch (err) { console.error('[player] vehicles.dropSurface 出错', err); return null; }
  if (!s || s.veh == null || !(num(s.y, NaN) === s.y)) return null;
  if (s.full) {
    // 隔着墙看不见那根货叉的话照老规则丢地上（和放得下时一样先查视线）
    if (has(BR.phys, 'los') && !BR.phys.los(player.x, player.y, player.z, px, s.y + 0.05, pz)) return null;
    return FORK_FULL;
  }
  const sx = num(s.x, px), sz = num(s.z, pz);
  const hh = inf ? num(inf.hh, 0.05) : 0.05;
  if (has(BR.phys, 'los') && !BR.phys.los(player.x, player.y, player.z, sx, s.y + Math.max(0.03, hh), sz)) return null;
  const p = BR.items.spawn(type, sx, s.y, sz, { id: U.uid('drop'), dropped: true, still: true });
  if (!p) return null;
  try { V.attachItem(p.id, s.veh); } catch (err) { console.error('[player] vehicles.attachItem 出错', err); }
  return p;
}

// ---------- 互动 ----------
// 准心交互（短按拾取、长按拖动）在 js/game/interact.js；这里只剩「把一件物资捡进背包」和兼容别名
function canInteract(p) {
  if (Math.abs(num(p.y, 0) - feetY) > INTERACT_DY) return false;
  const dx = p.x - player.x, dz = p.z - player.z;
  const d = Math.hypot(dx, dz);
  if (d > INTERACT_CLOSE) {
    // 只比水平朝向：东西在地上，按三维夹角算的话不低头就永远捡不到
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    if ((dx * fx + dz * fz) / d < INTERACT_COS) return false;
  }
  if (has(BR.phys, 'los') && !BR.phys.los(player.x, player.y, player.z, p.x, num(p.y, 0) + 0.2, p.z)) return false;
  return true;
}

// 兼容别名：只返回物资（拾取物记录）。有 BR.interact 时就是准心对准的那件物资，没对准物资返回 null
function interactTarget() {
  if (player.dead) return null;
  const I = BR.interact;
  if (I && typeof I.update === 'function') {
    const c = I.current;
    if (!c || c.kind !== 'item') return null;
    const r = c.ref;
    if (r && r.id != null) return has(BR.items, 'find') ? BR.items.find(r.id) : r;
    return has(BR.items, 'find') ? BR.items.find(c.key) : null;
  }
  return nearestTarget();
}

// 老规则：2 m 内、视线前方 60° 锥里最近的物资。只给没载入 interact.js 的环境和不带参数的脚本调用兜底，
// 游戏里按空格 / E 一律走准心（BR.interact），不会用到它
function nearestTarget() {
  if (player.dead || !has(BR.items, 'nearest')) return null;
  const near = BR.items.nearest(player.x, player.z, INTERACT_DIST);
  if (!near) return null;
  if (canInteract(near)) return near;
  // 最近的那个不在视线锥里（比如在身后），退而求其次找锥内最近的
  const r2 = INTERACT_DIST * INTERACT_DIST;
  const list = BR.items.list || [];
  let best = null, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p === near) continue;
    const d = U.dist2(player.x, player.z, p.x, p.z);
    if (d > r2 || d >= bd) continue;
    if (canInteract(p)) { best = p; bd = d; }
  }
  return best;
}

// target：拾取物记录、物资 id，或 kind 为 'item' 的准心候选（测试和联机客机重放用显式目标）。
// 不传就用准心对准的物资；准心没对准物资时退回老规则（只有脚本会这样调，游戏里的空格走 BR.interact）
function itemFromTarget(target) {
  if (target == null) return interactTarget() || nearestTarget();
  if (!has(BR.items, 'find')) return typeof target === 'object' && target.type ? target : null;
  if (typeof target === 'string' || typeof target === 'number') return BR.items.find(target);
  if (typeof target !== 'object') return null;
  if (target.kind && target.kind !== 'item') return null;
  if (target.ref && target.ref.id != null) return BR.items.find(target.ref.id);
  if (target.id != null) return BR.items.find(target.id);
  if (target.key != null) return BR.items.find(target.key);
  return null;
}

function interact(target) {
  if (player.dead) return false;
  if (M.handle || M.phase) return false;   // 坐在车上捡不了东西
  const t = itemFromTarget(target);
  if (!t) return false;
  const c = coop();
  if (c && c.role === 'guest') {
    // 客机不能自己拾取，要等房主确认（第 9 节）。发请求事件由 coop.js 转发
    if (!canAdd(t.type)) { toast('背包已满'); return false; }
    BR.bus.emit('item:pickRequest', { id: t.id, type: t.type });
    return true;
  }
  return BR.items.pick(t.id, 'me');
}

// ---------- 受伤 / 死亡 / 重生 ----------

function damage(opts) {
  const o = opts || {};
  if (player.dead) return false;
  const src = o.source;
  const def = entityDefOf(src);
  // 游玩模式实体不攻击玩家；entities.js 的 attack 本来也会拦，这里再兜一层
  if (def && !BR.game.attackPlayers) return false;
  if (invuln > 0) return false;
  const dh = Math.max(0, num(o.hp, 0));
  const ds = BR.game.statsEnabled ? Math.max(0, num(o.sanity, 0)) : 0;
  if (dh <= 0 && ds <= 0) return false;
  player.hp = Math.max(0, player.hp - dh);
  player.sanity = Math.max(0, player.sanity - ds);
  rememberCause(src, def);
  if (has(BR.gfx, 'flash')) BR.gfx.flash(dh > 0 ? FLASH_HURT : FLASH_SANITY, dh > 0 ? 0.35 : 0.2);
  if (dh > 0) sound('hurt');
  BR.bus.emit('player:damage', { hp: dh, sanity: ds, source: src });
  checkDeath();
  return true;
}

function checkDeath() {
  if (player.dead || player.hp > 0) return;
  // 死在车上：先强制下车（人落在车旁的落点上、车熄火停住），再结算；下车插值没走完的直接落地
  if (M.handle) forceOut('death');
  else if (M.phase === 'out') finishOut();
  player.hp = 0;
  player.dead = true;   // 只发一次；之后 update 直接返回，直到 respawnInPlace / reset
  player.vx = 0;
  player.vz = 0;
  player.sprinting = false;
  player.noise = 0;
  BR.bus.emit('player:death', {
    cause: lastCause || '未知原因',
    causeKey: lastCauseKey || 'unknown',
    source: lastSource,
    levelId: BR.game.levelId,
  });
}

function respawnInPlace() {
  if (M.handle) forceOut('respawn');
  else if (M.phase === 'out') finishOut();
  player.hp = PC.maxHp;
  player.hunger = Math.max(player.hunger, RESPAWN_MIN_STAT);
  player.sanity = Math.max(player.sanity, RESPAWN_MIN_STAT);
  player.dead = false;
  player.vx = 0;
  player.vz = 0;
  vy = 0;
  invuln = RESPAWN_GRACE;
  lastCause = lastCauseKey = lastSource = null;
  // 原地重生不能带着毒发/流血继续倒计时，否则一站起来又死；增益效果保留
  if (has(BR.effects, 'clear')) BR.effects.clear({ negative: true });
  if (has(BR.entities, 'clearRadius')) BR.entities.clearRadius(player.x, player.z, BR.config.death.clearRadius);
  applyCamera();
  BR.bus.emit('player:respawn', { x: player.x, y: player.y, z: player.z });
}

// spawn = 层级 spawn() 的返回值，y 为脚底高度；opts.full 可强制 true/false 覆盖"是否新开一局"的判断
function reset(spawn, opts) {
  const s = spawn || {};
  const o = opts || {};
  const full = o.full === true || (o.full !== false && fullResetPending);
  fullResetPending = false;
  // 还坐在车上（换层时 BR.vehicles 一般已经在 level:leave 里放下了）：先强制下车，再摆到新位置
  if (M.handle) forceOut('reset');
  dropMount();

  player.x = num(s.x, 0);
  player.z = num(s.z, 0);
  player.yaw = wrapAngle(num(s.yaw, 0));
  player.pitch = 0;
  player.vx = 0;
  player.vz = 0;
  vy = 0;
  feetY = groundAt(player.x, player.z, num(s.y, 0));
  player.y = feetY + PC.eyeHeight;
  player.onGround = true;
  player.sprinting = false;
  player.noise = 0;
  player.dead = false;
  bobPhase = bobWeight = bobX = bobY = 0;
  lightTimer = 0;
  invuln = 0;

  if (full) {
    player.hp = PC.maxHp;
    player.hunger = 100;
    player.sanity = 100;
    // 原地清空而不是换新数组：HUD 可能缓存了 inventory 的引用
    for (let i = 0; i < SLOTS; i++) player.inventory[i] = null;
    player.inventory.length = SLOTS;
    player.selected = 0;
    sanFx = 0;
    heartbeatTimer = 0;
    lastCause = lastCauseKey = lastSource = null;
    // 新开一局：上一局的时效效果（负面和增益）全部清掉。
    // 换层时的 reset（full=false）不清：否则走个出口就能把液态痛苦的毒解掉
    if (has(BR.effects, 'clear')) BR.effects.clear();
  }
  applyCamera();
  if (has(BR.audio, 'setListener')) BR.audio.setListener(player.x, player.y, player.z, player.yaw);
}

// ---------- 载具：上车、坐着、下车（FE1 叉车；D2 player.setPose 的最小子集，不做 BR.view / BR.body） ----------
// handle（BR.vehicles 给）= { key, update(dt, inp|null) → { x, z, eyeY, feetY, dyaw, noise, shake },
//   path(dir) → [站立眼点, 踏板眼点, 座椅眼点]（世界坐标，dir 'in' | 'out'；'out' 的顺序反过来）, forceExit(reason),
//   cab() → 世界坐标的驾驶舱矩形, chest() → 世界坐标胸口点 }。
// 坐着：照常转视角（pitch 限位不变）、照跑 interact.update 和 handleActions，不走路、不算上下坡、没有头晃；每帧调 handle.update
//   （输入关着时传 null，由 handle 当成「油门 0、方向回正、不升降」），player.x/z = 座椅、y = 眼高、feetY = 车下地面、
//   yaw += dyaw（车转弯视角跟着转）、noise = 车的响动、镜头加 shake（这一帧的抖动幅度，米，见 setShake；减少动态效果时不抖）。
// 上车、下车：0.5 s 沿 path 的折线插值（站立 → 踏板上方 → 座椅；下车反过来，车尾下车时中间点由 handle 换成配重上方），
//   插值时不能走；上车插值的同时视角转向车头、俯仰回平。首点一律换成当前眼点，不会先跳一下。
// 强制下车（死亡、reset、复活）：先调 handle.forceExit(reason)，它回调 unmount 时直接落到 path('out') 的落点，不播插值
function ptOf(p) {
  if (!p || typeof p !== 'object') return null;
  const a = Array.isArray(p);
  const x = +(a ? p[0] : p.x), y = +(a ? p[1] : p.y), z = +(a ? p[2] : p.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}
function handlePath(h, dir) {
  let raw = null;
  try { raw = has(h, 'path') ? h.path(dir) : null; }
  catch (err) { console.error('[player] handle.path 出错', err); }
  const out = [];
  if (Array.isArray(raw)) for (let i = 0; i < raw.length; i++) { const q = ptOf(raw[i]); if (q) out.push(q); }
  return out;
}
// 折线：首点换成当前眼点，其余照 handle 给的；按长度匀速（整体再做一次缓入缓出）
function setPath(pts) {
  const path = [{ x: player.x, y: player.y, z: player.z }];
  for (let i = pts.length > 1 ? 1 : 0; i < pts.length; i++) path.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z });
  M.path = path;
  measurePath();
}
function measurePath() {
  const p = M.path;
  let len = 0;
  M.cum = [0];
  for (let i = 1; i < p.length; i++) {
    len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
    M.cum.push(len);
  }
  M.len = len;
}
function placeOnPath(s) {
  const p = M.path, c = M.cum;
  if (!p || !p.length) return;
  let i = 1;
  while (i < p.length - 1 && c[i] < s) i++;
  if (p.length === 1) { player.x = p[0].x; player.y = p[0].y; player.z = p[0].z; return; }
  const seg = c[i] - c[i - 1];
  const k = seg > 1e-9 ? U.clamp((s - c[i - 1]) / seg, 0, 1) : 1;
  player.x = U.lerp(p[i - 1].x, p[i].x, k);
  player.y = U.lerp(p[i - 1].y, p[i].y, k);
  player.z = U.lerp(p[i - 1].z, p[i].z, k);
}

// 车头朝向（和 player.yaw 同一约定：0 = 朝 -Z）：handle.yaw → cab().rot → 座椅眼点在胸口点前面；都拿不到就不转
function vehYaw(h) {
  try {
    const y = typeof h.yaw === 'function' ? h.yaw() : h.yaw;
    if (typeof y === 'number' && Number.isFinite(y)) return y;
  } catch (err) { /* 往下试 */ }
  try {
    const cab = has(h, 'cab') ? h.cab() : null;
    if (cab && typeof cab === 'object') {
      const r = num(cab.rot, num(cab.yaw, NaN));
      if (r === r) return r;
    }
  } catch (err) { /* 往下试 */ }
  const eye = M.path && M.path.length > 1 ? M.path[M.path.length - 1] : null;
  let ch = null;
  try { ch = has(h, 'chest') ? ptOf(h.chest()) : null; } catch (err) { ch = null; }
  if (eye && ch) {
    const fx = eye.x - ch.x, fz = eye.z - ch.z;
    if (fx * fx + fz * fz > 1e-6) return Math.atan2(-fx, -fz);
  }
  return null;
}

// player.mount(handle) → bool：已经坐在别的车上、死了、handle 不对返回 false
function mount(h) {
  if (!h || !has(h, 'update') || player.dead) return false;
  if (M.handle === h) return true;
  if (M.handle) return false;
  if (M.phase === 'out') finishOut();
  M.handle = h; M.phase = 'in'; M.t = 0; M.err = false;
  setPath(handlePath(h, 'in'));
  M.yaw0 = player.yaw; M.pitch0 = player.pitch; M.yaw1 = vehYaw(h);
  player.pose = 'drive';
  player.vx = 0; player.vz = 0; vy = 0;
  player.onGround = true;
  player.sprinting = false;
  bobWeight = bobX = bobY = 0;
  BR.bus.emit('player:mount', { key: h.key != null ? h.key : null });
  return true;
}

// player.unmount(reason, { instant }?) → bool：交还 handle（之后不再调它的 update）。按 handle.path('out') 走 0.5 s 落回站姿；
// 强制下车（reason 在 UNMOUNT_INSTANT 里、正在 forceExit、人已经死了、opts.instant）直接落到落点
function unmount(reason, opts) {
  const h = M.handle;
  if (!h) return false;
  const why = reason == null ? '' : String(reason);
  const instant = M.forcing || player.dead || !!(opts && opts.instant) || UNMOUNT_INSTANT[why] === 1;
  const pts = handlePath(h, 'out');
  M.handle = null;
  player.noise = 0;
  shX = shY = shZ = 0;
  if (instant) {
    landAt(pts.length ? pts[pts.length - 1] : null);
    dropMount();
  } else {
    M.phase = 'out'; M.t = 0;
    setPath(pts);
    // 落点按地面高度站稳：最后一点的眼高 = 落点地面 + 站立眼高，插值走完不会再跳一下
    const last = M.path[M.path.length - 1];
    if (M.path.length > 1) { last.y = groundAt(last.x, last.z, feetY) + PC.eyeHeight; measurePath(); }
  }
  BR.bus.emit('player:unmount', { key: h.key != null ? h.key : null, reason: why, instant });
  return true;
}

// 落到 p（站立眼点的 x/z；地面按 phys 现算）。没给落点：车旁一圈圈找空地（handle 出错时的兜底）
function landAt(p) {
  let x = player.x, z = player.z;
  if (p) { x = p.x; z = p.z; }
  else { const q = freeSpotNear(x, z); if (q) { x = q[0]; z = q[1]; } }
  player.x = x; player.z = z;
  feetY = groundAt(x, z, feetY);
  player.y = feetY + PC.eyeHeight;
  player.vx = 0; player.vz = 0; vy = 0;
  player.onGround = true;
}
function freeSpotNear(x, z) {
  const P = BR.phys;
  if (!has(P, 'overlapCircle')) return null;
  const r = PC.radius;
  for (let d = 0.9; d <= 4.01; d += 0.3) {
    for (let i = 0; i < 16; i++) {
      const a = (i + (d * 10 | 0) * 0.5) / 16 * TWO_PI, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const g = groundAt(px, pz, feetY);
      if (Math.abs(g - feetY) > 0.5 || P.overlapCircle(px, pz, r, g + 0.02, PC.height)) continue;
      if (has(BR.world, 'blockers')) {
        let bs = null;
        try { bs = BR.world.blockers({ x: px, z: pz, r }); } catch (err) { bs = null; }
        if (bs && bs.length) continue;   // 出口圈、keepClear 里不落人
      }
      return [px, pz];
    }
  }
  return null;
}
function finishOut() {
  if (M.phase !== 'out') return;
  const p = M.path && M.path.length ? M.path[M.path.length - 1] : null;
  landAt(p);
  dropMount();
}
// 不经 handle 直接清掉坐车状态（新开一局 / 回主页：BR.vehicles 自己会清它那边的；levelState 也已经重置，不能再写）
function dropMount() {
  M.handle = null; M.phase = null; M.path = null; M.cum = null; M.len = 0; M.t = 0;
  player.pose = 'stand';
  shX = shY = shZ = 0;
}
// 先让 handle 按强制下车处理（写状态、熄火、找落点、回调 unmount），它没回调就自己落地
function forceOut(reason) {
  const h = M.handle;
  if (!h) return;
  M.forcing = true;
  try { if (has(h, 'forceExit')) h.forceExit(reason); }
  catch (err) { console.error('[player] handle.forceExit 出错', err); }
  finally { M.forcing = false; }
  if (M.handle === h) {
    M.forcing = true;
    try { unmount(reason, { instant: true }); } finally { M.forcing = false; }
    // handle 没走完它那套（出错或没回调）：准心情境还停在 drive 的话退回走路，不然人站在地上却只能「下车」
    const I = BR.interact;
    if (I && I.mode === 'drive' && has(I, 'setMode')) {
      try { I.setMode('walk'); } catch (err) { /* 老 interact 没有情境 */ }
    }
  }
}

function reducedMotion() {
  if (reduceMQ === undefined) {
    try { reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (err) { reduceMQ = null; }
  }
  return !!(reduceMQ && reduceMQ.matches);
}
// shake：数字 = 这一帧的抖动幅度（米；BR.vehicles 撞上「哐」时给 0.03 并在 0.15 s 里自己收到 0），镜头按它摆一个小的三向偏移；
// {x, y, z} = 直接给这一帧的偏移。都限在 SHAKE_MAX 以内；系统设了减少动态效果就不抖
function setShake(v, dt) {
  shT += dt;
  shX = shY = shZ = 0;
  if (!v || reducedMotion()) return;
  if (typeof v === 'object') {
    shX = U.clamp(num(v.x, 0), -SHAKE_MAX, SHAKE_MAX);
    shY = U.clamp(num(v.y, 0), -SHAKE_MAX, SHAKE_MAX);
    shZ = U.clamp(num(v.z, 0), -SHAKE_MAX, SHAKE_MAX);
    return;
  }
  const a = U.clamp(num(v, 0), 0, SHAKE_MAX);
  if (!(a > 0)) return;
  shX = a * Math.sin(shT * 71.3);
  shY = a * 0.6 * Math.sin(shT * 57.1 + 1.7);
  shZ = a * Math.sin(shT * 63.7 + 0.9);
}

// 坐着的这一帧：handle.update 给座椅位置、车下地面、转角增量、响动、抖动
function rideStep(dt, inp) {
  const h = M.handle;
  let r = null;
  try { r = h.update(dt, inp); }
  catch (err) { if (!M.err) { M.err = true; console.error('[player] handle.update 出错', err); } }
  if (M.handle !== h) return;   // update 里已经下车（强制下车之类）
  if (!r || typeof r !== 'object') { player.noise = 0; setShake(0, dt); return; }
  const ok = num(r.x, NaN) === r.x && num(r.z, NaN) === r.z;
  const eyeOk = num(r.eyeY, NaN) === r.eyeY;
  if (M.phase === 'in') {
    // 插值的终点跟着座椅走（车本来停着，这里只防万一）
    const last = M.path && M.path[M.path.length - 1];
    if (last && M.path.length > 1 && ok && eyeOk && (last.x !== r.x || last.y !== r.eyeY || last.z !== r.z)) {
      last.x = r.x; last.y = r.eyeY; last.z = r.z;
      measurePath();
    }
  } else {
    if (ok) { player.x = r.x; player.z = r.z; }
    if (eyeOk) player.y = r.eyeY;
  }
  if (num(r.feetY, NaN) === r.feetY) feetY = r.feetY;
  const dyaw = num(r.dyaw, 0);
  if (dyaw) {
    player.yaw = wrapAngle(player.yaw + dyaw);
    if (M.phase === 'in') { M.yaw0 += dyaw; if (M.yaw1 != null) M.yaw1 += dyaw; }
  }
  player.noise = U.clamp(num(r.noise, 0), 0, 1);
  setShake(r.shake, dt);
}
// 上车 / 下车插值推进一帧
function stepPath(dt) {
  M.t += dt;
  const k = U.clamp(M.t / MOUNT_SEC, 0, 1);
  const e = k * k * (3 - 2 * k);
  placeOnPath(e * M.len);
  if (M.phase === 'in') {
    if (M.yaw1 != null) player.yaw = wrapAngle(M.yaw0 + U.angleDiff(M.yaw0, M.yaw1) * e);
    player.pitch = M.pitch0 * (1 - e);
    if (k >= 1) M.phase = 'seat';
  } else if (M.phase === 'out' && k >= 1) {
    finishOut();
  }
}

// ---------- 每帧 ----------
// 拖着东西时 BR.interact.speedCap() 把人限到拖动速度（越大越慢）：东西跟得上手，人也不会把它甩脱
function dragCap() {
  return has(BR.interact, 'speedCap') ? U.clamp(num(BR.interact.speedCap(), 1), 0, 1) : 1;
}
function dragging() { return !!(BR.interact && BR.interact.dragging); }

function speed() {
  const base = player.sprinting ? PC.sprint : PC.walk;
  // 物品时效效果的加速/减速不属于饥饿/san 数值，所有模式都生效
  const fx = has(BR.effects, 'speedMul') ? Math.max(0, num(BR.effects.speedMul(), 1)) : 1;
  return base * (BR.game.statsEnabled ? BR.speedMulFromHunger(player.hunger) : 1) * fx * dragCap();
}

function updateMovement(dt, inp) {
  let mx = 0, my = 0;
  if (inp && inp.move) { mx = num(inp.move.x, 0); my = num(inp.move.y, 0); }
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }   // 摇杆推不满就走得慢，键盘斜走不能比直走快
  const wants = mag > 0.05;
  player.sprinting = wants && !!(inp && inp.sprint) && !dragging();   // 拖东西不能冲刺

  const sp = speed();
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  // yaw = 0 面朝 -Z：前 = (-sin, -cos)，右 = (cos, -sin)
  player.vx = U.damp(player.vx, (c * mx - s * my) * sp, ACCEL, dt);
  player.vz = U.damp(player.vz, (-s * mx - c * my) * sp, ACCEL, dt);
  if (!wants && player.vx * player.vx + player.vz * player.vz < 1e-4) { player.vx = 0; player.vz = 0; }

  const dx = player.vx * dt, dz = player.vz * dt;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0) return 0;
  const ox = player.x, oz = player.z;
  if (has(BR.phys, 'moveCircle')) {
    // 每小步不超过碰撞半径：冲刺 + 卡顿长帧时也不会跳过薄墙
    const n = Math.min(4, Math.ceil(dist / (PC.radius * 0.9)));
    let hitX = false, hitZ = false;
    for (let k = 0; k < n; k++) {
      const r = BR.phys.moveCircle(player.x, player.z, PC.radius, dx / n, dz / n, feetY, PC.height);
      if (!r) break;
      player.x = num(r.x, player.x);
      player.z = num(r.z, player.z);
      if (r.hitX) hitX = true;
      if (r.hitZ) hitZ = true;
    }
    // 撞墙的那个轴清零，否则速度一直顶着墙，离开墙角时会被弹出去
    if (hitX) player.vx = 0;
    if (hitZ) player.vz = 0;
  } else {
    player.x += dx;
    player.z += dz;
  }
  return Math.hypot(player.x - ox, player.z - oz);
}

function updateVertical(dt) {
  const g = groundAt(player.x, player.z, feetY);
  if (feetY > g + STEP_DOWN_SNAP || (!player.onGround && feetY > g)) {
    player.onGround = false;
    vy -= GRAVITY * dt;
    feetY += vy * dt;
    if (feetY <= g) { feetY = g; vy = 0; player.onGround = true; }
  } else {
    player.onGround = true;
    vy = 0;
    feetY = U.damp(feetY, g, STEP_UP_LAMBDA, dt);
    if (Math.abs(feetY - g) < 0.002) feetY = g;
  }
  player.y = feetY + PC.eyeHeight;
}

function updateBob(moved, dt) {
  if (moved > 0 && player.onGround) {
    const before = Math.floor(bobPhase / Math.PI);
    bobPhase += moved / (player.sprinting ? STRIDE_SPRINT : STRIDE_WALK) * Math.PI;
    // 相位每过一个 π 落一次脚
    if (Math.floor(bobPhase / Math.PI) !== before) {
      sound('step', { volume: player.sprinting ? 0.85 : 0.55, rate: 0.92 + Math.random() * 0.16 });
    }
    if (bobPhase > TWO_PI * 64) bobPhase -= TWO_PI * 64;   // 减 2π 的整数倍，相位和左右脚都不变
  }
  const hs = moved / dt;
  bobWeight = U.damp(bobWeight, player.onGround ? U.clamp(hs / PC.walk, 0, 1.3) : 0, 8, dt);
  const amp = bobWeight * (player.sprinting ? BOB_SPRINT_MUL : 1);
  // 落脚瞬间视点最低、左右摆到最远
  bobY = (Math.abs(Math.sin(bobPhase)) - 0.5) * BOB_Y * amp;
  bobX = Math.cos(bobPhase) * BOB_X * amp;
}

function updateStats(dt) {
  const env = levelEnv();
  const hungerMul = player.sprinting ? ST.sprintHungerMul : 1;
  player.hunger = U.clamp(player.hunger - ST.hungerDrainPerSec * hungerMul * num(env.hungerDrainMul, 1) * dt, 0, 100);

  let drain = ST.sanityDrainPerSec * num(env.sanityDrainMul, 1);
  lightTimer -= dt;
  if (lightTimer <= 0) {
    lightTimer = LIGHT_SAMPLE_SEC;
    lightCached = has(BR.world, 'lightAt') ? num(+BR.world.lightAt(player.x, player.z), 1) : 1;
  }
  if (lightCached < DARK_LIGHT) drain *= 2;

  let regen = 0;
  const fr2 = FRIENDLY_RADIUS * FRIENDLY_RADIUS;
  forEachEntity(e => {
    if (!e || !e.def || e.dead || (typeof e.hp === 'number' && e.hp <= 0)) return;
    if (typeof e.y === 'number' && Math.abs(e.y - feetY) > AURA_DY) return;   // 楼上楼下不算"附近"
    const d2 = U.dist2(player.x, player.z, e.x, e.z);
    const aura = e.def.aura;
    if (aura && aura.radius > 0 && d2 <= aura.radius * aura.radius) drain += num(aura.sanityPerSec, 0);
    if (e.def.faction === 'friendly' && d2 <= fr2) regen = FRIENDLY_REGEN;   // 不叠加，免得友善实体扎堆时 san 回满太快
  });
  player.sanity = U.clamp(player.sanity + (regen - drain) * dt, 0, 100);

  if (player.sanity <= 0) {
    player.hp = Math.max(0, player.hp - BREAKDOWN_HP_PER_SEC * dt);
    rememberCause('sanity', null);
    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) { heartbeatTimer = HEARTBEAT_SEC; sound('heartbeat', { volume: 0.8 }); }
  } else {
    heartbeatTimer = 0;
  }
}

function updateSanityFeedback(dt) {
  const on = BR.game.statsEnabled;
  sanFx = on ? U.damp(sanFx, 1 - player.sanity / 100, SAN_FX_LAMBDA, dt) : 0;
  if (has(BR.gfx, 'setSanityEffect')) BR.gfx.setSanityEffect(sanFx);
  if (has(BR.audio, 'setSanity')) BR.audio.setSanity(on ? player.sanity / 100 : 1);
}

// 镜头被别的模块接管（BR.view：监控画面、坐下、开车……，D2 实现）时不写相机；听者位置仍由 update 留在人身上
function viewOwned() {
  const v = BR.view;
  if (!v) return false;
  try { return typeof v.owner === 'function' ? !!v.owner() : !!v.owner; } catch (err) { return false; }
}

function applyCamera() {
  const cam = BR.gfx && BR.gfx.camera;
  if (!cam || viewOwned()) return;
  const c = Math.cos(player.yaw), s = Math.sin(player.yaw);
  cam.rotation.order = 'YXZ';   // 先 yaw 后俯仰，第一人称不会出现滚转
  cam.rotation.set(player.pitch, player.yaw, 0);
  // 左右晃动沿相机右方向偏移；坐车撞上东西时再加一点抖动（走路时恒为 0）
  cam.position.set(player.x + c * bobX + shX, player.y + bobY + shY, player.z - s * bobX + shZ);
}

// 空格 / E 不在这里处理：BR.interact.update 统一判短按、长按、拖动
function handleActions(inp) {
  if (!has(inp, 'pressed')) return;
  for (let i = 0; i < SLOTS; i++) if (inp.pressed('slot' + (i + 1))) select(i);
  if (!has(BR.interact, 'update') && inp.pressed('interact')) interact();   // 没载入 interact.js 时的兜底
  if (inp.pressed('use')) useSelected();
  if (inp.pressed('drop')) dropSelected();
}

function update(dt) {
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);   // 切后台回来的超长帧会让人穿墙、瞬间饿一大截
  const inp = BR.input;
  const active = !!inp && inp.enabled !== false;
  // 死亡或菜单打开时也把视角增量取走，否则恢复那一帧镜头会猛地一甩
  const look = has(inp, 'consumeLook') ? inp.consumeLook() : null;
  if (player.dead) return;
  if (invuln > 0) invuln = Math.max(0, invuln - dt);

  // 上车插值的 0.5 s 里视角由插值接管（转向车头），这段时间的鼠标 / 滑屏增量丢掉；坐着、下车时照常转头
  if (active && look && M.phase !== 'in') {
    player.yaw = wrapAngle(player.yaw - num(look.dx, 0));
    player.pitch = U.clamp(player.pitch - num(look.dy, 0), -PITCH_LIMIT, PITCH_LIMIT);
  }

  // 准心交互：用这一帧的朝向瞄准、判空格短按 / 长按、推着拖动的东西走；放在走路之前，speed() 才拿得到这一帧的拖动限速。
  // 输入关着（暂停、菜单）或 handleActions=false 时传 null：手里拖着的东西原地放下。坐车时照跑（短按 = 下车，由 drive 情境的接管者处理）
  if (has(BR.interact, 'update')) {
    try { BR.interact.update(dt, active && player.handleActions ? inp : null); }
    catch (err) { if (!interactErr) { interactErr = true; console.error('[player] interact.update 出错', err); } }
  }

  const ox = player.x, oz = player.z;
  if (M.handle) {
    // 坐车：车由 handle 开（输入关着时传 null = 松油门、方向回正、不升降），不走路、不算上下坡
    rideStep(dt, active ? inp : null);
    if (M.phase === 'in') stepPath(dt);
  } else if (M.phase === 'out') {
    stepPath(dt);
  }
  if (M.handle || M.phase) {
    // 坐车、上下车：没有头晃、不冲刺；速度按这一帧实际挪了多少算（有的层按 vx/vz 判断人在不在动）
    bobWeight = bobX = bobY = 0;
    player.sprinting = false;
    player.vx = (player.x - ox) / dt;
    player.vz = (player.z - oz) / dt;
    if (!M.handle) { player.noise = 0; shX = shY = shZ = 0; }
  } else {
    const moved = updateMovement(dt, active ? inp : null);
    updateVertical(dt);
    updateBob(moved, dt);
    player.noise = moved / dt > MOVE_EPS ? (player.sprinting ? NOISE_SPRINT : NOISE_WALK) : 0;
  }

  if (BR.game.statsEnabled) updateStats(dt);
  updateSanityFeedback(dt);
  // 物品时效效果：排在低 san 画面之后，药效的画面扭曲才能在同一帧里取两者较大值
  if (has(BR.effects, 'update')) BR.effects.update(dt);
  applyCamera();
  if (has(BR.audio, 'setListener')) BR.audio.setListener(player.x, player.y, player.z, player.yaw);

  if (active && player.handleActions) handleActions(inp);
  checkDeath();
}

// ---------- 局外 ----------
function onNewSession() {
  fullResetPending = true;
  // 上一局还坐在车上：直接清掉（BR.vehicles 自己听 game:start / game:home 清它那边；levelState 已经重置，不能再让 handle 写状态）
  if (M.handle || M.phase) dropMount();
  sanFx = 0;
  // 回主页时不能把低 san 的画面扭曲带过去
  if (has(BR.gfx, 'setSanityEffect')) BR.gfx.setSanityEffect(0);
  if (has(BR.audio, 'setSanity')) BR.audio.setSanity(1);
}
BR.bus.on('game:start', onNewSession);
BR.bus.on('game:home', onNewSession);
})();
