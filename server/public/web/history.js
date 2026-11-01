// Back and forward for phones. The renderer keeps its views (details, player, footer, tab) in memory, so the browser's
// history has nothing to step through and a back swipe leaves the site. This mirrors those layers into history entries:
// opening one pushes an entry, and Back closes the topmost layer the same way Escape does. Forward is not restorable
// (the layer is gone), so it is stepped back out of rather than left pointing at nothing.
const at = () => document.querySelector('.dock-item[aria-current="page"]')?.dataset.tab || 'home';
const depth = () => (at() !== 'home' ? 1 : 0)
  + (document.querySelector('#detail-overlay') ? 1 : 0)
  + (document.body.classList.contains('in-player') ? 1 : 0)
  + (document.querySelector('.library-footer.open') ? 1 : 0);

let current = 0, ignore = 0, frame = 0;
history.replaceState({ matro: 0 }, '');

function closeTop() {
  const layered = document.querySelector('#detail-overlay') || document.body.classList.contains('in-player')
    || document.querySelector('.library-footer.open') || document.fullscreenElement;
  if (layered) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  else document.querySelector('.dock-item[data-tab="home"]')?.click();
}

function sync() {
  frame = 0;
  const now = depth();
  if (now > current) { for (let i = current + 1; i <= now; i++) history.pushState({ matro: i }, ''); current = now; }
  else if (now < current) { ignore++; history.go(now - current); current = now; }
}

addEventListener('popstate', event => {
  if (ignore) { ignore--; return; }
  const target = event.state?.matro ?? 0;
  if (target > current) { ignore++; history.go(current - target); return; }
  if (target < current) { current = target; closeTop(); }
  // A layer that closes without lowering the depth (a side panel) is re-synced by the next observation.
  schedule();
});

function schedule() { if (!frame) frame = requestAnimationFrame(sync); }
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
