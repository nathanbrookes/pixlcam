// Generates the app icons (pixel "P" with an RGB split) as PNGs using only Node built-ins.
// Usage: node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const GLYPH = [
  'XXXX.',
  'X...X',
  'X...X',
  'XXXX.',
  'X....',
  'X....',
  'X....',
];

// Glyph coverage at a point in "glyph pixel" units.
function glyph(gx, gy) {
  const x = Math.floor(gx);
  const y = Math.floor(gy);
  if (y < 0 || y >= GLYPH.length || x < 0 || x >= GLYPH[0].length) return 0;
  return GLYPH[y][x] === 'X' ? 1 : 0;
}

function render(size) {
  const px = new Uint8Array(size * size * 3);
  const cell = size / 13; // glyph pixel size; 5×7 glyph sits well inside the maskable safe zone
  const ox = (size - 5 * cell) / 2;
  const oy = (size - 7 * cell) / 2;
  const split = cell * 0.28;
  const bg = [7, 7, 10];

  for (let y = 0; y < size; y++) {
    // glitch slices: a couple of bands shifted sideways
    const band = y / size;
    let shift = 0;
    if (band > 0.36 && band < 0.41) shift = cell * 0.55;
    if (band > 0.62 && band < 0.655) shift = -cell * 0.4;

    for (let x = 0; x < size; x++) {
      const gx = (x - ox - shift) / cell;
      const gy = (y - oy) / cell;
      const r = glyph(gx + split / cell, gy);
      const g = glyph(gx, gy);
      const b = glyph(gx - split / cell, gy);
      const scan = y % Math.max(2, Math.round(size / 96)) === 0 ? 0.82 : 1;
      const i = (y * size + x) * 3;
      // white where all overlap, magenta/cyan fringes otherwise
      px[i] = Math.round((g ? 255 : r ? 255 : b ? 0 : bg[0]) * scan);
      px[i + 1] = Math.round((g ? 255 : r ? 46 : b ? 229 : bg[1]) * scan);
      px[i + 2] = Math.round((g ? 255 : r ? 136 : b ? 255 : bg[2]) * scan);
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(outDir, name), png(size, render(size)));
  console.log('wrote', name);
}
