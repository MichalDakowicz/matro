// Electron host entry; application services live in the shared core.
const { app } = require('electron');
if (!app.isPackaged && process.env.MATRO_USER_DATA) app.setPath('userData', require('node:path').resolve(process.env.MATRO_USER_DATA));
const { loadSource } = require('../../packages/core/desktop/desktop-source.cjs');
const flag = process.argv.findIndex(value => value === '--server');
const saved = loadSource(app.getPath('userData'));
const server = process.argv.includes('--local') ? null : process.env.MATRO_SERVER_URL || (flag >= 0 ? process.argv[flag + 1] : saved.enabled ? saved.url : null);
const source = require('../../packages/core/desktop/source-switch.cjs').installSourceSwitch(server);
if (server) require('../../packages/core/desktop/receiver.cjs').launchReceiver(server, { onUnavailable: () => source.show('Could not reach the saved server. Try another address or use this PC.') });
else require('../../packages/core/desktop/runtime.cjs');
