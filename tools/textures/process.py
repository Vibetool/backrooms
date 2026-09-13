#!/usr/bin/env python3
"""把 tools/textures/raw/<名字>.png 做成可平铺贴图 assets/tex/<名字>.jpg。

可重复运行：只读原图，覆盖输出。用法：python3 tools/textures/process.py [名字...]

无缝做法（比"错位半张 + 羽化"干净：羽化会把两份不相干的纹理叠成重影）：
  1. 二次曲面拟合去掉整体明暗渐变 —— 生成图常带暗角，平铺后会变成一块块的格子感。
  2. 横向：把图卷动 s 像素得到 R（R 的左右边天然接得上，接缝跑到图内第 s 列）。
     s 取在半宽附近、让高通亮度自相关最大的值 —— 墙纸这类规律花纹，卷动量正好是花纹周期的整数倍，
     R 和原图花纹对齐，拼接处不会错位。
  3. 在原图与 R 之间用动态规划找两条差异最小的竖向切割线，中间用原图、两边用 R。
     拆成高低两个频段分别过渡：细节沿切线 3px 硬切（不重影），低频亮度 60px 缓变（不留明暗台阶）。
  4. 转置后对纵向做同样的事；这一步的切割线必须首尾同行，否则会破坏第 3 步做好的左右无缝。
  5. 地毯/水泥再做一次低频"去条带"和"大尺度对比压缩"，减轻平铺后一眼看出的重复格子。
     模糊全用 FFT（天然回绕），这些步骤不会破坏无缝。
  6. 缩放前按回绕补边，避免 Lanczos 在边缘夹取造成 1 像素接缝。
颜色在 Lab 空间把均值拉到目标值，只挪均值、保留纹理起伏：
  主页要"明显的黄色"墙和"浅黄色"地板/天花板（用户原话），生成图的色相不能靠运气。
"""
import os
import sys
import zlib

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(ROOT, "assets", "tex")

