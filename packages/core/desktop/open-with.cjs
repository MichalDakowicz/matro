const path = require('node:path');
const { extensions } = require('./media.cjs');

// Media files named on a command line, as Windows passes them for "Open with Matro" and double-clicks.
// A packaged app gets them from argv[1]; `electron <app folder>` has the app folder in argv[1] first.
function mediaArgs(argv, { cwd = process.cwd(), defaultApp = process.defaultApp } = {}) {
  return argv.slice(defaultApp ? 2 : 1)
    .filter((value, index, args) => value && !value.startsWith('-') && args[index - 1] !== '--server' && !/^[a-z][a-z0-9+.-]+:\/\//i.test(value)
      && extensions.has(path.extname(value).slice(1).toLowerCase()))
    .map(value => path.resolve(cwd, value));
}

module.exports = { mediaArgs };
