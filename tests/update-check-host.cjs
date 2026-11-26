'use strict';
const { net, dialog, shell } = require('electron');

const fixture = globalThis.matroUpdateFixture = { requests: [], offers: [], opened: [], status: 200 };
const fetch = net.fetch.bind(net);
net.fetch = async (url, options) => {
  if (url !== 'https://api.github.com/repos/MichalDakowicz/matro/releases/latest') return fetch(url, options);
  fixture.requests.push({ url, credentials: options.credentials });
  return Response.json({ tag_name: 'v999.0.0', html_url: 'https://elsewhere.invalid/' }, { status: fixture.status });
};
dialog.showMessageBox = async (_window, options) => {
  fixture.offers.push(options.message);
  return { response: 0 };
};
shell.openExternal = async url => { fixture.opened.push(url); };

require('../apps/desktop/main.cjs');