# mean_rgb: 目标平均色（sRGB）；chroma: 色度起伏缩放
# kind: tile 普通无缝材质 / ceiling 无缝砖面 + 程序画龙骨 / panel 单块灯板
# destripe: 去掉整列/整行的低频明暗条带；soften: 大尺度（~50px）明暗起伏压掉的比例
SPEC = {
    # periodic: 先把菱形/竖条花纹重采样成整数个周期，再做无缝
    "wallpaper_l0": dict(src="wallpaper_l0", size=512, kind="tile", mean_rgb=(214, 186, 84), chroma=1.0,
                         periodic=True),
    "carpet_l0": dict(src="carpet_l0", size=512, kind="tile", mean_rgb=(142, 121, 86), chroma=0.9,
                      destripe=True, soften=0.35),
    "carpet_light": dict(src="carpet_light", size=512, kind="tile", mean_rgb=(236, 219, 150), chroma=1.0,
                         destripe=True),
    "ceiling_tile": dict(src="ceiling_tile", size=512, kind="ceiling", mean_rgb=(222, 214, 192), chroma=1.0,
                         bar=(236, 233, 224)),
    # 主页天花板：同一张砖面原图调成浅黄，不额外花一次生成
    "ceiling_light": dict(src="ceiling_tile", size=512, kind="ceiling", mean_rgb=(240, 226, 168), chroma=1.2,
                          bar=(245, 237, 206)),
    "light_panel": dict(src="light_panel", size=256, kind="panel"),
    "concrete": dict(src="concrete", size=512, kind="tile", mean_rgb=(132, 130, 126), chroma=0.6,
                     destripe=True),
    "concrete_wet": dict(src="concrete_wet", size=512, kind="tile", mean_rgb=(92, 90, 87), chroma=0.6,
                         destripe=True, soften=0.3),
    # Level 3：积灰棕色砖墙（environment.materials「积灰的棕色砖墙」）
    "l3_brick_brown": dict(src="l3_brick_brown", size=512, kind="tile", mean_rgb=(112, 90, 74), chroma=0.8,
                           destripe=True, soften=0.25),
    # Level 3：积灰灰色瓷砖地板（environment.materials「积灰的灰色瓷砖地板」），规律花纹走 periodic
    "l3_tile_gray": dict(src="l3_tile_gray", size=512, kind="tile", mean_rgb=(146, 145, 140), chroma=0.5,
                         periodic=True, destripe=True),
    # Level 5：主厅/贝弗莉室的红木色配金色墙纸（environment.materials「墙纸为红木色和金色」），规律花纹走 periodic
    "l5_wallpaper_hotel": dict(src="l5_wallpaper_hotel", size=512, kind="tile", mean_rgb=(112, 40, 34), chroma=1.0,
                               periodic=True),
    # Level 5：贝弗莉室小桌旁「红金色地毯」（environment.materials），花纹不规则走 destripe+soften
    "l5_carpet_hotel": dict(src="l5_carpet_hotel", size=512, kind="tile", mean_rgb=(150, 78, 46), chroma=1.0,
                            destripe=True, soften=0.3),
    # Level 11：城市层公寓/办公楼外立面，规律窗格走 periodic（environment.architecture「灰色公寓楼布满小窗」）
    "l11_apartment_windows": dict(src="l11_apartment_windows", size=512, kind="tile", mean_rgb=(146, 144, 138),
                                  chroma=0.7, periodic=True),
    # Level 8：天然岩洞岩壁/地面（materials「天然岩石与矿物（岩种未写，unverified）」）——颜色未定，取中性暖灰褐天然岩石；
    # 随机纹理不规律花纹，走 destripe+soften
    "l8_cave_rock": dict(src="l8_cave_rock", size=512, kind="tile", mean_rgb=(96, 88, 78), chroma=0.65,
                         destripe=True, soften=0.3),
    # Level 10：农田土壤基底（environment.materials「土壤约 1 米厚、轻微疏水」，没给颜色，取常见耕地深褐色，unverified）；
    # 随机纹理不规律花纹，走 destripe+soften
    "l10_soil": dict(src="l10_soil", size=512, kind="tile", mean_rgb=(112, 90, 64), chroma=0.55,
                     destripe=True, soften=0.35),
    # Level 13：走廊涂漆石膏墙（environment.colors「走廊漆成暗淡的白色或米色」）；随机纹理走 destripe+soften，256 省包体
    "l13_wall_plaster": dict(src="l13_wall_plaster", size=256, kind="tile", mean_rgb=(198, 188, 165), chroma=0.55,
                             destripe=True, soften=0.3),
    # Level 13：走廊层压木/油毡地面（environment.materials「层压木或油毡，未区分墙或地」，取地面用途、暖褐色磨损地板）
    "l13_floor_linoleum": dict(src="l13_floor_linoleum", size=256, kind="tile", mean_rgb=(150, 128, 96), chroma=0.6,
                               destripe=True, soften=0.3),
    # Level 16 文件1（雨林形态）地面：architecture「类似现实热带雨林的生态系统」，没有给具体地表颜色（unverified），
    # 按典型雨林地被（湿土、落叶、苔藓）取暗绿褐色；随机纹理走 destripe+soften
    "l16_moss_ground": dict(src="l16_moss_ground", size=256, kind="tile", mean_rgb=(58, 64, 40), chroma=0.7,
                            destripe=True, soften=0.3),
    # Level 16 文件2（冰原形态）地面：materials「冰（表面发光且反射率高）」——用偏白偏蓝色调表现高反射感，
    # 随机裂纹纹理走 destripe+soften
    "l16_ice_surface": dict(src="l16_ice_surface", size=256, kind="tile", mean_rgb=(206, 219, 230), chroma=0.5,
                            destripe=True, soften=0.25),
    # Level 14：走廊石膏墙（配图观察 Level14picture2，非原文文字——同一 fandom 页面配图，米色/桃色墙面）；
    # 随机纹理走 destripe+soften，256 省包体
    "l14_wall_hospital": dict(src="l14_wall_hospital", size=256, kind="tile", mean_rgb=(196, 168, 152), chroma=0.7,
                              destripe=True, soften=0.45),
    # Level 14：走廊反光地胶+红色标记（配图观察 Level14picture2，非原文文字——浅色反光地胶、红色标记线）
    "l14_floor_hospital": dict(src="l14_floor_hospital", size=256, kind="tile", mean_rgb=(176, 172, 166), chroma=0.6,
                               destripe=True, soften=0.25),
    # Level 15：墙壁/天花板白色钢管上的花纹（materials「白色钢管，部分钢管上有看起来像蔓藤花纹的符号，
    # 目前仍不清楚代表什么」）——低对比度浮雕纹样，256 省包体
    "l15_pipe_glyph": dict(src="l15_pipe_glyph", size=256, kind="tile", mean_rgb=(225, 224, 219), chroma=0.35,
                           destripe=True, soften=0.2),
    # Level 19：阁楼老旧地板（materials「地面由粉色绝缘材料和地板组合而成，地板嘎嘎作响」）——
    # 木纹随机纹理走 destripe+soften，256 省包体（粉色绝缘材料另用顶点色小色块表现，不占贴图预算）
    "l19_floor_attic": dict(src="l19_floor_attic", size=256, kind="tile", mean_rgb=(107, 90, 71), chroma=0.7,
                            destripe=True, soften=0.3),
    # Level 19：验收 medium#4 指出格线矮墙原来是无贴图纯色、像"灰白隔板"——补一张竖排旧木板墙面，
    # 跟地板同一套棕调；木板缝走 destripe，去掉生成图自带的明暗渐变
    "l19_wall_attic": dict(src="l19_wall_attic", size=256, kind="tile", mean_rgb=(74, 60, 45), chroma=0.7,
                           destripe=True, soften=0.25),
    # Level 18：幼儿园/日托所记忆场景的墙面（architecture「最常见的外观是幼儿园或日托所」，
    # 原文没给材质颜色，按幼儿园常见的薄荷绿墙面+矮处手绘图案取值，unverified）；
    # 矮处一排图案是规律重复花纹走 periodic，其余走 destripe+soften 去掉生成图自带的明暗渐变
    "l18_wall_nursery": dict(src="l18_wall_nursery", size=256, kind="tile", mean_rgb=(176, 205, 182), chroma=0.75,
                             periodic=True, destripe=True, soften=0.2),
    # Level !（选中版本 wikidot-cn）：起始之室之后、走廊两侧的墙（materials「现场灰尘很厚，像非常老的建筑」
    # 「墙上有划痕」）——积灰的浅灰褐墙面 + 不规则抓痕，随机纹理走 destripe+soften，256 省包体
    "lrun_wall_scratched": dict(src="lrun_wall_scratched", size=256, kind="tile", mean_rgb=(158, 148, 132), chroma=0.5,
                                destripe=True, soften=0.3),
}
JPEG_QUALITY = 82


