// Pixel-art icon designs for PIXLCAM, plus a renderer that turns a design into an
// app-icon bitmap at any size. Used by tools/icon-sheet.mjs (comparison sheet) and
// tools/make-icons.mjs (the real app icons).

// ───────────────────────── colors & helpers ─────────────────────────

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const C = {
  white: hex('#f4f4f8'),
  dark: hex('#0b0b12'),
  ink: hex('#07070a'),
  gray: hex('#4a4a5e'),
  glass: hex('#141a3a'),
  mag: hex('#ff2e88'),
  cyan: hex('#00e5ff'),
  yel: hex('#ffd23f'),
  orange: hex('#ff8a3d'),
  green: hex('#3dff9a'),
  violet: hex('#7b5cff'),
};

// Deterministic randomness so the designs are the same every run.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bayer4 = (x, y) => {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
};

// ───────────────────────── pixel grid ─────────────────────────

const paint = (c, x, y) => (typeof c === 'function' ? c(x, y) : c);

export class Grid {
  constructor(w, h = w) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);
  }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = paint(c, x, y);
    return this;
  }
  clone() { const g = new Grid(this.w, this.h); g.px = this.px.slice(); return g; }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }
  // Rectangle with its four corner pixels left out.
  round(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        const corner = (i === x || i === x + w - 1) && (j === y || j === y + h - 1);
        if (!corner) this.set(i, j, c);
      }
    }
    return this;
  }
  // Pixels whose centers fall within radius r of (cx, cy); r0 > 0 makes a ring.
  disc(cx, cy, r, c, r0 = -1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r0) this.set(x, y, c);
      }
    }
    return this;
  }
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y, this.get(x, y));
  }
}

// ───────────────────────── effects ─────────────────────────

// Brand RGB split: a colored fringe just outside the left and right edges.
// d = fringe width; dy ≠ 0 offsets it diagonally.
export function fringe(g, left = C.mag, right = C.cyan, d = 1, dy = 0) {
  const out = g.clone();
  g.each((x, y, c) => {
    if (c) return;
    if (g.get(x + d, y + dy)) out.set(x, y, left);
    else if (g.get(x - d, y - dy)) out.set(x, y, right);
  });
  return out;
}

// Slide rows y0..y1 sideways by dx (a glitch slice).
export function shiftRows(g, y0, y1, dx) {
  const out = g.clone();
  for (let y = y0; y <= y1; y++) for (let x = 0; x < g.w; x++) out.px[y * g.w + x] = g.get(x - dx, y);
  return out;
}

// 1px line along the inside edge of a shape.
export function outline(g, color) {
  const out = new Grid(g.w, g.h);
  g.each((x, y, c) => {
    if (c && (!g.get(x - 1, y) || !g.get(x + 1, y) || !g.get(x, y - 1) || !g.get(x, y + 1))) out.set(x, y, color);
  });
  return out;
}

// 1px line just outside a shape.
export function halo(g, color) {
  const out = g.clone();
  g.each((x, y, c) => {
    if (!c && (g.get(x - 1, y) || g.get(x + 1, y) || g.get(x, y - 1) || g.get(x, y + 1))) out.set(x, y, color);
  });
  return out;
}

// ───────────────────────── the camera ─────────────────────────

// Classic camera front: body, viewfinder hump, shutter button, window, lens.
export function camera(g, o = {}) {
  const {
    x = 1, y = 6, w = 22, h = 14,
    body = C.white, hump = body, button = C.mag, window = C.dark,
    lens = true, cx = x + w / 2, cy = y + h / 2, R = 6.2,
    rim = C.dark, barrel = C.gray, glass = C.glass, glint = C.white,
  } = o;
  g.round(x + 3, y - 2, 7, 3, hump);
  if (button) g.rect(x + w - 6, y - 1, 3, 1, button);
  g.round(x, y, w, h, body);
  if (window) g.rect(x + 2, y + 2, 3, 2, window);
  if (lens) {
    g.disc(cx, cy, R, rim);
    g.disc(cx, cy, R - 1, barrel);
    g.disc(cx, cy, R - 2.4, glass);
    const gx = Math.floor(cx);
    const gy = Math.floor(cy);
    g.set(gx - 2, gy - 2, glint).set(gx - 1, gy - 2, glint).set(gx - 2, gy - 1, glint);
  }
  return g;
}

// ───────────────────────── designs ─────────────────────────
// Each returns { art: Grid, bg, fill?, scan?, led?, glow? }.

