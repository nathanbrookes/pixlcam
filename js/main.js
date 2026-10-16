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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

const STORE_KEY = 'pixlcam:v1';
// Frame shapes, written for portrait. In phone landscape they flip (3:4 → 4:3).
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
const EXPORT_MIN_EDGE = 1440; // digitally zoomed shots are scaled up to at least this
const DIGITAL_ZOOM_MAX = 8;
const MAX_RECORD_MS = 5 * 60 * 1000;

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = matchMedia('(pointer: coarse)').matches;
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Matches the CSS breakpoint for the sideways phone layout.
const phoneLandscape = matchMedia('(orientation: landscape) and (max-height: 600px)');

// ───────────────────────── state ─────────────────────────

function freshState() {
  const fx = Object.fromEntries(EFFECTS.map((e) => [e.id, { on: false, p: defaultParams(e.id) }]));
  // A starter look so the first launch shows off something.
  fx.rgb.on = true;
  fx.rgb.p.dist = 14;
  fx.glitch.on = true;
  fx.glitch.p.density = 25;
  return {
    fx, aspect: 0, quality: 'med', exportSize: 'std', format: 'jpeg', facing: 'environment',
    selected: 'glitch', captureMode: 'photo', recordAudio: true,
  };
}

function loadState() {
  const s = freshState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) {
      for (const k of ['aspect', 'quality', 'exportSize', 'format', 'facing', 'selected', 'captureMode', 'recordAudio']) {
        if (k in saved) s[k] = saved[k];
      }
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
  if (s.captureMode !== 'video') s.captureMode = 'photo';
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

const aspectValue = () => (phoneLandscape.matches ? 1 / ASPECTS[state.aspect].v : ASPECTS[state.aspect].v);
const aspectLabel = (i) => {
  const [a, b] = ASPECTS[i].label.split(':');
  return phoneLandscape.matches ? `${b}:${a}` : `${a}:${b}`;
};

// ───────────────────────── setup ─────────────────────────

const app = $('app');
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

let restartGuard = 0;
camera.onEnded = () => {
  // The stream died on its own (e.g. iOS handed the camera to another app). Try once to get it back.
  if (mode !== 'camera' || document.hidden || performance.now() - restartGuard < 3000) return;
  restartGuard = performance.now();
  startCamera({ deviceId: camera.deviceId });
};

async function startCamera({ deviceId = null } = {}) {
  hideMessage();
  try {
    await camera.start({ facing: state.facing, deviceId });
    state.facing = camera.facing;
    saveState();
    mode = 'camera';
    $('btn-live').hidden = true;
    resetZoom();
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
  resetZoom();
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

// ───────────────────────── zoom & lenses ─────────────────────────
//
// iPhone: separate physical lenses (.5 / 1× / TELE) switch cameras; pinch zooms within a lens.
// Elsewhere: hardware zoom when the browser exposes it, otherwise a digital crop.

let zoom = 1;
const hwZoom = () => mode === 'camera' && !!camera.zoomCaps;
const zoomRange = () => (hwZoom() ? [camera.zoomCaps.min, camera.zoomCaps.max] : [1, DIGITAL_ZOOM_MAX]);
const digitalZoom = () => (hwZoom() ? 1 : zoom);
const fmtZoom = (v) => (v < 1 ? `.${Math.round(v * 10)}` : Number.isInteger(+v.toFixed(1)) ? `${Math.round(v)}×` : `${v.toFixed(1)}×`);

let hwBusy = false;
let hwPending = null;
async function applyHardwareZoom(z) {
  hwPending = z;
  if (hwBusy) return;
  hwBusy = true;
  while (hwPending != null) {
    const v = hwPending;
    hwPending = null;
    try { await camera.setHardwareZoom(v); } catch (e) { console.warn('zoom failed', e); }
  }
  hwBusy = false;
}

function setZoom(z) {
  const [lo, hi] = zoomRange();
  zoom = clamp(z, lo, hi);
  if (hwZoom()) applyHardwareZoom(zoom);
  renderZoom();
  markDirty();
}

function resetZoom() {
  const [lo, hi] = zoomRange();
  setZoom(clamp(1, lo, hi));
}

function zoomStops() {
  if (mode === 'camera' && camera.facing === 'environment' && camera.lenses.length > 1) {
    return camera.lenses.map((l) => ({ kind: l.kind, deviceId: l.deviceId }));
  }
  const [lo, hi] = zoomRange();
  const vals = hwZoom()
    ? [lo < 0.95 ? lo : null, 1, 2, hi >= 5 ? 5 : hi >= 3 ? 3 : null]
    : [1, 2, 4];
  return vals.filter((v) => v != null && v >= lo - 1e-3 && v <= hi + 1e-3).map((v) => ({ zoom: v }));
}

function renderZoom() {
  const box = $('zoom');
  box.innerHTML = '';
  if (mode === 'none') return;
  const stops = zoomStops();
  const lensMode = stops.some((s) => s.deviceId);
  let active = -1;
  if (lensMode) active = stops.findIndex((s) => s.deviceId === camera.deviceId);
  else stops.forEach((s, i) => { if (zoom >= s.zoom - 1e-3) active = i; });
  if (active < 0) active = 0;

  stops.forEach((s, i) => {
    let label;
    if (lensMode) {
      const base = s.kind === 'ultra' ? 0.5 : 1;
      label = s.kind === 'tele' ? 'TELE' : fmtZoom(base);
      if (i === active && Math.abs(zoom - 1) > 0.05) label = s.kind === 'tele' ? `T ${fmtZoom(zoom)}` : fmtZoom(base * zoom);
    } else {
      label = i === active && Math.abs(zoom - s.zoom) > 0.05 ? fmtZoom(zoom) : fmtZoom(s.zoom);
    }
    const b = el('button', i === active ? 'on' : '', label);
    b.addEventListener('click', () => pickStop(s));
    box.append(b);
  });
}

async function pickStop(s) {
  if (s.deviceId) {
    if (s.deviceId !== camera.deviceId) await startCamera({ deviceId: s.deviceId });
    else resetZoom();
  } else {
    setZoom(s.zoom);
  }
}

// ───────────────────────── layout & render loop ─────────────────────────

const stage = $('stage');
const viewport = $('viewport');
let viewW = 0;
let viewH = 0;

function layout() {
  const r = stage.getBoundingClientRect();
  const a = aspectValue();
  let w = r.width;
  let h = w / a;
  if (h > r.height) { h = r.height; w = h * a; }
  viewW = Math.floor(w);
  viewH = Math.floor(h);
  viewport.style.width = viewW + 'px';
  viewport.style.height = viewH + 'px';
  $('btn-aspect').textContent = aspectLabel(state.aspect);
  markDirty();
}
new ResizeObserver(layout).observe(stage);
phoneLandscape.addEventListener('change', layout);

function previewSize() {
  if (rec) return rec.size; // keep the canvas size fixed while recording
  const a = aspectValue();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const long = Math.max(240, Math.min(Math.max(viewW, viewH) * dpr, QUALITY[state.quality].edge));
  return a >= 1 ? [even(long), even(long / a)] : [even(long * a), even(long)];
}

function sourceCropSize() {
  const a = aspectValue();
  const sw = renderer.srcW;
  const sh = renderer.srcH;
  const [w, h] = sw / sh > a ? [sh * a, sh] : [sw, sw / a];
  const z = digitalZoom();
  return [w / z, h / z];
}

function exportSize() {
  const [w, h] = sourceCropSize();
  const cap = Math.min(EXPORT[state.exportSize].edge, renderer.maxTex, 4096);
  const long = Math.max(w, h);
  const target = Math.min(cap, Math.max(long, EXPORT_MIN_EDGE));
  const k = target / long;
  return [Math.round(w * k), Math.round(h * k)];
}

const frameOpts = (sortMax, bypass = compare) => ({
  state, time, sortMax, bypass,
  zoom: digitalZoom(),
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
let wantThumb = false;
let thumbURL = null;

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
    if ((anyAnimated() || rec) && now - lastRender > 33) render = true;
  } else return;

  if (!render || !renderer.hasSource) return;
  time = (now - t0) / 1000;
  const [w, h] = previewSize();
  renderer.renderPreview(w, h, frameOpts(QUALITY[state.quality].sort));
  // The drawing buffer is only readable right after drawing, so grab thumbnails here.
  if (wantThumb) { wantThumb = false; thumbURL = grabThumb(); }
  dirty = false;
  lastRender = now;
}

function grabThumb() {
  const c = document.createElement('canvas');
  const k = 160 / Math.max(canvas.width, canvas.height);
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// ───────────────────────── photo capture ─────────────────────────

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

// ───────────────────────── video recording ─────────────────────────
//
// Records the filtered preview canvas (what you see) plus, optionally, the microphone.

const canRecord = typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
let rec = null; // { recorder, chunks, mic, canvasStream, size, mime, started, stopping }
let recTimer = null;

function pickMime() {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

async function startRecording() {
  if (rec || busy || mode === 'none' || !renderer.hasSource) return;
  busy = true;
  let canvasStream = null;
  let mic = null;
  try {
    const size = previewSize();
    canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    if (state.recordAudio) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        tracks.push(...mic.getAudioTracks());
      } catch (e) {
        console.warn(e);
        toast('Recording without sound (microphone not available)');
      }
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      ...(mime && { mimeType: mime }),
      videoBitsPerSecond: 8_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    rec = { recorder, chunks, mic, canvasStream, size, mime, started: performance.now(), stopping: false };
    recorder.start(1000);
    wantThumb = true;
    markDirty();
    setRecordingUI(true);
    navigator.vibrate?.(12);
  } catch (e) {
    console.error(e);
    canvasStream?.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
    rec = null;
    toast('Couldn’t start recording: ' + e.message);
  } finally {
    busy = false;
  }
}

function stopRecording() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.recorder.stop();
}

function finishRecording() {
  const r = rec;
  rec = null;
  setRecordingUI(false);
  r.mic?.getTracks().forEach((t) => t.stop());
  r.canvasStream.getTracks().forEach((t) => t.stop());
  markDirty();
  const type = (r.recorder.mimeType || r.mime || 'video/webm').split(';')[0];
  const blob = new Blob(r.chunks, { type });
  if (!blob.size) { toast('Recording failed: no video data'); return; }
  const file = new File([blob], `pixlcam-${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
  setLastShot(file, thumbURL);
  openReview(file);
}

function setRecordingUI(on) {
  app.classList.toggle('recording', on);
  $('btn-shutter').classList.toggle('recording', on);
  $('btn-shutter').setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
  $('badge-rec').hidden = !on;
  clearInterval(recTimer);
  if (!on) return;
  const update = () => {
    const ms = performance.now() - rec.started;
    const s = Math.floor(ms / 1000);
    $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (ms >= MAX_RECORD_MS) stopRecording();
  };
  update();
  recTimer = setInterval(() => rec && update(), 250);
}

function setCaptureMode(m) {
  if (rec) return;
  if (m === 'video' && !canRecord) {
    toast('Video recording isn’t supported in this browser');
    m = 'photo';
  }
  state.captureMode = m;
  saveState();
  for (const b of $('mode-switch').children) b.classList.toggle('on', b.dataset.mode === m);
  const shutter = $('btn-shutter');
  shutter.classList.toggle('video', m === 'video');
  shutter.setAttribute('aria-label', m === 'video' ? 'Start recording' : 'Take photo');
}

function onShutter() {
  if (state.captureMode === 'video') rec ? stopRecording() : startRecording();
  else shoot();
}

// ───────────────────────── review & save ─────────────────────────

function setLastShot(file, thumb) {
  lastShot = file;
  if (lastShotURL) URL.revokeObjectURL(lastShotURL);
  lastShotURL = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');
  const t = $('btn-last');
  t.style.backgroundImage = `url("${isVideo ? thumb || '' : lastShotURL}")`;
  t.classList.add('has');
  t.classList.toggle('is-video', isVideo);
}

function openReview(file) {
  reviewFile = file;
  if (reviewURL) URL.revokeObjectURL(reviewURL);
  reviewURL = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/');
  const img = $('review-img');
  const vid = $('review-video');
  img.hidden = isVideo;
  vid.hidden = !isVideo;
  if (isVideo) {
    vid.src = reviewURL;
    vid.play().catch(() => {});
  } else {
    img.src = reviewURL;
  }
  const what = isVideo ? 'Video' : 'Image';
  $('review-hint').textContent = isIOS
    ? `Tap Save, then “Save ${what}” to put it in Photos.${isVideo ? '' : ' Or long-press the picture.'}`
    : isTouch
      ? 'Tap Save and choose Photos / Gallery.'
      : `Save downloads the ${what.toLowerCase()} to your computer.`;
  $('review').hidden = false;
}

function closeReview() {
  $('review').hidden = true;
  const vid = $('review-video');
  vid.pause();
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
  $('btn-reset').classList.toggle('idle', !isModified());
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
  const onChange = () => { markDirty(); saveState(); refreshChips(); };

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

function afterFxChange() {
  markDirty();
  saveState();
  refreshChips();
  if (panelId && panelId !== 'presets') openPanel(panelId);
}

function applyLook(look, { quiet = false } = {}) {
  for (const fx of EFFECTS) {
    const s = state.fx[fx.id];
    const over = look.fx[fx.id];
    s.on = !!over;
    s.p = { ...defaultParams(fx.id), ...(over || {}) };
  }
  afterFxChange();
  if (quiet) return;
  const names = Object.keys(look.fx).map((id) => EFFECTS_BY_ID[id].name);
  toast(look.name + (names.length ? ' · ' + names.join(' + ') : ''));
}

// True when any effect is on or any setting differs from its default.
function isModified() {
  return EFFECTS.some((fx) => {
    const s = state.fx[fx.id];
    return s.on || fx.params.some((p) => s.p[p.id] !== p.def);
  });
}

function resetAll() {
  if (!isModified()) { toast('Nothing to reset'); return; }
  const before = JSON.parse(JSON.stringify(state.fx));
  applyLook(PRESETS[0], { quiet: true });
  toast('All effects reset', {
    action: 'Undo',
    onAction: () => {
      state.fx = before;
      afterFxChange();
    },
  });
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
  afterFxChange();
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
    segmented('Frame', ASPECTS.map((_, i) => [i, aspectLabel(i)]), state.aspect, (v) => { state.aspect = v; layout(); }),
    segmented('Preview quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]), state.quality,
      (v) => { state.quality = v; markDirty(); }, 'Lower this if the live view stutters. Photos are always saved at full quality; videos record at this quality.'),
    segmented('Photo size', Object.entries(EXPORT).map(([k, q]) => [k, q.label]), state.exportSize,
      (v) => { state.exportSize = v; }, 'Standard caps the long edge at 2048 px; Max uses up to 4096 px when the source allows.'),
    segmented('Photo format', [['jpeg', 'JPG'], ['png', 'PNG']], state.format,
      (v) => { state.format = v; }, 'PNG keeps pixel art and dithering perfectly crisp, but the files are bigger.'),
    segmented('Video sound', [[true, 'On'], [false, 'Off']], state.recordAudio,
      (v) => { state.recordAudio = v; }, 'Uses the microphone. Your browser asks for permission the first time you record.'),
  );

  if (!isStandalone) {
    const tip = el('div', 'tip');
    tip.append(el('strong', null, 'Install as an app'));
    tip.append(el('p', null, isIOS
      ? 'In Safari, tap the Share button and choose “Add to Home Screen”. PIXLCAM then opens full-screen like a regular app.'
      : 'Use your browser menu → “Install app” or “Add to Home screen”.'));
    body.append(tip);
  }

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
  renderZoom();
}

function hideMessage() {
  $('message').hidden = true;
}

let toastTimer;
function toast(text, { action, onAction } = {}) {
  const t = $('toast');
  t.innerHTML = '';
  t.append(el('span', null, text));
  t.classList.toggle('has-action', !!action);
  if (action) {
    const b = el('button', 'toast-action', action);
    b.addEventListener('click', () => { t.hidden = true; onAction(); });
    t.append(b);
  }
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2200);
}

// ───────────────────────── wiring ─────────────────────────

$('btn-shutter').addEventListener('click', onShutter);
$('btn-random').addEventListener('click', () => applyLook(randomLook()));
$('btn-reset').addEventListener('click', resetAll);
$('mode-switch').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setCaptureMode(b.dataset.mode);
});
$('btn-aspect').addEventListener('click', () => {
  state.aspect = (state.aspect + 1) % ASPECTS.length;
  layout();
  saveState();
});
$('btn-flip').addEventListener('click', () => {
  if (mode === 'camera') state.facing = camera.facing === 'user' ? 'environment' : 'user';
  startCamera();
});
$('btn-live').addEventListener('click', () => startCamera());
$('btn-import').addEventListener('click', () => $('file').click());
$('msg-import').addEventListener('click', () => $('file').click());
$('msg-retry').addEventListener('click', () => startCamera());
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

// Viewport gestures: hold = show original, pinch / scroll wheel = zoom.
const setCompare = (v) => {
  if (compare === v) return;
  compare = v;
  $('badge-compare').hidden = !v;
  markDirty();
};
const pointers = new Map();
let pinch = null;
let compareTimer = null;
const pinchDist = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  clearTimeout(compareTimer);
  if (pointers.size === 1) {
    compareTimer = setTimeout(() => setCompare(true), 150);
  } else if (pointers.size === 2) {
    setCompare(false);
    pinch = { d: pinchDist(), z: zoom };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) setZoom(pinch.z * (pinchDist() / pinch.d));
});
for (const ev of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(ev, (e) => {
    pointers.delete(e.pointerId);
    clearTimeout(compareTimer);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) setCompare(false);
  });
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  setZoom(zoom * Math.exp(-e.deltaY * 0.002));
}, { passive: false });
viewport.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); onShutter(); }
  if (e.key === 'Escape') { closeReview(); closeSettings(); closePanel(); }
});

// Release the camera in the background; grab it again on return.
let resumeCamera = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopRecording();
    if (mode === 'camera') { camera.stop(); resumeCamera = true; }
  } else if (resumeCamera) {
    resumeCamera = false;
    startCamera({ deviceId: camera.deviceId });
  }
});

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

// ───────────────────────── boot ─────────────────────────

buildChips();
setCaptureMode(state.captureMode);
layout();
requestAnimationFrame(tick);
setTimeout(() => renderer.warmup(), 300);

const query = new URLSearchParams(location.search);
if (query.has('demo')) useDemo();
else startCamera();

if ('serviceWorker' in navigator && !query.has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}
