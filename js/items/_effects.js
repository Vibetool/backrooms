// 后室 · 物品时效效果 BR.effects：加速/减速、每秒回血掉血、分阶段毒发、画面效果、场景里的短命特效
// 物品文件用的接口：
//   add({ key, seconds, speedMul, hpPerSec, sanityPerSec, hungerPerSec, visual,
//         stages, tags, cause, negative, hostile, lethalAtEnd, onEnd })
//     · 同 key 再 add 是刷新（替换旧的），不叠加
//     · stages: [{ seconds, speedMul, hpPerSec, sanityPerSec, hungerPerSec, visual, toast }]，按顺序走完才算结束
//     · visual: { flash: CSS 颜色, peak, flashSec, pulse: 每隔几秒再闪一次, distort: 0..1 画面扭曲,
//                 flatten: 0..1 画面压扁, alert: 0..1 额外能见度 }
//     · negative 不写时自动判断：减速或任一每秒数值为负就算负面；原地重生时负面效果被清掉
//     · hostile: true 表示"敌对实体造成的效果"（杏仁水能抵消）；tags 给别的物品按标记清除（如 'infection'）
//     · lethalAtEnd：走完最后一阶段仍活着就致死（噩梦模式才生效），cause 是结算界面的死因
//     · onExpire: 'death' | 'transform:<type>'（ENGINE_PLAN M4 的字段名）：'death' 同 lethalAtEnd；'transform:<type>'
//       对玩家也是致死、死因取 cause（如"你变成了悲尸"），不在原地生成实体（用户 2026-09-14 定，免得和"继续时清掉附近实体"打架）
//     · cureTags（效果级，或 stages[i].cureTags 按阶段覆盖）：当前阶段能治好它的解药标记；空数组 = 这一阶段无药可救。
//       cureToast：治好时的提示
//     · stages[i].toastMs：该阶段提示停留多久；不写按字数估（每字 120 ms，2.2–6 s），cureToast 同样按字数估
//   cure(tags)       按"当前阶段的 cureTags"治：只清掉解药标记对得上的效果，返回清掉几个。和 clear({ tag }) 分开——
//                    clear 不看阶段，会让分阶段病在无药可救的阶段也被一刀切清掉
//   cureByItem(def)  吃喝物品后由 player.useSelected 调用：任何食物 → 'food'；杏仁水及彩色瓶 → 'almond_water'；再加物品 def.cureTags
//   update(dt)       player.update 每帧调用（玩家死亡期间不调用）
//   speedMul()       所有生效效果的移速倍率乘积，player.speed() 乘上它
//   list             生效中的效果数组（只读）
//   clear(filter?)   不传清空全部；{ negative: true } / { hostile: true } / { tag } / { key } 按条件清
//   has(key) / get(key) / remove(key) / addFx({ obj, seconds, tick(obj, t01) })
// 规则（ARCHITECTURE 第 2、7 节）：hp/饥饿/san 的每秒变化只在 BR.game.statsEnabled（噩梦生存）时作用；
// 移速、画面、传送这类非数值效果所有模式都生效。
(function () {
'use strict';
const BR = window.BR;
const U = BR.util;

const SPEED_MAX = 3;
const FLASH_SEC = 0.5;
const FLATTEN_LAMBDA = 6;     // 画面压扁渐变，不是一帧跳过去

const list = [];
const fx = [];
let flattenCur = 0;
let alertApplied = 0;         // 当前已经加到能见度上的量；-1 = 需要重新套一次（换层后）

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function has(o, f) { return !!o && typeof o[f] === 'function'; }
function maxHp() { return num(BR.config && BR.config.player && BR.config.player.maxHp, 100); }

function flash(v) {
  if (!v || !v.flash || !has(BR.gfx, 'flash')) return;
  BR.gfx.flash(v.flash, num(v.flashSec, FLASH_SEC), num(v.peak, 0.3));
}

function stageNegative(s) {
  return num(s.speedMul, 1) < 1 || num(s.hpPerSec, 0) < 0 || num(s.sanityPerSec, 0) < 0 || num(s.hungerPerSec, 0) < 0;
}

// 提示停留时长：阶段写了 toastMs 就用它；没写按字数估。中文大约一秒读 6–8 个字，而阶段提示常常和受伤闪红、
// 掉血同一刻弹出，玩家要先反应过来再读，所以每字给 120 ms。短句保持原来的 2.2 s，长句封顶 6 s，免得堆着挡画面
const TOAST_MIN_MS = 2200;
const TOAST_MAX_MS = 6000;
const TOAST_PER_CHAR_MS = 120;
function toastMs(ms, text) {
  if (num(ms, 0) > 0) return ms;
  return U.clamp(1000 + String(text || '').length * TOAST_PER_CHAR_MS, TOAST_MIN_MS, TOAST_MAX_MS);
}

function copyStage(e, s) {
  e.speedMul = Math.max(0, num(s.speedMul, 1));
  e.hpPerSec = num(s.hpPerSec, 0);
  e.sanityPerSec = num(s.sanityPerSec, 0);
  e.hungerPerSec = num(s.hungerPerSec, 0);
  e.visual = s.visual || null;
  e.pulseLeft = e.visual && e.visual.pulse > 0 ? e.visual.pulse : 0;
  // 阶段没写 cureTags 就沿用效果级的：大多数病整段都是同一种解药，只有像悲尸循环这样逐段收紧的才按阶段写
  e.cureTags = Array.isArray(s.cureTags) ? s.cureTags.slice() : e.baseCureTags;
  if (s.toast && has(BR.hud, 'toast')) BR.hud.toast(s.toast, toastMs(s.toastMs, s.toast));
  flash(e.visual);
}

function add(opts) {
  const o = opts || {};
  const key = o.key != null ? String(o.key) : '';
  if (!key) { console.warn('[effects] add 缺少 key'); return null; }
  const stages = Array.isArray(o.stages) && o.stages.length ? o.stages.map(s => Object.assign({}, s)) : null;
  const first = stages ? stages[0] : o;
  const seconds = num(first.seconds, 0);
  if (!(seconds > 0)) { console.warn('[effects] seconds 必须大于 0', key); return null; }
  remove(key);
  const e = {
    key, stages, stage: 0,
    left: seconds, elapsed: 0,
    total: stages ? stages.reduce((a, s) => a + Math.max(0, num(s.seconds, 0)), 0) : seconds,
    tags: Array.isArray(o.tags) ? o.tags.slice() : [],
    cause: o.cause || null,
    hostile: !!o.hostile,
    lethalAtEnd: !!o.lethalAtEnd || o.onExpire === 'death',
    onExpire: typeof o.onExpire === 'string' ? o.onExpire : null,
    baseCureTags: Array.isArray(o.cureTags) ? o.cureTags.slice() : null,
    cureTags: null,
    cureToast: o.cureToast ? String(o.cureToast) : null,
    onEnd: typeof o.onEnd === 'function' ? o.onEnd : null,
    data: o.data || {},
    negative: o.negative != null ? !!o.negative : (stages ? stages.some(stageNegative) : stageNegative(o)),
    speedMul: 1, hpPerSec: 0, sanityPerSec: 0, hungerPerSec: 0, visual: null, pulseLeft: 0,
  };
  copyStage(e, first);
  list.push(e);
  syncAlert();
  return e;
}

function transformsInto(e) { return typeof e.onExpire === 'string' && e.onExpire.indexOf('transform:') === 0; }

// 最后一下走 player.damage：死因记到这个效果头上，结算界面不会写"未知原因"。
// 转化类的 causeKey 写 'transform:<type>'：以后要在原地生成那只实体（M4）按这个认，不用解析中文死因
function kill(p, e) {
  if (!p || p.dead || !has(p, 'damage')) return;
  p.damage({ hp: Math.max(0.01, p.hp), source: { cause: e.cause || '中毒身亡', key: transformsInto(e) ? e.onExpire : 'effect:' + e.key } });
}

function applyStats(p, e, step) {
  if (p.dead) return;
  if (e.hungerPerSec) p.hunger = U.clamp(p.hunger + e.hungerPerSec * step, 0, 100);
  if (e.sanityPerSec) p.sanity = U.clamp(p.sanity + e.sanityPerSec * step, 0, 100);
  if (e.hpPerSec > 0) {
    p.hp = Math.min(maxHp(), p.hp + e.hpPerSec * step);
  } else if (e.hpPerSec < 0) {
    const loss = -e.hpPerSec * step;
    // 慢慢掉血直接改字段：走 damage 的话每帧都闪红、都响受伤声
    if (p.hp - loss > 0) p.hp -= loss;
    else kill(p, e);
  }
}

function finish(e, statsOn) {
  if ((e.lethalAtEnd || transformsInto(e)) && statsOn) kill(BR.player, e);
  if (e.onEnd) {
    try { e.onEnd(e); } catch (err) { console.error('[effects] onEnd 出错', e.key, err); }
  }
}

function update(dt) {
  if (!(dt > 0)) return;
  const p = BR.player;
  const statsOn = !!(BR.game && BR.game.statsEnabled) && !!p && !p.dead;
  for (let i = 0; i < list.length;) {
    const e = list[i];
    // 本帧只结算到效果剩余时间为止：数值总量 = 每秒量 × 时长，不多不少
    const step = Math.min(dt, Math.max(0, e.left));
    if (statsOn && step > 0) applyStats(p, e, step);
    if (e.pulseLeft > 0) {
      e.pulseLeft -= dt;
      if (e.pulseLeft <= 0) { e.pulseLeft += e.visual.pulse; flash(e.visual); }
    }
    e.left -= dt;
    e.elapsed += dt;
    if (e.left > 1e-9) { i++; continue; }
    if (e.stages && e.stage < e.stages.length - 1) {
      e.stage++;
      const s = e.stages[e.stage];
      e.left += Math.max(0, num(s.seconds, 0));   // 本帧多扣的时间算进下一阶段
      copyStage(e, s);
      i++;
      continue;
    }
    list.splice(i, 1);
    finish(e, statsOn);
  }
  updateVisuals(p, dt);
  syncAlert();
  updateFx(dt);
}

function speedMul() {
  let m = 1;
  for (let i = 0; i < list.length; i++) m *= num(list[i].speedMul, 1);
  return U.clamp(m, 0, SPEED_MAX);
}

// ---------- 画面 ----------
function updateVisuals(p, dt) {
  let distort = 0, flatten = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i].visual;
    if (!v) continue;
    distort = Math.max(distort, num(v.distort, 0));
    flatten = Math.max(flatten, num(v.flatten, 0));
  }
  if (distort > 0 && has(BR.gfx, 'setSanityEffect')) {
    // player.update 刚按 san 设过一次；取两者较大值，低 san 的画面不会被药效盖掉
    const san = BR.game.statsEnabled && p ? 1 - U.clamp(num(p.sanity, 100), 0, 100) / 100 : 0;
    BR.gfx.setSanityEffect(Math.max(distort, san));
  }
  flattenCur = U.damp(flattenCur, flatten, FLATTEN_LAMBDA, dt);
  if (flatten === 0 && flattenCur < 0.002) flattenCur = 0;
  applyFlatten();
}

