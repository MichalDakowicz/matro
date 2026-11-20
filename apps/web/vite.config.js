import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sharedAssets = fileURLToPath(new URL('../../packages/browser-ui/assets/', import.meta.url));
export default defineConfig({
  build: { target: 'es2022' },
  server: { proxy: { '/api': 'http://127.0.0.1:8484' } },
  plugins: [{
    name: 'matro-shared-artwork',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const file = path.resolve(sharedAssets, '.' + new URL(req.url, 'http://localhost').pathname);
        if (!file.startsWith(sharedAssets) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        if (file.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
        else if (file.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options, bundle) {
      fs.cpSync(sharedAssets, path.join(options.dir, 'assets'), { recursive: true });
      const files = ['/', '/icon.svg', '/logo.svg', ...Object.keys(bundle).filter(file => file.startsWith('assets/')).map(file => '/' + file)].sort();
      const worker = path.join(options.dir, 'sw.js'), source = fs.readFileSync(worker, 'utf8');
      const name = 'matro-shell-' + createHash('sha256').update(JSON.stringify(files)).update(source).digest('hex').slice(0, 16);
      fs.writeFileSync(worker, `const shell = ${JSON.stringify({ name, files })};\n${source}`);
    }
  }]
});
