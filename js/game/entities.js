// 后室 · 实体管理：按密度生成、阵营战斗、AI 调度、清场、联机快照
// 接口见 ARCHITECTURE.md 第 6、12 节。读 BR.phys / BR.player / BR.world / BR.gfx / BR.audio / BR.coop
//
// 第 6 节之外，实体定义还可以带这些可选钩子（都可省略）：
//   init(e, api)                      生成后调用一次（仅房主/单机）
//   animate(e, dt, api)               每帧调用，房主和联机客机都跑；只做表现（摆动、闪红、倒地），别改位置
//   onHit(e, amount, attacker, api)   受伤后调用（仅房主）
//   onDeath(e, api) → 秒数            返回 > 0 就保留尸体这么久，到时再移除并发 entity:kill；否则立即移除
//   dispose(e)                        移除时释放实例独有的其他资源
//   attack.entityHp                   打实体时的伤害，缺省用 attack.hp
// 资源约定：模型的几何体/材质默认当作共享的（assets 缓存、模块级缓存、GLB 克隆都共享），移除实体时不释放；
//   实例独有的几何体或材质把自己的 userData.entityOwned 设为 true，移除时统一 dispose。
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

// ---------- 调参 ----------
const MAX_DT = 0.1;            // 切后台回来的长帧会让实体一步穿过半个区块
const THINK_FAR = 60;          // 离所有玩家这么远就降频思考
const FAR_INTERVAL = 0.5;      // 远处实体每隔这么久想一次
const DEFAULT_SIGHT = 15;
const TOUCH_RANGE = 1.5;       // 贴身时不管视线、听觉都能察觉（背后被撞上不可能没感觉）
const ENTITY_NOISE = 0.5;      // 实体走动打斗的"噪音"，折算进听觉半径
const CHEST_H = 1.2;           // 视线检测：眼高对目标胸高
const FLOOR_DY = 2.5;          // 高度差超过这个当作不同楼层，不互相索敌
const SCAN_SEC = 0.25;         // 重新扫描目标的间隔：LOS 射线不便宜，手机上 28 只实体每帧都扫吃不消
const MEMORY_SEC = 3;          // 目标躲进视线外后还记得多久（去最后看到的位置找）
const KEEP_RANGE_MUL = 1.25;   // 已锁定的目标跑出索敌半径一点点不立刻丢，免得在边界上反复切换
const MAX_LOS_CHECKS = 4;      // 每次扫描最多对最近的几个候选做视线检测
const PROVOKE_SEC = 20;        // 中立实体被打后记仇多久
const TURN_RATE = 8;           // 转身角速度 rad/s
const ARRIVE = 0.15;
const STUCK_FRAC = 0.35;       // 实际位移不到期望的这个比例 = 正面顶墙，贴墙滑都滑不动
const DETOUR_MIN = 0.5, DETOUR_MAX = 1.1;
const DETOUR_MEMORY = 1.5;     // 绕完这么久内又顶墙，沿用上次的绕行方向
const PROBE = 0.8;             // 绕行中探测原方向是否畅通的距离（米，加在半径外）
const KEEP_NEAR = 24;          // 区块卸载时离玩家这么近的实体留下（正追着人跑出了自己的区块）
const ORPHAN_SWEEP_SEC = 2;
const SEP_STIFF = 0.5;         // 实体之间软分离的力度（每帧推开重叠量的比例）
const SNAP_SEC = 0.1;          // 快照 10Hz，插值 100ms
const SEARCH_STEP_MIN = 0.25, SEARCH_MAX = 6, SEARCH_DY = 1;   // 落点被挡时往外找空位的步长、最远距离、允许高度差
const IDLE_MIN = 6, IDLE_MAX = 14, IDLE_HEAR = 25, ALERT_HEAR = 30;
const DARK = 0.2;              // perception.needsLight 的实体在低于这个光照处看不见

// ---------- 状态 ----------
const ents = [];               // 对外的 list：只做原地压缩，外部拿到的引用始终有效
const byId = new Map();
let time = 0;
let iterating = false;         // 遍历中途移除的实体延后压缩，避免跳过下一个
let dirty = false;
let authOverride = null;       // null = 按联机角色自动判断
let aiRng = U.mulberry32(0x5eed1234);
let curDt = 0;                 // 当前 think 的步长；远处实体降频时比帧时间长，移动帮助函数都按它算
let orphanT = 0;
const warned = new Set();
const cands = [];

// ---------- 小工具 ----------
function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }
function num(v, d) { v = +v; return Number.isFinite(v) ? v : d; }
function once(key, fn) { if (!warned.has(key)) { warned.add(key); fn(); } }
function wrapAngle(a) {
  const T = Math.PI * 2;
  a = (a + Math.PI) % T;
  if (a < 0) a += T;
  return a - Math.PI;
}
function rand(a, b) { return a + (b - a) * aiRng(); }
function sceneOf() { return BR.gfx && BR.gfx.scene; }
function groundAt(x, z, fallback) {
  if (has(BR.phys, 'groundY')) {
    const g = +BR.phys.groundY(x, z);
    if (Number.isFinite(g)) return g;
  }
  return fallback;
}
function safeCall(def, fn, a, b, c, d) {
  try { return def[fn](a, b, c, d); }
  catch (err) { once(fn + ':' + def.type, () => console.error('[entities] ' + def.type + '.' + fn + ' 出错', err)); }
  return undefined;
}
function alive(e) { return !!e && !e.dead && !e.removed; }
function walkOf(e) { return num(e.def.speed && e.def.speed.walk, 1.2); }
function runOf(e) { return num(e.def.speed && e.def.speed.run, walkOf(e) * 2); }

