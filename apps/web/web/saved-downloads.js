import { h, dialog, say } from './dom.js';
import { CHUNK, resumable } from './offline-store.js';

const size = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const button = (text, onclick, disabled = false) => h('button', { class: 'pill small', type: 'button', onclick, disabled }, text);
export function savedDownloads({ offline, matro, onOpenTitle }) {
  const body = h('div', { class: 'saved-downloads' });
  const box = dialog('Saved for offline', body, { wide: true });
  let run = 0;
  const act = operation => () => { void Promise.resolve().then(operation).catch(error => say(error.message)); };
  async function draw() {
    const current = ++run;
    const [records, usage, uploads] = await Promise.all([offline.store.list(), offline.store.usage(), offline.subtitleUploads()]);
    if (current !== run || !box.el.open) return;
    const jobs = [...offline.jobs.values()];
    const busy = new Set(jobs.map(job => job.item.id));
    const rows = jobs.map(job => {
      const speed = (job.have - job.initial) / Math.max(1, (Date.now() - job.started) / 1000);
      const elapsed = speed > 0 ? ` · ${size(speed)}/s · ${Math.ceil((job.size - job.have) / speed)} s left` : '';
      return h('section', { class: 'saved-download-row' }, h('strong', {}, job.item.title),
        h('p', { class: 'dim' }, job.size ? `${size(job.have)} of ${size(job.size)}${elapsed}`
          : !job.active ? 'Queued' : job.prepared === null ? 'Preparing on the server…' : `Preparing on the server · ${Math.round(job.prepared * 100)}%`),
        job.size ? h('progress', { value: job.have, max: job.size, 'aria-label': `Saving ${job.item.title}` })
          : job.prepared === null ? null : h('progress', { value: job.prepared, max: 1, 'aria-label': `Preparing ${job.item.title}` }),
        button('Pause', act(() => offline.cancel(job.item.id))));
    });
    for (const record of records.filter(record => !busy.has(record.id))) {
      rows.push(h('section', { class: 'saved-download-row' }, h('strong', {}, record.title),
        h('p', { class: 'dim' }, record.complete ? size(record.size) : record.error
          || (resumable(record) ? 'Waiting to resume' : record.size ? `${size(Math.min(record.have * CHUNK, record.size))} of ${size(record.size)} · Paused` : 'Paused')),
        h('div', { class: 'show-actions' },
          record.complete ? button('Open title', () => { box.close(); onOpenTitle(record.id); })
            : button('Resume', act(() => matro.offlineSave(record.id)), !matro.offlineSave),
          button('Remove', act(() => offline.remove(record.id))))));
    }
    const queued = uploads.filter(upload => !upload.error).length;
    const failed = uploads.filter(upload => upload.error);
    body.replaceChildren(
      h('p', { class: 'dim' }, `${usage.titles} saved · ${size(usage.bytes)} on this device`),
      ...(queued ? [h('p', { role: 'status' }, `${queued} subtitle ${queued === 1 ? 'upload' : 'uploads'} waiting for a connection`)] : []),
      ...(rows.length ? rows : [h('p', { class: 'muted' }, 'Choose Save offline on a movie or episode to watch it here without a connection.')]),
      ...failed.map(({ body: file, query, error, key }) => h('section', { class: 'saved-download-row' },
        h('strong', {}, new URLSearchParams(query).get('filename') || file.name || 'Subtitle upload'),
        h('p', { class: 'dim' }, error),
        h('div', { class: 'show-actions' },
          button('Retry upload', act(() => offline.retrySubtitle(key)), !matro.offlineSave),
          button('Discard upload', act(() => offline.discardSubtitle(key)))))));
  }
  const refresh = act(draw), unsubscribe = offline.onChange(refresh);
  void box.done.then(unsubscribe);
  refresh();
}
