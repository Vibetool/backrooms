# 后室 · 穿后室制服（黄色防化服 + 防毒面具）的人形模型，只用 bpy 程序化建模
# 用法（无头）：
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender_hazmat.py
# 输出：assets/models/hazmat.glb、tools/preview_hazmat.png（左：3/4 正面，中：侧面，右：头部特写）
#
# 约定：
# - 防化服是单独一个材质 "Suit"，换皮肤只改它；面具/目镜/滤罐/手套/靴子/胶带/腰带/工具包各用别的材质。
# - 原点在脚底中心，身高 1.8 m，export_yup=True。
# - 游戏里实体接口约定"面朝 -Z"。glTF 导出的轴变换是 (x, y, z)_blender → (x, z, -y)_gltf，
#   Blender 的 -Y 会变成 glTF 的 +Z，所以建模时按习惯朝 -Y 搭，最后把顶点绕 Z 转 180°（朝 +Y）再导出，GLB 里才是 -Z。
# - 不用修改器和 ops 建几何：全部自己算顶点，结果与 Blender 上下文无关，重跑逐字节一致。
import bpy
import math
import os
import sys
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_GLB = os.path.join(ROOT, 'assets', 'models', 'hazmat.glb')
OUT_PNG = os.path.join(HERE, 'preview_hazmat.png')

# ---------------------------------------------------------------------------
# 材质
# ---------------------------------------------------------------------------
def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    return tuple(srgb2lin(((h >> s) & 255) / 255.0) for s in (16, 8, 0))


MAT_SPECS = {
    # 颜色和 base.js 的 BR.SKINS 黄色一致；glTF baseColorFactor 是线性值，所以先转线性
    'Suit':   (0xd8b21f, 0.50, 0.0),   # 橡胶防化服，略带光泽（再低就像塑料玩具）
    'Tape':   (0x0c0c0c, 0.78, 0.0),   # 哑光黑胶带
    'Gloves': (0x141414, 0.36, 0.0),   # 丁腈手套，比胶带亮
    'Boots':  (0x111111, 0.55, 0.0),
    'Mask':   (0x252525, 0.50, 0.0),
    'Visor':  (0x0a0e11, 0.06, 0.30),  # 深色目镜：低粗糙度，灯下有高光
    'Filter': (0x353535, 0.45, 0.35),
    'Belt':   (0x1a1a1a, 0.85, 0.0),
    'Metal':  (0x9a9a9a, 0.30, 1.0),
    'Pouch':  (0x2b2a22, 0.90, 0.0),
}
MATS = {}


def make_materials():
    for name, (hx, rough, metal) in MAT_SPECS.items():
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        col = hexcol(hx) + (1.0,)
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = col
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        # 单面：导出 doubleSided=false；预览渲染也开背面剔除，法线朝反的零件会直接消失，一眼能看出来
        m.use_backface_culling = True
        m.diffuse_color = col
        m.roughness = rough
        m.metallic = metal
        MATS[name] = m


# ---------------------------------------------------------------------------
# 几何累加器：每个材质一份顶点/面列表，最后一个材质一个网格（draw call 少）
# ---------------------------------------------------------------------------
class Acc:
    def __init__(self):
        self.v = []
        self.f = []
        self.smooth = []


ACC = {}


def acc(mat):
    if mat not in ACC:
        ACC[mat] = Acc()
    return ACC[mat]


def superellipse(a, n):
    c, s = math.cos(a), math.sin(a)
    e = 2.0 / n
    return math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s)


def spline(keys, per_seg):
    """Catmull-Rom，逐分量插值 [x, y, z, rx, ryf, ryb, amp]，首尾点复制"""
    out = []
    n = len(keys)
    for i in range(n - 1):
        p0, p1, p2, p3 = keys[max(i - 1, 0)], keys[i], keys[i + 1], keys[min(i + 2, n - 1)]
        for k in range(per_seg):
            t = k / per_seg
            t2, t3 = t * t, t * t * t
            out.append([0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 +
                               (-a + 3 * b - 3 * c + d) * t3) for a, b, c, d in zip(p0, p1, p2, p3)])
    out.append(list(keys[-1]))
    return out