// 相机 y 轴放大 = 看到的世界被压扁。applyCamera 只写位置和旋转，不会冲掉 scale
function applyFlatten() {
  const cam = BR.gfx && BR.gfx.camera;
  if (!cam) return;
  const sy = 1 + flattenCur;
  if (Math.abs(cam.scale.y - sy) > 1e-4 || cam.scale.x !== 1 || cam.scale.z !== 1) cam.scale.set(1, sy, 1);
}

function syncAlert() {
  let boost = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i].visual;
    if (v && v.alert > 0) boost = Math.max(boost, v.alert);
  }
  if (boost === alertApplied) return;
  const lv = BR.world && BR.world.current;
  if (!lv || !lv.env || !has(BR.gfx, 'applyEnv')) { alertApplied = boost; return; }
  alertApplied = boost;
  if (boost > 0) {
    const base = num(BR.game.settings && BR.game.settings.visibility, 0.7);
    BR.gfx.applyEnv(lv.env, U.clamp(base + boost, 0, 1));
  } else {
    BR.gfx.applyEnv(lv.env);   // 不传能见度 = 回到跟随设置
  }
}

// ---------- 场景特效（爆炸光球、闪电） ----------
function addFx(o) {
  const scene = BR.gfx && BR.gfx.scene;
  if (!o || !o.obj || !scene) return null;
  scene.add(o.obj);
  const total = Math.max(0.01, num(o.seconds, 0.5));
  const f = { obj: o.obj, left: total, total, tick: typeof o.tick === 'function' ? o.tick : null };
  if (f.tick) f.tick(f.obj, 0);
  fx.push(f);
  return f;
}

