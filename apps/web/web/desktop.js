// The receiver uses the same floating chrome as local Matro. Ordinary browsers
// have no host bridge and keep their normal browser window/fullscreen behavior.
export function installDesktopChrome() {
  const host = window.matroDesktop; if (!host) return;
  document.body.classList.add('desktop-receiver');
  const header = document.createElement('header'); header.className = 'titlebar'; document.body.prepend(header);
  const zone = document.querySelector('.window-zone'); if (!zone) return;
  const source = document.createElement('button'); source.className = 'pill desktop-source-button'; source.textContent = 'Server'; source.setAttribute('aria-label', 'Playback source');
  source.addEventListener('click', () => { void host.chooseSource(); }); zone.querySelector('.brand')?.before(source);
  const controls = document.createElement('div'); controls.className = 'window-actions';
  const group = document.createElement('div'); group.className = 'window-buttons'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Window');
  for (const [action, label, shape] of [['minimize', 'Minimize', '<path d="M6.5 12h11"/>'], ['maximize', 'Maximize', '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>'], ['close', 'Close', '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/>']]) {
    const button = document.createElement('button'); button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${shape}</svg>`;
    button.addEventListener('click', () => { void host.window(action); }); group.append(button);
  }
  controls.append(group); zone.append(controls);
}