def make_wr(seed, f_axis=22.0, f_ring=1.3):
    """褶皱：沿路径高频、绕周向低频 → 横向的橡胶褶；再叠一层低频松垮起伏。
    用 (cos a, sin a) 采样噪声，绕一圈首尾自然闭合"""
    ox = seed * 7.31

    def wr(ca, sa, s, amp):
        n1 = noise.noise(Vector((ca * f_ring + ox, sa * f_ring - ox, s * f_axis)))
        n2 = noise.noise(Vector((ca * 0.8 - ox, sa * 0.8 + ox * 0.5, s * 4.0 + 11.0)))
        # 0.35-|n| 是脊状噪声：窄而尖的褶线，比平滑噪声更像橡胶布
        return amp * (1.4 * (0.35 - abs(n1)) + 0.6 * n2)
    return wr


def loft(mat, rings, segs, cap0=True, cap1=True, n=2.0, wr=None, ref=None,
         dome0=0.0, dome1=0.0, smooth=True, cap_smooth=False):
    """沿路径放样。rings: [[x, y, z, rx, ryf, ryb, amp], ...]
    横截面在垂直于切线的平面里：side 轴半径 rx，front 轴半径 ryf（正向）/ ryb（反向），n 为超椭圆指数。
    面的绕序按构造保证朝外：quad (a_j, b_j, b_j+1, a_j+1) 法线 = t × front = side。"""
    A = acc(mat)
    base = len(A.v)
    P = [Vector(r[:3]) for r in rings]
    m = len(P)
    T = [(P[min(i + 1, m - 1)] - P[max(i - 1, 0)]).normalized() for i in range(m)]
    if ref is None:
        # 整条路径只选一次参考轴，中途换轴会让相邻两圈错位扭成麻花
        d = P[-1] - P[0]
        avg = d.normalized() if d.length > 1e-6 else T[0]
        ref = Vector((1, 0, 0)) if abs(avg.x) < 0.85 else Vector((0, 0, 1))
    s_acc = 0.0
    for i in range(m):
        if i > 0:
            s_acc += (P[i] - P[i - 1]).length
        t = T[i]
        side = ref - t * ref.dot(t)
        if side.length < 1e-6:
            side = Vector((0, 1, 0)) - t * t.y
        side.normalize()
        front = side.cross(t)
        _, _, _, rx, ryf, ryb, amp = rings[i]
        for j in range(segs):
            a = 2 * math.pi * j / segs
            ca, sa = superellipse(a, n)
            ry = ryf if sa > 0 else ryb
            k = 1.0 + (wr(math.cos(a), math.sin(a), s_acc, amp) if (wr and amp) else 0.0)
            A.v.append(P[i] + side * (rx * ca * k) + front * (ry * sa * k))
    for i in range(m - 1):
        a0, b0 = base + i * segs, base + (i + 1) * segs
        for j in range(segs):
            j1 = (j + 1) % segs
            A.f.append((a0 + j, b0 + j, b0 + j1, a0 + j1))
            A.smooth.append(smooth)
    if cap0:
        c = len(A.v)
        A.v.append(P[0] - T[0] * dome0)
        for j in range(segs):
            A.f.append((c, base + j, base + (j + 1) % segs))
            A.smooth.append(cap_smooth or dome0 > 0)
    if cap1:
        c = len(A.v)
        A.v.append(P[-1] + T[-1] * dome1)
        e = base + (m - 1) * segs
        for j in range(segs):
            A.f.append((c, e + (j + 1) % segs, e + j))
            A.smooth.append(cap_smooth or dome1 > 0)


def cylinder(mat, p0, p1, r0, r1=None, segs=20, cap0=True, cap1=True, dome1=0.0, bevel=0.0):
    r1 = r0 if r1 is None else r1
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.85 else Vector((1, 0, 0))
    if bevel > 0:
        # 两端各加一圈收边：端面和侧面之间不再是一条锋利的线
        b = min(bevel, (p1 - p0).length * 0.3)
        rings = [[*p0, r0 - b, r0 - b, r0 - b, 0], [*(p0 + d * b), r0, r0, r0, 0],
                 [*(p1 - d * b), r1, r1, r1, 0], [*p1, r1 - b, r1 - b, r1 - b, 0]]
    else:
        rings = [[*p0, r0, r0, r0, 0], [*p1, r1, r1, r1, 0]]
    loft(mat, rings, segs, cap0=cap0, cap1=cap1, ref=ref, dome1=dome1)


def rbox(mat, c, hx, hy, hz, n=6.0, bevel=0.25, segs=24):
    """竖直超椭圆柱 + 上下收边，近似圆角盒。hy 沿 -Y（front）方向"""
    cx, cy, cz = c
    b = min(hx, hy, hz) * bevel
    rings = [[cx, cy, cz - hz, hx - b, hy - b, hy - b, 0],
             [cx, cy, cz - hz + b, hx, hy, hy, 0],
             [cx, cy, cz + hz - b, hx, hy, hy, 0],
             [cx, cy, cz + hz, hx - b, hy - b, hy - b, 0]]
    loft(mat, rings, segs, n=n, ref=Vector((1, 0, 0)))


