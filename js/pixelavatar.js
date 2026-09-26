/*
 * pixelavatar.js — deterministic pixel-array avatars from a text seed, output as SVG.
 * Works as ES module-less script (window.PixelAvatar) or CommonJS.
 *
 * PixelAvatar.svg(seed, options) -> string
 * PixelAvatar.grid(seed, options) -> { cols, rows, cells: number[][], palette: string[] }
 *
 * Options:
 *   cols, rows       grid resolution (default 8 x 8)
 *   mirror           'none' | 'x' | 'y' | 'xy' (default 'x')
 *   symmetry         'full' | 'half' — half keeps a random slice unmirrored for variation (default 'full')
 *   colors           number of foreground colors, 1..8 (default 3)
 *   color            null | CSS color | CSS color[] — foreground colors come from here instead of the
 *                    generated palette; with a list, the seed picks `colors` of them (default null)
 *   background       CSS color or null for transparent (default auto from seed)
 *   pixelAspect      pixel width / height (default 1; e.g. 2 for C64 multicolor)
 *   size             target size in px of the longer side (default 256)
 *   density          0..1 chance a cell is filled (default 0.5)
 *   slide            null | 'auto' | { from, to, angle } — a two-color linear gradient ("color slide");
 *                    'auto' derives the hues and angle from the seed (default null)
 *   slideMode        'overlay' lays the slide over the whole image, 'pixels' over the filled cells only,
 *                    'background' paints it behind the pixels in place of `background` (default 'overlay')
 *   slideOpacity     0..1 opacity of an overlay slide (default 0.5)
 *   slideBlend       CSS mix-blend-mode of an overlay slide, e.g. 'overlay', 'color' (default 'normal')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PixelAvatar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    cols: 8, rows: 8, mirror: 'x', symmetry: 'full', colors: 3,
    color: null, background: 'auto', pixelAspect: 1, size: 256, density: 0.5,
    slide: null, slideMode: 'overlay', slideOpacity: 0.5, slideBlend: 'normal',
  };

  // cyrb128 string hash -> mulberry32 PRNG
  function hashSeed(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044559);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
  }

  function rng(seed) {
    let a = hashSeed(String(seed));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makePalette(rand, count) {
    const baseHue = rand() * 360;
    const step = 360 / (count + 1) * (0.5 + rand());
    const out = [];
    for (let i = 0; i < count; i++) {
      const h = (baseHue + i * step) % 360;
      const s = 45 + rand() * 45;
      const l = 35 + rand() * 35;
      out.push(`hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`);
    }
    const bg = `hsl(${((baseHue + 180) % 360).toFixed(0)} ${(10 + rand() * 20).toFixed(0)}% ${(8 + rand() * 12).toFixed(0)}%)`;
    return { fg: out, bg };
  }

  function pickColors(rand, color, count) {
    const pool = Array.isArray(color) ? color.slice() : [color];
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!pool.length) pool.push(...out);   // fewer colors than asked: repeat
      out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    return out;
  }

  function autoSlide(rand) {
    const h1 = Math.floor(rand() * 360);
    const h2 = (h1 + 40 + Math.floor(rand() * 100)) % 360;
    return { from: `hsl(${h1} 70% 45%)`, to: `hsl(${h2} 75% 30%)`, angle: Math.floor(rand() * 360) };
  }

  // A CSS-style angle (0 = bottom to top, clockwise) as gradient end points in the unit box.
  function slidePoints(angle) {
    const rad = ((angle || 0) * Math.PI) / 180;
    const dx = Math.sin(rad) / 2, dy = -Math.cos(rad) / 2;
    const f = (n) => +n.toFixed(4);
    return `x1="${f(0.5 - dx)}" y1="${f(0.5 - dy)}" x2="${f(0.5 + dx)}" y2="${f(0.5 + dy)}"`;
  }

  function grid(seed, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const cols = Math.max(1, o.cols | 0), rows = Math.max(1, o.rows | 0);
    const colorCount = Math.min(8, Math.max(1, o.colors | 0));
    const rand = rng(seed);
    const { fg, bg } = makePalette(rand, colorCount);

    const mx = o.mirror === 'x' || o.mirror === 'xy';
    const my = o.mirror === 'y' || o.mirror === 'xy';
    const srcCols = mx ? Math.ceil(cols / 2) : cols;
    const srcRows = my ? Math.ceil(rows / 2) : rows;

    const pick = () => (rand() < o.density ? 1 + Math.floor(rand() * colorCount) : 0);

    const cells = [];
    for (let y = 0; y < rows; y++) {
      cells.push(new Array(cols).fill(0));
    }
    for (let y = 0; y < srcRows; y++) {
      for (let x = 0; x < srcCols; x++) cells[y][x] = pick();
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const sx = mx && x >= srcCols ? cols - 1 - x : x;
        const sy = my && y >= srcRows ? rows - 1 - y : y;
        cells[y][x] = cells[sy][sx];
      }
    }

    // Half symmetry: re-randomize the mirrored half of a random band so the result is only partly symmetric.
    if (o.symmetry === 'half' && (mx || my)) {
      if (mx) {
        const start = Math.floor(rand() * rows / 2), len = Math.max(1, Math.floor(rows / 2));
        for (let y = start; y < Math.min(rows, start + len); y++)
          for (let x = srcCols; x < cols; x++) cells[y][x] = pick();
      }
      if (my) {
        const start = Math.floor(rand() * cols / 2), len = Math.max(1, Math.floor(cols / 2));
        for (let x = start; x < Math.min(cols, start + len); x++)
          for (let y = srcRows; y < rows; y++) cells[y][x] = pick();
      }
    }

    // Picked after the cells, so a given seed draws the same shape with or without `color`.
    const palette = o.color == null ? fg : pickColors(rand, o.color, colorCount);
    const background = o.background === 'auto' ? bg : o.background;
    const slide = o.slide === 'auto' ? autoSlide(rand) : o.slide || null;
    return { cols, rows, cells, palette, background, slide };
  }

  function svg(seed, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const g = grid(seed, o);
    const aspect = o.pixelAspect > 0 ? o.pixelAspect : 1;
    // viewBox in unit cells, pixel width scaled by aspect
    const vbW = g.cols * aspect, vbH = g.rows;
    const scale = o.size / Math.max(vbW, vbH);
    const w = +(vbW * scale).toFixed(2), h = +(vbH * scale).toFixed(2);

    // Merge horizontal runs of the same color into one rect per color path.
    const paths = g.palette.map(() => []);
    for (let y = 0; y < g.rows; y++) {
      let x = 0;
      while (x < g.cols) {
        const c = g.cells[y][x];
        let run = 1;
        while (x + run < g.cols && g.cells[y][x + run] === c) run++;
        if (c) paths[c - 1].push(`M${x * aspect} ${y}h${run * aspect}v1h${-run * aspect}z`);
        x += run;
      }
    }

    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vbW} ${vbH}" shape-rendering="crispEdges">`;
    const full = `width="${vbW}" height="${vbH}"`;
    let slideFill = null;
    if (g.slide) {
      const id = `s${rng(seed)().toString(36).slice(2, 10)}`;   // unique enough when several SVGs share a page
      out += `<defs><linearGradient id="${id}" ${slidePoints(g.slide.angle)}>` +
        `<stop offset="0" stop-color="${g.slide.from}"/><stop offset="1" stop-color="${g.slide.to}"/></linearGradient></defs>`;
      slideFill = `url(#${id})`;
    }
    const overlay = slideFill && o.slideMode !== 'background';
    const clip = overlay && o.slideMode === 'pixels' ? `${slideFill.slice(5, -1)}c` : null;
    if (clip) out = out.replace('</defs>', `<clipPath id="${clip}"><path d="${paths.flat().join('')}"/></clipPath></defs>`);
    if (slideFill && !overlay) out += `<rect ${full} fill="${slideFill}"/>`;
    else if (g.background) out += `<rect ${full} fill="${g.background}"/>`;
    paths.forEach((d, i) => { if (d.length) out += `<path fill="${g.palette[i]}" d="${d.join('')}"/>`; });
    if (overlay) {
      const blend = o.slideBlend && o.slideBlend !== 'normal' ? ` style="mix-blend-mode:${o.slideBlend}"` : '';
      out += `<rect ${full} fill="${slideFill}" opacity="${o.slideOpacity}"${clip ? ` clip-path="url(#${clip})"` : ''}${blend}/>`;
    }
    return out + '</svg>';
  }

  return { svg, grid, rng, DEFAULTS };
});
