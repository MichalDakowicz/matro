module.exports = {
  testDir: './tests',
  testMatch: /(?:^|\/)(?:desktop|ssh-desktop|downloads|upgrades|series)\.spec\.cjs$/,
  timeout: 90000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
};
