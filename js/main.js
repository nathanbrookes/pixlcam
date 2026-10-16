import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { EFFECTS, EFFECTS_BY_ID, CHIP_ORDER, defaultParams } from './effects.js';
import { PRESETS, randomLook } from './presets.js';
import { demoImage } from './demo.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const STORE_KEY = 'pixlcam:v1';
const ASPECTS = [
  { label: '3:4', v: 3 / 4 },
  { label: '1:1', v: 1 },
  { label: '9:16', v: 9 / 16 },
  { label: '4:3', v: 4 / 3 },
];
// Preview long-edge cap and pixel-sort buffer cap per quality level.
const QUALITY = {
  low: { label: 'Low', edge: 640, sort: 256 },
  med: { label: 'Medium', edge: 960, sort: 512 },
  high: { label: 'High', edge: 1440, sort: 1024 },
};
const EXPORT = { std: { label: 'Standard', edge: 2048 }, max: { label: 'Max', edge: 4096 } };
const EXPORT_SORT_MAX = 2048;

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = matchMedia('(pointer: coarse)').matches;
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ───────────────────────── state ─────────────────────────

function freshState() {
  const fx = Object.fromEntries(EFFECTS.map((e) => [e.id, { on: false, p: defaultParams(e.id) }]));
  // A starter look so the first launch shows off something.
  fx.rgb.on = true;
  fx.rgb.p.dist = 14;
  fx.glitch.on = true;
  fx.glitch.p.density = 25;
  return { fx, aspect: 0, quality: 'med', exportSize: 'std', format: 'jpeg', facing: 'environment', selected: 'glitch' };
}

function loadState() {
  const s = freshState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      for (const k of ['aspect', 'quality', 'exportSize', 'format', 'facing', 'selected']) if (k in saved) s[k] = saved[k];
      for (const id in s.fx) {
        const f = saved.fx?.[id];
        if (!f) continue;
        s.fx[id].on = !!f.on;
        for (const pid in s.fx[id].p) if (f.p && pid in f.p) s.fx[id].p[pid] = f.p[pid];
      }
    }
  } catch { /* storage unavailable or corrupt — use defaults */ }
  if (!ASPECTS[s.aspect]) s.aspect = 0;
  if (!QUALITY[s.quality]) s.quality = 'med';
  if (!EXPORT[s.exportSize]) s.exportSize = 'std';
  if (!EFFECTS_BY_ID[s.selected]) s.selected = 'glitch';
  return s;
}

const state = loadState();
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 250);
}

// ───────────────────────── setup ─────────────────────────

const canvas = $('view');
const video = $('video');
const camera = new Camera(video);
camera.facing = state.facing;

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  showMessage('Can’t start PIXLCAM', `${e.message} Try the latest Safari or Chrome.`, { retry: false, import: false, demo: false });
  throw e;
}

let mode = 'none'; // 'camera' | 'photo' | 'none'
let dirty = true; // re-render needed even without a new camera frame
let compare = false; // hold-to-compare shows the unfiltered image
let busy = false;
let time = 0;
const t0 = performance.now();

const markDirty = () => { dirty = true; };

// ───────────────────────── sources ─────────────────────────

async function startCamera() {
  hideMessage();
  try {
    await camera.start(state.facing);
    state.facing = camera.facing;
    mode = 'camera';
    $('btn-live').hidden = true;
    markDirty();
  } catch (e) {
    console.warn(e);
    if (mode !== 'photo') mode = 'none';
    const name = e?.name;
    const body =
      name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
      : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found on this device.'
      : name === 'NotReadableError' ? 'The camera is busy in another app. Close it and try again.'
      : e?.message || 'Something went wrong starting the camera.';
    if (mode === 'none') showMessage('Camera unavailable', body + ' You can still open a photo from your library.');
    else toast(body);
  }
}

function useStatic(img, w, h) {
  camera.stop();
  renderer.setSource(img, w, h);
  mode = 'photo';
  $('btn-live').hidden = !Camera.supported;
  hideMessage();
  markDirty();
}

