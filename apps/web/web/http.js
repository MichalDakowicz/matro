import { fetchWithDeadline } from '../../../packages/core/client/offline-rules.js';

export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function api(method, url, body, { keepalive = false, signal, deadline = false } = {}) {
  const raw = body instanceof Blob;
  const send = signal => fetch(url, { method, keepalive, signal, credentials: 'same-origin', headers: { 'x-matro': '1', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const read = async res => {
    const data = await res.json().catch(error => {
      if (deadline && res.ok && !(error instanceof SyntaxError)) throw error;
      return {};
    });
    if (!res.ok) {
      // The session ended (password reset elsewhere, or expired): start over at the sign-in page.
      if (res.status === 401 && !url.includes('/login') && !url.includes('/status')) location.reload();
      throw new ApiError(res.status, typeof data?.error === 'string' && data.error ? data.error : 'Request failed.');
    }
    return data;
  };
  return deadline ? fetchWithDeadline(send, read, { signal }) : read(await send(signal));
}
export const get = url => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}, options) => api('PUT', url, body, options);
export const patch = (url, body = {}) => api('PATCH', url, body);
export const del = url => api('DELETE', url);
