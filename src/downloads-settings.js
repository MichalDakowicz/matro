// Download settings dialog: connection, folder layout and what happens after a download.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
const LAYOUTS = {
  movieFolders: [['title', 'Title', 'Example Movie'], ['title-year', 'Title (Year)', 'Example Movie (2020)'], ['flat', 'All in one folder', ''], ['original', 'Keep torrent folders', 'Example.Movie.2020.1080p.WEB.x264-GRP']],
  showFolders: [['season', 'Title / Season', 'Example Show/S01'], ['title', 'Title only', 'Example Show'], ['flat', 'All in one folder', ''], ['original', 'Keep torrent folders', 'Example.Show.S01.1080p.WEB.x264-GRP']]
};
const NAMES = { clean: { movie: 'Example Movie (2020) [1080p]', show: 'S01E01 Example Show (2020) [1080p]' }, original: { movie: 'Example.Movie.2020.1080p.WEB.x264-GRP', show: 'Example.Show.S01E01.1080p.WEB.x264-GRP' } };
const SEED = { ask: 'You are asked before the first download, and can remember the answer.', yes: 'Finished downloads keep seeding with no limit. qBittorrent enforces this even when Matro is closed.', no: 'Downloads stop when they finish and the files stay where they are. BitTorrent may still upload while downloading.' };
const folderFor = (kind, id) => LAYOUTS[kind].find(item => item[0] === id)?.[2] ?? '';
const rootName = path => path.split(/[\\/]/).filter(Boolean).pop() || 'Library';
const tree = (root, folders, file) => [rootName(root), ...folders.split('/').filter(Boolean), file].map((line, index) => index ? ' '.repeat((index - 1) * 3) + '└─ ' + line : line).join('\n');
const seedValue = value => value === true ? 'yes' : value === false ? 'no' : 'ask';

