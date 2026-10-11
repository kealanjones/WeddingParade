"""Generate realistic-ish phone photos of balloon drawings for testing cleanup.

Each image: a balloon drawn on off-white paper, with uneven lighting, a soft
shadow, slight perspective, sensor noise and JPEG compression.

    python3 tests/make_synthetic.py tests/photos
"""
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 1600  # drawing sheet, portrait


def crayon(draw, xy, fill, rng, density=0.85):
    """Fill a polygon with streaky crayon-like strokes (some paper shows)."""
    xs = [p[0] for p in xy]
    ys = [p[1] for p in xy]
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(xy, fill=255)
    layer = Image.new("L", (W, H), 0)
    ld = ImageDraw.Draw(layer)
    for y in range(int(min(ys)) - 10, int(max(ys)) + 10, 5):
        if rng.random() < density:
            ld.line([(min(xs) - 20, y + rng.uniform(-6, 6)), (max(xs) + 20, y + rng.uniform(-6, 6) - 25)],
                    fill=int(rng.uniform(170, 255)), width=rng.randint(4, 7))
    layer = Image.composite(layer, Image.new("L", (W, H), 0), mask)
    return layer, fill


def ellipse_poly(cx, cy, rx, ry, n=120, squash_bottom=0.0):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = cx + rx * math.cos(t)
        y = cy + ry * math.sin(t)
        if math.sin(t) > 0:  # bottom half narrows like a balloon
            x = cx + (x - cx) * (1 - squash_bottom * math.sin(t) ** 2)
        pts.append((x, y))
    return pts


def heart_poly(cx, cy, s, n=160):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * s, cy + y * s))
    return pts


def draw_sheet(kind, rng):
    paper = Image.new("RGB", (W, H), (250, 248, 242))
    d = ImageDraw.Draw(paper)
    layers = []  # (mask, colour)
    outline = (30, 28, 35)
    lw = 9

    if kind == "round":
        body = ellipse_poly(600, 620, 330, 380, squash_bottom=0.45)
        colours = [(230, 40, 60), (250, 190, 30), (40, 140, 220), (60, 180, 90)]
        # vertical stripes clipped to the body
        for i, c in enumerate(colours * 2):
            x0 = 270 + i * 83
            stripe = [(x0, 200), (x0 + 83, 200), (x0 + 83, 1050), (x0, 1050)]
            m, _ = crayon(d, stripe, c, rng)
            bm = Image.new("L", (W, H), 0)
            ImageDraw.Draw(bm).polygon(body, fill=255)
            layers.append((Image.fromarray(np.minimum(np.array(m), np.array(bm))), c))
        basket = [(520, 1180), (680, 1180), (665, 1300), (535, 1300)]
        m, _ = crayon(d, basket, (150, 95, 45), rng, 0.95)
        layers.append((m, (150, 95, 45)))
        for mask, c in layers:
            paper.paste(Image.new("RGB", (W, H), c), (0, 0), mask)
        d.line(body + [body[0]], fill=outline, width=lw, joint="curve")
        d.polygon(basket, outline=outline, width=lw)
        for x in range(320, 900, 83):
            pass
        # ropes (thin)
        d.line([(500, 935), (530, 1180)], fill=outline, width=5)
        d.line([(700, 935), (670, 1180)], fill=outline, width=5)
        d.line([(600, 990), (600, 1180)], fill=outline, width=4)

    elif kind == "heart":
        body = heart_poly(600, 640, 21)
        m, _ = crayon(d, body, (240, 120, 170), rng, 0.6)  # patchy pink, lots of paper showing
        paper.paste(Image.new("RGB", (W, H), (240, 120, 170)), (0, 0), m)
        # pencil-ish thin outline
        d.line(body + [body[0]], fill=(70, 70, 80), width=5, joint="curve")
        # a small uncoloured window inside
        d.ellipse([520, 520, 640, 620], fill=(250, 248, 242), outline=(70, 70, 80), width=5)
        basket = [(545, 1150), (655, 1150), (645, 1240), (555, 1240)]
        d.polygon(basket, fill=(120, 80, 200), outline=(70, 70, 80), width=5)
        d.line([(560, 990), (565, 1150)], fill=(70, 70, 80), width=4)
        d.line([(640, 990), (635, 1150)], fill=(70, 70, 80), width=4)

    elif kind == "tall":
        body = ellipse_poly(600, 600, 230, 430, squash_bottom=0.5)
        # marker fill, no dark outline, uncoloured middle band
        top = [p for p in body]
        bm = Image.new("L", (W, H), 0)
        ImageDraw.Draw(bm).polygon(body, fill=255)
        band = Image.new("L", (W, H), 0)
        ImageDraw.Draw(band).rectangle([0, 540, W, 660], fill=255)
        fillm = Image.fromarray(np.where(np.array(band) > 0, 0, np.array(bm)).astype(np.uint8))
        paper.paste(Image.new("RGB", (W, H), (20, 160, 150)), (0, 0), fillm)
        # outline in teal marker, with a small gap
        pts = body + [body[0]]
        d.line(pts[:55], fill=(10, 110, 105), width=8, joint="curve")
        d.line(pts[58:], fill=(10, 110, 105), width=8, joint="curve")
        basket = [(555, 1130), (645, 1130), (640, 1220), (560, 1220)]
        d.polygon(basket, fill=(230, 120, 30), outline=(120, 60, 10), width=6)
        d.line([(570, 1000), (575, 1130)], fill=(60, 60, 60), width=4)
        d.line([(630, 1000), (625, 1130)], fill=(60, 60, 60), width=4)
        # a stray scribble and specks elsewhere on the page
        d.line([(120, 1450), (180, 1470)], fill=(90, 90, 90), width=3)

    elif kind == "dark":
        body = ellipse_poly(600, 650, 360, 400, squash_bottom=0.4)
        d.polygon(body, fill=(25, 45, 140), outline=(10, 10, 30), width=10)
        for (x, y) in [(480, 520), (700, 600), (560, 800), (720, 820), (450, 700)]:
            d.regular_polygon((x, y, 40), 5, fill=(255, 220, 40))
        basket = [(530, 1220), (670, 1220), (655, 1330), (545, 1330)]
        d.polygon(basket, fill=(110, 70, 30), outline=(10, 10, 30), width=8)
        d.line([(500, 1000), (540, 1220)], fill=(10, 10, 30), width=5)
        d.line([(700, 1000), (660, 1220)], fill=(10, 10, 30), width=5)

    for _ in range(25):  # paper specks / dust
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(1, 3)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(120, 115, 110))
    return paper


