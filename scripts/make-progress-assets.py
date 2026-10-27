"""Render Mimi's progress-card strips (assets/progress/*). Dev-only; needs Pillow.

  python3 scripts/make-progress-assets.py

step-1..4.gif loop while Mimi works on that step; done.png is the finished state.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "progress")
S = 3  # supersampling
W, H = 600, 96
CARD = (0, 0, 0)
TRACK = (30, 31, 33)
SEG_OFF = (58, 60, 63)
GREEN = (0, 255, 148)
FPS = 25
FRAMES = 40  # 1.6 s seamless loop
SEGMENTS = 4
FILL_AT = 0.62  # how far the current step's bar sits while working


def base():
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W * S - 1, H * S - 1], radius=28 * S, fill=CARD)
    d.rounded_rectangle([14 * S, 14 * S, (W - 14) * S, (H - 14) * S], radius=34 * S, fill=TRACK)
    return img


def geometry():
    x0, x1 = 44, W - 44
    gap = 14
    segw = (x1 - x0 - gap * (SEGMENTS - 1)) / SEGMENTS
    return x0, gap, segw, H / 2


def seg(d, x, y, w, color):
    d.rounded_rectangle([x * S, (y - 3.5) * S, (x + max(w, 7)) * S, (y + 3.5) * S], radius=4 * S, fill=color)


def knob(img, x, y, pulse, mark, phase):
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = 26 + 4 * pulse
    gd.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=GREEN + (int(90 + 70 * pulse),))
    glow = glow.filter(ImageFilter.GaussianBlur(9 * S))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    kr = 19
    d.ellipse([(x - kr) * S, (y - kr) * S, (x + kr) * S, (y + kr) * S], fill=GREEN)
    if mark == "check":
        d.line([((x - 8) * S, y * S), ((x - 2) * S, (y + 6) * S), ((x + 9) * S, (y - 7) * S)], fill=(0, 0, 0), width=4 * S, joint="curve")
    else:
        for j in range(3):
            active = (phase * 3) % 3
            dist = min(abs(j - active), 3 - abs(j - active))
            rr = 2.0 + 1.2 * max(0, 1 - dist)
            xx = x - 7 + j * 7
            d.ellipse([(xx - rr) * S, (y - rr) * S, (xx + rr) * S, (y + rr) * S], fill=(0, 0, 0))


def frame(step, i, done=False):
    img = base()
    d = ImageDraw.Draw(img)
    x0, gap, segw, y = geometry()
    phase = i / FRAMES
    pulse = 0.5 + 0.5 * math.sin(2 * math.pi * phase)
    kx = None
    for k in range(SEGMENTS):
        sx = x0 + k * (segw + gap)
        seg(d, sx, y, segw, SEG_OFF)
        if done or k < step:
            seg(d, sx, y, segw, GREEN)
        elif k == step:
            fill = segw * FILL_AT
            seg(d, sx, y, fill, GREEN)
            # shimmer sweeping along the filled part
            sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
            sd = ImageDraw.Draw(sh)
            cx = sx + (fill + 40) * phase - 20
            sd.ellipse([(cx - 14) * S, (y - 5) * S, (cx + 14) * S, (y + 5) * S], fill=(255, 255, 255, 150))
            sh = sh.filter(ImageFilter.GaussianBlur(4 * S))
            mask = Image.new("L", img.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle([sx * S, (y - 3.5) * S, (sx + fill) * S, (y + 3.5) * S], radius=4 * S, fill=255)
            img.paste(sh, (0, 0), Image.composite(sh, Image.new("RGBA", img.size), mask).split()[3])
            d = ImageDraw.Draw(img)
            kx = sx + fill
    if done:
        kx = x0 + SEGMENTS * (segw + gap) - gap
    knob(img, kx, y, 0.6 if done else pulse, "check" if done else "dots", phase)
    return img.resize((W, H), Image.LANCZOS)


def to_gif_frame(img):
    bg = Image.new("RGBA", img.size, (43, 45, 49, 255))  # Discord embed background
    bg.alpha_composite(img)
    return bg.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=64)


os.makedirs(OUT, exist_ok=True)
for step in range(SEGMENTS):
    frames = [to_gif_frame(frame(step, i)) for i in range(FRAMES)]
    path = os.path.join(OUT, f"step-{step + 1}.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / FPS), loop=0, optimize=True)
    print(path, os.path.getsize(path))
done = frame(SEGMENTS - 1, 0, done=True)
bg = Image.new("RGBA", done.size, (43, 45, 49, 255))
bg.alpha_composite(done)
bg.convert("RGB").save(os.path.join(OUT, "done.png"), optimize=True)
print("done.png")
