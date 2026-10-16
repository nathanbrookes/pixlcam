// Procedural test scene for when no camera is available (desktop testing, denied permission).

export function demoImage(w = 1200, h = 1600) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const horizon = h * 0.6;

  // sky
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0d0628');
  sky.addColorStop(0.45, '#4a1170');
  sky.addColorStop(0.8, '#ff2e88');
  sky.addColorStop(1, '#ffb86b');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);

  // stars
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#fff';
  for (let i = 0; i < 160; i++) {
    const r = rand() * 2.2 + 0.4;
    g.globalAlpha = rand() * 0.8 + 0.2;
    g.fillRect(rand() * w, rand() * horizon * 0.6, r, r);
  }
  g.globalAlpha = 1;

  // striped sun
  const sx = w / 2;
  const sy = horizon - h * 0.08;
  const sr = w * 0.27;
  const sun = g.createLinearGradient(0, sy - sr, 0, sy + sr);
  sun.addColorStop(0, '#fff36b');
  sun.addColorStop(0.55, '#ff8a3d');
  sun.addColorStop(1, '#ff2e88');
  g.save();
  g.beginPath();
  g.arc(sx, sy, sr, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = sun;
  g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const y = sy + i * sr * 0.12;
    g.fillRect(sx - sr, y, sr * 2, 3 + i * 2.2);
  }
  g.restore();

  // mountains
  const ridge = (base, amp, color, seedOff) => {
    seed = seedOff;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, horizon);
    for (let x = 0; x <= w; x += w / 24) g.lineTo(x, base - rand() * amp);
    g.lineTo(w, horizon);
    g.fill();
  };
  ridge(horizon - 30, 190, '#2a0b4d', 3);
  ridge(horizon, 110, '#140428', 11);

  // ground + perspective grid
  const ground = g.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, '#1c0638');
  ground.addColorStop(1, '#05010c');
  g.fillStyle = ground;
  g.fillRect(0, horizon, w, h - horizon);
  g.strokeStyle = '#00e5ff';
  g.lineWidth = 2;
  g.shadowColor = '#00e5ff';
  g.shadowBlur = 8;
  for (let i = -14; i <= 14; i++) {
    g.beginPath();
    g.moveTo(w / 2 + i * 18, horizon);
    g.lineTo(w / 2 + i * 190, h);
    g.stroke();
  }
  for (let i = 1; i < 14; i++) {
    const y = horizon + (h - horizon) * Math.pow(i / 13, 2.2);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.shadowBlur = 0;

  // palm silhouettes
  const palm = (x, s) => {
    g.strokeStyle = '#07010f';
    g.fillStyle = '#07010f';
    g.lineWidth = 14 * s;
    g.beginPath();
    g.moveTo(x, horizon + 40 * s);
    g.quadraticCurveTo(x + 30 * s, horizon - 200 * s, x + 10 * s, horizon - 380 * s);
    g.stroke();
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.5;
      g.beginPath();
      g.moveTo(x + 10 * s, horizon - 380 * s);
      g.quadraticCurveTo(
        x + 10 * s + Math.cos(a) * 120 * s, horizon - 420 * s + Math.sin(a) * 60 * s,
        x + 10 * s + Math.cos(a) * 200 * s, horizon - 330 * s + Math.abs(Math.cos(a)) * 90 * s,
      );
      g.lineWidth = 9 * s;
      g.stroke();
    }
  };
  palm(w * 0.12, 1);
  palm(w * 0.86, 0.8);

  // title
  g.font = `900 ${Math.round(w * 0.15)}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ty = h * 0.86;
  g.fillStyle = '#ff2e88';
  g.fillText('PIXLCAM', w / 2 - 6, ty);
  g.fillStyle = '#00e5ff';
  g.fillText('PIXLCAM', w / 2 + 6, ty);
  g.fillStyle = '#ffffff';
  g.fillText('PIXLCAM', w / 2, ty);

  return c;
}