function disposeFx(f) {
  if (f.obj.parent) f.obj.parent.remove(f.obj);
  f.obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !(o.material.userData && o.material.userData.shared)) o.material.dispose();
  });
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.left -= dt;
    if (f.tick) {
      try { f.tick(f.obj, U.clamp(1 - f.left / f.total, 0, 1)); }
      catch (err) { console.error('[effects] 特效 tick 出错', err); f.tick = null; }
    }
    if (f.left <= 0) { disposeFx(f); fx.splice(i, 1); }
  }
}

// ---------- 查询 / 清除 ----------
function get(key) {
  const k = String(key);
  for (let i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
  return null;
}

function remove(key) {
  const k = String(key);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].key === k) { list.splice(i, 1); syncAlert(); return true; }
  }
  return false;
}

function match(e, f) {
  if (!f) return true;
  if (f.negative && !e.negative) return false;
  if (f.hostile && !e.hostile) return false;
  if (f.tag && e.tags.indexOf(f.tag) < 0) return false;
  if (f.key && e.key !== String(f.key)) return false;
  return true;
}

// ---------- 解药 ----------
// 标准杏仁水和三种彩色瓶；过期杏仁水不算——发霉变质后"没有任何好处"，只剩毒性
const ALMOND_WATERS = ['almond_water', 'almond_water_blue', 'almond_water_green', 'almond_water_red'];

