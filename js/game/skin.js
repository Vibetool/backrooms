// 后室 · 制服颜色：主页换皮肤，测试人与联机对方同步
// 经典 <script>，只往 window.BR 上挂东西。接口见 ARCHITECTURE.md 第 12 节 BR.skin
(function () {
'use strict';
const BR = window.BR;
if (!BR || !BR.SKINS) { console.error('[skin] 需要先加载 js/core/base.js'); return; }

const STORE_KEY = 'backrooms_skin';
// Blender 导出时同名材质可能带 .001 后缀，一并认作防化服
const SUIT_NAME_RE = /^Suit(\.\d+)?$/;

function find(key) {
  for (let i = 0; i < BR.SKINS.length; i++) if (BR.SKINS[i].key === key) return BR.SKINS[i];
  return null;
}

function readStored() {
  // 隐私模式 / 禁用站点数据时访问 localStorage 本身会抛错
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    if (v && find(v)) return v;
  } catch (err) { /* 用默认 */ }
  return find(BR.DEFAULT_SKIN) ? BR.DEFAULT_SKIN : BR.SKINS[0].key;
}

let current = readStored();
if (BR.game) BR.game.skin = current;

function color(key) {
  const s = find(key == null ? current : key) || find(current) || BR.SKINS[0];
  return s.color;
}

function set(key) {
  if (!find(key)) { console.warn('[skin] 未知皮肤', key); return false; }
  const changed = key !== current;
  current = key;
  if (BR.game) BR.game.skin = key;
  try { window.localStorage.setItem(STORE_KEY, key); } catch (err) { /* 存不了就只在本次生效 */ }
  // 没变不发：coop 收到 skin:change 会往网络上发消息
  if (changed) BR.bus.emit('skin:change', { key });
  return true;
}

// r147 默认 ColorManagement.legacyMode = true，setHex 不做 sRGB→线性转换，
// 直接当线性值用会比色板浅一截；手动转一次，屏幕上的颜色才和色板、GLB 里的原色一致
function setMatColor(c, hex) {
  c.setHex(hex);
  const cm = THREE.ColorManagement;
  if (!cm || cm.legacyMode !== false) c.convertSRGBToLinear();
}

function isOwnClone(m, mesh) {
  return !!(m && m.userData && m.userData.brSkinOwner === mesh.uuid);
}

function forEachMaterial(mesh, fn) {
  const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (let i = 0; i < arr.length; i++) if (arr[i]) fn(arr[i], i, arr);
}

// 返回改色的材质个数（0 = 这棵树里没找到防化服）
function apply(object3d, key) {
  if (!object3d || typeof object3d.traverse !== 'function') return 0;
  const hex = color(key);

  // 规则：整棵树只要有一个名为 Suit 的材质就只按材质名找；一个都没有才退到 userData.suit 标记的网格（兜底人形）
  let byName = false;
  object3d.traverse(o => {
    if (byName || !o.isMesh || !o.material) return;
    forEachMaterial(o, m => { if (SUIT_NAME_RE.test(m.name || '')) byName = true; });
  });

  let count = 0;
  object3d.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const meshFlag = !byName && !!(o.userData && o.userData.suit === true);
    const isArr = Array.isArray(o.material);
    forEachMaterial(o, (m, i, arr) => {
      const hit = byName ? (SUIT_NAME_RE.test(m.name || '') || isOwnClone(m, o)) : (meshFlag || isOwnClone(m, o));
      if (!hit) return;
      if (!isOwnClone(m, o)) {
        // 模型缓存的克隆共享材质：先 clone 再改，粗糙度/金属度/贴图等参数原样保留，不污染其他实例
        const c = m.clone();
        c.userData.brSkinOwner = o.uuid;
        c.userData.brSuit = true;
        if (isArr) arr[i] = c; else o.material = c;
        m = c;
      }
      if (m.color) setMatColor(m.color, hex);
      count++;
    });
  });
  return count;
}

BR.skin = {
  get current() { return current; },
  list: BR.SKINS,
  set,
  color,
  apply,
  // 主页悬停高亮等需要找到防化服材质时用
  isSuitMaterial(m) { return !!m && (SUIT_NAME_RE.test(m.name || '') || !!(m.userData && m.userData.brSuit)); },
};
})();
