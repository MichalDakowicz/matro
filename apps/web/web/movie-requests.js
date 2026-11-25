import { del, get, patch, post } from './http.js';
import { dialog, h } from './dom.js';

export function mountMovieRequests(root, { admin, search }) {
  const endpoint = admin ? '/api/admin/movie-requests' : '/api/movie-requests';
  let data, busy = false;
  const status = h('p', { class: 'web-status', role: 'status' });
  const error = h('p', { class: 'web-error', role: 'alert' });
  const results = h('div', { class: 'movie-request-results' });
  const refresh = h('button', { class: 'pill', type: 'button', onclick: () => void run(load) }, 'Refresh requests');
  const heading = h('h1', { class: 'page-title', tabIndex: -1 }, admin ? 'Movie requests' : 'Request a movie');
  const focus = target => { if (target.isConnected) target.focus(); };
  const title = h('input', { name: 'title', required: true, maxLength: 200, autocomplete: 'off' });
  const year = h('input', { name: 'year', inputMode: 'numeric', pattern: '[1-9][0-9]{3}', maxLength: 4 });
  const season = h('input', { name: 'season', type: 'number', min: 1, max: 99, inputMode: 'numeric' });
  const seasonField = h('label', { hidden: true }, 'Season number', season);
  const titleLabel = h('label', {}, 'Movie title', title);
  const submit = h('button', { class: 'pill primary', type: 'submit' }, 'Send request');
  const picks = h('ul', { class: 'movie-request-picks', 'aria-label': 'Matches from TMDB' });
  let kind = 'movie', chosen = null, lookup = 0, timer;
  const kinds = [['movie', 'Movie'], ['series', 'Series'], ['season', 'Season']];
  const kindButtons = kinds.map(([id, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(id === kind), onclick: () => setKind(id) }, label));
  function setKind(next) {
    kind = next; chosen = null; picks.replaceChildren();
    kinds.forEach(([id], i) => kindButtons[i].setAttribute('aria-pressed', id === kind));
    titleLabel.firstChild.textContent = kind === 'movie' ? 'Movie title' : 'Series title';
    seasonField.hidden = kind !== 'season'; season.required = kind === 'season';
    suggest();
  }
  // With TMDB on the server, typing offers exact matches. Typing without picking one still sends the text as written.
  function suggest() {
    clearTimeout(timer);
    const query = title.value.trim(), run = ++lookup;
    if (!data?.tmdb || query.length < 2 || chosen) return void picks.replaceChildren();
    timer = setTimeout(async () => {
      let found = [];
      try { found = (await get(`/api/movie-requests/search?kind=${kind === 'movie' ? 'movie' : 'show'}&query=${encodeURIComponent(query)}`)).results; } catch { /* free text still works */ }
      if (run !== lookup || !picks.isConnected) return;
      picks.replaceChildren(...found.map(match => h('li', {}, h('button', { class: 'movie-request-pick', type: 'button', onclick: () => {
        chosen = match.id; title.value = match.title; year.value = kind === 'season' ? '' : match.year || '';
        picks.replaceChildren(); focus(title);
      } }, match.thumb ? h('img', { src: `/api/${match.thumb}`, alt: '', width: 36, height: 54 }) : h('span', { class: 'movie-request-nothumb' }),
        h('span', { class: 'min' }, h('strong', {}, match.year ? `${match.title} (${match.year})` : match.title), h('span', { class: 'muted' }, match.overview))))));
    }, 350);
  }
  title.addEventListener('input', () => { chosen = null; suggest(); });
  const form = h('form', { class: 'movie-request-form', onsubmit: event => {
    event.preventDefault();
    void run(async () => {
      const result = await post(endpoint, { title: title.value, year: year.value, kind, season: kind === 'season' ? Number(season.value) : undefined, tmdbId: chosen || undefined });
      if (data && !data.pending.some(row => row.id === result.request.id)) data.pending.unshift(result.request);
      title.value = year.value = season.value = ''; chosen = null; picks.replaceChildren();
      status.textContent = result.duplicate ? 'You already requested this.' : 'Request sent.';
      if (!data) await load();
      draw();
      focus(title);
    });
  } }, h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Request type' }, kindButtons),
    h('div', { class: 'download-fields' }, titleLabel, h('label', {}, 'Release year (optional)', year), seasonField), picks, submit);

  function draw() {
    if (!data) return;
    results.replaceChildren(...[
      admin && !data.alertsConfigured ? h('p', { class: 'muted' }, 'Phone alerts aren’t configured on this server.') : null,
      list('Pending', data.pending, 'No pending movie requests.'),
      list('Recently handled', data.handled, 'No handled movie requests yet.'),
    ].filter(Boolean));
  }

  async function removeRequest(row, name) {
    const box = dialog('Remove movie request?', h('div', {},
      h('p', { class: 'muted' }, name),
      h('div', { class: 'show-actions' },
        h('button', { class: 'pill', type: 'button', autofocus: true, onclick: () => box.close(false) }, 'Cancel'),
        h('button', { class: 'pill primary', type: 'button', onclick: () => box.close(true) }, 'Remove request'))));
    if (!await box.done || !root.isConnected) return;
    await run(async () => {
      await del(`/api/movie-requests/${row.id}`);
      data.pending = data.pending.filter(item => item.id !== row.id);
      data.handled = data.handled.filter(item => item.id !== row.id);
      status.textContent = 'Request removed.';
      draw();
    });
    if (document.activeElement === document.body) focus(refresh);
  }

  function list(heading, entries, empty) {
    return h('section', { class: 'section' }, h('div', { class: 'section-heading' }, h('h2', {}, heading)),
      entries.length ? h('ul', { class: 'movie-request-list' }, entries.map(row => {
        const name = row.year ? `${row.title} (${row.year})` : row.title;
        const date = new Date(row.created).toLocaleDateString();
        const what = row.kind === 'series' ? 'Series' : row.kind === 'season' ? `Season ${row.season}` : '';
        const outcome = { pending: 'Waiting', ready: 'Ready to watch', declined: 'Declined' }[row.outcome];
        const pendingForOwner = admin && row.status === 'pending';
        return h('li', { class: 'movie-request-row' },
          h('div', { class: 'min' }, h('h3', {}, name),
            h('p', { class: 'muted' }, [admin ? `${row.requester || 'Removed account'} · ${date}` : date, what].filter(Boolean).join(' · ')),
            !admin && h('p', {}, h('span', { class: `request-status ${row.outcome}` }, outcome), row.isNew && h('span', { class: 'request-new' }, ' New'))),
          (pendingForOwner || data.canRemove) && h('div', { class: 'movie-request-actions' },
            pendingForOwner && h('button', { class: 'pill small primary', type: 'button', 'aria-label': `Search releases for ${name}`,
              onclick: () => search(row) }, 'Search releases'),
            pendingForOwner && h('button', { class: 'pill small', type: 'button', 'aria-label': `Mark ${name} handled`, onclick: () => {
              void run(async () => {
                const { request } = await patch(`${endpoint}/${row.id}`);
                data.pending = data.pending.filter(item => item.id !== row.id);
                data.handled = [request, ...data.handled.filter(item => item.id !== row.id)].sort((a, b) => b.id - a.id).slice(0, 30);
                status.textContent = `${name} marked handled.`;
                draw();
              }).then(() => { if (document.activeElement === document.body) focus(refresh); });
            } }, 'Mark handled'),
            pendingForOwner && h('button', { class: 'pill small', type: 'button', 'aria-label': `Decline ${name}`, onclick: () => {
              void run(async () => {
                const { request } = await patch(`${endpoint}/${row.id}`, { declined: true });
                data.pending = data.pending.filter(item => item.id !== row.id);
                data.handled = [request, ...data.handled.filter(item => item.id !== row.id)].sort((a, b) => b.id - a.id).slice(0, 30);
                status.textContent = `${name} declined.`;
                draw();
              }).then(() => { if (document.activeElement === document.body) focus(refresh); });
            } }, 'Decline'),
            data.canRemove && h('button', { class: 'pill small', type: 'button', 'aria-label': `Remove request for ${name}`,
              onclick: () => void removeRequest(row, name) }, 'Remove')));
      })) : h('p', { class: 'muted' }, empty));
  }

  async function load() {
    data = await get(endpoint);
    draw();
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    error.textContent = status.textContent = '';
    const controls = [submit, refresh, ...results.querySelectorAll('button')];
    for (const button of controls) button.disabled = true;
    results.setAttribute('aria-busy', 'true');
    try { await action(); }
    catch (failure) { error.textContent = failure.message; }
    finally {
      for (const button of controls) button.disabled = false;
      results.setAttribute('aria-busy', 'false');
      busy = false;
    }
  }

  root.append(h('div', { class: 'page-head' }, h('div', {},
    heading,
    h('p', { class: 'page-sub' }, admin ? 'Review requests and search for releases to add to your library.' : 'Send a title to the person who manages your library.')),
  refresh), admin ? error : form, status);
  if (!admin) root.append(error);
  root.append(results);
  focus(heading);
  void run(load);
}
