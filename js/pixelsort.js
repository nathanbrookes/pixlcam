// Real-time pixel sorting on the GPU, modelled on the ESP32-P4 camera's in-camera sort:
// real pixels are moved at full resolution (no resampling or blending), each line gets its
// own brightness cutoff (ragged streak edges) and its own random maximum streak length.
//
// Every image pixel belongs to exactly one "sort line". Horizontal/vertical directions use
// rows/columns; other angles use stair-stepped lines (a shear), so the mapping is still an
// exact one-to-one map of pixels. Each line becomes a row of the "sort buffer". Rows are
// split into tiles of size T (≥ the longest streak) with a random per-line offset, so
// streaks never cross a tile and tile edges don't line up from line to line.
//
// 1. PREP      gather each line's pixels; mark pixels inside the brightness window
//              ("masked") and the first pixel of every masked run.
// 2. SCAN      running max within each tile → start of the run each pixel belongs to.
// 3. FINALIZE  cut runs into streaks of at most L (per-line random). Each pixel gets a
//              segment id: the start of its streak, or its own position if it doesn't sort.
// 4. SORT      bitonic sort within tiles by (segment, key, original position). Pixels that
//              don't sort have unique ids so they stay put; each streak sorts in place, stably.
// 5. OUTPUT    scatter back: sorted pixels replace originals, the rest pass through.
//
// Very large exports are processed in bands of lines to bound GPU memory.

import { COMMON, createProgram, createTexture, framebufferFor } from './gl.js';

const SHARED = `
uniform int u_major;     // 0: lines run along x (mostly horizontal), 1: along y
uniform int u_rev;       // 1: sort order runs toward -x / -y
uniform int u_num;       // shear slope × 4096 (0 for horizontal/vertical)
uniform int u_lineOff;   // keeps line indices ≥ 0
uniform int u_len;       // pixels per line (image width or height)
uniform int u_Sx;        // buffer width (multiple of u_T)
uniform int u_T;         // tile size (power of two)
uniform int u_wrap;      // 1 when lines are shifted by a random tile offset
uniform int u_band;      // first line held in the buffer
uniform int u_bandRows;  // lines held in the buffer

float dec16(vec2 v) { return floor(v.x * 255.0 + 0.5) + floor(v.y * 255.0 + 0.5) * 256.0; }
vec2 enc16(float x) { return vec2(mod(x, 256.0), floor(x / 256.0)) / 255.0; }
float lineRand(int line, float salt) { return hash12(vec2(float(line), salt)); }
int lineOffset(int line) { return u_wrap == 1 ? int(lineRand(line, 11.0) * float(u_T)) : 0; }

// Integer shear, identical in every pass so the mapping inverts exactly.
int shear(int t) {
  int s = (t * abs(u_num) + 2048) >> 12;
  return u_num < 0 ? -s : s;
}
// Image pixel → (position along its line, line).
ivec2 toLine(ivec2 ip) {
  ivec2 size = ivec2(u_res);
  if (u_major == 0) return ivec2(u_rev == 1 ? size.x - 1 - ip.x : ip.x, ip.y - shear(ip.x) + u_lineOff);
  return ivec2(u_rev == 1 ? size.y - 1 - ip.y : ip.y, ip.x - shear(ip.y) + u_lineOff);
}
// (position, line) → image pixel (may fall outside the image).
ivec2 fromLine(int pos, int line) {
  ivec2 size = ivec2(u_res);
  if (u_major == 0) {
    int x = u_rev == 1 ? size.x - 1 - pos : pos;
    return ivec2(x, line - u_lineOff + shear(x));
  }
  int y = u_rev == 1 ? size.y - 1 - pos : pos;
  return ivec2(line - u_lineOff + shear(y), y);
}
// Buffer x on a line → position along the line, or -1 for padding.
int linePos(int x, int line) {
  int a = x - lineOffset(line);
  if (a < 0) a += u_Sx;
  return a < u_len ? a : -1;
}
`;

