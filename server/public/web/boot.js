// Sign in first, then hand the page to the desktop renderer (app.js) with window.matro backed by this server.
import { post } from './http.js';
import { signIn } from './auth.js';
import { createAdapter } from './adapter.js';
import { profileButton, openProfile } from './profile.js';
import { downloadsButton, openDownloads } from './downloads-page.js';
import './touch.js';

// Keeps the app itself on the device (HTTPS addresses only) so it opens, and saved titles play, with no connection.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (!document.fullscreenEnabled) document.body.classList.add('no-fullscreen');
const root = document.getElementById('app');
const user = await signIn(root);
const session = { user };
root.replaceChildren();
document.body.classList.add(user.role === 'admin' ? 'role-admin' : 'role-viewer');

const adapter = createAdapter(session);
window.matro = adapter.matro;
const signOut = async () => { await post('/api/logout').catch(() => {}); location.reload(); };
downloadsButton(() => openDownloads({ retry: id => adapter.matro.offline.toggle(id) }));
profileButton(session, () => openProfile({ session, getState: adapter.state, save: () => adapter.matro.save(adapter.state()), signOut }));
await import('/app.js');
await import('./history.js');
