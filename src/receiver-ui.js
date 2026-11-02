// Receiver mode screens the local library has no use for: the account (password, invites and people, subtitles you added,
// titles saved for offline) and the server's folder picker. Loaded only when the app is running against a server.
const api = window.matro;
const call = (method, route, body) => api.receiverCall({ method, route, body });

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return el;
}
const say = message => { const toast = document.getElementById('toast'); toast.textContent = message; toast.hidden = false; clearTimeout(say.timer); say.timer = setTimeout(() => { toast.hidden = true; }, 5000); };
const fail = error => say((error.message || String(error)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
const size = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const names = new Intl.DisplayNames(navigator.languages, { type: 'language' });
const languageName = code => { try { return names.of(code) || code; } catch { return code; } };
const LANGUAGES = 'en ja pl de fr es it pt ru uk cs sk hu ro nl sv no da fi el tr he ar zh ko hi th vi id bg hr sr sl lt lv et ca fa und'.split(' ');
const KIND = { full: 'Full', forced: 'Forced only', sdh: 'SDH / captions' };

function dialog(title, body) {
  let finish, value = null; const done = new Promise(resolve => { finish = resolve; });
  const el = h('dialog', { class: 'receiver-dialog', 'aria-label': title }, h('div', { class: 'section-heading' }, h('h2', {}, title), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => el.close() }, '×')), body);
  el.addEventListener('close', () => { el.remove(); finish(value); });
  document.body.append(el); el.showModal();
  return { el, close: result => { value = result; el.close(); }, done };
}
const field = (label, input) => h('label', { class: 'ssh-wide' }, label, input);
const row = (name, detail, ...actions) => h('div', { class: 'source-row' }, h('div', { class: 'min' }, h('span', { class: 'source-name' }, name), h('span', { class: 'source-path' }, detail)), h('span'), h('div', { class: 'source-actions' }, actions));
const button = (label, onclick, cls = 'pill small') => h('button', { type: 'button', class: cls, onclick }, label);
const section = (title, ...body) => h('section', { class: 'section' }, h('div', { class: 'section-heading' }, h('h3', {}, title)), ...body);