const PREP = COMMON + SHARED + `
uniform sampler2D u_tex;
uniform float u_lo, u_hi, u_jit;
uniform int u_invert;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

bool sampleAt(int x, int line, out vec3 col) {
  col = vec3(0.0);
  int a = linePos(x, line);
  if (a < 0) return false;
  ivec2 ip = fromLine(a, line);
  if (any(lessThan(ip, ivec2(0))) || any(greaterThanEqual(ip, ivec2(u_res)))) return false;
  col = texelFetch(u_tex, ip, 0).rgb;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float jit = lineRand(line, 3.0) * u_jit; // each line gets a slightly different window
  bool inWin = l >= u_lo - jit && l <= u_hi + jit;
  return u_invert == 1 ? !inWin : inWin;
}

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  int line = b.y + u_band;
  vec3 c, cp;
  bool m = sampleAt(b.x, line, c);
  bool start = m && ((b.x & (u_T - 1)) == 0 || linePos(b.x, line) == 0 || !sampleAt(b.x - 1, line, cp));
  o0 = vec4(c, m ? 1.0 : 0.0);
  o1 = vec4(enc16(start ? float(b.x + 1) : 0.0), enc16(float(b.x)));
}`;

const SCAN = COMMON + SHARED + `
uniform sampler2D u_seg;
uniform int u_stride;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 k = texelFetch(u_seg, p, 0);
  float v = dec16(k.rg);
  if ((p.x & (u_T - 1)) >= u_stride) v = max(v, dec16(texelFetch(u_seg, ivec2(p.x - u_stride, p.y), 0).rg));
  o = vec4(enc16(v), k.ba);
}`;

const FINALIZE = COMMON + SHARED + `
uniform sampler2D u_col;
uniform sampler2D u_seg;
uniform float u_span; // average max streak in pixels; 0 = unlimited
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 k = texelFetch(u_seg, p, 0);
  int seg = p.x;
  if (texelFetch(u_col, p, 0).a > 0.5) {
    int runStart = int(dec16(k.rg)) - 1;
    seg = runStart;
    if (u_span > 0.0) {
      // Like the P4: a streak that reaches its max length ends, the next pixel is left
      // alone, and a new streak starts after it.
      int L = max(2, int(u_span * (0.55 + 0.9 * lineRand(p.y + u_band, 7.0))));
      int off = p.x - runStart;
      int pos = off % (L + 1);
      seg = pos == L ? p.x : runStart + off - pos;
    }
  }
  o = vec4(enc16(float(seg)), k.ba);
}`;

const BITONIC = COMMON + SHARED + `
uniform sampler2D u_col;
uniform sampler2D u_seg;
uniform int u_j, u_k, u_key;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

float sortKey(vec3 c) {
  if (u_key == 0) return dot(c, vec3(0.299, 0.587, 0.114));
  if (u_key == 3) return c.r;
  if (u_key == 4) return c.g;
  if (u_key == 5) return c.b;
  vec3 h = rgb2hsv(c);
  return u_key == 1 ? h.x : h.y;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int i = p.x;
  int l = i ^ u_j;
  ivec2 q = ivec2(l, p.y);
  vec4 ca = texelFetch(u_col, p, 0), sa = texelFetch(u_seg, p, 0);
  vec4 cb = texelFetch(u_col, q, 0), sb = texelFetch(u_seg, q, 0);
  bool lower = i < l;
  vec4 cLo = lower ? ca : cb, cHi = lower ? cb : ca;
  vec4 sLo = lower ? sa : sb, sHi = lower ? sb : sa;
  float gLo = dec16(sLo.rg), gHi = dec16(sHi.rg);
  float kLo = sortKey(cLo.rgb), kHi = sortKey(cHi.rgb);
  float oLo = dec16(sLo.ba), oHi = dec16(sHi.ba); // original position: keeps the sort stable
  bool gt = gLo != gHi ? gLo > gHi : kLo != kHi ? kLo > kHi : oLo > oHi;
  bool asc = u_k >= u_T || (i & u_k) == 0; // every tile ends up ascending
  bool swap = asc ? gt : !gt;
  o0 = swap ? cb : ca;
  o1 = swap ? sb : sa;
}`;

