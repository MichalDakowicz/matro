const fs = require('node:fs');
const config = require('./config');
const { open } = require('./db');
const { createAuth } = require('./auth');
const { createLibrary } = require('./library');
const { createRouter, createServer } = require('./http');
const { createTmdb } = require('./tmdb');
const { createInvites } = require('./invites');
const { createDownloads } = require('./downloads');

function createApp({ dataDir = config.dataDir, tmdb: tmdbOptions, downloads: downloadOptions } = {}) {
  const db = open(require('node:path').join(dataDir, 'matro.db'));
  const auth = createAuth(db), library = createLibrary(db), router = createRouter();
  const app = { db, auth, library, router, tmdb: createTmdb(db, tmdbOptions), invites: createInvites(db) };
  app.downloads = createDownloads({ dataDir, library, tmdb: app.tmdb, ...downloadOptions });
  for (const name of ['account', 'library', 'play', 'admin', 'downloads']) require(`./routes/${name}`).register(app);
  const server = createServer({ router, publicDir: config.publicDir, authenticate: token => auth.user(token), config });
  server.on('close', () => app.downloads.close());
  return { app, server, db, library };
}

async function main() {
  fs.mkdirSync(config.mediaDir, { recursive: true });
  const { server, library, app } = createApp();
  if (!library.byPath(config.mediaDir)) await library.addFolder(config.mediaDir);
  // Folders the operator wants shared from the start, e.g. read-only mounts in a container.
  for (const folder of config.libraryFolders) if (!library.byPath(folder)) await library.addFolder(folder).catch(error => console.error(`library folder ${folder}: ${error.message}`));
  library.rescanAll().catch(error => console.error('scan failed:', error.message));
  library.probeSoon();
  app.tmdb.sync();
  app.downloads.start();
  setInterval(() => library.rescanAll().then(() => app.tmdb.sync()).catch(() => {}), 30 * 60 * 1000).unref();
  server.listen(config.port, config.host, () => console.log(`Matro server on http://${config.host}:${config.port}  data: ${config.dataDir}`));
}
if (require.main === module) main();
module.exports = { createApp, main };
