// Exercise the actual desktop receiver with an isolated persistent test profile.
const { app } = require('electron');
require('../apps/desktop/test-window.cjs')(app);
if (process.env.MATRO_USER_DATA) {
  require('node:fs').mkdirSync(process.env.MATRO_USER_DATA, { recursive: true });
  app.setPath('userData', process.env.MATRO_USER_DATA);
}
require('../packages/core/desktop/receiver.cjs').launchReceiver(process.env.MATRO_WEB_URL, { show: false });
