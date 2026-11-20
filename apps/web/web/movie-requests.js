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
  const submit = h('button', { class: 'pill primary', type: 'submit' }, 'Send request');
  const form = h('form', { class: 'movie-request-form', onsubmit: event => {
    event.preventDefault();
    void run(async () => {
      const result = await post(endpoint, { title: title.value, year: year.value });
      if (data && !data.pending.some(row => row.id === result.request.id)) data.pending.unshift(result.request);
      title.value = year.value = '';
      status.textContent = result.duplicate ? 'You already requested this movie.' : 'Request sent.';
      if (!data) await load();
      draw();
      focus(title);
    });
  } }, h('div', { class: 'download-fields' },
    h('label', {}, 'Movie title', title), h('label', {}, 'Release year (optional)', year)), submit);

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
        const pendingForOwner = admin && row.status === 'pending';
        return h('li', { class: 'movie-request-row' },
          h('div', { class: 'min' }, h('h3', {}, name),
            h('p', { class: 'muted' }, admin ? `${row.requester || 'Removed account'} · ${date}` : date)),
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
