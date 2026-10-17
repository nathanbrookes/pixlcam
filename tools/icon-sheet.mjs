// Builds a labelled comparison sheet of icon designs into design/.
// Each option shows the full icon (rounded like a home screen) plus small previews
// at roughly real home-screen sizes.
// Usage: node tools/icon-sheet.mjs          → all concepts (icon-options.png)
//        node tools/icon-sheet.mjs split    → variations of option 01 (icon-01-variations.png)

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESIGNS, SPLIT_VARIANTS, renderIcon, hex, mix } from './icons.mjs';
import { encodePNG } from './png.mjs';

const SETS = {
  all: {
    title: 'PIXLCAM ICON OPTIONS',
    file: 'icon-options.png',
    items: DESIGNS.map((d, i) => ({ ...d, code: String(i + 1).padStart(2, '0') })),
  },
  split: {
    title: 'OPTION 01 VARIATIONS',
    file: 'icon-01-variations.png',
    items: SPLIT_VARIANTS.map((d, i) => ({ ...d, code: '1' + 'ABCDEFGHIJKL'[i] })),
  },
};
const set = SETS[process.argv[2] || 'all'];

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design');
mkdirSync(outDir, { recursive: true });

// 5×7 pixel font.
const FONT = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.', D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.', J: '..###...#....#....#....##..#..##...',
  K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.', P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.', V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  0: '.###.#...##..###.#.###..##...#.###.', 1: '..#...##....#....#....#....#...###.',
  2: '.###.#...#....#...#...#...#...#####', 3: '#####...#...#.....#....##...#.###.',
  4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.',
  6: '..##..#...#....####.#...##...#.###.', 7: '#####....#...#...#...#....#....#...',
  8: '.###.#...##...#.###.#...##...#.###.', 9: '.###.#...##...#.####....#...#..##..',
  '-': '...............#####...............', ' ': '.'.repeat(35),
};

const W = 1260;
const COLS = 4;
const CELL_W = 300;
const CELL_H = 400;
const MARGIN = 30;
const HEADER = 96;
const rows = Math.ceil(set.items.length / COLS);
const H = HEADER + rows * CELL_H + MARGIN;
const SHEET_BG = hex('#1b1b24');
const sheet = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) sheet.set(SHEET_BG, i * 3);

function put(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  sheet.set(c, (y * W + x) * 3);
}

function text(str, x, y, scale, color) {
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let i = 0; i < 35; i++) {
      if (g[i] !== '#') continue;
      const gx = x + (i % 5) * scale;
      const gy = y + Math.floor(i / 5) * scale;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(gx + dx, gy + dy, color);
    }
    x += 6 * scale;
  }
}

// Box-filter downscale by an integer factor.
function downscale(rgb, size, f) {
  const n = size / f;
  const out = new Uint8Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) acc += rgb[((y * f + j) * size + (x * f + i)) * 3 + c];
      out[(y * n + x) * 3 + c] = Math.round(acc / (f * f));
    }
  }
  return out;
}

// Paste an icon with iOS-style rounded corners (anti-aliased).
function pasteRounded(rgb, size, px, py) {
  const r = size * 0.2237;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const qx = cx < r ? r : cx > size - r ? size - r : cx;
    const qy = cy < r ? r : cy > size - r ? size - r : cy;
    const a = Math.min(1, Math.max(0, r - Math.hypot(cx - qx, cy - qy) + 0.5));
    if (a <= 0) continue;
    const c = [rgb[(y * size + x) * 3], rgb[(y * size + x) * 3 + 1], rgb[(y * size + x) * 3 + 2]];
    const i = ((py + y) * W + (px + x)) * 3;
    put(px + x, py + y, mix([sheet[i], sheet[i + 1], sheet[i + 2]], c, a));
  }
}

// Title with the brand RGB split.
text(set.title, MARGIN - 3, 34, 4, hex('#ff2e88'));
text(set.title, MARGIN + 3, 34, 4, hex('#00e5ff'));
text(set.title, MARGIN, 34, 4, hex('#f4f4f8'));

set.items.forEach((d, i) => {
  const cx = MARGIN + (i % COLS) * CELL_W;
  const cy = HEADER + Math.floor(i / COLS) * CELL_H;
  text(d.code, cx + 30, cy + 10, 3, hex('#ffffff'));
  text(d.name, cx + 30 + (d.code.length + 1) * 6 * 3, cy + 10, 3, hex('#9a9ab0'));

  const big = renderIcon(d.make(), 240);
  pasteRounded(big, 240, cx + 30, cy + 44);
  pasteRounded(downscale(big, 240, 4), 60, cx + 30, cy + 302);
  pasteRounded(downscale(big, 240, 6), 40, cx + 106, cy + 312);
});

const file = join(outDir, set.file);
writeFileSync(file, encodePNG(W, H, sheet));
console.log('wrote', file, `${W}×${H}`);
