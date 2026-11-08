const fs = require('node:fs/promises');
const path = require('node:path');

function destinationFile({ remote, connections }, target, config, file) {
  if (target === 'local') return file;
  const host = (config.sshHost || new URL(config.url).hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const connection = connections().find(item => item.host.toLowerCase() === host && (file === item.directory || file.startsWith(item.directory.replace(/\/$/, '') + '/')));
  if (!connection) throw new Error('Connect this server’s media root under Folders → Connect SSH so Matro can check for existing files before downloading.');
  return path.join(remote.register(connection), path.posix.relative(connection.directory, file));
}
function createPathChecker(options) {
  const { remote } = options;
  return async (target, config, files) => {
    for (const file of files) {
      const actual = destinationFile(options, target, config, file);
      try { await (target === 'server' ? remote.stat(actual) : fs.lstat(actual)); return true; }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
    return false;
  };
}
module.exports = { createPathChecker, destinationFile };
