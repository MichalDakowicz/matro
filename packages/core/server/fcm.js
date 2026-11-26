const { readFileSync } = require('node:fs');
const { createPrivateKey, sign } = require('node:crypto');

const oauthEndpoint = 'https://oauth2.googleapis.com/token';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function createFcm(env = process.env, fetch = globalThis.fetch) {
  if (!env.MATRO_REQUEST_FCM_CREDENTIALS) return null;
  let account, key;
  try {
    account = JSON.parse(readFileSync(env.MATRO_REQUEST_FCM_CREDENTIALS, 'utf8'));
    if (account.type !== 'service_account' || !/^[a-z][a-z0-9-]{5,29}$/.test(account.project_id) ||
        typeof account.client_email !== 'string' || !account.client_email.endsWith('.iam.gserviceaccount.com')) throw new Error();
    key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa') throw new Error();
  } catch {
    console.error('Movie request alerts are disabled. Check MATRO_REQUEST_FCM_CREDENTIALS.');
    return null;
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  let cached, refresh;
  async function authorize() {
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: oauthEndpoint, iat: now, exp: now + 3600,
    });
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${payload}`;
    const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
    const response = await fetch(oauthEndpoint, {
      method: 'POST', signal: AbortSignal.timeout(8000), redirect: 'error',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in)) {
      throw new Error(`Firebase authorization failed (HTTP ${response.status}).`);
    }
    cached = { token: result.access_token, expires: now + result.expires_in };
    return cached.token;
  }
  return async ({ token, id, title, year, requester, outcome }, { test = false } = {}) => {
    const access = cached?.expires > Date.now() / 1000 + 60 ? cached.token : await (refresh ??= authorize().finally(() => { refresh = null; }));
    const response = await fetch(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        notification: {
          title: test ? 'Example Movie (2024)' : year ? `${title} (${year})` : title,
          body: test ? 'Requested by Demo Viewer · Test alert' : outcome === 'ready' ? 'Ready to watch in your library'
            : outcome === 'declined' ? 'Your request was declined' : `Requested by ${requester || 'a removed account'}`,
        },
        data: { kind: 'matro.movie-request', registration: id },
        android: { priority: 'high', ttl: test ? '60s' : '3600s', notification: { channel_id: 'movie-requests', sound: 'default' } },
      } }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return 'sent';
    const detail = result.error?.details?.find(item => item['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError');
    if (['UNREGISTERED', 'SENDER_ID_MISMATCH'].includes(detail?.errorCode)) return 'unregistered';
    if (response.status === 401) cached = null;
    throw new Error(`Firebase delivery failed (HTTP ${response.status}).`);
  };
}

module.exports = { createFcm };
