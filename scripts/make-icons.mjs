/**
 * Draws the tanteo app icon and writes the PWA icon set.
 *
 * The mark: a padel court seen from above, in the thin white line-work
 * DESIGN.md asks for, with the net rendered as a bar of padel-ball optic
 * yellow. The net sits below centre rather than on it, because DESIGN.md
 * reserves the accent for "scores in motion" and a displaced net is the
 * smallest way to draw a score. A court alone would belong to any padel app;
 * a court whose net has moved belongs to a scorekeeper.
 *
 * It is a script rather than a hand-drawn asset so the geometry stays
 * consistent across sizes and the maskable safe area is computed, not guessed.
 *
 * Run: node scripts/make-icons.mjs
 * Output: apps/web/public/icon-{192,512}.png, icon-maskable-512.png
 *
 * No dependencies: a flat-colour PNG is a deflate stream plus four chunks, and
 * a raster library to draw four rectangles would be a worse trade.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'apps', 'web', 'public');

const COURT = [0x07, 0x1a, 0x2c]; // --color-court-950
const OPTIC = [0xd8, 0xff, 0x2e]; // --color-optic
const INK = [0xf2, 0xf6, 0xfa]; // --color-ink

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** 4x4 supersampled, so the line-work stays clean at 192 and crisp at 512. */
function encodePng(size, sample) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  const N = 4;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = sample(x + (sx + 0.5) / N, y + (sy + 0.5) / N);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const samples = N * N;
      raw[offset++] = Math.round(r / samples);
      raw[offset++] = Math.round(g / samples);
      raw[offset++] = Math.round(b / samples);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * `courtHeight` is the court's height as a fraction of the canvas. A padel
 * court is 20m by 10m, so the box is drawn at exactly 1:2 and the fraction
 * doubles as the maskable safe-area control: shrink it and the whole mark
 * moves inside the crop circle.
 */
function courtIcon(size, courtHeight) {
  const h = size * courtHeight;
  const w = h / 2;
  const x0 = (size - w) / 2;
  const x1 = x0 + w;
  const y0 = (size - h) / 2;
  const y1 = y0 + h;

  const stroke = size * 0.05;
  // The net sits at 62% rather than 50%. That offset is the entire idea.
  const net = y0 + h * 0.62;
  const netHalf = size * 0.045;
  // A real net runs past its posts, and the overhang is also what stops the
  // outline reading as a door or a phone.
  const overhang = size * 0.058;

  return (x, y) => {
    if (Math.abs(y - net) < netHalf && x >= x0 - overhang && x <= x1 + overhang) return OPTIC;
    if (x < x0 || x > x1 || y < y0 || y > y1) return COURT;
    const insideCourt =
      x >= x0 + stroke && x <= x1 - stroke && y >= y0 + stroke && y <= y1 - stroke;
    return insideCourt ? COURT : INK;
  };
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, courtHeight: 0.78 },
  { file: 'icon-512.png', size: 512, courtHeight: 0.78 },
  // Maskable icons get cropped to whatever shape the launcher uses, so the
  // court shrinks into the 80% safe zone and keeps its net overhang.
  { file: 'icon-maskable-512.png', size: 512, courtHeight: 0.58 },
];

for (const { file, size, courtHeight } of targets) {
  writeFileSync(join(OUT_DIR, file), encodePng(size, courtIcon(size, courtHeight)));
  console.log(`wrote ${file} (${size}x${size})`);
}
