// Camera stream wrapper around getUserMedia.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = 'environment';
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

  async start(facing = this.facing) {
    this.stop();
    if (!Camera.supported) {
      throw new Error(window.isSecureContext
        ? 'This browser has no camera support.'
        : 'Camera needs a secure (https) connection.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    });
    const track = this.stream.getVideoTracks()[0];
    this.facing = track.getSettings().facingMode || (facing === 'environment' && hasMultipleCameras() ? facing : 'user');
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.videoWidth > 0) resolve();
      else this.video.addEventListener('loadedmetadata', resolve, { once: true });
    });
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

function hasMultipleCameras() {
  // Without facingMode info we can't tell; assume a phone (rear camera) only on touch devices.
  return matchMedia('(pointer: coarse)').matches;
}
