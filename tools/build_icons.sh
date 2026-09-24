#!/usr/bin/env bash
# Rebuild the app icons from icons/icon.svg (the favicon) and icons/icon-square.svg
# (the same art without rounded corners, for platforms that apply their own mask).
# Needs rsvg-convert (brew install librsvg) and ImageMagick (brew install imagemagick).
set -euo pipefail
cd "$(dirname "$0")/../icons"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-square.svg -o icon-maskable-512.png
rsvg-convert -w 180 -h 180 icon-square.svg -o apple-touch-icon.png
# Classic favicon at the site root, which many crawlers fetch without reading the page
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
for size in 16 32 48; do rsvg-convert -w $size -h $size icon.svg -o "$tmp/$size.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" ../favicon.ico
# Link preview card; its text uses Helvetica Neue (macOS), falling back to Arial
rsvg-convert -w 1200 -h 630 og-image.svg -o og-image.png
