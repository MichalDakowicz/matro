module.exports = {
  testDir: './tests',
  testMatch: 'desktop.spec.cjs',
  timeout: 90000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
};
