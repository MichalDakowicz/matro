const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createHash, randomBytes } = require('node:crypto');

// The helper runs only for the lifetime of SSH. It exposes no network port and
// confines reads and non-overwriting subtitle uploads to the configured directory.
const MAX_SUBTITLE_BYTES = 16 * 1024 * 1024;
const subtitleExtension = file => /\.(srt|vtt|ass|ssa)$/i.test(file);
const helper = `import sys,json,os,stat,base64,concurrent.futures,threading,tempfile,errno
root=os.path.realpath(sys.argv[1])
lock=threading.Lock()
def info(st):
 return dict(size=st.st_size,mtimeMs=st.st_mtime*1000,file=stat.S_ISREG(st.st_mode),directory=stat.S_ISDIR(st.st_mode))
def request(q):
 try:
  name=os.path.realpath(os.path.join(root,q.get('path','')))
  if os.path.commonpath([root,name])!=root: raise ValueError('Path is outside the media folder')
  op=q['op']
  if op=='stat': result=info(os.stat(name))
  elif op=='list':
   with os.scandir(name) as entries:
    result=[dict(name=e.name,file=e.is_file(follow_symlinks=False),directory=e.is_dir(follow_symlinks=False)) for e in entries if not e.is_symlink()]
  elif op=='read':
   count=int(q['length']); offset=int(q['offset'])
   if not 0<=count<=1048576 or offset<0: raise ValueError('Invalid read range')
   if not stat.S_ISREG(os.stat(name).st_mode): raise ValueError('Not a regular file')
   with open(name,'rb') as f:
    f.seek(offset); result=base64.b64encode(f.read(count)).decode('ascii')
  elif op=='subtitle':
   if os.path.splitext(name)[1].lower() not in ('.srt','.vtt','.ass','.ssa'): raise ValueError('Only subtitle files can be uploaded')
   encoded=q['data']
   if len(encoded)>22369624: raise ValueError('Subtitle files must be 16 MiB or smaller')
   data=base64.b64decode(encoded,validate=True)
   if len(data)>16777216: raise ValueError('Subtitle files must be 16 MiB or smaller')
   temporary=None
   try:
    with tempfile.NamedTemporaryFile(dir=os.path.dirname(name),prefix='.matro-subtitle-',delete=False) as f:
     temporary=f.name; f.write(data); f.flush(); os.fsync(f.fileno())
    os.chmod(temporary,0o644)
    os.link(temporary,name)
    result=True
   finally:
    if temporary is not None: os.unlink(temporary)
  else: raise ValueError('Unsupported operation')
  response=dict(id=q['id'],result=result)
 except Exception as e: response=dict(id=q.get('id'),error=str(e),code=errno.errorcode.get(getattr(e,'errno',None)))
 with lock:
  print(json.dumps(response),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for line in sys.stdin:
  try: pool.submit(request,json.loads(line))
  except Exception: pass
`;

function normalize(config) {
  if (!config || typeof config !== 'object') throw new Error('Enter SSH connection details.');
  const host = String(config.host || '').trim(), user = String(config.user || '').trim();
  const port = Number(config.port === undefined || config.port === '' ? 22 : config.port), directory = String(config.directory || '').trim();
  const identity = String(config.identity || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:[\]_-]*$/.test(host)) throw new Error('Enter a valid SSH hostname or IP address.');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(user)) throw new Error('Enter a valid SSH username.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH port must be between 1 and 65535.');
  if (!directory.startsWith('/') || /[\0\r\n]/.test(directory)) throw new Error('Use an absolute server folder, such as /mnt/media.');
  if (identity && (!path.isAbsolute(identity) || /[\0\r\n]/.test(identity))) throw new Error('Use an absolute path to your SSH private key.');
  return { host, user, port, directory: path.posix.normalize(directory).replace(/\/$/, '') || '/', identity };
}
function connectionId(config) { return createHash('sha256').update(JSON.stringify(normalize(config))).digest('hex').slice(0, 24); }
function rootFor(config) { return path.join(path.parse(process.cwd()).root, '.matro-ssh', connectionId(config), 'media'); }
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

