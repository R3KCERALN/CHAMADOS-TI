import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('public/icons', { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#176b57"/><g fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M152 270v-28a104 104 0 0 1 208 0v28"/><rect x="138" y="246" width="45" height="92" rx="19"/><rect x="329" y="246" width="45" height="92" rx="19"/><path d="M351 338v12a25 25 0 0 1-25 25h-58"/><path d="M244 375h24"/></g></svg>`;
for (const size of [192, 512])
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
await sharp(Buffer.from(svg.replace('rx="108"', 'rx="0"')))
  .png()
  .toFile('public/icons/maskable-512.png');
console.log('Ícones PWA gerados.');
