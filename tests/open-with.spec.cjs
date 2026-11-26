const { test, expect, _electron: electron } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');

// A packaged build (MATRO_EXECUTABLE) receives the file as argv[1]; a development run has the app folder first.
const root = path.resolve(__dirname, '..');
const command = (profile, file) => process.env.MATRO_EXECUTABLE ? { executablePath: process.env.MATRO_EXECUTABLE, args: [`--user-data-dir=${profile}`, file] } : { executablePath: require('electron'), args: [root, file] };
function environment(profile) { const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE; return env; }

test('a file named at launch plays, and a second launch hands its file to the running window', async ({}, testInfo) => {
  const f = await fixtures(), profile = testInfo.outputPath('profile');
  await fs.mkdir(profile, { recursive: true });
  const env = environment(profile);
  const first = command(profile, f.mkv), app = await electron.launch({ ...(process.env.MATRO_EXECUTABLE ? first : { args: first.args }), env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.player-heading h1')).toContainText('Long Thaw');
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    // Explorer starts a new process; it must exit and the first window must switch to its file.
    const second = spawn(command(profile, f.audio).executablePath, command(profile, f.audio).args, { env, stdio: 'ignore', windowsHide: true });
    const exited = new Promise(resolve => second.once('exit', resolve));
    await expect(page.locator('.player-heading h1')).toContainText('Evening', { timeout: 20000 });
    await exited;
    expect(app.windows()).toHaveLength(1);
  } finally { await app.close(); }
});
