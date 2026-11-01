// Deploys the server to the home server: copies the desktop UI, uploads what changed, rebuilds only the matro container.
// Skips everything when nothing that goes into the image has changed since the last successful deploy (pass --force to override).
// (Not an npm script on purpose: editing package.json would invalidate the image's cached `npm ci` layer.)
//   node scripts/deploy.js            deploy
//   node scripts/deploy.js --force    redeploy even if nothing changed
//   node scripts/deploy.js --dry-run  say whether anything would be deployed
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
// Where to deploy: MATRO_DEPLOY_HOST, or the first line of .deploy-target (user@host; gitignored, never committed).
const targetFile = path.join(root, '.deploy-target');
const host = process.env.MATRO_DEPLOY_HOST || (fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8').split(String.fromCharCode(10))[0].trim() : '');
if (!host) { console.error('Set MATRO_DEPLOY_HOST (user@host) or put it in server/.deploy-target.'); process.exit(1); }
const remoteDir = process.env.MATRO_DEPLOY_DIR || '~/matro-server';
const stampFile = path.join(root, '.deploy-stamp');
const force = process.argv.includes('--force'), dryRun = process.argv.includes('--dry-run');

const timings = [];
async function step(name, run) {
  const start = Date.now();
  await run();
  timings.push([name, ((Date.now() - start) / 1000).toFixed(1)]);
}

// Everything the Dockerfile copies or depends on. Data, tests and docs do not rebuild the image.
function fingerprint() {
  const hash = crypto.createHash('sha256');
  const add = file => { hash.update(path.relative(root, file).replace(/\\/g, '/')); hash.update(fs.readFileSync(file)); };
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = path.join(dir, entry.name); entry.isDirectory() ? walk(full) : add(full); } };
  for (const dir of ['src', 'public']) walk(path.join(root, dir));
  for (const file of ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore']) add(path.join(root, file));
  return hash.digest('hex');
}

function pipeUpload() {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['--exclude=node_modules', '--exclude=data', '--exclude=.dev-data', '--exclude=.test-data', '--exclude=.deploy-stamp', '-czf', '-', '.'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    const ssh = spawn('ssh', ['-o', 'BatchMode=yes', host, `tar -xzf - -C ${remoteDir}`], { stdio: ['pipe', 'inherit', 'inherit'] });
    tar.stdout.pipe(ssh.stdin);
    tar.on('error', reject); ssh.on('error', reject);
    ssh.on('close', code => code === 0 ? resolve() : reject(new Error(`upload failed (ssh exit ${code})`)));
  });
}

(async () => {
  await step('sync UI', () => { const result = spawnSync(process.execPath, [path.join(__dirname, 'sync-ui.js')], { cwd: root, stdio: 'inherit' }); if (result.status) throw new Error('sync-ui failed'); });
  const current = fingerprint(), last = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (!force && current === last) { console.log('Nothing changed since the last deploy; skipping upload and rebuild. Use --force to redeploy anyway.'); return; }
  if (dryRun) { console.log('Dry run: would upload and rebuild.'); return; }
  await step('upload', pipeUpload);
  // Only the matro service: the tunnel container keeps running. Unchanged Dockerfile layers (FFmpeg, npm ci) come from the build cache.
  await step('build + restart', () => new Promise((resolve, reject) => {
    const ssh = spawn('ssh', ['-o', 'BatchMode=yes', host, `cd ${remoteDir} && docker compose -f compose.prod.yml up -d --build matro`], { stdio: 'inherit' });
    ssh.on('error', reject); ssh.on('close', code => code === 0 ? resolve() : reject(new Error(`docker compose failed (exit ${code})`)));
  }));
  fs.writeFileSync(stampFile, current);
  console.log('\nDeployed.');
})().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; }).finally(() => {
  if (timings.length) console.log(timings.map(([name, seconds]) => `${name}: ${seconds}s`).join('  |  '));
});