async function loadImage(blob) {
  let img, w, h;
  try {
    img = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    w = img.width;
    h = img.height;
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = w = im.naturalWidth;
      c.height = h = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      img = c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const max = Math.min(4096, renderer.maxTex);
  if (Math.max(w, h) > max) {
    const k = max / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    img.close?.();
    img = c;
    w = c.width;
    h = c.height;
  }
  return { img, w, h };
}

async function openPhoto(file) {
  try {
    const { img, w, h } = await loadImage(file);
    useStatic(img, w, h);
  } catch (e) {
    console.error(e);
    toast('Couldn’t open that image.');
  }
}

function useDemo() {
  const c = demoImage();
  useStatic(c, c.width, c.height);
}

// ───────────────────────── layout & render loop ─────────────────────────

const stage = $('stage');
const viewport = $('viewport');
let viewW = 0;
let viewH = 0;

function layout() {
  const r = stage.getBoundingClientRect();
  const a = ASPECTS[state.aspect].v;
  let w = r.width;
  let h = w / a;
  if (h > r.height) { h = r.height; w = h * a; }
  viewW = Math.floor(w);
  viewH = Math.floor(h);
  viewport.style.width = viewW + 'px';
  viewport.style.height = viewH + 'px';
  $('btn-aspect').textContent = ASPECTS[state.aspect].label;
  markDirty();
}
new ResizeObserver(layout).observe(stage);

function previewSize() {
  const a = ASPECTS[state.aspect].v;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let long = Math.max(viewW, viewH) * dpr;
  long = Math.min(long, QUALITY[state.quality].edge);
  // No point rendering the preview larger than the (cropped) source.
  const [ew, eh] = sourceCropSize();
  long = Math.max(64, Math.min(long, Math.max(ew, eh)));
  return a >= 1 ? [Math.round(long), Math.round(long / a)] : [Math.round(long * a), Math.round(long)];
}

function sourceCropSize() {
  const a = ASPECTS[state.aspect].v;
  const sw = renderer.srcW;
  const sh = renderer.srcH;
  return sw / sh > a ? [sh * a, sh] : [sw, sw / a];
}

function exportSize() {
  const [w, h] = sourceCropSize();
  const cap = Math.min(EXPORT[state.exportSize].edge, renderer.maxTex, 4096);
  const k = Math.min(1, cap / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

const frameOpts = (sortMax, bypass = compare) => ({
  state, time, sortMax, bypass,
  mirror: mode === 'camera' && camera.mirrored,
});

const anyAnimated = () => EFFECTS.some((fx) => state.fx[fx.id].on && fx.animated?.(state.fx[fx.id].p));

// Only re-render the camera when it actually delivers a new frame.
let newVideoFrame = true;
if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
  const onFrame = () => { newVideoFrame = true; video.requestVideoFrameCallback(onFrame); };
  video.requestVideoFrameCallback(onFrame);
}

let lastRender = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden || !viewW) return;

  let render = dirty;
  if (mode === 'camera') {
    if (!camera.ready) return;
    if (newVideoFrame || now - lastRender > 200) {
      renderer.setSource(video, video.videoWidth, video.videoHeight);
      newVideoFrame = false;
      render = true;
    }
  } else if (mode === 'photo') {
    if (anyAnimated() && now - lastRender > 33) render = true;
  } else return;

  if (!render || !renderer.hasSource) return;
  time = (now - t0) / 1000;
  const [w, h] = previewSize();
  renderer.renderPreview(w, h, frameOpts(QUALITY[state.quality].sort));
  dirty = false;
  lastRender = now;
}

// ───────────────────────── capture & save ─────────────────────────

let lastShot = null;
let lastShotURL = null;
let reviewFile = null;
let reviewURL = null;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function encode(px, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  const type = state.format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      c.width = c.height = 0; // free memory promptly (iOS)
      b ? resolve(b) : reject(new Error('Encoding failed'));
    }, type, 0.95);
  });
}

