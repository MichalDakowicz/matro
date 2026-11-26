import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const withAndroidTv = require('../../plugins/with-android-tv.js');

test('Android TV prebuild retains the phone launcher and installs one TV launcher and banner', async t => {
  const config = withAndroidTv(withAndroidTv({}));
  const name = (value: string) => ({ $: { 'android:name': value } });
  const phoneLauncher = { action: [name('android.intent.action.MAIN')], category: [name('android.intent.category.LAUNCHER')] };
  const activity = { ...name('.MainActivity'), 'intent-filter': [phoneLauncher] };
  const touchscreen = { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'true' } };
  const manifest = { application: [{ activity: [activity] }], 'uses-feature': [touchscreen] };

  await config.mods.android.manifest({ modRequest: {}, modResults: { manifest } });

  assert.deepEqual(activity['intent-filter'], [
    phoneLauncher,
    { action: [name('android.intent.action.MAIN')], category: [name('android.intent.category.LEANBACK_LAUNCHER')] },
  ]);
  assert.deepEqual(activity.$, { 'android:name': '.MainActivity', 'android:banner': '@drawable/matro_tv_banner' });
  assert.deepEqual(manifest['uses-feature'], ['android.hardware.touchscreen', 'android.software.leanback']
    .map(value => ({ $: { 'android:name': value, 'android:required': 'false' } })));

  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const platformProjectRoot = await mkdtemp(path.join(tmpdir(), 'matro-tv-prebuild-'));
  t.after(() => rm(platformProjectRoot, { recursive: true, force: true }));
  await config.mods.android.dangerous({ modRequest: { projectRoot, platformProjectRoot } });
  assert.deepEqual(await readFile(path.join(platformProjectRoot, 'app/src/main/res/drawable-xhdpi/matro_tv_banner.png')),
    await readFile(path.join(projectRoot, 'assets/tv-banner.png')));
});
