// Renders the app icon (desktop/icon.png 512 px, build/icon.ico with 16–256 px PNG frames) from SVG.
//   node tools/make-icon.mjs
import fs from 'node:fs';
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2633"/><stop offset="1" stop-color="#0b0f14"/></linearGradient>
    <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff5a1a"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bg)" stroke="#0a0d11" stroke-width="20"/>
  <circle cx="256" cy="256" r="178" fill="none" stroke="#ff7a1a" stroke-width="10" stroke-dasharray="40 22" opacity="0.55"/>
  <!-- falling chevrons: a drop ship's descent -->
  <path d="M146 150 L256 236 L366 150 L366 214 L256 300 L146 214 Z" fill="url(#fire)" stroke="#0a0d11" stroke-width="14" stroke-linejoin="round"/>
  <path d="M176 278 L256 340 L336 278 L336 324 L256 386 L176 324 Z" fill="#ffd27a" stroke="#0a0d11" stroke-width="14" stroke-linejoin="round"/>
</svg>`;

const sizes = [16, 24, 32, 48, 64, 128, 256];
fs.mkdirSync('build', { recursive: true });
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile('desktop/icon.png');
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile('build/icon.png');
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer()));
// ICO: 6-byte header, 16-byte directory entries, then PNG-compressed frames (Vista+)
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync('build/icon.ico', Buffer.concat([head, ...pngs]));
console.log('icon: desktop/icon.png, build/icon.png, build/icon.ico', fs.statSync('build/icon.ico').size, 'bytes');
