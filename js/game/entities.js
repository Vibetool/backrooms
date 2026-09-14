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
//   human: true                       "人类目标"（目前只有测试人）：感染类攻击只对人类和玩家生效，见 isHuman
//   infection: spec                   这只实体携带的感染规格（onAttack 里 api.infect 用的同一份）；spec.sparesInfected 为真时
//                                     它不再攻击已带同一 key 感染的实体（只管实体目标，玩家照常），见 sparesInfected
// 感染与转化（ENGINE_PLAN M4 的子集，2026-09-14 先给悲尸用）：infect(target, spec, source?) / transform(target, toType)。
//   e.infection 是只读的症状状态 { key, toType, stage, stageAt, since, elapsed, riseAt }，animate 按它画症状；
//   计时、转化只在房主跑，客机只从快照拿"感染了没有 + 第几阶段"
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
  // 感染源放过已经带着同一种感染的实体（spec.sparesInfected，见 sparesInfected）。放在阵营判断前面：
  // findTarget 扫候选、保留旧目标、attack 出手都走这里，一处拦住就不会出现"盯着不打、别的目标也不看"
  if (ref.infection && sparesInfected(a, ref.infection)) return false;
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
  e._m.diedAt = time;
  sound(e, 'hit');
  const hold = has(e.def, 'onDeath') ? num(safeCall(e.def, 'onDeath', e, api), 0) : 0;
  // 感染中被打死：不按普通流程移除，尸体留在原地 deathRiseSec 秒后爬起来变成 toType。
  // onDeath 照常调用（它可能有音效等副作用），只是它给的保留时长让位给这里
  const inf = e.infection;
  if (inf && inf.spec && inf.spec.deathRiseSec > 0) {
    inf.riseAt = time + inf.spec.deathRiseSec;
    e._m.removeAt = null;
    return;
  }
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
// 清场用：正在倒地的尸体（包括等着爬起来的感染尸体）已经算死了，补发击杀事件；活着的只是被清掉，不算击杀
function discard(e) {
  const rising = !!(e.infection && e.infection.riseAt != null);
  if (e.dead && !e.removed && (e._m.removeAt != null || rising)) finalize(e);
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
    infection: null,         // 感染症状状态（只读），见文件头与 infect()
    // 管理器私有状态，行为代码请用 data
    _m: {
      diedAt: null,
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
    // 工坊 densityMul：未激活时恒为 1，字节不变；编辑态或 autoEntities=false 时为 0（不刷层级自带实体）
    const wsMul = BR.workshop && typeof BR.workshop.densityMul === 'function' ? BR.workshop.densityMul('entities', entry.type) : 1;
    const count = BR.stochasticRound(BR.expectedEntityCount(num(entry.officialPer1000m2, 0), area, factor) * wsMul, rng);
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

// ---------- 感染与转化（ENGINE_PLAN M4 的子集） ----------
// 规格 spec 由实体文件声明，本文件不认识任何具体实体；联机只同步"是否感染 + 阶段号"，函数和数值不进快照（M4 同一原则）。
//   { key, toType, stages: [{ at, ...玩家侧字段 }], transformAt, deathRiseSec, cause?, cureToast? }
//   stages[i].at：感染后第几秒进入该阶段，第一个必须是 0；阶段里的 toast / cureTags / visual 等只有玩家侧（BR.effects）读
//   transformAt：到这一秒还没好就转化；deathRiseSec：感染中被打死后尸体几秒爬起来（0 = 按普通死亡处理）
// M4 做通用 addEffect 时，这里的 e.infection 会并进 e._fx，infect 变成 applyEffect 的一个预设
const SNAP_INFECTED = 1 << 3;   // 快照 flags 位：沿用 M4 草案位表的 bit3 infected，M4 加其他位时不用改这一位
const specCache = new WeakMap();

// 规格按对象缓存：悲尸每挠一下都会传同一个 spec，不重复校验和拷贝
function normInfection(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (specCache.has(spec)) return specCache.get(spec);
  const key = spec.key != null ? String(spec.key) : '';
  const toType = spec.toType != null ? String(spec.toType) : '';
  const stages = (Array.isArray(spec.stages) ? spec.stages : [])
    .filter(s => s && Number.isFinite(+s.at) && +s.at >= 0)
    .map(s => Object.assign({}, s, { at: +s.at }))
    .sort((a, b) => a.at - b.at);
  const transformAt = num(spec.transformAt, NaN);
  let n = null;
  if (!key || !toType || !stages.length || stages[0].at !== 0 || !(transformAt > stages[stages.length - 1].at)) {
    once('infspec:' + key, () => console.warn('[entities] 感染规格无效：要有 key、toType、stages[0].at = 0、transformAt 大于最后一个阶段', spec));
  } else {
    n = {
      key, toType, stages, transformAt,
      deathRiseSec: Math.max(0, num(spec.deathRiseSec, 0)),
      sparesInfected: spec.sparesInfected === true,
      cause: spec.cause ? String(spec.cause) : null,
      cureToast: spec.cureToast ? String(spec.cureToast) : null,
    };
  }
  specCache.set(spec, n);
  return n;
}

// 感染源放过"同类"：攻击方 def.infection 声明了规格且 sparesInfected 为真，目标实体已经带着同一 key 的感染，就不再当目标。
// 为什么要有：测试人不会跑也不会还手，感染源要是接着打，它挨两下就死，自然流程里永远看不到后面几个阶段和原地转化。
// 只管实体目标，玩家不走这里（canAttack 的 player 分支在前面）：噩梦里实体照常追杀人类是用户定死的模式规则。
// 快照建出来的感染记录 key 是 null（客机），客机本来也不跑 AI，这里不会误判
function sparesInfected(a, inf) {
  const spec = a.def && a.def.infection;
  if (!spec || inf.key == null) return false;
  const s = normInfection(spec);
  return !!s && s.sparesInfected && s.key === inf.key;
}

// "人类目标"：本机玩家，或 def.human === true 的实体（目前只有测试人）
function isHuman(target) {
  if (typeof target === 'string') target = byId.get(target);
  const t = resolveTarget(target);
  return !!t && (t.kind === 'player' || !!(t.ref.def && t.ref.def.human === true));
}

// 统一入口：目标是本机玩家走 BR.effects（玩家状态效果），是实体走实体侧计时。返回是否新感染上了
function infect(target, spec, source) {
  if (typeof target === 'string') target = byId.get(target);
  const t = resolveTarget(target);
  const s = normInfection(spec);
  if (!t || !s) return false;
  const src = source !== undefined ? source : spec.source;
  return t.kind === 'player' ? infectPlayer(t.ref, s, src) : infectEntity(t.ref, s, src);
}

function infectEntity(e, s, source) {
  // 转化要生成、移除实体，只能房主做；客机上的感染状态只从快照来
  if (!isAuthoritative() || !e || e.removed) return false;
  // 已感染：再被划伤不重置计时。没有 spec 的记录是当客机时从快照建的，房主已经不在了（客机回单机），
  // 没有时间线可接着走，允许重新感染覆盖掉，不然它会永远挂着症状、既不转化也感染不上
  if (e.infection && e.infection.spec) return false;
  if (e.type === s.toType) return false;      // 本来就是转化结果（悲尸不会被悲尸感染）
  if (!BR.entityTypes.has(s.toType)) {
    once('inftype:' + s.toType, () => console.warn('[entities] 感染的转化类型未注册：', s.toType));
    return false;
  }
  let riseAt = null;
  if (e.dead) {
    // 致命的那一下也是一次划伤：只认这一刻刚被打死的尸体（onAttack 紧跟在命中之后调用），
    // 早就倒在地上的尸体不会因为被补一刀就爬起来
    if (e._m.diedAt !== time || !(s.deathRiseSec > 0)) return false;
    riseAt = time + s.deathRiseSec;
    e._m.removeAt = null;
  }
  const info = killerInfo(source);
  e.infection = { key: s.key, toType: s.toType, stage: 0, stageAt: time, since: time, elapsed: 0, riseAt, source: info[0], spec: s };
  BR.bus.emit('entity:infect', { id: e.id, type: e.type, key: s.key, toType: s.toType, source: info[0], sourceType: info[1] });
  return true;
}

// 玩家侧：和物品毒发同一套 BR.effects（阶段、提示、原地重生清负面）。
// 只作用于本机玩家——联机只开放游玩模式，那里实体不打任何玩家；房主的实体也从不以客机为目标（findTarget 只看本机玩家），
// 所以现在没有"实体伤到客机"的通道，也就没有要带感染信息的消息
function infectPlayer(p, s, source) {
  // 模式规则：只在实体会攻击玩家的模式（噩梦生存）生效；游玩/测试模式直接拒绝，哪怕有人绕过 attack 直接调
  if (p !== BR.player || !BR.game.attackPlayers || !playerAlive(p)) return false;
  const fx = BR.effects;
  if (!has(fx, 'add') || !has(fx, 'has')) return false;
  if (fx.has(s.key)) return false;            // 已感染：再被划伤不重置计时
  const toDef = BR.entityTypes.get(s.toType);
  const stages = s.stages.map((st, i) => {
    const end = i + 1 < s.stages.length ? s.stages[i + 1].at : s.transformAt;
    const out = Object.assign({}, st, { seconds: end - st.at });
    delete out.at;
    return out;
  });
  const info = killerInfo(source);
  return !!fx.add({
    key: s.key, stages,
    // 不打 'infection' 标签、不标 hostile：消毒剂按 infection 标签清、杏仁水按 hostile 清，
    // 都不看阶段——会让第三阶段也能治好，违背选中版本；是否能治只由阶段里的 cureTags 决定
    tags: [s.key], negative: true, hostile: false,
    cause: s.cause || ('你变成了' + ((toDef && toDef.zh) || s.toType)),
    onExpire: 'transform:' + s.toType,
    cureToast: s.cureToast,
    data: { source: info[0], sourceType: info[1] },
  });
}

// 房主每帧：推进阶段；活着的到点原地转化，感染尸体到点爬起来
function tickInfection(e, dt) {
  const inf = e.infection, s = inf.spec;
  // 没有 spec = 当客机时从快照建的，现在本机拿回了权威（客机回单机，房主已经不在）：没有时间线可以接着走，
  // 留着只会让它永远抽搐、永远不转化，所以清掉症状，之后可以被重新感染（本函数只在房主/单机的 runAI 里调用）
  if (!s) { e.infection = null; return; }
  if (e.dead) {
    if (inf.riseAt != null && time >= inf.riseAt) rise(e);
    return;
  }
  inf.elapsed += dt;
  let st = inf.stage;
  while (st + 1 < s.stages.length && inf.elapsed >= s.stages[st + 1].at) st++;
  if (st !== inf.stage) { inf.stage = st; inf.stageAt = time; }
  if (inf.elapsed >= s.transformAt) transform(e, s.toType, { key: s.key, cause: 'infection' });
}

function rise(e) {
  const inf = e.infection;
  inf.riseAt = null;
  // 尸体爬起来是净增一只活跃实体：计入 maxActiveEntities，满了就按普通尸体结算，防止转化链刷怪风暴（M4 风险项）。
  // 活着的目标原地转化是一换一，数量不变，不受这条限制
  const max = num(BR.config.world.maxActiveEntities, 28);
  if (activeCount() >= max) {
    console.info('[entities] 活跃实体已达上限 ' + max + '，' + e.type + ' 的尸体没有爬起来');
    finalize(e);
    return;
  }
  transform(e, inf.toType, { key: inf.key, cause: 'rise' });
}

// 原地把目标换成另一种实体（M4 草案的 api.transform）：同位置、同朝向，继承区块归属和 manual 标记
// （测试面板放出的目标转化出的新实体也不被区块卸载/无主清理带走）。先生成，成功了才移除原目标。
// 活着的目标被换掉不算击杀（不发 entity:kill）；倒地的尸体按击杀结算（补发 entity:kill）。只在房主执行，客机靠快照看到一删一增
function transform(target, toType, opts) {
  const o = opts || {};
  if (typeof target === 'string') target = byId.get(target);
  const e = target && target.def && !target.removed ? target : null;
  if (!e || !isAuthoritative()) return null;
  const type = String(toType || '');
  if (!BR.entityTypes.has(type)) {
    once('inftype:' + type, () => console.warn('[entities] transform 的目标类型未注册：', type));
    return null;
  }
  const sp = { yaw: e.yaw, chunkKey: e.chunkKey };
  let ne = spawn(type, e.x, e.y, e.z, sp);
  if (!ne) { sp.force = true; ne = spawn(type, e.x, e.y, e.z, sp); }   // 原地被墙蹭到也要换，不能让目标就这么不转化
  if (!ne) return null;
  ne.chunkKey = e.chunkKey;
  ne.manual = e.manual;
  const from = e.id, fromType = e.type;
  if (e.dead) finalize(e); else detach(e);
  BR.bus.emit('entity:transform', { from, to: ne.id, fromType, toType: type, x: ne.x, z: ne.z, key: o.key || null, cause: o.cause || null });
  return ne;
}

// ---------- 每帧 ----------
function runAI(dt) {
  const far2 = THINK_FAR * THINK_FAR;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed) continue;
    // 感染计时按真实帧时间走，排在远处降频之前：离玩家远的测试人也要按时转化，不能因为没人看着就停表
    if (e.infection) { tickInfection(e, dt); if (e.removed) continue; }
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

// 行格式 [id, type, x, z, yaw, state, hp, y?, flags?, infStage?]：前 7 列和旧版一模一样，新增的只追加在尾部。
//   第 8 列 y：M4 快照 v2 预留（离地高度），本版不写，占位 null；第 9 列 flags：位表同 M4 草案，bit3 = 感染中；
//   第 10 列：感染阶段号（0 起）。没感染的行不追加，仍是 7 列。旧客机只读前 7 列，新客机收到 7 列就当没感染
function snapshot() {
  const out = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.removed) continue;
    // hp 向上取整：还活着的实体不会被客机显示成 0 血
    const row = [e.id, e.type, r2d(e.x), r2d(e.z), r2d(e.yaw), String(e.state || 'idle'), Math.max(0, Math.ceil(e.hp))];
    if (e.infection) row.push(null, SNAP_INFECTED, e.infection.stage | 0);
    out.push(row);
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
      // 感染症状：只拿"感染了没有 + 第几阶段"，阶段开始时刻按本机收到的时间记（症状渐变是纯表现，差一个快照周期无所谓）
      if (num(row[8], 0) & SNAP_INFECTED) {
        const st = Math.max(0, num(row[9], 0) | 0);
        const inf = e.infection || (e.infection = { key: null, toType: null, stage: -1, stageAt: time, since: time, elapsed: 0, riseAt: null, source: null, spec: null });
        if (inf.stage !== st) { inf.stage = st; inf.stageAt = time; }
      } else if (e.infection) {
        e.infection = null;
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
  let far = 0, infected = 0;
  for (const e of ents) {
    if (e.removed) continue;
    const f = e.def.faction;
    byFaction[f] = (byFaction[f] || 0) + 1;
    if (e.infection) infected++;
    const d2 = nearestPlayerD2(e.x, e.z);
    if (d2 !== Infinity && d2 > THINK_FAR * THINK_FAR) far++;
  }
  return { total: ents.length, active: activeCount(), byFaction, farThinking: far, infected, authoritative: isAuthoritative(), time };
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
  // 感染与转化：onAttack(e, t, api) 里 api.isHuman(t) && api.infect(t, SPEC, e)
  infect, transform, isHuman,
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
  infect,                        // (target, spec, source?) → bool：新感染上才返回 true；目标是本机玩家时走 BR.effects
  transform,                     // (e | id, toType, { key, cause }?) → 新实体 | null；仅房主
  isHuman,                       // (target) → bool：本机玩家或 def.human === true
  SNAP_FLAGS: { infected: SNAP_INFECTED },
  api,
  debugInfo,
};
})();
