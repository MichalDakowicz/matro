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
    setPlayback(sessions.size > 0, buffering);
    if (sessions.size) timer = setTimeout(refresh, expires - now).unref();
  }
  return {
    set(key, playing, buffering = false) {
      if (playing) sessions.set(key, { expires: Date.now() + ttlMs, buffering });
      else sessions.delete(key);
      refresh();
    },
    close() { clearTimeout(timer); sessions.clear(); }
  };
}

module.exports = { playbackSession, createPlaybackActivity };
