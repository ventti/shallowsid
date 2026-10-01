#!/usr/bin/env python3
"""Mock-ups of the app icon on macOS, iOS, Android, Ubuntu, Linux Mint and Windows 11.

Each platform shows the file it actually gets and the mask it applies to it:

  macOS (Safari "Add to Dock")     apple-touch-icon.png in the squircle, on the 824/1024 grid
  iOS (Add to Home Screen)         apple-touch-icon.png in the squircle, full bleed
  Android (Chrome install)         icon-maskable-512.png in a circle
  Ubuntu, Linux Mint (Chrome)      icon-512.png as is, rounded corners and all
  Windows 11 (Chrome/Edge install) icon-512.png as is, on the desktop, in Start and the taskbar

The other icons, the wallpapers and the system chrome are generic stand-ins,
not any real app's or vendor's artwork. Scenes are drawn as SVG in points
and rendered at 2x with rsvg-convert. Text uses Helvetica Neue (macOS) and
falls back to the system sans-serif.

Usage:
  tools/build_mockups.py [--out docs/mockups]
"""

import argparse
import base64
import math
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ICONS = REPO / "icons"
APP = "ShallowSID"
SCALE = 2
FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"

# Stand-in app icons: (gradient from, gradient to, glyph)
PLACEHOLDERS = [
    ("#5ac8fa", "#007aff", "ring"), ("#ffd60a", "#ff9f0a", "sun"), ("#34c759", "#248a3d", "bars"),
    ("#ff6482", "#ff2d55", "note"), ("#bf5af2", "#8944ab", "grid"), ("#8e8e93", "#48484a", "gear"),
    ("#64d2ff", "#0a84ff", "wave"), ("#ff9f0a", "#ff453a", "tri"), ("#30d158", "#0f9d58", "chat"),
    ("#e5e5ea", "#aeaeb2", "lines"), ("#5e5ce6", "#3634a3", "dot"), ("#66d4cf", "#0c8f8a", "plus"),
]


# ---- shapes, in a unit square (0..1) ----------------------------------------------------

