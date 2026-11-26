process.env.MATRO_TEST_WINDOW ??= '1';

module.exports = {
  testDir: './tests',
  testMatch: /(?:^|\/)(?:desktop|ssh-desktop|downloads|upgrades|series|web|web-network|buffering|source-switch|receiver-window|open-with)\.spec\.cjs$/,
  timeout: 90000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
};
