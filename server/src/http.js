const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'
};

function cookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a malformed cookie */ } }
  }
  return out;
}
async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'That is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJson(req, limit = 65536) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try { const value = JSON.parse(raw.toString('utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* falls through */ }
  throw new HttpError(400, 'Send a JSON object.');
}
function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers }).end(body);
}
async function sendFile(req, res, file, type, extra = {}) {
  const { size } = await fsp.stat(file);
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    if (range[1] === '') start = Math.max(0, size - Number(range[2]));
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    status = 206;
  }
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...extra };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  pipeline(fs.createReadStream(file, { start, end }), res, () => {});
}

function createRouter() {
  const routes = [];
  return {
    add(method, pattern, options, handler) {
      if (typeof options === 'function') { handler = options; options = {}; }
      const names = [];
      const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, name) => { names.push(name); return '([^/]+)'; }) + '$');
      routes.push({ method, regex, names, auth: options.auth || 'user', handler });
    },
    match(method, pathname) {
      for (const route of routes) {
        const m = route.method === method && route.regex.exec(pathname);
        if (m) {
          try { return { route, params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(m[i + 1])])) }; }
          catch { throw new HttpError(400, 'Bad address.'); }
        }
      }
      return null;
    }
  };
}

// Every start gets a new version. Scripts, stylesheets and the modules they import are requested as /file?v=VERSION, so a deploy
// changes their URLs: browsers and Cloudflare can never serve an old copy, whatever they cached under the old URL.
const BUILD = Date.now().toString(36);
const rewritten = new Map();
function versioned(ext, text) {
  if (ext === '.html') return text.replace(/((?:src|href)="[/][^"?#]+[.](?:js|css))"/g, (m, head) => `${head}?v=${BUILD}"`);
  return text.replace(/((?:^|[^a-zA-Z0-9_])(?:from|import) *[(]? *)(['"])((?:[.]{1,2}[/]|[/])[^'"?]+[.]js)(['"])/g, (m, head, open, spec, close) => `${head}${open}${spec}?v=${BUILD}${close}`);
}
function createServer({ router, publicDir, authenticate, config }) {
  async function serveStatic(req, res, pathname, query) {
    let rel; try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)); } catch { throw new HttpError(404, 'Not found'); }
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'Not found');
    let stat; try { stat = await fsp.stat(file); } catch { throw new HttpError(404, 'Not found'); }
    if (!stat.isFile()) throw new HttpError(404, 'Not found');
    const ext = path.extname(file);
    if (['.html', '.js'].includes(ext)) {
      const key = file + stat.mtimeMs; let body = rewritten.get(key);
      if (!body) { body = Buffer.from(versioned(ext, await fsp.readFile(file, 'utf8'))); rewritten.set(key, body); }
      // The page itself is always revalidated; a script asked for with this build's version never changes, so it may be kept for good.
      const immutable = ext === '.js' && query.get('v') === BUILD;
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': body.length, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'private, no-cache' });
      return void res.end(req.method === 'HEAD' ? undefined : body);
    }
    await sendFile(req, res, file, MIME[ext] || 'application/octet-stream', { 'Cache-Control': ext === '.woff2' ? 'public, max-age=604800' : 'private, no-cache' });
  }
  return http.createServer(async (req, res) => {
    for (const [key, value] of Object.entries(SECURITY)) res.setHeader(key, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const api = url.pathname.startsWith('/api/');
      const found = api ? router.match(method, url.pathname) : null;
      if (!found) {
        if (api) throw new HttpError(404, 'Not found');
        if (method !== 'GET') throw new HttpError(405, 'Not allowed');
        return await serveStatic(req, res, url.pathname, url.searchParams);
      }
      if (method !== 'GET') {
        // Cookies alone must never authorise a write from another site: require our header and a matching Origin.
        if (req.headers['x-matro'] !== '1') throw new HttpError(403, 'Missing request header.');
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request refused.');
      }
      const token = cookies(req.headers.cookie).matro_session;
      const user = authenticate(token);
      const { route, params } = found;
      if (route.auth !== 'none' && !user) throw new HttpError(401, 'Sign in first.');
      if (route.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only the head account can do that.');
      const forwarded = config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ctx = { req, res, params, query: url.searchParams, user, token, ip: forwarded || req.socket.remoteAddress,
        // Secure only when this request really arrived over HTTPS; a Secure cookie set over plain HTTP (the LAN address) is dropped by the browser.
        secure: Boolean(req.socket.encrypted) || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https') };
      const result = await route.handler(ctx);
      if (!res.headersSent && !res.writableEnded) sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (error) {
      // Helpers outside this file signal user mistakes with a 4xx `status` on a plain Error.
      const status = error instanceof HttpError || (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) ? error.status : 500;
      if (status === 500) console.error(error);
      if (res.headersSent) { res.destroy(); return; }
      sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server.' : error.message });
    }
  });
}
module.exports = { HttpError, createRouter, createServer, readJson, readBody, sendJson, sendFile, MIME };