async function shoot() {
  if (busy || mode === 'none' || !renderer.hasSource) return;
  busy = true;
  $('btn-shutter').classList.add('busy');
  flash();
  navigator.vibrate?.(12);
  try {
    if (mode === 'camera' && camera.ready) renderer.setSource(video, video.videoWidth, video.videoHeight);
    await new Promise(requestAnimationFrame);
    const [w, h] = exportSize();
    const px = renderer.capture(w, h, frameOpts(EXPORT_SORT_MAX, false));
    markDirty();
    const blob = await encode(px, w, h);
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const file = new File([blob], `pixlcam-${stamp()}.${ext}`, { type: blob.type });
    setLastShot(file);
    openReview(file);
  } catch (e) {
    console.error(e);
    toast('Capture failed: ' + e.message);
  } finally {
    busy = false;
    $('btn-shutter').classList.remove('busy');
  }
}

function flash() {
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function setLastShot(file) {
  lastShot = file;
  if (lastShotURL) URL.revokeObjectURL(lastShotURL);
  lastShotURL = URL.createObjectURL(file);
  const t = $('btn-last');
  t.style.backgroundImage = `url("${lastShotURL}")`;
  t.classList.add('has');
}

function openReview(file) {
  reviewFile = file;
  if (reviewURL) URL.revokeObjectURL(reviewURL);
  reviewURL = URL.createObjectURL(file);
  $('review-img').src = reviewURL;
  $('review-hint').textContent = isIOS
    ? 'Tap Save, then “Save Image” to put it in Photos. Or long-press the picture.'
    : isTouch
      ? 'Tap Save and choose Photos / Gallery, or long-press the picture.'
      : 'Save downloads the image to your computer.';
  $('review').hidden = false;
}

function closeReview() {
  $('review').hidden = true;
}

async function saveFile(file) {
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('share failed, falling back to download', e);
    }
  }
  const url = URL.createObjectURL(file);
  const a = el('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Saved ' + file.name);
}

// ───────────────────────── effect chips & panel ─────────────────────────

const chipsEl = $('chips');
const panel = $('panel');
const panelBody = $('panel-body');
let panelId = null; // effect id, 'presets', or null when closed

function buildChips() {
  chipsEl.innerHTML = '';
  const pre = el('button', 'chip chip-presets');
  pre.dataset.id = 'presets';
  pre.innerHTML = '<span>✦ Looks</span>';
  chipsEl.append(pre);
  for (const id of CHIP_ORDER) {
    const b = el('button', 'chip');
    b.dataset.id = id;
    b.append(el('i', 'dot'), el('span', null, EFFECTS_BY_ID[id].name));
    chipsEl.append(b);
  }
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = b.dataset.id;
    if (panelId === id) return closePanel();
    if (id !== 'presets') {
      state.selected = id;
      if (!state.fx[id].on) { state.fx[id].on = true; markDirty(); saveState(); }
    }
    openPanel(id);
  });
  refreshChips();
}

function refreshChips() {
  for (const b of chipsEl.children) {
    const id = b.dataset.id;
    b.classList.toggle('on', id !== 'presets' && state.fx[id].on);
    b.classList.toggle('selected', panelId === id);
  }
}

