#!/usr/bin/env node
// Server administration from the machine that runs it. Creating the head account lives here, not on the web page,
// so nobody who finds the address first can claim the server. Everything after that happens in the browser.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const config = require('./config');
const { open } = require('./db');
const { createAuth } = require('./auth');
const { createLibrary } = require('./library');
const { createUsers, validateCredentials } = require('./users');
const { createInvites } = require('./invites');

const USAGE = `Matro server

  node src/cli.js setup [--username NAME] [--library PATH]...   create the head account and register media folders
  node src/cli.js invite [--days N]                             print a one-time sign-up code for a new viewer (valid 7 days by default)
  node src/cli.js passwd USERNAME                               set a new password for any account (signs it out everywhere)

The password is asked for twice, hidden. For scripts, set MATRO_PASSWORD or pass --password-stdin.
Data lives in MATRO_DATA (now: ${config.dataDir}).`;

function parse(argv) {
  const out = { _: [], library: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--username') out.username = argv[++i];
    else if (a === '--library') out.library.push(argv[++i]);
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--password-stdin') out.stdinPassword = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}
const line = question => new Promise(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(question, answer => { rl.close(); resolve(answer.trim()); }); });
function hidden(question) {
  return new Promise(resolve => {
    const { stdin, stdout } = process; let value = '';
    stdout.write(question); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); return resolve(value); }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1); else value += c;
      }
    };
    stdin.on('data', on);
  });
}
async function readPassword(args) {
  if (process.env.MATRO_PASSWORD) return process.env.MATRO_PASSWORD;
  if (args.stdinPassword) { const chunks = []; for await (const c of process.stdin) chunks.push(c); return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]; }
  if (!process.stdin.isTTY) throw new Error('No terminal to ask for a password. Set MATRO_PASSWORD or use --password-stdin.');
  const first = await hidden('Password (8 or more characters): ');
  if (first !== await hidden('Repeat password: ')) throw new Error('The passwords did not match.');
  return first;
}
function context() {
  const db = open(path.join(config.dataDir, 'matro.db'));
  const auth = createAuth(db);
  return { db, users: createUsers(db, auth), library: createLibrary(db, { autoProbe: false }) };
}

async function setup(args) {
  const { db, users, library } = context();
  if (users.count() > 0) throw new Error('This server already has accounts. Use "passwd USERNAME" to reset a password, or the web page to manage viewers.');
  const username = args.username || await (process.stdin.isTTY ? line('Head account username: ') : Promise.reject(new Error('Pass --username when there is no terminal.')));
  const creds = validateCredentials(username, await readPassword(args));
  await users.create(creds.username, creds.password, 'admin');
  console.log(`Head account "${creds.username}" created.`);

  fs.mkdirSync(config.mediaDir, { recursive: true });
  const folders = [config.mediaDir, ...config.libraryFolders, ...args.library.map(p => path.resolve(p))];
  for (const folder of new Set(folders)) {
    if (library.byPath(folder)) continue;
    try { const r = await library.addFolder(folder); if (!r.ok) throw new Error(r.error); console.log(`Library folder ${folder}: ${r.items ?? 0} video${r.items === 1 ? '' : 's'} found.`); }
    catch (error) { console.error(`Library folder ${folder} skipped: ${error.message}`); }
  }
  db.close();
  console.log('\nDone. Open the server in a browser and sign in with this account; adding folders, uploads and viewer accounts are on the Manage page.');
}
async function invite(args) {
  const { db } = context();
  const head = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!head) throw new Error('Run "setup" first to create the head account.');
  const { code, expires } = createInvites(db).create(head.id, args.days);
  db.close();
  console.log(`Invite code: ${code}
Valid until ${new Date(expires).toLocaleString()}, works once.
The new person enters it on the sign-in page under "Have an invite code?".`);
}
async function passwd(args) {
  const { db, users } = context();
  const user = users.byName(args._[1] || '');
  if (!user) throw new Error(`No account named "${args._[1] || ''}".`);
  const { password } = validateCredentials(user.username, await readPassword(args));
  await users.setPassword(user.id, password);
  db.close();
  console.log(`Password for "${user.username}" changed. They were signed out everywhere.`);
}

async function main() {
  const args = parse(process.argv.slice(2)), command = args._[0];
  if (args.help || !command) { console.log(USAGE); return; }
  if (command === 'setup') await setup(args);
  else if (command === 'invite') await invite(args);
  else if (command === 'passwd') await passwd(args);
  else throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
}
main().then(() => process.exit(0), error => { console.error(`Error: ${error.message}`); process.exit(1); });
