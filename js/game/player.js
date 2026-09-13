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

const player = BR.player = {
  x: 0, y: PC.eyeHeight, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true,
  hp: PC.maxHp, hunger: 100, sanity: 100,
  // 固定 5 格，空格为 null：格子位置稳定，用完一格不会让后面的物品挪位、选中的东西突然变了
  inventory: new Array(SLOTS).fill(null),
  selected: 0,
  sprinting: false, noise: 0,
  dead: false,
  // update 内部处理 interact / use / drop / slot1-5；集成层若要自己接管这些按键就置 false，避免一次按键用掉两个
  handleActions: true,
  slots: SLOTS,
  get feetY() { return feetY; },
  speed, damage, useSelected, respawnInPlace, reset, update,
  interactTarget, interact, select, dropSelected,
  addItem, canAdd, countOf, removeItem,
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
  let consumed = false;
  try { consumed = def.use(player, BR.game) === true; }
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
  const slot = player.inventory[player.selected];
  if (!slot || !has(BR.items, 'spawn')) return false;
  // 第 9 节只约定了拾取同步，丢弃物在对方那边不存在，捡的时候房主也不认这个 id
  if (coop()) { toast('联机时不能丢弃物品'); return false; }
  let px = player.x - Math.sin(player.yaw) * DROP_DIST;
  let pz = player.z - Math.cos(player.yaw) * DROP_DIST;
  if (has(BR.phys, 'los') && !BR.phys.los(player.x, player.y, player.z, px, feetY + 0.2, pz)) {
    px = player.x;   // 面前是墙就丢在脚下，别丢进墙里
    pz = player.z;
  }
  const p = BR.items.spawn(slot.type, px, groundAt(px, pz, feetY), pz, { id: U.uid('drop'), dropped: true });
  if (!p) return false;
  removeFromSlot(player.selected, 1);
  return true;
}

// ---------- 互动 ----------
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

function interactTarget() {
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

function interact() {
  const t = interactTarget();
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

// ---------- 每帧 ----------
function speed() {
  const base = player.sprinting ? PC.sprint : PC.walk;
  // 物品时效效果的加速/减速不属于饥饿/san 数值，所有模式都生效
  const fx = has(BR.effects, 'speedMul') ? Math.max(0, num(BR.effects.speedMul(), 1)) : 1;
  return base * (BR.game.statsEnabled ? BR.speedMulFromHunger(player.hunger) : 1) * fx;
}

function updateMovement(dt, inp) {
  let mx = 0, my = 0;
  if (inp && inp.move) { mx = num(inp.move.x, 0); my = num(inp.move.y, 0); }
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }   // 摇杆推不满就走得慢，键盘斜走不能比直走快
  const wants = mag > 0.05;
  player.sprinting = wants && !!(inp && inp.sprint);

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

function applyCamera() {
  const cam = BR.gfx && BR.gfx.camera;
  if (!cam) return;
  const c = Math.cos(player.yaw), s = Math.sin(player.yaw);
  cam.rotation.order = 'YXZ';   // 先 yaw 后俯仰，第一人称不会出现滚转
  cam.rotation.set(player.pitch, player.yaw, 0);
  // 左右晃动沿相机右方向偏移
  cam.position.set(player.x + c * bobX, player.y + bobY, player.z - s * bobX);
}

function handleActions(inp) {
  if (!has(inp, 'pressed')) return;
  for (let i = 0; i < SLOTS; i++) if (inp.pressed('slot' + (i + 1))) select(i);
  if (inp.pressed('interact')) interact();
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

  if (active && look) {
    player.yaw = wrapAngle(player.yaw - num(look.dx, 0));
    player.pitch = U.clamp(player.pitch - num(look.dy, 0), -PITCH_LIMIT, PITCH_LIMIT);
  }

  const moved = updateMovement(dt, active ? inp : null);
  updateVertical(dt);
  updateBob(moved, dt);
  player.noise = moved / dt > MOVE_EPS ? (player.sprinting ? NOISE_SPRINT : NOISE_WALK) : 0;

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
  sanFx = 0;
  // 回主页时不能把低 san 的画面扭曲带过去
  if (has(BR.gfx, 'setSanityEffect')) BR.gfx.setSanityEffect(0);
  if (has(BR.audio, 'setSanity')) BR.audio.setSanity(1);
}
BR.bus.on('game:start', onNewSession);
BR.bus.on('game:home', onNewSession);
})();
