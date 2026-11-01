const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTorrents } = require('./vendor/torrents.cjs');
const config = require('./config');

// The head account manages qBittorrent on this same host (including a shared Docker mount).
function createDownloads({ dataDir, library, tmdb, pathMap = JSON.parse(process.env.MATRO_DOWNLOAD_PATH_MAP || '{}'), hostConfig = {}, ...options }) {
  const host = {
    url: process.env.MATRO_QBITTORRENT_URL || 'http://127.0.0.1:8080',
    movieRoot: process.env.MATRO_DOWNLOAD_MOVIES || path.join(config.mediaDir, 'Movies'),
    showRoot: process.env.MATRO_DOWNLOAD_SHOWS || path.join(config.mediaDir, 'Shows'),
    ...hostConfig
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'downloads.key');
  try { fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('Invalid downloads.key. Restore the original key from backup.');
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    }
  };
  const within = (root, file) => { const rel = path.relative(root, file); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  // Resolve the nearest existing ancestor, so symlinks cannot bypass the library boundary.
  async function canonical(file) {
    try { return await fsp.realpath(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(file);
      if (parent === file) throw error;
      return path.join(await canonical(parent), path.basename(file));
    }
  }
  async function validate(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || /[\0\r\n]/.test(file)) throw new Error('Use an absolute folder on the Matro host.');
    let mapped = path.resolve(file);
    for (const [source, destination] of Object.entries(pathMap).sort((a, b) => b[0].length - a[0].length)) {
      if (within(source, mapped)) { mapped = path.join(destination, path.relative(source, mapped)); break; }
    }
    const actual = await canonical(mapped);
    for (const folder of library.folders()) if (within(await canonical(folder.path), actual)) return actual;
    throw new Error('Add this destination under Folders first. Downloads must stay inside a shared library folder.');
  }
  const torrents = createTorrents({ ...options, dir: dataDir, secure, videos: config.mediaDir,
    checkPaths: async (_target, _config, files) => {
      let exists = false;
      for (const file of files) {
        const actual = await validate(file);
        try { await fsp.lstat(actual); exists = true; }
        catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      }
      return exists;
    },
    onComplete: async () => { await library.rescanAll(); tmdb.sync(); }
  });
  return {
    ...torrents,
    async configure(value) {
      if (value?.target && value.target !== 'server') throw new Error('Downloads run on the Matro host.');
      for (const field of ['movieRoot', 'showRoot']) await validate(host[field]);
      const previous = await torrents.config();
      return torrents.configure({ target: 'server', url: host.url, username: value.username, password: value.password,
        sshHost: '', storage: { ...previous.server?.storage, movieRoot: host.movieRoot, showRoot: host.showRoot } });
    },
    async add(value) {
      if (value?.target !== 'server') throw new Error('Downloads run on the Matro host.');
      const saved = (await torrents.config()).server;
      if (!saved) throw new Error('Configure the host download client first.');
      for (const field of ['movieRoot', 'showRoot']) await validate(saved.storage[field]);
      return torrents.add(value);
    }
  };
}
module.exports = { createDownloads };
