const { mkdir, copyFile } = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const launcher = 'android.intent.category.LEANBACK_LAUNCHER';

module.exports = function withAndroidTv(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    activity.$['android:banner'] = '@drawable/matro_tv_banner';
    const filters = activity['intent-filter'] ??= [];
    if (!filters.some(filter => filter.category?.some(category => category.$['android:name'] === launcher))) {
      filters.push({
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': launcher } }]
      });
    }
    const features = manifest['uses-feature'] ??= [];
    for (const name of ['android.software.leanback', 'android.hardware.touchscreen']) {
      const entry = features.find(feature => feature.$['android:name'] === name);
      if (entry) entry.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return config;
  });

  return withDangerousMod(config, ['android', async config => {
    const { projectRoot, platformProjectRoot } = config.modRequest;
    const resources = path.join(platformProjectRoot, 'app/src/main/res/drawable-xhdpi');
    await mkdir(resources, { recursive: true });
    await copyFile(path.join(projectRoot, 'assets/tv-banner.png'), path.join(resources, 'matro_tv_banner.png'));
    return config;
  }]);
};
