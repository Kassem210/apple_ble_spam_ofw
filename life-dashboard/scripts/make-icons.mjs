// Renders the app icons as PNGs with no dependencies (supersampled for smooth edges).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const VIOLET = [108, 92, 231]; const DEEP = [59, 47, 176]; const TEAL = [0, 179, 155]; const CORAL = [255, 122, 89];

// Signed-distance style shape test in unit coords (0..1).
function sample(x, y, { rounded, mono }) {
  const cx = 0.5; const cy = 0.5;
  // Background: rounded square (or full bleed)
  let bg = true;
  if (rounded) {
    const r = 0.225; const m = 0;
    const qx = Math.max(Math.abs(x - cx) - (0.5 - m - r), 0); const qy = Math.max(Math.abs(y - cy) - (0.5 - m - r), 0);
    bg = Math.hypot(qx, qy) <= r;
  }
  const scale = mono ? 1 : (rounded ? 1 : 0.82); // maskable/full-bleed keeps the mark in the safe zone
  const dx = (x - cx) / scale; const dy = (y - cy) / scale;
  const d = Math.hypot(dx, dy);
  let ang = Math.atan2(dy, dx); // -PI..PI, 0 = right
  // Ring: 300° arc starting at top going clockwise, leaving a gap at top-left.
  const a = (ang + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI); // 0 at top, clockwise
  const R = 0.25; const W = 0.068;
  const onRing = Math.abs(d - R) <= W / 2 && a <= (300 / 360) * 2 * Math.PI;
  // Rounded cap at arc start (top)
  const cap1 = Math.hypot(dx, dy + R) <= W / 2;
  const endA = (300 / 360) * 2 * Math.PI - Math.PI / 2;
  const cap2 = Math.hypot(dx - R * Math.cos(endA), dy - R * Math.sin(endA)) <= W / 2;
  // Dot in the centre (the "you")
  const dot = d <= 0.07;
  const mark = onRing || cap1 || cap2 || dot;

  if (mono) return mark ? [255, 255, 255, 255] : [0, 0, 0, 0];
  if (!bg) return [0, 0, 0, 0];
  if (mark) return [255, 255, 255, 255];
  // Diagonal gradient + coral glow bottom-right
  const t = (x + y) / 2;
  let c = t < 0.55 ? mix(VIOLET, DEEP, t / 0.55 * 0.35) : mix(mix(VIOLET, DEEP, 0.35), TEAL, (t - 0.55) / 0.45);
  const glow = Math.max(0, 1 - Math.hypot(x - 0.95, y - 1.0) / 0.55);
  c = mix(c, CORAL, glow * 0.55);
  const shine = Math.max(0, 1 - Math.hypot(x - 0.15, y - 0.05) / 0.6);
  c = mix(c, [255, 255, 255], shine * 0.12);
  return [...c.map(Math.round), 255];
}

function render(size, opts) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const p = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, opts);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const i = (y * size + x) * 4;
      out[i] = a ? Math.round(r / a) : 0; out[i + 1] = a ? Math.round(g / a) : 0; out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, out);
}

const dir = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', dir), render(192, { rounded: true }));
writeFileSync(new URL('icon-512.png', dir), render(512, { rounded: true }));
writeFileSync(new URL('icon-maskable-512.png', dir), render(512, { rounded: false }));
writeFileSync(new URL('apple-touch-icon.png', dir), render(180, { rounded: false }));
writeFileSync(new URL('badge-96.png', dir), render(96, { mono: true }));
console.log('icons written');
