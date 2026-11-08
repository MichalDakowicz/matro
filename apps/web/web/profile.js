// The one page the desktop app does not have: who you are, what you have added, your password, and for the head account the people.
import { get, post, patch, del } from './http.js';
import { h, say, dialog, languageSelect, languageName, copyText, selectText } from './dom.js';

const hue = name => { let n = 2166136261; for (const c of name) n = Math.imul(n ^ c.codePointAt(0), 16777619); return (n >>> 0) % 360; };
const avatar = (name, big) => h('span', { class: `web-avatar${big ? ' big' : ''}`, style: { '--h': String(hue(name)) }, 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase());
const KIND = { full: 'Full', forced: 'Forced only', sdh: 'SDH / captions' };
const fail = error => say(error.message);
const section = (title, aside, ...body) => h('section', { class: 'section' }, h('div', { class: 'section-heading' }, h('h2', {}, title), aside || null), ...body);

export function profileButton(session, open) {
  const button = h('button', { type: 'button', class: 'web-profile', 'aria-label': `Profile: ${session.user.username}`, title: session.user.username, onclick: open }, avatar(session.user.username));
  document.querySelector('.window-zone').append(button);
  return button;
}

export function openProfile({ session, getState, save, signOut }) {
  const layer = h('div', { class: 'web-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Profile' });
  const close = () => { layer.remove(); document.removeEventListener('keydown', onKey, true); document.body.classList.remove('web-layer-open'); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  const user = session.user, admin = user.role === 'admin', state = getState();
  const done = Object.values(state?.progress || {}).filter(p => p.completed).length;
  const going = Object.values(state?.progress || {}).filter(p => !p.completed && p.position > 10 && !p.hidden).length;
  const remembered = Object.keys(state?.preferences?.tracks || {}).length;

  const stats = h('div', { class: 'web-stats' }, [[done, 'Watched'], [going, 'In progress'], [state?.items.length ?? 0, 'In the library'], [remembered, 'Remembered dub / subtitle choices']].map(([n, l]) => h('div', {}, h('strong', {}, String(n)), h('span', {}, l))));
  const forget = h('button', { class: 'pill small', type: 'button', disabled: !remembered, onclick: async () => {
    if (!confirm('Forget the dub and subtitle choices Matro remembered for each show and film?')) return;
    delete state.preferences.tracks; await save(); forget.disabled = true; say('Forgot remembered tracks. They will be picked up again as you watch.');
  } }, 'Forget them');

  const added = h('div', { class: 'sources' });
  async function loadAdded() {
    const { subtitles } = await get('/api/me/subtitles');
    added.replaceChildren(...(subtitles.length ? subtitles.map(s => h('div', { class: 'source-row web-row' }, h('span', { class: 'source-icon' }, h('span', { class: 'mono' }, s.language.toUpperCase())),
      h('div', { class: 'min' }, h('span', { class: 'source-name' }, s.name), h('span', { class: 'source-path' }, `${languageName(s.language)} · ${KIND[s.kind]} · ${s.groupTitle}${s.itemKind === 'show' ? ` S${String(s.season).padStart(2, '0')}E${String(s.episode).padStart(2, '0')}` : ''}${admin && s.addedBy ? ` · by ${s.addedBy}` : ''}`)),
      h('span'), h('div', { class: 'source-actions' }, h('button', { class: 'pill small', type: 'button', onclick: () => relabel(s) }, 'Edit'),
        h('button', { class: 'pill small', type: 'button', 'aria-label': `Delete ${s.name}`, onclick: async () => { if (confirm(`Delete the subtitles "${s.name}" for everyone?`)) { try { await del(`/api/subtitles/${s.id}`); loadAdded(); } catch (e) { fail(e); } } } }, 'Delete'))))
      : [h('p', { class: 'muted' }, 'Subtitles you add from the player show up here, where you can rename or remove them.')]));
  }
  function relabel(s) {
    const name = h('input', { name: 'name', value: s.name, maxLength: 60, required: true }), language = languageSelect(s.language);
    const kind = h('select', { name: 'kind' }, Object.entries(KIND).map(([v, l]) => h('option', { value: v, selected: v === s.kind }, l)));
    const box = dialog('Edit subtitle label', h('form', { onsubmit: async e => { e.preventDefault(); try { await patch(`/api/subtitles/${s.id}`, { name: name.value, language: language.value, kind: kind.value }); box.close(true); loadAdded(); } catch (err) { fail(err); } } },
      h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'Name shown to everyone', name), h('label', {}, 'Language', language), h('label', {}, 'Type', kind)), h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Save'))));
  }

  const current = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password', required: true });
  const fresh = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (8 or more characters)', required: true });
  const error = h('p', { class: 'web-error', role: 'alert' });
  const password = h('form', { class: 'web-form', onsubmit: async e => {
    e.preventDefault(); error.textContent = '';
    try { await post('/api/me/password', { current: current.value, password: fresh.value }); current.value = fresh.value = ''; say('Password changed. Other devices were signed out.'); } catch (err) { error.textContent = err.message; }
  } }, h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'Current password', current), h('label', { class: 'ssh-wide' }, 'New password', fresh)), error, h('div', { class: 'show-actions' }, h('button', { class: 'pill', type: 'submit' }, 'Change password')));

  const people = h('div', { class: 'sources' });
  async function loadPeople() {
    const { users } = await get('/api/admin/users');
    people.replaceChildren(...users.map(u => h('div', { class: 'source-row web-row' }, avatar(u.username), h('div', { class: 'min' }, h('span', { class: 'source-name' }, u.username),
      h('span', { class: 'source-path' }, u.role === 'admin' ? 'Head account' : `Viewer${u.lastWatched ? ` · last watched ${new Date(u.lastWatched).toLocaleDateString()}` : ''} · ${u.subtitles} subtitle file${u.subtitles === 1 ? '' : 's'} added`)), h('span'),
      u.role === 'admin' ? h('span') : h('div', { class: 'source-actions' }, h('button', { class: 'pill small', type: 'button', onclick: () => reset(u) }, 'Reset password'),
        h('button', { class: 'pill small', type: 'button', onclick: async () => { if (confirm(`Remove ${u.username}? Their watch history and settings go too. Subtitles they added stay.`)) { try { await del(`/api/admin/users/${u.id}`); loadPeople(); } catch (e) { fail(e); } } } }, 'Remove')))));
  }
  function reset(u) {
    const input = h('input', { type: 'text', autocomplete: 'off', placeholder: 'New password (8 or more characters)', required: true });
    const box = dialog(`Reset password for ${u.username}`, h('form', { onsubmit: async e => { e.preventDefault(); try { await patch(`/api/admin/users/${u.id}`, { password: input.value }); box.close(true); say(`${u.username} was signed out everywhere. Give them the new password.`); } catch (err) { fail(err); } } },
      h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'New password', input)), h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Set password'))));
  }
  // New accounts are made by the person joining, with a one-time code that only works once.
  const invites = h('div', { class: 'sources' });
  const when = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  async function loadInvites() {
    const { invites: list } = await get('/api/admin/invites');
    invites.replaceChildren(...list.map(i => h('div', { class: 'source-row web-row' }, h('span', { class: 'source-icon' }, h('span', { class: 'mono' }, i.status === 'used' ? '✓' : i.status === 'expired' ? '–' : '●')),
      h('div', { class: 'min' }, h('span', { class: 'source-name' }, i.status === 'used' ? `Used by ${i.usedBy || 'a removed account'}` : i.status === 'expired' ? 'Expired' : 'Waiting to be used'),
        h('span', { class: 'source-path' }, i.status === 'used' ? `Joined ${when(i.usedAt)}` : `Created ${when(i.created)} · ${i.status === 'expired' ? 'ended' : 'valid until'} ${when(i.expires)}`)), h('span'),
      i.status === 'waiting' ? h('div', { class: 'source-actions' }, h('button', { class: 'pill small', type: 'button', onclick: async () => { try { await del(`/api/admin/invites/${i.id}`); loadInvites(); } catch (e) { fail(e); } } }, 'Revoke')) : h('span'))));
  }
  async function invite() {
    let made; try { made = await post('/api/admin/invites', { days: 7 }); } catch (err) { fail(err); return; }
    loadInvites();
    const link = `${location.origin}/#/join/${made.code}`;
    const copyCode = h('button', { class: 'pill', type: 'button' }, 'Copy code'), copyLink = h('button', { class: 'pill primary', type: 'button' }, 'Copy invite link');
    const codeText = h('p', { class: 'web-code mono', title: 'Click to select', onclick: e => selectText(e.currentTarget) }, made.code), linkText = h('p', { class: 'dim wrap small web-link', title: 'Click to select', onclick: e => selectText(e.currentTarget) }, link);
    const feedback = h('p', { class: 'web-status', role: 'status' });
    // If the browser refuses to copy, the text is selected instead so Ctrl+C finishes the job.
    const copy = (text, button, label, shown) => async () => { const ok = await copyText(text, box.el); if (ok) { feedback.textContent = `${label} copied.`; button.textContent = 'Copied'; setTimeout(() => { button.textContent = button === copyCode ? 'Copy code' : 'Copy invite link'; }, 2000); } else { selectText(shown); feedback.textContent = 'Copying was blocked here. It is selected: press Ctrl+C (⌘C on a Mac).'; } };
    copyCode.onclick = copy(made.code, copyCode, 'Code', codeText); copyLink.onclick = copy(link, copyLink, 'Link', linkText);
    const box = dialog('Invite code', h('div', {}, h('p', { class: 'muted' }, `Send this to the person you are inviting. It works once and stops working on ${new Date(made.expires).toLocaleDateString()}. They choose their own username and password, so you never see their password. This is the only time the code is shown.`),
      codeText, linkText, h('div', { class: 'show-actions' }, copyLink, copyCode), feedback));
    copyLink.focus();
  }
  const addPerson = h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'button', onclick: invite }, 'Create invite code'));

  layer.append(h('button', { class: 'web-back', type: 'button', 'aria-label': 'Close profile', title: 'Back (Esc)', onclick: close }, '←'),
    h('main', { class: 'page web-page' },
      h('header', { class: 'page-head' }, h('div', { class: 'web-who' }, avatar(user.username, true), h('div', {}, h('h1', { class: 'page-title' }, user.username), h('p', { class: 'page-sub' }, admin ? 'Head account · looks after the library and everyone on it' : 'Viewer · watches and adds subtitles')))),
      section('Your watching', null, stats), section('Dub and subtitles', forget, h('p', { class: 'muted' }, 'The player remembers which audio and subtitle language you pick for each show or film, so a dub chosen in one episode carries through the series.')),
      section('Subtitles you added', null, added), section('Password', null, password),
      admin ? section('Downloads', null, h('p', { class: 'muted' }, 'Find films and series, add magnet links, and manage downloads on the Matro host.'), h('button', { class: 'pill primary', type: 'button', onclick: () => { close(); document.querySelector('.dock-item[data-tab="downloads"]')?.click(); } }, 'Open downloads')) : null,
      admin ? section('People', null, h('p', { class: 'page-sub', style: { margin: '-6px 0 16px' } }, 'Viewers keep their own progress and choices and can add subtitles. Only you can add or remove films and shows (Folders). To add someone, create a one-time invite code and send it to them: they sign up with it and pick their own password.'), people, h('h3', { class: 'web-sub' }, 'Invites'), invites, addPerson) : null,
      h('div', { class: 'show-actions' }, h('button', { class: 'pill', type: 'button', onclick: signOut }, 'Sign out'))));
  document.body.append(layer); document.body.classList.add('web-layer-open');
  loadAdded().catch(fail); if (admin) { loadPeople().catch(fail); loadInvites().catch(fail); }
  layer.querySelector('.web-back').focus();
  return close;
}