# ---------------- 颜色 ----------------
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):  # rgb 0..1
    xyz = srgb_to_linear(rgb) @ _M.T / _WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * _WHITE
    return linear_to_srgb(xyz @ np.linalg.inv(_M).T)


def grade(img, mean_rgb, chroma=1.0):
    """Lab 均值对齐到目标色；chroma 缩放色度起伏（水泥压低彩色噪点，浅黄天花板略微提一点）"""
    lab = rgb_to_lab(img)
    target = rgb_to_lab(np.array(mean_rgb, float) / 255.0)
    mean = lab.reshape(-1, 3).mean(0)
    out = lab.copy()
    out[..., 0] = lab[..., 0] - mean[0] + target[0]
    out[..., 1:] = (lab[..., 1:] - mean[1:]) * chroma + target[1:]
    return np.clip(lab_to_rgb(out), 0, 1)


def luminance(img):
    return img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114


# ---------------- 滤波 ----------------
def blur(a, sigma):
    """FFT 高斯模糊：天然按回绕处理边界，对可平铺图不会在边上引入接缝；浮点无量化误差"""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    if a.ndim == 3:
        return np.stack([np.fft.irfft2(np.fft.rfft2(a[..., c]) * g, s=(h, w)) for c in range(a.shape[2])], -1)
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=(h, w))