function coopGuest() {
  const c = BR.game.coop;
  if (c && c.active) return c.role === 'guest';
  return !!(BR.coop && BR.coop.active && BR.coop.role === 'guest');
}
function isAuthoritative() { return authOverride !== null ? authOverride : !coopGuest(); }

// ---------- 玩家 ----------
function playerRef() { const p = BR.player; return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? p : null; }
function playerAlive(p) { return !!p && !p.dead && !(typeof p.hp === 'number' && p.hp <= 0); }
// player.y 是眼睛高度（player.js：y = feetY + eyeHeight）
function playerFeet(p) { return num(p.y, BR.config.player.eyeHeight) - BR.config.player.eyeHeight; }
// 联机对方的位置由 coop 提供（可选）；没有就只看本机玩家
function peerPos() {
  const c = BR.coop;
  const q = c && c.active && c.peer;
  return q && Number.isFinite(q.x) && Number.isFinite(q.z) ? q : null;
}
// 离最近一名玩家的平方距离；一个玩家都没有（自测页）时返回 Infinity
function nearestPlayerD2(x, z) {
  let best = Infinity;
  const p = playerRef();
  if (p) best = U.dist2(x, z, p.x, p.z);
  const q = peerPos();
  if (q) best = Math.min(best, U.dist2(x, z, q.x, q.z));
  return best;
}

function playerNoise() {
  const p = BR.player;
  if (!p || p.dead) return 0;
  return U.clamp(num(p.noise, 0), 0, 1);
}
function lightAt(x, z) {
  return has(BR.world, 'lightAt') ? U.clamp(num(BR.world.lightAt(x, z), 1), 0, 1) : 1;
}

function sound(e, name) {
  if (!name || !has(BR.audio, 'play')) return;
  try { BR.audio.play(name, { x: e.x, y: e.y + e.h * 0.6, z: e.z }); }
  catch (err) { once('snd:' + name, () => console.warn('[entities] 音效播放失败', name, err)); }
}

// ---------- 阵营规则（第 6 节，全项目唯一实现处；行为代码只通过 findTarget / attack 间接用到） ----------
function provoker(e) {
  const m = e._m;
  if (!m.provoker) return null;
  if (time > m.provokeUntil || (m.provoker !== 'player' && !alive(m.provoker))) { m.provoker = null; return null; }
  return m.provoker;
}

function canAttack(a, kind, ref) {
  if (!alive(a) || !ref) return false;
  const fa = a.def.faction;
  if (kind === 'player') {
    // 游玩/测试模式实体不打玩家；player.damage 自己也会再拦一层
    if (!BR.game.attackPlayers || !playerAlive(ref)) return false;
    if (fa === 'hostile') return true;
    return fa === 'neutral' && provoker(a) === 'player';
  }
  if (!alive(ref) || ref === a) return false;
  const fb = ref.def.faction;
  if (fa === 'hostile') return fb === 'friendly' || fb === 'dummy';
  if (fa === 'friendly') return fb === 'hostile';
  if (fa === 'neutral') return provoker(a) === ref;
  return false;   // dummy 和未知阵营：从不攻击
}

// 统一 target 的写法：findTarget 的结果 / 实体对象 / BR.player 都认
function resolveTarget(target) {
  if (!target) return null;
  if (target.kind === 'player' || target.kind === 'entity') return target.ref ? target : null;
  if (target === BR.player) return { kind: 'player', ref: target };
  if (target.def) return { kind: 'entity', ref: target };
  return null;
}

function chestY(kind, ref) {
  return kind === 'player' ? playerFeet(ref) + CHEST_H : ref.y + Math.min(ref.h * 0.65, CHEST_H);
}
function targetRadius(kind, ref) { return kind === 'player' ? BR.config.player.radius : ref.r; }

// ---------- 感知 ----------
function los(e, x, z, y) {
  if (!has(BR.phys, 'los')) return true;
  const ty = Number.isFinite(y) ? y : groundAt(x, z, e.y) + CHEST_H;
  return BR.phys.los(e.x, e.y + e.h * 0.9, e.z, x, ty, z);
}

function perceive(e, kind, ref, dist) {
  if (dist <= TOUCH_RANGE) return true;
  const p = e.def.perception || {};
  // 听觉不需要视线：隔墙也能听见冲刺的脚步
  const hearing = num(p.hearing, 0);
  if (hearing > 0 && dist <= hearing * (kind === 'player' ? playerNoise() : ENTITY_NOISE)) return true;
  if (dist > num(p.sight, DEFAULT_SIGHT)) return false;
  const fov = num(p.fov, 360);
  if (fov < 360) {
    const want = Math.atan2(-(ref.x - e.x), -(ref.z - e.z));
    if (Math.abs(U.angleDiff(e.yaw, want)) > fov * Math.PI / 360) return false;
  }
  if (p.needsLight && lightAt(ref.x, ref.z) < DARK) return false;
  return los(e, ref.x, ref.z, chestY(kind, ref));
}

