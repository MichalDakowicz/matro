const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.test-media', 'server-source');
if (!stage.startsWith(root + path.sep)) throw Error('Invalid source stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
function copy(from, to = from) {
  const source = path.join(root, from), target = path.join(stage, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, filter: file => !['node_modules', 'dist', 'data', '.dev-data', '.test-data', '.env'].includes(path.basename(file)) });
}
for (const file of ['package.json', 'package-lock.json', '.dockerignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) copy(file);
for (const dir of ['packages/core', 'packages/browser-ui', 'apps/web']) copy(dir);
for (const app of ['desktop', 'mobile', 'server']) copy(`apps/${app}/package.json`);
for (const file of ['Dockerfile', 'Dockerfile.nvidia', 'compose.nvidia.yml']) copy(`apps/server/${file}`);
const archive = path.join(root, '.test-media', 'server-source.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, '.']);
console.log(archive);