def ellipsoid(mat, c, rx, ry, rz, segs=24, rings=14, wr=None, amp=0.0):
    keys = []
    for i in range(1, rings):
        ph = -math.pi / 2 + math.pi * i / rings
        cp, sp = math.cos(ph), math.sin(ph)
        keys.append([c[0], c[1], c[2] + rz * sp, rx * cp, ry * cp, ry * cp, amp])
    loft(mat, keys, segs, wr=wr, ref=Vector((1, 0, 0)),
         dome0=keys[0][2] - (c[2] - rz), dome1=(c[2] + rz) - keys[-1][2])


def tube_loop(mat, pts, r, segs=8, refs=None, closed=True):
    """沿曲线的细管（胶带圈、头带、镜框）。refs 给每个点的参考方向（曲线所在面的法线或外法线），
    保证相邻两圈的起始角不翻转。closed=False 时两端封平头（头带两端埋进面罩）"""
    if not closed:
        A = acc(mat)
        base = len(A.v)
        m = len(pts)
        rings = []
        for i in range(m):
            rings.append([*pts[i], r, r, r, 0])
        # 开口曲线直接复用放样：参考方向取整条弧所在平面的法线
        loft(mat, rings, segs, ref=refs[0] if refs else Vector((0, 0, 1)))
        return
    A = acc(mat)
    base = len(A.v)
    m = len(pts)
    for i in range(m):
        t = (pts[(i + 1) % m] - pts[i - 1]).normalized()
        ref = refs[i] if refs else Vector((0, 0, 1))
        side = ref - t * ref.dot(t)
        if side.length < 1e-6:
            side = Vector((1, 0, 0)) - t * t.x
        side.normalize()
        front = side.cross(t)
        for j in range(segs):
            a = 2 * math.pi * j / segs
            A.v.append(pts[i] + side * (r * math.cos(a)) + front * (r * math.sin(a)))
    for i in range(m):
        a0, b0 = base + i * segs, base + ((i + 1) % m) * segs
        for j in range(segs):
            j1 = (j + 1) % segs
            A.f.append((a0 + j, b0 + j, b0 + j1, a0 + j1))
            A.smooth.append(True)


def add_face_auto(A, idx, outward, smooth=True):
    """不规则曲面片（目镜）按给定外方向定绕序"""
    p0, p1, p2 = A.v[idx[0]], A.v[idx[1]], A.v[idx[2]]
    nrm = (p1 - p0).cross(p2 - p0)
    if nrm.length < 1e-12 and len(idx) == 4:
        nrm = (A.v[idx[2]] - p0).cross(A.v[idx[3]] - p0)
    if nrm.dot(outward) < 0:
        idx = tuple(reversed(idx))
    A.f.append(tuple(idx))
    A.smooth.append(smooth)


def at_z(rings, z):
    """沿 z 单调下降的肢体中心线上按高度取点（超出末端时沿最后一段外推）"""
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if (a[2] - z) * (b[2] - z) <= 0 and a[2] != b[2]:
            t = (z - a[2]) / (b[2] - a[2])
            return [u + (v - u) * t for u, v in zip(a, b)]
    a, b = rings[-2], rings[-1]
    t = (z - a[2]) / (b[2] - a[2])
    return [u + (v - u) * t for u, v in zip(a, b)]


# ---------------------------------------------------------------------------
# 人体各部件（建模朝 -Y；x>0 是人物左侧）
# ---------------------------------------------------------------------------
TORSO = []
MC = Vector((0.0, -0.078, 1.615))      # 面罩椭球中心
MRX, MRY, MRZ = 0.098, 0.075, 0.118


def mask_pt(th, ph, o=0.0):
    cp = math.cos(ph)
    return Vector((MC.x + (MRX + o) * cp * math.sin(th),
                   MC.y - (MRY + o) * cp * math.cos(th),
                   MC.z + (MRZ + o) * math.sin(ph)))


def mask_nrm(th, ph):
    p = mask_pt(th, ph)
    return Vector(((p.x - MC.x) / MRX ** 2, (p.y - MC.y) / MRY ** 2, (p.z - MC.z) / MRZ ** 2)).normalized()