// 返回 { kind, ref, x, z, dist, seen }；看不见但还记得时 x/z 是最后看到的位置
function findTarget(e, range) {
  if (!alive(e)) return null;
  const m = e._m;
  const p = e.def.perception || {};
  const R = num(range, num(p.sight, DEFAULT_SIGHT));
  const had = e.target;

  if (had && canAttack(e, had.kind, had.ref)) {
    const ref = had.ref;
    const dist = Math.hypot(ref.x - e.x, ref.z - e.z);
    if (dist <= R * KEEP_RANGE_MUL) {
      if (time >= m.seenCheckAt) {
        m.seenCheckAt = time + SCAN_SEC;
        m.curSeen = perceive(e, had.kind, ref, dist);
        if (m.curSeen) m.seenAt = time;
      }
      if (time - m.seenAt <= MEMORY_SEC) {
        if (m.curSeen) { had.x = ref.x; had.z = ref.z; }
        had.dist = Math.hypot(had.x - e.x, had.z - e.z);
        had.seen = m.curSeen;
        return had;
      }
    }
  }
  if (time < m.scanAt) { e.target = null; return null; }
  m.scanAt = time + SCAN_SEC * (0.8 + 0.4 * aiRng());   // 错开扫描时刻，别让一群实体同一帧打射线

  const R2 = R * R;
  cands.length = 0;
  const pl = playerRef();
  if (pl && canAttack(e, 'player', pl) && Math.abs(playerFeet(pl) - e.y) <= FLOOR_DY) {
    const d2 = U.dist2(e.x, e.z, pl.x, pl.z);
    if (d2 <= R2) cands.push({ kind: 'player', ref: pl, d2 });
  }
  if (e.def.faction !== 'dummy') {
    for (let i = 0; i < ents.length; i++) {
      const o = ents[i];
      if (o === e || !alive(o) || Math.abs(o.y - e.y) > FLOOR_DY) continue;
      const d2 = U.dist2(e.x, e.z, o.x, o.z);
      if (d2 <= R2 && canAttack(e, 'entity', o)) cands.push({ kind: 'entity', ref: o, d2 });
    }
  }
  cands.sort((a, b) => a.d2 - b.d2);
  const n = Math.min(cands.length, MAX_LOS_CHECKS);
  for (let i = 0; i < n; i++) {
    const c = cands[i];
    const dist = Math.sqrt(c.d2);
    if (!perceive(e, c.kind, c.ref, dist)) continue;
    const t = { kind: c.kind, ref: c.ref, x: c.ref.x, z: c.ref.z, dist, seen: true };
    if (!had && e.def.sounds && e.def.sounds.alert && nearestPlayerD2(e.x, e.z) <= ALERT_HEAR * ALERT_HEAR) {
      sound(e, e.def.sounds.alert);
    }
    e.target = t;
    m.seenAt = time;
    m.curSeen = true;
    m.seenCheckAt = time + SCAN_SEC;
    cands.length = 0;
    return t;
  }
  cands.length = 0;
  e.target = null;
  return null;
}

// ---------- 移动 ----------
const mv = { moved: 0, dx: 0, dz: 0, hit: false, hitX: false, hitZ: false };

function moveBy(e, dx, dz) {
  const ox = e.x, oz = e.z;
  if (has(BR.phys, 'moveCircle')) {
    const r = BR.phys.moveCircle(e.x, e.z, e.r, dx, dz, e.y, e.h);
    e.x = r.x; e.z = r.z;
    mv.hit = !!r.hit; mv.hitX = !!r.hitX; mv.hitZ = !!r.hitZ;
  } else {
    e.x += dx; e.z += dz;
    mv.hit = mv.hitX = mv.hitZ = false;
  }
  e.y = groundAt(e.x, e.z, e.y);
  mv.dx = e.x - ox; mv.dz = e.z - oz;
  mv.moved = Math.hypot(mv.dx, mv.dz);
  return mv;
}

function turnTo(e, yaw, dt) {
  const d = U.angleDiff(e.yaw, yaw);
  const lim = TURN_RATE * dt;
  e.yaw = wrapAngle(e.yaw + U.clamp(d, -lim, lim));
}
function faceMoved(e, dt) { if (mv.moved > 1e-4) turnTo(e, Math.atan2(-mv.dx, -mv.dz), dt); }

// 原方向前方 PROBE 米是否畅通（腰高射线）；绕行中用它判断能不能提前回到直线
function probeClear(e, ux, uz) {
  if (!has(BR.phys, 'los')) return true;
  const y = e.y + e.h * 0.5, d = e.r + PROBE;
  return BR.phys.los(e.x, y, e.z, e.x + ux * d, y, e.z + uz * d);
}

// 定向移动 + 避障。moveCircle 自己会贴墙滑；只有正面顶墙、滑也滑不动时才绕行：
// 沿墙切向走（第一次优先靠近原方向的一侧），前方通了就回到直线。
// 刚绕完又顶上墙时沿用上次的绕行方向 —— 每次都按目标方向重选的话，在墙中段会左右来回摆，永远绕不过去；
// 绕行途中又顶死（死角）就反向、换另一侧
function steer(e, ux, uz, speed) {
  const dt = curDt, m = e._m;
  const step = Math.max(0, speed) * dt;
  if (!(step > 0)) return;
  let dx = ux, dz = uz;
  let detouring = m.detourT > 0;
  if (detouring) {
    m.detourT -= dt;
    if (m.detourT <= 0 || probeClear(e, ux, uz)) { m.detourT = 0; m.detourEndAt = time; detouring = false; }
    else { dx = m.detourX; dz = m.detourZ; }
  }
  moveBy(e, dx * step, dz * step);
  faceMoved(e, dt);
  if (!mv.hit || mv.moved >= step * STUCK_FRAC) {
    if (!detouring && time - m.detourEndAt > DETOUR_MEMORY) m.detourN = 0;
    return;
  }

  if (!m.side) m.side = aiRng() < 0.5 ? 1 : -1;
  let tx, tz;
  if (detouring) {
    m.side = -m.side;
    tx = -dx; tz = -dz;
  } else if (m.detourN > 0 && time - m.detourEndAt <= DETOUR_MEMORY) {
    tx = m.detourX; tz = m.detourZ;
  } else if (mv.hitX && !mv.hitZ) {
    tx = 0; tz = Math.abs(uz) > 0.2 ? Math.sign(uz) : m.side;
  } else if (mv.hitZ && !mv.hitX) {
    tx = Math.abs(ux) > 0.2 ? Math.sign(ux) : m.side; tz = 0;
  } else {
    tx = -uz * m.side; tz = ux * m.side;   // 墙角：转 90°
  }
  const L = Math.hypot(tx, tz) || 1;
  m.detourX = tx / L; m.detourZ = tz / L;
  m.detourN = Math.min(m.detourN + 1, 6);
  // 连续绕行越久，每段走得越长：长墙也能一口气沿到头
  m.detourT = rand(DETOUR_MIN, DETOUR_MAX) * (1 + 0.5 * m.detourN);
}

