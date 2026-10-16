// Camera stream wrapper: lens discovery and hardware zoom where the browser supports it.

const LENS_ORDER = { ultra: 0, wide: 1, tele: 2 };

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.facing = 'environment';
    this.deviceId = null;
    this.zoomCaps = null; // { min, max, step } when the browser exposes hardware zoom
    this.lenses = []; // back lenses we can tell apart: [{ deviceId, kind: 'ultra'|'wide'|'tele', label }]
    this.onEnded = null; // called if the stream dies on its own (e.g. another app grabs the camera)
  }

  static get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  get ready() {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  // Front cameras are mirrored, like a selfie preview. Laptop webcams usually
  // don't report facingMode, so treat "unknown" as front-facing.
  get mirrored() {
    return this.facing !== 'environment';
  }

  async start({ facing = this.facing, deviceId = null } = {}) {
    this.stop();
    if (!Camera.supported) {
      throw new Error(window.isSecureContext
        ? 'This browser has no camera support.'
        : 'Camera needs a secure (https) connection.');
    }
    const size = { width: { ideal: 1920 }, height: { ideal: 1440 } };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: facing }, ...size },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.track.addEventListener('ended', this._ended = () => this.onEnded?.());
    const settings = this.track.getSettings();
    this.deviceId = settings.deviceId || deviceId;

    await this.findLenses();
    const isBackLens = this.lenses.some((l) => l.deviceId === this.deviceId);
    this.facing = settings.facingMode
      || (isBackLens ? 'environment' : deviceId ? this.facing : facing === 'environment' && isTouchDevice() ? facing : 'user');

    const caps = this.track.getCapabilities?.() || {};
    this.zoomCaps = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;

    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.videoWidth > 0) resolve();
      else this.video.addEventListener('loadedmetadata', resolve, { once: true });
    });
  }

  // iPhone Safari lists each physical lens ("Back Ultra Wide Camera", "Back Telephoto Camera").
  // Android labels are usually generic, so there we rely on hardware zoom instead.
  async findLenses() {
    let devices = [];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch { /* ignore */ }
    const lenses = [];
    for (const d of devices) {
      const label = d.label || '';
      if (!label || /front|user|face|selfie/i.test(label)) continue;
      if (/dual|triple/i.test(label)) continue; // iOS virtual multi-lens devices
      const kind = /ultra ?wide/i.test(label) ? 'ultra' : /tele/i.test(label) ? 'tele' : 'wide';
      if (lenses.some((l) => l.kind === kind)) continue;
      lenses.push({ deviceId: d.deviceId, kind, label });
    }
    this.lenses = lenses.length > 1 ? lenses.sort((a, b) => LENS_ORDER[a.kind] - LENS_ORDER[b.kind]) : [];
  }

  async setHardwareZoom(z) {
    if (!this.zoomCaps || !this.track) return;
    await this.track.applyConstraints({ advanced: [{ zoom: z }] });
  }

  stop() {
    if (this.track && this._ended) this.track.removeEventListener('ended', this._ended);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }
}

function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches;
}
