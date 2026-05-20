// Zero-dependency PNG icon generator for the PWA.
// Draws a dark rounded tile with an ascending green chart line + bars —
// the KarlFX brand motif. Produces 192, 512, and a maskable 512 (extra
// padding so the safe zone isn't clipped by Android's mask).
//
// Run:  node scripts/gen-icons.js
// Output: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
//
// Pure Node (zlib + manual PNG chunk encoding) so it works with no npm deps.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── CRC32 (for PNG chunk checksums) ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines with filter byte 0 prefix
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const BG = hexToRgb('#0a0a0a');
const CARD = hexToRgb('#111418');
const ACCENT = hexToRgb('#00d4aa');
const GREEN = hexToRgb('#22c55e');

function drawIcon(size, pad) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // simple alpha blend over existing
    const ea = rgba[i + 3] / 255;
    const na = a / 255;
    const out = na + ea * (1 - na);
    if (out <= 0) return;
    rgba[i]     = Math.round((r * na + rgba[i] * ea * (1 - na)) / out);
    rgba[i + 1] = Math.round((g * na + rgba[i + 1] * ea * (1 - na)) / out);
    rgba[i + 2] = Math.round((b * na + rgba[i + 2] * ea * (1 - na)) / out);
    rgba[i + 3] = Math.round(out * 255);
  };

  const inRounded = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cxs = [x0 + rad, x1 - rad];
    const cys = [y0 + rad, y1 - rad];
    for (const cx of cxs) for (const cy of cys) {
      const cornerX = (x < cx) === (cx === cxs[0]);
      const cornerY = (y < cy) === (cy === cys[0]);
      if (cornerX && cornerY) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > rad * rad) return false;
      }
    }
    return true;
  };

  // Background fill (full bleed dark) + rounded card
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      set(x, y, BG, 255);
      if (inRounded(x, y, pad, pad, size - pad, size - pad, radius)) {
        set(x, y, CARD, 255);
      }
    }
  }

  // Ascending bar chart: 4 bars of increasing height
  const innerL = pad + Math.round(size * 0.12);
  const innerR = size - pad - Math.round(size * 0.12);
  const baseY = size - pad - Math.round(size * 0.16);
  const topMin = pad + Math.round(size * 0.30);
  const bars = 4;
  const gap = Math.round((innerR - innerL) * 0.06);
  const barW = Math.round(((innerR - innerL) - gap * (bars - 1)) / bars);
  for (let b = 0; b < bars; b++) {
    const bx = innerL + b * (barW + gap);
    const h = Math.round((baseY - topMin) * ((b + 1) / bars));
    const top = baseY - h;
    const col = b === bars - 1 ? ACCENT : GREEN;
    for (let y = top; y <= baseY; y++)
      for (let x = bx; x < bx + barW; x++)
        set(x, y, col, b === bars - 1 ? 255 : 150);
  }

  // Ascending line across the tops
  const lineCol = ACCENT;
  const pts = [];
  for (let b = 0; b < bars; b++) {
    const bx = innerL + b * (barW + gap) + Math.round(barW / 2);
    const h = Math.round((baseY - topMin) * ((b + 1) / bars));
    pts.push([bx, baseY - h - Math.round(size * 0.02)]);
  }
  const thick = Math.max(2, Math.round(size * 0.018));
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + (x1 - x0) * (s / steps));
      const y = Math.round(y0 + (y1 - y0) * (s / steps));
      for (let ty = -thick; ty <= thick; ty++)
        for (let tx = -thick; tx <= thick; tx++)
          if (tx * tx + ty * ty <= thick * thick) set(x + tx, y + ty, lineCol, 255);
    }
  }

  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'icon-192.png'), drawIcon(192, Math.round(192 * 0.06)));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), drawIcon(512, Math.round(512 * 0.06)));
// Maskable: more padding so Android's circular/squircle mask doesn't clip art.
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), drawIcon(512, Math.round(512 * 0.18)));
// Apple touch icon (180px, no transparency issues)
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), drawIcon(180, Math.round(180 * 0.04)));

console.log('Icons written to', outDir);
