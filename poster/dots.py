# Usage: uv run --with pillow --with segno python poster/dots.py icons/icon-source.png poster/shallowsid-dots.svg 32
import math, sys
from PIL import Image
import segno

src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
cell = 1024 // n
W = n * cell
H = W * 297 / 210  # A4 portrait
rows = math.ceil(H / cell)
pad = 1  # icon rows start here: logo in the upper part, text block below
y0 = (H - rows * cell) / 2  # center the grid, clip partial rows at top and bottom
M = 2 * cell  # page margin on the dot grid (about 13 mm)
img = Image.open(src).convert("RGBA").resize((n, n), Image.BOX)
bg = img.getpixel((0, 0))
parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H:.1f}" width="210mm" height="297mm">',
    '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="#000" stop-opacity="0"/>'
    '<stop offset="0.45" stop-color="#000" stop-opacity="0.82"/>'
    '<stop offset="1" stop-color="#000" stop-opacity="0.9"/></linearGradient></defs>',
    '<rect width="100%" height="100%" fill="#000"/>',
]
for gy in range(rows):
    for x in range(n):
        iy = gy - pad
        r, g, b, a = img.getpixel((x, iy)) if 0 <= iy < n else bg
        if a < 128:
            continue
        u, v = x / n, gy / n
        # two crossing sine waves -> radius from 12% to 46% of a cell (no overlap below 50%)
        w = 0.5 + 0.25 * math.sin(2 * math.pi * (u * 2.5 + v * 1.5)) + 0.25 * math.sin(2 * math.pi * (v * 3 - u))
        rad = cell * (0.12 + 0.34 * w)
        parts.append(f'<circle cx="{x*cell+cell/2:g}" cy="{y0+gy*cell+cell/2:.1f}" r="{rad:.2f}" fill="#{r:02x}{g:02x}{b:02x}"/>')

# darken the dots behind the text block so the text reads well
fade_top = 1010
parts.append(f'<rect x="0" y="{fade_top}" width="{W}" height="{H-fade_top:.1f}" fill="url(#fade)"/>')

# QR card, bottom right, aligned to the text block
qr = segno.make("https://sid.extend.fi", error="h")
m = qr.matrix
quiet = 3  # quiet zone in modules
size = 7 * cell  # card covers whole background cells
nm = len(m)
mod = size / (nm + 2 * quiet)
qx = W - M - size
qy = y0 + 42 * cell - size  # card bottom on a grid row line
ink, paper = "#262236", "#ece9f5"  # icon background, app text color
eye_ink = ["#c8006e", "#d4501c", "#c8006e"]  # darker logo colors: pink left, orange right
ox, oy = qx + quiet * mod, qy + quiet * mod  # first module
eye_r = 2 * mod
# concentric corners: card radius = finder radius + quiet zone
parts.append(f'<rect x="{qx:g}" y="{qy:.1f}" width="{size}" height="{size}" rx="{eye_r+quiet*mod:.2f}" fill="{paper}"/>')
eyes = [(0, 0), (nm - 7, 0), (0, nm - 7)]
for (ex, ey), col in zip(eyes, eye_ink):
    x, y = ox + ex * mod, oy + ey * mod
    parts.append(
        f'<rect x="{x+mod/2:.2f}" y="{y+mod/2:.2f}" width="{6*mod:.2f}" height="{6*mod:.2f}" rx="{eye_r-mod/2:.2f}" fill="none" stroke="{col}" stroke-width="{mod:.2f}"/>'
        f'<rect x="{x+2*mod:.2f}" y="{y+2*mod:.2f}" width="{3*mod:.2f}" height="{3*mod:.2f}" rx="{mod*0.8:.2f}" fill="{ink}"/>'
    )
in_eye = lambda r, c: any(ex <= c < ex + 7 and ey <= r < ey + 7 for ex, ey in eyes)
# data modules as dots, to match the poster
parts.append(f'<g fill="{ink}">' + "".join(
    f'<circle cx="{ox+(c+.5)*mod:.2f}" cy="{oy+(r+.5)*mod:.2f}" r="{mod*0.46:.2f}"/>'
    for r, row in enumerate(m) for c, on in enumerate(row) if on and not in_eye(r, c)
) + "</g>")

# same text as the link-sharing card (index.html meta, icons/og-image.svg)
base = qy + size + 34
parts.append(
    '<g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">'
    f'<text x="{M}" y="{base-176:.1f}" font-size="100" font-weight="700" letter-spacing="-2" fill="#ece9f5">ShallowSID</text>'
    f'<text x="{M+3}" y="{base-108:.1f}" font-size="36" font-weight="500" fill="#a99cff">The easy C64 music web player</text>'
    f'<text x="{M+3}" y="{base-48:.1f}" font-size="23" fill="#a39db5">60,000+ tunes from the</text>'
    f'<text x="{M+3}" y="{base-18:.1f}" font-size="23" fill="#a39db5">High Voltage SID Collection</text>'
    f'<text x="{qx+size/2:g}" y="{base:.1f}" font-size="23" font-weight="500" text-anchor="middle" fill="#ece9f5">sid.extend.fi</text>'
    "</g>"
)
parts.append("</svg>")
open(out, "w").write("\n".join(parts))