function moveToward(e, x, z, speed) {
  if (!alive(e)) return false;
  const dx = x - e.x, dz = z - e.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= ARRIVE) return true;
  // 最后一步不冲过头
  const sp = Math.min(num(speed, walkOf(e)), dist / Math.max(curDt, 1e-3));
  steer(e, dx / dist, dz / dist, sp);
  return Math.hypot(x - e.x, z - e.z) <= ARRIVE;
}

// 随机游走：隔几秒换方向，偶尔停一下；撞墙就按墙面反射再加点随机，保证转开而不是贴墙蹭
function wander(e, speed) {
  if (!alive(e)) return false;
  const m = e._m, dt = curDt;
  if (m.wanderT <= 0) {
    m.wanderYaw = wrapAngle(e.yaw + (aiRng() - 0.5) * Math.PI * 1.2);
    m.wanderT = rand(2, 5);
    if (aiRng() < 0.15) m.pauseT = rand(0.6, 1.8);
  }
  m.wanderT -= dt;
  if (m.pauseT > 0) { m.pauseT -= dt; return false; }
  const ux = -Math.sin(m.wanderYaw), uz = -Math.cos(m.wanderYaw);
  const step = Math.max(0, num(speed, walkOf(e))) * dt;
  if (!(step > 0)) return false;
  moveBy(e, ux * step, uz * step);
  faceMoved(e, dt);
  if (mv.hit && mv.moved < step * 0.5) {
    const rx = mv.hitX ? -ux : ux, rz = mv.hitZ ? -uz : uz;
    m.wanderYaw = wrapAngle(Math.atan2(-rx, -rz) + (aiRng() - 0.5) * 1.2);
    m.wanderT = rand(1.5, 4);
  }
  return true;
}

