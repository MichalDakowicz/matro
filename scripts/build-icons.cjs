// Rasterize the supplied vector using Electron's renderer; no logo is redrawn.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = path.join(root, '.test-media', 'icon-render-profile');
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env, MATRO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  try {
    const page = await app.firstWindow();
    const svg = await fs.readFile(path.join(root, 'assets/icon.svg'), 'utf8');
    const frames = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      const data = await page.evaluate(async ({ svg, size }) => {
        const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { svg, size });
      const buffer = Buffer.from(data, 'base64');
      if (size === 512) await fs.writeFile(path.join(root, 'assets/icon.png'), buffer);
      if (size === 1024) await fs.writeFile(path.join(root, 'assets/icon-1024.png'), buffer);
      if (size <= 256) frames.push({ size, buffer });
    }
    const directory = Buffer.alloc(6 + 16 * frames.length); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(frames.length, 4);
    let offset = directory.length;
    for (const [index, { size, buffer }] of frames.entries()) {
      const entry = 6 + index * 16;
      directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
      directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
      directory.writeUInt32LE(buffer.length, entry + 8); directory.writeUInt32LE(offset, entry + 12); offset += buffer.length;
    }
    await fs.writeFile(path.join(root, 'assets/icon.ico'), Buffer.concat([directory, ...frames.map(frame => frame.buffer)]));
    console.log('Generated icon.png, icon-1024.png, and a seven-size Windows icon.ico.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
