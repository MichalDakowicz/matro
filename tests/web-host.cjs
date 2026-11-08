// Exercise the actual desktop receiver; no privileged bridge is exposed to the page.
require('../packages/core/desktop/receiver.cjs').launchReceiver(process.env.MATRO_WEB_URL, { show: false });