// 返回离威胁的当前距离
function flee(e, x, z, speed) {
  if (!alive(e)) return 0;
  let dx = e.x - x, dz = e.z - z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { const a = aiRng() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
  steer(e, dx / d, dz / d, num(speed, runOf(e)));
  return Math.hypot(e.x - x, e.z - z);
}

function faceToward(e, x, z) { turnTo(e, Math.atan2(-(x - e.x), -(z - e.z)), Math.max(curDt, 1 / 60)); }

// ---------- 战斗 ----------
function attack(e, target) {
  if (!alive(e)) return false;
  const atk = e.def.attack;
  const t = resolveTarget(target);
  if (!atk || !t || e.cooldown > 0) return false;
  const kind = t.kind, ref = t.ref;
  if (!canAttack(e, kind, ref)) return false;
  const dist = Math.hypot(ref.x - e.x, ref.z - e.z);
  if (dist > num(atk.range, 1.2) + targetRadius(kind, ref)) return false;
  if (!los(e, ref.x, ref.z, chestY(kind, ref))) return false;   // 隔着薄墙挠不到

  e.cooldown = Math.max(0.05, num(atk.cooldown, 1));
  e.yaw = Math.atan2(-(ref.x - e.x), -(ref.z - e.z));   // 出手瞬间正对目标
  e._m.attackAt = time;
  let ok = false;
  if (kind === 'player') {
    if (has(BR.player, 'damage')) {
      ok = BR.player.damage({ hp: num(atk.hp, 0), sanity: num(atk.sanity, 0), source: e }) !== false;
    }
  } else {
    ok = damageEntity(ref, atk.entityHp != null ? atk.entityHp : num(atk.hp, 0), e);
  }
  if (e.def.sounds && e.def.sounds.attack) sound(e, e.def.sounds.attack);
  return ok;
}

function damageEntity(t, amount, source) {
  if (typeof t === 'string') t = byId.get(t);
  if (!alive(t)) return false;
  amount = Math.max(0, num(amount, 0));
  if (amount <= 0) return false;
  t.hp = Math.max(0, t.hp - amount);
  t.hitAt = time;
  const src = source === 'player' || (source && source === BR.player) ? 'player' : (source && source.def ? source : null);
  if (t.def.faction === 'neutral' && src) { t._m.provoker = src; t._m.provokeUntil = time + PROVOKE_SEC; }
  if (has(t.def, 'onHit')) safeCall(t.def, 'onHit', t, amount, source, api);
  if (t.hp <= 0) kill(t, source);
  return true;
}

function killerInfo(k) {
  if (k === 'player' || (k && k === BR.player)) return ['player', 'player'];
  if (k && k.def) return [k.id, k.type];
  return [null, null];
}

function kill(e, killer) {
  if (typeof e === 'string') e = byId.get(e);
  if (!alive(e)) return;
  const info = killerInfo(killer);
  e.hp = 0;
  e.dead = true;
  e.state = 'dead';
  e.target = null;
  e._m.killer = info[0];
  e._m.killerType = info[1];
  sound(e, 'hit');
  const hold = has(e.def, 'onDeath') ? num(safeCall(e.def, 'onDeath', e, api), 0) : 0;
  if (hold > 0) e._m.removeAt = time + hold;
  else finalize(e);
}

// 击杀结算：先发事件（监听者还能从 list 里查到它），再移除
function finalize(e) {
  const m = e._m;
  if (!m.killEmitted) {
    m.killEmitted = true;
    BR.bus.emit('entity:kill', { killer: m.killer, victim: e.id, killerType: m.killerType, victimType: e.type });
  }
  detach(e);
}

// ---------- 生成 / 移除 ----------
let placeholderGeo = null, placeholderMat = null;
function placeholder(e) {
  if (typeof THREE === 'undefined') return null;
  if (!placeholderGeo) {
    placeholderGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    placeholderMat = new THREE.MeshLambertMaterial({ color: 0xff00ff });
  }
  const mesh = new THREE.Mesh(placeholderGeo, placeholderMat);
  mesh.scale.set(e.r * 2, e.h, e.r * 2);
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function buildModel(def, e) {
  let obj = null;
  if (typeof THREE !== 'undefined') {
    try {
      obj = def.build({ THREE, BR, assets: BR.assets, game: BR.game, scene: sceneOf(), def, entity: e });
    } catch (err) {
      once('build:' + def.type, () => console.error('[entities] ' + def.type + '.build 出错，用品红占位方块', err));
    }
    if (!obj || !obj.isObject3D) obj = placeholder(e);
  }
  if (obj) {
    if (!obj.name) obj.name = 'entity ' + def.type;
    obj.rotation.order = 'YXZ';   // 先 yaw；实体自己在根节点上加的俯仰/侧倾按本地轴转
    obj.userData.entityId = e.id;
  }
  return obj;
}

function syncObj(e) {
  const o = e.obj;
  if (!o) return;
  o.position.set(e.x, e.y, e.z);
  o.rotation.y = e.yaw;
}

function disposeOwned(root) {
  root.traverse(o => {
    if (o.geometry && o.geometry.userData && o.geometry.userData.entityOwned) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m.userData && m.userData.entityOwned) m.dispose();
  });
}

function compact() {
  let j = 0;
  for (let i = 0; i < ents.length; i++) if (!ents[i].removed) ents[j++] = ents[i];
  ents.length = j;
  dirty = false;
}
function batch(fn) {
  const was = iterating;
  iterating = true;
  try { fn(); } finally {
    iterating = was;
    if (!was && dirty) compact();
  }
}

// 从场景和列表里拿掉，不发事件
function detach(e) {
  if (!e || e.removed) return;
  e.removed = true;
  e.dead = true;
  e.target = null;
  if (e.obj) {
    if (e.obj.parent) e.obj.parent.remove(e.obj);
    disposeOwned(e.obj);
  }
  if (has(e.def, 'dispose')) safeCall(e.def, 'dispose', e);
  if (byId.get(e.id) === e) byId.delete(e.id);
  if (iterating) dirty = true; else compact();
}
// 清场用：正在倒地的尸体已经算死了，补发击杀事件；活着的只是被清掉，不算击杀
function discard(e) {
  if (e.dead && !e.removed && e._m.removeAt != null) finalize(e);
  else detach(e);
}

function makeEntity(def, id, x, y, z, yaw) {
  const r = num(def.radius, 0.4) > 0 ? num(def.radius, 0.4) : 0.4;
  const h = num(def.height, 1.8) > 0 ? num(def.height, 1.8) : 1.8;
  const hp = Math.max(1, num(def.hp, 50));
  const e = {
    id, type: String(def.type), def,
    x, y, z, yaw: wrapAngle(yaw),
    hp, maxHp: hp,
    state: 'idle', target: null, cooldown: 0,
    obj: null, data: {},
    r, h,
    chunkKey: null,
    manual: false,           // 手动放出（测试面板等）：不随区块卸载
    remote: false,           // 联机客机按快照创建的
    dead: false, removed: false,
    hitAt: -1e9, spawnedAt: time,
    // 管理器私有状态，行为代码请用 data
    _m: {
      thinkAcc: aiRng() * FAR_INTERVAL,   // 错开远处实体的思考时刻
      scanAt: 0, seenAt: -1e9, seenCheckAt: 0, curSeen: false,
      detourT: 0, detourX: 0, detourZ: 0, side: 0, detourN: 0, detourEndAt: -1e9,
      wanderT: 0, wanderYaw: 0, pauseT: 0,
      provoker: null, provokeUntil: 0,
      idleT: rand(IDLE_MIN * 0.5, IDLE_MAX),
      attackAt: -1e9, removeAt: null, killer: null, killerType: null, killEmitted: false,
      snap: null,
    },
  };
  e.obj = buildModel(def, e);
  const scene = sceneOf();
  if (scene && e.obj) scene.add(e.obj);
  syncObj(e);
  ents.push(e);
  byId.set(id, e);
  return e;
}

// 原位被挡就一圈圈往外找。顺序是确定的、不耗 rng：区块生成的随机流不能被碰撞结果打乱。
// from（可选 {x,y,z}）：候选点必须和它互相可见，避免放到墙的另一侧
function freeSpot(x, y, z, r, h, from) {
  const P = BR.phys;
  if (!has(P, 'overlapCircle')) return { x, y, z };
  const ok = (px, py, pz) => {
    if (P.overlapCircle(px, pz, r, py, h)) return false;
    if (!from || !has(P, 'los')) return true;
    return P.los(from.x, num(from.y, py + h * 0.5), from.z, px, py + h * 0.5, pz);
  };
  if (ok(x, y, z)) return { x, y, z };
  const stepR = Math.max(SEARCH_STEP_MIN, r * 0.75);
  for (let ring = 1; ring * stepR <= SEARCH_MAX; ring++) {
    const d = ring * stepR;
    const n = Math.min(24, Math.max(8, Math.ceil(Math.PI * 2 * d / stepR)));
    for (let i = 0; i < n; i++) {
      const a = (i + ring * 0.5) / n * Math.PI * 2;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const py = groundAt(px, pz, y);
      if (Math.abs(py - y) > SEARCH_DY) continue;   // 不跨楼层找位置
      if (ok(px, py, pz)) return { x: px, y: py, z: pz };
    }
  }
  return null;
}

// opts: { id, chunkKey, yaw, from: {x,y,z}, force }
function spawn(type, x, y, z, opts) {
  const o = opts || {};
  const def = BR.entityTypes.get(type);
  if (!def) {
    once('type:' + type, () => console.warn('[entities] 实体类型未注册：', type));
    return null;
  }
  x = +x; z = +z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.warn('[entities] spawn 坐标无效', type, x, z);
    return null;
  }
  const fy = (y == null || !Number.isFinite(+y)) ? groundAt(x, z, 0) : +y;
  const r = num(def.radius, 0.4) > 0 ? num(def.radius, 0.4) : 0.4;
  const h = num(def.height, 1.8) > 0 ? num(def.height, 1.8) : 1.8;
  const spot = o.force ? { x, y: fy, z } : freeSpot(x, fy, z, r, h, o.from);
  if (!spot) {
    // 区块生成的失败由 spawnForChunk 汇总打印，这里只报手动放置的
    if (o.chunkKey == null) console.info('[entities] 附近 ' + SEARCH_MAX + ' m 内没有空位，未生成', type, x.toFixed(1), z.toFixed(1));
    return null;
  }
  let id = o.id != null ? String(o.id) : U.uid('e');
  if (byId.has(id)) {
    console.warn('[entities] id 重复，改用新 id：', id);
    id = U.uid('e');
  }
  const yaw = Number.isFinite(+o.yaw) && o.yaw !== null ? +o.yaw : aiRng() * Math.PI * 2 - Math.PI;
  const e = makeEntity(def, id, spot.x, spot.y, spot.z, yaw);
  e.chunkKey = o.chunkKey != null ? String(o.chunkKey) : null;
  e.manual = e.chunkKey === null;
  if (has(def, 'init')) safeCall(def, 'init', e, api);
  return e;
}