export function createSettingsDialog({ hostOnly = false, labels, defaults, getConfig, configure, announce, saved }) {
  if (hostOnly) return createHostSettingsDialog({ getConfig, configure, announce, saved });
  let drafts = {}, editing = 'local', seed = 'ask', tab = 'conn', saving = false;
  const dialog = document.createElement('dialog');
  dialog.id = 'download-settings'; dialog.className = 'settings-dialog'; dialog.setAttribute('aria-labelledby', 'download-settings-title');
  const $ = selector => dialog.querySelector(selector);
  const cardMarkup = (id, icon) => !labels[id] ? '' : `<button type="button" class="dest-card" role="radio" data-edit="${id}"><span class="dest-ico">${icon}</span><span><b>${labels[id]}</b><small><span class="status-dot"></span><span data-status></span></small><span class="url mono" data-url></span></span></button>`;
  dialog.innerHTML = `<form id="download-config" novalidate>
    <div class="section-heading"><h2 id="download-settings-title">Download settings</h2><button type="button" class="icon-button" data-close aria-label="Close download settings">×</button></div>
    <p class="lede">Connect qBittorrent, choose how finished files are laid out, and decide what happens after. Each destination keeps its own folders.</p>
    <div class="seg" data-seg="tab" role="tablist" aria-label="Settings sections"><i class="seg-thumb"></i><button type="button" role="tab" data-v="conn">Connection</button><button type="button" role="tab" data-v="files">Files</button><button type="button" role="tab" data-v="after">After download</button></div>
    <div class="st-panel" data-panel="conn">
      <div class="st-block"><h3>Destination</h3><p class="hint">Pick which qBittorrent you are setting up.</p><div class="dest-cards" role="radiogroup" aria-label="Destination">
        ${cardMarkup('local', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16.5V20"/></svg>')}
        ${cardMarkup('server', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/></svg>')}
      </div></div>
      <div class="st-block"><h3>qBittorrent Web UI</h3><p class="hint">Turn on the Web UI in qBittorrent first. For a server outside your trusted network, use HTTPS or an SSH tunnel. ${hostOnly ? 'The client must share the Matro host’s filesystem paths. Add destination folders under Folders first.' : 'Server destinations also need a matching SSH media folder under Folders so existing files can be protected.'}</p>
        <div class="fields">
          <label class="field wide" data-ssh-host>SSH server address (if different)<input name="sshHost" class="mono" autocomplete="off" placeholder="For example, 192.168.100.6"><small>Use the address saved under Folders → Connect SSH. Leave blank when it matches the Web UI hostname.</small></label>
          <label class="field wide">Web UI address<input name="url" class="mono" type="url" required autocomplete="off"></label>
          <label class="field">Username<input name="username" autocomplete="off"></label>
          <label class="field">Password<span class="with-ico pw"><input name="password" type="password" autocomplete="off"><button type="button" class="eye" data-eye aria-label="Show password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>
        </div></div>
    </div>
    <div class="st-panel" data-panel="files" hidden>
      <div class="st-block"><h3>Library folders</h3><p class="hint">Downloads use these folders, including while they are incomplete.</p><div class="fields">
        <label class="field wide">Movies folder<span class="with-ico">${folderIcon}<input name="movieRoot" class="mono" required autocomplete="off" placeholder="Absolute movie library folder"></span></label>
        <label class="field wide">Shows folder<span class="with-ico">${folderIcon}<input name="showRoot" class="mono" required autocomplete="off" placeholder="Absolute show library folder"></span></label></div></div>
      <div class="st-block"><h3>Movie layout</h3><p class="hint">How each movie is arranged inside the Movies folder.</p><div class="layout-cards" role="radiogroup" aria-label="Movie layout" data-layout="movieFolders"></div></div>
      <div class="st-block"><h3>Show layout</h3><p class="hint">How episodes are arranged inside the Shows folder.</p><div class="layout-cards" role="radiogroup" aria-label="Show layout" data-layout="showFolders"></div></div>
      <div class="st-block"><h3>Filenames</h3><div class="seg" data-seg="naming"><i class="seg-thumb"></i><button type="button" data-v="clean">Clean names</button><button type="button" data-v="original">Keep original names</button></div><p class="eg" data-eg></p></div>
      <div class="preview" aria-live="polite"><h3>Where a download lands</h3><p data-pv="movie"></p><p data-pv="show"></p><p data-pv="subs"></p></div>
    </div>
    <div class="st-panel" data-panel="after" hidden>
      <div class="st-block"><h3>Seed after downloading?</h3><p class="hint">Seeding shares the finished download with other people.</p>
        <div class="seg" data-seg="seed"><i class="seg-thumb"></i><button type="button" data-v="ask">Ask each time</button><button type="button" data-v="yes">Keep seeding</button><button type="button" data-v="no">Stop when done</button></div><p class="seed-note" data-seed-note></p></div>
      <div class="st-block"><h3>Subtitles</h3><button type="button" class="switch-row" role="switch" data-subs><span><b>Keep text subtitles</b><small>SRT, ASS, SSA and VTT files are kept beside the video. Samples, images and extras are always skipped.</small></span><span class="sw"></span></button></div>
    </div>
    <p class="settings-status" data-status-line role="status" aria-live="polite"></p>
    <div class="st-foot"><button class="pill primary" type="submit">Test and save</button><button class="pill" type="button" data-close>Close settings</button></div></form>`;

  function draft(id) {
    if (drafts[id]) return drafts[id];
    const value = getConfig()[id], storage = value?.storage || getConfig().defaults?.[id] || { movieRoot: '', showRoot: '', movieFolders: 'title', showFolders: 'season', naming: 'clean', subtitles: true };
    return drafts[id] = { url: value?.url || defaults[id], username: value?.username || '', sshHost: value?.sshHost || '', movieRoot: storage.movieRoot, showRoot: storage.showRoot, movieFolders: storage.movieFolders, showFolders: storage.showFolders, naming: storage.naming, subtitles: !!storage.subtitles };
  }
  const setSeg = (node, value) => {
    const buttons = [...node.querySelectorAll('button')], index = Math.max(0, buttons.findIndex(button => button.dataset.v === value));
    node.style.setProperty('--n', buttons.length); node.style.setProperty('--i', index);
    buttons.forEach((button, position) => button.setAttribute('aria-selected', String(position === index)));
  };
  function drawChoices() {
    const d = draft(editing);
    for (const [kind, root, sample] of [['movieFolders', 'movieRoot', 'movie'], ['showFolders', 'showRoot', 'show']]) {
      $(`[data-layout="${kind}"]`).innerHTML = LAYOUTS[kind].map(([id, label]) => `<button type="button" class="layout-card" role="radio" data-layout-choice="${kind}" data-v="${id}" aria-checked="${d[kind] === id}"><b>${label}</b><pre>${esc(tree(d[root], folderFor(kind, id), NAMES[d.naming][sample] + '.mkv'))}</pre><span class="tick">${check}</span></button>`).join('');
    }
    const sep = editing === 'server' ? '/' : '\\', join = (root, folders, file) => [root.replace(/[\\/]+$/, ''), ...folders.split('/').filter(Boolean), file].join(sep);
    const movie = join(d.movieRoot, folderFor('movieFolders', d.movieFolders), NAMES[d.naming].movie + '.mkv'), show = join(d.showRoot, folderFor('showFolders', d.showFolders), NAMES[d.naming].show + '.mkv');
    $('[data-pv="movie"]').innerHTML = `Movie  <em>${esc(movie)}</em>`; $('[data-pv="show"]').innerHTML = `Show   <em>${esc(show)}</em>`;
    $('[data-pv="subs"]').innerHTML = d.subtitles ? `Subs   <em>${esc(movie.replace(/\.mkv$/, '.en.srt'))}</em>` : 'Subs   skipped (video only)';
    $('[data-eg]').innerHTML = `Example: <span class="mono">${esc(NAMES[d.naming].movie)}.mkv</span>`;
    $('[data-subs]').setAttribute('aria-checked', String(d.subtitles));
  }
  function drawChrome() {
    dialog.querySelectorAll('[data-edit]').forEach(card => {
      const id = card.dataset.edit, configured = !!getConfig()[id];
      card.setAttribute('aria-checked', String(id === editing));
      card.querySelector('.status-dot').className = 'status-dot' + (configured ? '' : ' off');
      card.querySelector('[data-status]').textContent = configured ? 'Connected' : 'Not configured';
      card.querySelector('[data-url]').textContent = draft(id).url || 'No address yet';
    });
    setSeg($('[data-seg="tab"]'), tab); setSeg($('[data-seg="naming"]'), draft(editing).naming); setSeg($('[data-seg="seed"]'), seed);
    dialog.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
    $('[data-seed-note]').textContent = SEED[seed];
  }
  function fill() {
    const d = draft(editing), password = $('[name="password"]');
    $('[name="url"]').value = d.url; $('[name="username"]').value = d.username; $('[name="movieRoot"]').value = d.movieRoot; $('[name="showRoot"]').value = d.showRoot;
    $('[name="sshHost"]').value = d.sshHost; $('[data-ssh-host]').hidden = hostOnly || editing !== 'server';
    $('[name="url"]').placeholder = editing === 'local' ? 'http://127.0.0.1:8080' : 'http://192.168.1.10:8080';
    password.value = ''; password.type = 'password'; password.placeholder = getConfig()[editing]?.passwordSaved ? 'Saved. Leave blank to keep' : 'Web UI password';
    drawChoices(); drawChrome();
  }
  function status(text, bad = false) { const node = $('[data-status-line]'); node.textContent = text; node.classList.toggle('bad', bad); }
  const lock = busy => dialog.querySelectorAll('input,button').forEach(node => { node.disabled = busy; });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close]')) { dialog.close(); return; }
    const segment = event.target.closest('[data-seg] button');
    if (segment) {
      const group = segment.closest('[data-seg]').dataset.seg, value = segment.dataset.v;
      if (group === 'tab') tab = value; if (group === 'seed') seed = value; if (group === 'naming') draft(editing).naming = value;
      drawChrome(); if (group === 'naming') drawChoices(); return;
    }
    const card = event.target.closest('[data-edit]'); if (card) { editing = card.dataset.edit; status(''); fill(); return; }
    const choice = event.target.closest('[data-layout-choice]'); if (choice) { draft(editing)[choice.dataset.layoutChoice] = choice.dataset.v; drawChoices(); return; }
    if (event.target.closest('[data-subs]')) { const d = draft(editing); d.subtitles = !d.subtitles; drawChoices(); return; }
    if (event.target.closest('[data-eye]')) { const field = $('[name="password"]'), show = field.type === 'password'; field.type = show ? 'text' : 'password'; event.target.closest('[data-eye]').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }
  });
  dialog.addEventListener('input', event => {
    const name = event.target.name, d = draft(editing);
    if (name === 'url') { d.url = event.target.value; drawChrome(); }
    else if (name === 'sshHost') d.sshHost = event.target.value;
    else if (name === 'username') d.username = event.target.value;
    else if (name === 'movieRoot' || name === 'showRoot') { d[name] = event.target.value; drawChoices(); }
  });
  dialog.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const d = draft(editing), target = editing, form = event.target, password = form.elements.password;
    const values = { target, url: d.url, username: d.username, sshHost: d.sshHost, password: password.value, movieRoot: d.movieRoot, showRoot: d.showRoot, seeding: seed, storage: { movieRoot: d.movieRoot, showRoot: d.showRoot, movieFolders: d.movieFolders, showFolders: d.showFolders, naming: d.naming, subtitles: d.subtitles } };
    // Clear the plaintext immediately; it is never kept in renderer state.
    password.value = ''; saving = true; lock(true); status('Testing the qBittorrent connection…'); announce('Testing the qBittorrent connection…');
    try {
      const next = await configure(values); values.password = '';
      saved(next, target); status(''); announce(`Connected to ${labels[target]}. Settings saved.`); dialog.close();
    } catch (error) { status(error.message, true); announce(error.message); }
    finally { values.password = ''; saving = false; lock(false); }
  });
  document.body.append(dialog);
  return {
    open(target) { drafts = {}; editing = target; tab = 'conn'; seed = seedValue(getConfig().seeding); status(''); fill(); if (!dialog.open) dialog.showModal(); },
    close() { if (dialog.open) dialog.close(); },
    destroy() { dialog.remove(); }
  };
}