def squircle(n=5.0, steps=96):
    """Apple's continuous-corner icon shape, as a superellipse |x|^n + |y|^n = 1."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** (2 / n), c)
        y = math.copysign(abs(s) ** (2 / n), s)
        pts.append(f"{0.5 + x / 2:.4f},{0.5 + y / 2:.4f}")
    return "M" + " L".join(pts) + "Z"


SQUIRCLE = squircle()
MASKS = {
    "squircle": f'<path d="{SQUIRCLE}"/>',
    "circle": '<circle cx=".5" cy=".5" r=".5"/>',
    "rounded": '<rect width="1" height="1" rx=".2"/>',
    "square": '<rect width="1" height="1"/>',
}

GLYPHS = {
    "ring": '<circle cx=".5" cy=".5" r=".22" fill="none" stroke="#fff" stroke-width=".07"/>',
    "sun": '<circle cx=".5" cy=".5" r=".15" fill="#fff"/>' + "".join(
        f'<rect x=".48" y=".2" width=".04" height=".1" rx=".02" fill="#fff" transform="rotate({a} .5 .5)"/>' for a in range(0, 360, 45)),
    "bars": "".join(f'<rect x="{.24 + i * .16:.2f}" y="{.62 - h:.2f}" width=".1" height="{h + .12:.2f}" rx=".03" fill="#fff"/>'
                    for i, h in enumerate((.12, .26, .18, .34))),
    "note": '<path d="M.42 .28 L.66 .23 L.66 .6 M.42 .28 L.42 .66" stroke="#fff" stroke-width=".05" fill="none"/>'
            '<circle cx=".37" cy=".67" r=".07" fill="#fff"/><circle cx=".61" cy=".61" r=".07" fill="#fff"/>',
    "grid": "".join(f'<rect x="{x}" y="{y}" width=".18" height=".18" rx=".05" fill="#fff"/>'
                    for x in (.3, .52) for y in (.3, .52)),
    "gear": '<circle cx=".5" cy=".5" r=".2" fill="none" stroke="#fff" stroke-width=".08" stroke-dasharray=".07 .05"/>'
            '<circle cx=".5" cy=".5" r=".08" fill="#fff"/>',
    "wave": '<path d="M.22 .5 Q.31 .3 .4 .5 T.58 .5 T.76 .5" stroke="#fff" stroke-width=".06" fill="none" stroke-linecap="round"/>',
    "tri": '<path d="M.5 .27 L.74 .7 L.26 .7Z" fill="#fff"/>',
    "chat": '<path d="M.26 .32 h.48 a.05 .05 0 0 1 .05 .05 v.24 a.05 .05 0 0 1 -.05 .05 h-.3 l-.12 .1 v-.1 h-.06 a.05 .05 0 0 1 -.05 -.05 v-.24 a.05 .05 0 0 1 .05 -.05z" fill="#fff"/>',
    "lines": "".join(f'<rect x=".28" y="{y}" width="{w}" height=".06" rx=".03" fill="#6e6e73"/>'
                     for y, w in ((.32, .44), (.47, .44), (.62, .28))),
    "dot": '<circle cx=".5" cy=".5" r=".2" fill="#fff"/><circle cx=".5" cy=".5" r=".09" fill="#3634a3"/>',
    "plus": '<path d="M.5 .28 V.72 M.28 .5 H.72" stroke="#fff" stroke-width=".09" stroke-linecap="round"/>',
}


class Scene:
    """One SVG scene, drawn in points; icons are placed with `icon()` and `app()`."""

    def __init__(self, width, height):
        self.width, self.height = width, height
        self.defs, self.body = [], []
        self.ids = 0
        self.images = set()
        for mask, shape in MASKS.items():
            self.defs.append(f'<clipPath id="m-{mask}">{shape}</clipPath>')
        self.defs.append('<filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">'
                         '<feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity=".35"/></filter>')
        self.defs.append('<filter id="text-shadow"><feDropShadow dx="0" dy=".5" stdDeviation=".8" flood-color="#000" flood-opacity=".7"/></filter>')
        self.defs.append('<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>')

    def uid(self, prefix):
        self.ids += 1
        return f"{prefix}{self.ids}"

    def add(self, *parts):
        self.body.extend(parts)

    def image(self, name):
        """A file from icons/, embedded once and reused."""
        if name not in self.images:
            self.images.add(name)
            data = base64.b64encode((ICONS / name).read_bytes()).decode()
            self.defs.append(f'<image id="img-{name}" width="1" height="1" preserveAspectRatio="none" href="data:image/png;base64,{data}"/>')
        return f"#img-{name}"

    def app(self, name, x, y, size, mask="square", inset=0.0, shadow=True):
        """Our icon file at (x, y), `size` points wide, clipped to `mask` and inset by a fraction of its size."""
        inner = size * (1 - 2 * inset)
        g = (f'<g transform="translate({x + size * inset:.2f} {y + size * inset:.2f}) scale({inner:.3f})">'
             f'<use href="{self.image(name)}" clip-path="url(#m-{mask})"/></g>')
        self.add(f'<g filter="url(#shadow)">{g}</g>' if shadow else g)

    def icon(self, index, x, y, size, mask="squircle", inset=0.0, shadow=True):
        """A stand-in app icon."""
        top, bottom, glyph = PLACEHOLDERS[index % len(PLACEHOLDERS)]
        grad = self.uid("g")
        self.defs.append(f'<linearGradient id="{grad}" x1="0" y1="0" x2="0" y2="1">'
                         f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>')
        inner = size * (1 - 2 * inset)
        g = (f'<g transform="translate({x + size * inset:.2f} {y + size * inset:.2f}) scale({inner:.3f})">'
             f'<g clip-path="url(#m-{mask})"><rect width="1" height="1" fill="url(#{grad})"/>{GLYPHS[glyph]}</g></g>')
        self.add(f'<g filter="url(#shadow)">{g}</g>' if shadow else g)

    def text(self, x, y, s, size, fill="#fff", weight=400, anchor="start", shadow=False, opacity=1):
        f = ' filter="url(#text-shadow)"' if shadow else ""
        self.add(f'<text x="{x:.2f}" y="{y:.2f}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{fill}" fill-opacity="{opacity}" text-anchor="{anchor}"{f}>{esc(s)}</text>')

    def wallpaper(self, base, blobs, x=0, y=0, w=None, h=None, rx=0):
        """A soft, blurred abstract wallpaper: a base colour and blurred circles (cx, cy, r, colour) in 0..1."""
        w, h = w or self.width, h or self.height
        clip = self.uid("w")
        self.defs.append(f'<clipPath id="{clip}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/></clipPath>')
        circles = "".join(f'<circle cx="{x + cx * w:.1f}" cy="{y + cy * h:.1f}" r="{r * max(w, h):.1f}" fill="{c}"/>' for cx, cy, r, c in blobs)
        self.add(f'<g clip-path="url(#{clip})"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{base}"/>'
                 f'<g filter="url(#blur)">{circles}</g></g>')

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" viewBox="0 0 {self.width} {self.height}">'
                f'<defs>{"".join(self.defs)}</defs>{"".join(self.body)}</svg>')


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---- status icons -------------------------------------------------------------------------

def battery(x, y, h, fill="#fff", level=0.8):
    w = h * 2.1
    return (f'<rect x="{x}" y="{y}" width="{w:.2f}" height="{h}" rx="{h * .3:.2f}" fill="none" stroke="{fill}" stroke-opacity=".45" stroke-width="{h * .09:.2f}"/>'
            f'<rect x="{x + h * .15:.2f}" y="{y + h * .15:.2f}" width="{(w - h * .3) * level:.2f}" height="{h * .7:.2f}" rx="{h * .18:.2f}" fill="{fill}"/>'
            f'<rect x="{x + w + h * .08:.2f}" y="{y + h * .32:.2f}" width="{h * .12:.2f}" height="{h * .36:.2f}" rx="{h * .06:.2f}" fill="{fill}" fill-opacity=".45"/>')


def wifi(cx, bottom, r, fill="#fff"):
    """Three arcs and a dot, fanning up from (cx, bottom)."""
    out = [f'<circle cx="{cx}" cy="{bottom - r * .12:.2f}" r="{r * .12:.2f}" fill="{fill}"/>']
    for k in (.45, .75, 1.05):
        rr = r * k
        a = math.radians(45)
        x0, y0 = cx - rr * math.sin(a), bottom - rr * math.cos(a)
        x1 = cx + rr * math.sin(a)
        out.append(f'<path d="M{x0:.2f} {y0:.2f} A{rr:.2f} {rr:.2f} 0 0 1 {x1:.2f} {y0:.2f}" fill="none" stroke="{fill}" stroke-width="{r * .17:.2f}" stroke-linecap="round"/>')
    return "".join(out)


def signal(x, bottom, h, fill="#fff"):
    w = h * .22
    return "".join(f'<rect x="{x + i * w * 1.45:.2f}" y="{bottom - h * (i + 1) / 4:.2f}" width="{w:.2f}" height="{h * (i + 1) / 4:.2f}" rx="{w * .3:.2f}" fill="{fill}"/>'
                   for i in range(4))


def pill(x, y, w, h, fill, opacity=1.0, stroke=None, rx=None):
    s = f' stroke="{stroke}" stroke-width=".6"' if stroke else ""
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{h / 2 if rx is None else rx:.2f}" fill="{fill}" fill-opacity="{opacity}"{s}/>'


def tooltip(s, cx, y, size, fill="#1e1e1e", opacity=.85, text="#fff", rx=None):
    w = len(s) * size * .56 + size * 1.6
    h = size * 1.9
    return pill(cx - w / 2, y, w, h, fill, opacity, rx=rx) + (
        f'<text x="{cx}" y="{y + h * .66:.2f}" font-family="{FONT}" font-size="{size}" fill="{text}" text-anchor="middle">{esc(s)}</text>')


# ---- scenes ---------------------------------------------------------------------------------

def macos():
    s = Scene(800, 450)
    s.wallpaper("#1b1640", [(.1, .9, .35, "#ff6a3d"), (.45, .2, .4, "#6b3fd4"), (.9, .7, .35, "#1f7bd9"), (.6, 1, .25, "#e0418f")])
    # Menu bar
    s.add(f'<rect width="{s.width}" height="24" fill="#000" fill-opacity=".22"/>')
    s.text(16, 16.5, APP, 13, weight=700)
    x = 16 + 72 + 20   # rsvg can't measure text: widths at 13 pt Helvetica Neue
    for item, width in (("File", 20), ("Edit", 22), ("View", 27), ("History", 41), ("Window", 46), ("Help", 26)):
        s.text(x, 16.5, item, 13)
        x += width + 20
    s.text(s.width - 14, 16.5, "Tue 30 Sep  14:27", 13, anchor="end")
    s.add(battery(s.width - 160, 7.5, 9.5), wifi(s.width - 184, 17, 9))
    # Dock: our icon among stand-ins, with a running dot and its hover label
    size, pad, gap = 64, 6, 2
    order = [0, 1, 2, "app", 3, 4, None, 5]
    width = sum(size + gap for o in order if o is not None) + 13 - gap + 2 * pad
    x0, y0 = (s.width - width) / 2, s.height - size - 2 * pad - 4
    s.add(pill(x0, y0, width, size + 2 * pad, "#fff", .2, stroke="#fff", rx=20),
          pill(x0, y0, width, size + 2 * pad, "none", 1, stroke="#ffffff55", rx=20))
    x = x0 + pad
    for o in order:
        if o is None:
            s.add(f'<rect x="{x + 5:.2f}" y="{y0 + 12}" width="1" height="{size - 12}" fill="#fff" fill-opacity=".35"/>')
            x += 13
            continue
        if o == "app":
            s.app("apple-touch-icon.png", x, y0 + pad, size, "squircle", inset=100 / 1024)
            s.add(f'<circle cx="{x + size / 2}" cy="{y0 + size + pad + 2.5}" r="2" fill="#fff" fill-opacity=".85"/>',
                  tooltip(APP, x + size / 2, y0 - 34, 13, "#2a2a2e", .8, rx=7))
        else:
            s.icon(o, x, y0 + pad, size, "squircle", inset=100 / 1024)
            if o == 0:
                s.add(f'<circle cx="{x + size / 2}" cy="{y0 + size + pad + 2.5}" r="2" fill="#fff" fill-opacity=".85"/>')
        x += size + gap
    return s


def phone_frame(s, w, h, bezel, radius):
    s.add(f'<rect x="1" y="1" width="{w + 2 * bezel - 2}" height="{h + 2 * bezel - 2}" rx="{radius + bezel}" fill="#1c1c1e" stroke="#48484a" stroke-width="2"/>')


def ios():
    bezel, w, h = 14, 393, 852
    s = Scene(w + 2 * bezel, h + 2 * bezel)
    phone_frame(s, w, h, bezel, 55)
    ox, oy = bezel, bezel
    s.wallpaper("#0b1c3d", [(.2, .15, .35, "#2a6fdb"), (.9, .45, .35, "#8a3ffc"), (.2, .85, .4, "#00a3a3"), (.8, .95, .3, "#f06292")],
                ox, oy, w, h, rx=55)
    # Status bar and Dynamic Island
    s.text(ox + 58, oy + 36, "9:41", 17, weight=600, anchor="middle")
    s.add(pill(ox + (w - 126) / 2, oy + 11, 126, 37, "#000"),
          signal(ox + w - 104, oy + 37, 12), wifi(ox + w - 72, oy + 37, 9.5), battery(ox + w - 55, oy + 26.5, 12))
    # Home screen: a widget, then 4 columns of 60 pt icons with labels
    icon, left, pitch_x, pitch_y, top = 60, 27, 93, 104, 74
    s.add(pill(ox + left, oy + top, icon * 2 + pitch_x - icon, 60 + pitch_y, "#fff", .18, rx=22))
    s.text(ox + left + 16, oy + top + 30, "TUESDAY", 12, "#ff453a", 700)
    s.text(ox + left + 16, oy + top + 78, "30", 52, weight=300)
    s.text(ox + left + 16, oy + top + 120, "No events today", 13, opacity=.8)
    s.text(ox + left + 16, oy + top + 139, "Calendar", 12, opacity=.6)
    labels = ["Weather", "Clock", "Maps", "Music", "Photos", "Settings", "Notes", "Mail", "Files", "Wallet", "Podcasts", "Books", "Camera", "Stocks", "Health"]
    slots = [(2, 0), (3, 0), (2, 1), (3, 1)] + [(c, r) for r in (2, 3, 4) for c in range(4)]
    k = 0
    for c, r in slots:
        x, y = ox + left + c * pitch_x, oy + top + r * pitch_y
        if (c, r) == (1, 2):
            s.app("apple-touch-icon.png", x, y, icon, "squircle")
            s.text(x + icon / 2, y + icon + 15, APP, 12, anchor="middle", shadow=True)
            continue
        s.icon(k, x, y, icon, "squircle")
        s.text(x + icon / 2, y + icon + 15, labels[k], 12, anchor="middle", shadow=True)
        k += 1
    # Search pill, dock and home indicator
    s.add(pill(ox + (w - 92) / 2, oy + h - 150, 92, 30, "#fff", .22))
    s.add(f'<circle cx="{ox + w / 2 - 27}" cy="{oy + h - 136}" r="4.5" fill="none" stroke="#fff" stroke-width="1.6"/>'
          f'<path d="M{ox + w / 2 - 23.5} {oy + h - 132.5} l3.5 3.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>')
    s.text(ox + w / 2 + 8, oy + h - 130.5, "Search", 13, weight=500, anchor="middle")
    s.add(pill(ox + 12, oy + h - 108, w - 24, 88, "#fff", .2, rx=34))
    for i in range(4):
        s.icon(6 + i, ox + left + i * pitch_x, oy + h - 94, icon, "squircle")
    s.add(pill(ox + (w - 134) / 2, oy + h - 13, 134, 5, "#fff"))
    return s


def android():
    bezel, w, h = 12, 412, 915
    s = Scene(w + 2 * bezel, h + 2 * bezel)
    phone_frame(s, w, h, bezel, 34)
    ox, oy = bezel, bezel
    s.wallpaper("#20163a", [(.1, .2, .4, "#7e57c2"), (.9, .3, .35, "#ec407a"), (.3, .9, .45, "#3949ab"), (.9, .9, .3, "#26a69a")],
                ox, oy, w, h, rx=34)
    # Status bar with a punch-hole camera
    s.text(ox + 26, oy + 30, "14:27", 15, weight=500)
    s.add(f'<circle cx="{ox + w / 2}" cy="{oy + 24}" r="11" fill="#000"/>',
          wifi(ox + w - 84, oy + 31, 9), signal(ox + w - 68, oy + 31, 12), battery(ox + w - 46, oy + 21, 10.5))
    # At a glance
    s.text(ox + 30, oy + 108, "Tue, Sep 30", 26, weight=400)
    s.add(f'<circle cx="{ox + 38}" cy="{oy + 132}" r="7" fill="#ffd54f"/>')
    s.text(ox + 52, oy + 137.5, "18°C  Mostly sunny", 15, opacity=.9)
    # Apps: 4 columns of circles with labels, lower half of the screen
    icon, left, pitch_x, pitch_y, top = 58, 32, 98, 100, h - 450
    labels = ["Clock", "Calendar", "Photos", "Files", "Camera", "Settings", "Chat", "Notes", "Weather", "Music", "Store"]
    k = 0
    for r in range(3):
        for c in range(4):
            x, y = ox + left + c * pitch_x, oy + top + r * pitch_y
            if (c, r) == (2, 1):
                s.app("icon-maskable-512.png", x, y, icon, "circle")
                s.text(x + icon / 2, y + icon + 18, APP, 12.5, anchor="middle", shadow=True)
                continue
            s.icon(k + 1, x, y, icon, "circle")
            s.text(x + icon / 2, y + icon + 18, labels[k], 12.5, anchor="middle", shadow=True)
            k += 1
    # Hotseat, search bar and gesture bar
    for i in range(4):
        s.icon(7 + i, ox + left + i * pitch_x, oy + h - 150, icon, "circle")
    s.add(pill(ox + 24, oy + h - 76, w - 48, 52, "#e8def8"))
    s.add(f'<circle cx="{ox + 58}" cy="{oy + h - 50}" r="8" fill="none" stroke="#4a4458" stroke-width="2.4"/>'
          f'<path d="M{ox + 64} {oy + h - 44} l6 6" stroke="#4a4458" stroke-width="2.4" stroke-linecap="round"/>'
          f'<rect x="{ox + w - 70}" y="{oy + h - 61}" width="9" height="15" rx="4.5" fill="#4a4458"/>'
          f'<path d="M{ox + w - 74} {oy + h - 52} a8.5 8.5 0 0 0 17 0 M{ox + w - 65.5} {oy + h - 43.5} v5" fill="none" stroke="#4a4458" stroke-width="2" stroke-linecap="round"/>')
    s.add(pill(ox + (w - 108) / 2, oy + h - 12, 108, 4, "#fff", .85))
    return s


def ubuntu():
    s = Scene(960, 540)
    s.wallpaper("#2c001e", [(.2, .8, .45, "#e95420"), (.75, .25, .4, "#77216f"), (1, .9, .3, "#f08a24"), (.5, .5, .25, "#5e2750")])
    # Top bar: workspace dots, clock, system menu
    s.add(f'<rect width="{s.width}" height="32" fill="#000" fill-opacity=".92"/>',
          pill(14, 12, 30, 8, "#fff"), pill(50, 12, 8, 8, "#fff", .55))
    s.text(s.width / 2, 21, "Sep 30  14:27", 14, weight=700, anchor="middle")
    s.add(wifi(s.width - 70, 22, 8.5), battery(s.width - 52, 11, 10))
    s.add(f'<circle cx="{s.width - 16}" cy="16" r="5.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-dasharray="26 9" transform="rotate(-70 {s.width - 16} 16)"/>'
          f'<path d="M{s.width - 16} 9 v6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>')
    # Dock on the left, full height: stand-ins, ours hovered with its label, Show Apps at the bottom
    dock_w, icon, pitch = 64, 48, 58
    s.add(f'<rect x="0" y="32" width="{dock_w}" height="{s.height - 32}" fill="#1d1d1d" fill-opacity=".82"/>')
    items = [0, 5, 2, "app", 8, 9]
    for i, o in enumerate(items):
        x, y = (dock_w - icon) / 2, 44 + i * pitch
        if o == "app":
            s.add(pill(4, y - 4, dock_w - 8, icon + 8, "#fff", .12, rx=12))
            s.app("icon-512.png", x, y, icon, "square")
            s.add(f'<circle cx="3.5" cy="{y + icon / 2}" r="2" fill="#e95420"/>',
                  tooltip(APP, dock_w + 60, y + icon / 2 - 13, 13.5, "#353535", .96, rx=13))
        else:
            s.icon(o, x, y, icon, "rounded" if i % 2 else "circle")
            if o == 0:
                s.add(f'<circle cx="3.5" cy="{y + icon / 2 - 4}" r="2" fill="#e95420"/><circle cx="3.5" cy="{y + icon / 2 + 4}" r="2" fill="#e95420"/>')
    y = s.height - 60
    s.add("".join(f'<rect x="{dock_w / 2 - 11 + c * 8.5:.1f}" y="{y + 12 + r * 8.5:.1f}" width="4.5" height="4.5" rx="1" fill="#fff"/>'
                  for r in range(3) for c in range(3)))
    return s


def mint():
    s = Scene(960, 540)
    s.wallpaper("#1f2a24", [(.15, .3, .4, "#4e7d5b"), (.8, .2, .35, "#2f5d62"), (.6, .9, .4, "#8fa876"), (1, .6, .25, "#35524a")])
    # Desktop shortcuts: two folders and ours, the selected one
    def folder(x, y, size):
        return (f'<path d="M{x + size * .08} {y + size * .22} h{size * .3} l{size * .08} {size * .08} h{size * .46} v{size * .52} h-{size * .84}z" fill="#6f9a5d"/>'
                f'<rect x="{x + size * .08}" y="{y + size * .34}" width="{size * .84}" height="{size * .5}" rx="{size * .04}" fill="#8fb578"/>')
    for i, label in enumerate(("Computer", "Home", APP)):
        x, y = 24, 22 + i * 88
        if label == APP:
            s.add(pill(x - 12, y - 6, 72, 82, "#9ab87a", .35, rx=4))
            s.app("icon-512.png", x, y, 48, "square")
        else:
            s.add(folder(x, y, 48))
        s.text(x + 24, y + 66, label, 11.5, anchor="middle", shadow=True)
    # Bottom panel: menu, pinned apps (ours running and hovered), tray and clock
    ph, icon = 40, 26
    py = s.height - ph
    s.add(f'<rect x="0" y="{py}" width="{s.width}" height="{ph}" fill="#2b2b2b" fill-opacity=".96"/>')
    s.add(pill(10, py + 7, 26, 26, "#8fa876", rx=6),
          "".join(f'<rect x="{16.5 + c * 5.5}" y="{py + 13.5 + r * 5.5}" width="3.5" height="3.5" rx=".8" fill="#fff"/>' for r in range(3) for c in range(3)))
    x = 52
    for o in (0, 9, 5, "app", 2):
        if o == "app":
            s.add(pill(x - 5, py + 2, icon + 10, ph - 4, "#fff", .1, rx=4))
            s.app("icon-512.png", x, py + (ph - icon) / 2 - 1, icon, "square", shadow=False)
            s.add(f'<rect x="{x - 3}" y="{py + ph - 3}" width="{icon + 6}" height="2.5" fill="#8fa876"/>',
                  tooltip(APP, x + icon / 2, py - 32, 12, "#333333", .96, rx=4))
        else:
            s.icon(o, x, py + (ph - icon) / 2 - 1, icon, "rounded", shadow=False)
        x += icon + 16
    s.add(wifi(s.width - 110, py + 27, 8), battery(s.width - 94, py + 15.5, 9.5))
    s.text(s.width - 16, py + 25, "14:27", 13.5, weight=500, anchor="end")
    return s


def windows():
    """Windows 11 in the light theme, laid out after a real 25H2 screenshot: Chrome puts the
    installed app on the desktop (with the shortcut arrow) and under Recommended, not Pinned."""
    s = Scene(1280, 925)
    s.wallpaper("#0b2a4a", [(.15, .2, .35, "#1d5c8c"), (.85, .25, .3, "#2f8fb8"), (.6, .8, .4, "#0f3d63"), (.35, .6, .2, "#3fa6c9")])
    ink, muted = "#1b1b1b", "#5f5f5f"

    def shortcut_arrow(x, y):
        return (f'<rect x="{x}" y="{y}" width="14" height="14" fill="#fff"/>'
                f'<path d="M{x + 4} {y + 10} L{x + 10} {y + 4} M{x + 5.5} {y + 4} H{x + 10} V{y + 8.5}" stroke="#2b88d8" stroke-width="1.8" fill="none" stroke-linecap="round"/>')

    # Desktop shortcuts down the left edge; ours last, with the shortcut arrow
    for i, (o, label) in enumerate(((9, "Recycle Bin"), (0, "Browser"), (8, "Chat"), ("app", APP))):
        x, y = 12, 14 + i * 96
        if o == "app":
            s.app("icon-512.png", x, y, 48, "square", shadow=False)
        else:
            s.icon(o, x, y, 48, "rounded" if o == 9 else "circle", shadow=False)
        if i:
            s.add(shortcut_arrow(x, y + 34))
        s.text(x + 24, y + 66, label, 12, anchor="middle", shadow=True)

    # Start menu: search, Pinned, Recommended (ours, recently added), All by category, account bar
    ph, mw, mh = 48, 812, 845
    mx, my = (s.width - mw) / 2, s.height - ph - 12 - mh
    clip = s.uid("start")
    s.defs.append(f'<clipPath id="{clip}"><rect x="{mx}" y="{my}" width="{mw}" height="{mh}" rx="8"/></clipPath>')
    s.add(f'<g clip-path="url(#{clip})"><rect x="{mx}" y="{my}" width="{mw}" height="{mh}" fill="#eef1f5" fill-opacity=".97"/>'
          f'<rect x="{mx}" y="{my + mh - 63}" width="{mw}" height="63" fill="#e6e9ee"/></g>'
          f'<rect x="{mx}" y="{my}" width="{mw}" height="{mh}" rx="8" fill="none" stroke="#000" stroke-opacity=".1"/>')
    s.add(pill(mx + 32, my + 16, mw - 64, 30, "#fff", 1, stroke="#00000022", rx=15),
          f'<circle cx="{mx + 52}" cy="{my + 30}" r="5.5" fill="none" stroke="#005fb8" stroke-width="1.5"/>'
          f'<path d="M{mx + 56} {my + 34} l4 4" stroke="#005fb8" stroke-width="1.5" stroke-linecap="round"/>')
    s.text(mx + 74, my + 35.5, "Search for apps, settings, and documents", 13.5, muted)

    s.text(mx + 62, my + 107, "Pinned", 14, ink, 600)
    labels = ["Browser", "Mail", "Store", "Settings", "Photos", "Games", "Cards", "Paint", "Contacts", "Calculator", "Clock", "Notepad", "Snipping", "Files"]
    k = 0
    for r in range(2):
        for c in range(8 if r == 0 else 6):
            cx, cy = mx + 78 + c * 94, my + 152 + r * 83
            s.icon(k, cx - 16, cy - 16, 32, "circle" if k % 3 == 0 else "rounded", shadow=False)
            s.text(cx, cy + 32, labels[k], 12, ink, anchor="middle")
            k += 1

    s.text(mx + 62, my + 342, "Recommended", 14, ink, 600)
    s.text(mx + mw - 66, my + 341, "Show all", 13, ink, anchor="end")
    s.add(f'<path d="M{mx + mw - 58} {my + 333} l4 4 l-4 4" stroke="{ink}" stroke-width="1.2" fill="none"/>')

    def folder(x, y):
        return (f'<path d="M{x} {y + 5} h11 l3 3 h18 v19 h-32z" fill="#e8b33a"/>'
                f'<rect x="{x}" y="{y + 10}" width="32" height="18" rx="1.5" fill="#f6cf5b"/>')

    recent = [("app", APP, "Recently added"), ("folder", "Downloads", "17 Sep"), ("folder", "Projects", "16 Sep"),
              ("file", "Playlist.m3u8", "15 Sep"), ("folder", "Music", "8 Sep"), ("folder", "Archive", "8 Sep")]
    for i, (kind, name, when) in enumerate(recent):
        x, y = mx + 62 + (i % 3) * 250, my + 368 + (i // 3) * 55
        if kind == "app":
            s.app("icon-512.png", x, y, 32, "square", shadow=False)
        elif kind == "folder":
            s.add(folder(x, y))
        else:
            s.add(f'<path d="M{x + 5} {y} h15 l7 7 v25 h-22z" fill="#fff" stroke="#0000003a"/>'
                  f'<path d="M{x + 16} {y + 11} v10 m-4 -4 l4 4 l4 -4" stroke="#2b88d8" stroke-width="1.6" fill="none"/>')
        s.text(x + 43, y + 14, name, 12.5, ink)
        s.text(x + 43, y + 30, when, 12, muted)

    s.text(mx + 62, my + 522, "All", 14, ink, 600)
    s.text(mx + mw - 80, my + 521, "View: Category", 13, ink, anchor="end")
    s.add(f'<path d="M{mx + mw - 70} {my + 514} l4 4 l4 -4" stroke="{ink}" stroke-width="1.2" fill="none"/>')
    for i, name in enumerate(("Other", "Productivity", "Utilities & Tools", "Creativity")):
        tx, ty = mx + 62 + i * 179, my + 540
        s.add(f'<rect x="{tx}" y="{ty}" width="152" height="152" rx="8" fill="#fff" fill-opacity=".75" stroke="#000" stroke-opacity=".06"/>')
        for q in range(4):
            s.icon(i * 4 + q, tx + 28 + (q % 2) * 64, ty + 28 + (q // 2) * 64, 32, "rounded" if q % 2 else "circle", shadow=False)
        s.text(tx + 76, ty + 175, name, 12.5, ink, anchor="middle")
    for i in range(3):
        s.add(f'<rect x="{mx + 62 + i * 179}" y="{my + 740}" width="152" height="152" rx="8" fill="#fff" fill-opacity=".75" clip-path="url(#{clip})"/>')
    s.add(f'<rect x="{mx}" y="{my + mh - 63}" width="{mw}" height="63" fill="#e6e9ee" clip-path="url(#{clip})"/>'
          f'<rect x="{mx}" y="{my + mh - 63}" width="{mw}" height="1" fill="#000" fill-opacity=".07"/>'
          f'<circle cx="{mx + 77}" cy="{my + mh - 32}" r="14" fill="#d5d8de"/><circle cx="{mx + 77}" cy="{my + mh - 36}" r="4.5" fill="#6b6f76"/>'
          f'<path d="M{mx + 69} {my + mh - 25} a8 6 0 0 1 16 0" fill="#6b6f76"/>')
    s.text(mx + 105, my + mh - 27.5, "user", 12.5, ink)
    px, py0 = mx + mw - 71, my + mh - 32
    s.add(f'<circle cx="{px}" cy="{py0}" r="6.5" fill="none" stroke="{ink}" stroke-width="1.3" stroke-dasharray="30 11" transform="rotate(-70 {px} {py0})"/>'
          f'<path d="M{px} {py0 - 8} v7" stroke="{ink}" stroke-width="1.3" stroke-linecap="round"/>')

    # Taskbar: weather on the left; Start, Search box, Task View and apps centred (ours running); tray and clock
    py = s.height - ph
    s.add(f'<rect x="0" y="{py}" width="{s.width}" height="{ph}" fill="#eef1f5" fill-opacity=".96"/>'
          f'<rect x="0" y="{py}" width="{s.width}" height="1" fill="#000" fill-opacity=".08"/>')
    s.add(f'<circle cx="28" cy="{py + 22}" r="7" fill="#ffb900"/><path d="M22 {py + 33} a6 6 0 0 1 4 -10 a7 7 0 0 1 13 2 a4.5 4.5 0 0 1 0 8z" fill="#c9d3df"/>')
    s.text(48, py + 21, "9°C", 12, ink)
    s.text(48, py + 37, "Partly cloudy", 12, muted)
    x = s.width / 2 - 190
    s.add(pill(x, py + 4, 40, 40, "#fff", .7, rx=4),
          "".join(f'<rect x="{x + 9 + c * 11.5}" y="{py + 13 + r * 11.5}" width="10.5" height="10.5" rx="1" fill="#1a8cff"/>' for r in range(2) for c in range(2)))
    x += 46
    s.add(pill(x, py + 8, 210, 32, "#fff", 1, stroke="#00000020", rx=16),
          f'<circle cx="{x + 21}" cy="{py + 23}" r="5.5" fill="none" stroke="{ink}" stroke-width="1.5"/>'
          f'<path d="M{x + 25} {py + 27} l4 4" stroke="{ink}" stroke-width="1.5" stroke-linecap="round"/>')
    s.text(x + 40, py + 28.5, "Search", 14, muted)
    x += 220
    s.add(f'<rect x="{x + 10}" y="{py + 15}" width="13" height="13" rx="2" fill="#1b1b1b"/><rect x="{x + 16}" y="{py + 20}" width="13" height="13" rx="2" fill="#fff" stroke="#1b1b1b" stroke-width="1.2"/>')
    x += 44
    for o in ("folder", 0, "app"):
        if o == "folder":
            s.add(f'<g transform="translate({x + 8} {py + 10}) scale(.75)">{folder(0, 0)}</g>')
        elif o == "app":
            s.add(pill(x, py + 4, 40, 40, "#fff", .7, rx=4))
            s.app("icon-512.png", x + 8, py + 12, 24, "square", shadow=False)
            s.add(pill(x + 13, py + ph - 6, 14, 3, "#005fb8"))
        else:
            s.icon(o, x + 8, py + 12, 24, "circle", shadow=False)
            s.add(pill(x + 17, py + ph - 6, 6, 3, "#8a8a8a"))
        x += 44
    rx0 = s.width - 250
    s.add(f'<path d="M{rx0} {py + 27} l5 -5 l5 5" stroke="{ink}" stroke-width="1.3" fill="none"/>')
    s.text(rx0 + 44, py + 21, "ENG", 11.5, ink, anchor="middle")
    s.text(rx0 + 44, py + 37, "FI", 11.5, ink, anchor="middle")
    s.add(wifi(rx0 + 82, py + 30, 8, ink),
          f'<path d="M{rx0 + 98} {py + 21} h3 l5 -4 v14 l-5 -4 h-3z" fill="{ink}"/><path d="M{rx0 + 109} {py + 20} a5 5 0 0 1 0 8" stroke="{ink}" stroke-width="1.2" fill="none"/>',
          battery(rx0 + 120, py + 19, 9, ink))
    s.text(s.width - 16, py + 21, "9:06", 12, ink, anchor="end")
    s.text(s.width - 16, py + 37, "01/10/2026", 12, ink, anchor="end")
    return s


SCENES = {"macos": macos, "ios": ios, "android": android, "ubuntu": ubuntu, "linux-mint": mint, "windows-11": windows}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(REPO / "docs" / "mockups"), help="output folder (default: docs/mockups)")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, build in SCENES.items():
            scene = build()
            svg = Path(tmp) / f"{name}.svg"
            svg.write_text(scene.svg())
            png = out / f"{name}.png"
            subprocess.run(["rsvg-convert", "-w", str(scene.width * SCALE), "-h", str(scene.height * SCALE), str(svg), "-o", str(png)], check=True)
            print(png.relative_to(REPO) if png.is_relative_to(REPO) else png)


if __name__ == "__main__":
    main()
