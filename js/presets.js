// Preset looks + randomizer. A preset lists only the effects it turns on;
// everything else is switched off and reset.

import { EFFECTS, EFFECTS_BY_ID } from './effects.js';

export const PRESETS = [
  { name: 'Clean', fx: {} },
  {
    name: 'VHS Tape',
    fx: {
      vhs: { wobble: 35, jitter: 30, track: 55, bleed: 70, noise: 35 },
      rgb: { dist: 6, mode: 0 },
      crt: { scan: 35, mask: 0, curve: 0, vig: 50 },
      grain: { amount: 25 },
    },
  },
  {
    name: 'Melt',
    fx: {
      sort: { mix: 65, tone: 60, streak: 30, angle: 90 },
      rgb: { dist: 10, angle: 90 },
    },
  },
  {
    name: 'Shatter',
    fx: {
      sort: { mix: 50, tone: 45, streak: 12, ragged: 80, angle: 0 },
      glitch: { density: 35, size: 80, shift: 25, color: 30, speed: 30 },
    },
  },
  {
    name: '8-Bit',
    fx: {
      color: { sat: 140, con: 120 },
      pixelate: { size: 14 },
      dither: { pix: 1, levels: 4, palette: 2, pattern: 1 },
    },
  },
  {
    name: 'Corrupt',
    fx: {
      glitch: { density: 75, size: 90, shift: 60, color: 70, speed: 60 },
      rgb: { dist: 30, mode: 2 },
      color: { swap: 3, sat: 160 },
    },
  },
  {
    name: 'Vapor',
    fx: {
      color: { hue: -40, sat: 140 },
      rgb: { dist: 25, mode: 1 },
      dither: { pix: 2, levels: 3, palette: 5 },
      crt: { scan: 40, curve: 20, vig: 40, mask: 20 },
    },
  },
  {
    name: 'Arcade',
    fx: {
      pixelate: { size: 9, shape: 1 },
      crt: { scan: 60, curve: 45, vig: 60, mask: 35 },
      color: { sat: 170, con: 125 },
    },
  },
  {
    name: '1-Bit',
    fx: {
      color: { con: 140 },
      dither: { pix: 3, levels: 2, palette: 1, pattern: 0 },
    },
  },
  {
    name: 'Heat',
    fx: {
      dither: { pix: 1, levels: 8, palette: 6, pattern: 2 },
      glitch: { density: 20, size: 40, shift: 15, color: 10, speed: 20 },
    },
  },
];

// How likely each effect is to be picked, and sane ranges for random params.
const RANDOM = {
  glitch: { chance: 0.45, p: { density: [15, 70], size: [20, 160], shift: [10, 60], color: [0, 70], speed: [0, 70] } },
  rgb: { chance: 0.6, p: { dist: [4, 50] } },
  sort: { chance: 0.4, p: { mix: [35, 75], tone: [30, 70], streak: [8, 45], ragged: [20, 90], angle: { pick: [0, 90, 180, 270, 45] }, mask: { pick: [0, 0, 0, 1] } } },
  pixelate: { chance: 0.25, p: { size: [6, 40] } },
  vhs: { chance: 0.3, p: {} },
  dither: { chance: 0.3, p: { pix: [1, 6], levels: [2, 5] } },
  crt: { chance: 0.25, p: { curve: [0, 50] } },
  grain: { chance: 0.45, p: { amount: [10, 50] } },
  color: { chance: 0.4, p: { hue: [-180, 180], sat: [60, 200], con: [80, 150], bri: [0, 0], sol: [0, 0] } },
};

const rnd = (a, b) => Math.round(a + Math.random() * (b - a));

export function randomLook() {
  const fx = {};
  const ids = Object.keys(RANDOM).sort(() => Math.random() - 0.5);
  for (const id of ids) {
    if (Math.random() > RANDOM[id].chance) continue;
    const p = {};
    for (const def of EFFECTS_BY_ID[id].params) {
      const r = RANDOM[id].p[def.id];
      if (r?.pick) p[def.id] = r.pick[Math.floor(Math.random() * r.pick.length)];
      else if (r) p[def.id] = rnd(r[0], r[1]);
      else if (def.id === 'mix') p.mix = rnd(70, 100);
      else if (def.type === 'range') p[def.id] = rnd(def.min, def.max);
      else if (def.type === 'select') p[def.id] = rnd(0, def.options.length - 1);
      else if (def.type === 'toggle') p[def.id] = Math.random() < 0.15;
    }
    fx[id] = p;
  }
  // Always at least two effects, never more than four.
  const picked = Object.keys(fx);
  if (picked.length < 2) {
    for (const id of ['rgb', 'glitch']) if (!fx[id]) fx[id] = {};
  }
  for (const id of picked.slice(4)) delete fx[id];
  return { name: 'Random', fx };
}

export const ALL_IDS = EFFECTS.map((e) => e.id);
