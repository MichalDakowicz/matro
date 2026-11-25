const { sessionHash } = require('./auth');
const { HttpError } = require('./http');

function playbackSession(ctx, id) {
  if (id != null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) {
    throw new HttpError(400, 'Bad playback session.');
  }
  return `${ctx.user.id}:${sessionHash(ctx.token)}:${id ?? ''}`;
}

function createPlaybackActivity(setPlayback, ttlMs = 90000) {
  const sessions = new Map();
  const sources = new Map();
  let timer;
  function refresh() {
    clearTimeout(timer);
    const now = Date.now();
    let expires = Infinity, buffering = false;
    for (const [key, activity] of sessions) {
      if (activity.expires <= now) { sessions.delete(key); continue; }
      expires = Math.min(expires, activity.expires);
      buffering ||= activity.buffering;
    }
    for (const [key, source] of sources) {
      if (source.expires <= now) sources.delete(key);
      else expires = Math.min(expires, source.expires);
    }
    setPlayback(sessions.size > 0, buffering);
    if (expires !== Infinity) timer = setTimeout(refresh, expires - now).unref();
  }
  return {
    set(key, playing, buffering = false, sticky = false) {
      if (playing) {
        const expires = sticky ? Infinity : Date.now() + ttlMs;
        sessions.set(key, { expires, buffering });
        const source = sources.get(key);
        if (source) source.expires = expires;
      }
      else {
        sessions.delete(key);
        const source = sources.get(key);
        if (source?.expires === Infinity) source.expires = Date.now() + ttlMs;
      }
      refresh();
    },
    source(key, value, preload) {
      const source = sources.get(key) || {};
      source[preload ? 'next' : 'current'] = value;
      source.expires = sessions.get(key)?.expires === Infinity ? Infinity : Date.now() + ttlMs;
      sources.set(key, source);
      refresh();
    },
    stop(key, keepPreload) {
      const next = sources.get(key)?.next;
      if (keepPreload && next) sources.set(key, { current: next, expires: Date.now() + ttlMs });
      else sources.delete(key);
      this.set(key, false);
    },
    list(encoder) {
      return [...sessions].flatMap(([key, { buffering }]) => {
        const source = sources.get(key)?.current;
        return source ? [{ ...source, buffering, encoder: source.mode === 'Direct play' ? null : encoder(key) }] : [];
      });
    },
    close() { clearTimeout(timer); sessions.clear(); sources.clear(); }
  };
}

module.exports = { playbackSession, createPlaybackActivity };
