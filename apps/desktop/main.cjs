// Electron host entry; application services live in the shared core.
const flag = process.argv.findIndex(value => value === '--server');
const server = process.env.MATRO_SERVER_URL || (flag >= 0 ? process.argv[flag + 1] : null);
if (server) require('../../packages/core/desktop/receiver.cjs').launchReceiver(server);
else require('../../packages/core/desktop/runtime.cjs');
