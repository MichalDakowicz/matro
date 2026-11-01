// Sign in first, then hand the page to the desktop renderer (app.js) with window.matro backed by this server.
import { post } from './http.js';
import { signIn } from './auth.js';
import { createAdapter } from './adapter.js';
import { profileButton, openProfile } from './profile.js';
import './touch.js';

if (!document.fullscreenEnabled) document.body.classList.add('no-fullscreen');
const root = document.getElementById('app');
const user = await signIn(root);
const session = { user };
root.replaceChildren();
document.body.classList.add(user.role === 'admin' ? 'role-admin' : 'role-viewer');

const adapter = createAdapter(session);
window.matro = adapter.matro;
const signOut = async () => { await post('/api/logout').catch(() => {}); location.reload(); };
profileButton(session, () => openProfile({ session, getState: adapter.state, save: () => adapter.matro.save(adapter.state()), signOut }));
await import('/app.js');
