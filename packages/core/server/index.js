const fs = require('node:fs');
const config = require('./config');
const { open } = require('./db');
const { createAuth } = require('./auth');
const { createLibrary } = require('./library');
const { createRouter, createServer } = require('./http');
const { createTmdb } = require('./tmdb');
const { createInvites } = require('./invites');
const { createDownloads } = require('./downloads');
const { createMovieRequests } = require('./movie-requests');

function createApp({ dataDir = config.dataDir, tmdb: tmdbOptions, downloads: downloadOptions, movieRequests: requestOptions } = {}) {
  const db = open(require('node:path').join(dataDir, 'matro.db'));
  const auth = createAuth(db), library = createLibrary(db, { excludedFiles: root => app.downloads.pendingLibraryFiles(root), onChange: () => { app.scanner?.invalidate(); app.movieRequests?.fulfil(); } }), router = createRouter();
  const app = { dataDir, db, auth, library, router, tmdb: createTmdb(db, tmdbOptions), invites: createInvites(db) };
  app.scanner = require('./segments').createScanner({ dataDir, db });
  app.downloads = createDownloads({ dataDir, library, tmdb: app.tmdb, afterImport: () => app.movieRequests?.fulfil(), ...downloadOptions });
  app.movieRequests = createMovieRequests(db, requestOptions);
  for (const name of ['account', 'library', 'play', 'admin', 'downloads', 'movie-requests']) require(`./routes/${name}`).register(app);
  const server = createServer({ router, publicDir: config.publicDir, authenticate: token => auth.session(token), config });
  server.on('listening', () => app.movieRequests.start());
  server.on('close', () => { app.scanner.close(); app.downloads.close(); app.movieRequests.close(); app.closePlayback?.(); });
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
  app.scanner.refresh();
  setInterval(() => library.rescanAll().then(() => app.tmdb.sync()).catch(() => {}), 30 * 60 * 1000).unref();
  server.listen(config.port, config.host, () => console.log(`Matro server on http://${config.host}:${config.port}  data: ${config.dataDir}`));
}
if (require.main === module) main();
module.exports = { createApp, main };