def perspective_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


def photograph(sheet, rng, table=(95, 70, 50), margin=0.06, warm=(1.0, 0.95, 0.85)):
    # Place the sheet on a "table", with slight perspective.
    pw, ph = 1500, 2000
    canvas = Image.new("RGB", (pw, ph), table)
    tex = (np.random.default_rng(rng.randint(0, 999)).normal(0, 10, (ph, pw, 1))).astype(np.int16)
    canvas = Image.fromarray(np.clip(np.array(canvas).astype(np.int16) + tex, 0, 255).astype(np.uint8))
    mx, my = pw * margin, ph * margin
    j = lambda: rng.uniform(-40, 40)
    dst = [(mx + j(), my + j()), (pw - mx + j(), my + j()), (pw - mx + j(), ph - my + j()), (mx + j(), ph - my + j())]
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    warped = sheet.transform((pw, ph), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    mask = Image.new("L", (W, H), 255).transform((pw, ph), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC)
    canvas.paste(warped, (0, 0), mask)

    a = np.array(canvas).astype(np.float32) / 255
    yy, xx = np.mgrid[0:ph, 0:pw]
    # lighting: diagonal falloff plus a soft phone/hand shadow blob
    ang = rng.uniform(0, 2 * math.pi)
    grad = 0.95 - 0.35 * ((xx / pw) * math.cos(ang) + (yy / ph) * math.sin(ang) + 1) / 2
    sx, sy = rng.uniform(0.2, 0.8) * pw, rng.uniform(0.6, 1.0) * ph
    blob = np.exp(-(((xx - sx) / (pw * 0.25)) ** 2 + ((yy - sy) / (ph * 0.2)) ** 2))
    light = grad * (1 - 0.35 * blob)
    a = a * light[..., None] * np.array(warm)[None, None, :]
    a += np.random.default_rng(rng.randint(0, 999)).normal(0, 0.025, a.shape)
    img = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    return img


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)
    specs = [
        ("round", dict()),
        ("heart", dict(warm=(1.0, 0.93, 0.8))),
        ("tall", dict(margin=0.0)),
        ("dark", dict(warm=(0.9, 0.95, 1.05))),
        ("round", dict(margin=0.18, table=(60, 60, 70))),
    ]
    for i, (kind, kw) in enumerate(specs):
        sheet = draw_sheet(kind, rng)
        photo = photograph(sheet, rng, **kw)
        name = out / f"{i + 1}-{kind}.jpg"
        photo.save(name, quality=82)
        print(name)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tests/photos")
