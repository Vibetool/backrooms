// 后室 · 场景拾取物管理：地上那一份物品的模型、浮动动画、拾取进背包
// 物品类型本身由 js/items/*.js 用 BR.itemTypes.register 注册；接口见 ARCHITECTURE.md 第 7、12 节
(function () {
'use strict';
const BR = window.BR;
const THREE = window.THREE;
const U = BR.util;

const FLOAT_BASE = 0.12;     // 模型原点在底部，整体抬高一点，浮到最低也不插进地板
const FLOAT_AMP = 0.04;
const FLOAT_SPEED = 2.2;
const SPIN_SPEED = 0.9;
const MAX_DROPPED = 30;      // 丢弃物不属于任何区块、不随区块卸载，不设上限会无限堆积

const list = [];
const byId = new Map();
const picked = new Set();    // 已拾取的 id：区块卸载后重新载入会用同一个确定性 id 再刷一次，要拦住
const dropped = [];          // 丢弃物 id，先进先出
const templates = new Map(); // type → 模板；实例 clone 共享几何和材质，手机上省显存
let group = null;
let time = 0;

function ensureGroup() {
  if (!group) {
    group = new THREE.Group();
    group.name = 'items';
  }
  // gfx 可能比物品晚初始化，也可能重建 scene，用之前确认挂在当前 scene 上
  const scene = BR.gfx && BR.gfx.scene;
  if (scene && group.parent !== scene) scene.add(group);
  return group;
}

// build 抛错时的兜底：黄色小方块，至少能捡，一个坏物品不至于卡住整个区块
function fallbackModel() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16).translate(0, 0.08, 0),
    new THREE.MeshLambertMaterial({ color: 0xffcc33, emissive: 0x332200 })
  );
}

function template(type) {
  let tpl = templates.get(type);
  if (tpl) return tpl;
  const def = BR.itemTypes.get(type);
  const ctx = {
    THREE, BR, assets: BR.assets, game: BR.game,
    scene: BR.gfx ? BR.gfx.scene : null,
    level: BR.world ? BR.world.current : null,
  };
  try { tpl = def.build(ctx); } catch (err) { console.error('[items] build 失败', type, err); }
  if (!tpl || !tpl.isObject3D) tpl = fallbackModel();
  templates.set(type, tpl);
  return tpl;
}

function place(p) {
  p.obj.position.set(p.x, p.y + FLOAT_BASE + Math.sin(time * FLOAT_SPEED + p.phase) * FLOAT_AMP, p.z);
  p.obj.rotation.y = p.phase + time * SPIN_SPEED;
}

function detach(p) {
  if (p.obj.parent) p.obj.parent.remove(p.obj);
  const i = list.indexOf(p);
  if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
  byId.delete(p.id);
  if (p.dropped) {
    const k = dropped.indexOf(p.id);
    if (k >= 0) dropped.splice(k, 1);
  }
}

function toast(text) {
  if (BR.hud && typeof BR.hud.toast === 'function') BR.hud.toast(text, 1500);
}

BR.items = {
  list,
  get group() { return ensureGroup(); },

  // opts: { id, chunkKey, count, dropped }；id 由 world.js 按区块确定性生成，联机两边才对得上
  spawn(type, x, y, z, opts) {
    const o = opts || {};
    if (!BR.itemTypes.has(type)) { console.warn('[items] 未注册的物品类型', type); return null; }
    const id = o.id != null ? String(o.id) : U.uid('it');
    if (picked.has(id)) return null;
    if (byId.has(id)) return byId.get(id);
    if (typeof y !== 'number' || !isFinite(y)) {
      y = BR.phys && typeof BR.phys.groundY === 'function' ? (+BR.phys.groundY(x, z) || 0) : 0;
    }
    const obj = template(type).clone(true);
    obj.userData.pickupId = id;
    const p = {
      id, type, x, y, z, obj,
      chunkKey: o.chunkKey != null ? o.chunkKey : null,
      count: Math.max(1, o.count | 0),
      dropped: !!o.dropped,
      // 按 id 定相位：一排物品不会整齐划一地上下，联机两边节奏也一致
      phase: (U.hashStr(id) % 6283) / 1000,
    };
    place(p);
    ensureGroup().add(obj);
    list.push(p);
    byId.set(id, p);
    if (p.dropped) {
      dropped.push(id);
      while (dropped.length > MAX_DROPPED) {
        const old = byId.get(dropped[0]);
        if (old) detach(old); else dropped.shift();
      }
    }
    return p;
  },

  find(id) { return byId.get(String(id)) || null; },

  remove(id) {
    const p = byId.get(String(id));
    if (!p) return false;
    detach(p);
    return true;
  },

  removeChunk(chunkKey) {
    const key = String(chunkKey);
    // 倒序遍历：detach 是交换删除，换到当前位置的元素已经检查过
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.chunkKey != null && String(p.chunkKey) === key) detach(p);
    }
  },

  clear() {
    for (let i = list.length - 1; i >= 0; i--) detach(list[i]);
    picked.clear();
    dropped.length = 0;
  },

  nearest(x, z, maxDist) {
    let best = null;
    let bd = maxDist == null ? Infinity : maxDist * maxDist;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const d = U.dist2(x, z, p.x, p.z);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  },

  // by = 'me'：进自己背包；'peer'：联机对方捡走了，只从场景移除
  pick(id, by) {
    const p = byId.get(String(id));
    if (!p) return false;
    if (by === 'peer') {
      picked.add(p.id);
      detach(p);
      return true;
    }
    const player = BR.player;
    if (!player || typeof player.addItem !== 'function') return false;
    const added = player.addItem(p.type, p.count);
    if (added <= 0) { toast('背包已满'); return false; }
    if (added < p.count) {
      // 只装得下一部分，剩下的留在地上
      p.count -= added;
      toast('背包已满');
    } else {
      picked.add(p.id);
      detach(p);
    }
    if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play('pickup');
    BR.bus.emit('item:pickup', { type: p.type, id: p.id, count: added });
    return true;
  },

  update(dt) {
    time += dt;
    ensureGroup();
    for (let i = 0; i < list.length; i++) place(list[i]);
  },
};
})();