function activeCount() {
  let n = 0;
  for (let i = 0; i < ents.length; i++) if (!ents[i].dead) n++;
  return n;
}

// 第 5 节公式。rng = BR.util.rng(levelSeed, cx, cz, 'entities')，只在这里消耗
function spawnForChunk(level, chunkKey, spawnPoints, rng) {
  const out = [];
  const table = level && Array.isArray(level.entities) ? level.entities : [];
  const pts = Array.isArray(spawnPoints) ? spawnPoints : [];
  if (!table.length || !pts.length) return out;
  if (typeof rng !== 'function') rng = U.rng(BR.game.seed >>> 0, 'entities', String(chunkKey));
  let area = num(BR.world && BR.world.chunkArea, 0);
  if (!(area > 0)) { const s = num(level.chunkSize, 24); area = s * s; }
  const factor = Math.max(0, num(BR.game.spawnFactor, 0));
  const max = num(BR.config.world.maxActiveEntities, 28);
  const used = new Uint8Array(pts.length);
  let active = activeCount();
  let dropped = 0, noRoom = 0;

  for (const entry of table) {
    if (!entry || !entry.type) continue;
    const count = BR.stochasticRound(BR.expectedEntityCount(num(entry.officialPer1000m2, 0), area, factor), rng);
    if (count <= 0) continue;
    const def = BR.entityTypes.get(entry.type);
    if (!def) {
      once('type:' + entry.type, () => console.warn('[entities] 层级实体表里的类型未注册，跳过：', entry.type));
      continue;
    }
    // 标了 safe 的出生点（安全屋、出生点附近）不放有害实体
    const hostile = def.faction === 'hostile';
    const idx = [];
    for (let i = 0; i < pts.length; i++) if (pts[i] && !(hostile && pts[i].safe === true)) idx.push(i);

    for (let k = 0; k < count; k++) {
      // 每只固定消耗两次随机数，上限截断与否不影响后面实体的位置
      const pick = rng(), yawR = rng();
      if (active >= max) { dropped++; continue; }
      if (!idx.length) { noRoom++; continue; }
      let j = Math.floor(pick * idx.length);
      for (let tries = 0; tries < idx.length && used[idx[j]]; tries++) j = (j + 1) % idx.length;   // 优先没用过的点
      const pi = idx[j];
      used[pi] = 1;
      const p = pts[pi];
      const e = spawn(def.type, p.x, p.y, p.z, { chunkKey, yaw: yawR * Math.PI * 2 - Math.PI });
      if (e) { out.push(e); active++; } else noRoom++;
    }
  }
  if (dropped > 0) console.info('[entities] 活跃实体已达上限 ' + max + '，区块 ' + chunkKey + ' 丢弃 ' + dropped + ' 个');
  if (noRoom > 0) console.info('[entities] 区块 ' + chunkKey + ' 有 ' + noRoom + ' 个实体找不到落脚点，未生成');
  return out;
}

