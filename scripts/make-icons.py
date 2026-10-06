"""Draws the PWA icons into src/public/.

Run from the repo root:  python scripts/make-icons.py   (needs Pillow)

The committed PNGs are the output; this script is only here so the icons can be
redrawn or recolored. Ported from FrozenDegenerates' make-icons.py (a hockey
puck on slate); the mark here is a football on the app's turf green, with the
green ramp taken from --brand-* in src/styles/brand.css (dark mode values).

Three families, as in FrozenDegenerates:
  - "any"      : rounded tile with transparent corners (Android/desktop install).
  - "maskable" : full-bleed square, artwork inside the central 60% so any OS
                 mask (circle, squircle) still shows the whole ball.
  - apple-touch-icon: full-bleed square, no transparency (iOS rounds it itself).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'src' / 'public'
OUT.mkdir(parents=True, exist_ok=True)

GROUND = (0, 51, 25)        # brand-900, oklch(0.28 0.07 155)
GROUND_GLOW = (0, 135, 69)  # brand-600, oklch(0.54 0.15 155)
LEATHER = (150, 84, 38)     # pigskin
LEATHER_DARK = (96, 50, 22)
LEATHER_LIGHT = (196, 124, 70)
WHITE = (250, 248, 240)

SS = 4  # supersample factor
TILT = 35  # degrees, ball leans up to the right


def ground(size, rounded):
    """Deep turf green with a lighter pool of it behind the ball."""
    s = size * SS
    img = Image.new('RGBA', (s, s), GROUND + (255,))
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    r = int(s * 0.42)
    ImageDraw.Draw(glow).ellipse((s // 2 - r, s // 2 - r, s // 2 + r, s // 2 + r),
                                 fill=GROUND_GLOW + (210,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.12))
    img = Image.alpha_composite(img, glow)
    if rounded:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=255)
        img.putalpha(mask)
    return img


def football(s, scale):
    """The ball, drawn level on its own transparent layer, then tilted.

    `scale` = ball length as a fraction of the canvas, measured before the tilt.
    """
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    w = s * scale
    h = w * 0.56
    cx, cy = s / 2, s / 2
    box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

    # Everything that must stay inside the ball is drawn on `art`, then masked.
    art = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)
    ad.ellipse(box, fill=LEATHER)
    # Shading: darker underside, lighter top. ImageDraw REPLACES pixels rather
    # than blending them, so a translucent fill drawn straight onto `art` would
    # punch through to the ground behind it; blend each on its own layer instead.
    for shade_box, colour in (
        ((box[0], cy + h * 0.10, box[2], box[3]), LEATHER_DARK + (150,)),
        ((box[0] + w * 0.08, box[1] + h * 0.04, box[2] - w * 0.08, cy - h * 0.12),
         LEATHER_LIGHT + (110,)),
    ):
        shade = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(shade).ellipse(shade_box, fill=colour)
        art = Image.alpha_composite(art, shade)
    ad = ImageDraw.Draw(art)
    # the two white stripes near the tips
    stripe = max(2, int(w * 0.035))
    for sign in (-1, 1):
        x = cx + sign * w * 0.30
        ad.rectangle((x - stripe, box[1], x + stripe, box[3]), fill=WHITE)
        x2 = x + sign * stripe * 2.6
        ad.rectangle((x2 - stripe * 0.7, box[1], x2 + stripe * 0.7, box[3]), fill=WHITE)
    # laces: a spine and five cross-ticks
    lace = max(2, int(w * 0.03))
    ad.line((cx - w * 0.17, cy, cx + w * 0.17, cy), fill=WHITE, width=lace)
    for i in range(5):
        x = cx - w * 0.135 + i * w * 0.0675
        ad.line((x, cy - h * 0.15, x, cy + h * 0.15), fill=WHITE, width=lace)

    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    layer.paste(art, (0, 0), mask)
    # rim, drawn after masking so the stripes do not cover it
    ImageDraw.Draw(layer).ellipse(box, outline=LEATHER_DARK + (255,), width=max(2, int(s * 0.008)))
    return layer.rotate(TILT, resample=Image.BICUBIC, center=(cx, cy))


def finish(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print('wrote', name)


def make(size, name, rounded, scale):
    base = ground(size, rounded)
    base = Image.alpha_composite(base, football(base.size[0], scale))
    finish(base, size, name)


make(192, 'icon-192.png', rounded=True, scale=0.74)
make(512, 'icon-512.png', rounded=True, scale=0.74)
# Maskable: the tilted ball's bounding box must sit inside the central safe zone.
make(512, 'icon-maskable-512.png', rounded=False, scale=0.56)
make(180, 'apple-touch-icon.png', rounded=False, scale=0.70)
make(64, 'favicon-64.png', rounded=True, scale=0.80)