export const DESIGNS = [
  {
    id: 'split',
    name: 'SPLIT',
    make: () => splitSpec(),
  },

  {
    id: 'sliced',
    name: 'SLICED',
    make() {
      let g = camera(new Grid(24));
      g = shiftRows(g, 8, 9, 2);
      g = shiftRows(g, 13, 14, -3);
      g = shiftRows(g, 17, 17, 2);
      g = fringe(g);
      g.rect(20, 15, 3, 1, C.cyan).rect(1, 10, 2, 1, C.mag).rect(21, 9, 1, 1, C.white).rect(3, 20, 4, 1, C.cyan);
      return { art: g, bg: ['#1c1c28', '#07070a'], scan: 0.16 };
    },
  },

  {
    id: 'melt',
    name: 'MELT',
    make() {
      const bands = ['#ffe45e', '#ff9f43', '#ff2e88', '#a12bd8'].map(hex);
      const body = (x, y) => bands[clamp(Math.floor((y - 5) / 3), 0, 3)];
      const g = camera(new Grid(24), { y: 5, h: 12, cy: 11, R: 5.6, body, button: C.cyan, glass: hex('#12081f'), rim: hex('#12081f') });
      const rand = rng(7);
      for (let x = 2; x <= 21; x++) {
        const len = Math.floor(Math.pow(rand(), 1.3) * 8);
        const hot = rand() < 0.3;
        for (let k = 1; k <= len; k++) {
          const t = k / (len + 1);
          g.set(x, 16 + k, hot && k === len ? bands[0] : mix(bands[3], bands[1], t));
        }
      }
      return { art: g, bg: ['#1d0b33', '#0a0412'], scan: 0.16 };
    },
  },

  {
    id: 'aperture',
    name: 'APERTURE',
    make() {
      const g = new Grid(24);
      const c = 12;
      g.disc(c, c, 11.6, C.white).disc(c, c, 10.5, C.dark).disc(c, c, 9.5, hex('#2a2a3c')).disc(c, c, 8.3, C.dark);
      const blades = [hex('#1d2a6b'), hex('#2f46a8')];
      g.disc(c, c, 7.4, (x, y) => {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const r = Math.hypot(dx, dy);
        if (r < 2.6) return hex('#020208');
        const s = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 6 + r * 0.14) % 6;
        return blades[s % 2];
      });
      g.set(8, 7, C.white).set(9, 7, C.white).set(8, 8, C.white).set(15, 16, C.cyan);
      return { art: fringe(g), bg: ['#1c1c28', '#07070a'], scan: 0.16 };
    },
  },

  {
    id: 'instant',
    name: 'INSTANT',
    make() {
      const cream = hex('#efe9dc');
      let g = new Grid(24);
      g.round(2, 3, 20, 18, cream);
      g.rect(3, 19, 18, 1, hex('#d6cdb9'));
      g.rect(3, 4, 18, 8, hex('#1b1b22'));
      g.rect(4, 5, 2, 2, hex('#5a5a68'));
      g.rect(16, 5, 4, 2, hex('#c9ced8'));
      g.disc(12, 8, 3.9, hex('#5a5a68')).disc(12, 8, 2.7, C.glass);
      g.set(10, 6, C.white).set(11, 6, C.white);
      const stripe = [C.mag, C.orange, C.yel, C.green, C.cyan, C.violet];
      stripe.forEach((col, i) => g.rect(9 + i, 12, 1, 7, col));
      g = shiftRows(g, 14, 14, 2);
      g = shiftRows(g, 17, 17, -2);
      return { art: g, bg: ['#1c1c28', '#07070a'], scan: 0.12 };
    },
  },

  {
    id: 'neon',
    name: 'NEON',
    make() {
      const solid = camera(new Grid(24), { lens: false, window: null, button: C.white });
      const lines = outline(solid, C.cyan);
      lines.disc(12, 13, 5.6, C.cyan, 4.6).disc(12, 13, 2.7, C.cyan, 1.7);
      lines.rect(3, 8, 3, 1, C.cyan);
      const g = new Grid(24);
      lines.each((x, y, c) => { if (c) g.set(x + 1, y + 1, C.mag); });
      lines.each((x, y, c) => { if (c) g.set(x, y, C.cyan); });
      return { art: g, bg: ['#120f1f', '#05040a'], glow: 0.9, scan: 0.12 };
    },
  },

  {
    id: 'gameboy',
    name: '1-BIT',
    make() {
      const G = ['#0f380f', '#306230', '#8bac0f', '#c4cfa1'].map(hex);
      const shade = (x, y) => (bayer4(x, y) < (y - 4) / 18 ? G[2] : G[3]);
      let g = camera(new Grid(24), {
        body: shade, button: G[1], window: G[0], rim: G[0], barrel: G[1], glass: G[0], glint: G[3],
      });
      g = halo(g, G[0]);
      return { art: g, bg: ['#9bbc0f', '#8bac0f'], led: 0.1 };
    },
  },

  {
    id: 'plens',
    name: 'P-LENS',
    make() {
      const g = new Grid(24);
      g.rect(5, 3, 4, 18, C.white);
      g.disc(12.5, 9.5, 6.6, C.white).disc(12.5, 9.5, 4.1, C.gray).disc(12.5, 9.5, 2.9, C.glass);
      g.set(11, 8, C.white).set(11, 7, C.white);
      g.rect(14, 2, 3, 1, C.mag);
      return { art: fringe(g), bg: ['#1c1c28', '#07070a'], scan: 0.16 };
    },
  },

  {
    id: 'viewfinder',
    name: 'VIEWFINDER',
    make() {
      const b = new Grid(24);
      for (const [x, y, w, h] of [
        [2, 2, 6, 2], [2, 2, 2, 6], [16, 2, 6, 2], [20, 2, 2, 6],
        [2, 20, 6, 2], [2, 16, 2, 6], [16, 20, 6, 2], [20, 16, 2, 6],
      ]) b.rect(x, y, w, h, C.white);
      const g = fringe(b);
      g.rect(7, 7, 7, 7, C.mag);
      g.rect(10, 10, 7, 7, C.cyan);
      g.rect(10, 10, 4, 4, C.white);
      return { art: g, bg: ['#1c1c28', '#07070a'], scan: 0.16 };
    },
  },

  {
    id: 'vhs',
    name: 'VHS',
    make() {
      let g = camera(new Grid(24), { body: hex('#e9e4d4'), button: hex('#ff6a3d') });
      g = shiftRows(g, 9, 9, -1);
      g = shiftRows(g, 14, 16, 3);
      g = fringe(g, hex('#ff9a3d'), hex('#3d7bff'));
      const rand = rng(3);
      for (let y = 14; y <= 16; y++) {
        for (let x = 0; x < 24; x++) if (rand() < 0.3) g.set(x, y, rand() < 0.5 ? C.white : hex('#8a8aa0'));
      }
      return { art: g, bg: ['#161b2e', '#090b13'], scan: 0.3 };
    },
  },

  {
    id: 'sunset',
    name: 'SUNSET',
    make() {
      const bands = ['#ffe45e', '#ffb347', '#ff6a5e', '#ff2e88', '#c2187e'].map(hex);
      const body = (x, y) => bands[clamp(Math.floor((y - 4) / 3.2), 0, 4)];
      const night = hex('#140a2e');
      const g = camera(new Grid(24), { body, button: C.cyan, window: night, rim: night, barrel: C.cyan, glass: night });
      for (const y of [16, 18]) {
        for (let x = 0; x < 24; x++) {
          const c = g.get(x, y);
          if (c && bands.includes(c)) g.set(x, y, null);
        }
      }
      const rand = rng(11);
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(rand() * 24);
        const y = Math.floor(rand() * 4);
        if (!g.get(x, y)) g.set(x, y, rand() < 0.5 ? C.white : hex('#8f7bd6'));
      }
      return { art: g, bg: ['#2a1250', '#0d0520'], scan: 0.16, glow: 0.35 };
    },
  },

  {
    id: 'sorted',
    name: 'SORTED',
    make() {
      const g = new Grid(24);
      const rand = rng(21);
      const hues = [C.mag, C.cyan, C.yel, C.orange, C.violet, C.white];
      const base = hex('#140a2e');
      for (let y = 0; y < 24; y++) {
        let x = 0;
        while (x < 24) {
          const len = 4 + Math.floor(rand() * 12);
          const hue = hues[Math.floor(rand() * hues.length)];
          for (let k = 0; k < len && x < 24; k++, x++) g.set(x, y, mix(base, hue, 0.4 + 0.6 * Math.pow(k / (len - 1 || 1), 1.2)));
        }
      }
      const bg = g.clone();
      camera(g, { x: 3, y: 8, w: 18, h: 11, body: C.ink, button: C.ink, window: null, lens: false });
      g.disc(12, 13.5, 4.4, (x, y) => bg.get(x, y), 3.3);
      g.disc(12, 13.5, 1.9, (x, y) => bg.get(x, y));
      return { art: g, bg: '#07070a', fill: 1, scan: 0.12 };
    },
  },
];

