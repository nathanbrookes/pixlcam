// Effect definitions. Each effect declares its UI params and either a GLSL `fx()` body
// (single pass) or `custom` (multi-pass, handled by the renderer).
//
// Size-like params are in "units" = 1/1000 of the image's short side, so the
// preview and the full-res export look the same.

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const PALETTES = [
  { name: 'Color', stops: null },
  { name: 'Mono', stops: ['#000000', '#555555', '#aaaaaa', '#ffffff'] },
  { name: 'Game Boy', stops: ['#0f380f', '#306230', '#8bac0f', '#c4cfa1'] },
  { name: 'Amber', stops: ['#0a0500', '#5a2d00', '#ffa000', '#ffe2a8'] },
  { name: 'Cyber', stops: ['#0b0033', '#3a0ca3', '#ff2e88', '#7df9ff'] },
  { name: 'Vapor', stops: ['#20123a', '#c774e8', '#ff6ad5', '#94d0ff'] },
  { name: 'Thermal', stops: ['#05001a', '#6a00a8', '#ff4500', '#ffee58'] },
];
const PAL_FLAT = PALETTES.map((p) => (p.stops ? p.stops.flatMap(hex) : new Array(12).fill(0)));

const range = (id, label, min, max, def, extra = {}) => ({ id, label, type: 'range', min, max, step: 1, def, ...extra });
const select = (id, label, options, def = 0) => ({ id, label, type: 'select', options, def });
const toggle = (id, label, def = false) => ({ id, label, type: 'toggle', def });

