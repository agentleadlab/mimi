import zlib from "node:zlib";

const HEX = /^#?([0-9a-f]{6})$/i;

export function parseHex(hex) {
  const m = String(hex ?? "").trim().match(HEX);
  if (!m) throw new Error(`"${hex}" isn't a hex color like #1A73E8.`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A solid color PNG, or a top-to-bottom gradient when `to` is given. Used to
 * recolor brand templates: Canva autofill can't change colors, but it can
 * swap an image field filled with a color.
 */
export function swatchPng(from, to, { width = 1200, height = 1200 } = {}) {
  const a = parseHex(from);
  const b = to ? parseHex(to) : a;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0;
    const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const row = y * (width * 3 + 1); // first byte: filter type 0
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