const OUTPUT = COMMON + SHARED + `
uniform sampler2D u_tex;
uniform sampler2D u_sorted;
uniform int u_first; // first band writes every pixel; later bands only their own lines
out vec4 o;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(u_tex, ip, 0).rgb;
  ivec2 pl = toLine(ip);
  int row = pl.y - u_band;
  if (row >= 0 && row < u_bandRows) {
    int x = pl.x + lineOffset(pl.y);
    if (x >= u_Sx) x -= u_Sx;
    vec4 s = texelFetch(u_sorted, ivec2(x, row), 0);
    if (s.a > 0.5) c = s.rgb;
  } else if (u_first == 0) {
    discard;
  }
  o = vec4(c, 1.0);
}`;

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
const MAX_TILE = 1024; // unlimited streaks get rare breaks at (staggered) tile edges

export class PixelSort {
  constructor(gl) {
    this.gl = gl;
    this.prep = createProgram(gl, PREP);
    this.scan = createProgram(gl, SCAN);
    this.finalize = createProgram(gl, FINALIZE);
    this.bitonic = createProgram(gl, BITONIC);
    this.output = createProgram(gl, OUTPUT);
    this.sx = 0;
    this.sy = 0;
  }

  ensure(sx, sy) {
    if (sx === this.sx && sy === this.sy) return;
    this.dispose();
    const gl = this.gl;
    this.sx = sx;
    this.sy = sy;
    this.C = [createTexture(gl, sx, sy, gl.NEAREST), createTexture(gl, sx, sy, gl.NEAREST)];
    this.K = [createTexture(gl, sx, sy, gl.NEAREST), createTexture(gl, sx, sy, gl.NEAREST)];
    this.fbPrep = framebufferFor(gl, [this.C[0], this.K[0]]);
    this.fbK = [framebufferFor(gl, [this.K[0]]), framebufferFor(gl, [this.K[1]])];
    this.fbSort = {};
    for (const c of [0, 1]) for (const k of [0, 1]) this.fbSort[`${c}${k}`] = framebufferFor(gl, [this.C[c], this.K[k]]);
  }

  dispose() {
    const gl = this.gl;
    if (!this.C) return;
    [...this.C, ...this.K].forEach((t) => gl.deleteTexture(t));
    [this.fbPrep, ...this.fbK, ...Object.values(this.fbSort)].forEach((f) => gl.deleteFramebuffer(f));
    this.C = this.K = null;
    this.sx = this.sy = 0;
  }

