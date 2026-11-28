# -*- coding: utf-8 -*-
"""High-fidelity HOME screen mockup using real assets, copy and layout params.
Mirrors app/(tabs)/index.tsx + app/(tabs)/_layout.tsx:
  - landscape scene background, resizeMode=contain, SCENE_SHIFT_Y=0
  - right content column width 52% (max 560), cards: premium/clone/rec/level/actions
  - tab bar 6 items, height 56 in landscape, bg #FFF8F0, active #F2827F
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(BASE, "..", ".."))
SCENE = os.environ.get("MOCKUP_SCENE") or os.path.join(ROOT, "assets", "scenes", "scene_home_with_racco.png")
FONT = "C:/Windows/Fonts/msyh.ttc"
EMOJI = "C:/Windows/Fonts/seguiemj.ttf"


def font(sz, bold=False):
    path = "C:/Windows/Fonts/msyhbd.ttc" if bold else FONT
    try:
        return ImageFont.truetype(path, sz)
    except Exception:
        return ImageFont.truetype(FONT, sz)


def is_emoji(ch):
    o = ord(ch)
    return (0x1F000 <= o <= 0x1FAFF) or (0x2600 <= o <= 0x27BF) or o in (0x2B50, 0x23F8, 0xFE0F, 0x200D)


def text(d, xy, s, sz, fill, bold=False):
    """Mixed CJK + emoji drawing: emoji glyphs use the color emoji font."""
    x, y = xy
    f_cjk = font(sz, bold)
    f_emo = font(sz)
    i = 0
    while i < len(s):
        if is_emoji(s[i]):
            j = i + 1
            while j < len(s) and (is_emoji(s[j]) or s[j] in "\ufe0f\u200d"):
                j += 1
            seq = s[i:j]
            try:
                fe = ImageFont.truetype(EMOJI, sz)
                d.text((x, y), seq, font=fe, fill=fill, embedded_color=True)
                x += d.textlength(seq, font=fe)
            except Exception:
                d.text((x, y), seq, font=f_cjk, fill=fill)
                x += d.textlength(seq, font=f_cjk)
            i = j
        else:
            d.text((x, y), s[i], font=f_cjk, fill=fill)
            x += d.textlength(s[i], font=f_cjk)
            i += 1


# palette (candy theme)
TEXT = (61, 50, 41)
SUB = (122, 106, 93)
CREAM_BG = (253, 249, 243)
TAB_BG = (255, 248, 240)
TAB_ACTIVE = (242, 130, 127)
TAB_INACTIVE = (189, 189, 189)
PURPLE = (155, 126, 222)
PURPLE_SOFT = (226, 216, 251)
ORANGE = (247, 160, 114)
ORANGE_SOFT = (255, 217, 194)
LEMON_SOFT = (255, 239, 194)
MINT_SOFT = (210, 242, 230)
WHITE = (255, 255, 255)

TABS = ["首页", "创作", "故事库", "我的故事", "我的创作", "设置"]
TAB_EMOJI = ["🏠", "⭐", "📖", "🏆", "🎙️", "⚙️"]


def fit_contain(img, w, h):
    s = min(w / img.width, h / img.height)
    return img.resize((round(img.width * s), round(img.height * s)), Image.Resampling.LANCZOS)


def rr(d, box, radius, fill):
    d.rounded_rectangle(box, radius=radius, fill=fill)


def shadow_card(canvas, box, radius, fill=(255, 255, 255), blur=10):
    pad = 6
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((box[0], box[1] + 3, box[2], box[3] + 4), radius=radius, fill=(120, 90, 70, 46))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(layer)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, fill=fill)
    return d


def draw_home(sw, sh, label):
    S = 2
    W, H = sw * S, sh * S
    im = Image.new("RGBA", (W, H), CREAM_BG + (255,))

    scene = fit_contain(Image.open(SCENE).convert("RGB"), W, H)
    im.alpha_composite(scene.convert("RGBA"), ((W - scene.width) // 2, (H - scene.height) // 2))

    d = ImageDraw.Draw(im, "RGBA")
    tab_h = int(56 * S)
    content_top = int(10 * S)
    col_w = min(int(W * 0.52), 560 * S)
    col_x1 = W - 18 * S
    col_x0 = col_x1 - col_w
    inner_pad = 14 * S

    text(d, (col_x0 + inner_pad, content_top + 6 * S), "下午好呀，宝贝！✨", 28 * S, TEXT + (255,), True)

    y = content_top + 52 * S
    box = (col_x0, y, col_x1, y + 92 * S)
    d = shadow_card(im, box, 22 * S, PURPLE_SOFT + (255,))
    d = ImageDraw.Draw(im, "RGBA")
    text(d, (box[0] + 16 * S, box[1] + 12 * S), "💎", 30 * S, TEXT + (255,))
    text(d, (box[0] + 58 * S, box[1] + 12 * S), "升级会员，解锁全部功能", 17 * S, TEXT + (255,), True)
    text(d, (box[0] + 58 * S, box[1] + 38 * S), "更多 AI 故事、声音克隆，旅行打卡每天不设限。", 12 * S, SUB + (255,))
    cta = (box[2] - 88 * S, box[1] + 30 * S, box[2] - 12 * S, box[1] + 64 * S)
    rr(d, cta, 22 * S, PURPLE + (255,))
    text(d, (cta[0] + 12 * S, cta[1] + 8 * S), "查看方案", 13 * S, WHITE + (255,), True)
    y = box[3] + 12 * S

    box = (col_x0, y, col_x1, y + 128 * S)
    d = shadow_card(im, box, 24 * S, WHITE + (255,))
    d = ImageDraw.Draw(im, "RGBA")
    text(d, (box[0] + 16 * S, box[1] + 12 * S), "🎙 克隆你的声音", 18 * S, TEXT + (255,), True)
    text(d, (box[0] + 16 * S, box[1] + 44 * S), "录下你的声音，每晚都由你来给宝贝讲故事，", 13 * S, SUB + (255,))
    text(d, (box[0] + 16 * S, box[1] + 64 * S), "陪不在身边的宝贝安心入睡。", 13 * S, SUB + (255,))
    cta = (box[0] + 16 * S, box[1] + 88 * S, box[0] + 96 * S, box[1] + 120 * S)
    rr(d, cta, 22 * S, PURPLE + (255,))
    text(d, (cta[0] + 20 * S, cta[1] + 7 * S), "去克隆", 13 * S, WHITE + (255,), True)
    y = box[3] + 12 * S

    box = (col_x0, y, col_x1, y + 100 * S)
    d = shadow_card(im, box, 22 * S, WHITE + (255,))
    d = ImageDraw.Draw(im, "RGBA")
    rr(d, (box[0], box[1] + 14 * S, box[0] + 6 * S, box[3] - 14 * S), 3 * S, ORANGE + (255,))
    rr(d, (box[0] + 14 * S, box[1] + 16 * S, box[0] + 76 * S, box[3] - 16 * S), 18 * S, ORANGE_SOFT + (255,))
    text(d, (box[0] + 30 * S, box[1] + 30 * S), "🐰", 34 * S, TEXT + (255,))
    text(d, (box[0] + 90 * S, box[1] + 18 * S), "✨ 今日推荐", 14 * S, ORANGE + (255,), True)
    text(d, (box[0] + 90 * S, box[1] + 40 * S), "小白兔的月亮船", 17 * S, TEXT + (255,), True)
    text(d, (box[0] + 90 * S, box[1] + 66 * S), "童话 · 8 分钟", 12 * S, SUB + (255,))
    text(d, (box[2] - 50 * S, box[1] + 34 * S), "🔊", 26 * S, TEXT + (255,))
    y = box[3] + 12 * S

    box = (col_x0, y, col_x1, y + 74 * S)
    d = shadow_card(im, box, 20 * S, WHITE + (255,))
    d = ImageDraw.Draw(im, "RGBA")
    text(d, (box[0] + 16 * S, box[1] + 12 * S), "🌟 阅读小达人  Lv.3", 15 * S, TEXT + (255,), True)
    rr(d, (box[0] + 16 * S, box[1] + 44 * S, box[2] - 16 * S, box[1] + 54 * S), 6 * S, (240, 232, 220, 255))
    rr(d, (box[0] + 16 * S, box[1] + 44 * S, box[0] + int((box[2] - box[0] - 32 * S) * 0.62), box[1] + 54 * S), 6 * S, ORANGE + (255,))
    y = box[3] + 12 * S

    acts = [("📖", "听一个故事", LEMON_SOFT), ("⭐", "创作新故事", PURPLE_SOFT), ("⛺", "旅行打卡", MINT_SOFT)]
    aw = (col_w - 2 * 8 * S) // 3
    for i, (emoji, txt, tone) in enumerate(acts):
        ax0 = col_x0 + i * (aw + 8 * S)
        box = (ax0, y, ax0 + aw, y + 92 * S)
        d = shadow_card(im, box, 20 * S, tone + (255,), blur=6)
        d = ImageDraw.Draw(im, "RGBA")
        text(d, (ax0 + aw // 2 - 18 * S, box[1] + 14 * S), emoji, 34 * S, TEXT + (255,))
        text(d, (ax0 + aw // 2 - len(txt) * 7 * S, box[1] + 58 * S), txt, 12 * S, TEXT + (255,), True)
    y = box[3] + 14 * S

    text(d, (col_x0 + inner_pad, y), "最近的故事", 17 * S, TEXT + (255,), True)
    y += 30 * S
    box = (col_x0, y, col_x1, y + 62 * S)
    d = shadow_card(im, box, 18 * S, WHITE + (255,), blur=6)
    d = ImageDraw.Draw(im, "RGBA")
    text(d, (box[0] + 16 * S, box[1] + 12 * S), "🌍", 26 * S, TEXT + (255,))
    text(d, (box[0] + 54 * S, box[1] + 10 * S), "龟兔赛跑", 14 * S, TEXT + (255,), True)
    text(d, (box[0] + 54 * S, box[1] + 32 * S), "伊索寓言 · 已听完", 11 * S, SUB + (255,))

    tab_top = H - tab_h
    d.rectangle((0, tab_top, W, H), fill=TAB_BG + (245,))
    d.line((0, tab_top, W, tab_top), fill=(245, 230, 211, 255), width=2 * S)
    seg = W / len(TABS)
    for i, (lab, emo) in enumerate(zip(TABS, TAB_EMOJI)):
        cx = int(seg * (i + 0.5))
        col = TAB_ACTIVE if i == 0 else TAB_INACTIVE
        text(d, (cx - 14 * S, tab_top + 6 * S), emo, 22 * S, col + (255,))
        text(d, (cx - len(lab) * 6 * S, tab_top + 32 * S), lab, 12 * S, col + (255,), True)

    bx0 = int(W * 0.05); bx1 = int(W * 0.31); by0 = int(H * 0.06); by1 = by0 + 54 * S
    rr(d, (bx0, by0, bx1, by1), 18 * S, WHITE + (245,))
    text(d, (bx0 + 12 * S, by0 + 13 * S), "宝贝，来听故事啦～", 15 * S, TEXT + (255,))

    out = im.convert("RGB").resize((sw, sh), Image.Resampling.LANCZOS)
    return out


panels = [("iPhone 横屏", 932, 430), ("iPad 横屏", 1194, 834)]
imgs = [draw_home(sw, sh, label) for label, sw, sh in panels]

CW = max(i.width for i in imgs)
CH = max(i.height for i in imgs)
pad = 26
title_h = 46
note_h = 28
W = pad * 3 + CW * 2
H = pad + title_h + CH + note_h + pad * 2
board = Image.new("RGB", (W, H), (238, 231, 219))
d = ImageDraw.Draw(board)
text(d, (pad, 10), "ReadMeToSleep — HOME screen, real assets & layout (scene bottom meets tab bar, no seam)",
     22, (70, 58, 50), True)
for i, (label, sw, sh) in enumerate(panels):
    x0 = pad + i * (CW + pad)
    y0 = pad + title_h
    px = x0 + (CW - imgs[i].width) // 2
    py = y0 + (CH - imgs[i].height) // 2
    board.paste(imgs[i], (px, py))
    d.rectangle((px, py, px + imgs[i].width, py + imgs[i].height), outline=(185, 168, 148), width=2)
    text(d, (x0, y0 + CH + 6), "%s — %d×%d" % (label, sw, sh), 16, (70, 58, 50))

out = os.path.join(BASE, "app_home_mockup.png")
board.save(out, quality=94)
print("saved:", out, board.size)