function openPanel(id) {
  panelId = id;
  panel.hidden = false;
  const isFx = id !== 'presets';
  $('panel-title').textContent = isFx ? EFFECTS_BY_ID[id].name : 'Looks';
  $('panel-switch-wrap').hidden = !isFx;
  $('panel-reset').hidden = !isFx;
  if (isFx) $('panel-switch').checked = state.fx[id].on;
  panelBody.innerHTML = '';
  panelBody.scrollTop = 0;
  if (isFx) buildFxControls(id);
  else buildPresetControls();
  refreshChips();
  chipsEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

function closePanel() {
  panelId = null;
  panel.hidden = true;
  refreshChips();
}

function fmt(def, v) {
  return `${v}${def.unit || ''}`;
}

function buildFxControls(id) {
  const fx = EFFECTS_BY_ID[id];
  const s = state.fx[id];
  const onChange = () => { markDirty(); saveState(); };

  for (const def of fx.params) {
    if (def.type === 'range') {
      const wrap = el('div', 'ctl ctl-range');
      const row = el('div', 'ctl-row');
      const label = el('label', null, def.label);
      const out = el('output', null, fmt(def, s.p[def.id]));
      row.append(label, out);
      const input = el('input');
      Object.assign(input, { type: 'range', min: def.min, max: def.max, step: def.step, value: s.p[def.id] });
      const paint = () => input.style.setProperty('--pct', ((input.value - def.min) / (def.max - def.min)) * 100 + '%');
      paint();
      input.addEventListener('input', () => {
        s.p[def.id] = Number(input.value);
        out.textContent = fmt(def, s.p[def.id]);
        paint();
        onChange();
      });
      wrap.append(row, input);
      panelBody.append(wrap);
    } else if (def.type === 'select') {
      const wrap = el('div', 'ctl ctl-seg');
      wrap.append(el('label', null, def.label));
      const opts = el('div', 'seg');
      def.options.forEach((name, i) => {
        const b = el('button', i === s.p[def.id] ? 'on' : '', name);
        b.addEventListener('click', () => {
          s.p[def.id] = i;
          for (const x of opts.children) x.classList.toggle('on', x === b);
          onChange();
        });
        opts.append(b);
      });
      wrap.append(opts);
      panelBody.append(wrap);
    } else if (def.type === 'toggle') {
      const wrap = el('div', 'ctl ctl-toggle');
      const sw = el('label', 'switch');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!s.p[def.id];
      input.addEventListener('change', () => { s.p[def.id] = input.checked; onChange(); });
      sw.append(input, el('span'));
      wrap.append(el('label', null, def.label), sw);
      panelBody.append(wrap);
    }
  }
}

function buildPresetControls() {
  const grid = el('div', 'preset-grid');
  for (const p of PRESETS) {
    const b = el('button', 'preset', p.name);
    b.addEventListener('click', () => applyLook(p));
    grid.append(b);
  }
  const rnd = el('button', 'preset preset-random', '🎲 Random');
  rnd.addEventListener('click', () => applyLook(randomLook()));
  grid.append(rnd);
  panelBody.append(grid);
}

function applyLook(look) {
  for (const fx of EFFECTS) {
    const s = state.fx[fx.id];
    const over = look.fx[fx.id];
    s.on = !!over;
    s.p = { ...defaultParams(fx.id), ...(over || {}) };
  }
  markDirty();
  saveState();
  refreshChips();
  if (panelId && panelId !== 'presets') openPanel(panelId);
  const names = Object.keys(look.fx).map((id) => EFFECTS_BY_ID[id].name);
  toast(look.name + (names.length ? ' · ' + names.join(' + ') : ''));
}

$('panel-switch').addEventListener('change', (e) => {
  if (!panelId || panelId === 'presets') return;
  state.fx[panelId].on = e.target.checked;
  markDirty();
  saveState();
  refreshChips();
});

$('panel-reset').addEventListener('click', () => {
  if (!panelId || panelId === 'presets') return;
  state.fx[panelId].p = defaultParams(panelId);
  markDirty();
  saveState();
  openPanel(panelId);
});

$('panel-close').addEventListener('click', closePanel);

// ───────────────────────── settings ─────────────────────────

function segmented(label, options, current, onPick, note) {
  const wrap = el('div', 'ctl ctl-seg');
  wrap.append(el('label', null, label));
  const seg = el('div', 'seg');
  for (const [value, text] of options) {
    const b = el('button', value === current ? 'on' : '', text);
    b.addEventListener('click', () => {
      for (const x of seg.children) x.classList.toggle('on', x === b);
      onPick(value);
      saveState();
    });
    seg.append(b);
  }
  wrap.append(seg);
  if (note) wrap.append(el('p', 'note', note));
  return wrap;
}

function openSettings() {
  const body = $('settings-body');
  body.innerHTML = '';
  body.append(
    segmented('Frame', ASPECTS.map((a, i) => [i, a.label]), state.aspect, (v) => { state.aspect = v; layout(); }),
    segmented('Preview quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]), state.quality,
      (v) => { state.quality = v; markDirty(); }, 'Lower this if the live view stutters. Saved photos are always full quality.'),
    segmented('Photo size', Object.entries(EXPORT).map(([k, q]) => [k, q.label]), state.exportSize,
      (v) => { state.exportSize = v; }, 'Standard caps the long edge at 2048 px; Max uses up to 4096 px when the source allows.'),
    segmented('Format', [['jpeg', 'JPG'], ['png', 'PNG']], state.format,
      (v) => { state.format = v; }, 'PNG keeps pixel art and dithering perfectly crisp, but the files are bigger.'),
  );

  if (!isStandalone) {
    const tip = el('div', 'tip');
    tip.append(el('strong', null, 'Install as an app'));
    tip.append(el('p', null, isIOS
      ? 'In Safari, tap the Share button and choose “Add to Home Screen”. PIXLCAM then opens full-screen like a regular app.'
      : 'Use your browser menu → “Install app” or “Add to Home screen”.'));
    body.append(tip);
  }

  const reset = el('button', 'btn ghost wide', 'Turn all effects off');
  reset.addEventListener('click', () => { applyLook(PRESETS[0]); closeSettings(); });
  body.append(reset);

  $('settings').hidden = false;
}

function closeSettings() {
  $('settings').hidden = true;
}

// ───────────────────────── messages & toast ─────────────────────────

function showMessage(title, body, actions = { retry: true, import: true, demo: true }) {
  $('message-title').textContent = title;
  $('message-body').textContent = body;
  $('msg-retry').hidden = !actions.retry;
  $('msg-import').hidden = !actions.import;
  $('msg-demo').hidden = !actions.demo;
  $('message').hidden = false;
}

function hideMessage() {
  $('message').hidden = true;
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ───────────────────────── wiring ─────────────────────────

$('btn-shutter').addEventListener('click', shoot);
$('btn-random').addEventListener('click', () => applyLook(randomLook()));
$('btn-aspect').addEventListener('click', () => {
  state.aspect = (state.aspect + 1) % ASPECTS.length;
  layout();
  saveState();
});
$('btn-flip').addEventListener('click', () => {
  if (mode === 'camera') state.facing = camera.facing === 'user' ? 'environment' : 'user';
  saveState();
  startCamera();
});
$('btn-live').addEventListener('click', startCamera);
$('btn-import').addEventListener('click', () => $('file').click());
$('msg-import').addEventListener('click', () => $('file').click());
$('msg-retry').addEventListener('click', startCamera);
$('msg-demo').addEventListener('click', useDemo);
$('file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) openPhoto(f);
});
$('btn-last').addEventListener('click', () => lastShot && openReview(lastShot));
$('review-close').addEventListener('click', closeReview);
$('review-save').addEventListener('click', () => reviewFile && saveFile(reviewFile));
$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
$('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });

// Hold the picture to see the original.
const setCompare = (v) => {
  if (compare === v) return;
  compare = v;
  $('badge-compare').hidden = !v;
  markDirty();
};
viewport.addEventListener('pointerdown', (e) => { if (e.target === canvas) setCompare(true); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) viewport.addEventListener(ev, () => setCompare(false));
viewport.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); shoot(); }
  if (e.key === 'Escape') { closeReview(); closeSettings(); closePanel(); }
});

// Release the camera in the background; grab it again on return.
let resumeCamera = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (mode === 'camera') { camera.stop(); resumeCamera = true; }
  } else if (resumeCamera) {
    resumeCamera = false;
    startCamera();
  }
});

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

// ───────────────────────── boot ─────────────────────────

buildChips();
layout();
requestAnimationFrame(tick);
setTimeout(() => renderer.warmup(), 300);

const query = new URLSearchParams(location.search);
if (query.has('demo')) useDemo();
else startCamera();

if ('serviceWorker' in navigator && !query.has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}