/** The server's folders, browsed from here; resolves true once one is added. */
export async function chooseServerFolder() {
  const body = h('div', {}); let box;
  async function open(path) {
    try {
      const d = await call('GET', `/api/admin/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      body.replaceChildren(h('p', { class: 'mono dim' }, d.path), h('div', { class: 'picker' }, d.parent ? h('button', { type: 'button', class: 'file-row', onclick: () => open(d.parent) }, '← ..') : null,
        d.dirs.map(n => h('button', { type: 'button', class: 'file-row', onclick: () => open(d.path.replace(/[\\/]$/, '') + (d.path.includes('\\') ? '\\' : '/') + n) }, h('span', { class: 'mono' }, n)))),
      h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'button', onclick: async () => { try { const r = await call('POST', '/api/admin/folders', { path: d.path }); if (!r.ok) throw new Error(r.error); say(`Added. Found ${r.items} video${r.items === 1 ? '' : 's'}.`); box.close(true); } catch (error) { fail(error); } } }, 'Add this folder')));
    } catch (error) { fail(error); }
  }
  box = dialog('Choose a folder on the server', body); open('');
  return box.done;
}

export async function openAccount({ username, role, signOut, local }) {
  const admin = role === 'admin';
  const saved = h('div', { class: 'sources' }), added = h('div', { class: 'sources' }), people = h('div', { class: 'sources' }), invites = h('div', { class: 'sources' }), space = h('p', { class: 'muted' });

  async function loadSaved() {
    const { saved: list, partial, bytes } = await api.offline.list();
    space.textContent = list.length ? `${list.length} title${list.length === 1 ? '' : 's'} on this PC · ${size(bytes)} used.` : 'Nothing is saved on this PC. Use Save offline on a title to watch it without a connection.';
    saved.replaceChildren(...list.map(r => row(r.title || r.id, size(r.size), button('Remove', async () => { await api.offline.remove(r.id); loadSaved().catch(fail); }))),
      ...partial.map(r => row(r.id, `Partly saved · ${size(r.size)}`, button('Discard', async () => { await api.offline.remove(r.id); loadSaved().catch(fail); }))));
  }
  async function loadAdded() {
    const { subtitles } = await call('GET', '/api/me/subtitles');
    added.replaceChildren(...(subtitles.length ? subtitles.map(s => row(s.name, `${languageName(s.language)} · ${KIND[s.kind]} · ${s.groupTitle}${s.itemKind === 'show' ? ` S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}` : ''}`,
      button('Edit', () => relabel(s)), button('Delete', async () => { if (confirm(`Delete the subtitles "${s.name}" for everyone?`)) { try { await call('DELETE', `/api/subtitles/${s.id}`); loadAdded(); } catch (e) { fail(e); } } })))
      : [h('p', { class: 'muted' }, 'Subtitles you add from the player show up here.')]));
  }
  function relabel(s) {
    const name = h('input', { value: s.name, maxLength: 60, required: true }), language = h('select', {}, LANGUAGES.map(c => h('option', { value: c, selected: c === s.language }, c === 'und' ? 'Unknown' : languageName(c))));
    const kind = h('select', {}, Object.entries(KIND).map(([v, l]) => h('option', { value: v, selected: v === s.kind }, l)));
    const box = dialog('Edit subtitle label', h('form', { onsubmit: async e => { e.preventDefault(); try { await call('PATCH', `/api/subtitles/${s.id}`, { name: name.value, language: language.value, kind: kind.value }); box.close(true); loadAdded(); } catch (err) { fail(err); } } },
      h('div', { class: 'ssh-fields' }, field('Name shown to everyone', name), h('label', {}, 'Language', language), h('label', {}, 'Type', kind)), h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Save'))));
  }
  async function loadPeople() {
    const { users } = await call('GET', '/api/admin/users');
    people.replaceChildren(...users.map(u => row(u.username, u.role === 'admin' ? 'Head account' : `Viewer${u.lastWatched ? ` · last watched ${new Date(u.lastWatched).toLocaleDateString()}` : ''}`,
      ...(u.role === 'admin' ? [] : [button('Reset password', () => reset(u)), button('Remove', async () => { if (confirm(`Remove ${u.username}? Their watch history and settings go too.`)) { try { await call('DELETE', `/api/admin/users/${u.id}`); loadPeople(); } catch (e) { fail(e); } } })]))));
  }
  function reset(u) {
    const input = h('input', { autocomplete: 'off', placeholder: 'New password (8 or more characters)', required: true });
    const box = dialog(`Reset password for ${u.username}`, h('form', { onsubmit: async e => { e.preventDefault(); try { await call('PATCH', `/api/admin/users/${u.id}`, { password: input.value }); box.close(true); say(`${u.username} was signed out everywhere. Give them the new password.`); } catch (err) { fail(err); } } },
      h('div', { class: 'ssh-fields' }, field('New password', input)), h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Set password'))));
  }
  const when = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  async function loadInvites() {
    const { invites: list } = await call('GET', '/api/admin/invites');
    invites.replaceChildren(...list.map(i => row(i.status === 'used' ? `Used by ${i.usedBy || 'a removed account'}` : i.status === 'expired' ? 'Expired' : 'Waiting to be used',
      i.status === 'used' ? `Joined ${when(i.usedAt)}` : `Created ${when(i.created)} · ${i.status === 'expired' ? 'ended' : 'valid until'} ${when(i.expires)}`,
      ...(i.status === 'waiting' ? [button('Revoke', async () => { try { await call('DELETE', `/api/admin/invites/${i.id}`); loadInvites(); } catch (e) { fail(e); } })] : []))));
  }
  async function invite() {
    let made; try { made = await call('POST', '/api/admin/invites', { days: 7 }); } catch (error) { fail(error); return; }
    loadInvites();
    dialog('Invite code', h('div', {}, h('p', { class: 'muted' }, `Send this to the person you are inviting. It works once and stops working on ${new Date(made.expires).toLocaleDateString()}. They enter it in Receiver mode (or on the server's web page) and pick their own username and password. This is the only time it is shown.`),
      h('p', { class: 'mono', style: 'user-select:all;font-size:1.4em' }, made.code), h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'button', onclick: e => { navigator.clipboard?.writeText(made.code).then(() => { e.currentTarget.textContent = 'Copied'; }, () => {}); } }, 'Copy code'))));
  }

  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true }), fresh = h('input', { type: 'password', autocomplete: 'new-password', required: true }), error = h('p', { role: 'alert' });
  const password = h('form', { onsubmit: async e => { e.preventDefault(); error.textContent = ''; try { await call('POST', '/api/me/password', { current: current.value, password: fresh.value }); current.value = fresh.value = ''; say('Password changed. Other devices were signed out.'); } catch (err) { error.textContent = err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); } } },
    h('div', { class: 'ssh-fields' }, field('Current password', current), field('New password (8 or more characters)', fresh)), error, h('div', { class: 'show-actions' }, h('button', { class: 'pill', type: 'submit' }, 'Change password')));

  const body = h('div', { class: 'receiver-account' },
    section('Saved for offline', space, saved), section('Subtitles you added', added), section('Password', password),
    admin ? section('People', people, h('div', { class: 'show-actions' }, button('Create invite code', invite, 'pill primary')), invites) : null,
    h('div', { class: 'show-actions' }, button('Switch to local mode', local, 'pill'), button('Disconnect and sign out', signOut, 'pill')));
  const box = dialog(`${username}${admin ? ' · head account' : ''}`, body);
  loadSaved().catch(fail); loadAdded().catch(fail); if (admin) { loadPeople().catch(fail); loadInvites().catch(fail); }
  return box.done;
}