def torso_surface_y(z, x, extra=0.0):
    """躯干在高度 z、横坐标 x 处的前表面 y（取褶皱上限，贴上去的东西不会被褶子顶穿）"""
    r = at_z(TORSO[::-1], z) if TORSO[0][2] < TORSO[-1][2] else at_z(TORSO, z)
    rx, ryf, amp = r[3], r[4], r[6]
    kmax = 1.0 + amp * 0.95
    u = min(0.98, abs(x) / (rx * kmax))
    return -(ryf * kmax * math.sqrt(1 - u * u)) - extra


HOOD_S = 1.08   # 兜帽整体放大系数：防化服兜帽要罩住头和面罩，比真人头围大一圈


def build_suit():
    wr_t = make_wr(1, f_axis=16.0)
    # 躯干：宽松、胸口略鼓、腰带处褶皱压到很低（腰带要贴合）
    keys = [
        [0, 0.000, 0.800, 0.100, 0.080, 0.085, 0.02],
        [0, 0.000, 0.840, 0.160, 0.115, 0.125, 0.05],
        [0, 0.000, 0.900, 0.185, 0.132, 0.138, 0.07],
        [0, 0.000, 0.960, 0.190, 0.138, 0.135, 0.015],
        [0, 0.000, 1.040, 0.188, 0.140, 0.132, 0.015],
        [0, 0.000, 1.120, 0.192, 0.146, 0.133, 0.06],
        [0, 0.000, 1.220, 0.203, 0.152, 0.136, 0.06],
        [0, 0.000, 1.310, 0.210, 0.150, 0.136, 0.05],
        [0, 0.004, 1.380, 0.212, 0.138, 0.130, 0.04],
        [0, 0.006, 1.430, 0.205, 0.120, 0.120, 0.03],
        [0, 0.008, 1.470, 0.160, 0.100, 0.106, 0.02],
        [0, 0.010, 1.505, 0.090, 0.075, 0.080, 0.01],
    ]
    rings = spline(keys, 3)
    TORSO[:] = rings
    loft('Suit', rings, 24, wr=wr_t, dome1=0.012)

    # 兜帽：包住整个头，面罩从前面露出
    wr_h = make_wr(2, f_axis=22.0)
    hood = [
        [0, 0.012, 1.460, 0.070, 0.070, 0.075, 0.015],
        [0, 0.012, 1.500, 0.092, 0.090, 0.098, 0.03],
        [0, 0.012, 1.550, 0.108, 0.104, 0.114, 0.035],
        [0, 0.012, 1.610, 0.118, 0.112, 0.122, 0.03],
        [0, 0.012, 1.670, 0.119, 0.112, 0.123, 0.03],
        [0, 0.012, 1.720, 0.109, 0.103, 0.114, 0.03],
        [0, 0.012, 1.760, 0.088, 0.083, 0.094, 0.02],
        [0, 0.012, 1.785, 0.058, 0.055, 0.063, 0.01],
    ]
    # 以面罩中心高度为基准横向放大，顶点高度保持 1.8 m 不变
    for k in hood:
        k[3] *= HOOD_S
        k[4] *= HOOD_S
        k[5] *= HOOD_S
    loft('Suit', spline(hood, 3), 24, wr=wr_h, dome1=0.015)

    arms = {}
    for sx in (1, -1):
        # 手臂自然下垂、肘部略后、手腕略前，手腕离髋部约 7 cm；肩头压低，不要垫肩似的鼓包
        ak = [
            [sx * 0.190, 0.005, 1.430, 0.040, 0.040, 0.040, 0.0],
            [sx * 0.212, 0.005, 1.400, 0.062, 0.062, 0.064, 0.02],
            [sx * 0.235, 0.010, 1.330, 0.068, 0.066, 0.068, 0.06],
            [sx * 0.255, 0.018, 1.230, 0.066, 0.064, 0.066, 0.08],
            [sx * 0.275, 0.030, 1.115, 0.060, 0.058, 0.060, 0.13],
            [sx * 0.290, 0.012, 0.990, 0.056, 0.054, 0.056, 0.08],
            [sx * 0.305, -0.012, 0.900, 0.050, 0.050, 0.050, 0.10],
            [sx * 0.310, -0.020, 0.870, 0.047, 0.047, 0.047, 0.03],
        ]
        rings = spline(ak, 4)
        arms[sx] = rings
        loft('Suit', rings, 20, wr=make_wr(3 + sx, f_axis=20.0), dome0=0.02)

        # 裤腿：膝盖和靴口上方堆褶；胶带那一段褶皱压低，免得褶子顶穿胶带像破布
        lk = [
            [sx * 0.098, 0.000, 0.940, 0.090, 0.090, 0.090, 0.0],
            [sx * 0.103, 0.000, 0.860, 0.108, 0.104, 0.110, 0.07],
            [sx * 0.112, -0.006, 0.740, 0.100, 0.098, 0.102, 0.09],
            [sx * 0.124, -0.012, 0.600, 0.090, 0.088, 0.090, 0.09],
            [sx * 0.132, -0.014, 0.510, 0.084, 0.082, 0.084, 0.14],
            [sx * 0.140, -0.006, 0.450, 0.080, 0.077, 0.082, 0.11],
            [sx * 0.146, 0.004, 0.380, 0.073, 0.071, 0.075, 0.0],
            [sx * 0.150, 0.008, 0.300, 0.066, 0.064, 0.068, 0.0],
        ]
        loft('Suit', spline(lk, 4), 20, wr=make_wr(7 + sx, f_axis=20.0))
    return arms


