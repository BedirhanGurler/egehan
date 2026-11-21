#!/usr/bin/env node
/**
 * Generates the extension icon.
 *
 * A script rather than a checked-in binary nobody can regenerate: the mark is three moments on a
 * line — a chronicle — in the project's own category colours, so changing the palette changes the
 * icon by re-running this. Writes a minimal PNG with no image library.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 128;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'icon.png');

const hex = (value) => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];

const SURFACE = hex('#1c1c1a');
const RAIL = hex('#46453f');
const DOTS = [hex('#1baf7a'), hex('#2a78d6'), hex('#e87ba4')];

const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

const put = (x, y, [r, g, b], alpha = 255) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  const source = alpha / 255;
  const target = pixels[offset + 3] / 255;
  const out = source + target * (1 - source);
  if (out === 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const under = pixels[offset + channel];
    pixels[offset + channel] = Math.round(
      ([r, g, b][channel] * source + under * target * (1 - source)) / out,
    );
  }
  pixels[offset + 3] = Math.round(out * 255);
};

/** Antialiased by sampling the shape on a 3×3 grid inside each pixel. */
const fill = (test, colour) => {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits += 1;
        }
      }
      if (hits > 0) put(x, y, colour, Math.round((hits / 9) * 255));
    }
  }
};

const roundedRect = (x0, y0, x1, y1, radius) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

const circle = (cx, cy, radius) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;

fill(roundedRect(4, 4, SIZE - 4, SIZE - 4, 26), SURFACE);
fill(roundedRect(60.5, 30, 67.5, 98, 3.5), RAIL);
DOTS.forEach((colour, index) => {
  const cy = 34 + index * 30;
  fill(circle(64, cy, 13), SURFACE);
  fill(circle(64, cy, 10), colour);
});

/* --- minimal PNG writer --------------------------------------------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const raw = Buffer.concat(
  Array.from({ length: SIZE }, (_, y) =>
    Buffer.concat([Buffer.from([0]), pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4)]),
  ),
);

writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

console.log(`icon: ${SIZE}×${SIZE} written to media/icon.png`);
