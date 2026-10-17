// Generates the app icons in icons/ from one of the designs in tools/icons.mjs.
// To change the app icon, set APP_ICON to another design id and re-run:
//   node tools/make-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESIGNS, SPLIT_VARIANTS, renderIcon } from './icons.mjs';
import { encodePNG } from './png.mjs';

const APP_ICON = 'split-black'; // option 1E

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const design = [...DESIGNS, ...SPLIT_VARIANTS].find((d) => d.id === APP_ICON);
if (!design) throw new Error(`No icon design with id "${APP_ICON}"`);

const OUTPUTS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  // Android crops "maskable" icons to a circle or squircle, so this one keeps the art
  // inside the central safe zone.
  ['icon-maskable-512.png', 512, { fill: 0.62 }],
];

for (const [name, size, override] of OUTPUTS) {
  const spec = { ...design.make(), ...override };
  writeFileSync(join(outDir, name), encodePNG(size, size, renderIcon(spec, size)));
  console.log('wrote', name);
}