def build_hands(arms):
    for sx, rings in arms.items():
        inward = -sx
        # 手套护腕：前臂下段外翻一圈
        cuff = []
        for z, dr in ((0.985, 0.004), (0.975, 0.011), (0.93, 0.006), (0.88, 0.003), (0.855, 0.002), (0.84, 0.0)):
            r = at_z(rings, z)
            rr = (r[3] + dr) if z > 0.9 else {0.88: 0.052, 0.855: 0.049, 0.84: 0.046}[z]
            cuff.append([r[0], r[1], r[2], rr, rr, rr, 0.0])
        loft('Gloves', cuff, 20)
        # 护腕上沿缠一圈黑胶带
        tape = []
        for z, rr in ((0.958, 0.0655), (0.962, 0.069), (0.992, 0.064), (0.996, 0.060)):
            r = at_z(rings, z)
            tape.append([r[0], r[1], r[2], rr, rr, rr, 0.0])
        loft('Tape', tape, 20)

        W = Vector(at_z(rings, 0.845)[:3])
        d = (W - Vector(at_z(rings, 0.95)[:3])).normalized()
        palm = []
        for s, th, wd in ((0.0, 0.024, 0.036), (0.03, 0.026, 0.043), (0.07, 0.024, 0.045), (0.095, 0.019, 0.041)):
            p = W + d * s
            palm.append([p.x, p.y, p.z, th, wd, wd, 0.0])
        loft('Gloves', palm, 16, n=2.6, dome1=0.006)

        P = W + d * 0.088
        for yo, f in ((-0.028, 0.95), (-0.009, 1.0), (0.010, 0.95), (0.028, 0.80)):
            fk = []
            # 戴着厚手套的手指要粗短一些，太细像爪子
            for off, r in (((0, 0, 0.012), 0.0125), ((inward * 0.004, 0, -0.026), 0.0125),
                           ((inward * 0.011, 0, -0.05), 0.0115), ((inward * 0.02, 0, -0.068), 0.0100)):
                p = P + Vector((off[0] * f, yo * (1.0 if off[2] > 0 else 1.05), off[2] * f))
                fk.append([p.x, p.y, p.z, r, r, r, 0.0])
            loft('Gloves', spline(fk, 2), 8, dome1=0.006)
        tk = []
        B = W + d * 0.035
        for off, r in (((0, -0.030, 0.0), 0.0125), ((inward * 0.01, -0.046, -0.035), 0.0115),
                       ((inward * 0.022, -0.050, -0.065), 0.0095)):
            p = B + Vector(off)
            tk.append([p.x, p.y, p.z, r, r, r, 0.0])
        loft('Gloves', spline(tk, 2), 8, dome1=0.006)


