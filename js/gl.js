// Small WebGL2 helpers: programs with auto-typed uniform setters, render targets.

export const VERT = `#version 300 es
out vec2 v_uv;
void main() {
  // Fullscreen triangle from gl_VertexID — no vertex buffers needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared GLSL prepended to every fragment shader.
export const COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform vec2 u_res;     // output size in pixels
uniform float u_time;   // seconds
uniform float u_scale;  // short side / 1000 — keeps sizes consistent between preview and export

float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    console.error(numbered);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

export function createProgram(gl, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
  }

  // Build setters keyed by uniform name, typed from the linked program.
  const setters = {};
  let unit = 0;
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const name = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(prog, info.name);
    const T = info.type;
    if (T === gl.SAMPLER_2D) {
      const u = unit++;
      setters[name] = (tex) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, u); };
    } else if (T === gl.FLOAT) setters[name] = (v) => info.size > 1 ? gl.uniform1fv(loc, v) : gl.uniform1f(loc, v);
    else if (T === gl.INT || T === gl.BOOL) setters[name] = (v) => gl.uniform1i(loc, v | 0);
    else if (T === gl.FLOAT_VEC2) setters[name] = (v) => gl.uniform2fv(loc, v);
    else if (T === gl.FLOAT_VEC3) setters[name] = (v) => gl.uniform3fv(loc, v);
    else if (T === gl.FLOAT_VEC4) setters[name] = (v) => gl.uniform4fv(loc, v);
  }

  return {
    prog,
    use() { gl.useProgram(prog); return this; },
    set(uniforms) {
      for (const k in uniforms) { const s = setters[k]; if (s) s(uniforms[k]); }
      return this;
    },
  };
}

export function createTexture(gl, w, h, filter = gl.LINEAR) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

// A framebuffer with one or more RGBA8 color attachments (MRT when > 1).
export function createTarget(gl, w, h, attachments = 1, filter = gl.LINEAR) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const texs = [];
  const bufs = [];
  for (let i = 0; i < attachments; i++) {
    const t = createTexture(gl, w, h, filter);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    texs.push(t);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    fb, texs, tex: texs[0], w, h,
    dispose() { gl.deleteFramebuffer(fb); texs.forEach((t) => gl.deleteTexture(t)); },
  };
}

// Framebuffer that renders into existing textures (used to mix-and-match MRT pairs).
export function framebufferFor(gl, texs) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}
