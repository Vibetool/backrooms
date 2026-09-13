// 罐头口粮（占位）：通用军绿色罐头，等调研确定设定里的食物后整体替换。模型和图标全部程序化生成
(function () {
'use strict';
const BR = window.BR;

const R = 0.042;        // 罐身半径（米），原点在罐底中心
const H = 0.11;         // 罐高
const RIM = 0.011;      // 上下卷边高度
const SCALE = 1.15;

// 图集 512×256：上 160px 是纸标签（重复两份），下面两条是亮/暗金属色。整罐合并成一个 mesh
const V_LABEL0 = 0.385, V_LABEL1 = 0.99;
const V_METAL = 0.28;
const V_METAL_DARK = 0.094;

let parts = null;

function drawLabel(g, x, w, h) {
  g.fillStyle = '#5c6234';
  g.fillRect(x, 0, w, h);
  g.fillStyle = '#383b20';
  g.fillRect(x, 0, w, 16);
  g.fillRect(x, h - 16, w, 16);
  g.fillStyle = '#e6dcb4';   // 奶白铭牌
  g.fillRect(x + 20, 30, w - 40, 60);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#383b20';
  g.font = 'bold 40px "Arial Black", Arial, sans-serif';
  g.fillText('RATION', x + w / 2, 61, w - 56);
  g.fillStyle = '#e6dcb4';
  g.font = 'bold 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('罐头口粮', x + w / 2, 110, w - 40);
  g.font = '15px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('应急食品 · 一份', x + w / 2, 132, w - 40);
}

function makeTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  drawLabel(g, 0, 256, 160);
  drawLabel(g, 256, 256, 160);   // 一圈两份，转到哪面都看得到字
  g.fillStyle = '#b8bcc1';
  g.fillRect(0, 160, 512, 48);
  g.fillStyle = '#7a7e84';
  g.fillRect(0, 208, 512, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  return tex;
}

function remapV(geo, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

function solidUV(geo, v) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, v);
  return geo;
}

function makeParts(THREE) {
  const rimR = R + 0.0012;
  const pieces = [
    remapV(new THREE.CylinderGeometry(R, R, H - RIM * 2, 28, 1, true).translate(0, H / 2, 0), V_LABEL0, V_LABEL1),
    solidUV(new THREE.CylinderGeometry(rimR, rimR, RIM, 28, 1, true).translate(0, RIM / 2, 0), V_METAL),
    solidUV(new THREE.CylinderGeometry(rimR, rimR, RIM, 28, 1, true).translate(0, H - RIM / 2, 0), V_METAL),
    // 顶盖略低于卷边，看起来是压进去的
    solidUV(new THREE.CircleGeometry(R, 28).rotateX(-Math.PI / 2).translate(0, H - 0.0015, 0), V_METAL),
    solidUV(new THREE.CircleGeometry(R, 28).rotateX(Math.PI / 2).translate(0, 0.0005, 0), V_METAL_DARK),
    solidUV(new THREE.TorusGeometry(R * 0.78, 0.0014, 4, 28).rotateX(Math.PI / 2).translate(0, H - 0.0015, 0), V_METAL_DARK),
    // 拉环 + 铆钉：一眼认出是罐头而不是一截管子
    solidUV(new THREE.TorusGeometry(0.011, 0.0022, 6, 18).rotateX(Math.PI / 2).translate(0.014, H - 0.0005, 0), V_METAL),
    solidUV(new THREE.CylinderGeometry(0.0042, 0.0042, 0.002, 10).translate(0, H - 0.0005, 0), V_METAL_DARK),
  ];
  const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(pieces, false);
  pieces.forEach(g => g.dispose());
  if (!geo) throw new Error('罐头几何合并失败');
  const tex = makeTexture(THREE);
  return {
    geo,
    mat: new THREE.MeshPhongMaterial({
      map: tex, specular: 0x3a3a3a, shininess: 35,
      emissive: 0x202020, emissiveMap: tex,   // 一点自发光：暗层级里也能看出地上有东西
    }),
  };
}

function makeIcon() {
  if (typeof document === 'undefined') return undefined;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const ellipse = (cx, cy, rx, ry, fill) => {
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
    };
    ellipse(32, 52, 19, 6, '#7a7e84');
    g.fillStyle = '#5c6234';
    g.fillRect(13, 17, 38, 35);
    g.fillStyle = '#383b20';
    g.fillRect(13, 20, 38, 3);
    g.fillRect(13, 46, 38, 3);
    g.fillStyle = '#e6dcb4';
    g.fillRect(18, 28, 28, 12);
    g.fillStyle = '#383b20';
    g.fillRect(22, 32, 20, 4);
    ellipse(32, 17, 19, 6, '#b8bcc1');
    ellipse(32, 17, 14.5, 4.2, '#9da1a7');
    g.beginPath();
    g.ellipse(38, 17, 4.5, 2, 0, 0, Math.PI * 2);
    g.strokeStyle = '#6d7177';
    g.lineWidth = 1.4;
    g.stroke();
    return c.toDataURL('image/png');
  } catch (err) {
    return undefined;
  }
}

BR.itemTypes.register({
  type: 'food_ration', en: 'Canned Ration', zh: '罐头口粮', version: 'placeholder',
  category: 'food',
  stack: 5,
  desc: '不知道谁留下的罐头，没过期就行。',
  icon: makeIcon(),
  build(ctx) {
    const THREE = (ctx && ctx.THREE) || window.THREE;
    if (!parts) parts = makeParts(THREE);
    const mesh = new THREE.Mesh(parts.geo, parts.mat);
    mesh.name = 'food_ration';
    mesh.scale.setScalar(SCALE);
    return mesh;
  },
  // 游玩模式下 player.useSelected 会把数值还原
  use(player) {
    player.hunger = Math.min(100, player.hunger + 35);
    if (BR.audio && typeof BR.audio.play === 'function') BR.audio.play('eat');
    return true;
  },
});
})();
