import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "public", "icons");

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function inRoundedRectangle(x, y, size, radius) {
  const nearestX = Math.max(radius, Math.min(size - radius - 1, x));
  const nearestY = Math.max(radius, Math.min(size - radius - 1, y));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const amount = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(px - (ax + amount * dx), py - (ay + amount * dy));
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const padding = size === 128 ? 16 : 0;
  const tileSize = size - padding * 2;
  const samples = 4;
  const sampleCount = samples * samples;
  // Match the B mark in Brand.tsx and the floating launcher, centered on a 32px tile.
  const transform = ([x, y]) => [
    ((x - 12.5) * 1.1 + 16) * tileSize / 32,
    ((y - 10.5) * 1.1 + 16) * tileSize / 32
  ];
  const arc = (cx, cy, radius) => Array.from({ length: 25 }, (_, index) => {
    const angle = Math.PI / 2 - Math.PI * index / 24;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
  const strokes = [
    [[5, 5], [5, 19], [10, 19], ...arc(10, 14, 5).slice(1), [5, 9]],
    [[10, 9], [13, 9], ...arc(13, 5, 4).slice(1), [9, 1]]
  ].map((stroke) => stroke.map(transform));
  const segments = strokes.flatMap((stroke) => stroke.slice(1).map((point, index) => [
    ...stroke[index], ...point
  ]));
  const [dotX, dotY] = transform([18, 18]);
  const dotRadius = 2.1 * 1.1 * tileSize / 32;
  const lineRadius = Math.max(0.58, 0.9 * 1.1 * tileSize / 32);
  const radius = tileSize * 0.235;
  const inset = Math.max(0.45, tileSize * 0.012);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      let alpha = 0;
      const color = [0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples - padding;
          const py = y + (sy + 0.5) / samples - padding;
          if (px < 0 || py < 0 || px >= tileSize || py >= tileSize) continue;
          if (!inRoundedRectangle(px, py, tileSize + 1, radius)) continue;
          const inner = inRoundedRectangle(px - inset, py - inset, tileSize + 1 - inset * 2, radius - inset);
          const light = Math.max(0, 1 - (px + py) / (tileSize * 2));
          let rgb = inner ? [25 + light * 17, 34 + light * 19, 29 + light * 17] : [104, 126, 112];
          if (segments.some((segment) => distanceToSegment(px, py, ...segment) <= lineRadius)) {
            rgb = [244, 248, 242];
          }
          if (Math.hypot(px - dotX, py - dotY) <= dotRadius) rgb = [188, 218, 177];
          alpha += 1;
          for (let channel = 0; channel < 3; channel += 1) color[channel] += rgb[channel];
        }
      }
      if (!alpha) continue;
      for (let channel = 0; channel < 3; channel += 1) pixels[offset + channel] = Math.round(color[channel] / alpha);
      pixels[offset + 3] = Math.round(alpha * 255 / sampleCount);
    }
  }

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const target = y * (size * 4 + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

await mkdir(outputDirectory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(resolve(outputDirectory, `icon${size}.png`), makeIcon(size));
}
console.log(`Generated Branchboard icons in ${outputDirectory}`);
