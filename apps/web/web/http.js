export class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
export async function api(method, url, body, { keepalive = false, signal, accountId } = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(url, { method, keepalive, signal, credentials: 'same-origin', headers: { 'x-matro': '1', ...(accountId === undefined ? {} : { 'x-matro-account': String(accountId) }), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The session ended (password reset elsewhere, or expired): start over at the sign-in page.
    if ((res.status === 401 && !url.includes('/login') && !url.includes('/status')) || (res.status === 409 && data.code === 'account-changed')) location.reload();
    throw new ApiError(res.status, data.error || 'Request failed.', data.code);
  }
  return data;
}
export const get = url => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}, options) => api('PUT', url, body, options);
export const patch = (url, body = {}) => api('PATCH', url, body);
export const del = url => api('DELETE', url);
