// Minimal animated GIF writer (looping, global palette, ≤256 colors) using only Node built-ins.

// LZW as specified for GIF (same scheme as the widely used omggif encoder).
function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(acc & 0xff);
  return out;
}

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];

// frames: [{ rgb: Uint8Array(w*h*3), delay: centiseconds }]
// mask (optional): Uint8Array(w*h), 0 = transparent pixel in every frame.
export function encodeGIF(w, h, frames, { mask = null } = {}) {
  // Build one global palette from every color used. Index 0 is reserved for transparency.
  const palette = mask ? [0] : [];
  const lookup = new Map();
  const indexed = frames.map(({ rgb }) => {
    const idx = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (mask && !mask[p]) continue; // stays index 0
      const key = (rgb[p * 3] << 16) | (rgb[p * 3 + 1] << 8) | rgb[p * 3 + 2];
      let i = lookup.get(key);
      if (i === undefined) {
        i = palette.length;
        if (i >= 256) throw new Error('GIF needs ≤256 colors; frames use more');
        lookup.set(key, i);
        palette.push(key);
      }
      idx[p] = i;
    }
    return idx;
  });

  const sizeBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))));
  const tableSize = 1 << sizeBits;
  const minCodeSize = Math.max(2, sizeBits);

  const bytes = [...Buffer.from('GIF89a'), ...u16(w), ...u16(h), 0xf0 | (sizeBits - 1), 0, 0];
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? 0;
    bytes.push((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  }
  // Loop forever.
  bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0);

  frames.forEach((f, n) => {
    // With transparency: dispose to background between frames, transparent index 0.
    if (mask) bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1, ...u16(f.delay), 0, 0);
    else bytes.push(0x21, 0xf9, 0x04, 1 << 2, ...u16(f.delay), 0, 0); // leave in place
    bytes.push(0x2c, ...u16(0), ...u16(0), ...u16(w), ...u16(h), 0);
    bytes.push(minCodeSize);
    const data = lzw(indexed[n], minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