function removeChunk(chunkKey) {
  const key = String(chunkKey);
  const keep2 = KEEP_NEAR * KEEP_NEAR;
  batch(() => {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed || e.manual || e.remote || e.chunkKey !== key) continue;
      if (nearestPlayerD2(e.x, e.z) > keep2) { discard(e); continue; }
      // 离玩家近：留下，改挂到它现在脚下的区块，之后随那块一起卸载；
      // 脚下恰好也是这块（极少见）就变成无主实体，由 update 里的无主清理在走远后移除
      const nk = has(BR.world, 'chunkKeyAt') ? String(BR.world.chunkKeyAt(e.x, e.z)) : null;
      e.chunkKey = nk !== key ? nk : null;
    }
  });
}

// 原地重生防秒杀：清掉半径内的有害、中立实体和测试人。
// 友善实体保留 —— 它们从不攻击玩家，还会替刚复活的玩家挡住随后刷过来的有害实体，清掉反而让重生点更危险
function clearRadius(x, z, r) {
  const r2 = num(r, 0) * num(r, 0);
  let n = 0;
  batch(() => {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed || e.def.faction === 'friendly') continue;
      if (U.dist2(x, z, e.x, e.z) <= r2) { discard(e); n++; }
    }
  });
  return n;
}

// 清场（换层、回主页、测试面板清除全部）不是击杀，不发 entity:kill
function clear() {
  batch(() => { for (let i = 0; i < ents.length; i++) detach(ents[i]); });
  ents.length = 0;
  byId.clear();
  aiRng = U.mulberry32(U.hashInts(BR.game.seed >>> 0, 'ai'));
}

function removeEntity(e) {
  if (typeof e === 'string') e = byId.get(e);
  if (e) detach(e);
}

// ---------- 每帧 ----------
function runAI(dt) {
  const far2 = THINK_FAR * THINK_FAR;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed) continue;
    const m = e._m;
    if (e.dead) {
      if (m.removeAt != null && time >= m.removeAt) finalize(e);
      continue;
    }
    let step = dt;
    const d2 = nearestPlayerD2(e.x, e.z);
    if (d2 !== Infinity && d2 > far2) {
      m.thinkAcc += dt;
      if (m.thinkAcc < FAR_INTERVAL) continue;
      step = Math.min(m.thinkAcc, FAR_INTERVAL * 2);
      m.thinkAcc = 0;
    }
    e.cooldown = Math.max(0, e.cooldown - step);
    curDt = step;
    api.dt = step;
    const px = e.x, py = e.y, pz = e.z;
    try { e.def.think(e, step, api); }
    catch (err) { once('think:' + e.type, () => console.error('[entities] ' + e.type + '.think 出错', err)); }
    if (!Number.isFinite(e.x) || !Number.isFinite(e.z) || !Number.isFinite(e.y) || !Number.isFinite(e.yaw)) {
      once('nan:' + e.type, () => console.warn('[entities] ' + e.type + ' 坐标变成 NaN，已回退'));
      e.x = px; e.y = py; e.z = pz; e.yaw = Number.isFinite(e.yaw) ? e.yaw : 0;
    }
  }
  separate();
  curDt = dt;
  api.dt = dt;
}

// 实体之间的软分离：phys 只管墙，不管实体互相穿插；友善和有害扭打在一起时不叠成一团
function separate() {
  const n = ents.length;
  for (let i = 0; i < n; i++) {
    const a = ents[i];
    if (a.dead) continue;
    for (let j = i + 1; j < n; j++) {
      const b = ents[j];
      if (b.dead || Math.abs(a.y - b.y) > FLOOR_DY) continue;
      const dx = b.x - a.x, dz = b.z - a.z, min = a.r + b.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2), nx, nz;
      if (d < 1e-4) { const ang = (i * 2.399 + j) % (Math.PI * 2); nx = Math.cos(ang); nz = Math.sin(ang); d = 0; }
      else { nx = dx / d; nz = dz / d; }
      // 固定实体（窗户、墙上的陷阱）不能被挤走：只推另一方，并且推满全程；两边都固定就互不相推
      const aFix = a.fixed === true || a.def.fixed === true, bFix = b.fixed === true || b.def.fixed === true;
      if (aFix && bFix) continue;
      const push = (min - d) * SEP_STIFF * (aFix || bFix ? 1 : 0.5);
      if (!aFix) moveBy(a, -nx * push, -nz * push);
      if (!bFix) moveBy(b, nx * push, nz * push);
    }
  }
}

function sweepOrphans(dt) {
  orphanT -= dt;
  if (orphanT > 0) return;
  orphanT = ORPHAN_SWEEP_SEC;
  const far2 = (KEEP_NEAR * 2) * (KEEP_NEAR * 2);
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed || e.manual || e.remote || e.chunkKey !== null) continue;
    if (nearestPlayerD2(e.x, e.z) > far2) discard(e);
  }
}

