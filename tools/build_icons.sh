#!/usr/bin/env bash
# Rebuild the app icons from icons/icon.svg (the favicon) and icons/icon-square.svg
# (the same art without rounded corners, for platforms that apply their own mask).
# Needs rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/../icons"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-square.svg -o icon-maskable-512.png
rsvg-convert -w 180 -h 180 icon-square.svg -o apple-touch-icon.png