// The web server owns its connection address and destinations; browsers only supply credentials.
function createHostSettingsDialog({ getConfig, configure, announce, saved }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'download-settings'; dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'download-settings-title');
  dialog.innerHTML = `<form><div class="section-heading"><h2 id="download-settings-title">Download settings</h2><button type="button" class="icon-button" data-close aria-label="Close download settings">×</button></div>
    <p class="lede">Downloads go straight to this server’s movie and series library. Sign in to qBittorrent to connect.</p>
    <div class="fields"><label class="field">Username<input name="username" autocomplete="username" required></label>
    <label class="field">Password<input name="password" type="password" autocomplete="current-password"></label></div>
    <p class="settings-status" role="status" aria-live="polite"></p>
    <div class="st-foot"><button class="pill primary" type="submit">Connect</button><button class="pill" type="button" data-close>Close settings</button></div></form>`;
  const form = dialog.querySelector('form'), status = dialog.querySelector('[role="status"]');
  let saving = false;
  dialog.addEventListener('click', event => { if (!saving && (event.target === dialog || event.target.closest('[data-close]'))) dialog.close(); });
  dialog.addEventListener('close', () => { form.elements.password.value = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const values = { username: form.elements.username.value, password: form.elements.password.value };
    form.elements.password.value = ''; saving = true;
    form.querySelectorAll('input,button').forEach(node => { node.disabled = true; });
    status.classList.remove('bad'); status.textContent = 'Connecting to qBittorrent…';
    try {
      const next = await configure(values);
      saved(next, 'server'); announce('Connected to qBittorrent. Downloads use this server.'); dialog.close();
    } catch (error) { status.textContent = error.message; status.classList.add('bad'); }
    finally { values.password = ''; saving = false; form.querySelectorAll('input,button').forEach(node => { node.disabled = false; }); }
  });
  document.body.append(dialog);
  return {
    open() {
      form.elements.username.value = getConfig().server?.username || '';
      form.elements.password.value = ''; form.elements.password.placeholder = getConfig().server?.passwordSaved ? 'Saved. Leave blank to keep' : 'qBittorrent password';
      status.textContent = ''; status.classList.remove('bad');
      if (!dialog.open) dialog.showModal();
    },
    close() { if (dialog.open) dialog.close(); },
    destroy() { dialog.remove(); }
  };
}