// 物品 → 解药标记。物品文件还没声明 cureTags（M4 回填时加），先按类别推，声明了的一并算上
function itemCureTags(def) {
  if (!def) return [];
  const out = Array.isArray(def.cureTags) ? def.cureTags.slice() : [];
  if (def.category === 'food') out.push('food');
  if (ALMOND_WATERS.indexOf(def.type) >= 0) out.push('almond_water');
  return out;
}

function cure(tags) {
  const want = Array.isArray(tags) ? tags : tags != null ? [tags] : [];
  if (!want.length) return 0;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i], ct = e.cureTags;
    if (!ct || !ct.length || !want.some(t => ct.indexOf(t) >= 0)) continue;
    list.splice(i, 1);
    n++;
    if (e.cureToast && has(BR.hud, 'toast')) BR.hud.toast(e.cureToast, toastMs(0, e.cureToast));
  }
  if (n) syncAlert();
  return n;
}

function cureByItem(def) {
  const d = typeof def === 'string' ? BR.itemTypes.get(def) : def;
  return cure(itemCureTags(d));
}

function clear(filter) {
  const f = filter && typeof filter === 'object' ? filter : null;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (match(list[i], f)) { list.splice(i, 1); n++; }
  }
  if (!f) {
    for (let i = fx.length - 1; i >= 0; i--) disposeFx(fx[i]);
    fx.length = 0;
  }
  if (!list.some(e => e.visual && e.visual.flatten > 0)) { flattenCur = 0; applyFlatten(); }
  syncAlert();
  return n;
}

// 换层后 world 会按设置重新套雾：下一帧把"更警觉"的能见度加回去
BR.bus.on('level:enter', () => { alertApplied = -1; });

BR.effects = {
  list,
  add, update, speedMul, clear, has: key => !!get(key), get, remove, addFx,
  cure, cureByItem, itemCureTags,
  get fxCount() { return fx.length; },
};
})();
