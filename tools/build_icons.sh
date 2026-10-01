#!/usr/bin/env bash
# Rebuild the app icons from icons/icon-source.png (1024x1024, square, on a plain background).
# The "any" icons and the favicon get rounded corners; the maskable and Apple icons stay
# square, since those platforms apply their own mask.
# Needs rsvg-convert (brew install librsvg) and ImageMagick (brew install imagemagick).
set -euo pipefail
cd "$(dirname "$0")/../icons"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# The artwork is drawn nearly edge to edge, which the platforms' masks (squircle,
# circle) crop. Scale it to ART_PERCENT of the side on its own background colour,
# so it keeps inside Android's maskable safe zone (the middle 80 %) too.
art="${ART_PERCENT:-78}"
bg="$(magick icon-source.png -format '%[pixel:p{0,0}]' info:)"
magick -size 1024x1024 "xc:$bg" \( icon-source.png -resize "${art}%" \) -gravity center -composite "$tmp/padded.png"
# Corner radius is 7/32 of the side, as in the old SVG favicon
magick -size 1024x1024 xc:none -fill white -draw "roundrectangle 0,0,1023,1023,224,224" "$tmp/mask.png"
magick "$tmp/padded.png" "$tmp/mask.png" -alpha off -compose CopyOpacity -composite "$tmp/rounded.png"
magick "$tmp/rounded.png" -resize 192x192 -strip icon-192.png
magick "$tmp/rounded.png" -resize 512x512 -strip icon-512.png
magick "$tmp/padded.png" -resize 512x512 -alpha off -strip icon-maskable-512.png
magick "$tmp/padded.png" -resize 180x180 -alpha off -strip apple-touch-icon.png
# Classic favicon at the site root, which many crawlers fetch without reading the page
magick "$tmp/rounded.png" -define icon:auto-resize=48,32,16 ../favicon.ico
# Link preview card; its text uses Helvetica Neue (macOS), falling back to Arial
rsvg-convert -w 1200 -h 630 og-image.svg -o og-image.png
# Mock-ups of the icon on macOS, iOS, Android, Ubuntu, Linux Mint and Windows 11, and
# close-ups of each platform's mask, into docs/mockups
python3 ../tools/build_mockups.py