def build_boots():
    for sx in (1, -1):
        x = sx * 0.150
        shaft = [
            [x, 0.008, 0.060, 0.066, 0.066, 0.070, 0.0],
            [x, 0.008, 0.120, 0.064, 0.064, 0.072, 0.0],
            [x, 0.008, 0.220, 0.067, 0.066, 0.069, 0.0],
            [x, 0.008, 0.330, 0.071, 0.070, 0.072, 0.0],
            [x, 0.008, 0.365, 0.073, 0.072, 0.074, 0.0],
        ]
        loft('Boots', spline(shaft, 2), 20)
        # 靴口胶带：盖住裤腿和靴筒的接缝
        loft('Tape', [[x, 0.008, 0.345, 0.079, 0.079, 0.079, 0], [x, 0.008, 0.350, 0.081, 0.081, 0.081, 0],
                      [x, 0.008, 0.390, 0.081, 0.081, 0.081, 0], [x, 0.008, 0.395, 0.078, 0.078, 0.078, 0]], 20)
        # 鞋头沿 -Y：front 轴朝下，ryf 是下半厚度、ryb 是上半厚度
        foot = [
            [x, 0.085, 0.065, 0.040, 0.035, 0.035, 0],
            [x, 0.055, 0.070, 0.055, 0.052, 0.060, 0],
            [x, 0.000, 0.070, 0.058, 0.055, 0.060, 0],
            [x, -0.070, 0.058, 0.058, 0.042, 0.052, 0],
            [x, -0.130, 0.050, 0.054, 0.035, 0.040, 0],
            [x, -0.175, 0.045, 0.045, 0.028, 0.030, 0],
            [x, -0.200, 0.042, 0.030, 0.020, 0.022, 0],
        ]
        loft('Boots', spline(foot, 2), 18, dome0=0.012, dome1=0.010)
        rbox('Boots', (x, -0.058, 0.016), 0.064, 0.150, 0.016, n=4.0, bevel=0.35, segs=28)


