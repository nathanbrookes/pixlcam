// Animated version of the app icon (option 1E) with brief glitch bursts.
// Usage: node tools/make-gif.mjs [size] [--square] [--strip out.png]
//   → design/pixlcam-icon-<size>.gif  (default 128, rounded app-icon corners, transparent outside)
//   --square  keeps the full square instead (→ pixlcam-icon-<size>-square.gif)
//   --strip   also writes every frame side by side, for reviewing.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { C, Grid, camera, fringe, shiftRows, renderIcon, roundedMask } from './icons.mjs';
import { encodeGIF } from './gif.mjs';
import { encodePNG } from './png.mjs';

const args = process.argv.slice(2);
const size = Number(args.find((a) => /^\d+$/.test(a)) || 128);
const square = args.includes('--square');
const stripPath = args.includes('--strip') ? args[args.indexOf('--strip') + 1] : null;

const cam = (o) => camera(new Grid(24), o);
const split = (g, d = 1) => fringe(g, C.mag, C.cyan, d);

// [art, delay in 1/100 s]
const FRAMES = [
  [split(cam()), 140], // calm
  [split(shiftRows(cam(), 9, 10, 2)), 6], // slice slides right
  [split(shiftRows(shiftRows(cam(), 13, 14, -2), 17, 17, 1), 2).rect(20, 15, 3, 1, C.cyan).rect(1, 10, 2, 1, C.mag), 6],
  [split(cam(), 2), 5], // RGB split pulse
  [split(cam()), 110], // calm
  [split(shiftRows(cam(), 0, 23, -1), 2), 4], // whole-frame jitter
  [split(shiftRows(cam(), 11, 12, 1)).rect(3, 20, 4, 1, C.cyan), 5],
  [split(cam()), 150], // calm
  [split(cam({ glint: C.cyan })), 7], // lens glint flicker
  [split(cam()), 6],
  [split(cam({ glint: C.mag })), 6],
];

const frames = FRAMES.map(([art, delay]) => ({
  rgb: renderIcon({ art, bg: '#000000', scan: 0.16 }, size),
  delay,
}));

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `pixlcam-icon-${size}${square ? '-square' : ''}.gif`);
const gif = encodeGIF(size, size, frames, { mask: square ? null : roundedMask(size) });
writeFileSync(file, gif);
const total = FRAMES.reduce((s, [, d]) => s + d, 0) / 100;
console.log('wrote', file, `${frames.length} frames, ${total}s loop, ${(gif.length / 1024).toFixed(1)} KB`);

if (stripPath) {
  const gap = 8;
  const W = frames.length * (size + gap) + gap;
  const H = size + gap * 2;
  const out = new Uint8Array(W * H * 3).fill(48);
  frames.forEach((f, n) => {
    for (let y = 0; y < size; y++) {
      out.set(f.rgb.subarray(y * size * 3, (y + 1) * size * 3), ((gap + y) * W + gap + n * (size + gap)) * 3);
    }
  });
  writeFileSync(stripPath, encodePNG(W, H, out));
}
