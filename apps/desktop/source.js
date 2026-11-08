const form = document.querySelector('#source-form'), address = document.querySelector('#address'), status = document.querySelector('#status'), connect = document.querySelector('#connect'), local = document.querySelector('#local');
async function run(action) {
  connect.disabled = local.disabled = true; status.textContent = 'Connecting…';
  try { await action(); } catch (error) { status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  finally { connect.disabled = local.disabled = false; }
}
form.addEventListener('submit', event => { event.preventDefault(); void run(() => window.matroSource.connect(address.value)); });
local.addEventListener('click', () => { void run(() => window.matroSource.local()); });
void window.matroSource.state().then(state => {
  address.value = state.url || ''; status.textContent = state.message || '';
  document.querySelector('#current').textContent = state.active ? `Using server: ${state.url}` : 'Using the local library on this PC.';
  local.hidden = !state.active; address.focus();
});
