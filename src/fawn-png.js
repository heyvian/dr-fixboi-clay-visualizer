import { strToU8, zlibSync } from 'three/addons/libs/fflate.module.js';

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc;
});

function chunk(type, bytes) {
  const block = new Uint8Array(bytes.length + 12);
  const view = new DataView(block.buffer);
  view.setUint32(0, bytes.length);
  block.set(strToU8(type), 4);
  block.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < block.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ block[i]) & 0xff];
  view.setUint32(block.length - 4, crc ^ 0xffffffff);
  return block;
}

export function encodeTexturePng(pixels, size, channels) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : 2;

  const rowBytes = size * channels;
  const scan = new Uint8Array((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const source = y * rowBytes;
    const dest = y * (rowBytes + 1);
    scan[dest] = 1; // PNG Sub filter predicts each channel from the pixel to its left.
    for (let x = 0; x < rowBytes; x++) {
      scan[dest + 1 + x] = pixels[source + x] - (x >= channels ? pixels[source + x - channels] : 0);
    }
  }

  const parts = [signature, chunk('IHDR', header), chunk('IDAT', zlibSync(scan, { level: 4 })), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
