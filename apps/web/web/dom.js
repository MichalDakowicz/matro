// Tiny DOM helper. Text always goes in as text nodes, never HTML, so names typed by other viewers cannot inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return el;
}
export const say = message => {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.hidden = false; clearTimeout(say.timer);
  say.timer = setTimeout(() => { toast.hidden = true; }, 5000);
};
// A dialog in the desktop's own dialog style. Resolves when closed; `close(value)` picks the result.
export function dialog(title, body, { wide = false } = {}) {
  let finish; const done = new Promise(resolve => { finish = resolve; });
  const el = h('dialog', { class: `web-dialog${wide ? ' wide' : ''}`, 'aria-label': title },
    h('div', { class: 'section-heading' }, h('h2', {}, title), h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => close(null) }, '×')), body);
  let value = null;
  const close = result => { value = result; el.close(); };
  el.addEventListener('close', () => { el.remove(); finish(value); });
  document.body.append(el); el.showModal();
  return { el, close, done };
}
export const languageNames = new Intl.DisplayNames(navigator.languages, { type: 'language' });
export const LANGUAGES = 'en ja pl de fr es it pt ru uk cs sk hu ro nl sv no da fi el tr he ar zh ko hi th vi id bg hr sr sl lt lv et ca fa'.split(' ');
export function languageName(code) { try { return languageNames.of(code) || code; } catch { return code; } }
export function languageSelect(value) {
  const sorted = [...LANGUAGES].sort((a, b) => languageName(a).localeCompare(languageName(b)));
  return h('select', { name: 'language' }, sorted.map(code => h('option', { value: code, selected: code === value }, languageName(code))), h('option', { value: 'und', selected: value === 'und' }, 'Unknown'));
}
// Copy text to the clipboard. The async Clipboard API only exists on HTTPS and localhost, so on a plain-HTTP address (the
// LAN) fall back to a hidden textarea inside `within` (a modal dialog only lets its own contents take focus).
export async function copyText(text, within = document.body) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  const area = h('textarea', { value: text, readOnly: true, 'aria-hidden': 'true', style: { position: 'fixed', top: '0', left: '0', opacity: '0' } });
  within.append(area); area.focus(); area.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
  area.remove();
  return ok;
}
export function selectText(el) { const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
