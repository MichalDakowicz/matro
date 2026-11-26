const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const config = require('./config');
const { open, lockData } = require('./db');
const { createAuth } = require('./auth');
const { createLibrary } = require('./library');
const { createRouter, createServer } = require('./http');
const { createTmdb } = require('./tmdb');
const { createInvites } = require('./invites');
const { createDownloads } = require('./downloads');
const { createMovieRequests } = require('./movie-requests');
const { createSubtitleSearch } = require('./subtitle-search');

function createApp({ dataDir = config.dataDir, tmdb: tmdbOptions, downloads: downloadOptions, movieRequests: requestOptions, subtitleSearch: subtitleOptions } = {}) {
  const db = open(require('node:path').join(dataDir, 'matro.db'));
  const auth = createAuth(db), library = createLibrary(db, { excludedFiles: root => app.downloads.pendingLibraryFiles(root), onScan: folderId => app.tmdb.refreshLocal(folderId), onChange: () => { app.scanner?.invalidate(); fulfilRequests(); } }), router = createRouter();
  let closed = false;
  const fulfilRequests = () => {
    if (!closed && db.isOpen !== false && app.movieRequests?.fulfil()) library.state.revision = randomUUID();
  };
  const tmdb = createTmdb(db, { ...tmdbOptions, dataDir, onUpdate: fulfilRequests, onLocalChange: () => library.changed() });
  const app = { dataDir, db, auth, library, router, tmdb, invites: createInvites(db) };
  app.scanner = require('./segments').createScanner({ dataDir, db });
  app.downloads = createDownloads({ dataDir, library, tmdb: app.tmdb, afterImport: fulfilRequests, ...downloadOptions });
  app.movieRequests = createMovieRequests(db, requestOptions, () => tmdb.snapshot());
  app.subtitleSearch = createSubtitleSearch({ dir: dataDir, ...subtitleOptions });
  for (const name of ['account', 'lists', 'follows', 'library', 'play', 'admin', 'downloads', 'movie-requests', 'remote']) require(`./routes/${name}`).register(app);
  const server = createServer({ router, publicDir: config.publicDir, authenticate: token => auth.session(token), config });
  server.on('listening', () => app.movieRequests.start());
  server.on('close', () => { closed = true; app.scanner.close(); app.downloads.close(); app.movieRequests.close(); app.closePlayback?.(); });
  return { app, server, db, library };
}

async function main() {
  const unlock = lockData(config.dataDir);
  fs.mkdirSync(config.mediaDir, { recursive: true });
  const { server, library, app, db } = createApp();
  server.on('close', () => { db.close(); unlock(); });
  if (!await library.coveringFolder(config.mediaDir)) {
    await library.addFolder(config.mediaDir).catch(error => {
      if (error.status !== 409) throw error;
      console.error(`library folder ${config.mediaDir}: ${error.message}`);
    });
  }
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
