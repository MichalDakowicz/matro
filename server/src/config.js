const path = require('node:path');

const dataDir = path.resolve(process.env.MATRO_DATA || path.join(__dirname, '..', 'data'));
const binary = (env, pkg, fallback) => {
  if (process.env[env]) return process.env[env];
  try { const value = require(pkg); return (typeof value === 'string' ? value : value.path) || fallback; } catch { return fallback; }
};

module.exports = {
  port: Number(process.env.PORT || 8484),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  // Uploads from the head account land here; the folder is registered as a library folder automatically.
  mediaDir: path.resolve(process.env.MATRO_MEDIA || path.join(dataDir, 'media')),
  publicDir: path.join(__dirname, '..', 'public'),
  libraryFolders: (process.env.MATRO_LIBRARY || '').split(',').map(p => p.trim()).filter(Boolean).map(p => path.resolve(p)),
  trustProxy: process.env.MATRO_TRUST_PROXY === '1',
  maxTranscodes: Number(process.env.MATRO_MAX_TRANSCODES || 4),
  maxUploadBytes: Number(process.env.MATRO_MAX_UPLOAD_GB || 64) * 1024 ** 3,
  ffmpeg: binary('MATRO_FFMPEG', 'ffmpeg-static', 'ffmpeg'),
  ffprobe: binary('MATRO_FFPROBE', 'ffprobe-static', 'ffprobe'),
  sessionDays: 30
};