def build_mask():
    ellipsoid('Mask', MC, MRX, MRY, MRZ, segs=24, rings=14)

    # 大视野深色目镜：贴在面罩外的圆角矩形曲面片，前后两层 + 侧壁闭合
    A = acc('Visor')
    nu, nv = 26, 6
    th_half, ph_lo, ph_hi = 1.0, 0.13, 0.70
    phm, phh = (ph_lo + ph_hi) / 2, (ph_hi - ph_lo) / 2

    def uv(i, j, o):
        u = -1 + 2 * i / nu
        k = max(0.15, (1 - abs(u) ** 5) ** 0.2)
        return mask_pt(u * th_half, phm + phh * k * (-1 + 2 * j / nv), o)

    base = {}
    for layer, o in (('f', 0.007), ('b', -0.003)):
        base[layer] = len(A.v)
        for i in range(nu + 1):
            for j in range(nv + 1):
                A.v.append(uv(i, j, o))

    def idx(layer, i, j):
        return base[layer] + i * (nv + 1) + j

    for i in range(nu):
        for j in range(nv):
            for layer, sign in (('f', 1), ('b', -1)):
                q = (idx(layer, i, j), idx(layer, i + 1, j), idx(layer, i + 1, j + 1), idx(layer, i, j + 1))
                cen = sum((A.v[k] for k in q), Vector()) / 4
                add_face_auto(A, q, (cen - MC) * sign)
    border = ([(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] +
              [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)])
    mid = uv(nu // 2, nv // 2, 0.002)
    for k in range(len(border)):
        (i0, j0), (i1, j1) = border[k], border[(k + 1) % len(border)]
        q = (idx('f', i0, j0), idx('f', i1, j1), idx('b', i1, j1), idx('b', i0, j0))
        cen = sum((A.v[t] for t in q), Vector()) / 4
        add_face_auto(A, q, cen - mid, smooth=False)
    # 橡胶镜框
    rim = [uv(i, j, 0.0045) for i, j in border]
    tube_loop('Mask', rim, 0.0055, segs=6, refs=[(p - MC).normalized() for p in rim])

    # 下巴的呼气阀
    p, nrm = mask_pt(0.0, -0.5), mask_nrm(0.0, -0.5)
    cylinder('Mask', p - nrm * 0.01, p + nrm * 0.028, 0.030, 0.027, segs=20, bevel=0.004)
    cylinder('Filter', p + nrm * 0.024, p + nrm * 0.033, 0.021, segs=16, dome1=0.003)

    # 两侧圆形滤罐
    for sx in (1, -1):
        th, ph = sx * 1.2, -0.3
        p, nrm = mask_pt(th, ph), mask_nrm(th, ph)
        cylinder('Filter', p - nrm * 0.005, p + nrm * 0.02, 0.020, segs=16)
        loft('Filter', [[*(p + nrm * 0.016), 0.036, 0.036, 0.036, 0], [*(p + nrm * 0.022), 0.043, 0.043, 0.043, 0],
                        [*(p + nrm * 0.052), 0.043, 0.043, 0.043, 0], [*(p + nrm * 0.058), 0.037, 0.037, 0.037, 0]],
             28, ref=Vector((0, 0, 1)))
        cylinder('Metal', p + nrm * 0.055, p + nrm * 0.0615, 0.024, segs=20, dome1=0.002)

    # 面罩外沿胶带圈（与 y 轴垂直的平面椭圆）
    y = -0.092
    s = math.sqrt(1 - ((y - MC.y) / MRY) ** 2)
    pts = [Vector((math.cos(b) * (MRX * s + 0.004), y, MC.z + math.sin(b) * (MRZ * s + 0.004)))
           for b in (2 * math.pi * i / 40 for i in range(40))]
    tube_loop('Tape', pts, 0.007, segs=6, refs=[Vector((0, 1, 0))] * 40)

    # 两条头带：只绕后脑半圈，两端埋进面罩侧面（整圈的话前半截会从兜帽和面罩之间穿出来）
    for cz, rx, ry, tilt in ((1.685, 0.132, 0.136, math.radians(12)), (1.575, 0.126, 0.134, math.radians(-10))):
        ct, st = math.cos(tilt), math.sin(tilt)
        pts = []
        b0, b1 = -0.8, math.pi + 0.8
        for i in range(31):
            b = b0 + (b1 - b0) * i / 30
            lx, ly = rx * math.cos(b), ry * math.sin(b)
            pts.append(Vector((lx, 0.012 + ly * ct, cz + ly * st)))
        tube_loop('Mask', pts, 0.006, segs=6, refs=[Vector((0, -st, ct))], closed=False)


def build_gear():
    # 腰带：比该高度的躯干（含褶皱上限）略大一圈
    r = at_z(TORSO[::-1], 1.0)
    rx, ryf, ryb = r[3] * 1.02, r[4] * 1.02, r[5] * 1.02
    loft('Belt', [[0, r[1], 0.972, rx + 0.003, ryf + 0.003, ryb + 0.003, 0],
                  [0, r[1], 0.978, rx + 0.008, ryf + 0.008, ryb + 0.008, 0],
                  [0, r[1], 1.022, rx + 0.008, ryf + 0.008, ryb + 0.008, 0],
                  [0, r[1], 1.028, rx + 0.003, ryf + 0.003, ryb + 0.003, 0]], 40, n=2.3)
    rbox('Metal', (0, -(ryf + 0.008) - 0.004, 1.0), 0.030, 0.005, 0.022, n=8.0, bevel=0.4)
    # 右胯挂一个小包
    rbox('Pouch', (-0.150, -0.118, 0.965), 0.036, 0.024, 0.048, n=5.0)
    rbox('Pouch', (-0.150, -0.121, 1.004), 0.038, 0.027, 0.013, n=5.0)

    # 前襟拉链的黑胶带：沿躯干前表面走
    zk = []
    for i in range(15):
        z = 1.44 - (1.44 - 0.87) * i / 14
        y = min(torso_surface_y(z, xx) for xx in (-0.014, 0.0, 0.014)) - 0.002
        zk.append([0, y, z, 0.016, 0.0035, 0.0035, 0])
    loft('Tape', zk, 12, n=6.0, ref=Vector((1, 0, 0)))

    # 左胸小工具包：包身 + 盖 + 挂带
    x, z = 0.085, 1.255
    yb = max(torso_surface_y(z + dz, x + dx) for dz in (-0.05, 0.0, 0.05) for dx in (-0.045, 0.0, 0.045))
    yb = min(yb, torso_surface_y(z, x))
    rbox('Pouch', (x, yb - 0.018, z), 0.048, 0.021, 0.055, n=5.0)
    rbox('Pouch', (x, yb - 0.020, z + 0.047), 0.051, 0.024, 0.014, n=5.0)
    # 挂带只露出包盖上方一小截，太长会像天线
    rbox('Belt', (x, torso_surface_y(z + 0.07, x) - 0.004, z + 0.066), 0.012, 0.006, 0.014, n=6.0)
    rbox('Metal', (x, yb - 0.045, z + 0.035), 0.008, 0.003, 0.006, n=6.0, bevel=0.4, segs=12)


# ---------------------------------------------------------------------------
# 组装、导出、预览
# ---------------------------------------------------------------------------
def build_objects():
    root = bpy.data.objects.new('Hazmat', None)
    bpy.context.scene.collection.objects.link(root)
    total = 0
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    report = []
    for name in MAT_SPECS:
        A = ACC.get(name)
        if not A or not A.f:
            continue
        # 绕 Z 转 180°（朝 +Y）→ glTF 里朝 -Z；纯旋转不改变绕序
        verts = [(-v.x, -v.y, v.z) for v in A.v]
        for v in verts:
            for k in range(3):
                lo[k] = min(lo[k], v[k])
                hi[k] = max(hi[k], v[k])
        me = bpy.data.meshes.new('Hazmat_' + name)
        me.from_pydata(verts, [], A.f)
        me.polygons.foreach_set('use_smooth', A.smooth)
        me.update()
        me.materials.append(MATS[name])
        ob = bpy.data.objects.new('Hazmat_' + name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = root
        tris = sum(len(f) - 2 for f in A.f)
        total += tris
        report.append('%s:%d' % (name, tris))
    print('[hazmat] 三角面', total, ' '.join(report))
    print('[hazmat] 包围盒 min', tuple(round(c, 3) for c in lo), 'max', tuple(round(c, 3) for c in hi))
    return total, lo, hi


def export_glb():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB, export_format='GLB', export_yup=True, export_apply=True,
        export_materials='EXPORT', export_normals=True, export_texcoords=False,
        export_cameras=False, export_lights=False, export_animations=False,
        export_skins=False, export_morph=False, export_extras=False)
    print('[hazmat] 已导出', OUT_GLB, os.path.getsize(OUT_GLB), 'bytes')


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_preview():
    import numpy as np
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except Exception:
        scene.render.engine = 'BLENDER_WORKBENCH'
    try:
        scene.eevee.taa_render_samples = 32
    except Exception:
        pass
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x, scene.render.resolution_y = 600, 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    world = bpy.data.worlds.new('PreviewWorld')
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.42, 0.37, 0.22, 1.0)
        bg.inputs[1].default_value = 0.7

    # 浅黄地面，模拟后室地毯的反光色
    fm = bpy.data.meshes.new('PreviewFloor')
    fm.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new('PreviewFloor', fm)
    scene.collection.objects.link(floor)
    fmat = bpy.data.materials.new('PreviewFloorMat')
    try:
        fmat.use_nodes = True
    except Exception:
        pass
    fmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.55, 0.47, 0.22, 1)
    fm.materials.append(fmat)

    def add_light(kind, loc, energy, size=1.0):
        ld = bpy.data.lights.new('L' + kind, kind)
        ld.energy = energy
        if kind == 'AREA':
            ld.size = size
        lo = bpy.data.objects.new('L' + kind, ld)
        lo.location = loc
        scene.collection.objects.link(lo)
        look_at(lo, (0, 0, 1.0))
        return lo

    add_light('AREA', (1.5, 2.5, 3.2), 900, 2.5)     # 前上方主光（人物朝 +Y）
    add_light('AREA', (-2.5, 1.0, 1.5), 250, 2.0)    # 侧补光
    add_light('AREA', (0.5, -2.5, 2.5), 300, 2.0)    # 轮廓光

    cd = bpy.data.cameras.new('PreviewCam')
    cam = bpy.data.objects.new('PreviewCam', cd)
    scene.collection.objects.link(cam)
    scene.camera = cam

    shots = [((1.35, 3.6, 1.2), (0, 0, 0.9), 50), ((3.9, 0.0, 1.0), (0, 0, 0.9), 50), ((0.45, 1.1, 1.66), (0, -0.02, 1.6), 50)]
    tmp = []
    for i, (loc, tgt, lens) in enumerate(shots):
        cam.location = loc
        cd.lens = lens
        look_at(cam, tgt)
        path = os.path.join(bpy.app.tempdir or HERE, 'hazmat_shot_%d.png' % i)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tmp.append(path)

    arrs = []
    for p in tmp:
        img = bpy.data.images.load(p)
        w, h = img.size
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        arrs.append(a.reshape(h, w, 4))
    out_arr = np.concatenate(arrs, axis=1)
    out = bpy.data.images.new('hazmat_preview', out_arr.shape[1], out_arr.shape[0], alpha=True)
    out.pixels.foreach_set(out_arr.ravel())
    out.filepath_raw = OUT_PNG
    out.file_format = 'PNG'
    out.save()
    for p in tmp:
        try:
            os.remove(p)
        except OSError:
            pass
    print('[hazmat] 预览', OUT_PNG)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    arms = build_suit()
    build_hands(arms)
    build_boots()
    build_mask()
    build_gear()
    total, lo, hi = build_objects()
    if not (6000 <= total <= 20000):
        print('[hazmat] 警告：三角面数不在 6k–20k 范围内', total)
    export_glb()
    if '--no-preview' not in sys.argv:
        render_preview()


main()
