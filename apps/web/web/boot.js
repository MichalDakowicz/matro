// Sign in first, then hand the page to the desktop renderer (app.js) with window.matro backed by this server.
import { signIn, signOut } from './auth.js';
import { createAdapter } from './adapter.js';
import { profileButton, openProfile } from './profile.js';
import { installDesktopChrome } from './desktop.js';
import { savedDownloads } from './saved-downloads.js';
import { migrateLegacyScope } from './offline.js';
import './touch.js';

installDesktopChrome();
if (!document.fullscreenEnabled && !window.matroDesktop) document.body.classList.add('no-fullscreen');
const root = document.getElementById('app');
let offline = false;
const openMovieRequests = new URLSearchParams(location.search).get('view') === 'movie-requests';
const user = await signIn(root, () => { offline = true; });
if (!offline && user.legacyScope) await migrateLegacyScope(user).catch(error => console.warn('Offline account migration failed:', error));
const session = { user, offline, openMovieRequests };
root.replaceChildren();
document.body.classList.add(user.role === 'admin' ? 'role-admin' : 'role-viewer');

const adapter = createAdapter(session);
window.matro = adapter.matro;
if (import.meta.env.PROD && navigator.serviceWorker) void navigator.serviceWorker.register('/sw.js').catch(() => {});
const leave = async () => {
  adapter.offline.shutdown();
  await signOut();
};
const openSaved = () => savedDownloads({ ...adapter, onOpenTitle: id => document.dispatchEvent(new CustomEvent('matro:saved-title', { detail: id })) });
profileButton(session, () => openProfile({ session, getState: adapter.state, forgetTracks: () => adapter.matro.savePreferences({ tracks: null }), signOut: leave, openSaved }));
if (offline) {
  const note = document.createElement('button');
  note.className = 'pill small offline-indicator'; note.textContent = 'Offline · Reconnect';
  note.addEventListener('click', () => location.reload());
  document.querySelector('.window-zone').append(note);
}
await import('../../../packages/browser-ui/app.js');
await import('./history.js');
