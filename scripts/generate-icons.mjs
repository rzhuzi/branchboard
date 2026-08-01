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
  const radius = size * 0.23;
  const nodeRadius = Math.max(1.1, size * 0.095);
  const lineWidth = Math.max(1, size * 0.055);
  const nodes = [
    [size * 0.29, size * 0.32],
    [size * 0.7, size * 0.26],
    [size * 0.63, size * 0.7]
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      if (!inRoundedRectangle(x, y, size, radius)) continue;

      const light = Math.max(0, 1 - Math.hypot(x, y) / (size * 1.15));
      pixels[offset] = Math.round(53 + light * 36);
      pixels[offset + 1] = Math.round(75 + light * 38);
      pixels[offset + 2] = Math.round(91 + light * 41);
      pixels[offset + 3] = 255;

      const onLink =
        distanceToSegment(x, y, ...nodes[0], ...nodes[1]) <= lineWidth ||
        distanceToSegment(x, y, ...nodes[0], ...nodes[2]) <= lineWidth;
      const onNode = nodes.some(
        ([nodeX, nodeY]) => Math.hypot(x - nodeX, y - nodeY) <= nodeRadius
      );
      if (onLink || onNode) {
        pixels[offset] = 220;
        pixels[offset + 1] = 230;
        pixels[offset + 2] = 237;
      }
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
