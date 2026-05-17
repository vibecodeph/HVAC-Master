// Generates solid-color PNG icons for PWA use — no external dependencies.
// Uses Node.js built-in zlib for deflate compression.
// Brand blue: #2563EB = rgb(37, 99, 235)
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

function createIconPNG(size) {
  // Brand palette
  const BG_R = 37, BG_G = 99, BG_B = 235;   // #2563EB blue
  const FG_R = 255, FG_G = 255, FG_B = 255; // white

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit-depth=8, color-type=2 (RGB), compress=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;

  // Build pixel grid: blue background with white "H" glyph
  // H glyph occupies the center 60% of the icon
  const margin = Math.floor(size * 0.20);
  const glyphW = size - margin * 2;
  const glyphH = size - margin * 2;
  const stemW = Math.max(1, Math.round(glyphW * 0.20));
  const crossH = Math.max(1, Math.round(glyphH * 0.12));
  const crossY = Math.floor(margin + glyphH * 0.44);
  const leftStemX = margin;
  const rightStemX = margin + glyphW - stemW;

  function isHPixel(x, y) {
    if (x >= leftStemX && x < leftStemX + stemW && y >= margin && y < margin + glyphH) return true;
    if (x >= rightStemX && x < rightStemX + stemW && y >= margin && y < margin + glyphH) return true;
    if (y >= crossY && y < crossY + crossH && x >= leftStemX && x < rightStemX + stemW) return true;
    return false;
  }

  const rowLen = 1 + size * 3;
  const rawData = Buffer.alloc(size * rowLen);

  for (let y = 0; y < size; y++) {
    rawData[y * rowLen] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const offset = y * rowLen + 1 + x * 3;
      if (isHPixel(x, y)) {
        rawData[offset] = FG_R;
        rawData[offset + 1] = FG_G;
        rawData[offset + 2] = FG_B;
      } else {
        rawData[offset] = BG_R;
        rawData[offset + 1] = BG_G;
        rawData[offset + 2] = BG_B;
      }
    }
  }

  const idat = zlib.deflateSync(rawData, { level: 6 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [192, 512];
for (const size of sizes) {
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, createIconPNG(size));
  console.log(`Generated ${outPath} (${size}x${size})`);
}

console.log('PWA icons ready.');