  // inTex: current image (W×H). out: target to write. p: effect params (mix = Intensity).
  // maxTexels: GPU memory budget for the sort buffer; bigger images are done in bands.
  render(inTex, out, p, common, maxTexels, draw) {
    const gl = this.gl;
    const [W, H] = common.u_res;

    // Line geometry. Angle 0 sorts left→right, 90 top→bottom (GL y is up).
    const ang = (p.angle * Math.PI) / 180;
    const dx = Math.cos(ang);
    const dy = -Math.sin(ang);
    const major = Math.abs(dx) >= Math.abs(dy) - 1e-9 ? 0 : 1;
    const rev = (major === 0 ? dx : dy) < 0 ? 1 : 0;
    const slope = major === 0 ? dy / dx : dx / dy;
    const num = Math.abs(slope) < 1e-6 ? 0 : Math.round(slope * 4096);
    const shear = (t) => Math.sign(num) * ((t * Math.abs(num) + 2048) >> 12);
    const len = major === 0 ? W : H;
    const span0 = shear((major === 0 ? W : H) - 1);
    const lineOff = Math.max(span0, 0);
    const lines = (major === 0 ? H : W) + Math.abs(span0);

    // Streak length is relative to the line length, so preview and export match.
    const unlimited = p.streak >= 100;
    const span = unlimited ? 0 : Math.max(2, (p.streak / 100) * len);
    // Tiles cover the average streak; the longest ones (up to 1.45×) occasionally get cut at
    // a tile edge, which is staggered per line and doesn't show — but it keeps passes down.
    const T = Math.min(nextPow2(len), MAX_TILE, unlimited ? Infinity : nextPow2(Math.ceil(span)));
    const wrap = T < len ? 1 : 0;
    const sx = Math.ceil(len / T) * T;
    const bandRows = Math.max(1, Math.min(lines, Math.floor(maxTexels / sx)));
    this.ensure(sx, bandRows);

    // Intensity = how much gets sorted. Inside: a window of tones that grows (50 ≈ the P4
    // camera's default, ±0.22); near the top its edges stretch out to pure black and white,
    // so 100 sorts everything. Outside: the protected window shrinks to nothing.
    // Tones slides the window between the darkest and lightest tones, always keeping all of
    // it inside black…white so both ends of the slider sort a full band.
    const amt = p.mix / 100;
    const tone = p.tone / 100;
    let lo, hi;
    if (p.mask === 1) {
      const half = 0.44 * (1 - amt);
      const center = half + (1 - 2 * half) * tone;
      lo = center - half;
      hi = center + half;
    } else {
      const half = 0.02 + 0.4 * amt;
      const center = half + (1 - 2 * half) * tone;
      const stretch = amt ** 6;
      lo = (center - half) * (1 - stretch);
      hi = center + half + (1 - (center + half)) * stretch;
    }
    const shared = {
      ...common, u_major: major, u_rev: rev, u_num: num, u_lineOff: lineOff,
      u_len: len, u_Sx: sx, u_T: T, u_wrap: wrap, u_bandRows: bandRows,
    };

    for (let band = 0; band < lines; band += bandRows) {
      const rows = Math.min(bandRows, lines - band);
      gl.viewport(0, 0, sx, rows);

      // 1. prep → C0 (color + mask), K0 (run-start markers, original position)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbPrep);
      this.prep.use().set({
        ...shared, u_band: band, u_tex: inTex,
        u_lo: lo, u_hi: hi, u_jit: (p.ragged / 100) * 0.25, u_invert: p.mask,
      });
      draw();

      // 2. running max within tiles → run start
      let k = 0;
      this.scan.use().set({ ...shared, u_band: band });
      for (let stride = 1; stride < T; stride <<= 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbK[1 - k]);
        this.scan.set({ u_seg: this.K[k], u_stride: stride });
        draw();
        k = 1 - k;
      }

      // 3. cut runs into streaks → segment ids
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbK[1 - k]);
      this.finalize.use().set({ ...shared, u_band: band, u_col: this.C[0], u_seg: this.K[k], u_span: span });
      draw();
      k = 1 - k;

      // 4. bitonic sort within tiles
      let c = 0;
      this.bitonic.use().set({ ...shared, u_band: band, u_key: p.key });
      for (let kk = 2; kk <= T; kk <<= 1) {
        for (let j = kk >> 1; j > 0; j >>= 1) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbSort[`${1 - c}${1 - k}`]);
          this.bitonic.set({ u_col: this.C[c], u_seg: this.K[k], u_j: j, u_k: kk });
          draw();
          c = 1 - c;
          k = 1 - k;
        }
      }

      // 5. back to image pixels
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
      gl.viewport(0, 0, W, H);
      this.output.use().set({ ...shared, u_band: band, u_bandRows: rows, u_first: band === 0 ? 1 : 0, u_tex: inTex, u_sorted: this.C[c] });
      draw();
    }
  }
}
