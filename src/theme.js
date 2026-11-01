// Theme: 'system' (default), 'light' or 'dark', kept per device. Loaded before the page paints so there is no flash.
(() => {
  const key = 'matro-theme', query = matchMedia('(prefers-color-scheme: light)');
  const read = () => { try { const v = localStorage.getItem(key); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
  const apply = () => {
    const mode = read(), light = mode === 'light' || (mode === 'system' && query.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f4f2ee' : '#0a0a0b');
    window.dispatchEvent(new CustomEvent('matro-theme', { detail: { mode, light } }));
  };
  window.matroTheme = { get: read, set(mode) { try { mode === 'system' ? localStorage.removeItem(key) : localStorage.setItem(key, mode); } catch {} apply(); } };
  query.addEventListener('change', apply); apply();
})();
