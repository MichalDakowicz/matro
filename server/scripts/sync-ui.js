// Copies the desktop app's renderer into public/ so the server serves the very same UI code and styles.
// Run after changing ../src (npm start does it automatically when ../src is next to this folder).
const fs = require('node:fs');
const path = require('node:path');

const from = path.join(__dirname, '..', '..', 'src'), to = path.join(__dirname, '..', 'public');
const files = ['app.js', 'styles.css', 'theme.js', 'downloads.js', 'downloads-settings.js', 'downloads-view.js', 'downloads.css'];
function sync() {
  if (!fs.existsSync(from)) return false;
  for (const file of files) fs.copyFileSync(path.join(from, file), path.join(to, file));
  fs.cpSync(path.join(from, 'assets'), path.join(to, 'assets'), { recursive: true });
  // The desktop's own TMDB matcher (plain Node, no Electron), so titles match exactly as they do on the desktop.
  const vendor = path.join(__dirname, '..', 'src', 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', '..', 'electron', 'metadata.cjs'), path.join(vendor, 'metadata.cjs'));
  for (const file of ['torrents.cjs', 'download-layout.cjs', 'download-jobs.cjs', 'series-catalog.cjs', 'torrent-connection.cjs']) {
    fs.copyFileSync(path.join(__dirname, '..', '..', 'electron', file), path.join(vendor, file));
  }
  return true;
}
if (require.main === module) console.log(sync() ? 'Desktop UI copied into public/.' : 'No ../src next to this folder; using the copy already in public/.');
module.exports = { sync };