// ───────────────────────── option 01 "SPLIT" and its variations ─────────────────────────

export function splitSpec(o = {}) {
  const {
    d = 1, dy = 0, left = C.mag, right = C.cyan,
    bg = ['#1c1c28', '#07070a'], scan = 0.16, fill = 0.8, slice = null, cam = {},
  } = o;
  let g = camera(new Grid(24), cam);
  if (slice) g = shiftRows(g, ...slice);
  return { art: fringe(g, left, right, d, dy), bg, scan, fill };
}

export const SPLIT_VARIANTS = [
  { id: 'split-original', name: 'ORIGINAL', make: () => splitSpec() },
  { id: 'split-clean', name: 'CLEAN', make: () => splitSpec({ scan: 0 }) },
  { id: 'split-thick', name: 'THICK', make: () => splitSpec({ d: 2 }) },
  { id: 'split-big', name: 'BIG', make: () => splitSpec({ fill: 0.92 }) },
  { id: 'split-black', name: 'BLACK', make: () => splitSpec({ bg: '#000000' }) },
  { id: 'split-purple', name: 'PURPLE', make: () => splitSpec({ bg: ['#2a1250', '#0d0520'] }) },
  { id: 'split-slice', name: 'ONE SLICE', make: () => splitSpec({ slice: [11, 12, 2] }) },
  {
    id: 'split-rgblens',
    name: 'RGB LENS',
    make: () => splitSpec({ cam: { glass: (x) => mix(hex('#0e6f8c'), hex('#8c0e55'), clamp((x - 8) / 8, 0, 1)) } }),
  },
  {
    id: 'split-invert',
    name: 'INVERT',
    make: () => splitSpec({
      bg: ['#ffffff', '#d9d9e4'],
      cam: { body: C.ink, window: C.white, rim: C.ink, barrel: hex('#9a9ab0'), glass: C.ink, glint: C.white },
    }),
  },
  { id: 'split-pink', name: 'PINK BODY', make: () => splitSpec({ left: C.cyan, right: C.white, cam: { body: C.mag, button: C.cyan } }) },
  { id: 'split-offset', name: 'OFFSET', make: () => splitSpec({ dy: 1 }) },
  { id: 'split-bold', name: 'BOLD', make: () => splitSpec({ d: 2, fill: 0.92, scan: 0 }) },
];

