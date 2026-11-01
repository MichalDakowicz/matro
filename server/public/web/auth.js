import { get, post } from './http.js';
import { h } from './dom.js';

// The way in: nothing else loads until you are signed in. Two forms share the page: sign in, and join with a one-time
// invite code from the head account (opened directly by a link ending in #/join/CODE). Enter moves between fields and submits.
// The head account itself is created from the command line on the server, so a fresh server shows instructions instead.
export async function signIn(root) {
  const { setup, user } = await get('/api/status');
  if (user) return user;
  if (setup) {
    root.replaceChildren(h('main', { class: 'page' }, h('section', { class: 'welcome' }, h('p', { class: 'show-kicker' }, 'Matro · first run'), h('h1', {}, 'This server needs setting up.'),
      h('p', {}, 'Create the head account on the machine that runs Matro, then come back and sign in here. Everything after that happens in the browser.'),
      h('pre', { class: 'web-command mono' }, 'node src/cli.js setup'), h('p', { class: 'dim' }, 'In Docker: docker compose exec matro node src/cli.js setup'))));
    return new Promise(() => {});
  }
  const link = location.hash.match(/^#\/join\/([A-Za-z0-9-]+)/);
  return new Promise(resolve => {
    let joining = !!link;
    const error = h('p', { class: 'web-error', role: 'alert' });
    const make = (props, nextField) => { const input = h('input', { ...props, onkeydown: e => { if (e.key === 'Enter' && nextField && !nextField().value) { e.preventDefault(); nextField().focus(); } } }); return input; };
    const code = make({ name: 'code', required: true, maxLength: 20, placeholder: 'Invite code, e.g. ABCD-EFGH-JKMN', 'aria-label': 'Invite code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, value: link ? link[1] : '' }, () => username);
    const username = make({ name: 'username', autocomplete: 'username', required: true, maxLength: 32, placeholder: 'Username', 'aria-label': 'Username', autocapitalize: 'none', spellcheck: false }, () => password);
    const password = h('input', { name: 'password', type: 'password', required: true, placeholder: 'Password', 'aria-label': 'Password' });
    const submit = h('button', { class: 'pill primary', type: 'submit' });
    const toggle = h('button', { class: 'text-button', type: 'button', onclick: () => { joining = !joining; error.textContent = ''; paint(); } });
    const heading = h('h1'), lede = h('p'), kicker = h('p', { class: 'show-kicker' }), hint = h('p', { class: 'show-hint' });
    const codeRow = h('label', { class: 'search-field' }, code);
    const form = h('form', { class: 'web-login', onsubmit: async e => {
      e.preventDefault(); error.textContent = ''; submit.disabled = true;
      try {
        const { user } = joining ? await post('/api/signup', { code: code.value, username: username.value, password: password.value }) : await post('/api/login', { username: username.value, password: password.value });
        document.removeEventListener('keydown', wake); history.replaceState(null, '', location.pathname); resolve(user);
      } catch (err) { error.textContent = err.message; submit.disabled = false; (joining && /code/i.test(err.message) ? code : password).select(); }
    } }, codeRow, h('label', { class: 'search-field' }, username), h('label', { class: 'search-field' }, password), error, submit, hint, toggle);
    function paint() {
      kicker.textContent = joining ? 'Matro · you are invited' : 'Matro · welcome back';
      heading.textContent = joining ? 'Create your account.' : 'Sign in to watch.';
      lede.textContent = joining ? 'Enter the one-time code you were sent, then choose your own username and password.' : 'Your progress, dubs and subtitle choices follow your account on every device.';
      codeRow.hidden = !joining; code.required = joining;
      password.autocomplete = joining ? 'new-password' : 'current-password'; password.placeholder = joining ? 'Choose a password (8 or more characters)' : 'Password';
      submit.textContent = joining ? 'Create account' : 'Sign in';
      hint.replaceChildren(h('span', { class: 'key-hint' }, 'Enter'), joining ? 'to create your account' : 'to sign in');
      toggle.textContent = joining ? 'Already have an account? Sign in' : 'Have an invite code?';
      (joining && !code.value ? code : username).focus();
    }
    // Press Enter anywhere on the page to start typing.
    const wake = e => { if (e.key === 'Enter' && document.activeElement === document.body) { e.preventDefault(); (joining && !code.value ? code : username).focus(); } };
    document.addEventListener('keydown', wake);
    root.replaceChildren(h('main', { class: 'page' }, h('section', { class: 'welcome' }, kicker, heading, lede, form)));
    paint();
  });
}