class SSHMedia {
  constructor({ spawnSSH = spawn } = {}) {
    this.spawnSSH = spawnSSH;
    this.configs = new Map(); this.sessions = new Map(); this.tokens = new Map();
    this.server = null; this.listening = null; this.closed = false;
  }
  register(config) { config = normalize(config); const root = rootFor(config); this.configs.set(root, config); return root; }
  resolve(file) {
    if (typeof file !== 'string') return null;
    for (const [root, config] of this.configs) {
      if (file !== root && !file.startsWith(root + path.sep)) continue;
      const relative = path.relative(root, file);
      if (relative.split(path.sep).some(part => part === '..')) throw new Error('Invalid SSH media path.');
      return { root, config, relative: relative.split(path.sep).join('/') };
    }
    return null;
  }
  isRemote(file) { return !!this.resolve(file); }
  label(file) {
    const match = this.resolve(file);
    return match ? `${match.config.user}@${match.config.host}:${path.posix.join(match.config.directory, match.relative)}` : file;
  }
  session(root, config) {
    if (this.closed) throw new Error('SSH media has closed.');
    if (this.sessions.has(root)) return this.sessions.get(root);
    const script = Buffer.from(helper).toString('base64');
    const command = `python3 -u -c ${quote(`import base64;exec(base64.b64decode('${script}'))`)} ${quote(config.directory)}`;
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', String(config.port), '-l', config.user];
    if (config.identity) args.push('-i', config.identity);
    args.push('--', config.host, command);
    const child = this.spawnSSH('ssh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { child, pending: new Map(), sequence: 0, error: '' };
    this.sessions.set(root, session);
    const fail = message => {
      if (this.sessions.get(root) === session) this.sessions.delete(root);
      for (const job of session.pending.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
      session.pending.clear();
    };
    child.stderr.on('data', data => { session.error = (session.error + data).slice(-2000); });
    child.on('error', error => fail(`Cannot start SSH: ${error.message}`));
    child.stdin.on('error', () => fail(session.error.trim() || 'SSH connection closed.'));
    child.on('close', () => fail(session.error.trim() || 'SSH disconnected. Check the server and rescan to reconnect.'));
    createInterface({ input: child.stdout }).on('line', line => {
      let response; try { response = JSON.parse(line); } catch { return; }
      const job = session.pending.get(response.id); if (!job) return;
      session.pending.delete(response.id); clearTimeout(job.timer);
      response.error ? job.reject(Object.assign(new Error(response.error), { code: response.code })) : job.resolve(response.result);
    });
    return session;
  }
  async request(file, op, values = {}) {
    const match = this.resolve(file); if (!match) throw new Error('Unknown SSH media folder.');
    const session = this.session(match.root, match.config), id = ++session.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { session.pending.delete(id); reject(new Error('SSH timed out. Check authentication and that Python 3 is installed on the server.')); session.child.kill(); }, 30000);
      session.pending.set(id, { resolve, reject, timer });
      session.child.stdin.write(JSON.stringify({ id, op, path: match.relative, ...values }) + '\n');
    });
  }
  async stat(file) {
    const value = await this.request(file, 'stat');
    return { ...value, isFile: () => value.file, isDirectory: () => value.directory };
  }
  async readdir(file, options) {
    const entries = await this.request(file, 'list');
    // Windows path operations cannot represent a literal slash or backslash in a name.
    const safe = entries.filter(e => e.name !== '.' && e.name !== '..' && !/[\\/]/.test(e.name));
    return options?.withFileTypes ? safe.map(e => ({ name: e.name, isFile: () => e.file, isDirectory: () => e.directory })) : safe.map(e => e.name);
  }
  async copySubtitle(source, target, flags) {
    if (flags !== fs.constants.COPYFILE_EXCL || this.isRemote(source) || !this.isRemote(target) || !subtitleExtension(source) || !subtitleExtension(target)) throw new Error('SSH saving supports new subtitle files only.');
    const sourceFile = await fs.open(source, 'r');
    let data;
    try {
      const stat = await sourceFile.stat();
      if (!stat.isFile() || stat.size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle files must be regular files of 16 MiB or smaller.');
      // Bound the read even if another program appends to the source during upload.
      data = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await sourceFile.read(data, offset, data.length - offset, offset);
        if (!bytesRead) throw new Error('The subtitle file changed during upload. Try again.');
        offset += bytesRead;
      }
    } finally { await sourceFile.close(); }
    await this.request(target, 'subtitle', { data: data.toString('base64') });
  }
  async serve(req, res) {
    try {
      const file = this.tokens.get(new URL(req.url, 'http://localhost').pathname.slice(1));
      if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
      const stat = await this.stat(file); if (!stat.isFile()) { res.writeHead(404).end(); return; }
      let start = 0, end = stat.size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
        status = 206;
      }
      const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      if (res.destroyed) return;
      res.writeHead(status, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      while (start <= end && !res.destroyed) {
        const data = Buffer.from(await this.request(file, 'read', { offset: start, length: Math.min(512 * 1024, end - start + 1) }), 'base64');
        if (!data.length) throw new Error('Media file changed during playback.');
        start += data.length;
        if (res.destroyed) return;
        if (!res.write(data)) await new Promise(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
        });
      }
      res.end();
    } catch { if (res.headersSent) res.destroy(); else res.writeHead(502).end('SSH media is unavailable.'); }
  }
  async input(file) {
    if (!this.isRemote(file)) return file;
    if (!this.listening) {
      this.server = http.createServer((req, res) => { void this.serve(req, res); });
      this.listening = new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    }
    await this.listening;
    let token = [...this.tokens].find(([, name]) => name === file)?.[0];
    if (!token) { token = randomBytes(32).toString('hex'); this.tokens.set(token, file); }
    return `http://127.0.0.1:${this.server.address().port}/${token}`;
  }
  async args(args) {
    const result = await Promise.all(args.map(arg => this.isRemote(arg) ? this.input(arg) : arg));
    // Only this process creates the tokenized loopback URLs. Remote media cannot
    // supply an arbitrary network URL through the renderer.
    if (args.some(arg => this.isRemote(arg))) {
      const i = result.indexOf('-protocol_whitelist');
      if (i >= 0) result[i + 1] = 'file,pipe,crypto,http,tcp';
      else result.unshift('-protocol_whitelist', 'file,pipe,crypto,http,tcp');
    }
    return result;
  }
  remove(root) {
    this.configs.delete(root);
    const session = this.sessions.get(root); this.sessions.delete(root); session?.child.kill();
    for (const [token, file] of this.tokens) if (file === root || file.startsWith(root + path.sep)) this.tokens.delete(token);
  }
  close() { this.closed = true; for (const session of this.sessions.values()) session.child.kill(); this.server?.close(); this.server?.closeAllConnections(); }
}

const remote = new SSHMedia();
const mediaFS = {
  ...fs,
  stat: (file, ...args) => remote.isRemote(file) ? remote.stat(file) : fs.stat(file, ...args),
  readdir: (file, ...args) => remote.isRemote(file) ? remote.readdir(file, ...args) : fs.readdir(file, ...args),
  copyFile: (source, target, flags) => remote.isRemote(target) ? remote.copySubtitle(source, target, flags) : remote.isRemote(source) ? Promise.reject(new Error('Copying SSH media to a local file is not supported.')) : fs.copyFile(source, target, flags)
};
module.exports = { SSHMedia, remote, mediaFS, normalize, rootFor, helper };