def blur1d(v, sigma):
    f = np.fft.rfftfreq(len(v))
    return np.fft.irfft(np.fft.rfft(v) * np.exp(-2 * (np.pi * sigma * f) ** 2), n=len(v))


def detect_period(prof, lo=20, min_corr=0.25):
    """一维亮度剖面的花纹周期（像素，浮点）；不够规律返回 None"""
    p = prof - blur1d(prof, 24)
    p = p - p.mean()
    n = len(p)
    ac = np.correlate(p, p, "full")[n - 1:] / np.arange(n, 0, -1)   # 按重叠长度归一
    ac = ac / max(ac[0], 1e-12)
    # 从第一次过零之后找：之前是中心主瓣（花纹自身宽度造成的），不是周期
    neg = np.where(ac[1:] <= 0)[0]
    if not len(neg):
        return None
    z = max(lo, int(neg[0]) + 1)
    peaks = [L for L in range(z, n // 3) if ac[L] > ac[L - 1] and ac[L] >= ac[L + 1]]
    if not peaks:
        return None
    vmax = max(ac[L] for L in peaks)
    if vmax < min_corr:
        return None
    # 取够强的最短周期：竖条+菱形错半格时，半周期峰明显弱于整周期峰，不会被误选
    base = next(L for L in peaks if ac[L] >= 0.7 * vmax)
    # 在最远的整数倍峰上细化，误差被倍数摊薄
    m = max(1, (n // 2) // base)
    lag, win = m * base, max(2, base // 4)
    j = lag - win + int(np.argmax(ac[lag - win:lag + win + 1]))
    y0, y1, y2 = ac[j - 1], ac[j], ac[j + 1]
    den = y0 - 2 * y1 + y2
    return (j + (0.5 * (y0 - y2) / den if den != 0 else 0.0)) / m


def fit_integer_periods(img):
    """规律花纹（墙纸）重采样成整数个周期正好占满全图。
    否则 1024/周期 不是整数时，回绕处花纹相位必然错开：卷动后跨过边界的那一半和没跨的那一半
    差出小数个周期，怎么切都会出现半截菱形、缺一行或多一行。"""
    h, w = img.shape[:2]
    lum = luminance(img)
    hp = lum - blur(lum, 12)
    box = [0.0, 0.0, float(w), float(h)]
    info = []
    for axis, prof, n in ((0, hp.mean(0), w), (1, hp.mean(1), h)):
        p = detect_period(prof)
        if p is None:
            info.append(None)
            continue
        k = int(n // p)
        start = (n - k * p) / 2
        box[axis], box[axis + 2] = start, start + k * p
        info.append((round(float(p), 2), k))
    im = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8))
    return np.asarray(im.resize((w, h), Image.LANCZOS, box=tuple(box)), float) / 255, info


def flatten_lighting(img):
    """二次曲面拟合亮度大趋势再除掉；只去暗角/偏光，水渍这类中尺度细节保留"""
    h, w = img.shape[:2]
    small = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((64, 64), Image.BILINEAR), float) / 255
    lum = luminance(small) + 1e-3
    yy, xx = np.mgrid[0:64, 0:64] / 63.0 - 0.5
    basis = np.stack([np.ones_like(xx), xx, yy, xx * xx, yy * yy, xx * yy], -1).reshape(-1, 6)
    coef, *_ = np.linalg.lstsq(basis, lum.reshape(-1), rcond=None)
    yy, xx = np.mgrid[0:h, 0:w]
    xx = xx / (w - 1) - 0.5
    yy = yy / (h - 1) - 0.5
    surf = coef[0] + coef[1] * xx + coef[2] * yy + coef[3] * xx * xx + coef[4] * yy * yy + coef[5] * xx * yy
    surf = np.maximum(surf, 1e-3)
    return np.clip(img * (surf.mean() / surf)[..., None], 0, 1)


def destripe(img, sigma=4.0):
    """整列/整行平均亮度的低频起伏（生成图常见的竖向色带）除掉；
    sigma 小于地毯绒线间距，绒线这种高频竖纹保留"""
    out = img.copy()
    for axis in (0, 1):
        prof = luminance(out).mean(axis=axis)
        low = blur1d(prof, sigma)
        gain = prof.mean() / np.maximum(low, 1e-3)
        out = out * (gain[None, :, None] if axis == 0 else gain[:, None, None])
    return np.clip(out, 0, 1)


def soften_low(img, k, sigma=24.0):
    """压掉 k 比例的大尺度明暗/色块起伏：平铺后大污渍每格重复一次最显眼"""
    mean = img.reshape(-1, 3).mean(0)
    return np.clip(img - k * (blur(img, sigma) - mean), 0, 1)


# ---------------- 无缝 ----------------
def best_shift(lum, lo=0.38, hi=0.62):
    """横向卷动量：高通亮度的自相关峰值（有周期花纹时对齐花纹，随机纹理时落在中间附近）"""
    hp = lum - blur(lum, 6)
    hp = hp - hp.mean()
    row_spec = np.fft.fft(hp, axis=1)
    ac = np.real(np.fft.ifft(row_spec * np.conj(row_spec), axis=1)).sum(0)
    w = lum.shape[1]
    a, b = int(w * lo), int(w * hi)
    return a + int(np.argmax(ac[a:b]))


def dp_path(cost, fixed=None):
    """cost: (步数, 带宽)。每步最多横移 1。fixed 给定时起点和终点都锁在同一列（用于首尾回绕）"""
    n, bw = cost.shape
    acc = cost[0].copy()
    if fixed is not None:
        acc = np.full(bw, np.inf)
        acc[fixed] = cost[0, fixed]
    back = np.zeros((n, bw), np.int8)
    idx = np.arange(bw)
    for i in range(1, n):
        left = np.concatenate([[np.inf], acc[:-1]])
        right = np.concatenate([acc[1:], [np.inf]])
        stack = np.stack([left, acc, right])
        k = np.argmin(stack, axis=0)
        acc = cost[i] + stack[k, idx]
        back[i] = k - 1
    end = int(np.argmin(acc)) if fixed is None else fixed
    path = np.empty(n, int)
    path[-1] = end
    for i in range(n - 1, 0, -1):
        path[i - 1] = path[i] + back[i, path[i]]
    return path


def seam_pass_x(img, cyclic, band_frac=0.08, feather=3.0, wide=60.0, split_sigma=8.0):
    """让 img 左右可平铺，返回 (新图, 卷动量)"""
    h, w = img.shape[:2]
    s = best_shift(luminance(img))
    rolled = np.roll(img, s, axis=1)             # rolled[:, x] = img[:, x - s]，接缝在第 s 列
    diff = ((blur(img, 1.2) - blur(rolled, 1.2)) ** 2).sum(2)
    band = int(w * band_frac)
    xs = np.arange(w)[None, :]
    m_hi = np.ones((h, w))                       # 1 = 用原图
    m_lo = np.ones((h, w))
    # 原图区间要盖住 rolled 的接缝(第 s 列)，rolled 区间要盖住原图的回绕边(第 0 列)
    for center, side in ((s // 2, +1), ((s + w) // 2, -1)):
        lo = center - band
        cost = diff[:, lo:center + band]
        path = dp_path(cost)
        if cyclic:
            path = dp_path(cost, fixed=int(path[-1]))
        d = (xs - (path + lo)[:, None]) * side
        m_hi *= np.clip(d / (2 * feather) + 0.5, 0, 1)
        t = np.clip(d / (2 * wide) + 0.5, 0, 1)
        m_lo *= t * t * (3 - 2 * t)
    # FFT 模糊满足 blur(roll(x)) == roll(blur(x))，低频两份严格对应
    low = blur(img, split_sigma)
    low_r = np.roll(low, s, axis=1)
    m_hi = m_hi[..., None]
    m_lo = m_lo[..., None]
    out = low * m_lo + low_r * (1 - m_lo) + (img - low) * m_hi + (rolled - low_r) * (1 - m_hi)
    return np.clip(out, 0, 1), s


def make_seamless(img):
    img, sx = seam_pass_x(img, cyclic=False)
    t, sy = seam_pass_x(img.transpose(1, 0, 2), cyclic=True)
    return t.transpose(1, 0, 2), (sx, sy)


def resize_tileable(img, size):
    """回绕补边再缩放、再裁掉，边缘像素的滤波核也能看到对边内容"""
    h = img.shape[0]
    pad = h // 16
    padded = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode="wrap")
    scale = size / h
    ps = int(round(padded.shape[0] * scale))
    im = Image.fromarray((np.clip(padded, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((ps, ps), Image.LANCZOS)
    p = int(round(pad * scale))
    return np.asarray(im, float)[p:p + size, p:p + size] / 255


def seam_error(img):
    """平铺接缝处与图内部的相邻像素差之比，≈1 说明接缝不比普通相邻像素更突兀
    （规则花纹恰好压在边上时会偏大，要结合看图判断）"""
    inner_x = np.abs(np.diff(img, axis=1)).mean()
    inner_y = np.abs(np.diff(img, axis=0)).mean()
    edge_x = np.abs(img[:, 0] - img[:, -1]).mean()
    edge_y = np.abs(img[0] - img[-1]).mean()
    return edge_x / inner_x, edge_y / inner_y


# ---------------- 天花板龙骨 ----------------
def draw_ceiling_grid(img, bar_rgb, seed):
    """一张图 = 2×2 块 60cm 砖。龙骨中心压在第 0 列和中线上，宽度对称，平铺后正好接成完整龙骨"""
    rng = np.random.default_rng(seed)
    s = img.shape[0]
    half = s // 2
    out = img.copy()
    # 每块砖旧化程度略有不同；差太多会像棋盘格
    for ty in range(2):
        for tx in range(2):
            out[ty * half:(ty + 1) * half, tx * half:(tx + 1) * half] *= rng.uniform(0.982, 1.018)
    w = max(3, round(s / 56))   # 512 → 9px ≈ 2.1cm，接近真实 T 型龙骨宽度
    hw = w // 2
    shadow = max(2, round(s / 200))
    idx = np.arange(s)
    d1 = np.minimum(np.minimum(idx, s - idx), np.abs(idx - half))
    d = np.minimum(d1[None, :], d1[:, None])
    # 砖面比龙骨凹进去一点：紧贴龙骨的一圈发暗
    shade = np.where(d <= hw, 1.0, 1.0 - 0.22 * np.clip(1 - (d - hw - 0.5) / shadow, 0, 1))
    out *= shade[..., None]
    bar = np.array(bar_rgb, float) / 255
    on_bar = d <= hw
    # 龙骨本身：中间一条高光，两侧略暗，像喷漆金属的倒角
    prof = 1.0 + 0.05 * np.cos(np.clip(d / max(hw, 1), 0, 1) * np.pi)
    grain = 1 + rng.normal(0, 0.012, (s, s))
    bar_img = np.clip(bar[None, None, :] * (prof * grain)[..., None], 0, 1)
    out[on_bar] = bar_img[on_bar]
    return np.clip(out, 0, 1)


# ---------------- 灯板 ----------------
def process_panel(img, size):
    """裁出发光面板外框（生成图基本已经撑满，这里只防周围带一圈天花板），再提亮偏冷"""
    lum = luminance(img)
    thr = np.percentile(lum, 35)
    rows = np.where((lum > thr).mean(1) > 0.5)[0]
    cols = np.where((lum > thr).mean(0) > 0.5)[0]
    h, w = lum.shape
    y0, y1 = (rows[0], rows[-1] + 1) if len(rows) else (0, h)
    x0, x1 = (cols[0], cols[-1] + 1) if len(cols) else (0, w)
    side = min(max(y1 - y0, x1 - x0), h, w)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    y0 = int(np.clip(cy - side // 2, 0, h - side))
    x0 = int(np.clip(cx - side // 2, 0, w - side))
    crop = img[y0:y0 + side, x0:x0 + side]
    im = Image.fromarray((crop * 255 + 0.5).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    out = np.asarray(im, float) / 255
    # 日光灯是冷白：去掉生成图里偏米黄的色调
    lum = luminance(out)[..., None]
    out = lum + (out - lum) * 0.45
    # 灯板贴在自发光面片上，要够亮：90 分位推到 0.98，再把中间调整体抬起来
    p90 = np.percentile(luminance(out), 90)
    out = np.clip(out * (0.98 / max(p90, 1e-3)), 0, 1)
    out = 1 - (1 - out) ** 1.5
    return np.clip(out, 0, 1), (int(x0), int(y0), int(side))


def save_jpg(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def process(name):
    spec = SPEC[name]
    src = os.path.join(RAW, spec["src"] + ".png")
    if not os.path.exists(src):
        print(f"[{name}] 没有原图 {src}，跳过")
        return None
    img = np.asarray(Image.open(src).convert("RGB"), float) / 255
    if img.shape[0] != img.shape[1]:
        side = min(img.shape[:2])
        img = img[:side, :side]
    dest = os.path.join(OUT, name + ".jpg")

    if spec["kind"] == "panel":
        out, box = process_panel(img, spec["size"])
        save_jpg(out, dest)
        print(f"[{name}] 裁切 {box} → {spec['size']}px，均值亮度 {luminance(out).mean():.2f}，"
              f"{os.path.getsize(dest) // 1024} KB")
        return dest

    periods = None
    if spec.get("periodic"):
        img, periods = fit_integer_periods(img)
    img = flatten_lighting(img)
    if spec.get("mean_rgb"):
        img = grade(img, spec["mean_rgb"], spec.get("chroma", 1.0))
    img, shifts = make_seamless(img)
    if periods:
        print(f"[{name}] 花纹周期(像素, 个数) x={periods[0]} y={periods[1]}")
    if spec.get("destripe"):
        img = destripe(img)
    if spec.get("soften"):
        img = soften_low(img, spec["soften"])
    out = resize_tileable(img, spec["size"])
    if spec["kind"] == "ceiling":
        # crc32 固定种子：Python 的 hash() 每次进程启动都变，重跑结果会不一样
        out = draw_ceiling_grid(out, spec["bar"], seed=zlib.crc32(name.encode()))
    save_jpg(out, dest)
    final = np.asarray(Image.open(dest), float) / 255
    ex, ey = seam_error(final)
    mean = (final.reshape(-1, 3).mean(0) * 255).round().astype(int).tolist()
    print(f"[{name}] 卷动 {shifts}，接缝/内部差异比 x={ex:.2f} y={ey:.2f}，均值 {mean}，"
          f"{os.path.getsize(dest) // 1024} KB")
    return dest


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(SPEC)
    for n in names:
        if n not in SPEC:
            print(f"未知贴图 {n}")
            continue
        process(n)
    all_size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".jpg"))
    print(f"assets/tex 下 jpg 合计 {all_size // 1024} KB（预算 1200 KB）")


if __name__ == "__main__":
    main()
