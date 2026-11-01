// Touch has no mousemove to wake the player's hidden controls, so a tap on the picture wakes them first and only
// toggles play when they were already showing.
let swallow = false, timer = 0;
document.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse') return;
  const stage = event.target.closest?.('.stage');
  if (!stage) return;
  swallow = stage.classList.contains('idle');
  clearTimeout(timer); timer = setTimeout(() => { swallow = false; }, 700);
  stage.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
}, true);
document.addEventListener('click', event => {
  if (!swallow) return;
  swallow = false;
  event.stopPropagation(); event.preventDefault();
}, true);
// On a phone the queue is a sheet over the controls, so a tap on the picture above it closes it.
document.addEventListener('click', event => {
  if (!matchMedia('(max-width:720px)').matches || !document.querySelector('.player-layout.with-queue')) return;
  if (!event.target.closest?.('.stage') || event.target.closest('.queue-panel, .player-controls, .player-top, .tracks-panel')) return;
  event.stopPropagation(); event.preventDefault();
  document.querySelector('[data-action="queue"]')?.click();
}, true);
// Destructive taps on a phone ask first: starting over discards the resume point, un-marking discards "watched".
const askToConfirm = (title, confirm) => new Promise(resolve => {
  const dialog = document.createElement('dialog');
  dialog.className = 'web-dialog confirm-dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  const actions = document.createElement('div'); actions.className = 'show-actions';
  const yes = document.createElement('button'); yes.className = 'pill primary'; yes.textContent = confirm;
  const no = document.createElement('button'); no.className = 'pill'; no.textContent = 'Cancel';
  yes.addEventListener('click', () => dialog.close('yes')); no.addEventListener('click', () => dialog.close('no'));
  actions.append(yes, no); dialog.append(heading, actions);
  dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue === 'yes'); });
  document.body.append(dialog); dialog.showModal();
});
let confirmed = null;
document.addEventListener('click', event => {
  if (!matchMedia('(max-width:720px)').matches) return;
  const button = event.target.closest?.('[data-restart], [data-complete]');
  if (!button || button === confirmed) { confirmed = null; return; }
  const restart = button.hasAttribute('data-restart');
  if (!restart && !/incomplete/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent}`)) return;
  event.stopPropagation(); event.preventDefault();
  askToConfirm(restart ? 'Start from the beginning?' : 'Mark as not watched?', restart ? 'Start over' : 'Mark not watched').then(yes => { if (yes) { confirmed = button; button.click(); } });
}, true);
