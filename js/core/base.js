// 后室 · 核心：命名空间、随机数、事件总线、常量、模式规则、注册表
// 经典 <script>，只往 window.BR 上挂东西。接口说明见 ARCHITECTURE.md
(function () {
'use strict';
const BR = window.BR = window.BR || {};

// ---------- 可复现随机数 ----------
// 联机双方拿同一个种子，区块生成结果必须逐字节一致，所以绝不能用 Math.random 生成世界
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hashInts() {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    const n = typeof v === 'string' ? hashStr(v) : (v | 0);
    h ^= n; h = Math.imul(h, 16777619); h ^= h >>> 13;
  }
  return h >>> 0;
}

BR.util = {
  mulberry32, hashStr, hashInts,
  // rng('0', cx, cz) —— 任意个字符串/整数混合做种子
  rng() { return mulberry32(hashInts.apply(null, arguments)); },
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t,
  // 与帧率无关的指数趋近
  damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),
  smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
  randRange: (rng, a, b) => a + (b - a) * rng(),
  randInt: (rng, a, b) => a + Math.floor(rng() * (b - a + 1)),
  pick: (rng, arr) => arr[Math.floor(rng() * arr.length)],
  // entries: [[value, weight], ...]
  weighted(rng, entries) {
    let sum = 0;
    for (const e of entries) sum += e[1];
    let r = rng() * sum;
    for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  },
  dist2: (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },
  angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
  uid: (() => { let n = 0; return (p) => (p || 'e') + (++n).toString(36); })(),
};

// ---------- 事件总线 ----------
const listeners = new Map();
BR.bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  },
  off(name, fn) { if (listeners.has(name)) listeners.get(name).delete(fn); },
  emit(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error('[bus]', name, err); }
    }
  },
};

// ---------- 常量 ----------
BR.config = {
  version: '0.1.0',
  roomApi: 'https://api.ovobot.ai/room.php',   // 复用火箭发射的 2 人联机信令
  player: { eyeHeight: 1.62, radius: 0.3, height: 1.8, walk: 3.0, sprint: 5.2, maxHp: 100 },
  stats: {
    hungerDrainPerSec: 100 / (14 * 60),        // 正常走动 14 分钟饿空
    sprintHungerMul: 1.8,
    sanityDrainPerSec: 100 / (20 * 60),        // 基础 20 分钟掉空，层级 env.sanityDrainMul 再乘
    lowHunger: 20,
  },
  world: { loadRadius: 2, maxActiveEntities: 28, maxDynamicLights: 6 },
  death: { clearRadius: 30 },                  // 原地重生时清掉这个半径内的实体
  // 调研里的密度描述 → "正常后室"每 1000 m² 的实体数
  densityWords: { none: 0, rare: 0.04, low: 0.12, moderate: 0.35, high: 0.9, extreme: 2.2 },
};

// ---------- 层级顺序 ----------
BR.LEVEL_ORDER = ['0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','fun','run'];

// ---------- 模式规则（用户定死的数值） ----------
BR.MODES = {
  casual: {
    key: 'casual', zh: '游玩',
    attackPlayers: false,       // 实体不攻击玩家，但友善/有害实体仍互相作战
    statsEnabled: false,        // 没有饥饿和 san
    coop: true,
    autoSpawn: true,
    maxSpawnFactor: 0.5,        // 生成量拉满 = 正常后室的一半
  },
  test: {
    key: 'test', zh: '测试模式',
    attackPlayers: false,       // 和游玩一样实体不打玩家，但会打测试人
    statsEnabled: false,
    coop: false,
    autoSpawn: false,           // 不自动生成实体，靠测试面板手动放出
  },
  nightmare: {
    key: 'nightmare', zh: '噩梦生存',
    attackPlayers: true,
    statsEnabled: true,
    coop: false,
    autoSpawn: true,
    difficulties: [
      // 用户 2026-09-13 调整：简单/中等/困难/地狱 = 正常后室实体数量的 0% / 20% / 40% / 60%（原为 20/40/60/90）
      { key: 'easy',   zh: '简单', spawnFactor: 0 },
      { key: 'medium', zh: '中等', spawnFactor: 0.2 },
      { key: 'hard',   zh: '困难', spawnFactor: 0.4 },
      { key: 'hell',   zh: '地狱', spawnFactor: 0.6 },
    ],
  },
};

// 阵营：hostile 有害 / friendly 友善 / neutral 中立 / dummy 测试人（只挨打，不还手）
BR.FACTIONS = ['hostile', 'friendly', 'neutral', 'dummy'];

// 制服颜色，顺序照用户原话；只换防化服那一块，防毒面具、靴子、手套、胶带都不变
BR.SKINS = [
  { key: 'pink',   zh: '粉色', color: 0xe58bb4 },
  { key: 'blue',   zh: '蓝色', color: 0x3d7ad6 },
  { key: 'yellow', zh: '黄色', color: 0xd8b21f },
  { key: 'purple', zh: '紫色', color: 0x8b5ccc },
  { key: 'green',  zh: '绿色', color: 0x4ea65a },
  { key: 'red',    zh: '红色', color: 0xc83e37 },
];
BR.DEFAULT_SKIN = 'yellow';

BR.computeSpawnFactor = function (mode, difficulty, spawnSlider) {
  if (mode === 'test') return 0;
  if (mode === 'casual') return BR.util.clamp(spawnSlider, 0, 1) * BR.MODES.casual.maxSpawnFactor;
  const d = BR.MODES.nightmare.difficulties.find(x => x.key === difficulty);
  if (!d) throw new Error('未知难度 ' + difficulty);
  return d.spawnFactor;
};

// 饥饿 < 20% 移速减半；饥饿为 0 时移速为原来的 1/3
BR.speedMulFromHunger = h => h <= 0 ? 1 / 3 : h < BR.config.stats.lowHunger ? 0.5 : 1;

// 某块面积上某实体应有的数量期望值；factor = 相对"正常后室"的比例
BR.expectedEntityCount = (officialPer1000m2, areaM2, factor) => officialPer1000m2 * areaM2 / 1000 * factor;
// 期望值 2.3 → 70% 概率 2、30% 概率 3，保证大量区块统计下总数正好等于期望
BR.stochasticRound = (x, rng) => { const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); };

// ---------- 全局状态 ----------
BR.game = {
  screen: 'home',
  mode: 'casual',
  difficulty: null,
  settings: { visibility: 0.7, spawnSlider: 1, startLevel: '0', quality: 'high' },
  spawnFactor: 0.5,
  attackPlayers: false,
  statsEnabled: false,
  autoSpawn: true,
  skin: 'yellow',
  seed: 0,
  levelId: '0',
  time: 0,
  deepest: '0',
  deaths: 0,
  coop: { active: false, role: null },
};

// ---------- 注册表 ----------
function registry(kind, keyField, required) {
  const map = new Map();
  return {
    register(def) {
      for (const k of required) {
        if (def[k] === undefined) throw new Error(`${kind} "${def[keyField]}" 缺少字段 ${k}`);
      }
      map.set(String(def[keyField]), def);
      return def;
    },
    get: id => map.get(String(id)),
    has: id => map.has(String(id)),
    all: () => [...map.values()],
  };
}
BR.levels      = registry('level',  'id',   ['id', 'name', 'version', 'env', 'spawn', 'buildChunk', 'entities', 'items', 'exits']);
BR.entityTypes = registry('entity', 'type', ['type', 'zh', 'version', 'faction', 'build', 'think']);
BR.itemTypes   = registry('item',   'type', ['type', 'zh', 'category', 'build', 'use']);
})();
