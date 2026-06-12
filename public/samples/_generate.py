#!/usr/bin/env python3
"""Generate sample TTB labels for the verification prototype.

Produces a small set of realistic label images covering the pass/fail cases the
stakeholders called out: a fully compliant label, the title-case warning trap,
a missing warning, and a wine label (for an ABV-mismatch demo against the form).

Run:  python3 _generate.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))

WARNING = ("GOVERNMENT WARNING: (1) According to the Surgeon General, women should not "
           "drink alcoholic beverages during pregnancy because of the risk of birth defects. "
           "(2) Consumption of alcoholic beverages impairs your ability to drive a car or "
           "operate machinery, and may cause health problems.")

# Try a few common macOS font files; fall back to PIL's default bitmap font.
def font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

SERIF = ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
         "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"]
SERIF_R = ["/System/Library/Fonts/Supplemental/Georgia.ttf",
           "/System/Library/Fonts/Supplemental/Times New Roman.ttf"]
SANS = ["/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf"]
SANS_B = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
          "/Library/Fonts/Arial Bold.ttf"]


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make_label(filename, *, brand, brand_font_size, klass, alcohol, net,
               producer, origin=None, warning_text=WARNING, warning_bold=True,
               include_warning=True, bg=(247, 243, 232), accent=(28, 42, 66)):
    W, H = 760, 980
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    # outer border
    d.rectangle([18, 18, W - 18, H - 18], outline=accent, width=4)
    d.rectangle([30, 30, W - 30, H - 30], outline=accent, width=1)

    cx = W // 2
    y = 70

    d.text((cx, y), "EST. 1921", font=font(SANS, 22), fill=accent, anchor="ma")
    y += 50

    # brand
    for line in wrap(d, brand, font(SERIF, brand_font_size), W - 140):
        d.text((cx, y), line, font=font(SERIF, brand_font_size), fill=accent, anchor="ma")
        y += brand_font_size + 8
    y += 10

    d.line([cx - 120, y, cx + 120, y], fill=accent, width=2)
    y += 30

    d.text((cx, y), klass, font=font(SERIF_R, 30), fill=accent, anchor="ma")
    y += 90

    # decorative middle diamond (drawn, so it never depends on a glyph being present)
    ds = 9
    d.polygon([(cx, y), (cx + ds, y + ds), (cx, y + 2 * ds), (cx - ds, y + ds)], fill=accent)
    y += 90

    d.text((cx, y), alcohol, font=font(SANS_B, 30), fill=accent, anchor="ma")
    y += 50
    d.text((cx, y), net, font=font(SANS, 24), fill=accent, anchor="ma")
    y += 60
    prod_lines = wrap(d, producer, font(SANS, 20), W - 160)
    for line in prod_lines:
        d.text((cx, y), line, font=font(SANS, 20), fill=accent, anchor="ma")
        y += 28
    if origin:
        d.text((cx, y), origin, font=font(SANS, 20), fill=accent, anchor="ma")
        y += 28

    # government warning block, bottom
    if include_warning:
        wy = H - 250
        d.line([60, wy - 18, W - 60, wy - 18], fill=accent, width=1)
        # split prefix from body so we can bold/caps the prefix independently
        if warning_text.startswith("GOVERNMENT WARNING:"):
            prefix, body = "GOVERNMENT WARNING:", warning_text[len("GOVERNMENT WARNING:"):]
        elif warning_text.startswith("Government Warning:"):
            prefix, body = "Government Warning:", warning_text[len("Government Warning:"):]
        else:
            prefix, body = "", warning_text
        pfont = font(SANS_B if warning_bold else SANS, 17)
        bfont = font(SANS, 16)
        full = (prefix + body).strip()
        # render prefix inline with the wrapped body
        line = prefix
        x = 60
        d.text((x, wy), prefix, font=pfont, fill=accent)
        x += d.textlength(prefix + " ", font=pfont)
        for word in body.split():
            wlen = d.textlength(word + " ", font=bfont)
            if x + wlen > W - 60:
                wy += 24
                x = 60
            d.text((x, wy), word, font=bfont, fill=accent)
            x += wlen

    out = os.path.join(HERE, filename)
    img.save(out, "PNG")
    print("wrote", filename)


# 1) Fully compliant distilled spirits label
make_label("compliant.png",
           brand="OLD TOM DISTILLERY", brand_font_size=52,
           klass="Kentucky Straight Bourbon Whiskey",
           alcohol="45% Alc./Vol. (90 Proof)", net="750 mL",
           producer="Bottled by Old Tom Distillery, Bardstown, KY")

# 2) Warning prefix in title case (Jenny's reject case) — wording otherwise correct
make_label("warning-titlecase.png",
           brand="OLD TOM DISTILLERY", brand_font_size=52,
           klass="Kentucky Straight Bourbon Whiskey",
           alcohol="45% Alc./Vol. (90 Proof)", net="750 mL",
           producer="Bottled by Old Tom Distillery, Bardstown, KY",
           warning_text="Government Warning:" + WARNING[len("GOVERNMENT WARNING:"):],
           warning_bold=False)

# 3) Missing the government warning entirely
make_label("missing-warning.png",
           brand="RIVER BEND RESERVE", brand_font_size=48,
           klass="Tennessee Whiskey",
           alcohol="40% Alc./Vol. (80 Proof)", net="750 mL",
           producer="Distilled & bottled by River Bend, Lynchburg, TN",
           include_warning=False, bg=(244, 240, 230))

# 4) Wine label — use against the form with a mismatched ABV to show a fail
make_label("wine-cabernet.png",
           brand="STONE'S THROW", brand_font_size=56,
           klass="Napa Valley Cabernet Sauvignon",
           alcohol="13.5% Alc./Vol.", net="750 mL",
           producer="Produced & bottled by Stone's Throw Cellars, Napa, CA",
           origin="Product of USA",
           bg=(245, 241, 236), accent=(60, 30, 40))

# 5) Imperfect photo of the compliant label — rotated with glare and slight blur
# (Jenny's "weird angles / glare on the bottle" case; should still verify cleanly)
from PIL import ImageFilter

base = Image.open(os.path.join(HERE, "compliant.png")).convert("RGB")
rot = base.rotate(6, expand=True, fillcolor=(206, 202, 194), resample=Image.BICUBIC)
canvas = rot.copy()
glare = Image.new("L", canvas.size, 0)
gd = ImageDraw.Draw(glare)
cx, cy, r = int(canvas.width * 0.74), int(canvas.height * 0.20), int(canvas.width * 0.55)
for i in range(r, 0, -8):
    gd.ellipse([cx - i, cy - i, cx + i, cy + i], fill=int(110 * (1 - i / r)))
white = Image.new("RGB", canvas.size, (255, 255, 255))
canvas = Image.composite(white, canvas, glare)
canvas = canvas.filter(ImageFilter.GaussianBlur(0.7))
canvas.save(os.path.join(HERE, "bad-photo.png"), "PNG")
print("wrote bad-photo.png")

print("done")