export const EFFECTS = [
  {
    id: 'color',
    name: 'Color',
    params: [
      range('hue', 'Hue', -180, 180, 0, { unit: '°' }),
      range('sat', 'Saturation', 0, 300, 100, { unit: '%' }),
      range('con', 'Contrast', 0, 200, 100, { unit: '%' }),
      range('bri', 'Brightness', -100, 100, 0),
      range('sol', 'Solarize', 0, 100, 0),
      select('swap', 'Channels', ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']),
      toggle('inv', 'Invert'),
    ],
    uniforms: (p) => ({
      u_hue: p.hue / 360, u_sat: p.sat / 100, u_con: p.con / 100, u_bri: p.bri / 200,
      u_sol: p.sol / 100, u_swap: p.swap, u_inv: p.inv ? 1 : 0,
    }),
    glsl: `
uniform float u_hue, u_sat, u_con, u_bri, u_sol;
uniform int u_swap, u_inv;
vec3 fx(vec2 uv) {
  vec3 c = texture(u_tex, uv).rgb;
  if (u_swap == 1) c = c.rbg; else if (u_swap == 2) c = c.grb; else if (u_swap == 3) c = c.gbr;
  else if (u_swap == 4) c = c.brg; else if (u_swap == 5) c = c.bgr;
  if (u_hue != 0.0) { vec3 h = rgb2hsv(c); h.x = fract(h.x + u_hue); c = hsv2rgb(h); }
  c = mix(vec3(luma(c)), c, u_sat);
  c = (c - 0.5) * u_con + 0.5 + u_bri;
  c = clamp(c, 0.0, 1.0);
  if (u_sol > 0.0) c = mix(c, 1.0 - c, step(1.0 - u_sol, c));
  if (u_inv == 1) c = 1.0 - c;
  return c;
}`,
  },

  {
    id: 'sort',
    name: 'Pixel Sort',
    custom: 'sort',
    // Intensity = how wide a band of tones gets sorted (not opacity).
    intensityDefault: 50,
    params: [
      range('tone', 'Tones (dark ↔ light)', 0, 100, 50),
      range('streak', 'Streak length', 2, 100, 18, { unit: '%' }),
      range('ragged', 'Ragged edges', 0, 100, 50),
      range('angle', 'Direction', 0, 360, 90, { unit: '°' }),
      select('key', 'Sort by', ['Bright', 'Hue', 'Sat', 'Red', 'Green', 'Blue']),
      select('mask', 'Sort pixels', ['Inside', 'Outside']),
    ],
  },

  {
    id: 'glitch',
    name: 'Glitch',
    params: [
      range('density', 'Density', 0, 100, 40),
      range('size', 'Block size', 5, 300, 60),
      range('shift', 'Displace', 0, 100, 30),
      range('color', 'Corrupt color', 0, 100, 40),
      range('speed', 'Speed', 0, 100, 40),
      range('seed', 'Seed', 0, 99, 0),
    ],
    uniforms: (p) => ({
      u_density: p.density / 100, u_size: p.size, u_shift: p.shift / 100,
      u_color: p.color / 100, u_speed: p.speed / 100, u_seed: p.seed,
    }),
    animated: (p) => p.speed > 0,
    glsl: `
uniform float u_density, u_size, u_shift, u_color, u_speed, u_seed;
vec3 fx(vec2 uv) {
  float rate = u_speed * 20.0;
  float t = mod((rate > 0.0 ? floor(u_time * rate) : 0.0) + u_seed * 17.0, 4096.0);
  float bpx = max(2.0, u_size * u_scale);
  vec2 off = vec2(0.0);

  // thin horizontal slices that slide sideways
  float row = floor(uv.y * u_res.y / (bpx * 0.4));
  float rs = hash12(vec2(row, t));
  if (rs < u_density * 0.45) off.x += (hash12(vec2(row * 1.37, t + 11.0)) - 0.5) * u_shift * 0.7;

  // rectangular blocks that jump around
  vec2 bs = vec2(bpx * 2.6, bpx) / u_res;
  vec2 bid = floor((uv + vec2(hash11(t) * 0.5, hash11(t + 3.0) * 0.5)) / bs);
  bool hit = hash12(bid + t * 3.17) < u_density * 0.32;
  if (hit) off += (hash22(bid + t) - 0.5) * vec2(u_shift, u_shift * 0.3);

  vec2 suv = fract(uv + off);
  vec3 c = texture(u_tex, suv).rgb;

  if (hit && hash12(bid * 7.1 + t) < u_color) {
    float k = hash12(bid * 3.3 + t + 5.0);
    if (k < 0.2) c = c.brg;
    else if (k < 0.35) c = 1.0 - c;
    else if (k < 0.55) c = floor(c * 2.99) / 2.0;
    else if (k < 0.8) {
      vec2 d = vec2(0.02 + 0.04 * hash11(k), 0.0);
      c.r = texture(u_tex, fract(suv + d)).r;
      c.b = texture(u_tex, fract(suv - d)).b;
    } else c = step(0.5, luma(c)) * hash32(bid + t);
  }
  return c;
}`,
  },

  {
    id: 'vhs',
    name: 'VHS',
    params: [
      range('wobble', 'Wobble', 0, 100, 30),
      range('jitter', 'Line jitter', 0, 100, 25),
      range('track', 'Tracking', 0, 100, 40),
      range('bleed', 'Color bleed', 0, 100, 50),
      range('noise', 'Noise', 0, 100, 30),
      range('speed', 'Speed', 0, 100, 50),
    ],
    uniforms: (p) => ({
      u_wobble: p.wobble / 100, u_jitter: p.jitter / 100, u_track: p.track / 100,
      u_bleed: p.bleed / 100, u_noise: p.noise / 100, u_speed: p.speed / 100,
    }),
    animated: () => true,
    glsl: `
uniform float u_wobble, u_jitter, u_track, u_bleed, u_noise, u_speed;
vec3 yiq(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
vec3 fx(vec2 uv) {
  float t = u_time * (0.15 + u_speed * 2.0);
  float lh = max(1.0, 2.0 * u_scale);
  float line = floor(uv.y * u_res.y / lh);
  float tf = mod(floor(t * 12.0), 997.0);

  vec2 suv = uv;
  suv.x += (sin(uv.y * 9.0 + t * 1.7) * 0.6 + sin(uv.y * 37.0 - t * 3.1) * 0.4) * 0.012 * u_wobble;
  suv.x += (hash12(vec2(line, tf)) - 0.5) * 0.01 * u_jitter;

  // tracking band rolling down the frame
  float by = fract(-t * 0.11);
  float d = abs(fract(uv.y - by + 0.5) - 0.5);
  float bw = 0.03 + 0.07 * u_track;
  float band = smoothstep(bw, 0.0, d) * u_track;
  suv.x += band * (hash12(vec2(line, tf + 3.0)) - 0.3) * 0.08;

  // sharp luma, smeared chroma
  vec3 base = yiq(texture(u_tex, suv).rgb);
  vec2 iq = vec2(0.0);
  float spread = (1.0 + 14.0 * u_bleed) * u_scale / u_res.x;
  for (int i = 0; i < 6; i++) iq += yiq(texture(u_tex, suv - vec2(float(i) * spread, 0.0)).rgb).yz;
  iq = mix(base.yz, iq / 6.0 * 1.15, u_bleed);
  float Y = base.x;
  vec3 c = vec3(Y + 0.956 * iq.x + 0.621 * iq.y, Y - 0.272 * iq.x - 0.647 * iq.y, Y - 1.106 * iq.x + 1.703 * iq.y);

  float n = hash12(vec2(floor(uv.x * u_res.x / max(1.0, 2.0 * u_scale)), line) + tf * 1.31);
  c += (n - 0.5) * 0.3 * u_noise;
  float spark = step(0.8, hash12(vec2(floor(uv.x * u_res.x / max(1.0, 6.0 * u_scale)), line + tf)));
  c += band * spark * 0.5;
  c = mix(c, c * vec3(1.02, 0.98, 1.05) + 0.03, u_noise * 0.5);
  return clamp(c, 0.0, 1.0);
}`,
  },

  {
    id: 'pixelate',
    name: 'Pixelate',
    params: [
      range('size', 'Pixel size', 2, 120, 16),
      select('shape', 'Shape', ['Square', 'LED', 'Halftone', 'LCD']),
    ],
    uniforms: (p) => ({ u_size: p.size, u_shape: p.shape }),
    glsl: `
uniform float u_size;
uniform int u_shape;
vec3 fx(vec2 uv) {
  float s = max(1.0, u_size * u_scale);
  vec2 px = uv * u_res;
  vec2 cell = floor(px / s);
  vec2 f = px / s - cell;
  vec3 c = texture(u_tex, (cell + 0.5) * s / u_res).rgb;
  float aa = 1.5 / s;
  if (u_shape == 1) {
    float r = length(f - 0.5);
    return min(c * 1.2, 1.0) * smoothstep(0.43, 0.43 - aa, r);
  }
  if (u_shape == 2) {
    float r = length(f - 0.5);
    float rad = sqrt(luma(c)) * 0.62;
    return min(c * 1.5, 1.0) * smoothstep(rad, rad - aa, r);
  }
  if (u_shape == 3) {
    float sub = f.x * 3.0;
    float col = floor(sub);
    vec3 m = col < 0.5 ? vec3(1.0, 0.0, 0.0) : col < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    float fs = fract(sub);
    float e = smoothstep(0.0, aa * 4.0, fs) * smoothstep(1.0, 1.0 - aa * 4.0, fs);
    e *= smoothstep(0.0, aa * 2.0, f.y - 0.06) * smoothstep(1.0, 1.0 - aa * 2.0, f.y + 0.06);
    return min(c * m * 2.6, 1.0) * e;
  }
  return c;
}`,
  },

  {
    id: 'rgb',
    name: 'RGB Split',
    params: [
      range('dist', 'Distance', 0, 150, 20),
      range('angle', 'Angle', 0, 360, 0, { unit: '°' }),
      select('mode', 'Mode', ['Linear', 'Radial', 'Shake']),
    ],
    uniforms: (p) => ({ u_dist: p.dist, u_angle: (p.angle * Math.PI) / 180, u_mode: p.mode }),
    animated: (p) => p.mode === 2,
    glsl: `
uniform float u_dist, u_angle;
uniform int u_mode;
vec3 fx(vec2 uv) {
  float d = u_dist * u_scale;
  vec2 off;
  if (u_mode == 1) {
    off = (uv - 0.5) * u_res / (0.5 * min(u_res.x, u_res.y)) * d;
  } else {
    float a = u_angle;
    if (u_mode == 2) {
      float tf = mod(floor(u_time * 12.0), 997.0);
      a = hash11(tf) * 6.2831853;
      d *= 0.3 + hash11(tf + 7.0) * 1.4;
    }
    off = vec2(cos(a), -sin(a)) * d;
  }
  off /= u_res;
  return vec3(texture(u_tex, uv + off).r, texture(u_tex, uv).g, texture(u_tex, uv - off).b);
}`,
  },

  {
    id: 'dither',
    name: 'Dither',
    params: [
      range('pix', 'Pixel size', 1, 24, 3),
      range('levels', 'Levels', 2, 8, 2),
      select('pattern', 'Pattern', ['Bayer 8', 'Bayer 4', 'Noise', 'None']),
      select('palette', 'Palette', PALETTES.map((p) => p.name), 1),
    ],
    uniforms: (p) => ({
      u_pix: p.pix, u_levels: p.levels, u_pattern: p.pattern, u_palette: p.palette,
      u_pal: PAL_FLAT[p.palette],
    }),
    glsl: `
uniform float u_pix, u_levels;
uniform int u_pattern, u_palette;
uniform vec3 u_pal[4];
float bayer4(ivec2 p) { int x = p.x & 3, y = p.y & 3, xy = x ^ y; int v = ((xy & 1) << 3) | ((x & 1) << 2) | (xy & 2) | ((x & 2) >> 1); return (float(v) + 0.5) / 16.0; }
float bayer8(ivec2 p) { int x = p.x & 7, y = p.y & 7, xy = x ^ y; int v = ((xy & 1) << 5) | ((x & 1) << 4) | ((xy & 2) << 2) | ((x & 2) << 1) | ((xy & 4) >> 1) | ((x & 4) >> 2); return (float(v) + 0.5) / 64.0; }
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(u_pal[0], u_pal[1], t);
  if (t < 2.0) return mix(u_pal[1], u_pal[2], t - 1.0);
  return mix(u_pal[2], u_pal[3], t - 2.0);
}
vec3 fx(vec2 uv) {
  float s = max(1.0, floor(u_pix * u_scale + 0.5));
  vec2 px = floor(uv * u_res / s);
  vec3 c = texture(u_tex, (px + 0.5) * s / u_res).rgb;
  ivec2 ip = ivec2(px);
  float th = u_pattern == 0 ? bayer8(ip) : u_pattern == 1 ? bayer4(ip) : u_pattern == 2 ? hash12(px) : 0.5;
  float L = u_levels - 1.0;
  if (u_palette == 0) return clamp(floor(c * L + th) / L, 0.0, 1.0);
  return ramp(floor(luma(c) * L + th) / L);
}`,
  },

  {
    id: 'crt',
    name: 'CRT',
    params: [
      range('scan', 'Scanlines', 0, 100, 55),
      range('line', 'Line size', 2, 24, 5),
      range('mask', 'RGB mask', 0, 100, 30),
      range('curve', 'Curvature', 0, 100, 25),
      range('vig', 'Vignette', 0, 100, 45),
    ],
    uniforms: (p) => ({ u_scan: p.scan / 100, u_line: p.line, u_mask: p.mask / 100, u_curve: p.curve / 100, u_vig: p.vig / 100 }),
    glsl: `
uniform float u_scan, u_line, u_mask, u_curve, u_vig;
vec3 fx(vec2 uv) {
  vec2 cc = uv - 0.5;
  vec2 cuv = 0.5 + cc * (1.0 + u_curve * 0.55 * dot(cc, cc)) / (1.0 + u_curve * 0.06);
  vec3 c = texture(u_tex, cuv).rgb;
  float ls = max(2.0, u_line * u_scale);
  float sl = 0.5 + 0.5 * cos(cuv.y * u_res.y / ls * 6.2831853);
  c *= mix(1.0, (0.3 + 0.7 * sl) * 1.25, u_scan);
  float col = mod(floor(uv.x * u_res.x / max(1.0, 1.5 * u_scale)), 3.0);
  vec3 m = col < 0.5 ? vec3(1.0, 0.35, 0.35) : col < 1.5 ? vec3(0.35, 1.0, 0.35) : vec3(0.35, 0.35, 1.0);
  c *= mix(vec3(1.0), m * 1.4, u_mask);
  float v = 16.0 * cuv.x * cuv.y * (1.0 - cuv.x) * (1.0 - cuv.y);
  c *= mix(1.0, pow(clamp(v, 0.0, 1.0), 0.35), u_vig);
  vec2 e = smoothstep(vec2(0.0), vec2(0.003), cuv) * smoothstep(vec2(1.0), vec2(0.997), cuv);
  return clamp(c * e.x * e.y, 0.0, 1.0);
}`,
  },

  {
    id: 'grain',
    name: 'Grain',
    params: [
      range('amount', 'Amount', 0, 100, 35),
      range('size', 'Grain size', 1, 12, 2),
      toggle('chroma', 'Color grain'),
    ],
    uniforms: (p) => ({ u_amount: p.amount / 100, u_size: p.size, u_chroma: p.chroma ? 1 : 0 }),
    animated: () => true,
    glsl: `
uniform float u_amount, u_size;
uniform int u_chroma;
vec3 fx(vec2 uv) {
  vec3 c = texture(u_tex, uv).rgb;
  float s = max(1.0, u_size * u_scale);
  vec2 cell = floor(uv * u_res / s);
  float tf = mod(floor(u_time * 24.0), 113.0) * 37.0;
  vec3 n = u_chroma == 1
    ? (hash32(cell + tf) + hash32(cell * 1.7 + tf + 11.0)) * 0.5
    : vec3(hash12(cell + tf) + hash12(cell * 1.7 + tf + 11.0)) * 0.5;
  float l = luma(c);
  float w = 1.0 - pow(abs(l - 0.5) * 2.0, 2.0) * 0.6;
  return clamp(c + (n - 0.5) * u_amount * 0.7 * w, 0.0, 1.0);
}`,
  },
];

// Every effect gets a universal Intensity (mix) slider first.
for (const fx of EFFECTS) fx.params.unshift(range('mix', 'Intensity', 0, 100, fx.intensityDefault ?? 100, { unit: '%' }));

export const EFFECTS_BY_ID = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

// Order effects are applied in (fixed).
export const PIPELINE = ['color', 'sort', 'glitch', 'vhs', 'pixelate', 'rgb', 'dither', 'crt', 'grain'];

// Order chips appear in the UI.
export const CHIP_ORDER = ['glitch', 'rgb', 'sort', 'pixelate', 'vhs', 'dither', 'crt', 'grain', 'color'];

export function defaultParams(id) {
  return Object.fromEntries(EFFECTS_BY_ID[id].params.map((p) => [p.id, p.def]));
}