function runInterp(dt) {
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const s = e._m.snap;
    if (e.removed || !s) continue;
    s.t = Math.min(SNAP_SEC, s.t + dt);
    const k = s.t / SNAP_SEC;
    e.x = U.lerp(s.x0, s.x1, k);
    e.z = U.lerp(s.z0, s.z1, k);
    e.yaw = wrapAngle(s.yaw0 + U.angleDiff(s.yaw0, s.yaw1) * k);
    e.y = groundAt(e.x, e.z, e.y);
  }
}

function idleSound(e, dt) {
  const snd = e.def.sounds;
  if (e.dead || !snd || !snd.idle) return;
  const m = e._m;
  m.idleT -= dt;
  if (m.idleT > 0) return;
  m.idleT = rand(IDLE_MIN, IDLE_MAX);
  if (nearestPlayerD2(e.x, e.z) <= IDLE_HEAR * IDLE_HEAR) sound(e, snd.idle);
}

function update(dt) {
  if (!(dt > 0)) return;
  dt = Math.min(dt, MAX_DT);
  time += dt;
  api.time = time;
  curDt = dt;
  api.dt = dt;
  batch(() => {
    if (isAuthoritative()) { runAI(dt); sweepOrphans(dt); }
    else runInterp(dt);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed) continue;
      idleSound(e, dt);
      if (has(e.def, 'animate')) safeCall(e.def, 'animate', e, dt, api);
      syncObj(e);
    }
  });
}

// ---------- 联机快照（第 9、12 节） ----------
const r2d = v => Math.round(v * 100) / 100;

function snapshot() {
  const out = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed) continue;
    // hp 向上取整：还活着的实体不会被客机显示成 0 血
    out.push([e.id, e.type, r2d(e.x), r2d(e.z), r2d(e.yaw), String(e.state || 'idle'), Math.max(0, Math.ceil(e.hp))]);
  }
  return out;
}

// 客机：没见过的 id 建模型，见过的从当前显示位置插值到新位置，列表里没有的移除（不发击杀事件，房主那边发过了）
function applySnapshot(list) {
  if (!Array.isArray(list)) return;
  const seen = new Set();
  batch(() => {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!Array.isArray(row) || row.length < 5) continue;
      const id = String(row[0]), type = String(row[1]);
      const x = +row[2], z = +row[3], yaw = num(row[4], 0);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const state = row[5] != null ? String(row[5]) : 'idle';
      const hp = num(row[6], NaN);
      seen.add(id);
      let e = byId.get(id);
      if (e && e.type !== type) { detach(e); e = null; }
      if (!e) {
        const def = BR.entityTypes.get(type);
        if (!def) {
          once('type:' + type, () => console.warn('[entities] 快照里的实体类型本机未注册：', type));
          continue;
        }
        e = makeEntity(def, id, x, groundAt(x, z, 0), z, yaw);
        e.remote = true;
        e._m.snap = { x0: x, z0: z, yaw0: e.yaw, x1: x, z1: z, yaw1: e.yaw, t: SNAP_SEC };
      } else {
        const s = e._m.snap || (e._m.snap = {});
        s.x0 = e.x; s.z0 = e.z; s.yaw0 = e.yaw;
        s.x1 = x; s.z1 = z; s.yaw1 = wrapAngle(yaw);
        s.t = 0;
      }
      if (Number.isFinite(hp)) {
        if (hp < e.hp) e.hitAt = time;   // 客机没有伤害事件，靠血量下降触发挨打表现
        e.hp = hp;
      }
      if (state !== e.state) {
        if (state === 'dead' && !e.dead) { e.dead = true; sound(e, 'hit'); }
        else if (state === 'attack' && e.def.sounds && e.def.sounds.attack) sound(e, e.def.sounds.attack);
        e.state = state;
      }
    }
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.removed && !seen.has(e.id)) detach(e);
    }
  });
}

function debugInfo() {
  const byFaction = {};
  let far = 0;
  for (const e of ents) {
    if (e.removed) continue;
    const f = e.def.faction;
    byFaction[f] = (byFaction[f] || 0) + 1;
    const d2 = nearestPlayerD2(e.x, e.z);
    if (d2 !== Infinity && d2 > THINK_FAR * THINK_FAR) far++;
  }
  return { total: ents.length, active: activeCount(), byFaction, farThinking: far, authoritative: isAuthoritative(), time };
}

// ---------- 给 think 用的 api（全体实体共用一个对象，time/dt 每次调用前刷新） ----------
const api = {
  time: 0, dt: 0,
  rng: () => aiRng(),
  get game() { return BR.game; },
  findTarget, los, moveToward, wander, flee, attack, lightAt, playerNoise,
  // 第 6 节之外的附加帮助
  faceToward,
  canAttack(e, target) { const t = resolveTarget(target); return !!t && canAttack(e, t.kind, t.ref); },
  damage: damageEntity,
  get player() { return BR.player; },
  get list() { return ents; },
};

// 回主页时实体必须清干净：不依赖 main / world 记得调 clear
BR.bus.on('game:home', clear);

BR.entities = {
  spawn,
  spawnForChunk,
  removeChunk,
  update,
  clearRadius,
  clear,
  get list() { return ents; },
  get authoritative() { return isAuthoritative(); },
  set authoritative(v) { authOverride = v === null || v === undefined ? null : !!v; },
  snapshot,
  applySnapshot,
  // 附加能力
  get: id => byId.get(String(id)) || null,
  remove: removeEntity,          // 直接移除，不发击杀事件
  damage: damageEntity,          // (e | id, amount, source)；source 为实体、'player' 或 null
  kill,                          // (e | id, killer?)
  count: activeCount,
  canAttack: api.canAttack,
  api,
  debugInfo,
};
})();