// ───────────────────────── rendering ─────────────────────────

function bgColor(bg, y, size) {
  if (typeof bg === 'string') return hex(bg);
  return mix(hex(bg[0]), hex(bg[1]), y / (size - 1));
}

function boxBlur(src, size, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (a, b, horizontal) => {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const acc = [0, 0, 0];
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const ii = horizontal ? i + k : i;
          const jj = horizontal ? j : j + k;
          if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
          const p = (jj * size + ii) * 3;
          acc[0] += a[p]; acc[1] += a[p + 1]; acc[2] += a[p + 2];
          n++;
        }
        const q = (j * size + i) * 3;
        b[q] = acc[0] / n; b[q + 1] = acc[1] / n; b[q + 2] = acc[2] / n;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  pass(out, tmp, true);
  pass(tmp, out, false);
  return out;
}

// App-icon corner shape (iOS-style ~22% radius) as a size×size mask: 1 inside, 0 outside.
export function roundedMask(size, radius = 0.2237) {
  const r = size * radius;
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const qx = clamp(cx, r, size - r);
    const qy = clamp(cy, r, size - r);
    mask[y * size + x] = Math.hypot(cx - qx, cy - qy) <= r ? 1 : 0;
  }
  return mask;
}

// Render a design spec to a square RGB bitmap (no corner rounding — the OS does that).
export function renderIcon(spec, size) {
  const { art, bg = '#0b0b12', fill = 0.8, scan = 0, led = 0, glow = 0 } = spec;
  const s = Math.max(1, Math.floor((size * fill) / Math.max(art.w, art.h)));
  const ox = Math.floor((size - art.w * s) / 2);
  const oy = Math.floor((size - art.h * s) / 2);
  const out = new Float32Array(size * size * 3);
  const artAt = (x, y) => {
    const ax = Math.floor((x - ox) / s);
    const ay = Math.floor((y - oy) / s);
    return x < ox || y < oy ? null : art.get(ax, ay);
  };

  for (let y = 0; y < size; y++) {
    const b = bgColor(bg, y, size);
    for (let x = 0; x < size; x++) out.set(b, (y * size + x) * 3);
  }

  if (glow) {
    const layer = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = artAt(x, y);
      if (c) layer.set(c, (y * size + x) * 3);
    }
    const blurred = boxBlur(layer, size, Math.max(1, Math.round(size * 0.03)));
    for (let i = 0; i < out.length; i++) out[i] += blurred[i] * glow;
  }

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = artAt(x, y);
    if (c) out.set(c, (y * size + x) * 3);
  }

  if ((scan || led) && s >= 3) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const onRow = ((y - oy) % s + s) % s === s - 1;
      const onCol = ((x - ox) % s + s) % s === s - 1;
      const k = 1 - (onRow ? scan || led : 0) - (led && onCol ? led : 0);
      if (k < 1) for (let i = 0; i < 3; i++) out[(y * size + x) * 3 + i] *= k;
    }
  }

  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < out.length; i++) rgb[i] = clamp(Math.round(out[i]), 0, 255);
  return rgb;
}
