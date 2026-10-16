// Real-time pixel sorting on the GPU.
//
// 1. PREP    Resample the image into a "sort buffer" whose rows run along the sort
//            direction. Pixels inside the brightness threshold are "masked" (sortable);
//            every unmasked pixel and every span start is a segment boundary.
// 2. SCAN    Prefix-sum the boundaries (Hillis–Steele) → each pixel gets a segment id.
// 3. SORT    Bitonic sort each row by (segment id, key). Unmasked pixels have unique ids
//            so they stay put; each masked span gets sorted in place.
// 4. OUTPUT  Map back to image space and blend over the original.

import { COMMON, createProgram, createTexture, framebufferFor } from './gl.js';

const CODEC = `
float dec(vec4 v) { return floor(v.r * 255.0 + 0.5) + floor(v.g * 255.0 + 0.5) * 256.0; }
vec4 enc(float x) { return vec4(mod(x, 256.0) / 255.0, floor(x / 256.0) / 255.0, 0.0, 1.0); }
`;

const PREP = COMMON + CODEC + `
uniform sampler2D u_tex;
uniform vec2 u_sortRes, u_dir, u_ext;
uniform float u_lo, u_hi, u_span;
uniform int u_invert;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

bool sampleAt(float bx, float by, out vec3 col) {
  vec2 n = vec2(-u_dir.y, u_dir.x);
  vec2 p = u_dir * ((bx / u_sortRes.x - 0.5) * u_ext.x) + n * ((by / u_sortRes.y - 0.5) * u_ext.y);
  vec2 uv = p / u_res + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { col = vec3(0.0); return false; }
  col = texture(u_tex, uv).rgb;
  float l = luma(col);
  bool m = l >= u_lo && l <= u_hi;
  return u_invert == 1 ? !m : m;
}

void main() {
  vec2 b = gl_FragCoord.xy;
  vec3 c, cp;
  bool m = sampleAt(b.x, b.y, c);
  bool mp = b.x > 1.0 && sampleAt(b.x - 1.0, b.y, cp);
  bool brk = u_span > 0.0 && hash12(b * 1.37 + 7.0) < 1.0 / u_span;
  o0 = vec4(c, m ? 1.0 : 0.0);
  o1 = enc((!m || !mp || brk) ? 1.0 : 0.0);
}`;

const SCAN = COMMON + CODEC + `
uniform sampler2D u_seg;
uniform int u_step;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float v = dec(texelFetch(u_seg, p, 0));
  if (p.x >= u_step) v += dec(texelFetch(u_seg, ivec2(p.x - u_step, p.y), 0));
  o = enc(v);
}`;

const BITONIC = COMMON + CODEC + `
uniform sampler2D u_col;
uniform sampler2D u_seg;
uniform int u_j, u_k, u_key;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

float key(vec3 c) {
  if (u_key == 0) return luma(c);
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
  float gLo = dec(lower ? sa : sb), gHi = dec(lower ? sb : sa);
  float kLo = key(lower ? ca.rgb : cb.rgb), kHi = key(lower ? cb.rgb : ca.rgb);
  bool gt = gLo > gHi || (gLo == gHi && kLo > kHi);
  bool lt = gLo < gHi || (gLo == gHi && kLo < kHi);
  bool swap = (i & u_k) == 0 ? gt : lt;
  o0 = swap ? cb : ca;
  o1 = swap ? sb : sa;
}`;

const OUTPUT = COMMON + `
uniform sampler2D u_tex;
uniform sampler2D u_sorted;
uniform vec2 u_dir, u_ext;
uniform float u_mix;
out vec4 o;
void main() {
  vec2 p = (v_uv - 0.5) * u_res;
  vec2 n = vec2(-u_dir.y, u_dir.x);
  vec2 suv = vec2(dot(p, u_dir) / u_ext.x, dot(p, n) / u_ext.y) + 0.5;
  vec4 s = texture(u_sorted, suv);
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, mix(base, s.rgb, s.a), u_mix), 1.0);
}`;

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

export class PixelSort {
  constructor(gl) {
    this.gl = gl;
    this.prep = createProgram(gl, PREP);
    this.scan = createProgram(gl, SCAN);
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
    this.C = [createTexture(gl, sx, sy, gl.LINEAR), createTexture(gl, sx, sy, gl.LINEAR)];
    this.K = [createTexture(gl, sx, sy, gl.NEAREST), createTexture(gl, sx, sy, gl.NEAREST)];
    this.fbPrep = framebufferFor(gl, [this.C[0], this.K[0]]);
    this.fbScan = [framebufferFor(gl, [this.K[0]]), framebufferFor(gl, [this.K[1]])];
    this.fbSort = {};
    for (const c of [0, 1]) for (const k of [0, 1]) this.fbSort[`${c}${k}`] = framebufferFor(gl, [this.C[c], this.K[k]]);
  }

  dispose() {
    const gl = this.gl;
    if (!this.C) return;
    [...this.C, ...this.K].forEach((t) => gl.deleteTexture(t));
    [this.fbPrep, ...this.fbScan, ...Object.values(this.fbSort)].forEach((f) => gl.deleteFramebuffer(f));
    this.C = this.K = null;
    this.sx = this.sy = 0;
  }

  // inTex: current image (W×H). out: target to write. maxLen: cap on sort-buffer width.
  render(inTex, out, p, common, mix, maxLen, draw) {
    const gl = this.gl;
    const [W, H] = common.u_res;
    const a = (p.angle * Math.PI) / 180;
    const dir = [Math.cos(a), -Math.sin(a)];
    const ed = Math.abs(W * dir[0]) + Math.abs(H * dir[1]); // extent along sort direction
    const en = Math.abs(W * dir[1]) + Math.abs(H * dir[0]); // extent across
    const sx = Math.min(maxLen, nextPow2(ed));
    const f = Math.min(1, sx / ed);
    const sy = Math.max(1, Math.min(4096, Math.round(en * f)));
    this.ensure(sx, sy);

    const lo = Math.min(p.lo, p.hi) / 100;
    const hi = Math.max(p.lo, p.hi) / 100;
    const span = p.span >= 100 ? 0 : Math.max(2, (p.span / 100) * sx);

    gl.viewport(0, 0, sx, sy);

    // 1. prep → C0 (color + mask), K0 (boundary flags)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbPrep);
    this.prep.use().set({
      ...common, u_tex: inTex, u_sortRes: [sx, sy], u_dir: dir, u_ext: [ed, en],
      u_lo: lo, u_hi: hi, u_span: span, u_invert: p.mask,
    });
    draw();

    // 2. prefix sum boundaries → segment ids
    let k = 0;
    this.scan.use();
    for (let step = 1; step < sx; step <<= 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbScan[1 - k]);
      this.scan.set({ u_seg: this.K[k], u_step: step });
      draw();
      k = 1 - k;
    }

    // 3. bitonic sort along rows
    let c = 0;
    this.bitonic.use().set({ u_key: p.key });
    for (let kk = 2; kk <= sx; kk <<= 1) {
      for (let j = kk >> 1; j > 0; j >>= 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbSort[`${1 - c}${1 - k}`]);
        this.bitonic.set({ u_col: this.C[c], u_seg: this.K[k], u_j: j, u_k: kk });
        draw();
        c = 1 - c;
        k = 1 - k;
      }
    }

    // 4. back to image space
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
    gl.viewport(0, 0, W, H);
    this.output.use().set({ ...common, u_tex: inTex, u_sorted: this.C[c], u_dir: dir, u_ext: [ed, en], u_mix: mix });
    draw();
  }
}
