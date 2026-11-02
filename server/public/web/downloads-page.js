// The Downloads page: everything about titles saved on this device, live. Saves in flight (with speed and time left), ones that
// stopped on an error, half-finished ones that can resume, finished ones with their size, the space used, and subtitle files
// waiting to be sent to the server.
import * as offline from './offline.js';
import { h, say } from './dom.js';

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m-4.5-4.5 4.5 4.5 4.5-4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>';
const size = offline.sizeLabel;
const duration = seconds => seconds === null ? '' : seconds < 90 ? `${Math.max(1, Math.round(seconds))} s left` : seconds < 5400 ? `${Math.round(seconds / 60)} min left` : `${(seconds / 3600).toFixed(1)} h left`;
const when = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const section = (title, ...body) => h('section', { class: 'section' }, h('div', { class: 'section-heading' }, h('h2', {}, title)), ...body);
const row = (icon, name, meta, actions, extra) => h('div', { class: 'source-row web-row' }, h('span', { class: 'source-icon' }, h('span', { class: 'mono' }, icon)),
  h('div', { class: 'min' }, h('span', { class: 'source-name' }, name), h('span', { class: 'source-path' }, meta), extra || null), h('span'), h('div', { class: 'source-actions' }, actions));
const bar = percent => h('div', { class: 'dl-bar', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100', style: { '--p': String(percent) } }, h('i'));
const button = (label, onclick, aria) => h('button', { class: 'pill small', type: 'button', onclick, ...(aria ? { 'aria-label': aria } : {}) }, label);
const partBytes = r => Math.min(r.have * 8388608, r.size);

// The button beside the profile picture; the arrow bobs while something is being saved.
export function downloadsButton(open) {
  const button = h('button', { type: 'button', class: 'web-downloads', 'aria-label': 'Downloads', title: 'Downloads', onclick: open });
  button.innerHTML = ARROW;
  offline.onChange(() => button.classList.toggle('busy', offline.activeJobs().length > 0));
  document.querySelector('.window-zone').append(button);
  return button;
}

export function openDownloads({ retry }) {
  const layer = h('div', { class: 'web-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Downloads' });
  const body = h('main', { class: 'page web-page' });
  let stop = () => {};
  const close = () => { layer.remove(); stop(); document.removeEventListener('keydown', onKey, true); document.body.classList.remove('web-layer-open'); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  let painting = false, again = false;
  async function paint() {
    if (painting) { again = true; return; }
    painting = true;
    try {
      const [records, { bytes, quota, titles }, waiting] = await Promise.all([offline.store.list(), offline.usage(), offline.pendingSubtitles()]);
      const active = offline.activeJobs(), failed = offline.failedJobs(), activeIds = new Set(active.map(j => j.id));
      const partial = records.filter(r => !r.complete && !activeIds.has(r.id) && !failed.some(f => f.id === r.id)), done = records.filter(r => r.complete);
      const used = quota ? Math.min(100, Math.max(1, Math.round(bytes / quota * 100))) : 0;
      const nothing = !active.length && !failed.length && !partial.length && !done.length;
      const parts = [
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Downloads'), h('p', { class: 'page-sub' }, 'Titles saved on this device play without a connection.'))),
        section('Storage', h('div', { class: 'dl-storage' }, h('p', { class: 'muted' }, `${titles} saved title${titles === 1 ? '' : 's'} · ${size(bytes)} used${quota ? ` of ${size(quota)} the browser allows` : ''}`), quota ? bar(used) : null),
          waiting ? h('p', { class: 'dl-meta' }, `${waiting} subtitle file${waiting === 1 ? '' : 's'} added offline will be sent to the server when it is reachable.`) : null),
        active.length ? section('In progress', h('div', { class: 'sources' }, active.map(j => row(`${j.percent}%`, j.title || j.id,
          j.state === 'preparing' ? 'The server is getting the file ready…' : [`${size(j.done)} of ${size(j.size)}`, j.speed ? `${size(j.speed)}/s` : '', duration(j.left)].filter(Boolean).join(' · '),
          button('Stop', () => { offline.cancel(j.id); say('Download stopped. What was fetched is kept, so it can resume.'); }, `Stop saving ${j.title}`), bar(j.percent))))) : null,
        failed.length ? section('Needs attention', h('div', { class: 'sources' }, failed.map(f => row('!', f.title || f.id, h('span', { class: 'dl-fail' }, f.error),
          h('div', { class: 'show-actions' }, button('Try again', () => { offline.dismissFailure(f.id); retry(f.id); }, `Try saving ${f.title} again`), button('Dismiss', () => offline.dismissFailure(f.id))))))) : null,
        partial.length ? section('Paused', h('div', { class: 'sources' }, partial.map(r => row('…', r.title || r.id, `${size(partBytes(r))} of ${size(r.size)} saved`,
          h('div', { class: 'show-actions' }, button('Resume', () => retry(r.id), `Resume saving ${r.title}`), button('Remove', () => offline.remove(r.id), `Remove ${r.title}`)), bar(Math.floor(partBytes(r) / r.size * 100)))))) : null,
        section('Saved', done.length ? h('div', { class: 'sources' }, done.map(r => row('✓', r.title || r.id, `${size(r.size)} · saved ${when(r.savedAt)}${r.info?.subtitles?.length ? ` · ${r.info.subtitles.length} subtitle${r.info.subtitles.length === 1 ? '' : 's'}` : ''}`,
          button('Remove', async () => { if (confirm(`Remove "${r.title || r.id}" from this device?`)) { await offline.remove(r.id); say('Removed from this device.'); } }, `Remove ${r.title || r.id} from this device`)))) : h('p', { class: 'muted' }, nothing ? 'Nothing is saved yet. Use Save offline on a title or an episode and it will show up here.' : 'No finished downloads yet.'))];
      body.replaceChildren(...parts.filter(Boolean));
    } finally { painting = false; if (again) { again = false; paint(); } }
  }
  stop = offline.onChange(() => paint());
  layer.append(h('button', { class: 'web-back', type: 'button', 'aria-label': 'Close downloads', title: 'Back (Esc)', onclick: close }, '←'), body);
  document.body.append(layer); document.body.classList.add('web-layer-open');
  paint(); layer.querySelector('.web-back').focus();
  return close;
}
