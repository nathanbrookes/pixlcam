// Runs the effect chain: source (camera/photo) → enabled effects → screen or export.

import { COMMON, createProgram, createTarget, createTexture } from './gl.js';
import { EFFECTS_BY_ID, PIPELINE } from './effects.js';
import { PixelSort } from './pixelsort.js';

const SRC_FRAG = COMMON + `
uniform sampler2D u_src;
uniform vec4 u_crop;   // xy offset, zw size (source uv, top-left origin)
uniform int u_mirror;
out vec4 o;
void main() {
  vec2 uv = v_uv;
  if (u_mirror == 1) uv.x = 1.0 - uv.x;
  vec2 s = u_crop.xy + vec2(uv.x, 1.0 - uv.y) * u_crop.zw;
  o = vec4(texture(u_src, s).rgb, 1.0);
}`;

const COPY_FRAG = COMMON + `
uniform sampler2D u_tex;
out vec4 o;
void main() { o = vec4(texture(u_tex, v_uv).rgb, 1.0); }`;

const effectFrag = (fx) => COMMON + `
uniform sampler2D u_tex;
uniform float u_mix;
out vec4 o;
${fx.glsl}
void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  o = vec4(mix(base, fx(v_uv), u_mix), 1.0);
}`;

// Centered crop of a srcW×srcH image to the target aspect, in uv space.
// zoom > 1 crops further into the center (digital zoom).
export function cropFor(srcW, srcH, aspect, zoom = 1) {
  const sa = srcW / srcH;
  const [w, h] = sa > aspect ? [aspect / sa, 1] : [1, sa / aspect];
  const z = Math.max(1, zoom);
  return [(1 - w / z) / 2, (1 - h / z) / 2, w / z, h / z];
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.bindVertexArray(gl.createVertexArray());
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    this.srcTex = createTexture(gl, 0, 0);
    this.srcW = 0;
    this.srcH = 0;
    this.srcProg = createProgram(gl, SRC_FRAG);
    this.copyProg = createProgram(gl, COPY_FRAG);
    this.fxProgs = {};
    this.sort = new PixelSort(gl);
    this.preview = null; // ping-pong pair at preview size
    this.draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setSource(el, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    this.srcW = w;
    this.srcH = h;
  }

  get hasSource() { return this.srcW > 0 && this.srcH > 0; }

  program(fx) {
    return (this.fxProgs[fx.id] ||= createProgram(this.gl, effectFrag(fx)));
  }

  // Compile every shader up front so the first toggle doesn't stutter.
  warmup() {
    for (const id of PIPELINE) if (!EFFECTS_BY_ID[id].custom) this.program(EFFECTS_BY_ID[id]);
  }

  // Render the chain into ping-pong pair `pp` (w×h). Returns the target holding the result.
  // opts: { state, time, mirror, zoom, bypass, sortMax }
  renderChain(pp, w, h, opts) {
    const gl = this.gl;
    const common = { u_res: [w, h], u_time: opts.time, u_scale: Math.min(w, h) / 1000 };

    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pp[0].fb);
    this.srcProg.use().set({
      ...common, u_src: this.srcTex,
      u_crop: cropFor(this.srcW, this.srcH, w / h, opts.zoom), u_mirror: opts.mirror ? 1 : 0,
    });
    this.draw();

    let cur = 0;
    if (opts.bypass) return pp[cur];

    for (const id of PIPELINE) {
      const s = opts.state.fx[id];
      if (!s.on || s.p.mix <= 0) continue;
      const fx = EFFECTS_BY_ID[id];
      const out = pp[1 - cur];
      const mix = s.p.mix / 100;
      if (fx.custom === 'sort') {
        this.sort.render(pp[cur].tex, out, s.p, common, mix, opts.sortMax, this.draw);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
        gl.viewport(0, 0, w, h);
        this.program(fx).use().set({ ...common, u_tex: pp[cur].tex, u_mix: mix, ...fx.uniforms(s.p) });
        this.draw();
      }
      cur = 1 - cur;
    }
    return pp[cur];
  }

  renderPreview(w, h, opts) {
    const gl = this.gl;
    if (!this.preview || this.preview[0].w !== w || this.preview[0].h !== h) {
      this.preview?.forEach((t) => t.dispose());
      this.preview = [createTarget(gl, w, h), createTarget(gl, w, h)];
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const result = this.renderChain(this.preview, w, h, opts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.copyProg.use().set({ u_tex: result.tex });
    this.draw();
  }

  // Full-resolution render. Returns RGBA pixels, top row first.
  capture(w, h, opts) {
    const gl = this.gl;
    const pp = [createTarget(gl, w, h), createTarget(gl, w, h)];
    try {
      const result = this.renderChain(pp, w, h, opts);
      gl.bindFramebuffer(gl.FRAMEBUFFER, result.fb);
      const raw = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const out = new Uint8ClampedArray(w * h * 4);
      const row = w * 4;
      for (let y = 0; y < h; y++) out.set(raw.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      return out;
    } finally {
      pp.forEach((t) => t.dispose());
      this.sort.dispose(); // release export-sized sort buffers; preview re-creates its own
    }
  }
}
